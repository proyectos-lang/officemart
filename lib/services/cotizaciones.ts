import { createClient } from "@/lib/supabase/client"
import { getTenantStamp, isValidStamp, SESION_INVALIDA_ERROR } from "@/lib/services/tenant-stamp"
import { emitirCorrelativo, SERIES } from "@/lib/services/correlativos"
import { registrarAuditoria } from "@/lib/services/auditoria"
import { getHondurasNowISO, getHondurasTodayISODate } from "@/lib/utils/honduras-time"

/**
 * Cotizaciones (script officemart-006). Una cotización nace en Borrador, se
 * envía al cliente, se aprueba y se convierte en venta desde Nueva Venta
 * (`prepararConversionAVenta` deja el payload en sessionStorage; Nueva Venta
 * lo lee con `leerConversionPendiente`, factura y llama `marcarCotizacionFacturada`).
 * Las vencidas se marcan al listar (`marcarVencidas`).
 */

export const COTIZACIONES_FEATURE_PENDING =
  "Cotizaciones pendientes: aplica scripts/officemart-006-cotizaciones.sql en Supabase."

export type EstadoCotizacion = "Borrador" | "Enviada" | "Aprobada" | "Facturada" | "Vencida" | "Rechazada"

export const ESTADOS_COTIZACION: EstadoCotizacion[] = [
  "Borrador",
  "Enviada",
  "Aprobada",
  "Facturada",
  "Vencida",
  "Rechazada",
]

export interface CotizacionLinea {
  id?: number
  orden?: number
  producto_id: number | null
  descripcion: string
  cantidad: number
  precio_unitario: number
  /** % de descuento por línea (0–100). */
  descuento_linea: number
  subtotal: number
}

export interface CotizacionEncabezado {
  id: number
  numero: string
  cliente_id: number | null
  cliente_nombre: string | null
  vendedor_id: number | null
  punto_facturacion_id: number | null
  fecha: string
  vigencia_hasta: string | null
  estado: EstadoCotizacion
  aplica_impuesto: boolean
  porcentaje_impuesto: number
  descuento: number
  subtotal: number
  impuesto_total: number
  total: number
  notas: string | null
  condiciones: string | null
  motivo_rechazo: string | null
  venta_id: number | null
  orden_id: number | null
  usuario: string | null
  created_at: string
}

export interface CotizacionInput {
  cliente_id: number | null
  cliente_nombre: string
  vendedor_id?: number | null
  punto_facturacion_id?: number | null
  fecha?: string
  vigencia_hasta: string | null
  aplica_impuesto: boolean
  porcentaje_impuesto?: number
  descuento: number
  notas?: string | null
  condiciones?: string | null
  lineas: Omit<CotizacionLinea, "subtotal" | "id" | "orden">[]
}

function isMissingTable(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false
  const msg = (err.message || "").toLowerCase()
  return (
    err.code === "42P01" ||
    err.code === "PGRST205" ||
    msg.includes("schema cache") ||
    /relation .*cotizaciones.* does not exist/.test(msg)
  )
}

// ==================== FUNCIONES PURAS ====================

export interface TotalesCotizacion {
  lineas: CotizacionLinea[]
  subtotal: number
  descuentoMonto: number
  base: number
  impuesto: number
  total: number
}

/** Totales de una cotización: subtotal de líneas (con su % propio), descuento global, ISV. */
export function calcularTotalesCotizacion(
  lineas: Omit<CotizacionLinea, "subtotal">[],
  descuentoPct: number,
  aplicaIsv: boolean,
  isvPct = 15
): TotalesCotizacion {
  const conSubtotal: CotizacionLinea[] = lineas.map((l) => {
    const cant = Math.max(0, Number(l.cantidad) || 0)
    const precio = Math.max(0, Number(l.precio_unitario) || 0)
    const dl = Math.min(100, Math.max(0, Number(l.descuento_linea) || 0))
    return { ...l, cantidad: cant, precio_unitario: precio, descuento_linea: dl, subtotal: +(cant * precio * (1 - dl / 100)).toFixed(2) }
  })
  const subtotal = +conSubtotal.reduce((a, l) => a + l.subtotal, 0).toFixed(2)
  const pct = Math.min(100, Math.max(0, Number(descuentoPct) || 0))
  const descuentoMonto = +(subtotal * (pct / 100)).toFixed(2)
  const base = +(subtotal - descuentoMonto).toFixed(2)
  const impuesto = aplicaIsv ? +(base * ((Number(isvPct) || 0) / 100)).toFixed(2) : 0
  const total = +(base + impuesto).toFixed(2)
  return { lineas: conSubtotal, subtotal, descuentoMonto, base, impuesto, total }
}

const TRANSICIONES: Record<EstadoCotizacion, EstadoCotizacion[]> = {
  Borrador: ["Enviada", "Aprobada", "Rechazada"],
  Enviada: ["Aprobada", "Rechazada", "Borrador"],
  Aprobada: ["Facturada", "Rechazada", "Enviada"],
  Vencida: ["Enviada", "Rechazada"],
  Rechazada: ["Borrador"],
  Facturada: [],
}

/** true si el cambio de estado está permitido. */
export function puedeTransicionar(de: EstadoCotizacion, a: EstadoCotizacion): boolean {
  if (de === a) return false
  return (TRANSICIONES[de] || []).includes(a)
}

/** Estados desde los que se puede convertir en venta. */
export function esConvertible(estado: EstadoCotizacion): boolean {
  return estado === "Borrador" || estado === "Enviada" || estado === "Aprobada"
}

/** Solo se edita mientras no se ha decidido nada sobre ella. */
export function esEditable(estado: EstadoCotizacion): boolean {
  return estado === "Borrador" || estado === "Enviada"
}

/** Vencida = pasó la vigencia y sigue abierta (Borrador/Enviada). */
export function estaVencida(
  cot: Pick<CotizacionEncabezado, "estado" | "vigencia_hasta">,
  hoyISO: string
): boolean {
  if (!cot.vigencia_hasta) return false
  if (cot.estado !== "Borrador" && cot.estado !== "Enviada") return false
  return cot.vigencia_hasta.slice(0, 10) < hoyISO.slice(0, 10)
}

/** Días que faltan para vencer (negativo si ya venció; null sin vigencia). */
export function diasParaVencer(vigenciaHasta: string | null | undefined, hoyISO: string): number | null {
  if (!vigenciaHasta) return null
  const a = new Date(`${vigenciaHasta.slice(0, 10)}T00:00:00Z`).getTime()
  const b = new Date(`${hoyISO.slice(0, 10)}T00:00:00Z`).getTime()
  if (Number.isNaN(a) || Number.isNaN(b)) return null
  return Math.round((a - b) / 86_400_000)
}

/** Fecha ISO (YYYY-MM-DD) sumando días a hoy (vigencia por defecto). */
export function fechaMasDias(hoyISO: string, dias: number): string {
  const d = new Date(`${hoyISO.slice(0, 10)}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + dias)
  return d.toISOString().slice(0, 10)
}

// ==================== LECTURA ====================

function normalizar(r: Record<string, unknown>): CotizacionEncabezado {
  return {
    id: r.id as number,
    numero: String(r.numero ?? ""),
    cliente_id: (r.cliente_id as number) ?? null,
    cliente_nombre: (r.cliente_nombre as string) ?? null,
    vendedor_id: (r.vendedor_id as number) ?? null,
    punto_facturacion_id: (r.punto_facturacion_id as number) ?? null,
    fecha: String(r.fecha ?? ""),
    vigencia_hasta: (r.vigencia_hasta as string) ?? null,
    estado: (r.estado as EstadoCotizacion) ?? "Borrador",
    aplica_impuesto: Boolean(r.aplica_impuesto),
    porcentaje_impuesto: Number(r.porcentaje_impuesto ?? 15),
    descuento: Number(r.descuento ?? 0),
    subtotal: Number(r.subtotal ?? 0),
    impuesto_total: Number(r.impuesto_total ?? 0),
    total: Number(r.total ?? 0),
    notas: (r.notas as string) ?? null,
    condiciones: (r.condiciones as string) ?? null,
    motivo_rechazo: (r.motivo_rechazo as string) ?? null,
    venta_id: (r.venta_id as number) ?? null,
    orden_id: (r.orden_id as number) ?? null,
    usuario: (r.usuario as string) ?? null,
    created_at: String(r.created_at ?? ""),
  }
}

export async function getCotizaciones(
  opts: { estado?: EstadoCotizacion | "todas"; clienteId?: number; limit?: number } = {}
): Promise<{ data: CotizacionEncabezado[]; error: string | null }> {
  const supabase = createClient()
  if (!supabase) return { data: [], error: "Cliente no disponible" }
  try {
    // Primero se marcan las vencidas para que el listado ya venga correcto.
    await marcarVencidas()
    let q = supabase
      .from("cotizaciones_encabezado")
      .select("*")
      .order("fecha", { ascending: false })
      .order("id", { ascending: false })
      .limit(opts.limit ?? 1000)
    if (opts.estado && opts.estado !== "todas") q = q.eq("estado", opts.estado)
    if (opts.clienteId != null) q = q.eq("cliente_id", opts.clienteId)
    const { data, error } = await q
    if (error) {
      if (isMissingTable(error)) return { data: [], error: COTIZACIONES_FEATURE_PENDING }
      return { data: [], error: error.message }
    }
    return { data: (data || []).map((r) => normalizar(r as Record<string, unknown>)), error: null }
  } catch (err) {
    console.error("[cotizaciones] get:", err)
    return { data: [], error: "Error de conexión" }
  }
}

export async function getCotizacion(
  id: number
): Promise<{ data: { encabezado: CotizacionEncabezado; lineas: CotizacionLinea[] } | null; error: string | null }> {
  const supabase = createClient()
  if (!supabase) return { data: null, error: "Cliente no disponible" }
  try {
    const [encRes, detRes] = await Promise.all([
      supabase.from("cotizaciones_encabezado").select("*").eq("id", id).maybeSingle(),
      supabase.from("cotizaciones_detalle").select("*").eq("cotizacion_id", id).order("orden", { ascending: true }),
    ])
    if (encRes.error) {
      if (isMissingTable(encRes.error)) return { data: null, error: COTIZACIONES_FEATURE_PENDING }
      return { data: null, error: encRes.error.message }
    }
    if (!encRes.data) return { data: null, error: "La cotización no existe" }
    const lineas: CotizacionLinea[] = (detRes.data || []).map((d: Record<string, unknown>) => ({
      id: d.id as number,
      orden: Number(d.orden ?? 0),
      producto_id: (d.producto_id as number) ?? null,
      descripcion: String(d.descripcion ?? ""),
      cantidad: Number(d.cantidad ?? 0),
      precio_unitario: Number(d.precio_unitario ?? 0),
      descuento_linea: Number(d.descuento_linea ?? 0),
      subtotal: Number(d.subtotal ?? 0),
    }))
    return { data: { encabezado: normalizar(encRes.data as Record<string, unknown>), lineas }, error: null }
  } catch (err) {
    console.error("[cotizaciones] getCotizacion:", err)
    return { data: null, error: "Error de conexión" }
  }
}

/** Marca como Vencidas las Borrador/Enviada cuya vigencia ya pasó (best-effort). */
export async function marcarVencidas(): Promise<number> {
  const supabase = createClient()
  if (!supabase) return 0
  try {
    const hoy = getHondurasTodayISODate()
    const { data, error } = await supabase
      .from("cotizaciones_encabezado")
      .update({ estado: "Vencida", updated_at: new Date().toISOString() })
      .in("estado", ["Borrador", "Enviada"])
      .lt("vigencia_hasta", hoy)
      .select("id")
    if (error) return 0
    return (data || []).length
  } catch {
    return 0
  }
}

/** Cotizaciones abiertas (Enviada/Aprobada) que vencen en `dias` días o menos (badge). */
export async function contarPorVencer(dias = 3): Promise<number> {
  const supabase = createClient()
  if (!supabase) return 0
  try {
    const hoy = getHondurasTodayISODate()
    const { count, error } = await supabase
      .from("cotizaciones_encabezado")
      .select("id", { count: "exact", head: true })
      .in("estado", ["Enviada", "Aprobada"])
      .gte("vigencia_hasta", hoy)
      .lte("vigencia_hasta", fechaMasDias(hoy, dias))
    if (error) return 0
    return count || 0
  } catch {
    return 0
  }
}

// ==================== ESCRITURA ====================

function validarInput(input: CotizacionInput): string | null {
  if (!input.cliente_nombre?.trim() && input.cliente_id == null) return "Indica el cliente o el nombre del prospecto."
  const lineas = (input.lineas || []).filter((l) => (Number(l.cantidad) || 0) > 0)
  if (lineas.length === 0) return "Agrega al menos una línea con cantidad."
  if (lineas.some((l) => !l.descripcion?.trim())) return "Toda línea necesita descripción."
  return null
}

async function siguienteNumero(supabase: NonNullable<ReturnType<typeof createClient>>): Promise<string> {
  const { numero } = await emitirCorrelativo(supabase, SERIES.COTIZACION, "COT-", 4)
  if (numero) return numero
  // Respaldo (RPC ausente): COUNT+1 — puede repetir bajo concurrencia.
  const { count } = await supabase.from("cotizaciones_encabezado").select("id", { count: "exact", head: true })
  return `COT-${String((count || 0) + 1).padStart(4, "0")}`
}

async function insertarDetalle(
  supabase: NonNullable<ReturnType<typeof createClient>>,
  razonSocialId: number,
  cotizacionId: number,
  lineas: CotizacionLinea[]
): Promise<string | null> {
  if (lineas.length === 0) return null
  const filas = lineas.map((l, i) => ({
    razon_social_id: razonSocialId,
    cotizacion_id: cotizacionId,
    orden: i,
    producto_id: l.producto_id ?? null,
    descripcion: l.descripcion.trim(),
    cantidad: l.cantidad,
    precio_unitario: l.precio_unitario,
    descuento_linea: l.descuento_linea,
    subtotal: l.subtotal,
  }))
  const { error } = await supabase.from("cotizaciones_detalle").insert(filas)
  return error ? error.message : null
}

export async function crearCotizacion(
  input: CotizacionInput
): Promise<{ data: CotizacionEncabezado | null; error: string | null }> {
  const supabase = createClient()
  if (!supabase) return { data: null, error: "Cliente no disponible" }
  const stamp = await getTenantStamp(supabase)
  if (!isValidStamp(stamp)) return { data: null, error: SESION_INVALIDA_ERROR }
  const invalido = validarInput(input)
  if (invalido) return { data: null, error: invalido }

  const tot = calcularTotalesCotizacion(
    input.lineas.filter((l) => (Number(l.cantidad) || 0) > 0),
    input.descuento,
    input.aplica_impuesto,
    input.porcentaje_impuesto ?? 15
  )
  try {
    const numero = await siguienteNumero(supabase)
    const { data, error } = await supabase
      .from("cotizaciones_encabezado")
      .insert({
        numero,
        cliente_id: input.cliente_id ?? null,
        cliente_nombre: input.cliente_nombre?.trim() || null,
        vendedor_id: input.vendedor_id ?? null,
        punto_facturacion_id: input.punto_facturacion_id ?? null,
        fecha: input.fecha || getHondurasNowISO(),
        vigencia_hasta: input.vigencia_hasta || null,
        estado: "Borrador",
        aplica_impuesto: input.aplica_impuesto,
        porcentaje_impuesto: input.porcentaje_impuesto ?? 15,
        descuento: Math.max(0, Number(input.descuento) || 0),
        subtotal: tot.subtotal,
        impuesto_total: tot.impuesto,
        total: tot.total,
        notas: input.notas?.trim() || null,
        condiciones: input.condiciones?.trim() || null,
        ...stamp,
      })
      .select("*")
      .single()
    if (error) {
      if (isMissingTable(error)) return { data: null, error: COTIZACIONES_FEATURE_PENDING }
      return { data: null, error: error.message }
    }
    const detErr = await insertarDetalle(supabase, Number(stamp.razon_social_id), data.id, tot.lineas)
    if (detErr) {
      await supabase.from("cotizaciones_encabezado").delete().eq("id", data.id)
      return { data: null, error: detErr }
    }
    await registrarAuditoria(supabase, stamp, { entidad: "cotizacion", entidad_id: data.id, accion: "crear", despues: { numero, total: tot.total } })
    return { data: normalizar(data as Record<string, unknown>), error: null }
  } catch (err) {
    console.error("[cotizaciones] crear:", err)
    return { data: null, error: "Error de conexión" }
  }
}

/** Reemplaza encabezado y líneas (solo Borrador/Enviada). */
export async function actualizarCotizacion(
  id: number,
  input: CotizacionInput
): Promise<{ data: CotizacionEncabezado | null; error: string | null }> {
  const supabase = createClient()
  if (!supabase) return { data: null, error: "Cliente no disponible" }
  const stamp = await getTenantStamp(supabase)
  if (!isValidStamp(stamp)) return { data: null, error: SESION_INVALIDA_ERROR }
  const invalido = validarInput(input)
  if (invalido) return { data: null, error: invalido }

  const { data: actual } = await supabase.from("cotizaciones_encabezado").select("estado").eq("id", id).maybeSingle()
  if (!actual) return { data: null, error: "La cotización no existe" }
  if (!esEditable(actual.estado as EstadoCotizacion)) {
    return { data: null, error: `Una cotización ${actual.estado} no se puede editar. Duplícala para cambiarla.` }
  }

  const tot = calcularTotalesCotizacion(
    input.lineas.filter((l) => (Number(l.cantidad) || 0) > 0),
    input.descuento,
    input.aplica_impuesto,
    input.porcentaje_impuesto ?? 15
  )
  try {
    const { data, error } = await supabase
      .from("cotizaciones_encabezado")
      .update({
        cliente_id: input.cliente_id ?? null,
        cliente_nombre: input.cliente_nombre?.trim() || null,
        vendedor_id: input.vendedor_id ?? null,
        punto_facturacion_id: input.punto_facturacion_id ?? null,
        vigencia_hasta: input.vigencia_hasta || null,
        aplica_impuesto: input.aplica_impuesto,
        porcentaje_impuesto: input.porcentaje_impuesto ?? 15,
        descuento: Math.max(0, Number(input.descuento) || 0),
        subtotal: tot.subtotal,
        impuesto_total: tot.impuesto,
        total: tot.total,
        notas: input.notas?.trim() || null,
        condiciones: input.condiciones?.trim() || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select("*")
      .single()
    if (error) return { data: null, error: error.message }
    const { error: delErr } = await supabase.from("cotizaciones_detalle").delete().eq("cotizacion_id", id)
    if (delErr) return { data: null, error: delErr.message }
    const detErr = await insertarDetalle(supabase, Number(stamp.razon_social_id), id, tot.lineas)
    if (detErr) return { data: null, error: detErr }
    await registrarAuditoria(supabase, stamp, { entidad: "cotizacion", entidad_id: id, accion: "editar", despues: { total: tot.total } })
    return { data: normalizar(data as Record<string, unknown>), error: null }
  } catch (err) {
    console.error("[cotizaciones] actualizar:", err)
    return { data: null, error: "Error de conexión" }
  }
}

export async function cambiarEstadoCotizacion(
  id: number,
  nuevo: EstadoCotizacion,
  opts: { motivo?: string; vigencia_hasta?: string | null } = {}
): Promise<{ error: string | null }> {
  const supabase = createClient()
  if (!supabase) return { error: "Cliente no disponible" }
  const stamp = await getTenantStamp(supabase)
  if (!isValidStamp(stamp)) return { error: SESION_INVALIDA_ERROR }
  const { data: actual } = await supabase.from("cotizaciones_encabezado").select("estado, vigencia_hasta").eq("id", id).maybeSingle()
  if (!actual) return { error: "La cotización no existe" }
  const de = actual.estado as EstadoCotizacion
  if (!puedeTransicionar(de, nuevo)) return { error: `No se puede pasar de ${de} a ${nuevo}.` }
  if (nuevo === "Rechazada" && !opts.motivo?.trim()) return { error: "Indica el motivo del rechazo." }
  if (de === "Vencida" && nuevo === "Enviada" && !opts.vigencia_hasta) {
    return { error: "Para reactivar una cotización vencida indica la nueva vigencia." }
  }
  const cambios: Record<string, unknown> = { estado: nuevo, updated_at: new Date().toISOString() }
  if (nuevo === "Rechazada") cambios.motivo_rechazo = opts.motivo!.trim()
  if (opts.vigencia_hasta) cambios.vigencia_hasta = opts.vigencia_hasta
  const { error } = await supabase.from("cotizaciones_encabezado").update(cambios).eq("id", id)
  if (error) return { error: error.message }
  await registrarAuditoria(supabase, stamp, {
    entidad: "cotizacion",
    entidad_id: id,
    accion: `estado:${nuevo}`,
    motivo: opts.motivo,
    antes: { estado: de },
    despues: { estado: nuevo },
  })
  return { error: null }
}

/** Marca la cotización como Facturada con la venta creada (la llama Nueva Venta). */
export async function marcarCotizacionFacturada(id: number, ventaId: number): Promise<{ error: string | null }> {
  const supabase = createClient()
  if (!supabase) return { error: "Cliente no disponible" }
  const stamp = await getTenantStamp(supabase)
  if (!isValidStamp(stamp)) return { error: SESION_INVALIDA_ERROR }
  const { error } = await supabase
    .from("cotizaciones_encabezado")
    .update({ estado: "Facturada", venta_id: ventaId, updated_at: new Date().toISOString() })
    .eq("id", id)
    .in("estado", ["Borrador", "Enviada", "Aprobada", "Vencida"])
  if (error) return { error: error.message }
  await registrarAuditoria(supabase, stamp, { entidad: "cotizacion", entidad_id: id, accion: "facturar", despues: { venta_id: ventaId } })
  return { error: null }
}

/** Enlaza la orden de trabajo creada desde la cotización (best-effort). */
export async function vincularOrdenCotizacion(id: number, ordenId: number): Promise<{ error: string | null }> {
  const supabase = createClient()
  if (!supabase) return { error: "Cliente no disponible" }
  const { error } = await supabase
    .from("cotizaciones_encabezado")
    .update({ orden_id: ordenId, updated_at: new Date().toISOString() })
    .eq("id", id)
  return { error: error ? error.message : null }
}

/** Copia una cotización como nuevo Borrador (vigencia = hoy + 15 días). */
export async function duplicarCotizacion(
  id: number
): Promise<{ data: CotizacionEncabezado | null; error: string | null }> {
  const { data, error } = await getCotizacion(id)
  if (error || !data) return { data: null, error: error || "La cotización no existe" }
  const { encabezado: e, lineas } = data
  return crearCotizacion({
    cliente_id: e.cliente_id,
    cliente_nombre: e.cliente_nombre || "",
    vendedor_id: e.vendedor_id,
    punto_facturacion_id: e.punto_facturacion_id,
    vigencia_hasta: fechaMasDias(getHondurasTodayISODate(), 15),
    aplica_impuesto: e.aplica_impuesto,
    porcentaje_impuesto: e.porcentaje_impuesto,
    descuento: e.descuento,
    notas: e.notas,
    condiciones: e.condiciones,
    lineas: lineas.map(({ producto_id, descripcion, cantidad, precio_unitario, descuento_linea }) => ({
      producto_id,
      descripcion,
      cantidad,
      precio_unitario,
      descuento_linea,
    })),
  })
}

/** Borra físicamente solo un Borrador (lo demás se rechaza, para conservar historia). */
export async function eliminarCotizacion(id: number): Promise<{ error: string | null }> {
  const supabase = createClient()
  if (!supabase) return { error: "Cliente no disponible" }
  const { data: actual } = await supabase.from("cotizaciones_encabezado").select("estado").eq("id", id).maybeSingle()
  if (!actual) return { error: "La cotización no existe" }
  if (actual.estado !== "Borrador") return { error: "Solo se elimina un Borrador; las demás se rechazan." }
  const { error } = await supabase.from("cotizaciones_encabezado").delete().eq("id", id)
  return { error: error ? error.message : null }
}

// ==================== CONVERSIÓN A VENTA ====================

export const COTIZACION_A_VENTA_KEY = "easycount:cotizacion-a-venta"

export interface ConversionCotizacion {
  cotizacion_id: number
  numero: string
  cliente_id: number | null
  aplica_impuesto: boolean
  descuento: number
  lineas: { producto_id: number | null; descripcion: string; cantidad: number; precio_unitario: number; descuento_linea: number }[]
}

/** Deja la cotización lista para que Nueva Venta la cargue (sessionStorage). */
export function prepararConversionAVenta(enc: CotizacionEncabezado, lineas: CotizacionLinea[]): boolean {
  const payload: ConversionCotizacion = {
    cotizacion_id: enc.id,
    numero: enc.numero,
    cliente_id: enc.cliente_id,
    aplica_impuesto: enc.aplica_impuesto,
    descuento: enc.descuento,
    lineas: lineas.map((l) => ({
      producto_id: l.producto_id,
      descripcion: l.descripcion,
      cantidad: l.cantidad,
      precio_unitario: l.precio_unitario,
      descuento_linea: l.descuento_linea,
    })),
  }
  try {
    sessionStorage.setItem(COTIZACION_A_VENTA_KEY, JSON.stringify(payload))
    return true
  } catch {
    return false
  }
}

/** Lee y CONSUME la conversión pendiente (null si no hay). */
export function leerConversionPendiente(): ConversionCotizacion | null {
  try {
    const raw = sessionStorage.getItem(COTIZACION_A_VENTA_KEY)
    if (!raw) return null
    sessionStorage.removeItem(COTIZACION_A_VENTA_KEY)
    const obj = JSON.parse(raw) as ConversionCotizacion
    if (!obj || typeof obj.cotizacion_id !== "number" || !Array.isArray(obj.lineas)) return null
    return obj
  } catch {
    return null
  }
}
