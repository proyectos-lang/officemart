"use client"

import * as React from "react"
import { createClient } from "@/lib/supabase/client"
import { findModuloByDBName, moduloHabilitadoParaEmpresa } from "@/lib/constants/modulos"
import { esPlataformaAdmin } from "@/app/plataforma/actions"
import { DEFAULT_FLAGS, mergeFlags, type FeatureFlags } from "@/lib/constants/feature-flags"

export interface AuthUser {
  usuario_id: string
  auth_user_id: string
  razon_social_id: number | null
  nombre: string
  email: string
  rol: string | null
  logo_url: string | null
  razon_social_nombre: string | null
  modulos_permitidos: string[]
  /** Modulos BASE deshabilitados por el super-admin para toda la empresa. */
  modulos_deshabilitados: string[]
  /** Modulos NUEVOS habilitados por el super-admin (opt-in; nombres canonicos). */
  modulos_habilitados: string[]
  /** Feature flags / mini-personalizaciones de la empresa (con defaults). */
  flags: FeatureFlags
  /** Punto de facturación asignado al usuario (script officemart-004); null = ninguno. */
  punto_facturacion_id: number | null
}

interface AuthContextValue {
  user: AuthUser | null
  loading: boolean
  login: (email: string, password: string) => Promise<{ error: string | null; plataforma?: boolean }>
  logout: () => Promise<void>
  hasModulo: (nombre: string) => boolean
  refreshProfile: () => Promise<void>
}

const AuthContext = React.createContext<AuthContextValue | undefined>(undefined)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = React.useState<AuthUser | null>(null)
  const [loading, setLoading] = React.useState(true)

  // Carga el perfil completo desde 'usuarios' (con JOIN a razon_social) + permisos
  const loadProfile = React.useCallback(
    async (authUserId: string, email: string): Promise<AuthUser | null> => {
      const supabase = createClient()
      if (!supabase) return null

      try {
        // 1) Perfil + razon social (JOIN). El id de usuarios coincide con auth.users.id (UUID).
        //    `punto_facturacion_id` es del script officemart-004: si la columna no
        //    existe todavía, se reintenta sin ella.
        let perfilRes = await supabase
          .from("usuarios")
          .select("id, razon_social_id, nombre, rol, activo, punto_facturacion_id, razon_social(nombre_empresa, logo_url)")
          .eq("id", authUserId)
          .single()
        if (perfilRes.error && /punto_facturacion_id/i.test(perfilRes.error.message || "")) {
          perfilRes = await supabase
            .from("usuarios")
            .select("id, razon_social_id, nombre, rol, activo, razon_social(nombre_empresa, logo_url)")
            .eq("id", authUserId)
            .single()
        }
        const { data: perfil, error } = perfilRes as {
          data: (Record<string, any> & { punto_facturacion_id?: number | null }) | null
          error: { message?: string } | null
        }

        if (error) {
          console.log("Error cargando perfil desde 'usuarios':", error)
          return null
        }

        if (!perfil) {
          console.log("No se encontro perfil en 'usuarios' para auth_user_id:", authUserId)
          return null
        }

        if (perfil.activo === false) {
          console.log("Usuario inactivo:", email)
          return null
        }

        const razonSocial: any = Array.isArray(perfil.razon_social)
          ? perfil.razon_social[0]
          : perfil.razon_social

        if (!razonSocial) {
          console.log(
            "Advertencia: perfil existe pero razon_social es null. Revisa que razon_social_id apunte a un registro valido en la tabla razon_social. perfil.razon_social_id =",
            perfil.razon_social_id
          )
        }

        const nombreEmpresa: string | null = razonSocial?.nombre_empresa ?? null

        // 2) Permisos por modulo. Se cargan SIEMPRE en dos pasos (ids ->
        // catalogo de modulos) en vez de un JOIN embebido: el embed de PostgREST
        // puede devolver null o error segun como este declarada la relacion FK,
        // y no queremos que un problema de consulta deje al usuario sin permisos.
        // Canonizamos cada nombre al exacto del constants (tolera tildes/plurales)
        // para que sidebar y RouteGuard hagan `hasModulo("Valoracion")` aun si la
        // DB guarda "Valoración". Un permiso desconocido se conserva tal cual.
        const canonizar = (nombres: (string | null | undefined)[]): string[] =>
          nombres.filter((n): n is string => !!n).map((db) => findModuloByDBName(db)?.nombre ?? db)

        let modulosPermitidos: string[] = []
        const { data: permRows, error: permisosError } = await supabase
          .from("permisos_usuarios")
          .select("modulo_id")
          .eq("usuario_id", perfil.id)
          .eq("puede_ver", true)
        if (permisosError) console.log("Error cargando permisos:", permisosError)

        const moduloIds = (permRows || []).map((r: any) => r.modulo_id).filter((x: any) => x != null)
        if (moduloIds.length > 0) {
          const { data: mods, error: modsError } = await supabase
            .from("modulos")
            .select("id, nombre")
            .in("id", moduloIds)
          if (modsError) console.log("Error cargando catalogo de modulos:", modsError)
          modulosPermitidos = canonizar((mods || []).map((m: any) => m?.nombre))
        }

        // 3) Config de la empresa: feature flags + modulos deshabilitados por el
        //    super-admin. Si la tabla aun no existe (script 038 sin aplicar), se
        //    usan los defaults (todos los modulos habilitados).
        let flags: FeatureFlags = DEFAULT_FLAGS
        let modulosDeshabilitados: string[] = []
        let modulosHabilitados: string[] = []
        if (perfil.razon_social_id != null) {
          const { data: cfg, error: cfgErr } = await supabase
            .from("razon_social_config")
            .select("config")
            .eq("razon_social_id", perfil.razon_social_id)
            .maybeSingle()
          if (!cfgErr) {
            const cfgObj = (cfg?.config as Record<string, unknown> | null) ?? {}
            flags = mergeFlags(cfgObj)
            const soloStrings = (v: unknown) =>
              Array.isArray(v) ? (v as unknown[]).filter((x): x is string => typeof x === "string") : []
            modulosDeshabilitados = soloStrings(cfgObj.modulos_deshabilitados)
            modulosHabilitados = soloStrings(cfgObj.modulos_habilitados)
          }
        }

        return {
          usuario_id: perfil.id,
          auth_user_id: authUserId,
          razon_social_id: perfil.razon_social_id ?? null,
          nombre: perfil.nombre,
          email,
          rol: perfil.rol ?? null,
          logo_url: razonSocial?.logo_url ?? null,
          razon_social_nombre: nombreEmpresa,
          modulos_permitidos: modulosPermitidos,
          modulos_deshabilitados: modulosDeshabilitados,
          modulos_habilitados: modulosHabilitados,
          flags,
          punto_facturacion_id: perfil.punto_facturacion_id ?? null,
        }
      } catch (err) {
        console.log("Excepcion cargando perfil:", err)
        return null
      }
    },
    []
  )

  const refreshProfile = React.useCallback(async () => {
    const supabase = createClient()
    if (!supabase) return
    const { data: { user: authUser } } = await supabase.auth.getUser()
    if (!authUser) {
      setUser(null)
      return
    }
    const profile = await loadProfile(authUser.id, authUser.email || "")
    setUser(profile)
  }, [loadProfile])

  // Init: recuperar sesion al montar + listener de cambios
  React.useEffect(() => {
    const supabase = createClient()
    if (!supabase) {
      setLoading(false)
      return
    }

    let mounted = true

    // Safety timeout: pase lo que pase, no dejamos "Cargando sesion..."
    // colgado mas de 8 segundos. Si algo falla en el medio, caemos a "no
    // autenticado" y el layout redirige a /login.
    const safetyTimer = setTimeout(() => {
      if (mounted) {
        console.log("Safety timeout alcanzado; forzando loading=false")
        setLoading(false)
      }
    }, 8000)

    ;(async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (!mounted) return

        if (session?.user) {
          const profile = await loadProfile(session.user.id, session.user.email || "")
          if (mounted) setUser(profile)
        }
      } catch (err) {
        console.log("Error restaurando sesion:", err)
      } finally {
        if (mounted) setLoading(false)
      }
    })()

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (!mounted) return

        if (event === "SIGNED_OUT" || !session?.user) {
          setUser(null)
          setLoading(false)
          return
        }

        // IMPORTANTE: Supabase mantiene un lock interno mientras ejecuta el
        // callback de onAuthStateChange. Hacer queries async con `await` aqui
        // produce un DEADLOCK que cuelga signInWithPassword y el refresh de sesion.
        // La solucion recomendada es diferir las queries con setTimeout(fn, 0)
        // para que se ejecuten DESPUES de que el lock se libere.
        // Ref: https://github.com/supabase/supabase-js/issues/773
        if (
          event === "INITIAL_SESSION" ||
          event === "SIGNED_IN" ||
          event === "TOKEN_REFRESHED" ||
          event === "USER_UPDATED"
        ) {
          const authUserId = session.user.id
          const authEmail = session.user.email || ""
          setTimeout(async () => {
            if (!mounted) return
            try {
              const profile = await loadProfile(authUserId, authEmail)
              if (mounted) setUser(profile)
            } catch (err) {
              console.log("Error en onAuthStateChange loadProfile:", err)
            } finally {
              if (mounted) setLoading(false)
            }
          }, 0)
        }
      }
    )

    return () => {
      mounted = false
      clearTimeout(safetyTimer)
      subscription.unsubscribe()
    }
  }, [loadProfile])

  const login = React.useCallback(
    async (email: string, password: string): Promise<{ error: string | null; plataforma?: boolean }> => {
      const supabase = createClient()
      if (!supabase) {
        return { error: "Supabase no esta configurado. Contacta al administrador." }
      }

      // Helper: envolver una promesa con timeout para evitar que queden colgadas
      const withTimeout = <T,>(p: Promise<T>, ms: number, label: string): Promise<T> =>
        Promise.race([
          p,
          new Promise<T>((_, reject) =>
            setTimeout(() => reject(new Error(`Timeout: ${label} tardo mas de ${ms}ms`)), ms)
          ),
        ])

      try {
        const { data, error } = await withTimeout(
          supabase.auth.signInWithPassword({
            email: email.trim().toLowerCase(),
            password,
          }),
          15000,
          "signInWithPassword"
        )

        if (error) {
          console.log("Error signInWithPassword:", error)
          const msg = (error.message || "").toLowerCase()
          if (msg.includes("invalid login") || msg.includes("invalid_credentials")) {
            return { error: "Email o contrasena incorrectos" }
          }
          if (msg.includes("email not confirmed")) {
            return { error: "Tu email aun no ha sido confirmado" }
          }
          return { error: error.message || "No se pudo iniciar sesion" }
        }

        if (!data.user) {
          return { error: "No se pudo iniciar sesion" }
        }

        const profile = await withTimeout(
          loadProfile(data.user.id, data.user.email || ""),
          10000,
          "loadProfile"
        )
        if (!profile) {
          // Cuenta SOLO-PLATAFORMA (super-admin sin empresa): no tiene perfil en
          // `usuarios`, pero SI es valida. No cerramos sesion (el guard de
          // /plataforma la necesita viva) y senalizamos para enrutar al portal.
          const esPlat = await esPlataformaAdmin().catch(() => false)
          if (esPlat) {
            setUser(null)
            return { error: null, plataforma: true }
          }
          await supabase.auth.signOut()
          return { error: "Tu cuenta no tiene un perfil asociado o esta inactiva." }
        }

        setUser(profile)
        return { error: null }
      } catch (err: any) {
        console.log("Login exception:", err)
        const raw = String(err?.message || err || "").toLowerCase()

        // Error de red: no se pudo llegar al servidor de Supabase
        if (
          raw.includes("failed to fetch") ||
          raw.includes("networkerror") ||
          raw.includes("error when attempting to fetch resource") ||
          raw.includes("network request failed") ||
          raw.includes("load failed")
        ) {
          return {
            error:
              "No se pudo conectar con el servidor. Verifica tu conexion a internet o si tu proyecto de Supabase esta activo (puede haberse pausado por inactividad).",
          }
        }

        if (raw.includes("timeout")) {
          return {
            error:
              "El servidor tardo demasiado en responder. Revisa tu conexion o si tu proyecto de Supabase esta activo.",
          }
        }

        return { error: err?.message || "Error al iniciar sesion" }
      }
    },
    [loadProfile]
  )

  const logout = React.useCallback(async () => {
    const supabase = createClient()
    if (supabase) {
      try {
        await supabase.auth.signOut()
      } catch (err) {
        console.log("Error en signOut:", err)
      }
    }
    setUser(null)
  }, [])

  const hasModulo = React.useCallback(
    (nombre: string) => {
      if (!user) return false
      // Candado a nivel EMPRESA: modulos base ON salvo deshabilitados; modulos
      // nuevos OFF salvo que el super-admin los habilite. Si no esta habilitado
      // para la empresa, NADIE lo ve (ni siquiera el admin).
      if (!moduloHabilitadoParaEmpresa(nombre, user.modulos_deshabilitados, user.modulos_habilitados)) return false
      // Los administradores ven todos los modulos (habilitados para la empresa).
      if ((user.rol || "").trim().toLowerCase() === "admin") return true
      // Cualquier otro usuario ve SOLO los modulos con permiso explicito
      // (`permisos_usuarios.puede_ver = true`). Sin permisos => no ve nada
      // (deny by default). NUNCA se concede acceso total por lista vacia.
      return (user.modulos_permitidos || []).includes(nombre)
    },
    [user]
  )

  const value = React.useMemo(
    () => ({ user, loading, login, logout, hasModulo, refreshProfile }),
    [user, loading, login, logout, hasModulo, refreshProfile]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = React.useContext(AuthContext)
  if (!ctx) throw new Error("useAuth debe usarse dentro de AuthProvider")
  return ctx
}
