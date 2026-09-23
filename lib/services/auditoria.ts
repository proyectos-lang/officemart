import type { SupabaseClient } from "@supabase/supabase-js"
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client"
import type { TenantStamp } from "@/lib/services/tenant-stamp"

// ==================== TIPOS ====================

export interface AuditoriaInput {
  /** 'venta' | 'recibo' | 'devolucion' | 'compra' | 'orden' | 'cotizacion' ... */
  entidad: string
  entidad_id?: number | null
  /** 'crear' | 'anular' | 'editar' | 'pagar' | 'cerrar' ... */
  accion: string
  motivo?: string | null
  antes?: unknown
  despues?: unknown
}

export interface AuditoriaRegistro {
  id: number
  entidad: string
  entidad_id: number | null
  accion: string
  motivo: string | null
  antes: unknown
  despues: unknown
  usuario: string | null
  created_at: string
}

export const AUDITORIA_FEATURE_PENDING =
  "Bitácora de auditoría pendiente: aplica scripts/officemart-001-base-comun.sql en Supabase."

function isMissingTable(err: { message?: string; code?: string } | null): boolean {
  if (!err) return false
  const msg = (err.message || "").toLowerCase()
  return (
    err.code === "42P01" ||
    err.code === "PGRST205" ||
    /relation .*auditoria.* does not exist/.test(msg) ||
    msg.includes("could not find the table")
  )
}

// ==================== ESCRITURA ====================

/**
 * Registra una entrada en la bitácora. Es BEST-EFFORT a propósito: la
 * operación de negocio ya se hizo y no debe fallar porque la bitácora no se
 * pudo escribir (tabla pendiente, RLS, red). Solo deja rastro en consola.
 */
export async function registrarAuditoria(
  supabase: SupabaseClient,
  stamp: TenantStamp,
  input: AuditoriaInput
): Promise<void> {
  if (!stamp.razon_social_id) return
  try {
    const { error } = await supabase.from("auditoria").insert({
      razon_social_id: stamp.razon_social_id,
      usuario: stamp.usuario,
      entidad: input.entidad,
      entidad_id: input.entidad_id ?? null,
      accion: input.accion,
      motivo: (input.motivo || "").trim() || null,
      antes: input.antes ?? null,
      despues: input.despues ?? null,
    })
    if (error && !isMissingTable(error)) {
      console.warn("[auditoria] no se pudo registrar:", error.message)
    }
  } catch (err) {
    console.warn("[auditoria] excepción al registrar:", err)
  }
}

// ==================== LECTURA ====================

export async function getAuditoria(
  filtros: {
    entidad?: string
    entidad_id?: number
    usuario?: string
    accion?: string
    desde?: string // YYYY-MM-DD
    hasta?: string // YYYY-MM-DD
    limit?: number
  } = {}
): Promise<{ data: AuditoriaRegistro[]; error: string | null }> {
  if (!isSupabaseConfigured()) return { data: [], error: null }
  const supabase = createClient()
  if (!supabase) return { data: [], error: "Cliente no disponible" }

  let query = supabase.from("auditoria").select("*")
  if (filtros.entidad) query = query.eq("entidad", filtros.entidad)
  if (filtros.entidad_id != null) query = query.eq("entidad_id", filtros.entidad_id)
  if (filtros.usuario) query = query.ilike("usuario", `%${filtros.usuario}%`)
  if (filtros.accion) query = query.eq("accion", filtros.accion)
  if (filtros.desde) query = query.gte("created_at", `${filtros.desde}T00:00:00`)
  if (filtros.hasta) query = query.lte("created_at", `${filtros.hasta}T23:59:59`)

  const { data, error } = await query
    .order("created_at", { ascending: false })
    .limit(filtros.limit ?? 500)

  if (error) {
    if (isMissingTable(error)) return { data: [], error: AUDITORIA_FEATURE_PENDING }
    return { data: [], error: error.message }
  }
  return { data: (data || []) as AuditoriaRegistro[], error: null }
}
