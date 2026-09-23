"use client"

import * as React from "react"
import { useSearchParams } from "next/navigation"
import { BarChart3, ChevronsUpDown, Check, Download, FileDown, Loader2, Search, Truck } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Spinner } from "@/components/ui/spinner"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { useToast } from "@/hooks/use-toast"
import { useTenant } from "@/lib/hooks/use-tenant"
import { useAuth } from "@/lib/contexts/auth-context"
import { formatCurrency, formatNumber } from "@/lib/utils/format"
import { formatHondurasDate, getHondurasTodayISODate } from "@/lib/utils/honduras-time"
import { exportToXlsx } from "@/lib/utils/export"
import { getProveedores, type Proveedor } from "@/lib/services/catalogos"
import { getRazonSocialForPdf } from "@/lib/services/ventas"
import { getEstadisticasOC, getEstadoCuentaProveedor, type EstadisticasOC, type EstadoCuentaProveedor } from "@/lib/services/reportes-compras"

export default function ReportesComprasPage() {
  return (
    <React.Suspense fallback={<div className="flex items-center gap-2 py-10 text-sm text-muted-foreground"><Spinner /> Cargando…</div>}>
      <ReportesComprasInner />
    </React.Suspense>
  )
}

function ReportesComprasInner() {
  const params = useSearchParams()
  const { toast } = useToast()
  const { ready, razonSocialId } = useTenant()
  const { user } = useAuth()
  const hoy = getHondurasTodayISODate()
  const inicioAnio = `${hoy.slice(0, 4)}-01-01`

  // Estadísticas
  const [desde, setDesde] = React.useState(inicioAnio)
  const [hasta, setHasta] = React.useState(hoy)
  const [stats, setStats] = React.useState<EstadisticasOC | null>(null)
  const [cargando, setCargando] = React.useState(false)

  // Estado de cuenta proveedor
  const [proveedores, setProveedores] = React.useState<Proveedor[]>([])
  const [provOpen, setProvOpen] = React.useState(false)
  const [proveedorId, setProveedorId] = React.useState<number | null>(params.get("proveedorId") ? Number(params.get("proveedorId")) : null)
  const [ecDesde, setEcDesde] = React.useState("")
  const [ecHasta, setEcHasta] = React.useState(hoy)
  const [ec, setEc] = React.useState<EstadoCuentaProveedor | null>(null)
  const [cargandoEc, setCargandoEc] = React.useState(false)
  const [generandoPdf, setGenerandoPdf] = React.useState(false)

  React.useEffect(() => {
    if (!ready || razonSocialId == null) return
    getProveedores().then((r) => setProveedores(r.data || []))
    consultarStats()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, razonSocialId])

  async function consultarStats() {
    setCargando(true)
    const { data, error } = await getEstadisticasOC(desde, hasta)
    setCargando(false)
    if (error) toast({ title: "No se pudo consultar", description: error, variant: "destructive" })
    setStats(data)
  }

  const proveedor = proveedores.find((p) => p.id === proveedorId) ?? null
  const cargarEc = React.useCallback(async () => {
    if (proveedorId == null) return
    setCargandoEc(true)
    const { data, error } = await getEstadoCuentaProveedor(proveedorId, { desde: ecDesde || null, hasta: ecHasta || null, hoyISO: hoy })
    setCargandoEc(false)
    if (error) toast({ title: "No se pudo cargar el estado de cuenta", description: error, variant: "destructive" })
    setEc(data)
  }, [proveedorId, ecDesde, ecHasta, hoy, toast])

  React.useEffect(() => {
    if (!ready || razonSocialId == null || proveedorId == null) return
    cargarEc()
  }, [ready, razonSocialId, proveedorId, cargarEc])

  function exportarStats() {
    if (!stats) return
    exportToXlsx(
      stats.ordenes.map((o) => ({
        OC: `OC-${o.compra_id}`,
        Proveedor: o.proveedor_nombre || "",
        Factura: o.numero_factura || "",
        "Fecha orden": formatHondurasDate(o.fecha_orden),
        Tentativa: o.fecha_tentativa || "",
        Estado: o.estado,
        "Unid. ordenadas": o.unidades_ordenadas,
        "Unid. recibidas": o.unidades_recibidas,
        "Cumplimiento %": o.cumplimiento,
        "Valor ordenado (L)": o.valor_ordenado_local,
        "Valor recibido (L)": o.valor_recibido_local,
        "En tránsito (L)": o.en_transito_local,
        "Lead time (días)": o.lead_time_dias ?? "",
        "Retraso (días)": o.retraso_dias ?? "",
        Recepciones: o.recepciones,
      })),
      { filename: `estadisticas_oc_${desde}_${hasta}`, sheetName: "Órdenes" }
    )
  }

  function exportarEc() {
    if (!ec || !proveedor) return
    exportToXlsx(
      [
        { Fecha: "", Tipo: "Saldo inicial", Documento: "", Referencia: "", Debito: "", Credito: "", Saldo: ec.saldoInicial },
        ...ec.movimientos.map((m) => ({ Fecha: formatHondurasDate(m.fecha), Tipo: m.tipo, Documento: m.documento, Referencia: m.referencia || "", Debito: m.debito || "", Credito: m.credito || "", Saldo: m.saldo })),
      ],
      { filename: `estado_cuenta_proveedor_${proveedor.nombre.replace(/\s+/g, "_")}`, sheetName: "Estado de cuenta" }
    )
  }

  async function pdfEc() {
    if (!ec || !proveedor) return
    setGenerandoPdf(true)
    try {
      const [{ jsPDF }, autoTableMod, empresa] = await Promise.all([import("jspdf"), import("jspdf-autotable"), getRazonSocialForPdf()])
      const autoTable = autoTableMod.default
      const doc = new jsPDF()
      const w = doc.internal.pageSize.getWidth()
      doc.setFont("helvetica", "bold"); doc.setFontSize(14)
      doc.text(empresa?.nombre_comercial || empresa?.nombre_empresa || user?.razon_social_nombre || "Empresa", 14, 16)
      doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(100, 100, 100)
      doc.text(`RTN: ${empresa?.documento || "N/A"}`, 14, 22)
      doc.setFont("helvetica", "bold"); doc.setFontSize(14); doc.setTextColor(30, 30, 30)
      doc.text("ESTADO DE CUENTA · PROVEEDOR", w - 14, 16, { align: "right" })
      doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(100, 100, 100)
      doc.text(`Emitido: ${formatHondurasDate(hoy)}`, w - 14, 22, { align: "right" })
      doc.setTextColor(30, 30, 30); doc.setFontSize(10)
      doc.text(`Proveedor: ${proveedor.nombre}${proveedor.rtn ? `  RTN ${proveedor.rtn}` : ""}`, 14, 32)
      autoTable(doc, {
        startY: 38,
        head: [["Fecha", "Tipo", "Documento", "Referencia", "Débito", "Crédito", "Saldo"]],
        body: [
          ["", "Saldo inicial", "", "", "", "", formatCurrency(ec.saldoInicial)],
          ...ec.movimientos.map((m) => [formatHondurasDate(m.fecha), m.tipo, m.documento, m.referencia || "", m.debito ? formatCurrency(m.debito) : "", m.credito ? formatCurrency(m.credito) : "", formatCurrency(m.saldo)]),
        ],
        foot: [["", "", "", "Totales", formatCurrency(ec.totalDebitos), formatCurrency(ec.totalCreditos), formatCurrency(ec.saldoFinal)]],
        styles: { fontSize: 8 },
        headStyles: { fillColor: [41, 37, 36] },
        footStyles: { fillColor: [245, 245, 244], textColor: [30, 30, 30], fontStyle: "bold" },
        columnStyles: { 4: { halign: "right" }, 5: { halign: "right" }, 6: { halign: "right" } },
      })
      if (ec.pendientes.length > 0) {
        const y = ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 60) + 8
        doc.setFont("helvetica", "bold"); doc.setFontSize(10)
        doc.text("Documentos con saldo", 14, y)
        autoTable(doc, {
          startY: y + 3,
          head: [["Documento", "Fecha", "Vence", "Total", "Saldo", "Días vencido"]],
          body: ec.pendientes.map((p) => [p.documento, formatHondurasDate(p.fecha), p.vence || "", formatCurrency(p.total), formatCurrency(p.saldo), p.dias_vencido != null ? String(p.dias_vencido) : ""]),
          styles: { fontSize: 8 },
          headStyles: { fillColor: [120, 113, 108] },
          columnStyles: { 3: { halign: "right" }, 4: { halign: "right" }, 5: { halign: "right" } },
        })
      }
      doc.setFontSize(7); doc.setTextColor(168, 162, 158)
      doc.text("Generado por EasyCount", w / 2, doc.internal.pageSize.getHeight() - 8, { align: "center" })
      doc.save(`Estado_cuenta_${proveedor.nombre.replace(/\s+/g, "_")}.pdf`)
    } catch (err) {
      console.error(err)
      toast({ title: "No se pudo generar el PDF", variant: "destructive" })
    } finally {
      setGenerandoPdf(false)
    }
  }

  return (
    <div className="space-y-4 md:space-y-6">
      <div className="flex items-center gap-3">
        <div className="rounded-lg bg-orange-100 p-2 text-orange-700">
          <BarChart3 className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold text-stone-800">Reportes de Compras</h1>
          <p className="text-sm text-muted-foreground">Cumplimiento de órdenes, tiempos de entrega, mercancía en tránsito y estado de cuenta por proveedor.</p>
        </div>
      </div>

      <Tabs defaultValue={proveedorId != null ? "proveedor" : "oc"}>
        <TabsList>
          <TabsTrigger value="oc">Estadísticas de OC</TabsTrigger>
          <TabsTrigger value="proveedor">Estado de cuenta de proveedor</TabsTrigger>
        </TabsList>

        {/* ---------- Estadísticas ---------- */}
        <TabsContent value="oc" className="space-y-4">
          <Card>
            <CardContent className="p-4 flex flex-col md:flex-row md:items-end gap-3">
              <div className="grid gap-1.5"><Label>Desde (fecha de orden)</Label><Input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /></div>
              <div className="grid gap-1.5"><Label>Hasta</Label><Input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} /></div>
              <Button onClick={consultarStats} disabled={cargando} className="gap-2">{cargando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} Consultar</Button>
              <Button variant="outline" onClick={exportarStats} disabled={!stats || stats.ordenes.length === 0} className="gap-1"><Download className="h-4 w-4" /> Excel</Button>
            </CardContent>
          </Card>

          {cargando ? (
            <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground"><Spinner /> Consultando…</div>
          ) : stats ? (
            <>
              <div className="grid gap-3 grid-cols-2 lg:grid-cols-6">
                <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">Órdenes</p><p className="text-lg font-semibold">{stats.totales.ordenes}</p></CardContent></Card>
                <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">Ordenado (L)</p><p className="text-lg font-semibold">{formatCurrency(stats.totales.valor_ordenado)}</p></CardContent></Card>
                <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">Recibido (L)</p><p className="text-lg font-semibold">{formatCurrency(stats.totales.valor_recibido)}</p></CardContent></Card>
                <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">En tránsito (L)</p><p className="text-lg font-semibold text-orange-700">{formatCurrency(stats.totales.en_transito)}</p></CardContent></Card>
                <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">Lead time promedio</p><p className="text-lg font-semibold">{stats.totales.lead_time_promedio != null ? `${stats.totales.lead_time_promedio} d` : "—"}</p></CardContent></Card>
                <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">Órdenes tarde</p><p className={`text-lg font-semibold ${stats.totales.ordenes_tarde > 0 ? "text-red-700" : ""}`}>{stats.totales.ordenes_tarde}</p></CardContent></Card>
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <Card>
                  <CardHeader className="p-4"><CardTitle className="text-base flex items-center gap-2"><Truck className="h-4 w-4" /> Por proveedor</CardTitle></CardHeader>
                  <CardContent className="p-4 pt-0">
                    <div className="overflow-x-auto border rounded-lg">
                      <Table>
                        <TableHeader><TableRow className="bg-stone-50"><TableHead>Proveedor</TableHead><TableHead className="text-right">OC</TableHead><TableHead className="text-right">Ordenado</TableHead><TableHead className="text-right">Cumpl.</TableHead><TableHead className="text-right">Lead time</TableHead><TableHead className="text-right">Tarde</TableHead></TableRow></TableHeader>
                        <TableBody>
                          {stats.porProveedor.map((p) => (
                            <TableRow key={String(p.proveedor_id)}>
                              <TableCell className="font-medium">{p.proveedor_nombre}</TableCell>
                              <TableCell className="text-right">{p.ordenes}</TableCell>
                              <TableCell className="text-right">{formatCurrency(p.valor_ordenado)}</TableCell>
                              <TableCell className="text-right">{p.cumplimiento}%</TableCell>
                              <TableCell className="text-right">{p.lead_time_promedio != null ? `${p.lead_time_promedio} d` : "—"}</TableCell>
                              <TableCell className={`text-right ${p.ordenes_tarde > 0 ? "text-red-700" : ""}`}>{p.ordenes_tarde}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="p-4"><CardTitle className="text-base">Productos más comprados</CardTitle></CardHeader>
                  <CardContent className="p-4 pt-0">
                    <div className="overflow-x-auto border rounded-lg">
                      <Table>
                        <TableHeader><TableRow className="bg-stone-50"><TableHead>Producto</TableHead><TableHead className="text-right">Unidades</TableHead><TableHead className="text-right">Valor (L)</TableHead><TableHead className="text-right">Costo prom.</TableHead><TableHead className="text-right">OC</TableHead></TableRow></TableHeader>
                        <TableBody>
                          {stats.topProductos.slice(0, 15).map((p) => (
                            <TableRow key={p.producto_id}>
                              <TableCell className="font-medium">{p.producto_nombre}</TableCell>
                              <TableCell className="text-right">{formatNumber(p.unidades)}</TableCell>
                              <TableCell className="text-right">{formatCurrency(p.valor_local)}</TableCell>
                              <TableCell className="text-right">{formatCurrency(p.costo_promedio_compra)}</TableCell>
                              <TableCell className="text-right">{p.ordenes}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </CardContent>
                </Card>
              </div>

              <Card>
                <CardHeader className="p-4 md:p-6"><CardTitle className="text-lg">Órdenes ({stats.ordenes.length})</CardTitle><CardDescription>Cumplimiento = unidades recibidas / ordenadas. Lead time = días entre la orden y la primera recepción.</CardDescription></CardHeader>
                <CardContent className="p-4 md:p-6 pt-0">
                  <div className="overflow-x-auto border rounded-lg">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-stone-50">
                          <TableHead>OC</TableHead><TableHead>Proveedor</TableHead><TableHead>Fecha</TableHead><TableHead>Estado</TableHead>
                          <TableHead className="text-right">Ordenado</TableHead><TableHead className="text-right">Recibido</TableHead><TableHead className="text-right">Cumpl.</TableHead>
                          <TableHead className="text-right">En tránsito</TableHead><TableHead className="text-right">Lead time</TableHead><TableHead className="text-right">Retraso</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {stats.ordenes.map((o) => (
                          <TableRow key={o.compra_id}>
                            <TableCell className="font-mono text-sm">OC-{String(o.compra_id).padStart(5, "0")}{o.numero_factura ? <span className="text-muted-foreground"> · {o.numero_factura}</span> : null}</TableCell>
                            <TableCell>{o.proveedor_nombre || "—"}</TableCell>
                            <TableCell className="whitespace-nowrap">{formatHondurasDate(o.fecha_orden)}</TableCell>
                            <TableCell><Badge variant="outline">{o.estado}</Badge></TableCell>
                            <TableCell className="text-right">{formatCurrency(o.valor_ordenado_local)}</TableCell>
                            <TableCell className="text-right">{formatCurrency(o.valor_recibido_local)}</TableCell>
                            <TableCell className={`text-right ${o.cumplimiento >= 100 ? "text-emerald-700" : o.cumplimiento > 0 ? "text-amber-700" : ""}`}>{o.cumplimiento}%</TableCell>
                            <TableCell className="text-right">{o.en_transito_local > 0 ? formatCurrency(o.en_transito_local) : "—"}</TableCell>
                            <TableCell className="text-right">{o.lead_time_dias != null ? `${o.lead_time_dias} d` : "—"}</TableCell>
                            <TableCell className={`text-right ${o.retraso_dias != null && o.retraso_dias > 0 ? "text-red-700" : ""}`}>{o.retraso_dias != null ? `${o.retraso_dias > 0 ? "+" : ""}${o.retraso_dias} d` : "—"}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            </>
          ) : null}
        </TabsContent>

        {/* ---------- Estado de cuenta proveedor ---------- */}
        <TabsContent value="proveedor" className="space-y-4">
          <Card>
            <CardContent className="p-4 grid gap-3 md:grid-cols-[1fr_auto_auto_auto_auto] md:items-end">
              <div className="grid gap-1.5">
                <Label>Proveedor</Label>
                <Popover open={provOpen} onOpenChange={setProvOpen}>
                  <PopoverTrigger asChild>
                    <Button variant="outline" role="combobox" className="justify-between font-normal">
                      <span className="truncate">{proveedor ? proveedor.nombre : "Elegir proveedor…"}</span>
                      <ChevronsUpDown className="h-4 w-4 opacity-50 shrink-0" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="p-0 w-[360px]" align="start">
                    <Command>
                      <CommandInput placeholder="Buscar proveedor…" />
                      <CommandList>
                        <CommandEmpty>Sin resultados.</CommandEmpty>
                        <CommandGroup>
                          {proveedores.map((p) => (
                            <CommandItem key={p.id} value={`${p.nombre} ${p.rtn || ""}`} onSelect={() => { setProveedorId(p.id ?? null); setProvOpen(false) }}>
                              <Check className={`mr-2 h-4 w-4 ${p.id === proveedorId ? "opacity-100" : "opacity-0"}`} />
                              <span className="truncate">{p.nombre}</span>
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>
              <div className="grid gap-1.5"><Label>Desde</Label><Input type="date" value={ecDesde} onChange={(e) => setEcDesde(e.target.value)} className="w-40" /></div>
              <div className="grid gap-1.5"><Label>Hasta</Label><Input type="date" value={ecHasta} onChange={(e) => setEcHasta(e.target.value)} className="w-40" /></div>
              <Button variant="outline" onClick={exportarEc} disabled={!ec} className="gap-1"><Download className="h-4 w-4" /> Excel</Button>
              <Button onClick={pdfEc} disabled={!ec || generandoPdf} className="gap-1">{generandoPdf ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />} PDF</Button>
            </CardContent>
          </Card>

          {proveedorId == null ? (
            <p className="py-10 text-center text-sm text-muted-foreground">Elige un proveedor.</p>
          ) : cargandoEc || !ec ? (
            <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground"><Spinner /> Calculando…</div>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-4">
                <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Saldo inicial</p><p className="text-xl font-semibold">{formatCurrency(ec.saldoInicial)}</p></CardContent></Card>
                <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Compras y gastos</p><p className="text-xl font-semibold">{formatCurrency(ec.totalDebitos)}</p></CardContent></Card>
                <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Pagos</p><p className="text-xl font-semibold">{formatCurrency(ec.totalCreditos)}</p></CardContent></Card>
                <Card className={ec.saldoFinal > 0.005 ? "border-red-200 bg-red-50/40" : ""}><CardContent className="p-4"><p className="text-xs text-muted-foreground">Le debemos</p><p className="text-xl font-semibold">{formatCurrency(ec.saldoFinal)}</p></CardContent></Card>
              </div>
              <Card>
                <CardHeader className="p-4 md:p-6"><CardTitle className="text-lg">Movimientos ({ec.movimientos.length})</CardTitle><CardDescription>Compras = recepciones de OC; Gastos = facturas de servicios con este proveedor; Pagos = anticipos, abonos y pagos de gastos.</CardDescription></CardHeader>
                <CardContent className="p-4 md:p-6 pt-0">
                  <div className="overflow-x-auto border rounded-lg">
                    <Table>
                      <TableHeader><TableRow className="bg-stone-50"><TableHead>Fecha</TableHead><TableHead>Tipo</TableHead><TableHead>Documento</TableHead><TableHead>Referencia</TableHead><TableHead className="text-right">Débito</TableHead><TableHead className="text-right">Crédito</TableHead><TableHead className="text-right">Saldo</TableHead></TableRow></TableHeader>
                      <TableBody>
                        <TableRow className="bg-stone-50/60"><TableCell colSpan={6} className="text-sm text-muted-foreground">Saldo inicial</TableCell><TableCell className="text-right font-medium">{formatCurrency(ec.saldoInicial)}</TableCell></TableRow>
                        {ec.movimientos.map((m, i) => (
                          <TableRow key={`${m.documento}-${i}`}>
                            <TableCell className="whitespace-nowrap">{formatHondurasDate(m.fecha)}</TableCell>
                            <TableCell><Badge variant="outline" className={m.tipo === "Pago" ? "border-emerald-300 text-emerald-700" : ""}>{m.tipo}</Badge></TableCell>
                            <TableCell className="text-sm">{m.documento}</TableCell>
                            <TableCell className="text-sm text-muted-foreground">{m.referencia || ""}</TableCell>
                            <TableCell className="text-right">{m.debito ? formatCurrency(m.debito) : ""}</TableCell>
                            <TableCell className="text-right">{m.credito ? formatCurrency(m.credito) : ""}</TableCell>
                            <TableCell className="text-right font-medium">{formatCurrency(m.saldo)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
              {ec.pendientes.length > 0 && (
                <Card>
                  <CardHeader className="p-4 md:p-6"><CardTitle className="text-lg">Documentos con saldo ({ec.pendientes.length})</CardTitle></CardHeader>
                  <CardContent className="p-4 md:p-6 pt-0">
                    <div className="overflow-x-auto border rounded-lg">
                      <Table>
                        <TableHeader><TableRow className="bg-stone-50"><TableHead>Documento</TableHead><TableHead>Fecha</TableHead><TableHead>Vence</TableHead><TableHead className="text-right">Total</TableHead><TableHead className="text-right">Saldo</TableHead><TableHead className="text-right">Vencido</TableHead></TableRow></TableHeader>
                        <TableBody>
                          {ec.pendientes.map((p) => (
                            <TableRow key={p.documento}>
                              <TableCell className="text-sm">{p.documento}</TableCell>
                              <TableCell className="whitespace-nowrap">{formatHondurasDate(p.fecha)}</TableCell>
                              <TableCell>{p.vence || "—"}</TableCell>
                              <TableCell className="text-right">{formatCurrency(p.total)}</TableCell>
                              <TableCell className="text-right font-medium">{formatCurrency(p.saldo)}</TableCell>
                              <TableCell className={`text-right ${p.dias_vencido ? "text-red-700 font-medium" : ""}`}>{p.dias_vencido ? `${p.dias_vencido} d` : "—"}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}
