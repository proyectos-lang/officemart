import { createBrowserClient } from '@supabase/ssr'
import { processLock, type SupabaseClient } from '@supabase/supabase-js'
import { DB_SCHEMA } from './schema'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

export function isSupabaseConfigured(): boolean {
  return Boolean(supabaseUrl && supabaseAnonKey)
}

// Singleton: un solo cliente de Supabase por tab del navegador.
// Evita que multiples instancias compitan por el mismo storage/session
// y resuelve bugs de "Cargando sesion..." colgado al refrescar.
let browserClient: SupabaseClient | null = null

export function createClient(): SupabaseClient | null {
  if (!supabaseUrl || !supabaseAnonKey) {
    console.warn(
      '[Supabase] Variables de entorno no configuradas. ' +
      'Asegurate de definir NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_ANON_KEY'
    )
    return null
  }

  if (!browserClient) {
    browserClient = createBrowserClient(supabaseUrl, supabaseAnonKey, {
      db: { schema: DB_SCHEMA },
      auth: {
        // Safari / iOS: el Web Locks API (navigator.locks) que Supabase usa por
        // defecto para coordinar el refresh del token entre pestanas es
        // inestable y tira "lock was stolen by another request" al iniciar
        // sesion. processLock usa un lock EN MEMORIA (por tab); como el cliente
        // es singleton por tab, es suficiente y evita ese error.
        lock: processLock,
      },
      // La BD no esta tipada: el cast solo alinea el generico de esquema con el
      // `SupabaseClient` (public) que usan los servicios.
    }) as unknown as SupabaseClient
  }

  return browserClient
}
