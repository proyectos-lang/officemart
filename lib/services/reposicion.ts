import { createClient, isSupabaseConfigured } from "@/lib/supabase/client"
import { getTenantStamp, isValidStamp, SESION_INVALIDA_ERROR } from "@/lib/services/tenant-stamp"
import { createCompra } from "@/lib/services/compras"
import { getHondurasTodayISODate } from "@/lib/utils/honduras-time"

/**
 * Reposición / reorden (Fase 3.3, script officemart-009): mínimos y punto de
 * reorden por producto (`productos_reorden`), venta diaria de los últimos 90
 * días, cobertura en días, lead time real (recepciones vs. fecha de orden) y
 * cantidad sugerida de compra (`calcularSugerido`, pura). Puede crear una OC
 * en borrador (Pendiente) con lo sugerido.
 */

export const REPOSICION_FEATURE_PENDING =
  "Reposición pendiente: aplica scripts/officemart-009-reorden-reportes-compras.sql en Supabase."

export interface ReordenConfig {
  id?: number
  producto_id: number
  almacen_id: number | null
  stock_minimo: number
  punto_reorden: number
  cantidad_sugerida: number | null
}

export interface FilaReposicion {
  producto_id: number
  nombre: string
  codigo: string | null
  categoria_nombre: string | null
  stock: number
  costo_promedio: number
  stock_minimo: number
  punto_reorden: number
  cantidad_sugerida_fija: number | null
  /** Unidades vendidas en los últimos 90 días. */
  vendido_90d: number
  venta_diaria: number
  /** Días de stock al ritmo actual (null si no vende). */
  cobertura_dias: number | null
  lead_time_dias: number | null
  /** Sugerido de compra (0 = no hace falta). */
  sugerido: number
  /** 'Sin stock' | 'Bajo mínimo' | 'Reordenar' | 'OK' */
  estado: EstadoReposicion
  /** Unidades en tránsito (OC pendientes). */
  en_transito: number
}

export type EstadoReposicion = "Sin stock" | "Bajo mínimo" | "Reordenar" | "OK"

function r2(n: number): number {
  return +(Number(n) || 0).toFixed(2)
}

// ==================== FUNCIONES PURAS ====================

/** Días de cobertura = stock / venta diaria (null si no hay venta). */
export function calcularCobertura(stock: number, ventaDiaria: number): number | null {
  const v = Number(ventaDiaria) || 0
  if (v <= 0) return null
  return Math.max(0, Math.round((Number(stock) || 0) / v))
}

/**
 * Cantidad sugerida de compra. Reglas:
 *   - objetivo = max(punto_reorden, venta_diaria × (lead_time + 7 días de colchón), stock_minimo × 2)
 *   - sugerido = objetivo − (stock + en_transito), nunca negativo; si hay lote
 *     fijo (`cantidad_sugerida`), se redondea hacia arriba a múltiplos de él.
 *   - solo se sugiere si el producto está en o bajo el punto de reorden / mínimo
 *     o su cobertura no alcanza el lead time.
 */
export function calcularSugerido(p: {
  stock: number
  en_transito?: number
  stock_minimo: number
  punto_reorden: number
  cantidad_sugerida?: number | null
  venta_diaria: number
  lead_time_dias?: number | null
}): number {
  const stock = Math.max(0, Number(p.stock) || 0)
  const transito = Math.max(0, Number(p.en_transito) || 0)
  const minimo = Math.max(0, Number(p.stock_minimo) || 0)
  const reorden = Math.max(0, Number(p.punto_reorden) || 0)
  const vd = Math.max(0, Number(p.venta_diaria) || 0)
  const lead = Math.max(0, Number(p.lead_time_dias ?? 0) || 0)
  const cobertura = calcularCobertura(stock + transito, vd)
  const necesita =
    (reorden > 0 && stock <= reorden) ||
    (minimo > 0 && stock <= minimo) ||
    (cobertura != null && lead > 0 && cobertura < lead + 7)
  if (!necesita) return 0
  const objetivo = Math.max(reorden, vd * (lead + 7), minimo * 2)
  let sugerido = objetivo - (stock + transito)
  if (sugerido <= 0) return 0
  const lote = Number(p.cantidad_sugerida) || 0
  if (lote > 0) sugerido = Math.ceil(sugerido / lote) * lote
  return Math.ceil(sugerido)
}

export function estadoReposicion(p: { stock: number; stock_minimo: number; punto_reorden: number; sugerido: number }): EstadoReposicion {
  if ((Number(p.stock) || 0) <= 0) return "Sin stock"
  if (p.stock_minimo > 0 && p.stock <= p.stock_minimo) return "Bajo mínimo"
  if (p.sugerido > 0) return "Reordenar"
  return "OK"
}

// ==================== CONFIG ====================

export async function getReordenes(): Promise<{ data: ReordenConfig[]; error: string | null; pendiente: boolean }> {
  if (!isSupabaseConfigured()) return { data: [], error: null, pendiente: false }
  const supabase = createClient()
  if (!supabase) return { data: [], error: "Cliente no disponible", pendiente: false }
  const { data, error } = await supabase.from("productos_reorden").select("*")
  if (error) {
    const msg = (error.message || "").toLowerCase()
    if (error.code === "42P01" || error.code === "PGRST205" || msg.includes("schema cache") || /does not exist/.test(msg)) return { data: [], error: null, pendiente: true }
    return { data: [], error: error.message, pendiente: false }
  }
  return {
    data: (data || []).map((r: Record<string, unknown>) => ({
      id: Number(r.id),
      producto_id: Number(r.producto_id),
      almacen_id: r.almacen_id != null ? Number(r.almacen_id) : null,
      stock_minimo: Number(r.stock_minimo ?? 0),
      punto_reorden: Number(r.punto_reorden ?? 0),
      cantidad_sugerida: r.cantidad_sugerida != null ? Number(r.cantidad_sugerida) : null,
    })),
    error: null,
    pendiente: false,
  }
}

export async function saveReorden(cfg: ReordenConfig): Promise<{ error: string | null }> {
  const supabase = createClient()
  if (!supabase) return { error: "Cliente no disponible" }
  const stamp = await getTenantStamp(supabase)
  if (!isValidStamp(stamp)) return { error: SESION_INVALIDA_ERROR }
  const fila = {
    stock_minimo: Math.max(0, Number(cfg.stock_minimo) || 0),
    punto_reorden: Math.max(0, Number(cfg.punto_reorden) || 0),
    cantidad_sugerida: cfg.cantidad_sugerida != null && cfg.cantidad_sugerida > 0 ? cfg.cantidad_sugerida : null,
    updated_at: new Date().toISOString(),
  }
  let q = supabase.from("productos_reorden").select("id").eq("producto_id", cfg.producto_id)
  q = cfg.almacen_id == null ? q.is("almacen_id", null) : q.eq("almacen_id", cfg.almacen_id)
  const { data: existente, error: selErr } = await q.maybeSingle()
  if (selErr) {
    const msg = (selErr.message || "").toLowerCase()
    if (selErr.code === "42P01" || msg.includes("schema cache") || /does not exist/.test(msg)) return { error: REPOSICION_FEATURE_PENDING }
    return { error: selErr.message }
  }
  if (existente?.id != null) {
    const { error } = await supabase.from("productos_reorden").update(fila).eq("id", existente.id)
    return { error: error ? error.message : null }
  }
  const { error } = await supabase.from("productos_reorden").insert({ producto_id: cfg.producto_id, almacen_id: cfg.almacen_id ?? null, ...fila, ...stamp })
  return { error: error ? error.message : null }
}

// ==================== CÁLCULO ====================

export async function getReposicion(hoyISO: string = getHondurasTodayISODate()): Promise<{ data: FilaReposicion[]; error: string | null; pendiente: boolean }> {
  if (!isSupabaseConfigured()) return { data: [], error: null, pendiente: false }
  const supabase = createClient()
  if (!supabase) return { data: [], error: "Cliente no disponible", pendiente: false }
  try {
    const desde90 = new Date(`${hoyISO}T00:00:00Z`)
    desde90.setUTCDate(desde90.getUTCDate() - 90)
    const desdeISO = desde90.toISOString().slice(0, 10)

    const [prodRes, reordRes, catRes, ventasRes, ocRes] = await Promise.all([
      supabase.from("productos").select("id, nombre, codigo_barras, categoria_id, stock_total, costo_promedio"),
      getReordenes(),
      supabase.from("categorias").select("id, nombre"),
      // Ventas vigentes de los últimos 90 días (líneas).
      supabase
        .from("ventas_detalle")
        .select("producto_id, cantidad, ventas_encabezado!inner (fecha_venta, anulada_at)")
        .gte("ventas_encabezado.fecha_venta", `${desdeISO}T00:00:00`)
        .is("ventas_encabezado.anulada_at", null),
      // OC pendientes (en tránsito) + lead time real.
      supabase.from("compras_encabezado").select("id, fecha_orden, estado").neq("estado", "Cancelada"),
    ])
    if (prodRes.error) return { data: [], error: prodRes.error.message, pendiente: false }

    // Ventas: si el filtro embebido falla (columna anulada_at ausente), reintento sin él.
    let ventasRows = ventasRes.data as Record<string, unknown>[] | null
    if (ventasRes.error) {
      const retry = await supabase
        .from("ventas_detalle")
        .select("producto_id, cantidad, ventas_encabezado!inner (fecha_venta)")
        .gte("ventas_encabezado.fecha_venta", `${desdeISO}T00:00:00`)
      ventasRows = (retry.data || []) as Record<string, unknown>[]
    }
    const vendido = new Map<number, number>()
    for (const v of ventasRows || []) {
      const pid = Number(v.producto_id)
      vendido.set(pid, (vendido.get(pid) || 0) + Number(v.cantidad || 0))
    }

    // En tránsito y lead time por producto (desde OCs y recepciones).
    const ocs = (ocRes.data || []) as { id: number; fecha_orden: string | null; estado: string }[]
    const ocIds = ocs.map((o) => o.id)
    const transito = new Map<number, number>()
    const leads = new Map<number, number[]>()
    if (ocIds.length > 0) {
      const [detRes, recRes] = await Promise.all([
        supabase.from("compras_detalle").select("compra_id, producto_id, cantidad, cantidad_recibida").in("compra_id", ocIds),
        supabase.from("compras_recepciones").select("compra_id, fecha").in("compra_id", ocIds),
      ])
      const primeraRec = new Map<number, string>()
      for (const r of (recRes.error ? [] : recRes.data || []) as { compra_id: number; fecha: string }[]) {
        const prev = primeraRec.get(r.compra_id)
        if (!prev || r.fecha < prev) primeraRec.set(r.compra_id, r.fecha)
      }
      const ocPorId = new Map(ocs.map((o) => [o.id, o]))
      for (const d of (detRes.data || []) as { compra_id: number; producto_id: number; cantidad: number; cantidad_recibida: number | null }[]) {
        const oc = ocPorId.get(d.compra_id)
        if (!oc) continue
        if (oc.estado === "Pendiente") {
          const pend = Math.max(0, Number(d.cantidad || 0) - Number(d.cantidad_recibida || 0))
          transito.set(d.producto_id, (transito.get(d.producto_id) || 0) + pend)
        }
        const rec = primeraRec.get(d.compra_id)
        if (rec && oc.fecha_orden) {
          const a = new Date(`${oc.fecha_orden.slice(0, 10)}T00:00:00Z`).getTime()
          const b = new Date(`${rec.slice(0, 10)}T00:00:00Z`).getTime()
          if (!Number.isNaN(a) && !Number.isNaN(b)) {
            const l = leads.get(d.producto_id) || []
            l.push(Math.max(0, Math.round((b - a) / 86_400_000)))
            leads.set(d.producto_id, l)
          }
        }
      }
    }

    const cat = new Map<number, string>()
    for (const c of (catRes.data || []) as { id: number; nombre: string }[]) cat.set(c.id, c.nombre)
    const cfgGlobal = new Map<number, ReordenConfig>()
    for (const r of reordRes.data) if (r.almacen_id == null) cfgGlobal.set(r.producto_id, r)

    const out: FilaReposicion[] = []
    for (const p of (prodRes.data || []) as Record<string, unknown>[]) {
      const id = Number(p.id)
      const cfg = cfgGlobal.get(id)
      const stock = Number(p.stock_total || 0)
      const v90 = vendido.get(id) || 0
      const vd = r2(v90 / 90)
      const ls = leads.get(id)
      const lead = ls && ls.length > 0 ? Math.round(ls.reduce((a, b) => a + b, 0) / ls.length) : null
      const enTransito = transito.get(id) || 0
      const sugerido = calcularSugerido({
        stock,
        en_transito: enTransito,
        stock_minimo: cfg?.stock_minimo ?? 0,
        punto_reorden: cfg?.punto_reorden ?? 0,
        cantidad_sugerida: cfg?.cantidad_sugerida ?? null,
        venta_diaria: vd,
        lead_time_dias: lead,
      })
      out.push({
        producto_id: id,
        nombre: String(p.nombre ?? ""),
        codigo: (p.codigo_barras as string) ?? null,
        categoria_nombre: p.categoria_id != null ? cat.get(Number(p.categoria_id)) ?? null : null,
        stock,
        costo_promedio: Number(p.costo_promedio || 0),
        stock_minimo: cfg?.stock_minimo ?? 0,
        punto_reorden: cfg?.punto_reorden ?? 0,
        cantidad_sugerida_fija: cfg?.cantidad_sugerida ?? null,
        vendido_90d: r2(v90),
        venta_diaria: vd,
        cobertura_dias: calcularCobertura(stock, vd),
        lead_time_dias: lead,
        sugerido,
        estado: estadoReposicion({ stock, stock_minimo: cfg?.stock_minimo ?? 0, punto_reorden: cfg?.punto_reorden ?? 0, sugerido }),
        en_transito: enTransito,
      })
    }
    const orden: Record<EstadoReposicion, number> = { "Sin stock": 0, "Bajo mínimo": 1, Reordenar: 2, OK: 3 }
    out.sort((a, b) => orden[a.estado] - orden[b.estado] || b.sugerido - a.sugerido || a.nombre.localeCompare(b.nombre))
    return { data: out, error: null, pendiente: reordRes.pendiente }
  } catch (err) {
    console.error("[reposicion] get:", err)
    return { data: [], error: "Error de conexión", pendiente: false }
  }
}

/** Crea una OC en Pendiente con las líneas sugeridas (costo = costo promedio actual). */
export async function crearOCBorradorDesdeReposicion(
  proveedorId: number,
  items: { producto_id: number; cantidad: number; costo: number }[],
  fechaTentativa: string
): Promise<{ compraId: number | null; error: string | null }> {
  const lineas = items.filter((i) => i.cantidad > 0)
  if (lineas.length === 0) return { compraId: null, error: "No hay líneas con cantidad." }
  const { data, error } = await createCompra(
    {
      proveedor_id: proveedorId,
      fecha_tentativa: fechaTentativa,
      moneda: "LPS",
      tasa_cambio: 1,
      costos_importacion: 0,
      impuestos_compra: 0,
      otros_costos: 0,
      total_compra_local: 0,
      subtotal: r2(lineas.reduce((a, l) => a + l.cantidad * l.costo, 0)),
      total: r2(lineas.reduce((a, l) => a + l.cantidad * l.costo, 0)),
      estado: "Pendiente",
    },
    lineas.map((l) => ({ producto_id: l.producto_id, cantidad: l.cantidad, cantidad_recibida: 0, costo_unitario_moneda_origen: l.costo, costo_final_local: 0 }))
  )
  if (error || !data?.id) return { compraId: null, error: error || "No se pudo crear la orden" }
  return { compraId: data.id, error: null }
}
