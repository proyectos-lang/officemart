import { describe, it, expect } from "vitest"
import { bloqueoCreditoCliente, contarFacturasVencidas } from "@/lib/services/ventas"
import { resolverVendedorPorDefecto } from "@/lib/services/vendedores"

describe("bloqueoCreditoCliente", () => {
  it("sin bloqueo manual ni mora -> null (puede comprar a crédito)", () => {
    expect(bloqueoCreditoCliente({})).toBeNull()
    expect(bloqueoCreditoCliente({ bloqueado: false, diasCredito: 30, facturasVencidas: 0 })).toBeNull()
  })

  it("bloqueo manual gana siempre e incluye el motivo", () => {
    expect(bloqueoCreditoCliente({ bloqueado: true })).toMatch(/bloqueado para crédito/i)
    expect(bloqueoCreditoCliente({ bloqueado: true, motivoBloqueo: "Cheque devuelto" })).toContain("Cheque devuelto")
  })

  it("mora: solo bloquea si hay plazo (> 0) y facturas vencidas", () => {
    // Sin plazo definido, las facturas viejas no bloquean.
    expect(bloqueoCreditoCliente({ diasCredito: 0, facturasVencidas: 3 })).toBeNull()
    expect(bloqueoCreditoCliente({ diasCredito: null, facturasVencidas: 3 })).toBeNull()
    // Con plazo y vencidas, bloquea y describe.
    const msg = bloqueoCreditoCliente({ diasCredito: 30, facturasVencidas: 2, diasMaxVencido: 12 })
    expect(msg).toMatch(/2 facturas vencidas/)
    expect(msg).toContain("12 días")
    expect(bloqueoCreditoCliente({ diasCredito: 30, facturasVencidas: 1 })).toMatch(/1 factura vencida/)
  })
})

describe("contarFacturasVencidas", () => {
  const hoy = "2026-09-22T12:00:00.000Z"

  it("cuenta las facturas con saldo cuya antigüedad supera el plazo y el máximo de días sobre el plazo", () => {
    const r = contarFacturasVencidas(
      [
        { fecha_venta: "2026-07-01T12:00:00.000Z", total_venta: 100, valorpago: 0 }, // 83 días, vencida 53
        { fecha_venta: "2026-08-30T12:00:00.000Z", total_venta: 100, valorpago: 0 }, // 23 días, al día
        { fecha_venta: "2026-08-10T12:00:00.000Z", total_venta: 100, valorpago: 100 }, // pagada: no cuenta
        { fecha_venta: "2026-08-01T12:00:00.000Z", total_venta: 100, valorpago: 50 }, // 52 días, vencida 22
      ],
      30,
      hoy
    )
    expect(r).toEqual({ vencidas: 2, diasMaxVencido: 53 })
  })

  it("justo en el plazo no está vencida", () => {
    const r = contarFacturasVencidas([{ fecha_venta: "2026-08-23T12:00:00.000Z", total_venta: 10, valorpago: 0 }], 30, hoy)
    expect(r.vencidas).toBe(0)
  })

  it("sin ventas -> 0/0", () => {
    expect(contarFacturasVencidas([], 30, hoy)).toEqual({ vencidas: 0, diasMaxVencido: 0 })
  })
})

describe("resolverVendedorPorDefecto", () => {
  it("respeta el vendedor ya elegido", () => {
    expect(resolverVendedorPorDefecto({ actual: 9, vendedorUsuarioId: 1, vendedorClienteId: 2 })).toBe(9)
  })
  it("prefiere el vendedor del usuario sobre el del cliente", () => {
    expect(resolverVendedorPorDefecto({ vendedorUsuarioId: 1, vendedorClienteId: 2 })).toBe(1)
  })
  it("cae al vendedor del cliente y luego a ninguno", () => {
    expect(resolverVendedorPorDefecto({ vendedorClienteId: 2 })).toBe(2)
    expect(resolverVendedorPorDefecto({})).toBeNull()
    expect(resolverVendedorPorDefecto({ actual: null, vendedorUsuarioId: null, vendedorClienteId: null })).toBeNull()
  })
})
