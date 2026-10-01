import { createClient, isSupabaseConfigured } from "@/lib/supabase/client"
import { getTenantStamp, isValidStamp, SESION_INVALIDA_ERROR } from "@/lib/services/tenant-stamp"
import { registrarAuditoria } from "@/lib/services/auditoria"
import { createCompra } from "@/lib/services/compras"
import { getHondurasTodayISODate } from "@/lib/utils/honduras-time"
import { adjuntarRelacion } from "@/lib/services/relaciones"

/**
 * Consignación (script officemart-012): una localización marcada como
 * 'consignacion' guarda mercancía de un proveedor propietario que solo se
 * paga cuando se vende. Las ventas desde esa localización (kardex 'Salida
 * Venta' vigentes) se liquidan por período al costo pactado (el costo del
 * producto al momento de la venta) creando una OC a crédito YA recibida
 * (sin tocar inventario) que aparece en Cuentas por Pagar → Compras a crédito.
 * La valoración separa stock propio y consignado.
 */

export const CONSIGNACION_FEATURE_PENDING =
  "Consignación pendiente: aplica scripts/officemart-012-consignacion.sql en Supabase."

export interface LocalizacionConsignacion {
  localizacion_id: number
  localizacion_nombre: string
  almacen_id: number
  almacen_nombre: string
  tipo: "consignacion" | null
  propietario_proveedor_id: number | null
  propietario_nombre: string | null
}

export interface VentaConsignada {
  transaccion_id: number
  venta_id: number
  numero_factura: string | null
  fecha: string
  producto_id: number
  producto_nombre: string
  localizacion_id: number
  cantidad: number
  costo_pactado: number
  monto: number
}

export interface GrupoConsignacion {
  proveedor_id: number
  proveedor_nombre: string
  localizacion_id: number
  localizacion_nombre: string
  items: VentaConsignada[]
  total: number
}

function r2(n: number): number {
  return +(Number(n) || 0).toFixed(2)
}

function isMissingTable(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false
  const msg = (err.message || "").toLowerCase()
  return err.code === "42P01" || err.code === "PGRST205" || msg.includes("schema cache") || /relation .* does not exist/.test(msg)
}

// ==================== FUNCIONES PURAS ====================

/**
 * Agrupa las ventas consignadas pendientes por proveedor propietario y
 * localización, excluyendo los movimientos ya liquidados (pura).
 */
export function agruparConsignacion(
  movs: VentaConsignada[],
  locs: Pick<LocalizacionConsignacion, "localizacion_id" | "localizacion_nombre" | "propietario_proveedor_id" | "propietario_nombre">[],
  liquidados: Set<number>
): GrupoConsignacion[] {
  const locPorId = new Map(locs.map((l) => [l.localizacion_id, l]))
  const grupos = new Map<string, GrupoConsignacion>()
  for (const m of movs) {
    if (liquidados.has(m.transaccion_id)) continue
    const loc = locPorId.get(m.localizacion_id)
    if (!loc || loc.propietario_proveedor_id == null) continue
    const k = `${loc.propietario_proveedor_id}:${m.localizacion_id}`
    let g = grupos.get(k)
    if (!g) {
      g = { proveedor_id: loc.propietario_proveedor_id, proveedor_nombre: loc.propietario_nombre || `Proveedor #${loc.propietario_proveedor_id}`, localizacion_id: m.localizacion_id, localizacion_nombre: loc.localizacion_nombre, items: [], total: 0 }
      grupos.set(k, g)
    }
    g.items.push(m)
    g.total = r2(g.total + m.monto)
  }
  const out = [...grupos.values()]
  for (const g of out) g.items.sort((a, b) => (a.fecha < b.fecha ? -1 : 1))
  return out.sort((a, b) => b.total - a.total)
}

/** Valor consignado vs propio a partir del stock por localización (pura). */
export function separarValoracion(
  stock: { producto_id: number; localizacion_id: number; stock_actual: number }[],
  costos: Map<number, number>,
  locsConsignacion: Set<number>
): { propio: number; consignado: number; unidadesConsignadas: number } {
  let propio = 0
  let consignado = 0
  let unidades = 0
  for (const s of stock) {
    const valor = (Number(s.stock_actual) || 0) * (costos.get(s.producto_id) || 0)
    if (locsConsignacion.has(s.localizacion_id)) {
      consignado += valor
      unidades += Number(s.stock_actual) || 0
    } else propio += valor
  }
  return { propio: r2(propio), consignado: r2(consignado), unidadesConsignadas: r2(unidades) }
}

// ==================== LOCALIZACIONES ====================

export async function getLocalizacionesConsignacion(): Promise<{ data: LocalizacionConsignacion[]; error: string | null; pendiente: boolean }> {
  if (!isSupabaseConfigured()) return { data: [], error: null, pendiente: false }
  const supabase = createClient()
  if (!supabase) return { data: [], error: "Cliente no disponible", pendiente: false }
  const [locRes, cfgRes, almRes, provRes] = await Promise.all([
    supabase.from("localizaciones").select("id, nombre, almacen_id").order("id", { ascending: true }),
    supabase.from("localizaciones_config").select("localizacion_id, tipo, propietario_proveedor_id"),
    supabase.from("almacenes").select("id, nombre"),
    supabase.from("proveedores").select("id, nombre"),
  ])
  if (locRes.error) return { data: [], error: locRes.error.message, pendiente: false }
  const pendiente = !!cfgRes.error && /tipo|propietario_proveedor_id/i.test(cfgRes.error.message || "")
  const cfg = new Map<number, { tipo: string | null; prov: number | null }>()
  for (const c of (cfgRes.error ? [] : cfgRes.data || []) as { localizacion_id: number; tipo: string | null; propietario_proveedor_id: number | null }[]) {
    cfg.set(Number(c.localizacion_id), { tipo: c.tipo, prov: c.propietario_proveedor_id != null ? Number(c.propietario_proveedor_id) : null })
  }
  const alm = new Map((almRes.data || []).map((a: { id: number; nombre: string }) => [a.id, a.nombre]))
  const prov = new Map((provRes.data || []).map((p: { id: number; nombre: string }) => [p.id, p.nombre]))
  const data: LocalizacionConsignacion[] = (locRes.data || []).map((l: { id: number; nombre: string; almacen_id: number }) => {
    const c = cfg.get(l.id)
    return {
      localizacion_id: l.id,
      localizacion_nombre: l.nombre,
      almacen_id: l.almacen_id,
      almacen_nombre: alm.get(l.almacen_id) || `Almacén #${l.almacen_id}`,
      tipo: c?.tipo === "consignacion" ? "consignacion" : null,
      propietario_proveedor_id: c?.prov ?? null,
      propietario_nombre: c?.prov != null ? prov.get(c.prov) ?? null : null,
    }
  })
  return { data, error: null, pendiente }
}

/** Marca (o desmarca) una localización como consignación de un proveedor. */
export async function setLocalizacionConsignacion(
  localizacionId: number,
  input: { consignacion: boolean; propietario_proveedor_id?: number | null }
): Promise<{ error: string | null }> {
  const supabase = createClient()
  if (!supabase) return { error: "Cliente no disponible" }
  const stamp = await getTenantStamp(supabase)
  if (!isValidStamp(stamp)) return { error: SESION_INVALIDA_ERROR }
  if (input.consignacion && !input.propietario_proveedor_id) return { error: "Indica el proveedor propietario de la mercancía." }
  const ahora = new Date().toISOString()
  const { data: ex } = await supabase.from("localizaciones_config").select("localizacion_id").eq("localizacion_id", localizacionId).maybeSingle()
  const cambios = { tipo: input.consignacion ? "consignacion" : null, propietario_proveedor_id: input.consignacion ? input.propietario_proveedor_id : null, updated_at: ahora }
  const res = ex
    ? await supabase.from("localizaciones_config").update(cambios).eq("localizacion_id", localizacionId)
    : await supabase.from("localizaciones_config").insert({ localizacion_id: localizacionId, es_punto_venta: false, ...cambios, razon_social_id: stamp.razon_social_id, usuario: stamp.usuario })
  if (res.error) return { error: /tipo|propietario_proveedor_id/i.test(res.error.message || "") ? CONSIGNACION_FEATURE_PENDING : res.error.message }
  return { error: null }
}

// ==================== VENTAS POR LIQUIDAR ====================

export async function getConsignacionPendiente(): Promise<{ data: GrupoConsignacion[]; locs: LocalizacionConsignacion[]; error: string | null; pendiente: boolean }> {
  if (!isSupabaseConfigured()) return { data: [], locs: [], error: null, pendiente: false }
  const supabase = createClient()
  if (!supabase) return { data: [], locs: [], error: "Cliente no disponible", pendiente: false }
  const { data: locs, error: lErr, pendiente } = await getLocalizacionesConsignacion()
  if (lErr) return { data: [], locs: [], error: lErr, pendiente }
  const consig = locs.filter((l) => l.tipo === "consignacion")
  if (consig.length === 0) return { data: [], locs, error: null, pendiente }
  const locIds = consig.map((l) => l.localizacion_id)

  // Kardex: salidas por venta desde localizaciones de consignación.
  const acc: Record<string, unknown>[] = []
  for (let from = 0; from < 50_000; from += 1000) {
    const { data, error } = await supabase
      .from("transacciones_inventario")
      .select("id, producto_id, localizacion_id, cantidad, costo_o_precio_unitario, referencia_id, fecha, productos (nombre, costo_promedio)")
      .eq("tipo_movimiento", "Salida Venta")
      .in("localizacion_id", locIds)
      .order("fecha", { ascending: true })
      .range(from, from + 999)
    if (error) return { data: [], locs, error: error.message, pendiente }
    acc.push(...((data || []) as Record<string, unknown>[]))
    if ((data || []).length < 1000) break
  }
  const ventaIds = [...new Set(acc.map((r) => Number(r.referencia_id)).filter((x) => x > 0))]
  const ventaInfo = new Map<number, { numero: string | null; anulada: boolean }>()
  for (let i = 0; i < ventaIds.length; i += 200) {
    const lote = ventaIds.slice(i, i + 200)
    let filas: Record<string, unknown>[] = []
    const conAnulada = await supabase.from("ventas_encabezado").select("id, numero_factura, anulada_at").in("id", lote)
    if (!conAnulada.error) filas = (conAnulada.data || []) as Record<string, unknown>[]
    else {
      const simple = await supabase.from("ventas_encabezado").select("id, numero_factura").in("id", lote)
      filas = (simple.data || []) as Record<string, unknown>[]
    }
    for (const v of filas) ventaInfo.set(Number(v.id), { numero: (v.numero_factura as string) ?? null, anulada: !!v.anulada_at })
  }
  const movs: VentaConsignada[] = acc
    .filter((r) => !ventaInfo.get(Number(r.referencia_id))?.anulada)
    .map((r) => {
      const p = Array.isArray(r.productos) ? r.productos[0] : r.productos
      const cantidad = Math.abs(Number(r.cantidad || 0))
      // Costo pactado = costo del producto al momento de la venta (kardex guarda el
      // precio de venta en costo_o_precio_unitario para 'Salida Venta'; usamos el
      // costo promedio actual como mejor aproximación).
      const costo = Number((p as { costo_promedio?: number } | null)?.costo_promedio || 0)
      return {
        transaccion_id: Number(r.id),
        venta_id: Number(r.referencia_id),
        numero_factura: ventaInfo.get(Number(r.referencia_id))?.numero ?? null,
        fecha: String(r.fecha ?? ""),
        producto_id: Number(r.producto_id),
        producto_nombre: (p as { nombre?: string } | null)?.nombre || `#${r.producto_id}`,
        localizacion_id: Number(r.localizacion_id),
        cantidad,
        costo_pactado: +costo.toFixed(4),
        monto: r2(cantidad * costo),
      }
    })

  // Ya liquidados.
  const liquidados = new Set<number>()
  const { data: det, error: dErr } = await supabase.from("consignacion_liquidaciones_detalle").select("transaccion_id, consignacion_liquidaciones!inner (estado)")
  if (!dErr) {
    for (const d of (det || []) as Record<string, unknown>[]) {
      const liq = Array.isArray(d.consignacion_liquidaciones) ? d.consignacion_liquidaciones[0] : d.consignacion_liquidaciones
      if ((liq as { estado?: string } | null)?.estado !== "Anulada" && d.transaccion_id != null) liquidados.add(Number(d.transaccion_id))
    }
  } else if (!isMissingTable(dErr)) {
    // Sin embed (FK ausente en cache): leer plano.
    const plano = await supabase.from("consignacion_liquidaciones_detalle").select("transaccion_id")
    for (const d of (plano.data || []) as { transaccion_id: number | null }[]) if (d.transaccion_id != null) liquidados.add(Number(d.transaccion_id))
  }
  return { data: agruparConsignacion(movs, consig, liquidados), locs, error: null, pendiente: pendiente || (!!dErr && isMissingTable(dErr)) }
}

// ==================== LIQUIDACIÓN ====================

export interface LiquidacionConsignacion {
  id: number
  proveedor_id: number
  proveedor_nombre?: string
  localizacion_id: number | null
  periodo_desde: string | null
  periodo_hasta: string | null
  total: number
  estado: "Aprobada" | "Anulada"
  compra_id: number | null
  notas: string | null
  created_at: string
}

/**
 * Liquida al proveedor las ventas consignadas indicadas: crea la liquidación,
 * su detalle y una OC a crédito ya recibida (sin mover inventario) para que
 * aparezca en CxP → Compras a crédito y se pague desde la orden.
 */
export async function liquidarConsignacion(input: {
  proveedor_id: number
  localizacion_id: number
  items: VentaConsignada[]
  dias_credito?: number | null
  notas?: string | null
}): Promise<{ data: { id: number; compra_id: number | null } | null; error: string | null }> {
  const supabase = createClient()
  if (!supabase) return { data: null, error: "Cliente no disponible" }
  const stamp = await getTenantStamp(supabase)
  if (!isValidStamp(stamp)) return { data: null, error: SESION_INVALIDA_ERROR }
  const items = input.items.filter((i) => i.cantidad > 0)
  if (items.length === 0) return { data: null, error: "No hay ventas que liquidar." }
  const total = r2(items.reduce((a, i) => a + i.monto, 0))
  const fechas = items.map((i) => i.fecha.slice(0, 10)).sort()
  const hoy = getHondurasTodayISODate()

  const { data: liq, error } = await supabase
    .from("consignacion_liquidaciones")
    .insert({ proveedor_id: input.proveedor_id, localizacion_id: input.localizacion_id, periodo_desde: fechas[0], periodo_hasta: fechas[fechas.length - 1], total, estado: "Aprobada", notas: input.notas?.trim() || null, ...stamp })
    .select("id")
    .single()
  if (error) return { data: null, error: isMissingTable(error) ? CONSIGNACION_FEATURE_PENDING : error.message }
  const liqId = Number(liq.id)
  const { error: detErr } = await supabase.from("consignacion_liquidaciones_detalle").insert(
    items.map((i) => ({ razon_social_id: stamp.razon_social_id, liquidacion_id: liqId, transaccion_id: i.transaccion_id, venta_id: i.venta_id, producto_id: i.producto_id, cantidad: i.cantidad, costo_pactado: i.costo_pactado, monto: i.monto }))
  )
  if (detErr) {
    await supabase.from("consignacion_liquidaciones").delete().eq("id", liqId)
    return { data: null, error: detErr.message }
  }

  // OC a crédito ya recibida (la mercancía ya estaba en inventario): agrupa por producto.
  const porProducto = new Map<number, { cantidad: number; monto: number }>()
  for (const i of items) {
    const p = porProducto.get(i.producto_id) || { cantidad: 0, monto: 0 }
    p.cantidad += i.cantidad
    p.monto += i.monto
    porProducto.set(i.producto_id, p)
  }
  const lineas = [...porProducto.entries()].map(([producto_id, p]) => ({ producto_id, cantidad: p.cantidad, cantidad_recibida: p.cantidad, costo_unitario_moneda_origen: p.cantidad > 0 ? +(p.monto / p.cantidad).toFixed(4) : 0, costo_final_local: p.cantidad > 0 ? +(p.monto / p.cantidad).toFixed(4) : 0 }))
  const { data: oc } = await createCompra(
    { proveedor_id: input.proveedor_id, numero_factura: `CONSIG-${liqId}`, fecha_tentativa: hoy, moneda: "LPS", tasa_cambio: 1, costos_importacion: 0, impuestos_compra: 0, otros_costos: 0, total_compra_local: total, subtotal: total, total, estado: "Recibida" },
    lineas
  )
  let compraId: number | null = oc?.id ?? null
  if (compraId != null) {
    const dias = input.dias_credito ?? 30
    const venc = new Date(`${hoy}T00:00:00Z`)
    venc.setUTCDate(venc.getUTCDate() + dias)
    const up = await supabase
      .from("compras_encabezado")
      .update({ forma_pago: "Credito", dias_credito: dias, fecha_vencimiento: venc.toISOString().slice(0, 10), total_recibido_local: total, estado_recepcion: "Completa", monto_pagado: 0, estado_pago: "Pendiente" })
      .eq("id", compraId)
    if (up.error) console.warn("[consignacion] OC sin columnas de crédito (officemart-008):", up.error.message)
    await supabase.from("consignacion_liquidaciones").update({ compra_id: compraId }).eq("id", liqId)
  } else {
    compraId = null
  }
  await registrarAuditoria(supabase, stamp, { entidad: "consignacion_liquidacion", entidad_id: liqId, accion: "liquidar", despues: { proveedor_id: input.proveedor_id, total, compra_id: compraId, items: items.length } })
  return { data: { id: liqId, compra_id: compraId }, error: null }
}

export async function getLiquidacionesConsignacion(): Promise<{ data: LiquidacionConsignacion[]; error: string | null; pendiente: boolean }> {
  if (!isSupabaseConfigured()) return { data: [], error: null, pendiente: false }
  const supabase = createClient()
  if (!supabase) return { data: [], error: "Cliente no disponible", pendiente: false }
  const { data, error } = await supabase.from("consignacion_liquidaciones").select("*").order("created_at", { ascending: false }).limit(300)
  if (error) {
    if (isMissingTable(error)) return { data: [], error: null, pendiente: true }
    return { data: [], error: error.message, pendiente: false }
  }
  const conProveedor = await adjuntarRelacion(supabase, (data || []) as Record<string, unknown>[], { campo: "proveedor_id", tabla: "proveedores", columnas: "nombre", como: "proveedores" })
  return {
    data: conProveedor.map((r: Record<string, unknown>) => {
      const p = Array.isArray(r.proveedores) ? r.proveedores[0] : r.proveedores
      return {
        id: Number(r.id),
        proveedor_id: Number(r.proveedor_id),
        proveedor_nombre: (p as { nombre?: string } | null)?.nombre,
        localizacion_id: r.localizacion_id != null ? Number(r.localizacion_id) : null,
        periodo_desde: (r.periodo_desde as string) ?? null,
        periodo_hasta: (r.periodo_hasta as string) ?? null,
        total: Number(r.total ?? 0),
        estado: (r.estado as "Aprobada" | "Anulada") ?? "Aprobada",
        compra_id: r.compra_id != null ? Number(r.compra_id) : null,
        notas: (r.notas as string) ?? null,
        created_at: String(r.created_at ?? ""),
      }
    }),
    error: null,
    pendiente: false,
  }
}

/** Anula una liquidación (las ventas vuelven a quedar por liquidar). La OC generada se cancela si no tiene pagos. */
export async function anularLiquidacionConsignacion(id: number, motivo: string): Promise<{ error: string | null }> {
  const supabase = createClient()
  if (!supabase) return { error: "Cliente no disponible" }
  const stamp = await getTenantStamp(supabase)
  if (!isValidStamp(stamp)) return { error: SESION_INVALIDA_ERROR }
  const { data: liq } = await supabase.from("consignacion_liquidaciones").select("estado, compra_id").eq("id", id).maybeSingle()
  if (!liq) return { error: "La liquidación no existe" }
  if (liq.estado === "Anulada") return { error: "Ya está anulada" }
  if (liq.compra_id) {
    const { count } = await supabase.from("compras_pagos").select("id", { count: "exact", head: true }).eq("compra_id", liq.compra_id).is("anulado_at", null)
    if ((count || 0) > 0) return { error: "La OC de esta liquidación ya tiene pagos; anula primero los pagos desde la orden." }
    await supabase.from("compras_encabezado").update({ estado: "Cancelada" }).eq("id", liq.compra_id)
  }
  const { error } = await supabase.from("consignacion_liquidaciones").update({ estado: "Anulada", notas: motivo }).eq("id", id)
  if (error) return { error: error.message }
  await registrarAuditoria(supabase, stamp, { entidad: "consignacion_liquidacion", entidad_id: id, accion: "anular", motivo })
  return { error: null }
}

// ==================== VALORACIÓN ====================

export async function getValoracionConsignacion(): Promise<{ data: { propio: number; consignado: number; unidadesConsignadas: number; porLocalizacion: { localizacion: LocalizacionConsignacion; valor: number; unidades: number }[] } | null; error: string | null }> {
  if (!isSupabaseConfigured()) return { data: null, error: null }
  const supabase = createClient()
  if (!supabase) return { data: null, error: "Cliente no disponible" }
  const { data: locs } = await getLocalizacionesConsignacion()
  const consig = locs.filter((l) => l.tipo === "consignacion")
  const [stockRes, prodRes] = await Promise.all([
    supabase.from("vista_stock_por_localizacion").select("producto_id, localizacion_id, stock_actual"),
    supabase.from("productos").select("id, costo_promedio"),
  ])
  if (stockRes.error) return { data: null, error: stockRes.error.message }
  const costos = new Map((prodRes.data || []).map((p: { id: number; costo_promedio: number | null }) => [p.id, Number(p.costo_promedio || 0)]))
  const stock = (stockRes.data || []) as { producto_id: number; localizacion_id: number; stock_actual: number }[]
  const sep = separarValoracion(stock, costos, new Set(consig.map((l) => l.localizacion_id)))
  const porLocalizacion = consig.map((l) => {
    const filas = stock.filter((s) => s.localizacion_id === l.localizacion_id)
    return { localizacion: l, valor: r2(filas.reduce((a, s) => a + (Number(s.stock_actual) || 0) * (costos.get(s.producto_id) || 0), 0)), unidades: r2(filas.reduce((a, s) => a + (Number(s.stock_actual) || 0), 0)) }
  })
  return { data: { ...sep, porLocalizacion }, error: null }
}
