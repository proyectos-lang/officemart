import { describe, it, expect } from "vitest"
import { recalcularCadena, validarFechaMovimiento, type MovimientoCadena } from "@/lib/services/cuentas"

function mov(id: number, fecha: string, tipo: "Ingreso" | "Egreso", monto: number, saldo?: number): MovimientoCadena {
  return { id, fecha, tipo, monto, saldo_resultante: saldo }
}

describe("recalcularCadena", () => {
  it("acumula Ingresos - Egresos en orden cronológico y devuelve el saldo final", () => {
    const r = recalcularCadena([
      mov(1, "2026-09-01T12:00:00.000Z", "Ingreso", 1000, 1000),
      mov(2, "2026-09-02T12:00:00.000Z", "Egreso", 250, 750),
      mov(3, "2026-09-03T12:00:00.000Z", "Ingreso", 50.5, 800.5),
    ])
    expect(r.saldoFinal).toBe(800.5)
    // Todos los saldos guardados ya eran correctos: nada que reescribir.
    expect(r.cambios).toEqual([])
  })

  it("ordena por (fecha, id): un movimiento con fecha pasada insertado al final reescribe los posteriores", () => {
    // Se insertó el id 3 (fecha 1-sep) después del 1 y 2: su saldo guardado
    // (cache + delta = 750 - 100) no es el cronológico y arrastra a los demás.
    const r = recalcularCadena([
      mov(1, "2026-09-02T12:00:00.000Z", "Ingreso", 1000, 1000),
      mov(2, "2026-09-03T12:00:00.000Z", "Egreso", 250, 750),
      mov(3, "2026-09-01T12:00:00.000Z", "Egreso", 100, 650),
    ])
    expect(r.saldoFinal).toBe(650)
    expect(r.cambios).toEqual([
      { id: 3, saldo_resultante: -100 },
      { id: 1, saldo_resultante: 900 },
      { id: 2, saldo_resultante: 650 },
    ])
  })

  it("desempata por id cuando la fecha coincide", () => {
    const r = recalcularCadena([
      mov(7, "2026-09-05T12:00:00.000Z", "Egreso", 30),
      mov(5, "2026-09-05T12:00:00.000Z", "Ingreso", 100),
    ])
    expect(r.cambios).toEqual([
      { id: 5, saldo_resultante: 100 },
      { id: 7, saldo_resultante: 70 },
    ])
  })

  it("solo devuelve las filas desfasadas y redondea a 2 decimales", () => {
    const r = recalcularCadena([
      mov(1, "2026-09-01T12:00:00.000Z", "Ingreso", 10.005, 10.01),
      mov(2, "2026-09-02T12:00:00.000Z", "Ingreso", 0.1, 999),
    ])
    expect(r.cambios).toEqual([{ id: 2, saldo_resultante: 10.11 }])
    expect(r.saldoFinal).toBe(10.11)
  })

  it("lista vacía → saldo 0 sin cambios", () => {
    expect(recalcularCadena([])).toEqual({ cambios: [], saldoFinal: 0 })
  })
})

describe("validarFechaMovimiento", () => {
  const ahora = "2026-09-22T15:00:00.000Z"

  it("acepta fechas pasadas y la actual", () => {
    expect(validarFechaMovimiento("2026-09-01T12:00:00.000Z", ahora)).toBeNull()
    expect(validarFechaMovimiento(ahora, ahora)).toBeNull()
  })

  it("rechaza fechas futuras (más de 1 minuto de tolerancia) e inválidas", () => {
    expect(validarFechaMovimiento("2026-09-22T15:00:30.000Z", ahora)).toBeNull()
    expect(validarFechaMovimiento("2026-09-23T15:00:00.000Z", ahora)).toMatch(/futura/)
    expect(validarFechaMovimiento("no-es-fecha", ahora)).toMatch(/no es válida/)
  })
})
