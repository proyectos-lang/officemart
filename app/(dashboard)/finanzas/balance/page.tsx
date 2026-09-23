"use client"

import * as React from "react"
import { Scale, Download, FileDown, Loader2, RefreshCw, Info } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Spinner } from "@/components/ui/spinner"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useToast } from "@/hooks/use-toast"
import { useTenant } from "@/lib/hooks/use-tenant"
import { useAuth } from "@/lib/contexts/auth-context"
import { formatCurrency } from "@/lib/utils/format"
import { formatHondurasDate } from "@/lib/utils/honduras-time"
import { exportToXlsx } from "@/lib/utils/export"
import { getRazonSocialForPdf } from "@/lib/services/ventas"
import { getBalanceOperativo, type BalanceOperativo, type PartidaBalance } from "@/lib/services/balance"

function TablaBalance({ titulo, partidas, total, tono }: { titulo: string; partidas: PartidaBalance[]; total: number; tono: string }) {
  return (
    <Card>
      <CardHeader className="p-4 md:p-6"><CardTitle className="text-base">{titulo}</CardTitle></CardHeader>
      <CardContent className="p-4 md:p-6 pt-0">
        <div className="overflow-x-auto border rounded-lg">
          <Table>
            <TableHeader><TableRow className="bg-stone-50"><TableHead>Partida</TableHead><TableHead className="text-right">Monto</TableHead></TableRow></TableHeader>
            <TableBody>
              {partidas.map((p) => (
                <TableRow key={p.clave}>
                  <TableCell>
                    <p className="font-medium text-sm">{p.nombre}</p>
                    {p.detalle && <p className="text-xs text-muted-foreground">{p.detalle}</p>}
                    {p.nota && <p className="text-xs text-amber-700 flex items-center gap-1"><Info className="h-3 w-3" /> {p.nota}</p>}
                  </TableCell>
                  <TableCell className="text-right font-mono">{formatCurrency(p.monto)}</TableCell>
                </TableRow>
              ))}
              <TableRow className="bg-stone-50 font-semibold"><TableCell>Total</TableCell><TableCell className={`text-right font-mono ${tono}`}>{formatCurrency(total)}</TableCell></TableRow>
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  )
}

export default function BalancePage() {
  const { toast } = useToast()
  const { ready, razonSocialId } = useTenant()
  const { user } = useAuth()
  const [loading, setLoading] = React.useState(true)
  const [balance, setBalance] = React.useState<BalanceOperativo | null>(null)
  const [pdf, setPdf] = React.useState(false)

  const cargar = React.useCallback(async () => {
    setLoading(true)
    const { data, error } = await getBalanceOperativo()
    setLoading(false)
    if (error) toast({ title: "No se pudo calcular el balance", description: error, variant: "destructive" })
    setBalance(data)
  }, [toast])

  React.useEffect(() => {
    if (!ready || razonSocialId == null) return
    let activo = true
    getBalanceOperativo().then(({ data, error }) => {
      if (!activo) return
      if (error) toast({ title: "No se pudo calcular el balance", description: error, variant: "destructive" })
      setBalance(data)
      setLoading(false)
    })
    return () => {
      activo = false
    }
  }, [ready, razonSocialId, toast])

  function exportar() {
    if (!balance) return
    exportToXlsx(
      [
        ...balance.activos.map((p) => ({ Grupo: "Activo", Partida: p.nombre, Monto: p.monto, Detalle: p.detalle || "", Nota: p.nota || "" })),
        { Grupo: "Activo", Partida: "TOTAL ACTIVOS", Monto: balance.totalActivos, Detalle: "", Nota: "" },
        ...balance.pasivos.map((p) => ({ Grupo: "Pasivo", Partida: p.nombre, Monto: p.monto, Detalle: p.detalle || "", Nota: p.nota || "" })),
        { Grupo: "Pasivo", Partida: "TOTAL PASIVOS", Monto: balance.totalPasivos, Detalle: "", Nota: "" },
        { Grupo: "Patrimonio", Partida: "PATRIMONIO OPERATIVO", Monto: balance.patrimonio, Detalle: "Activos − Pasivos", Nota: "" },
        { Grupo: "Indicador", Partida: "Liquidez inmediata", Monto: balance.liquidez, Detalle: "Caja + Bancos − CxP exigibles", Nota: "" },
      ],
      { filename: `balance_operativo_${balance.fecha}`, sheetName: "Balance" }
    )
  }

  async function descargarPdf() {
    if (!balance) return
    setPdf(true)
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
      doc.text("BALANCE OPERATIVO", w - 14, 16, { align: "right" })
      doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(100, 100, 100)
      doc.text(`Al ${formatHondurasDate(balance.fecha)} · balance de gestión, sin partida doble`, w - 14, 22, { align: "right" })
      const fila = (p: PartidaBalance) => [p.nombre + (p.nota ? ` (${p.nota})` : ""), formatCurrency(p.monto)]
      autoTable(doc, {
        startY: 30,
        head: [["ACTIVOS", "Monto"]],
        body: [...balance.activos.map(fila), ["TOTAL ACTIVOS", formatCurrency(balance.totalActivos)]],
        styles: { fontSize: 9 }, headStyles: { fillColor: [41, 37, 36] }, columnStyles: { 1: { halign: "right" } },
        didParseCell: (d) => { if (d.row.index === balance.activos.length && d.section === "body") d.cell.styles.fontStyle = "bold" },
      })
      const y1 = ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 60) + 6
      autoTable(doc, {
        startY: y1,
        head: [["PASIVOS", "Monto"]],
        body: [...balance.pasivos.map(fila), ["TOTAL PASIVOS", formatCurrency(balance.totalPasivos)]],
        styles: { fontSize: 9 }, headStyles: { fillColor: [120, 113, 108] }, columnStyles: { 1: { halign: "right" } },
        didParseCell: (d) => { if (d.row.index === balance.pasivos.length && d.section === "body") d.cell.styles.fontStyle = "bold" },
      })
      const y2 = ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y1) + 6
      autoTable(doc, {
        startY: y2,
        body: [["PATRIMONIO OPERATIVO (activos − pasivos)", formatCurrency(balance.patrimonio)], ["Liquidez inmediata (caja + bancos − CxP exigibles)", formatCurrency(balance.liquidez)]],
        styles: { fontSize: 10, fontStyle: "bold" }, columnStyles: { 1: { halign: "right" } },
      })
      doc.setFontSize(7); doc.setTextColor(168, 162, 158)
      doc.text("Generado por EasyCount", w / 2, doc.internal.pageSize.getHeight() - 8, { align: "center" })
      doc.save(`Balance_operativo_${balance.fecha}.pdf`)
    } catch (err) {
      console.error(err)
      toast({ title: "No se pudo generar el PDF", variant: "destructive" })
    } finally {
      setPdf(false)
    }
  }

  return (
    <div className="space-y-4 md:space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-stone-200 p-2 text-stone-700"><Scale className="h-5 w-5" /></div>
          <div>
            <h1 className="text-2xl font-semibold text-stone-800">Balance operativo</h1>
            <p className="text-sm text-muted-foreground">Foto de gestión a hoy: lo que tienes (caja, bancos, cartera, inventario) contra lo que debes. No es contabilidad de partida doble.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={cargar} disabled={loading} className="gap-1"><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Actualizar</Button>
          <Button variant="outline" size="sm" onClick={exportar} disabled={!balance} className="gap-1"><Download className="h-4 w-4" /> Excel</Button>
          <Button size="sm" onClick={descargarPdf} disabled={!balance || pdf} className="gap-1">{pdf ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />} PDF</Button>
        </div>
      </div>

      {loading || !balance ? (
        <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground"><Spinner /> Calculando…</div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-4">
            <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Activos</p><p className="text-2xl font-semibold text-emerald-700">{formatCurrency(balance.totalActivos)}</p></CardContent></Card>
            <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Pasivos</p><p className="text-2xl font-semibold text-red-700">{formatCurrency(balance.totalPasivos)}</p></CardContent></Card>
            <Card className={balance.patrimonio < 0 ? "border-red-200 bg-red-50/40" : "border-emerald-200 bg-emerald-50/40"}><CardContent className="p-4"><p className="text-xs text-muted-foreground">Patrimonio operativo</p><p className="text-2xl font-semibold">{formatCurrency(balance.patrimonio)}</p></CardContent></Card>
            <Card className={balance.liquidez < 0 ? "border-amber-200 bg-amber-50/40" : ""}><CardContent className="p-4"><p className="text-xs text-muted-foreground">Liquidez inmediata</p><p className="text-2xl font-semibold">{formatCurrency(balance.liquidez)}</p><p className="text-xs text-muted-foreground">caja + bancos − CxP exigibles</p></CardContent></Card>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <TablaBalance titulo="Activos" partidas={balance.activos} total={balance.totalActivos} tono="text-emerald-700" />
            <TablaBalance titulo="Pasivos" partidas={balance.pasivos} total={balance.totalPasivos} tono="text-red-700" />
          </div>
          <Card>
            <CardContent className="p-4 text-xs text-muted-foreground">
              <CardDescription>
                Balance de gestión al {formatHondurasDate(balance.fecha)}: inventario a costo promedio (excluye mercancía en consignación, que no es tuya), cuentas por cobrar solo de facturas vigentes, CxP de gastos y de órdenes de compra a crédito, comisiones aprobadas y consignación por liquidar. No incluye activos fijos, préstamos ni impuestos por pagar; para estados financieros formales consulta a tu contador.
              </CardDescription>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
