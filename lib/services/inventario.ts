import { createClient, isSupabaseConfigured } from '@/lib/supabase/client'
import { getTenantStamp, isValidStamp, SESION_INVALIDA_ERROR } from '@/lib/services/tenant-stamp'
import { aplicarEntradaCompra, ajustarStock } from '@/lib/services/stock'
import { getHondurasNowISO } from '@/lib/utils/honduras-time'

/**
 * PostgREST corta cada `.select()` en 1000 filas. Este helper pagina con
 * `.range()` hasta traerlas todas (necesario para valoracion: productos y,
 * sobre todo, `transacciones_inventario` suelen superar 1000 filas).
 */
type RangeableQuery = {
  range: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>
}
async function fetchAllRows<T>(buildQuery: () => RangeableQuery): Promise<{ data: T[]; error: string | null }> {
  const PAGE = 1000
  let from = 0
  const acc: T[] = []
  for (let guard = 0; guard < 500; guard++) {
    const { data, error } = await buildQuery().range(from, from + PAGE - 1)
    if (error) return { data: acc, error: error.message }
    const rows = (data || []) as T[]
    acc.push(...rows)
    if (rows.length < PAGE) break
    from += PAGE
  }
  return { data: acc, error: null }
}

// ==================== INTERFACES ====================

export interface TransaccionInventario {
  id?: number
  producto_id: number
  producto_nombre?: string
  producto_codigo?: string
  almacen_id: number
  almacen_nombre?: string
  localizacion_id: number
  localizacion_nombre?: string
  tipo_movimiento: string
  cantidad: number
  costo_o_precio_unitario: number
  referencia_id?: number
  fecha?: string
  /** Etiqueta del documento origen (FC-#### para ventas, factura/OC para compras).
   *  La rellena `resolverReferenciasMovimientos`. Ausente = sin referencia. */
  referencia_texto?: string
}

export interface ProductoValoracion {
  id: number
  nombre: string
  codigo_barras: string
  stock_total: number
  costo_promedio: number
  valor_total: number
}

// ==================== KARDEX ====================

type KardexRow = TransaccionInventario & {
  productos?: { nombre?: string; codigo_barras?: string } | null
  almacenes?: { nombre?: string } | null
  localizaciones?: { nombre?: string } | null
}

/**
 * Rellena `referencia_texto` de cada movimiento con el documento origen:
 *   - 'Salida Venta'   -> numero_factura de la venta (FC-####).
 *   - 'Entrada Compra' -> numero_factura de la compra, o "OC-{id}", + proveedor.
 * `referencia_id` es polimórfico (apunta a distintas tablas según el tipo), por
 * eso se resuelve con queries separadas + Map (no hay FK para un join directo).
 * Best-effort: cualquier fallo deja el movimiento sin `referencia_texto`.
 */
async function resolverReferenciasMovimientos(
  supabase: NonNullable<ReturnType<typeof createClient>>,
  transacciones: TransaccionInventario[],
): Promise<TransaccionInventario[]> {
  try {
    const ventaIds = new Set<number>()
    const compraIds = new Set<number>()
    const ordenIds = new Set<number>()
    for (const t of transacciones) {
      if (t.referencia_id == null) continue
      if (t.tipo_movimiento === 'Salida Venta') ventaIds.add(t.referencia_id)
      else if (t.tipo_movimiento === 'Entrada Compra') compraIds.add(t.referencia_id)
      else if (t.tipo_movimiento === 'Salida Produccion') ordenIds.add(t.referencia_id)
    }

    // Consumo por etapa (officemart-010): etiqueta OP-/OT-#### de la orden.
    const ordenLabel = new Map<number, string>()
    if (ordenIds.size > 0) {
      let ordRows: { id: number; tipo?: string | null; descripcion?: string | null }[] = []
      const conTipo = await supabase.from('produccion_ordenes').select('id, tipo, descripcion').in('id', [...ordenIds])
      if (!conTipo.error) ordRows = (conTipo.data || []) as typeof ordRows
      else {
        const soloId = await supabase.from('produccion_ordenes').select('id').in('id', [...ordenIds])
        ordRows = (soloId.data || []) as typeof ordRows
      }
      for (const o of ordRows) {
        const cod = `${o.tipo === 'Trabajo' ? 'OT' : 'OP'}-${String(o.id).padStart(4, '0')}`
        ordenLabel.set(o.id, o.descripcion ? `${cod} · ${o.descripcion}` : cod)
      }
    }

    const ventaLabel = new Map<number, string>()
    if (ventaIds.size > 0) {
      const { data } = await supabase
        .from('ventas_encabezado')
        .select('id, numero_factura')
        .in('id', [...ventaIds])
      for (const v of (data || []) as { id: number; numero_factura: string | null }[]) {
        if (v.numero_factura) ventaLabel.set(v.id, v.numero_factura)
      }
    }

    const compraLabel = new Map<number, string>()
    if (compraIds.size > 0) {
      const { data } = await supabase
        .from('compras_encabezado')
        .select('id, numero_factura, proveedores (nombre)')
        .in('id', [...compraIds])
      for (const c of (data || []) as { id: number; numero_factura: string | null; proveedores?: { nombre?: string } | null }[]) {
        const doc = c.numero_factura || `OC-${c.id}`
        const prov = c.proveedores?.nombre
        compraLabel.set(c.id, prov ? `${doc} · ${prov}` : doc)
      }
    }

    return transacciones.map((t) => {
      if (t.referencia_id == null) return t
      if (t.tipo_movimiento === 'Salida Venta') {
        const label = ventaLabel.get(t.referencia_id)
        return label ? { ...t, referencia_texto: label } : t
      }
      if (t.tipo_movimiento === 'Entrada Compra') {
        const label = compraLabel.get(t.referencia_id)
        return label ? { ...t, referencia_texto: label } : t
      }
      if (t.tipo_movimiento === 'Salida Produccion') {
        const label = ordenLabel.get(t.referencia_id)
        return label ? { ...t, referencia_texto: label } : t
      }
      return t
    })
  } catch {
    return transacciones
  }
}

export async function getKardexByProducto(productoId: number): Promise<{ data: TransaccionInventario[]; error: string | null }> {
  if (!isSupabaseConfigured()) {
    const saved = localStorage.getItem('transacciones_inventario')
    const transacciones: TransaccionInventario[] = saved ? JSON.parse(saved) : []
    const filtradas = transacciones
      .filter(t => t.producto_id === productoId)
      .sort((a, b) => new Date(b.fecha || '').getTime() - new Date(a.fecha || '').getTime())
    return { data: filtradas, error: null }
  }

  const supabase = createClient()
  if (!supabase) return { data: [], error: 'Cliente no disponible' }

  try {
    // Pagina sin tope: un producto puede superar 1000 movimientos y el kardex
    // debe traer TODA su historia (el saldo acumulado depende de ello).
    const { data, error } = await fetchAllRows<KardexRow>(() =>
      supabase
        .from('transacciones_inventario')
        .select(`
          *,
          productos (nombre, codigo_barras),
          almacenes (nombre),
          localizaciones (nombre)
        `)
        .eq('producto_id', productoId)
        .order('fecha', { ascending: false })
    )

    if (error) return { data: [], error }

    const formattedData = data.map(t => ({
      ...t,
      producto_nombre: t.productos?.nombre || '',
      producto_codigo: t.productos?.codigo_barras || '',
      almacen_nombre: t.almacenes?.nombre || '',
      localizacion_nombre: t.localizaciones?.nombre || ''
    }))

    const conRef = await resolverReferenciasMovimientos(supabase, formattedData)
    return { data: conRef, error: null }
  } catch (err) {
    console.error('[Supabase] Error obteniendo kardex:', err)
    return { data: [], error: 'Error de conexion' }
  }
}

export async function getAllTransacciones(): Promise<{ data: TransaccionInventario[]; error: string | null }> {
  if (!isSupabaseConfigured()) {
    const saved = localStorage.getItem('transacciones_inventario')
    return { data: saved ? JSON.parse(saved) : [], error: null }
  }

  const supabase = createClient()
  if (!supabase) return { data: [], error: 'Cliente no disponible' }

  try {
    const { data, error } = await supabase
      .from('transacciones_inventario')
      .select(`
        *,
        productos (nombre, codigo_barras),
        almacenes (nombre),
        localizaciones (nombre)
      `)
      .order('fecha', { ascending: false })
      .limit(500)

    if (error) return { data: [], error: error.message }
    
    const formattedData = (data || []).map(t => ({
      ...t,
      producto_nombre: t.productos?.nombre || '',
      producto_codigo: t.productos?.codigo_barras || '',
      almacen_nombre: t.almacenes?.nombre || '',
      localizacion_nombre: t.localizaciones?.nombre || ''
    }))

    const conRef = await resolverReferenciasMovimientos(supabase, formattedData)
    return { data: conRef, error: null }
  } catch (err) {
    console.error('[Supabase] Error obteniendo transacciones:', err)
    return { data: [], error: 'Error de conexion' }
  }
}

// ==================== VALORACION ====================

export interface ProductoValoracionExtendida {
  id: number
  nombre: string
  codigo_barras: string
  /** Talla del producto (para agrupar tallados en la valoracion). */
  talla: string | null
  stock_total: number
  costo_promedio: number
  precio_venta: number
  valor_costo: number
  valor_comercial: number
  margen_potencial: number
  dias_sin_venta: number | null
  ultima_venta: string | null
  stock_por_almacen: { almacen_id: number; almacen_nombre: string; stock: number; valor_costo: number; valor_comercial: number }[]
}

type ProdValRow = { id: number; nombre: string; codigo_barras: string | null; talla: string | null; stock_total: number | null; costo_promedio: number | null; precio_venta_sugerido: number | null }

/**
 * Camino rápido de la valoración: usa las vistas SQL del script 067
 * (`vista_stock_producto_almacen` y `vista_ultima_venta_producto`) para obtener
 * el stock por almacén y la última venta ya AGREGADOS en la base, evitando traer
 * todo el kardex al navegador. Devuelve el MISMO shape que el cálculo en JS.
 *
 * Devuelve `null` si alguna vista no existe (script sin correr) o falla → el
 * llamador cae al camino en JS. Best-effort en la resolución de nombres.
 */
async function valoracionDesdeVistas(
  supabase: NonNullable<ReturnType<typeof createClient>>,
  productos: ProdValRow[],
): Promise<ProductoValoracionExtendida[] | null> {
  try {
    const [stockRes, ventaRes, almRes] = await Promise.all([
      fetchAllRows<{ producto_id: number; almacen_id: number; stock: number | null }>(() =>
        supabase.from('vista_stock_producto_almacen').select('producto_id, almacen_id, stock')
      ),
      supabase.from('vista_ultima_venta_producto').select('producto_id, ultima_venta'),
      supabase.from('almacenes').select('id, nombre'),
    ])
    // Si una vista no existe / falla, abortamos el camino rápido (fallback JS).
    if (stockRes.error || ventaRes.error) return null

    const almNombre = new Map<number, string>()
    for (const a of (almRes.data || []) as { id: number; nombre: string }[]) almNombre.set(a.id, a.nombre)

    // Stock por almacén agrupado por producto.
    const stockPorProd = new Map<number, { almacen_id: number; stock: number }[]>()
    for (const r of stockRes.data || []) {
      const s = Number(r.stock || 0)
      if (s === 0) continue // el JS actual filtra stock !== 0
      const arr = stockPorProd.get(r.producto_id) ?? []
      arr.push({ almacen_id: r.almacen_id, stock: s })
      stockPorProd.set(r.producto_id, arr)
    }

    const ultimaVentaProd = new Map<number, string | null>()
    for (const r of (ventaRes.data || []) as { producto_id: number; ultima_venta: string | null }[]) {
      ultimaVentaProd.set(r.producto_id, r.ultima_venta ?? null)
    }

    const now = new Date()
    return productos.map((p) => {
      const stockPorAlmacen = (stockPorProd.get(p.id) ?? []).map((s) => ({
        almacen_id: s.almacen_id,
        almacen_nombre: almNombre.get(s.almacen_id) || `Almacen ${s.almacen_id}`,
        stock: s.stock,
        valor_costo: s.stock * (p.costo_promedio || 0),
        valor_comercial: s.stock * (p.precio_venta_sugerido || 0),
      }))
      const ultimaVenta = ultimaVentaProd.get(p.id) ?? null
      let diasSinVenta: number | null = null
      if (ultimaVenta) {
        diasSinVenta = Math.floor((now.getTime() - new Date(ultimaVenta).getTime()) / (1000 * 60 * 60 * 24))
      }
      return {
        id: p.id,
        nombre: p.nombre,
        codigo_barras: p.codigo_barras || '',
        talla: p.talla ?? null,
        stock_total: p.stock_total || 0,
        costo_promedio: p.costo_promedio || 0,
        precio_venta: p.precio_venta_sugerido || 0,
        valor_costo: (p.stock_total || 0) * (p.costo_promedio || 0),
        valor_comercial: (p.stock_total || 0) * (p.precio_venta_sugerido || 0),
        margen_potencial: ((p.stock_total || 0) * (p.precio_venta_sugerido || 0)) - ((p.stock_total || 0) * (p.costo_promedio || 0)),
        dias_sin_venta: diasSinVenta,
        ultima_venta: ultimaVenta,
        stock_por_almacen: stockPorAlmacen,
      }
    })
  } catch {
    return null
  }
}

export async function getValoracionInventarioExtendida(): Promise<{ data: ProductoValoracionExtendida[]; error: string | null }> {
  if (!isSupabaseConfigured()) {
    const savedProds = localStorage.getItem('productos')
    const savedTrans = localStorage.getItem('transacciones_inventario')
    const savedAlmacenes = localStorage.getItem('almacenes')
    
    const productos = savedProds ? JSON.parse(savedProds) : []
    const transacciones: TransaccionInventario[] = savedTrans ? JSON.parse(savedTrans) : []
    const almacenes = savedAlmacenes ? JSON.parse(savedAlmacenes) : []
    
    const now = new Date()
    
    const valoracion = productos.map((p: { id: number; nombre: string; codigo_barras: string; talla?: string | null; stock_total: number; costo_promedio: number; precio_venta_sugerido: number }) => {
      const stockPorAlmacen = almacenes.map((a: { id: number; nombre: string }) => {
        const stock = transacciones
          .filter(t => t.producto_id === p.id && t.almacen_id === a.id)
          .reduce((sum, t) => sum + (t.cantidad || 0), 0)
        return {
          almacen_id: a.id,
          almacen_nombre: a.nombre,
          stock,
          valor_costo: stock * (p.costo_promedio || 0),
          valor_comercial: stock * (p.precio_venta_sugerido || 0)
        }
      }).filter((s: { stock: number }) => s.stock !== 0)
      
      // Find last sale for this product
      const ventasProducto = transacciones
        .filter(t => t.producto_id === p.id && t.tipo_movimiento === 'Salida Venta')
        .sort((a, b) => new Date(b.fecha || '').getTime() - new Date(a.fecha || '').getTime())
      
      const ultimaVenta = ventasProducto.length > 0 ? ventasProducto[0].fecha || null : null
      let diasSinVenta: number | null = null
      
      if (ultimaVenta) {
        const fechaUltimaVenta = new Date(ultimaVenta)
        diasSinVenta = Math.floor((now.getTime() - fechaUltimaVenta.getTime()) / (1000 * 60 * 60 * 24))
      }
      
      return {
        id: p.id,
        nombre: p.nombre,
        codigo_barras: p.codigo_barras || '',
        talla: p.talla ?? null,
        stock_total: p.stock_total || 0,
        costo_promedio: p.costo_promedio || 0,
        precio_venta: p.precio_venta_sugerido || 0,
        valor_costo: (p.stock_total || 0) * (p.costo_promedio || 0),
        valor_comercial: (p.stock_total || 0) * (p.precio_venta_sugerido || 0),
        margen_potencial: ((p.stock_total || 0) * (p.precio_venta_sugerido || 0)) - ((p.stock_total || 0) * (p.costo_promedio || 0)),
        dias_sin_venta: diasSinVenta,
        ultima_venta: ultimaVenta,
        stock_por_almacen: stockPorAlmacen
      }
    })
    return { data: valoracion, error: null }
  }

  const supabase = createClient()
  if (!supabase) return { data: [], error: 'Cliente no disponible' }

  type ProdRow = { id: number; nombre: string; codigo_barras: string | null; talla: string | null; stock_total: number | null; costo_promedio: number | null; precio_venta_sugerido: number | null }
  type TransRow = { producto_id: number; almacen_id: number; cantidad: number | null; tipo_movimiento: string; fecha: string | null; almacenes: { nombre?: string } | { nombre?: string }[] | null }

  try {
    // Productos y transacciones via bucle por rangos (superan el tope de 1000).
    const { data: productos, error: prodError } = await fetchAllRows<ProdRow>(() =>
      supabase
        .from('productos')
        .select('id, nombre, codigo_barras, talla, stock_total, costo_promedio, precio_venta_sugerido')
        .order('nombre', { ascending: true })
    )
    if (prodError) return { data: [], error: prodError }

    // CAMINO RÁPIDO (script 067): las dos agregaciones costosas (stock por almacén
    // y última venta por producto) se leen de vistas SQL ya agregadas, en vez de
    // traer TODO el kardex y hacer un bucle O(productos × transacciones) en JS.
    // Si alguna vista no existe (script sin correr), se cae al camino de abajo.
    const rapido = await valoracionDesdeVistas(supabase, productos || [])
    if (rapido) return { data: rapido, error: null }

    const { data: transacciones, error: transError } = await fetchAllRows<TransRow>(() =>
      supabase
        .from('transacciones_inventario')
        .select('producto_id, almacen_id, cantidad, tipo_movimiento, fecha, almacenes(nombre)')
    )
    if (transError) return { data: [], error: transError }

    const now = new Date()

    // Process valoracion
    const valoracion = (productos || []).map(p => {
      // Group transactions by almacen
      const stockByAlmacen: Record<number, { nombre: string; stock: number }> = {}
      
      const transaccionesProducto = (transacciones || []).filter(t => t.producto_id === p.id)
      
      transaccionesProducto.forEach(t => {
          if (!stockByAlmacen[t.almacen_id]) {
            // El join puede venir tipado como objeto o arreglo segun el parser.
            const almacen = Array.isArray(t.almacenes) ? t.almacenes[0] : t.almacenes
            stockByAlmacen[t.almacen_id] = {
              nombre: (almacen as { nombre: string } | null)?.nombre || `Almacen ${t.almacen_id}`,
              stock: 0
            }
          }
          stockByAlmacen[t.almacen_id].stock += t.cantidad || 0
        })

      const stockPorAlmacen = Object.entries(stockByAlmacen)
        .filter(([_, v]) => v.stock !== 0)
        .map(([almacenId, v]) => ({
          almacen_id: parseInt(almacenId),
          almacen_nombre: v.nombre,
          stock: v.stock,
          valor_costo: v.stock * (p.costo_promedio || 0),
          valor_comercial: v.stock * (p.precio_venta_sugerido || 0)
        }))

      // Find last sale for this product
      const ventas = transaccionesProducto
        .filter(t => t.tipo_movimiento === 'Salida Venta' && t.fecha)
        .sort((a, b) => new Date(b.fecha!).getTime() - new Date(a.fecha!).getTime())
      
      const ultimaVenta = ventas.length > 0 ? ventas[0].fecha! : null
      let diasSinVenta: number | null = null
      
      if (ultimaVenta) {
        const fechaUltimaVenta = new Date(ultimaVenta)
        diasSinVenta = Math.floor((now.getTime() - fechaUltimaVenta.getTime()) / (1000 * 60 * 60 * 24))
      }

      return {
        id: p.id,
        nombre: p.nombre,
        codigo_barras: p.codigo_barras || '',
        talla: p.talla ?? null,
        stock_total: p.stock_total || 0,
        costo_promedio: p.costo_promedio || 0,
        precio_venta: p.precio_venta_sugerido || 0,
        valor_costo: (p.stock_total || 0) * (p.costo_promedio || 0),
        valor_comercial: (p.stock_total || 0) * (p.precio_venta_sugerido || 0),
        margen_potencial: ((p.stock_total || 0) * (p.precio_venta_sugerido || 0)) - ((p.stock_total || 0) * (p.costo_promedio || 0)),
        dias_sin_venta: diasSinVenta,
        ultima_venta: ultimaVenta,
        stock_por_almacen: stockPorAlmacen
      }
    })

    return { data: valoracion, error: null }
  } catch (err) {
    console.error('[Supabase] Error obteniendo valoracion extendida:', err)
    return { data: [], error: 'Error de conexion' }
  }
}

export async function getValoracionPorAlmacen(almacenId: number): Promise<{ data: ProductoValoracionExtendida[]; error: string | null }> {
  if (!isSupabaseConfigured()) {
    const savedProds = localStorage.getItem('productos')
    const savedTrans = localStorage.getItem('transacciones_inventario')
    const savedAlmacenes = localStorage.getItem('almacenes')
    
    const productos = savedProds ? JSON.parse(savedProds) : []
    const transacciones: TransaccionInventario[] = savedTrans ? JSON.parse(savedTrans) : []
    const almacenes = savedAlmacenes ? JSON.parse(savedAlmacenes) : []
    const almacen = almacenes.find((a: { id: number }) => a.id === almacenId)
    
    const now = new Date()
    
    const valoracion = productos.map((p: { id: number; nombre: string; codigo_barras: string; talla?: string | null; costo_promedio: number; precio_venta_sugerido: number }) => {
      // Get stock only for the specific almacen
      const stockAlmacen = transacciones
        .filter(t => t.producto_id === p.id && t.almacen_id === almacenId)
        .reduce((sum, t) => sum + (t.cantidad || 0), 0)
      
      if (stockAlmacen === 0) return null // Exclude products with no stock in this almacen
      
      // Find last sale for this product
      const ventasProducto = transacciones
        .filter(t => t.producto_id === p.id && t.tipo_movimiento === 'Salida Venta')
        .sort((a, b) => new Date(b.fecha || '').getTime() - new Date(a.fecha || '').getTime())
      
      const ultimaVenta = ventasProducto.length > 0 ? ventasProducto[0].fecha || null : null
      let diasSinVenta: number | null = null
      
      if (ultimaVenta) {
        const fechaUltimaVenta = new Date(ultimaVenta)
        diasSinVenta = Math.floor((now.getTime() - fechaUltimaVenta.getTime()) / (1000 * 60 * 60 * 24))
      }
      
      return {
        id: p.id,
        nombre: p.nombre,
        codigo_barras: p.codigo_barras || '',
        talla: p.talla ?? null,
        stock_total: stockAlmacen,
        costo_promedio: p.costo_promedio || 0,
        precio_venta: p.precio_venta_sugerido || 0,
        valor_costo: stockAlmacen * (p.costo_promedio || 0),
        valor_comercial: stockAlmacen * (p.precio_venta_sugerido || 0),
        margen_potencial: (stockAlmacen * (p.precio_venta_sugerido || 0)) - (stockAlmacen * (p.costo_promedio || 0)),
        dias_sin_venta: diasSinVenta,
        ultima_venta: ultimaVenta,
        stock_por_almacen: [{
          almacen_id: almacenId,
          almacen_nombre: almacen?.nombre || `Almacen ${almacenId}`,
          stock: stockAlmacen,
          valor_costo: stockAlmacen * (p.costo_promedio || 0),
          valor_comercial: stockAlmacen * (p.precio_venta_sugerido || 0)
        }]
      }
    }).filter((p: ProductoValoracionExtendida | null): p is ProductoValoracionExtendida => p !== null)

    return { data: valoracion, error: null }
  }

  const supabase = createClient()
  if (!supabase) return { data: [], error: 'Cliente no disponible' }

  type ProdRowA = { id: number; nombre: string; codigo_barras: string | null; talla: string | null; costo_promedio: number | null; precio_venta_sugerido: number | null }
  type TransRowA = { producto_id: number; cantidad: number | null; tipo_movimiento: string; fecha: string | null }

  try {
    // Productos y transacciones via bucle por rangos (superan el tope de 1000).
    const { data: productos, error: prodError } = await fetchAllRows<ProdRowA>(() =>
      supabase
        .from('productos')
        .select('id, nombre, codigo_barras, talla, costo_promedio, precio_venta_sugerido')
        .order('nombre', { ascending: true })
    )
    if (prodError) return { data: [], error: prodError }

    const { data: transacciones, error: transError } = await fetchAllRows<TransRowA>(() =>
      supabase
        .from('transacciones_inventario')
        .select('producto_id, cantidad, tipo_movimiento, fecha')
        .eq('almacen_id', almacenId)
    )
    if (transError) return { data: [], error: transError }

    // Get almacen name
    const { data: almacenData } = await supabase
      .from('almacenes')
      .select('nombre')
      .eq('id', almacenId)
      .single()

    const now = new Date()

    // Process valoracion
    const valoracion = (productos || []).map(p => {
      // Calculate stock for this almacen
      const transaccionesProducto = (transacciones || []).filter(t => t.producto_id === p.id)
      const stockAlmacen = transaccionesProducto.reduce((sum, t) => sum + (t.cantidad || 0), 0)
      
      if (stockAlmacen === 0) return null
      
      // Find last sale for this product
      const ventas = transaccionesProducto
        .filter(t => t.tipo_movimiento === 'Salida Venta' && t.fecha)
        .sort((a, b) => new Date(b.fecha!).getTime() - new Date(a.fecha!).getTime())
      
      const ultimaVenta = ventas.length > 0 ? ventas[0].fecha! : null
      let diasSinVenta: number | null = null
      
      if (ultimaVenta) {
        const fechaUltimaVenta = new Date(ultimaVenta)
        diasSinVenta = Math.floor((now.getTime() - fechaUltimaVenta.getTime()) / (1000 * 60 * 60 * 24))
      }

      return {
        id: p.id,
        nombre: p.nombre,
        codigo_barras: p.codigo_barras || '',
        talla: p.talla ?? null,
        stock_total: stockAlmacen,
        costo_promedio: p.costo_promedio || 0,
        precio_venta: p.precio_venta_sugerido || 0,
        valor_costo: stockAlmacen * (p.costo_promedio || 0),
        valor_comercial: stockAlmacen * (p.precio_venta_sugerido || 0),
        margen_potencial: (stockAlmacen * (p.precio_venta_sugerido || 0)) - (stockAlmacen * (p.costo_promedio || 0)),
        dias_sin_venta: diasSinVenta,
        ultima_venta: ultimaVenta,
        stock_por_almacen: [{
          almacen_id: almacenId,
          almacen_nombre: almacenData?.nombre || `Almacen ${almacenId}`,
          stock: stockAlmacen,
          valor_costo: stockAlmacen * (p.costo_promedio || 0),
          valor_comercial: stockAlmacen * (p.precio_venta_sugerido || 0)
        }]
      }
    }).filter((p): p is ProductoValoracionExtendida => p !== null)

    return { data: valoracion, error: null }
  } catch (err) {
    console.error('[Supabase] Error obteniendo valoracion por almacen:', err)
    return { data: [], error: 'Error de conexion' }
  }
}

export async function getValoracionInventario(): Promise<{ data: ProductoValoracion[]; error: string | null }> {
  if (!isSupabaseConfigured()) {
    const saved = localStorage.getItem('productos')
    const productos: ProductoValoracion[] = saved ? JSON.parse(saved) : []
    const valoracion = productos.map(p => ({
      id: p.id,
      nombre: p.nombre,
      codigo_barras: p.codigo_barras || '',
      stock_total: p.stock_total || 0,
      costo_promedio: p.costo_promedio || 0,
      valor_total: (p.stock_total || 0) * (p.costo_promedio || 0)
    }))
    return { data: valoracion, error: null }
  }

  const supabase = createClient()
  if (!supabase) return { data: [], error: 'Cliente no disponible' }

  try {
    const { data, error } = await supabase
      .from('productos')
      .select('id, nombre, codigo_barras, stock_total, costo_promedio')
      .order('nombre', { ascending: true })

    if (error) return { data: [], error: error.message }
    
    const valoracion = (data || []).map(p => ({
      id: p.id,
      nombre: p.nombre,
      codigo_barras: p.codigo_barras || '',
      stock_total: p.stock_total || 0,
      costo_promedio: p.costo_promedio || 0,
      valor_total: (p.stock_total || 0) * (p.costo_promedio || 0)
    }))
    
    return { data: valoracion, error: null }
  } catch (err) {
    console.error('[Supabase] Error obteniendo valoracion:', err)
    return { data: [], error: 'Error de conexion' }
  }
}

// ==================== STOCK POR LOCALIZACION ====================

export async function getStockByLocalizacion(
  productoId: number, 
  localizacionId: number
): Promise<{ stock: number; error: string | null }> {
  if (!isSupabaseConfigured()) {
    const saved = localStorage.getItem('transacciones_inventario')
    const transacciones: TransaccionInventario[] = saved ? JSON.parse(saved) : []
    
    const stock = transacciones
      .filter(t => t.producto_id === productoId && t.localizacion_id === localizacionId)
      .reduce((sum, t) => sum + (t.cantidad || 0), 0)
    
    return { stock, error: null }
  }

  const supabase = createClient()
  if (!supabase) return { stock: 0, error: 'Cliente no disponible' }

  try {
    const { data, error } = await supabase
      .from('transacciones_inventario')
      .select('cantidad')
      .eq('producto_id', productoId)
      .eq('localizacion_id', localizacionId)

    if (error) return { stock: 0, error: error.message }
    
    const stock = (data || []).reduce((sum, t) => sum + (t.cantidad || 0), 0)
    return { stock, error: null }
  } catch (err) {
    console.error('[Supabase] Error obteniendo stock por localizacion:', err)
    return { stock: 0, error: 'Error de conexion' }
  }
}

/**
 * Stock de un producto DESGLOSADO por localización (solo las que tienen saldo
 * distinto de 0). Se deriva sumando las transacciones del kardex agrupadas por
 * `localizacion_id`. Lo usa la conversión a producto tallado para saber en qué
 * localización repartir (y bloquear si el stock está en más de una).
 */
export async function getStockPorLocalizaciones(
  productoId: number
): Promise<{ data: { almacen_id: number | null; localizacion_id: number | null; stock: number }[]; error: string | null }> {
  const { data: kardex, error } = await getKardexByProducto(productoId)
  if (error) return { data: [], error }

  const map = new Map<number | null, { almacen_id: number | null; localizacion_id: number | null; stock: number }>()
  for (const t of kardex) {
    const key = t.localizacion_id ?? null
    const cur = map.get(key) ?? { almacen_id: t.almacen_id ?? null, localizacion_id: key, stock: 0 }
    cur.stock += Number(t.cantidad || 0)
    if (cur.almacen_id == null && t.almacen_id != null) cur.almacen_id = t.almacen_id
    map.set(key, cur)
  }
  // Solo las localizaciones con saldo (tolerancia por decimales).
  const conSaldo = Array.from(map.values()).filter((l) => Math.abs(l.stock) > 0.0001)
  return { data: conSaldo, error: null }
}

export async function getStockMultipleProducts(
  productoIds: number[],
  localizacionId: number
): Promise<{ data: Record<number, number>; error: string | null }> {
  if (productoIds.length === 0 || !localizacionId) {
    return { data: {}, error: null }
  }

  if (!isSupabaseConfigured()) {
    const saved = localStorage.getItem('transacciones_inventario')
    const transacciones: TransaccionInventario[] = saved ? JSON.parse(saved) : []
    
    const stockMap: Record<number, number> = {}
    productoIds.forEach(pid => {
      stockMap[pid] = transacciones
        .filter(t => t.producto_id === pid && t.localizacion_id === localizacionId)
        .reduce((sum, t) => sum + (t.cantidad || 0), 0)
    })
    
    return { data: stockMap, error: null }
  }

  const supabase = createClient()
  if (!supabase) return { data: {}, error: 'Cliente no disponible' }

  try {
    const stockMap: Record<number, number> = {}
    productoIds.forEach(pid => { stockMap[pid] = 0 })

    // Catalogos grandes (>1000 productos): el filtro .in() con miles de ids
    // reventaria la URL, y el resultado se corta en 1000 filas. Por eso
    // troceamos los ids en lotes y paginamos el resultado de cada lote (con
    // orden estable para que el .range() no salte ni repita filas).
    const CHUNK = 300
    const PAGE = 1000
    for (let i = 0; i < productoIds.length; i += CHUNK) {
      const ids = productoIds.slice(i, i + CHUNK)
      for (let from = 0, guard = 0; guard < 500; guard++, from += PAGE) {
        const { data, error } = await supabase
          .from('transacciones_inventario')
          .select('producto_id, cantidad')
          .in('producto_id', ids)
          .eq('localizacion_id', localizacionId)
          .order('id', { ascending: true })
          .range(from, from + PAGE - 1)
        if (error) return { data: {}, error: error.message }
        const rows = data || []
        for (const t of rows) {
          stockMap[t.producto_id] = (stockMap[t.producto_id] || 0) + (t.cantidad || 0)
        }
        if (rows.length < PAGE) break
      }
    }

    return { data: stockMap, error: null }
  } catch (err) {
    console.error('[Supabase] Error obteniendo stock multiple:', err)
    return { data: {}, error: 'Error de conexion' }
  }
}

// ==================== INGRESO MANUAL ====================

interface IngresoManualData {
  /** 'ingreso' suma stock y recalcula costo; 'salida' resta stock (sin cambiar costo). Default: 'ingreso'. */
  tipo?: 'ingreso' | 'salida'
  producto_id: number
  almacen_id: number
  localizacion_id: number
  cantidad: number
  costo_unitario: number
  observaciones?: string
  stock_anterior: number
  costo_anterior: number
  nuevo_stock: number
  nuevo_costo: number
}

export async function procesarIngresoManual(data: IngresoManualData): Promise<{ success: boolean; error: string | null }> {
  // Salida: nunca dejar el stock en negativo (validacion temprana con el stock
  // que vio la pagina; la rama Supabase re-valida con el stock real de la fila).
  if (data.tipo === 'salida') {
    const stockPrevio = Number(data.stock_anterior || 0)
    if (stockPrevio <= 0) {
      return { success: false, error: 'El producto no tiene existencias; no se puede dar salida.' }
    }
    if (data.cantidad > stockPrevio) {
      return { success: false, error: `La salida (${data.cantidad}) supera las existencias (${stockPrevio}).` }
    }
  }

  if (!isSupabaseConfigured()) {
    // LocalStorage implementation
    const savedTrans = localStorage.getItem('transacciones_inventario')
    const transacciones: TransaccionInventario[] = savedTrans ? JSON.parse(savedTrans) : []
    
    const savedProds = localStorage.getItem('productos')
    const productos = savedProds ? JSON.parse(savedProds) : []
    
    const now = getHondurasNowISO()
    
    // Insert transaction
    transacciones.push({
      id: Date.now(),
      producto_id: data.producto_id,
      almacen_id: data.almacen_id,
      localizacion_id: data.localizacion_id,
      tipo_movimiento: 'Ajuste',
      cantidad: data.cantidad,
      costo_o_precio_unitario: data.costo_unitario,
      fecha: now
    })
    
    // Update product stock and cost
    const prodIndex = productos.findIndex((p: { id: number }) => p.id === data.producto_id)
    if (prodIndex !== -1) {
      productos[prodIndex].stock_total = data.nuevo_stock
      productos[prodIndex].costo_promedio = data.nuevo_costo
    }
    
    localStorage.setItem('transacciones_inventario', JSON.stringify(transacciones))
    localStorage.setItem('productos', JSON.stringify(productos))
    
    return { success: true, error: null }
  }

  const supabase = createClient()
  if (!supabase) return { success: false, error: 'Cliente no disponible' }

  try {
    const stamp = await getTenantStamp(supabase)
    if (!isValidStamp(stamp)) {
      console.log('[procesarIngresoManual] Stamp invalido:', stamp)
      return { success: false, error: SESION_INVALIDA_ERROR }
    }

    // ----- SALIDA manual: resta stock sin cambiar el costo promedio -----
    if (data.tipo === 'salida') {
      // Re-valida contra el stock REAL de la fila (evita negativos por lecturas
      // obsoletas o concurrencia).
      const { data: prod, error: readErr } = await supabase
        .from('productos')
        .select('stock_total, costo_promedio')
        .eq('id', data.producto_id)
        .single()
      if (readErr) return { success: false, error: readErr.message }
      const stock = Number(prod?.stock_total || 0)
      if (stock <= 0) {
        return { success: false, error: 'El producto no tiene existencias; no se puede dar salida.' }
      }
      if (data.cantidad > stock) {
        return { success: false, error: `La salida (${data.cantidad}) supera las existencias disponibles (${stock}).` }
      }

      const { error: salidaTransError } = await supabase
        .from('transacciones_inventario')
        .insert({
          producto_id: data.producto_id,
          almacen_id: data.almacen_id,
          localizacion_id: data.localizacion_id,
          tipo_movimiento: 'Salida Manual',
          cantidad: -data.cantidad,
          costo_o_precio_unitario: Number(prod?.costo_promedio || data.costo_anterior || 0),
          fecha: getHondurasNowISO(), // dia de negocio HN (kardex usa split)
          ...stamp,
        })
      if (salidaTransError) return { success: false, error: salidaTransError.message }

      // Resta stock (solo stock_total; el costo promedio no cambia en salidas).
      const aj = await ajustarStock(supabase, data.producto_id, -data.cantidad, stamp.razon_social_id)
      if (aj.error) return { success: false, error: aj.error }

      return { success: true, error: null }
    }

    // ----- INGRESO (entrada): suma stock y recalcula costo promedio -----
    const { error: transError } = await supabase
      .from('transacciones_inventario')
      .insert({
        producto_id: data.producto_id,
        almacen_id: data.almacen_id,
        localizacion_id: data.localizacion_id,
        tipo_movimiento: 'Ingreso Manual',
        cantidad: data.cantidad,
        costo_o_precio_unitario: data.costo_unitario,
        fecha: getHondurasNowISO(), // dia de negocio HN (kardex usa split)
        ...stamp
      })

    if (transError) return { success: false, error: transError.message }

    // Suma stock y recalcula costo promedio ponderado de forma ATOMICA en el
    // servidor. Se recalcula desde los valores reales de la fila (no desde el
    // nuevo_stock/nuevo_costo que la pagina calculo con una lectura que pudo
    // quedar obsoleta). Ver lib/services/stock.ts + script 018.
    const entrada = await aplicarEntradaCompra(
      supabase,
      data.producto_id,
      data.cantidad,
      data.costo_unitario
    )
    if (entrada.error) return { success: false, error: entrada.error }

    return { success: true, error: null }
  } catch (err) {
    console.error('[Supabase] Error procesando ingreso manual:', err)
    return { success: false, error: 'Error de conexion' }
  }
}

// ==================== TRASLADOS ====================

interface TrasladoData {
  producto_id: number
  origen_almacen_id: number
  origen_localizacion_id: number
  destino_almacen_id: number
  destino_localizacion_id: number
  cantidad: number
  costo_unitario: number
}

export async function procesarTraslado(data: TrasladoData): Promise<{ success: boolean; error: string | null }> {
  if (!isSupabaseConfigured()) {
    const saved = localStorage.getItem('transacciones_inventario')
    const transacciones: TransaccionInventario[] = saved ? JSON.parse(saved) : []
    
    const now = getHondurasNowISO()
    const refId = Date.now()
    
    // Salida del origen
    transacciones.push({
      id: Date.now(),
      producto_id: data.producto_id,
      almacen_id: data.origen_almacen_id,
      localizacion_id: data.origen_localizacion_id,
      tipo_movimiento: 'Traslado Salida',
      cantidad: -data.cantidad,
      costo_o_precio_unitario: data.costo_unitario,
      referencia_id: refId,
      fecha: now
    })
    
    // Entrada al destino
    transacciones.push({
      id: Date.now() + 1,
      producto_id: data.producto_id,
      almacen_id: data.destino_almacen_id,
      localizacion_id: data.destino_localizacion_id,
      tipo_movimiento: 'Traslado Entrada',
      cantidad: data.cantidad,
      costo_o_precio_unitario: data.costo_unitario,
      referencia_id: refId,
      fecha: now
    })
    
    localStorage.setItem('transacciones_inventario', JSON.stringify(transacciones))
    return { success: true, error: null }
  }

  const supabase = createClient()
  if (!supabase) return { success: false, error: 'Cliente no disponible' }

  try {
    const stamp = await getTenantStamp(supabase)
    if (!isValidStamp(stamp)) {
      console.log('[procesarTraslado] Stamp invalido:', stamp)
      return { success: false, error: SESION_INVALIDA_ERROR }
    }

    const refId = Date.now()
    
    // Insert salida (cantidad negativa)
    const { error: salidaError } = await supabase
      .from('transacciones_inventario')
      .insert({
        producto_id: data.producto_id,
        almacen_id: data.origen_almacen_id,
        localizacion_id: data.origen_localizacion_id,
        tipo_movimiento: 'Traslado Salida',
        cantidad: -data.cantidad,
        costo_o_precio_unitario: data.costo_unitario,
        referencia_id: refId,
        fecha: getHondurasNowISO(), // dia de negocio HN (kardex usa split)
        ...stamp
      })

    if (salidaError) return { success: false, error: salidaError.message }

    // Insert entrada (cantidad positiva)
    const { error: entradaError } = await supabase
      .from('transacciones_inventario')
      .insert({
        producto_id: data.producto_id,
        almacen_id: data.destino_almacen_id,
        localizacion_id: data.destino_localizacion_id,
        tipo_movimiento: 'Traslado Entrada',
        cantidad: data.cantidad,
        costo_o_precio_unitario: data.costo_unitario,
        referencia_id: refId,
        fecha: getHondurasNowISO(), // dia de negocio HN (kardex usa split)
        ...stamp
      })

    if (entradaError) return { success: false, error: entradaError.message }

    return { success: true, error: null }
  } catch (err) {
    console.error('[Supabase] Error procesando traslado:', err)
    return { success: false, error: 'Error de conexion' }
  }
}

// ==================== TRASLADOS MULTIPLES ====================

export interface TrasladoLineaData {
  producto_id: number
  producto_nombre: string
  cantidad: number
  costo_unitario: number
}

export async function procesarTrasladosMultiples(
  lineas: TrasladoLineaData[],
  origen_almacen_id: number,
  origen_localizacion_id: number,
  destino_almacen_id: number,
  destino_localizacion_id: number
): Promise<{ success: boolean; error: string | null; procesados: number }> {
  if (lineas.length === 0) {
    return { success: false, error: 'No hay productos para trasladar', procesados: 0 }
  }

  if (!isSupabaseConfigured()) {
    const saved = localStorage.getItem('transacciones_inventario')
    const transacciones: TransaccionInventario[] = saved ? JSON.parse(saved) : []
    
    const now = getHondurasNowISO()
    const refIdBase = Date.now()
    
    lineas.forEach((linea, index) => {
      const refId = refIdBase + index
      
      // Salida del origen
      transacciones.push({
        id: refIdBase + (index * 2),
        producto_id: linea.producto_id,
        almacen_id: origen_almacen_id,
        localizacion_id: origen_localizacion_id,
        tipo_movimiento: 'Traslado Salida',
        cantidad: -linea.cantidad,
        costo_o_precio_unitario: linea.costo_unitario,
        referencia_id: refId,
        fecha: now
      })
      
      // Entrada al destino
      transacciones.push({
        id: refIdBase + (index * 2) + 1,
        producto_id: linea.producto_id,
        almacen_id: destino_almacen_id,
        localizacion_id: destino_localizacion_id,
        tipo_movimiento: 'Traslado Entrada',
        cantidad: linea.cantidad,
        costo_o_precio_unitario: linea.costo_unitario,
        referencia_id: refId,
        fecha: now
      })
    })
    
    localStorage.setItem('transacciones_inventario', JSON.stringify(transacciones))
    return { success: true, error: null, procesados: lineas.length }
  }

  const supabase = createClient()
  if (!supabase) return { success: false, error: 'Cliente no disponible', procesados: 0 }

  try {
    const stamp = await getTenantStamp(supabase)
    if (!isValidStamp(stamp)) {
      console.log('[procesarTrasladosMultiples] Stamp invalido:', stamp)
      return { success: false, error: SESION_INVALIDA_ERROR, procesados: 0 }
    }

    const refIdBase = Date.now()
    const insertData: {
      producto_id: number
      almacen_id: number
      localizacion_id: number
      tipo_movimiento: string
      cantidad: number
      costo_o_precio_unitario: number
      referencia_id: number
      fecha: string
      razon_social_id: number | null
      usuario: string | null
    }[] = []
    
    lineas.forEach((linea, index) => {
      const refId = refIdBase + index
      
      // Salida del origen
      insertData.push({
        producto_id: linea.producto_id,
        almacen_id: origen_almacen_id,
        localizacion_id: origen_localizacion_id,
        tipo_movimiento: 'Traslado Salida',
        cantidad: -linea.cantidad,
        costo_o_precio_unitario: linea.costo_unitario,
        referencia_id: refId,
        fecha: getHondurasNowISO(), // dia de negocio HN (kardex usa split)
        ...stamp
      })

      // Entrada al destino
      insertData.push({
        producto_id: linea.producto_id,
        almacen_id: destino_almacen_id,
        localizacion_id: destino_localizacion_id,
        tipo_movimiento: 'Traslado Entrada',
        cantidad: linea.cantidad,
        costo_o_precio_unitario: linea.costo_unitario,
        referencia_id: refId,
        fecha: getHondurasNowISO(), // dia de negocio HN (kardex usa split)
        ...stamp
      })
    })
    
    const { error } = await supabase
      .from('transacciones_inventario')
      .insert(insertData)

    if (error) return { success: false, error: error.message, procesados: 0 }

    return { success: true, error: null, procesados: lineas.length }
  } catch (err) {
    console.error('[Supabase] Error procesando traslados multiples:', err)
    return { success: false, error: 'Error de conexion', procesados: 0 }
  }
}

// ==================== AJUSTES DE INVENTARIO ====================

/**
 * Una linea de ajuste de inventario: el stock actual del sistema en una
 * localizacion y la cantidad real contada. El sistema genera el movimiento
 * de entrada/salida para cuadrar.
 */
export interface AjusteLineaInput {
  producto_id: number
  almacen_id: number
  localizacion_id: number
  /** stock que el sistema tiene hoy en esa localizacion */
  stock_actual: number
  /** cantidad real contada fisicamente */
  stock_real: number
  /** costo promedio actual del producto (se congela en el movimiento) */
  costo_unitario: number
  producto_nombre?: string
}

/** Linea de ajuste que efectivamente cambia (delta != 0). */
export interface AjusteLineaCalculada extends AjusteLineaInput {
  /** stock_real - stock_actual: positivo = entrada, negativo = salida */
  delta: number
}

/** Marca la ausencia de la tabla de bitacora (script 023 no aplicado). */
export const AJUSTES_FEATURE_PENDING =
  'Bitacora de ajustes pendiente: aplica scripts/023-ajustes-inventario.sql'

/**
 * Helper PURO: de las lineas dadas, devuelve solo las que cambian (delta != 0)
 * con su delta calculado. No toca la base — facil de testear.
 */
export function calcularLineasAjuste(lineas: AjusteLineaInput[]): AjusteLineaCalculada[] {
  return lineas
    .map((l) => ({ ...l, delta: +(l.stock_real - l.stock_actual).toFixed(2) }))
    .filter((l) => l.delta !== 0)
}

/**
 * Procesa un ajuste de inventario: por cada linea con diferencia genera un
 * movimiento 'Ajuste' en el kardex (entrada o salida) usando el costo
 * promedio ACTUAL (no altera el costo), y mueve el stock global con
 * `ajustarStock` (que solo toca stock_total, nunca el costo).
 *
 * La bitacora en `ajustes_inventario` (motivo/antes/despues) es best-effort:
 * si la tabla no existe todavia, el ajuste igual se aplica.
 */
export async function procesarAjusteInventario(
  lineas: AjusteLineaInput[],
  motivo?: string
): Promise<{ success: boolean; procesados: number; error: string | null }> {
  const cambios = calcularLineasAjuste(lineas)
  if (cambios.length === 0) {
    return { success: false, procesados: 0, error: 'No hay diferencias que ajustar' }
  }

  if (!isSupabaseConfigured()) {
    return { success: false, procesados: 0, error: 'Supabase no configurado' }
  }
  const supabase = createClient()
  if (!supabase) return { success: false, procesados: 0, error: 'Cliente no disponible' }

  const stamp = await getTenantStamp(supabase)
  if (!isValidStamp(stamp)) {
    return { success: false, procesados: 0, error: SESION_INVALIDA_ERROR }
  }

  let procesados = 0
  for (const l of cambios) {
    // 1) Movimiento de kardex 'Ajuste' con el costo actual congelado.
    const { error: movErr } = await supabase.from('transacciones_inventario').insert({
      producto_id: l.producto_id,
      almacen_id: l.almacen_id,
      localizacion_id: l.localizacion_id,
      tipo_movimiento: 'Ajuste',
      cantidad: l.delta, // con signo: + entrada, - salida
      costo_o_precio_unitario: l.costo_unitario,
      fecha: getHondurasNowISO(), // dia de negocio HN (kardex usa split)
      ...stamp,
    })
    if (movErr) {
      return {
        success: false,
        procesados,
        error: `Error al registrar el ajuste de un producto: ${movErr.message}`,
      }
    }

    // 2) Stock global (solo cantidad, NO costo).
    const res = await ajustarStock(supabase, l.producto_id, l.delta, stamp.razon_social_id)
    if (res.error) {
      return { success: false, procesados, error: res.error }
    }

    // 3) Bitacora de auditoria (best-effort; ignora si la tabla no existe).
    await supabase.from('ajustes_inventario').insert({
      producto_id: l.producto_id,
      almacen_id: l.almacen_id,
      localizacion_id: l.localizacion_id,
      stock_anterior: l.stock_actual,
      stock_real: l.stock_real,
      delta: l.delta,
      costo_unitario: l.costo_unitario,
      motivo: motivo || null,
      ...stamp,
    })

    procesados++
  }

  return { success: true, procesados, error: null }
}
