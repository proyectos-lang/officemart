import { describe, it, expect } from "vitest"
import { resolverRango, aplicarFiltros, ejecutarReporte, claveFecha, etiquetaFecha, valoresDistintos, configInicial, type ColumnaDef, type ConfigReporte } from "@/lib/reporteria/motor"
import { serialExcel } from "@/lib/reporteria/excel"
import { FUENTES } from "@/lib/reporteria/fuentes"

const COLS: ColumnaDef[] = [
  { key: "fecha", label: "Fecha", tipo: "fechahora", porDefecto: true },
  { key: "cliente", label: "Cliente", tipo: "texto", porDefecto: true },
  { key: "vendedor", label: "Vendedor", tipo: "texto" },
  { key: "total", label: "Total", tipo: "moneda", porDefecto: true },
  { key: "dias", label: "Días", tipo: "numero", sumable: false },
  { key: "margen", label: "Margen %", tipo: "porcentaje" },
  { key: "pagada", label: "Pagada", tipo: "booleano" },
]
const FILAS = [
  { fecha: "2026-09-01T10:00:00.000Z", cliente: "Ácme", vendedor: "Ana", total: 100, dias: 5, margen: 20, pagada: true },
  { fecha: "2026-09-15T10:00:00.000Z", cliente: "Beta", vendedor: "Ana", total: 300, dias: 10, margen: 40, pagada: false },
  { fecha: "2026-10-02T10:00:00.000Z", cliente: "acme", vendedor: "Luis", total: 50, dias: 0, margen: 10, pagada: true },
  { fecha: "2026-10-03T10:00:00.000Z", cliente: "Gama", vendedor: null, total: null, dias: 1, margen: null, pagada: false },
]
const base = (p: Partial<ConfigReporte>): ConfigReporte => ({ ...configInicial("x", COLS, true), ...p })

describe("resolverRango", () => {
  const hoy = "2026-10-02"
  it("presets relativos se recalculan contra hoy", () => {
    expect(resolverRango({ preset: "mes" }, hoy)).toEqual({ desde: "2026-10-01", hasta: "2026-10-02" })
    expect(resolverRango({ preset: "mes_anterior" }, hoy)).toEqual({ desde: "2026-09-01", hasta: "2026-09-30" })
    expect(resolverRango({ preset: "semana" }, hoy)).toEqual({ desde: "2026-09-28", hasta: "2026-10-02" })
    expect(resolverRango({ preset: "semana_anterior" }, hoy)).toEqual({ desde: "2026-09-21", hasta: "2026-09-27" })
    expect(resolverRango({ preset: "trimestre" }, hoy)).toEqual({ desde: "2026-10-01", hasta: "2026-10-02" })
    expect(resolverRango({ preset: "ultimos_30" }, hoy)).toEqual({ desde: "2026-09-03", hasta: "2026-10-02" })
    expect(resolverRango({ preset: "mes_anterior" }, "2026-01-15")).toEqual({ desde: "2025-12-01", hasta: "2025-12-31" })
    expect(resolverRango({ preset: "todo" }, hoy)).toEqual({ desde: null, hasta: null })
    expect(resolverRango({ preset: "personalizado", desde: "2026-01-01", hasta: "2026-03-31" }, hoy)).toEqual({ desde: "2026-01-01", hasta: "2026-03-31" })
  })
})

describe("filtros", () => {
  it("texto sin tildes ni mayúsculas, números, fechas, lista y vacíos", () => {
    expect(aplicarFiltros(FILAS, [{ col: "cliente", op: "contiene", valor: "ACME" }], COLS)).toHaveLength(2)
    expect(aplicarFiltros(FILAS, [{ col: "total", op: "mayor", valor: "100" }], COLS)).toHaveLength(2)
    expect(aplicarFiltros(FILAS, [{ col: "total", op: "entre", valor: "40", valor2: "120" }], COLS)).toHaveLength(2)
    expect(aplicarFiltros(FILAS, [{ col: "fecha", op: "menor", valor: "2026-09-30" }], COLS)).toHaveLength(2)
    expect(aplicarFiltros(FILAS, [{ col: "vendedor", op: "en", valores: ["Ana", "Luis"] }], COLS)).toHaveLength(3)
    expect(aplicarFiltros(FILAS, [{ col: "vendedor", op: "vacio" }], COLS)).toHaveLength(1)
    expect(aplicarFiltros(FILAS, [{ col: "pagada", op: "igual", valor: "Sí" }], COLS)).toHaveLength(2)
    // Filtro incompleto se ignora
    expect(aplicarFiltros(FILAS, [{ col: "cliente", op: "contiene", valor: "" }], COLS)).toHaveLength(4)
    expect(valoresDistintos(FILAS, "vendedor", "texto")).toEqual(["Ana", "Luis"])
  })
})

describe("ejecutarReporte", () => {
  it("detalle: columnas elegidas, orden y totales (solo sumables)", () => {
    const r = ejecutarReporte(FILAS, COLS, base({ columnas: ["cliente", "total", "dias", "margen"], orden: { col: "total", dir: "desc" } }))
    expect(r.columnas.map((c) => c.key)).toEqual(["cliente", "total", "dias", "margen"])
    expect(r.filas.map((f) => f.total)).toEqual([300, 100, 50, null])
    expect(r.total).toEqual({ cliente: "TOTAL", total: 450 })
    expect(r.registros).toBe(4)
  })

  it("agrupa por mes y vendedor con medidas", () => {
    const r = ejecutarReporte(FILAS, COLS, base({
      agrupar: [{ col: "fecha", nivel: "mes" }, { col: "vendedor" }],
      medidas: [{ col: "total", fn: "suma" }, { col: "*", fn: "conteo" }, { col: "margen", fn: "promedio" }],
    }))
    expect(r.columnas.map((c) => c.label)).toEqual(["Fecha (mes)", "Vendedor", "Suma de Total", "Registros", "Promedio de Margen %"])
    expect(r.filas).toEqual([
      { fecha: "Sep 2026", vendedor: "Ana", suma__total: 400, conteo__registros: 2, promedio__margen: 30 },
      { fecha: "Oct 2026", vendedor: "Luis", suma__total: 50, conteo__registros: 1, promedio__margen: 10 },
      { fecha: "Oct 2026", vendedor: null, suma__total: 0, conteo__registros: 1, promedio__margen: 0 },
    ])
    expect(r.total).toMatchObject({ fecha: "TOTAL", suma__total: 450, conteo__registros: 4, promedio__margen: 23.33 })
  })

  it("sin medidas agrupa contando y ordena por la medida", () => {
    const r = ejecutarReporte(FILAS, COLS, base({ agrupar: [{ col: "cliente" }], orden: { col: "conteo__registros", dir: "desc" } }))
    expect(r.filas).toHaveLength(4) // "Ácme" y "acme" son valores distintos
    expect(r.filas.every((x) => x.conteo__registros === 1)).toBe(true)
    const v = ejecutarReporte(FILAS, COLS, base({ agrupar: [{ col: "vendedor" }], orden: { col: "conteo__registros", dir: "desc" } }))
    expect(v.filas[0]).toEqual({ vendedor: "Ana", conteo__registros: 2 })
  })

  it("agrupar por semana deja la fecha del lunes", () => {
    expect(claveFecha("2026-10-02T10:00:00.000Z", "semana")).toBe("2026-09-28")
    expect(claveFecha("2026-08-15", "trimestre")).toBe("2026-T3")
    expect(etiquetaFecha("2026-T3", "trimestre")).toBe("T3 2026")
  })
})

describe("excel y catálogo", () => {
  it("serial de Excel respeta la hora HN-as-UTC", () => {
    expect(serialExcel("2026-10-02", false)).toBe(46297)
    expect(serialExcel("2026-10-02T12:00:00.000Z", true)).toBe(46297.5)
    expect(serialExcel("no es fecha", false)).toBeNull()
  })
  it("las fuentes tienen ids únicos, columnas únicas y alguna por defecto", () => {
    expect(new Set(FUENTES.map((f) => f.id)).size).toBe(FUENTES.length)
    for (const f of FUENTES) {
      expect(new Set(f.columnas.map((c) => c.key)).size, f.id).toBe(f.columnas.length)
      expect(f.columnas.some((c) => c.porDefecto), f.id).toBe(true)
    }
  })
})
