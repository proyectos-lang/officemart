"use client"

import * as React from "react"
import { ChartGantt, RefreshCw, Download, CalendarClock, Search, ChevronDown, ChevronRight, AlertTriangle, Loader2, Flag } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Spinner } from "@/components/ui/spinner"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { TablePaginator } from "@/components/ui/table-paginator"
import { useToast } from "@/hooks/use-toast"
import { useTenant } from "@/lib/hooks/use-tenant"
import { exportToXlsx } from "@/lib/utils/export"
import { getHondurasNowISO, getHondurasTodayISODate } from "@/lib/utils/honduras-time"
import { getTracking, guardarPlaneacion, TRACKING_PLAN_PENDIENTE, type OrdenTracking, type OperacionStd, type EtapaTracking, type Semaforo } from "@/lib/services/produccion-tracking"

const COLORES = ["bg-sky-500", "bg-violet-500", "bg-amber-500", "bg-emerald-500", "bg-rose-500", "bg-teal-500"]
const BORDES = ["border-sky-500", "border-violet-500", "border-amber-500", "border-emerald-500", "border-rose-500", "border-teal-500"]

/** "2026-09-28T14:05:00.000Z" (HN-as-UTC) → "28/09 14:05". */
function fmtFH(iso: string | null): string {
  if (!iso) return "—"
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)} ${iso.slice(11, 16)}`
}
function fmtF(iso: string | null): string {
  if (!iso) return "—"
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`
}
function fmtH(h: number | null): string {
  if (h == null) return "—"
  if (h < 24) return `${h.toFixed(1)} h`
  return `${Math.floor(h / 24)} d ${Math.round(h % 24)} h`
}
function sumarDias(iso: string, n: number): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

const SEMAFORO: Record<Semaforo, { clase: string; texto: string }> = {
  rojo: { clase: "bg-red-500", texto: "Atrasada" },
  amarillo: { clase: "bg-amber-400", texto: "En riesgo" },
  verde: { clase: "bg-emerald-500", texto: "A tiempo" },
  gris: { clase: "bg-stone-300", texto: "Sin fecha" },
}

function estadoEtapaClase(e: EtapaTracking): string {
  if (e.estado === "Entregada") return "bg-emerald-500 text-white"
  if (e.estado === "En Proceso") return "bg-sky-600 text-white"
  if (e.estado === "Recibida") return "bg-amber-400 text-stone-900"
  return "bg-stone-200 text-stone-600"
}

type FiltroEstado = "todas" | "piso" | "terminadas" | "sin-flujo"
type FiltroSemaforo = "todos" | Semaforo

export default function MastertrackingPage() {
  const { toast } = useToast()
  const { ready, razonSocialId } = useTenant()
  const hoy = getHondurasTodayISODate()
  const [loading, setLoading] = React.useState(true)
  const [rows, setRows] = React.useState<OrdenTracking[]>([])
  const [ops, setOps] = React.useState<OperacionStd[]>([])
  const [planGuardable, setPlanGuardable] = React.useState(false)
  const [planeando, setPlaneando] = React.useState(false)

  const [busqueda, setBusqueda] = React.useState("")
  const [estado, setEstado] = React.useState<FiltroEstado>("piso")
  const [etapa, setEtapa] = React.useState("todas")
  const [semaforo, setSemaforo] = React.useState<FiltroSemaforo>("todos")
  const [cliente, setCliente] = React.useState("todos")
  const [tipo, setTipo] = React.useState("todos")
  const [desde, setDesde] = React.useState(sumarDias(hoy, -45))
  const [hasta, setHasta] = React.useState(hoy)
  const [soloUrgentes, setSoloUrgentes] = React.useState(false)
  const [abiertas, setAbiertas] = React.useState<Set<number>>(new Set())
  const [pageIndex, setPageIndex] = React.useState(0)
  const [pageSize, setPageSize] = React.useState(50)
  const [ventana, setVentana] = React.useState("21")

  async function cargar() {
    const r = await getTracking()
    if (r.error) toast({ title: "No se pudo cargar el tracking", description: r.error, variant: "destructive" })
    setRows(r.data)
    setOps(r.ops)
    setPlanGuardable(r.planGuardable)
    setLoading(false)
  }

  React.useEffect(() => {
    if (!ready || razonSocialId == null) return
    let activo = true
    getTracking().then((r) => {
      if (!activo) return
      if (r.error) toast({ title: "No se pudo cargar el tracking", description: r.error, variant: "destructive" })
      setRows(r.data)
      setOps(r.ops)
      setPlanGuardable(r.planGuardable)
      setLoading(false)
    })
    return () => {
      activo = false
    }
  }, [ready, razonSocialId, toast])

  const clientes = React.useMemo(() => [...new Map(rows.filter((r) => r.cliente_id != null).map((r) => [r.cliente_id!, r.cliente_nombre || `#${r.cliente_id}`])).entries()].sort((a, b) => a[1].localeCompare(b[1])), [rows])

  const filtradas = React.useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    return rows.filter((r) => {
      if (estado === "piso" && !["Pendiente de recibir", "Recibida", "En Proceso"].includes(r.estado)) return false
      if (estado === "terminadas" && r.estado !== "Terminada") return false
      if (estado === "sin-flujo" && r.estado !== "Sin flujo") return false
      if (etapa !== "todas" && r.etapa_actual !== etapa) return false
      if (semaforo !== "todos" && r.semaforo !== semaforo) return false
      if (cliente !== "todos" && String(r.cliente_id) !== cliente) return false
      if (tipo !== "todos" && r.tipo !== tipo) return false
      if (soloUrgentes && !r.urgente) return false
      const dia = r.creada.slice(0, 10)
      if (desde && dia < desde) return false
      if (hasta && dia > hasta) return false
      if (q && ![r.codigo, r.descripcion, r.cliente_nombre, r.etapa_actual].some((s) => (s || "").toLowerCase().includes(q))) return false
      return true
    })
  }, [rows, busqueda, estado, etapa, semaforo, cliente, tipo, soloUrgentes, desde, hasta])

  const pagina = filtradas.slice(pageIndex * pageSize, (pageIndex + 1) * pageSize)
  const kpi = React.useMemo(() => ({
    total: filtradas.length,
    piso: filtradas.filter((r) => ["Pendiente de recibir", "Recibida", "En Proceso"].includes(r.estado)).length,
    rojas: filtradas.filter((r) => r.semaforo === "rojo" && r.estado !== "Terminada").length,
    riesgo: filtradas.filter((r) => r.semaforo === "amarillo").length,
    terminadas: filtradas.filter((r) => r.estado === "Terminada").length,
  }), [filtradas])

  async function generarPlan(recalcular: boolean) {
    setPlaneando(true)
    const r = await guardarPlaneacion({ soloSinPlan: !recalcular })
    setPlaneando(false)
    if (r.error) return toast({ title: "No se guardó la planeación", description: r.error, variant: "destructive" })
    toast({ title: "Planeación guardada", description: `${r.ordenes} órdenes · ${r.etapas} etapas con fecha planeada` })
    cargar()
  }

  function exportar() {
    const filas: Record<string, unknown>[] = []
    for (const r of filtradas) {
      for (const e of r.etapas.length ? r.etapas : [null]) {
        filas.push({
          Orden: r.codigo, Tipo: r.tipo === "Trabajo" ? "Orden de trabajo" : "Orden de producción", Descripción: r.descripcion, Cliente: r.cliente_nombre || "",
          Cantidad: r.cantidad, Creada: fmtFH(r.creada), Compromiso: r.fecha_objetivo || "", "Estado orden": r.estado, "Etapa actual": r.etapa_actual || "",
          Semáforo: SEMAFORO[r.semaforo].texto, "Atraso (días)": r.atraso_dias ?? "", "Lead time (h)": r.lead_h, Urgente: r.urgente ? "Sí" : "No",
          Etapa: e?.nombre || "", "Estado etapa": e?.estado || "", Responsable: e?.responsable || "",
          "Plan inicio": e ? fmtFH(e.plan_inicio) : "", "Plan fin": e ? fmtFH(e.plan_fin) : "",
          Recepción: e ? fmtFH(e.fecha_recepcion) : "", Entrega: e ? fmtFH(e.fecha_entrega) : "",
          "Horas reales": e?.horas_reales ?? "", "Desvío vs plan (h)": e?.desvio_h ?? "",
        })
      }
    }
    exportToXlsx(filas, { filename: `mastertracking_${hoy}`, sheetName: "Mastertracking" })
  }

  const colorOp = (e: { operacion_id: number | null; nombre: string }) => {
    const i = ops.findIndex((o) => o.id === e.operacion_id || o.nombre === e.nombre)
    return i < 0 ? 0 : i % COLORES.length
  }

  if (loading) return <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground"><Spinner /> Cargando…</div>

  return (
    <div className="space-y-4 md:space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-stone-200 p-2 text-stone-700"><ChartGantt className="h-5 w-5" /></div>
          <div>
            <h1 className="text-2xl font-semibold text-stone-800">Mastertracking</h1>
            <p className="text-sm text-muted-foreground">Cada orden con su recorrido por etapas: planeado contra real, etapa actual, atraso y fecha comprometida.</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => { setLoading(true); cargar() }} className="gap-1"><RefreshCw className="h-4 w-4" /> Actualizar</Button>
          <Button variant="outline" size="sm" onClick={exportar} disabled={filtradas.length === 0} className="gap-1"><Download className="h-4 w-4" /> Excel</Button>
          <Button size="sm" onClick={() => generarPlan(false)} disabled={planeando || !planGuardable} className="gap-1" title={planGuardable ? "Guarda fecha planeada a las etapas que aún no la tienen" : TRACKING_PLAN_PENDIENTE}>
            {planeando ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarClock className="h-4 w-4" />} Generar planeación
          </Button>
        </div>
      </div>

      {!planGuardable && (
        <Card className="border-amber-200 bg-amber-50"><CardContent className="p-3 text-sm text-amber-800 flex items-start gap-2"><AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /> {TRACKING_PLAN_PENDIENTE}</CardContent></Card>
      )}

      <div className="grid gap-3 grid-cols-2 md:grid-cols-5">
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Órdenes (filtro)</p><p className="text-2xl font-semibold">{kpi.total}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">En piso</p><p className="text-2xl font-semibold">{kpi.piso}</p></CardContent></Card>
        <Card className={kpi.rojas ? "border-red-200 bg-red-50/40" : ""}><CardContent className="p-4"><p className="text-xs text-muted-foreground">Atrasadas</p><p className="text-2xl font-semibold text-red-700">{kpi.rojas}</p></CardContent></Card>
        <Card className={kpi.riesgo ? "border-amber-200 bg-amber-50/40" : ""}><CardContent className="p-4"><p className="text-xs text-muted-foreground">En riesgo</p><p className="text-2xl font-semibold text-amber-700">{kpi.riesgo}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Terminadas</p><p className="text-2xl font-semibold text-emerald-700">{kpi.terminadas}</p></CardContent></Card>
      </div>

      <Card>
        <CardContent className="p-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8 items-end">
          <div className="space-y-1 sm:col-span-2"><Label className="text-xs">Buscar</Label><div className="relative"><Search className="h-4 w-4 absolute left-2 top-2.5 text-muted-foreground" /><Input className="pl-8" placeholder="Orden, trabajo, cliente…" value={busqueda} onChange={(e) => { setBusqueda(e.target.value); setPageIndex(0) }} /></div></div>
          <div className="space-y-1"><Label className="text-xs">Estado</Label>
            <Select value={estado} onValueChange={(v) => { setEstado(v as FiltroEstado); setPageIndex(0) }}><SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="piso">En piso</SelectItem><SelectItem value="terminadas">Terminadas</SelectItem><SelectItem value="sin-flujo">Sin flujo</SelectItem><SelectItem value="todas">Todas</SelectItem></SelectContent></Select></div>
          <div className="space-y-1"><Label className="text-xs">Etapa actual</Label>
            <Select value={etapa} onValueChange={(v) => { setEtapa(v); setPageIndex(0) }}><SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="todas">Todas</SelectItem>{ops.map((o) => <SelectItem key={o.id} value={o.nombre}>{o.nombre}</SelectItem>)}</SelectContent></Select></div>
          <div className="space-y-1"><Label className="text-xs">Semáforo</Label>
            <Select value={semaforo} onValueChange={(v) => { setSemaforo(v as FiltroSemaforo); setPageIndex(0) }}><SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="todos">Todos</SelectItem><SelectItem value="rojo">Atrasadas</SelectItem><SelectItem value="amarillo">En riesgo</SelectItem><SelectItem value="verde">A tiempo</SelectItem><SelectItem value="gris">Sin fecha</SelectItem></SelectContent></Select></div>
          <div className="space-y-1"><Label className="text-xs">Cliente</Label>
            <Select value={cliente} onValueChange={(v) => { setCliente(v); setPageIndex(0) }}><SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="todos">Todos</SelectItem>{clientes.map(([id, n]) => <SelectItem key={id} value={String(id)}>{n}</SelectItem>)}</SelectContent></Select></div>
          <div className="space-y-1"><Label className="text-xs">Tipo</Label>
            <Select value={tipo} onValueChange={(v) => { setTipo(v); setPageIndex(0) }}><SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="todos">Todos</SelectItem><SelectItem value="Trabajo">Órdenes de trabajo</SelectItem><SelectItem value="Produccion">Órdenes de producción</SelectItem></SelectContent></Select></div>
          <label className="flex items-center gap-2 text-sm pb-2"><Checkbox checked={soloUrgentes} onCheckedChange={(v) => { setSoloUrgentes(v === true); setPageIndex(0) }} /> Solo urgentes</label>
          <div className="space-y-1"><Label className="text-xs">Creadas desde</Label><Input type="date" value={desde} onChange={(e) => { setDesde(e.target.value); setPageIndex(0) }} /></div>
          <div className="space-y-1"><Label className="text-xs">Hasta</Label><Input type="date" value={hasta} onChange={(e) => { setHasta(e.target.value); setPageIndex(0) }} /></div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground sm:col-span-2 xl:col-span-6 pb-2">
            Etapas:
            {ops.map((o, i) => <span key={o.id} className="inline-flex items-center gap-1"><span className={`h-2.5 w-2.5 rounded-sm ${COLORES[i % COLORES.length]}`} />{o.nombre} ({o.estandar_h} h{o.configurado ? "" : " std"})</span>)}
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="tabla">
        <TabsList><TabsTrigger value="tabla">Tabla</TabsTrigger><TabsTrigger value="gantt">Línea de tiempo</TabsTrigger></TabsList>

        <TabsContent value="tabla" className="mt-3">
          <div className="overflow-x-auto border rounded-lg">
            <Table>
              <TableHeader>
                <TableRow className="bg-stone-50">
                  <TableHead className="w-8"></TableHead><TableHead>Orden</TableHead><TableHead>Cliente / trabajo</TableHead><TableHead>Creada</TableHead><TableHead>Compromiso</TableHead>
                  <TableHead>Recorrido</TableHead><TableHead>Etapa actual</TableHead><TableHead className="text-right">Lead time</TableHead><TableHead>Semáforo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pagina.map((r) => {
                  const open = abiertas.has(r.id)
                  return (
                    <React.Fragment key={r.id}>
                      <TableRow className="cursor-pointer" onClick={() => setAbiertas((p) => { const n = new Set(p); if (n.has(r.id)) n.delete(r.id); else n.add(r.id); return n })}>
                        <TableCell>{open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</TableCell>
                        <TableCell className="font-mono text-xs whitespace-nowrap">{r.codigo}{r.urgente && <Badge variant="destructive" className="ml-1 text-[9px] px-1 py-0">URG</Badge>}</TableCell>
                        <TableCell><p className="text-sm font-medium truncate max-w-[260px]">{r.cliente_nombre || "—"}</p><p className="text-xs text-muted-foreground truncate max-w-[260px]">{r.descripcion}</p></TableCell>
                        <TableCell className="text-xs whitespace-nowrap">{fmtFH(r.creada)}</TableCell>
                        <TableCell className="text-xs whitespace-nowrap">{fmtF(r.fecha_objetivo)}{r.atraso_dias != null && r.atraso_dias > 0 && <span className="block text-red-700">+{r.atraso_dias} d</span>}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            {r.etapas.map((e) => (
                              <span key={e.id} title={`${e.nombre}: ${e.estado}\nPlan ${fmtFH(e.plan_inicio)} → ${fmtFH(e.plan_fin)}\nReal ${fmtFH(e.fecha_recepcion)} → ${fmtFH(e.fecha_entrega)}`} className={`text-[10px] px-1.5 py-0.5 rounded ${estadoEtapaClase(e)}`}>{e.nombre.slice(0, 3)}</span>
                            ))}
                            {r.etapas.length === 0 && <span className="text-xs text-muted-foreground">Sin etapas</span>}
                          </div>
                          <div className="mt-1 h-1.5 w-full max-w-[160px] rounded bg-stone-100"><div className="h-1.5 rounded bg-emerald-500" style={{ width: `${r.progreso_pct}%` }} /></div>
                        </TableCell>
                        <TableCell><span className="text-sm">{r.etapa_actual || (r.estado === "Terminada" ? "Terminada" : "—")}</span><span className="block text-xs text-muted-foreground">{r.estado}</span></TableCell>
                        <TableCell className="text-right text-sm tabular-nums whitespace-nowrap">{fmtH(r.lead_h)}</TableCell>
                        <TableCell><span className="inline-flex items-center gap-1.5 text-xs"><span className={`h-2.5 w-2.5 rounded-full ${SEMAFORO[r.semaforo].clase}`} />{SEMAFORO[r.semaforo].texto}</span></TableCell>
                      </TableRow>
                      {open && (
                        <TableRow className="bg-stone-50/60">
                          <TableCell></TableCell>
                          <TableCell colSpan={8} className="py-2">
                            <div className="overflow-x-auto">
                              <table className="w-full text-xs">
                                <thead><tr className="text-muted-foreground text-left"><th className="py-1 pr-3">Etapa</th><th className="pr-3">Estado</th><th className="pr-3">Responsable</th><th className="pr-3">Plan inicio</th><th className="pr-3">Plan fin</th><th className="pr-3">Recepción real</th><th className="pr-3">Entrega real</th><th className="pr-3 text-right">Horas reales</th><th className="text-right">Desvío vs plan</th></tr></thead>
                                <tbody>
                                  {r.etapas.map((e) => (
                                    <tr key={e.id} className="border-t">
                                      <td className="py-1 pr-3 font-medium"><span className={`inline-block h-2 w-2 rounded-sm mr-1 ${COLORES[colorOp(e)]}`} />{e.nombre}</td>
                                      <td className="pr-3"><span className={`px-1.5 py-0.5 rounded text-[10px] ${estadoEtapaClase(e)}`}>{e.estado}</span></td>
                                      <td className="pr-3">{e.responsable || "—"}</td>
                                      <td className="pr-3 whitespace-nowrap">{fmtFH(e.plan_inicio)}{!e.plan_guardado && <span className="text-muted-foreground"> *</span>}</td>
                                      <td className="pr-3 whitespace-nowrap">{fmtFH(e.plan_fin)}</td>
                                      <td className="pr-3 whitespace-nowrap">{fmtFH(e.fecha_recepcion)}</td>
                                      <td className="pr-3 whitespace-nowrap">{fmtFH(e.fecha_entrega)}</td>
                                      <td className="pr-3 text-right tabular-nums">{fmtH(e.horas_reales)}</td>
                                      <td className={`text-right tabular-nums ${e.desvio_h != null && e.desvio_h > 0 ? "text-red-700" : "text-emerald-700"}`}>{e.desvio_h == null ? "—" : `${e.desvio_h > 0 ? "+" : "−"}${fmtH(Math.abs(e.desvio_h))}`}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                              <p className="mt-1 text-[11px] text-muted-foreground">{r.cantidad.toLocaleString("es-HN")} unidades · plan termina {fmtFH(r.plan_fin)}{r.notas ? ` · ${r.notas}` : ""}{r.etapas.some((e) => !e.plan_guardado) ? " · * plan calculado al vuelo" : ""}</p>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </React.Fragment>
                  )
                })}
                {filtradas.length === 0 && <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-8">Sin órdenes con estos filtros.</TableCell></TableRow>}
              </TableBody>
            </Table>
          </div>
          <TablePaginator pageIndex={pageIndex} pageSize={pageSize} totalItems={filtradas.length} onPageIndexChange={setPageIndex} onPageSizeChange={(s) => { setPageSize(s); setPageIndex(0) }} />
        </TabsContent>

        <TabsContent value="gantt" className="mt-3 space-y-2">
          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <span>Ventana:</span>
            <Select value={ventana} onValueChange={setVentana}><SelectTrigger className="w-[150px] h-8"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="7">Última semana</SelectItem><SelectItem value="14">Últimas 2 semanas</SelectItem><SelectItem value="21">Últimas 3 semanas</SelectItem><SelectItem value="45">Últimos 45 días</SelectItem></SelectContent></Select>
            <span className="inline-flex items-center gap-1"><span className="h-2 w-5 rounded-sm border-2 border-stone-500" /> Plan</span>
            <span className="inline-flex items-center gap-1"><span className="h-2 w-5 rounded-sm bg-stone-500" /> Real</span>
            <span className="inline-flex items-center gap-1"><span className="h-3 w-0.5 bg-red-500" /> Ahora</span>
            <span className="inline-flex items-center gap-1"><Flag className="h-3 w-3 text-stone-700" /> Compromiso</span>
            <span>Muestra la página actual de la tabla ({pagina.length} órdenes).</span>
          </div>
          <Gantt rows={pagina} colorOp={colorOp} dias={Number(ventana)} />
          <TablePaginator pageIndex={pageIndex} pageSize={pageSize} totalItems={filtradas.length} onPageIndexChange={setPageIndex} onPageSizeChange={(s) => { setPageSize(s); setPageIndex(0) }} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

function Gantt({ rows, colorOp, dias }: { rows: OrdenTracking[]; colorOp: (e: { operacion_id: number | null; nombre: string }) => number; dias: number }) {
  const ahoraISO = getHondurasNowISO()
  const ahora = Date.parse(ahoraISO)
  const fin = Date.UTC(Number(ahoraISO.slice(0, 4)), Number(ahoraISO.slice(5, 7)) - 1, Number(ahoraISO.slice(8, 10)) + 5)
  const ini = fin - (dias + 5) * 86_400_000
  const span = fin - ini
  const x = (iso: string | null) => (iso ? Math.min(100, Math.max(0, ((Date.parse(iso) - ini) / span) * 100)) : null)
  const ticks: { pos: number; label: string; lunes: boolean }[] = []
  for (let t = ini; t <= fin; t += 86_400_000) {
    const d = new Date(t)
    ticks.push({ pos: ((t - ini) / span) * 100, label: `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}`, lunes: d.getUTCDay() === 1 })
  }
  const paso = dias > 21 ? 7 : dias > 7 ? 2 : 1

  if (rows.length === 0) return <p className="text-sm text-muted-foreground py-6 text-center">Sin órdenes con estos filtros.</p>

  return (
    <div className="border rounded-lg overflow-x-auto">
      <div className="min-w-[900px]">
        <div className="flex border-b bg-stone-50 text-[10px] text-muted-foreground">
          <div className="w-[240px] shrink-0 px-2 py-1">Orden</div>
          <div className="relative flex-1 h-6">
            {ticks.map((t, i) => (i % paso === 0 || t.lunes) && <span key={i} className={`absolute top-1 -translate-x-1/2 ${t.lunes ? "font-semibold text-stone-600" : ""}`} style={{ left: `${t.pos}%` }}>{t.label}</span>)}
          </div>
        </div>
        {rows.map((r) => (
          <div key={r.id} className="flex border-b last:border-0 hover:bg-stone-50/60">
            <div className="w-[240px] shrink-0 px-2 py-1.5 text-xs">
              <span className="font-mono">{r.codigo}</span> <span className={`inline-block h-2 w-2 rounded-full align-middle ${SEMAFORO[r.semaforo].clase}`} />
              <p className="truncate text-muted-foreground">{r.cliente_nombre || r.descripcion}</p>
            </div>
            <div className="relative flex-1 h-11">
              {ticks.filter((t) => t.lunes).map((t, i) => <div key={i} className="absolute top-0 bottom-0 w-px bg-stone-100" style={{ left: `${t.pos}%` }} />)}
              {r.etapas.map((e) => {
                const c = colorOp(e)
                const pi = x(e.plan_inicio), pf = x(e.plan_fin)
                const ri = x(e.fecha_recepcion), rf = x(e.fecha_entrega ?? (e.fecha_recepcion ? ahoraISO : null))
                return (
                  <React.Fragment key={e.id}>
                    {pi != null && pf != null && pf > pi && <div title={`${e.nombre} plan ${fmtFH(e.plan_inicio)} → ${fmtFH(e.plan_fin)}`} className={`absolute top-1.5 h-2.5 rounded-sm border-2 ${BORDES[c]} bg-white/60`} style={{ left: `${pi}%`, width: `${Math.max(0.4, pf - pi)}%` }} />}
                    {ri != null && rf != null && <div title={`${e.nombre} real ${fmtFH(e.fecha_recepcion)} → ${e.fecha_entrega ? fmtFH(e.fecha_entrega) : "en curso"}`} className={`absolute top-5 h-3.5 rounded-sm ${COLORES[c]} ${e.estado !== "Entregada" ? "opacity-60 ring-1 ring-offset-0 ring-stone-700" : ""}`} style={{ left: `${ri}%`, width: `${Math.max(0.4, rf - ri)}%` }} />}
                  </React.Fragment>
                )
              })}
              {r.fecha_objetivo && x(`${r.fecha_objetivo}T17:00:00.000Z`) != null && <Flag className="absolute top-0.5 h-3 w-3 -translate-x-1/2 text-stone-700" style={{ left: `${x(`${r.fecha_objetivo}T17:00:00.000Z`)}%` }} />}
              <div className="absolute top-0 bottom-0 w-0.5 bg-red-500" style={{ left: `${((ahora - ini) / span) * 100}%` }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
