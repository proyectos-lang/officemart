"use client"

import * as React from "react"
import { PackageCheck, Wallet, Plus, Ban, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Spinner } from "@/components/ui/spinner"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { useToast } from "@/hooks/use-toast"
import { formatCurrency, formatNumber } from "@/lib/utils/format"
import { formatHondurasDate } from "@/lib/utils/honduras-time"
import { getCuentas, type CuentaConfig } from "@/lib/services/cuentas"
import type { CompraEncabezado } from "@/lib/services/compras"
import {
  getRecepcionesCompra, getPagosCompra, registrarPagoCompra, anularPagoCompra, derivarEstadoPagoCompra,
  type Recepcion, type PagoCompra,
} from "@/lib/services/compras-recepciones"

/**
 * Recepciones y pagos (anticipos / abonos) de una orden de compra
 * (script officemart-008). Se monta en el detalle de la OC. Si el script no
 * está aplicado, no muestra nada (las listas vienen `pendiente`).
 */
export function OcRecepcionesPagos({ compra, onChange }: { compra: CompraEncabezado; onChange?: () => void }) {
  const { toast } = useToast()
  const compraId = compra.id!
  const [loading, setLoading] = React.useState(true)
  const [pendiente, setPendiente] = React.useState(false)
  const [recepciones, setRecepciones] = React.useState<Recepcion[]>([])
  const [pagos, setPagos] = React.useState<PagoCompra[]>([])
  const [cuentas, setCuentas] = React.useState<CuentaConfig[]>([])

  // Nuevo pago
  const [pagoOpen, setPagoOpen] = React.useState(false)
  const [tipo, setTipo] = React.useState<"Anticipo" | "Abono">("Abono")
  const [monto, setMonto] = React.useState("")
  const [metodo, setMetodo] = React.useState<"Efectivo" | "Banco">("Efectivo")
  const [cuentaId, setCuentaId] = React.useState("")
  const [referencia, setReferencia] = React.useState("")
  const [guardando, setGuardando] = React.useState(false)
  // Anular
  const [anulando, setAnulando] = React.useState<PagoCompra | null>(null)
  const [motivo, setMotivo] = React.useState("")

  const cargar = React.useCallback(async () => {
    setLoading(true)
    const [r, p, c] = await Promise.all([getRecepcionesCompra(compraId), getPagosCompra(compraId), getCuentas()])
    setPendiente(r.pendiente || p.pendiente)
    setRecepciones(r.data)
    setPagos(p.data)
    setCuentas((c.data || []).filter((x) => x.activo ?? true))
    setLoading(false)
  }, [compraId])

  React.useEffect(() => {
    cargar()
  }, [cargar])

  const vigentes = pagos.filter((p) => !p.anulado_at)
  const pagado = vigentes.reduce((a, p) => a + p.monto, 0)
  const recibido = recepciones.reduce((a, r) => a + r.total_local, 0)
  const saldo = +(recibido - pagado).toFixed(2)
  const estadoPago = derivarEstadoPagoCompra(recibido, pagado)

  function abrirPago() {
    setTipo(recepciones.length === 0 ? "Anticipo" : "Abono")
    setMonto(saldo > 0 ? String(saldo) : "")
    setMetodo("Efectivo")
    setCuentaId("")
    setReferencia("")
    setPagoOpen(true)
  }

  async function guardarPago() {
    const m = Number(monto)
    if (!(m > 0)) {
      toast({ title: "Monto inválido", variant: "destructive" })
      return
    }
    if (metodo === "Banco" && !cuentaId) {
      toast({ title: "Elige la cuenta bancaria", variant: "destructive" })
      return
    }
    setGuardando(true)
    const { error } = await registrarPagoCompra({
      compra_id: compraId,
      tipo,
      monto: m,
      metodo,
      cuenta_id: metodo === "Banco" ? Number(cuentaId) : null,
      referencia: referencia || null,
    })
    setGuardando(false)
    if (error) {
      toast({ title: "No se pudo registrar el pago", description: error, variant: "destructive" })
      return
    }
    toast({ title: `${tipo} registrado`, description: formatCurrency(m) })
    setPagoOpen(false)
    cargar()
    onChange?.()
  }

  async function confirmarAnular() {
    if (!anulando) return
    setGuardando(true)
    const { error } = await anularPagoCompra(anulando.id, motivo)
    setGuardando(false)
    if (error) {
      toast({ title: "No se pudo anular", description: error, variant: "destructive" })
      return
    }
    toast({ title: "Pago anulado", description: "El dinero volvió a caja/cuenta." })
    setAnulando(null)
    setMotivo("")
    cargar()
    onChange?.()
  }

  if (pendiente) return null
  if (loading) return <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground"><Spinner /> Cargando recepciones y pagos…</div>

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {/* Recepciones */}
      <Card>
        <CardHeader className="p-4 md:p-6">
          <CardTitle className="text-base flex items-center gap-2"><PackageCheck className="h-4 w-4" /> Recepciones ({recepciones.length})</CardTitle>
          <CardDescription>
            Recibido: <strong>{formatCurrency(recibido)}</strong>
            {compra.estado_recepcion ? <> · <Badge variant="outline">{compra.estado_recepcion}</Badge></> : null}
            {compra.cerrada_at ? <> · cerrada: {compra.motivo_cierre}</> : null}
          </CardDescription>
        </CardHeader>
        <CardContent className="p-4 md:p-6 pt-0 space-y-3">
          {recepciones.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aún no se ha recibido nada de esta orden.</p>
          ) : (
            recepciones.map((r) => (
              <div key={r.id} className="border rounded-lg p-3">
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="font-medium">Recepción #{r.numero} · {formatHondurasDate(r.fecha)}</span>
                  <span className="font-semibold">{formatCurrency(r.total_local)}</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {r.numero_factura_proveedor ? `Factura ${r.numero_factura_proveedor} · ` : ""}
                  costos extra {formatCurrency(r.costos_importacion + r.impuestos_compra + r.otros_costos)}
                  {r.tasa_cambio !== 1 ? ` · tasa ${r.tasa_cambio}` : ""}
                </p>
                {r.detalle && r.detalle.length > 0 && (
                  <ul className="mt-2 text-xs space-y-0.5">
                    {r.detalle.map((d) => (
                      <li key={d.id} className="flex justify-between gap-2">
                        <span className="truncate">{d.producto_nombre || `#${d.producto_id}`}</span>
                        <span className="whitespace-nowrap text-muted-foreground">{formatNumber(d.cantidad)} × {formatCurrency(d.costo_final_local)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {/* Pagos */}
      <Card>
        <CardHeader className="p-4 md:p-6">
          <div className="flex items-start justify-between gap-2">
            <div>
              <CardTitle className="text-base flex items-center gap-2"><Wallet className="h-4 w-4" /> Pagos al proveedor</CardTitle>
              <CardDescription>
                Pagado <strong>{formatCurrency(pagado)}</strong> · saldo <strong className={saldo > 0 ? "text-red-700" : ""}>{formatCurrency(Math.max(0, saldo))}</strong>{" "}
                <Badge variant="outline" className={estadoPago === "Pagado" ? "text-emerald-700" : estadoPago === "Parcial" ? "text-amber-700" : ""}>{estadoPago}</Badge>
                {compra.fecha_vencimiento ? <> · vence {compra.fecha_vencimiento}</> : null}
              </CardDescription>
            </div>
            <Button size="sm" onClick={abrirPago} className="gap-1"><Plus className="h-4 w-4" /> {recepciones.length === 0 ? "Anticipo" : "Abono"}</Button>
          </div>
        </CardHeader>
        <CardContent className="p-4 md:p-6 pt-0">
          {pagos.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin pagos registrados.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Método</TableHead>
                  <TableHead className="text-right">Monto</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {pagos.map((p) => (
                  <TableRow key={p.id} className={p.anulado_at ? "opacity-50 line-through" : ""}>
                    <TableCell className="whitespace-nowrap text-sm">{formatHondurasDate(p.fecha)}</TableCell>
                    <TableCell className="text-sm">{p.tipo}</TableCell>
                    <TableCell className="text-sm">{p.metodo}{p.referencia ? ` · ${p.referencia}` : ""}</TableCell>
                    <TableCell className="text-right font-medium">{formatCurrency(p.monto)}</TableCell>
                    <TableCell>
                      {!p.anulado_at && (
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-red-600" title="Anular pago" onClick={() => { setAnulando(p); setMotivo("") }}>
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

      {/* Nuevo pago */}
      <Dialog open={pagoOpen} onOpenChange={setPagoOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{tipo} a OC-{compraId}</DialogTitle>
            <DialogDescription>El dinero sale de caja chica (efectivo) o de la cuenta bancaria elegida.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label>Tipo</Label>
              <Select value={tipo} onValueChange={(v) => setTipo(v as "Anticipo" | "Abono")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Anticipo">Anticipo (antes de recibir)</SelectItem>
                  <SelectItem value="Abono">Abono</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Monto (L)</Label>
              <Input type="number" min="0.01" step="any" value={monto} onChange={(e) => setMonto(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label>Método</Label>
              <Select value={metodo} onValueChange={(v) => setMetodo(v as "Efectivo" | "Banco")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Efectivo">Efectivo (caja chica)</SelectItem>
                  <SelectItem value="Banco">Banco</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {metodo === "Banco" && (
              <>
                <div className="grid gap-1.5">
                  <Label>Cuenta</Label>
                  <Select value={cuentaId} onValueChange={setCuentaId}>
                    <SelectTrigger><SelectValue placeholder="Elige la cuenta" /></SelectTrigger>
                    <SelectContent>
                      {cuentas.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.nombre}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-1.5">
                  <Label>Referencia (transferencia / cheque)</Label>
                  <Input value={referencia} onChange={(e) => setReferencia(e.target.value)} />
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPagoOpen(false)}>Cancelar</Button>
            <Button onClick={guardarPago} disabled={guardando} className="gap-2">{guardando && <Loader2 className="h-4 w-4 animate-spin" />} Registrar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Anular pago */}
      <Dialog open={anulando !== null} onOpenChange={(o) => { if (!o) setAnulando(null) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Anular {anulando?.tipo.toLowerCase()} de {anulando ? formatCurrency(anulando.monto) : ""}</DialogTitle>
            <DialogDescription>Se registra un contra-asiento: el dinero vuelve a caja chica o a la cuenta. El pago queda marcado como anulado.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label>Motivo</Label>
            <Textarea rows={2} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAnulando(null)}>Cancelar</Button>
            <Button variant="destructive" onClick={confirmarAnular} disabled={guardando || !motivo.trim()}>Anular</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
