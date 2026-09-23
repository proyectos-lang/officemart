"use client"

import * as React from "react"
import { BarChart3, Download, Loader2, PackageX, Search } from "lucide-react"
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Spinner } from "@/components/ui/spinner"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { TablePaginator } from "@/components/ui/table-paginator"
import { useToast } from "@/hooks/use-toast"
import { useTenant } from "@/lib/hooks/use-tenant"
import { formatCurrency, formatNumber } from "@/lib/utils/format"
import { getHondurasTodayISODate, formatHondurasDate } from "@/lib/utils/honduras-time"
import { exportToXlsx } from "@/lib/utils/export"
import { getCategorias, getLineasProducto, type Categoria, type LineaProducto } from "@/lib/services/catalogos"
import { getVendedores, getZonas, type Vendedor, type Zona } from "@/lib/services/vendedores"
import { getPuntosFacturacion, etiquetaPunto, type PuntoFacturacion } from "@/lib/services/puntos-facturacion"
import {
  getLineasReporte, agruparReporte, totalesReporte, getProductosSinMovimiento,
  DIMENSIONES, MEDIDAS, REPORTES_FEATURE_PENDING,
  type LineaReporte, type DimensionReporte, type MedidaReporte, type ProductoSinMovimiento,
} from "@/lib/services/reportes-ventas"

const TODOS = "__all__"

function fmtMedida(medida: MedidaReporte, v: number): string {
  if (medida === "cantidad" || medida === "facturas") return formatNumber(v)
  if (medida === "margen") return `${v.toFixed(2)} %`
  return formatCurrency(v)
}

export default function ReportesVentasPage() {
  const { toast } = useToast()
  const { ready, razonSocialId } = useTenant()
  const hoy = getHondurasTodayISODate()

  // Filtros
  const [desde, setDesde] = React.useState(`${hoy.slice(0, 7)}-01`)
  const [hasta, setHasta] = React.useState(hoy)
  const [puntoId, setPuntoId] = React.useState(TODOS)
  const [vendedorId, setVendedorId] = React.useState(TODOS)
  const [zonaId, setZonaId] = React.useState(TODOS)
  const [categoriaId, setCategoriaId] = React.useState(TODOS)
  const [lineaId, setLineaId] = React.useState(TODOS)
  const [dimension, setDimension] = React.useState<DimensionReporte>("vendedor")
  const [medida, setMedida] = React.useState<MedidaReporte>("venta")

  // Catálogos para filtros
  const [puntos, setPuntos] = React.useState<PuntoFacturacion[]>([])
  const [vendedores, setVendedores] = React.useState<Vendedor[]>([])
  const [zonas, setZonas] = React.useState<Zona[]>([])
  const [categorias, setCategorias] = React.useState<Categoria[]>([])
  const [lineasProd, setLineasProd] = React.useState<LineaProducto[]>([])

  const [loading, setLoading] = React.useState(false)
  const [pendiente, setPendiente] = React.useState(false)
  const [lineas, setLineas] = React.useState<LineaReporte[]>([])
  const [pageIndex, setPageIndex] = React.useState(0)
  const [pageSize, setPageSize] = React.useState(50)

  // Sin movimiento
  const [diasSinMov, setDiasSinMov] = React.useState("90")
  const [sinMov, setSinMov] = React.useState<ProductoSinMovimiento[] | null>(null)
  const [cargandoSinMov, setCargandoSinMov] = React.useState(false)
  const [busquedaSinMov, setBusquedaSinMov] = React.useState("")

  React.useEffect(() => {
    if (!ready || razonSocialId == null) return
    Promise.all([getPuntosFacturacion(), getVendedores(), getZonas(), getCategorias(), getLineasProducto()]).then(
      ([p, v, z, c, l]) => {
        setPuntos(p.data || [])
        setVendedores(v.data || [])
        setZonas(z.data || [])
        setCategorias(c.data || [])
        setLineasProd(l.data || [])
      }
    )
    consultar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, razonSocialId])

  async function consultar() {
    if (!desde || !hasta) {
      toast({ title: "Indica el rango de fechas", variant: "destructive" })
      return
    }
    setLoading(true)
    const { data, error } = await getLineasReporte({
      desde,
      hasta,
      puntoId: puntoId === TODOS ? null : Number(puntoId),
      vendedorId: vendedorId === TODOS ? null : Number(vendedorId),
      zonaId: zonaId === TODOS ? null : Number(zonaId),
      categoriaId: categoriaId === TODOS ? null : Number(categoriaId),
      lineaId: lineaId === TODOS ? null : Number(lineaId),
    })
    setLoading(false)
    if (error === REPORTES_FEATURE_PENDING) setPendiente(true)
    else if (error) toast({ title: "No se pudo consultar", description: error, variant: "destructive" })
    setLineas(data)
    setPageIndex(0)
  }

  const filas = React.useMemo(() => agruparReporte(lineas, dimension, medida), [lineas, dimension, medida])
  const totales = React.useMemo(() => totalesReporte(lineas), [lineas])
  const pagina = filas.slice(pageIndex * pageSize, (pageIndex + 1) * pageSize)
  const chartData = React.useMemo(
    () => filas.slice(0, 15).map((f) => ({ name: f.etiqueta.length > 18 ? `${f.etiqueta.slice(0, 17)}…` : f.etiqueta, valor: Number(f[medida]) })),
    [filas, medida]
  )
  const dimLabel = DIMENSIONES.find((d) => d.valor === dimension)?.label ?? dimension
  const medLabel = MEDIDAS.find((m) => m.valor === medida)?.label ?? medida

  function exportar() {
    exportToXlsx(
      filas.map((f) => ({
        [dimLabel]: f.etiqueta,
        "Venta (L)": f.venta,
        Cantidad: f.cantidad,
        "Costo (L)": f.costo,
        "Utilidad (L)": f.utilidad,
        "Margen %": f.margen,
        Facturas: f.facturas,
        "Participación %": f.participacion,
      })),
      { filename: `ventas_por_${dimension}_${desde}_${hasta}`, sheetName: "Reporte" }
    )
  }

  async function consultarSinMov() {
    setCargandoSinMov(true)
    const { data, error } = await getProductosSinMovimiento(Math.max(1, Number(diasSinMov) || 90), hoy)
    setCargandoSinMov(false)
    if (error) toast({ title: "No se pudo consultar", description: error, variant: "destructive" })
    setSinMov(data)
  }

  const sinMovFiltrado = React.useMemo(() => {
    if (!sinMov) return []
    const q = busquedaSinMov.trim().toLowerCase()
    if (!q) return sinMov
    return sinMov.filter((p) => p.nombre.toLowerCase().includes(q) || (p.codigo || "").toLowerCase().includes(q))
  }, [sinMov, busquedaSinMov])

  function exportarSinMov() {
    exportToXlsx(
      sinMovFiltrado.map((p) => ({
        Producto: p.nombre,
        Codigo: p.codigo || "",
        Categoria: p.categoria_nombre || "",
        Linea: p.linea_nombre || "",
        Stock: p.stock_total,
        "Costo promedio": p.costo_promedio,
        "Valor inventario": p.valor_inventario,
        "Ultima venta": p.ultima_venta ? formatHondurasDate(p.ultima_venta) : "Nunca",
        "Dias sin venta": p.dias_sin_venta ?? "",
      })),
      { filename: `productos_sin_movimiento_${diasSinMov}d`, sheetName: "Sin movimiento" }
    )
  }

  return (
    <div className="space-y-4 md:space-y-6">
      <div className="flex items-center gap-3">
        <div className="rounded-lg bg-violet-100 p-2 text-violet-700">
          <BarChart3 className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold text-stone-800">Reportes de Ventas</h1>
          <p className="text-sm text-muted-foreground">Cruza cualquier dimensión (vendedor, zona, punto, línea…) con cualquier medida, y detecta productos sin movimiento.</p>
        </div>
      </div>

      {pendiente && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{REPORTES_FEATURE_PENDING}</div>
      )}

      <Tabs defaultValue="dinamico">
        <TabsList>
          <TabsTrigger value="dinamico">Reporte dinámico</TabsTrigger>
          <TabsTrigger value="sinmov">Sin movimiento</TabsTrigger>
        </TabsList>

        <TabsContent value="dinamico" className="space-y-4">
          <Card>
            <CardContent className="p-4 grid gap-3 md:grid-cols-4 lg:grid-cols-8 md:items-end">
              <div className="grid gap-1.5"><Label>Desde</Label><Input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /></div>
              <div className="grid gap-1.5"><Label>Hasta</Label><Input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} /></div>
              {puntos.length > 0 && (
                <div className="grid gap-1.5">
                  <Label>Punto</Label>
                  <Select value={puntoId} onValueChange={setPuntoId}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={TODOS}>Todos</SelectItem>
                      {puntos.map((p) => <SelectItem key={p.id} value={String(p.id)}>{etiquetaPunto(p)}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {vendedores.length > 0 && (
                <div className="grid gap-1.5">
                  <Label>Vendedor</Label>
                  <Select value={vendedorId} onValueChange={setVendedorId}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={TODOS}>Todos</SelectItem>
                      {vendedores.map((v) => <SelectItem key={v.id} value={String(v.id)}>{v.nombre}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {zonas.length > 0 && (
                <div className="grid gap-1.5">
                  <Label>Zona</Label>
                  <Select value={zonaId} onValueChange={setZonaId}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={TODOS}>Todas</SelectItem>
                      {zonas.map((z) => <SelectItem key={z.id} value={String(z.id)}>{z.nombre}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="grid gap-1.5">
                <Label>Categoría</Label>
                <Select value={categoriaId} onValueChange={setCategoriaId}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={TODOS}>Todas</SelectItem>
                    {categorias.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.nombre}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {lineasProd.length > 0 && (
                <div className="grid gap-1.5">
                  <Label>Línea</Label>
                  <Select value={lineaId} onValueChange={setLineaId}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={TODOS}>Todas</SelectItem>
                      {lineasProd.map((l) => <SelectItem key={l.id} value={String(l.id)}>{l.nombre}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <Button onClick={consultar} disabled={loading} className="gap-2">
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} Consultar
              </Button>
            </CardContent>
          </Card>

          <div className="grid gap-3 grid-cols-2 lg:grid-cols-6">
            <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">Venta</p><p className="text-lg font-semibold">{formatCurrency(totales.venta)}</p></CardContent></Card>
            <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">Costo</p><p className="text-lg font-semibold">{formatCurrency(totales.costo)}</p></CardContent></Card>
            <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">Utilidad</p><p className="text-lg font-semibold">{formatCurrency(totales.utilidad)}</p></CardContent></Card>
            <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">Margen</p><p className="text-lg font-semibold">{totales.margen.toFixed(2)} %</p></CardContent></Card>
            <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">Unidades</p><p className="text-lg font-semibold">{formatNumber(totales.cantidad)}</p></CardContent></Card>
            <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">Facturas</p><p className="text-lg font-semibold">{formatNumber(totales.facturas)}</p></CardContent></Card>
          </div>

          <Card>
            <CardHeader className="p-4 md:p-6">
              <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                <div>
                  <CardTitle className="text-lg">{medLabel} por {dimLabel.toLowerCase()}</CardTitle>
                  <CardDescription>{filas.length} grupos · {lineas.length} líneas vendidas vigentes en el período.</CardDescription>
                </div>
                <div className="flex flex-wrap gap-2 items-end">
                  <div className="grid gap-1.5">
                    <Label className="text-xs">Agrupar por</Label>
                    <Select value={dimension} onValueChange={(v) => { setDimension(v as DimensionReporte); setPageIndex(0) }}>
                      <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                      <SelectContent>{DIMENSIONES.map((d) => <SelectItem key={d.valor} value={d.valor}>{d.label}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-1.5">
                    <Label className="text-xs">Medida</Label>
                    <Select value={medida} onValueChange={(v) => setMedida(v as MedidaReporte)}>
                      <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                      <SelectContent>{MEDIDAS.map((m) => <SelectItem key={m.valor} value={m.valor}>{m.label}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <Button variant="outline" size="sm" onClick={exportar} disabled={filas.length === 0} className="gap-1"><Download className="h-4 w-4" /> Excel</Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-4 md:p-6 pt-0 space-y-4">
              {loading ? (
                <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground"><Spinner /> Consultando…</div>
              ) : filas.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">Sin ventas en el rango y filtros elegidos.</p>
              ) : (
                <>
                  {chartData.length > 1 && (
                    <ResponsiveContainer width="100%" height={260}>
                      <BarChart data={chartData} margin={{ left: 8, right: 8 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" />
                        <XAxis dataKey="name" className="text-xs" interval={0} angle={-20} textAnchor="end" height={60} />
                        <YAxis className="text-xs" tickFormatter={(v) => (medida === "cantidad" || medida === "facturas" ? String(v) : medida === "margen" ? `${v}%` : `L${v}`)} />
                        <Tooltip formatter={(v) => fmtMedida(medida, Number(v))} />
                        <Bar dataKey="valor" name={medLabel} fill="#5D7B6F" radius={[6, 6, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                  <div className="overflow-x-auto border rounded-lg">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-stone-50">
                          <TableHead>{dimLabel}</TableHead>
                          <TableHead className="text-right">Venta</TableHead>
                          <TableHead className="text-right">Cantidad</TableHead>
                          <TableHead className="text-right">Costo</TableHead>
                          <TableHead className="text-right">Utilidad</TableHead>
                          <TableHead className="text-right">Margen</TableHead>
                          <TableHead className="text-right">Facturas</TableHead>
                          <TableHead className="text-right">Part. %</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {pagina.map((f) => (
                          <TableRow key={f.clave}>
                            <TableCell className="font-medium">{f.etiqueta}</TableCell>
                            <TableCell className="text-right">{formatCurrency(f.venta)}</TableCell>
                            <TableCell className="text-right">{formatNumber(f.cantidad)}</TableCell>
                            <TableCell className="text-right">{formatCurrency(f.costo)}</TableCell>
                            <TableCell className="text-right">{formatCurrency(f.utilidad)}</TableCell>
                            <TableCell className="text-right">{f.margen.toFixed(2)} %</TableCell>
                            <TableCell className="text-right">{f.facturas}</TableCell>
                            <TableCell className="text-right">{medida === "margen" ? "—" : `${f.participacion.toFixed(2)} %`}</TableCell>
                          </TableRow>
                        ))}
                        <TableRow className="bg-stone-50 font-semibold">
                          <TableCell>Total</TableCell>
                          <TableCell className="text-right">{formatCurrency(totales.venta)}</TableCell>
                          <TableCell className="text-right">{formatNumber(totales.cantidad)}</TableCell>
                          <TableCell className="text-right">{formatCurrency(totales.costo)}</TableCell>
                          <TableCell className="text-right">{formatCurrency(totales.utilidad)}</TableCell>
                          <TableCell className="text-right">{totales.margen.toFixed(2)} %</TableCell>
                          <TableCell className="text-right">{totales.facturas}</TableCell>
                          <TableCell className="text-right">100 %</TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>
                  </div>
                  <TablePaginator pageIndex={pageIndex} pageSize={pageSize} totalItems={filas.length} onPageIndexChange={setPageIndex} onPageSizeChange={(s) => { setPageSize(s); setPageIndex(0) }} />
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="sinmov" className="space-y-4">
          <Card>
            <CardHeader className="p-4 md:p-6">
              <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                <div>
                  <CardTitle className="text-lg flex items-center gap-2"><PackageX className="h-4 w-4 text-amber-600" /> Productos sin movimiento</CardTitle>
                  <CardDescription>Con existencias y sin ventas en los últimos N días (o nunca vendidos). Ordenado por valor de inventario.</CardDescription>
                </div>
                <div className="flex flex-wrap items-end gap-2">
                  <div className="grid gap-1.5"><Label className="text-xs">Días sin venta</Label><Input type="number" min="1" value={diasSinMov} onChange={(e) => setDiasSinMov(e.target.value)} className="w-28" /></div>
                  <Button onClick={consultarSinMov} disabled={cargandoSinMov} className="gap-2">
                    {cargandoSinMov ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} Consultar
                  </Button>
                  <Button variant="outline" size="sm" onClick={exportarSinMov} disabled={!sinMov || sinMov.length === 0} className="gap-1"><Download className="h-4 w-4" /> Excel</Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-4 md:p-6 pt-0 space-y-3">
              {sinMov && sinMov.length > 0 && (
                <div className="flex flex-wrap items-center gap-3">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input value={busquedaSinMov} onChange={(e) => setBusquedaSinMov(e.target.value)} placeholder="Buscar producto…" className="pl-9 w-64" />
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {sinMovFiltrado.length} productos · {formatCurrency(sinMovFiltrado.reduce((a, p) => a + p.valor_inventario, 0))} inmovilizados
                  </p>
                </div>
              )}
              {cargandoSinMov ? (
                <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground"><Spinner /> Consultando…</div>
              ) : sinMov == null ? (
                <p className="py-8 text-center text-sm text-muted-foreground">Presiona Consultar.</p>
              ) : sinMovFiltrado.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">Todo el inventario con existencias se vendió en ese lapso.</p>
              ) : (
                <div className="overflow-x-auto border rounded-lg">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-stone-50">
                        <TableHead>Producto</TableHead>
                        <TableHead>Categoría / línea</TableHead>
                        <TableHead className="text-right">Stock</TableHead>
                        <TableHead className="text-right">Costo</TableHead>
                        <TableHead className="text-right">Valor</TableHead>
                        <TableHead>Última venta</TableHead>
                        <TableHead className="text-right">Días</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {sinMovFiltrado.slice(0, 500).map((p) => (
                        <TableRow key={p.producto_id}>
                          <TableCell>
                            <p className="font-medium text-sm">{p.nombre}</p>
                            <p className="text-xs text-muted-foreground font-mono">{p.codigo || "—"}</p>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">{[p.categoria_nombre, p.linea_nombre].filter(Boolean).join(" · ") || "—"}</TableCell>
                          <TableCell className="text-right">{formatNumber(p.stock_total)}</TableCell>
                          <TableCell className="text-right">{formatCurrency(p.costo_promedio)}</TableCell>
                          <TableCell className="text-right font-medium">{formatCurrency(p.valor_inventario)}</TableCell>
                          <TableCell className="whitespace-nowrap">{p.ultima_venta ? formatHondurasDate(p.ultima_venta) : <span className="text-amber-700">Nunca</span>}</TableCell>
                          <TableCell className="text-right">{p.dias_sin_venta ?? "—"}</TableCell>
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
