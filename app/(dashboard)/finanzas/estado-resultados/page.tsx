"use client"

import * as React from "react"
import { 
  TrendingUp, 
  TrendingDown, 
  Download, 
  Calendar,
  DollarSign,
  MinusCircle,
  PlusCircle,
  BarChart3,
  FileText
} from "lucide-react"

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { useToast } from "@/hooks/use-toast"
import { 
  getEstadoResultadosMensual, 
  getEstadoResultadosAnual,
  getEstadoResultadosAcumulado,
  type EstadoResultadosMensual 
} from "@/lib/services/estado-resultados"
import { getRazonSocial } from "@/lib/services/razon-social"

import { Area, AreaChart, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts"
import { ChartContainer, ChartTooltipContent } from "@/components/ui/chart"

const MESES = [
  { value: 1, label: 'Enero' },
  { value: 2, label: 'Febrero' },
  { value: 3, label: 'Marzo' },
  { value: 4, label: 'Abril' },
  { value: 5, label: 'Mayo' },
  { value: 6, label: 'Junio' },
  { value: 7, label: 'Julio' },
  { value: 8, label: 'Agosto' },
  { value: 9, label: 'Septiembre' },
  { value: 10, label: 'Octubre' },
  { value: 11, label: 'Noviembre' },
  { value: 12, label: 'Diciembre' },
]

const chartConfig = {
  ventas: {
    label: "Ventas",
    color: "#7C9A92", // Verde salvia
  },
  gastos: {
    label: "Gastos",
    color: "#C07A5C", // Terracota suave
  },
  utilidad: {
    label: "Utilidad Neta",
    color: "#D4A574", // Dorado arena
  },
}

// Formato de moneda compartido (Lempiras). A nivel de modulo para poder
// usarlo tanto en el componente como en la fila `FinancialLine`.
function formatLps(value: number) {
  return `L ${value.toLocaleString('es-HN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

// Fila del estado de resultados. Definida a nivel de modulo (NO dentro del
// componente) para que no se recree en cada render — antes esto remontaba
// toda la tabla financiera en cada actualizacion de estado.
function FinancialLine({
  label,
  value,
  isHeader = false,
  isSubtotal = false,
  isTotal = false,
  isNegative = false,
  indent = 0,
}: {
  label: string
  value?: number
  isHeader?: boolean
  isSubtotal?: boolean
  isTotal?: boolean
  isNegative?: boolean
  indent?: number
}) {
  return (
    <div className={`
      flex items-center justify-between py-2.5 px-4
      ${isHeader ? 'bg-stone-100/50 border-b border-stone-200' : ''}
      ${isSubtotal ? 'bg-amber-50/50 border-y border-amber-200/50 font-semibold' : ''}
      ${isTotal ? 'bg-gradient-to-r from-amber-100/80 to-orange-100/60 border-y-2 border-amber-300/50' : ''}
      ${!isHeader && !isSubtotal && !isTotal ? 'border-b border-stone-100' : ''}
    `}>
      <span
        className={`
          ${isHeader ? 'text-xs uppercase tracking-wider text-stone-500 font-medium' : ''}
          ${isSubtotal || isTotal ? 'font-serif text-stone-800' : 'text-stone-600'}
          ${isTotal ? 'text-lg' : ''}
        `}
        style={{ paddingLeft: indent * 16 }}
      >
        {label}
      </span>
      {value !== undefined && (
        <span className={`
          font-mono
          ${isNegative ? 'text-red-600' : ''}
          ${isSubtotal ? 'text-amber-800 font-semibold' : ''}
          ${isTotal ? 'text-xl font-bold text-amber-900' : ''}
          ${!isSubtotal && !isTotal && !isNegative ? 'text-stone-700' : ''}
        `}>
          {isNegative && value > 0 ? `(${formatLps(value)})` : formatLps(value)}
        </span>
      )}
    </div>
  )
}

export default function EstadoResultadosPage() {
  const { toast } = useToast()
  const now = new Date()
  
  const [vista, setVista] = React.useState<'mes' | 'anio'>('mes')
  const [anio, setAnio] = React.useState(now.getFullYear())
  const [mes, setMes] = React.useState(now.getMonth() + 1)
  const [loading, setLoading] = React.useState(true)
  const [datosMes, setDatosMes] = React.useState<EstadoResultadosMensual | null>(null)
  const [datosAnio, setDatosAnio] = React.useState<EstadoResultadosMensual[]>([])
  const [datosAcumulado, setDatosAcumulado] = React.useState<EstadoResultadosMensual | null>(null)

  // Fetch data
  React.useEffect(() => {
    async function fetchData() {
      setLoading(true)
      
      if (vista === 'mes') {
        const { data } = await getEstadoResultadosMensual(anio, mes)
        setDatosMes(data)
      } else {
        const [anualRes, acumuladoRes] = await Promise.all([
          getEstadoResultadosAnual(anio),
          getEstadoResultadosAcumulado(anio)
        ])
        setDatosAnio(anualRes.data)
        setDatosAcumulado(acumuladoRes.data)
      }
      
      setLoading(false)
    }
    fetchData()
  }, [vista, anio, mes])

  // Format currency
  const formatCurrency = formatLps

  // Generate PDF
  async function generatePDF() {
    const { data: razonSocial } = await getRazonSocial()
    const datos = vista === 'mes' ? datosMes : datosAcumulado
    
    if (!datos) {
      toast({ title: "Error", description: "No hay datos para exportar", variant: "destructive" })
      return
    }

    // jsPDF + autoTable dinámicos: solo al exportar el PDF.
    const { jsPDF } = await import("jspdf")
    const autoTable = (await import("jspdf-autotable")).default
    const doc = new jsPDF()
    const pageWidth = doc.internal.pageSize.getWidth()
    const pageHeight = doc.internal.pageSize.getHeight()

    // Light gray background
    doc.setFillColor(245, 245, 245)
    doc.rect(0, 0, pageWidth, pageHeight, 'F')

    // Logo
    try {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.src = razonSocial?.logo_url || ''
      await new Promise((resolve) => {
        img.onload = resolve
        img.onerror = resolve
        setTimeout(resolve, 1000)
      })
      if (img.complete && img.naturalWidth > 0) {
        doc.addImage(img, 'PNG', 20, 12, 50, 12)
      }
    } catch {
      doc.setFontSize(14)
      doc.setFont("helvetica", "bold")
      doc.text(razonSocial?.nombre_empresa || "Mi Empresa", 20, 20)
    }

    // Company info
    doc.setFontSize(9)
    doc.setTextColor(100, 100, 100)
    doc.text(`RTN: ${razonSocial?.documento || "N/A"}`, 20, 32)
    doc.text(razonSocial?.direccion || "", 20, 38)

    // Title
    doc.setTextColor(30, 30, 30)
    doc.setFontSize(22)
    doc.setFont("helvetica", "bold")
    doc.text("ESTADO DE", pageWidth - 20, 20, { align: "right" })
    doc.text("RESULTADOS", pageWidth - 20, 30, { align: "right" })

    // Period
    doc.setFontSize(11)
    doc.setFont("helvetica", "normal")
    const periodo = vista === 'mes' 
      ? `${MESES.find(m => m.value === mes)?.label} ${anio}`
      : `Acumulado ${anio}`
    doc.text(periodo, pageWidth - 20, 40, { align: "right" })

    // Divider
    doc.setDrawColor(200, 200, 200)
    doc.setLineWidth(0.5)
    doc.line(20, 50, pageWidth - 20, 50)

    // Financial Table
    const tableData = [
      ['INGRESOS', '', ''],
      ['Ventas netas (sin ISV)', '', formatCurrency(datos.ventas_totales)],
      ['', '', ''],
      ['COSTOS', '', ''],
      ['Costo de Mercancia Vendida (CMV)', '', `(${formatCurrency(datos.costo_mercancia_vendida)})`],
      ['', '', ''],
      ['UTILIDAD BRUTA', '', formatCurrency(datos.utilidad_bruta)],
      ['', '', ''],
      ['GASTOS OPERATIVOS', '', ''],
      ['Servicios', '', formatCurrency(datos.gastos_servicios)],
      ['Publicidad', '', formatCurrency(datos.gastos_publicidad)],
      ['Nomina', '', formatCurrency(datos.gastos_nomina)],
      ['Arriendo', '', formatCurrency(datos.gastos_arriendo)],
      ['Mantenimiento', '', formatCurrency(datos.gastos_mantenimiento)],
      ['Impuestos', '', formatCurrency(datos.gastos_impuestos)],
      ['Suministros', '', formatCurrency(datos.gastos_suministros)],
      ['Otros Gastos', '', formatCurrency(datos.gastos_otros)],
      ['', '', ''],
      ['Total Gastos Operativos', '', `(${formatCurrency(datos.total_gastos_operativos)})`],
      ['', '', ''],
      ['GASTOS FINANCIEROS', '', ''],
      ['Comisiones Bancarias', '', `(${formatCurrency(datos.comisiones_bancarias || 0)})`],
      ['', '', ''],
      ['UTILIDAD NETA', '', formatCurrency(datos.utilidad_neta)],
      ['Margen Neto', '', `${datos.margen_neto.toFixed(1)}%`],
    ]

    autoTable(doc, {
      startY: 58,
      body: tableData,
      theme: 'plain',
      styles: {
        fontSize: 10,
        cellPadding: 3,
        textColor: [50, 50, 50]
      },
      columnStyles: {
        0: { cellWidth: 100, fontStyle: 'normal' },
        1: { cellWidth: 30 },
        2: { cellWidth: 50, halign: 'right' }
      },
      didParseCell: function(data) {
        const text = data.cell.raw as string
        if (text === 'INGRESOS' || text === 'COSTOS' || text === 'GASTOS OPERATIVOS' || text === 'GASTOS FINANCIEROS') {
          data.cell.styles.fontStyle = 'bold'
          data.cell.styles.textColor = [100, 100, 100]
          data.cell.styles.fontSize = 9
        }
        if (text === 'UTILIDAD BRUTA' || text === 'UTILIDAD NETA') {
          data.cell.styles.fontStyle = 'bold'
          data.cell.styles.fillColor = [240, 235, 225]
        }
        if (text === 'Total Gastos Operativos') {
          data.cell.styles.fontStyle = 'bold'
        }
      },
      margin: { left: 20, right: 20 }
    })

    // Footer
    doc.setFontSize(7)
    doc.setTextColor(168, 162, 158)
    doc.text("Generado por EasyCount", pageWidth / 2, pageHeight - 15, { align: "center" })

    // Save
    const filename = `Estado_Resultados_${periodo.replace(' ', '_')}.pdf`
    doc.save(filename)
    toast({ title: "PDF Generado", description: "El reporte se descargo correctamente" })
  }

  // Chart data for annual view: "gastos" agrega CMV + operativos + comisiones
  // bancarias para que la diferencia con "ventas" iguale a la utilidad neta.
  const chartData = datosAnio.map(d => ({
    mes: d.mes_nombre.substring(0, 3),
    ventas: d.ventas_totales,
    gastos: d.total_gastos_operativos + d.costo_mercancia_vendida + (d.comisiones_bancarias || 0),
    utilidad: d.utilidad_neta
  }))

  // Render financial line
  const datos = vista === 'mes' ? datosMes : datosAcumulado

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#FAF8F5] via-[#F5F0E8] to-[#EDE8E0]">
      <div className="container mx-auto px-4 py-8 max-w-6xl">
        {/* Header */}
        <div className="mb-8">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h1 className="text-3xl font-serif font-bold text-stone-800 tracking-tight">
                Estado de Resultados
              </h1>
              <p className="text-stone-500 mt-1">
                Analisis financiero de ingresos, costos y gastos
              </p>
            </div>
            
            <div className="flex items-center gap-3">
              <Button 
                variant="outline" 
                onClick={generatePDF}
                disabled={loading || !datos}
                className="gap-2 border-amber-300 text-amber-800 hover:bg-amber-50"
              >
                <Download className="h-4 w-4" />
                Descargar Reporte
              </Button>
            </div>
          </div>
        </div>

        {/* View Toggle and Filters */}
        <Card className="mb-6 bg-white/70 backdrop-blur-sm border-stone-200/60 rounded-3xl shadow-sm">
          <CardContent className="p-6">
            <div className="flex flex-col md:flex-row md:items-center gap-4">
              <Tabs value={vista} onValueChange={(v) => setVista(v as 'mes' | 'anio')} className="w-full md:w-auto">
                <TabsList className="grid w-full md:w-[300px] grid-cols-2 bg-stone-100/80">
                  <TabsTrigger value="mes" className="data-[state=active]:bg-white">
                    <Calendar className="h-4 w-4 mr-2" />
                    Mes Actual
                  </TabsTrigger>
                  <TabsTrigger value="anio" className="data-[state=active]:bg-white">
                    <BarChart3 className="h-4 w-4 mr-2" />
                    Año Corrido
                  </TabsTrigger>
                </TabsList>
              </Tabs>

              <div className="flex items-center gap-3 ml-auto">
                {vista === 'mes' && (
                  <Select value={mes.toString()} onValueChange={(v) => setMes(parseInt(v))}>
                    <SelectTrigger className="w-[140px] bg-white/50">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {MESES.map(m => (
                        <SelectItem key={m.value} value={m.value.toString()}>{m.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                
                <Select value={anio.toString()} onValueChange={(v) => setAnio(parseInt(v))}>
                  <SelectTrigger className="w-[100px] bg-white/50">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[2024, 2025, 2026].map(a => (
                      <SelectItem key={a} value={a.toString()}>{a}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Spinner className="h-8 w-8 text-amber-600" />
          </div>
        ) : !datos ? (
          <Card className="bg-white/70 backdrop-blur-sm border-stone-200/60 rounded-3xl">
            <CardContent className="p-12 text-center">
              <FileText className="h-12 w-12 mx-auto text-stone-300 mb-4" />
              <h3 className="text-lg font-medium text-stone-600">Sin datos en este periodo</h3>
              <p className="text-stone-400 mt-1">No hay transacciones registradas para mostrar</p>
            </CardContent>
          </Card>
        ) : (
          <>
            {/* KPIs Summary */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              <Card className="bg-white/70 backdrop-blur-sm border-stone-200/60 rounded-2xl">
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="p-1.5 rounded-lg bg-emerald-100">
                      <TrendingUp className="h-4 w-4 text-emerald-600" />
                    </div>
                    <span className="text-xs text-stone-500">Ventas</span>
                  </div>
                  <p className="text-xl font-bold text-stone-800 font-mono">
                    {formatCurrency(datos.ventas_totales)}
                  </p>
                </CardContent>
              </Card>

              <Card className="bg-white/70 backdrop-blur-sm border-stone-200/60 rounded-2xl">
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="p-1.5 rounded-lg bg-amber-100">
                      <DollarSign className="h-4 w-4 text-amber-600" />
                    </div>
                    <span className="text-xs text-stone-500">Utilidad Bruta</span>
                  </div>
                  <p className="text-xl font-bold text-stone-800 font-mono">
                    {formatCurrency(datos.utilidad_bruta)}
                  </p>
                  <p className="text-xs text-stone-400 mt-1">
                    Margen: {datos.margen_bruto.toFixed(1)}%
                  </p>
                </CardContent>
              </Card>

              <Card className="bg-white/70 backdrop-blur-sm border-stone-200/60 rounded-2xl">
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="p-1.5 rounded-lg bg-red-100">
                      <MinusCircle className="h-4 w-4 text-red-600" />
                    </div>
                    <span className="text-xs text-stone-500">Total Gastos</span>
                  </div>
                  <p className="text-xl font-bold text-stone-800 font-mono">
                    {formatCurrency(datos.total_gastos_operativos)}
                  </p>
                </CardContent>
              </Card>

              <Card className={`backdrop-blur-sm border-stone-200/60 rounded-2xl ${datos.utilidad_neta >= 0 ? 'bg-gradient-to-br from-emerald-50 to-green-50' : 'bg-gradient-to-br from-red-50 to-orange-50'}`}>
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <div className={`p-1.5 rounded-lg ${datos.utilidad_neta >= 0 ? 'bg-emerald-100' : 'bg-red-100'}`}>
                      {datos.utilidad_neta >= 0 ? (
                        <PlusCircle className="h-4 w-4 text-emerald-600" />
                      ) : (
                        <TrendingDown className="h-4 w-4 text-red-600" />
                      )}
                    </div>
                    <span className="text-xs text-stone-500">Utilidad Neta</span>
                  </div>
                  <p className={`text-xl font-bold font-mono ${datos.utilidad_neta >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                    {formatCurrency(datos.utilidad_neta)}
                  </p>
                  <p className="text-xs text-stone-400 mt-1">
                    Margen: {datos.margen_neto.toFixed(1)}%
                  </p>
                </CardContent>
              </Card>
            </div>

            {/* Financial Statement Table */}
            <Card className="bg-white/80 backdrop-blur-sm border-stone-200/60 rounded-3xl shadow-sm mb-6 overflow-hidden">
              <CardHeader className="border-b border-stone-200/60 bg-stone-50/50">
                <CardTitle className="font-serif text-xl text-stone-800">
                  {vista === 'mes' 
                    ? `${MESES.find(m => m.value === mes)?.label} ${anio}`
                    : `Acumulado ${anio}`
                  }
                </CardTitle>
                <CardDescription>Estado de Resultados Detallado</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <div className="divide-y divide-stone-100">
                  {/* INGRESOS */}
                  <FinancialLine label="INGRESOS" isHeader />
                  <FinancialLine label="Ventas netas (sin ISV)" value={datos.ventas_totales} indent={1} />
                  
                  {/* COSTOS */}
                  <FinancialLine label="COSTOS" isHeader />
                  <FinancialLine label="Costo de Mercancia Vendida (CMV)" value={datos.costo_mercancia_vendida} isNegative indent={1} />
                  
                  {/* UTILIDAD BRUTA */}
                  <FinancialLine label="UTILIDAD BRUTA" value={datos.utilidad_bruta} isSubtotal />
                  
                  {/* GASTOS OPERATIVOS */}
                  <FinancialLine label="GASTOS OPERATIVOS" isHeader />
                  {datos.gastos_servicios > 0 && <FinancialLine label="Servicios" value={datos.gastos_servicios} indent={1} />}
                  {datos.gastos_publicidad > 0 && <FinancialLine label="Publicidad" value={datos.gastos_publicidad} indent={1} />}
                  {datos.gastos_nomina > 0 && <FinancialLine label="Nomina" value={datos.gastos_nomina} indent={1} />}
                  {datos.gastos_arriendo > 0 && <FinancialLine label="Arriendo" value={datos.gastos_arriendo} indent={1} />}
                  {datos.gastos_mantenimiento > 0 && <FinancialLine label="Mantenimiento" value={datos.gastos_mantenimiento} indent={1} />}
                  {datos.gastos_impuestos > 0 && <FinancialLine label="Impuestos" value={datos.gastos_impuestos} indent={1} />}
                  {datos.gastos_suministros > 0 && <FinancialLine label="Suministros" value={datos.gastos_suministros} indent={1} />}
                  {datos.gastos_otros > 0 && <FinancialLine label="Otros Gastos" value={datos.gastos_otros} indent={1} />}
                  
                  {/* Total Gastos */}
                  <FinancialLine label="Total Gastos Operativos" value={datos.total_gastos_operativos} isNegative />

                  {/*
                    GASTOS FINANCIEROS
                    Comisiones bancarias del periodo (ventas_pagos_detalle).
                    Se renderiza siempre - aunque sea 0 - para que el lector
                    entienda que el calculo de utilidad ya las contempla.
                  */}
                  <FinancialLine label="GASTOS FINANCIEROS" isHeader />
                  <FinancialLine
                    label="Comisiones Bancarias"
                    value={datos.comisiones_bancarias || 0}
                    isNegative
                    indent={1}
                  />

                  {/* UTILIDAD NETA */}
                  <FinancialLine label="UTILIDAD NETA" value={datos.utilidad_neta} isTotal />
                  
                  {/* Margen */}
                  <div className="flex items-center justify-between py-3 px-4 bg-stone-50/50">
                    <span className="text-sm text-stone-500">Margen Neto</span>
                    <span className={`font-mono font-semibold ${datos.margen_neto >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                      {datos.margen_neto.toFixed(1)}%
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Chart (Annual View) */}
            {vista === 'anio' && chartData.length > 0 && (
              <Card className="bg-white/80 backdrop-blur-sm border-stone-200/60 rounded-3xl shadow-sm">
                <CardHeader>
                  <CardTitle className="font-serif text-xl text-stone-800">
                    Comparativo Mensual {anio}
                  </CardTitle>
                  <CardDescription>Ventas vs Gastos vs Utilidad Neta</CardDescription>
                </CardHeader>
                <CardContent>
                  <ChartContainer config={chartConfig} className="h-[350px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={chartData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                        <defs>
                          <linearGradient id="colorVentas" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#7C9A92" stopOpacity={0.8}/>
                            <stop offset="95%" stopColor="#7C9A92" stopOpacity={0.1}/>
                          </linearGradient>
                          <linearGradient id="colorGastos" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#C07A5C" stopOpacity={0.8}/>
                            <stop offset="95%" stopColor="#C07A5C" stopOpacity={0.1}/>
                          </linearGradient>
                          <linearGradient id="colorUtilidad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#D4A574" stopOpacity={0.8}/>
                            <stop offset="95%" stopColor="#D4A574" stopOpacity={0.1}/>
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#E5E5E5" />
                        <XAxis dataKey="mes" stroke="#9CA3AF" fontSize={12} />
                        <YAxis stroke="#9CA3AF" fontSize={12} tickFormatter={(v) => `L${(v/1000).toFixed(0)}k`} />
                        <Tooltip content={<ChartTooltipContent />} />
                        <Legend />
                        <Area 
                          type="monotone" 
                          dataKey="ventas" 
                          name="Ventas"
                          stroke="#7C9A92" 
                          fillOpacity={1} 
                          fill="url(#colorVentas)" 
                        />
                        <Area 
                          type="monotone" 
                          dataKey="gastos" 
                          name="Gastos Totales"
                          stroke="#C07A5C" 
                          fillOpacity={1} 
                          fill="url(#colorGastos)" 
                        />
                        <Area 
                          type="monotone" 
                          dataKey="utilidad" 
                          name="Utilidad Neta"
                          stroke="#D4A574" 
                          fillOpacity={1} 
                          fill="url(#colorUtilidad)" 
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </ChartContainer>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>
    </div>
  )
}
