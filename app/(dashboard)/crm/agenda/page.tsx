"use client"

import * as React from "react"
import Link from "next/link"
import { CalendarCheck, Plus, Check, Pencil, Trash2, Cake, AlertTriangle, Phone, MapPin, Users, Mail, ListTodo, StickyNote, RotateCcw, Loader2, History } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Spinner } from "@/components/ui/spinner"
import { Checkbox } from "@/components/ui/checkbox"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useToast } from "@/hooks/use-toast"
import { useAuth } from "@/lib/contexts/auth-context"
import { useTenant } from "@/lib/hooks/use-tenant"
import { formatHondurasDate, formatHondurasDateTime, getHondurasTodayISODate } from "@/lib/utils/honduras-time"
import { getClientes, type Cliente } from "@/lib/services/catalogos"
import { getVendedores, getVendedorDeUsuario, type Vendedor } from "@/lib/services/vendedores"
import { ActividadDialog } from "@/components/crm/actividad-dialog"
import {
  getAgenda, getActividades, getOportunidades, getContactos, completarActividad, reabrirActividad, eliminarActividad, hondurasLocalAIso,
  type Agenda, type ActividadCrm, type ContactoCrm, type OportunidadCrm, type TipoActividad, type ActividadInput,
} from "@/lib/services/crm"

const ICONO_TIPO: Record<TipoActividad, React.ComponentType<{ className?: string }>> = {
  Llamada: Phone, Visita: MapPin, Reunion: Users, Correo: Mail, Tarea: ListTodo, Nota: StickyNote,
}

export default function AgendaPage() {
  const { toast } = useToast()
  const { user, hasModulo } = useAuth()
  const { ready, razonSocialId } = useTenant()
  const usaVendedores = hasModulo("Vendedores y Zonas")
  const hoy = getHondurasTodayISODate()

  const [loading, setLoading] = React.useState(true)
  const [pendiente, setPendiente] = React.useState<string | null>(null)
  const [agenda, setAgenda] = React.useState<Agenda | null>(null)
  const [historial, setHistorial] = React.useState<ActividadCrm[]>([])
  const [verHistorial, setVerHistorial] = React.useState(false)
  const [oportunidades, setOportunidades] = React.useState<OportunidadCrm[]>([])
  const [clientes, setClientes] = React.useState<Cliente[]>([])
  const [contactos, setContactos] = React.useState<ContactoCrm[]>([])
  const [vendedores, setVendedores] = React.useState<Vendedor[]>([])
  const [vendedorPropio, setVendedorPropio] = React.useState<number | null>(null)
  const [vendedorFiltro, setVendedorFiltro] = React.useState("todos")

  const [actDialog, setActDialog] = React.useState<{ open: boolean; editar: ActividadCrm | null; defaults?: Partial<ActividadInput> }>({ open: false, editar: null })
  const [completar, setCompletar] = React.useState<{ actividad: ActividadCrm | null; resultado: string; siguiente: boolean; saving: boolean }>({ actividad: null, resultado: "", siguiente: false, saving: false })

  const cargarAgenda = React.useCallback(async (vendedor: string) => {
    const vId = vendedor === "todos" ? null : Number(vendedor)
    const [aRes, hRes] = await Promise.all([
      getAgenda({ vendedorId: vId, diasAdelante: 7 }),
      getActividades({ desde: fechaMenosDias(getHondurasTodayISODate(), 30), hasta: getHondurasTodayISODate(), vendedorId: vId, limite: 300 }),
    ])
    if (aRes.pendiente) setPendiente(aRes.error)
    else if (aRes.error) toast({ title: "No se pudo cargar la agenda", description: aRes.error, variant: "destructive" })
    setAgenda(aRes.data)
    setHistorial(hRes.data.filter((a) => a.completada).sort((a, b) => (b.completada_at || "").localeCompare(a.completada_at || "")))
  }, [toast])

  React.useEffect(() => {
    if (!ready || razonSocialId == null) return
    let activo = true
    Promise.all([
      getOportunidades({ estado: "Abierta" }),
      getClientes({ soloActivos: true }),
      getContactos(),
      usaVendedores ? getVendedores({ soloActivos: true }) : Promise.resolve({ data: [] as Vendedor[], error: null }),
      usaVendedores ? getVendedorDeUsuario(user?.auth_user_id) : Promise.resolve(null),
    ]).then(async ([oRes, cRes, conRes, vRes, vProp]) => {
      if (!activo) return
      setOportunidades(oRes.data)
      setClientes(cRes.data || [])
      setContactos(conRes.data)
      setVendedores(vRes.data || [])
      const propio = vProp?.id ?? null
      setVendedorPropio(propio)
      const filtro = propio != null ? String(propio) : "todos"
      setVendedorFiltro(filtro)
      await cargarAgenda(filtro)
      if (activo) setLoading(false)
    })
    return () => {
      activo = false
    }
  }, [ready, razonSocialId, usaVendedores, user?.auth_user_id, cargarAgenda])

  function cambiarVendedor(v: string) {
    setVendedorFiltro(v)
    cargarAgenda(v)
  }

  async function confirmarCompletar() {
    const a = completar.actividad
    if (!a) return
    setCompletar((p) => ({ ...p, saving: true }))
    const res = await completarActividad(a.id, completar.resultado)
    setCompletar((p) => ({ ...p, saving: false }))
    if (!res.success) return toast({ title: "No se pudo completar", description: res.error ?? "", variant: "destructive" })
    toast({ title: "Actividad completada" })
    const siguiente = completar.siguiente
    setCompletar({ actividad: null, resultado: "", siguiente: false, saving: false })
    await cargarAgenda(vendedorFiltro)
    if (siguiente) {
      setActDialog({ open: true, editar: null, defaults: { oportunidad_id: a.oportunidad_id, cliente_id: a.cliente_id, contacto_id: a.contacto_id, vendedor_id: a.vendedor_id, tipo: a.tipo, fecha: hondurasLocalAIso(`${fechaMenosDias(hoy, -7)}T09:00`) } })
    }
  }

  async function handleReabrir(a: ActividadCrm) {
    const res = await reabrirActividad(a.id)
    if (!res.success) return toast({ title: "No se pudo reabrir", description: res.error ?? "", variant: "destructive" })
    cargarAgenda(vendedorFiltro)
  }

  async function handleEliminar(a: ActividadCrm) {
    if (!window.confirm(`¿Eliminar "${a.asunto}"?`)) return
    const res = await eliminarActividad(a.id)
    if (!res.success) return toast({ title: "No se pudo eliminar", description: res.error ?? "", variant: "destructive" })
    cargarAgenda(vendedorFiltro)
  }

  if (loading) return <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground"><Spinner /> Cargando…</div>

  const fila = (a: ActividadCrm, tono: "vencida" | "hoy" | "proxima" | "hecha") => {
    const Icono = ICONO_TIPO[a.tipo] ?? ListTodo
    return (
      <div key={a.id} className={`flex items-start gap-3 rounded-md border bg-white p-3 ${tono === "vencida" ? "border-red-200" : tono === "hoy" ? "border-amber-200" : ""} ${tono === "hecha" ? "opacity-75" : ""}`}>
        <div className={`rounded-md p-2 ${tono === "vencida" ? "bg-red-50 text-red-700" : tono === "hoy" ? "bg-amber-50 text-amber-700" : tono === "hecha" ? "bg-emerald-50 text-emerald-700" : "bg-stone-100 text-stone-700"}`}><Icono className="h-4 w-4" /></div>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium text-sm">{a.asunto}</p>
            <Badge variant="outline" className="text-[10px]">{a.tipo === "Reunion" ? "Reunión" : a.tipo}</Badge>
            <span className="text-xs text-muted-foreground">{formatHondurasDateTime(a.fecha)}</span>
          </div>
          <p className="text-xs text-muted-foreground truncate">
            {a.oportunidad_titulo && <Link href="/crm/pipeline" className="hover:underline">{a.oportunidad_titulo}</Link>}
            {a.oportunidad_titulo && (a.cliente_nombre || a.contacto_nombre) && " · "}
            {a.cliente_nombre}{a.contacto_nombre ? ` (${a.contacto_nombre})` : ""}
            {a.vendedor_nombre && <span> · {a.vendedor_nombre}</span>}
          </p>
          {a.descripcion && <p className="text-xs text-stone-600 mt-1 whitespace-pre-wrap">{a.descripcion}</p>}
          {a.completada && a.resultado && <p className="text-xs text-emerald-800 mt-1">Resultado: {a.resultado}</p>}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {!a.completada ? (
            <>
              <Button size="sm" variant="outline" className="h-8 gap-1 text-emerald-700" onClick={() => setCompletar({ actividad: a, resultado: "", siguiente: false, saving: false })}><Check className="h-4 w-4" /> Completar</Button>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setActDialog({ open: true, editar: a })}><Pencil className="h-4 w-4" /></Button>
            </>
          ) : (
            <Button variant="ghost" size="icon" className="h-8 w-8" title="Reabrir" onClick={() => handleReabrir(a)}><RotateCcw className="h-4 w-4" /></Button>
          )}
          <Button variant="ghost" size="icon" className="h-8 w-8 text-red-700" onClick={() => handleEliminar(a)}><Trash2 className="h-4 w-4" /></Button>
        </div>
      </div>
    )
  }

  const seccion = (titulo: string, items: ActividadCrm[], tono: "vencida" | "hoy" | "proxima", vacio: string) => (
    <Card>
      <CardHeader className="p-4 pb-2"><CardTitle className={`text-base flex items-center gap-2 ${tono === "vencida" ? "text-red-700" : ""}`}>{tono === "vencida" && <AlertTriangle className="h-4 w-4" />}{titulo} <Badge variant="secondary">{items.length}</Badge></CardTitle></CardHeader>
      <CardContent className="p-4 pt-0 space-y-2">
        {items.map((a) => fila(a, tono))}
        {items.length === 0 && <p className="text-sm text-muted-foreground py-2">{vacio}</p>}
      </CardContent>
    </Card>
  )

  return (
    <div className="space-y-4 md:space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-stone-200 p-2 text-stone-700"><CalendarCheck className="h-5 w-5" /></div>
          <div>
            <h1 className="text-2xl font-semibold text-stone-800">CRM · Agenda</h1>
            <p className="text-sm text-muted-foreground">Seguimientos vencidos, de hoy y de los próximos 7 días; cumpleaños de clientes y contactos.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {vendedores.length > 0 && (
            <Select value={vendedorFiltro} onValueChange={cambiarVendedor}>
              <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos los vendedores</SelectItem>
                {vendedores.map((v) => <SelectItem key={v.id} value={String(v.id)}>{v.nombre}{v.id === vendedorPropio ? " (yo)" : ""}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          <Button size="sm" onClick={() => setActDialog({ open: true, editar: null, defaults: { vendedor_id: vendedorPropio, fecha: hondurasLocalAIso(`${hoy}T09:00`) } })} disabled={!!pendiente} className="gap-1"><Plus className="h-4 w-4" /> Nueva actividad</Button>
        </div>
      </div>

      {pendiente && <Card className="border-amber-200 bg-amber-50"><CardContent className="p-4 text-sm text-amber-800 flex items-center gap-2"><AlertTriangle className="h-4 w-4" /> {pendiente}</CardContent></Card>}

      {agenda && (
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2 space-y-4">
            {seccion("Vencidas", agenda.vencidas, "vencida", "Nada vencido. ¡Bien!")}
            {seccion(`Hoy · ${formatHondurasDate(hoy)}`, agenda.hoy, "hoy", "Sin actividades para hoy.")}
            {seccion("Próximos 7 días", agenda.proximas, "proxima", "Nada programado.")}
          </div>
          <div className="space-y-4">
            <Card>
              <CardHeader className="p-4 pb-2"><CardTitle className="text-base flex items-center gap-2"><Cake className="h-4 w-4 text-pink-600" /> Cumpleaños (7 días)</CardTitle></CardHeader>
              <CardContent className="p-4 pt-0 space-y-2">
                {agenda.cumpleanos.map((c) => (
                  <div key={`${c.tipo}-${c.id}`} className="flex items-center justify-between text-sm">
                    <div>
                      <p className="font-medium">{c.nombre}</p>
                      <p className="text-xs text-muted-foreground">{c.tipo === "cliente" ? "Cliente" : "Contacto"} · {formatHondurasDate(c.proximo)}</p>
                    </div>
                    <Badge variant={c.diasFaltan === 0 ? "default" : "outline"}>{c.diasFaltan === 0 ? "¡Hoy!" : c.diasFaltan === 1 ? "Mañana" : `en ${c.diasFaltan} días`}</Badge>
                  </div>
                ))}
                {agenda.cumpleanos.length === 0 && <p className="text-sm text-muted-foreground">Ninguno en la semana.</p>}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="p-4 pb-2">
                <CardTitle className="text-base flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2"><History className="h-4 w-4" /> Completadas (30 días)</span>
                  <label className="flex items-center gap-1 text-xs font-normal text-muted-foreground"><Checkbox checked={verHistorial} onCheckedChange={(v) => setVerHistorial(v === true)} /> ver</label>
                </CardTitle>
              </CardHeader>
              {verHistorial && (
                <CardContent className="p-4 pt-0 space-y-2 max-h-[60vh] overflow-y-auto">
                  {historial.map((a) => fila(a, "hecha"))}
                  {historial.length === 0 && <p className="text-sm text-muted-foreground">Sin actividades completadas.</p>}
                </CardContent>
              )}
            </Card>
          </div>
        </div>
      )}

      <ActividadDialog
        open={actDialog.open}
        onOpenChange={(o) => setActDialog((p) => ({ ...p, open: o }))}
        actividad={actDialog.editar}
        defaults={actDialog.defaults}
        oportunidades={oportunidades}
        clientes={clientes}
        contactos={contactos}
        vendedores={vendedores}
        onSaved={() => cargarAgenda(vendedorFiltro)}
      />

      <Dialog open={completar.actividad != null} onOpenChange={(o) => { if (!o) setCompletar({ actividad: null, resultado: "", siguiente: false, saving: false }) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Completar actividad</DialogTitle>
            <DialogDescription>{completar.actividad?.asunto}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Resultado (opcional)</Label>
              <Textarea rows={3} value={completar.resultado} onChange={(e) => setCompletar((p) => ({ ...p, resultado: e.target.value }))} placeholder="¿Qué pasó? Acuerdos, objeciones, siguiente paso…" autoFocus />
            </div>
            <label className="flex items-center gap-2 text-sm"><Checkbox checked={completar.siguiente} onCheckedChange={(v) => setCompletar((p) => ({ ...p, siguiente: v === true }))} /> Programar la siguiente actividad al terminar</label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCompletar({ actividad: null, resultado: "", siguiente: false, saving: false })}>Cancelar</Button>
            <Button onClick={confirmarCompletar} disabled={completar.saving}>{completar.saving && <Loader2 className="h-4 w-4 animate-spin mr-1" />} Completar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function fechaMenosDias(iso: string, dias: number): string {
  const [y, m, d] = iso.split("-").map(Number)
  const t = new Date(Date.UTC(y, m - 1, d - dias))
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`
}
