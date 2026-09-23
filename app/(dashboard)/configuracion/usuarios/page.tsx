"use client"

import * as React from "react"
import {
  UserPlus,
  Users,
  ShieldCheck,
  Shield,
  Loader2,
  UserCheck,
  UserX,
  Mail,
  ArrowRight,
  KeyRound,
  Eye,
  EyeOff,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Spinner } from "@/components/ui/spinner"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useToast } from "@/hooks/use-toast"
import { useAuth } from "@/lib/contexts/auth-context"
import { useTenant } from "@/lib/hooks/use-tenant"
import {
  CATEGORIAS_ORDEN,
  findModuloByDBName,
  MODULOS,
  type Categoria,
  type ModuloGranular,
} from "@/lib/constants/modulos"
import {
  createUserAction,
  setPermisoAction,
  toggleUsuarioActivoAction,
  setRolAction,
  setPuntoUsuarioAction,
  resetUserPasswordAction,
  listUsuariosAction,
  listPermisosAction,
} from "./actions"
import { getPuntosFacturacion, etiquetaPunto, type PuntoFacturacion } from "@/lib/services/puntos-facturacion"

interface Usuario {
  id: string
  nombre: string
  rol: "admin" | "usuario" | null
  activo: boolean
  email?: string | null
  /** Punto de facturación asignado (officemart-004). */
  punto_facturacion_id?: number | null
}

interface Modulo {
  id: number
  nombre: string
  icono: string | null
}

export default function UsuariosPage() {
  const { toast } = useToast()
  const { user } = useAuth()
  const { ready, razonSocialId } = useTenant()

  const [loading, setLoading] = React.useState(true)
  const [usuarios, setUsuarios] = React.useState<Usuario[]>([])
  const [modulos, setModulos] = React.useState<Modulo[]>([])
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [permisosMap, setPermisosMap] = React.useState<Record<number, boolean>>({})
  const [loadingPermisos, setLoadingPermisos] = React.useState(false)
  const [pendingModuloId, setPendingModuloId] = React.useState<number | null>(null)

  // Create dialog state
  const [createOpen, setCreateOpen] = React.useState(false)
  const [creating, setCreating] = React.useState(false)
  const [form, setForm] = React.useState({
    nombre: "",
    email: "",
    password: "",
    rol: "usuario" as "admin" | "usuario",
  })

  // Reset password dialog state
  const [resetOpen, setResetOpen] = React.useState(false)
  const [resetting, setResetting] = React.useState(false)
  const [resetPassword, setResetPassword] = React.useState("")
  const [resetConfirm, setResetConfirm] = React.useState("")
  const [showResetPassword, setShowResetPassword] = React.useState(false)

  const isAdmin = (user?.rol || "").trim().toLowerCase() === "admin"
  const selectedUser = React.useMemo(
    () => usuarios.find((u) => u.id === selectedId) || null,
    [usuarios, selectedId]
  )

  // Cargar usuarios + modulos via Server Action (bypassea RLS con service role,
  // validando que el caller sea admin del mismo tenant). Esto permite ver todos
  // los usuarios que comparten razon_social_id aunque la politica RLS restrinja
  // la lectura al propio registro.
  const loadInitial = React.useCallback(async () => {
    if (!ready) return
    if (razonSocialId == null) {
      setLoading(false)
      return
    }

    setLoading(true)
    try {
      const { usuarios: u, modulos: m, error } = await listUsuariosAction()

      if (error) {
        console.log("[Usuarios] error cargando:", error)
        toast({
          title: "No se pudieron cargar los usuarios",
          description: error,
          variant: "destructive",
        })
        return
      }

      setUsuarios(u as Usuario[])
      setModulos(m as Modulo[])
    } catch (err: any) {
      console.log("[Usuarios] excepcion:", err)
      toast({
        title: "Error",
        description: err?.message || "Error de conexion",
        variant: "destructive",
      })
    } finally {
      setLoading(false)
    }
  }, [ready, razonSocialId, toast])

  React.useEffect(() => {
    loadInitial()
  }, [loadInitial])

  // Cargar permisos del usuario seleccionado via Server Action
  // (bypassea RLS con service role y valida mismo tenant)
  const loadPermisos = React.useCallback(
    async (usuarioId: string) => {
      setLoadingPermisos(true)
      try {
        const { permisos, error } = await listPermisosAction(usuarioId)

        if (error) {
          console.log("[Usuarios] error cargando permisos:", error)
          toast({
            title: "No se pudieron cargar los permisos",
            description: error,
            variant: "destructive",
          })
          setPermisosMap({})
          return
        }

        setPermisosMap(permisos)
      } finally {
        setLoadingPermisos(false)
      }
    },
    [toast]
  )

  React.useEffect(() => {
    if (selectedId) loadPermisos(selectedId)
    else setPermisosMap({})
  }, [selectedId, loadPermisos])

  // Crear usuario
  async function handleCreate() {
    if (!form.nombre.trim() || !form.email.trim() || !form.password) {
      toast({
        title: "Campos requeridos",
        description: "Complete nombre, correo y contrasena.",
        variant: "destructive",
      })
      return
    }

    setCreating(true)
    const { error, usuarioId } = await createUserAction({
      email: form.email,
      password: form.password,
      nombre: form.nombre,
      rol: form.rol,
    })
    setCreating(false)

    if (error) {
      toast({ title: "No se pudo crear el usuario", description: error, variant: "destructive" })
      return
    }

    toast({ title: "Usuario creado exitosamente", description: form.email })
    setCreateOpen(false)
    setForm({ nombre: "", email: "", password: "", rol: "usuario" })
    await loadInitial()
    if (usuarioId) setSelectedId(usuarioId)
  }

  // Toggle permiso
  async function handleTogglePermiso(moduloId: number, next: boolean) {
    if (!selectedId) return
    // Optimistic update
    const prev = permisosMap[moduloId] ?? false
    setPermisosMap((m) => ({ ...m, [moduloId]: next }))
    setPendingModuloId(moduloId)

    const { error } = await setPermisoAction({
      usuarioId: selectedId,
      moduloId,
      puedeVer: next,
    })

    setPendingModuloId(null)
    if (error) {
      // Revert
      setPermisosMap((m) => ({ ...m, [moduloId]: prev }))
      toast({ title: "No se guardo el permiso", description: error, variant: "destructive" })
      return
    }
    toast({ title: "Permisos actualizados" })
  }

  // Toggle activo
  async function handleToggleActivo(u: Usuario, next: boolean) {
    const { error } = await toggleUsuarioActivoAction({ usuarioId: u.id, activo: next })
    if (error) {
      toast({ title: "No se pudo actualizar", description: error, variant: "destructive" })
      return
    }
    toast({ title: next ? "Usuario activado" : "Usuario desactivado" })
    setUsuarios((list) => list.map((x) => (x.id === u.id ? { ...x, activo: next } : x)))
  }

  // Punto de facturación por usuario (officemart-004). Solo se muestra si la
  // empresa tiene puntos.
  const [puntos, setPuntos] = React.useState<PuntoFacturacion[]>([])
  React.useEffect(() => {
    getPuntosFacturacion({ soloActivos: true }).then((r) => setPuntos(r.data || []))
  }, [])

  async function handleChangePunto(u: Usuario, puntoId: number | null) {
    if ((u.punto_facturacion_id ?? null) === puntoId) return
    const { error } = await setPuntoUsuarioAction({ usuarioId: u.id, puntoId })
    if (error) {
      toast({ title: "No se pudo asignar el punto", description: error, variant: "destructive" })
      return
    }
    toast({ title: puntoId == null ? "Punto quitado" : "Punto asignado" })
    setUsuarios((list) => list.map((x) => (x.id === u.id ? { ...x, punto_facturacion_id: puntoId } : x)))
  }

  // Cambiar rol
  async function handleChangeRol(u: Usuario, rol: "admin" | "usuario") {
    if (u.rol === rol) return
    const { error } = await setRolAction({ usuarioId: u.id, rol })
    if (error) {
      toast({ title: "No se pudo cambiar el rol", description: error, variant: "destructive" })
      return
    }
    toast({ title: "Rol actualizado" })
    setUsuarios((list) => list.map((x) => (x.id === u.id ? { ...x, rol } : x)))
  }

  // Abrir dialogo de reseteo
  function openResetDialog() {
    setResetPassword("")
    setResetConfirm("")
    setShowResetPassword(false)
    setResetOpen(true)
  }

  // Resetear contrasena (sincroniza con Supabase Auth)
  async function handleResetPassword() {
    if (!selectedUser) return

    if (resetPassword.length < 6) {
      toast({
        title: "Contrasena muy corta",
        description: "Debe tener al menos 6 caracteres.",
        variant: "destructive",
      })
      return
    }
    if (resetPassword !== resetConfirm) {
      toast({
        title: "Las contrasenas no coinciden",
        description: "Verifica que ambas contrasenas sean iguales.",
        variant: "destructive",
      })
      return
    }

    setResetting(true)
    const { error } = await resetUserPasswordAction({
      usuarioId: selectedUser.id,
      newPassword: resetPassword,
    })
    setResetting(false)

    if (error) {
      toast({
        title: "No se pudo actualizar la contrasena",
        description: error,
        variant: "destructive",
      })
      return
    }

    toast({
      title: "Contrasena actualizada",
      description: `La nueva contrasena de ${selectedUser.nombre} ya esta activa.`,
    })
    setResetOpen(false)
    setResetPassword("")
    setResetConfirm("")
  }

  // Guard: solo admins
  if (ready && user && !isAdmin) {
    return (
      <div className="flex items-center justify-center py-16">
        <Empty className="max-w-md">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Shield className="h-6 w-6" />
            </EmptyMedia>
            <EmptyTitle>Acceso restringido</EmptyTitle>
            <EmptyDescription>
              Solo los usuarios con rol <span className="font-medium">Admin</span> pueden
              administrar usuarios y permisos.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-foreground">Usuarios y Permisos</h1>
          <p className="text-sm md:text-base text-muted-foreground text-pretty">
            Administra los usuarios de tu empresa y los modulos a los que cada uno puede acceder.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="w-full sm:w-auto">
          <UserPlus className="h-4 w-4 mr-2" />
          Nuevo Usuario
        </Button>
      </div>

      {/* Split view */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 lg:gap-6">
        {/* Lista de usuarios (izq) */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base md:text-lg">
              <Users className="h-4 w-4 md:h-5 md:w-5 text-primary" />
              Usuarios
            </CardTitle>
            <CardDescription className="text-xs md:text-sm">
              {usuarios.length} {usuarios.length === 1 ? "usuario" : "usuarios"} en esta razon social
            </CardDescription>
          </CardHeader>
          <CardContent className="p-3 md:p-4 pt-0">
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : usuarios.length === 0 ? (
              <Empty>
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <Users className="h-5 w-5" />
                  </EmptyMedia>
                  <EmptyTitle>Sin usuarios</EmptyTitle>
                  <EmptyDescription>Crea el primer usuario de tu empresa.</EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                  <Button onClick={() => setCreateOpen(true)} size="sm">
                    <UserPlus className="h-4 w-4 mr-2" />
                    Nuevo Usuario
                  </Button>
                </EmptyContent>
              </Empty>
            ) : (
              <div className="space-y-2">
                {usuarios.map((u) => {
                  const isSelected = u.id === selectedId
                  const isSelf = u.id === user?.usuario_id
                  return (
                    <button
                      key={u.id}
                      onClick={() => setSelectedId(u.id)}
                      className={`w-full text-left rounded-xl border p-3 transition-all flex items-center gap-3 ${
                        isSelected
                          ? "border-primary/40 bg-primary/5 shadow-sm"
                          : "border-border hover:border-primary/30 hover:bg-stone-50"
                      }`}
                    >
                      <div
                        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-sm font-semibold ${
                          u.activo
                            ? "bg-gradient-to-br from-[#7C9A92] to-[#5D7B6F] text-white"
                            : "bg-stone-200 text-stone-500"
                        }`}
                      >
                        {(u.nombre || "U").trim().substring(0, 2).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-sm text-foreground truncate">
                            {u.nombre}
                          </span>
                          {isSelf && (
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4">
                              Tu
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          {(u.rol || "").trim().toLowerCase() === "admin" ? (
                            <Badge className="bg-primary/10 text-primary hover:bg-primary/20 border-primary/20 gap-1 text-[10px] px-1.5 py-0 h-5">
                              <ShieldCheck className="h-3 w-3" />
                              Admin
                            </Badge>
                          ) : (
                            <Badge
                              variant="secondary"
                              className="text-[10px] px-1.5 py-0 h-5"
                            >
                              Usuario
                            </Badge>
                          )}
                          {!u.activo && (
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-5 text-stone-500">
                              Inactivo
                            </Badge>
                          )}
                        </div>
                      </div>
                      {isSelected && (
                        <ArrowRight className="h-4 w-4 text-primary shrink-0" />
                      )}
                    </button>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Detalle + permisos (der) */}
        <Card className="lg:col-span-3">
          {!selectedUser ? (
            <CardContent className="flex items-center justify-center py-16">
              <Empty className="max-w-sm">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <ShieldCheck className="h-5 w-5" />
                  </EmptyMedia>
                  <EmptyTitle>Selecciona un usuario</EmptyTitle>
                  <EmptyDescription>
                    Elige un usuario de la lista para ver y editar sus permisos de acceso
                    a los modulos.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            </CardContent>
          ) : (
            <>
              <CardHeader className="border-b">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div>
                    <CardTitle className="text-lg">{selectedUser.nombre}</CardTitle>
                    <CardDescription className="flex items-center gap-2 mt-1">
                      {(selectedUser.rol || "").trim().toLowerCase() === "admin" ? "Administrador" : "Usuario estandar"}
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Select
                      value={(selectedUser.rol || "").trim().toLowerCase() === "admin" ? "admin" : "usuario"}
                      onValueChange={(v) =>
                        handleChangeRol(selectedUser, v as "admin" | "usuario")
                      }
                      disabled={selectedUser.id === user?.usuario_id}
                    >
                      <SelectTrigger className="h-8 w-[130px] text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="usuario">Usuario</SelectItem>
                        <SelectItem value="admin">Admin</SelectItem>
                      </SelectContent>
                    </Select>
                    {puntos.length > 0 && (
                      <Select
                        value={selectedUser.punto_facturacion_id != null ? String(selectedUser.punto_facturacion_id) : "__none__"}
                        onValueChange={(v) => handleChangePunto(selectedUser, v === "__none__" ? null : Number(v))}
                      >
                        <SelectTrigger className="h-8 w-[190px] text-xs" aria-label="Punto de facturación">
                          <SelectValue placeholder="Punto de facturación" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">Sin punto de facturación</SelectItem>
                          {puntos.map((p) => (
                            <SelectItem key={p.id} value={String(p.id)}>
                              {etiquetaPunto(p)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={openResetDialog}
                    >
                      <KeyRound className="h-4 w-4 mr-1" /> Resetear contrasena
                    </Button>
                    <Button
                      variant={selectedUser.activo ? "outline" : "default"}
                      size="sm"
                      onClick={() => handleToggleActivo(selectedUser, !selectedUser.activo)}
                      disabled={selectedUser.id === user?.usuario_id}
                    >
                      {selectedUser.activo ? (
                        <>
                          <UserX className="h-4 w-4 mr-1" /> Desactivar
                        </>
                      ) : (
                        <>
                          <UserCheck className="h-4 w-4 mr-1" /> Activar
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              </CardHeader>

              <CardContent className="pt-6">
                <div className="mb-4">
                  <h3 className="text-sm font-semibold text-foreground">Permisos de acceso</h3>
                  <p className="text-xs text-muted-foreground mt-1">
                    {(selectedUser.rol || "").trim().toLowerCase() === "admin"
                      ? "Los administradores tienen acceso a todos los modulos por defecto."
                      : "Activa los modulos a los que este usuario puede acceder."}
                  </p>
                </div>

                {loadingPermisos ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                ) : modulos.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">
                    No hay modulos configurados.
                  </p>
                ) : (
                  (() => {
                    // ─── Estrategia ─────────────────────────────────────────
                    // El grid se construye desde MODULOS (constants), que es
                    // la fuente unica de verdad. Cada modulo canonico se
                    // matchea contra su fila en la tabla `modulos` de la BD
                    // usando el matcher tolerante (sin tildes, sin "de/la").
                    // Asi, agregar un modulo nuevo en `lib/constants/modulos`
                    // lo hace aparecer automaticamente en su categoria, con
                    // el orden y label correctos, siempre que exista la fila
                    // correspondiente en BD para tener un `id` numerico.
                    //
                    // Modulos en la BD que NO matcheen ningun canonico se
                    // muestran al final dentro del grupo "Otros".

                    // 1) Indice DB por nombre canonico ("Caja Chica" ->
                    //    fila DB id=29). Si dos filas resuelven al mismo
                    //    canonico, gana la primera (segun orden de la BD).
                    const dbByCanon = new Map<string, Modulo>()
                    const dbHuerfanos: Modulo[] = []
                    for (const m of modulos) {
                      const canonical = findModuloByDBName(m.nombre)
                      if (canonical) {
                        if (!dbByCanon.has(canonical.nombre)) {
                          dbByCanon.set(canonical.nombre, m)
                        }
                      } else {
                        dbHuerfanos.push(m)
                      }
                    }

                    // 2) Agrupar los MODULOS canonicos por categoria.
                    const gruposCanon: Record<Categoria, ModuloGranular[]> = {
                      Dashboard: [],
                      Ventas: [],
                      Compras: [],
                      Inventario: [],
                      Produccion: [],
                      Finanzas: [],
                      CRM: [],
                      Configuracion: [],
                    }
                    for (const m of MODULOS) {
                      gruposCanon[m.categoria].push(m)
                    }

                    return (
                      <div className="space-y-5">
                        {CATEGORIAS_ORDEN.map((categoria) => {
                          const items = gruposCanon[categoria]
                          if (!items || items.length === 0) return null
                          return (
                            <div key={categoria}>
                              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 px-1">
                                {categoria}
                              </h4>
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 rounded-xl border border-border bg-background p-2">
                                {items.map((canon) => {
                                  const dbRow = dbByCanon.get(canon.nombre)
                                  // Sin fila en BD: no podemos guardar un
                                  // permiso (modulo_id es FK numerica). Lo
                                  // mostramos deshabilitado con un hint para
                                  // que el admin sepa que falta sembrar la
                                  // fila correspondiente en `modulos`.
                                  if (!dbRow) {
                                    return (
                                      <div
                                        key={canon.nombre}
                                        className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg bg-stone-50/60 border border-dashed border-stone-200"
                                        title="Falta crear la fila en la tabla `modulos` de la BD"
                                      >
                                        <div className="flex-1 min-w-0 flex items-center gap-2">
                                          <span className="text-sm text-muted-foreground truncate">
                                            {canon.nombre}
                                          </span>
                                          <span className="text-[10px] uppercase tracking-wider rounded bg-stone-200 text-stone-600 px-1.5 py-0.5">
                                            sin id
                                          </span>
                                        </div>
                                        <Switch checked={false} disabled />
                                      </div>
                                    )
                                  }
                                  const puedeVer = permisosMap[dbRow.id] ?? false
                                  const isPending = pendingModuloId === dbRow.id
                                  return (
                                    <div
                                      key={dbRow.id}
                                      className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg hover:bg-stone-50 transition-colors"
                                    >
                                      <div className="flex-1 min-w-0 flex items-center gap-2">
                                        <span className="text-sm font-medium text-foreground truncate">
                                          {canon.nombre}
                                        </span>
                                        {isPending && (
                                          <Loader2 className="h-3 w-3 animate-spin text-muted-foreground shrink-0" />
                                        )}
                                      </div>
                                      <Switch
                                        checked={puedeVer}
                                        onCheckedChange={(v) =>
                                          handleTogglePermiso(dbRow.id, v)
                                        }
                                        disabled={isPending}
                                        aria-label={`Permitir acceso a ${canon.nombre}`}
                                      />
                                    </div>
                                  )
                                })}
                              </div>
                            </div>
                          )
                        })}

                        {/* Modulos huerfanos: existen en BD pero no en el
                            constants. Los mostramos para no perder el
                            control sobre ellos. */}
                        {dbHuerfanos.length > 0 && (
                          <div>
                            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 px-1">
                              Otros
                            </h4>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 rounded-xl border border-border bg-background p-2">
                              {dbHuerfanos.map((m) => {
                                const puedeVer = permisosMap[m.id] ?? false
                                const isPending = pendingModuloId === m.id
                                return (
                                  <div
                                    key={m.id}
                                    className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg hover:bg-stone-50 transition-colors"
                                  >
                                    <div className="flex-1 min-w-0 flex items-center gap-2">
                                      <span className="text-sm font-medium text-foreground truncate">
                                        {m.nombre}
                                      </span>
                                      {isPending && (
                                        <Loader2 className="h-3 w-3 animate-spin text-muted-foreground shrink-0" />
                                      )}
                                    </div>
                                    <Switch
                                      checked={puedeVer}
                                      onCheckedChange={(v) =>
                                        handleTogglePermiso(m.id, v)
                                      }
                                      disabled={isPending}
                                      aria-label={`Permitir acceso a ${m.nombre}`}
                                    />
                                  </div>
                                )
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })()
                )}
              </CardContent>
            </>
          )}
        </Card>
      </div>

      {/* Crear usuario - Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserPlus className="h-5 w-5 text-primary" />
              Nuevo Usuario
            </DialogTitle>
            <DialogDescription>
              El usuario sera creado en tu razon social y recibira acceso inmediato con la
              contrasena que definas.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label htmlFor="nombre">
                Nombre <span className="text-destructive">*</span>
              </Label>
              <Input
                id="nombre"
                value={form.nombre}
                onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value }))}
                placeholder="Ej. Maria Lopez"
                autoComplete="off"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="email">
                Correo <span className="text-destructive">*</span>
              </Label>
              <div className="relative">
                <Mail className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  id="email"
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                  placeholder="maria@empresa.com"
                  autoComplete="off"
                  className="pl-9"
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="password">
                Contrasena <span className="text-destructive">*</span>
              </Label>
              <Input
                id="password"
                type="password"
                value={form.password}
                onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                placeholder="Minimo 6 caracteres"
                autoComplete="new-password"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="rol">Rol</Label>
              <Select
                value={form.rol}
                onValueChange={(v) => setForm((f) => ({ ...f, rol: v as "admin" | "usuario" }))}
              >
                <SelectTrigger id="rol">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="usuario">
                    <div className="flex flex-col">
                      <span className="font-medium">Usuario</span>
                      <span className="text-xs text-muted-foreground">
                        Acceso segun permisos por modulo
                      </span>
                    </div>
                  </SelectItem>
                  <SelectItem value="admin">
                    <div className="flex flex-col">
                      <span className="font-medium">Admin</span>
                      <span className="text-xs text-muted-foreground">
                        Acceso total a todos los modulos
                      </span>
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={creating}>
              Cancelar
            </Button>
            <Button onClick={handleCreate} disabled={creating}>
              {creating && <Spinner className="mr-2 h-4 w-4" />}
              Crear usuario
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialogo: resetear contrasena */}
      <Dialog open={resetOpen} onOpenChange={setResetOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="h-5 w-5 text-primary" />
              Resetear contrasena
            </DialogTitle>
            <DialogDescription>
              {selectedUser
                ? `Define una nueva contrasena para ${selectedUser.nombre}. Se actualizara inmediatamente en Supabase Auth y el usuario podra iniciar sesion con la nueva contrasena.`
                : "Define una nueva contrasena para el usuario."}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label htmlFor="reset-password">Nueva contrasena</Label>
              <div className="relative">
                <Input
                  id="reset-password"
                  type={showResetPassword ? "text" : "password"}
                  value={resetPassword}
                  onChange={(e) => setResetPassword(e.target.value)}
                  placeholder="Minimo 6 caracteres"
                  autoComplete="new-password"
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowResetPassword((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  aria-label={showResetPassword ? "Ocultar" : "Mostrar"}
                >
                  {showResetPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="reset-confirm">Confirmar contrasena</Label>
              <Input
                id="reset-confirm"
                type={showResetPassword ? "text" : "password"}
                value={resetConfirm}
                onChange={(e) => setResetConfirm(e.target.value)}
                placeholder="Repite la nueva contrasena"
                autoComplete="new-password"
              />
            </div>

            <p className="text-xs text-muted-foreground">
              El cambio es inmediato. Las sesiones activas del usuario seguiran validas hasta
              que expire su token, pero debera usar la nueva contrasena al volver a iniciar
              sesion.
            </p>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setResetOpen(false)}
              disabled={resetting}
            >
              Cancelar
            </Button>
            <Button onClick={handleResetPassword} disabled={resetting}>
              {resetting && <Spinner className="mr-2 h-4 w-4" />}
              Actualizar contrasena
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
