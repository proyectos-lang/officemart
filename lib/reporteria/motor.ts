/**
 * Motor de Reportería (PURO, sin acceso a datos): resuelve el período,
 * filtra, agrupa (por cualquier columna o por día/semana/mes/trimestre/año),
 * calcula medidas, ordena y arma la fila de totales. Las fuentes de datos
 * viven en `fuentes.ts`; la exportación a Excel en `excel.ts`.
 *
 * Fechas en convención HN-as-UTC ("2026-09-28T14:00:00.000Z" = 14:00 en
 * Honduras) o "YYYY-MM-DD".
 */

export type TipoColumna = "texto" | "numero" | "moneda" | "porcentaje" | "fecha" | "fechahora" | "booleano"

export interface ColumnaDef {
  key: string
  label: string
  tipo: TipoColumna
  /** Seleccionada al elegir la fuente. */
  porDefecto?: boolean
  /** false = no se suma en la fila de totales (días, tasas, cantidades no aditivas). */
  sumable?: boolean
}

export type Agregacion = "suma" | "promedio" | "conteo" | "conteo_distinto" | "min" | "max"
export type NivelFecha = "dia" | "semana" | "mes" | "trimestre" | "anio"
export type OperadorFiltro = "contiene" | "no_contiene" | "igual" | "distinto" | "en" | "mayor" | "menor" | "entre" | "vacio" | "no_vacio"
export type PresetRango = "hoy" | "ayer" | "semana" | "semana_anterior" | "mes" | "mes_anterior" | "trimestre" | "anio" | "ultimos_7" | "ultimos_30" | "ultimos_90" | "personalizado" | "todo"

export interface FiltroReporte {
  col: string
  op: OperadorFiltro
  valor?: string
  valor2?: string
  valores?: string[]
}
export interface AgrupacionReporte {
  col: string
  /** Solo columnas de fecha. */
  nivel?: NivelFecha
}
export interface MedidaReporte {
  /** "*" = contar registros. */
  col: string
  fn: Agregacion
}
export interface ConfigReporte {
  fuente: string
  columnas: string[]
  rango: { preset: PresetRango; desde?: string | null; hasta?: string | null }
  filtros: FiltroReporte[]
  agrupar: AgrupacionReporte[]
  medidas: MedidaReporte[]
  orden?: { col: string; dir: "asc" | "desc" } | null
  totales: boolean
}

export interface ColumnaSalida {
  key: string
  label: string
  tipo: TipoColumna
}
export interface ResultadoReporte {
  columnas: ColumnaSalida[]
  filas: Record<string, unknown>[]
  total: Record<string, unknown> | null
  /** Registros de la fuente después de filtros (antes de agrupar). */
  registros: number
}

export const ETIQUETA_PRESET: Record<PresetRango, string> = {
  hoy: "Hoy", ayer: "Ayer", semana: "Esta semana", semana_anterior: "Semana anterior", mes: "Este mes", mes_anterior: "Mes anterior",
  trimestre: "Este trimestre", anio: "Este año", ultimos_7: "Últimos 7 días", ultimos_30: "Últimos 30 días", ultimos_90: "Últimos 90 días",
  personalizado: "Personalizado", todo: "Todo el historial",
}
export const ETIQUETA_AGREGACION: Record<Agregacion, string> = {
  suma: "Suma", promedio: "Promedio", conteo: "Conteo", conteo_distinto: "Conteo distinto", min: "Mínimo", max: "Máximo",
}
export const ETIQUETA_NIVEL: Record<NivelFecha, string> = { dia: "Día", semana: "Semana", mes: "Mes", trimestre: "Trimestre", anio: "Año" }
export const ETIQUETA_OPERADOR: Record<OperadorFiltro, string> = {
  contiene: "contiene", no_contiene: "no contiene", igual: "es igual a", distinto: "es distinto de", en: "es uno de",
  mayor: "mayor o igual que", menor: "menor o igual que", entre: "entre", vacio: "está vacío", no_vacio: "no está vacío",
}

export const esNumerica = (t: TipoColumna) => t === "numero" || t === "moneda" || t === "porcentaje"
export const esFecha = (t: TipoColumna) => t === "fecha" || t === "fechahora"

// ==================== PERÍODO ====================

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10)
}
function fechaUTC(iso: string): Date {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}
function sumarDias(iso: string, n: number): string {
  const d = fechaUTC(iso)
  d.setUTCDate(d.getUTCDate() + n)
  return ymd(d)
}
export function lunesDe(iso: string): string {
  const d = fechaUTC(iso)
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7))
  return ymd(d)
}

/** Período concreto {desde, hasta} (YYYY-MM-DD) o null = sin límite. Los relativos se recalculan cada vez. */
export function resolverRango(rango: ConfigReporte["rango"], hoyISO: string): { desde: string | null; hasta: string | null } {
  const hoy = hoyISO.slice(0, 10)
  const [y, m] = hoy.split("-").map(Number)
  const finMes = (yy: number, mm: number) => ymd(new Date(Date.UTC(yy, mm, 0)))
  switch (rango.preset) {
    case "hoy": return { desde: hoy, hasta: hoy }
    case "ayer": { const a = sumarDias(hoy, -1); return { desde: a, hasta: a } }
    case "semana": return { desde: lunesDe(hoy), hasta: hoy }
    case "semana_anterior": { const l = sumarDias(lunesDe(hoy), -7); return { desde: l, hasta: sumarDias(l, 6) } }
    case "mes": return { desde: `${hoy.slice(0, 7)}-01`, hasta: hoy }
    case "mes_anterior": { const py = m === 1 ? y - 1 : y; const pm = m === 1 ? 12 : m - 1; return { desde: `${py}-${String(pm).padStart(2, "0")}-01`, hasta: finMes(py, pm) } }
    case "trimestre": { const q = Math.floor((m - 1) / 3) * 3 + 1; return { desde: `${y}-${String(q).padStart(2, "0")}-01`, hasta: hoy } }
    case "anio": return { desde: `${y}-01-01`, hasta: hoy }
    case "ultimos_7": return { desde: sumarDias(hoy, -6), hasta: hoy }
    case "ultimos_30": return { desde: sumarDias(hoy, -29), hasta: hoy }
    case "ultimos_90": return { desde: sumarDias(hoy, -89), hasta: hoy }
    case "todo": return { desde: null, hasta: null }
    default: return { desde: rango.desde || null, hasta: rango.hasta || null }
  }
}

// ==================== FILTROS ====================

const norm = (v: unknown) => String(v ?? "").toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").trim()
const vacio = (v: unknown) => v == null || (typeof v === "string" && v.trim() === "")

export function textoValor(v: unknown, tipo: TipoColumna): string {
  if (vacio(v)) return ""
  if (tipo === "booleano") return v === true || v === "true" ? "Sí" : "No"
  if (tipo === "fecha") return String(v).slice(0, 10)
  if (tipo === "fechahora") return String(v).slice(0, 16).replace("T", " ")
  return String(v)
}

function cumple(fila: Record<string, unknown>, f: FiltroReporte, tipo: TipoColumna): boolean {
  const v = fila[f.col]
  if (f.op === "vacio") return vacio(v)
  if (f.op === "no_vacio") return !vacio(v)
  if (esNumerica(tipo)) {
    const n = Number(v)
    const a = Number(f.valor)
    const b = Number(f.valor2)
    if (vacio(v) || Number.isNaN(n)) return f.op === "distinto"
    switch (f.op) {
      case "igual": return n === a
      case "distinto": return n !== a
      case "mayor": return n >= a
      case "menor": return n <= a
      case "entre": return n >= a && n <= b
      case "en": return (f.valores || []).map(Number).includes(n)
      default: return norm(n).includes(norm(f.valor))
    }
  }
  if (esFecha(tipo)) {
    const d = vacio(v) ? "" : String(v).slice(0, 10)
    switch (f.op) {
      case "igual": return d === f.valor
      case "distinto": return d !== f.valor
      case "mayor": return d !== "" && d >= String(f.valor)
      case "menor": return d !== "" && d <= String(f.valor)
      case "entre": return d !== "" && d >= String(f.valor) && d <= String(f.valor2)
      default: return d.includes(String(f.valor || ""))
    }
  }
  const t = norm(textoValor(v, tipo))
  switch (f.op) {
    case "contiene": return t.includes(norm(f.valor))
    case "no_contiene": return !t.includes(norm(f.valor))
    case "igual": return t === norm(f.valor)
    case "distinto": return t !== norm(f.valor)
    case "en": return (f.valores || []).map(norm).includes(t)
    case "mayor": return t >= norm(f.valor)
    case "menor": return t <= norm(f.valor)
    case "entre": return t >= norm(f.valor) && t <= norm(f.valor2)
    default: return true
  }
}

export function aplicarFiltros(filas: Record<string, unknown>[], filtros: FiltroReporte[], columnas: ColumnaDef[]): Record<string, unknown>[] {
  const tipos = new Map(columnas.map((c) => [c.key, c.tipo]))
  const validos = filtros.filter((f) => tipos.has(f.col) && (f.op === "vacio" || f.op === "no_vacio" || (f.op === "en" ? (f.valores || []).length > 0 : !vacio(f.valor))))
  if (validos.length === 0) return filas
  return filas.filter((r) => validos.every((f) => cumple(r, f, tipos.get(f.col)!)))
}

/** Valores distintos de una columna (para el filtro "es uno de"). */
export function valoresDistintos(filas: Record<string, unknown>[], col: string, tipo: TipoColumna, max = 200): string[] {
  const set = new Set<string>()
  for (const r of filas) {
    const t = textoValor(r[col], tipo)
    if (t) set.add(t)
    if (set.size > max) break
  }
  return [...set].sort((a, b) => a.localeCompare(b, "es"))
}

// ==================== AGRUPACIÓN ====================

const MESES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"]

/** Clave de agrupación por fecha: ordenable y legible. */
export function claveFecha(v: unknown, nivel: NivelFecha): string {
  if (vacio(v)) return ""
  const d = String(v).slice(0, 10)
  if (nivel === "dia") return d
  if (nivel === "semana") return lunesDe(d)
  if (nivel === "mes") return d.slice(0, 7)
  if (nivel === "trimestre") return `${d.slice(0, 4)}-T${Math.floor((Number(d.slice(5, 7)) - 1) / 3) + 1}`
  return d.slice(0, 4)
}
export function etiquetaFecha(clave: string, nivel: NivelFecha): string {
  if (!clave) return "(sin fecha)"
  if (nivel === "mes") return `${MESES[Number(clave.slice(5, 7)) - 1]} ${clave.slice(0, 4)}`
  if (nivel === "trimestre") return `${clave.slice(5)} ${clave.slice(0, 4)}`
  return clave
}

function agregar(valores: unknown[], fn: Agregacion): number {
  if (fn === "conteo") return valores.length
  if (fn === "conteo_distinto") return new Set(valores.filter((v) => !vacio(v)).map((v) => String(v))).size
  const nums = valores.filter((v) => !vacio(v)).map(Number).filter((n) => !Number.isNaN(n))
  if (nums.length === 0) return 0
  if (fn === "suma") return r2(nums.reduce((a, b) => a + b, 0))
  if (fn === "promedio") return r2(nums.reduce((a, b) => a + b, 0) / nums.length)
  if (fn === "min") return Math.min(...nums)
  return Math.max(...nums)
}
const r2 = (n: number) => Math.round(n * 100) / 100

function tipoMedida(m: MedidaReporte, tipos: Map<string, TipoColumna>): TipoColumna {
  if (m.fn === "conteo" || m.fn === "conteo_distinto" || m.col === "*") return "numero"
  return tipos.get(m.col) ?? "numero"
}
export function claveMedida(m: MedidaReporte): string {
  return `${m.fn}__${m.col === "*" ? "registros" : m.col}`
}
export function etiquetaMedida(m: MedidaReporte, columnas: ColumnaDef[]): string {
  if (m.col === "*") return "Registros"
  const c = columnas.find((x) => x.key === m.col)
  return `${ETIQUETA_AGREGACION[m.fn]} de ${c?.label ?? m.col}`
}

// ==================== EJECUCIÓN ====================

function comparar(a: unknown, b: unknown, tipo: TipoColumna): number {
  if (vacio(a) && vacio(b)) return 0
  if (vacio(a)) return 1
  if (vacio(b)) return -1
  if (esNumerica(tipo)) return Number(a) - Number(b)
  return String(a).localeCompare(String(b), "es", { numeric: true })
}

/** Ejecuta el reporte sobre las filas ya cargadas (y ya acotadas al período por la fuente). */
export function ejecutarReporte(filasFuente: Record<string, unknown>[], columnas: ColumnaDef[], cfg: ConfigReporte): ResultadoReporte {
  const tipos = new Map(columnas.map((c) => [c.key, c.tipo]))
  const filtradas = aplicarFiltros(filasFuente, cfg.filtros, columnas)
  const grupos = cfg.agrupar.filter((g) => tipos.has(g.col))

  let salida: ColumnaSalida[]
  let filas: Record<string, unknown>[]

  if (grupos.length === 0) {
    const sel = cfg.columnas.filter((k) => tipos.has(k))
    salida = sel.map((k) => {
      const c = columnas.find((x) => x.key === k)!
      return { key: k, label: c.label, tipo: c.tipo }
    })
    filas = filtradas.map((r) => Object.fromEntries(sel.map((k) => [k, r[k] ?? null])))
  } else {
    const medidas = cfg.medidas.length ? cfg.medidas.filter((m) => m.col === "*" || tipos.has(m.col)) : [{ col: "*", fn: "conteo" as Agregacion }]
    salida = [
      ...grupos.map((g) => {
        const c = columnas.find((x) => x.key === g.col)!
        if (g.nivel && esFecha(c.tipo)) {
          const tipo: TipoColumna = g.nivel === "dia" || g.nivel === "semana" ? "fecha" : "texto"
          return { key: g.col, label: `${c.label} (${ETIQUETA_NIVEL[g.nivel].toLowerCase()})`, tipo }
        }
        return { key: g.col, label: c.label, tipo: c.tipo === "fechahora" ? "fecha" as TipoColumna : c.tipo }
      }),
      ...medidas.map((m) => ({ key: claveMedida(m), label: etiquetaMedida(m, columnas), tipo: tipoMedida(m, tipos) })),
    ]
    const mapa = new Map<string, { claves: unknown[]; filas: Record<string, unknown>[] }>()
    for (const r of filtradas) {
      const claves = grupos.map((g) => {
        const t = tipos.get(g.col)!
        if (g.nivel && esFecha(t)) return claveFecha(r[g.col], g.nivel)
        if (esFecha(t)) return vacio(r[g.col]) ? "" : String(r[g.col]).slice(0, 10)
        return vacio(r[g.col]) ? "" : t === "booleano" ? textoValor(r[g.col], t) : r[g.col]
      })
      const k = JSON.stringify(claves)
      const cur = mapa.get(k) || { claves, filas: [] }
      cur.filas.push(r)
      mapa.set(k, cur)
    }
    filas = [...mapa.values()].map(({ claves, filas: fs }) => {
      const out: Record<string, unknown> = {}
      grupos.forEach((g, i) => {
        const t = tipos.get(g.col)!
        const v = claves[i]
        out[g.col] = g.nivel && esFecha(t) && g.nivel !== "dia" && g.nivel !== "semana" ? etiquetaFecha(String(v), g.nivel) : v === "" ? null : v
        if (g.nivel && esFecha(t)) out[`__orden_${g.col}`] = v
      })
      for (const m of medidas) out[claveMedida(m)] = agregar(m.col === "*" ? fs.map(() => 1) : fs.map((x) => x[m.col]), m.col === "*" ? "conteo" : m.fn)
      return out
    })
    // Orden natural: por los grupos en su orden.
    filas.sort((a, b) => {
      for (const g of grupos) {
        const t = tipos.get(g.col)!
        const ka = g.nivel && esFecha(t) ? a[`__orden_${g.col}`] : a[g.col]
        const kb = g.nivel && esFecha(t) ? b[`__orden_${g.col}`] : b[g.col]
        const c = comparar(ka, kb, g.nivel ? "texto" : t)
        if (c !== 0) return c
      }
      return 0
    })
  }

  if (cfg.orden && salida.some((c) => c.key === cfg.orden!.col)) {
    const col = salida.find((c) => c.key === cfg.orden!.col)!
    const dir = cfg.orden.dir === "desc" ? -1 : 1
    const usaClave = grupos.some((g) => g.col === col.key && g.nivel)
    filas.sort((a, b) => {
      const va = usaClave ? a[`__orden_${col.key}`] : a[col.key]
      const vb = usaClave ? b[`__orden_${col.key}`] : b[col.key]
      // Los vacíos siempre al final, en cualquier dirección.
      if (vacio(va) || vacio(vb)) return vacio(va) && vacio(vb) ? 0 : vacio(va) ? 1 : -1
      return dir * comparar(va, vb, usaClave ? "texto" : col.tipo)
    })
  }
  filas = filas.map((f) => Object.fromEntries(Object.entries(f).filter(([k]) => !k.startsWith("__orden_"))))

  let total: Record<string, unknown> | null = null
  if (cfg.totales && filas.length > 0) {
    total = {}
    for (const c of salida) {
      if (!esNumerica(c.tipo)) continue
      const esMedida = grupos.length > 0 && c.key.includes("__")
      const fn = esMedida ? (c.key.split("__")[0] as Agregacion) : "suma"
      if (c.tipo === "porcentaje" && !esMedida) continue
      if (!esMedida && columnas.find((x) => x.key === c.key)?.sumable === false) continue
      if (esMedida && (fn === "suma" || fn === "conteo") && c.tipo === "porcentaje") continue
      // Promedios y extremos se recalculan sobre los registros, no sobre los grupos.
      if (esMedida && (fn === "promedio" || fn === "min" || fn === "max")) {
        const col = c.key.split("__")[1]
        total[c.key] = agregar(filtradas.map((x) => x[col]), fn)
      } else if (esMedida && fn === "conteo_distinto") {
        total[c.key] = agregar(filtradas.map((x) => x[c.key.split("__")[1]]), fn)
      } else {
        total[c.key] = r2(filas.reduce((a, f) => a + (Number(f[c.key]) || 0), 0))
      }
    }
    const primera = salida.find((c) => !esNumerica(c.tipo))
    if (primera) total[primera.key] = "TOTAL"
  }

  return { columnas: salida, filas, total, registros: filtradas.length }
}

/** Configuración inicial al elegir una fuente: columnas por defecto, este mes, sin agrupar. */
export function configInicial(fuente: string, columnas: ColumnaDef[], conFecha: boolean): ConfigReporte {
  const def = columnas.filter((c) => c.porDefecto).map((c) => c.key)
  return {
    fuente,
    columnas: def.length ? def : columnas.slice(0, 8).map((c) => c.key),
    rango: { preset: conFecha ? "mes" : "todo" },
    filtros: [],
    agrupar: [],
    medidas: [],
    orden: null,
    totales: true,
  }
}
