import { createClient, isSupabaseConfigured } from "@/lib/supabase/client"
import { getTenantStamp, isValidStamp, SESION_INVALIDA_ERROR } from "@/lib/services/tenant-stamp"

// ==================== TIPOS ====================

export type TipoLista = "porcentaje" | "individual"

export interface ListaPrecio {
  id: number
  nombre: string
  tipo: TipoLista
  /** Ajuste % sobre el precio base (solo tipo 'porcentaje'). Negativo = descuento. */
  porcentaje: number
  activo: boolean
}

/** Marca la ausencia de las tablas (script 042 sin aplicar). */
export const LISTAS_FEATURE_PENDING =
  "Funcion de listas de precios pendiente: aplica scripts/042-listas-precios.sql en Supabase."

/** Reglas por categoría/subcategoría/línea (script officemart-005 sin aplicar). */
export const REGLAS_FEATURE_PENDING =
  "Reglas por categoría/línea pendientes: aplica scripts/officemart-005-listas-reglas.sql en Supabase."

/** Dimensión sobre la que aplica una regla de precio. */
export type DimensionRegla = "categoria" | "subcategoria" | "linea"

/**
 * Regla de descuento de una lista sobre una dimensión del producto
 * (script officemart-005). `porcentaje` es un DESCUENTO (siempre baja).
 */
export interface ListaPrecioRegla {
  id?: number
  lista_id: number
  dimension: DimensionRegla
  /** id de la categoría / subcategoría / línea según `dimension`. */
  ref_id: number
  porcentaje: number
}

function isMissingTable(err: { message?: string; code?: string } | null): boolean {
  if (!err) return false
  const msg = (err.message || "").toLowerCase()
  return (
    err.code === "42P01" ||
    err.code === "PGRST205" ||
    /relation .*(listas_precios|cliente_lista_precio).* does not exist/.test(msg) ||
    msg.includes("could not find the table")
  )
}

// ==================== LISTAS ====================

export async function getListasPrecios(): Promise<{ data: ListaPrecio[]; error: string | null }> {
  if (!isSupabaseConfigured()) return { data: [], error: null }
  const supabase = createClient()
  if (!supabase) return { data: [], error: "Cliente no disponible" }

  const { data, error } = await supabase
    .from("listas_precios")
    .select("id, nombre, tipo, porcentaje, activo")
    .order("nombre", { ascending: true })
  if (error) {
    if (isMissingTable(error)) return { data: [], error: LISTAS_FEATURE_PENDING }
    return { data: [], error: error.message }
  }
  return { data: (data || []) as ListaPrecio[], error: null }
}

export async function crearListaPrecio(input: {
  nombre: string
  tipo: TipoLista
  porcentaje: number
}): Promise<{ data: { id: number } | null; error: string | null }> {
  const supabase = createClient()
  if (!supabase) return { data: null, error: "Cliente no disponible" }
  const stamp = await getTenantStamp(supabase)
  if (!isValidStamp(stamp)) return { data: null, error: SESION_INVALIDA_ERROR }

  const { data, error } = await supabase
    .from("listas_precios")
    .insert({
      nombre: input.nombre.trim(),
      tipo: input.tipo,
      porcentaje: input.tipo === "porcentaje" ? Number(input.porcentaje) || 0 : 0,
      activo: true,
      ...stamp,
    })
    .select("id")
    .single()
  if (error) {
    if (isMissingTable(error)) return { data: null, error: LISTAS_FEATURE_PENDING }
    return { data: null, error: error.message }
  }
  return { data: { id: data.id as number }, error: null }
}

export async function actualizarListaPrecio(
  id: number,
  input: { nombre?: string; porcentaje?: number; activo?: boolean }
): Promise<{ error: string | null }> {
  const supabase = createClient()
  if (!supabase) return { error: "Cliente no disponible" }
  const patch: Record<string, unknown> = {}
  if (input.nombre !== undefined) patch.nombre = input.nombre.trim()
  if (input.porcentaje !== undefined) patch.porcentaje = Number(input.porcentaje) || 0
  if (input.activo !== undefined) patch.activo = input.activo
  const { error } = await supabase.from("listas_precios").update(patch).eq("id", id)
  return { error: error ? error.message : null }
}

export async function eliminarListaPrecio(id: number): Promise<{ error: string | null }> {
  const supabase = createClient()
  if (!supabase) return { error: "Cliente no disponible" }
  const { error } = await supabase.from("listas_precios").delete().eq("id", id)
  return { error: error ? error.message : null }
}

// ==================== DETALLE (precios por producto) ====================

/** Mapa producto_id -> precio de la lista (solo tipo 'individual'). */
export async function getDetalleLista(
  listaId: number
): Promise<{ data: Record<number, number>; error: string | null }> {
  if (!isSupabaseConfigured()) return { data: {}, error: null }
  const supabase = createClient()
  if (!supabase) return { data: {}, error: "Cliente no disponible" }
  const { data, error } = await supabase
    .from("listas_precios_detalle")
    .select("producto_id, precio")
    .eq("lista_id", listaId)
  if (error) {
    if (isMissingTable(error)) return { data: {}, error: LISTAS_FEATURE_PENDING }
    return { data: {}, error: error.message }
  }
  const map: Record<number, number> = {}
  for (const r of data || []) map[r.producto_id as number] = Number(r.precio)
  return { data: map, error: null }
}

/** Fija (o borra si precio null) el precio de un producto en una lista individual. */
export async function setPrecioProducto(
  listaId: number,
  productoId: number,
  precio: number | null
): Promise<{ error: string | null }> {
  const supabase = createClient()
  if (!supabase) return { error: "Cliente no disponible" }
  if (precio == null || Number.isNaN(precio)) {
    const { error } = await supabase
      .from("listas_precios_detalle")
      .delete()
      .eq("lista_id", listaId)
      .eq("producto_id", productoId)
    return { error: error ? error.message : null }
  }
  const stamp = await getTenantStamp(supabase)
  if (!isValidStamp(stamp)) return { error: SESION_INVALIDA_ERROR }
  const { error } = await supabase
    .from("listas_precios_detalle")
    .upsert(
      { lista_id: listaId, producto_id: productoId, precio, ...stamp },
      { onConflict: "lista_id,producto_id" }
    )
  return { error: error ? error.message : null }
}

// ==================== REGLAS POR CATEGORIA / SUBCATEGORIA / LINEA ====================

function reglaDesdeFila(r: Record<string, unknown>): ListaPrecioRegla | null {
  const dimension: DimensionRegla | null =
    r.subcategoria_id != null ? "subcategoria" : r.categoria_id != null ? "categoria" : r.linea_id != null ? "linea" : null
  if (!dimension) return null
  const ref = r.subcategoria_id ?? r.categoria_id ?? r.linea_id
  return {
    id: r.id as number,
    lista_id: Number(r.lista_id),
    dimension,
    ref_id: Number(ref),
    porcentaje: Math.abs(Number(r.porcentaje) || 0),
  }
}

/** Reglas de una lista. Si la tabla no existe (officemart-005 pendiente) devuelve []. */
export async function getReglasLista(
  listaId: number
): Promise<{ data: ListaPrecioRegla[]; error: string | null; pendiente: boolean }> {
  if (!isSupabaseConfigured()) return { data: [], error: null, pendiente: false }
  const supabase = createClient()
  if (!supabase) return { data: [], error: "Cliente no disponible", pendiente: false }
  const { data, error } = await supabase
    .from("listas_precios_reglas")
    .select("id, lista_id, categoria_id, subcategoria_id, linea_id, porcentaje")
    .eq("lista_id", listaId)
  if (error) {
    if (isMissingTable(error) || /listas_precios_reglas/i.test(error.message || "")) {
      return { data: [], error: null, pendiente: true }
    }
    return { data: [], error: error.message, pendiente: false }
  }
  const reglas = (data || [])
    .map((r) => reglaDesdeFila(r as Record<string, unknown>))
    .filter((r): r is ListaPrecioRegla => r != null)
  return { data: reglas, error: null, pendiente: false }
}

/**
 * Fija (o borra si `porcentaje` es null) la regla de una lista para una
 * dimensión. Upsert manual: busca la regla existente y la actualiza.
 */
export async function setReglaLista(
  listaId: number,
  dimension: DimensionRegla,
  refId: number,
  porcentaje: number | null
): Promise<{ error: string | null }> {
  const supabase = createClient()
  if (!supabase) return { error: "Cliente no disponible" }
  const col = dimension === "categoria" ? "categoria_id" : dimension === "subcategoria" ? "subcategoria_id" : "linea_id"

  if (porcentaje == null || Number.isNaN(porcentaje)) {
    const { error } = await supabase
      .from("listas_precios_reglas")
      .delete()
      .eq("lista_id", listaId)
      .eq(col, refId)
    if (error && !isMissingTable(error)) return { error: error.message }
    return { error: null }
  }

  const stamp = await getTenantStamp(supabase)
  if (!isValidStamp(stamp)) return { error: SESION_INVALIDA_ERROR }
  const pct = Math.abs(Number(porcentaje) || 0)

  const { data: existente, error: selErr } = await supabase
    .from("listas_precios_reglas")
    .select("id")
    .eq("lista_id", listaId)
    .eq(col, refId)
    .maybeSingle()
  if (selErr) {
    if (isMissingTable(selErr) || /listas_precios_reglas/i.test(selErr.message || "")) {
      return { error: REGLAS_FEATURE_PENDING }
    }
    return { error: selErr.message }
  }
  if (existente?.id != null) {
    const { error } = await supabase
      .from("listas_precios_reglas")
      .update({ porcentaje: pct, updated_at: new Date().toISOString() })
      .eq("id", existente.id)
    return { error: error ? error.message : null }
  }
  const { error } = await supabase
    .from("listas_precios_reglas")
    .insert({ lista_id: listaId, [col]: refId, porcentaje: pct, ...stamp })
  return { error: error ? error.message : null }
}

/**
 * Resuelve el descuento (%) que aplica a un producto por reglas de la lista.
 * Precedencia: subcategoría > categoría > línea. null si ninguna regla aplica.
 * Función pura.
 */
export function reglaAplicable(
  reglas: ListaPrecioRegla[] | null | undefined,
  producto: { categoria_id?: number | null; subcategoria_id?: number | null; linea_id?: number | null } | null | undefined
): ListaPrecioRegla | null {
  if (!reglas || reglas.length === 0 || !producto) return null
  const buscar = (dim: DimensionRegla, id: number | null | undefined) =>
    id == null ? null : reglas.find((r) => r.dimension === dim && r.ref_id === id) ?? null
  return (
    buscar("subcategoria", producto.subcategoria_id) ??
    buscar("categoria", producto.categoria_id) ??
    buscar("linea", producto.linea_id)
  )
}

// ==================== ASIGNACION A CLIENTE ====================

/** lista_id asignada a un cliente, o null si usa el precio normal del maestro. */
export async function getListaDeCliente(
  clienteId: number
): Promise<{ data: number | null; error: string | null }> {
  if (!isSupabaseConfigured()) return { data: null, error: null }
  const supabase = createClient()
  if (!supabase) return { data: null, error: "Cliente no disponible" }
  const { data, error } = await supabase
    .from("cliente_lista_precio")
    .select("lista_id")
    .eq("cliente_id", clienteId)
    .maybeSingle()
  if (error) {
    if (isMissingTable(error)) return { data: null, error: null }
    return { data: null, error: error.message }
  }
  return { data: (data?.lista_id as number | undefined) ?? null, error: null }
}

/** Asigna (o quita, si listaId null) una lista a un cliente. */
export async function setListaDeCliente(
  clienteId: number,
  listaId: number | null
): Promise<{ error: string | null }> {
  const supabase = createClient()
  if (!supabase) return { error: "Cliente no disponible" }
  if (listaId == null) {
    const { error } = await supabase.from("cliente_lista_precio").delete().eq("cliente_id", clienteId)
    return { error: error ? error.message : null }
  }
  const stamp = await getTenantStamp(supabase)
  if (!isValidStamp(stamp)) return { error: SESION_INVALIDA_ERROR }
  const { error } = await supabase
    .from("cliente_lista_precio")
    .upsert(
      { cliente_id: clienteId, lista_id: listaId, razon_social_id: stamp.razon_social_id },
      { onConflict: "cliente_id" }
    )
  return { error: error ? error.message : null }
}

// ==================== APLICACION EN EL POS ====================

export interface ListaAplicada {
  lista: ListaPrecio
  detalle: Record<number, number>
  /** Reglas por categoría/subcategoría/línea (officemart-005); [] si no hay. */
  reglas?: ListaPrecioRegla[]
}

/** Carga la lista de un cliente (con su detalle si es individual), o null. */
export async function getListaAplicadaCliente(
  clienteId: number
): Promise<{ data: ListaAplicada | null; error: string | null }> {
  const { data: listaId } = await getListaDeCliente(clienteId)
  if (listaId == null) return { data: null, error: null }

  const supabase = createClient()
  if (!supabase) return { data: null, error: "Cliente no disponible" }
  const { data: lista, error } = await supabase
    .from("listas_precios")
    .select("id, nombre, tipo, porcentaje, activo")
    .eq("id", listaId)
    .maybeSingle()
  if (error || !lista || lista.activo === false) return { data: null, error: null }

  let detalle: Record<number, number> = {}
  if (lista.tipo === "individual") {
    const d = await getDetalleLista(listaId)
    detalle = d.data
  }
  const { data: reglas } = await getReglasLista(listaId)
  return { data: { lista: lista as ListaPrecio, detalle, reglas }, error: null }
}

/** Producto mínimo que necesita el cálculo de precio (id + dimensiones). */
export type ProductoParaPrecio = {
  id?: number | null
  categoria_id?: number | null
  subcategoria_id?: number | null
  linea_id?: number | null
}

/**
 * Precio final de un producto segun la lista (base si no aplica). Precedencia:
 *   1. precio individual del producto (listas 'individual'),
 *   2. regla por subcategoría, 3. por categoría, 4. por línea (officemart-005),
 *   5. % general de la lista (solo tipo 'porcentaje'),
 *   6. precio del maestro.
 * Acepta el id del producto (compatibilidad) o el producto con sus dimensiones.
 */
export function calcularPrecioLista(
  base: number,
  aplicada: ListaAplicada | null,
  producto: number | ProductoParaPrecio
): number {
  if (!aplicada) return base
  const { lista, detalle } = aplicada
  const prod: ProductoParaPrecio = typeof producto === "number" ? { id: producto } : producto
  const productoId = prod.id ?? -1

  if (lista.tipo === "individual") {
    const p = detalle[productoId]
    if (p != null) return p
  }
  const regla = reglaAplicable(aplicada.reglas, prod)
  if (regla) return +(base * (1 - regla.porcentaje / 100)).toFixed(2)
  if (lista.tipo === "individual") return base // sin precio especifico ni regla -> maestro
  // El porcentaje es un DESCUENTO: siempre baja el precio (ej. 5 = 5% menos).
  const desc = Math.abs(Number(lista.porcentaje) || 0)
  return +(base * (1 - desc / 100)).toFixed(2)
}
