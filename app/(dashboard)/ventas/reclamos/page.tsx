"use client"

import { useState, useEffect, useMemo } from "react"
import { MessageSquareWarning, Plus, Loader2, CheckCircle2, XCircle, RotateCcw, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Spinner } from "@/components/ui/spinner"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover"
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command"
import { useToast } from "@/hooks/use-toast"
import { useTenant } from "@/lib/hooks/use-tenant"
import {
  getReclamos, crearReclamo, resolverReclamo, reabrirReclamo,
  RECLAMOS_FEATURE_PENDING, type Reclamo, type TipoReclamo, type ResultadoReclamo,
} from "@/lib/services/reclamos"
import { getVentas, type VentaEncabezado } from "@/lib/services/ventas"
import { formatCurrency } from "@/lib/utils/format"
import { formatHondurasDate } from "@/lib/utils/honduras-time"

const TIPOS: TipoReclamo[] = ["Producto", "Precio", "Entrega", "Otro"]

export default function ReclamosPage() {
  const { toast } = useToast()
  const { ready, razonSocialId } = useTenant()

  const [loading, setLoading] = useState(true)
  const [pendiente, setPendiente] = useState(false)
  const [reclamos, setReclamos] = useState<Reclamo[]>([])
  const [filtroEstado, setFiltroEstado] = useState<"todos" | "Abierto" | "Resuelto" | "Rechazado">("Abierto")
  const [busqueda, setBusqueda] = useState("")

  // Nuevo reclamo
  const [nuevoOpen, setNuevoOpen] = useState(false)
  const [ventas, setVentas] = useState<VentaEncabezado[]>([])
  const [ventaComboOpen, setVentaComboOpen] = useState(false)
  const [ventaId, setVentaId] = useState<number | null>(null)
  const [tipo, setTipo] = useState<TipoReclamo>("Producto")
  const [descripcion, setDescripcion] = useState("")
  const [guardando, setGuardando] = useState(false)

  // Resolver
  const [resolviendo, setResolviendo] = useState<Reclamo | null>(null)
  const [resEstado, setResEstado] = useState<"Resuelto" | "Rechazado">("Resuelto")
  const [resResultado, setResResultado] = useState<ResultadoReclamo>("Sin cambio")
  const [resolucion, setResolucion] = useState("")
  const [resGuardando, setResGuardando] = useState(false)

  useEffect(() => {
    if (!ready || razonSocialId == null) return
    cargar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, razonSocialId, filtroEstado])

  async function cargar() {
    setLoading(true)
    const { data, error } = await getReclamos({ estado: filtroEstado })
    if (error === RECLAMOS_FEATURE_PENDING) setPendiente(true)
    else if (error) toast({ title: "No se pudieron cargar los reclamos", description: error, variant: "destructive" })
    setReclamos(data)
    setLoading(false)
  }

  async function abrirNuevo() {
    setVentaId(null)
    setTipo("Producto")
    setDescripcion("")
    setNuevoOpen(true)
    if (ventas.length === 0) {
      const { data } = await getVentas({ soloVigentes: true })
      setVentas(data)
    }
  }

  const ventaSel = useMemo(() => ventas.find((v) => v.id === ventaId) || null, [ventas, ventaId])

  async function guardarNuevo() {
    if (!ventaId) {
      toast({ title: "Elige la factura", variant: "destructive" })
      return
    }
    if (!descripcion.trim()) {
      toast({ title: "Describe el reclamo", variant: "destructive" })
      return
    }
    setGuardando(true)
    const { error } = await crearReclamo({ venta_id: ventaId, cliente_id: ventaSel?.cliente_id ?? null, tipo, descripcion })
    setGuardando(false)
    if (error) {
      toast({ title: "Error", description: error, variant: "destructive" })
      return
    }
    toast({ title: "Reclamo registrado", description: `Factura ${ventaSel?.numero_factura || ventaId}` })
    setNuevoOpen(false)
    cargar()
  }

  function abrirResolver(r: Reclamo) {
    setResolviendo(r)
    setResEstado("Resuelto")
    setResResultado("Sin cambio")
    setResolucion("")
  }

  async function guardarResolucion() {
    if (!resolviendo) return
    if (!resolucion.trim()) {
      toast({ title: "Escribe la resolución", variant: "destructive" })
      return
    }
    setResGuardando(true)
    const { error } = await resolverReclamo(resolviendo.id, {
      estado: resEstado,
      resolucion,
      resultado: resEstado === "Resuelto" ? resResultado : "Sin cambio",
    })
    setResGuardando(false)
    if (error) {
      toast({ title: "Error", description: error, variant: "destructive" })
      return
    }
    toast({ title: resEstado === "Resuelto" ? "Reclamo resuelto" : "Reclamo rechazado" })
    setResolviendo(null)
    cargar()
  }

  async function reabrir(r: Reclamo) {
    const { error } = await reabrirReclamo(r.id)
    if (error) toast({ title: "Error", description: error, variant: "destructive" })
    else cargar()
  }

  const filas = useMemo(() => {
    const b = busqueda.trim().toLowerCase()
    if (!b) return reclamos
    return reclamos.filter((r) =>
      `${r.numero_factura || ""} ${r.cliente_nombre || ""} ${r.descripcion} ${r.tipo}`.toLowerCase().includes(b)
    )
  }, [reclamos, busqueda])

  function estadoBadge(estado: string) {
    if (estado === "Resuelto") return <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">Resuelto</Badge>
    if (estado === "Rechazado") return <Badge variant="outline" className="border-stone-300 bg-stone-100 text-stone-600">Rechazado</Badge>
    return <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-800">Abierto</Badge>
  }

  return (
    <div className="space-y-4 md:space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-amber-100 p-2 text-amber-700">
            <MessageSquareWarning className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold text-stone-800">Reclamos de Ventas</h1>
            <p className="text-sm text-muted-foreground">Reclamos del cliente sobre una factura y su resolución.</p>
          </div>
        </div>
        <Button onClick={abrirNuevo} size="sm" disabled={pendiente}>
          <Plus className="h-4 w-4 mr-1" /> Nuevo Reclamo
        </Button>
      </div>

      {pendiente && (
        <Card className="border-amber-200 bg-amber-50">
          <CardContent className="p-4 text-sm text-amber-800">{RECLAMOS_FEATURE_PENDING}</CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="p-4 md:p-6 pb-3 md:pb-4">
          <div className="flex flex-col md:flex-row md:items-center gap-3 justify-between">
            <div>
              <CardTitle className="text-base md:text-lg">Reclamos</CardTitle>
              <CardDescription className="text-xs md:text-sm">{filas.length} registro{filas.length === 1 ? "" : "s"}</CardDescription>
            </div>
            <div className="flex gap-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input className="pl-8 w-56" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Factura, cliente…" />
              </div>
              <Select value={filtroEstado} onValueChange={(v) => setFiltroEstado(v as typeof filtroEstado)}>
                <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Abierto">Abiertos</SelectItem>
                  <SelectItem value="Resuelto">Resueltos</SelectItem>
                  <SelectItem value="Rechazado">Rechazados</SelectItem>
                  <SelectItem value="todos">Todos</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-4 md:p-6 pt-0">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : filas.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <MessageSquareWarning className="h-10 w-10 mx-auto mb-2 opacity-50" />
              <p className="text-sm">Sin reclamos {filtroEstado === "todos" ? "" : filtroEstado.toLowerCase() + "s"}</p>
            </div>
          ) : (
            <Table containerClassName="max-h-[60vh] overflow-y-auto">
              <TableHeader sticky>
                <TableRow>
                  <TableHead className="whitespace-nowrap">Fecha</TableHead>
                  <TableHead>Factura</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Descripción</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Resolución</TableHead>
                  <TableHead className="w-24"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filas.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="whitespace-nowrap text-sm">{formatHondurasDate(r.created_at)}</TableCell>
                    <TableCell className="font-mono text-sm">{r.numero_factura || `#${r.venta_id}`}</TableCell>
                    <TableCell className="text-sm">{r.cliente_nombre || "—"}</TableCell>
                    <TableCell className="text-sm">{r.tipo}</TableCell>
                    <TableCell className="text-sm max-w-sm truncate" title={r.descripcion}>{r.descripcion}</TableCell>
                    <TableCell>{estadoBadge(r.estado)}</TableCell>
                    <TableCell className="text-sm max-w-sm truncate" title={r.resolucion || ""}>
                      {r.resolucion ? `${r.resultado ? `[${r.resultado}] ` : ""}${r.resolucion}` : "—"}
                    </TableCell>
                    <TableCell>
                      {r.estado === "Abierto" ? (
                        <Button variant="outline" size="sm" onClick={() => abrirResolver(r)}>Resolver</Button>
                      ) : (
                        <Button variant="ghost" size="icon" className="h-8 w-8" title="Reabrir" onClick={() => reabrir(r)}>
                          <RotateCcw className="h-4 w-4" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Nuevo reclamo */}
      <Dialog open={nuevoOpen} onOpenChange={setNuevoOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nuevo Reclamo</DialogTitle>
            <DialogDescription>Registra el reclamo del cliente sobre una factura vigente.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label>Factura <span className="text-destructive">*</span></Label>
              <Popover open={ventaComboOpen} onOpenChange={setVentaComboOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" role="combobox" className="justify-between font-normal">
                    <span className="truncate">
                      {ventaSel ? `${ventaSel.numero_factura} · ${ventaSel.cliente_nombre || ""} · ${formatCurrency(ventaSel.total_venta)}` : "Buscar factura…"}
                    </span>
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
                  <Command>
                    <CommandInput placeholder="Número de factura o cliente…" />
                    <CommandList className="max-h-72">
                      <CommandEmpty>{ventas.length === 0 ? "Cargando facturas…" : "Sin resultados"}</CommandEmpty>
                      <CommandGroup>
                        {ventas.slice(0, 500).map((v) => (
                          <CommandItem
                            key={v.id}
                            value={`${v.numero_factura} ${v.cliente_nombre || ""}`}
                            onSelect={() => { setVentaId(v.id!); setVentaComboOpen(false) }}
                            className="cursor-pointer"
                          >
                            <div className="min-w-0 flex-1">
                              <p className="truncate"><span className="font-mono">{v.numero_factura}</span> · {v.cliente_nombre}</p>
                              <p className="text-xs text-muted-foreground">{v.fecha_venta?.split("T")[0]} · {formatCurrency(v.total_venta)}</p>
                            </div>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>
            <div className="grid gap-2">
              <Label>Tipo</Label>
              <Select value={tipo} onValueChange={(v) => setTipo(v as TipoReclamo)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TIPOS.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Descripción <span className="text-destructive">*</span></Label>
              <Textarea rows={3} value={descripcion} onChange={(e) => setDescripcion(e.target.value)} placeholder="¿Qué reclama el cliente?" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNuevoOpen(false)}>Cancelar</Button>
            <Button onClick={guardarNuevo} disabled={guardando}>
              {guardando && <Spinner className="mr-2 h-4 w-4" />}
              Registrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Resolver */}
      <Dialog open={resolviendo !== null} onOpenChange={(o) => { if (!o) setResolviendo(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Resolver reclamo</DialogTitle>
            <DialogDescription>
              {resolviendo ? `Factura ${resolviendo.numero_factura || resolviendo.venta_id} · ${resolviendo.cliente_nombre || ""}` : ""}
            </DialogDescription>
          </DialogHeader>
          {resolviendo && (
            <div className="grid gap-4 py-2">
              <p className="text-sm rounded-lg bg-stone-50 border border-stone-200 p-3">{resolviendo.descripcion}</p>
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label>Decisión</Label>
                  <Select value={resEstado} onValueChange={(v) => setResEstado(v as "Resuelto" | "Rechazado")}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Resuelto">Procede (resuelto)</SelectItem>
                      <SelectItem value="Rechazado">No procede (rechazado)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {resEstado === "Resuelto" && (
                  <div className="grid gap-2">
                    <Label>Qué se hizo</Label>
                    <Select value={resResultado} onValueChange={(v) => setResResultado(v as ResultadoReclamo)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Sin cambio">Sin cambio (solo atención)</SelectItem>
                        <SelectItem value="Devolucion">Devolución / nota de crédito</SelectItem>
                        <SelectItem value="Anulacion">Anulación de la factura</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
              <div className="grid gap-2">
                <Label>Resolución <span className="text-destructive">*</span></Label>
                <Textarea rows={3} value={resolucion} onChange={(e) => setResolucion(e.target.value)} placeholder="Qué se acordó con el cliente" />
              </div>
              {resEstado === "Resuelto" && resResultado !== "Sin cambio" && (
                <p className="text-xs text-muted-foreground">
                  La {resResultado === "Anulacion" ? "anulación se hace desde Historial de Ventas (botón Anular)" : "devolución se registra en Ventas → Devoluciones"}; aquí solo queda documentada.
                </p>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setResolviendo(null)}>Cancelar</Button>
            <Button onClick={guardarResolucion} disabled={resGuardando} className={resEstado === "Rechazado" ? "bg-stone-700 hover:bg-stone-800" : undefined}>
              {resGuardando && <Spinner className="mr-2 h-4 w-4" />}
              {resEstado === "Resuelto" ? <><CheckCircle2 className="h-4 w-4 mr-1" /> Resolver</> : <><XCircle className="h-4 w-4 mr-1" /> Rechazar</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
