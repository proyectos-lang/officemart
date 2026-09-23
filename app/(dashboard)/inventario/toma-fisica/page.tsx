"use client"

import * as React from "react"
import { ClipboardCheck, Plus, Loader2, Lock, Download, Upload, Search, CheckCircle2, XCircle, ArrowLeft, Barcode } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Spinner } from "@/components/ui/spinner"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { TablePaginator } from "@/components/ui/table-paginator"
import { useToast } from "@/hooks/use-toast"
import { useTenant } from "@/lib/hooks/use-tenant"
import { useAuth } from "@/lib/contexts/auth-context"
import { formatCurrency, formatNumber } from "@/lib/utils/format"
import { formatHondurasDateTime } from "@/lib/utils/honduras-time"
import { exportToXlsx } from "@/lib/utils/export"
import { getAlmacenes, type Almacen } from "@/lib/services/catalogos"
import {
  getTomas, getTomaDetalle, abrirToma, registrarConteo, parsearConteosXlsx, mapearConteosImportados, cerrarToma, cancelarToma,
  calcularResumenToma, TOMA_FEATURE_PENDING, type TomaFisica, type TomaDetalle,
} from "@/lib/services/toma-fisica"

export default function TomaFisicaPage() {
  const { toast } = useToast()
  const { ready, razonSocialId } = useTenant()
  const { user } = useAuth()

  const [loading, setLoading] = React.useState(true)
  const [pendiente, setPendiente] = React.useState(false)
  const [tomas, setTomas] = React.useState<TomaFisica[]>([])
  const [almacenes, setAlmacenes] = React.useState<Almacen[]>([])

  // Nueva toma
  const [nuevaOpen, setNuevaOpen] = React.useState(false)
  const [nuevaAlmacen, setNuevaAlmacen] = React.useState("")
  const [nuevaNotas, setNuevaNotas] = React.useState("")
  const [abriendo, setAbriendo] = React.useState(false)

  // Detalle
  const [toma, setToma] = React.useState<TomaFisica | null>(null)
  const [detalle, setDetalle] = React.useState<TomaDetalle[]>([])
  const [cargandoDetalle, setCargandoDetalle] = React.useState(false)
  const [busqueda, setBusqueda] = React.useState("")
  const [soloSinContar, setSoloSinContar] = React.useState(false)
  const [pageIndex, setPageIndex] = React.useState(0)
  const [pageSize, setPageSize] = React.useState(100)
  const [conteos, setConteos] = React.useState<Record<number, string>>({})
  const [guardando, setGuardando] = React.useState(false)
  const [contadoPor, setContadoPor] = React.useState(user?.nombre || "")
  const [scan, setScan] = React.useState("")
  const scanRef = React.useRef<HTMLInputElement>(null)
  const fileRef = React.useRef<HTMLInputElement>(null)

  // Cierre
  const [cerrarOpen, setCerrarOpen] = React.useState(false)
  const [ajustarNoContadas, setAjustarNoContadas] = React.useState(false)
  const [cerrando, setCerrando] = React.useState(false)

  React.useEffect(() => {
    if (!ready || razonSocialId == null) return
    cargar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, razonSocialId])

  async function cargar() {
    setLoading(true)
    const [t, a] = await Promise.all([getTomas(), getAlmacenes()])
    setPendiente(t.pendiente)
    if (t.error) toast({ title: "No se pudieron cargar las tomas", description: t.error, variant: "destructive" })
    setTomas(t.data)
    setAlmacenes(a.data || [])
    setLoading(false)
  }

  async function abrirDetalle(t: TomaFisica) {
    setToma(t)
    setCargandoDetalle(true)
    setConteos({})
    setBusqueda("")
    setPageIndex(0)
    const { data, error } = await getTomaDetalle(t.id)
    if (error) toast({ title: "Error", description: error, variant: "destructive" })
    setDetalle(data)
    setCargandoDetalle(false)
  }

  async function crearToma() {
    if (!nuevaAlmacen) {
      toast({ title: "Elige el almacén", variant: "destructive" })
      return
    }
    setAbriendo(true)
    const { data, error } = await abrirToma(Number(nuevaAlmacen), nuevaNotas)
    setAbriendo(false)
    if (error || !data) {
      toast({ title: "No se pudo abrir la toma", description: error ?? "", variant: "destructive" })
      return
    }
    toast({ title: `Toma #${data.id} abierta`, description: `${data.lineas} línea(s) congeladas. El almacén no admite movimientos hasta cerrarla.` })
    setNuevaOpen(false)
    await cargar()
    const { data: lista } = await getTomas()
    const t = lista.find((x) => x.id === data.id)
    if (t) abrirDetalle(t)
  }

  const filtrado = React.useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    return detalle.filter((d) => {
      if (soloSinContar && d.conteo != null && conteos[d.id] == null) return false
      if (!q) return true
      return d.producto_nombre.toLowerCase().includes(q) || (d.producto_codigo || "").toLowerCase().includes(q) || d.localizacion_nombre.toLowerCase().includes(q)
    })
  }, [detalle, busqueda, soloSinContar, conteos])
  React.useEffect(() => { setPageIndex(0) }, [busqueda, soloSinContar])
  const pagina = filtrado.slice(pageIndex * pageSize, (pageIndex + 1) * pageSize)

  const resumen = React.useMemo(
    () => calcularResumenToma(detalle.map((d) => ({ ...d, conteo: conteos[d.id] != null && conteos[d.id] !== "" ? Number(conteos[d.id]) : d.conteo }))),
    [detalle, conteos]
  )
  const pendientesGuardar = Object.keys(conteos).length

  async function guardarConteos() {
    const items = Object.entries(conteos).map(([id, v]) => ({ detalle_id: Number(id), conteo: v === "" ? null : Number(v), contado_por: contadoPor || null }))
    if (items.length === 0) return
    setGuardando(true)
    const { error } = await registrarConteo(items)
    setGuardando(false)
    if (error) {
      toast({ title: "No se pudo guardar", description: error, variant: "destructive" })
      return
    }
    toast({ title: "Conteos guardados", description: `${items.length} línea(s).` })
    setConteos({})
    if (toma) {
      const { data } = await getTomaDetalle(toma.id)
      setDetalle(data)
    }
  }

  /** Lector de barras: cada lectura suma 1 al conteo del producto (primera localización si hay varias). */
  function escanear() {
    const code = scan.trim().toLowerCase()
    setScan("")
    if (!code) return
    const cands = detalle.filter((d) => (d.producto_codigo || "").toLowerCase() === code)
    if (cands.length === 0) {
      toast({ title: "Código no está en la toma", description: scan, variant: "destructive" })
      return
    }
    const d = cands[0]
    const actual = conteos[d.id] != null && conteos[d.id] !== "" ? Number(conteos[d.id]) : Number(d.conteo ?? 0)
    setConteos((prev) => ({ ...prev, [d.id]: String(actual + 1) }))
    setBusqueda("")
    scanRef.current?.focus()
  }

  function hojaConteo() {
    exportToXlsx(
      detalle.map((d) => ({ Codigo: d.producto_codigo || "", Producto: d.producto_nombre, Localizacion: d.localizacion_nombre, Sistema: d.stock_sistema, Conteo: d.conteo ?? "" })),
      { filename: `hoja_conteo_toma_${toma?.id}`, sheetName: "Conteo" }
    )
  }

  function exportarResultado() {
    exportToXlsx(
      detalle.map((d) => ({ Codigo: d.producto_codigo || "", Producto: d.producto_nombre, Localizacion: d.localizacion_nombre, Sistema: d.stock_sistema, Conteo: d.conteo ?? "", Diferencia: d.conteo != null ? +(d.conteo - d.stock_sistema).toFixed(2) : "", "Costo unit.": d.costo_unitario, "Valor diferencia": d.conteo != null ? +((d.conteo - d.stock_sistema) * d.costo_unitario).toFixed(2) : "", "Contado por": d.contado_por || "" })),
      { filename: `toma_fisica_${toma?.id}`, sheetName: "Resultado" }
    )
  }

  async function importar(file: File) {
    if (!toma) return
    try {
      const filas = await parsearConteosXlsx(file)
      const r = mapearConteosImportados(filas, detalle)
      if (r.actualizaciones.length === 0) {
        toast({ title: "Nada que importar", description: `${r.noReconocidas} no reconocidas · ${r.sinConteo} sin conteo.`, variant: "destructive" })
        return
      }
      setGuardando(true)
      const { error } = await registrarConteo(r.actualizaciones.map((a) => ({ ...a, contado_por: contadoPor || null })))
      setGuardando(false)
      if (error) {
        toast({ title: "No se pudo importar", description: error, variant: "destructive" })
        return
      }
      toast({ title: `${r.actualizaciones.length} conteos importados`, description: r.noReconocidas > 0 ? `${r.noReconocidas} fila(s) no reconocidas (código/localización).` : undefined })
      const { data } = await getTomaDetalle(toma.id)
      setDetalle(data)
      setConteos({})
    } catch (err) {
      toast({ title: "Archivo inválido", description: err instanceof Error ? err.message : "", variant: "destructive" })
    }
  }

  async function confirmarCierre() {
    if (!toma) return
    if (pendientesGuardar > 0) {
      toast({ title: "Guarda los conteos primero", variant: "destructive" })
      return
    }
    setCerrando(true)
    const { data, error } = await cerrarToma(toma.id, { ajustarNoContadas })
    setCerrando(false)
    if (error) toast({ title: data ? "Cierre con avisos" : "No se pudo cerrar", description: error, variant: "destructive" })
    if (data) {
      if (!error) toast({ title: `Toma #${toma.id} cerrada`, description: `${data.ajustadas} ajuste(s) aplicados. Faltante ${formatCurrency(data.resumen.faltanteValor)} · sobrante ${formatCurrency(data.resumen.sobranteValor)}.` })
      setCerrarOpen(false)
      setToma(null)
      cargar()
    }
  }

  async function cancelar() {
    if (!toma) return
    const m = prompt("Motivo de la cancelación (el almacén se descongela sin ajustar):")
    if (!m) return
    const { error } = await cancelarToma(toma.id, m)
    if (error) {
      toast({ title: "No se pudo cancelar", description: error, variant: "destructive" })
      return
    }
    toast({ title: "Toma cancelada" })
    setToma(null)
    cargar()
  }

  const abierta = toma?.estado === "Abierta"

  // ---------- Detalle ----------
  if (toma) {
    return (
      <div className="space-y-4 md:space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => setToma(null)} aria-label="Volver"><ArrowLeft className="h-5 w-5" /></Button>
            <div>
              <h1 className="text-2xl font-semibold text-stone-800 flex items-center gap-2">
                Toma #{toma.id} · {toma.almacen_nombre || almacenes.find((a) => a.id === toma.almacen_id)?.nombre}
                <Badge variant="outline" className={abierta ? "text-amber-700 border-amber-300" : toma.estado === "Cerrada" ? "text-emerald-700 border-emerald-300" : "text-stone-500"}>{abierta && <Lock className="h-3 w-3 mr-1" />}{toma.estado}</Badge>
              </h1>
              <p className="text-sm text-muted-foreground">Congelada {formatHondurasDateTime(toma.fecha_congelacion)}{toma.fecha_cierre ? ` · cerrada ${formatHondurasDateTime(toma.fecha_cierre)}` : ""}{toma.notas ? ` · ${toma.notas}` : ""}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={hojaConteo} className="gap-1"><Download className="h-4 w-4" /> Hoja de conteo</Button>
            <Button variant="outline" size="sm" onClick={exportarResultado} className="gap-1"><Download className="h-4 w-4" /> Resultado</Button>
            {abierta && (
              <>
                <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) importar(f); e.target.value = "" }} />
                <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} className="gap-1" disabled={guardando}><Upload className="h-4 w-4" /> Importar conteos</Button>
                <Button size="sm" onClick={guardarConteos} disabled={guardando || pendientesGuardar === 0} className="gap-1">{guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Guardar ({pendientesGuardar})</Button>
                <Button size="sm" variant="destructive" onClick={() => { setAjustarNoContadas(false); setCerrarOpen(true) }} className="gap-1"><Lock className="h-4 w-4" /> Cerrar toma</Button>
                <Button size="sm" variant="ghost" onClick={cancelar} className="gap-1 text-red-700"><XCircle className="h-4 w-4" /> Cancelar</Button>
              </>
            )}
          </div>
        </div>

        <div className="grid gap-3 grid-cols-2 lg:grid-cols-6">
          <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">Líneas</p><p className="text-lg font-semibold">{resumen.lineas}</p></CardContent></Card>
          <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">Contadas</p><p className="text-lg font-semibold">{resumen.contadas} <span className="text-xs text-muted-foreground">/ {resumen.sinContar} sin contar</span></p></CardContent></Card>
          <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">Con diferencia</p><p className="text-lg font-semibold">{resumen.conDiferencia}</p></CardContent></Card>
          <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">Faltante</p><p className="text-lg font-semibold text-red-700">{formatCurrency(resumen.faltanteValor)}</p><p className="text-xs text-muted-foreground">{formatNumber(resumen.faltanteUnidades)} u</p></CardContent></Card>
          <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">Sobrante</p><p className="text-lg font-semibold text-emerald-700">{formatCurrency(resumen.sobranteValor)}</p><p className="text-xs text-muted-foreground">{formatNumber(resumen.sobranteUnidades)} u</p></CardContent></Card>
          <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">Neto</p><p className={`text-lg font-semibold ${resumen.netoValor < 0 ? "text-red-700" : ""}`}>{formatCurrency(resumen.netoValor)}</p></CardContent></Card>
        </div>

        <Card>
          <CardHeader className="p-4 md:p-6">
            <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
              <div>
                <CardTitle className="text-lg">Conteo ({filtrado.length})</CardTitle>
                <CardDescription>Escribe el conteo por línea (vacío = sin contar) y presiona Guardar. Con lector de barras, cada lectura suma 1.</CardDescription>
              </div>
              <div className="flex flex-wrap items-end gap-2">
                {abierta && (
                  <>
                    <div className="grid gap-1"><Label className="text-xs">Contado por</Label><Input value={contadoPor} onChange={(e) => setContadoPor(e.target.value)} className="h-9 w-36" /></div>
                    <div className="grid gap-1">
                      <Label className="text-xs flex items-center gap-1"><Barcode className="h-3.5 w-3.5" /> Lector</Label>
                      <Input ref={scanRef} value={scan} onChange={(e) => setScan(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); escanear() } }} placeholder="Escanea…" className="h-9 w-40 font-mono" />
                    </div>
                  </>
                )}
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Producto, código o localización…" className="pl-9 h-9 w-64" />
                </div>
                <label className="flex items-center gap-2 text-xs pb-2"><Switch checked={soloSinContar} onCheckedChange={setSoloSinContar} /> Solo sin contar</label>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-4 md:p-6 pt-0">
            {cargandoDetalle ? (
              <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground"><Spinner /> Cargando…</div>
            ) : (
              <>
                <div className="overflow-x-auto border rounded-lg">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-stone-50">
                        <TableHead>Producto</TableHead>
                        <TableHead>Localización</TableHead>
                        <TableHead className="text-right">Sistema</TableHead>
                        <TableHead className="text-right w-32">Conteo</TableHead>
                        <TableHead className="text-right">Diferencia</TableHead>
                        <TableHead className="text-right">Valor</TableHead>
                        <TableHead>Contó</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pagina.map((d) => {
                        const v = conteos[d.id] != null ? conteos[d.id] : d.conteo != null ? String(d.conteo) : ""
                        const conteo = v === "" ? null : Number(v)
                        const dif = conteo == null ? null : +(conteo - d.stock_sistema).toFixed(2)
                        return (
                          <TableRow key={d.id} className={dif != null && dif !== 0 ? (dif < 0 ? "bg-red-50/40" : "bg-emerald-50/40") : ""}>
                            <TableCell>
                              <p className="font-medium text-sm">{d.producto_nombre}</p>
                              <p className="text-xs text-muted-foreground font-mono">{d.producto_codigo || "—"}</p>
                            </TableCell>
                            <TableCell className="text-sm">{d.localizacion_nombre}</TableCell>
                            <TableCell className="text-right">{formatNumber(d.stock_sistema)}</TableCell>
                            <TableCell className="text-right">
                              {abierta ? (
                                <Input type="number" min="0" step="any" value={v} onChange={(e) => setConteos((prev) => ({ ...prev, [d.id]: e.target.value }))} className="h-8 w-28 text-right ml-auto" placeholder="—" />
                              ) : (
                                <span>{d.conteo != null ? formatNumber(d.conteo) : "—"}</span>
                              )}
                            </TableCell>
                            <TableCell className={`text-right font-medium ${dif == null ? "text-muted-foreground" : dif < 0 ? "text-red-700" : dif > 0 ? "text-emerald-700" : ""}`}>{dif == null ? "—" : `${dif > 0 ? "+" : ""}${formatNumber(dif)}`}</TableCell>
                            <TableCell className="text-right text-sm">{dif == null || dif === 0 ? "—" : formatCurrency(dif * d.costo_unitario)}</TableCell>
                            <TableCell className="text-xs text-muted-foreground">{d.contado_por || ""}</TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </div>
                <TablePaginator pageIndex={pageIndex} pageSize={pageSize} totalItems={filtrado.length} onPageIndexChange={setPageIndex} onPageSizeChange={(s) => { setPageSize(s); setPageIndex(0) }} pageSizeOptions={[50, 100, 500, 1000]} className="mt-3" />
              </>
            )}
          </CardContent>
        </Card>

        <Dialog open={cerrarOpen} onOpenChange={setCerrarOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Cerrar toma #{toma.id}</DialogTitle>
              <DialogDescription>
                Se aplican {resumen.conDiferencia} ajuste(s) por diferencia (faltante {formatCurrency(resumen.faltanteValor)}, sobrante {formatCurrency(resumen.sobranteValor)}) con el costo promedio actual y el almacén se descongela. No se puede deshacer.
              </DialogDescription>
            </DialogHeader>
            {resumen.sinContar > 0 && (
              <label className="flex items-start gap-2 text-sm rounded-md border border-amber-200 bg-amber-50 p-3">
                <Switch checked={ajustarNoContadas} onCheckedChange={setAjustarNoContadas} />
                <span>Hay {resumen.sinContar} línea(s) sin contar. Marcar aquí las trata como conteo 0 (se dan de baja); si no, se dejan como estaban.</span>
              </label>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setCerrarOpen(false)}>Volver</Button>
              <Button variant="destructive" onClick={confirmarCierre} disabled={cerrando} className="gap-2">{cerrando && <Loader2 className="h-4 w-4 animate-spin" />} Cerrar y ajustar</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    )
  }

  // ---------- Lista ----------
  return (
    <div className="space-y-4 md:space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-indigo-100 p-2 text-indigo-700"><ClipboardCheck className="h-5 w-5" /></div>
          <div>
            <h1 className="text-2xl font-semibold text-stone-800">Toma Física</h1>
            <p className="text-sm text-muted-foreground">Congela un almacén, cuenta (a mano, con lector o importando Excel) y cierra aplicando los ajustes por diferencia.</p>
          </div>
        </div>
        <Button size="sm" onClick={() => { setNuevaAlmacen(almacenes.length === 1 ? String(almacenes[0].id) : ""); setNuevaNotas(""); setNuevaOpen(true) }} disabled={pendiente} className="gap-1"><Plus className="h-4 w-4" /> Nueva toma</Button>
      </div>
      {pendiente && <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{TOMA_FEATURE_PENDING}</div>}

      <Card>
        <CardHeader className="p-4 md:p-6"><CardTitle className="text-lg">Tomas</CardTitle><CardDescription>Mientras una toma esté Abierta, ese almacén no acepta ventas, recepciones, traslados ni ajustes.</CardDescription></CardHeader>
        <CardContent className="p-4 md:p-6 pt-0">
          {loading ? (
            <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground"><Spinner /> Cargando…</div>
          ) : tomas.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Sin tomas. Abre una para congelar el almacén y empezar a contar.</p>
          ) : (
            <div className="overflow-x-auto border rounded-lg">
              <Table>
                <TableHeader><TableRow className="bg-stone-50"><TableHead>#</TableHead><TableHead>Almacén</TableHead><TableHead>Estado</TableHead><TableHead>Congelada</TableHead><TableHead>Cerrada</TableHead><TableHead className="text-right">Faltante</TableHead><TableHead className="text-right">Sobrante</TableHead><TableHead className="text-right">Ajustes</TableHead><TableHead className="w-24" /></TableRow></TableHeader>
                <TableBody>
                  {tomas.map((t) => (
                    <TableRow key={t.id} className="cursor-pointer hover:bg-muted/40" onClick={() => abrirDetalle(t)}>
                      <TableCell className="font-mono text-sm">{t.id}</TableCell>
                      <TableCell>{t.almacen_nombre || almacenes.find((a) => a.id === t.almacen_id)?.nombre || `#${t.almacen_id}`}</TableCell>
                      <TableCell><Badge variant="outline" className={t.estado === "Abierta" ? "text-amber-700 border-amber-300" : t.estado === "Cerrada" ? "text-emerald-700 border-emerald-300" : "text-stone-500"}>{t.estado === "Abierta" && <Lock className="h-3 w-3 mr-1" />}{t.estado}</Badge></TableCell>
                      <TableCell className="text-sm whitespace-nowrap">{formatHondurasDateTime(t.fecha_congelacion)}</TableCell>
                      <TableCell className="text-sm whitespace-nowrap">{t.fecha_cierre ? formatHondurasDateTime(t.fecha_cierre) : "—"}</TableCell>
                      <TableCell className="text-right text-red-700">{t.total_faltante != null ? formatCurrency(t.total_faltante) : "—"}</TableCell>
                      <TableCell className="text-right text-emerald-700">{t.total_sobrante != null ? formatCurrency(t.total_sobrante) : "—"}</TableCell>
                      <TableCell className="text-right">{t.lineas_ajustadas ?? "—"}</TableCell>
                      <TableCell><Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); abrirDetalle(t) }}>{t.estado === "Abierta" ? "Contar" : "Ver"}</Button></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={nuevaOpen} onOpenChange={setNuevaOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Nueva toma física</DialogTitle>
            <DialogDescription>Se fotografía el stock por localización del almacén y se congela: nadie podrá vender, recibir, trasladar ni ajustar en él hasta cerrar la toma.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label>Almacén</Label>
              <Select value={nuevaAlmacen} onValueChange={setNuevaAlmacen}>
                <SelectTrigger><SelectValue placeholder="Elige el almacén" /></SelectTrigger>
                <SelectContent>{almacenes.map((a) => <SelectItem key={a.id} value={String(a.id)}>{a.nombre}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5"><Label>Notas</Label><Textarea rows={2} value={nuevaNotas} onChange={(e) => setNuevaNotas(e.target.value)} placeholder="Inventario de cierre de mes…" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNuevaOpen(false)}>Cancelar</Button>
            <Button onClick={crearToma} disabled={abriendo} className="gap-2">{abriendo && <Loader2 className="h-4 w-4 animate-spin" />} <Lock className="h-4 w-4" /> Congelar y abrir</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
