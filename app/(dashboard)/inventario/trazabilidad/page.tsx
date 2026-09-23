"use client"

import * as React from "react"
import { Route, ChevronsUpDown, Check, Download, Search, Loader2, Package, ShoppingBag } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Spinner } from "@/components/ui/spinner"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { useToast } from "@/hooks/use-toast"
import { useTenant } from "@/lib/hooks/use-tenant"
import { formatCurrency, formatNumber } from "@/lib/utils/format"
import { formatHondurasDate } from "@/lib/utils/honduras-time"
import { exportToXlsx } from "@/lib/utils/export"
import { getProductos, type Producto } from "@/lib/services/catalogos"
import { getCompras, type CompraEncabezado } from "@/lib/services/compras"
import {
  getMovimientosProducto, getTrazaCompra, asignarLotesFIFO, resumirDestinos,
  type MovimientoTraza, type ResultadoFIFO, type TrazaCompra,
} from "@/lib/services/trazabilidad"

function badgeTipo(tipo: string) {
  const t = tipo.toLowerCase()
  const cls = t.startsWith("entrada") || t.startsWith("ingreso") || t === "traslado entrada"
    ? "bg-emerald-100 text-emerald-700"
    : t.startsWith("salida") || t === "traslado salida"
      ? "bg-red-100 text-red-700"
      : "bg-stone-100 text-stone-700"
  return <Badge variant="outline" className={`border-0 ${cls}`}>{tipo}</Badge>
}

export default function TrazabilidadPage() {
  const { toast } = useToast()
  const { ready, razonSocialId } = useTenant()

  const [productos, setProductos] = React.useState<Producto[]>([])
  const [compras, setCompras] = React.useState<CompraEncabezado[]>([])

  // Por producto
  const [prodOpen, setProdOpen] = React.useState(false)
  const [prodBusqueda, setProdBusqueda] = React.useState("")
  const [productoId, setProductoId] = React.useState<number | null>(null)
  const [movs, setMovs] = React.useState<MovimientoTraza[]>([])
  const [fifo, setFifo] = React.useState<ResultadoFIFO | null>(null)
  const [cargandoProd, setCargandoProd] = React.useState(false)

  // Por OC
  const [ocOpen, setOcOpen] = React.useState(false)
  const [compraId, setCompraId] = React.useState<number | null>(null)
  const [traza, setTraza] = React.useState<TrazaCompra | null>(null)
  const [cargandoOc, setCargandoOc] = React.useState(false)

  React.useEffect(() => {
    if (!ready || razonSocialId == null) return
    getProductos().then((r) => setProductos(r.data || []))
    getCompras().then((r) => setCompras(r.data || []))
  }, [ready, razonSocialId])

  const productosFiltrados = React.useMemo(() => {
    const q = prodBusqueda.trim().toLowerCase()
    const base = q ? productos.filter((p) => (p.nombre || "").toLowerCase().includes(q) || (p.codigo_barras || "").toLowerCase().includes(q)) : productos
    return base.slice(0, 50)
  }, [productos, prodBusqueda])
  const producto = productos.find((p) => p.id === productoId) ?? null
  const compra = compras.find((c) => c.id === compraId) ?? null

  async function consultarProducto(id: number) {
    setProductoId(id)
    setProdOpen(false)
    setCargandoProd(true)
    const { data, error } = await getMovimientosProducto(id)
    setCargandoProd(false)
    if (error) toast({ title: "No se pudo consultar", description: error, variant: "destructive" })
    setMovs(data)
    setFifo(asignarLotesFIFO(data))
  }

  async function consultarOc(id: number) {
    setCompraId(id)
    setOcOpen(false)
    setCargandoOc(true)
    const { data, error } = await getTrazaCompra(id)
    setCargandoOc(false)
    if (error) toast({ title: "No se pudo consultar", description: error, variant: "destructive" })
    setTraza(data)
  }

  function exportarProducto() {
    if (!fifo || !producto) return
    const filas: Record<string, unknown>[] = []
    for (const l of fifo.lotes) {
      const base: Record<string, unknown> = { Lote: l.referencia_texto || l.tipo_movimiento, "Fecha lote": formatHondurasDate(l.fecha), Almacen: l.almacen_nombre || "", Cantidad: l.cantidad, Costo: l.costo_unitario, Restante: l.restante }
      if (l.destinos.length === 0) filas.push({ ...base, Destino: "", "Fecha destino": "", "Cant. destino": "" })
      for (const d of l.destinos) {
        filas.push({ ...base, Destino: `${d.tipo_movimiento}${d.referencia_texto ? ` · ${d.referencia_texto}` : ""}`, "Fecha destino": formatHondurasDate(d.fecha), "Cant. destino": d.cantidad })
      }
    }
    exportToXlsx(filas, { filename: `trazabilidad_${producto.nombre.replace(/\s+/g, "_")}`, sheetName: "Trazabilidad" })
  }

  function exportarOc() {
    if (!traza) return
    const filas: Record<string, unknown>[] = []
    for (const l of traza.lotes) {
      const prod = productos.find((p) => p.id === l.producto_id)
      const base: Record<string, unknown> = { Producto: prod?.nombre || `#${l.producto_id}`, "Fecha entrada": formatHondurasDate(l.fecha), Almacen: l.almacen_nombre || "", Recibido: l.cantidad, Costo: l.costo_unitario, "En stock": l.restante }
      if (l.destinos.length === 0) filas.push({ ...base, Destino: "", "Fecha destino": "", "Cant. destino": "" })
      for (const d of l.destinos) {
        filas.push({ ...base, Destino: `${d.tipo_movimiento}${d.referencia_texto ? ` · ${d.referencia_texto}` : ""}`, "Fecha destino": formatHondurasDate(d.fecha), "Cant. destino": d.cantidad })
      }
    }
    exportToXlsx(filas, { filename: `trazabilidad_OC-${traza.compra.id}`, sheetName: "OC" })
  }

  return (
    <div className="space-y-4 md:space-y-6">
      <div className="flex items-center gap-3">
        <div className="rounded-lg bg-teal-100 p-2 text-teal-700">
          <Route className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold text-stone-800">Trazabilidad</h1>
          <p className="text-sm text-muted-foreground">De qué orden de compra vino cada unidad y a qué venta o almacén fue (asignación FIFO por almacén).</p>
        </div>
      </div>

      <Tabs defaultValue="producto">
        <TabsList>
          <TabsTrigger value="producto" className="gap-1"><Package className="h-4 w-4" /> Por producto</TabsTrigger>
          <TabsTrigger value="oc" className="gap-1"><ShoppingBag className="h-4 w-4" /> Por orden de compra</TabsTrigger>
        </TabsList>

        {/* ---------- Por producto ---------- */}
        <TabsContent value="producto" className="space-y-4">
          <Card>
            <CardContent className="p-4 flex flex-col md:flex-row md:items-end gap-3">
              <div className="grid gap-1.5 flex-1">
                <Label>Producto</Label>
                <Popover open={prodOpen} onOpenChange={setProdOpen}>
                  <PopoverTrigger asChild>
                    <Button variant="outline" role="combobox" className="justify-between font-normal">
                      <span className="truncate">{producto ? producto.nombre : "Buscar producto…"}</span>
                      <ChevronsUpDown className="h-4 w-4 opacity-50 shrink-0" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="p-0 w-[420px]" align="start">
                    <Command shouldFilter={false}>
                      <CommandInput placeholder="Nombre o código…" value={prodBusqueda} onValueChange={setProdBusqueda} />
                      <CommandList>
                        <CommandEmpty>Sin resultados.</CommandEmpty>
                        <CommandGroup>
                          {productosFiltrados.map((p) => (
                            <CommandItem key={p.id} value={String(p.id)} onSelect={() => consultarProducto(p.id!)}>
                              <Check className={`mr-2 h-4 w-4 ${p.id === productoId ? "opacity-100" : "opacity-0"}`} />
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-sm">{p.nombre}</p>
                                <p className="text-xs text-muted-foreground font-mono">{p.codigo_barras || "—"} · stock {formatNumber(p.stock_total || 0)}</p>
                              </div>
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>
              <Button variant="outline" size="sm" onClick={exportarProducto} disabled={!fifo || fifo.lotes.length === 0} className="gap-1"><Download className="h-4 w-4" /> Excel</Button>
            </CardContent>
          </Card>

          {cargandoProd ? (
            <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground"><Spinner /> Reconstruyendo…</div>
          ) : fifo && producto ? (
            <>
              <div className="grid gap-3 sm:grid-cols-4">
                <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Lotes (entradas)</p><p className="text-xl font-semibold">{fifo.lotes.length}</p></CardContent></Card>
                <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Unidades entradas</p><p className="text-xl font-semibold">{formatNumber(fifo.lotes.reduce((a, l) => a + l.cantidad, 0))}</p></CardContent></Card>
                <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">En stock (según lotes)</p><p className="text-xl font-semibold">{formatNumber(fifo.lotes.reduce((a, l) => a + l.restante, 0))}</p></CardContent></Card>
                <Card className={fifo.sinLote.length > 0 ? "border-amber-200 bg-amber-50/40" : ""}><CardContent className="p-4"><p className="text-xs text-muted-foreground">Salidas sin lote</p><p className="text-xl font-semibold">{formatNumber(fifo.sinLote.reduce((a, d) => a + d.cantidad, 0))}</p></CardContent></Card>
              </div>

              <Card>
                <CardHeader className="p-4 md:p-6">
                  <CardTitle className="text-lg">Lotes y destinos</CardTitle>
                  <CardDescription>Cada entrada (compra, traslado, ingreso) es un lote; sus unidades se asignan a las salidas siguientes del mismo almacén en orden de fecha.</CardDescription>
                </CardHeader>
                <CardContent className="p-4 md:p-6 pt-0">
                  {fifo.lotes.length === 0 ? (
                    <p className="py-8 text-center text-sm text-muted-foreground">Este producto no tiene entradas en el kardex.</p>
                  ) : (
                    <div className="overflow-x-auto border rounded-lg">
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-stone-50">
                            <TableHead>Fecha</TableHead>
                            <TableHead>Origen (lote)</TableHead>
                            <TableHead>Almacén</TableHead>
                            <TableHead className="text-right">Entró</TableHead>
                            <TableHead className="text-right">Costo</TableHead>
                            <TableHead className="text-right">En stock</TableHead>
                            <TableHead>Destinos</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {[...fifo.lotes].reverse().map((l) => (
                            <TableRow key={l.movimiento_id}>
                              <TableCell className="whitespace-nowrap">{formatHondurasDate(l.fecha)}</TableCell>
                              <TableCell>
                                <div className="flex flex-col gap-1">
                                  {badgeTipo(l.tipo_movimiento)}
                                  <span className="text-sm">{l.referencia_texto || "—"}</span>
                                </div>
                              </TableCell>
                              <TableCell className="text-sm">{l.almacen_nombre || "—"}</TableCell>
                              <TableCell className="text-right">{formatNumber(l.cantidad)}</TableCell>
                              <TableCell className="text-right">{formatCurrency(l.costo_unitario)}</TableCell>
                              <TableCell className={`text-right font-medium ${l.restante > 0 ? "text-emerald-700" : "text-muted-foreground"}`}>{formatNumber(l.restante)}</TableCell>
                              <TableCell>
                                {l.destinos.length === 0 ? (
                                  <span className="text-xs text-muted-foreground">Sin salidas</span>
                                ) : (
                                  <ul className="text-xs space-y-0.5">
                                    {resumirDestinos(l.destinos).map((r) => (
                                      <li key={r.tipo}>
                                        <span className="font-medium">{r.tipo}</span>: {formatNumber(r.cantidad)}
                                        {r.documentos.length > 0 && <span className="text-muted-foreground"> · {r.documentos.slice(0, 6).join(", ")}{r.documentos.length > 6 ? ` +${r.documentos.length - 6}` : ""}</span>}
                                      </li>
                                    ))}
                                  </ul>
                                )}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="p-4 md:p-6">
                  <CardTitle className="text-lg">Kardex ({movs.length})</CardTitle>
                </CardHeader>
                <CardContent className="p-4 md:p-6 pt-0">
                  <div className="overflow-x-auto border rounded-lg">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-stone-50">
                          <TableHead>Fecha</TableHead>
                          <TableHead>Tipo</TableHead>
                          <TableHead>Documento</TableHead>
                          <TableHead>Almacén · localización</TableHead>
                          <TableHead className="text-right">Cantidad</TableHead>
                          <TableHead className="text-right">Costo / precio</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {[...movs].reverse().slice(0, 500).map((m) => (
                          <TableRow key={m.id}>
                            <TableCell className="whitespace-nowrap">{formatHondurasDate(m.fecha)}</TableCell>
                            <TableCell>{badgeTipo(m.tipo_movimiento)}</TableCell>
                            <TableCell className="text-sm">{m.referencia_texto || (m.referencia_id != null ? `#${m.referencia_id}` : "—")}</TableCell>
                            <TableCell className="text-sm text-muted-foreground">{[m.almacen_nombre, m.localizacion_nombre].filter(Boolean).join(" · ") || "—"}</TableCell>
                            <TableCell className={`text-right font-medium ${m.cantidad < 0 ? "text-red-700" : "text-emerald-700"}`}>{m.cantidad > 0 ? "+" : ""}{formatNumber(m.cantidad)}</TableCell>
                            <TableCell className="text-right">{formatCurrency(m.costo_o_precio_unitario)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            </>
          ) : (
            <p className="py-10 text-center text-sm text-muted-foreground">Elige un producto para ver de dónde vino y a dónde fue.</p>
          )}
        </TabsContent>

        {/* ---------- Por orden de compra ---------- */}
        <TabsContent value="oc" className="space-y-4">
          <Card>
            <CardContent className="p-4 flex flex-col md:flex-row md:items-end gap-3">
              <div className="grid gap-1.5 flex-1">
                <Label>Orden de compra</Label>
                <Popover open={ocOpen} onOpenChange={setOcOpen}>
                  <PopoverTrigger asChild>
                    <Button variant="outline" role="combobox" className="justify-between font-normal">
                      <span className="truncate">{compra ? `OC-${compra.id} · ${compra.numero_factura || ""} ${compra.proveedor_nombre || ""}` : "Buscar orden…"}</span>
                      <ChevronsUpDown className="h-4 w-4 opacity-50 shrink-0" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="p-0 w-[460px]" align="start">
                    <Command>
                      <CommandInput placeholder="N.º de OC, factura o proveedor…" />
                      <CommandList>
                        <CommandEmpty>Sin resultados.</CommandEmpty>
                        <CommandGroup>
                          {compras.slice(0, 300).map((c) => (
                            <CommandItem key={c.id} value={`OC-${c.id} ${c.numero_factura || ""} ${c.proveedor_nombre || ""}`} onSelect={() => consultarOc(c.id!)}>
                              <Check className={`mr-2 h-4 w-4 ${c.id === compraId ? "opacity-100" : "opacity-0"}`} />
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-sm">OC-{c.id}{c.numero_factura ? ` · ${c.numero_factura}` : ""} · {c.proveedor_nombre || "—"}</p>
                                <p className="text-xs text-muted-foreground">{formatHondurasDate(c.fecha_orden)} · {c.estado} · {formatCurrency(c.total_compra_local || 0)}</p>
                              </div>
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>
              <Button variant="outline" size="sm" onClick={exportarOc} disabled={!traza || traza.lotes.length === 0} className="gap-1"><Download className="h-4 w-4" /> Excel</Button>
            </CardContent>
          </Card>

          {cargandoOc ? (
            <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground"><Spinner /> Reconstruyendo…</div>
          ) : traza ? (
            <Card>
              <CardHeader className="p-4 md:p-6">
                <CardTitle className="text-lg">OC-{traza.compra.id} · {traza.compra.proveedor_nombre || "Proveedor"}</CardTitle>
                <CardDescription>
                  {formatHondurasDate(traza.compra.fecha_orden)} · {traza.compra.estado} · {traza.detalles.length} productos ordenados · {traza.entradas.length} entradas al inventario.
                </CardDescription>
              </CardHeader>
              <CardContent className="p-4 md:p-6 pt-0">
                {traza.lotes.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">Esta orden aún no tiene recepciones en el inventario.</p>
                ) : (
                  <div className="overflow-x-auto border rounded-lg">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-stone-50">
                          <TableHead>Producto</TableHead>
                          <TableHead>Recibido el</TableHead>
                          <TableHead>Almacén</TableHead>
                          <TableHead className="text-right">Recibido</TableHead>
                          <TableHead className="text-right">Costo</TableHead>
                          <TableHead className="text-right">En stock</TableHead>
                          <TableHead>A dónde fue</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {traza.lotes.map((l) => {
                          const prod = productos.find((p) => p.id === l.producto_id)
                          return (
                            <TableRow key={l.movimiento_id}>
                              <TableCell>
                                <p className="font-medium text-sm">{prod?.nombre || `#${l.producto_id}`}</p>
                                <p className="text-xs text-muted-foreground font-mono">{prod?.codigo_barras || ""}</p>
                              </TableCell>
                              <TableCell className="whitespace-nowrap">{formatHondurasDate(l.fecha)}</TableCell>
                              <TableCell className="text-sm">{l.almacen_nombre || "—"}</TableCell>
                              <TableCell className="text-right">{formatNumber(l.cantidad)}</TableCell>
                              <TableCell className="text-right">{formatCurrency(l.costo_unitario)}</TableCell>
                              <TableCell className={`text-right font-medium ${l.restante > 0 ? "text-emerald-700" : "text-muted-foreground"}`}>{formatNumber(l.restante)}</TableCell>
                              <TableCell>
                                {l.destinos.length === 0 ? (
                                  <span className="text-xs text-muted-foreground">Todavía en inventario</span>
                                ) : (
                                  <ul className="text-xs space-y-0.5">
                                    {resumirDestinos(l.destinos).map((r) => (
                                      <li key={r.tipo}>
                                        <span className="font-medium">{r.tipo}</span>: {formatNumber(r.cantidad)}
                                        {r.documentos.length > 0 && <span className="text-muted-foreground"> · {r.documentos.slice(0, 6).join(", ")}{r.documentos.length > 6 ? ` +${r.documentos.length - 6}` : ""}</span>}
                                      </li>
                                    ))}
                                  </ul>
                                )}
                              </TableCell>
                            </TableRow>
                          )
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          ) : (
            <p className="py-10 text-center text-sm text-muted-foreground">Elige una orden de compra para ver qué recibió y a dónde fue cada producto.</p>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}
