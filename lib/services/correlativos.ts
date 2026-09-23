import type { SupabaseClient } from "@supabase/supabase-js"

/**
 * Correlativos atómicos por empresa y serie (RPC `siguiente_correlativo`,
 * scripts/officemart-001-base-comun.sql). Sustituyen a los `COUNT(*)+1`,
 * que repiten número cuando dos usuarios guardan a la vez.
 *
 * Cada llamador conserva su método viejo como respaldo: si el RPC no existe
 * (script pendiente) `emitirCorrelativo` devuelve `numero: null` y el
 * llamador decide (normalmente, calcular el número como antes).
 */

export const CORRELATIVOS_FEATURE_PENDING =
  "Correlativos atómicos pendientes: aplica scripts/officemart-001-base-comun.sql en Supabase."

/** Series conocidas (la serie es texto libre; estas son las que usa la app). */
export const SERIES = {
  DEVOLUCION: "DEV",
  PEDIDO: "PED",
  RECIBO: "RC",
  COTIZACION: "COT",
  ORDEN_TRABAJO: "OT",
} as const

function isMissingFunction(err: { message?: string; code?: string } | null): boolean {
  if (!err) return false
  const msg = (err.message || "").toLowerCase()
  return (
    err.code === "42883" ||
    err.code === "PGRST202" ||
    msg.includes("could not find the function") ||
    /function .*siguiente_correlativo.* does not exist/.test(msg) ||
    /function .*peek_correlativo.* does not exist/.test(msg)
  )
}

/** Formato local (mismo que el RPC): prefijo + número con ceros a la izquierda. */
export function formatearCorrelativo(prefijo: string, numero: number, pad = 4): string {
  const n = Math.max(0, Math.floor(Number(numero) || 0))
  return `${prefijo || ""}${String(n).padStart(Math.max(1, pad), "0")}`
}

/**
 * Consume y devuelve el siguiente número de la serie del tenant de la sesión.
 * `razonSocialId` solo lo usan rutas server-side con service role (no hay
 * sesión); un usuario normal no puede emitir para otra empresa (RLS).
 */
export async function emitirCorrelativo(
  supabase: SupabaseClient,
  serie: string,
  prefijo: string,
  pad = 4,
  opts: { razonSocialId?: number | null } = {}
): Promise<{ numero: string | null; error: string | null }> {
  try {
    const { data, error } = await supabase.rpc("siguiente_correlativo", {
      p_serie: serie,
      p_prefijo: prefijo,
      p_pad: pad,
      p_razon_social_id: opts.razonSocialId ?? null,
    })
    if (error) {
      if (isMissingFunction(error)) return { numero: null, error: CORRELATIVOS_FEATURE_PENDING }
      return { numero: null, error: error.message }
    }
    return { numero: typeof data === "string" && data ? data : null, error: null }
  } catch (err) {
    console.error("[correlativos] emitir:", err)
    return { numero: null, error: "Error de conexion" }
  }
}

/** Solo lectura: el número que saldría a continuación (vista previa). */
export async function peekCorrelativo(
  supabase: SupabaseClient,
  serie: string,
  prefijo: string,
  pad = 4,
  opts: { razonSocialId?: number | null } = {}
): Promise<{ numero: string | null; error: string | null }> {
  try {
    const { data, error } = await supabase.rpc("peek_correlativo", {
      p_serie: serie,
      p_prefijo: prefijo,
      p_pad: pad,
      p_razon_social_id: opts.razonSocialId ?? null,
    })
    if (error) {
      if (isMissingFunction(error)) return { numero: null, error: CORRELATIVOS_FEATURE_PENDING }
      return { numero: null, error: error.message }
    }
    return { numero: typeof data === "string" && data ? data : null, error: null }
  } catch (err) {
    console.error("[correlativos] peek:", err)
    return { numero: null, error: "Error de conexion" }
  }
}
