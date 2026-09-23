import { createClient, isSupabaseConfigured } from "@/lib/supabase/client"
import { getTenantStamp, isValidStamp, SESION_INVALIDA_ERROR } from "@/lib/services/tenant-stamp"

// ==================== TIPOS ====================

export interface Vendedor {
  id?: number
  nombre: string
  /** Usuario de la app que es este vendedor (auth uid). Opcional. */
  usuario_id?: string | null
  correo?: string | null
  telefono?: string | null
  activo?: boolean
  created_at?: string
}

export interface Zona {
  id?: number
  nombre: string
  ciudad?: string | null
  activo?: boolean
  created_at?: string
}

export const VENDEDORES_FEATURE_PENDING =
  "Vendedores y zonas pendientes: aplica scripts/officemart-002-cimientos.sql en Supabase."

function isMissingTable(err: { message?: string; code?: string } | null): boolean {
  if (!err) return false
  const msg = (err.message || "").toLowerCase()
  return (
    err.code === "42P01" ||
    err.code === "PGRST205" ||
    /relation .*(vendedores|zonas).* does not exist/.test(msg) ||
    msg.includes("could not find the table")
  )
}

const blank = (v: unknown) => (typeof v === "string" && v.trim() === "" ? null : v)

// ==================== PURAS ====================

/**
 * Vendedor por defecto de una venta: el ya elegido; si no, el vendedor que ES
 * el usuario logueado; si no, el vendedor asignado al cliente; si no, ninguno.
 */
export function resolverVendedorPorDefecto(input: {
  actual?: number | null
  vendedorUsuarioId?: number | null
  vendedorClienteId?: number | null
}): number | null {
  if (input.actual != null) return input.actual
  if (input.vendedorUsuarioId != null) return input.vendedorUsuarioId
  if (input.vendedorClienteId != null) return input.vendedorClienteId
  return null
}

// ==================== VENDEDORES ====================

export async function getVendedores(
  opts: { soloActivos?: boolean } = {}
): Promise<{ data: Vendedor[]; error: string | null }> {
  if (!isSupabaseConfigured()) return { data: [], error: null }
  const supabase = createClient()
  if (!supabase) return { data: [], error: "Cliente no disponible" }

  let query = supabase.from("vendedores").select("*").order("nombre", { ascending: true })
  if (opts.soloActivos) query = query.eq("activo", true)
  const { data, error } = await query
  if (error) {
    if (isMissingTable(error)) return { data: [], error: VENDEDORES_FEATURE_PENDING }
    return { data: [], error: error.message }
  }
  return { data: (data || []) as Vendedor[], error: null }
}

/** El vendedor (activo) ligado al usuario logueado, o null. */
export async function getVendedorDeUsuario(
  authUserId: string | null | undefined
): Promise<Vendedor | null> {
  if (!authUserId || !isSupabaseConfigured()) return null
  const supabase = createClient()
  if (!supabase) return null
  const { data, error } = await supabase
    .from("vendedores")
    .select("*")
    .eq("usuario_id", authUserId)
    .eq("activo", true)
    .limit(1)
  if (error || !data || data.length === 0) return null
  return data[0] as Vendedor
}

export async function saveVendedor(
  vendedor: Vendedor,
  isNew: boolean
): Promise<{ data: Vendedor | null; error: string | null }> {
  const nombre = (vendedor.nombre || "").trim()
  if (!nombre) return { data: null, error: "El nombre es requerido" }
  const supabase = createClient()
  if (!supabase) return { data: null, error: "Cliente no disponible" }

  const fila = {
    nombre,
    usuario_id: blank(vendedor.usuario_id) ?? null,
    correo: blank(vendedor.correo) ?? null,
    telefono: blank(vendedor.telefono) ?? null,
    activo: vendedor.activo ?? true,
  }

  if (isNew) {
    const stamp = await getTenantStamp(supabase)
    if (!isValidStamp(stamp)) return { data: null, error: SESION_INVALIDA_ERROR }
    const { data, error } = await supabase
      .from("vendedores")
      .insert({ ...fila, ...stamp })
      .select()
      .single()
    if (error) {
      if (isMissingTable(error)) return { data: null, error: VENDEDORES_FEATURE_PENDING }
      return { data: null, error: error.message }
    }
    return { data: data as Vendedor, error: null }
  }

  const { data, error } = await supabase
    .from("vendedores")
    .update({ ...fila, updated_at: new Date().toISOString() })
    .eq("id", vendedor.id)
    .select()
    .single()
  if (error) return { data: null, error: error.message }
  return { data: data as Vendedor, error: null }
}

/**
 * Borra un vendedor sin ventas; si ya tiene ventas asociadas lo DESACTIVA
 * (las ventas conservan su vendedor_id para reportes y comisiones).
 */
export async function deleteVendedor(
  id: number
): Promise<{ success: boolean; modo: "borrado" | "desactivado" | null; error: string | null }> {
  const supabase = createClient()
  if (!supabase) return { success: false, modo: null, error: "Cliente no disponible" }

  const { count } = await supabase
    .from("ventas_encabezado")
    .select("id", { count: "exact", head: true })
    .eq("vendedor_id", id)
  if ((count || 0) > 0) {
    const { error } = await supabase
      .from("vendedores")
      .update({ activo: false, updated_at: new Date().toISOString() })
      .eq("id", id)
    if (error) return { success: false, modo: null, error: error.message }
    return { success: true, modo: "desactivado", error: null }
  }

  const { error } = await supabase.from("vendedores").delete().eq("id", id)
  if (error) return { success: false, modo: null, error: error.message }
  return { success: true, modo: "borrado", error: null }
}

// ==================== ZONAS ====================

export async function getZonas(
  opts: { soloActivas?: boolean } = {}
): Promise<{ data: Zona[]; error: string | null }> {
  if (!isSupabaseConfigured()) return { data: [], error: null }
  const supabase = createClient()
  if (!supabase) return { data: [], error: "Cliente no disponible" }

  let query = supabase.from("zonas").select("*").order("nombre", { ascending: true })
  if (opts.soloActivas) query = query.eq("activo", true)
  const { data, error } = await query
  if (error) {
    if (isMissingTable(error)) return { data: [], error: VENDEDORES_FEATURE_PENDING }
    return { data: [], error: error.message }
  }
  return { data: (data || []) as Zona[], error: null }
}

export async function saveZona(zona: Zona, isNew: boolean): Promise<{ data: Zona | null; error: string | null }> {
  const nombre = (zona.nombre || "").trim()
  if (!nombre) return { data: null, error: "El nombre es requerido" }
  const supabase = createClient()
  if (!supabase) return { data: null, error: "Cliente no disponible" }

  const fila = { nombre, ciudad: blank(zona.ciudad) ?? null, activo: zona.activo ?? true }

  if (isNew) {
    const stamp = await getTenantStamp(supabase)
    if (!isValidStamp(stamp)) return { data: null, error: SESION_INVALIDA_ERROR }
    const { data, error } = await supabase.from("zonas").insert({ ...fila, ...stamp }).select().single()
    if (error) {
      if (isMissingTable(error)) return { data: null, error: VENDEDORES_FEATURE_PENDING }
      return { data: null, error: error.message }
    }
    return { data: data as Zona, error: null }
  }

  const { data, error } = await supabase
    .from("zonas")
    .update({ ...fila, updated_at: new Date().toISOString() })
    .eq("id", zona.id)
    .select()
    .single()
  if (error) return { data: null, error: error.message }
  return { data: data as Zona, error: null }
}

/** Borra una zona sin clientes; con clientes asignados la desactiva. */
export async function deleteZona(
  id: number
): Promise<{ success: boolean; modo: "borrado" | "desactivado" | null; error: string | null }> {
  const supabase = createClient()
  if (!supabase) return { success: false, modo: null, error: "Cliente no disponible" }

  const { count } = await supabase
    .from("clientes")
    .select("id", { count: "exact", head: true })
    .eq("zona_id", id)
  if ((count || 0) > 0) {
    const { error } = await supabase
      .from("zonas")
      .update({ activo: false, updated_at: new Date().toISOString() })
      .eq("id", id)
    if (error) return { success: false, modo: null, error: error.message }
    return { success: true, modo: "desactivado", error: null }
  }

  const { error } = await supabase.from("zonas").delete().eq("id", id)
  if (error) return { success: false, modo: null, error: error.message }
  return { success: true, modo: "borrado", error: null }
}
