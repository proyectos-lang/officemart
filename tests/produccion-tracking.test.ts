import { describe, it, expect } from "vitest"
import { abierto, sumarHorasLaborales, horasLaboralesEntre } from "@/lib/utils/calendario-laboral"
import { estandarPorDefecto, planificarEtapas, construirTracking, resumenProduccion, type OrdenCruda, type EtapaCruda, type OperacionStd } from "@/lib/services/produccion-tracking"

const D = (s: string) => new Date(s)

describe("calendario laboral", () => {
  it("abre a las 8 y salta domingos", () => {
    expect(abierto(D("2026-09-28T06:00:00.000Z")).toISOString()).toBe("2026-09-28T08:00:00.000Z") // lunes
    expect(abierto(D("2026-09-27T10:00:00.000Z")).toISOString()).toBe("2026-09-28T08:00:00.000Z") // domingo → lunes
    expect(abierto(D("2026-09-26T13:00:00.000Z")).toISOString()).toBe("2026-09-28T08:00:00.000Z") // sábado tarde → lunes
  })
  it("suma horas laborales cruzando la noche y el fin de semana", () => {
    expect(sumarHorasLaborales(D("2026-09-28T15:00:00.000Z"), 3).toISOString()).toBe("2026-09-29T09:00:00.000Z")
    expect(sumarHorasLaborales(D("2026-09-26T11:00:00.000Z"), 2).toISOString()).toBe("2026-09-28T09:00:00.000Z") // sábado 11–12 + lunes 8–9
  })
  it("horas laborales entre dos instantes", () => {
    expect(horasLaboralesEntre(D("2026-09-28T15:00:00.000Z"), D("2026-09-29T09:00:00.000Z"))).toBe(3)
    expect(horasLaboralesEntre(D("2026-09-29T09:00:00.000Z"), D("2026-09-28T09:00:00.000Z"))).toBe(0)
  })
})

describe("planificarEtapas", () => {
  it("encadena las etapas con su estándar y usa el defecto por nombre", () => {
    expect(estandarPorDefecto("Impresión")).toBe(2.5)
    const p = planificarEtapas("2026-09-28T14:00:00.000Z", [{ operacion_id: 1, nombre: "Diseño" }, { operacion_id: 2, nombre: "Impresión" }, { operacion_id: null, nombre: "Entrega" }], new Map([[1, 2], [2, 3]]))
    expect(p[0]).toEqual({ plan_inicio: "2026-09-28T14:00:00.000Z", plan_fin: "2026-09-28T16:00:00.000Z" })
    expect(p[1]).toEqual({ plan_inicio: "2026-09-28T16:00:00.000Z", plan_fin: "2026-09-29T10:00:00.000Z" })
    expect(p[2].plan_fin).toBe("2026-09-29T14:00:00.000Z") // Entrega 4 h por defecto
  })
})

const OPS: OperacionStd[] = [
  { id: 1, nombre: "Diseño", orden_secuencia: 1, estandar_h: 3, configurado: true },
  { id: 2, nombre: "Impresión", orden_secuencia: 2, estandar_h: 2.5, configurado: true },
]
const ord = (p: Partial<OrdenCruda>): OrdenCruda => ({ id: 1, tipo: "Trabajo", producto_id: 0, descripcion: "Volantes", cliente_id: 7, cantidad_objetivo: 1000, fecha_objetivo: "2026-09-30", estado: "En Proceso", created_at: "2026-09-28T08:00:00.000Z", notas: null, ...p })
const et = (p: Partial<EtapaCruda>): EtapaCruda => ({ id: 1, orden_id: 1, operacion_id: 1, nombre: "Diseño", orden_secuencia: 1, estado: "Pendiente", responsable: null, fecha_recepcion: null, fecha_entrega: null, ...p })
const NOMBRES = { clientes: new Map([[7, "ACME"]]), productos: new Map([[5, "Cuaderno"]]) }

describe("construirTracking", () => {
  it("orden terminada a tiempo, con plan calculado y lead time", () => {
    const [r] = construirTracking(
      [ord({ estado: "Cerrada" })],
      [
        et({ id: 1, estado: "Entregada", fecha_recepcion: "2026-09-28T08:00:00.000Z", fecha_entrega: "2026-09-28T13:00:00.000Z" }),
        et({ id: 2, operacion_id: 2, nombre: "Impresión", orden_secuencia: 2, estado: "Entregada", fecha_recepcion: "2026-09-28T13:00:00.000Z", fecha_entrega: "2026-09-29T10:00:00.000Z" }),
      ],
      OPS, NOMBRES, "2026-10-01T10:00:00.000Z"
    )
    expect(r.codigo).toBe("OT-0001")
    expect(r.cliente_nombre).toBe("ACME")
    expect(r.estado).toBe("Terminada")
    expect(r.progreso_pct).toBe(100)
    expect(r.lead_h).toBe(26)
    expect(r.a_tiempo).toBe(true)
    expect(r.semaforo).toBe("verde")
    expect(r.etapas[0].plan_fin).toBe("2026-09-28T11:00:00.000Z")
    expect(r.etapas[0].desvio_h).toBe(2) // terminó 2 h después del plan
    expect(r.etapas[1].plan_guardado).toBe(false)
  })

  it("orden vencida en piso → rojo; en riesgo → amarillo; producto con nombre", () => {
    const rows = construirTracking(
      [ord({ id: 1, fecha_objetivo: "2026-09-29" }), ord({ id: 2, fecha_objetivo: "2026-10-01" }), ord({ id: 3, tipo: null, producto_id: 5, fecha_objetivo: "2026-10-20" })],
      [
        et({ id: 1, orden_id: 1, estado: "En Proceso", fecha_recepcion: "2026-09-28T08:00:00.000Z" }),
        et({ id: 2, orden_id: 2, estado: "Recibida", fecha_recepcion: "2026-09-30T08:00:00.000Z", plan_inicio: "2026-09-30T08:00:00.000Z", plan_fin: "2026-09-30T11:00:00.000Z" }),
        et({ id: 3, orden_id: 3, estado: "Recibida", fecha_recepcion: "2026-09-30T08:00:00.000Z" }),
        et({ id: 4, orden_id: 3, operacion_id: 2, nombre: "Impresión", orden_secuencia: 2 }),
      ],
      OPS, NOMBRES, "2026-10-01T10:00:00.000Z"
    )
    expect(rows[0]).toMatchObject({ estado: "En Proceso", semaforo: "rojo", atraso_dias: 2, etapa_actual: "Diseño" })
    expect(rows[1]).toMatchObject({ estado: "Recibida", semaforo: "amarillo" })
    expect(rows[1].etapas[0].plan_guardado).toBe(true)
    expect(rows[2]).toMatchObject({ descripcion: "Cuaderno", codigo: "OP-0003", semaforo: "verde", progreso_pct: 0 })
  })
})

describe("resumenProduccion", () => {
  it("cuenta el piso por proceso y el cumplimiento del rango", () => {
    const rows = construirTracking(
      [ord({ id: 1, estado: "Cerrada" }), ord({ id: 2, fecha_objetivo: "2026-09-29" }), ord({ id: 3, estado: "Cerrada", fecha_objetivo: "2026-09-28" })],
      [
        et({ id: 1, orden_id: 1, estado: "Entregada", fecha_recepcion: "2026-09-28T08:00:00.000Z", fecha_entrega: "2026-09-28T12:00:00.000Z" }),
        et({ id: 2, orden_id: 2, estado: "Entregada", fecha_recepcion: "2026-09-28T08:00:00.000Z", fecha_entrega: "2026-09-28T10:00:00.000Z" }),
        et({ id: 3, orden_id: 2, operacion_id: 2, nombre: "Impresión", orden_secuencia: 2, estado: "Recibida", fecha_recepcion: "2026-09-28T10:00:00.000Z" }),
        et({ id: 4, orden_id: 3, estado: "Entregada", fecha_recepcion: "2026-09-28T08:00:00.000Z", fecha_entrega: "2026-09-30T08:00:00.000Z" }),
      ],
      OPS, NOMBRES, "2026-10-01T10:00:00.000Z"
    )
    const r = resumenProduccion(rows, OPS, { desde: "2026-09-01", hasta: "2026-09-30" })
    expect(r).toMatchObject({ en_piso: 1, terminadas: 2, atrasadas: 1, terminadas_con_fecha: 2, a_tiempo: 1, cumplimiento_pct: 50 })
    expect(r.procesos[0]).toMatchObject({ nombre: "Diseño", entregadas: 3, recibidas: 0 })
    expect(r.procesos[0].lead_real_h).toBeCloseTo((4 + 2 + 48) / 3, 1)
    expect(r.procesos[1]).toMatchObject({ nombre: "Impresión", recibidas: 1, entregadas: 0, lead_real_h: null })
    expect(r.semanas).toEqual([{ semana: "2026-09-28", terminadas: 2, a_tiempo_pct: 50, lead_h: 26 }])
  })
})
