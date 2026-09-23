import { createClient, isSupabaseConfigured } from "@/lib/supabase/client"
import { getTenantStamp, isValidStamp, SESION_INVALIDA_ERROR } from "@/lib/services/tenant-stamp"
import { matAjustarStock } from "@/lib/services/produccion-materiales"
import { ajustarStock } from "@/lib/services/stock"
import { registrarAuditoria } from "@/lib/services/auditoria"
import { getHondurasNowISO } from "@/lib/utils/honduras-time"

/**
 * Consumo de materiales o productos por etapa de una orden de producción /
 * orden de trabajo (script officemart-010). Cada consumo descuenta stock
 * (materiales: `mat_ajustar_stock`; productos: `ajustar_stock` + kardex
 * 'Salida Produccion') con foto de costo, y suma al costo real de la orden.
 * Si algo falla a mitad, se compensa lo ya descontado (patrón de
 * `ejecutarCorrida`). Todo lo decidible es puro y está probado.
 */

export const CONSUMOS_FEATURE_PENDING =
  "Consumo por etapa pendiente: aplica scripts/officemart-010-ordenes-trabajo.sql en Supabase."

export type TipoItemConsumo = "material" | "producto"

export interface ConsumoItemInput {
  tipo_item: TipoItemConsumo
  material_id?: number | null
  producto_id?: number | null
  cantidad: number
  /** Solo producto: de dónde sale el stock (kardex). */
  almacen_id?: number | null
  localizacion_id?: number | null
  notas?: string | null
}

export interface ConsumoEtapa {
  id: number
  orden_id: number
  etapa_id: number | null
  etapa_nombre?: string | null
  tipo_item: TipoItemConsumo
  material_id: number | null
  producto_id: number | null
  item_nombre?: string
  cantidad: number
  costo_unitario: number
  costo_total: number
  almacen_id: number | null
  localizacion_id: number | null
  notas: string | null
  fecha: string
  anulado_at: string | null
  motivo_anulacion: string | null
  usuario: string | null
}

function isMissingTable(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false
  const msg = (err.message || "").toLowerCase()
  return err.code === "42P01" || err.code === "PGRST205" || msg.includes("schema cache") || /relation .* does not exist/.test(msg)
}

function r2(n: number): number {
  return +(Number(n) || 0).toFixed(2)
}

// ==================== FUNCIONES PURAS ====================

/**
 * Valida los items contra el stock disponible. Devuelve el mensaje de error
 * o null. `stocks` mapea "material:ID" / "producto:ID" → stock.
 */
export function validarStockConsumo(
  items: ConsumoItemInput[],
  stocks: Map<string, { nombre: string; stock: number }>
): string | null {
  const validos = items.filter((i) => (Number(i.cantidad) || 0) > 0)
  if (validos.length === 0) return "Indica al menos un material o producto con cantidad."
  const faltantes: string[] = []
  const acumulado = new Map<string, number>()
  for (const i of validos) {
    if (i.tipo_item === "producto" && (!i.almacen_id || !i.localizacion_id)) return "Para consumir un producto indica almacén y localización."
    const id = i.tipo_item === "material" ? i.material_id : i.producto_id
    if (id == null) return "Item sin identificador."
    const clave = `${i.tipo_item}:${id}`
    const total = (acumulado.get(clave) || 0) + Number(i.cantidad)
    acumulado.set(clave, total)
    const s = stocks.get(clave)
    if (!s) return `El ${i.tipo_item} #${id} no existe.`
    if (total > s.stock + 0.000001) faltantes.push(`${s.nombre} (hay ${s.stock}, pides ${total})`)
  }
  return faltantes.length > 0 ? `Stock insuficiente: ${faltantes.join("; ")}.` : null
}

/** Costo por item y total (pura). */
export function calcularCostoConsumos(
  items: { cantidad: number; costo_unitario: number }[]
): { lineas: { cantidad: number; costo_unitario: number; costo_total: number }[]; total: number } {
  const lineas = items.map((i) => ({
    cantidad: Number(i.cantidad) || 0,
    costo_unitario: +(Number(i.costo_unitario) || 0).toFixed(4),
    costo_total: r2((Number(i.cantidad) || 0) * (Number(i.costo_unitario) || 0)),
  }))
  return { lineas, total: r2(lineas.reduce((a, l) => a + l.costo_total, 0)) }
}

/**
 * Costo real de una orden = consumos por etapa vigentes + corridas ejecutadas
 * (materiales + factores) + mano de obra declarada por etapa (pura).
 */
export function costoRealOrden(input: {
  consumos: { costo_total: number; anulado_at?: string | null }[]
  corridas?: { costo_materiales_total?: number | null; costo_factores_total?: number | null; estado?: string | null }[]
  manoObraEtapas?: (number | null | undefined)[]
}): { materiales: number; corridas: number; manoObra: number; total: number } {
  const materiales = input.consumos.filter((c) => !c.anulado_at).reduce((a, c) => a + (Number(c.costo_total) || 0), 0)
  const corridas = (input.corridas || [])
    .filter((c) => !c.estado || c.estado === "Ejecutada")
    .reduce((a, c) => a + (Number(c.costo_materiales_total) || 0) + (Number(c.costo_factores_total) || 0), 0)
  const manoObra = (input.manoObraEtapas || []).reduce((a: number, m) => a + (Number(m) || 0), 0)
  return { materiales: r2(materiales), corridas: r2(corridas), manoObra: r2(manoObra), total: r2(materiales + corridas + manoObra) }
}

// ==================== LECTURA ====================

export async function getConsumosOrden(ordenId: number): Promise<{ data: ConsumoEtapa[]; error: string | null; pendiente: boolean }> {
  if (!isSupabaseConfigured()) return { data: [], error: null, pendiente: false }
  const supabase = createClient()
  if (!supabase) return { data: [], error: "Cliente no disponible", pendiente: false }
  const { data, error } = await supabase
    .from("produccion_etapa_consumos")
    .select("*, materiales (nombre), productos (nombre), produccion_orden_etapas (nombre)")
    .eq("orden_id", ordenId)
    .order("fecha", { ascending: true })
  if (error) {
    if (isMissingTable(error)) return { data: [], error: null, pendiente: true }
    // Sin FKs declaradas el embed falla: reintento plano.
    const plano = await supabase.from("produccion_etapa_consumos").select("*").eq("orden_id", ordenId).order("fecha", { ascending: true })
    if (plano.error) return { data: [], error: plano.error.message, pendiente: false }
    return { data: (plano.data || []).map((r) => norm(r as Record<string, unknown>)), error: null, pendiente: false }
  }
  return { data: (data || []).map((r) => norm(r as Record<string, unknown>)), error: null, pendiente: false }
}

function uno<T>(v: T | T[] | null | undefined): T | null {
  if (v == null) return null
  return Array.isArray(v) ? v[0] ?? null : v
}

function norm(r: Record<string, unknown>): ConsumoEtapa {
  const mat = uno(r.materiales as { nombre?: string } | { nombre?: string }[] | null)
  const prod = uno(r.productos as { nombre?: string } | { nombre?: string }[] | null)
  const etapa = uno(r.produccion_orden_etapas as { nombre?: string } | { nombre?: string }[] | null)
  const tipo = (r.tipo_item as TipoItemConsumo) ?? "material"
  return {
    id: Number(r.id),
    orden_id: Number(r.orden_id),
    etapa_id: r.etapa_id != null ? Number(r.etapa_id) : null,
    etapa_nombre: etapa?.nombre ?? null,
    tipo_item: tipo,
    material_id: r.material_id != null ? Number(r.material_id) : null,
    producto_id: r.producto_id != null ? Number(r.producto_id) : null,
    item_nombre: tipo === "material" ? mat?.nombre : prod?.nombre,
    cantidad: Number(r.cantidad ?? 0),
    costo_unitario: Number(r.costo_unitario ?? 0),
    costo_total: Number(r.costo_total ?? 0),
    almacen_id: r.almacen_id != null ? Number(r.almacen_id) : null,
    localizacion_id: r.localizacion_id != null ? Number(r.localizacion_id) : null,
    notas: (r.notas as string) ?? null,
    fecha: String(r.fecha ?? ""),
    anulado_at: (r.anulado_at as string) ?? null,
    motivo_anulacion: (r.motivo_anulacion as string) ?? null,
    usuario: (r.usuario as string) ?? null,
  }
}

// ==================== ESCRITURA ====================

/** Recalcula costo_materiales_real / costo_total_real de la orden (best-effort). */
export async function recalcularCostoOrden(
  supabase: NonNullable<ReturnType<typeof createClient>>,
  ordenId: number
): Promise<ReturnType<typeof costoRealOrden> | null> {
  try {
    const [cons, corr, etapas] = await Promise.all([
      supabase.from("produccion_etapa_consumos").select("costo_total, anulado_at").eq("orden_id", ordenId),
      supabase.from("produccion_corridas").select("costo_materiales_total, costo_factores_total, estado").eq("orden_id", ordenId),
      supabase.from("produccion_orden_etapas").select("costo_mano_obra").eq("orden_id", ordenId),
    ])
    const costo = costoRealOrden({
      consumos: (cons.data || []) as { costo_total: number; anulado_at?: string | null }[],
      corridas: (corr.data || []) as { costo_materiales_total?: number | null; costo_factores_total?: number | null; estado?: string | null }[],
      manoObraEtapas: ((etapas.data || []) as { costo_mano_obra?: number | null }[]).map((e) => e.costo_mano_obra),
    })
    await supabase
      .from("produccion_ordenes")
      .update({ costo_materiales_real: costo.materiales, costo_total_real: costo.total, updated_at: new Date().toISOString() })
      .eq("id", ordenId)
    return costo
  } catch {
    return null
  }
}

export async function registrarConsumoEtapa(input: {
  orden_id: number
  etapa_id?: number | null
  items: ConsumoItemInput[]
}): Promise<{ data: { ids: number[]; total: number } | null; error: string | null }> {
  const supabase = createClient()
  if (!supabase) return { data: null, error: "Cliente no disponible" }
  const stamp = await getTenantStamp(supabase)
  if (!isValidStamp(stamp)) return { data: null, error: SESION_INVALIDA_ERROR }

  const items = input.items.filter((i) => (Number(i.cantidad) || 0) > 0)
  const matIds = [...new Set(items.filter((i) => i.tipo_item === "material" && i.material_id != null).map((i) => Number(i.material_id)))]
  const prodIds = [...new Set(items.filter((i) => i.tipo_item === "producto" && i.producto_id != null).map((i) => Number(i.producto_id)))]

  // Stock y costo vigentes (foto de costo).
  const stocks = new Map<string, { nombre: string; stock: number }>()
  const costos = new Map<string, number>()
  if (matIds.length > 0) {
    const { data } = await supabase.from("materiales").select("id, nombre, stock_total, costo_promedio").in("id", matIds)
    for (const m of (data || []) as { id: number; nombre: string; stock_total: number | null; costo_promedio: number | null }[]) {
      stocks.set(`material:${m.id}`, { nombre: m.nombre, stock: Number(m.stock_total || 0) })
      costos.set(`material:${m.id}`, Number(m.costo_promedio || 0))
    }
  }
  if (prodIds.length > 0) {
    const { data } = await supabase.from("productos").select("id, nombre, stock_total, costo_promedio").in("id", prodIds)
    for (const p of (data || []) as { id: number; nombre: string; stock_total: number | null; costo_promedio: number | null }[]) {
      stocks.set(`producto:${p.id}`, { nombre: p.nombre, stock: Number(p.stock_total || 0) })
      costos.set(`producto:${p.id}`, Number(p.costo_promedio || 0))
    }
  }
  const invalido = validarStockConsumo(items, stocks)
  if (invalido) return { data: null, error: invalido }

  const { data: orden } = await supabase.from("produccion_ordenes").select("id, estado").eq("id", input.orden_id).maybeSingle()
  if (!orden) return { data: null, error: "La orden no existe" }
  if (orden.estado === "Cancelada" || orden.estado === "Cerrada") return { data: null, error: `La orden está ${orden.estado}; no admite consumos.` }

  const fecha = getHondurasNowISO()
  const aplicados: { tipo: TipoItemConsumo; id: number; cantidad: number }[] = []
  const compensar = async () => {
    for (const a of aplicados) {
      if (a.tipo === "material") await matAjustarStock(supabase, a.id, a.cantidad)
      else await ajustarStock(supabase, a.id, a.cantidad)
    }
  }
  const ids: number[] = []
  let total = 0

  for (const it of items) {
    const id = it.tipo_item === "material" ? Number(it.material_id) : Number(it.producto_id)
    const clave = `${it.tipo_item}:${id}`
    const costoU = costos.get(clave) || 0
    const cantidad = Number(it.cantidad)
    const costoT = r2(cantidad * costoU)

    // 1) Descontar stock.
    if (it.tipo_item === "material") {
      const aj = await matAjustarStock(supabase, id, -cantidad)
      if (aj.error) { await compensar(); return { data: null, error: `No se pudo descontar material: ${aj.error}` } }
    } else {
      const aj = await ajustarStock(supabase, id, -cantidad, stamp.razon_social_id)
      if (aj.error) { await compensar(); return { data: null, error: `No se pudo descontar producto: ${aj.error}` } }
    }
    aplicados.push({ tipo: it.tipo_item, id, cantidad })

    // 2) Fila de consumo (si la tabla no existe: compensar y avisar).
    const { data: fila, error: cErr } = await supabase
      .from("produccion_etapa_consumos")
      .insert({
        orden_id: input.orden_id,
        etapa_id: input.etapa_id ?? null,
        tipo_item: it.tipo_item,
        material_id: it.tipo_item === "material" ? id : null,
        producto_id: it.tipo_item === "producto" ? id : null,
        cantidad,
        costo_unitario: +costoU.toFixed(4),
        costo_total: costoT,
        almacen_id: it.almacen_id ?? null,
        localizacion_id: it.localizacion_id ?? null,
        notas: it.notas?.trim() || null,
        fecha,
        ...stamp,
      })
      .select("id")
      .single()
    if (cErr) {
      await compensar()
      return { data: null, error: isMissingTable(cErr) ? CONSUMOS_FEATURE_PENDING : cErr.message }
    }
    const consumoId = Number(fila.id)
    ids.push(consumoId)
    total += costoT

    // 3) Movimiento / kardex (best-effort; no revierte el consumo).
    if (it.tipo_item === "material") {
      await supabase.from("materiales_movimientos").insert({
        material_id: id,
        almacen_id: null,
        localizacion_id: null,
        tipo_movimiento: "Consumo Etapa",
        cantidad: -cantidad,
        costo_unitario: costoU,
        referencia_id: input.orden_id,
        fecha,
        ...stamp,
      })
    } else {
      const base = {
        producto_id: id,
        almacen_id: it.almacen_id,
        localizacion_id: it.localizacion_id,
        costo_o_precio_unitario: costoU,
        referencia_id: input.orden_id,
        fecha,
        ...stamp,
      }
      let k = await supabase.from("transacciones_inventario").insert({ ...base, tipo_movimiento: "Salida Produccion", cantidad, referencia_tipo: "orden_produccion" })
      if (k.error && /referencia_tipo/i.test(k.error.message || "")) {
        k = await supabase.from("transacciones_inventario").insert({ ...base, tipo_movimiento: "Salida Produccion", cantidad })
      }
      if (k.error) {
        // Tipo no permitido por un CHECK: 'Ajuste' con cantidad negativa.
        await supabase.from("transacciones_inventario").insert({ ...base, tipo_movimiento: "Ajuste", cantidad: -cantidad })
      }
    }
  }

  await recalcularCostoOrden(supabase, input.orden_id)
  if (orden.estado === "Abierta") {
    await supabase.from("produccion_ordenes").update({ estado: "En Proceso", updated_at: new Date().toISOString() }).eq("id", input.orden_id)
  }
  await registrarAuditoria(supabase, stamp, { entidad: "orden_produccion", entidad_id: input.orden_id, accion: "consumo", despues: { etapa_id: input.etapa_id ?? null, items: ids.length, total: r2(total) } })
  return { data: { ids, total: r2(total) }, error: null }
}

/** Anula un consumo: devuelve el stock y marca la fila (no borra). */
export async function anularConsumo(id: number, motivo: string): Promise<{ error: string | null }> {
  const supabase = createClient()
  if (!supabase) return { error: "Cliente no disponible" }
  const stamp = await getTenantStamp(supabase)
  if (!isValidStamp(stamp)) return { error: SESION_INVALIDA_ERROR }
  const m = (motivo || "").trim()
  if (!m) return { error: "Indica el motivo." }
  const { data: c } = await supabase.from("produccion_etapa_consumos").select("*").eq("id", id).maybeSingle()
  if (!c) return { error: "El consumo no existe" }
  if (c.anulado_at) return { error: "El consumo ya está anulado" }
  const { data: marcado, error } = await supabase
    .from("produccion_etapa_consumos")
    .update({ anulado_at: new Date().toISOString(), motivo_anulacion: m })
    .eq("id", id)
    .is("anulado_at", null)
    .select("id")
  if (error) return { error: error.message }
  if (!marcado || marcado.length === 0) return { error: "El consumo ya estaba anulado" }

  const cantidad = Number(c.cantidad)
  const fecha = getHondurasNowISO()
  if (c.tipo_item === "material") {
    await matAjustarStock(supabase, Number(c.material_id), cantidad)
    await supabase.from("materiales_movimientos").insert({ material_id: c.material_id, almacen_id: null, localizacion_id: null, tipo_movimiento: "Anulacion Consumo", cantidad, costo_unitario: c.costo_unitario, referencia_id: c.orden_id, fecha, ...stamp })
  } else {
    await ajustarStock(supabase, Number(c.producto_id), cantidad, stamp.razon_social_id)
    const base = { producto_id: c.producto_id, almacen_id: c.almacen_id, localizacion_id: c.localizacion_id, costo_o_precio_unitario: c.costo_unitario, referencia_id: c.orden_id, fecha, ...stamp }
    let k = await supabase.from("transacciones_inventario").insert({ ...base, tipo_movimiento: "Entrada Anulacion", cantidad, referencia_tipo: "anulacion_consumo" })
    if (k.error && /referencia_tipo/i.test(k.error.message || "")) k = await supabase.from("transacciones_inventario").insert({ ...base, tipo_movimiento: "Entrada Anulacion", cantidad })
    if (k.error) await supabase.from("transacciones_inventario").insert({ ...base, tipo_movimiento: "Ingreso Manual", cantidad })
  }
  await recalcularCostoOrden(supabase, Number(c.orden_id))
  await registrarAuditoria(supabase, stamp, { entidad: "orden_produccion", entidad_id: Number(c.orden_id), accion: "anular_consumo", motivo: m, antes: c })
  return { error: null }
}

/** Declara la mano de obra de una etapa (se suma al costo real de la orden). */
export async function setManoObraEtapa(etapaId: number, ordenId: number, costo: number): Promise<{ error: string | null }> {
  const supabase = createClient()
  if (!supabase) return { error: "Cliente no disponible" }
  const { error } = await supabase
    .from("produccion_orden_etapas")
    .update({ costo_mano_obra: Math.max(0, r2(costo)), updated_at: new Date().toISOString() })
    .eq("id", etapaId)
  if (error) return { error: /costo_mano_obra/i.test(error.message || "") ? CONSUMOS_FEATURE_PENDING : error.message }
  await recalcularCostoOrden(supabase, ordenId)
  return { error: null }
}
