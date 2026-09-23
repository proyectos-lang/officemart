import { describe, it, expect } from "vitest"
import { armarBalance } from "@/lib/services/balance"

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
