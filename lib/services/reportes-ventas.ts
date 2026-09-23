import { createClient, isSupabaseConfigured } from "@/lib/supabase/client"

/**
 * Reportes dinámicos de ventas (Fase 2.6) sobre `vista_ventas_reporte`
 * (script officemart-007): una fila por línea vendida con todas las
 * dimensiones (punto, vendedor, zona, cliente, producto, categoría,
 * subcategoría, línea, marca, almacén). La agregación se hace en la app
 * (`agruparReporte`, pura) para poder cruzar cualquier dimensión × medida.
 * También: productos sin movimiento (última venta + stock).
 */

export const REPORTES_FEATURE_PENDING =
  "Reportes de ventas pendientes: aplica scripts/officemart-007-estado-cuenta-reportes.sql en Supabase."

export type DimensionReporte =
  | "punto"
  | "vendedor"
  | "zona"
  | "cliente"
  | "producto"
  | "categoria"
  | "subcategoria"
  | "linea"
  | "marca"
  | "almacen"
  | "dia"
  | "mes"

export type MedidaReporte = "venta" | "cantidad" | "costo" | "utilidad" | "margen" | "facturas"

export const DIMENSIONES: { valor: DimensionReporte; label: string }[] = [
  { valor: "vendedor", label: "Vendedor" },
  { valor: "zona", label: "Zona" },
  { valor: "punto", label: "Punto de facturación" },
  { valor: "cliente", label: "Cliente" },
  { valor: "producto", label: "Producto" },
  { valor: "categoria", label: "Categoría" },
  { valor: "subcategoria", label: "Subcategoría" },
  { valor: "linea", label: "Línea" },
  { valor: "marca", label: "Marca" },
  { valor: "almacen", label: "Almacén" },
  { valor: "dia", label: "Día" },
  { valor: "mes", label: "Mes" },
]

export const MEDIDAS: { valor: MedidaReporte; label: string }[] = [
  { valor: "venta", label: "Venta (L)" },
  { valor: "cantidad", label: "Cantidad" },
  { valor: "costo", label: "Costo (L)" },
  { valor: "utilidad", label: "Utilidad (L)" },
  { valor: "margen", label: "Margen %" },
  { valor: "facturas", label: "N.º facturas" },
]

/** Fila cruda de la vista. */
export interface LineaReporte {
  detalle_id: number
  venta_id: number
  numero_factura: string
  fecha: string
  anulada_at: string | null
  punto_facturacion_id: number | null
  punto_codigo: string | null
  punto_nombre: string | null
  vendedor_id: number | null
  vendedor_nombre: string | null
  cliente_id: number | null
  cliente_nombre: string | null
  zona_id: number | null
  zona_nombre: string | null
  almacen_id: number | null
  almacen_nombre: string | null
  producto_id: number | null
  producto_nombre: string | null
  producto_codigo: string | null
  categoria_id: number | null
  categoria_nombre: string | null
  subcategoria_id: number | null
  subcategoria_nombre: string | null
  linea_id: number | null
  linea_nombre: string | null
  marca_id: number | null
  marca_nombre: string | null
  cantidad: number
  venta: number
  costo: number
  utilidad: number
}

export interface FilaAgrupada {
  clave: string
  etiqueta: string
  venta: number
  cantidad: number
  costo: number
  utilidad: number
  margen: number
  facturas: number
  /** % de la medida principal sobre el total. */
  participacion: number
}

export interface FiltrosReporte {
  desde: string
  hasta: string
  puntoId?: number | null
  vendedorId?: number | null
  zonaId?: number | null
  clienteId?: number | null
  categoriaId?: number | null
  lineaId?: number | null
}

function r2(n: number): number {
  return +(Number(n) || 0).toFixed(2)
}

/** Clave y etiqueta de una línea para la dimensión pedida (pura). */
export function claveDimension(l: LineaReporte, dim: DimensionReporte): { clave: string; etiqueta: string } {
  const sin = (nombre: string) => ({ clave: `_none`, etiqueta: `(Sin ${nombre})` })
  switch (dim) {
    case "punto":
      return l.punto_facturacion_id == null ? sin("punto") : { clave: String(l.punto_facturacion_id), etiqueta: l.punto_codigo ? `${l.punto_codigo} · ${l.punto_nombre ?? ""}` : l.punto_nombre ?? "" }
    case "vendedor":
      return l.vendedor_id == null ? sin("vendedor") : { clave: String(l.vendedor_id), etiqueta: l.vendedor_nombre ?? `#${l.vendedor_id}` }
    case "zona":
      return l.zona_id == null ? sin("zona") : { clave: String(l.zona_id), etiqueta: l.zona_nombre ?? `#${l.zona_id}` }
    case "cliente":
      return l.cliente_id == null ? sin("cliente") : { clave: String(l.cliente_id), etiqueta: l.cliente_nombre ?? `#${l.cliente_id}` }
    case "producto":
      return l.producto_id == null ? sin("producto") : { clave: String(l.producto_id), etiqueta: l.producto_nombre ?? `#${l.producto_id}` }
    case "categoria":
      return l.categoria_id == null ? sin("categoría") : { clave: String(l.categoria_id), etiqueta: l.categoria_nombre ?? `#${l.categoria_id}` }
    case "subcategoria":
      return l.subcategoria_id == null ? sin("subcategoría") : { clave: String(l.subcategoria_id), etiqueta: l.subcategoria_nombre ?? `#${l.subcategoria_id}` }
    case "linea":
      return l.linea_id == null ? sin("línea") : { clave: String(l.linea_id), etiqueta: l.linea_nombre ?? `#${l.linea_id}` }
    case "marca":
      return l.marca_id == null ? sin("marca") : { clave: String(l.marca_id), etiqueta: l.marca_nombre ?? `#${l.marca_id}` }
    case "almacen":
      return l.almacen_id == null ? sin("almacén") : { clave: String(l.almacen_id), etiqueta: l.almacen_nombre ?? `#${l.almacen_id}` }
    case "dia":
      return { clave: (l.fecha || "").slice(0, 10), etiqueta: (l.fecha || "").slice(0, 10) }
    case "mes":
      return { clave: (l.fecha || "").slice(0, 7), etiqueta: (l.fecha || "").slice(0, 7) }
  }
}

/**
 * Agrupa las líneas por dimensión y calcula todas las medidas; ordena por la
 * medida pedida (desc; por clave si es día/mes) y agrega participación (pura).
 */
export function agruparReporte(lineas: LineaReporte[], dim: DimensionReporte, medida: MedidaReporte): FilaAgrupada[] {
  const grupos = new Map<string, FilaAgrupada & { _facturas: Set<number> }>()
  for (const l of lineas) {
    if (l.anulada_at) continue
    const { clave, etiqueta } = claveDimension(l, dim)
    let g = grupos.get(clave)
    if (!g) {
      g = { clave, etiqueta, venta: 0, cantidad: 0, costo: 0, utilidad: 0, margen: 0, facturas: 0, participacion: 0, _facturas: new Set() }
      grupos.set(clave, g)
    }
    g.venta += Number(l.venta) || 0
    g.cantidad += Number(l.cantidad) || 0
    g.costo += Number(l.costo) || 0
    g.utilidad += Number(l.utilidad) || 0
    g._facturas.add(l.venta_id)
  }
  const filas: FilaAgrupada[] = []
  for (const g of grupos.values()) {
    const { _facturas, ...resto } = g
    filas.push({
      ...resto,
      venta: r2(g.venta),
      cantidad: r2(g.cantidad),
      costo: r2(g.costo),
      utilidad: r2(g.utilidad),
      margen: g.venta > 0 ? r2((g.utilidad / g.venta) * 100) : 0,
      facturas: _facturas.size,
    })
  }
  const total = filas.reduce((a, f) => a + (medida === "margen" ? 0 : Number(f[medida]) || 0), 0)
  for (const f of filas) f.participacion = total > 0 ? r2((Number(f[medida]) / total) * 100) : 0
  if (dim === "dia" || dim === "mes") filas.sort((a, b) => (a.clave < b.clave ? -1 : 1))
  else filas.sort((a, b) => Number(b[medida]) - Number(a[medida]))
  return filas
}

/** Totales globales de un conjunto de líneas vigentes (pura). */
export function totalesReporte(lineas: LineaReporte[]): { venta: number; cantidad: number; costo: number; utilidad: number; margen: number; facturas: number } {
  const vig = lineas.filter((l) => !l.anulada_at)
  const venta = vig.reduce((a, l) => a + (Number(l.venta) || 0), 0)
  const costo = vig.reduce((a, l) => a + (Number(l.costo) || 0), 0)
  const utilidad = vig.reduce((a, l) => a + (Number(l.utilidad) || 0), 0)
  return {
    venta: r2(venta),
    cantidad: r2(vig.reduce((a, l) => a + (Number(l.cantidad) || 0), 0)),
    costo: r2(costo),
    utilidad: r2(utilidad),
    margen: venta > 0 ? r2((utilidad / venta) * 100) : 0,
    facturas: new Set(vig.map((l) => l.venta_id)).size,
  }
}

function isMissingView(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false
  const msg = (err.message || "").toLowerCase()
  return err.code === "42P01" || err.code === "PGRST205" || msg.includes("schema cache") || msg.includes("vista_ventas_reporte")
}

const PAGE = 1000

/** Líneas vendidas (vigentes) del período, con filtros opcionales. */
export async function getLineasReporte(f: FiltrosReporte): Promise<{ data: LineaReporte[]; error: string | null }> {
  if (!isSupabaseConfigured()) return { data: [], error: null }
  const supabase = createClient()
  if (!supabase) return { data: [], error: "Cliente no disponible" }
  const acc: LineaReporte[] = []
  try {
    for (let from = 0; from < 100_000; from += PAGE) {
      let q = supabase
        .from("vista_ventas_reporte")
        .select("*")
        .is("anulada_at", null)
        .gte("fecha", f.desde)
        .lte("fecha", f.hasta)
        .order("fecha", { ascending: true })
        .order("detalle_id", { ascending: true })
        .range(from, from + PAGE - 1)
      if (f.puntoId != null) q = q.eq("punto_facturacion_id", f.puntoId)
      if (f.vendedorId != null) q = q.eq("vendedor_id", f.vendedorId)
      if (f.zonaId != null) q = q.eq("zona_id", f.zonaId)
      if (f.clienteId != null) q = q.eq("cliente_id", f.clienteId)
      if (f.categoriaId != null) q = q.eq("categoria_id", f.categoriaId)
      if (f.lineaId != null) q = q.eq("linea_id", f.lineaId)
      const { data, error } = await q
      if (error) {
        if (isMissingView(error)) return { data: [], error: REPORTES_FEATURE_PENDING }
        return { data: acc, error: error.message }
      }
      const rows = (data || []) as LineaReporte[]
      acc.push(...rows)
      if (rows.length < PAGE) break
    }
    return { data: acc, error: null }
  } catch (err) {
    console.error("[reportes-ventas] getLineasReporte:", err)
    return { data: [], error: "Error de conexión" }
  }
}

export interface ProductoSinMovimiento {
  producto_id: number
  nombre: string
  codigo: string | null
  categoria_nombre: string | null
  linea_nombre: string | null
  stock_total: number
  costo_promedio: number
  valor_inventario: number
  ultima_venta: string | null
  dias_sin_venta: number | null
}

/** Días desde una fecha ISO hasta hoy (null si no hay fecha). Pura. */
export function diasDesde(fechaISO: string | null | undefined, hoyISO: string): number | null {
  if (!fechaISO) return null
  const a = new Date(`${fechaISO.slice(0, 10)}T00:00:00Z`).getTime()
  const b = new Date(`${hoyISO.slice(0, 10)}T00:00:00Z`).getTime()
  if (Number.isNaN(a) || Number.isNaN(b)) return null
  return Math.max(0, Math.round((b - a) / 86_400_000))
}

/**
 * Productos con stock y sin ventas en los últimos `dias` (o nunca vendidos).
 * Une `productos` (stock, costo) con `vista_ultima_venta_producto` (067).
 */
export async function getProductosSinMovimiento(
  dias: number,
  hoyISO: string
): Promise<{ data: ProductoSinMovimiento[]; error: string | null }> {
  if (!isSupabaseConfigured()) return { data: [], error: null }
  const supabase = createClient()
  if (!supabase) return { data: [], error: "Cliente no disponible" }
  try {
    const [prodRes, ultRes, catRes, linRes] = await Promise.all([
      supabase.from("productos").select("id, nombre, codigo_barras, categoria_id, linea_id, stock_total, costo_promedio").gt("stock_total", 0),
      supabase.from("vista_ultima_venta_producto").select("producto_id, ultima_venta"),
      supabase.from("categorias").select("id, nombre"),
      supabase.from("lineas").select("id, nombre"),
    ])
    if (prodRes.error) return { data: [], error: prodRes.error.message }
    const ultima = new Map<number, string>()
    for (const u of (ultRes.data || []) as { producto_id: number; ultima_venta: string }[]) ultima.set(Number(u.producto_id), u.ultima_venta)
    const cat = new Map<number, string>()
    for (const c of (catRes.data || []) as { id: number; nombre: string }[]) cat.set(c.id, c.nombre)
    const lin = new Map<number, string>()
    for (const l of (linRes.data || []) as { id: number; nombre: string }[]) lin.set(l.id, l.nombre)

    const out: ProductoSinMovimiento[] = []
    for (const p of (prodRes.data || []) as Record<string, unknown>[]) {
      const id = Number(p.id)
      const uv = ultima.get(id) ?? null
      const d = diasDesde(uv, hoyISO)
      if (d != null && d < dias) continue
      const stock = Number(p.stock_total || 0)
      const costo = Number(p.costo_promedio || 0)
      out.push({
        producto_id: id,
        nombre: String(p.nombre ?? ""),
        codigo: (p.codigo_barras as string) ?? null,
        categoria_nombre: p.categoria_id != null ? cat.get(Number(p.categoria_id)) ?? null : null,
        linea_nombre: p.linea_id != null ? lin.get(Number(p.linea_id)) ?? null : null,
        stock_total: stock,
        costo_promedio: costo,
        valor_inventario: r2(stock * costo),
        ultima_venta: uv,
        dias_sin_venta: d,
      })
    }
    out.sort((a, b) => b.valor_inventario - a.valor_inventario)
    return { data: out, error: null }
  } catch (err) {
    console.error("[reportes-ventas] sinMovimiento:", err)
    return { data: [], error: "Error de conexión" }
  }
}
