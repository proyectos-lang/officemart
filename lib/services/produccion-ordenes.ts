import { createClient, isSupabaseConfigured } from "@/lib/supabase/client"
import { getTenantStamp, isValidStamp, SESION_INVALIDA_ERROR } from "@/lib/services/tenant-stamp"

// ==================== PRODUCCIÓN · ÓRDENES ====================
//
// Orden de producción: qué producto fabricar, cuánto, para cuándo. Congela
// `receta_id` al crear (si el producto tiene receta) para el consumo/costeo del
// control de piso. Estados: Abierta | En Proceso | Cerrada | Cancelada.
// Degrada si el script 048 no se aplicó.

export type EstadoOrden = "Abierta" | "En Proceso" | "Cerrada" | "Cancelada"

/** Tipo de orden (script officemart-010): NULL/'Produccion' = fabrica un producto; 'Trabajo' = OT libre. */
export type TipoOrden = "Produccion" | "Trabajo"

/**
 * Codigo legible de una orden, derivado de su id (unico y estable): 'OP-0007'
 * para producción, 'OT-0007' para órdenes de trabajo. No requiere columna ni
 * secuencia; el id garantiza unicidad.
 */
export function codigoOrden(id: number, tipo?: TipoOrden | string | null): string {
  const prefijo = tipo === "Trabajo" ? "OT" : "OP"
  return `${prefijo}-${String(id).padStart(4, "0")}`
}

/** Nombre visible de la orden: descripción (OT) o producto (OP). Pura. */
export function etiquetaOrden(o: { tipo?: TipoOrden | string | null; descripcion?: string | null; producto_nombre?: string | null; producto_id?: number }): string {
  if (o.tipo === "Trabajo") return (o.descripcion || "").trim() || "Orden de trabajo"
  return (o.producto_nombre || "").trim() || (o.producto_id ? `Producto #${o.producto_id}` : "Orden")
}

export interface OrdenProduccion {
  id: number
  producto_id: number
  producto_nombre?: string
  receta_id: number | null
  cantidad_objetivo: number
  fecha_objetivo: string | null
  notas: string | null
  estado: EstadoOrden
  created_at: string
  // ── Programacion (planeador, script 054) ──
  fecha_programada: string | null
  inicio_min_dia: number | null       // minutos desde medianoche (0..1439)
  duracion_horas: number | null       // NULL => se calcula desde la receta
  // ── Orden de trabajo libre y costo real (script officemart-010) ──
  tipo?: TipoOrden | null
  descripcion?: string | null
  cliente_id?: number | null
  cliente_nombre?: string | null
  venta_id?: number | null
  pedido_id?: number | null
  cotizacion_id?: number | null
  costo_materiales_real?: number | null
  costo_total_real?: number | null
}

/** Columnas del script officemart-010 (se piden aparte y se reintenta sin ellas). */
const COLS_OT = "tipo, descripcion, cliente_id, venta_id, pedido_id, cotizacion_id, costo_materiales_real, costo_total_real"

/** Jornada laboral de un dia (rango visible del planeador), en minutos. */
export interface JornadaDia {
  fecha: string
  hora_inicio_min: number
  hora_fin_min: number
}

/** Una orden colocada en la linea de tiempo del planeador, ya con su duracion
 *  efectiva (editada o estimada) y su avance de produccion. */
export interface OrdenPlaneada extends OrdenProduccion {
  /** Duracion efectiva en horas: duracion_horas si existe, si no la estimada. */
  duracion_efectiva_horas: number
  /** Duracion estimada desde la receta (cantidad / estandar), o null si no hay. */
  duracion_estimada_horas: number | null
  /** Suma de unidades buenas fabricadas (corridas de la orden). */
  fabricado: number
  /** % de completacion = fabricado / cantidad_objetivo (0..100). */
  completado_pct: number
}

export const ORDENES_FEATURE_PENDING =
  "Función de órdenes pendiente: aplica scripts/048-produccion-ordenes.sql en Supabase."

function isMissingTable(err: { message?: string; code?: string } | null): boolean {
  if (!err) return false
  const msg = (err.message || "").toLowerCase()
  return (
    err.code === "42P01" ||
    err.code === "PGRST205" ||
    /relation .*produccion_ordenes.* does not exist/.test(msg) ||
    msg.includes("could not find the table")
  )
}

/** true si el error de PostgREST es por columna inexistente (script 054 no aplicado). */
function isMissingColumn(err: { message?: string; code?: string } | null): boolean {
  if (!err) return false
  const msg = (err.message || "").toLowerCase()
  return (
    err.code === "42703" ||
    /column .* does not exist/.test(msg) ||
    (msg.includes("could not find") && msg.includes("column"))
  )
}

function mapOrden(o: Record<string, unknown>): OrdenProduccion {
  return {
    id: Number(o.id),
    producto_id: Number(o.producto_id),
    producto_nombre: "",
    receta_id: o.receta_id != null ? Number(o.receta_id) : null,
    cantidad_objetivo: Number(o.cantidad_objetivo || 0),
    fecha_objetivo: (o.fecha_objetivo as string) || null,
    notas: (o.notas as string) ?? null,
    estado: String(o.estado || "Abierta") as EstadoOrden,
    created_at: String(o.created_at || ""),
    fecha_programada: (o.fecha_programada as string) || null,
    inicio_min_dia: o.inicio_min_dia != null ? Number(o.inicio_min_dia) : null,
    duracion_horas: o.duracion_horas != null ? Number(o.duracion_horas) : null,
    tipo: (o.tipo as TipoOrden) ?? null,
    descripcion: (o.descripcion as string) ?? null,
    cliente_id: o.cliente_id != null ? Number(o.cliente_id) : null,
    venta_id: o.venta_id != null ? Number(o.venta_id) : null,
    pedido_id: o.pedido_id != null ? Number(o.pedido_id) : null,
    cotizacion_id: o.cotizacion_id != null ? Number(o.cotizacion_id) : null,
    costo_materiales_real: o.costo_materiales_real != null ? Number(o.costo_materiales_real) : null,
    costo_total_real: o.costo_total_real != null ? Number(o.costo_total_real) : null,
  }
}

/** Nombres de clientes por id (para las OT con cliente). */
async function resolverNombresCliente(
  supabase: NonNullable<ReturnType<typeof createClient>>,
  clienteIds: (number | null | undefined)[],
): Promise<Map<number, string>> {
  const out = new Map<number, string>()
  const ids = Array.from(new Set(clienteIds.filter((v): v is number => v != null)))
  if (ids.length === 0) return out
  const { data } = await supabase.from("clientes").select("id, nombre").in("id", ids)
  for (const c of data || []) out.set(Number(c.id), String(c.nombre || ""))
  return out
}

/** Resuelve nombres de producto por id (sin embed: no hay FK declarada). */
async function resolverNombresProducto(
  supabase: NonNullable<ReturnType<typeof createClient>>,
  productoIds: number[],
): Promise<Map<number, string>> {
  const out = new Map<number, string>()
  const ids = Array.from(new Set(productoIds.filter((v) => v != null)))
  if (ids.length === 0) return out
  const { data } = await supabase.from("productos").select("id, nombre").in("id", ids)
  for (const p of data || []) out.set(Number(p.id), String(p.nombre || ""))
  return out
}

export async function getOrdenes(): Promise<{ data: OrdenProduccion[]; error: string | null }> {
  if (!isSupabaseConfigured()) return { data: [], error: null }
  const supabase = createClient()
  if (!supabase) return { data: [], error: "Cliente no disponible" }

  // Sin embed `productos (nombre)`: no hay FK declarada y PostgREST falla la
  // consulta entera (PGRST200) -> el listado salia vacio. Se resuelve aparte.
  const COLS_FULL =
    "id, producto_id, receta_id, cantidad_objetivo, fecha_objetivo, notas, estado, created_at, fecha_programada, inicio_min_dia, duracion_horas"
  const COLS_BASE =
    "id, producto_id, receta_id, cantidad_objetivo, fecha_objetivo, notas, estado, created_at"

  type QueryRes = { data: Record<string, unknown>[] | null; error: { message?: string; code?: string } | null }
  // Primero con las columnas de OT (officemart-010); luego planeador; luego base.
  let res: QueryRes = await supabase
    .from("produccion_ordenes")
    .select(`${COLS_FULL}, ${COLS_OT}`)
    .order("created_at", { ascending: false })
  if (res.error && isMissingColumn(res.error)) {
    res = await supabase
      .from("produccion_ordenes")
      .select(COLS_FULL)
      .order("created_at", { ascending: false })
  }
  if (res.error && isMissingColumn(res.error)) {
    res = await supabase
      .from("produccion_ordenes")
      .select(COLS_BASE)
      .order("created_at", { ascending: false })
  }
  if (res.error) {
    if (isMissingTable(res.error)) return { data: [], error: null }
    return { data: [], error: res.error.message ?? "Error" }
  }

  const filas = res.data || []
  const [nombres, clientes] = await Promise.all([
    resolverNombresProducto(supabase, filas.map((o) => Number(o.producto_id)).filter((id) => id > 0)),
    resolverNombresCliente(supabase, filas.map((o) => (o.cliente_id != null ? Number(o.cliente_id) : null))),
  ])
  const rows = filas.map((o) => {
    const base = mapOrden(o)
    return {
      ...base,
      // Una OT no tiene producto: su "nombre" es la descripción.
      producto_nombre: base.tipo === "Trabajo" ? etiquetaOrden(base) : nombres.get(base.producto_id) ?? "",
      cliente_nombre: base.cliente_id != null ? clientes.get(base.cliente_id) ?? null : null,
    }
  })
  return { data: rows, error: null }
}

/**
 * Crea una ORDEN DE TRABAJO libre (sin producto): descripción, cliente y
 * documento origen opcionales. Usa `producto_id = 0` (centinela: la columna es
 * NOT NULL sin FK) y genera sus etapas con las operaciones indicadas (o todas
 * las activas). Requiere el script officemart-010.
 */
export async function createOrdenTrabajo(input: {
  descripcion: string
  cliente_id?: number | null
  venta_id?: number | null
  pedido_id?: number | null
  cotizacion_id?: number | null
  cantidad_objetivo?: number
  fecha_objetivo?: string | null
  notas?: string | null
  operacion_ids?: number[]
}): Promise<{ data: { id: number; etapas: number } | null; error: string | null }> {
  const supabase = createClient()
  if (!supabase) return { data: null, error: "Cliente no disponible" }
  const stamp = await getTenantStamp(supabase)
  if (!isValidStamp(stamp)) return { data: null, error: SESION_INVALIDA_ERROR }
  const descripcion = (input.descripcion || "").trim()
  if (!descripcion) return { data: null, error: "Describe el trabajo a realizar." }

  const { data, error } = await supabase
    .from("produccion_ordenes")
    .insert({
      producto_id: 0,
      receta_id: null,
      tipo: "Trabajo",
      descripcion,
      cliente_id: input.cliente_id ?? null,
      venta_id: input.venta_id ?? null,
      pedido_id: input.pedido_id ?? null,
      cotizacion_id: input.cotizacion_id ?? null,
      cantidad_objetivo: Math.max(1, Number(input.cantidad_objetivo) || 1),
      fecha_objetivo: input.fecha_objetivo || null,
      notas: (input.notas || "").trim() || null,
      estado: "Abierta",
      ...stamp,
    })
    .select("id")
    .single()
  if (error || !data?.id) {
    if (isMissingTable(error)) return { data: null, error: ORDENES_FEATURE_PENDING }
    if (error && isMissingColumn(error)) return { data: null, error: "Órdenes de trabajo pendientes: aplica scripts/officemart-010-ordenes-trabajo.sql en Supabase." }
    return { data: null, error: error?.message || "No se pudo crear la orden de trabajo" }
  }
  const id = Number(data.id)
  // Etapas: import dinámico para no crear ciclo (flujo importa de aquí? no; pero
  // mantenemos el módulo de órdenes libre de dependencias de flujo).
  const { generarEtapasOrden } = await import("@/lib/services/produccion-flujo")
  const et = await generarEtapasOrden(id, input.operacion_ids)
  return { data: { id, etapas: et.data?.creadas ?? 0 }, error: et.error ? `Orden creada, pero sin etapas: ${et.error}` : null }
}

/**
 * Crea una orden. Congela `receta_id` si el producto tiene receta (busca la
 * receta del producto en produccion_recetas). Devuelve `sinReceta` para que la
 * UI avise (se permite crear igual).
 */
export async function createOrden(input: {
  producto_id: number
  cantidad_objetivo: number
  fecha_objetivo?: string | null
  notas?: string | null
}): Promise<{ data: { id: number } | null; sinReceta: boolean; error: string | null }> {
  const supabase = createClient()
  if (!supabase) return { data: null, sinReceta: false, error: "Cliente no disponible" }
  const stamp = await getTenantStamp(supabase)
  if (!isValidStamp(stamp)) return { data: null, sinReceta: false, error: SESION_INVALIDA_ERROR }

  // Congela la receta vigente del producto (si existe).
  let recetaId: number | null = null
  const { data: rec } = await supabase
    .from("produccion_recetas")
    .select("id")
    .eq("producto_id", input.producto_id)
    .maybeSingle()
  if (rec?.id) recetaId = rec.id

  const { data, error } = await supabase
    .from("produccion_ordenes")
    .insert({
      producto_id: input.producto_id,
      receta_id: recetaId,
      cantidad_objetivo: Number(input.cantidad_objetivo) || 0,
      fecha_objetivo: input.fecha_objetivo || null,
      notas: (input.notas || "").trim() || null,
      estado: "Abierta",
      ...stamp,
    })
    .select("id")
    .single()
  if (error || !data?.id) {
    if (isMissingTable(error)) return { data: null, sinReceta: false, error: ORDENES_FEATURE_PENDING }
    return { data: null, sinReceta: false, error: error?.message || "No se pudo crear la orden" }
  }
  return { data: { id: data.id as number }, sinReceta: recetaId == null, error: null }
}

export async function updateOrden(
  id: number,
  input: { cantidad_objetivo: number; fecha_objetivo?: string | null; notas?: string | null },
): Promise<{ error: string | null }> {
  const supabase = createClient()
  if (!supabase) return { error: "Cliente no disponible" }
  const { error } = await supabase
    .from("produccion_ordenes")
    .update({
      cantidad_objetivo: Number(input.cantidad_objetivo) || 0,
      fecha_objetivo: input.fecha_objetivo || null,
      notas: (input.notas || "").trim() || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
  return { error: error ? error.message : null }
}

export async function setEstadoOrden(id: number, estado: EstadoOrden): Promise<{ error: string | null }> {
  const supabase = createClient()
  if (!supabase) return { error: "Cliente no disponible" }
  const { error } = await supabase
    .from("produccion_ordenes")
    .update({ estado, updated_at: new Date().toISOString() })
    .eq("id", id)
  return { error: error ? error.message : null }
}

// ==================== PLANEADOR (script 054) ====================

/**
 * Duracion estimada en horas (funcion PURA): cantidad / estandar(u/min) / 60.
 * Devuelve null si no hay estandar > 0 (no se puede estimar).
 */
export function estimarHoras(cantidad: number, estandarUnidadesPorMin: number): number | null {
  const est = Number(estandarUnidadesPorMin) || 0
  const cant = Number(cantidad) || 0
  if (est <= 0 || cant <= 0) return null
  return +((cant / est) / 60).toFixed(2)
}

/** Jornada laboral por defecto: 08:00 (480) a 17:00 (1020). */
export const JORNADA_DEFAULT: JornadaDia = { fecha: "", hora_inicio_min: 480, hora_fin_min: 1020 }

/** Lee la jornada guardada de un dia; si no hay, devuelve el default. */
export async function getJornada(fecha: string): Promise<{ data: JornadaDia; error: string | null }> {
  const fallback: JornadaDia = { ...JORNADA_DEFAULT, fecha }
  if (!isSupabaseConfigured()) return { data: fallback, error: null }
  const supabase = createClient()
  if (!supabase) return { data: fallback, error: "Cliente no disponible" }
  const { data, error } = await supabase
    .from("produccion_jornadas")
    .select("fecha, hora_inicio_min, hora_fin_min")
    .eq("fecha", fecha)
    .maybeSingle()
  if (error) {
    // Tabla no creada aun (script 054): devolvemos el default sin error.
    if (isMissingTable(error) || /produccion_jornadas/i.test(error.message || "")) return { data: fallback, error: null }
    return { data: fallback, error: error.message }
  }
  if (!data) return { data: fallback, error: null }
  return {
    data: { fecha, hora_inicio_min: Number(data.hora_inicio_min), hora_fin_min: Number(data.hora_fin_min) },
    error: null,
  }
}

/** Guarda (upsert) la jornada laboral de un dia. */
export async function setJornada(
  fecha: string,
  horaInicioMin: number,
  horaFinMin: number,
): Promise<{ error: string | null }> {
  const supabase = createClient()
  if (!supabase) return { error: "Cliente no disponible" }
  const stamp = await getTenantStamp(supabase)
  if (!isValidStamp(stamp)) return { error: SESION_INVALIDA_ERROR }
  const ini = Math.max(0, Math.min(1439, Math.round(horaInicioMin)))
  const fin = Math.max(ini + 1, Math.min(1440, Math.round(horaFinMin)))
  const { error } = await supabase
    .from("produccion_jornadas")
    .upsert(
      { fecha, hora_inicio_min: ini, hora_fin_min: fin, updated_at: new Date().toISOString(), ...stamp },
      { onConflict: "razon_social_id,fecha" },
    )
  if (error) {
    if (isMissingTable(error) || /produccion_jornadas/i.test(error.message || "")) {
      return { error: "Falta aplicar el script 054 (planeador de producción)." }
    }
    return { error: error.message }
  }
  return { error: null }
}

/**
 * Programa una orden en el planeador: fecha, hora de inicio (minutos) y, opcional,
 * duracion en horas (si se omite/null, la UI usa la estimada de la receta).
 */
export async function programarOrden(
  id: number,
  input: { fecha_programada: string; inicio_min_dia: number; duracion_horas?: number | null },
): Promise<{ error: string | null }> {
  const supabase = createClient()
  if (!supabase) return { error: "Cliente no disponible" }
  const ini = Math.max(0, Math.min(1439, Math.round(input.inicio_min_dia)))
  const { error } = await supabase
    .from("produccion_ordenes")
    .update({
      fecha_programada: input.fecha_programada,
      inicio_min_dia: ini,
      duracion_horas: input.duracion_horas != null ? Number(input.duracion_horas) : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
  if (error) {
    if (isMissingColumn(error)) return { error: "Falta aplicar el script 054 (planeador de producción)." }
    return { error: error.message }
  }
  return { error: null }
}

/** Mueve solo la hora de inicio de una orden ya programada (drag & drop). */
export async function moverOrdenInicio(id: number, inicioMinDia: number): Promise<{ error: string | null }> {
  const supabase = createClient()
  if (!supabase) return { error: "Cliente no disponible" }
  const ini = Math.max(0, Math.min(1439, Math.round(inicioMinDia)))
  const { error } = await supabase
    .from("produccion_ordenes")
    .update({ inicio_min_dia: ini, updated_at: new Date().toISOString() })
    .eq("id", id)
  if (error) {
    if (isMissingColumn(error)) return { error: "Falta aplicar el script 054 (planeador de producción)." }
    return { error: error.message }
  }
  return { error: null }
}

/** Quita una orden de la programacion del planeador (no la borra). */
export async function desprogramarOrden(id: number): Promise<{ error: string | null }> {
  const supabase = createClient()
  if (!supabase) return { error: "Cliente no disponible" }
  const { error } = await supabase
    .from("produccion_ordenes")
    .update({ fecha_programada: null, inicio_min_dia: null, updated_at: new Date().toISOString() })
    .eq("id", id)
  if (error) {
    if (isMissingColumn(error)) return { error: null }
    return { error: error.message }
  }
  return { error: null }
}

/**
 * Datos del planeador para un dia: jornada + ordenes PROGRAMADAS ese dia (con
 * su duracion efectiva y su avance) + ordenes SIN programar disponibles para
 * arrastrar al timeline. Excluye Cerradas/Canceladas de las "sin programar".
 */
export async function getPlaneadorDia(fecha: string): Promise<{
  data: { jornada: JornadaDia; programadas: OrdenPlaneada[]; sinProgramar: OrdenPlaneada[] }
  error: string | null
}> {
  const empty = { jornada: { ...JORNADA_DEFAULT, fecha }, programadas: [] as OrdenPlaneada[], sinProgramar: [] as OrdenPlaneada[] }
  if (!isSupabaseConfigured()) return { data: empty, error: null }
  const supabase = createClient()
  if (!supabase) return { data: empty, error: "Cliente no disponible" }

  const [{ data: ordenes, error: ordErr }, { data: jornada }] = await Promise.all([
    getOrdenes(),
    getJornada(fecha),
  ])
  if (ordErr) return { data: { ...empty, jornada }, error: ordErr }

  // Estandar por receta (para estimar horas) y avance por orden.
  const recetaIds = Array.from(new Set(ordenes.map((o) => o.receta_id).filter((v): v is number => v != null)))
  const estandarPorReceta = new Map<number, number>()
  if (recetaIds.length > 0) {
    const { data: recs } = await supabase
      .from("produccion_recetas")
      .select("id, estandar_unidades_por_minuto")
      .in("id", recetaIds)
    for (const r of recs || []) estandarPorReceta.set(Number(r.id), Number(r.estandar_unidades_por_minuto || 0))
  }

  // Fabricado por orden = suma de unidades_buenas de sus corridas.
  const ordenIds = ordenes.map((o) => o.id)
  const fabricadoPorOrden = new Map<number, number>()
  if (ordenIds.length > 0) {
    const { data: corr } = await supabase
      .from("produccion_corridas")
      .select("orden_id, unidades_buenas")
      .in("orden_id", ordenIds)
    for (const c of corr || []) {
      const oid = Number(c.orden_id)
      fabricadoPorOrden.set(oid, (fabricadoPorOrden.get(oid) || 0) + (Number(c.unidades_buenas) || 0))
    }
  }

  const enriquecer = (o: OrdenProduccion): OrdenPlaneada => {
    const est = o.receta_id != null ? estandarPorReceta.get(o.receta_id) || 0 : 0
    const estimada = estimarHoras(o.cantidad_objetivo, est)
    const efectiva = o.duracion_horas != null ? Number(o.duracion_horas) : (estimada ?? 1) // 1h por defecto si no hay receta
    const fabricado = fabricadoPorOrden.get(o.id) || 0
    const pct = o.cantidad_objetivo > 0 ? Math.min(100, +((fabricado / o.cantidad_objetivo) * 100).toFixed(1)) : 0
    return { ...o, duracion_estimada_horas: estimada, duracion_efectiva_horas: efectiva, fabricado, completado_pct: pct }
  }

  const programadas = ordenes
    .filter((o) => o.fecha_programada === fecha && o.inicio_min_dia != null)
    .map(enriquecer)
    .sort((a, b) => (a.inicio_min_dia! - b.inicio_min_dia!))
  const sinProgramar = ordenes
    .filter((o) => o.fecha_programada !== fecha && o.estado !== "Cerrada" && o.estado !== "Cancelada")
    .map(enriquecer)

  return { data: { jornada, programadas, sinProgramar }, error: null }
}
