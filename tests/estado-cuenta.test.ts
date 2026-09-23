import { describe, it, expect } from "vitest"
import { construirEstadoCuenta, calcularAntiguedad, diasEntre } from "@/lib/services/estado-cuenta"

const HOY = "2026-09-22"

const VENTAS = [
  { id: 1, numero_factura: "FC-0001", fecha_venta: "2026-07-01T10:00:00", total_venta: 1000, valorpago: 1000 },
  { id: 2, numero_factura: "FC-0002", fecha_venta: "2026-08-15T10:00:00", total_venta: 500, valorpago: 200 },
  { id: 3, numero_factura: "FC-0003", fecha_venta: "2026-09-20T10:00:00", total_venta: 300, valorpago: 0 },
]
const ABONOS = [
  { venta_id: 1, fecha_pago: "2026-07-10T09:00:00", monto: 1000, metodo_pago: "Efectivo", numero_recibo: null },
  { venta_id: 2, fecha_pago: "2026-08-20T09:00:00", monto: 200, metodo_pago: "Banco", numero_recibo: "RC-0001" },
]
const DEVOLUCIONES = [
  { venta_id: 3, fecha: "2026-09-21T09:00:00", monto_total: 50, numero_devolucion: "DEV-0001", motivo: "Defecto" },
]

describe("construirEstadoCuenta", () => {
  it("sin rango: saldo inicial 0, movimientos ordenados y saldo corrido", () => {
    const ec = construirEstadoCuenta({ ventas: VENTAS, abonos: ABONOS, devoluciones: DEVOLUCIONES, hoyISO: HOY })
    expect(ec.saldoInicial).toBe(0)
    expect(ec.movimientos.map((m) => m.documento)).toEqual(["FC-0001", "Abono", "FC-0002", "RC-0001", "FC-0003", "DEV-0001"])
    expect(ec.movimientos.map((m) => m.saldo)).toEqual([1000, 0, 500, 300, 600, 550])
    expect(ec.totalDebitos).toBe(1800)
    expect(ec.totalCreditos).toBe(1250)
    expect(ec.saldoFinal).toBe(550)
  })

  it("con rango: lo anterior a `desde` va al saldo inicial y lo posterior a `hasta` se excluye", () => {
    const ec = construirEstadoCuenta({
      ventas: VENTAS, abonos: ABONOS, devoluciones: DEVOLUCIONES, hoyISO: HOY,
      desde: "2026-08-01", hasta: "2026-08-31",
    })
    expect(ec.saldoInicial).toBe(0) // FC-0001 quedó pagada antes del rango
    expect(ec.movimientos.map((m) => m.documento)).toEqual(["FC-0002", "RC-0001"])
    expect(ec.movimientos[0].saldo).toBe(500)
    expect(ec.saldoFinal).toBe(300)
  })

  it("el saldo inicial arrastra facturas abiertas antes del rango", () => {
    const ec = construirEstadoCuenta({
      ventas: VENTAS, abonos: ABONOS, devoluciones: DEVOLUCIONES, hoyISO: HOY,
      desde: "2026-09-01", hasta: null,
    })
    expect(ec.saldoInicial).toBe(300) // FC-0002 con 300 pendientes
    expect(ec.movimientos[0].saldo).toBe(600)
    expect(ec.saldoFinal).toBe(550)
  })

  it("las pendientes usan total - valorpago (fuente de verdad) y no dependen del rango", () => {
    const ec = construirEstadoCuenta({ ventas: VENTAS, abonos: ABONOS, devoluciones: DEVOLUCIONES, hoyISO: HOY, desde: "2026-09-01" })
    expect(ec.pendientes.map((p) => [p.numero_factura, p.saldo, p.dias])).toEqual([
      ["FC-0002", 300, 38],
      ["FC-0003", 300, 2],
    ])
  })

  it("sin rango y sin movimientos el saldo final es el inicial", () => {
    const ec = construirEstadoCuenta({ ventas: [], abonos: [], devoluciones: [], hoyISO: HOY })
    expect(ec.saldoFinal).toBe(0)
    expect(ec.antiguedad.total).toBe(0)
  })
})

describe("calcularAntiguedad", () => {
  it("clasifica por tramos de 30 días y suma el total", () => {
    const a = calcularAntiguedad([
      { venta_id: 1, numero_factura: "A", fecha: "", total: 100, saldo: 100, dias: 0 },
      { venta_id: 2, numero_factura: "B", fecha: "", total: 100, saldo: 50, dias: 30 },
      { venta_id: 3, numero_factura: "C", fecha: "", total: 100, saldo: 25, dias: 45 },
      { venta_id: 4, numero_factura: "D", fecha: "", total: 100, saldo: 10, dias: 90 },
      { venta_id: 5, numero_factura: "E", fecha: "", total: 100, saldo: 5, dias: 91 },
      { venta_id: 6, numero_factura: "F", fecha: "", total: 100, saldo: 0, dias: 200 },
    ])
    expect(a).toEqual({ corriente: 100, d1_30: 50, d31_60: 25, d61_90: 10, mas90: 5, total: 190 })
  })
})

describe("diasEntre", () => {
  it("cuenta días completos y nunca negativo", () => {
    expect(diasEntre("2026-09-01T23:00:00", "2026-09-22")).toBe(21)
    expect(diasEntre("2026-09-25", "2026-09-22")).toBe(0)
    expect(diasEntre("", "2026-09-22")).toBe(0)
  })
})
