import { createClient, isSupabaseConfigured } from "@/lib/supabase/client"
import { getTenantStamp, isValidStamp, SESION_INVALIDA_ERROR } from "@/lib/services/tenant-stamp"
import { registrarAuditoria } from "@/lib/services/auditoria"
import { getHondurasNowISO } from "@/lib/utils/honduras-time"

// ==================== TIPOS ====================

export type TipoReclamo = "Producto" | "Precio" | "Entrega" | "Otro"
export type EstadoReclamo = "Abierto" | "Resuelto" | "Rechazado"
export type ResultadoReclamo = "Anulacion" | "Devolucion" | "Sin cambio"

export interface Reclamo {
  id: number
  venta_id: number
  cliente_id: number | null
  tipo: TipoReclamo | string
  descripcion: string
  estado: EstadoReclamo | string
  resolucion: string | null
  resultado: ResultadoReclamo | string | null
  devolucion_id: number | null
  resuelto_at: string | null
  resuelto_por: string | null
  usuario: string | null
  created_at: string
  // joins
  numero_factura?: string
  cliente_nombre?: string
  total_venta?: number
}

export const RECLAMOS_FEATURE_PENDING =
  "Reclamos pendientes: aplica scripts/officemart-003-anulacion-recibos.sql en Supabase."

function isMissingTable(err: { message?: string; code?: string } | null): boolean {
  if (!err) return false
  const msg = (err.message || "").toLowerCase()
  return (
    err.code === "42P01" ||
    err.code === "PGRST205" ||
    /relation .*ventas_reclamos.* does not exist/.test(msg) ||
    msg.includes("could not find the table")
  )
}

// ==================== LECTURA ====================

export async function getReclamos(
  opts: { estado?: EstadoReclamo | "todos"; ventaId?: number; limit?: number } = {}
): Promise<{ data: Reclamo[]; error: string | null }> {
  if (!isSupabaseConfigured()) return { data: [], error: null }
  const supabase = createClient()
  if (!supabase) return { data: [], error: "Cliente no disponible" }

  let q = supabase
    .from("ventas_reclamos")
    .select("*, ventas_encabezado:venta_id (numero_factura, total_venta), clientes:cliente_id (nombre)")
    .order("created_at", { ascending: false })
    .limit(opts.limit ?? 300)
  if (opts.estado && opts.estado !== "todos") q = q.eq("estado", opts.estado)
  if (opts.ventaId != null) q = q.eq("venta_id", opts.ventaId)

  const { data, error } = await q
  if (error) {
    if (isMissingTable(error)) return { data: [], error: RECLAMOS_FEATURE_PENDING }
    return { data: [], error: error.message }
  }
  const rows = (data || []).map((r: Record<string, unknown>) => {
    const ve = Array.isArray(r.ventas_encabezado) ? r.ventas_encabezado[0] : r.ventas_encabezado
    const cli = Array.isArray(r.clientes) ? r.clientes[0] : r.clientes
    return {
      ...(r as unknown as Reclamo),
      numero_factura: (ve as { numero_factura?: string } | null)?.numero_factura || "",
      total_venta: Number((ve as { total_venta?: number } | null)?.total_venta || 0),
      cliente_nombre: (cli as { nombre?: string } | null)?.nombre || "",
    }
  })
  return { data: rows, error: null }
}

export async function contarReclamosAbiertos(): Promise<number> {
  if (!isSupabaseConfigured()) return 0
  const supabase = createClient()
  if (!supabase) return 0
  const { count, error } = await supabase
    .from("ventas_reclamos")
    .select("id", { count: "exact", head: true })
    .eq("estado", "Abierto")
  if (error) return 0
  return count || 0
}

// ==================== ESCRITURA ====================

export async function crearReclamo(input: {
  venta_id: number
  cliente_id?: number | null
  tipo: TipoReclamo
  descripcion: string
}): Promise<{ data: { id: number } | null; error: string | null }> {
  const descripcion = (input.descripcion || "").trim()
  if (!descripcion) return { data: null, error: "Describe el reclamo" }
  const supabase = createClient()
  if (!supabase) return { data: null, error: "Cliente no disponible" }
  const stamp = await getTenantStamp(supabase)
  if (!isValidStamp(stamp)) return { data: null, error: SESION_INVALIDA_ERROR }

  const { data, error } = await supabase
    .from("ventas_reclamos")
    .insert({
      venta_id: input.venta_id,
      cliente_id: input.cliente_id ?? null,
      tipo: input.tipo,
      descripcion,
      estado: "Abierto",
      ...stamp,
    })
    .select("id")
    .single()
  if (error) {
    if (isMissingTable(error)) return { data: null, error: RECLAMOS_FEATURE_PENDING }
    return { data: null, error: error.message }
  }
  await registrarAuditoria(supabase, stamp, { entidad: "reclamo", entidad_id: data.id, accion: "crear", despues: { venta_id: input.venta_id, tipo: input.tipo, descripcion } })
  return { data: { id: Number(data.id) }, error: null }
}

/**
 * Cierra un reclamo con su resolución. `resultado` documenta qué se hizo; la
 * anulación o devolución en sí se ejecutan desde sus módulos (Historial /
 * Devoluciones) y pueden referenciar el reclamo.
 */
export async function resolverReclamo(
  id: number,
  input: { estado: "Resuelto" | "Rechazado"; resolucion: string; resultado?: ResultadoReclamo | null; devolucion_id?: number | null }
): Promise<{ error: string | null }> {
  const resolucion = (input.resolucion || "").trim()
  if (!resolucion) return { error: "Escribe la resolución" }
  const supabase = createClient()
  if (!supabase) return { error: "Cliente no disponible" }
  const stamp = await getTenantStamp(supabase)
  if (!isValidStamp(stamp)) return { error: SESION_INVALIDA_ERROR }

  const { error } = await supabase
    .from("ventas_reclamos")
    .update({
      estado: input.estado,
      resolucion,
      resultado: input.resultado ?? (input.estado === "Rechazado" ? "Sin cambio" : null),
      devolucion_id: input.devolucion_id ?? null,
      resuelto_at: getHondurasNowISO(),
      resuelto_por: stamp.usuario,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
  if (error) return { error: error.message }
  await registrarAuditoria(supabase, stamp, { entidad: "reclamo", entidad_id: id, accion: input.estado === "Resuelto" ? "resolver" : "rechazar", motivo: resolucion })
  return { error: null }
}

export async function reabrirReclamo(id: number): Promise<{ error: string | null }> {
  const supabase = createClient()
  if (!supabase) return { error: "Cliente no disponible" }
  const { error } = await supabase
    .from("ventas_reclamos")
    .update({ estado: "Abierto", resuelto_at: null, resuelto_por: null, updated_at: new Date().toISOString() })
    .eq("id", id)
  return { error: error ? error.message : null }
}
