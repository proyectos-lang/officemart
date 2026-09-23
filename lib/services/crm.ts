import type { SupabaseClient } from "@supabase/supabase-js"
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client"
import { getTenantStamp, isValidStamp, SESION_INVALIDA_ERROR, type TenantStamp } from "@/lib/services/tenant-stamp"
import { getHondurasNowISO, getHondurasTodayISODate, getHondurasDayRange } from "@/lib/utils/honduras-time"

/**
 * CRM (Fase 5, script officemart-016): etapas, contactos, oportunidades y
 * actividades. Fechas de actividades en convención HN-as-UTC (como el resto
 * de la app): "2026-09-23T14:30:00.000Z" significa 14:30 hora de Honduras.
 */

export const CRM_FEATURE_PENDING = "CRM pendiente: aplica scripts/officemart-016-crm.sql en Supabase."

// ==================== TIPOS ====================

export type EstadoOportunidad = "Abierta" | "Ganada" | "Perdida"
export type TipoActividad = "Llamada" | "Visita" | "Reunion" | "Correo" | "Tarea" | "Nota"
export const TIPOS_ACTIVIDAD: TipoActividad[] = ["Llamada", "Visita", "Reunion", "Correo", "Tarea", "Nota"]
export const ORIGENES_SUGERIDOS = ["Referido", "Cliente existente", "Sitio web", "Redes sociales", "Llamada en frío", "Feria / evento", "Licitación", "Otro"]

export interface EtapaCrm {
  id?: number
  nombre: string
  orden: number
  /** 0–100: peso de la etapa en el pipeline ponderado. */
  probabilidad: number
  color?: string | null
  activo?: boolean
}

export const ETAPAS_POR_DEFECTO: EtapaCrm[] = [
  { nombre: "Prospecto", orden: 1, probabilidad: 10 },
  { nombre: "Contacto", orden: 2, probabilidad: 25 },
  { nombre: "Propuesta", orden: 3, probabilidad: 50 },
  { nombre: "Negociación", orden: 4, probabilidad: 75 },
  { nombre: "Cierre", orden: 5, probabilidad: 90 },
]

export interface ContactoCrm {
  id?: number
  cliente_id: number | null
  cliente_nombre?: string | null
  nombre: string
  cargo?: string | null
  telefono?: string | null
  correo?: string | null
  /** YYYY-MM-DD */
  cumpleanos?: string | null
  notas?: string | null
  activo?: boolean
}

export interface OportunidadCrm {
  id: number
  titulo: string
  cliente_id: number | null
  cliente_nombre: string | null
  prospecto_nombre: string | null
  contacto_id: number | null
  contacto_nombre: string | null
  vendedor_id: number | null
  vendedor_nombre: string | null
  etapa_id: number
  etapa_nombre: string | null
  valor_estimado: number
  fecha_cierre_esperada: string | null
  origen: string | null
  estado: EstadoOportunidad
  motivo_perdida: string | null
  cotizacion_id: number | null
  venta_id: number | null
  notas: string | null
  cerrada_at: string | null
  usuario: string | null
  created_at: string
  updated_at: string | null
  /** Próxima actividad pendiente (fecha ISO) — la llena getOportunidades. */
  proxima_actividad: string | null
}

export interface OportunidadInput {
  titulo: string
  cliente_id: number | null
  prospecto_nombre?: string | null
  contacto_id?: number | null
  vendedor_id?: number | null
  etapa_id: number
  valor_estimado: number
  fecha_cierre_esperada?: string | null
  origen?: string | null
  notas?: string | null
}

export interface ActividadCrm {
  id: number
  oportunidad_id: number | null
  oportunidad_titulo: string | null
  cliente_id: number | null
  cliente_nombre: string | null
  contacto_id: number | null
  contacto_nombre: string | null
  vendedor_id: number | null
  vendedor_nombre: string | null
  tipo: TipoActividad
  asunto: string
  descripcion: string | null
  /** ISO HN-as-UTC. */
  fecha: string
  resultado: string | null
  completada: boolean
  completada_at: string | null
  usuario: string | null
  created_at: string
}

export interface ActividadInput {
  oportunidad_id?: number | null
  cliente_id?: number | null
  contacto_id?: number | null
  vendedor_id?: number | null
  tipo: TipoActividad
  asunto: string
  descripcion?: string | null
  /** ISO HN-as-UTC (usar hondurasLocalAIso). */
  fecha: string
}

export interface Cumpleanos {
  nombre: string
  /** "cliente" | "contacto" */
  tipo: "cliente" | "contacto"
  id: number
  /** Fecha original YYYY-MM-DD */
  fecha: string
  /** 0 = hoy */
  diasFaltan: number
  /** Fecha del próximo cumpleaños YYYY-MM-DD */
  proximo: string
}

// ==================== PURAS ====================

const r2 = (n: number) => +(Number(n) || 0).toFixed(2)

/** "2026-09-23T14:30" (input datetime-local, hora Honduras) → ISO HN-as-UTC. */
export function hondurasLocalAIso(local: string): string {
  const s = (local || "").trim()
  if (!s) return ""
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${s}T09:00:00.000Z`
  const base = s.length === 16 ? `${s}:00` : s.slice(0, 19)
  return `${base}.000Z`
}

/** ISO HN-as-UTC → valor para input datetime-local ("YYYY-MM-DDTHH:mm"). */
export function isoAHondurasLocal(iso: string | null | undefined): string {
  if (!iso) return ""
  return iso.slice(0, 16)
}

export interface ResumenEtapa {
  etapa_id: number
  nombre: string
  probabilidad: number
  cantidad: number
  valor: number
  ponderado: number
}

/** Pipeline abierto por etapa (cantidad, valor y valor ponderado por probabilidad). */
export function resumirPipeline(oportunidades: OportunidadCrm[], etapas: EtapaCrm[]): { etapas: ResumenEtapa[]; total: number; ponderado: number; cantidad: number } {
  const orden = [...etapas].sort((a, b) => a.orden - b.orden || (a.id ?? 0) - (b.id ?? 0))
  const filas: ResumenEtapa[] = orden.map((e) => ({ etapa_id: e.id ?? 0, nombre: e.nombre, probabilidad: e.probabilidad, cantidad: 0, valor: 0, ponderado: 0 }))
  const porId = new Map(filas.map((f) => [f.etapa_id, f]))
  for (const o of oportunidades) {
    if (o.estado !== "Abierta") continue
    const f = porId.get(o.etapa_id)
    if (!f) continue
    f.cantidad += 1
    f.valor += Number(o.valor_estimado) || 0
    f.ponderado += (Number(o.valor_estimado) || 0) * (f.probabilidad / 100)
  }
  for (const f of filas) {
    f.valor = r2(f.valor)
    f.ponderado = r2(f.ponderado)
  }
  return {
    etapas: filas,
    total: r2(filas.reduce((a, f) => a + f.valor, 0)),
    ponderado: r2(filas.reduce((a, f) => a + f.ponderado, 0)),
    cantidad: filas.reduce((a, f) => a + f.cantidad, 0),
  }
}

/** Ganadas / (ganadas + perdidas), en %. Null si no hay cerradas. */
export function tasaCierre(oportunidades: OportunidadCrm[]): { ganadas: number; perdidas: number; valorGanado: number; tasa: number | null } {
  let ganadas = 0
  let perdidas = 0
  let valorGanado = 0
  for (const o of oportunidades) {
    if (o.estado === "Ganada") {
      ganadas += 1
      valorGanado += Number(o.valor_estimado) || 0
    } else if (o.estado === "Perdida") perdidas += 1
  }
  const cerradas = ganadas + perdidas
  return { ganadas, perdidas, valorGanado: r2(valorGanado), tasa: cerradas === 0 ? null : r2((ganadas / cerradas) * 100) }
}

export interface ResumenClave {
  clave: string
  abiertas: number
  valorAbierto: number
  ganadas: number
  valorGanado: number
  perdidas: number
  tasa: number | null
}

/** Agrupa oportunidades por una clave (vendedor, origen, …). */
export function resumirPorClave(oportunidades: OportunidadCrm[], clave: (o: OportunidadCrm) => string): ResumenClave[] {
  const mapa = new Map<string, ResumenClave>()
  for (const o of oportunidades) {
    const k = clave(o) || "(sin dato)"
    let f = mapa.get(k)
    if (!f) {
      f = { clave: k, abiertas: 0, valorAbierto: 0, ganadas: 0, valorGanado: 0, perdidas: 0, tasa: null }
      mapa.set(k, f)
    }
    const v = Number(o.valor_estimado) || 0
    if (o.estado === "Abierta") {
      f.abiertas += 1
      f.valorAbierto += v
    } else if (o.estado === "Ganada") {
      f.ganadas += 1
      f.valorGanado += v
    } else f.perdidas += 1
  }
  const out = [...mapa.values()].map((f) => {
    const cerradas = f.ganadas + f.perdidas
    return { ...f, valorAbierto: r2(f.valorAbierto), valorGanado: r2(f.valorGanado), tasa: cerradas === 0 ? null : r2((f.ganadas / cerradas) * 100) }
  })
  return out.sort((a, b) => b.valorGanado + b.valorAbierto - (a.valorGanado + a.valorAbierto) || a.clave.localeCompare(b.clave))
}

/** Cuenta por una clave de texto (motivo de pérdida, tipo de actividad). */
export function contarPor<T>(items: T[], clave: (i: T) => string | null | undefined): { clave: string; cantidad: number }[] {
  const mapa = new Map<string, number>()
  for (const i of items) {
    const k = (clave(i) || "").trim() || "(sin dato)"
    mapa.set(k, (mapa.get(k) || 0) + 1)
  }
  return [...mapa.entries()].map(([clave, cantidad]) => ({ clave, cantidad })).sort((a, b) => b.cantidad - a.cantidad || a.clave.localeCompare(b.clave))
}

/** Separa actividades pendientes en vencidas / hoy / próximas según la fecha HN. */
export function clasificarActividades<T extends { fecha: string; completada: boolean }>(actividades: T[], hoyISO: string): { vencidas: T[]; hoy: T[]; proximas: T[] } {
  const vencidas: T[] = []
  const hoy: T[] = []
  const proximas: T[] = []
  for (const a of actividades) {
    if (a.completada) continue
    const dia = (a.fecha || "").slice(0, 10)
    if (dia < hoyISO) vencidas.push(a)
    else if (dia === hoyISO) hoy.push(a)
    else proximas.push(a)
  }
  const porFecha = (x: T, y: T) => x.fecha.localeCompare(y.fecha)
  return { vencidas: vencidas.sort(porFecha), hoy: hoy.sort(porFecha), proximas: proximas.sort(porFecha) }
}

function diasEntreISO(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number)
  const [by, bm, bd] = b.split("-").map(Number)
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000)
}

/** Cumpleaños dentro de los próximos `dias` días (incluye hoy; salta el cambio de año; 29-feb → 28-feb en años no bisiestos). */
export function proximosCumpleanos(
  personas: { id: number; nombre: string; fecha: string | null | undefined; tipo: "cliente" | "contacto" }[],
  hoyISO: string,
  dias = 7
): Cumpleanos[] {
  const [hy] = hoyISO.split("-").map(Number)
  const out: Cumpleanos[] = []
  for (const p of personas) {
    const f = (p.fecha || "").slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f)) continue
    const [, m, d] = f.split("-").map(Number)
    for (const anio of [hy, hy + 1]) {
      const bisiesto = (anio % 4 === 0 && anio % 100 !== 0) || anio % 400 === 0
      const dd = m === 2 && d === 29 && !bisiesto ? 28 : d
      const proximo = `${anio}-${String(m).padStart(2, "0")}-${String(dd).padStart(2, "0")}`
      const faltan = diasEntreISO(hoyISO, proximo)
      if (faltan >= 0 && faltan <= dias) {
        out.push({ nombre: p.nombre, tipo: p.tipo, id: p.id, fecha: f, diasFaltan: faltan, proximo })
        break
      }
    }
  }
  return out.sort((a, b) => a.diasFaltan - b.diasFaltan || a.nombre.localeCompare(b.nombre))
}

/** Días desde la última modificación (para el semáforo de "sin movimiento"). */
export function diasSinMovimiento(o: { updated_at: string | null; created_at: string }, hoyISO: string): number {
  const ref = (o.updated_at || o.created_at || "").slice(0, 10)
  if (!ref) return 0
  return Math.max(0, diasEntreISO(ref, hoyISO))
}

export function esCierreVencido(o: { estado: EstadoOportunidad; fecha_cierre_esperada: string | null }, hoyISO: string): boolean {
  return o.estado === "Abierta" && !!o.fecha_cierre_esperada && o.fecha_cierre_esperada < hoyISO
}

// ==================== INFRA ====================

function isMissingTable(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false
  const msg = (err.message || "").toLowerCase()
  return err.code === "42P01" || err.code === "PGRST205" || /relation .*crm_.* does not exist/.test(msg) || msg.includes("could not find the table") || msg.includes("schema cache")
}

type Ctx = { supabase: SupabaseClient; stamp: TenantStamp; error: null } | { supabase: null; stamp: null; error: string }

async function ctx(): Promise<Ctx> {
  const supabase = createClient()
  if (!supabase) return { supabase: null, stamp: null, error: "Cliente no disponible" }
  const stamp = await getTenantStamp(supabase)
  if (!isValidStamp(stamp)) return { supabase: null, stamp: null, error: SESION_INVALIDA_ERROR }
  return { supabase, stamp, error: null }
}

const blank = (v: unknown) => (typeof v === "string" && v.trim() === "" ? null : v)
const num = (v: unknown) => Number(v) || 0
const nombreDe = (v: unknown): string | null => {
  if (!v) return null
  if (Array.isArray(v)) return (v[0] as { nombre?: string } | undefined)?.nombre ?? null
  return (v as { nombre?: string }).nombre ?? null
}

// ==================== ETAPAS ====================

function mapEtapa(r: Record<string, unknown>): EtapaCrm {
  return { id: Number(r.id), nombre: String(r.nombre ?? ""), orden: num(r.orden), probabilidad: num(r.probabilidad), color: (r.color as string | null) ?? null, activo: r.activo !== false }
}

/** Etapas del pipeline; si la empresa no tiene ninguna, siembra las 5 por defecto. */
export async function getEtapas(): Promise<{ data: EtapaCrm[]; error: string | null; pendiente?: boolean }> {
  if (!isSupabaseConfigured()) return { data: [], error: null }
  const c = await ctx()
  if (c.supabase == null) return { data: [], error: c.error }
  const { data, error } = await c.supabase.from("crm_etapas").select("*").order("orden").order("id")
  if (error) {
    if (isMissingTable(error)) return { data: [], error: CRM_FEATURE_PENDING, pendiente: true }
    return { data: [], error: error.message }
  }
  if ((data || []).length > 0) return { data: (data as Record<string, unknown>[]).map(mapEtapa), error: null }
  const semilla = ETAPAS_POR_DEFECTO.map((e) => ({ ...e, razon_social_id: c.stamp.razon_social_id, usuario: c.stamp.usuario }))
  const ins = await c.supabase.from("crm_etapas").insert(semilla).select("*").order("orden")
  if (ins.error) return { data: [], error: ins.error.message }
  return { data: (ins.data as Record<string, unknown>[]).map(mapEtapa), error: null }
}

export async function saveEtapa(etapa: EtapaCrm): Promise<{ data: EtapaCrm | null; error: string | null }> {
  const c = await ctx()
  if (c.supabase == null) return { data: null, error: c.error }
  const nombre = (etapa.nombre || "").trim()
  if (!nombre) return { data: null, error: "El nombre es obligatorio" }
  const prob = Math.max(0, Math.min(100, Math.round(num(etapa.probabilidad))))
  const payload = { nombre, orden: Math.round(num(etapa.orden)), probabilidad: prob, color: blank(etapa.color ?? null), activo: etapa.activo !== false }
  const q = etapa.id != null
    ? c.supabase.from("crm_etapas").update(payload).eq("id", etapa.id).select("*").single()
    : c.supabase.from("crm_etapas").insert({ ...payload, razon_social_id: c.stamp.razon_social_id, usuario: c.stamp.usuario }).select("*").single()
  const { data, error } = await q
  if (error) return { data: null, error: error.code === "23505" ? "Ya existe una etapa con ese nombre" : error.message }
  return { data: mapEtapa(data as Record<string, unknown>), error: null }
}

export async function deleteEtapa(id: number): Promise<{ success: boolean; error: string | null }> {
  const c = await ctx()
  if (c.supabase == null) return { success: false, error: c.error }
  const { count } = await c.supabase.from("crm_oportunidades").select("id", { count: "exact", head: true }).eq("etapa_id", id)
  if ((count || 0) > 0) return { success: false, error: `La etapa tiene ${count} oportunidad(es); muévelas antes de eliminarla.` }
  const { error } = await c.supabase.from("crm_etapas").delete().eq("id", id)
  return { success: !error, error: error?.message ?? null }
}

// ==================== CONTACTOS ====================

function mapContacto(r: Record<string, unknown>): ContactoCrm {
  return {
    id: Number(r.id),
    cliente_id: r.cliente_id != null ? Number(r.cliente_id) : null,
    cliente_nombre: nombreDe(r.clientes),
    nombre: String(r.nombre ?? ""),
    cargo: (r.cargo as string | null) ?? null,
    telefono: (r.telefono as string | null) ?? null,
    correo: (r.correo as string | null) ?? null,
    cumpleanos: (r.cumpleanos as string | null) ?? null,
    notas: (r.notas as string | null) ?? null,
    activo: r.activo !== false,
  }
}

export async function getContactos(opts: { clienteId?: number | null; soloActivos?: boolean } = {}): Promise<{ data: ContactoCrm[]; error: string | null; pendiente?: boolean }> {
  if (!isSupabaseConfigured()) return { data: [], error: null }
  const supabase = createClient()
  if (!supabase) return { data: [], error: "Cliente no disponible" }
  let q = supabase.from("crm_contactos").select("*, clientes(nombre)").order("nombre")
  if (opts.clienteId != null) q = q.eq("cliente_id", opts.clienteId)
  if (opts.soloActivos !== false) q = q.eq("activo", true)
  const { data, error } = await q
  if (error) {
    if (isMissingTable(error)) return { data: [], error: CRM_FEATURE_PENDING, pendiente: true }
    return { data: [], error: error.message }
  }
  return { data: (data as Record<string, unknown>[]).map(mapContacto), error: null }
}

export async function saveContacto(contacto: ContactoCrm): Promise<{ data: ContactoCrm | null; error: string | null }> {
  const c = await ctx()
  if (c.supabase == null) return { data: null, error: c.error }
  const nombre = (contacto.nombre || "").trim()
  if (!nombre) return { data: null, error: "El nombre es obligatorio" }
  const payload = {
    cliente_id: contacto.cliente_id ?? null,
    nombre,
    cargo: blank(contacto.cargo ?? null),
    telefono: blank(contacto.telefono ?? null),
    correo: blank(contacto.correo ?? null),
    cumpleanos: blank(contacto.cumpleanos ?? null),
    notas: blank(contacto.notas ?? null),
    activo: contacto.activo !== false,
  }
  const q = contacto.id != null
    ? c.supabase.from("crm_contactos").update({ ...payload, updated_at: getHondurasNowISO() }).eq("id", contacto.id).select("*, clientes(nombre)").single()
    : c.supabase.from("crm_contactos").insert({ ...payload, razon_social_id: c.stamp.razon_social_id, usuario: c.stamp.usuario }).select("*, clientes(nombre)").single()
  const { data, error } = await q
  if (error) return { data: null, error: error.message }
  return { data: mapContacto(data as Record<string, unknown>), error: null }
}

/** Archiva (activo=false); no borra porque puede estar referenciado. */
export async function archivarContacto(id: number, activo = false): Promise<{ success: boolean; error: string | null }> {
  const c = await ctx()
  if (c.supabase == null) return { success: false, error: c.error }
  const { error } = await c.supabase.from("crm_contactos").update({ activo, updated_at: getHondurasNowISO() }).eq("id", id)
  return { success: !error, error: error?.message ?? null }
}

// ==================== OPORTUNIDADES ====================

const SELECT_OPORTUNIDAD = "*, clientes(nombre), vendedores(nombre), crm_etapas(nombre), crm_contactos(nombre)"

function mapOportunidad(r: Record<string, unknown>): OportunidadCrm {
  return {
    id: Number(r.id),
    titulo: String(r.titulo ?? ""),
    cliente_id: r.cliente_id != null ? Number(r.cliente_id) : null,
    cliente_nombre: nombreDe(r.clientes),
    prospecto_nombre: (r.prospecto_nombre as string | null) ?? null,
    contacto_id: r.contacto_id != null ? Number(r.contacto_id) : null,
    contacto_nombre: nombreDe(r.crm_contactos),
    vendedor_id: r.vendedor_id != null ? Number(r.vendedor_id) : null,
    vendedor_nombre: nombreDe(r.vendedores),
    etapa_id: Number(r.etapa_id),
    etapa_nombre: nombreDe(r.crm_etapas),
    valor_estimado: num(r.valor_estimado),
    fecha_cierre_esperada: (r.fecha_cierre_esperada as string | null) ?? null,
    origen: (r.origen as string | null) ?? null,
    estado: ((r.estado as string) || "Abierta") as EstadoOportunidad,
    motivo_perdida: (r.motivo_perdida as string | null) ?? null,
    cotizacion_id: r.cotizacion_id != null ? Number(r.cotizacion_id) : null,
    venta_id: r.venta_id != null ? Number(r.venta_id) : null,
    notas: (r.notas as string | null) ?? null,
    cerrada_at: (r.cerrada_at as string | null) ?? null,
    usuario: (r.usuario as string | null) ?? null,
    created_at: String(r.created_at ?? ""),
    updated_at: (r.updated_at as string | null) ?? null,
    proxima_actividad: null,
  }
}

/** Nombre a mostrar: cliente o prospecto. */
export function nombreCuenta(o: { cliente_nombre: string | null; prospecto_nombre: string | null }): string {
  return o.cliente_nombre || (o.prospecto_nombre ? `${o.prospecto_nombre} (prospecto)` : "—")
}

export async function getOportunidades(
  opts: { estado?: EstadoOportunidad | "Todas"; vendedorId?: number | null; clienteId?: number | null } = {}
): Promise<{ data: OportunidadCrm[]; error: string | null; pendiente?: boolean }> {
  if (!isSupabaseConfigured()) return { data: [], error: null }
  const supabase = createClient()
  if (!supabase) return { data: [], error: "Cliente no disponible" }
  let q = supabase.from("crm_oportunidades").select(SELECT_OPORTUNIDAD).order("updated_at", { ascending: false, nullsFirst: false }).order("created_at", { ascending: false })
  const estado = opts.estado ?? "Abierta"
  if (estado !== "Todas") q = q.eq("estado", estado)
  if (opts.vendedorId != null) q = q.eq("vendedor_id", opts.vendedorId)
  if (opts.clienteId != null) q = q.eq("cliente_id", opts.clienteId)
  const { data, error } = await q
  if (error) {
    if (isMissingTable(error)) return { data: [], error: CRM_FEATURE_PENDING, pendiente: true }
    return { data: [], error: error.message }
  }
  const lista = (data as Record<string, unknown>[]).map(mapOportunidad)
  const ids = lista.filter((o) => o.estado === "Abierta").map((o) => o.id)
  if (ids.length > 0) {
    const acts = await supabase.from("crm_actividades").select("oportunidad_id, fecha").eq("completada", false).in("oportunidad_id", ids).order("fecha")
    const prox = new Map<number, string>()
    for (const a of (acts.data || []) as { oportunidad_id: number; fecha: string }[]) {
      if (!prox.has(a.oportunidad_id)) prox.set(a.oportunidad_id, a.fecha)
    }
    for (const o of lista) o.proxima_actividad = prox.get(o.id) ?? null
  }
  return { data: lista, error: null }
}

export async function getOportunidad(id: number): Promise<{ data: OportunidadCrm | null; error: string | null }> {
  const supabase = createClient()
  if (!supabase) return { data: null, error: "Cliente no disponible" }
  const { data, error } = await supabase.from("crm_oportunidades").select(SELECT_OPORTUNIDAD).eq("id", id).maybeSingle()
  if (error) return { data: null, error: isMissingTable(error) ? CRM_FEATURE_PENDING : error.message }
  return { data: data ? mapOportunidad(data as Record<string, unknown>) : null, error: null }
}

function validarOportunidad(input: OportunidadInput): string | null {
  if (!(input.titulo || "").trim()) return "El título es obligatorio"
  if (input.cliente_id == null && !(input.prospecto_nombre || "").trim()) return "Elige un cliente o escribe el nombre del prospecto"
  if (!input.etapa_id) return "Elige la etapa"
  if (num(input.valor_estimado) < 0) return "El valor estimado no puede ser negativo"
  return null
}

function payloadOportunidad(input: OportunidadInput) {
  return {
    titulo: input.titulo.trim(),
    cliente_id: input.cliente_id ?? null,
    prospecto_nombre: input.cliente_id != null ? null : blank(input.prospecto_nombre ?? null),
    contacto_id: input.contacto_id ?? null,
    vendedor_id: input.vendedor_id ?? null,
    etapa_id: input.etapa_id,
    valor_estimado: r2(num(input.valor_estimado)),
    fecha_cierre_esperada: blank(input.fecha_cierre_esperada ?? null),
    origen: blank(input.origen ?? null),
    notas: blank(input.notas ?? null),
  }
}

export async function crearOportunidad(input: OportunidadInput): Promise<{ data: OportunidadCrm | null; error: string | null }> {
  const c = await ctx()
  if (c.supabase == null) return { data: null, error: c.error }
  const inv = validarOportunidad(input)
  if (inv) return { data: null, error: inv }
  const { data, error } = await c.supabase
    .from("crm_oportunidades")
    .insert({ ...payloadOportunidad(input), estado: "Abierta", razon_social_id: c.stamp.razon_social_id, usuario: c.stamp.usuario, created_at: getHondurasNowISO(), updated_at: getHondurasNowISO() })
    .select(SELECT_OPORTUNIDAD)
    .single()
  if (error) return { data: null, error: isMissingTable(error) ? CRM_FEATURE_PENDING : error.message }
  return { data: mapOportunidad(data as Record<string, unknown>), error: null }
}

export async function actualizarOportunidad(id: number, input: OportunidadInput): Promise<{ data: OportunidadCrm | null; error: string | null }> {
  const c = await ctx()
  if (c.supabase == null) return { data: null, error: c.error }
  const inv = validarOportunidad(input)
  if (inv) return { data: null, error: inv }
  const { data, error } = await c.supabase
    .from("crm_oportunidades")
    .update({ ...payloadOportunidad(input), updated_at: getHondurasNowISO() })
    .eq("id", id)
    .select(SELECT_OPORTUNIDAD)
    .single()
  if (error) return { data: null, error: error.message }
  return { data: mapOportunidad(data as Record<string, unknown>), error: null }
}

export async function moverEtapa(id: number, etapaId: number): Promise<{ success: boolean; error: string | null }> {
  const c = await ctx()
  if (c.supabase == null) return { success: false, error: c.error }
  const { error } = await c.supabase.from("crm_oportunidades").update({ etapa_id: etapaId, updated_at: getHondurasNowISO() }).eq("id", id).eq("estado", "Abierta")
  return { success: !error, error: error?.message ?? null }
}

/** Cierra como Ganada o Perdida (motivo obligatorio al perder). */
export async function cerrarOportunidad(id: number, estado: "Ganada" | "Perdida", motivo?: string | null): Promise<{ success: boolean; error: string | null }> {
  const c = await ctx()
  if (c.supabase == null) return { success: false, error: c.error }
  if (estado === "Perdida" && !(motivo || "").trim()) return { success: false, error: "Indica el motivo de la pérdida" }
  const ahora = getHondurasNowISO()
  const { error } = await c.supabase
    .from("crm_oportunidades")
    .update({ estado, motivo_perdida: estado === "Perdida" ? motivo!.trim() : null, cerrada_at: ahora, updated_at: ahora })
    .eq("id", id)
  return { success: !error, error: error?.message ?? null }
}

export async function reabrirOportunidad(id: number): Promise<{ success: boolean; error: string | null }> {
  const c = await ctx()
  if (c.supabase == null) return { success: false, error: c.error }
  const { error } = await c.supabase.from("crm_oportunidades").update({ estado: "Abierta", motivo_perdida: null, cerrada_at: null, updated_at: getHondurasNowISO() }).eq("id", id)
  return { success: !error, error: error?.message ?? null }
}

/** Borra la oportunidad y sus actividades (solo admin desde la UI). */
export async function eliminarOportunidad(id: number): Promise<{ success: boolean; error: string | null }> {
  const c = await ctx()
  if (c.supabase == null) return { success: false, error: c.error }
  const a = await c.supabase.from("crm_actividades").delete().eq("oportunidad_id", id)
  if (a.error) return { success: false, error: a.error.message }
  const { error } = await c.supabase.from("crm_oportunidades").delete().eq("id", id)
  return { success: !error, error: error?.message ?? null }
}

/** Liga la cotización creada desde la oportunidad (best-effort; la llama el editor de cotizaciones). */
export async function vincularCotizacionOportunidad(oportunidadId: number, cotizacionId: number): Promise<{ success: boolean; error: string | null }> {
  const c = await ctx()
  if (c.supabase == null) return { success: false, error: c.error }
  const { error } = await c.supabase.from("crm_oportunidades").update({ cotizacion_id: cotizacionId, updated_at: getHondurasNowISO() }).eq("id", oportunidadId)
  return { success: !error, error: error?.message ?? null }
}

// ==================== ACTIVIDADES ====================

const SELECT_ACTIVIDAD = "*, crm_oportunidades(titulo), clientes(nombre), crm_contactos(nombre), vendedores(nombre)"

function mapActividad(r: Record<string, unknown>): ActividadCrm {
  const op = r.crm_oportunidades as { titulo?: string } | { titulo?: string }[] | null
  const titulo = Array.isArray(op) ? op[0]?.titulo : op?.titulo
  return {
    id: Number(r.id),
    oportunidad_id: r.oportunidad_id != null ? Number(r.oportunidad_id) : null,
    oportunidad_titulo: titulo ?? null,
    cliente_id: r.cliente_id != null ? Number(r.cliente_id) : null,
    cliente_nombre: nombreDe(r.clientes),
    contacto_id: r.contacto_id != null ? Number(r.contacto_id) : null,
    contacto_nombre: nombreDe(r.crm_contactos),
    vendedor_id: r.vendedor_id != null ? Number(r.vendedor_id) : null,
    vendedor_nombre: nombreDe(r.vendedores),
    tipo: ((r.tipo as string) || "Tarea") as TipoActividad,
    asunto: String(r.asunto ?? ""),
    descripcion: (r.descripcion as string | null) ?? null,
    fecha: String(r.fecha ?? ""),
    resultado: (r.resultado as string | null) ?? null,
    completada: r.completada === true,
    completada_at: (r.completada_at as string | null) ?? null,
    usuario: (r.usuario as string | null) ?? null,
    created_at: String(r.created_at ?? ""),
  }
}

export async function getActividades(
  opts: { desde?: string; hasta?: string; vendedorId?: number | null; oportunidadId?: number | null; clienteId?: number | null; soloPendientes?: boolean; limite?: number } = {}
): Promise<{ data: ActividadCrm[]; error: string | null; pendiente?: boolean }> {
  if (!isSupabaseConfigured()) return { data: [], error: null }
  const supabase = createClient()
  if (!supabase) return { data: [], error: "Cliente no disponible" }
  let q = supabase.from("crm_actividades").select(SELECT_ACTIVIDAD).order("fecha", { ascending: true })
  if (opts.desde) q = q.gte("fecha", getHondurasDayRange(opts.desde).start)
  if (opts.hasta) q = q.lt("fecha", getHondurasDayRange(opts.hasta).end)
  if (opts.vendedorId != null) q = q.eq("vendedor_id", opts.vendedorId)
  if (opts.oportunidadId != null) q = q.eq("oportunidad_id", opts.oportunidadId)
  if (opts.clienteId != null) q = q.eq("cliente_id", opts.clienteId)
  if (opts.soloPendientes) q = q.eq("completada", false)
  if (opts.limite) q = q.limit(opts.limite)
  const { data, error } = await q
  if (error) {
    if (isMissingTable(error)) return { data: [], error: CRM_FEATURE_PENDING, pendiente: true }
    return { data: [], error: error.message }
  }
  return { data: (data as Record<string, unknown>[]).map(mapActividad), error: null }
}

function validarActividad(input: ActividadInput): string | null {
  if (!(input.asunto || "").trim()) return "El asunto es obligatorio"
  if (!input.fecha) return "Indica la fecha"
  if (!TIPOS_ACTIVIDAD.includes(input.tipo)) return "Tipo de actividad inválido"
  return null
}

function payloadActividad(input: ActividadInput) {
  return {
    oportunidad_id: input.oportunidad_id ?? null,
    cliente_id: input.cliente_id ?? null,
    contacto_id: input.contacto_id ?? null,
    vendedor_id: input.vendedor_id ?? null,
    tipo: input.tipo,
    asunto: input.asunto.trim(),
    descripcion: blank(input.descripcion ?? null),
    fecha: input.fecha,
  }
}

export async function crearActividad(input: ActividadInput): Promise<{ data: ActividadCrm | null; error: string | null }> {
  const c = await ctx()
  if (c.supabase == null) return { data: null, error: c.error }
  const inv = validarActividad(input)
  if (inv) return { data: null, error: inv }
  const { data, error } = await c.supabase
    .from("crm_actividades")
    .insert({ ...payloadActividad(input), razon_social_id: c.stamp.razon_social_id, usuario: c.stamp.usuario, created_at: getHondurasNowISO() })
    .select(SELECT_ACTIVIDAD)
    .single()
  if (error) return { data: null, error: isMissingTable(error) ? CRM_FEATURE_PENDING : error.message }
  if (input.oportunidad_id != null) {
    await c.supabase.from("crm_oportunidades").update({ updated_at: getHondurasNowISO() }).eq("id", input.oportunidad_id)
  }
  return { data: mapActividad(data as Record<string, unknown>), error: null }
}

export async function actualizarActividad(id: number, input: ActividadInput): Promise<{ data: ActividadCrm | null; error: string | null }> {
  const c = await ctx()
  if (c.supabase == null) return { data: null, error: c.error }
  const inv = validarActividad(input)
  if (inv) return { data: null, error: inv }
  const { data, error } = await c.supabase.from("crm_actividades").update({ ...payloadActividad(input), updated_at: getHondurasNowISO() }).eq("id", id).select(SELECT_ACTIVIDAD).single()
  if (error) return { data: null, error: error.message }
  return { data: mapActividad(data as Record<string, unknown>), error: null }
}

export async function completarActividad(id: number, resultado?: string | null): Promise<{ success: boolean; error: string | null }> {
  const c = await ctx()
  if (c.supabase == null) return { success: false, error: c.error }
  const ahora = getHondurasNowISO()
  const { data, error } = await c.supabase
    .from("crm_actividades")
    .update({ completada: true, completada_at: ahora, resultado: blank(resultado ?? null), updated_at: ahora })
    .eq("id", id)
    .select("oportunidad_id")
    .single()
  if (error) return { success: false, error: error.message }
  const opId = (data as { oportunidad_id: number | null } | null)?.oportunidad_id
  if (opId != null) await c.supabase.from("crm_oportunidades").update({ updated_at: ahora }).eq("id", opId)
  return { success: true, error: null }
}

export async function reabrirActividad(id: number): Promise<{ success: boolean; error: string | null }> {
  const c = await ctx()
  if (c.supabase == null) return { success: false, error: c.error }
  const { error } = await c.supabase.from("crm_actividades").update({ completada: false, completada_at: null, updated_at: getHondurasNowISO() }).eq("id", id)
  return { success: !error, error: error?.message ?? null }
}

export async function eliminarActividad(id: number): Promise<{ success: boolean; error: string | null }> {
  const c = await ctx()
  if (c.supabase == null) return { success: false, error: c.error }
  const { error } = await c.supabase.from("crm_actividades").delete().eq("id", id)
  return { success: !error, error: error?.message ?? null }
}

// ==================== AGENDA ====================

export interface Agenda {
  vencidas: ActividadCrm[]
  hoy: ActividadCrm[]
  proximas: ActividadCrm[]
  cumpleanos: Cumpleanos[]
}

/** Pendientes vencidas + hoy + próximos N días, y cumpleaños de clientes/contactos. */
export async function getAgenda(opts: { vendedorId?: number | null; diasAdelante?: number } = {}): Promise<{ data: Agenda | null; error: string | null; pendiente?: boolean }> {
  if (!isSupabaseConfigured()) return { data: null, error: null }
  const supabase = createClient()
  if (!supabase) return { data: null, error: "Cliente no disponible" }
  const hoy = getHondurasTodayISODate()
  const dias = opts.diasAdelante ?? 7
  const [y, m, d] = hoy.split("-").map(Number)
  const lim = new Date(Date.UTC(y, m - 1, d + dias))
  const hasta = `${lim.getUTCFullYear()}-${String(lim.getUTCMonth() + 1).padStart(2, "0")}-${String(lim.getUTCDate()).padStart(2, "0")}`

  const actsRes = await getActividades({ hasta, vendedorId: opts.vendedorId ?? null, soloPendientes: true })
  if (actsRes.error) return { data: null, error: actsRes.error, pendiente: actsRes.pendiente }
  const grupos = clasificarActividades(actsRes.data, hoy)

  const [cli, con] = await Promise.all([
    supabase.from("clientes").select("id, nombre, fecha_nacimiento").not("fecha_nacimiento", "is", null),
    supabase.from("crm_contactos").select("id, nombre, cumpleanos").eq("activo", true).not("cumpleanos", "is", null),
  ])
  const personas = [
    ...((cli.data || []) as { id: number; nombre: string; fecha_nacimiento: string | null }[]).map((c) => ({ id: c.id, nombre: c.nombre, fecha: c.fecha_nacimiento, tipo: "cliente" as const })),
    ...((con.data || []) as { id: number; nombre: string; cumpleanos: string | null }[]).map((c) => ({ id: c.id, nombre: c.nombre, fecha: c.cumpleanos, tipo: "contacto" as const })),
  ]
  return { data: { ...grupos, cumpleanos: proximosCumpleanos(personas, hoy, dias) }, error: null }
}

/** Badge del sidebar: pendientes de hoy o vencidas (todas las de la empresa). */
export async function contarAgendaPendiente(): Promise<number> {
  if (!isSupabaseConfigured()) return 0
  const supabase = createClient()
  if (!supabase) return 0
  try {
    const { end } = getHondurasDayRange(getHondurasTodayISODate())
    const { count, error } = await supabase.from("crm_actividades").select("id", { count: "exact", head: true }).eq("completada", false).lt("fecha", end)
    if (error) return 0
    return count || 0
  } catch {
    return 0
  }
}

// ==================== REPORTE DE GESTIÓN ====================

export interface ReporteGestion {
  pipeline: ReturnType<typeof resumirPipeline>
  cierre: ReturnType<typeof tasaCierre>
  porVendedor: ResumenClave[]
  porOrigen: ResumenClave[]
  motivosPerdida: { clave: string; cantidad: number }[]
  actividadesPorTipo: { clave: string; cantidad: number }[]
  actividadesCompletadas: number
  actividadesPendientes: number
  cierresVencidos: number
}

/** Pura: pipeline = abiertas (foto actual); cerradas = las cerradas dentro del rango. */
export function construirReporteGestion(oportunidades: OportunidadCrm[], actividades: ActividadCrm[], etapas: EtapaCrm[], rango: { desde: string; hasta: string }, hoyISO: string): ReporteGestion {
  const abiertas = oportunidades.filter((o) => o.estado === "Abierta")
  const cerradasEnRango = oportunidades.filter((o) => o.estado !== "Abierta" && !!o.cerrada_at && o.cerrada_at.slice(0, 10) >= rango.desde && o.cerrada_at.slice(0, 10) <= rango.hasta)
  const universo = [...abiertas, ...cerradasEnRango]
  return {
    pipeline: resumirPipeline(abiertas, etapas),
    cierre: tasaCierre(cerradasEnRango),
    porVendedor: resumirPorClave(universo, (o) => o.vendedor_nombre || "(sin vendedor)"),
    porOrigen: resumirPorClave(universo, (o) => o.origen || "(sin origen)"),
    motivosPerdida: contarPor(cerradasEnRango.filter((o) => o.estado === "Perdida"), (o) => o.motivo_perdida),
    actividadesPorTipo: contarPor(actividades, (a) => a.tipo),
    actividadesCompletadas: actividades.filter((a) => a.completada).length,
    actividadesPendientes: actividades.filter((a) => !a.completada).length,
    cierresVencidos: abiertas.filter((o) => esCierreVencido(o, hoyISO)).length,
  }
}

export async function getReporteGestion(rango: { desde: string; hasta: string }): Promise<{ data: ReporteGestion | null; error: string | null; pendiente?: boolean }> {
  const [ops, acts, etapas] = await Promise.all([getOportunidades({ estado: "Todas" }), getActividades({ desde: rango.desde, hasta: rango.hasta }), getEtapas()])
  const err = ops.error || acts.error || etapas.error
  if (err) return { data: null, error: err, pendiente: ops.pendiente || acts.pendiente || etapas.pendiente }
  return { data: construirReporteGestion(ops.data, acts.data, etapas.data, rango, getHondurasTodayISODate()), error: null }
}
