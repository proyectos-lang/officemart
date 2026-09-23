"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Eye, CreditCard, Download, FileSpreadsheet, CalendarIcon, Banknote, Wallet, Shuffle, Trash2, Loader2, Pencil, Printer, Ban } from "lucide-react"
import { Switch } from "@/components/ui/switch"
import { exportToXlsx } from "@/lib/utils/export"
import { formatCurrency, formatNumber } from "@/lib/utils/format"
import { TablePaginator } from "@/components/ui/table-paginator"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { useToast } from "@/hooks/use-toast"
import { getClientes, getAlmacenes, getProductos, type Cliente, type Almacen, type Producto } from "@/lib/services/catalogos"
import { getVendedores, type Vendedor } from "@/lib/services/vendedores"
import { getCuentas, type CuentaConfig } from "@/lib/services/cuentas"
import { useCajaSesion } from "@/lib/hooks/use-caja-sesion"
import { ImportarVentasDialog } from "./importar-ventas-dialog"
import {
  getVentas,
  getDetallesVenta,
  getPagosVenta,
  getPagosDetalleVenta,
  registrarPago,
  eliminarVentaCompletamente,
  anularVenta,
  getRazonSocialForPdf,
  getDetalleAnalitico,
  getVentasEliminadas,
  type VentaEncabezado,
  type VentaDetalle,
  type PagoVenta,
  type PagoVentaDetalle,
  type VentaDetalleAnalitico,
  type VentaEliminada,
} from "@/lib/services/ventas"
import { getMetodosPagoPorVenta, getComisionesPorVenta, getCuentasDestinoPorVenta, type ComisionVenta } from "@/lib/services/ventas-analytics"
import { contarDevolucionesDeVenta } from "@/lib/services/devoluciones"
import { useAuth } from "@/lib/contexts/auth-context"
import { printTirilla } from "@/lib/print-tirilla"
import { tirillaLogoUrl } from "@/lib/utils/tirilla-logos"
import { buildTirillaVentaHtml, metodoPagoLabel, type TirillaVenta, type TirillaFiscal } from "@/lib/utils/tirilla-venta"
import {
  getConfigsCai,
  calcularDesgloseFiscal,
  formatearCorrelativoCai,
  fmtFechaCorta,
  totalEnLetras,
  type ConfigCai,
} from "@/lib/services/facturacion-cai"

export default function HistorialVentasPage() {
  const { toast } = useToast()
  const router = useRouter()
  const { user } = useAuth()

  // --- Shared state ---
  const [loading, setLoading] = React.useState(true)
  const [ventas, setVentas] = React.useState<VentaEncabezado[]>([])
  const [clientes, setClientes] = React.useState<Cliente[]>([])
  const [almacenes, setAlmacenes] = React.useState<Almacen[]>([])
  // Vendedores (modulo Vendedores y Zonas): la columna solo se muestra si hay.
  const [vendedores, setVendedores] = React.useState<Vendedor[]>([])
  const vendedorNombre = React.useMemo(() => {
    const m = new Map<number, string>()
    for (const v of vendedores) if (v.id != null) m.set(v.id, v.nombre)
    return m
  }, [vendedores])
  const mostrarVendedor = vendedores.length > 0
  const [productos, setProductos] = React.useState<Producto[]>([])
  /**
   * Map<venta_id, "Efectivo"|"Banco"|"Mixto"|"Credito"|"Otro">. Lo poblamos en
   * loadData con un solo query batch a ventas_pagos_detalle. Si la migracion
   * 011 esta pendiente, queda vacio y la columna muestra fallback "—".
   */
  const [metodosPago, setMetodosPago] = React.useState<Map<number, string>>(new Map())
  /**
   * Map<venta_id, ComisionVenta>. Comision bancaria agregada por venta (para
   * auditoria). Se puebla en batch junto a `metodosPago`. Ventas sin comision
   * no entran en el Map (la columna muestra "—").
   */
  const [comisionesPorVenta, setComisionesPorVenta] = React.useState<Map<number, ComisionVenta>>(new Map())
  /**
   * Map<venta_id, string[]>. Cuentas bancarias destino de cada venta (nombres
   * de `cuentas_config` de sus lineas Banco/Link_Pago). Se puebla en batch
   * junto a `metodosPago`. Se usa para mostrar, junto al metodo "Banco", a
   * que cuenta entro el dinero. Ventas sin cobro bancario no entran en el Map.
   */
  const [cuentasDestinoPorVenta, setCuentasDestinoPorVenta] = React.useState<Map<number, string[]>>(new Map())
  /** Id de la venta cuya tirilla se esta preparando para reimprimir (spinner). */
  const [tirillaVentaId, setTirillaVentaId] = React.useState<number | null>(null)

  // --- Resumen de Facturas tab filters ---
  const [filtroFechaInicioFacturas, setFiltroFechaInicioFacturas] = React.useState("")
  const [filtroFechaFinFacturas, setFiltroFechaFinFacturas] = React.useState("")
  const [filtroClienteIdFacturas, setFiltroClienteIdFacturas] = React.useState("")
  const [filtroAlmacenIdFacturas, setFiltroAlmacenIdFacturas] = React.useState("")
  const [filtroEstadoPago, setFiltroEstadoPago] = React.useState("")

  // --- Detalle por Producto tab filters ---
  const [filtroFechaInicio, setFiltroFechaInicio] = React.useState("")
  const [filtroFechaFin, setFiltroFechaFin] = React.useState("")

  // --- Detalle por Producto tab state ---
  const [loadingAnalitico, setLoadingAnalitico] = React.useState(false)
  const [detallesAnaliticos, setDetallesAnaliticos] = React.useState<VentaDetalleAnalitico[]>([])
  const [filtroClienteId, setFiltroClienteId] = React.useState("")
  const [filtroProductoId, setFiltroProductoId] = React.useState("")
  const [filtroAlmacenId, setFiltroAlmacenId] = React.useState("")
  const [analiticoLoaded, setAnaliticoLoaded] = React.useState(false)

  // --- Facturas eliminadas (pestaña de trazabilidad) ---
  const [eliminadas, setEliminadas] = React.useState<VentaEliminada[]>([])
  const [loadingEliminadas, setLoadingEliminadas] = React.useState(false)
  const [eliminadasLoaded, setEliminadasLoaded] = React.useState(false)
  const [eliminadaDetalle, setEliminadaDetalle] = React.useState<VentaEliminada | null>(null)

  // --- Factura detail dialog ---
  const [selectedVenta, setSelectedVenta] = React.useState<VentaEncabezado | null>(null)
  const [detalles, setDetalles] = React.useState<VentaDetalle[]>([])
  const [pagos, setPagos] = React.useState<PagoVenta[]>([])
  // Desglose de pago de la factura (ventas_pagos_detalle) para auditoria de comision.
  const [pagosDetalle, setPagosDetalle] = React.useState<PagoVentaDetalle[]>([])
  const [showDetalleDialog, setShowDetalleDialog] = React.useState(false)

  // --- Pago dialog ---
  const [showPagoDialog, setShowPagoDialog] = React.useState(false)
  const [pagoMonto, setPagoMonto] = React.useState("")
  const [pagoMetodo, setPagoMetodo] = React.useState<string>("Efectivo")
  const [pagoCuentaId, setPagoCuentaId] = React.useState<string>("")
  const [cuentas, setCuentas] = React.useState<CuentaConfig[]>([])
  const { sesion: cajaSesion } = useCajaSesion()

  const [savingPago, setSavingPago] = React.useState(false)

  // --- Paginacion client-side (50/100/1000) por pestana ---
  const [pageSizeResumen, setPageSizeResumen] = React.useState(100)
  const [pageIndexResumen, setPageIndexResumen] = React.useState(0)
  const [pageSizeDetalle, setPageSizeDetalle] = React.useState(100)
  const [pageIndexDetalle, setPageIndexDetalle] = React.useState(0)

  // --- Eliminar venta (alert dialog) ---
  const [ventaAEliminar, setVentaAEliminar] = React.useState<VentaEncabezado | null>(null)
  // Nº de devoluciones de la venta a eliminar (para avisar que se anularán).
  const [devsDeVentaAEliminar, setDevsDeVentaAEliminar] = React.useState(0)
  // Motivo de la eliminación (obligatorio; se guarda en ventas_eliminadas).
  const [motivoEliminar, setMotivoEliminar] = React.useState("")
  const [deletingVenta, setDeletingVenta] = React.useState(false)

  // --- Anular venta (script officemart-003: "compensar, no borrar") ---
  // Borrar físicamente solo si la empresa lo permite (flag); por defecto se ANULA.
  const permitirEliminar = user?.flags?.ventas_permitir_eliminar ?? false
  const [mostrarAnuladas, setMostrarAnuladas] = React.useState(false)
  const [ventaAAnular, setVentaAAnular] = React.useState<VentaEncabezado | null>(null)
  const [motivoAnular, setMotivoAnular] = React.useState("")
  const [reembolsoDestino, setReembolsoDestino] = React.useState<"caja" | "cuenta">("caja")
  const [reembolsoCuentaId, setReembolsoCuentaId] = React.useState("")
  const [anulando, setAnulando] = React.useState(false)

  React.useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    setLoading(true)
    try {
      const [ventasRes, clientesRes, almacenesRes, productosRes, vendedoresRes] = await Promise.all([
        // Carga TODAS las facturas (bucle por rangos en el servicio) para poder
        // paginar client-side por hojas de 50/100/1000.
        getVentas(),
        getClientes({ soloActivos: true }),
        getAlmacenes(),
        getProductos(),
        getVendedores(),
      ])
      setVentas(ventasRes.data)
      setClientes(clientesRes.data)
      setAlmacenes(almacenesRes.data)
      setProductos(productosRes.data)
      setVendedores(vendedoresRes.data || [])

      // Batch (chunked en el servicio) para el metodo de pago y la comision de
      // TODAS las ventas.
      const ids = ventasRes.data.map(v => v.id!).filter((id): id is number => id != null)
      if (ids.length > 0) {
        const [{ data: mapaMet }, { data: mapaCom }, { data: mapaCta }] = await Promise.all([
          getMetodosPagoPorVenta(ids),
          getComisionesPorVenta(ids),
          getCuentasDestinoPorVenta(ids),
        ])
        setMetodosPago(mapaMet)
        setComisionesPorVenta(mapaCom)
        setCuentasDestinoPorVenta(mapaCta)
      } else {
        setMetodosPago(new Map())
        setComisionesPorVenta(new Map())
        setCuentasDestinoPorVenta(new Map())
      }
    } catch {
      toast({ title: "Error", description: "No se pudieron cargar las ventas", variant: "destructive" })
    } finally {
      setLoading(false)
    }
  }

  async function loadAnalitico() {
    setLoadingAnalitico(true)
    try {
      const { data, error } = await getDetalleAnalitico(
        filtroFechaInicio || undefined,
        filtroFechaFin || undefined
      )
      if (error) {
        toast({ title: "Error", description: error, variant: "destructive" })
        return
      }
      setDetallesAnaliticos(data)
      setAnaliticoLoaded(true)

      // Metodo de pago + comision por venta para las nuevas columnas del
      // Detalle. Se mergean en los Maps (no reemplazan) para no perder lo que
      // ya cargo la pestana Resumen.
      const idsDetalle = Array.from(new Set(data.map(d => d.venta_id).filter(Boolean)))
      if (idsDetalle.length > 0) {
        const [{ data: mapaMet }, { data: mapaCom }, { data: mapaCta }] = await Promise.all([
          getMetodosPagoPorVenta(idsDetalle),
          getComisionesPorVenta(idsDetalle),
          getCuentasDestinoPorVenta(idsDetalle),
        ])
        setMetodosPago(prev => new Map([...prev, ...mapaMet]))
        setComisionesPorVenta(prev => new Map([...prev, ...mapaCom]))
        setCuentasDestinoPorVenta(prev => new Map([...prev, ...mapaCta]))
      }
    } catch {
      toast({ title: "Error", description: "No se pudieron cargar los detalles", variant: "destructive" })
    } finally {
      setLoadingAnalitico(false)
    }
  }

  const loadEliminadas = React.useCallback(async () => {
    setLoadingEliminadas(true)
    const { data, error } = await getVentasEliminadas()
    if (error) toast({ title: "Error", description: error, variant: "destructive" })
    setEliminadas(data)
    setEliminadasLoaded(true)
    setLoadingEliminadas(false)
  }, [toast])

  function handleTabChange(value: string) {
    if (value === "detalle" && !analiticoLoaded) {
      loadAnalitico()
    }
    if (value === "eliminadas" && !eliminadasLoaded) {
      loadEliminadas()
    }
  }

  // --- Filtered ventas for Resumen de Facturas ---
  const ventasFiltradas = React.useMemo(() => {
    const clienteSeleccionado = clientes.find(c => c.id?.toString() === filtroClienteIdFacturas)?.nombre || ""
    const almacenSeleccionado = almacenes.find(a => a.id?.toString() === filtroAlmacenIdFacturas)?.nombre || ""

    return ventas.filter(v => {
      // Anuladas ocultas por defecto (se muestran con el interruptor).
      if (!mostrarAnuladas && v.anulada_at) return false
      const fecha = v.fecha_venta?.split('T')[0] || ""
      const matchInicio = !filtroFechaInicioFacturas || fecha >= filtroFechaInicioFacturas
      const matchFin = !filtroFechaFinFacturas || fecha <= filtroFechaFinFacturas
      const matchCliente = !filtroClienteIdFacturas || v.cliente_nombre === clienteSeleccionado
      const matchAlmacen = !filtroAlmacenIdFacturas || v.almacen_nombre === almacenSeleccionado
      const matchEstado = !filtroEstadoPago || v.estado_pago === filtroEstadoPago
      return matchInicio && matchFin && matchCliente && matchAlmacen && matchEstado
    })
  }, [ventas, filtroFechaInicioFacturas, filtroFechaFinFacturas, filtroClienteIdFacturas, filtroAlmacenIdFacturas, filtroEstadoPago, clientes, almacenes, mostrarAnuladas])

  // --- Filtered detalle analitico ---
  const detalleFiltrado = React.useMemo(() => {
    // Get selected names for dropdown filters
    const clienteSeleccionado = clientes.find(c => c.id?.toString() === filtroClienteId)?.nombre || ""
    const productoSeleccionado = productos.find(p => p.id?.toString() === filtroProductoId)?.nombre || ""
    const almacenSeleccionado = almacenes.find(a => a.id?.toString() === filtroAlmacenId)?.nombre || ""

    return detallesAnaliticos.filter(d => {
      // Dropdown filters
      const matchCliente = !filtroClienteId || d.cliente_nombre === clienteSeleccionado
      const matchProducto = !filtroProductoId || d.producto_nombre === productoSeleccionado
      const matchAlmacen = !filtroAlmacenId || d.almacen_nombre === almacenSeleccionado

      return matchCliente && matchProducto && matchAlmacen
    })
  }, [detallesAnaliticos, filtroClienteId, filtroProductoId, filtroAlmacenId, clientes, productos, almacenes])

  // --- Totales de columna del Detalle por Producto (respetan filtros; el
  //     detalle carga TODAS las ventas, asi que la suma es del universo). ---
  const totalColumnaDetalle = React.useMemo(
    () => detalleFiltrado.reduce((acc, d) => acc + d.total_linea, 0),
    [detalleFiltrado]
  )
  const utilidadColumnaDetalle = React.useMemo(
    () => detalleFiltrado.reduce((acc, d) => acc + d.utilidad_linea, 0),
    [detalleFiltrado]
  )
  // Base neta (sin ISV) para el margen bruto = Σ cantidad * precio_unitario.
  const ingresoNetoDetalle = React.useMemo(
    () => detalleFiltrado.reduce((acc, d) => acc + d.cantidad * d.precio_unitario, 0),
    [detalleFiltrado]
  )
  const margenColumnaDetalle = ingresoNetoDetalle > 0 ? (utilidadColumnaDetalle / ingresoNetoDetalle) * 100 : 0

  // --- Comision por linea del Detalle (prorrateo) ---
  // La comision es de la FACTURA (por forma de pago); se reparte entre sus
  // lineas segun el peso de cada linea en el total de su factura.
  const totalLineasPorVenta = React.useMemo(() => {
    const m = new Map<number, number>()
    for (const d of detalleFiltrado) m.set(d.venta_id, (m.get(d.venta_id) ?? 0) + d.total_linea)
    return m
  }, [detalleFiltrado])
  // Subtotal AUTORITATIVO de la columna Comision: suma la comision real de cada
  // venta presente (no la suma de celdas prorrateadas, que arrastra redondeo).
  const comisionColumnaDetalle = React.useMemo(() => {
    let s = 0
    for (const id of totalLineasPorVenta.keys()) s += comisionesPorVenta.get(id)?.comision ?? 0
    return s
  }, [totalLineasPorVenta, comisionesPorVenta])

  // Comision asignada a una linea (o null si su factura no tiene comision).
  function comisionLinea(d: VentaDetalleAnalitico): { pct: number; valor: number } | null {
    const c = comisionesPorVenta.get(d.venta_id)
    if (!c || c.comision <= 0) return null
    const totalVenta = totalLineasPorVenta.get(d.venta_id) ?? 0
    const peso = totalVenta > 0 ? d.total_linea / totalVenta : 0
    return { pct: c.pct, valor: c.comision * peso }
  }

  // --- Totales del Resumen (client-side sobre TODO el set filtrado, no la
  //     pagina). Como `total_venta` quedo homologado a bruto (script 027),
  //     Σ total_venta == Σ total_linea del Detalle, asi ambas pestanas cuadran. ---
  const resumenTotales = React.useMemo(() => {
    let totalVentas = 0, totalSaldo = 0, totalComisiones = 0
    for (const v of ventasFiltradas) {
      const total = v.total_venta ?? 0
      totalVentas += total
      totalSaldo += Math.max(0, total - (v.valorpago ?? 0))
      totalComisiones += v.id != null ? comisionesPorVenta.get(v.id)?.comision ?? 0 : 0
    }
    return {
      totalVentas: +totalVentas.toFixed(2),
      totalSaldo: +totalSaldo.toFixed(2),
      totalComisiones: +totalComisiones.toFixed(2),
      totalSubtotal: +(totalVentas - totalComisiones).toFixed(2),
    }
  }, [ventasFiltradas, comisionesPorVenta])

  // Subtotal (Total - Comision) del encabezado del Detalle.
  const subtotalColumnaDetalle = totalColumnaDetalle - comisionColumnaDetalle

  // --- Slices de paginacion client-side ---
  const ventasPaginadas = React.useMemo(
    () => ventasFiltradas.slice(pageIndexResumen * pageSizeResumen, pageIndexResumen * pageSizeResumen + pageSizeResumen),
    [ventasFiltradas, pageIndexResumen, pageSizeResumen]
  )
  const detallePaginado = React.useMemo(
    () => detalleFiltrado.slice(pageIndexDetalle * pageSizeDetalle, pageIndexDetalle * pageSizeDetalle + pageSizeDetalle),
    [detalleFiltrado, pageIndexDetalle, pageSizeDetalle]
  )

  // Reset de pagina al cambiar filtros o tamano de pagina.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  React.useEffect(() => { setPageIndexResumen(0) }, [
    filtroFechaInicioFacturas, filtroFechaFinFacturas, filtroClienteIdFacturas,
    filtroAlmacenIdFacturas, filtroEstadoPago, pageSizeResumen,
  ])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  React.useEffect(() => { setPageIndexDetalle(0) }, [
    filtroClienteId, filtroProductoId, filtroAlmacenId, detallesAnaliticos, pageSizeDetalle,
  ])

  // --- Actions ---
  async function viewDetalle(venta: VentaEncabezado) {
    setSelectedVenta(venta)
    setShowDetalleDialog(true)
    setPagosDetalle([])
    // Cuentas para resolver el nombre del banco en el desglose de pago.
    if (cuentas.length === 0) {
      getCuentas().then((r) => setCuentas((r.data || []).filter((c) => c.activo !== false)))
    }
    const [detallesRes, pagosRes, pagosDetRes] = await Promise.all([
      getDetallesVenta(venta.id!),
      getPagosVenta(venta.id!),
      getPagosDetalleVenta(venta.id!),
    ])
    setDetalles(detallesRes.data)
    setPagos(pagosRes.data)
    setPagosDetalle(pagosDetRes.data)
  }

  function openPagoDialog(venta: VentaEncabezado) {
    setSelectedVenta(venta)
    // Igual que en la tabla y el modal: el saldo real es
    // total_venta - valorpago (fuente de verdad en la cabecera).
    const pendiente = Math.max(
      0,
      (venta.total_venta ?? 0) - (venta.valorpago ?? 0)
    )
    setPagoMonto(pendiente.toFixed(2))
    // Default segun tesoreria: efectivo solo si hay caja abierta.
    setPagoMetodo(cajaSesion ? "Efectivo" : "Banco")
    setPagoCuentaId("")
    if (cuentas.length === 0) {
      getCuentas().then((r) => setCuentas((r.data || []).filter((c) => c.activo !== false)))
    }
    setShowPagoDialog(true)
  }

  async function handleRegistrarPago() {
    if (!selectedVenta || !pagoMonto) return
    const monto = parseFloat(pagoMonto)
    if (!monto || monto <= 0) {
      toast({ title: "Monto inválido", description: "Ingresa un monto mayor a 0", variant: "destructive" })
      return
    }
    if (pagoMetodo === "Banco" && !pagoCuentaId) {
      toast({ title: "Falta cuenta", description: "Selecciona la cuenta bancaria del abono", variant: "destructive" })
      return
    }
    setSavingPago(true)
    try {
      const { error } = await registrarPago(
        {
          venta_id: selectedVenta.id!,
          monto,
          metodo_pago: pagoMetodo,
        },
        { cuenta_id: pagoMetodo === "Banco" ? Number(pagoCuentaId) : null }
      )
      if (error) { toast({ title: "Error", description: error, variant: "destructive" }); return }
      toast({ title: "Pago registrado", description: "El pago se registro correctamente" })
      setShowPagoDialog(false)
      setShowDetalleDialog(false)
      loadData()
    } catch {
      toast({ title: "Error", description: "Error al registrar el pago", variant: "destructive" })
    } finally {
      setSavingPago(false)
    }
  }

  async function handleEliminarVenta() {
    if (!ventaAEliminar?.id) return
    if (!motivoEliminar.trim()) {
      toast({ title: "Falta el motivo", description: "Indica por qué eliminas esta factura.", variant: "destructive" })
      return
    }
    const idEliminada = ventaAEliminar.id
    setDeletingVenta(true)
    try {
      const { error } = await eliminarVentaCompletamente(idEliminada, motivoEliminar.trim())
      if (error) {
        toast({ title: "Error", description: error, variant: "destructive" })
        return
      }
      toast({
        title: "Venta eliminada",
        description: "Venta y movimientos asociados eliminados. Queda registrada en 'Eliminadas'.",
      })
      // Actualizacion optimista de la tabla: removemos la fila al instante
      // y disparamos un refetch para resincronizar metodos de pago/saldos.
      setVentas(prev => prev.filter(v => v.id !== idEliminada))
      setVentaAEliminar(null)
      setMotivoEliminar("")
      // La lista de eliminadas quedó desactualizada: recárgala si ya se abrió.
      if (eliminadasLoaded) loadEliminadas()
      loadData()
    } catch {
      toast({ title: "Error", description: "No se pudo eliminar la venta", variant: "destructive" })
    } finally {
      setDeletingVenta(false)
    }
  }

  async function handleAnularVenta() {
    if (!ventaAAnular?.id) return
    if (!motivoAnular.trim()) {
      toast({ title: "Falta el motivo", description: "Indica por qué anulas esta factura.", variant: "destructive" })
      return
    }
    const pagado = Number(ventaAAnular.valorpago || 0)
    if (pagado > 0.005 && reembolsoDestino === "cuenta" && !reembolsoCuentaId) {
      toast({ title: "Falta la cuenta", description: "Elige la cuenta bancaria del reembolso.", variant: "destructive" })
      return
    }
    setAnulando(true)
    try {
      const { error } = await anularVenta(ventaAAnular.id, {
        motivo: motivoAnular.trim(),
        reembolso: pagado > 0.005
          ? { destino: reembolsoDestino, cuenta_id: reembolsoDestino === "cuenta" ? Number(reembolsoCuentaId) : null }
          : null,
      })
      if (error) {
        toast({ title: "No se pudo anular", description: error, variant: "destructive" })
        return
      }
      toast({
        title: "Venta anulada",
        description: "La factura conserva su número; el inventario y el dinero se compensaron.",
      })
      setVentaAAnular(null)
      setMotivoAnular("")
      loadData()
    } finally {
      setAnulando(false)
    }
  }

  // Al abrir el diálogo de eliminar, cuenta las devoluciones para avisar que
  // se anularán junto con la venta.
  React.useEffect(() => {
    if (ventaAEliminar?.id == null) { setDevsDeVentaAEliminar(0); return }
    setMotivoEliminar("") // limpia el motivo al abrir el diálogo para otra factura
    let cancel = false
    contarDevolucionesDeVenta(ventaAEliminar.id).then(({ count }) => {
      if (!cancel) setDevsDeVentaAEliminar(count)
    })
    return () => { cancel = true }
  }, [ventaAEliminar?.id])

  function exportToExcel() {
    if (detalleFiltrado.length === 0) {
      toast({ title: "Sin datos", description: "No hay registros para exportar", variant: "destructive" })
      return
    }
    const rows: Record<string, unknown>[] = detalleFiltrado.map(d => {
      const com = comisionLinea(d)
      return {
        "Fecha": d.fecha_venta?.split('T')[0] || "",
        "N° Factura": d.numero_factura,
        "Cliente": d.cliente_nombre,
        "Método": metodosPago.get(d.venta_id) ?? "—",
        "Producto": d.producto_nombre,
        "SKU": d.producto_sku,
        "Cant.": d.cantidad,
        "Precio Unit. (L)": d.precio_unitario.toFixed(2),
        "Total (L)": d.total_linea.toFixed(2),
        "Comisión %": com ? com.pct.toFixed(2) : "0.00",
        "Comisión (L)": com ? com.valor.toFixed(2) : "0.00",
        "Costo Unit. (L)": d.costo_promedio_momento.toFixed(2),
        "Utilidad Bruta (L)": d.utilidad_linea.toFixed(2),
        "Margen %": (() => {
          const base = d.cantidad * d.precio_unitario
          return base > 0 ? ((d.utilidad_linea / base) * 100).toFixed(1) : "0.0"
        })(),
        "Bodega": d.almacen_nombre,
      }
    })
    exportToXlsx(rows, {
      sheetName: "Detalle por Producto",
      filename: "Detalle_Ventas",
      colWidths: [12, 14, 22, 12, 28, 14, 8, 16, 16, 12, 14, 16, 18, 10, 16],
    })
    toast({ title: "Exportado", description: "Archivo Excel generado correctamente" })
  }

  /** Exporta la pestana Resumen de Facturas (todo el set filtrado, con valores numericos). */
  function exportToExcelResumen() {
    if (ventasFiltradas.length === 0) {
      toast({ title: "Sin datos", description: "No hay facturas para exportar", variant: "destructive" })
      return
    }
    const rows: Record<string, unknown>[] = ventasFiltradas.map(v => {
      const total = +(v.total_venta ?? 0).toFixed(2)
      const c = v.id != null ? comisionesPorVenta.get(v.id) : undefined
      const comision = +(c?.comision ?? 0).toFixed(2)
      const saldo = +Math.max(0, (v.total_venta ?? 0) - (v.valorpago ?? 0)).toFixed(2)
      return {
        "N° Factura": v.numero_factura,
        "Fecha": v.fecha_venta?.split('T')[0] || "",
        "Cliente": v.cliente_nombre,
        "Almacen": v.almacen_nombre || "",
        "Total (L)": total,
        "Comisión %": +(c?.pct ?? 0).toFixed(2),
        "Comisión (L)": comision,
        "Subtotal (L)": +(total - comision).toFixed(2),
        "Saldo Pendiente (L)": saldo,
        "Estado Pago": v.estado_pago,
        "Metodo": v.id != null ? (metodosPago.get(v.id) ?? "—") : "—",
        "Cuenta Destino": v.id != null ? ((cuentasDestinoPorVenta.get(v.id) ?? []).join(" · ") || "—") : "—",
      }
    })
    exportToXlsx(rows, {
      sheetName: "Resumen de Facturas",
      filename: "Resumen_Ventas",
      colWidths: [14, 12, 24, 16, 14, 10, 14, 14, 16, 12, 12, 18],
    })
    toast({ title: "Exportado", description: "Archivo Excel generado correctamente" })
  }

  async function generatePdf(venta: VentaEncabezado) {
    const [detallesRes, razonSocial] = await Promise.all([
      getDetallesVenta(venta.id!),
      getRazonSocialForPdf(),
    ])
    const detallesVenta = detallesRes.data
    const cliente = clientes.find(c => c.id === venta.cliente_id)
    // jsPDF dinámico: solo se descarga al generar el PDF (aligera el bundle).
    const { jsPDF } = await import("jspdf")
    const doc = new jsPDF()
    const pageWidth = doc.internal.pageSize.getWidth()
    const pageHeight = doc.internal.pageSize.getHeight()
    doc.setFillColor(245, 245, 245)
    doc.rect(0, 0, pageWidth, pageHeight, "F")
    try {
      const img = new Image()
      img.crossOrigin = "anonymous"
      img.src = razonSocial?.logo_url || ""
      await new Promise(resolve => { img.onload = resolve; img.onerror = resolve; setTimeout(resolve, 1000) })
      if (img.complete && img.naturalWidth > 0) doc.addImage(img, "PNG", 20, 12, 50, 12)
    } catch { /* fallback */ }
    doc.setFontSize(9); doc.setTextColor(100, 100, 100)
    let cy = 32
    doc.text("Correo", 20, cy); doc.text("Telefono", 20, cy + 8); doc.text("Direccion", 20, cy + 16)
    doc.setTextColor(30, 30, 30)
    doc.text(razonSocial?.correo || "", 20, cy + 4)
    doc.text(razonSocial?.telefono || "", 20, cy + 12)
    doc.text((razonSocial?.direccion || "").substring(0, 35), 20, cy + 20)
    doc.setTextColor(100, 100, 100); doc.text("RTN", 80, cy)
    doc.setTextColor(30, 30, 30); doc.text(razonSocial?.documento || "N/A", 80, cy + 4)
    doc.setFontSize(28); doc.setFont("helvetica", "bold"); doc.setTextColor(30, 30, 30)
    doc.text("FACTURA", pageWidth - 20, 28, { align: "right" })
    if (venta.anulada_at) {
      // Sello rojo diagonal (script officemart-003).
      doc.setFontSize(60)
      doc.setTextColor(220, 38, 38)
      doc.text("ANULADA", pageWidth / 2, pageHeight / 2, { align: "center", angle: 30 })
      doc.setTextColor(30, 30, 30)
    }
    doc.setFontSize(12); doc.setFont("helvetica", "normal")
    doc.text(`#${venta.numero_factura}`, pageWidth - 20, 38, { align: "right" })
    const cY = 85
    doc.setDrawColor(200, 200, 200); doc.setLineWidth(0.5)
    doc.line(20, cY - 5, pageWidth - 20, cY - 5)
    doc.setFontSize(9); doc.setTextColor(100, 100, 100)
    doc.text("Cliente", 20, cY); doc.text("RTN Cliente", 80, cY); doc.text("Fecha", pageWidth - 60, cY)
    doc.setTextColor(30, 30, 30); doc.setFont("helvetica", "normal")
    doc.text(cliente?.nombre || venta.cliente_nombre || "N/A", 20, cY + 6)
    doc.text(cliente?.rtn || "N/A", 80, cY + 6)
    doc.text(venta.fecha_venta?.split('T')[0] || "", pageWidth - 60, cY + 6)
    const descY = 110
    doc.setFontSize(12); doc.setFont("helvetica", "bold"); doc.setTextColor(30, 30, 30)
    doc.text("Descripcion", 20, descY)
    doc.setDrawColor(30, 30, 30); doc.setLineWidth(0.8)
    doc.line(20, descY + 3, pageWidth - 20, descY + 3)
    let itemY = descY + 18
    doc.setFontSize(10); doc.setFont("helvetica", "normal")
    detallesVenta.forEach(d => {
      const sub = (d.cantidad ?? 0) * (d.precio_unitario ?? 0)
      doc.setTextColor(30, 30, 30)
      doc.text(`${d.producto_nombre || ""} (x${d.cantidad})`, 20, itemY)
      doc.text(`L ${sub.toFixed(2)}`, pageWidth - 20, itemY, { align: "right" })
      doc.setDrawColor(180, 180, 180); doc.setLineDashPattern([1, 1], 0)
      doc.line(20, itemY + 4, pageWidth - 20, itemY + 4)
      doc.setLineDashPattern([], 0)
      itemY += 12
    })
    const tY = Math.max(itemY + 15, 180)
    doc.setFontSize(10); doc.setFont("helvetica", "normal"); doc.setTextColor(100, 100, 100)
    doc.text("Subtotal", pageWidth - 80, tY); doc.setTextColor(30, 30, 30)
    doc.text(`L ${(venta.subtotal ?? 0).toFixed(2)}`, pageWidth - 20, tY, { align: "right" })
    doc.setTextColor(100, 100, 100)
    doc.text(`ISV (${venta.porcentaje_impuesto || 15}%)`, pageWidth - 80, tY + 12)
    doc.setTextColor(30, 30, 30)
    doc.text(`L ${(venta.impuesto_total ?? 0).toFixed(2)}`, pageWidth - 20, tY + 12, { align: "right" })
    doc.setFont("helvetica", "bold"); doc.setTextColor(30, 30, 30)
    doc.text("Total", pageWidth - 80, tY + 26)
    doc.setFontSize(12)
    doc.text(`L ${(venta.total_venta ?? 0).toFixed(2)}`, pageWidth - 20, tY + 26, { align: "right" })
    const fY = pageHeight - 40
    doc.setDrawColor(200, 200, 200); doc.setLineWidth(0.5); doc.setLineDashPattern([], 0)
    doc.line(20, fY - 10, pageWidth - 20, fY - 10)
    doc.setFontSize(9); doc.setFont("helvetica", "bold"); doc.setTextColor(30, 30, 30)
    doc.text("Detalles de Pago", 20, fY)
    doc.setFont("helvetica", "normal"); doc.setTextColor(100, 100, 100); doc.setFontSize(8)
    doc.text(`RTN: ${razonSocial?.documento || "N/A"}`, 20, fY + 8)
    doc.text(`Tel: ${razonSocial?.telefono || "N/A"}`, 20, fY + 14)
    doc.setFontSize(9); doc.setFont("helvetica", "bold"); doc.setTextColor(30, 30, 30)
    doc.text("Condiciones", 110, fY)
    doc.setFont("helvetica", "normal"); doc.setTextColor(100, 100, 100); doc.setFontSize(8)
    doc.text("Gracias por su compra. Este documento", 110, fY + 8)
    doc.text("es valido como comprobante fiscal.", 110, fY + 14)
    doc.setFontSize(7); doc.setTextColor(168, 162, 158)
    doc.text("Generado por EasyCount", pageWidth / 2, pageHeight - 8, { align: "center" })
    try {
      const pdfBlob = doc.output("blob")
      const blobUrl = URL.createObjectURL(pdfBlob)
      const link = document.createElement("a")
      link.href = blobUrl; link.download = `Factura_${venta.numero_factura}.pdf`
      document.body.appendChild(link); link.click(); document.body.removeChild(link)
      setTimeout(() => URL.revokeObjectURL(blobUrl), 100)
      toast({ title: "PDF Generado", description: "La factura se descargo correctamente" })
    } catch {
      toast({ title: "Error", description: "No se pudo generar el PDF", variant: "destructive" })
    }
  }

  /**
   * Reimprime la tirilla termica (80 mm) de una venta del historial. Reconstruye
   * la misma `TirillaVenta` que arma Nueva Venta, pero a partir de lo persistido:
   * encabezado + detalles + desglose de pagos. Respeta los flags de la empresa
   * (mostrar ISV, mostrar codigo de producto) igual que en el punto de venta.
   */
  async function reimprimirTirilla(venta: VentaEncabezado) {
    if (venta.id == null) return
    setTirillaVentaId(venta.id)
    try {
      const [detallesRes, pagosDetalleRes, razonSocial] = await Promise.all([
        getDetallesVenta(venta.id),
        getPagosDetalleVenta(venta.id),
        getRazonSocialForPdf(),
      ])
      const detalles = detallesRes.data
      const pagos = pagosDetalleRes.data
      const cliente = clientes.find((c) => c.id === venta.cliente_id)

      const subtotal = venta.subtotal ?? 0
      const descuentoPct = venta.descuento ?? 0
      const descuentoMonto = +(subtotal * (descuentoPct / 100)).toFixed(2)
      // Solo mostramos ISV si la empresa lo tiene activo Y la venta aplico impuesto.
      const mostrarIsv = (user?.flags?.ventas_mostrar_isv ?? true) && !!venta.aplica_impuesto
      const valorPagado = venta.valorpago ?? 0

      // Si no hay desglose en ventas_pagos_detalle (ventas viejas o migracion
      // pendiente), caemos a una sola linea con el metodo agregado conocido.
      const pagosTirilla =
        pagos.length > 0
          ? pagos.map((p) => ({
              metodo: metodoPagoLabel(
                p.metodo_pago,
                cuentas.find((c) => c.id === p.cuenta_id)?.nombre,
              ),
              monto: Number(p.monto_bruto) || 0,
            }))
          : valorPagado > 0
            ? [{ metodo: metodosPago.get(venta.id) || "Pago", monto: valorPagado }]
            : []

      // Reconstruye el bloque fiscal CAI si la venta se emitio como comprobante
      // (tiene numero_fiscal persistido). Toma la config CAI vigente para el
      // rango/fecha limite/imprenta del encabezado.
      let fiscal: TirillaFiscal | null = null
      if (venta.numero_fiscal) {
        const { data: cfgs } = await getConfigsCai()
        const cfg: ConfigCai | undefined = cfgs.find(
          (c) => c.tipo_documento === (venta.tipo_documento_fiscal || "01"),
        )
        const desglose = calcularDesgloseFiscal(subtotal - descuentoMonto, venta.impuesto_total ?? 0, !!venta.aplica_impuesto)
        fiscal = {
          cai: venta.cai_emitido || cfg?.cai || "",
          numeroFiscal: venta.numero_fiscal,
          rangoDesde: cfg ? formatearCorrelativoCai(cfg.establecimiento, cfg.punto_emision, cfg.tipo_documento, cfg.rango_inicial) : null,
          rangoHasta: cfg && cfg.rango_final > 0 ? formatearCorrelativoCai(cfg.establecimiento, cfg.punto_emision, cfg.tipo_documento, cfg.rango_final) : null,
          fechaLimite: cfg?.fecha_limite_emision ? fmtFechaCorta(cfg.fecha_limite_emision) : null,
          clienteRtn: cliente?.rtn || null,
          esConsumidorFinal: !cliente?.rtn,
          ...desglose,
          totalEnLetras: totalEnLetras(venta.total_venta ?? 0),
          imprentaNombre: cfg?.imprenta_nombre || null,
          imprentaRtn: cfg?.imprenta_rtn || null,
          imprentaRegistro: cfg?.imprenta_registro || null,
        }
      }

      const tirilla: TirillaVenta = {
        empresa: {
          nombre:
            razonSocial?.nombre_comercial ||
            razonSocial?.nombre_empresa ||
            user?.razon_social_nombre ||
            "",
          rtn: razonSocial?.documento || null,
          direccion: razonSocial?.direccion || null,
          telefono: razonSocial?.telefono || null,
          logoUrl: tirillaLogoUrl(user?.razon_social_id),
        },
        numeroFactura: venta.numero_factura,
        fechaISO: venta.fecha_venta || new Date().toISOString(),
        cliente: cliente?.nombre || venta.cliente_nombre || "Consumidor Final",
        fiscal,
        lineas: detalles.map((d) => ({
          nombre: d.producto_nombre || "",
          cantidad: d.cantidad ?? 0,
          precioUnitario: d.precio_unitario ?? 0,
          codigo: d.producto_codigo,
        })),
        subtotal,
        descuentoPct,
        descuentoMonto,
        mostrarIsv,
        isv: venta.impuesto_total ?? 0,
        total: venta.total_venta ?? 0,
        pagos: pagosTirilla,
        valorPagado,
        saldo: Math.max(0, +(((venta.total_venta ?? 0) - valorPagado)).toFixed(2)),
        mostrarCodigoProducto: user?.flags?.tirilla_mostrar_codigo ?? false,
        anulada: !!venta.anulada_at,
        motivoAnulacion: venta.motivo_anulacion ?? null,
      }

      printTirilla(buildTirillaVentaHtml(tirilla), { widthMm: 80 })
    } catch {
      toast({ title: "Error", description: "No se pudo preparar la tirilla", variant: "destructive" })
    } finally {
      setTirillaVentaId(null)
    }
  }

  /**
   * Pinta un badge compacto con el metodo de pago agregado de la venta.
   * Mapea las etiquetas del helper (Efectivo / Banco / Mixto / Credito / Otro)
   * a un icono + color consistente. Si no hay registro -> guion suave.
   */
  const getMetodoPagoBadge = (ventaId: number | undefined) => {
    if (ventaId == null) return <span className="text-stone-400">&mdash;</span>
    const tipo = metodosPago.get(ventaId)
    if (!tipo) return <span className="text-stone-400">&mdash;</span>

    // Cuenta(s) destino de las lineas bancarias de esta venta. Se muestra
    // junto a "Banco"/"Mixto" para saber a que cuenta entro el dinero.
    const cuentas = cuentasDestinoPorVenta.get(ventaId) ?? []
    const cuentasTexto = cuentas.join(" · ")

    switch (tipo) {
      case "Efectivo":
        return (
          <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100 border border-emerald-200 gap-1 font-normal">
            <Wallet className="h-3 w-3" /> Efectivo
          </Badge>
        )
      case "Banco":
        return (
          <div className="flex flex-col items-start gap-0.5">
            <Badge className="bg-blue-100 text-blue-700 hover:bg-blue-100 border border-blue-200 gap-1 font-normal">
              <Banknote className="h-3 w-3" /> Banco
            </Badge>
            {cuentasTexto && (
              <span className="text-xs text-stone-500 whitespace-nowrap" title={cuentasTexto}>
                {cuentasTexto}
              </span>
            )}
          </div>
        )
      case "Mixto":
        return (
          <div className="flex flex-col items-start gap-0.5">
            <Badge className="bg-purple-100 text-purple-700 hover:bg-purple-100 border border-purple-200 gap-1 font-normal">
              <Shuffle className="h-3 w-3" /> Mixto
            </Badge>
            {cuentasTexto && (
              <span className="text-xs text-stone-500 whitespace-nowrap" title={cuentasTexto}>
                Banco: {cuentasTexto}
              </span>
            )}
          </div>
        )
      case "Credito":
        return (
          <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100 border border-amber-200 gap-1 font-normal">
            <CreditCard className="h-3 w-3" /> Credito
          </Badge>
        )
      default:
        return (
          <Badge variant="outline" className="font-normal">
            Otro
          </Badge>
        )
    }
  }

  const getEstadoBadge = (estado: string) => {
    // Convencion de colores del modulo de cartera:
    //   Pagado  -> Verde  (liquidado)
    //   Parcial -> Amarillo (con abono parcial)
    //   Pendiente -> Rojo (sin pago)
    switch (estado) {
      case "Pagado":
        return <Badge className="bg-emerald-500 hover:bg-emerald-600 text-white">Pagado</Badge>
      case "Parcial":
        return <Badge className="bg-amber-500 hover:bg-amber-600 text-white">Parcial</Badge>
      default:
        return <Badge className="bg-red-500 hover:bg-red-600 text-white">Pendiente</Badge>
    }
  }

  if (loading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-52" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-72 w-full" />
      </div>
    )
  }

  // ─── Saldo del modal ──────────────────────────────────────────────
  // Usamos `valorpago` (campo persistido en la cabecera de la venta) como
  // unica fuente de verdad para "cuanto se ha pagado". Esto coincide con
  // el calculo de la tabla principal (`saldo = total_venta - valorpago`)
  // y evita el desfase que ocurria al sumar solo los registros del array
  // `pagos`, que puede no incluir el pago inicial hecho al crear la venta.
  const totalPagado = selectedVenta ? selectedVenta.valorpago ?? 0 : 0
  const saldoPendiente = selectedVenta
    ? Math.max(0, (selectedVenta.total_venta ?? 0) - totalPagado)
    : 0

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-xl md:text-2xl font-bold text-foreground">Historial de Ventas</h1>
        <p className="text-sm text-muted-foreground">Consulta y gestiona tus facturas</p>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="facturas" onValueChange={handleTabChange}>
        <TabsList className="bg-stone-100 border border-stone-200 rounded-xl p-1 h-auto">
          <TabsTrigger
            value="facturas"
            className="rounded-lg px-5 py-2 text-sm font-medium data-[state=active]:bg-white data-[state=active]:shadow-sm data-[state=active]:text-stone-900 text-stone-500"
          >
            Resumen de Facturas
          </TabsTrigger>
          <TabsTrigger
            value="detalle"
            className="rounded-lg px-5 py-2 text-sm font-medium data-[state=active]:bg-white data-[state=active]:shadow-sm data-[state=active]:text-stone-900 text-stone-500"
          >
            Detalle por Producto
          </TabsTrigger>
          <TabsTrigger
            value="eliminadas"
            className="rounded-lg px-5 py-2 text-sm font-medium data-[state=active]:bg-white data-[state=active]:shadow-sm data-[state=active]:text-stone-900 text-stone-500"
          >
            Eliminadas
          </TabsTrigger>
        </TabsList>

        {/* ── Tab 1: Resumen de Facturas ── */}
        <TabsContent value="facturas" className="mt-4 space-y-4">
          {/* Acciones */}
          <div className="flex justify-end gap-2">
            <Button
              className="gap-2 bg-stone-800 hover:bg-stone-900 text-white"
              onClick={exportToExcelResumen}
              disabled={ventasFiltradas.length === 0}
            >
              <FileSpreadsheet className="h-4 w-4" />
              Exportar
            </Button>
            <ImportarVentasDialog onImported={loadData} />
          </div>

          {/* Filtros */}
          <Card className="rounded-2xl shadow-sm border border-stone-200 bg-stone-50">
            <CardContent className="p-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 items-end">
                {/* Fecha Inicio */}
                <div>
                  <Label className="text-xs text-stone-600 mb-1.5 block">Fecha Inicio</Label>
                  <Input
                    type="date"
                    value={filtroFechaInicioFacturas}
                    onChange={e => setFiltroFechaInicioFacturas(e.target.value)}
                    className="bg-white border-stone-200"
                  />
                </div>

                {/* Fecha Fin */}
                <div>
                  <Label className="text-xs text-stone-600 mb-1.5 block">Fecha Fin</Label>
                  <Input
                    type="date"
                    value={filtroFechaFinFacturas}
                    onChange={e => setFiltroFechaFinFacturas(e.target.value)}
                    className="bg-white border-stone-200"
                  />
                </div>

                {/* Cliente */}
                <div>
                  <Label className="text-xs text-stone-600 mb-1.5 block">Cliente</Label>
                  <Select value={filtroClienteIdFacturas || "all"} onValueChange={(v) => setFiltroClienteIdFacturas(v === "all" ? "" : v)}>
                    <SelectTrigger className="bg-white border-stone-200">
                      <SelectValue placeholder="Todos" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos los clientes</SelectItem>
                      {clientes.map(c => (
                        <SelectItem key={c.id} value={c.id!.toString()}>
                          {c.nombre}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Almacen */}
                <div>
                  <Label className="text-xs text-stone-600 mb-1.5 block">Almacen</Label>
                  <Select value={filtroAlmacenIdFacturas || "all"} onValueChange={(v) => setFiltroAlmacenIdFacturas(v === "all" ? "" : v)}>
                    <SelectTrigger className="bg-white border-stone-200">
                      <SelectValue placeholder="Todos" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos los almacenes</SelectItem>
                      {almacenes.map(a => (
                        <SelectItem key={a.id} value={a.id!.toString()}>
                          {a.nombre}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Estado Pago */}
                <div>
                  <Label className="text-xs text-stone-600 mb-1.5 block">Estado Pago</Label>
                  <Select value={filtroEstadoPago || "all"} onValueChange={(v) => setFiltroEstadoPago(v === "all" ? "" : v)}>
                    <SelectTrigger className="bg-white border-stone-200">
                      <SelectValue placeholder="Todos" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos</SelectItem>
                      <SelectItem value="Pendiente">Pendiente</SelectItem>
                      <SelectItem value="Parcial">Parcial</SelectItem>
                      <SelectItem value="Pagado">Pagado</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Anuladas (script officemart-003) */}
                <div className="flex items-center gap-2 self-end pb-2">
                  <Switch id="mostrar-anuladas" checked={mostrarAnuladas} onCheckedChange={setMostrarAnuladas} />
                  <Label htmlFor="mostrar-anuladas" className="text-xs text-stone-600">Mostrar anuladas</Label>
                </div>

                {/* Limpiar */}
                <Button
                  variant="outline"
                  className="border-stone-200 bg-white hover:bg-stone-100"
                  onClick={() => {
                    setFiltroFechaInicioFacturas("")
                    setFiltroFechaFinFacturas("")
                    setFiltroClienteIdFacturas("")
                    setFiltroAlmacenIdFacturas("")
                    setFiltroEstadoPago("")
                    setMostrarAnuladas(false)
                  }}
                >
                  Limpiar Filtros
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Listado (tabla en todos los dispositivos; scroll horizontal en movil) */}
          <Card className="rounded-2xl shadow-sm border border-stone-200">
            <CardContent className="p-0 overflow-x-auto">
              <Table containerClassName="max-h-[60vh] overflow-y-auto">
                <TableHeader sticky>
                  <TableRow className="bg-stone-50 border-b border-stone-200">
                    <TableHead className="font-semibold text-stone-700 whitespace-nowrap">N° Factura</TableHead>
                    <TableHead className="font-semibold text-stone-700 whitespace-nowrap">Fecha</TableHead>
                    <TableHead className="font-semibold text-stone-700 whitespace-nowrap">Cliente</TableHead>
                    {mostrarVendedor && (
                      <TableHead className="font-semibold text-stone-700 whitespace-nowrap">Vendedor</TableHead>
                    )}
                    <TableHead className="font-semibold text-stone-700 whitespace-nowrap">Almacen</TableHead>
                    <TableHead className="font-semibold text-stone-700 text-right whitespace-nowrap">
                      <div>Total</div>
                      <div className="text-xs font-bold text-stone-900">{formatCurrency(resumenTotales.totalVentas)}</div>
                    </TableHead>
                    <TableHead className="font-semibold text-stone-700 text-right whitespace-nowrap">
                      <div>Comisión</div>
                      <div className="text-xs font-bold text-amber-700">{formatCurrency(resumenTotales.totalComisiones)}</div>
                    </TableHead>
                    <TableHead className="font-semibold text-stone-700 text-right whitespace-nowrap">
                      <div>Subtotal</div>
                      <div className="text-xs font-bold text-stone-900">{formatCurrency(resumenTotales.totalSubtotal)}</div>
                    </TableHead>
                    <TableHead className="font-semibold text-stone-700 text-right whitespace-nowrap">
                      <div>Saldo Pendiente</div>
                      <div className="text-xs font-bold text-stone-900">{formatCurrency(resumenTotales.totalSaldo)}</div>
                    </TableHead>
                    <TableHead className="font-semibold text-stone-700 whitespace-nowrap">Estado Pago</TableHead>
                    <TableHead className="font-semibold text-stone-700 whitespace-nowrap">Metodo</TableHead>
                    <TableHead className="font-semibold text-stone-700 text-right whitespace-nowrap">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ventasFiltradas.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={mostrarVendedor ? 12 : 11} className="text-center text-muted-foreground py-10">
                        No hay ventas para mostrar
                      </TableCell>
                    </TableRow>
                  ) : ventasPaginadas.map(venta => {
                    // Saldo = total_venta - valorpago (COALESCE a 0)
                    const saldo = (venta.total_venta ?? 0) - (venta.valorpago ?? 0)
                    const comisionVenta = venta.id != null ? comisionesPorVenta.get(venta.id) : undefined
                    const comisionVal = comisionVenta?.comision ?? 0
                    const subtotalVal = (venta.total_venta ?? 0) - comisionVal
                    const anulada = !!venta.anulada_at
                    return (
                      <TableRow key={venta.id} className={anulada ? "bg-red-50/40 text-stone-400 hover:bg-red-50/60" : "hover:bg-stone-50/50"}>
                        <TableCell className="font-mono font-medium whitespace-nowrap">
                          <span className={anulada ? "line-through" : ""}>{venta.numero_factura}</span>
                          {anulada && (
                            <Badge variant="outline" className="ml-2 border-red-200 bg-red-50 text-red-700 align-middle" title={venta.motivo_anulacion || "Anulada"}>
                              ANULADA
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">{venta.fecha_venta?.split('T')[0] || ''}</TableCell>
                        <TableCell className="whitespace-nowrap">{venta.cliente_nombre}</TableCell>
                        {mostrarVendedor && (
                          <TableCell className="text-muted-foreground whitespace-nowrap">
                            {venta.vendedor_id != null ? vendedorNombre.get(venta.vendedor_id) || '—' : '—'}
                          </TableCell>
                        )}
                        <TableCell className="text-muted-foreground whitespace-nowrap">{venta.almacen_nombre || '-'}</TableCell>
                        <TableCell className="text-right font-medium whitespace-nowrap">{formatCurrency(venta.total_venta ?? 0)}</TableCell>
                        <TableCell className="text-right whitespace-nowrap">
                          {comisionVenta && comisionVal > 0 ? (
                            <span className="text-amber-700">{comisionVenta.pct.toFixed(2)}% · {formatCurrency(comisionVal)}</span>
                          ) : (
                            <span className="text-stone-400">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right font-medium whitespace-nowrap">{formatCurrency(subtotalVal)}</TableCell>
                        <TableCell
                          className={`text-right font-medium whitespace-nowrap ${
                            saldo <= 0
                              ? "text-emerald-600"
                              : saldo < (venta.total_venta ?? 0)
                                ? "text-amber-600"
                                : "text-red-600"
                          }`}
                        >
                          {formatCurrency(Math.max(0, saldo))}
                        </TableCell>
                        <TableCell>{getEstadoBadge(venta.estado_pago)}</TableCell>
                        <TableCell>{getMetodoPagoBadge(venta.id)}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            {saldo > 0.005 && !anulada && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50"
                                onClick={() => openPagoDialog(venta)}
                                title="Registrar pago"
                              >
                                <Banknote className="h-4 w-4" />
                              </Button>
                            )}
                            <Button variant="ghost" size="icon" onClick={() => viewDetalle(venta)} title="Ver detalle">
                              <Eye className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="icon" onClick={() => generatePdf(venta)} title="Descargar factura (PDF)">
                              <Download className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => reimprimirTirilla(venta)}
                              disabled={tirillaVentaId === venta.id}
                              title="Reimprimir tirilla (80 mm)"
                            >
                              {tirillaVentaId === venta.id ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Printer className="h-4 w-4" />
                              )}
                            </Button>
                            {!anulada && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="text-sky-600 hover:text-sky-700 hover:bg-sky-50"
                                onClick={() => router.push(`/ventas/editar/${venta.id}`)}
                                title="Editar venta"
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                            )}
                            {!anulada && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="text-red-600 hover:text-red-700 hover:bg-red-50"
                                onClick={() => {
                                  setVentaAAnular(venta)
                                  setMotivoAnular("")
                                  setReembolsoDestino("caja")
                                  setReembolsoCuentaId("")
                                }}
                                title="Anular venta (conserva el documento)"
                              >
                                <Ban className="h-4 w-4" />
                              </Button>
                            )}
                            {!anulada && permitirEliminar && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="text-red-600 hover:text-red-700 hover:bg-red-50"
                                onClick={() => setVentaAEliminar(venta)}
                                title="Eliminar venta (borrado físico)"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </CardContent>
            <TablePaginator
              pageIndex={pageIndexResumen}
              pageSize={pageSizeResumen}
              totalItems={ventasFiltradas.length}
              onPageIndexChange={setPageIndexResumen}
              onPageSizeChange={setPageSizeResumen}
              className="border-t border-stone-200"
            />
          </Card>
        </TabsContent>

        {/* ── Tab 2: Detalle por Producto ── */}
        <TabsContent value="detalle" className="mt-4 space-y-4">
          {/* Filtros y Resumen combinados */}
          <Card className="rounded-2xl shadow-sm border border-stone-200 bg-stone-50">
            <CardContent className="p-4 space-y-4">
              {/* Resumen en la parte superior */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm pb-4 border-b border-stone-200">
                <div>
                  <p className="text-stone-500 text-xs mb-1">Lineas</p>
                  <p className="font-semibold text-stone-800 text-lg">{detalleFiltrado.length}</p>
                </div>
                <div>
                  <p className="text-stone-500 text-xs mb-1">Unidades Vendidas</p>
                  <p className="font-semibold text-stone-800 text-lg">{formatNumber(detalleFiltrado.reduce((a, d) => a + d.cantidad, 0))}</p>
                </div>
                <div>
                  <p className="text-stone-500 text-xs mb-1">Ingresos Totales</p>
                  <p className="font-semibold text-stone-800 text-lg">
                    {formatCurrency(detalleFiltrado.reduce((a, d) => a + d.cantidad * d.precio_unitario, 0))}
                  </p>
                </div>
                <div>
                  <p className="text-stone-500 text-xs mb-1">Utilidad Total</p>
                  <p className="font-semibold text-emerald-700 text-lg">
                    {formatCurrency(utilidadColumnaDetalle)}
                    <span className="text-sm font-medium text-emerald-600 ml-1">({margenColumnaDetalle.toFixed(1)}%)</span>
                  </p>
                </div>
              </div>

              {/* Filtros y acciones */}
              <div className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                  {/* Filtro Fecha Inicio */}
                  <div>
                    <Label className="text-xs text-stone-600 mb-1.5 block">Fecha Inicio</Label>
                    <Input
                      type="date"
                      value={filtroFechaInicio}
                      onChange={e => setFiltroFechaInicio(e.target.value)}
                      className="bg-white border-stone-200"
                    />
                  </div>

                  {/* Filtro Fecha Fin */}
                  <div>
                    <Label className="text-xs text-stone-600 mb-1.5 block">Fecha Fin</Label>
                    <Input
                      type="date"
                      value={filtroFechaFin}
                      onChange={e => setFiltroFechaFin(e.target.value)}
                      className="bg-white border-stone-200"
                    />
                  </div>

                  {/* Filtro Cliente */}
                  <div>
                    <Label className="text-xs text-stone-600 mb-1.5 block">Cliente</Label>
                    <Select value={filtroClienteId || "all"} onValueChange={(v) => setFiltroClienteId(v === "all" ? "" : v)}>
                      <SelectTrigger className="bg-white border-stone-200">
                        <SelectValue placeholder="Todos los clientes" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Todos los clientes</SelectItem>
                        {clientes.map(c => (
                          <SelectItem key={c.id} value={c.id!.toString()}>
                            {c.nombre}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Filtro Producto */}
                  <div>
                    <Label className="text-xs text-stone-600 mb-1.5 block">Producto</Label>
                    <Select value={filtroProductoId || "all"} onValueChange={(v) => setFiltroProductoId(v === "all" ? "" : v)}>
                      <SelectTrigger className="bg-white border-stone-200">
                        <SelectValue placeholder="Todos los productos" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Todos los productos</SelectItem>
                        {productos.map(p => (
                          <SelectItem key={p.id} value={p.id!.toString()}>
                            {p.nombre}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Filtro Almacen */}
                  <div>
                    <Label className="text-xs text-stone-600 mb-1.5 block">Bodega</Label>
                    <Select value={filtroAlmacenId || "all"} onValueChange={(v) => setFiltroAlmacenId(v === "all" ? "" : v)}>
                      <SelectTrigger className="bg-white border-stone-200">
                        <SelectValue placeholder="Todas las bodegas" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Todas las bodegas</SelectItem>
                        {almacenes.map(a => (
                          <SelectItem key={a.id} value={a.id!.toString()}>
                            {a.nombre}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* Botones de accion */}
                <div className="flex flex-wrap gap-2 justify-end">
                  <Button
                    variant="outline"
                    className="border-stone-200 bg-white hover:bg-stone-100"
                    onClick={() => { 
                      setFiltroFechaInicio(""); 
                      setFiltroFechaFin(""); 
                      setFiltroClienteId(""); 
                      setFiltroProductoId(""); 
                      setFiltroAlmacenId(""); 
                    }}
                  >
                    Limpiar Filtros
                  </Button>
                  <Button
                    variant="outline"
                    className="border-stone-200 bg-white hover:bg-stone-100"
                    onClick={loadAnalitico}
                    disabled={loadingAnalitico}
                  >
                    {loadingAnalitico ? "Cargando..." : "Actualizar"}
                  </Button>
                  <Button
                    className="gap-2 bg-stone-800 hover:bg-stone-900 text-white"
                    onClick={exportToExcel}
                    disabled={detalleFiltrado.length === 0}
                  >
                    <FileSpreadsheet className="h-4 w-4" />
                    Exportar
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-2xl shadow-sm border border-stone-200">
            <CardContent className="p-0 overflow-x-auto">
              <Table containerClassName="max-h-[60vh] overflow-y-auto">
                <TableHeader sticky>
                  <TableRow className="bg-stone-50 border-b border-stone-200">
                    <TableHead className="font-semibold text-stone-700 whitespace-nowrap">Fecha</TableHead>
                    <TableHead className="font-semibold text-stone-700 whitespace-nowrap">N° Factura</TableHead>
                    <TableHead className="font-semibold text-stone-700 whitespace-nowrap">Cliente</TableHead>
                    <TableHead className="font-semibold text-stone-700 whitespace-nowrap">Método</TableHead>
                    <TableHead className="font-semibold text-stone-700 whitespace-nowrap">Producto</TableHead>
                    <TableHead className="font-semibold text-stone-700 whitespace-nowrap">SKU</TableHead>
                    <TableHead className="font-semibold text-stone-700 text-right whitespace-nowrap">Cant.</TableHead>
                    <TableHead className="font-semibold text-stone-700 text-right whitespace-nowrap">Precio Unit.</TableHead>
                    <TableHead className="font-semibold text-stone-700 text-right whitespace-nowrap">
                      <div>Total</div>
                      <div className="text-xs font-bold text-stone-900">{formatCurrency(totalColumnaDetalle)}</div>
                    </TableHead>
                    <TableHead className="font-semibold text-stone-700 text-right whitespace-nowrap">
                      <div>Comisión</div>
                      <div className="text-xs font-bold text-amber-700">{formatCurrency(comisionColumnaDetalle)}</div>
                    </TableHead>
                    <TableHead className="font-semibold text-stone-700 text-right whitespace-nowrap">
                      <div>Subtotal</div>
                      <div className="text-xs font-bold text-stone-900">{formatCurrency(subtotalColumnaDetalle)}</div>
                    </TableHead>
                    <TableHead className="font-semibold text-stone-700 text-right whitespace-nowrap">Costo Unit.</TableHead>
                    <TableHead className="font-semibold text-stone-700 text-right whitespace-nowrap">
                      <div>Utilidad Bruta</div>
                      <div className="text-xs font-bold text-emerald-700">
                        {formatCurrency(utilidadColumnaDetalle)} ({margenColumnaDetalle.toFixed(1)}%)
                      </div>
                    </TableHead>
                    <TableHead className="font-semibold text-stone-700 whitespace-nowrap">Bodega</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loadingAnalitico ? (
                    [...Array(5)].map((_, i) => (
                      <TableRow key={i}>
                        {[...Array(14)].map((_, j) => (
                          <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                        ))}
                      </TableRow>
                    ))
                  ) : detalleFiltrado.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={14} className="text-center text-muted-foreground py-10">
                        {analiticoLoaded ? "No hay registros para los filtros aplicados" : "Cargando datos..."}
                      </TableCell>
                    </TableRow>
                  ) : detallePaginado.map((d, idx) => {
                    const com = comisionLinea(d)
                    const subtotalLinea = d.total_linea - (com?.valor ?? 0)
                    return (
                    <TableRow key={idx} className="hover:bg-stone-50/50">
                      <TableCell className="whitespace-nowrap">{d.fecha_venta?.split('T')[0] || ''}</TableCell>
                      <TableCell className="font-mono whitespace-nowrap">{d.numero_factura}</TableCell>
                      <TableCell className="whitespace-nowrap">{d.cliente_nombre}</TableCell>
                      <TableCell className="whitespace-nowrap">{getMetodoPagoBadge(d.venta_id)}</TableCell>
                      <TableCell className="font-medium whitespace-nowrap">{d.producto_nombre}</TableCell>
                      <TableCell className="text-muted-foreground whitespace-nowrap">{d.producto_sku}</TableCell>
                      <TableCell className="text-right">{formatNumber(d.cantidad)}</TableCell>
                      <TableCell className="text-right whitespace-nowrap">{formatCurrency(d.precio_unitario)}</TableCell>
                      <TableCell className="text-right whitespace-nowrap font-medium">{formatCurrency(d.total_linea)}</TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        {com ? (
                          <span className="text-amber-700">{com.pct.toFixed(2)}% · {formatCurrency(com.valor)}</span>
                        ) : (
                          <span className="text-stone-400">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap font-medium">{formatCurrency(subtotalLinea)}</TableCell>
                      <TableCell className="text-right whitespace-nowrap text-muted-foreground">{formatCurrency(d.costo_promedio_momento)}</TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1.5">
                          <Badge className={d.utilidad_linea >= 0 ? "bg-emerald-100 text-emerald-800 hover:bg-emerald-100" : "bg-red-100 text-red-800 hover:bg-red-100"}>
                            {formatCurrency(d.utilidad_linea)}
                          </Badge>
                          <span className="text-xs text-muted-foreground w-12 text-right">
                            {(() => {
                              const base = d.cantidad * d.precio_unitario
                              return base > 0 ? `${((d.utilidad_linea / base) * 100).toFixed(1)}%` : "—"
                            })()}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">{d.almacen_nombre}</TableCell>
                    </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </CardContent>
            <TablePaginator
              pageIndex={pageIndexDetalle}
              pageSize={pageSizeDetalle}
              totalItems={detalleFiltrado.length}
              onPageIndexChange={setPageIndexDetalle}
              onPageSizeChange={setPageSizeDetalle}
              className="border-t border-stone-200"
            />
          </Card>

        </TabsContent>

        {/* ── Tab 3: Facturas eliminadas (trazabilidad) ── */}
        <TabsContent value="eliminadas" className="mt-4 space-y-4">
          <Card className="rounded-2xl shadow-sm border border-stone-200">
            <CardContent className="p-0 overflow-x-auto">
              {loadingEliminadas ? (
                <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-stone-400" /></div>
              ) : eliminadas.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground text-sm">
                  No hay facturas eliminadas registradas.
                  <div className="text-xs mt-1 text-stone-400">Las facturas que elimines aquí quedarán guardadas con su detalle y motivo.</div>
                </div>
              ) : (
                <Table containerClassName="max-h-[60vh] overflow-y-auto">
                  <TableHeader sticky>
                    <TableRow className="bg-stone-50 border-b border-stone-200">
                      <TableHead className="font-semibold text-stone-700 whitespace-nowrap">N° Factura</TableHead>
                      <TableHead className="font-semibold text-stone-700 whitespace-nowrap">Cliente</TableHead>
                      <TableHead className="font-semibold text-stone-700 text-right whitespace-nowrap">Total</TableHead>
                      <TableHead className="font-semibold text-stone-700 whitespace-nowrap">Fecha factura</TableHead>
                      <TableHead className="font-semibold text-stone-700 whitespace-nowrap">Eliminada</TableHead>
                      <TableHead className="font-semibold text-stone-700 whitespace-nowrap">Por</TableHead>
                      <TableHead className="font-semibold text-stone-700 whitespace-nowrap">Motivo</TableHead>
                      <TableHead className="font-semibold text-stone-700 text-right whitespace-nowrap">Detalle</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {eliminadas.map((e) => (
                      <TableRow key={e.id} className="hover:bg-stone-50/50">
                        <TableCell className="font-mono font-medium whitespace-nowrap">{e.numero_factura || "—"}</TableCell>
                        <TableCell className="whitespace-nowrap">{e.cliente_nombre || "—"}</TableCell>
                        <TableCell className="text-right font-medium whitespace-nowrap">{formatCurrency(e.total_venta ?? 0)}</TableCell>
                        <TableCell className="whitespace-nowrap text-muted-foreground">{(e.fecha_venta || "").slice(0, 10) || "—"}</TableCell>
                        <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{(e.eliminado_at || "").slice(0, 10)} {(e.eliminado_at || "").slice(11, 16)}</TableCell>
                        <TableCell className="whitespace-nowrap text-xs">{e.usuario || "—"}</TableCell>
                        <TableCell className="max-w-[240px] truncate text-sm" title={e.motivo}>{e.motivo}</TableCell>
                        <TableCell className="text-right">
                          <Button variant="ghost" size="icon" onClick={() => setEliminadaDetalle(e)} title="Ver detalle de la factura eliminada">
                            <Eye className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Detalle de una factura eliminada (snapshot) */}
      <Dialog open={eliminadaDetalle !== null} onOpenChange={(o) => { if (!o) setEliminadaDetalle(null) }}>
        <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Factura eliminada · {eliminadaDetalle?.numero_factura || "—"}</DialogTitle>
            <DialogDescription>
              {eliminadaDetalle?.cliente_nombre || "Sin cliente"} · eliminada el {(eliminadaDetalle?.eliminado_at || "").slice(0, 10)} por {eliminadaDetalle?.usuario || "—"}
            </DialogDescription>
          </DialogHeader>
          {eliminadaDetalle && (
            <div className="space-y-3 text-sm">
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                <p className="text-xs text-amber-700 font-medium">Motivo</p>
                <p className="text-amber-900">{eliminadaDetalle.motivo}</p>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div><p className="text-[11px] text-stone-500">Total</p><p className="font-semibold">{formatCurrency(eliminadaDetalle.total_venta ?? 0)}</p></div>
                <div><p className="text-[11px] text-stone-500">Estado pago</p><p className="font-medium">{eliminadaDetalle.estado_pago || "—"}</p></div>
                <div><p className="text-[11px] text-stone-500">Fecha factura</p><p className="font-medium">{(eliminadaDetalle.fecha_venta || "").slice(0, 10) || "—"}</p></div>
                <div><p className="text-[11px] text-stone-500">Venta id</p><p className="font-mono text-xs">{eliminadaDetalle.venta_id ?? "—"}</p></div>
              </div>
              {/* Productos */}
              <div>
                <p className="text-xs font-medium text-stone-600 mb-1">Productos ({eliminadaDetalle.snapshot?.detalle?.length ?? 0})</p>
                {(eliminadaDetalle.snapshot?.detalle?.length ?? 0) === 0 ? (
                  <p className="text-xs text-stone-400">Sin líneas registradas.</p>
                ) : (
                  <div className="rounded-lg border border-stone-200 overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Producto</TableHead>
                          <TableHead className="text-right">Cantidad</TableHead>
                          <TableHead className="text-right">Precio</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(eliminadaDetalle.snapshot?.detalle ?? []).map((d, i) => (
                          <TableRow key={i}>
                            <TableCell className="text-sm">{String((d as Record<string, unknown>).producto_nombre ?? (d as Record<string, unknown>).producto_id ?? "—")}</TableCell>
                            <TableCell className="text-right tabular-nums">{String((d as Record<string, unknown>).cantidad ?? "")}</TableCell>
                            <TableCell className="text-right tabular-nums">{formatCurrency(Number((d as Record<string, unknown>).precio_unitario ?? 0))}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEliminadaDetalle(null)}>Cerrar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Detalle Dialog */}
      <Dialog open={showDetalleDialog} onOpenChange={setShowDetalleDialog}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-lg md:text-xl">Factura {selectedVenta?.numero_factura}</DialogTitle>
          </DialogHeader>
          {selectedVenta && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">Cliente:</span>
                  <p className="font-medium">{selectedVenta.cliente_nombre}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Fecha:</span>
                  <p className="font-medium">{selectedVenta.fecha_venta?.split('T')[0] || ''}</p>
                </div>
              </div>
              <div className="border rounded-md overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Producto</TableHead>
                      <TableHead className="text-right">Cant.</TableHead>
                      <TableHead className="text-right">Precio</TableHead>
                      <TableHead className="text-right">Subtotal</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {detalles.map(d => (
                      <TableRow key={d.id}>
                        <TableCell>{d.producto_nombre}</TableCell>
                        <TableCell className="text-right">{d.cantidad}</TableCell>
                        <TableCell className="text-right">L {(d.precio_unitario ?? 0).toFixed(2)}</TableCell>
                        <TableCell className="text-right">L {((d.cantidad ?? 0) * (d.precio_unitario ?? 0)).toFixed(2)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className="flex justify-end">
                <div className="w-48 space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Subtotal:</span>
                    <span>L {(selectedVenta.subtotal ?? 0).toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">ISV ({selectedVenta.porcentaje_impuesto || 15}%):</span>
                    <span>L {(selectedVenta.impuesto_total ?? 0).toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between font-bold border-t pt-1">
                    <span>Total:</span>
                    <span>L {(selectedVenta.total_venta ?? 0).toFixed(2)}</span>
                  </div>
                </div>
              </div>

              {/* Desglose de pago (auditoria de comision) */}
              <div className="border-t pt-4">
                <h4 className="font-medium mb-2">Desglose de pago</h4>
                {pagosDetalle.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Sin desglose de pago registrado</p>
                ) : (
                  <div className="border rounded-md overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="whitespace-nowrap">Método</TableHead>
                          <TableHead className="whitespace-nowrap">Banco / Cuenta</TableHead>
                          <TableHead className="text-right whitespace-nowrap">Bruto</TableHead>
                          <TableHead className="text-right whitespace-nowrap">% Com.</TableHead>
                          <TableHead className="text-right whitespace-nowrap">Comisión</TableHead>
                          <TableHead className="text-right whitespace-nowrap">Neto</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {pagosDetalle.map(p => {
                          const bruto = Number(p.monto_bruto || 0)
                          const pct = Number(p.porcentaje_comision || 0)
                          const comision = +(bruto * (pct / 100)).toFixed(2)
                          const neto = p.monto_neto != null ? Number(p.monto_neto) : +(bruto - comision).toFixed(2)
                          const metodoLabel = p.metodo_pago === "Link_Pago" ? "Link de Pago" : p.metodo_pago
                          const bancoNombre = p.cuenta_id != null ? (cuentas.find(c => c.id === p.cuenta_id)?.nombre ?? "—") : "—"
                          return (
                            <TableRow key={p.id}>
                              <TableCell className="whitespace-nowrap">{metodoLabel}</TableCell>
                              <TableCell className="whitespace-nowrap text-muted-foreground">{bancoNombre}</TableCell>
                              <TableCell className="text-right whitespace-nowrap">L {bruto.toFixed(2)}</TableCell>
                              <TableCell className="text-right whitespace-nowrap">{pct.toFixed(2)}%</TableCell>
                              <TableCell className={`text-right whitespace-nowrap ${comision > 0 ? "text-amber-700" : "text-muted-foreground"}`}>L {comision.toFixed(2)}</TableCell>
                              <TableCell className="text-right whitespace-nowrap">L {neto.toFixed(2)}</TableCell>
                            </TableRow>
                          )
                        })}
                      </TableBody>
                    </Table>
                    <div className="flex justify-between text-sm font-medium border-t px-3 py-2 bg-muted/40">
                      <span>Total comisión de la factura</span>
                      <span className="text-amber-700">
                        L {pagosDetalle.reduce((a, p) => a + Number(p.monto_bruto || 0) * (Number(p.porcentaje_comision || 0) / 100), 0).toFixed(2)}
                      </span>
                    </div>
                  </div>
                )}
              </div>

              <div className="border-t pt-4">
                <h4 className="font-medium mb-2">Pagos Registrados</h4>
                {pagos.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No hay pagos registrados</p>
                ) : (
                  <div className="space-y-2">
                    {pagos.map(p => (
                      <div key={p.id} className="flex items-center justify-between text-sm bg-muted/50 p-2 rounded">
                        <div>
                          <span className="font-medium">{p.metodo_pago}</span>
                          <span className="text-muted-foreground ml-2">{p.fecha_pago?.split('T')[0] || ''}</span>
                        </div>
                        <span className="font-medium text-green-600">L {(p.monto ?? 0).toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex items-center justify-between mt-4 p-3 bg-muted rounded-lg">
                  <div>
                    <p className="text-sm text-muted-foreground">Saldo Pendiente</p>
                    <p className="text-lg font-bold text-primary">L {saldoPendiente.toFixed(2)}</p>
                  </div>
                  {saldoPendiente > 0 && (
                    <Button onClick={() => openPagoDialog(selectedVenta)}>
                      <CreditCard className="h-4 w-4 mr-2" />
                      Registrar Pago
                    </Button>
                  )}
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Pago Dialog */}
      <Dialog open={showPagoDialog} onOpenChange={setShowPagoDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Registrar Pago</DialogTitle>
            {selectedVenta && (
              <p className="text-sm text-muted-foreground">
                Factura <span className="font-mono">{selectedVenta.numero_factura}</span>
                {selectedVenta.cliente_nombre ? ` · ${selectedVenta.cliente_nombre}` : ""}
              </p>
            )}
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Monto</Label>
              <Input
                type="number" step="0.01" min="0" max={saldoPendiente}
                value={pagoMonto} onChange={e => setPagoMonto(e.target.value)} placeholder="0.00"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Saldo pendiente: L {saldoPendiente.toFixed(2)} — puede ser un abono parcial o el total.
              </p>
            </div>
            <div>
              <Label>Metodo de Pago</Label>
              <Select value={pagoMetodo} onValueChange={setPagoMetodo}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Efectivo" disabled={!cajaSesion}>
                    Efectivo{!cajaSesion ? " (caja cerrada)" : ""}
                  </SelectItem>
                  <SelectItem value="Banco">Banco / Tarjeta / Transferencia</SelectItem>
                  <SelectItem value="Otro">Otro (sin movimiento de dinero)</SelectItem>
                </SelectContent>
              </Select>
              {pagoMetodo === "Efectivo" && (
                <p className="text-xs text-muted-foreground mt-1">El efectivo entra a la caja chica abierta.</p>
              )}
              {pagoMetodo === "Otro" && (
                <p className="text-xs text-amber-600 mt-1">
                  Solo baja el saldo de la factura; no registra entrada en caja ni bancos.
                </p>
              )}
            </div>
            {pagoMetodo === "Banco" && (
              <div>
                <Label>Cuenta bancaria</Label>
                <Select value={pagoCuentaId} onValueChange={setPagoCuentaId}>
                  <SelectTrigger><SelectValue placeholder="Seleccionar cuenta" /></SelectTrigger>
                  <SelectContent>
                    {cuentas.map((c) => (
                      <SelectItem key={c.id} value={String(c.id)}>{c.nombre}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-1">El abono entra como Ingreso a esta cuenta.</p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPagoDialog(false)}>Cancelar</Button>
            <Button onClick={handleRegistrarPago} disabled={savingPago}>
              {savingPago ? "Guardando..." : "Registrar Pago"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirmacion de eliminacion de venta */}
      {/* Anular venta (conserva el documento; registra contra-asientos) */}
      <Dialog
        open={ventaAAnular !== null}
        onOpenChange={(open) => { if (!open && !anulando) setVentaAAnular(null) }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-red-600 flex items-center gap-2">
              <Ban className="h-5 w-5" />
              {ventaAAnular ? `Anular venta ${ventaAAnular.numero_factura}` : "Anular venta"}
            </DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-2">
                <p>
                  La factura conserva su número y su detalle, pero deja de contar en reportes y cartera.
                  Los productos vuelven al inventario y, si hubo dinero cobrado, se registra su salida.
                </p>
                {ventaAAnular?.numero_fiscal && (
                  <p className="rounded-md bg-amber-50 border border-amber-200 p-2 text-amber-800 text-sm">
                    Factura fiscal <span className="font-mono">{ventaAAnular.numero_fiscal}</span>: si el cliente ya se llevó el
                    comprobante, lo correcto ante el SAR es una <strong>nota de crédito</strong> (Devoluciones) y no una anulación.
                  </p>
                )}
              </div>
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="motivo-anular" className="text-xs">Motivo de la anulación <span className="text-red-600">*</span></Label>
              <Input
                id="motivo-anular"
                value={motivoAnular}
                onChange={(e) => setMotivoAnular(e.target.value)}
                placeholder="Ej: factura duplicada, error de digitación…"
                disabled={anulando}
                autoFocus
              />
            </div>
            {Number(ventaAAnular?.valorpago || 0) > 0.005 && (
              <div className="grid gap-1.5 rounded-lg border border-stone-200 p-3">
                <p className="text-xs text-stone-600">
                  Esta factura tiene <strong>{formatCurrency(Number(ventaAAnular?.valorpago || 0))}</strong> cobrados. ¿De dónde sale el reembolso?
                </p>
                <Select value={reembolsoDestino} onValueChange={(v) => setReembolsoDestino(v as "caja" | "cuenta")}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="caja">Caja chica (efectivo)</SelectItem>
                    <SelectItem value="cuenta">Cuenta bancaria</SelectItem>
                  </SelectContent>
                </Select>
                {reembolsoDestino === "cuenta" && (
                  <Select value={reembolsoCuentaId || "__none__"} onValueChange={(v) => setReembolsoCuentaId(v === "__none__" ? "" : v)}>
                    <SelectTrigger><SelectValue placeholder="Elige la cuenta" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Elige la cuenta</SelectItem>
                      {cuentas.map((c) => (
                        <SelectItem key={c.id} value={String(c.id)}>{c.nombre}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                {reembolsoDestino === "caja" && !cajaSesion && (
                  <p className="text-[11px] text-amber-700">No hay caja abierta: abre la caja chica o elige una cuenta bancaria.</p>
                )}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setVentaAAnular(null)} disabled={anulando}>Cancelar</Button>
            <Button
              onClick={handleAnularVenta}
              disabled={anulando || !motivoAnular.trim()}
              className="bg-red-600 hover:bg-red-700"
            >
              {anulando ? <><Loader2 className="h-4 w-4 animate-spin" /> Anulando…</> : <><Ban className="h-4 w-4" /> Anular venta</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={ventaAEliminar !== null}
        onOpenChange={(open) => {
          // Evitamos cerrar el modal mientras la RPC esta corriendo.
          if (!open && !deletingVenta) setVentaAEliminar(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-red-600">
              {ventaAEliminar
                ? `Eliminar venta ${ventaAEliminar.numero_factura}`
                : "Eliminar venta"}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>
                  ¿Estás seguro de eliminar esta venta? Esta acción devolverá los
                  productos al inventario y eliminará los registros de caja y
                  bancos. Es irreversible.
                </p>
                {devsDeVentaAEliminar > 0 && (
                  <p className="rounded-md bg-amber-50 border border-amber-200 p-2 text-amber-800 text-sm">
                    ⚠ Esta factura tiene <strong>{devsDeVentaAEliminar}</strong> devolución(es) asociada(s):
                    también se anularán (se revierte su stock y su reembolso) al eliminar la venta.
                  </p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>

          {/* Motivo obligatorio: se guarda en el registro de facturas eliminadas. */}
          <div className="grid gap-1.5">
            <Label htmlFor="motivo-eliminar" className="text-xs">Motivo de la eliminación <span className="text-red-600">*</span></Label>
            <Input
              id="motivo-eliminar"
              value={motivoEliminar}
              onChange={(e) => setMotivoEliminar(e.target.value)}
              placeholder="Ej: factura duplicada, error de digitación…"
              disabled={deletingVenta}
              autoFocus
            />
            <p className="text-[11px] text-stone-500">La factura eliminada queda registrada (con su detalle) en la pestaña &quot;Eliminadas&quot; para trazabilidad.</p>
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingVenta}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                // Prevenimos el cierre automatico para mantener el loading
                // visible hasta que la RPC responda; el cierre lo maneja
                // handleEliminarVenta al limpiar `ventaAEliminar`.
                e.preventDefault()
                handleEliminarVenta()
              }}
              disabled={deletingVenta || !motivoEliminar.trim()}
              className="bg-red-600 hover:bg-red-700 focus-visible:ring-red-600"
            >
              {deletingVenta ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Eliminando...
                </>
              ) : (
                <>
                  <Trash2 className="h-4 w-4" />
                  Eliminar venta
                </>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
