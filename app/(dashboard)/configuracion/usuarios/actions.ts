"use server"

import { createAdminClient, isAdminClientConfigured } from "@/lib/supabase/admin"
import { createClient as createServerClient } from "@/lib/supabase/server"
import { revalidatePath } from "next/cache"
import { findModuloByDBName, moduloHabilitadoParaEmpresa } from "@/lib/constants/modulos"

/**
 * Verifica que el caller sea un admin activo y devuelve su razon_social_id.
 * Esto evita que un usuario "usuario" pueda crear otros usuarios aunque
 * invoque el Server Action directamente.
 */
async function assertAdminCaller(): Promise<
  { ok: true; callerId: string; razonSocialId: number }
  | { ok: false; error: string }
> {
  const supabase = await createServerClient()
  if (!supabase) return { ok: false, error: "Supabase no esta configurado." }

  const {
    data: { user: authUser },
  } = await supabase.auth.getUser()
  if (!authUser) return { ok: false, error: "Sesion no valida. Inicia sesion nuevamente." }

  const { data: perfil, error } = await supabase
    .from("usuarios")
    .select("id, razon_social_id, rol, activo")
    .eq("id", authUser.id)
    .single()

  if (error || !perfil) return { ok: false, error: "No se encontro el perfil del usuario." }
  if (perfil.activo === false) return { ok: false, error: "Tu cuenta esta inactiva." }
  if ((perfil.rol || "").trim().toLowerCase() !== "admin") {
    return { ok: false, error: "No tienes permisos para administrar usuarios." }
  }
  if (perfil.razon_social_id == null) {
    return { ok: false, error: "Tu usuario no tiene razon social asignada." }
  }

  return { ok: true, callerId: perfil.id, razonSocialId: perfil.razon_social_id }
}

// ============================================
// Crear usuario
// ============================================
export async function createUserAction(input: {
  email: string
  password: string
  nombre: string
  rol: "admin" | "usuario"
}): Promise<{ error: string | null; usuarioId?: string }> {
  const auth = await assertAdminCaller()
  if (!auth.ok) return { error: auth.error }

  if (!isAdminClientConfigured()) {
    return {
      error:
        "Falta configurar SUPABASE_SERVICE_ROLE_KEY en las variables de entorno del proyecto.",
    }
  }

  const email = input.email.trim().toLowerCase()
  const nombre = input.nombre.trim()
  const rol = input.rol === "admin" ? "admin" : "usuario"

  if (!email || !input.password || !nombre) {
    return { error: "Todos los campos son obligatorios." }
  }
  if (input.password.length < 6) {
    return { error: "La contrasena debe tener al menos 6 caracteres." }
  }

  const admin = createAdminClient()
  if (!admin) return { error: "No se pudo inicializar el cliente admin." }

  // 1) Crear usuario en auth.users (auto-confirmado)
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password: input.password,
    email_confirm: true,
    user_metadata: { nombre },
  })

  if (createErr || !created?.user) {
    console.log("[createUserAction] admin.createUser error:", createErr)
    const msg = createErr?.message?.toLowerCase() || ""
    if (msg.includes("already") || msg.includes("exists") || msg.includes("duplicate")) {
      return { error: "Ya existe un usuario con ese correo." }
    }
    return { error: createErr?.message || "No se pudo crear el usuario en auth." }
  }

  const newAuthId = created.user.id

  // 2) Insertar en tabla publica usuarios con el mismo UUID
  const { error: insertErr } = await admin.from("usuarios").insert({
    id: newAuthId,
    nombre,
    rol,
    razon_social_id: auth.razonSocialId,
    activo: true,
  })

  if (insertErr) {
    console.log("[createUserAction] insert usuarios error:", insertErr)
    // Rollback: eliminar el auth user para no dejar huerfanos
    await admin.auth.admin.deleteUser(newAuthId).catch(() => {})
    return { error: insertErr.message || "No se pudo crear el perfil del usuario." }
  }

  revalidatePath("/configuracion/usuarios")
  return { error: null, usuarioId: newAuthId }
}

// ============================================
// Upsert permiso (switch ON/OFF)
// ============================================
export async function setPermisoAction(input: {
  usuarioId: string
  moduloId: number
  puedeVer: boolean
}): Promise<{ error: string | null }> {
  const auth = await assertAdminCaller()
  if (!auth.ok) return { error: auth.error }

  const admin = createAdminClient()
  if (!admin) {
    return { error: "Falta configurar SUPABASE_SERVICE_ROLE_KEY." }
  }

  // Validar que el usuario objetivo pertenezca al mismo tenant
  const { data: target, error: targetErr } = await admin
    .from("usuarios")
    .select("id, razon_social_id")
    .eq("id", input.usuarioId)
    .single()

  if (targetErr || !target) return { error: "Usuario no encontrado." }
  if (target.razon_social_id !== auth.razonSocialId) {
    return { error: "Ese usuario no pertenece a tu razon social." }
  }

  const { error } = await admin
    .from("permisos_usuarios")
    .upsert(
      {
        usuario_id: input.usuarioId,
        modulo_id: input.moduloId,
        puede_ver: input.puedeVer,
      },
      { onConflict: "usuario_id,modulo_id" }
    )

  if (error) {
    console.log("[setPermisoAction] upsert error:", error)
    return { error: error.message || "No se pudo guardar el permiso." }
  }

  revalidatePath("/configuracion/usuarios")
  return { error: null }
}

// ============================================
// Activar / desactivar usuario
// ============================================
export async function toggleUsuarioActivoAction(input: {
  usuarioId: string
  activo: boolean
}): Promise<{ error: string | null }> {
  const auth = await assertAdminCaller()
  if (!auth.ok) return { error: auth.error }

  if (input.usuarioId === auth.callerId) {
    return { error: "No puedes desactivar tu propio usuario." }
  }

  const admin = createAdminClient()
  if (!admin) return { error: "Falta configurar SUPABASE_SERVICE_ROLE_KEY." }

  const { data: target } = await admin
    .from("usuarios")
    .select("razon_social_id")
    .eq("id", input.usuarioId)
    .single()
  if (!target || target.razon_social_id !== auth.razonSocialId) {
    return { error: "Usuario no valido." }
  }

  const { error } = await admin
    .from("usuarios")
    .update({ activo: input.activo })
    .eq("id", input.usuarioId)

  if (error) {
    console.log("[toggleUsuarioActivoAction] update error:", error)
    return { error: error.message || "No se pudo actualizar el estado." }
  }

  revalidatePath("/configuracion/usuarios")
  return { error: null }
}

// ============================================
// Resetear contrasena de un usuario (sincroniza con Supabase Auth)
// ============================================
export async function resetUserPasswordAction(input: {
  usuarioId: string
  newPassword: string
}): Promise<{ error: string | null }> {
  const auth = await assertAdminCaller()
  if (!auth.ok) return { error: auth.error }

  const newPassword = input.newPassword || ""
  if (newPassword.length < 6) {
    return { error: "La nueva contrasena debe tener al menos 6 caracteres." }
  }

  const admin = createAdminClient()
  if (!admin) return { error: "Falta configurar SUPABASE_SERVICE_ROLE_KEY." }

  // Validar que el usuario objetivo pertenezca al mismo tenant
  const { data: target, error: targetErr } = await admin
    .from("usuarios")
    .select("id, razon_social_id")
    .eq("id", input.usuarioId)
    .single()

  if (targetErr || !target) return { error: "Usuario no encontrado." }
  if (target.razon_social_id !== auth.razonSocialId) {
    return { error: "Ese usuario no pertenece a tu razon social." }
  }

  // Actualiza la contrasena directamente en auth.users via admin API
  const { error: updateErr } = await admin.auth.admin.updateUserById(input.usuarioId, {
    password: newPassword,
  })

  if (updateErr) {
    console.log("[resetUserPasswordAction] updateUserById error:", updateErr)
    return { error: updateErr.message || "No se pudo actualizar la contrasena." }
  }

  revalidatePath("/configuracion/usuarios")
  return { error: null }
}

// ============================================
// Cambiar rol
// ============================================
export async function setRolAction(input: {
  usuarioId: string
  rol: "admin" | "usuario"
}): Promise<{ error: string | null }> {
  const auth = await assertAdminCaller()
  if (!auth.ok) return { error: auth.error }

  if (input.usuarioId === auth.callerId && input.rol !== "admin") {
    return { error: "No puedes quitarte el rol admin a ti mismo." }
  }

  const admin = createAdminClient()
  if (!admin) return { error: "Falta configurar SUPABASE_SERVICE_ROLE_KEY." }

  const { data: target } = await admin
    .from("usuarios")
    .select("razon_social_id")
    .eq("id", input.usuarioId)
    .single()
  if (!target || target.razon_social_id !== auth.razonSocialId) {
    return { error: "Usuario no valido." }
  }

  const { error } = await admin
    .from("usuarios")
    .update({ rol: input.rol })
    .eq("id", input.usuarioId)

  if (error) return { error: error.message || "No se pudo actualizar el rol." }

  revalidatePath("/configuracion/usuarios")
  return { error: null }
}

// ============================================
// Listar usuarios y modulos del tenant (bypassea RLS via service role)
// Se requiere que el caller sea admin activo del mismo tenant.
// ============================================
export interface UsuarioListItem {
  id: string
  nombre: string
  rol: string | null
  activo: boolean
  /** Punto de facturación asignado (script officemart-004); null = ninguno. */
  punto_facturacion_id?: number | null
}

// ============================================
// Asignar punto de facturación a un usuario (officemart-004). Solo admin del
// mismo tenant. `puntoId` null = sin punto (vende con el flujo clásico).
// ============================================
export async function setPuntoUsuarioAction(input: {
  usuarioId: string
  puntoId: number | null
}): Promise<{ error: string | null }> {
  const auth = await assertAdminCaller()
  if (!auth.ok) return { error: auth.error }

  const admin = createAdminClient()
  if (!admin) return { error: "Falta configurar SUPABASE_SERVICE_ROLE_KEY." }

  const { data: target } = await admin
    .from("usuarios")
    .select("razon_social_id")
    .eq("id", input.usuarioId)
    .single()
  if (!target || target.razon_social_id !== auth.razonSocialId) {
    return { error: "Usuario no valido." }
  }

  if (input.puntoId != null) {
    const { data: punto } = await admin
      .from("puntos_facturacion")
      .select("id, razon_social_id")
      .eq("id", input.puntoId)
      .maybeSingle()
    if (!punto || punto.razon_social_id !== auth.razonSocialId) {
      return { error: "El punto de facturación no existe o no es de tu empresa." }
    }
  }

  const { error } = await admin
    .from("usuarios")
    .update({ punto_facturacion_id: input.puntoId })
    .eq("id", input.usuarioId)

  if (error) {
    if (/punto_facturacion_id/i.test(error.message || "")) {
      return { error: "Aplica scripts/officemart-004-puntos-facturacion.sql para asignar puntos." }
    }
    return { error: error.message || "No se pudo asignar el punto." }
  }

  revalidatePath("/configuracion/usuarios")
  return { error: null }
}

export interface ModuloListItem {
  id: number
  nombre: string
  icono: string | null
}

export async function listUsuariosAction(): Promise<{
  usuarios: UsuarioListItem[]
  modulos: ModuloListItem[]
  error: string | null
}> {
  const auth = await assertAdminCaller()
  if (!auth.ok) return { usuarios: [], modulos: [], error: auth.error }

  const admin = createAdminClient()
  if (!admin) {
    return {
      usuarios: [],
      modulos: [],
      error: "Falta configurar SUPABASE_SERVICE_ROLE_KEY.",
    }
  }

  // `punto_facturacion_id` (officemart-004): si la columna aún no existe, se
  // reintenta sin ella.
  const listarUsuarios = async () => {
    const conPunto = await admin
      .from("usuarios")
      .select("id, nombre, rol, activo, punto_facturacion_id")
      .eq("razon_social_id", auth.razonSocialId)
      .order("nombre", { ascending: true })
    if (conPunto.error && /punto_facturacion_id/i.test(conPunto.error.message || "")) {
      return admin
        .from("usuarios")
        .select("id, nombre, rol, activo")
        .eq("razon_social_id", auth.razonSocialId)
        .order("nombre", { ascending: true })
    }
    return conPunto
  }

  const [uRes, mRes, cfgRes] = await Promise.all([
    listarUsuarios(),
    admin
      .from("modulos")
      .select("id, nombre, icono")
      .order("nombre", { ascending: true }),
    admin
      .from("razon_social_config")
      .select("config")
      .eq("razon_social_id", auth.razonSocialId)
      .maybeSingle(),
  ])

  if (uRes.error) {
    console.log("[listUsuariosAction] usuarios error:", uRes.error)
    return {
      usuarios: [],
      modulos: [],
      error: uRes.error.message || "No se pudieron cargar los usuarios.",
    }
  }

  if (mRes.error) {
    console.log("[listUsuariosAction] modulos error:", mRes.error)
  }

  // Modulos NO habilitados por el super-admin para esta empresa: NO se pueden
  // asignar (ni aparecen) en la seccion de permisos. Base = ON salvo
  // deshabilitados; nuevos = OFF salvo que el super-admin los habilite.
  const cfg = cfgRes.data?.config as Record<string, unknown> | null
  const soloStrings = (v: unknown): string[] =>
    Array.isArray(v) ? (v as unknown[]).filter((x): x is string => typeof x === "string") : []
  const des = soloStrings(cfg?.modulos_deshabilitados)
  const hab = soloStrings(cfg?.modulos_habilitados)
  const modulos = ((mRes.data || []) as ModuloListItem[]).filter((m) =>
    moduloHabilitadoParaEmpresa(findModuloByDBName(m.nombre)?.nombre ?? m.nombre, des, hab)
  )

  return {
    usuarios: (uRes.data || []) as UsuarioListItem[],
    modulos,
    error: null,
  }
}

export async function listPermisosAction(
  usuarioId: string
): Promise<{ permisos: Record<number, boolean>; error: string | null }> {
  const auth = await assertAdminCaller()
  if (!auth.ok) return { permisos: {}, error: auth.error }

  const admin = createAdminClient()
  if (!admin) {
    return { permisos: {}, error: "Falta configurar SUPABASE_SERVICE_ROLE_KEY." }
  }

  // Validar que el usuario objetivo pertenezca al mismo tenant
  const { data: target, error: targetErr } = await admin
    .from("usuarios")
    .select("razon_social_id")
    .eq("id", usuarioId)
    .single()

  if (targetErr || !target) return { permisos: {}, error: "Usuario no encontrado." }
  if (target.razon_social_id !== auth.razonSocialId) {
    return { permisos: {}, error: "Ese usuario no pertenece a tu razon social." }
  }

  const { data, error } = await admin
    .from("permisos_usuarios")
    .select("modulo_id, puede_ver")
    .eq("usuario_id", usuarioId)

  if (error) {
    console.log("[listPermisosAction] error:", error)
    return { permisos: {}, error: error.message || "No se pudieron cargar los permisos." }
  }

  const map: Record<number, boolean> = {}
  for (const row of data || []) {
    map[row.modulo_id as number] = !!row.puede_ver
  }
  return { permisos: map, error: null }
}
