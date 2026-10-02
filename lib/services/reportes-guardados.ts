import { createClient, isSupabaseConfigured } from "@/lib/supabase/client"
import { getTenantStamp, isValidStamp, SESION_INVALIDA_ERROR } from "@/lib/services/tenant-stamp"
import { getHondurasNowISO } from "@/lib/utils/honduras-time"
import type { ConfigReporte } from "@/lib/reporteria/motor"

/**
 * Reportes guardados de Reportería (script officemart-020). Si la tabla aún
 * no existe, se guardan en este navegador (localStorage) y se avisa.
 */

export const REPORTES_FEATURE_PENDING = "Los reportes se están guardando solo en este navegador. Aplica scripts/officemart-020-reporteria.sql en Supabase para guardarlos para toda la empresa."

export interface ReporteGuardado {
  id: number
  nombre: string
  descripcion: string | null
  fuente: string
  config: ConfigReporte
  favorito: boolean
  exportaciones: number
  ultima_exportacion: string | null
  usuario: string | null
  created_at: string
  updated_at: string | null
  local?: boolean
}

function isMissingTable(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false
  const msg = (err.message || "").toLowerCase()
  return err.code === "42P01" || err.code === "PGRST205" || (msg.includes("schema cache") && !msg.includes("relationship")) || /relation .*reportes_guardados.* does not exist/.test(msg)
}

const CLAVE_LOCAL = "officemart_reportes_guardados"
function leerLocal(): ReporteGuardado[] {
  try {
    return JSON.parse(localStorage.getItem(CLAVE_LOCAL) || "[]") as ReporteGuardado[]
  } catch {
    return []
  }
}
function escribirLocal(lista: ReporteGuardado[]) {
  try {
    localStorage.setItem(CLAVE_LOCAL, JSON.stringify(lista))
  } catch {
    /* sin almacenamiento */
  }
}

function mapear(r: Record<string, unknown>): ReporteGuardado {
  return {
    id: Number(r.id), nombre: String(r.nombre ?? ""), descripcion: (r.descripcion as string) ?? null, fuente: String(r.fuente ?? ""),
    config: r.config as ConfigReporte, favorito: r.favorito === true, exportaciones: Number(r.exportaciones || 0),
    ultima_exportacion: (r.ultima_exportacion as string) ?? null, usuario: (r.usuario as string) ?? null,
    created_at: String(r.created_at ?? ""), updated_at: (r.updated_at as string) ?? null,
  }
}

export async function getReportesGuardados(): Promise<{ data: ReporteGuardado[]; error: string | null; local: boolean }> {
  if (!isSupabaseConfigured()) return { data: leerLocal(), error: null, local: true }
  const supabase = createClient()
  if (!supabase) return { data: [], error: "Cliente no disponible", local: false }
  const { data, error } = await supabase.from("reportes_guardados").select("*").order("favorito", { ascending: false }).order("nombre")
  if (error) {
    if (isMissingTable(error)) return { data: leerLocal().map((r) => ({ ...r, local: true })), error: null, local: true }
    return { data: [], error: error.message, local: false }
  }
  return { data: (data || []).map((r) => mapear(r as Record<string, unknown>)), error: null, local: false }
}

export async function guardarReporte(input: { id?: number | null; nombre: string; descripcion?: string | null; config: ConfigReporte; favorito?: boolean }): Promise<{ data: ReporteGuardado | null; error: string | null }> {
  const nombre = (input.nombre || "").trim()
  if (!nombre) return { data: null, error: "Ponle un nombre al reporte" }
  const ahora = getHondurasNowISO()
  const payload = { nombre, descripcion: (input.descripcion || "").trim() || null, fuente: input.config.fuente, config: input.config, favorito: input.favorito === true }
  const supabase = createClient()
  if (supabase) {
    const stamp = await getTenantStamp(supabase)
    if (!isValidStamp(stamp)) return { data: null, error: SESION_INVALIDA_ERROR }
    const q = input.id != null && input.id > 0
      ? supabase.from("reportes_guardados").update({ ...payload, updated_at: ahora }).eq("id", input.id).select("*").single()
      : supabase.from("reportes_guardados").insert({ ...payload, razon_social_id: stamp.razon_social_id, usuario: stamp.usuario, created_at: ahora }).select("*").single()
    const { data, error } = await q
    if (!error) return { data: mapear(data as Record<string, unknown>), error: null }
    if (!isMissingTable(error)) return { data: null, error: error.message }
  }
  // Respaldo local
  const lista = leerLocal()
  const existente = input.id != null ? lista.find((r) => r.id === input.id) : undefined
  const r: ReporteGuardado = existente
    ? { ...existente, ...payload, updated_at: ahora }
    : { id: -Date.now(), ...payload, exportaciones: 0, ultima_exportacion: null, usuario: null, created_at: ahora, updated_at: null, local: true }
  escribirLocal(existente ? lista.map((x) => (x.id === r.id ? r : x)) : [...lista, r])
  return { data: r, error: null }
}

export async function eliminarReporte(id: number): Promise<{ success: boolean; error: string | null }> {
  if (id < 0) {
    escribirLocal(leerLocal().filter((r) => r.id !== id))
    return { success: true, error: null }
  }
  const supabase = createClient()
  if (!supabase) return { success: false, error: "Cliente no disponible" }
  const { error } = await supabase.from("reportes_guardados").delete().eq("id", id)
  return { success: !error, error: error?.message ?? null }
}

/** Cuenta la exportación (best-effort). */
export async function registrarExportacion(r: ReporteGuardado): Promise<void> {
  const ahora = getHondurasNowISO()
  if (r.id < 0) {
    escribirLocal(leerLocal().map((x) => (x.id === r.id ? { ...x, exportaciones: x.exportaciones + 1, ultima_exportacion: ahora } : x)))
    return
  }
  const supabase = createClient()
  if (!supabase) return
  await supabase.from("reportes_guardados").update({ exportaciones: r.exportaciones + 1, ultima_exportacion: ahora }).eq("id", r.id)
}
