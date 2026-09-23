"use client"

import { useState, useEffect } from "react"
import { Plus, Pencil, Trash2, Loader2, UserCheck, MapPinned, RotateCcw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { Spinner } from "@/components/ui/spinner"
import { useToast } from "@/hooks/use-toast"
import { useTenant } from "@/lib/hooks/use-tenant"
import { useAuth } from "@/lib/contexts/auth-context"
import {
  getVendedores, saveVendedor, deleteVendedor,
  getZonas, saveZona, deleteZona,
  VENDEDORES_FEATURE_PENDING,
  type Vendedor, type Zona,
} from "@/lib/services/vendedores"
import { listUsuariosAction, type UsuarioListItem } from "@/app/(dashboard)/configuracion/usuarios/actions"

const VENDEDOR_VACIO: Vendedor = { nombre: "", usuario_id: null, correo: "", telefono: "", activo: true }
const ZONA_VACIA: Zona = { nombre: "", ciudad: "", activo: true }

export default function VendedoresZonasPage() {
  const { toast } = useToast()
  const { ready, razonSocialId } = useTenant()
  const { user } = useAuth()
  const esAdmin = (user?.rol || "").trim().toLowerCase() === "admin"

  const [loading, setLoading] = useState(true)
  const [pendiente, setPendiente] = useState(false)
  const [vendedores, setVendedores] = useState<Vendedor[]>([])
  const [zonas, setZonas] = useState<Zona[]>([])
  // Usuarios de la empresa para vincular un vendedor (solo lo ve el admin).
  const [usuarios, setUsuarios] = useState<UsuarioListItem[]>([])

  // Diálogo de vendedor
  const [vendDialog, setVendDialog] = useState(false)
  const [vendEditando, setVendEditando] = useState<Vendedor | null>(null)
  const [vendForm, setVendForm] = useState<Vendedor>(VENDEDOR_VACIO)
  const [vendSaving, setVendSaving] = useState(false)

  // Diálogo de zona
  const [zonaDialog, setZonaDialog] = useState(false)
  const [zonaEditando, setZonaEditando] = useState<Zona | null>(null)
  const [zonaForm, setZonaForm] = useState<Zona>(ZONA_VACIA)
  const [zonaSaving, setZonaSaving] = useState(false)

  useEffect(() => {
    if (!ready) return
    if (razonSocialId == null) {
      setLoading(false)
      return
    }
    loadAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, razonSocialId])

  useEffect(() => {
    if (!ready || !esAdmin) return
    listUsuariosAction().then((r) => {
      if (!r.error) setUsuarios(r.usuarios.filter((u) => u.activo))
    })
  }, [ready, esAdmin])

  async function loadAll() {
    setLoading(true)
    const [vRes, zRes] = await Promise.all([getVendedores(), getZonas()])
    if (vRes.error === VENDEDORES_FEATURE_PENDING || zRes.error === VENDEDORES_FEATURE_PENDING) {
      setPendiente(true)
    } else {
      if (vRes.error) toast({ title: "No se pudieron cargar los vendedores", description: vRes.error, variant: "destructive" })
      if (zRes.error) toast({ title: "No se pudieron cargar las zonas", description: zRes.error, variant: "destructive" })
    }
    setVendedores(vRes.data)
    setZonas(zRes.data)
    setLoading(false)
  }

  // ---------- Vendedores ----------
  function abrirNuevoVendedor() {
    setVendEditando(null)
    setVendForm(VENDEDOR_VACIO)
    setVendDialog(true)
  }

  function abrirEditarVendedor(v: Vendedor) {
    setVendEditando(v)
    setVendForm({ ...VENDEDOR_VACIO, ...v })
    setVendDialog(true)
  }

  async function guardarVendedor() {
    if (!vendForm.nombre.trim()) {
      toast({ title: "Falta el nombre", variant: "destructive" })
      return
    }
    setVendSaving(true)
    const { error } = await saveVendedor({ ...vendForm, id: vendEditando?.id }, !vendEditando)
    setVendSaving(false)
    if (error) {
      toast({ title: "Error", description: error, variant: "destructive" })
      return
    }
    toast({ title: vendEditando ? "Vendedor actualizado" : "Vendedor creado", description: vendForm.nombre })
    setVendDialog(false)
    loadAll()
  }

  async function eliminarVendedor(v: Vendedor) {
    if (!v.id) return
    if (!confirm(`¿Eliminar al vendedor "${v.nombre}"?\n\nSi tiene ventas registradas no se borra: se desactiva y sus ventas conservan el vendedor.`)) return
    const { success, modo, error } = await deleteVendedor(v.id)
    if (!success || error) {
      toast({ title: "Error", description: error || "No se pudo eliminar", variant: "destructive" })
      return
    }
    toast({
      title: modo === "desactivado" ? "Vendedor desactivado" : "Vendedor eliminado",
      description: modo === "desactivado" ? "Tenía ventas registradas: se desactivó." : "Se eliminó del catálogo.",
    })
    loadAll()
  }

  async function reactivarVendedor(v: Vendedor) {
    const { error } = await saveVendedor({ ...v, activo: true }, false)
    if (error) toast({ title: "Error", description: error, variant: "destructive" })
    else loadAll()
  }

  // ---------- Zonas ----------
  function abrirNuevaZona() {
    setZonaEditando(null)
    setZonaForm(ZONA_VACIA)
    setZonaDialog(true)
  }

  function abrirEditarZona(z: Zona) {
    setZonaEditando(z)
    setZonaForm({ ...ZONA_VACIA, ...z })
    setZonaDialog(true)
  }

  async function guardarZona() {
    if (!zonaForm.nombre.trim()) {
      toast({ title: "Falta el nombre", variant: "destructive" })
      return
    }
    setZonaSaving(true)
    const { error } = await saveZona({ ...zonaForm, id: zonaEditando?.id }, !zonaEditando)
    setZonaSaving(false)
    if (error) {
      toast({ title: "Error", description: error, variant: "destructive" })
      return
    }
    toast({ title: zonaEditando ? "Zona actualizada" : "Zona creada", description: zonaForm.nombre })
    setZonaDialog(false)
    loadAll()
  }

  async function eliminarZona(z: Zona) {
    if (!z.id) return
    if (!confirm(`¿Eliminar la zona "${z.nombre}"?\n\nSi tiene clientes asignados no se borra: se desactiva.`)) return
    const { success, modo, error } = await deleteZona(z.id)
    if (!success || error) {
      toast({ title: "Error", description: error || "No se pudo eliminar", variant: "destructive" })
      return
    }
    toast({ title: modo === "desactivado" ? "Zona desactivada" : "Zona eliminada" })
    loadAll()
  }

  async function reactivarZona(z: Zona) {
    const { error } = await saveZona({ ...z, activo: true }, false)
    if (error) toast({ title: "Error", description: error, variant: "destructive" })
    else loadAll()
  }

  const usuarioNombre = (id?: string | null) => usuarios.find((u) => u.id === id)?.nombre

  return (
    <div className="space-y-4 md:space-y-6">
      <div className="flex items-center gap-3">
        <div className="rounded-lg bg-amber-100 p-2 text-amber-700">
          <UserCheck className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold text-stone-800">Vendedores y Zonas</h1>
          <p className="text-sm text-muted-foreground">
            Vendedores para asociar a cada venta (comisiones y reportes) y zonas de los clientes.
          </p>
        </div>
      </div>

      {pendiente && (
        <Card className="border-amber-200 bg-amber-50">
          <CardContent className="p-4 text-sm text-amber-800">{VENDEDORES_FEATURE_PENDING}</CardContent>
        </Card>
      )}

      <Tabs defaultValue="vendedores">
        <TabsList>
          <TabsTrigger value="vendedores" className="gap-1.5"><UserCheck className="h-4 w-4" /> Vendedores</TabsTrigger>
          <TabsTrigger value="zonas" className="gap-1.5"><MapPinned className="h-4 w-4" /> Zonas</TabsTrigger>
        </TabsList>

        {/* ---------------- Vendedores ---------------- */}
        <TabsContent value="vendedores" className="mt-4">
          <Card>
            <CardHeader className="p-4 md:p-6 pb-3 md:pb-4 flex flex-row items-start justify-between gap-3">
              <div>
                <CardTitle className="text-base md:text-lg">Vendedores</CardTitle>
                <CardDescription className="text-xs md:text-sm">
                  Un vendedor vinculado a un usuario queda preseleccionado cuando ese usuario factura.
                </CardDescription>
              </div>
              <Button onClick={abrirNuevoVendedor} size="sm" disabled={pendiente}>
                <Plus className="h-4 w-4 mr-1" /> Nuevo Vendedor
              </Button>
            </CardHeader>
            <CardContent className="p-4 md:p-6 pt-0">
              {loading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : vendedores.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <UserCheck className="h-10 w-10 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">No hay vendedores registrados</p>
                </div>
              ) : (
                <Table containerClassName="max-h-[60vh] overflow-y-auto">
                  <TableHeader sticky>
                    <TableRow>
                      <TableHead>Nombre</TableHead>
                      <TableHead>Usuario del sistema</TableHead>
                      <TableHead>Contacto</TableHead>
                      <TableHead>Estado</TableHead>
                      <TableHead className="w-24"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {vendedores.map((v) => (
                      <TableRow key={v.id} className={v.activo === false ? "opacity-70" : undefined}>
                        <TableCell className="font-medium">{v.nombre}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {v.usuario_id ? usuarioNombre(v.usuario_id) || "Vinculado" : "—"}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {[v.telefono, v.correo].filter(Boolean).join(" · ") || "—"}
                        </TableCell>
                        <TableCell>
                          {v.activo === false ? (
                            <Badge variant="outline" className="border-stone-300 bg-stone-100 text-stone-500">Inactivo</Badge>
                          ) : (
                            <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">Activo</Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => abrirEditarVendedor(v)}>
                              <Pencil className="h-4 w-4" />
                            </Button>
                            {v.activo === false ? (
                              <Button variant="ghost" size="icon" className="h-8 w-8 text-emerald-600 hover:bg-emerald-50" title="Reactivar" onClick={() => reactivarVendedor(v)}>
                                <RotateCcw className="h-4 w-4" />
                              </Button>
                            ) : (
                              <Button variant="ghost" size="icon" className="h-8 w-8 hover:bg-destructive/10" onClick={() => eliminarVendedor(v)}>
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---------------- Zonas ---------------- */}
        <TabsContent value="zonas" className="mt-4">
          <Card>
            <CardHeader className="p-4 md:p-6 pb-3 md:pb-4 flex flex-row items-start justify-between gap-3">
              <div>
                <CardTitle className="text-base md:text-lg">Zonas</CardTitle>
                <CardDescription className="text-xs md:text-sm">
                  Se asignan a los clientes desde Configuración → Clientes; los reportes de ventas se agrupan por zona.
                </CardDescription>
              </div>
              <Button onClick={abrirNuevaZona} size="sm" disabled={pendiente}>
                <Plus className="h-4 w-4 mr-1" /> Nueva Zona
              </Button>
            </CardHeader>
            <CardContent className="p-4 md:p-6 pt-0">
              {loading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : zonas.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <MapPinned className="h-10 w-10 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">No hay zonas registradas</p>
                </div>
              ) : (
                <Table containerClassName="max-h-[60vh] overflow-y-auto">
                  <TableHeader sticky>
                    <TableRow>
                      <TableHead>Nombre</TableHead>
                      <TableHead>Ciudad</TableHead>
                      <TableHead>Estado</TableHead>
                      <TableHead className="w-24"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {zonas.map((z) => (
                      <TableRow key={z.id} className={z.activo === false ? "opacity-70" : undefined}>
                        <TableCell className="font-medium">{z.nombre}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{z.ciudad || "—"}</TableCell>
                        <TableCell>
                          {z.activo === false ? (
                            <Badge variant="outline" className="border-stone-300 bg-stone-100 text-stone-500">Inactiva</Badge>
                          ) : (
                            <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">Activa</Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => abrirEditarZona(z)}>
                              <Pencil className="h-4 w-4" />
                            </Button>
                            {z.activo === false ? (
                              <Button variant="ghost" size="icon" className="h-8 w-8 text-emerald-600 hover:bg-emerald-50" title="Reactivar" onClick={() => reactivarZona(z)}>
                                <RotateCcw className="h-4 w-4" />
                              </Button>
                            ) : (
                              <Button variant="ghost" size="icon" className="h-8 w-8 hover:bg-destructive/10" onClick={() => eliminarZona(z)}>
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Diálogo Vendedor */}
      <Dialog open={vendDialog} onOpenChange={setVendDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{vendEditando ? "Editar Vendedor" : "Nuevo Vendedor"}</DialogTitle>
            <DialogDescription>Los campos marcados con * son requeridos.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label htmlFor="v-nombre">Nombre <span className="text-destructive">*</span></Label>
              <Input id="v-nombre" value={vendForm.nombre} onChange={(e) => setVendForm({ ...vendForm, nombre: e.target.value })} placeholder="Nombre del vendedor" autoFocus />
            </div>
            {esAdmin && (
              <div className="grid gap-2">
                <Label>Usuario del sistema <span className="text-xs font-normal text-muted-foreground">(opcional)</span></Label>
                <Select
                  value={vendForm.usuario_id || "__none__"}
                  onValueChange={(v) => setVendForm({ ...vendForm, usuario_id: v === "__none__" ? null : v })}
                >
                  <SelectTrigger><SelectValue placeholder="Sin usuario" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Sin usuario</SelectItem>
                    {usuarios.map((u) => (
                      <SelectItem key={u.id} value={u.id}>{u.nombre}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground">
                  Cuando este usuario abra Nueva Venta, quedará preseleccionado como vendedor.
                </p>
              </div>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="v-tel">Teléfono</Label>
                <Input id="v-tel" type="tel" value={vendForm.telefono || ""} onChange={(e) => setVendForm({ ...vendForm, telefono: e.target.value })} placeholder="9999-9999" />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="v-correo">Correo</Label>
                <Input id="v-correo" type="email" value={vendForm.correo || ""} onChange={(e) => setVendForm({ ...vendForm, correo: e.target.value })} placeholder="vendedor@correo.com" />
              </div>
            </div>
            {vendEditando && (
              <div className="flex items-center justify-between rounded-lg border border-stone-200 p-3">
                <Label htmlFor="v-activo">Activo</Label>
                <Switch id="v-activo" checked={vendForm.activo !== false} onCheckedChange={(v) => setVendForm({ ...vendForm, activo: v })} />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setVendDialog(false)}>Cancelar</Button>
            <Button onClick={guardarVendedor} disabled={vendSaving}>
              {vendSaving && <Spinner className="mr-2 h-4 w-4" />}
              Guardar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Diálogo Zona */}
      <Dialog open={zonaDialog} onOpenChange={setZonaDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{zonaEditando ? "Editar Zona" : "Nueva Zona"}</DialogTitle>
            <DialogDescription>Zona geográfica o ruta de clientes.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label htmlFor="z-nombre">Nombre <span className="text-destructive">*</span></Label>
              <Input id="z-nombre" value={zonaForm.nombre} onChange={(e) => setZonaForm({ ...zonaForm, nombre: e.target.value })} placeholder="Ej: Zona Norte" autoFocus />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="z-ciudad">Ciudad</Label>
              <Input id="z-ciudad" value={zonaForm.ciudad || ""} onChange={(e) => setZonaForm({ ...zonaForm, ciudad: e.target.value })} placeholder="Ej: San Pedro Sula" />
            </div>
            {zonaEditando && (
              <div className="flex items-center justify-between rounded-lg border border-stone-200 p-3">
                <Label htmlFor="z-activa">Activa</Label>
                <Switch id="z-activa" checked={zonaForm.activo !== false} onCheckedChange={(v) => setZonaForm({ ...zonaForm, activo: v })} />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setZonaDialog(false)}>Cancelar</Button>
            <Button onClick={guardarZona} disabled={zonaSaving}>
              {zonaSaving && <Spinner className="mr-2 h-4 w-4" />}
              Guardar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
