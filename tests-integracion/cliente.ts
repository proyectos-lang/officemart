import { readFileSync } from "node:fs"
import { createClient, type SupabaseClient } from "@supabase/supabase-js"

/**
 * Cliente Supabase AUTENTICADO como un usuario real de la app (no service
 * role): las pruebas de integración pasan por RLS igual que el navegador.
 * Credenciales por variables de entorno VALIDACION_EMAIL / VALIDACION_PASSWORD.
 */

function cargarEnv(): Record<string, string> {
  const out: Record<string, string> = {}
  for (const linea of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(linea.trim())
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "")
  }
  return out
}

const env = cargarEnv()
for (const [k, v] of Object.entries(env)) if (process.env[k] == null) process.env[k] = v

let cliente: SupabaseClient | null = null

export function getCliente(): SupabaseClient {
  if (!cliente) {
    cliente = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
      db: { schema: "officemart" },
      auth: { persistSession: false, autoRefreshToken: false },
    }) as unknown as SupabaseClient
  }
  return cliente
}

export async function iniciarSesion(): Promise<string> {
  const email = process.env.VALIDACION_EMAIL || "admin@officemart.hn"
  const password = process.env.VALIDACION_PASSWORD || "admin123"
  const { data, error } = await getCliente().auth.signInWithPassword({ email, password })
  if (error || !data.user) throw new Error(`No se pudo iniciar sesión como ${email}: ${error?.message}`)
  return data.user.id
}
