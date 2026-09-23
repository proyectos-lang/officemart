import { describe, it, expect } from "vitest"
import {
  detectarColumnas, parsearFechaExtracto, parsearMontoExtracto, normalizarLineas, detectarDuplicadas,
  emparejarMovimientos, calcularSaldoLibro, resumenConciliacion, type MovimientoLibro,
} from "@/lib/services/conciliacion-bancaria"

describe("detectarColumnas", () => {
  it("reconoce encabezados típicos de bancos hondureños (con tildes y variantes)", () => {
    const m = detectarColumnas(["Fecha", "Descripción", "No. Referencia", "Débitos", "Créditos", "Saldo"])
    expect(m).toEqual({ fecha: "Fecha", descripcion: "Descripción", referencia: "No. Referencia", debito: "Débitos", credito: "Créditos", saldo: "Saldo" })
  })
  it("una sola columna de monto", () => {
    const m = detectarColumnas(["FECHA TRANSACCION", "DETALLE", "IMPORTE", "BALANCE"])
    expect(m.fecha).toBe("FECHA TRANSACCION")
    expect(m.descripcion).toBe("DETALLE")
    expect(m.monto).toBe("IMPORTE")
    expect(m.saldo).toBe("BALANCE")
    expect(m.debito).toBeUndefined()
  })
})

describe("parsearFechaExtracto / parsearMontoExtracto", () => {
  it("fechas: serial Excel, DD/MM/YYYY, YYYY-MM-DD, DD/MM/YY y MM/DD forzado", () => {
    expect(parsearFechaExtracto(46287)).toBe("2026-09-22")
    expect(parsearFechaExtracto("22/09/2026")).toBe("2026-09-22")
    expect(parsearFechaExtracto("2026-09-22T00:00:00")).toBe("2026-09-22")
    expect(parsearFechaExtracto("05-01-26")).toBe("2026-01-05")
    expect(parsearFechaExtracto("09/22/2026")).toBe("2026-09-22") // 22 > 12 → MM/DD
    expect(parsearFechaExtracto("05/01/2026", "MM/DD/YYYY")).toBe("2026-05-01")
    expect(parsearFechaExtracto("hola")).toBeNull()
    expect(parsearFechaExtracto("")).toBeNull()
  })
  it("montos: miles, paréntesis, signo, moneda y formato europeo", () => {
    expect(parsearMontoExtracto("1,234.56")).toBe(1234.56)
    expect(parsearMontoExtracto("(123.45)")).toBe(-123.45)
    expect(parsearMontoExtracto("-1,000")).toBe(-1000)
    expect(parsearMontoExtracto("L 2,500.00")).toBe(2500)
    expect(parsearMontoExtracto("1.234,56")).toBe(1234.56)
    expect(parsearMontoExtracto(99.9)).toBe(99.9)
    expect(parsearMontoExtracto("")).toBeNull()
  })
})

describe("normalizarLineas / detectarDuplicadas", () => {
  const mapeo = { fecha: "Fecha", descripcion: "Desc", referencia: "Ref", debito: "Deb", credito: "Cre", saldo: "Saldo" }
  it("crédito − débito con signo, omite filas sin fecha o monto, saldo opcional", () => {
    const { lineas, omitidas } = normalizarLineas(
      [
        { Fecha: "01/09/2026", Desc: "Depósito", Ref: "123", Deb: "", Cre: "500.00", Saldo: "1,500.00" },
        { Fecha: "02/09/2026", Desc: "Comisión", Ref: "", Deb: "25.00", Cre: "", Saldo: "1,475.00" },
        { Fecha: "", Desc: "Saldo inicial", Ref: "", Deb: "", Cre: "", Saldo: "1,000.00" },
        { Fecha: "03/09/2026", Desc: "Nada", Ref: "", Deb: "0", Cre: "", Saldo: "" },
      ],
      mapeo
    )
    expect(omitidas).toBe(2)
    expect(lineas).toEqual([
      { fila: 1, fecha: "2026-09-01", descripcion: "Depósito", referencia: "123", monto: 500, saldo_banco: 1500 },
      { fila: 2, fecha: "2026-09-02", descripcion: "Comisión", referencia: null, monto: -25, saldo_banco: 1475 },
    ])
  })
  it("una columna de monto con invertir signo, y duplicadas exactas", () => {
    const { lineas } = normalizarLineas([{ F: 46287, D: "x", M: "100" }, { F: 46287, D: "x", M: "100" }, { F: 46287, D: "y", M: "-50" }], { fecha: "F", descripcion: "D", monto: "M" }, { invertirSigno: true })
    expect(lineas.map((l) => l.monto)).toEqual([-100, -100, 50])
    expect(detectarDuplicadas(lineas)).toEqual([1])
  })
})

const M = (p: Partial<MovimientoLibro> & { id: number; tipo: "Ingreso" | "Egreso"; monto: number; fecha: string }): MovimientoLibro => ({
  concepto: null, referencia: null, ref_tipo: null, conciliado_at: null, ...p,
})

describe("emparejarMovimientos", () => {
  it("parea por monto+signo y fecha cercana, prefiere referencia coincidente y respeta 1:1", () => {
    const lineas = [
      { id: 1, fecha: "2026-09-10", monto: 500, referencia: "778899", descripcion: "TRANSF 778899" },
      { id: 2, fecha: "2026-09-10", monto: 500, referencia: null, descripcion: "DEPOSITO" },
      { id: 3, fecha: "2026-09-12", monto: -25, referencia: null, descripcion: "COMISION" },
      { id: 4, fecha: "2026-09-20", monto: 900, referencia: null, descripcion: "OTRO" },
    ]
    const movs = [
      M({ id: 10, tipo: "Ingreso", monto: 500, fecha: "2026-09-11T10:00:00", referencia: "778899" }),
      M({ id: 11, tipo: "Ingreso", monto: 500, fecha: "2026-09-09T10:00:00" }),
      M({ id: 12, tipo: "Ingreso", monto: 900, fecha: "2026-09-01T10:00:00" }), // fuera de tolerancia
      M({ id: 13, tipo: "Ingreso", monto: 25, fecha: "2026-09-12T10:00:00" }), // signo opuesto
      M({ id: 14, tipo: "Egreso", monto: 500, fecha: "2026-09-10T10:00:00", conciliado_at: "2026-09-01" }),
    ]
    const { pares, ambiguas } = emparejarMovimientos(lineas, movs)
    expect(pares.find((p) => p.linea_id === 1)?.movimiento_id).toBe(10)
    expect(pares.find((p) => p.linea_id === 2)?.movimiento_id).toBe(11)
    expect(pares.find((p) => p.linea_id === 3)).toBeUndefined()
    expect(pares.find((p) => p.linea_id === 4)).toBeUndefined()
    expect(ambiguas).toEqual([])
  })

  it("dos líneas iguales el mismo día contra un solo movimiento quedan ambiguas", () => {
    const lineas = [
      { id: 1, fecha: "2026-09-10", monto: 100, referencia: null, descripcion: "A" },
      { id: 2, fecha: "2026-09-10", monto: 100, referencia: null, descripcion: "B" },
    ]
    const movs = [M({ id: 10, tipo: "Ingreso", monto: 100, fecha: "2026-09-10T10:00:00" })]
    const { pares, ambiguas } = emparejarMovimientos(lineas, movs)
    expect(pares).toEqual([])
    expect(ambiguas.sort()).toEqual([1, 2])
  })
})

describe("calcularSaldoLibro / resumenConciliacion", () => {
  it("saldo = ingresos − egresos; resumen con tránsito y diferencia", () => {
    const movs = [M({ id: 1, tipo: "Ingreso", monto: 1000, fecha: "2026-09-01", conciliado_at: "x" }), M({ id: 2, tipo: "Egreso", monto: 300, fecha: "2026-09-02" })]
    expect(calcularSaldoLibro(movs)).toBe(700)
    const r = resumenConciliacion(
      [{ estado: "Conciliada", monto: 1000 }, { estado: "Ignorada", monto: -5 }, { estado: "Pendiente", monto: -20 }],
      movs,
      1000,
      700
    )
    expect(r.conciliadas).toBe(1)
    expect(r.ignoradas).toBe(1)
    expect(r.pendientes).toBe(1)
    expect(r.montoBancoEntradas).toBe(1000)
    expect(r.montoBancoSalidas).toBe(25)
    expect(r.enTransito).toBe(1)
    expect(r.enTransitoMonto).toBe(-300)
    // banco 1000 − (libro 700 − (−300 en tránsito)) = 0
    expect(r.diferencia).toBe(0)
  })
})
