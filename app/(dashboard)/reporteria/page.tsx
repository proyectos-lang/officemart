"use client"

import * as React from "react"
import {
  FileSpreadsheet, Download, Save, CopyPlus, Plus, Trash2, Search, Loader2, ArrowLeft, ArrowRight, Filter, Columns3, Database,
  Star, RefreshCw, AlertTriangle, X, FolderOpen,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import { Spinner } from "@/components/ui/spinner"
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useToast } from "@/hooks/use-toast"
import { useAuth } from "@/lib/contexts/auth-context"
import { useTenant } from "@/lib/hooks/use-tenant"
import { createClient } from "@/lib/supabase/client"
import { formatCurrency } from "@/lib/utils/format"
import { getHondurasNowISO, getHondurasTodayISODate } from "@/lib/utils/honduras-time"
import { FUENTES, SISTEMAS, getFuente, type FuenteReporte } from "@/lib/reporteria/fuentes"
import {
  ejecutarReporte, resolverRango, configInicial, valoresDistintos, esFecha, esNumerica, textoValor,
  ETIQUETA_PRESET, ETIQUETA_OPERADOR,
  type ConfigReporte, type FiltroReporte, type OperadorFiltro, type PresetRango, type ResultadoReporte, type TipoColumna,
} from "@/lib/reporteria/motor"
import { exportarReporteXlsx } from "@/lib/reporteria/excel"
import { getReportesGuardados, guardarReporte, eliminarReporte, registrarExportacion, REPORTES_FEATURE_PENDING, type ReporteGuardado } from "@/lib/services/reportes-guardados"

const PRESETS: PresetRango[] = ["hoy", "ayer", "semana", "semana_anterior", "mes", "mes_anterior", "trimestre", "anio", "ultimos_7", "ultimos_30", "ultimos_90", "todo", "personalizado"]
const OPS_TEXTO: OperadorFiltro[] = ["contiene", "no_contiene", "igual", "distinto", "en", "vacio", "no_vacio"]
const OPS_NUM: OperadorFiltro[] = ["igual", "distinto", "mayor", "menor", "entre", "vacio", "no_vacio"]
const OPS_FECHA: OperadorFiltro[] = ["igual", "mayor", "menor", "entre", "vacio", "no_vacio"]
const opsDe = (t: TipoColumna) => (esNumerica(t) ? OPS_NUM : esFecha(t) ? OPS_FECHA : OPS_TEXTO)
const FILAS_VISTA = 200

const ddmm = (iso: string | null | undefined) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "")
function fmtCelda(v: unknown, tipo: TipoColumna): string {
  if (v == null || v === "") return ""
  if (tipo === "moneda") return formatCurrency(Number(v))
  if (tipo === "numero") return Number(v).toLocaleString("es-HN", { maximumFractionDigits: 2 })
  if (tipo === "porcentaje") return `${Number(v).toFixed(2)} %`
  if (tipo === "fecha") return /^\d{4}-\d{2}-\d{2}/.test(String(v)) ? ddmm(String(v)) : String(v)
  if (tipo === "fechahora") return `${ddmm(String(v))} ${String(v).slice(11, 16)}`
  return textoValor(v, tipo)
}

function describirPeriodo(cfg: ConfigReporte, f: FuenteReporte | null, hoy: string): string {
  if (!f?.fecha) return "Foto actual (sin período)"
  const r = resolverRango(cfg.rango, hoy)
  if (!r.desde && !r.hasta) return "Todo el historial"
  return `${ETIQUETA_PRESET[cfg.rango.preset]}: ${r.desde ? ddmm(r.desde) : "inicio"} al ${r.hasta ? ddmm(r.hasta) : "hoy"}`
}
function describirFiltros(cfg: ConfigReporte, f: FuenteReporte): string[] {
  return cfg.filtros.map((x) => {
    const col = f.columnas.find((c) => c.key === x.col)?.label ?? x.col
    const val = x.op === "en" ? (x.valores || []).join(", ") : x.op === "entre" ? `${x.valor} y ${x.valor2}` : x.valor ?? ""
    return `${col} ${ETIQUETA_OPERADOR[x.op]}${x.op === "vacio" || x.op === "no_vacio" ? "" : ` ${val}`}`
  })
}

/** Completa una configuración guardada y la deja como reporte de detalle (sin agrupación ni orden). */
function normalizar(cfg: ConfigReporte): ConfigReporte {
  const f = getFuente(cfg.fuente)
  if (!f) return cfg
  const base = configInicial(f.id, f.columnas, !!f.fecha)
  return { ...base, ...cfg, columnas: cfg.columnas?.length ? cfg.columnas : base.columnas, filtros: cfg.filtros ?? [], agrupar: [], medidas: [], orden: null, totales: cfg.totales ?? true }
}

export default function ReporteriaPage() {
  const { toast } = useToast()
  const { user } = useAuth()
  const { ready, razonSocialId } = useTenant()
  const hoy = getHondurasTodayISODate()

  const [guardados, setGuardados] = React.useState<ReporteGuardado[]>([])
  const [local, setLocal] = React.useState(false)
  const [busqueda, setBusqueda] = React.useState("")
  const [actual, setActual] = React.useState<ReporteGuardado | null>(null)
  const [cfg, setCfg] = React.useState<ConfigReporte | null>(null)
  const [filas, setFilas] = React.useState<Record<string, unknown>[] | null>(null)
  const [cargando, setCargando] = React.useState(false)
  const [errorCarga, setErrorCarga] = React.useState<string | null>(null)
  const [exportando, setExportando] = React.useState<string | null>(null)
  const [guardar, setGuardar] = React.useState<{ open: boolean; nuevo: boolean; nombre: string; descripcion: string; favorito: boolean; saving: boolean }>({ open: false, nuevo: true, nombre: "", descripcion: "", favorito: false, saving: false })
  const pedido = React.useRef(0)

  const fuente = cfg ? getFuente(cfg.fuente) : null

  React.useEffect(() => {
    if (!ready || razonSocialId == null) return
    let activo = true
    getReportesGuardados().then((r) => {
      if (!activo) return
      if (r.error) toast({ title: "No se pudieron cargar los reportes guardados", description: r.error, variant: "destructive" })
      setGuardados(r.data)
      setLocal(r.local)
    })
    return () => {
      activo = false
    }
  }, [ready, razonSocialId, toast])

  async function recargarGuardados() {
    const r = await getReportesGuardados()
    setGuardados(r.data)
    setLocal(r.local)
  }

  async function cargarFilas(c: ConfigReporte): Promise<Record<string, unknown>[] | null> {
    const f = getFuente(c.fuente)
    const supabase = createClient()
    if (!f || !supabase) return null
    const r = f.fecha ? resolverRango(c.rango, hoy) : { desde: null, hasta: null }
    return f.cargar({ supabase, desde: r.desde, hasta: r.hasta, hoy })
  }

  /** Carga los datos de la fuente para el período de `c` (columnas y filtros se aplican al instante). */
  async function cargarDatos(c: ConfigReporte) {
    const id = ++pedido.current
    setCargando(true)
    setErrorCarga(null)
    try {
      const data = await cargarFilas(c)
      if (id !== pedido.current) return
      setFilas(data)
    } catch (e) {
      if (id !== pedido.current) return
      setFilas(null)
      setErrorCarga(e instanceof Error ? e.message : "No se pudieron cargar los datos")
    } finally {
      if (id === pedido.current) setCargando(false)
    }
  }

  function abrirConfig(c: ConfigReporte, reporte: ReporteGuardado | null) {
    const n = normalizar(c)
    setCfg(n)
    setActual(reporte)
    setFilas(null)
    cargarDatos(n)
  }

  function cambiarFuente(id: string) {
    const f = getFuente(id)
    if (!f) return
    abrirConfig(configInicial(f.id, f.columnas, !!f.fecha), null)
  }

  function cambiarRango(rango: ConfigReporte["rango"]) {
    if (!cfg) return
    const n = { ...cfg, rango }
    setCfg(n)
    if (rango.preset !== "personalizado" || (rango.desde && rango.hasta)) cargarDatos(n)
  }

  const set = (patch: Partial<ConfigReporte>) => setCfg((c) => (c ? { ...c, ...patch } : c))

  const resultado: ResultadoReporte | null = React.useMemo(() => {
    if (!cfg || !fuente || !filas) return null
    return ejecutarReporte(filas, fuente.columnas, cfg)
  }, [cfg, fuente, filas])

  function metaExport(c: ConfigReporte, f: FuenteReporte, nombre: string) {
    const ahora = getHondurasNowISO()
    return {
      nombre, fuente: f.nombre, sistema: f.sistema, periodo: describirPeriodo(c, f, hoy), filtros: describirFiltros(c, f), agrupacion: [],
      generadoPor: user?.nombre || "", generadoEl: `${ahora.slice(0, 10)} ${ahora.slice(11, 16)}`, empresa: user?.razon_social_nombre || "",
    }
  }

  async function exportarActual() {
    if (!cfg || !fuente || !resultado) return
    setExportando("actual")
    try {
      await exportarReporteXlsx(resultado, metaExport(cfg, fuente, actual?.nombre || fuente.nombre))
      if (actual) {
        await registrarExportacion(actual)
        recargarGuardados()
      }
    } catch (e) {
      toast({ title: "No se pudo exportar", description: e instanceof Error ? e.message : "", variant: "destructive" })
    } finally {
      setExportando(null)
    }
  }

  /** Exporta un reporte guardado sin abrirlo (recalcula su período relativo). */
  async function exportarGuardado(r: ReporteGuardado) {
    const c = normalizar(r.config)
    const f = getFuente(c.fuente)
    if (!f) return toast({ title: "La fuente del reporte ya no existe", variant: "destructive" })
    setExportando(`g${r.id}`)
    try {
      const data = await cargarFilas(c)
      const res = ejecutarReporte(data || [], f.columnas, c)
      await exportarReporteXlsx(res, metaExport(c, f, r.nombre))
      await registrarExportacion(r)
      recargarGuardados()
      toast({ title: "Reporte exportado", description: `${r.nombre}: ${res.filas.length} filas` })
    } catch (e) {
      toast({ title: "No se pudo exportar", description: e instanceof Error ? e.message : "", variant: "destructive" })
    } finally {
      setExportando(null)
    }
  }

  async function confirmarGuardar() {
    if (!cfg) return
    setGuardar((g) => ({ ...g, saving: true }))
    const r = await guardarReporte({ id: guardar.nuevo ? null : actual?.id ?? null, nombre: guardar.nombre, descripcion: guardar.descripcion, config: normalizar(cfg), favorito: guardar.favorito })
    setGuardar((g) => ({ ...g, saving: false }))
    if (r.error || !r.data) return toast({ title: "No se pudo guardar", description: r.error ?? "", variant: "destructive" })
    setActual(r.data)
    setGuardar((g) => ({ ...g, open: false }))
    toast({ title: "Reporte guardado", description: r.data.nombre })
    recargarGuardados()
  }

  async function borrar(r: ReporteGuardado) {
    if (!window.confirm(`¿Eliminar el reporte «${r.nombre}»?`)) return
    const res = await eliminarReporte(r.id)
    if (!res.success) return toast({ title: "No se pudo eliminar", description: res.error ?? "", variant: "destructive" })
    if (actual?.id === r.id) setActual(null)
    recargarGuardados()
  }

  // ---------- edición de columnas y filtros ----------
  function toggleColumna(key: string, on: boolean) {
    if (!cfg || !fuente) return
    const orden = fuente.columnas.map((c) => c.key)
    set({ columnas: on ? [...cfg.columnas, key].sort((a, b) => (cfg.columnas.includes(a) && cfg.columnas.includes(b) ? cfg.columnas.indexOf(a) - cfg.columnas.indexOf(b) : orden.indexOf(a) - orden.indexOf(b))) : cfg.columnas.filter((k) => k !== key) })
  }
  function moverColumna(i: number, d: -1 | 1) {
    if (!cfg) return
    const cols = [...cfg.columnas]
    const j = i + d
    if (j < 0 || j >= cols.length) return
    ;[cols[i], cols[j]] = [cols[j], cols[i]]
    set({ columnas: cols })
  }
  const setFiltro = (i: number, patch: Partial<FiltroReporte>) => cfg && set({ filtros: cfg.filtros.map((f, k) => (k === i ? { ...f, ...patch } : f)) })

  const guardadosVisibles = guardados.filter((g) => !busqueda.trim() || `${g.nombre} ${g.descripcion ?? ""} ${getFuente(g.fuente)?.nombre ?? ""}`.toLowerCase().includes(busqueda.trim().toLowerCase()))

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="rounded-lg bg-stone-200 p-2 text-stone-700"><FileSpreadsheet className="h-5 w-5" /></div>
        <div>
          <h1 className="text-2xl font-semibold text-stone-800">Reportería</h1>
          <p className="text-sm text-muted-foreground">Reportes de todos los sistemas con las columnas y filtros que elijas, exportables a Excel. Guárdalos para volver a exportarlos.</p>
        </div>
      </div>

      {local && <Card className="border-amber-200 bg-amber-50"><CardContent className="p-3 text-sm text-amber-800 flex items-start gap-2"><AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /> {REPORTES_FEATURE_PENDING}</CardContent></Card>}

      {/* ---------- Mis reportes ---------- */}
      <Card>
        <CardHeader className="p-4 pb-2">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <CardTitle className="text-base flex items-center gap-2"><FolderOpen className="h-4 w-4" /> Mis reportes <Badge variant="secondary">{guardados.length}</Badge></CardTitle>
            <div className="relative sm:w-72"><Search className="h-4 w-4 absolute left-2 top-2.5 text-muted-foreground" /><Input className="pl-8 h-9" placeholder="Buscar reporte…" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} /></div>
          </div>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          {guardados.length === 0 ? (
            <p className="text-xs text-muted-foreground py-2">Aún no hay reportes guardados. Arma uno abajo y pulsa «Guardar».</p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 max-h-56 overflow-y-auto">
              {guardadosVisibles.map((g) => (
                <div key={g.id} className={`group rounded-md border p-2 text-sm cursor-pointer hover:bg-stone-50 ${actual?.id === g.id ? "border-stone-500 bg-stone-50" : ""}`} onClick={() => abrirConfig(g.config, g)}>
                  <div className="flex items-start justify-between gap-1">
                    <p className="font-medium leading-tight">{g.favorito && <Star className="inline h-3 w-3 mr-1 fill-amber-400 text-amber-400" />}{g.nombre}</p>
                    <div className="flex items-center gap-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                      <Button variant="ghost" size="icon" className="h-7 w-7" title="Exportar a Excel" onClick={() => exportarGuardado(g)} disabled={exportando === `g${g.id}`}>{exportando === `g${g.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}</Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-red-700 opacity-60 group-hover:opacity-100" title="Eliminar" onClick={() => borrar(g)}><Trash2 className="h-3.5 w-3.5" /></Button>
                    </div>
                  </div>
                  <p className="text-[11px] text-muted-foreground">{getFuente(g.fuente)?.nombre ?? g.fuente} · {ETIQUETA_PRESET[g.config.rango?.preset ?? "todo"]}</p>
                  {g.exportaciones > 0 && <p className="text-[11px] text-muted-foreground">{g.exportaciones} exportación(es){g.ultima_exportacion ? ` · última ${ddmm(g.ultima_exportacion)}` : ""}</p>}
                </div>
              ))}
              {guardadosVisibles.length === 0 && <p className="text-xs text-muted-foreground py-2">Ningún reporte coincide con la búsqueda.</p>}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ---------- 1. Datos y período ---------- */}
      <Card>
        <CardHeader className="p-4 pb-2"><CardTitle className="text-base flex items-center gap-2"><Database className="h-4 w-4" /> 1. Datos y período</CardTitle></CardHeader>
        <CardContent className="p-4 pt-0 grid gap-3 md:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-xs">Fuente ({FUENTES.length} disponibles)</Label>
            <Select value={cfg?.fuente ?? ""} onValueChange={cambiarFuente}>
              <SelectTrigger><SelectValue placeholder="Elige qué quieres reportar…" /></SelectTrigger>
              <SelectContent>
                {SISTEMAS.map((s) => (
                  <SelectGroup key={s}>
                    <SelectLabel>{s}</SelectLabel>
                    {FUENTES.filter((f) => f.sistema === s).map((f) => <SelectItem key={f.id} value={f.id}>{f.nombre}</SelectItem>)}
                  </SelectGroup>
                ))}
              </SelectContent>
            </Select>
            {fuente && <p className="text-xs text-muted-foreground">{fuente.descripcion}</p>}
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Período {fuente?.fecha ? <span className="text-muted-foreground">· por {fuente.fecha.toLowerCase()}</span> : null}</Label>
            {fuente && !fuente.fecha ? (
              <p className="text-sm text-muted-foreground border rounded-md px-3 py-2">Foto actual: esta fuente no usa período.</p>
            ) : (
              <>
                <div className={`grid gap-2 ${cfg?.rango.preset === "personalizado" ? "sm:grid-cols-3" : ""}`}>
                  <Select value={cfg?.rango.preset ?? "mes"} onValueChange={(v) => cfg && cambiarRango({ preset: v as PresetRango, desde: v === "personalizado" ? resolverRango(cfg.rango, hoy).desde ?? hoy : null, hasta: v === "personalizado" ? resolverRango(cfg.rango, hoy).hasta ?? hoy : null })} disabled={!cfg}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{PRESETS.map((p) => <SelectItem key={p} value={p}>{ETIQUETA_PRESET[p]}</SelectItem>)}</SelectContent>
                  </Select>
                  {cfg?.rango.preset === "personalizado" && (
                    <>
                      <Input type="date" value={cfg.rango.desde ?? ""} onChange={(e) => cambiarRango({ ...cfg.rango, desde: e.target.value })} />
                      <Input type="date" value={cfg.rango.hasta ?? ""} onChange={(e) => cambiarRango({ ...cfg.rango, hasta: e.target.value })} />
                    </>
                  )}
                </div>
                {cfg && fuente && <p className="text-xs text-muted-foreground">{describirPeriodo(cfg, fuente, hoy)}{cfg.rango.preset !== "personalizado" && cfg.rango.preset !== "todo" ? " · se recalcula cada vez que se exporta" : ""}</p>}
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {!cfg || !fuente ? (
        <Card><CardContent className="py-12 text-center text-sm text-muted-foreground"><FileSpreadsheet className="h-10 w-10 mx-auto mb-2 opacity-40" />Elige una fuente o un reporte guardado para empezar.</CardContent></Card>
      ) : (
        <>
          {/* ---------- 2. Columnas ---------- */}
          <Card>
            <CardHeader className="p-4 pb-2">
              <CardTitle className="text-base flex items-center justify-between gap-2 flex-wrap">
                <span className="flex items-center gap-2"><Columns3 className="h-4 w-4" /> 2. Columnas <Badge variant="secondary">{cfg.columnas.length} de {fuente.columnas.length}</Badge></span>
                <span className="flex gap-1">
                  <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => set({ columnas: fuente.columnas.map((c) => c.key) })}>Todas</Button>
                  <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => set({ columnas: configInicial(fuente.id, fuente.columnas, true).columnas })}>Por defecto</Button>
                  <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => set({ columnas: [] })}>Ninguna</Button>
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0 space-y-3">
              <div className="grid gap-x-4 gap-y-1 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
                {fuente.columnas.map((c) => (
                  <label key={c.key} className="flex items-center gap-2 text-sm py-0.5 min-w-0">
                    <Checkbox checked={cfg.columnas.includes(c.key)} onCheckedChange={(v) => toggleColumna(c.key, v === true)} />
                    <span className="truncate">{c.label}</span>
                  </label>
                ))}
              </div>
              {cfg.columnas.length > 0 && (
                <div className="border-t pt-2">
                  <p className="text-[11px] text-muted-foreground mb-1.5">Orden en el Excel (usa las flechas para mover)</p>
                  <div className="flex flex-wrap gap-1.5">
                    {cfg.columnas.map((k, i) => (
                      <span key={k} className="inline-flex items-center gap-0.5 rounded-md border bg-stone-50 pl-1 pr-2 py-0.5 text-xs">
                        <button className="p-0.5 text-stone-400 hover:text-stone-700 disabled:opacity-30" disabled={i === 0} onClick={() => moverColumna(i, -1)} title="Mover a la izquierda"><ArrowLeft className="h-3 w-3" /></button>
                        <button className="p-0.5 text-stone-400 hover:text-stone-700 disabled:opacity-30" disabled={i === cfg.columnas.length - 1} onClick={() => moverColumna(i, 1)} title="Mover a la derecha"><ArrowRight className="h-3 w-3" /></button>
                        <span className="ml-0.5">{i + 1}. {fuente.columnas.find((c) => c.key === k)?.label ?? k}</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* ---------- 3. Filtros ---------- */}
          <Card>
            <CardHeader className="p-4 pb-2">
              <CardTitle className="text-base flex items-center justify-between gap-2">
                <span className="flex items-center gap-2"><Filter className="h-4 w-4" /> 3. Filtros <Badge variant="secondary">{cfg.filtros.length}</Badge></span>
                <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={() => set({ filtros: [...cfg.filtros, { col: fuente.columnas[0].key, op: opsDe(fuente.columnas[0].tipo)[0] }] })}><Plus className="h-3.5 w-3.5" /> Filtro</Button>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0 space-y-2">
              {cfg.filtros.map((f, i) => {
                const col = fuente.columnas.find((c) => c.key === f.col) ?? fuente.columnas[0]
                const tipoInput = esFecha(col.tipo) ? "date" : esNumerica(col.tipo) ? "number" : "text"
                return (
                  <div key={i} className="rounded-md border p-2 space-y-1.5">
                    <div className="grid gap-1.5 md:grid-cols-[220px_180px_1fr_28px] grid-cols-[1fr_1fr_28px] items-start">
                      <Select value={f.col} onValueChange={(v) => { const t = fuente.columnas.find((c) => c.key === v)!.tipo; setFiltro(i, { col: v, op: opsDe(t)[0], valor: "", valor2: "", valores: [] }) }}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>{fuente.columnas.map((c) => <SelectItem key={c.key} value={c.key}>{c.label}</SelectItem>)}</SelectContent>
                      </Select>
                      <Select value={f.op} onValueChange={(v) => setFiltro(i, { op: v as OperadorFiltro })}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>{opsDe(col.tipo).map((o) => <SelectItem key={o} value={o}>{ETIQUETA_OPERADOR[o]}</SelectItem>)}</SelectContent>
                      </Select>
                      <div className="col-span-3 md:col-span-1 md:order-none order-last">
                        {f.op === "en" ? (
                          <div className="flex flex-wrap gap-1 max-h-28 overflow-y-auto">
                            {valoresDistintos(filas || [], f.col, col.tipo).map((v) => {
                              const on = (f.valores || []).includes(v)
                              return <button key={v} className={`text-[11px] rounded border px-1.5 py-0.5 ${on ? "bg-stone-800 text-white border-stone-800" : "bg-white"}`} onClick={() => setFiltro(i, { valores: on ? (f.valores || []).filter((x) => x !== v) : [...(f.valores || []), v] })}>{v}</button>
                            })}
                            {(filas || []).length === 0 && <span className="text-[11px] text-muted-foreground">Carga los datos para ver los valores.</span>}
                          </div>
                        ) : f.op !== "vacio" && f.op !== "no_vacio" ? (
                          <div className={`grid gap-1.5 ${f.op === "entre" ? "grid-cols-2" : ""}`}>
                            <Input className="h-8 text-xs" type={tipoInput} value={f.valor ?? ""} onChange={(e) => setFiltro(i, { valor: e.target.value })} placeholder={col.tipo === "booleano" ? "Sí o No" : "Valor"} list={tipoInput === "text" ? `dl-${i}` : undefined} />
                            {f.op === "entre" && <Input className="h-8 text-xs" type={tipoInput} value={f.valor2 ?? ""} onChange={(e) => setFiltro(i, { valor2: e.target.value })} placeholder="Hasta" />}
                            {tipoInput === "text" && <datalist id={`dl-${i}`}>{valoresDistintos(filas || [], f.col, col.tipo, 100).map((v) => <option key={v} value={v} />)}</datalist>}
                          </div>
                        ) : null}
                      </div>
                      <Button variant="ghost" size="icon" className="h-8 w-7" onClick={() => set({ filtros: cfg.filtros.filter((_, k) => k !== i) })}><X className="h-3.5 w-3.5" /></Button>
                    </div>
                  </div>
                )
              })}
              {cfg.filtros.length === 0 && <p className="text-xs text-muted-foreground">Sin filtros: se incluyen todos los registros del período.</p>}
            </CardContent>
          </Card>

          {/* ---------- Resultado (ancho completo) ---------- */}
          <Card>
            <CardHeader className="p-4 pb-2">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-2">
                <div>
                  <CardTitle className="text-base">{actual ? actual.nombre : "Resultado"}{actual?.local && <Badge variant="outline" className="ml-2 text-[10px]">en este navegador</Badge>}</CardTitle>
                  <CardDescription className="text-xs">
                    {cargando ? "Cargando datos…" : resultado ? `${resultado.filas.length.toLocaleString("es-HN")} filas en el Excel${resultado.filas.length > FILAS_VISTA ? ` · se muestran las primeras ${FILAS_VISTA}` : ""}` : errorCarga ? "" : "Sin datos cargados"}
                  </CardDescription>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <label className="flex items-center gap-1.5 text-xs mr-1"><Checkbox checked={cfg.totales} onCheckedChange={(v) => set({ totales: v === true })} /> Fila de totales</label>
                  <Button variant="outline" size="sm" className="gap-1" onClick={() => cargarDatos(cfg)} disabled={cargando}><RefreshCw className={`h-4 w-4 ${cargando ? "animate-spin" : ""}`} /> Actualizar datos</Button>
                  <Button variant="outline" size="sm" className="gap-1" onClick={() => setGuardar({ open: true, nuevo: !actual, nombre: actual?.nombre ?? "", descripcion: actual?.descripcion ?? "", favorito: actual?.favorito ?? false, saving: false })}><Save className="h-4 w-4" /> Guardar</Button>
                  {actual && <Button variant="outline" size="sm" className="gap-1" onClick={() => setGuardar({ open: true, nuevo: true, nombre: `${actual.nombre} (copia)`, descripcion: actual.descripcion ?? "", favorito: false, saving: false })}><CopyPlus className="h-4 w-4" /> Guardar como</Button>}
                  <Button size="sm" className="gap-1" onClick={exportarActual} disabled={!resultado || cargando || exportando === "actual" || cfg.columnas.length === 0}>{exportando === "actual" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Exportar a Excel</Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              {errorCarga && <p className="text-sm text-red-700 flex items-center gap-1 py-3"><AlertTriangle className="h-4 w-4" /> {errorCarga}</p>}
              {cargando ? (
                <div className="flex items-center gap-2 py-10 justify-center text-sm text-muted-foreground"><Spinner /> Cargando…</div>
              ) : resultado && (
                resultado.columnas.length === 0 ? <p className="text-sm text-muted-foreground py-6 text-center">Elige al menos una columna.</p> : (
                  <div className="overflow-auto border rounded-lg max-h-[70vh]">
                    <Table>
                      <TableHeader className="sticky top-0 bg-stone-50 z-10">
                        <TableRow>{resultado.columnas.map((c) => <TableHead key={c.key} className={`whitespace-nowrap ${esNumerica(c.tipo) ? "text-right" : ""}`}>{c.label}</TableHead>)}</TableRow>
                      </TableHeader>
                      <TableBody>
                        {resultado.filas.slice(0, FILAS_VISTA).map((f, i) => (
                          <TableRow key={i}>{resultado.columnas.map((c) => <TableCell key={c.key} className={`whitespace-nowrap text-xs ${esNumerica(c.tipo) ? "text-right tabular-nums" : ""}`}>{fmtCelda(f[c.key], c.tipo)}</TableCell>)}</TableRow>
                        ))}
                        {resultado.total && (
                          <TableRow className="bg-stone-100 font-semibold">{resultado.columnas.map((c) => <TableCell key={c.key} className={`whitespace-nowrap text-xs ${esNumerica(c.tipo) ? "text-right tabular-nums" : ""}`}>{resultado.total![c.key] == null ? "" : typeof resultado.total![c.key] === "number" ? fmtCelda(resultado.total![c.key], c.tipo) : String(resultado.total![c.key])}</TableCell>)}</TableRow>
                        )}
                        {resultado.filas.length === 0 && <TableRow><TableCell colSpan={resultado.columnas.length} className="text-center text-muted-foreground py-8">Sin registros con este período y filtros.</TableCell></TableRow>}
                      </TableBody>
                    </Table>
                  </div>
                )
              )}
            </CardContent>
          </Card>
        </>
      )}

      <Dialog open={guardar.open} onOpenChange={(o) => setGuardar((g) => ({ ...g, open: o }))}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{guardar.nuevo ? "Guardar reporte" : "Actualizar reporte"}</DialogTitle>
            <DialogDescription>Se guarda la fuente, las columnas, el período y los filtros. Si el período es relativo («Este mes»), se recalcula cada vez que lo exportes.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1"><Label>Nombre</Label><Input value={guardar.nombre} onChange={(e) => setGuardar((g) => ({ ...g, nombre: e.target.value }))} placeholder="Ej. Ventas del mes" autoFocus /></div>
            <div className="space-y-1"><Label>Descripción (opcional)</Label><Textarea rows={2} value={guardar.descripcion} onChange={(e) => setGuardar((g) => ({ ...g, descripcion: e.target.value }))} /></div>
            <label className="flex items-center gap-2 text-sm"><Checkbox checked={guardar.favorito} onCheckedChange={(v) => setGuardar((g) => ({ ...g, favorito: v === true }))} /> Destacar arriba de la lista</label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setGuardar((g) => ({ ...g, open: false }))}>Cancelar</Button>
            <Button onClick={confirmarGuardar} disabled={guardar.saving || !guardar.nombre.trim()}>{guardar.saving && <Loader2 className="h-4 w-4 animate-spin mr-1" />} Guardar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
