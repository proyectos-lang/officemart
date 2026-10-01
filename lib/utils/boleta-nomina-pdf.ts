import { formatCurrency } from "@/lib/utils/format"
import { formatHondurasDate } from "@/lib/utils/honduras-time"
import { montoEnLetrasLempiras } from "@/lib/utils/numero-a-letras"
import type { Nomina, NominaDetalle } from "@/lib/services/nomina"
import type { Empleado, SaldoVacaciones } from "@/lib/services/rrhh"

/**
 * Comprobante de pago de nómina (boleta) en PDF: una página por empleado con
 * datos del colaborador, base salarial, ingresos, deducciones, neto (en
 * número y letras) y prestaciones/aportes informativos. Lo usan "Boletas PDF"
 * (toda la nómina) y el botón por empleado del detalle.
 */

export interface PrestacionesEmpleado {
  vacaciones: SaldoVacaciones | null
  decimoTercero: { meses: number; monto: number; desde: string } | null
  decimoCuarto: { meses: number; monto: number; desde: string } | null
}

export interface EmpresaBoleta {
  nombre: string
  rtn?: string | null
  direccion?: string | null
  telefono?: string | null
}

export interface BoletaInput {
  empresa: EmpresaBoleta
  nomina: Nomina
  detalles: NominaDetalle[]
  empleados: Map<number, Empleado>
  prestaciones: Map<number, PrestacionesEmpleado>
  /** "descargar" (default) o "blob" para adjuntar/enviar. */
  salida?: "descargar" | "blob"
  filename?: string
}

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100

function antiguedad(fechaIngreso: string | null | undefined, hasta: string): string {
  if (!fechaIngreso) return "—"
  const [iy, im, id] = fechaIngreso.slice(0, 10).split("-").map(Number)
  const [hy, hm, hd] = hasta.slice(0, 10).split("-").map(Number)
  let meses = (hy - iy) * 12 + (hm - im)
  if (hd < id) meses -= 1
  meses = Math.max(0, meses)
  const a = Math.floor(meses / 12)
  const m = meses % 12
  return `${a ? `${a} año${a === 1 ? "" : "s"}` : ""}${a && m ? " y " : ""}${m || !a ? `${m} mes${m === 1 ? "" : "es"}` : ""}`
}

export async function generarBoletasNominaPdf(input: BoletaInput): Promise<{ ok: boolean; blob?: Blob; error?: string }> {
  try {
    const [{ jsPDF }, autoTableMod] = await Promise.all([import("jspdf"), import("jspdf-autotable")])
    const autoTable = autoTableMod.default
    const doc = new jsPDF()
    const w = doc.internal.pageSize.getWidth()
    const hPag = doc.internal.pageSize.getHeight()
    const { nomina, empresa } = input
    const finY = () => (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 40

    input.detalles.forEach((d, idx) => {
      if (idx > 0) doc.addPage()
      const emp = input.empleados.get(d.empleado_id)
      const prest = input.prestaciones.get(d.empleado_id)

      // Encabezado
      doc.setFont("helvetica", "bold"); doc.setFontSize(13); doc.setTextColor(30, 30, 30)
      doc.text(empresa.nombre, 14, 15)
      doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(100, 100, 100)
      doc.text([`RTN: ${empresa.rtn || "N/A"}`, empresa.direccion || "", empresa.telefono ? `Tel: ${empresa.telefono}` : ""].filter(Boolean).join("   "), 14, 20)
      doc.setFont("helvetica", "bold"); doc.setFontSize(12); doc.setTextColor(30, 30, 30)
      doc.text("COMPROBANTE DE PAGO DE NÓMINA", w - 14, 15, { align: "right" })
      doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(100, 100, 100)
      doc.text(`Nómina ${nomina.tipo.toLowerCase()} #${nomina.id} · del ${formatHondurasDate(nomina.periodo_desde)} al ${formatHondurasDate(nomina.periodo_hasta)}`, w - 14, 20, { align: "right" })
      doc.text(`Fecha de pago: ${nomina.fecha_pago ? formatHondurasDate(nomina.fecha_pago) : "—"} · Estado: ${nomina.estado}`, w - 14, 24, { align: "right" })

      // Datos del empleado
      autoTable(doc, {
        startY: 29,
        theme: "plain",
        styles: { fontSize: 8, cellPadding: 1 },
        columnStyles: { 0: { fontStyle: "bold", cellWidth: 30, textColor: [90, 90, 90] }, 1: { cellWidth: 61 }, 2: { fontStyle: "bold", cellWidth: 30, textColor: [90, 90, 90] }, 3: { cellWidth: 61 } },
        body: [
          ["Empleado", d.empleado_nombre, "Código", emp?.codigo || "—"],
          ["Identidad", emp?.identidad || "—", "RTN", emp?.rtn || "—"],
          ["Puesto", emp?.puesto || "—", "Departamento", emp?.departamento || "—"],
          ["Fecha de ingreso", emp?.fecha_ingreso ? formatHondurasDate(emp.fecha_ingreso) : "—", "Antigüedad", antiguedad(emp?.fecha_ingreso, nomina.periodo_hasta)],
          ["Afiliación IHSS", emp?.ihss_afiliacion || "—", "Afiliación RAP", emp?.rap_afiliacion || "—"],
          ["Forma de pago", emp ? `${emp.forma_pago}${emp.banco ? ` · ${emp.banco}` : ""}` : "—", "Cuenta", emp?.cuenta_bancaria || "—"],
        ],
      })

      // Base salarial
      const diasPagados = r2(d.dias_periodo - d.dias_no_pagados)
      autoTable(doc, {
        startY: finY() + 3,
        head: [["Salario mensual", "Salario diario", "Salario por hora", "Días del período", "Días pagados", "Días no pagados"]],
        body: [[formatCurrency(d.salario_mensual), formatCurrency(d.salario_mensual / 30), formatCurrency(d.salario_mensual / 240), String(d.dias_periodo), String(diasPagados), String(d.dias_no_pagados)]],
        styles: { fontSize: 8, halign: "center" },
        headStyles: { fillColor: [87, 83, 78], halign: "center" },
      })

      // Ingresos y deducciones lado a lado
      const yMov = finY() + 4
      const ingresos = d.lineas.filter((l) => l.tipo === "ingreso")
      const deducciones = d.lineas.filter((l) => l.tipo === "deduccion")
      const info = d.lineas.filter((l) => l.tipo === "info")
      const anchoCol = (w - 28 - 4) / 2
      autoTable(doc, {
        startY: yMov,
        margin: { left: 14, right: w - 14 - anchoCol },
        head: [["Ingresos", "Cant.", "Monto"]],
        body: [...ingresos.map((l) => [l.concepto, l.cantidad != null ? String(l.cantidad) : "", formatCurrency(l.monto)]), ["Total devengado", "", formatCurrency(d.total_devengado)]],
        styles: { fontSize: 7.5 },
        headStyles: { fillColor: [5, 150, 105] },
        columnStyles: { 1: { halign: "right", cellWidth: 12 }, 2: { halign: "right", cellWidth: 26 } },
        didParseCell: (c) => { if (c.section === "body" && c.row.index === ingresos.length) c.cell.styles.fontStyle = "bold" },
      })
      const yIng = finY()
      autoTable(doc, {
        startY: yMov,
        margin: { left: 14 + anchoCol + 4, right: 14 },
        head: [["Deducciones", "Monto"]],
        body: [...deducciones.map((l) => [l.concepto, formatCurrency(l.monto)]), ["Total deducciones", formatCurrency(d.total_deducciones)]],
        styles: { fontSize: 7.5 },
        headStyles: { fillColor: [185, 28, 28] },
        columnStyles: { 1: { halign: "right", cellWidth: 26 } },
        didParseCell: (c) => { if (c.section === "body" && c.row.index === deducciones.length) c.cell.styles.fontStyle = "bold" },
      })
      const yDed = finY()

      // Neto
      let y = Math.max(yIng, yDed) + 6
      doc.setFillColor(245, 245, 244)
      doc.roundedRect(14, y, w - 28, 15, 2, 2, "F")
      doc.setFont("helvetica", "bold"); doc.setFontSize(12); doc.setTextColor(30, 30, 30)
      doc.text("NETO A PAGAR", 18, y + 6.5)
      doc.text(formatCurrency(d.neto), w - 18, y + 6.5, { align: "right" })
      doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(90, 90, 90)
      doc.text(montoEnLetrasLempiras(d.neto), 18, y + 12)
      y += 20

      // Novedades informativas (vacaciones gozadas, permisos, incapacidades)
      if (info.length > 0) {
        doc.setFontSize(7.5); doc.setTextColor(90, 90, 90)
        doc.text(`Novedades del período: ${info.map((l) => `${l.concepto}${l.cantidad ? ` (${l.cantidad} d)` : ""}`).join(" · ")}`, 14, y, { maxWidth: w - 28 })
        y += 6
      }

      // Prestaciones y aportes (informativo)
      const v = prest?.vacaciones
      const filasPrest: string[][] = [
        ["Aporte patronal IHSS (empresa)", formatCurrency(d.ihss_patronal), "Aporte patronal RAP (empresa)", formatCurrency(d.rap_patronal)],
      ]
      if (v) {
        filasPrest.push(["Vacaciones causadas", `${v.causado_total} días`, "Vacaciones gozadas / pagadas", `${v.gozados} / ${v.pagados} días`])
        filasPrest.push(["Saldo de vacaciones", `${v.saldo} días`, "Valor del saldo", formatCurrency(v.valor_saldo)])
      }
      if (prest?.decimoTercero) filasPrest.push(["Décimo tercer mes acumulado", `${prest.decimoTercero.meses} meses desde ${formatHondurasDate(prest.decimoTercero.desde)}`, "Monto acumulado", formatCurrency(prest.decimoTercero.monto)])
      if (prest?.decimoCuarto) filasPrest.push(["Décimo cuarto mes acumulado", `${prest.decimoCuarto.meses} meses desde ${formatHondurasDate(prest.decimoCuarto.desde)}`, "Monto acumulado", formatCurrency(prest.decimoCuarto.monto)])
      autoTable(doc, {
        startY: y,
        head: [[{ content: "Prestaciones y aportes (informativo, no se suman al neto)", colSpan: 4 }]],
        body: filasPrest,
        styles: { fontSize: 7.5 },
        headStyles: { fillColor: [214, 211, 209], textColor: [60, 60, 60] },
        columnStyles: { 0: { textColor: [90, 90, 90] }, 1: { halign: "right" }, 2: { textColor: [90, 90, 90] }, 3: { halign: "right" } },
      })

      // Firmas y pie
      const yF = hPag - 32
      doc.setDrawColor(170, 170, 170)
      doc.line(22, yF, 92, yF)
      doc.line(w - 92, yF, w - 22, yF)
      doc.setFontSize(8); doc.setTextColor(90, 90, 90)
      doc.text("Recibí conforme", 57, yF + 4, { align: "center" })
      doc.text(d.empleado_nombre, 57, yF + 8, { align: "center" })
      doc.text("Recursos Humanos", w - 57, yF + 4, { align: "center" })
      doc.text(empresa.nombre, w - 57, yF + 8, { align: "center" })
      doc.setFontSize(6.5); doc.setTextColor(150, 150, 150)
      doc.text("Las deducciones de ley (IHSS, RAP, ISR) se calculan con los parámetros vigentes de la empresa. Las prestaciones son acumulados a la fecha de corte del período.", w / 2, hPag - 14, { align: "center", maxWidth: w - 28 })
      doc.text("Generado por EasyCount", w / 2, hPag - 8, { align: "center" })
    })

    const filename = input.filename || `Boletas_${nomina.tipo}_${nomina.periodo_desde}_${nomina.periodo_hasta}.pdf`
    if (input.salida === "blob") return { ok: true, blob: doc.output("blob") }
    doc.save(filename)
    return { ok: true }
  } catch (err) {
    console.error("[boleta-nomina-pdf]", err)
    return { ok: false, error: err instanceof Error ? err.message : "No se pudo generar el PDF" }
  }
}
