"use client"

import { useEffect, useState, useCallback, useRef } from "react"
import { 
  PackageCheck, 
  Truck,
  DollarSign,
  ArrowRight,
  Calculator,
  Warehouse,
  MapPin,
  CheckCircle2,
  AlertCircle,
  Download,
  Trash2
} from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Spinner } from "@/components/ui/spinner"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useToast } from "@/hooks/use-toast"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import {
  type CompraEncabezado,
  type CompraDetalle,
  type ProrrateoResultado,
  getCompras,
  getDetallesCompra,
  procesarRecepcion,
  calcularProrrateoDetallado,
  deleteCompra,
  getCompraById
} from "@/lib/services/compras"
import { getRecepcionesCompra, cerrarBackorder, type Recepcion } from "@/lib/services/compras-recepciones"
import { DesgloseProrrateo } from "@/components/recepcion/desglose-prorrateo"
import { type Proveedor, getProveedores, type Producto, getProductos } from "@/lib/services/catalogos"
import { getRazonSocialForPdf } from "@/lib/services/ventas"
import { hoyISO } from "@/lib/utils/fecha"
import { type Almacen, type Localizacion, getAlmacenes, getLocalizaciones } from "@/lib/services/catalogos"
import { type CuentaConfig, getCuentas } from "@/lib/services/cuentas"
import { usePersistentDraft } from "@/lib/hooks/use-persistent-draft"

/**
 * Borrador persistente de una recepción por orden de compra: la OC elegida y lo
 * capturado (costos extra, tasa, destino, overrides y forma de pago). Sobrevive
 * a cerrar el sistema a mitad de la recepción.
 */
interface RecepcionOCDraft {
  compraId: number
  formData: {
    costos_importacion: number
    impuestos_compra: number
    otros_costos: number
    tasa_cambio: number
    almacen_id: number
    localizacion_id: number
  }
  overrides: Record<number, { cantidad?: number; costo?: number; precio?: number }>
  pagoMetodo: 'Efectivo' | 'Banco' | 'Credito'
  pagoCuentaId: number | null
  /** Factura del proveedor y días de crédito de esta recepción (officemart-008). */
  numeroFacturaProv?: string
  diasCredito?: string
}

export default function RecepcionPage() {
  const [comprasPendientes, setComprasPendientes] = useState<CompraEncabezado[]>([])
  const [proveedores, setProveedores] = useState<Proveedor[]>([])
  const [almacenes, setAlmacenes] = useState<Almacen[]>([])
  const [localizaciones, setLocalizaciones] = useState<Localizacion[]>([])
  const [loading, setLoading] = useState(true)
  const [processing, setProcessing] = useState(false)
  const [deleting, setDeleting] = useState<number | null>(null)
  
  // Selected purchase
  const [selectedCompra, setSelectedCompra] = useState<CompraEncabezado | null>(null)
  const [detalles, setDetalles] = useState<CompraDetalle[]>([])
  const [loadingDetalles, setLoadingDetalles] = useState(false)
  
  // Reception form
  const [formData, setFormData] = useState({
    costos_importacion: 0,
    impuestos_compra: 0,
    otros_costos: 0,
    tasa_cambio: 1,
    almacen_id: 0,
    localizacion_id: 0
  })
  
  // Calculated costs
  const [costosCalculados, setCostosCalculados] = useState<{
    detalle_id: number
    producto_id: number
    cantidad: number
    costo_final_local: number
  }[]>([])
  // Desglose detallado del prorrateo (para mostrarlo explicitamente).
  const [prorrateo, setProrrateo] = useState<ProrrateoResultado | null>(null)

  // Productos por id (para costo/precio ANTERIOR y precio de venta editable).
  const [productosById, setProductosById] = useState<Map<number, Producto>>(new Map())
  // Overrides editables por detalle_id: cantidad, costo final y precio de venta.
  const [overrides, setOverrides] = useState<Record<number, { cantidad?: number; costo?: number; precio?: number }>>({})

  // Pago de la recepción.
  const [cuentas, setCuentas] = useState<CuentaConfig[]>([])
  const [pagoMetodo, setPagoMetodo] = useState<'Efectivo' | 'Banco' | 'Credito'>('Credito')
  const [pagoCuentaId, setPagoCuentaId] = useState<number | null>(null)
  // Recepciones parciales (officemart-008): recepciones previas de la OC,
  // factura del proveedor y días de crédito de ESTA recepción.
  const [recepcionesPrevias, setRecepcionesPrevias] = useState<Recepcion[]>([])
  const [numeroFacturaProv, setNumeroFacturaProv] = useState("")
  const [diasCredito, setDiasCredito] = useState("")
  const [cerrandoBackorder, setCerrandoBackorder] = useState(false)

  const { toast } = useToast()

  // Borrador persistente (retomar una recepción si se cerró el sistema).
  const draft = usePersistentDraft<RecepcionOCDraft>("recepcion-oc")
  const draftRestored = useRef(false)
  // Localización pendiente por aplicar tras cargar las del almacén (el efecto de
  // abajo pone localización en 0 al cambiar de almacén).
  const pendingLocalizacionId = useRef<number | null>(null)
  // Overrides/pago pendientes por aplicar cuando terminen de cargar los detalles.
  const pendingRestore = useRef<RecepcionOCDraft | null>(null)

  const fetchData = useCallback(async () => {
    setLoading(true)
    const [comprasRes, almRes, provRes, prodRes, cuentasRes] = await Promise.all([
      getCompras('Pendiente'),
      getAlmacenes(),
      getProveedores(),
      getProductos(),
      getCuentas(),
    ])

    if (comprasRes.error) {
      toast({ title: "Error", description: comprasRes.error, variant: "destructive" })
    }
    setComprasPendientes(comprasRes.data)
    setAlmacenes(almRes.data)
    setProveedores(provRes.data)
    const mapa = new Map<number, Producto>()
    for (const p of prodRes.data || []) if (p.id != null) mapa.set(p.id, p)
    setProductosById(mapa)
    setCuentas(cuentasRes.data || [])
    setLoading(false)
  }, [toast])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  // Fetch locations when warehouse changes
  useEffect(() => {
    if (formData.almacen_id) {
      getLocalizaciones(formData.almacen_id).then(res => {
        setLocalizaciones(res.data)
        // Al restaurar un borrador, conserva la localización guardada si existe.
        const pend = pendingLocalizacionId.current
        pendingLocalizacionId.current = null
        const loc = pend != null && res.data.some(l => l.id === pend) ? pend : 0
        setFormData(prev => ({ ...prev, localizacion_id: loc }))
      })
    } else {
      setLocalizaciones([])
    }
  }, [formData.almacen_id])

  // Recalculate costs when values change. El prorrateo se hace SOLO sobre lo
  // que se recibe en esta recepción (pendiente por línea, o la cantidad
  // editada), no sobre lo ordenado: así cada recepción parcial carga sus
  // propios costos extra (officemart-008).
  useEffect(() => {
    if (detalles.length > 0 && selectedCompra) {
      const costosAdicionales = formData.costos_importacion + formData.impuestos_compra + formData.otros_costos
      const tasa = selectedCompra.moneda === 'USD' ? formData.tasa_cambio : 1
      const efectivos = detalles.map((d) => {
        const pendiente = Math.max(0, +(d.cantidad - (d.cantidad_recibida || 0)).toFixed(4))
        const ov = d.id != null ? overrides[d.id] : undefined
        return { ...d, cantidad: ov?.cantidad != null ? ov.cantidad : pendiente }
      })

      const detallado = calcularProrrateoDetallado(
        efectivos,
        costosAdicionales,
        selectedCompra.moneda,
        tasa
      )
      setProrrateo(detallado)
      setCostosCalculados(
        detallado.lineas.map((l) => ({
          detalle_id: l.detalle_id,
          producto_id: l.producto_id,
          cantidad: l.cantidad,
          costo_final_local: l.costo_final_unitario,
        }))
      )
    } else {
      setProrrateo(null)
    }
  }, [detalles, overrides, formData.costos_importacion, formData.impuestos_compra, formData.otros_costos, formData.tasa_cambio, selectedCompra])

  // Rehidratación del borrador (una sola vez): re-selecciona la OC guardada y
  // aplica lo capturado. Los overrides/pago se aplican cuando cargan los detalles.
  useEffect(() => {
    if (draftRestored.current || !draft.ready || loading) return
    const d = draft.value
    if (!d || !d.compraId) { draftRestored.current = true; return }
    const compra = comprasPendientes.find(c => c.id === d.compraId)
    // Si la OC ya no está pendiente (se recibió/eliminó), descartamos el borrador.
    if (!compra) { draftRestored.current = true; draft.clear(); return }
    draftRestored.current = true

    setSelectedCompra(compra)
    setLoadingDetalles(true)
    pendingRestore.current = d
    pendingLocalizacionId.current = d.formData?.localizacion_id || null
    setFormData({
      costos_importacion: d.formData?.costos_importacion ?? 0,
      impuestos_compra: d.formData?.impuestos_compra ?? 0,
      otros_costos: d.formData?.otros_costos ?? 0,
      tasa_cambio: d.formData?.tasa_cambio ?? (compra.moneda === 'USD' ? 24.5 : 1),
      almacen_id: d.formData?.almacen_id ?? 0,
      localizacion_id: 0,
    })
    getDetallesCompra(compra.id!).then(({ data }) => {
      setDetalles(data)
      setLoadingDetalles(false)
    })
    toast({
      title: "Recepción retomada",
      description: "Recuperamos la recepción que tenías en curso. Puedes continuar o descartarla.",
    })
  }, [draft.ready, draft.value, loading, comprasPendientes, toast])

  // Aplica overrides/pago del borrador cuando los detalles ya cargaron.
  useEffect(() => {
    const pend = pendingRestore.current
    if (!pend || detalles.length === 0) return
    pendingRestore.current = null
    setOverrides(pend.overrides || {})
    setPagoMetodo(pend.pagoMetodo || 'Credito')
    setPagoCuentaId(pend.pagoCuentaId ?? null)
    setNumeroFacturaProv(pend.numeroFacturaProv || "")
    setDiasCredito(pend.diasCredito || "")
  }, [detalles])

  // Guarda el borrador ante cambios relevantes (debounced dentro del hook).
  useEffect(() => {
    // Esperamos a que la rehidratación inicial haya corrido para no pisar un
    // borrador válido antes de restaurarlo.
    if (!draft.ready || !draftRestored.current) return
    if (!selectedCompra?.id) {
      // Sin OC seleccionada no hay recepción en curso.
      draft.clear()
      return
    }
    // No guardamos mientras aún estamos rehidratando (evita pisar el borrador).
    if (pendingRestore.current) return
    draft.save({
      compraId: selectedCompra.id,
      formData,
      overrides,
      pagoMetodo,
      pagoCuentaId,
      numeroFacturaProv,
      diasCredito,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.ready, selectedCompra, formData, overrides, pagoMetodo, pagoCuentaId, numeroFacturaProv, diasCredito])

  const handleSelectCompra = async (compra: CompraEncabezado) => {
    setSelectedCompra(compra)
    setLoadingDetalles(true)
    
    // Reset form
    setFormData({
      costos_importacion: 0,
      impuestos_compra: 0,
      otros_costos: 0,
      tasa_cambio: compra.moneda === 'USD' ? 24.5 : 1,
      almacen_id: 0,
      localizacion_id: 0
    })
    setOverrides({})
    setPagoMetodo('Credito')
    setPagoCuentaId(null)
    setNumeroFacturaProv("")
    setDiasCredito("")
    setRecepcionesPrevias([])

    const [{ data, error }, previas] = await Promise.all([getDetallesCompra(compra.id!), getRecepcionesCompra(compra.id!)])
    if (error) {
      toast({ title: "Error", description: error, variant: "destructive" })
    }
    setDetalles(data)
    setRecepcionesPrevias(previas.data)
    setLoadingDetalles(false)
  }

  // Cierra lo pendiente de la OC seleccionada (backorder que no llegará).
  const handleCerrarBackorder = async () => {
    if (!selectedCompra?.id) return
    const motivo = window.prompt("Motivo del cierre (lo pendiente ya no llegará):")
    if (motivo == null) return
    setCerrandoBackorder(true)
    const { error } = await cerrarBackorder(selectedCompra.id, motivo)
    setCerrandoBackorder(false)
    if (error) {
      toast({ title: "No se pudo cerrar", description: error, variant: "destructive" })
      return
    }
    toast({ title: "Pendiente cerrado", description: `OC-${selectedCompra.id} queda Recibida con lo que entró.` })
    descartarRecepcion()
    fetchData()
  }

  // Descarta la recepción en curso (deselecciona la OC y borra el borrador).
  const descartarRecepcion = () => {
    setSelectedCompra(null)
    setDetalles([])
    setCostosCalculados([])
    setOverrides({})
    draft.clear()
  }

  const handleProcessRecepcion = async () => {
    if (!selectedCompra) return
    
    if (!formData.almacen_id || !formData.localizacion_id) {
      toast({ title: "Error", description: "Seleccione almacen y localizacion", variant: "destructive" })
      return
    }
    
    if (selectedCompra.moneda === 'USD' && formData.tasa_cambio <= 0) {
      toast({ title: "Error", description: "Ingrese una tasa de cambio valida", variant: "destructive" })
      return
    }

    if (pagoMetodo === 'Banco' && !pagoCuentaId) {
      toast({ title: "Falta la cuenta", description: "Elige la cuenta bancaria del pago.", variant: "destructive" })
      return
    }

    // Cantidades a recibir: nunca más de lo pendiente por línea; al menos una > 0.
    const lineasRecibir = costosCalculados.map(c => {
      const det = detalles.find((d) => d.id === c.detalle_id)
      const pendiente = det ? Math.max(0, +(det.cantidad - (det.cantidad_recibida || 0)).toFixed(4)) : c.cantidad
      const ov = overrides[c.detalle_id] || {}
      return {
        detalle_id: c.detalle_id,
        producto_id: c.producto_id,
        cantidad_recibida: ov.cantidad != null ? ov.cantidad : pendiente,
        pendiente,
        nombre: det?.producto_nombre || `#${c.producto_id}`,
        costo_final_local: ov.costo != null ? ov.costo : c.costo_final_local,
        precio_venta: ov.precio != null && ov.precio > 0 ? ov.precio : null,
      }
    })
    const exceso = lineasRecibir.find((l) => l.cantidad_recibida > l.pendiente + 0.0001)
    if (exceso) {
      toast({ title: "Cantidad mayor a lo pendiente", description: `${exceso.nombre}: solo faltan ${exceso.pendiente}.`, variant: "destructive" })
      return
    }
    if (!lineasRecibir.some((l) => l.cantidad_recibida > 0)) {
      toast({ title: "Nada que recibir", description: "Indica al menos una cantidad mayor a 0.", variant: "destructive" })
      return
    }
    const esParcial = lineasRecibir.some((l) => l.cantidad_recibida < l.pendiente - 0.0001)

    setProcessing(true)

    const recepcionData = {
      compraId: selectedCompra.id!,
      costos_importacion: formData.costos_importacion,
      impuestos_compra: formData.impuestos_compra,
      otros_costos: formData.otros_costos,
      tasa_cambio: formData.tasa_cambio,
      almacen_id: formData.almacen_id,
      localizacion_id: formData.localizacion_id,
      numero_factura_proveedor: numeroFacturaProv.trim() || null,
      detalles: lineasRecibir.map(({ pendiente: _p, nombre: _n, ...l }) => l),
      pago: {
        metodo: pagoMetodo,
        cuenta_id: pagoMetodo === 'Banco' ? pagoCuentaId : null,
        proveedor_id: selectedCompra.proveedor_id ?? null,
        dias_credito: pagoMetodo === 'Credito' && diasCredito.trim() !== "" ? Number(diasCredito) : null,
      },
    }

    const { success, error } = await procesarRecepcion(recepcionData)
    setProcessing(false)

    if (error) {
      toast({ title: success ? "Recepción con avisos" : "Error", description: error, variant: success ? "default" : "destructive" })
      if (!success) return
    }
    if (success) {
      if (!error) toast({
        title: esParcial ? "Recepción parcial registrada" : "Recepcion Exitosa",
        description: esParcial
          ? "Entró lo indicado; el resto queda como backorder (la orden sigue Pendiente)."
          : "La mercancia ha sido ingresada al inventario y los costos actualizados",
      })
      setSelectedCompra(null)
      setDetalles([])
      setCostosCalculados([])
      draft.clear()
      fetchData()
    }
  }

  // PDF Generation for Purchase Order
  const generateOrdenCompraPDF = async (compraId: number, e?: React.MouseEvent) => {
    e?.stopPropagation()
    
    const [compraRes, detallesRes, razonSocial] = await Promise.all([
      getCompraById(compraId),
      getDetallesCompra(compraId),
      getRazonSocialForPdf()
    ])
    
    if (compraRes.error || !compraRes.data) {
      toast({ title: "Error", description: "No se pudo cargar la orden", variant: "destructive" })
      return
    }
    
    const compra = compraRes.data
    const detallesCompra = detallesRes.data
    const proveedor = proveedores.find(p => p.id === compra.proveedor_id)

    // jsPDF + autoTable dinámicos: solo al generar el PDF.
    const { jsPDF } = await import("jspdf")
    const autoTable = (await import("jspdf-autotable")).default
    const doc = new jsPDF()
    const pageWidth = doc.internal.pageSize.getWidth()
    
    // Header
    doc.setFontSize(16)
    doc.setFont("helvetica", "bold")
    doc.text(razonSocial?.nombre_empresa || "Mi Empresa", pageWidth / 2, 18, { align: "center" })
    
    doc.setFontSize(9)
    doc.setFont("helvetica", "normal")
    if (razonSocial?.nombre_comercial) {
      doc.text(razonSocial.nombre_comercial, pageWidth / 2, 24, { align: "center" })
    }
    doc.text(`RTN: ${razonSocial?.documento || "N/A"}`, pageWidth / 2, 30, { align: "center" })
    doc.text(razonSocial?.direccion || "", pageWidth / 2, 36, { align: "center" })
    doc.text(`Tel: ${razonSocial?.telefono || ""} | ${razonSocial?.correo || ""}`, pageWidth / 2, 42, { align: "center" })
    
    // Title
    doc.setFillColor(192, 122, 92)
    doc.rect(0, 48, pageWidth, 10, "F")
    doc.setTextColor(255, 255, 255)
    doc.setFontSize(12)
    doc.setFont("helvetica", "bold")
    doc.text("ORDEN DE COMPRA", pageWidth / 2, 55, { align: "center" })
    
    // Order Info
    doc.setTextColor(0, 0, 0)
    doc.setFontSize(10)
    doc.setFont("helvetica", "bold")
    const orderNumber = `OC-${String(compra.id).padStart(5, '0')}`
    doc.text(`No: ${orderNumber}`, 15, 68)
    doc.setFont("helvetica", "normal")
    doc.text(`Fecha: ${compra.fecha_orden?.split('T')[0] || hoyISO()}`, pageWidth - 15, 68, { align: "right" })
    
    // Supplier Info
    doc.setDrawColor(200, 200, 200)
    doc.roundedRect(15, 74, pageWidth - 30, 24, 2, 2, "S")
    doc.setFontSize(9)
    doc.setFont("helvetica", "bold")
    doc.text("Proveedor:", 20, 82)
    doc.setFont("helvetica", "normal")
    doc.text(proveedor?.nombre || compra.proveedor_nombre || "N/A", 48, 82)
    doc.setFont("helvetica", "bold")
    doc.text("RTN:", 20, 89)
    doc.setFont("helvetica", "normal")
    doc.text(proveedor?.rtn || "N/A", 32, 89)
    doc.setFont("helvetica", "bold")
    doc.text("Fecha Entrega:", 100, 89)
    doc.setFont("helvetica", "normal")
    doc.text(compra.fecha_tentativa || "N/A", 134, 89)
    doc.setFont("helvetica", "bold")
    doc.text("Moneda:", 20, 95)
    doc.setFont("helvetica", "normal")
    doc.text(compra.moneda === 'USD' ? 'Dolares (USD)' : 'Lempiras (LPS)', 42, 95)
    
    // Products Table
    const tableData = detallesCompra.map(d => [
      d.cantidad.toString(),
      d.producto_codigo || "",
      (d.producto_nombre || "").substring(0, 35),
      `${compra.moneda === 'USD' ? '$' : 'L'} ${(d.costo_unitario_moneda_origen ?? 0).toFixed(2)}`,
      `${compra.moneda === 'USD' ? '$' : 'L'} ${(d.cantidad * d.costo_unitario_moneda_origen).toFixed(2)}`
    ])
    
    autoTable(doc, {
      startY: 104,
      head: [["Cant.", "Codigo", "Descripcion", "Costo Unit.", "Subtotal"]],
      body: tableData,
      theme: "striped",
      headStyles: { fillColor: [192, 122, 92], textColor: 255, fontStyle: "bold", fontSize: 9 },
      bodyStyles: { fontSize: 9 },
      columnStyles: {
        0: { halign: "center", cellWidth: 15 },
        1: { cellWidth: 25 },
        2: { cellWidth: "auto" },
        3: { halign: "right", cellWidth: 28 },
        4: { halign: "right", cellWidth: 28 }
      },
      margin: { left: 15, right: 15 }
    })
    
    const finalY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 10
    doc.setDrawColor(200, 200, 200)
    doc.line(pageWidth - 80, finalY - 5, pageWidth - 15, finalY - 5)
    doc.setFontSize(10)
    doc.setFont("helvetica", "bold")
    doc.text("TOTAL:", pageWidth - 70, finalY)
    doc.text(`${compra.moneda === 'USD' ? '$' : 'L'} ${(compra.total ?? 0).toFixed(2)}`, pageWidth - 15, finalY, { align: "right" })
    
    doc.setFontSize(8)
    doc.setFont("helvetica", "normal")
    doc.setTextColor(100, 100, 100)
    doc.text("Nota: Favor enviar mercancia segun especificaciones", 15, finalY + 20)
    doc.text("Confirmar entrega con anticipacion", 15, finalY + 26)
    
    // Watermark EasyCount
    const pageHeight = doc.internal.pageSize.getHeight()
    doc.setFontSize(7)
    doc.setFont("helvetica", "normal")
    doc.setTextColor(168, 162, 158)
    doc.text("Generado por EasyCount", pageWidth / 2, pageHeight - 8, { align: "center" })
    
    const filename = `OrdenCompra_${orderNumber}.pdf`
    try {
      const pdfBlob = doc.output('blob')
      const blobUrl = URL.createObjectURL(pdfBlob)
      const link = document.createElement('a')
      link.href = blobUrl
      link.download = filename
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      setTimeout(() => URL.revokeObjectURL(blobUrl), 100)
    } catch {
      doc.save(filename)
    }
  }

  const handleDeleteCompra = async (compraId: number, e?: React.MouseEvent) => {
    e?.stopPropagation()
    
    if (!confirm("¿Esta seguro de eliminar esta orden de compra? Esta accion no se puede deshacer.")) {
      return
    }
    
    setDeleting(compraId)
    const { success, error } = await deleteCompra(compraId)
    setDeleting(null)
    
    if (error) {
      toast({ title: "Error", description: error, variant: "destructive" })
    } else if (success) {
      toast({ title: "Eliminada", description: "La orden de compra ha sido eliminada" })
      if (selectedCompra?.id === compraId) {
        setSelectedCompra(null)
        setDetalles([])
        setCostosCalculados([])
        draft.clear()
      }
      fetchData()
    }
  }

  const formatCurrency = (value: number, moneda: string = "LPS") => {
    const prefix = moneda === "USD" ? "$ " : "L "
    return prefix + value.toLocaleString("es-HN", { minimumFractionDigits: 2 })
  }

  // Valores efectivos por línea (con overrides) + derivados (margen, utilidad,
  // costo/precio anteriores). costoFinalCalc = prorrateo por defecto.
  function calcLinea(d: CompraDetalle, idx: number) {
    const prod = d.producto_id != null ? productosById.get(d.producto_id) : undefined
    const ov = d.id != null ? overrides[d.id] : undefined
    const costoDefault = costosCalculados[idx]?.costo_final_local
      ?? d.costo_unitario_moneda_origen * (selectedCompra?.moneda === "USD" ? formData.tasa_cambio : 1)
    // Por defecto se recibe lo PENDIENTE (ordenado − ya recibido en
    // recepciones previas); el usuario puede bajar la cantidad (parcial).
    const recibido = d.cantidad_recibida || 0
    const pendiente = Math.max(0, +(d.cantidad - recibido).toFixed(4))
    const cantidad = ov?.cantidad != null ? ov.cantidad : pendiente
    const costo = ov?.costo != null ? ov.costo : +costoDefault.toFixed(4)
    const precioAnterior = prod?.precio_venta_sugerido ?? 0
    const precio = ov?.precio != null ? ov.precio : precioAnterior
    const costoAnterior = prod?.costo_promedio ?? 0
    const utilidad = +(precio - costo).toFixed(2)
    const margen = precio > 0 ? +(((precio - costo) / precio) * 100).toFixed(1) : 0
    return { cantidad, costo, precio, precioAnterior, costoAnterior, utilidad, margen, ordenado: d.cantidad, recibido, pendiente }
  }

  function setOverride(detalleId: number, patch: { cantidad?: number; costo?: number; precio?: number }) {
    setOverrides((prev) => ({ ...prev, [detalleId]: { ...prev[detalleId], ...patch } }))
  }

  const formatDate = (date?: string | null) => {
    if (!date) return "—"
    return new Date(date).toLocaleDateString("es-HN", {
      timeZone: "UTC", // fecha_orden se guarda HN-as-UTC (dia de negocio)
      year: "numeric",
      month: "short",
      day: "numeric"
    })
  }

  const calcularTotales = () => {
    const subtotalOriginal = detalles.reduce((acc, d) => acc + (d.cantidad * d.costo_unitario_moneda_origen), 0)
    const subtotalLPS = selectedCompra?.moneda === 'USD' 
      ? subtotalOriginal * formData.tasa_cambio 
      : subtotalOriginal
    const costosAdicionales = formData.costos_importacion + formData.impuestos_compra + formData.otros_costos
    const totalFinal = subtotalLPS + costosAdicionales
    
    return { subtotalOriginal, subtotalLPS, costosAdicionales, totalFinal }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Spinner className="h-8 w-8" />
      </div>
    )
  }

  return (
    <div className="space-y-4 md:space-y-6">
      <div>
        <h1 className="text-xl md:text-2xl font-semibold text-foreground">Recepcion de Mercancia</h1>
        <p className="text-sm md:text-base text-muted-foreground">Procese la recepcion de compras pendientes y calcule el prorrateo de costos</p>
      </div>

      <div className="grid gap-4 md:gap-6 lg:grid-cols-3">
        {/* Pending Orders List */}
        <Card className="lg:col-span-1">
          <CardHeader className="p-4 md:p-6">
            <CardTitle className="text-base flex items-center gap-2">
              <Truck className="h-4 w-4" />
              Compras Pendientes
            </CardTitle>
            <CardDescription className="text-xs md:text-sm">Seleccione una orden para procesar</CardDescription>
          </CardHeader>
          <CardContent className="p-4 md:p-6 pt-0 space-y-2">
            {comprasPendientes.length === 0 ? (
              <div className="text-center py-8">
                <CheckCircle2 className="h-12 w-12 text-muted-foreground/30 mx-auto mb-3" />
                <p className="text-muted-foreground">No hay compras pendientes</p>
              </div>
            ) : (
              comprasPendientes.map((compra) => (
                <div
                  key={compra.id}
                  className={`rounded-lg border p-3 cursor-pointer transition-colors ${
                    selectedCompra?.id === compra.id 
                      ? "bg-primary/10 border-primary" 
                      : "hover:bg-muted"
                  }`}
                  onClick={() => handleSelectCompra(compra)}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-medium text-sm">OC-{String(compra.id).padStart(5, '0')}</span>
                    <Badge variant="secondary">{compra.moneda}</Badge>
                  </div>
                  <p className="text-sm text-muted-foreground truncate">{compra.proveedor_nombre}</p>
                  <div className="flex items-center justify-between mt-2">
                    <span className="text-xs text-muted-foreground">{formatDate(compra.fecha_orden)}</span>
                    <span className="text-sm font-medium">{formatCurrency(compra.total || 0, compra.moneda)}</span>
                  </div>
                  {/* Action buttons */}
                  <div className="flex items-center gap-1 mt-2 pt-2 border-t">
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1 h-8 text-xs gap-1"
                      onClick={(e) => generateOrdenCompraPDF(compra.id!, e)}
                    >
                      <Download className="h-3.5 w-3.5" />
                      PDF
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1 h-8 text-xs gap-1 text-destructive hover:bg-destructive/10"
                      onClick={(e) => handleDeleteCompra(compra.id!, e)}
                      disabled={deleting === compra.id}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      {deleting === compra.id ? "..." : "Eliminar"}
                    </Button>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        {/* Reception Panel */}
        <Card className="lg:col-span-2">
          <CardHeader className="p-4 md:p-6">
            <CardTitle className="text-base flex items-center gap-2">
              <PackageCheck className="h-4 w-4" />
              Procesar Recepcion
            </CardTitle>
            <CardDescription className="text-xs md:text-sm">
              {selectedCompra 
                ? `Orden OC-${String(selectedCompra.id).padStart(5, '0')} - ${selectedCompra.proveedor_nombre}`
                : "Seleccione una orden de compra"
              }
            </CardDescription>
          </CardHeader>
          <CardContent className="p-4 md:p-6">
            {!selectedCompra ? (
              <div className="text-center py-12">
                <AlertCircle className="h-12 w-12 text-muted-foreground/30 mx-auto mb-3" />
                <p className="text-muted-foreground">Seleccione una orden de compra de la lista</p>
              </div>
            ) : loadingDetalles ? (
              <div className="flex items-center justify-center py-12">
                <Spinner className="h-8 w-8" />
              </div>
            ) : (
              <div className="space-y-4 md:space-y-6">
                {/* Recepciones previas de la OC (recepción parcial en curso). */}
                {recepcionesPrevias.length > 0 && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
                    <p className="font-medium text-amber-900 mb-1">
                      Esta orden ya tiene {recepcionesPrevias.length} recepción(es); lo que se muestra abajo es lo PENDIENTE.
                    </p>
                    <ul className="text-xs text-amber-900/80 space-y-0.5">
                      {recepcionesPrevias.map((r) => (
                        <li key={r.id}>
                          #{r.numero} · {formatDate(r.fecha)} · {formatCurrency(r.total_local, "LPS")}
                          {r.numero_factura_proveedor ? ` · factura ${r.numero_factura_proveedor}` : ""}
                          {r.detalle && r.detalle.length > 0 ? ` · ${r.detalle.map((d) => `${d.producto_nombre || d.producto_id} ×${d.cantidad}`).join(", ")}` : ""}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Products — mobile cards + desktop table */}
                <div>
                  <h4 className="text-sm font-medium mb-3">Productos a Recibir</h4>

                  {/* Mobile */}
                  <div className="block md:hidden space-y-2">
                    {detalles.map((d, idx) => {
                      const lc = calcLinea(d, idx)
                      return (
                      <div key={d.id} className="border rounded-lg p-3 bg-card text-sm">
                        <p className="font-medium">{d.producto_nombre}</p>
                        <p className="text-xs text-muted-foreground font-mono mb-2">{d.producto_codigo}</p>
                        <div className="grid grid-cols-3 gap-2 text-xs">
                          <div>
                            <p className="text-muted-foreground">Recibir (pend. {lc.pendiente}{lc.recibido > 0 ? ` de ${lc.ordenado}` : ""})</p>
                            <Input type="number" min="0" max={lc.pendiente} step="1" value={lc.cantidad}
                              onChange={(e) => d.id != null && setOverride(d.id, { cantidad: parseFloat(e.target.value) || 0 })}
                              className="h-8" />
                          </div>
                          <div>
                            <p className="text-muted-foreground">Costo (LPS)</p>
                            <Input type="number" min="0" step="0.01" value={lc.costo}
                              onChange={(e) => d.id != null && setOverride(d.id, { costo: parseFloat(e.target.value) || 0 })}
                              className="h-8" />
                          </div>
                          <div>
                            <p className="text-muted-foreground">Precio venta</p>
                            <Input type="number" min="0" step="0.01" value={lc.precio}
                              onChange={(e) => d.id != null && setOverride(d.id, { precio: parseFloat(e.target.value) || 0 })}
                              className="h-8" />
                          </div>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                          <span className={lc.margen < 0 ? "text-destructive" : "text-emerald-600"}>Margen: {lc.precio > 0 ? `${lc.margen}%` : "—"}</span>
                          <span>Utilidad u.: {lc.precio > 0 ? formatCurrency(lc.utilidad, "LPS") : "—"}</span>
                          <span>Costo ant.: {formatCurrency(lc.costoAnterior, "LPS")}</span>
                          <span>Precio ant.: {lc.precioAnterior > 0 ? formatCurrency(lc.precioAnterior, "LPS") : "—"}</span>
                        </div>
                      </div>
                      )
                    })}
                  </div>

                  {/* Desktop */}
                  <Table className="hidden md:table" containerClassName="max-h-[60vh] overflow-y-auto">
                    <TableHeader sticky>
                      <TableRow>
                        <TableHead>Producto</TableHead>
                        <TableHead className="text-right w-20">Ordenado</TableHead>
                        <TableHead className="text-right w-20">Recibido</TableHead>
                        <TableHead className="text-right w-24">Recibir</TableHead>
                        <TableHead className="text-right w-28">Costo (LPS)</TableHead>
                        <TableHead className="text-right w-28">Precio venta</TableHead>
                        <TableHead className="text-right w-24">Margen</TableHead>
                        <TableHead className="text-right w-24">Utilidad u.</TableHead>
                        <TableHead className="text-right w-28">Costo ant.</TableHead>
                        <TableHead className="text-right w-28">Precio ant.</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {detalles.map((d, idx) => {
                        const lc = calcLinea(d, idx)
                        return (
                        <TableRow key={d.id}>
                          <TableCell>
                            <div>
                              <p className="font-medium">{d.producto_nombre}</p>
                              <p className="text-xs text-muted-foreground">{d.producto_codigo}</p>
                            </div>
                          </TableCell>
                          <TableCell className="text-right text-muted-foreground">{lc.ordenado}</TableCell>
                          <TableCell className={`text-right ${lc.recibido > 0 ? "text-emerald-700" : "text-muted-foreground"}`}>{lc.recibido}</TableCell>
                          <TableCell className="text-right">
                            <Input
                              type="number" min="0" max={lc.pendiente} step="1"
                              value={lc.cantidad}
                              onChange={(e) => d.id != null && setOverride(d.id, { cantidad: parseFloat(e.target.value) || 0 })}
                              className={`h-8 w-20 text-right ml-auto ${lc.cantidad > lc.pendiente ? "border-destructive" : ""}`}
                              title={`Pendiente: ${lc.pendiente}`}
                            />
                          </TableCell>
                          <TableCell className="text-right">
                            <Input
                              type="number" min="0" step="0.01"
                              value={lc.costo}
                              onChange={(e) => d.id != null && setOverride(d.id, { costo: parseFloat(e.target.value) || 0 })}
                              className="h-8 w-24 text-right ml-auto"
                            />
                          </TableCell>
                          <TableCell className="text-right">
                            <Input
                              type="number" min="0" step="0.01"
                              value={lc.precio}
                              onChange={(e) => d.id != null && setOverride(d.id, { precio: parseFloat(e.target.value) || 0 })}
                              className="h-8 w-24 text-right ml-auto"
                            />
                          </TableCell>
                          <TableCell className={`text-right font-medium ${lc.margen < 0 ? "text-destructive" : lc.margen > 0 ? "text-emerald-600" : ""}`}>
                            {lc.precio > 0 ? `${lc.margen}%` : "—"}
                          </TableCell>
                          <TableCell className={`text-right ${lc.utilidad < 0 ? "text-destructive" : ""}`}>
                            {lc.precio > 0 ? formatCurrency(lc.utilidad, "LPS") : "—"}
                          </TableCell>
                          <TableCell className="text-right text-muted-foreground">{formatCurrency(lc.costoAnterior, "LPS")}</TableCell>
                          <TableCell className="text-right text-muted-foreground">{lc.precioAnterior > 0 ? formatCurrency(lc.precioAnterior, "LPS") : "—"}</TableCell>
                        </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </div>

                <Separator />

                {/* Additional Costs */}
                <div className="space-y-4">
                  <h4 className="text-sm font-medium flex items-center gap-2">
                    <Calculator className="h-4 w-4" />
                    Costos Adicionales y Prorrateo
                  </h4>
                  
                  <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                    {selectedCompra.moneda === 'USD' && (
                      <div className="grid gap-2">
                        <Label className="text-xs">Tasa de Cambio (USD a LPS)</Label>
                        <Input
                          type="number"
                          step="0.01"
                          value={formData.tasa_cambio}
                          onChange={(e) => setFormData({ ...formData, tasa_cambio: Number(e.target.value) })}
                        />
                      </div>
                    )}
                    <div className="grid gap-2">
                      <Label className="text-xs">Costos Importacion (LPS)</Label>
                      <Input
                        type="number"
                        step="0.01"
                        value={formData.costos_importacion}
                        onChange={(e) => setFormData({ ...formData, costos_importacion: Number(e.target.value) })}
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label className="text-xs">Impuestos Compra (LPS)</Label>
                      <Input
                        type="number"
                        step="0.01"
                        value={formData.impuestos_compra}
                        onChange={(e) => setFormData({ ...formData, impuestos_compra: Number(e.target.value) })}
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label className="text-xs">Otros Costos (LPS)</Label>
                      <Input
                        type="number"
                        step="0.01"
                        value={formData.otros_costos}
                        onChange={(e) => setFormData({ ...formData, otros_costos: Number(e.target.value) })}
                      />
                    </div>
                  </div>
                </div>

                {/* Desglose explicito del prorrateo */}
                {prorrateo && prorrateo.lineas.length > 0 && (
                  <DesgloseProrrateo resultado={prorrateo} />
                )}

                <Separator />

                {/* Warehouse Selection */}
                <div className="space-y-4">
                  <h4 className="text-sm font-medium flex items-center gap-2">
                    <Warehouse className="h-4 w-4" />
                    Destino de Mercancia
                  </h4>
                  
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="grid gap-2">
                      <Label className="text-xs flex items-center gap-1">
                        <Warehouse className="h-3 w-3" />
                        Almacen
                      </Label>
                      <Select 
                        value={formData.almacen_id ? String(formData.almacen_id) : ""} 
                        onValueChange={(v) => setFormData({ ...formData, almacen_id: Number(v) })}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Seleccione almacen" />
                        </SelectTrigger>
                        <SelectContent>
                          {almacenes.map(a => (
                            <SelectItem key={a.id} value={String(a.id)}>{a.nombre}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid gap-2">
                      <Label className="text-xs flex items-center gap-1">
                        <MapPin className="h-3 w-3" />
                        Localizacion
                      </Label>
                      <Select 
                        value={formData.localizacion_id ? String(formData.localizacion_id) : ""} 
                        onValueChange={(v) => setFormData({ ...formData, localizacion_id: Number(v) })}
                        disabled={!formData.almacen_id}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder={formData.almacen_id ? "Seleccione localizacion" : "Primero seleccione almacen"} />
                        </SelectTrigger>
                        <SelectContent>
                          {localizaciones.map(l => (
                            <SelectItem key={l.id} value={String(l.id)}>{l.nombre}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>

                <Separator />

                {/* Pago de la recepción */}
                <div>
                  <h4 className="text-sm font-medium mb-3 flex items-center gap-2">
                    <DollarSign className="h-4 w-4" />
                    Pago
                  </h4>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="grid gap-2">
                      <Label className="text-xs">Cómo se paga</Label>
                      <Select value={pagoMetodo} onValueChange={(v) => setPagoMetodo(v as 'Efectivo' | 'Banco' | 'Credito')}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Credito">Cuenta por pagar (queda pendiente)</SelectItem>
                          <SelectItem value="Efectivo">Efectivo (sale de caja chica)</SelectItem>
                          <SelectItem value="Banco">Banco (sale de una cuenta)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    {pagoMetodo === 'Banco' && (
                      <div className="grid gap-2">
                        <Label className="text-xs">Cuenta de destino</Label>
                        <Select value={pagoCuentaId ? String(pagoCuentaId) : ""} onValueChange={(v) => setPagoCuentaId(Number(v))}>
                          <SelectTrigger><SelectValue placeholder="Seleccione cuenta" /></SelectTrigger>
                          <SelectContent>
                            {cuentas.map((c) => (
                              <SelectItem key={c.id} value={String(c.id)}>{c.nombre}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2 mt-3">
                    <div className="grid gap-2">
                      <Label className="text-xs">N.º factura del proveedor (de esta recepción)</Label>
                      <Input value={numeroFacturaProv} onChange={(e) => setNumeroFacturaProv(e.target.value)} placeholder="Opcional" />
                    </div>
                    {pagoMetodo === 'Credito' && (
                      <div className="grid gap-2">
                        <Label className="text-xs">Días de crédito</Label>
                        <Input type="number" min="0" value={diasCredito} onChange={(e) => setDiasCredito(e.target.value)} placeholder="Del proveedor (o 30)" />
                      </div>
                    )}
                  </div>
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    Efectivo/Banco: se registra un abono a la orden por lo recibido (sale de caja o de la cuenta). «Cuenta por pagar»: la orden queda con saldo y vencimiento
                    (Finanzas → Gastos → Cuentas por Pagar → Compras a crédito); los abonos y anticipos se registran desde el detalle de la orden.
                  </p>
                </div>

                <Separator />

                {/* Cost Summary */}
                <div className="rounded-lg bg-muted/50 p-4">
                  <h4 className="text-sm font-medium mb-3 flex items-center gap-2">
                    <DollarSign className="h-4 w-4" />
                    Resumen de Costos
                  </h4>
                  
                  {(() => {
                    const totales = calcularTotales()
                    return (
                      <div className="space-y-2">
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">Subtotal ({selectedCompra.moneda})</span>
                          <span>{formatCurrency(totales.subtotalOriginal, selectedCompra.moneda)}</span>
                        </div>
                        {selectedCompra.moneda === 'USD' && (
                          <div className="flex justify-between text-sm">
                            <span className="text-muted-foreground">
                              Subtotal en LPS (x {formData.tasa_cambio})
                            </span>
                            <span>{formatCurrency(totales.subtotalLPS, 'LPS')}</span>
                          </div>
                        )}
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">+ Costos Adicionales</span>
                          <span>{formatCurrency(totales.costosAdicionales, 'LPS')}</span>
                        </div>
                        <Separator className="my-2" />
                        <div className="flex justify-between font-semibold">
                          <span>Total Final (LPS)</span>
                          <span className="text-lg">{formatCurrency(totales.totalFinal, 'LPS')}</span>
                        </div>
                      </div>
                    )
                  })()}
                </div>

                {/* Action Button */}
                <div className="flex justify-end gap-2 flex-wrap">
                  {recepcionesPrevias.length > 0 && (
                    <Button
                      size="lg"
                      variant="outline"
                      className="text-red-700"
                      onClick={handleCerrarBackorder}
                      disabled={processing || cerrandoBackorder}
                      title="Lo pendiente ya no llegará: la orden queda Recibida con lo que entró"
                    >
                      Cerrar pendiente
                    </Button>
                  )}
                  <Button
                    size="lg"
                    variant="outline"
                    onClick={descartarRecepcion}
                    disabled={processing}
                  >
                    Descartar
                  </Button>
                  <Button
                    size="lg"
                    onClick={handleProcessRecepcion}
                    disabled={processing || !formData.almacen_id || !formData.localizacion_id}
                  >
                    {processing && <Spinner className="mr-2 h-4 w-4" />}
                    <PackageCheck className="mr-2 h-4 w-4" />
                    Confirmar Recepcion
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
