import { describe, it, expect } from "vitest"
import {
  PARAMETROS_2026, normalizarParametros, calcularIHSS, calcularRAP, calcularISRAnual, calcularISRMensual,
  calcularHorasExtra, calcularNominaEmpleado, totalesNomina, calcularAguinaldoProporcional, diasFueraDeContrato, empleadosDelPeriodo,
} from "@/lib/services/nomina"
import { calcularSaldoVacaciones, calcularHoras, documentosPorVencer, antiguedadAnios, diasVacacionesPorAntiguedad, mapearMarcacionesImportadas, resolverEmpleado, type Empleado, type Novedad } from "@/lib/services/rrhh"

const P = PARAMETROS_2026

function emp(p: Partial<Empleado>): Empleado {
  return { id: 1, nombre: "Ana", tipo_contrato: "Permanente", salario_mensual: 20000, frecuencia_pago: "Mensual", forma_pago: "Transferencia", aplica_ihss: true, aplica_rap: true, aplica_isr: true, estado: "Activo", ...p }
}
function nov(p: Partial<Novedad>): Novedad {
  return { id: 1, empleado_id: 1, tipo: "Bono", fecha: "2026-09-10", gravable: true, cotizable: true, ...p }
}
const MES = { tipo: "Mensual" as const, desde: "2026-09-01", hasta: "2026-09-30" }

describe("contribuciones 2026", () => {
  it("IHSS se topa en L 11,903.13 (máximo L 595.16 del empleado)", () => {
    expect(calcularIHSS(20000, P)).toMatchObject({ em_empleado: 297.58, ivm_empleado: 297.58, empleado: 595.16, em_patrono: 595.16, ivm_patrono: 416.61, patrono: 1011.77 })
    expect(calcularIHSS(8000, P).empleado).toBe(400)
  })
  it("RAP: 1.5 % sobre el excedente del piso, hasta el techo", () => {
    expect(calcularRAP(11903.13, P)).toEqual({ base: 0, empleado: 0, patrono: 0 })
    expect(calcularRAP(20000, P)).toMatchObject({ base: 8096.87, empleado: 121.45, patrono: 121.45 })
    expect(calcularRAP(100000, P).base).toBe(45993.03) // 57,896.16 − 11,903.13
  })
  it("ISR anual progresivo", () => {
    expect(calcularISRAnual(200000, P.isr_tramos)).toBe(0)
    expect(calcularISRAnual(228324.32, P.isr_tramos)).toBe(0)
    expect(calcularISRAnual(328324.32, P.isr_tramos)).toBe(15000) // 100,000 al 15 %
    const t20 = (348154.1 - 228324.32) * 0.15 + (432858.08 - 348154.1) * 0.2
    expect(calcularISRAnual(432858.08, P.isr_tramos)).toBeCloseTo(t20, 2)
  })
  it("ISR mensual: L 20,000 no paga; L 40,000 sí", () => {
    expect(calcularISRMensual({ salarioMensualGravable: 20000, ihssEmpleadoMensual: 595.16 }, P)).toBe(0)
    const anual = calcularISRAnual((40000 - 595.16) * 12 - 40000, P.isr_tramos)
    expect(calcularISRMensual({ salarioMensualGravable: 40000, ihssEmpleadoMensual: 595.16 }, P)).toBeCloseTo(anual / 12, 1)
  })
  it("los extras gravables tributan a la tasa marginal sin proyectarse ×12", () => {
    const sin = calcularISRMensual({ salarioMensualGravable: 40000, ihssEmpleadoMensual: 595.16 }, P)
    const con = calcularISRMensual({ salarioMensualGravable: 40000, ihssEmpleadoMensual: 595.16, extrasGravablesMes: 10000 }, P)
    expect(con - sin).toBeCloseTo(10000 * 0.2, 1)
  })
  it("horas extra sobre hora ordinaria (salario/240)", () => {
    const he = calcularHorasExtra(24000, { diurna: 2, mixta: 1, nocturna: 1 }, P) // hora = 100
    expect(he).toEqual({ diurna: 250, mixta: 150, nocturna: 175, total: 575 })
  })
  it("normalizarParametros tolera jsonb parcial", () => {
    const p = normalizarParametros({ rap_piso: "12000", isr_tramos: [{ hasta: "", pct: 10 }] })
    expect(p.rap_piso).toBe(12000)
    expect(p.ihss_techo_em).toBe(11903.13)
    expect(p.isr_tramos).toEqual([{ hasta: null, pct: 10 }])
  })
})

describe("calcularNominaEmpleado", () => {
  it("caso base L 20,000 mensual sin novedades", () => {
    const c = calcularNominaEmpleado(emp({}), [], MES, P)
    expect(c.salario_periodo).toBe(20000)
    expect(c.ihss_empleado).toBe(595.16)
    expect(c.rap_empleado).toBe(121.45)
    expect(c.isr).toBe(0)
    expect(c.total_deducciones).toBe(716.61)
    expect(c.neto).toBe(19283.39)
    expect(c.ihss_patronal).toBe(1011.77)
    expect(c.rap_patronal).toBe(121.45)
    expect(c.lineas[0].tipo).toBe("ingreso")
  })
  it("quincenal: salario y contribuciones a la mitad", () => {
    const c = calcularNominaEmpleado(emp({ frecuencia_pago: "Quincenal" }), [], { tipo: "Quincenal", desde: "2026-09-01", hasta: "2026-09-15" }, P)
    expect(c.dias_periodo).toBe(15)
    expect(c.salario_periodo).toBe(10000)
    expect(c.ihss_empleado).toBe(297.58)
    expect(c.rap_empleado).toBeCloseTo(60.73, 2)
  })
  it("novedades: horas extra, bono, ausencia, anticipo y aguinaldo exento", () => {
    const c = calcularNominaEmpleado(
      emp({ salario_mensual: 24000 }),
      [
        nov({ id: 1, tipo: "Horas extra diurna", cantidad: 2 }), // 250
        nov({ id: 2, tipo: "Bono", monto: 1000 }),
        nov({ id: 3, tipo: "Ausencia", cantidad: 1 }), // −800
        nov({ id: 4, tipo: "Anticipo", monto: 500 }),
        nov({ id: 5, tipo: "Aguinaldo", monto: 24000, gravable: false, cotizable: false }),
        nov({ id: 6, empleado_id: 99, tipo: "Bono", monto: 9999 }), // de otro empleado
      ],
      MES,
      P
    )
    expect(c.dias_no_pagados).toBe(1)
    expect(c.salario_periodo).toBe(23200)
    expect(c.horas_extra).toBe(250)
    expect(c.otros_ingresos).toBe(25000)
    expect(c.total_devengado).toBe(48450)
    expect(c.otras_deducciones).toBe(500)
    expect(c.ihss_empleado).toBe(595.16) // topado
    expect(c.rap_empleado).toBeCloseTo((23200 + 250 + 1000 - 11903.13) * 0.015, 2) // aguinaldo no cotiza
    expect(c.novedad_ids).toEqual([1, 2, 3, 4, 5])
    expect(c.lineas.some((l) => l.concepto.startsWith("Aguinaldo"))).toBe(true)
  })
  it("sin IHSS/RAP/ISR cuando el empleado no aplica", () => {
    const c = calcularNominaEmpleado(emp({ salario_mensual: 50000, aplica_ihss: false, aplica_rap: false, aplica_isr: false }), [], MES, P)
    expect(c.total_deducciones).toBe(0)
    expect(c.neto).toBe(50000)
  })
  it("alta a mitad de mes prorratea", () => {
    expect(diasFueraDeContrato({ fecha_ingreso: "2026-09-16" }, MES, 30)).toBe(15)
    const c = calcularNominaEmpleado(emp({ fecha_ingreso: "2026-09-16", salario_mensual: 30000 }), [], MES, P)
    expect(c.salario_periodo).toBe(15000)
  })
  it("totalesNomina y aguinaldo proporcional", () => {
    const a = calcularNominaEmpleado(emp({}), [], MES, P)
    const b = calcularNominaEmpleado(emp({ id: 2, salario_mensual: 40000 }), [], MES, P)
    const t = totalesNomina([a, b])
    expect(t.devengado).toBe(60000)
    expect(t.neto).toBeCloseTo(a.neto + b.neto, 2)
    expect(t.retenciones).toBeCloseTo(a.ihss_empleado + a.rap_empleado + b.ihss_empleado + b.rap_empleado + b.isr, 2)
    expect(calcularAguinaldoProporcional(12000, null, { desde: "2025-12-01", hasta: "2026-11-30" })).toEqual({ meses: 12, monto: 12000 })
    expect(calcularAguinaldoProporcional(12000, "2026-06-01", { desde: "2025-12-01", hasta: "2026-11-30" }).meses).toBeCloseTo(6.1, 1)
  })
  it("empleadosDelPeriodo filtra por frecuencia, ingreso y salida", () => {
    const lista = [
      emp({ id: 1 }),
      emp({ id: 2, frecuencia_pago: "Quincenal" }),
      emp({ id: 3, fecha_ingreso: "2026-10-01" }),
      emp({ id: 4, estado: "Inactivo", fecha_salida: "2026-09-10" }),
      emp({ id: 5, estado: "Inactivo", fecha_salida: "2026-08-10" }),
    ]
    expect(empleadosDelPeriodo(lista, MES).map((e) => e.id)).toEqual([1, 4])
  })
})

describe("vacaciones", () => {
  it("causa años completos + proporcional y descuenta gozados y pagados", () => {
    const e = emp({ id: 1, fecha_ingreso: "2024-03-01", salario_mensual: 30000 })
    // 2 años completos al 2026-09-01 (10 + 12) + 3.er año: 15 d × 184/365
    const s = calcularSaldoVacaciones(e, [
      nov({ id: 1, tipo: "Vacaciones", cantidad: 5 }),
      nov({ id: 2, tipo: "Vacaciones pagadas", cantidad: 3 }),
      nov({ id: 3, empleado_id: 9, tipo: "Vacaciones", cantidad: 99 }),
    ], "2026-09-01")
    expect(s.anios_completos).toBe(2)
    expect(s.causado_exigible).toBe(22)
    expect(s.causado_proporcional).toBeCloseTo(15 * 184 / 365, 2)
    expect(s.gozados).toBe(5)
    expect(s.pagados).toBe(3)
    expect(s.saldo).toBeCloseTo(22 + 15 * 184 / 365 - 8, 2)
    expect(s.saldo_exigible).toBe(14)
    expect(s.salario_diario).toBe(1000)
    expect(s.proximo_aniversario).toBe("2027-03-01")
  })
  it("primer año solo proporcional; sin ingreso no causa", () => {
    expect(calcularSaldoVacaciones(emp({ fecha_ingreso: "2026-07-01" }), [], "2026-09-29").causado_exigible).toBe(0)
    expect(calcularSaldoVacaciones(emp({ fecha_ingreso: "2026-07-01" }), [], "2026-09-29").causado_proporcional).toBeCloseTo(10 * 90 / 365, 2)
    expect(calcularSaldoVacaciones(emp({ fecha_ingreso: null }), [], "2026-09-29").causado_total).toBe(0)
  })
  it("la nómina paga las vacaciones liquidadas a salario diario", () => {
    const c = calcularNominaEmpleado(emp({ salario_mensual: 30000 }), [nov({ id: 7, tipo: "Vacaciones pagadas", cantidad: 3, gravable: true, cotizable: true })], MES, P)
    expect(c.otros_ingresos).toBe(3000)
    expect(c.total_devengado).toBe(33000)
    expect(c.lineas.find((l) => l.concepto.startsWith("Vacaciones pagadas"))?.cantidad).toBe(3)
  })
})

describe("rrhh puras", () => {
  it("horas trabajadas, documentos por vencer, antigüedad y vacaciones", () => {
    expect(calcularHoras("2026-09-23T08:00:00.000Z", "2026-09-23T17:30:00.000Z")).toBe(9.5)
    expect(calcularHoras("2026-09-23T08:00:00.000Z", null)).toBeNull()
    const docs = documentosPorVencer([{ vence_en: "2026-09-25" }, { vence_en: "2026-12-01" }, { vence_en: null }, { vence_en: "2026-09-01" }], "2026-09-23", 30)
    expect(docs.map((d) => d.diasRestantes)).toEqual([-22, 2])
    expect(antiguedadAnios("2023-09-24", "2026-09-23")).toBe(2)
    expect(antiguedadAnios("2023-09-23", "2026-09-23")).toBe(3)
    expect([0, 1, 2, 3, 4, 10].map(diasVacacionesPorAntiguedad)).toEqual([0, 10, 12, 15, 20, 20])
  })
  it("mapea marcaciones importadas y resuelve empleados", () => {
    const filas = mapearMarcacionesImportadas([
      ["Empleado", "Fecha", "Entrada", "Salida"],
      ["Ana", "23/09/2026", "08:00", "17:00"],
      ["E-02", 46288, 0.375, 0.7083], // serial Excel 2026-09-23, 09:00, 17:00
      ["", "23/09/2026", "08:00", ""],
    ])
    expect(filas[0]).toMatchObject({ empleado: "Ana", fecha: "2026-09-23", entrada: "08:00", salida: "17:00" })
    expect(filas[1]).toMatchObject({ fecha: "2026-09-23", entrada: "09:00", salida: "17:00" })
    expect(filas[2].error).toBe("Sin empleado")
    const lista = [emp({ id: 1, nombre: "Ana Pérez", codigo: "E-01" }), emp({ id: 2, nombre: "Luis", codigo: "E-02" })]
    expect(resolverEmpleado("E-02", lista)?.id).toBe(2)
    expect(resolverEmpleado("ana pérez", lista)?.id).toBe(1)
    expect(resolverEmpleado("zzz", lista)).toBeNull()
  })
})
