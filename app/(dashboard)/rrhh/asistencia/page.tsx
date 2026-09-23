"use client"

import * as React from "react"
import { Clock, LogIn, LogOut, Plus, Upload, Download, Pencil, Trash2, Loader2, AlertTriangle, Fingerprint } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
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
import { formatHondurasDate, formatHondurasDateTime, getHondurasTodayISODate } from "@/lib/utils/honduras-time"
import { exportToXlsx } from "@/lib/utils/export"
import {
  getEmpleados, getEmpleadoDeUsuario, getMarcaciones, marcar, saveMarcacion, eliminarMarcacion, parsearMarcacionesXlsx, resolverEmpleado, importarMarcaciones,
  type Empleado, type Marcacion, type FilaMarcacionImportada,
} from "@/lib/services/rrhh"

const hora = (iso: string | null) => (iso ? iso.slice(11, 16) : "")

export default function AsistenciaPage() {
  const { toast } = useToast()
  const { user } = useAuth()
  const { ready, razonSocialId } = useTenant()
  const hoy = getHondurasTodayISODate()

  const [loading, setLoading] = React.useState(true)
  const [pendiente, setPendiente] = React.useState<string | null>(null)
  const [empleados, setEmpleados] = React.useState<Empleado[]>([])
  const [yo, setYo] = React.useState<Empleado | null>(null)
  const [miHoy, setMiHoy] = React.useState<Marcacion | null>(null)
  const [marcando, setMarcando] = React.useState(false)
  const [desde, setDesde] = React.useState(`${hoy.slice(0, 7)}-01`)
  const [hasta, setHasta] = React.useState(hoy)
  const [empleadoFiltro, setEmpleadoFiltro] = React.useState("todos")
  const [marcaciones, setMarcaciones] = React.useState<Marcacion[]>([])
  const [manual, setManual] = React.useState<{ open: boolean; editar: Marcacion | null }>({ open: false, editar: null })
  const [importar, setImportar] = React.useState<{ open: boolean; filas: FilaMarcacionImportada[]; guardando: boolean }>({ open: false, filas: [], guardando: false })

  async function cargarMarcaciones(f: { desde: string; hasta: string; empleado: string }) {
    const res = await getMarcaciones({ desde: f.desde, hasta: f.hasta, empleadoId: f.empleado === "todos" ? null : Number(f.empleado) })
    if (res.pendiente) setPendiente(res.error)
    else if (res.error) toast({ title: "No se pudieron cargar las marcaciones", description: res.error, variant: "destructive" })
    setMarcaciones(res.data)
  }

  async function cargarMiHoy(empleadoId: number) {
    const res = await getMarcaciones({ desde: getHondurasTodayISODate(), hasta: getHondurasTodayISODate(), empleadoId })
    setMiHoy(res.data[0] ?? null)
  }

  React.useEffect(() => {
    if (!ready || razonSocialId == null) return
    let activo = true
    const h = getHondurasTodayISODate()
    Promise.all([
      getEmpleados({ soloActivos: true }),
      getEmpleadoDeUsuario(user?.auth_user_id),
      getMarcaciones({ desde: `${h.slice(0, 7)}-01`, hasta: h, empleadoId: null }),
    ]).then(async ([eRes, mio, mRes]) => {
      if (!activo) return
      if (eRes.pendiente) setPendiente(eRes.error)
      else if (mRes.pendiente) setPendiente(mRes.error)
      setEmpleados(eRes.data)
      setYo(mio)
      setMarcaciones(mRes.data)
      if (mio?.id) {
        const hoyRes = await getMarcaciones({ desde: h, hasta: h, empleadoId: mio.id })
        if (activo) setMiHoy(hoyRes.data[0] ?? null)
      }
      if (activo) setLoading(false)
    })
    return () => {
      activo = false
    }
  }, [ready, razonSocialId, user?.auth_user_id])

  async function marcarAhora(tipo: "entrada" | "salida") {
    if (!yo?.id) return
    setMarcando(true)
    const res = await marcar(yo.id, tipo)
    setMarcando(false)
    if (res.error) return toast({ title: "No se pudo marcar", description: res.error, variant: "destructive" })
    toast({ title: tipo === "entrada" ? "Entrada registrada" : "Salida registrada", description: formatHondurasDateTime(tipo === "entrada" ? res.data?.entrada : res.data?.salida) })
    await cargarMiHoy(yo.id)
    cargarMarcaciones({ desde, hasta, empleado: empleadoFiltro })
  }

  async function eliminar(m: Marcacion) {
    if (!window.confirm(`¿Eliminar la marcación de ${m.empleado_nombre} del ${formatHondurasDate(m.fecha)}?`)) return
    const res = await eliminarMarcacion(m.id)
    if (!res.success) return toast({ title: "No se pudo eliminar", description: res.error ?? "", variant: "destructive" })
    cargarMarcaciones({ desde, hasta, empleado: empleadoFiltro })
  }

  async function elegirArchivo(file: File | null) {
    if (!file) return
    try {
      const filas = await parsearMarcacionesXlsx(file)
      setImportar({ open: true, filas, guardando: false })
    } catch {
      toast({ title: "No se pudo leer el archivo", variant: "destructive" })
    }
  }

  const filasResueltas = React.useMemo(() => importar.filas.map((f) => ({ ...f, empleadoObj: f.error ? null : resolverEmpleado(f.empleado, empleados) })), [importar.filas, empleados])

  async function confirmarImport() {
    const validas = filasResueltas.filter((f) => !f.error && f.empleadoObj?.id)
    if (validas.length === 0) return
    setImportar((p) => ({ ...p, guardando: true }))
    const r = await importarMarcaciones(validas.map((f) => ({ empleado_id: f.empleadoObj!.id!, fecha: f.fecha, entrada: f.entrada, salida: f.salida })))
    setImportar({ open: false, filas: [], guardando: false })
    toast({ title: `${r.guardadas} marcación(es) importada(s)`, description: r.errores.length ? `${r.errores.length} con error: ${r.errores.slice(0, 3).join("; ")}` : undefined, variant: r.errores.length ? "destructive" : undefined })
    cargarMarcaciones({ desde, hasta, empleado: empleadoFiltro })
  }

  const resumen = React.useMemo(() => {
    const m = new Map<number, { nombre: string; dias: number; horas: number; incompletas: number }>()
    for (const x of marcaciones) {
      const r = m.get(x.empleado_id) ?? { nombre: x.empleado_nombre || `#${x.empleado_id}`, dias: 0, horas: 0, incompletas: 0 }
      r.dias += 1
      r.horas += x.horas || 0
      if (!x.entrada || !x.salida) r.incompletas += 1
      m.set(x.empleado_id, r)
    }
    return [...m.values()].sort((a, b) => a.nombre.localeCompare(b.nombre))
  }, [marcaciones])

  function exportar() {
    exportToXlsx(
      marcaciones.map((m) => ({ Empleado: m.empleado_nombre || "", Fecha: m.fecha, Entrada: hora(m.entrada), Salida: hora(m.salida), Horas: m.horas ?? "", Origen: m.origen, Notas: m.notas || "" })),
      { filename: `asistencia_${desde}_${hasta}`, sheetName: "Asistencia" }
    )
  }

  if (loading) return <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground"><Spinner /> Cargando…</div>

  return (
    <div className="space-y-4 md:space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-stone-200 p-2 text-stone-700"><Clock className="h-5 w-5" /></div>
          <div>
            <h1 className="text-2xl font-semibold text-stone-800">Asistencia</h1>
            <p className="text-sm text-muted-foreground">Marcación desde la app, registro manual e importación desde el reloj (Excel).</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={exportar} disabled={marcaciones.length === 0} className="gap-1"><Download className="h-4 w-4" /> Excel</Button>
          <label className="inline-flex"><input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => { elegirArchivo(e.target.files?.[0] ?? null); e.target.value = "" }} /><Button variant="outline" size="sm" asChild className="gap-1 cursor-pointer"><span><Upload className="h-4 w-4" /> Importar</span></Button></label>
          <Button size="sm" onClick={() => setManual({ open: true, editar: null })} disabled={!!pendiente} className="gap-1"><Plus className="h-4 w-4" /> Registro manual</Button>
        </div>
      </div>

      {pendiente && <Card className="border-amber-200 bg-amber-50"><CardContent className="p-4 text-sm text-amber-800 flex items-center gap-2"><AlertTriangle className="h-4 w-4" /> {pendiente}</CardContent></Card>}

      <Card>
        <CardHeader className="p-4 pb-2"><CardTitle className="text-base flex items-center gap-2"><Fingerprint className="h-4 w-4" /> Mi marcación de hoy · {formatHondurasDate(hoy)}</CardTitle></CardHeader>
        <CardContent className="p-4 pt-0">
          {yo ? (
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-sm">{yo.nombre}: {miHoy?.entrada ? <span>entrada <strong>{hora(miHoy.entrada)}</strong></span> : <span className="text-muted-foreground">sin entrada</span>}{miHoy?.salida && <span> · salida <strong>{hora(miHoy.salida)}</strong> · {miHoy.horas} h</span>}</p>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => marcarAhora("entrada")} disabled={marcando || !!miHoy?.entrada} className="gap-1">{marcando ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />} Marcar entrada</Button>
                <Button size="sm" variant="outline" onClick={() => marcarAhora("salida")} disabled={marcando || !miHoy?.entrada || !!miHoy?.salida} className="gap-1"><LogOut className="h-4 w-4" /> Marcar salida</Button>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Tu usuario no está ligado a un empleado. Un administrador puede hacerlo en Empleados → Laboral → Usuario de la app.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4 flex flex-wrap items-end gap-3">
          <div className="space-y-1"><Label>Desde</Label><Input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /></div>
          <div className="space-y-1"><Label>Hasta</Label><Input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} /></div>
          <div className="space-y-1">
            <Label>Empleado</Label>
            <Select value={empleadoFiltro} onValueChange={setEmpleadoFiltro}>
              <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="todos">Todos</SelectItem>{empleados.map((e) => <SelectItem key={e.id} value={String(e.id)}>{e.nombre}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <Button onClick={() => cargarMarcaciones({ desde, hasta, empleado: empleadoFiltro })}>Aplicar</Button>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="overflow-x-auto border rounded-lg">
          <Table>
            <TableHeader><TableRow className="bg-stone-50"><TableHead>Fecha</TableHead><TableHead>Empleado</TableHead><TableHead>Entrada</TableHead><TableHead>Salida</TableHead><TableHead className="text-right">Horas</TableHead><TableHead>Origen</TableHead><TableHead className="w-20"></TableHead></TableRow></TableHeader>
            <TableBody>
              {marcaciones.map((m) => (
                <TableRow key={m.id}>
                  <TableCell>{formatHondurasDate(m.fecha)}</TableCell>
                  <TableCell className="font-medium">{m.empleado_nombre}</TableCell>
                  <TableCell>{hora(m.entrada) || <span className="text-muted-foreground">—</span>}</TableCell>
                  <TableCell>{hora(m.salida) || <span className="text-amber-700">—</span>}</TableCell>
                  <TableCell className="text-right font-mono">{m.horas ?? ""}</TableCell>
                  <TableCell><Badge variant="outline" className="text-[10px]">{m.origen}</Badge>{m.notas && <span className="block text-xs text-muted-foreground">{m.notas}</span>}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setManual({ open: true, editar: m })}><Pencil className="h-4 w-4" /></Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-red-700" onClick={() => eliminar(m)}><Trash2 className="h-4 w-4" /></Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {marcaciones.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">Sin marcaciones en el rango.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </div>
        <Card>
          <CardHeader className="p-4 pb-2"><CardTitle className="text-base">Resumen del rango</CardTitle></CardHeader>
          <CardContent className="p-4 pt-0">
            <Table>
              <TableHeader><TableRow><TableHead>Empleado</TableHead><TableHead className="text-right">Días</TableHead><TableHead className="text-right">Horas</TableHead></TableRow></TableHeader>
              <TableBody>
                {resumen.map((r) => <TableRow key={r.nombre}><TableCell className="text-sm">{r.nombre}{r.incompletas > 0 && <span className="block text-xs text-amber-700">{r.incompletas} sin salida</span>}</TableCell><TableCell className="text-right">{r.dias}</TableCell><TableCell className="text-right font-mono">{r.horas.toFixed(2)}</TableCell></TableRow>)}
                {resumen.length === 0 && <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground py-4">—</TableCell></TableRow>}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <Dialog open={manual.open} onOpenChange={(o) => setManual((p) => ({ ...p, open: o }))}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>{manual.editar ? "Editar marcación" : "Registro manual"}</DialogTitle><DialogDescription>Hora de Honduras. Si el día ya existe, se reemplaza.</DialogDescription></DialogHeader>
          {manual.open && <MarcacionForm key={manual.editar?.id ?? "nueva"} editar={manual.editar} empleados={empleados} onClose={() => setManual({ open: false, editar: null })} onSaved={() => { setManual({ open: false, editar: null }); cargarMarcaciones({ desde, hasta, empleado: empleadoFiltro }); if (yo?.id) cargarMiHoy(yo.id) }} />}
        </DialogContent>
      </Dialog>

      <Dialog open={importar.open} onOpenChange={(o) => { if (!o) setImportar({ open: false, filas: [], guardando: false }) }}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader><DialogTitle>Importar marcaciones</DialogTitle><DialogDescription>Columnas esperadas: Empleado (código o nombre), Fecha, Entrada, Salida. Se muestran las primeras 200 filas.</DialogDescription></DialogHeader>
          <div className="max-h-[55vh] overflow-auto border rounded-md">
            <Table>
              <TableHeader><TableRow className="bg-stone-50"><TableHead>#</TableHead><TableHead>Empleado</TableHead><TableHead>Resuelto</TableHead><TableHead>Fecha</TableHead><TableHead>Entrada</TableHead><TableHead>Salida</TableHead></TableRow></TableHeader>
              <TableBody>
                {filasResueltas.slice(0, 200).map((f) => (
                  <TableRow key={f.fila} className={f.error || !f.empleadoObj ? "bg-red-50" : ""}>
                    <TableCell className="text-xs">{f.fila}</TableCell>
                    <TableCell className="text-sm">{f.empleado}</TableCell>
                    <TableCell className="text-xs">{f.error ? <span className="text-red-700">{f.error}</span> : f.empleadoObj ? f.empleadoObj.nombre : <span className="text-red-700">No encontrado</span>}</TableCell>
                    <TableCell className="text-xs">{f.fecha}</TableCell><TableCell className="text-xs">{f.entrada || "—"}</TableCell><TableCell className="text-xs">{f.salida || "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <DialogFooter>
            <p className="text-xs text-muted-foreground mr-auto">{filasResueltas.filter((f) => !f.error && f.empleadoObj).length} válidas de {filasResueltas.length}</p>
            <Button variant="outline" onClick={() => setImportar({ open: false, filas: [], guardando: false })}>Cancelar</Button>
            <Button onClick={confirmarImport} disabled={importar.guardando || filasResueltas.every((f) => f.error || !f.empleadoObj)}>{importar.guardando && <Loader2 className="h-4 w-4 animate-spin mr-1" />} Importar válidas</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function MarcacionForm({ editar, empleados, onClose, onSaved }: { editar: Marcacion | null; empleados: Empleado[]; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast()
  const [empleadoId, setEmpleadoId] = React.useState<string>(editar ? String(editar.empleado_id) : "")
  const [fecha, setFecha] = React.useState(editar?.fecha ?? getHondurasTodayISODate())
  const [entrada, setEntrada] = React.useState(hora(editar?.entrada ?? null) || "08:00")
  const [salida, setSalida] = React.useState(hora(editar?.salida ?? null))
  const [notas, setNotas] = React.useState(editar?.notas ?? "")
  const [saving, setSaving] = React.useState(false)

  async function guardar() {
    if (!empleadoId) return toast({ title: "Elige el empleado", variant: "destructive" })
    setSaving(true)
    const res = await saveMarcacion({ empleado_id: Number(empleadoId), fecha, entrada: entrada || null, salida: salida || null, notas, origen: "manual" })
    setSaving(false)
    if (res.error) return toast({ title: "No se pudo guardar", description: res.error, variant: "destructive" })
    onSaved()
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Label>Empleado</Label>
        <Select value={empleadoId} onValueChange={setEmpleadoId} disabled={!!editar}>
          <SelectTrigger><SelectValue placeholder="Elegir…" /></SelectTrigger>
          <SelectContent>{empleados.map((e) => <SelectItem key={e.id} value={String(e.id)}>{e.nombre}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <div className="grid gap-3 grid-cols-3">
        <div className="space-y-1"><Label>Fecha</Label><Input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} disabled={!!editar} /></div>
        <div className="space-y-1"><Label>Entrada</Label><Input type="time" value={entrada} onChange={(e) => setEntrada(e.target.value)} /></div>
        <div className="space-y-1"><Label>Salida</Label><Input type="time" value={salida} onChange={(e) => setSalida(e.target.value)} /></div>
      </div>
      <div className="space-y-1"><Label>Notas</Label><Input value={notas} onChange={(e) => setNotas(e.target.value)} /></div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={saving}>Cancelar</Button>
        <Button onClick={guardar} disabled={saving}>{saving && <Loader2 className="h-4 w-4 animate-spin mr-1" />} Guardar</Button>
      </DialogFooter>
    </div>
  )
}
