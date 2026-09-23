import { describe, it, expect } from "vitest"
import {
  resumirPipeline,
  tasaCierre,
  resumirPorClave,
  contarPor,
  clasificarActividades,
  proximosCumpleanos,
  hondurasLocalAIso,
  isoAHondurasLocal,
  diasSinMovimiento,
  esCierreVencido,
  construirReporteGestion,
  nombreCuenta,
  type OportunidadCrm,
  type EtapaCrm,
  type ActividadCrm,
} from "@/lib/services/crm"

const etapas: EtapaCrm[] = [
  { id: 1, nombre: "Prospecto", orden: 1, probabilidad: 10 },
  { id: 2, nombre: "Propuesta", orden: 2, probabilidad: 50 },
  { id: 3, nombre: "Cierre", orden: 3, probabilidad: 90 },
]

function op(p: Partial<OportunidadCrm>): OportunidadCrm {
  return {
    id: 1, titulo: "x", cliente_id: null, cliente_nombre: null, prospecto_nombre: null, contacto_id: null, contacto_nombre: null,
    vendedor_id: null, vendedor_nombre: null, etapa_id: 1, etapa_nombre: null, valor_estimado: 0, fecha_cierre_esperada: null,
    origen: null, estado: "Abierta", motivo_perdida: null, cotizacion_id: null, venta_id: null, notas: null, cerrada_at: null,
    usuario: null, created_at: "2026-09-01T10:00:00.000Z", updated_at: null, proxima_actividad: null, ...p,
  }
}

function act(p: Partial<ActividadCrm>): ActividadCrm {
  return {
    id: 1, oportunidad_id: null, oportunidad_titulo: null, cliente_id: null, cliente_nombre: null, contacto_id: null, contacto_nombre: null,
    vendedor_id: null, vendedor_nombre: null, tipo: "Tarea", asunto: "a", descripcion: null, fecha: "2026-09-23T10:00:00.000Z",
    resultado: null, completada: false, completada_at: null, usuario: null, created_at: "", ...p,
  }
}

describe("resumirPipeline", () => {
  it("suma valor y pondera por probabilidad solo las abiertas, en orden de etapa", () => {
    const r = resumirPipeline(
      [
        op({ id: 1, etapa_id: 1, valor_estimado: 1000 }),
        op({ id: 2, etapa_id: 2, valor_estimado: 2000 }),
        op({ id: 3, etapa_id: 2, valor_estimado: 500, estado: "Ganada" }),
        op({ id: 4, etapa_id: 3, valor_estimado: 100 }),
        op({ id: 5, etapa_id: 99, valor_estimado: 9999 }), // etapa desconocida se ignora
      ],
      [etapas[2], etapas[0], etapas[1]]
    )
    expect(r.etapas.map((e) => e.nombre)).toEqual(["Prospecto", "Propuesta", "Cierre"])
    expect(r.etapas[0]).toMatchObject({ cantidad: 1, valor: 1000, ponderado: 100 })
    expect(r.etapas[1]).toMatchObject({ cantidad: 1, valor: 2000, ponderado: 1000 })
    expect(r.etapas[2]).toMatchObject({ cantidad: 1, valor: 100, ponderado: 90 })
    expect(r.total).toBe(3100)
    expect(r.ponderado).toBe(1190)
    expect(r.cantidad).toBe(3)
  })
})

describe("tasaCierre / resumirPorClave / contarPor", () => {
  it("tasa = ganadas / cerradas; null sin cerradas", () => {
    expect(tasaCierre([op({ estado: "Abierta" })]).tasa).toBeNull()
    const t = tasaCierre([op({ estado: "Ganada", valor_estimado: 300 }), op({ estado: "Ganada", valor_estimado: 200 }), op({ estado: "Perdida" })])
    expect(t).toEqual({ ganadas: 2, perdidas: 1, valorGanado: 500, tasa: 66.67 })
  })
  it("agrupa por vendedor con tasa propia y ordena por valor", () => {
    const r = resumirPorClave(
      [
        op({ vendedor_nombre: "Ana", estado: "Ganada", valor_estimado: 100 }),
        op({ vendedor_nombre: "Ana", estado: "Perdida", valor_estimado: 50 }),
        op({ vendedor_nombre: "Luis", estado: "Abierta", valor_estimado: 5000 }),
        op({ vendedor_nombre: null, estado: "Abierta", valor_estimado: 1 }),
      ],
      (o) => o.vendedor_nombre || "(sin vendedor)"
    )
    expect(r[0]).toMatchObject({ clave: "Luis", abiertas: 1, valorAbierto: 5000, tasa: null })
    expect(r[1]).toMatchObject({ clave: "Ana", ganadas: 1, perdidas: 1, valorGanado: 100, tasa: 50 })
    expect(r[2].clave).toBe("(sin vendedor)")
  })
  it("contarPor ordena por cantidad y agrupa vacíos", () => {
    expect(contarPor([{ m: "Precio" }, { m: "Precio" }, { m: "" }, { m: "Plazo" }], (x) => x.m)).toEqual([
      { clave: "Precio", cantidad: 2 },
      { clave: "(sin dato)", cantidad: 1 },
      { clave: "Plazo", cantidad: 1 },
    ])
  })
})

describe("clasificarActividades", () => {
  it("separa vencidas / hoy / próximas y omite completadas", () => {
    const r = clasificarActividades(
      [
        act({ id: 1, fecha: "2026-09-22T09:00:00.000Z" }),
        act({ id: 2, fecha: "2026-09-23T16:00:00.000Z" }),
        act({ id: 3, fecha: "2026-09-23T08:00:00.000Z" }),
        act({ id: 4, fecha: "2026-09-25T08:00:00.000Z" }),
        act({ id: 5, fecha: "2026-09-20T08:00:00.000Z", completada: true }),
      ],
      "2026-09-23"
    )
    expect(r.vencidas.map((a) => a.id)).toEqual([1])
    expect(r.hoy.map((a) => a.id)).toEqual([3, 2])
    expect(r.proximas.map((a) => a.id)).toEqual([4])
  })
})

describe("proximosCumpleanos", () => {
  it("incluye hoy, salta el cambio de año y ajusta 29-feb", () => {
    const r = proximosCumpleanos(
      [
        { id: 1, nombre: "Hoy", fecha: "1990-12-30", tipo: "cliente" },
        { id: 2, nombre: "Enero", fecha: "1985-01-02", tipo: "contacto" },
        { id: 3, nombre: "Lejos", fecha: "1985-03-15", tipo: "contacto" },
        { id: 4, nombre: "Ayer", fecha: "1985-12-29", tipo: "cliente" },
        { id: 5, nombre: "Sin fecha", fecha: null, tipo: "cliente" },
      ],
      "2026-12-30",
      7
    )
    expect(r.map((c) => [c.nombre, c.diasFaltan, c.proximo])).toEqual([
      ["Hoy", 0, "2026-12-30"],
      ["Enero", 3, "2027-01-02"],
    ])
    const feb = proximosCumpleanos([{ id: 1, nombre: "Bisiesto", fecha: "2000-02-29", tipo: "cliente" }], "2027-02-25", 7)
    expect(feb[0]).toMatchObject({ proximo: "2027-02-28", diasFaltan: 3 })
  })
})

describe("fechas HN-as-UTC", () => {
  it("convierte ida y vuelta", () => {
    expect(hondurasLocalAIso("2026-09-23T14:30")).toBe("2026-09-23T14:30:00.000Z")
    expect(hondurasLocalAIso("2026-09-23")).toBe("2026-09-23T09:00:00.000Z")
    expect(isoAHondurasLocal("2026-09-23T14:30:00.000Z")).toBe("2026-09-23T14:30")
    expect(hondurasLocalAIso("")).toBe("")
  })
  it("días sin movimiento y cierre vencido", () => {
    expect(diasSinMovimiento({ updated_at: "2026-09-20T10:00:00.000Z", created_at: "2026-09-01T00:00:00.000Z" }, "2026-09-23")).toBe(3)
    expect(diasSinMovimiento({ updated_at: null, created_at: "2026-09-01T00:00:00.000Z" }, "2026-09-23")).toBe(22)
    expect(esCierreVencido({ estado: "Abierta", fecha_cierre_esperada: "2026-09-22" }, "2026-09-23")).toBe(true)
    expect(esCierreVencido({ estado: "Ganada", fecha_cierre_esperada: "2026-09-22" }, "2026-09-23")).toBe(false)
    expect(esCierreVencido({ estado: "Abierta", fecha_cierre_esperada: null }, "2026-09-23")).toBe(false)
  })
  it("nombreCuenta prefiere cliente y marca prospectos", () => {
    expect(nombreCuenta({ cliente_nombre: "ACME", prospecto_nombre: "x" })).toBe("ACME")
    expect(nombreCuenta({ cliente_nombre: null, prospecto_nombre: "Juan" })).toBe("Juan (prospecto)")
    expect(nombreCuenta({ cliente_nombre: null, prospecto_nombre: null })).toBe("—")
  })
})

describe("construirReporteGestion", () => {
  it("pipeline = abiertas; cerradas solo dentro del rango", () => {
    const r = construirReporteGestion(
      [
        op({ id: 1, etapa_id: 2, valor_estimado: 1000, vendedor_nombre: "Ana", fecha_cierre_esperada: "2026-09-01" }),
        op({ id: 2, estado: "Ganada", valor_estimado: 800, cerrada_at: "2026-09-10T10:00:00.000Z", vendedor_nombre: "Ana", origen: "Referido" }),
        op({ id: 3, estado: "Perdida", motivo_perdida: "Precio", cerrada_at: "2026-09-12T10:00:00.000Z", vendedor_nombre: "Luis" }),
        op({ id: 4, estado: "Perdida", motivo_perdida: "Precio", cerrada_at: "2026-08-12T10:00:00.000Z" }), // fuera de rango
      ],
      [act({ id: 1, tipo: "Llamada", completada: true }), act({ id: 2, tipo: "Visita" })],
      etapas,
      { desde: "2026-09-01", hasta: "2026-09-30" },
      "2026-09-23"
    )
    expect(r.pipeline).toMatchObject({ cantidad: 1, total: 1000, ponderado: 500 })
    expect(r.cierre).toEqual({ ganadas: 1, perdidas: 1, valorGanado: 800, tasa: 50 })
    expect(r.motivosPerdida).toEqual([{ clave: "Precio", cantidad: 1 }])
    expect(r.porVendedor.find((v) => v.clave === "Ana")).toMatchObject({ abiertas: 1, ganadas: 1, tasa: 100 })
    expect(r.porOrigen.find((v) => v.clave === "Referido")?.ganadas).toBe(1)
    expect(r.actividadesCompletadas).toBe(1)
    expect(r.actividadesPendientes).toBe(1)
    expect(r.cierresVencidos).toBe(1)
  })
})
