import * as XLSX from "xlsx"
import { getClientes, saveCliente, type Cliente } from "@/lib/services/catalogos"
import { getZonas, getVendedores } from "@/lib/services/vendedores"

// ==================== IMPORTAR CLIENTES · Excel ====================
//
// Descarga de plantilla + parseo + preview + carga masiva de clientes. Mismo
// estilo tolerante a tildes/variaciones de encabezado que importar-materiales.
// Dedup por RTN (si viene) y, si no, por nombre. Crea con saveCliente(_, true).
// Columnas opcionales del script officemart-002: Correo, Limite de Credito,
// Dias de Credito, Zona y Vendedor (por nombre) y Notas.

function str(v: unknown): string {
  if (v == null) return ""
  return String(v).trim()
}

function num(v: unknown): number | null {
  if (v == null || v === "") return null
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/\s/g, "").replace(",", "."))
  return Number.isFinite(n) ? n : null
}

/** Valor de la primera columna cuyo encabezado matchee alguno de los alias. */
function col(row: Record<string, unknown>, alias: string[]): unknown {
  const keys = Object.keys(row)
  for (const a of alias) {
    const k = keys.find((k) => k.trim().toLowerCase() === a.toLowerCase())
    if (k != null) return row[k]
  }
  return undefined
}

/** Normaliza una fecha de Excel a ISO 'YYYY-MM-DD' (o "" si no se reconoce). */
function fechaISO(v: unknown): string {
  if (v == null || v === "") return ""
  // Excel puede entregar un número de serie de fecha o un string.
  if (typeof v === "number") {
    const d = XLSX.SSF ? XLSX.SSF.parse_date_code(v) : null
    if (d && d.y) {
      const mm = String(d.m).padStart(2, "0")
      const dd = String(d.d).padStart(2, "0")
      return `${d.y}-${mm}-${dd}`
    }
    return ""
  }
  const s = String(v).trim()
  // dd/mm/yyyy o dd-mm-yyyy -> yyyy-mm-dd
  const m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/)
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`
  // yyyy-mm-dd ya válido
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  return ""
}

export interface FilaClienteImport {
  fila: number
  nombre: string
  rtn: string
  direccion: string
  telefono: string
  correo: string
  fecha_nacimiento: string // ISO o ""
  limite_credito: number | null
  dias_credito: number | null
  zona: string
  vendedor: string
  notas: string
}

export interface PreviewClientes {
  total: number
  nuevos: number
  duplicados: string[] // nombres/RTN que ya existen
  sinNombre: number
  /** Zonas/vendedores escritos en el archivo que no existen (se cargan sin ese dato). */
  zonasNoEncontradas?: string[]
  vendedoresNoEncontrados?: string[]
}

export interface ResultadoCliente {
  identificador: string
  estado: "creado" | "omitido" | "error"
  detalle: string
}

export interface ResultadoImportClientes {
  creados: number
  omitidos: number
  errores: number
  clientes: ResultadoCliente[]
}

const CLIENTES_TEMPLATE_HEADERS = [
  "Nombre",
  "RTN",
  "Direccion",
  "Telefono",
  "Correo",
  "Fecha Nacimiento",
  "Limite Credito",
  "Dias Credito",
  "Zona",
  "Vendedor",
  "Notas",
] as const

/** Descarga la plantilla .xlsx de carga de clientes con 2 filas de ejemplo. */
export function descargarPlantillaClientes(): void {
  const ejemplo: Record<string, unknown>[] = [
    {
      Nombre: "Juan Pérez", RTN: "0801-1990-00123", Direccion: "Col. Centro, Tegucigalpa", Telefono: "9999-9999",
      Correo: "juan@correo.com", "Fecha Nacimiento": "1990-05-20", "Limite Credito": 25000, "Dias Credito": 30,
      Zona: "", Vendedor: "", Notas: "Entregar solo por la mañana",
    },
    {
      Nombre: "María López", RTN: "", Direccion: "", Telefono: "8888-8888", Correo: "", "Fecha Nacimiento": "",
      "Limite Credito": "", "Dias Credito": "", Zona: "", Vendedor: "", Notas: "",
    },
  ]
  const ws = XLSX.utils.json_to_sheet(ejemplo, { header: CLIENTES_TEMPLATE_HEADERS as unknown as string[] })
  ws["!cols"] = [{ wch: 28 }, { wch: 18 }, { wch: 30 }, { wch: 14 }, { wch: 24 }, { wch: 16 }, { wch: 14 }, { wch: 12 }, { wch: 18 }, { wch: 20 }, { wch: 30 }]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, "Clientes")
  XLSX.writeFile(wb, "Plantilla_Clientes.xlsx")
}

/** Parsea el Excel a filas normalizadas. Ignora filas sin nombre. */
export async function parsearArchivoClientes(file: File): Promise<FilaClienteImport[]> {
  const buffer = await file.arrayBuffer()
  const wb = XLSX.read(buffer, { type: "array" })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" })

  const filas: FilaClienteImport[] = []
  rows.forEach((row, i) => {
    const nombre = str(col(row, ["Nombre", "Cliente", "Razon Social", "Razón Social"]))
    const rtn = str(col(row, ["RTN", "Rtn", "Identidad", "DNI"]))
    // Ignora filas totalmente vacías (sin nombre y sin rtn).
    if (!nombre && !rtn) return
    filas.push({
      fila: i + 2,
      nombre,
      rtn,
      direccion: str(col(row, ["Direccion", "Dirección", "Domicilio"])),
      telefono: str(col(row, ["Telefono", "Teléfono", "Celular", "Tel"])),
      correo: str(col(row, ["Correo", "Email", "E-mail", "Correo Electronico", "Correo Electrónico"])),
      fecha_nacimiento: fechaISO(col(row, ["Fecha Nacimiento", "Fecha de Nacimiento", "Nacimiento", "Cumpleaños", "Cumpleanos"])),
      limite_credito: num(col(row, ["Limite Credito", "Límite Crédito", "Limite de Credito", "Límite de Crédito", "Cupo"])),
      dias_credito: num(col(row, ["Dias Credito", "Días Crédito", "Dias de Credito", "Días de Crédito", "Plazo"])),
      zona: str(col(row, ["Zona", "Ruta"])),
      vendedor: str(col(row, ["Vendedor", "Ejecutivo"])),
      notas: str(col(row, ["Notas", "Observaciones", "Nota"])),
    })
  })
  return filas
}

interface ContextoImport {
  porRtn: Set<string>
  porNombre: Set<string>
  zonaPorNombre: Map<string, number>
  vendedorPorNombre: Map<string, number>
}

/** Contexto de dedup (clientes por RTN y nombre) + catálogos de zona/vendedor por nombre. */
async function cargarContexto(): Promise<ContextoImport> {
  const [{ data }, zonasRes, vendRes] = await Promise.all([getClientes(), getZonas(), getVendedores()])
  const porRtn = new Set<string>()
  const porNombre = new Set<string>()
  for (const c of data) {
    if (c.rtn) porRtn.add(c.rtn.trim().toLowerCase())
    if (c.nombre) porNombre.add(c.nombre.trim().toLowerCase())
  }
  const zonaPorNombre = new Map<string, number>()
  for (const z of zonasRes.data || []) if (z.id != null) zonaPorNombre.set(z.nombre.trim().toLowerCase(), z.id)
  const vendedorPorNombre = new Map<string, number>()
  for (const v of vendRes.data || []) if (v.id != null) vendedorPorNombre.set(v.nombre.trim().toLowerCase(), v.id)
  return { porRtn, porNombre, zonaPorNombre, vendedorPorNombre }
}

/** true si la fila ya existe (por RTN si lo trae, o por nombre). */
function esDuplicado(f: FilaClienteImport, ctx: ContextoImport): boolean {
  if (f.rtn) return ctx.porRtn.has(f.rtn.trim().toLowerCase())
  return ctx.porNombre.has(f.nombre.trim().toLowerCase())
}

export async function previsualizarImportClientes(filas: FilaClienteImport[]): Promise<PreviewClientes> {
  const ctx = await cargarContexto()
  let nuevos = 0
  let sinNombre = 0
  const duplicados: string[] = []
  const zonasNo = new Set<string>()
  const vendNo = new Set<string>()
  for (const f of filas) {
    if (!f.nombre) { sinNombre++; continue }
    if (esDuplicado(f, ctx)) duplicados.push(f.rtn || f.nombre)
    else nuevos++
    if (f.zona && !ctx.zonaPorNombre.has(f.zona.trim().toLowerCase())) zonasNo.add(f.zona)
    if (f.vendedor && !ctx.vendedorPorNombre.has(f.vendedor.trim().toLowerCase())) vendNo.add(f.vendedor)
  }
  return {
    total: filas.length, nuevos, duplicados, sinNombre,
    zonasNoEncontradas: [...zonasNo], vendedoresNoEncontrados: [...vendNo],
  }
}

export async function importarClientes(
  filas: FilaClienteImport[]
): Promise<{ data: ResultadoImportClientes | null; error: string | null }> {
  const ctx = await cargarContexto()
  const res: ResultadoImportClientes = { creados: 0, omitidos: 0, errores: 0, clientes: [] }

  for (const f of filas) {
    const ident = f.rtn || f.nombre || `Fila ${f.fila}`
    if (!f.nombre) {
      res.omitidos++
      res.clientes.push({ identificador: `Fila ${f.fila}`, estado: "omitido", detalle: "Sin nombre" })
      continue
    }
    if (esDuplicado(f, ctx)) {
      res.omitidos++
      res.clientes.push({ identificador: ident, estado: "omitido", detalle: "Ya existe" })
      continue
    }
    const cliente: Cliente = {
      nombre: f.nombre,
      rtn: f.rtn || undefined,
      direccion: f.direccion || undefined,
      telefono: f.telefono || undefined,
      correo: f.correo || null,
      fecha_nacimiento: f.fecha_nacimiento || undefined,
      limite_credito: f.limite_credito,
      dias_credito: f.dias_credito,
      zona_id: f.zona ? ctx.zonaPorNombre.get(f.zona.trim().toLowerCase()) ?? null : null,
      vendedor_id: f.vendedor ? ctx.vendedorPorNombre.get(f.vendedor.trim().toLowerCase()) ?? null : null,
      notas: f.notas || null,
    }
    const { error } = await saveCliente(cliente, true)
    if (error) {
      res.errores++
      res.clientes.push({ identificador: ident, estado: "error", detalle: error })
    } else {
      res.creados++
      res.clientes.push({ identificador: ident, estado: "creado", detalle: "" })
      // Actualiza el contexto para dedup dentro del mismo archivo.
      if (f.rtn) ctx.porRtn.add(f.rtn.trim().toLowerCase())
      ctx.porNombre.add(f.nombre.trim().toLowerCase())
    }
  }
  return { data: res, error: null }
}
