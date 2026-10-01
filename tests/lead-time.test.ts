import { describe, it, expect } from "vitest"
import { calcularLeadTimes } from "@/lib/services/produccion-flujo"

const E = (orden_id: number, estado: string, rec: string | null, ent: string | null) => ({ orden_id, estado, fecha_recepcion: rec, fecha_entrega: ent })

describe("calcularLeadTimes", () => {
  const etapas = [
    // Orden 1: 08:00 lunes 21 → 16:00 martes 22 = 32 h, objetivo 22 → a tiempo
    E(1, "Entregada", "2026-09-21T08:00:00.000Z", "2026-09-21T12:00:00.000Z"),
    E(1, "Entregada", "2026-09-21T12:00:00.000Z", "2026-09-22T16:00:00.000Z"),
    // Orden 2: 10 h, objetivo 20 (entregó el 23) → tarde
    E(2, "Entregada", "2026-09-23T06:00:00.000Z", "2026-09-23T16:00:00.000Z"),
    // Orden 3: 4 h, semana siguiente, sin fecha objetivo
    E(3, "Entregada", "2026-09-28T08:00:00.000Z", "2026-09-28T12:00:00.000Z"),
    // Orden 4: en piso (no cuenta como terminada)
    E(4, "Entregada", "2026-09-29T08:00:00.000Z", "2026-09-29T10:00:00.000Z"),
    E(4, "En Proceso", "2026-09-29T10:00:00.000Z", null),
    // Orden 5: solo pendiente (no está en piso todavía)
    E(5, "Pendiente", null, null),
  ]
  const objetivo = new Map<number, string | null>([[1, "2026-09-22"], [2, "2026-09-20"], [3, null], [4, "2026-10-02"], [5, null]])

  it("lead time, percentil, cumplimiento y WIP", () => {
    const r = calcularLeadTimes(etapas, objetivo)
    expect(r.terminadas).toBe(3)
    expect(r.lead_promedio_h).toBeCloseTo((32 + 10 + 4) / 3, 1)
    expect(r.lead_max_h).toBe(32)
    expect(r.lead_p90_h).toBe(32)
    expect(r.con_fecha).toBe(2)
    expect(r.a_tiempo).toBe(1)
    expect(r.cumplimiento_pct).toBe(50)
    expect(r.wip).toBe(1)
  })

  it("agrupa por semana (lunes) y filtra por rango de la última entrega", () => {
    const r = calcularLeadTimes(etapas, objetivo)
    expect(r.semanas).toEqual([
      { semana: "2026-09-21", terminadas: 2, lead_promedio_h: 21, cumplimiento_pct: 50 },
      { semana: "2026-09-28", terminadas: 1, lead_promedio_h: 4, cumplimiento_pct: null },
    ])
    const soloUltima = calcularLeadTimes(etapas, objetivo, { desde: "2026-09-27" })
    expect(soloUltima.terminadas).toBe(1)
    expect(soloUltima.wip).toBe(1)
  })

  it("sin órdenes terminadas devuelve ceros y conserva el WIP", () => {
    const r = calcularLeadTimes([E(9, "Recibida", "2026-09-29T08:00:00.000Z", null)], new Map([[9, null]]))
    expect(r).toMatchObject({ terminadas: 0, lead_promedio_h: 0, cumplimiento_pct: null, wip: 1, semanas: [] })
  })
})
