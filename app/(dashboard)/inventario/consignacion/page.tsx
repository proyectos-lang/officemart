"use client"

import * as React from "react"
import Link from "next/link"
import { Handshake, Loader2, Save, Wallet, Ban, Download } from "lucide-react"
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
import { formatCurrency, formatNumber } from "@/lib/utils/format"
import { formatHondurasDate } from "@/lib/utils/honduras-time"
import { exportToXlsx } from "@/lib/utils/export"
import { getProveedores, type Proveedor } from "@/lib/services/catalogos"
import {
  getLocalizacionesConsignacion, setLocalizacionConsignacion, getConsignacionPendiente, liquidarConsignacion,
  getLiquidacionesConsignacion, anularLiquidacionConsignacion, getValoracionConsignacion, CONSIGNACION_FEATURE_PENDING,
  type LocalizacionConsignacion, type GrupoConsignacion, type LiquidacionConsignacion,
} from "@/lib/services/consignacion"

const NONE = "__none__"

export default function ConsignacionPage() {
  const { toast } = useToast()
  const { ready, razonSocialId } = useTenant()

  const [loading, setLoading] = React.useState(true)
  const [pendiente, setPendiente] = React.useState(false)
  const [locs, setLocs] = React.useState<LocalizacionConsignacion[]>([])
  const [proveedores, setProveedores] = React.useState<Proveedor[]>([])
  const [grupos, setGrupos] = React.useState<GrupoConsignacion[]>([])
  const [liquidaciones, setLiquidaciones] = React.useState<LiquidacionConsignacion[]>([])
  const [valoracion, setValoracion] = React.useState<Awaited<ReturnType<typeof getValoracionConsignacion>>["data"]>(null)
  // Edición de localización: id -> { consignacion, proveedor }
  const [edicion, setEdicion] = React.useState<Record<number, { consignacion: boolean; proveedor: string }>>({})
  const [guardando, setGuardando] = React.useState<number | null>(null)
  // Liquidar
  const [liq, setLiq] = React.useState<GrupoConsignacion | null>(null)
  const [liqDias, setLiqDias] = React.useState("30")
  const [liqNotas, setLiqNotas] = React.useState("")
  const [liquidando, setLiquidando] = React.useState(false)

  React.useEffect(() => {
    if (!ready || razonSocialId == null) return
    cargar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, razonSocialId])

  async function cargar() {
    setLoading(true)
    const [pend, prov, lq, val] = await Promise.all([getConsignacionPendiente(), getProveedores(), getLiquidacionesConsignacion(), getValoracionConsignacion()])
    setPendiente(pend.pendiente || lq.pendiente)
    if (pend.error) toast({ title: "No se pudo cargar", description: pend.error, variant: "destructive" })
    setLocs(pend.locs)
    setGrupos(pend.data)
    setProveedores(prov.data || [])
    setLiquidaciones(lq.data)
    setValoracion(val.data)
    setLoading(false)
  }

  function editar(l: LocalizacionConsignacion) {
    setEdicion((prev) => ({ ...prev, [l.localizacion_id]: prev[l.localizacion_id] ?? { consignacion: l.tipo === "consignacion", proveedor: l.propietario_proveedor_id != null ? String(l.propietario_proveedor_id) : NONE } }))
  }

  async function guardarLoc(l: LocalizacionConsignacion) {
    const e = edicion[l.localizacion_id]
    if (!e) return
    setGuardando(l.localizacion_id)
    const { error } = await setLocalizacionConsignacion(l.localizacion_id, { consignacion: e.consignacion, propietario_proveedor_id: e.proveedor === NONE ? null : Number(e.proveedor) })
    setGuardando(null)
    if (error) {
      toast({ title: "No se pudo guardar", description: error, variant: "destructive" })
      return
    }
    setEdicion((prev) => { const n = { ...prev }; delete n[l.localizacion_id]; return n })
    toast({ title: "Localización actualizada", description: l.localizacion_nombre })
    cargar()
  }

  async function confirmarLiquidar() {
    if (!liq) return
    setLiquidando(true)
    const { data, error } = await liquidarConsignacion({ proveedor_id: liq.proveedor_id, localizacion_id: liq.localizacion_id, items: liq.items, dias_credito: Number(liqDias) || 30, notas: liqNotas })
    setLiquidando(false)
    if (error || !data) {
      toast({ title: "No se pudo liquidar", description: error ?? "", variant: "destructive" })
      return
    }
    toast({ title: `Liquidación #${data.id} registrada`, description: data.compra_id ? `OC-${data.compra_id} a crédito creada; págala desde Compras → Orden de Compra o CxP.` : "Sin OC generada." })
    setLiq(null)
    cargar()
  }

  function exportar() {
    exportToXlsx(
      grupos.flatMap((g) => g.items.map((i) => ({ Proveedor: g.proveedor_nombre, Localizacion: g.localizacion_nombre, Fecha: formatHondurasDate(i.fecha), Factura: i.numero_factura || "", Producto: i.producto_nombre, Cantidad: i.cantidad, "Costo pactado": i.costo_pactado, Monto: i.monto }))),
      { filename: "consignacion_por_liquidar", sheetName: "Consignación" }
    )
  }

  const totalPendiente = grupos.reduce((a, g) => a + g.total, 0)

  return (
    <div className="space-y-4 md:space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-lime-100 p-2 text-lime-700"><Handshake className="h-5 w-5" /></div>
          <div>
            <h1 className="text-2xl font-semibold text-stone-800">Consignación</h1>
            <p className="text-sm text-muted-foreground">Mercancía de proveedores que solo se paga al venderse: localizaciones en consignación, ventas por liquidar y liquidaciones.</p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={exportar} disabled={grupos.length === 0} className="gap-1"><Download className="h-4 w-4" /> Excel</Button>
      </div>
      {pendiente && <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{CONSIGNACION_FEATURE_PENDING}</div>}

      <div className="grid gap-3 sm:grid-cols-4">
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Por liquidar a proveedores</p><p className="text-2xl font-semibold text-red-700">{formatCurrency(totalPendiente)}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Inventario consignado (a costo)</p><p className="text-2xl font-semibold">{formatCurrency(valoracion?.consignado || 0)}</p><p className="text-xs text-muted-foreground">{formatNumber(valoracion?.unidadesConsignadas || 0)} unidades</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Inventario propio (a costo)</p><p className="text-2xl font-semibold">{formatCurrency(valoracion?.propio || 0)}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Localizaciones en consignación</p><p className="text-2xl font-semibold">{locs.filter((l) => l.tipo === "consignacion").length}</p></CardContent></Card>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground"><Spinner /> Cargando…</div>
      ) : (
        <Tabs defaultValue="liquidar">
          <TabsList>
            <TabsTrigger value="liquidar">Por liquidar ({grupos.length})</TabsTrigger>
            <TabsTrigger value="locs">Localizaciones</TabsTrigger>
            <TabsTrigger value="liquidaciones">Liquidaciones ({liquidaciones.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="liquidar" className="space-y-3">
            {grupos.length === 0 ? (
              <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">No hay ventas consignadas pendientes de liquidar. Marca localizaciones en consignación en la pestaña Localizaciones.</CardContent></Card>
            ) : (
              <Accordion type="multiple" className="space-y-2">
                {grupos.map((g) => (
                  <AccordionItem key={`${g.proveedor_id}-${g.localizacion_id}`} value={`${g.proveedor_id}-${g.localizacion_id}`} className="border rounded-lg px-3 bg-white">
                    <AccordionTrigger className="hover:no-underline py-3">
                      <div className="flex flex-1 items-center justify-between gap-3 pr-2">
                        <div className="min-w-0">
                          <span className="font-medium">{g.proveedor_nombre}</span>
                          <span className="text-xs text-muted-foreground"> · {g.localizacion_nombre} · {g.items.length} venta(s)</span>
                        </div>
                        <span className="font-semibold">{formatCurrency(g.total)}</span>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="pb-3 space-y-2">
                      <div className="overflow-x-auto border rounded-lg">
                        <Table>
                          <TableHeader><TableRow className="bg-stone-50"><TableHead>Fecha</TableHead><TableHead>Factura</TableHead><TableHead>Producto</TableHead><TableHead className="text-right">Cant.</TableHead><TableHead className="text-right">Costo pactado</TableHead><TableHead className="text-right">Monto</TableHead></TableRow></TableHeader>
                          <TableBody>
                            {g.items.map((i) => (
                              <TableRow key={i.transaccion_id}>
                                <TableCell className="whitespace-nowrap">{formatHondurasDate(i.fecha)}</TableCell>
                                <TableCell className="font-mono text-sm">{i.numero_factura || `#${i.venta_id}`}</TableCell>
                                <TableCell>{i.producto_nombre}</TableCell>
                                <TableCell className="text-right">{formatNumber(i.cantidad)}</TableCell>
                                <TableCell className="text-right">{formatCurrency(i.costo_pactado)}</TableCell>
                                <TableCell className="text-right font-medium">{formatCurrency(i.monto)}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                      <div className="flex justify-end">
                        <Button size="sm" onClick={() => { setLiq(g); setLiqDias("30"); setLiqNotas("") }} className="gap-1"><Wallet className="h-4 w-4" /> Liquidar {formatCurrency(g.total)}</Button>
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            )}
          </TabsContent>

          <TabsContent value="locs">
            <Card>
              <CardHeader className="p-4 md:p-6"><CardTitle className="text-base">Localizaciones</CardTitle><CardDescription>Marca una localización como consignación y su proveedor propietario. Lo que se venda desde ella queda por liquidar; su stock se valora aparte.</CardDescription></CardHeader>
              <CardContent className="p-4 md:p-6 pt-0">
                <div className="overflow-x-auto border rounded-lg">
                  <Table>
                    <TableHeader><TableRow className="bg-stone-50"><TableHead>Almacén</TableHead><TableHead>Localización</TableHead><TableHead>Consignación</TableHead><TableHead>Propietario</TableHead><TableHead className="text-right">Stock (a costo)</TableHead><TableHead className="w-24" /></TableRow></TableHeader>
                    <TableBody>
                      {locs.map((l) => {
                        const e = edicion[l.localizacion_id]
                        const val = valoracion?.porLocalizacion.find((p) => p.localizacion.localizacion_id === l.localizacion_id)
                        return (
                          <TableRow key={l.localizacion_id}>
                            <TableCell className="text-sm text-muted-foreground">{l.almacen_nombre}</TableCell>
                            <TableCell className="font-medium">{l.localizacion_nombre}</TableCell>
                            <TableCell>
                              {e ? <Switch checked={e.consignacion} onCheckedChange={(v) => setEdicion((p) => ({ ...p, [l.localizacion_id]: { ...e, consignacion: v } }))} /> : l.tipo === "consignacion" ? <Badge className="bg-lime-100 text-lime-800 border-0">Consignación</Badge> : <span className="text-xs text-muted-foreground">Propia</span>}
                            </TableCell>
                            <TableCell>
                              {e && e.consignacion ? (
                                <Select value={e.proveedor} onValueChange={(v) => setEdicion((p) => ({ ...p, [l.localizacion_id]: { ...e, proveedor: v } }))}>
                                  <SelectTrigger className="h-8 w-56"><SelectValue placeholder="Proveedor" /></SelectTrigger>
                                  <SelectContent><SelectItem value={NONE}>—</SelectItem>{proveedores.map((p) => <SelectItem key={p.id} value={String(p.id)}>{p.nombre}</SelectItem>)}</SelectContent>
                                </Select>
                              ) : (l.propietario_nombre || "—")}
                            </TableCell>
                            <TableCell className="text-right">{val ? formatCurrency(val.valor) : "—"}</TableCell>
                            <TableCell>
                              {e ? (
                                <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => guardarLoc(l)} disabled={guardando === l.localizacion_id}>{guardando === l.localizacion_id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}</Button>
                              ) : (
                                <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => editar(l)} disabled={pendiente}>Editar</Button>
                              )}
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="liquidaciones">
            <Card>
              <CardHeader className="p-4 md:p-6"><CardTitle className="text-base">Liquidaciones</CardTitle><CardDescription>Cada liquidación genera una orden de compra a crédito ya recibida; se paga desde la orden o desde Cuentas por Pagar → Compras a crédito.</CardDescription></CardHeader>
              <CardContent className="p-4 md:p-6 pt-0">
                {liquidaciones.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">Sin liquidaciones.</p>
                ) : (
                  <div className="overflow-x-auto border rounded-lg">
                    <Table>
                      <TableHeader><TableRow className="bg-stone-50"><TableHead>#</TableHead><TableHead>Proveedor</TableHead><TableHead>Período</TableHead><TableHead className="text-right">Total</TableHead><TableHead>OC</TableHead><TableHead>Estado</TableHead><TableHead>Fecha</TableHead><TableHead className="w-16" /></TableRow></TableHeader>
                      <TableBody>
                        {liquidaciones.map((l) => (
                          <TableRow key={l.id} className={l.estado === "Anulada" ? "opacity-50" : ""}>
                            <TableCell className="font-mono text-sm">{l.id}</TableCell>
                            <TableCell>{l.proveedor_nombre || `#${l.proveedor_id}`}</TableCell>
                            <TableCell className="text-sm whitespace-nowrap">{l.periodo_desde || "—"} → {l.periodo_hasta || "—"}</TableCell>
                            <TableCell className="text-right font-medium">{formatCurrency(l.total)}</TableCell>
                            <TableCell className="text-sm">{l.compra_id ? <Link href="/compras/orden" className="underline">OC-{l.compra_id}</Link> : "—"}</TableCell>
                            <TableCell><Badge variant="outline">{l.estado}</Badge></TableCell>
                            <TableCell className="text-sm whitespace-nowrap">{formatHondurasDate(l.created_at)}</TableCell>
                            <TableCell>
                              {l.estado === "Aprobada" && (
                                <Button variant="ghost" size="icon" className="h-8 w-8 text-red-600" title="Anular" onClick={async () => { const m = prompt("Motivo de anulación:"); if (!m) return; const { error } = await anularLiquidacionConsignacion(l.id, m); if (error) toast({ title: "Error", description: error, variant: "destructive" }); else cargar() }}><Ban className="h-4 w-4" /></Button>
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
      )}

      <Dialog open={liq !== null} onOpenChange={(o) => { if (!o) setLiq(null) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Liquidar a {liq?.proveedor_nombre}</DialogTitle>
            <DialogDescription>{liq ? `${liq.items.length} venta(s) de ${liq.localizacion_nombre} por ${formatCurrency(liq.total)} a costo pactado. Se crea una OC a crédito ya recibida (no mueve inventario).` : ""}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5"><Label>Días de crédito</Label><Input type="number" min="0" value={liqDias} onChange={(e) => setLiqDias(e.target.value)} className="w-32" /></div>
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
