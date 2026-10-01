import * as XLSX from "xlsx"
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client"
import { getTenantStamp, isValidStamp, SESION_INVALIDA_ERROR } from "@/lib/services/tenant-stamp"
import { registrarAuditoria } from "@/lib/services/auditoria"
import { procesarAjusteInventario, type AjusteLineaInput } from "@/lib/services/inventario"
import { getHondurasNowISO } from "@/lib/utils/honduras-time"
import { adjuntarRelacion } from "@/lib/services/relaciones"

/**
 * Toma física de inventario con congelamiento (script officemart-013).
 *   abrirToma  → fotografía el stock por localización del almacén y lo
 *                congela (inventario_congelado(almacen) = true).
 *   conteo     → a mano, por lector de barras o importando un Excel.
 *   cerrarToma → pasa a 'Cerrada' y aplica los ajustes por diferencia con
 *                `procesarAjusteInventario` (kardex 'Ajuste', motivo
 *                "Toma física #N"); `permitirCongelado` salta el candado.
 * Ventas, recepciones, traslados, ajustes y consumos preguntan
 * `assertInventarioNoCongelado` antes de mover stock.
 */

export const TOMA_FEATURE_PENDING =
  "Toma física pendiente: aplica scripts/officemart-013-toma-fisica.sql en Supabase."

// El candado vive en inventario-candado.ts (sin dependencias) para que los
// demás servicios lo importen sin ciclos; aquí se re-exporta por comodidad.
export {
  INVENTARIO_CONGELADO_MSG,
  esErrorInventarioCongelado,
  traducirErrorInventario,
  assertInventarioNoCongelado,
} from "@/lib/services/inventario-candado"

export type EstadoToma = "Abierta" | "Cerrada" | "Cancelada"

export interface TomaFisica {
  id: number
  almacen_id: number
  almacen_nombre?: string
  estado: EstadoToma
  fecha_congelacion: string
  fecha_cierre: string | null
  notas: string | null
  total_faltante: number | null
  total_sobrante: number | null
  lineas_ajustadas: number | null
  usuario: string | null
  cerrada_por: string | null
  created_at: string
}

export interface TomaDetalle {
  id: number
  toma_id: number
  producto_id: number
  producto_nombre: string
  producto_codigo: string | null
  localizacion_id: number
  localizacion_nombre: string
  stock_sistema: number
  conteo: number | null
  diferencia: number | null
  costo_unitario: number
  contado_por: string | null
}

function r2(n: number): number {
  return +(Number(n) || 0).toFixed(2)
}

function isMissingTable(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false
  const msg = (err.message || "").toLowerCase()
  return err.code === "42P01" || err.code === "PGRST205" || (msg.includes("schema cache") && !msg.includes("relationship")) || /relation .* does not exist/.test(msg)
}

// ==================== FUNCIONES PURAS ====================

export interface ResumenToma {
  lineas: number
  contadas: number
  sinContar: number
  conDiferencia: number
  faltanteUnidades: number
  sobranteUnidades: number
  faltanteValor: number
  sobranteValor: number
  netoValor: number
}

/** Resumen de una toma: lo contado, diferencias y valor (pura). */
export function calcularResumenToma(detalle: Pick<TomaDetalle, "stock_sistema" | "conteo" | "costo_unitario">[]): ResumenToma {
  const r: ResumenToma = { lineas: detalle.length, contadas: 0, sinContar: 0, conDiferencia: 0, faltanteUnidades: 0, sobranteUnidades: 0, faltanteValor: 0, sobranteValor: 0, netoValor: 0 }
  for (const d of detalle) {
    if (d.conteo == null) {
      r.sinContar += 1
      continue
    }
    r.contadas += 1
    const dif = +(Number(d.conteo) - Number(d.stock_sistema)).toFixed(4)
    if (dif === 0) continue
    r.conDiferencia += 1
    const valor = dif * (Number(d.costo_unitario) || 0)
    if (dif < 0) {
      r.faltanteUnidades += -dif
      r.faltanteValor += -valor
    } else {
      r.sobranteUnidades += dif
      r.sobranteValor += valor
    }
  }
  r.faltanteUnidades = r2(r.faltanteUnidades)
  r.sobranteUnidades = r2(r.sobranteUnidades)
  r.faltanteValor = r2(r.faltanteValor)
  r.sobranteValor = r2(r.sobranteValor)
  r.netoValor = r2(r.sobranteValor - r.faltanteValor)
  return r
}

function normTexto(s: unknown): string {
  return String(s ?? "").trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[\s_]+/g, " ")
}

/**
 * Empareja filas importadas (Código | Producto, Localización, Conteo) con el
 * detalle de la toma. Devuelve las actualizaciones y las filas no reconocidas.
 * Si la localización viene vacía y el producto está en una sola localización,
 * se usa esa. Pura.
 */
export function mapearConteosImportados(
  filas: { codigo?: string; producto?: string; localizacion?: string; conteo: number | null }[],
  detalle: Pick<TomaDetalle, "id" | "producto_codigo" | "producto_nombre" | "localizacion_nombre">[]
): { actualizaciones: { detalle_id: number; conteo: number }[]; noReconocidas: number; sinConteo: number } {
  const out: { detalle_id: number; conteo: number }[] = []
  let noReconocidas = 0
  let sinConteo = 0
  for (const f of filas) {
    if (f.conteo == null || Number.isNaN(f.conteo)) {
      sinConteo += 1
      continue
    }
    const cod = normTexto(f.codigo)
    const nom = normTexto(f.producto)
    const loc = normTexto(f.localizacion)
    let cands = detalle.filter((d) => (cod && normTexto(d.producto_codigo) === cod) || (!cod && nom && normTexto(d.producto_nombre) === nom))
    if (loc) cands = cands.filter((d) => normTexto(d.localizacion_nombre) === loc)
    if (cands.length !== 1) {
      noReconocidas += 1
      continue
    }
    out.push({ detalle_id: cands[0].id, conteo: Math.max(0, Number(f.conteo)) })
  }
  return { actualizaciones: out, noReconocidas, sinConteo }
}

// ==================== LECTURA ====================

function normToma(r: Record<string, unknown>): TomaFisica {
  const alm = Array.isArray(r.almacenes) ? r.almacenes[0] : r.almacenes
  return {
    id: Number(r.id),
    almacen_id: Number(r.almacen_id),
    almacen_nombre: (alm as { nombre?: string } | null)?.nombre,
    estado: (r.estado as EstadoToma) ?? "Abierta",
    fecha_congelacion: String(r.fecha_congelacion ?? ""),
    fecha_cierre: (r.fecha_cierre as string) ?? null,
    notas: (r.notas as string) ?? null,
    total_faltante: r.total_faltante != null ? Number(r.total_faltante) : null,
    total_sobrante: r.total_sobrante != null ? Number(r.total_sobrante) : null,
    lineas_ajustadas: r.lineas_ajustadas != null ? Number(r.lineas_ajustadas) : null,
    usuario: (r.usuario as string) ?? null,
    cerrada_por: (r.cerrada_por as string) ?? null,
    created_at: String(r.created_at ?? ""),
  }
}

export async function getTomas(): Promise<{ data: TomaFisica[]; error: string | null; pendiente: boolean }> {
  if (!isSupabaseConfigured()) return { data: [], error: null, pendiente: false }
  const supabase = createClient()
  if (!supabase) return { data: [], error: "Cliente no disponible", pendiente: false }
  const res = await supabase.from("tomas_fisicas").select("*").order("created_at", { ascending: false }).limit(200)
  if (res.error) {
    if (isMissingTable(res.error)) return { data: [], error: null, pendiente: true }
    return { data: [], error: res.error.message, pendiente: false }
  }
  const conAlmacen = await adjuntarRelacion(supabase, (res.data || []) as Record<string, unknown>[], { campo: "almacen_id", tabla: "almacenes", columnas: "nombre", como: "almacenes" })
  return { data: conAlmacen.map((r) => normToma(r)), error: null, pendiente: false }
}

export async function getTomaDetalle(tomaId: number): Promise<{ data: TomaDetalle[]; error: string | null }> {
  if (!isSupabaseConfigured()) return { data: [], error: null }
  const supabase = createClient()
  if (!supabase) return { data: [], error: "Cliente no disponible" }
  const { data, error } = await supabase.from("tomas_fisicas_detalle").select("*").eq("toma_id", tomaId)
  if (error) return { data: [], error: error.message }
  const filas = (data || []) as Record<string, unknown>[]
  const prodIds = [...new Set(filas.map((f) => Number(f.producto_id)))]
  const locIds = [...new Set(filas.map((f) => Number(f.localizacion_id)))]
  const prod = new Map<number, { nombre: string; codigo: string | null }>()
  for (let i = 0; i < prodIds.length; i += 300) {
    const { data: ps } = await supabase.from("productos").select("id, nombre, codigo_barras").in("id", prodIds.slice(i, i + 300))
    for (const p of (ps || []) as { id: number; nombre: string; codigo_barras: string | null }[]) prod.set(p.id, { nombre: p.nombre, codigo: p.codigo_barras })
  }
  const loc = new Map<number, string>()
  if (locIds.length > 0) {
    const { data: ls } = await supabase.from("localizaciones").select("id, nombre").in("id", locIds)
    for (const l of (ls || []) as { id: number; nombre: string }[]) loc.set(l.id, l.nombre)
  }
  const out: TomaDetalle[] = filas.map((f) => ({
    id: Number(f.id),
    toma_id: Number(f.toma_id),
    producto_id: Number(f.producto_id),
    producto_nombre: prod.get(Number(f.producto_id))?.nombre || `#${f.producto_id}`,
    producto_codigo: prod.get(Number(f.producto_id))?.codigo ?? null,
    localizacion_id: Number(f.localizacion_id),
    localizacion_nombre: loc.get(Number(f.localizacion_id)) || `#${f.localizacion_id}`,
    stock_sistema: Number(f.stock_sistema ?? 0),
    conteo: f.conteo != null ? Number(f.conteo) : null,
    diferencia: f.diferencia != null ? Number(f.diferencia) : null,
    costo_unitario: Number(f.costo_unitario ?? 0),
    contado_por: (f.contado_por as string) ?? null,
  }))
  out.sort((a, b) => a.localizacion_nombre.localeCompare(b.localizacion_nombre) || a.producto_nombre.localeCompare(b.producto_nombre))
  return { data: out, error: null }
}

// ==================== ESCRITURA ====================

export async function abrirToma(almacenId: number, notas?: string | null): Promise<{ data: { id: number; lineas: number } | null; error: string | null }> {
  const supabase = createClient()
  if (!supabase) return { data: null, error: "Cliente no disponible" }
  const stamp = await getTenantStamp(supabase)
  if (!isValidStamp(stamp)) return { data: null, error: SESION_INVALIDA_ERROR }

  const { data: abierta } = await supabase.from("tomas_fisicas").select("id").eq("almacen_id", almacenId).eq("estado", "Abierta").maybeSingle()
  if (abierta) return { data: null, error: `El almacén ya tiene la toma #${abierta.id} abierta.` }

  // Foto del stock por localización del almacén (solo con existencias ≠ 0) + costo.
  const { data: stock, error: sErr } = await supabase.from("vista_stock_por_localizacion").select("producto_id, localizacion_id, stock_actual").eq("almacen_id", almacenId)
  if (sErr) return { data: null, error: sErr.message }
  const filas = ((stock || []) as { producto_id: number; localizacion_id: number; stock_actual: number }[]).filter((s) => Number(s.stock_actual) !== 0)
  const prodIds = [...new Set(filas.map((f) => Number(f.producto_id)))]
  const costos = new Map<number, number>()
  for (let i = 0; i < prodIds.length; i += 300) {
    const { data: ps } = await supabase.from("productos").select("id, costo_promedio").in("id", prodIds.slice(i, i + 300))
    for (const p of (ps || []) as { id: number; costo_promedio: number | null }[]) costos.set(p.id, Number(p.costo_promedio || 0))
  }

  const { data: toma, error } = await supabase
    .from("tomas_fisicas")
    .insert({ almacen_id: almacenId, estado: "Abierta", fecha_congelacion: getHondurasNowISO(), notas: notas?.trim() || null, ...stamp })
    .select("id")
    .single()
  if (error) return { data: null, error: isMissingTable(error) ? TOMA_FEATURE_PENDING : error.message }
  const tomaId = Number(toma.id)
  for (let i = 0; i < filas.length; i += 500) {
    const { error: dErr } = await supabase.from("tomas_fisicas_detalle").insert(
      filas.slice(i, i + 500).map((f) => ({
        razon_social_id: stamp.razon_social_id,
        toma_id: tomaId,
        producto_id: Number(f.producto_id),
        localizacion_id: Number(f.localizacion_id),
        stock_sistema: Number(f.stock_actual),
        costo_unitario: costos.get(Number(f.producto_id)) || 0,
      }))
    )
    if (dErr) {
      await supabase.from("tomas_fisicas").delete().eq("id", tomaId)
      return { data: null, error: dErr.message }
    }
  }
  await registrarAuditoria(supabase, stamp, { entidad: "toma_fisica", entidad_id: tomaId, accion: "abrir", despues: { almacen_id: almacenId, lineas: filas.length } })
  return { data: { id: tomaId, lineas: filas.length }, error: null }
}

/** Agrega al detalle un producto que no tenía stock en el sistema (sobrante puro). */
export async function agregarLineaToma(tomaId: number, productoId: number, localizacionId: number): Promise<{ error: string | null }> {
  const supabase = createClient()
  if (!supabase) return { error: "Cliente no disponible" }
  const stamp = await getTenantStamp(supabase)
  if (!isValidStamp(stamp)) return { error: SESION_INVALIDA_ERROR }
  const { data: p } = await supabase.from("productos").select("costo_promedio").eq("id", productoId).maybeSingle()
  const { error } = await supabase.from("tomas_fisicas_detalle").insert({ razon_social_id: stamp.razon_social_id, toma_id: tomaId, producto_id: productoId, localizacion_id: localizacionId, stock_sistema: 0, costo_unitario: Number(p?.costo_promedio || 0) })
  if (error) return { error: error.code === "23505" ? "Ese producto ya está en la toma en esa localización." : error.message }
  return { error: null }
}

export async function registrarConteo(items: { detalle_id: number; conteo: number | null; contado_por?: string | null }[]): Promise<{ error: string | null }> {
  const supabase = createClient()
  if (!supabase) return { error: "Cliente no disponible" }
  for (const it of items) {
    const { data: d } = await supabase.from("tomas_fisicas_detalle").select("stock_sistema").eq("id", it.detalle_id).maybeSingle()
    const dif = it.conteo == null ? null : +(Number(it.conteo) - Number(d?.stock_sistema || 0)).toFixed(4)
    const { error } = await supabase
      .from("tomas_fisicas_detalle")
      .update({ conteo: it.conteo, diferencia: dif, contado_por: it.contado_por?.trim() || null, updated_at: new Date().toISOString() })
      .eq("id", it.detalle_id)
    if (error) return { error: error.message }
  }
  return { error: null }
}

/** Lee un Excel de conteos: columnas Código/Codigo de Barras, Producto, Localización, Conteo. */
export async function parsearConteosXlsx(file: File): Promise<{ codigo?: string; producto?: string; localizacion?: string; conteo: number | null }[]> {
  const buffer = await file.arrayBuffer()
  const wb = XLSX.read(buffer, { type: "array" })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" })
  const col = (row: Record<string, unknown>, alias: string[]) => {
    const keys = Object.keys(row)
    for (const a of alias) {
      const k = keys.find((x) => normTexto(x) === normTexto(a))
      if (k != null) return row[k]
    }
    return undefined
  }
  return rows.map((row) => {
    const conteoRaw = col(row, ["Conteo", "Contado", "Cantidad", "Fisico", "Físico"])
    const conteo = conteoRaw === "" || conteoRaw == null ? null : Number(conteoRaw)
    return {
      codigo: String(col(row, ["Codigo", "Código", "Codigo de Barras", "Código de Barras", "SKU"]) ?? "").trim() || undefined,
      producto: String(col(row, ["Producto", "Nombre"]) ?? "").trim() || undefined,
      localizacion: String(col(row, ["Localizacion", "Localización", "Ubicacion", "Ubicación"]) ?? "").trim() || undefined,
      conteo: conteo != null && Number.isNaN(conteo) ? null : conteo,
    }
  })
}

/** Cierra la toma: marca 'Cerrada' y aplica los ajustes por diferencia (líneas contadas). */
export async function cerrarToma(tomaId: number, opts: { ajustarNoContadas?: boolean } = {}): Promise<{ data: { ajustadas: number; resumen: ResumenToma } | null; error: string | null }> {
  const supabase = createClient()
  if (!supabase) return { data: null, error: "Cliente no disponible" }
  const stamp = await getTenantStamp(supabase)
  if (!isValidStamp(stamp)) return { data: null, error: SESION_INVALIDA_ERROR }
  const { data: toma } = await supabase.from("tomas_fisicas").select("id, almacen_id, estado").eq("id", tomaId).maybeSingle()
  if (!toma) return { data: null, error: "La toma no existe" }
  if (toma.estado !== "Abierta") return { data: null, error: `La toma está ${toma.estado}.` }
  const { data: detalle, error: dErr } = await getTomaDetalle(tomaId)
  if (dErr) return { data: null, error: dErr }

  const aAjustar = detalle.filter((d) => (d.conteo != null || opts.ajustarNoContadas) && +(Number(d.conteo ?? 0) - d.stock_sistema).toFixed(4) !== 0)
  const resumen = calcularResumenToma(opts.ajustarNoContadas ? detalle.map((d) => ({ ...d, conteo: d.conteo ?? 0 })) : detalle)

  // 1) Cerrar PRIMERO (levanta el candado del trigger) — idempotente.
  const { data: cerrada, error: cErr } = await supabase
    .from("tomas_fisicas")
    .update({ estado: "Cerrada", fecha_cierre: getHondurasNowISO(), total_faltante: resumen.faltanteValor, total_sobrante: resumen.sobranteValor, lineas_ajustadas: aAjustar.length, cerrada_por: stamp.usuario })
    .eq("id", tomaId)
    .eq("estado", "Abierta")
    .select("id")
  if (cErr) return { data: null, error: cErr.message }
  if (!cerrada || cerrada.length === 0) return { data: null, error: "La toma ya fue cerrada por otro usuario." }

  // 2) Ajustes por diferencia.
  let ajustadas = 0
  if (aAjustar.length > 0) {
    const lineas: AjusteLineaInput[] = aAjustar.map((d) => ({
      producto_id: d.producto_id,
      almacen_id: Number(toma.almacen_id),
      localizacion_id: d.localizacion_id,
      stock_actual: d.stock_sistema,
      stock_real: Number(d.conteo ?? 0),
      costo_unitario: d.costo_unitario,
      producto_nombre: d.producto_nombre,
    }))
    const res = await procesarAjusteInventario(lineas, `Toma física #${tomaId}`, { permitirCongelado: true })
    ajustadas = res.procesados
    if (!res.success) {
      await registrarAuditoria(supabase, stamp, { entidad: "toma_fisica", entidad_id: tomaId, accion: "cierre_incompleto", motivo: res.error || undefined, despues: { ajustadas } })
      return { data: { ajustadas, resumen }, error: `Toma cerrada, pero el ajuste falló en la línea ${ajustadas + 1}: ${res.error}. Completa el resto desde Ajustes de Inventario.` }
    }
  }
  await registrarAuditoria(supabase, stamp, { entidad: "toma_fisica", entidad_id: tomaId, accion: "cerrar", despues: { ajustadas, faltante: resumen.faltanteValor, sobrante: resumen.sobranteValor } })
  return { data: { ajustadas, resumen }, error: null }
}

export async function cancelarToma(tomaId: number, motivo: string): Promise<{ error: string | null }> {
  const supabase = createClient()
  if (!supabase) return { error: "Cliente no disponible" }
  const stamp = await getTenantStamp(supabase)
  if (!isValidStamp(stamp)) return { error: SESION_INVALIDA_ERROR }
  const { error } = await supabase.from("tomas_fisicas").update({ estado: "Cancelada", fecha_cierre: getHondurasNowISO(), notas: motivo, cerrada_por: stamp.usuario }).eq("id", tomaId).eq("estado", "Abierta")
  if (error) return { error: error.message }
  await registrarAuditoria(supabase, stamp, { entidad: "toma_fisica", entidad_id: tomaId, accion: "cancelar", motivo })
  return { error: null }
}
