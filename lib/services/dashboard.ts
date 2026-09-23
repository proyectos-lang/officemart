import { createClient, isSupabaseConfigured } from '@/lib/supabase/client'
import { getHondurasTodayISODate } from '@/lib/utils/honduras-time'
import { ejecutarVigentes } from '@/lib/services/ventas-filtros'

// ==================== INTERFACES ====================

export interface DashboardMetrics {
  valorInventario: number
  cuentasPorCobrar: number
  utilidadBruta: number
  ventasMes: number
  ventasMesCount: number
}

export interface VentasVsCobros {
  fecha: string
  ventas: number
  cobros: number
}

export interface TopProducto {
  producto_id: number
  producto_nombre: string
  cantidad_vendida: number
}

export interface ProductoStockBajo {
  id: number
  nombre: string
  codigo_barras: string
  stock_total: number
}

export interface CompraPendiente {
  id: number
  proveedor_nombre: string
  fecha_tentativa: string
  total_compra_local: number
  estado: string
}

export interface ClienteDeudor {
  cliente_id: number
  cliente_nombre: string
  total_deuda: number
  facturas_pendientes: number
}

const DEFAULT_METRICS: DashboardMetrics = {
  valorInventario: 0,
  cuentasPorCobrar: 0,
  utilidadBruta: 0,
  ventasMes: 0,
  ventasMesCount: 0,
}

// ==================== DASHBOARD DATA ====================

export async function getDashboardMetrics(
  razonSocialId: number | null
): Promise<{ data: DashboardMetrics; error: string | null }> {
  if (!isSupabaseConfigured()) {
    return { data: DEFAULT_METRICS, error: null }
  }

  const supabase = createClient()
  if (!supabase) return { data: DEFAULT_METRICS, error: 'Cliente no disponible' }

  if (razonSocialId == null) {
    console.log('[Dashboard] getDashboardMetrics: razonSocialId es null, devolviendo ceros')
    return { data: DEFAULT_METRICS, error: null }
  }

  try {
    // Primer dia del mes en curso (Honduras), codificado como UTC para casar con
    // las columnas de dia-de-negocio HN-as-UTC (fecha_venta, etc.).
    const firstDayOfMonth = `${getHondurasTodayISODate().slice(0, 7)}-01T00:00:00.000Z`

    // Ventas Mes: total facturado del mes actual (solo ventas vigentes).
    let ventasMesRes: any = await ejecutarVigentes<any>((filtrar) => {
      let q = supabase
        .from('ventas_encabezado')
        .select('total_venta')
        .eq('razon_social_id', razonSocialId)
        .gte('fecha_venta', firstDayOfMonth)
      if (filtrar) q = q.is('anulada_at', null)
      return q
    })

    // Por Cobrar (cartera): saldo pendiente de TODAS las ventas, sin filtrar
    // por mes. Una venta de un mes anterior con saldo abierto sigue siendo
    // dinero por cobrar hoy. Si la columna `valorpago` no existe, hacemos
    // fallback historico (no se puede inferir el saldo y queda en 0).
    let carteraRes: any = await ejecutarVigentes<any>((filtrar) => {
      let q = supabase
        .from('ventas_encabezado')
        .select('total_venta, valorpago')
        .eq('razon_social_id', razonSocialId)
      if (filtrar) q = q.is('anulada_at', null)
      return q
    })

    let tieneValorpago = true
    if (carteraRes.error && /valorpago/i.test(carteraRes.error.message || '')) {
      tieneValorpago = false
    }

    const [productosRes, detallesRes] = await Promise.all([
      supabase
        .from('productos')
        .select('stock_total, costo_promedio')
        .eq('razon_social_id', razonSocialId),
      ejecutarVigentes<any>((filtrar) => {
        let q = supabase
          .from('ventas_detalle')
          .select('utilidad_linea, ventas_encabezado!inner(razon_social_id)')
          .eq('ventas_encabezado.razon_social_id', razonSocialId)
        if (filtrar) q = q.is('ventas_encabezado.anulada_at', null)
        return q
      }),
    ])

    // Log errores de cada consulta para debug
    if (productosRes.error) console.log('[Dashboard] productos error:', productosRes.error)
    if (detallesRes.error) console.log('[Dashboard] detalles error:', detallesRes.error)
    if (ventasMesRes.error) console.log('[Dashboard] ventasMes error:', ventasMesRes.error)
    if (carteraRes.error) console.log('[Dashboard] cartera error:', carteraRes.error)

    const valorInventario = (productosRes.data || []).reduce(
      (acc, p: any) => acc + ((p.stock_total || 0) * (p.costo_promedio || 0)),
      0
    )

    const utilidadBruta = (detallesRes.data || []).reduce(
      (acc: number, d: any) => acc + (d.utilidad_linea || 0),
      0
    )

    const ventasMes = (ventasMesRes.data || []).reduce(
      (acc: number, v: any) => acc + (v.total_venta || 0),
      0
    )
    const ventasMesCount = (ventasMesRes.data || []).length

    // Por Cobrar = suma de (total_venta - valorpago) por cada venta con saldo.
    // valorpago es el total abonado acumulado; el saldo nunca es negativo.
    const cuentasPorCobrar = tieneValorpago
      ? (carteraRes.data || []).reduce(
          (acc: number, v: any) => acc + Math.max(0, (v.total_venta || 0) - (v.valorpago || 0)),
          0
        )
      : 0

    return {
      data: { valorInventario, cuentasPorCobrar, utilidadBruta, ventasMes, ventasMesCount },
      error: null,
    }
  } catch (err: any) {
    console.log('[Dashboard] Excepcion en getDashboardMetrics:', err)
    return { data: DEFAULT_METRICS, error: err?.message || 'Error de conexion' }
  }
}

export async function getVentasVsCobros(
  razonSocialId: number | null,
  dias: number = 7
): Promise<{ data: VentasVsCobros[]; error: string | null }> {
  // Eje de dias en horario de Honduras (codificado como UTC para casar con las
  // columnas de dia-de-negocio HN-as-UTC). Evita que "hoy" caiga fuera del eje
  // por la noche (cuando toISOString() ya reporta el dia UTC siguiente).
  const baseUtcMs = new Date(`${getHondurasTodayISODate()}T00:00:00.000Z`).getTime()
  const result: VentasVsCobros[] = []
  for (let i = dias - 1; i >= 0; i--) {
    const fecha = new Date(baseUtcMs - i * 86400000).toISOString().slice(0, 10)
    result.push({ fecha, ventas: 0, cobros: 0 })
  }

  if (!isSupabaseConfigured()) return { data: result, error: null }

  const supabase = createClient()
  if (!supabase) return { data: result, error: 'Cliente no disponible' }
  if (razonSocialId == null) return { data: result, error: null }

  try {
    const startDate = new Date(baseUtcMs - (dias - 1) * 86400000).toISOString()

    const [ventasRes, pagosRes] = await Promise.all([
      ejecutarVigentes<any>((filtrar) => {
        let q = supabase
          .from('ventas_encabezado')
          .select('total_venta, fecha_venta')
          .eq('razon_social_id', razonSocialId)
          .gte('fecha_venta', startDate)
        if (filtrar) q = q.is('anulada_at', null)
        return q
      }),
      ejecutarVigentes<any>((filtrar) => {
        let q = supabase
          .from('pagos_ventas')
          .select('monto, fecha_pago, ventas_encabezado!inner(razon_social_id)')
          .eq('ventas_encabezado.razon_social_id', razonSocialId)
          .gte('fecha_pago', startDate)
        if (filtrar) q = q.is('ventas_encabezado.anulada_at', null)
        return q
      }),
    ])

    if (ventasRes.error) console.log('[Dashboard] ventasVsCobros ventas error:', ventasRes.error)
    if (pagosRes.error) console.log('[Dashboard] ventasVsCobros pagos error:', pagosRes.error)

    ;(ventasRes.data || []).forEach((v: any) => {
      if (!v.fecha_venta) return
      const fecha = v.fecha_venta.split('T')[0]
      const item = result.find(r => r.fecha === fecha)
      if (item) item.ventas += v.total_venta || 0
    })

    ;(pagosRes.data || []).forEach((p: any) => {
      if (!p.fecha_pago) return
      const fecha = p.fecha_pago.split('T')[0]
      const item = result.find(r => r.fecha === fecha)
      if (item) item.cobros += p.monto || 0
    })

    return { data: result, error: null }
  } catch (err: any) {
    console.log('[Dashboard] Excepcion en getVentasVsCobros:', err)
    return { data: result, error: err?.message || 'Error de conexion' }
  }
}

export async function getTopProductos(
  razonSocialId: number | null,
  limit: number = 5
): Promise<{ data: TopProducto[]; error: string | null }> {
  if (!isSupabaseConfigured()) return { data: [], error: null }

  const supabase = createClient()
  if (!supabase) return { data: [], error: 'Cliente no disponible' }
  if (razonSocialId == null) return { data: [], error: null }

  try {
    const { data, error } = await ejecutarVigentes<any>((filtrar) => {
      let q = supabase
        .from('ventas_detalle')
        .select('producto_id, cantidad, productos(nombre), ventas_encabezado!inner(razon_social_id)')
        .eq('ventas_encabezado.razon_social_id', razonSocialId)
      if (filtrar) q = q.is('ventas_encabezado.anulada_at', null)
      return q
    })

    if (error) {
      console.log('[Dashboard] getTopProductos error:', error)
      return { data: [], error: error.message || 'Error' }
    }

    const aggregated: Record<number, { nombre: string; cantidad: number }> = {}
    ;(data || []).forEach((d: any) => {
      if (!aggregated[d.producto_id]) {
        aggregated[d.producto_id] = {
          nombre: d.productos?.nombre || 'Desconocido',
          cantidad: 0,
        }
      }
      aggregated[d.producto_id].cantidad += d.cantidad || 0
    })

    const sorted = Object.entries(aggregated)
      .map(([id, info]) => ({
        producto_id: parseInt(id),
        producto_nombre: info.nombre,
        cantidad_vendida: info.cantidad,
      }))
      .sort((a, b) => b.cantidad_vendida - a.cantidad_vendida)
      .slice(0, limit)

    return { data: sorted, error: null }
  } catch (err: any) {
    console.log('[Dashboard] Excepcion en getTopProductos:', err)
    return { data: [], error: err?.message || 'Error de conexion' }
  }
}

export async function getProductosStockBajo(
  razonSocialId: number | null,
  umbral: number = 5
): Promise<{ data: ProductoStockBajo[]; error: string | null }> {
  if (!isSupabaseConfigured()) return { data: [], error: null }

  const supabase = createClient()
  if (!supabase) return { data: [], error: 'Cliente no disponible' }
  if (razonSocialId == null) return { data: [], error: null }

  try {
    // Mínimos por producto (officemart-009): un producto con mínimo propio
    // aparece si stock <= su mínimo; los demás usan el umbral general.
    const minimos = new Map<number, number>()
    try {
      const { data: reord } = await supabase.from('productos_reorden').select('producto_id, stock_minimo').is('almacen_id', null)
      for (const r of (reord || []) as { producto_id: number; stock_minimo: number }[]) {
        if (Number(r.stock_minimo) > 0) minimos.set(Number(r.producto_id), Number(r.stock_minimo))
      }
    } catch {
      /* tabla ausente: solo umbral */
    }
    const maxMin = Math.max(umbral, ...minimos.values())

    const { data, error } = await supabase
      .from('productos')
      .select('id, nombre, codigo_barras, stock_total')
      .eq('razon_social_id', razonSocialId)
      .lte('stock_total', maxMin)
      .order('stock_total', { ascending: true })

    if (error) {
      console.log('[Dashboard] getProductosStockBajo error:', error)
      return { data: [], error: error.message }
    }
    const filtrados = (data || []).filter((p: { id: number; stock_total: number | null }) => {
      const min = minimos.get(p.id)
      const stock = Number(p.stock_total || 0)
      return min != null ? stock <= min : stock < umbral
    })
    return { data: filtrados, error: null }
  } catch (err: any) {
    console.log('[Dashboard] Excepcion en getProductosStockBajo:', err)
    return { data: [], error: err?.message || 'Error de conexion' }
  }
}

export async function getComprasPendientes(
  razonSocialId: number | null
): Promise<{ data: CompraPendiente[]; error: string | null }> {
  if (!isSupabaseConfigured()) return { data: [], error: null }

  const supabase = createClient()
  if (!supabase) return { data: [], error: 'Cliente no disponible' }
  if (razonSocialId == null) return { data: [], error: null }

  try {
    const { data, error } = await supabase
      .from('compras_encabezado')
      .select('id, fecha_tentativa, total_compra_local, estado, proveedores(nombre)')
      .eq('razon_social_id', razonSocialId)
      .eq('estado', 'Pendiente')
      .order('fecha_tentativa', { ascending: true })

    if (error) {
      console.log('[Dashboard] getComprasPendientes error:', error)
      return { data: [], error: error.message }
    }

    const formatted: CompraPendiente[] = (data || []).map((c: any) => ({
      id: c.id,
      proveedor_nombre: c.proveedores?.nombre || 'Desconocido',
      fecha_tentativa: c.fecha_tentativa,
      total_compra_local: c.total_compra_local || 0,
      estado: c.estado,
    }))

    return { data: formatted, error: null }
  } catch (err: any) {
    console.log('[Dashboard] Excepcion en getComprasPendientes:', err)
    return { data: [], error: err?.message || 'Error de conexion' }
  }
}

export async function getTopClientesDeudores(
  razonSocialId: number | null,
  limit: number = 5
): Promise<{ data: ClienteDeudor[]; error: string | null }> {
  if (!isSupabaseConfigured()) return { data: [], error: null }

  const supabase = createClient()
  if (!supabase) return { data: [], error: 'Cliente no disponible' }
  if (razonSocialId == null) return { data: [], error: null }

  try {
    const { data: ventasData, error: ventasError } = await ejecutarVigentes<any>((filtrar) => {
      let q = supabase
        .from('ventas_encabezado')
        .select('id, cliente_id, total_venta, clientes(nombre)')
        .eq('razon_social_id', razonSocialId)
        .neq('estado_pago', 'Pagado')
      if (filtrar) q = q.is('anulada_at', null)
      return q
    })

    if (ventasError) {
      console.log('[Dashboard] getTopClientesDeudores ventas error:', ventasError)
      return { data: [], error: ventasError.message || 'Error' }
    }

    const ventaIds = (ventasData || []).map((v: any) => v.id)
    let pagosMap: Record<number, number> = {}

    if (ventaIds.length > 0) {
      const { data: pagosData, error: pagosError } = await supabase
        .from('pagos_ventas')
        .select('venta_id, monto')
        .in('venta_id', ventaIds)

      if (pagosError) console.log('[Dashboard] getTopClientesDeudores pagos error:', pagosError)

      pagosMap = (pagosData || []).reduce((acc: Record<number, number>, p: any) => {
        acc[p.venta_id] = (acc[p.venta_id] || 0) + p.monto
        return acc
      }, {})
    }

    const deudaCliente: Record<number, { nombre: string; deuda: number; facturas: number }> = {}

    ;(ventasData || []).forEach((v: any) => {
      const pagado = pagosMap[v.id] || 0
      const saldo = v.total_venta - pagado
      if (saldo > 0) {
        if (!deudaCliente[v.cliente_id]) {
          deudaCliente[v.cliente_id] = {
            nombre: v.clientes?.nombre || 'Desconocido',
            deuda: 0,
            facturas: 0,
          }
        }
        deudaCliente[v.cliente_id].deuda += saldo
        deudaCliente[v.cliente_id].facturas += 1
      }
    })

    const sorted = Object.entries(deudaCliente)
      .map(([id, info]) => ({
        cliente_id: parseInt(id),
        cliente_nombre: info.nombre,
        total_deuda: info.deuda,
        facturas_pendientes: info.facturas,
      }))
      .sort((a, b) => b.total_deuda - a.total_deuda)
      .slice(0, limit)

    return { data: sorted, error: null }
  } catch (err: any) {
    console.log('[Dashboard] Excepcion en getTopClientesDeudores:', err)
    return { data: [], error: err?.message || 'Error de conexion' }
  }
}
