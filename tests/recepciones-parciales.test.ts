import { describe, it, expect } from "vitest"
import {
  calcularPendientes,
  validarCantidadesRecepcion,
  derivarEstadoRecepcion,
  derivarEstadoPagoCompra,
  costoFinalPonderado,
  fechaVencimiento,
} from "@/lib/services/compras-recepciones"
import { calcularProrrateoDetallado } from "@/lib/services/compras"

const DET = [
  { id: 1, cantidad: 10, cantidad_recibida: 4, producto_nombre: "Papel" },
  { id: 2, cantidad: 5, cantidad_recibida: 0, producto_nombre: "Tinta" },
  { id: 3, cantidad: 2, cantidad_recibida: 2, producto_nombre: "Grapas" },
]

describe("calcularPendientes / validarCantidadesRecepcion", () => {
  it("pendiente = ordenado − recibido, nunca negativo", () => {
    const p = calcularPendientes([...DET, { id: 4, cantidad: 1, cantidad_recibida: 3 }])
    expect(p.get(1)).toBe(6)
    expect(p.get(2)).toBe(5)
    expect(p.get(3)).toBe(0)
    expect(p.get(4)).toBe(0)
  })

  it("acepta recibir hasta lo pendiente e ignora ceros", () => {
    expect(validarCantidadesRecepcion(DET, [{ detalle_id: 1, cantidad_recibida: 6 }, { detalle_id: 2, cantidad_recibida: 0 }])).toBeNull()
  })

  it("rechaza exceso, negativos, líneas ajenas y recepciones vacías", () => {
    expect(validarCantidadesRecepcion(DET, [{ detalle_id: 1, cantidad_recibida: 7 }])).toMatch(/Papel.*7.*6/)
    expect(validarCantidadesRecepcion(DET, [{ detalle_id: 1, cantidad_recibida: -1 }])).toMatch(/negativas/)
    expect(validarCantidadesRecepcion(DET, [{ detalle_id: 99, cantidad_recibida: 1 }])).toMatch(/no pertenece/)
    expect(validarCantidadesRecepcion(DET, [{ detalle_id: 1, cantidad_recibida: 0 }])).toMatch(/al menos una/)
    expect(validarCantidadesRecepcion(DET, [{ detalle_id: 3, cantidad_recibida: 1 }])).toMatch(/Grapas.*solo faltan 0/)
  })
})

describe("derivarEstadoRecepcion", () => {
  it("Sin recibir / Parcial / Completa", () => {
    expect(derivarEstadoRecepcion([{ cantidad: 5, cantidad_recibida: 0 }])).toBe("Sin recibir")
    expect(derivarEstadoRecepcion(DET)).toBe("Parcial")
    expect(derivarEstadoRecepcion([{ cantidad: 5, cantidad_recibida: 5 }, { cantidad: 2, cantidad_recibida: 3 }])).toBe("Completa")
  })
})

describe("derivarEstadoPagoCompra", () => {
  it("compara contra lo debido (recibido), no contra lo ordenado", () => {
    expect(derivarEstadoPagoCompra(1000, 0)).toBe("Pendiente")
    expect(derivarEstadoPagoCompra(1000, 400)).toBe("Parcial")
    expect(derivarEstadoPagoCompra(1000, 1000)).toBe("Pagado")
    expect(derivarEstadoPagoCompra(0, 500)).toBe("Parcial") // anticipo sin recepción aún
  })
})

describe("costoFinalPonderado y prorrateo por recepción", () => {
  it("pondera el costo de la línea entre recepciones con costos distintos", () => {
    expect(costoFinalPonderado(4, 10, 6, 12)).toBe(11.2)
    expect(costoFinalPonderado(0, 0, 5, 9)).toBe(9)
    expect(costoFinalPonderado(0, 0, 0, 7)).toBe(7)
  })

  it("dos recepciones parciales con costos extra distintos producen costos finales distintos", () => {
    // OC: 10 unidades de A a $10 y 10 de B a $20 (USD, tasa 25).
    const lineasOC = [
      { id: 1, compra_id: 1, producto_id: 1, cantidad: 10, costo_unitario_moneda_origen: 10 },
      { id: 2, compra_id: 1, producto_id: 2, cantidad: 10, costo_unitario_moneda_origen: 20 },
    ]
    // Recepción 1: 5 de A y 5 de B, flete L 750.
    const r1 = calcularProrrateoDetallado(lineasOC.map((l) => ({ ...l, cantidad: 5 })), 750, "USD", 25)
    // Recepción 2: 5 de A y 5 de B, flete L 0.
    const r2 = calcularProrrateoDetallado(lineasOC.map((l) => ({ ...l, cantidad: 5 })), 0, "USD", 25)
    const a1 = r1.lineas[0].costo_final_unitario
    const a2 = r2.lineas[0].costo_final_unitario
    expect(a1).toBe(300) // 250 + 750 * (1250/3750) / 5 = 250 + 50
    expect(a2).toBe(250)
    expect(costoFinalPonderado(5, a1, 5, a2)).toBe(275)
    expect(r1.totalCostosAsignados).toBe(750)
  })
})

describe("fechaVencimiento", () => {
  it("suma días de crédito", () => {
    expect(fechaVencimiento("2026-09-22", 30)).toBe("2026-10-22")
    expect(fechaVencimiento("2026-12-20", 15)).toBe("2027-01-04")
    expect(fechaVencimiento("2026-09-22", -5)).toBe("2026-09-22")
  })
})
