"use client"

import * as React from "react"
import { BarChart3, Loader2, CalendarRange, Clock, Layers, AlertTriangle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Spinner } from "@/components/ui/spinner"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import { useToast } from "@/hooks/use-toast"
import { getHondurasTodayISODate } from "@/lib/utils/honduras-time"
import { getReporteFlujo, type ReporteFlujo } from "@/lib/services/produccion-flujo"

/** Minutos → "Xd Yh Zm" compacto. */
function fmtMin(min: number): string {
  const m = Math.round(Number(min) || 0)
  if (m <= 0) return "0m"
  const d = Math.floor(m / 1440)
  const h = Math.floor((m % 1440) / 60)
  const mm = m % 60
  const parts: string[] = []
  if (d > 0) parts.push(`${d}d`)
  if (h > 0) parts.push(`${h}h`)
  if (mm > 0 && d === 0) parts.push(`${mm}m`)
  return parts.join(" ") || "0m"
}

function sumarDias(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map((x) => parseInt(x, 10))
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

export default function ReporteFlujoPage() {
  const { toast } = useToast()
  const hoy = getHondurasTodayISODate()
  const [desde, setDesde] = React.useState<string>(() => sumarDias(hoy, -30))
  const [hasta, setHasta] = React.useState<string>(hoy)
  const [data, setData] = React.useState<ReporteFlujo | null>(null)
  const [loading, setLoading] = React.useState(true)

  const cargar = React.useCallback(async () => {
    if (desde > hasta) { toast({ title: "Rango inválido", description: "La fecha inicial no puede ser mayor que la final.", variant: "destructive" }); return }
    setLoading(true)
    const { data, error } = await getReporteFlujo({ desde, hasta })
    if (error) toast({ title: "Error", description: error, variant: "destructive" })
    setData(data)
    setLoading(false)
  }, [desde, hasta, toast])
  React.useEffect(() => { cargar() }, [cargar])

  const vacio = !loading && data && data.tiempos.length === 0 && data.cargas.length === 0 && data.abiertas.length === 0

  return (
    <div className="space-y-4 md:space-y-6 p-4 md:p-6">
      <div>
        <h1 className="text-xl md:text-2xl font-bold text-foreground flex items-center gap-2">
          <BarChart3 className="h-6 w-6 text-stone-600" /> Reporte de Flujo
        </h1>
        <p className="text-sm text-muted-foreground">
          Tiempos por operación, carga actual y órdenes trabadas por etapa. Detecta cuellos de botella.
        </p>
      </div>

      {/* Filtro de rango (afecta los tiempos por operación) */}
      <Card className="rounded-xl border-stone-200 bg-stone-50">
        <CardContent className="p-4 flex flex-wrap items-end gap-3">
          <div className="grid gap-1"><Label className="text-xs">Desde</Label><Input type="date" value={desde} max={hasta} onChange={(e) => setDesde(e.target.value)} className="h-9 w-44 bg-white" /></div>
          <div className="grid gap-1"><Label className="text-xs">Hasta</Label><Input type="date" value={hasta} max={hoy} onChange={(e) => setHasta(e.target.value)} className="h-9 w-44 bg-white" /></div>
          <Button onClick={cargar} disabled={loading} className="h-9">{loading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <CalendarRange className="h-4 w-4 mr-1" />} Consultar</Button>
        </CardContent>
      </Card>

      {loading ? (
        <div className="flex justify-center py-12"><Spinner className="h-7 w-7" /></div>
      ) : vacio ? (
        <div className="text-center py-10 text-stone-500 text-sm">
          <BarChart3 className="h-10 w-10 mx-auto mb-2 opacity-40" /> Sin datos de flujo en este rango. Inicia el flujo de algunas órdenes y avánzalas por sus etapas.
        </div>
      ) : (
        <>
        {/* Indicadores de lead time de punta a punta */}
        <div className="grid gap-3 grid-cols-2 lg:grid-cols-5">
          <Card className="rounded-xl border-stone-200"><CardContent className="p-4"><p className="text-xs text-muted-foreground">Órdenes terminadas</p><p className="text-2xl font-semibold">{data!.leadTimes.terminadas}</p><p className="text-[11px] text-muted-foreground">en el rango</p></CardContent></Card>
          <Card className="rounded-xl border-stone-200"><CardContent className="p-4"><p className="text-xs text-muted-foreground">Lead time promedio</p><p className="text-2xl font-semibold">{fmtMin(data!.leadTimes.lead_promedio_h * 60)}</p><p className="text-[11px] text-muted-foreground">primera recepción → última entrega</p></CardContent></Card>
          <Card className="rounded-xl border-stone-200"><CardContent className="p-4"><p className="text-xs text-muted-foreground">Lead time P90</p><p className="text-2xl font-semibold">{fmtMin(data!.leadTimes.lead_p90_h * 60)}</p><p className="text-[11px] text-muted-foreground">máximo {fmtMin(data!.leadTimes.lead_max_h * 60)}</p></CardContent></Card>
          <Card className={`rounded-xl ${data!.leadTimes.cumplimiento_pct != null && data!.leadTimes.cumplimiento_pct < 80 ? "border-amber-300 bg-amber-50/40" : "border-stone-200"}`}><CardContent className="p-4"><p className="text-xs text-muted-foreground">Entregas a tiempo</p><p className="text-2xl font-semibold">{data!.leadTimes.cumplimiento_pct == null ? "—" : `${data!.leadTimes.cumplimiento_pct}%`}</p><p className="text-[11px] text-muted-foreground">{data!.leadTimes.a_tiempo} de {data!.leadTimes.con_fecha} con fecha comprometida</p></CardContent></Card>
          <Card className="rounded-xl border-stone-200"><CardContent className="p-4"><p className="text-xs text-muted-foreground">Órdenes en piso (WIP)</p><p className="text-2xl font-semibold">{data!.leadTimes.wip}</p><p className="text-[11px] text-muted-foreground">con alguna etapa en curso</p></CardContent></Card>
        </div>

        {data!.leadTimes.semanas.length > 0 && (
          <Card className="rounded-xl border-stone-200">
            <CardHeader className="p-4 pb-2">
              <CardTitle className="text-base flex items-center gap-2"><CalendarRange className="h-4 w-4 text-stone-600" /> Tendencia semanal</CardTitle>
              <CardDescription className="text-xs">Órdenes terminadas por semana (lunes de inicio), lead time promedio y cumplimiento de la fecha comprometida.</CardDescription>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              <div className="rounded-lg border border-stone-200 overflow-x-auto">
                <Table>
                  <TableHeader><TableRow><TableHead>Semana del</TableHead><TableHead className="text-right">Terminadas</TableHead><TableHead className="text-right">Lead time promedio</TableHead><TableHead className="text-right">A tiempo</TableHead><TableHead className="w-[35%]">Volumen</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {data!.leadTimes.semanas.map((s) => {
                      const max = Math.max(...data!.leadTimes.semanas.map((x) => x.terminadas), 1)
                      return (
                        <TableRow key={s.semana}>
                          <TableCell>{s.semana.split("-").reverse().join("/")}</TableCell>
                          <TableCell className="text-right">{s.terminadas}</TableCell>
                          <TableCell className="text-right">{fmtMin(s.lead_promedio_h * 60)}</TableCell>
                          <TableCell className={`text-right ${s.cumplimiento_pct != null && s.cumplimiento_pct < 80 ? "text-amber-700" : ""}`}>{s.cumplimiento_pct == null ? "—" : `${s.cumplimiento_pct}%`}</TableCell>
                          <TableCell><div className="h-2 rounded bg-stone-100"><div className="h-2 rounded bg-stone-600" style={{ width: `${(s.terminadas / max) * 100}%` }} /></div></TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        )}

        <div className="grid gap-4 lg:grid-cols-2">
          {/* Tiempo por operación */}
          <Card className="rounded-xl border-stone-200">
            <CardHeader className="p-4 pb-2">
              <CardTitle className="text-base flex items-center gap-2"><Clock className="h-4 w-4 text-stone-600" /> Tiempo por operación</CardTitle>
              <CardDescription className="text-xs">Promedio recepción→entrega de las etapas ya entregadas (en el rango). Incluye la espera en cola: la etapa se recibe cuando la anterior entrega.</CardDescription>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              {(data?.tiempos.length ?? 0) === 0 ? (
                <p className="text-sm text-stone-400 py-3">Aún no hay etapas entregadas en el rango.</p>
              ) : (
                <div className="rounded-lg border border-stone-200 overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Operación</TableHead>
                        <TableHead className="text-right">Muestras</TableHead>
                        <TableHead className="text-right">Promedio</TableHead>
                        <TableHead className="text-right">Máximo</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data!.tiempos.map((t) => (
                        <TableRow key={t.nombre}>
                          <TableCell className="text-sm font-medium">{t.nombre}</TableCell>
                          <TableCell className="text-right tabular-nums text-stone-500">{t.muestras}</TableCell>
                          <TableCell className="text-right tabular-nums font-medium">{fmtMin(t.promedio_min)}</TableCell>
                          <TableCell className="text-right tabular-nums text-stone-500">{fmtMin(t.max_min)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Carga actual por operación */}
          <Card className="rounded-xl border-stone-200">
            <CardHeader className="p-4 pb-2">
              <CardTitle className="text-base flex items-center gap-2"><Layers className="h-4 w-4 text-stone-600" /> Carga actual por operación</CardTitle>
              <CardDescription className="text-xs">Órdenes que están AHORA en cada operación (etapa no entregada).</CardDescription>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              {(data?.cargas.length ?? 0) === 0 ? (
                <p className="text-sm text-stone-400 py-3">No hay órdenes en curso en ninguna operación.</p>
              ) : (
                <div className="space-y-2">
                  {data!.cargas.map((c) => {
                    const max = Math.max(...data!.cargas.map((x) => x.ordenes), 1)
                    return (
                      <div key={c.nombre} className="flex items-center gap-3">
                        <span className="text-sm w-32 truncate shrink-0">{c.nombre}</span>
                        <div className="flex-1 h-4 rounded bg-stone-100 overflow-hidden">
                          <div className="h-full bg-sky-400" style={{ width: `${(c.ordenes / max) * 100}%` }} />
                        </div>
                        <span className="text-sm tabular-nums font-medium w-8 text-right">{c.ordenes}</span>
                      </div>
                    )
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Etapas abiertas (trabadas) */}
          <Card className="rounded-xl border-stone-200 lg:col-span-2">
            <CardHeader className="p-4 pb-2">
              <CardTitle className="text-base flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-amber-600" /> Etapas en curso (antigüedad)</CardTitle>
              <CardDescription className="text-xs">Etapas recibidas/en proceso sin entregar, ordenadas por cuánto llevan sin avanzar (posibles cuellos de botella).</CardDescription>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              {(data?.abiertas.length ?? 0) === 0 ? (
                <p className="text-sm text-stone-400 py-3">No hay etapas en curso ahora mismo.</p>
              ) : (
                <div className="rounded-lg border border-stone-200 overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Producto</TableHead>
                        <TableHead>Operación</TableHead>
                        <TableHead>Estado</TableHead>
                        <TableHead>Responsable</TableHead>
                        <TableHead className="text-right">Lleva</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data!.abiertas.map((a) => (
                        <TableRow key={a.etapa_id}>
                          <TableCell className="text-sm font-medium">{a.producto_nombre}</TableCell>
                          <TableCell className="text-sm">{a.nombre}</TableCell>
                          <TableCell className="text-xs text-stone-500">{a.estado}</TableCell>
                          <TableCell className="text-xs text-stone-500">{a.responsable || "—"}</TableCell>
                          <TableCell className={`text-right tabular-nums font-medium ${a.antiguedad_min >= 1440 ? "text-rose-600" : "text-stone-700"}`}>{fmtMin(a.antiguedad_min)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
        </>
      )}
    </div>
  )
}
