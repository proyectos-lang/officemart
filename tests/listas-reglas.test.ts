import { describe, it, expect } from "vitest"
import {
  calcularPrecioLista,
  reglaAplicable,
  type ListaAplicada,
  type ListaPrecioRegla,
} from "@/lib/services/listas-precios"

const REGLAS: ListaPrecioRegla[] = [
  { lista_id: 1, dimension: "categoria", ref_id: 10, porcentaje: 10 },
  { lista_id: 1, dimension: "subcategoria", ref_id: 55, porcentaje: 20 },
  { lista_id: 1, dimension: "linea", ref_id: 7, porcentaje: 5 },
]

const PORCENTAJE: ListaAplicada = {
  lista: { id: 1, nombre: "Mayoristas", tipo: "porcentaje", porcentaje: 3, activo: true },
  detalle: {},
  reglas: REGLAS,
}

const INDIVIDUAL: ListaAplicada = {
  lista: { id: 2, nombre: "VIP", tipo: "individual", porcentaje: 0, activo: true },
  detalle: { 100: 80 },
  reglas: REGLAS,
}

describe("reglaAplicable (precedencia subcategoría > categoría > línea)", () => {
  it("la subcategoría gana a la categoría y a la línea", () => {
    const r = reglaAplicable(REGLAS, { categoria_id: 10, subcategoria_id: 55, linea_id: 7 })
    expect(r?.dimension).toBe("subcategoria")
    expect(r?.porcentaje).toBe(20)
  })

  it("sin regla de subcategoría, aplica la categoría; sin categoría, la línea", () => {
    expect(reglaAplicable(REGLAS, { categoria_id: 10, subcategoria_id: 99, linea_id: 7 })?.dimension).toBe("categoria")
    expect(reglaAplicable(REGLAS, { categoria_id: 11, subcategoria_id: null, linea_id: 7 })?.dimension).toBe("linea")
  })

  it("devuelve null si ninguna dimensión coincide o no hay reglas", () => {
    expect(reglaAplicable(REGLAS, { categoria_id: 1, subcategoria_id: 2, linea_id: 3 })).toBeNull()
    expect(reglaAplicable([], { categoria_id: 10 })).toBeNull()
    expect(reglaAplicable(undefined, { categoria_id: 10 })).toBeNull()
    expect(reglaAplicable(REGLAS, null)).toBeNull()
  })
})

describe("calcularPrecioLista con reglas", () => {
  it("lista porcentaje: regla de categoría antes que el % general", () => {
    expect(calcularPrecioLista(100, PORCENTAJE, { id: 1, categoria_id: 10 })).toBe(90)
    // Sin regla aplicable cae al 3 % general.
    expect(calcularPrecioLista(100, PORCENTAJE, { id: 1, categoria_id: 99 })).toBe(97)
  })

  it("lista porcentaje: subcategoría > categoría > línea", () => {
    expect(calcularPrecioLista(100, PORCENTAJE, { id: 1, categoria_id: 10, subcategoria_id: 55, linea_id: 7 })).toBe(80)
    expect(calcularPrecioLista(100, PORCENTAJE, { id: 1, categoria_id: 10, linea_id: 7 })).toBe(90)
    expect(calcularPrecioLista(100, PORCENTAJE, { id: 1, linea_id: 7 })).toBe(95)
  })

  it("lista individual: el precio del producto gana a cualquier regla", () => {
    expect(calcularPrecioLista(100, INDIVIDUAL, { id: 100, categoria_id: 10, subcategoria_id: 55 })).toBe(80)
  })

  it("lista individual sin precio propio: aplica la regla; sin regla, el precio del maestro", () => {
    expect(calcularPrecioLista(100, INDIVIDUAL, { id: 101, categoria_id: 10 })).toBe(90)
    expect(calcularPrecioLista(100, INDIVIDUAL, { id: 101, categoria_id: 1 })).toBe(100)
  })

  it("compatibilidad: pasar solo el id sigue funcionando (sin dimensiones no aplican reglas)", () => {
    expect(calcularPrecioLista(100, INDIVIDUAL, 100)).toBe(80)
    expect(calcularPrecioLista(100, INDIVIDUAL, 101)).toBe(100)
    expect(calcularPrecioLista(100, PORCENTAJE, 5)).toBe(97)
    expect(calcularPrecioLista(100, null, 5)).toBe(100)
  })

  it("redondea a 2 decimales y el porcentaje siempre descuenta", () => {
    const lista: ListaAplicada = {
      lista: { id: 3, nombre: "X", tipo: "porcentaje", porcentaje: 0, activo: true },
      detalle: {},
      reglas: [{ lista_id: 3, dimension: "linea", ref_id: 1, porcentaje: 12.5 }],
    }
    expect(calcularPrecioLista(19.99, lista, { id: 1, linea_id: 1 })).toBe(17.49)
  })
})
