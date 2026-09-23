"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { RefreshCw, Download, Search, Loader2, ShoppingBag, Save } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Spinner } from "@/components/ui/spinner"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { TablePaginator } from "@/components/ui/table-paginator"
import { useToast } from "@/hooks/use-toast"
import { useTenant } from "@/lib/hooks/use-tenant"
import { formatCurrency, formatNumber } from "@/lib/utils/format"
import { getHondurasTodayISODate } from "@/lib/utils/honduras-time"
import { exportToXlsx } from "@/lib/utils/export"
import { getProveedores, type Proveedor } from "@/lib/services/catalogos"
import {
  getReposicion, saveReorden, crearOCBorradorDesdeReposicion, REPOSICION_FEATURE_PENDING,
  type FilaReposicion, type EstadoReposicion,
} from "@/lib/services/reposicion"

const ESTADO_CLS: Record<EstadoReposicion, string> = {
  "Sin stock": "bg-red-100 text-red-700",
  "Bajo mínimo": "bg-amber-100 text-amber-800",
  Reordenar: "bg-orange-100 text-orange-800",
  OK: "bg-emerald-100 text-emerald-700",
}

export default function ReposicionPage() {
  const router = useRouter()
  const { toast } = useToast()
  const { ready, razonSocialId } = useTenant()
  const hoy = getHondurasTodayISODate()

  const [loading, setLoading] = React.useState(true)
  const [pendiente, setPendiente] = React.useState(false)
  const [filas, setFilas] = React.useState<FilaReposicion[]>([])
  const [busqueda, setBusqueda] = React.useState("")
  const [filtro, setFiltro] = React.useState<"atencion" | "todos" | EstadoReposicion>("atencion")
  const [pageIndex, setPageIndex] = React.useState(0)
  const [pageSize, setPageSize] = React.useState(50)
  const [seleccion, setSeleccion] = React.useState<Record<number, number>>({})
  // Edición de mínimos por producto: producto_id -> { min, reorden, lote }
  const [edicion, setEdicion] = React.useState<Record<number, { min: string; reorden: string; lote: string }>>({})
  const [guardando, setGuardando] = React.useState<number | null>(null)

  // OC borrador
  const [ocOpen, setOcOpen] = React.useState(false)
  const [proveedores, setProveedores] = React.useState<Proveedor[]>([])
  const [proveedorId, setProveedorId] = React.useState("")
  const [fechaTentativa, setFechaTentativa] = React.useState("")
  const [creando, setCreando] = React.useState(false)

  React.useEffect(() => {
    if (!ready || razonSocialId == null) return
    cargar()
    getProveedores().then((r) => setProveedores(r.data || []))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, razonSocialId])

  async function cargar() {
    setLoading(true)
    const { data, error, pendiente: p } = await getReposicion(hoy)
    setPendiente(p)
    if (error) toast({ title: "No se pudo calcular la reposición", description: error, variant: "destructive" })
    setFilas(data)
    setLoading(false)
  }

  const filtradas = React.useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    return filas.filter((f) => {
      if (filtro === "atencion" && f.estado === "OK") return false
      if (filtro !== "atencion" && filtro !== "todos" && f.estado !== filtro) return false
      if (!q) return true
      return f.nombre.toLowerCase().includes(q) || (f.codigo || "").toLowerCase().includes(q) || (f.categoria_nombre || "").toLowerCase().includes(q)
    })
  }, [filas, filtro, busqueda])
  React.useEffect(() => { setPageIndex(0) }, [filtro, busqueda])
  const pagina = filtradas.slice(pageIndex * pageSize, (pageIndex + 1) * pageSize)

  const resumen = React.useMemo(() => ({
    sinStock: filas.filter((f) => f.estado === "Sin stock").length,
    bajoMinimo: filas.filter((f) => f.estado === "Bajo mínimo").length,
    reordenar: filas.filter((f) => f.estado === "Reordenar").length,
    valorSugerido: filas.reduce((a, f) => a + f.sugerido * f.costo_promedio, 0),
  }), [filas])

  function toggleSel(f: FilaReposicion, on: boolean) {
    setSeleccion((prev) => {
      const next = { ...prev }
      if (on) next[f.producto_id] = f.sugerido > 0 ? f.sugerido : 1
      else delete next[f.producto_id]
      return next
    })
  }

  function editar(f: FilaReposicion) {
    setEdicion((prev) => ({ ...prev, [f.producto_id]: prev[f.producto_id] ?? { min: String(f.stock_minimo || ""), reorden: String(f.punto_reorden || ""), lote: f.cantidad_sugerida_fija != null ? String(f.cantidad_sugerida_fija) : "" } }))
  }

  async function guardarMinimos(f: FilaReposicion) {
    const e = edicion[f.producto_id]
    if (!e) return
    setGuardando(f.producto_id)
    const { error } = await saveReorden({
      producto_id: f.producto_id,
      almacen_id: null,
      stock_minimo: Number(e.min) || 0,
      punto_reorden: Number(e.reorden) || 0,
      cantidad_sugerida: e.lote.trim() ? Number(e.lote) : null,
    })
    setGuardando(null)
    if (error) {
      toast({ title: "No se pudo guardar", description: error, variant: "destructive" })
      return
    }
    setEdicion((prev) => { const n = { ...prev }; delete n[f.producto_id]; return n })
    toast({ title: "Mínimos guardados", description: f.nombre })
    cargar()
  }

  async function crearOC() {
    if (!proveedorId) {
      toast({ title: "Elige el proveedor", variant: "destructive" })
      return
    }
    const items = Object.entries(seleccion).map(([pid, cant]) => {
      const f = filas.find((x) => x.producto_id === Number(pid))
      return { producto_id: Number(pid), cantidad: Number(cant) || 0, costo: f?.costo_promedio || 0 }
    })
    setCreando(true)
    const { compraId, error } = await crearOCBorradorDesdeReposicion(Number(proveedorId), items, fechaTentativa || hoy)
    setCreando(false)
    if (error || !compraId) {
      toast({ title: "No se pudo crear la orden", description: error ?? "", variant: "destructive" })
      return
    }
    toast({ title: `OC-${compraId} creada (Pendiente)`, description: "Revisa costos y proveedor en Orden de Compra antes de enviarla." })
    setOcOpen(false)
    setSeleccion({})
    router.push("/compras/orden")
  }

  function exportar() {
    exportToXlsx(
      filtradas.map((f) => ({
        Producto: f.nombre, Codigo: f.codigo || "", Categoria: f.categoria_nombre || "", Estado: f.estado,
        Stock: f.stock, "En transito": f.en_transito, Minimo: f.stock_minimo, "Punto reorden": f.punto_reorden,
        "Vendido 90d": f.vendido_90d, "Venta diaria": f.venta_diaria, "Cobertura (dias)": f.cobertura_dias ?? "",
        "Lead time (dias)": f.lead_time_dias ?? "", Sugerido: f.sugerido, "Costo prom.": f.costo_promedio,
        "Valor sugerido": +(f.sugerido * f.costo_promedio).toFixed(2),
      })),
      { filename: "reposicion", sheetName: "Reposición" }
    )
  }

  const nSel = Object.keys(seleccion).length

  return (
    <div className="space-y-4 md:space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-teal-100 p-2 text-teal-700">
            <RefreshCw className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold text-stone-800">Reposición</h1>
            <p className="text-sm text-muted-foreground">Mínimos, punto de reorden, venta diaria (90 días), lead time real y cantidad sugerida de compra.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={exportar} disabled={filtradas.length === 0} className="gap-1"><Download className="h-4 w-4" /> Excel</Button>
          <Button size="sm" onClick={() => { setFechaTentativa(hoy); setOcOpen(true) }} disabled={nSel === 0} className="gap-1"><ShoppingBag className="h-4 w-4" /> Crear OC ({nSel})</Button>
        </div>
      </div>

      {pendiente && <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{REPOSICION_FEATURE_PENDING} Mientras tanto se sugiere solo por venta y lead time.</div>}

      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Sin stock</p><p className="text-2xl font-semibold text-red-700">{resumen.sinStock}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Bajo mínimo</p><p className="text-2xl font-semibold text-amber-700">{resumen.bajoMinimo}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Por reordenar</p><p className="text-2xl font-semibold text-orange-700">{resumen.reordenar}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Compra sugerida (L, a costo)</p><p className="text-2xl font-semibold">{formatCurrency(resumen.valorSugerido)}</p></CardContent></Card>
      </div>

      <Card>
        <CardHeader className="p-4 md:p-6">
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <CardTitle className="text-lg">Productos ({filtradas.length})</CardTitle>
              <CardDescription>Marca los productos y presiona «Crear OC» para generar una orden en borrador con lo sugerido. Edita mínimos con el lápiz de cada fila.</CardDescription>
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Producto, código o categoría…" className="pl-9 w-64" />
              </div>
              <Select value={filtro} onValueChange={(v) => setFiltro(v as typeof filtro)}>
                <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="atencion">Requieren atención</SelectItem>
                  <SelectItem value="todos">Todos</SelectItem>
                  <SelectItem value="Sin stock">Sin stock</SelectItem>
                  <SelectItem value="Bajo mínimo">Bajo mínimo</SelectItem>
                  <SelectItem value="Reordenar">Reordenar</SelectItem>
                  <SelectItem value="OK">OK</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-4 md:p-6 pt-0">
          {loading ? (
            <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground"><Spinner /> Calculando…</div>
          ) : filtradas.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Nada que reponer con este filtro.</p>
          ) : (
            <>
              <div className="overflow-x-auto border rounded-lg">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-stone-50">
                      <TableHead className="w-8" />
                      <TableHead>Producto</TableHead>
                      <TableHead>Estado</TableHead>
                      <TableHead className="text-right">Stock</TableHead>
                      <TableHead className="text-right">Tránsito</TableHead>
                      <TableHead className="text-right">Mínimo</TableHead>
                      <TableHead className="text-right">Reorden</TableHead>
                      <TableHead className="text-right">Venta/día</TableHead>
                      <TableHead className="text-right">Cobertura</TableHead>
                      <TableHead className="text-right">Lead time</TableHead>
                      <TableHead className="text-right">Sugerido</TableHead>
                      <TableHead className="w-10" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pagina.map((f) => {
                      const e = edicion[f.producto_id]
                      return (
                        <TableRow key={f.producto_id}>
                          <TableCell><Checkbox checked={seleccion[f.producto_id] != null} onCheckedChange={(v) => toggleSel(f, v === true)} aria-label="Seleccionar" /></TableCell>
                          <TableCell>
                            <p className="font-medium text-sm">{f.nombre}</p>
                            <p className="text-xs text-muted-foreground">{[f.codigo, f.categoria_nombre].filter(Boolean).join(" · ")}</p>
                          </TableCell>
                          <TableCell><Badge variant="outline" className={`border-0 ${ESTADO_CLS[f.estado]}`}>{f.estado}</Badge></TableCell>
                          <TableCell className="text-right">{formatNumber(f.stock)}</TableCell>
                          <TableCell className="text-right text-muted-foreground">{f.en_transito > 0 ? formatNumber(f.en_transito) : "—"}</TableCell>
                          <TableCell className="text-right">
                            {e ? <Input type="number" min="0" value={e.min} onChange={(ev) => setEdicion((p) => ({ ...p, [f.producto_id]: { ...e, min: ev.target.value } }))} className="h-8 w-20 text-right ml-auto" /> : formatNumber(f.stock_minimo)}
                          </TableCell>
                          <TableCell className="text-right">
                            {e ? <Input type="number" min="0" value={e.reorden} onChange={(ev) => setEdicion((p) => ({ ...p, [f.producto_id]: { ...e, reorden: ev.target.value } }))} className="h-8 w-20 text-right ml-auto" /> : formatNumber(f.punto_reorden)}
                          </TableCell>
                          <TableCell className="text-right">{f.venta_diaria > 0 ? f.venta_diaria.toFixed(2) : "—"}</TableCell>
                          <TableCell className={`text-right ${f.cobertura_dias != null && f.lead_time_dias != null && f.cobertura_dias < f.lead_time_dias ? "text-red-700 font-medium" : ""}`}>{f.cobertura_dias != null ? `${f.cobertura_dias} d` : "—"}</TableCell>
                          <TableCell className="text-right">{f.lead_time_dias != null ? `${f.lead_time_dias} d` : "—"}</TableCell>
                          <TableCell className="text-right">
                            {seleccion[f.producto_id] != null ? (
                              <Input type="number" min="1" value={seleccion[f.producto_id]} onChange={(ev) => setSeleccion((p) => ({ ...p, [f.producto_id]: Number(ev.target.value) || 0 }))} className="h-8 w-20 text-right ml-auto" />
                            ) : (
                              <span className={f.sugerido > 0 ? "font-semibold text-orange-700" : "text-muted-foreground"}>{f.sugerido > 0 ? formatNumber(f.sugerido) : "—"}</span>
                            )}
                          </TableCell>
                          <TableCell>
                            {e ? (
                              <div className="flex items-center gap-1">
                                <Input type="number" min="0" value={e.lote} onChange={(ev) => setEdicion((p) => ({ ...p, [f.producto_id]: { ...e, lote: ev.target.value } }))} className="h-8 w-16" title="Lote fijo de compra (opcional)" placeholder="lote" />
                                <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => guardarMinimos(f)} disabled={guardando === f.producto_id} aria-label="Guardar mínimos">
                                  {guardando === f.producto_id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                                </Button>
                              </div>
                            ) : (
                              <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => editar(f)} disabled={pendiente}>Mínimos</Button>
                            )}
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>
              <TablePaginator pageIndex={pageIndex} pageSize={pageSize} totalItems={filtradas.length} onPageIndexChange={setPageIndex} onPageSizeChange={(s) => { setPageSize(s); setPageIndex(0) }} className="mt-3" />
            </>
          )}
        </CardContent>
      </Card>

      <Dialog open={ocOpen} onOpenChange={setOcOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Crear orden de compra ({nSel} productos)</DialogTitle>
            <DialogDescription>Se crea en Pendiente con las cantidades marcadas y el costo promedio actual como costo unitario; podrás editarla antes de enviarla.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label>Proveedor</Label>
              <Select value={proveedorId} onValueChange={setProveedorId}>
                <SelectTrigger><SelectValue placeholder="Elige el proveedor" /></SelectTrigger>
                <SelectContent>{proveedores.map((p) => <SelectItem key={p.id} value={String(p.id)}>{p.nombre}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Fecha tentativa de llegada</Label>
              <Input type="date" value={fechaTentativa} min={hoy} onChange={(e) => setFechaTentativa(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOcOpen(false)}>Cancelar</Button>
            <Button onClick={crearOC} disabled={creando} className="gap-2">{creando && <Loader2 className="h-4 w-4 animate-spin" />} Crear OC</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
