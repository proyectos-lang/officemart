import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js"
import { DB_SCHEMA } from "./schema"

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

/**
 * Cliente Supabase con SERVICE ROLE KEY.
 * SOLO debe usarse en Server Actions / Route Handlers.
 * NUNCA importar este archivo desde un Client Component.
 *
 * Se crea por-llamada (no singleton) para evitar compartir estado entre
 * requests concurrentes en el mismo proceso serverless.
 */
export function createAdminClient(): SupabaseClient | null {
  if (!supabaseUrl || !serviceRoleKey) {
    console.warn(
      "[Supabase Admin] Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY. " +
        "Agregalas como variables de entorno para habilitar la creacion de usuarios."
    )
    return null
  }

  return createSupabaseClient(supabaseUrl, serviceRoleKey, {
    db: { schema: DB_SCHEMA },
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    // La BD no esta tipada: el cast solo alinea el generico de esquema con el
    // `SupabaseClient` (public) que usan los servicios.
  }) as unknown as SupabaseClient
}

export function isAdminClientConfigured(): boolean {
  return Boolean(supabaseUrl && serviceRoleKey)
}
