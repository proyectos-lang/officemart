import { createClient, isSupabaseConfigured } from '@/lib/supabase/client'
import { getTenantStamp, isValidStamp, SESION_INVALIDA_ERROR } from '@/lib/services/tenant-stamp'
import {
  getCompraById,
  getDetallesCompra,
  calcularProrrateoDetallado,
  type CompraDetalle,
  type ProrrateoResultado,
} from '@/lib/services/compras'
import { previewAjusteCosto, procesarAjusteCosto, type PreviewAjusteCosto } from '@/lib/services/costo'
import { getRecepcionesCompra } from '@/lib/services/compras-recepciones'

/**
 * Recalcular una recepcion de importacion YA RECIBIDA con costos fijos nuevos.
 *
 * Toma una compra `Recibida` (importacion/compra por OC), re-corre el prorrateo
 * (`calcularProrrateoDetallado`) con costos fijos corregidos (importacion,
 * impuestos, otros, tasa de cambio) y:
 *   1) actualiza los registros del lote — `compras_encabezado` (costos + total),
 *      `compras_detalle.costo_final_local` y el kardex `transacciones_inventario`
 *      ('Entrada Compra') — para que reflejen el costo corregido;
 *   2) corrige el `costo_promedio` de cada producto por AJUSTE DE DELTA:
 *      `costo_actual + (Σ (nuevo_final − viejo_final)·cantidad_recibida) / stock_actual`
 *      (el promedio ponderado no es reversible por lote), reutilizando toda la
 *      maquinaria del modulo Ajuste de Costo (`procesarAjusteCosto`), que ademas
 *      recalcula OPCIONALMENTE el costo de las ventas pasadas del rango.
 *
 * Nota de atomicidad: los updates del punto 1 son varias llamadas cliente (igual
 * que `procesarRecepcion`, NO transaccional); el ajuste de costo/COGS por
 * producto del punto 2 si es atomico (RPC `recalcular_costo_ventas`).
 *
 * Solo aplica a recepciones por Orden de Compra: las de Recepcion por Factura
 * (IA) no dejan fila en `compras_*` y no aparecen aqui.
 */

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

// ==================== TIPOS ====================

export interface RecalculoRecepcionInput {
  compraId: number
  costos_importacion: number
  impuestos_compra: number
  otros_costos: number
  tasa_cambio: number
  /** Recalcular retroactivamente el costo de las ventas pasadas del rango. */
  recalcular: boolean
  desde?: string
  hasta?: string
  motivo?: string
}

/** Impacto por producto del recalculo (para el preview). */
export interface PreviewProductoRecalculo {
  producto_id: number
  producto_nombre: string
  /** Cantidad recibida total del producto en este lote. */
  cantidad: number
  /** costo_final_local promedio ANTES (ponderado por cantidad si hay varias lineas). */
  costoFinalViejo: number
  /** costo_final_local promedio DESPUES del recalculo. */
  costoFinalNuevo: number
  /** Delta del valor del lote para el producto = Σ (nuevo − viejo)·cantidad. */
  deltaValorLote: number
  stock: number
  costoPromActual: number
  costoPromNuevo: number
  /** Impacto en valoracion/CMV (null si stock 0 o sin cambio). */
  impacto: PreviewAjusteCosto | null
}

export interface PreviewRecalculoRecepcion {
  prorrateo: ProrrateoResultado
  productos: PreviewProductoRecalculo[]
  totalAnterior: number
  totalNuevo: number
}

// ==================== HELPERS INTERNOS ====================

/** Lineas efectivamente recibidas (cantidad_recibida > 0), con cantidad = recibida. */
function lineasRecibidas(detalles: CompraDetalle[]): CompraDetalle[] {
  return detalles
    .map((d) => ({ ...d, cantidad: Number(d.cantidad_recibida ?? d.cantidad ?? 0) }))
    .filter((d) => d.cantidad > 0)
}

/**
 * Agrega, por producto, el costo_final viejo/nuevo (ponderado por cantidad) y el
 * delta de valor del lote. `viejoPorDetalle` mapea detalle_id -> costo_final_local
 * actual guardado en `compras_detalle`.
 */
function agregarPorProducto(
  prorrateo: ProrrateoResultado,
  viejoPorDetalle: Map<number, number>,
  nombrePorProducto: Map<number, string>
) {
  const acc = new Map<
    number,
    { producto_id: number; nombre: string; qty: number; valorViejo: number; valorNuevo: number }
  >()
  for (const l of prorrateo.lineas) {
    const viejoFinal = viejoPorDetalle.get(l.detalle_id) ?? 0
    const cur =
      acc.get(l.producto_id) ??
      {
        producto_id: l.producto_id,
        nombre: l.producto_nombre || nombrePorProducto.get(l.producto_id) || `Producto #${l.producto_id}`,
        qty: 0,
        valorViejo: 0,
        valorNuevo: 0,
      }
    cur.qty += l.cantidad
    cur.valorViejo += viejoFinal * l.cantidad
    cur.valorNuevo += l.costo_final_unitario * l.cantidad
    acc.set(l.producto_id, cur)
  }
  return acc
}

// ==================== PREVIEW (solo lecturas) ====================

export async function previewRecalculoRecepcion(
  input: RecalculoRecepcionInput
): Promise<{ data: PreviewRecalculoRecepcion | null; error: string | null }> {
  if (!isSupabaseConfigured()) return { data: null, error: 'Supabase no configurado' }
  const supabase = createClient()
  if (!supabase) return { data: null, error: 'Cliente no disponible' }

  const { data: compra, error: compraErr } = await getCompraById(input.compraId)
  if (compraErr || !compra) return { data: null, error: compraErr || 'Compra no encontrada' }

  const { data: detalles, error: detErr } = await getDetallesCompra(input.compraId)
  if (detErr) return { data: null, error: detErr }

  const recibidas = lineasRecibidas(detalles)
  if (recibidas.length === 0) return { data: null, error: 'La compra no tiene lineas recibidas' }

  // Con varias recepciones parciales (officemart-008) el lote no es uno solo:
  // el prorrateo se hizo por recepción y este recálculo lo mezclaría.
  const { data: recepciones } = await getRecepcionesCompra(input.compraId)
  if (recepciones.length > 1) {
    return {
      data: null,
      error: `La OC tiene ${recepciones.length} recepciones parciales; el recálculo por lote solo aplica a compras recibidas en una sola recepción. Ajusta el costo desde Inventario → Ajuste de Costo.`,
    }
  }

  const costosNuevos = round2(
    Number(input.costos_importacion || 0) + Number(input.impuestos_compra || 0) + Number(input.otros_costos || 0)
  )
  const prorrateo = calcularProrrateoDetallado(recibidas, costosNuevos, compra.moneda, Number(input.tasa_cambio || 1))

  const viejoPorDetalle = new Map<number, number>()
  const nombrePorProducto = new Map<number, string>()
  for (const d of recibidas) {
    if (d.id != null) viejoPorDetalle.set(d.id, Number(d.costo_final_local || 0))
    nombrePorProducto.set(d.producto_id, d.producto_nombre || '')
  }

  const agregado = agregarPorProducto(prorrateo, viejoPorDetalle, nombrePorProducto)
  const productoIds = [...agregado.keys()]

  // Estado actual de los productos (stock + costo) en un solo query.
  const { data: prods } = await supabase
    .from('productos')
    .select('id, nombre, stock_total, costo_promedio')
    .in('id', productoIds)
  const prodMap = new Map<number, { stock: number; costo: number; nombre: string }>()
  for (const p of prods || []) {
    prodMap.set(p.id as number, {
      stock: Number(p.stock_total || 0),
      costo: Number(p.costo_promedio || 0),
      nombre: (p.nombre as string) || '',
    })
  }

  const usarRango = input.recalcular && !!input.desde && !!input.hasta && input.desde <= input.hasta

  const productos: PreviewProductoRecalculo[] = []
  for (const g of agregado.values()) {
    const est = prodMap.get(g.producto_id) ?? { stock: 0, costo: 0, nombre: g.nombre }
    const deltaValorLote = round2(g.valorNuevo - g.valorViejo)
    const costoFinalViejo = g.qty > 0 ? round2(g.valorViejo / g.qty) : 0
    const costoFinalNuevo = g.qty > 0 ? round2(g.valorNuevo / g.qty) : 0

    // Ajuste por delta sobre el costo promedio ACTUAL (solo si hay stock).
    const aplica = est.stock > 0 && Math.abs(deltaValorLote) > 0
    const costoPromNuevo = aplica ? Math.max(0, round2(est.costo + deltaValorLote / est.stock)) : est.costo

    let impacto: PreviewAjusteCosto | null = null
    if (aplica) {
      const res = await previewAjusteCosto(
        g.producto_id,
        costoPromNuevo,
        usarRango,
        usarRango ? input.desde : undefined,
        usarRango ? input.hasta : undefined
      )
      impacto = res.data
    }

    productos.push({
      producto_id: g.producto_id,
      producto_nombre: est.nombre || g.nombre,
      cantidad: g.qty,
      costoFinalViejo,
      costoFinalNuevo,
      deltaValorLote,
      stock: est.stock,
      costoPromActual: est.costo,
      costoPromNuevo,
      impacto,
    })
  }

  const totalNuevo = round2(prorrateo.lineas.reduce((acc, l) => acc + l.cantidad * l.costo_final_unitario, 0))

  return {
    data: {
      prorrateo,
      productos,
      totalAnterior: Number(compra.total_compra_local || 0),
      totalNuevo,
    },
    error: null,
  }
}

// ==================== PROCESAR ====================

export async function procesarRecalculoRecepcion(
  input: RecalculoRecepcionInput
): Promise<{ success: boolean; productosAfectados: number; ventasAfectadas: number; error: string | null }> {
  if (!isSupabaseConfigured()) {
    return { success: false, productosAfectados: 0, ventasAfectadas: 0, error: 'Supabase no configurado' }
  }
  const supabase = createClient()
  if (!supabase) return { success: false, productosAfectados: 0, ventasAfectadas: 0, error: 'Cliente no disponible' }

  const stamp = await getTenantStamp(supabase)
  if (!isValidStamp(stamp)) {
    return { success: false, productosAfectados: 0, ventasAfectadas: 0, error: SESION_INVALIDA_ERROR }
  }

  const { data: compra, error: compraErr } = await getCompraById(input.compraId)
  if (compraErr || !compra) {
    return { success: false, productosAfectados: 0, ventasAfectadas: 0, error: compraErr || 'Compra no encontrada' }
  }
  if (compra.estado !== 'Recibida') {
    return { success: false, productosAfectados: 0, ventasAfectadas: 0, error: 'Solo se pueden recalcular compras ya recibidas' }
  }
  const { data: recepciones } = await getRecepcionesCompra(input.compraId)
  if (recepciones.length > 1) {
    return { success: false, productosAfectados: 0, ventasAfectadas: 0, error: 'La OC tiene varias recepciones parciales; el recálculo por lote no aplica.' }
  }

  const { data: detalles, error: detErr } = await getDetallesCompra(input.compraId)
  if (detErr) return { success: false, productosAfectados: 0, ventasAfectadas: 0, error: detErr }

  const recibidas = lineasRecibidas(detalles)
  if (recibidas.length === 0) {
    return { success: false, productosAfectados: 0, ventasAfectadas: 0, error: 'La compra no tiene lineas recibidas' }
  }

  const costos_importacion = round2(Number(input.costos_importacion || 0))
  const impuestos_compra = round2(Number(input.impuestos_compra || 0))
  const otros_costos = round2(Number(input.otros_costos || 0))
  const tasa_cambio = Number(input.tasa_cambio || 1)
  const costosNuevos = round2(costos_importacion + impuestos_compra + otros_costos)

  const prorrateo = calcularProrrateoDetallado(recibidas, costosNuevos, compra.moneda, tasa_cambio)
  const finalPorDetalle = new Map<number, number>()
  for (const l of prorrateo.lineas) finalPorDetalle.set(l.detalle_id, l.costo_final_unitario)

  const totalNuevo = round2(prorrateo.lineas.reduce((acc, l) => acc + l.cantidad * l.costo_final_unitario, 0))

  // 1) Encabezado del lote: costos + tasa + total.
  const { error: encErr } = await supabase
    .from('compras_encabezado')
    .update({
      costos_importacion,
      impuestos_compra,
      otros_costos,
      tasa_cambio,
      total_compra_local: totalNuevo,
    })
    .eq('id', input.compraId)
  if (encErr) return { success: false, productosAfectados: 0, ventasAfectadas: 0, error: encErr.message }

  // 2/3) Por linea recibida: costo_final_local y el kardex de la entrada.
  for (const d of recibidas) {
    if (d.id == null) continue
    const nuevoFinal = finalPorDetalle.get(d.id) ?? 0

    const { error: dErr } = await supabase
      .from('compras_detalle')
      .update({ costo_final_local: nuevoFinal })
      .eq('id', d.id)
    if (dErr) return { success: false, productosAfectados: 0, ventasAfectadas: 0, error: dErr.message }

    await supabase
      .from('transacciones_inventario')
      .update({ costo_o_precio_unitario: nuevoFinal })
      .eq('referencia_id', input.compraId)
      .eq('producto_id', d.producto_id)
      .eq('tipo_movimiento', 'Entrada Compra')
  }

  // 4) Ajuste de costo por producto (delta) + recalculo de ventas opcional.
  const viejoPorDetalle = new Map<number, number>()
  const nombrePorProducto = new Map<number, string>()
  for (const d of recibidas) {
    if (d.id != null) viejoPorDetalle.set(d.id, Number(d.costo_final_local || 0))
    nombrePorProducto.set(d.producto_id, d.producto_nombre || '')
  }
  const agregado = agregarPorProducto(prorrateo, viejoPorDetalle, nombrePorProducto)

  const usarRango = input.recalcular && !!input.desde && !!input.hasta && input.desde <= input.hasta
  const motivo = input.motivo || `Recalculo recepcion #${input.compraId}`

  let productosAfectados = 0
  let ventasAfectadas = 0
  let ajusteError: string | null = null

  for (const g of agregado.values()) {
    const deltaValorLote = round2(g.valorNuevo - g.valorViejo)
    if (Math.abs(deltaValorLote) === 0) continue

    // Estado fresco del producto para el ajuste por delta.
    const { data: prod, error: prodErr } = await supabase
      .from('productos')
      .select('stock_total, costo_promedio')
      .eq('id', g.producto_id)
      .single()
    if (prodErr) {
      ajusteError = prodErr.message
      continue
    }
    const stock = Number(prod?.stock_total || 0)
    if (stock <= 0) continue // sin stock no hay ajuste hacia adelante posible.

    const costoActual = Number(prod?.costo_promedio || 0)
    const target = Math.max(0, round2(costoActual + deltaValorLote / stock))
    if (target === round2(costoActual)) continue

    const res = await procesarAjusteCosto({
      producto_id: g.producto_id,
      costo_nuevo: target,
      recalcular: usarRango,
      desde: usarRango ? input.desde : undefined,
      hasta: usarRango ? input.hasta : undefined,
      motivo,
    })
    if (!res.success) {
      ajusteError = res.error
      continue
    }
    productosAfectados += 1
    ventasAfectadas += res.ventasAfectadas
  }

  if (ajusteError) {
    return {
      success: true,
      productosAfectados,
      ventasAfectadas,
      error: `Lote recalculado, pero el ajuste de costo fallo en algun producto: ${ajusteError}`,
    }
  }
  return { success: true, productosAfectados, ventasAfectadas, error: null }
}
