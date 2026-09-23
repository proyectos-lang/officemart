import { createClient, isSupabaseConfigured } from '@/lib/supabase/client'
import { getComisionesPorVenta } from '@/lib/services/ventas-analytics'
import { getGastos, CATEGORIAS_MACRO } from '@/lib/services/gastos'
import { getValoracionInventarioExtendida, getKardexByProducto } from '@/lib/services/inventario'
import { getCompraById } from '@/lib/services/compras'
import { filtrarVigentesActivo } from '@/lib/services/ventas-filtros'

/**
 * Análisis Financiero: analítica de rentabilidad, gastos y costeo para el
 * gerente. Se COMPONE de servicios existentes (no crea tablas nuevas):
 *  - Rentabilidad por producto ← lineas de `ventas_detalle` (costo congelado +
 *    utilidad por línea) neteadas por devoluciones.
 *  - P&L del período ← ventas/CMV/gastos/comisiones (mismo criterio que el
 *    Estado de Resultados).
 *  - Gastos ← `gastos` + `conceptos_gastos.categoria_macro`, con serie mensual y
 *    detección de anomalías (vs promedio de meses previos y vs período anterior).
 *  - Auditoría de costeo ← valoración + líneas del período; e historial de costo
 *    por producto reconstruido de kardex + compras + bitácora `ajustes_costo`.
 * Todo respeta el tenant vía RLS (`app_current_tenant()`).
 */

// Umbral (%) para marcar un incremento de gasto como anómalo.
export const ANOMALIA_PCT = 30
// Meses de la serie de tendencia (incluye el mes de `hasta`).
const MESES_SERIE = 6

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

function mediana(nums: number[]): number {
  if (nums.length === 0) return 0
  const s = [...nums].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 !== 0 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

/** Clave 'YYYY-MM' de una fecha ISO o 'YYYY-MM-DD'. */
function mesKey(fecha: string): string {
  return (fecha || '').slice(0, 7)
}

/** Últimas `n` claves de mes terminando en el mes de `hastaISO` (ascendente). */
function mesesHasta(hastaISO: string, n: number): string[] {
  const [y, m] = hastaISO.slice(0, 7).split('-').map(Number)
  const out: string[] = []
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(y, m - 1 - i, 1)
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  return out
}

// ==================== PAGINADOR (tope 1000 de PostgREST) ====================

type Buildable = { range: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }> }
async function fetchAll<T>(build: () => Buildable): Promise<T[]> {
  const PAGE = 1000
  let from = 0
  const acc: T[] = []
  for (let guard = 0; guard < 100; guard++) {
    const { data, error } = await build().range(from, from + PAGE - 1)
    if (error) throw new Error(error.message)
    const rows = (data || []) as T[]
    acc.push(...rows)
    if (rows.length < PAGE) break
    from += PAGE
  }
  return acc
}

// ==================== FETCHERS INTERNOS ====================

interface LineaRango {
  producto_id: number
  producto_nombre: string
  producto_sku: string
  cantidad: number
  precio_unitario: number
  costo: number
  utilidad: number
}

async function fetchLineasRango(
  supabase: NonNullable<ReturnType<typeof createClient>>,
  desde: string,
  hasta: string
): Promise<LineaRango[]> {
  const rows = await fetchAll<{
    producto_id?: number
    cantidad?: number
    precio_unitario?: number
    costo_promedio_momento?: number
    utilidad_linea?: number
    productos?: { nombre?: string; codigo_barras?: string } | null
  }>(() =>
    (filtrarVigentesActivo()
      ? supabase
          .from('ventas_detalle')
          .select(`
            producto_id, cantidad, precio_unitario, costo_promedio_momento, utilidad_linea,
            ventas_encabezado!inner ( fecha_venta ),
            productos ( nombre, codigo_barras )
          `)
          .is('ventas_encabezado.anulada_at', null)
          .gte('ventas_encabezado.fecha_venta', `${desde}T00:00:00`)
          .lte('ventas_encabezado.fecha_venta', `${hasta}T23:59:59`)
          .order('producto_id', { ascending: true })
      : supabase
          .from('ventas_detalle')
          .select(`
            producto_id, cantidad, precio_unitario, costo_promedio_momento, utilidad_linea,
            ventas_encabezado!inner ( fecha_venta ),
            productos ( nombre, codigo_barras )
          `)
          .gte('ventas_encabezado.fecha_venta', `${desde}T00:00:00`)
          .lte('ventas_encabezado.fecha_venta', `${hasta}T23:59:59`)
          .order('producto_id', { ascending: true })) as unknown as Buildable
  )
  return rows.map((r) => ({
    producto_id: Number(r.producto_id) || 0,
    producto_nombre: r.productos?.nombre || '',
    producto_sku: r.productos?.codigo_barras || '',
    cantidad: Number(r.cantidad) || 0,
    precio_unitario: Number(r.precio_unitario) || 0,
    costo: Number(r.costo_promedio_momento) || 0,
    utilidad: Number(r.utilidad_linea) || 0,
  }))
}

async function fetchVentasRango(
  supabase: NonNullable<ReturnType<typeof createClient>>,
  desde: string,
  hasta: string
): Promise<{ id: number; total_venta: number }[]> {
  const rows = await fetchAll<{ id?: number; total_venta?: number }>(() =>
    (filtrarVigentesActivo()
      ? supabase
          .from('ventas_encabezado')
          .select('id, total_venta')
          .is('anulada_at', null)
          .gte('fecha_venta', `${desde}T00:00:00`)
          .lte('fecha_venta', `${hasta}T23:59:59`)
          .order('id', { ascending: true })
      : supabase
          .from('ventas_encabezado')
          .select('id, total_venta')
          .gte('fecha_venta', `${desde}T00:00:00`)
          .lte('fecha_venta', `${hasta}T23:59:59`)
          .order('id', { ascending: true })) as unknown as Buildable
  )
  return rows.map((r) => ({ id: Number(r.id) || 0, total_venta: Number(r.total_venta) || 0 }))
}

interface DevLinea { producto_id: number; cantidad: number; precio: number; costo: number }

async function fetchDevolucionesRango(
  supabase: NonNullable<ReturnType<typeof createClient>>,
  desde: string,
  hasta: string
): Promise<DevLinea[]> {
  try {
    const rows = await fetchAll<{
      producto_id?: number
      cantidad_devuelta?: number
      precio_unitario?: number
      costo_promedio_momento?: number
    }>(() =>
      supabase
        .from('devoluciones_detalle')
        .select(`
          producto_id, cantidad_devuelta, precio_unitario, costo_promedio_momento,
          devoluciones_encabezado!inner ( fecha )
        `)
        .gte('devoluciones_encabezado.fecha', `${desde}T00:00:00`)
        .lte('devoluciones_encabezado.fecha', `${hasta}T23:59:59`)
        .order('producto_id', { ascending: true }) as unknown as Buildable
    )
    return rows.map((r) => ({
      producto_id: Number(r.producto_id) || 0,
      cantidad: Number(r.cantidad_devuelta) || 0,
      precio: Number(r.precio_unitario) || 0,
      costo: Number(r.costo_promedio_momento) || 0,
    }))
  } catch {
    // La tabla de devoluciones puede no existir todavía: neteo best-effort.
    return []
  }
}

// ==================== 1) RESUMEN / P&L ====================

export interface ResumenRentabilidad {
  ingresos: number
  cmv: number
  utilidadBruta: number
  gastosPorCategoria: { categoria: string; monto: number }[]
  gastosOperativos: number
  comisiones: number
  utilidadNeta: number
  margenBruto: number
  margenNeto: number
  cantidadFacturas: number
  devVentas: number
  devCosto: number
}

export async function getResumenRentabilidad(
  desde: string,
  hasta: string
): Promise<{ data: ResumenRentabilidad | null; error: string | null }> {
  if (!isSupabaseConfigured()) return { data: null, error: 'Supabase no configurado' }
  const supabase = createClient()
  if (!supabase) return { data: null, error: 'Cliente no disponible' }

  try {
    const [ventas, lineas, dev] = await Promise.all([
      fetchVentasRango(supabase, desde, hasta),
      fetchLineasRango(supabase, desde, hasta),
      fetchDevolucionesRango(supabase, desde, hasta),
    ])

    const ingresosBrutos = ventas.reduce((a, v) => a + v.total_venta, 0)
    const cmvBruto = lineas.reduce((a, l) => a + l.cantidad * l.costo, 0)
    const devVentas = dev.reduce((a, d) => a + d.cantidad * d.precio, 0)
    const devCosto = dev.reduce((a, d) => a + d.cantidad * d.costo, 0)

    const ingresos = round2(ingresosBrutos - devVentas)
    const cmv = round2(cmvBruto - devCosto)
    const utilidadBruta = round2(ingresos - cmv)

    // Gastos operativos del rango por categoría macro.
    const { data: gastos } = await getGastos()
    const enRango = (gastos || []).filter((g) => g.fecha_gasto >= desde && g.fecha_gasto <= hasta)
    const gastosPorCategoria = CATEGORIAS_MACRO.map((cat) => ({
      categoria: cat as string,
      monto: round2(
        enRango.filter((g) => g.categoria_macro === cat).reduce((a, g) => a + Number(g.monto || 0), 0)
      ),
    }))
    const gastosOperativos = round2(gastosPorCategoria.reduce((a, c) => a + c.monto, 0))

    // Comisiones bancarias del rango.
    const { data: comMap } = await getComisionesPorVenta(ventas.map((v) => v.id))
    let comisiones = 0
    for (const c of comMap.values()) comisiones += c.comision
    comisiones = round2(comisiones)

    const utilidadNeta = round2(utilidadBruta - gastosOperativos - comisiones)

    return {
      data: {
        ingresos,
        cmv,
        utilidadBruta,
        gastosPorCategoria,
        gastosOperativos,
        comisiones,
        utilidadNeta,
        margenBruto: ingresos > 0 ? round2((utilidadBruta / ingresos) * 100) : 0,
        margenNeto: ingresos > 0 ? round2((utilidadNeta / ingresos) * 100) : 0,
        cantidadFacturas: ventas.length,
        devVentas: round2(devVentas),
        devCosto: round2(devCosto),
      },
      error: null,
    }
  } catch (err) {
    return { data: null, error: err instanceof Error ? err.message : 'Error de conexión' }
  }
}

// ==================== 2) RENTABILIDAD POR PRODUCTO ====================

export type Cuadrante = 'Estrella' | 'Vaca lechera' | 'Nicho' | 'Bajo desempeño'

export interface ProductoRentabilidad {
  producto_id: number
  nombre: string
  sku: string
  unidades: number
  ingreso: number
  cogs: number
  utilidad: number
  margenPct: number
  pctUtilidadTotal: number
  cuadrante: Cuadrante
}

export interface RentabilidadProductos {
  productos: ProductoRentabilidad[]
  totalIngreso: number
  totalUtilidad: number
  medianaUnidades: number
  medianaMargen: number
}

export async function getRentabilidadProductos(
  desde: string,
  hasta: string
): Promise<{ data: RentabilidadProductos | null; error: string | null }> {
  if (!isSupabaseConfigured()) return { data: null, error: 'Supabase no configurado' }
  const supabase = createClient()
  if (!supabase) return { data: null, error: 'Cliente no disponible' }

  try {
    const [lineas, dev] = await Promise.all([
      fetchLineasRango(supabase, desde, hasta),
      fetchDevolucionesRango(supabase, desde, hasta),
    ])

    const acc = new Map<number, ProductoRentabilidad>()
    const get = (id: number, nombre: string, sku: string) => {
      let p = acc.get(id)
      if (!p) {
        p = { producto_id: id, nombre, sku, unidades: 0, ingreso: 0, cogs: 0, utilidad: 0, margenPct: 0, pctUtilidadTotal: 0, cuadrante: 'Bajo desempeño' }
        acc.set(id, p)
      }
      return p
    }

    for (const l of lineas) {
      const p = get(l.producto_id, l.producto_nombre, l.producto_sku)
      p.unidades += l.cantidad
      p.ingreso += l.cantidad * l.precio_unitario
      p.cogs += l.cantidad * l.costo
      p.utilidad += l.utilidad
    }
    // Netear devoluciones por producto.
    for (const d of dev) {
      const p = acc.get(d.producto_id)
      if (!p) continue
      p.unidades -= d.cantidad
      p.ingreso -= d.cantidad * d.precio
      p.cogs -= d.cantidad * d.costo
      p.utilidad -= (d.precio - d.costo) * d.cantidad
    }

    const productos = [...acc.values()].filter((p) => p.unidades !== 0 || p.ingreso !== 0)
    for (const p of productos) {
      p.ingreso = round2(p.ingreso)
      p.cogs = round2(p.cogs)
      p.utilidad = round2(p.utilidad)
      p.margenPct = p.ingreso > 0 ? round2((p.utilidad / p.ingreso) * 100) : 0
    }

    const totalIngreso = round2(productos.reduce((a, p) => a + p.ingreso, 0))
    const totalUtilidad = round2(productos.reduce((a, p) => a + p.utilidad, 0))
    for (const p of productos) {
      p.pctUtilidadTotal = totalUtilidad > 0 ? round2((p.utilidad / totalUtilidad) * 100) : 0
    }

    // Cuadrante margen × volumen por corte de medianas.
    const medianaUnidades = mediana(productos.map((p) => p.unidades))
    const medianaMargen = mediana(productos.map((p) => p.margenPct))
    for (const p of productos) {
      const altoVol = p.unidades >= medianaUnidades
      const altoMargen = p.margenPct >= medianaMargen
      p.cuadrante = altoVol && altoMargen ? 'Estrella' : altoVol && !altoMargen ? 'Vaca lechera' : !altoVol && altoMargen ? 'Nicho' : 'Bajo desempeño'
    }

    productos.sort((a, b) => b.utilidad - a.utilidad)

    return { data: { productos, totalIngreso, totalUtilidad, medianaUnidades: round2(medianaUnidades), medianaMargen: round2(medianaMargen) }, error: null }
  } catch (err) {
    return { data: null, error: err instanceof Error ? err.message : 'Error de conexión' }
  }
}

// ==================== 3) ANÁLISIS DE GASTOS ====================

export interface GastoAgrupado { clave: string; monto: number; pct: number }

export interface AnomaliaGasto {
  categoria: string
  actual: number
  promedioPrevios: number
  periodoAnterior: number
  deltaVsPromedioPct: number
  deltaVsAnteriorPct: number
  anomaloPromedio: boolean
  anomaloAnterior: boolean
}

export interface SerieMesGasto {
  mes: string
  total: number
  porCategoria: Record<string, number>
}

export interface AnalisisGastos {
  gastoTotal: number
  gastosComoPctVentas: number
  porCategoria: GastoAgrupado[]
  porConcepto: GastoAgrupado[]
  porProveedor: GastoAgrupado[]
  serieMensual: SerieMesGasto[]
  anomalias: AnomaliaGasto[]
  mesActual: string
}

function agrupar(items: { clave: string; monto: number }[], total: number): GastoAgrupado[] {
  const m = new Map<string, number>()
  for (const it of items) m.set(it.clave, (m.get(it.clave) || 0) + it.monto)
  return [...m.entries()]
    .map(([clave, monto]) => ({ clave, monto: round2(monto), pct: total > 0 ? round2((monto / total) * 100) : 0 }))
    .sort((a, b) => b.monto - a.monto)
}

export async function getAnalisisGastos(
  desde: string,
  hasta: string
): Promise<{ data: AnalisisGastos | null; error: string | null }> {
  if (!isSupabaseConfigured()) return { data: null, error: 'Supabase no configurado' }
  const supabase = createClient()
  if (!supabase) return { data: null, error: 'Cliente no disponible' }

  try {
    const { data: gastos, error: gErr } = await getGastos()
    if (gErr) return { data: null, error: gErr }
    const todos = gastos || []

    const enRango = todos.filter((g) => g.fecha_gasto >= desde && g.fecha_gasto <= hasta)
    const gastoTotal = round2(enRango.reduce((a, g) => a + Number(g.monto || 0), 0))

    const porCategoria = agrupar(
      enRango.map((g) => ({ clave: (g.categoria_macro as string) || 'Otros', monto: Number(g.monto || 0) })),
      gastoTotal
    )
    const porConcepto = agrupar(
      enRango.map((g) => ({ clave: g.concepto_nombre || 'Sin concepto', monto: Number(g.monto || 0) })),
      gastoTotal
    )
    const porProveedor = agrupar(
      enRango.map((g) => ({ clave: g.proveedor_nombre || 'Sin proveedor', monto: Number(g.monto || 0) })),
      gastoTotal
    )

    // Serie mensual (6 meses hasta el mes de `hasta`) por categoría.
    const meses = mesesHasta(hasta, MESES_SERIE)
    const serieMensual: SerieMesGasto[] = meses.map((mes) => {
      const delMes = todos.filter((g) => mesKey(g.fecha_gasto) === mes)
      const porCat: Record<string, number> = {}
      for (const cat of CATEGORIAS_MACRO) porCat[cat] = 0
      for (const g of delMes) {
        const cat = (g.categoria_macro as string) || 'Otros'
        porCat[cat] = (porCat[cat] || 0) + Number(g.monto || 0)
      }
      for (const k of Object.keys(porCat)) porCat[k] = round2(porCat[k])
      return { mes, total: round2(delMes.reduce((a, g) => a + Number(g.monto || 0), 0)), porCategoria: porCat }
    })

    // Anomalías: mes actual (último de la serie) vs promedio previos y vs mes anterior.
    const anomalias: AnomaliaGasto[] = []
    if (serieMensual.length >= 2) {
      const ultimo = serieMensual[serieMensual.length - 1]
      const anterior = serieMensual[serieMensual.length - 2]
      const previos = serieMensual.slice(0, serieMensual.length - 1)
      for (const cat of CATEGORIAS_MACRO) {
        const actual = ultimo.porCategoria[cat] || 0
        const periodoAnterior = anterior.porCategoria[cat] || 0
        const promedioPrevios = round2(previos.reduce((a, s) => a + (s.porCategoria[cat] || 0), 0) / previos.length)
        const deltaVsPromedioPct = promedioPrevios > 0 ? round2(((actual - promedioPrevios) / promedioPrevios) * 100) : actual > 0 ? 100 : 0
        const deltaVsAnteriorPct = periodoAnterior > 0 ? round2(((actual - periodoAnterior) / periodoAnterior) * 100) : actual > 0 ? 100 : 0
        const anomaloPromedio = actual > 0 && promedioPrevios > 0 && deltaVsPromedioPct >= ANOMALIA_PCT
        const anomaloAnterior = actual > 0 && periodoAnterior > 0 && deltaVsAnteriorPct >= ANOMALIA_PCT
        if (actual > 0 || periodoAnterior > 0 || promedioPrevios > 0) {
          anomalias.push({ categoria: cat, actual, promedioPrevios, periodoAnterior, deltaVsPromedioPct, deltaVsAnteriorPct, anomaloPromedio, anomaloAnterior })
        }
      }
      anomalias.sort((a, b) => Number(b.anomaloPromedio || b.anomaloAnterior) - Number(a.anomaloPromedio || a.anomaloAnterior) || b.actual - a.actual)
    }

    // Gasto como % de ventas del rango.
    const ventas = await fetchVentasRango(supabase, desde, hasta)
    const ingresos = ventas.reduce((a, v) => a + v.total_venta, 0)
    const gastosComoPctVentas = ingresos > 0 ? round2((gastoTotal / ingresos) * 100) : 0

    return {
      data: { gastoTotal, gastosComoPctVentas, porCategoria, porConcepto, porProveedor, serieMensual, anomalias, mesActual: meses[meses.length - 1] },
      error: null,
    }
  } catch (err) {
    return { data: null, error: err instanceof Error ? err.message : 'Error de conexión' }
  }
}

// ==================== 4a) AUDITORÍA DE COSTEO ====================

export interface ProductoAuditoria {
  producto_id: number
  nombre: string
  sku: string
  stock: number
  costo: number
  precio: number
  unidadesPeriodo: number
  utilidadPeriodo: number
  costoCero: boolean
  costoMayorPrecio: boolean
  margenNegativo: boolean
}

export async function getAuditoriaCosteo(
  desde: string,
  hasta: string
): Promise<{ data: ProductoAuditoria[] | null; error: string | null }> {
  if (!isSupabaseConfigured()) return { data: null, error: 'Supabase no configurado' }
  const supabase = createClient()
  if (!supabase) return { data: null, error: 'Cliente no disponible' }

  try {
    const [{ data: valoracion, error: vErr }, lineas] = await Promise.all([
      getValoracionInventarioExtendida(),
      fetchLineasRango(supabase, desde, hasta),
    ])
    if (vErr) return { data: null, error: vErr }

    const porProd = new Map<number, { unidades: number; utilidad: number }>()
    for (const l of lineas) {
      const cur = porProd.get(l.producto_id) || { unidades: 0, utilidad: 0 }
      cur.unidades += l.cantidad
      cur.utilidad += l.utilidad
      porProd.set(l.producto_id, cur)
    }

    const flagged: ProductoAuditoria[] = []
    for (const p of valoracion || []) {
      const ventas = porProd.get(p.id) || { unidades: 0, utilidad: 0 }
      const costoCero = (p.costo_promedio || 0) <= 0 && ((p.stock_total || 0) > 0 || ventas.unidades > 0)
      const costoMayorPrecio = (p.costo_promedio || 0) > 0 && (p.precio_venta || 0) > 0 && (p.costo_promedio || 0) >= (p.precio_venta || 0)
      const margenNegativo = round2(ventas.utilidad) < 0
      if (costoCero || costoMayorPrecio || margenNegativo) {
        flagged.push({
          producto_id: p.id,
          nombre: p.nombre,
          sku: p.codigo_barras,
          stock: p.stock_total || 0,
          costo: p.costo_promedio || 0,
          precio: p.precio_venta || 0,
          unidadesPeriodo: ventas.unidades,
          utilidadPeriodo: round2(ventas.utilidad),
          costoCero,
          costoMayorPrecio,
          margenNegativo,
        })
      }
    }
    // Peor primero: mayor pérdida y más banderas.
    flagged.sort((a, b) => a.utilidadPeriodo - b.utilidadPeriodo)
    return { data: flagged, error: null }
  } catch (err) {
    return { data: null, error: err instanceof Error ? err.message : 'Error de conexión' }
  }
}

// ==================== 4b) HISTORIAL DE COSTEO POR PRODUCTO ====================

export interface EventoCosteo {
  fecha: string
  tipo: string
  costoUnitario: number
  costoAnterior: number | null
  cantidad: number | null
  referencia_id: number | null
  motivo: string | null
  compra: {
    moneda: string
    costos_importacion: number
    impuestos_compra: number
    otros_costos: number
    tasa_cambio: number
  } | null
}

export interface HistorialCosteo {
  costoActual: number
  eventos: EventoCosteo[]
}

const TIPOS_ENTRADA_COSTO = ['Entrada Compra', 'Ingreso Manual']

export async function getHistorialCosteoProducto(
  productoId: number
): Promise<{ data: HistorialCosteo | null; error: string | null }> {
  if (!isSupabaseConfigured()) return { data: null, error: 'Supabase no configurado' }
  const supabase = createClient()
  if (!supabase) return { data: null, error: 'Cliente no disponible' }

  try {
    const { data: kardex, error: kErr } = await getKardexByProducto(productoId)
    if (kErr) return { data: null, error: kErr }

    const entradas = (kardex || []).filter((t) => TIPOS_ENTRADA_COSTO.includes(String(t.tipo_movimiento)))

    // Enriquecer 'Entrada Compra' con el contexto del lote (una vez por compra).
    const compraIds = [...new Set(entradas.filter((t) => String(t.tipo_movimiento) === 'Entrada Compra' && t.referencia_id != null).map((t) => t.referencia_id as number))]
    const compraCtx = new Map<number, EventoCosteo['compra']>()
    for (const id of compraIds) {
      const { data: c } = await getCompraById(id)
      if (c) {
        compraCtx.set(id, {
          moneda: c.moneda,
          costos_importacion: Number(c.costos_importacion || 0),
          impuestos_compra: Number(c.impuestos_compra || 0),
          otros_costos: Number(c.otros_costos || 0),
          tasa_cambio: Number(c.tasa_cambio || 1),
        })
      }
    }

    const eventos: EventoCosteo[] = entradas.map((t) => ({
      fecha: t.fecha || '',
      tipo: String(t.tipo_movimiento),
      costoUnitario: Number(t.costo_o_precio_unitario || 0),
      costoAnterior: null,
      cantidad: Number(t.cantidad || 0),
      referencia_id: t.referencia_id ?? null,
      motivo: null,
      compra: t.referencia_id != null ? compraCtx.get(t.referencia_id) ?? null : null,
    }))

    // Saltos de costo desde la bitácora `ajustes_costo` (best-effort).
    try {
      const { data: ajustes } = await supabase
        .from('ajustes_costo')
        .select('created_at, costo_anterior, costo_nuevo, motivo')
        .eq('producto_id', productoId)
        .order('created_at', { ascending: true })
      for (const a of ajustes || []) {
        eventos.push({
          fecha: (a.created_at as string) || '',
          tipo: 'Ajuste de Costo',
          costoUnitario: Number(a.costo_nuevo || 0),
          costoAnterior: Number(a.costo_anterior || 0),
          cantidad: null,
          referencia_id: null,
          motivo: (a.motivo as string) || null,
          compra: null,
        })
      }
    } catch {
      // Tabla ajustes_costo puede no existir (script 026 no aplicado).
    }

    eventos.sort((a, b) => new Date(a.fecha).getTime() - new Date(b.fecha).getTime())

    const { data: prod } = await supabase.from('productos').select('costo_promedio').eq('id', productoId).single()
    const costoActual = Number(prod?.costo_promedio || 0)

    return { data: { costoActual, eventos }, error: null }
  } catch (err) {
    return { data: null, error: err instanceof Error ? err.message : 'Error de conexión' }
  }
}
