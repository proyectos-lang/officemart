"use server"

import { revalidatePath } from "next/cache"
import { createClient as createServerClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { STORAGE_PREFIX } from "@/lib/supabase/schema"

const LOGO_BUCKET = "logos"
const ALLOWED_LOGO_EXTS = ["png", "jpg", "jpeg", "webp"] as const

/**
 * Valida la sesion y devuelve el razon_social_id del usuario actual.
 * Si el usuario no tiene razon_social_id asociado, devuelve error.
 */
async function resolveTenant(): Promise<
  | { ok: true; razonSocialId: number }
  | { ok: false; error: string }
> {
  const server = await createServerClient()
  if (!server) return { ok: false, error: "Supabase no esta configurado." }

  const {
    data: { user: authUser },
  } = await server.auth.getUser()
  if (!authUser) return { ok: false, error: "Sesion invalida. Vuelve a iniciar sesion." }

  const admin = createAdminClient()
  if (!admin) {
    return {
      ok: false,
      error: "Falta configurar SUPABASE_SERVICE_ROLE_KEY en el proyecto.",
    }
  }

  const { data: perfil, error } = await admin
    .from("usuarios")
    .select("razon_social_id, activo")
    .eq("id", authUser.id)
    .single()

  if (error || !perfil) return { ok: false, error: "Tu perfil no fue encontrado." }
  if (perfil.activo === false) return { ok: false, error: "Tu cuenta esta inactiva." }
  if (perfil.razon_social_id == null) {
    return { ok: false, error: "Debes crear la razon social antes de gestionar el logo." }
  }

  return { ok: true, razonSocialId: perfil.razon_social_id as number }
}

/**
 * Persiste la logo_url en razon_social para el tenant del usuario actual.
 * Se ejecuta con service role para bypassear RLS en UPDATE.
 */
export async function persistLogoUrlAction(
  logoUrl: string | null
): Promise<{ ok: boolean; error: string | null }> {
  const ctx = await resolveTenant()
  if (!ctx.ok) return { ok: false, error: ctx.error }

  const admin = createAdminClient()
  if (!admin) {
    return { ok: false, error: "Falta configurar SUPABASE_SERVICE_ROLE_KEY." }
  }

  const { error } = await admin
    .from("razon_social")
    .update({ logo_url: logoUrl })
    .eq("id", ctx.razonSocialId)

  if (error) {
    console.log("[persistLogoUrlAction] error:", error)
    return { ok: false, error: error.message || "No se pudo guardar la URL del logo." }
  }

  revalidatePath("/configuracion/razon-social")
  return { ok: true, error: null }
}

/**
 * Borra todas las variantes del logo del bucket y limpia logo_url.
 * Se ejecuta con service role (tanto el storage como el update).
 */
export async function removeLogoAction(): Promise<{ ok: boolean; error: string | null }> {
  const ctx = await resolveTenant()
  if (!ctx.ok) return { ok: false, error: ctx.error }

  const admin = createAdminClient()
  if (!admin) {
    return { ok: false, error: "Falta configurar SUPABASE_SERVICE_ROLE_KEY." }
  }

  // Borrar todas las variantes posibles del storage
  const paths = ALLOWED_LOGO_EXTS.map((ext) => `${STORAGE_PREFIX}logo_${ctx.razonSocialId}.${ext}`)
  const { error: removeErr } = await admin.storage.from(LOGO_BUCKET).remove(paths)
  if (removeErr) {
    // No abortamos: podemos aun limpiar la URL
    console.log("[removeLogoAction] storage warning:", removeErr)
  }

  const { error: updateErr } = await admin
    .from("razon_social")
    .update({ logo_url: null })
    .eq("id", ctx.razonSocialId)

  if (updateErr) {
    console.log("[removeLogoAction] update error:", updateErr)
    return { ok: false, error: updateErr.message || "No se pudo limpiar la URL del logo." }
  }

  revalidatePath("/configuracion/razon-social")
  return { ok: true, error: null }
}
