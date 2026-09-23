import { createClient, isSupabaseConfigured } from "@/lib/supabase/client"
import { getTenantStamp, isValidStamp, SESION_INVALIDA_ERROR } from "@/lib/services/tenant-stamp"
import { aplicarEntradaCompra } from "@/lib/services/stock"
import { registrarMovimientoCaja } from "@/lib/services/caja-chica"
import { registrarMovimientoCuenta } from "@/lib/services/cuentas"
import { registrarAuditoria } from "@/lib/services/auditoria"
import { getHondurasNowISO, getHondurasTodayISODate } from "@/lib/utils/honduras-time"
import { getDetallesCompra, type CompraDetalle, type CompraEncabezado } from "@/lib/services/compras"

/**
 * Recepciones parciales, backorder y cuentas por pagar por orden de compra
 * (script officemart-008).
 *
 *   - Una OC se recibe en 1..n recepciones (`compras_recepciones`); cada una
 *     prorratea SOLO sus costos entre lo que recibe, entra al inventario con
 *     `aplicarEntradaCompra` y deja kardex con `recepcion_id`.
 *   - Lo pendiente es backorder; se puede cerrar (`cerrarBackorder`).
 *   - El dinero va por `compras_pagos` (anticipo antes de recibir, abonos
 *     después) con tesorería `ref_tipo='compra_pago'`. La recepción ya NO
 *     crea el gasto "Compra de mercadería" (doble conteo con el CMV).
 *
 * Todo lo decidible es puro (`calcularPendientes`, `validarCantidadesRecepcion`,
 * `derivarEstadoRecepcion`, `derivarEstadoPagoCompra`, `costoFinalPonderado`).
 */

export const RECEPCIONES_FEATURE_PENDING =
  "Recepciones parciales pendientes: aplica scripts/officemart-008-recepciones-cxp.sql en Supabase."

export type EstadoRecepcion = "Sin recibir" | "Parcial" | "Completa" | "Cerrada"
export type EstadoPagoCompra = "Pendiente" | "Parcial" | "Pagado"

export interface Recepcion {
  id: number
  compra_id: number
  numero: number
  fecha: string
  almacen_id: number | null
  localizacion_id: number | null
  costos_importacion: number
  impuestos_compra: number
  otros_costos: number
  tasa_cambio: number
  subtotal_local: number
  total_local: number
  numero_factura_proveedor: string | null
  notas: string | null
  usuario: string | null
  detalle?: RecepcionLinea[]
}

export interface RecepcionLinea {
  id?: number
  compra_detalle_id: number | null
  producto_id: number
  producto_nombre?: string
  cantidad: number
  costo_unitario_origen: number
  costo_final_local: number
  precio_venta_aplicado: number | null
}

export interface PagoCompra {
  id: number
  compra_id: number
  recepcion_id: number | null
  tipo: "Anticipo" | "Abono"
  monto: number
  metodo: "Efectivo" | "Banco"
  cuenta_id: number | null
  referencia: string | null
  concepto: string | null
  fecha: string
  anulado_at: string | null
  motivo_anulacion: string | null
  usuario: string | null
}

export interface RecepcionInput {
  compraId: number
  costos_importacion: number
  impuestos_compra: number
  otros_costos: number
  tasa_cambio: number
  almacen_id: number
  localizacion_id: number
  numero_factura_proveedor?: string | null
  notas?: string | null
  detalles: {
    detalle_id: number
    producto_id: number
    /** Cantidad que se recibe AHORA (0 = no se recibe en esta recepción). */
    cantidad_recibida: number
    costo_final_local: number
    precio_venta?: number | null
  }[]
  pago?: {
    metodo: "Efectivo" | "Banco" | "Credito"
    cuenta_id?: number | null
    referencia?: string | null
    /** Días de crédito (solo Credito); default: proveedores.dias_credito o 30. */
    dias_credito?: number | null
  } | null
}

function isMissingTable(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false
  const msg = (err.message || "").toLowerCase()
  return err.code === "42P01" || err.code === "PGRST205" || msg.includes("schema cache") || /relation .* does not exist/.test(msg)
}

function r2(n: number): number {
  return +(Number(n) || 0).toFixed(2)
}

// ==================== FUNCIONES PURAS ====================

/** Pendiente por línea = ordenado − recibido (nunca negativo). */
export function calcularPendientes(
  detalles: Pick<CompraDetalle, "id" | "cantidad" | "cantidad_recibida">[]
): Map<number, number> {
  const m = new Map<number, number>()
  for (const d of detalles) {
    if (d.id == null) continue
    m.set(d.id, Math.max(0, +(Number(d.cantidad || 0) - Number(d.cantidad_recibida || 0)).toFixed(4)))
  }
  return m
}

/**
 * Valida lo que se quiere recibir contra lo pendiente. Devuelve el mensaje de
 * error o null. Las líneas con 0 se ignoran; al menos una debe ser > 0.
 */
export function validarCantidadesRecepcion(
  detalles: Pick<CompraDetalle, "id" | "cantidad" | "cantidad_recibida" | "producto_nombre">[],
  recibidas: { detalle_id: number; cantidad_recibida: number }[]
): string | null {
  const pendientes = calcularPendientes(detalles)
  let alguna = false
  for (const r of recibidas) {
    const q = Number(r.cantidad_recibida) || 0
    if (q < 0) return "Las cantidades no pueden ser negativas."
    if (q === 0) continue
    alguna = true
    const pend = pendientes.get(r.detalle_id)
    if (pend == null) return `La línea ${r.detalle_id} no pertenece a esta orden.`
    if (q > pend + 0.0001) {
      const nombre = detalles.find((d) => d.id === r.detalle_id)?.producto_nombre || `línea ${r.detalle_id}`
      return `${nombre}: intentas recibir ${q} pero solo faltan ${pend}.`
    }
  }
  if (!alguna) return "Indica al menos una cantidad a recibir."
  return null
}

/** Estado de recepción de la OC según sus líneas (después de aplicar la recepción). */
export function derivarEstadoRecepcion(
  detalles: Pick<CompraDetalle, "cantidad" | "cantidad_recibida">[]
): EstadoRecepcion {
  let ordenado = 0
  let recibido = 0
  for (const d of detalles) {
    ordenado += Number(d.cantidad || 0)
    recibido += Math.min(Number(d.cantidad || 0), Number(d.cantidad_recibida || 0))
  }
  if (recibido <= 0) return "Sin recibir"
  if (recibido + 0.0001 >= ordenado) return "Completa"
  return "Parcial"
}

/** Estado de pago de la OC: comparado contra lo RECIBIDO (lo que se debe), no lo ordenado. */
export function derivarEstadoPagoCompra(totalDebido: number, pagado: number): EstadoPagoCompra {
  const p = Number(pagado) || 0
  const t = Number(totalDebido) || 0
  if (p <= 0.005) return "Pendiente"
  if (p + 0.005 >= t && t > 0) return "Pagado"
  return "Parcial"
}

/** Costo final ponderado de una línea tras varias recepciones con costos distintos. */
export function costoFinalPonderado(prevCant: number, prevCosto: number, nuevaCant: number, nuevoCosto: number): number {
  const a = Math.max(0, Number(prevCant) || 0)
  const b = Math.max(0, Number(nuevaCant) || 0)
  if (a + b <= 0) return +(Number(nuevoCosto) || 0).toFixed(4)
  return +(((a * (Number(prevCosto) || 0)) + (b * (Number(nuevoCosto) || 0))) / (a + b)).toFixed(4)
}

/** Vencimiento = fecha + días (YYYY-MM-DD). */
export function fechaVencimiento(fechaISO: string, dias: number): string {
  const d = new Date(`${fechaISO.slice(0, 10)}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + Math.max(0, Math.floor(Number(dias) || 0)))
  return d.toISOString().slice(0, 10)
}

// ==================== RECEPCIÓN ====================

function normRecepcion(r: Record<string, unknown>): Recepcion {
  return {
    id: Number(r.id),
    compra_id: Number(r.compra_id),
    numero: Number(r.numero ?? 1),
    fecha: String(r.fecha ?? ""),
    almacen_id: r.almacen_id != null ? Number(r.almacen_id) : null,
    localizacion_id: r.localizacion_id != null ? Number(r.localizacion_id) : null,
    costos_importacion: Number(r.costos_importacion ?? 0),
    impuestos_compra: Number(r.impuestos_compra ?? 0),
    otros_costos: Number(r.otros_costos ?? 0),
    tasa_cambio: Number(r.tasa_cambio ?? 1),
    subtotal_local: Number(r.subtotal_local ?? 0),
    total_local: Number(r.total_local ?? 0),
    numero_factura_proveedor: (r.numero_factura_proveedor as string) ?? null,
    notas: (r.notas as string) ?? null,
    usuario: (r.usuario as string) ?? null,
  }
}

/** Recepciones de una OC con su detalle. [] + pendiente si falta el script. */
export async function getRecepcionesCompra(
  compraId: number
): Promise<{ data: Recepcion[]; error: string | null; pendiente: boolean }> {
  if (!isSupabaseConfigured()) return { data: [], error: null, pendiente: false }
  const supabase = createClient()
  if (!supabase) return { data: [], error: "Cliente no disponible", pendiente: false }
  const { data, error } = await supabase
    .from("compras_recepciones")
    .select("*")
    .eq("compra_id", compraId)
    .order("numero", { ascending: true })
  if (error) {
    if (isMissingTable(error)) return { data: [], error: null, pendiente: true }
    return { data: [], error: error.message, pendiente: false }
  }
  const recepciones = (data || []).map((r) => normRecepcion(r as Record<string, unknown>))
  if (recepciones.length > 0) {
    const { data: det } = await supabase
      .from("compras_recepciones_detalle")
      .select("*, productos (nombre)")
      .in("recepcion_id", recepciones.map((r) => r.id))
    const porRec = new Map<number, RecepcionLinea[]>()
    for (const d of (det || []) as Record<string, unknown>[]) {
      const prod = Array.isArray(d.productos) ? d.productos[0] : d.productos
      const lista = porRec.get(Number(d.recepcion_id)) || []
      lista.push({
        id: Number(d.id),
        compra_detalle_id: d.compra_detalle_id != null ? Number(d.compra_detalle_id) : null,
        producto_id: Number(d.producto_id),
        producto_nombre: (prod as { nombre?: string } | null)?.nombre,
        cantidad: Number(d.cantidad ?? 0),
        costo_unitario_origen: Number(d.costo_unitario_origen ?? 0),
        costo_final_local: Number(d.costo_final_local ?? 0),
        precio_venta_aplicado: d.precio_venta_aplicado != null ? Number(d.precio_venta_aplicado) : null,
      })
      porRec.set(Number(d.recepcion_id), lista)
    }
    for (const r of recepciones) r.detalle = porRec.get(r.id) || []
  }
  return { data: recepciones, error: null, pendiente: false }
}

/**
 * Registra UNA recepción (parcial o total) de una OC. Devuelve `legacy: true`
 * (sin tocar nada) si la tabla `compras_recepciones` no existe, para que el
 * llamador use el flujo anterior.
 */
export async function registrarRecepcion(
  input: RecepcionInput
): Promise<{ success: boolean; error: string | null; recepcionId: number | null; legacy?: boolean }> {
  const supabase = createClient()
  if (!supabase) return { success: false, error: "Cliente no disponible", recepcionId: null }
  const stamp = await getTenantStamp(supabase)
  if (!isValidStamp(stamp)) return { success: false, error: SESION_INVALIDA_ERROR, recepcionId: null }

  // 0) OC y líneas actuales (para validar contra lo pendiente).
  const { data: compra, error: cErr } = await supabase
    .from("compras_encabezado")
    .select("*, proveedores (nombre, dias_credito)")
    .eq("id", input.compraId)
    .maybeSingle()
  if (cErr || !compra) return { success: false, error: cErr?.message || "La orden no existe", recepcionId: null }
  if (compra.cerrada_at) return { success: false, error: "La orden está cerrada (backorder cerrado). Reábrela o crea otra OC.", recepcionId: null }
  const { data: detalles } = await getDetallesCompra(input.compraId)
  const lineas = input.detalles.filter((d) => (Number(d.cantidad_recibida) || 0) > 0)
  const invalido = validarCantidadesRecepcion(detalles, lineas)
  if (invalido) return { success: false, error: invalido, recepcionId: null }
  if (input.pago?.metodo === "Banco" && !input.pago.cuenta_id) {
    return { success: false, error: "Elige la cuenta bancaria del pago.", recepcionId: null }
  }

  const detallePorId = new Map<number, CompraDetalle>()
  for (const d of detalles) if (d.id != null) detallePorId.set(d.id, d)
  const tasa = compra.moneda === "USD" ? Number(input.tasa_cambio) || 1 : 1
  const subtotalLocal = r2(
    lineas.reduce((a, l) => a + l.cantidad_recibida * (Number(detallePorId.get(l.detalle_id)?.costo_unitario_moneda_origen) || 0) * tasa, 0)
  )
  const costosExtra = r2((Number(input.costos_importacion) || 0) + (Number(input.impuestos_compra) || 0) + (Number(input.otros_costos) || 0))
  const totalLocal = r2(lineas.reduce((a, l) => a + l.cantidad_recibida * l.costo_final_local, 0))

  // 1) Encabezado de la recepción (número = siguiente por OC).
  const { count } = await supabase.from("compras_recepciones").select("id", { count: "exact", head: true }).eq("compra_id", input.compraId)
  const numero = (count || 0) + 1
  const { data: rec, error: recErr } = await supabase
    .from("compras_recepciones")
    .insert({
      compra_id: input.compraId,
      numero,
      fecha: getHondurasNowISO(),
      almacen_id: input.almacen_id,
      localizacion_id: input.localizacion_id,
      costos_importacion: r2(input.costos_importacion),
      impuestos_compra: r2(input.impuestos_compra),
      otros_costos: r2(input.otros_costos),
      tasa_cambio: tasa,
      subtotal_local: subtotalLocal,
      total_local: totalLocal,
      numero_factura_proveedor: input.numero_factura_proveedor?.trim() || null,
      notas: input.notas?.trim() || null,
      ...stamp,
    })
    .select("id")
    .single()
  if (recErr) {
    if (isMissingTable(recErr)) return { success: false, error: RECEPCIONES_FEATURE_PENDING, recepcionId: null, legacy: true }
    return { success: false, error: recErr.message, recepcionId: null }
  }
  const recepcionId = Number(rec.id)

  // 2) Detalle de la recepción.
  const { error: detErr } = await supabase.from("compras_recepciones_detalle").insert(
    lineas.map((l) => ({
      razon_social_id: stamp.razon_social_id,
      recepcion_id: recepcionId,
      compra_detalle_id: l.detalle_id,
      producto_id: l.producto_id,
      cantidad: l.cantidad_recibida,
      costo_unitario_origen: Number(detallePorId.get(l.detalle_id)?.costo_unitario_moneda_origen) || 0,
      costo_final_local: l.costo_final_local,
      precio_venta_aplicado: l.precio_venta != null && l.precio_venta > 0 ? l.precio_venta : null,
    }))
  )
  if (detErr) {
    await supabase.from("compras_recepciones").delete().eq("id", recepcionId)
    return { success: false, error: detErr.message, recepcionId: null }
  }

  // 3) Inventario + kardex + línea de la OC, por producto.
  const avisos: string[] = []
  for (const l of lineas) {
    const entrada = await aplicarEntradaCompra(supabase, l.producto_id, l.cantidad_recibida, l.costo_final_local)
    if (entrada.error) return { success: false, error: `Inventario: ${entrada.error}`, recepcionId }

    if (l.precio_venta != null && l.precio_venta > 0) {
      const { error: precioErr } = await supabase
        .from("productos")
        .update({ precio_venta_sugerido: l.precio_venta, updated_at: new Date().toISOString() })
        .eq("id", l.producto_id)
        .eq("razon_social_id", stamp.razon_social_id)
      if (precioErr) avisos.push(`precio de venta de #${l.producto_id}`)
    }

    const kardex = {
      producto_id: l.producto_id,
      almacen_id: input.almacen_id,
      localizacion_id: input.localizacion_id,
      tipo_movimiento: "Entrada Compra",
      cantidad: l.cantidad_recibida,
      costo_o_precio_unitario: l.costo_final_local,
      referencia_id: input.compraId,
      fecha: getHondurasNowISO(),
      ...stamp,
    }
    let kErr = (await supabase.from("transacciones_inventario").insert({ ...kardex, recepcion_id: recepcionId, referencia_tipo: "recepcion" })).error
    if (kErr && /recepcion_id|referencia_tipo/i.test(kErr.message || "")) {
      kErr = (await supabase.from("transacciones_inventario").insert(kardex)).error
    }
    if (kErr) return { success: false, error: `Kardex: ${kErr.message}`, recepcionId }

    // Cantidad recibida acumulada (RPC atómico; respaldo leer-modificar-escribir).
    const det = detallePorId.get(l.detalle_id)
    const prevCant = Number(det?.cantidad_recibida || 0)
    const rpc = await supabase.rpc("incrementar_cantidad_recibida", { p_detalle_id: l.detalle_id, p_delta: l.cantidad_recibida })
    let nuevaCant = rpc.error ? null : Number(rpc.data)
    if (rpc.error) {
      nuevaCant = prevCant + l.cantidad_recibida
      const { error: upErr } = await supabase.from("compras_detalle").update({ cantidad_recibida: nuevaCant }).eq("id", l.detalle_id)
      if (upErr) avisos.push(`cantidad recibida de la línea ${l.detalle_id}`)
    }
    const costoPond = costoFinalPonderado(prevCant, Number(det?.costo_final_local || 0), l.cantidad_recibida, l.costo_final_local)
    await supabase.from("compras_detalle").update({ costo_final_local: costoPond }).eq("id", l.detalle_id)
    if (det) det.cantidad_recibida = nuevaCant ?? prevCant + l.cantidad_recibida
  }

  // 4) Encabezado de la OC: acumulados, estado de recepción, crédito.
  const estadoRec = derivarEstadoRecepcion(detalles)
  const provDias = (() => {
    const p = Array.isArray(compra.proveedores) ? compra.proveedores[0] : compra.proveedores
    return Number((p as { dias_credito?: number } | null)?.dias_credito || 0)
  })()
  const esCredito = input.pago?.metodo === "Credito"
  const hoy = getHondurasTodayISODate()
  const cambiosOC: Record<string, unknown> = {
    costos_importacion: r2(Number(compra.costos_importacion || 0) + (Number(input.costos_importacion) || 0)),
    impuestos_compra: r2(Number(compra.impuestos_compra || 0) + (Number(input.impuestos_compra) || 0)),
    otros_costos: r2(Number(compra.otros_costos || 0) + (Number(input.otros_costos) || 0)),
    tasa_cambio: tasa,
    total_compra_local: r2(Number(compra.total_compra_local || 0) + totalLocal),
    total_recibido_local: r2(Number(compra.total_recibido_local || 0) + totalLocal),
    estado_recepcion: estadoRec,
    estado: estadoRec === "Completa" ? "Recibida" : "Pendiente",
  }
  if (input.numero_factura_proveedor?.trim() && !compra.numero_factura) cambiosOC.numero_factura = input.numero_factura_proveedor.trim()
  if (input.pago) {
    if (esCredito) {
      const dias = input.pago.dias_credito ?? (compra.dias_credito ?? (provDias > 0 ? provDias : 30))
      cambiosOC.forma_pago = "Credito"
      cambiosOC.dias_credito = dias
      if (!compra.fecha_vencimiento) cambiosOC.fecha_vencimiento = fechaVencimiento(hoy, dias)
    } else if (!compra.forma_pago) {
      cambiosOC.forma_pago = "Contado"
    }
  }
  const { error: ocErr } = await supabase.from("compras_encabezado").update(cambiosOC).eq("id", input.compraId)
  if (ocErr) {
    // Columnas nuevas ausentes: actualiza solo las clásicas.
    const { estado_recepcion: _a, total_recibido_local: _b, forma_pago: _c, dias_credito: _d, fecha_vencimiento: _e, ...clasicos } = cambiosOC
    const retry = await supabase.from("compras_encabezado").update(clasicos).eq("id", input.compraId)
    if (retry.error) avisos.push(`encabezado de la OC (${retry.error.message})`)
  }
  await recalcularEstadoPagoCompra(supabase, input.compraId)

  // 5) Pago inmediato (Efectivo/Banco) → abono con tesorería. Crédito → CxP por OC.
  if (input.pago && !esCredito && totalLocal > 0) {
    const pago = await registrarPagoCompra({
      compra_id: input.compraId,
      recepcion_id: recepcionId,
      tipo: "Abono",
      monto: totalLocal,
      metodo: input.pago.metodo as "Efectivo" | "Banco",
      cuenta_id: input.pago.cuenta_id ?? null,
      referencia: input.pago.referencia ?? null,
      concepto: `Recepción #${numero} OC-${input.compraId}`,
    })
    if (pago.error) avisos.push(`pago (${pago.error}); regístralo desde la orden`)
  }

  await registrarAuditoria(supabase, stamp, {
    entidad: "compra_recepcion",
    entidad_id: recepcionId,
    accion: "recibir",
    despues: { compra_id: input.compraId, numero, total_local: totalLocal, estado_recepcion: estadoRec },
  })
  return {
    success: true,
    error: avisos.length > 0 ? `Recepción registrada, pero falló: ${avisos.join("; ")}.` : null,
    recepcionId,
  }
}

// ==================== BACKORDER ====================

export interface Backorder {
  compra: CompraEncabezado
  lineas: (CompraDetalle & { pendiente: number })[]
  totalPendiente: number
}

/** OCs con algo pendiente de recibir (no cerradas). */
export async function getBackorders(): Promise<{ data: Backorder[]; error: string | null; pendiente: boolean }> {
  if (!isSupabaseConfigured()) return { data: [], error: null, pendiente: false }
  const supabase = createClient()
  if (!supabase) return { data: [], error: "Cliente no disponible", pendiente: false }
  let res = await supabase
    .from("compras_encabezado")
    .select("*, proveedores (nombre)")
    .eq("estado", "Pendiente")
    .is("cerrada_at", null)
    .order("fecha_orden", { ascending: true })
  let pendienteScript = false
  if (res.error && /cerrada_at/i.test(res.error.message || "")) {
    pendienteScript = true
    res = await supabase.from("compras_encabezado").select("*, proveedores (nombre)").eq("estado", "Pendiente").order("fecha_orden", { ascending: true })
  }
  if (res.error) return { data: [], error: res.error.message, pendiente: false }
  const compras = (res.data || []) as (Record<string, unknown> & { proveedores?: { nombre?: string } | { nombre?: string }[] | null })[]
  if (compras.length === 0) return { data: [], error: null, pendiente: pendienteScript }
  const ids = compras.map((c) => Number(c.id))
  const { data: det } = await supabase.from("compras_detalle").select("*, productos (nombre, codigo_barras)").in("compra_id", ids)
  const lineasPorCompra = new Map<number, (CompraDetalle & { pendiente: number })[]>()
  for (const d of (det || []) as Record<string, unknown>[]) {
    const prod = Array.isArray(d.productos) ? d.productos[0] : d.productos
    const cantidad = Number(d.cantidad || 0)
    const recibida = Number(d.cantidad_recibida || 0)
    const lista = lineasPorCompra.get(Number(d.compra_id)) || []
    lista.push({
      id: Number(d.id),
      compra_id: Number(d.compra_id),
      producto_id: Number(d.producto_id),
      producto_nombre: (prod as { nombre?: string } | null)?.nombre,
      producto_codigo: (prod as { codigo_barras?: string } | null)?.codigo_barras,
      cantidad,
      cantidad_recibida: recibida,
      costo_unitario_moneda_origen: Number(d.costo_unitario_moneda_origen || 0),
      costo_final_local: Number(d.costo_final_local || 0),
      pendiente: Math.max(0, +(cantidad - recibida).toFixed(4)),
    })
    lineasPorCompra.set(Number(d.compra_id), lista)
  }
  // Backorder = OC con al menos una recepción y algo pendiente. Una OC sin
  // ninguna recepción es simplemente "por recibir" (no aparece aquí).
  const out: Backorder[] = []
  for (const c of compras) {
    const id = Number(c.id)
    const todas = lineasPorCompra.get(id) || []
    if (!todas.some((l) => (l.cantidad_recibida || 0) > 0)) continue
    const lineas = todas.filter((l) => l.pendiente > 0)
    if (lineas.length === 0) continue
    const prov = Array.isArray(c.proveedores) ? c.proveedores[0] : c.proveedores
    const tasa = String(c.moneda) === "USD" ? Number(c.tasa_cambio || 1) : 1
    out.push({
      compra: { ...(c as unknown as CompraEncabezado), proveedor_nombre: (prov as { nombre?: string } | null)?.nombre },
      lineas,
      totalPendiente: r2(lineas.reduce((a, l) => a + l.pendiente * l.costo_unitario_moneda_origen * tasa, 0)),
    })
  }
  return { data: out, error: null, pendiente: pendienteScript }
}

/** Cierra lo pendiente de una OC (no llegará): estado Recibida, recepción 'Cerrada'. */
export async function cerrarBackorder(compraId: number, motivo: string): Promise<{ error: string | null }> {
  const supabase = createClient()
  if (!supabase) return { error: "Cliente no disponible" }
  const stamp = await getTenantStamp(supabase)
  if (!isValidStamp(stamp)) return { error: SESION_INVALIDA_ERROR }
  const m = (motivo || "").trim()
  if (!m) return { error: "Indica el motivo del cierre." }
  const { error } = await supabase
    .from("compras_encabezado")
    .update({ estado: "Recibida", estado_recepcion: "Cerrada", cerrada_at: new Date().toISOString(), motivo_cierre: m })
    .eq("id", compraId)
    .eq("estado", "Pendiente")
  if (error) {
    if (/cerrada_at|estado_recepcion|motivo_cierre/i.test(error.message || "")) return { error: RECEPCIONES_FEATURE_PENDING }
    return { error: error.message }
  }
  await registrarAuditoria(supabase, stamp, { entidad: "compra", entidad_id: compraId, accion: "cerrar_backorder", motivo: m })
  return { error: null }
}

// ==================== PAGOS A OC (ANTICIPOS / ABONOS) ====================

function normPago(r: Record<string, unknown>): PagoCompra {
  return {
    id: Number(r.id),
    compra_id: Number(r.compra_id),
    recepcion_id: r.recepcion_id != null ? Number(r.recepcion_id) : null,
    tipo: (r.tipo as "Anticipo" | "Abono") ?? "Abono",
    monto: Number(r.monto ?? 0),
    metodo: (r.metodo as "Efectivo" | "Banco") ?? "Efectivo",
    cuenta_id: r.cuenta_id != null ? Number(r.cuenta_id) : null,
    referencia: (r.referencia as string) ?? null,
    concepto: (r.concepto as string) ?? null,
    fecha: String(r.fecha ?? ""),
    anulado_at: (r.anulado_at as string) ?? null,
    motivo_anulacion: (r.motivo_anulacion as string) ?? null,
    usuario: (r.usuario as string) ?? null,
  }
}

export async function getPagosCompra(compraId: number): Promise<{ data: PagoCompra[]; error: string | null; pendiente: boolean }> {
  if (!isSupabaseConfigured()) return { data: [], error: null, pendiente: false }
  const supabase = createClient()
  if (!supabase) return { data: [], error: "Cliente no disponible", pendiente: false }
  const { data, error } = await supabase.from("compras_pagos").select("*").eq("compra_id", compraId).order("fecha", { ascending: true })
  if (error) {
    if (isMissingTable(error)) return { data: [], error: null, pendiente: true }
    return { data: [], error: error.message, pendiente: false }
  }
  return { data: (data || []).map((r) => normPago(r as Record<string, unknown>)), error: null, pendiente: false }
}

/** Recalcula monto_pagado / estado_pago de la OC desde sus pagos vigentes (best-effort). */
export async function recalcularEstadoPagoCompra(
  supabase: NonNullable<ReturnType<typeof createClient>>,
  compraId: number
): Promise<void> {
  try {
    const { data: pagos, error } = await supabase.from("compras_pagos").select("monto").eq("compra_id", compraId).is("anulado_at", null)
    if (error) return
    const pagado = r2((pagos || []).reduce((a, p) => a + Number(p.monto || 0), 0))
    const { data: oc } = await supabase.from("compras_encabezado").select("total_recibido_local, total_compra_local").eq("id", compraId).maybeSingle()
    const debido = Number(oc?.total_recibido_local ?? oc?.total_compra_local ?? 0)
    await supabase.from("compras_encabezado").update({ monto_pagado: pagado, estado_pago: derivarEstadoPagoCompra(debido, pagado) }).eq("id", compraId)
  } catch {
    /* columnas ausentes: se ignora */
  }
}

export async function registrarPagoCompra(input: {
  compra_id: number
  recepcion_id?: number | null
  tipo: "Anticipo" | "Abono"
  monto: number
  metodo: "Efectivo" | "Banco"
  cuenta_id?: number | null
  referencia?: string | null
  concepto?: string | null
}): Promise<{ data: PagoCompra | null; error: string | null }> {
  const supabase = createClient()
  if (!supabase) return { data: null, error: "Cliente no disponible" }
  const stamp = await getTenantStamp(supabase)
  if (!isValidStamp(stamp)) return { data: null, error: SESION_INVALIDA_ERROR }
  const monto = r2(input.monto)
  if (monto <= 0) return { data: null, error: "El monto debe ser mayor a 0." }
  if (input.metodo === "Banco" && !input.cuenta_id) return { data: null, error: "Elige la cuenta bancaria." }

  const { data: oc } = await supabase.from("compras_encabezado").select("id, proveedores (nombre)").eq("id", input.compra_id).maybeSingle()
  if (!oc) return { data: null, error: "La orden no existe" }
  const prov = Array.isArray(oc.proveedores) ? oc.proveedores[0] : oc.proveedores
  const concepto = input.concepto?.trim() || `${input.tipo} OC-${input.compra_id}${(prov as { nombre?: string } | null)?.nombre ? ` · ${(prov as { nombre?: string }).nombre}` : ""}`

  const { data: pago, error } = await supabase
    .from("compras_pagos")
    .insert({
      compra_id: input.compra_id,
      recepcion_id: input.recepcion_id ?? null,
      tipo: input.tipo,
      monto,
      metodo: input.metodo,
      cuenta_id: input.metodo === "Banco" ? input.cuenta_id : null,
      referencia: input.referencia?.trim() || null,
      concepto,
      fecha: getHondurasNowISO(),
      ...stamp,
    })
    .select("*")
    .single()
  if (error) {
    if (isMissingTable(error)) return { data: null, error: RECEPCIONES_FEATURE_PENDING }
    return { data: null, error: error.message }
  }
  const pagoId = Number(pago.id)

  // Tesorería: sale dinero (caja o cuenta). Sin dinero registrado no hay pago.
  let tesErr: string | null = null
  if (input.metodo === "Efectivo") {
    const mov = await registrarMovimientoCaja({ tipo: "Salida", monto, concepto, ref_tipo: "compra_pago", ref_id: pagoId })
    tesErr = mov.error
  } else {
    const mov = await registrarMovimientoCuenta({
      cuenta_id: Number(input.cuenta_id),
      tipo: "Egreso",
      monto,
      concepto,
      ref_tipo: "compra_pago",
      ref_id: pagoId,
      referencia: input.referencia ?? null,
    })
    tesErr = mov.error
  }
  if (tesErr) {
    await supabase.from("compras_pagos").delete().eq("id", pagoId)
    return { data: null, error: tesErr }
  }
  await recalcularEstadoPagoCompra(supabase, input.compra_id)
  await registrarAuditoria(supabase, stamp, { entidad: "compra_pago", entidad_id: pagoId, accion: "crear", despues: { compra_id: input.compra_id, tipo: input.tipo, monto, metodo: input.metodo } })
  return { data: normPago(pago as Record<string, unknown>), error: null }
}

/** Anula un pago: contra-asiento en tesorería (entra el dinero de vuelta) y marca. */
export async function anularPagoCompra(id: number, motivo: string): Promise<{ error: string | null }> {
  const supabase = createClient()
  if (!supabase) return { error: "Cliente no disponible" }
  const stamp = await getTenantStamp(supabase)
  if (!isValidStamp(stamp)) return { error: SESION_INVALIDA_ERROR }
  const m = (motivo || "").trim()
  if (!m) return { error: "Indica el motivo de la anulación." }
  const { data: pago } = await supabase.from("compras_pagos").select("*").eq("id", id).maybeSingle()
  if (!pago) return { error: "El pago no existe" }
  if (pago.anulado_at) return { error: "El pago ya está anulado" }
  const { data: marcado, error } = await supabase
    .from("compras_pagos")
    .update({ anulado_at: new Date().toISOString(), motivo_anulacion: m })
    .eq("id", id)
    .is("anulado_at", null)
    .select("id")
  if (error) return { error: error.message }
  if (!marcado || marcado.length === 0) return { error: "El pago ya estaba anulado" }

  const concepto = `Anulación ${pago.tipo} OC-${pago.compra_id}: ${m}`
  const monto = Number(pago.monto)
  if (pago.metodo === "Efectivo") {
    const mov = await registrarMovimientoCaja({ tipo: "Ingreso_Manual", monto, concepto, ref_tipo: "anulacion_compra_pago", ref_id: id })
    if (mov.error) console.error("[compras-pagos] contra-asiento caja falló:", mov.error)
  } else if (pago.cuenta_id) {
    const mov = await registrarMovimientoCuenta({ cuenta_id: Number(pago.cuenta_id), tipo: "Ingreso", monto, concepto, ref_tipo: "anulacion_compra_pago", ref_id: id })
    if (mov.error) console.error("[compras-pagos] contra-asiento cuenta falló:", mov.error)
  }
  await recalcularEstadoPagoCompra(supabase, Number(pago.compra_id))
  await registrarAuditoria(supabase, stamp, { entidad: "compra_pago", entidad_id: id, accion: "anular", motivo: m, antes: pago })
  return { error: null }
}

// ==================== CUENTAS POR PAGAR (OC A CRÉDITO) ====================

export interface CuentaPorPagarCompra {
  compra_id: number
  proveedor_nombre: string | null
  numero_factura: string | null
  fecha_orden: string | null
  fecha_vencimiento: string | null
  total_debido: number
  monto_pagado: number
  saldo: number
  estado_pago: EstadoPagoCompra
  dias_vencido: number | null
}

/** OCs con saldo por pagar (lo recibido − pagos vigentes), incluidas las que solo tienen anticipo. */
export async function getCuentasPorPagarCompras(
  hoyISO: string
): Promise<{ data: CuentaPorPagarCompra[]; totalDeuda: number; error: string | null; pendiente: boolean }> {
  if (!isSupabaseConfigured()) return { data: [], totalDeuda: 0, error: null, pendiente: false }
  const supabase = createClient()
  if (!supabase) return { data: [], totalDeuda: 0, error: "Cliente no disponible", pendiente: false }
  const { data, error } = await supabase
    .from("compras_encabezado")
    .select("id, numero_factura, fecha_orden, fecha_vencimiento, total_recibido_local, total_compra_local, monto_pagado, estado_pago, forma_pago, proveedores (nombre)")
    .neq("estado", "Cancelada")
    .order("fecha_vencimiento", { ascending: true, nullsFirst: false })
  if (error) {
    if (/total_recibido_local|monto_pagado|estado_pago|forma_pago/i.test(error.message || "")) return { data: [], totalDeuda: 0, error: null, pendiente: true }
    return { data: [], totalDeuda: 0, error: error.message, pendiente: false }
  }
  const out: CuentaPorPagarCompra[] = []
  for (const c of (data || []) as Record<string, unknown>[]) {
    // Solo OCs que pasaron por el flujo nuevo (tienen recibido registrado) o con pagos.
    if (c.total_recibido_local == null && c.monto_pagado == null) continue
    const debido = r2(Number(c.total_recibido_local ?? 0))
    const pagado = r2(Number(c.monto_pagado ?? 0))
    const saldo = r2(debido - pagado)
    if (saldo <= 0.005) continue
    const prov = Array.isArray(c.proveedores) ? c.proveedores[0] : c.proveedores
    const venc = (c.fecha_vencimiento as string) ?? null
    let diasVencido: number | null = null
    if (venc) {
      const a = new Date(`${venc.slice(0, 10)}T00:00:00Z`).getTime()
      const b = new Date(`${hoyISO.slice(0, 10)}T00:00:00Z`).getTime()
      diasVencido = Math.max(0, Math.round((b - a) / 86_400_000))
    }
    out.push({
      compra_id: Number(c.id),
      proveedor_nombre: (prov as { nombre?: string } | null)?.nombre ?? null,
      numero_factura: (c.numero_factura as string) ?? null,
      fecha_orden: (c.fecha_orden as string) ?? null,
      fecha_vencimiento: venc,
      total_debido: debido,
      monto_pagado: pagado,
      saldo,
      estado_pago: derivarEstadoPagoCompra(debido, pagado),
      dias_vencido: diasVencido,
    })
  }
  return { data: out, totalDeuda: r2(out.reduce((a, x) => a + x.saldo, 0)), error: null, pendiente: false }
}
