import * as XLSX from "xlsx"
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client"
import { STORAGE_PREFIX } from "@/lib/supabase/schema"
import { getTenantStamp, isValidStamp, SESION_INVALIDA_ERROR } from "@/lib/services/tenant-stamp"
import { getHondurasNowISO, getHondurasTodayISODate } from "@/lib/utils/honduras-time"

/**
 * RRHH (Fase 7, script officemart-018): empleados, documentos (bucket privado
 * `documentos`, carpeta officemart/rrhh/<tenant>/), marcaciones, novedades y
 * parámetros versionados. El cálculo de nómina vive en `nomina.ts`.
 * Fechas/horas en convención HN-as-UTC como el resto de la app.
 */

export const RRHH_FEATURE_PENDING = "RRHH pendiente: aplica scripts/officemart-018-rrhh.sql en Supabase."
const BUCKET = "documentos"

// ==================== TIPOS ====================

export type FrecuenciaPago = "Mensual" | "Quincenal"
export type TipoContrato = "Permanente" | "Temporal" | "Por hora"
export type FormaPagoEmpleado = "Efectivo" | "Transferencia"

export interface Empleado {
  id?: number
  codigo?: string | null
  nombre: string
  identidad?: string | null
  rtn?: string | null
  fecha_nacimiento?: string | null
  telefono?: string | null
  correo?: string | null
  direccion?: string | null
  puesto?: string | null
  departamento?: string | null
  fecha_ingreso?: string | null
  fecha_salida?: string | null
  tipo_contrato: TipoContrato
  salario_mensual: number
  frecuencia_pago: FrecuenciaPago
  forma_pago: FormaPagoEmpleado
  banco?: string | null
  cuenta_bancaria?: string | null
  usuario_id?: string | null
  vendedor_id?: number | null
  ihss_afiliacion?: string | null
  rap_afiliacion?: string | null
  aplica_ihss: boolean
  aplica_rap: boolean
  aplica_isr: boolean
  estado: "Activo" | "Inactivo"
  notas?: string | null
  created_at?: string
}

export type TipoDocumentoEmpleado = "Identidad" | "Contrato" | "Certificado" | "Medico" | "Otro"
export const TIPOS_DOCUMENTO_EMPLEADO: TipoDocumentoEmpleado[] = ["Identidad", "Contrato", "Certificado", "Medico", "Otro"]

export interface EmpleadoDocumento {
  id: number
  empleado_id: number
  tipo: TipoDocumentoEmpleado
  nombre: string
  archivo_path: string
  vence_en: string | null
  notas: string | null
  created_at: string
}

export interface Marcacion {
  id: number
  empleado_id: number
  empleado_nombre?: string | null
  fecha: string
  entrada: string | null
  salida: string | null
  horas: number | null
  origen: "app" | "manual" | "import"
  notas: string | null
}

export type TipoNovedad =
  | "Horas extra diurna"
  | "Horas extra nocturna"
  | "Horas extra mixta"
  | "Bono"
  | "Comision"
  | "Aguinaldo"
  | "Otro ingreso"
  | "Vacaciones"
  | "Permiso con goce"
  | "Permiso sin goce"
  | "Incapacidad"
  | "Ausencia"
  | "Deduccion"
  | "Anticipo"
  | "Prestamo"

export interface DefTipoNovedad {
  tipo: TipoNovedad
  /** ingreso suma al devengado; deduccion resta; dias descuenta días de salario; info no afecta dinero. */
  efecto: "ingreso" | "deduccion" | "dias" | "info"
  unidad: "horas" | "dias" | "monto"
  gravable: boolean
  cotizable: boolean
}

export const TIPOS_NOVEDAD: DefTipoNovedad[] = [
  { tipo: "Horas extra diurna", efecto: "ingreso", unidad: "horas", gravable: true, cotizable: true },
  { tipo: "Horas extra nocturna", efecto: "ingreso", unidad: "horas", gravable: true, cotizable: true },
  { tipo: "Horas extra mixta", efecto: "ingreso", unidad: "horas", gravable: true, cotizable: true },
  { tipo: "Bono", efecto: "ingreso", unidad: "monto", gravable: true, cotizable: true },
  { tipo: "Comision", efecto: "ingreso", unidad: "monto", gravable: true, cotizable: true },
  { tipo: "Aguinaldo", efecto: "ingreso", unidad: "monto", gravable: false, cotizable: false },
  { tipo: "Otro ingreso", efecto: "ingreso", unidad: "monto", gravable: true, cotizable: false },
  { tipo: "Vacaciones", efecto: "info", unidad: "dias", gravable: false, cotizable: false },
  { tipo: "Permiso con goce", efecto: "info", unidad: "dias", gravable: false, cotizable: false },
  { tipo: "Permiso sin goce", efecto: "dias", unidad: "dias", gravable: false, cotizable: false },
  { tipo: "Incapacidad", efecto: "info", unidad: "dias", gravable: false, cotizable: false },
  { tipo: "Ausencia", efecto: "dias", unidad: "dias", gravable: false, cotizable: false },
  { tipo: "Deduccion", efecto: "deduccion", unidad: "monto", gravable: false, cotizable: false },
  { tipo: "Anticipo", efecto: "deduccion", unidad: "monto", gravable: false, cotizable: false },
  { tipo: "Prestamo", efecto: "deduccion", unidad: "monto", gravable: false, cotizable: false },
]

export function defNovedad(tipo: string): DefTipoNovedad {
  return TIPOS_NOVEDAD.find((t) => t.tipo === tipo) ?? { tipo: "Otro ingreso", efecto: "ingreso", unidad: "monto", gravable: true, cotizable: false }
}

export interface Novedad {
  id?: number
  empleado_id: number
  empleado_nombre?: string | null
  tipo: TipoNovedad
  fecha: string
  cantidad?: number | null
  monto?: number | null
  gravable: boolean
  cotizable: boolean
  descripcion?: string | null
  nomina_id?: number | null
  created_at?: string
}

export interface VersionParametros {
  id: number
  vigente_desde: string
  nombre: string | null
  parametros: Record<string, unknown>
  created_at: string
}

// ==================== PURAS ====================

const r2 = (n: number) => +(Number(n) || 0).toFixed(2)

/** Horas entre entrada y salida (ISO HN-as-UTC); null si falta alguna. */
export function calcularHoras(entrada: string | null | undefined, salida: string | null | undefined): number | null {
  if (!entrada || !salida) return null
  const ms = new Date(salida).getTime() - new Date(entrada).getTime()
  if (!Number.isFinite(ms) || ms <= 0) return 0
  return r2(ms / 3_600_000)
}

/** Documentos vencidos o por vencer en los próximos `dias` días. */
export function documentosPorVencer<T extends { vence_en: string | null }>(docs: T[], hoyISO: string, dias = 30): (T & { diasRestantes: number })[] {
  const [y, m, d] = hoyISO.split("-").map(Number)
  const hoy = Date.UTC(y, m - 1, d)
  const out: (T & { diasRestantes: number })[] = []
  for (const doc of docs) {
    if (!doc.vence_en) continue
    const [vy, vm, vd] = doc.vence_en.slice(0, 10).split("-").map(Number)
    const rest = Math.round((Date.UTC(vy, vm - 1, vd) - hoy) / 86_400_000)
    if (rest <= dias) out.push({ ...doc, diasRestantes: rest })
  }
  return out.sort((a, b) => a.diasRestantes - b.diasRestantes)
}

/** Antigüedad en años completos a la fecha (o a la salida). */
export function antiguedadAnios(fechaIngreso: string | null | undefined, hoyISO: string, fechaSalida?: string | null): number {
  if (!fechaIngreso) return 0
  const fin = fechaSalida && fechaSalida < hoyISO ? fechaSalida : hoyISO
  const [iy, im, id] = fechaIngreso.slice(0, 10).split("-").map(Number)
  const [fy, fm, fd] = fin.slice(0, 10).split("-").map(Number)
  let anios = fy - iy
  if (fm < im || (fm === im && fd < id)) anios -= 1
  return Math.max(0, anios)
}

/** Días de vacaciones por antigüedad (Código de Trabajo, art. 346): 10/12/15/20. */
export function diasVacacionesPorAntiguedad(anios: number): number {
  if (anios < 1) return 0
  if (anios === 1) return 10
  if (anios === 2) return 12
  if (anios === 3) return 15
  return 20
}

export interface FilaMarcacionImportada {
  fila: number
  empleado: string
  fecha: string
  entrada: string | null
  salida: string | null
  error?: string
}

function normHeader(s: unknown): string {
  return String(s ?? "").toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/[^a-z0-9]/g, "")
}

function serialAFecha(v: unknown): string | null {
  if (v == null || v === "") return null
  if (typeof v === "number") {
    const d = XLSX.SSF.parse_date_code(v)
    if (!d) return null
    return `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`
  }
  const s = String(v).trim()
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/.exec(s)
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`
  return null
}

function serialAHora(v: unknown): string | null {
  if (v == null || v === "") return null
  if (typeof v === "number") {
    const frac = v - Math.floor(v)
    const mins = Math.round(frac * 24 * 60)
    return `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`
  }
  const m = /(\d{1,2}):(\d{2})/.exec(String(v))
  if (!m) return null
  return `${m[1].padStart(2, "0")}:${m[2]}`
}

/** Mapea filas crudas (encabezado + datos) a marcaciones: Empleado/Código, Fecha, Entrada, Salida. */
export function mapearMarcacionesImportadas(matriz: unknown[][]): FilaMarcacionImportada[] {
  if (matriz.length === 0) return []
  const enc = matriz[0].map(normHeader)
  const col = (...alias: string[]) => enc.findIndex((h) => alias.some((a) => h === a || h.startsWith(a)))
  const cEmp = col("empleado", "codigo", "nombre", "colaborador")
  const cFecha = col("fecha", "dia", "date")
  const cEnt = col("entrada", "in", "checkin", "ingreso")
  const cSal = col("salida", "out", "checkout")
  const out: FilaMarcacionImportada[] = []
  for (let i = 1; i < matriz.length; i++) {
    const fila = matriz[i]
    if (!fila || fila.every((c) => c == null || c === "")) continue
    const empleado = String(cEmp >= 0 ? fila[cEmp] ?? "" : "").trim()
    const fecha = cFecha >= 0 ? serialAFecha(fila[cFecha]) : null
    const entrada = cEnt >= 0 ? serialAHora(fila[cEnt]) : null
    const salida = cSal >= 0 ? serialAHora(fila[cSal]) : null
    const r: FilaMarcacionImportada = { fila: i + 1, empleado, fecha: fecha || "", entrada, salida }
    if (!empleado) r.error = "Sin empleado"
    else if (!fecha) r.error = "Fecha inválida"
    else if (!entrada && !salida) r.error = "Sin entrada ni salida"
    out.push(r)
  }
  return out
}

export async function parsearMarcacionesXlsx(file: File): Promise<FilaMarcacionImportada[]> {
  const buffer = await file.arrayBuffer()
  const wb = XLSX.read(buffer, { type: "array", cellDates: false })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const matriz = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "", raw: true }) as unknown[][]
  return mapearMarcacionesImportadas(matriz)
}

/** Busca el empleado por código, nombre exacto o nombre contenido (pura). */
export function resolverEmpleado(texto: string, empleados: Empleado[]): Empleado | null {
  const t = texto.trim().toLowerCase()
  if (!t) return null
  return (
    empleados.find((e) => (e.codigo || "").toLowerCase() === t) ??
    empleados.find((e) => e.nombre.toLowerCase() === t) ??
    empleados.find((e) => e.nombre.toLowerCase().includes(t) || t.includes(e.nombre.toLowerCase())) ??
    null
  )
}

// ==================== INFRA ====================

function isMissingTable(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false
  const msg = (err.message || "").toLowerCase()
  return err.code === "42P01" || err.code === "PGRST205" || /relation .*(empleados|rrhh_).* does not exist/.test(msg) || msg.includes("could not find the table") || msg.includes("schema cache") || msg.includes("bucket not found")
}

const blank = (v: unknown) => (typeof v === "string" && v.trim() === "" ? null : v)
const num = (v: unknown) => Number(v) || 0

async function ctx() {
  const supabase = createClient()
  if (!supabase) return { supabase: null, stamp: null, error: "Cliente no disponible" as string | null }
  const stamp = await getTenantStamp(supabase)
  if (!isValidStamp(stamp)) return { supabase: null, stamp: null, error: SESION_INVALIDA_ERROR as string | null }
  return { supabase, stamp, error: null as string | null }
}

// ==================== EMPLEADOS ====================

function mapEmpleado(r: Record<string, unknown>): Empleado {
  return {
    id: Number(r.id),
    codigo: (r.codigo as string | null) ?? null,
    nombre: String(r.nombre ?? ""),
    identidad: (r.identidad as string | null) ?? null,
    rtn: (r.rtn as string | null) ?? null,
    fecha_nacimiento: (r.fecha_nacimiento as string | null) ?? null,
    telefono: (r.telefono as string | null) ?? null,
    correo: (r.correo as string | null) ?? null,
    direccion: (r.direccion as string | null) ?? null,
    puesto: (r.puesto as string | null) ?? null,
    departamento: (r.departamento as string | null) ?? null,
    fecha_ingreso: (r.fecha_ingreso as string | null) ?? null,
    fecha_salida: (r.fecha_salida as string | null) ?? null,
    tipo_contrato: ((r.tipo_contrato as string) || "Permanente") as TipoContrato,
    salario_mensual: num(r.salario_mensual),
    frecuencia_pago: ((r.frecuencia_pago as string) || "Mensual") as FrecuenciaPago,
    forma_pago: ((r.forma_pago as string) || "Transferencia") as FormaPagoEmpleado,
    banco: (r.banco as string | null) ?? null,
    cuenta_bancaria: (r.cuenta_bancaria as string | null) ?? null,
    usuario_id: (r.usuario_id as string | null) ?? null,
    vendedor_id: r.vendedor_id != null ? Number(r.vendedor_id) : null,
    ihss_afiliacion: (r.ihss_afiliacion as string | null) ?? null,
    rap_afiliacion: (r.rap_afiliacion as string | null) ?? null,
    aplica_ihss: r.aplica_ihss !== false,
    aplica_rap: r.aplica_rap !== false,
    aplica_isr: r.aplica_isr !== false,
    estado: r.estado === "Inactivo" ? "Inactivo" : "Activo",
    notas: (r.notas as string | null) ?? null,
    created_at: (r.created_at as string) ?? undefined,
  }
}

export async function getEmpleados(opts: { soloActivos?: boolean } = {}): Promise<{ data: Empleado[]; error: string | null; pendiente?: boolean }> {
  if (!isSupabaseConfigured()) return { data: [], error: null }
  const supabase = createClient()
  if (!supabase) return { data: [], error: "Cliente no disponible" }
  let q = supabase.from("empleados").select("*").order("nombre")
  if (opts.soloActivos) q = q.eq("estado", "Activo")
  const { data, error } = await q
  if (error) {
    if (isMissingTable(error)) return { data: [], error: RRHH_FEATURE_PENDING, pendiente: true }
    return { data: [], error: error.message }
  }
  return { data: (data as Record<string, unknown>[]).map(mapEmpleado), error: null }
}

/** Usuarios de la empresa (id = auth uid) para ligar un empleado a su cuenta de la app. */
export async function getUsuariosParaVincular(): Promise<{ id: string; nombre: string; activo: boolean }[]> {
  if (!isSupabaseConfigured()) return []
  const supabase = createClient()
  if (!supabase) return []
  const { data } = await supabase.from("usuarios").select("id, nombre, activo").order("nombre")
  return ((data || []) as { id: string; nombre: string | null; activo: boolean | null }[]).map((u) => ({ id: u.id, nombre: u.nombre || u.id, activo: u.activo !== false }))
}

export async function getEmpleadoDeUsuario(authUserId: string | null | undefined): Promise<Empleado | null> {
  if (!authUserId || !isSupabaseConfigured()) return null
  const supabase = createClient()
  if (!supabase) return null
  const { data } = await supabase.from("empleados").select("*").eq("usuario_id", authUserId).eq("estado", "Activo").maybeSingle()
  return data ? mapEmpleado(data as Record<string, unknown>) : null
}

export async function saveEmpleado(e: Empleado): Promise<{ data: Empleado | null; error: string | null }> {
  const c = await ctx()
  if (c.supabase == null) return { data: null, error: c.error }
  if (!(e.nombre || "").trim()) return { data: null, error: "El nombre es obligatorio" }
  if (num(e.salario_mensual) < 0) return { data: null, error: "El salario no puede ser negativo" }
  const payload = {
    codigo: blank(e.codigo ?? null),
    nombre: e.nombre.trim(),
    identidad: blank(e.identidad ?? null),
    rtn: blank(e.rtn ?? null),
    fecha_nacimiento: blank(e.fecha_nacimiento ?? null),
    telefono: blank(e.telefono ?? null),
    correo: blank(e.correo ?? null),
    direccion: blank(e.direccion ?? null),
    puesto: blank(e.puesto ?? null),
    departamento: blank(e.departamento ?? null),
    fecha_ingreso: blank(e.fecha_ingreso ?? null),
    fecha_salida: blank(e.fecha_salida ?? null),
    tipo_contrato: e.tipo_contrato || "Permanente",
    salario_mensual: r2(num(e.salario_mensual)),
    frecuencia_pago: e.frecuencia_pago || "Mensual",
    forma_pago: e.forma_pago || "Transferencia",
    banco: blank(e.banco ?? null),
    cuenta_bancaria: blank(e.cuenta_bancaria ?? null),
    usuario_id: blank(e.usuario_id ?? null),
    vendedor_id: e.vendedor_id ?? null,
    ihss_afiliacion: blank(e.ihss_afiliacion ?? null),
    rap_afiliacion: blank(e.rap_afiliacion ?? null),
    aplica_ihss: e.aplica_ihss !== false,
    aplica_rap: e.aplica_rap !== false,
    aplica_isr: e.aplica_isr !== false,
    estado: e.estado === "Inactivo" ? "Inactivo" : "Activo",
    notas: blank(e.notas ?? null),
  }
  const q = e.id != null
    ? c.supabase.from("empleados").update({ ...payload, updated_at: getHondurasNowISO() }).eq("id", e.id).select("*").single()
    : c.supabase.from("empleados").insert({ ...payload, razon_social_id: c.stamp.razon_social_id, usuario: c.stamp.usuario }).select("*").single()
  const { data, error } = await q
  if (error) return { data: null, error: isMissingTable(error) ? RRHH_FEATURE_PENDING : error.message }
  return { data: mapEmpleado(data as Record<string, unknown>), error: null }
}

export async function setEstadoEmpleado(id: number, estado: "Activo" | "Inactivo", fechaSalida?: string | null): Promise<{ success: boolean; error: string | null }> {
  const c = await ctx()
  if (c.supabase == null) return { success: false, error: c.error }
  const patch: Record<string, unknown> = { estado, updated_at: getHondurasNowISO() }
  if (estado === "Inactivo") patch.fecha_salida = fechaSalida || getHondurasTodayISODate()
  else patch.fecha_salida = null
  const { error } = await c.supabase.from("empleados").update(patch).eq("id", id)
  return { success: !error, error: error?.message ?? null }
}

// ==================== DOCUMENTOS ====================

function mapDoc(r: Record<string, unknown>): EmpleadoDocumento {
  return {
    id: Number(r.id),
    empleado_id: Number(r.empleado_id),
    tipo: ((r.tipo as string) || "Otro") as TipoDocumentoEmpleado,
    nombre: String(r.nombre ?? ""),
    archivo_path: String(r.archivo_path ?? ""),
    vence_en: (r.vence_en as string | null) ?? null,
    notas: (r.notas as string | null) ?? null,
    created_at: String(r.created_at ?? ""),
  }
}

export async function getDocumentosEmpleado(empleadoId?: number | null): Promise<{ data: EmpleadoDocumento[]; error: string | null }> {
  const supabase = createClient()
  if (!supabase) return { data: [], error: "Cliente no disponible" }
  let q = supabase.from("empleados_documentos").select("*").order("created_at", { ascending: false })
  if (empleadoId != null) q = q.eq("empleado_id", empleadoId)
  const { data, error } = await q
  if (error) return { data: [], error: isMissingTable(error) ? RRHH_FEATURE_PENDING : error.message }
  return { data: (data as Record<string, unknown>[]).map(mapDoc), error: null }
}

export async function subirDocumentoEmpleado(empleadoId: number, file: File, meta: { tipo: TipoDocumentoEmpleado; nombre?: string; vence_en?: string | null; notas?: string | null }): Promise<{ data: EmpleadoDocumento | null; error: string | null }> {
  const c = await ctx()
  if (c.supabase == null) return { data: null, error: c.error }
  if (file.size > 10 * 1024 * 1024) return { data: null, error: "El archivo supera 10 MB" }
  const tenant = Number(c.stamp.razon_social_id)
  const limpio = file.name.replace(/[^A-Za-z0-9._-]/g, "_")
  const path = `${STORAGE_PREFIX}rrhh/${tenant}/${empleadoId}/${Date.now()}-${limpio}`
  const up = await c.supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type || "application/octet-stream", upsert: false })
  if (up.error) return { data: null, error: isMissingTable(up.error) ? "Bucket `documentos` no existe: aplica officemart-017." : up.error.message }
  const { data, error } = await c.supabase
    .from("empleados_documentos")
    .insert({ razon_social_id: tenant, usuario: c.stamp.usuario, empleado_id: empleadoId, tipo: meta.tipo, nombre: (meta.nombre || file.name).trim(), archivo_path: path, vence_en: blank(meta.vence_en ?? null), notas: blank(meta.notas ?? null) })
    .select("*")
    .single()
  if (error) {
    await c.supabase.storage.from(BUCKET).remove([path])
    return { data: null, error: isMissingTable(error) ? RRHH_FEATURE_PENDING : error.message }
  }
  return { data: mapDoc(data as Record<string, unknown>), error: null }
}

export async function urlDocumentoEmpleado(path: string): Promise<{ url: string | null; error: string | null }> {
  const supabase = createClient()
  if (!supabase) return { url: null, error: "Cliente no disponible" }
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 120)
  if (error) return { url: null, error: error.message }
  return { url: data?.signedUrl ?? null, error: null }
}

export async function eliminarDocumentoEmpleado(doc: EmpleadoDocumento): Promise<{ success: boolean; error: string | null }> {
  const supabase = createClient()
  if (!supabase) return { success: false, error: "Cliente no disponible" }
  const { error } = await supabase.from("empleados_documentos").delete().eq("id", doc.id)
  if (error) return { success: false, error: error.message }
  await supabase.storage.from(BUCKET).remove([doc.archivo_path])
  return { success: true, error: null }
}

// ==================== MARCACIONES ====================

function mapMarcacion(r: Record<string, unknown>): Marcacion {
  const emp = r.empleados as { nombre?: string } | { nombre?: string }[] | null
  return {
    id: Number(r.id),
    empleado_id: Number(r.empleado_id),
    empleado_nombre: Array.isArray(emp) ? emp[0]?.nombre ?? null : emp?.nombre ?? null,
    fecha: String(r.fecha ?? ""),
    entrada: (r.entrada as string | null) ?? null,
    salida: (r.salida as string | null) ?? null,
    horas: r.horas != null ? Number(r.horas) : null,
    origen: ((r.origen as string) || "app") as Marcacion["origen"],
    notas: (r.notas as string | null) ?? null,
  }
}

export async function getMarcaciones(opts: { desde: string; hasta: string; empleadoId?: number | null }): Promise<{ data: Marcacion[]; error: string | null; pendiente?: boolean }> {
  if (!isSupabaseConfigured()) return { data: [], error: null }
  const supabase = createClient()
  if (!supabase) return { data: [], error: "Cliente no disponible" }
  let q = supabase.from("rrhh_marcaciones").select("*, empleados(nombre)").gte("fecha", opts.desde).lte("fecha", opts.hasta).order("fecha", { ascending: false })
  if (opts.empleadoId != null) q = q.eq("empleado_id", opts.empleadoId)
  const { data, error } = await q
  if (error) {
    if (isMissingTable(error)) return { data: [], error: RRHH_FEATURE_PENDING, pendiente: true }
    return { data: [], error: error.message }
  }
  return { data: (data as Record<string, unknown>[]).map(mapMarcacion), error: null }
}

/** Marca entrada o salida del día (hora de Honduras) para un empleado. */
export async function marcar(empleadoId: number, tipo: "entrada" | "salida"): Promise<{ data: Marcacion | null; error: string | null }> {
  const c = await ctx()
  if (c.supabase == null) return { data: null, error: c.error }
  const ahora = getHondurasNowISO()
  const hoy = getHondurasTodayISODate()
  const ex = await c.supabase.from("rrhh_marcaciones").select("*").eq("empleado_id", empleadoId).eq("fecha", hoy).maybeSingle()
  if (ex.error) return { data: null, error: isMissingTable(ex.error) ? RRHH_FEATURE_PENDING : ex.error.message }
  const actual = ex.data as Record<string, unknown> | null
  if (tipo === "entrada") {
    if (actual?.entrada) return { data: null, error: "Ya marcaste entrada hoy" }
    const q = actual
      ? c.supabase.from("rrhh_marcaciones").update({ entrada: ahora, updated_at: ahora }).eq("id", actual.id as number).select("*").single()
      : c.supabase.from("rrhh_marcaciones").insert({ razon_social_id: c.stamp.razon_social_id, usuario: c.stamp.usuario, empleado_id: empleadoId, fecha: hoy, entrada: ahora, origen: "app" }).select("*").single()
    const { data, error } = await q
    if (error) return { data: null, error: error.message }
    return { data: mapMarcacion(data as Record<string, unknown>), error: null }
  }
  if (!actual?.entrada) return { data: null, error: "Primero marca la entrada" }
  if (actual.salida) return { data: null, error: "Ya marcaste salida hoy" }
  const horas = calcularHoras(actual.entrada as string, ahora)
  const { data, error } = await c.supabase.from("rrhh_marcaciones").update({ salida: ahora, horas, updated_at: ahora }).eq("id", actual.id as number).select("*").single()
  if (error) return { data: null, error: error.message }
  return { data: mapMarcacion(data as Record<string, unknown>), error: null }
}

/** Alta/edición manual (o importada) de la marcación de un día. Horas "HH:mm" en hora de Honduras. */
export async function saveMarcacion(input: { empleado_id: number; fecha: string; entrada?: string | null; salida?: string | null; notas?: string | null; origen?: Marcacion["origen"] }): Promise<{ data: Marcacion | null; error: string | null }> {
  const c = await ctx()
  if (c.supabase == null) return { data: null, error: c.error }
  const ent = input.entrada ? `${input.fecha}T${input.entrada.length === 5 ? input.entrada : input.entrada.slice(11, 16)}:00.000Z` : null
  const sal = input.salida ? `${input.fecha}T${input.salida.length === 5 ? input.salida : input.salida.slice(11, 16)}:00.000Z` : null
  const payload = { entrada: ent, salida: sal, horas: calcularHoras(ent, sal), notas: blank(input.notas ?? null), origen: input.origen || "manual", updated_at: getHondurasNowISO() }
  const { data, error } = await c.supabase
    .from("rrhh_marcaciones")
    .upsert({ ...payload, razon_social_id: c.stamp.razon_social_id, usuario: c.stamp.usuario, empleado_id: input.empleado_id, fecha: input.fecha }, { onConflict: "empleado_id,fecha" })
    .select("*")
    .single()
  if (error) return { data: null, error: isMissingTable(error) ? RRHH_FEATURE_PENDING : error.message }
  return { data: mapMarcacion(data as Record<string, unknown>), error: null }
}

export async function eliminarMarcacion(id: number): Promise<{ success: boolean; error: string | null }> {
  const supabase = createClient()
  if (!supabase) return { success: false, error: "Cliente no disponible" }
  const { error } = await supabase.from("rrhh_marcaciones").delete().eq("id", id)
  return { success: !error, error: error?.message ?? null }
}

/** Importa filas ya resueltas a empleado; devuelve cuántas se guardaron y los errores. */
export async function importarMarcaciones(filas: { empleado_id: number; fecha: string; entrada: string | null; salida: string | null }[]): Promise<{ guardadas: number; errores: string[] }> {
  let guardadas = 0
  const errores: string[] = []
  for (const f of filas) {
    const r = await saveMarcacion({ ...f, origen: "import" })
    if (r.error) errores.push(`${f.fecha}: ${r.error}`)
    else guardadas += 1
  }
  return { guardadas, errores }
}

// ==================== NOVEDADES ====================

function mapNovedad(r: Record<string, unknown>): Novedad {
  const emp = r.empleados as { nombre?: string } | { nombre?: string }[] | null
  return {
    id: Number(r.id),
    empleado_id: Number(r.empleado_id),
    empleado_nombre: Array.isArray(emp) ? emp[0]?.nombre ?? null : emp?.nombre ?? null,
    tipo: (r.tipo as TipoNovedad) || "Otro ingreso",
    fecha: String(r.fecha ?? ""),
    cantidad: r.cantidad != null ? Number(r.cantidad) : null,
    monto: r.monto != null ? Number(r.monto) : null,
    gravable: r.gravable !== false,
    cotizable: r.cotizable !== false,
    descripcion: (r.descripcion as string | null) ?? null,
    nomina_id: r.nomina_id != null ? Number(r.nomina_id) : null,
    created_at: (r.created_at as string) ?? undefined,
  }
}

export async function getNovedades(opts: { desde?: string; hasta?: string; empleadoId?: number | null; sinAplicar?: boolean; nominaId?: number | null } = {}): Promise<{ data: Novedad[]; error: string | null; pendiente?: boolean }> {
  if (!isSupabaseConfigured()) return { data: [], error: null }
  const supabase = createClient()
  if (!supabase) return { data: [], error: "Cliente no disponible" }
  let q = supabase.from("rrhh_novedades").select("*, empleados(nombre)").order("fecha", { ascending: false }).order("id", { ascending: false })
  if (opts.desde) q = q.gte("fecha", opts.desde)
  if (opts.hasta) q = q.lte("fecha", opts.hasta)
  if (opts.empleadoId != null) q = q.eq("empleado_id", opts.empleadoId)
  if (opts.sinAplicar) q = q.is("nomina_id", null)
  if (opts.nominaId != null) q = q.eq("nomina_id", opts.nominaId)
  const { data, error } = await q
  if (error) {
    if (isMissingTable(error)) return { data: [], error: RRHH_FEATURE_PENDING, pendiente: true }
    return { data: [], error: error.message }
  }
  return { data: (data as Record<string, unknown>[]).map(mapNovedad), error: null }
}

export async function saveNovedad(n: Novedad): Promise<{ data: Novedad | null; error: string | null }> {
  const c = await ctx()
  if (c.supabase == null) return { data: null, error: c.error }
  const def = defNovedad(n.tipo)
  if (!n.empleado_id) return { data: null, error: "Elige el empleado" }
  if (!n.fecha) return { data: null, error: "Indica la fecha" }
  if (def.unidad === "monto" && num(n.monto) <= 0) return { data: null, error: "Indica el monto" }
  if (def.unidad !== "monto" && num(n.cantidad) <= 0) return { data: null, error: `Indica la cantidad de ${def.unidad}` }
  if (n.id != null && n.nomina_id != null) return { data: null, error: "La novedad ya fue aplicada en una nómina; anula la nómina para editarla." }
  const payload = {
    empleado_id: n.empleado_id,
    tipo: n.tipo,
    fecha: n.fecha,
    cantidad: def.unidad === "monto" ? null : r2(num(n.cantidad)),
    monto: def.unidad === "monto" ? r2(num(n.monto)) : null,
    gravable: !!n.gravable,
    cotizable: !!n.cotizable,
    descripcion: blank(n.descripcion ?? null),
  }
  const q = n.id != null
    ? c.supabase.from("rrhh_novedades").update(payload).eq("id", n.id).is("nomina_id", null).select("*, empleados(nombre)").single()
    : c.supabase.from("rrhh_novedades").insert({ ...payload, razon_social_id: c.stamp.razon_social_id, usuario: c.stamp.usuario }).select("*, empleados(nombre)").single()
  const { data, error } = await q
  if (error) return { data: null, error: isMissingTable(error) ? RRHH_FEATURE_PENDING : error.message }
  return { data: mapNovedad(data as Record<string, unknown>), error: null }
}

export async function deleteNovedad(id: number): Promise<{ success: boolean; error: string | null }> {
  const supabase = createClient()
  if (!supabase) return { success: false, error: "Cliente no disponible" }
  const { data, error } = await supabase.from("rrhh_novedades").delete().eq("id", id).is("nomina_id", null).select("id")
  if (error) return { success: false, error: error.message }
  if (!data || data.length === 0) return { success: false, error: "La novedad ya fue aplicada en una nómina" }
  return { success: true, error: null }
}

/** Inserta varias novedades de una vez (p. ej. aguinaldos generados). */
export async function crearNovedadesLote(novedades: Omit<Novedad, "id" | "empleado_nombre" | "nomina_id" | "created_at">[]): Promise<{ creadas: number; error: string | null }> {
  const c = await ctx()
  if (c.supabase == null) return { creadas: 0, error: c.error }
  if (novedades.length === 0) return { creadas: 0, error: null }
  const filas = novedades.map((n) => {
    const def = defNovedad(n.tipo)
    return {
      razon_social_id: c.stamp.razon_social_id,
      usuario: c.stamp.usuario,
      empleado_id: n.empleado_id,
      tipo: n.tipo,
      fecha: n.fecha,
      cantidad: def.unidad === "monto" ? null : r2(num(n.cantidad)),
      monto: def.unidad === "monto" ? r2(num(n.monto)) : null,
      gravable: !!n.gravable,
      cotizable: !!n.cotizable,
      descripcion: blank(n.descripcion ?? null),
    }
  })
  const { error } = await c.supabase.from("rrhh_novedades").insert(filas)
  if (error) return { creadas: 0, error: isMissingTable(error) ? RRHH_FEATURE_PENDING : error.message }
  return { creadas: filas.length, error: null }
}

// ==================== PARÁMETROS (versionados) ====================

function mapVersion(r: Record<string, unknown>): VersionParametros {
  return { id: Number(r.id), vigente_desde: String(r.vigente_desde ?? ""), nombre: (r.nombre as string | null) ?? null, parametros: (r.parametros as Record<string, unknown>) || {}, created_at: String(r.created_at ?? "") }
}

export async function getHistorialParametros(): Promise<{ data: VersionParametros[]; error: string | null; pendiente?: boolean }> {
  if (!isSupabaseConfigured()) return { data: [], error: null }
  const supabase = createClient()
  if (!supabase) return { data: [], error: "Cliente no disponible" }
  const { data, error } = await supabase.from("rrhh_parametros").select("*").order("vigente_desde", { ascending: false })
  if (error) {
    if (isMissingTable(error)) return { data: [], error: RRHH_FEATURE_PENDING, pendiente: true }
    return { data: [], error: error.message }
  }
  return { data: (data as Record<string, unknown>[]).map(mapVersion), error: null }
}

/** Versión vigente a una fecha (la última con vigente_desde <= fecha) o null si la empresa no ha guardado ninguna. */
export async function getParametrosVigentes(fechaISO: string): Promise<{ data: VersionParametros | null; error: string | null }> {
  if (!isSupabaseConfigured()) return { data: null, error: null }
  const supabase = createClient()
  if (!supabase) return { data: null, error: "Cliente no disponible" }
  const { data, error } = await supabase.from("rrhh_parametros").select("*").lte("vigente_desde", fechaISO).order("vigente_desde", { ascending: false }).limit(1).maybeSingle()
  if (error) return { data: null, error: isMissingTable(error) ? RRHH_FEATURE_PENDING : error.message }
  return { data: data ? mapVersion(data as Record<string, unknown>) : null, error: null }
}

export async function saveParametros(input: { vigente_desde: string; nombre?: string | null; parametros: Record<string, unknown> }): Promise<{ data: VersionParametros | null; error: string | null }> {
  const c = await ctx()
  if (c.supabase == null) return { data: null, error: c.error }
  if (!input.vigente_desde) return { data: null, error: "Indica desde cuándo rige" }
  const { data, error } = await c.supabase
    .from("rrhh_parametros")
    .upsert({ razon_social_id: c.stamp.razon_social_id, usuario: c.stamp.usuario, vigente_desde: input.vigente_desde, nombre: blank(input.nombre ?? null), parametros: input.parametros }, { onConflict: "razon_social_id,vigente_desde" })
    .select("*")
    .single()
  if (error) return { data: null, error: isMissingTable(error) ? RRHH_FEATURE_PENDING : error.message }
  return { data: mapVersion(data as Record<string, unknown>), error: null }
}

export async function deleteParametros(id: number): Promise<{ success: boolean; error: string | null }> {
  const supabase = createClient()
  if (!supabase) return { success: false, error: "Cliente no disponible" }
  const { error } = await supabase.from("rrhh_parametros").delete().eq("id", id)
  return { success: !error, error: error?.message ?? null }
}
