import { createClient, isSupabaseConfigured } from "@/lib/supabase/client"
import { getTenantStamp, isValidStamp, SESION_INVALIDA_ERROR } from "@/lib/services/tenant-stamp"
import { registrarAuditoria } from "@/lib/services/auditoria"
import { getConceptosGasto, createConceptoGasto, createGasto } from "@/lib/services/gastos"
import { getHondurasTodayISODate } from "@/lib/utils/honduras-time"
import { adjuntarRelacion } from "@/lib/services/relaciones"

/**
 * Comisiones de vendedores (script officemart-011).
 *
 *   - Políticas: % sobre venta o utilidad, al facturar o al cobrar, para un
 *     vendedor o todos, opcionalmente solo una categoría o línea, con vigencia.
 *   - Cálculo (`calcularComisiones`, puro): por línea vendida vigente se elige
 *     la política más específica; al cobro, la base se prorratea por lo cobrado
 *     en el período; las devoluciones vigentes restan.
 *   - Liquidación: cierra un período por vendedor, guarda el detalle y crea el
 *     gasto "Comisiones" (pagado de inmediato o pendiente).
 */

export const COMISIONES_FEATURE_PENDING =
  "Comisiones pendientes: aplica scripts/officemart-011-comisiones.sql en Supabase."

export type BaseComision = "venta" | "utilidad"
export type MomentoComision = "facturacion" | "cobro"

export interface PoliticaComision {
  id?: number
  nombre: string
  vendedor_id: number | null
  base: BaseComision
  porcentaje: number
  categoria_id: number | null
  linea_id: number | null
  momento: MomentoComision
  vigente_desde: string | null
  vigente_hasta: string | null
  activo: boolean
}

/** Línea vendida (de `vista_ventas_reporte`) reducida a lo que usa el cálculo. */
export interface LineaVentaComision {
  venta_id: number
  numero_factura: string
  fecha: string // YYYY-MM-DD
  vendedor_id: number | null
  categoria_id: number | null
  linea_id: number | null
  venta: number
  utilidad: number
  /** Total de la factura (para prorratear cobros). */
  total_factura: number
}

export interface CobroComision {
  venta_id: number
  fecha: string
  monto: number
  recibo_id: number | null
}

export interface DevolucionComision {
  id: number
  venta_id: number
  fecha: string
  monto_total: number
}

export interface ItemComision {
  vendedor_id: number
  venta_id: number
  numero_factura: string
  recibo_id: number | null
  devolucion_id: number | null
  fecha: string
  concepto: string
  base: number
  porcentaje: number
  monto: number
  politica: string
}

export interface ResumenVendedorComision {
  vendedor_id: number
  items: ItemComision[]
  ventas: number
  cobrado: number
  devoluciones: number
  comision: number
}

function r2(n: number): number {
  return +(Number(n) || 0).toFixed(2)
}

// ==================== FUNCIONES PURAS ====================

/**
 * Política aplicable a una línea (la más específica gana): primero las del
 * vendedor, luego las generales; dentro de cada grupo, con categoría o línea
 * antes que sin filtro. Solo activas y vigentes a la fecha.
 */
export function politicaAplicable(
  politicas: PoliticaComision[],
  linea: { vendedor_id: number | null; categoria_id: number | null; linea_id: number | null; fecha: string },
  momento: MomentoComision
): PoliticaComision | null {
  const f = linea.fecha.slice(0, 10)
  const cands = politicas.filter((p) => {
    if (!p.activo || p.momento !== momento) return false
    if (p.vigente_desde && f < p.vigente_desde) return false
    if (p.vigente_hasta && f > p.vigente_hasta) return false
    if (p.vendedor_id != null && p.vendedor_id !== linea.vendedor_id) return false
    if (p.categoria_id != null && p.categoria_id !== linea.categoria_id) return false
    if (p.linea_id != null && p.linea_id !== linea.linea_id) return false
    return true
  })
  if (cands.length === 0) return null
  const score = (p: PoliticaComision) => (p.vendedor_id != null ? 4 : 0) + (p.categoria_id != null ? 2 : 0) + (p.linea_id != null ? 1 : 0)
  cands.sort((a, b) => score(b) - score(a) || b.porcentaje - a.porcentaje)
  return cands[0]
}

/**
 * Calcula las comisiones del período por vendedor.
 *   - Momento 'facturacion': líneas vendidas cuya factura es del período.
 *   - Momento 'cobro': líneas de facturas con cobros en el período; la base es
 *     la parte de la línea proporcional a lo cobrado (cobro / total_factura).
 *   - Devoluciones vigentes del período restan proporcionalmente (con el %
 *     medio de la factura).
 * Las líneas sin vendedor se ignoran.
 */
export function calcularComisiones(input: {
  lineas: LineaVentaComision[]
  cobros: CobroComision[]
  devoluciones: DevolucionComision[]
  politicas: PoliticaComision[]
  desde: string
  hasta: string
}): ResumenVendedorComision[] {
  const enRango = (f: string) => {
    const d = (f || "").slice(0, 10)
    return d >= input.desde && d <= input.hasta
  }
  const porVendedor = new Map<number, ResumenVendedorComision>()
  const get = (vid: number) => {
    let r = porVendedor.get(vid)
    if (!r) {
      r = { vendedor_id: vid, items: [], ventas: 0, cobrado: 0, devoluciones: 0, comision: 0 }
      porVendedor.set(vid, r)
    }
    return r
  }
  const lineasPorVenta = new Map<number, LineaVentaComision[]>()
  for (const l of input.lineas) {
    if (l.vendedor_id == null) continue
    const arr = lineasPorVenta.get(l.venta_id) || []
    arr.push(l)
    lineasPorVenta.set(l.venta_id, arr)
  }

  // 1) Al facturar.
  for (const [ventaId, lineas] of lineasPorVenta) {
    const v0 = lineas[0]
    if (!enRango(v0.fecha)) continue
    const r = get(v0.vendedor_id!)
    r.ventas += lineas.reduce((a, l) => a + l.venta, 0)
    let base = 0
    let monto = 0
    let pol: PoliticaComision | null = null
    for (const l of lineas) {
      const p = politicaAplicable(input.politicas, l, "facturacion")
      if (!p) continue
      pol = pol ?? p
      const b = p.base === "utilidad" ? l.utilidad : l.venta
      base += b
      monto += b * (p.porcentaje / 100)
    }
    if (pol && Math.abs(monto) > 0.004) {
      r.items.push({ vendedor_id: r.vendedor_id, venta_id: ventaId, numero_factura: v0.numero_factura, recibo_id: null, devolucion_id: null, fecha: v0.fecha.slice(0, 10), concepto: `Venta ${v0.numero_factura}`, base: r2(base), porcentaje: base > 0 ? r2((monto / base) * 100) : pol.porcentaje, monto: r2(monto), politica: pol.nombre })
    }
  }

  // 2) Al cobro: cada cobro del período genera base proporcional.
  for (const c of input.cobros) {
    if (!enRango(c.fecha)) continue
    const lineas = lineasPorVenta.get(c.venta_id)
    if (!lineas || lineas.length === 0) continue
    const v0 = lineas[0]
    const total = v0.total_factura > 0 ? v0.total_factura : lineas.reduce((a, l) => a + l.venta, 0)
    if (total <= 0) continue
    const prop = Math.min(1, c.monto / total)
    const r = get(v0.vendedor_id!)
    r.cobrado += c.monto
    let base = 0
    let monto = 0
    let pol: PoliticaComision | null = null
    for (const l of lineas) {
      const p = politicaAplicable(input.politicas, l, "cobro")
      if (!p) continue
      pol = pol ?? p
      const b = (p.base === "utilidad" ? l.utilidad : l.venta) * prop
      base += b
      monto += b * (p.porcentaje / 100)
    }
    if (pol && Math.abs(monto) > 0.004) {
      r.items.push({ vendedor_id: r.vendedor_id, venta_id: c.venta_id, numero_factura: v0.numero_factura, recibo_id: c.recibo_id, devolucion_id: null, fecha: c.fecha.slice(0, 10), concepto: `Cobro ${v0.numero_factura}${c.recibo_id ? ` (recibo)` : ""}`, base: r2(base), porcentaje: base > 0 ? r2((monto / base) * 100) : pol.porcentaje, monto: r2(monto), politica: pol.nombre })
    }
  }

  // 3) Devoluciones del período restan con el % medio de la factura (política de facturación o de cobro).
  for (const d of input.devoluciones) {
    if (!enRango(d.fecha)) continue
    const lineas = lineasPorVenta.get(d.venta_id)
    if (!lineas || lineas.length === 0) continue
    const v0 = lineas[0]
    const total = v0.total_factura > 0 ? v0.total_factura : lineas.reduce((a, l) => a + l.venta, 0)
    if (total <= 0) continue
    const prop = Math.min(1, d.monto_total / total)
    const r = get(v0.vendedor_id!)
    r.devoluciones += d.monto_total
    let base = 0
    let monto = 0
    let pol: PoliticaComision | null = null
    for (const l of lineas) {
      const p = politicaAplicable(input.politicas, l, "facturacion") ?? politicaAplicable(input.politicas, l, "cobro")
      if (!p) continue
      pol = pol ?? p
      const b = (p.base === "utilidad" ? l.utilidad : l.venta) * prop
      base += b
      monto += b * (p.porcentaje / 100)
    }
    if (pol && Math.abs(monto) > 0.004) {
      r.items.push({ vendedor_id: r.vendedor_id, venta_id: d.venta_id, numero_factura: v0.numero_factura, recibo_id: null, devolucion_id: d.id, fecha: d.fecha.slice(0, 10), concepto: `Devolución de ${v0.numero_factura}`, base: r2(-base), porcentaje: base > 0 ? r2((monto / base) * 100) : pol.porcentaje, monto: r2(-monto), politica: pol.nombre })
    }
  }

  const out = [...porVendedor.values()].map((r) => ({
    ...r,
    ventas: r2(r.ventas),
    cobrado: r2(r.cobrado),
    devoluciones: r2(r.devoluciones),
    comision: r2(r.items.reduce((a, i) => a + i.monto, 0)),
    items: r.items.sort((a, b) => (a.fecha < b.fecha ? -1 : 1)),
  }))
  return out.sort((a, b) => b.comision - a.comision)
}

// ==================== POLÍTICAS ====================

function isMissingTable(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false
  const msg = (err.message || "").toLowerCase()
  return err.code === "42P01" || err.code === "PGRST205" || msg.includes("schema cache") || /relation .* does not exist/.test(msg)
}

function normPol(r: Record<string, unknown>): PoliticaComision {
  return {
    id: Number(r.id),
    nombre: String(r.nombre ?? ""),
    vendedor_id: r.vendedor_id != null ? Number(r.vendedor_id) : null,
    base: (r.base as BaseComision) ?? "venta",
    porcentaje: Number(r.porcentaje ?? 0),
    categoria_id: r.categoria_id != null ? Number(r.categoria_id) : null,
    linea_id: r.linea_id != null ? Number(r.linea_id) : null,
    momento: (r.momento as MomentoComision) ?? "cobro",
    vigente_desde: (r.vigente_desde as string) ?? null,
    vigente_hasta: (r.vigente_hasta as string) ?? null,
    activo: r.activo !== false,
  }
}

export async function getPoliticasComision(): Promise<{ data: PoliticaComision[]; error: string | null; pendiente: boolean }> {
  if (!isSupabaseConfigured()) return { data: [], error: null, pendiente: false }
  const supabase = createClient()
  if (!supabase) return { data: [], error: "Cliente no disponible", pendiente: false }
  const { data, error } = await supabase.from("politicas_comision").select("*").order("nombre", { ascending: true })
  if (error) {
    if (isMissingTable(error)) return { data: [], error: null, pendiente: true }
    return { data: [], error: error.message, pendiente: false }
  }
  return { data: (data || []).map((r) => normPol(r as Record<string, unknown>)), error: null, pendiente: false }
}

export async function savePoliticaComision(p: PoliticaComision): Promise<{ data: PoliticaComision | null; error: string | null }> {
  const supabase = createClient()
  if (!supabase) return { data: null, error: "Cliente no disponible" }
  const stamp = await getTenantStamp(supabase)
  if (!isValidStamp(stamp)) return { data: null, error: SESION_INVALIDA_ERROR }
  if (!p.nombre.trim()) return { data: null, error: "Ponle nombre a la política." }
  if (!(p.porcentaje > 0)) return { data: null, error: "El porcentaje debe ser mayor a 0." }
  const fila = {
    nombre: p.nombre.trim(),
    vendedor_id: p.vendedor_id ?? null,
    base: p.base,
    porcentaje: p.porcentaje,
    categoria_id: p.categoria_id ?? null,
    linea_id: p.linea_id ?? null,
    momento: p.momento,
    vigente_desde: p.vigente_desde || null,
    vigente_hasta: p.vigente_hasta || null,
    activo: p.activo,
  }
  if (p.id != null) {
    const { data, error } = await supabase.from("politicas_comision").update({ ...fila, updated_at: new Date().toISOString() }).eq("id", p.id).select("*").single()
    if (error) return { data: null, error: error.message }
    return { data: normPol(data as Record<string, unknown>), error: null }
  }
  const { data, error } = await supabase.from("politicas_comision").insert({ ...fila, ...stamp }).select("*").single()
  if (error) return { data: null, error: isMissingTable(error) ? COMISIONES_FEATURE_PENDING : error.message }
  return { data: normPol(data as Record<string, unknown>), error: null }
}

export async function deletePoliticaComision(id: number): Promise<{ error: string | null }> {
  const supabase = createClient()
  if (!supabase) return { error: "Cliente no disponible" }
  const { error } = await supabase.from("politicas_comision").delete().eq("id", id)
  return { error: error ? error.message : null }
}

// ==================== CÁLCULO DEL PERÍODO ====================

/** Ventas ya liquidadas (venta_id → true) para no comisionar dos veces al facturar. */
async function ventasYaLiquidadas(
  supabase: NonNullable<ReturnType<typeof createClient>>,
  vendedorIds: number[]
): Promise<Set<string>> {
  const out = new Set<string>()
  if (vendedorIds.length === 0) return out
  const { data: liqs } = await supabase.from("comisiones_liquidaciones").select("id").in("vendedor_id", vendedorIds).neq("estado", "Anulada")
  const ids = (liqs || []).map((l: { id: number }) => l.id)
  if (ids.length === 0) return out
  const { data: det } = await supabase.from("comisiones_liquidaciones_detalle").select("venta_id, recibo_id, devolucion_id").in("liquidacion_id", ids)
  for (const d of (det || []) as { venta_id: number | null; recibo_id: number | null; devolucion_id: number | null }[]) {
    if (d.devolucion_id != null) out.add(`dev:${d.devolucion_id}`)
    else if (d.recibo_id != null) out.add(`rec:${d.recibo_id}:${d.venta_id}`)
    else if (d.venta_id != null) out.add(`venta:${d.venta_id}`)
  }
  return out
}

export async function calcularComisionesPeriodo(
  desde: string,
  hasta: string,
  opts: { vendedorId?: number | null } = {}
): Promise<{ data: ResumenVendedorComision[]; error: string | null; pendiente: boolean }> {
  if (!isSupabaseConfigured()) return { data: [], error: null, pendiente: false }
  const supabase = createClient()
  if (!supabase) return { data: [], error: "Cliente no disponible", pendiente: false }
  try {
    const { data: politicas, pendiente } = await getPoliticasComision()
    if (pendiente) return { data: [], error: null, pendiente: true }

    // Líneas vendidas vigentes: las del período (facturación) y las de facturas
    // con cobros/devoluciones en el período (se traen por venta_id).
    const desdeAmplio = new Date(`${desde}T00:00:00Z`)
    desdeAmplio.setUTCFullYear(desdeAmplio.getUTCFullYear() - 1) // cobros de facturas de hasta 1 año atrás
    const desdeAmplioISO = desdeAmplio.toISOString().slice(0, 10)
    let q = supabase
      .from("vista_ventas_reporte")
      .select("venta_id, numero_factura, fecha, vendedor_id, categoria_id, linea_id, venta, utilidad")
      .is("anulada_at", null)
      .not("vendedor_id", "is", null)
      .gte("fecha", desdeAmplioISO)
      .lte("fecha", hasta)
    if (opts.vendedorId != null) q = q.eq("vendedor_id", opts.vendedorId)
    const acc: Record<string, unknown>[] = []
    for (let from = 0; from < 100_000; from += 1000) {
      const { data, error } = await q.range(from, from + 999)
      if (error) return { data: [], error: /vista_ventas_reporte/i.test(error.message) ? "Falta la vista de reportes (script officemart-007)." : error.message, pendiente: false }
      acc.push(...((data || []) as Record<string, unknown>[]))
      if ((data || []).length < 1000) break
    }
    const ventaIds = [...new Set(acc.map((r) => Number(r.venta_id)))]
    const totales = new Map<number, number>()
    for (let i = 0; i < ventaIds.length; i += 200) {
      const lote = ventaIds.slice(i, i + 200)
      const { data } = await supabase.from("ventas_encabezado").select("id, total_venta").in("id", lote)
      for (const v of (data || []) as { id: number; total_venta: number }[]) totales.set(v.id, Number(v.total_venta || 0))
    }
    const lineas: LineaVentaComision[] = acc.map((r) => ({
      venta_id: Number(r.venta_id),
      numero_factura: String(r.numero_factura ?? ""),
      fecha: String(r.fecha ?? ""),
      vendedor_id: r.vendedor_id != null ? Number(r.vendedor_id) : null,
      categoria_id: r.categoria_id != null ? Number(r.categoria_id) : null,
      linea_id: r.linea_id != null ? Number(r.linea_id) : null,
      venta: Number(r.venta ?? 0),
      utilidad: Number(r.utilidad ?? 0),
      total_factura: totales.get(Number(r.venta_id)) ?? 0,
    }))

    const cobros: CobroComision[] = []
    const devoluciones: DevolucionComision[] = []
    for (let i = 0; i < ventaIds.length; i += 200) {
      const lote = ventaIds.slice(i, i + 200)
      const [p, d] = await Promise.all([
        supabase.from("pagos_ventas").select("venta_id, fecha_pago, monto, recibo_id").in("venta_id", lote).gte("fecha_pago", `${desde}T00:00:00`).lte("fecha_pago", `${hasta}T23:59:59`),
        supabase.from("devoluciones_encabezado").select("id, venta_id, fecha, monto_total, anulada_at").in("venta_id", lote).gte("fecha", `${desde}T00:00:00`).lte("fecha", `${hasta}T23:59:59`),
      ])
      for (const c of (p.data || []) as Record<string, unknown>[]) cobros.push({ venta_id: Number(c.venta_id), fecha: String(c.fecha_pago), monto: Number(c.monto || 0), recibo_id: c.recibo_id != null ? Number(c.recibo_id) : null })
      for (const x of (d.data || []) as Record<string, unknown>[]) if (!x.anulada_at) devoluciones.push({ id: Number(x.id), venta_id: Number(x.venta_id), fecha: String(x.fecha), monto_total: Number(x.monto_total || 0) })
    }

    const resumen = calcularComisiones({ lineas, cobros, devoluciones, politicas, desde, hasta })
    // Excluir lo ya liquidado.
    const liquidado = await ventasYaLiquidadas(supabase, resumen.map((r) => r.vendedor_id))
    const filtrado = resumen
      .map((r) => {
        const items = r.items.filter((i) => {
          if (i.devolucion_id != null) return !liquidado.has(`dev:${i.devolucion_id}`)
          if (i.recibo_id != null) return !liquidado.has(`rec:${i.recibo_id}:${i.venta_id}`)
          return !liquidado.has(`venta:${i.venta_id}`)
        })
        return { ...r, items, comision: r2(items.reduce((a, i) => a + i.monto, 0)) }
      })
      .filter((r) => r.items.length > 0 || r.ventas > 0)
    return { data: filtrado, error: null, pendiente: false }
  } catch (err) {
    console.error("[comisiones] calcular:", err)
    return { data: [], error: "Error de conexión", pendiente: false }
  }
}

// ==================== LIQUIDACIÓN ====================

export interface Liquidacion {
  id: number
  vendedor_id: number
  vendedor_nombre?: string
  periodo_desde: string
  periodo_hasta: string
  total: number
  estado: "Aprobada" | "Pagada" | "Anulada"
  gasto_id: number | null
  notas: string | null
  created_at: string
}

async function ensureConceptoComisiones(): Promise<number | null> {
  const { data: conceptos } = await getConceptosGasto()
  const ex = (conceptos || []).find((c) => (c.nombre || "").trim().toLowerCase() === "comisiones de ventas")
  if (ex?.id != null) return ex.id
  const { data } = await createConceptoGasto({ nombre: "Comisiones de ventas", categoria_macro: "Nomina" })
  return data?.id ?? null
}

export async function liquidarComisiones(input: {
  vendedor_id: number
  desde: string
  hasta: string
  items: ItemComision[]
  notas?: string | null
  pago?: { metodo: "Efectivo" | "Banco"; cuenta_id?: number | null } | null
}): Promise<{ data: { id: number; gasto_id: number | null } | null; error: string | null }> {
  const supabase = createClient()
  if (!supabase) return { data: null, error: "Cliente no disponible" }
  const stamp = await getTenantStamp(supabase)
  if (!isValidStamp(stamp)) return { data: null, error: SESION_INVALIDA_ERROR }
  const items = input.items.filter((i) => i.vendedor_id === input.vendedor_id)
  if (items.length === 0) return { data: null, error: "No hay comisiones que liquidar." }
  const total = r2(items.reduce((a, i) => a + i.monto, 0))
  if (total <= 0) return { data: null, error: "El total a liquidar debe ser mayor a 0." }

  const { data: liq, error } = await supabase
    .from("comisiones_liquidaciones")
    .insert({ vendedor_id: input.vendedor_id, periodo_desde: input.desde, periodo_hasta: input.hasta, total, estado: "Aprobada", notas: input.notas?.trim() || null, ...stamp })
    .select("id")
    .single()
  if (error) return { data: null, error: isMissingTable(error) ? COMISIONES_FEATURE_PENDING : error.message }
  const liqId = Number(liq.id)
  const { error: detErr } = await supabase.from("comisiones_liquidaciones_detalle").insert(
    items.map((i) => ({ razon_social_id: stamp.razon_social_id, liquidacion_id: liqId, venta_id: i.venta_id, recibo_id: i.recibo_id, devolucion_id: i.devolucion_id, fecha: i.fecha, concepto: i.concepto, base: i.base, porcentaje: i.porcentaje, monto: i.monto }))
  )
  if (detErr) {
    await supabase.from("comisiones_liquidaciones").delete().eq("id", liqId)
    return { data: null, error: detErr.message }
  }

  // Gasto "Comisiones de ventas" (pagado ahora o pendiente).
  let gastoId: number | null = null
  const conceptoId = await ensureConceptoComisiones()
  if (conceptoId != null) {
    const { data: vend } = await supabase.from("vendedores").select("nombre").eq("id", input.vendedor_id).maybeSingle()
    const { data: gasto, error: gErr } = await createGasto({
      concepto_id: conceptoId,
      fecha_gasto: getHondurasTodayISODate(),
      monto: total,
      metodo_pago: input.pago?.metodo === "Banco" ? "Transferencia" : "Efectivo",
      descripcion: `Comisiones ${vend?.nombre || `vendedor #${input.vendedor_id}`} · ${input.desde} a ${input.hasta} (liq. #${liqId})`,
      pagar_ahora: !!input.pago,
      pago_metodo: input.pago?.metodo,
      pago_cuenta_id: input.pago?.metodo === "Banco" ? input.pago.cuenta_id ?? null : null,
    })
    if (gErr) console.warn("[comisiones] gasto no creado:", gErr)
    gastoId = gasto?.id ?? null
    if (gastoId != null) {
      await supabase.from("comisiones_liquidaciones").update({ gasto_id: gastoId, estado: input.pago ? "Pagada" : "Aprobada" }).eq("id", liqId)
    }
  }
  await registrarAuditoria(supabase, stamp, { entidad: "comision_liquidacion", entidad_id: liqId, accion: "liquidar", despues: { vendedor_id: input.vendedor_id, total, gasto_id: gastoId } })
  return { data: { id: liqId, gasto_id: gastoId }, error: null }
}

export async function getLiquidaciones(): Promise<{ data: Liquidacion[]; error: string | null; pendiente: boolean }> {
  if (!isSupabaseConfigured()) return { data: [], error: null, pendiente: false }
  const supabase = createClient()
  if (!supabase) return { data: [], error: "Cliente no disponible", pendiente: false }
  const { data, error } = await supabase.from("comisiones_liquidaciones").select("*").order("created_at", { ascending: false }).limit(300)
  if (error) {
    if (isMissingTable(error)) return { data: [], error: null, pendiente: true }
    return { data: [], error: error.message, pendiente: false }
  }
  const conVendedor = await adjuntarRelacion(supabase, (data || []) as Record<string, unknown>[], { campo: "vendedor_id", tabla: "vendedores", columnas: "nombre", como: "vendedores" })
  return {
    data: conVendedor.map((r: Record<string, unknown>) => {
      const v = Array.isArray(r.vendedores) ? r.vendedores[0] : r.vendedores
      return {
        id: Number(r.id),
        vendedor_id: Number(r.vendedor_id),
        vendedor_nombre: (v as { nombre?: string } | null)?.nombre,
        periodo_desde: String(r.periodo_desde ?? ""),
        periodo_hasta: String(r.periodo_hasta ?? ""),
        total: Number(r.total ?? 0),
        estado: (r.estado as Liquidacion["estado"]) ?? "Aprobada",
        gasto_id: r.gasto_id != null ? Number(r.gasto_id) : null,
        notas: (r.notas as string) ?? null,
        created_at: String(r.created_at ?? ""),
      }
    }),
    error: null,
    pendiente: false,
  }
}

export async function marcarLiquidacionPagada(id: number): Promise<{ error: string | null }> {
  const supabase = createClient()
  if (!supabase) return { error: "Cliente no disponible" }
  const { error } = await supabase.from("comisiones_liquidaciones").update({ estado: "Pagada", updated_at: new Date().toISOString() }).eq("id", id)
  return { error: error ? error.message : null }
}

export async function anularLiquidacion(id: number, motivo: string): Promise<{ error: string | null }> {
  const supabase = createClient()
  if (!supabase) return { error: "Cliente no disponible" }
  const stamp = await getTenantStamp(supabase)
  if (!isValidStamp(stamp)) return { error: SESION_INVALIDA_ERROR }
  const { data: liq } = await supabase.from("comisiones_liquidaciones").select("estado, gasto_id").eq("id", id).maybeSingle()
  if (!liq) return { error: "La liquidación no existe" }
  if (liq.estado === "Pagada") return { error: "Una liquidación pagada no se anula; corrige con un gasto negativo o una nota." }
  const { error } = await supabase.from("comisiones_liquidaciones").update({ estado: "Anulada", notas: motivo, updated_at: new Date().toISOString() }).eq("id", id)
  if (error) return { error: error.message }
  await registrarAuditoria(supabase, stamp, { entidad: "comision_liquidacion", entidad_id: id, accion: "anular", motivo })
  return { error: null }
}
