"use client"

import { useEffect, useState, useCallback } from "react"
import { ArrowDownCircle, ArrowUpCircle, Wallet, Download, Filter } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Spinner } from "@/components/ui/spinner"
import { useToast } from "@/hooks/use-toast"
import { getCuentas, getMovimientosTodasLasCuentas, type CuentaConfig, type CuentaMovimientoConNombre } from "@/lib/services/cuentas"
import { formatCurrency } from "@/lib/utils/format"
import { exportToXlsx } from "@/lib/utils/export"

export default function MovimientosCuentasPage() {
  const { toast } = useToast()
  const [loading, setLoading] = useState(true)
  const [cuentas, setCuentas] = useState<CuentaConfig[]>([])
  const [movimientos, setMovimientos] = useState<CuentaMovimientoConNombre[]>([])
  const [totales, setTotales] = useState({ ingresos: 0, egresos: 0 })

  // Filtros
  const [cuentaId, setCuentaId] = useState<string>("todas")
  const [desde, setDesde] = useState<string>("")
  const [hasta, setHasta] = useState<string>("")

  useEffect(() => {
    getCuentas().then((res) => setCuentas(res.data || []))
  }, [])

  const cargar = useCallback(async () => {
    setLoading(true)
    const res = await getMovimientosTodasLasCuentas({
      cuenta_id: cuentaId === "todas" ? undefined : Number(cuentaId),
      desde: desde || undefined,
      hasta: hasta || undefined,
    })
    if (res.error) {
      toast({ title: "Error", description: res.error, variant: "destructive" })
      setMovimientos([])
      setTotales({ ingresos: 0, egresos: 0 })
    } else {
      setMovimientos(res.data)
      setTotales({ ingresos: res.totalIngresos, egresos: res.totalEgresos })
    }
    setLoading(false)
  }, [cuentaId, desde, hasta, toast])

  useEffect(() => {
    cargar()
  }, [cargar])

  function exportar() {
    if (movimientos.length === 0) {
      toast({ title: "Sin datos", description: "No hay movimientos para exportar", variant: "destructive" })
      return
    }
    const rows: Record<string, unknown>[] = movimientos.map((m) => ({
      Fecha: m.fecha?.split("T")[0] || "",
      Hora: m.fecha?.split("T")[1]?.substring(0, 8) || "",
      Cuenta: m.cuenta_nombre,
      Tipo: m.tipo,
      Concepto: m.concepto || "",
      Monto: Number(m.monto || 0),
      "Saldo Resultante": Number(m.saldo_resultante || 0),
      Referencia: m.ref_tipo || "",
      Usuario: m.usuario || "",
    }))
    exportToXlsx(rows, {
      sheetName: "Movimientos",
      filename: "Movimientos_Cuentas",
      colWidths: [12, 10, 22, 10, 30, 14, 16, 14, 16],
    })
    toast({ title: "Exportado", description: "El archivo Excel se descargo correctamente" })
  }

  const neto = totales.ingresos - totales.egresos

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-3xl font-bold text-stone-800">Movimientos de Cuentas</h1>
        <p className="text-stone-500 text-sm mt-1">
          Historial de entradas y salidas por cuenta bancaria.
        </p>
      </div>

      {/* Filtros */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Filter className="h-4 w-4" /> Filtros
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 items-end">
            <div className="grid gap-2">
              <Label>Cuenta</Label>
              <Select value={cuentaId} onValueChange={setCuentaId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todas">Todas las cuentas</SelectItem>
                  {cuentas.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      {c.nombre}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="desde">Desde</Label>
              <Input id="desde" type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="hasta">Hasta</Label>
              <Input id="hasta" type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
            </div>
            <Button onClick={exportar} variant="outline" className="gap-2">
              <Download className="h-4 w-4" /> Exportar a Excel
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Totales */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="border-l-4 border-l-emerald-500">
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-sm text-stone-500">Total Entradas</CardTitle>
            <ArrowUpCircle className="h-5 w-5 text-emerald-600" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-emerald-700">{formatCurrency(totales.ingresos)}</p>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-red-500">
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-sm text-stone-500">Total Salidas</CardTitle>
            <ArrowDownCircle className="h-5 w-5 text-red-600" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-red-700">{formatCurrency(totales.egresos)}</p>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-stone-500">
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-sm text-stone-500">Neto</CardTitle>
            <Wallet className="h-5 w-5 text-stone-600" />
          </CardHeader>
          <CardContent>
            <p className={`text-2xl font-bold ${neto >= 0 ? "text-emerald-700" : "text-red-700"}`}>
              {formatCurrency(neto)}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Tabla */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex justify-center py-16">
              <Spinner className="h-8 w-8" />
            </div>
          ) : movimientos.length === 0 ? (
            <div className="py-16 text-center text-muted-foreground">
              No hay movimientos para los filtros seleccionados.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table containerClassName="max-h-[60vh] overflow-y-auto">
                <TableHeader sticky>
                  <TableRow>
                    <TableHead>Fecha</TableHead>
                    <TableHead>Cuenta</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Concepto</TableHead>
                    <TableHead className="text-right">Monto</TableHead>
                    <TableHead className="text-right">Saldo</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {movimientos.map((m) => (
                    <TableRow key={m.id}>
                      <TableCell className="whitespace-nowrap text-sm">
                        {m.fecha?.split("T")[0]}
                      </TableCell>
                      <TableCell>{m.cuenta_nombre}</TableCell>
                      <TableCell>
                        <Badge variant={m.tipo === "Ingreso" ? "secondary" : "destructive"} className={m.tipo === "Ingreso" ? "bg-emerald-100 text-emerald-700" : ""}>
                          {m.tipo}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-stone-600 max-w-[280px]">
                        <p className="truncate">{m.concepto || "—"}</p>
                        {(m.referencia || m.conciliado_at) && (
                          <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                            {m.referencia && <span>ref. {m.referencia}</span>}
                            {m.conciliado_at && <Badge variant="outline" className="text-[10px] py-0 border-emerald-300 text-emerald-700">Conciliado</Badge>}
                          </p>
                        )}
                      </TableCell>
                      <TableCell className={`text-right font-mono ${m.tipo === "Ingreso" ? "text-emerald-700" : "text-red-700"}`}>
                        {m.tipo === "Ingreso" ? "+" : "−"}{formatCurrency(Number(m.monto || 0))}
                      </TableCell>
                      <TableCell className="text-right font-mono text-stone-700">
                        {formatCurrency(Number(m.saldo_resultante || 0))}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
