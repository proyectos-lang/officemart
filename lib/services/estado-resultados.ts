"use client"

import { createClient, isSupabaseConfigured } from "@/lib/supabase/client"
import { getTenantStamp, isValidStamp } from "@/lib/services/tenant-stamp"
import { getComisionesPeriodo } from "@/lib/services/ventas-analytics"
import { getDevolucionesDelPeriodo } from "@/lib/services/devoluciones"
import { ejecutarVigentes } from "@/lib/services/ventas-filtros"

// ==================== TIPOS ====================

export interface EstadoResultadosMensual {
  anio: number
  mes: number
  mes_nombre: string
  ventas_totales: number
  costo_mercancia_vendida: number
  utilidad_bruta: number
  gastos_servicios: number
  gastos_publicidad: number
  gastos_nomina: number
  gastos_arriendo: number
  gastos_mantenimiento: number
  gastos_impuestos: number
  gastos_suministros: number
  gastos_otros: number
  total_gastos_operativos: number
  /**
   * Gasto financiero: suma de comisiones bancarias del periodo
   * (monto_bruto - monto_neto en ventas_pagos_detalle). Ya no es parte de
   * total_gastos_operativos para mantenerlo visible como linea separada.
   */
  comisiones_bancarias: number
  utilidad_neta: number
  margen_bruto: number
  margen_neto: number
}

const MESES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
]

// ==================== ESTADO DE RESULTADOS ====================

/**
 * Aplica las devoluciones del periodo a un estado de resultados: resta las
 * ventas devueltas de `ventas_totales` y el costo devuelto del CMV, y recalcula
 * utilidad bruta/neta y margenes. Deja los reportes en terminos NETOS.
 */
function netearDevoluciones(
  d: EstadoResultadosMensual,
  montoVentasDev: number,
  montoCostoDev: number
): EstadoResultadosMensual {
  const ventas = +(d.ventas_totales - montoVentasDev).toFixed(2)
  const cmv = +(d.costo_mercancia_vendida - montoCostoDev).toFixed(2)
  const utilidadBruta = +(ventas - cmv).toFixed(2)
  const utilidadNeta = +(utilidadBruta - d.total_gastos_operativos - d.comisiones_bancarias).toFixed(2)
  return {
    ...d,
    ventas_totales: ventas,
    costo_mercancia_vendida: cmv,
    utilidad_bruta: utilidadBruta,
    utilidad_neta: utilidadNeta,
    margen_bruto: ventas > 0 ? +((utilidadBruta / ventas) * 100).toFixed(2) : 0,
    margen_neto: ventas > 0 ? +((utilidadNeta / ventas) * 100).toFixed(2) : 0,
  }
}

export async function getEstadoResultadosMensual(anio: number, mes: number): Promise<{ data: EstadoResultadosMensual | null; error: string | null }> {
  const base = await getEstadoResultadosMensualBase(anio, mes)
  if (!base.data) return base

  // Netea las devoluciones del periodo (factura original queda intacta).
  const dev = await getDevolucionesDelPeriodo(anio, mes).catch(
    () => ({ montoVentas: 0, montoCosto: 0, error: null })
  )
  if ((dev.montoVentas || 0) === 0 && (dev.montoCosto || 0) === 0) return base

  return { data: netearDevoluciones(base.data, dev.montoVentas, dev.montoCosto), error: base.error }
}

async function getEstadoResultadosMensualBase(anio: number, mes: number): Promise<{ data: EstadoResultadosMensual | null; error: string | null }> {
  if (!isSupabaseConfigured()) {
    // LocalStorage implementation
    return getEstadoResultadosLocal(anio, mes)
  }

  const supabase = createClient()
  if (!supabase) return { data: null, error: 'Cliente no disponible' }

  try {
    // Try to fetch from the view first
    const { data, error } = await supabase
      .from('vista_estado_resultados_mensual')
      .select('*')
      .eq('anio', anio)
      .eq('mes', mes)
      .single()

    if (error) {
      // If view doesn't exist, calculate manually
      return getEstadoResultadosCalculado(supabase, anio, mes)
    }

    // La vista historica todavia NO incluye comisiones bancarias. Las
    // calculamos aparte y reajustamos la utilidad neta antes de devolver.
    const { data: comisiones } = await getComisionesPeriodo(anio, mes)
    const enriched: EstadoResultadosMensual = {
      ...data,
      comisiones_bancarias: comisiones,
      utilidad_neta: (data.utilidad_neta || 0) - comisiones,
      margen_neto: (data.ventas_totales || 0) > 0
        ? (((data.utilidad_neta || 0) - comisiones) / data.ventas_totales) * 100
        : 0,
    }
    return { data: enriched, error: null }
  } catch {
    return getEstadoResultadosCalculado(supabase, anio, mes)
  }
}

export async function getEstadoResultadosAnual(anio: number): Promise<{ data: EstadoResultadosMensual[]; error: string | null }> {
  if (!isSupabaseConfigured()) {
    // LocalStorage implementation
    const resultados: EstadoResultadosMensual[] = []
    for (let mes = 1; mes <= 12; mes++) {
      const { data } = await getEstadoResultadosLocal(anio, mes)
      if (data) resultados.push(data)
    }
    return { data: resultados, error: null }
  }

  const supabase = createClient()
  if (!supabase) return { data: [], error: 'Cliente no disponible' }

  try {
    const { data, error } = await supabase
      .from('vista_estado_resultados_mensual')
      .select('*')
      .eq('anio', anio)
      .order('mes', { ascending: true })

    if (error) {
      // Calculate manually for each month
      const resultados: EstadoResultadosMensual[] = []
      for (let mes = 1; mes <= 12; mes++) {
        const { data: mesData } = await getEstadoResultadosCalculado(supabase, anio, mes)
        if (mesData) resultados.push(mesData)
      }
      return { data: resultados, error: null }
    }

    // La vista no expone comisiones; las anadimos por mes para que el chart
    // anual y el acumulado reflejen la utilidad neta real (post-comisiones).
    const enriched = await Promise.all(
      (data || []).map(async (m) => {
        const { data: comisiones } = await getComisionesPeriodo(anio, m.mes)
        const utilidadNetaReal = (m.utilidad_neta || 0) - comisiones
        return {
          ...m,
          comisiones_bancarias: comisiones,
          utilidad_neta: utilidadNetaReal,
          margen_neto: (m.ventas_totales || 0) > 0
            ? (utilidadNetaReal / m.ventas_totales) * 100
            : 0,
        } as EstadoResultadosMensual
      })
    )

    return { data: enriched, error: null }
  } catch {
    return { data: [], error: 'Error de conexion' }
  }
}

// ==================== HELPERS ====================

async function getEstadoResultadosLocal(anio: number, mes: number): Promise<{ data: EstadoResultadosMensual | null; error: string | null }> {
  const savedVentas = localStorage.getItem('ventas_encabezado')
  const savedDetalles = localStorage.getItem('ventas_detalle')
  const savedGastos = localStorage.getItem('gastos')
  const savedConceptos = localStorage.getItem('conceptos_gastos')

  const ventas: { id: number; fecha_venta: string; total_venta: number }[] = savedVentas ? JSON.parse(savedVentas) : []
  const detalles: { venta_id: number; cantidad: number; precio_unitario: number; costo_promedio_momento: number }[] = savedDetalles ? JSON.parse(savedDetalles) : []
  const gastos: { fecha_gasto: string; monto: number; concepto_id: number }[] = savedGastos ? JSON.parse(savedGastos) : []
  const conceptos: { id: number; categoria_macro: string }[] = savedConceptos ? JSON.parse(savedConceptos) : []

  // Filter by month/year
  const ventasMes = ventas.filter(v => {
    const fecha = new Date(v.fecha_venta)
    return fecha.getFullYear() === anio && fecha.getMonth() + 1 === mes
  })

  const gastosMes = gastos.filter(g => {
    const fecha = new Date(g.fecha_gasto)
    return fecha.getFullYear() === anio && fecha.getMonth() + 1 === mes
  })

  // Calculate ventas totales
  const ventasTotales = ventasMes.reduce((acc, v) => acc + (v.total_venta || 0), 0)

  // Calculate CMV
  const ventaIds = ventasMes.map(v => v.id)
  const detallesMes = detalles.filter(d => ventaIds.includes(d.venta_id))
  const cmv = detallesMes.reduce((acc, d) => acc + ((d.cantidad || 0) * (d.costo_promedio_momento || 0)), 0)

  // Calculate gastos por categoria
  const gastosPorCategoria: Record<string, number> = {
    'Servicios': 0,
    'Publicidad': 0,
    'Nomina': 0,
    'Arriendo': 0,
    'Mantenimiento': 0,
    'Impuestos': 0,
    'Suministros': 0,
    'Otros': 0
  }

  gastosMes.forEach(g => {
    const concepto = conceptos.find(c => c.id === g.concepto_id)
    const cat = concepto?.categoria_macro || 'Otros'
    gastosPorCategoria[cat] = (gastosPorCategoria[cat] || 0) + g.monto
  })

  const totalGastosOperativos = Object.values(gastosPorCategoria).reduce((a, b) => a + b, 0)
  const utilidadBruta = ventasTotales - cmv
  // En modo local no hay desglose bruto/neto por metodo de pago: comisiones = 0.
  const comisionesBancarias = 0
  const utilidadNeta = utilidadBruta - totalGastosOperativos - comisionesBancarias

  const resultado: EstadoResultadosMensual = {
    anio,
    mes,
    mes_nombre: MESES[mes - 1],
    ventas_totales: ventasTotales,
    costo_mercancia_vendida: cmv,
    utilidad_bruta: utilidadBruta,
    gastos_servicios: gastosPorCategoria['Servicios'],
    gastos_publicidad: gastosPorCategoria['Publicidad'],
    gastos_nomina: gastosPorCategoria['Nomina'],
    gastos_arriendo: gastosPorCategoria['Arriendo'],
    gastos_mantenimiento: gastosPorCategoria['Mantenimiento'],
    gastos_impuestos: gastosPorCategoria['Impuestos'],
    gastos_suministros: gastosPorCategoria['Suministros'],
    gastos_otros: gastosPorCategoria['Otros'],
    total_gastos_operativos: totalGastosOperativos,
    comisiones_bancarias: comisionesBancarias,
    utilidad_neta: utilidadNeta,
    margen_bruto: ventasTotales > 0 ? (utilidadBruta / ventasTotales) * 100 : 0,
    margen_neto: ventasTotales > 0 ? (utilidadNeta / ventasTotales) * 100 : 0
  }

  return { data: resultado, error: null }
}

async function getEstadoResultadosCalculado(supabase: ReturnType<typeof createClient>, anio: number, mes: number): Promise<{ data: EstadoResultadosMensual | null; error: string | null }> {
  if (!supabase) return { data: null, error: 'Cliente no disponible' }

  const primerDia = `${anio}-${String(mes).padStart(2, '0')}-01`
  // Cota superior CON hora: `fecha_venta` es timestamptz; con fecha sola
  // (`<= 'YYYY-MM-DD'` = medianoche) se perdian TODAS las ventas del ultimo dia.
  const ultimoDia = `${new Date(anio, mes, 0).toISOString().split('T')[0]}T23:59:59`

  // Aislamiento multi-tenant: solo consideramos ventas/gastos de la empresa
  // del usuario logueado. Si la sesion no esta vinculada (caso edge), no
  // bloqueamos la lectura pero el filtro inferior hara que regrese vacio.
  const stamp = await getTenantStamp(supabase)
  const tenantId = stamp.razon_social_id

  try {
    // Get ventas VIGENTES del mes (filtradas por razon_social_id)
    const { data: ventasData } = await ejecutarVigentes<{ id: number; total_venta: number }[] | null>((filtrar) => {
      let ventasQuery = supabase
        .from('ventas_encabezado')
        .select('id, total_venta')
        .gte('fecha_venta', primerDia)
        .lte('fecha_venta', ultimoDia)
      if (filtrar) ventasQuery = ventasQuery.is('anulada_at', null)
      if (tenantId != null) ventasQuery = ventasQuery.eq('razon_social_id', tenantId)
      return ventasQuery
    })

    const ventasTotales = (ventasData || []).reduce((acc, v) => acc + (v.total_venta || 0), 0)
    const ventaIds = (ventasData || []).map(v => v.id)

    // Get detalles for CMV calculation
    let cmv = 0
    if (ventaIds.length > 0) {
      const { data: detallesData } = await supabase
        .from('ventas_detalle')
        .select('cantidad, costo_promedio_momento')
        .in('venta_id', ventaIds)

      cmv = (detallesData || []).reduce((acc, d) => acc + ((d.cantidad || 0) * (d.costo_promedio_momento || 0)), 0)
    }

    // Get gastos del mes (filtrados por razon_social_id)
    let gastosQuery = supabase
      .from('gastos')
      .select(`
        monto,
        conceptos_gastos (categoria_macro)
      `)
      .gte('fecha_gasto', primerDia)
      .lte('fecha_gasto', ultimoDia)
    if (tenantId != null) gastosQuery = gastosQuery.eq('razon_social_id', tenantId)
    const { data: gastosData } = await gastosQuery

    const gastosPorCategoria: Record<string, number> = {
      'Servicios': 0,
      'Publicidad': 0,
      'Nomina': 0,
      'Arriendo': 0,
      'Mantenimiento': 0,
      'Impuestos': 0,
      'Suministros': 0,
      'Otros': 0
    }

    ;(gastosData || []).forEach(g => {
      // El join puede venir tipado como objeto o arreglo segun el parser.
      const concepto = Array.isArray(g.conceptos_gastos) ? g.conceptos_gastos[0] : g.conceptos_gastos
      const cat = (concepto as { categoria_macro?: string } | null)?.categoria_macro || 'Otros'
      gastosPorCategoria[cat] = (gastosPorCategoria[cat] || 0) + (g.monto || 0)
    })

    const totalGastosOperativos = Object.values(gastosPorCategoria).reduce((a, b) => a + b, 0)
    const utilidadBruta = ventasTotales - cmv

    // Comisiones bancarias del mes (gasto financiero). Si la migracion 011
    // esta pendiente, getComisionesPeriodo regresa 0 y no afecta el calculo.
    const { data: comisionesBancarias } = await getComisionesPeriodo(anio, mes)

    const utilidadNeta = utilidadBruta - totalGastosOperativos - comisionesBancarias

    const resultado: EstadoResultadosMensual = {
      anio,
      mes,
      mes_nombre: MESES[mes - 1],
      ventas_totales: ventasTotales,
      costo_mercancia_vendida: cmv,
      utilidad_bruta: utilidadBruta,
      gastos_servicios: gastosPorCategoria['Servicios'],
      gastos_publicidad: gastosPorCategoria['Publicidad'],
      gastos_nomina: gastosPorCategoria['Nomina'],
      gastos_arriendo: gastosPorCategoria['Arriendo'],
      gastos_mantenimiento: gastosPorCategoria['Mantenimiento'],
      gastos_impuestos: gastosPorCategoria['Impuestos'],
      gastos_suministros: gastosPorCategoria['Suministros'],
      gastos_otros: gastosPorCategoria['Otros'],
      total_gastos_operativos: totalGastosOperativos,
      comisiones_bancarias: comisionesBancarias,
      utilidad_neta: utilidadNeta,
      margen_bruto: ventasTotales > 0 ? (utilidadBruta / ventasTotales) * 100 : 0,
      margen_neto: ventasTotales > 0 ? (utilidadNeta / ventasTotales) * 100 : 0
    }

    return { data: resultado, error: null }
  } catch {
    return { data: null, error: 'Error calculando estado de resultados' }
  }
}

// ==================== ACUMULADO ANUAL ====================

export async function getEstadoResultadosAcumulado(anio: number): Promise<{ data: EstadoResultadosMensual | null; error: string | null }> {
  const { data: mensual, error } = await getEstadoResultadosAnual(anio)
  
  if (error || !mensual || mensual.length === 0) {
    return { data: null, error: error || 'Sin datos' }
  }

  const acumulado: EstadoResultadosMensual = {
    anio,
    mes: 0,
    mes_nombre: `Acumulado ${anio}`,
    ventas_totales: mensual.reduce((acc, m) => acc + m.ventas_totales, 0),
    costo_mercancia_vendida: mensual.reduce((acc, m) => acc + m.costo_mercancia_vendida, 0),
    utilidad_bruta: mensual.reduce((acc, m) => acc + m.utilidad_bruta, 0),
    gastos_servicios: mensual.reduce((acc, m) => acc + m.gastos_servicios, 0),
    gastos_publicidad: mensual.reduce((acc, m) => acc + m.gastos_publicidad, 0),
    gastos_nomina: mensual.reduce((acc, m) => acc + m.gastos_nomina, 0),
    gastos_arriendo: mensual.reduce((acc, m) => acc + m.gastos_arriendo, 0),
    gastos_mantenimiento: mensual.reduce((acc, m) => acc + m.gastos_mantenimiento, 0),
    gastos_impuestos: mensual.reduce((acc, m) => acc + m.gastos_impuestos, 0),
    gastos_suministros: mensual.reduce((acc, m) => acc + m.gastos_suministros, 0),
    gastos_otros: mensual.reduce((acc, m) => acc + m.gastos_otros, 0),
    total_gastos_operativos: mensual.reduce((acc, m) => acc + m.total_gastos_operativos, 0),
    comisiones_bancarias: mensual.reduce((acc, m) => acc + (m.comisiones_bancarias || 0), 0),
    utilidad_neta: mensual.reduce((acc, m) => acc + m.utilidad_neta, 0),
    margen_bruto: 0,
    margen_neto: 0
  }

  // Recalculate margins
  if (acumulado.ventas_totales > 0) {
    acumulado.margen_bruto = (acumulado.utilidad_bruta / acumulado.ventas_totales) * 100
    acumulado.margen_neto = (acumulado.utilidad_neta / acumulado.ventas_totales) * 100
  }

  return { data: acumulado, error: null }
}
