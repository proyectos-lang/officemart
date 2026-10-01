"use client"

import * as React from "react"
import Link from "next/link"
import { Bar, BarChart, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { ClipboardList, ArrowRight } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { Indicador } from "@/components/ui/indicador"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useTenant } from "@/lib/hooks/use-tenant"
import { getTracking, resumenProduccion, type OrdenTracking, type OperacionStd } from "@/lib/services/produccion-tracking"

function fmtH(h: number | null): string {
  if (h == null) return "—"
  if (h < 24) return `${h.toFixed(1)} h`
  return `${Math.floor(h / 24)} d ${Math.round(h % 24)} h`
}

/**
 * Resumen de órdenes y flujo para el Dashboard de Producción: totales,
 * cumplimiento, lead time por proceso (real vs plan), órdenes por proceso
 * según estado (pendientes de recibir, recibidas, en proceso), tendencia
 * semanal y órdenes atrasadas.
 */
export function ResumenOrdenesProduccion({ desde, hasta }: { desde: string; hasta: string }) {
  const { ready, razonSocialId } = useTenant()
  const [loading, setLoading] = React.useState(true)
  const [rows, setRows] = React.useState<OrdenTracking[]>([])
  const [ops, setOps] = React.useState<OperacionStd[]>([])

  React.useEffect(() => {
    if (!ready || razonSocialId == null) return
    let activo = true
    getTracking().then((r) => {
      if (!activo) return
      setRows(r.data)
      setOps(r.ops)
      setLoading(false)
    })
    return () => {
      activo = false
    }
  }, [ready, razonSocialId])

  const res = React.useMemo(() => resumenProduccion(rows, ops, { desde, hasta }), [rows, ops, desde, hasta])
  const atrasadas = React.useMemo(
    () => rows.filter((r) => r.semaforo === "rojo" && r.estado !== "Terminada" && r.estado !== "Cancelada").sort((a, b) => (b.atraso_dias ?? 0) - (a.atraso_dias ?? 0)).slice(0, 8),
    [rows]
  )

  if (loading) return <div className="flex justify-center py-10"><Spinner className="h-7 w-7" /></div>
  if (rows.length === 0) return null

  const leadData = res.procesos.map((p) => ({ proceso: p.nombre, Real: p.lead_real_h ?? 0, Planeado: p.lead_plan_h ?? 0 }))
  const cargaData = res.procesos.map((p) => ({ proceso: p.nombre, "Pendientes de recibir": p.pendientes_recibir, Recibidas: p.recibidas, "En proceso": p.en_proceso }))
  const semanaData = res.semanas.map((s) => ({ semana: s.semana.slice(8, 10) + "/" + s.semana.slice(5, 7), Terminadas: s.terminadas, "% a tiempo": s.a_tiempo_pct ?? 0 }))

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-stone-800 flex items-center gap-2"><ClipboardList className="h-5 w-5 text-stone-600" /> Órdenes y flujo por procesos</h2>
        <Button variant="outline" size="sm" asChild className="gap-1"><Link href="/produccion/mastertracking">Mastertracking <ArrowRight className="h-4 w-4" /></Link></Button>
      </div>

      <Card className="rounded-xl border-stone-200">
        <CardContent className="p-4 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-4">
          <Indicador label="Órdenes creadas" value={String(res.ordenes)} sub="en el período" />
          <Indicador label="En piso" value={String(res.en_piso)} sub={`${res.urgentes_en_piso} urgentes`} />
          <Indicador label="Terminadas" value={String(res.terminadas)} sub="en el período" valueClass="text-emerald-700" />
          <Indicador label="Cumplimiento" value={res.cumplimiento_pct == null ? "—" : `${res.cumplimiento_pct}%`} sub={`${res.a_tiempo} de ${res.terminadas_con_fecha} a tiempo`} valueClass={res.cumplimiento_pct != null && res.cumplimiento_pct < 80 ? "text-amber-700" : "text-emerald-700"} />
          <Indicador label="Lead time prom." value={fmtH(res.lead_promedio_h)} sub="entrada → entrega" />
          <Indicador label="Atrasadas" value={String(res.atrasadas)} sub="en piso, fecha vencida" valueClass="text-red-600" />
          <Indicador label="En riesgo" value={String(res.en_riesgo)} sub="no alcanzan la fecha" valueClass="text-amber-600" />
          <Indicador label="Sin iniciar flujo" value={String(res.sin_iniciar)} sub="órdenes sin etapas" />
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="rounded-xl border-stone-200">
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-base">Lead time por proceso</CardTitle>
            <CardDescription className="text-xs">Promedio real recepción → entrega (horas de reloj, incluye cola) contra el planeado, de las etapas entregadas en el período.</CardDescription>
          </CardHeader>
          <CardContent className="p-4 pt-0 h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={leadData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" />
                <XAxis dataKey="proceso" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} unit=" h" />
                <Tooltip formatter={(v) => `${Number(v).toFixed(1)} h`} />
                <Legend />
                <Bar dataKey="Real" fill="#0284c7" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Planeado" fill="#a8a29e" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="rounded-xl border-stone-200">
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-base">Órdenes por proceso ahora</CardTitle>
            <CardDescription className="text-xs">Recibidas (en cola), en proceso y pendientes de recibir (vienen en camino desde etapas anteriores).</CardDescription>
          </CardHeader>
          <CardContent className="p-4 pt-0 h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={cargaData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" />
                <XAxis dataKey="proceso" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip />
                <Legend />
                <Bar dataKey="En proceso" stackId="a" fill="#0284c7" />
                <Bar dataKey="Recibidas" stackId="a" fill="#f59e0b" />
                <Bar dataKey="Pendientes de recibir" stackId="a" fill="#d6d3d1" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="rounded-xl border-stone-200">
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-base">Tendencia semanal</CardTitle>
            <CardDescription className="text-xs">Órdenes terminadas por semana y % entregado a tiempo.</CardDescription>
          </CardHeader>
          <CardContent className="p-4 pt-0 h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={semanaData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" />
                <XAxis dataKey="semana" tick={{ fontSize: 11 }} />
                <YAxis yAxisId="n" tick={{ fontSize: 11 }} allowDecimals={false} />
                <YAxis yAxisId="p" orientation="right" domain={[0, 100]} tick={{ fontSize: 11 }} unit="%" />
                <Tooltip />
                <Legend />
                <Bar yAxisId="n" dataKey="Terminadas" fill="#57534e" radius={[4, 4, 0, 0]} />
                <Line yAxisId="p" type="monotone" dataKey="% a tiempo" stroke="#059669" strokeWidth={2} dot />
              </ComposedChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="rounded-xl border-stone-200">
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-base">Detalle por proceso</CardTitle>
            <CardDescription className="text-xs">Estándar configurado y etapas entregadas en el período.</CardDescription>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <div className="rounded-lg border overflow-x-auto">
              <Table>
                <TableHeader><TableRow><TableHead>Proceso</TableHead><TableHead className="text-right">Pend.</TableHead><TableHead className="text-right">Recib.</TableHead><TableHead className="text-right">En proc.</TableHead><TableHead className="text-right">Entregadas</TableHead><TableHead className="text-right">Real</TableHead><TableHead className="text-right">Estándar</TableHead></TableRow></TableHeader>
                <TableBody>
                  {res.procesos.map((p) => (
                    <TableRow key={p.nombre}>
                      <TableCell className="font-medium">{p.nombre}</TableCell>
                      <TableCell className="text-right">{p.pendientes_recibir}</TableCell>
                      <TableCell className="text-right">{p.recibidas}</TableCell>
                      <TableCell className="text-right">{p.en_proceso}</TableCell>
                      <TableCell className="text-right">{p.entregadas}</TableCell>
                      <TableCell className="text-right">{fmtH(p.lead_real_h)}</TableCell>
                      <TableCell className="text-right text-muted-foreground">{p.estandar_h} h lab.</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>

      {atrasadas.length > 0 && (
        <Card className="rounded-xl border-red-200">
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-base text-red-700">Órdenes atrasadas en piso</CardTitle>
            <CardDescription className="text-xs">Fecha comprometida vencida, ordenadas por días de atraso.</CardDescription>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <div className="rounded-lg border overflow-x-auto">
              <Table>
                <TableHeader><TableRow><TableHead>Orden</TableHead><TableHead>Cliente / trabajo</TableHead><TableHead>Etapa actual</TableHead><TableHead>Compromiso</TableHead><TableHead className="text-right">Atraso</TableHead></TableRow></TableHeader>
                <TableBody>
                  {atrasadas.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-mono text-xs">{r.codigo}</TableCell>
                      <TableCell><p className="text-sm">{r.cliente_nombre || "—"}</p><p className="text-xs text-muted-foreground truncate max-w-[280px]">{r.descripcion}</p></TableCell>
                      <TableCell className="text-sm">{r.etapa_actual} <span className="text-xs text-muted-foreground">({r.estado})</span></TableCell>
                      <TableCell className="text-sm">{r.fecha_objetivo ? `${r.fecha_objetivo.slice(8, 10)}/${r.fecha_objetivo.slice(5, 7)}` : "—"}</TableCell>
                      <TableCell className="text-right text-red-700 font-medium">{r.atraso_dias} d</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
