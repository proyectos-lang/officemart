"use client"

import * as React from "react"
import { Loader2, Plus, Trash2, Check, ChevronsUpDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { useToast } from "@/hooks/use-toast"
import { formatCurrency, formatNumber } from "@/lib/utils/format"
import { getMateriales, type Material } from "@/lib/services/produccion-materiales"
import { getProductos, getAlmacenes, getLocalizaciones, type Producto, type Almacen, type Localizacion } from "@/lib/services/catalogos"
import { registrarConsumoEtapa, calcularCostoConsumos, type ConsumoItemInput } from "@/lib/services/produccion-consumos"

type Linea = ConsumoItemInput & { _key: string; nombre: string; stock: number; costo: number; unidad?: string }

/**
 * Diálogo "Consumo" de una etapa (officemart-010): materiales y/o productos
 * que se usan en esa etapa. Descuenta stock y suma al costo real de la orden.
 */
export function ConsumoEtapaDialog({
  open,
  onOpenChange,
  ordenId,
  etapaId,
  etapaNombre,
  onDone,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  ordenId: number
  etapaId: number | null
  etapaNombre?: string | null
  onDone?: () => void
}) {
  const { toast } = useToast()
  const [materiales, setMateriales] = React.useState<Material[]>([])
  const [productos, setProductos] = React.useState<Producto[]>([])
  const [almacenes, setAlmacenes] = React.useState<Almacen[]>([])
  const [localizaciones, setLocalizaciones] = React.useState<Localizacion[]>([])
  const [lineas, setLineas] = React.useState<Linea[]>([])
  const [notas, setNotas] = React.useState("")
  const [saving, setSaving] = React.useState(false)
  const [matOpen, setMatOpen] = React.useState(false)
  const [prodOpen, setProdOpen] = React.useState(false)
  const [almacenId, setAlmacenId] = React.useState("")
  const [localizacionId, setLocalizacionId] = React.useState("")

  React.useEffect(() => {
    if (!open) return
    setLineas([])
    setNotas("")
    Promise.all([getMateriales({ soloActivos: true }), getProductos(), getAlmacenes(), getLocalizaciones()]).then(([m, p, a, l]) => {
      setMateriales(m.data || [])
      setProductos(p.data || [])
      setAlmacenes(a.data || [])
      setLocalizaciones(l.data || [])
      if ((a.data || []).length === 1) setAlmacenId(String(a.data![0].id))
    })
  }, [open])

  const locsFiltradas = React.useMemo(() => localizaciones.filter((l) => String(l.almacen_id) === almacenId), [localizaciones, almacenId])
  React.useEffect(() => {
    if (locsFiltradas.length === 1) setLocalizacionId(String(locsFiltradas[0].id))
    else setLocalizacionId("")
  }, [locsFiltradas])

  function agregarMaterial(m: Material) {
    setLineas((prev) => {
      if (prev.some((l) => l.tipo_item === "material" && l.material_id === m.id)) return prev
      return [...prev, { _key: `m-${m.id}`, tipo_item: "material", material_id: m.id!, cantidad: 1, nombre: m.nombre, stock: m.stock_total, costo: m.costo_promedio, unidad: m.unidad_medida }]
    })
    setMatOpen(false)
  }

  function agregarProducto(p: Producto) {
    if (!almacenId || !localizacionId) {
      toast({ title: "Elige almacén y localización", description: "De dónde sale el producto.", variant: "destructive" })
      return
    }
    setLineas((prev) => {
      if (prev.some((l) => l.tipo_item === "producto" && l.producto_id === p.id)) return prev
      return [...prev, { _key: `p-${p.id}`, tipo_item: "producto", producto_id: p.id!, cantidad: 1, almacen_id: Number(almacenId), localizacion_id: Number(localizacionId), nombre: p.nombre, stock: p.stock_total || 0, costo: p.costo_promedio || 0 }]
    })
    setProdOpen(false)
  }

  const costo = calcularCostoConsumos(lineas.map((l) => ({ cantidad: l.cantidad, costo_unitario: l.costo })))

  async function guardar() {
    if (lineas.length === 0) {
      toast({ title: "Agrega al menos un material o producto", variant: "destructive" })
      return
    }
    setSaving(true)
    const { data, error } = await registrarConsumoEtapa({
      orden_id: ordenId,
      etapa_id: etapaId,
      items: lineas.map(({ _key: _k, nombre: _n, stock: _s, costo: _c, unidad: _u, ...l }) => ({ ...l, notas: notas || null })),
    })
    setSaving(false)
    if (error || !data) {
      toast({ title: "No se pudo registrar el consumo", description: error ?? "", variant: "destructive" })
      return
    }
    toast({ title: "Consumo registrado", description: `${data.ids.length} línea(s) · ${formatCurrency(data.total)} al costo de la orden.` })
    onOpenChange(false)
    onDone?.()
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!saving) onOpenChange(o) }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Consumo {etapaNombre ? `· ${etapaNombre}` : "de la orden"}</DialogTitle>
          <DialogDescription>Materiales y productos usados en esta etapa. Se descuentan del inventario al costo promedio actual y suman al costo real de la orden.</DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="material">
          <TabsList>
            <TabsTrigger value="material">Material</TabsTrigger>
            <TabsTrigger value="producto">Producto</TabsTrigger>
          </TabsList>
          <TabsContent value="material" className="pt-2">
            <Popover open={matOpen} onOpenChange={setMatOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" className="w-full justify-between font-normal"><span>Agregar material…</span><ChevronsUpDown className="h-4 w-4 opacity-50" /></Button>
              </PopoverTrigger>
              <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                <Command>
                  <CommandInput placeholder="Buscar material…" />
                  <CommandList>
                    <CommandEmpty>Sin materiales.</CommandEmpty>
                    <CommandGroup>
                      {materiales.map((m) => (
                        <CommandItem key={m.id} value={`${m.nombre} ${m.codigo || ""}`} onSelect={() => agregarMaterial(m)}>
                          <Check className={`mr-2 h-4 w-4 ${lineas.some((l) => l.material_id === m.id) ? "opacity-100" : "opacity-0"}`} />
                          <span className="flex-1 truncate">{m.nombre}</span>
                          <span className="text-xs text-muted-foreground">{formatNumber(m.stock_total)} {m.unidad_medida}</span>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </TabsContent>
          <TabsContent value="producto" className="pt-2 space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <div className="grid gap-1">
                <Label className="text-xs">Almacén</Label>
                <Select value={almacenId} onValueChange={setAlmacenId}>
                  <SelectTrigger className="h-9"><SelectValue placeholder="Almacén" /></SelectTrigger>
                  <SelectContent>{almacenes.map((a) => <SelectItem key={a.id} value={String(a.id)}>{a.nombre}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="grid gap-1">
                <Label className="text-xs">Localización</Label>
                <Select value={localizacionId} onValueChange={setLocalizacionId} disabled={!almacenId}>
                  <SelectTrigger className="h-9"><SelectValue placeholder="Localización" /></SelectTrigger>
                  <SelectContent>{locsFiltradas.map((l) => <SelectItem key={l.id} value={String(l.id)}>{l.nombre}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <Popover open={prodOpen} onOpenChange={setProdOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" className="w-full justify-between font-normal"><span>Agregar producto…</span><ChevronsUpDown className="h-4 w-4 opacity-50" /></Button>
              </PopoverTrigger>
              <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                <Command>
                  <CommandInput placeholder="Buscar producto…" />
                  <CommandList>
                    <CommandEmpty>Sin resultados.</CommandEmpty>
                    <CommandGroup>
                      {productos.slice(0, 300).map((p) => (
                        <CommandItem key={p.id} value={`${p.nombre} ${p.codigo_barras || ""}`} onSelect={() => agregarProducto(p)}>
                          <Check className={`mr-2 h-4 w-4 ${lineas.some((l) => l.producto_id === p.id) ? "opacity-100" : "opacity-0"}`} />
                          <span className="flex-1 truncate">{p.nombre}</span>
                          <span className="text-xs text-muted-foreground">stock {formatNumber(p.stock_total || 0)}</span>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </TabsContent>
        </Tabs>

        {lineas.length > 0 && (
          <div className="border rounded-lg divide-y">
            {lineas.map((l, i) => (
              <div key={l._key} className="flex items-center gap-2 p-2 text-sm">
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{l.nombre}</p>
                  <p className="text-xs text-muted-foreground">{l.tipo_item} · stock {formatNumber(l.stock)}{l.unidad ? ` ${l.unidad}` : ""} · {formatCurrency(l.costo)} c/u</p>
                </div>
                <Input type="number" min="0" step="any" value={l.cantidad} onChange={(e) => setLineas((prev) => prev.map((x, j) => (j === i ? { ...x, cantidad: Number(e.target.value) || 0 } : x)))} className={`h-8 w-24 text-right ${l.cantidad > l.stock ? "border-destructive" : ""}`} />
                <span className="w-24 text-right font-medium">{formatCurrency(costo.lineas[i]?.costo_total || 0)}</span>
                <Button variant="ghost" size="icon" className="h-8 w-8 text-red-600" onClick={() => setLineas((prev) => prev.filter((x) => x._key !== l._key))}><Trash2 className="h-4 w-4" /></Button>
              </div>
            ))}
            <div className="flex justify-between p-2 text-sm font-semibold"><span>Total al costo</span><span>{formatCurrency(costo.total)}</span></div>
          </div>
        )}
        <div className="grid gap-1.5">
          <Label className="text-xs">Notas (opcional)</Label>
          <Textarea rows={2} value={notas} onChange={(e) => setNotas(e.target.value)} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancelar</Button>
          <Button onClick={guardar} disabled={saving || lineas.length === 0} className="gap-1">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Registrar consumo</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
