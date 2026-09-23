import { describe, it, expect } from "vitest"
import { agruparReporte, claveDimension, totalesReporte, diasDesde, type LineaReporte } from "@/lib/services/reportes-ventas"

function linea(p: Partial<LineaReporte>): LineaReporte {
  return {
    detalle_id: 0, venta_id: 0, numero_factura: "", fecha: "2026-09-01", anulada_at: null,
    punto_facturacion_id: null, punto_codigo: null, punto_nombre: null,
    vendedor_id: null, vendedor_nombre: null, cliente_id: null, cliente_nombre: null,
    zona_id: null, zona_nombre: null, almacen_id: null, almacen_nombre: null,
    producto_id: null, producto_nombre: null, producto_codigo: null,
    categoria_id: null, categoria_nombre: null, subcategoria_id: null, subcategoria_nombre: null,
    linea_id: null, linea_nombre: null, marca_id: null, marca_nombre: null,
    cantidad: 0, venta: 0, costo: 0, utilidad: 0,
    ...p,
  }
}

const LINEAS: LineaReporte[] = [
  linea({ detalle_id: 1, venta_id: 10, vendedor_id: 1, vendedor_nombre: "Ana", linea_id: 5, linea_nombre: "Escolar", cantidad: 2, venta: 200, costo: 120, utilidad: 80, fecha: "2026-09-01" }),
  linea({ detalle_id: 2, venta_id: 10, vendedor_id: 1, vendedor_nombre: "Ana", linea_id: 6, linea_nombre: "Oficina", cantidad: 1, venta: 100, costo: 70, utilidad: 30, fecha: "2026-09-01" }),
  linea({ detalle_id: 3, venta_id: 11, vendedor_id: 2, vendedor_nombre: "Luis", linea_id: 5, linea_nombre: "Escolar", cantidad: 5, venta: 500, costo: 400, utilidad: 100, fecha: "2026-09-15" }),
  linea({ detalle_id: 4, venta_id: 12, vendedor_id: null, cantidad: 1, venta: 50, costo: 40, utilidad: 10, fecha: "2026-10-02" }),
  linea({ detalle_id: 5, venta_id: 13, vendedor_id: 2, vendedor_nombre: "Luis", cantidad: 9, venta: 900, costo: 100, utilidad: 800, fecha: "2026-09-20", anulada_at: "2026-09-21T00:00:00" }),
]

describe("agruparReporte", () => {
  it("agrupa por vendedor: suma medidas, cuenta facturas distintas, excluye anuladas y ordena por la medida", () => {
    const filas = agruparReporte(LINEAS, "vendedor", "venta")
    expect(filas.map((f) => f.etiqueta)).toEqual(["Luis", "Ana", "(Sin vendedor)"])
    const ana = filas.find((f) => f.etiqueta === "Ana")!
    expect(ana.venta).toBe(300)
    expect(ana.cantidad).toBe(3)
    expect(ana.utilidad).toBe(110)
    expect(ana.margen).toBe(36.67)
    expect(ana.facturas).toBe(1)
    const luis = filas.find((f) => f.etiqueta === "Luis")!
    expect(luis.venta).toBe(500) // la línea anulada (900) no cuenta
    expect(luis.facturas).toBe(1)
  })

  it("participación suma 100 sobre la medida elegida", () => {
    const filas = agruparReporte(LINEAS, "linea", "utilidad")
    const total = filas.reduce((a, f) => a + f.participacion, 0)
    expect(Math.round(total)).toBe(100)
    expect(filas[0].etiqueta).toBe("Escolar") // 180 de utilidad
    expect(filas[0].participacion).toBe(81.82)
  })

  it("por mes ordena cronológicamente", () => {
    const filas = agruparReporte(LINEAS, "mes", "venta")
    expect(filas.map((f) => f.clave)).toEqual(["2026-09", "2026-10"])
    expect(filas[0].venta).toBe(800)
  })

  it("margen no reparte participación (no es aditivo)", () => {
    const filas = agruparReporte(LINEAS, "vendedor", "margen")
    expect(filas.every((f) => f.participacion === 0)).toBe(true)
  })
})

describe("claveDimension", () => {
  it("punto con código muestra 'COD · Nombre'; sin dato agrupa en (Sin …)", () => {
    expect(claveDimension(linea({ punto_facturacion_id: 3, punto_codigo: "SPS", punto_nombre: "San Pedro" }), "punto")).toEqual({ clave: "3", etiqueta: "SPS · San Pedro" })
    expect(claveDimension(linea({}), "zona").etiqueta).toBe("(Sin zona)")
    expect(claveDimension(linea({ fecha: "2026-09-15" }), "dia").clave).toBe("2026-09-15")
  })
})

describe("totalesReporte / diasDesde", () => {
  it("totales globales excluyen anuladas", () => {
    const t = totalesReporte(LINEAS)
    expect(t.venta).toBe(850)
    expect(t.utilidad).toBe(220)
    expect(t.facturas).toBe(3)
    expect(t.margen).toBe(25.88)
  })

  it("diasDesde", () => {
    expect(diasDesde("2026-09-01T12:00:00", "2026-09-22")).toBe(21)
    expect(diasDesde(null, "2026-09-22")).toBeNull()
  })
})
