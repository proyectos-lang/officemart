"use client"

import * as React from "react"
import { useSearchParams } from "next/navigation"
import { ClipboardList, ChevronsUpDown, Check, Download, FileDown, Loader2, AlertTriangle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Spinner } from "@/components/ui/spinner"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { useToast } from "@/hooks/use-toast"
import { useTenant } from "@/lib/hooks/use-tenant"
import { useAuth } from "@/lib/contexts/auth-context"
import { formatCurrency } from "@/lib/utils/format"
import { formatHondurasDate, getHondurasTodayISODate } from "@/lib/utils/honduras-time"
import { exportToXlsx } from "@/lib/utils/export"
import { getClientes, type Cliente } from "@/lib/services/catalogos"
import { getRazonSocialForPdf } from "@/lib/services/ventas"
import { getEstadoCuentaCliente, type EstadoCuenta } from "@/lib/services/estado-cuenta"

export default function EstadoCuentaPage() {
  return (
    <React.Suspense fallback={<div className="flex items-center gap-2 py-10 text-sm text-muted-foreground"><Spinner /> Cargando…</div>}>
      <EstadoCuentaInner />
    </React.Suspense>
  )
}

function EstadoCuentaInner() {
  const params = useSearchParams()
  const { toast } = useToast()
  const { ready, razonSocialId } = useTenant()
  const { user } = useAuth()
  const hoy = getHondurasTodayISODate()

  const [clientes, setClientes] = React.useState<Cliente[]>([])
  const [clienteId, setClienteId] = React.useState<number | null>(params.get("clienteId") ? Number(params.get("clienteId")) : null)
  const [clienteOpen, setClienteOpen] = React.useState(false)
  const [desde, setDesde] = React.useState("")
  const [hasta, setHasta] = React.useState(hoy)
  const [loading, setLoading] = React.useState(false)
  const [estado, setEstado] = React.useState<EstadoCuenta | null>(null)
  const [generandoPdf, setGenerandoPdf] = React.useState(false)

  React.useEffect(() => {
    if (!ready || razonSocialId == null) return
    getClientes().then((r) => setClientes(r.data || []))
  }, [ready, razonSocialId])

  const cliente = React.useMemo(() => clientes.find((c) => c.id === clienteId) ?? null, [clientes, clienteId])

  const cargar = React.useCallback(async () => {
    if (clienteId == null) return
    setLoading(true)
    const { data, error } = await getEstadoCuentaCliente(clienteId, { desde: desde || null, hasta: hasta || null, hoyISO: hoy })
    setLoading(false)
    if (error) {
      toast({ title: "No se pudo cargar el estado de cuenta", description: error, variant: "destructive" })
      return
    }
    setEstado(data)
  }, [clienteId, desde, hasta, hoy, toast])

  React.useEffect(() => {
    if (!ready || razonSocialId == null || clienteId == null) return
    cargar()
  }, [ready, razonSocialId, clienteId, cargar])

  function exportar() {
    if (!estado || !cliente) return
    exportToXlsx(
      [
        { Fecha: "", Tipo: "Saldo inicial", Documento: "", Referencia: "", Debito: "", Credito: "", Saldo: estado.saldoInicial },
        ...estado.movimientos.map((m) => ({
          Fecha: formatHondurasDate(m.fecha),
          Tipo: m.tipo,
          Documento: m.documento,
          Referencia: m.referencia || "",
          Debito: m.debito || "",
          Credito: m.credito || "",
          Saldo: m.saldo,
        })),
      ],
      { filename: `estado_cuenta_${cliente.nombre.replace(/\s+/g, "_")}`, sheetName: "Estado de cuenta" }
    )
  }

  async function descargarPdf() {
    if (!estado || !cliente) return
    setGenerandoPdf(true)
    try {
      const [{ jsPDF }, autoTableMod, empresa] = await Promise.all([import("jspdf"), import("jspdf-autotable"), getRazonSocialForPdf()])
      const autoTable = autoTableMod.default
      const doc = new jsPDF()
      const w = doc.internal.pageSize.getWidth()
      doc.setFont("helvetica", "bold"); doc.setFontSize(14); doc.setTextColor(30, 30, 30)
      doc.text(empresa?.nombre_comercial || empresa?.nombre_empresa || user?.razon_social_nombre || "Empresa", 14, 16)
      doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(100, 100, 100)
      doc.text(`RTN: ${empresa?.documento || "N/A"}   Tel: ${empresa?.telefono || "N/A"}`, 14, 22)
      doc.setFont("helvetica", "bold"); doc.setFontSize(16); doc.setTextColor(30, 30, 30)
      doc.text("ESTADO DE CUENTA", w - 14, 16, { align: "right" })
      doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(100, 100, 100)
      doc.text(`Emitido: ${formatHondurasDate(hoy)}`, w - 14, 22, { align: "right" })
      doc.setTextColor(30, 30, 30); doc.setFontSize(10)
      doc.text(`Cliente: ${cliente.nombre}`, 14, 32)
      doc.setFontSize(9); doc.setTextColor(100, 100, 100)
      doc.text(`RTN: ${cliente.rtn || "N/A"}   Período: ${desde ? formatHondurasDate(desde) : "inicio"} a ${formatHondurasDate(hasta || hoy)}`, 14, 37)

      autoTable(doc, {
        startY: 42,
        head: [["Fecha", "Tipo", "Documento", "Referencia", "Débito", "Crédito", "Saldo"]],
        body: [
          ["", "Saldo inicial", "", "", "", "", formatCurrency(estado.saldoInicial)],
          ...estado.movimientos.map((m) => [
            formatHondurasDate(m.fecha),
            m.tipo,
            m.documento,
            m.referencia || "",
            m.debito ? formatCurrency(m.debito) : "",
            m.credito ? formatCurrency(m.credito) : "",
            formatCurrency(m.saldo),
          ]),
        ],
        foot: [["", "", "", "Totales", formatCurrency(estado.totalDebitos), formatCurrency(estado.totalCreditos), formatCurrency(estado.saldoFinal)]],
        styles: { fontSize: 8 },
        headStyles: { fillColor: [41, 37, 36] },
        footStyles: { fillColor: [245, 245, 244], textColor: [30, 30, 30], fontStyle: "bold" },
        columnStyles: { 4: { halign: "right" }, 5: { halign: "right" }, 6: { halign: "right" } },
      })

      const y = ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 60) + 8
      doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.setTextColor(30, 30, 30)
      doc.text("Antigüedad de saldos", 14, y)
      const a = estado.antiguedad
      autoTable(doc, {
        startY: y + 3,
        head: [["Corriente", "1–30 días", "31–60 días", "61–90 días", "> 90 días", "Total"]],
        body: [[a.corriente, a.d1_30, a.d31_60, a.d61_90, a.mas90, a.total].map(formatCurrency)],
        styles: { fontSize: 8, halign: "right" },
        headStyles: { fillColor: [120, 113, 108] },
      })
      if (estado.pendientes.length > 0) {
        const y2 = ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y) + 8
        doc.text("Facturas pendientes", 14, y2)
        autoTable(doc, {
          startY: y2 + 3,
          head: [["Factura", "Fecha", "Días", "Total", "Saldo"]],
          body: estado.pendientes.map((p) => [p.numero_factura, formatHondurasDate(p.fecha), String(p.dias), formatCurrency(p.total), formatCurrency(p.saldo)]),
          styles: { fontSize: 8 },
          headStyles: { fillColor: [120, 113, 108] },
          columnStyles: { 2: { halign: "right" }, 3: { halign: "right" }, 4: { halign: "right" } },
        })
      }
      doc.setFontSize(7); doc.setTextColor(168, 162, 158)
      doc.text("Generado por EasyCount", w / 2, doc.internal.pageSize.getHeight() - 8, { align: "center" })
      doc.save(`Estado_cuenta_${cliente.nombre.replace(/\s+/g, "_")}.pdf`)
    } catch (err) {
      console.error(err)
      toast({ title: "No se pudo generar el PDF", variant: "destructive" })
    } finally {
      setGenerandoPdf(false)
    }
  }

  const a = estado?.antiguedad

  return (
    <div className="space-y-4 md:space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-emerald-100 p-2 text-emerald-700">
            <ClipboardList className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold text-stone-800">Estado de cuenta</h1>
            <p className="text-sm text-muted-foreground">Facturas, abonos y devoluciones de un cliente con saldo corrido y antigüedad.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={exportar} disabled={!estado} className="gap-1"><Download className="h-4 w-4" /> Excel</Button>
          <Button size="sm" onClick={descargarPdf} disabled={!estado || generandoPdf} className="gap-1">
            {generandoPdf ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />} PDF
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-4 grid gap-3 md:grid-cols-[1fr_auto_auto] md:items-end">
          <div className="grid gap-1.5">
            <Label>Cliente</Label>
            <Popover open={clienteOpen} onOpenChange={setClienteOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" role="combobox" className="justify-between font-normal">
                  <span className="truncate">{cliente ? cliente.nombre : "Elegir cliente…"}</span>
                  <ChevronsUpDown className="h-4 w-4 opacity-50 shrink-0" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="p-0 w-[360px]" align="start">
                <Command>
                  <CommandInput placeholder="Buscar cliente…" />
                  <CommandList>
                    <CommandEmpty>Sin resultados.</CommandEmpty>
                    <CommandGroup>
                      {clientes.map((c) => (
                        <CommandItem key={c.id} value={`${c.nombre} ${c.rtn || ""}`} onSelect={() => { setClienteId(c.id ?? null); setClienteOpen(false) }}>
                          <Check className={`mr-2 h-4 w-4 ${c.id === clienteId ? "opacity-100" : "opacity-0"}`} />
                          <span className="truncate">{c.nombre}</span>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>
          <div className="grid gap-1.5">
            <Label>Desde</Label>
            <Input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className="w-40" />
          </div>
          <div className="grid gap-1.5">
            <Label>Hasta</Label>
            <Input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className="w-40" />
          </div>
        </CardContent>
      </Card>

      {clienteId == null ? (
        <p className="py-10 text-center text-sm text-muted-foreground">Elige un cliente para ver su estado de cuenta.</p>
      ) : loading || !estado ? (
        <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground"><Spinner /> Calculando…</div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-4">
            <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Saldo inicial</p><p className="text-xl font-semibold">{formatCurrency(estado.saldoInicial)}</p></CardContent></Card>
            <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Facturado (débitos)</p><p className="text-xl font-semibold">{formatCurrency(estado.totalDebitos)}</p></CardContent></Card>
            <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Abonos y devoluciones</p><p className="text-xl font-semibold">{formatCurrency(estado.totalCreditos)}</p></CardContent></Card>
            <Card className={estado.saldoFinal > 0.005 ? "border-amber-200 bg-amber-50/40" : ""}><CardContent className="p-4"><p className="text-xs text-muted-foreground">Saldo final</p><p className="text-xl font-semibold">{formatCurrency(estado.saldoFinal)}</p></CardContent></Card>
          </div>

          {a && a.total > 0 && (
            <Card>
              <CardHeader className="p-4 pb-2"><CardTitle className="text-base">Antigüedad de saldos (a hoy)</CardTitle></CardHeader>
              <CardContent className="p-4 pt-0 grid gap-2 grid-cols-2 sm:grid-cols-6 text-sm">
                {[
                  ["Corriente", a.corriente, ""],
                  ["1–30 días", a.d1_30, ""],
                  ["31–60 días", a.d31_60, "text-amber-700"],
                  ["61–90 días", a.d61_90, "text-orange-700"],
                  ["> 90 días", a.mas90, "text-red-700"],
                  ["Total", a.total, "font-semibold"],
                ].map(([label, val, cls]) => (
                  <div key={String(label)} className="rounded-md border p-2">
                    <p className="text-xs text-muted-foreground">{label}</p>
                    <p className={`font-medium ${cls}`}>{formatCurrency(Number(val))}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="p-4 md:p-6">
              <CardTitle className="text-lg">Movimientos ({estado.movimientos.length})</CardTitle>
              <CardDescription>Ventas anuladas y recibos anulados no aparecen. El saldo inicial resume lo anterior a la fecha &laquo;Desde&raquo;.</CardDescription>
            </CardHeader>
            <CardContent className="p-4 md:p-6 pt-0">
              <div className="overflow-x-auto border rounded-lg">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-stone-50">
                      <TableHead>Fecha</TableHead>
                      <TableHead>Tipo</TableHead>
                      <TableHead>Documento</TableHead>
                      <TableHead>Referencia</TableHead>
                      <TableHead className="text-right">Débito</TableHead>
                      <TableHead className="text-right">Crédito</TableHead>
                      <TableHead className="text-right">Saldo</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <TableRow className="bg-stone-50/60">
                      <TableCell colSpan={6} className="text-sm text-muted-foreground">Saldo inicial</TableCell>
                      <TableCell className="text-right font-medium">{formatCurrency(estado.saldoInicial)}</TableCell>
                    </TableRow>
                    {estado.movimientos.map((m, i) => (
                      <TableRow key={`${m.tipo}-${m.documento}-${i}`}>
                        <TableCell className="whitespace-nowrap">{formatHondurasDate(m.fecha)}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={m.tipo === "Factura" ? "border-stone-300" : m.tipo === "Abono" ? "border-emerald-300 text-emerald-700" : "border-sky-300 text-sky-700"}>{m.tipo}</Badge>
                        </TableCell>
                        <TableCell className="font-mono text-sm">{m.documento}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{m.referencia || ""}</TableCell>
                        <TableCell className="text-right">{m.debito ? formatCurrency(m.debito) : ""}</TableCell>
                        <TableCell className="text-right">{m.credito ? formatCurrency(m.credito) : ""}</TableCell>
                        <TableCell className="text-right font-medium">{formatCurrency(m.saldo)}</TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="bg-stone-50 font-semibold">
                      <TableCell colSpan={4}>Totales del período</TableCell>
                      <TableCell className="text-right">{formatCurrency(estado.totalDebitos)}</TableCell>
                      <TableCell className="text-right">{formatCurrency(estado.totalCreditos)}</TableCell>
                      <TableCell className="text-right">{formatCurrency(estado.saldoFinal)}</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          {estado.pendientes.length > 0 && (
            <Card>
              <CardHeader className="p-4 md:p-6">
                <CardTitle className="text-lg flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-amber-600" /> Facturas pendientes ({estado.pendientes.length})</CardTitle>
                <CardDescription>Saldo por factura a hoy (independiente del rango de fechas).</CardDescription>
              </CardHeader>
              <CardContent className="p-4 md:p-6 pt-0">
                <div className="overflow-x-auto border rounded-lg">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-stone-50">
                        <TableHead>Factura</TableHead>
                        <TableHead>Fecha</TableHead>
                        <TableHead className="text-right">Días</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                        <TableHead className="text-right">Saldo</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {estado.pendientes.map((p) => (
                        <TableRow key={p.venta_id}>
                          <TableCell className="font-mono text-sm">{p.numero_factura}</TableCell>
                          <TableCell className="whitespace-nowrap">{formatHondurasDate(p.fecha)}</TableCell>
                          <TableCell className={`text-right ${p.dias > 60 ? "text-red-700 font-medium" : p.dias > 30 ? "text-amber-700" : ""}`}>{p.dias}</TableCell>
                          <TableCell className="text-right">{formatCurrency(p.total)}</TableCell>
                          <TableCell className="text-right font-medium">{formatCurrency(p.saldo)}</TableCell>
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
    </div>
  )
}
