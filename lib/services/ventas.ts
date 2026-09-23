import { createClient, isSupabaseConfigured } from '@/lib/supabase/client'
import { getTenantStamp, isValidStamp, SESION_INVALIDA_ERROR } from '@/lib/services/tenant-stamp'
import { registrarMovimientoCaja, getSesionAbierta } from '@/lib/services/caja-chica'
import { registrarMovimientoCuenta, recalcCadenaSaldoCuenta } from '@/lib/services/cuentas'
import { ajustarStock } from '@/lib/services/stock'
import { getHondurasNowISO } from '@/lib/utils/honduras-time'
import { revertirDevolucionesDeVenta } from '@/lib/services/devoluciones'
import { emitirCorrelativoCai } from '@/lib/services/facturacion-cai'
import { emitirCorrelativo, peekCorrelativo } from '@/lib/services/correlativos'
import { construirFiscalSnapshot, serieVentaDePunto, type PuntoFacturacion } from '@/lib/services/puntos-facturacion'
import { ejecutarVigentes, esVentaVigente, filtrarVigentesActivo } from '@/lib/services/ventas-filtros'
import { registrarReciboCobro, RECIBOS_FEATURE_PENDING } from '@/lib/services/recibos'
import { registrarAuditoria } from '@/lib/services/auditoria'

/**
 * True SOLO si el error es "la relacion/tabla no existe" (migracion pendiente):
 * Postgres 42P01 o PostgREST PGRST205/"could not find the table"/"schema cache".
 * NO matchea por el nombre de la tabla suelto, para no tragar errores REALES
 * (violacion de RLS, constraint, FK) como si la tabla faltara — esos deben
 * surgir para no perder el desglose de pago en silencio.
 */
function esTablaInexistente(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false
  if (err.code === '42P01' || err.code === 'PGRST205') return true
  return /relation .* does not exist|could not find the table|schema cache/i.test(err.message || '')
}

/**
 * PostgREST corta cada `.select()` en 1000 filas. Este helper pagina con
 * `.range()` en bloques de 1000 hasta traerlas TODAS, para poder mostrar mas
 * de 1000 lineas. `buildQuery()` debe reconstruir la consulta base (sin range).
 */
type RangeableQuery = {
  range: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>
}
async function fetchAllRows<T>(buildQuery: () => RangeableQuery): Promise<{ data: T[]; error: string | null }> {
  const PAGE = 1000
  let from = 0
  const acc: T[] = []
  // Tope de seguridad para no ciclar indefinidamente (100k filas).
  for (let guard = 0; guard < 100; guard++) {
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

export interface VentaEncabezado {
  id?: number
  numero_factura: string
  cliente_id: number
  cliente_nombre?: string  // joined from clientes table
  almacen_id?: number  // warehouse for this sale
  almacen_nombre?: string  // joined from almacenes table
  fecha_venta?: string  // timestamp, defaults to now()
  aplica_impuesto: boolean  // default false
  porcentaje_impuesto: number  // default 15
  descuento?: number  // porcentaje de descuento 0-100 aplicado al subtotal
  subtotal: number  // default 0 (bruto, antes de descuento)
  impuesto_total: number  // default 0 (calculado sobre subtotal - descuento)
  total_venta: number  // default 0 (subtotal - descuento + impuesto)
  estado_pago: 'Pendiente' | 'Parcial' | 'Pagado'  // default 'Pendiente'
  /**
   * Total pagado acumulado de la venta. Al crear la venta se inicializa
   * segun el Tipo de Pago (Contado/Parcial/Credito) y se incrementa cada
   * vez que se registra un abono en `pagos_ventas`.
   * saldo_pendiente = total_venta - valorpago
   */
  valorpago?: number
  /**
   * Número fiscal CAI (SAR Honduras) 'ESTAB-PUNTO-TIPO-NNNNNNNN', si la empresa
   * tiene Facturación CAI activa. NULL en ventas sin CAI (script 062). El
   * correlativo interno sigue en `numero_factura` (FC-####).
   */
  numero_fiscal?: string | null
  /** CAI vigente al emitir la factura (snapshot). NULL si no hay CAI. */
  cai_emitido?: string | null
  /** Tipo de documento fiscal emitido: '01' Factura, '06' NC, '07' ND. */
  tipo_documento_fiscal?: string | null
  /**
   * Vendedor asociado a la venta (tabla `vendedores`, script officemart-002).
   * NULL si la empresa no usa vendedores. Alimenta comisiones y reportes.
   */
  vendedor_id?: number | null
  /**
   * Anulación (script officemart-003). NULL = venta vigente. Una venta anulada
   * conserva sus filas y asientos; la anulación registró contra-asientos.
   */
  anulada_at?: string | null
  anulada_por?: string | null
  motivo_anulacion?: string | null
  /** 'Anulacion' | 'Reclamo' */
  anulacion_tipo?: string | null
  reclamo_id?: number | null
  /**
   * Punto de facturación (script officemart-004). NULL = empresa sin puntos.
   * `localizacion_id` es la localización real desde la que salió el stock y
   * `fiscal_snapshot` la foto de la autorización CAI usada (para reimprimir).
   */
  punto_facturacion_id?: number | null
  localizacion_id?: number | null
  fiscal_snapshot?: Record<string, unknown> | null
}

export interface VentaDetalle {
  id?: number
  venta_id: number
  /**
   * Producto del catalogo. NULL en lineas de "Venta Rapida" (producto/servicio
   * no catalogado escrito a mano): esas NO afectan inventario y su texto vive en
   * `descripcion_libre` / tabla `ventas_detalle_descripcion` (script 045).
   */
  producto_id: number | null
  producto_nombre?: string  // joined from productos table (not stored)
  producto_codigo?: string  // joined from productos table (not stored)
  /** Descripcion escrita a mano (solo lineas de Venta Rapida, producto_id NULL). */
  descripcion_libre?: string | null
  cantidad: number
  precio_unitario: number
  costo_promedio_momento: number
  utilidad_linea: number
}

export interface PagoVenta {
  id?: number
  venta_id: number
  fecha_pago?: string  // timestamp with time zone, defaults to now()
  monto: number
  metodo_pago: string  // text field
}

/**
 * Una linea del Desglose de Pago en Nueva Venta. Multiples lineas pueden
 * convivir en la misma venta (ej: 500 efectivo + 1000 BAC). La suma de
 * `monto_bruto` define `valorpago` y `estado_pago` de la venta.
 *
 *  - `metodo_pago`: tipo de pago.
 *  - `cuenta_id`: solo para Banco / Link_Pago (referencia a `cuentas_config`).
 *  - `monto_bruto`: lo que paga el cliente.
 *  - `porcentaje_comision`: snapshot de la comision al momento de la venta
 *    (independiente de cambios futuros en cuentas_config).
 *  - `monto_neto`: monto_bruto * (1 - comision/100). Es lo que efectivamente
 *    ingresa al banco; se usa para conciliacion.
 */
export interface PagoVentaDetalleInput {
  metodo_pago: 'Efectivo' | 'Banco' | 'Link_Pago' | 'Credito' | 'Otro'
  cuenta_id?: number | null
  monto_bruto: number
  porcentaje_comision?: number
  monto_neto?: number
}

export interface PagoVentaDetalle extends PagoVentaDetalleInput {
  id?: number
  venta_id: number
  porcentaje_comision: number
  monto_neto: number
}

// ==================== CORRELATIVO ====================

/**
 * Numero que se emitiria a continuacion, SOLO para PREVIEW en pantalla (no
 * consume correlativo). El numero definitivo lo asigna `emitirCorrelativoVenta`
 * de forma atomica al guardar la venta, asi que este valor es indicativo y
 * puede cambiar si otra venta se guarda antes.
 *
 * Usa el RPC `peek_correlativo_venta` (contador global, script 052). Si el RPC
 * aun no esta desplegado, cae al legacy COUNT(*)+1 (que tiene condicion de
 * carrera, pero es solo el preview).
 */
export async function getNextCorrelativo(
  punto?: Pick<PuntoFacturacion, 'id' | 'serie_prefijo'> | null
): Promise<string> {
  if (!isSupabaseConfigured()) {
    const saved = localStorage.getItem('ventas_encabezado')
    const ventas: VentaEncabezado[] = saved ? JSON.parse(saved) : []
    const count = ventas.length + 1
    return `FC-${count.toString().padStart(4, '0')}`
  }

  const supabase = createClient()
  if (!supabase) return 'FC-0001'

  try {
    // Punto con serie interna propia (script officemart-004): vista previa de
    // SU serie. Si el RPC de correlativos no existe, cae a la serie global.
    const seriePunto = serieVentaDePunto(punto)
    if (seriePunto) {
      const { numero } = await peekCorrelativo(supabase, seriePunto.serie, seriePunto.prefijo, 4)
      if (numero) return numero
    }
    const { data, error } = await supabase.rpc('peek_correlativo_venta')
    if (!error && typeof data === 'string' && data) return data
    // Fallback legacy (script 052 no aplicado): COUNT(*)+1.
    const { count, error: cErr } = await supabase
      .from('ventas_encabezado')
      .select('*', { count: 'exact', head: true })
    if (cErr) return 'FC-0001'
    const nextNum = (count || 0) + 1
    return `FC-${nextNum.toString().padStart(4, '0')}`
  } catch {
    return 'FC-0001'
  }
}

/**
 * Emite (CONSUME) el siguiente correlativo de venta de forma ATOMICA via el
 * RPC `siguiente_correlativo_venta` (script 052). Es la fuente de verdad del
 * numero de factura: se llama server-side al momento de crear la venta, NO en
 * el navegador, para eliminar la condicion de carrera que producia numeros
 * duplicados.
 *
 * Devuelve `null` si el RPC no esta disponible (script 052 no aplicado), para
 * que el llamador pueda degradar al numero calculado en el cliente.
 */
async function emitirCorrelativoVenta(
  supabase: NonNullable<ReturnType<typeof createClient>>
): Promise<string | null> {
  try {
    const { data, error } = await supabase.rpc('siguiente_correlativo_venta')
    if (error) {
      console.warn(
        '[emitirCorrelativoVenta] RPC no disponible; usando numero del cliente. ' +
          'Aplica scripts/052-correlativo-venta-atomico.sql para numeracion atomica.',
        error.message
      )
      return null
    }
    return typeof data === 'string' && data ? data : null
  } catch (e) {
    console.warn('[emitirCorrelativoVenta] excepcion:', e)
    return null
  }
}

// ==================== VENTAS ====================

/**
 * Lista de ventas con paginacion opcional. Sin opciones devuelve TODO
 * (compatibilidad con llamadores existentes); con `limit`/`offset` devuelve
 * la pagina pedida junto con `total` (conteo exacto) para saber si hay mas.
 */
export async function getVentas(
  opts: { limit?: number; offset?: number; soloVigentes?: boolean } = {}
): Promise<{ data: VentaEncabezado[]; total: number; error: string | null }> {
  if (!isSupabaseConfigured()) {
    const saved = localStorage.getItem('ventas_encabezado')
    let todas: VentaEncabezado[] = saved ? JSON.parse(saved) : []
    if (opts.soloVigentes) todas = todas.filter(esVentaVigente)
    return { data: todas, total: todas.length, error: null }
  }

  const supabase = createClient()
  if (!supabase) return { data: [], total: 0, error: 'Cliente no disponible' }

  type EncabezadoRow = VentaEncabezado & {
    clientes?: { nombre?: string } | null
    almacenes?: { nombre?: string } | null
  }
  const mapRow = (v: EncabezadoRow): VentaEncabezado => ({
    ...v,
    cliente_nombre: v.clientes?.nombre || '',
    almacen_nombre: v.almacenes?.nombre || '',
  })

  try {
    // Con `limit`: una sola pagina (con count exacto). Sin `limit`: TODAS las
    // filas via bucle por rangos (para superar el tope de 1000 de PostgREST).
    if (opts.limit != null) {
      const desde = opts.offset ?? 0
      const { data, count, error } = await ejecutarVigentes<EncabezadoRow[] | null>((filtrar) => {
        let q = supabase
          .from('ventas_encabezado')
          .select(`*, clientes (nombre), almacenes (nombre)`, { count: 'exact' })
        if (filtrar && opts.soloVigentes) q = q.is('anulada_at', null)
        return q.order('id', { ascending: false }).range(desde, desde + opts.limit! - 1)
      }) as { data: EncabezadoRow[] | null; count?: number | null; error: { message?: string } | null }
      if (error) return { data: [], total: 0, error: error.message || 'Error' }
      const formattedData = ((data || []) as EncabezadoRow[]).map(mapRow)
      return { data: formattedData, total: count ?? formattedData.length, error: null }
    }

    let { data, error } = await fetchAllRows<EncabezadoRow>(() => {
      let q = supabase
        .from('ventas_encabezado')
        .select(`*, clientes (nombre), almacenes (nombre)`)
      if (opts.soloVigentes) q = q.is('anulada_at', null)
      return q.order('id', { ascending: false })
    })
    // Columna anulada_at ausente (script officemart-003 pendiente): sin filtro.
    if (error && opts.soloVigentes && /anulada_at/i.test(error)) {
      const retry = await fetchAllRows<EncabezadoRow>(() =>
        supabase
          .from('ventas_encabezado')
          .select(`*, clientes (nombre), almacenes (nombre)`)
          .order('id', { ascending: false })
      )
      data = retry.data
      error = retry.error
    }
    if (error) return { data: [], total: 0, error }
    const formattedData = data.map(mapRow)
    return { data: formattedData, total: formattedData.length, error: null }
  } catch (err) {
    console.error('[Supabase] Error obteniendo ventas:', err)
    return { data: [], total: 0, error: 'Error de conexion' }
  }
}

/**
 * Totales agregados del listado de facturas sobre TODAS las ventas que cumplen
 * los filtros (no solo la pagina cargada), para el encabezado del Historial.
 *
 * `totalVentas` se calcula desde las LINEAS (`ventas_detalle`) con la MISMA
 * formula del "Detalle por Producto" (cantidad * precio * (1-descuento%) *
 * (1+ISV%) = total BRUTO facturado), de modo que ambas pestanas dan
 * EXACTAMENTE lo mismo. `totalSaldo` se calcula desde el encabezado
 * (total_venta - valorpago, ambos brutos tras el script 027).
 */
export async function getVentasResumenTotales(filtros: {
  fechaInicio?: string
  fechaFin?: string
  clienteId?: number | null
  almacenId?: number | null
  estadoPago?: string | null
} = {}): Promise<{ totalVentas: number; totalSaldo: number; totalComisiones: number; count: number; error: string | null }> {
  if (!isSupabaseConfigured()) {
    const saved = localStorage.getItem('ventas_encabezado')
    const todas: VentaEncabezado[] = saved ? JSON.parse(saved) : []
    const totalVentas = todas.reduce((a, v) => a + (v.total_venta ?? 0), 0)
    const totalSaldo = todas.reduce((a, v) => a + Math.max(0, (v.total_venta ?? 0) - (v.valorpago ?? 0)), 0)
    return { totalVentas, totalSaldo, totalComisiones: 0, count: todas.length, error: null }
  }

  const supabase = createClient()
  if (!supabase) return { totalVentas: 0, totalSaldo: 0, totalComisiones: 0, count: 0, error: 'Cliente no disponible' }

  try {
    // --- Total BRUTO desde las lineas (join !inner al encabezado para filtrar
    //     por los mismos criterios del Resumen). Misma formula que total_linea
    //     de getDetalleAnalitico -> cuadra exacto con el Detalle por Producto.
    const { data: lineas, error: errLineas } = await ejecutarVigentes<unknown[] | null>((filtrar) => {
      let qLineas = supabase
        .from('ventas_detalle')
        .select(
          'cantidad, precio_unitario, ventas_encabezado!inner(descuento, aplica_impuesto, porcentaje_impuesto, cliente_id, almacen_id, estado_pago, fecha_venta)'
        )
      if (filtrar) qLineas = qLineas.is('ventas_encabezado.anulada_at', null)
      if (filtros.fechaInicio) qLineas = qLineas.gte('ventas_encabezado.fecha_venta', `${filtros.fechaInicio}T00:00:00`)
      if (filtros.fechaFin) qLineas = qLineas.lte('ventas_encabezado.fecha_venta', `${filtros.fechaFin}T23:59:59`)
      if (filtros.clienteId != null) qLineas = qLineas.eq('ventas_encabezado.cliente_id', filtros.clienteId)
      if (filtros.almacenId != null) qLineas = qLineas.eq('ventas_encabezado.almacen_id', filtros.almacenId)
      if (filtros.estadoPago) qLineas = qLineas.eq('ventas_encabezado.estado_pago', filtros.estadoPago)
      return qLineas
    }) as { data: any[] | null; error: { message?: string } | null }
    if (errLineas) return { totalVentas: 0, totalSaldo: 0, totalComisiones: 0, count: 0, error: errLineas.message || 'Error' }

    const totalVentas = +(lineas || [])
      .reduce((acc, d) => {
        const ve = (Array.isArray(d.ventas_encabezado) ? d.ventas_encabezado[0] : d.ventas_encabezado) as {
          descuento?: number; aplica_impuesto?: boolean; porcentaje_impuesto?: number
        } | null
        const desc = Number(ve?.descuento || 0)
        const isv = ve?.aplica_impuesto ? Number(ve?.porcentaje_impuesto || 0) : 0
        return acc + Number(d.cantidad || 0) * Number(d.precio_unitario || 0) * (1 - desc / 100) * (1 + isv / 100)
      }, 0)
      .toFixed(2)

    // --- Saldo pendiente desde el encabezado (invoice-level).
    const { data: encs, error: errEnc } = await ejecutarVigentes<{ total_venta: number; valorpago: number }[] | null>((filtrar) => {
      let qEnc = supabase.from('ventas_encabezado').select('total_venta, valorpago')
      if (filtrar) qEnc = qEnc.is('anulada_at', null)
      if (filtros.fechaInicio) qEnc = qEnc.gte('fecha_venta', `${filtros.fechaInicio}T00:00:00`)
      if (filtros.fechaFin) qEnc = qEnc.lte('fecha_venta', `${filtros.fechaFin}T23:59:59`)
      if (filtros.clienteId != null) qEnc = qEnc.eq('cliente_id', filtros.clienteId)
      if (filtros.almacenId != null) qEnc = qEnc.eq('almacen_id', filtros.almacenId)
      if (filtros.estadoPago) qEnc = qEnc.eq('estado_pago', filtros.estadoPago)
      return qEnc
    })
    if (errEnc) return { totalVentas, totalSaldo: 0, totalComisiones: 0, count: 0, error: errEnc.message || 'Error' }

    const rows = encs || []
    const totalSaldo = +rows
      .reduce((a, v) => a + Math.max(0, Number(v.total_venta || 0) - Number(v.valorpago || 0)), 0)
      .toFixed(2)

    // --- Comisiones bancarias del conjunto filtrado (desde ventas_pagos_detalle
    //     con join !inner al encabezado, mismos filtros). = Σ monto_bruto*%/100.
    //     Resiliente: si la tabla no existe (migracion 011 pendiente) -> 0.
    let totalComisiones = 0
    const { data: pagos, error: errCom } = await ejecutarVigentes<{ monto_bruto: number; porcentaje_comision: number }[] | null>((filtrar) => {
      let qCom = supabase
        .from('ventas_pagos_detalle')
        .select('monto_bruto, porcentaje_comision, ventas_encabezado!inner(cliente_id, almacen_id, estado_pago, fecha_venta)')
      if (filtrar) qCom = qCom.is('ventas_encabezado.anulada_at', null)
      if (filtros.fechaInicio) qCom = qCom.gte('ventas_encabezado.fecha_venta', `${filtros.fechaInicio}T00:00:00`)
      if (filtros.fechaFin) qCom = qCom.lte('ventas_encabezado.fecha_venta', `${filtros.fechaFin}T23:59:59`)
      if (filtros.clienteId != null) qCom = qCom.eq('ventas_encabezado.cliente_id', filtros.clienteId)
      if (filtros.almacenId != null) qCom = qCom.eq('ventas_encabezado.almacen_id', filtros.almacenId)
      if (filtros.estadoPago) qCom = qCom.eq('ventas_encabezado.estado_pago', filtros.estadoPago)
      return qCom
    })
    if (!errCom) {
      totalComisiones = +(pagos || [])
        .reduce((acc, p) => acc + Number(p.monto_bruto || 0) * (Number(p.porcentaje_comision || 0) / 100), 0)
        .toFixed(2)
    }

    return { totalVentas, totalSaldo, totalComisiones, count: rows.length, error: null }
  } catch (err) {
    console.error('[Supabase] Error obteniendo totales de ventas:', err)
    return { totalVentas: 0, totalSaldo: 0, totalComisiones: 0, count: 0, error: 'Error de conexion' }
  }
}

export async function getVentaById(id: number): Promise<{ data: VentaEncabezado | null; error: string | null }> {
  if (!isSupabaseConfigured()) {
    const saved = localStorage.getItem('ventas_encabezado')
    const ventas: VentaEncabezado[] = saved ? JSON.parse(saved) : []
    const venta = ventas.find(v => v.id === id) || null
    return { data: venta, error: null }
  }

  const supabase = createClient()
  if (!supabase) return { data: null, error: 'Cliente no disponible' }

  try {
    const { data, error } = await supabase
      .from('ventas_encabezado')
      .select(`
        *,
        clientes (nombre)
      `)
      .eq('id', id)
      .single()

    if (error) return { data: null, error: error.message }
    return { 
      data: { ...data, cliente_nombre: data.clientes?.nombre || '' }, 
      error: null 
    }
  } catch (err) {
    console.error('[Supabase] Error obteniendo venta:', err)
    return { data: null, error: 'Error de conexion' }
  }
}

export async function getDetallesVenta(ventaId: number): Promise<{ data: VentaDetalle[]; error: string | null }> {
  if (!isSupabaseConfigured()) {
    const saved = localStorage.getItem('ventas_detalle')
    const detalles: VentaDetalle[] = saved ? JSON.parse(saved) : []
    return { data: detalles.filter(d => d.venta_id === ventaId), error: null }
  }

  const supabase = createClient()
  if (!supabase) return { data: [], error: 'Cliente no disponible' }

  try {
    const { data, error } = await supabase
      .from('ventas_detalle')
      .select(`
        *,
        productos (nombre, codigo_barras)
      `)
      .eq('venta_id', ventaId)
      .order('id', { ascending: true })

    if (error) return { data: [], error: error.message }

    // Lineas de Venta Rapida (producto_id NULL): su nombre viene de la tabla
    // mapa `ventas_detalle_descripcion`. Se lee best-effort (si el script 045
    // no existe, el nombre queda vacio, sin romper).
    const detalles = data || []
    const idsSinProducto = detalles.filter(d => d.producto_id == null).map(d => d.id)
    const descById = new Map<number, string>()
    if (idsSinProducto.length > 0) {
      const { data: descData } = await supabase
        .from('ventas_detalle_descripcion')
        .select('detalle_id, descripcion')
        .in('detalle_id', idsSinProducto)
      for (const r of (descData || []) as { detalle_id: number; descripcion: string }[]) {
        descById.set(r.detalle_id, r.descripcion)
      }
    }

    const formattedData = detalles.map(d => ({
      ...d,
      producto_nombre: d.productos?.nombre || descById.get(d.id) || (d.producto_id == null ? 'Venta rápida' : ''),
      producto_codigo: d.productos?.codigo_barras || ''
    }))

    return { data: formattedData, error: null }
  } catch (err) {
    console.error('[Supabase] Error obteniendo detalles:', err)
    return { data: [], error: 'Error de conexion' }
  }
}

export interface VentaDetalleAnalitico {
  /** venta_id del encabezado (para unir metodo de pago / comision). */
  venta_id: number
  fecha_venta: string
  numero_factura: string
  cliente_nombre: string
  producto_nombre: string
  producto_sku: string
  cantidad: number
  precio_unitario: number
  costo_promedio_momento: number
  utilidad_linea: number
  /**
   * Total de venta de la linea CON ISV y neto del descuento de la factura
   * (contribucion de esta linea al `total_venta` del encabezado). Se calcula
   * como cantidad * precio_unitario * (1 - descuento%) * (1 + isv%), asi la
   * suma de la columna coincide con la suma de `total_venta` del Resumen.
   */
  total_linea: number
  almacen_nombre: string
}

export async function getDetalleAnalitico(
  fechaInicio?: string,
  fechaFin?: string
): Promise<{ data: VentaDetalleAnalitico[]; error: string | null }> {
  if (!isSupabaseConfigured()) {
    return { data: [], error: null }
  }

  const supabase = createClient()
  if (!supabase) return { data: [], error: 'Cliente no disponible' }

  try {
    // TODAS las lineas via bucle por rangos (supera el tope de 1000 filas).
    type DetalleRow = {
      venta_id?: number
      cantidad?: number
      precio_unitario?: number
      costo_promedio_momento?: number
      utilidad_linea?: number
      ventas_encabezado?: unknown
      productos?: unknown
    }
    const { data, error } = await fetchAllRows<DetalleRow>(() =>
      supabase
        .from('ventas_detalle')
        .select(`
          venta_id,
          cantidad,
          precio_unitario,
          costo_promedio_momento,
          utilidad_linea,
          ventas_encabezado (
            fecha_venta,
            numero_factura,
            almacen_id,
            aplica_impuesto,
            porcentaje_impuesto,
            descuento,
            anulada_at,
            clientes ( nombre ),
            almacenes ( nombre )
          ),
          productos ( nombre, codigo_barras )
        `)
        .order('venta_id', { ascending: false })
    )

    if (error) return { data: [], error }

    const formattedData: VentaDetalleAnalitico[] = (data || [])
      .filter(d => {
        const ve = d.ventas_encabezado as any
        if (!ve) return false
        // Ventas anuladas (script officemart-003) no cuentan en la analítica.
        if (ve.anulada_at) return false
        if (fechaInicio && ve.fecha_venta < fechaInicio) return false
        if (fechaFin && ve.fecha_venta > fechaFin + 'T23:59:59') return false
        return true
      })
      .map(d => {
        const ve = d.ventas_encabezado as any
        return {
          venta_id: (d as any).venta_id || 0,
          fecha_venta: ve?.fecha_venta || '',
          numero_factura: ve?.numero_factura || '',
          cliente_nombre: ve?.clientes?.nombre || '',
          producto_nombre: (d.productos as any)?.nombre || '',
          producto_sku: (d.productos as any)?.codigo_barras || '',
          cantidad: d.cantidad || 0,
          precio_unitario: d.precio_unitario || 0,
          costo_promedio_momento: d.costo_promedio_momento || 0,
          utilidad_linea: d.utilidad_linea || 0,
          total_linea:
            (d.cantidad || 0) *
            (d.precio_unitario || 0) *
            (1 - Number(ve?.descuento || 0) / 100) *
            (1 + (ve?.aplica_impuesto ? Number(ve?.porcentaje_impuesto || 0) : 0) / 100),
          almacen_nombre: ve?.almacenes?.nombre || '',
        }
      })

    return { data: formattedData, error: null }
  } catch (err) {
    console.error('[Supabase] Error obteniendo detalle analitico:', err)
    return { data: [], error: 'Error de conexion' }
  }
}

interface CrearVentaData {
  // `fecha_venta` es opcional: si se envia, se usa la fecha seleccionada por
  // el usuario; si se omite, la base de datos aplica su default now().
  encabezado: Omit<VentaEncabezado, 'id' | 'cliente_nombre' | 'fecha_venta'> & {
    fecha_venta?: string
  }
  detalles: Omit<VentaDetalle, 'id' | 'venta_id' | 'producto_nombre' | 'producto_codigo'>[]
  almacen_id: number
  localizacion_id: number
  /**
   * Desglose multi-metodo del pago. Si viene presente, sustituye al campo
   * `valorpago` del encabezado: la suma de `monto_bruto` se usa como
   * `valorpago` y se deriva `estado_pago`. Si esta vacio o ausente, la
   * venta se considera 100% credito (Pendiente).
   */
  pagos_detalle?: PagoVentaDetalleInput[]
  /**
   * Cuando es `true`, se RESPETA el `numero_factura` que trae el encabezado
   * (p. ej. importacion de ventas desde Excel, donde el numero viene del
   * documento origen). Cuando es falso/ausente (Nueva Venta, aprobar pedido),
   * el numero lo asigna el correlativo ATOMICO server-side y se ignora el que
   * haya calculado el cliente.
   */
  conservarNumeroFactura?: boolean
  /**
   * Cuando es `true` (la empresa tiene Facturación CAI activa), la venta emite
   * ADEMAS un número fiscal CAI atómico y lo guarda en `numero_fiscal`. Si la
   * config CAI no está lista (sin rango, agotada, RPC ausente), la venta NO se
   * bloquea: se crea sin número fiscal (modo degradado) y se avisa en consola.
   */
  emitirNumeroFiscal?: boolean
  /**
   * Punto de facturación desde el que se emite (script officemart-004). Si
   * viene, la venta guarda `punto_facturacion_id`, usa la serie interna del
   * punto (si tiene `serie_prefijo`) y el CAI configurado para ese punto. Si
   * es null/ausente, la empresa trabaja sin puntos (punto 0, flujo clásico).
   */
  punto_facturacion?: Pick<PuntoFacturacion, 'id' | 'serie_prefijo'> | null
}

/**
 * Deriva `valorpago` (suma de montos NETOS) y `estado_pago` a partir del
 * desglose de pagos y el total de la venta. Funcion PURA — la comparten
 * `crearVenta` y `editarVenta`, y es facil de testear.
 *
 *   neto por linea = monto_neto ?? monto_bruto * (1 - comision/100)
 *   valorpago      = suma de netos (2 decimales)
 *   estado_pago    = Pendiente (<=0) | Pagado (>= total) | Parcial
 */
export function derivarEstadoPago(
  pagosDetalle: PagoVentaDetalleInput[],
  totalVenta: number
): { valorpago: number; estado_pago: 'Pendiente' | 'Parcial' | 'Pagado' } {
  // `valorpago` = pagado en BRUTO (lo que entrega el cliente), para cuadrar
  // con `total_venta` que tambien se persiste en BRUTO. La comision bancaria
  // es un costo del comercio: no reduce la venta ni la deuda del cliente
  // (saldo = total_venta - valorpago, ambos brutos).
  const valorpago = +pagosDetalle
    .reduce((acc, p) => acc + Number(p.monto_bruto || 0), 0)
    .toFixed(2)

  let estado_pago: 'Pendiente' | 'Parcial' | 'Pagado'
  if (valorpago <= 0) estado_pago = 'Pendiente'
  else if (valorpago >= totalVenta - 0.005) estado_pago = 'Pagado'
  else estado_pago = 'Parcial'

  return { valorpago, estado_pago }
}

/**
 * Saldo pendiente TOTAL de un cliente = Σ (total_venta − valorpago) de todas sus
 * ventas con saldo (ambos brutos). Es el "crédito acumulado" actual. Acotado por
 * tenant vía RLS. Devuelve 0 si no hay Supabase o ante cualquier error (no
 * bloquear una venta por un fallo de lectura del saldo).
 */
export async function getSaldoPendienteCliente(clienteId: number): Promise<number> {
  if (!isSupabaseConfigured()) return 0
  const supabase = createClient()
  if (!supabase) return 0
  try {
    const { data, error } = await ejecutarVigentes<{ total_venta: number; valorpago: number }[] | null>((filtrar) => {
      let q = supabase
        .from('ventas_encabezado')
        .select('total_venta, valorpago')
        .eq('cliente_id', clienteId)
      if (filtrar) q = q.is('anulada_at', null)
      return q
    })
    if (error) return 0
    return +(data || [])
      .reduce((a, v) => a + Math.max(0, Number(v.total_venta || 0) - Number(v.valorpago || 0)), 0)
      .toFixed(2)
  } catch {
    return 0
  }
}

/**
 * Regla de límite de crédito (pura). Devuelve true si la venta a crédito debe
 * BLOQUEARSE porque el saldo acumulado del cliente superaría su límite.
 *   limite <= 0 o null  -> sin límite (nunca bloquea).
 *   saldoActual + saldoNuevo > limite (con tolerancia de centavo) -> bloquea.
 */
export function excedeLimiteCredito(
  saldoActual: number,
  saldoNuevaVenta: number,
  limite: number | null | undefined
): boolean {
  const lim = Number(limite || 0)
  if (lim <= 0) return false
  return saldoActual + saldoNuevaVenta > lim + 0.005
}

/**
 * Regla de bloqueo de crédito por estado del cliente (pura). Devuelve el
 * motivo por el que NO se le puede vender a crédito, o null si puede.
 *   - `bloqueado`: bloqueo manual del admin (con su motivo).
 *   - mora: si el cliente tiene días de crédito y alguna factura con saldo ya
 *     pasó ese plazo, se bloquea hasta que se ponga al día.
 * Solo aplica a ventas que dejan saldo; una venta de contado nunca se bloquea.
 */
export function bloqueoCreditoCliente(input: {
  bloqueado?: boolean | null
  motivoBloqueo?: string | null
  diasCredito?: number | null
  /** Facturas con saldo cuya antigüedad supera `diasCredito` (calculadas aparte). */
  facturasVencidas?: number
  diasMaxVencido?: number
}): string | null {
  if (input.bloqueado) {
    const motivo = (input.motivoBloqueo || '').trim()
    return motivo ? `Cliente bloqueado para crédito: ${motivo}` : 'Cliente bloqueado para crédito'
  }
  const dias = Number(input.diasCredito || 0)
  const vencidas = Number(input.facturasVencidas || 0)
  if (dias > 0 && vencidas > 0) {
    const max = Number(input.diasMaxVencido || 0)
    return `Tiene ${vencidas} factura${vencidas === 1 ? '' : 's'} vencida${vencidas === 1 ? '' : 's'}` +
      (max > 0 ? ` (la más antigua con ${max} días sobre su plazo de ${dias})` : ` (plazo de ${dias} días)`) +
      '. Debe ponerse al día antes de venderle a crédito.'
  }
  return null
}

/**
 * Facturas con saldo de un cliente cuya fecha + días de crédito ya pasó (mora).
 * Devuelve el conteo y el máximo de días vencidos. 0/0 si no hay plazo, no hay
 * Supabase o falla la lectura (no bloquear por un error de lectura).
 */
export async function getFacturasVencidasCliente(
  clienteId: number,
  diasCredito: number | null | undefined,
  hoyISO?: string
): Promise<{ vencidas: number; diasMaxVencido: number }> {
  const dias = Number(diasCredito || 0)
  if (dias <= 0 || !isSupabaseConfigured()) return { vencidas: 0, diasMaxVencido: 0 }
  const supabase = createClient()
  if (!supabase) return { vencidas: 0, diasMaxVencido: 0 }
  try {
    const { data, error } = await ejecutarVigentes<{ fecha_venta: string; total_venta: number; valorpago: number }[] | null>((filtrar) => {
      let q = supabase
        .from('ventas_encabezado')
        .select('fecha_venta, total_venta, valorpago')
        .eq('cliente_id', clienteId)
        .neq('estado_pago', 'Pagado')
      if (filtrar) q = q.is('anulada_at', null)
      return q
    })
    if (error) return { vencidas: 0, diasMaxVencido: 0 }
    return contarFacturasVencidas(
      (data || []) as { fecha_venta?: string | null; total_venta?: number | null; valorpago?: number | null }[],
      dias,
      hoyISO || getHondurasNowISO()
    )
  } catch {
    return { vencidas: 0, diasMaxVencido: 0 }
  }
}

/** Cuenta facturas con saldo cuya antigüedad (días) supera el plazo (pura). */
export function contarFacturasVencidas(
  ventas: { fecha_venta?: string | null; total_venta?: number | null; valorpago?: number | null }[],
  diasCredito: number,
  hoyISO: string
): { vencidas: number; diasMaxVencido: number } {
  const hoy = Date.parse(hoyISO.slice(0, 10))
  let vencidas = 0
  let diasMaxVencido = 0
  for (const v of ventas) {
    const saldo = Number(v.total_venta || 0) - Number(v.valorpago || 0)
    if (saldo <= 0.005 || !v.fecha_venta) continue
    const antiguedad = Math.floor((hoy - Date.parse(String(v.fecha_venta).slice(0, 10))) / 86_400_000)
    const sobrePlazo = antiguedad - diasCredito
    if (sobrePlazo > 0) {
      vencidas++
      if (sobrePlazo > diasMaxVencido) diasMaxVencido = sobrePlazo
    }
  }
  return { vencidas, diasMaxVencido }
}

export async function crearVenta(
  data: CrearVentaData
): Promise<{ data: VentaEncabezado | null; error: string | null }> {
  if (!isSupabaseConfigured()) {
    const savedEnc = localStorage.getItem('ventas_encabezado')
    const savedDet = localStorage.getItem('ventas_detalle')
    const savedProd = localStorage.getItem('productos')
    const savedTrans = localStorage.getItem('transacciones_inventario')
    
    const ventas: VentaEncabezado[] = savedEnc ? JSON.parse(savedEnc) : []
    const allDetalles: VentaDetalle[] = savedDet ? JSON.parse(savedDet) : []
    const productos: { id: number; stock_total: number }[] = savedProd ? JSON.parse(savedProd) : []
    const transacciones: { id?: number; producto_id: number; almacen_id: number; localizacion_id: number; tipo_movimiento: string; cantidad: number; costo_o_precio_unitario: number; referencia_id: number; fecha: string }[] = savedTrans ? JSON.parse(savedTrans) : []
    
    const newVenta: VentaEncabezado = { 
      ...data.encabezado, 
      id: Date.now(),
      fecha_venta: getHondurasNowISO()
    }
    ventas.push(newVenta)
    localStorage.setItem('ventas_encabezado', JSON.stringify(ventas))
    
    const newDetalles = data.detalles.map((d, idx) => ({
      ...d,
      id: Date.now() + idx + 1,
      venta_id: newVenta.id!
    }))
    allDetalles.push(...newDetalles)
    localStorage.setItem('ventas_detalle', JSON.stringify(allDetalles))
    
    // Update products stock (las lineas de Venta Rapida no afectan inventario)
    for (const detalle of data.detalles) {
      if (detalle.producto_id == null) continue
      const prodIdx = productos.findIndex(p => p.id === detalle.producto_id)
      if (prodIdx >= 0) {
        productos[prodIdx] = {
          ...productos[prodIdx],
          stock_total: (productos[prodIdx].stock_total || 0) - detalle.cantidad
        }
      }
      
      // Create inventory transaction
      transacciones.push({
        id: Date.now() + Math.random(),
        producto_id: detalle.producto_id,
        almacen_id: data.almacen_id,
        localizacion_id: data.localizacion_id,
        tipo_movimiento: 'Salida Venta',
        // Salida = cantidad NEGATIVA (misma convencion que 'Traslado Salida').
        // El stock por localizacion/almacen se calcula SUMANDO cantidad, asi
        // la venta resta en vez de sumar.
        cantidad: -detalle.cantidad,
        costo_o_precio_unitario: detalle.costo_promedio_momento,
        referencia_id: newVenta.id!,
        fecha: getHondurasNowISO()
      })
    }
    
    localStorage.setItem('productos', JSON.stringify(productos))
    localStorage.setItem('transacciones_inventario', JSON.stringify(transacciones))
    
    return { data: newVenta, error: null }
  }

  const supabase = createClient()
  if (!supabase) return { data: null, error: 'Cliente no disponible' }

  try {
    const stamp = await getTenantStamp(supabase)
    if (!isValidStamp(stamp)) {
      console.log('[crearVenta] Stamp invalido:', stamp)
      return { data: null, error: SESION_INVALIDA_ERROR }
    }

    // ----- DESGLOSE DE PAGO -----------------------------------------------
    // La fuente de verdad para `valorpago` y `estado_pago` es la suma del
    // NETO de cada linea (monto_bruto * (1 - porcentaje_comision/100)),
    // porque `total_venta` ahora se persiste tambien en NETO desde el UI
    // (lo que efectivamente recibe el comercio tras comisiones bancarias).
    // Asi `valorpago` y `total_venta` viven en la misma escala y el
    // estado_pago refleja la cobertura real.
    //
    // Si una linea no tiene comision (Efectivo u "Otro"), monto_neto =
    // monto_bruto y el resultado es identico al comportamiento legacy.
    // Si no se envio desglose, mantenemos los campos del encabezado
    // (compatibilidad con flujos antiguos / pendientes).
    const pagosDetalle = data.pagos_detalle ?? []
    const totalVenta = Number(data.encabezado.total_venta || 0)
    let valorpagoCalculado = Number(data.encabezado.valorpago ?? 0)
    let estadoPagoCalculado = data.encabezado.estado_pago

    if (pagosDetalle.length > 0) {
      const derivado = derivarEstadoPago(pagosDetalle, totalVenta)
      valorpagoCalculado = derivado.valorpago
      estadoPagoCalculado = derivado.estado_pago

      // Validacion de seguridad: si hay Efectivo > 0, exige sesion de caja
      // abierta antes de tocar `ventas_encabezado` (no creamos venta sin
      // poder registrar el ingreso de efectivo).
      const efectivoMonto = pagosDetalle
        .filter((p) => p.metodo_pago === 'Efectivo')
        .reduce((acc, p) => acc + Number(p.monto_bruto || 0), 0)
      if (efectivoMonto > 0) {
        const { data: sesion, error: sesErr } = await getSesionAbierta()
        // Si la migracion 011 no existe, no bloqueamos: registramos solo el
        // encabezado (modo degradado). Si existe pero no hay sesion abierta,
        // SI bloqueamos para cumplir la regla de negocio.
        if (!sesErr && !sesion?.id) {
          return {
            data: null,
            error: 'Debe abrir caja antes de realizar ventas en efectivo',
          }
        }
      }
    }

    // Numero de factura ATOMICO server-side (fuente de verdad). Reemplaza el
    // numero calculado en el cliente (COUNT(*)+1), que sufria condicion de
    // carrera y producia duplicados. Si el RPC (script 052) no esta desplegado,
    // `emitirCorrelativoVenta` devuelve null y conservamos el numero del cliente
    // (modo degradado, mismo comportamiento que antes). En importaciones
    // (`conservarNumeroFactura`) se respeta el numero del documento origen.
    // Punto de facturación (officemart-004): serie interna propia si el punto
    // tiene prefijo; si el RPC de correlativos falta, cae a la serie global.
    const punto = data.punto_facturacion ?? null
    const puntoId = punto?.id ?? 0
    const seriePunto = serieVentaDePunto(punto)
    let numeroAtomico: string | null = null
    if (!data.conservarNumeroFactura) {
      if (seriePunto) {
        const { numero } = await emitirCorrelativo(supabase, seriePunto.serie, seriePunto.prefijo, 4)
        numeroAtomico = numero
      }
      if (!numeroAtomico) numeroAtomico = await emitirCorrelativoVenta(supabase)
    }

    // Numero FISCAL CAI (SAR Honduras): SOLO si la empresa tiene Facturación CAI
    // activa (`emitirNumeroFiscal`) y no es una importacion. Es independiente del
    // FC-#### interno. Si la config CAI no esta lista o el RPC no existe, la venta
    // NO se bloquea: se crea sin numero fiscal (degradado) y se avisa en consola.
    // Con puntos, el CAI es el del punto (RPC v2) y se guarda la foto fiscal.
    let numeroFiscal: string | null = null
    let caiEmitido: string | null = null
    let tipoDocFiscal: string | null = null
    let fiscalSnapshot: Record<string, unknown> | null = null
    if (data.emitirNumeroFiscal && !data.conservarNumeroFactura) {
      const { data: corr, error: corrErr } = await emitirCorrelativoCai(supabase, '01', puntoId)
      if (corr) {
        numeroFiscal = corr.numero
        caiEmitido = corr.cai
        tipoDocFiscal = corr.tipo_documento
        fiscalSnapshot = construirFiscalSnapshot(corr, puntoId) as unknown as Record<string, unknown>
      } else {
        console.warn('[crearVenta] no se emitio numero fiscal CAI:', corrErr)
      }
    }

    // 1. Insert venta encabezado with almacen_id (sello completo: empresa + usuario)
    // fecha_venta HN-as-UTC por defecto si el caller no la envia (p.ej. aprobar
    // pedido): sin esto caia al DEFAULT now() de la BD (UTC real) y de noche
    // adelantaba el dia -> descuadre con caja/cierre. `ventas_encabezado` NO
    // esta en el backstop 040 (fecha elegible por el usuario), asi que el
    // default va aqui, con paridad a la rama localStorage.
    const encabezadoConAlmacen = {
      fecha_venta: getHondurasNowISO(),
      ...data.encabezado,
      ...(numeroAtomico ? { numero_factura: numeroAtomico } : {}),
      ...(numeroFiscal
        ? { numero_fiscal: numeroFiscal, cai_emitido: caiEmitido, tipo_documento_fiscal: tipoDocFiscal }
        : {}),
      valorpago: valorpagoCalculado,
      estado_pago: estadoPagoCalculado,
      almacen_id: data.almacen_id,
      // Punto, localización real y foto fiscal (officemart-004; reintento sin
      // ellas más abajo si el script no se aplicó).
      punto_facturacion_id: punto?.id ?? null,
      localizacion_id: data.localizacion_id || null,
      fiscal_snapshot: fiscalSnapshot,
      ...stamp
    }

    let { data: ventaData, error: ventaError } = await supabase
      .from('ventas_encabezado')
      .insert(encabezadoConAlmacen)
      .select()
      .single()

    // Fallback: si la columna `valorpago` aun no existe en la DB
    // (migracion 009 pendiente), re-intentamos sin ese campo para no
    // bloquear la creacion de ventas. El estado_pago se mantiene pero el
    // abono inicial queda sin persistir hasta que se aplique la migracion.
    if (ventaError && /valorpago/i.test(ventaError.message || '')) {
      console.warn(
        '[crearVenta] Columna `valorpago` no existe. Reintentando sin ella. ' +
        'Aplica scripts/009-add-valorpago-to-ventas.sql para habilitar el feature.'
      )
      const { valorpago: _omit, ...sinValorpago } = encabezadoConAlmacen as
        { valorpago?: number } & Record<string, unknown>
      const retry = await supabase
        .from('ventas_encabezado')
        .insert(sinValorpago)
        .select()
        .single()
      ventaData = retry.data
      ventaError = retry.error
    }

    // Fallback: si las columnas fiscales CAI aun no existen (script 062
    // pendiente) reintentamos sin ellas, para no bloquear la venta. El numero
    // interno FC-#### ya quedo asignado; solo se pierde el numero fiscal.
    if (ventaError && /numero_fiscal|cai_emitido|tipo_documento_fiscal/i.test(ventaError.message || '')) {
      console.warn(
        '[crearVenta] Columnas fiscales CAI no existen. Reintentando sin ellas. ' +
        'Aplica scripts/062-ventas-numero-fiscal.sql para guardar el numero fiscal.'
      )
      const { numero_fiscal: _nf, cai_emitido: _ce, tipo_documento_fiscal: _td, ...sinFiscal } =
        encabezadoConAlmacen as {
          numero_fiscal?: string | null
          cai_emitido?: string | null
          tipo_documento_fiscal?: string | null
        } & Record<string, unknown>
      const retry = await supabase
        .from('ventas_encabezado')
        .insert(sinFiscal)
        .select()
        .single()
      ventaData = retry.data
      ventaError = retry.error
    }

    // Fallback: columna `vendedor_id` ausente (script officemart-002 pendiente):
    // reintentamos sin ella; la venta se guarda sin vendedor.
    if (ventaError && /vendedor_id/i.test(ventaError.message || '')) {
      console.warn('[crearVenta] Columna vendedor_id no existe. Aplica scripts/officemart-002-cimientos.sql.')
      const { vendedor_id: _v, ...sinVendedor } = encabezadoConAlmacen as
        { vendedor_id?: number | null } & Record<string, unknown>
      const retry = await supabase
        .from('ventas_encabezado')
        .insert(sinVendedor)
        .select()
        .single()
      ventaData = retry.data
      ventaError = retry.error
    }

    // Fallback: columnas de punto de facturación ausentes (script officemart-004
    // pendiente): reintentamos sin ellas; la venta se guarda sin punto ni foto.
    if (ventaError && /punto_facturacion_id|localizacion_id|fiscal_snapshot/i.test(ventaError.message || '')) {
      console.warn('[crearVenta] Columnas de punto de facturación no existen. Aplica scripts/officemart-004-puntos-facturacion.sql.')
      const { punto_facturacion_id: _p, localizacion_id: _l, fiscal_snapshot: _f, ...sinPunto } =
        encabezadoConAlmacen as {
          punto_facturacion_id?: number | null
          localizacion_id?: number | null
          fiscal_snapshot?: Record<string, unknown> | null
        } & Record<string, unknown>
      const retry = await supabase
        .from('ventas_encabezado')
        .insert(sinPunto)
        .select()
        .single()
      ventaData = retry.data
      ventaError = retry.error
    }

    if (ventaError) return { data: null, error: ventaError.message }

    // 2. Insert detalles (solo razon_social_id, no usuario). Quitamos
    // `descripcion_libre` (no es columna de ventas_detalle: se guarda aparte
    // en la tabla mapa). Pedimos .select() para recuperar los id insertados y
    // poder mapear la descripcion de las lineas de Venta Rapida.
    const detallesConVenta = data.detalles.map(({ descripcion_libre: _omit, ...d }) => ({
      ...d,
      venta_id: ventaData.id,
      razon_social_id: stamp.razon_social_id
    }))

    const { data: detallesInsertados, error: detallesError } = await supabase
      .from('ventas_detalle')
      .insert(detallesConVenta)
      .select('id')

    if (detallesError) {
      await supabase.from('ventas_encabezado').delete().eq('id', ventaData.id)
      return { data: null, error: detallesError.message }
    }

    // 2b. Descripcion libre de las lineas de Venta Rapida (producto_id NULL).
    // Best-effort: si el script 045 no se aplico, no rompe la venta (el nombre
    // simplemente no se vera en el historial). Empareja por indice: el insert
    // conserva el orden de las filas enviadas.
    const filasDesc: { detalle_id: number; razon_social_id: number | null; descripcion: string }[] = []
    ;(detallesInsertados || []).forEach((fila: { id: number }, i: number) => {
      const orig = data.detalles[i]
      if (orig && orig.producto_id == null && (orig.descripcion_libre || '').trim() !== '') {
        filasDesc.push({
          detalle_id: fila.id,
          razon_social_id: stamp.razon_social_id,
          descripcion: (orig.descripcion_libre as string).trim(),
        })
      }
    })
    if (filasDesc.length > 0) {
      const { error: descErr } = await supabase.from('ventas_detalle_descripcion').insert(filasDesc)
      if (descErr) console.warn('[crearVenta] no se guardo descripcion libre:', descErr.message)
    }

    // 3. Update stock and create inventory transactions (sello completo).
    // Las lineas de Venta Rapida (producto_id NULL) NO afectan inventario: no
    // ajustan stock ni generan movimiento en el kardex.
    for (const detalle of data.detalles) {
      if (detalle.producto_id == null) continue

      // Descuenta el stock de forma ATOMICA (evita perdida de actualizaciones
      // si dos ventas del mismo producto ocurren a la vez). Ver script 018.
      await ajustarStock(supabase, detalle.producto_id, -detalle.cantidad)

      // Create inventory transaction
      await supabase
        .from('transacciones_inventario')
        .insert({
          producto_id: detalle.producto_id,
          almacen_id: data.almacen_id,
          localizacion_id: data.localizacion_id,
          tipo_movimiento: 'Salida Venta',
          // Salida = cantidad NEGATIVA (misma convencion que 'Traslado Salida').
          // El stock por localizacion/almacen se calcula SUMANDO cantidad, asi
          // la venta resta en vez de sumar. `stock_total` ya se decremento
          // arriba con ajustarStock(-cantidad); esto solo corrige el kardex.
          cantidad: -detalle.cantidad,
          costo_o_precio_unitario: detalle.costo_promedio_momento,
          referencia_id: ventaData.id,
          // Fecha HN-as-UTC (dia de negocio de Honduras): el kardex la muestra
          // con .split('T')[0], que asi devuelve el dia local correcto.
          fecha: getHondurasNowISO(),
          ...stamp
        })
    }

    // ----- 4. Persistir desglose de pagos (auditoria) ----------------------
    // Si la tabla `ventas_pagos_detalle` aun no existe (migracion 011
    // pendiente), degradamos sin error: la venta queda creada con
    // `valorpago`/`estado_pago` correctos. NOTA: el registro en caja chica
    // y cuentas bancarias se hace en un bloque SEPARADO (ver 5)
    // para que NO dependa del exito de este insert.
    if (pagosDetalle.length > 0) {
      const pagosRows = pagosDetalle.map((p) => {
        const comision = Number(p.porcentaje_comision ?? 0)
        const neto =
          p.monto_neto != null
            ? Number(p.monto_neto)
            : +(Number(p.monto_bruto) * (1 - comision / 100)).toFixed(2)
        return {
          venta_id: ventaData.id,
          metodo_pago: p.metodo_pago,
          cuenta_id: p.cuenta_id ?? null,
          monto_bruto: Number(p.monto_bruto),
          porcentaje_comision: comision,
          monto_neto: neto,
          razon_social_id: stamp.razon_social_id,
          usuario: stamp.usuario,
        }
      })

      const { error: pagosErr } = await supabase
        .from('ventas_pagos_detalle')
        .insert(pagosRows)

      if (pagosErr) {
        if (esTablaInexistente(pagosErr)) {
          console.warn(
            '[crearVenta] Tabla `ventas_pagos_detalle` no existe. ' +
              'Aplica scripts/011-tesoreria-caja-chica.sql para activar el desglose multi-metodo.'
          )
          // Modo degradado SOLO si la tabla falta: continua a registrar caja/cuentas.
        } else {
          // Error REAL (RLS, constraint, FK): NO degradar en silencio. Rollback
          // del encabezado y superficie el error para no perder el desglose de
          // pago (metodo/comision) que se necesita para auditoria.
          await supabase.from('ventas_detalle').delete().eq('venta_id', ventaData.id)
          await supabase.from('ventas_encabezado').delete().eq('id', ventaData.id)
          return { data: null, error: `No se pudo guardar el desglose de pago: ${pagosErr.message}` }
        }
      }
    }

    // ----- 5. Registrar movimientos de tesoreria (SIEMPRE) -----------------
    // Estos movimientos representan flujo de dinero real (caja chica,
    // cuentas bancarias) y deben registrarse independientemente de si el
    // desglose en `ventas_pagos_detalle` se persistio o no. Errores aqui
    // generan warning pero NO revierten la venta: la venta ya esta valida
    // y el usuario podra reconciliar manualmente si algo falla.
    if (pagosDetalle.length > 0) {
      for (const p of pagosDetalle) {
        const monto = Number(p.monto_bruto)
        if (monto <= 0) continue

        if (p.metodo_pago === 'Efectivo') {
          // Concepto: usamos el ID de la venta (clave estable y unica).
          // Si existe numero de factura, lo agregamos como contexto.
          const facturaTag = data.encabezado.numero_factura
            ? ` (${data.encabezado.numero_factura})`
            : ''
          const r = await registrarMovimientoCaja({
            tipo: 'Ingreso_Venta',
            monto,
            concepto: `Venta #${ventaData.id}${facturaTag}`,
            ref_tipo: 'venta',
            ref_id: ventaData.id,
          })
          if (r.error) {
            console.warn(
              '[crearVenta] No se pudo registrar Ingreso_Venta en caja:',
              r.error
            )
          }
        } else if (
          (p.metodo_pago === 'Banco' || p.metodo_pago === 'Link_Pago') &&
          p.cuenta_id
        ) {
          const comision = Number(p.porcentaje_comision ?? 0)
          const neto =
            p.monto_neto != null
              ? Number(p.monto_neto)
              : +(monto * (1 - comision / 100)).toFixed(2)
          const r = await registrarMovimientoCuenta({
            cuenta_id: p.cuenta_id,
            tipo: 'Ingreso',
            monto: neto,
            concepto: `Venta ${data.encabezado.numero_factura} (neto)`,
            ref_tipo: 'venta',
            ref_id: ventaData.id,
          })
          if (r.error) {
            console.warn(
              '[crearVenta] No se pudo registrar movimiento bancario:',
              r.error
            )
          }
        }
      }
    }

    return { data: ventaData, error: null }
  } catch (err) {
    console.error('[Supabase] Error creando venta:', err)
    return { data: null, error: 'Error de conexion' }
  }
}

// ==================== PAGOS ====================

export async function getPagosVenta(ventaId: number): Promise<{ data: PagoVenta[]; error: string | null }> {
  if (!isSupabaseConfigured()) {
    const saved = localStorage.getItem('pagos_ventas')
    const pagos: PagoVenta[] = saved ? JSON.parse(saved) : []
    return { data: pagos.filter(p => p.venta_id === ventaId), error: null }
  }

  const supabase = createClient()
  if (!supabase) return { data: [], error: 'Cliente no disponible' }

  try {
    const { data, error } = await supabase
      .from('pagos_ventas')
      .select('*')
      .eq('venta_id', ventaId)
      .order('fecha_pago', { ascending: true })

    if (error) return { data: [], error: error.message }
    return { data: data || [], error: null }
  } catch (err) {
    console.error('[Supabase] Error obteniendo pagos:', err)
    return { data: [], error: 'Error de conexion' }
  }
}

/**
 * Registra un abono (parcial o total) a una venta al credito.
 *
 * Ademas de actualizar `pagos_ventas` + `valorpago`/`estado_pago` de la
 * factura, el dinero ENTRA a tesoreria segun el metodo:
 *   - 'Efectivo'          -> Ingreso_Venta en la caja chica (requiere sesion abierta).
 *   - 'Banco'             -> Ingreso en la cuenta bancaria (`opciones.cuenta_id`).
 *   - 'Otro'              -> sin movimiento de tesoreria (solo baja el saldo).
 * Los movimientos van con ref_tipo='venta' + ref_id, igual que los cobros de
 * Nueva Venta, asi `eliminarVentaCompletamente` tambien los revierte.
 */
export async function registrarPago(
  pago: Omit<PagoVenta, 'id' | 'fecha_pago'>,
  opciones?: { cuenta_id?: number | null }
): Promise<{ data: PagoVenta | null; error: string | null }> {
  // Desde officemart-003 todo abono nuevo es un RECIBO DE COBRO (una
  // aplicacion). Si la tabla de recibos no existe todavia, cae al flujo
  // anterior (abono directo en pagos_ventas).
  if (isSupabaseConfigured() && pago.venta_id != null) {
    const metodo: 'Efectivo' | 'Banco' | 'Otro' =
      pago.metodo_pago === 'Efectivo' ? 'Efectivo'
      : /banco|transferencia|tarjeta|link/i.test(pago.metodo_pago || '') ? 'Banco'
      : 'Otro'
    // Banco sin cuenta elegida (UI vieja de CxC): se registra como 'Otro'
    // (baja el saldo sin asiento bancario), igual que antes.
    const metodoEfectivo = metodo === 'Banco' && !opciones?.cuenta_id ? 'Otro' : metodo
    const supabaseCli = createClient()
    if (supabaseCli) {
      const { data: venta } = await supabaseCli
        .from('ventas_encabezado')
        .select('cliente_id')
        .eq('id', pago.venta_id)
        .maybeSingle()
      if (venta?.cliente_id != null) {
        const r = await registrarReciboCobro({
          cliente_id: Number(venta.cliente_id),
          metodo_pago: metodoEfectivo,
          cuenta_id: opciones?.cuenta_id ?? null,
          aplicaciones: [{ venta_id: pago.venta_id, monto: pago.monto }],
        })
        if (!r.error && r.data) {
          return {
            data: { ...pago, id: r.data.id, fecha_pago: getHondurasNowISO() },
            error: null,
          }
        }
        if (r.error !== RECIBOS_FEATURE_PENDING && !/siguiente_correlativo|correlativos/i.test(r.error || '')) {
          return { data: null, error: r.error }
        }
        // Script 003 pendiente: flujo anterior.
      }
    }
  }

  if (!isSupabaseConfigured()) {
    const savedPagos = localStorage.getItem('pagos_ventas')
    const savedVentas = localStorage.getItem('ventas_encabezado')
    
    const pagos: PagoVenta[] = savedPagos ? JSON.parse(savedPagos) : []
    const ventas: VentaEncabezado[] = savedVentas ? JSON.parse(savedVentas) : []
    
    const newPago: PagoVenta = { 
      ...pago, 
      id: Date.now(),
      fecha_pago: getHondurasNowISO()
    }
    pagos.push(newPago)
    localStorage.setItem('pagos_ventas', JSON.stringify(pagos))
    
    // Update venta estado_pago + valorpago (contador acumulado)
    const ventaIdx = ventas.findIndex(v => v.id === pago.venta_id)
    if (ventaIdx >= 0) {
      const venta = ventas[ventaIdx]
      const nuevoValorpago = (venta.valorpago || 0) + pago.monto

      ventas[ventaIdx] = {
        ...venta,
        valorpago: nuevoValorpago,
        estado_pago: nuevoValorpago >= venta.total_venta ? 'Pagado' : 'Parcial'
      }
      localStorage.setItem('ventas_encabezado', JSON.stringify(ventas))
    }
    
    return { data: newPago, error: null }
  }

  const supabase = createClient()
  if (!supabase) return { data: null, error: 'Cliente no disponible' }

  try {
    const stamp = await getTenantStamp(supabase)
    if (!isValidStamp(stamp)) {
      console.log('[registrarPago] Stamp invalido:', stamp)
      return { data: null, error: SESION_INVALIDA_ERROR }
    }

    if (pago.monto <= 0) {
      return { data: null, error: 'El monto debe ser mayor a 0' }
    }

    // Validaciones de tesoreria ANTES de insertar el pago, para no dejar
    // un abono registrado sin su entrada de dinero.
    if (pago.metodo_pago === 'Efectivo') {
      const { data: sesion } = await getSesionAbierta()
      if (!sesion) {
        return {
          data: null,
          error: 'Debes abrir la caja chica para registrar abonos en efectivo',
        }
      }
    }
    if (pago.metodo_pago === 'Banco' && !opciones?.cuenta_id) {
      return { data: null, error: 'Selecciona la cuenta bancaria del abono' }
    }

    // Insert payment (sello completo: empresa + usuario que registra el pago)
    const { data: pagoData, error: pagoError } = await supabase
      .from('pagos_ventas')
      // fecha_pago HN-as-UTC (dia de negocio): el historial/CxC la muestran con
      // .split('T')[0]. Sin esto caia a now() (UTC real) y de noche adelantaba.
      .insert({ ...pago, fecha_pago: getHondurasNowISO(), ...stamp })
      .select()
      .single()

    if (pagoError) return { data: null, error: pagoError.message }

    // Entrada del dinero a tesoreria (mismo ref que los cobros de Nueva
    // Venta, para que la eliminacion de la venta tambien lo revierta).
    let avisoTesoreria: string | null = null
    if (pago.metodo_pago === 'Efectivo') {
      const mov = await registrarMovimientoCaja({
        tipo: 'Ingreso_Venta',
        monto: pago.monto,
        concepto: `Abono venta #${pago.venta_id}`,
        ref_tipo: 'venta',
        ref_id: pago.venta_id,
      })
      if (mov.error) avisoTesoreria = mov.error
    } else if (pago.metodo_pago === 'Banco' && opciones?.cuenta_id) {
      const mov = await registrarMovimientoCuenta({
        cuenta_id: opciones.cuenta_id,
        tipo: 'Ingreso',
        monto: pago.monto,
        concepto: `Abono venta #${pago.venta_id}`,
        ref_tipo: 'venta',
        ref_id: pago.venta_id,
      })
      if (mov.error) avisoTesoreria = mov.error
    }
    if (avisoTesoreria) {
      // El abono quedo registrado pero el asiento de dinero fallo:
      // informar para regularizar manualmente en Finanzas.
      console.error('[registrarPago] Abono sin asiento de tesoreria:', avisoTesoreria)
    }

    // Intentamos leer `valorpago` (contador acumulado). Si la columna aun
    // no existe en la DB (migracion 009 pendiente), caemos al calculo
    // historico desde `pagos_ventas`.
    const { data: ventaData, error: ventaError } = await supabase
      .from('ventas_encabezado')
      .select('total_venta, valorpago')
      .eq('id', pago.venta_id)
      .single()

    const totalVenta = ventaData?.total_venta || 0
    const tieneColumnaValorpago =
      !ventaError && ventaData && 'valorpago' in ventaData

    let nuevoValorpago: number
    if (tieneColumnaValorpago) {
      nuevoValorpago = (ventaData.valorpago || 0) + pago.monto
    } else {
      // Fallback: sumar todos los pagos de pagos_ventas (incluye el
      // recien insertado) para derivar el acumulado.
      const { data: pagosData } = await supabase
        .from('pagos_ventas')
        .select('monto')
        .eq('venta_id', pago.venta_id)
      nuevoValorpago = (pagosData || []).reduce((acc, p) => acc + p.monto, 0)
    }

    const nuevoEstado: 'Pendiente' | 'Parcial' | 'Pagado' =
      nuevoValorpago >= totalVenta ? 'Pagado' : 'Parcial'

    // Si la columna existe incluimos valorpago en el update; de lo contrario
    // solo actualizamos estado_pago (comportamiento previo).
    const updatePayload: Record<string, unknown> = { estado_pago: nuevoEstado }
    if (tieneColumnaValorpago) updatePayload.valorpago = nuevoValorpago

    await supabase
      .from('ventas_encabezado')
      .update(updatePayload)
      .eq('id', pago.venta_id)

    return { data: pagoData, error: null }
  } catch (err) {
    console.error('[Supabase] Error registrando pago:', err)
    return { data: null, error: 'Error de conexion' }
  }
}

// ==================== CUENTAS POR COBRAR ====================

export interface CuentaPorCobrar {
  id: number
  numero_factura: string
  cliente_id: number
  cliente_nombre: string
  fecha_venta: string
  total_venta: number
  total_abonado: number
  saldo_pendiente: number
  estado_pago: 'Pendiente' | 'Parcial'
  porcentaje_pagado: number
}

export async function getCuentasPorCobrar(): Promise<{ data: CuentaPorCobrar[]; error: string | null }> {
  if (!isSupabaseConfigured()) {
    const savedVentas = localStorage.getItem('ventas_encabezado')
    const savedPagos = localStorage.getItem('pagos_ventas')
    
    const ventas: VentaEncabezado[] = savedVentas ? JSON.parse(savedVentas) : []
    const pagos: PagoVenta[] = savedPagos ? JSON.parse(savedPagos) : []
    
    // Usamos `valorpago` como total pagado acumulado. Mantiene compat
    // hacia atras: si una venta vieja no tiene valorpago, caemos a la
    // suma de pagos_ventas para no perder cartera historica.
    const cuentas = ventas
      .filter(v => v.estado_pago !== 'Pagado')
      .map(v => {
        const totalAbonado = (v.valorpago ?? null) !== null
          ? (v.valorpago || 0)
          : pagos
              .filter(p => p.venta_id === v.id)
              .reduce((acc, p) => acc + p.monto, 0)
        const saldoPendiente = v.total_venta - totalAbonado

        return {
          id: v.id!,
          numero_factura: v.numero_factura,
          cliente_id: v.cliente_id,
          cliente_nombre: v.cliente_nombre || '',
          fecha_venta: v.fecha_venta || '',
          total_venta: v.total_venta,
          total_abonado: totalAbonado,
          saldo_pendiente: saldoPendiente,
          estado_pago: v.estado_pago as 'Pendiente' | 'Parcial',
          porcentaje_pagado: v.total_venta > 0 ? (totalAbonado / v.total_venta) * 100 : 0
        }
      })
    
    return { data: cuentas, error: null }
  }

  const supabase = createClient()
  if (!supabase) return { data: [], error: 'Cliente no disponible' }

  try {
    // Get ventas that are not fully paid. Ahora traemos `valorpago`
    // directamente; la suma desde `pagos_ventas` queda como respaldo
    // historico para ventas antiguas que aun no tienen valorpago.
    const baseSelect = `
      id,
      numero_factura,
      cliente_id,
      fecha_venta,
      total_venta,
      estado_pago,
      clientes (nombre)
    `
    // El select se construye dinamicamente, asi que supabase-js no puede
    // inferir el tipo de la fila; lo declaramos manualmente.
    type CxcRow = {
      id: number
      numero_factura: string
      cliente_id: number
      fecha_venta: string
      total_venta: number
      valorpago?: number | null
      estado_pago: string
      clientes: { nombre: string } | null
    }

    const primary = await ejecutarVigentes<unknown[] | null>((filtrar) => {
      let q = supabase
        .from('ventas_encabezado')
        .select(baseSelect.replace('estado_pago', 'valorpago,\n      estado_pago'))
        .neq('estado_pago', 'Pagado')
      if (filtrar) q = q.is('anulada_at', null)
      return q.order('fecha_venta', { ascending: false })
    })

    let ventasData = primary.data as unknown as CxcRow[] | null
    let ventasError = primary.error

    // Fallback: columna `valorpago` aun no existe en la DB.
    if (ventasError && /valorpago/i.test(ventasError.message || '')) {
      const retry = await ejecutarVigentes<unknown[] | null>((filtrar) => {
        let q = supabase
          .from('ventas_encabezado')
          .select(baseSelect)
          .neq('estado_pago', 'Pagado')
        if (filtrar) q = q.is('anulada_at', null)
        return q.order('fecha_venta', { ascending: false })
      })
      ventasData = retry.data as unknown as CxcRow[] | null
      ventasError = retry.error
    }

    if (ventasError) return { data: [], error: ventasError.message || 'Error' }

    // Para ventas SIN valorpago (historicas), calculamos total abonado
    // desde pagos_ventas para no perder cartera. Las nuevas usan valorpago.
    const ventasSinValorpago = (ventasData || []).filter(
      v => v.valorpago === null || v.valorpago === undefined
    )

    let pagosMap: Record<number, number> = {}
    if (ventasSinValorpago.length > 0) {
      const { data: pagosData } = await supabase
        .from('pagos_ventas')
        .select('venta_id, monto')
        .in('venta_id', ventasSinValorpago.map(v => v.id))

      pagosMap = (pagosData || []).reduce((acc, p) => {
        acc[p.venta_id] = (acc[p.venta_id] || 0) + p.monto
        return acc
      }, {} as Record<number, number>)
    }

    const cuentas: CuentaPorCobrar[] = (ventasData || []).map(v => {
      const totalAbonado =
        v.valorpago !== null && v.valorpago !== undefined
          ? v.valorpago
          : pagosMap[v.id] || 0
      const saldoPendiente = v.total_venta - totalAbonado

      return {
        id: v.id,
        numero_factura: v.numero_factura,
        cliente_id: v.cliente_id,
        cliente_nombre: v.clientes?.nombre || '',
        fecha_venta: v.fecha_venta,
        total_venta: v.total_venta,
        total_abonado: totalAbonado,
        saldo_pendiente: saldoPendiente,
        estado_pago: v.estado_pago as 'Pendiente' | 'Parcial',
        porcentaje_pagado: v.total_venta > 0 ? (totalAbonado / v.total_venta) * 100 : 0
      }
    })

    return { data: cuentas, error: null }
  } catch (err) {
    console.error('[Supabase] Error obteniendo cuentas por cobrar:', err)
    return { data: [], error: 'Error de conexion' }
  }
}

export async function getAllPagos(): Promise<{ data: (PagoVenta & { numero_factura?: string; cliente_nombre?: string })[]; error: string | null }> {
  if (!isSupabaseConfigured()) {
    const savedPagos = localStorage.getItem('pagos_ventas')
    const savedVentas = localStorage.getItem('ventas_encabezado')
    
    const pagos: PagoVenta[] = savedPagos ? JSON.parse(savedPagos) : []
    const ventas: VentaEncabezado[] = savedVentas ? JSON.parse(savedVentas) : []
    
    const pagosConInfo = pagos.map(p => {
      const venta = ventas.find(v => v.id === p.venta_id)
      return {
        ...p,
        numero_factura: venta?.numero_factura || '',
        cliente_nombre: venta?.cliente_nombre || ''
      }
    }).sort((a, b) => new Date(b.fecha_pago || '').getTime() - new Date(a.fecha_pago || '').getTime())
    
    return { data: pagosConInfo, error: null }
  }

  const supabase = createClient()
  if (!supabase) return { data: [], error: 'Cliente no disponible' }

  try {
    const { data, error } = await supabase
      .from('pagos_ventas')
      .select(`
        *,
        ventas_encabezado (
          numero_factura,
          clientes (nombre)
        )
      `)
      .order('fecha_pago', { ascending: false })

    if (error) return { data: [], error: error.message }

    const pagosConInfo = (data || []).map(p => ({
      ...p,
      numero_factura: p.ventas_encabezado?.numero_factura || '',
      cliente_nombre: p.ventas_encabezado?.clientes?.nombre || ''
    }))

    return { data: pagosConInfo, error: null }
  } catch (err) {
    console.error('[Supabase] Error obteniendo pagos:', err)
    return { data: [], error: 'Error de conexion' }
  }
}

// ==================== DASHBOARD ANALYTICS ====================

export interface VentasDashboardData {
  // Main KPIs
  ventasTotales: number
  gananciaBruta: number
  ticketPromedio: number
  cantidadFacturas: number
  unidadesVendidas: number
  margenPromedio: number
  
  // Trends
  ventasMesActual: number
  ventasMesAnterior: number
  crecimientoMensual: number
  
  // By time
  ventasPorMes: { mes: string; mesNum: number; anio: number; ventas: number; ganancia: number; facturas: number }[]
  ventasPorAnio: { anio: number; ventas: number; ganancia: number; facturas: number }[]
  
  // Rankings
  topClientes: { id: number; nombre: string; ventas: number; facturas: number; ganancia: number }[]
  topProductos: { id: number; nombre: string; codigo: string; cantidad: number; ventas: number; ganancia: number }[]
  topAlmacenes: { id: number; nombre: string; ventas: number; facturas: number }[]
  
  // Additional metrics
  clientesActivos: number
  productosVendidos: number
}

/** Punto de la serie diaria: `dia` = numero de dia (label del eje X). */
export interface VentaDiaria { dia: string; fecha: string; ventas: number }

/**
 * Ventas por dia del MES CALENDARIO ACTUAL (independiente de filtros del
 * dashboard). Siembra todos los dias del mes en 0 para un eje X continuo.
 */
export async function getVentasDiariasMesActual(): Promise<{ data: VentaDiaria[]; error: string | null }> {
  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth() // 0-based
  const mm = String(month + 1).padStart(2, '0')
  const finMes = new Date(year, month + 1, 0, 23, 59, 59)
  const diasEnMes = finMes.getDate()

  const byDay = new Map<string, number>()
  for (let d = 1; d <= diasEnMes; d++) {
    byDay.set(`${year}-${mm}-${String(d).padStart(2, '0')}`, 0)
  }
  const acumular = (fecha: string | null | undefined, total: number | null | undefined) => {
    const key = (fecha || '').split('T')[0]
    if (byDay.has(key)) byDay.set(key, (byDay.get(key) || 0) + (Number(total) || 0))
  }
  const serie = (): VentaDiaria[] =>
    Array.from(byDay.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([fecha, ventas]) => ({ dia: String(Number(fecha.split('-')[2])), fecha, ventas: +ventas.toFixed(2) }))

  if (!isSupabaseConfigured()) {
    const saved = localStorage.getItem('ventas_encabezado')
    const todas: VentaEncabezado[] = saved ? JSON.parse(saved) : []
    for (const v of todas) acumular(v.fecha_venta, v.total_venta)
    return { data: serie(), error: null }
  }

  const supabase = createClient()
  if (!supabase) return { data: [], error: 'Cliente no disponible' }
  try {
    const { data, error } = await ejecutarVigentes<{ fecha_venta: string | null; total_venta: number | null }[] | null>((filtrar) => {
      let q = supabase
        .from('ventas_encabezado')
        .select('fecha_venta, total_venta')
        .gte('fecha_venta', `${year}-${mm}-01T00:00:00`)
        // Cota superior naive (sin offset) para no arrastrar 6h del mes siguiente.
        .lte('fecha_venta', `${year}-${mm}-${String(diasEnMes).padStart(2, '0')}T23:59:59`)
      if (filtrar) q = q.is('anulada_at', null)
      return q
    })
    if (error) return { data: [], error: error.message || 'Error' }
    for (const v of (data || []) as { fecha_venta: string | null; total_venta: number | null }[]) {
      acumular(v.fecha_venta, v.total_venta)
    }
    return { data: serie(), error: null }
  } catch (err) {
    console.error('[Supabase] Error obteniendo ventas diarias:', err)
    return { data: [], error: 'Error de conexion' }
  }
}

export async function getVentasDashboard(anio?: number, mes?: number): Promise<{ data: VentasDashboardData | null; error: string | null }> {
  if (!isSupabaseConfigured()) {
    // LocalStorage implementation
    const savedVentas = localStorage.getItem('ventas_encabezado')
    const savedDetalles = localStorage.getItem('ventas_detalle')
    const savedClientes = localStorage.getItem('clientes')
    const savedProductos = localStorage.getItem('productos')
    const savedTransacciones = localStorage.getItem('transacciones_inventario')
    const savedAlmacenes = localStorage.getItem('almacenes')
    
    const ventas: VentaEncabezado[] = savedVentas ? JSON.parse(savedVentas) : []
    const detalles: VentaDetalle[] = savedDetalles ? JSON.parse(savedDetalles) : []
    const clientes = savedClientes ? JSON.parse(savedClientes) : []
    const productos = savedProductos ? JSON.parse(savedProductos) : []
    const transacciones = savedTransacciones ? JSON.parse(savedTransacciones) : []
    const almacenes = savedAlmacenes ? JSON.parse(savedAlmacenes) : []
    
    // Filter by year/month if specified
    let ventasFiltradas = ventas
    if (anio) {
      ventasFiltradas = ventasFiltradas.filter(v => {
        const fecha = new Date(v.fecha_venta || '')
        return fecha.getFullYear() === anio
      })
    }
    if (mes) {
      ventasFiltradas = ventasFiltradas.filter(v => {
        const fecha = new Date(v.fecha_venta || '')
        return fecha.getMonth() + 1 === mes
      })
    }
    
    const ventaIds = ventasFiltradas.map(v => v.id)
    const detallesFiltrados = detalles.filter(d => ventaIds.includes(d.venta_id))
    
    // Calculate KPIs
    const ventasTotales = ventasFiltradas.reduce((acc, v) => acc + v.total_venta, 0)
    const gananciaBruta = detallesFiltrados.reduce((acc, d) => acc + d.utilidad_linea, 0)
    const cantidadFacturas = ventasFiltradas.length
    const ticketPromedio = cantidadFacturas > 0 ? ventasTotales / cantidadFacturas : 0
    const unidadesVendidas = detallesFiltrados.reduce((acc, d) => acc + d.cantidad, 0)
    const margenPromedio = ventasTotales > 0 ? (gananciaBruta / ventasTotales) * 100 : 0
    
    // Monthly trend
    const now = new Date()
    const mesActual = now.getMonth() + 1
    const anioActual = now.getFullYear()
    const ventasMesActual = ventas
      .filter(v => {
        const f = new Date(v.fecha_venta || '')
        return f.getMonth() + 1 === mesActual && f.getFullYear() === anioActual
      })
      .reduce((acc, v) => acc + v.total_venta, 0)
    
    const mesAnterior = mesActual === 1 ? 12 : mesActual - 1
    const anioMesAnterior = mesActual === 1 ? anioActual - 1 : anioActual
    const ventasMesAnterior = ventas
      .filter(v => {
        const f = new Date(v.fecha_venta || '')
        return f.getMonth() + 1 === mesAnterior && f.getFullYear() === anioMesAnterior
      })
      .reduce((acc, v) => acc + v.total_venta, 0)
    
    const crecimientoMensual = ventasMesAnterior > 0 
      ? ((ventasMesActual - ventasMesAnterior) / ventasMesAnterior) * 100 
      : 0
    
    // Group by month
    const ventasPorMesMap: Record<string, { ventas: number; ganancia: number; facturas: number; mesNum: number; anio: number }> = {}
    ventasFiltradas.forEach(v => {
      const f = new Date(v.fecha_venta || '')
      const key = `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, '0')}`
      if (!ventasPorMesMap[key]) {
        ventasPorMesMap[key] = { ventas: 0, ganancia: 0, facturas: 0, mesNum: f.getMonth() + 1, anio: f.getFullYear() }
      }
      ventasPorMesMap[key].ventas += v.total_venta
      ventasPorMesMap[key].facturas += 1
      
      const dets = detalles.filter(d => d.venta_id === v.id)
      ventasPorMesMap[key].ganancia += dets.reduce((acc, d) => acc + d.utilidad_linea, 0)
    })
    
    const meses = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
    const ventasPorMes = Object.entries(ventasPorMesMap)
      .map(([key, val]) => ({
        mes: meses[val.mesNum - 1],
        mesNum: val.mesNum,
        anio: val.anio,
        ventas: val.ventas,
        ganancia: val.ganancia,
        facturas: val.facturas
      }))
      .sort((a, b) => a.anio * 100 + a.mesNum - (b.anio * 100 + b.mesNum))
    
    // Group by year
    const ventasPorAnioMap: Record<number, { ventas: number; ganancia: number; facturas: number }> = {}
    ventas.forEach(v => {
      const f = new Date(v.fecha_venta || '')
      const yr = f.getFullYear()
      if (!ventasPorAnioMap[yr]) {
        ventasPorAnioMap[yr] = { ventas: 0, ganancia: 0, facturas: 0 }
      }
      ventasPorAnioMap[yr].ventas += v.total_venta
      ventasPorAnioMap[yr].facturas += 1
      
      const dets = detalles.filter(d => d.venta_id === v.id)
      ventasPorAnioMap[yr].ganancia += dets.reduce((acc, d) => acc + d.utilidad_linea, 0)
    })
    
    const ventasPorAnio = Object.entries(ventasPorAnioMap)
      .map(([yr, val]) => ({
        anio: parseInt(yr),
        ventas: val.ventas,
        ganancia: val.ganancia,
        facturas: val.facturas
      }))
      .sort((a, b) => a.anio - b.anio)
    
    // Top Clientes
    const clienteMap: Record<number, { ventas: number; facturas: number; ganancia: number }> = {}
    ventasFiltradas.forEach(v => {
      if (!clienteMap[v.cliente_id]) {
        clienteMap[v.cliente_id] = { ventas: 0, facturas: 0, ganancia: 0 }
      }
      clienteMap[v.cliente_id].ventas += v.total_venta
      clienteMap[v.cliente_id].facturas += 1
      
      const dets = detalles.filter(d => d.venta_id === v.id)
      clienteMap[v.cliente_id].ganancia += dets.reduce((acc, d) => acc + d.utilidad_linea, 0)
    })
    
    const topClientes = Object.entries(clienteMap)
      .map(([id, val]) => {
        const cliente = clientes.find((c: { id: number }) => c.id === parseInt(id))
        return {
          id: parseInt(id),
          nombre: cliente?.nombre || 'Desconocido',
          ventas: val.ventas,
          facturas: val.facturas,
          ganancia: val.ganancia
        }
      })
      .sort((a, b) => b.ventas - a.ventas)
      .slice(0, 10)
    
    // Top Productos (excluye lineas de Venta Rapida sin producto)
    const productoMap: Record<number, { cantidad: number; ventas: number; ganancia: number }> = {}
    detallesFiltrados.forEach(d => {
      if (d.producto_id == null) return
      if (!productoMap[d.producto_id]) {
        productoMap[d.producto_id] = { cantidad: 0, ventas: 0, ganancia: 0 }
      }
      productoMap[d.producto_id].cantidad += d.cantidad
      productoMap[d.producto_id].ventas += d.cantidad * d.precio_unitario
      productoMap[d.producto_id].ganancia += d.utilidad_linea
    })
    
    const topProductos = Object.entries(productoMap)
      .map(([id, val]) => {
        const producto = productos.find((p: { id: number }) => p.id === parseInt(id))
        return {
          id: parseInt(id),
          nombre: producto?.nombre || 'Desconocido',
          codigo: producto?.codigo_barras || '',
          cantidad: val.cantidad,
          ventas: val.ventas,
          ganancia: val.ganancia
        }
      })
      .sort((a, b) => b.ventas - a.ventas)
      .slice(0, 10)
    
    // Top Almacenes
    const almacenVentas: Record<number, { ventas: number; facturas: Set<number> }> = {}
    const ventaSalidas = transacciones.filter((t: { tipo_movimiento: string }) => t.tipo_movimiento === 'Salida Venta')
    ventaSalidas.forEach((t: { almacen_id: number; referencia_id: number; costo_o_precio_unitario: number; cantidad: number }) => {
      if (ventaIds.includes(t.referencia_id)) {
        if (!almacenVentas[t.almacen_id]) {
          almacenVentas[t.almacen_id] = { ventas: 0, facturas: new Set() }
        }
        almacenVentas[t.almacen_id].ventas += t.costo_o_precio_unitario * Math.abs(t.cantidad)
        almacenVentas[t.almacen_id].facturas.add(t.referencia_id)
      }
    })
    
    const topAlmacenes = Object.entries(almacenVentas)
      .map(([id, val]) => {
        const almacen = almacenes.find((a: { id: number }) => a.id === parseInt(id))
        return {
          id: parseInt(id),
          nombre: almacen?.nombre || `Almacen ${id}`,
          ventas: val.ventas,
          facturas: val.facturas.size
        }
      })
      .sort((a, b) => b.ventas - a.ventas)
      .slice(0, 5)
    
    return {
      data: {
        ventasTotales,
        gananciaBruta,
        ticketPromedio,
        cantidadFacturas,
        unidadesVendidas,
        margenPromedio,
        ventasMesActual,
        ventasMesAnterior,
        crecimientoMensual,
        ventasPorMes,
        ventasPorAnio,
        topClientes,
        topProductos,
        topAlmacenes,
        clientesActivos: Object.keys(clienteMap).length,
        productosVendidos: Object.keys(productoMap).length
      },
      error: null
    }
  }

  const supabase = createClient()
  if (!supabase) return { data: null, error: 'Cliente no disponible' }

  // Aislamiento multi-tenant: el dashboard SOLO debe ver ventas de la razon
  // social del usuario logueado. Si la sesion no tiene tenant valido, dejamos
  // pasar la consulta - el resultado natural sera vacio porque ningun row
  // matchea null.
  const stamp = await getTenantStamp(supabase)
  const tenantId = stamp.razon_social_id

  try {
    // Build date filter
    let ventasQuery = supabase
      .from('ventas_encabezado')
      .select(`
        id,
        numero_factura,
        cliente_id,
        fecha_venta,
        total_venta,
        clientes (nombre)
      `)

    if (tenantId != null) ventasQuery = ventasQuery.eq('razon_social_id', tenantId)
    // Solo ventas vigentes (script officemart-003). Sin reintento: el flag ya lo
    // fijaron las consultas previas de la sesion (getVentas, CxC, etc.).
    if (filtrarVigentesActivo()) ventasQuery = ventasQuery.is('anulada_at', null)

    if (anio) {
      // Limites naive (sin offset) para casar con fecha_venta HN-as-UTC y no
      // desfasar 6h los bordes de mes/ano.
      const mm = mes ? String(mes).padStart(2, '0') : null
      const startDate = mm ? `${anio}-${mm}-01T00:00:00` : `${anio}-01-01T00:00:00`
      const endDate = mm
        ? `${anio}-${mm}-${String(new Date(anio, mes!, 0).getDate()).padStart(2, '0')}T23:59:59`
        : `${anio}-12-31T23:59:59`
      ventasQuery = ventasQuery.gte('fecha_venta', startDate).lte('fecha_venta', endDate)
    }
    
    const { data: ventasData, error: ventasError } = await ventasQuery
    if (ventasError) return { data: null, error: ventasError.message }
    
    const ventaIds = (ventasData || []).map(v => v.id)
    
    // Get detalles
    let detallesData: VentaDetalle[] = []
    if (ventaIds.length > 0) {
      const { data: dets } = await supabase
        .from('ventas_detalle')
        .select('*, productos(nombre, codigo_barras)')
        .in('venta_id', ventaIds)
      detallesData = dets || []
    }
    
    // Get transacciones for almacen data
    let transaccionesData: { almacen_id: number; referencia_id: number; cantidad: number; costo_o_precio_unitario: number }[] = []
    if (ventaIds.length > 0) {
      const { data: trans } = await supabase
        .from('transacciones_inventario')
        .select('almacen_id, referencia_id, cantidad, costo_o_precio_unitario')
        .eq('tipo_movimiento', 'Salida Venta')
        .in('referencia_id', ventaIds)
      transaccionesData = trans || []
    }
    
    // Get almacenes
    const { data: almacenesData } = await supabase.from('almacenes').select('id, nombre')
    
    // Calculate KPIs
    const ventasTotales = (ventasData || []).reduce((acc, v) => acc + v.total_venta, 0)
    const gananciaBruta = detallesData.reduce((acc, d) => acc + (d.utilidad_linea || 0), 0)
    const cantidadFacturas = (ventasData || []).length
    const ticketPromedio = cantidadFacturas > 0 ? ventasTotales / cantidadFacturas : 0
    const unidadesVendidas = detallesData.reduce((acc, d) => acc + d.cantidad, 0)
    const margenPromedio = ventasTotales > 0 ? (gananciaBruta / ventasTotales) * 100 : 0
    
    // Monthly trend (get all ventas for comparison)
    const now = new Date()
    const mesActual = now.getMonth() + 1
    const anioActual = now.getFullYear()
    
    let trendQuery = supabase
      .from('ventas_encabezado')
      .select('total_venta, fecha_venta')
    if (tenantId != null) trendQuery = trendQuery.eq('razon_social_id', tenantId)
    if (filtrarVigentesActivo()) trendQuery = trendQuery.is('anulada_at', null)
    const { data: ventasTrendData } = await trendQuery
    
    const ventasMesActual = (ventasTrendData || [])
      .filter(v => {
        const f = new Date(v.fecha_venta)
        return f.getMonth() + 1 === mesActual && f.getFullYear() === anioActual
      })
      .reduce((acc, v) => acc + v.total_venta, 0)
    
    const mesAnterior = mesActual === 1 ? 12 : mesActual - 1
    const anioMesAnterior = mesActual === 1 ? anioActual - 1 : anioActual
    const ventasMesAnterior = (ventasTrendData || [])
      .filter(v => {
        const f = new Date(v.fecha_venta)
        return f.getMonth() + 1 === mesAnterior && f.getFullYear() === anioMesAnterior
      })
      .reduce((acc, v) => acc + v.total_venta, 0)
    
    const crecimientoMensual = ventasMesAnterior > 0 
      ? ((ventasMesActual - ventasMesAnterior) / ventasMesAnterior) * 100 
      : 0
    
    // Group by month
    const meses = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
    const ventasPorMesMap: Record<string, { ventas: number; ganancia: number; facturas: number; mesNum: number; anio: number }> = {}
    
    ;(ventasData || []).forEach(v => {
      const f = new Date(v.fecha_venta)
      const key = `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, '0')}`
      if (!ventasPorMesMap[key]) {
        ventasPorMesMap[key] = { ventas: 0, ganancia: 0, facturas: 0, mesNum: f.getMonth() + 1, anio: f.getFullYear() }
      }
      ventasPorMesMap[key].ventas += v.total_venta
      ventasPorMesMap[key].facturas += 1
      
      const dets = detallesData.filter(d => d.venta_id === v.id)
      ventasPorMesMap[key].ganancia += dets.reduce((acc, d) => acc + (d.utilidad_linea || 0), 0)
    })
    
    const ventasPorMes = Object.entries(ventasPorMesMap)
      .map(([, val]) => ({
        mes: meses[val.mesNum - 1],
        mesNum: val.mesNum,
        anio: val.anio,
        ventas: val.ventas,
        ganancia: val.ganancia,
        facturas: val.facturas
      }))
      .sort((a, b) => a.anio * 100 + a.mesNum - (b.anio * 100 + b.mesNum))
    
    // Group by year.
    // Usamos `ventasTrendData` (todos los encabezados del tenant sin filtro
    // de fecha) para el total de ventas del anio, y cruzamos con los
    // detalles filtrados para obtener la ganancia real por anio.
    // Para los anios cubiertos por el filtro de fecha (`ventasData`),
    // la ganancia proviene de `detallesData` (que ya incluye utilidad_linea).
    // Para los demas anios presentes en ventasTrendData que NO esten en el
    // filtro actual, hacemos una query batch de sus detalles.
    const aniosEnFiltro = new Set((ventasData || []).map(v => {
      return new Date(v.fecha_venta).getFullYear()
    }))

    // IDs de ventas que estan en trendData pero fuera del filtro principal.
    const ventaIdsFiltro = new Set(ventaIds)
    const ventasTrendFuera = (ventasTrendData || []).filter(v => {
      const id = (v as { id?: number }).id
      return id != null && !ventaIdsFiltro.has(id)
    })
    const idsFuera = ventasTrendFuera
      .map(v => (v as { id?: number }).id)
      .filter((id): id is number => id != null)

    let detsFueraData: { venta_id: number; utilidad_linea: number | null }[] = []
    if (idsFuera.length > 0) {
      const { data: df } = await supabase
        .from('ventas_detalle')
        .select('venta_id, utilidad_linea')
        .in('venta_id', idsFuera)
      detsFueraData = df || []
    }

    // Mapa de ganancia por venta_id (union de detallesData + detsFueraData).
    const gananciaPorVenta: Record<number, number> = {}
    for (const d of detallesData) {
      gananciaPorVenta[d.venta_id] = (gananciaPorVenta[d.venta_id] || 0) + (d.utilidad_linea || 0)
    }
    for (const d of detsFueraData) {
      gananciaPorVenta[d.venta_id] = (gananciaPorVenta[d.venta_id] || 0) + (d.utilidad_linea || 0)
    }

    // Ahora iteramos ventasTrendData completo para tener todos los anios.
    // ventasTrendData solo tiene total_venta + fecha_venta, necesitamos id.
    // Re-hacemos la query trend incluyendo `id`.
    let trendConIdQuery = supabase
      .from('ventas_encabezado')
      .select('id, total_venta, fecha_venta')
    if (tenantId != null) trendConIdQuery = trendConIdQuery.eq('razon_social_id', tenantId)
    if (filtrarVigentesActivo()) trendConIdQuery = trendConIdQuery.is('anulada_at', null)
    const { data: trendConId } = await trendConIdQuery

    const ventasPorAnioMap: Record<number, { ventas: number; ganancia: number; facturas: number }> = {}
    ;(trendConId || []).forEach(v => {
      const f = new Date(v.fecha_venta)
      const yr = f.getFullYear()
      if (!ventasPorAnioMap[yr]) {
        ventasPorAnioMap[yr] = { ventas: 0, ganancia: 0, facturas: 0 }
      }
      ventasPorAnioMap[yr].ventas += v.total_venta
      ventasPorAnioMap[yr].facturas += 1
      ventasPorAnioMap[yr].ganancia += gananciaPorVenta[v.id] || 0
    })
    
    const ventasPorAnio = Object.entries(ventasPorAnioMap)
      .map(([yr, val]) => ({
        anio: parseInt(yr),
        ventas: val.ventas,
        ganancia: val.ganancia,
        facturas: val.facturas
      }))
      .sort((a, b) => a.anio - b.anio)
    
    // Top Clientes
    const clienteMap: Record<number, { nombre: string; ventas: number; facturas: number; ganancia: number }> = {}
    ;(ventasData || []).forEach(v => {
      if (!clienteMap[v.cliente_id]) {
        // El join puede venir tipado como objeto o arreglo segun el parser.
        const cliente = Array.isArray(v.clientes) ? v.clientes[0] : v.clientes
        clienteMap[v.cliente_id] = { nombre: cliente?.nombre || 'Desconocido', ventas: 0, facturas: 0, ganancia: 0 }
      }
      clienteMap[v.cliente_id].ventas += v.total_venta
      clienteMap[v.cliente_id].facturas += 1
      
      const dets = detallesData.filter(d => d.venta_id === v.id)
      clienteMap[v.cliente_id].ganancia += dets.reduce((acc, d) => acc + (d.utilidad_linea || 0), 0)
    })
    
    const topClientes = Object.entries(clienteMap)
      .map(([id, val]) => ({
        id: parseInt(id),
        nombre: val.nombre,
        ventas: val.ventas,
        facturas: val.facturas,
        ganancia: val.ganancia
      }))
      .sort((a, b) => b.ventas - a.ventas)
      .slice(0, 10)
    
    // Top Productos (excluye lineas de Venta Rapida sin producto)
    const productoMap: Record<number, { nombre: string; codigo: string; cantidad: number; ventas: number; ganancia: number }> = {}
    detallesData.forEach(d => {
      if (d.producto_id == null) return
      if (!productoMap[d.producto_id]) {
        productoMap[d.producto_id] = {
          nombre: (d as { productos?: { nombre?: string } }).productos?.nombre || 'Desconocido',
          codigo: (d as { productos?: { codigo_barras?: string } }).productos?.codigo_barras || '',
          cantidad: 0,
          ventas: 0,
          ganancia: 0
        }
      }
      productoMap[d.producto_id].cantidad += d.cantidad
      productoMap[d.producto_id].ventas += d.cantidad * d.precio_unitario
      productoMap[d.producto_id].ganancia += d.utilidad_linea || 0
    })
    
    const topProductos = Object.entries(productoMap)
      .map(([id, val]) => ({
        id: parseInt(id),
        nombre: val.nombre,
        codigo: val.codigo,
        cantidad: val.cantidad,
        ventas: val.ventas,
        ganancia: val.ganancia
      }))
      .sort((a, b) => b.ventas - a.ventas)
      .slice(0, 10)
    
    // Top Almacenes
    const almacenVentas: Record<number, { ventas: number; facturas: Set<number> }> = {}
    transaccionesData.forEach(t => {
      if (!almacenVentas[t.almacen_id]) {
        almacenVentas[t.almacen_id] = { ventas: 0, facturas: new Set() }
      }
      almacenVentas[t.almacen_id].ventas += t.costo_o_precio_unitario * Math.abs(t.cantidad)
      almacenVentas[t.almacen_id].facturas.add(t.referencia_id)
    })
    
    const topAlmacenes = Object.entries(almacenVentas)
      .map(([id, val]) => {
        const almacen = (almacenesData || []).find(a => a.id === parseInt(id))
        return {
          id: parseInt(id),
          nombre: almacen?.nombre || `Almacen ${id}`,
          ventas: val.ventas,
          facturas: val.facturas.size
        }
      })
      .sort((a, b) => b.ventas - a.ventas)
      .slice(0, 5)
    
    return {
      data: {
        ventasTotales,
        gananciaBruta,
        ticketPromedio,
        cantidadFacturas,
        unidadesVendidas,
        margenPromedio,
        ventasMesActual,
        ventasMesAnterior,
        crecimientoMensual,
        ventasPorMes,
        ventasPorAnio,
        topClientes,
        topProductos,
        topAlmacenes,
        clientesActivos: Object.keys(clienteMap).length,
        productosVendidos: Object.keys(productoMap).length
      },
      error: null
    }
  } catch (err) {
    console.error('[Supabase] Error obteniendo dashboard:', err)
    return { data: null, error: 'Error de conexion' }
  }
}

// ==================== RAZON SOCIAL FOR PDF ====================

export async function getRazonSocialForPdf(): Promise<{
  nombre_empresa: string
  nombre_comercial: string
  documento: string
  direccion: string
  telefono: string
  correo: string
  logo_url?: string | null
} | null> {
  if (!isSupabaseConfigured()) {
    const saved = localStorage.getItem('razon_social')
    return saved ? JSON.parse(saved) : null
  }

  const supabase = createClient()
  if (!supabase) return null

  try {
    // Aislar por tenant: leer la razon_social del usuario autenticado, NO la
    // primera fila global (antes usaba .order('id').limit(1), lo que en
    // multi-empresa devolvia los datos fiscales de OTRA empresa en el PDF).
    let razonSocialId: number | null = null
    try {
      const { data: { user: authUser } } = await supabase.auth.getUser()
      if (authUser) {
        const { data: perfil } = await supabase
          .from('usuarios')
          .select('razon_social_id')
          .eq('id', authUser.id)
          .single()
        razonSocialId = perfil?.razon_social_id ?? null
      }
    } catch { /* sin sesion: cae al fallback de abajo */ }

    let query = supabase.from('razon_social').select('*')
    query = razonSocialId != null
      ? query.eq('id', razonSocialId)
      : query.order('id', { ascending: true }).limit(1)
    const { data, error } = await query.single()

    if (error) {
      console.error('Error fetching razon_social:', error)
      return null
    }
    return data
  } catch (err) {
    console.error('Exception fetching razon_social:', err)
    return null
  }
}

/**
 * Elimina una venta y TODOS sus movimientos asociados (detalles, pagos,
 * reversion de inventario, asientos de caja y bancos).
 *
 * La eliminacion se hace en TypeScript (no via RPC SQL) para mantener el
 * control del esquema real: revierte el stock sumando de vuelta la cantidad
 * vendida y borra los movimientos de inventario relacionando
 * `ventas_detalle.venta_id` con `transacciones_inventario.referencia_id`
 * (mas el `producto_id` de cada linea). Tambien revierte la tesoreria
 * (caja chica y cuentas bancarias) por `ref_tipo='venta'` + `ref_id`.
 *
 * Guard multi-empresa: CADA lectura, UPDATE y DELETE se acota por
 * `razon_social_id = sesion`, de modo que una empresa jamas pueda borrar ni
 * alterar datos (ventas, inventario, productos, tesoreria) de otra.
 */
/**
 * Revierte TODOS los efectos colaterales de una venta SIN borrar el
 * encabezado ni el detalle: devuelve el inventario, revierte la tesoreria
 * (caja chica y bancos, incluyendo abonos posteriores que comparten
 * `ref_tipo='venta'`) y borra los registros de pago. Lo comparten
 * `eliminarVentaCompletamente` (que luego borra detalle+encabezado) y
 * `editarVenta` (que luego re-aplica con los datos nuevos).
 *
 * `stamp` debe ser un TenantStamp valido; todo va acotado a su razon social.
 */
async function revertirEfectosVenta(
  supabase: ReturnType<typeof createClient> & object,
  ventaId: number,
  stamp: { razon_social_id: number | null; usuario: string | null }
): Promise<{ error: string | null }> {
  // ----- 1. Revertir inventario por cada linea de la venta ---------------
  const { data: detalles, error: detErr } = await supabase
    .from('ventas_detalle')
    .select('producto_id, cantidad')
    .eq('venta_id', ventaId)
    .eq('razon_social_id', stamp.razon_social_id)
  if (detErr) return { error: detErr.message }

  for (const linea of detalles ?? []) {
    // Las lineas de Venta Rapida (producto_id NULL) no movieron inventario.
    if (linea.producto_id == null) continue
    await ajustarStock(supabase, linea.producto_id, linea.cantidad || 0, stamp.razon_social_id)
    await supabase
      .from('transacciones_inventario')
      .delete()
      .eq('referencia_id', ventaId)
      .eq('producto_id', linea.producto_id)
      .eq('tipo_movimiento', 'Salida Venta')
      .eq('razon_social_id', stamp.razon_social_id)
  }
  // Barrido de seguridad: cualquier 'Salida Venta' restante de esta venta.
  await supabase
    .from('transacciones_inventario')
    .delete()
    .eq('referencia_id', ventaId)
    .eq('tipo_movimiento', 'Salida Venta')
    .eq('razon_social_id', stamp.razon_social_id)

  // ----- 2. Revertir tesoreria (bancos + caja) ---------------------------
  // Cuentas bancarias afectadas por esta venta (para recalcular su cadena de
  // saldos DESPUES de borrar sus movimientos).
  const { data: movsCuenta } = await supabase
    .from('cuenta_movimientos')
    .select('cuenta_id')
    .eq('ref_tipo', 'venta')
    .eq('ref_id', ventaId)
    .eq('razon_social_id', stamp.razon_social_id)
  const cuentasAfectadas = [...new Set((movsCuenta ?? []).map((m) => Number(m.cuenta_id)))]

  await supabase
    .from('cuenta_movimientos')
    .delete()
    .eq('ref_tipo', 'venta')
    .eq('ref_id', ventaId)
    .eq('razon_social_id', stamp.razon_social_id)

  await supabase
    .from('caja_chica_movimientos')
    .delete()
    .eq('ref_tipo', 'venta')
    .eq('ref_id', ventaId)
    .eq('razon_social_id', stamp.razon_social_id)

  // Recalcula el saldo REAL (cadena + cache) de cada cuenta afectada. Asi el
  // saldo y la lista de Movimientos no quedan con "fotos" viejas que incluyan
  // la venta borrada. La caja chica no necesita esto: su saldo se calcula como
  // suma de montos y su lista se recalcula al leerse (getMovimientosSesion).
  for (const cId of cuentasAfectadas) {
    await recalcCadenaSaldoCuenta(cId)
  }

  // ----- 3. Borrar registros de pago -------------------------------------
  await supabase
    .from('ventas_pagos_detalle')
    .delete()
    .eq('venta_id', ventaId)
    .eq('razon_social_id', stamp.razon_social_id)
  await supabase
    .from('pagos_ventas')
    .delete()
    .eq('venta_id', ventaId)
    .eq('razon_social_id', stamp.razon_social_id)

  return { error: null }
}

export async function eliminarVentaCompletamente(
  ventaId: number,
  motivo?: string
): Promise<{ error: string | null }> {
  const supabase = createClient()
  if (!supabase) return { error: 'Cliente no disponible' }

  try {
    const stamp = await getTenantStamp(supabase)
    if (!isValidStamp(stamp)) {
      return { error: SESION_INVALIDA_ERROR }
    }

    // Motivo obligatorio: la eliminacion queda registrada en ventas_eliminadas.
    const motivoLimpio = (motivo || '').trim()
    if (!motivoLimpio) {
      return { error: 'Indica el motivo de la eliminación.' }
    }

    // ----- 0. Verificar que la venta exista y pertenezca al tenant ---------
    // Traemos el encabezado COMPLETO para el snapshot de trazabilidad.
    const { data: venta, error: ventaErr } = await supabase
      .from('ventas_encabezado')
      .select('*')
      .eq('id', ventaId)
      .single()

    if (ventaErr || !venta) {
      return { error: 'La venta no existe' }
    }
    if (venta.razon_social_id !== stamp.razon_social_id) {
      return { error: 'La venta no pertenece a la empresa activa' }
    }

    // ----- 0.0 Candados (script officemart-003) -----------------------------
    // Una venta anulada, con abonos por recibo o con asientos conciliados no
    // se borra: su historia debe conservarse ("usa Anular").
    const candado = await candadoBorradoVenta(supabase, venta as VentaEncabezado)
    if (candado) return { error: candado }

    // ----- 0.a Snapshot ANTES de borrar (encabezado + lineas + pagos) ------
    // Se guarda en ventas_eliminadas al final. Best-effort: si la tabla 059 no
    // existe, no bloquea la eliminacion (solo se pierde la trazabilidad).
    const [detSnap, pagosSnap, abonosSnap] = await Promise.all([
      supabase.from('ventas_detalle').select('*').eq('venta_id', ventaId),
      supabase.from('ventas_pagos_detalle').select('*').eq('venta_id', ventaId),
      supabase.from('pagos_ventas').select('*').eq('venta_id', ventaId),
    ])
    // Nombre del cliente para mostrar en la lista sin abrir el JSON.
    let clienteNombre: string | null = null
    if (venta.cliente_id != null) {
      const { data: cli } = await supabase.from('clientes').select('nombre').eq('id', venta.cliente_id).maybeSingle()
      clienteNombre = (cli?.nombre as string) ?? null
    }
    const snapshot = {
      encabezado: venta,
      detalle: detSnap.data ?? [],
      pagos: pagosSnap.data ?? [],
      abonos: abonosSnap.data ?? [],
    }

    // ----- 0.b Deshacer las devoluciones asociadas (si las hay) -------------
    // La devolucion ya devolvio stock (+cantidad) y dinero de ESTA venta. Antes
    // de revertir la venta hay que DESHACER cada devolucion (restar de vuelta el
    // stock que repuso, revertir su reembolso de caja/banco y borrarla). Asi al
    // revertir la venta no queda el stock inflado ni movimientos huerfanos.
    const revDev = await revertirDevolucionesDeVenta(supabase, ventaId, stamp.razon_social_id!)
    if (revDev.error) return { error: `No se pudieron revertir las devoluciones: ${revDev.error}` }

    // ----- 1-3. Revertir inventario, tesoreria y pagos ---------------------
    const rev = await revertirEfectosVenta(supabase, ventaId, stamp)
    if (rev.error) return { error: rev.error }

    // ----- 4. Borrar detalle y encabezado ----------------------------------
    const { error: delDetErr } = await supabase
      .from('ventas_detalle')
      .delete()
      .eq('venta_id', ventaId)
      .eq('razon_social_id', stamp.razon_social_id)
    if (delDetErr) {
      console.error('[eliminarVentaCompletamente] Error borrando detalle:', delDetErr)
      return { error: delDetErr.message }
    }

    const { error: delEncErr } = await supabase
      .from('ventas_encabezado')
      .delete()
      .eq('id', ventaId)
      .eq('razon_social_id', stamp.razon_social_id)
    if (delEncErr) {
      console.error('[eliminarVentaCompletamente] Error borrando encabezado:', delEncErr)
      return { error: delEncErr.message }
    }

    // ----- 5. Registrar la factura eliminada (trazabilidad) ----------------
    // Best-effort: si la tabla 059 no existe todavia, no rompe la eliminacion.
    const { error: elimErr } = await supabase.from('ventas_eliminadas').insert({
      venta_id: ventaId,
      numero_factura: venta.numero_factura ?? null,
      cliente_id: venta.cliente_id ?? null,
      cliente_nombre: clienteNombre,
      fecha_venta: venta.fecha_venta ?? null,
      total_venta: venta.total_venta ?? null,
      estado_pago: venta.estado_pago ?? null,
      snapshot,
      motivo: motivoLimpio,
      eliminado_at: getHondurasNowISO(),
      ...stamp,
    })
    if (elimErr && !esTablaInexistente(elimErr)) {
      // La venta ya se borro; solo avisamos que no se guardo el registro.
      console.warn('[eliminarVentaCompletamente] no se registro en ventas_eliminadas:', elimErr.message)
    }

    return { error: null }
  } catch (err) {
    console.error('[eliminarVentaCompletamente] Exception:', err)
    return { error: 'No se pudo eliminar la venta' }
  }
}

// ==================== ANULACIÓN (compensar, no borrar) ====================

/**
 * Motivo por el que una venta NO puede borrarse ni editarse físicamente (o
 * null si puede). Best-effort: si las tablas/columnas del script 003 no
 * existen, no bloquea.
 */
async function candadoBorradoVenta(
  supabase: NonNullable<ReturnType<typeof createClient>>,
  venta: VentaEncabezado
): Promise<string | null> {
  if (venta.anulada_at) return 'Esta factura ya está anulada; no se puede borrar ni editar.'
  const { count: recibos } = await supabase
    .from('pagos_ventas')
    .select('id', { count: 'exact', head: true })
    .eq('venta_id', venta.id!)
    .not('recibo_id', 'is', null)
  if ((recibos || 0) > 0) {
    return 'Esta factura tiene abonos por recibo de cobro. Anula primero el recibo, o anula la factura en vez de borrarla.'
  }
  const { count: conciliados } = await supabase
    .from('cuenta_movimientos')
    .select('id', { count: 'exact', head: true })
    .eq('ref_tipo', 'venta')
    .eq('ref_id', venta.id!)
    .not('conciliado_at', 'is', null)
  if ((conciliados || 0) > 0) {
    return 'Esta factura tiene movimientos bancarios ya conciliados. Usa Anular (registra contra-asientos) en vez de borrar.'
  }
  return null
}

/**
 * Regla de anulación (pura). Devuelve el motivo por el que NO se puede anular
 * la venta, o null si procede.
 */
export function validarAnulacion(input: {
  anulada?: boolean
  devolucionesVigentes?: number
  abonosConRecibo?: number
  valorpago?: number
  reembolso?: { destino: 'caja' | 'cuenta'; cuenta_id?: number | null } | null
  motivo?: string | null
}): string | null {
  if (!(input.motivo || '').trim()) return 'Indica el motivo de la anulación.'
  if (input.anulada) return 'La venta ya está anulada.'
  if ((input.devolucionesVigentes || 0) > 0) {
    return 'La venta tiene devoluciones vigentes. Anula primero la devolución.'
  }
  if ((input.abonosConRecibo || 0) > 0) {
    return 'La venta tiene abonos por recibo de cobro. Anula primero el recibo.'
  }
  const pagado = Number(input.valorpago || 0)
  if (pagado > 0.005) {
    if (!input.reembolso) return 'La venta tiene dinero cobrado: indica a dónde se devuelve (caja o cuenta).'
    if (input.reembolso.destino === 'cuenta' && !input.reembolso.cuenta_id) {
      return 'Selecciona la cuenta bancaria del reembolso.'
    }
  }
  return null
}

/**
 * ANULA una venta conservando su documento: registra contra-asientos (el
 * stock vuelve a entrar; el dinero cobrado sale de caja/cuenta) y marca
 * `anulada_at`. NO toca detalle, pagos ni valorpago: la factura queda como
 * foto histórica y deja de contar en reportes (filtro `anulada_at IS NULL`).
 * Con CAI el documento nunca se borra: se anula o se emite nota de crédito.
 */
export async function anularVenta(
  ventaId: number,
  input: {
    motivo: string
    tipo?: 'Anulacion' | 'Reclamo'
    reclamo_id?: number | null
    /** Obligatorio si la venta tiene dinero cobrado (valorpago > 0). */
    reembolso?: { destino: 'caja' | 'cuenta'; cuenta_id?: number | null } | null
  }
): Promise<{ error: string | null }> {
  if (!isSupabaseConfigured()) return { error: 'Supabase no configurado' }
  const supabase = createClient()
  if (!supabase) return { error: 'Cliente no disponible' }

  try {
    const stamp = await getTenantStamp(supabase)
    if (!isValidStamp(stamp)) return { error: SESION_INVALIDA_ERROR }

    const { data: venta, error: vErr } = await supabase
      .from('ventas_encabezado')
      .select('*')
      .eq('id', ventaId)
      .single()
    if (vErr || !venta) return { error: 'La venta no existe' }
    if (venta.razon_social_id !== stamp.razon_social_id) return { error: 'La venta no pertenece a la empresa activa' }

    // Contexto para la regla (best-effort: tablas del 003/020 pueden no existir).
    const [{ count: devVigentes }, { count: abonosRecibo }] = await Promise.all([
      supabase.from('devoluciones_encabezado').select('id', { count: 'exact', head: true }).eq('venta_id', ventaId).is('anulada_at', null),
      supabase.from('pagos_ventas').select('id', { count: 'exact', head: true }).eq('venta_id', ventaId).not('recibo_id', 'is', null),
    ])
    const invalido = validarAnulacion({
      anulada: !!venta.anulada_at,
      devolucionesVigentes: devVigentes || 0,
      abonosConRecibo: abonosRecibo || 0,
      valorpago: Number(venta.valorpago || 0),
      reembolso: input.reembolso ?? null,
      motivo: input.motivo,
    })
    if (invalido) return { error: invalido }
    const motivoLimpio = input.motivo.trim()

    // 1) Marcar (idempotente): si otra sesión ya la anuló, no hay doble compensación.
    const { data: marcada, error: mErr } = await supabase
      .from('ventas_encabezado')
      .update({
        anulada_at: getHondurasNowISO(),
        anulada_por: stamp.usuario,
        motivo_anulacion: motivoLimpio,
        anulacion_tipo: input.tipo || 'Anulacion',
        reclamo_id: input.reclamo_id ?? null,
      })
      .eq('id', ventaId)
      .is('anulada_at', null)
      .select('id')
    if (mErr) {
      if (/anulada_at|anulacion_tipo|reclamo_id/i.test(mErr.message || '')) {
        return { error: 'Anulación pendiente: aplica scripts/officemart-003-anulacion-recibos.sql en Supabase.' }
      }
      return { error: mErr.message }
    }
    if (!marcada || marcada.length === 0) return { error: 'La venta ya está anulada.' }

    // 2) Contra-asientos.
    const comp = await compensarEfectosVenta(supabase, venta as VentaEncabezado, stamp, input.reembolso ?? null, motivoLimpio)

    // 3) Bitácora.
    await registrarAuditoria(supabase, stamp, {
      entidad: 'venta',
      entidad_id: ventaId,
      accion: comp.error ? 'anulacion_incompleta' : 'anular',
      motivo: motivoLimpio,
      antes: { numero_factura: venta.numero_factura, total_venta: venta.total_venta, valorpago: venta.valorpago, estado_pago: venta.estado_pago, numero_fiscal: venta.numero_fiscal ?? null },
      despues: comp.error ? { error: comp.error } : undefined,
    })

    if (comp.error) {
      return { error: `La factura quedó anulada, pero falló parte de la compensación: ${comp.error}. Regulariza en Inventario/Finanzas.` }
    }
    return { error: null }
  } catch (err) {
    console.error('[anularVenta] Exception:', err)
    return { error: 'No se pudo anular la venta' }
  }
}

/**
 * Contra-asientos de una venta anulada (hermana de `revertirEfectosVenta`,
 * que BORRA; esta AGREGA):
 *   - Inventario: por cada línea con producto, `ajustarStock(+cantidad)` y
 *     kardex 'Entrada Anulacion' (fallback 'Ingreso Manual') con
 *     referencia_id = venta y referencia_tipo = 'anulacion_venta', en el
 *     almacén/localización de la salida original.
 *   - Dinero: si hubo cobro (valorpago > 0), 'Salida' de caja o 'Egreso' de
 *     cuenta por ese monto con ref_tipo='anulacion_venta'.
 */
async function compensarEfectosVenta(
  supabase: NonNullable<ReturnType<typeof createClient>>,
  venta: VentaEncabezado,
  stamp: { razon_social_id: number | null; usuario: string | null },
  reembolso: { destino: 'caja' | 'cuenta'; cuenta_id?: number | null } | null,
  motivo: string
): Promise<{ error: string | null }> {
  const ventaId = venta.id!
  const errores: string[] = []

  // ----- Inventario -------------------------------------------------------
  const [{ data: detalles }, { data: salidas }] = await Promise.all([
    supabase.from('ventas_detalle').select('producto_id, cantidad, costo_promedio_momento').eq('venta_id', ventaId).eq('razon_social_id', stamp.razon_social_id),
    supabase.from('transacciones_inventario').select('producto_id, almacen_id, localizacion_id').eq('referencia_id', ventaId).eq('tipo_movimiento', 'Salida Venta').eq('razon_social_id', stamp.razon_social_id),
  ])
  const ubicacion = new Map<number, { almacen_id: number; localizacion_id: number }>()
  for (const s of salidas || []) if (!ubicacion.has(s.producto_id)) ubicacion.set(s.producto_id, { almacen_id: s.almacen_id, localizacion_id: s.localizacion_id })

  for (const linea of detalles || []) {
    if (linea.producto_id == null) continue // Venta Rápida: no movió inventario
    const cant = Number(linea.cantidad || 0)
    if (cant <= 0) continue
    const aj = await ajustarStock(supabase, linea.producto_id, cant, stamp.razon_social_id)
    if (aj.error) errores.push(`stock producto ${linea.producto_id}: ${aj.error}`)
    const u = ubicacion.get(linea.producto_id)
    const fila = {
      producto_id: linea.producto_id,
      almacen_id: u?.almacen_id ?? venta.almacen_id ?? null,
      localizacion_id: u?.localizacion_id ?? null,
      tipo_movimiento: 'Entrada Anulacion',
      cantidad: cant,
      costo_o_precio_unitario: Number(linea.costo_promedio_momento || 0),
      referencia_id: ventaId,
      referencia_tipo: 'anulacion_venta',
      fecha: getHondurasNowISO(),
      ...stamp,
    }
    let { error: kErr } = await supabase.from('transacciones_inventario').insert(fila)
    if (kErr) {
      // CHECK del tipo o columna referencia_tipo ausente: reintento compatible.
      const { referencia_tipo: _rt, ...sinRefTipo } = fila
      const retry = await supabase.from('transacciones_inventario').insert({ ...sinRefTipo, tipo_movimiento: 'Ingreso Manual' })
      kErr = retry.error
    }
    if (kErr) errores.push(`kardex producto ${linea.producto_id}: ${kErr.message}`)
  }

  // ----- Dinero -----------------------------------------------------------
  const pagado = +Number(venta.valorpago || 0).toFixed(2)
  if (pagado > 0.005 && reembolso) {
    const concepto = `Anulación ${venta.numero_factura}: ${motivo}`
    if (reembolso.destino === 'caja') {
      const r = await registrarMovimientoCaja({ tipo: 'Salida', monto: pagado, concepto, ref_tipo: 'anulacion_venta', ref_id: ventaId })
      if (r.error) errores.push(`reembolso caja: ${r.error}`)
    } else if (reembolso.cuenta_id) {
      const r = await registrarMovimientoCuenta({ cuenta_id: reembolso.cuenta_id, tipo: 'Egreso', monto: pagado, concepto, ref_tipo: 'anulacion_venta', ref_id: ventaId })
      if (r.error) errores.push(`reembolso cuenta: ${r.error}`)
    }
  }

  return { error: errores.length ? errores.join(' · ') : null }
}

// ==================== FACTURAS ELIMINADAS (trazabilidad) ====================

/** Una factura eliminada (registro de auditoria). */
export interface VentaEliminada {
  id: number
  venta_id: number | null
  numero_factura: string | null
  cliente_nombre: string | null
  fecha_venta: string | null
  total_venta: number | null
  estado_pago: string | null
  motivo: string
  usuario: string | null
  eliminado_at: string
  snapshot: {
    encabezado?: Record<string, unknown>
    detalle?: Record<string, unknown>[]
    pagos?: Record<string, unknown>[]
    abonos?: Record<string, unknown>[]
  }
}

/** Lista las facturas eliminadas del tenant (más reciente arriba). */
export async function getVentasEliminadas(
  opts: { limit?: number } = {}
): Promise<{ data: VentaEliminada[]; error: string | null }> {
  if (!isSupabaseConfigured()) return { data: [], error: null }
  const supabase = createClient()
  if (!supabase) return { data: [], error: 'Cliente no disponible' }

  const { data, error } = await supabase
    .from('ventas_eliminadas')
    .select('id, venta_id, numero_factura, cliente_nombre, fecha_venta, total_venta, estado_pago, motivo, usuario, eliminado_at, snapshot')
    .order('eliminado_at', { ascending: false })
    .limit(opts.limit ?? 300)
  if (error) {
    // Tabla 059 pendiente: degradamos a lista vacia (sin error).
    if (esTablaInexistente(error)) return { data: [], error: null }
    return { data: [], error: error.message }
  }
  return { data: (data || []) as VentaEliminada[], error: null }
}

// ==================== EDITAR VENTA ====================

/**
 * Recupera el almacen y localizacion originales de una venta desde su
 * movimiento de inventario ('Salida Venta'). `ventas_encabezado` guarda
 * `almacen_id` pero NO `localizacion_id`, que vive en transacciones.
 */
export async function getLocalizacionVenta(
  ventaId: number
): Promise<{ almacen_id: number | null; localizacion_id: number | null }> {
  const supabase = createClient()
  if (!supabase) return { almacen_id: null, localizacion_id: null }
  const { data } = await supabase
    .from('transacciones_inventario')
    .select('almacen_id, localizacion_id')
    .eq('referencia_id', ventaId)
    .eq('tipo_movimiento', 'Salida Venta')
    .limit(1)
    .maybeSingle()
  return {
    almacen_id: data?.almacen_id ?? null,
    localizacion_id: data?.localizacion_id ?? null,
  }
}

/**
 * Desglose de pago inicial de una venta (`ventas_pagos_detalle`). Sirve para
 * sembrar el formulario de edicion con los pagos originales.
 */
export async function getPagosDetalleVenta(
  ventaId: number
): Promise<{ data: PagoVentaDetalle[]; error: string | null }> {
  if (!isSupabaseConfigured()) return { data: [], error: null }
  const supabase = createClient()
  if (!supabase) return { data: [], error: 'Cliente no disponible' }

  const { data, error } = await supabase
    .from('ventas_pagos_detalle')
    .select('id, venta_id, metodo_pago, cuenta_id, monto_bruto, porcentaje_comision, monto_neto')
    .eq('venta_id', ventaId)
    .order('id', { ascending: true })

  if (error) {
    if (esTablaInexistente(error)) return { data: [], error: null }
    return { data: [], error: error.message }
  }
  return { data: (data || []) as PagoVentaDetalle[], error: null }
}

export interface EditarVentaData {
  encabezado: {
    cliente_id: number
    aplica_impuesto: boolean
    porcentaje_impuesto: number
    descuento?: number
    subtotal: number
    impuesto_total: number
    total_venta: number
  }
  detalles: Omit<VentaDetalle, 'id' | 'venta_id' | 'producto_nombre' | 'producto_codigo'>[]
  pagos_detalle?: PagoVentaDetalleInput[]
  motivo?: string
}

/**
 * Edita una venta EN SU LUGAR (mismo venta_id y numero de factura),
 * propagando el cambio a inventario, caja chica, cuentas bancarias y CxC.
 *
 * Estrategia reversar-y-recrear: revierte por completo los efectos de la
 * venta actual (`revertirEfectosVenta`) y re-aplica con los datos nuevos,
 * usando los MISMOS primitivos que `crearVenta`. Conserva el encabezado
 * (no lo borra), asi las referencias externas (devoluciones, pedidos) no se
 * rompen.
 *
 * Bloqueos: si la factura tiene devoluciones, o si lleva efectivo y no hay
 * caja abierta. Reversa tambien los abonos posteriores (comparten
 * ref_tipo='venta'); el usuario los vuelve a registrar si aplica.
 */
export async function editarVenta(
  ventaId: number,
  data: EditarVentaData
): Promise<{ error: string | null }> {
  if (!isSupabaseConfigured()) return { error: 'Supabase no configurado' }
  const supabase = createClient()
  if (!supabase) return { error: 'Cliente no disponible' }

  try {
    const stamp = await getTenantStamp(supabase)
    if (!isValidStamp(stamp)) return { error: SESION_INVALIDA_ERROR }

    // 0. La venta debe existir y ser del tenant.
    const { data: venta, error: vErr } = await supabase
      .from('ventas_encabezado')
      .select('*')
      .eq('id', ventaId)
      .single()
    if (vErr || !venta) return { error: 'La venta no existe' }
    if (venta.razon_social_id !== stamp.razon_social_id) {
      return { error: 'La venta no pertenece a la empresa activa' }
    }
    // Candados del script officemart-003 (anulada, recibos, conciliados).
    const candado = await candadoBorradoVenta(supabase, venta as VentaEncabezado)
    if (candado) return { error: candado }

    // 1. Bloqueo: no editar si la factura tiene devoluciones (conflicto
    //    logico: la devolucion ya reverso inventario/dinero de esta venta).
    const { count: devCount, error: devErr } = await supabase
      .from('devoluciones_encabezado')
      .select('id', { count: 'exact', head: true })
      .eq('venta_id', ventaId)
    if (!devErr && (devCount || 0) > 0) {
      return {
        error: 'Esta factura tiene devoluciones asociadas. Anula la devolución o crea una venta nueva.',
      }
    }

    const pagosDetalle = data.pagos_detalle ?? []

    // 2. Si hay efectivo en el nuevo pago, exige caja abierta.
    const efectivo = pagosDetalle
      .filter((p) => p.metodo_pago === 'Efectivo')
      .reduce((a, p) => a + Number(p.monto_bruto || 0), 0)
    if (efectivo > 0) {
      const { data: sesion, error: sesErr } = await getSesionAbierta()
      if (!sesErr && !sesion?.id) {
        return { error: 'Debe abrir caja antes de guardar una venta con efectivo' }
      }
    }

    // 3. Snapshot ANTES (para bitacora) y localizacion original — ambos
    //    ANTES de reversar (la reversion borra las transacciones).
    const totalVenta = Number(data.encabezado.total_venta || 0)
    const { valorpago, estado_pago } = derivarEstadoPago(pagosDetalle, totalVenta)
    const { data: antesData } = await supabase
      .from('ventas_encabezado')
      .select('total_venta, valorpago, estado_pago, cliente_id')
      .eq('id', ventaId)
      .single()
    // Almacen/localizacion originales (del movimiento 'Salida Venta'). Si la
    // venta no tenia lineas con inventario (Venta Rapida) o el movimiento no
    // guardo localizacion, caemos al almacen del encabezado. Solo se BLOQUEA si
    // la venta editada trae lineas de producto y aun asi no hay almacen.
    const locOriginal = await getLocalizacionVenta(ventaId)
    const almacen_id = locOriginal.almacen_id ?? (venta.almacen_id != null ? Number(venta.almacen_id) : null)
    const localizacion_id = locOriginal.localizacion_id
    const hayLineasProducto = data.detalles.some((d) => d.producto_id != null)
    if (hayLineasProducto && almacen_id == null) {
      return { error: 'No se pudo determinar el almacén de la venta original. Crea una venta nueva.' }
    }

    // 4. Revertir todos los efectos actuales (inventario, tesoreria, pagos).
    const rev = await revertirEfectosVenta(supabase, ventaId, stamp)
    if (rev.error) return { error: `No se pudo revertir la venta original: ${rev.error}` }

    // 5. Actualizar el encabezado (conserva numero_factura, fecha_venta, almacen).
    const { error: updErr } = await supabase
      .from('ventas_encabezado')
      .update({
        cliente_id: data.encabezado.cliente_id,
        aplica_impuesto: data.encabezado.aplica_impuesto,
        porcentaje_impuesto: data.encabezado.porcentaje_impuesto,
        descuento: data.encabezado.descuento ?? 0,
        subtotal: data.encabezado.subtotal,
        impuesto_total: data.encabezado.impuesto_total,
        total_venta: totalVenta,
        valorpago,
        estado_pago,
      })
      .eq('id', ventaId)
      .eq('razon_social_id', stamp.razon_social_id)
    if (updErr) return { error: updErr.message }

    // 6. Reemplazar el detalle. `descripcion_libre` NO es columna de
    //    ventas_detalle (va aparte en ventas_detalle_descripcion, script 045):
    //    se quita del insert y se guarda despues por indice (igual que crearVenta).
    // Primero limpiamos las descripciones libres de las lineas actuales
    // (no hay FK cascade), y luego borramos el detalle.
    const { data: detalleActual } = await supabase
      .from('ventas_detalle')
      .select('id')
      .eq('venta_id', ventaId)
      .eq('razon_social_id', stamp.razon_social_id)
    const idsActuales = (detalleActual || []).map((r: { id: number }) => r.id)
    if (idsActuales.length > 0) {
      await supabase
        .from('ventas_detalle_descripcion')
        .delete()
        .eq('razon_social_id', stamp.razon_social_id)
        .in('detalle_id', idsActuales)
    }
    await supabase
      .from('ventas_detalle')
      .delete()
      .eq('venta_id', ventaId)
      .eq('razon_social_id', stamp.razon_social_id)
    const detallesConVenta = data.detalles.map(({ descripcion_libre: _omit, ...d }) => ({
      ...d,
      venta_id: ventaId,
      razon_social_id: stamp.razon_social_id,
    }))
    const { data: detallesInsertados, error: detInsErr } = await supabase
      .from('ventas_detalle')
      .insert(detallesConVenta)
      .select('id')
    if (detInsErr) return { error: detInsErr.message }

    // 6b. Descripcion libre de las lineas de Venta Rapida (producto_id NULL).
    //     Best-effort: si el script 045 no se aplico, no rompe la edicion.
    const filasDesc: { detalle_id: number; razon_social_id: number | null; descripcion: string }[] = []
    ;(detallesInsertados || []).forEach((fila: { id: number }, i: number) => {
      const orig = data.detalles[i]
      if (orig && orig.producto_id == null && (orig.descripcion_libre || '').trim() !== '') {
        filasDesc.push({
          detalle_id: fila.id,
          razon_social_id: stamp.razon_social_id,
          descripcion: (orig.descripcion_libre as string).trim(),
        })
      }
    })
    if (filasDesc.length > 0) {
      const { error: descErr } = await supabase.from('ventas_detalle_descripcion').insert(filasDesc)
      if (descErr) console.warn('[editarVenta] no se guardo descripcion libre:', descErr.message)
    }

    // 7. Re-aplicar inventario (stock + kardex 'Salida Venta').
    // Las lineas de Venta Rapida (producto_id NULL) no afectan inventario.
    for (const d of data.detalles) {
      if (d.producto_id == null) continue
      await ajustarStock(supabase, d.producto_id, -d.cantidad, stamp.razon_social_id)
      await supabase.from('transacciones_inventario').insert({
        producto_id: d.producto_id,
        almacen_id,
        localizacion_id,
        tipo_movimiento: 'Salida Venta',
        // Salida = cantidad NEGATIVA (misma convencion que 'Traslado Salida').
        cantidad: -d.cantidad,
        costo_o_precio_unitario: d.costo_promedio_momento,
        referencia_id: ventaId,
        fecha: getHondurasNowISO(), // dia de negocio HN (kardex usa split)
        ...stamp,
      })
    }

    // 8. Re-aplicar desglose de pagos + tesoreria (mismos primitivos que crearVenta).
    if (pagosDetalle.length > 0) {
      const pagosRows = pagosDetalle.map((p) => {
        const comision = Number(p.porcentaje_comision ?? 0)
        const neto = p.monto_neto != null ? Number(p.monto_neto) : +(Number(p.monto_bruto) * (1 - comision / 100)).toFixed(2)
        return {
          venta_id: ventaId,
          metodo_pago: p.metodo_pago,
          cuenta_id: p.cuenta_id ?? null,
          monto_bruto: Number(p.monto_bruto),
          porcentaje_comision: comision,
          monto_neto: neto,
          razon_social_id: stamp.razon_social_id,
          usuario: stamp.usuario,
        }
      })
      const { error: pErr } = await supabase.from('ventas_pagos_detalle').insert(pagosRows)
      if (pErr && !esTablaInexistente(pErr)) {
        return { error: `No se pudo guardar el desglose de pago: ${pErr.message}` }
      }

      for (const p of pagosDetalle) {
        const monto = Number(p.monto_bruto)
        if (monto <= 0) continue
        if (p.metodo_pago === 'Efectivo') {
          await registrarMovimientoCaja({
            tipo: 'Ingreso_Venta',
            monto,
            concepto: `Venta #${ventaId} (${venta.numero_factura}) [editada]`,
            ref_tipo: 'venta',
            ref_id: ventaId,
          })
        } else if ((p.metodo_pago === 'Banco' || p.metodo_pago === 'Link_Pago') && p.cuenta_id) {
          const comision = Number(p.porcentaje_comision ?? 0)
          const neto = p.monto_neto != null ? Number(p.monto_neto) : +(monto * (1 - comision / 100)).toFixed(2)
          await registrarMovimientoCuenta({
            cuenta_id: p.cuenta_id,
            tipo: 'Ingreso',
            monto: neto,
            concepto: `Venta ${venta.numero_factura} (neto) [editada]`,
            ref_tipo: 'venta',
            ref_id: ventaId,
          })
        }
      }
    }

    // 9. Bitacora (best-effort; ignora si la tabla no existe).
    await supabase.from('ventas_ediciones').insert({
      venta_id: ventaId,
      numero_factura: venta.numero_factura,
      motivo: data.motivo || null,
      antes: antesData ?? null,
      despues: {
        total_venta: totalVenta,
        valorpago,
        estado_pago,
        cliente_id: data.encabezado.cliente_id,
        lineas: data.detalles.length,
      },
      ...stamp,
    })

    return { error: null }
  } catch (err) {
    console.error('[editarVenta] Exception:', err)
    return { error: 'No se pudo editar la venta' }
  }
}
