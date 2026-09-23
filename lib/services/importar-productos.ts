import * as XLSX from "xlsx"
import {
  getProductos, getCategorias, getMarcas, getSubcategorias, getAlmacenes, getLocalizaciones,
  getLineasProducto, saveProducto, type Producto,
} from "@/lib/services/catalogos"
import { procesarIngresoManual } from "@/lib/services/inventario"

// ==================== TIPOS ====================

/** Una fila del Excel (un producto). */
export interface FilaProductoImport {
  fila: number // numero de fila en el Excel (para reportar errores)
  codigo: string
  nombre: string
  categoria: string
  marca: string
  /** Linea de producto (por nombre; opcional, script officemart-002). */
  linea: string
  talla: string
  precio_venta: number
  costo_unitario: number
  cantidad_inicial: number
}

/** Opciones que el usuario elige (aplican al inventario inicial de todo el archivo). */
export interface OpcionesImportProductos {
  almacen_id: number
  localizacion_id: number
  /**
   * Si un producto ya existe (mismo codigo/nombre): true genera el ingreso de
   * inventario a sus existencias con la cantidad/costo de la fila; false lo omite.
   */
  generarIngresoADuplicados?: boolean
}

/** Resumen previo (validacion) que se muestra antes de confirmar. */
export interface PreviewProductos {
  total: number
  nuevos: number
  duplicados: string[] // codigos/nombres ya existentes
  duplicadosConCantidad: number // duplicados con Cantidad Inicial > 0 (candidatos a ingreso)
  unidadesDuplicados: number // Σ cantidad de los duplicados
  valorDuplicados: number // Σ cantidad × costo de los duplicados
  sinNombre: number // filas sin nombre (invalidas)
  categoriasNoEncontradas: string[]
  marcasNoEncontradas: string[]
  lineasNoEncontradas: string[]
  valorInventarioInicial: number // Σ cantidad × costo (solo productos nuevos)
  unidadesIniciales: number // Σ cantidad (solo productos nuevos)
  error: string | null
}

export interface ResultadoProducto {
  identificador: string
  estado: "creado" | "omitido" | "error" | "sin_inventario" | "ingreso_existente"
  detalle?: string
}

export interface ResultadoImportProductos {
  creados: number
  omitidos: number
  errores: number
  conInventario: number
  sinInventario: number
  ingresosExistentes: number // ingresos generados a productos que ya existian
  productos: ResultadoProducto[]
}

// ==================== PARSEO ====================

function num(v: unknown): number {
  if (typeof v === "number") return v
  if (typeof v === "string") {
    // Acepta "1.505,40" y "1505.4".
    const limpio = v.replace(/\s/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".")
    const n = parseFloat(limpio)
    return Number.isFinite(n) ? n : 0
  }
  return 0
}

function str(v: unknown): string {
  if (v == null) return ""
  return String(v).trim()
}

/** Normaliza un encabezado: sin acentos, minusculas, y "_"/espacios -> 1 espacio. */
function normHeader(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // quita acentos
    .replace(/[\s_]+/g, " ") // guiones bajos y espacios -> un espacio
    .trim()
}

/**
 * Toma el valor de la primera columna cuyo encabezado matchee alguno de los
 * alias. Tolerante a acentos, mayusculas y a "_" vs espacios: asi
 * "cantidad_inicial", "Cantidad Inicial" y "cantidad inicial" son lo mismo.
 */
function col(row: Record<string, unknown>, alias: string[]): unknown {
  const keys = Object.keys(row)
  for (const a of alias) {
    const na = normHeader(a)
    const k = keys.find((k) => normHeader(k) === na)
    if (k != null) return row[k]
  }
  return undefined
}

/** Parsea el archivo Excel a filas normalizadas. Tolerante a tildes/variaciones. */
export async function parsearArchivoProductos(file: File): Promise<FilaProductoImport[]> {
  const buffer = await file.arrayBuffer()
  const wb = XLSX.read(buffer, { type: "array" })
  // Usa la hoja "Productos" si existe (la plantilla trae tambien "Referencias");
  // si no, la primera hoja.
  const sheetName = wb.SheetNames.find((n) => normHeader(n) === "productos") ?? wb.SheetNames[0]
  const ws = wb.Sheets[sheetName]
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" })

  const filas: FilaProductoImport[] = []
  rows.forEach((row, i) => {
    const nombre = str(col(row, ["Nombre", "Producto", "Descripcion", "Descripción"]))
    const codigo = str(col(row, ["Codigo de Barras", "Código de Barras", "Codigo Barras", "Codigo", "Código", "SKU"]))
    // Filas totalmente vacias (sin nombre ni codigo) se ignoran.
    if (!nombre && !codigo) return

    filas.push({
      fila: i + 2, // +2: fila 1 es el encabezado y sheet_to_json es 0-based
      codigo,
      nombre,
      categoria: str(col(row, ["Categoria", "Categoría"])),
      marca: str(col(row, ["Marca"])),
      linea: str(col(row, ["Linea", "Línea", "Linea de Producto", "Línea de Producto"])),
      talla: str(col(row, ["Talla"])),
      precio_venta: num(col(row, ["Precio Venta", "Precio de Venta", "Precio", "Precio Unitario"])),
      costo_unitario: num(col(row, ["Costo Unitario", "Costo", "Costo Unit", "Costo Unit."])),
      cantidad_inicial: num(col(row, ["Cantidad Inicial", "Cantidad", "Stock Inicial", "Existencias"])),
    })
  })
  return filas
}

// ==================== CONTEXTO ====================

async function cargarContexto(): Promise<{
  porCodigo: Map<string, Producto>
  porNombre: Map<string, Producto>
  catPorNombre: Map<string, number>
  marcaPorNombre: Map<string, number>
  lineaPorNombre: Map<string, number>
}> {
  const [prodRes, catRes, marcaRes, lineaRes] = await Promise.all([
    getProductos(), getCategorias(), getMarcas(), getLineasProducto(),
  ])

  const porCodigo = new Map<string, Producto>()
  const porNombre = new Map<string, Producto>()
  for (const p of prodRes.data || []) {
    if (p.codigo_barras) porCodigo.set(p.codigo_barras.trim().toLowerCase(), p)
    if (p.nombre) porNombre.set(p.nombre.trim().toLowerCase(), p)
  }

  const catPorNombre = new Map<string, number>()
  for (const c of catRes.data || []) if (c.id != null) catPorNombre.set(c.nombre.trim().toLowerCase(), c.id)

  const marcaPorNombre = new Map<string, number>()
  for (const m of marcaRes.data || []) if (m.id != null) marcaPorNombre.set(m.nombre.trim().toLowerCase(), m.id)

  const lineaPorNombre = new Map<string, number>()
  for (const l of lineaRes.data || []) if (l.id != null) lineaPorNombre.set(l.nombre.trim().toLowerCase(), l.id)

  return { porCodigo, porNombre, catPorNombre, marcaPorNombre, lineaPorNombre }
}

// ==================== PREVIEW ====================

export async function previsualizarImportProductos(filas: FilaProductoImport[]): Promise<PreviewProductos> {
  const vacio: PreviewProductos = {
    total: 0, nuevos: 0, duplicados: [], duplicadosConCantidad: 0,
    unidadesDuplicados: 0, valorDuplicados: 0, sinNombre: 0,
    categoriasNoEncontradas: [], marcasNoEncontradas: [], lineasNoEncontradas: [],
    valorInventarioInicial: 0, unidadesIniciales: 0, error: null,
  }
  if (filas.length === 0) return { ...vacio, error: "El archivo no tiene filas válidas" }

  const ctx = await cargarContexto()
  const duplicados: string[] = []
  const catNo = new Set<string>()
  const marcaNo = new Set<string>()
  const lineaNo = new Set<string>()
  const vistosCodigo = new Set<string>()
  const vistosNombre = new Set<string>()
  let sinNombre = 0, valor = 0, unidades = 0, nuevos = 0
  let dupConCant = 0, unidadesDup = 0, valorDup = 0

  for (const f of filas) {
    if (!f.nombre) { sinNombre++; continue }
    const codigoKey = f.codigo.trim().toLowerCase()
    const nombreKey = f.nombre.trim().toLowerCase()
    // "Ya existe" = mismo CÓDIGO (clave única). Solo si la fila NO trae código
    // se usa el nombre como respaldo (para no crear productos sin código dobles).
    const dup = codigoKey
      ? (ctx.porCodigo.has(codigoKey) || vistosCodigo.has(codigoKey))
      : (ctx.porNombre.has(nombreKey) || vistosNombre.has(nombreKey))
    if (dup) {
      duplicados.push(f.codigo || f.nombre)
      if (f.cantidad_inicial > 0) {
        dupConCant++
        unidadesDup += f.cantidad_inicial
        valorDup += f.cantidad_inicial * f.costo_unitario
      }
      continue
    }

    if (codigoKey) vistosCodigo.add(codigoKey)
    vistosNombre.add(nombreKey)
    nuevos++
    if (f.categoria && !ctx.catPorNombre.has(f.categoria.trim().toLowerCase())) catNo.add(f.categoria)
    if (f.marca && !ctx.marcaPorNombre.has(f.marca.trim().toLowerCase())) marcaNo.add(f.marca)
    if (f.linea && !ctx.lineaPorNombre.has(f.linea.trim().toLowerCase())) lineaNo.add(f.linea)
    if (f.cantidad_inicial > 0) {
      unidades += f.cantidad_inicial
      valor += f.cantidad_inicial * f.costo_unitario
    }
  }

  return {
    total: filas.length,
    nuevos,
    duplicados,
    duplicadosConCantidad: dupConCant,
    unidadesDuplicados: unidadesDup,
    valorDuplicados: +valorDup.toFixed(2),
    sinNombre,
    categoriasNoEncontradas: [...catNo],
    marcasNoEncontradas: [...marcaNo],
    lineasNoEncontradas: [...lineaNo],
    valorInventarioInicial: +valor.toFixed(2),
    unidadesIniciales: unidades,
    error: null,
  }
}

// ==================== IMPORTACION ====================

export async function importarProductos(
  filas: FilaProductoImport[],
  opciones: OpcionesImportProductos
): Promise<{ data: ResultadoImportProductos | null; error: string | null }> {
  if (filas.length === 0) return { data: null, error: "El archivo no tiene filas válidas" }

  const ctx = await cargarContexto()
  const generarDup = !!opciones.generarIngresoADuplicados

  // ¿Se necesita almacen/bodega? Si hay filas NUEVAS con cantidad, o si se van a
  // generar ingresos a DUPLICADOS con cantidad (segun la opcion elegida).
  const necesitaInventario = filas.some((f) => {
    if (!f.nombre || f.cantidad_inicial <= 0) return false
    const codigoKey = f.codigo.trim().toLowerCase()
    const nombreKey = f.nombre.trim().toLowerCase()
    const existe = codigoKey ? ctx.porCodigo.has(codigoKey) : ctx.porNombre.has(nombreKey)
    return existe ? generarDup : true
  })
  if (necesitaInventario && (!opciones.almacen_id || !opciones.localizacion_id)) {
    return { data: null, error: "Selecciona el almacén y la bodega para el inventario inicial." }
  }

  const resultado: ResultadoImportProductos = {
    creados: 0, omitidos: 0, errores: 0, conInventario: 0, sinInventario: 0, ingresosExistentes: 0, productos: [],
  }

  const generarIngreso = (productoId: number, f: FilaProductoImport) =>
    procesarIngresoManual({
      producto_id: productoId,
      almacen_id: opciones.almacen_id,
      localizacion_id: opciones.localizacion_id,
      cantidad: f.cantidad_inicial,
      costo_unitario: f.costo_unitario,
      observaciones: "Inventario inicial (carga masiva)",
      stock_anterior: 0,
      costo_anterior: 0,
      nuevo_stock: f.cantidad_inicial,
      nuevo_costo: f.costo_unitario,
    })

  for (const f of filas) {
    const id = f.codigo || f.nombre || `fila ${f.fila}`

    if (!f.nombre) {
      resultado.errores++
      resultado.productos.push({ identificador: `fila ${f.fila}`, estado: "error", detalle: "Sin nombre de producto" })
      continue
    }

    const codigoKey = f.codigo.trim().toLowerCase()
    const nombreKey = f.nombre.trim().toLowerCase()
    // Coincidencia por CÓDIGO (clave única); solo sin código se usa el nombre.
    const existente = codigoKey ? ctx.porCodigo.get(codigoKey) : ctx.porNombre.get(nombreKey)

    // ----- Producto ya existe -----
    if (existente) {
      if (generarDup && f.cantidad_inicial > 0 && existente.id != null) {
        // "Este producto ya existe": se genera el ingreso a sus existencias.
        const ing = await generarIngreso(existente.id, f)
        if (ing.error) {
          resultado.errores++
          resultado.productos.push({ identificador: id, estado: "error", detalle: `Ya existía; no se pudo generar el ingreso: ${ing.error}` })
        } else {
          resultado.ingresosExistentes++
          resultado.conInventario++
          resultado.productos.push({ identificador: id, estado: "ingreso_existente", detalle: `Ya existía; ingreso de ${f.cantidad_inicial} u. a sus existencias` })
        }
      } else {
        resultado.omitidos++
        resultado.productos.push({ identificador: id, estado: "omitido", detalle: "Ya existe un producto con ese código o nombre" })
      }
      continue
    }

    // ----- Producto nuevo: crear -----
    const categoria_id = f.categoria ? ctx.catPorNombre.get(f.categoria.trim().toLowerCase()) ?? null : null
    const marca_id = f.marca ? ctx.marcaPorNombre.get(f.marca.trim().toLowerCase()) ?? null : null
    const linea_id = f.linea ? ctx.lineaPorNombre.get(f.linea.trim().toLowerCase()) ?? null : null

    const productoData: Producto = {
      nombre: f.nombre,
      codigo_barras: f.codigo,
      precio_venta_sugerido: f.precio_venta,
      costo_promedio: f.costo_unitario,
      categoria_id,
      marca_id,
      subcategoria_id: null,
      linea_id,
      talla: f.talla || null,
      foto_url: "",
    }

    const { data: creado, error } = await saveProducto(productoData, true)
    if (error || !creado?.id) {
      resultado.errores++
      resultado.productos.push({ identificador: id, estado: "error", detalle: error || "No se pudo crear el producto" })
      continue
    }

    resultado.creados++
    // Registra el nuevo producto en el contexto para dedup dentro del archivo
    // (si aparece otra vez mas abajo, se tratara como duplicado).
    if (codigoKey) ctx.porCodigo.set(codigoKey, creado)
    ctx.porNombre.set(nombreKey, creado)

    // Inventario inicial: genera el "Ingreso Manual" con la cantidad y costo.
    if (f.cantidad_inicial > 0) {
      const ing = await generarIngreso(creado.id, f)
      if (ing.error) {
        resultado.sinInventario++
        resultado.productos.push({ identificador: id, estado: "sin_inventario", detalle: `Creado, pero sin inventario inicial: ${ing.error}` })
      } else {
        resultado.conInventario++
        resultado.productos.push({ identificador: id, estado: "creado" })
      }
    } else {
      resultado.productos.push({ identificador: id, estado: "creado" })
    }
  }

  return { data: resultado, error: null }
}

// ==================== PLANTILLA ====================

/**
 * Descarga una plantilla .xlsx (via exceljs) con dos hojas:
 *  - "Productos": columnas esperadas + filas de ejemplo, con DESPLEGABLES
 *    (data validation tipo lista) en Categoria y Marca que apuntan a la hoja
 *    Referencias. No son obligatorios: se puede escribir un valor nuevo (el
 *    producto se crea igual, sin ese dato si no coincide).
 *  - "Referencias": una columna por catalogo (categorias, marcas, subcategorias,
 *    almacenes y bodegas) registrados de la empresa (por tenant via RLS).
 * exceljs se carga bajo demanda para no engordar el bundle principal.
 */
export async function descargarPlantillaProductos(): Promise<void> {
  const [catRes, marcaRes, subRes, almRes, locRes, lineaRes] = await Promise.all([
    getCategorias(), getMarcas(), getSubcategorias(), getAlmacenes(), getLocalizaciones(), getLineasProducto(),
  ])
  const categorias = (catRes.data || []).map((c) => c.nombre)
  const marcas = (marcaRes.data || []).map((m) => m.nombre)
  const subcategorias = (subRes.data || []).map((s) => s.nombre)
  const lineas = (lineaRes.data || []).map((l) => l.nombre)
  const almacenes = almRes.data || []
  const localizaciones = locRes.data || []
  const almNombre = new Map<number, string>()
  for (const a of almacenes) if (a.id != null) almNombre.set(a.id, a.nombre)
  const bodegas = localizaciones.map((l) => `${almNombre.get(l.almacen_id) ?? "?"} / ${l.nombre}`)

  const ExcelJS = (await import("exceljs")).default
  const wb = new ExcelJS.Workbook()
  // "Productos" primero (el archivo abre en esa hoja); "Referencias" de segunda.
  const ws = wb.addWorksheet("Productos")

  // ----- Hoja "Referencias" (una columna por catalogo) -----
  const ref = wb.addWorksheet("Referencias")
  ref.columns = [
    { header: "Categorias", width: 26 },
    { header: "Marcas", width: 26 },
    { header: "Subcategorias", width: 26 },
    { header: "Almacenes", width: 24 },
    { header: "Bodegas / Localizaciones", width: 34 },
    { header: "Lineas", width: 26 },
  ]
  ref.getRow(1).font = { bold: true }
  const maxRows = Math.max(
    categorias.length, marcas.length, subcategorias.length, almacenes.length, bodegas.length, lineas.length
  )
  for (let i = 0; i < maxRows; i++) {
    ref.addRow([
      categorias[i] ?? "",
      marcas[i] ?? "",
      subcategorias[i] ?? "",
      almacenes[i]?.nombre ?? "",
      bodegas[i] ?? "",
      lineas[i] ?? "",
    ])
  }

  // ----- Hoja "Productos" (creada arriba para que sea la primera) -----
  ws.columns = [
    { header: "Codigo de Barras", width: 18 },
    { header: "Nombre", width: 28 },
    { header: "Categoria", width: 18 },
    { header: "Marca", width: 18 },
    { header: "Linea", width: 18 },
    { header: "Talla", width: 8 },
    { header: "Precio Venta", width: 14 },
    { header: "Costo Unitario", width: 14 },
    { header: "Cantidad Inicial", width: 14 },
  ]
  ws.getRow(1).font = { bold: true }
  ws.addRow(["CB-001", "Camisa Polo Azul", categorias[0] ?? "Ropa", marcas[0] ?? "Marca X", lineas[0] ?? "", "M", 350, 180, 20])
  ws.addRow(["CB-002", "Pantalon Jean", categorias[0] ?? "Ropa", marcas[1] ?? marcas[0] ?? "Marca Y", lineas[0] ?? "", "32", 650, 300, 10])

  // Desplegables en Categoria (col C), Marca (col D) y Linea (col E), apuntando
  // a Referencias. showErrorMessage:false => es una ayuda, no bloquea escribir
  // un valor nuevo.
  const FILAS = 500
  if (categorias.length > 0) {
    const rango = `Referencias!$A$2:$A$${categorias.length + 1}`
    for (let r = 2; r <= FILAS + 1; r++) {
      ws.getCell(`C${r}`).dataValidation = { type: "list", allowBlank: true, formulae: [rango], showErrorMessage: false }
    }
  }
  if (marcas.length > 0) {
    const rango = `Referencias!$B$2:$B$${marcas.length + 1}`
    for (let r = 2; r <= FILAS + 1; r++) {
      ws.getCell(`D${r}`).dataValidation = { type: "list", allowBlank: true, formulae: [rango], showErrorMessage: false }
    }
  }
  if (lineas.length > 0) {
    const rango = `Referencias!$F$2:$F$${lineas.length + 1}`
    for (let r = 2; r <= FILAS + 1; r++) {
      ws.getCell(`E${r}`).dataValidation = { type: "list", allowBlank: true, formulae: [rango], showErrorMessage: false }
    }
  }

  const buffer = await wb.xlsx.writeBuffer()
  const blob = new Blob([buffer as ArrayBuffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = "Plantilla_Carga_Productos.xlsx"
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 100)
}
