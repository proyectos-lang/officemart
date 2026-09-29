"use client"

import * as React from "react"
import { Users, Plus, Pencil, Search, Download, FileText, Upload, Trash2, ExternalLink, Loader2, AlertTriangle, UserX, UserCheck, Palmtree } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import { Spinner } from "@/components/ui/spinner"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { TablePaginator } from "@/components/ui/table-paginator"
import { useToast } from "@/hooks/use-toast"
import { useAuth } from "@/lib/contexts/auth-context"
import { useTenant } from "@/lib/hooks/use-tenant"
import { formatCurrency } from "@/lib/utils/format"
import { formatHondurasDate, getHondurasTodayISODate } from "@/lib/utils/honduras-time"
import { exportToXlsx } from "@/lib/utils/export"
import { getVendedores, type Vendedor } from "@/lib/services/vendedores"
import {
  getEmpleados, saveEmpleado, setEstadoEmpleado, getUsuariosParaVincular,
  getDocumentosEmpleado, subirDocumentoEmpleado, urlDocumentoEmpleado, eliminarDocumentoEmpleado, documentosPorVencer, antiguedadAnios, diasVacacionesPorAntiguedad,
  getNovedades, calcularSaldoVacaciones, registrarVacaciones, deleteNovedad, type Novedad,
  TIPOS_DOCUMENTO_EMPLEADO,
  type Empleado, type EmpleadoDocumento, type TipoDocumentoEmpleado, type FrecuenciaPago, type TipoContrato, type FormaPagoEmpleado,
} from "@/lib/services/rrhh"

const EMPLEADO_VACIO: Empleado = { nombre: "", tipo_contrato: "Permanente", salario_mensual: 0, frecuencia_pago: "Mensual", forma_pago: "Transferencia", aplica_ihss: true, aplica_rap: true, aplica_isr: true, estado: "Activo" }

export default function EmpleadosPage() {
  const { toast } = useToast()
  const { hasModulo } = useAuth()
  const { ready, razonSocialId } = useTenant()
  const usaVendedores = hasModulo("Vendedores y Zonas")
  const hoy = getHondurasTodayISODate()

  const [loading, setLoading] = React.useState(true)
  const [pendiente, setPendiente] = React.useState<string | null>(null)
  const [empleados, setEmpleados] = React.useState<Empleado[]>([])
  const [docs, setDocs] = React.useState<EmpleadoDocumento[]>([])
  const [vendedores, setVendedores] = React.useState<Vendedor[]>([])
  const [usuarios, setUsuarios] = React.useState<{ id: string; nombre: string; activo: boolean }[]>([])
  const [busqueda, setBusqueda] = React.useState("")
  const [filtroEstado, setFiltroEstado] = React.useState<"Activo" | "Inactivo" | "Todos">("Activo")
  const [pageIndex, setPageIndex] = React.useState(0)
  const [pageSize, setPageSize] = React.useState(50)
  const [editar, setEditar] = React.useState<{ open: boolean; empleado: Empleado | null }>({ open: false, empleado: null })
  const [docsDe, setDocsDe] = React.useState<Empleado | null>(null)
  const [baja, setBaja] = React.useState<{ empleado: Empleado | null; fecha: string; saving: boolean }>({ empleado: null, fecha: hoy, saving: false })
  const [vacDe, setVacDe] = React.useState<Empleado | null>(null)

  async function cargar() {
    const [eRes, dRes] = await Promise.all([getEmpleados(), getDocumentosEmpleado()])
    if (eRes.pendiente) setPendiente(eRes.error)
    else if (eRes.error) toast({ title: "No se pudieron cargar los empleados", description: eRes.error, variant: "destructive" })
    setEmpleados(eRes.data)
    setDocs(dRes.data)
  }

  React.useEffect(() => {
    if (!ready || razonSocialId == null) return
    let activo = true
    Promise.all([
      getEmpleados(),
      getDocumentosEmpleado(),
      usaVendedores ? getVendedores({ soloActivos: true }) : Promise.resolve({ data: [] as Vendedor[], error: null }),
      getUsuariosParaVincular(),
    ]).then(([eRes, dRes, vRes, uRes]) => {
      if (!activo) return
      if (eRes.pendiente) setPendiente(eRes.error)
      else if (eRes.error) toast({ title: "No se pudieron cargar los empleados", description: eRes.error, variant: "destructive" })
      setEmpleados(eRes.data)
      setDocs(dRes.data)
      setVendedores(vRes.data || [])
      setUsuarios(uRes)
      setLoading(false)
    })
    return () => {
      activo = false
    }
  }, [ready, razonSocialId, usaVendedores, toast])

  const visibles = React.useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    return empleados.filter((e) => (filtroEstado === "Todos" || e.estado === filtroEstado) && (!q || [e.nombre, e.codigo, e.identidad, e.puesto, e.departamento].some((s) => (s || "").toLowerCase().includes(q))))
  }, [empleados, busqueda, filtroEstado])

  const porVencer = React.useMemo(() => {
    const nombres = new Map(empleados.map((e) => [e.id, e.nombre]))
    return documentosPorVencer(docs, hoy, 30).map((d) => ({ ...d, empleado: nombres.get(d.empleado_id) || `#${d.empleado_id}` }))
  }, [docs, empleados, hoy])

  async function confirmarBaja() {
    if (!baja.empleado?.id) return
    setBaja((p) => ({ ...p, saving: true }))
    const res = await setEstadoEmpleado(baja.empleado.id, "Inactivo", baja.fecha)
    setBaja((p) => ({ ...p, saving: false }))
    if (!res.success) return toast({ title: "No se pudo dar de baja", description: res.error ?? "", variant: "destructive" })
    toast({ title: "Empleado dado de baja" })
    setBaja({ empleado: null, fecha: hoy, saving: false })
    cargar()
  }

  async function reactivar(e: Empleado) {
    if (!e.id) return
    const res = await setEstadoEmpleado(e.id, "Activo")
    if (!res.success) return toast({ title: "No se pudo reactivar", description: res.error ?? "", variant: "destructive" })
    cargar()
  }

  function exportar() {
    exportToXlsx(
      visibles.map((e) => ({
        Codigo: e.codigo || "", Nombre: e.nombre, Identidad: e.identidad || "", RTN: e.rtn || "", Puesto: e.puesto || "", Departamento: e.departamento || "",
        Ingreso: e.fecha_ingreso || "", Salida: e.fecha_salida || "", Contrato: e.tipo_contrato, "Salario mensual": e.salario_mensual, Frecuencia: e.frecuencia_pago,
        "Forma de pago": e.forma_pago, Banco: e.banco || "", Cuenta: e.cuenta_bancaria || "", IHSS: e.ihss_afiliacion || "", RAP: e.rap_afiliacion || "",
        Telefono: e.telefono || "", Correo: e.correo || "", Estado: e.estado, "Antigüedad (años)": antiguedadAnios(e.fecha_ingreso, hoy, e.fecha_salida),
      })),
      { filename: `empleados_${hoy}`, sheetName: "Empleados" }
    )
  }

  if (loading) return <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground"><Spinner /> Cargando…</div>

  return (
    <div className="space-y-4 md:space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-stone-200 p-2 text-stone-700"><Users className="h-5 w-5" /></div>
          <div>
            <h1 className="text-2xl font-semibold text-stone-800">Empleados</h1>
            <p className="text-sm text-muted-foreground">Ficha laboral, salario, forma de pago, afiliaciones y expediente digital.</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="h-4 w-4 absolute left-2 top-2.5 text-muted-foreground" />
            <Input className="pl-8 w-[200px]" placeholder="Buscar…" value={busqueda} onChange={(e) => { setBusqueda(e.target.value); setPageIndex(0) }} />
          </div>
          <Select value={filtroEstado} onValueChange={(v) => { setFiltroEstado(v as typeof filtroEstado); setPageIndex(0) }}>
            <SelectTrigger className="w-[130px]"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="Activo">Activos</SelectItem><SelectItem value="Inactivo">Inactivos</SelectItem><SelectItem value="Todos">Todos</SelectItem></SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={exportar} disabled={visibles.length === 0} className="gap-1"><Download className="h-4 w-4" /> Excel</Button>
          <Button size="sm" onClick={() => setEditar({ open: true, empleado: null })} disabled={!!pendiente} className="gap-1"><Plus className="h-4 w-4" /> Nuevo empleado</Button>
        </div>
      </div>

      {pendiente && <Card className="border-amber-200 bg-amber-50"><CardContent className="p-4 text-sm text-amber-800 flex items-center gap-2"><AlertTriangle className="h-4 w-4" /> {pendiente}</CardContent></Card>}

      {porVencer.length > 0 && (
        <Card className="border-amber-200 bg-amber-50"><CardContent className="p-4 text-sm text-amber-800">
          <p className="font-medium flex items-center gap-1"><AlertTriangle className="h-4 w-4" /> Documentos vencidos o por vencer (30 días)</p>
          <ul className="mt-1 text-xs space-y-0.5">{porVencer.slice(0, 8).map((d) => <li key={d.id}>{d.empleado} · {d.tipo} «{d.nombre}» {d.diasRestantes < 0 ? `venció hace ${-d.diasRestantes} d` : d.diasRestantes === 0 ? "vence hoy" : `vence en ${d.diasRestantes} d`}</li>)}{porVencer.length > 8 && <li>… y {porVencer.length - 8} más</li>}</ul>
        </CardContent></Card>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Activos</p><p className="text-2xl font-semibold">{empleados.filter((e) => e.estado === "Activo").length}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Planilla mensual (salarios)</p><p className="text-2xl font-semibold">{formatCurrency(empleados.filter((e) => e.estado === "Activo").reduce((a, e) => a + e.salario_mensual, 0))}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Expediente</p><p className="text-2xl font-semibold">{docs.length} <span className="text-sm font-normal text-muted-foreground">documentos</span></p></CardContent></Card>
      </div>

      <div className="overflow-x-auto border rounded-lg">
        <Table>
          <TableHeader><TableRow className="bg-stone-50"><TableHead>Empleado</TableHead><TableHead>Puesto</TableHead><TableHead>Ingreso</TableHead><TableHead className="text-right">Salario</TableHead><TableHead>Pago</TableHead><TableHead>Estado</TableHead><TableHead className="w-32"></TableHead></TableRow></TableHeader>
          <TableBody>
            {visibles.slice(pageIndex * pageSize, (pageIndex + 1) * pageSize).map((e) => {
              const anios = antiguedadAnios(e.fecha_ingreso, hoy, e.fecha_salida)
              const nDocs = docs.filter((d) => d.empleado_id === e.id).length
              return (
                <TableRow key={e.id} className={e.estado === "Inactivo" ? "opacity-60" : ""}>
                  <TableCell><p className="font-medium">{e.nombre}</p><p className="text-xs text-muted-foreground">{[e.codigo, e.identidad].filter(Boolean).join(" · ")}</p></TableCell>
                  <TableCell>{e.puesto || "—"}{e.departamento && <span className="block text-xs text-muted-foreground">{e.departamento}</span>}</TableCell>
                  <TableCell className="text-xs">{e.fecha_ingreso ? formatHondurasDate(e.fecha_ingreso) : "—"}{e.fecha_ingreso && <span className="block text-muted-foreground">{anios} año(s) · {diasVacacionesPorAntiguedad(anios)} d vac.</span>}</TableCell>
                  <TableCell className="text-right font-mono">{formatCurrency(e.salario_mensual)}</TableCell>
                  <TableCell className="text-xs">{e.frecuencia_pago} · {e.forma_pago}</TableCell>
                  <TableCell>{e.estado === "Activo" ? <Badge variant="secondary">Activo</Badge> : <Badge variant="outline">Baja {e.fecha_salida ? formatHondurasDate(e.fecha_salida) : ""}</Badge>}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="icon" className="h-8 w-8" title="Editar" onClick={() => setEditar({ open: true, empleado: e })}><Pencil className="h-4 w-4" /></Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8" title="Vacaciones" onClick={() => setVacDe(e)}><Palmtree className="h-4 w-4" /></Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 relative" title="Expediente" onClick={() => setDocsDe(e)}><FileText className="h-4 w-4" />{nDocs > 0 && <span className="absolute -top-0.5 -right-0.5 text-[9px] bg-stone-700 text-white rounded-full px-1">{nDocs}</span>}</Button>
                      {e.estado === "Activo"
                        ? <Button variant="ghost" size="icon" className="h-8 w-8 text-red-700" title="Dar de baja" onClick={() => setBaja({ empleado: e, fecha: hoy, saving: false })}><UserX className="h-4 w-4" /></Button>
                        : <Button variant="ghost" size="icon" className="h-8 w-8 text-emerald-700" title="Reactivar" onClick={() => reactivar(e)}><UserCheck className="h-4 w-4" /></Button>}
                    </div>
                  </TableCell>
                </TableRow>
              )
            })}
            {visibles.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">Sin empleados.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </div>
      <TablePaginator pageIndex={pageIndex} pageSize={pageSize} totalItems={visibles.length} onPageIndexChange={setPageIndex} onPageSizeChange={(s) => { setPageSize(s); setPageIndex(0) }} />

      <Dialog open={editar.open} onOpenChange={(o) => setEditar((p) => ({ ...p, open: o }))}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editar.empleado ? `Editar · ${editar.empleado.nombre}` : "Nuevo empleado"}</DialogTitle><DialogDescription>Datos personales, laborales, de pago y afiliaciones.</DialogDescription></DialogHeader>
          {editar.open && (
            <EmpleadoForm
              key={editar.empleado?.id ?? "nuevo"}
              inicial={editar.empleado ?? EMPLEADO_VACIO}
              vendedores={vendedores}
              usuarios={usuarios}
              onClose={() => setEditar({ open: false, empleado: null })}
              onSaved={() => { setEditar({ open: false, empleado: null }); cargar() }}
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={docsDe != null} onOpenChange={(o) => { if (!o) setDocsDe(null) }}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader><DialogTitle>Expediente · {docsDe?.nombre}</DialogTitle><DialogDescription>Archivos en el bucket privado (identidad, contrato, certificados…). Máximo 10 MB.</DialogDescription></DialogHeader>
          {docsDe && <ExpedienteEmpleado empleado={docsDe} docs={docs.filter((d) => d.empleado_id === docsDe.id)} onChange={cargar} />}
        </DialogContent>
      </Dialog>

      <Dialog open={vacDe != null} onOpenChange={(o) => { if (!o) setVacDe(null) }}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader><DialogTitle>Vacaciones · {vacDe?.nombre}</DialogTitle><DialogDescription>Causación por antigüedad (10/12/15/20 días), días gozados y liquidación en dinero.</DialogDescription></DialogHeader>
          {vacDe && <VacacionesEmpleado key={vacDe.id} empleado={vacDe} />}
        </DialogContent>
      </Dialog>

      <Dialog open={baja.empleado != null} onOpenChange={(o) => { if (!o) setBaja({ empleado: null, fecha: hoy, saving: false }) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Dar de baja</DialogTitle><DialogDescription>{baja.empleado?.nombre}: el empleado deja de entrar en nóminas posteriores a la fecha de salida.</DialogDescription></DialogHeader>
          <div className="space-y-1"><Label>Fecha de salida</Label><Input type="date" value={baja.fecha} onChange={(e) => setBaja((p) => ({ ...p, fecha: e.target.value }))} /></div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBaja({ empleado: null, fecha: hoy, saving: false })}>Cancelar</Button>
            <Button variant="destructive" onClick={confirmarBaja} disabled={baja.saving || !baja.fecha}>{baja.saving && <Loader2 className="h-4 w-4 animate-spin mr-1" />} Confirmar baja</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function EmpleadoForm({ inicial, vendedores, usuarios, onClose, onSaved }: { inicial: Empleado; vendedores: Vendedor[]; usuarios: { id: string; nombre: string; activo: boolean }[]; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast()
  const [e, setE] = React.useState<Empleado>({ ...inicial })
  const [saving, setSaving] = React.useState(false)
  const set = (patch: Partial<Empleado>) => setE((p) => ({ ...p, ...patch }))
  const txt = (k: keyof Empleado) => ({ value: (e[k] as string | null | undefined) ?? "", onChange: (ev: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => set({ [k]: ev.target.value } as Partial<Empleado>) })

  async function guardar() {
    setSaving(true)
    const res = await saveEmpleado(e)
    setSaving(false)
    if (res.error) return toast({ title: "No se pudo guardar", description: res.error, variant: "destructive" })
    toast({ title: e.id ? "Empleado actualizado" : "Empleado creado" })
    onSaved()
  }

  return (
    <div className="space-y-3">
      <Tabs defaultValue="personal">
        <TabsList className="grid grid-cols-3 w-full"><TabsTrigger value="personal">Personal</TabsTrigger><TabsTrigger value="laboral">Laboral</TabsTrigger><TabsTrigger value="pago">Pago y afiliaciones</TabsTrigger></TabsList>
        <TabsContent value="personal" className="space-y-3 mt-3">
          <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
            <div className="space-y-1"><Label>Nombre completo</Label><Input {...txt("nombre")} autoFocus /></div>
            <div className="space-y-1"><Label>Código</Label><Input {...txt("codigo")} placeholder="E-001" /></div>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1"><Label>Identidad</Label><Input {...txt("identidad")} placeholder="0801-1990-12345" /></div>
            <div className="space-y-1"><Label>RTN</Label><Input {...txt("rtn")} /></div>
            <div className="space-y-1"><Label>Fecha de nacimiento</Label><Input type="date" {...txt("fecha_nacimiento")} /></div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1"><Label>Teléfono</Label><Input {...txt("telefono")} /></div>
            <div className="space-y-1"><Label>Correo</Label><Input type="email" {...txt("correo")} /></div>
          </div>
          <div className="space-y-1"><Label>Dirección</Label><Input {...txt("direccion")} /></div>
        </TabsContent>
        <TabsContent value="laboral" className="space-y-3 mt-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1"><Label>Puesto</Label><Input {...txt("puesto")} /></div>
            <div className="space-y-1"><Label>Departamento</Label><Input {...txt("departamento")} /></div>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1"><Label>Fecha de ingreso</Label><Input type="date" {...txt("fecha_ingreso")} /></div>
            <div className="space-y-1">
              <Label>Tipo de contrato</Label>
              <Select value={e.tipo_contrato} onValueChange={(v) => set({ tipo_contrato: v as TipoContrato })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="Permanente">Permanente</SelectItem><SelectItem value="Temporal">Temporal</SelectItem><SelectItem value="Por hora">Por hora</SelectItem></SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Frecuencia de pago</Label>
              <Select value={e.frecuencia_pago} onValueChange={(v) => set({ frecuencia_pago: v as FrecuenciaPago })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="Mensual">Mensual</SelectItem><SelectItem value="Quincenal">Quincenal</SelectItem></SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1"><Label>Salario mensual (L)</Label><Input type="number" min={0} step="0.01" value={e.salario_mensual || ""} onChange={(ev) => set({ salario_mensual: Number(ev.target.value) || 0 })} /></div>
            <div className="space-y-1">
              <Label>Usuario de la app (marcación)</Label>
              <Select value={e.usuario_id || "0"} onValueChange={(v) => set({ usuario_id: v === "0" ? null : v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="0">Sin usuario</SelectItem>{usuarios.map((u) => <SelectItem key={u.id} value={u.id}>{u.nombre}{u.activo ? "" : " (inactivo)"}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            {vendedores.length > 0 && (
              <div className="space-y-1">
                <Label>Vendedor (comisiones)</Label>
                <Select value={e.vendedor_id != null ? String(e.vendedor_id) : "0"} onValueChange={(v) => set({ vendedor_id: v === "0" ? null : Number(v) })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="0">No es vendedor</SelectItem>{vendedores.map((v) => <SelectItem key={v.id} value={String(v.id)}>{v.nombre}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            )}
          </div>
          <div className="space-y-1"><Label>Notas</Label><Textarea rows={2} {...txt("notas")} /></div>
        </TabsContent>
        <TabsContent value="pago" className="space-y-3 mt-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <Label>Forma de pago</Label>
              <Select value={e.forma_pago} onValueChange={(v) => set({ forma_pago: v as FormaPagoEmpleado })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="Transferencia">Transferencia</SelectItem><SelectItem value="Efectivo">Efectivo</SelectItem></SelectContent>
              </Select>
            </div>
            <div className="space-y-1"><Label>Banco</Label><Input {...txt("banco")} /></div>
            <div className="space-y-1"><Label>Cuenta</Label><Input {...txt("cuenta_bancaria")} /></div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1"><Label>N.º afiliación IHSS</Label><Input {...txt("ihss_afiliacion")} /></div>
            <div className="space-y-1"><Label>N.º afiliación RAP</Label><Input {...txt("rap_afiliacion")} /></div>
          </div>
          <div className="flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2"><Checkbox checked={e.aplica_ihss} onCheckedChange={(v) => set({ aplica_ihss: v === true })} /> Cotiza IHSS</label>
            <label className="flex items-center gap-2"><Checkbox checked={e.aplica_rap} onCheckedChange={(v) => set({ aplica_rap: v === true })} /> Cotiza RAP</label>
            <label className="flex items-center gap-2"><Checkbox checked={e.aplica_isr} onCheckedChange={(v) => set({ aplica_isr: v === true })} /> Retener ISR</label>
          </div>
        </TabsContent>
      </Tabs>
      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={saving}>Cancelar</Button>
        <Button onClick={guardar} disabled={saving || !e.nombre.trim()}>{saving && <Loader2 className="h-4 w-4 animate-spin mr-1" />} Guardar</Button>
      </DialogFooter>
    </div>
  )
}

function VacacionesEmpleado({ empleado }: { empleado: Empleado }) {
  const { toast } = useToast()
  const hoy = getHondurasTodayISODate()
  const [novedades, setNovedades] = React.useState<Novedad[]>([])
  const [cargando, setCargando] = React.useState(true)
  const [modo, setModo] = React.useState<"gozadas" | "pagadas">("gozadas")
  const [dias, setDias] = React.useState("")
  const [fecha, setFecha] = React.useState(hoy)
  const [nota, setNota] = React.useState("")
  const [saving, setSaving] = React.useState(false)

  async function recargar() {
    const res = await getNovedades({ empleadoId: empleado.id ?? null })
    setNovedades(res.data.filter((n) => n.tipo === "Vacaciones" || n.tipo === "Vacaciones pagadas"))
  }

  React.useEffect(() => {
    let activo = true
    getNovedades({ empleadoId: empleado.id ?? null }).then((res) => {
      if (!activo) return
      setNovedades(res.data.filter((n) => n.tipo === "Vacaciones" || n.tipo === "Vacaciones pagadas"))
      setCargando(false)
    })
    return () => {
      activo = false
    }
  }, [empleado.id])

  const s = calcularSaldoVacaciones(empleado, novedades, hoy)

  async function registrar() {
    if (!empleado.id) return
    setSaving(true)
    const res = await registrarVacaciones({ empleado_id: empleado.id, modo, dias: Number(dias) || 0, fecha, descripcion: nota })
    setSaving(false)
    if (res.error) return toast({ title: "No se pudo registrar", description: res.error, variant: "destructive" })
    toast({ title: modo === "pagadas" ? "Liquidación registrada" : "Vacaciones registradas", description: modo === "pagadas" ? "Se pagará en la próxima nómina." : undefined })
    setDias("")
    setNota("")
    recargar()
  }

  async function eliminar(n: Novedad) {
    if (!n.id || !window.confirm("¿Eliminar este registro de vacaciones?")) return
    const res = await deleteNovedad(n.id)
    if (!res.success) return toast({ title: "No se pudo eliminar", description: res.error ?? "", variant: "destructive" })
    recargar()
  }

  if (!empleado.fecha_ingreso) return <p className="text-sm text-amber-700">El empleado no tiene fecha de ingreso: edítalo para calcular la causación.</p>
  if (cargando) return <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground"><Spinner /> Calculando…</div>

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
        <div className="rounded-md border p-2"><p className="text-xs text-muted-foreground">Causado</p><p className="font-semibold">{s.causado_total} d</p><p className="text-[11px] text-muted-foreground">{s.causado_exigible} exigible + {s.causado_proporcional} proporcional</p></div>
        <div className="rounded-md border p-2"><p className="text-xs text-muted-foreground">Gozados</p><p className="font-semibold">{s.gozados} d</p></div>
        <div className="rounded-md border p-2"><p className="text-xs text-muted-foreground">Pagados</p><p className="font-semibold">{s.pagados} d</p></div>
        <div className={`rounded-md border p-2 ${s.saldo < 0 ? "border-red-200 bg-red-50" : "border-emerald-200 bg-emerald-50"}`}><p className="text-xs text-muted-foreground">Saldo</p><p className="font-semibold">{s.saldo} d</p><p className="text-[11px] text-muted-foreground">{formatCurrency(s.valor_saldo)}</p></div>
      </div>
      <p className="text-xs text-muted-foreground">{s.anios_completos} año(s) completos · salario diario {formatCurrency(s.salario_diario)} · al cumplir el próximo año ({s.proximo_aniversario ? formatHondurasDate(s.proximo_aniversario) : "—"}) gana {s.dias_proximo_periodo} días.</p>
      <div className="rounded-md border p-3 space-y-2 bg-stone-50">
        <div className="grid gap-2 sm:grid-cols-[150px_90px_150px]">
          <Select value={modo} onValueChange={(v) => setModo(v as "gozadas" | "pagadas")}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="gozadas">Días gozados</SelectItem><SelectItem value="pagadas">Liquidar (pagar)</SelectItem></SelectContent>
          </Select>
          <Input type="number" min={0} step="0.5" placeholder="Días" value={dias} onChange={(e) => setDias(e.target.value)} />
          <Input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
        </div>
        <div className="flex gap-2">
          <Input placeholder="Nota (opcional)" value={nota} onChange={(e) => setNota(e.target.value)} />
          <Button size="sm" onClick={registrar} disabled={saving || !(Number(dias) > 0)}>{saving && <Loader2 className="h-4 w-4 animate-spin mr-1" />} Registrar</Button>
        </div>
        {modo === "pagadas" && <p className="text-xs text-muted-foreground">Crea la novedad «Vacaciones pagadas»: la próxima nómina paga {Number(dias) > 0 ? formatCurrency((Number(dias) || 0) * s.salario_diario) : "los días"} (días × salario diario), gravable y cotizable.</p>}
      </div>
      <div className="space-y-1 max-h-[35vh] overflow-y-auto">
        {novedades.map((n) => (
          <div key={n.id} className="flex items-center justify-between text-sm border-b py-1.5">
            <span>{formatHondurasDate(n.fecha)} · <Badge variant={n.tipo === "Vacaciones pagadas" ? "secondary" : "outline"}>{n.tipo === "Vacaciones pagadas" ? "Pagadas" : "Gozadas"}</Badge> {n.cantidad} d{n.descripcion ? ` · ${n.descripcion}` : ""}{n.nomina_id ? <span className="text-xs text-muted-foreground"> · nómina #{n.nomina_id}</span> : null}</span>
            {!n.nomina_id && <Button variant="ghost" size="icon" className="h-7 w-7 text-red-700" onClick={() => eliminar(n)}><Trash2 className="h-3.5 w-3.5" /></Button>}
          </div>
        ))}
        {novedades.length === 0 && <p className="text-sm text-muted-foreground text-center py-3">Sin registros de vacaciones.</p>}
      </div>
    </div>
  )
}

function ExpedienteEmpleado({ empleado, docs, onChange }: { empleado: Empleado; docs: EmpleadoDocumento[]; onChange: () => void }) {
  const { toast } = useToast()
  const hoy = getHondurasTodayISODate()
  const [file, setFile] = React.useState<File | null>(null)
  const [tipo, setTipo] = React.useState<TipoDocumentoEmpleado>("Identidad")
  const [nombre, setNombre] = React.useState("")
  const [vence, setVence] = React.useState("")
  const [subiendo, setSubiendo] = React.useState(false)
  const [abriendo, setAbriendo] = React.useState<number | null>(null)

  async function subir() {
    if (!file || !empleado.id) return
    setSubiendo(true)
    const res = await subirDocumentoEmpleado(empleado.id, file, { tipo, nombre: nombre || file.name, vence_en: vence || null })
    setSubiendo(false)
    if (res.error) return toast({ title: "No se pudo subir", description: res.error, variant: "destructive" })
    toast({ title: "Documento guardado" })
    setFile(null)
    setNombre("")
    setVence("")
    onChange()
  }

  async function abrir(d: EmpleadoDocumento) {
    setAbriendo(d.id)
    const { url, error } = await urlDocumentoEmpleado(d.archivo_path)
    setAbriendo(null)
    if (!url) return toast({ title: "No se pudo abrir", description: error ?? "", variant: "destructive" })
    window.open(url, "_blank", "noopener")
  }

  async function eliminar(d: EmpleadoDocumento) {
    if (!window.confirm(`¿Eliminar «${d.nombre}»?`)) return
    const res = await eliminarDocumentoEmpleado(d)
    if (!res.success) return toast({ title: "No se pudo eliminar", description: res.error ?? "", variant: "destructive" })
    onChange()
  }

  const vencidos = documentosPorVencer(docs, hoy, 30)

  return (
    <div className="space-y-3">
      <div className="rounded-md border p-3 space-y-2 bg-stone-50">
        <div className="grid gap-2 sm:grid-cols-[1fr_130px]">
          <Input type="file" onChange={(e) => { const f = e.target.files?.[0] ?? null; setFile(f); if (f && !nombre) setNombre(f.name.replace(/\.[^.]+$/, "")) }} />
          <Select value={tipo} onValueChange={(v) => setTipo(v as TipoDocumentoEmpleado)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{TIPOS_DOCUMENTO_EMPLEADO.map((t) => <SelectItem key={t} value={t}>{t === "Medico" ? "Médico" : t}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="grid gap-2 sm:grid-cols-[1fr_150px_auto]">
          <Input placeholder="Nombre del documento" value={nombre} onChange={(e) => setNombre(e.target.value)} />
          <Input type="date" value={vence} onChange={(e) => setVence(e.target.value)} title="Vence (opcional)" />
          <Button size="sm" onClick={subir} disabled={!file || subiendo} className="gap-1">{subiendo ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} Subir</Button>
        </div>
      </div>
      <div className="space-y-1.5 max-h-[50vh] overflow-y-auto">
        {docs.map((d) => {
          const v = vencidos.find((x) => x.id === d.id)
          return (
            <div key={d.id} className="flex items-center justify-between gap-2 rounded-md border p-2 text-sm">
              <div className="min-w-0">
                <p className="font-medium truncate">{d.nombre} <Badge variant="outline" className="ml-1 text-[10px]">{d.tipo}</Badge></p>
                <p className="text-xs text-muted-foreground">{formatHondurasDate(d.created_at)}{d.vence_en ? ` · vence ${formatHondurasDate(d.vence_en)}` : ""}{v && <span className={`ml-1 ${v.diasRestantes < 0 ? "text-red-700" : "text-amber-700"}`}>{v.diasRestantes < 0 ? "(vencido)" : `(${v.diasRestantes} d)`}</span>}</p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => abrir(d)} disabled={abriendo === d.id}>{abriendo === d.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />}</Button>
                <Button variant="ghost" size="icon" className="h-8 w-8 text-red-700" onClick={() => eliminar(d)}><Trash2 className="h-4 w-4" /></Button>
              </div>
            </div>
          )
        })}
        {docs.length === 0 && <p className="text-sm text-muted-foreground py-4 text-center">Sin documentos.</p>}
      </div>
    </div>
  )
}
