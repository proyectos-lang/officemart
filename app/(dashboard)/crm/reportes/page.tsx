"use client"

import * as React from "react"
import { Target, Download, AlertTriangle, Loader2 } from "lucide-react"
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Spinner } from "@/components/ui/spinner"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useToast } from "@/hooks/use-toast"
import { useTenant } from "@/lib/hooks/use-tenant"
import { formatCurrency } from "@/lib/utils/format"
import { getHondurasTodayISODate } from "@/lib/utils/honduras-time"
import { exportToXlsx } from "@/lib/utils/export"
import { getReporteGestion, type ReporteGestion } from "@/lib/services/crm"

export default function CrmReportesPage() {
  const { toast } = useToast()
  const { ready, razonSocialId } = useTenant()
  const hoy = getHondurasTodayISODate()
  const [desde, setDesde] = React.useState(`${hoy.slice(0, 7)}-01`)
  const [hasta, setHasta] = React.useState(hoy)
  const [loading, setLoading] = React.useState(true)
  const [pendiente, setPendiente] = React.useState<string | null>(null)
  const [reporte, setReporte] = React.useState<ReporteGestion | null>(null)

  const cargar = React.useCallback(async (rango: { desde: string; hasta: string }) => {
    const res = await getReporteGestion(rango)
    if (res.pendiente) setPendiente(res.error)
    else if (res.error) toast({ title: "No se pudo generar el reporte", description: res.error, variant: "destructive" })
    setReporte(res.data)
    setLoading(false)
  }, [toast])

  React.useEffect(() => {
    if (!ready || razonSocialId == null) return
    let activo = true
    const hoyISO = getHondurasTodayISODate()
    getReporteGestion({ desde: `${hoyISO.slice(0, 7)}-01`, hasta: hoyISO }).then((res) => {
      if (!activo) return
      if (res.pendiente) setPendiente(res.error)
      else if (res.error) toast({ title: "No se pudo generar el reporte", description: res.error, variant: "destructive" })
      setReporte(res.data)
      setLoading(false)
    })
    return () => {
      activo = false
    }
  }, [ready, razonSocialId, toast])

  function aplicar() {
    if (!desde || !hasta || desde > hasta) return toast({ title: "Rango de fechas inválido", variant: "destructive" })
    setLoading(true)
    cargar({ desde, hasta })
  }

  function exportar() {
    if (!reporte) return
    const filas: Record<string, unknown>[] = []
    for (const e of reporte.pipeline.etapas) filas.push({ Seccion: "Pipeline por etapa", Clave: e.nombre, Cantidad: e.cantidad, Valor: e.valor, Ponderado: e.ponderado, "Probabilidad %": e.probabilidad })
    for (const v of reporte.porVendedor) filas.push({ Seccion: "Por vendedor", Clave: v.clave, Abiertas: v.abiertas, "Valor abierto": v.valorAbierto, Ganadas: v.ganadas, "Valor ganado": v.valorGanado, Perdidas: v.perdidas, "Tasa %": v.tasa ?? "" })
    for (const v of reporte.porOrigen) filas.push({ Seccion: "Por origen", Clave: v.clave, Abiertas: v.abiertas, "Valor abierto": v.valorAbierto, Ganadas: v.ganadas, "Valor ganado": v.valorGanado, Perdidas: v.perdidas, "Tasa %": v.tasa ?? "" })
    for (const m of reporte.motivosPerdida) filas.push({ Seccion: "Motivos de pérdida", Clave: m.clave, Cantidad: m.cantidad })
    for (const m of reporte.actividadesPorTipo) filas.push({ Seccion: "Actividades por tipo", Clave: m.clave, Cantidad: m.cantidad })
    exportToXlsx(filas, { filename: `crm_gestion_${desde}_${hasta}`, sheetName: "CRM" })
  }

  const tablaClave = (titulo: string, filas: ReporteGestion["porVendedor"]) => (
    <Card>
      <CardHeader className="p-4 pb-2"><CardTitle className="text-base">{titulo}</CardTitle></CardHeader>
      <CardContent className="p-4 pt-0">
        <div className="overflow-x-auto border rounded-lg">
          <Table>
            <TableHeader><TableRow className="bg-stone-50"><TableHead>{titulo.replace("Por ", "")}</TableHead><TableHead className="text-right">Abiertas</TableHead><TableHead className="text-right">Valor abierto</TableHead><TableHead className="text-right">Ganadas</TableHead><TableHead className="text-right">Valor ganado</TableHead><TableHead className="text-right">Perdidas</TableHead><TableHead className="text-right">Tasa</TableHead></TableRow></TableHeader>
            <TableBody>
              {filas.map((f) => (
                <TableRow key={f.clave}>
                  <TableCell className="font-medium">{f.clave}</TableCell>
                  <TableCell className="text-right">{f.abiertas}</TableCell>
                  <TableCell className="text-right font-mono">{formatCurrency(f.valorAbierto)}</TableCell>
                  <TableCell className="text-right">{f.ganadas}</TableCell>
                  <TableCell className="text-right font-mono">{formatCurrency(f.valorGanado)}</TableCell>
                  <TableCell className="text-right">{f.perdidas}</TableCell>
                  <TableCell className="text-right">{f.tasa == null ? "—" : `${f.tasa}%`}</TableCell>
                </TableRow>
              ))}
              {filas.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-6">Sin datos.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  )

  const tablaConteo = (titulo: string, filas: { clave: string; cantidad: number }[]) => (
    <Card>
      <CardHeader className="p-4 pb-2"><CardTitle className="text-base">{titulo}</CardTitle></CardHeader>
      <CardContent className="p-4 pt-0">
        <div className="border rounded-lg">
          <Table>
            <TableBody>
              {filas.map((f) => <TableRow key={f.clave}><TableCell>{f.clave === "Reunion" ? "Reunión" : f.clave}</TableCell><TableCell className="text-right w-20">{f.cantidad}</TableCell></TableRow>)}
              {filas.length === 0 && <TableRow><TableCell className="text-center text-muted-foreground py-6">Sin datos.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  )

  return (
    <div className="space-y-4 md:space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-stone-200 p-2 text-stone-700"><Target className="h-5 w-5" /></div>
          <div>
            <h1 className="text-2xl font-semibold text-stone-800">CRM · Reportes de gestión</h1>
            <p className="text-sm text-muted-foreground">Pipeline ponderado, tasa de cierre por vendedor y origen, motivos de pérdida y actividad comercial.</p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={exportar} disabled={!reporte} className="gap-1"><Download className="h-4 w-4" /> Excel</Button>
      </div>

      <Card>
        <CardContent className="p-4 flex flex-wrap items-end gap-3">
          <div className="space-y-1"><Label>Cerradas desde</Label><Input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /></div>
          <div className="space-y-1"><Label>Hasta</Label><Input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} /></div>
          <Button onClick={aplicar} disabled={loading}>{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Aplicar"}</Button>
          <p className="text-xs text-muted-foreground">El pipeline es la foto actual de las abiertas; ganadas/perdidas y actividades se cuentan dentro del rango.</p>
        </CardContent>
      </Card>

      {pendiente && <Card className="border-amber-200 bg-amber-50"><CardContent className="p-4 text-sm text-amber-800 flex items-center gap-2"><AlertTriangle className="h-4 w-4" /> {pendiente}</CardContent></Card>}

      {loading || !reporte ? (
        <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground"><Spinner /> Calculando…</div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Abiertas</p><p className="text-2xl font-semibold">{reporte.pipeline.cantidad}</p></CardContent></Card>
            <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Pipeline</p><p className="text-xl font-semibold">{formatCurrency(reporte.pipeline.total)}</p></CardContent></Card>
            <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Ponderado</p><p className="text-xl font-semibold text-emerald-700">{formatCurrency(reporte.pipeline.ponderado)}</p></CardContent></Card>
            <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Ganadas / Perdidas</p><p className="text-2xl font-semibold">{reporte.cierre.ganadas} / {reporte.cierre.perdidas}</p><p className="text-xs text-muted-foreground">{formatCurrency(reporte.cierre.valorGanado)} ganado</p></CardContent></Card>
            <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Tasa de cierre</p><p className="text-2xl font-semibold">{reporte.cierre.tasa == null ? "—" : `${reporte.cierre.tasa}%`}</p></CardContent></Card>
            <Card className={reporte.cierresVencidos > 0 ? "border-red-200 bg-red-50/40" : ""}><CardContent className="p-4"><p className="text-xs text-muted-foreground">Cierres vencidos</p><p className="text-2xl font-semibold">{reporte.cierresVencidos}</p><p className="text-xs text-muted-foreground">{reporte.actividadesCompletadas} act. hechas · {reporte.actividadesPendientes} pend.</p></CardContent></Card>
          </div>

          <Card>
            <CardHeader className="p-4 pb-2"><CardTitle className="text-base">Pipeline por etapa</CardTitle></CardHeader>
            <CardContent className="p-4 pt-0">
              <div className="h-[280px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={reporte.pipeline.etapas.map((e) => ({ nombre: `${e.nombre} (${e.cantidad})`, Valor: e.valor, Ponderado: e.ponderado }))}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" />
                    <XAxis dataKey="nombre" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${Math.round(Number(v) / 1000)}k`} />
                    <Tooltip formatter={(v) => formatCurrency(Number(v))} />
                    <Legend />
                    <Bar dataKey="Valor" fill="#a8a29e" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="Ponderado" fill="#059669" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            {tablaClave("Por vendedor", reporte.porVendedor)}
            {tablaClave("Por origen", reporte.porOrigen)}
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            {tablaConteo("Motivos de pérdida", reporte.motivosPerdida)}
            {tablaConteo("Actividades por tipo (en el rango)", reporte.actividadesPorTipo)}
          </div>
        </>
      )}
    </div>
  )
}
