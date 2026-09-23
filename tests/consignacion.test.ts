import { describe, it, expect } from "vitest"
import { agruparConsignacion, separarValoracion, type VentaConsignada } from "@/lib/services/consignacion"

const LOCS = [
  { localizacion_id: 10, localizacion_nombre: "Vitrina Prov A", propietario_proveedor_id: 1, propietario_nombre: "Prov A" },
  { localizacion_id: 11, localizacion_nombre: "Estante Prov B", propietario_proveedor_id: 2, propietario_nombre: "Prov B" },
  { localizacion_id: 12, localizacion_nombre: "Sin dueño", propietario_proveedor_id: null, propietario_nombre: null },
]
const M = (p: Partial<VentaConsignada> & { transaccion_id: number; localizacion_id: number; monto: number }): VentaConsignada => ({
  venta_id: 1, numero_factura: "FC-1", fecha: "2026-09-10", producto_id: 5, producto_nombre: "P", cantidad: 1, costo_pactado: p.monto, ...p,
})

describe("agruparConsignacion", () => {
  it("agrupa por proveedor+localización, excluye liquidados y sin propietario, ordena por total", () => {
    const g = agruparConsignacion(
      [
        M({ transaccion_id: 1, localizacion_id: 10, monto: 100, fecha: "2026-09-12" }),
        M({ transaccion_id: 2, localizacion_id: 10, monto: 50, fecha: "2026-09-01" }),
        M({ transaccion_id: 3, localizacion_id: 11, monto: 300 }),
        M({ transaccion_id: 4, localizacion_id: 12, monto: 999 }),
        M({ transaccion_id: 5, localizacion_id: 11, monto: 10 }),
      ],
      LOCS,
      new Set([5])
    )
    expect(g).toHaveLength(2)
    expect(g[0].proveedor_nombre).toBe("Prov B")
    expect(g[0].total).toBe(300)
    expect(g[1].total).toBe(150)
    expect(g[1].items.map((i) => i.transaccion_id)).toEqual([2, 1]) // por fecha
  })
})

describe("separarValoracion", () => {
  it("separa propio y consignado por localización", () => {
    const r = separarValoracion(
      [
        { producto_id: 1, localizacion_id: 10, stock_actual: 5 },
        { producto_id: 1, localizacion_id: 1, stock_actual: 2 },
        { producto_id: 2, localizacion_id: 11, stock_actual: 3 },
      ],
      new Map([[1, 10], [2, 20]]),
      new Set([10, 11])
    )
    expect(r).toEqual({ propio: 20, consignado: 110, unidadesConsignadas: 8 })
  })
})
