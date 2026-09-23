/**
 * Filtro único de ventas VIGENTES (no anuladas) — script officemart-003.
 *
 * Una venta anulada conserva sus filas (`anulada_at` con fecha); las consultas
 * que agregan ventas (dashboard, P&L, cierre, CxC, analítica…) deben excluirla
 * con `anulada_at IS NULL`. Se usa `IS NULL` y no un `estado` porque PostgREST
 * `.neq('estado', 'Anulada')` excluye los NULL y la regla del proyecto prohíbe
 * defaults en columnas nuevas.
 *
 * Degradación: si el script 003 no está aplicado, la columna no existe y la
 * consulta falla con "column ... anulada_at does not exist". `ejecutarVigentes`
 * detecta ese error UNA vez, apaga el filtro para el resto de la sesión y
 * reintenta sin él (comportamiento anterior: todas las ventas cuentan).
 */

export const COL_ANULADA = "anulada_at"

let columnaAnuladaDisponible: boolean | null = null

/** true si el error de PostgREST/Postgres es "la columna anulada_at no existe". */
export function esErrorColumnaAnulada(err: { message?: string; code?: string } | null | undefined): boolean {
  if (!err) return false
  return /anulada_at/i.test(err.message || "")
}

/** ¿Debe aplicarse el filtro? (false solo tras detectar que la columna no existe). */
export function filtrarVigentesActivo(): boolean {
  return columnaAnuladaDisponible !== false
}

/** Solo para tests. */
export function _resetFiltroVigentes(): void {
  columnaAnuladaDisponible = null
}

type ResultadoQuery<T> = { data: T; error: { message?: string; code?: string } | null }

/**
 * Ejecuta una consulta construida por `build(filtrar)`. Con `filtrar=true` el
 * builder debe agregar `.is('anulada_at', null)` (o `.is('<embed>.anulada_at',
 * null)`). Si la BD no tiene la columna, se reintenta con `filtrar=false`.
 */
export async function ejecutarVigentes<T>(
  build: (filtrar: boolean) => PromiseLike<ResultadoQuery<T>>
): Promise<ResultadoQuery<T>> {
  if (columnaAnuladaDisponible === false) return build(false)
  const r = await build(true)
  if (r.error && esErrorColumnaAnulada(r.error)) {
    columnaAnuladaDisponible = false
    return build(false)
  }
  if (!r.error) columnaAnuladaDisponible = true
  return r
}

/** Para filas ya cargadas en memoria: true si la venta sigue vigente. */
export function esVentaVigente(v: { anulada_at?: string | null } | null | undefined): boolean {
  return !v || v.anulada_at == null
}
