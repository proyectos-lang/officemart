"use client"

import * as React from "react"
import { Banknote, Plus, Eye, Download, FileDown, CheckCircle2, XCircle, RefreshCw, Loader2, AlertTriangle, ChevronDown, ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Spinner } from "@/components/ui/spinner"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useToast } from "@/hooks/use-toast"
import { useAuth } from "@/lib/contexts/auth-context"
import { useTenant } from "@/lib/hooks/use-tenant"
import { formatCurrency } from "@/lib/utils/format"
import { formatHondurasDate, getHondurasTodayISODate } from "@/lib/utils/honduras-time"
import { exportToXlsx } from "@/lib/utils/export"
import { getCuentas, type CuentaConfig } from "@/lib/services/cuentas"
import { getRazonSocialForPdf } from "@/lib/services/ventas"
import type { FrecuenciaPago } from "@/lib/services/rrhh"
import { getNominas, getNominaCompleta, generarNomina, recalcularNomina, aprobarNomina, pagarNomina, anularNomina, planillaRows, totalesNomina, type Nomina, type NominaDetalle } from "@/lib/services/nomina"

function finDeMes(ym: string): string {
  const [y, m] = ym.split("-").map(Number)
  return `${y}-${String(m).padStart(2, "0")}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`
}

export default function NominaPage() {
  const { toast } = useToast()
  const { user } = useAuth()
  const { ready, razonSocialId } = useTenant()
  const hoy = getHondurasTodayISODate()
  const [loading, setLoading] = React.useState(true)
  const [pendiente, setPendiente] = React.useState<string | null>(null)
  const [nominas, setNominas] = React.useState<Nomina[]>([])
  const [cuentas, setCuentas] = React.useState<CuentaConfig[]>([])
  const [sel, setSel] = React.useState<{ nomina: Nomina; detalle: NominaDetalle[] } | null>(null)
  const [abierto, setAbierto] = React.useState<Set<number>>(new Set())
  const [ocupado, setOcupado] = React.useState<string | null>(null)
  const [generar, setGenerar] = React.useState(false)
  const [pagar, setPagar] = React.useState<{ open: boolean; metodo: "Efectivo" | "Banco"; cuenta: string; fecha: string }>({ open: false, metodo: "Banco", cuenta: "", fecha: hoy })
  const [anular, setAnular] = React.useState<{ open: boolean; motivo: string }>({ open: false, motivo: "" })

  async function cargar() {
    const res = await getNominas()
    if (res.pendiente) setPendiente(res.error)
    else if (res.error) toast({ title: "No se pudieron cargar las nóminas", description: res.error, variant: "destructive" })
    setNominas(res.data)
  }

  React.useEffect(() => {
    if (!ready || razonSocialId == null) return
    let activo = true
    Promise.all([getNominas(), getCuentas()]).then(([nRes, cRes]) => {
      if (!activo) return
      if (nRes.pendiente) setPendiente(nRes.error)
      else if (nRes.error) toast({ title: "No se pudieron cargar las nóminas", description: nRes.error, variant: "destructive" })
      setNominas(nRes.data)
      setCuentas((cRes.data || []).filter((c) => c.activo !== false))
      setLoading(false)
    })
    return () => {
      activo = false
    }
  }, [ready, razonSocialId, toast])

  async function abrir(n: Nomina) {
    setOcupado(`ver${n.id}`)
    const res = await getNominaCompleta(n.id)
    setOcupado(null)
    if (res.error || !res.data) return toast({ title: "No se pudo abrir", description: res.error ?? "", variant: "destructive" })
    setSel(res.data)
    setAbierto(new Set())
  }

  async function accion(clave: string, fn: () => Promise<{ success?: boolean; error: string | null; data?: unknown }>, ok: string) {
    if (!sel) return
    setOcupado(clave)
    const res = await fn()
    setOcupado(null)
    if (res.error || res.success === false) return toast({ title: "No se pudo completar", description: res.error ?? "", variant: "destructive" })
    toast({ title: ok })
    await cargar()
    const r = await getNominaCompleta(sel.nomina.id)
    if (r.data) setSel(r.data)
  }

  function exportarPlanilla() {
    if (!sel) return
    exportToXlsx(planillaRows(sel.nomina, sel.detalle), { filename: `planilla_${sel.nomina.tipo}_${sel.nomina.periodo_desde}_${sel.nomina.periodo_hasta}`, sheetName: "Planilla" })
  }

  async function boletasPdf() {
    if (!sel) return
    setOcupado("pdf")
    try {
      const [{ jsPDF }, autoTableMod, empresa] = await Promise.all([import("jspdf"), import("jspdf-autotable"), getRazonSocialForPdf()])
      const autoTable = autoTableMod.default
      const doc = new jsPDF()
      const w = doc.internal.pageSize.getWidth()
      const nombreEmpresa = empresa?.nombre_comercial || empresa?.nombre_empresa || user?.razon_social_nombre || "Empresa"
      sel.detalle.forEach((d, idx) => {
        if (idx > 0) doc.addPage()
        doc.setFont("helvetica", "bold"); doc.setFontSize(14); doc.setTextColor(30, 30, 30)
        doc.text(nombreEmpresa, 14, 16)
        doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(100, 100, 100)
        doc.text(`RTN: ${empresa?.documento || "N/A"}`, 14, 22)
        doc.setFont("helvetica", "bold"); doc.setFontSize(14); doc.setTextColor(30, 30, 30)
        doc.text("BOLETA DE PAGO", w - 14, 16, { align: "right" })
        doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(100, 100, 100)
        doc.text(`Nómina ${sel.nomina.tipo.toLowerCase()} · ${formatHondurasDate(sel.nomina.periodo_desde)} a ${formatHondurasDate(sel.nomina.periodo_hasta)} · #${sel.nomina.id}`, w - 14, 22, { align: "right" })
        doc.setTextColor(30, 30, 30); doc.setFontSize(11); doc.setFont("helvetica", "bold")
        doc.text(d.empleado_nombre, 14, 34)
        doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(100, 100, 100)
        doc.text(`Salario mensual ${formatCurrency(d.salario_mensual)} · días pagados ${d.dias_periodo - d.dias_no_pagados} de ${d.dias_periodo}`, 14, 39)
        const ingresos = d.lineas.filter((l) => l.tipo === "ingreso")
        const deducciones = d.lineas.filter((l) => l.tipo === "deduccion")
        const patronal = d.lineas.filter((l) => l.tipo === "patronal")
        autoTable(doc, { startY: 44, head: [["Ingresos", "Cant.", "Monto"]], body: [...ingresos.map((l) => [l.concepto, l.cantidad != null ? String(l.cantidad) : "", formatCurrency(l.monto)]), ["Total devengado", "", formatCurrency(d.total_devengado)]], styles: { fontSize: 8 }, headStyles: { fillColor: [41, 37, 36] }, columnStyles: { 2: { halign: "right" }, 1: { halign: "right" } }, didParseCell: (c) => { if (c.section === "body" && c.row.index === ingresos.length) c.cell.styles.fontStyle = "bold" } })
        const y1 = ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 60) + 5
        autoTable(doc, { startY: y1, head: [["Deducciones", "", "Monto"]], body: [...deducciones.map((l) => [l.concepto, "", formatCurrency(l.monto)]), ["Total deducciones", "", formatCurrency(d.total_deducciones)]], styles: { fontSize: 8 }, headStyles: { fillColor: [120, 113, 108] }, columnStyles: { 2: { halign: "right" } }, didParseCell: (c) => { if (c.section === "body" && c.row.index === deducciones.length) c.cell.styles.fontStyle = "bold" } })
        const y2 = ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y1) + 5
        autoTable(doc, { startY: y2, body: [["NETO A PAGAR", formatCurrency(d.neto)]], styles: { fontSize: 11, fontStyle: "bold" }, columnStyles: { 1: { halign: "right" } } })
        if (patronal.length > 0) {
          const y3 = ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y2) + 5
          autoTable(doc, { startY: y3, head: [["Aportes patronales (informativo)", "Monto"]], body: patronal.map((l) => [l.concepto, formatCurrency(l.monto)]), styles: { fontSize: 7, textColor: [100, 100, 100] }, headStyles: { fillColor: [214, 211, 209], textColor: [60, 60, 60] }, columnStyles: { 1: { halign: "right" } } })
        }
        const yF = doc.internal.pageSize.getHeight() - 30
        doc.setDrawColor(180, 180, 180)
        doc.line(20, yF, 90, yF); doc.line(w - 90, yF, w - 20, yF)
        doc.setFontSize(8); doc.setTextColor(100, 100, 100)
        doc.text("Recibí conforme (empleado)", 55, yF + 5, { align: "center" }); doc.text("Empresa", w - 55, yF + 5, { align: "center" })
        doc.setFontSize(7); doc.setTextColor(168, 162, 158)
        doc.text("Generado por EasyCount", w / 2, doc.internal.pageSize.getHeight() - 8, { align: "center" })
      })
      doc.save(`Boletas_${sel.nomina.tipo}_${sel.nomina.periodo_desde}_${sel.nomina.periodo_hasta}.pdf`)
    } catch (err) {
      console.error(err)
      toast({ title: "No se pudo generar el PDF", variant: "destructive" })
    } finally {
      setOcupado(null)
    }
  }

  const badge = (n: Nomina) => n.estado === "Pagada" ? <Badge className="bg-emerald-600">Pagada</Badge> : n.estado === "Aprobada" ? <Badge className="bg-sky-600">Aprobada</Badge> : n.estado === "Anulada" ? <Badge variant="destructive">Anulada</Badge> : <Badge variant="secondary">Borrador</Badge>

  if (loading) return <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground"><Spinner /> Cargando…</div>

  const tot = sel ? totalesNomina(sel.detalle) : null

  return (
    <div className="space-y-4 md:space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-stone-200 p-2 text-stone-700"><Banknote className="h-5 w-5" /></div>
          <div>
            <h1 className="text-2xl font-semibold text-stone-800">Nómina</h1>
            <p className="text-sm text-muted-foreground">Corridas mensuales o quincenales: salario, horas extra, novedades, IHSS, RAP e ISR; planilla, boletas y pago como gasto.</p>
          </div>
        </div>
        <Button size="sm" onClick={() => setGenerar(true)} disabled={!!pendiente} className="gap-1"><Plus className="h-4 w-4" /> Generar nómina</Button>
      </div>

      {pendiente && <Card className="border-amber-200 bg-amber-50"><CardContent className="p-4 text-sm text-amber-800 flex items-center gap-2"><AlertTriangle className="h-4 w-4" /> {pendiente}</CardContent></Card>}

      <div className="overflow-x-auto border rounded-lg">
        <Table>
          <TableHeader><TableRow className="bg-stone-50"><TableHead>#</TableHead><TableHead>Tipo</TableHead><TableHead>Período</TableHead><TableHead className="text-right">Empleados</TableHead><TableHead className="text-right">Devengado</TableHead><TableHead className="text-right">Deducciones</TableHead><TableHead className="text-right">Neto</TableHead><TableHead className="text-right">Patronal</TableHead><TableHead>Estado</TableHead><TableHead className="w-12"></TableHead></TableRow></TableHeader>
          <TableBody>
            {nominas.map((n) => (
              <TableRow key={n.id} className={sel?.nomina.id === n.id ? "bg-stone-50" : ""}>
                <TableCell className="font-mono text-xs">{n.id}</TableCell>
                <TableCell>{n.tipo}</TableCell>
                <TableCell className="text-sm">{formatHondurasDate(n.periodo_desde)} – {formatHondurasDate(n.periodo_hasta)}{n.fecha_pago && <span className="block text-xs text-muted-foreground">pago {formatHondurasDate(n.fecha_pago)}</span>}</TableCell>
                <TableCell className="text-right">{n.empleados ?? "—"}</TableCell>
                <TableCell className="text-right font-mono">{formatCurrency(n.total_devengado)}</TableCell>
                <TableCell className="text-right font-mono">{formatCurrency(n.total_deducciones)}</TableCell>
                <TableCell className="text-right font-mono font-semibold">{formatCurrency(n.total_neto)}</TableCell>
                <TableCell className="text-right font-mono">{formatCurrency(n.total_patronal)}</TableCell>
                <TableCell>{badge(n)}</TableCell>
                <TableCell><Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => abrir(n)} disabled={ocupado === `ver${n.id}`}>{ocupado === `ver${n.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}</Button></TableCell>
              </TableRow>
            ))}
            {nominas.length === 0 && <TableRow><TableCell colSpan={10} className="text-center text-muted-foreground py-8">Aún no hay nóminas. Genera la primera.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </div>

      {sel && tot && (
        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-semibold text-stone-800 flex items-center gap-2">Nómina #{sel.nomina.id} · {sel.nomina.tipo} · {formatHondurasDate(sel.nomina.periodo_desde)} – {formatHondurasDate(sel.nomina.periodo_hasta)} {badge(sel.nomina)}</p>
                <p className="text-xs text-muted-foreground">{sel.detalle.length} empleado(s) · devengado {formatCurrency(tot.devengado)} · retenciones {formatCurrency(tot.retenciones)} · neto <strong>{formatCurrency(tot.neto)}</strong> · patronal {formatCurrency(tot.patronal)} · costo empresa {formatCurrency(tot.devengado + tot.patronal)}{sel.nomina.gasto_id ? ` · gasto #${sel.nomina.gasto_id}` : ""}{sel.nomina.motivo_anulacion ? ` · anulada: ${sel.nomina.motivo_anulacion}` : ""}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="outline" size="sm" onClick={exportarPlanilla} className="gap-1"><Download className="h-4 w-4" /> Planilla</Button>
                <Button variant="outline" size="sm" onClick={boletasPdf} disabled={ocupado === "pdf"} className="gap-1">{ocupado === "pdf" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />} Boletas PDF</Button>
                {sel.nomina.estado === "Borrador" && (
                  <>
                    <Button variant="outline" size="sm" onClick={() => accion("recalc", () => recalcularNomina(sel.nomina.id), "Nómina recalculada")} disabled={ocupado === "recalc"} className="gap-1"><RefreshCw className={`h-4 w-4 ${ocupado === "recalc" ? "animate-spin" : ""}`} /> Recalcular</Button>
                    <Button size="sm" onClick={() => accion("aprobar", () => aprobarNomina(sel.nomina.id), "Nómina aprobada")} disabled={ocupado === "aprobar"} className="gap-1"><CheckCircle2 className="h-4 w-4" /> Aprobar</Button>
                  </>
                )}
                {sel.nomina.estado === "Aprobada" && <Button size="sm" onClick={() => setPagar({ open: true, metodo: cuentas.length ? "Banco" : "Efectivo", cuenta: cuentas[0]?.id ? String(cuentas[0].id) : "", fecha: sel.nomina.fecha_pago || hoy })} className="gap-1"><Banknote className="h-4 w-4" /> Pagar</Button>}
                {(sel.nomina.estado === "Borrador" || sel.nomina.estado === "Aprobada") && <Button variant="destructive" size="sm" onClick={() => setAnular({ open: true, motivo: "" })} className="gap-1"><XCircle className="h-4 w-4" /> Anular</Button>}
              </div>
            </div>
            <div className="overflow-x-auto border rounded-lg">
              <Table>
                <TableHeader><TableRow className="bg-stone-50"><TableHead className="w-8"></TableHead><TableHead>Empleado</TableHead><TableHead className="text-right">Salario per.</TableHead><TableHead className="text-right">H. extra</TableHead><TableHead className="text-right">Otros</TableHead><TableHead className="text-right">Devengado</TableHead><TableHead className="text-right">IHSS</TableHead><TableHead className="text-right">RAP</TableHead><TableHead className="text-right">ISR</TableHead><TableHead className="text-right">Otras ded.</TableHead><TableHead className="text-right">Neto</TableHead><TableHead className="text-right">Patronal</TableHead></TableRow></TableHeader>
                <TableBody>
                  {sel.detalle.map((d) => {
                    const open = abierto.has(d.id)
                    return (
                      <React.Fragment key={d.id}>
                        <TableRow className="cursor-pointer" onClick={() => setAbierto((p) => { const n = new Set(p); if (n.has(d.id)) n.delete(d.id); else n.add(d.id); return n })}>
                          <TableCell>{open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</TableCell>
                          <TableCell className="font-medium">{d.empleado_nombre}{d.dias_no_pagados > 0 && <span className="block text-xs text-amber-700">{d.dias_no_pagados} día(s) no pagados</span>}</TableCell>
                          <TableCell className="text-right font-mono">{formatCurrency(d.salario_periodo)}</TableCell>
                          <TableCell className="text-right font-mono">{d.horas_extra ? formatCurrency(d.horas_extra) : ""}</TableCell>
                          <TableCell className="text-right font-mono">{d.otros_ingresos ? formatCurrency(d.otros_ingresos) : ""}</TableCell>
                          <TableCell className="text-right font-mono">{formatCurrency(d.total_devengado)}</TableCell>
                          <TableCell className="text-right font-mono">{formatCurrency(d.ihss_empleado)}</TableCell>
                          <TableCell className="text-right font-mono">{formatCurrency(d.rap_empleado)}</TableCell>
                          <TableCell className="text-right font-mono">{formatCurrency(d.isr)}</TableCell>
                          <TableCell className="text-right font-mono">{d.otras_deducciones ? formatCurrency(d.otras_deducciones) : ""}</TableCell>
                          <TableCell className={`text-right font-mono font-semibold ${d.neto < 0 ? "text-red-700" : ""}`}>{formatCurrency(d.neto)}</TableCell>
                          <TableCell className="text-right font-mono text-muted-foreground">{formatCurrency(d.ihss_patronal + d.rap_patronal)}</TableCell>
                        </TableRow>
                        {open && (
                          <TableRow className="bg-stone-50/60">
                            <TableCell></TableCell>
                            <TableCell colSpan={11}>
                              <div className="grid gap-1 sm:grid-cols-2 text-xs py-1">
                                {d.lineas.map((l, i) => (
                                  <div key={i} className="flex justify-between gap-2 border-b border-dashed py-0.5">
                                    <span className={l.tipo === "deduccion" ? "text-red-700" : l.tipo === "patronal" ? "text-muted-foreground" : l.tipo === "info" ? "text-muted-foreground italic" : ""}>{l.concepto}{l.cantidad != null && l.tipo !== "ingreso" ? ` (${l.cantidad})` : ""}</span>
                                    <span className="font-mono">{l.tipo === "info" ? "" : formatCurrency(l.monto)}</span>
                                  </div>
                                ))}
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </React.Fragment>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog open={generar} onOpenChange={setGenerar}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Generar nómina</DialogTitle><DialogDescription>Toma los empleados activos con esa frecuencia, sus novedades sin aplicar y los parámetros vigentes a la fecha final. Queda en borrador.</DialogDescription></DialogHeader>
          {generar && <GenerarForm onClose={() => setGenerar(false)} onCreada={async (n) => { setGenerar(false); await cargar(); abrir(n) }} />}
        </DialogContent>
      </Dialog>

      <Dialog open={pagar.open} onOpenChange={(o) => setPagar((p) => ({ ...p, open: o }))}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Pagar nómina</DialogTitle><DialogDescription>Registra el gasto «Sueldos y salarios» por el neto (pagado ahora) y «Cargas sociales y retenciones» pendiente de pago a IHSS/RAP/SAR.</DialogDescription></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Método</Label>
              <Select value={pagar.metodo} onValueChange={(v) => setPagar((p) => ({ ...p, metodo: v as "Efectivo" | "Banco" }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="Banco">Banco / transferencia</SelectItem><SelectItem value="Efectivo">Efectivo (caja chica)</SelectItem></SelectContent>
              </Select>
            </div>
            {pagar.metodo === "Banco" && (
              <div className="space-y-1">
                <Label>Cuenta</Label>
                <Select value={pagar.cuenta} onValueChange={(v) => setPagar((p) => ({ ...p, cuenta: v }))}>
                  <SelectTrigger><SelectValue placeholder="Elegir cuenta…" /></SelectTrigger>
                  <SelectContent>{cuentas.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.nombre}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1"><Label>Fecha de pago</Label><Input type="date" value={pagar.fecha} onChange={(e) => setPagar((p) => ({ ...p, fecha: e.target.value }))} /></div>
            {tot && <p className="text-sm">Neto a pagar: <strong>{formatCurrency(tot.neto)}</strong> · cargas y retenciones por pagar: {formatCurrency(tot.patronal + tot.retenciones)}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPagar((p) => ({ ...p, open: false }))}>Cancelar</Button>
            <Button onClick={() => { setPagar((p) => ({ ...p, open: false })); accion("pagar", () => pagarNomina(sel!.nomina.id, { metodo: pagar.metodo, cuenta_id: pagar.metodo === "Banco" ? Number(pagar.cuenta) || null : null, fecha: pagar.fecha }), "Nómina pagada y gasto registrado") }} disabled={pagar.metodo === "Banco" && !pagar.cuenta}>Confirmar pago</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={anular.open} onOpenChange={(o) => setAnular((p) => ({ ...p, open: o }))}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Anular nómina</DialogTitle><DialogDescription>Las novedades vuelven a quedar disponibles para otra corrida.</DialogDescription></DialogHeader>
          <div className="space-y-1"><Label>Motivo</Label><Input value={anular.motivo} onChange={(e) => setAnular((p) => ({ ...p, motivo: e.target.value }))} autoFocus /></div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAnular({ open: false, motivo: "" })}>Cancelar</Button>
            <Button variant="destructive" onClick={() => { setAnular({ open: false, motivo: "" }); accion("anular", () => anularNomina(sel!.nomina.id, anular.motivo), "Nómina anulada") }} disabled={!anular.motivo.trim()}>Anular</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function GenerarForm({ onClose, onCreada }: { onClose: () => void; onCreada: (n: Nomina) => void }) {
  const { toast } = useToast()
  const hoy = getHondurasTodayISODate()
  const [tipo, setTipo] = React.useState<FrecuenciaPago>("Mensual")
  const [desde, setDesde] = React.useState(`${hoy.slice(0, 7)}-01`)
  const [hasta, setHasta] = React.useState(finDeMes(hoy.slice(0, 7)))
  const [fechaPago, setFechaPago] = React.useState(hoy)
  const [notas, setNotas] = React.useState("")
  const [saving, setSaving] = React.useState(false)

  function cambiarTipo(t: FrecuenciaPago) {
    setTipo(t)
    const ym = hoy.slice(0, 7)
    if (t === "Quincenal") {
      const dia = Number(hoy.slice(8, 10))
      setDesde(dia <= 15 ? `${ym}-01` : `${ym}-16`)
      setHasta(dia <= 15 ? `${ym}-15` : finDeMes(ym))
    } else {
      setDesde(`${ym}-01`)
      setHasta(finDeMes(ym))
    }
  }

  async function crear() {
    setSaving(true)
    const res = await generarNomina({ tipo, desde, hasta, fecha_pago: fechaPago || null, notas })
    setSaving(false)
    if (res.error || !res.data) return toast({ title: "No se pudo generar", description: res.error ?? "", variant: "destructive" })
    toast({ title: "Nómina generada en borrador" })
    onCreada(res.data)
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Label>Tipo</Label>
        <Select value={tipo} onValueChange={(v) => cambiarTipo(v as FrecuenciaPago)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="Mensual">Mensual</SelectItem><SelectItem value="Quincenal">Quincenal</SelectItem></SelectContent>
        </Select>
      </div>
      <div className="grid gap-3 grid-cols-2">
        <div className="space-y-1"><Label>Desde</Label><Input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /></div>
        <div className="space-y-1"><Label>Hasta</Label><Input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} /></div>
      </div>
      <div className="space-y-1"><Label>Fecha de pago prevista</Label><Input type="date" value={fechaPago} onChange={(e) => setFechaPago(e.target.value)} /></div>
      <div className="space-y-1"><Label>Notas</Label><Input value={notas} onChange={(e) => setNotas(e.target.value)} /></div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={saving}>Cancelar</Button>
        <Button onClick={crear} disabled={saving}>{saving && <Loader2 className="h-4 w-4 animate-spin mr-1" />} Generar</Button>
      </DialogFooter>
    </div>
  )
}
