import type { SupabaseClient } from "@supabase/supabase-js"
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client"
import { getTenantStamp, isValidStamp, SESION_INVALIDA_ERROR } from "@/lib/services/tenant-stamp"
import { registrarMovimientoCaja, getSesionAbierta } from "@/lib/services/caja-chica"
import { registrarMovimientoCuenta, recalcCadenaSaldoCuenta } from "@/lib/services/cuentas"
import { emitirCorrelativo, SERIES } from "@/lib/services/correlativos"
import { registrarAuditoria } from "@/lib/services/auditoria"
import { getHondurasNowISO } from "@/lib/utils/honduras-time"
import { ejecutarVigentes } from "@/lib/services/ventas-filtros"

// ==================== TIPOS ====================

export interface AplicacionRecibo {
  venta_id: number
  monto: number
}

export interface ReciboCobro {
  id: number
  numero_recibo: string
  cliente_id: number
  cliente_nombre?: string
  fecha: string
  monto_total: number
  metodo_pago: "Efectivo" | "Banco" | "Otro" | string
  cuenta_id: number | null
  referencia: string | null
  concepto: string | null
  anulado_at: string | null
  motivo_anulacion: string | null
  usuario: string | null
  /** Facturas cubiertas (join a pagos_ventas + ventas_encabezado). */
  aplicaciones?: { venta_id: number; numero_factura: string; monto: number }[]
}

export const RECIBOS_FEATURE_PENDING =
  "Recibos de cobro pendientes: aplica scripts/officemart-003-anulacion-recibos.sql en Supabase."

function isMissingTable(err: { message?: string; code?: string } | null): boolean {
  if (!err) return false
  const msg = (err.message || "").toLowerCase()
  return (
    err.code === "42P01" ||
    err.code === "PGRST205" ||
    /relation .*recibos_cobro.* does not exist/.test(msg) ||
    msg.includes("could not find the table")
  )
}

// ==================== PURAS ====================

/**
 * Distribuye un monto entre facturas con saldo, de la más antigua a la más
 * reciente (FIFO). Devuelve solo las aplicaciones con monto > 0.
 */
export function distribuirCobro(
  facturas: { venta_id: number; saldo: number; fecha: string }[],
  monto: number
): AplicacionRecibo[] {
  let restante = +Number(monto || 0).toFixed(2)
  if (restante <= 0) return []
  const ordenadas = [...facturas]
    .filter((f) => Number(f.saldo) > 0.005)
    .sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : a.venta_id - b.venta_id))
  const out: AplicacionRecibo[] = []
  for (const f of ordenadas) {
    if (restante <= 0.005) break
    const aplicar = +Math.min(restante, Number(f.saldo)).toFixed(2)
    out.push({ venta_id: f.venta_id, monto: aplicar })
    restante = +(restante - aplicar).toFixed(2)
  }
  return out
}

/**
 * Valida las aplicaciones contra los saldos conocidos. Devuelve el mensaje de
 * error o null si todo está bien.
 */
export function validarAplicaciones(
  aplicaciones: AplicacionRecibo[],
  saldos: Map<number, number>
): string | null {
  const validas = aplicaciones.filter((a) => Number(a.monto) > 0)
  if (validas.length === 0) return "Indica al menos una factura con monto mayor a 0"
  const vistas = new Set<number>()
  for (const a of validas) {
    if (vistas.has(a.venta_id)) return "Hay una factura repetida en el recibo"
    vistas.add(a.venta_id)
    const saldo = saldos.get(a.venta_id)
    if (saldo == null) return `La factura #${a.venta_id} no tiene saldo pendiente o no es del cliente`
    if (Number(a.monto) > saldo + 0.005) {
      return `El monto aplicado a la factura #${a.venta_id} (${a.monto.toFixed(2)}) supera su saldo (${saldo.toFixed(2)})`
    }
  }
  return null
}

/** Nuevo valorpago/estado_pago de una factura tras un abono (pura). */
export function aplicarAbono(
  totalVenta: number,
  valorpagoActual: number,
  monto: number
): { valorpago: number; estado_pago: "Pendiente" | "Parcial" | "Pagado" } {
  const valorpago = +(Number(valorpagoActual || 0) + Number(monto || 0)).toFixed(2)
  const total = Number(totalVenta || 0)
  const estado_pago: "Pendiente" | "Parcial" | "Pagado" =
    valorpago <= 0 ? "Pendiente" : valorpago >= total - 0.005 ? "Pagado" : "Parcial"
  return { valorpago, estado_pago }
}

/** Suma de lo cobrado (pago inicial + abonos) para reconstruir valorpago. */
export function recalcularValorpago(
  totalVenta: number,
  pagosIniciales: { monto_bruto?: number | null }[],
  abonos: { monto?: number | null }[]
): { valorpago: number; estado_pago: "Pendiente" | "Parcial" | "Pagado" } {
  const inicial = pagosIniciales.reduce((a, p) => a + Number(p.monto_bruto || 0), 0)
  const abonado = abonos.reduce((a, p) => a + Number(p.monto || 0), 0)
  return aplicarAbono(totalVenta, 0, inicial + abonado)
}

// ==================== ESCRITURA ====================

/**
 * Registra un recibo de cobro que cubre una o varias facturas del cliente:
 * UN movimiento de tesorería (caja o banco, ref_tipo='recibo') + un abono en
 * `pagos_ventas` por factura (con recibo_id) + actualización de valorpago /
 * estado_pago de cada factura.
 */
export async function registrarReciboCobro(input: {
  cliente_id: number
  metodo_pago: "Efectivo" | "Banco" | "Otro"
  cuenta_id?: number | null
  referencia?: string | null
  concepto?: string | null
  aplicaciones: AplicacionRecibo[]
}): Promise<{ data: { id: number; numero_recibo: string } | null; error: string | null }> {
  if (!isSupabaseConfigured()) return { data: null, error: "Supabase no configurado" }
  const supabase = createClient()
  if (!supabase) return { data: null, error: "Cliente no disponible" }
  const stamp = await getTenantStamp(supabase)
  if (!isValidStamp(stamp)) return { data: null, error: SESION_INVALIDA_ERROR }

  const aplicaciones = input.aplicaciones
    .map((a) => ({ venta_id: Number(a.venta_id), monto: +Number(a.monto || 0).toFixed(2) }))
    .filter((a) => a.monto > 0)
  if (aplicaciones.length === 0) return { data: null, error: "Indica al menos una factura con monto mayor a 0" }
  if (input.metodo_pago === "Banco" && !input.cuenta_id) return { data: null, error: "Selecciona la cuenta bancaria del cobro" }
  if (input.metodo_pago === "Efectivo") {
    const { data: sesion, error: sesErr } = await getSesionAbierta()
    if (!sesErr && !sesion?.id) return { data: null, error: "Debes abrir la caja chica para cobrar en efectivo" }
  }

  // 1) Facturas vigentes del cliente con saldo.
  const ids = aplicaciones.map((a) => a.venta_id)
  const { data: ventas, error: vErr } = await ejecutarVigentes<
    { id: number; cliente_id: number; total_venta: number; valorpago: number | null; numero_factura: string }[] | null
  >((filtrar) => {
    let q = supabase
      .from("ventas_encabezado")
      .select("id, cliente_id, total_venta, valorpago, numero_factura")
      .in("id", ids)
    if (filtrar) q = q.is("anulada_at", null)
    return q
  })
  if (vErr) return { data: null, error: vErr.message || "No se pudieron leer las facturas" }
  const saldos = new Map<number, number>()
  const porId = new Map<number, { total_venta: number; valorpago: number; numero_factura: string }>()
  for (const v of ventas || []) {
    if (Number(v.cliente_id) !== Number(input.cliente_id)) continue
    const saldo = +(Number(v.total_venta || 0) - Number(v.valorpago || 0)).toFixed(2)
    if (saldo > 0.005) saldos.set(Number(v.id), saldo)
    porId.set(Number(v.id), { total_venta: Number(v.total_venta || 0), valorpago: Number(v.valorpago || 0), numero_factura: v.numero_factura })
  }
  const invalido = validarAplicaciones(aplicaciones, saldos)
  if (invalido) return { data: null, error: invalido }

  const montoTotal = +aplicaciones.reduce((a, x) => a + x.monto, 0).toFixed(2)
  const facturasTxt = aplicaciones.map((a) => porId.get(a.venta_id)?.numero_factura || `#${a.venta_id}`).join(", ")

  // 2) Correlativo + encabezado del recibo.
  const corr = await emitirCorrelativo(supabase, SERIES.RECIBO, "RC-")
  if (!corr.numero) return { data: null, error: corr.error || RECIBOS_FEATURE_PENDING }

  const { data: recibo, error: rErr } = await supabase
    .from("recibos_cobro")
    .insert({
      numero_recibo: corr.numero,
      cliente_id: input.cliente_id,
      fecha: getHondurasNowISO(),
      monto_total: montoTotal,
      metodo_pago: input.metodo_pago,
      cuenta_id: input.metodo_pago === "Banco" ? input.cuenta_id ?? null : null,
      referencia: (input.referencia || "").trim() || null,
      concepto: (input.concepto || "").trim() || null,
      ...stamp,
    })
    .select("id")
    .single()
  if (rErr || !recibo) {
    if (isMissingTable(rErr)) return { data: null, error: RECIBOS_FEATURE_PENDING }
    return { data: null, error: rErr?.message || "No se pudo crear el recibo" }
  }
  const reciboId = Number(recibo.id)
  const concepto = `Recibo ${corr.numero} (${facturasTxt})`

  // 3) UN movimiento de tesorería para todo el recibo.
  let avisoTesoreria: string | null = null
  if (input.metodo_pago === "Efectivo") {
    const mov = await registrarMovimientoCaja({
      tipo: "Ingreso_Venta",
      monto: montoTotal,
      concepto,
      ref_tipo: "recibo",
      ref_id: reciboId,
    })
    if (mov.error) avisoTesoreria = mov.error
  } else if (input.metodo_pago === "Banco") {
    const mov = await registrarMovimientoCuenta({
      cuenta_id: input.cuenta_id!,
      tipo: "Ingreso",
      monto: montoTotal,
      concepto,
      ref_tipo: "recibo",
      ref_id: reciboId,
      referencia: input.referencia ?? null,
    })
    if (mov.error) avisoTesoreria = mov.error
  }
  if (avisoTesoreria) {
    // Sin dinero registrado no hay recibo: deshacer el encabezado.
    await supabase.from("recibos_cobro").delete().eq("id", reciboId)
    return { data: null, error: `No se registró el cobro: ${avisoTesoreria}` }
  }

  // 4) Un abono por factura + actualización del saldo.
  for (const a of aplicaciones) {
    const { error: pErr } = await supabase.from("pagos_ventas").insert({
      venta_id: a.venta_id,
      monto: a.monto,
      metodo_pago: input.metodo_pago,
      fecha_pago: getHondurasNowISO(),
      recibo_id: reciboId,
      ...stamp,
    })
    if (pErr) console.error("[recibos] abono no registrado:", pErr.message)
    const v = porId.get(a.venta_id)
    if (v) {
      const { valorpago, estado_pago } = aplicarAbono(v.total_venta, v.valorpago, a.monto)
      await supabase.from("ventas_encabezado").update({ valorpago, estado_pago }).eq("id", a.venta_id)
    }
  }

  await registrarAuditoria(supabase, stamp, {
    entidad: "recibo",
    entidad_id: reciboId,
    accion: "crear",
    despues: { numero_recibo: corr.numero, monto_total: montoTotal, metodo_pago: input.metodo_pago, aplicaciones },
  })

  return { data: { id: reciboId, numero_recibo: corr.numero }, error: null }
}

/**
 * Anula un recibo: contra-asiento en tesorería (el dinero sale), se quitan
 * sus abonos y se reconstruye valorpago/estado_pago de cada factura.
 */
export async function anularReciboCobro(id: number, motivo: string): Promise<{ error: string | null }> {
  const supabase = createClient()
  if (!supabase) return { error: "Cliente no disponible" }
  const stamp = await getTenantStamp(supabase)
  if (!isValidStamp(stamp)) return { error: SESION_INVALIDA_ERROR }
  const motivoLimpio = (motivo || "").trim()
  if (!motivoLimpio) return { error: "Indica el motivo de la anulación" }

  const { data: recibo, error: rErr } = await supabase.from("recibos_cobro").select("*").eq("id", id).maybeSingle()
  if (rErr || !recibo) return { error: "El recibo no existe" }
  if (recibo.anulado_at) return { error: "El recibo ya está anulado" }

  // Idempotencia: marcar primero.
  const { data: marcado } = await supabase
    .from("recibos_cobro")
    .update({ anulado_at: getHondurasNowISO(), motivo_anulacion: motivoLimpio })
    .eq("id", id)
    .is("anulado_at", null)
    .select("id")
  if (!marcado || marcado.length === 0) return { error: "El recibo ya está anulado" }

  // Contra-asiento.
  const concepto = `Anulación recibo ${recibo.numero_recibo}: ${motivoLimpio}`
  if (recibo.metodo_pago === "Efectivo") {
    const mov = await registrarMovimientoCaja({ tipo: "Salida", monto: Number(recibo.monto_total), concepto, ref_tipo: "anulacion_recibo", ref_id: id })
    if (mov.error) console.error("[recibos] contra-asiento caja falló:", mov.error)
  } else if (recibo.metodo_pago === "Banco" && recibo.cuenta_id) {
    const mov = await registrarMovimientoCuenta({ cuenta_id: Number(recibo.cuenta_id), tipo: "Egreso", monto: Number(recibo.monto_total), concepto, ref_tipo: "anulacion_recibo", ref_id: id })
    if (mov.error) console.error("[recibos] contra-asiento cuenta falló:", mov.error)
  }

  // Quitar abonos del recibo y reconstruir el saldo de cada factura.
  const { data: abonos } = await supabase.from("pagos_ventas").select("id, venta_id").eq("recibo_id", id)
  const ventaIds = [...new Set((abonos || []).map((a) => Number(a.venta_id)))]
  await supabase.from("pagos_ventas").delete().eq("recibo_id", id)
  for (const ventaId of ventaIds) await reconstruirSaldoVenta(supabase, ventaId)

  await registrarAuditoria(supabase, stamp, { entidad: "recibo", entidad_id: id, accion: "anular", motivo: motivoLimpio, antes: recibo })
  return { error: null }
}

/** Reconstruye valorpago/estado_pago de una venta desde su pago inicial + abonos. */
export async function reconstruirSaldoVenta(supabase: SupabaseClient, ventaId: number): Promise<void> {
  const [{ data: venta }, { data: iniciales }, { data: abonos }] = await Promise.all([
    supabase.from("ventas_encabezado").select("total_venta").eq("id", ventaId).maybeSingle(),
    supabase.from("ventas_pagos_detalle").select("monto_bruto").eq("venta_id", ventaId).neq("metodo_pago", "Credito"),
    supabase.from("pagos_ventas").select("monto").eq("venta_id", ventaId),
  ])
  if (!venta) return
  const { valorpago, estado_pago } = recalcularValorpago(Number(venta.total_venta || 0), iniciales || [], abonos || [])
  await supabase.from("ventas_encabezado").update({ valorpago, estado_pago }).eq("id", ventaId)
}

// ==================== LECTURA ====================

export async function getRecibos(
  opts: { clienteId?: number; limit?: number } = {}
): Promise<{ data: ReciboCobro[]; error: string | null }> {
  if (!isSupabaseConfigured()) return { data: [], error: null }
  const supabase = createClient()
  if (!supabase) return { data: [], error: "Cliente no disponible" }

  let q = supabase
    .from("recibos_cobro")
    .select("*, clientes:cliente_id (nombre)")
    .order("fecha", { ascending: false })
    .order("id", { ascending: false })
    .limit(opts.limit ?? 300)
  if (opts.clienteId != null) q = q.eq("cliente_id", opts.clienteId)
  const { data, error } = await q
  if (error) {
    if (isMissingTable(error)) return { data: [], error: RECIBOS_FEATURE_PENDING }
    return { data: [], error: error.message }
  }
  const recibos = (data || []).map((r: Record<string, unknown>) => {
    const cli = Array.isArray(r.clientes) ? r.clientes[0] : r.clientes
    return { ...(r as unknown as ReciboCobro), cliente_nombre: (cli as { nombre?: string } | null)?.nombre || "" }
  })

  // Facturas cubiertas por cada recibo.
  const ids = recibos.map((r) => r.id)
  if (ids.length > 0) {
    const { data: abonos } = await supabase
      .from("pagos_ventas")
      .select("recibo_id, venta_id, monto, ventas_encabezado:venta_id (numero_factura)")
      .in("recibo_id", ids)
    const porRecibo = new Map<number, { venta_id: number; numero_factura: string; monto: number }[]>()
    for (const a of abonos || []) {
      const ve = Array.isArray(a.ventas_encabezado) ? a.ventas_encabezado[0] : a.ventas_encabezado
      const lista = porRecibo.get(Number(a.recibo_id)) || []
      lista.push({ venta_id: Number(a.venta_id), numero_factura: (ve as { numero_factura?: string } | null)?.numero_factura || "", monto: Number(a.monto || 0) })
      porRecibo.set(Number(a.recibo_id), lista)
    }
    for (const r of recibos) r.aplicaciones = porRecibo.get(r.id) || []
  }
  return { data: recibos, error: null }
}

export { recalcCadenaSaldoCuenta }
