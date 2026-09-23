import { createClient, isSupabaseConfigured } from "@/lib/supabase/client"

/**
 * Reportes de compras (Fase 3.2): estadísticas de órdenes de compra
 * (ordenado vs recibido, cumplimiento, lead time real, en tránsito, top
 * productos) y estado de cuenta de proveedor (OC recibidas + gastos con
 * proveedor vs pagos), sobre `compras_*`, `compras_recepciones`,
 * `compras_pagos`, `gastos` y tesorería. Sin tabla propia; agregaciones puras.
 */

export interface OcResumen {
  compra_id: number
  proveedor_id: number | null
  proveedor_nombre: string | null
  numero_factura: string | null
  fecha_orden: string | null
  fecha_tentativa: string | null
  estado: string
  moneda: string
  tasa_cambio: number
  unidades_ordenadas: number
  unidades_recibidas: number
  /** % recibido sobre ordenado (0–100). */
  cumplimiento: number
  valor_ordenado_local: number
  valor_recibido_local: number
  /** Valor pendiente de recibir (L). */
  en_transito_local: number
  /** Días entre la orden y la PRIMERA recepción; null si no se ha recibido. */
  lead_time_dias: number | null
  /** Días entre la fecha tentativa y la primera recepción (+ = tarde). */
  retraso_dias: number | null
  recepciones: number
}

export interface ProveedorResumen {
  proveedor_id: number | null
  proveedor_nombre: string
  ordenes: number
  valor_ordenado: number
  valor_recibido: number
  cumplimiento: number
  lead_time_promedio: number | null
  ordenes_tarde: number
  en_transito: number
}

export interface ProductoComprado {
  producto_id: number
  producto_nombre: string
  unidades: number
  valor_local: number
  ordenes: number
  costo_promedio_compra: number
}

export interface EstadisticasOC {
  ordenes: OcResumen[]
  porProveedor: ProveedorResumen[]
  topProductos: ProductoComprado[]
  totales: {
    ordenes: number
    valor_ordenado: number
    valor_recibido: number
    en_transito: number
    cumplimiento: number
    lead_time_promedio: number | null
    ordenes_tarde: number
  }
}

// ---- entradas crudas ----
export interface CompraStat {
  id: number
  proveedor_id: number | null
  proveedor_nombre: string | null
  numero_factura: string | null
  fecha_orden: string | null
  fecha_tentativa: string | null
  estado: string
  moneda: string
  tasa_cambio: number
  total_compra_local: number
}
export interface DetalleStat {
  compra_id: number
  producto_id: number
  producto_nombre: string | null
  cantidad: number
  cantidad_recibida: number
  costo_unitario_moneda_origen: number
  costo_final_local: number
}
export interface RecepcionStat {
  compra_id: number
  fecha: string
  total_local: number
}

function r2(n: number): number {
  return +(Number(n) || 0).toFixed(2)
}

function dias(desdeISO: string | null | undefined, hastaISO: string | null | undefined): number | null {
  if (!desdeISO || !hastaISO) return null
  const a = new Date(`${desdeISO.slice(0, 10)}T00:00:00Z`).getTime()
  const b = new Date(`${hastaISO.slice(0, 10)}T00:00:00Z`).getTime()
  if (Number.isNaN(a) || Number.isNaN(b)) return null
  return Math.round((b - a) / 86_400_000)
}

/** Agrega OCs, líneas y recepciones en estadísticas (pura). */
export function calcularEstadisticasOC(compras: CompraStat[], detalles: DetalleStat[], recepciones: RecepcionStat[]): EstadisticasOC {
  const detPorCompra = new Map<number, DetalleStat[]>()
  for (const d of detalles) {
    const l = detPorCompra.get(d.compra_id) || []
    l.push(d)
    detPorCompra.set(d.compra_id, l)
  }
  const recPorCompra = new Map<number, RecepcionStat[]>()
  for (const r of recepciones) {
    const l = recPorCompra.get(r.compra_id) || []
    l.push(r)
    recPorCompra.set(r.compra_id, l)
  }

  const ordenes: OcResumen[] = compras.map((c) => {
    const det = detPorCompra.get(c.id) || []
    const tasa = c.moneda === "USD" ? Number(c.tasa_cambio || 1) : 1
    const uo = det.reduce((a, d) => a + Number(d.cantidad || 0), 0)
    const ur = det.reduce((a, d) => a + Math.min(Number(d.cantidad || 0), Number(d.cantidad_recibida || 0)), 0)
    const vo = det.reduce((a, d) => a + Number(d.cantidad || 0) * Number(d.costo_unitario_moneda_origen || 0) * tasa, 0)
    const recs = (recPorCompra.get(c.id) || []).slice().sort((x, y) => (x.fecha < y.fecha ? -1 : 1))
    // Valor recibido: suma de recepciones; OC clásica recibida sin recepciones → total_compra_local.
    const vr = recs.length > 0 ? recs.reduce((a, r) => a + Number(r.total_local || 0), 0) : c.estado === "Recibida" ? Number(c.total_compra_local || 0) : 0
    const pendUnid = Math.max(0, uo - ur)
    const enTransito = c.estado === "Pendiente" ? det.reduce((a, d) => a + Math.max(0, Number(d.cantidad || 0) - Number(d.cantidad_recibida || 0)) * Number(d.costo_unitario_moneda_origen || 0) * tasa, 0) : 0
    const primera = recs[0]?.fecha ?? null
    const lead = primera ? dias(c.fecha_orden, primera) : c.estado === "Recibida" && recs.length === 0 ? null : null
    return {
      compra_id: c.id,
      proveedor_id: c.proveedor_id,
      proveedor_nombre: c.proveedor_nombre,
      numero_factura: c.numero_factura,
      fecha_orden: c.fecha_orden,
      fecha_tentativa: c.fecha_tentativa,
      estado: c.estado,
      moneda: c.moneda,
      tasa_cambio: tasa,
      unidades_ordenadas: r2(uo),
      unidades_recibidas: r2(ur),
      cumplimiento: uo > 0 ? r2((ur / uo) * 100) : 0,
      valor_ordenado_local: r2(vo),
      valor_recibido_local: r2(vr),
      en_transito_local: r2(pendUnid > 0 ? enTransito : 0),
      lead_time_dias: lead,
      retraso_dias: primera && c.fecha_tentativa ? dias(c.fecha_tentativa, primera) : null,
      recepciones: recs.length,
    }
  })

  // Por proveedor.
  const provMap = new Map<string, ProveedorResumen & { _leads: number[] }>()
  for (const o of ordenes) {
    const k = String(o.proveedor_id ?? "x")
    let p = provMap.get(k)
    if (!p) {
      p = { proveedor_id: o.proveedor_id, proveedor_nombre: o.proveedor_nombre || "(Sin proveedor)", ordenes: 0, valor_ordenado: 0, valor_recibido: 0, cumplimiento: 0, lead_time_promedio: null, ordenes_tarde: 0, en_transito: 0, _leads: [] }
      provMap.set(k, p)
    }
    p.ordenes += 1
    p.valor_ordenado += o.valor_ordenado_local
    p.valor_recibido += o.valor_recibido_local
    p.en_transito += o.en_transito_local
    if (o.lead_time_dias != null) p._leads.push(o.lead_time_dias)
    if (o.retraso_dias != null && o.retraso_dias > 0) p.ordenes_tarde += 1
  }
  const porProveedor: ProveedorResumen[] = [...provMap.values()].map(({ _leads, ...p }) => ({
    ...p,
    valor_ordenado: r2(p.valor_ordenado),
    valor_recibido: r2(p.valor_recibido),
    en_transito: r2(p.en_transito),
    cumplimiento: p.valor_ordenado > 0 ? r2(Math.min(100, (p.valor_recibido / p.valor_ordenado) * 100)) : 0,
    lead_time_promedio: _leads.length > 0 ? r2(_leads.reduce((a, b) => a + b, 0) / _leads.length) : null,
  })).sort((a, b) => b.valor_ordenado - a.valor_ordenado)

  // Top productos comprados (por valor ordenado).
  const prodMap = new Map<number, ProductoComprado & { _ordenes: Set<number> }>()
  const tasaPorCompra = new Map(compras.map((c) => [c.id, c.moneda === "USD" ? Number(c.tasa_cambio || 1) : 1]))
  for (const d of detalles) {
    const tasa = tasaPorCompra.get(d.compra_id) ?? 1
    let p = prodMap.get(d.producto_id)
    if (!p) {
      p = { producto_id: d.producto_id, producto_nombre: d.producto_nombre || `#${d.producto_id}`, unidades: 0, valor_local: 0, ordenes: 0, costo_promedio_compra: 0, _ordenes: new Set() }
      prodMap.set(d.producto_id, p)
    }
    p.unidades += Number(d.cantidad || 0)
    p.valor_local += Number(d.cantidad || 0) * Number(d.costo_unitario_moneda_origen || 0) * tasa
    p._ordenes.add(d.compra_id)
  }
  const topProductos: ProductoComprado[] = [...prodMap.values()]
    .map(({ _ordenes, ...p }) => ({ ...p, unidades: r2(p.unidades), valor_local: r2(p.valor_local), ordenes: _ordenes.size, costo_promedio_compra: p.unidades > 0 ? r2(p.valor_local / p.unidades) : 0 }))
    .sort((a, b) => b.valor_local - a.valor_local)
    .slice(0, 50)

  const leads = ordenes.map((o) => o.lead_time_dias).filter((x): x is number => x != null)
  const vo = ordenes.reduce((a, o) => a + o.valor_ordenado_local, 0)
  const vr = ordenes.reduce((a, o) => a + o.valor_recibido_local, 0)
  return {
    ordenes,
    porProveedor,
    topProductos,
    totales: {
      ordenes: ordenes.length,
      valor_ordenado: r2(vo),
      valor_recibido: r2(vr),
      en_transito: r2(ordenes.reduce((a, o) => a + o.en_transito_local, 0)),
      cumplimiento: vo > 0 ? r2(Math.min(100, (vr / vo) * 100)) : 0,
      lead_time_promedio: leads.length > 0 ? r2(leads.reduce((a, b) => a + b, 0) / leads.length) : null,
      ordenes_tarde: ordenes.filter((o) => o.retraso_dias != null && o.retraso_dias > 0).length,
    },
  }
}

export async function getEstadisticasOC(desde: string, hasta: string): Promise<{ data: EstadisticasOC | null; error: string | null }> {
  if (!isSupabaseConfigured()) return { data: null, error: null }
  const supabase = createClient()
  if (!supabase) return { data: null, error: "Cliente no disponible" }
  try {
    const { data: comprasRaw, error } = await supabase
      .from("compras_encabezado")
      .select("id, proveedor_id, numero_factura, fecha_orden, fecha_tentativa, estado, moneda, tasa_cambio, total_compra_local, proveedores (nombre)")
      .gte("fecha_orden", `${desde}T00:00:00`)
      .lte("fecha_orden", `${hasta}T23:59:59`)
      .neq("estado", "Cancelada")
      .order("fecha_orden", { ascending: false })
    if (error) return { data: null, error: error.message }
    const compras: CompraStat[] = (comprasRaw || []).map((c: Record<string, unknown>) => {
      const prov = Array.isArray(c.proveedores) ? c.proveedores[0] : c.proveedores
      return {
        id: Number(c.id),
        proveedor_id: c.proveedor_id != null ? Number(c.proveedor_id) : null,
        proveedor_nombre: (prov as { nombre?: string } | null)?.nombre ?? null,
        numero_factura: (c.numero_factura as string) ?? null,
        fecha_orden: (c.fecha_orden as string) ?? null,
        fecha_tentativa: (c.fecha_tentativa as string) ?? null,
        estado: String(c.estado ?? ""),
        moneda: String(c.moneda ?? "LPS"),
        tasa_cambio: Number(c.tasa_cambio ?? 1),
        total_compra_local: Number(c.total_compra_local ?? 0),
      }
    })
    const ids = compras.map((c) => c.id)
    if (ids.length === 0) return { data: calcularEstadisticasOC([], [], []), error: null }
    const [detRes, recRes] = await Promise.all([
      supabase.from("compras_detalle").select("compra_id, producto_id, cantidad, cantidad_recibida, costo_unitario_moneda_origen, costo_final_local, productos (nombre)").in("compra_id", ids),
      supabase.from("compras_recepciones").select("compra_id, fecha, total_local").in("compra_id", ids),
    ])
    const detalles: DetalleStat[] = (detRes.data || []).map((d: Record<string, unknown>) => {
      const prod = Array.isArray(d.productos) ? d.productos[0] : d.productos
      return {
        compra_id: Number(d.compra_id),
        producto_id: Number(d.producto_id),
        producto_nombre: (prod as { nombre?: string } | null)?.nombre ?? null,
        cantidad: Number(d.cantidad ?? 0),
        cantidad_recibida: Number(d.cantidad_recibida ?? 0),
        costo_unitario_moneda_origen: Number(d.costo_unitario_moneda_origen ?? 0),
        costo_final_local: Number(d.costo_final_local ?? 0),
      }
    })
    const recepciones: RecepcionStat[] = (recRes.error ? [] : recRes.data || []).map((r: Record<string, unknown>) => ({
      compra_id: Number(r.compra_id),
      fecha: String(r.fecha ?? ""),
      total_local: Number(r.total_local ?? 0),
    }))
    return { data: calcularEstadisticasOC(compras, detalles, recepciones), error: null }
  } catch (err) {
    console.error("[reportes-compras] estadisticas:", err)
    return { data: null, error: "Error de conexión" }
  }
}

// ==================== ESTADO DE CUENTA DE PROVEEDOR ====================

export interface MovimientoProveedor {
  fecha: string
  tipo: "Compra" | "Gasto" | "Pago"
  documento: string
  referencia: string | null
  debito: number
  credito: number
  saldo: number
}

export interface EstadoCuentaProveedor {
  saldoInicial: number
  movimientos: MovimientoProveedor[]
  totalDebitos: number
  totalCreditos: number
  saldoFinal: number
  /** Documentos con saldo (OC a crédito y gastos pendientes) a hoy. */
  pendientes: { documento: string; fecha: string; vence: string | null; total: number; saldo: number; dias_vencido: number | null }[]
}

/** Saldo corrido genérico con rango (pura). */
export function construirEstadoCuentaProveedor(
  brutos: Omit<MovimientoProveedor, "saldo">[],
  pendientes: EstadoCuentaProveedor["pendientes"],
  desde?: string | null,
  hasta?: string | null
): EstadoCuentaProveedor {
  const orden = [...brutos].sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : a.debito > 0 ? -1 : 1))
  let saldoInicial = 0
  let saldo = 0
  let totalDebitos = 0
  let totalCreditos = 0
  const movimientos: MovimientoProveedor[] = []
  for (const m of orden) {
    const f = m.fecha.slice(0, 10)
    if (desde && f < desde.slice(0, 10)) {
      saldoInicial += m.debito - m.credito
      continue
    }
    if (hasta && f > hasta.slice(0, 10)) continue
    if (movimientos.length === 0) saldo = saldoInicial
    saldo += m.debito - m.credito
    totalDebitos += m.debito
    totalCreditos += m.credito
    movimientos.push({ ...m, saldo: r2(saldo) })
  }
  return {
    saldoInicial: r2(saldoInicial),
    movimientos,
    totalDebitos: r2(totalDebitos),
    totalCreditos: r2(totalCreditos),
    saldoFinal: movimientos.length > 0 ? movimientos[movimientos.length - 1].saldo : r2(saldoInicial),
    pendientes,
  }
}

export async function getEstadoCuentaProveedor(
  proveedorId: number,
  opts: { desde?: string | null; hasta?: string | null; hoyISO: string }
): Promise<{ data: EstadoCuentaProveedor | null; error: string | null }> {
  if (!isSupabaseConfigured()) return { data: null, error: null }
  const supabase = createClient()
  if (!supabase) return { data: null, error: "Cliente no disponible" }
  try {
    const brutos: Omit<MovimientoProveedor, "saldo">[] = []
    const pendientes: EstadoCuentaProveedor["pendientes"] = []
    const diasV = (venc: string | null) => {
      if (!venc) return null
      const d = dias(venc, opts.hoyISO)
      return d != null && d > 0 ? d : 0
    }

    // 1) Órdenes de compra del proveedor.
    const { data: ocs, error: ocErr } = await supabase
      .from("compras_encabezado")
      .select("*")
      .eq("proveedor_id", proveedorId)
      .neq("estado", "Cancelada")
    if (ocErr) return { data: null, error: ocErr.message }
    const ocIds = (ocs || []).map((o: { id: number }) => o.id)
    const [recRes, pagRes] = ocIds.length > 0
      ? await Promise.all([
          supabase.from("compras_recepciones").select("compra_id, numero, fecha, total_local, numero_factura_proveedor").in("compra_id", ocIds),
          supabase.from("compras_pagos").select("compra_id, tipo, fecha, monto, metodo, referencia, anulado_at").in("compra_id", ocIds),
        ])
      : [{ data: [], error: null }, { data: [], error: null }]
    const recPorOC = new Map<number, Record<string, unknown>[]>()
    for (const r of (recRes.error ? [] : recRes.data || []) as Record<string, unknown>[]) {
      const l = recPorOC.get(Number(r.compra_id)) || []
      l.push(r)
      recPorOC.set(Number(r.compra_id), l)
    }
    for (const o of (ocs || []) as Record<string, unknown>[]) {
      const id = Number(o.id)
      const recs = recPorOC.get(id) || []
      let debidoOC = 0
      if (recs.length > 0) {
        for (const r of recs) {
          const t = Number(r.total_local || 0)
          debidoOC += t
          brutos.push({ fecha: String(r.fecha), tipo: "Compra", documento: `OC-${id} · rec. #${r.numero}`, referencia: (r.numero_factura_proveedor as string) || (o.numero_factura as string) || null, debito: r2(t), credito: 0 })
        }
      } else if (o.estado === "Recibida") {
        // OC clásica (una recepción implícita) con pago por gasto: no duplicar — el gasto ya está abajo.
        // Solo cuenta como débito si NO existe gasto asociado (heurística: descripción "Recepción de compra #id").
        debidoOC = 0
      }
      const pagos = ((pagRes.error ? [] : pagRes.data || []) as Record<string, unknown>[]).filter((p) => Number(p.compra_id) === id && !p.anulado_at)
      let pagadoOC = 0
      for (const p of pagos) {
        const m = Number(p.monto || 0)
        pagadoOC += m
        brutos.push({ fecha: String(p.fecha), tipo: "Pago", documento: `${p.tipo} OC-${id}`, referencia: [p.metodo, p.referencia].filter(Boolean).join(" · ") || null, debito: 0, credito: r2(m) })
      }
      const saldoOC = r2(debidoOC - pagadoOC)
      if (saldoOC > 0.005) {
        pendientes.push({ documento: `OC-${id}${o.numero_factura ? ` · ${o.numero_factura}` : ""}`, fecha: String(o.fecha_orden || ""), vence: (o.fecha_vencimiento as string) ?? null, total: r2(debidoOC), saldo: saldoOC, dias_vencido: diasV((o.fecha_vencimiento as string) ?? null) })
      }
    }

    // 2) Gastos con proveedor (facturas de servicios, o compras clásicas) y sus abonos.
    const { data: gastos } = await supabase
      .from("gastos")
      .select("id, fecha_gasto, monto, monto_pagado, estado_pago, descripcion, fecha_vencimiento, conceptos_gastos:concepto_id (nombre)")
      .eq("proveedor_id", proveedorId)
    const gastoIds = (gastos || []).map((g: { id: number }) => g.id)
    const abonosPorGasto = new Map<number, { fecha: string; monto: number; origen: string }[]>()
    if (gastoIds.length > 0) {
      const [caja, cta] = await Promise.all([
        supabase.from("caja_chica_movimientos").select("ref_id, monto, created_at, fecha").eq("ref_tipo", "gasto").in("ref_id", gastoIds),
        supabase.from("cuenta_movimientos").select("ref_id, monto, fecha").eq("ref_tipo", "gasto").in("ref_id", gastoIds),
      ])
      for (const m of (caja.data || []) as Record<string, unknown>[]) {
        const l = abonosPorGasto.get(Number(m.ref_id)) || []
        l.push({ fecha: String(m.fecha || m.created_at), monto: Number(m.monto || 0), origen: "Caja" })
        abonosPorGasto.set(Number(m.ref_id), l)
      }
      for (const m of (cta.data || []) as Record<string, unknown>[]) {
        const l = abonosPorGasto.get(Number(m.ref_id)) || []
        l.push({ fecha: String(m.fecha), monto: Number(m.monto || 0), origen: "Banco" })
        abonosPorGasto.set(Number(m.ref_id), l)
      }
    }
    for (const g of (gastos || []) as Record<string, unknown>[]) {
      const id = Number(g.id)
      const concepto = Array.isArray(g.conceptos_gastos) ? g.conceptos_gastos[0] : g.conceptos_gastos
      const monto = Number(g.monto || 0)
      brutos.push({ fecha: String(g.fecha_gasto), tipo: "Gasto", documento: `Gasto #${id}`, referencia: [(concepto as { nombre?: string } | null)?.nombre, g.descripcion].filter(Boolean).join(" · ") || null, debito: r2(monto), credito: 0 })
      const abonos = abonosPorGasto.get(id) || []
      let pagado = 0
      if (abonos.length > 0) {
        for (const a of abonos) {
          pagado += a.monto
          brutos.push({ fecha: a.fecha, tipo: "Pago", documento: `Abono gasto #${id}`, referencia: a.origen, debito: 0, credito: r2(a.monto) })
        }
      } else if (Number(g.monto_pagado || 0) > 0) {
        pagado = Number(g.monto_pagado || 0)
        brutos.push({ fecha: String(g.fecha_gasto), tipo: "Pago", documento: `Pago gasto #${id}`, referencia: null, debito: 0, credito: r2(pagado) })
      }
      const saldo = r2(monto - pagado)
      if (saldo > 0.005) {
        pendientes.push({ documento: `Gasto #${id}`, fecha: String(g.fecha_gasto), vence: (g.fecha_vencimiento as string) ?? null, total: r2(monto), saldo, dias_vencido: diasV((g.fecha_vencimiento as string) ?? null) })
      }
    }
    pendientes.sort((a, b) => (a.fecha < b.fecha ? -1 : 1))
    return { data: construirEstadoCuentaProveedor(brutos, pendientes, opts.desde, opts.hasta), error: null }
  } catch (err) {
    console.error("[reportes-compras] estado cuenta proveedor:", err)
    return { data: null, error: "Error de conexión" }
  }
}
