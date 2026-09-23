import { describe, it, expect } from "vitest"
import { formatearCorrelativo, SERIES } from "@/lib/services/correlativos"

describe("formatearCorrelativo", () => {
  it("rellena con ceros a la izquierda al ancho pedido (mismo formato que el RPC)", () => {
    expect(formatearCorrelativo("RC-", 7)).toBe("RC-0007")
    expect(formatearCorrelativo("COT-", 123, 4)).toBe("COT-0123")
    expect(formatearCorrelativo("", 5, 8)).toBe("00000005")
  })

  it("no recorta números más largos que el ancho", () => {
    expect(formatearCorrelativo("DEV-", 123456, 4)).toBe("DEV-123456")
  })

  it("normaliza entradas raras: decimales, negativos, pad 0", () => {
    expect(formatearCorrelativo("OT-", 3.9)).toBe("OT-0003")
    expect(formatearCorrelativo("OT-", -2)).toBe("OT-0000")
    expect(formatearCorrelativo("X", 4, 0)).toBe("X4")
  })

  it("las series conocidas están definidas", () => {
    expect(SERIES.DEVOLUCION).toBe("DEV")
    expect(SERIES.PEDIDO).toBe("PED")
    expect(SERIES.RECIBO).toBe("RC")
  })
})
