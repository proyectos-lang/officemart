"use client"

import { createClient, isSupabaseConfigured } from "@/lib/supabase/client"
import { STORAGE_PREFIX } from "@/lib/supabase/schema"
import { getTenantStamp, isValidStamp, SESION_INVALIDA_ERROR } from "@/lib/services/tenant-stamp"
import { registrarMovimientoCaja, getSesionAbierta } from "@/lib/services/caja-chica"
import { registrarMovimientoCuenta, recalcCadenaSaldoCuenta } from "@/lib/services/cuentas"

// ==================== TIPOS ====================

export const CATEGORIAS_MACRO = [
  'Servicios',
  'Publicidad',
  'Nomina',
  'Arriendo',
  'Mantenimiento',
  'Impuestos',
  'Suministros',
  'Otros'
] as const

export type CategoriaMacro = typeof CATEGORIAS_MACRO[number]

export interface ConceptoGasto {
  id?: number
  nombre: string
  categoria_macro: CategoriaMacro
  created_at?: string
}

/**
 * Estado de pago derivado de monto_pagado vs monto:
 *   - Pendiente: monto_pagado === 0
 *   - Parcial:   0 < monto_pagado < monto
 *   - Pagado:    monto_pagado >= monto
 */
export type EstadoPagoGasto = 'Pendiente' | 'Parcial' | 'Pagado'

/**
 * Modelo del row en `gastos`. Coincide con la BD pre-creada del usuario:
 *   - `monto`         : valor del gasto.
 *   - `monto_pagado`  : suma acumulada de abonos (la actualizamos en cliente).
 *   - `estado_pago`   : derivado de monto/monto_pagado.
 *   - `fecha_vencimiento`: due-date para AP.
 *   - `proveedor_id`  : FK a tabla `proveedores`.
 *
 * `proveedor_nombre` es un campo virtual (join) que viene de `proveedores`
 * via select y NO se persiste al hacer insert/update.
 */
export interface Gasto {
  id?: number
  concepto_id: number
  fecha_gasto: string
  monto: number
  /** Compatibilidad con UI antigua. */
  metodo_pago: 'Efectivo' | 'Transferencia' | 'Tarjeta'
  descripcion?: string
  comprobante_url?: string
  proveedor_id?: number | null
  fecha_vencimiento?: string | null
  monto_pagado?: number
  estado_pago?: EstadoPagoGasto
  created_at?: string
  // ----- Joined fields (NO persisten) -----
  concepto_nombre?: string
  categoria_macro?: CategoriaMacro
  proveedor_nombre?: string | null
}

/**
 * Linea del historial de abonos. Como NO usamos una tabla
 * `gastos_pagos_detalle`, "construimos" cada GastoPago a partir de los
 * movimientos en caja chica / cuenta bancaria que tienen ref_tipo='gasto' y
 * ref_id=gasto.id. Esto es 100% suficiente para auditoria y cuadre.
 */
export interface GastoPago {
  id: number
  fecha_pago: string
  monto: number
  metodo_pago: 'Efectivo' | 'Banco'
  cuenta_id?: number | null
  cuenta_nombre?: string | null
  concepto?: string | null
  /** Origen del registro: caja chica o cuenta bancaria. */
  origen: 'caja' | 'cuenta'
}

/**
 * Fila virtual de "Cuenta por Pagar". Es simplemente un `gasto` con
 * estado_pago != Pagado, calculando saldo y dias vencidos en cliente.
 * Asi evitamos depender de la vista `vista_cuentas_por_pagar`.
 */
export interface CuentaPorPagar {
  id: number
  concepto_id: number
  concepto_nombre: string | null
  categoria_macro: CategoriaMacro | null
  proveedor_id: number | null
  proveedor_nombre: string | null
  fecha_gasto: string
  fecha_vencimiento: string | null
  monto: number
  monto_pagado: number
  saldo_pendiente: number
  estado_pago: 'Pendiente' | 'Parcial'
  descripcion: string | null
  comprobante_url: string | null
  dias_vencido: number | null
}

// ==================== CONCEPTOS DE GASTO ====================

export async function getConceptosGasto(): Promise<{ data: ConceptoGasto[]; error: string | null }> {
  if (!isSupabaseConfigured()) {
    const saved = localStorage.getItem('conceptos_gastos')
    return { data: saved ? JSON.parse(saved) : [], error: null }
  }

  const supabase = createClient()
  if (!supabase) return { data: [], error: 'Cliente no disponible' }

  const { data, error } = await supabase
    .from('conceptos_gastos')
    .select('*')
    .order('nombre', { ascending: true })

  if (error) return { data: [], error: error.message }
  return { data: data || [], error: null }
}

export async function createConceptoGasto(
  concepto: Omit<ConceptoGasto, 'id' | 'created_at'>
): Promise<{ data: ConceptoGasto | null; error: string | null }> {
  if (!isSupabaseConfigured()) {
    const saved = localStorage.getItem('conceptos_gastos')
    const conceptos: ConceptoGasto[] = saved ? JSON.parse(saved) : []
    const newConcepto: ConceptoGasto = {
      ...concepto,
      id: Date.now(),
      created_at: new Date().toISOString(),
    }
    conceptos.push(newConcepto)
    localStorage.setItem('conceptos_gastos', JSON.stringify(conceptos))
    return { data: newConcepto, error: null }
  }

  const supabase = createClient()
  if (!supabase) return { data: null, error: 'Cliente no disponible' }

  const stamp = await getTenantStamp(supabase)
  if (!isValidStamp(stamp)) {
    return { data: null, error: SESION_INVALIDA_ERROR }
  }

  const { data, error } = await supabase
    .from('conceptos_gastos')
    .insert({ ...concepto, ...stamp })
    .select()
    .single()

  if (error) return { data: null, error: error.message }
  return { data, error: null }
}

export async function deleteConceptoGasto(id: number): Promise<{ success: boolean; error: string | null }> {
  if (!isSupabaseConfigured()) {
    const saved = localStorage.getItem('conceptos_gastos')
    const conceptos: ConceptoGasto[] = saved ? JSON.parse(saved) : []
    const filtered = conceptos.filter(c => c.id !== id)
    localStorage.setItem('conceptos_gastos', JSON.stringify(filtered))
    return { success: true, error: null }
  }

  const supabase = createClient()
  if (!supabase) return { success: false, error: 'Cliente no disponible' }

  const { error } = await supabase
    .from('conceptos_gastos')
    .delete()
    .eq('id', id)

  if (error) return { success: false, error: error.message }
  return { success: true, error: null }
}

// ==================== GASTOS ====================

/**
 * Lista de gastos del tenant con joins a conceptos_gastos y proveedores.
 * Si la columna `proveedor_id` no existe (BD sin migrar), reintentamos sin
 * el join para no romper la pagina.
 */
export async function getGastos(): Promise<{ data: Gasto[]; error: string | null }> {
  if (!isSupabaseConfigured()) {
    const savedGastos = localStorage.getItem('gastos')
    const savedConceptos = localStorage.getItem('conceptos_gastos')
    const gastos: Gasto[] = savedGastos ? JSON.parse(savedGastos) : []
    const conceptos: ConceptoGasto[] = savedConceptos ? JSON.parse(savedConceptos) : []
    const enriched = gastos.map((g) => {
      const c = conceptos.find((c) => c.id === g.concepto_id)
      return { ...g, concepto_nombre: c?.nombre || 'Desconocido', categoria_macro: c?.categoria_macro }
    })
    return {
      data: enriched.sort((a, b) => new Date(b.fecha_gasto).getTime() - new Date(a.fecha_gasto).getTime()),
      error: null,
    }
  }

  const supabase = createClient()
  if (!supabase) return { data: [], error: 'Cliente no disponible' }

  // Intento con joins completos.
  let result = await supabase
    .from('gastos')
    .select(`
      *,
      conceptos_gastos:concepto_id (nombre, categoria_macro),
      proveedores:proveedor_id (id, nombre)
    `)
    .order('fecha_gasto', { ascending: false })

  // Fallback si proveedor_id / proveedores no existen aun.
  if (
    result.error &&
    /proveedor|relation .*proveedores.* does not exist/i.test(result.error.message)
  ) {
    console.log('[gastos] fallback sin join proveedores')
    result = await supabase
      .from('gastos')
      .select(`
        *,
        conceptos_gastos:concepto_id (nombre, categoria_macro)
      `)
      .order('fecha_gasto', { ascending: false })
  }

  if (result.error) return { data: [], error: result.error.message }

  const data = (result.data || []).map((g: Record<string, unknown> & {
    conceptos_gastos?: { nombre?: string; categoria_macro?: CategoriaMacro } | { nombre?: string; categoria_macro?: CategoriaMacro }[] | null
    proveedores?: { id?: number; nombre?: string } | { id?: number; nombre?: string }[] | null
  }) => {
    const concepto = Array.isArray(g.conceptos_gastos) ? g.conceptos_gastos[0] : g.conceptos_gastos
    const prov = Array.isArray(g.proveedores) ? g.proveedores[0] : g.proveedores
    const { conceptos_gastos: _c, proveedores: _p, ...rest } = g
    return {
      ...(rest as unknown as Gasto),
      concepto_nombre: concepto?.nombre || 'Desconocido',
      categoria_macro: concepto?.categoria_macro,
      proveedor_nombre: prov?.nombre || null,
    }
  })

  return { data, error: null }
}

/**
 * Crea un nuevo gasto. Si `pagar_ahora=true`, registra de inmediato un
 * abono completo (que crea el movimiento espejo en caja/banco y actualiza
 * monto_pagado/estado_pago en `gastos`).
 */
export async function createGasto(input: {
  concepto_id: number
  fecha_gasto: string
  monto: number
  metodo_pago: 'Efectivo' | 'Transferencia' | 'Tarjeta'
  descripcion?: string
  comprobante_url?: string
  proveedor_id?: number | null
  fecha_vencimiento?: string | null
  /** Si true, registra el pago total inmediatamente. */
  pagar_ahora?: boolean
  /** Solo si pagar_ahora=true. */
  pago_metodo?: 'Efectivo' | 'Banco'
  pago_cuenta_id?: number | null
}): Promise<{ data: Gasto | null; error: string | null }> {
  if (!isSupabaseConfigured()) {
    const saved = localStorage.getItem('gastos')
    const gastos: Gasto[] = saved ? JSON.parse(saved) : []
    const nuevo: Gasto = {
      concepto_id: input.concepto_id,
      fecha_gasto: input.fecha_gasto,
      monto: input.monto,
      metodo_pago: input.metodo_pago,
      descripcion: input.descripcion,
      comprobante_url: input.comprobante_url,
      proveedor_id: input.proveedor_id ?? null,
      fecha_vencimiento: input.fecha_vencimiento ?? null,
      monto_pagado: input.pagar_ahora ? input.monto : 0,
      estado_pago: input.pagar_ahora ? 'Pagado' : 'Pendiente',
      id: Date.now(),
      created_at: new Date().toISOString(),
    }
    gastos.push(nuevo)
    localStorage.setItem('gastos', JSON.stringify(gastos))
    return { data: nuevo, error: null }
  }

  const supabase = createClient()
  if (!supabase) return { data: null, error: 'Cliente no disponible' }

  const stamp = await getTenantStamp(supabase)
  if (!isValidStamp(stamp)) {
    console.log('[createGasto] Stamp invalido:', stamp)
    return { data: null, error: SESION_INVALIDA_ERROR }
  }

  // Si va a pagarse en efectivo, exigimos sesion de caja abierta antes de
  // crear el gasto, para garantizar atomicidad logica.
  if (input.pagar_ahora && (input.pago_metodo ?? 'Efectivo') === 'Efectivo') {
    const { data: sesion } = await getSesionAbierta()
    if (!sesion?.id) {
      return {
        data: null,
        error: 'No hay sesion de Caja Chica abierta. Imposible registrar el pago en efectivo.',
      }
    }
  }

  // INSERT del gasto. Solo enviamos columnas que el usuario confirmo que
  // existen: concepto_id, fecha_gasto, monto, metodo_pago, descripcion,
  // comprobante_url, proveedor_id, fecha_vencimiento, monto_pagado,
  // estado_pago + razon_social_id (stamp).
  const insertPayload = {
    concepto_id: input.concepto_id,
    fecha_gasto: input.fecha_gasto,
    monto: input.monto,
    metodo_pago: input.metodo_pago,
    descripcion: input.descripcion ?? null,
    comprobante_url: input.comprobante_url ?? null,
    proveedor_id: input.proveedor_id ?? null,
    fecha_vencimiento: input.fecha_vencimiento ?? null,
    monto_pagado: 0,
    estado_pago: 'Pendiente' as EstadoPagoGasto,
    ...stamp,
  }

  const { data: gastoData, error: insertError } = await supabase
    .from('gastos')
    .insert(insertPayload)
    .select()
    .single()

  if (insertError) return { data: null, error: insertError.message }
  if (!gastoData?.id) return { data: null, error: 'No se pudo crear el gasto' }

  // Si pagar_ahora=true, registramos el abono completo (que actualizara
  // monto_pagado y estado_pago).
  if (input.pagar_ahora) {
    const metodo = input.pago_metodo ?? 'Efectivo'
    const { error: payErr } = await registrarPagoGasto({
      gasto_id: gastoData.id,
      monto: input.monto,
      metodo_pago: metodo,
      cuenta_id: metodo === 'Banco' ? input.pago_cuenta_id ?? null : null,
    })
    if (payErr) {
      // El gasto ya existe pero el pago fallo. No lo borramos para no
      // perder el registro; el usuario puede reintentar el pago.
      return {
        data: gastoData as Gasto,
        error: `Gasto creado pero el pago fallo: ${payErr}. Registrelo manualmente.`,
      }
    }

    // Re-leemos el gasto para reflejar monto_pagado/estado_pago actualizados.
    const refresh = await supabase
      .from('gastos')
      .select('*')
      .eq('id', gastoData.id)
      .maybeSingle()
    return { data: (refresh.data as Gasto) || (gastoData as Gasto), error: null }
  }

  return { data: gastoData as Gasto, error: null }
}

export async function deleteGasto(id: number): Promise<{ success: boolean; error: string | null }> {
  if (!isSupabaseConfigured()) {
    const saved = localStorage.getItem('gastos')
    const gastos: Gasto[] = saved ? JSON.parse(saved) : []
    const filtered = gastos.filter((g) => g.id !== id)
    localStorage.setItem('gastos', JSON.stringify(filtered))
    return { success: true, error: null }
  }

  const supabase = createClient()
  if (!supabase) return { success: false, error: 'Cliente no disponible' }

  // Cuentas bancarias afectadas por los pagos de este gasto (para recalcular su
  // saldo despues de borrar los movimientos).
  const { data: movsCuenta } = await supabase
    .from('cuenta_movimientos')
    .select('cuenta_id')
    .eq('ref_tipo', 'gasto')
    .eq('ref_id', id)
  const cuentasAfectadas = [...new Set((movsCuenta ?? []).map((m) => Number(m.cuenta_id)))]

  // Borra el gasto.
  const { error } = await supabase.from('gastos').delete().eq('id', id)
  if (error) return { success: false, error: error.message }

  // Revierte la tesoreria del gasto: borra sus movimientos de caja (efectivo) y
  // de banco (ref_tipo='gasto'). Sin esto, el gasto borrado seguia contando como
  // "pagado" en caja / Cierre Diario y descuadraba el saldo. Los abonos del
  // gasto SON estos movimientos (no hay tabla gastos_pagos_detalle).
  await supabase
    .from('caja_chica_movimientos')
    .delete()
    .eq('ref_tipo', 'gasto')
    .eq('ref_id', id)
  await supabase
    .from('cuenta_movimientos')
    .delete()
    .eq('ref_tipo', 'gasto')
    .eq('ref_id', id)

  // Recalcula el saldo real (cadena + cache) de cada cuenta afectada. La caja
  // chica no lo necesita: su saldo se calcula como suma de montos.
  for (const cId of cuentasAfectadas) {
    await recalcCadenaSaldoCuenta(cId)
  }

  return { success: true, error: null }
}

// ==================== ABONOS A GASTOS ====================

/**
 * Recalcula `monto_pagado` y `estado_pago` de un gasto.
 * Como nuestra fuente de verdad son los movimientos (caja+cuenta), sumamos
 * los movimientos con ref_tipo='gasto' y ref_id=gasto_id.
 */
async function recalcularEstadoGasto(
  supabase: NonNullable<ReturnType<typeof createClient>>,
  gasto_id: number
): Promise<void> {
  const { data: gastoRow } = await supabase
    .from('gastos')
    .select('monto')
    .eq('id', gasto_id)
    .maybeSingle()
  if (!gastoRow) return

  // Sumar movimientos en caja chica (Salida -> monto negativo, lo invertimos).
  const { data: cajaMovs } = await supabase
    .from('caja_chica_movimientos')
    .select('monto')
    .eq('ref_tipo', 'gasto')
    .eq('ref_id', gasto_id)

  const cajaTotal = (cajaMovs || []).reduce(
    (acc, m) => acc + Math.abs(Number(m.monto || 0)),
    0
  )

  // Sumar movimientos en cuenta bancaria.
  const { data: cuentaMovs } = await supabase
    .from('cuenta_movimientos')
    .select('monto')
    .eq('ref_tipo', 'gasto')
    .eq('ref_id', gasto_id)

  const cuentaTotal = (cuentaMovs || []).reduce(
    (acc, m) => acc + Number(m.monto || 0),
    0
  )

  const totalPagado = +(cajaTotal + cuentaTotal).toFixed(2)
  const monto = Number(gastoRow.monto || 0)
  let estado: EstadoPagoGasto = 'Pendiente'
  if (totalPagado <= 0) estado = 'Pendiente'
  else if (totalPagado >= monto - 0.005) estado = 'Pagado'
  else estado = 'Parcial'

  await supabase
    .from('gastos')
    .update({ monto_pagado: totalPagado, estado_pago: estado })
    .eq('id', gasto_id)
}

/**
 * Registra un abono a un gasto (parcial o total).
 *
 * Flujo (sin tabla `gastos_pagos_detalle`):
 *   1. Validar saldo pendiente.
 *   2. Crear movimiento en caja_chica_movimientos (efectivo) o
 *      cuenta_movimientos (banco), con ref_tipo='gasto' y ref_id=gasto_id.
 *      Estos servicios ya inyectan razon_social_id y manejan saldos.
 *   3. Recalcular monto_pagado y estado_pago en `gastos`.
 *
 * No requiere ninguna tabla extra: solo las que el usuario confirmo.
 */
export async function registrarPagoGasto(input: {
  gasto_id: number
  monto: number
  metodo_pago: 'Efectivo' | 'Banco'
  cuenta_id?: number | null
  concepto?: string
}): Promise<{ data: { caja_movimiento_id?: number; cuenta_movimiento_id?: number } | null; error: string | null }> {
  if (input.monto <= 0) {
    return { data: null, error: 'El monto debe ser mayor a 0' }
  }
  if (input.metodo_pago === 'Banco' && !input.cuenta_id) {
    return { data: null, error: 'Seleccione la cuenta bancaria' }
  }

  if (!isSupabaseConfigured()) {
    return { data: null, error: 'Cliente no disponible' }
  }
  const supabase = createClient()
  if (!supabase) return { data: null, error: 'Cliente no disponible' }

  // Saldo pendiente del gasto (con join a proveedor para concepto descriptivo).
  const { data: gastoRow, error: gErr } = await supabase
    .from('gastos')
    .select('id, monto, monto_pagado, proveedor_id, proveedores:proveedor_id(nombre)')
    .eq('id', input.gasto_id)
    .maybeSingle()
  if (gErr) return { data: null, error: gErr.message }
  if (!gastoRow) return { data: null, error: 'Gasto no encontrado' }

  const monto = Number(gastoRow.monto || 0)
  const pagado = Number(gastoRow.monto_pagado || 0)
  const saldo = +(monto - pagado).toFixed(2)
  if (input.monto > saldo + 0.005) {
    return { data: null, error: `El monto excede el saldo pendiente (L ${saldo.toFixed(2)})` }
  }

  const provNombre =
    Array.isArray(gastoRow.proveedores)
      ? gastoRow.proveedores[0]?.nombre
      : (gastoRow.proveedores as { nombre?: string } | null)?.nombre
  const conceptoBase =
    input.concepto ||
    `Pago gasto #${gastoRow.id}` + (provNombre ? ` - ${provNombre}` : '')

  // Crear movimiento espejo en caja o cuenta. Estos servicios ya inyectan
  // razon_social_id, validan saldo y mantienen saldo_resultante.
  let cajaMovId: number | undefined
  let cuentaMovId: number | undefined

  if (input.metodo_pago === 'Efectivo') {
    const { data: mov, error } = await registrarMovimientoCaja({
      tipo: 'Salida',
      monto: input.monto,
      concepto: conceptoBase,
      ref_tipo: 'gasto',
      ref_id: gastoRow.id,
    })
    if (error) return { data: null, error }
    cajaMovId = mov?.id
  } else {
    const { data: mov, error } = await registrarMovimientoCuenta({
      cuenta_id: input.cuenta_id!,
      tipo: 'Egreso',
      monto: input.monto,
      concepto: conceptoBase,
      ref_tipo: 'gasto',
      ref_id: gastoRow.id,
    })
    if (error) return { data: null, error }
    cuentaMovId = mov?.id
  }

  // Recalcular estado del gasto.
  await recalcularEstadoGasto(supabase, gastoRow.id)

  return {
    data: { caja_movimiento_id: cajaMovId, cuenta_movimiento_id: cuentaMovId },
    error: null,
  }
}

/**
 * Lista los abonos de un gasto reconstruyendolos desde caja_chica_movimientos
 * y cuenta_movimientos (con ref_tipo='gasto' y ref_id=gasto_id).
 */
export async function getPagosGasto(
  gasto_id: number
): Promise<{ data: GastoPago[]; error: string | null }> {
  if (!isSupabaseConfigured()) return { data: [], error: null }
  const supabase = createClient()
  if (!supabase) return { data: [], error: 'Cliente no disponible' }

  const [cajaRes, cuentaRes] = await Promise.all([
    supabase
      .from('caja_chica_movimientos')
      .select('id, fecha, monto, concepto')
      .eq('ref_tipo', 'gasto')
      .eq('ref_id', gasto_id)
      .order('fecha', { ascending: false }),
    supabase
      .from('cuenta_movimientos')
      .select('id, fecha, monto, concepto, cuenta_id, cuentas_config:cuenta_id(nombre)')
      .eq('ref_tipo', 'gasto')
      .eq('ref_id', gasto_id)
      .order('fecha', { ascending: false }),
  ])

  const pagos: GastoPago[] = []

  for (const m of cajaRes.data || []) {
    pagos.push({
      id: m.id,
      fecha_pago: m.fecha,
      monto: Math.abs(Number(m.monto || 0)),
      metodo_pago: 'Efectivo',
      cuenta_id: null,
      cuenta_nombre: null,
      concepto: m.concepto ?? null,
      origen: 'caja',
    })
  }
  for (const m of cuentaRes.data || []) {
    const cuenta = Array.isArray(m.cuentas_config) ? m.cuentas_config[0] : m.cuentas_config
    pagos.push({
      id: m.id,
      fecha_pago: m.fecha,
      monto: Number(m.monto || 0),
      metodo_pago: 'Banco',
      cuenta_id: m.cuenta_id ?? null,
      cuenta_nombre: cuenta?.nombre ?? null,
      concepto: m.concepto ?? null,
      origen: 'cuenta',
    })
  }

  // Ordenar todo por fecha desc.
  pagos.sort((a, b) => new Date(b.fecha_pago).getTime() - new Date(a.fecha_pago).getTime())
  return { data: pagos, error: null }
}

/**
 * Devuelve la lista de cuentas por pagar (deuda viva). Calcula desde la
 * tabla `gastos` directamente: filtra estado_pago != 'Pagado'. NO depende
 * de ninguna vista externa.
 */
export async function getCuentasPorPagar(): Promise<{
  data: CuentaPorPagar[]
  totalDeuda: number
  error: string | null
}> {
  if (!isSupabaseConfigured()) {
    return { data: [], totalDeuda: 0, error: null }
  }
  const supabase = createClient()
  if (!supabase) {
    return { data: [], totalDeuda: 0, error: 'Cliente no disponible' }
  }

  let result = await supabase
    .from('gastos')
    .select(`
      id, concepto_id, fecha_gasto, fecha_vencimiento, monto, monto_pagado,
      estado_pago, descripcion, comprobante_url, proveedor_id,
      conceptos_gastos:concepto_id (nombre, categoria_macro),
      proveedores:proveedor_id (nombre)
    `)
    .neq('estado_pago', 'Pagado')
    .order('fecha_vencimiento', { ascending: true, nullsFirst: false })

  if (
    result.error &&
    /proveedor|relation .*proveedores.* does not exist/i.test(result.error.message)
  ) {
    // El retry no trae `proveedores`, por eso el cast: RowShape ya trata
    // ese campo como opcional al mapear.
    result = (await supabase
      .from('gastos')
      .select(`
        id, concepto_id, fecha_gasto, fecha_vencimiento, monto, monto_pagado,
        estado_pago, descripcion, comprobante_url, proveedor_id,
        conceptos_gastos:concepto_id (nombre, categoria_macro)
      `)
      .neq('estado_pago', 'Pagado')
      .order('fecha_vencimiento', { ascending: true, nullsFirst: false })) as unknown as typeof result
  }

  if (result.error) {
    return { data: [], totalDeuda: 0, error: result.error.message }
  }

  type RowShape = {
    id: number
    concepto_id: number
    fecha_gasto: string
    fecha_vencimiento: string | null
    monto: number | null
    monto_pagado: number | null
    estado_pago: 'Pendiente' | 'Parcial'
    descripcion: string | null
    comprobante_url: string | null
    proveedor_id: number | null
    conceptos_gastos?:
      | { nombre?: string; categoria_macro?: CategoriaMacro }
      | { nombre?: string; categoria_macro?: CategoriaMacro }[]
      | null
    proveedores?: { nombre?: string } | { nombre?: string }[] | null
  }

  const rows: CuentaPorPagar[] = ((result.data as RowShape[]) || []).map((g) => {
    const concepto = Array.isArray(g.conceptos_gastos)
      ? g.conceptos_gastos[0]
      : g.conceptos_gastos
    const prov = Array.isArray(g.proveedores) ? g.proveedores[0] : g.proveedores
    const monto = Number(g.monto || 0)
    const pagado = Number(g.monto_pagado || 0)
    const dias = g.fecha_vencimiento
      ? Math.floor(
          (Date.now() - new Date(g.fecha_vencimiento).getTime()) /
            (1000 * 60 * 60 * 24)
        )
      : null
    return {
      id: g.id,
      concepto_id: g.concepto_id,
      concepto_nombre: concepto?.nombre ?? null,
      categoria_macro: concepto?.categoria_macro ?? null,
      proveedor_id: g.proveedor_id ?? null,
      proveedor_nombre: prov?.nombre ?? null,
      fecha_gasto: g.fecha_gasto,
      fecha_vencimiento: g.fecha_vencimiento ?? null,
      monto,
      monto_pagado: pagado,
      saldo_pendiente: +(monto - pagado).toFixed(2),
      estado_pago: g.estado_pago,
      descripcion: g.descripcion ?? null,
      comprobante_url: g.comprobante_url ?? null,
      dias_vencido: dias,
    }
  })

  const total = rows.reduce((a, r) => a + r.saldo_pendiente, 0)
  return { data: rows, totalDeuda: +total.toFixed(2), error: null }
}

// ==================== UPLOAD COMPROBANTE ====================

export async function uploadComprobante(file: File): Promise<{ url: string | null; error: string | null }> {
  if (!isSupabaseConfigured()) {
    const url = URL.createObjectURL(file)
    return { url, error: null }
  }

  const supabase = createClient()
  if (!supabase) return { url: null, error: 'Cliente no disponible' }

  const fileExt = file.name.split('.').pop()
  const fileName = `${Date.now()}.${fileExt}`
  const filePath = `${STORAGE_PREFIX}comprobantes/${fileName}`

  const { error: uploadError } = await supabase.storage
    .from('gastos')
    .upload(filePath, file)

  if (uploadError) return { url: null, error: uploadError.message }

  const { data } = supabase.storage.from('gastos').getPublicUrl(filePath)
  return { url: data.publicUrl, error: null }
}

// ==================== ESTADISTICAS ====================

export async function getGastosDelMes(): Promise<{
  total: number
  porCategoria: Record<string, number>
  error: string | null
}> {
  const now = new Date()
  const primerDiaMes = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0]
  const ultimoDiaMes = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0]

  if (!isSupabaseConfigured()) {
    const savedGastos = localStorage.getItem('gastos')
    const savedConceptos = localStorage.getItem('conceptos_gastos')
    const gastos: Gasto[] = savedGastos ? JSON.parse(savedGastos) : []
    const conceptos: ConceptoGasto[] = savedConceptos ? JSON.parse(savedConceptos) : []
    const gastosMes = gastos.filter((g) => g.fecha_gasto >= primerDiaMes && g.fecha_gasto <= ultimoDiaMes)
    const total = gastosMes.reduce((acc, g) => acc + g.monto, 0)
    const porCategoria: Record<string, number> = {}
    gastosMes.forEach((g) => {
      const c = conceptos.find((c) => c.id === g.concepto_id)
      const cat = c?.categoria_macro || 'Otros'
      porCategoria[cat] = (porCategoria[cat] || 0) + g.monto
    })
    return { total, porCategoria, error: null }
  }

  const supabase = createClient()
  if (!supabase) return { total: 0, porCategoria: {}, error: 'Cliente no disponible' }

  const { data, error } = await supabase
    .from('gastos')
    .select(`
      monto,
      conceptos_gastos:concepto_id (categoria_macro)
    `)
    .gte('fecha_gasto', primerDiaMes)
    .lte('fecha_gasto', ultimoDiaMes)

  if (error) return { total: 0, porCategoria: {}, error: error.message }

  const total = (data || []).reduce((acc, g) => acc + Number(g.monto || 0), 0)
  const porCategoria: Record<string, number> = {}
  ;(data || []).forEach((g) => {
    const c = Array.isArray(g.conceptos_gastos) ? g.conceptos_gastos[0] : g.conceptos_gastos
    const cat = c?.categoria_macro || 'Otros'
    porCategoria[cat] = (porCategoria[cat] || 0) + Number(g.monto || 0)
  })

  return { total, porCategoria, error: null }
}
