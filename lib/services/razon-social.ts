import { createClient, isSupabaseConfigured } from '@/lib/supabase/client'
import { STORAGE_PREFIX } from '@/lib/supabase/schema'

export interface RazonSocial {
  id?: number
  nombre_empresa: string
  nombre_comercial: string
  documento: string
  direccion: string
  telefono: string
  correo: string
  logo_url?: string | null
  created_at?: string
}

export type ConnectionStatus = 'connected' | 'disconnected' | 'not_configured'

const SESION_INVALIDA_ERROR = 'Sesion invalida, no se pudo registrar la empresa o usuario'

// ============================================
// Configuracion de logos
// ============================================
export const LOGO_BUCKET = 'logos'
export const ALLOWED_LOGO_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'] as const
export const ALLOWED_LOGO_EXTS = ['png', 'jpg', 'jpeg', 'webp'] as const
export const MAX_LOGO_SIZE_MB = 2
export const MAX_LOGO_SIZE_BYTES = MAX_LOGO_SIZE_MB * 1024 * 1024

/**
 * Devuelve el razon_social_id del usuario autenticado (o null si no lo tiene).
 * Se usa para aislar la lectura/escritura de `razon_social` por tenant.
 */
async function getUserRazonSocialId(supabase: ReturnType<typeof createClient>): Promise<number | null> {
  if (!supabase) return null
  try {
    const { data: { user: authUser } } = await supabase.auth.getUser()
    if (!authUser) return null
    const { data, error } = await supabase
      .from('usuarios')
      .select('razon_social_id')
      .eq('id', authUser.id)
      .single()
    if (error || !data) return null
    return data.razon_social_id ?? null
  } catch {
    return null
  }
}

/**
 * Checks the connection status with Supabase
 */
export async function checkConnection(): Promise<ConnectionStatus> {
  if (!isSupabaseConfigured()) {
    return 'not_configured'
  }

  const supabase = createClient()
  if (!supabase) {
    return 'not_configured'
  }

  try {
    const { error } = await supabase.from('razon_social').select('id').limit(1)
    if (error) {
      console.warn('[Supabase] Error de conexion:', error.message)
      return 'disconnected'
    }
    return 'connected'
  } catch (err) {
    console.error('[Supabase] Error verificando conexion:', err)
    return 'disconnected'
  }
}

/**
 * Trae la razon_social del tenant del usuario autenticado.
 * Si el usuario aun no tiene razon_social_id asociado, devuelve data=null
 * (el front lo interpreta como "registro nuevo" y permite crear).
 */
export async function getRazonSocial(): Promise<{ data: RazonSocial | null; error: string | null }> {
  const supabase = createClient()
  if (!supabase) {
    return { data: null, error: 'Cliente de Supabase no disponible' }
  }

  try {
    const razonSocialId = await getUserRazonSocialId(supabase)
    if (razonSocialId == null) {
      // Usuario sin razon_social_id: no hay nada que leer aun, pero tampoco es error.
      return { data: null, error: null }
    }

    const { data, error } = await supabase
      .from('razon_social')
      .select('*')
      .eq('id', razonSocialId)
      .single()

    if (error && error.code !== 'PGRST116') {
      return { data: null, error: error.message }
    }

    return { data: data ?? null, error: null }
  } catch (err) {
    console.error('[Supabase] Error obteniendo razon social:', err)
    return { data: null, error: 'Error de conexion' }
  }
}

/**
 * Guarda o actualiza la razon_social del tenant del usuario autenticado.
 * - isNew=true: crea un nuevo registro y enlaza `usuarios.razon_social_id` al nuevo id.
 * - isNew=false: actualiza SOLO la razon_social del tenant actual (bloqueo de aislamiento).
 */
export async function saveRazonSocial(
  data: RazonSocial,
  isNew: boolean
): Promise<{ success: boolean; error: string | null }> {
  const supabase = createClient()
  if (!supabase) {
    return { success: false, error: 'Cliente de Supabase no disponible' }
  }

  // No permitimos que `logo_url` llegue por este camino (se gestiona en uploadLogo/removeLogo)
  const { id, created_at, logo_url, ...insertData } = data

  try {
    // Identidad del usuario autenticado (necesaria tanto para crear como para updatear)
    const { data: { user: authUser } } = await supabase.auth.getUser()
    if (!authUser) {
      console.log('[saveRazonSocial] Sin sesion')
      return { success: false, error: SESION_INVALIDA_ERROR }
    }

    if (isNew) {
      // 1) Insertar el nuevo tenant
      const { data: inserted, error } = await supabase
        .from('razon_social')
        .insert(insertData)
        .select('id')
        .single()

      if (error || !inserted) {
        console.log('[saveRazonSocial] error insertando razon_social:', error)
        return { success: false, error: error?.message || 'No se pudo crear la razon social.' }
      }

      // 2) Enlazar el usuario actual a la nueva razon_social
      const { error: linkErr } = await supabase
        .from('usuarios')
        .update({ razon_social_id: inserted.id })
        .eq('id', authUser.id)

      if (linkErr) {
        console.log('[saveRazonSocial] error enlazando usuario a razon_social:', linkErr)
        return {
          success: false,
          error: 'Se creo la razon social pero no se pudo enlazar al usuario. Contacta al administrador.',
        }
      }

      return { success: true, error: null }
    } else {
      // Update: solo permitido sobre la razon_social del propio tenant
      const razonSocialId = await getUserRazonSocialId(supabase)
      if (razonSocialId == null) {
        console.log('[saveRazonSocial] usuario sin razon_social_id al intentar update')
        return { success: false, error: SESION_INVALIDA_ERROR }
      }

      const { error } = await supabase
        .from('razon_social')
        .update(insertData)
        .eq('id', razonSocialId)

      if (error) {
        return { success: false, error: error.message }
      }
      return { success: true, error: null }
    }
  } catch (err) {
    console.error('[Supabase] Error guardando razon social:', err)
    return { success: false, error: 'Error de conexion' }
  }
}

/**
 * Valida un archivo de logo antes de subirlo.
 */
export function validateLogoFile(file: File): { ok: boolean; error: string | null } {
  if (!file) return { ok: false, error: 'No se recibio ningun archivo' }

  if (!ALLOWED_LOGO_TYPES.includes(file.type as any)) {
    return {
      ok: false,
      error: `Formato no permitido. Usa PNG, JPG o WEBP.`,
    }
  }

  if (file.size > MAX_LOGO_SIZE_BYTES) {
    const mb = (file.size / (1024 * 1024)).toFixed(2)
    return {
      ok: false,
      error: `El archivo pesa ${mb}MB. El maximo permitido es ${MAX_LOGO_SIZE_MB}MB.`,
    }
  }

  return { ok: true, error: null }
}

/**
 * Sube el logo del tenant al bucket `logos`, guarda la URL publica en
 * `razon_social.logo_url` (con cache-buster) y devuelve la URL final.
 */
export async function uploadLogo(
  file: File
): Promise<{ url: string | null; error: string | null }> {
  const supabase = createClient()
  if (!supabase) {
    return { url: null, error: 'Cliente de Supabase no disponible' }
  }

  // Validacion en servicio (defensa en profundidad)
  const validation = validateLogoFile(file)
  if (!validation.ok) {
    return { url: null, error: validation.error }
  }

  try {
    const razonSocialId = await getUserRazonSocialId(supabase)
    if (razonSocialId == null) {
      return {
        url: null,
        error: 'Debes crear la razon social antes de subir un logo.',
      }
    }

    // Extension: preferimos la del nombre; si no, la derivamos del MIME
    const nameExt = file.name.split('.').pop()?.toLowerCase() || ''
    const mimeExt = file.type === 'image/png' ? 'png'
      : file.type === 'image/webp' ? 'webp'
      : 'jpg'
    const ext = ALLOWED_LOGO_EXTS.includes(nameExt as any) ? nameExt : mimeExt

    // Nombre estable por tenant (permite upsert). El cache-buster va en la URL final.
    const filePath = `${STORAGE_PREFIX}logo_${razonSocialId}.${ext}`

    const { error: uploadError } = await supabase.storage
      .from(LOGO_BUCKET)
      .upload(filePath, file, {
        upsert: true,
        contentType: file.type,
        cacheControl: '3600',
      })

    if (uploadError) {
      console.log('[uploadLogo] upload error:', uploadError)
      const msg = uploadError.message || ''
      if (msg.toLowerCase().includes('bucket') && msg.toLowerCase().includes('not found')) {
        return {
          url: null,
          error: `El bucket "${LOGO_BUCKET}" no existe en Supabase Storage. Crealo como publico y reintenta.`,
        }
      }
      return { url: null, error: msg || 'No se pudo subir el archivo.' }
    }

    // URL publica + cache-buster para invalidar la cache del navegador
    const { data: pub } = supabase.storage.from(LOGO_BUCKET).getPublicUrl(filePath)
    if (!pub?.publicUrl) {
      return { url: null, error: 'No se pudo generar la URL publica del logo.' }
    }
    const urlConBuster = `${pub.publicUrl}?t=${Date.now()}`

    // Persistir logo_url via Server Action.
    // Se usa el service role para bypass de RLS (las policies de UPDATE sobre
    // razon_social bloqueaban silenciosamente la escritura desde el cliente).
    const { persistLogoUrlAction } = await import(
      '@/app/(dashboard)/configuracion/razon-social/actions'
    )
    const { ok, error: updateErrMsg } = await persistLogoUrlAction(urlConBuster)

    if (!ok) {
      console.log('[uploadLogo] persist error:', updateErrMsg)
      return { url: null, error: updateErrMsg || 'No se pudo guardar la URL del logo.' }
    }

    return { url: urlConBuster, error: null }
  } catch (err: any) {
    console.log('[uploadLogo] excepcion:', err)
    return { url: null, error: err?.message || 'Error de conexion' }
  }
}

/**
 * Elimina el logo actual: delega al Server Action que borra el objeto del
 * bucket (todas las extensiones soportadas) y limpia `logo_url` en la BD
 * con service role, evitando bloqueos silenciosos por RLS.
 */
export async function removeLogo(): Promise<{ success: boolean; error: string | null }> {
  try {
    const { removeLogoAction } = await import(
      '@/app/(dashboard)/configuracion/razon-social/actions'
    )
    const { ok, error } = await removeLogoAction()
    if (!ok) {
      return { success: false, error: error || 'No se pudo eliminar el logo.' }
    }
    return { success: true, error: null }
  } catch (err: any) {
    console.log('[removeLogo] excepcion:', err)
    return { success: false, error: err?.message || 'Error de conexion' }
  }
}
