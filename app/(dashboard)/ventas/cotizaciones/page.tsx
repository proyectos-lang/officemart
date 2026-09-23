"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import {
  FileText, Plus, Search, Loader2, Send, CheckCircle2, XCircle, Copy, Pencil, Trash2,
  ShoppingCart, Download, RotateCcw, MoreHorizontal, Eye, AlertTriangle,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Spinner } from "@/components/ui/spinner"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { TablePaginator } from "@/components/ui/table-paginator"
import { useToast } from "@/hooks/use-toast"
import { useTenant } from "@/lib/hooks/use-tenant"
import { useAuth } from "@/lib/contexts/auth-context"
import { formatCurrency } from "@/lib/utils/format"
import { formatHondurasDate, getHondurasTodayISODate } from "@/lib/utils/honduras-time"
import { exportToXlsx } from "@/lib/utils/export"
import { generarFacturaPdf } from "@/lib/utils/factura-pdf"
import { getRazonSocialForPdf } from "@/lib/services/ventas"
import { getClientes, type Cliente } from "@/lib/services/catalogos"
import {
  getCotizaciones, getCotizacion, cambiarEstadoCotizacion, duplicarCotizacion, eliminarCotizacion,
  prepararConversionAVenta, vincularOrdenCotizacion, esConvertible, esEditable, diasParaVencer, fechaMasDias,
  ESTADOS_COTIZACION, COTIZACIONES_FEATURE_PENDING,
  type CotizacionEncabezado, type EstadoCotizacion,
} from "@/lib/services/cotizaciones"
import { createOrdenTrabajo, codigoOrden } from "@/lib/services/produccion-ordenes"
import { Wrench } from "lucide-react"

const ESTADO_BADGE: Record<EstadoCotizacion, string> = {
  Borrador: "bg-stone-100 text-stone-700",
  Enviada: "bg-sky-100 text-sky-700",
  Aprobada: "bg-emerald-100 text-emerald-700",
  Facturada: "bg-violet-100 text-violet-700",
  Vencida: "bg-amber-100 text-amber-800",
  Rechazada: "bg-red-100 text-red-700",
}

export default function CotizacionesPage() {
  const router = useRouter()
  const { toast } = useToast()
  const { ready, razonSocialId } = useTenant()
  const { hasModulo } = useAuth()
  const puedeFacturar = hasModulo("Nueva Venta")
  const puedeOT = hasModulo("Ordenes de Produccion")
  const hoy = getHondurasTodayISODate()

  const [loading, setLoading] = React.useState(true)
  const [pendiente, setPendiente] = React.useState(false)
  const [cotizaciones, setCotizaciones] = React.useState<CotizacionEncabezado[]>([])
  const [clientes, setClientes] = React.useState<Cliente[]>([])
  const [filtroEstado, setFiltroEstado] = React.useState<EstadoCotizacion | "todas" | "abiertas">("abiertas")
  const [busqueda, setBusqueda] = React.useState("")
  const [pageIndex, setPageIndex] = React.useState(0)
  const [pageSize, setPageSize] = React.useState(50)
  const [ocupado, setOcupado] = React.useState<number | null>(null)

  // Rechazo / reactivación
  const [rechazando, setRechazando] = React.useState<CotizacionEncabezado | null>(null)
  const [motivoRechazo, setMotivoRechazo] = React.useState("")
  const [reactivando, setReactivando] = React.useState<CotizacionEncabezado | null>(null)
  const [nuevaVigencia, setNuevaVigencia] = React.useState("")

  React.useEffect(() => {
    if (!ready || razonSocialId == null) return
    cargar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, razonSocialId])

  async function cargar() {
    setLoading(true)
    const [cRes, clRes] = await Promise.all([getCotizaciones({ estado: "todas" }), getClientes()])
    if (cRes.error === COTIZACIONES_FEATURE_PENDING) setPendiente(true)
    else if (cRes.error) toast({ title: "No se pudieron cargar las cotizaciones", description: cRes.error, variant: "destructive" })
    setCotizaciones(cRes.data)
    setClientes(clRes.data || [])
    setLoading(false)
  }

  const clienteRtn = React.useMemo(() => {
    const m = new Map<number, string | null>()
    for (const c of clientes) if (c.id != null) m.set(c.id, c.rtn || null)
    return m
  }, [clientes])

  const filtradas = React.useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    return cotizaciones.filter((c) => {
      if (filtroEstado === "abiertas") {
        if (!(c.estado === "Borrador" || c.estado === "Enviada" || c.estado === "Aprobada")) return false
      } else if (filtroEstado !== "todas" && c.estado !== filtroEstado) return false
      if (!q) return true
      return (
        c.numero.toLowerCase().includes(q) ||
        (c.cliente_nombre || "").toLowerCase().includes(q)
      )
    })
  }, [cotizaciones, filtroEstado, busqueda])

  React.useEffect(() => { setPageIndex(0) }, [filtroEstado, busqueda])
  const pagina = filtradas.slice(pageIndex * pageSize, (pageIndex + 1) * pageSize)

  async function cambiar(c: CotizacionEncabezado, estado: EstadoCotizacion, opts: { motivo?: string; vigencia_hasta?: string } = {}) {
    setOcupado(c.id)
    const { error } = await cambiarEstadoCotizacion(c.id, estado, opts)
    setOcupado(null)
    if (error) {
      toast({ title: "No se pudo cambiar el estado", description: error, variant: "destructive" })
      return false
    }
    toast({ title: `Cotización ${c.numero}: ${estado}` })
    cargar()
    return true
  }

  async function duplicar(c: CotizacionEncabezado) {
    setOcupado(c.id)
    const { data, error } = await duplicarCotizacion(c.id)
    setOcupado(null)
    if (error || !data) {
      toast({ title: "No se pudo duplicar", description: error ?? "Intenta de nuevo.", variant: "destructive" })
      return
    }
    toast({ title: "Cotización duplicada", description: `${data.numero} (borrador)` })
    router.push(`/ventas/cotizaciones/nueva?id=${data.id}`)
  }

  async function eliminar(c: CotizacionEncabezado) {
    if (!confirm(`¿Eliminar el borrador ${c.numero}?`)) return
    setOcupado(c.id)
    const { error } = await eliminarCotizacion(c.id)
    setOcupado(null)
    if (error) {
      toast({ title: "No se pudo eliminar", description: error, variant: "destructive" })
      return
    }
    toast({ title: "Borrador eliminado" })
    cargar()
  }

  /** Lleva la cotización a Nueva Venta (prellenada) para facturarla. */
  async function facturar(c: CotizacionEncabezado) {
    setOcupado(c.id)
    const { data, error } = await getCotizacion(c.id)
    setOcupado(null)
    if (error || !data) {
      toast({ title: "No se pudo abrir la cotización", description: error ?? "", variant: "destructive" })
      return
    }
    if (!prepararConversionAVenta(data.encabezado, data.lineas)) {
      toast({ title: "No se pudo preparar la venta", description: "El navegador bloqueó el almacenamiento temporal.", variant: "destructive" })
      return
    }
    router.push("/ventas/nueva")
  }

  /** Crea una orden de trabajo (officemart-010) a partir de la cotización. */
  async function crearOT(c: CotizacionEncabezado) {
    if (c.orden_id) {
      toast({ title: "Ya tiene orden de trabajo", description: codigoOrden(c.orden_id, "Trabajo") })
      return
    }
    setOcupado(c.id)
    const { data, error } = await getCotizacion(c.id)
    if (!data) {
      setOcupado(null)
      toast({ title: "No se pudo leer la cotización", description: error ?? "", variant: "destructive" })
      return
    }
    const descripcion = `${c.numero}${c.cliente_nombre ? ` · ${c.cliente_nombre}` : ""}: ${data.lineas.map((l) => `${l.cantidad} ${l.descripcion}`).join(", ")}`.slice(0, 500)
    const res = await createOrdenTrabajo({ descripcion, cliente_id: c.cliente_id, cotizacion_id: c.id, fecha_objetivo: c.vigencia_hasta })
    setOcupado(null)
    if (!res.data) {
      toast({ title: "No se pudo crear la orden de trabajo", description: res.error ?? "", variant: "destructive" })
      return
    }
    await vincularOrdenCotizacion(c.id, res.data.id)
    toast({ title: `${codigoOrden(res.data.id, "Trabajo")} creada`, description: res.error ?? "Síguela en Producción → Flujo de Producción.", variant: res.error ? "destructive" : undefined })
    cargar()
  }

  async function descargarPdf(c: CotizacionEncabezado) {
    setOcupado(c.id)
    const [{ data }, razonSocial] = await Promise.all([getCotizacion(c.id), getRazonSocialForPdf()])
    setOcupado(null)
    if (!data) {
      toast({ title: "No se pudo generar el PDF", variant: "destructive" })
      return
    }
    const e = data.encabezado
    const { ok } = await generarFacturaPdf({
      tipo: "cotizacion",
      empresa: razonSocial,
      numeroDocumento: e.numero,
      clienteNombre: e.cliente_nombre || "Cliente",
      clienteRtn: e.cliente_id != null ? clienteRtn.get(e.cliente_id) ?? null : null,
      fecha: e.fecha,
      lineas: data.lineas.map((l) => ({
        nombre: l.descripcion,
        cantidad: l.cantidad,
        precioUnitario: +(l.precio_unitario * (1 - (l.descuento_linea || 0) / 100)).toFixed(2),
      })),
      subtotal: e.subtotal,
      descuentoPct: e.descuento,
      mostrarIsv: e.aplica_impuesto,
      isvPct: e.porcentaje_impuesto,
      isv: e.impuesto_total,
      total: e.total,
      vigenciaHasta: e.vigencia_hasta,
      condiciones: e.condiciones,
    })
    if (!ok) toast({ title: "No se pudo generar el PDF", variant: "destructive" })
  }

  function exportar() {
    exportToXlsx(
      filtradas.map((c) => ({
        Numero: c.numero,
        Fecha: formatHondurasDate(c.fecha),
        Cliente: c.cliente_nombre || "",
        Estado: c.estado,
        "Vigencia hasta": c.vigencia_hasta || "",
        Subtotal: c.subtotal,
        Descuento: c.descuento,
        ISV: c.impuesto_total,
        Total: c.total,
        Venta: c.venta_id ?? "",
      })),
      { filename: "cotizaciones", sheetName: "Cotizaciones" }
    )
  }

  const resumen = React.useMemo(() => {
    const abiertas = cotizaciones.filter((c) => c.estado === "Enviada" || c.estado === "Aprobada")
    return {
      abiertas: abiertas.length,
      montoAbierto: abiertas.reduce((a, c) => a + c.total, 0),
      porVencer: abiertas.filter((c) => {
        const d = diasParaVencer(c.vigencia_hasta, hoy)
        return d != null && d >= 0 && d <= 3
      }).length,
    }
  }, [cotizaciones, hoy])

  return (
    <div className="space-y-4 md:space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-sky-100 p-2 text-sky-700">
            <FileText className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold text-stone-800">Cotizaciones</h1>
            <p className="text-sm text-muted-foreground">
              Presupuestos con vigencia: envíalos, apruébalos y factúralos en un clic.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={exportar} disabled={filtradas.length === 0} className="gap-1">
            <Download className="h-4 w-4" /> Excel
          </Button>
          <Button size="sm" onClick={() => router.push("/ventas/cotizaciones/nueva")} disabled={pendiente} className="gap-1">
            <Plus className="h-4 w-4" /> Nueva cotización
          </Button>
        </div>
      </div>

      {pendiente && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{COTIZACIONES_FEATURE_PENDING}</div>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Abiertas (enviadas / aprobadas)</p><p className="text-2xl font-semibold">{resumen.abiertas}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Monto en negociación</p><p className="text-2xl font-semibold">{formatCurrency(resumen.montoAbierto)}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Vencen en 3 días</p><p className={`text-2xl font-semibold ${resumen.porVencer > 0 ? "text-amber-700" : ""}`}>{resumen.porVencer}</p></CardContent></Card>
      </div>

      <Card>
        <CardHeader className="p-4 md:p-6">
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <CardTitle className="text-lg">Listado ({filtradas.length})</CardTitle>
              <CardDescription>Las cotizaciones cuya vigencia pasó se marcan Vencidas automáticamente.</CardDescription>
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Número o cliente…" className="pl-9 w-56" />
              </div>
              <Select value={filtroEstado} onValueChange={(v) => setFiltroEstado(v as EstadoCotizacion | "todas" | "abiertas")}>
                <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="abiertas">Abiertas</SelectItem>
                  <SelectItem value="todas">Todas</SelectItem>
                  {ESTADOS_COTIZACION.map((e) => (
                    <SelectItem key={e} value={e}>{e}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-4 md:p-6 pt-0">
          {loading ? (
            <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground"><Spinner /> Cargando…</div>
          ) : filtradas.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No hay cotizaciones con ese filtro.</p>
          ) : (
            <>
              <div className="overflow-x-auto border rounded-lg">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-stone-50">
                      <TableHead>Número</TableHead>
                      <TableHead>Fecha</TableHead>
                      <TableHead>Cliente</TableHead>
                      <TableHead>Vigencia</TableHead>
                      <TableHead>Estado</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead className="w-12" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pagina.map((c) => {
                      const dias = diasParaVencer(c.vigencia_hasta, hoy)
                      const porVencer = (c.estado === "Enviada" || c.estado === "Aprobada") && dias != null && dias >= 0 && dias <= 3
                      const trabajando = ocupado === c.id
                      return (
                        <TableRow key={c.id}>
                          <TableCell className="font-mono font-medium">{c.numero}</TableCell>
                          <TableCell className="whitespace-nowrap">{formatHondurasDate(c.fecha)}</TableCell>
                          <TableCell>{c.cliente_nombre || "—"}</TableCell>
                          <TableCell className="whitespace-nowrap">
                            {c.vigencia_hasta ? (
                              <span className={porVencer ? "text-amber-700 font-medium inline-flex items-center gap-1" : ""}>
                                {porVencer && <AlertTriangle className="h-3.5 w-3.5" />}
                                {c.vigencia_hasta}
                                {porVencer && <span className="text-xs">({dias === 0 ? "hoy" : `${dias} d`})</span>}
                              </span>
                            ) : "—"}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className={`border-0 ${ESTADO_BADGE[c.estado]}`}>{c.estado}</Badge>
                            {c.estado === "Rechazada" && c.motivo_rechazo && (
                              <p className="text-[11px] text-muted-foreground mt-0.5 max-w-[200px] truncate" title={c.motivo_rechazo}>{c.motivo_rechazo}</p>
                            )}
                          </TableCell>
                          <TableCell className="text-right font-medium whitespace-nowrap">{formatCurrency(c.total)}</TableCell>
                          <TableCell>
                            {trabajando ? (
                              <Loader2 className="h-4 w-4 animate-spin text-stone-400" />
                            ) : (
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Acciones">
                                    <MoreHorizontal className="h-4 w-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem onClick={() => router.push(`/ventas/cotizaciones/nueva?id=${c.id}`)}>
                                    {esEditable(c.estado) ? <Pencil className="h-4 w-4 mr-2" /> : <Eye className="h-4 w-4 mr-2" />}
                                    {esEditable(c.estado) ? "Editar" : "Ver"}
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => descargarPdf(c)}>
                                    <Download className="h-4 w-4 mr-2" /> PDF
                                  </DropdownMenuItem>
                                  <DropdownMenuSeparator />
                                  {c.estado === "Borrador" && (
                                    <DropdownMenuItem onClick={() => cambiar(c, "Enviada")}>
                                      <Send className="h-4 w-4 mr-2" /> Marcar como enviada
                                    </DropdownMenuItem>
                                  )}
                                  {(c.estado === "Borrador" || c.estado === "Enviada") && (
                                    <DropdownMenuItem onClick={() => cambiar(c, "Aprobada")}>
                                      <CheckCircle2 className="h-4 w-4 mr-2" /> Aprobada por el cliente
                                    </DropdownMenuItem>
                                  )}
                                  {esConvertible(c.estado) && puedeFacturar && (
                                    <DropdownMenuItem onClick={() => facturar(c)}>
                                      <ShoppingCart className="h-4 w-4 mr-2" /> Facturar (Nueva Venta)
                                    </DropdownMenuItem>
                                  )}
                                  {puedeOT && (c.estado === "Aprobada" || c.estado === "Facturada" || c.estado === "Enviada") && (
                                    <DropdownMenuItem onClick={() => crearOT(c)} disabled={c.orden_id != null}>
                                      <Wrench className="h-4 w-4 mr-2" /> {c.orden_id ? `OT creada (${codigoOrden(c.orden_id, "Trabajo")})` : "Crear orden de trabajo"}
                                    </DropdownMenuItem>
                                  )}
                                  {c.estado === "Vencida" && (
                                    <DropdownMenuItem onClick={() => { setReactivando(c); setNuevaVigencia(fechaMasDias(hoy, 15)) }}>
                                      <RotateCcw className="h-4 w-4 mr-2" /> Reactivar (nueva vigencia)
                                    </DropdownMenuItem>
                                  )}
                                  {c.estado === "Rechazada" && (
                                    <DropdownMenuItem onClick={() => cambiar(c, "Borrador")}>
                                      <RotateCcw className="h-4 w-4 mr-2" /> Reabrir como borrador
                                    </DropdownMenuItem>
                                  )}
                                  {c.estado !== "Facturada" && c.estado !== "Rechazada" && (
                                    <DropdownMenuItem onClick={() => { setRechazando(c); setMotivoRechazo("") }} className="text-red-600">
                                      <XCircle className="h-4 w-4 mr-2" /> Rechazada / perdida
                                    </DropdownMenuItem>
                                  )}
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem onClick={() => duplicar(c)}>
                                    <Copy className="h-4 w-4 mr-2" /> Duplicar
                                  </DropdownMenuItem>
                                  {c.estado === "Borrador" && (
                                    <DropdownMenuItem onClick={() => eliminar(c)} className="text-red-600">
                                      <Trash2 className="h-4 w-4 mr-2" /> Eliminar borrador
                                    </DropdownMenuItem>
                                  )}
                                </DropdownMenuContent>
                              </DropdownMenu>
                            )}
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>
              <TablePaginator
                pageIndex={pageIndex}
                pageSize={pageSize}
                totalItems={filtradas.length}
                onPageIndexChange={setPageIndex}
                onPageSizeChange={(s) => { setPageSize(s); setPageIndex(0) }}
                className="mt-3"
              />
            </>
          )}
        </CardContent>
      </Card>

      {/* Rechazo */}
      <Dialog open={rechazando !== null} onOpenChange={(o) => { if (!o) setRechazando(null) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Rechazar {rechazando?.numero}</DialogTitle>
            <DialogDescription>La cotización queda como perdida; el motivo ayuda a los reportes de gestión.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="cot-motivo">Motivo</Label>
            <Textarea id="cot-motivo" value={motivoRechazo} onChange={(e) => setMotivoRechazo(e.target.value)} placeholder="Precio, plazo, compró en otro lado…" rows={3} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRechazando(null)}>Cancelar</Button>
            <Button
              variant="destructive"
              disabled={!motivoRechazo.trim()}
              onClick={async () => {
                if (!rechazando) return
                const ok = await cambiar(rechazando, "Rechazada", { motivo: motivoRechazo })
                if (ok) setRechazando(null)
              }}
            >
              Rechazar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reactivar vencida */}
      <Dialog open={reactivando !== null} onOpenChange={(o) => { if (!o) setReactivando(null) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reactivar {reactivando?.numero}</DialogTitle>
            <DialogDescription>Vuelve a Enviada con una nueva fecha de vigencia.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="cot-vig">Nueva vigencia</Label>
            <Input id="cot-vig" type="date" value={nuevaVigencia} min={hoy} onChange={(e) => setNuevaVigencia(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReactivando(null)}>Cancelar</Button>
            <Button
              disabled={!nuevaVigencia}
              onClick={async () => {
                if (!reactivando) return
                const ok = await cambiar(reactivando, "Enviada", { vigencia_hasta: nuevaVigencia })
                if (ok) setReactivando(null)
              }}
            >
              Reactivar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
