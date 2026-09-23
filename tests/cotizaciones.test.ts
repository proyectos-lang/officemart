import { describe, it, expect } from "vitest"
import {
  calcularTotalesCotizacion,
  puedeTransicionar,
  esConvertible,
  esEditable,
  estaVencida,
  diasParaVencer,
  fechaMasDias,
} from "@/lib/services/cotizaciones"

describe("calcularTotalesCotizacion", () => {
  it("suma líneas con su % propio, aplica descuento global y luego ISV", () => {
    const t = calcularTotalesCotizacion(
      [
        { producto_id: 1, descripcion: "A", cantidad: 2, precio_unitario: 100, descuento_linea: 0 },
        { producto_id: null, descripcion: "Servicio", cantidad: 1, precio_unitario: 50, descuento_linea: 10 },
      ],
      20,
      true
    )
    expect(t.lineas.map((l) => l.subtotal)).toEqual([200, 45])
    expect(t.subtotal).toBe(245)
    expect(t.descuentoMonto).toBe(49)
    expect(t.base).toBe(196)
    expect(t.impuesto).toBe(29.4)
    expect(t.total).toBe(225.4)
  })

  it("sin ISV el impuesto es 0 y sanea cantidades/porcentajes fuera de rango", () => {
    const t = calcularTotalesCotizacion(
      [{ producto_id: 1, descripcion: "A", cantidad: -3, precio_unitario: 10, descuento_linea: 150 }],
      -5,
      false
    )
    expect(t.lineas[0].cantidad).toBe(0)
    expect(t.lineas[0].descuento_linea).toBe(100)
    expect(t.subtotal).toBe(0)
    expect(t.impuesto).toBe(0)
    expect(t.total).toBe(0)
  })
})

describe("transiciones de estado", () => {
  it("flujo normal Borrador → Enviada → Aprobada → Facturada", () => {
    expect(puedeTransicionar("Borrador", "Enviada")).toBe(true)
    expect(puedeTransicionar("Enviada", "Aprobada")).toBe(true)
    expect(puedeTransicionar("Aprobada", "Facturada")).toBe(true)
  })

  it("Facturada es final; Rechazada solo vuelve a Borrador; Vencida se reactiva o rechaza", () => {
    expect(puedeTransicionar("Facturada", "Borrador")).toBe(false)
    expect(puedeTransicionar("Facturada", "Rechazada")).toBe(false)
    expect(puedeTransicionar("Rechazada", "Borrador")).toBe(true)
    expect(puedeTransicionar("Rechazada", "Aprobada")).toBe(false)
    expect(puedeTransicionar("Vencida", "Enviada")).toBe(true)
    expect(puedeTransicionar("Vencida", "Facturada")).toBe(false)
    expect(puedeTransicionar("Enviada", "Enviada")).toBe(false)
  })

  it("convertible y editable según el estado", () => {
    expect(esConvertible("Borrador")).toBe(true)
    expect(esConvertible("Aprobada")).toBe(true)
    expect(esConvertible("Vencida")).toBe(false)
    expect(esConvertible("Facturada")).toBe(false)
    expect(esEditable("Enviada")).toBe(true)
    expect(esEditable("Aprobada")).toBe(false)
  })
})

describe("vigencia", () => {
  it("vence solo si pasó la fecha y sigue abierta", () => {
    expect(estaVencida({ estado: "Enviada", vigencia_hasta: "2026-09-20" }, "2026-09-22")).toBe(true)
    expect(estaVencida({ estado: "Enviada", vigencia_hasta: "2026-09-22" }, "2026-09-22")).toBe(false)
    expect(estaVencida({ estado: "Aprobada", vigencia_hasta: "2026-09-01" }, "2026-09-22")).toBe(false)
    expect(estaVencida({ estado: "Borrador", vigencia_hasta: null }, "2026-09-22")).toBe(false)
  })

  it("días para vencer y suma de días", () => {
    expect(diasParaVencer("2026-09-25", "2026-09-22")).toBe(3)
    expect(diasParaVencer("2026-09-20", "2026-09-22")).toBe(-2)
    expect(diasParaVencer(null, "2026-09-22")).toBeNull()
    expect(fechaMasDias("2026-09-22", 15)).toBe("2026-10-07")
    expect(fechaMasDias("2026-12-31", 1)).toBe("2027-01-01")
  })
})
