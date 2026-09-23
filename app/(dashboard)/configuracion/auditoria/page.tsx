"use client"

import { useState, useEffect, useMemo } from "react"
import { ScrollText, Loader2, Search, FileSpreadsheet, Eye } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { TablePaginator } from "@/components/ui/table-paginator"
import { useToast } from "@/hooks/use-toast"
import { useAuth } from "@/lib/contexts/auth-context"
import { useTenant } from "@/lib/hooks/use-tenant"
import { getAuditoria, AUDITORIA_FEATURE_PENDING, type AuditoriaRegistro } from "@/lib/services/auditoria"
import { exportToXlsx } from "@/lib/utils/export"
import { formatHondurasDateTime } from "@/lib/utils/honduras-time"

const ENTIDADES: { value: string; label: string }[] = [
  { value: "todas", label: "Todas las entidades" },
  { value: "venta", label: "Ventas" },
  { value: "recibo", label: "Recibos de cobro" },
  { value: "devolucion", label: "Devoluciones" },
  { value: "reclamo", label: "Reclamos" },
  { value: "compra", label: "Compras" },
  { value: "orden", label: "Órdenes de producción" },
  { value: "cotizacion", label: "Cotizaciones" },
]

const ACCION_COLOR: Record<string, string> = {
  anular: "border-red-200 bg-red-50 text-red-700",
  anulacion_incompleta: "border-red-300 bg-red-100 text-red-800",
  rechazar: "border-red-200 bg-red-50 text-red-700",
  crear: "border-emerald-200 bg-emerald-50 text-emerald-700",
  resolver: "border-emerald-200 bg-emerald-50 text-emerald-700",
  editar: "border-amber-200 bg-amber-50 text-amber-800",
  pagar: "border-sky-200 bg-sky-50 text-sky-700",
}

export default function AuditoriaPage() {
  const { toast } = useToast()
  const { ready, razonSocialId } = useTenant()
  const { user } = useAuth()
  const esAdmin = (user?.rol || "").trim().toLowerCase() === "admin"

  const [loading, setLoading] = useState(true)
  const [pendiente, setPendiente] = useState(false)
  const [registros, setRegistros] = useState<AuditoriaRegistro[]>([])
  const [entidad, setEntidad] = useState("todas")
  const [usuario, setUsuario] = useState("")
  const [desde, setDesde] = useState("")
  const [hasta, setHasta] = useState("")
  const [busqueda, setBusqueda] = useState("")
  const [detalle, setDetalle] = useState<AuditoriaRegistro | null>(null)
  const [pageSize, setPageSize] = useState(100)
  const [pageIndex, setPageIndex] = useState(0)

  useEffect(() => {
    if (!ready || razonSocialId == null) return
    cargar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, razonSocialId, entidad, desde, hasta])

  async function cargar() {
    setLoading(true)
    const { data, error } = await getAuditoria({
      entidad: entidad === "todas" ? undefined : entidad,
      desde: desde || undefined,
      hasta: hasta || undefined,
      limit: 1000,
    })
    if (error === AUDITORIA_FEATURE_PENDING) setPendiente(true)
    else if (error) toast({ title: "No se pudo cargar la bitácora", description: error, variant: "destructive" })
    setRegistros(data)
    setLoading(false)
  }

  const filas = useMemo(() => {
    const u = usuario.trim().toLowerCase()
    const b = busqueda.trim().toLowerCase()
    return registros.filter((r) => {
      if (u && !(r.usuario || "").toLowerCase().includes(u)) return false
      if (b) {
        const texto = `${r.entidad} ${r.entidad_id ?? ""} ${r.accion} ${r.motivo ?? ""} ${JSON.stringify(r.antes ?? "")} ${JSON.stringify(r.despues ?? "")}`.toLowerCase()
        if (!texto.includes(b)) return false
      }
      return true
    })
  }, [registros, usuario, busqueda])

  const filasPaginadas = useMemo(
    () => filas.slice(pageIndex * pageSize, pageIndex * pageSize + pageSize),
    [filas, pageIndex, pageSize]
  )
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setPageIndex(0) }, [usuario, busqueda, pageSize, entidad, desde, hasta])

  async function exportar() {
    if (filas.length === 0) {
      toast({ title: "Sin datos", description: "No hay registros para exportar", variant: "destructive" })
      return
    }
    await exportToXlsx(
      filas.map((r) => ({
        Fecha: formatHondurasDateTime(r.created_at),
        Usuario: r.usuario || "",
        Entidad: r.entidad,
        "ID": r.entidad_id ?? "",
        Acción: r.accion,
        Motivo: r.motivo || "",
        Antes: r.antes ? JSON.stringify(r.antes) : "",
        Después: r.despues ? JSON.stringify(r.despues) : "",
      })),
      { filename: "Auditoria", sheetName: "Auditoría", appendDate: true }
    )
  }

  if (!esAdmin) {
    return (
      <Card className="border-amber-200 bg-amber-50">
        <CardContent className="p-6 text-sm text-amber-800">
          La bitácora de auditoría solo la consulta el administrador de la empresa.
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4 md:space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-amber-100 p-2 text-amber-700">
            <ScrollText className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold text-stone-800">Auditoría</h1>
            <p className="text-sm text-muted-foreground">Quién hizo qué: anulaciones, recibos, devoluciones, reclamos y más.</p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={exportar} disabled={filas.length === 0}>
          <FileSpreadsheet className="h-4 w-4 mr-1" /> Exportar
        </Button>
      </div>

      {pendiente && (
        <Card className="border-amber-200 bg-amber-50">
          <CardContent className="p-4 text-sm text-amber-800">{AUDITORIA_FEATURE_PENDING}</CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-4 grid gap-3 md:grid-cols-5">
          <div className="grid gap-1">
            <Label className="text-xs">Entidad</Label>
            <Select value={entidad} onValueChange={setEntidad}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {ENTIDADES.map((e) => <SelectItem key={e.value} value={e.value}>{e.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1">
            <Label className="text-xs">Usuario</Label>
            <Input value={usuario} onChange={(e) => setUsuario(e.target.value)} placeholder="Nombre" />
          </div>
          <div className="grid gap-1">
            <Label className="text-xs">Desde</Label>
            <Input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
          </div>
          <div className="grid gap-1">
            <Label className="text-xs">Hasta</Label>
            <Input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
          </div>
          <div className="grid gap-1">
            <Label className="text-xs">Buscar</Label>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input className="pl-8" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Motivo, factura, acción…" />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="p-4 md:p-6 pb-3 md:pb-4">
          <CardTitle className="text-base md:text-lg">Bitácora</CardTitle>
          <CardDescription className="text-xs md:text-sm">{filas.length} registro{filas.length === 1 ? "" : "s"}</CardDescription>
        </CardHeader>
        <CardContent className="p-4 md:p-6 pt-0">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : filas.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <ScrollText className="h-10 w-10 mx-auto mb-2 opacity-50" />
              <p className="text-sm">Sin registros para los filtros elegidos</p>
            </div>
          ) : (
            <>
              <Table containerClassName="max-h-[60vh] overflow-y-auto">
                <TableHeader sticky>
                  <TableRow>
                    <TableHead className="whitespace-nowrap">Fecha</TableHead>
                    <TableHead>Usuario</TableHead>
                    <TableHead>Entidad</TableHead>
                    <TableHead>Acción</TableHead>
                    <TableHead>Motivo</TableHead>
                    <TableHead className="w-12"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filasPaginadas.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="whitespace-nowrap text-sm">{formatHondurasDateTime(r.created_at)}</TableCell>
                      <TableCell className="text-sm">{r.usuario || "—"}</TableCell>
                      <TableCell className="text-sm">
                        <span className="capitalize">{r.entidad}</span>
                        {r.entidad_id != null && <span className="text-muted-foreground"> #{r.entidad_id}</span>}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={ACCION_COLOR[r.accion] || "border-stone-200 bg-stone-50 text-stone-700"}>
                          {r.accion.replace(/_/g, " ")}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm max-w-md truncate" title={r.motivo || ""}>{r.motivo || "—"}</TableCell>
                      <TableCell>
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setDetalle(r)} title="Ver detalle">
                          <Eye className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <TablePaginator
                pageIndex={pageIndex}
                pageSize={pageSize}
                totalItems={filas.length}
                onPageIndexChange={setPageIndex}
                onPageSizeChange={setPageSize}
                className="border-t"
              />
            </>
          )}
        </CardContent>
      </Card>

      <Dialog open={detalle !== null} onOpenChange={(o) => { if (!o) setDetalle(null) }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {detalle ? `${detalle.entidad} #${detalle.entidad_id ?? ""} · ${detalle.accion.replace(/_/g, " ")}` : ""}
            </DialogTitle>
            <DialogDescription>
              {detalle ? `${formatHondurasDateTime(detalle.created_at)} · ${detalle.usuario || "—"}` : ""}
            </DialogDescription>
          </DialogHeader>
          {detalle && (
            <div className="space-y-3 text-sm">
              {detalle.motivo && <p><span className="font-medium">Motivo:</span> {detalle.motivo}</p>}
              {detalle.antes != null && (
                <div>
                  <p className="font-medium mb-1">Antes</p>
                  <pre className="rounded-lg bg-stone-50 border border-stone-200 p-3 text-xs overflow-x-auto max-h-60">{JSON.stringify(detalle.antes, null, 2)}</pre>
                </div>
              )}
              {detalle.despues != null && (
                <div>
                  <p className="font-medium mb-1">Después</p>
                  <pre className="rounded-lg bg-stone-50 border border-stone-200 p-3 text-xs overflow-x-auto max-h-60">{JSON.stringify(detalle.despues, null, 2)}</pre>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
