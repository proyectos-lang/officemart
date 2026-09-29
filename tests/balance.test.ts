import { describe, it, expect } from "vitest"
import { armarBalance } from "@/lib/services/balance"
import { netearIsv } from "@/lib/services/estado-resultados"

describe("armarBalance", () => {
  it("totales, patrimonio, liquidez y capital de trabajo con 2 decimales", () => {
    const b = armarBalance(
      "2026-09-23",
      [
        { clave: "caja", nombre: "Caja", monto: 1000.004 },
        { clave: "bancos", nombre: "Bancos", monto: 5000 },
        { clave: "cxc", nombre: "CxC", monto: 2500 },
        { clave: "inventario", nombre: "Inventario", monto: 8000 },
        { clave: "anticipos", nombre: "Anticipos", monto: 0 },
      ],
      [
        { clave: "cxp_gastos", nombre: "CxP gastos", monto: 1200 },
        { clave: "cxp_compras", nombre: "CxP compras", monto: 3000 },
        { clave: "comisiones", nombre: "Comisiones", monto: 300 },
      ]
    )
    expect(b.totalActivos).toBe(16500)
    expect(b.totalPasivos).toBe(4500)
    expect(b.patrimonio).toBe(12000)
    expect(b.liquidez).toBe(1800) // 1000 + 5000 − 1200 − 3000
    expect(b.capitalTrabajo).toBe(12000)
    expect(b.activos[0].monto).toBe(1000)
  })

  it("sin partidas todo es 0", () => {
    const b = armarBalance("2026-09-23", [], [])
    expect(b).toMatchObject({ totalActivos: 0, totalPasivos: 0, patrimonio: 0, liquidez: 0 })
  })
})

describe("netearIsv (estado de resultados sin ISV)", () => {
  it("resta el ISV de ventas y utilidades y recalcula márgenes", () => {
    const base = {
      anio: 2026, mes: 9, mes_nombre: "Septiembre", ventas_totales: 2932.5, costo_mercancia_vendida: 540, utilidad_bruta: 2392.5,
      gastos_servicios: 1500, gastos_publicidad: 0, gastos_nomina: 0, gastos_arriendo: 8000, gastos_mantenimiento: 0, gastos_impuestos: 0,
      gastos_suministros: 0, gastos_otros: 0, total_gastos_operativos: 9500, comisiones_bancarias: 0, utilidad_neta: -7107.5, margen_bruto: 0, margen_neto: 0,
    }
    const r = netearIsv(base, 382.5)
    expect(r.ventas_totales).toBe(2550)
    expect(r.utilidad_bruta).toBe(2010)
    expect(r.utilidad_neta).toBe(-7490)
    expect(r.margen_bruto).toBeCloseTo(78.82, 2)
    expect(netearIsv(base, 0)).toBe(base)
  })
})
