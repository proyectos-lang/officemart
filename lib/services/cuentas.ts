import { createClient, isSupabaseConfigured } from "@/lib/supabase/client"
import {
  getTenantStamp,
  isValidStamp,
  SESION_INVALIDA_ERROR,
} from "@/lib/services/tenant-stamp"
import { getHondurasNowISO } from "@/lib/utils/honduras-time"

// ==================== INTERFACES ====================

export interface CuentaConfig {
  id?: number
  nombre: string
  tipo: "Banco" | "Link_Pago" | "Otro"
  porcentaje_comision: number // 0..100
  activo?: boolean
  saldo?: number // calculado por el backend
  created_at?: string
  /**
   * Saldo de apertura. SOLO entrada de UI al crear la cuenta — no es una
   * columna de la BD. Si es > 0, `saveCuenta` registra un movimiento de
   * Ingreso 'Saldo inicial' tras crear la cuenta (el saldo lo gobierna el
   * motor de movimientos, no se escribe `saldo` directo).
   */
  saldo_inicial?: number
}

export interface CuentaMovimiento {
  id?: number
  cuenta_id: number
  fecha?: string
  tipo: "Ingreso" | "Egreso"
  monto: number
  concepto?: string
  ref_tipo?: string
  ref_id?: number
  saldo_resultante?: number
  usuario?: string
  /** Nº de transferencia/cheque/autorización (script officemart-001). Sirve para el pareo bancario. */
  referencia?: string | null
  /** Fecha en que la conciliación bancaria pareó este movimiento con el extracto (null = sin conciliar). */
  conciliado_at?: string | null
}

/**
 * Indicador comun de "feature pendiente" cuando la tabla `cuentas_config`
 * o `cuenta_movimientos` aun no existe (migracion 011 sin aplicar). Las
 * paginas pueden mostrar un banner especifico en este caso.
 */
export const CUENTAS_FEATURE_PENDING = "feature_pending"

/**
 * Detecta SOLO cuando una de las tablas (`cuentas_config` /
 * `cuenta_movimientos`) realmente no existe en la base de datos. Distingue
 * entre tabla faltante (codigo 42P01 / PGRST205) y otros errores que
 * mencionan el nombre de la tabla en el mensaje (RLS, columna inexistente,
 * tipo invalido, etc.) que NO deben encender el banner de "feature pendiente".
 */
function isMissingTableError(
  err: { message?: string; code?: string } | null
): boolean {
  if (!err) return false
  if (err.code === "42P01" || err.code === "PGRST205") return true
  const msg = (err.message || "").toLowerCase()
  // Solo el patron canonico de Postgres: 'relation "X" does not exist'
  return /relation\s+"?(?:public\.)?(?:cuentas_config|cuenta_movimientos)"?\s+does not exist/.test(
    msg
  )
}

// ==================== CRUD CUENTAS ====================

export async function getCuentas(): Promise<{
  data: CuentaConfig[]
  error: string | null
}> {
  if (!isSupabaseConfigured()) {
    const saved = localStorage.getItem("cuentas_config")
    return { data: saved ? JSON.parse(saved) : [], error: null }
  }

  const supabase = createClient()
  if (!supabase) return { data: [], error: "Cliente no disponible" }

  try {
    // La columna real en BD es `comision_porcentaje`. El alias de PostgREST
    // (sintaxis: alias:columna) la entrega como `porcentaje_comision` en
    // el cliente, que es como la conoce el resto del frontend.
    const { data, error } = await supabase
      .from("cuentas_config")
      .select("id, nombre, tipo, activo, saldo, created_at, porcentaje_comision:comision_porcentaje")
      .order("id", { ascending: true })

    if (error) {
      if (isMissingTableError(error)) {
        return { data: [], error: CUENTAS_FEATURE_PENDING }
      }
      return { data: [], error: error.message }
    }
    return { data: (data || []) as CuentaConfig[], error: null }
  } catch (err) {
    console.error("[Supabase] Error obteniendo cuentas:", err)
    return { data: [], error: "Error de conexion" }
  }
}

export async function getCuentaById(
  id: number
): Promise<{ data: CuentaConfig | null; error: string | null }> {
  const supabase = createClient()
  if (!supabase) return { data: null, error: "Cliente no disponible" }

  const { data, error } = await supabase
    .from("cuentas_config")
    .select("id, nombre, tipo, activo, saldo, created_at, porcentaje_comision:comision_porcentaje")
    .eq("id", id)
    .single()

  if (error) return { data: null, error: error.message }
  return { data: data as CuentaConfig, error: null }
}

export async function saveCuenta(
  cuenta: CuentaConfig,
  isNew: boolean
): Promise<{ data: CuentaConfig | null; error: string | null }> {
  if (!isSupabaseConfigured()) {
    const saved = localStorage.getItem("cuentas_config")
    const cuentas: CuentaConfig[] = saved ? JSON.parse(saved) : []
    if (isNew) {
      const nueva = { ...cuenta, id: Date.now(), saldo: 0 }
      cuentas.push(nueva)
      localStorage.setItem("cuentas_config", JSON.stringify(cuentas))
      return { data: nueva, error: null }
    } else {
      const idx = cuentas.findIndex((c) => c.id === cuenta.id)
      if (idx >= 0) cuentas[idx] = { ...cuentas[idx], ...cuenta }
      localStorage.setItem("cuentas_config", JSON.stringify(cuentas))
      return { data: cuentas[idx] ?? cuenta, error: null }
    }
  }

  const supabase = createClient()
  if (!supabase) return { data: null, error: "Cliente no disponible" }

  if (isNew) {
    const stamp = await getTenantStamp(supabase)
    if (!isValidStamp(stamp)) {
      return { data: null, error: SESION_INVALIDA_ERROR }
    }
    // Mapeamos el campo del frontend (`porcentaje_comision`) a la columna
    // real de la BD (`comision_porcentaje`). Tambien excluimos `saldo`
    // del payload: la BD pone 0 por default y el saldo lo gobierna el
    // motor de movimientos.
    // `saldo` y `saldo_inicial` NO son columnas persistibles del insert:
    // el saldo lo gobierna el motor de movimientos.
    const { id: _omit, saldo: _s, saldo_inicial, porcentaje_comision, ...rest } = cuenta
    const insertPayload = {
      ...rest,
      comision_porcentaje: porcentaje_comision ?? 0,
      ...stamp,
    }
    const { data, error } = await supabase
      .from("cuentas_config")
      .insert(insertPayload)
      .select("id, nombre, tipo, activo, saldo, created_at, porcentaje_comision:comision_porcentaje")
      .single()
    if (error) {
      if (isMissingTableError(error)) {
        return { data: null, error: CUENTAS_FEATURE_PENDING }
      }
      return { data: null, error: error.message }
    }

    // Saldo de apertura: registra un Ingreso 'Saldo inicial' (reutiliza el
    // motor de movimientos, que actualiza el saldo cacheado de la cuenta).
    const cuentaCreada = data as CuentaConfig
    if (saldo_inicial && saldo_inicial > 0 && cuentaCreada.id != null) {
      const apertura = await registrarMovimientoCuenta({
        cuenta_id: cuentaCreada.id,
        tipo: "Ingreso",
        monto: saldo_inicial,
        concepto: "Saldo inicial",
        ref_tipo: "apertura",
      })
      if (apertura.error) {
        // La cuenta ya existe; solo falló el asiento de apertura. No abortamos
        // la creación, pero informamos para que el usuario lo registre a mano.
        return {
          data: { ...cuentaCreada, saldo: cuentaCreada.saldo ?? 0 },
          error: `Cuenta creada, pero no se pudo registrar el saldo inicial: ${apertura.error}`,
        }
      }
      return { data: { ...cuentaCreada, saldo: saldo_inicial }, error: null }
    }

    return { data: cuentaCreada, error: null }
  }

  // Update: jamas tocamos razon_social_id ni saldo (este lo gobierna el motor
  // de movimientos). Solo nombre, tipo, comision y activo.
  const updatePayload = {
    nombre: cuenta.nombre,
    tipo: cuenta.tipo,
    comision_porcentaje: cuenta.porcentaje_comision,
    activo: cuenta.activo ?? true,
  }
  const { data, error } = await supabase
    .from("cuentas_config")
    .update(updatePayload)
    .eq("id", cuenta.id)
    .select("id, nombre, tipo, activo, saldo, created_at, porcentaje_comision:comision_porcentaje")
    .single()
  if (error) return { data: null, error: error.message }
  return { data: data as CuentaConfig, error: null }
}

export async function deleteCuenta(
  id: number
): Promise<{ success: boolean; error: string | null }> {
  if (!isSupabaseConfigured()) {
    const saved = localStorage.getItem("cuentas_config")
    const cuentas: CuentaConfig[] = saved ? JSON.parse(saved) : []
    const filtered = cuentas.filter((c) => c.id !== id)
    localStorage.setItem("cuentas_config", JSON.stringify(filtered))
    return { success: true, error: null }
  }

  const supabase = createClient()
  if (!supabase) return { success: false, error: "Cliente no disponible" }

  const { error } = await supabase
    .from("cuentas_config")
    .delete()
    .eq("id", id)
  if (error) {
    // Foreign key violation: la cuenta tiene movimientos.
    if (/foreign key|violates/i.test(error.message)) {
      return {
        success: false,
        error:
          "No se puede eliminar: la cuenta tiene movimientos asociados. Desactivela en lugar de eliminar.",
      }
    }
    return { success: false, error: error.message }
  }
  return { success: true, error: null }
}

// ==================== MOVIMIENTOS ====================

/**
 * Registra un movimiento en la cuenta y actualiza su saldo running.
 * No es una transaccion atomica de Postgres (Supabase REST no expone tx),
 * pero el orden minimiza estados inconsistentes:
 *   1. SELECT saldo actual
 *   2. Calcula saldo_resultante
 *   3. INSERT movimiento con saldo_resultante
 *   4. UPDATE cuentas_config.saldo
 *
 * Si (4) falla, el movimiento queda pero el saldo cacheado en cuentas_config
 * queda desactualizado. Se puede reconciliar con `recalcSaldoCuenta(id)`.
 */
export async function registrarMovimientoCuenta(input: {
  cuenta_id: number
  tipo: "Ingreso" | "Egreso"
  monto: number
  concepto?: string
  ref_tipo?: string
  ref_id?: number
  /**
   * Fecha del movimiento en ISO HN-as-UTC (ver getHondurasNowISO). Si se omite
   * es AHORA. Se usa para asientos con fecha pasada (línea del extracto en la
   * conciliación, saldos iniciales). No puede ser futura ni caer dentro de un
   * período ya conciliado de la cuenta.
   */
  fecha?: string
  /** Nº de transferencia/cheque/autorización: mejora el pareo bancario. */
  referencia?: string | null
}): Promise<{ data: CuentaMovimiento | null; error: string | null }> {
  if (!isSupabaseConfigured()) {
    return { data: null, error: "Cliente no disponible" }
  }

  const supabase = createClient()
  if (!supabase) return { data: null, error: "Cliente no disponible" }

  const stamp = await getTenantStamp(supabase)
  if (!isValidStamp(stamp)) {
    return { data: null, error: SESION_INVALIDA_ERROR }
  }

  // 0. Fecha explícita: validarla antes de tocar nada.
  const ahora = getHondurasNowISO()
  const fechaExplicita = (input.fecha || "").trim() || null
  if (fechaExplicita) {
    const invalida = validarFechaMovimiento(fechaExplicita, ahora)
    if (invalida) return { data: null, error: invalida }
    const cerrado = await fechaEnPeriodoConciliado(supabase, input.cuenta_id, fechaExplicita)
    if (cerrado) return { data: null, error: cerrado }
  }

  // 1. Saldo actual
  const { data: cuenta, error: cErr } = await supabase
    .from("cuentas_config")
    .select("saldo")
    .eq("id", input.cuenta_id)
    .single()
  if (cErr) {
    if (isMissingTableError(cErr)) {
      return { data: null, error: CUENTAS_FEATURE_PENDING }
    }
    return { data: null, error: cErr.message }
  }

  const saldoActual = Number(cuenta?.saldo ?? 0)
  const delta = input.tipo === "Ingreso" ? input.monto : -input.monto
  const saldoResultante = +(saldoActual + delta).toFixed(2)

  // 2. INSERT movimiento
  const fila: Record<string, unknown> = {
    cuenta_id: input.cuenta_id,
    tipo: input.tipo,
    monto: input.monto,
    concepto: input.concepto,
    ref_tipo: input.ref_tipo,
    ref_id: input.ref_id,
    saldo_resultante: saldoResultante,
    // Fecha HN-as-UTC (dia de negocio): Movimientos/Consolidacion la muestran
    // con .split('T')[0]/.slice(0,10) y cierre-diario la filtra por dia HN.
    fecha: fechaExplicita ?? ahora,
    ...stamp,
  }
  const referencia = (input.referencia || "").trim()
  if (referencia) fila.referencia = referencia

  let { data: mov, error: mErr } = await supabase
    .from("cuenta_movimientos")
    .insert(fila)
    .select()
    .single()
  if (mErr && referencia && /referencia/i.test(mErr.message || "")) {
    // Columna `referencia` pendiente (script officemart-001): reintentar sin ella.
    delete fila.referencia
    const retry = await supabase.from("cuenta_movimientos").insert(fila).select().single()
    mov = retry.data
    mErr = retry.error
  }
  if (mErr) {
    if (isMissingTableError(mErr)) {
      return { data: null, error: CUENTAS_FEATURE_PENDING }
    }
    return { data: null, error: mErr.message }
  }

  // 3. Con fecha pasada, el `saldo_resultante` recién escrito (cache + delta)
  // no es el cronológico: se reescribe toda la cadena por (fecha, id), que
  // además deja el cache al día. Sin fecha explícita, basta actualizar el
  // cache; si eso falla, reconciliamos desde la suma real.
  if (fechaExplicita) {
    await recalcCadenaSaldoCuenta(input.cuenta_id)
  } else {
    const { error: saldoErr } = await supabase
      .from("cuentas_config")
      .update({ saldo: saldoResultante })
      .eq("id", input.cuenta_id)
    if (saldoErr) {
      await recalcCadenaSaldoCuenta(input.cuenta_id)
    }
  }

  return { data: mov as CuentaMovimiento, error: null }
}

/**
 * Valida una fecha explícita de movimiento (función pura). Debe ser ISO
 * parseable y no posterior a `ahora` (ambas en la misma convención HN-as-UTC).
 * Devuelve el mensaje de error o null si es válida.
 */
export function validarFechaMovimiento(fecha: string, ahora: string): string | null {
  const t = Date.parse(fecha)
  if (Number.isNaN(t)) return "La fecha del movimiento no es válida"
  // Tolerancia de 1 minuto por desfase de reloj entre cliente y servidor.
  if (t > Date.parse(ahora) + 60_000) return "La fecha del movimiento no puede ser futura"
  return null
}

/**
 * Si la cuenta tiene una conciliación bancaria CERRADA cuyo período cubre la
 * fecha, devuelve el mensaje de bloqueo. Sin tabla de extractos (módulo
 * pendiente) no bloquea.
 */
async function fechaEnPeriodoConciliado(
  supabase: NonNullable<ReturnType<typeof createClient>>,
  cuentaId: number,
  fechaISO: string
): Promise<string | null> {
  const { data, error } = await supabase
    .from("bancos_extractos")
    .select("periodo_hasta")
    .eq("cuenta_id", cuentaId)
    .eq("estado", "Conciliado")
    .order("periodo_hasta", { ascending: false })
    .limit(1)
  if (error || !data || data.length === 0) return null
  const hasta = String(data[0].periodo_hasta || "")
  if (!hasta) return null
  if (fechaISO.slice(0, 10) <= hasta) {
    return `La cuenta ya está conciliada hasta el ${hasta}. Usa una fecha posterior o reabre la conciliación.`
  }
  return null
}

/**
 * Reconciliacion: recalcula el saldo de una cuenta desde la SUMA REAL de sus
 * movimientos (Ingresos - Egresos) y corrige el cache `cuentas_config.saldo`.
 * Uti para cuando el cache derivo (ej. un update fallo a mitad).
 * Devuelve el saldo anterior y el recalculado.
 */
export async function recalcSaldoCuenta(
  cuenta_id: number
): Promise<{ saldoAnterior: number; saldoRecalculado: number; error: string | null }> {
  const supabase = createClient()
  if (!supabase) return { saldoAnterior: 0, saldoRecalculado: 0, error: "Cliente no disponible" }

  const { data: cuenta, error: cErr } = await supabase
    .from("cuentas_config")
    .select("saldo")
    .eq("id", cuenta_id)
    .single()
  if (cErr) return { saldoAnterior: 0, saldoRecalculado: 0, error: cErr.message }
  const saldoAnterior = Number(cuenta?.saldo ?? 0)

  // Suma real de TODOS los movimientos de la cuenta.
  const { data: movs, error: mErr } = await supabase
    .from("cuenta_movimientos")
    .select("tipo, monto")
    .eq("cuenta_id", cuenta_id)
  if (mErr) return { saldoAnterior, saldoRecalculado: saldoAnterior, error: mErr.message }

  const saldoRecalculado = +(movs || [])
    .reduce((a, m) => a + (m.tipo === "Ingreso" ? Number(m.monto || 0) : -Number(m.monto || 0)), 0)
    .toFixed(2)

  if (saldoRecalculado !== saldoAnterior) {
    const { error: uErr } = await supabase
      .from("cuentas_config")
      .update({ saldo: saldoRecalculado })
      .eq("id", cuenta_id)
    if (uErr) return { saldoAnterior, saldoRecalculado, error: uErr.message }
  }

  return { saldoAnterior, saldoRecalculado, error: null }
}

/** Fila mínima para recalcular la cadena de saldos (función pura abajo). */
export interface MovimientoCadena {
  id: number
  fecha?: string | null
  tipo: "Ingreso" | "Egreso" | string
  monto: number | null
  saldo_resultante?: number | null
}

/**
 * Recalcula la cadena `saldo_resultante` en orden CRONOLÓGICO (fecha, id) —
 * función pura. Devuelve solo las filas cuyo saldo guardado difiere del
 * recalculado (para escribir lo mínimo) y el saldo final de la cuenta.
 */
export function recalcularCadena(movs: MovimientoCadena[]): {
  cambios: { id: number; saldo_resultante: number }[]
  saldoFinal: number
} {
  const ordenados = [...movs].sort((a, b) => {
    const fa = a.fecha || ""
    const fb = b.fecha || ""
    if (fa !== fb) return fa < fb ? -1 : 1
    return a.id - b.id
  })
  const cambios: { id: number; saldo_resultante: number }[] = []
  let acc = 0
  for (const m of ordenados) {
    const delta = m.tipo === "Ingreso" ? Number(m.monto || 0) : -Number(m.monto || 0)
    acc = +(acc + delta).toFixed(2)
    if (Number(m.saldo_resultante ?? 0) !== acc) cambios.push({ id: m.id, saldo_resultante: acc })
  }
  return { cambios, saldoFinal: acc }
}

/**
 * Recalcula la CADENA de saldos de una cuenta: recorre sus movimientos por
 * (fecha, id) — orden cronológico, porque un movimiento puede registrarse con
 * fecha pasada (conciliación, saldos iniciales) — sumando Ingresos - Egresos,
 * reescribe el `saldo_resultante` de cada uno que haya quedado desfasado y
 * actualiza el cache `cuentas_config.saldo` al saldo final.
 *
 * Se usa tras BORRAR movimientos (p. ej. al eliminar/editar una venta pagada
 * por banco) o tras INSERTAR uno con fecha pasada: el `saldo_resultante` es
 * una foto que queda obsoleta. Asi la lista de Movimientos y el saldo quedan
 * con datos REALES sin depender de valores viejos. Mismo criterio que el
 * trigger `tg_limpiar_tesoreria_ref` (scripts/officemart-001).
 */
export async function recalcCadenaSaldoCuenta(
  cuenta_id: number
): Promise<{ saldoFinal: number; error: string | null }> {
  const supabase = createClient()
  if (!supabase) return { saldoFinal: 0, error: "Cliente no disponible" }

  const { data: movs, error } = await supabase
    .from("cuenta_movimientos")
    .select("id, fecha, tipo, monto, saldo_resultante")
    .eq("cuenta_id", cuenta_id)
    .order("fecha", { ascending: true })
    .order("id", { ascending: true })
  if (error) return { saldoFinal: 0, error: error.message }

  const { cambios, saldoFinal } = recalcularCadena((movs || []) as MovimientoCadena[])
  for (const c of cambios) {
    await supabase
      .from("cuenta_movimientos")
      .update({ saldo_resultante: c.saldo_resultante })
      .eq("id", c.id)
  }
  await supabase.from("cuentas_config").update({ saldo: saldoFinal }).eq("id", cuenta_id)
  return { saldoFinal, error: null }
}

export async function getMovimientosCuenta(
  cuenta_id: number,
  opts: { desde?: string; hasta?: string; limit?: number } = {}
): Promise<{ data: CuentaMovimiento[]; error: string | null }> {
  const { desde, hasta, limit = 200 } = opts
  const supabase = createClient()
  if (!supabase) return { data: [], error: "Cliente no disponible" }

  let query = supabase
    .from("cuenta_movimientos")
    .select("*")
    .eq("cuenta_id", cuenta_id)
  if (desde) query = query.gte("fecha", `${desde}T00:00:00`)
  if (hasta) query = query.lte("fecha", `${hasta}T23:59:59`)

  // (fecha, id) desc: con movimientos de fecha pasada, el orden de inserción ya
  // no coincide con el cronológico y `saldo_resultante` debe leerse en cadena.
  const { data, error } = await query
    .order("fecha", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit)

  if (error) return { data: [], error: error.message }
  return { data: data || [], error: null }
}

/** Movimiento de cuenta enriquecido con el nombre de la cuenta (para la vista general). */
export interface CuentaMovimientoConNombre extends CuentaMovimiento {
  cuenta_nombre: string
}

/**
 * Vista general de movimientos de TODAS las cuentas del tenant (o de una,
 * si se pasa `cuenta_id`), con filtro por rango de fechas. Devuelve tambien
 * los totales de ingresos y egresos del conjunto filtrado.
 */
export async function getMovimientosTodasLasCuentas(
  opts: { desde?: string; hasta?: string; cuenta_id?: number; limit?: number } = {}
): Promise<{
  data: CuentaMovimientoConNombre[]
  totalIngresos: number
  totalEgresos: number
  error: string | null
}> {
  const { desde, hasta, cuenta_id, limit = 1000 } = opts
  const supabase = createClient()
  if (!supabase) return { data: [], totalIngresos: 0, totalEgresos: 0, error: "Cliente no disponible" }

  let query = supabase
    .from("cuenta_movimientos")
    .select("*, cuentas_config:cuenta_id (nombre)")
  if (cuenta_id) query = query.eq("cuenta_id", cuenta_id)
  if (desde) query = query.gte("fecha", `${desde}T00:00:00`)
  if (hasta) query = query.lte("fecha", `${hasta}T23:59:59`)

  const { data, error } = await query
    .order("fecha", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit)

  if (error) {
    if (isMissingTableError(error)) {
      return { data: [], totalIngresos: 0, totalEgresos: 0, error: CUENTAS_FEATURE_PENDING }
    }
    return { data: [], totalIngresos: 0, totalEgresos: 0, error: error.message }
  }

  let totalIngresos = 0
  let totalEgresos = 0
  const rows: CuentaMovimientoConNombre[] = (data || []).map((m) => {
    const cuenta = Array.isArray(m.cuentas_config) ? m.cuentas_config[0] : m.cuentas_config
    const monto = Number(m.monto || 0)
    if (m.tipo === "Ingreso") totalIngresos += monto
    else totalEgresos += monto
    return {
      ...(m as CuentaMovimiento),
      cuenta_nombre: (cuenta as { nombre?: string } | null)?.nombre || `Cuenta ${m.cuenta_id}`,
    }
  })

  return {
    data: rows,
    totalIngresos: +totalIngresos.toFixed(2),
    totalEgresos: +totalEgresos.toFixed(2),
    error: null,
  }
}

/**
 * Registra una transferencia entre dos cuentas bancarias: un Egreso en la
 * cuenta origen y un Ingreso en la destino, enlazados por `ref_tipo:'transferencia'`.
 * No es atomico (limitacion REST); si el segundo movimiento falla, se informa
 * para reconciliar manualmente.
 */
export async function transferirEntreCuentas(input: {
  origen_id: number
  destino_id: number
  monto: number
  concepto?: string
}): Promise<{ error: string | null }> {
  if (input.origen_id === input.destino_id) {
    return { error: "La cuenta origen y destino no pueden ser la misma" }
  }
  if (!input.monto || input.monto <= 0) {
    return { error: "El monto debe ser mayor a 0" }
  }

  const salida = await registrarMovimientoCuenta({
    cuenta_id: input.origen_id,
    tipo: "Egreso",
    monto: input.monto,
    concepto: input.concepto || `Transferencia a cuenta #${input.destino_id}`,
    ref_tipo: "transferencia",
    ref_id: input.destino_id,
  })
  if (salida.error) return { error: salida.error }

  const entrada = await registrarMovimientoCuenta({
    cuenta_id: input.destino_id,
    tipo: "Ingreso",
    monto: input.monto,
    concepto: input.concepto || `Transferencia desde cuenta #${input.origen_id}`,
    ref_tipo: "transferencia",
    ref_id: input.origen_id,
  })
  if (entrada.error) {
    return {
      error: `Se descontó de la cuenta origen pero falló el ingreso a la destino: ${entrada.error}. Reconciliar manualmente.`,
    }
  }

  return { error: null }
}
