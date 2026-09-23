import { describe, it, expect, beforeEach } from "vitest"
import { validarAnulacion } from "@/lib/services/ventas"
import { distribuirCobro, validarAplicaciones, aplicarAbono, recalcularValorpago } from "@/lib/services/recibos"
import { esVentaVigente, _resetFiltroVigentes, ejecutarVigentes, filtrarVigentesActivo } from "@/lib/services/ventas-filtros"

describe("validarAnulacion", () => {
  it("exige motivo", () => {
    expect(validarAnulacion({ motivo: "" })).toMatch(/motivo/i)
    expect(validarAnulacion({ motivo: "   " })).toMatch(/motivo/i)
  })
  it("no anula dos veces ni con devoluciones o recibos vigentes", () => {
    expect(validarAnulacion({ motivo: "x", anulada: true })).toMatch(/ya está anulada/)
    expect(validarAnulacion({ motivo: "x", devolucionesVigentes: 1 })).toMatch(/devoluciones/)
    expect(validarAnulacion({ motivo: "x", abonosConRecibo: 2 })).toMatch(/recibo/)
  })
  it("con dinero cobrado exige destino del reembolso (y cuenta si es banco)", () => {
    expect(validarAnulacion({ motivo: "x", valorpago: 100 })).toMatch(/a dónde se devuelve/)
    expect(validarAnulacion({ motivo: "x", valorpago: 100, reembolso: { destino: "cuenta" } })).toMatch(/cuenta bancaria/)
    expect(validarAnulacion({ motivo: "x", valorpago: 100, reembolso: { destino: "cuenta", cuenta_id: 3 } })).toBeNull()
    expect(validarAnulacion({ motivo: "x", valorpago: 100, reembolso: { destino: "caja" } })).toBeNull()
  })
  it("venta a crédito sin cobros: anula sin reembolso", () => {
    expect(validarAnulacion({ motivo: "duplicada", valorpago: 0 })).toBeNull()
  })
})

describe("distribuirCobro", () => {
  const facturas = [
    { venta_id: 3, saldo: 300, fecha: "2026-09-10T12:00:00Z" },
    { venta_id: 1, saldo: 100, fecha: "2026-09-01T12:00:00Z" },
    { venta_id: 2, saldo: 200, fecha: "2026-09-05T12:00:00Z" },
    { venta_id: 4, saldo: 0, fecha: "2026-08-01T12:00:00Z" }, // sin saldo: se ignora
  ]
  it("aplica de la más antigua a la más reciente y deja el resto exacto en la última", () => {
    expect(distribuirCobro(facturas, 350)).toEqual([
      { venta_id: 1, monto: 100 },
      { venta_id: 2, monto: 200 },
      { venta_id: 3, monto: 50 },
    ])
  })
  it("un monto mayor a la deuda total cubre todas las facturas", () => {
    expect(distribuirCobro(facturas, 1000)).toEqual([
      { venta_id: 1, monto: 100 },
      { venta_id: 2, monto: 200 },
      { venta_id: 3, monto: 300 },
    ])
  })
  it("monto 0 o negativo -> nada", () => {
    expect(distribuirCobro(facturas, 0)).toEqual([])
    expect(distribuirCobro(facturas, -5)).toEqual([])
  })
})

describe("validarAplicaciones", () => {
  const saldos = new Map<number, number>([[1, 100], [2, 200]])
  it("rechaza vacío, repetidas, facturas ajenas y montos sobre el saldo", () => {
    expect(validarAplicaciones([], saldos)).toMatch(/al menos una/)
    expect(validarAplicaciones([{ venta_id: 1, monto: 0 }], saldos)).toMatch(/al menos una/)
    expect(validarAplicaciones([{ venta_id: 1, monto: 10 }, { venta_id: 1, monto: 10 }], saldos)).toMatch(/repetida/)
    expect(validarAplicaciones([{ venta_id: 9, monto: 10 }], saldos)).toMatch(/no tiene saldo/)
    expect(validarAplicaciones([{ venta_id: 1, monto: 100.5 }], saldos)).toMatch(/supera su saldo/)
  })
  it("acepta montos dentro del saldo (tolerancia de centavo)", () => {
    expect(validarAplicaciones([{ venta_id: 1, monto: 100 }, { venta_id: 2, monto: 50 }], saldos)).toBeNull()
    expect(validarAplicaciones([{ venta_id: 1, monto: 100.004 }], saldos)).toBeNull()
  })
})

describe("aplicarAbono / recalcularValorpago", () => {
  it("deriva el estado de pago con tolerancia de centavo", () => {
    expect(aplicarAbono(100, 0, 40)).toEqual({ valorpago: 40, estado_pago: "Parcial" })
    expect(aplicarAbono(100, 40, 59.996)).toEqual({ valorpago: 100, estado_pago: "Pagado" })
    expect(aplicarAbono(100, 0, 0)).toEqual({ valorpago: 0, estado_pago: "Pendiente" })
  })
  it("reconstruye desde el pago inicial (sin la línea de crédito) más los abonos", () => {
    const r = recalcularValorpago(500, [{ monto_bruto: 200 }, { monto_bruto: 50 }], [{ monto: 100 }])
    expect(r).toEqual({ valorpago: 350, estado_pago: "Parcial" })
  })
})

describe("filtro de vigentes", () => {
  beforeEach(() => _resetFiltroVigentes())

  it("esVentaVigente: anulada_at null/ausente = vigente", () => {
    expect(esVentaVigente({ anulada_at: null })).toBe(true)
    expect(esVentaVigente({})).toBe(true)
    expect(esVentaVigente({ anulada_at: "2026-09-22T00:00:00Z" })).toBe(false)
  })

  it("ejecutarVigentes reintenta sin filtro si la columna no existe y apaga el filtro para la sesión", async () => {
    const llamadas: boolean[] = []
    const build = (filtrar: boolean) => {
      llamadas.push(filtrar)
      return Promise.resolve(
        filtrar
          ? { data: null, error: { message: 'column ventas_encabezado.anulada_at does not exist' } }
          : { data: [1, 2, 3], error: null }
      )
    }
    const r1 = await ejecutarVigentes(build)
    expect(r1.data).toEqual([1, 2, 3])
    expect(llamadas).toEqual([true, false])
    expect(filtrarVigentesActivo()).toBe(false)
    // La siguiente consulta ya no intenta el filtro.
    await ejecutarVigentes(build)
    expect(llamadas).toEqual([true, false, false])
  })

  it("con la columna presente, el filtro queda activo", async () => {
    const r = await ejecutarVigentes(() => Promise.resolve({ data: [1], error: null }))
    expect(r.data).toEqual([1])
    expect(filtrarVigentesActivo()).toBe(true)
  })
})
