import type { ResultadoReporte, TipoColumna } from "@/lib/reporteria/motor"

/**
 * Exporta un reporte a Excel (.xlsx), nunca CSV. Cada columna en su celda y
 * con su tipo nativo: fechas como fecha de Excel (dd/mm/aaaa), montos como
 * número con separador de miles y 2 decimales, porcentajes con 2 decimales.
 * Hoja "Reporte" (encabezado congelado, autofiltro, fila de totales) y hoja
 * "Parámetros" (fuente, período, filtros, agrupación, fecha de generación).
 */

export interface MetaExport {
  nombre: string
  fuente: string
  sistema: string
  periodo: string
  filtros: string[]
  agrupacion: string[]
  generadoPor: string
  generadoEl: string
  empresa: string
}

/** Serial de Excel de una fecha HN-as-UTC (los componentes UTC son la hora local). */
export function serialExcel(iso: string, conHora: boolean): number | null {
  const s = String(iso)
  const ms = conHora ? Date.parse(s.length === 10 ? `${s}T00:00:00.000Z` : s) : Date.parse(`${s.slice(0, 10)}T00:00:00.000Z`)
  if (Number.isNaN(ms)) return null
  return ms / 86_400_000 + 25569
}

const FORMATO: Partial<Record<TipoColumna, string>> = {
  moneda: "#,##0.00",
  numero: "#,##0.##",
  porcentaje: '0.00"%"',
  fecha: "dd/mm/yyyy",
  fechahora: "dd/mm/yyyy hh:mm",
}

type Celda = { t: "s" | "n" | "b"; v: string | number | boolean; z?: string; s?: unknown }

function celda(v: unknown, tipo: TipoColumna): Celda | null {
  if (v == null || v === "") return null
  if (tipo === "fecha" || tipo === "fechahora") {
    const n = serialExcel(String(v), tipo === "fechahora")
    return n == null ? { t: "s", v: String(v) } : { t: "n", v: n, z: FORMATO[tipo] }
  }
  if (tipo === "moneda" || tipo === "numero" || tipo === "porcentaje") {
    const n = Number(v)
    return Number.isNaN(n) ? { t: "s", v: String(v) } : { t: "n", v: n, z: FORMATO[tipo] }
  }
  if (tipo === "booleano") return { t: "s", v: v === true || v === "true" ? "Sí" : "No" }
  return { t: "s", v: String(v) }
}

function nombreArchivo(nombre: string, fecha: string): string {
  const limpio = nombre.normalize("NFD").replace(/\p{M}/gu, "").replace(/[^A-Za-z0-9 _-]/g, "").trim().replace(/\s+/g, "_") || "Reporte"
  return `${limpio}_${fecha}.xlsx`
}

export async function exportarReporteXlsx(res: ResultadoReporte, meta: MetaExport): Promise<void> {
  const XLSX = await import("xlsx")
  const encode = XLSX.utils.encode_cell

  // ---------- Hoja Reporte ----------
  const ws: Record<string, unknown> = {}
  const cols = res.columnas
  const anchos = cols.map((c) => Math.min(60, Math.max(c.label.length + 2, c.tipo === "fechahora" ? 17 : c.tipo === "fecha" ? 12 : 10)))
  cols.forEach((c, j) => {
    ws[encode({ r: 0, c: j })] = { t: "s", v: c.label }
  })
  res.filas.forEach((f, i) => {
    cols.forEach((c, j) => {
      const cel = celda(f[c.key], c.tipo)
      if (!cel) return
      ws[encode({ r: i + 1, c: j })] = cel
      if (cel.t === "s") anchos[j] = Math.min(60, Math.max(anchos[j], String(cel.v).length + 1))
      else if (c.tipo === "moneda") anchos[j] = Math.max(anchos[j], String(Math.round(Number(cel.v))).length + 6)
    })
  })
  let ultimaFila = res.filas.length
  if (res.total) {
    ultimaFila += 1
    cols.forEach((c, j) => {
      const v = res.total![c.key]
      if (v == null) return
      ws[encode({ r: ultimaFila, c: j })] = typeof v === "number" ? { t: "n", v, z: FORMATO[c.tipo] ?? "#,##0.00" } : { t: "s", v: String(v) }
    })
  }
  ws["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(ultimaFila, 0), c: Math.max(cols.length - 1, 0) } })
  ws["!cols"] = anchos.map((wch) => ({ wch }))
  ws["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(res.filas.length, 1), c: Math.max(cols.length - 1, 0) } }) }
  ws["!freeze"] = { xSplit: 0, ySplit: 1 }
  ws["!views"] = [{ state: "frozen", ySplit: 1, topLeftCell: "A2" }]

  // ---------- Hoja Parámetros ----------
  const params: (string | number)[][] = [
    ["Reporte", meta.nombre],
    ["Empresa", meta.empresa],
    ["Sistema", meta.sistema],
    ["Fuente", meta.fuente],
    ["Período", meta.periodo],
    ["Registros", res.registros],
    ["Filas exportadas", res.filas.length],
    ["Agrupación", meta.agrupacion.length ? meta.agrupacion.join(" > ") : "Sin agrupar (detalle)"],
    ["Filtros", meta.filtros.length ? meta.filtros.join(" · ") : "Sin filtros"],
    ["Generado por", meta.generadoPor],
    ["Generado el", meta.generadoEl],
  ]
  const wp = XLSX.utils.aoa_to_sheet(params)
  wp["!cols"] = [{ wch: 18 }, { wch: 90 }]

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, "Reporte")
  XLSX.utils.book_append_sheet(wb, wp, "Parámetros")
  XLSX.writeFile(wb, nombreArchivo(meta.nombre, meta.generadoEl.slice(0, 10)), { compression: true })
}
