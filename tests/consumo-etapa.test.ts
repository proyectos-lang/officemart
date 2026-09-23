import { describe, it, expect } from "vitest"
import { validarStockConsumo, calcularCostoConsumos, costoRealOrden } from "@/lib/services/produccion-consumos"
import { codigoOrden, etiquetaOrden } from "@/lib/services/produccion-ordenes"

describe("codigoOrden / etiquetaOrden", () => {
  it("OP para producción y OT para trabajo", () => {
    expect(codigoOrden(7)).toBe("OP-0007")
    expect(codigoOrden(7, "Trabajo")).toBe("OT-0007")
    expect(codigoOrden(12345, null)).toBe("OP-12345")
  })

  it("la etiqueta de una OT es su descripción; la de una OP, el producto", () => {
    expect(etiquetaOrden({ tipo: "Trabajo", descripcion: "Rotulación local Lettra", producto_nombre: "" })).toBe("Rotulación local Lettra")
    expect(etiquetaOrden({ tipo: null, descripcion: null, producto_nombre: "Cuaderno A4" })).toBe("Cuaderno A4")
    expect(etiquetaOrden({ tipo: "Trabajo", descripcion: "", producto_nombre: "" })).toBe("Orden de trabajo")
  })
})

describe("validarStockConsumo", () => {
  const stocks = new Map([
    ["material:1", { nombre: "Tinta", stock: 10 }],
    ["producto:5", { nombre: "Papel bond", stock: 3 }],
  ])

  it("acepta cantidades dentro del stock (sumando repetidos)", () => {
    expect(validarStockConsumo([{ tipo_item: "material", material_id: 1, cantidad: 4 }, { tipo_item: "material", material_id: 1, cantidad: 6 }], stocks)).toBeNull()
  })

  it("rechaza faltantes, productos sin ubicación, items inexistentes y listas vacías", () => {
    expect(validarStockConsumo([{ tipo_item: "material", material_id: 1, cantidad: 11 }], stocks)).toMatch(/Tinta.*hay 10.*pides 11/)
    expect(validarStockConsumo([{ tipo_item: "producto", producto_id: 5, cantidad: 1 }], stocks)).toMatch(/almacén y localización/)
    expect(validarStockConsumo([{ tipo_item: "producto", producto_id: 5, cantidad: 1, almacen_id: 1, localizacion_id: 1 }], stocks)).toBeNull()
    expect(validarStockConsumo([{ tipo_item: "material", material_id: 99, cantidad: 1 }], stocks)).toMatch(/no existe/)
    expect(validarStockConsumo([{ tipo_item: "material", material_id: 1, cantidad: 0 }], stocks)).toMatch(/al menos/)
  })
})

describe("calcularCostoConsumos / costoRealOrden", () => {
  it("costo por línea y total con 2 decimales", () => {
    const r = calcularCostoConsumos([{ cantidad: 3, costo_unitario: 1.333 }, { cantidad: 2, costo_unitario: 10 }])
    expect(r.lineas[0].costo_total).toBe(4)
    expect(r.total).toBe(24)
  })

  it("suma consumos vigentes, corridas ejecutadas y mano de obra", () => {
    const c = costoRealOrden({
      consumos: [{ costo_total: 100 }, { costo_total: 50, anulado_at: "2026-09-22" }],
      corridas: [{ costo_materiales_total: 30, costo_factores_total: 20, estado: "Ejecutada" }, { costo_materiales_total: 99, costo_factores_total: 1, estado: "Registrada" }],
      manoObraEtapas: [10, null, 5.5],
    })
    expect(c).toEqual({ materiales: 100, corridas: 50, manoObra: 15.5, total: 165.5 })
  })
})
