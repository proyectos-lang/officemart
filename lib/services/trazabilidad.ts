import { createClient, isSupabaseConfigured } from "@/lib/supabase/client"
import { getCompraById, getDetallesCompra, type CompraEncabezado, type CompraDetalle } from "@/lib/services/compras"

/**
 * Trazabilidad de inventario (Fase 2.7) sobre `transacciones_inventario`:
 *   - Por producto: de qué órdenes de compra / traslados / ingresos vino cada
 *     unidad (lotes) y a qué ventas / traslados / salidas fue (destinos),
 *     asignando salidas a lotes por FIFO dentro de cada almacén.
 *   - Por orden de compra: qué recibió la OC y a dónde fue cada producto.
 * Sin tabla propia. La asignación FIFO (`asignarLotesFIFO`) es pura.
 */

export interface MovimientoTraza {
  id: number
  fecha: string
  tipo_movimiento: string
  /** Cantidad con signo (+ entra, − sale) según `signoMovimiento`. */
  cantidad: number
  costo_o_precio_unitario: number
  producto_id: number
  producto_nombre: string | null
  producto_codigo: string | null
  almacen_id: number | null
  almacen_nombre: string | null
  localizacion_id: number | null
  localizacion_nombre: string | null
  referencia_id: number | null
  referencia_tipo: string | null
  /** Documento origen resuelto (FC-0001 · Cliente, OC-12 · Proveedor, DEV-0002…). */
  referencia_texto: string | null
}

export interface DestinoLote {
  movimiento_id: number
  fecha: string
  tipo_movimiento: string
  referencia_texto: string | null
  cantidad: number
}

export interface LoteTraza {
  movimiento_id: number
  fecha: string
  tipo_movimiento: string
  referencia_id: number | null
  referencia_texto: string | null
  producto_id: number
  almacen_id: number | null
  almacen_nombre: string | null
  cantidad: number
  costo_unitario: number
  /** Unidades del lote que siguen en el almacén. */
  restante: number
  destinos: DestinoLote[]
}

export interface ResultadoFIFO {
  lotes: LoteTraza[]
  /** Salidas que no pudieron asignarse a un lote (stock anterior al kardex). */
  sinLote: DestinoLote[]
}

// ==================== FUNCIONES PURAS ====================

/**
 * Signo de un movimiento del kardex: entradas positivas, salidas negativas.
 * 'Ajuste' y tipos desconocidos respetan el signo con que se guardaron.
 */
export function signoMovimiento(tipo: string, cantidad: number): number {
  const c = Number(cantidad) || 0
  const t = (tipo || "").toLowerCase()
  if (t.startsWith("entrada") || t.startsWith("ingreso") || t === "traslado entrada") return Math.abs(c)
  if (t.startsWith("salida") || t === "traslado salida") return -Math.abs(c)
  return c
}

/**
 * Asigna cada salida a los lotes (entradas) previos del MISMO producto y
 * almacén por orden de fecha (FIFO). Devuelve los lotes con sus destinos y
 * las salidas que no alcanzaron lote. Pura: el orden de entrada no importa.
 */
export function asignarLotesFIFO(movs: MovimientoTraza[]): ResultadoFIFO {
  const orden = [...movs].sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : a.id - b.id))
  const lotesPorClave = new Map<string, LoteTraza[]>()
  const lotes: LoteTraza[] = []
  const sinLote: DestinoLote[] = []
  for (const m of orden) {
    const clave = `${m.producto_id}|${m.almacen_id ?? "x"}`
    if (m.cantidad > 0) {
      const lote: LoteTraza = {
        movimiento_id: m.id,
        fecha: m.fecha,
        tipo_movimiento: m.tipo_movimiento,
        referencia_id: m.referencia_id,
        referencia_texto: m.referencia_texto,
        producto_id: m.producto_id,
        almacen_id: m.almacen_id,
        almacen_nombre: m.almacen_nombre,
        cantidad: m.cantidad,
        costo_unitario: Number(m.costo_o_precio_unitario) || 0,
        restante: m.cantidad,
        destinos: [],
      }
      lotes.push(lote)
      const lista = lotesPorClave.get(clave) || []
      lista.push(lote)
      lotesPorClave.set(clave, lista)
      continue
    }
    if (m.cantidad === 0) continue
    let pendiente = -m.cantidad
    const lista = lotesPorClave.get(clave) || []
    for (const lote of lista) {
      if (pendiente <= 0) break
      if (lote.restante <= 0) continue
      const toma = Math.min(lote.restante, pendiente)
      lote.restante = +(lote.restante - toma).toFixed(4)
      lote.destinos.push({ movimiento_id: m.id, fecha: m.fecha, tipo_movimiento: m.tipo_movimiento, referencia_texto: m.referencia_texto, cantidad: toma })
      pendiente = +(pendiente - toma).toFixed(4)
    }
    if (pendiente > 0) {
      sinLote.push({ movimiento_id: m.id, fecha: m.fecha, tipo_movimiento: m.tipo_movimiento, referencia_texto: m.referencia_texto, cantidad: pendiente })
    }
  }
  return { lotes, sinLote }
}

/** Resume destinos de un lote por tipo (para la tabla y el Excel). Pura. */
export function resumirDestinos(destinos: DestinoLote[]): { tipo: string; cantidad: number; documentos: string[] }[] {
  const m = new Map<string, { tipo: string; cantidad: number; documentos: Set<string> }>()
  for (const d of destinos) {
    let g = m.get(d.tipo_movimiento)
    if (!g) {
      g = { tipo: d.tipo_movimiento, cantidad: 0, documentos: new Set() }
      m.set(d.tipo_movimiento, g)
    }
    g.cantidad = +(g.cantidad + d.cantidad).toFixed(4)
    if (d.referencia_texto) g.documentos.add(d.referencia_texto)
  }
  return [...m.values()].map((g) => ({ tipo: g.tipo, cantidad: g.cantidad, documentos: [...g.documentos] }))
}

// ==================== CONSULTAS ====================

type Fila = Record<string, unknown> & {
  productos?: { nombre?: string; codigo_barras?: string } | { nombre?: string; codigo_barras?: string }[] | null
  almacenes?: { nombre?: string } | { nombre?: string }[] | null
  localizaciones?: { nombre?: string } | { nombre?: string }[] | null
}

function uno<T>(v: T | T[] | null | undefined): T | null {
  if (v == null) return null
  return Array.isArray(v) ? v[0] ?? null : v
}

function mapFila(r: Fila): MovimientoTraza {
  const p = uno(r.productos)
  const a = uno(r.almacenes)
  const l = uno(r.localizaciones)
  const tipo = String(r.tipo_movimiento ?? "")
  return {
    id: Number(r.id),
    fecha: String(r.fecha ?? ""),
    tipo_movimiento: tipo,
    cantidad: signoMovimiento(tipo, Number(r.cantidad ?? 0)),
    costo_o_precio_unitario: Number(r.costo_o_precio_unitario ?? 0),
    producto_id: Number(r.producto_id),
    producto_nombre: p?.nombre ?? null,
    producto_codigo: p?.codigo_barras ?? null,
    almacen_id: r.almacen_id != null ? Number(r.almacen_id) : null,
    almacen_nombre: a?.nombre ?? null,
    localizacion_id: r.localizacion_id != null ? Number(r.localizacion_id) : null,
    localizacion_nombre: l?.nombre ?? null,
    referencia_id: r.referencia_id != null ? Number(r.referencia_id) : null,
    referencia_tipo: (r.referencia_tipo as string) ?? null,
    referencia_texto: null,
  }
}

/** Rellena `referencia_texto` (ventas, compras, devoluciones) best-effort. */
async function resolverReferencias(
  supabase: NonNullable<ReturnType<typeof createClient>>,
  movs: MovimientoTraza[]
): Promise<MovimientoTraza[]> {
  try {
    const ventaIds = new Set<number>()
    const compraIds = new Set<number>()
    const devIds = new Set<number>()
    for (const m of movs) {
      if (m.referencia_id == null) continue
      const rt = (m.referencia_tipo || "").toLowerCase()
      if (m.tipo_movimiento === "Salida Venta" || rt === "venta" || rt === "anulacion_venta") ventaIds.add(m.referencia_id)
      else if (m.tipo_movimiento === "Entrada Compra" || rt === "recepcion" || rt === "compra") compraIds.add(m.referencia_id)
      else if (rt === "devolucion" || rt === "anulacion_devolucion") devIds.add(m.referencia_id)
    }
    const ventaLabel = new Map<number, string>()
    if (ventaIds.size > 0) {
      const { data } = await supabase.from("ventas_encabezado").select("id, numero_factura, clientes (nombre)").in("id", [...ventaIds])
      for (const v of (data || []) as { id: number; numero_factura: string | null; clientes?: { nombre?: string } | { nombre?: string }[] | null }[]) {
        const cli = uno(v.clientes)?.nombre
        ventaLabel.set(v.id, [v.numero_factura || `Venta #${v.id}`, cli].filter(Boolean).join(" · "))
      }
    }
    const compraLabel = new Map<number, string>()
    if (compraIds.size > 0) {
      const { data } = await supabase.from("compras_encabezado").select("id, numero_factura, proveedores (nombre)").in("id", [...compraIds])
      for (const c of (data || []) as { id: number; numero_factura: string | null; proveedores?: { nombre?: string } | { nombre?: string }[] | null }[]) {
        const prov = uno(c.proveedores)?.nombre
        compraLabel.set(c.id, [c.numero_factura ? `OC-${c.id} · ${c.numero_factura}` : `OC-${c.id}`, prov].filter(Boolean).join(" · "))
      }
    }
    const devLabel = new Map<number, string>()
    if (devIds.size > 0) {
      const { data } = await supabase.from("devoluciones_encabezado").select("id, numero_devolucion").in("id", [...devIds])
      for (const d of (data || []) as { id: number; numero_devolucion: string | null }[]) devLabel.set(d.id, d.numero_devolucion || `DEV #${d.id}`)
    }
    return movs.map((m) => {
      if (m.referencia_id == null) return m
      const rt = (m.referencia_tipo || "").toLowerCase()
      const texto =
        m.tipo_movimiento === "Salida Venta" || rt === "venta" || rt === "anulacion_venta"
          ? ventaLabel.get(m.referencia_id)
          : m.tipo_movimiento === "Entrada Compra" || rt === "recepcion" || rt === "compra"
            ? compraLabel.get(m.referencia_id)
            : rt === "devolucion" || rt === "anulacion_devolucion"
              ? devLabel.get(m.referencia_id)
              : m.tipo_movimiento.startsWith("Traslado")
                ? `Traslado #${m.referencia_id}`
                : undefined
      return texto ? { ...m, referencia_texto: texto } : m
    })
  } catch {
    return movs
  }
}

const SELECT = "*, productos (nombre, codigo_barras), almacenes (nombre), localizaciones (nombre)"

/** Kardex completo de un producto (todas las fechas) con referencias resueltas. */
export async function getMovimientosProducto(
  productoId: number
): Promise<{ data: MovimientoTraza[]; error: string | null }> {
  if (!isSupabaseConfigured()) return { data: [], error: null }
  const supabase = createClient()
  if (!supabase) return { data: [], error: "Cliente no disponible" }
  try {
    const acc: Fila[] = []
    for (let from = 0; from < 50_000; from += 1000) {
      const { data, error } = await supabase
        .from("transacciones_inventario")
        .select(SELECT)
        .eq("producto_id", productoId)
        .order("fecha", { ascending: true })
        .order("id", { ascending: true })
        .range(from, from + 999)
      if (error) return { data: [], error: error.message }
      const rows = (data || []) as Fila[]
      acc.push(...rows)
      if (rows.length < 1000) break
    }
    const movs = await resolverReferencias(supabase, acc.map(mapFila))
    return { data: movs, error: null }
  } catch (err) {
    console.error("[trazabilidad] producto:", err)
    return { data: [], error: "Error de conexión" }
  }
}

export interface TrazaCompra {
  compra: CompraEncabezado
  detalles: CompraDetalle[]
  /** Entradas del kardex generadas por esta OC (una por producto/recepción). */
  entradas: MovimientoTraza[]
  /** Lotes de esta OC con sus destinos (FIFO sobre el kardex de cada producto). */
  lotes: LoteTraza[]
}

/** Trazabilidad de una orden de compra: qué entró y a dónde fue. */
export async function getTrazaCompra(compraId: number): Promise<{ data: TrazaCompra | null; error: string | null }> {
  if (!isSupabaseConfigured()) return { data: null, error: null }
  const supabase = createClient()
  if (!supabase) return { data: null, error: "Cliente no disponible" }
  try {
    const [{ data: compra, error: cErr }, { data: detalles }] = await Promise.all([getCompraById(compraId), getDetallesCompra(compraId)])
    if (cErr || !compra) return { data: null, error: cErr || "La orden no existe" }
    const { data: entradasRaw, error: eErr } = await supabase
      .from("transacciones_inventario")
      .select(SELECT)
      .eq("tipo_movimiento", "Entrada Compra")
      .eq("referencia_id", compraId)
      .order("fecha", { ascending: true })
    if (eErr) return { data: null, error: eErr.message }
    const entradas = await resolverReferencias(supabase, ((entradasRaw || []) as Fila[]).map(mapFila))
    const productoIds = [...new Set(entradas.map((e) => e.producto_id))]
    const lotes: LoteTraza[] = []
    for (const pid of productoIds) {
      const { data: movs } = await getMovimientosProducto(pid)
      const { lotes: lp } = asignarLotesFIFO(movs)
      for (const l of lp) {
        if (l.tipo_movimiento === "Entrada Compra" && l.referencia_id === compraId) lotes.push(l)
      }
    }
    return { data: { compra, detalles: detalles || [], entradas, lotes }, error: null }
  } catch (err) {
    console.error("[trazabilidad] compra:", err)
    return { data: null, error: "Error de conexión" }
  }
}
