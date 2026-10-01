import { createClient, isSupabaseConfigured } from "@/lib/supabase/client"
import { getTenantStamp, isValidStamp, SESION_INVALIDA_ERROR } from "@/lib/services/tenant-stamp"
import { getHondurasNowISO } from "@/lib/utils/honduras-time"
import { getOperaciones } from "@/lib/services/produccion-operaciones"

// ==================== PRODUCCIÓN · FLUJO POR ETAPAS (fase 2) =================
//
// Cada orden recorre las operaciones de la empresa (script 056) etapa por etapa.
// Las etapas de una orden se GENERAN congelando la secuencia vigente y luego
// avanzan: Pendiente → Recibida/En Proceso → Entregada. Degrada si el script
// 057 no se aplicó.

export type EstadoEtapa = "Pendiente" | "Recibida" | "En Proceso" | "Entregada"

export interface EtapaOrden {
  id: number
  orden_id: number
  operacion_id: number | null
  nombre: string
  orden_secuencia: number
  estado: EstadoEtapa
  responsable: string | null
  fecha_recepcion: string | null
  fecha_entrega: string | null
  cantidad_procesada: number | null
  notas: string | null
  /** Mano de obra declarada al entregar (script officemart-010). */
  costo_mano_obra?: number | null
}

/** Una orden con su recorrido de etapas (para el tablero de flujo). */
export interface OrdenFlujo {
  orden_id: number
  producto_nombre: string
  cantidad_objetivo: number
  fecha_objetivo: string | null
  estado_orden: string
  etapas: EtapaOrden[]
  /** Etapa "actual": la primera no entregada (o null si todo entregado). */
  etapaActual: EtapaOrden | null
  /** True si todas las etapas están entregadas. */
  completado: boolean
  /** OT libre (officemart-010): tipo, cliente y costo real. */
  tipo?: "Produccion" | "Trabajo" | null
  cliente_nombre?: string | null
  costo_total_real?: number | null
  created_at?: string | null
}

/** Columna del tablero de piso: una operación con sus órdenes en esa etapa. */
export interface ColumnaTablero {
  operacion_id: number | null
  nombre: string
  orden_secuencia: number
  ordenes: (OrdenFlujo & { etapa: EtapaOrden; dias_en_etapa: number })[]
}

/**
 * Tablero de piso (pura): agrupa las órdenes en flujo por la operación de su
 * etapa actual; las completadas van a la columna "Terminadas". `hoyISO` para
 * los días en etapa.
 */
export function agruparTableroPiso(flujos: OrdenFlujo[], hoyISO: string): ColumnaTablero[] {
  const cols = new Map<string, ColumnaTablero>()
  const dias = (desde: string | null) => {
    if (!desde) return 0
    const a = new Date(`${desde.slice(0, 10)}T00:00:00Z`).getTime()
    const b = new Date(`${hoyISO.slice(0, 10)}T00:00:00Z`).getTime()
    return Number.isNaN(a) || Number.isNaN(b) ? 0 : Math.max(0, Math.round((b - a) / 86_400_000))
  }
  for (const f of flujos) {
    if (f.completado || !f.etapaActual) {
      const k = "__done"
      let c = cols.get(k)
      if (!c) { c = { operacion_id: null, nombre: "Terminadas", orden_secuencia: 9999, ordenes: [] }; cols.set(k, c) }
      const ultima = f.etapas[f.etapas.length - 1]
      if (ultima) c.ordenes.push({ ...f, etapa: ultima, dias_en_etapa: dias(ultima.fecha_entrega) })
      continue
    }
    const e = f.etapaActual
    const k = e.operacion_id != null ? `op:${e.operacion_id}` : `nm:${e.nombre}`
    let c = cols.get(k)
    if (!c) { c = { operacion_id: e.operacion_id, nombre: e.nombre, orden_secuencia: e.orden_secuencia, ordenes: [] }; cols.set(k, c) }
    c.ordenes.push({ ...f, etapa: e, dias_en_etapa: dias(e.fecha_recepcion) })
  }
  const out = [...cols.values()]
  for (const c of out) c.ordenes.sort((a, b) => b.dias_en_etapa - a.dias_en_etapa)
  return out.sort((a, b) => a.orden_secuencia - b.orden_secuencia)
}

export const FLUJO_FEATURE_PENDING =
  "Función de flujo por etapas pendiente: aplica scripts/057-produccion-orden-etapas.sql en Supabase."

function isMissingTable(err: { message?: string; code?: string } | null): boolean {
  if (!err) return false
  const msg = (err.message || "").toLowerCase()
  return (
    err.code === "42P01" ||
    err.code === "PGRST205" ||
    /relation .*produccion_orden_etapas.* does not exist/.test(msg) ||
    msg.includes("could not find the table")
  )
}

function mapEtapa(e: Record<string, unknown>): EtapaOrden {
  return {
    id: Number(e.id),
    orden_id: Number(e.orden_id),
    operacion_id: e.operacion_id != null ? Number(e.operacion_id) : null,
    nombre: String(e.nombre || ""),
    orden_secuencia: Number(e.orden_secuencia || 0),
    estado: String(e.estado || "Pendiente") as EstadoEtapa,
    responsable: (e.responsable as string) ?? null,
    fecha_recepcion: (e.fecha_recepcion as string) ?? null,
    fecha_entrega: (e.fecha_entrega as string) ?? null,
    cantidad_procesada: e.cantidad_procesada != null ? Number(e.cantidad_procesada) : null,
    notas: (e.notas as string) ?? null,
    costo_mano_obra: e.costo_mano_obra != null ? Number(e.costo_mano_obra) : null,
  }
}

const COLS_ETAPA = "id, orden_id, operacion_id, nombre, orden_secuencia, estado, responsable, fecha_recepcion, fecha_entrega, cantidad_procesada, notas"

/** Etapas de una orden, en secuencia. */
export async function getEtapasOrden(ordenId: number): Promise<{ data: EtapaOrden[]; error: string | null }> {
  if (!isSupabaseConfigured()) return { data: [], error: null }
  const supabase = createClient()
  if (!supabase) return { data: [], error: "Cliente no disponible" }
  const { data, error } = await supabase
    .from("produccion_orden_etapas")
    .select(COLS_ETAPA)
    .eq("orden_id", ordenId)
    .order("orden_secuencia", { ascending: true })
  if (error) {
    if (isMissingTable(error)) return { data: [], error: null }
    return { data: [], error: error.message }
  }
  return { data: (data || []).map((e) => mapEtapa(e as Record<string, unknown>)), error: null }
}

/**
 * Genera las etapas de una orden congelando la secuencia de operaciones ACTIVAS
 * de la empresa. Idempotente: si la orden ya tiene etapas, no hace nada. La
 * primera etapa queda 'Recibida' (lista para trabajar); el resto 'Pendiente'.
 */
export async function generarEtapasOrden(
  ordenId: number,
  operacionIds?: number[],
): Promise<{ data: { creadas: number } | null; error: string | null }> {
  const supabase = createClient()
  if (!supabase) return { data: null, error: "Cliente no disponible" }
  const stamp = await getTenantStamp(supabase)
  if (!isValidStamp(stamp)) return { data: null, error: SESION_INVALIDA_ERROR }

  // ¿Ya tiene etapas?
  const { data: existentes, error: exErr } = await getEtapasOrden(ordenId)
  if (exErr) return { data: null, error: exErr }
  if (existentes.length > 0) return { data: { creadas: 0 }, error: null }

  // Secuencia vigente (operaciones activas), opcionalmente solo un subconjunto
  // (órdenes de trabajo que no pasan por todas las áreas).
  const { data: todas, error: opErr } = await getOperaciones({ soloActivas: true })
  if (opErr) return { data: null, error: opErr }
  const ops = operacionIds && operacionIds.length > 0 ? todas.filter((o) => operacionIds.includes(o.id)) : todas
  if (ops.length === 0) return { data: null, error: "No hay operaciones definidas. Crea la secuencia en Operaciones de Producción." }

  const nowHN = getHondurasNowISO()
  const filas = ops.map((op, i) => ({
    orden_id: ordenId,
    operacion_id: op.id,
    nombre: op.nombre,
    orden_secuencia: i + 1,
    // La primera etapa arranca Recibida (lista para trabajar); el resto Pendiente.
    estado: i === 0 ? "Recibida" : "Pendiente",
    fecha_recepcion: i === 0 ? nowHN : null,
    ...stamp,
  }))
  const { error } = await supabase.from("produccion_orden_etapas").insert(filas)
  if (error) {
    if (isMissingTable(error)) return { data: null, error: FLUJO_FEATURE_PENDING }
    return { data: null, error: error.message }
  }
  return { data: { creadas: filas.length }, error: null }
}

/**
 * Tablero de flujo: órdenes que ya tienen etapas generadas, con su recorrido y
 * su etapa actual. Resuelve el nombre del producto sin embed (no hay FK).
 */
export async function getFlujoOrdenes(): Promise<{ data: OrdenFlujo[]; error: string | null }> {
  if (!isSupabaseConfigured()) return { data: [], error: null }
  const supabase = createClient()
  if (!supabase) return { data: [], error: "Cliente no disponible" }

  const { data: etapasRaw, error } = await supabase
    .from("produccion_orden_etapas")
    .select(COLS_ETAPA)
    .order("orden_id", { ascending: false })
    .order("orden_secuencia", { ascending: true })
  if (error) {
    if (isMissingTable(error)) return { data: [], error: null }
    return { data: [], error: error.message }
  }
  const etapas = (etapasRaw || []).map((e) => mapEtapa(e as Record<string, unknown>))
  if (etapas.length === 0) return { data: [], error: null }

  // Agrupa por orden.
  const porOrden = new Map<number, EtapaOrden[]>()
  for (const e of etapas) {
    const arr = porOrden.get(e.orden_id) || []
    arr.push(e)
    porOrden.set(e.orden_id, arr)
  }
  const ordenIds = Array.from(porOrden.keys())

  // Datos de las órdenes (producto, cantidad, estado) sin embed. Columnas de
  // OT (officemart-010) con reintento sin ellas.
  let ordenesRaw: Record<string, unknown>[] = []
  const conOT = await supabase
    .from("produccion_ordenes")
    .select("id, producto_id, cantidad_objetivo, fecha_objetivo, estado, created_at, tipo, descripcion, cliente_id, costo_total_real")
    .in("id", ordenIds)
  if (!conOT.error) {
    ordenesRaw = (conOT.data || []) as Record<string, unknown>[]
  } else {
    const base = await supabase
      .from("produccion_ordenes")
      .select("id, producto_id, cantidad_objetivo, fecha_objetivo, estado, created_at")
      .in("id", ordenIds)
    ordenesRaw = (base.data || []) as Record<string, unknown>[]
  }
  const ordenById = new Map<number, Record<string, unknown>>()
  for (const o of ordenesRaw) ordenById.set(Number(o.id), o)

  const productoIds = Array.from(new Set(ordenesRaw.map((o) => Number(o.producto_id)).filter((id) => id > 0)))
  const nombreProd = new Map<number, string>()
  if (productoIds.length > 0) {
    const { data: prods } = await supabase.from("productos").select("id, nombre").in("id", productoIds)
    for (const p of prods || []) nombreProd.set(Number(p.id), String(p.nombre || ""))
  }
  const clienteIds = Array.from(new Set(ordenesRaw.map((o) => (o.cliente_id != null ? Number(o.cliente_id) : null)).filter((x): x is number => x != null)))
  const nombreCli = new Map<number, string>()
  if (clienteIds.length > 0) {
    const { data: clis } = await supabase.from("clientes").select("id, nombre").in("id", clienteIds)
    for (const c of clis || []) nombreCli.set(Number(c.id), String(c.nombre || ""))
  }

  const filas: OrdenFlujo[] = ordenIds.map((oid) => {
    const ets = (porOrden.get(oid) || []).sort((a, b) => a.orden_secuencia - b.orden_secuencia)
    const o = ordenById.get(oid)
    const etapaActual = ets.find((e) => e.estado !== "Entregada") ?? null
    const tipo = (o?.tipo as "Produccion" | "Trabajo" | null) ?? null
    const nombre = !o
      ? `Orden #${oid}`
      : tipo === "Trabajo"
        ? (String(o.descripcion || "").trim() || "Orden de trabajo")
        : (nombreProd.get(Number(o.producto_id)) || `Producto #${o.producto_id}`)
    return {
      orden_id: oid,
      producto_nombre: nombre,
      cantidad_objetivo: o ? Number(o.cantidad_objetivo || 0) : 0,
      fecha_objetivo: o ? ((o.fecha_objetivo as string) || null) : null,
      estado_orden: o ? String(o.estado || "") : "",
      etapas: ets,
      etapaActual,
      completado: etapaActual == null,
      tipo,
      cliente_nombre: o?.cliente_id != null ? nombreCli.get(Number(o.cliente_id)) ?? null : null,
      costo_total_real: o?.costo_total_real != null ? Number(o.costo_total_real) : null,
      created_at: (o?.created_at as string) ?? null,
    }
  })
  // Órdenes con trabajo pendiente primero, luego completadas.
  filas.sort((a, b) => Number(a.completado) - Number(b.completado) || b.orden_id - a.orden_id)
  return { data: filas, error: null }
}

// ==================== TRANSICIONES DE ETAPA ====================

async function actualizarEtapa(id: number, patch: Record<string, unknown>): Promise<{ error: string | null }> {
  const supabase = createClient()
  if (!supabase) return { error: "Cliente no disponible" }
  const { error } = await supabase
    .from("produccion_orden_etapas")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id)
  if (error) {
    if (isMissingTable(error)) return { error: FLUJO_FEATURE_PENDING }
    return { error: error.message }
  }
  return { error: null }
}

// ==================== REPORTE DE FLUJO (fase 3) ====================

/** Tiempo promedio por operación (sobre etapas entregadas). */
export interface TiempoOperacion {
  nombre: string
  /** Etapas entregadas con recepción y entrega registradas. */
  muestras: number
  /** Promedio recepción→entrega en minutos. */
  promedio_min: number
  /** Máximo recepción→entrega en minutos. */
  max_min: number
}

/** Carga actual: órdenes en curso por operación (etapa no entregada). */
export interface CargaOperacion {
  nombre: string
  /** Órdenes cuya etapa actual es esta operación. */
  ordenes: number
}

/** Una etapa "abierta" (recibida/en proceso, sin entregar) con su antigüedad. */
export interface EtapaAbierta {
  etapa_id: number
  orden_id: number
  producto_nombre: string
  nombre: string
  estado: EstadoEtapa
  responsable: string | null
  fecha_recepcion: string | null
  /** Minutos desde la recepción hasta ahora (antigüedad en la etapa). */
  antiguedad_min: number
}

/** Indicadores de lead time de punta a punta (órdenes terminadas). */
export interface SemanaLeadTime {
  /** Lunes de la semana (YYYY-MM-DD). */
  semana: string
  terminadas: number
  lead_promedio_h: number
  /** % entregadas en o antes de la fecha comprometida (null si ninguna tenía fecha). */
  cumplimiento_pct: number | null
}

export interface LeadTimes {
  /** Órdenes con todas sus etapas entregadas (en el rango, por fecha de la última entrega). */
  terminadas: number
  lead_promedio_h: number
  lead_p90_h: number
  lead_max_h: number
  a_tiempo: number
  con_fecha: number
  cumplimiento_pct: number | null
  /** Órdenes en piso: con alguna etapa recibida o en proceso. */
  wip: number
  semanas: SemanaLeadTime[]
}

export interface ReporteFlujo {
  tiempos: TiempoOperacion[]
  cargas: CargaOperacion[]
  abiertas: EtapaAbierta[]
  leadTimes: LeadTimes
}

const LEAD_VACIO: LeadTimes = { terminadas: 0, lead_promedio_h: 0, lead_p90_h: 0, lead_max_h: 0, a_tiempo: 0, con_fecha: 0, cumplimiento_pct: null, wip: 0, semanas: [] }

function lunesDe(fechaISO: string): string {
  const [y, m, d] = fechaISO.slice(0, 10).split("-").map(Number)
  const t = new Date(Date.UTC(y, m - 1, d))
  const dia = (t.getUTCDay() + 6) % 7 // lunes = 0
  t.setUTCDate(t.getUTCDate() - dia)
  return t.toISOString().slice(0, 10)
}

const r1 = (n: number) => Math.round(n * 10) / 10

/**
 * Lead time de punta a punta por orden = última entrega − primera recepción
 * de sus etapas (horas). Cumplimiento = entregada (día de la última entrega)
 * en o antes de `fecha_objetivo`. WIP = órdenes con alguna etapa recibida o
 * en proceso. Rango opcional por fecha de la última entrega. PURA.
 */
export function calcularLeadTimes(
  etapas: { orden_id: number; estado: string; fecha_recepcion: string | null; fecha_entrega: string | null }[],
  fechaObjetivo: Map<number, string | null>,
  rango?: { desde?: string; hasta?: string }
): LeadTimes {
  const porOrden = new Map<number, typeof etapas>()
  for (const e of etapas) porOrden.set(e.orden_id, [...(porOrden.get(e.orden_id) || []), e])
  const terminadas: { lead_h: number; fin: string; a_tiempo: boolean | null }[] = []
  let wip = 0
  for (const [ordenId, es] of porOrden) {
    if (es.some((e) => e.estado === "Recibida" || e.estado === "En Proceso")) wip += 1
    if (es.length === 0 || es.some((e) => e.estado !== "Entregada")) continue
    const inicios = es.map((e) => e.fecha_recepcion).filter((x): x is string => !!x).sort()
    const fines = es.map((e) => e.fecha_entrega).filter((x): x is string => !!x).sort()
    if (inicios.length === 0 || fines.length === 0) continue
    const fin = fines[fines.length - 1]
    const dia = fin.slice(0, 10)
    if (rango?.desde && dia < rango.desde) continue
    if (rango?.hasta && dia > rango.hasta) continue
    const lead = (Date.parse(fin) - Date.parse(inicios[0])) / 3_600_000
    const obj = fechaObjetivo.get(ordenId) ?? null
    terminadas.push({ lead_h: Math.max(0, lead), fin, a_tiempo: obj ? dia <= obj : null })
  }
  if (terminadas.length === 0) return { ...LEAD_VACIO, wip }
  const leads = terminadas.map((t) => t.lead_h).sort((a, b) => a - b)
  const conFecha = terminadas.filter((t) => t.a_tiempo !== null)
  const aTiempo = conFecha.filter((t) => t.a_tiempo).length
  const semMap = new Map<string, { n: number; total: number; conFecha: number; aTiempo: number }>()
  for (const t of terminadas) {
    const s = lunesDe(t.fin)
    const cur = semMap.get(s) || { n: 0, total: 0, conFecha: 0, aTiempo: 0 }
    cur.n += 1
    cur.total += t.lead_h
    if (t.a_tiempo !== null) {
      cur.conFecha += 1
      if (t.a_tiempo) cur.aTiempo += 1
    }
    semMap.set(s, cur)
  }
  return {
    terminadas: terminadas.length,
    lead_promedio_h: r1(leads.reduce((a, b) => a + b, 0) / leads.length),
    lead_p90_h: r1(leads[Math.min(leads.length - 1, Math.ceil(leads.length * 0.9) - 1)]),
    lead_max_h: r1(leads[leads.length - 1]),
    a_tiempo: aTiempo,
    con_fecha: conFecha.length,
    cumplimiento_pct: conFecha.length ? r1((aTiempo / conFecha.length) * 100) : null,
    wip,
    semanas: [...semMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([semana, v]) => ({ semana, terminadas: v.n, lead_promedio_h: r1(v.total / v.n), cumplimiento_pct: v.conFecha ? r1((v.aTiempo / v.conFecha) * 100) : null })),
  }
}

/** Diferencia en minutos entre dos ISO HN-as-UTC (o real). Null si falta alguno. */
function difMin(desde: string | null, hasta: string | null): number | null {
  if (!desde || !hasta) return null
  const a = Date.parse(desde), b = Date.parse(hasta)
  if (Number.isNaN(a) || Number.isNaN(b)) return null
  return Math.max(0, Math.round((b - a) / 60000))
}

/**
 * Reporte del flujo por etapas: tiempo promedio por operación (etapas
 * entregadas), carga actual por operación (etapas en curso) y las etapas
 * abiertas con su antigüedad (para detectar cuellos de botella / trabadas).
 * Opcionalmente filtra por rango de fechas (por fecha_recepcion de la etapa).
 */
export async function getReporteFlujo(opts?: {
  desde?: string
  hasta?: string
}): Promise<{ data: ReporteFlujo; error: string | null }> {
  const empty: ReporteFlujo = { tiempos: [], cargas: [], abiertas: [], leadTimes: LEAD_VACIO }
  if (!isSupabaseConfigured()) return { data: empty, error: null }
  const supabase = createClient()
  if (!supabase) return { data: empty, error: "Cliente no disponible" }

  let q = supabase
    .from("produccion_orden_etapas")
    .select("id, orden_id, nombre, estado, responsable, fecha_recepcion, fecha_entrega")
  if (opts?.desde) q = q.gte("fecha_recepcion", `${opts.desde}T00:00:00.000Z`)
  if (opts?.hasta) q = q.lte("fecha_recepcion", `${opts.hasta}T23:59:59.999Z`)

  const { data, error } = await q
  if (error) {
    if (isMissingTable(error)) return { data: empty, error: null }
    return { data: empty, error: error.message }
  }
  const etapas = (data || []) as Record<string, unknown>[]
  if (etapas.length === 0) return { data: empty, error: null }

  // Tiempos por operación (entregadas con recepción+entrega).
  const tMap = new Map<string, { total: number; n: number; max: number }>()
  // Carga por operación (no entregadas).
  const cMap = new Map<string, number>()
  const abiertasRaw: { etapa_id: number; orden_id: number; nombre: string; estado: EstadoEtapa; responsable: string | null; fecha_recepcion: string | null }[] = []

  const ahora = getHondurasNowISO()
  for (const e of etapas) {
    const nombre = String(e.nombre || "")
    const estado = String(e.estado || "Pendiente") as EstadoEtapa
    if (estado === "Entregada") {
      const d = difMin(e.fecha_recepcion as string, e.fecha_entrega as string)
      if (d != null) {
        const cur = tMap.get(nombre) || { total: 0, n: 0, max: 0 }
        cur.total += d; cur.n += 1; cur.max = Math.max(cur.max, d)
        tMap.set(nombre, cur)
      }
    } else if (estado === "Recibida" || estado === "En Proceso") {
      cMap.set(nombre, (cMap.get(nombre) || 0) + 1)
      abiertasRaw.push({
        etapa_id: Number(e.id),
        orden_id: Number(e.orden_id),
        nombre,
        estado,
        responsable: (e.responsable as string) ?? null,
        fecha_recepcion: (e.fecha_recepcion as string) ?? null,
      })
    }
  }

  const tiempos: TiempoOperacion[] = Array.from(tMap.entries())
    .map(([nombre, v]) => ({ nombre, muestras: v.n, promedio_min: Math.round(v.total / v.n), max_min: v.max }))
    .sort((a, b) => b.promedio_min - a.promedio_min)
  const cargas: CargaOperacion[] = Array.from(cMap.entries())
    .map(([nombre, ordenes]) => ({ nombre, ordenes }))
    .sort((a, b) => b.ordenes - a.ordenes)

  // Nombres para las etapas abiertas: producto (OP) o descripción (OT libre).
  const ordenIds = Array.from(new Set(abiertasRaw.map((a) => a.orden_id)))
  const nombreProd = new Map<number, string>()
  if (ordenIds.length > 0) {
    let ords: Record<string, unknown>[] = []
    const conTipo = await supabase.from("produccion_ordenes").select("id, producto_id, tipo, descripcion").in("id", ordenIds)
    if (!conTipo.error) ords = (conTipo.data || []) as Record<string, unknown>[]
    else ords = ((await supabase.from("produccion_ordenes").select("id, producto_id").in("id", ordenIds)).data || []) as Record<string, unknown>[]
    const ordProd = new Map<number, number>()
    for (const o of ords) {
      if (o.tipo === "Trabajo" || Number(o.producto_id) === 0) nombreProd.set(Number(o.id), String(o.descripcion || `Orden de trabajo #${o.id}`))
      else ordProd.set(Number(o.id), Number(o.producto_id))
    }
    const prodIds = Array.from(new Set(ordProd.values()))
    if (prodIds.length > 0) {
      const { data: prods } = await supabase.from("productos").select("id, nombre").in("id", prodIds)
      const pn = new Map<number, string>()
      for (const p of prods || []) pn.set(Number(p.id), String(p.nombre || ""))
      for (const [oid, pid] of ordProd) nombreProd.set(oid, pn.get(pid) || `Producto #${pid}`)
    }
  }

  // Lead time de punta a punta: todas las etapas (sin filtro de recepción) de
  // las órdenes con flujo; el rango aplica a la fecha de la última entrega.
  let leadTimes = LEAD_VACIO
  {
    const todas: { orden_id: number; estado: string; fecha_recepcion: string | null; fecha_entrega: string | null }[] = []
    for (let from = 0; from < 100_000; from += 1000) {
      const { data: pag, error: pErr } = await supabase
        .from("produccion_orden_etapas")
        .select("orden_id, estado, fecha_recepcion, fecha_entrega")
        .range(from, from + 999)
      if (pErr) break
      todas.push(...((pag || []) as typeof todas))
      if ((pag || []).length < 1000) break
    }
    const ids = [...new Set(todas.map((e) => Number(e.orden_id)))]
    const objetivo = new Map<number, string | null>()
    for (let i = 0; i < ids.length; i += 200) {
      const { data: os } = await supabase.from("produccion_ordenes").select("id, fecha_objetivo, estado").in("id", ids.slice(i, i + 200))
      for (const o of (os || []) as { id: number; fecha_objetivo: string | null; estado: string }[]) {
        if (o.estado === "Cancelada") continue
        objetivo.set(Number(o.id), o.fecha_objetivo)
      }
    }
    leadTimes = calcularLeadTimes(todas.filter((e) => objetivo.has(Number(e.orden_id))).map((e) => ({ ...e, orden_id: Number(e.orden_id) })), objetivo, { desde: opts?.desde, hasta: opts?.hasta })
  }

  const abiertas: EtapaAbierta[] = abiertasRaw
    .map((a) => ({
      ...a,
      producto_nombre: nombreProd.get(a.orden_id) || `Orden #${a.orden_id}`,
      antiguedad_min: difMin(a.fecha_recepcion, ahora) ?? 0,
    }))
    .sort((a, b) => b.antiguedad_min - a.antiguedad_min)

  return { data: { tiempos, cargas, abiertas, leadTimes }, error: null }
}

/** Marca una etapa como Recibida (llegó el trabajo a esta operación). */
export async function recibirEtapa(id: number, responsable?: string | null): Promise<{ error: string | null }> {
  return actualizarEtapa(id, {
    estado: "Recibida",
    responsable: (responsable || "").trim() || null,
    fecha_recepcion: getHondurasNowISO(),
  })
}

/** Marca una etapa En Proceso (se está trabajando). */
export async function iniciarEtapa(id: number, responsable?: string | null): Promise<{ error: string | null }> {
  const patch: Record<string, unknown> = { estado: "En Proceso" }
  const resp = (responsable || "").trim()
  if (resp) patch.responsable = resp
  return actualizarEtapa(id, patch)
}

/**
 * Entrega una etapa (queda 'Entregada') y RECIBE automáticamente la siguiente
 * etapa Pendiente de la misma orden. Registra cantidad procesada y notas.
 */
export async function entregarEtapa(
  id: number,
  input: { cantidad_procesada?: number | null; notas?: string | null; responsable?: string | null; costo_mano_obra?: number | null },
): Promise<{ error: string | null }> {
  const supabase = createClient()
  if (!supabase) return { error: "Cliente no disponible" }

  // Datos de la etapa (para saber a qué orden pertenece y su posición).
  const { data: etapa, error: eErr } = await supabase
    .from("produccion_orden_etapas")
    .select("id, orden_id, orden_secuencia")
    .eq("id", id)
    .maybeSingle()
  if (eErr) return { error: isMissingTable(eErr) ? FLUJO_FEATURE_PENDING : eErr.message }
  if (!etapa) return { error: "Etapa no encontrada" }

  const nowHN = getHondurasNowISO()
  const patch: Record<string, unknown> = { estado: "Entregada", fecha_entrega: nowHN }
  if (input.cantidad_procesada != null) patch.cantidad_procesada = Number(input.cantidad_procesada)
  if (input.notas !== undefined) patch.notas = (input.notas || "").trim() || null
  const resp = (input.responsable || "").trim()
  if (resp) patch.responsable = resp
  let up = await actualizarEtapa(id, { ...patch, ...(input.costo_mano_obra != null ? { costo_mano_obra: Math.max(0, Number(input.costo_mano_obra) || 0) } : {}) })
  // Columna costo_mano_obra ausente (officemart-010 pendiente): reintento sin ella.
  if (up.error && /costo_mano_obra/i.test(up.error)) up = await actualizarEtapa(id, patch)
  if (up.error) return up
  if (input.costo_mano_obra != null) {
    const { recalcularCostoOrden } = await import("@/lib/services/produccion-consumos")
    await recalcularCostoOrden(supabase, Number(etapa.orden_id))
  }

  // Recibe la siguiente etapa (la de menor secuencia > esta que siga Pendiente).
  const { data: siguientes } = await supabase
    .from("produccion_orden_etapas")
    .select("id, orden_secuencia, estado")
    .eq("orden_id", etapa.orden_id)
    .gt("orden_secuencia", etapa.orden_secuencia)
    .order("orden_secuencia", { ascending: true })
    .limit(1)
  const sig = (siguientes || [])[0]
  if (sig && sig.estado === "Pendiente") {
    await supabase
      .from("produccion_orden_etapas")
      .update({ estado: "Recibida", fecha_recepcion: nowHN, updated_at: new Date().toISOString() })
      .eq("id", sig.id)
  } else if (!sig) {
    // No hay etapa siguiente: si TODAS las etapas de la orden estan entregadas,
    // el flujo termino -> cerramos la orden automaticamente.
    const { data: pendientes } = await supabase
      .from("produccion_orden_etapas")
      .select("id")
      .eq("orden_id", etapa.orden_id)
      .neq("estado", "Entregada")
      .limit(1)
    if (!pendientes || pendientes.length === 0) {
      await supabase
        .from("produccion_ordenes")
        .update({ estado: "Cerrada", updated_at: new Date().toISOString() })
        .eq("id", etapa.orden_id)
        .neq("estado", "Cancelada")
    }
  }
  return { error: null }
}
