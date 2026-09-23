"use client"

import * as React from "react"
import {
  Plus,
  Receipt,
  Trash2,
  Eye,
  Wallet,
  Settings2,
  Banknote,
  Building2,
  AlertTriangle,
  CheckCircle2,
  Clock,
  CreditCard,
  History,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Spinner } from "@/components/ui/spinner"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { useToast } from "@/hooks/use-toast"
import {
  getConceptosGasto,
  createConceptoGasto,
  deleteConceptoGasto,
  getGastos,
  createGasto,
  deleteGasto,
  uploadComprobante,
  getGastosDelMes,
  registrarPagoGasto,
  getPagosGasto,
  getCuentasPorPagar,
  CATEGORIAS_MACRO,
  type ConceptoGasto,
  type Gasto,
  type CategoriaMacro,
  type CuentaPorPagar,
  type GastoPago,
} from "@/lib/services/gastos"
import { getCuentas, type CuentaConfig } from "@/lib/services/cuentas"
import { CxpComprasSection } from "@/components/compras/cxp-compras"
import {
  getProveedores,
  createProveedor,
  type Proveedor,
} from "@/lib/services/proveedores"
import { hoyISO } from "@/lib/utils/fecha"

export default function GastosPage() {
  const { toast } = useToast()

  // ============== STATE ==============
  const [loading, setLoading] = React.useState(true)
  const [conceptos, setConceptos] = React.useState<ConceptoGasto[]>([])
  const [proveedores, setProveedores] = React.useState<Proveedor[]>([])
  const [gastos, setGastos] = React.useState<Gasto[]>([])
  const [cuentasPorPagar, setCuentasPorPagar] = React.useState<CuentaPorPagar[]>([])
  const [totalDeuda, setTotalDeuda] = React.useState(0)
  const [cuentasBancarias, setCuentasBancarias] = React.useState<CuentaConfig[]>([])
  const [totalMes, setTotalMes] = React.useState(0)
  const [porCategoria, setPorCategoria] = React.useState<Record<string, number>>({})
  const [activeTab, setActiveTab] = React.useState<"historial" | "por-pagar">("historial")

  // Concepto dialog
  const [conceptoDialogOpen, setConceptoDialogOpen] = React.useState(false)
  const [conceptoNombre, setConceptoNombre] = React.useState("")
  const [conceptoCategoria, setConceptoCategoria] = React.useState<CategoriaMacro>("Otros")
  const [savingConcepto, setSavingConcepto] = React.useState(false)

  // Comprobante viewer
  const [comprobanteDialogOpen, setComprobanteDialogOpen] = React.useState(false)
  const [comprobanteUrl, setComprobanteUrl] = React.useState<string | null>(null)

  // ============== NUEVO GASTO ==============
  const [gastoDialogOpen, setGastoDialogOpen] = React.useState(false)
  const [gastoConceptoId, setGastoConceptoId] = React.useState<number | null>(null)
  // Fecha local (dia de negocio). NO usar toISOString(): de noche adelanta el dia.
  const [gastoFecha, setGastoFecha] = React.useState(hoyISO())
  const [gastoMonto, setGastoMonto] = React.useState<number>(0)
  const [gastoDescripcion, setGastoDescripcion] = React.useState("")
  const [gastoComprobante, setGastoComprobante] = React.useState<File | null>(null)
  const [gastoProveedorId, setGastoProveedorId] = React.useState<number | null>(null)
  const [gastoVencimiento, setGastoVencimiento] = React.useState("")
  // Quick-create de proveedor desde el form de gasto.
  const [nuevoProveedorOpen, setNuevoProveedorOpen] = React.useState(false)
  const [nuevoProveedorNombre, setNuevoProveedorNombre] = React.useState("")
  const [savingProveedor, setSavingProveedor] = React.useState(false)
  const [gastoEstadoInicial, setGastoEstadoInicial] = React.useState<
    "Pagar" | "Pendiente"
  >("Pagar")
  const [gastoPagoMetodo, setGastoPagoMetodo] = React.useState<"Efectivo" | "Banco">("Efectivo")
  const [gastoPagoCuenta, setGastoPagoCuenta] = React.useState<number | null>(null)
  const [savingGasto, setSavingGasto] = React.useState(false)
  const [uploadingFile, setUploadingFile] = React.useState(false)

  // ============== REGISTRAR ABONO ==============
  const [pagoDialogOpen, setPagoDialogOpen] = React.useState(false)
  const [pagoTarget, setPagoTarget] = React.useState<{
    id: number
    saldo: number
    proveedor: string | null
    concepto: string | null
  } | null>(null)
  const [pagoMonto, setPagoMonto] = React.useState<number>(0)
  const [pagoMetodo, setPagoMetodo] = React.useState<"Efectivo" | "Banco">("Efectivo")
  const [pagoCuenta, setPagoCuenta] = React.useState<number | null>(null)
  const [savingPago, setSavingPago] = React.useState(false)

  // ============== HISTORIAL DE ABONOS (modal) ==============
  const [historialOpen, setHistorialOpen] = React.useState(false)
  const [historialGastoId, setHistorialGastoId] = React.useState<number | null>(null)
  const [historialPagos, setHistorialPagos] = React.useState<GastoPago[]>([])
  const [loadingHistorial, setLoadingHistorial] = React.useState(false)

  // ============== LOAD ==============
  React.useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    setLoading(true)
    const [conceptosRes, provRes, gastosRes, statsRes, apRes, cuentasRes] =
      await Promise.all([
        getConceptosGasto(),
        getProveedores(),
        getGastos(),
        getGastosDelMes(),
        getCuentasPorPagar(),
        getCuentas(),
      ])

    if (conceptosRes.data) setConceptos(conceptosRes.data)
    if (provRes.data) setProveedores(provRes.data)
    if (gastosRes.data) setGastos(gastosRes.data)
    setTotalMes(statsRes.total)
    setPorCategoria(statsRes.porCategoria)
    setCuentasPorPagar(apRes.data)
    setTotalDeuda(apRes.totalDeuda)
    setCuentasBancarias(
      (cuentasRes.data || []).filter((c) => c.activo !== false)
    )
    setLoading(false)
  }

  // ============== QUICK CREATE PROVEEDOR ==============
  async function handleSaveProveedor() {
    const trimmed = nuevoProveedorNombre.trim()
    if (!trimmed) {
      toast({ title: "Error", description: "Ingrese un nombre", variant: "destructive" })
      return
    }
    setSavingProveedor(true)
    const { data, error } = await createProveedor(trimmed)
    setSavingProveedor(false)
    if (error || !data) {
      toast({
        title: "Error",
        description:
          error === "feature_pending"
            ? "La tabla de proveedores aun no esta disponible"
            : error || "No se pudo crear",
        variant: "destructive",
      })
      return
    }
    toast({ title: "Proveedor creado", description: trimmed })
    setProveedores((prev) => {
      const next = [...prev, data]
      next.sort((a, b) => a.nombre.localeCompare(b.nombre))
      return next
    })
    if (data.id) setGastoProveedorId(data.id)
    setNuevoProveedorNombre("")
    setNuevoProveedorOpen(false)
  }

  // ============== CONCEPTOS ==============
  async function handleSaveConcepto() {
    if (!conceptoNombre.trim()) {
      toast({ title: "Error", description: "Ingrese un nombre para el concepto", variant: "destructive" })
      return
    }
    setSavingConcepto(true)
    const { error } = await createConceptoGasto({
      nombre: conceptoNombre.trim(),
      categoria_macro: conceptoCategoria,
    })
    setSavingConcepto(false)
    if (error) {
      toast({ title: "Error", description: error, variant: "destructive" })
      return
    }
    toast({ title: "Concepto creado", description: `Se agrego "${conceptoNombre}"` })
    setConceptoNombre("")
    setConceptoCategoria("Otros")
    setConceptoDialogOpen(false)
    loadData()
  }

  async function handleDeleteConcepto(id: number) {
    const { error } = await deleteConceptoGasto(id)
    if (error) {
      toast({ title: "Error", description: error, variant: "destructive" })
      return
    }
    toast({ title: "Eliminado", description: "Concepto eliminado correctamente" })
    loadData()
  }

  // ============== NUEVO GASTO ==============
  function resetGastoForm() {
    setGastoConceptoId(null)
    setGastoFecha(hoyISO())
    setGastoMonto(0)
    setGastoDescripcion("")
    setGastoComprobante(null)
    setGastoProveedorId(null)
    setGastoVencimiento("")
    setGastoEstadoInicial("Pagar")
    setGastoPagoMetodo("Efectivo")
    setGastoPagoCuenta(null)
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) setGastoComprobante(file)
  }

  async function handleSaveGasto() {
    if (!gastoConceptoId) {
      toast({ title: "Error", description: "Seleccione un concepto", variant: "destructive" })
      return
    }
    if (gastoMonto <= 0) {
      toast({ title: "Error", description: "Ingrese un monto valido", variant: "destructive" })
      return
    }
    if (
      gastoEstadoInicial === "Pagar" &&
      gastoPagoMetodo === "Banco" &&
      !gastoPagoCuenta
    ) {
      toast({ title: "Error", description: "Seleccione la cuenta bancaria", variant: "destructive" })
      return
    }

    setSavingGasto(true)
    let comprobanteUrlLocal: string | undefined = undefined
    if (gastoComprobante) {
      setUploadingFile(true)
      const uploadRes = await uploadComprobante(gastoComprobante)
      setUploadingFile(false)
      if (uploadRes.url) comprobanteUrlLocal = uploadRes.url
    }

    const pagarAhora = gastoEstadoInicial === "Pagar"
    const { error } = await createGasto({
      concepto_id: gastoConceptoId,
      fecha_gasto: gastoFecha,
      monto: gastoMonto,
      // metodo_pago legado: lo derivamos del pago si aplica.
      metodo_pago: pagarAhora
        ? gastoPagoMetodo === "Efectivo"
          ? "Efectivo"
          : "Transferencia"
        : "Efectivo",
      descripcion: gastoDescripcion || undefined,
      comprobante_url: comprobanteUrlLocal,
      proveedor_id: gastoProveedorId,
      fecha_vencimiento: gastoVencimiento || null,
      pagar_ahora: pagarAhora,
      pago_metodo: gastoPagoMetodo,
      pago_cuenta_id: gastoPagoMetodo === "Banco" ? gastoPagoCuenta : null,
    })

    setSavingGasto(false)

    if (error) {
      toast({ title: "Error", description: error, variant: "destructive" })
      return
    }

    toast({
      title: pagarAhora ? "Gasto registrado y pagado" : "Cuenta por pagar creada",
      description: `L ${gastoMonto.toFixed(2)} ${
        pagarAhora ? "guardado correctamente" : "pendiente de pago"
      }`,
    })

    resetGastoForm()
    setGastoDialogOpen(false)
    loadData()
  }

  async function handleDeleteGasto(id: number) {
    const { error } = await deleteGasto(id)
    if (error) {
      toast({ title: "Error", description: error, variant: "destructive" })
      return
    }
    toast({ title: "Eliminado", description: "Gasto eliminado correctamente" })
    loadData()
  }

  // ============== ABONOS ==============
  function abrirModalPago(g: Gasto | CuentaPorPagar) {
    const monto = Number(g.monto || 0)
    const pagado = Number(("monto_pagado" in g ? g.monto_pagado : 0) || 0)
    const saldo = +(monto - pagado).toFixed(2)
    setPagoTarget({
      id: g.id!,
      saldo,
      proveedor:
        ("proveedor_nombre" in g ? g.proveedor_nombre : null) ?? null,
      concepto:
        ("concepto_nombre" in g
          ? g.concepto_nombre
          : "concepto_nombre" in (g as object)
            ? (g as { concepto_nombre?: string }).concepto_nombre
            : null) ?? null,
    })
    setPagoMonto(saldo)
    setPagoMetodo("Efectivo")
    setPagoCuenta(null)
    setPagoDialogOpen(true)
  }

  async function handleGuardarPago() {
    if (!pagoTarget) return
    if (pagoMonto <= 0) {
      toast({ title: "Error", description: "Ingrese un monto valido", variant: "destructive" })
      return
    }
    if (pagoMonto > pagoTarget.saldo + 0.005) {
      toast({
        title: "Error",
        description: `Excede el saldo (L ${pagoTarget.saldo.toFixed(2)})`,
        variant: "destructive",
      })
      return
    }
    if (pagoMetodo === "Banco" && !pagoCuenta) {
      toast({ title: "Error", description: "Seleccione la cuenta bancaria", variant: "destructive" })
      return
    }

    setSavingPago(true)
    const { error } = await registrarPagoGasto({
      gasto_id: pagoTarget.id,
      monto: pagoMonto,
      metodo_pago: pagoMetodo,
      cuenta_id: pagoMetodo === "Banco" ? pagoCuenta : null,
    })
    setSavingPago(false)

    if (error) {
      toast({ title: "Error", description: error, variant: "destructive" })
      return
    }

    toast({
      title: "Pago registrado",
      description: `L ${pagoMonto.toFixed(2)} aplicado al gasto #${pagoTarget.id}`,
    })
    setPagoDialogOpen(false)
    setPagoTarget(null)
    loadData()
  }

  async function abrirHistorialPagos(gastoId: number) {
    setHistorialGastoId(gastoId)
    setHistorialOpen(true)
    setLoadingHistorial(true)
    const { data } = await getPagosGasto(gastoId)
    setHistorialPagos(data)
    setLoadingHistorial(false)
  }

  // ============== HELPERS ==============
  function formatDate(dateStr: string | null | undefined) {
    if (!dateStr) return "-"
    const date = new Date(dateStr.includes("T") ? dateStr : dateStr + "T00:00:00")
    return date.toLocaleDateString("es-HN", { day: "numeric", month: "short", year: "numeric" })
  }

  function formatDateTime(dateStr: string | null | undefined) {
    if (!dateStr) return "-"
    return new Date(dateStr).toLocaleString("es-HN", {
      // Los abonos (fecha_pago) vienen de movimientos HN-as-UTC: leer en UTC
      // para mostrar la hora real de Honduras (sin restar 6h).
      timeZone: "UTC",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    })
  }

  function getEstadoPagoBadge(estado: string | undefined) {
    switch (estado) {
      case "Pagado":
        return "bg-emerald-100 text-emerald-700 border-emerald-200"
      case "Parcial":
        return "bg-amber-100 text-amber-700 border-amber-200"
      case "Pendiente":
        return "bg-red-100 text-red-700 border-red-200"
      default:
        return "bg-stone-100 text-stone-700 border-stone-200"
    }
  }

  function getMetodoBadge(metodo: string) {
    switch (metodo) {
      case "Efectivo":
        return "bg-emerald-100 text-emerald-700 border-emerald-200"
      case "Transferencia":
      case "Banco":
        return "bg-blue-100 text-blue-700 border-blue-200"
      case "Tarjeta":
        return "bg-indigo-100 text-indigo-700 border-indigo-200"
      default:
        return "bg-stone-100 text-stone-700 border-stone-200"
    }
  }

  const categoriasSorted = Object.entries(porCategoria).sort((a, b) => b[1] - a[1])
  const cuentasVencidas = cuentasPorPagar.filter(
    (c) => c.dias_vencido !== null && c.dias_vencido > 0
  )

  // ============== RENDER ==============
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Spinner className="h-8 w-8 text-amber-600" />
      </div>
    )
  }

  return (
    <div className="space-y-6 p-6 bg-stone-50 min-h-screen">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-stone-800">
            Gastos &amp; Cuentas por Pagar
          </h1>
          <p className="text-stone-500 text-sm mt-1">
            Controla gastos del negocio y la deuda viva con proveedores
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Dialog open={conceptoDialogOpen} onOpenChange={setConceptoDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" className="gap-2 border-stone-200 hover:bg-stone-100">
                <Settings2 className="h-4 w-4" />
                Conceptos
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>Configurar Conceptos de Gasto</DialogTitle>
                <DialogDescription>
                  Define los tipos de gastos que registraras
                </DialogDescription>
              </DialogHeader>

              <div className="grid gap-4 py-4">
                <div className="grid gap-2">
                  <Label>Nombre del Concepto</Label>
                  <Input
                    placeholder="Ej: Pago de Internet"
                    value={conceptoNombre}
                    onChange={(e) => setConceptoNombre(e.target.value)}
                    className="border-stone-200"
                  />
                </div>
                <div className="grid gap-2">
                  <Label>Categoria</Label>
                  <Select
                    value={conceptoCategoria}
                    onValueChange={(v) => setConceptoCategoria(v as CategoriaMacro)}
                  >
                    <SelectTrigger className="border-stone-200">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CATEGORIAS_MACRO.map((cat) => (
                        <SelectItem key={cat} value={cat}>
                          {cat}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  onClick={handleSaveConcepto}
                  disabled={savingConcepto}
                  className="bg-amber-600 hover:bg-amber-700"
                >
                  {savingConcepto ? (
                    <Spinner className="h-4 w-4 mr-2" />
                  ) : (
                    <Plus className="h-4 w-4 mr-2" />
                  )}
                  Agregar Concepto
                </Button>
              </div>

              <div className="border-t border-stone-200 pt-4">
                <p className="text-sm font-medium text-stone-600 mb-3">
                  Conceptos Existentes
                </p>
                <div className="max-h-48 overflow-y-auto space-y-2">
                  {conceptos.length === 0 ? (
                    <p className="text-sm text-stone-400 text-center py-4">
                      No hay conceptos configurados
                    </p>
                  ) : (
                    conceptos.map((c) => (
                      <div
                        key={c.id}
                        className="flex items-center justify-between p-2 rounded-lg bg-stone-50 border border-stone-100"
                      >
                        <div>
                          <p className="text-sm font-medium text-stone-700">{c.nombre}</p>
                          <Badge variant="outline" className="text-xs mt-1">
                            {c.categoria_macro}
                          </Badge>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-stone-400 hover:text-red-600"
                          onClick={() => handleDeleteConcepto(c.id!)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </DialogContent>
          </Dialog>

          <Dialog
            open={gastoDialogOpen}
            onOpenChange={(open) => {
              setGastoDialogOpen(open)
              if (!open) resetGastoForm()
            }}
          >
            <DialogTrigger asChild>
              <Button className="gap-2 bg-amber-600 hover:bg-amber-700 text-white shadow-sm">
                <Plus className="h-4 w-4" />
                Registrar Gasto
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Nuevo Gasto / Factura</DialogTitle>
                <DialogDescription>
                  Decide si se paga ahora o queda como cuenta por pagar
                </DialogDescription>
              </DialogHeader>

              <div className="grid gap-4 py-4">
                {/* Concepto + Proveedor */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label>
                      Concepto <span className="text-red-500">*</span>
                    </Label>
                    <Select
                      value={gastoConceptoId?.toString() || ""}
                      onValueChange={(v) => setGastoConceptoId(parseInt(v))}
                    >
                      <SelectTrigger className="border-stone-200">
                        <SelectValue placeholder="Seleccione" />
                      </SelectTrigger>
                      <SelectContent>
                        {conceptos.map((c) => (
                          <SelectItem key={c.id} value={c.id!.toString()}>
                            {c.nombre} ({c.categoria_macro})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {conceptos.length === 0 && (
                      <p className="text-xs text-amber-600">
                        Primero configure conceptos de gasto
                      </p>
                    )}
                  </div>
                  <div className="grid gap-2">
                    <div className="flex items-center justify-between">
                      <Label>Proveedor</Label>
                      <button
                        type="button"
                        onClick={() => {
                          setNuevoProveedorNombre("")
                          setNuevoProveedorOpen(true)
                        }}
                        className="text-xs text-amber-700 hover:underline"
                      >
                        + Nuevo
                      </button>
                    </div>
                    <Select
                      value={gastoProveedorId?.toString() || "none"}
                      onValueChange={(v) =>
                        setGastoProveedorId(v === "none" ? null : parseInt(v))
                      }
                    >
                      <SelectTrigger className="border-stone-200">
                        <SelectValue placeholder="Seleccione proveedor" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Sin proveedor</SelectItem>
                        {proveedores.map((p) => (
                          <SelectItem key={p.id} value={p.id!.toString()}>
                            {p.nombre}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* Monto */}
                <div className="grid gap-2">
                  <Label>
                    Monto Total (L) <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="0.00"
                    value={gastoMonto || ""}
                    onChange={(e) => setGastoMonto(parseFloat(e.target.value) || 0)}
                    className="border-stone-200"
                  />
                </div>

                {/* Fechas */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label>
                      Fecha del Gasto <span className="text-red-500">*</span>
                    </Label>
                    <Input
                      type="date"
                      value={gastoFecha}
                      onChange={(e) => setGastoFecha(e.target.value)}
                      className="border-stone-200"
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label>Fecha de Vencimiento</Label>
                    <Input
                      type="date"
                      value={gastoVencimiento}
                      onChange={(e) => setGastoVencimiento(e.target.value)}
                      className="border-stone-200"
                    />
                  </div>
                </div>

                {/* Estado inicial */}
                <div className="rounded-xl border border-stone-200 bg-stone-50/60 p-4">
                  <Label className="text-sm font-medium text-stone-700 mb-3 block">
                    Estado Inicial
                  </Label>
                  <RadioGroup
                    value={gastoEstadoInicial}
                    onValueChange={(v) =>
                      setGastoEstadoInicial(v as "Pagar" | "Pendiente")
                    }
                    className="grid grid-cols-2 gap-3"
                  >
                    <Label
                      className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition ${
                        gastoEstadoInicial === "Pagar"
                          ? "border-emerald-300 bg-emerald-50"
                          : "border-stone-200 bg-white hover:bg-stone-50"
                      }`}
                    >
                      <RadioGroupItem value="Pagar" className="mt-1" />
                      <div>
                        <p className="text-sm font-semibold text-stone-800">
                          Pagar Ahora
                        </p>
                        <p className="text-xs text-stone-500">
                          Registra el pago completo automaticamente
                        </p>
                      </div>
                    </Label>
                    <Label
                      className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition ${
                        gastoEstadoInicial === "Pendiente"
                          ? "border-amber-300 bg-amber-50"
                          : "border-stone-200 bg-white hover:bg-stone-50"
                      }`}
                    >
                      <RadioGroupItem value="Pendiente" className="mt-1" />
                      <div>
                        <p className="text-sm font-semibold text-stone-800">
                          Queda Pendiente
                        </p>
                        <p className="text-xs text-stone-500">
                          Crea cuenta por pagar para abonar luego
                        </p>
                      </div>
                    </Label>
                  </RadioGroup>

                  {gastoEstadoInicial === "Pagar" && (
                    <div className="mt-4 space-y-3">
                      <div className="grid gap-2">
                        <Label>Metodo de Pago</Label>
                        <Select
                          value={gastoPagoMetodo}
                          onValueChange={(v) => setGastoPagoMetodo(v as "Efectivo" | "Banco")}
                        >
                          <SelectTrigger className="border-stone-200 bg-white">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="Efectivo">
                              <div className="flex items-center gap-2">
                                <Banknote className="h-4 w-4" />
                                Efectivo (Caja Chica)
                              </div>
                            </SelectItem>
                            <SelectItem value="Banco">
                              <div className="flex items-center gap-2">
                                <Building2 className="h-4 w-4" />
                                Cuenta Bancaria
                              </div>
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      {gastoPagoMetodo === "Banco" && (
                        <div className="grid gap-2">
                          <Label>Cuenta de Origen</Label>
                          <Select
                            value={gastoPagoCuenta?.toString() || ""}
                            onValueChange={(v) => setGastoPagoCuenta(parseInt(v))}
                          >
                            <SelectTrigger className="border-stone-200 bg-white">
                              <SelectValue placeholder="Seleccione cuenta" />
                            </SelectTrigger>
                            <SelectContent>
                              {cuentasBancarias.length === 0 ? (
                                <SelectItem value="0" disabled>
                                  No hay cuentas configuradas
                                </SelectItem>
                              ) : (
                                cuentasBancarias.map((c) => (
                                  <SelectItem key={c.id} value={c.id!.toString()}>
                                    {c.nombre} ({c.tipo})
                                  </SelectItem>
                                ))
                              )}
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Descripcion */}
                <div className="grid gap-2">
                  <Label>Descripcion</Label>
                  <Textarea
                    placeholder="Detalles adicionales..."
                    value={gastoDescripcion}
                    onChange={(e) => setGastoDescripcion(e.target.value)}
                    className="border-stone-200 min-h-[60px]"
                  />
                </div>

                {/* Comprobante */}
                <div className="grid gap-2">
                  <Label>Comprobante / Factura</Label>
                  <Input
                    type="file"
                    accept="image/*,.pdf"
                    onChange={handleFileChange}
                    className="border-stone-200"
                  />
                  {gastoComprobante && (
                    <p className="text-xs text-emerald-600">
                      Archivo: {gastoComprobante.name}
                    </p>
                  )}
                </div>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setGastoDialogOpen(false)}>
                  Cancelar
                </Button>
                <Button
                  onClick={handleSaveGasto}
                  disabled={savingGasto || uploadingFile}
                  className="bg-amber-600 hover:bg-amber-700"
                >
                  {(savingGasto || uploadingFile) && (
                    <Spinner className="h-4 w-4 mr-2" />
                  )}
                  {uploadingFile
                    ? "Subiendo..."
                    : gastoEstadoInicial === "Pagar"
                      ? "Guardar y Pagar"
                      : "Crear Cuenta por Pagar"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="bg-white rounded-2xl border-stone-200/60 shadow-sm">
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-xl bg-orange-100">
                <Wallet className="h-6 w-6 text-orange-600" />
              </div>
              <div>
                <p className="text-sm text-stone-500">Gasto del Mes</p>
                <p className="text-2xl font-bold text-orange-700">
                  L {totalMes.toLocaleString("es-HN", { minimumFractionDigits: 2 })}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-white rounded-2xl border-stone-200/60 shadow-sm">
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-xl bg-red-100">
                <CreditCard className="h-6 w-6 text-red-600" />
              </div>
              <div>
                <p className="text-sm text-stone-500">Deuda a Proveedores</p>
                <p className="text-2xl font-bold text-red-700">
                  L {totalDeuda.toLocaleString("es-HN", { minimumFractionDigits: 2 })}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-white rounded-2xl border-stone-200/60 shadow-sm">
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-xl bg-amber-100">
                <AlertTriangle className="h-6 w-6 text-amber-600" />
              </div>
              <div>
                <p className="text-sm text-stone-500">Facturas Vencidas</p>
                <p className="text-2xl font-bold text-amber-700">
                  {cuentasVencidas.length}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-white rounded-2xl border-stone-200/60 shadow-sm">
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-xl bg-blue-100">
                <Receipt className="h-6 w-6 text-blue-600" />
              </div>
              <div>
                <p className="text-sm text-stone-500">Cuentas Pendientes</p>
                <p className="text-2xl font-bold text-stone-800">
                  {cuentasPorPagar.length}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Distribucion por categoria */}
      {categoriasSorted.length > 0 && (
        <Card className="bg-white rounded-2xl border-stone-200/60 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-base text-stone-700">
              Distribucion por Categoria (Mes Actual)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {categoriasSorted.map(([cat, monto]) => {
                const porcentaje = totalMes > 0 ? (monto / totalMes) * 100 : 0
                return (
                  <div key={cat} className="space-y-1">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-stone-600">{cat}</span>
                      <span className="font-medium text-stone-800">
                        L{" "}
                        {monto.toLocaleString("es-HN", { minimumFractionDigits: 2 })}
                      </span>
                    </div>
                    <div className="h-2 bg-stone-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-amber-500 rounded-full transition-all duration-500"
                        style={{ width: `${porcentaje}%` }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Tabs: Historial / Cuentas por Pagar */}
      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as "historial" | "por-pagar")}
      >
        <TabsList className="bg-white border border-stone-200/60 p-1">
          <TabsTrigger
            value="historial"
            className="data-[state=active]:bg-amber-50 data-[state=active]:text-amber-700"
          >
            <Receipt className="h-4 w-4 mr-2" />
            Historial de Gastos
          </TabsTrigger>
          <TabsTrigger
            value="por-pagar"
            className="data-[state=active]:bg-red-50 data-[state=active]:text-red-700"
          >
            <CreditCard className="h-4 w-4 mr-2" />
            Cuentas por Pagar
            {cuentasPorPagar.length > 0 && (
              <Badge className="ml-2 bg-red-100 text-red-700 border-red-200" variant="outline">
                {cuentasPorPagar.length}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* ===== HISTORIAL ===== */}
        <TabsContent value="historial" className="mt-4">
          <Card className="bg-white rounded-2xl border-stone-200/60 shadow-sm">
            <CardHeader>
              <CardTitle className="text-lg text-stone-800 flex items-center gap-2">
                <Receipt className="h-5 w-5 text-amber-600" />
                Historial de Gastos
              </CardTitle>
              <CardDescription>
                Todos los gastos registrados ordenados por fecha
              </CardDescription>
            </CardHeader>
            <CardContent>
              {gastos.length === 0 ? (
                <Empty className="border-0">
                  <EmptyHeader>
                    <EmptyMedia>
                      <Receipt className="h-12 w-12 text-stone-300" />
                    </EmptyMedia>
                    <EmptyTitle>No hay gastos registrados</EmptyTitle>
                    <EmptyDescription>
                      Comienza registrando tu primer gasto o cuenta por pagar
                    </EmptyDescription>
                  </EmptyHeader>
                  <EmptyContent>
                    <Button
                      className="bg-amber-600 hover:bg-amber-700"
                      onClick={() => setGastoDialogOpen(true)}
                    >
                      <Plus className="h-4 w-4 mr-2" />
                      Registrar Gasto
                    </Button>
                  </EmptyContent>
                </Empty>
              ) : (
                <div className="overflow-x-auto">
                  <Table containerClassName="max-h-[60vh] overflow-y-auto">
                    <TableHeader sticky>
                      <TableRow className="bg-stone-50/50">
                        <TableHead>Fecha</TableHead>
                        <TableHead>Concepto</TableHead>
                        <TableHead>Proveedor</TableHead>
                        <TableHead className="text-right">Monto</TableHead>
                        <TableHead className="text-right">Saldo</TableHead>
                        <TableHead>Estado</TableHead>
                        <TableHead className="text-center">Acciones</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {gastos.map((g) => {
                        const monto = Number(g.monto || 0)
                        const pagado = Number(g.monto_pagado || 0)
                        const saldo = +(monto - pagado).toFixed(2)
                        const estado =
                          g.estado_pago ||
                          (saldo <= 0 ? "Pagado" : pagado > 0 ? "Parcial" : "Pendiente")
                        const puedeAbonar = saldo > 0.005
                        return (
                          <TableRow key={g.id} className="hover:bg-stone-50/50">
                            <TableCell className="text-stone-600 whitespace-nowrap">
                              {formatDate(g.fecha_gasto)}
                            </TableCell>
                            <TableCell>
                              <p className="font-medium text-stone-800">
                                {g.concepto_nombre}
                              </p>
                              <Badge
                                variant="outline"
                                className="border-stone-200 text-stone-500 text-xs mt-1"
                              >
                                {g.categoria_macro || "Otros"}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              {g.proveedor_nombre ? (
                                <p className="text-sm text-stone-700">{g.proveedor_nombre}</p>
                              ) : (
                                <span className="text-xs text-stone-400">-</span>
                              )}
                            </TableCell>
                            <TableCell className="text-right font-semibold text-orange-700 whitespace-nowrap">
                              L {monto.toLocaleString("es-HN", { minimumFractionDigits: 2 })}
                            </TableCell>
                            <TableCell className="text-right whitespace-nowrap">
                              {saldo > 0.005 ? (
                                <span className="font-semibold text-red-600">
                                  L{" "}
                                  {saldo.toLocaleString("es-HN", {
                                    minimumFractionDigits: 2,
                                  })}
                                </span>
                              ) : (
                                <span className="text-stone-400">-</span>
                              )}
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant="outline"
                                className={getEstadoPagoBadge(estado)}
                              >
                                {estado === "Pagado" && (
                                  <CheckCircle2 className="h-3 w-3 mr-1" />
                                )}
                                {estado === "Pendiente" && (
                                  <Clock className="h-3 w-3 mr-1" />
                                )}
                                {estado}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center justify-center gap-1">
                                {puedeAbonar && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-8 gap-1 text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800"
                                    onClick={() => abrirModalPago(g)}
                                  >
                                    <Banknote className="h-4 w-4" />
                                    Pagar
                                  </Button>
                                )}
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 text-stone-500 hover:text-stone-700"
                                  onClick={() => abrirHistorialPagos(g.id!)}
                                  title="Historial de abonos"
                                >
                                  <History className="h-4 w-4" />
                                </Button>
                                {g.comprobante_url && (
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 text-stone-500 hover:text-blue-600"
                                    onClick={() => {
                                      setComprobanteUrl(g.comprobante_url!)
                                      setComprobanteDialogOpen(true)
                                    }}
                                  >
                                    <Eye className="h-4 w-4" />
                                  </Button>
                                )}
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 text-stone-400 hover:text-red-600"
                                  onClick={() => handleDeleteGasto(g.id!)}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
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
        </TabsContent>

        {/* ===== CUENTAS POR PAGAR ===== */}
        <TabsContent value="por-pagar" className="mt-4 space-y-4">
          {/* Compras a crédito por orden de compra (officemart-008). */}
          <CxpComprasSection />
          <Card className="bg-white rounded-2xl border-stone-200/60 shadow-sm">
            <CardHeader>
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <CardTitle className="text-lg text-stone-800 flex items-center gap-2">
                    <CreditCard className="h-5 w-5 text-red-600" />
                    Cuentas por Pagar
                  </CardTitle>
                  <CardDescription>
                    Facturas pendientes ordenadas por vencimiento (vencidas primero)
                  </CardDescription>
                </div>
                <div className="text-right">
                  <p className="text-xs text-stone-500">Total Deuda</p>
                  <p className="text-xl font-bold text-red-700">
                    L{" "}
                    {totalDeuda.toLocaleString("es-HN", {
                      minimumFractionDigits: 2,
                    })}
                  </p>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {cuentasPorPagar.length === 0 ? (
                <Empty className="border-0">
                  <EmptyHeader>
                    <EmptyMedia>
                      <CheckCircle2 className="h-12 w-12 text-emerald-400" />
                    </EmptyMedia>
                    <EmptyTitle>No tienes deuda con proveedores</EmptyTitle>
                    <EmptyDescription>
                      Todas las facturas estan al dia
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              ) : (
                <div className="overflow-x-auto">
                  <Table containerClassName="max-h-[60vh] overflow-y-auto">
                    <TableHeader sticky>
                      <TableRow className="bg-stone-50/50">
                        <TableHead>Vencimiento</TableHead>
                        <TableHead>Proveedor</TableHead>
                        <TableHead>Concepto</TableHead>
                        <TableHead className="text-right">Monto</TableHead>
                        <TableHead className="text-right">Pagado</TableHead>
                        <TableHead className="text-right">Saldo</TableHead>
                        <TableHead className="text-center">Accion</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {cuentasPorPagar.map((cp) => {
                        const dias = cp.dias_vencido
                        const vencida = dias !== null && dias > 0
                        const proxima = dias !== null && dias >= -3 && dias <= 0
                        return (
                          <TableRow
                            key={cp.id}
                            className={
                              vencida
                                ? "bg-red-50/40 hover:bg-red-50/70"
                                : proxima
                                  ? "bg-amber-50/30 hover:bg-amber-50/60"
                                  : "hover:bg-stone-50/50"
                            }
                          >
                            <TableCell className="whitespace-nowrap">
                              {cp.fecha_vencimiento ? (
                                <div>
                                  <p
                                    className={`text-sm font-medium ${
                                      vencida
                                        ? "text-red-700"
                                        : proxima
                                          ? "text-amber-700"
                                          : "text-stone-700"
                                    }`}
                                  >
                                    {formatDate(cp.fecha_vencimiento)}
                                  </p>
                                  {vencida && (
                                    <Badge className="mt-1 bg-red-100 text-red-700 border-red-200 text-xs">
                                      Vencida {dias}d
                                    </Badge>
                                  )}
                                  {proxima && !vencida && (
                                    <Badge className="mt-1 bg-amber-100 text-amber-700 border-amber-200 text-xs">
                                      {dias === 0
                                        ? "Vence hoy"
                                        : `En ${Math.abs(dias!)}d`}
                                    </Badge>
                                  )}
                                </div>
                              ) : (
                                <span className="text-xs text-stone-400">Sin fecha</span>
                              )}
                            </TableCell>
                            <TableCell>
                              <p className="text-sm font-medium text-stone-800">
                                {cp.proveedor_nombre || "Sin proveedor"}
                              </p>
                            </TableCell>
                            <TableCell>
                              <p className="text-sm text-stone-700">
                                {cp.concepto_nombre || "-"}
                              </p>
                              {cp.categoria_macro && (
                                <Badge
                                  variant="outline"
                                  className="border-stone-200 text-stone-500 text-xs mt-1"
                                >
                                  {cp.categoria_macro}
                                </Badge>
                              )}
                            </TableCell>
                            <TableCell className="text-right text-stone-700 whitespace-nowrap">
                              L{" "}
                              {cp.monto.toLocaleString("es-HN", {
                                minimumFractionDigits: 2,
                              })}
                            </TableCell>
                            <TableCell className="text-right text-emerald-700 whitespace-nowrap">
                              L{" "}
                              {cp.monto_pagado.toLocaleString("es-HN", {
                                minimumFractionDigits: 2,
                              })}
                            </TableCell>
                            <TableCell className="text-right font-bold text-red-700 whitespace-nowrap">
                              L{" "}
                              {cp.saldo_pendiente.toLocaleString("es-HN", {
                                minimumFractionDigits: 2,
                              })}
                            </TableCell>
                            <TableCell className="text-center">
                              <Button
                                size="sm"
                                className="bg-emerald-600 hover:bg-emerald-700 text-white"
                                onClick={() => abrirModalPago(cp)}
                              >
                                <Banknote className="h-4 w-4 mr-1" />
                                Registrar Pago
                              </Button>
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
        </TabsContent>
      </Tabs>

      {/* ===== Comprobante viewer ===== */}
      <Dialog open={comprobanteDialogOpen} onOpenChange={setComprobanteDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Comprobante / Factura</DialogTitle>
          </DialogHeader>
          {comprobanteUrl && (
            <div className="flex items-center justify-center p-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={comprobanteUrl}
                alt="Comprobante"
                className="max-w-full max-h-[60vh] object-contain rounded-lg shadow-md"
              />
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ===== Modal de Pago / Abono ===== */}
      <Dialog open={pagoDialogOpen} onOpenChange={setPagoDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Registrar Pago</DialogTitle>
            <DialogDescription>
              {pagoTarget?.proveedor || pagoTarget?.concepto || "Gasto"}
            </DialogDescription>
          </DialogHeader>

          {pagoTarget && (
            <div className="grid gap-4 py-2">
              <div className="rounded-xl bg-stone-50 border border-stone-200 p-3">
                <p className="text-xs text-stone-500">Saldo pendiente</p>
                <p className="text-xl font-bold text-red-700">
                  L{" "}
                  {pagoTarget.saldo.toLocaleString("es-HN", {
                    minimumFractionDigits: 2,
                  })}
                </p>
              </div>

              <div className="grid gap-2">
                <Label>
                  Monto a Pagar <span className="text-red-500">*</span>
                </Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  max={pagoTarget.saldo}
                  value={pagoMonto || ""}
                  onChange={(e) => setPagoMonto(parseFloat(e.target.value) || 0)}
                  className="border-stone-200"
                />
                <div className="flex gap-2 text-xs">
                  <button
                    className="text-amber-700 hover:underline"
                    onClick={() =>
                      setPagoMonto(+(pagoTarget.saldo / 2).toFixed(2))
                    }
                  >
                    50%
                  </button>
                  <button
                    className="text-amber-700 hover:underline"
                    onClick={() => setPagoMonto(pagoTarget.saldo)}
                  >
                    Total
                  </button>
                </div>
              </div>

              <div className="grid gap-2">
                <Label>Metodo de Pago</Label>
                <Select
                  value={pagoMetodo}
                  onValueChange={(v) => setPagoMetodo(v as "Efectivo" | "Banco")}
                >
                  <SelectTrigger className="border-stone-200">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Efectivo">
                      <div className="flex items-center gap-2">
                        <Banknote className="h-4 w-4" />
                        Efectivo (Caja Chica)
                      </div>
                    </SelectItem>
                    <SelectItem value="Banco">
                      <div className="flex items-center gap-2">
                        <Building2 className="h-4 w-4" />
                        Cuenta Bancaria
                      </div>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {pagoMetodo === "Banco" && (
                <div className="grid gap-2">
                  <Label>Cuenta de Origen</Label>
                  <Select
                    value={pagoCuenta?.toString() || ""}
                    onValueChange={(v) => setPagoCuenta(parseInt(v))}
                  >
                    <SelectTrigger className="border-stone-200">
                      <SelectValue placeholder="Seleccione cuenta" />
                    </SelectTrigger>
                    <SelectContent>
                      {cuentasBancarias.length === 0 ? (
                        <SelectItem value="0" disabled>
                          Sin cuentas configuradas
                        </SelectItem>
                      ) : (
                        cuentasBancarias.map((c) => (
                          <SelectItem key={c.id} value={c.id!.toString()}>
                            {c.nombre} ({c.tipo})
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {pagoMetodo === "Efectivo" && (
                <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-3 text-xs text-emerald-700">
                  Se registrara una <strong>Salida</strong> en la sesion abierta de
                  Caja Chica.
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setPagoDialogOpen(false)}>
              Cancelar
            </Button>
            <Button
              className="bg-emerald-600 hover:bg-emerald-700"
              onClick={handleGuardarPago}
              disabled={savingPago}
            >
              {savingPago && <Spinner className="h-4 w-4 mr-2" />}
              Guardar Pago
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== Quick Create Proveedor ===== */}
      <Dialog open={nuevoProveedorOpen} onOpenChange={setNuevoProveedorOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Nuevo Proveedor</DialogTitle>
            <DialogDescription>
              Agrega un proveedor rapido para asociarlo a este gasto
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2 py-2">
            <Label>Nombre del Proveedor</Label>
            <Input
              autoFocus
              placeholder="Ej: Distribuidora La Central"
              value={nuevoProveedorNombre}
              onChange={(e) => setNuevoProveedorNombre(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !savingProveedor) handleSaveProveedor()
              }}
              className="border-stone-200"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNuevoProveedorOpen(false)}>
              Cancelar
            </Button>
            <Button
              className="bg-amber-600 hover:bg-amber-700"
              onClick={handleSaveProveedor}
              disabled={savingProveedor}
            >
              {savingProveedor && <Spinner className="h-4 w-4 mr-2" />}
              Crear Proveedor
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== Historial de Abonos ===== */}
      <Dialog open={historialOpen} onOpenChange={setHistorialOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Historial de Abonos</DialogTitle>
            <DialogDescription>
              Gasto #{historialGastoId} - todos los pagos realizados
            </DialogDescription>
          </DialogHeader>
          {loadingHistorial ? (
            <div className="flex items-center justify-center py-8">
              <Spinner className="h-6 w-6 text-amber-600" />
            </div>
          ) : historialPagos.length === 0 ? (
            <Empty className="border-0">
              <EmptyHeader>
                <EmptyMedia>
                  <History className="h-10 w-10 text-stone-300" />
                </EmptyMedia>
                <EmptyTitle>Sin abonos registrados</EmptyTitle>
                <EmptyDescription>
                  Este gasto aun no tiene pagos en caja chica ni en cuentas
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Metodo</TableHead>
                  <TableHead>Cuenta</TableHead>
                  <TableHead className="text-right">Monto</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {historialPagos.map((p) => (
                  <TableRow key={`${p.origen}-${p.id}`}>
                    <TableCell className="text-sm text-stone-600">
                      {formatDateTime(p.fecha_pago)}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={getMetodoBadge(p.metodo_pago)}>
                        {p.metodo_pago}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-stone-600">
                      {p.cuenta_nombre || (
                        <span className="text-stone-400">Caja Chica</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-semibold text-emerald-700">
                      L{" "}
                      {Number(p.monto).toLocaleString("es-HN", {
                        minimumFractionDigits: 2,
                      })}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
