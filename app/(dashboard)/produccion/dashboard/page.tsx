"use client"

import * as React from "react"
import { BarChart3, AlertTriangle } from "lucide-react"
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Spinner } from "@/components/ui/spinner"
import { Indicador } from "@/components/ui/indicador"
import { getProduccionDashboard, type ProduccionDashboard } from "@/lib/services/produccion-dashboard"
import { ResumenOrdenesProduccion } from "@/components/produccion/resumen-ordenes"

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}
function inicioMes(d = new Date()) { return new Date(d.getFullYear(), d.getMonth(), 1) }
function finMes(d = new Date()) { return new Date(d.getFullYear(), d.getMonth() + 1, 0) }

function pct(v: number | null): string {
  return v == null ? "—" : `${(v * 100).toFixed(1)}%`
}

export default function DashboardProduccionPage() {
  // Por defecto los últimos 30 días (a inicio de mes "este mes" casi no tiene datos).
  const [desde, setDesde] = React.useState(() => { const d = new Date(); d.setDate(d.getDate() - 29); return ymd(d) })
  const [hasta, setHasta] = React.useState(ymd(new Date()))
  const [data, setData] = React.useState<ProduccionDashboard | null>(null)
  const [loading, setLoading] = React.useState(true)

  const cargar = React.useCallback(async (d: string, h: string) => {
    setLoading(true)
    const { data } = await getProduccionDashboard(d, h)
    setData(data)
    setLoading(false)
  }, [])

  React.useEffect(() => { cargar(desde, hasta) }, [desde, hasta, cargar])

  function atajo(tipo: "mes" | "mesPasado" | "sieteDias" | "treintaDias" | "anio") {
    const hoy = new Date()
    if (tipo === "treintaDias") {
      const d30 = new Date(hoy); d30.setDate(hoy.getDate() - 29)
      setDesde(ymd(d30)); setHasta(ymd(hoy))
    } else if (tipo === "mes") { setDesde(ymd(inicioMes())); setHasta(ymd(finMes())) }
    else if (tipo === "mesPasado") {
      const mp = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1)
      setDesde(ymd(inicioMes(mp))); setHasta(ymd(finMes(mp)))
    } else if (tipo === "sieteDias") {
      const d7 = new Date(hoy); d7.setDate(hoy.getDate() - 6)
      setDesde(ymd(d7)); setHasta(ymd(hoy))
    } else {
      setDesde(`${hoy.getFullYear()}-01-01`); setHasta(`${hoy.getFullYear()}-12-31`)
    }
  }

  const oee = data?.oee
  const chartData = (data?.porDia || []).map((d) => ({ fecha: d.fecha.slice(5), Buenas: d.buenas, Defectuosas: d.defectuosas }))

  return (
    <div className="space-y-4 md:space-y-6 p-4 md:p-6">
      <div>
        <h1 className="text-xl md:text-2xl font-bold text-foreground flex items-center gap-2">
          <BarChart3 className="h-6 w-6 text-stone-600" /> Dashboard de Producción
        </h1>
        <p className="text-sm text-muted-foreground">Órdenes y flujo por procesos (cumplimiento, lead time, carga por etapa) y fabricación: unidades, calidad y OEE.</p>
      </div>

      {/* Período */}
      <Card className="rounded-xl border-stone-200 bg-stone-50/60">
        <CardContent className="p-4 flex flex-col lg:flex-row lg:items-end gap-3">
          <div className="grid grid-cols-2 gap-2 flex-1">
            <div className="grid gap-1"><Label className="text-xs">Desde</Label><Input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className="h-9 bg-white" /></div>
            <div className="grid gap-1"><Label className="text-xs">Hasta</Label><Input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className="h-9 bg-white" /></div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => atajo("mes")}>Este mes</Button>
            <Button variant="outline" size="sm" onClick={() => atajo("mesPasado")}>Mes pasado</Button>
            <Button variant="outline" size="sm" onClick={() => atajo("sieteDias")}>7 días</Button>
            <Button variant="outline" size="sm" onClick={() => atajo("treintaDias")}>30 días</Button>
            <Button variant="outline" size="sm" onClick={() => atajo("anio")}>Este año</Button>
          </div>
        </CardContent>
      </Card>

      <ResumenOrdenesProduccion desde={desde} hasta={hasta} />

      <h2 className="text-lg font-semibold text-stone-800 pt-2">Fabricación (corridas) y OEE</h2>
      {loading ? (
        <div className="flex justify-center py-16"><Spinner className="h-8 w-8" /></div>
      ) : data?.featurePending ? (
        <Card><CardContent className="py-10 text-center text-sm text-stone-500">Aplica el script de producción para ver el dashboard.</CardContent></Card>
      ) : (
        <>
          {/* KPIs */}
          <Card className="rounded-xl border-stone-200">
            <CardContent className="p-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
              <Indicador label="Unidades buenas" value={String(data?.totalBuenas ?? 0)} />
              <Indicador label="Defectuosas" value={String(data?.totalDefectuosas ?? 0)} valueClass="text-red-600" />
              <Indicador label="Corridas" value={String(data?.corridas ?? 0)} />
              <Indicador label="Costo unit. prom." value={`L ${(data?.costoUnitarioPromedio ?? 0).toFixed(2)}`} />
              <Indicador label="Calidad" value={pct(oee?.calidad ?? null)} valueClass="text-emerald-700" />
            </CardContent>
          </Card>

          {/* OEE */}
          <Card className="rounded-xl border-stone-200">
            <CardHeader className="p-4 md:p-6 pb-2">
              <CardTitle className="text-base md:text-lg">OEE (Efectividad global del equipo)</CardTitle>
              <CardDescription className="text-xs md:text-sm">Disponibilidad × Rendimiento × Calidad. Las corridas sin el dato requerido se excluyen de ese componente.</CardDescription>
            </CardHeader>
            <CardContent className="p-4 md:p-6 pt-0">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-3 text-center">
                  <p className="text-[11px] uppercase tracking-wide text-amber-700">OEE</p>
                  <p className="text-2xl font-bold text-amber-900">{pct(oee?.oee ?? null)}</p>
                </div>
                <div className="rounded-lg border border-stone-200 p-3 text-center">
                  <p className="text-[11px] uppercase tracking-wide text-stone-500">Disponibilidad</p>
                  <p className="text-2xl font-bold text-stone-800">{pct(oee?.disponibilidad ?? null)}</p>
                </div>
                <div className="rounded-lg border border-stone-200 p-3 text-center">
                  <p className="text-[11px] uppercase tracking-wide text-stone-500">Rendimiento</p>
                  <p className="text-2xl font-bold text-stone-800">{pct(oee?.rendimiento ?? null)}</p>
                </div>
                <div className="rounded-lg border border-stone-200 p-3 text-center">
                  <p className="text-[11px] uppercase tracking-wide text-stone-500">Calidad</p>
                  <p className="text-2xl font-bold text-stone-800">{pct(oee?.calidad ?? null)}</p>
                </div>
              </div>
              {(oee?.corridasSinTiempo || oee?.corridasSinEstandar) ? (
                <p className="mt-3 text-xs text-amber-700 flex items-center gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  {oee?.corridasSinTiempo ? `${oee.corridasSinTiempo} corrida(s) sin tiempo → excluidas de Disponibilidad. ` : ""}
                  {oee?.corridasSinEstandar ? `${oee.corridasSinEstandar} sin estándar de producción → excluidas de Rendimiento.` : ""}
                </p>
              ) : null}
            </CardContent>
          </Card>

          {/* Unidades por día */}
          <Card className="rounded-xl border-stone-200">
            <CardHeader className="p-4 md:p-6 pb-2">
              <CardTitle className="text-base md:text-lg">Unidades fabricadas por día</CardTitle>
            </CardHeader>
            <CardContent className="p-4 md:p-6 pt-0">
              {chartData.length === 0 ? (
                <p className="text-center py-10 text-sm text-stone-400">Sin producción en el período.</p>
              ) : (
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" />
                    <XAxis dataKey="fecha" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Legend />
                    <Bar dataKey="Buenas" fill="#10b981" radius={[3, 3, 0, 0]} />
                    <Bar dataKey="Defectuosas" fill="#ef4444" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
