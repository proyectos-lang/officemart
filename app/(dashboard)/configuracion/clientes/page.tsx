"use client"

import { useState, useEffect } from "react"
import { Plus, Users, Pencil, Trash2, Loader2, Cake, RotateCcw, Ban } from "lucide-react"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { getZonas, getVendedores, type Zona, type Vendedor } from "@/lib/services/vendedores"
import { ImportarClientesDialog } from "./importar-clientes-dialog"
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
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { Label } from "@/components/ui/label"
import { Spinner } from "@/components/ui/spinner"
import { useToast } from "@/hooks/use-toast"
import {
  Cliente,
  getClientes,
  saveCliente,
  deleteCliente,
  reactivarCliente,
} from "@/lib/services/catalogos"
import { useTenant } from "@/lib/hooks/use-tenant"
import { useAuth } from "@/lib/contexts/auth-context"
import { getAlertaCumple } from "@/lib/utils/cumpleanos"
import { formatCurrency } from "@/lib/utils/format"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import {
  getListasPrecios, getListaDeCliente, setListaDeCliente, type ListaPrecio,
} from "@/lib/services/listas-precios"

export default function ClientesConfigPage() {
  const { toast } = useToast()
  const { ready, razonSocialId } = useTenant()
  const { hasModulo } = useAuth()
  const mostrarListas = hasModulo("Listas de Precios")
  // Modulo "Vendedores y Zonas" (script officemart-002): zona y vendedor por cliente.
  const mostrarVendedores = hasModulo("Vendedores y Zonas")
  const [zonas, setZonas] = useState<Zona[]>([])
  const [vendedores, setVendedores] = useState<Vendedor[]>([])

  const [listasPrecios, setListasPrecios] = useState<ListaPrecio[]>([])
  // Lista asignada al cliente en edicion ("" = precio normal del maestro).
  const [listaClienteId, setListaClienteId] = useState<string>("")

  const [clientes, setClientes] = useState<Cliente[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingCliente, setEditingCliente] = useState<Cliente | null>(null)
  const [saving, setSaving] = useState(false)
  
  const formVacio: Partial<Cliente> = {
    nombre: "",
    rtn: "",
    direccion: "",
    telefono: "",
    correo: "",
    fecha_nacimiento: "",
    limite_credito: null,
    dias_credito: null,
    cliente_relacionado_id: null,
    bloqueado: false,
    motivo_bloqueo: "",
    notas: "",
    zona_id: null,
    vendedor_id: null,
  }
  const [formData, setFormData] = useState<Partial<Cliente>>(formVacio)
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({})

  useEffect(() => {
    if (!ready) return
    if (razonSocialId == null) {
      console.log('[Clientes] usuario sin razon_social_id')
      setClientes([])
      setLoading(false)
      return
    }
    loadClientes()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, razonSocialId])

  // Listas de precios (solo si la empresa tiene el modulo habilitado).
  useEffect(() => {
    if (ready && mostrarListas) getListasPrecios().then((r) => setListasPrecios(r.data))
  }, [ready, mostrarListas])

  // Zonas y vendedores (solo si la empresa tiene el modulo habilitado).
  useEffect(() => {
    if (!ready || !mostrarVendedores) return
    getZonas().then((r) => setZonas(r.data))
    getVendedores().then((r) => setVendedores(r.data))
  }, [ready, mostrarVendedores])

  async function loadClientes() {
    setLoading(true)
    try {
      const { data, error } = await getClientes()
      if (error) {
        console.log('[Clientes] error:', error)
        toast({ title: "No se pudieron cargar los datos", description: error, variant: "destructive" })
      } else {
        setClientes(data)
      }
    } catch (err: any) {
      console.log('[Clientes] excepcion:', err)
      toast({ title: "No se pudieron cargar los datos", description: err?.message || "Error de conexion", variant: "destructive" })
    } finally {
      setLoading(false)
    }
  }

  function openNewDialog() {
    setValidationErrors({})
    setEditingCliente(null)
    setFormData(formVacio)
    setListaClienteId("")
    setDialogOpen(true)
  }

  function openEditDialog(cliente: Cliente) {
    setValidationErrors({})
    setEditingCliente(cliente)
    setFormData({ ...cliente })
    setListaClienteId("")
    if (mostrarListas && cliente.id != null) {
      getListaDeCliente(cliente.id).then((r) => setListaClienteId(r.data != null ? String(r.data) : ""))
    }
    setDialogOpen(true)
  }

  const validateForm = (): boolean => {
    const errors: Record<string, string> = {}
    
    if (!formData.nombre?.trim()) {
      errors.nombre = "El nombre es requerido"
    }
    // RTN is optional per schema
    
    setValidationErrors(errors)
    return Object.keys(errors).length === 0
  }

  async function handleSave() {
    if (!validateForm()) {
      toast({ title: "Error de validacion", description: "Complete todos los campos requeridos", variant: "destructive" })
      return
    }

    setSaving(true)

    const clienteData: Cliente = {
      ...editingCliente,
      nombre: formData.nombre!,
      rtn: formData.rtn || undefined,
      direccion: formData.direccion || undefined,
      telefono: formData.telefono || undefined,
      // fecha_nacimiento: cadena vacia -> undefined para no enviar "" a una
      // columna DATE (Postgres lanzaria error de tipo).
      fecha_nacimiento: formData.fecha_nacimiento || undefined,
      // Limite de credito: "" o invalido -> null (sin limite); el servicio
      // sanea a numero >= 0.
      limite_credito:
        formData.limite_credito == null || String(formData.limite_credito).trim() === ""
          ? null
          : Number(formData.limite_credito),
      // Campos del script officemart-002 (el servicio sanea "" -> null).
      correo: formData.correo || null,
      dias_credito:
        formData.dias_credito == null || String(formData.dias_credito).trim() === ""
          ? null
          : Number(formData.dias_credito),
      cliente_relacionado_id: formData.cliente_relacionado_id ?? null,
      bloqueado: !!formData.bloqueado,
      motivo_bloqueo: formData.bloqueado ? (formData.motivo_bloqueo || null) : null,
      notas: formData.notas || null,
      zona_id: mostrarVendedores ? (formData.zona_id ?? null) : (editingCliente?.zona_id ?? null),
      vendedor_id: mostrarVendedores ? (formData.vendedor_id ?? null) : (editingCliente?.vendedor_id ?? null),
    }

    const { data: guardado, error } = await saveCliente(clienteData, !editingCliente)

    if (error) {
      setSaving(false)
      toast({ title: "Error", description: error, variant: "destructive" })
      return
    }

    // Asignacion de lista de precios (si la empresa tiene el modulo).
    if (mostrarListas) {
      const clienteId = editingCliente?.id ?? guardado?.id
      if (clienteId != null) {
        const listaId = listaClienteId ? Number(listaClienteId) : null
        const res = await setListaDeCliente(clienteId, listaId)
        if (res.error) toast({ title: "Aviso", description: `Cliente guardado, pero la lista no se asignó: ${res.error}`, variant: "destructive" })
      }
    }

    setSaving(false)
    toast({ title: "Exito", description: `Cliente ${editingCliente ? "actualizado" : "creado"} correctamente` })
    setDialogOpen(false)
    loadClientes()
  }

  async function handleDelete(cliente: Cliente) {
    if (!cliente.id) return

    if (!confirm(
      `¿Eliminar el cliente "${cliente.nombre}"?\n\nSi tiene ventas registradas no se borra: se desactiva y deja de aparecer en el punto de venta y demás listas, pero se conserva en el historial de ventas.`
    )) {
      return
    }

    const { success, modo, error } = await deleteCliente(cliente.id)
    if (!success || error) {
      toast({ title: "Error", description: error || "No se pudo eliminar", variant: "destructive" })
    } else {
      toast({
        title: modo === "desactivado" ? "Cliente desactivado" : "Cliente eliminado",
        description:
          modo === "desactivado"
            ? "Tenía ventas registradas: se ocultó de las listas pero sigue en el historial de ventas."
            : "Se eliminó del catálogo.",
      })
      loadClientes()
    }
  }

  async function handleReactivar(cliente: Cliente) {
    if (!cliente.id) return
    const { success, error } = await reactivarCliente(cliente.id)
    if (!success || error) {
      toast({ title: "Error", description: error || "No se pudo reactivar", variant: "destructive" })
    } else {
      toast({ title: "Cliente reactivado", description: `"${cliente.nombre}" vuelve a estar disponible.` })
      loadClientes()
    }
  }

  return (
    <TooltipProvider delayDuration={200}>
    <div className="space-y-4 md:space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-foreground">Configuracion de Clientes</h1>
          <p className="text-sm md:text-base text-muted-foreground">Gestiona el catalogo de clientes</p>
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <ImportarClientesDialog onImported={loadClientes} />
          <Button onClick={openNewDialog} size="sm" className="w-full sm:w-auto">
            <Plus className="h-4 w-4 mr-1" />
            Nuevo Cliente
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader className="p-4 md:p-6 pb-3 md:pb-4">
          <CardTitle className="flex items-center gap-2 text-base md:text-lg">
            <Users className="h-4 w-4 md:h-5 md:w-5 text-primary" />
            Clientes
          </CardTitle>
          <CardDescription className="text-xs md:text-sm">Lista de clientes registrados</CardDescription>
        </CardHeader>
        <CardContent className="p-4 md:p-6 pt-0">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : clientes.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Users className="h-10 w-10 md:h-12 md:w-12 mx-auto mb-2 opacity-50" />
              <p className="text-sm md:text-base">No hay clientes registrados</p>
              <p className="text-xs md:text-sm">Crea tu primer cliente</p>
            </div>
          ) : (
            <>
              {/* Mobile Card View */}
              <div className="block md:hidden space-y-3">
                {clientes.map((cliente) => {
                  const alerta = getAlertaCumple(cliente.fecha_nacimiento)
                  return (
                    <div key={cliente.id} className={`border rounded-lg p-3 ${cliente.activo === false ? "bg-stone-50 opacity-80" : "bg-card"}`}>
                      <div className="flex justify-between items-start">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="font-medium truncate">{cliente.nombre}</p>
                            {cliente.activo === false && (
                              <Badge variant="outline" className="border-stone-300 bg-stone-100 text-stone-500 text-[10px]">Inactivo</Badge>
                            )}
                            {alerta.estado !== "none" && (
                              <BirthdayBadge alerta={alerta} compact />
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground font-mono">{cliente.rtn || "Sin RTN"}</p>
                          <p className="text-xs text-muted-foreground truncate mt-1">{cliente.direccion || "Sin direccion"}</p>
                          <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1 text-xs text-muted-foreground">
                            {cliente.telefono && <span>Tel: {cliente.telefono}</span>}
                            {cliente.fecha_nacimiento && (
                              <span>Nac: {formatBirthDate(cliente.fecha_nacimiento)}</span>
                            )}
                            {cliente.limite_credito != null && cliente.limite_credito > 0 && (
                              <span>Límite: {formatCurrency(cliente.limite_credito)}</span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-1 ml-2">
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEditDialog(cliente)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          {cliente.activo === false ? (
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-emerald-600 hover:bg-emerald-50" title="Reactivar" onClick={() => handleReactivar(cliente)}>
                              <RotateCcw className="h-4 w-4" />
                            </Button>
                          ) : (
                            <Button variant="ghost" size="icon" className="h-8 w-8 hover:bg-destructive/10" onClick={() => handleDelete(cliente)}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Desktop Table View */}
              <Table className="hidden md:table" containerClassName="max-h-[60vh] overflow-y-auto">
                <TableHeader sticky>
                  <TableRow>
                    <TableHead>Nombre</TableHead>
                    <TableHead>RTN</TableHead>
                    <TableHead>Telefono</TableHead>
                    <TableHead>Fecha Nacimiento</TableHead>
                    <TableHead>Direccion</TableHead>
                    <TableHead className="text-right">Crédito</TableHead>
                    {mostrarVendedores && <TableHead>Zona / Vendedor</TableHead>}
                    <TableHead>Estado</TableHead>
                    <TableHead className="w-24"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {clientes.map((cliente) => {
                    const alerta = getAlertaCumple(cliente.fecha_nacimiento)
                    const inactivo = cliente.activo === false
                    return (
                      <TableRow key={cliente.id} className={inactivo ? "opacity-70" : undefined}>
                        <TableCell className="font-medium">
                          <div className="flex items-center gap-2">
                            <span>{cliente.nombre}</span>
                            {alerta.estado !== "none" && (
                              <BirthdayBadge alerta={alerta} />
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="font-mono text-sm">{cliente.rtn || "-"}</TableCell>
                        <TableCell>{cliente.telefono || "-"}</TableCell>
                        <TableCell>
                          {cliente.fecha_nacimiento
                            ? formatBirthDate(cliente.fecha_nacimiento)
                            : "-"}
                        </TableCell>
                        <TableCell>{cliente.direccion || "-"}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {cliente.limite_credito && cliente.limite_credito > 0
                            ? formatCurrency(cliente.limite_credito)
                            : <span className="text-stone-400">Sin límite</span>}
                          {cliente.dias_credito != null && cliente.dias_credito > 0 && (
                            <div className="text-[11px] text-muted-foreground">{cliente.dias_credito} días</div>
                          )}
                        </TableCell>
                        {mostrarVendedores && (
                          <TableCell className="text-sm text-muted-foreground">
                            {zonas.find((z) => z.id === cliente.zona_id)?.nombre || "—"}
                            {" / "}
                            {vendedores.find((v) => v.id === cliente.vendedor_id)?.nombre || "—"}
                          </TableCell>
                        )}
                        <TableCell>
                          <div className="flex items-center gap-1 flex-wrap">
                            {inactivo ? (
                              <Badge variant="outline" className="border-stone-300 bg-stone-100 text-stone-500">Inactivo</Badge>
                            ) : (
                              <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">Activo</Badge>
                            )}
                            {cliente.bloqueado && (
                              <Badge variant="outline" className="border-red-200 bg-red-50 text-red-700 gap-1" title={cliente.motivo_bloqueo || "Bloqueado para crédito"}>
                                <Ban className="h-3 w-3" /> Crédito
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => openEditDialog(cliente)}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            {inactivo ? (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-emerald-600 hover:bg-emerald-50"
                                title="Reactivar cliente"
                                onClick={() => handleReactivar(cliente)}
                              >
                                <RotateCcw className="h-4 w-4" />
                              </Button>
                            ) : (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 hover:bg-destructive/10"
                                title="Eliminar / desactivar"
                                onClick={() => handleDelete(cliente)}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </>
          )}
        </CardContent>
      </Card>

      {/* Cliente Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingCliente ? "Editar Cliente" : "Nuevo Cliente"}</DialogTitle>
            <DialogDescription>
              Complete los datos del cliente. Los campos marcados con * son requeridos.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="nombre">
                Nombre <span className="text-destructive">*</span>
              </Label>
              <Input
                id="nombre"
                value={formData.nombre || ""}
                onChange={(e) => {
                  setFormData({ ...formData, nombre: e.target.value })
                  if (validationErrors.nombre) setValidationErrors(prev => ({ ...prev, nombre: "" }))
                }}
                className={validationErrors.nombre ? "border-destructive" : ""}
                placeholder="Nombre del cliente"
              />
              {validationErrors.nombre && (
                <p className="text-sm text-destructive">{validationErrors.nombre}</p>
              )}
            </div>

            <div className="grid gap-2">
              <Label htmlFor="rtn">RTN</Label>
              <Input
                id="rtn"
                value={formData.rtn || ""}
                onChange={(e) => setFormData({ ...formData, rtn: e.target.value })}
                placeholder="0801-1234-56789"
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="direccion">Direccion</Label>
              <Input
                id="direccion"
                value={formData.direccion || ""}
                onChange={(e) => setFormData({ ...formData, direccion: e.target.value })}
                placeholder="Direccion fisica"
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="correo">Correo</Label>
              <Input
                id="correo"
                type="email"
                inputMode="email"
                value={formData.correo || ""}
                onChange={(e) => setFormData({ ...formData, correo: e.target.value })}
                placeholder="cliente@correo.com"
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="telefono">Telefono</Label>
                <Input
                  id="telefono"
                  type="tel"
                  inputMode="tel"
                  value={formData.telefono || ""}
                  onChange={(e) => setFormData({ ...formData, telefono: e.target.value })}
                  placeholder="9999-9999"
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="fecha-nacimiento">
                  Fecha de Nacimiento
                  <span className="ml-1 text-xs font-normal text-muted-foreground">
                    (opcional)
                  </span>
                </Label>
                <Input
                  id="fecha-nacimiento"
                  type="date"
                  value={formData.fecha_nacimiento || ""}
                  onChange={(e) =>
                    setFormData({ ...formData, fecha_nacimiento: e.target.value })
                  }
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="limite-credito">
                  Límite de Crédito
                  <span className="ml-1 text-xs font-normal text-muted-foreground">
                    (opcional)
                  </span>
                </Label>
                <Input
                  id="limite-credito"
                  type="number"
                  min={0}
                  step="0.01"
                  inputMode="decimal"
                  value={formData.limite_credito ?? ""}
                  onChange={(e) =>
                    setFormData({ ...formData, limite_credito: e.target.value === "" ? null : Number(e.target.value) })
                  }
                  placeholder="0 = sin límite"
                />
                <p className="text-[11px] text-muted-foreground">
                  Máximo que puede deber a crédito. Déjalo en 0 o vacío para no limitar.
                </p>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="dias-credito">
                  Días de Crédito
                  <span className="ml-1 text-xs font-normal text-muted-foreground">(opcional)</span>
                </Label>
                <Input
                  id="dias-credito"
                  type="number"
                  min={0}
                  step="1"
                  inputMode="numeric"
                  value={formData.dias_credito ?? ""}
                  onChange={(e) =>
                    setFormData({ ...formData, dias_credito: e.target.value === "" ? null : Number(e.target.value) })
                  }
                  placeholder="Ej: 30"
                />
                <p className="text-[11px] text-muted-foreground">
                  Plazo de sus facturas a crédito. Con facturas vencidas no se le vende a crédito.
                </p>
              </div>
            </div>

            {/* Bloqueo manual de crédito (script officemart-002). */}
            <div className="rounded-lg border border-stone-200 p-3 space-y-2">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <Label htmlFor="bloqueado" className="flex items-center gap-1.5">
                    <Ban className="h-3.5 w-3.5 text-red-600" /> Bloqueado para crédito
                  </Label>
                  <p className="text-[11px] text-muted-foreground">Solo podrá comprar de contado hasta que se desbloquee.</p>
                </div>
                <Switch
                  id="bloqueado"
                  checked={!!formData.bloqueado}
                  onCheckedChange={(v) => setFormData({ ...formData, bloqueado: v })}
                />
              </div>
              {formData.bloqueado && (
                <Input
                  value={formData.motivo_bloqueo || ""}
                  onChange={(e) => setFormData({ ...formData, motivo_bloqueo: e.target.value })}
                  placeholder="Motivo del bloqueo (ej. cheque devuelto)"
                />
              )}
            </div>

            {mostrarVendedores && (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label>Zona</Label>
                  <Select
                    value={formData.zona_id ? String(formData.zona_id) : "__none__"}
                    onValueChange={(v) => setFormData({ ...formData, zona_id: v === "__none__" ? null : Number(v) })}
                  >
                    <SelectTrigger><SelectValue placeholder="Sin zona" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Sin zona</SelectItem>
                      {zonas.filter((z) => z.activo !== false || z.id === formData.zona_id).map((z) => (
                        <SelectItem key={z.id} value={String(z.id)}>{z.nombre}{z.ciudad ? ` · ${z.ciudad}` : ""}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label>Vendedor asignado</Label>
                  <Select
                    value={formData.vendedor_id ? String(formData.vendedor_id) : "__none__"}
                    onValueChange={(v) => setFormData({ ...formData, vendedor_id: v === "__none__" ? null : Number(v) })}
                  >
                    <SelectTrigger><SelectValue placeholder="Sin vendedor" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Sin vendedor</SelectItem>
                      {vendedores.filter((v) => v.activo !== false || v.id === formData.vendedor_id).map((v) => (
                        <SelectItem key={v.id} value={String(v.id)}>{v.nombre}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}

            <div className="grid gap-2">
              <Label>
                Segundo cliente (relacionado)
                <span className="ml-1 text-xs font-normal text-muted-foreground">(opcional)</span>
              </Label>
              <Select
                value={formData.cliente_relacionado_id ? String(formData.cliente_relacionado_id) : "__none__"}
                onValueChange={(v) => setFormData({ ...formData, cliente_relacionado_id: v === "__none__" ? null : Number(v) })}
              >
                <SelectTrigger><SelectValue placeholder="Ninguno" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Ninguno</SelectItem>
                  {clientes
                    .filter((c) => c.id != null && c.id !== editingCliente?.id && c.activo !== false)
                    .map((c) => (
                      <SelectItem key={c.id} value={String(c.id)}>{c.nombre}</SelectItem>
                    ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">Casa matriz o cliente a quien se le factura. Informativo.</p>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="notas">Notas especiales</Label>
              <Textarea
                id="notas"
                rows={2}
                value={formData.notas || ""}
                onChange={(e) => setFormData({ ...formData, notas: e.target.value })}
                placeholder="Se muestran en Nueva Venta al elegir al cliente"
              />
            </div>

            {mostrarListas && (
              <div className="grid gap-2">
                <Label>Lista de precios</Label>
                <Select
                  value={listaClienteId || "__none__"}
                  onValueChange={(v) => setListaClienteId(v === "__none__" ? "" : v)}
                >
                  <SelectTrigger><SelectValue placeholder="Precio normal (maestro)" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Precio normal (maestro)</SelectItem>
                    {listasPrecios.map((l) => (
                      <SelectItem key={l.id} value={String(l.id)}>
                        {l.nombre}{" "}
                        {l.tipo === "porcentaje" ? `(-${Math.abs(l.porcentaje)}% desc.)` : "(individual)"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Sin lista, el cliente usa el precio del maestro de productos.
                </p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Spinner className="mr-2 h-4 w-4" />}
              Guardar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
    </TooltipProvider>
  )
}

/**
 * Formatea 'YYYY-MM-DD' a 'DD/MM/YYYY' sin sufrir shifts por timezone
 * (no usamos `new Date(...)` que interpreta UTC).
 */
function formatBirthDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!m) return iso
  return `${m[3]}/${m[2]}/${m[1]}`
}

/**
 * Badge visual de cumpleanos. Hoy = rosa fuerte; proximos 1..5 dias = ambar.
 * Envuelto en Tooltip para mostrar el mensaje completo al hover.
 */
function BirthdayBadge({
  alerta,
  compact = false,
}: {
  alerta: ReturnType<typeof getAlertaCumple>
  compact?: boolean
}) {
  const isToday = alerta.estado === "today"
  const colorClasses = isToday
    ? "bg-pink-100 text-pink-700 hover:bg-pink-100 border-pink-200"
    : "bg-amber-100 text-amber-700 hover:bg-amber-100 border-amber-200"
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          variant="outline"
          className={`${colorClasses} gap-1 px-1.5 py-0 h-5 cursor-default`}
          aria-label={alerta.mensaje}
        >
          <Cake className="h-3 w-3" aria-hidden="true" />
          {!compact && (
            <span className="text-[10px] font-semibold leading-none">
              {isToday ? "Hoy" : `${alerta.dias}d`}
            </span>
          )}
        </Badge>
      </TooltipTrigger>
      <TooltipContent side="top">
        <span>
          {isToday ? "Cumpleanos hoy" : `Cumpleanos en ${alerta.dias} ${alerta.dias === 1 ? "dia" : "dias"}`}
        </span>
      </TooltipContent>
    </Tooltip>
  )
}
