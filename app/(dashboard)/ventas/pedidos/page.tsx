"use client"

import Link from "next/link"
import { useCallback, useEffect, useMemo, useState } from "react"
import {
  Link2, Copy, Ban, Plus, Search, Inbox, Eye, XCircle, CheckCircle2,
  Loader2, Download, Send, Trash2,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { Spinner } from "@/components/ui/spinner"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useToast } from "@/hooks/use-toast"
import { formatCurrency } from "@/lib/utils/format"
import { exportToXlsx } from "@/lib/utils/export"
import { useCajaSesion } from "@/lib/hooks/use-caja-sesion"
import {
  getProductos, getClientes, getAlmacenes, getLocalizaciones, saveCliente,
  type Producto, type Cliente, type Almacen, type Localizacion,
} from "@/lib/services/catalogos"
import { getCuentas, type CuentaConfig } from "@/lib/services/cuentas"
import {
  crearVenta, getNextCorrelativo, type PagoVentaDetalleInput,
} from "@/lib/services/ventas"
import { useAuth } from "@/lib/contexts/auth-context"
import { getPuntosFacturacion, resolverPuntoVenta } from "@/lib/services/puntos-facturacion"
import {
  crearLink, getLinks, anularLink, getPedidos, getPedidoConDetalle,
  actualizarLineaPedido, rechazarPedido, marcarPedidoAprobado,
  type CatalogoLink, type PedidoEncabezado, type PedidoLinea,
} from "@/lib/services/pedidos"

const ESTADO_LINK_BADGE: Record<string, string> = {
  Activo: "bg-emerald-100 text-emerald-700",
  Usado: "bg-sky-100 text-sky-700",
  Vencido: "bg-amber-100 text-amber-700",
  Anulado: "bg-stone-200 text-stone-500",
}
const ESTADO_PEDIDO_BADGE: Record<string, string> = {
  Pendiente: "bg-amber-100 text-amber-700",
  Aprobado: "bg-emerald-100 text-emerald-700",
  Rechazado: "bg-red-100 text-red-700",
}

/**
 * `created_at` y `fecha_expiracion` de los pedidos/links se guardan en UTC real
 * (now() / toISOString). Se muestran convirtiendo a la zona local (Honduras),
 * NO con `.split('T')[0]` (que enseñaria el dia UTC y de noche lo adelanta).
 */
function fechaLocal(iso?: string | null): string {
  if (!iso) return ""
  try {
    return new Date(iso).toLocaleDateString("es-HN")
  } catch {
    return iso.split("T")[0]
  }
}

export default function PedidosCatalogoPage() {
  const { toast } = useToast()

  const [links, setLinks] = useState<CatalogoLink[]>([])
  const [pedidos, setPedidos] = useState<PedidoEncabezado[]>([])
  const [loading, setLoading] = useState(true)
  const [featureMsg, setFeatureMsg] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    setLoading(true)
    const [l, p] = await Promise.all([getLinks(), getPedidos()])
    if (l.error) setFeatureMsg(l.error)
    setLinks(l.data)
    setPedidos(p.data)
    setLoading(false)
  }, [])

  useEffect(() => {
    cargar()
  }, [cargar])

  const pendientes = pedidos.filter((p) => p.estado === "Pendiente").length

  function exportarPedidos() {
    if (pedidos.length === 0) {
      toast({ title: "Sin datos", description: "No hay pedidos para exportar", variant: "destructive" })
      return
    }
    const rows: Record<string, unknown>[] = pedidos.map((p) => ({
      Pedido: p.numero_pedido || "",
      Fecha: fechaLocal(p.created_at),
      Cliente: p.cliente_nombre,
      Telefono: p.cliente_telefono || "",
      Link: p.link_nombre || "",
      Total: Number(p.total || 0),
      Estado: p.estado,
      Factura: p.venta_id ? `venta #${p.venta_id}` : "",
    }))
    exportToXlsx(rows, { sheetName: "Pedidos", filename: "Pedidos_Catalogo", colWidths: [12, 12, 24, 14, 20, 12, 12, 12] })
    toast({ title: "Exportado", description: "El archivo Excel se descargo correctamente" })
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold text-stone-800">Catálogo</h1>
          <p className="text-stone-500 text-sm mt-1">
            Genera links de catálogo para tus clientes y convierte sus pedidos en ventas.
          </p>
        </div>
      </div>

      {featureMsg && (
        <Card className="bg-amber-50/60 border-amber-300/60">
          <CardContent className="py-3 text-sm text-amber-800">{featureMsg}</CardContent>
        </Card>
      )}

      <Tabs defaultValue="pedidos">
        <TabsList>
          <TabsTrigger value="pedidos">
            Pedidos {pendientes > 0 && <Badge className="ml-2 bg-amber-500 text-white">{pendientes}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="links">Links de catálogo</TabsTrigger>
        </TabsList>

        {/* ================= TAB PEDIDOS ================= */}
        <TabsContent value="pedidos" className="space-y-4">
          <div className="flex justify-end">
            <Button variant="outline" className="gap-2" onClick={exportarPedidos}>
              <Download className="h-4 w-4" /> Exportar a Excel
            </Button>
          </div>
          <Card>
            <CardContent className="p-0">
              {loading ? (
                <div className="flex justify-center py-16"><Spinner className="h-8 w-8" /></div>
              ) : pedidos.length === 0 ? (
                <div className="py-16 text-center text-muted-foreground">
                  <Inbox className="h-10 w-10 mx-auto mb-2 text-stone-300" />
                  Aún no hay pedidos. Crea un link de catálogo y envíalo a un cliente.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table containerClassName="max-h-[60vh] overflow-y-auto">
                    <TableHeader sticky>
                      <TableRow>
                        <TableHead>Pedido</TableHead>
                        <TableHead>Fecha</TableHead>
                        <TableHead>Cliente</TableHead>
                        <TableHead>Teléfono</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                        <TableHead>Estado</TableHead>
                        <TableHead></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {[...pedidos]
                        .sort((a, b) => (a.estado === "Pendiente" ? -1 : 1) - (b.estado === "Pendiente" ? -1 : 1))
                        .map((p) => (
                          <TableRow key={p.id}>
                            <TableCell className="font-mono">{p.numero_pedido}</TableCell>
                            <TableCell className="text-sm">{fechaLocal(p.created_at)}</TableCell>
                            <TableCell>{p.cliente_nombre}</TableCell>
                            <TableCell className="text-sm">{p.cliente_telefono || "—"}</TableCell>
                            <TableCell className="text-right font-medium">{formatCurrency(Number(p.total || 0))}</TableCell>
                            <TableCell>
                              <Badge variant="secondary" className={ESTADO_PEDIDO_BADGE[p.estado]}>{p.estado}</Badge>
                            </TableCell>
                            <TableCell className="text-right">
                              <RevisarPedidoDialog pedido={p} onDone={cargar} />
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

        {/* ================= TAB LINKS ================= */}
        <TabsContent value="links" className="space-y-4">
          <div className="flex justify-end">
            <Button asChild className="gap-2">
              <Link href="/ventas/pedidos/nuevo-link"><Plus className="h-4 w-4" /> Nuevo link</Link>
            </Button>
          </div>
          <Card>
            <CardContent className="p-0">
              {loading ? (
                <div className="flex justify-center py-16"><Spinner className="h-8 w-8" /></div>
              ) : links.length === 0 ? (
                <div className="py-16 text-center text-muted-foreground">
                  <Link2 className="h-10 w-10 mx-auto mb-2 text-stone-300" />
                  Sin links todavía. Genera uno y compártelo con tu cliente.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table containerClassName="max-h-[60vh] overflow-y-auto">
                    <TableHeader sticky>
                      <TableRow>
                        <TableHead>Referencia</TableHead>
                        <TableHead>Tipo</TableHead>
                        <TableHead>Estado</TableHead>
                        <TableHead>Expira</TableHead>
                        <TableHead>Creado</TableHead>
                        <TableHead></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {links.map((l) => (
                        <TableRow key={l.id}>
                          <TableCell className="font-medium">{l.nombre || `Link #${l.id}`}</TableCell>
                          <TableCell className="text-sm">
                            {l.tipo === "completo" ? "Catálogo completo" : `Selección (${l.cantidad_productos})`}
                          </TableCell>
                          <TableCell>
                            <Badge variant="secondary" className={ESTADO_LINK_BADGE[l.estado]}>{l.estado}</Badge>
                          </TableCell>
                          <TableCell className="text-sm">
                            {l.fecha_expiracion ? fechaLocal(l.fecha_expiracion) : "Sin límite"}
                          </TableCell>
                          <TableCell className="text-sm">{fechaLocal(l.created_at)}</TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-1">
                              <Button
                                size="sm"
                                variant="outline"
                                className="gap-1"
                                disabled={l.estado !== "Activo"}
                                onClick={() => {
                                  const url = `${window.location.origin}/catalogo/${l.token}`
                                  navigator.clipboard.writeText(url)
                                  toast({ title: "Link copiado", description: url })
                                }}
                              >
                                <Copy className="h-3.5 w-3.5" /> Copiar
                              </Button>
                              {l.estado === "Activo" && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="text-red-600 hover:text-red-700"
                                  onClick={async () => {
                                    const res = await anularLink(l.id)
                                    if (res.error) toast({ title: "Error", description: res.error, variant: "destructive" })
                                    else { toast({ title: "Link anulado" }); cargar() }
                                  }}
                                >
                                  <Ban className="h-3.5 w-3.5" />
                                </Button>
                              )}
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
        </TabsContent>
      </Tabs>
    </div>
  )
}


// ==================== DIALOGO: REVISAR / APROBAR PEDIDO ====================

function RevisarPedidoDialog({ pedido, onDone }: { pedido: PedidoEncabezado; onDone: () => void }) {
  const { toast } = useToast()
  const { sesion: cajaSesion } = useCajaSesion()
  const { user } = useAuth()

  const [open, setOpen] = useState(false)
  const [lineas, setLineas] = useState<PedidoLinea[]>([])
  const [loading, setLoading] = useState(false)
  const [procesando, setProcesando] = useState(false)

  // Rechazo
  const [motivoRechazo, setMotivoRechazo] = useState("")
  const [mostrandoRechazo, setMostrandoRechazo] = useState(false)

  // Aprobación
  const [aprobando, setAprobando] = useState(false)
  const [clientes, setClientes] = useState<Cliente[]>([])
  const [almacenes, setAlmacenes] = useState<Almacen[]>([])
  const [localizaciones, setLocalizaciones] = useState<Localizacion[]>([])
  const [cuentas, setCuentas] = useState<CuentaConfig[]>([])
  const [clienteId, setClienteId] = useState("")
  const [almacenId, setAlmacenId] = useState("")
  const [localizacionId, setLocalizacionId] = useState("")
  const [metodoPago, setMetodoPago] = useState<"Efectivo" | "Banco" | "Credito">("Credito")
  const [cuentaId, setCuentaId] = useState("")

  const editable = pedido.estado === "Pendiente"
  const total = useMemo(
    () => +lineas.reduce((a, l) => a + l.cantidad * l.precio_unitario, 0).toFixed(2),
    [lineas]
  )

  async function abrir() {
    setOpen(true)
    setLoading(true)
    const res = await getPedidoConDetalle(pedido.id)
    if (res.error) toast({ title: "Error", description: res.error, variant: "destructive" })
    setLineas(res.data)
    setLoading(false)
  }

  async function prepararAprobacion() {
    setAprobando(true)
    const [c, a, cu] = await Promise.all([getClientes({ soloActivos: true }), getAlmacenes(), getCuentas()])
    setClientes(c.data || [])
    setAlmacenes(a.data || [])
    setCuentas((cu.data || []).filter((x) => x.activo !== false))
  }

  useEffect(() => {
    if (almacenId) {
      getLocalizaciones(Number(almacenId)).then((r) => {
        setLocalizaciones(r.data || [])
        if ((r.data || []).length === 1) setLocalizacionId(String(r.data[0].id))
        else setLocalizacionId("")
      })
    }
  }, [almacenId])

  async function guardarLinea(l: PedidoLinea, cantidad: number, precio: number) {
    if (!editable) return
    const res = await actualizarLineaPedido({
      id: l.id, pedido_id: l.pedido_id, cantidad, precio_unitario: precio,
    })
    if (res.error) {
      toast({ title: "Error", description: res.error, variant: "destructive" })
      return
    }
    setLineas((prev) =>
      prev.map((x) => (x.id === l.id ? { ...x, cantidad, precio_unitario: precio, subtotal: +(cantidad * precio).toFixed(2) } : x))
    )
  }

  async function crearClienteRapido() {
    const res = await saveCliente(
      { nombre: pedido.cliente_nombre, telefono: pedido.cliente_telefono || undefined } as Cliente,
      true
    )
    if (res.error || !res.data) {
      toast({ title: "Error", description: res.error || "No se pudo crear el cliente", variant: "destructive" })
      return
    }
    setClientes((prev) => [...prev, res.data!])
    setClienteId(String(res.data.id))
    toast({ title: "Cliente creado", description: res.data.nombre })
  }

  async function rechazar() {
    setProcesando(true)
    const res = await rechazarPedido(pedido.id, motivoRechazo)
    setProcesando(false)
    if (res.error) {
      toast({ title: "Error", description: res.error, variant: "destructive" })
      return
    }
    toast({ title: "Pedido rechazado" })
    setOpen(false)
    onDone()
  }

  async function aprobar() {
    if (!clienteId) {
      toast({ title: "Falta cliente", description: "Selecciona o crea el cliente", variant: "destructive" })
      return
    }
    if (!almacenId || !localizacionId) {
      toast({ title: "Falta almacén", description: "Selecciona almacén y localización", variant: "destructive" })
      return
    }
    if (metodoPago === "Banco" && !cuentaId) {
      toast({ title: "Falta cuenta", description: "Selecciona la cuenta bancaria", variant: "destructive" })
      return
    }
    if (metodoPago === "Efectivo" && !cajaSesion) {
      toast({ title: "Caja cerrada", description: "Abre la caja chica para cobrar en efectivo", variant: "destructive" })
      return
    }
    const sinStock = lineas.find((l) => l.cantidad > (l.stock_actual || 0))
    if (sinStock) {
      toast({
        title: "Stock insuficiente",
        description: `"${sinStock.producto_nombre}" no tiene existencias suficientes. Ajusta la cantidad.`,
        variant: "destructive",
      })
      return
    }

    setProcesando(true)
    try {
      // Punto de facturación del usuario (officemart-004): serie y CAI del punto.
      // Sin puntos, `resolverPuntoVenta` devuelve null y todo sigue igual.
      const { data: puntos } = await getPuntosFacturacion({ soloActivos: true })
      const punto = resolverPuntoVenta(user, puntos)
      const numeroFactura = await getNextCorrelativo(punto)

      // Desglose de pago: una linea con el metodo elegido. Se registra SIEMPRE
      // (incluido Credito) para que el Historial muestre el metodo y no "—".
      // Credito va con monto 0 (no es dinero cobrado): no genera movimiento de
      // tesoreria y el saldo queda como cuenta por cobrar (valorpago=0).
      let pagosDetalle: PagoVentaDetalleInput[] = []
      if (metodoPago === "Efectivo") {
        pagosDetalle = [{ metodo_pago: "Efectivo", monto_bruto: total, porcentaje_comision: 0, monto_neto: total }]
      } else if (metodoPago === "Banco") {
        const cuenta = cuentas.find((c) => String(c.id) === cuentaId)
        const comision = Number(cuenta?.porcentaje_comision || 0)
        pagosDetalle = [{
          metodo_pago: "Banco",
          cuenta_id: Number(cuentaId),
          monto_bruto: total,
          porcentaje_comision: comision,
          monto_neto: +(total * (1 - comision / 100)).toFixed(2),
        }]
      } else if (metodoPago === "Credito") {
        pagosDetalle = [{ metodo_pago: "Credito", monto_bruto: 0, porcentaje_comision: 0, monto_neto: 0 }]
      }
      // BRUTO (lo que factura/paga el cliente), igual que Nueva Venta: asi
      // `total_venta` cuadra con la suma de las lineas y `saldo = total - pago`
      // no queda negativo. La comision bancaria es un costo aparte (no reduce la
      // venta ni el abono).
      const sumaBruto = pagosDetalle.length > 0
        ? +pagosDetalle.reduce((a, p) => a + p.monto_bruto, 0).toFixed(2)
        : total
      const valorpago = metodoPago === "Credito" ? 0 : sumaBruto
      const estadoPago = valorpago <= 0 ? "Pendiente" : valorpago >= total - 0.005 ? "Pagado" : "Parcial"

      const res = await crearVenta({
        encabezado: {
          numero_factura: numeroFactura,
          cliente_id: Number(clienteId),
          aplica_impuesto: false,
          porcentaje_impuesto: 15,
          descuento: 0,
          subtotal: total,
          impuesto_total: 0,
          total_venta: total,
          estado_pago: estadoPago as "Pendiente" | "Parcial" | "Pagado",
          valorpago,
        },
        detalles: lineas.map((l) => ({
          producto_id: l.producto_id,
          cantidad: l.cantidad,
          precio_unitario: l.precio_unitario,
          costo_promedio_momento: l.costo_promedio_actual || 0,
          utilidad_linea: +((l.precio_unitario - (l.costo_promedio_actual || 0)) * l.cantidad).toFixed(2),
        })),
        almacen_id: Number(almacenId),
        localizacion_id: Number(localizacionId),
        pagos_detalle: pagosDetalle,
        punto_facturacion: punto,
      })

      if (res.error || !res.data?.id) {
        toast({ title: "Error al facturar", description: res.error || "No se pudo crear la venta", variant: "destructive" })
        return
      }

      const marca = await marcarPedidoAprobado(pedido.id, res.data.id)
      if (marca.error) {
        toast({
          title: "Venta creada, pedido sin marcar",
          description: `Factura ${numeroFactura} generada, pero no se pudo marcar el pedido: ${marca.error}`,
          variant: "destructive",
        })
      } else {
        toast({ title: "Pedido aprobado", description: `Factura ${numeroFactura} generada por ${formatCurrency(total)}` })
      }
      setOpen(false)
      onDone()
    } finally {
      setProcesando(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!procesando) { setOpen(o); if (!o) { setAprobando(false); setMostrandoRechazo(false) } } }}>
      <Button size="sm" variant="outline" className="gap-1" onClick={abrir}>
        <Eye className="h-3.5 w-3.5" /> Revisar
      </Button>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Pedido {pedido.numero_pedido}
            <Badge variant="secondary" className={ESTADO_PEDIDO_BADGE[pedido.estado]}>{pedido.estado}</Badge>
          </DialogTitle>
          <DialogDescription>
            {pedido.cliente_nombre}
            {pedido.cliente_telefono ? ` · ${pedido.cliente_telefono}` : ""} · {fechaLocal(pedido.created_at)}
            {pedido.link_nombre ? ` · Link: ${pedido.link_nombre}` : ""}
          </DialogDescription>
        </DialogHeader>

        {pedido.notas && (
          <p className="text-sm bg-stone-50 border rounded-md p-2 text-stone-600">Notas del cliente: {pedido.notas}</p>
        )}
        {pedido.estado === "Rechazado" && pedido.motivo_rechazo && (
          <p className="text-sm bg-red-50 border border-red-200 rounded-md p-2 text-red-700">Motivo del rechazo: {pedido.motivo_rechazo}</p>
        )}

        {/* Líneas */}
        {loading ? (
          <div className="flex justify-center py-8"><Spinner className="h-6 w-6" /></div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Producto</TableHead>
                  <TableHead className="text-center">Cant.</TableHead>
                  <TableHead className="text-right">Precio</TableHead>
                  <TableHead className="text-center">Stock</TableHead>
                  <TableHead className="text-right">Subtotal</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lineas.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell>
                      <p className="text-sm font-medium">{l.producto_nombre}</p>
                      <p className="text-xs text-muted-foreground font-mono">{l.producto_codigo}</p>
                    </TableCell>
                    <TableCell className="w-20">
                      <Input
                        type="number" min={0} step="any" className="h-8 text-center"
                        value={l.cantidad} disabled={!editable}
                        onChange={(e) => guardarLinea(l, Number(e.target.value) || 1, l.precio_unitario)}
                      />
                    </TableCell>
                    <TableCell className="w-28">
                      <Input
                        type="number" min={0} step={0.01} className="h-8 text-right"
                        value={l.precio_unitario} disabled={!editable}
                        onChange={(e) => guardarLinea(l, l.cantidad, Number(e.target.value) || 0)}
                      />
                    </TableCell>
                    <TableCell className="text-center">
                      <span className={l.cantidad > (l.stock_actual || 0) ? "text-red-600 font-medium" : "text-stone-500"}>
                        {l.stock_actual}
                      </span>
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {formatCurrency(l.cantidad * l.precio_unitario)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="flex justify-end pt-2 pr-2">
              <p className="text-lg font-bold">Total: {formatCurrency(total)}</p>
            </div>
          </div>
        )}

        {/* Acciones según estado */}
        {editable && !aprobando && !mostrandoRechazo && (
          <DialogFooter className="gap-2">
            <Button variant="outline" className="text-red-600 gap-1" onClick={() => setMostrandoRechazo(true)}>
              <XCircle className="h-4 w-4" /> Rechazar
            </Button>
            <Button className="gap-1" onClick={prepararAprobacion}>
              <CheckCircle2 className="h-4 w-4" /> Aprobar y facturar
            </Button>
          </DialogFooter>
        )}

        {/* Rechazo */}
        {mostrandoRechazo && (
          <div className="space-y-3 border-t pt-3">
            <Label htmlFor="motivo-rechazo">Motivo del rechazo</Label>
            <Textarea id="motivo-rechazo" value={motivoRechazo} onChange={(e) => setMotivoRechazo(e.target.value)} placeholder="Ej. sin disponibilidad, precios desactualizados…" />
            <DialogFooter>
              <Button variant="outline" onClick={() => setMostrandoRechazo(false)} disabled={procesando}>Volver</Button>
              <Button variant="destructive" onClick={rechazar} disabled={procesando}>
                {procesando ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Trash2 className="h-4 w-4 mr-1" />}
                Confirmar rechazo
              </Button>
            </DialogFooter>
          </div>
        )}

        {/* Aprobación */}
        {aprobando && (
          <div className="space-y-4 border-t pt-3">
            <p className="text-sm font-medium text-stone-700">Datos de la venta</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label>Cliente</Label>
                <Select value={clienteId} onValueChange={setClienteId}>
                  <SelectTrigger><SelectValue placeholder="Seleccionar cliente" /></SelectTrigger>
                  <SelectContent>
                    {clientes.map((c) => (
                      <SelectItem key={c.id} value={String(c.id)}>{c.nombre}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button variant="link" size="sm" className="h-auto p-0 justify-start text-xs" onClick={crearClienteRapido}>
                  + Crear &quot;{pedido.cliente_nombre}&quot; como cliente nuevo
                </Button>
              </div>
              <div className="grid gap-1.5">
                <Label>Almacén</Label>
                <Select value={almacenId} onValueChange={setAlmacenId}>
                  <SelectTrigger><SelectValue placeholder="Seleccionar" /></SelectTrigger>
                  <SelectContent>
                    {almacenes.map((a) => <SelectItem key={a.id} value={String(a.id)}>{a.nombre}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label>Localización</Label>
                <Select value={localizacionId} onValueChange={setLocalizacionId} disabled={!almacenId}>
                  <SelectTrigger><SelectValue placeholder={almacenId ? "Seleccionar" : "Elige almacén primero"} /></SelectTrigger>
                  <SelectContent>
                    {localizaciones.map((lo) => <SelectItem key={lo.id} value={String(lo.id)}>{lo.nombre}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label>Método de pago</Label>
                <Select value={metodoPago} onValueChange={(v) => setMetodoPago(v as typeof metodoPago)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Credito">Crédito (por cobrar)</SelectItem>
                    <SelectItem value="Efectivo" disabled={!cajaSesion}>
                      Efectivo{!cajaSesion ? " (caja cerrada)" : ""}
                    </SelectItem>
                    <SelectItem value="Banco">Banco / Tarjeta</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {metodoPago === "Banco" && (
                <div className="grid gap-1.5 sm:col-span-2">
                  <Label>Cuenta bancaria</Label>
                  <Select value={cuentaId} onValueChange={setCuentaId}>
                    <SelectTrigger><SelectValue placeholder="Seleccionar cuenta" /></SelectTrigger>
                    <SelectContent>
                      {cuentas.map((c) => (
                        <SelectItem key={c.id} value={String(c.id)}>
                          {c.nombre} ({Number(c.porcentaje_comision || 0)}% comisión)
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setAprobando(false)} disabled={procesando}>Volver</Button>
              <Button onClick={aprobar} disabled={procesando} className="gap-1">
                {procesando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                {procesando ? "Facturando…" : `Facturar ${formatCurrency(total)}`}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
