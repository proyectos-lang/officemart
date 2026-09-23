import { describe, it, expect } from "vitest"
import {
  resolverPuntoVenta,
  serieVentaDePunto,
  construirFiscalSnapshot,
  fiscalDesdeSnapshot,
  parseFiscalSnapshot,
  etiquetaPunto,
  type PuntoFacturacion,
} from "@/lib/services/puntos-facturacion"
import { formatearCorrelativoCai, type CorrelativoCaiEmitido } from "@/lib/services/facturacion-cai"

const SPS: PuntoFacturacion = { id: 1, codigo: "SPS", nombre: "San Pedro Sula", serie_prefijo: "FC-SPS-", localizacion_id: 10, activo: true }
const TGU: PuntoFacturacion = { id: 2, codigo: "TGU", nombre: "Tegucigalpa", serie_prefijo: null, localizacion_id: 20, activo: true }
const CEIBA_INACTIVO: PuntoFacturacion = { id: 3, codigo: "LCE", nombre: "La Ceiba", serie_prefijo: "FC-LCE-", activo: false }
const PUNTOS = [SPS, TGU, CEIBA_INACTIVO]

describe("resolverPuntoVenta", () => {
  it("sin puntos activos devuelve null (flujo clásico, punto 0)", () => {
    expect(resolverPuntoVenta({ rol: "admin" }, [])).toBeNull()
    expect(resolverPuntoVenta({ rol: "admin" }, [CEIBA_INACTIVO])).toBeNull()
  })

  it("el punto asignado al usuario manda, aunque el usuario no sea admin", () => {
    expect(resolverPuntoVenta({ punto_facturacion_id: 2, rol: "usuario" }, PUNTOS)).toBe(TGU)
  })

  it("un usuario con punto asignado NO puede elegir otro; el admin sí", () => {
    expect(resolverPuntoVenta({ punto_facturacion_id: 2, rol: "usuario" }, PUNTOS, 1)).toBe(TGU)
    expect(resolverPuntoVenta({ punto_facturacion_id: 2, rol: "Admin " }, PUNTOS, 1)).toBe(SPS)
  })

  it("un usuario sin punto asignado puede elegir uno explícitamente", () => {
    expect(resolverPuntoVenta({ rol: "usuario" }, PUNTOS, 1)).toBe(SPS)
  })

  it("ignora selecciones de puntos inactivos o inexistentes", () => {
    expect(resolverPuntoVenta({ rol: "admin" }, PUNTOS, 3)).toBeNull()
    expect(resolverPuntoVenta({ rol: "admin" }, PUNTOS, 99)).toBeNull()
  })

  it("con un único punto activo lo usa por defecto; con varios y sin asignación devuelve null", () => {
    expect(resolverPuntoVenta({ rol: "usuario" }, [SPS, CEIBA_INACTIVO])).toBe(SPS)
    expect(resolverPuntoVenta({ rol: "usuario" }, PUNTOS)).toBeNull()
  })

  it("si el punto asignado está inactivo, cae a la regla del único activo", () => {
    expect(resolverPuntoVenta({ punto_facturacion_id: 3, rol: "usuario" }, [SPS, CEIBA_INACTIVO])).toBe(SPS)
  })
})

describe("serieVentaDePunto", () => {
  it("punto con prefijo → serie propia 'venta:<id>'", () => {
    expect(serieVentaDePunto(SPS)).toEqual({ serie: "venta:1", prefijo: "FC-SPS-" })
  })

  it("sin prefijo (o sin punto) → null: usa la serie global FC-####", () => {
    expect(serieVentaDePunto(TGU)).toBeNull()
    expect(serieVentaDePunto({ id: 5, serie_prefijo: "   " })).toBeNull()
    expect(serieVentaDePunto(null)).toBeNull()
    expect(serieVentaDePunto({ serie_prefijo: "X-" })).toBeNull()
  })
})

const CORR_V2: CorrelativoCaiEmitido = {
  numero: "001-002-01-00000045",
  correlativo: 45,
  establecimiento: "001",
  punto_emision: "002",
  tipo_documento: "01",
  cai: "ABCDEF-123456-000000-000000-000000-01",
  rango_inicial: 1,
  rango_final: 500,
  fecha_limite_emision: "2027-03-31",
  imprenta_nombre: "Imprenta X",
  imprenta_rtn: "08019999999999",
  imprenta_registro: "RFI-1",
}

describe("construirFiscalSnapshot", () => {
  it("guarda la foto completa con el rango ya formateado", () => {
    const snap = construirFiscalSnapshot(CORR_V2, 1)
    expect(snap.numero).toBe("001-002-01-00000045")
    expect(snap.rango_desde).toBe(formatearCorrelativoCai("001", "002", "01", 1))
    expect(snap.rango_hasta).toBe("001-002-01-00000500")
    expect(snap.fecha_limite_emision).toBe("2027-03-31")
    expect(snap.imprenta_nombre).toBe("Imprenta X")
    expect(snap.punto_facturacion_id).toBe(1)
  })

  it("con el RPC clásico (sin rango) deja el rango en null pero conserva CAI y número", () => {
    const corrViejo: CorrelativoCaiEmitido = {
      numero: "000-001-01-00000003",
      correlativo: 3,
      establecimiento: "000",
      punto_emision: "001",
      tipo_documento: "01",
      cai: "CAI-VIEJO",
    }
    const snap = construirFiscalSnapshot(corrViejo)
    expect(snap.rango_desde).toBeNull()
    expect(snap.rango_hasta).toBeNull()
    expect(snap.cai).toBe("CAI-VIEJO")
    expect(snap.punto_facturacion_id).toBe(0)
  })
})

describe("fiscalDesdeSnapshot / parseFiscalSnapshot", () => {
  it("convierte la foto al bloque de tirilla/PDF con fecha dd/mm/aaaa", () => {
    const snap = construirFiscalSnapshot(CORR_V2, 1)
    const f = fiscalDesdeSnapshot(snap)!
    expect(f.cai).toBe(CORR_V2.cai)
    expect(f.rangoDesde).toBe("001-002-01-00000001")
    expect(f.rangoHasta).toBe("001-002-01-00000500")
    expect(f.fechaLimite).toBe("31/03/2027")
    expect(f.imprentaRtn).toBe("08019999999999")
  })

  it("sin foto (venta anterior al script o sin CAI) devuelve null", () => {
    expect(fiscalDesdeSnapshot(null)).toBeNull()
    expect(fiscalDesdeSnapshot({})).toBeNull()
  })

  it("parseFiscalSnapshot acepta jsonb (objeto) y string, y rechaza basura", () => {
    const snap = construirFiscalSnapshot(CORR_V2, 1)
    expect(parseFiscalSnapshot(snap)?.numero).toBe(snap.numero)
    expect(parseFiscalSnapshot(JSON.stringify(snap))?.correlativo).toBe(45)
    expect(parseFiscalSnapshot("{no json")).toBeNull()
    expect(parseFiscalSnapshot({ foo: 1 })).toBeNull()
    expect(parseFiscalSnapshot(null)).toBeNull()
  })
})

describe("etiquetaPunto", () => {
  it("CÓDIGO · Nombre (o solo nombre si no hay código)", () => {
    expect(etiquetaPunto(SPS)).toBe("SPS · San Pedro Sula")
    expect(etiquetaPunto({ codigo: "", nombre: "Central" })).toBe("Central")
  })
})
