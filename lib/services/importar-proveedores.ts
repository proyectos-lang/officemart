import * as XLSX from "xlsx"
import { getProveedores, saveProveedor, type Proveedor } from "@/lib/services/catalogos"

// ==================== IMPORTAR PROVEEDORES · Excel ====================
//
// Descarga de plantilla + parseo + preview + carga masiva de proveedores.
// Dedup por RTN (si viene) y, si no, por nombre. Crea con saveProveedor(_, true).
// Columnas de contacto separadas (script officemart-002): Contacto (persona),
// Telefono, Correo, Direccion, Pais, Moneda, Dias de Credito.

function str(v: unknown): string {
  if (v == null) return ""
  return String(v).trim()
}

function num(v: unknown): number | null {
  if (v == null || v === "") return null
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(",", "."))
  return Number.isFinite(n) ? n : null
}

function col(row: Record<string, unknown>, alias: string[]): unknown {
  const keys = Object.keys(row)
  for (const a of alias) {
    const k = keys.find((k) => k.trim().toLowerCase() === a.toLowerCase())
    if (k != null) return row[k]
  }
  return undefined
}

export interface FilaProveedorImport {
  fila: number
  nombre: string
  rtn: string
  contacto: string
  telefono: string
  correo: string
  direccion: string
  pais: string
  moneda: string
  dias_credito: number | null
}

export interface PreviewProveedores {
  total: number
  nuevos: number
  duplicados: string[]
  sinNombre: number
}

export interface ResultadoProveedor {
  identificador: string
  estado: "creado" | "omitido" | "error"
  detalle: string
}

export interface ResultadoImportProveedores {
  creados: number
  omitidos: number
  errores: number
  proveedores: ResultadoProveedor[]
}

const PROVEEDORES_TEMPLATE_HEADERS = [
  "Nombre",
  "RTN",
  "Contacto",
  "Telefono",
  "Correo",
  "Direccion",
  "Pais",
  "Moneda",
  "Dias de Credito",
] as const

/** Descarga la plantilla .xlsx de carga de proveedores con 2 filas de ejemplo. */
export function descargarPlantillaProveedores(): void {
  const ejemplo: Record<string, unknown>[] = [
    {
      Nombre: "Distribuidora El Sol", RTN: "0801-1985-00456", Contacto: "Carlos Mejía", Telefono: "9999-9999",
      Correo: "ventas@elsol.hn", Direccion: "Col. Centro, San Pedro Sula", Pais: "Honduras", Moneda: "LPS", "Dias de Credito": 30,
    },
    {
      Nombre: "Importaciones Luna", RTN: "", Contacto: "", Telefono: "", Correo: "", Direccion: "", Pais: "Estados Unidos",
      Moneda: "USD", "Dias de Credito": "",
    },
  ]
  const ws = XLSX.utils.json_to_sheet(ejemplo, { header: PROVEEDORES_TEMPLATE_HEADERS as unknown as string[] })
  ws["!cols"] = [{ wch: 28 }, { wch: 18 }, { wch: 22 }, { wch: 14 }, { wch: 24 }, { wch: 30 }, { wch: 14 }, { wch: 8 }, { wch: 14 }]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, "Proveedores")
  XLSX.writeFile(wb, "Plantilla_Proveedores.xlsx")
}

/** Parsea el Excel a filas normalizadas. Ignora filas sin nombre y sin rtn. */
export async function parsearArchivoProveedores(file: File): Promise<FilaProveedorImport[]> {
  const buffer = await file.arrayBuffer()
  const wb = XLSX.read(buffer, { type: "array" })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" })

  const filas: FilaProveedorImport[] = []
  rows.forEach((row, i) => {
    const nombre = str(col(row, ["Nombre", "Proveedor", "Razon Social", "Razón Social"]))
    const rtn = str(col(row, ["RTN", "Rtn", "Identidad"]))
    if (!nombre && !rtn) return
    filas.push({
      fila: i + 2,
      nombre,
      rtn,
      contacto: str(col(row, ["Contacto", "Persona de Contacto", "Persona"])),
      telefono: str(col(row, ["Telefono", "Teléfono", "Celular", "Tel"])),
      correo: str(col(row, ["Correo", "Email", "E-mail", "Correo Electronico", "Correo Electrónico"])),
      direccion: str(col(row, ["Direccion", "Dirección", "Domicilio"])),
      pais: str(col(row, ["Pais", "País"])),
      moneda: str(col(row, ["Moneda"])).toUpperCase(),
      dias_credito: num(col(row, ["Dias de Credito", "Días de Crédito", "Dias Credito", "Credito (dias)", "Plazo"])),
    })
  })
  return filas
}

async function cargarContexto(): Promise<{ porRtn: Set<string>; porNombre: Set<string> }> {
  const { data } = await getProveedores()
  const porRtn = new Set<string>()
  const porNombre = new Set<string>()
  for (const p of data) {
    if (p.rtn) porRtn.add(p.rtn.trim().toLowerCase())
    if (p.nombre) porNombre.add(p.nombre.trim().toLowerCase())
  }
  return { porRtn, porNombre }
}

function esDuplicado(f: FilaProveedorImport, ctx: { porRtn: Set<string>; porNombre: Set<string> }): boolean {
  if (f.rtn) return ctx.porRtn.has(f.rtn.trim().toLowerCase())
  return ctx.porNombre.has(f.nombre.trim().toLowerCase())
}

export async function previsualizarImportProveedores(filas: FilaProveedorImport[]): Promise<PreviewProveedores> {
  const ctx = await cargarContexto()
  let nuevos = 0
  let sinNombre = 0
  const duplicados: string[] = []
  for (const f of filas) {
    if (!f.nombre) { sinNombre++; continue }
    if (esDuplicado(f, ctx)) duplicados.push(f.rtn || f.nombre)
    else nuevos++
  }
  return { total: filas.length, nuevos, duplicados, sinNombre }
}

export async function importarProveedores(
  filas: FilaProveedorImport[]
): Promise<{ data: ResultadoImportProveedores | null; error: string | null }> {
  const ctx = await cargarContexto()
  const res: ResultadoImportProveedores = { creados: 0, omitidos: 0, errores: 0, proveedores: [] }

  for (const f of filas) {
    const ident = f.rtn || f.nombre || `Fila ${f.fila}`
    if (!f.nombre) {
      res.omitidos++
      res.proveedores.push({ identificador: `Fila ${f.fila}`, estado: "omitido", detalle: "Sin nombre" })
      continue
    }
    if (esDuplicado(f, ctx)) {
      res.omitidos++
      res.proveedores.push({ identificador: ident, estado: "omitido", detalle: "Ya existe" })
      continue
    }
    const proveedor: Proveedor = {
      nombre: f.nombre,
      rtn: f.rtn || null,
      contacto: f.contacto || null,
      telefono: f.telefono || null,
      correo: f.correo || null,
      direccion: f.direccion || null,
      pais: f.pais || null,
      moneda: f.moneda === "USD" ? "USD" : f.moneda === "LPS" ? "LPS" : null,
      dias_credito: f.dias_credito,
    }
    const { error } = await saveProveedor(proveedor, true)
    if (error) {
      res.errores++
      res.proveedores.push({ identificador: ident, estado: "error", detalle: error })
    } else {
      res.creados++
      res.proveedores.push({ identificador: ident, estado: "creado", detalle: "" })
      if (f.rtn) ctx.porRtn.add(f.rtn.trim().toLowerCase())
      ctx.porNombre.add(f.nombre.trim().toLowerCase())
    }
  }
  return { data: res, error: null }
}
