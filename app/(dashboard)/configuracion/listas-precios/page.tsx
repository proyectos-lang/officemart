"use client"

import * as React from "react"
import { Tags, Plus, Trash2, Pencil, Loader2, Search, Percent, ListChecks, Layers } from "lucide-react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { useToast } from "@/hooks/use-toast"
import { formatCurrency } from "@/lib/utils/format"
import {
  getProductos, getCategorias, getSubcategorias, getLineasProducto,
  type Producto, type Categoria, type Subcategoria, type LineaProducto,
} from "@/lib/services/catalogos"
import {
  getListasPrecios, crearListaPrecio, actualizarListaPrecio, eliminarListaPrecio,
  getDetalleLista, setPrecioProducto, getReglasLista, setReglaLista,
  REGLAS_FEATURE_PENDING,
  type ListaPrecio, type TipoLista, type DimensionRegla,
} from "@/lib/services/listas-precios"

export default function ListasPreciosPage() {
  const { toast } = useToast()
  const [listas, setListas] = React.useState<ListaPrecio[]>([])
  const [loading, setLoading] = React.useState(true)

  // Crear / editar cabecera
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [editId, setEditId] = React.useState<number | null>(null)
  const [nombre, setNombre] = React.useState("")
  const [tipo, setTipo] = React.useState<TipoLista>("porcentaje")
  const [porcentaje, setPorcentaje] = React.useState("0")
  const [guardando, setGuardando] = React.useState(false)

  // Editor de precios individuales
  const [preciosOpen, setPreciosOpen] = React.useState(false)
  const [listaSel, setListaSel] = React.useState<ListaPrecio | null>(null)
  const [productos, setProductos] = React.useState<Producto[]>([])
  const [detalle, setDetalle] = React.useState<Record<number, string>>({})
  const [busqueda, setBusqueda] = React.useState("")
  const [cargandoPrecios, setCargandoPrecios] = React.useState(false)

  const [borrar, setBorrar] = React.useState<ListaPrecio | null>(null)

  // Editor de reglas por categoría / subcategoría / línea (officemart-005)
  const [reglasOpen, setReglasOpen] = React.useState(false)
  const [reglasLista, setReglasLista] = React.useState<ListaPrecio | null>(null)
  const [reglasPendiente, setReglasPendiente] = React.useState(false)
  const [cargandoReglas, setCargandoReglas] = React.useState(false)
  const [categorias, setCategorias] = React.useState<Categoria[]>([])
  const [subcategorias, setSubcategorias] = React.useState<Subcategoria[]>([])
  const [lineasProd, setLineasProd] = React.useState<LineaProducto[]>([])
  // Clave "dimension:id" -> porcentaje como texto ("" = sin regla).
  const [reglas, setReglas] = React.useState<Record<string, string>>({})

  async function abrirReglas(l: ListaPrecio) {
    setReglasLista(l)
    setReglasOpen(true)
    setCargandoReglas(true)
    const [rRes, cRes, sRes, lRes] = await Promise.all([
      getReglasLista(l.id),
      getCategorias(),
      getSubcategorias(),
      getLineasProducto({ soloActivas: true }),
    ])
    setReglasPendiente(rRes.pendiente)
    if (rRes.error) toast({ title: "Error", description: rRes.error, variant: "destructive" })
    setCategorias(cRes.data || [])
    setSubcategorias(sRes.data || [])
    setLineasProd(lRes.data || [])
    const map: Record<string, string> = {}
    for (const r of rRes.data) map[`${r.dimension}:${r.ref_id}`] = String(r.porcentaje)
    setReglas(map)
    setCargandoReglas(false)
  }

  async function guardarRegla(dimension: DimensionRegla, refId: number, valor: string) {
    if (!reglasLista) return
    const key = `${dimension}:${refId}`
    setReglas((prev) => ({ ...prev, [key]: valor }))
    const num = valor.trim() === "" ? null : Number(valor)
    const res = await setReglaLista(reglasLista.id, dimension, refId, num != null && Number.isNaN(num) ? null : num)
    if (res.error) toast({ title: "Error", description: res.error, variant: "destructive" })
  }

  const categoriaNombre = React.useMemo(
    () => new Map(categorias.map((c) => [c.id, c.nombre])),
    [categorias]
  )

  const cargar = React.useCallback(async () => {
    setLoading(true)
    const r = await getListasPrecios()
    if (r.error) toast({ title: "Aviso", description: r.error, variant: "destructive" })
    setListas(r.data)
    setLoading(false)
  }, [toast])

  React.useEffect(() => { cargar() }, [cargar])

  function abrirNueva() {
    setEditId(null); setNombre(""); setTipo("porcentaje"); setPorcentaje("0"); setDialogOpen(true)
  }
  function abrirEditar(l: ListaPrecio) {
    setEditId(l.id); setNombre(l.nombre); setTipo(l.tipo); setPorcentaje(String(l.porcentaje ?? 0)); setDialogOpen(true)
  }

  async function guardar() {
    if (!nombre.trim()) {
      toast({ title: "Falta el nombre", variant: "destructive" }); return
    }
    setGuardando(true)
    if (editId == null) {
      const res = await crearListaPrecio({ nombre, tipo, porcentaje: Number(porcentaje) || 0 })
      setGuardando(false)
      if (res.error) { toast({ title: "Error", description: res.error, variant: "destructive" }); return }
      toast({ title: "Lista creada", description: nombre.trim() })
    } else {
      const res = await actualizarListaPrecio(editId, { nombre, porcentaje: Number(porcentaje) || 0 })
      setGuardando(false)
      if (res.error) { toast({ title: "Error", description: res.error, variant: "destructive" }); return }
      toast({ title: "Lista actualizada" })
    }
    setDialogOpen(false)
    cargar()
  }

  async function confirmarBorrar() {
    if (!borrar) return
    const res = await eliminarListaPrecio(borrar.id)
    setBorrar(null)
    if (res.error) { toast({ title: "Error", description: res.error, variant: "destructive" }); return }
    toast({ title: "Lista eliminada" })
    cargar()
  }

  async function abrirPrecios(l: ListaPrecio) {
    setListaSel(l)
    setPreciosOpen(true)
    setBusqueda("")
    setCargandoPrecios(true)
    const [prodRes, detRes] = await Promise.all([getProductos(), getDetalleLista(l.id)])
    setProductos(prodRes.data || [])
    const map: Record<number, string> = {}
    for (const [pid, precio] of Object.entries(detRes.data || {})) map[Number(pid)] = String(precio)
    setDetalle(map)
    setCargandoPrecios(false)
  }

  async function guardarPrecio(p: Producto, valor: string) {
    if (!listaSel || p.id == null) return
    setDetalle((prev) => ({ ...prev, [p.id!]: valor }))
    const num = valor.trim() === "" ? null : Number(valor)
    const res = await setPrecioProducto(listaSel.id, p.id, num != null && Number.isNaN(num) ? null : num)
    if (res.error) toast({ title: "Error", description: res.error, variant: "destructive" })
  }

  const productosFiltrados = React.useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    if (!q) return productos.slice(0, 300)
    return productos
      .filter((p) => (p.nombre || "").toLowerCase().includes(q) || (p.codigo_barras || "").toLowerCase().includes(q))
      .slice(0, 300)
  }, [productos, busqueda])

  return (
    <div className="space-y-4 md:space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-bold flex items-center gap-2">
            <Tags className="h-6 w-6 text-primary" /> Listas de Precios
          </h1>
          <p className="text-sm text-muted-foreground">
            Crea listas por porcentaje (aplican a todo el catálogo) o individuales (precio por producto),
            con reglas por categoría, subcategoría o línea. Luego asígnalas a tus clientes.
          </p>
        </div>
        <Button onClick={abrirNueva} size="sm"><Plus className="h-4 w-4 mr-1" /> Nueva lista</Button>
      </div>

      <Card className="rounded-2xl border-stone-200 shadow-sm">
        <CardHeader className="p-4 md:p-6">
          <CardTitle className="text-lg">Listas ({listas.length})</CardTitle>
          <CardDescription>El porcentaje se aplica como DESCUENTO sobre el precio del maestro.</CardDescription>
        </CardHeader>
        <CardContent className="p-4 md:p-6 pt-0">
          {loading ? (
            <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-stone-400" /></div>
          ) : listas.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Aún no hay listas de precios.</p>
          ) : (
            <div className="overflow-x-auto border rounded-lg">
              <Table>
                <TableHeader>
                  <TableRow className="bg-stone-50">
                    <TableHead className="font-semibold">Nombre</TableHead>
                    <TableHead className="font-semibold">Tipo</TableHead>
                    <TableHead className="font-semibold text-right">Ajuste</TableHead>
                    <TableHead className="w-32" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {listas.map((l) => (
                    <TableRow key={l.id}>
                      <TableCell className="font-medium">{l.nombre}</TableCell>
                      <TableCell>
                        {l.tipo === "porcentaje" ? (
                          <Badge variant="outline" className="gap-1"><Percent className="h-3 w-3" /> Porcentaje</Badge>
                        ) : (
                          <Badge variant="outline" className="gap-1"><ListChecks className="h-3 w-3" /> Individual</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {l.tipo === "porcentaje" ? `-${Math.abs(l.porcentaje)}% desc.` : "—"}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-1">
                          {l.tipo === "individual" && (
                            <Button size="sm" variant="ghost" className="h-8 gap-1" onClick={() => abrirPrecios(l)} title="Editar precios por producto">
                              <ListChecks className="h-4 w-4" />
                            </Button>
                          )}
                          <Button size="sm" variant="ghost" className="h-8 gap-1" onClick={() => abrirReglas(l)} title="Reglas por categoría / línea">
                            <Layers className="h-4 w-4" />
                          </Button>
                          <Button size="sm" variant="ghost" className="h-8" onClick={() => abrirEditar(l)} title="Editar">
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button size="sm" variant="ghost" className="h-8 text-red-600 hover:text-red-700 hover:bg-red-50" onClick={() => setBorrar(l)} title="Eliminar">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Crear / editar cabecera */}
      <Dialog open={dialogOpen} onOpenChange={(o) => { if (!guardando) setDialogOpen(o) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editId == null ? "Nueva lista de precios" : "Editar lista"}</DialogTitle>
            <DialogDescription>El tipo no se cambia después de crear la lista.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid gap-1.5">
              <Label>Nombre</Label>
              <Input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej. Mayoristas, VIP" />
            </div>
            <div className="grid gap-1.5">
              <Label>Tipo</Label>
              <Select value={tipo} onValueChange={(v) => setTipo(v as TipoLista)} disabled={editId != null}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="porcentaje">Porcentaje general (aplica a todo el catálogo)</SelectItem>
                  <SelectItem value="individual">Individual (precio por producto)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {tipo === "porcentaje" && (
              <div className="grid gap-1.5">
                <Label>Porcentaje de descuento (%)</Label>
                <Input type="number" step="any" min="0" value={porcentaje} onChange={(e) => setPorcentaje(e.target.value)} placeholder="Ej. 5 = 5% de descuento" />
                <p className="text-xs text-muted-foreground">Siempre baja el precio del maestro. Ej.: 5 → 5% menos.</p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={guardando}>Cancelar</Button>
            <Button onClick={guardar} disabled={guardando} className="gap-2">
              {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              {editId == null ? "Crear" : "Guardar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Editor de precios individuales */}
      <Dialog open={preciosOpen} onOpenChange={setPreciosOpen}>
        <DialogContent className="max-w-4xl w-[95vw] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Precios · {listaSel?.nombre}</DialogTitle>
            <DialogDescription>
              Escribe el precio para cada producto. Déjalo vacío para usar el precio del maestro.
            </DialogDescription>
          </DialogHeader>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Buscar por nombre o código…" className="pl-9" />
          </div>
          {cargandoPrecios ? (
            <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-stone-400" /></div>
          ) : (
            <div className="overflow-x-auto border rounded-lg">
              <Table containerClassName="max-h-[55vh] overflow-y-auto">
                <TableHeader sticky>
                  <TableRow className="bg-stone-50">
                    <TableHead className="font-semibold">Producto</TableHead>
                    <TableHead className="font-semibold text-right">Precio base</TableHead>
                    <TableHead className="font-semibold text-right w-36">Precio lista</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {productosFiltrados.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell>
                        <p className="font-medium text-sm">{p.nombre}</p>
                        <p className="text-xs text-muted-foreground font-mono">{p.codigo_barras || "—"}</p>
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {formatCurrency(p.precio_venta_sugerido ?? 0)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Input
                          type="number"
                          step="any"
                          className="h-8 w-32 text-right"
                          placeholder={String((p.precio_venta_sugerido ?? 0))}
                          value={detalle[p.id!] ?? ""}
                          onChange={(e) => setDetalle((prev) => ({ ...prev, [p.id!]: e.target.value }))}
                          onBlur={(e) => guardarPrecio(p, e.target.value)}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setPreciosOpen(false)}>Listo</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reglas por categoría / subcategoría / línea (officemart-005) */}
      <Dialog open={reglasOpen} onOpenChange={setReglasOpen}>
        <DialogContent className="max-w-3xl w-[95vw] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Reglas · {reglasLista?.nombre}</DialogTitle>
            <DialogDescription>
              Porcentaje de DESCUENTO por categoría, subcategoría o línea. Vacío = sin regla. Al vender se aplica la
              primera que corresponda: precio del producto (listas individuales) → subcategoría → categoría → línea →{" "}
              {reglasLista?.tipo === "porcentaje" ? "porcentaje general de la lista" : "precio del maestro"}.
            </DialogDescription>
          </DialogHeader>
          {reglasPendiente && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{REGLAS_FEATURE_PENDING}</div>
          )}
          {cargandoReglas ? (
            <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-stone-400" /></div>
          ) : (
            <Tabs defaultValue="categoria">
              <TabsList>
                <TabsTrigger value="categoria">Categorías ({categorias.length})</TabsTrigger>
                <TabsTrigger value="subcategoria">Subcategorías ({subcategorias.length})</TabsTrigger>
                <TabsTrigger value="linea">Líneas ({lineasProd.length})</TabsTrigger>
              </TabsList>
              {(
                [
                  { dim: "categoria" as DimensionRegla, filas: categorias.map((c) => ({ id: c.id!, nombre: c.nombre, extra: "" })) },
                  {
                    dim: "subcategoria" as DimensionRegla,
                    filas: subcategorias.map((s) => ({ id: s.id!, nombre: s.nombre, extra: categoriaNombre.get(s.categoria_id) ?? "" })),
                  },
                  { dim: "linea" as DimensionRegla, filas: lineasProd.map((l) => ({ id: l.id!, nombre: l.nombre, extra: "" })) },
                ] as const
              ).map(({ dim, filas }) => (
                <TabsContent key={dim} value={dim}>
                  {filas.length === 0 ? (
                    <p className="py-6 text-center text-sm text-muted-foreground">
                      {dim === "linea" ? "No hay líneas de producto (créalas en Productos)." : "No hay registros."}
                    </p>
                  ) : (
                    <div className="overflow-x-auto border rounded-lg">
                      <Table containerClassName="max-h-[50vh] overflow-y-auto">
                        <TableHeader sticky>
                          <TableRow className="bg-stone-50">
                            <TableHead className="font-semibold">Nombre</TableHead>
                            <TableHead className="font-semibold text-right w-40">Descuento (%)</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {filas.map((f) => (
                            <TableRow key={f.id}>
                              <TableCell>
                                <p className="font-medium text-sm">{f.nombre}</p>
                                {f.extra && <p className="text-xs text-muted-foreground">{f.extra}</p>}
                              </TableCell>
                              <TableCell className="text-right">
                                <Input
                                  type="number"
                                  step="any"
                                  min="0"
                                  className="h-8 w-32 text-right"
                                  placeholder="—"
                                  disabled={reglasPendiente}
                                  value={reglas[`${dim}:${f.id}`] ?? ""}
                                  onChange={(e) => setReglas((prev) => ({ ...prev, [`${dim}:${f.id}`]: e.target.value }))}
                                  onBlur={(e) => guardarRegla(dim, f.id, e.target.value)}
                                />
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </TabsContent>
              ))}
            </Tabs>
          )}
          <DialogFooter>
            <Button onClick={() => setReglasOpen(false)}>Listo</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirmar borrado */}
      <AlertDialog open={borrar !== null} onOpenChange={(o) => { if (!o) setBorrar(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar lista</AlertDialogTitle>
            <AlertDialogDescription>
              Se eliminará «{borrar?.nombre}» y se quitará de los clientes que la tuvieran. Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmarBorrar} className="bg-red-600 hover:bg-red-700">Eliminar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
