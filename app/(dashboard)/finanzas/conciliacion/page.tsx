"use client"

import * as React from "react"
import { Landmark, Upload, Loader2, Wand2, Link2, Unlink, EyeOff, PlusCircle, Lock, Unlock, Trash2, ArrowLeft, CheckCircle2, AlertTriangle, Download } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Spinner } from "@/components/ui/spinner"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { useToast } from "@/hooks/use-toast"
import { useTenant } from "@/lib/hooks/use-tenant"
import { useAuth } from "@/lib/contexts/auth-context"
import { formatCurrency } from "@/lib/utils/format"
import { formatHondurasDate } from "@/lib/utils/honduras-time"
import { exportToXlsx } from "@/lib/utils/export"
import { getCuentas, type CuentaConfig } from "@/lib/services/cuentas"
import { getConceptosGasto, type ConceptoGasto } from "@/lib/services/gastos"
import {
  parsearExtractoXlsx, detectarColumnas, normalizarLineas, detectarDuplicadas, getFormatoCuenta, saveFormatoCuenta, crearExtracto,
  getExtractos, getExtracto, getMovimientosLibro, parearAutomatico, parearManual, desparear, ignorarLinea, crearMovimientoDesdeLinea,
  cerrarConciliacion, reabrirConciliacion, eliminarExtracto, resumenConciliacion, calcularSaldoLibro, CONCILIACION_FEATURE_PENDING,
  type ArchivoExtracto, type MapeoExtracto, type CampoExtracto, type LineaNormalizada, type Extracto, type LineaExtracto, type MovimientoLibro,
} from "@/lib/services/conciliacion-bancaria"

const CAMPOS: { campo: CampoExtracto; label: string; ayuda: string }[] = [
  { campo: "fecha", label: "Fecha", ayuda: "obligatoria" },
  { campo: "descripcion", label: "Descripción", ayuda: "" },
  { campo: "referencia", label: "Referencia / documento", ayuda: "mejora el pareo" },
  { campo: "debito", label: "Débito (sale)", ayuda: "o usa Monto" },
  { campo: "credito", label: "Crédito (entra)", ayuda: "o usa Monto" },
  { campo: "monto", label: "Monto (una columna con signo)", ayuda: "si no hay débito/crédito" },
  { campo: "saldo", label: "Saldo del banco", ayuda: "opcional" },
]
const NONE = "__none__"

export default function ConciliacionPage() {
  const { toast } = useToast()
  const { ready, razonSocialId } = useTenant()
  const { user } = useAuth()
  const esAdmin = (user?.rol || "").trim().toLowerCase() === "admin"

  const [cuentas, setCuentas] = React.useState<CuentaConfig[]>([])
  const [conceptos, setConceptos] = React.useState<ConceptoGasto[]>([])
  const [extractos, setExtractos] = React.useState<Extracto[]>([])
  const [pendiente, setPendiente] = React.useState(false)
  const [loading, setLoading] = React.useState(true)

  // Importar
  const [cuentaId, setCuentaId] = React.useState("")
  const [archivo, setArchivo] = React.useState<ArchivoExtracto | null>(null)
  const [archivoNombre, setArchivoNombre] = React.useState("")
  const [file, setFile] = React.useState<File | null>(null)
  const [hoja, setHoja] = React.useState("")
  const [filaEnc, setFilaEnc] = React.useState("1")
  const [mapeo, setMapeo] = React.useState<MapeoExtracto>({})
  const [formatoFecha, setFormatoFecha] = React.useState<string>("auto")
  const [invertir, setInvertir] = React.useState(false)
  const [guardarFormato, setGuardarFormato] = React.useState(true)
  const [saldoIni, setSaldoIni] = React.useState("")
  const [saldoFin, setSaldoFin] = React.useState("")
  const [creando, setCreando] = React.useState(false)
  const fileRef = React.useRef<HTMLInputElement>(null)

  // Tablero
  const [ext, setExt] = React.useState<Extracto | null>(null)
  const [lineas, setLineas] = React.useState<LineaExtracto[]>([])
  const [movs, setMovs] = React.useState<MovimientoLibro[]>([])
  const [cargandoExt, setCargandoExt] = React.useState(false)
  const [ocupado, setOcupado] = React.useState(false)
  const [filtroLineas, setFiltroLineas] = React.useState<"todas" | "Pendiente" | "Conciliada" | "Ignorada">("Pendiente")
  const [parear, setParear] = React.useState<LineaExtracto | null>(null)
  const [movSel, setMovSel] = React.useState("")
  const [crear, setCrear] = React.useState<LineaExtracto | null>(null)
  const [crearModo, setCrearModo] = React.useState<"movimiento" | "gasto">("movimiento")
  const [crearConcepto, setCrearConcepto] = React.useState("")
  const [crearConceptoGasto, setCrearConceptoGasto] = React.useState("")

  React.useEffect(() => {
    if (!ready || razonSocialId == null) return
    cargar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, razonSocialId])

  async function cargar() {
    setLoading(true)
    const [c, e, g] = await Promise.all([getCuentas(), getExtractos(), getConceptosGasto()])
    setCuentas((c.data || []).filter((x) => x.activo ?? true))
    setExtractos(e.data)
    setPendiente(e.pendiente)
    setConceptos(g.data || [])
    setLoading(false)
  }

  // ---------- Importar ----------
  async function elegirArchivo(f: File) {
    setFile(f)
    setArchivoNombre(f.name)
    const fmt = cuentaId ? (await getFormatoCuenta(Number(cuentaId))).data : null
    const a = await parsearExtractoXlsx(f, { hoja: fmt?.hoja ?? null, filaEncabezado: fmt?.fila_encabezado ?? 1 })
    setArchivo(a)
    setHoja(a.hoja)
    setFilaEnc(String(fmt?.fila_encabezado ?? 1))
    const auto = detectarColumnas(a.headers)
    const m: MapeoExtracto = { ...auto }
    if (fmt?.mapeo) for (const [k, v] of Object.entries(fmt.mapeo)) if (v && a.headers.includes(v)) (m as Record<string, string>)[k] = v
    setMapeo(m)
    setFormatoFecha(fmt?.formato_fecha || "auto")
    setInvertir(fmt?.invertir_signo ?? false)
  }

  async function releer(nuevaHoja: string, nuevaFila: string) {
    if (!file) return
    const a = await parsearExtractoXlsx(file, { hoja: nuevaHoja, filaEncabezado: Number(nuevaFila) || 1 })
    setArchivo(a)
    setHoja(a.hoja)
    setMapeo(detectarColumnas(a.headers))
  }

  const preview = React.useMemo(() => {
    if (!archivo) return { lineas: [] as LineaNormalizada[], omitidas: 0, duplicadas: [] as number[] }
    const r = normalizarLineas(archivo.rows, mapeo, { invertirSigno: invertir, formatoFecha: formatoFecha === "auto" ? null : formatoFecha })
    return { ...r, duplicadas: detectarDuplicadas(r.lineas) }
  }, [archivo, mapeo, invertir, formatoFecha])
  const periodo = React.useMemo(() => {
    const f = preview.lineas.map((l) => l.fecha).sort()
    return { desde: f[0] || "", hasta: f[f.length - 1] || "" }
  }, [preview])

  async function importar() {
    if (!cuentaId) { toast({ title: "Elige la cuenta", variant: "destructive" }); return }
    if (preview.lineas.length === 0) { toast({ title: "Sin líneas válidas", description: "Revisa el mapeo de Fecha y Monto/Débito/Crédito.", variant: "destructive" }); return }
    setCreando(true)
    if (guardarFormato) await saveFormatoCuenta({ cuenta_id: Number(cuentaId), hoja, fila_encabezado: Number(filaEnc) || 1, mapeo, formato_fecha: formatoFecha === "auto" ? null : formatoFecha, invertir_signo: invertir })
    const { data, error } = await crearExtracto({
      cuenta_id: Number(cuentaId), periodo_desde: periodo.desde, periodo_hasta: periodo.hasta, archivo_nombre: archivoNombre,
      saldo_inicial_banco: saldoIni.trim() ? Number(saldoIni) : null, saldo_final_banco: saldoFin.trim() ? Number(saldoFin) : null, lineas: preview.lineas,
    })
    setCreando(false)
    if (error || !data) { toast({ title: "No se pudo importar", description: error ?? "", variant: "destructive" }); return }
    toast({ title: `Extracto #${data.id} importado`, description: `${data.lineas} líneas. Ahora parea automáticamente.` })
    setArchivo(null); setFile(null); setArchivoNombre(""); setSaldoIni(""); setSaldoFin("")
    await cargar()
    abrirExtracto(data.id)
  }

  // ---------- Tablero ----------
  async function abrirExtracto(id: number) {
    setCargandoExt(true)
    const { data, error } = await getExtracto(id)
    if (error || !data) { setCargandoExt(false); toast({ title: "Error", description: error ?? "", variant: "destructive" }); return }
    setExt(data.extracto)
    setLineas(data.lineas)
    const m = await getMovimientosLibro(data.extracto.cuenta_id, data.extracto.periodo_desde, data.extracto.periodo_hasta)
    setMovs(m.data)
    setFiltroLineas(data.extracto.estado === "Abierto" ? "Pendiente" : "todas")
    setCargandoExt(false)
  }
  async function refrescar() { if (ext) await abrirExtracto(ext.id) }

  async function accion(fn: () => Promise<{ error: string | null } | { data: unknown; error: string | null }>, ok: string) {
    setOcupado(true)
    const r = await fn()
    setOcupado(false)
    if (r.error) { toast({ title: "No se pudo", description: r.error, variant: "destructive" }); return false }
    toast({ title: ok })
    refrescar()
    return true
  }

  const abierto = ext?.estado === "Abierto"
  const lineasVista = lineas.filter((l) => filtroLineas === "todas" || l.estado === filtroLineas)
  const movsPendientes = movs.filter((m) => !m.conciliado_at)
  const movById = React.useMemo(() => new Map(movs.map((m) => [m.id, m])), [movs])
  const resumen = React.useMemo(() => (ext ? resumenConciliacion(lineas, movs.filter((m) => m.fecha.slice(0, 10) >= ext.periodo_desde && m.fecha.slice(0, 10) <= ext.periodo_hasta), ext.saldo_final_banco, calcularSaldoLibro(movs)) : null), [ext, lineas, movs])

  function candidatos(l: LineaExtracto) {
    return movsPendientes
      .filter((m) => (l.monto > 0 ? m.tipo === "Ingreso" : m.tipo === "Egreso"))
      .sort((a, b) => Math.abs(Math.abs(a.monto) - Math.abs(l.monto)) - Math.abs(Math.abs(b.monto) - Math.abs(l.monto)))
      .slice(0, 40)
  }

  function exportarLineas() {
    if (!ext) return
    exportToXlsx(
      lineas.map((l) => ({ Fila: l.fila, Fecha: l.fecha, Descripcion: l.descripcion, Referencia: l.referencia || "", Monto: l.monto, "Saldo banco": l.saldo_banco ?? "", Estado: l.estado, Pareo: l.metodo_pareo || "", Movimiento: l.movimiento_id ?? "", Nota: l.nota || "" })),
      { filename: `conciliacion_${ext.id}_${ext.periodo_hasta}`, sheetName: "Extracto" }
    )
  }

  // ================= Vista extracto =================
  if (ext) {
    return (
      <div className="space-y-4 md:space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => setExt(null)} aria-label="Volver"><ArrowLeft className="h-5 w-5" /></Button>
            <div>
              <h1 className="text-2xl font-semibold text-stone-800 flex items-center gap-2">
                Extracto #{ext.id} · {ext.cuenta_nombre || cuentas.find((c) => c.id === ext.cuenta_id)?.nombre}
                <Badge variant="outline" className={abierto ? "text-amber-700 border-amber-300" : "text-emerald-700 border-emerald-300"}>{abierto ? <Unlock className="h-3 w-3 mr-1" /> : <Lock className="h-3 w-3 mr-1" />}{ext.estado}</Badge>
              </h1>
              <p className="text-sm text-muted-foreground">{formatHondurasDate(ext.periodo_desde)} → {formatHondurasDate(ext.periodo_hasta)}{ext.archivo_nombre ? ` · ${ext.archivo_nombre}` : ""}{ext.conciliado_at ? ` · conciliado ${formatHondurasDate(ext.conciliado_at)} por ${ext.conciliado_por || ""}` : ""}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={exportarLineas} className="gap-1"><Download className="h-4 w-4" /> Excel</Button>
            {abierto ? (
              <>
                <Button size="sm" variant="outline" disabled={ocupado} onClick={() => accion(async () => { const r = await parearAutomatico(ext.id); return { data: r.data, error: r.error ?? (r.data ? null : "") } }, "Pareo automático aplicado")} className="gap-1"><Wand2 className="h-4 w-4" /> Parear automático</Button>
                <Button size="sm" disabled={ocupado || (resumen?.pendientes ?? 1) > 0} onClick={() => { if (confirm("¿Cerrar la conciliación? La cuenta quedará conciliada hasta el fin del período y no aceptará movimientos con fecha anterior.")) accion(() => cerrarConciliacion(ext.id), "Conciliación cerrada") }} className="gap-1"><Lock className="h-4 w-4" /> Cerrar conciliación</Button>
                <Button size="sm" variant="ghost" className="text-red-700" disabled={ocupado} onClick={() => { if (confirm("¿Eliminar este extracto? Se liberan los movimientos pareados.")) accion(async () => { const r = await eliminarExtracto(ext.id); if (!r.error) setExt(null); return r }, "Extracto eliminado") }}><Trash2 className="h-4 w-4" /></Button>
              </>
            ) : esAdmin ? (
              <Button size="sm" variant="outline" disabled={ocupado} onClick={() => { const m = prompt("Motivo para reabrir:"); if (m) accion(() => reabrirConciliacion(ext.id, m), "Conciliación reabierta") }} className="gap-1"><Unlock className="h-4 w-4" /> Reabrir (admin)</Button>
            ) : null}
          </div>
        </div>

        {resumen && (
          <div className="grid gap-3 grid-cols-2 lg:grid-cols-6">
            <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">Líneas del banco</p><p className="text-lg font-semibold">{resumen.lineas}</p><p className="text-xs text-muted-foreground">{resumen.conciliadas} conciliadas · {resumen.ignoradas} ignoradas</p></CardContent></Card>
            <Card className={resumen.pendientes > 0 ? "border-amber-200 bg-amber-50/40" : ""}><CardContent className="p-3"><p className="text-xs text-muted-foreground">Pendientes</p><p className="text-lg font-semibold">{resumen.pendientes}</p></CardContent></Card>
            <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">Banco: entradas / salidas</p><p className="text-sm font-semibold text-emerald-700">{formatCurrency(resumen.montoBancoEntradas)}</p><p className="text-sm font-semibold text-red-700">{formatCurrency(resumen.montoBancoSalidas)}</p></CardContent></Card>
            <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">En tránsito (libro sin parear)</p><p className="text-lg font-semibold">{resumen.enTransito}</p><p className="text-xs text-muted-foreground">{formatCurrency(resumen.enTransitoMonto)}</p></CardContent></Card>
            <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">Saldo libro al cierre</p><p className="text-lg font-semibold">{formatCurrency(resumen.saldoLibro)}</p></CardContent></Card>
            <Card className={resumen.diferencia != null && Math.abs(resumen.diferencia) > 0.005 ? "border-red-200 bg-red-50/40" : ""}><CardContent className="p-3"><p className="text-xs text-muted-foreground">Saldo banco / diferencia</p><p className="text-lg font-semibold">{resumen.saldoBanco != null ? formatCurrency(resumen.saldoBanco) : "—"}</p><p className={`text-xs ${resumen.diferencia != null && Math.abs(resumen.diferencia) > 0.005 ? "text-red-700 font-medium" : "text-muted-foreground"}`}>{resumen.diferencia != null ? `dif. ${formatCurrency(resumen.diferencia)}` : "sin saldo del banco"}</p></CardContent></Card>
          </div>
        )}

        {cargandoExt ? (
          <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground"><Spinner /> Cargando…</div>
        ) : (
          <div className="grid gap-4 xl:grid-cols-[3fr_2fr]">
            {/* Banco */}
            <Card>
              <CardHeader className="p-4">
                <div className="flex items-center justify-between gap-2">
                  <div><CardTitle className="text-base">Líneas del banco ({lineasVista.length})</CardTitle><CardDescription>+ entra · − sale</CardDescription></div>
                  <Select value={filtroLineas} onValueChange={(v) => setFiltroLineas(v as typeof filtroLineas)}>
                    <SelectTrigger className="h-8 w-36"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="Pendiente">Pendientes</SelectItem><SelectItem value="Conciliada">Conciliadas</SelectItem><SelectItem value="Ignorada">Ignoradas</SelectItem><SelectItem value="todas">Todas</SelectItem></SelectContent>
                  </Select>
                </div>
              </CardHeader>
              <CardContent className="p-4 pt-0">
                <div className="overflow-x-auto border rounded-lg">
                  <Table>
                    <TableHeader><TableRow className="bg-stone-50"><TableHead>Fecha</TableHead><TableHead>Descripción</TableHead><TableHead className="text-right">Monto</TableHead><TableHead>Estado</TableHead><TableHead className="w-40" /></TableRow></TableHeader>
                    <TableBody>
                      {lineasVista.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-sm text-muted-foreground py-8">Sin líneas en este filtro.</TableCell></TableRow>}
                      {lineasVista.map((l) => {
                        const m = l.movimiento_id != null ? movById.get(l.movimiento_id) : null
                        return (
                          <TableRow key={l.id}>
                            <TableCell className="whitespace-nowrap text-sm">{l.fecha}</TableCell>
                            <TableCell>
                              <p className="text-sm">{l.descripcion || "—"}</p>
                              <p className="text-xs text-muted-foreground">{l.referencia ? `ref. ${l.referencia}` : ""}{m ? ` · libro: ${m.concepto || m.ref_tipo || `#${m.id}`}` : ""}{l.nota ? ` · ${l.nota}` : ""}</p>
                            </TableCell>
                            <TableCell className={`text-right font-mono ${l.monto < 0 ? "text-red-700" : "text-emerald-700"}`}>{formatCurrency(l.monto)}</TableCell>
                            <TableCell><Badge variant="outline" className={l.estado === "Conciliada" ? "text-emerald-700 border-emerald-300" : l.estado === "Ignorada" ? "text-stone-500" : "text-amber-700 border-amber-300"}>{l.estado}{l.metodo_pareo ? ` · ${l.metodo_pareo}` : ""}</Badge></TableCell>
                            <TableCell>
                              {abierto && (
                                <div className="flex items-center gap-1 justify-end">
                                  {l.estado === "Pendiente" ? (
                                    <>
                                      <Button size="icon" variant="ghost" className="h-7 w-7" title="Parear con un movimiento" onClick={() => { setParear(l); setMovSel("") }}><Link2 className="h-4 w-4" /></Button>
                                      <Button size="icon" variant="ghost" className="h-7 w-7" title="Crear movimiento / gasto" onClick={() => { setCrear(l); setCrearModo(l.monto < 0 ? "gasto" : "movimiento"); setCrearConcepto(l.descripcion); setCrearConceptoGasto("") }}><PlusCircle className="h-4 w-4" /></Button>
                                      <Button size="icon" variant="ghost" className="h-7 w-7" title="Ignorar" onClick={() => { const n = prompt("Nota (por qué se ignora):") ?? ""; accion(() => ignorarLinea(l.id, n), "Línea ignorada") }}><EyeOff className="h-4 w-4" /></Button>
                                    </>
                                  ) : (
                                    <Button size="icon" variant="ghost" className="h-7 w-7" title="Volver a pendiente" onClick={() => accion(() => desparear(l.id), "Línea liberada")}><Unlink className="h-4 w-4" /></Button>
                                  )}
                                </div>
                              )}
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>

            {/* Libro */}
            <Card>
              <CardHeader className="p-4"><CardTitle className="text-base">Libro sin conciliar ({movsPendientes.length})</CardTitle><CardDescription>Movimientos de la cuenta en el período (± 2 días) que aún no aparecen en el banco (en tránsito).</CardDescription></CardHeader>
              <CardContent className="p-4 pt-0">
                <div className="overflow-x-auto border rounded-lg">
                  <Table>
                    <TableHeader><TableRow className="bg-stone-50"><TableHead>Fecha</TableHead><TableHead>Concepto</TableHead><TableHead className="text-right">Monto</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {movsPendientes.length === 0 && <TableRow><TableCell colSpan={3} className="text-center text-sm text-muted-foreground py-8">Todo el libro del período está conciliado.</TableCell></TableRow>}
                      {movsPendientes.map((m) => (
                        <TableRow key={m.id}>
                          <TableCell className="whitespace-nowrap text-sm">{m.fecha.slice(0, 10)}</TableCell>
                          <TableCell className="text-sm"><p>{m.concepto || m.ref_tipo || `#${m.id}`}</p><p className="text-xs text-muted-foreground">{[m.ref_tipo, m.referencia ? `ref. ${m.referencia}` : null].filter(Boolean).join(" · ")}</p></TableCell>
                          <TableCell className={`text-right font-mono ${m.tipo === "Egreso" ? "text-red-700" : "text-emerald-700"}`}>{m.tipo === "Egreso" ? "−" : "+"}{formatCurrency(m.monto)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Parear manual */}
        <Dialog open={parear !== null} onOpenChange={(o) => { if (!o) setParear(null) }}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader><DialogTitle>Parear línea del banco</DialogTitle><DialogDescription>{parear ? `${parear.fecha} · ${parear.descripcion} · ${formatCurrency(parear.monto)}` : ""}</DialogDescription></DialogHeader>
            <div className="grid gap-1.5">
              <Label>Movimiento del libro</Label>
              <Select value={movSel} onValueChange={setMovSel}>
                <SelectTrigger><SelectValue placeholder="Elige el movimiento" /></SelectTrigger>
                <SelectContent>
                  {parear && candidatos(parear).map((m) => (
                    <SelectItem key={m.id} value={String(m.id)}>{m.fecha.slice(0, 10)} · {m.tipo === "Egreso" ? "−" : "+"}{formatCurrency(m.monto)} · {(m.concepto || m.ref_tipo || "").slice(0, 40)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Se muestran los del mismo sentido, ordenados por cercanía de monto. Si el monto no coincide exactamente, considera crear un movimiento por la diferencia.</p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setParear(null)}>Cancelar</Button>
              <Button disabled={!movSel || ocupado} onClick={async () => { if (parear && (await accion(() => parearManual(parear.id, Number(movSel)), "Línea pareada"))) setParear(null) }}>Parear</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Crear movimiento / gasto */}
        <Dialog open={crear !== null} onOpenChange={(o) => { if (!o) setCrear(null) }}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader><DialogTitle>Registrar en el libro</DialogTitle><DialogDescription>{crear ? `${crear.fecha} · ${formatCurrency(crear.monto)} · ${crear.descripcion}` : ""}. Se crea con la fecha de la línea y queda pareado.</DialogDescription></DialogHeader>
            <div className="grid gap-3">
              {crear && crear.monto < 0 && (
                <div className="grid gap-1.5">
                  <Label>Cómo registrarlo</Label>
                  <Select value={crearModo} onValueChange={(v) => setCrearModo(v as "movimiento" | "gasto")}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="gasto">Gasto pagado desde la cuenta (comisión, cargo, servicio)</SelectItem><SelectItem value="movimiento">Solo movimiento bancario (egreso)</SelectItem></SelectContent>
                  </Select>
                </div>
              )}
              {crearModo === "gasto" && crear && crear.monto < 0 && (
                <div className="grid gap-1.5">
                  <Label>Concepto de gasto</Label>
                  <Select value={crearConceptoGasto} onValueChange={setCrearConceptoGasto}>
                    <SelectTrigger><SelectValue placeholder="Elige el concepto" /></SelectTrigger>
                    <SelectContent>{conceptos.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.nombre}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              )}
              <div className="grid gap-1.5"><Label>Descripción</Label><Input value={crearConcepto} onChange={(e) => setCrearConcepto(e.target.value)} /></div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCrear(null)}>Cancelar</Button>
              <Button disabled={ocupado} onClick={async () => { if (crear && (await accion(() => crearMovimientoDesdeLinea(crear.id, { modo: crear.monto < 0 ? crearModo : "movimiento", concepto: crearConcepto, concepto_gasto_id: crearConceptoGasto ? Number(crearConceptoGasto) : null }), "Registrado y pareado"))) setCrear(null) }}>Registrar</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    )
  }

  // ================= Lista + importar =================
  return (
    <div className="space-y-4 md:space-y-6">
      <div className="flex items-center gap-3">
        <div className="rounded-lg bg-sky-100 p-2 text-sky-700"><Landmark className="h-5 w-5" /></div>
        <div>
          <h1 className="text-2xl font-semibold text-stone-800">Conciliación Bancaria</h1>
          <p className="text-sm text-muted-foreground">Importa el extracto del banco, parea con tus movimientos, registra lo que falta y cierra el período.</p>
        </div>
      </div>
      {pendiente && <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{CONCILIACION_FEATURE_PENDING}</div>}

      <Tabs defaultValue="importar">
        <TabsList><TabsTrigger value="importar">Importar extracto</TabsTrigger><TabsTrigger value="historial">Extractos ({extractos.length})</TabsTrigger></TabsList>

        <TabsContent value="importar" className="space-y-4">
          <Card>
            <CardHeader className="p-4 md:p-6"><CardTitle className="text-base">1. Cuenta y archivo</CardTitle><CardDescription>Excel (.xlsx) del banco. El mapeo de columnas se guarda por cuenta para la próxima vez.</CardDescription></CardHeader>
            <CardContent className="p-4 md:p-6 pt-0 grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
              <div className="grid gap-1.5">
                <Label>Cuenta bancaria</Label>
                <Select value={cuentaId} onValueChange={setCuentaId}>
                  <SelectTrigger><SelectValue placeholder="Elige la cuenta" /></SelectTrigger>
                  <SelectContent>{cuentas.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.nombre}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) elegirArchivo(f); e.target.value = "" }} />
                <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={!cuentaId || pendiente} className="gap-1"><Upload className="h-4 w-4" /> {archivoNombre || "Elegir archivo"}</Button>
              </div>
            </CardContent>
          </Card>

          {archivo && (
            <>
              <Card>
                <CardHeader className="p-4 md:p-6"><CardTitle className="text-base">2. Columnas</CardTitle><CardDescription>Se detectaron automáticamente; corrige si hace falta. {archivo.rows.length} filas leídas.</CardDescription></CardHeader>
                <CardContent className="p-4 md:p-6 pt-0 space-y-3">
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="grid gap-1.5">
                      <Label>Hoja</Label>
                      <Select value={hoja} onValueChange={(v) => { setHoja(v); releer(v, filaEnc) }}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>{archivo.hojas.map((h) => <SelectItem key={h} value={h}>{h}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div className="grid gap-1.5"><Label>Fila del encabezado</Label><Input type="number" min="1" value={filaEnc} onChange={(e) => setFilaEnc(e.target.value)} onBlur={() => releer(hoja, filaEnc)} /></div>
                    <div className="grid gap-1.5">
                      <Label>Formato de fecha</Label>
                      <Select value={formatoFecha} onValueChange={setFormatoFecha}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent><SelectItem value="auto">Automático (DD/MM/AAAA)</SelectItem><SelectItem value="MM/DD/YYYY">MM/DD/AAAA</SelectItem><SelectItem value="DD/MM/YYYY">DD/MM/AAAA</SelectItem></SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    {CAMPOS.map(({ campo, label, ayuda }) => (
                      <div key={campo} className="grid gap-1.5">
                        <Label className="text-xs">{label} {ayuda && <span className="text-muted-foreground font-normal">({ayuda})</span>}</Label>
                        <Select value={mapeo[campo] || NONE} onValueChange={(v) => setMapeo((m) => ({ ...m, [campo]: v === NONE ? undefined : v }))}>
                          <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                          <SelectContent><SelectItem value={NONE}>—</SelectItem>{archivo.headers.map((h) => <SelectItem key={h} value={h}>{h}</SelectItem>)}</SelectContent>
                        </Select>
                      </div>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-4 text-sm">
                    <label className="flex items-center gap-2"><Switch checked={invertir} onCheckedChange={setInvertir} /> Invertir signo (el banco muestra las salidas en positivo)</label>
                    <label className="flex items-center gap-2"><Switch checked={guardarFormato} onCheckedChange={setGuardarFormato} /> Guardar este formato para la cuenta</label>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="p-4 md:p-6">
                  <CardTitle className="text-base">3. Vista previa e importar</CardTitle>
                  <CardDescription>
                    {preview.lineas.length} líneas válidas · {preview.omitidas} omitidas (sin fecha o monto) · período {periodo.desde || "—"} → {periodo.hasta || "—"}
                    {preview.duplicadas.length > 0 && <span className="text-amber-700"> · {preview.duplicadas.length} repetidas exactas (se importan igual)</span>}
                  </CardDescription>
                </CardHeader>
                <CardContent className="p-4 md:p-6 pt-0 space-y-3">
                  <div className="overflow-x-auto border rounded-lg">
                    <Table>
                      <TableHeader><TableRow className="bg-stone-50"><TableHead>Fecha</TableHead><TableHead>Descripción</TableHead><TableHead>Referencia</TableHead><TableHead className="text-right">Monto</TableHead><TableHead className="text-right">Saldo</TableHead></TableRow></TableHeader>
                      <TableBody>
                        {preview.lineas.slice(0, 12).map((l) => (
                          <TableRow key={l.fila}><TableCell>{l.fecha}</TableCell><TableCell className="text-sm">{l.descripcion}</TableCell><TableCell className="text-sm">{l.referencia || ""}</TableCell><TableCell className={`text-right font-mono ${l.monto < 0 ? "text-red-700" : "text-emerald-700"}`}>{formatCurrency(l.monto)}</TableCell><TableCell className="text-right">{l.saldo_banco != null ? formatCurrency(l.saldo_banco) : ""}</TableCell></TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-3 sm:items-end">
                    <div className="grid gap-1.5"><Label>Saldo inicial del banco (opcional)</Label><Input type="number" step="any" value={saldoIni} onChange={(e) => setSaldoIni(e.target.value)} /></div>
                    <div className="grid gap-1.5"><Label>Saldo final del banco (para cuadrar)</Label><Input type="number" step="any" value={saldoFin} onChange={(e) => setSaldoFin(e.target.value)} /></div>
                    <Button onClick={importar} disabled={creando || preview.lineas.length === 0} className="gap-2">{creando ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Importar extracto</Button>
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>

        <TabsContent value="historial">
          <Card>
            <CardHeader className="p-4 md:p-6"><CardTitle className="text-base">Extractos</CardTitle><CardDescription>Abre un extracto para parear y cerrar. Solo puede haber uno abierto por cuenta.</CardDescription></CardHeader>
            <CardContent className="p-4 md:p-6 pt-0">
              {loading ? (
                <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground"><Spinner /> Cargando…</div>
              ) : extractos.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">Sin extractos importados.</p>
              ) : (
                <div className="overflow-x-auto border rounded-lg">
                  <Table>
                    <TableHeader><TableRow className="bg-stone-50"><TableHead>#</TableHead><TableHead>Cuenta</TableHead><TableHead>Período</TableHead><TableHead>Estado</TableHead><TableHead className="text-right">Líneas</TableHead><TableHead className="text-right">Diferencia</TableHead><TableHead className="w-24" /></TableRow></TableHeader>
                    <TableBody>
                      {extractos.map((e) => (
                        <TableRow key={e.id} className="cursor-pointer hover:bg-muted/40" onClick={() => abrirExtracto(e.id)}>
                          <TableCell className="font-mono text-sm">{e.id}</TableCell>
                          <TableCell>{e.cuenta_nombre || cuentas.find((c) => c.id === e.cuenta_id)?.nombre || `#${e.cuenta_id}`}</TableCell>
                          <TableCell className="whitespace-nowrap text-sm">{e.periodo_desde} → {e.periodo_hasta}</TableCell>
                          <TableCell><Badge variant="outline" className={e.estado === "Abierto" ? "text-amber-700 border-amber-300" : "text-emerald-700 border-emerald-300"}>{e.estado}</Badge></TableCell>
                          <TableCell className="text-right">{e.resumen ? `${e.resumen.conciliadas}/${e.resumen.lineas}` : "—"}</TableCell>
                          <TableCell className={`text-right ${e.resumen?.diferencia != null && Math.abs(e.resumen.diferencia) > 0.005 ? "text-red-700 font-medium" : ""}`}>{e.resumen?.diferencia != null ? formatCurrency(e.resumen.diferencia) : "—"}{e.resumen?.diferencia != null && Math.abs(e.resumen.diferencia) > 0.005 && <AlertTriangle className="inline h-3.5 w-3.5 ml-1" />}</TableCell>
                          <TableCell><Button size="sm" variant="outline" onClick={(ev) => { ev.stopPropagation(); abrirExtracto(e.id) }}>{e.estado === "Abierto" ? "Conciliar" : "Ver"}</Button></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
