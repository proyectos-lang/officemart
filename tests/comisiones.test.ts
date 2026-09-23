import { describe, it, expect } from "vitest"
import { calcularComisiones, politicaAplicable, type PoliticaComision, type LineaVentaComision } from "@/lib/services/comisiones"

const POL: PoliticaComision[] = [
  { id: 1, nombre: "General 3% al cobro", vendedor_id: null, base: "venta", porcentaje: 3, categoria_id: null, linea_id: null, momento: "cobro", vigente_desde: null, vigente_hasta: null, activo: true },
  { id: 2, nombre: "Ana 5% utilidad al facturar", vendedor_id: 1, base: "utilidad", porcentaje: 5, categoria_id: null, linea_id: null, momento: "facturacion", vigente_desde: null, vigente_hasta: null, activo: true },
  { id: 3, nombre: "Línea Escolar 6% al cobro", vendedor_id: null, base: "venta", porcentaje: 6, categoria_id: null, linea_id: 7, momento: "cobro", vigente_desde: null, vigente_hasta: null, activo: true },
  { id: 4, nombre: "Vieja", vendedor_id: null, base: "venta", porcentaje: 50, categoria_id: null, linea_id: null, momento: "cobro", vigente_desde: "2020-01-01", vigente_hasta: "2020-12-31", activo: true },
]

const L = (p: Partial<LineaVentaComision> & { venta_id: number; vendedor_id: number | null; venta: number }): LineaVentaComision => ({
  numero_factura: `FC-${p.venta_id}`, fecha: "2026-09-10", categoria_id: null, linea_id: null, utilidad: p.venta * 0.4, total_factura: p.venta, ...p,
})

describe("politicaAplicable", () => {
  it("la más específica gana (vendedor > línea > general) y respeta vigencia/momento", () => {
    expect(politicaAplicable(POL, { vendedor_id: 2, categoria_id: null, linea_id: 7, fecha: "2026-09-10" }, "cobro")?.id).toBe(3)
    expect(politicaAplicable(POL, { vendedor_id: 2, categoria_id: null, linea_id: 9, fecha: "2026-09-10" }, "cobro")?.id).toBe(1)
    expect(politicaAplicable(POL, { vendedor_id: 1, categoria_id: null, linea_id: 7, fecha: "2026-09-10" }, "facturacion")?.id).toBe(2)
    expect(politicaAplicable(POL, { vendedor_id: 1, categoria_id: null, linea_id: null, fecha: "2026-09-10" }, "cobro")?.id).toBe(1)
    expect(politicaAplicable(POL, { vendedor_id: 2, categoria_id: null, linea_id: null, fecha: "2020-06-01" }, "cobro")?.id).toBe(4)
  })
})

describe("calcularComisiones", () => {
  it("al facturar: base utilidad del período; al cobro: proporcional a lo cobrado", () => {
    const r = calcularComisiones({
      lineas: [
        L({ venta_id: 10, vendedor_id: 1, venta: 1000 }), // Ana: 5% de utilidad 400 = 20 al facturar
        L({ venta_id: 20, vendedor_id: 2, venta: 500 }),  // Luis: 3% al cobro
      ],
      cobros: [{ venta_id: 20, fecha: "2026-09-15", monto: 250, recibo_id: 5 }], // cobra la mitad → base 250 → 7.50
      devoluciones: [],
      politicas: POL,
      desde: "2026-09-01",
      hasta: "2026-09-30",
    })
    const ana = r.find((x) => x.vendedor_id === 1)!
    expect(ana.comision).toBe(20)
    expect(ana.items[0].base).toBe(400)
    expect(ana.items[0].porcentaje).toBe(5)
    const luis = r.find((x) => x.vendedor_id === 2)!
    expect(luis.comision).toBe(7.5)
    expect(luis.cobrado).toBe(250)
    expect(luis.items[0].recibo_id).toBe(5)
  })

  it("políticas por línea se aplican por línea de la factura", () => {
    const r = calcularComisiones({
      lineas: [
        L({ venta_id: 30, vendedor_id: 2, venta: 100, linea_id: 7, total_factura: 300 }),
        L({ venta_id: 30, vendedor_id: 2, venta: 200, linea_id: null, total_factura: 300 }),
      ],
      cobros: [{ venta_id: 30, fecha: "2026-09-20", monto: 300, recibo_id: null }],
      devoluciones: [],
      politicas: POL,
      desde: "2026-09-01",
      hasta: "2026-09-30",
    })
    // 100 × 6% + 200 × 3% = 6 + 6 = 12
    expect(r[0].comision).toBe(12)
    expect(r[0].items[0].porcentaje).toBe(4) // % efectivo 12/300
  })

  it("las devoluciones del período restan y las líneas sin vendedor se ignoran", () => {
    const r = calcularComisiones({
      lineas: [L({ venta_id: 40, vendedor_id: 1, venta: 1000, fecha: "2026-08-01" }), L({ venta_id: 41, vendedor_id: null, venta: 999 })],
      cobros: [],
      devoluciones: [{ id: 9, venta_id: 40, fecha: "2026-09-05", monto_total: 500 }],
      politicas: POL,
      desde: "2026-09-01",
      hasta: "2026-09-30",
    })
    expect(r).toHaveLength(1)
    const ana = r[0]
    expect(ana.ventas).toBe(0) // la factura es de agosto
    expect(ana.devoluciones).toBe(500)
    expect(ana.comision).toBe(-10) // 5% de (400 utilidad × 0.5) = 10, negativo
    expect(ana.items[0].devolucion_id).toBe(9)
  })

  it("sin política aplicable no genera items", () => {
    const r = calcularComisiones({ lineas: [L({ venta_id: 1, vendedor_id: 3, venta: 100 })], cobros: [], devoluciones: [], politicas: [], desde: "2026-09-01", hasta: "2026-09-30" })
    expect(r[0].items).toEqual([])
    expect(r[0].comision).toBe(0)
  })
})
