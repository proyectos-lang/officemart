"use client"

import * as React from "react"
import { Coins, Plus, Pencil, Trash2, Loader2, Search, Download, CheckCircle2, Ban, Wallet } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Spinner } from "@/components/ui/spinner"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { useToast } from "@/hooks/use-toast"
import { useTenant } from "@/lib/hooks/use-tenant"
import { formatCurrency } from "@/lib/utils/format"
import { getHondurasTodayISODate, formatHondurasDate } from "@/lib/utils/honduras-time"
import { exportToXlsx } from "@/lib/utils/export"
import { getVendedores, type Vendedor } from "@/lib/services/vendedores"
import { getCategorias, getLineasProducto, type Categoria, type LineaProducto } from "@/lib/services/catalogos"
import { getCuentas, type CuentaConfig } from "@/lib/services/cuentas"
import {
  getPoliticasComision, savePoliticaComision, deletePoliticaComision, calcularComisionesPeriodo, liquidarComisiones,
  getLiquidaciones, marcarLiquidacionPagada, anularLiquidacion, COMISIONES_FEATURE_PENDING,
  type PoliticaComision, type ResumenVendedorComision, type Liquidacion,
} from "@/lib/services/comisiones"

const NONE = "__none__"
const POL_VACIA: PoliticaComision = { nombre: "", vendedor_id: null, base: "venta", porcentaje: 0, categoria_id: null, linea_id: null, momento: "cobro", vigente_desde: null, vigente_hasta: null, activo: true }

export default function ComisionesPage() {
  const { toast } = useToast()
  const { ready, razonSocialId } = useTenant()
  const hoy = getHondurasTodayISODate()

  const [pendiente, setPendiente] = React.useState(false)
  const [vendedores, setVendedores] = React.useState<Vendedor[]>([])
  const [categorias, setCategorias] = React.useState<Categoria[]>([])
  const [lineas, setLineas] = React.useState<LineaProducto[]>([])
  const [cuentas, setCuentas] = React.useState<CuentaConfig[]>([])
  const vendedorNombre = React.useMemo(() => new Map(vendedores.map((v) => [v.id, v.nombre])), [vendedores])

  // Políticas
  const [politicas, setPoliticas] = React.useState<PoliticaComision[]>([])
  const [polDialog, setPolDialog] = React.useState(false)
  const [polForm, setPolForm] = React.useState<PoliticaComision>(POL_VACIA)
  const [polSaving, setPolSaving] = React.useState(false)

  // Cálculo
  const [desde, setDesde] = React.useState(`${hoy.slice(0, 7)}-01`)
  const [hasta, setHasta] = React.useState(hoy)
  const [vendedorFiltro, setVendedorFiltro] = React.useState(NONE)
  const [calculando, setCalculando] = React.useState(false)
  const [resumen, setResumen] = React.useState<ResumenVendedorComision[] | null>(null)

  // Liquidar
  const [liq, setLiq] = React.useState<ResumenVendedorComision | null>(null)
  const [liqPagar, setLiqPagar] = React.useState(false)
  const [liqMetodo, setLiqMetodo] = React.useState<"Efectivo" | "Banco">("Efectivo")
  const [liqCuenta, setLiqCuenta] = React.useState("")
  const [liqNotas, setLiqNotas] = React.useState("")
  const [liquidando, setLiquidando] = React.useState(false)

  // Liquidaciones
  const [liquidaciones, setLiquidaciones] = React.useState<Liquidacion[]>([])

  React.useEffect(() => {
    if (!ready || razonSocialId == null) return
    cargar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, razonSocialId])

  async function cargar() {
    const [v, c, l, cu, p, lq] = await Promise.all([getVendedores(), getCategorias(), getLineasProducto(), getCuentas(), getPoliticasComision(), getLiquidaciones()])
    setVendedores(v.data || [])
    setCategorias(c.data || [])
    setLineas(l.data || [])
    setCuentas((cu.data || []).filter((x) => x.activo ?? true))
    setPoliticas(p.data)
    setPendiente(p.pendiente || lq.pendiente)
    setLiquidaciones(lq.data)
  }

  async function guardarPolitica() {
    setPolSaving(true)
    const { error } = await savePoliticaComision(polForm)
    setPolSaving(false)
    if (error) {
      toast({ title: "No se pudo guardar", description: error, variant: "destructive" })
      return
    }
    toast({ title: "Política guardada" })
    setPolDialog(false)
    cargar()
  }

  async function borrarPolitica(p: PoliticaComision) {
    if (!p.id || !confirm(`¿Eliminar la política "${p.nombre}"?`)) return
    const { error } = await deletePoliticaComision(p.id)
    if (error) toast({ title: "Error", description: error, variant: "destructive" })
    else cargar()
  }

  async function calcular() {
    setCalculando(true)
    const { data, error, pendiente: p } = await calcularComisionesPeriodo(desde, hasta, { vendedorId: vendedorFiltro === NONE ? null : Number(vendedorFiltro) })
    setCalculando(false)
    if (p) setPendiente(true)
    if (error) toast({ title: "No se pudo calcular", description: error, variant: "destructive" })
    setResumen(data)
  }

  async function confirmarLiquidar() {
    if (!liq) return
    if (liqPagar && liqMetodo === "Banco" && !liqCuenta) {
      toast({ title: "Elige la cuenta", variant: "destructive" })
      return
    }
    setLiquidando(true)
    const { data, error } = await liquidarComisiones({
      vendedor_id: liq.vendedor_id,
      desde,
      hasta,
      items: liq.items,
      notas: liqNotas,
      pago: liqPagar ? { metodo: liqMetodo, cuenta_id: liqMetodo === "Banco" ? Number(liqCuenta) : null } : null,
    })
    setLiquidando(false)
    if (error || !data) {
      toast({ title: "No se pudo liquidar", description: error ?? "", variant: "destructive" })
      return
    }
    toast({ title: `Liquidación #${data.id} registrada`, description: data.gasto_id ? `Gasto de comisiones #${data.gasto_id} ${liqPagar ? "pagado" : "pendiente"} en Finanzas → Gastos.` : "Sin gasto (revisa conceptos de gasto)." })
    setLiq(null)
    calcular()
    cargar()
  }

  function exportar() {
    if (!resumen) return
    exportToXlsx(
      resumen.flatMap((r) => r.items.map((i) => ({ Vendedor: vendedorNombre.get(r.vendedor_id) || `#${r.vendedor_id}`, Fecha: i.fecha, Concepto: i.concepto, Factura: i.numero_factura, Politica: i.politica, Base: i.base, "%": i.porcentaje, Comision: i.monto }))),
      { filename: `comisiones_${desde}_${hasta}`, sheetName: "Comisiones" }
    )
  }

  return (
    <div className="space-y-4 md:space-y-6">
      <div className="flex items-center gap-3">
        <div className="rounded-lg bg-amber-100 p-2 text-amber-700"><Coins className="h-5 w-5" /></div>
        <div>
          <h1 className="text-2xl font-semibold text-stone-800">Comisiones</h1>
          <p className="text-sm text-muted-foreground">Políticas por vendedor, categoría o línea; cálculo del período al facturar o al cobrar; liquidación con gasto.</p>
        </div>
      </div>
      {pendiente && <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{COMISIONES_FEATURE_PENDING}</div>}

      <Tabs defaultValue="calculo">
        <TabsList>
          <TabsTrigger value="calculo">Calcular</TabsTrigger>
          <TabsTrigger value="politicas">Políticas ({politicas.length})</TabsTrigger>
          <TabsTrigger value="liquidaciones">Liquidaciones ({liquidaciones.length})</TabsTrigger>
        </TabsList>

        {/* ---- Calcular ---- */}
        <TabsContent value="calculo" className="space-y-4">
          <Card>
            <CardContent className="p-4 flex flex-col md:flex-row md:items-end gap-3">
              <div className="grid gap-1.5"><Label>Desde</Label><Input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /></div>
              <div className="grid gap-1.5"><Label>Hasta</Label><Input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} /></div>
              <div className="grid gap-1.5">
                <Label>Vendedor</Label>
                <Select value={vendedorFiltro} onValueChange={setVendedorFiltro}>
                  <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Todos</SelectItem>
                    {vendedores.map((v) => <SelectItem key={v.id} value={String(v.id)}>{v.nombre}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <Button onClick={calcular} disabled={calculando} className="gap-2">{calculando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} Calcular</Button>
              <Button variant="outline" onClick={exportar} disabled={!resumen || resumen.length === 0} className="gap-1"><Download className="h-4 w-4" /> Excel</Button>
            </CardContent>
          </Card>

          {calculando ? (
            <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground"><Spinner /> Calculando…</div>
          ) : resumen == null ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Elige el período y presiona Calcular. Lo ya liquidado no vuelve a aparecer.</p>
          ) : resumen.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Sin comisiones en el período (¿hay políticas activas y ventas con vendedor?).</p>
          ) : (
            <Accordion type="multiple" className="space-y-2">
              {resumen.map((r) => (
                <AccordionItem key={r.vendedor_id} value={String(r.vendedor_id)} className="border rounded-lg px-3 bg-white">
                  <AccordionTrigger className="hover:no-underline py-3">
                    <div className="flex flex-1 items-center justify-between gap-3 pr-2">
                      <span className="font-medium">{vendedorNombre.get(r.vendedor_id) || `Vendedor #${r.vendedor_id}`}</span>
                      <div className="flex items-center gap-4 text-xs text-stone-600">
                        <span className="hidden md:inline">Ventas {formatCurrency(r.ventas)}</span>
                        <span className="hidden md:inline">Cobrado {formatCurrency(r.cobrado)}</span>
                        {r.devoluciones > 0 && <span className="hidden md:inline text-red-700">Dev. {formatCurrency(r.devoluciones)}</span>}
                        <span className="font-semibold text-base text-stone-900">{formatCurrency(r.comision)}</span>
                      </div>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="pb-3 space-y-2">
                    <div className="overflow-x-auto border rounded-lg">
                      <Table>
                        <TableHeader><TableRow className="bg-stone-50"><TableHead>Fecha</TableHead><TableHead>Concepto</TableHead><TableHead>Política</TableHead><TableHead className="text-right">Base</TableHead><TableHead className="text-right">%</TableHead><TableHead className="text-right">Comisión</TableHead></TableRow></TableHeader>
                        <TableBody>
                          {r.items.map((i, idx) => (
                            <TableRow key={idx} className={i.monto < 0 ? "text-red-700" : ""}>
                              <TableCell className="whitespace-nowrap">{i.fecha}</TableCell>
                              <TableCell>{i.concepto}</TableCell>
                              <TableCell className="text-xs text-muted-foreground">{i.politica}</TableCell>
                              <TableCell className="text-right">{formatCurrency(i.base)}</TableCell>
                              <TableCell className="text-right">{i.porcentaje}%</TableCell>
                              <TableCell className="text-right font-medium">{formatCurrency(i.monto)}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                    <div className="flex justify-end">
                      <Button size="sm" onClick={() => { setLiq(r); setLiqPagar(false); setLiqMetodo("Efectivo"); setLiqCuenta(""); setLiqNotas("") }} disabled={r.comision <= 0} className="gap-1">
                        <Wallet className="h-4 w-4" /> Liquidar {formatCurrency(r.comision)}
                      </Button>
                    </div>
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          )}
        </TabsContent>

        {/* ---- Políticas ---- */}
        <TabsContent value="politicas">
          <Card>
            <CardHeader className="p-4 md:p-6 flex flex-row items-start justify-between gap-3">
              <div>
                <CardTitle className="text-base">Políticas de comisión</CardTitle>
                <CardDescription>La más específica gana: vendedor &gt; categoría/línea &gt; general. Base venta (sin ISV) o utilidad; al facturar o al cobrar.</CardDescription>
              </div>
              <Button size="sm" onClick={() => { setPolForm(POL_VACIA); setPolDialog(true) }} disabled={pendiente} className="gap-1"><Plus className="h-4 w-4" /> Nueva</Button>
            </CardHeader>
            <CardContent className="p-4 md:p-6 pt-0">
              {politicas.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">Sin políticas. Crea una general (p. ej. 3 % sobre venta al cobro).</p>
              ) : (
                <div className="overflow-x-auto border rounded-lg">
                  <Table>
                    <TableHeader><TableRow className="bg-stone-50"><TableHead>Nombre</TableHead><TableHead>Vendedor</TableHead><TableHead>Aplica a</TableHead><TableHead>Base</TableHead><TableHead>Momento</TableHead><TableHead className="text-right">%</TableHead><TableHead>Vigencia</TableHead><TableHead>Estado</TableHead><TableHead className="w-20" /></TableRow></TableHeader>
                    <TableBody>
                      {politicas.map((p) => (
                        <TableRow key={p.id}>
                          <TableCell className="font-medium">{p.nombre}</TableCell>
                          <TableCell>{p.vendedor_id != null ? vendedorNombre.get(p.vendedor_id) || `#${p.vendedor_id}` : "Todos"}</TableCell>
                          <TableCell className="text-sm">{p.categoria_id != null ? `Cat. ${categorias.find((c) => c.id === p.categoria_id)?.nombre || p.categoria_id}` : p.linea_id != null ? `Línea ${lineas.find((l) => l.id === p.linea_id)?.nombre || p.linea_id}` : "Todo"}</TableCell>
                          <TableCell>{p.base === "utilidad" ? "Utilidad" : "Venta"}</TableCell>
                          <TableCell>{p.momento === "cobro" ? "Al cobrar" : "Al facturar"}</TableCell>
                          <TableCell className="text-right">{p.porcentaje}%</TableCell>
                          <TableCell className="text-xs">{p.vigente_desde || "—"} → {p.vigente_hasta || "—"}</TableCell>
                          <TableCell><Badge variant={p.activo ? "default" : "secondary"}>{p.activo ? "Activa" : "Inactiva"}</Badge></TableCell>
                          <TableCell>
                            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { setPolForm(p); setPolDialog(true) }}><Pencil className="h-4 w-4" /></Button>
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-red-600" onClick={() => borrarPolitica(p)}><Trash2 className="h-4 w-4" /></Button>
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

        {/* ---- Liquidaciones ---- */}
        <TabsContent value="liquidaciones">
          <Card>
            <CardHeader className="p-4 md:p-6"><CardTitle className="text-base">Liquidaciones</CardTitle><CardDescription>Cada liquidación crea un gasto "Comisiones de ventas"; márcala pagada cuando se pague desde Finanzas → Gastos.</CardDescription></CardHeader>
            <CardContent className="p-4 md:p-6 pt-0">
              {liquidaciones.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">Sin liquidaciones.</p>
              ) : (
                <div className="overflow-x-auto border rounded-lg">
                  <Table>
                    <TableHeader><TableRow className="bg-stone-50"><TableHead>#</TableHead><TableHead>Vendedor</TableHead><TableHead>Período</TableHead><TableHead className="text-right">Total</TableHead><TableHead>Estado</TableHead><TableHead>Gasto</TableHead><TableHead>Creada</TableHead><TableHead className="w-24" /></TableRow></TableHeader>
                    <TableBody>
                      {liquidaciones.map((l) => (
                        <TableRow key={l.id} className={l.estado === "Anulada" ? "opacity-50" : ""}>
                          <TableCell className="font-mono text-sm">{l.id}</TableCell>
                          <TableCell>{l.vendedor_nombre || vendedorNombre.get(l.vendedor_id) || `#${l.vendedor_id}`}</TableCell>
                          <TableCell className="text-sm whitespace-nowrap">{l.periodo_desde} → {l.periodo_hasta}</TableCell>
                          <TableCell className="text-right font-medium">{formatCurrency(l.total)}</TableCell>
                          <TableCell><Badge variant="outline" className={l.estado === "Pagada" ? "text-emerald-700" : l.estado === "Anulada" ? "text-stone-500" : "text-amber-700"}>{l.estado}</Badge></TableCell>
                          <TableCell className="text-sm">{l.gasto_id ? `#${l.gasto_id}` : "—"}</TableCell>
                          <TableCell className="text-sm whitespace-nowrap">{formatHondurasDate(l.created_at)}</TableCell>
                          <TableCell>
                            {l.estado === "Aprobada" && (
                              <>
                                <Button variant="ghost" size="icon" className="h-8 w-8 text-emerald-700" title="Marcar pagada" onClick={async () => { const { error } = await marcarLiquidacionPagada(l.id); if (error) toast({ title: "Error", description: error, variant: "destructive" }); else cargar() }}><CheckCircle2 className="h-4 w-4" /></Button>
                                <Button variant="ghost" size="icon" className="h-8 w-8 text-red-600" title="Anular" onClick={async () => { const m = prompt("Motivo de anulación:"); if (!m) return; const { error } = await anularLiquidacion(l.id, m); if (error) toast({ title: "Error", description: error, variant: "destructive" }); else cargar() }}><Ban className="h-4 w-4" /></Button>
                              </>
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
        </TabsContent>
      </Tabs>

      {/* Política */}
      <Dialog open={polDialog} onOpenChange={setPolDialog}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>{polForm.id ? "Editar política" : "Nueva política"}</DialogTitle><DialogDescription>Deja vendedor, categoría y línea vacíos para una política general.</DialogDescription></DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5"><Label>Nombre</Label><Input value={polForm.nombre} onChange={(e) => setPolForm({ ...polForm, nombre: e.target.value })} placeholder="3 % general al cobro" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label>Vendedor</Label>
                <Select value={polForm.vendedor_id != null ? String(polForm.vendedor_id) : NONE} onValueChange={(v) => setPolForm({ ...polForm, vendedor_id: v === NONE ? null : Number(v) })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value={NONE}>Todos</SelectItem>{vendedores.map((v) => <SelectItem key={v.id} value={String(v.id)}>{v.nombre}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5"><Label>Porcentaje</Label><Input type="number" min="0" step="any" value={polForm.porcentaje || ""} onChange={(e) => setPolForm({ ...polForm, porcentaje: Number(e.target.value) })} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label>Base</Label>
                <Select value={polForm.base} onValueChange={(v) => setPolForm({ ...polForm, base: v as "venta" | "utilidad" })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="venta">Venta (sin ISV)</SelectItem><SelectItem value="utilidad">Utilidad (venta − costo)</SelectItem></SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label>Momento</Label>
                <Select value={polForm.momento} onValueChange={(v) => setPolForm({ ...polForm, momento: v as "cobro" | "facturacion" })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="cobro">Al cobrar (proporcional a lo cobrado)</SelectItem><SelectItem value="facturacion">Al facturar</SelectItem></SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label>Solo categoría</Label>
                <Select value={polForm.categoria_id != null ? String(polForm.categoria_id) : NONE} onValueChange={(v) => setPolForm({ ...polForm, categoria_id: v === NONE ? null : Number(v), linea_id: v === NONE ? polForm.linea_id : null })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value={NONE}>Todas</SelectItem>{categorias.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.nombre}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label>Solo línea</Label>
                <Select value={polForm.linea_id != null ? String(polForm.linea_id) : NONE} onValueChange={(v) => setPolForm({ ...polForm, linea_id: v === NONE ? null : Number(v), categoria_id: v === NONE ? polForm.categoria_id : null })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value={NONE}>Todas</SelectItem>{lineas.map((l) => <SelectItem key={l.id} value={String(l.id)}>{l.nombre}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5"><Label>Vigente desde</Label><Input type="date" value={polForm.vigente_desde ?? ""} onChange={(e) => setPolForm({ ...polForm, vigente_desde: e.target.value || null })} /></div>
              <div className="grid gap-1.5"><Label>Vigente hasta</Label><Input type="date" value={polForm.vigente_hasta ?? ""} onChange={(e) => setPolForm({ ...polForm, vigente_hasta: e.target.value || null })} /></div>
            </div>
            <label className="flex items-center gap-2 text-sm"><Switch checked={polForm.activo} onCheckedChange={(v) => setPolForm({ ...polForm, activo: v })} /> Activa</label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPolDialog(false)}>Cancelar</Button>
            <Button onClick={guardarPolitica} disabled={polSaving} className="gap-2">{polSaving && <Loader2 className="h-4 w-4 animate-spin" />} Guardar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Liquidar */}
      <Dialog open={liq !== null} onOpenChange={(o) => { if (!o) setLiq(null) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Liquidar comisiones · {liq ? vendedorNombre.get(liq.vendedor_id) : ""}</DialogTitle>
            <DialogDescription>{liq ? `${liq.items.length} concepto(s) del ${desde} al ${hasta} por ${formatCurrency(liq.comision)}. Se crea el gasto "Comisiones de ventas".` : ""}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <label className="flex items-center gap-2 text-sm"><Switch checked={liqPagar} onCheckedChange={setLiqPagar} /> Pagar ahora (sale de caja o banco)</label>
            {liqPagar && (
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label>Método</Label>
                  <Select value={liqMetodo} onValueChange={(v) => setLiqMetodo(v as "Efectivo" | "Banco")}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="Efectivo">Efectivo (caja chica)</SelectItem><SelectItem value="Banco">Banco</SelectItem></SelectContent>
                  </Select>
                </div>
                {liqMetodo === "Banco" && (
                  <div className="grid gap-1.5">
                    <Label>Cuenta</Label>
                    <Select value={liqCuenta} onValueChange={setLiqCuenta}>
                      <SelectTrigger><SelectValue placeholder="Cuenta" /></SelectTrigger>
                      <SelectContent>{cuentas.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.nombre}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                )}
              </div>
            )}
            <div className="grid gap-1.5"><Label>Notas</Label><Textarea rows={2} value={liqNotas} onChange={(e) => setLiqNotas(e.target.value)} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLiq(null)}>Cancelar</Button>
            <Button onClick={confirmarLiquidar} disabled={liquidando} className="gap-2">{liquidando && <Loader2 className="h-4 w-4 animate-spin" />} Liquidar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
