import { describe, it, expect } from "vitest"
import { calcularResumenToma, mapearConteosImportados, esErrorInventarioCongelado, traducirErrorInventario, INVENTARIO_CONGELADO_MSG } from "@/lib/services/toma-fisica"

describe("calcularResumenToma", () => {
  it("cuenta contadas, sin contar, faltantes y sobrantes valorados", () => {
    const r = calcularResumenToma([
      { stock_sistema: 10, conteo: 8, costo_unitario: 5 },   // faltan 2 → 10
      { stock_sistema: 3, conteo: 5, costo_unitario: 2 },    // sobran 2 → 4
      { stock_sistema: 7, conteo: 7, costo_unitario: 100 },  // igual
      { stock_sistema: 1, conteo: null, costo_unitario: 9 }, // sin contar
    ])
    expect(r).toEqual({ lineas: 4, contadas: 3, sinContar: 1, conDiferencia: 2, faltanteUnidades: 2, sobranteUnidades: 2, faltanteValor: 10, sobranteValor: 4, netoValor: -6 })
  })
})

describe("mapearConteosImportados", () => {
  const det = [
    { id: 1, producto_codigo: "A1", producto_nombre: "Papel", localizacion_nombre: "General" },
    { id: 2, producto_codigo: "A1", producto_nombre: "Papel", localizacion_nombre: "Bodega" },
    { id: 3, producto_codigo: null, producto_nombre: "Tinta Negra", localizacion_nombre: "General" },
  ]

  it("empareja por código + localización, o por nombre si no hay código", () => {
    const r = mapearConteosImportados(
      [
        { codigo: "a1", localizacion: "bodega", conteo: 4 },
        { producto: "tinta negra", conteo: 2 },
        { codigo: "A1", conteo: 9 }, // ambiguo: dos localizaciones
        { codigo: "ZZ", conteo: 1 }, // no existe
        { codigo: "A1", localizacion: "General", conteo: null },
      ],
      det
    )
    expect(r.actualizaciones).toEqual([{ detalle_id: 2, conteo: 4 }, { detalle_id: 3, conteo: 2 }])
    expect(r.noReconocidas).toBe(2)
    expect(r.sinConteo).toBe(1)
  })
})

describe("candado de inventario", () => {
  it("reconoce y traduce el error del trigger/RPC", () => {
    expect(esErrorInventarioCongelado("ERROR: INVENTARIO_CONGELADO: el almacen 2 ...")).toBe(true)
    expect(esErrorInventarioCongelado("otro error")).toBe(false)
    expect(traducirErrorInventario("INVENTARIO_CONGELADO: x")).toBe(INVENTARIO_CONGELADO_MSG)
    expect(traducirErrorInventario("otro")).toBe("otro")
  })
})
