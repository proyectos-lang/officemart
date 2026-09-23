"use client"

import { useEffect, useState, useCallback } from "react"
import { 
  FileText, 
  Plus, 
  Trash2, 
  Search,
  Calendar,
  Building2,
  DollarSign,
  Package,
  Eye,
  ChevronsUpDown,
  Download,
  ArrowLeft
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
import { useToast } from "@/hooks/use-toast"
import { Badge } from "@/components/ui/badge"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { 
  type CompraEncabezado, 
  type CompraDetalle,
  getCompras,
  getDetallesCompra,
  createCompra,
  getCompraById
} from "@/lib/services/compras"
import { getRazonSocialForPdf } from "@/lib/services/ventas"
import { type Proveedor, type Producto, getProveedores, getProductos } from "@/lib/services/catalogos"
import { OcRecepcionesPagos } from "@/components/compras/oc-recepciones-pagos"

export default function OrdenCompraPage() {
  const [compras, setCompras] = useState<CompraEncabezado[]>([])
  const [proveedores, setProveedores] = useState<Proveedor[]>([])
  const [productos, setProductos] = useState<Producto[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [selectedCompra, setSelectedCompra] = useState<CompraEncabezado | null>(null)
  const [detallesVista, setDetallesVista] = useState<CompraDetalle[]>([])
  const [loadingDetalles, setLoadingDetalles] = useState(false)
  
  // View mode: "list" | "create" | "view"
  const [viewMode, setViewMode] = useState<"list" | "create" | "view">("list")
  
  // Form state
  const [formData, setFormData] = useState({
    proveedor_id: 0,
    fecha_tentativa: "",
    moneda: "LPS" as "LPS" | "USD"
  })
  const [detalles, setDetalles] = useState<{
    producto_id: number
    producto_nombre: string
    cantidad: number
    costo_unitario_moneda_origen: number
  }[]>([])
  
  // Product search
  const [comboboxOpen, setComboboxOpen] = useState(false)
  
  const { toast } = useToast()

  const fetchData = useCallback(async () => {
    setLoading(true)
    const [comprasRes, provRes, prodRes] = await Promise.all([
      getCompras(),
      getProveedores(),
      getProductos()
    ])
    
    if (comprasRes.error) {
      toast({ title: "Error", description: comprasRes.error, variant: "destructive" })
    }
    setCompras(comprasRes.data)
    setProveedores(provRes.data)
    setProductos(prodRes.data)
    setLoading(false)
  }, [toast])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const handleStartCreate = () => {
    setFormData({
      proveedor_id: 0,
      fecha_tentativa: "",
      moneda: "LPS"
    })
    setDetalles([])
    setViewMode("create")
  }

  const handleCancelCreate = () => {
    setViewMode("list")
  }

  const handleViewCompra = async (compra: CompraEncabezado) => {
    setSelectedCompra(compra)
    setLoadingDetalles(true)
    setViewMode("view")
    
    const { data, error } = await getDetallesCompra(compra.id!)
    if (error) {
      toast({ title: "Error", description: error, variant: "destructive" })
    }
    setDetallesVista(data)
    setLoadingDetalles(false)
  }

  const handleAddProduct = (producto: Producto) => {
    if (detalles.find(d => d.producto_id === producto.id)) {
      toast({ title: "Aviso", description: "El producto ya esta en la lista" })
      return
    }
    
    setDetalles([...detalles, {
      producto_id: producto.id!,
      producto_nombre: producto.nombre,
      cantidad: 1,
      costo_unitario_moneda_origen: producto.costo_promedio || 0
    }])
    setComboboxOpen(false)
  }

  const handleRemoveProduct = (productoId: number) => {
    setDetalles(detalles.filter(d => d.producto_id !== productoId))
  }

  const handleUpdateDetalle = (productoId: number, field: "cantidad" | "costo_unitario_moneda_origen", value: number) => {
    setDetalles(detalles.map(d => 
      d.producto_id === productoId ? { ...d, [field]: value } : d
    ))
  }

  const calcularSubtotal = () => {
    return detalles.reduce((acc, d) => acc + (d.cantidad * d.costo_unitario_moneda_origen), 0)
  }

  const handleSave = async () => {
    if (!formData.proveedor_id) {
      toast({ title: "Error", description: "Seleccione un proveedor", variant: "destructive" })
      return
    }
    if (!formData.fecha_tentativa) {
      toast({ title: "Error", description: "Ingrese la fecha tentativa", variant: "destructive" })
      return
    }
    if (detalles.length === 0) {
      toast({ title: "Error", description: "Agregue al menos un producto", variant: "destructive" })
      return
    }

    setSaving(true)
    
    const subtotal = calcularSubtotal()
    const encabezado = {
      proveedor_id: formData.proveedor_id,
      // fecha_orden defaults to now() in database
      fecha_tentativa: formData.fecha_tentativa,
      moneda: formData.moneda,
      tasa_cambio: 1, // Will be updated during reception
      costos_importacion: 0,
      impuestos_compra: 0,
      otros_costos: 0,
      total_compra_local: 0, // Will be calculated during reception
      subtotal,
      total: subtotal,
      estado: 'Pendiente' as const
    }
    
    const detallesData = detalles.map(d => ({
      producto_id: d.producto_id,
      cantidad: d.cantidad,
      costo_unitario_moneda_origen: d.costo_unitario_moneda_origen
    }))

    const { data: newCompra, error } = await createCompra(encabezado, detallesData)
    setSaving(false)

    if (error) {
      toast({ title: "Error", description: error, variant: "destructive" })
    } else {
      toast({ title: "Exito", description: "Orden de compra creada correctamente" })
      setViewMode("list")
      fetchData()
      
      // Generate PDF automatically
      if (newCompra?.id) {
        setTimeout(() => generateOrdenCompraPDF(newCompra.id!), 500)
      }
    }
  }

  // PDF Generation for Purchase Order
  const generateOrdenCompraPDF = async (compraId: number) => {
    // Fetch complete data
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

    // jsPDF dinámico: solo al generar el PDF.
    const { jsPDF } = await import("jspdf")
    const doc = new jsPDF()
    const pageWidth = doc.internal.pageSize.getWidth()
    const pageHeight = doc.internal.pageSize.getHeight()
    const currency = compra.moneda === 'USD' ? '$' : 'L'
    const orderNumber = `OC-${String(compra.id).padStart(5, '0')}`
    
    // Light gray background
    doc.setFillColor(245, 245, 245)
    doc.rect(0, 0, pageWidth, pageHeight, 'F')
    
    // === LOGO - Top Left ===
    try {
      const logoUrl = razonSocial?.logo_url || ''
      if (!logoUrl) throw new Error("no-logo")
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.src = logoUrl
      await new Promise((resolve, reject) => {
        img.onload = resolve
        img.onerror = reject
        setTimeout(resolve, 1000)
      })
      if (img.complete && img.naturalWidth > 0) {
        doc.addImage(img, 'PNG', 20, 12, 50, 12)
      }
    } catch {
      doc.setTextColor(30, 30, 30)
      doc.setFontSize(14)
      doc.setFont("helvetica", "bold")
      doc.text(razonSocial?.nombre_empresa || "Mi Empresa", 20, 20)
    }
    
    // Contact details - left column
    doc.setFontSize(9)
    doc.setTextColor(100, 100, 100)
    let contactY = 32
    
    doc.setFont("helvetica", "normal")
    doc.text("Correo", 20, contactY)
    doc.text("Telefono", 20, contactY + 8)
    doc.text("Direccion", 20, contactY + 16)
    
    doc.setTextColor(30, 30, 30)
    doc.text(razonSocial?.correo || "", 20, contactY + 4)
    doc.text(razonSocial?.telefono || "", 20, contactY + 12)
    doc.text((razonSocial?.direccion || "").substring(0, 35), 20, contactY + 20)
    
    // Contact details - right column  
    doc.setTextColor(100, 100, 100)
    doc.text("RTN", 80, contactY)
    doc.setTextColor(30, 30, 30)
    doc.text(razonSocial?.documento || "N/A", 80, contactY + 4)
    
    // === RIGHT SIDE: ORDEN DE COMPRA Title ===
    doc.setTextColor(30, 30, 30)
    doc.setFontSize(22)
    doc.setFont("helvetica", "bold")
    doc.text("ORDEN DE", pageWidth - 20, 24, { align: "right" })
    doc.text("COMPRA", pageWidth - 20, 34, { align: "right" })
    
    // Order Number
    doc.setFontSize(12)
    doc.setFont("helvetica", "normal")
    doc.text(`#${orderNumber}`, pageWidth - 20, 44, { align: "right" })
    
    // === PROVEEDOR Section ===
    const proveedorY = 85
    
    // Divider line
    doc.setDrawColor(200, 200, 200)
    doc.setLineWidth(0.5)
    doc.line(20, proveedorY - 5, pageWidth - 20, proveedorY - 5)
    
    doc.setFontSize(9)
    doc.setTextColor(100, 100, 100)
    doc.text("Proveedor", 20, proveedorY)
    doc.text("RTN Proveedor", 80, proveedorY)
    doc.text("Fecha Entrega", pageWidth - 60, proveedorY)
    
    doc.setTextColor(30, 30, 30)
    doc.setFont("helvetica", "normal")
    doc.text(proveedor?.nombre || compra.proveedor_nombre || "N/A", 20, proveedorY + 6)
    doc.text(proveedor?.rtn || "N/A", 80, proveedorY + 6)
    doc.text(compra.fecha_tentativa || "N/A", pageWidth - 60, proveedorY + 6)
    
    // === DESCRIPCION Header ===
    const descY = 110
    doc.setFontSize(12)
    doc.setFont("helvetica", "bold")
    doc.setTextColor(30, 30, 30)
    doc.text("Descripcion", 20, descY)
    
    // Line under description
    doc.setDrawColor(30, 30, 30)
    doc.setLineWidth(0.8)
    doc.line(20, descY + 3, pageWidth - 20, descY + 3)
    
    // === ITEMS List ===
    let itemY = descY + 18
    const lineSubtotal = (cantidad: number, costo: number) => cantidad * costo
    
    doc.setFontSize(10)
    doc.setFont("helvetica", "normal")
    
    detallesCompra.forEach((d) => {
      const subtotal = lineSubtotal(d.cantidad ?? 0, d.costo_unitario_moneda_origen ?? 0)
      
      doc.setTextColor(30, 30, 30)
      doc.text(`${d.producto_nombre || ""} (x${d.cantidad})`, 20, itemY)
      doc.text(`${currency} ${subtotal.toFixed(2)}`, pageWidth - 20, itemY, { align: "right" })
      
      // Dotted line
      doc.setDrawColor(180, 180, 180)
      doc.setLineDashPattern([1, 1], 0)
      doc.line(20, itemY + 4, pageWidth - 20, itemY + 4)
      doc.setLineDashPattern([], 0)
      
      itemY += 12
    })
    
    // === TOTALS Section ===
    const totalsY = Math.max(itemY + 15, 180)
    
    // Total
    doc.setFont("helvetica", "bold")
    doc.setTextColor(30, 30, 30)
    doc.setFontSize(10)
    doc.text("Total", pageWidth - 80, totalsY)
    doc.setFontSize(12)
    doc.text(`${currency} ${(compra.total ?? 0).toFixed(2)}`, pageWidth - 20, totalsY, { align: "right" })
    
    // === FOOTER Section ===
    const footerY = pageHeight - 40
    
    // Divider line
    doc.setDrawColor(200, 200, 200)
    doc.setLineWidth(0.5)
    doc.setLineDashPattern([], 0)
    doc.line(20, footerY - 10, pageWidth - 20, footerY - 10)
    
    // Notes (left)
    doc.setFontSize(9)
    doc.setFont("helvetica", "bold")
    doc.setTextColor(30, 30, 30)
    doc.text("Notas", 20, footerY)
    
    doc.setFont("helvetica", "normal")
    doc.setTextColor(100, 100, 100)
    doc.setFontSize(8)
    doc.text("Favor enviar mercancia segun especificaciones.", 20, footerY + 8)
    doc.text("Confirmar entrega con anticipacion.", 20, footerY + 14)
    
    // Authorization (right)
    doc.setFontSize(9)
    doc.setFont("helvetica", "bold")
    doc.setTextColor(30, 30, 30)
    doc.text("Autorizacion", 110, footerY)
    
    doc.setFont("helvetica", "normal")
    doc.setTextColor(100, 100, 100)
    doc.setFontSize(8)
    doc.text("Orden autorizada por el departamento", 110, footerY + 8)
    doc.text("de compras de la empresa.", 110, footerY + 14)
    
    // Watermark EasyCount
    doc.setFontSize(7)
    doc.setFont("helvetica", "normal")
    doc.setTextColor(168, 162, 158)
    doc.text("Generado por EasyCount", pageWidth / 2, pageHeight - 8, { align: "center" })
    
    // Save and download
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

  const formatCurrency = (value: number, moneda: string = "LPS") => {
    const prefix = moneda === "USD" ? "$ " : "L "
    return prefix + value.toLocaleString("es-HN", { minimumFractionDigits: 2 })
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

  const getEstadoBadge = (estado: string) => {
    switch (estado) {
      case "Pendiente":
        return <Badge variant="outline" className="bg-amber-500/10 text-amber-600 border-amber-500/30">Pendiente</Badge>
      case "Recibida":
        return <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 border-emerald-500/30">Recibida</Badge>
      case "Cancelada":
        return <Badge variant="outline" className="bg-red-500/10 text-red-600 border-red-500/30">Cancelada</Badge>
      default:
        return <Badge variant="outline">{estado}</Badge>
    }
  }


  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Spinner className="h-8 w-8" />
      </div>
    )
  }

  // CREATE VIEW - Inline form for new order
  if (viewMode === "create") {
    return (
      <div className="space-y-4 md:space-y-6">
        {/* Header with back button */}
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={handleCancelCreate}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-xl md:text-2xl font-semibold text-foreground flex items-center gap-2">
              <FileText className="h-5 w-5 md:h-6 md:w-6" />
              Nueva Orden de Compra
            </h1>
            <p className="text-sm md:text-base text-muted-foreground">Complete los datos de la orden</p>
          </div>
        </div>

        {/* Form Card */}
        <Card>
          <CardContent className="p-4 md:p-6 space-y-6">
            {/* Header Info */}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div className="grid gap-2">
                <Label className="flex items-center gap-1.5">
                  <Building2 className="h-3.5 w-3.5" />
                  Proveedor
                </Label>
                <Select 
                  value={formData.proveedor_id ? String(formData.proveedor_id) : ""} 
                  onValueChange={(v) => setFormData({ ...formData, proveedor_id: Number(v) })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Seleccione proveedor" />
                  </SelectTrigger>
                  <SelectContent>
                    {proveedores.map(p => (
                      <SelectItem key={p.id} value={String(p.id)}>{p.nombre}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label className="flex items-center gap-1.5">
                  <Calendar className="h-3.5 w-3.5" />
                  Fecha Tentativa de Entrega
                </Label>
                <Input
                  type="date"
                  value={formData.fecha_tentativa}
                  onChange={(e) => setFormData({ ...formData, fecha_tentativa: e.target.value })}
                />
              </div>
              <div className="grid gap-2">
                <Label className="flex items-center gap-1.5">
                  <DollarSign className="h-3.5 w-3.5" />
                  Moneda
                </Label>
                <Select 
                  value={formData.moneda} 
                  onValueChange={(v) => setFormData({ ...formData, moneda: v as "LPS" | "USD" })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="LPS">Lempiras (LPS)</SelectItem>
                    <SelectItem value="USD">Dolares (USD)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Product Search Combobox */}
            <div className="space-y-3">
              <Label className="flex items-center gap-1.5">
                <Package className="h-3.5 w-3.5" />
                Agregar Productos
              </Label>
              <Popover open={comboboxOpen} onOpenChange={setComboboxOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={comboboxOpen}
                    className="w-full justify-between font-normal"
                  >
                    <span className="flex items-center gap-2 text-muted-foreground">
                      <Search className="h-4 w-4 shrink-0" />
                      Buscar y agregar producto...
                    </span>
                    <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                  <Command>
                    <CommandInput placeholder="Escribir nombre o codigo..." />
                    <CommandList>
                      <CommandEmpty>No se encontraron productos.</CommandEmpty>
                      <CommandGroup heading="Productos disponibles">
                        {/* Se OCULTAN los ya agregados (en vez de dejarlos como
                            items deshabilitados): así el resaltado de cmdk queda
                            siempre en el primer resultado de arriba y al dar Enter
                            no salta al fondo de la lista. */}
                        {productos.filter((p) => !detalles.some(d => d.producto_id === p.id)).map((p) => (
                            <CommandItem
                              key={p.id}
                              value={`${p.nombre} ${p.codigo_barras}`}
                              onSelect={() => handleAddProduct(p)}
                              className="flex items-center justify-between gap-2"
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="h-4 w-4 shrink-0" />
                                <div className="min-w-0">
                                  <p className="truncate font-medium text-sm">{p.nombre}</p>
                                  {p.codigo_barras && (
                                    <p className="text-xs text-muted-foreground font-mono">{p.codigo_barras}</p>
                                  )}
                                </div>
                              </div>
                              <span className="shrink-0 text-sm text-muted-foreground">
                                {formatCurrency(p.costo_promedio || 0)}
                              </span>
                            </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>

            {/* Products Table - Desktop */}
            <div className="hidden md:block border rounded-lg">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Producto</TableHead>
                    <TableHead className="w-28">Cantidad</TableHead>
                    <TableHead className="w-36">Costo Unitario</TableHead>
                    <TableHead className="text-right w-32">Subtotal</TableHead>
                    <TableHead className="w-12"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detalles.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                        <Package className="h-8 w-8 mx-auto mb-2 opacity-30" />
                        Agregue productos a la orden
                      </TableCell>
                    </TableRow>
                  ) : (
                    detalles.map((d) => (
                      <TableRow key={d.producto_id}>
                        <TableCell className="font-medium">{d.producto_nombre}</TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            min="0"
                            step="any"
                            value={d.cantidad}
                            onChange={(e) => handleUpdateDetalle(d.producto_id, "cantidad", Number(e.target.value))}
                            className="h-8"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            step="0.01"
                            min="0"
                            value={d.costo_unitario_moneda_origen}
                            onChange={(e) => handleUpdateDetalle(d.producto_id, "costo_unitario_moneda_origen", Number(e.target.value))}
                            className="h-8"
                          />
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          {formatCurrency(d.cantidad * d.costo_unitario_moneda_origen, formData.moneda)}
                        </TableCell>
                        <TableCell>
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            className="h-8 w-8"
                            onClick={() => handleRemoveProduct(d.producto_id)}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>

            {/* Products - Mobile Cards */}
            <div className="block md:hidden space-y-2">
              {detalles.length === 0 ? (
                <div className="border rounded-lg p-6 text-center text-muted-foreground">
                  <Package className="h-8 w-8 mx-auto mb-2 opacity-30" />
                  Agregue productos a la orden
                </div>
              ) : (
                detalles.map((d) => (
                  <div key={d.producto_id} className="border rounded-lg p-3 bg-card">
                    <div className="flex items-start justify-between mb-2">
                      <p className="font-medium text-sm">{d.producto_nombre}</p>
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="h-7 w-7 -mt-1 -mr-1"
                        onClick={() => handleRemoveProduct(d.producto_id)}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <Label className="text-xs text-muted-foreground">Cantidad</Label>
                        <Input
                          type="number"
                          min="0"
                          step="any"
                          value={d.cantidad}
                          onChange={(e) => handleUpdateDetalle(d.producto_id, "cantidad", Number(e.target.value))}
                          className="h-8 mt-1"
                        />
                      </div>
                      <div>
                        <Label className="text-xs text-muted-foreground">Costo Unit.</Label>
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          value={d.costo_unitario_moneda_origen}
                          onChange={(e) => handleUpdateDetalle(d.producto_id, "costo_unitario_moneda_origen", Number(e.target.value))}
                          className="h-8 mt-1"
                        />
                      </div>
                    </div>
                    <div className="mt-2 pt-2 border-t flex justify-between items-center">
                      <span className="text-xs text-muted-foreground">Subtotal</span>
                      <span className="font-bold text-primary">
                        {formatCurrency(d.cantidad * d.costo_unitario_moneda_origen, formData.moneda)}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Total and Actions */}
            {detalles.length > 0 && (
              <div className="flex flex-col sm:flex-row items-end justify-between gap-4 pt-4 border-t">
                <div className="w-full sm:w-auto text-right sm:text-left">
                  <p className="text-sm text-muted-foreground">Total de la Orden</p>
                  <p className="text-2xl md:text-3xl font-bold text-primary">
                    {formatCurrency(calcularSubtotal(), formData.moneda)}
                  </p>
                </div>
                <div className="flex gap-2 w-full sm:w-auto">
                  <Button variant="outline" onClick={handleCancelCreate} className="flex-1 sm:flex-none">
                    Cancelar
                  </Button>
                  <Button onClick={handleSave} disabled={saving} className="flex-1 sm:flex-none">
                    {saving && <Spinner className="mr-2 h-4 w-4" />}
                    Crear Orden
                  </Button>
                </div>
              </div>
            )}

            {detalles.length === 0 && (
              <div className="flex justify-end gap-2 pt-4 border-t">
                <Button variant="outline" onClick={handleCancelCreate}>Cancelar</Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    )
  }

  // VIEW MODE - View order details inline
  if (viewMode === "view" && selectedCompra) {
    return (
      <div className="space-y-4 md:space-y-6">
        {/* Header with back button */}
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => setViewMode("list")}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex-1">
            <h1 className="text-xl md:text-2xl font-semibold text-foreground">
              Orden de Compra OC-{String(selectedCompra.id).padStart(5, '0')}
            </h1>
            <p className="text-sm md:text-base text-muted-foreground">Detalle de la orden</p>
          </div>
          <Button variant="outline" onClick={() => generateOrdenCompraPDF(selectedCompra.id!)}>
            <Download className="h-4 w-4 mr-2" />
            Descargar PDF
          </Button>
        </div>

        {/* Order Info Card */}
        <Card>
          <CardContent className="p-4 md:p-6">
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4 mb-6">
              <div>
                <p className="text-xs text-muted-foreground">Proveedor</p>
                <p className="font-medium">{selectedCompra.proveedor_nombre}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Fecha Orden</p>
                <p className="font-medium">{formatDate(selectedCompra.fecha_orden)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Fecha Tentativa</p>
                <p className="font-medium">{formatDate(selectedCompra.fecha_tentativa)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Estado</p>
                <div className="mt-0.5">{getEstadoBadge(selectedCompra.estado)}</div>
              </div>
            </div>

            {/* Products Table - Desktop */}
            <div className="hidden md:block border rounded-lg">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Producto</TableHead>
                    <TableHead>Codigo</TableHead>
                    <TableHead className="text-right">Cantidad</TableHead>
                    <TableHead className="text-right">Costo Unit.</TableHead>
                    <TableHead className="text-right">Subtotal</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loadingDetalles ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-8">
                        <Spinner className="h-6 w-6 mx-auto" />
                      </TableCell>
                    </TableRow>
                  ) : detallesVista.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                        Sin productos
                      </TableCell>
                    </TableRow>
                  ) : (
                    detallesVista.map((d) => (
                      <TableRow key={d.id}>
                        <TableCell className="font-medium">{d.producto_nombre}</TableCell>
                        <TableCell className="text-muted-foreground font-mono text-sm">{d.producto_codigo}</TableCell>
                        <TableCell className="text-right">{d.cantidad}</TableCell>
                        <TableCell className="text-right">{formatCurrency(d.costo_unitario_moneda_origen, selectedCompra.moneda)}</TableCell>
                        <TableCell className="text-right font-medium">{formatCurrency(d.cantidad * d.costo_unitario_moneda_origen, selectedCompra.moneda)}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>

            {/* Products - Mobile Cards */}
            <div className="block md:hidden space-y-2">
              {loadingDetalles ? (
                <div className="py-8 text-center">
                  <Spinner className="h-6 w-6 mx-auto" />
                </div>
              ) : detallesVista.length === 0 ? (
                <div className="border rounded-lg p-6 text-center text-muted-foreground">
                  Sin productos
                </div>
              ) : (
                detallesVista.map((d) => (
                  <div key={d.id} className="border rounded-lg p-3 bg-card">
                    <p className="font-medium text-sm">{d.producto_nombre}</p>
                    <p className="text-xs text-muted-foreground font-mono mb-2">{d.producto_codigo}</p>
                    <div className="grid grid-cols-3 gap-2 text-xs">
                      <div>
                        <p className="text-muted-foreground">Cant.</p>
                        <p className="font-medium">{d.cantidad}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Costo</p>
                        <p className="font-medium">{formatCurrency(d.costo_unitario_moneda_origen, selectedCompra.moneda)}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Subtotal</p>
                        <p className="font-medium text-primary">{formatCurrency(d.cantidad * d.costo_unitario_moneda_origen, selectedCompra.moneda)}</p>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Total */}
            <div className="flex justify-end mt-4 pt-4 border-t">
              <div className="text-right">
                <p className="text-sm text-muted-foreground">Total ({selectedCompra.moneda})</p>
                <p className="text-2xl font-bold text-primary">{formatCurrency(selectedCompra.total || 0, selectedCompra.moneda)}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Recepciones parciales y pagos de la OC (officemart-008). */}
        <OcRecepcionesPagos compra={selectedCompra} onChange={fetchData} />

        <div className="flex justify-start">
          <Button variant="outline" onClick={() => setViewMode("list")}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Volver al Listado
          </Button>
        </div>
      </div>
    )
  }

  // LIST VIEW - Default view with orders list
  return (
    <div className="space-y-4 md:space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-semibold text-foreground">Ordenes de Compra</h1>
          <p className="text-sm md:text-base text-muted-foreground">Gestione las ordenes de compra a proveedores</p>
        </div>
        <Button onClick={handleStartCreate} className="w-full sm:w-auto">
          <Plus className="mr-2 h-4 w-4" />
          Nueva Orden
        </Button>
      </div>

      {/* Mobile Card View */}
      <div className="block md:hidden space-y-3">
        {compras.length === 0 ? (
          <Card className="p-8 text-center text-muted-foreground">
            <FileText className="h-10 w-10 mx-auto mb-2 opacity-30" />
            No hay ordenes de compra registradas
          </Card>
        ) : (
          compras.map((compra) => (
            <Card key={compra.id} className="p-4">
              <div className="flex justify-between items-start mb-2">
                <div>
                  <p className="font-mono font-medium text-primary">OC-{String(compra.id).padStart(5, '0')}</p>
                  <p className="text-xs text-muted-foreground">{formatDate(compra.fecha_orden)}</p>
                </div>
                {getEstadoBadge(compra.estado)}
              </div>
              <p className="text-sm truncate mb-2">{compra.proveedor_nombre}</p>
              <div className="flex justify-between items-center">
                <div>
                  <Badge variant="secondary" className="mr-2 text-xs">{compra.moneda}</Badge>
                  <span className="font-bold">{formatCurrency(compra.total || 0, compra.moneda)}</span>
                </div>
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => generateOrdenCompraPDF(compra.id!)}>
                    <Download className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleViewCompra(compra)}>
                    <Eye className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </Card>
          ))
        )}
      </div>

      {/* Desktop Table View */}
      <Card className="hidden md:block">
        <CardHeader className="p-4 md:p-6">
          <CardTitle className="text-base">Listado de Ordenes</CardTitle>
          <CardDescription className="text-sm">Todas las ordenes de compra registradas</CardDescription>
        </CardHeader>
        <CardContent className="p-4 md:p-6 pt-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>No.</TableHead>
                <TableHead>Proveedor</TableHead>
                <TableHead>Fecha Orden</TableHead>
                <TableHead>Fecha Tentativa</TableHead>
                <TableHead>Moneda</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="w-24">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {compras.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                    <FileText className="h-8 w-8 mx-auto mb-2 opacity-30" />
                    No hay ordenes de compra registradas
                  </TableCell>
                </TableRow>
              ) : (
                compras.map((compra) => (
                  <TableRow key={compra.id} className="cursor-pointer hover:bg-muted/50" onClick={() => handleViewCompra(compra)}>
                    <TableCell className="font-medium">OC-{String(compra.id).padStart(5, '0')}</TableCell>
                    <TableCell>{compra.proveedor_nombre}</TableCell>
                    <TableCell>{formatDate(compra.fecha_orden)}</TableCell>
                    <TableCell>{formatDate(compra.fecha_tentativa)}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{compra.moneda}</Badge>
                    </TableCell>
                    <TableCell className="text-right">{formatCurrency(compra.total || 0, compra.moneda)}</TableCell>
                    <TableCell>{getEstadoBadge(compra.estado)}</TableCell>
                    <TableCell>
                      <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                        <Button variant="ghost" size="icon" onClick={() => generateOrdenCompraPDF(compra.id!)}>
                          <Download className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => handleViewCompra(compra)}>
                          <Eye className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
