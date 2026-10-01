import { createClient } from "@/lib/supabase/client"
import { getTenantStamp, isValidStamp, SESION_INVALIDA_ERROR } from "@/lib/services/tenant-stamp"
import { formatearCorrelativoCai, fmtFechaCorta, type CorrelativoCaiEmitido } from "@/lib/services/facturacion-cai"

/**
 * Puntos de facturación (sucursales) — script officemart-004.
 *
 * Cada punto tiene código, nombre, dirección, una localización (almacén) por
 * defecto y, opcionalmente, un prefijo de serie interna (`FC-SPS-`). La
 * configuración CAI vive por punto en `facturacion_cai_puntos` (punto 0 =
 * empresa sin puntos) y cada venta guarda una FOTO fiscal (`fiscal_snapshot`)
 * para reimprimir igual aunque el CAI cambie después.
 *
 * Degrada sin romper: si la tabla no existe, `getPuntosFacturacion` devuelve
 * [] y todo el flujo de ventas sigue como hasta ahora (punto 0).
 */

export const PUNTOS_FEATURE_PENDING =
  "Puntos de facturación pendientes: aplica scripts/officemart-004-puntos-facturacion.sql en Supabase."

export interface PuntoFacturacion {
  id?: number
  codigo: string
  nombre: string
  ciudad?: string | null
  direccion?: string | null
  telefono?: string | null
  /** Localización (y por tanto almacén) desde la que vende este punto. */
  localizacion_id?: number | null
  /** Prefijo de la serie interna propia ('FC-SPS-'); null = FC-#### global. */
  serie_prefijo?: string | null
  activo: boolean
  created_at?: string
}

/** Foto de la autorización CAI usada al emitir un documento (jsonb en la venta). */
export interface FiscalSnapshot {
  numero: string
  correlativo: number
  tipo_documento: string
  cai: string | null
  establecimiento: string
  punto_emision: string
  rango_inicial: number
  rango_final: number
  /** Rango ya formateado (ESTAB-PUNTO-TIPO-NNNNNNNN). */
  rango_desde: string | null
  rango_hasta: string | null
  fecha_limite_emision: string | null
  imprenta_nombre: string | null
  imprenta_rtn: string | null
  imprenta_registro: string | null
  punto_facturacion_id: number
}

function isMissingTable(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false
  const msg = (err.message || "").toLowerCase()
  return err.code === "42P01" || err.code === "PGRST205" || msg.includes("does not exist") || (msg.includes("schema cache") && !msg.includes("relationship"))
}

// ==================== FUNCIONES PURAS ====================

/**
 * Decide con qué punto se emite una venta:
 *   1. la selección explícita, si es un punto activo y el usuario es admin
 *      (o no tiene punto asignado);
 *   2. el punto asignado al usuario, si está activo;
 *   3. si solo hay un punto activo, ese;
 *   4. null → la empresa trabaja "sin puntos" (punto 0, comportamiento clásico).
 */
export function resolverPuntoVenta(
  user: { punto_facturacion_id?: number | null; rol?: string | null } | null | undefined,
  puntos: PuntoFacturacion[],
  seleccionId?: number | null
): PuntoFacturacion | null {
  const activos = (puntos || []).filter((p) => p.activo !== false && p.id != null)
  if (activos.length === 0) return null
  const esAdmin = (user?.rol || "").trim().toLowerCase() === "admin"
  const asignado = user?.punto_facturacion_id != null
    ? activos.find((p) => p.id === user.punto_facturacion_id) ?? null
    : null
  if (seleccionId != null && (esAdmin || !asignado)) {
    const sel = activos.find((p) => p.id === seleccionId)
    if (sel) return sel
  }
  if (asignado) return asignado
  if (activos.length === 1) return activos[0]
  return null
}

/** Serie interna propia del punto (`venta:<id>` + prefijo) o null si usa la global. */
export function serieVentaDePunto(
  punto: Pick<PuntoFacturacion, "id" | "serie_prefijo"> | null | undefined
): { serie: string; prefijo: string } | null {
  if (!punto || punto.id == null) return null
  const prefijo = (punto.serie_prefijo || "").trim()
  if (!prefijo) return null
  return { serie: `venta:${punto.id}`, prefijo }
}

/** Arma la foto fiscal a partir del correlativo emitido por el RPC (v2 trae rango/imprenta). */
export function construirFiscalSnapshot(
  corr: CorrelativoCaiEmitido,
  puntoId: number = 0
): FiscalSnapshot {
  const rangoIni = Number(corr.rango_inicial ?? 0)
  const rangoFin = Number(corr.rango_final ?? 0)
  const fmt = (n: number) =>
    formatearCorrelativoCai(corr.establecimiento, corr.punto_emision, corr.tipo_documento, n)
  return {
    numero: corr.numero,
    correlativo: corr.correlativo,
    tipo_documento: corr.tipo_documento,
    cai: corr.cai ?? null,
    establecimiento: corr.establecimiento,
    punto_emision: corr.punto_emision,
    rango_inicial: rangoIni,
    rango_final: rangoFin,
    rango_desde: rangoIni > 0 ? fmt(rangoIni) : null,
    rango_hasta: rangoFin > 0 ? fmt(rangoFin) : null,
    fecha_limite_emision: corr.fecha_limite_emision ?? null,
    imprenta_nombre: corr.imprenta_nombre ?? null,
    imprenta_rtn: corr.imprenta_rtn ?? null,
    imprenta_registro: corr.imprenta_registro ?? null,
    punto_facturacion_id: puntoId,
  }
}

/** Campos del bloque fiscal de tirilla/PDF que salen de la foto (no del CAI vigente). */
export function fiscalDesdeSnapshot(snap: Partial<FiscalSnapshot> | null | undefined): {
  cai: string
  rangoDesde: string | null
  rangoHasta: string | null
  fechaLimite: string | null
  imprentaNombre: string | null
  imprentaRtn: string | null
  imprentaRegistro: string | null
} | null {
  if (!snap || !snap.numero) return null
  return {
    cai: snap.cai || "",
    rangoDesde: snap.rango_desde ?? null,
    rangoHasta: snap.rango_hasta ?? null,
    fechaLimite: snap.fecha_limite_emision ? fmtFechaCorta(snap.fecha_limite_emision) : null,
    imprentaNombre: snap.imprenta_nombre ?? null,
    imprentaRtn: snap.imprenta_rtn ?? null,
    imprentaRegistro: snap.imprenta_registro ?? null,
  }
}

/** Lee la foto fiscal guardada en una venta (jsonb o string). */
export function parseFiscalSnapshot(raw: unknown): FiscalSnapshot | null {
  if (!raw) return null
  try {
    const obj = typeof raw === "string" ? JSON.parse(raw) : raw
    if (obj && typeof obj === "object" && typeof (obj as FiscalSnapshot).numero === "string") {
      return obj as FiscalSnapshot
    }
  } catch {
    /* jsonb corrupto: se ignora */
  }
  return null
}

// ==================== CRUD ====================

function normalizar(r: Record<string, unknown>): PuntoFacturacion {
  return {
    id: r.id as number,
    codigo: String(r.codigo ?? ""),
    nombre: String(r.nombre ?? ""),
    ciudad: (r.ciudad as string) ?? null,
    direccion: (r.direccion as string) ?? null,
    telefono: (r.telefono as string) ?? null,
    localizacion_id: (r.localizacion_id as number) ?? null,
    serie_prefijo: (r.serie_prefijo as string) ?? null,
    activo: r.activo === undefined ? true : Boolean(r.activo),
    created_at: r.created_at as string,
  }
}

/**
 * Lista los puntos del tenant. Si la tabla no existe (script pendiente) devuelve
 * `[]` sin error y `pendiente: true`, para que las pantallas de venta sigan
 * funcionando "sin puntos" y solo la de configuración muestre el aviso.
 */
export async function getPuntosFacturacion(
  opts: { soloActivos?: boolean } = {}
): Promise<{ data: PuntoFacturacion[]; error: string | null; pendiente: boolean }> {
  const supabase = createClient()
  if (!supabase) return { data: [], error: null, pendiente: false }
  try {
    let q = supabase.from("puntos_facturacion").select("*").order("codigo", { ascending: true })
    if (opts.soloActivos) q = q.eq("activo", true)
    const { data, error } = await q
    if (error) {
      if (isMissingTable(error)) return { data: [], error: null, pendiente: true }
      return { data: [], error: error.message, pendiente: false }
    }
    return { data: (data || []).map(normalizar), error: null, pendiente: false }
  } catch (err) {
    console.error("[puntos-facturacion] get:", err)
    return { data: [], error: "Error de conexión", pendiente: false }
  }
}

export async function getPuntoFacturacion(id: number): Promise<PuntoFacturacion | null> {
  const supabase = createClient()
  if (!supabase) return null
  try {
    const { data, error } = await supabase.from("puntos_facturacion").select("*").eq("id", id).maybeSingle()
    if (error || !data) return null
    return normalizar(data)
  } catch {
    return null
  }
}

export async function savePuntoFacturacion(
  punto: PuntoFacturacion
): Promise<{ data: PuntoFacturacion | null; error: string | null }> {
  const supabase = createClient()
  if (!supabase) return { data: null, error: "Cliente de Supabase no disponible" }
  const stamp = await getTenantStamp(supabase)
  if (!isValidStamp(stamp)) return { data: null, error: SESION_INVALIDA_ERROR }

  const codigo = (punto.codigo || "").trim().toUpperCase()
  const nombre = (punto.nombre || "").trim()
  if (!codigo) return { data: null, error: "El código del punto es obligatorio." }
  if (!nombre) return { data: null, error: "El nombre del punto es obligatorio." }
  const prefijo = (punto.serie_prefijo || "").trim()
  if (prefijo && !/^[A-Za-z0-9-]{1,12}$/.test(prefijo)) {
    return { data: null, error: "El prefijo de serie solo admite letras, números y guiones (máx. 12)." }
  }

  const fila = {
    codigo,
    nombre,
    ciudad: (punto.ciudad || "").trim() || null,
    direccion: (punto.direccion || "").trim() || null,
    telefono: (punto.telefono || "").trim() || null,
    localizacion_id: punto.localizacion_id ?? null,
    serie_prefijo: prefijo || null,
    activo: punto.activo ?? true,
  }

  try {
    if (punto.id != null) {
      const { data, error } = await supabase
        .from("puntos_facturacion")
        .update({ ...fila, updated_at: new Date().toISOString() })
        .eq("id", punto.id)
        .select("*")
        .single()
      if (error) return { data: null, error: error.code === "23505" ? "Ya existe un punto con ese código." : error.message }
      return { data: normalizar(data), error: null }
    }
    const { data, error } = await supabase
      .from("puntos_facturacion")
      .insert({ ...fila, ...stamp })
      .select("*")
      .single()
    if (error) {
      if (isMissingTable(error)) return { data: null, error: PUNTOS_FEATURE_PENDING }
      return { data: null, error: error.code === "23505" ? "Ya existe un punto con ese código." : error.message }
    }
    return { data: normalizar(data), error: null }
  } catch (err) {
    console.error("[puntos-facturacion] save:", err)
    return { data: null, error: "Error de conexión" }
  }
}

/** Borra el punto; si ya tiene ventas, solo lo desactiva (historial intacto). */
export async function deletePuntoFacturacion(
  id: number
): Promise<{ success: boolean; desactivado: boolean; error: string | null }> {
  const supabase = createClient()
  if (!supabase) return { success: false, desactivado: false, error: "Cliente de Supabase no disponible" }
  try {
    const { count } = await supabase
      .from("ventas_encabezado")
      .select("id", { count: "exact", head: true })
      .eq("punto_facturacion_id", id)
    if ((count || 0) > 0) {
      const { error } = await supabase
        .from("puntos_facturacion")
        .update({ activo: false, updated_at: new Date().toISOString() })
        .eq("id", id)
      if (error) return { success: false, desactivado: false, error: error.message }
      return { success: true, desactivado: true, error: null }
    }
    const { error } = await supabase.from("puntos_facturacion").delete().eq("id", id)
    if (error) return { success: false, desactivado: false, error: error.message }
    return { success: true, desactivado: false, error: null }
  } catch (err) {
    console.error("[puntos-facturacion] delete:", err)
    return { success: false, desactivado: false, error: "Error de conexión" }
  }
}

/** Mapa id → "CÓDIGO · Nombre" para columnas y filtros. */
export function etiquetaPunto(p: Pick<PuntoFacturacion, "codigo" | "nombre">): string {
  return p.codigo ? `${p.codigo} · ${p.nombre}` : p.nombre
}
