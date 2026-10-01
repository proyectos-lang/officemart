import { createClient, isSupabaseConfigured } from "@/lib/supabase/client"
import { getHondurasNowISO } from "@/lib/utils/honduras-time"
import { sumarHorasLaborales } from "@/lib/utils/calendario-laboral"
import { codigoOrden } from "@/lib/services/produccion-ordenes"

/**
 * Planeación en línea de tiempo + Mastertracking + resumen del dashboard de
 * producción (script officemart-019).
 *
 *   Plan: cada etapa dura su tiempo ESTÁNDAR (horas laborales) y empieza
 *   cuando termina la anterior en el plan, desde que entra la orden. Si la
 *   base tiene plan_inicio/plan_fin guardados se usan como línea base; si no,
 *   se calcula al vuelo con los mismos estándares.
 *   Real: fecha_recepcion / fecha_entrega de cada etapa (horas de reloj).
 */

export const TRACKING_PLAN_PENDIENTE = "Para guardar la planeación como línea base aplica scripts/officemart-019-planeacion-tracking.sql en Supabase (mientras tanto el plan se calcula al vuelo)."

// ==================== TIPOS ====================

export interface OperacionStd {
  id: number
  nombre: string
  orden_secuencia: number
  /** Horas laborales estándar (configurado o por defecto). */
  estandar_h: number
  configurado: boolean
}

export type EstadoEtapaTracking = "Pendiente" | "Recibida" | "En Proceso" | "Entregada"

export interface EtapaTracking {
  id: number
  orden_secuencia: number
  operacion_id: number | null
  nombre: string
  estado: EstadoEtapaTracking
  responsable: string | null
  fecha_recepcion: string | null
  fecha_entrega: string | null
  plan_inicio: string
  plan_fin: string
  plan_guardado: boolean
  /** Horas de reloj recepción → entrega (o → ahora si está en curso). */
  horas_reales: number | null
  /** Horas de reloj entre el fin real (o ahora) y el fin planeado; >0 = atrasada vs plan. */
  desvio_h: number | null
}

export type EstadoOrdenTracking = "Sin flujo" | "Pendiente de recibir" | "Recibida" | "En Proceso" | "Terminada" | "Cancelada"
export type Semaforo = "verde" | "amarillo" | "rojo" | "gris"

export interface OrdenTracking {
  id: number
  codigo: string
  tipo: "Produccion" | "Trabajo"
  descripcion: string
  cliente_id: number | null
  cliente_nombre: string | null
  cantidad: number
  estado_orden: string
  creada: string
  fecha_objetivo: string | null
  urgente: boolean
  notas: string | null
  etapas: EtapaTracking[]
  etapa_actual: string | null
  estado: EstadoOrdenTracking
  /** % de etapas entregadas. */
  progreso_pct: number
  inicio_real: string | null
  fin_real: string | null
  /** Horas de reloj desde la entrada (o primera recepción) hasta el fin (o ahora). */
  lead_h: number
  plan_fin: string | null
  /** Días de atraso contra la fecha comprometida (>0 = atrasada). */
  atraso_dias: number | null
  a_tiempo: boolean | null
  semaforo: Semaforo
}

// ==================== PURAS ====================

const H = 3_600_000
const r1 = (n: number) => Math.round(n * 10) / 10

/** Estándar por defecto según el nombre de la operación (horas laborales). */
export function estandarPorDefecto(nombre: string): number {
  const n = nombre.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "")
  if (n.includes("dise")) return 3
  if (n.includes("impre")) return 2.5
  if (n.includes("corte") || n.includes("acabado")) return 2
  if (n.includes("entreg") || n.includes("despach")) return 4
  if (n.includes("empaq")) return 1
  return 4
}

/** Plan hacia adelante: cada etapa empieza al terminar la anterior (calendario laboral). */
export function planificarEtapas(inicio: string, etapas: { operacion_id: number | null; nombre: string }[], estandares: Map<number, number>): { plan_inicio: string; plan_fin: string }[] {
  let cursor = new Date(inicio)
  return etapas.map((e) => {
    const horas = (e.operacion_id != null ? estandares.get(e.operacion_id) : undefined) ?? estandarPorDefecto(e.nombre)
    const ini = sumarHorasLaborales(cursor, 0)
    const fin = sumarHorasLaborales(ini, horas)
    cursor = fin
    return { plan_inicio: ini.toISOString(), plan_fin: fin.toISOString() }
  })
}

function horasEntre(a: string | null, b: string | null): number | null {
  if (!a || !b) return null
  const d = (Date.parse(b) - Date.parse(a)) / H
  return Number.isFinite(d) ? r1(Math.max(0, d)) : null
}

function diasEntreFechas(a: string, b: string): number {
  const [ay, am, ad] = a.slice(0, 10).split("-").map(Number)
  const [by, bm, bd] = b.slice(0, 10).split("-").map(Number)
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000)
}

export interface OrdenCruda {
  id: number
  tipo: string | null
  producto_id: number | null
  descripcion: string | null
  cliente_id: number | null
  cantidad_objetivo: number | null
  fecha_objetivo: string | null
  estado: string
  created_at: string
  notas: string | null
}

export interface EtapaCruda {
  id: number
  orden_id: number
  operacion_id: number | null
  nombre: string
  orden_secuencia: number
  estado: string
  responsable: string | null
  fecha_recepcion: string | null
  fecha_entrega: string | null
  plan_inicio?: string | null
  plan_fin?: string | null
}

/** Arma el tracking de cada orden (PURA). */
export function construirTracking(
  ordenes: OrdenCruda[],
  etapas: EtapaCruda[],
  ops: OperacionStd[],
  nombres: { clientes: Map<number, string>; productos: Map<number, string> },
  ahoraISO: string
): OrdenTracking[] {
  const std = new Map(ops.map((o) => [o.id, o.estandar_h]))
  const porOrden = new Map<number, EtapaCruda[]>()
  for (const e of etapas) porOrden.set(e.orden_id, [...(porOrden.get(e.orden_id) || []), e])
  const hoy = ahoraISO.slice(0, 10)

  return ordenes.map((o) => {
    const tipo: "Produccion" | "Trabajo" = o.tipo === "Trabajo" || Number(o.producto_id) === 0 ? "Trabajo" : "Produccion"
    const descripcion = tipo === "Trabajo" ? o.descripcion || `Orden de trabajo #${o.id}` : nombres.productos.get(Number(o.producto_id)) || `Producto #${o.producto_id}`
    const crudas = (porOrden.get(o.id) || []).sort((a, b) => a.orden_secuencia - b.orden_secuencia)
    const inicioPlan = crudas[0]?.fecha_recepcion && crudas[0].fecha_recepcion < o.created_at ? crudas[0].fecha_recepcion : o.created_at
    const calculado = planificarEtapas(inicioPlan, crudas, std)
    const ets: EtapaTracking[] = crudas.map((e, i) => {
      const guardado = !!(e.plan_inicio && e.plan_fin)
      const plan_inicio = guardado ? e.plan_inicio! : calculado[i].plan_inicio
      const plan_fin = guardado ? e.plan_fin! : calculado[i].plan_fin
      const estado = (e.estado as EstadoEtapaTracking) || "Pendiente"
      const finReal = estado === "Entregada" ? e.fecha_entrega : null
      const horas = e.fecha_recepcion ? horasEntre(e.fecha_recepcion, finReal ?? ahoraISO) : null
      const ref = finReal ?? (estado === "Pendiente" ? null : ahoraISO)
      const desvio = ref ? r1((Date.parse(ref) - Date.parse(plan_fin)) / H) : null
      return {
        id: e.id, orden_secuencia: e.orden_secuencia, operacion_id: e.operacion_id, nombre: e.nombre, estado, responsable: e.responsable,
        fecha_recepcion: e.fecha_recepcion, fecha_entrega: e.fecha_entrega, plan_inicio, plan_fin, plan_guardado: guardado,
        horas_reales: horas, desvio_h: estado === "Entregada" || (desvio != null && desvio > 0) ? desvio : null,
      }
    })

    const cancelada = o.estado === "Cancelada"
    const entregadas = ets.filter((e) => e.estado === "Entregada").length
    const actual = ets.find((e) => e.estado !== "Entregada") ?? null
    let estado: EstadoOrdenTracking
    if (cancelada) estado = "Cancelada"
    else if (ets.length === 0) estado = o.estado === "Cerrada" ? "Terminada" : "Sin flujo"
    else if (!actual) estado = "Terminada"
    else if (actual.estado === "Pendiente") estado = "Pendiente de recibir"
    else estado = actual.estado as EstadoOrdenTracking

    const recepciones = ets.map((e) => e.fecha_recepcion).filter((x): x is string => !!x).sort()
    const entregas = ets.map((e) => e.fecha_entrega).filter((x): x is string => !!x).sort()
    const inicio_real = recepciones[0] ?? null
    const fin_real = estado === "Terminada" && entregas.length ? entregas[entregas.length - 1] : null
    const base = inicio_real && inicio_real < o.created_at ? inicio_real : o.created_at
    const lead_h = r1(Math.max(0, (Date.parse(fin_real ?? ahoraISO) - Date.parse(base)) / H))
    const plan_fin = ets.length ? ets[ets.length - 1].plan_fin : null

    let atraso_dias: number | null = null
    let a_tiempo: boolean | null = null
    let semaforo: Semaforo = "gris"
    if (o.fecha_objetivo && !cancelada) {
      if (estado === "Terminada" && fin_real) {
        atraso_dias = diasEntreFechas(o.fecha_objetivo, fin_real)
        a_tiempo = atraso_dias <= 0
        semaforo = a_tiempo ? "verde" : "rojo"
      } else if (estado !== "Terminada") {
        atraso_dias = diasEntreFechas(o.fecha_objetivo, hoy)
        if (atraso_dias > 0) semaforo = "rojo"
        else {
          // Estimado: lo que falta según estándares, desde ahora.
          const restante = ets.filter((e) => e.estado !== "Entregada").reduce((a, e) => a + ((e.operacion_id != null ? std.get(e.operacion_id) : undefined) ?? estandarPorDefecto(e.nombre)), 0)
          const estimado = sumarHorasLaborales(new Date(ahoraISO), restante).toISOString().slice(0, 10)
          semaforo = estimado > o.fecha_objetivo || atraso_dias === 0 ? "amarillo" : "verde"
        }
      }
    } else if (estado === "Terminada") semaforo = "verde"

    return {
      id: o.id,
      codigo: codigoOrden(o.id, tipo),
      tipo,
      descripcion,
      cliente_id: o.cliente_id,
      cliente_nombre: o.cliente_id != null ? nombres.clientes.get(o.cliente_id) ?? null : null,
      cantidad: Number(o.cantidad_objetivo || 0),
      estado_orden: o.estado,
      creada: o.created_at,
      fecha_objetivo: o.fecha_objetivo,
      urgente: /URGENTE/i.test(o.notas || ""),
      notas: o.notas,
      etapas: ets,
      etapa_actual: estado === "Terminada" ? null : actual?.nombre ?? null,
      estado,
      progreso_pct: ets.length ? Math.round((entregadas / ets.length) * 100) : estado === "Terminada" ? 100 : 0,
      inicio_real,
      fin_real,
      lead_h,
      plan_fin,
      atraso_dias,
      a_tiempo,
      semaforo,
    }
  })
}

export interface ProcesoResumen {
  operacion_id: number | null
  nombre: string
  pendientes_recibir: number
  recibidas: number
  en_proceso: number
  entregadas: number
  /** Promedio real recepción→entrega (horas de reloj) de las entregadas en el rango. */
  lead_real_h: number | null
  /** Promedio planeado inicio→fin (horas de reloj) de esas mismas etapas. */
  lead_plan_h: number | null
  estandar_h: number
}

export interface ResumenProduccion {
  ordenes: number
  en_piso: number
  terminadas: number
  sin_iniciar: number
  atrasadas: number
  en_riesgo: number
  urgentes_en_piso: number
  terminadas_con_fecha: number
  a_tiempo: number
  cumplimiento_pct: number | null
  lead_promedio_h: number | null
  procesos: ProcesoResumen[]
  semanas: { semana: string; terminadas: number; a_tiempo_pct: number | null; lead_h: number | null }[]
}

function lunesDe(fechaISO: string): string {
  const [y, m, d] = fechaISO.slice(0, 10).split("-").map(Number)
  const t = new Date(Date.UTC(y, m - 1, d))
  t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7))
  return t.toISOString().slice(0, 10)
}

/**
 * Resumen para el dashboard (PURA). El estado en piso (WIP, procesos) es la
 * foto actual; terminadas, cumplimiento, lead time y tendencia se filtran por
 * el día de la última entrega dentro del rango.
 */
export function resumenProduccion(rows: OrdenTracking[], ops: OperacionStd[], rango: { desde?: string; hasta?: string } = {}): ResumenProduccion {
  const enRango = (iso: string | null) => !!iso && (!rango.desde || iso.slice(0, 10) >= rango.desde) && (!rango.hasta || iso.slice(0, 10) <= rango.hasta)
  const vigentes = rows.filter((r) => r.estado !== "Cancelada")
  const enPiso = vigentes.filter((r) => r.estado === "Pendiente de recibir" || r.estado === "Recibida" || r.estado === "En Proceso")
  const terminadas = vigentes.filter((r) => r.estado === "Terminada" && enRango(r.fin_real))
  const conFecha = terminadas.filter((r) => r.a_tiempo !== null)
  const aTiempo = conFecha.filter((r) => r.a_tiempo).length
  const creadasEnRango = vigentes.filter((r) => enRango(r.creada))

  const procesos: ProcesoResumen[] = [...ops].sort((a, b) => a.orden_secuencia - b.orden_secuencia).map((op) => {
    let pendientes = 0, recibidas = 0, enProceso = 0, entregadas = 0, sumReal = 0, sumPlan = 0
    for (const r of vigentes) {
      for (const e of r.etapas) {
        if (e.operacion_id !== op.id && e.nombre !== op.nombre) continue
        if (e.estado === "Pendiente" && r.estado !== "Terminada") pendientes++
        else if (e.estado === "Recibida") recibidas++
        else if (e.estado === "En Proceso") enProceso++
        else if (e.estado === "Entregada" && enRango(e.fecha_entrega)) {
          entregadas++
          sumReal += horasEntre(e.fecha_recepcion, e.fecha_entrega) ?? 0
          sumPlan += horasEntre(e.plan_inicio, e.plan_fin) ?? 0
        }
      }
    }
    return {
      operacion_id: op.id, nombre: op.nombre, pendientes_recibir: pendientes, recibidas, en_proceso: enProceso, entregadas,
      lead_real_h: entregadas ? r1(sumReal / entregadas) : null, lead_plan_h: entregadas ? r1(sumPlan / entregadas) : null, estandar_h: op.estandar_h,
    }
  })

  const semMap = new Map<string, { n: number; conFecha: number; aTiempo: number; lead: number }>()
  for (const r of terminadas) {
    const s = lunesDe(r.fin_real!)
    const cur = semMap.get(s) || { n: 0, conFecha: 0, aTiempo: 0, lead: 0 }
    cur.n++
    cur.lead += r.lead_h
    if (r.a_tiempo !== null) {
      cur.conFecha++
      if (r.a_tiempo) cur.aTiempo++
    }
    semMap.set(s, cur)
  }

  return {
    ordenes: creadasEnRango.length,
    en_piso: enPiso.length,
    terminadas: terminadas.length,
    sin_iniciar: vigentes.filter((r) => r.estado === "Sin flujo").length,
    atrasadas: enPiso.filter((r) => r.semaforo === "rojo").length,
    en_riesgo: enPiso.filter((r) => r.semaforo === "amarillo").length,
    urgentes_en_piso: enPiso.filter((r) => r.urgente).length,
    terminadas_con_fecha: conFecha.length,
    a_tiempo: aTiempo,
    cumplimiento_pct: conFecha.length ? r1((aTiempo / conFecha.length) * 100) : null,
    lead_promedio_h: terminadas.length ? r1(terminadas.reduce((a, r) => a + r.lead_h, 0) / terminadas.length) : null,
    procesos,
    semanas: [...semMap.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([semana, v]) => ({
      semana, terminadas: v.n, a_tiempo_pct: v.conFecha ? r1((v.aTiempo / v.conFecha) * 100) : null, lead_h: v.n ? r1(v.lead / v.n) : null,
    })),
  }
}

// ==================== I/O ====================

function faltaColumna(err: { message?: string } | null, col: string): boolean {
  return !!err && new RegExp(col, "i").test(err.message || "")
}

async function paginar<T>(consulta: (desde: number, hasta: number) => PromiseLike<{ data: unknown[] | null; error: { message?: string } | null }>): Promise<{ data: T[]; error: { message?: string } | null }> {
  const out: T[] = []
  for (let from = 0; from < 200_000; from += 1000) {
    const { data, error } = await consulta(from, from + 999)
    if (error) return { data: out, error }
    out.push(...((data || []) as T[]))
    if ((data || []).length < 1000) break
  }
  return { data: out, error: null }
}

export async function getOperacionesStd(): Promise<{ data: OperacionStd[]; error: string | null; conColumna: boolean }> {
  const supabase = createClient()
  if (!supabase) return { data: [], error: "Cliente no disponible", conColumna: false }
  let conColumna = true
  let res = await supabase.from("produccion_operaciones").select("id, nombre, orden_secuencia, activo, duracion_estandar_horas").order("orden_secuencia")
  if (res.error && faltaColumna(res.error, "duracion_estandar_horas")) {
    conColumna = false
    res = (await supabase.from("produccion_operaciones").select("id, nombre, orden_secuencia, activo").order("orden_secuencia")) as typeof res
  }
  if (res.error) return { data: [], error: res.error.message, conColumna }
  const data = ((res.data || []) as Record<string, unknown>[]).map((o) => {
    const conf = o.duracion_estandar_horas != null && Number(o.duracion_estandar_horas) > 0
    return { id: Number(o.id), nombre: String(o.nombre || ""), orden_secuencia: Number(o.orden_secuencia || 0), estandar_h: conf ? Number(o.duracion_estandar_horas) : estandarPorDefecto(String(o.nombre || "")), configurado: conf }
  })
  return { data, error: null, conColumna }
}

export async function setEstandarOperacion(id: number, horas: number | null): Promise<{ error: string | null }> {
  const supabase = createClient()
  if (!supabase) return { error: "Cliente no disponible" }
  const { error } = await supabase.from("produccion_operaciones").update({ duracion_estandar_horas: horas != null && horas > 0 ? horas : null, updated_at: new Date().toISOString() }).eq("id", id)
  if (error) return { error: faltaColumna(error, "duracion_estandar_horas") ? TRACKING_PLAN_PENDIENTE : error.message }
  return { error: null }
}

/** Carga órdenes + etapas + nombres y arma el tracking. */
export async function getTracking(): Promise<{ data: OrdenTracking[]; ops: OperacionStd[]; planGuardable: boolean; error: string | null }> {
  if (!isSupabaseConfigured()) return { data: [], ops: [], planGuardable: false, error: null }
  const supabase = createClient()
  if (!supabase) return { data: [], ops: [], planGuardable: false, error: "Cliente no disponible" }
  const opsRes = await getOperacionesStd()
  if (opsRes.error) return { data: [], ops: [], planGuardable: false, error: opsRes.error }

  const colsOrden = "id, tipo, producto_id, descripcion, cliente_id, cantidad_objetivo, fecha_objetivo, estado, created_at, notas"
  let ords = await paginar<OrdenCruda>((a, b) => supabase.from("produccion_ordenes").select(colsOrden).order("id").range(a, b))
  if (ords.error && /tipo|descripcion|cliente_id/i.test(ords.error.message || "")) {
    ords = await paginar<OrdenCruda>((a, b) => supabase.from("produccion_ordenes").select("id, producto_id, cantidad_objetivo, fecha_objetivo, estado, created_at, notas").order("id").range(a, b))
  }
  if (ords.error) return { data: [], ops: opsRes.data, planGuardable: false, error: ords.error.message || "Error al leer órdenes" }

  let planGuardable = true
  const colsEtapa = "id, orden_id, operacion_id, nombre, orden_secuencia, estado, responsable, fecha_recepcion, fecha_entrega"
  let ets = await paginar<EtapaCruda>((a, b) => supabase.from("produccion_orden_etapas").select(`${colsEtapa}, plan_inicio, plan_fin`).order("id").range(a, b))
  if (ets.error && faltaColumna(ets.error, "plan_")) {
    planGuardable = false
    ets = await paginar<EtapaCruda>((a, b) => supabase.from("produccion_orden_etapas").select(colsEtapa).order("id").range(a, b))
  }
  if (ets.error) return { data: [], ops: opsRes.data, planGuardable, error: ets.error.message || "Error al leer etapas" }

  const cliIds = [...new Set(ords.data.map((o) => o.cliente_id).filter((x): x is number => x != null))]
  const prodIds = [...new Set(ords.data.map((o) => Number(o.producto_id)).filter((x) => x > 0))]
  const clientes = new Map<number, string>()
  const productos = new Map<number, string>()
  for (let i = 0; i < cliIds.length; i += 200) {
    const { data } = await supabase.from("clientes").select("id, nombre").in("id", cliIds.slice(i, i + 200))
    for (const c of (data || []) as { id: number; nombre: string }[]) clientes.set(c.id, c.nombre)
  }
  for (let i = 0; i < prodIds.length; i += 200) {
    const { data } = await supabase.from("productos").select("id, nombre").in("id", prodIds.slice(i, i + 200))
    for (const p of (data || []) as { id: number; nombre: string }[]) productos.set(p.id, p.nombre)
  }
  const rows = construirTracking(ords.data, ets.data, opsRes.data, { clientes, productos }, getHondurasNowISO())
  return { data: rows.sort((a, b) => b.id - a.id), ops: opsRes.data, planGuardable: planGuardable && opsRes.conColumna, error: null }
}

/**
 * Guarda la planeación (línea base) en las etapas. `soloSinPlan` respeta las
 * que ya tienen plan; si es false recalcula todas con los estándares actuales.
 */
export async function guardarPlaneacion(opts: { soloSinPlan?: boolean; ordenIds?: number[] } = {}): Promise<{ ordenes: number; etapas: number; error: string | null }> {
  const supabase = createClient()
  if (!supabase) return { ordenes: 0, etapas: 0, error: "Cliente no disponible" }
  const t = await getTracking()
  if (t.error) return { ordenes: 0, etapas: 0, error: t.error }
  if (!t.planGuardable) return { ordenes: 0, etapas: 0, error: TRACKING_PLAN_PENDIENTE }
  const std = new Map(t.ops.map((o) => [o.id, o.estandar_h]))
  let ordenes = 0
  let etapas = 0
  for (const r of t.data) {
    if (opts.ordenIds && !opts.ordenIds.includes(r.id)) continue
    if (r.etapas.length === 0) continue
    if (opts.soloSinPlan !== false && r.etapas.every((e) => e.plan_guardado)) continue
    const inicio = r.inicio_real && r.inicio_real < r.creada ? r.inicio_real : r.creada
    const plan = planificarEtapas(inicio, r.etapas, std)
    for (const [i, e] of r.etapas.entries()) {
      const { error } = await supabase.from("produccion_orden_etapas").update({ plan_inicio: plan[i].plan_inicio, plan_fin: plan[i].plan_fin }).eq("id", e.id)
      if (error) return { ordenes, etapas, error: faltaColumna(error, "plan_") ? TRACKING_PLAN_PENDIENTE : error.message }
      etapas++
    }
    ordenes++
  }
  return { ordenes, etapas, error: null }
}

/** Guarda el plan de UNA orden (al generar sus etapas). Lee solo esa orden. */
export async function guardarPlanOrden(ordenId: number): Promise<{ error: string | null }> {
  const supabase = createClient()
  if (!supabase) return { error: "Cliente no disponible" }
  const ops = await getOperacionesStd()
  if (ops.error) return { error: ops.error }
  const { data: orden } = await supabase.from("produccion_ordenes").select("id, created_at").eq("id", ordenId).maybeSingle()
  const { data: ets, error } = await supabase.from("produccion_orden_etapas").select("id, operacion_id, nombre, orden_secuencia, fecha_recepcion").eq("orden_id", ordenId).order("orden_secuencia")
  if (error || !orden) return { error: error?.message ?? "Orden no encontrada" }
  const etapas = (ets || []) as { id: number; operacion_id: number | null; nombre: string; fecha_recepcion: string | null }[]
  if (etapas.length === 0) return { error: null }
  const creada = String((orden as { created_at: string }).created_at)
  const inicio = etapas[0].fecha_recepcion && etapas[0].fecha_recepcion < creada ? etapas[0].fecha_recepcion : creada
  const plan = planificarEtapas(inicio, etapas, new Map(ops.data.map((o) => [o.id, o.estandar_h])))
  for (const [i, e] of etapas.entries()) {
    const up = await supabase.from("produccion_orden_etapas").update({ plan_inicio: plan[i].plan_inicio, plan_fin: plan[i].plan_fin }).eq("id", e.id)
    if (up.error) return { error: faltaColumna(up.error, "plan_") ? TRACKING_PLAN_PENDIENTE : up.error.message }
  }
  return { error: null }
}
