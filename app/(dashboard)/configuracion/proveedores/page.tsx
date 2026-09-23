"use client"

import { useState, useEffect } from "react"
import { Plus, Truck, Pencil, Trash2, Loader2, ClipboardList } from "lucide-react"
import Link from "next/link"
import { useAuth } from "@/lib/contexts/auth-context"
import { ImportarProveedoresDialog } from "./importar-proveedores-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
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
import { Label } from "@/components/ui/label"
import { Spinner } from "@/components/ui/spinner"
import { useToast } from "@/hooks/use-toast"
import {
  Proveedor,
  getProveedores,
  saveProveedor,
  deleteProveedor,
} from "@/lib/services/catalogos"
import { useTenant } from "@/lib/hooks/use-tenant"

const FORM_VACIO: Partial<Proveedor> = {
  nombre: "",
  rtn: "",
  contacto: "",
  telefono: "",
  correo: "",
  direccion: "",
  pais: "",
  moneda: "",
  dias_credito: null,
  notas: "",
}

export default function ProveedoresConfigPage() {
  const { toast } = useToast()
  const { ready, razonSocialId } = useTenant()
  const { hasModulo } = useAuth()
  const verEstadoCuenta = hasModulo("Reportes de Compras")

  const [proveedores, setProveedores] = useState<Proveedor[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingProveedor, setEditingProveedor] = useState<Proveedor | null>(null)
  const [saving, setSaving] = useState(false)

  const [formData, setFormData] = useState<Partial<Proveedor>>(FORM_VACIO)
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({})

  useEffect(() => {
    if (!ready) return
    if (razonSocialId == null) {
      console.log('[Proveedores] usuario sin razon_social_id')
      setProveedores([])
      setLoading(false)
      return
    }
    loadProveedores()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, razonSocialId])

  async function loadProveedores() {
    setLoading(true)
    try {
      const { data, error } = await getProveedores()
      if (error) {
        console.log('[Proveedores] error:', error)
        toast({ title: "No se pudieron cargar los datos", description: error, variant: "destructive" })
      } else {
        setProveedores(data)
      }
    } catch (err: any) {
      console.log('[Proveedores] excepcion:', err)
      toast({ title: "No se pudieron cargar los datos", description: err?.message || "Error de conexion", variant: "destructive" })
    } finally {
      setLoading(false)
    }
  }

  function openNewDialog() {
    setValidationErrors({})
    setEditingProveedor(null)
    setFormData(FORM_VACIO)
    setDialogOpen(true)
  }

  function openEditDialog(proveedor: Proveedor) {
    setValidationErrors({})
    setEditingProveedor(proveedor)
    setFormData({ ...FORM_VACIO, ...proveedor })
    setDialogOpen(true)
  }

  const validateForm = (): boolean => {
    const errors: Record<string, string> = {}

    if (!formData.nombre?.trim()) {
      errors.nombre = "El nombre es requerido"
    }
    // El RTN es opcional: un proveedor extranjero no tiene.
    if (formData.dias_credito != null && Number(formData.dias_credito) < 0) {
      errors.dias_credito = "Los días de crédito no pueden ser negativos"
    }

    setValidationErrors(errors)
    return Object.keys(errors).length === 0
  }

  async function handleSave() {
    if (!validateForm()) {
      toast({ title: "Error de validacion", description: "Complete todos los campos requeridos", variant: "destructive" })
      return
    }

    setSaving(true)

    const proveedorData: Proveedor = {
      ...editingProveedor,
      nombre: formData.nombre!,
      rtn: formData.rtn || null,
      contacto: formData.contacto || null,
      telefono: formData.telefono || null,
      correo: formData.correo || null,
      direccion: formData.direccion || null,
      pais: formData.pais || null,
      moneda: formData.moneda || null,
      dias_credito:
        formData.dias_credito == null || String(formData.dias_credito).trim() === ""
          ? null
          : Number(formData.dias_credito),
      notas: formData.notas || null,
    }

    const { error } = await saveProveedor(proveedorData, !editingProveedor)
    setSaving(false)

    if (error) {
      toast({ title: "Error", description: error, variant: "destructive" })
    } else {
      toast({ title: "Exito", description: `Proveedor ${editingProveedor ? "actualizado" : "creado"} correctamente` })
      setDialogOpen(false)
      loadProveedores()
    }
  }

  async function handleDelete(proveedor: Proveedor) {
    if (!proveedor.id) return

    if (!confirm(`Eliminar proveedor "${proveedor.nombre}"?`)) {
      return
    }

    const { error } = await deleteProveedor(proveedor.id)
    if (error) {
      toast({ title: "Error", description: error, variant: "destructive" })
    } else {
      toast({ title: "Exito", description: "Proveedor eliminado" })
      loadProveedores()
    }
  }

  /** Resumen de contacto para la tabla: persona · teléfono · correo. */
  function contactoResumen(p: Proveedor): string {
    return [p.contacto, p.telefono, p.correo].filter(Boolean).join(" · ")
  }

  /** Condiciones comerciales: moneda y días de crédito. */
  function condicionesResumen(p: Proveedor): string {
    const partes: string[] = []
    if (p.moneda) partes.push(p.moneda)
    if (p.dias_credito != null && p.dias_credito > 0) partes.push(`${p.dias_credito} días`)
    else if (p.dias_credito === 0) partes.push("Contado")
    return partes.join(" · ")
  }

  return (
    <div className="space-y-4 md:space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-foreground">Configuracion de Proveedores</h1>
          <p className="text-sm md:text-base text-muted-foreground">Gestiona el catalogo de proveedores</p>
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <ImportarProveedoresDialog onImported={loadProveedores} />
          <Button onClick={openNewDialog} size="sm" className="w-full sm:w-auto">
            <Plus className="h-4 w-4 mr-1" />
            Nuevo Proveedor
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader className="p-4 md:p-6 pb-3 md:pb-4">
          <CardTitle className="flex items-center gap-2 text-base md:text-lg">
            <Truck className="h-4 w-4 md:h-5 md:w-5 text-primary" />
            Proveedores
          </CardTitle>
          <CardDescription className="text-xs md:text-sm">Lista de proveedores registrados</CardDescription>
        </CardHeader>
        <CardContent className="p-4 md:p-6 pt-0">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : proveedores.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Truck className="h-10 w-10 md:h-12 md:w-12 mx-auto mb-2 opacity-50" />
              <p className="text-sm md:text-base">No hay proveedores registrados</p>
              <p className="text-xs md:text-sm">Crea tu primer proveedor</p>
            </div>
          ) : (
            <>
              {/* Mobile Card View */}
              <div className="block md:hidden space-y-3">
                {proveedores.map((proveedor) => (
                  <div key={proveedor.id} className="border rounded-lg p-3 bg-card">
                    <div className="flex justify-between items-start">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{proveedor.nombre}</p>
                        <p className="text-xs text-muted-foreground font-mono">{proveedor.rtn || "Sin RTN"}</p>
                        <p className="text-xs text-muted-foreground truncate mt-1">{contactoResumen(proveedor) || "Sin contacto"}</p>
                        {condicionesResumen(proveedor) && (
                          <p className="text-xs text-muted-foreground mt-0.5">{condicionesResumen(proveedor)}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-1 ml-2">
                        {verEstadoCuenta && proveedor.id != null && (
                          <Button variant="ghost" size="icon" className="h-8 w-8" asChild title="Estado de cuenta">
                            <Link href={`/compras/reportes?proveedorId=${proveedor.id}`}><ClipboardList className="h-4 w-4" /></Link>
                          </Button>
                        )}
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEditDialog(proveedor)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 hover:bg-destructive/10" onClick={() => handleDelete(proveedor)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Desktop Table View */}
              <Table className="hidden md:table" containerClassName="max-h-[60vh] overflow-y-auto">
                <TableHeader sticky>
                  <TableRow>
                    <TableHead>Nombre</TableHead>
                    <TableHead>RTN</TableHead>
                    <TableHead>Contacto</TableHead>
                    <TableHead>Condiciones</TableHead>
                    <TableHead className="w-24"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {proveedores.map((proveedor) => (
                    <TableRow key={proveedor.id}>
                      <TableCell className="font-medium">
                        {proveedor.nombre}
                        {proveedor.pais && <div className="text-[11px] text-muted-foreground">{proveedor.pais}</div>}
                      </TableCell>
                      <TableCell className="font-mono text-sm">{proveedor.rtn || "-"}</TableCell>
                      <TableCell className="text-sm">{contactoResumen(proveedor) || "-"}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{condicionesResumen(proveedor) || "-"}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          {verEstadoCuenta && proveedor.id != null && (
                            <Button variant="ghost" size="icon" className="h-8 w-8" asChild title="Estado de cuenta">
                              <Link href={`/compras/reportes?proveedorId=${proveedor.id}`}><ClipboardList className="h-4 w-4" /></Link>
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => openEditDialog(proveedor)}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 hover:bg-destructive/10"
                            onClick={() => handleDelete(proveedor)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </>
          )}
        </CardContent>
      </Card>

      {/* Proveedor Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingProveedor ? "Editar Proveedor" : "Nuevo Proveedor"}</DialogTitle>
            <DialogDescription>
              Complete los datos del proveedor. Los campos marcados con * son requeridos.
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
                placeholder="Nombre del proveedor"
              />
              {validationErrors.nombre && (
                <p className="text-sm text-destructive">{validationErrors.nombre}</p>
              )}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="rtn">
                  RTN <span className="text-xs font-normal text-muted-foreground">(opcional)</span>
                </Label>
                <Input
                  id="rtn"
                  value={formData.rtn || ""}
                  onChange={(e) => setFormData({ ...formData, rtn: e.target.value })}
                  placeholder="0801-1234-56789"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="pais">País</Label>
                <Input
                  id="pais"
                  value={formData.pais || ""}
                  onChange={(e) => setFormData({ ...formData, pais: e.target.value })}
                  placeholder="Honduras"
                />
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="contacto">Persona de contacto</Label>
              <Input
                id="contacto"
                value={formData.contacto || ""}
                onChange={(e) => setFormData({ ...formData, contacto: e.target.value })}
                placeholder="Nombre del vendedor o ejecutivo"
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="telefono">Teléfono</Label>
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
                <Label htmlFor="correo">Correo</Label>
                <Input
                  id="correo"
                  type="email"
                  inputMode="email"
                  value={formData.correo || ""}
                  onChange={(e) => setFormData({ ...formData, correo: e.target.value })}
                  placeholder="ventas@proveedor.com"
                />
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="direccion">Dirección</Label>
              <Input
                id="direccion"
                value={formData.direccion || ""}
                onChange={(e) => setFormData({ ...formData, direccion: e.target.value })}
                placeholder="Dirección física"
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label>Moneda en que factura</Label>
                <Select
                  value={formData.moneda || "__none__"}
                  onValueChange={(v) => setFormData({ ...formData, moneda: v === "__none__" ? "" : v })}
                >
                  <SelectTrigger><SelectValue placeholder="Sin definir" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Sin definir</SelectItem>
                    <SelectItem value="LPS">Lempiras (LPS)</SelectItem>
                    <SelectItem value="USD">Dólares (USD)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="dias-credito">Días de crédito que otorga</Label>
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
                  className={validationErrors.dias_credito ? "border-destructive" : ""}
                  placeholder="0 = contado"
                />
                {validationErrors.dias_credito && (
                  <p className="text-sm text-destructive">{validationErrors.dias_credito}</p>
                )}
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="notas">Notas</Label>
              <Textarea
                id="notas"
                rows={2}
                value={formData.notas || ""}
                onChange={(e) => setFormData({ ...formData, notas: e.target.value })}
                placeholder="Condiciones especiales, horarios de entrega, etc."
              />
            </div>
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
  )
}
