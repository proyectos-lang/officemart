import { createClient, isSupabaseConfigured } from "@/lib/supabase/client"
import { getTenantStamp, isValidStamp, SESION_INVALIDA_ERROR } from "@/lib/services/tenant-stamp"
import { getHondurasNowISO, getHondurasTodayISODate } from "@/lib/utils/honduras-time"
import { getConceptosGasto, createConceptoGasto, createGasto } from "@/lib/services/gastos"
import { getEmpleados, getNovedades, getParametrosVigentes, defNovedad, RRHH_FEATURE_PENDING, type Empleado, type Novedad, type FrecuenciaPago } from "@/lib/services/rrhh"

/**
 * Nómina (Fase 7). Cálculo PURO en `calcularNominaEmpleado` (testeado) y
 * corridas Mensual|Quincenal con estados Borrador → Aprobada → Pagada.
 *
 * Parámetros legales (Honduras, valores 2026 de referencia; la empresa los
 * versiona en Parámetros RRHH y debe validarlos con su contador):
 *   IHSS: EM 2.5 % empleado / 5 % patrono; IVM 2.5 % / 3.5 %; techo
 *         cotizable L 11,903.13 (ambos regímenes).
 *   RAP:  1.5 % empleado / 1.5 % patrono sobre el excedente del salario
 *         ordinario respecto al piso (L 11,903.13) hasta el techo (L 57,896.16).
 *   ISR:  tabla progresiva anual SAR 2026 (exento hasta L 228,324.32; 15 %,
 *         20 %, 25 %) con deducción de gastos médicos L 40,000 anual; se
 *         proyecta el salario mensual ×12 menos el IHSS del empleado.
 *   Horas extra: recargo 25 % diurna, 50 % mixta, 75 % nocturna sobre la
 *         hora ordinaria (salario / 30 días / 8 horas).
 */

// ==================== PARÁMETROS ====================

export interface TramoISR {
  /** Límite superior anual del tramo (null = sin límite). */
  hasta: number | null
  pct: number
}

export interface ParametrosNomina {
  ihss_em_empleado_pct: number
  ihss_em_patrono_pct: number
  ihss_ivm_empleado_pct: number
  ihss_ivm_patrono_pct: number
  ihss_techo_em: number
  ihss_techo_ivm: number
  rap_empleado_pct: number
  rap_patrono_pct: number
  rap_piso: number
  rap_techo: number
  isr_tramos: TramoISR[]
  isr_deduccion_medica_anual: number
  recargo_extra_diurna_pct: number
  recargo_extra_mixta_pct: number
  recargo_extra_nocturna_pct: number
  horas_jornada_diaria: number
  dias_mes: number
  salario_minimo_referencia: number
}

export const PARAMETROS_2026: ParametrosNomina = {
  ihss_em_empleado_pct: 2.5,
  ihss_em_patrono_pct: 5,
  ihss_ivm_empleado_pct: 2.5,
  ihss_ivm_patrono_pct: 3.5,
  ihss_techo_em: 11903.13,
  ihss_techo_ivm: 11903.13,
  rap_empleado_pct: 1.5,
  rap_patrono_pct: 1.5,
  rap_piso: 11903.13,
  rap_techo: 57896.16,
  isr_tramos: [
    { hasta: 228324.32, pct: 0 },
    { hasta: 348154.1, pct: 15 },
    { hasta: 809660.74, pct: 20 },
    { hasta: null, pct: 25 },
  ],
  isr_deduccion_medica_anual: 40000,
  recargo_extra_diurna_pct: 25,
  recargo_extra_mixta_pct: 50,
  recargo_extra_nocturna_pct: 75,
  horas_jornada_diaria: 8,
  dias_mes: 30,
  salario_minimo_referencia: 11903.13,
}

export const ETIQUETAS_PARAMETROS: Record<keyof Omit<ParametrosNomina, "isr_tramos">, string> = {
  ihss_em_empleado_pct: "IHSS EM · empleado (%)",
  ihss_em_patrono_pct: "IHSS EM · patrono (%)",
  ihss_ivm_empleado_pct: "IHSS IVM · empleado (%)",
  ihss_ivm_patrono_pct: "IHSS IVM · patrono (%)",
  ihss_techo_em: "IHSS techo cotizable EM (L/mes)",
  ihss_techo_ivm: "IHSS techo cotizable IVM (L/mes)",
  rap_empleado_pct: "RAP · empleado (%)",
  rap_patrono_pct: "RAP · patrono (%)",
  rap_piso: "RAP piso (excedente sobre, L/mes)",
  rap_techo: "RAP techo (L/mes)",
  isr_deduccion_medica_anual: "ISR deducción gastos médicos (L/año)",
  recargo_extra_diurna_pct: "Hora extra diurna · recargo (%)",
  recargo_extra_mixta_pct: "Hora extra mixta · recargo (%)",
  recargo_extra_nocturna_pct: "Hora extra nocturna · recargo (%)",
  horas_jornada_diaria: "Horas de jornada diaria",
  dias_mes: "Días del mes (base salarial)",
  salario_minimo_referencia: "Salario mínimo de referencia (L/mes)",
}

const r2 = (n: number) => +(Number(n) || 0).toFixed(2)
const num = (v: unknown) => Number(v) || 0

/** Completa un jsonb guardado con los valores por defecto (tolerante a versiones viejas). */
export function normalizarParametros(raw: Record<string, unknown> | null | undefined): ParametrosNomina {
  const out: ParametrosNomina = { ...PARAMETROS_2026, isr_tramos: PARAMETROS_2026.isr_tramos.map((t) => ({ ...t })) }
  if (!raw) return out
  for (const k of Object.keys(ETIQUETAS_PARAMETROS) as (keyof typeof ETIQUETAS_PARAMETROS)[]) {
    if (raw[k] != null && Number.isFinite(Number(raw[k]))) out[k] = Number(raw[k])
  }
  if (Array.isArray(raw.isr_tramos) && raw.isr_tramos.length > 0) {
    const tramos = (raw.isr_tramos as { hasta?: unknown; pct?: unknown }[])
      .map((t) => ({ hasta: t.hasta == null || t.hasta === "" ? null : Number(t.hasta), pct: Number(t.pct) || 0 }))
      .filter((t) => t.hasta == null || Number.isFinite(t.hasta))
    if (tramos.length > 0) out.isr_tramos = tramos
  }
  return out
}

// ==================== CÁLCULOS PUROS ====================

export function valorHora(salarioMensual: number, p: ParametrosNomina): number {
  const horasMes = (p.dias_mes || 30) * (p.horas_jornada_diaria || 8)
  return horasMes > 0 ? salarioMensual / horasMes : 0
}

export function calcularHorasExtra(salarioMensual: number, horas: { diurna?: number; mixta?: number; nocturna?: number }, p: ParametrosNomina): { diurna: number; mixta: number; nocturna: number; total: number } {
  const vh = valorHora(salarioMensual, p)
  const diurna = r2((horas.diurna || 0) * vh * (1 + p.recargo_extra_diurna_pct / 100))
  const mixta = r2((horas.mixta || 0) * vh * (1 + p.recargo_extra_mixta_pct / 100))
  const nocturna = r2((horas.nocturna || 0) * vh * (1 + p.recargo_extra_nocturna_pct / 100))
  return { diurna, mixta, nocturna, total: r2(diurna + mixta + nocturna) }
}

/** IHSS mensual sobre el salario cotizable (cada régimen con su techo). */
export function calcularIHSS(salarioMensualCotizable: number, p: ParametrosNomina): { em_empleado: number; em_patrono: number; ivm_empleado: number; ivm_patrono: number; empleado: number; patrono: number } {
  const baseEM = Math.max(0, Math.min(salarioMensualCotizable, p.ihss_techo_em || Infinity))
  const baseIVM = Math.max(0, Math.min(salarioMensualCotizable, p.ihss_techo_ivm || Infinity))
  const em_empleado = r2(baseEM * p.ihss_em_empleado_pct / 100)
  const em_patrono = r2(baseEM * p.ihss_em_patrono_pct / 100)
  const ivm_empleado = r2(baseIVM * p.ihss_ivm_empleado_pct / 100)
  const ivm_patrono = r2(baseIVM * p.ihss_ivm_patrono_pct / 100)
  return { em_empleado, em_patrono, ivm_empleado, ivm_patrono, empleado: r2(em_empleado + ivm_empleado), patrono: r2(em_patrono + ivm_patrono) }
}

/** RAP mensual: % sobre el excedente del salario respecto al piso, hasta el techo. */
export function calcularRAP(salarioMensualCotizable: number, p: ParametrosNomina): { base: number; empleado: number; patrono: number } {
  const tope = p.rap_techo > 0 ? Math.min(salarioMensualCotizable, p.rap_techo) : salarioMensualCotizable
  const base = r2(Math.max(0, tope - (p.rap_piso || 0)))
  return { base, empleado: r2(base * p.rap_empleado_pct / 100), patrono: r2(base * p.rap_patrono_pct / 100) }
}

/** ISR anual con tabla progresiva (tramos ordenados por `hasta`). */
export function calcularISRAnual(rentaNetaGravableAnual: number, tramos: TramoISR[]): number {
  let restante = Math.max(0, rentaNetaGravableAnual)
  let inferior = 0
  let isr = 0
  for (const t of tramos) {
    const ancho = t.hasta == null ? restante : Math.max(0, t.hasta - inferior)
    const porcion = Math.min(restante, ancho)
    isr += porcion * (t.pct / 100)
    restante -= porcion
    if (t.hasta != null) inferior = t.hasta
    if (restante <= 0) break
  }
  return r2(isr)
}

/**
 * ISR del mes: el salario regular se proyecta ×12 (menos IHSS del empleado
 * ×12 y la deducción médica); los ingresos extraordinarios gravables del mes
 * tributan a la tasa marginal (se suman al proyectado sin multiplicarse).
 */
export function calcularISRMensual(input: { salarioMensualGravable: number; extrasGravablesMes?: number; ihssEmpleadoMensual: number }, p: ParametrosNomina): number {
  const baseRegular = Math.max(0, (input.salarioMensualGravable - input.ihssEmpleadoMensual) * 12 - (p.isr_deduccion_medica_anual || 0))
  const isrRegular = calcularISRAnual(baseRegular, p.isr_tramos)
  const extras = Math.max(0, input.extrasGravablesMes || 0)
  const isrConExtras = extras > 0 ? calcularISRAnual(baseRegular + extras, p.isr_tramos) : isrRegular
  return r2(isrRegular / 12 + (isrConExtras - isrRegular))
}

export interface PeriodoNomina {
  tipo: FrecuenciaPago
  desde: string
  hasta: string
}

export interface LineaNomina {
  concepto: string
  tipo: "ingreso" | "deduccion" | "patronal" | "info"
  cantidad?: number | null
  monto: number
  novedad_id?: number | null
}

export interface CalculoEmpleado {
  empleado_id: number
  empleado_nombre: string
  salario_mensual: number
  dias_periodo: number
  dias_no_pagados: number
  salario_periodo: number
  horas_extra: number
  otros_ingresos: number
  total_devengado: number
  ihss_empleado: number
  rap_empleado: number
  isr: number
  otras_deducciones: number
  total_deducciones: number
  neto: number
  ihss_patronal: number
  rap_patronal: number
  lineas: LineaNomina[]
  novedad_ids: number[]
}

function diasEntre(a: string, b: string): number {
  const [ay, am, ad] = a.slice(0, 10).split("-").map(Number)
  const [by, bm, bd] = b.slice(0, 10).split("-").map(Number)
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000)
}

/** Días del período que el empleado no estuvo contratado (alta/baja dentro del período). */
export function diasFueraDeContrato(emp: { fecha_ingreso?: string | null; fecha_salida?: string | null }, periodo: PeriodoNomina, diasPeriodo: number): number {
  let fuera = 0
  if (emp.fecha_ingreso && emp.fecha_ingreso > periodo.desde) fuera += Math.max(0, diasEntre(periodo.desde, emp.fecha_ingreso))
  if (emp.fecha_salida && emp.fecha_salida < periodo.hasta) fuera += Math.max(0, diasEntre(emp.fecha_salida, periodo.hasta))
  return Math.min(diasPeriodo, fuera)
}

/** Cálculo completo de un empleado en un período (PURO). */
export function calcularNominaEmpleado(emp: Empleado, novedades: Novedad[], periodo: PeriodoNomina, p: ParametrosNomina): CalculoEmpleado {
  const factor = periodo.tipo === "Quincenal" ? 0.5 : 1
  const diasMes = p.dias_mes || 30
  const dias_periodo = r2(diasMes * factor)
  const salarioMensual = r2(num(emp.salario_mensual))
  const lineas: LineaNomina[] = []
  const novedad_ids: number[] = []

  // Días no pagados: fuera de contrato + ausencias/permisos sin goce.
  let diasNoPagados = diasFueraDeContrato(emp, periodo, dias_periodo)
  const horas = { diurna: 0, mixta: 0, nocturna: 0 }
  let otrosIngresos = 0
  let otrasDeducciones = 0
  let extrasCotizables = 0
  let extrasGravables = 0
  let horasExtraCotizables = true
  let horasExtraGravables = true

  for (const n of novedades) {
    if (n.empleado_id !== emp.id) continue
    const def = defNovedad(n.tipo)
    if (n.id != null) novedad_ids.push(n.id)
    if (def.efecto === "dias") {
      diasNoPagados += num(n.cantidad)
      lineas.push({ concepto: `${n.tipo}${n.descripcion ? ` · ${n.descripcion}` : ""}`, tipo: "info", cantidad: num(n.cantidad), monto: 0, novedad_id: n.id ?? null })
    } else if (def.efecto === "info") {
      lineas.push({ concepto: `${n.tipo}${n.descripcion ? ` · ${n.descripcion}` : ""}`, tipo: "info", cantidad: num(n.cantidad), monto: 0, novedad_id: n.id ?? null })
    } else if (def.efecto === "ingreso" && def.unidad === "horas") {
      if (n.tipo === "Horas extra diurna") horas.diurna += num(n.cantidad)
      else if (n.tipo === "Horas extra mixta") horas.mixta += num(n.cantidad)
      else horas.nocturna += num(n.cantidad)
      horasExtraCotizables = horasExtraCotizables && n.cotizable
      horasExtraGravables = horasExtraGravables && n.gravable
    } else if (def.efecto === "ingreso") {
      // Ingresos por días (liquidación de vacaciones): días × salario diario.
      const monto = def.unidad === "dias" ? r2(num(n.cantidad) * (salarioMensual / diasMes)) : r2(num(n.monto))
      otrosIngresos += monto
      if (n.cotizable) extrasCotizables += monto
      if (n.gravable) extrasGravables += monto
      lineas.push({ concepto: `${n.tipo}${n.descripcion ? ` · ${n.descripcion}` : ""}`, tipo: "ingreso", cantidad: def.unidad === "dias" ? num(n.cantidad) : null, monto, novedad_id: n.id ?? null })
    } else if (def.efecto === "deduccion") {
      const monto = r2(num(n.monto))
      otrasDeducciones += monto
      lineas.push({ concepto: `${n.tipo}${n.descripcion ? ` · ${n.descripcion}` : ""}`, tipo: "deduccion", monto, novedad_id: n.id ?? null })
    }
  }
  diasNoPagados = Math.min(dias_periodo, r2(diasNoPagados))

  const salarioDiario = salarioMensual / diasMes
  const salario_periodo = r2(Math.max(0, salarioMensual * factor - salarioDiario * diasNoPagados))
  lineas.unshift({ concepto: `Salario ${periodo.tipo === "Quincenal" ? "quincenal" : "mensual"}${diasNoPagados > 0 ? ` (${r2(dias_periodo - diasNoPagados)} de ${dias_periodo} días)` : ""}`, tipo: "ingreso", cantidad: r2(dias_periodo - diasNoPagados), monto: salario_periodo })

  const he = calcularHorasExtra(salarioMensual, horas, p)
  if (he.diurna > 0) lineas.push({ concepto: `Horas extra diurna (+${p.recargo_extra_diurna_pct}%)`, tipo: "ingreso", cantidad: horas.diurna, monto: he.diurna })
  if (he.mixta > 0) lineas.push({ concepto: `Horas extra mixta (+${p.recargo_extra_mixta_pct}%)`, tipo: "ingreso", cantidad: horas.mixta, monto: he.mixta })
  if (he.nocturna > 0) lineas.push({ concepto: `Horas extra nocturna (+${p.recargo_extra_nocturna_pct}%)`, tipo: "ingreso", cantidad: horas.nocturna, monto: he.nocturna })
  if (horasExtraCotizables) extrasCotizables += he.total
  if (horasExtraGravables) extrasGravables += he.total

  const total_devengado = r2(salario_periodo + he.total + otrosIngresos)

  // Contribuciones sobre el equivalente mensual del período.
  const baseCotizableMensual = (salario_periodo + extrasCotizables) / factor
  const ihss = emp.aplica_ihss ? calcularIHSS(baseCotizableMensual, p) : { em_empleado: 0, em_patrono: 0, ivm_empleado: 0, ivm_patrono: 0, empleado: 0, patrono: 0 }
  const rap = emp.aplica_rap ? calcularRAP(baseCotizableMensual, p) : { base: 0, empleado: 0, patrono: 0 }
  const ihss_empleado = r2(ihss.empleado * factor)
  const rap_empleado = r2(rap.empleado * factor)
  const ihss_patronal = r2(ihss.patrono * factor)
  const rap_patronal = r2(rap.patrono * factor)

  const salarioMensualGravable = salario_periodo / factor
  const isr = emp.aplica_isr
    ? r2(calcularISRMensual({ salarioMensualGravable, extrasGravablesMes: extrasGravables, ihssEmpleadoMensual: ihss.empleado }, p) * factor)
    : 0

  if (ihss_empleado > 0) {
    lineas.push({ concepto: `IHSS EM empleado (${p.ihss_em_empleado_pct}%)`, tipo: "deduccion", monto: r2(ihss.em_empleado * factor) })
    lineas.push({ concepto: `IHSS IVM empleado (${p.ihss_ivm_empleado_pct}%)`, tipo: "deduccion", monto: r2(ihss.ivm_empleado * factor) })
  }
  if (rap_empleado > 0) lineas.push({ concepto: `RAP empleado (${p.rap_empleado_pct}% sobre excedente)`, tipo: "deduccion", monto: rap_empleado })
  if (isr > 0) lineas.push({ concepto: "ISR retenido", tipo: "deduccion", monto: isr })
  if (ihss_patronal > 0) lineas.push({ concepto: `IHSS patronal (${p.ihss_em_patrono_pct}% + ${p.ihss_ivm_patrono_pct}%)`, tipo: "patronal", monto: ihss_patronal })
  if (rap_patronal > 0) lineas.push({ concepto: `RAP patronal (${p.rap_patrono_pct}%)`, tipo: "patronal", monto: rap_patronal })

  const total_deducciones = r2(ihss_empleado + rap_empleado + isr + otrasDeducciones)
  return {
    empleado_id: emp.id ?? 0,
    empleado_nombre: emp.nombre,
    salario_mensual: salarioMensual,
    dias_periodo,
    dias_no_pagados: diasNoPagados,
    salario_periodo,
    horas_extra: he.total,
    otros_ingresos: r2(otrosIngresos),
    total_devengado,
    ihss_empleado,
    rap_empleado,
    isr,
    otras_deducciones: r2(otrasDeducciones),
    total_deducciones,
    neto: r2(total_devengado - total_deducciones),
    ihss_patronal,
    rap_patronal,
    lineas,
    novedad_ids,
  }
}

export function totalesNomina(detalles: Pick<CalculoEmpleado, "total_devengado" | "total_deducciones" | "neto" | "ihss_patronal" | "rap_patronal" | "ihss_empleado" | "rap_empleado" | "isr">[]): { devengado: number; deducciones: number; neto: number; patronal: number; retenciones: number } {
  const s = (f: (d: (typeof detalles)[number]) => number) => r2(detalles.reduce((a, d) => a + f(d), 0))
  return {
    devengado: s((d) => d.total_devengado),
    deducciones: s((d) => d.total_deducciones),
    neto: s((d) => d.neto),
    patronal: s((d) => d.ihss_patronal + d.rap_patronal),
    retenciones: s((d) => d.ihss_empleado + d.rap_empleado + d.isr),
  }
}

/** Aguinaldo (13.º/14.º) proporcional: salario mensual × meses trabajados en la ventana / 12. */
export function calcularAguinaldoProporcional(salarioMensual: number, fechaIngreso: string | null | undefined, ventana: { desde: string; hasta: string }): { meses: number; monto: number } {
  const inicio = fechaIngreso && fechaIngreso > ventana.desde ? fechaIngreso : ventana.desde
  const dias = Math.max(0, diasEntre(inicio, ventana.hasta) + 1)
  const meses = Math.min(12, r2(dias / 30))
  return { meses, monto: r2((salarioMensual * meses) / 12) }
}

// ==================== I/O ====================

export type EstadoNomina = "Borrador" | "Aprobada" | "Pagada" | "Anulada"

export interface Nomina {
  id: number
  tipo: FrecuenciaPago
  periodo_desde: string
  periodo_hasta: string
  fecha_pago: string | null
  estado: EstadoNomina
  total_devengado: number
  total_deducciones: number
  total_neto: number
  total_patronal: number
  parametros_id: number | null
  gasto_id: number | null
  notas: string | null
  aprobada_at: string | null
  pagada_at: string | null
  anulada_at: string | null
  motivo_anulacion: string | null
  created_at: string
  empleados?: number
}

export interface NominaDetalle extends Omit<CalculoEmpleado, "novedad_ids"> {
  id: number
  nomina_id: number
}

function isMissingTable(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false
  const msg = (err.message || "").toLowerCase()
  return err.code === "42P01" || err.code === "PGRST205" || msg.includes("could not find the table") || (msg.includes("schema cache") && !msg.includes("relationship"))
}

function mapNomina(r: Record<string, unknown>): Nomina {
  const det = r.rrhh_nominas_detalle as { count?: number }[] | undefined
  return {
    id: Number(r.id),
    tipo: ((r.tipo as string) || "Mensual") as FrecuenciaPago,
    periodo_desde: String(r.periodo_desde ?? ""),
    periodo_hasta: String(r.periodo_hasta ?? ""),
    fecha_pago: (r.fecha_pago as string | null) ?? null,
    estado: ((r.estado as string) || "Borrador") as EstadoNomina,
    total_devengado: num(r.total_devengado),
    total_deducciones: num(r.total_deducciones),
    total_neto: num(r.total_neto),
    total_patronal: num(r.total_patronal),
    parametros_id: r.parametros_id != null ? Number(r.parametros_id) : null,
    gasto_id: r.gasto_id != null ? Number(r.gasto_id) : null,
    notas: (r.notas as string | null) ?? null,
    aprobada_at: (r.aprobada_at as string | null) ?? null,
    pagada_at: (r.pagada_at as string | null) ?? null,
    anulada_at: (r.anulada_at as string | null) ?? null,
    motivo_anulacion: (r.motivo_anulacion as string | null) ?? null,
    created_at: String(r.created_at ?? ""),
    empleados: Array.isArray(det) && det[0] && typeof det[0].count === "number" ? det[0].count : undefined,
  }
}

function mapDetalle(r: Record<string, unknown>): NominaDetalle {
  return {
    id: Number(r.id),
    nomina_id: Number(r.nomina_id),
    empleado_id: Number(r.empleado_id),
    empleado_nombre: String(r.empleado_nombre ?? ""),
    salario_mensual: num(r.salario_mensual),
    dias_periodo: num(r.dias_periodo),
    dias_no_pagados: num(r.dias_no_pagados),
    salario_periodo: num(r.salario_periodo),
    horas_extra: num(r.horas_extra),
    otros_ingresos: num(r.otros_ingresos),
    total_devengado: num(r.total_devengado),
    ihss_empleado: num(r.ihss_empleado),
    rap_empleado: num(r.rap_empleado),
    isr: num(r.isr),
    otras_deducciones: num(r.otras_deducciones),
    total_deducciones: num(r.total_deducciones),
    neto: num(r.neto),
    ihss_patronal: num(r.ihss_patronal),
    rap_patronal: num(r.rap_patronal),
    lineas: Array.isArray(r.lineas) ? (r.lineas as LineaNomina[]) : [],
  }
}

export async function getNominas(): Promise<{ data: Nomina[]; error: string | null; pendiente?: boolean }> {
  if (!isSupabaseConfigured()) return { data: [], error: null }
  const supabase = createClient()
  if (!supabase) return { data: [], error: "Cliente no disponible" }
  const { data, error } = await supabase.from("rrhh_nominas").select("*, rrhh_nominas_detalle(count)").order("periodo_hasta", { ascending: false }).order("id", { ascending: false })
  if (error) {
    if (isMissingTable(error)) return { data: [], error: RRHH_FEATURE_PENDING, pendiente: true }
    return { data: [], error: error.message }
  }
  return { data: (data as Record<string, unknown>[]).map(mapNomina), error: null }
}

export async function getNominaCompleta(id: number): Promise<{ data: { nomina: Nomina; detalle: NominaDetalle[] } | null; error: string | null }> {
  const supabase = createClient()
  if (!supabase) return { data: null, error: "Cliente no disponible" }
  const [n, d] = await Promise.all([
    supabase.from("rrhh_nominas").select("*").eq("id", id).maybeSingle(),
    supabase.from("rrhh_nominas_detalle").select("*").eq("nomina_id", id).order("empleado_nombre"),
  ])
  if (n.error || !n.data) return { data: null, error: n.error?.message ?? "Nómina no encontrada" }
  if (d.error) return { data: null, error: d.error.message }
  return { data: { nomina: mapNomina(n.data as Record<string, unknown>), detalle: (d.data as Record<string, unknown>[]).map(mapDetalle) }, error: null }
}

/** Empleados que entran en una corrida: activos (o con salida dentro del período) de esa frecuencia, con ingreso ≤ hasta. */
export function empleadosDelPeriodo(empleados: Empleado[], periodo: PeriodoNomina): Empleado[] {
  return empleados.filter((e) => {
    if (e.frecuencia_pago !== periodo.tipo) return false
    if (e.fecha_ingreso && e.fecha_ingreso > periodo.hasta) return false
    if (e.estado === "Inactivo") return !!e.fecha_salida && e.fecha_salida >= periodo.desde
    return !e.fecha_salida || e.fecha_salida >= periodo.desde
  })
}

/**
 * Empleados que YA están en otra nómina vigente (no anulada) del mismo tipo y
 * período. Una segunda corrida del período es COMPLEMENTARIA: solo incluye a
 * los que faltan (altas a mitad de mes, omisiones).
 */
async function empleadosYaIncluidos(periodo: PeriodoNomina, excluirNominaId?: number): Promise<{ ids: Set<number>; hayOtras: boolean; error: string | null }> {
  const supabase = createClient()
  if (!supabase) return { ids: new Set(), hayOtras: false, error: "Cliente no disponible" }
  let q = supabase.from("rrhh_nominas").select("id").eq("tipo", periodo.tipo).eq("periodo_desde", periodo.desde).eq("periodo_hasta", periodo.hasta).neq("estado", "Anulada")
  if (excluirNominaId != null) q = q.neq("id", excluirNominaId)
  const { data, error } = await q
  if (error) return { ids: new Set(), hayOtras: false, error: isMissingTable(error) ? RRHH_FEATURE_PENDING : error.message }
  const nominaIds = ((data || []) as { id: number }[]).map((n) => n.id)
  if (nominaIds.length === 0) return { ids: new Set(), hayOtras: false, error: null }
  const det = await supabase.from("rrhh_nominas_detalle").select("empleado_id").in("nomina_id", nominaIds)
  if (det.error) return { ids: new Set(), hayOtras: true, error: det.error.message }
  return { ids: new Set(((det.data || []) as { empleado_id: number }[]).map((d) => Number(d.empleado_id))), hayOtras: true, error: null }
}

async function calcularCorrida(periodo: PeriodoNomina, excluir: Set<number> = new Set()): Promise<{ calculos: CalculoEmpleado[]; parametrosId: number | null; error: string | null }> {
  const [empRes, novRes, parRes] = await Promise.all([getEmpleados(), getNovedades({ hasta: periodo.hasta, sinAplicar: true }), getParametrosVigentes(periodo.hasta)])
  if (empRes.error) return { calculos: [], parametrosId: null, error: empRes.error }
  if (novRes.error) return { calculos: [], parametrosId: null, error: novRes.error }
  const p = normalizarParametros(parRes.data?.parametros ?? null)
  const empleados = empleadosDelPeriodo(empRes.data, periodo).filter((e) => e.id == null || !excluir.has(e.id))
  if (empleados.length === 0) {
    return { calculos: [], parametrosId: null, error: excluir.size > 0 ? "Todos los empleados de este período ya están en una nómina vigente." : `No hay empleados activos con pago ${periodo.tipo.toLowerCase()} en el período.` }
  }
  const calculos = empleados.map((e) => calcularNominaEmpleado(e, novRes.data, periodo, p))
  return { calculos, parametrosId: parRes.data?.id ?? null, error: null }
}

export async function generarNomina(input: { tipo: FrecuenciaPago; desde: string; hasta: string; fecha_pago?: string | null; notas?: string | null }): Promise<{ data: Nomina | null; error: string | null }> {
  const supabase = createClient()
  if (!supabase) return { data: null, error: "Cliente no disponible" }
  const stamp = await getTenantStamp(supabase)
  if (!isValidStamp(stamp)) return { data: null, error: SESION_INVALIDA_ERROR }
  if (!input.desde || !input.hasta || input.desde > input.hasta) return { data: null, error: "Período inválido" }

  const periodo: PeriodoNomina = { tipo: input.tipo, desde: input.desde, hasta: input.hasta }
  // Si ya hay nómina vigente del período, esta es COMPLEMENTARIA (solo los que faltan).
  const previos = await empleadosYaIncluidos(periodo)
  if (previos.error) return { data: null, error: previos.error }
  const { calculos, parametrosId, error } = await calcularCorrida(periodo, previos.ids)
  if (error) return { data: null, error }
  const tot = totalesNomina(calculos)
  const ahora = getHondurasNowISO()
  const ins = await supabase
    .from("rrhh_nominas")
    .insert({
      razon_social_id: stamp.razon_social_id, usuario: stamp.usuario, tipo: input.tipo, periodo_desde: input.desde, periodo_hasta: input.hasta,
      fecha_pago: input.fecha_pago || null, estado: "Borrador", total_devengado: tot.devengado, total_deducciones: tot.deducciones, total_neto: tot.neto,
      total_patronal: tot.patronal, parametros_id: parametrosId, notas: [previos.hayOtras ? "Complementaria" : "", (input.notas || "").trim()].filter(Boolean).join(" · ") || null, created_at: ahora,
    })
    .select("*")
    .single()
  if (ins.error || !ins.data) return { data: null, error: ins.error?.message ?? "No se pudo crear la nómina" }
  const nominaId = Number((ins.data as { id: number }).id)
  const err = await guardarDetalle(nominaId, calculos, stamp.razon_social_id as number)
  if (err) {
    await supabase.from("rrhh_nominas").delete().eq("id", nominaId)
    return { data: null, error: err }
  }
  return { data: mapNomina(ins.data as Record<string, unknown>), error: null }
}

async function guardarDetalle(nominaId: number, calculos: CalculoEmpleado[], tenantId: number): Promise<string | null> {
  const supabase = createClient()
  if (!supabase) return "Cliente no disponible"
  const filas = calculos.map(({ novedad_ids: _n, ...c }) => ({ ...c, razon_social_id: tenantId, nomina_id: nominaId }))
  const det = await supabase.from("rrhh_nominas_detalle").insert(filas)
  if (det.error) return det.error.message
  const ids = calculos.flatMap((c) => c.novedad_ids)
  if (ids.length > 0) {
    const upd = await supabase.from("rrhh_novedades").update({ nomina_id: nominaId }).in("id", ids).is("nomina_id", null)
    if (upd.error) return upd.error.message
  }
  return null
}

/** Recalcula un Borrador con los datos actuales (empleados, novedades, parámetros). */
export async function recalcularNomina(id: number): Promise<{ data: Nomina | null; error: string | null }> {
  const supabase = createClient()
  if (!supabase) return { data: null, error: "Cliente no disponible" }
  const stamp = await getTenantStamp(supabase)
  if (!isValidStamp(stamp)) return { data: null, error: SESION_INVALIDA_ERROR }
  const actual = await supabase.from("rrhh_nominas").select("*").eq("id", id).maybeSingle()
  if (actual.error || !actual.data) return { data: null, error: actual.error?.message ?? "Nómina no encontrada" }
  const n = mapNomina(actual.data as Record<string, unknown>)
  if (n.estado !== "Borrador") return { data: null, error: "Solo se recalcula un borrador" }
  await supabase.from("rrhh_novedades").update({ nomina_id: null }).eq("nomina_id", id)
  await supabase.from("rrhh_nominas_detalle").delete().eq("nomina_id", id)
  const periodoN: PeriodoNomina = { tipo: n.tipo, desde: n.periodo_desde, hasta: n.periodo_hasta }
  const otras = await empleadosYaIncluidos(periodoN, id)
  if (otras.error) return { data: null, error: otras.error }
  const { calculos, parametrosId, error } = await calcularCorrida(periodoN, otras.ids)
  if (error) return { data: null, error }
  const err = await guardarDetalle(id, calculos, stamp.razon_social_id as number)
  if (err) return { data: null, error: err }
  const tot = totalesNomina(calculos)
  const upd = await supabase.from("rrhh_nominas").update({ total_devengado: tot.devengado, total_deducciones: tot.deducciones, total_neto: tot.neto, total_patronal: tot.patronal, parametros_id: parametrosId, updated_at: getHondurasNowISO() }).eq("id", id).select("*").single()
  if (upd.error) return { data: null, error: upd.error.message }
  return { data: mapNomina(upd.data as Record<string, unknown>), error: null }
}

export async function aprobarNomina(id: number): Promise<{ success: boolean; error: string | null }> {
  const supabase = createClient()
  if (!supabase) return { success: false, error: "Cliente no disponible" }
  const ahora = getHondurasNowISO()
  const { data, error } = await supabase.from("rrhh_nominas").update({ estado: "Aprobada", aprobada_at: ahora, updated_at: ahora }).eq("id", id).eq("estado", "Borrador").select("id")
  if (error) return { success: false, error: error.message }
  if (!data || data.length === 0) return { success: false, error: "La nómina no está en borrador" }
  return { success: true, error: null }
}

async function ensureConcepto(nombre: string): Promise<number | null> {
  const { data: conceptos } = await getConceptosGasto()
  const ex = (conceptos || []).find((c) => (c.nombre || "").trim().toLowerCase() === nombre.toLowerCase())
  if (ex?.id != null) return ex.id
  const { data } = await createConceptoGasto({ nombre, categoria_macro: "Nomina" })
  return data?.id ?? null
}

/**
 * Paga la nómina: gasto "Sueldos y salarios" (neto, pagado ahora desde caja o
 * banco) + gasto "Cargas sociales y retenciones" (IHSS/RAP patronal y
 * retenciones del empleado) pendiente de pago a IHSS/RAP/SAR.
 */
export async function pagarNomina(id: number, pago: { metodo: "Efectivo" | "Banco"; cuenta_id?: number | null; fecha?: string | null }): Promise<{ success: boolean; error: string | null; gasto_id?: number | null }> {
  const supabase = createClient()
  if (!supabase) return { success: false, error: "Cliente no disponible" }
  const res = await getNominaCompleta(id)
  if (res.error || !res.data) return { success: false, error: res.error ?? "Nómina no encontrada" }
  const { nomina, detalle } = res.data
  if (nomina.estado !== "Aprobada") return { success: false, error: "Aprueba la nómina antes de pagarla" }
  if (pago.metodo === "Banco" && !pago.cuenta_id) return { success: false, error: "Elige la cuenta bancaria" }
  const fecha = pago.fecha || nomina.fecha_pago || getHondurasTodayISODate()
  const etiqueta = `Nómina ${nomina.tipo.toLowerCase()} ${nomina.periodo_desde} a ${nomina.periodo_hasta} (#${nomina.id})`

  const cSueldos = await ensureConcepto("Sueldos y salarios")
  if (cSueldos == null) return { success: false, error: "No se pudo crear el concepto de gasto de nómina" }
  const g1 = await createGasto({
    concepto_id: cSueldos,
    fecha_gasto: fecha,
    monto: nomina.total_neto,
    metodo_pago: pago.metodo === "Banco" ? "Transferencia" : "Efectivo",
    descripcion: `${etiqueta} · neto ${detalle.length} empleado(s)`,
    pagar_ahora: true,
    pago_metodo: pago.metodo,
    pago_cuenta_id: pago.metodo === "Banco" ? pago.cuenta_id ?? null : null,
  })
  if (g1.error || !g1.data) return { success: false, error: g1.error ?? "No se pudo registrar el pago" }

  const tot = totalesNomina(detalle)
  const cargas = r2(tot.patronal + tot.retenciones)
  if (cargas > 0) {
    const cCargas = await ensureConcepto("Cargas sociales y retenciones")
    if (cCargas != null) {
      const g2 = await createGasto({
        concepto_id: cCargas,
        fecha_gasto: fecha,
        monto: cargas,
        metodo_pago: "Transferencia",
        descripcion: `${etiqueta} · IHSS/RAP patronal ${tot.patronal.toFixed(2)} + retenciones empleado ${tot.retenciones.toFixed(2)} (por pagar a IHSS/RAP/SAR)`,
        pagar_ahora: false,
      })
      if (g2.error) console.warn("[nomina] gasto de cargas no creado:", g2.error)
    }
  }

  const ahora = getHondurasNowISO()
  const { error } = await supabase.from("rrhh_nominas").update({ estado: "Pagada", pagada_at: ahora, fecha_pago: fecha, gasto_id: g1.data.id ?? null, updated_at: ahora }).eq("id", id)
  if (error) return { success: false, error: error.message }
  return { success: true, error: null, gasto_id: g1.data.id ?? null }
}

/** Anula Borrador/Aprobada y libera sus novedades. Una nómina Pagada no se anula (revierte el gasto primero). */
export async function anularNomina(id: number, motivo: string): Promise<{ success: boolean; error: string | null }> {
  const supabase = createClient()
  if (!supabase) return { success: false, error: "Cliente no disponible" }
  if (!(motivo || "").trim()) return { success: false, error: "Indica el motivo" }
  const ahora = getHondurasNowISO()
  const { data, error } = await supabase
    .from("rrhh_nominas")
    .update({ estado: "Anulada", anulada_at: ahora, motivo_anulacion: motivo.trim(), updated_at: ahora })
    .eq("id", id)
    .in("estado", ["Borrador", "Aprobada"])
    .select("id")
  if (error) return { success: false, error: error.message }
  if (!data || data.length === 0) return { success: false, error: "Solo se anulan nóminas en borrador o aprobadas (una pagada requiere anular el gasto)" }
  await supabase.from("rrhh_novedades").update({ nomina_id: null }).eq("nomina_id", id)
  return { success: true, error: null }
}

/** Filas para la planilla Excel. */
export function planillaRows(nomina: Nomina, detalle: NominaDetalle[]): Record<string, unknown>[] {
  return detalle.map((d) => ({
    Empleado: d.empleado_nombre,
    "Salario mensual": d.salario_mensual,
    "Días pagados": r2(d.dias_periodo - d.dias_no_pagados),
    "Salario período": d.salario_periodo,
    "Horas extra": d.horas_extra,
    "Otros ingresos": d.otros_ingresos,
    "Total devengado": d.total_devengado,
    "IHSS empleado": d.ihss_empleado,
    "RAP empleado": d.rap_empleado,
    ISR: d.isr,
    "Otras deducciones": d.otras_deducciones,
    "Total deducciones": d.total_deducciones,
    Neto: d.neto,
    "IHSS patronal": d.ihss_patronal,
    "RAP patronal": d.rap_patronal,
    Período: `${nomina.periodo_desde} a ${nomina.periodo_hasta}`,
    Tipo: nomina.tipo,
    Estado: nomina.estado,
  }))
}
