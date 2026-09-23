import { createClient, isSupabaseConfigured } from '@/lib/supabase/client'
import { getTenantStamp, isValidStamp, SESION_INVALIDA_ERROR } from '@/lib/services/tenant-stamp'
import { aplicarEntradaCompra } from '@/lib/services/stock'
import { assertInventarioNoCongelado } from '@/lib/services/inventario-candado'
import { getHondurasNowISO, getHondurasTodayISODate } from '@/lib/utils/honduras-time'
import { createGasto, getConceptosGasto, createConceptoGasto } from '@/lib/services/gastos'

// ==================== INTERFACES ====================

export interface CompraEncabezado {
  id?: number
  proveedor_id: number
  proveedor_nombre?: string
  /** Número de la factura del proveedor (recepción por factura). Script 065. */
  numero_factura?: string | null
  fecha_orden?: string  // timestamp with time zone, defaults to now()
  fecha_tentativa: string  // date
  moneda: 'LPS' | 'USD'
  tasa_cambio: number  // numeric(12,4), default 1
  costos_importacion: number  // numeric(12,2), default 0
  impuestos_compra: number  // numeric(12,2), default 0
  otros_costos: number  // numeric(12,2), default 0
  total_compra_local: number  // numeric(12,2), default 0
  subtotal?: number
  total?: number
  estado: 'Pendiente' | 'Recibida' | 'Cancelada'
  created_at?: string
  /**
   * Recepciones parciales y CxP por OC (script officemart-008). Nullable:
   * NULL en OCs anteriores al script o recibidas con el flujo clásico.
   */
  forma_pago?: 'Contado' | 'Credito' | string | null
  dias_credito?: number | null
  fecha_vencimiento?: string | null
  monto_pagado?: number | null
  estado_pago?: 'Pendiente' | 'Parcial' | 'Pagado' | string | null
  total_recibido_local?: number | null
  estado_recepcion?: 'Sin recibir' | 'Parcial' | 'Completa' | 'Cerrada' | string | null
  cerrada_at?: string | null
  motivo_cierre?: string | null
}

export interface CompraDetalle {
  id?: number
  compra_id: number
  producto_id: number
  producto_nombre?: string
  producto_codigo?: string
  cantidad: number
  cantidad_recibida?: number
  costo_unitario_moneda_origen: number
  costo_final_local?: number
}

export interface TransaccionInventario {
  id?: number
  producto_id: number
  almacen_id: number
  localizacion_id: number
  tipo_movimiento: 'Entrada Compra' | 'Salida Venta' | 'Traslado Entrada' | 'Traslado Salida' | 'Ajuste'
  cantidad: number
  costo_o_precio_unitario: number
  referencia_id: number
  fecha?: string  // defaults to now() in database
}

// ==================== ORDEN DE COMPRA ====================

export async function getCompras(estado?: string): Promise<{ data: CompraEncabezado[]; error: string | null }> {
  if (!isSupabaseConfigured()) {
    const saved = localStorage.getItem('compras_encabezado')
    let compras: CompraEncabezado[] = saved ? JSON.parse(saved) : []
    if (estado) {
      compras = compras.filter(c => c.estado === estado)
    }
    return { data: compras, error: null }
  }

  const supabase = createClient()
  if (!supabase) return { data: [], error: 'Cliente no disponible' }

  try {
    let query = supabase
      .from('compras_encabezado')
      .select(`
        *,
        proveedores (nombre)
      `)
      .order('id', { ascending: false })

    if (estado) {
      query = query.eq('estado', estado)
    }

    const { data, error } = await query

    if (error) return { data: [], error: error.message }
    
    const formattedData = (data || []).map(c => ({
      ...c,
      proveedor_nombre: c.proveedores?.nombre || ''
    }))
    
    return { data: formattedData, error: null }
  } catch (err) {
    console.error('[Supabase] Error obteniendo compras:', err)
    return { data: [], error: 'Error de conexion' }
  }
}

export async function getCompraById(id: number): Promise<{ data: CompraEncabezado | null; error: string | null }> {
  if (!isSupabaseConfigured()) {
    const saved = localStorage.getItem('compras_encabezado')
    const compras: CompraEncabezado[] = saved ? JSON.parse(saved) : []
    const compra = compras.find(c => c.id === id) || null
    return { data: compra, error: null }
  }

  const supabase = createClient()
  if (!supabase) return { data: null, error: 'Cliente no disponible' }

  try {
    const { data, error } = await supabase
      .from('compras_encabezado')
      .select(`
        *,
        proveedores (nombre)
      `)
      .eq('id', id)
      .single()

    if (error) return { data: null, error: error.message }
    
    return { 
      data: { ...data, proveedor_nombre: data.proveedores?.nombre || '' }, 
      error: null 
    }
  } catch (err) {
    console.error('[Supabase] Error obteniendo compra:', err)
    return { data: null, error: 'Error de conexion' }
  }
}

export async function getDetallesCompra(compraId: number): Promise<{ data: CompraDetalle[]; error: string | null }> {
  if (!isSupabaseConfigured()) {
    const saved = localStorage.getItem('compras_detalle')
    const detalles: CompraDetalle[] = saved ? JSON.parse(saved) : []
    return { data: detalles.filter(d => d.compra_id === compraId), error: null }
  }

  const supabase = createClient()
  if (!supabase) return { data: [], error: 'Cliente no disponible' }

  try {
    const { data, error } = await supabase
      .from('compras_detalle')
      .select(`
        *,
        productos (nombre, codigo_barras)
      `)
      .eq('compra_id', compraId)
      .order('id', { ascending: true })

    if (error) return { data: [], error: error.message }
    
    const formattedData = (data || []).map(d => ({
      ...d,
      producto_nombre: d.productos?.nombre || '',
      producto_codigo: d.productos?.codigo_barras || ''
    }))
    
    return { data: formattedData, error: null }
  } catch (err) {
    console.error('[Supabase] Error obteniendo detalles:', err)
    return { data: [], error: 'Error de conexion' }
  }
}

export async function createCompra(
  encabezado: Omit<CompraEncabezado, 'id' | 'created_at' | 'updated_at'>,
  detalles: Omit<CompraDetalle, 'id' | 'compra_id' | 'created_at'>[]
): Promise<{ data: CompraEncabezado | null; error: string | null }> {
  if (!isSupabaseConfigured()) {
    const savedEnc = localStorage.getItem('compras_encabezado')
    const savedDet = localStorage.getItem('compras_detalle')
    const compras: CompraEncabezado[] = savedEnc ? JSON.parse(savedEnc) : []
    const allDetalles: CompraDetalle[] = savedDet ? JSON.parse(savedDet) : []
    
    const newCompra: CompraEncabezado = { 
      ...encabezado, 
      id: Date.now(),
      created_at: new Date().toISOString()
    }
    compras.push(newCompra)
    localStorage.setItem('compras_encabezado', JSON.stringify(compras))
    
    const newDetalles = detalles.map((d, idx) => ({
      ...d,
      id: Date.now() + idx + 1,
      compra_id: newCompra.id!,
      created_at: new Date().toISOString()
    }))
    allDetalles.push(...newDetalles)
    localStorage.setItem('compras_detalle', JSON.stringify(allDetalles))
    
    return { data: newCompra, error: null }
  }

  const supabase = createClient()
  if (!supabase) return { data: null, error: 'Cliente no disponible' }

  try {
    const stamp = await getTenantStamp(supabase)
    if (!isValidStamp(stamp)) {
      console.log('[createCompra] Stamp invalido:', stamp)
      return { data: null, error: SESION_INVALIDA_ERROR }
    }

    // Insert encabezado (sello completo: empresa + usuario que crea la orden).
    // fecha_orden HN-as-UTC (dia de negocio); si el caller ya la trae, gana.
    let { data: compraData, error: compraError } = await supabase
      .from('compras_encabezado')
      .insert({ fecha_orden: getHondurasNowISO(), ...encabezado, ...stamp })
      .select()
      .single()

    // Fallback: si la columna `numero_factura` no existe (script 065 pendiente),
    // reintentamos sin ella para no bloquear la creación de la compra.
    if (compraError && /numero_factura/i.test(compraError.message || '')) {
      const { numero_factura: _nf, ...encSinFactura } = encabezado as { numero_factura?: string | null } & typeof encabezado
      const retry = await supabase
        .from('compras_encabezado')
        .insert({ fecha_orden: getHondurasNowISO(), ...encSinFactura, ...stamp })
        .select()
        .single()
      compraData = retry.data
      compraError = retry.error
    }

    if (compraError) return { data: null, error: compraError.message }

    // Insert detalles (solo razon_social_id a nivel linea)
    const detallesConCompra = detalles.map(d => ({
      ...d,
      compra_id: compraData.id,
      razon_social_id: stamp.razon_social_id
    }))

    const { error: detallesError } = await supabase
      .from('compras_detalle')
      .insert(detallesConCompra)

    if (detallesError) {
      // Rollback: delete the encabezado
      await supabase.from('compras_encabezado').delete().eq('id', compraData.id)
      return { data: null, error: detallesError.message }
    }

    return { data: compraData, error: null }
  } catch (err) {
    console.error('[Supabase] Error creando compra:', err)
    return { data: null, error: 'Error de conexion' }
  }
}

// ==================== DELETE COMPRA ====================

export async function deleteCompra(compraId: number): Promise<{ success: boolean; error: string | null }> {
  if (!isSupabaseConfigured()) {
    const savedEnc = localStorage.getItem('compras_encabezado')
    const savedDet = localStorage.getItem('compras_detalle')
    
    let compras: CompraEncabezado[] = savedEnc ? JSON.parse(savedEnc) : []
    let detalles: CompraDetalle[] = savedDet ? JSON.parse(savedDet) : []
    
    // Check if order is pending
    const compra = compras.find(c => c.id === compraId)
    if (!compra) return { success: false, error: 'Orden no encontrada' }
    if (compra.estado !== 'Pendiente') return { success: false, error: 'Solo se pueden eliminar ordenes pendientes' }
    
    // Delete
    compras = compras.filter(c => c.id !== compraId)
    detalles = detalles.filter(d => d.compra_id !== compraId)
    
    localStorage.setItem('compras_encabezado', JSON.stringify(compras))
    localStorage.setItem('compras_detalle', JSON.stringify(detalles))
    
    return { success: true, error: null }
  }

  const supabase = createClient()
  if (!supabase) return { success: false, error: 'Cliente no disponible' }

  try {
    // Check if order is pending
    const { data: compra, error: checkError } = await supabase
      .from('compras_encabezado')
      .select('estado')
      .eq('id', compraId)
      .single()

    if (checkError) return { success: false, error: checkError.message }
    if (compra.estado !== 'Pendiente') return { success: false, error: 'Solo se pueden eliminar ordenes pendientes' }

    // Delete details first
    const { error: detError } = await supabase
      .from('compras_detalle')
      .delete()
      .eq('compra_id', compraId)

    if (detError) return { success: false, error: detError.message }

    // Delete encabezado
    const { error: encError } = await supabase
      .from('compras_encabezado')
      .delete()
      .eq('id', compraId)

    if (encError) return { success: false, error: encError.message }

    return { success: true, error: null }
  } catch (err) {
    console.error('[Supabase] Error eliminando compra:', err)
    return { success: false, error: 'Error de conexion' }
  }
}

// ==================== RECEPCION Y PRORRATEO ====================

export interface RecepcionData {
  compraId: number
  costos_importacion: number
  impuestos_compra: number
  otros_costos: number
  tasa_cambio: number
  almacen_id: number
  localizacion_id: number
  /** Factura del proveedor y notas de ESTA recepción (officemart-008). */
  numero_factura_proveedor?: string | null
  notas?: string | null
  detalles: {
    detalle_id: number
    producto_id: number
    /** Cantidad que se recibe en ESTA recepción (0 = no se recibe ahora). */
    cantidad_recibida: number
    costo_final_local: number
    /** Nuevo precio de venta del producto (opcional). Si > 0, actualiza
     *  `productos.precio_venta_sugerido` al recibir. */
    precio_venta?: number | null
  }[]
  /**
   * Pago de la recepción (opcional).
   *   - Con el script officemart-008: Efectivo/Banco registran un ABONO a la
   *     OC (`compras_pagos` + tesorería); Credito deja la OC como cuenta por
   *     pagar con vencimiento (hoy + días de crédito). NO se crea gasto.
   *   - Sin el script (flujo clásico): registra un gasto "Compra de mercadería"
   *     pagado (Efectivo/Banco) o pendiente (Credito).
   * Si no se envía, la recepción NO toca tesorería.
   */
  pago?: {
    metodo: 'Efectivo' | 'Banco' | 'Credito'
    cuenta_id?: number | null
    proveedor_id?: number | null
    referencia?: string | null
    dias_credito?: number | null
  } | null
}

export async function procesarRecepcion(data: RecepcionData): Promise<{ success: boolean; error: string | null }> {
  // Flujo nuevo (officemart-008): recepciones parciales por OC. Import
  // dinámico para no crear un ciclo estático (compras-recepciones importa de
  // aquí). Si la tabla no existe, `legacy: true` y seguimos con el flujo clásico.
  if (isSupabaseConfigured()) {
    const { registrarRecepcion } = await import('@/lib/services/compras-recepciones')
    const nuevo = await registrarRecepcion({
      compraId: data.compraId,
      costos_importacion: data.costos_importacion,
      impuestos_compra: data.impuestos_compra,
      otros_costos: data.otros_costos,
      tasa_cambio: data.tasa_cambio,
      almacen_id: data.almacen_id,
      localizacion_id: data.localizacion_id,
      numero_factura_proveedor: data.numero_factura_proveedor ?? null,
      notas: data.notas ?? null,
      detalles: data.detalles,
      pago: data.pago
        ? { metodo: data.pago.metodo, cuenta_id: data.pago.cuenta_id ?? null, referencia: data.pago.referencia ?? null, dias_credito: data.pago.dias_credito ?? null }
        : null,
    })
    if (!nuevo.legacy) return { success: nuevo.success, error: nuevo.error }
    console.warn('[procesarRecepcion] tablas de recepciones ausentes; usando el flujo clásico. Aplica scripts/officemart-008.')
  }
  return procesarRecepcionClasica(data)
}

/** Flujo anterior (una recepción por OC, gasto "Compra de mercadería"). */
async function procesarRecepcionClasica(data: RecepcionData): Promise<{ success: boolean; error: string | null }> {
  if (!isSupabaseConfigured()) {
    // LocalStorage fallback
    const savedEnc = localStorage.getItem('compras_encabezado')
    const savedDet = localStorage.getItem('compras_detalle')
    const savedProd = localStorage.getItem('productos')
    const savedTrans = localStorage.getItem('transacciones_inventario')
    
    const compras: CompraEncabezado[] = savedEnc ? JSON.parse(savedEnc) : []
    const detalles: CompraDetalle[] = savedDet ? JSON.parse(savedDet) : []
    const productos: { id: number; costo_promedio: number; stock_total: number }[] = savedProd ? JSON.parse(savedProd) : []
    const transacciones: TransaccionInventario[] = savedTrans ? JSON.parse(savedTrans) : []
    
    // Calculate total_compra_local
    const totalCompraLocal = data.detalles.reduce((acc, d) => acc + (d.cantidad_recibida * d.costo_final_local), 0)
    
    // Update compra encabezado
    const compraIdx = compras.findIndex(c => c.id === data.compraId)
    if (compraIdx >= 0) {
      compras[compraIdx] = {
        ...compras[compraIdx],
        costos_importacion: data.costos_importacion,
        impuestos_compra: data.impuestos_compra,
        otros_costos: data.otros_costos,
        tasa_cambio: data.tasa_cambio,
        total_compra_local: totalCompraLocal,
        estado: 'Recibida'
      }
    }
    
    // Update detalles and products
    for (const item of data.detalles) {
      // Update detalle
      const detIdx = detalles.findIndex(d => d.id === item.detalle_id)
      if (detIdx >= 0) {
        detalles[detIdx] = {
          ...detalles[detIdx],
          cantidad_recibida: item.cantidad_recibida,
          costo_final_local: item.costo_final_local
        }
      }
      
      // Update product stock and average cost
      const prodIdx = productos.findIndex(p => p.id === item.producto_id)
      if (prodIdx >= 0) {
        const prod = productos[prodIdx]
        const stockActual = prod.stock_total || 0
        const costoActual = prod.costo_promedio || 0
        const cantRecibida = item.cantidad_recibida
        const costoFinal = item.costo_final_local
        
        // Weighted average cost formula
        const nuevoStock = stockActual + cantRecibida
        const nuevoCosto = nuevoStock > 0 
          ? ((stockActual * costoActual) + (cantRecibida * costoFinal)) / nuevoStock
          : costoFinal
        
        productos[prodIdx] = {
          ...prod,
          stock_total: nuevoStock,
          costo_promedio: nuevoCosto
        }
      }
      
      // Create inventory transaction
      transacciones.push({
        id: Date.now() + Math.random(),
        producto_id: item.producto_id,
        almacen_id: data.almacen_id,
        localizacion_id: data.localizacion_id,
        tipo_movimiento: 'Entrada Compra',
        cantidad: item.cantidad_recibida,
        costo_o_precio_unitario: item.costo_final_local,
        referencia_id: data.compraId,
        fecha: getHondurasNowISO()
      })
    }
    
    localStorage.setItem('compras_encabezado', JSON.stringify(compras))
    localStorage.setItem('compras_detalle', JSON.stringify(detalles))
    localStorage.setItem('productos', JSON.stringify(productos))
    localStorage.setItem('transacciones_inventario', JSON.stringify(transacciones))
    
    return { success: true, error: null }
  }

  const supabase = createClient()
  if (!supabase) return { success: false, error: 'Cliente no disponible' }

  try {
    const stamp = await getTenantStamp(supabase)
    if (!isValidStamp(stamp)) {
      console.log('[procesarRecepcion] Stamp invalido:', stamp)
      return { success: false, error: SESION_INVALIDA_ERROR }
    }
    // Toma física abierta en el almacén destino (officemart-013).
    const congelado = await assertInventarioNoCongelado(supabase, data.almacen_id)
    if (congelado) return { success: false, error: congelado }

    // Calculate total_compra_local
    const totalCompraLocal = data.detalles.reduce((acc, d) => acc + (d.cantidad_recibida * d.costo_final_local), 0)
    
    // 1. Update compra encabezado (no alteramos razon_social_id ni usuario
    // originales para preservar aislamiento e historial de autoria)
    const { error: encError } = await supabase
      .from('compras_encabezado')
      .update({
        costos_importacion: data.costos_importacion,
        impuestos_compra: data.impuestos_compra,
        otros_costos: data.otros_costos,
        tasa_cambio: data.tasa_cambio,
        total_compra_local: totalCompraLocal,
        estado: 'Recibida'
      })
      .eq('id', data.compraId)

    if (encError) return { success: false, error: encError.message }

    // 2. Process each detail
    for (const item of data.detalles) {
      // Update detalle
      const { error: detError } = await supabase
        .from('compras_detalle')
        .update({
          cantidad_recibida: item.cantidad_recibida,
          costo_final_local: item.costo_final_local
        })
        .eq('id', item.detalle_id)

      if (detError) return { success: false, error: detError.message }

      // Entrada de mercancia: suma stock y recalcula costo promedio ponderado
      // de forma ATOMICA (evita la condicion de carrera si dos recepciones del
      // mismo producto ocurren a la vez). Ver lib/services/stock.ts + script 018.
      const entrada = await aplicarEntradaCompra(
        supabase,
        item.producto_id,
        item.cantidad_recibida,
        item.costo_final_local
      )
      if (entrada.error) return { success: false, error: entrada.error }

      // Precio de venta: si se envió uno nuevo (> 0), actualiza el precio de
      // lista del producto (acotado por tenant). No toca costo_promedio.
      if (item.precio_venta != null && item.precio_venta > 0) {
        const { error: precioErr } = await supabase
          .from('productos')
          .update({ precio_venta_sugerido: item.precio_venta, updated_at: new Date().toISOString() })
          .eq('id', item.producto_id)
          .eq('razon_social_id', stamp.razon_social_id)
        if (precioErr) console.warn('[procesarRecepcion] no se actualizo el precio de venta:', precioErr.message)
      }

      // Insert inventory transaction (sello completo: empresa + usuario
      // que procesa la recepcion, que puede diferir de quien creo la orden)
      const { error: transError } = await supabase
        .from('transacciones_inventario')
        .insert({
          producto_id: item.producto_id,
          almacen_id: data.almacen_id,
          localizacion_id: data.localizacion_id,
          tipo_movimiento: 'Entrada Compra',
          cantidad: item.cantidad_recibida,
          costo_o_precio_unitario: item.costo_final_local,
          referencia_id: data.compraId,
          // Fecha HN-as-UTC (dia de negocio): el kardex la muestra con split.
          fecha: getHondurasNowISO(),
          ...stamp
        })

      if (transError) return { success: false, error: transError.message }
    }

    // 3. Pago de la recepción (opcional): registra un gasto con el total. Al
    //    reutilizar createGasto, "Credito" = gasto pendiente (cuenta por pagar);
    //    Efectivo/Banco = gasto pagado (sale de caja o de la cuenta elegida).
    if (data.pago) {
      const conceptoId = await ensureConceptoCompra(supabase, stamp.razon_social_id!)
      if (conceptoId == null) {
        // La mercancía ya entró al inventario; no bloqueamos por el pago.
        return { success: true, error: 'Recepción hecha, pero no se pudo registrar el pago (concepto). Regístralo manualmente en Gastos.' }
      }
      const esCredito = data.pago.metodo === 'Credito'
      const { error: gastoErr } = await createGasto({
        concepto_id: conceptoId,
        fecha_gasto: getHondurasTodayISODate(),
        monto: +totalCompraLocal.toFixed(2),
        // metodo_pago es un rótulo informativo del gasto (no la vía de pago).
        metodo_pago: data.pago.metodo === 'Banco' ? 'Transferencia' : 'Efectivo',
        descripcion: `Recepción de compra #${data.compraId}`,
        proveedor_id: data.pago.proveedor_id ?? null,
        pagar_ahora: !esCredito,
        pago_metodo: data.pago.metodo === 'Banco' ? 'Banco' : 'Efectivo',
        pago_cuenta_id: data.pago.metodo === 'Banco' ? (data.pago.cuenta_id ?? null) : null,
      })
      if (gastoErr) {
        return { success: true, error: `Recepción hecha, pero el pago falló: ${gastoErr}. Regístralo en Gastos.` }
      }
    }

    return { success: true, error: null }
  } catch (err) {
    console.error('[Supabase] Error procesando recepcion:', err)
    return { success: false, error: 'Error de conexion' }
  }
}

/**
 * Devuelve el id del concepto de gasto "Compra de mercadería" del tenant (lo
 * busca; si no existe, lo crea). Null si no se pudo resolver.
 */
async function ensureConceptoCompra(
  supabase: NonNullable<ReturnType<typeof createClient>>,
  _razonSocialId: number,
): Promise<number | null> {
  const { data: conceptos } = await getConceptosGasto()
  const existente = (conceptos || []).find(
    (c) => (c.nombre || '').trim().toLowerCase() === 'compra de mercadería'
      || (c.nombre || '').trim().toLowerCase() === 'compra de mercaderia',
  )
  if (existente?.id != null) return existente.id
  const { data: creado } = await createConceptoGasto({ nombre: 'Compra de mercadería', categoria_macro: 'Suministros' })
  return creado?.id ?? null
}

/**
 * Recepción por FACTURA que crea una compra REAL y la recibe en un solo paso.
 * A diferencia de `procesarRecepcion` (que asume una OC existente), aquí se crea
 * la fila en `compras_encabezado`/`compras_detalle` (con proveedor y número de
 * factura), y luego se procesa la recepción contra ese id real. Así la compra
 * aparece en el historial y el kardex puede apuntar a ella.
 */
export async function crearCompraYRecibir(input: {
  proveedor_id: number
  numero_factura?: string | null
  moneda: 'LPS' | 'USD'
  tasa_cambio: number
  costos_importacion: number
  impuestos_compra: number
  otros_costos: number
  almacen_id: number
  localizacion_id: number
  lineas: {
    producto_id: number
    cantidad: number
    costo_unitario_moneda_origen: number
    costo_final_local: number
    precio_venta?: number | null
  }[]
  pago?: { metodo: 'Efectivo' | 'Banco' | 'Credito'; cuenta_id?: number | null } | null
}): Promise<{ success: boolean; error: string | null; compraId: number | null }> {
  // 1. Crear la compra formal (estado Pendiente; procesarRecepcion la pasa a Recibida).
  const { data: compra, error: compraErr } = await createCompra(
    {
      proveedor_id: input.proveedor_id,
      numero_factura: input.numero_factura ?? null,
      fecha_tentativa: getHondurasTodayISODate(),
      moneda: input.moneda,
      tasa_cambio: input.tasa_cambio,
      costos_importacion: 0,
      impuestos_compra: 0,
      otros_costos: 0,
      total_compra_local: 0,
      estado: 'Pendiente',
    },
    input.lineas.map((l) => ({
      producto_id: l.producto_id,
      cantidad: l.cantidad,
      cantidad_recibida: 0,
      costo_unitario_moneda_origen: l.costo_unitario_moneda_origen,
      costo_final_local: 0,
    })),
  )
  if (compraErr || !compra?.id) return { success: false, error: compraErr || 'No se pudo crear la compra', compraId: null }

  // 2. Traer los detalle_id reales recién creados y mapear por producto_id.
  const { data: detallesCreados } = await getDetallesCompra(compra.id)
  const detalleIdPorProducto = new Map<number, number>()
  for (const d of detallesCreados) if (d.producto_id != null && d.id != null) detalleIdPorProducto.set(d.producto_id, d.id)

  // 3. Procesar la recepción contra el id real.
  const rec = await procesarRecepcion({
    compraId: compra.id,
    costos_importacion: input.costos_importacion,
    impuestos_compra: input.impuestos_compra,
    otros_costos: input.otros_costos,
    tasa_cambio: input.tasa_cambio,
    almacen_id: input.almacen_id,
    localizacion_id: input.localizacion_id,
    detalles: input.lineas.map((l) => ({
      detalle_id: detalleIdPorProducto.get(l.producto_id) ?? 0,
      producto_id: l.producto_id,
      cantidad_recibida: l.cantidad,
      costo_final_local: l.costo_final_local,
      precio_venta: l.precio_venta ?? null,
    })),
    pago: input.pago ? { ...input.pago, proveedor_id: input.proveedor_id } : null,
  })
  return { success: rec.success, error: rec.error, compraId: compra.id }
}

// ==================== HELPERS: PRORRATEO ====================

/**
 * Una linea del desglose del prorrateo, con TODOS los pasos intermedios
 * explicitos para que el usuario vea exactamente como se calcula el costo.
 */
export interface ProrrateoLinea {
  detalle_id: number
  producto_id: number
  producto_nombre?: string
  cantidad: number
  costo_unitario_origen: number
  /** cantidad * costo_unitario_origen (en moneda de origen) */
  valor_origen: number
  /** valor_origen convertido a Lempiras (× tasa si es USD) */
  valor_local: number
  /** participacion de la linea en el subtotal (0..1) */
  proporcion: number
  /** costos adicionales asignados a esta linea = costosAdicionales × proporcion */
  costos_asignados: number
  /** valor_local + costos_asignados */
  costo_total_linea: number
  /** costo_total_linea / cantidad (el costo final que entra al inventario) */
  costo_final_unitario: number
}

export interface ProrrateoResultado {
  lineas: ProrrateoLinea[]
  moneda: 'LPS' | 'USD'
  tasaCambio: number
  costosAdicionales: number
  /** subtotal de la mercancia en moneda de origen */
  subtotalOrigen: number
  /** subtotal de la mercancia en Lempiras */
  subtotalLocal: number
  /** suma de costos asignados (debe cuadrar con costosAdicionales) */
  totalCostosAsignados: number
  /** subtotalLocal + costosAdicionales (valor total del inventario recibido) */
  totalFinal: number
}

/**
 * Prorrateo detallado: reparte los costos adicionales (importacion, impuestos,
 * otros) entre las lineas EN PROPORCION a su valor, y devuelve cada paso del
 * calculo para mostrarlo en pantalla.
 *
 * Formula por linea:
 *   valor_local        = cantidad × costo_unit_origen × (USD ? tasa : 1)
 *   proporcion         = valor_local / subtotal_local
 *   costos_asignados   = costos_adicionales × proporcion
 *   costo_final_unit   = (valor_local + costos_asignados) / cantidad
 */
export function calcularProrrateoDetallado(
  detalles: CompraDetalle[],
  costosAdicionales: number,
  moneda: 'LPS' | 'USD',
  tasaCambio: number
): ProrrateoResultado {
  const tasa = moneda === 'USD' ? tasaCambio : 1
  const subtotalOrigen = detalles.reduce((acc, d) => acc + d.cantidad * d.costo_unitario_moneda_origen, 0)
  const subtotalLocal = subtotalOrigen * tasa

  let totalCostosAsignados = 0
  const lineas: ProrrateoLinea[] = detalles.map((d) => {
    const valorOrigen = d.cantidad * d.costo_unitario_moneda_origen
    const valorLocal = valorOrigen * tasa
    const proporcion = subtotalLocal > 0 ? valorLocal / subtotalLocal : 0
    const costosAsignados = costosAdicionales * proporcion
    const costoTotalLinea = valorLocal + costosAsignados
    const costoFinalUnitario = d.cantidad > 0 ? costoTotalLinea / d.cantidad : 0
    totalCostosAsignados += costosAsignados

    return {
      detalle_id: d.id!,
      producto_id: d.producto_id,
      producto_nombre: d.producto_nombre,
      cantidad: d.cantidad,
      costo_unitario_origen: d.costo_unitario_moneda_origen,
      valor_origen: +valorOrigen.toFixed(2),
      valor_local: +valorLocal.toFixed(2),
      proporcion,
      costos_asignados: +costosAsignados.toFixed(2),
      costo_total_linea: +costoTotalLinea.toFixed(2),
      costo_final_unitario: Math.round(costoFinalUnitario * 100) / 100,
    }
  })

  return {
    lineas,
    moneda,
    tasaCambio: tasa,
    costosAdicionales: +costosAdicionales.toFixed(2),
    subtotalOrigen: +subtotalOrigen.toFixed(2),
    subtotalLocal: +subtotalLocal.toFixed(2),
    totalCostosAsignados: +totalCostosAsignados.toFixed(2),
    totalFinal: +(subtotalLocal + costosAdicionales).toFixed(2),
  }
}

/**
 * Version compacta (compatibilidad con los llamadores existentes): usa el
 * calculo detallado y devuelve solo el costo final por linea.
 */
export function calcularProrrateo(
  detalles: CompraDetalle[],
  costosAdicionales: number,
  moneda: 'LPS' | 'USD',
  tasaCambio: number
): { detalle_id: number; producto_id: number; cantidad: number; costo_final_local: number }[] {
  return calcularProrrateoDetallado(detalles, costosAdicionales, moneda, tasaCambio).lineas.map((l) => ({
    detalle_id: l.detalle_id,
    producto_id: l.producto_id,
    cantidad: l.cantidad,
    costo_final_local: l.costo_final_unitario,
  }))
}
