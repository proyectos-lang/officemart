"use client"

import * as React from "react"
import { ListPlus, Plus, Pencil, Trash2, Download, Gift, Loader2, AlertTriangle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Spinner } from "@/components/ui/spinner"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useToast } from "@/hooks/use-toast"
import { useTenant } from "@/lib/hooks/use-tenant"
import { formatCurrency } from "@/lib/utils/format"
import { formatHondurasDate, getHondurasTodayISODate } from "@/lib/utils/honduras-time"
import { exportToXlsx } from "@/lib/utils/export"
import { getEmpleados, getNovedades, saveNovedad, deleteNovedad, crearNovedadesLote, TIPOS_NOVEDAD, defNovedad, type Empleado, type Novedad, type TipoNovedad } from "@/lib/services/rrhh"
import { calcularAguinaldoProporcional } from "@/lib/services/nomina"

function finDeMes(ym: string): string {
  const [y, m] = ym.split("-").map(Number)
  const d = new Date(Date.UTC(y, m, 0))
  return `${y}-${String(m).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`
}

export default function NovedadesPage() {
  const { toast } = useToast()
  const { ready, razonSocialId } = useTenant()
  const hoy = getHondurasTodayISODate()
  const [loading, setLoading] = React.useState(true)
  const [pendiente, setPendiente] = React.useState<string | null>(null)
  const [empleados, setEmpleados] = React.useState<Empleado[]>([])
  const [novedades, setNovedades] = React.useState<Novedad[]>([])
  const [mes, setMes] = React.useState(hoy.slice(0, 7))
  const [empleadoFiltro, setEmpleadoFiltro] = React.useState("todos")
  const [soloSinAplicar, setSoloSinAplicar] = React.useState(false)
  const [dialog, setDialog] = React.useState<{ open: boolean; editar: Novedad | null }>({ open: false, editar: null })
  const [aguinaldo, setAguinaldo] = React.useState(false)

  async function cargar(f: { mes: string; empleado: string; sinAplicar: boolean }) {
    const res = await getNovedades({ desde: `${f.mes}-01`, hasta: finDeMes(f.mes), empleadoId: f.empleado === "todos" ? null : Number(f.empleado), sinAplicar: f.sinAplicar })
    if (res.pendiente) setPendiente(res.error)
    else if (res.error) toast({ title: "No se pudieron cargar las novedades", description: res.error, variant: "destructive" })
    setNovedades(res.data)
  }

  React.useEffect(() => {
    if (!ready || razonSocialId == null) return
    let activo = true
    const ym = getHondurasTodayISODate().slice(0, 7)
    Promise.all([getEmpleados(), getNovedades({ desde: `${ym}-01`, hasta: finDeMes(ym) })]).then(([eRes, nRes]) => {
      if (!activo) return
      if (eRes.pendiente) setPendiente(eRes.error)
      else if (nRes.pendiente) setPendiente(nRes.error)
      setEmpleados(eRes.data)
      setNovedades(nRes.data)
      setLoading(false)
    })
    return () => {
      activo = false
    }
  }, [ready, razonSocialId])

  const aplicar = (patch: Partial<{ mes: string; empleado: string; sinAplicar: boolean }>) => {
    const f = { mes, empleado: empleadoFiltro, sinAplicar: soloSinAplicar, ...patch }
    if (patch.mes !== undefined) setMes(patch.mes)
    if (patch.empleado !== undefined) setEmpleadoFiltro(patch.empleado)
    if (patch.sinAplicar !== undefined) setSoloSinAplicar(patch.sinAplicar)
    cargar(f)
  }

  async function eliminar(n: Novedad) {
    if (!n.id || !window.confirm(`¿Eliminar ${n.tipo} de ${n.empleado_nombre}?`)) return
    const res = await deleteNovedad(n.id)
    if (!res.success) return toast({ title: "No se pudo eliminar", description: res.error ?? "", variant: "destructive" })
    aplicar({})
  }

  function exportar() {
    exportToXlsx(
      novedades.map((n) => ({ Fecha: n.fecha, Empleado: n.empleado_nombre || "", Tipo: n.tipo, Cantidad: n.cantidad ?? "", Monto: n.monto ?? "", Gravable: n.gravable ? "Sí" : "No", Cotizable: n.cotizable ? "Sí" : "No", Descripcion: n.descripcion || "", Nomina: n.nomina_id ?? "" })),
      { filename: `novedades_${mes}`, sheetName: "Novedades" }
    )
  }

  if (loading) return <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground"><Spinner /> Cargando…</div>

  return (
    <div className="space-y-4 md:space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-stone-200 p-2 text-stone-700"><ListPlus className="h-5 w-5" /></div>
          <div>
            <h1 className="text-2xl font-semibold text-stone-800">Novedades de nómina</h1>
            <p className="text-sm text-muted-foreground">Horas extra, bonos, comisiones, aguinaldos, permisos, incapacidades, ausencias, deducciones y anticipos.</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={exportar} disabled={novedades.length === 0} className="gap-1"><Download className="h-4 w-4" /> Excel</Button>
          <Button variant="outline" size="sm" onClick={() => setAguinaldo(true)} disabled={!!pendiente} className="gap-1"><Gift className="h-4 w-4" /> Generar 13.º / 14.º</Button>
          <Button size="sm" onClick={() => setDialog({ open: true, editar: null })} disabled={!!pendiente} className="gap-1"><Plus className="h-4 w-4" /> Nueva novedad</Button>
        </div>
      </div>

      {pendiente && <Card className="border-amber-200 bg-amber-50"><CardContent className="p-4 text-sm text-amber-800 flex items-center gap-2"><AlertTriangle className="h-4 w-4" /> {pendiente}</CardContent></Card>}

      <Card>
        <CardContent className="p-4 flex flex-wrap items-end gap-3">
          <div className="space-y-1"><Label>Mes</Label><Input type="month" value={mes} onChange={(e) => aplicar({ mes: e.target.value })} /></div>
          <div className="space-y-1">
            <Label>Empleado</Label>
            <Select value={empleadoFiltro} onValueChange={(v) => aplicar({ empleado: v })}>
              <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="todos">Todos</SelectItem>{empleados.map((e) => <SelectItem key={e.id} value={String(e.id)}>{e.nombre}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <label className="flex items-center gap-2 text-sm pb-2"><Checkbox checked={soloSinAplicar} onCheckedChange={(v) => aplicar({ sinAplicar: v === true })} /> Solo sin aplicar en nómina</label>
        </CardContent>
      </Card>

      <div className="overflow-x-auto border rounded-lg">
        <Table>
          <TableHeader><TableRow className="bg-stone-50"><TableHead>Fecha</TableHead><TableHead>Empleado</TableHead><TableHead>Tipo</TableHead><TableHead className="text-right">Cantidad</TableHead><TableHead className="text-right">Monto</TableHead><TableHead>ISR / IHSS</TableHead><TableHead>Descripción</TableHead><TableHead>Nómina</TableHead><TableHead className="w-20"></TableHead></TableRow></TableHeader>
          <TableBody>
            {novedades.map((n) => {
              const def = defNovedad(n.tipo)
              return (
                <TableRow key={n.id} className={n.nomina_id ? "opacity-70" : ""}>
                  <TableCell>{formatHondurasDate(n.fecha)}</TableCell>
                  <TableCell className="font-medium">{n.empleado_nombre}</TableCell>
                  <TableCell><Badge variant={def.efecto === "deduccion" || def.efecto === "dias" ? "destructive" : def.efecto === "info" ? "outline" : "secondary"}>{n.tipo}</Badge></TableCell>
                  <TableCell className="text-right">{n.cantidad != null ? `${n.cantidad} ${def.unidad === "horas" ? "h" : "d"}` : ""}</TableCell>
                  <TableCell className="text-right font-mono">{n.monto != null ? formatCurrency(n.monto) : ""}</TableCell>
                  <TableCell className="text-xs">{def.efecto === "ingreso" ? `${n.gravable ? "grava" : "exento"} / ${n.cotizable ? "cotiza" : "no cotiza"}` : "—"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-[220px] truncate">{n.descripcion}</TableCell>
                  <TableCell className="text-xs">{n.nomina_id ? `#${n.nomina_id}` : <span className="text-muted-foreground">pendiente</span>}</TableCell>
                  <TableCell>
                    {!n.nomina_id && (
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setDialog({ open: true, editar: n })}><Pencil className="h-4 w-4" /></Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-red-700" onClick={() => eliminar(n)}><Trash2 className="h-4 w-4" /></Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              )
            })}
            {novedades.length === 0 && <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-8">Sin novedades en el mes.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </div>

      <Dialog open={dialog.open} onOpenChange={(o) => setDialog((p) => ({ ...p, open: o }))}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>{dialog.editar ? "Editar novedad" : "Nueva novedad"}</DialogTitle><DialogDescription>Se aplica en la próxima nómina del empleado (según la fecha).</DialogDescription></DialogHeader>
          {dialog.open && <NovedadForm key={dialog.editar?.id ?? "nueva"} editar={dialog.editar} empleados={empleados.filter((e) => e.estado === "Activo" || e.id === dialog.editar?.empleado_id)} onClose={() => setDialog({ open: false, editar: null })} onSaved={() => { setDialog({ open: false, editar: null }); aplicar({}) }} />}
        </DialogContent>
      </Dialog>

      <Dialog open={aguinaldo} onOpenChange={setAguinaldo}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader><DialogTitle>Generar décimo tercer / décimo cuarto mes</DialogTitle><DialogDescription>Crea una novedad «Aguinaldo» (exenta de ISR e IHSS por defecto) por empleado activo: salario mensual × meses trabajados en la ventana / 12.</DialogDescription></DialogHeader>
          {aguinaldo && <AguinaldoForm empleados={empleados.filter((e) => e.estado === "Activo")} onClose={() => setAguinaldo(false)} onSaved={() => { setAguinaldo(false); aplicar({}) }} />}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function NovedadForm({ editar, empleados, onClose, onSaved }: { editar: Novedad | null; empleados: Empleado[]; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast()
  const [empleadoId, setEmpleadoId] = React.useState(editar ? String(editar.empleado_id) : "")
  const [tipo, setTipo] = React.useState<TipoNovedad>(editar?.tipo ?? "Horas extra diurna")
  const [fecha, setFecha] = React.useState(editar?.fecha ?? getHondurasTodayISODate())
  const [cantidad, setCantidad] = React.useState(editar?.cantidad != null ? String(editar.cantidad) : "")
  const [monto, setMonto] = React.useState(editar?.monto != null ? String(editar.monto) : "")
  const [gravable, setGravable] = React.useState(editar?.gravable ?? true)
  const [cotizable, setCotizable] = React.useState(editar?.cotizable ?? true)
  const [descripcion, setDescripcion] = React.useState(editar?.descripcion ?? "")
  const [saving, setSaving] = React.useState(false)
  const def = defNovedad(tipo)

  function cambiarTipo(t: TipoNovedad) {
    setTipo(t)
    const d = defNovedad(t)
    setGravable(d.gravable)
    setCotizable(d.cotizable)
  }

  async function guardar() {
    setSaving(true)
    const res = await saveNovedad({ id: editar?.id, empleado_id: Number(empleadoId), tipo, fecha, cantidad: def.unidad === "monto" ? null : Number(cantidad) || 0, monto: def.unidad === "monto" ? Number(monto) || 0 : null, gravable, cotizable, descripcion })
    setSaving(false)
    if (res.error) return toast({ title: "No se pudo guardar", description: res.error, variant: "destructive" })
    toast({ title: "Novedad guardada" })
    onSaved()
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label>Empleado</Label>
          <Select value={empleadoId} onValueChange={setEmpleadoId}>
            <SelectTrigger><SelectValue placeholder="Elegir…" /></SelectTrigger>
            <SelectContent>{empleados.map((e) => <SelectItem key={e.id} value={String(e.id)}>{e.nombre}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label>Tipo</Label>
          <Select value={tipo} onValueChange={(v) => cambiarTipo(v as TipoNovedad)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{TIPOS_NOVEDAD.map((t) => <SelectItem key={t.tipo} value={t.tipo}>{t.tipo}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1"><Label>Fecha</Label><Input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} /></div>
        {def.unidad === "monto"
          ? <div className="space-y-1"><Label>Monto (L)</Label><Input type="number" min={0} step="0.01" value={monto} onChange={(e) => setMonto(e.target.value)} /></div>
          : <div className="space-y-1"><Label>{def.unidad === "horas" ? "Horas" : "Días"}</Label><Input type="number" min={0} step="0.5" value={cantidad} onChange={(e) => setCantidad(e.target.value)} /></div>}
      </div>
      {def.efecto === "ingreso" && (
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2"><Checkbox checked={gravable} onCheckedChange={(v) => setGravable(v === true)} /> Grava ISR</label>
          <label className="flex items-center gap-2"><Checkbox checked={cotizable} onCheckedChange={(v) => setCotizable(v === true)} /> Cotiza IHSS / RAP</label>
        </div>
      )}
      {def.efecto === "dias" && <p className="text-xs text-muted-foreground">Descuenta días del salario del período (salario mensual / 30 por día).</p>}
      {def.efecto === "info" && <p className="text-xs text-muted-foreground">Informativo: no cambia el salario (vacaciones y permisos con goce se pagan normal; la incapacidad se registra para control).</p>}
      <div className="space-y-1"><Label>Descripción</Label><Input value={descripcion} onChange={(e) => setDescripcion(e.target.value)} /></div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={saving}>Cancelar</Button>
        <Button onClick={guardar} disabled={saving || !empleadoId}>{saving && <Loader2 className="h-4 w-4 animate-spin mr-1" />} Guardar</Button>
      </DialogFooter>
    </div>
  )
}

function AguinaldoForm({ empleados, onClose, onSaved }: { empleados: Empleado[]; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast()
  const hoy = getHondurasTodayISODate()
  const anio = Number(hoy.slice(0, 4))
  const [cual, setCual] = React.useState<"13" | "14">(Number(hoy.slice(5, 7)) >= 10 ? "13" : "14")
  const [desde, setDesde] = React.useState(cual === "13" ? `${anio - 1}-12-01` : `${anio - 1}-07-01`)
  const [hasta, setHasta] = React.useState(cual === "13" ? `${anio}-11-30` : `${anio}-06-30`)
  const [fecha, setFecha] = React.useState(hoy)
  const [saving, setSaving] = React.useState(false)

  function cambiar(v: "13" | "14") {
    setCual(v)
    setDesde(v === "13" ? `${anio - 1}-12-01` : `${anio - 1}-07-01`)
    setHasta(v === "13" ? `${anio}-11-30` : `${anio}-06-30`)
  }

  const filas = empleados.map((e) => ({ e, ...calcularAguinaldoProporcional(e.salario_mensual, e.fecha_ingreso, { desde, hasta }) })).filter((f) => f.monto > 0)
  const total = filas.reduce((a, f) => a + f.monto, 0)

  async function generar() {
    setSaving(true)
    const res = await crearNovedadesLote(filas.map((f) => ({ empleado_id: f.e.id!, tipo: "Aguinaldo", fecha, monto: f.monto, cantidad: null, gravable: false, cotizable: false, descripcion: `${cual === "13" ? "Décimo tercer mes" : "Décimo cuarto mes"} ${anio} (${f.meses} meses)` })))
    setSaving(false)
    if (res.error) return toast({ title: "No se pudo generar", description: res.error, variant: "destructive" })
    toast({ title: `${res.creadas} aguinaldo(s) generado(s)` })
    onSaved()
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-4">
        <div className="space-y-1">
          <Label>Beneficio</Label>
          <Select value={cual} onValueChange={(v) => cambiar(v as "13" | "14")}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="13">13.º mes (diciembre)</SelectItem><SelectItem value="14">14.º mes (junio)</SelectItem></SelectContent>
          </Select>
        </div>
        <div className="space-y-1"><Label>Ventana desde</Label><Input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /></div>
        <div className="space-y-1"><Label>Hasta</Label><Input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} /></div>
        <div className="space-y-1"><Label>Fecha de la novedad</Label><Input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} /></div>
      </div>
      <div className="max-h-[45vh] overflow-auto border rounded-md">
        <Table>
          <TableHeader><TableRow className="bg-stone-50"><TableHead>Empleado</TableHead><TableHead className="text-right">Salario</TableHead><TableHead className="text-right">Meses</TableHead><TableHead className="text-right">Aguinaldo</TableHead></TableRow></TableHeader>
          <TableBody>
            {filas.map((f) => <TableRow key={f.e.id}><TableCell>{f.e.nombre}</TableCell><TableCell className="text-right font-mono">{formatCurrency(f.e.salario_mensual)}</TableCell><TableCell className="text-right">{f.meses}</TableCell><TableCell className="text-right font-mono">{formatCurrency(f.monto)}</TableCell></TableRow>)}
            {filas.length === 0 && <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-6">Sin empleados con salario en la ventana.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </div>
      <p className="text-xs text-muted-foreground">Total {formatCurrency(total)}. Si un empleado ya tiene el aguinaldo registrado, elimínalo antes para no duplicarlo. El 13.º/14.º está exento de ISR hasta 10 salarios mínimos (marca «grava» en la novedad si excede).</p>
      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={saving}>Cancelar</Button>
        <Button onClick={generar} disabled={saving || filas.length === 0}>{saving && <Loader2 className="h-4 w-4 animate-spin mr-1" />} Generar {filas.length} novedad(es)</Button>
      </DialogFooter>
    </div>
  )
}
