import * as XLSX from "xlsx"
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client"
import { getTenantStamp, isValidStamp, SESION_INVALIDA_ERROR } from "@/lib/services/tenant-stamp"
import { registrarAuditoria } from "@/lib/services/auditoria"
import { registrarMovimientoCuenta, type CuentaMovimiento } from "@/lib/services/cuentas"
import { createGasto } from "@/lib/services/gastos"
import { getHondurasNowISO } from "@/lib/utils/honduras-time"
import { adjuntarRelacion } from "@/lib/services/relaciones"

/**
 * Conciliación bancaria (script officemart-014).
 *   1. Importar el extracto (Excel del banco) con un mapeo de columnas que se
 *      guarda por cuenta (`bancos_formatos_extracto`).
 *   2. Parear líneas del banco con movimientos del libro (`cuenta_movimientos`)
 *      automáticamente (monto + fecha ±2 días + referencia) o a mano; crear el
 *      movimiento/gasto que falta (comisiones, cargos) o ignorar la línea.
 *   3. Cerrar: todas las líneas resueltas; el libro queda conciliado hasta
 *      `periodo_hasta` (registrarMovimientoCuenta rechaza fechas anteriores).
 * Parsers y pareo son puros (tests/conciliacion-bancaria.test.ts).
 * `consolidacion-bancaria.ts` (consolidado de saldos) no cambia.
 */

export const CONCILIACION_FEATURE_PENDING =
  "Conciliación bancaria pendiente: aplica scripts/officemart-014-conciliacion.sql en Supabase."

export type CampoExtracto = "fecha" | "descripcion" | "referencia" | "debito" | "credito" | "monto" | "saldo"
export type MapeoExtracto = Partial<Record<CampoExtracto, string>>

export interface FormatoExtracto {
  cuenta_id: number
  hoja: string | null
  fila_encabezado: number
  mapeo: MapeoExtracto
  formato_fecha: string | null
  invertir_signo: boolean
}

export interface LineaNormalizada {
  fila: number
  fecha: string // YYYY-MM-DD
  descripcion: string
  referencia: string | null
  /** + entra (crédito) / − sale (débito). */
  monto: number
  saldo_banco: number | null
}

export type EstadoLinea = "Pendiente" | "Conciliada" | "Ignorada"

export interface LineaExtracto extends LineaNormalizada {
  id: number
  extracto_id: number
  movimiento_id: number | null
  estado: EstadoLinea
  metodo_pareo: "auto" | "manual" | "creado" | null
  nota: string | null
}

export interface Extracto {
  id: number
  cuenta_id: number
  cuenta_nombre?: string
  periodo_desde: string
  periodo_hasta: string
  archivo_nombre: string | null
  saldo_inicial_banco: number | null
  saldo_final_banco: number | null
  estado: "Abierto" | "Conciliado"
  conciliado_at: string | null
  conciliado_por: string | null
  resumen: ResumenConciliacion | null
  created_at: string
}

export interface MovimientoLibro {
  id: number
  fecha: string
  tipo: "Ingreso" | "Egreso"
  monto: number
  concepto: string | null
  referencia: string | null
  ref_tipo: string | null
  conciliado_at: string | null
}

function r2(n: number): number {
  return +(Number(n) || 0).toFixed(2)
}

function isMissingTable(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false
  const msg = (err.message || "").toLowerCase()
  return err.code === "42P01" || err.code === "PGRST205" || msg.includes("schema cache") || /relation .* does not exist/.test(msg)
}

// ==================== PARSERS (PUROS) ====================

export function normalizarEncabezado(s: unknown): string {
  return String(s ?? "").trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[\s_.]+/g, " ").trim()
}

/** Alias habituales en extractos de bancos hondureños (BAC, Ficohsa, Atlántida, Banpaís, Occidente, Davivienda). */
const ALIAS: Record<CampoExtracto, string[]> = {
  fecha: ["fecha", "fecha transaccion", "fecha de transaccion", "fecha movimiento", "fecha valor", "date", "fec"],
  descripcion: ["descripcion", "concepto", "detalle", "transaccion", "description", "descripcion del movimiento", "movimiento"],
  referencia: ["referencia", "no referencia", "numero de referencia", "documento", "no documento", "num documento", "reference", "no transaccion", "autorizacion"],
  debito: ["debito", "debitos", "cargo", "cargos", "retiro", "retiros", "debit", "salida", "salidas"],
  credito: ["credito", "creditos", "abono", "abonos", "deposito", "depositos", "credit", "entrada", "entradas"],
  monto: ["monto", "importe", "valor", "amount", "cantidad"],
  saldo: ["saldo", "balance", "saldo disponible", "saldo actual"],
}

/** Detecta el mapeo columna → campo a partir de los encabezados (pura). */
export function detectarColumnas(headers: string[]): MapeoExtracto {
  const out: MapeoExtracto = {}
  const norm = headers.map((h) => ({ raw: h, n: normalizarEncabezado(h) }))
  for (const campo of Object.keys(ALIAS) as CampoExtracto[]) {
    // Coincidencia exacta primero, luego "empieza por" / "contiene".
    let hit = norm.find((h) => ALIAS[campo].includes(h.n))
    if (!hit) hit = norm.find((h) => ALIAS[campo].some((a) => h.n.startsWith(a) || h.n.includes(` ${a}`) || h.n.includes(`${a} `)))
    if (hit && !Object.values(out).includes(hit.raw)) out[campo] = hit.raw
  }
  return out
}

/** Excel serial → YYYY-MM-DD (fechas base 1899-12-30). */
function serialAFecha(n: number): string {
  const ms = Math.round((n - 25569) * 86_400_000)
  const d = new Date(ms)
  return d.toISOString().slice(0, 10)
}

/**
 * Convierte el valor de fecha del extracto a YYYY-MM-DD: serial de Excel,
 * Date, 'DD/MM/YYYY', 'DD-MM-YYYY', 'YYYY-MM-DD', 'DD/MM/YY'. `formato` fuerza
 * el orden día/mes cuando es ambiguo ('MM/DD/YYYY'). null si no se entiende.
 */
export function parsearFechaExtracto(v: unknown, formato?: string | null): string | null {
  if (v == null || v === "") return null
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10)
  if (typeof v === "number") return v > 20000 && v < 80000 ? serialAFecha(v) : null
  const s = String(v).trim()
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`
  m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/)
  if (m) {
    let a = Number(m[1])
    let b = Number(m[2])
    let y = Number(m[3])
    if (y < 100) y += 2000
    const mmdd = formato === "MM/DD/YYYY" || (formato == null && a <= 12 && b > 12)
    if (mmdd) [a, b] = [b, a]
    if (a < 1 || a > 31 || b < 1 || b > 12) return null
    return `${y}-${String(b).padStart(2, "0")}-${String(a).padStart(2, "0")}`
  }
  if (/^\d+(\.\d+)?$/.test(s)) {
    const n = Number(s)
    return n > 20000 && n < 80000 ? serialAFecha(n) : null
  }
  return null
}

/** '1,234.56' → 1234.56 · '(123.45)' → −123.45 · 'L 1,234.56' · '-1.234,56' (europeo). null si vacío. */
export function parsearMontoExtracto(v: unknown): number | null {
  if (v == null || v === "") return null
  if (typeof v === "number") return Number.isFinite(v) ? v : null
  let s = String(v).trim()
  if (!s) return null
  let neg = false
  if (/^\(.*\)$/.test(s)) {
    neg = true
    s = s.slice(1, -1)
  }
  if (/^-/.test(s)) {
    neg = true
    s = s.slice(1)
  }
  s = s.replace(/[^\d.,]/g, "")
  if (!s) return null
  // Formato europeo: última coma es decimal ("1.234,56").
  if (/,\d{1,2}$/.test(s) && !/\.\d{1,2}$/.test(s)) s = s.replace(/\./g, "").replace(",", ".")
  else s = s.replace(/,/g, "")
  const n = Number(s)
  if (!Number.isFinite(n)) return null
  return neg ? -n : n
}

/**
 * Convierte las filas crudas del Excel en líneas normalizadas según el mapeo.
 * Con columnas débito/crédito separadas: monto = crédito − débito; con una sola
 * columna 'monto', su signo manda (`invertirSigno` lo voltea). Omite filas sin
 * fecha o sin monto. Pura.
 */
export function normalizarLineas(
  rows: Record<string, unknown>[],
  mapeo: MapeoExtracto,
  opts: { invertirSigno?: boolean; formatoFecha?: string | null } = {}
): { lineas: LineaNormalizada[]; omitidas: number } {
  const lineas: LineaNormalizada[] = []
  let omitidas = 0
  rows.forEach((row, i) => {
    const fecha = mapeo.fecha ? parsearFechaExtracto(row[mapeo.fecha], opts.formatoFecha) : null
    let monto: number | null = null
    if (mapeo.debito || mapeo.credito) {
      const deb = mapeo.debito ? parsearMontoExtracto(row[mapeo.debito]) : null
      const cre = mapeo.credito ? parsearMontoExtracto(row[mapeo.credito]) : null
      if (deb != null || cre != null) monto = r2((cre ?? 0) - Math.abs(deb ?? 0))
      // Débito capturado en positivo o en negativo: siempre resta.
      if (deb != null && cre == null) monto = -Math.abs(deb)
    } else if (mapeo.monto) {
      monto = parsearMontoExtracto(row[mapeo.monto])
    }
    if (!fecha || monto == null || monto === 0) {
      omitidas += 1
      return
    }
    if (opts.invertirSigno) monto = -monto
    const saldo = mapeo.saldo ? parsearMontoExtracto(row[mapeo.saldo]) : null
    lineas.push({
      fila: i + 1,
      fecha,
      descripcion: String(mapeo.descripcion ? row[mapeo.descripcion] ?? "" : "").trim(),
      referencia: mapeo.referencia ? String(row[mapeo.referencia] ?? "").trim() || null : null,
      monto: r2(monto),
      saldo_banco: saldo != null ? r2(saldo) : null,
    })
  })
  return { lineas, omitidas }
}

/** Índices de líneas repetidas exactas (fecha + monto + referencia + descripción). Pura. */
export function detectarDuplicadas(lineas: LineaNormalizada[]): number[] {
  const vistas = new Set<string>()
  const dup: number[] = []
  lineas.forEach((l, i) => {
    const k = `${l.fecha}|${l.monto}|${l.referencia || ""}|${l.descripcion.toLowerCase()}`
    if (vistas.has(k)) dup.push(i)
    else vistas.add(k)
  })
  return dup
}

// ==================== PAREO (PURO) ====================

function diasEntre(a: string, b: string): number {
  const x = new Date(`${a.slice(0, 10)}T00:00:00Z`).getTime()
  const y = new Date(`${b.slice(0, 10)}T00:00:00Z`).getTime()
  return Math.abs(Math.round((x - y) / 86_400_000))
}

function refEn(ref: string | null, texto: string | null | undefined): boolean {
  const r = (ref || "").replace(/^0+/, "").trim().toLowerCase()
  if (r.length < 3) return false
  return (texto || "").toLowerCase().includes(r)
}

export interface Par {
  linea_id: number
  movimiento_id: number
  puntaje: number
}

/**
 * Empareja líneas del banco con movimientos del libro: mismo monto con signo
 * (línea + ↔ Ingreso, línea − ↔ Egreso), fecha a ≤ `toleranciaDias`
 * (puntúa más cuanto más cerca) y referencia coincidente (+3). Asignación 1:1
 * greedy por mejor puntaje; empates exactos van a `ambiguas`. Pura.
 */
export function emparejarMovimientos(
  lineas: Pick<LineaExtracto, "id" | "fecha" | "monto" | "referencia" | "descripcion">[],
  movimientos: MovimientoLibro[],
  opts: { toleranciaDias?: number } = {}
): { pares: Par[]; ambiguas: number[] } {
  const tol = opts.toleranciaDias ?? 2
  type Cand = { linea_id: number; movimiento_id: number; puntaje: number }
  const cands: Cand[] = []
  for (const l of lineas) {
    for (const m of movimientos) {
      if (m.conciliado_at) continue
      const signoOk = (l.monto > 0 && m.tipo === "Ingreso") || (l.monto < 0 && m.tipo === "Egreso")
      if (!signoOk) continue
      if (Math.abs(Math.abs(l.monto) - Math.abs(m.monto)) > 0.005) continue
      const d = diasEntre(l.fecha, m.fecha)
      if (d > tol) continue
      let p = 10 - d * 2
      if (l.referencia && (refEn(l.referencia, m.referencia) || refEn(l.referencia, m.concepto))) p += 3
      if (m.referencia && refEn(m.referencia, l.descripcion)) p += 3
      cands.push({ linea_id: l.id, movimiento_id: m.id, puntaje: p })
    }
  }
  cands.sort((a, b) => b.puntaje - a.puntaje || a.linea_id - b.linea_id || a.movimiento_id - b.movimiento_id)
  const usadasL = new Set<number>()
  const usadosM = new Set<number>()
  const pares: Par[] = []
  const ambiguas = new Set<number>()
  for (let i = 0; i < cands.length; i++) {
    const c = cands[i]
    if (usadasL.has(c.linea_id) || usadosM.has(c.movimiento_id)) continue
    // ¿Otra línea distinta compite por el mismo movimiento con el mismo puntaje?
    const empate = cands.some((o) => o !== c && o.movimiento_id === c.movimiento_id && o.puntaje === c.puntaje && !usadasL.has(o.linea_id) && o.linea_id !== c.linea_id)
    const empateLinea = cands.some((o) => o !== c && o.linea_id === c.linea_id && o.puntaje === c.puntaje && !usadosM.has(o.movimiento_id) && o.movimiento_id !== c.movimiento_id)
    if (empate || empateLinea) {
      ambiguas.add(c.linea_id)
      continue
    }
    pares.push(c)
    usadasL.add(c.linea_id)
    usadosM.add(c.movimiento_id)
  }
  return { pares, ambiguas: [...ambiguas].filter((id) => !usadasL.has(id)) }
}

export interface ResumenConciliacion {
  lineas: number
  conciliadas: number
  ignoradas: number
  pendientes: number
  montoBancoEntradas: number
  montoBancoSalidas: number
  /** Movimientos del libro del período sin parear (en tránsito). */
  enTransito: number
  enTransitoMonto: number
  saldoLibro: number
  saldoBanco: number | null
  /** saldoBanco − (saldoLibro − enTránsito neto); null si no hay saldo del banco. */
  diferencia: number | null
}

/** Saldo del libro = Σ ingresos − Σ egresos (pura). */
export function calcularSaldoLibro(movs: Pick<MovimientoLibro, "tipo" | "monto">[]): number {
  return r2(movs.reduce((a, m) => a + (m.tipo === "Ingreso" ? Number(m.monto) : -Number(m.monto)), 0))
}

/** Resumen de una conciliación (pura). */
export function resumenConciliacion(
  lineas: Pick<LineaExtracto, "estado" | "monto">[],
  movimientosPeriodo: MovimientoLibro[],
  saldoBanco: number | null,
  saldoLibroAlCierre: number
): ResumenConciliacion {
  const conciliadas = lineas.filter((l) => l.estado === "Conciliada").length
  const ignoradas = lineas.filter((l) => l.estado === "Ignorada").length
  const transito = movimientosPeriodo.filter((m) => !m.conciliado_at)
  const transitoNeto = calcularSaldoLibro(transito)
  const diferencia = saldoBanco == null ? null : r2(saldoBanco - (saldoLibroAlCierre - transitoNeto))
  return {
    lineas: lineas.length,
    conciliadas,
    ignoradas,
    pendientes: lineas.length - conciliadas - ignoradas,
    montoBancoEntradas: r2(lineas.filter((l) => l.monto > 0).reduce((a, l) => a + l.monto, 0)),
    montoBancoSalidas: r2(lineas.filter((l) => l.monto < 0).reduce((a, l) => a - l.monto, 0)),
    enTransito: transito.length,
    enTransitoMonto: transitoNeto,
    saldoLibro: r2(saldoLibroAlCierre),
    saldoBanco,
    diferencia,
  }
}

// ==================== ARCHIVO ====================

export interface ArchivoExtracto {
  hojas: string[]
  hoja: string
  headers: string[]
  rows: Record<string, unknown>[]
}

/** Lee el Excel del banco: hoja y fila de encabezado (1 = primera). */
export async function parsearExtractoXlsx(file: File, opts: { hoja?: string | null; filaEncabezado?: number } = {}): Promise<ArchivoExtracto> {
  const buffer = await file.arrayBuffer()
  const wb = XLSX.read(buffer, { type: "array", cellDates: false })
  const hoja = opts.hoja && wb.SheetNames.includes(opts.hoja) ? opts.hoja : wb.SheetNames[0]
  const ws = wb.Sheets[hoja]
  const fila = Math.max(1, opts.filaEncabezado ?? 1)
  const matriz = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "", raw: true }) as unknown[][]
  const headersRaw = (matriz[fila - 1] || []).map((h, i) => (String(h ?? "").trim() || `Columna ${i + 1}`))
  // Encabezados únicos (los bancos repiten "Saldo", etc.).
  const headers: string[] = []
  const vistos = new Map<string, number>()
  for (const h of headersRaw) {
    const n = (vistos.get(h) || 0) + 1
    vistos.set(h, n)
    headers.push(n > 1 ? `${h} (${n})` : h)
  }
  const rows: Record<string, unknown>[] = []
  for (let r = fila; r < matriz.length; r++) {
    const arr = matriz[r] || []
    if (arr.every((c) => c === "" || c == null)) continue
    const obj: Record<string, unknown> = {}
    headers.forEach((h, i) => { obj[h] = arr[i] ?? "" })
    rows.push(obj)
  }
  return { hojas: wb.SheetNames, hoja, headers, rows }
}

// ==================== FORMATO POR CUENTA ====================

export async function getFormatoCuenta(cuentaId: number): Promise<{ data: FormatoExtracto | null; error: string | null; pendiente: boolean }> {
  if (!isSupabaseConfigured()) return { data: null, error: null, pendiente: false }
  const supabase = createClient()
  if (!supabase) return { data: null, error: "Cliente no disponible", pendiente: false }
  const { data, error } = await supabase.from("bancos_formatos_extracto").select("*").eq("cuenta_id", cuentaId).maybeSingle()
  if (error) {
    if (isMissingTable(error)) return { data: null, error: null, pendiente: true }
    return { data: null, error: error.message, pendiente: false }
  }
  if (!data) return { data: null, error: null, pendiente: false }
  return {
    data: { cuenta_id: cuentaId, hoja: (data.hoja as string) ?? null, fila_encabezado: Number(data.fila_encabezado ?? 1), mapeo: (data.mapeo as MapeoExtracto) ?? {}, formato_fecha: (data.formato_fecha as string) ?? null, invertir_signo: !!data.invertir_signo },
    error: null,
    pendiente: false,
  }
}

export async function saveFormatoCuenta(f: FormatoExtracto): Promise<{ error: string | null }> {
  const supabase = createClient()
  if (!supabase) return { error: "Cliente no disponible" }
  const stamp = await getTenantStamp(supabase)
  if (!isValidStamp(stamp)) return { error: SESION_INVALIDA_ERROR }
  const fila = { hoja: f.hoja, fila_encabezado: f.fila_encabezado, mapeo: f.mapeo, formato_fecha: f.formato_fecha, invertir_signo: f.invertir_signo, updated_at: new Date().toISOString() }
  const { data: ex } = await supabase.from("bancos_formatos_extracto").select("id").eq("cuenta_id", f.cuenta_id).maybeSingle()
  const res = ex
    ? await supabase.from("bancos_formatos_extracto").update(fila).eq("id", ex.id)
    : await supabase.from("bancos_formatos_extracto").insert({ cuenta_id: f.cuenta_id, ...fila, ...stamp })
  if (res.error) return { error: isMissingTable(res.error) ? CONCILIACION_FEATURE_PENDING : res.error.message }
  return { error: null }
}

// ==================== EXTRACTOS ====================

function normExtracto(r: Record<string, unknown>): Extracto {
  const c = Array.isArray(r.cuentas_config) ? r.cuentas_config[0] : r.cuentas_config
  return {
    id: Number(r.id),
    cuenta_id: Number(r.cuenta_id),
    cuenta_nombre: (c as { nombre?: string } | null)?.nombre,
    periodo_desde: String(r.periodo_desde ?? ""),
    periodo_hasta: String(r.periodo_hasta ?? ""),
    archivo_nombre: (r.archivo_nombre as string) ?? null,
    saldo_inicial_banco: r.saldo_inicial_banco != null ? Number(r.saldo_inicial_banco) : null,
    saldo_final_banco: r.saldo_final_banco != null ? Number(r.saldo_final_banco) : null,
    estado: (r.estado as "Abierto" | "Conciliado") ?? "Abierto",
    conciliado_at: (r.conciliado_at as string) ?? null,
    conciliado_por: (r.conciliado_por as string) ?? null,
    resumen: (r.resumen as ResumenConciliacion) ?? null,
    created_at: String(r.created_at ?? ""),
  }
}

function normLinea(r: Record<string, unknown>): LineaExtracto {
  return {
    id: Number(r.id),
    extracto_id: Number(r.extracto_id),
    fila: Number(r.fila ?? 0),
    fecha: String(r.fecha ?? "").slice(0, 10),
    descripcion: String(r.descripcion ?? ""),
    referencia: (r.referencia as string) ?? null,
    monto: Number(r.monto ?? 0),
    saldo_banco: r.saldo_banco != null ? Number(r.saldo_banco) : null,
    movimiento_id: r.movimiento_id != null ? Number(r.movimiento_id) : null,
    estado: (r.estado as EstadoLinea) ?? "Pendiente",
    metodo_pareo: (r.metodo_pareo as LineaExtracto["metodo_pareo"]) ?? null,
    nota: (r.nota as string) ?? null,
  }
}

export async function getExtractos(cuentaId?: number | null): Promise<{ data: Extracto[]; error: string | null; pendiente: boolean }> {
  if (!isSupabaseConfigured()) return { data: [], error: null, pendiente: false }
  const supabase = createClient()
  if (!supabase) return { data: [], error: "Cliente no disponible", pendiente: false }
  let q = supabase.from("bancos_extractos").select("*").order("periodo_hasta", { ascending: false }).limit(200)
  if (cuentaId != null) q = q.eq("cuenta_id", cuentaId)
  const res = await q
  if (res.error) {
    if (isMissingTable(res.error)) return { data: [], error: null, pendiente: true }
    return { data: [], error: res.error.message, pendiente: false }
  }
  const conCuenta = await adjuntarRelacion(supabase, (res.data || []) as Record<string, unknown>[], { campo: "cuenta_id", tabla: "cuentas_config", columnas: "nombre", como: "cuentas_config" })
  return { data: conCuenta.map((r) => normExtracto(r)), error: null, pendiente: false }
}

export async function getExtracto(id: number): Promise<{ data: { extracto: Extracto; lineas: LineaExtracto[] } | null; error: string | null }> {
  if (!isSupabaseConfigured()) return { data: null, error: null }
  const supabase = createClient()
  if (!supabase) return { data: null, error: "Cliente no disponible" }
  const [e, l] = await Promise.all([
    supabase.from("bancos_extractos").select("*").eq("id", id).maybeSingle(),
    supabase.from("bancos_extracto_lineas").select("*").eq("extracto_id", id).order("fecha", { ascending: true }).order("fila", { ascending: true }),
  ])
  if (e.error) return { data: null, error: isMissingTable(e.error) ? CONCILIACION_FEATURE_PENDING : e.error.message }
  if (!e.data) return { data: null, error: "El extracto no existe" }
  return { data: { extracto: normExtracto(e.data as Record<string, unknown>), lineas: (l.data || []).map((r) => normLinea(r as Record<string, unknown>)) }, error: null }
}

/** Movimientos del libro de la cuenta en el período (± tolerancia), con su estado de conciliación. */
export async function getMovimientosLibro(cuentaId: number, desde: string, hasta: string, toleranciaDias = 2): Promise<{ data: MovimientoLibro[]; error: string | null }> {
  if (!isSupabaseConfigured()) return { data: [], error: null }
  const supabase = createClient()
  if (!supabase) return { data: [], error: "Cliente no disponible" }
  const d = new Date(`${desde}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - toleranciaDias)
  const h = new Date(`${hasta}T00:00:00Z`)
  h.setUTCDate(h.getUTCDate() + toleranciaDias)
  const { data, error } = await supabase
    .from("cuenta_movimientos")
    .select("id, fecha, tipo, monto, concepto, referencia, ref_tipo, conciliado_at")
    .eq("cuenta_id", cuentaId)
    .gte("fecha", `${d.toISOString().slice(0, 10)}T00:00:00`)
    .lte("fecha", `${h.toISOString().slice(0, 10)}T23:59:59`)
    .order("fecha", { ascending: true })
    .order("id", { ascending: true })
    .limit(5000)
  if (error) return { data: [], error: error.message }
  return {
    data: (data || []).map((m: Record<string, unknown>) => ({
      id: Number(m.id),
      fecha: String(m.fecha ?? ""),
      tipo: (m.tipo as "Ingreso" | "Egreso") ?? "Ingreso",
      monto: Number(m.monto ?? 0),
      concepto: (m.concepto as string) ?? null,
      referencia: (m.referencia as string) ?? null,
      ref_tipo: (m.ref_tipo as string) ?? null,
      conciliado_at: (m.conciliado_at as string) ?? null,
    })),
    error: null,
  }
}

export async function crearExtracto(input: {
  cuenta_id: number
  periodo_desde: string
  periodo_hasta: string
  archivo_nombre?: string | null
  saldo_inicial_banco?: number | null
  saldo_final_banco?: number | null
  lineas: LineaNormalizada[]
}): Promise<{ data: { id: number; lineas: number } | null; error: string | null }> {
  const supabase = createClient()
  if (!supabase) return { data: null, error: "Cliente no disponible" }
  const stamp = await getTenantStamp(supabase)
  if (!isValidStamp(stamp)) return { data: null, error: SESION_INVALIDA_ERROR }
  if (input.lineas.length === 0) return { data: null, error: "El extracto no tiene líneas con fecha y monto." }
  if (input.periodo_desde > input.periodo_hasta) return { data: null, error: "El período está invertido." }

  // Un extracto abierto por cuenta; y no solapar períodos ya conciliados.
  const { data: previos, error: pErr } = await supabase.from("bancos_extractos").select("id, estado, periodo_hasta").eq("cuenta_id", input.cuenta_id)
  if (pErr) return { data: null, error: isMissingTable(pErr) ? CONCILIACION_FEATURE_PENDING : pErr.message }
  const abierto = (previos || []).find((p: { estado: string }) => p.estado === "Abierto")
  if (abierto) return { data: null, error: `La cuenta ya tiene el extracto #${abierto.id} abierto; ciérralo o elimínalo antes de importar otro.` }
  const ultimoCerrado = (previos || []).filter((p: { estado: string }) => p.estado === "Conciliado").map((p: { periodo_hasta: string }) => p.periodo_hasta).sort().pop()
  if (ultimoCerrado && input.periodo_desde <= ultimoCerrado) {
    return { data: null, error: `La cuenta ya está conciliada hasta el ${ultimoCerrado}; el nuevo período debe empezar después.` }
  }

  const { data: ext, error } = await supabase
    .from("bancos_extractos")
    .insert({ cuenta_id: input.cuenta_id, periodo_desde: input.periodo_desde, periodo_hasta: input.periodo_hasta, archivo_nombre: input.archivo_nombre ?? null, saldo_inicial_banco: input.saldo_inicial_banco ?? null, saldo_final_banco: input.saldo_final_banco ?? null, estado: "Abierto", ...stamp })
    .select("id")
    .single()
  if (error) return { data: null, error: isMissingTable(error) ? CONCILIACION_FEATURE_PENDING : error.message }
  const extId = Number(ext.id)
  for (let i = 0; i < input.lineas.length; i += 500) {
    const { error: lErr } = await supabase.from("bancos_extracto_lineas").insert(
      input.lineas.slice(i, i + 500).map((l) => ({ razon_social_id: stamp.razon_social_id, extracto_id: extId, fila: l.fila, fecha: l.fecha, descripcion: l.descripcion || null, referencia: l.referencia, monto: l.monto, saldo_banco: l.saldo_banco, estado: "Pendiente" }))
    )
    if (lErr) {
      await supabase.from("bancos_extractos").delete().eq("id", extId)
      return { data: null, error: lErr.message }
    }
  }
  await registrarAuditoria(supabase, stamp, { entidad: "extracto_bancario", entidad_id: extId, accion: "importar", despues: { cuenta_id: input.cuenta_id, lineas: input.lineas.length, periodo: [input.periodo_desde, input.periodo_hasta] } })
  return { data: { id: extId, lineas: input.lineas.length }, error: null }
}

export async function eliminarExtracto(id: number): Promise<{ error: string | null }> {
  const supabase = createClient()
  if (!supabase) return { error: "Cliente no disponible" }
  const { data: e } = await supabase.from("bancos_extractos").select("estado").eq("id", id).maybeSingle()
  if (!e) return { error: "El extracto no existe" }
  if (e.estado === "Conciliado") return { error: "Un extracto conciliado no se elimina; reábrelo primero." }
  // Libera los movimientos pareados.
  const { data: lineas } = await supabase.from("bancos_extracto_lineas").select("movimiento_id").eq("extracto_id", id).not("movimiento_id", "is", null)
  const movIds = (lineas || []).map((l: { movimiento_id: number }) => l.movimiento_id)
  if (movIds.length > 0) await supabase.from("cuenta_movimientos").update({ conciliado_at: null, extracto_linea_id: null }).in("id", movIds)
  const { error } = await supabase.from("bancos_extractos").delete().eq("id", id)
  return { error: error ? error.message : null }
}

// ==================== PAREO ====================

async function marcarPar(
  supabase: NonNullable<ReturnType<typeof createClient>>,
  lineaId: number,
  movimientoId: number,
  metodo: "auto" | "manual" | "creado"
): Promise<string | null> {
  const ahora = getHondurasNowISO()
  const { error } = await supabase.from("bancos_extracto_lineas").update({ movimiento_id: movimientoId, estado: "Conciliada", metodo_pareo: metodo, updated_at: ahora }).eq("id", lineaId)
  if (error) return error.message
  await supabase.from("cuenta_movimientos").update({ conciliado_at: ahora, extracto_linea_id: lineaId }).eq("id", movimientoId)
  return null
}

export async function parearAutomatico(extractoId: number): Promise<{ data: { pares: number; ambiguas: number } | null; error: string | null }> {
  const { data, error } = await getExtracto(extractoId)
  if (error || !data) return { data: null, error: error || "El extracto no existe" }
  if (data.extracto.estado !== "Abierto") return { data: null, error: "El extracto ya está conciliado." }
  const supabase = createClient()
  if (!supabase) return { data: null, error: "Cliente no disponible" }
  const pendientes = data.lineas.filter((l) => l.estado === "Pendiente")
  const { data: movs, error: mErr } = await getMovimientosLibro(data.extracto.cuenta_id, data.extracto.periodo_desde, data.extracto.periodo_hasta)
  if (mErr) return { data: null, error: mErr }
  const { pares, ambiguas } = emparejarMovimientos(pendientes, movs)
  for (const p of pares) {
    const err = await marcarPar(supabase, p.linea_id, p.movimiento_id, "auto")
    if (err) return { data: null, error: err }
  }
  return { data: { pares: pares.length, ambiguas: ambiguas.length }, error: null }
}

export async function parearManual(lineaId: number, movimientoId: number): Promise<{ error: string | null }> {
  const supabase = createClient()
  if (!supabase) return { error: "Cliente no disponible" }
  const { data: m } = await supabase.from("cuenta_movimientos").select("id, conciliado_at").eq("id", movimientoId).maybeSingle()
  if (!m) return { error: "El movimiento no existe" }
  if (m.conciliado_at) return { error: "Ese movimiento ya está conciliado con otra línea." }
  return { error: await marcarPar(supabase, lineaId, movimientoId, "manual") }
}

export async function desparear(lineaId: number): Promise<{ error: string | null }> {
  const supabase = createClient()
  if (!supabase) return { error: "Cliente no disponible" }
  const { data: l } = await supabase.from("bancos_extracto_lineas").select("movimiento_id, extracto_id").eq("id", lineaId).maybeSingle()
  if (!l) return { error: "La línea no existe" }
  const { data: e } = await supabase.from("bancos_extractos").select("estado").eq("id", l.extracto_id).maybeSingle()
  if (e?.estado !== "Abierto") return { error: "El extracto está conciliado; reábrelo para cambiar pareos." }
  if (l.movimiento_id) await supabase.from("cuenta_movimientos").update({ conciliado_at: null, extracto_linea_id: null }).eq("id", l.movimiento_id)
  const { error } = await supabase.from("bancos_extracto_lineas").update({ movimiento_id: null, estado: "Pendiente", metodo_pareo: null, updated_at: new Date().toISOString() }).eq("id", lineaId)
  return { error: error ? error.message : null }
}

export async function ignorarLinea(lineaId: number, nota: string): Promise<{ error: string | null }> {
  const supabase = createClient()
  if (!supabase) return { error: "Cliente no disponible" }
  const { error } = await supabase.from("bancos_extracto_lineas").update({ estado: "Ignorada", nota: (nota || "").trim() || null, movimiento_id: null, metodo_pareo: null, updated_at: new Date().toISOString() }).eq("id", lineaId)
  return { error: error ? error.message : null }
}

/**
 * Crea en el libro lo que el banco muestra y no existía: un movimiento simple
 * (con la fecha de la línea, `ref_tipo='conciliacion'`) o un GASTO pagado
 * desde la cuenta (comisiones, cargos), y lo deja pareado.
 */
export async function crearMovimientoDesdeLinea(
  lineaId: number,
  input: { modo: "movimiento" | "gasto"; concepto: string; concepto_gasto_id?: number | null }
): Promise<{ error: string | null }> {
  const supabase = createClient()
  if (!supabase) return { error: "Cliente no disponible" }
  const stamp = await getTenantStamp(supabase)
  if (!isValidStamp(stamp)) return { error: SESION_INVALIDA_ERROR }
  const { data: l } = await supabase.from("bancos_extracto_lineas").select("*").eq("id", lineaId).maybeSingle()
  if (!l) return { error: "La línea no existe" }
  if (l.estado !== "Pendiente") return { error: "La línea ya está resuelta." }
  const { data: e } = await supabase.from("bancos_extractos").select("cuenta_id, estado").eq("id", l.extracto_id).maybeSingle()
  if (!e || e.estado !== "Abierto") return { error: "El extracto no está abierto." }
  const monto = Math.abs(Number(l.monto))
  const concepto = (input.concepto || "").trim() || String(l.descripcion || "Movimiento bancario")
  let movimientoId: number | null = null

  if (input.modo === "gasto") {
    if (Number(l.monto) >= 0) return { error: "Un gasto solo aplica a una salida (monto negativo)." }
    if (!input.concepto_gasto_id) return { error: "Elige el concepto de gasto." }
    const { data: g, error: gErr } = await createGasto({
      concepto_id: input.concepto_gasto_id,
      fecha_gasto: String(l.fecha).slice(0, 10),
      monto,
      metodo_pago: "Transferencia",
      descripcion: `${concepto}${l.referencia ? ` · ref. ${l.referencia}` : ""} (conciliación)`,
      pagar_ahora: true,
      pago_metodo: "Banco",
      pago_cuenta_id: Number(e.cuenta_id),
    })
    if (gErr || !g?.id) return { error: gErr || "No se pudo crear el gasto" }
    const { data: mov } = await supabase.from("cuenta_movimientos").select("id").eq("ref_tipo", "gasto").eq("ref_id", g.id).order("id", { ascending: false }).limit(1).maybeSingle()
    movimientoId = mov?.id != null ? Number(mov.id) : null
    // Fecha del movimiento = fecha de la línea (el pago del gasto se registró "ahora").
    if (movimientoId != null) await supabase.from("cuenta_movimientos").update({ fecha: `${String(l.fecha).slice(0, 10)}T12:00:00`, referencia: l.referencia ?? null }).eq("id", movimientoId)
  } else {
    const { data: mov, error: mErr } = await registrarMovimientoCuenta({
      cuenta_id: Number(e.cuenta_id),
      tipo: Number(l.monto) > 0 ? "Ingreso" : "Egreso",
      monto,
      concepto,
      ref_tipo: "conciliacion",
      ref_id: lineaId,
      fecha: `${String(l.fecha).slice(0, 10)}T12:00:00`,
      referencia: l.referencia ?? null,
    })
    if (mErr || !mov?.id) return { error: mErr || "No se pudo crear el movimiento" }
    movimientoId = Number((mov as CuentaMovimiento).id)
  }
  if (movimientoId == null) return { error: "Se creó el registro pero no se encontró su movimiento bancario." }
  const err = await marcarPar(supabase, lineaId, movimientoId, "creado")
  if (err) return { error: err }
  await registrarAuditoria(supabase, stamp, { entidad: "extracto_linea", entidad_id: lineaId, accion: "crear_movimiento", despues: { modo: input.modo, movimiento_id: movimientoId, monto } })
  return { error: null }
}

// ==================== CIERRE ====================

export async function cerrarConciliacion(extractoId: number): Promise<{ data: ResumenConciliacion | null; error: string | null }> {
  const supabase = createClient()
  if (!supabase) return { data: null, error: "Cliente no disponible" }
  const stamp = await getTenantStamp(supabase)
  if (!isValidStamp(stamp)) return { data: null, error: SESION_INVALIDA_ERROR }
  const { data, error } = await getExtracto(extractoId)
  if (error || !data) return { data: null, error: error || "El extracto no existe" }
  if (data.extracto.estado !== "Abierto") return { data: null, error: "El extracto ya está conciliado." }
  const pendientes = data.lineas.filter((l) => l.estado === "Pendiente")
  if (pendientes.length > 0) return { data: null, error: `Quedan ${pendientes.length} línea(s) del banco sin resolver (parear, crear o ignorar).` }

  const { data: movs } = await getMovimientosLibro(data.extracto.cuenta_id, data.extracto.periodo_desde, data.extracto.periodo_hasta, 0)
  const { data: todos } = await supabase.from("cuenta_movimientos").select("tipo, monto").eq("cuenta_id", data.extracto.cuenta_id).lte("fecha", `${data.extracto.periodo_hasta}T23:59:59`)
  const saldoLibro = calcularSaldoLibro((todos || []) as { tipo: "Ingreso" | "Egreso"; monto: number }[])
  const resumen = resumenConciliacion(data.lineas, movs, data.extracto.saldo_final_banco, saldoLibro)

  const { error: uErr } = await supabase
    .from("bancos_extractos")
    .update({ estado: "Conciliado", conciliado_at: getHondurasNowISO(), conciliado_por: stamp.usuario, resumen })
    .eq("id", extractoId)
    .eq("estado", "Abierto")
  if (uErr) return { data: null, error: uErr.message }
  await registrarAuditoria(supabase, stamp, { entidad: "extracto_bancario", entidad_id: extractoId, accion: "conciliar", despues: resumen as unknown as Record<string, unknown> })
  return { data: resumen, error: null }
}

/** Solo admin (lo valida la página): vuelve el extracto a Abierto. Los pareos se conservan. */
export async function reabrirConciliacion(extractoId: number, motivo: string): Promise<{ error: string | null }> {
  const supabase = createClient()
  if (!supabase) return { error: "Cliente no disponible" }
  const stamp = await getTenantStamp(supabase)
  if (!isValidStamp(stamp)) return { error: SESION_INVALIDA_ERROR }
  const { data: posteriores } = await supabase.from("bancos_extractos").select("id").eq("estado", "Conciliado").gt("id", extractoId)
  const { data: e } = await supabase.from("bancos_extractos").select("cuenta_id, periodo_hasta").eq("id", extractoId).maybeSingle()
  if (!e) return { error: "El extracto no existe" }
  const { data: masNuevo } = await supabase.from("bancos_extractos").select("id").eq("cuenta_id", e.cuenta_id).eq("estado", "Conciliado").gt("periodo_hasta", e.periodo_hasta).limit(1)
  if (masNuevo && masNuevo.length > 0) return { error: "Hay conciliaciones posteriores de esta cuenta; reabre primero la más reciente." }
  void posteriores
  const { error } = await supabase.from("bancos_extractos").update({ estado: "Abierto", conciliado_at: null, conciliado_por: null }).eq("id", extractoId)
  if (error) return { error: error.message }
  await registrarAuditoria(supabase, stamp, { entidad: "extracto_bancario", entidad_id: extractoId, accion: "reabrir", motivo })
  return { error: null }
}
