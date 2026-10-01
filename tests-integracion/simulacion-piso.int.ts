/**
 * SIMULACIÓN DE PISO para Office Mart: órdenes de trabajo que recorren
 * Diseño → Impresión → Corte → Entrega desde el 24 de agosto hasta hoy.
 *
 *   pnpm test:integracion simulacion-piso
 *
 * Modelo: llegadas de 2 a 5 trabajos por día hábil; estaciones con capacidad
 * (Diseño 2 personas, Impresión 1 máquina = cuello de botella, Corte 1,
 * Entrega por rutas a las 10:00 y 15:00); cola FIFO por estación; tiempos en
 * horario laboral (L–V 8–17, sábado 8–12). Lo terminado antes de "ahora" queda
 * Entregado; lo que está en marcha, En Proceso; lo que espera, Recibida.
 * Cada orden se crea con createOrdenTrabajo (función de la app) y luego se le
 * fijan las horas simuladas de cada etapa. Reanudable: si ya hay órdenes con
 * la marca SIM-PISO no hace nada.
 */
import { describe, it, expect, beforeAll, vi } from "vitest"
import { writeFileSync } from "node:fs"

vi.mock("@/lib/supabase/client", async () => {
  const mod = await import("./cliente")
  return { createClient: () => mod.getCliente(), isSupabaseConfigured: () => true }
})

import { getCliente, iniciarSesion } from "./cliente"
import { createOrdenTrabajo } from "@/lib/services/produccion-ordenes"
import { getReporteFlujo, getFlujoOrdenes, agruparTableroPiso } from "@/lib/services/produccion-flujo"
import { getHondurasNowISO, getHondurasTodayISODate } from "@/lib/utils/honduras-time"

// ---------- azar reproducible ----------
function prng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const rnd = prng(41001)
const entre = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1))
const elegir = <T,>(xs: T[]): T => xs[Math.floor(rnd() * xs.length)]
/** Variación multiplicativa sesgada a la derecha (0.65–1.9, media ≈ 1). */
const variacion = () => 0.65 + Math.pow(rnd(), 1.8) * 1.25

// ---------- calendario laboral (horas en convención HN-as-UTC) ----------
const H = 3_600_000
function jornada(d: Date): [number, number] | null {
  const dia = d.getUTCDay()
  if (dia === 0) return null
  return dia === 6 ? [8, 12] : [8, 17]
}
function inicioDia(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}
/** Primer instante laborable >= t. */
function abierto(t: Date): Date {
  let d = new Date(t)
  for (let i = 0; i < 14; i++) {
    const j = jornada(d)
    if (j) {
      const ini = new Date(inicioDia(d).getTime() + j[0] * H)
      const fin = new Date(inicioDia(d).getTime() + j[1] * H)
      if (d < ini) return ini
      if (d < fin) return d
    }
    d = new Date(inicioDia(d).getTime() + 24 * H)
  }
  return d
}
/** Suma horas de trabajo a partir de t, saltando noches y domingos. */
function sumarHorasLaborales(t: Date, horas: number): Date {
  let actual = abierto(t)
  let resto = horas * H
  while (resto > 0) {
    const j = jornada(actual)!
    const fin = new Date(inicioDia(actual).getTime() + j[1] * H)
    const disponible = fin.getTime() - actual.getTime()
    if (resto <= disponible) return new Date(actual.getTime() + resto)
    resto -= disponible
    actual = abierto(new Date(fin.getTime() + 60_000))
  }
  return actual
}
/** Próxima salida de ruta de entrega (10:00 o 15:00 de un día hábil, no sábado 15:00). */
function proximaRuta(t: Date): Date {
  let d = abierto(t)
  for (let i = 0; i < 30; i++) {
    const base = inicioDia(d).getTime()
    const slots = d.getUTCDay() === 6 ? [10] : [10, 15]
    for (const h of slots) {
      const s = new Date(base + h * H)
      if (s >= d) return s
    }
    d = abierto(new Date(base + 24 * H))
  }
  return d
}
const iso = (d: Date) => d.toISOString()
function sumarDiasHabiles(d: Date, n: number): string {
  let x = inicioDia(d)
  let k = 0
  while (k < n) {
    x = new Date(x.getTime() + 24 * H)
    if (x.getUTCDay() !== 0) k++
  }
  return x.toISOString().slice(0, 10)
}

// ---------- catálogo de trabajos ----------
interface TipoTrabajo { nombre: string; cant: [number, number]; unidad: string; dis: number; imp: number; cor: number; dias: number }
const TRABAJOS: TipoTrabajo[] = [
  { nombre: "Lona publicitaria 3 x 2 m", cant: [1, 4], unidad: "u", dis: 1.5, imp: 1.4, cor: 0.5, dias: 2 },
  { nombre: "Tarjetas de presentación full color", cant: [500, 2000], unidad: "u", dis: 1.0, imp: 0.9, cor: 0.7, dias: 3 },
  { nombre: "Volantes media carta", cant: [2000, 10000], unidad: "u", dis: 1.5, imp: 2.4, cor: 1.0, dias: 3 },
  { nombre: "Talonarios de facturas 50 juegos", cant: [10, 50], unidad: "talonarios", dis: 1.0, imp: 2.8, cor: 1.5, dias: 5 },
  { nombre: "Stickers troquelados", cant: [200, 1000], unidad: "u", dis: 1.2, imp: 1.0, cor: 2.0, dias: 4 },
  { nombre: "Brochure tríptico carta", cant: [1000, 3000], unidad: "u", dis: 3.0, imp: 2.0, cor: 1.0, dias: 4 },
  { nombre: "Banner roll-up 85 x 200 cm", cant: [1, 3], unidad: "u", dis: 1.5, imp: 0.8, cor: 0.4, dias: 2 },
  { nombre: "Carnets PVC con lanyard", cant: [50, 200], unidad: "u", dis: 1.0, imp: 1.4, cor: 1.2, dias: 3 },
  { nombre: "Rotulación en vinil para vehículo", cant: [1, 2], unidad: "u", dis: 2.5, imp: 1.5, cor: 1.6, dias: 5 },
  { nombre: "Invitaciones impresas con sobre", cant: [100, 300], unidad: "u", dis: 2.8, imp: 1.0, cor: 1.0, dias: 4 },
  { nombre: "Menús laminados", cant: [20, 60], unidad: "u", dis: 2.0, imp: 0.8, cor: 0.8, dias: 3 },
]

const RESP = {
  dis: ["Denis Josué Martínez", "Diseño externo (freelance)"],
  imp: "Mario Roberto Aguilar",
  cor: "Rosa Elvira Murillo",
  ent: "Kevin Adalid Ordóñez",
}

interface Etapa { op: "dis" | "imp" | "cor" | "ent"; operacion_id: number; nombre: string; llegada?: Date; inicio?: Date; fin?: Date; resp?: string; nota?: string }
interface Job { urgente: boolean; n: number; llegada: Date; tipo: TipoTrabajo; cantidad: number; cliente: { id: number; nombre: string }; objetivo: string; etapas: Etapa[]; conArteCliente: boolean; cambios: boolean }

describe("Simulación de piso: órdenes de trabajo por Diseño, Impresión, Corte y Entrega", () => {
  const ops: Record<string, number> = {}
  let clientes: { id: number; nombre: string }[] = []
  const ahora = new Date(getHondurasNowISO())

  beforeAll(async () => {
    await iniciarSesion()
    const { data } = await getCliente().from("produccion_operaciones").select("id, nombre").eq("activo", true)
    for (const o of (data || []) as { id: number; nombre: string }[]) ops[o.nombre] = o.id
    const { data: cs } = await getCliente().from("clientes").select("id, nombre").not("nombre", "in", '("Consumidor Final")').not("nombre", "like", "VAL %")
    clientes = (cs || []) as { id: number; nombre: string }[]
  })

  it("simula y carga las órdenes", async () => {
    for (const n of ["Diseño", "Impresión", "Corte", "Entrega"]) expect(ops[n], `operación ${n}`).toBeTruthy()
    const { count: previas } = await getCliente().from("produccion_ordenes").select("id", { count: "exact", head: true }).like("notas", "%SIM-PISO%")
    if ((previas || 0) > 0) return

    // 1) Llegadas.
    const jobs: Job[] = []
    let n = 0
    for (let d = new Date(Date.UTC(2026, 7, 24)); d <= ahora; d = new Date(d.getTime() + 24 * H)) {
      const j = jornada(d)
      if (!j) continue
      // Demanda base y pico de fin de mes (últimos 6 días hábiles).
      const pico = (ahora.getTime() - d.getTime()) / (24 * H) < Number(process.env.SIM_PICO_DIAS || 10)
      const cuantos = d.getUTCDay() === 6 ? entre(1, 3) : pico ? entre(5, 6) : entre(3, 4)
      for (let k = 0; k < cuantos; k++) {
        const llegada = new Date(inicioDia(d).getTime() + (j[0] + rnd() * (j[1] - j[0] - 0.5)) * H)
        if (llegada > ahora) continue
        const tipo = elegir(TRABAJOS)
        const conArteCliente = rnd() < 0.3
        const cambios = !conArteCliente && rnd() < 0.15
        const etapas: Etapa[] = [
          ...(conArteCliente ? [] : [{ op: "dis" as const, operacion_id: ops["Diseño"], nombre: "Diseño" }]),
          { op: "imp", operacion_id: ops["Impresión"], nombre: "Impresión" },
          { op: "cor", operacion_id: ops["Corte"], nombre: "Corte" },
          { op: "ent", operacion_id: ops["Entrega"], nombre: "Entrega" },
        ]
        const [a, b] = tipo.cant
        const cantidad = a === b ? a : Math.round((a + rnd() * (b - a)) / (b > 100 ? 100 : 1)) * (b > 100 ? 100 : 1) || a
        const urgente = rnd() < 0.2
        jobs.push({ n: ++n, llegada, tipo, cantidad, cliente: elegir(clientes), objetivo: sumarDiasHabiles(llegada, urgente ? 1 : tipo.dias), etapas, conArteCliente, cambios, urgente })
      }
    }
    jobs.sort((x, y) => x.llegada.getTime() - y.llegada.getTime())

    // 2) Simulación por estación (cola FIFO, capacidad fija).
    const simular = (op: Etapa["op"], servidores: number, duracion: (j: Job) => number) => {
      const libre = Array.from({ length: servidores }, () => new Date(0))
      const cola = jobs
        .map((j) => {
          const idx = j.etapas.findIndex((e) => e.op === op)
          if (idx < 0) return null
          const llegada = idx === 0 ? j.llegada : j.etapas[idx - 1].fin!
          return { j, e: j.etapas[idx], llegada }
        })
        .filter((x): x is { j: Job; e: Etapa; llegada: Date } => x !== null)
        .sort((x, y) => x.llegada.getTime() - y.llegada.getTime())
      for (const { j, e, llegada } of cola) {
        e.llegada = llegada
        if (op === "ent") {
          e.inicio = proximaRuta(llegada)
          // 35 % fuera de la ciudad (encomienda o ruta larga): de 6 a 26 horas laborales.
          e.fin = rnd() < 0.35 ? sumarHorasLaborales(e.inicio, 6 + rnd() * 20) : new Date(e.inicio.getTime() + (0.5 + rnd() * 2.5) * H)
          e.resp = RESP.ent
          continue
        }
        let s = 0
        for (let i = 1; i < libre.length; i++) if (libre[i] < libre[s]) s = i
        e.inicio = abierto(new Date(Math.max(llegada.getTime(), libre[s].getTime())))
        e.fin = sumarHorasLaborales(e.inicio, duracion(j))
        libre[s] = e.fin
        e.resp = op === "dis" ? RESP.dis[s] : op === "imp" ? RESP.imp : RESP.cor
      }
    }
    const DISF = Number(process.env.SIM_DISF || 2.0), CORF = Number(process.env.SIM_CORF || 1.85)
    const escala = (j: Job) => Math.max(1, Math.log10(Math.max(10, j.cantidad)) / 2)
    simular("dis", 2, (j) => j.tipo.dis * DISF * variacion() * (j.cambios ? 1.9 : 1))
    simular("imp", 1, (j) => j.tipo.imp * 1.1 * variacion() * (j.tipo.cant[1] > 100 ? escala(j) : 1))
    simular("cor", 1, (j) => j.tipo.cor * CORF * variacion())
    simular("ent", 1, () => 0)

    // Modo prueba (SIM_SECO=1): solo muestra la distribución, no escribe.
    if (process.env.SIM_SECO === "1") {
      const enEtapa: Record<string, number> = {}
      let cerradas = 0, aTiempo = 0, leadTotal = 0
      for (const j of jobs) {
        const actual = j.etapas.find((e) => e.fin! > ahora)
        if (!actual) {
          cerradas++
          const fin = j.etapas[j.etapas.length - 1].fin!
          leadTotal += (fin.getTime() - j.llegada.getTime()) / H
          if (fin.toISOString().slice(0, 10) <= j.objetivo) aTiempo++
          continue
        }
        const k = actual.llegada! <= ahora ? `${actual.nombre} ${actual.inicio! <= ahora ? "en proceso" : "en cola"}` : "pendiente"
        enEtapa[k] = (enEtapa[k] || 0) + 1
      }
      writeFileSync(process.env.SIM_SALIDA || "sim-seco.json", JSON.stringify({ ordenes: jobs.length, cerradas, aTiempoPct: Math.round((aTiempo / cerradas) * 100), leadPromH: Math.round(leadTotal / cerradas), enEtapa }))
      return
    }

    // 3) Carga en la base con las funciones de la app + horas simuladas.
    const resumen = { creadas: 0, cerradas: 0, enPiso: 0 }
    for (const j of jobs) {
      const notas = `SIM-PISO · ${j.urgente ? "URGENTE · " : ""}${j.conArteCliente ? "Cliente entrega arte" : "Requiere diseño"}${j.cambios ? " · Cambios del cliente" : ""}`
      const r = await createOrdenTrabajo({
        descripcion: `${j.tipo.nombre} (${j.cantidad.toLocaleString("es-HN")} ${j.tipo.unidad})`,
        cliente_id: j.cliente.id,
        cantidad_objetivo: j.cantidad,
        fecha_objetivo: j.objetivo,
        notas,
        operacion_ids: j.etapas.map((e) => e.operacion_id),
      })
      if (r.error) throw new Error(`OT ${j.n}: ${r.error}`)
      const ordenId = r.data!.id
      resumen.creadas++
      let todas = true
      for (const [i, e] of j.etapas.entries()) {
        let patch: Record<string, unknown>
        if (e.fin! <= ahora) {
          patch = { estado: "Entregada", fecha_recepcion: iso(e.llegada!), fecha_entrega: iso(e.fin!), responsable: e.resp, cantidad_procesada: j.cantidad, notas: e.op === "dis" && j.cambios ? "Cambios del cliente: segunda prueba de color" : null }
        } else if (e.llegada! <= ahora) {
          todas = false
          patch = { estado: e.inicio! <= ahora ? "En Proceso" : "Recibida", fecha_recepcion: iso(e.llegada!), fecha_entrega: null, responsable: e.inicio! <= ahora ? e.resp : null }
        } else {
          todas = false
          patch = { estado: "Pendiente", fecha_recepcion: null, fecha_entrega: null, responsable: null }
        }
        const up = await getCliente().from("produccion_orden_etapas").update(patch).eq("orden_id", ordenId).eq("orden_secuencia", i + 1)
        if (up.error) throw new Error(`etapa ${i + 1} de OT ${j.n}: ${up.error.message}`)
      }
      if (todas) resumen.cerradas++
      else resumen.enPiso++
      await getCliente().from("produccion_ordenes").update({ estado: todas ? "Cerrada" : "En Proceso", created_at: iso(j.llegada) }).eq("id", ordenId)
    }
    console.log(JSON.stringify(resumen))
    expect(resumen.creadas).toBeGreaterThan(80)
  })

  it("los indicadores muestran trabajo en cada etapa y lead times", async () => {
    const hoy = getHondurasTodayISODate()
    const rep = await getReporteFlujo({ desde: "2026-08-24", hasta: hoy })
    if (rep.error) throw new Error(rep.error)
    const flujo = await getFlujoOrdenes()
    const tablero = agruparTableroPiso(flujo.data, hoy)
    const lineas = [
      `Lead time: ${rep.data.leadTimes.terminadas} terminadas · promedio ${rep.data.leadTimes.lead_promedio_h} h · P90 ${rep.data.leadTimes.lead_p90_h} h · a tiempo ${rep.data.leadTimes.cumplimiento_pct}% · WIP ${rep.data.leadTimes.wip}`,
      `Tiempo por operación: ${rep.data.tiempos.map((t) => `${t.nombre} ${(t.promedio_min / 60).toFixed(1)} h (máx ${(t.max_min / 60).toFixed(1)} h, ${t.muestras})`).join(" · ")}`,
      `Carga actual: ${rep.data.cargas.map((c) => `${c.nombre} ${c.ordenes}`).join(" · ")}`,
      `Tablero: ${tablero.map((c) => `${c.nombre} ${c.ordenes.length}`).join(" · ")}`,
      `Semanas: ${rep.data.leadTimes.semanas.map((s) => `${s.semana} ${s.terminadas} (${s.lead_promedio_h} h, ${s.cumplimiento_pct}%)`).join(" · ")}`,
    ]
    writeFileSync("docs/SIMULACION-PISO-ULTIMA-CORRIDA.md", ["# Simulación de piso: indicadores", "", ...lineas.map((l) => `- ${l}`), ""].join("\n"))
    console.log(lineas.join("\n"))
    expect(rep.data.cargas.length).toBeGreaterThanOrEqual(3)
  })
})
