"use client"

import { useEffect, useMemo, useState } from "react"
import { Plus, Pencil, Trash2, Loader2, MapPin, Receipt } from "lucide-react"
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { Spinner } from "@/components/ui/spinner"
import { useToast } from "@/hooks/use-toast"
import { useTenant } from "@/lib/hooks/use-tenant"
import { useAuth } from "@/lib/contexts/auth-context"
import { getAlmacenes, getLocalizaciones, type Almacen, type Localizacion } from "@/lib/services/catalogos"
import {
  getPuntosFacturacion,
  savePuntoFacturacion,
  deletePuntoFacturacion,
  etiquetaPunto,
  PUNTOS_FEATURE_PENDING,
  type PuntoFacturacion,
} from "@/lib/services/puntos-facturacion"
import {
  getConfigsCai,
  saveConfigCai,
  nuevaConfigCai,
  tipoDocumentoLabel,
  foliosRestantes,
  TIPOS_DOCUMENTO_CAI,
  type ConfigCai,
} from "@/lib/services/facturacion-cai"
import { ConfigCaiForm } from "@/components/facturacion/config-cai-form"

const PUNTO_VACIO: PuntoFacturacion = {
  codigo: "",
  nombre: "",
  ciudad: "",
  direccion: "",
  telefono: "",
  localizacion_id: null,
  serie_prefijo: "",
  activo: true,
}

/**
 * Puntos de facturación (sucursales): CRUD + CAI por punto (script
 * officemart-004). Cada punto puede tener su localización por defecto, su
 * serie interna (FC-SPS-####) y su propia autorización CAI por tipo de
 * documento. Los usuarios se asignan a un punto desde Configuración → Usuarios.
 */
export default function PuntosFacturacionPage() {
  const { toast } = useToast()
  const { ready, razonSocialId } = useTenant()
  const { user } = useAuth()
  const esAdmin = (user?.rol || "").trim().toLowerCase() === "admin"
  const caiActivo = user?.flags?.facturacion_cai ?? false

  const [loading, setLoading] = useState(true)
  const [pendiente, setPendiente] = useState(false)
  const [puntos, setPuntos] = useState<PuntoFacturacion[]>([])
  const [almacenes, setAlmacenes] = useState<Almacen[]>([])
  const [localizaciones, setLocalizaciones] = useState<Localizacion[]>([])

  // Diálogo de punto
  const [dialog, setDialog] = useState(false)
  const [editando, setEditando] = useState<PuntoFacturacion | null>(null)
  const [form, setForm] = useState<PuntoFacturacion>(PUNTO_VACIO)
  const [saving, setSaving] = useState(false)

  // CAI por punto
  const [caiPuntoId, setCaiPuntoId] = useState<string>("")
  const [caiLoading, setCaiLoading] = useState(false)
  const [caiConfigs, setCaiConfigs] = useState<Record<string, ConfigCai>>({})
  const [caiSavingTipo, setCaiSavingTipo] = useState<string | null>(null)
  // Resumen (folios restantes de Factura) por punto para la tabla.
  const [foliosPorPunto, setFoliosPorPunto] = useState<Record<number, number | null>>({})

  useEffect(() => {
    if (!ready) return
    if (razonSocialId == null) {
      setLoading(false)
      return
    }
    loadAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, razonSocialId])

  async function loadAll() {
    setLoading(true)
    const [pRes, aRes, lRes] = await Promise.all([getPuntosFacturacion(), getAlmacenes(), getLocalizaciones()])
    if (pRes.pendiente) setPendiente(true)
    else if (pRes.error) toast({ title: "No se pudieron cargar los puntos", description: pRes.error, variant: "destructive" })
    setPuntos(pRes.data)
    setAlmacenes(aRes.data || [])
    setLocalizaciones(lRes.data || [])
    setLoading(false)
    if (caiActivo && pRes.data.length > 0) cargarFolios(pRes.data)
  }

  async function cargarFolios(lista: PuntoFacturacion[]) {
    const entradas = await Promise.all(
      lista.map(async (p) => {
        const { data } = await getConfigsCai(p.id!)
        const cfg = data.find((c) => c.tipo_documento === "01" && c.activo)
        return [p.id!, cfg ? foliosRestantes(cfg) : null] as const
      })
    )
    setFoliosPorPunto(Object.fromEntries(entradas))
  }

  const localizacionLabel = useMemo(() => {
    const alm = new Map((almacenes || []).map((a) => [a.id, a.nombre]))
    return new Map(
      localizaciones.map((l) => [l.id, `${alm.get(l.almacen_id) ?? "Almacén"} · ${l.nombre}`])
    )
  }, [almacenes, localizaciones])

  // ---------- Puntos ----------
  function abrirNuevo() {
    setEditando(null)
    setForm(PUNTO_VACIO)
    setDialog(true)
  }

  function abrirEditar(p: PuntoFacturacion) {
    setEditando(p)
    setForm({ ...PUNTO_VACIO, ...p })
    setDialog(true)
  }

  async function guardar() {
    if (!form.codigo.trim() || !form.nombre.trim()) {
      toast({ title: "Faltan datos", description: "Código y nombre son obligatorios.", variant: "destructive" })
      return
    }
    setSaving(true)
    const { data, error } = await savePuntoFacturacion({ ...form, id: editando?.id })
    setSaving(false)
    if (error || !data) {
      toast({ title: "No se pudo guardar", description: error ?? "Intenta de nuevo.", variant: "destructive" })
      return
    }
    toast({ title: editando ? "Punto actualizado" : "Punto creado", description: etiquetaPunto(data) })
    setDialog(false)
    loadAll()
  }

  async function eliminar(p: PuntoFacturacion) {
    if (!p.id) return
    if (!confirm(`¿Eliminar el punto "${etiquetaPunto(p)}"?\n\nSi ya tiene ventas no se borra: se desactiva y las ventas conservan su punto.`)) return
    const { success, desactivado, error } = await deletePuntoFacturacion(p.id)
    if (!success || error) {
      toast({ title: "Error", description: error || "No se pudo eliminar", variant: "destructive" })
      return
    }
    toast({
      title: desactivado ? "Punto desactivado" : "Punto eliminado",
      description: desactivado ? "Tiene ventas registradas; queda inactivo." : etiquetaPunto(p),
    })
    loadAll()
  }

  // ---------- CAI por punto ----------
  async function seleccionarPuntoCai(id: string) {
    setCaiPuntoId(id)
    if (!id) {
      setCaiConfigs({})
      return
    }
    setCaiLoading(true)
    const { data, error } = await getConfigsCai(Number(id))
    if (error) toast({ title: "No se pudo cargar el CAI", description: error, variant: "destructive" })
    const mapa: Record<string, ConfigCai> = {}
    for (const t of TIPOS_DOCUMENTO_CAI) {
      mapa[t.codigo] = { ...nuevaConfigCai(t.codigo), punto_facturacion_id: Number(id) }
    }
    for (const c of data) mapa[c.tipo_documento] = c
    setCaiConfigs(mapa)
    setCaiLoading(false)
  }

  function actualizarCai(tipo: string, cambios: Partial<ConfigCai>) {
    setCaiConfigs((prev) => ({ ...prev, [tipo]: { ...prev[tipo], ...cambios } }))
  }

  async function guardarCai(tipo: string) {
    const cfg = caiConfigs[tipo]
    if (!cfg || !caiPuntoId) return
    setCaiSavingTipo(tipo)
    const { data, error } = await saveConfigCai(cfg, Number(caiPuntoId))
    setCaiSavingTipo(null)
    if (error || !data) {
      toast({ title: "No se pudo guardar", description: error ?? "Intenta de nuevo.", variant: "destructive" })
      return
    }
    setCaiConfigs((prev) => ({ ...prev, [tipo]: data }))
    toast({ title: "CAI guardado", description: `${tipoDocumentoLabel(tipo)} del punto actualizado.` })
    cargarFolios(puntos)
  }

  const puntoCai = puntos.find((p) => String(p.id) === caiPuntoId) ?? null

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="rounded-lg bg-sky-100 p-2 text-sky-700">
          <MapPin className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold text-stone-800">Puntos de Facturación</h1>
          <p className="text-sm text-muted-foreground">
            Sucursales o puntos de venta: cada uno con su almacén, su serie de factura y su propio CAI.
          </p>
        </div>
      </div>

      {pendiente && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{PUNTOS_FEATURE_PENDING}</div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
          <Spinner /> Cargando…
        </div>
      ) : (
        <Tabs defaultValue="puntos">
          <TabsList>
            <TabsTrigger value="puntos">Puntos</TabsTrigger>
            <TabsTrigger value="cai" disabled={!caiActivo}>
              CAI por punto
            </TabsTrigger>
          </TabsList>

          {/* -------- Puntos -------- */}
          <TabsContent value="puntos">
            <Card>
              <CardHeader className="flex flex-row items-start justify-between gap-3">
                <div>
                  <CardTitle className="text-base">Puntos de facturación</CardTitle>
                  <CardDescription>
                    El usuario asignado a un punto vende desde su almacén y con su serie. Sin puntos, la empresa
                    factura como siempre (FC-####).
                  </CardDescription>
                </div>
                {esAdmin && (
                  <Button onClick={abrirNuevo} disabled={pendiente} className="gap-2">
                    <Plus className="h-4 w-4" /> Nuevo punto
                  </Button>
                )}
              </CardHeader>
              <CardContent>
                {puntos.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    Aún no hay puntos. Crea uno por sucursal (p. ej. SPS · San Pedro Sula).
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Código</TableHead>
                        <TableHead>Nombre</TableHead>
                        <TableHead>Ciudad</TableHead>
                        <TableHead>Almacén / localización</TableHead>
                        <TableHead>Serie</TableHead>
                        {caiActivo && <TableHead className="text-right">Folios CAI</TableHead>}
                        <TableHead>Estado</TableHead>
                        {esAdmin && <TableHead className="text-right">Acciones</TableHead>}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {puntos.map((p) => (
                        <TableRow key={p.id}>
                          <TableCell className="font-mono font-medium">{p.codigo}</TableCell>
                          <TableCell>
                            <div className="font-medium">{p.nombre}</div>
                            {p.direccion && <div className="text-xs text-muted-foreground">{p.direccion}</div>}
                          </TableCell>
                          <TableCell>{p.ciudad || "—"}</TableCell>
                          <TableCell className="text-sm">
                            {p.localizacion_id != null ? localizacionLabel.get(p.localizacion_id) ?? `#${p.localizacion_id}` : "—"}
                          </TableCell>
                          <TableCell className="font-mono text-sm">{p.serie_prefijo ? `${p.serie_prefijo}####` : "FC-#### (global)"}</TableCell>
                          {caiActivo && (
                            <TableCell className="text-right text-sm">
                              {foliosPorPunto[p.id!] == null ? (
                                <span className="text-muted-foreground">sin CAI</span>
                              ) : (
                                <span className={foliosPorPunto[p.id!]! <= 20 ? "text-amber-700 font-medium" : ""}>
                                  {foliosPorPunto[p.id!]}
                                </span>
                              )}
                            </TableCell>
                          )}
                          <TableCell>
                            <Badge variant={p.activo ? "default" : "secondary"}>{p.activo ? "Activo" : "Inactivo"}</Badge>
                          </TableCell>
                          {esAdmin && (
                            <TableCell className="text-right">
                              <Button variant="ghost" size="icon" onClick={() => abrirEditar(p)} aria-label="Editar">
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button variant="ghost" size="icon" onClick={() => eliminar(p)} aria-label="Eliminar">
                                <Trash2 className="h-4 w-4 text-red-600" />
                              </Button>
                            </TableCell>
                          )}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* -------- CAI por punto -------- */}
          <TabsContent value="cai" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Receipt className="h-4 w-4 text-amber-700" /> Autorización CAI por punto
                </CardTitle>
                <CardDescription>
                  Cada punto emite con su propio CAI, establecimiento y punto de emisión. Las ventas guardan una foto
                  de la autorización usada, así que puedes renovar el CAI sin afectar facturas anteriores.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid gap-2 sm:max-w-sm">
                  <Label>Punto de facturación</Label>
                  <Select value={caiPuntoId} onValueChange={seleccionarPuntoCai}>
                    <SelectTrigger>
                      <SelectValue placeholder="Elige un punto…" />
                    </SelectTrigger>
                    <SelectContent>
                      {puntos.map((p) => (
                        <SelectItem key={p.id} value={String(p.id)}>
                          {etiquetaPunto(p)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>

            {caiPuntoId &&
              (caiLoading ? (
                <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
                  <Spinner /> Cargando CAI…
                </div>
              ) : (
                <Tabs defaultValue="01">
                  <TabsList>
                    {TIPOS_DOCUMENTO_CAI.map((t) => (
                      <TabsTrigger key={t.codigo} value={t.codigo}>
                        {t.label}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                  {TIPOS_DOCUMENTO_CAI.map((t) =>
                    caiConfigs[t.codigo] ? (
                      <TabsContent key={t.codigo} value={t.codigo}>
                        <ConfigCaiForm
                          cfg={caiConfigs[t.codigo]}
                          onChange={(c) => actualizarCai(t.codigo, c)}
                          onSave={() => guardarCai(t.codigo)}
                          saving={caiSavingTipo === t.codigo}
                          contexto={puntoCai ? etiquetaPunto(puntoCai) : null}
                        />
                      </TabsContent>
                    ) : null
                  )}
                </Tabs>
              ))}
          </TabsContent>
        </Tabs>
      )}

      {/* -------- Diálogo de punto -------- */}
      <Dialog open={dialog} onOpenChange={setDialog}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editando ? "Editar punto" : "Nuevo punto de facturación"}</DialogTitle>
            <DialogDescription>Datos de la sucursal y cómo numera sus facturas.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="grid gap-2">
                <Label htmlFor="pf-codigo">Código</Label>
                <Input
                  id="pf-codigo"
                  value={form.codigo}
                  onChange={(e) => setForm((f) => ({ ...f, codigo: e.target.value.toUpperCase().slice(0, 10) }))}
                  placeholder="SPS"
                  className="font-mono"
                />
              </div>
              <div className="grid gap-2 sm:col-span-2">
                <Label htmlFor="pf-nombre">Nombre</Label>
                <Input
                  id="pf-nombre"
                  value={form.nombre}
                  onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value }))}
                  placeholder="Sucursal San Pedro Sula"
                />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="pf-ciudad">Ciudad</Label>
                <Input id="pf-ciudad" value={form.ciudad ?? ""} onChange={(e) => setForm((f) => ({ ...f, ciudad: e.target.value }))} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="pf-telefono">Teléfono</Label>
                <Input id="pf-telefono" value={form.telefono ?? ""} onChange={(e) => setForm((f) => ({ ...f, telefono: e.target.value }))} />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="pf-direccion">Dirección</Label>
              <Input id="pf-direccion" value={form.direccion ?? ""} onChange={(e) => setForm((f) => ({ ...f, direccion: e.target.value }))} />
            </div>
            <div className="grid gap-2">
              <Label>Almacén / localización por defecto</Label>
              <Select
                value={form.localizacion_id != null ? String(form.localizacion_id) : "none"}
                onValueChange={(v) => setForm((f) => ({ ...f, localizacion_id: v === "none" ? null : Number(v) }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Sin localización" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— Sin localización (se elige en la venta) —</SelectItem>
                  {localizaciones.map((l) => (
                    <SelectItem key={l.id} value={String(l.id)}>
                      {localizacionLabel.get(l.id) ?? l.nombre}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Nueva Venta abre este almacén automáticamente para los usuarios del punto.
              </p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="pf-serie">Prefijo de serie interna (opcional)</Label>
              <Input
                id="pf-serie"
                value={form.serie_prefijo ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, serie_prefijo: e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 12) }))}
                placeholder="FC-SPS-"
                className="font-mono"
              />
              <p className="text-xs text-muted-foreground">
                Con prefijo, el punto numera aparte (FC-SPS-0001, 0002…). Vacío = serie global FC-#### de la empresa.
              </p>
            </div>
            <label className="flex items-center gap-2 text-sm text-stone-700">
              <Switch checked={form.activo} onCheckedChange={(v) => setForm((f) => ({ ...f, activo: v }))} />
              Punto activo
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(false)}>
              Cancelar
            </Button>
            <Button onClick={guardar} disabled={saving} className="gap-2">
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              Guardar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
