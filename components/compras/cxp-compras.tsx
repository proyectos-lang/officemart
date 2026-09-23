"use client"

import * as React from "react"
import Link from "next/link"
import { ShoppingBag } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Spinner } from "@/components/ui/spinner"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { formatCurrency } from "@/lib/utils/format"
import { formatHondurasDate, getHondurasTodayISODate } from "@/lib/utils/honduras-time"
import { getCuentasPorPagarCompras, type CuentaPorPagarCompra } from "@/lib/services/compras-recepciones"

/**
 * Sección "Compras a crédito" de Cuentas por Pagar: órdenes de compra con
 * saldo (lo recibido − pagos) del script officemart-008. Los abonos se
 * registran desde el detalle de la OC (Compras → Orden de Compra).
 */
export function CxpComprasSection({ refreshKey = 0 }: { refreshKey?: number }) {
  const [loading, setLoading] = React.useState(true)
  const [filas, setFilas] = React.useState<CuentaPorPagarCompra[]>([])
  const [total, setTotal] = React.useState(0)
  const [pendiente, setPendiente] = React.useState(false)

  React.useEffect(() => {
    let vivo = true
    setLoading(true)
    getCuentasPorPagarCompras(getHondurasTodayISODate()).then((r) => {
      if (!vivo) return
      setFilas(r.data)
      setTotal(r.totalDeuda)
      setPendiente(r.pendiente)
      setLoading(false)
    })
    return () => {
      vivo = false
    }
  }, [refreshKey])

  if (pendiente) return null

  return (
    <Card className="bg-white rounded-2xl border-stone-200/60 shadow-sm">
      <CardHeader>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <CardTitle className="text-lg text-stone-800 flex items-center gap-2">
              <ShoppingBag className="h-5 w-5 text-orange-600" /> Compras a crédito (órdenes de compra)
            </CardTitle>
            <CardDescription>Saldo por orden = mercancía recibida − anticipos y abonos. Se paga desde el detalle de la orden.</CardDescription>
          </div>
          <div className="text-right">
            <p className="text-xs text-stone-500">Deuda con proveedores (OC)</p>
            <p className="text-xl font-bold text-red-700">{formatCurrency(total)}</p>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground"><Spinner /> Cargando…</div>
        ) : filas.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No hay órdenes de compra con saldo pendiente.</p>
        ) : (
          <div className="overflow-x-auto border rounded-lg">
            <Table>
              <TableHeader>
                <TableRow className="bg-stone-50">
                  <TableHead>Orden</TableHead>
                  <TableHead>Proveedor</TableHead>
                  <TableHead>Vence</TableHead>
                  <TableHead className="text-right">Recibido</TableHead>
                  <TableHead className="text-right">Pagado</TableHead>
                  <TableHead className="text-right">Saldo</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="w-24" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filas.map((f) => (
                  <TableRow key={f.compra_id}>
                    <TableCell className="font-mono text-sm">OC-{String(f.compra_id).padStart(5, "0")}{f.numero_factura ? <span className="text-muted-foreground"> · {f.numero_factura}</span> : null}</TableCell>
                    <TableCell>{f.proveedor_nombre || "—"}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      {f.fecha_vencimiento ? (
                        <span className={f.dias_vencido && f.dias_vencido > 0 ? "text-red-700 font-medium" : ""}>
                          {formatHondurasDate(f.fecha_vencimiento)}{f.dias_vencido && f.dias_vencido > 0 ? ` (+${f.dias_vencido} d)` : ""}
                        </span>
                      ) : "—"}
                    </TableCell>
                    <TableCell className="text-right">{formatCurrency(f.total_debido)}</TableCell>
                    <TableCell className="text-right">{formatCurrency(f.monto_pagado)}</TableCell>
                    <TableCell className="text-right font-semibold">{formatCurrency(f.saldo)}</TableCell>
                    <TableCell><Badge variant="outline" className={f.estado_pago === "Parcial" ? "text-amber-700" : ""}>{f.estado_pago}</Badge></TableCell>
                    <TableCell>
                      <Button size="sm" variant="outline" asChild><Link href="/compras/orden">Ver orden</Link></Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
