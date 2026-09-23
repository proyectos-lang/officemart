"use client"

import * as React from "react"
import { FileText, Plus, Loader2, Check, ChevronsUpDown, AlertTriangle, CalendarClock, Wrench } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { PlaneadorProduccion } from "./planeador"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import { Spinner } from "@/components/ui/spinner"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"
import { formatCurrency } from "@/lib/utils/format"
import { getProductos, getClientes, type Producto, type Cliente } from "@/lib/services/catalogos"
import { getProductosFabricados } from "@/lib/services/productos-fabricados"
import { getOperaciones, type OperacionProduccion } from "@/lib/services/produccion-operaciones"
import {
  getOrdenes, createOrden, createOrdenTrabajo, setEstadoOrden, codigoOrden, etiquetaOrden,
  type OrdenProduccion, type EstadoOrden,
} from "@/lib/services/produccion-ordenes"

const ESTADOS: EstadoOrden[] = ["Abierta", "En Proceso", "Cerrada", "Cancelada"]

function estadoBadge(e: EstadoOrden) {
  const map: Record<EstadoOrden, string> = {
    "Abierta": "border-sky-200 bg-sky-50 text-sky-700",
    "En Proceso": "border-amber-200 bg-amber-50 text-amber-800",
    "Cerrada": "border-emerald-200 bg-emerald-50 text-emerald-700",
    "Cancelada": "border-stone-300 bg-stone-100 text-stone-500",
  }
  return <Badge variant="outline" className={map[e]}>{e}</Badge>
}

export default function OrdenesProduccionPage() {
  const { toast } = useToast()
  const [ordenes, setOrdenes] = React.useState<OrdenProduccion[]>([])
  const [productos, setProductos] = React.useState<Producto[]>([])
  const [fabricados, setFabricados] = React.useState<Set<number>>(new Set())
  const [clientes, setClientes] = React.useState<Cliente[]>([])
  const [operaciones, setOperaciones] = React.useState<OperacionProduccion[]>([])
  const [loading, setLoading] = React.useState(true)
  const [filtroTipo, setFiltroTipo] = React.useState<"todas" | "Produccion" | "Trabajo">("todas")

  // Nueva orden de producción
  const [nuevoOpen, setNuevoOpen] = React.useState(false)
  const [comboOpen, setComboOpen] = React.useState(false)
  const [productoId, setProductoId] = React.useState<number | null>(null)
  const [cantidad, setCantidad] = React.useState("")
  const [fecha, setFecha] = React.useState("")
  const [notas, setNotas] = React.useState("")
  const [saving, setSaving] = React.useState(false)

  // Nueva orden de trabajo (officemart-010)
  const [otOpen, setOtOpen] = React.useState(false)
  const [otDescripcion, setOtDescripcion] = React.useState("")
  const [otClienteId, setOtClienteId] = React.useState<number | null>(null)
  const [otClienteOpen, setOtClienteOpen] = React.useState(false)
  const [otCantidad, setOtCantidad] = React.useState("1")
  const [otFecha, setOtFecha] = React.useState("")
  const [otNotas, setOtNotas] = React.useState("")
  const [otOps, setOtOps] = React.useState<number[]>([])

  const cargar = React.useCallback(async () => {
    setLoading(true)
    const [o, p, f, c, ops] = await Promise.all([getOrdenes(), getProductos(), getProductosFabricados(), getClientes({ soloActivos: true }), getOperaciones({ soloActivas: true })])
    setOrdenes(o.data)
    setProductos(p.data || [])
    setFabricados(f.data)
    setClientes(c.data || [])
    setOperaciones(ops.data || [])
    setLoading(false)
  }, [])
  React.useEffect(() => { cargar() }, [cargar])

  const productosFabricados = React.useMemo(
    () => productos.filter((p) => p.id != null && fabricados.has(p.id)),
    [productos, fabricados],
  )
  const productoSel = productos.find((p) => p.id === productoId)
  const otCliente = clientes.find((c) => c.id === otClienteId)
  const ordenesFiltradas = ordenes.filter((o) => filtroTipo === "todas" || (filtroTipo === "Trabajo" ? o.tipo === "Trabajo" : o.tipo !== "Trabajo"))

  function abrirNuevo() {
    setProductoId(null); setCantidad(""); setFecha(""); setNotas("")
    setNuevoOpen(true)
  }

  function abrirNuevaOT() {
    setOtDescripcion(""); setOtClienteId(null); setOtCantidad("1"); setOtFecha(""); setOtNotas("")
    setOtOps(operaciones.map((o) => o.id))
    setOtOpen(true)
  }

  async function guardar() {
    if (productoId == null) {
      toast({ title: "Elige un producto", variant: "destructive" })
      return
    }
    if (!(Number(cantidad) > 0)) {
      toast({ title: "Cantidad inválida", description: "Indica la cantidad a producir.", variant: "destructive" })
      return
    }
    setSaving(true)
    const res = await createOrden({
      producto_id: productoId,
      cantidad_objetivo: Number(cantidad),
      fecha_objetivo: fecha || null,
      notas: notas || null,
    })
    setSaving(false)
    if (res.error) {
      toast({ title: "Error", description: res.error, variant: "destructive" })
      return
    }
    toast({
      title: "Orden creada",
      description: res.sinReceta
        ? "Este producto aún no tiene receta; defínela en Recetas para poder producir y costear."
        : "Lista para el control de piso.",
      variant: res.sinReceta ? "destructive" : undefined,
    })
    setNuevoOpen(false)
    cargar()
  }

  async function guardarOT() {
    if (!otDescripcion.trim()) {
      toast({ title: "Describe el trabajo", variant: "destructive" })
      return
    }
    setSaving(true)
    const res = await createOrdenTrabajo({
      descripcion: otDescripcion,
      cliente_id: otClienteId,
      cantidad_objetivo: Number(otCantidad) || 1,
      fecha_objetivo: otFecha || null,
      notas: otNotas || null,
      operacion_ids: otOps,
    })
    setSaving(false)
    if (!res.data) {
      toast({ title: "No se pudo crear la orden de trabajo", description: res.error ?? "", variant: "destructive" })
      return
    }
    toast({ title: `${codigoOrden(res.data.id, "Trabajo")} creada`, description: res.error ?? `${res.data.etapas} etapa(s) generadas; síguela en Flujo de Producción.`, variant: res.error ? "destructive" : undefined })
    setOtOpen(false)
    cargar()
  }

  async function cambiarEstado(o: OrdenProduccion, estado: EstadoOrden) {
    const { error } = await setEstadoOrden(o.id, estado)
    if (error) {
      toast({ title: "Error", description: error, variant: "destructive" })
      return
    }
    cargar()
  }

  return (
    <div className="space-y-4 md:space-y-6 p-4 md:p-6">
      <div>
        <h1 className="text-xl md:text-2xl font-bold text-foreground flex items-center gap-2">
          <FileText className="h-6 w-6 text-stone-600" /> Órdenes de Producción
        </h1>
        <p className="text-sm text-muted-foreground">Qué producir (o qué trabajo hacer), cuánto y para cuándo; y prográmalas en el día con el planeador.</p>
      </div>

      <Tabs defaultValue="ordenes" className="space-y-4">
        <TabsList>
          <TabsTrigger value="ordenes" className="gap-1.5"><FileText className="h-4 w-4" /> Órdenes</TabsTrigger>
          <TabsTrigger value="planeador" className="gap-1.5"><CalendarClock className="h-4 w-4" /> Planeador</TabsTrigger>
        </TabsList>

        {/* ── Tab 1: crear/listar órdenes ── */}
        <TabsContent value="ordenes" className="space-y-4">
          <div className="flex flex-wrap justify-between gap-2">
            <Select value={filtroTipo} onValueChange={(v) => setFiltroTipo(v as typeof filtroTipo)}>
              <SelectTrigger className="h-9 w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todas">Todas las órdenes</SelectItem>
                <SelectItem value="Produccion">Solo producción (OP)</SelectItem>
                <SelectItem value="Trabajo">Solo trabajo (OT)</SelectItem>
              </SelectContent>
            </Select>
            <div className="flex gap-2">
              <Button onClick={abrirNuevaOT} size="sm" variant="outline">
                <Wrench className="h-4 w-4 mr-1" /> Nueva orden de trabajo
              </Button>
              <Button onClick={abrirNuevo} size="sm">
                <Plus className="h-4 w-4 mr-1" /> Nueva orden
              </Button>
            </div>
          </div>
          <Card className="rounded-xl border-stone-200">
            <CardHeader className="p-4 md:p-6 pb-3">
              <CardTitle className="text-base md:text-lg">Órdenes</CardTitle>
              <CardDescription className="text-xs md:text-sm">{ordenesFiltradas.length} orden(es). OP = fabrica un producto con receta; OT = trabajo libre (rotulación, servicio, proyecto) con consumo por etapa.</CardDescription>
            </CardHeader>
            <CardContent className="p-4 md:p-6 pt-0">
              {loading ? (
                <div className="flex justify-center py-10"><Spinner className="h-6 w-6" /></div>
              ) : ordenesFiltradas.length === 0 ? (
                <div className="text-center py-10 text-stone-500 text-sm">
                  <FileText className="h-10 w-10 mx-auto mb-2 opacity-40" /> Sin órdenes todavía.
                </div>
              ) : (
                <div className="rounded-lg border border-stone-200 overflow-x-auto">
                  <Table containerClassName="max-h-[60vh] overflow-y-auto">
                    <TableHeader sticky>
                      <TableRow>
                        <TableHead>N° Orden</TableHead>
                        <TableHead>Producto / trabajo</TableHead>
                        <TableHead className="text-right">Cantidad</TableHead>
                        <TableHead>Fecha objetivo</TableHead>
                        <TableHead>Receta</TableHead>
                        <TableHead className="text-right">Costo real</TableHead>
                        <TableHead>Estado</TableHead>
                        <TableHead className="w-40">Cambiar estado</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {ordenesFiltradas.map((o) => (
                        <TableRow key={o.id}>
                          <TableCell className="font-mono text-xs whitespace-nowrap">{codigoOrden(o.id, o.tipo)}</TableCell>
                          <TableCell className="font-medium">
                            <div className="flex items-center gap-2">
                              {o.tipo === "Trabajo" && <Badge variant="outline" className="text-[10px] border-violet-200 bg-violet-50 text-violet-700">OT</Badge>}
                              <span>{etiquetaOrden(o)}</span>
                            </div>
                            {o.cliente_nombre && <p className="text-xs text-muted-foreground">{o.cliente_nombre}</p>}
                          </TableCell>
                          <TableCell className="text-right">{o.cantidad_objetivo}</TableCell>
                          <TableCell className="text-sm">{o.fecha_objetivo || "-"}</TableCell>
                          <TableCell>
                            {o.tipo === "Trabajo" ? (
                              <span className="text-xs text-muted-foreground">Consumo por etapa</span>
                            ) : o.receta_id ? (
                              <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700 text-[10px]">Sí</Badge>
                            ) : (
                              <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-800 text-[10px] gap-1"><AlertTriangle className="h-3 w-3" /> Sin receta</Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-right text-sm">{o.costo_total_real != null ? formatCurrency(o.costo_total_real) : "—"}</TableCell>
                          <TableCell>{estadoBadge(o.estado)}</TableCell>
                          <TableCell>
                            <Select value={o.estado} onValueChange={(v) => cambiarEstado(o, v as EstadoOrden)}>
                              <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                {ESTADOS.map((e) => (<SelectItem key={e} value={e}>{e}</SelectItem>))}
                              </SelectContent>
                            </Select>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Tab 2: planeador (Gantt de un día) ── */}
        <TabsContent value="planeador">
          <PlaneadorProduccion />
        </TabsContent>
      </Tabs>

      {/* Nueva orden de producción */}
      <Dialog open={nuevoOpen} onOpenChange={setNuevoOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Nueva orden de producción</DialogTitle>
            <DialogDescription>Solo aparecen los productos marcados como fabricados.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-1">
            <div className="grid gap-1.5">
              <Label className="text-xs">Producto a fabricar</Label>
              <Popover open={comboOpen} onOpenChange={setComboOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" role="combobox" className="w-full justify-between font-normal">
                    {productoSel ? productoSel.nombre : "Seleccionar producto…"}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                  <Command>
                    <CommandInput placeholder="Buscar producto…" />
                    <CommandList>
                      <CommandEmpty>
                        {productosFabricados.length === 0
                          ? "No hay productos marcados como fabricados. Márcalos en Configuración → Productos."
                          : "Sin resultados."}
                      </CommandEmpty>
                      <CommandGroup>
                        {productosFabricados.map((p) => (
                          <CommandItem key={p.id} value={`${p.nombre} ${p.codigo_barras || ""}`} onSelect={() => { setProductoId(p.id!); setComboOpen(false) }}>
                            <Check className={cn("mr-2 h-4 w-4", productoId === p.id ? "opacity-100" : "opacity-0")} />
                            <span className="flex-1 truncate">{p.nombre}</span>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label className="text-xs">Cantidad a producir</Label>
                <Input type="number" min="0" step="1" value={cantidad} onChange={(e) => setCantidad(e.target.value)} placeholder="0" className="h-10 text-base" />
              </div>
              <div className="grid gap-1.5">
                <Label className="text-xs">Fecha objetivo</Label>
                <Input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className="h-10" />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">Notas / observaciones</Label>
              <Textarea value={notas} onChange={(e) => setNotas(e.target.value)} rows={2} placeholder="Opcional" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNuevoOpen(false)} disabled={saving}>Cancelar</Button>
            <Button onClick={guardar} disabled={saving || productoId == null}>
              {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              Crear orden
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Nueva orden de trabajo */}
      <Dialog open={otOpen} onOpenChange={setOtOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Nueva orden de trabajo</DialogTitle>
            <DialogDescription>Un trabajo sin producto fabricado (rotulación, impresión especial, proyecto). Recorre las etapas que elijas y consume materiales o productos en cada una.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-1">
            <div className="grid gap-1.5">
              <Label className="text-xs">Descripción del trabajo</Label>
              <Textarea value={otDescripcion} onChange={(e) => setOtDescripcion(e.target.value)} rows={2} placeholder="Ej.: Rotulación de local Lettra, 3 rótulos de 2 m" />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">Cliente (opcional)</Label>
              <Popover open={otClienteOpen} onOpenChange={setOtClienteOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" role="combobox" className="w-full justify-between font-normal">
                    <span className="truncate">{otCliente ? otCliente.nombre : "Sin cliente"}</span>
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                  <Command>
                    <CommandInput placeholder="Buscar cliente…" />
                    <CommandList>
                      <CommandEmpty>Sin resultados.</CommandEmpty>
                      <CommandGroup>
                        <CommandItem value="__none__" onSelect={() => { setOtClienteId(null); setOtClienteOpen(false) }}>
                          <Check className={cn("mr-2 h-4 w-4", otClienteId == null ? "opacity-100" : "opacity-0")} /> Sin cliente
                        </CommandItem>
                        {clientes.map((c) => (
                          <CommandItem key={c.id} value={`${c.nombre} ${c.rtn || ""}`} onSelect={() => { setOtClienteId(c.id!); setOtClienteOpen(false) }}>
                            <Check className={cn("mr-2 h-4 w-4", otClienteId === c.id ? "opacity-100" : "opacity-0")} />
                            <span className="flex-1 truncate">{c.nombre}</span>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label className="text-xs">Cantidad (unidades del trabajo)</Label>
                <Input type="number" min="1" step="1" value={otCantidad} onChange={(e) => setOtCantidad(e.target.value)} className="h-10" />
              </div>
              <div className="grid gap-1.5">
                <Label className="text-xs">Fecha compromiso</Label>
                <Input type="date" value={otFecha} onChange={(e) => setOtFecha(e.target.value)} className="h-10" />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">Etapas (operaciones) que recorre</Label>
              {operaciones.length === 0 ? (
                <p className="text-xs text-amber-700">No hay operaciones activas: defínelas en Operaciones de Producción o la OT se creará sin etapas.</p>
              ) : (
                <div className="grid gap-1.5 sm:grid-cols-2">
                  {operaciones.map((op) => (
                    <label key={op.id} className="flex items-center gap-2 text-sm">
                      <Checkbox checked={otOps.includes(op.id)} onCheckedChange={(v) => setOtOps((prev) => (v === true ? [...prev, op.id] : prev.filter((x) => x !== op.id)))} />
                      {op.orden_secuencia}. {op.nombre}
                    </label>
                  ))}
                </div>
              )}
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">Notas</Label>
              <Textarea value={otNotas} onChange={(e) => setOtNotas(e.target.value)} rows={2} placeholder="Opcional" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOtOpen(false)} disabled={saving}>Cancelar</Button>
            <Button onClick={guardarOT} disabled={saving || !otDescripcion.trim()}>
              {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              Crear orden de trabajo
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
