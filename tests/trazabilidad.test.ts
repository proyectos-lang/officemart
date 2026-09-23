import { describe, it, expect } from "vitest"
import { asignarLotesFIFO, signoMovimiento, resumirDestinos, type MovimientoTraza } from "@/lib/services/trazabilidad"

function mov(p: Partial<MovimientoTraza> & { id: number; fecha: string; tipo_movimiento: string; cantidad: number }): MovimientoTraza {
  return {
    costo_o_precio_unitario: 10,
    producto_id: 1,
    producto_nombre: "P",
    producto_codigo: null,
    almacen_id: 1,
    almacen_nombre: "Principal",
    localizacion_id: 1,
    localizacion_nombre: "General",
    referencia_id: null,
    referencia_tipo: null,
    referencia_texto: null,
    ...p,
  }
}

describe("signoMovimiento", () => {
  it("entradas positivas, salidas negativas, ajustes con su signo", () => {
    expect(signoMovimiento("Entrada Compra", 5)).toBe(5)
    expect(signoMovimiento("Ingreso Manual", -5)).toBe(5)
    expect(signoMovimiento("Salida Venta", 3)).toBe(-3)
    expect(signoMovimiento("Traslado Salida", 2)).toBe(-2)
    expect(signoMovimiento("Traslado Entrada", 2)).toBe(2)
    expect(signoMovimiento("Ajuste", -4)).toBe(-4)
    expect(signoMovimiento("Ajuste", 4)).toBe(4)
  })
})

describe("asignarLotesFIFO", () => {
  const MOVS = [
    mov({ id: 1, fecha: "2026-09-01", tipo_movimiento: "Entrada Compra", cantidad: 10, referencia_id: 100, referencia_texto: "OC-100 · Prov A" }),
    mov({ id: 2, fecha: "2026-09-05", tipo_movimiento: "Entrada Compra", cantidad: 5, referencia_id: 101, referencia_texto: "OC-101 · Prov B" }),
    mov({ id: 3, fecha: "2026-09-06", tipo_movimiento: "Salida Venta", cantidad: -8, referencia_texto: "FC-0001 · Cliente X" }),
    mov({ id: 4, fecha: "2026-09-07", tipo_movimiento: "Salida Venta", cantidad: -4, referencia_texto: "FC-0002 · Cliente Y" }),
    mov({ id: 5, fecha: "2026-09-08", tipo_movimiento: "Traslado Salida", cantidad: -2, referencia_texto: "Traslado #7" }),
  ]

  it("consume los lotes en orden de fecha y reparte una salida entre lotes", () => {
    const { lotes, sinLote } = asignarLotesFIFO([...MOVS].reverse())
    expect(sinLote).toEqual([])
    expect(lotes.map((l) => l.referencia_texto)).toEqual(["OC-100 · Prov A", "OC-101 · Prov B"])
    const [a, b] = lotes
    expect(a.restante).toBe(0)
    expect(a.destinos.map((d) => [d.referencia_texto, d.cantidad])).toEqual([
      ["FC-0001 · Cliente X", 8],
      ["FC-0002 · Cliente Y", 2],
    ])
    expect(b.restante).toBe(1)
    expect(b.destinos.map((d) => [d.referencia_texto, d.cantidad])).toEqual([
      ["FC-0002 · Cliente Y", 2],
      ["Traslado #7", 2],
    ])
  })

  it("salidas sin lote previo (stock anterior al kardex) quedan en sinLote", () => {
    const { lotes, sinLote } = asignarLotesFIFO([
      mov({ id: 1, fecha: "2026-09-01", tipo_movimiento: "Salida Venta", cantidad: -3, referencia_texto: "FC-0009" }),
      mov({ id: 2, fecha: "2026-09-02", tipo_movimiento: "Entrada Compra", cantidad: 2 }),
    ])
    expect(sinLote).toEqual([{ movimiento_id: 1, fecha: "2026-09-01", tipo_movimiento: "Salida Venta", referencia_texto: "FC-0009", cantidad: 3 }])
    expect(lotes[0].restante).toBe(2)
  })

  it("no cruza almacenes: una salida en otro almacén no consume el lote", () => {
    const { lotes, sinLote } = asignarLotesFIFO([
      mov({ id: 1, fecha: "2026-09-01", tipo_movimiento: "Entrada Compra", cantidad: 5, almacen_id: 1 }),
      mov({ id: 2, fecha: "2026-09-02", tipo_movimiento: "Salida Venta", cantidad: -1, almacen_id: 2 }),
    ])
    expect(lotes[0].restante).toBe(5)
    expect(sinLote).toHaveLength(1)
  })

  it("un traslado entrante crea un lote nuevo en el destino", () => {
    const { lotes } = asignarLotesFIFO([
      mov({ id: 1, fecha: "2026-09-01", tipo_movimiento: "Entrada Compra", cantidad: 5, almacen_id: 1 }),
      mov({ id: 2, fecha: "2026-09-02", tipo_movimiento: "Traslado Salida", cantidad: -2, almacen_id: 1, referencia_texto: "Traslado #1" }),
      mov({ id: 3, fecha: "2026-09-02", tipo_movimiento: "Traslado Entrada", cantidad: 2, almacen_id: 2, referencia_texto: "Traslado #1" }),
      mov({ id: 4, fecha: "2026-09-03", tipo_movimiento: "Salida Venta", cantidad: -1, almacen_id: 2, referencia_texto: "FC-0003" }),
    ])
    expect(lotes).toHaveLength(2)
    expect(lotes[0].restante).toBe(3)
    expect(lotes[1].almacen_id).toBe(2)
    expect(lotes[1].destinos[0].referencia_texto).toBe("FC-0003")
  })
})

describe("resumirDestinos", () => {
  it("agrupa por tipo y junta documentos", () => {
    const r = resumirDestinos([
      { movimiento_id: 1, fecha: "", tipo_movimiento: "Salida Venta", referencia_texto: "FC-1", cantidad: 2 },
      { movimiento_id: 2, fecha: "", tipo_movimiento: "Salida Venta", referencia_texto: "FC-2", cantidad: 3 },
      { movimiento_id: 3, fecha: "", tipo_movimiento: "Traslado Salida", referencia_texto: null, cantidad: 1 },
    ])
    expect(r).toEqual([
      { tipo: "Salida Venta", cantidad: 5, documentos: ["FC-1", "FC-2"] },
      { tipo: "Traslado Salida", cantidad: 1, documentos: [] },
    ])
  })
})
