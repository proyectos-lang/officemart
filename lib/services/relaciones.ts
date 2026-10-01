import type { SupabaseClient } from "@supabase/supabase-js"

/**
 * Une filas con una tabla relacionada SIN depender de que exista la llave
 * foránea en la base. Las tablas y columnas creadas por los scripts de
 * Officemart (ventas_reclamos.venta_id, pagos_ventas.recibo_id, …) no siempre
 * la declaran, y entonces PostgREST rechaza el embed `alias:columna (…)` con
 * "Could not find a relationship … in the schema cache".
 *
 * Trae las filas relacionadas con una sola consulta `in (ids)` y deja en cada
 * fila `fila[como] = { …columnas } | null`, la MISMA forma que devolvería el
 * embed, para que el mapeo existente no cambie.
 */
export async function adjuntarRelacion<T extends Record<string, unknown>>(
  supabase: SupabaseClient,
  filas: T[],
  opts: { campo: string; tabla: string; columnas: string; como: string }
): Promise<T[]> {
  const ids = [...new Set(filas.map((f) => f[opts.campo]).filter((v) => v != null).map((v) => Number(v)))]
  const mapa = new Map<number, Record<string, unknown>>()
  if (ids.length > 0) {
    // Lotes de 200 ids para no exceder el largo de la URL.
    for (let i = 0; i < ids.length; i += 200) {
      const lote = ids.slice(i, i + 200)
      const { data } = await supabase.from(opts.tabla).select(`id, ${opts.columnas}`).in("id", lote)
      for (const r of (data || []) as unknown as Record<string, unknown>[]) mapa.set(Number(r.id), r)
    }
  }
  return filas.map((f) => {
    const id = f[opts.campo]
    return { ...f, [opts.como]: id != null ? mapa.get(Number(id)) ?? null : null }
  })
}

/** Aplica varias relaciones en secuencia sobre las mismas filas. */
export async function adjuntarRelaciones<T extends Record<string, unknown>>(
  supabase: SupabaseClient,
  filas: T[],
  relaciones: { campo: string; tabla: string; columnas: string; como: string }[]
): Promise<T[]> {
  let out = filas
  for (const r of relaciones) out = await adjuntarRelacion(supabase, out, r)
  return out
}
