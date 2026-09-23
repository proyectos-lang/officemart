"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import {
  Kanban, Plus, MoreHorizontal, Pencil, CalendarPlus, FileText, Trophy, XCircle, RotateCcw, Trash2, Download, Search,
  AlertTriangle, Clock, CalendarClock, Check, ChevronsUpDown, Loader2, Contact, Archive, ArchiveRestore, Settings2, ArrowRightLeft, Cake,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Spinner } from "@/components/ui/spinner"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { TablePaginator } from "@/components/ui/table-paginator"
import { Checkbox } from "@/components/ui/checkbox"
import { useToast } from "@/hooks/use-toast"
import { useAuth } from "@/lib/contexts/auth-context"
import { useTenant } from "@/lib/hooks/use-tenant"
import { formatCurrency } from "@/lib/utils/format"
import { formatHondurasDate, formatHondurasDateTime, getHondurasTodayISODate } from "@/lib/utils/honduras-time"
import { exportToXlsx } from "@/lib/utils/export"
import { getClientes, type Cliente } from "@/lib/services/catalogos"
import { getVendedores, getVendedorDeUsuario, type Vendedor } from "@/lib/services/vendedores"
import { ActividadDialog } from "@/components/crm/actividad-dialog"
import {
  ORIGENES_SUGERIDOS,
  getEtapas, saveEtapa, deleteEtapa,
  getContactos, saveContacto, archivarContacto,
  getOportunidades, crearOportunidad, actualizarOportunidad, moverEtapa, cerrarOportunidad, reabrirOportunidad, eliminarOportunidad,
  nombreCuenta, diasSinMovimiento, esCierreVencido, resumirPipeline, hondurasLocalAIso,
  type EtapaCrm, type ContactoCrm, type OportunidadCrm, type OportunidadInput, type EstadoOportunidad,
} from "@/lib/services/crm"

export default function PipelinePage() {
  return (
    <React.Suspense fallback={<div className="flex items-center gap-2 py-10 text-sm text-muted-foreground"><Spinner /> Cargando…</div>}>
      <PipelineContenido />
    </React.Suspense>
  )
}

type FiltroEstado = EstadoOportunidad | "Todas"

function PipelineContenido() {
  const router = useRouter()
  const params = useSearchParams()
  const clienteParam = params.get("clienteId") ? Number(params.get("clienteId")) : null
  const { toast } = useToast()
  const { user, hasModulo } = useAuth()
  const { ready, razonSocialId } = useTenant()
  const esAdmin = (user?.rol || "").trim().toLowerCase() === "admin"
  const usaVendedores = hasModulo("Vendedores y Zonas")
  const usaCotizaciones = hasModulo("Cotizaciones")
  const hoy = getHondurasTodayISODate()

  const [loading, setLoading] = React.useState(true)
  const [pendiente, setPendiente] = React.useState<string | null>(null)
  const [etapas, setEtapas] = React.useState<EtapaCrm[]>([])
  const [oportunidades, setOportunidades] = React.useState<OportunidadCrm[]>([])
  const [contactos, setContactos] = React.useState<ContactoCrm[]>([])
  const [clientes, setClientes] = React.useState<Cliente[]>([])
  const [vendedores, setVendedores] = React.useState<Vendedor[]>([])
  const [vendedorPropio, setVendedorPropio] = React.useState<number | null>(null)

  const [tab, setTab] = React.useState("tablero")
  const [estado, setEstado] = React.useState<FiltroEstado>("Abierta")
  const [vendedorFiltro, setVendedorFiltro] = React.useState("todos")
  const [busqueda, setBusqueda] = React.useState("")
  const [verArchivados, setVerArchivados] = React.useState(false)
  const [pageIndex, setPageIndex] = React.useState(0)
  const [pageSize, setPageSize] = React.useState(50)
  const [dragId, setDragId] = React.useState<number | null>(null)

  const [opDialog, setOpDialog] = React.useState<{ open: boolean; editar: OportunidadCrm | null }>({ open: false, editar: null })
  const [actDialog, setActDialog] = React.useState<{ open: boolean; oportunidad: OportunidadCrm | null }>({ open: false, oportunidad: null })
  const [perder, setPerder] = React.useState<{ oportunidad: OportunidadCrm | null; motivo: string; saving: boolean }>({ oportunidad: null, motivo: "", saving: false })
  const [contactoDialog, setContactoDialog] = React.useState<{ open: boolean; editar: ContactoCrm | null }>({ open: false, editar: null })
  const [etapaDialog, setEtapaDialog] = React.useState<{ open: boolean; editar: EtapaCrm | null }>({ open: false, editar: null })

  const cargarOportunidades = React.useCallback(async (f: { estado: FiltroEstado; vendedor: string; clienteId: number | null }) => {
    const res = await getOportunidades({ estado: f.estado, vendedorId: f.vendedor === "todos" ? null : Number(f.vendedor), clienteId: f.clienteId })
    if (res.pendiente) setPendiente(res.error)
    else if (res.error) toast({ title: "No se pudieron cargar las oportunidades", description: res.error, variant: "destructive" })
    setOportunidades(res.data)
  }, [toast])

  React.useEffect(() => {
    if (!ready || razonSocialId == null) return
    let activo = true
    Promise.all([
      getEtapas(),
      getContactos({ soloActivos: false }),
      getClientes({ soloActivos: true }),
      usaVendedores ? getVendedores({ soloActivos: true }) : Promise.resolve({ data: [] as Vendedor[], error: null }),
      usaVendedores ? getVendedorDeUsuario(user?.auth_user_id) : Promise.resolve(null),
    ]).then(async ([eRes, cRes, cliRes, vRes, vProp]) => {
      if (!activo) return
      if (eRes.pendiente) setPendiente(eRes.error)
      setEtapas(eRes.data)
      setContactos(cRes.data)
      setClientes(cliRes.data || [])
      setVendedores(vRes.data || [])
      setVendedorPropio(vProp?.id ?? null)
      await cargarOportunidades({ estado: "Abierta", vendedor: "todos", clienteId: clienteParam })
      if (activo) setLoading(false)
    })
    return () => {
      activo = false
    }
  }, [ready, razonSocialId, usaVendedores, user?.auth_user_id, clienteParam, cargarOportunidades])

  function cambiarEstado(v: FiltroEstado) {
    setEstado(v)
    setPageIndex(0)
    cargarOportunidades({ estado: v, vendedor: vendedorFiltro, clienteId: clienteParam })
  }
  function cambiarVendedor(v: string) {
    setVendedorFiltro(v)
    setPageIndex(0)
    cargarOportunidades({ estado, vendedor: v, clienteId: clienteParam })
  }
  const refrescar = () => cargarOportunidades({ estado, vendedor: vendedorFiltro, clienteId: clienteParam })

  const etapasActivas = React.useMemo(() => etapas.filter((e) => e.activo !== false), [etapas])
  const visibles = React.useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    if (!q) return oportunidades
    return oportunidades.filter((o) => [o.titulo, o.cliente_nombre, o.prospecto_nombre, o.vendedor_nombre, o.origen, o.contacto_nombre].some((s) => (s || "").toLowerCase().includes(q)))
  }, [oportunidades, busqueda])
  const resumen = React.useMemo(() => resumirPipeline(visibles, etapasActivas), [visibles, etapasActivas])
  const clienteFiltroNombre = clienteParam != null ? clientes.find((c) => c.id === clienteParam)?.nombre ?? `cliente #${clienteParam}` : null

  // ---------- acciones ----------
  async function handleMover(id: number, etapaId: number) {
    const o = oportunidades.find((x) => x.id === id)
    if (!o || o.etapa_id === etapaId || o.estado !== "Abierta") return
    setOportunidades((prev) => prev.map((x) => (x.id === id ? { ...x, etapa_id: etapaId, etapa_nombre: etapas.find((e) => e.id === etapaId)?.nombre ?? x.etapa_nombre } : x)))
    const res = await moverEtapa(id, etapaId)
    if (!res.success) {
      toast({ title: "No se pudo mover", description: res.error ?? "", variant: "destructive" })
      refrescar()
    }
  }

  async function handleGanar(o: OportunidadCrm) {
    const res = await cerrarOportunidad(o.id, "Ganada")
    if (!res.success) return toast({ title: "No se pudo cerrar", description: res.error ?? "", variant: "destructive" })
    toast({ title: "¡Oportunidad ganada!", description: o.titulo })
    refrescar()
  }

  async function confirmarPerder() {
    if (!perder.oportunidad) return
    setPerder((p) => ({ ...p, saving: true }))
    const res = await cerrarOportunidad(perder.oportunidad.id, "Perdida", perder.motivo)
    setPerder((p) => ({ ...p, saving: false }))
    if (!res.success) return toast({ title: "No se pudo cerrar", description: res.error ?? "", variant: "destructive" })
    toast({ title: "Oportunidad marcada como perdida" })
    setPerder({ oportunidad: null, motivo: "", saving: false })
    refrescar()
  }

  async function handleReabrir(o: OportunidadCrm) {
    const res = await reabrirOportunidad(o.id)
    if (!res.success) return toast({ title: "No se pudo reabrir", description: res.error ?? "", variant: "destructive" })
    toast({ title: "Oportunidad reabierta" })
    refrescar()
  }

  async function handleEliminar(o: OportunidadCrm) {
    if (!window.confirm(`¿Eliminar "${o.titulo}" y sus actividades? Esta acción no se puede deshacer.`)) return
    const res = await eliminarOportunidad(o.id)
    if (!res.success) return toast({ title: "No se pudo eliminar", description: res.error ?? "", variant: "destructive" })
    toast({ title: "Oportunidad eliminada" })
    refrescar()
  }

  function crearCotizacion(o: OportunidadCrm) {
    const q = new URLSearchParams({ oportunidadId: String(o.id) })
    if (o.cliente_id != null) q.set("clienteId", String(o.cliente_id))
    else if (o.prospecto_nombre) q.set("prospecto", o.prospecto_nombre)
    router.push(`/ventas/cotizaciones/nueva?${q.toString()}`)
  }

  function exportar() {
    exportToXlsx(
      visibles.map((o) => ({
        Titulo: o.titulo, Cuenta: nombreCuenta(o), Contacto: o.contacto_nombre || "", Vendedor: o.vendedor_nombre || "", Etapa: o.etapa_nombre || "",
        "Valor estimado": o.valor_estimado, "Cierre esperado": o.fecha_cierre_esperada || "", Origen: o.origen || "", Estado: o.estado,
        "Motivo perdida": o.motivo_perdida || "", Cotizacion: o.cotizacion_id ?? "", "Proxima actividad": o.proxima_actividad ? formatHondurasDateTime(o.proxima_actividad) : "",
        Creada: formatHondurasDate(o.created_at), Cerrada: o.cerrada_at ? formatHondurasDate(o.cerrada_at) : "",
      })),
      { filename: `crm_oportunidades_${hoy}`, sheetName: "Oportunidades" }
    )
  }

  async function handleArchivarContacto(c: ContactoCrm, activo: boolean) {
    if (c.id == null) return
    const res = await archivarContacto(c.id, activo)
    if (!res.success) return toast({ title: "No se pudo actualizar", description: res.error ?? "", variant: "destructive" })
    setContactos((prev) => prev.map((x) => (x.id === c.id ? { ...x, activo } : x)))
  }

  async function handleEliminarEtapa(e: EtapaCrm) {
    if (e.id == null) return
    if (!window.confirm(`¿Eliminar la etapa "${e.nombre}"?`)) return
    const res = await deleteEtapa(e.id)
    if (!res.success) return toast({ title: "No se pudo eliminar", description: res.error ?? "", variant: "destructive" })
    setEtapas((prev) => prev.filter((x) => x.id !== e.id))
  }

  // ---------- render ----------
  if (loading) return <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground"><Spinner /> Cargando…</div>

  const menuOportunidad = (o: OportunidadCrm) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-7 w-7"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem onClick={() => setOpDialog({ open: true, editar: o })}><Pencil className="h-4 w-4 mr-2" /> Editar</DropdownMenuItem>
        <DropdownMenuItem onClick={() => setActDialog({ open: true, oportunidad: o })}><CalendarPlus className="h-4 w-4 mr-2" /> Programar actividad</DropdownMenuItem>
        {usaCotizaciones && o.cotizacion_id == null && o.estado === "Abierta" && (
          <DropdownMenuItem onClick={() => crearCotizacion(o)}><FileText className="h-4 w-4 mr-2" /> Crear cotización</DropdownMenuItem>
        )}
        {o.cotizacion_id != null && (
          <DropdownMenuItem asChild><Link href={`/ventas/cotizaciones/nueva?id=${o.cotizacion_id}`}><FileText className="h-4 w-4 mr-2" /> Ver cotización</Link></DropdownMenuItem>
        )}
        {o.estado === "Abierta" && etapasActivas.length > 1 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs text-muted-foreground flex items-center gap-1"><ArrowRightLeft className="h-3 w-3" /> Mover a</DropdownMenuLabel>
            {etapasActivas.filter((e) => e.id !== o.etapa_id).map((e) => (
              <DropdownMenuItem key={e.id} onClick={() => handleMover(o.id, e.id!)}>{e.nombre} <span className="ml-auto text-xs text-muted-foreground">{e.probabilidad}%</span></DropdownMenuItem>
            ))}
          </>
        )}
        <DropdownMenuSeparator />
        {o.estado === "Abierta" ? (
          <>
            <DropdownMenuItem onClick={() => handleGanar(o)} className="text-emerald-700"><Trophy className="h-4 w-4 mr-2" /> Marcar ganada</DropdownMenuItem>
            <DropdownMenuItem onClick={() => setPerder({ oportunidad: o, motivo: "", saving: false })} className="text-red-700"><XCircle className="h-4 w-4 mr-2" /> Marcar perdida</DropdownMenuItem>
          </>
        ) : (
          <DropdownMenuItem onClick={() => handleReabrir(o)}><RotateCcw className="h-4 w-4 mr-2" /> Reabrir</DropdownMenuItem>
        )}
        {esAdmin && <DropdownMenuItem onClick={() => handleEliminar(o)} className="text-red-700"><Trash2 className="h-4 w-4 mr-2" /> Eliminar</DropdownMenuItem>}
      </DropdownMenuContent>
    </DropdownMenu>
  )

  const estadoBadge = (o: OportunidadCrm) =>
    o.estado === "Ganada" ? <Badge className="bg-emerald-600">Ganada</Badge> : o.estado === "Perdida" ? <Badge variant="destructive">Perdida</Badge> : <Badge variant="secondary">Abierta</Badge>

  return (
    <div className="space-y-4 md:space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-stone-200 p-2 text-stone-700"><Kanban className="h-5 w-5" /></div>
          <div>
            <h1 className="text-2xl font-semibold text-stone-800">CRM · Pipeline</h1>
            <p className="text-sm text-muted-foreground">Oportunidades por etapa, contactos y seguimiento comercial.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={exportar} disabled={visibles.length === 0} className="gap-1"><Download className="h-4 w-4" /> Excel</Button>
          <Button size="sm" onClick={() => setOpDialog({ open: true, editar: null })} disabled={!!pendiente} className="gap-1"><Plus className="h-4 w-4" /> Nueva oportunidad</Button>
        </div>
      </div>

      {pendiente && (
        <Card className="border-amber-200 bg-amber-50"><CardContent className="p-4 text-sm text-amber-800 flex items-center gap-2"><AlertTriangle className="h-4 w-4" /> {pendiente}</CardContent></Card>
      )}

      {clienteFiltroNombre && (
        <Card className="border-sky-200 bg-sky-50"><CardContent className="p-3 text-sm text-sky-800 flex items-center justify-between gap-2">
          <span>Mostrando solo oportunidades de <strong>{clienteFiltroNombre}</strong>.</span>
          <Button variant="ghost" size="sm" onClick={() => router.push("/crm/pipeline")}>Quitar filtro</Button>
        </CardContent></Card>
      )}

      <div className="grid gap-3 sm:grid-cols-4">
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Abiertas</p><p className="text-2xl font-semibold">{resumen.cantidad}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Valor en pipeline</p><p className="text-2xl font-semibold">{formatCurrency(resumen.total)}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Ponderado (× probabilidad)</p><p className="text-2xl font-semibold text-emerald-700">{formatCurrency(resumen.ponderado)}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Cierres vencidos</p><p className="text-2xl font-semibold text-red-700">{visibles.filter((o) => esCierreVencido(o, hoy)).length}</p></CardContent></Card>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <div className="flex flex-col md:flex-row md:items-center gap-2 justify-between">
          <TabsList>
            <TabsTrigger value="tablero">Tablero</TabsTrigger>
            <TabsTrigger value="lista">Lista</TabsTrigger>
            <TabsTrigger value="contactos">Contactos</TabsTrigger>
            {esAdmin && <TabsTrigger value="etapas">Etapas</TabsTrigger>}
          </TabsList>
          {(tab === "tablero" || tab === "lista") && (
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="h-4 w-4 absolute left-2 top-2.5 text-muted-foreground" />
                <Input className="pl-8 w-[200px]" placeholder="Buscar…" value={busqueda} onChange={(e) => { setBusqueda(e.target.value); setPageIndex(0) }} />
              </div>
              <Select value={estado} onValueChange={(v) => cambiarEstado(v as FiltroEstado)}>
                <SelectTrigger className="w-[130px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Abierta">Abiertas</SelectItem>
                  <SelectItem value="Ganada">Ganadas</SelectItem>
                  <SelectItem value="Perdida">Perdidas</SelectItem>
                  <SelectItem value="Todas">Todas</SelectItem>
                </SelectContent>
              </Select>
              {vendedores.length > 0 && (
                <Select value={vendedorFiltro} onValueChange={cambiarVendedor}>
                  <SelectTrigger className="w-[170px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todos">Todos los vendedores</SelectItem>
                    {vendedores.map((v) => <SelectItem key={v.id} value={String(v.id)}>{v.nombre}{v.id === vendedorPropio ? " (yo)" : ""}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
            </div>
          )}
        </div>

        {/* ---------- TABLERO ---------- */}
        <TabsContent value="tablero" className="mt-3">
          {estado !== "Abierta" && (
            <p className="text-xs text-muted-foreground mb-2">El tablero muestra oportunidades {estado === "Todas" ? "de todos los estados" : estado.toLowerCase() + "s"}; solo las abiertas se pueden arrastrar.</p>
          )}
          <div className="overflow-x-auto pb-2">
            <div className="flex gap-3 min-w-max">
              {etapasActivas.map((e) => {
                const enEtapa = visibles.filter((o) => o.etapa_id === e.id)
                const valor = enEtapa.filter((o) => o.estado === "Abierta").reduce((a, o) => a + o.valor_estimado, 0)
                return (
                  <div
                    key={e.id}
                    className={`w-[280px] shrink-0 rounded-lg border bg-stone-50 flex flex-col ${dragId != null ? "border-dashed border-stone-400" : ""}`}
                    onDragOver={(ev) => ev.preventDefault()}
                    onDrop={(ev) => { ev.preventDefault(); const id = Number(ev.dataTransfer.getData("text/plain")); if (id) handleMover(id, e.id!); setDragId(null) }}
                  >
                    <div className="p-3 border-b bg-white rounded-t-lg">
                      <div className="flex items-center justify-between">
                        <p className="font-medium text-sm text-stone-800">{e.nombre}</p>
                        <Badge variant="outline">{enEtapa.length}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">{formatCurrency(valor)} · {e.probabilidad}%</p>
                    </div>
                    <div className="p-2 space-y-2 min-h-[120px] max-h-[65vh] overflow-y-auto">
                      {enEtapa.map((o) => {
                        const vencido = esCierreVencido(o, hoy)
                        const quieto = o.estado === "Abierta" ? diasSinMovimiento(o, hoy) : 0
                        return (
                          <div
                            key={o.id}
                            draggable={o.estado === "Abierta"}
                            onDragStart={(ev) => { ev.dataTransfer.setData("text/plain", String(o.id)); ev.dataTransfer.effectAllowed = "move"; setDragId(o.id) }}
                            onDragEnd={() => setDragId(null)}
                            className={`rounded-md border bg-white p-2.5 shadow-sm text-sm ${o.estado === "Abierta" ? "cursor-grab active:cursor-grabbing" : "opacity-80"} ${dragId === o.id ? "opacity-50" : ""}`}
                          >
                            <div className="flex items-start justify-between gap-1">
                              <button className="text-left font-medium text-stone-800 hover:underline leading-tight" onClick={() => setOpDialog({ open: true, editar: o })}>{o.titulo}</button>
                              {menuOportunidad(o)}
                            </div>
                            <p className="text-xs text-muted-foreground truncate">{nombreCuenta(o)}</p>
                            <div className="flex items-center justify-between mt-1.5">
                              <span className="font-mono text-sm">{formatCurrency(o.valor_estimado)}</span>
                              {o.estado !== "Abierta" && estadoBadge(o)}
                            </div>
                            {o.vendedor_nombre && <p className="text-xs text-muted-foreground mt-1">{o.vendedor_nombre}</p>}
                            <div className="flex flex-wrap gap-1 mt-1.5">
                              {vencido && <Badge variant="destructive" className="text-[10px] px-1.5 py-0"><AlertTriangle className="h-3 w-3 mr-0.5" /> Cierre {formatHondurasDate(o.fecha_cierre_esperada)}</Badge>}
                              {!vencido && o.fecha_cierre_esperada && <Badge variant="outline" className="text-[10px] px-1.5 py-0">Cierre {formatHondurasDate(o.fecha_cierre_esperada)}</Badge>}
                              {o.estado === "Abierta" && quieto >= 14 && <Badge className="bg-amber-500 text-[10px] px-1.5 py-0"><Clock className="h-3 w-3 mr-0.5" /> {quieto} d sin movimiento</Badge>}
                              {o.estado === "Abierta" && (o.proxima_actividad
                                ? <Badge variant="secondary" className="text-[10px] px-1.5 py-0"><CalendarClock className="h-3 w-3 mr-0.5" /> {formatHondurasDateTime(o.proxima_actividad)}</Badge>
                                : <button className="text-[10px] text-sky-700 hover:underline" onClick={() => setActDialog({ open: true, oportunidad: o })}>+ programar actividad</button>)}
                            </div>
                          </div>
                        )
                      })}
                      {enEtapa.length === 0 && <p className="text-xs text-muted-foreground text-center py-6">Arrastra aquí</p>}
                    </div>
                  </div>
                )
              })}
              {etapasActivas.length === 0 && <p className="text-sm text-muted-foreground">No hay etapas. {esAdmin ? "Créalas en la pestaña Etapas." : "Pide a un administrador que las cree."}</p>}
            </div>
          </div>
        </TabsContent>

        {/* ---------- LISTA ---------- */}
        <TabsContent value="lista" className="mt-3">
          <div className="overflow-x-auto border rounded-lg">
            <Table>
              <TableHeader>
                <TableRow className="bg-stone-50">
                  <TableHead>Título</TableHead><TableHead>Cuenta</TableHead><TableHead>Etapa</TableHead><TableHead>Vendedor</TableHead>
                  <TableHead className="text-right">Valor</TableHead><TableHead>Cierre esp.</TableHead><TableHead>Próx. actividad</TableHead><TableHead>Estado</TableHead><TableHead className="w-10"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibles.slice(pageIndex * pageSize, (pageIndex + 1) * pageSize).map((o) => (
                  <TableRow key={o.id}>
                    <TableCell className="font-medium">{o.titulo}{o.origen && <span className="block text-xs text-muted-foreground">{o.origen}</span>}</TableCell>
                    <TableCell>{nombreCuenta(o)}{o.contacto_nombre && <span className="block text-xs text-muted-foreground">{o.contacto_nombre}</span>}</TableCell>
                    <TableCell>{o.etapa_nombre}</TableCell>
                    <TableCell>{o.vendedor_nombre || "—"}</TableCell>
                    <TableCell className="text-right font-mono">{formatCurrency(o.valor_estimado)}</TableCell>
                    <TableCell className={esCierreVencido(o, hoy) ? "text-red-700" : ""}>{o.fecha_cierre_esperada ? formatHondurasDate(o.fecha_cierre_esperada) : "—"}</TableCell>
                    <TableCell className="text-xs">{o.proxima_actividad ? formatHondurasDateTime(o.proxima_actividad) : <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell>{estadoBadge(o)}{o.motivo_perdida && <span className="block text-xs text-muted-foreground">{o.motivo_perdida}</span>}</TableCell>
                    <TableCell>{menuOportunidad(o)}</TableCell>
                  </TableRow>
                ))}
                {visibles.length === 0 && <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-8">Sin oportunidades.</TableCell></TableRow>}
              </TableBody>
            </Table>
          </div>
          <TablePaginator pageIndex={pageIndex} pageSize={pageSize} totalItems={visibles.length} onPageIndexChange={setPageIndex} onPageSizeChange={(s) => { setPageSize(s); setPageIndex(0) }} />
        </TabsContent>

        {/* ---------- CONTACTOS ---------- */}
        <TabsContent value="contactos" className="mt-3 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <label className="flex items-center gap-2 text-sm"><Checkbox checked={verArchivados} onCheckedChange={(v) => setVerArchivados(v === true)} /> Mostrar archivados</label>
            <Button size="sm" onClick={() => setContactoDialog({ open: true, editar: null })} disabled={!!pendiente} className="gap-1"><Plus className="h-4 w-4" /> Nuevo contacto</Button>
          </div>
          <div className="overflow-x-auto border rounded-lg">
            <Table>
              <TableHeader><TableRow className="bg-stone-50"><TableHead>Nombre</TableHead><TableHead>Cliente</TableHead><TableHead>Cargo</TableHead><TableHead>Teléfono</TableHead><TableHead>Correo</TableHead><TableHead>Cumpleaños</TableHead><TableHead className="w-24"></TableHead></TableRow></TableHeader>
              <TableBody>
                {contactos.filter((c) => verArchivados || c.activo !== false).map((c) => (
                  <TableRow key={c.id} className={c.activo === false ? "opacity-60" : ""}>
                    <TableCell className="font-medium"><span className="flex items-center gap-1"><Contact className="h-3.5 w-3.5 text-muted-foreground" /> {c.nombre}</span></TableCell>
                    <TableCell>{c.cliente_nombre || <span className="text-muted-foreground">Prospecto</span>}</TableCell>
                    <TableCell>{c.cargo || "—"}</TableCell>
                    <TableCell>{c.telefono || "—"}</TableCell>
                    <TableCell>{c.correo || "—"}</TableCell>
                    <TableCell>{c.cumpleanos ? <span className="flex items-center gap-1"><Cake className="h-3.5 w-3.5 text-pink-600" /> {formatHondurasDate(c.cumpleanos)}</span> : "—"}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setContactoDialog({ open: true, editar: c })}><Pencil className="h-4 w-4" /></Button>
                        {c.activo === false
                          ? <Button variant="ghost" size="icon" className="h-8 w-8 text-emerald-700" title="Restaurar" onClick={() => handleArchivarContacto(c, true)}><ArchiveRestore className="h-4 w-4" /></Button>
                          : <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" title="Archivar" onClick={() => handleArchivarContacto(c, false)}><Archive className="h-4 w-4" /></Button>}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {contactos.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">Sin contactos.</TableCell></TableRow>}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        {/* ---------- ETAPAS (admin) ---------- */}
        {esAdmin && (
          <TabsContent value="etapas" className="mt-3 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm text-muted-foreground flex items-center gap-1"><Settings2 className="h-4 w-4" /> La probabilidad pondera el valor del pipeline. Las etapas inactivas se ocultan del tablero.</p>
              <Button size="sm" onClick={() => setEtapaDialog({ open: true, editar: null })} disabled={!!pendiente} className="gap-1"><Plus className="h-4 w-4" /> Nueva etapa</Button>
            </div>
            <div className="overflow-x-auto border rounded-lg">
              <Table>
                <TableHeader><TableRow className="bg-stone-50"><TableHead className="w-16">Orden</TableHead><TableHead>Nombre</TableHead><TableHead className="text-right">Probabilidad</TableHead><TableHead>Activa</TableHead><TableHead className="w-24"></TableHead></TableRow></TableHeader>
                <TableBody>
                  {etapas.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell>{e.orden}</TableCell>
                      <TableCell className="font-medium">{e.nombre}</TableCell>
                      <TableCell className="text-right">{e.probabilidad}%</TableCell>
                      <TableCell>{e.activo === false ? <Badge variant="outline">Inactiva</Badge> : <Badge variant="secondary">Activa</Badge>}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setEtapaDialog({ open: true, editar: e })}><Pencil className="h-4 w-4" /></Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-red-700" onClick={() => handleEliminarEtapa(e)}><Trash2 className="h-4 w-4" /></Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </TabsContent>
        )}
      </Tabs>

      {/* ---------- DIÁLOGOS ---------- */}
      <Dialog open={opDialog.open} onOpenChange={(o) => setOpDialog((p) => ({ ...p, open: o }))}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{opDialog.editar ? "Editar oportunidad" : "Nueva oportunidad"}</DialogTitle>
            <DialogDescription>Un negocio en curso con un cliente o prospecto.</DialogDescription>
          </DialogHeader>
          {opDialog.open && (
            <OportunidadForm
              key={opDialog.editar?.id ?? "nueva"}
              editar={opDialog.editar}
              etapas={etapasActivas}
              clientes={clientes}
              contactos={contactos.filter((c) => c.activo !== false)}
              vendedores={vendedores}
              vendedorPropio={vendedorPropio}
              clienteInicial={clienteParam}
              onClose={() => setOpDialog({ open: false, editar: null })}
              onSaved={() => { setOpDialog({ open: false, editar: null }); refrescar() }}
            />
          )}
        </DialogContent>
      </Dialog>

      <ActividadDialog
        open={actDialog.open}
        onOpenChange={(o) => setActDialog((p) => ({ ...p, open: o }))}
        defaults={actDialog.oportunidad ? {
          oportunidad_id: actDialog.oportunidad.id, cliente_id: actDialog.oportunidad.cliente_id, contacto_id: actDialog.oportunidad.contacto_id,
          vendedor_id: actDialog.oportunidad.vendedor_id ?? vendedorPropio, fecha: hondurasLocalAIso(`${hoy}T09:00`),
        } : { vendedor_id: vendedorPropio, fecha: hondurasLocalAIso(`${hoy}T09:00`) }}
        oportunidades={oportunidades.filter((o) => o.estado === "Abierta")}
        clientes={clientes}
        contactos={contactos.filter((c) => c.activo !== false)}
        vendedores={vendedores}
        onSaved={() => refrescar()}
      />

      <Dialog open={perder.oportunidad != null} onOpenChange={(o) => { if (!o) setPerder({ oportunidad: null, motivo: "", saving: false }) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Marcar como perdida</DialogTitle>
            <DialogDescription>{perder.oportunidad?.titulo}</DialogDescription>
          </DialogHeader>
          <div className="space-y-1">
            <Label>Motivo</Label>
            <Input value={perder.motivo} onChange={(e) => setPerder((p) => ({ ...p, motivo: e.target.value }))} placeholder="Ej. Precio, plazo, eligió a la competencia…" list="motivos-perdida" autoFocus />
            <datalist id="motivos-perdida">{["Precio", "Plazo de entrega", "Competencia", "Sin presupuesto", "Sin respuesta", "Cambió de necesidad"].map((m) => <option key={m} value={m} />)}</datalist>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPerder({ oportunidad: null, motivo: "", saving: false })}>Cancelar</Button>
            <Button variant="destructive" onClick={confirmarPerder} disabled={perder.saving || !perder.motivo.trim()}>{perder.saving && <Loader2 className="h-4 w-4 animate-spin mr-1" />} Confirmar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={contactoDialog.open} onOpenChange={(o) => setContactoDialog((p) => ({ ...p, open: o }))}>
        <DialogContent>
          <DialogHeader><DialogTitle>{contactoDialog.editar ? "Editar contacto" : "Nuevo contacto"}</DialogTitle><DialogDescription>Persona de contacto de un cliente o prospecto.</DialogDescription></DialogHeader>
          {contactoDialog.open && (
            <ContactoForm
              key={contactoDialog.editar?.id ?? "nuevo"}
              editar={contactoDialog.editar}
              clientes={clientes}
              onClose={() => setContactoDialog({ open: false, editar: null })}
              onSaved={(c) => {
                setContactos((prev) => (prev.some((x) => x.id === c.id) ? prev.map((x) => (x.id === c.id ? c : x)) : [...prev, c].sort((a, b) => a.nombre.localeCompare(b.nombre))))
                setContactoDialog({ open: false, editar: null })
              }}
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={etapaDialog.open} onOpenChange={(o) => setEtapaDialog((p) => ({ ...p, open: o }))}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>{etapaDialog.editar ? "Editar etapa" : "Nueva etapa"}</DialogTitle><DialogDescription>Columna del tablero con su probabilidad de cierre.</DialogDescription></DialogHeader>
          {etapaDialog.open && (
            <EtapaForm
              key={etapaDialog.editar?.id ?? "nueva"}
              editar={etapaDialog.editar}
              siguienteOrden={etapas.reduce((m, e) => Math.max(m, e.orden), 0) + 1}
              onClose={() => setEtapaDialog({ open: false, editar: null })}
              onSaved={(e) => {
                setEtapas((prev) => (prev.some((x) => x.id === e.id) ? prev.map((x) => (x.id === e.id ? e : x)) : [...prev, e]).sort((a, b) => a.orden - b.orden || (a.id ?? 0) - (b.id ?? 0)))
                setEtapaDialog({ open: false, editar: null })
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ==================== FORMULARIOS ====================

function OportunidadForm({ editar, etapas, clientes, contactos, vendedores, vendedorPropio, clienteInicial, onClose, onSaved }: {
  editar: OportunidadCrm | null
  etapas: EtapaCrm[]
  clientes: Cliente[]
  contactos: ContactoCrm[]
  vendedores: Vendedor[]
  vendedorPropio: number | null
  clienteInicial: number | null
  onClose: () => void
  onSaved: () => void
}) {
  const { toast } = useToast()
  const [saving, setSaving] = React.useState(false)
  const [titulo, setTitulo] = React.useState(editar?.titulo ?? "")
  const [clienteId, setClienteId] = React.useState<number | null>(editar?.cliente_id ?? clienteInicial)
  const [esProspecto, setEsProspecto] = React.useState(editar ? editar.cliente_id == null : false)
  const [prospecto, setProspecto] = React.useState(editar?.prospecto_nombre ?? "")
  const [contactoId, setContactoId] = React.useState<number | null>(editar?.contacto_id ?? null)
  const [vendedorId, setVendedorId] = React.useState<number | null>(editar?.vendedor_id ?? vendedorPropio)
  const [etapaId, setEtapaId] = React.useState<number | null>(editar?.etapa_id ?? etapas[0]?.id ?? null)
  const [valor, setValor] = React.useState(editar ? String(editar.valor_estimado) : "")
  const [cierre, setCierre] = React.useState(editar?.fecha_cierre_esperada ?? "")
  const [origen, setOrigen] = React.useState(editar?.origen ?? "")
  const [notas, setNotas] = React.useState(editar?.notas ?? "")
  const [cliOpen, setCliOpen] = React.useState(false)

  const cliSel = clientes.find((c) => c.id === clienteId) ?? null
  const contactosVisibles = contactos.filter((c) => (esProspecto ? c.cliente_id == null : c.cliente_id === clienteId || c.cliente_id == null))

  async function guardar() {
    if (etapaId == null) return toast({ title: "Elige la etapa", variant: "destructive" })
    setSaving(true)
    const input: OportunidadInput = {
      titulo, cliente_id: esProspecto ? null : clienteId, prospecto_nombre: esProspecto ? prospecto : null, contacto_id: contactoId,
      vendedor_id: vendedorId, etapa_id: etapaId, valor_estimado: Number(valor) || 0, fecha_cierre_esperada: cierre || null, origen, notas,
    }
    const res = editar ? await actualizarOportunidad(editar.id, input) : await crearOportunidad(input)
    setSaving(false)
    if (res.error || !res.data) return toast({ title: "No se pudo guardar", description: res.error ?? "", variant: "destructive" })
    toast({ title: editar ? "Oportunidad actualizada" : "Oportunidad creada" })
    onSaved()
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Label>Título</Label>
        <Input value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Ej. Mobiliario oficina nueva sede" autoFocus />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <div className="flex items-center justify-between"><Label>Cliente</Label><label className="flex items-center gap-1 text-xs text-muted-foreground"><Checkbox checked={esProspecto} onCheckedChange={(v) => { setEsProspecto(v === true); setContactoId(null) }} /> Prospecto (sin ficha)</label></div>
          {esProspecto ? (
            <Input value={prospecto} onChange={(e) => setProspecto(e.target.value)} placeholder="Nombre del prospecto" />
          ) : (
            <Popover open={cliOpen} onOpenChange={setCliOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" role="combobox" className="w-full justify-between font-normal">
                  <span className="truncate">{cliSel ? cliSel.nombre : "Elegir cliente…"}</span><ChevronsUpDown className="h-4 w-4 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="p-0 w-[320px]" align="start">
                <Command>
                  <CommandInput placeholder="Buscar cliente…" />
                  <CommandList>
                    <CommandEmpty>Sin resultados.</CommandEmpty>
                    <CommandGroup>
                      {clientes.map((c) => (
                        <CommandItem key={c.id} value={`${c.nombre} ${c.rtn || ""}`} onSelect={() => { setClienteId(c.id ?? null); setContactoId(null); setCliOpen(false) }}>
                          <Check className={`mr-2 h-4 w-4 ${c.id === clienteId ? "opacity-100" : "opacity-0"}`} /> {c.nombre}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          )}
        </div>
        <div className="space-y-1">
          <Label>Contacto</Label>
          <Select value={contactoId != null ? String(contactoId) : "0"} onValueChange={(v) => setContactoId(v === "0" ? null : Number(v))}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="0">Sin contacto</SelectItem>
              {contactosVisibles.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.nombre}{c.cargo ? ` · ${c.cargo}` : ""}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1">
          <Label>Etapa</Label>
          <Select value={etapaId != null ? String(etapaId) : ""} onValueChange={(v) => setEtapaId(Number(v))}>
            <SelectTrigger><SelectValue placeholder="Etapa" /></SelectTrigger>
            <SelectContent>{etapas.map((e) => <SelectItem key={e.id} value={String(e.id)}>{e.nombre} ({e.probabilidad}%)</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label>Valor estimado (L)</Label>
          <Input type="number" min={0} step="0.01" value={valor} onChange={(e) => setValor(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label>Cierre esperado</Label>
          <Input type="date" value={cierre} onChange={(e) => setCierre(e.target.value)} />
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {vendedores.length > 0 && (
          <div className="space-y-1">
            <Label>Vendedor</Label>
            <Select value={vendedorId != null ? String(vendedorId) : "0"} onValueChange={(v) => setVendedorId(v === "0" ? null : Number(v))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="0">Sin asignar</SelectItem>
                {vendedores.map((v) => <SelectItem key={v.id} value={String(v.id)}>{v.nombre}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}
        <div className="space-y-1">
          <Label>Origen</Label>
          <Input value={origen} onChange={(e) => setOrigen(e.target.value)} list="origenes-crm" placeholder="Referido, sitio web…" />
          <datalist id="origenes-crm">{ORIGENES_SUGERIDOS.map((o) => <option key={o} value={o} />)}</datalist>
        </div>
      </div>
      <div className="space-y-1">
        <Label>Notas</Label>
        <Textarea rows={3} value={notas} onChange={(e) => setNotas(e.target.value)} />
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={saving}>Cancelar</Button>
        <Button onClick={guardar} disabled={saving}>{saving && <Loader2 className="h-4 w-4 animate-spin mr-1" />} Guardar</Button>
      </DialogFooter>
    </div>
  )
}

function ContactoForm({ editar, clientes, onClose, onSaved }: { editar: ContactoCrm | null; clientes: Cliente[]; onClose: () => void; onSaved: (c: ContactoCrm) => void }) {
  const { toast } = useToast()
  const [saving, setSaving] = React.useState(false)
  const [nombre, setNombre] = React.useState(editar?.nombre ?? "")
  const [clienteId, setClienteId] = React.useState<number | null>(editar?.cliente_id ?? null)
  const [cargo, setCargo] = React.useState(editar?.cargo ?? "")
  const [telefono, setTelefono] = React.useState(editar?.telefono ?? "")
  const [correo, setCorreo] = React.useState(editar?.correo ?? "")
  const [cumple, setCumple] = React.useState(editar?.cumpleanos ?? "")
  const [notas, setNotas] = React.useState(editar?.notas ?? "")
  const [cliOpen, setCliOpen] = React.useState(false)
  const cliSel = clientes.find((c) => c.id === clienteId) ?? null

  async function guardar() {
    setSaving(true)
    const res = await saveContacto({ id: editar?.id, cliente_id: clienteId, nombre, cargo, telefono, correo, cumpleanos: cumple || null, notas, activo: editar?.activo ?? true })
    setSaving(false)
    if (res.error || !res.data) return toast({ title: "No se pudo guardar", description: res.error ?? "", variant: "destructive" })
    toast({ title: editar ? "Contacto actualizado" : "Contacto creado" })
    onSaved(res.data)
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1"><Label>Nombre</Label><Input value={nombre} onChange={(e) => setNombre(e.target.value)} autoFocus /></div>
        <div className="space-y-1"><Label>Cargo</Label><Input value={cargo} onChange={(e) => setCargo(e.target.value)} /></div>
      </div>
      <div className="space-y-1">
        <Label>Cliente (opcional)</Label>
        <Popover open={cliOpen} onOpenChange={setCliOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" role="combobox" className="w-full justify-between font-normal"><span className="truncate">{cliSel ? cliSel.nombre : "Prospecto / sin cliente"}</span><ChevronsUpDown className="h-4 w-4 opacity-50" /></Button>
          </PopoverTrigger>
          <PopoverContent className="p-0 w-[320px]" align="start">
            <Command>
              <CommandInput placeholder="Buscar cliente…" />
              <CommandList>
                <CommandEmpty>Sin resultados.</CommandEmpty>
                <CommandGroup>
                  <CommandItem value="__ninguno" onSelect={() => { setClienteId(null); setCliOpen(false) }}><Check className={`mr-2 h-4 w-4 ${clienteId == null ? "opacity-100" : "opacity-0"}`} /> Sin cliente</CommandItem>
                  {clientes.map((c) => (
                    <CommandItem key={c.id} value={`${c.nombre} ${c.rtn || ""}`} onSelect={() => { setClienteId(c.id ?? null); setCliOpen(false) }}>
                      <Check className={`mr-2 h-4 w-4 ${c.id === clienteId ? "opacity-100" : "opacity-0"}`} /> {c.nombre}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1"><Label>Teléfono</Label><Input value={telefono} onChange={(e) => setTelefono(e.target.value)} /></div>
        <div className="space-y-1"><Label>Correo</Label><Input type="email" value={correo} onChange={(e) => setCorreo(e.target.value)} /></div>
        <div className="space-y-1"><Label>Cumpleaños</Label><Input type="date" value={cumple} onChange={(e) => setCumple(e.target.value)} /></div>
      </div>
      <div className="space-y-1"><Label>Notas</Label><Textarea rows={2} value={notas} onChange={(e) => setNotas(e.target.value)} /></div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={saving}>Cancelar</Button>
        <Button onClick={guardar} disabled={saving || !nombre.trim()}>{saving && <Loader2 className="h-4 w-4 animate-spin mr-1" />} Guardar</Button>
      </DialogFooter>
    </div>
  )
}

function EtapaForm({ editar, siguienteOrden, onClose, onSaved }: { editar: EtapaCrm | null; siguienteOrden: number; onClose: () => void; onSaved: (e: EtapaCrm) => void }) {
  const { toast } = useToast()
  const [saving, setSaving] = React.useState(false)
  const [nombre, setNombre] = React.useState(editar?.nombre ?? "")
  const [orden, setOrden] = React.useState(String(editar?.orden ?? siguienteOrden))
  const [prob, setProb] = React.useState(String(editar?.probabilidad ?? 50))
  const [activo, setActivo] = React.useState(editar?.activo !== false)

  async function guardar() {
    setSaving(true)
    const res = await saveEtapa({ id: editar?.id, nombre, orden: Number(orden) || 0, probabilidad: Number(prob) || 0, activo })
    setSaving(false)
    if (res.error || !res.data) return toast({ title: "No se pudo guardar", description: res.error ?? "", variant: "destructive" })
    onSaved(res.data)
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1"><Label>Nombre</Label><Input value={nombre} onChange={(e) => setNombre(e.target.value)} autoFocus /></div>
      <div className="grid gap-3 grid-cols-2">
        <div className="space-y-1"><Label>Orden</Label><Input type="number" value={orden} onChange={(e) => setOrden(e.target.value)} /></div>
        <div className="space-y-1"><Label>Probabilidad (%)</Label><Input type="number" min={0} max={100} value={prob} onChange={(e) => setProb(e.target.value)} /></div>
      </div>
      <label className="flex items-center gap-2 text-sm"><Checkbox checked={activo} onCheckedChange={(v) => setActivo(v === true)} /> Activa (visible en el tablero)</label>
      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={saving}>Cancelar</Button>
        <Button onClick={guardar} disabled={saving || !nombre.trim()}>{saving && <Loader2 className="h-4 w-4 animate-spin mr-1" />} Guardar</Button>
      </DialogFooter>
    </div>
  )
}
