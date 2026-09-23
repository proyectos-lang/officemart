"use client"

import * as React from "react"
import Link from "next/link"
import { PackageMinus, PackageCheck, XCircle, Loader2, Download } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Spinner } from "@/components/ui/spinner"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { useToast } from "@/hooks/use-toast"
import { useTenant } from "@/lib/hooks/use-tenant"
import { useAuth } from "@/lib/contexts/auth-context"
import { formatCurrency, formatNumber } from "@/lib/utils/format"
import { formatHondurasDate, getHondurasTodayISODate } from "@/lib/utils/honduras-time"
import { exportToXlsx } from "@/lib/utils/export"
import { getBackorders, cerrarBackorder, RECEPCIONES_FEATURE_PENDING, type Backorder } from "@/lib/services/compras-recepciones"

export default function BackorderPage() {
  const { toast } = useToast()
  const { ready, razonSocialId } = useTenant()
  const { hasModulo } = useAuth()
  const hoy = getHondurasTodayISODate()

  const [loading, setLoading] = React.useState(true)
  const [pendiente, setPendiente] = React.useState(false)
  const [backorders, setBackorders] = React.useState<Backorder[]>([])
  const [cerrando, setCerrando] = React.useState<Backorder | null>(null)
  const [motivo, setMotivo] = React.useState("")
  const [guardando, setGuardando] = React.useState(false)

  React.useEffect(() => {
    if (!ready || razonSocialId == null) return
    cargar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, razonSocialId])

  async function cargar() {
    setLoading(true)
    const { data, error, pendiente: p } = await getBackorders()
    setPendiente(p)
    if (error) toast({ title: "No se pudieron cargar los backorders", description: error, variant: "destructive" })
    setBackorders(data)
    setLoading(false)
  }

  async function confirmarCierre() {
    if (!cerrando?.compra.id) return
    setGuardando(true)
    const { error } = await cerrarBackorder(cerrando.compra.id, motivo)
    setGuardando(false)
    if (error) {
      toast({ title: "No se pudo cerrar", description: error, variant: "destructive" })
      return
    }
    toast({ title: `OC-${cerrando.compra.id} cerrada`, description: "Lo pendiente ya no se espera; la orden queda Recibida." })
    setCerrando(null)
    setMotivo("")
    cargar()
  }

  function diasEspera(fechaOrden?: string | null): number | null {
    if (!fechaOrden) return null
    const a = new Date(`${fechaOrden.slice(0, 10)}T00:00:00Z`).getTime()
    const b = new Date(`${hoy}T00:00:00Z`).getTime()
    return Math.max(0, Math.round((b - a) / 86_400_000))
  }

  function exportar() {
    exportToXlsx(
      backorders.flatMap((b) =>
        b.lineas.map((l) => ({
          OC: `OC-${b.compra.id}`,
          Proveedor: b.compra.proveedor_nombre || "",
          "Fecha orden": formatHondurasDate(b.compra.fecha_orden),
          "Fecha tentativa": b.compra.fecha_tentativa || "",
          Producto: l.producto_nombre || "",
          Codigo: l.producto_codigo || "",
          Ordenado: l.cantidad,
          Recibido: l.cantidad_recibida ?? 0,
          Pendiente: l.pendiente,
          "Costo unit.": l.costo_unitario_moneda_origen,
          Moneda: b.compra.moneda,
        }))
      ),
      { filename: "backorder", sheetName: "Backorder" }
    )
  }

  const totalPendiente = backorders.reduce((a, b) => a + b.totalPendiente, 0)

  return (
    <div className="space-y-4 md:space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-orange-100 p-2 text-orange-700">
            <PackageMinus className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold text-stone-800">Backorder</h1>
            <p className="text-sm text-muted-foreground">Órdenes de compra recibidas parcialmente: lo que el proveedor aún debe entregar.</p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={exportar} disabled={backorders.length === 0} className="gap-1"><Download className="h-4 w-4" /> Excel</Button>
      </div>

      {pendiente && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{RECEPCIONES_FEATURE_PENDING}</div>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Órdenes con pendiente</p><p className="text-2xl font-semibold">{backorders.length}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Líneas pendientes</p><p className="text-2xl font-semibold">{backorders.reduce((a, b) => a + b.lineas.length, 0)}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Valor pendiente (L, aprox.)</p><p className="text-2xl font-semibold">{formatCurrency(totalPendiente)}</p></CardContent></Card>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground"><Spinner /> Cargando…</div>
      ) : backorders.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">No hay órdenes con pendiente de entrega. Las OC sin ninguna recepción están en Recepción por OC.</CardContent></Card>
      ) : (
        backorders.map((b) => {
          const dias = diasEspera(b.compra.fecha_orden)
          const vencida = b.compra.fecha_tentativa && b.compra.fecha_tentativa < hoy
          return (
            <Card key={b.compra.id}>
              <CardHeader className="p-4 md:p-6">
                <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                  <div>
                    <CardTitle className="text-base flex items-center gap-2">
                      OC-{String(b.compra.id).padStart(5, "0")} · {b.compra.proveedor_nombre || "Proveedor"}
                      {vencida && <Badge variant="outline" className="border-0 bg-red-100 text-red-700">Fecha tentativa vencida</Badge>}
                    </CardTitle>
                    <CardDescription>
                      Ordenada el {formatHondurasDate(b.compra.fecha_orden)}{dias != null ? ` · ${dias} días esperando` : ""}
                      {b.compra.fecha_tentativa ? ` · llegada tentativa ${b.compra.fecha_tentativa}` : ""}
                      {b.compra.numero_factura ? ` · factura ${b.compra.numero_factura}` : ""}
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    {hasModulo("Recepcion por OC") && (
                      <Button size="sm" asChild className="gap-1">
                        <Link href="/compras/recepcion"><PackageCheck className="h-4 w-4" /> Recibir</Link>
                      </Button>
                    )}
                    <Button size="sm" variant="outline" className="gap-1 text-red-700" onClick={() => { setCerrando(b); setMotivo("") }}>
                      <XCircle className="h-4 w-4" /> Cerrar pendiente
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-4 md:p-6 pt-0">
                <div className="overflow-x-auto border rounded-lg">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-stone-50">
                        <TableHead>Producto</TableHead>
                        <TableHead className="text-right">Ordenado</TableHead>
                        <TableHead className="text-right">Recibido</TableHead>
                        <TableHead className="text-right">Pendiente</TableHead>
                        <TableHead className="text-right">Costo unit. ({b.compra.moneda})</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {b.lineas.map((l) => (
                        <TableRow key={l.id}>
                          <TableCell>
                            <p className="font-medium text-sm">{l.producto_nombre}</p>
                            <p className="text-xs text-muted-foreground font-mono">{l.producto_codigo || ""}</p>
                          </TableCell>
                          <TableCell className="text-right">{formatNumber(l.cantidad)}</TableCell>
                          <TableCell className="text-right">{formatNumber(l.cantidad_recibida ?? 0)}</TableCell>
                          <TableCell className="text-right font-semibold text-orange-700">{formatNumber(l.pendiente)}</TableCell>
                          <TableCell className="text-right">{formatNumber(l.costo_unitario_moneda_origen)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )
        })
      )}

      <Dialog open={cerrando !== null} onOpenChange={(o) => { if (!o) setCerrando(null) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Cerrar pendiente de OC-{cerrando?.compra.id}</DialogTitle>
            <DialogDescription>
              Lo que falta ya no llegará (o se anuló con el proveedor). La orden pasa a Recibida con lo que entró; el costo y el
              inventario no cambian. No se puede deshacer.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="bo-motivo">Motivo</Label>
            <Textarea id="bo-motivo" rows={3} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Proveedor sin existencias, sustituido por otra OC…" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCerrando(null)}>Cancelar</Button>
            <Button variant="destructive" onClick={confirmarCierre} disabled={guardando || !motivo.trim()} className="gap-2">
              {guardando && <Loader2 className="h-4 w-4 animate-spin" />} Cerrar pendiente
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
