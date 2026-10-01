"use client"

import * as React from "react"
import { Workflow, Plus, Pencil, Trash2, Loader2, ChevronUp, ChevronDown, GripVertical } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import { Spinner } from "@/components/ui/spinner"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Switch } from "@/components/ui/switch"
import { useToast } from "@/hooks/use-toast"
import {
  getOperaciones, crearOperacion, actualizarOperacion, eliminarOperacion, reordenarOperaciones,
  type OperacionProduccion,
} from "@/lib/services/produccion-operaciones"
import { getOperacionesStd, setEstandarOperacion, type OperacionStd } from "@/lib/services/produccion-tracking"

export default function OperacionesProduccionPage() {
  const { toast } = useToast()
  const [operaciones, setOperaciones] = React.useState<OperacionProduccion[]>([])
  const [loading, setLoading] = React.useState(true)
  const [reordenando, setReordenando] = React.useState(false)

  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [editando, setEditando] = React.useState<OperacionProduccion | null>(null)
  const [nombre, setNombre] = React.useState("")
  const [descripcion, setDescripcion] = React.useState("")
  const [activo, setActivo] = React.useState(true)
  const [estandar, setEstandar] = React.useState("")
  const [estandares, setEstandares] = React.useState<Map<number, OperacionStd>>(new Map())
  const [saving, setSaving] = React.useState(false)
  const [aEliminar, setAEliminar] = React.useState<OperacionProduccion | null>(null)

  const cargar = React.useCallback(async () => {
    setLoading(true)
    const [{ data, error }, std] = await Promise.all([getOperaciones(), getOperacionesStd()])
    if (error) toast({ title: "Error", description: error, variant: "destructive" })
    setOperaciones(data)
    setEstandares(new Map(std.data.map((o) => [o.id, o])))
    setLoading(false)
  }, [toast])
  React.useEffect(() => { cargar() }, [cargar])

  function abrirNuevo() {
    setEditando(null); setNombre(""); setDescripcion(""); setActivo(true); setEstandar("")
    setDialogOpen(true)
  }
  function abrirEditar(o: OperacionProduccion) {
    setEditando(o); setNombre(o.nombre); setDescripcion(o.descripcion || ""); setActivo(o.activo)
    const st = estandares.get(o.id)
    setEstandar(st?.configurado ? String(st.estandar_h) : "")
    setDialogOpen(true)
  }

  async function guardar() {
    if (!nombre.trim()) { toast({ title: "Falta el nombre", variant: "destructive" }); return }
    setSaving(true)
    let opId: number | undefined
    let errorGuardar: string | null
    if (editando) {
      errorGuardar = (await actualizarOperacion(editando.id, { nombre, descripcion, activo })).error
      opId = editando.id
    } else {
      const creada = await crearOperacion({ nombre, descripcion })
      errorGuardar = creada.error
      opId = creada.data?.id
    }
    if (errorGuardar) { setSaving(false); toast({ title: "Error", description: errorGuardar, variant: "destructive" }); return }
    // Tiempo estándar (script officemart-019): base de la planeación.
    const previo = editando ? estandares.get(editando.id) : undefined
    const horas = estandar.trim() === "" ? null : Number(estandar)
    if (opId != null && (horas != null || previo?.configurado)) {
      const st = await setEstandarOperacion(opId, horas)
      if (st.error) toast({ title: "No se guardó el tiempo estándar", description: st.error, variant: "destructive" })
    }
    setSaving(false)
    toast({ title: editando ? "Operación actualizada" : "Operación creada" })
    setDialogOpen(false)
    cargar()
  }

  async function confirmarEliminar() {
    if (!aEliminar) return
    const { error } = await eliminarOperacion(aEliminar.id)
    setAEliminar(null)
    if (error) { toast({ title: "Error", description: error, variant: "destructive" }); return }
    toast({ title: "Operación eliminada" })
    cargar()
  }

  // Mueve una operación arriba/abajo y persiste la nueva secuencia.
  async function mover(index: number, dir: -1 | 1) {
    const destino = index + dir
    if (destino < 0 || destino >= operaciones.length) return
    const next = [...operaciones]
    ;[next[index], next[destino]] = [next[destino], next[index]]
    // Optimista: refleja el nuevo orden con sus secuencias renumeradas.
    setOperaciones(next.map((o, i) => ({ ...o, orden_secuencia: i + 1 })))
    setReordenando(true)
    const { error } = await reordenarOperaciones(next.map((o) => o.id))
    setReordenando(false)
    if (error) { toast({ title: "No se reordenó", description: error, variant: "destructive" }); cargar() }
  }

  return (
    <div className="space-y-4 md:space-y-6 p-4 md:p-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-foreground flex items-center gap-2">
            <Workflow className="h-6 w-6 text-stone-600" /> Operaciones de Producción
          </h1>
          <p className="text-sm text-muted-foreground">
            Define la secuencia de operaciones (etapas) de tu producción. Cada orden las recorrerá en este orden.
          </p>
        </div>
        <Button onClick={abrirNuevo} size="sm" className="w-full sm:w-auto">
          <Plus className="h-4 w-4 mr-1" /> Nueva operación
        </Button>
      </div>

      <Card className="rounded-xl border-stone-200">
        <CardHeader className="p-4 md:p-6 pb-3">
          <CardTitle className="text-base md:text-lg">Secuencia de operaciones</CardTitle>
          <CardDescription className="text-xs md:text-sm">
            El orden define cómo avanzan las órdenes (etapa 1 → 2 → 3…). Usa las flechas para reordenar.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-4 md:p-6 pt-0">
          {loading ? (
            <div className="flex justify-center py-10"><Spinner className="h-6 w-6" /></div>
          ) : operaciones.length === 0 ? (
            <div className="text-center py-10 text-stone-500 text-sm">
              <Workflow className="h-10 w-10 mx-auto mb-2 opacity-40" />
              Aún no hay operaciones. Crea la primera etapa de tu producción.
            </div>
          ) : (
            <div className="space-y-2">
              {operaciones.map((o, i) => (
                <div key={o.id} className={`flex items-center gap-3 rounded-lg border border-stone-200 p-3 ${o.activo ? "" : "opacity-60"}`}>
                  <div className="flex flex-col">
                    <button className="text-stone-400 hover:text-stone-700 disabled:opacity-30" disabled={i === 0 || reordenando} onClick={() => mover(i, -1)} title="Subir"><ChevronUp className="h-4 w-4" /></button>
                    <button className="text-stone-400 hover:text-stone-700 disabled:opacity-30" disabled={i === operaciones.length - 1 || reordenando} onClick={() => mover(i, 1)} title="Bajar"><ChevronDown className="h-4 w-4" /></button>
                  </div>
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-stone-100 text-sm font-semibold text-stone-600">
                    {o.orden_secuencia}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium truncate">{o.nombre}</span>
                      {!o.activo && <Badge variant="outline" className="text-[10px]">Inactiva</Badge>}
                    </div>
                    {o.descripcion && <p className="text-xs text-stone-500 truncate">{o.descripcion}</p>}
                    {estandares.get(o.id) && <p className="text-[11px] text-stone-400">Estándar: {estandares.get(o.id)!.estandar_h} h laborales{estandares.get(o.id)!.configurado ? "" : " (por defecto)"}</p>}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => abrirEditar(o)} title="Editar"><Pencil className="h-4 w-4" /></Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-stone-500 hover:text-destructive" onClick={() => setAEliminar(o)} title="Eliminar"><Trash2 className="h-4 w-4" /></Button>
                  </div>
                </div>
              ))}
              <p className="text-[11px] text-stone-400 flex items-center gap-1 pt-1">
                <GripVertical className="h-3 w-3" /> Usa las flechas de cada fila para cambiar el orden de las etapas.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Crear / editar */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editando ? "Editar operación" : "Nueva operación"}</DialogTitle>
            <DialogDescription>
              {editando ? "Cambia el nombre, la descripción o si está activa." : "Se agrega al final de la secuencia; luego puedes reordenarla."}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label htmlFor="op-nombre">Nombre <span className="text-destructive">*</span></Label>
              <Input id="op-nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej: Diseño, Impresión, Confección" autoFocus />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="op-desc">Descripción <span className="text-stone-400 text-xs font-normal">(opcional)</span></Label>
              <Textarea id="op-desc" value={descripcion} onChange={(e) => setDescripcion(e.target.value)} rows={2} placeholder="Qué se hace en esta etapa" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="op-std">Tiempo estándar <span className="text-stone-400 text-xs font-normal">(horas laborales, opcional)</span></Label>
              <Input id="op-std" type="number" min={0} step="0.25" value={estandar} onChange={(e) => setEstandar(e.target.value)} placeholder={`Por defecto ${estandares.get(editando?.id ?? -1)?.estandar_h ?? 4} h`} />
              <p className="text-[11px] text-stone-500">Duración normal de la etapa sin esperas. Se usa para planear las fechas de cada orden (Mastertracking).</p>
            </div>
            {editando && (
              <div className="flex items-center justify-between rounded-lg border border-stone-200 p-3">
                <div>
                  <p className="text-sm font-medium">Operación activa</p>
                  <p className="text-xs text-stone-500">Las inactivas no se usan en las órdenes nuevas.</p>
                </div>
                <Switch checked={activo} onCheckedChange={setActivo} />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>Cancelar</Button>
            <Button onClick={guardar} disabled={saving || !nombre.trim()}>
              {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Guardar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Eliminar */}
      <AlertDialog open={aEliminar != null} onOpenChange={(o) => { if (!o) setAEliminar(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar operación</AlertDialogTitle>
            <AlertDialogDescription>
              ¿Eliminar la operación <strong>{aEliminar?.nombre}</strong> de la secuencia? Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); confirmarEliminar() }} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Eliminar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
