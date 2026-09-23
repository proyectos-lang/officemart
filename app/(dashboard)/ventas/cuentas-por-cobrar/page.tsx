"use client"

import * as React from "react"
import { 
  DollarSign, 
  FileText, 
  Clock, 
  CreditCard,
  Search,
  Eye,
  Plus
} from "lucide-react"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
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
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { useToast } from "@/hooks/use-toast"

import {
  getCuentasPorCobrar,
  getAllPagos,
  getDetallesVenta,
  registrarPago,
  type CuentaPorCobrar,
  type PagoVenta,
  type VentaDetalle
} from "@/lib/services/ventas"
import {
  registrarReciboCobro, anularReciboCobro, getRecibos, distribuirCobro,
  RECIBOS_FEATURE_PENDING, type ReciboCobro,
} from "@/lib/services/recibos"
import { getCuentas, type CuentaConfig } from "@/lib/services/cuentas"
import { formatCurrency } from "@/lib/utils/format"
import { Receipt, Ban, ClipboardList } from "lucide-react"
import Link from "next/link"
import { useAuth } from "@/lib/contexts/auth-context"

// ===== Antigüedad de saldos (aging) — helpers puros a nivel de módulo =====
/** Días transcurridos desde la fecha de la venta hasta hoy. */
function diasDeAntiguedad(fechaVenta: string): number {
  const fecha = new Date(fechaVenta)
  return Math.max(0, Math.floor((Date.now() - fecha.getTime()) / (1000 * 60 * 60 * 24)))
}

type RangoAging = "todos" | "0-30" | "31-60" | "61-90" | "90+"

function rangoDeDias(dias: number): Exclude<RangoAging, "todos"> {
  if (dias <= 30) return "0-30"
  if (dias <= 60) return "31-60"
  if (dias <= 90) return "61-90"
  return "90+"
}

export default function CuentasPorCobrarPage() {
  const [cuentas, setCuentas] = React.useState<CuentaPorCobrar[]>([])
  const [pagos, setPagos] = React.useState<(PagoVenta & { numero_factura?: string; cliente_nombre?: string })[]>([])
  const [loading, setLoading] = React.useState(true)
  const [searchTerm, setSearchTerm] = React.useState("")
  
  // Payment dialog state
  const [selectedCuenta, setSelectedCuenta] = React.useState<CuentaPorCobrar | null>(null)
  const [showPagoDialog, setShowPagoDialog] = React.useState(false)
  const [pagoMonto, setPagoMonto] = React.useState("")
  const [pagoMetodo, setPagoMetodo] = React.useState("Efectivo")
  const [savingPago, setSavingPago] = React.useState(false)
  
  // Detail dialog state
  const [showDetalleDialog, setShowDetalleDialog] = React.useState(false)
  const [detalles, setDetalles] = React.useState<VentaDetalle[]>([])
  const [loadingDetalles, setLoadingDetalles] = React.useState(false)

  // Abono por Banco: cuenta destino (script officemart-003: todo abono es un recibo).
  const [pagoCuentaId, setPagoCuentaId] = React.useState("")
  const [cuentasBanco, setCuentasBanco] = React.useState<CuentaConfig[]>([])

  // Recibo de cobro multi-factura
  const [recibos, setRecibos] = React.useState<ReciboCobro[]>([])
  const [recibosPendiente, setRecibosPendiente] = React.useState(false)
  const [showReciboDialog, setShowReciboDialog] = React.useState(false)
  const [reciboClienteId, setReciboClienteId] = React.useState<number | null>(null)
  const [reciboMonto, setReciboMonto] = React.useState("")
  const [reciboMetodo, setReciboMetodo] = React.useState<"Efectivo" | "Banco" | "Otro">("Efectivo")
  const [reciboCuentaId, setReciboCuentaId] = React.useState("")
  const [reciboReferencia, setReciboReferencia] = React.useState("")
  // venta_id -> monto aplicado (texto para edición)
  const [reciboAplicaciones, setReciboAplicaciones] = React.useState<Record<number, string>>({})
  const [savingRecibo, setSavingRecibo] = React.useState(false)
  const [reciboAAnular, setReciboAAnular] = React.useState<ReciboCobro | null>(null)
  const [motivoAnularRecibo, setMotivoAnularRecibo] = React.useState("")
  const [anulandoRecibo, setAnulandoRecibo] = React.useState(false)

  const { toast } = useToast()
  const { hasModulo } = useAuth()

  async function loadData() {
    setLoading(true)
    const [cuentasRes, pagosRes, recibosRes, cuentasBancoRes] = await Promise.all([
      getCuentasPorCobrar(),
      getAllPagos(),
      getRecibos(),
      getCuentas(),
    ])

    if (!cuentasRes.error) setCuentas(cuentasRes.data)
    if (!pagosRes.error) setPagos(pagosRes.data)
    setRecibos(recibosRes.data)
    setRecibosPendiente(recibosRes.error === RECIBOS_FEATURE_PENDING)
    setCuentasBanco((cuentasBancoRes.data || []).filter((c) => c.activo ?? true))
    setLoading(false)
  }

  // ---- Recibo de cobro (varias facturas del mismo cliente) ----
  const clientesConSaldo = React.useMemo(() => {
    const m = new Map<number, { id: number; nombre: string; saldo: number; facturas: number }>()
    for (const c of cuentas) {
      const cur = m.get(c.cliente_id) || { id: c.cliente_id, nombre: c.cliente_nombre, saldo: 0, facturas: 0 }
      cur.saldo += c.saldo_pendiente
      cur.facturas += 1
      m.set(c.cliente_id, cur)
    }
    return [...m.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, "es"))
  }, [cuentas])

  const facturasReciboCliente = React.useMemo(
    () => cuentas.filter((c) => c.cliente_id === reciboClienteId).sort((a, b) => a.fecha_venta.localeCompare(b.fecha_venta)),
    [cuentas, reciboClienteId]
  )

  const totalAplicado = React.useMemo(
    () => +Object.values(reciboAplicaciones).reduce((a, v) => a + (Number(v) || 0), 0).toFixed(2),
    [reciboAplicaciones]
  )

  function openReciboDialog(clienteId?: number) {
    setReciboClienteId(clienteId ?? null)
    setReciboMonto("")
    setReciboMetodo("Efectivo")
    setReciboCuentaId("")
    setReciboReferencia("")
    setReciboAplicaciones({})
    setShowReciboDialog(true)
  }

  /** Reparte el monto escrito entre las facturas del cliente (antiguas primero). */
  function distribuirAutomatico() {
    const monto = Number(reciboMonto) || 0
    const dist = distribuirCobro(
      facturasReciboCliente.map((f) => ({ venta_id: f.id, saldo: f.saldo_pendiente, fecha: f.fecha_venta })),
      monto
    )
    const next: Record<number, string> = {}
    for (const d of dist) next[d.venta_id] = d.monto.toFixed(2)
    setReciboAplicaciones(next)
  }

  async function handleRegistrarRecibo() {
    if (!reciboClienteId) {
      toast({ title: "Elige el cliente", variant: "destructive" })
      return
    }
    const aplicaciones = Object.entries(reciboAplicaciones)
      .map(([id, m]) => ({ venta_id: Number(id), monto: Number(m) || 0 }))
      .filter((a) => a.monto > 0)
    if (aplicaciones.length === 0) {
      toast({ title: "Sin montos", description: "Indica cuánto se aplica a cada factura (o usa 'Distribuir').", variant: "destructive" })
      return
    }
    if (reciboMetodo === "Banco" && !reciboCuentaId) {
      toast({ title: "Falta la cuenta", description: "Elige la cuenta bancaria del cobro.", variant: "destructive" })
      return
    }
    setSavingRecibo(true)
    const { data, error } = await registrarReciboCobro({
      cliente_id: reciboClienteId,
      metodo_pago: reciboMetodo,
      cuenta_id: reciboMetodo === "Banco" ? Number(reciboCuentaId) : null,
      referencia: reciboReferencia || null,
      aplicaciones,
    })
    setSavingRecibo(false)
    if (error || !data) {
      toast({ title: "No se registró el recibo", description: error || "", variant: "destructive" })
      return
    }
    toast({ title: `Recibo ${data.numero_recibo} registrado`, description: `${formatCurrency(totalAplicado)} aplicados a ${aplicaciones.length} factura(s).` })
    setShowReciboDialog(false)
    loadData()
  }

  async function handleAnularRecibo() {
    if (!reciboAAnular) return
    if (!motivoAnularRecibo.trim()) {
      toast({ title: "Falta el motivo", variant: "destructive" })
      return
    }
    setAnulandoRecibo(true)
    const { error } = await anularReciboCobro(reciboAAnular.id, motivoAnularRecibo.trim())
    setAnulandoRecibo(false)
    if (error) {
      toast({ title: "No se pudo anular", description: error, variant: "destructive" })
      return
    }
    toast({ title: "Recibo anulado", description: "El dinero salió de tesorería y las facturas recuperaron su saldo." })
    setReciboAAnular(null)
    setMotivoAnularRecibo("")
    loadData()
  }

  React.useEffect(() => {
    loadData()
  }, [])

  // KPI calculations
  const totalPorCobrar = cuentas.reduce((acc, c) => acc + c.saldo_pendiente, 0)
  const ventasPendientes = cuentas.length
  const totalAbonado = cuentas.reduce((acc, c) => acc + c.total_abonado, 0)
  const totalFacturado = cuentas.reduce((acc, c) => acc + c.total_venta, 0)

  const [filtroAging, setFiltroAging] = React.useState<RangoAging>("todos")

  // Totales de saldo pendiente por rango de antigüedad.
  const aging = React.useMemo(() => {
    const buckets: Record<Exclude<RangoAging, "todos">, { saldo: number; facturas: number }> = {
      "0-30": { saldo: 0, facturas: 0 },
      "31-60": { saldo: 0, facturas: 0 },
      "61-90": { saldo: 0, facturas: 0 },
      "90+": { saldo: 0, facturas: 0 },
    }
    for (const c of cuentas) {
      const b = buckets[rangoDeDias(diasDeAntiguedad(c.fecha_venta))]
      b.saldo += c.saldo_pendiente
      b.facturas += 1
    }
    return buckets
  }, [cuentas])

  // Filtered cuentas
  const filteredCuentas = cuentas.filter(c => {
    const matchTexto =
      c.numero_factura.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.cliente_nombre.toLowerCase().includes(searchTerm.toLowerCase())
    const matchAging =
      filtroAging === "todos" || rangoDeDias(diasDeAntiguedad(c.fecha_venta)) === filtroAging
    return matchTexto && matchAging
  })

  function openPagoDialog(cuenta: CuentaPorCobrar) {
    setSelectedCuenta(cuenta)
    setPagoMonto(cuenta.saldo_pendiente.toFixed(2))
    setPagoMetodo("Efectivo")
    setShowPagoDialog(true)
  }

  async function openDetalleDialog(cuenta: CuentaPorCobrar) {
    setSelectedCuenta(cuenta)
    setLoadingDetalles(true)
    setShowDetalleDialog(true)
    
    const { data } = await getDetallesVenta(cuenta.id)
    setDetalles(data)
    setLoadingDetalles(false)
  }

  async function handleRegistrarPago() {
    if (!selectedCuenta || !pagoMonto) return
    
    const monto = parseFloat(pagoMonto)
    if (isNaN(monto) || monto <= 0) {
      toast({ title: "Error", description: "Ingrese un monto valido", variant: "destructive" })
      return
    }
    
    if (monto > selectedCuenta.saldo_pendiente) {
      toast({ title: "Error", description: "El monto no puede ser mayor al saldo pendiente", variant: "destructive" })
      return
    }
    
    if (pagoMetodo === "Banco" && !pagoCuentaId) {
      toast({ title: "Falta la cuenta", description: "Elige la cuenta bancaria donde entró el dinero", variant: "destructive" })
      return
    }

    setSavingPago(true)
    const { error } = await registrarPago(
      {
        venta_id: selectedCuenta.id,
        monto: monto,
        metodo_pago: pagoMetodo,
      },
      { cuenta_id: pagoMetodo === "Banco" ? Number(pagoCuentaId) : null }
    )
    setSavingPago(false)
    
    if (error) {
      toast({ title: "Error", description: error, variant: "destructive" })
    } else {
      toast({ title: "Pago registrado", description: `Se registro un abono de L ${monto.toFixed(2)}` })
      setShowPagoDialog(false)
      loadData()
    }
  }

  function getEstadoBadge(estado: string) {
    switch (estado) {
      case 'Pendiente':
        return <Badge variant="outline" className="bg-orange-50 text-orange-700 border-orange-200">Pendiente</Badge>
      case 'Parcial':
        return <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">Parcial</Badge>
      default:
        return <Badge variant="outline">{estado}</Badge>
    }
  }

  if (loading) {
    return (
      <div className="p-6 space-y-6">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
        <Skeleton className="h-96" />
      </div>
    )
  }

  return (
    <div className="space-y-4 md:space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl md:text-2xl font-bold text-foreground">Cuentas por Cobrar</h1>
        <p className="text-sm md:text-base text-muted-foreground">Gestion de cartera y registro de pagos</p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
        <Card className="border-l-4 border-l-red-500">
          <CardHeader className="p-3 md:p-6 pb-1 md:pb-2">
            <CardDescription className="flex items-center gap-1.5 md:gap-2 text-xs md:text-sm">
              <DollarSign className="h-3.5 w-3.5 md:h-4 md:w-4" />
              <span className="hidden sm:inline">Total</span> Por Cobrar
            </CardDescription>
          </CardHeader>
          <CardContent className="p-3 md:p-6 pt-0">
            <p className="text-lg md:text-2xl font-bold text-red-600">L {totalPorCobrar.toFixed(2)}</p>
            <p className="text-[10px] md:text-xs text-muted-foreground mt-1 hidden sm:block">Saldo pendiente total</p>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-orange-500">
          <CardHeader className="p-3 md:p-6 pb-1 md:pb-2">
            <CardDescription className="flex items-center gap-1.5 md:gap-2 text-xs md:text-sm">
              <FileText className="h-3.5 w-3.5 md:h-4 md:w-4" />
              <span className="hidden sm:inline">Facturas</span> Pendientes
            </CardDescription>
          </CardHeader>
          <CardContent className="p-3 md:p-6 pt-0">
            <p className="text-lg md:text-2xl font-bold text-orange-600">{ventasPendientes}</p>
            <p className="text-[10px] md:text-xs text-muted-foreground mt-1 hidden sm:block">Con saldo por cobrar</p>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-green-500">
          <CardHeader className="p-3 md:p-6 pb-1 md:pb-2">
            <CardDescription className="flex items-center gap-1.5 md:gap-2 text-xs md:text-sm">
              <CreditCard className="h-3.5 w-3.5 md:h-4 md:w-4" />
              <span className="hidden sm:inline">Total</span> Abonado
            </CardDescription>
          </CardHeader>
          <CardContent className="p-3 md:p-6 pt-0">
            <p className="text-lg md:text-2xl font-bold text-green-600">L {totalAbonado.toFixed(2)}</p>
            <p className="text-[10px] md:text-xs text-muted-foreground mt-1 hidden sm:block">Pagos parciales recibidos</p>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-blue-500">
          <CardHeader className="p-3 md:p-6 pb-1 md:pb-2">
            <CardDescription className="flex items-center gap-1.5 md:gap-2 text-xs md:text-sm">
              <Clock className="h-3.5 w-3.5 md:h-4 md:w-4" />
              <span className="hidden sm:inline">Total</span> Facturado
            </CardDescription>
          </CardHeader>
          <CardContent className="p-3 md:p-6 pt-0">
            <p className="text-lg md:text-2xl font-bold text-blue-600">L {totalFacturado.toFixed(2)}</p>
            <p className="text-[10px] md:text-xs text-muted-foreground mt-1 hidden sm:block">Valor original facturas</p>
          </CardContent>
        </Card>
      </div>

      {/* Antigüedad de saldos */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-stone-600 flex items-center gap-2">
            <Clock className="h-4 w-4" /> Antigüedad de saldos
          </CardTitle>
          <CardDescription className="text-xs">
            Saldo pendiente por días desde la factura. Toca un rango para filtrar la cartera.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {([
              { rango: "0-30" as const, label: "0–30 días", color: "text-emerald-700 border-emerald-300 bg-emerald-50/60" },
              { rango: "31-60" as const, label: "31–60 días", color: "text-amber-700 border-amber-300 bg-amber-50/60" },
              { rango: "61-90" as const, label: "61–90 días", color: "text-orange-700 border-orange-300 bg-orange-50/60" },
              { rango: "90+" as const, label: "Más de 90 días", color: "text-red-700 border-red-300 bg-red-50/60" },
            ]).map(({ rango, label, color }) => (
              <button
                key={rango}
                onClick={() => setFiltroAging(filtroAging === rango ? "todos" : rango)}
                className={`rounded-xl border p-3 text-left transition-all ${color} ${
                  filtroAging === rango ? "ring-2 ring-offset-1 ring-stone-400" : "hover:opacity-80"
                }`}
              >
                <p className="text-xs font-medium">{label}</p>
                <p className="text-lg font-bold">L {aging[rango].saldo.toFixed(2)}</p>
                <p className="text-[10px] opacity-70">{aging[rango].facturas} factura(s)</p>
              </button>
            ))}
          </div>
          {filtroAging !== "todos" && (
            <p className="text-xs text-muted-foreground mt-2">
              Filtrando cartera: {filtroAging} días.{" "}
              <button className="underline" onClick={() => setFiltroAging("todos")}>Quitar filtro</button>
            </p>
          )}
        </CardContent>
      </Card>

      {/* Tabs */}
      <Tabs defaultValue="cartera" className="space-y-4">
        <TabsList className="w-full sm:w-auto">
          <TabsTrigger value="cartera" className="flex-1 sm:flex-none text-xs sm:text-sm">Cartera</TabsTrigger>
          <TabsTrigger value="historial" className="flex-1 sm:flex-none text-xs sm:text-sm">Historial Pagos</TabsTrigger>
          <TabsTrigger value="recibos" className="flex-1 sm:flex-none text-xs sm:text-sm">Recibos</TabsTrigger>
        </TabsList>

        <TabsContent value="cartera" className="space-y-4">
          {/* Search + recibo multi-factura */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="relative flex-1 md:max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar factura o cliente..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10 text-sm"
              />
            </div>
            <Button size="sm" onClick={() => openReciboDialog()} disabled={recibosPendiente || cuentas.length === 0} title={recibosPendiente ? RECIBOS_FEATURE_PENDING : "Un pago aplicado a varias facturas del cliente"}>
              <Receipt className="h-4 w-4 mr-1" /> Recibo de cobro
            </Button>
            {hasModulo("Estado de Cuenta") && (
              <Button size="sm" variant="outline" asChild title="Estado de cuenta del cliente">
                <Link href="/ventas/estado-cuenta"><ClipboardList className="h-4 w-4 mr-1" /> Estado de cuenta</Link>
              </Button>
            )}
          </div>

          {/* Mobile Card View */}
          <div className="block md:hidden space-y-3">
            {filteredCuentas.length === 0 ? (
              <Card className="p-8 text-center text-muted-foreground">
                No hay cuentas por cobrar pendientes
              </Card>
            ) : (
              filteredCuentas.map((cuenta) => (
                <Card key={cuenta.id} className="p-4">
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <p className="font-mono font-medium text-primary">{cuenta.numero_factura}</p>
                      <p className="text-xs text-muted-foreground">{cuenta.fecha_venta?.split('T')[0] || ''}</p>
                    </div>
                    <Badge variant={cuenta.estado_pago === 'Parcial' ? 'secondary' : 'destructive'} className="text-xs">
                      {cuenta.estado_pago}
                    </Badge>
                  </div>
                  <p className="text-sm truncate mb-3">{cuenta.cliente_nombre}</p>
                  <div className="space-y-2 mb-3">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Total:</span>
                      <span>L {cuenta.total_venta.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Abonado:</span>
                      <span className="text-green-600">L {cuenta.total_abonado.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-sm font-medium">
                      <span className="text-muted-foreground">Saldo:</span>
                      <span className="text-red-600">L {cuenta.saldo_pendiente.toFixed(2)}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Progress value={cuenta.porcentaje_pagado} className="flex-1 h-2" />
                      <span className="text-xs text-muted-foreground w-10">{cuenta.porcentaje_pagado.toFixed(0)}%</span>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" className="flex-1" onClick={() => openPagoDialog(cuenta)}>
                      <Plus className="h-4 w-4 mr-1" /> Pago
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => openDetalleDialog(cuenta)}>
                      <Eye className="h-4 w-4" />
                    </Button>
                  </div>
                </Card>
              ))
            )}
          </div>

          {/* Desktop Table */}
          <Card className="hidden md:block">
            <CardContent className="p-0">
              <Table containerClassName="max-h-[60vh] overflow-y-auto">
                <TableHeader sticky>
                  <TableRow>
                    <TableHead>Factura</TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Fecha</TableHead>
                    <TableHead className="text-center">Días</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right">Abonado</TableHead>
                    <TableHead className="text-right">Saldo</TableHead>
                    <TableHead>Progreso</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead className="w-32">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredCuentas.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={10} className="text-center py-8 text-muted-foreground">
                        No hay cuentas por cobrar pendientes
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredCuentas.map((cuenta) => {
                      const dias = diasDeAntiguedad(cuenta.fecha_venta)
                      const diasColor =
                        dias <= 30 ? "text-emerald-600" : dias <= 60 ? "text-amber-600" : dias <= 90 ? "text-orange-600" : "text-red-600"
                      return (
                      <TableRow key={cuenta.id}>
                        <TableCell className="font-mono font-medium">{cuenta.numero_factura}</TableCell>
                        <TableCell>{cuenta.cliente_nombre}</TableCell>
                        <TableCell>{cuenta.fecha_venta?.split('T')[0] || ''}</TableCell>
                        <TableCell className={`text-center font-medium ${diasColor}`}>{dias}</TableCell>
                        <TableCell className="text-right">L {cuenta.total_venta.toFixed(2)}</TableCell>
                        <TableCell className="text-right text-green-600">L {cuenta.total_abonado.toFixed(2)}</TableCell>
                        <TableCell className="text-right font-medium text-red-600">L {cuenta.saldo_pendiente.toFixed(2)}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Progress value={cuenta.porcentaje_pagado} className="w-20 h-2" />
                            <span className="text-xs text-muted-foreground w-10">
                              {cuenta.porcentaje_pagado.toFixed(0)}%
                            </span>
                          </div>
                        </TableCell>
                        <TableCell>{getEstadoBadge(cuenta.estado_pago)}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => openDetalleDialog(cuenta)}
                              title="Ver detalle"
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => openPagoDialog(cuenta)}
                              title="Registrar pago"
                              className="text-green-600 hover:text-green-700 hover:bg-green-50"
                            >
                              <Plus className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                      )
                    })
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="historial" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Historial de Pagos Recibidos</CardTitle>
              <CardDescription>Registro cronologico de todos los abonos</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <Table containerClassName="max-h-[60vh] overflow-y-auto">
                <TableHeader sticky>
                  <TableRow>
                    <TableHead>Fecha</TableHead>
                    <TableHead>Factura</TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Metodo</TableHead>
                    <TableHead className="text-right">Monto</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pagos.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                        No hay pagos registrados
                      </TableCell>
                    </TableRow>
                  ) : (
                    pagos.map((pago) => (
                      <TableRow key={pago.id}>
                        <TableCell>{pago.fecha_pago?.split('T')[0] || ''}</TableCell>
                        <TableCell className="font-mono">{pago.numero_factura}</TableCell>
                        <TableCell>{pago.cliente_nombre}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{pago.metodo_pago}</Badge>
                        </TableCell>
                        <TableCell className="text-right font-medium text-green-600">
                          L {(pago.monto ?? 0).toFixed(2)}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Recibos de cobro (script officemart-003) */}
        <TabsContent value="recibos" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Recibos de cobro</CardTitle>
              <CardDescription>Cada recibo es un solo movimiento de caja/banco aplicado a una o varias facturas.</CardDescription>
            </CardHeader>
            <CardContent>
              {recibosPendiente ? (
                <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3">{RECIBOS_FEATURE_PENDING}</p>
              ) : recibos.length === 0 ? (
                <p className="text-sm text-muted-foreground py-6 text-center">Aún no hay recibos registrados</p>
              ) : (
                <Table containerClassName="max-h-[60vh] overflow-y-auto">
                  <TableHeader sticky>
                    <TableRow>
                      <TableHead>Recibo</TableHead>
                      <TableHead>Fecha</TableHead>
                      <TableHead>Cliente</TableHead>
                      <TableHead>Facturas</TableHead>
                      <TableHead>Método</TableHead>
                      <TableHead className="text-right">Monto</TableHead>
                      <TableHead>Estado</TableHead>
                      <TableHead className="w-12"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {recibos.map((r) => (
                      <TableRow key={r.id} className={r.anulado_at ? "opacity-60" : undefined}>
                        <TableCell className="font-mono text-sm">{r.numero_recibo}</TableCell>
                        <TableCell className="text-sm whitespace-nowrap">{r.fecha?.split("T")[0]}</TableCell>
                        <TableCell className="text-sm">{r.cliente_nombre}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {(r.aplicaciones || []).map((a) => `${a.numero_factura || a.venta_id} (${formatCurrency(a.monto)})`).join(", ") || "—"}
                        </TableCell>
                        <TableCell className="text-sm">{r.metodo_pago}{r.referencia ? ` · ${r.referencia}` : ""}</TableCell>
                        <TableCell className="text-right font-medium">{formatCurrency(r.monto_total)}</TableCell>
                        <TableCell>
                          {r.anulado_at
                            ? <Badge variant="outline" className="border-red-200 bg-red-50 text-red-700" title={r.motivo_anulacion || ""}>Anulado</Badge>
                            : <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">Vigente</Badge>}
                        </TableCell>
                        <TableCell>
                          {!r.anulado_at && (
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-red-600 hover:bg-red-50" title="Anular recibo" onClick={() => { setReciboAAnular(r); setMotivoAnularRecibo("") }}>
                              <Ban className="h-4 w-4" />
                            </Button>
                          )}
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

      {/* Recibo de cobro: un pago para varias facturas */}
      <Dialog open={showReciboDialog} onOpenChange={setShowReciboDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Recibo de cobro</DialogTitle>
            <DialogDescription>Aplica un solo pago a una o varias facturas con saldo del cliente.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Cliente</Label>
                <Select value={reciboClienteId ? String(reciboClienteId) : "__none__"} onValueChange={(v) => { setReciboClienteId(v === "__none__" ? null : Number(v)); setReciboAplicaciones({}) }}>
                  <SelectTrigger><SelectValue placeholder="Elige el cliente" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Elige el cliente</SelectItem>
                    {clientesConSaldo.map((c) => (
                      <SelectItem key={c.id} value={String(c.id)}>{c.nombre} · debe {formatCurrency(c.saldo)} ({c.facturas})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Método</Label>
                <Select value={reciboMetodo} onValueChange={(v) => { setReciboMetodo(v as "Efectivo" | "Banco" | "Otro"); if (v !== "Banco") setReciboCuentaId("") }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Efectivo">Efectivo (caja chica)</SelectItem>
                    <SelectItem value="Banco">Banco / transferencia / tarjeta</SelectItem>
                    <SelectItem value="Otro">Otro (sin asiento de tesorería)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {reciboMetodo === "Banco" && (
                <>
                  <div className="space-y-1.5">
                    <Label>Cuenta destino</Label>
                    <Select value={reciboCuentaId || "__none__"} onValueChange={(v) => setReciboCuentaId(v === "__none__" ? "" : v)}>
                      <SelectTrigger><SelectValue placeholder="Elige la cuenta" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">Elige la cuenta</SelectItem>
                        {cuentasBanco.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.nombre}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Referencia (nº transferencia / cheque)</Label>
                    <Input value={reciboReferencia} onChange={(e) => setReciboReferencia(e.target.value)} placeholder="Opcional" />
                  </div>
                </>
              )}
            </div>

            {reciboClienteId && (
              <>
                <div className="flex items-end gap-2">
                  <div className="space-y-1.5 flex-1">
                    <Label>Monto recibido (L)</Label>
                    <Input type="number" step="0.01" min="0" value={reciboMonto} onChange={(e) => setReciboMonto(e.target.value)} placeholder="0.00" />
                  </div>
                  <Button type="button" variant="outline" onClick={distribuirAutomatico} disabled={!(Number(reciboMonto) > 0)}>
                    Distribuir (antiguas primero)
                  </Button>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Factura</TableHead>
                      <TableHead>Fecha</TableHead>
                      <TableHead className="text-right">Saldo</TableHead>
                      <TableHead className="text-right w-40">Aplicar (L)</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {facturasReciboCliente.map((f) => (
                      <TableRow key={f.id}>
                        <TableCell className="font-mono text-sm">{f.numero_factura}</TableCell>
                        <TableCell className="text-sm">{f.fecha_venta?.split("T")[0]}</TableCell>
                        <TableCell className="text-right text-sm">{formatCurrency(f.saldo_pendiente)}</TableCell>
                        <TableCell className="text-right">
                          <Input
                            type="number"
                            step="0.01"
                            min="0"
                            max={f.saldo_pendiente}
                            className="h-8 text-right"
                            value={reciboAplicaciones[f.id] ?? ""}
                            onChange={(e) => setReciboAplicaciones((prev) => ({ ...prev, [f.id]: e.target.value }))}
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <div className="flex justify-between text-sm font-medium">
                  <span>Total aplicado</span>
                  <span>{formatCurrency(totalAplicado)}</span>
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowReciboDialog(false)}>Cancelar</Button>
            <Button onClick={handleRegistrarRecibo} disabled={savingRecibo || totalAplicado <= 0}>
              {savingRecibo && <Spinner className="mr-2 h-4 w-4" />}
              Registrar recibo
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Anular recibo */}
      <Dialog open={reciboAAnular !== null} onOpenChange={(o) => { if (!o && !anulandoRecibo) setReciboAAnular(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-red-600">Anular recibo {reciboAAnular?.numero_recibo}</DialogTitle>
            <DialogDescription>
              El dinero ({formatCurrency(reciboAAnular?.monto_total || 0)}) sale de tesorería y las facturas recuperan su saldo. El recibo queda como anulado.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label>Motivo</Label>
            <Input value={motivoAnularRecibo} onChange={(e) => setMotivoAnularRecibo(e.target.value)} placeholder="Ej: pago aplicado a otro cliente" autoFocus />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReciboAAnular(null)} disabled={anulandoRecibo}>Cancelar</Button>
            <Button onClick={handleAnularRecibo} disabled={anulandoRecibo || !motivoAnularRecibo.trim()} className="bg-red-600 hover:bg-red-700">
              {anulandoRecibo && <Spinner className="mr-2 h-4 w-4" />}
              Anular recibo
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Payment Dialog */}
      <Dialog open={showPagoDialog} onOpenChange={setShowPagoDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Registrar Abono</DialogTitle>
            <DialogDescription>
              Factura: {selectedCuenta?.numero_factura} - {selectedCuenta?.cliente_nombre}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {/* Current balance info */}
            <div className="grid grid-cols-2 gap-4 p-4 bg-muted/50 rounded-lg">
              <div>
                <p className="text-sm text-muted-foreground">Total Factura</p>
                <p className="font-semibold">L {(selectedCuenta?.total_venta ?? 0).toFixed(2)}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Saldo Pendiente</p>
                <p className="font-semibold text-red-600">L {(selectedCuenta?.saldo_pendiente ?? 0).toFixed(2)}</p>
              </div>
            </div>

            {/* Progress */}
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>Progreso de pago</span>
                <span>{(selectedCuenta?.porcentaje_pagado ?? 0).toFixed(0)}%</span>
              </div>
              <Progress value={selectedCuenta?.porcentaje_pagado ?? 0} className="h-3" />
            </div>

            {/* Amount input */}
            <div className="space-y-2">
              <Label htmlFor="monto">Monto del Abono (L)</Label>
              <Input
                id="monto"
                type="number"
                step="0.01"
                min="0"
                max={selectedCuenta?.saldo_pendiente || 0}
                value={pagoMonto}
                onChange={(e) => setPagoMonto(e.target.value)}
                placeholder="0.00"
              />
              <p className="text-xs text-muted-foreground">
                Maximo: L {(selectedCuenta?.saldo_pendiente ?? 0).toFixed(2)}
              </p>
            </div>

            {/* Payment method */}
            <div className="space-y-2">
              <Label>Metodo de Pago</Label>
              <Select value={pagoMetodo} onValueChange={(v) => { setPagoMetodo(v); if (v !== "Banco") setPagoCuentaId("") }}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Efectivo">Efectivo (caja chica)</SelectItem>
                  <SelectItem value="Banco">Banco / transferencia / tarjeta</SelectItem>
                  <SelectItem value="Otro">Otro (sin asiento de tesorería)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {pagoMetodo === "Banco" && (
              <div className="space-y-2">
                <Label>Cuenta destino</Label>
                <Select value={pagoCuentaId || "__none__"} onValueChange={(v) => setPagoCuentaId(v === "__none__" ? "" : v)}>
                  <SelectTrigger><SelectValue placeholder="Elige la cuenta" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Elige la cuenta</SelectItem>
                    {cuentasBanco.map((c) => (
                      <SelectItem key={c.id} value={String(c.id)}>{c.nombre}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPagoDialog(false)}>
              Cancelar
            </Button>
            <Button onClick={handleRegistrarPago} disabled={savingPago}>
              {savingPago && <Spinner className="mr-2 h-4 w-4" />}
              Registrar Pago
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Detail Dialog */}
      <Dialog open={showDetalleDialog} onOpenChange={setShowDetalleDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Detalle de Factura</DialogTitle>
            <DialogDescription>
              {selectedCuenta?.numero_factura} - {selectedCuenta?.cliente_nombre}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {/* Invoice info */}
            <div className="grid grid-cols-3 gap-4 p-4 bg-muted/50 rounded-lg">
              <div>
                <p className="text-sm text-muted-foreground">Total Factura</p>
                <p className="font-semibold">L {(selectedCuenta?.total_venta ?? 0).toFixed(2)}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Abonado</p>
                <p className="font-semibold text-green-600">L {(selectedCuenta?.total_abonado ?? 0).toFixed(2)}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Saldo</p>
                <p className="font-semibold text-red-600">L {(selectedCuenta?.saldo_pendiente ?? 0).toFixed(2)}</p>
              </div>
            </div>

            {/* Products table */}
            {loadingDetalles ? (
              <div className="flex justify-center py-8">
                <Spinner className="h-6 w-6" />
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Producto</TableHead>
                    <TableHead className="text-right">Cantidad</TableHead>
                    <TableHead className="text-right">Precio Unit.</TableHead>
                    <TableHead className="text-right">Subtotal</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detalles.map((d) => (
                    <TableRow key={d.id}>
                      <TableCell>{d.producto_nombre}</TableCell>
                      <TableCell className="text-right">{d.cantidad}</TableCell>
                      <TableCell className="text-right">L {(d.precio_unitario ?? 0).toFixed(2)}</TableCell>
                      <TableCell className="text-right">
                        L {((d.cantidad ?? 0) * (d.precio_unitario ?? 0)).toFixed(2)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDetalleDialog(false)}>
              Cerrar
            </Button>
            <Button onClick={() => {
              setShowDetalleDialog(false)
              if (selectedCuenta) openPagoDialog(selectedCuenta)
            }}>
              Registrar Pago
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
