import { createClient, isSupabaseConfigured } from '@/lib/supabase/client'
import { getTenantStamp, isValidStamp, SESION_INVALIDA_ERROR } from '@/lib/services/tenant-stamp'
import { comprimirImagen } from '@/lib/utils/comprimir-imagen'

// ==================== INTERFACES ====================

export interface Producto {
  id?: number
  nombre: string
  codigo_barras: string
  precio_venta_sugerido: number
  costo_promedio?: number
  stock_total?: number
  /** Talla opcional (ej. S, M, L, 38). Se muestra en el catalogo cuando existe. */
  talla?: string | null
  foto_url?: string
  marca_id?: number | null
  categoria_id?: number | null
  /** Opcional: el producto puede tener solo categoria principal. */
  subcategoria_id?: number | null
  /**
   * Linea de producto (nivel de clasificacion adicional, independiente de la
   * categoria; script officemart-002). Opcional. Sirve para precios por linea
   * y reportes por linea.
   */
  linea_id?: number | null
  marca_nombre?: string
  categoria_nombre?: string
  /** Nombre flat de la subcategoria (join virtual, no se persiste). */
  subcategoria_nombre?: string | null
  /** Nombre flat de la linea (se resuelve en la app, no se persiste). */
  linea_nombre?: string | null
  created_at?: string
  updated_at?: string
}

/**
 * Linea de producto: clasificacion transversal (ej. "Suministros de impresion",
 * "Equipos", "Confeccion") que NO depende de la categoria. Multi-tenant.
 */
export interface LineaProducto {
  id?: number
  nombre: string
  descripcion?: string | null
  activo?: boolean
  created_at?: string
}

/**
 * Subcategoria: hija de una categoria principal. Multi-tenant: cada tenant
 * mantiene su propio arbol categoria -> subcategorias. La FK a categorias
 * usa ON DELETE CASCADE: borrar la categoria padre elimina sus hijas.
 */
export interface Subcategoria {
  id?: number
  nombre: string
  descripcion?: string | null
  categoria_id: number
  created_at?: string
}

export interface Marca {
  id?: number
  nombre: string
  created_at?: string
}

export interface Categoria {
  id?: number
  nombre: string
  created_at?: string
}

export interface Almacen {
  id?: number
  nombre: string
  ubicacion: string
  created_at?: string
}

export interface Localizacion {
  id?: number
  almacen_id: number
  nombre: string
  descripcion?: string
  created_at?: string
  /** Marcada como "Punto de venta": se preselecciona en Nueva Venta. */
  es_punto_venta?: boolean
}

export interface Cliente {
  id?: number
  nombre: string  // required
  rtn?: string  // optional
  direccion?: string  // optional
  telefono?: string  // optional - contacto CRM
  /**
   * Fecha de nacimiento en formato ISO 'YYYY-MM-DD' (DATE en Postgres).
   * Usado para alertas de cumpleanos en el modulo de clientes.
   */
  fecha_nacimiento?: string
  /**
   * Limite de credito acumulado del cliente (Lempiras). 0 o null = SIN limite
   * (credito libre). Si > 0, una venta a credito que haga que su saldo pendiente
   * total supere este monto se bloquea. Columna del script 064.
   */
  limite_credito?: number | null
  // ----- Campos del script officemart-002 (todos opcionales) -----
  /** Notas especiales que se muestran al elegir el cliente en Nueva Venta. */
  notas?: string | null
  correo?: string | null
  /** Dias de credito: una factura a credito vence a los N dias. Null = sin plazo. */
  dias_credito?: number | null
  /** "Segundo cliente": cliente relacionado (a quien se factura / casa matriz). */
  cliente_relacionado_id?: number | null
  /** Bloqueado: no se le vende a credito (con motivo). */
  bloqueado?: boolean | null
  motivo_bloqueo?: string | null
  zona_id?: number | null
  vendedor_id?: number | null
  /**
   * Virtual (no es columna): true si el cliente esta activo. Un cliente con
   * ventas no se borra, se DESACTIVA (tabla `clientes_inactivos`, script 044) y
   * deja de aparecer en los selectores, pero sigue en el historial de ventas.
   * Lo llena getClientes leyendo la tabla mapa. Ausente = activo.
   */
  activo?: boolean
}

export interface Proveedor {
  id?: number
  nombre: string
  /** RTN opcional (un proveedor extranjero no tiene). */
  rtn?: string | null
  /** Persona de contacto (texto libre). */
  contacto?: string | null
  // ----- Campos del script officemart-002 (todos opcionales) -----
  correo?: string | null
  telefono?: string | null
  direccion?: string | null
  notas?: string | null
  /** 'LPS' | 'USD' */
  moneda?: string | null
  pais?: string | null
  /** Dias de credito que otorga: vencimiento por defecto de sus compras a credito. */
  dias_credito?: number | null
  created_at?: string
}

// ==================== PRODUCTOS ====================

export async function getProductos(): Promise<{ data: Producto[]; error: string | null }> {
  if (!isSupabaseConfigured()) {
    const saved = localStorage.getItem('productos')
    return { data: saved ? JSON.parse(saved) : [], error: null }
  }

  const supabase = createClient()
  if (!supabase) return { data: [], error: 'Cliente no disponible' }

  // Pagina sin tope: PostgREST corta cada select en 1000 filas y el catalogo
  // puede superarlo. Traemos todas las paginas.
  async function fetchPaged(cols: string): Promise<{ data: any[] | null; error: { message: string } | null }> {
    const PAGE = 1000
    const acc: any[] = []
    for (let from = 0, guard = 0; guard < 200; guard++, from += PAGE) {
      const result = await supabase!
        .from('productos')
        .select(cols)
        .order('id', { ascending: true })
        .range(from, from + PAGE - 1)
      if (result.error) return { data: null, error: result.error }
      const rows = (result.data || []) as any[]
      acc.push(...rows)
      if (rows.length < PAGE) break
    }
    return { data: acc, error: null }
  }

  try {
    // Intentamos primero con el join a subcategorias (post-migracion 015).
    // Si la columna o la tabla no existen aun, caemos al select clasico
    // sin romper la pagina. Asi el feature de subcategorias se "enciende"
    // automaticamente cuando el script 015 se ejecuta.
    let res = await fetchPaged('*, marcas(nombre), categorias(nombre), subcategorias(nombre)')

    if (
      res.error &&
      /subcategoria|column.*does not exist|relation.*does not exist/i.test(
        res.error.message
      )
    ) {
      console.log(
        '[catalogos] subcategorias no disponibles, fallback sin join'
      )
      res = await fetchPaged('*, marcas(nombre), categorias(nombre)')
    }

    if (res.error) return { data: [], error: res.error.message }

    // Flatten join data
    const lineaNombre = await getLineasNombreMap()
    const productos = (res.data || []).map((p: any) => ({
      ...p,
      marca_nombre: p.marcas?.nombre || null,
      categoria_nombre: p.categorias?.nombre || null,
      subcategoria_nombre: p.subcategorias?.nombre || null,
      linea_nombre: p.linea_id != null ? lineaNombre.get(Number(p.linea_id)) ?? null : null,
      marcas: undefined,
      categorias: undefined,
      subcategorias: undefined,
    }))

    return { data: productos, error: null }
  } catch (err) {
    console.error('[Supabase] Error obteniendo productos:', err)
    return { data: [], error: 'Error de conexion' }
  }
}

/**
 * Mapa id -> nombre de las lineas del tenant. `productos.linea_id` no lleva
 * FK (columna agregada sin constraints), asi que PostgREST no puede embeber
 * `lineas(nombre)`: el nombre se resuelve aqui. Vacio si la tabla no existe.
 */
async function getLineasNombreMap(): Promise<Map<number, string>> {
  const { data } = await getLineasProducto()
  const mapa = new Map<number, string>()
  for (const l of data) if (l.id != null) mapa.set(l.id, l.nombre)
  return mapa
}

/**
 * Busca productos por nombre o codigo de barras (ilike, "desde cero" contra la
 * BD). Pagina sin tope de 1000 para no perder coincidencias en catalogos
 * grandes. Devuelve el mismo shape que getProductos (marca/categoria/
 * subcategoria aplanadas) y filtra por tenant via RLS. Cae al select sin
 * subcategorias si la migracion 015 no se aplico.
 */
export async function buscarProductos(query: string): Promise<{ data: Producto[]; error: string | null }> {
  const q = (query || '').trim()

  if (!isSupabaseConfigured()) {
    const saved = localStorage.getItem('productos')
    const todos: Producto[] = saved ? JSON.parse(saved) : []
    const ql = q.toLowerCase()
    const data = !ql
      ? todos
      : todos.filter(
          (p) =>
            (p.nombre || '').toLowerCase().includes(ql) ||
            (p.codigo_barras || '').toLowerCase().includes(ql)
        )
    return { data, error: null }
  }

  if (!q) return { data: [], error: null }

  const supabase = createClient()
  if (!supabase) return { data: [], error: 'Cliente no disponible' }

  // Sanitiza para el operador .or de PostgREST: comas y parentesis rompen la
  // sintaxis del filtro. Los reemplazamos por espacios (siguen sirviendo para
  // el ilike parcial).
  const safe = q.replace(/[,()*]/g, ' ').trim()
  const like = `%${safe}%`

  // Pagina un tramo tras otro con el set de columnas dado.
  async function fetchPaged(cols: string): Promise<{ data: any[] | null; error: { message: string } | null }> {
    const PAGE = 1000
    const acc: any[] = []
    for (let from = 0, guard = 0; guard < 50; guard++, from += PAGE) {
      const result = await supabase!
        .from('productos')
        .select(cols)
        .or(`nombre.ilike.${like},codigo_barras.ilike.${like}`)
        .order('nombre', { ascending: true })
        .range(from, from + PAGE - 1)
      if (result.error) return { data: null, error: result.error }
      const rows = (result.data || []) as any[]
      acc.push(...rows)
      if (rows.length < PAGE) break
    }
    return { data: acc, error: null }
  }

  try {
    let res = await fetchPaged('*, marcas(nombre), categorias(nombre), subcategorias(nombre)')
    if (
      res.error &&
      /subcategoria|column.*does not exist|relation.*does not exist/i.test(res.error.message)
    ) {
      res = await fetchPaged('*, marcas(nombre), categorias(nombre)')
    }
    if (res.error) return { data: [], error: res.error.message }

    const lineaNombre = await getLineasNombreMap()
    const productos = (res.data || []).map((p: any) => ({
      ...p,
      marca_nombre: p.marcas?.nombre || null,
      categoria_nombre: p.categorias?.nombre || null,
      subcategoria_nombre: p.subcategorias?.nombre || null,
      linea_nombre: p.linea_id != null ? lineaNombre.get(Number(p.linea_id)) ?? null : null,
      marcas: undefined,
      categorias: undefined,
      subcategorias: undefined,
    }))
    return { data: productos, error: null }
  } catch (err) {
    console.error('[Supabase] Error buscando productos:', err)
    return { data: [], error: 'Error de conexion' }
  }
}

export async function saveProducto(
  producto: Producto,
  isNew: boolean
): Promise<{ data: Producto | null; error: string | null }> {
  if (!isSupabaseConfigured()) {
    const saved = localStorage.getItem('productos')
    const productos: Producto[] = saved ? JSON.parse(saved) : []
    
    if (isNew) {
      const newProducto = { ...producto, id: Date.now() }
      productos.push(newProducto)
      localStorage.setItem('productos', JSON.stringify(productos))
      return { data: newProducto, error: null }
    } else {
      const idx = productos.findIndex(p => p.id === producto.id)
      if (idx >= 0) productos[idx] = producto
      localStorage.setItem('productos', JSON.stringify(productos))
      return { data: producto, error: null }
    }
  }

  const supabase = createClient()
  if (!supabase) return { data: null, error: 'Cliente no disponible' }

  try {
    // Strip join-only fields before sending to DB. subcategoria_nombre es un
    // campo virtual que viene del join en getProductos y no existe como
    // columna real en productos.
    const {
      marca_nombre,
      categoria_nombre,
      subcategoria_nombre,
      linea_nombre,
      ...cleanProducto
    } = producto

    // Si el cliente no asigno subcategoria, no la mandamos en el payload.
    // Asi el codigo sigue funcionando antes de aplicar la migracion 015
    // (cuando productos.subcategoria_id no existe todavia). Cuando si esta
    // asignada, se manda y se persiste normal.
    if (cleanProducto.subcategoria_id == null) {
      delete (cleanProducto as { subcategoria_id?: number | null }).subcategoria_id
    }
    // Misma regla para la linea (columna del script officemart-002): al editar
    // un producto que tenia linea y se le quita, se manda null explicito.
    if (cleanProducto.linea_id === undefined || (isNew && cleanProducto.linea_id == null)) {
      delete (cleanProducto as { linea_id?: number | null }).linea_id
    }

    // Talla es opcional (columna nueva, migracion 033). Solo se envia si tiene
    // valor; asi el guardado sigue funcionando en bases sin la columna y los
    // productos sin talla no la mandan.
    if (cleanProducto.talla == null || String(cleanProducto.talla).trim() === '') {
      delete (cleanProducto as { talla?: string | null }).talla
    } else {
      cleanProducto.talla = String(cleanProducto.talla).trim()
    }

    if (isNew) {
      const stamp = await getTenantStamp(supabase)
      if (!isValidStamp(stamp)) {
        console.log('[saveProducto] Stamp invalido:', stamp)
        return { data: null, error: SESION_INVALIDA_ERROR }
      }

      const { id, ...productoData } = cleanProducto
      const { data, error } = await supabase
        .from('productos')
        .insert({ ...productoData, ...stamp })
        .select()
        .single()

      if (error) return { data: null, error: error.message }
      return { data, error: null }
    } else {
      // Strip id, created_at, stock_total (read-only/auto) from the UPDATE
      // payload. costo_promedio SI se permite editar manualmente.
      const { id, created_at, stock_total, ...updateData } = cleanProducto
      const { data, error } = await supabase
        .from('productos')
        .update({ ...updateData, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single()

      if (error) return { data: null, error: error.message }
      return { data, error: null }
    }
  } catch (err) {
    console.error('[Supabase] Error guardando producto:', err)
    return { data: null, error: 'Error de conexion' }
  }
}

/** Dependencias de un producto que condicionan si se puede borrar. */
export interface ProductoDependencias {
  /** Lineas de venta (ventas_detalle). Si > 0, NO se borra. */
  ventas: number
  /** Lineas de compra/recepcion (compras_detalle). Si > 0, NO se borra. */
  compras: number
  /** Movimientos de inventario (transacciones_inventario). Se borran en cascada. */
  transacciones: number
}

type SupaErr = { code?: string; message?: string } | null

/** True cuando el error indica que la tabla no existe (no es una dependencia). */
function esTablaAusente(err: SupaErr): boolean {
  if (!err) return false
  if (err.code === '42P01' || err.code === 'PGRST205') return true
  return /relation .* does not exist|could not find the table/i.test(err.message || '')
}

async function contarPorProducto(
  supabase: NonNullable<ReturnType<typeof createClient>>,
  tabla: string,
  productoId: number
): Promise<{ count: number; error: string | null }> {
  const { count, error } = await supabase
    .from(tabla)
    .select('id', { count: 'exact', head: true })
    .eq('producto_id', productoId)
  if (error) {
    // Tabla ausente = feature no aplicada = sin dependencias.
    if (esTablaAusente(error)) return { count: 0, error: null }
    return { count: 0, error: error.message }
  }
  return { count: count || 0, error: null }
}

/** Borra filas hijas por producto_id; ignora tablas ausentes (best-effort). */
async function borrarPorProductoBestEffort(
  supabase: NonNullable<ReturnType<typeof createClient>>,
  tabla: string,
  productoId: number
): Promise<void> {
  const { error } = await supabase.from(tabla).delete().eq('producto_id', productoId)
  if (error && !esTablaAusente(error)) {
    console.warn(`[deleteProducto] No se pudo limpiar ${tabla}:`, error.message)
  }
}

/**
 * Cuenta las dependencias de un producto (ventas, compras, movimientos de
 * inventario). La usa la UI para decidir el mensaje: bloquear si hay ventas o
 * compras, o confirmar el borrado en cascada si solo hay movimientos.
 */
export async function getProductoDependencias(
  id: number
): Promise<{ data: ProductoDependencias; error: string | null }> {
  const vacio = { ventas: 0, compras: 0, transacciones: 0 }
  if (!isSupabaseConfigured()) return { data: vacio, error: null }

  const supabase = createClient()
  if (!supabase) return { data: vacio, error: 'Cliente no disponible' }

  const [v, c, t] = await Promise.all([
    contarPorProducto(supabase, 'ventas_detalle', id),
    contarPorProducto(supabase, 'compras_detalle', id),
    contarPorProducto(supabase, 'transacciones_inventario', id),
  ])
  const error = v.error || c.error || t.error
  return { data: { ventas: v.count, compras: c.count, transacciones: t.count }, error }
}

/** True cuando el RPC no existe todavia (migracion 036 pendiente). */
function funcionRpcInexistente(err: SupaErr): boolean {
  if (!err) return false
  if (err.code === 'PGRST202') return true
  return /could not find the function|function .* does not exist|not exist in the schema cache/i.test(
    err.message || ''
  )
}

/**
 * Elimina un producto. Reglas:
 *  - Si tiene VENTAS (ventas_detalle) o COMPRAS/RECEPCIONES (compras_detalle) ->
 *    NO se borra (protege el historial financiero).
 *  - En otro caso, borra en cascada sus movimientos de inventario
 *    (transacciones_inventario) y las bitacoras que lo referencian
 *    (ajustes_inventario, ajustes_costo, pedidos_detalle), y luego el producto.
 *    `catalogo_link_productos` cae solo (ON DELETE CASCADE).
 *
 * Ruta principal: RPC `eliminar_producto_en_cascada` (SECURITY DEFINER, script
 * 036). Corre del lado servidor IGNORANDO RLS, por lo que borra tambien los
 * movimientos con `razon_social_id` mal sellado (NULL / otra empresa) que el
 * cliente no ve pero que igual bloquean el FK. Si el RPC no existe todavia, cae
 * al metodo JS.
 */
export async function deleteProducto(id: number): Promise<{ success: boolean; error: string | null }> {
  if (!isSupabaseConfigured()) {
    const saved = localStorage.getItem('productos')
    const productos: Producto[] = saved ? JSON.parse(saved) : []
    const filtered = productos.filter(p => p.id !== id)
    localStorage.setItem('productos', JSON.stringify(filtered))
    return { success: true, error: null }
  }

  const supabase = createClient()
  if (!supabase) return { success: false, error: 'Cliente no disponible' }

  try {
    const { data, error } = await supabase.rpc('eliminar_producto_en_cascada', {
      p_producto_id: id,
    })
    if (!error) {
      // La funcion devuelve NULL si borro; o un mensaje de bloqueo/validacion.
      if (data == null) return { success: true, error: null }
      return { success: false, error: String(data) }
    }
    // Migracion 036 pendiente: usar la ruta JS (pasa por RLS).
    if (funcionRpcInexistente(error)) {
      return await deleteProductoFallbackJS(supabase, id)
    }
    return { success: false, error: error.message }
  } catch (err) {
    console.error('[Supabase] Error eliminando producto:', err)
    return { success: false, error: 'Error de conexion' }
  }
}

/**
 * Fallback sin RPC: mismas reglas pero desde el cliente (pasa por RLS, por lo que
 * NO alcanza movimientos con `razon_social_id` mal sellado). Se usa solo mientras
 * no se aplica el script 036.
 */
async function deleteProductoFallbackJS(
  supabase: NonNullable<ReturnType<typeof createClient>>,
  id: number
): Promise<{ success: boolean; error: string | null }> {
  // 1) Proteccion: ventas y compras bloquean el borrado.
  const ventas = await contarPorProducto(supabase, 'ventas_detalle', id)
  if (ventas.error) return { success: false, error: ventas.error }
  if (ventas.count > 0) {
    return {
      success: false,
      error: `No se puede eliminar: el producto tiene ${ventas.count} venta(s) registrada(s). No se borra para conservar el historial de ventas.`,
    }
  }
  const compras = await contarPorProducto(supabase, 'compras_detalle', id)
  if (compras.error) return { success: false, error: compras.error }
  if (compras.count > 0) {
    return {
      success: false,
      error: `No se puede eliminar: el producto tiene ${compras.count} compra(s)/recepcion(es) registrada(s).`,
    }
  }

  // 2) Cascada de movimientos e historiales de inventario.
  const ti = await supabase.from('transacciones_inventario').delete().eq('producto_id', id)
  if (ti.error) return { success: false, error: `No se pudieron eliminar los movimientos de inventario: ${ti.error.message}` }
  await borrarPorProductoBestEffort(supabase, 'ajustes_inventario', id)
  await borrarPorProductoBestEffort(supabase, 'ajustes_costo', id)
  await borrarPorProductoBestEffort(supabase, 'pedidos_detalle', id)

  // 3) Borrar el producto.
  const { error } = await supabase.from('productos').delete().eq('id', id)
  if (error) return { success: false, error: error.message }
  return { success: true, error: null }
}

export async function uploadProductoImage(
  file: File,
  opts?: { comprimir?: boolean }
): Promise<{ url: string | null; error: string | null }> {
  if (!isSupabaseConfigured()) {
    return { url: URL.createObjectURL(file), error: null }
  }

  try {
    // Comprime en el navegador antes de subir: baja resolucion/peso de fotos
    // muy grandes (celular) para que quepan bajo el limite y carguen rapido.
    // El backfill pasa `comprimir: false` porque ya viene comprimida.
    const procesada =
      opts?.comprimir === false ? file : (await comprimirImagen(file)).file

    const formData = new FormData()
    formData.append('file', procesada)

    const res = await fetch('/api/upload-imagen', {
      method: 'POST',
      body: formData
    })

    const json = await res.json()

    if (!res.ok) {
      return { url: null, error: json.error || 'Error al subir imagen' }
    }

    return { url: json.url, error: null }
  } catch (err) {
    console.error('[Upload] Error subiendo imagen:', err)
    return { url: null, error: 'Error subiendo imagen' }
  }
}

/**
 * Descarga una imagen desde una URL externa y la sube al almacenamiento propio
 * (bucket 'productos'), devolviendo su URL pública. Se usa al elegir una imagen
 * de la web para conservarla (a prueba de que el origen la borre).
 */
export async function importarImagenDeUrl(
  urlExterna: string
): Promise<{ url: string | null; error: string | null }> {
  try {
    const res = await fetch('/api/importar-imagen-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: urlExterna }),
    })
    const json = await res.json()
    if (!res.ok) return { url: null, error: json.error || 'No se pudo importar la imagen' }
    return { url: json.url, error: null }
  } catch (err) {
    console.error('[importarImagenDeUrl] error:', err)
    return { url: null, error: 'No se pudo importar la imagen' }
  }
}

export interface ProgresoRecompresion {
  total: number
  procesados: number
  comprimidas: number
  errores: number
  bytesAhorrados: number
  /** Nombre del producto en proceso (para feedback en vivo). */
  actual?: string
}

/**
 * Backfill: recomprime las fotos YA subidas de los productos de la empresa
 * actual (tenant vía RLS). Para cada foto: la descarga, la comprime en el
 * navegador y, si queda mas liviana, la vuelve a subir y actualiza `foto_url`.
 * Idempotente: una foto ya optimizada se salta (no se recomprime).
 *
 * `onProgress` se llama por cada producto para poder mostrar el avance.
 */
export async function recomprimirFotosProductos(
  onProgress?: (p: ProgresoRecompresion) => void
): Promise<{ data: ProgresoRecompresion; error: string | null }> {
  const prog: ProgresoRecompresion = {
    total: 0,
    procesados: 0,
    comprimidas: 0,
    errores: 0,
    bytesAhorrados: 0,
  }

  if (!isSupabaseConfigured()) return { data: prog, error: 'Supabase no configurado' }
  const supabase = createClient()
  if (!supabase) return { data: prog, error: 'Cliente no disponible' }

  const { data: productos, error } = await getProductos()
  if (error) return { data: prog, error }

  const conFoto = (productos || []).filter(
    (p) => typeof p.foto_url === 'string' && /^https?:\/\//.test(p.foto_url)
  )
  prog.total = conFoto.length
  onProgress?.({ ...prog })

  for (const p of conFoto) {
    prog.actual = p.nombre
    onProgress?.({ ...prog })
    try {
      const resp = await fetch(p.foto_url as string, { cache: 'no-store' })
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      const blob = await resp.blob()
      const nombre = (p.foto_url as string).split('/').pop() || 'foto.jpg'
      const file = new File([blob], nombre, { type: blob.type || 'image/jpeg' })

      const r = await comprimirImagen(file)
      if (r.comprimida && r.bytesDespues < r.bytesAntes) {
        const { url, error: upErr } = await uploadProductoImage(r.file, { comprimir: false })
        if (upErr || !url) throw new Error(upErr || 'No se pudo subir')
        const { error: updErr } = await supabase
          .from('productos')
          .update({ foto_url: url })
          .eq('id', p.id as number)
        if (updErr) throw new Error(updErr.message)
        prog.comprimidas += 1
        prog.bytesAhorrados += r.bytesAntes - r.bytesDespues
      }
    } catch (err) {
      console.error('[Recompresion] Error con producto', p.id, err)
      prog.errores += 1
    }
    prog.procesados += 1
    onProgress?.({ ...prog })
  }

  prog.actual = undefined
  onProgress?.({ ...prog })
  return { data: prog, error: null }
}

// ==================== MARCAS ====================

export async function getMarcas(): Promise<{ data: Marca[]; error: string | null }> {
  if (!isSupabaseConfigured()) {
    const saved = localStorage.getItem('marcas')
    return { data: saved ? JSON.parse(saved) : [], error: null }
  }

  const supabase = createClient()
  if (!supabase) return { data: [], error: 'Cliente no disponible' }

  try {
    const { data, error } = await supabase
      .from('marcas')
      .select('*')
      .order('nombre', { ascending: true })

    if (error) return { data: [], error: error.message }
    return { data: data || [], error: null }
  } catch (err) {
    console.error('[Supabase] Error obteniendo marcas:', err)
    return { data: [], error: 'Error de conexion' }
  }
}

export async function createMarca(nombre: string): Promise<{ data: Marca | null; error: string | null }> {
  if (!isSupabaseConfigured()) {
    const saved = localStorage.getItem('marcas')
    const marcas: Marca[] = saved ? JSON.parse(saved) : []
    const newMarca = { id: Date.now(), nombre }
    marcas.push(newMarca)
    localStorage.setItem('marcas', JSON.stringify(marcas))
    return { data: newMarca, error: null }
  }

  const supabase = createClient()
  if (!supabase) return { data: null, error: 'Cliente no disponible' }

  try {
    const stamp = await getTenantStamp(supabase)
    if (!isValidStamp(stamp)) {
      console.log('[createMarca] Stamp invalido:', stamp)
      return { data: null, error: SESION_INVALIDA_ERROR }
    }

    const { data, error } = await supabase
      .from('marcas')
      .insert({ nombre, ...stamp })
      .select()
      .single()

    if (error) return { data: null, error: error.message }
    return { data, error: null }
  } catch (err) {
    console.error('[Supabase] Error creando marca:', err)
    return { data: null, error: 'Error de conexion' }
  }
}

// ==================== CATEGORIAS ====================

export async function getCategorias(): Promise<{ data: Categoria[]; error: string | null }> {
  if (!isSupabaseConfigured()) {
    const saved = localStorage.getItem('categorias')
    return { data: saved ? JSON.parse(saved) : [], error: null }
  }

  const supabase = createClient()
  if (!supabase) return { data: [], error: 'Cliente no disponible' }

  try {
    const { data, error } = await supabase
      .from('categorias')
      .select('*')
      .order('nombre', { ascending: true })

    if (error) return { data: [], error: error.message }
    return { data: data || [], error: null }
  } catch (err) {
    console.error('[Supabase] Error obteniendo categorias:', err)
    return { data: [], error: 'Error de conexion' }
  }
}

export async function createCategoria(nombre: string): Promise<{ data: Categoria | null; error: string | null }> {
  if (!isSupabaseConfigured()) {
    const saved = localStorage.getItem('categorias')
    const categorias: Categoria[] = saved ? JSON.parse(saved) : []
    const newCategoria = { id: Date.now(), nombre }
    categorias.push(newCategoria)
    localStorage.setItem('categorias', JSON.stringify(categorias))
    return { data: newCategoria, error: null }
  }

  const supabase = createClient()
  if (!supabase) return { data: null, error: 'Cliente no disponible' }

  try {
    const stamp = await getTenantStamp(supabase)
    if (!isValidStamp(stamp)) {
      console.log('[createCategoria] Stamp invalido:', stamp)
      return { data: null, error: SESION_INVALIDA_ERROR }
    }

    const { data, error } = await supabase
      .from('categorias')
      .insert({ nombre, ...stamp })
      .select()
      .single()

    if (error) return { data: null, error: error.message }
    return { data, error: null }
  } catch (err) {
    console.error('[Supabase] Error creando categoria:', err)
    return { data: null, error: 'Error de conexion' }
  }
}

// ==================== SUBCATEGORIAS ====================

/**
 * Lista subcategorias. Si se pasa `categoriaId` filtra a las hijas de esa
 * categoria (UI de cascada en el form de productos). Sin filtro, devuelve
 * todas las del tenant para la vista de Gestion de Categorias.
 *
 * Resiliente al pre-015: si la tabla aun no existe, regresa lista vacia
 * sin error para que la UI siga funcionando.
 */
export async function getSubcategorias(
  categoriaId?: number
): Promise<{ data: Subcategoria[]; error: string | null }> {
  if (!isSupabaseConfigured()) {
    const saved = localStorage.getItem('subcategorias')
    let subs: Subcategoria[] = saved ? JSON.parse(saved) : []
    if (categoriaId != null) {
      subs = subs.filter((s) => s.categoria_id === categoriaId)
    }
    return { data: subs, error: null }
  }

  const supabase = createClient()
  if (!supabase) return { data: [], error: 'Cliente no disponible' }

  try {
    let query = supabase
      .from('subcategorias')
      .select('*')
      .order('nombre', { ascending: true })

    if (categoriaId != null) {
      query = query.eq('categoria_id', categoriaId)
    }

    const { data, error } = await query

    if (error) {
      // Migracion 015 pendiente: degradamos silenciosamente.
      if (/relation.*does not exist/i.test(error.message)) {
        console.log('[subcategorias] tabla no existe, devolviendo vacio')
        return { data: [], error: null }
      }
      return { data: [], error: error.message }
    }
    return { data: data || [], error: null }
  } catch (err) {
    console.error('[Supabase] Error obteniendo subcategorias:', err)
    return { data: [], error: 'Error de conexion' }
  }
}

export async function createSubcategoria(
  nombre: string,
  categoriaId: number,
  descripcion?: string
): Promise<{ data: Subcategoria | null; error: string | null }> {
  if (!isSupabaseConfigured()) {
    const saved = localStorage.getItem('subcategorias')
    const subs: Subcategoria[] = saved ? JSON.parse(saved) : []
    const newSub: Subcategoria = {
      id: Date.now(),
      nombre,
      categoria_id: categoriaId,
      descripcion,
    }
    subs.push(newSub)
    localStorage.setItem('subcategorias', JSON.stringify(subs))
    return { data: newSub, error: null }
  }

  const supabase = createClient()
  if (!supabase) return { data: null, error: 'Cliente no disponible' }

  try {
    const stamp = await getTenantStamp(supabase)
    if (!isValidStamp(stamp)) {
      console.log('[createSubcategoria] Stamp invalido:', stamp)
      return { data: null, error: SESION_INVALIDA_ERROR }
    }

    // Inyectamos categoria_id + razon_social_id (del tenant stamp). El UNIQUE
    // compuesto en BD evitara duplicados dentro de la misma categoria/tenant.
    const { data, error } = await supabase
      .from('subcategorias')
      .insert({
        nombre,
        descripcion: descripcion ?? null,
        categoria_id: categoriaId,
        ...stamp,
      })
      .select()
      .single()

    if (error) return { data: null, error: error.message }
    return { data, error: null }
  } catch (err) {
    console.error('[Supabase] Error creando subcategoria:', err)
    return { data: null, error: 'Error de conexion' }
  }
}

export async function updateSubcategoria(
  id: number,
  nombre: string,
  descripcion?: string | null
): Promise<{ data: Subcategoria | null; error: string | null }> {
  if (!isSupabaseConfigured()) {
    const saved = localStorage.getItem('subcategorias')
    const subs: Subcategoria[] = saved ? JSON.parse(saved) : []
    const idx = subs.findIndex((s) => s.id === id)
    if (idx >= 0) {
      subs[idx] = { ...subs[idx], nombre, descripcion: descripcion ?? null }
      localStorage.setItem('subcategorias', JSON.stringify(subs))
      return { data: subs[idx], error: null }
    }
    return { data: null, error: 'No encontrada' }
  }

  const supabase = createClient()
  if (!supabase) return { data: null, error: 'Cliente no disponible' }

  try {
    const { data, error } = await supabase
      .from('subcategorias')
      .update({
        nombre,
        descripcion: descripcion ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single()

    if (error) return { data: null, error: error.message }
    return { data, error: null }
  } catch (err) {
    console.error('[Supabase] Error actualizando subcategoria:', err)
    return { data: null, error: 'Error de conexion' }
  }
}

export async function deleteSubcategoria(
  id: number
): Promise<{ success: boolean; error: string | null }> {
  if (!isSupabaseConfigured()) {
    const saved = localStorage.getItem('subcategorias')
    const subs: Subcategoria[] = saved ? JSON.parse(saved) : []
    const filtered = subs.filter((s) => s.id !== id)
    localStorage.setItem('subcategorias', JSON.stringify(filtered))
    return { success: true, error: null }
  }

  const supabase = createClient()
  if (!supabase) return { success: false, error: 'Cliente no disponible' }

  try {
    // El FK productos.subcategoria_id usa ON DELETE SET NULL, asi que esto
    // no rompe la integridad: los productos que la usaban quedaran solo con
    // categoria principal.
    const { error } = await supabase.from('subcategorias').delete().eq('id', id)
    if (error) return { success: false, error: error.message }
    return { success: true, error: null }
  } catch (err) {
    console.error('[Supabase] Error eliminando subcategoria:', err)
    return { success: false, error: 'Error de conexion' }
  }
}

// ==================== LINEAS DE PRODUCTO ====================

function esTablaLineasAusente(err: { message?: string; code?: string } | null): boolean {
  if (!err) return false
  const msg = (err.message || '').toLowerCase()
  return (
    err.code === '42P01' ||
    err.code === 'PGRST205' ||
    /relation .*lineas.* does not exist/.test(msg) ||
    msg.includes('could not find the table')
  )
}

/**
 * Lineas de producto del tenant (script officemart-002). Si la tabla no
 * existe todavia devuelve vacio sin error (la UI oculta la funcion).
 */
export async function getLineasProducto(
  opts: { soloActivas?: boolean } = {}
): Promise<{ data: LineaProducto[]; error: string | null }> {
  if (!isSupabaseConfigured()) {
    const saved = localStorage.getItem('lineas')
    let lineas: LineaProducto[] = saved ? JSON.parse(saved) : []
    if (opts.soloActivas) lineas = lineas.filter((l) => l.activo !== false)
    return { data: lineas, error: null }
  }

  const supabase = createClient()
  if (!supabase) return { data: [], error: 'Cliente no disponible' }

  try {
    let query = supabase.from('lineas').select('*').order('nombre', { ascending: true })
    if (opts.soloActivas) query = query.eq('activo', true)
    const { data, error } = await query
    if (error) {
      if (esTablaLineasAusente(error)) return { data: [], error: null }
      return { data: [], error: error.message }
    }
    return { data: (data || []) as LineaProducto[], error: null }
  } catch (err) {
    console.error('[Supabase] Error obteniendo lineas:', err)
    return { data: [], error: 'Error de conexion' }
  }
}

export async function createLineaProducto(
  nombre: string,
  descripcion?: string | null
): Promise<{ data: LineaProducto | null; error: string | null }> {
  const limpio = (nombre || '').trim()
  if (!limpio) return { data: null, error: 'El nombre es requerido' }

  if (!isSupabaseConfigured()) {
    const saved = localStorage.getItem('lineas')
    const lineas: LineaProducto[] = saved ? JSON.parse(saved) : []
    const nueva: LineaProducto = { id: Date.now(), nombre: limpio, descripcion: descripcion ?? null, activo: true }
    lineas.push(nueva)
    localStorage.setItem('lineas', JSON.stringify(lineas))
    return { data: nueva, error: null }
  }

  const supabase = createClient()
  if (!supabase) return { data: null, error: 'Cliente no disponible' }

  try {
    const stamp = await getTenantStamp(supabase)
    if (!isValidStamp(stamp)) return { data: null, error: SESION_INVALIDA_ERROR }

    const { data, error } = await supabase
      .from('lineas')
      .insert({ nombre: limpio, descripcion: (descripcion || '').trim() || null, activo: true, ...stamp })
      .select()
      .single()
    if (error) {
      if (esTablaLineasAusente(error)) {
        return { data: null, error: 'Lineas de producto pendientes: aplica scripts/officemart-002-cimientos.sql.' }
      }
      return { data: null, error: error.message }
    }
    return { data: data as LineaProducto, error: null }
  } catch (err) {
    console.error('[Supabase] Error creando linea:', err)
    return { data: null, error: 'Error de conexion' }
  }
}

export async function updateLineaProducto(
  id: number,
  cambios: { nombre?: string; descripcion?: string | null; activo?: boolean }
): Promise<{ data: LineaProducto | null; error: string | null }> {
  if (!isSupabaseConfigured()) {
    const saved = localStorage.getItem('lineas')
    const lineas: LineaProducto[] = saved ? JSON.parse(saved) : []
    const idx = lineas.findIndex((l) => l.id === id)
    if (idx < 0) return { data: null, error: 'No encontrada' }
    lineas[idx] = { ...lineas[idx], ...cambios }
    localStorage.setItem('lineas', JSON.stringify(lineas))
    return { data: lineas[idx], error: null }
  }

  const supabase = createClient()
  if (!supabase) return { data: null, error: 'Cliente no disponible' }

  try {
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (cambios.nombre !== undefined) {
      const limpio = cambios.nombre.trim()
      if (!limpio) return { data: null, error: 'El nombre es requerido' }
      patch.nombre = limpio
    }
    if (cambios.descripcion !== undefined) patch.descripcion = (cambios.descripcion || '').trim() || null
    if (cambios.activo !== undefined) patch.activo = cambios.activo

    const { data, error } = await supabase.from('lineas').update(patch).eq('id', id).select().single()
    if (error) return { data: null, error: error.message }
    return { data: data as LineaProducto, error: null }
  } catch (err) {
    console.error('[Supabase] Error actualizando linea:', err)
    return { data: null, error: 'Error de conexion' }
  }
}

/**
 * Borra una linea sin productos; si tiene productos asignados la DESACTIVA
 * (los productos conservan su linea para reportes historicos).
 */
export async function deleteLineaProducto(
  id: number
): Promise<{ success: boolean; modo: 'borrado' | 'desactivado' | null; error: string | null }> {
  if (!isSupabaseConfigured()) {
    const saved = localStorage.getItem('lineas')
    const lineas: LineaProducto[] = saved ? JSON.parse(saved) : []
    localStorage.setItem('lineas', JSON.stringify(lineas.filter((l) => l.id !== id)))
    return { success: true, modo: 'borrado', error: null }
  }

  const supabase = createClient()
  if (!supabase) return { success: false, modo: null, error: 'Cliente no disponible' }

  try {
    const { count } = await supabase
      .from('productos')
      .select('id', { count: 'exact', head: true })
      .eq('linea_id', id)
    if ((count || 0) > 0) {
      const { error } = await supabase
        .from('lineas')
        .update({ activo: false, updated_at: new Date().toISOString() })
        .eq('id', id)
      if (error) return { success: false, modo: null, error: error.message }
      return { success: true, modo: 'desactivado', error: null }
    }
    const { error } = await supabase.from('lineas').delete().eq('id', id)
    if (error) return { success: false, modo: null, error: error.message }
    return { success: true, modo: 'borrado', error: null }
  } catch (err) {
    console.error('[Supabase] Error eliminando linea:', err)
    return { success: false, modo: null, error: 'Error de conexion' }
  }
}

// ==================== ALMACENES ====================

export async function getAlmacenes(): Promise<{ data: Almacen[]; error: string | null }> {
  if (!isSupabaseConfigured()) {
    const saved = localStorage.getItem('almacenes')
    return { data: saved ? JSON.parse(saved) : [], error: null }
  }

  const supabase = createClient()
  if (!supabase) return { data: [], error: 'Cliente no disponible' }

  try {
    const { data, error } = await supabase
      .from('almacenes')
      .select('*')
      .order('id', { ascending: true })

    if (error) return { data: [], error: error.message }
    return { data: data || [], error: null }
  } catch (err) {
    console.error('[Supabase] Error obteniendo almacenes:', err)
    return { data: [], error: 'Error de conexion' }
  }
}

export async function saveAlmacen(
  almacen: Almacen,
  isNew: boolean
): Promise<{ data: Almacen | null; error: string | null }> {
  if (!isSupabaseConfigured()) {
    const saved = localStorage.getItem('almacenes')
    const almacenes: Almacen[] = saved ? JSON.parse(saved) : []
    
    if (isNew) {
      const newAlmacen = { ...almacen, id: Date.now() }
      almacenes.push(newAlmacen)
      localStorage.setItem('almacenes', JSON.stringify(almacenes))
      return { data: newAlmacen, error: null }
    } else {
      const idx = almacenes.findIndex(a => a.id === almacen.id)
      if (idx >= 0) almacenes[idx] = almacen
      localStorage.setItem('almacenes', JSON.stringify(almacenes))
      return { data: almacen, error: null }
    }
  }

  const supabase = createClient()
  if (!supabase) return { data: null, error: 'Cliente no disponible' }

  try {
    if (isNew) {
      const stamp = await getTenantStamp(supabase)
      if (!isValidStamp(stamp)) {
        console.log('[saveAlmacen] Stamp invalido:', stamp)
        return { data: null, error: SESION_INVALIDA_ERROR }
      }

      const { id, ...almacenData } = almacen
      const { data, error } = await supabase
        .from('almacenes')
        .insert({ ...almacenData, ...stamp })
        .select()
        .single()

      if (error) return { data: null, error: error.message }
      return { data, error: null }
    } else {
      // Update: no tocamos razon_social_id (aislamiento) ni usuario
      // (historial del creador original). Solo datos funcionales.
      const { id, ...almacenData } = almacen
      const { data, error } = await supabase
        .from('almacenes')
        .update(almacenData)
        .eq('id', almacen.id)
        .select()
        .single()

      if (error) return { data: null, error: error.message }
      return { data, error: null }
    }
  } catch (err) {
    console.error('[Supabase] Error guardando almacen:', err)
    return { data: null, error: 'Error de conexion' }
  }
}

export async function deleteAlmacen(id: number): Promise<{ success: boolean; error: string | null }> {
  if (!isSupabaseConfigured()) {
    const saved = localStorage.getItem('almacenes')
    const almacenes: Almacen[] = saved ? JSON.parse(saved) : []
    const filtered = almacenes.filter(a => a.id !== id)
    localStorage.setItem('almacenes', JSON.stringify(filtered))
    return { success: true, error: null }
  }

  const supabase = createClient()
  if (!supabase) return { success: false, error: 'Cliente no disponible' }

  try {
    const { error } = await supabase.from('almacenes').delete().eq('id', id)
    if (error) return { success: false, error: error.message }
    return { success: true, error: null }
  } catch (err) {
    console.error('[Supabase] Error eliminando almacen:', err)
    return { success: false, error: 'Error de conexion' }
  }
}

// ==================== LOCALIZACIONES ====================

export async function getLocalizaciones(almacenId?: number): Promise<{ data: Localizacion[]; error: string | null }> {
  if (!isSupabaseConfigured()) {
    const saved = localStorage.getItem('localizaciones')
    let localizaciones: Localizacion[] = saved ? JSON.parse(saved) : []
    if (almacenId) {
      localizaciones = localizaciones.filter(l => l.almacen_id === almacenId)
    }
    return { data: localizaciones, error: null }
  }

  const supabase = createClient()
  if (!supabase) return { data: [], error: 'Cliente no disponible' }

  try {
    let query = supabase.from('localizaciones').select('*').order('id', { ascending: true })
    
    if (almacenId) {
      query = query.eq('almacen_id', almacenId)
    }

    const { data, error } = await query
    if (error) return { data: [], error: error.message }

    // Merge del flag "Punto de venta" desde localizaciones_config (tabla nueva,
    // script 041). Si aun no existe, es_punto_venta queda false (sin romper).
    let posSet = new Set<number>()
    try {
      const { data: cfg } = await supabase
        .from('localizaciones_config')
        .select('localizacion_id, es_punto_venta')
      posSet = new Set(
        (cfg || []).filter((c) => c.es_punto_venta).map((c) => Number(c.localizacion_id))
      )
    } catch {
      /* tabla pendiente: sin puntos de venta marcados */
    }
    const merged = (data || []).map((l) => ({ ...l, es_punto_venta: posSet.has(Number(l.id)) }))
    return { data: merged, error: null }
  } catch (err) {
    console.error('[Supabase] Error obteniendo localizaciones:', err)
    return { data: [], error: 'Error de conexion' }
  }
}

/**
 * Marca (o desmarca) una localizacion como "Punto de venta". Solo puede haber
 * UN punto de venta por empresa: al marcar uno, se desmarcan los demas. La
 * localizacion marcada se preselecciona en Nueva Venta.
 */
export async function setPuntoVentaLocalizacion(
  localizacion_id: number,
  value: boolean
): Promise<{ error: string | null }> {
  if (!isSupabaseConfigured()) return { error: null }
  const supabase = createClient()
  if (!supabase) return { error: 'Cliente no disponible' }
  const stamp = await getTenantStamp(supabase)
  if (!isValidStamp(stamp)) return { error: SESION_INVALIDA_ERROR }

  const ahora = new Date().toISOString()
  if (value) {
    // Punto de venta unico: apaga los demas de la empresa.
    await supabase
      .from('localizaciones_config')
      .update({ es_punto_venta: false, updated_at: ahora })
      .eq('razon_social_id', stamp.razon_social_id)
      .eq('es_punto_venta', true)
  }
  const { error } = await supabase
    .from('localizaciones_config')
    .upsert(
      {
        localizacion_id,
        razon_social_id: stamp.razon_social_id,
        es_punto_venta: value,
        usuario: stamp.usuario,
        updated_at: ahora,
      },
      { onConflict: 'localizacion_id' }
    )
  if (error) {
    // Mensaje claro si falta la migracion (tabla nueva sin aplicar).
    if (/does not exist|localizaciones_config|schema cache|PGRST205|relation .* does not exist/i.test(error.message)) {
      return {
        error: 'Falta activar la funcion: aplica scripts/041-localizaciones-punto-venta.sql en Supabase.',
      }
    }
    return { error: error.message }
  }
  return { error: null }
}

export async function saveLocalizacion(
  localizacion: Localizacion,
  isNew: boolean
): Promise<{ data: Localizacion | null; error: string | null }> {
  if (!isSupabaseConfigured()) {
    const saved = localStorage.getItem('localizaciones')
    const localizaciones: Localizacion[] = saved ? JSON.parse(saved) : []
    
    if (isNew) {
      const newLocalizacion = { ...localizacion, id: Date.now() }
      localizaciones.push(newLocalizacion)
      localStorage.setItem('localizaciones', JSON.stringify(localizaciones))
      return { data: newLocalizacion, error: null }
    } else {
      const idx = localizaciones.findIndex(l => l.id === localizacion.id)
      if (idx >= 0) localizaciones[idx] = localizacion
      localStorage.setItem('localizaciones', JSON.stringify(localizaciones))
      return { data: localizacion, error: null }
    }
  }

  const supabase = createClient()
  if (!supabase) return { data: null, error: 'Cliente no disponible' }

  try {
    if (isNew) {
      const stamp = await getTenantStamp(supabase)
      if (!isValidStamp(stamp)) {
        console.log('[saveLocalizacion] Stamp invalido:', stamp)
        return { data: null, error: SESION_INVALIDA_ERROR }
      }

      const { id, ...locData } = localizacion
      const { data, error } = await supabase
        .from('localizaciones')
        .insert({ ...locData, ...stamp })
        .select()
        .single()

      if (error) return { data: null, error: error.message }
      return { data, error: null }
    } else {
      // Update: no tocamos razon_social_id ni usuario originales
      // (aislamiento e historial del creador).
      const { id, ...locData } = localizacion
      const { data, error } = await supabase
        .from('localizaciones')
        .update(locData)
        .eq('id', localizacion.id)
        .select()
        .single()

      if (error) return { data: null, error: error.message }
      return { data, error: null }
    }
  } catch (err) {
    console.error('[Supabase] Error guardando localizacion:', err)
    return { data: null, error: 'Error de conexion' }
  }
}

export async function deleteLocalizacion(id: number): Promise<{ success: boolean; error: string | null }> {
  if (!isSupabaseConfigured()) {
    const saved = localStorage.getItem('localizaciones')
    const localizaciones: Localizacion[] = saved ? JSON.parse(saved) : []
    const filtered = localizaciones.filter(l => l.id !== id)
    localStorage.setItem('localizaciones', JSON.stringify(filtered))
    return { success: true, error: null }
  }

  const supabase = createClient()
  if (!supabase) return { success: false, error: 'Cliente no disponible' }

  try {
    const { error } = await supabase.from('localizaciones').delete().eq('id', id)
    if (error) return { success: false, error: error.message }
    return { success: true, error: null }
  } catch (err) {
    console.error('[Supabase] Error eliminando localizacion:', err)
    return { success: false, error: 'Error de conexion' }
  }
}

// ==================== CLIENTES ====================

/**
 * Devuelve el set de cliente_id DESACTIVADOS del tenant (tabla clientes_inactivos,
 * script 044). Vacio si la tabla no existe todavia (degrada sin romper).
 */
async function getClientesInactivosSet(
  supabase: NonNullable<ReturnType<typeof createClient>>
): Promise<Set<number>> {
  const { data, error } = await supabase.from('clientes_inactivos').select('cliente_id')
  if (error) return new Set() // tabla ausente u otro error -> nadie inactivo
  return new Set((data || []).map((r: { cliente_id: number }) => r.cliente_id))
}

/**
 * Lista de clientes. Por defecto trae TODOS y marca cada uno con `activo`
 * (leyendo `clientes_inactivos`). Con `{ soloActivos: true }` excluye los
 * desactivados: esa variante se usa en los SELECTORES (Nueva Venta, etc.) para
 * que un cliente desactivado no aparezca. La config de Clientes los muestra
 * todos (para poder reactivar) y el historial de ventas no depende de esto.
 */
export async function getClientes(
  opts?: { soloActivos?: boolean }
): Promise<{ data: Cliente[]; error: string | null }> {
  if (!isSupabaseConfigured()) {
    const saved = localStorage.getItem('clientes')
    return { data: saved ? JSON.parse(saved) : [], error: null }
  }

  const supabase = createClient()
  if (!supabase) return { data: [], error: 'Cliente no disponible' }

  try {
    const [{ data, error }, inactivos] = await Promise.all([
      supabase.from('clientes').select('*').order('id', { ascending: true }),
      getClientesInactivosSet(supabase),
    ])

    if (error) return { data: [], error: error.message }
    let lista = (data || []).map((c: Cliente) => ({ ...c, activo: !inactivos.has(c.id!) }))
    if (opts?.soloActivos) lista = lista.filter((c) => c.activo)
    return { data: lista, error: null }
  } catch (err) {
    console.error('[Supabase] Error obteniendo clientes:', err)
    return { data: [], error: 'Error de conexion' }
  }
}

/**
 * Limpia el payload de cliente antes de mandarlo a la BD:
 * - Cadenas vacias en campos opcionales -> null (Postgres acepta NULL en
 *   `fecha_nacimiento DATE`, pero rechaza "" con error de sintaxis).
 * - Trim a strings simples para no guardar espacios accidentales.
 * Devuelve un objeto del mismo shape de Cliente (omitiendo `id`).
 */
function sanitizeClientePayload(
  raw: Omit<Cliente, "id">
): Omit<Cliente, "id"> {
  const blank = (v: unknown) =>
    typeof v === "string" && v.trim() === "" ? null : v
  return {
    ...raw,
    nombre: typeof raw.nombre === "string" ? raw.nombre.trim() : raw.nombre,
    rtn: blank(raw.rtn) as Cliente["rtn"],
    direccion: blank(raw.direccion) as Cliente["direccion"],
    telefono: blank(raw.telefono) as Cliente["telefono"],
    // Critico: si viene "" lo convertimos a null antes de tocar la
    // columna DATE. Mantenemos el valor original si ya es null/undefined.
    fecha_nacimiento: blank(raw.fecha_nacimiento) as Cliente["fecha_nacimiento"],
    // Limite de credito: numero valido >= 0, o null (sin limite).
    limite_credito:
      raw.limite_credito == null || Number.isNaN(Number(raw.limite_credito))
        ? null
        : Math.max(0, Number(raw.limite_credito)),
    // Campos del script officemart-002 (opcionales).
    notas: blank(raw.notas) as Cliente["notas"],
    correo: blank(raw.correo) as Cliente["correo"],
    motivo_bloqueo: blank(raw.motivo_bloqueo) as Cliente["motivo_bloqueo"],
    dias_credito:
      raw.dias_credito == null || raw.dias_credito === ('' as unknown) || Number.isNaN(Number(raw.dias_credito))
        ? null
        : Math.max(0, Math.floor(Number(raw.dias_credito))),
    cliente_relacionado_id: raw.cliente_relacionado_id ? Number(raw.cliente_relacionado_id) : null,
    zona_id: raw.zona_id ? Number(raw.zona_id) : null,
    vendedor_id: raw.vendedor_id ? Number(raw.vendedor_id) : null,
    bloqueado: raw.bloqueado == null ? null : Boolean(raw.bloqueado),
  }
}

/** Columnas de `clientes` que pueden faltar (scripts 010, 064, officemart-002). */
const COLS_CLIENTE_OPCIONALES =
  /telefono|fecha_nacimiento|limite_credito|notas|correo|dias_credito|cliente_relacionado_id|bloqueado|motivo_bloqueo|zona_id|vendedor_id/i

/** Quita del payload las columnas opcionales (para reintentar en bases sin ellas). */
function sinColumnasOpcionalesCliente(data: Omit<Cliente, 'id'>): Omit<Cliente, 'id'> {
  const {
    telefono: _t, fecha_nacimiento: _f, limite_credito: _l,
    notas: _n, correo: _c, dias_credito: _d, cliente_relacionado_id: _r,
    bloqueado: _b, motivo_bloqueo: _m, zona_id: _z, vendedor_id: _v,
    ...resto
  } = data
  return resto
}

export async function saveCliente(
  cliente: Cliente,
  isNew: boolean
): Promise<{ data: Cliente | null; error: string | null }> {
  if (!isSupabaseConfigured()) {
    const saved = localStorage.getItem('clientes')
    const clientes: Cliente[] = saved ? JSON.parse(saved) : []
    
    if (isNew) {
      const newCliente = { ...cliente, id: Date.now() }
      clientes.push(newCliente)
      localStorage.setItem('clientes', JSON.stringify(clientes))
      return { data: newCliente, error: null }
    } else {
      const idx = clientes.findIndex(c => c.id === cliente.id)
      if (idx >= 0) clientes[idx] = cliente
      localStorage.setItem('clientes', JSON.stringify(clientes))
      return { data: cliente, error: null }
    }
  }

  const supabase = createClient()
  if (!supabase) return { data: null, error: 'Cliente no disponible' }

  try {
    if (isNew) {
      const stamp = await getTenantStamp(supabase)
      if (!isValidStamp(stamp)) {
        console.log('[saveCliente] Stamp invalido:', stamp)
        return { data: null, error: SESION_INVALIDA_ERROR }
      }

      const { id, ...rawData } = cliente
      // Sanitiza campos opcionales: cadenas vacias -> null. Es critico
      // para `fecha_nacimiento` (columna DATE) porque Postgres rechaza
      // "" con `invalid input syntax for type date`. Aplicamos el mismo
      // criterio a rtn/direccion/telefono para no guardar strings vacios.
      const clienteData = sanitizeClientePayload(rawData)
      let { data, error } = await supabase
        .from('clientes')
        .insert({ ...clienteData, ...stamp })
        .select()
        .single()

      // Fallback: si alguna columna opcional aun no existe (scripts 010/064/
      // officemart-002 pendientes), reintentamos sin esos campos para no
      // bloquear la creacion del cliente. El stamp con razon_social_id se
      // mantiene intacto.
      if (error && COLS_CLIENTE_OPCIONALES.test(error.message || '')) {
        console.warn(
          '[saveCliente] Columnas opcionales ausentes. Aplica scripts/010, 064 y officemart-002.'
        )
        const retry = await supabase
          .from('clientes')
          .insert({ ...sinColumnasOpcionalesCliente(clienteData), ...stamp })
          .select()
          .single()
        data = retry.data
        error = retry.error
      }

      if (error) return { data: null, error: error.message }
      return { data, error: null }
    } else {
      // Update: no tocamos razon_social_id ni usuario originales
      // (aislamiento e historial del creador).
      const { id, ...rawData } = cliente
      const clienteData = sanitizeClientePayload(rawData)
      let { data, error } = await supabase
        .from('clientes')
        .update(clienteData)
        .eq('id', cliente.id)
        .select()
        .single()

      // Mismo fallback que en insert.
      if (error && COLS_CLIENTE_OPCIONALES.test(error.message || '')) {
        console.warn('[saveCliente] Columnas opcionales ausentes (update).')
        const retry = await supabase
          .from('clientes')
          .update(sinColumnasOpcionalesCliente(clienteData))
          .eq('id', cliente.id)
          .select()
          .single()
        data = retry.data
        error = retry.error
      }

      if (error) return { data: null, error: error.message }
      return { data, error: null }
    }
  } catch (err) {
    console.error('[Supabase] Error guardando cliente:', err)
    return { data: null, error: 'Error de conexion' }
  }
}

/** Cuenta las ventas de un cliente (para decidir borrar vs. desactivar). */
export async function contarVentasCliente(
  id: number
): Promise<{ count: number; error: string | null }> {
  if (!isSupabaseConfigured()) return { count: 0, error: null }
  const supabase = createClient()
  if (!supabase) return { count: 0, error: 'Cliente no disponible' }
  const { count, error } = await supabase
    .from('ventas_encabezado')
    .select('id', { count: 'exact', head: true })
    .eq('cliente_id', id)
  if (error) {
    if (esTablaAusente(error)) return { count: 0, error: null }
    return { count: 0, error: error.message }
  }
  return { count: count || 0, error: null }
}

/**
 * Borra o desactiva un cliente segun tenga transacciones:
 * - Sin ventas -> borrado fisico (y limpia su lista de precios asignada).
 * - Con ventas -> se DESACTIVA (insert en clientes_inactivos): deja de aparecer
 *   en los selectores pero sigue en el historial de ventas (el nombre viene por
 *   join a `clientes`, que permanece). Devuelve el modo aplicado.
 */
export async function deleteCliente(
  id: number
): Promise<{ success: boolean; modo: 'borrado' | 'desactivado' | null; error: string | null }> {
  if (!isSupabaseConfigured()) {
    const saved = localStorage.getItem('clientes')
    const clientes: Cliente[] = saved ? JSON.parse(saved) : []
    localStorage.setItem('clientes', JSON.stringify(clientes.filter(c => c.id !== id)))
    return { success: true, modo: 'borrado', error: null }
  }

  const supabase = createClient()
  if (!supabase) return { success: false, modo: null, error: 'Cliente no disponible' }

  try {
    const { count, error: cErr } = await contarVentasCliente(id)
    if (cErr) return { success: false, modo: null, error: cErr }

    if (count > 0) {
      // Tiene historial: desactivar (no se puede borrar sin romper las ventas).
      const stamp = await getTenantStamp(supabase)
      if (!isValidStamp(stamp)) return { success: false, modo: null, error: SESION_INVALIDA_ERROR }
      const { error } = await supabase
        .from('clientes_inactivos')
        .upsert({ cliente_id: id, ...stamp }, { onConflict: 'cliente_id' })
      if (error) {
        if (esTablaAusente(error)) {
          return {
            success: false,
            modo: null,
            error: 'Este cliente tiene ventas y no se puede borrar. Aplica scripts/044-clientes-inactivos.sql para poder desactivarlo.',
          }
        }
        return { success: false, modo: null, error: error.message }
      }
      return { success: true, modo: 'desactivado', error: null }
    }

    // Sin ventas: borrado fisico. Limpia primero su lista de precios asignada.
    const delLista = await supabase.from('cliente_lista_precio').delete().eq('cliente_id', id)
    if (delLista.error && !esTablaAusente(delLista.error)) {
      console.warn('[deleteCliente] No se pudo limpiar cliente_lista_precio:', delLista.error.message)
    }
    const { error } = await supabase.from('clientes').delete().eq('id', id)
    if (error) return { success: false, modo: null, error: error.message }
    return { success: true, modo: 'borrado', error: null }
  } catch (err) {
    console.error('[Supabase] Error eliminando cliente:', err)
    return { success: false, modo: null, error: 'Error de conexion' }
  }
}

/** Reactiva un cliente desactivado (lo quita de clientes_inactivos). */
export async function reactivarCliente(
  id: number
): Promise<{ success: boolean; error: string | null }> {
  if (!isSupabaseConfigured()) return { success: true, error: null }
  const supabase = createClient()
  if (!supabase) return { success: false, error: 'Cliente no disponible' }
  const { error } = await supabase.from('clientes_inactivos').delete().eq('cliente_id', id)
  if (error) {
    if (esTablaAusente(error)) return { success: true, error: null }
    return { success: false, error: error.message }
  }
  return { success: true, error: null }
}

// ==================== PROVEEDORES ====================

export async function getProveedores(): Promise<{ data: Proveedor[]; error: string | null }> {
  if (!isSupabaseConfigured()) {
    const saved = localStorage.getItem('proveedores')
    return { data: saved ? JSON.parse(saved) : [], error: null }
  }

  const supabase = createClient()
  if (!supabase) return { data: [], error: 'Cliente no disponible' }

  try {
    const { data, error } = await supabase
      .from('proveedores')
      .select('*')
      .order('id', { ascending: true })

    if (error) return { data: [], error: error.message }
    return { data: data || [], error: null }
  } catch (err) {
    console.error('[Supabase] Error obteniendo proveedores:', err)
    return { data: [], error: 'Error de conexion' }
  }
}

export async function saveProveedor(
  proveedor: Proveedor,
  isNew: boolean
): Promise<{ data: Proveedor | null; error: string | null }> {
  if (!isSupabaseConfigured()) {
    const saved = localStorage.getItem('proveedores')
    const proveedores: Proveedor[] = saved ? JSON.parse(saved) : []
    
    if (isNew) {
      const newProveedor = { ...proveedor, id: Date.now() }
      proveedores.push(newProveedor)
      localStorage.setItem('proveedores', JSON.stringify(proveedores))
      return { data: newProveedor, error: null }
    } else {
      const idx = proveedores.findIndex(p => p.id === proveedor.id)
      if (idx >= 0) proveedores[idx] = proveedor
      localStorage.setItem('proveedores', JSON.stringify(proveedores))
      return { data: proveedor, error: null }
    }
  }

  const supabase = createClient()
  if (!supabase) return { data: null, error: 'Cliente no disponible' }

  try {
    const { id, created_at: _c, ...rawData } = proveedor
    const proveedorData = sanitizeProveedorPayload(rawData)

    if (isNew) {
      const stamp = await getTenantStamp(supabase)
      if (!isValidStamp(stamp)) {
        console.log('[saveProveedor] Stamp invalido:', stamp)
        return { data: null, error: SESION_INVALIDA_ERROR }
      }

      let { data, error } = await supabase
        .from('proveedores')
        .insert({ ...proveedorData, ...stamp })
        .select()
        .single()

      // Fallback: columnas del script officemart-002 ausentes -> reintentar sin ellas.
      if (error && COLS_PROVEEDOR_OPCIONALES.test(error.message || '')) {
        console.warn('[saveProveedor] Columnas opcionales ausentes. Aplica scripts/officemart-002-cimientos.sql.')
        const retry = await supabase
          .from('proveedores')
          .insert({ ...sinColumnasOpcionalesProveedor(proveedorData), ...stamp })
          .select()
          .single()
        data = retry.data
        error = retry.error
      }

      if (error) return { data: null, error: error.message }
      return { data, error: null }
    } else {
      // Update: no tocamos razon_social_id ni usuario originales
      // (aislamiento e historial del creador).
      let { data, error } = await supabase
        .from('proveedores')
        .update(proveedorData)
        .eq('id', id)
        .select()
        .single()

      if (error && COLS_PROVEEDOR_OPCIONALES.test(error.message || '')) {
        console.warn('[saveProveedor] Columnas opcionales ausentes (update).')
        const retry = await supabase
          .from('proveedores')
          .update(sinColumnasOpcionalesProveedor(proveedorData))
          .eq('id', id)
          .select()
          .single()
        data = retry.data
        error = retry.error
      }

      if (error) return { data: null, error: error.message }
      return { data, error: null }
    }
  } catch (err) {
    console.error('[Supabase] Error guardando proveedor:', err)
    return { data: null, error: 'Error de conexion' }
  }
}

/** Columnas de `proveedores` que pueden faltar (script officemart-002). */
const COLS_PROVEEDOR_OPCIONALES = /correo|telefono|direccion|notas|moneda|pais|dias_credito/i

function sinColumnasOpcionalesProveedor(data: Omit<Proveedor, 'id'>): Omit<Proveedor, 'id'> {
  const { correo: _c, telefono: _t, direccion: _d, notas: _n, moneda: _m, pais: _p, dias_credito: _dc, ...resto } = data
  return resto
}

/** Cadenas vacias -> null; dias_credito a entero >= 0 o null; moneda en mayusculas. */
function sanitizeProveedorPayload(raw: Omit<Proveedor, 'id'>): Omit<Proveedor, 'id'> {
  const blank = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : typeof v === 'string' ? v.trim() : v)
  return {
    ...raw,
    nombre: (raw.nombre || '').trim(),
    rtn: blank(raw.rtn) as Proveedor['rtn'],
    contacto: blank(raw.contacto) as Proveedor['contacto'],
    correo: blank(raw.correo) as Proveedor['correo'],
    telefono: blank(raw.telefono) as Proveedor['telefono'],
    direccion: blank(raw.direccion) as Proveedor['direccion'],
    notas: blank(raw.notas) as Proveedor['notas'],
    moneda: (blank(raw.moneda) as string | null)?.toUpperCase() ?? null,
    pais: blank(raw.pais) as Proveedor['pais'],
    dias_credito:
      raw.dias_credito == null || raw.dias_credito === ('' as unknown) || Number.isNaN(Number(raw.dias_credito))
        ? null
        : Math.max(0, Math.floor(Number(raw.dias_credito))),
  }
}

export async function deleteProveedor(id: number): Promise<{ success: boolean; error: string | null }> {
  if (!isSupabaseConfigured()) {
    const saved = localStorage.getItem('proveedores')
    const proveedores: Proveedor[] = saved ? JSON.parse(saved) : []
    const filtered = proveedores.filter(p => p.id !== id)
    localStorage.setItem('proveedores', JSON.stringify(filtered))
    return { success: true, error: null }
  }

  const supabase = createClient()
  if (!supabase) return { success: false, error: 'Cliente no disponible' }

  try {
    const { error } = await supabase.from('proveedores').delete().eq('id', id)
    if (error) return { success: false, error: error.message }
    return { success: true, error: null }
  } catch (err) {
    console.error('[Supabase] Error eliminando proveedor:', err)
    return { success: false, error: 'Error de conexion' }
  }
}
