import type { SupabaseClient } from "@supabase/supabase-js"

/**
 * Candado de inventario por toma física (script officemart-013). Módulo sin
 * dependencias de otros servicios para que ventas, compras, inventario y
 * producción lo importen sin ciclos. Si el RPC no existe (script pendiente)
 * nunca bloquea.
 */

export const INVENTARIO_CONGELADO_MSG =
  "Inventario congelado: este almacén tiene una toma física abierta. Ciérrala o cancélala en Inventario → Toma Física para volver a mover stock."

/** true si el mensaje de error viene del candado (RPC/trigger). */
export function esErrorInventarioCongelado(msg: string | null | undefined): boolean {
  return /INVENTARIO_CONGELADO/i.test(msg || "")
}

/** Traduce el error crudo del trigger a un mensaje para el usuario. */
export function traducirErrorInventario<T extends string | null | undefined>(msg: T): T | string {
  return esErrorInventarioCongelado(msg) ? INVENTARIO_CONGELADO_MSG : msg
}

/** null si se puede mover stock en ese almacén; mensaje si está congelado. */
export async function assertInventarioNoCongelado(
  supabase: SupabaseClient,
  almacenId: number | null | undefined
): Promise<string | null> {
  if (almacenId == null || Number.isNaN(Number(almacenId))) return null
  try {
    const { data, error } = await supabase.rpc("inventario_congelado", { p_almacen_id: Number(almacenId) })
    if (error) return null // RPC ausente (script pendiente): no se bloquea
    return data === true ? INVENTARIO_CONGELADO_MSG : null
  } catch {
    return null
  }
}

/** Versión para varios almacenes (traslados): el primero congelado bloquea. */
export async function assertAlmacenesNoCongelados(
  supabase: SupabaseClient,
  almacenIds: (number | null | undefined)[]
): Promise<string | null> {
  for (const id of [...new Set(almacenIds.filter((x): x is number => x != null))]) {
    const msg = await assertInventarioNoCongelado(supabase, id)
    if (msg) return msg
  }
  return null
}
