import { describe, it, expect } from "vitest"
import { calcularSugerido, calcularCobertura, estadoReposicion } from "@/lib/services/reposicion"
import { calcularEstadisticasOC, construirEstadoCuentaProveedor } from "@/lib/services/reportes-compras"

describe("calcularCobertura / calcularSugerido", () => {
  it("cobertura = stock / venta diaria; null sin ventas", () => {
    expect(calcularCobertura(30, 1.5)).toBe(20)
    expect(calcularCobertura(30, 0)).toBeNull()
  })

  it("no sugiere si está por encima del punto de reorden y con cobertura suficiente", () => {
    expect(calcularSugerido({ stock: 100, stock_minimo: 10, punto_reorden: 20, venta_diaria: 1, lead_time_dias: 10 })).toBe(0)
  })

  it("sugiere llegar al objetivo (punto de reorden / demanda del lead time + 7 días)", () => {
    // stock 5 ≤ reorden 20 → objetivo max(20, 2×(10+7)=34, 10×2=20) = 34 → 34 − 5 = 29
    expect(calcularSugerido({ stock: 5, stock_minimo: 10, punto_reorden: 20, venta_diaria: 2, lead_time_dias: 10 })).toBe(29)
  })

  it("descuenta lo en tránsito y redondea al lote fijo", () => {
    expect(calcularSugerido({ stock: 5, en_transito: 10, stock_minimo: 10, punto_reorden: 20, venta_diaria: 2, lead_time_dias: 10 })).toBe(19)
    expect(calcularSugerido({ stock: 5, stock_minimo: 10, punto_reorden: 20, cantidad_sugerida: 12, venta_diaria: 2, lead_time_dias: 10 })).toBe(36)
  })

  it("sin mínimos configurados, sugiere solo si la cobertura no alcanza el lead time", () => {
    expect(calcularSugerido({ stock: 5, stock_minimo: 0, punto_reorden: 0, venta_diaria: 1, lead_time_dias: 10 })).toBe(12)
    expect(calcularSugerido({ stock: 50, stock_minimo: 0, punto_reorden: 0, venta_diaria: 1, lead_time_dias: 10 })).toBe(0)
    expect(calcularSugerido({ stock: 0, stock_minimo: 0, punto_reorden: 0, venta_diaria: 0, lead_time_dias: null })).toBe(0)
  })

  it("estadoReposicion", () => {
    expect(estadoReposicion({ stock: 0, stock_minimo: 5, punto_reorden: 10, sugerido: 10 })).toBe("Sin stock")
    expect(estadoReposicion({ stock: 4, stock_minimo: 5, punto_reorden: 10, sugerido: 10 })).toBe("Bajo mínimo")
    expect(estadoReposicion({ stock: 8, stock_minimo: 5, punto_reorden: 10, sugerido: 10 })).toBe("Reordenar")
    expect(estadoReposicion({ stock: 50, stock_minimo: 5, punto_reorden: 10, sugerido: 0 })).toBe("OK")
  })
})

describe("calcularEstadisticasOC", () => {
  const compras = [
    { id: 1, proveedor_id: 7, proveedor_nombre: "Prov A", numero_factura: null, fecha_orden: "2026-09-01T10:00:00", fecha_tentativa: "2026-09-05", estado: "Pendiente", moneda: "USD", tasa_cambio: 25, total_compra_local: 0 },
    { id: 2, proveedor_id: 7, proveedor_nombre: "Prov A", numero_factura: "F-9", fecha_orden: "2026-08-01T10:00:00", fecha_tentativa: "2026-08-10", estado: "Recibida", moneda: "LPS", tasa_cambio: 1, total_compra_local: 500 },
  ]
  const detalles = [
    { compra_id: 1, producto_id: 10, producto_nombre: "A", cantidad: 10, cantidad_recibida: 4, costo_unitario_moneda_origen: 10, costo_final_local: 0 },
    { compra_id: 2, producto_id: 10, producto_nombre: "A", cantidad: 5, cantidad_recibida: 5, costo_unitario_moneda_origen: 100, costo_final_local: 100 },
  ]
  const recepciones = [{ compra_id: 1, fecha: "2026-09-08T09:00:00", total_local: 1000 }]

  it("cumplimiento, en tránsito, lead time y retraso por OC", () => {
    const e = calcularEstadisticasOC(compras, detalles, recepciones)
    const oc1 = e.ordenes.find((o) => o.compra_id === 1)!
    expect(oc1.cumplimiento).toBe(40)
    expect(oc1.valor_ordenado_local).toBe(2500)
    expect(oc1.valor_recibido_local).toBe(1000)
    expect(oc1.en_transito_local).toBe(1500)
    expect(oc1.lead_time_dias).toBe(7)
    expect(oc1.retraso_dias).toBe(3)
    const oc2 = e.ordenes.find((o) => o.compra_id === 2)!
    expect(oc2.cumplimiento).toBe(100)
    expect(oc2.valor_recibido_local).toBe(500) // OC clásica: total_compra_local
    expect(oc2.lead_time_dias).toBeNull()
  })

  it("agrega por proveedor y top productos", () => {
    const e = calcularEstadisticasOC(compras, detalles, recepciones)
    expect(e.porProveedor).toHaveLength(1)
    expect(e.porProveedor[0].ordenes).toBe(2)
    expect(e.porProveedor[0].valor_ordenado).toBe(3000)
    expect(e.porProveedor[0].ordenes_tarde).toBe(1)
    expect(e.porProveedor[0].lead_time_promedio).toBe(7)
    expect(e.topProductos[0]).toMatchObject({ producto_id: 10, unidades: 15, valor_local: 3000, ordenes: 2, costo_promedio_compra: 200 })
    expect(e.totales.en_transito).toBe(1500)
    expect(e.totales.ordenes_tarde).toBe(1)
  })
})

describe("construirEstadoCuentaProveedor", () => {
  it("saldo corrido con rango: lo anterior va al saldo inicial", () => {
    const ec = construirEstadoCuentaProveedor(
      [
        { fecha: "2026-08-01", tipo: "Compra", documento: "OC-1", referencia: null, debito: 1000, credito: 0 },
        { fecha: "2026-08-15", tipo: "Pago", documento: "Abono OC-1", referencia: "Banco", debito: 0, credito: 400 },
        { fecha: "2026-09-10", tipo: "Gasto", documento: "Gasto #3", referencia: null, debito: 200, credito: 0 },
      ],
      [],
      "2026-09-01",
      "2026-09-30"
    )
    expect(ec.saldoInicial).toBe(600)
    expect(ec.movimientos).toHaveLength(1)
    expect(ec.saldoFinal).toBe(800)
    expect(ec.totalDebitos).toBe(200)
  })

  it("mismo día: el débito va antes que el crédito", () => {
    const ec = construirEstadoCuentaProveedor(
      [
        { fecha: "2026-09-10", tipo: "Pago", documento: "P", referencia: null, debito: 0, credito: 50 },
        { fecha: "2026-09-10", tipo: "Compra", documento: "C", referencia: null, debito: 100, credito: 0 },
      ],
      []
    )
    expect(ec.movimientos.map((m) => m.documento)).toEqual(["C", "P"])
    expect(ec.movimientos.map((m) => m.saldo)).toEqual([100, 50])
  })
})
