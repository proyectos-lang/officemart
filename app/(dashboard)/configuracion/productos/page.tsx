"use client"

import { useState, useEffect, useMemo, Fragment } from "react"
import {
  Plus,
  Package,
  Pencil,
  Trash2,
  Loader2,
  Upload,
  ImageIcon,
  Calculator,
  Percent,
  DollarSign,
  Tag,
  Layers,
  Search,
  Settings2,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  ImageDown,
  ChevronRight,
  ChevronDown,
  Layers3,
  Link2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { TablePaginator } from "@/components/ui/table-paginator"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Spinner } from "@/components/ui/spinner"
import { useToast } from "@/hooks/use-toast"
import {
  Producto,
  Marca,
  Categoria,
  Subcategoria,
  type Almacen,
  type Localizacion,
  getProductos,
  saveProducto,
  deleteProducto,
  getProductoDependencias,
  uploadProductoImage,
  importarImagenDeUrl,
  recomprimirFotosProductos,
  type ProgresoRecompresion,
  getMarcas,
  createMarca,
  getCategorias,
  createCategoria,
  getSubcategorias,
  getAlmacenes,
  getLocalizaciones,
  getLineasProducto,
  createLineaProducto,
  type LineaProducto,
} from "@/lib/services/catalogos"
import { procesarIngresoManual } from "@/lib/services/inventario"
import {
  getGruposTallas,
  crearGrupoConProductos,
  agregarProductoAGrupo,
  quitarDeGrupo,
  GRUPOS_TALLAS_FEATURE_PENDING,
  type GrupoTallaRef,
} from "@/lib/services/grupos-tallas"
import { getRepartoInfo, convertirProductoATallado } from "@/lib/services/convertir-tallado"
import { getProductosFabricados, setProductoFabricado } from "@/lib/services/productos-fabricados"
import { formatCurrency } from "@/lib/utils/format"
import { useTenant } from "@/lib/hooks/use-tenant"
import { useAuth } from "@/lib/contexts/auth-context"
import { ImportarProductosDialog } from "./importar-productos-dialog"
import { ManageCategoriasDialog } from "@/components/productos/manage-categorias-dialog"

// Tallas predefinidas para el creador rapido "por tallas". El usuario marca
// las que aplican y al guardar se crea un producto independiente por cada una
// (mismo nombre + talla, su propio stock/codigo). Puede escribir otras a mano.
const TALLAS_PRESET = ["S", "M", "L", "XL", "6", "8", "10", "12", "14", "16"] as const

// Columnas por las que se puede ordenar la tabla de productos.
type SortKey =
  | "nombre"
  | "codigo_barras"
  | "marca_nombre"
  | "categoria_nombre"
  | "subcategoria_nombre"
  | "linea_nombre"
  | "precio_venta_sugerido"
  | "costo_promedio"
  | "ganancia"
  | "margen"
  | "stock_total"

/** Encabezado clickeable que ordena la tabla por su columna (1er click = mayor a menor). */
function SortHeader({
  label,
  sortField,
  sortKey,
  sortDir,
  onSort,
  align = "left",
}: {
  label: string
  sortField: SortKey
  sortKey: SortKey | null
  sortDir: "asc" | "desc"
  onSort: (k: SortKey) => void
  align?: "left" | "right"
}) {
  const active = sortKey === sortField
  const Icon = !active ? ArrowUpDown : sortDir === "desc" ? ArrowDown : ArrowUp
  return (
    <TableHead className={align === "right" ? "text-right" : undefined}>
      <button
        type="button"
        onClick={() => onSort(sortField)}
        className={`inline-flex items-center gap-1 select-none hover:text-stone-900 ${active ? "text-stone-900 font-semibold" : "text-stone-600"}`}
      >
        {label}
        <Icon className={`h-3.5 w-3.5 ${active ? "opacity-90" : "opacity-40"}`} />
      </button>
    </TableHead>
  )
}

export default function ProductosConfigPage() {
  const { toast } = useToast()
  const { ready, razonSocialId } = useTenant()
  const { user, hasModulo } = useAuth()
  // Sistema de productos por talla: solo si la empresa lo tiene activo (flag del
  // super-admin). Si esta apagado, ni el check ni el agrupamiento aparecen.
  const tallasActivo = user?.flags?.productos_por_talla ?? false
  // Produccion: si la empresa tiene el modulo, se puede marcar "producto fabricado".
  const produccionActiva = hasModulo("Materiales") || hasModulo("Ordenes de Produccion")

  // Set de producto_id marcados como fabricados (tabla mapa productos_fabricados).
  const [fabricados, setFabricados] = useState<Set<number>>(new Set())
  // Estado del check "Es fabricado" en el diálogo de edición.
  const [esFabricado, setEsFabricado] = useState(false)

  const [productos, setProductos] = useState<Producto[]>([])
  const [marcas, setMarcas] = useState<Marca[]>([])
  const [categorias, setCategorias] = useState<Categoria[]>([])
  /**
   * Lista plana de TODAS las subcategorias del tenant. La filtramos por
   * `categoria_id` en memoria para alimentar el selector cascada del form
   * y la columna de la tabla. Se recarga cada vez que se crea/edita/elimina
   * una subcategoria desde el modal de Gestion.
   */
  const [subcategorias, setSubcategorias] = useState<Subcategoria[]>([])
  // Lineas de producto (script officemart-002). Vacio si la tabla no existe:
  // en ese caso el campo y el filtro de linea se ocultan.
  const [lineasProducto, setLineasProducto] = useState<LineaProducto[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingProducto, setEditingProducto] = useState<Producto | null>(null)
  const [saving, setSaving] = useState(false)

  // Grupos de tallas: mapa producto_id -> {grupo_id, nombre_grupo}. Con esto
  // agrupamos en la lista los productos hermanos (misma prenda, varias tallas).
  const [gruposTallas, setGruposTallas] = useState<Map<number, GrupoTallaRef>>(new Map())
  // grupo_id expandidos (mostrando sus tallas) en la vista de lista.
  const [gruposExpandidos, setGruposExpandidos] = useState<Set<number>>(new Set())
  // Editor de grupo: grupo_id abierto (o null). Su contenido se deriva de productos.
  const [grupoEditando, setGrupoEditando] = useState<number | null>(null)
  // Producto que se está convirtiendo en tallado (o null). Abre su propio diálogo.
  const [convirtiendo, setConvirtiendo] = useState<Producto | null>(null)
  
  // Filter state
  const [filterMarca, setFilterMarca] = useState<string>("all")
  const [filterCategoria, setFilterCategoria] = useState<string>("all")
  const [filterLinea, setFilterLinea] = useState<string>("all")
  const [searchTerm, setSearchTerm] = useState("")

  // Quick-create modals state
  const [marcaDialogOpen, setMarcaDialogOpen] = useState(false)
  const [categoriaDialogOpen, setCategoriaDialogOpen] = useState(false)
  const [lineaDialogOpen, setLineaDialogOpen] = useState(false)
  const [newMarcaName, setNewMarcaName] = useState("")
  const [newCategoriaName, setNewCategoriaName] = useState("")
  const [newLineaName, setNewLineaName] = useState("")
  const [creatingMarca, setCreatingMarca] = useState(false)
  const [creatingCategoria, setCreatingCategoria] = useState(false)
  const [creatingLinea, setCreatingLinea] = useState(false)

  // Modal de gestion completa de Categorias / Subcategorias.
  // Abre un acordeon donde cada fila es una categoria que se expande para
  // mostrar/agregar sus subcategorias.
  const [manageDialogOpen, setManageDialogOpen] = useState(false)

  // Recompresion de fotos ya subidas (backfill).
  const [recompOpen, setRecompOpen] = useState(false)
  const [recomprimiendo, setRecomprimiendo] = useState(false)
  const [recompProgreso, setRecompProgreso] = useState<ProgresoRecompresion | null>(null)

  const [formData, setFormData] = useState<Partial<Producto>>({
    nombre: "",
    codigo_barras: "",
    precio_venta_sugerido: 0,
    foto_url: "",
    costo_promedio: 0,
    stock_total: 0,
    marca_id: null,
    categoria_id: null,
    subcategoria_id: null,
    linea_id: null,
    talla: "",
  })
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [imagePreview, setImagePreview] = useState<string>("")
  const [uploadingImage, setUploadingImage] = useState(false)
  // Campo para pegar la URL de una imagen de la web (alternativa a subir archivo).
  // La imagen se descarga a nuestro almacenamiento (a prueba de que el origen la borre).
  const [imageUrlInput, setImageUrlInput] = useState<string>("")
  const [importandoImg, setImportandoImg] = useState(false)
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({})

  // Inventario inicial (SOLO al crear un producto nuevo): genera un ingreso
  // manual al almacen/localizacion elegidos con la cantidad y costo indicados.
  const [almacenes, setAlmacenes] = useState<Almacen[]>([])
  const [localizacionesInicial, setLocalizacionesInicial] = useState<Localizacion[]>([])
  const [invInicial, setInvInicial] = useState({
    cantidad: 0,
    costo_unitario: 0,
    almacen_id: 0,
    localizacion_id: 0,
  })

  // Creador "por tallas" (solo al crear producto nuevo). Si tieneTallas, al
  // guardar se genera UN producto por cada linea de talla. Cada linea tiene su
  // propia cantidad inicial; el precio de venta y el costo son unicos (los del
  // formulario general) para todas las tallas.
  const [tieneTallas, setTieneTallas] = useState(false)
  const [lineasTalla, setLineasTalla] = useState<{ talla: string; cantidad: string }[]>([])

  function agregarLineaTalla() {
    setLineasTalla((prev) => [...prev, { talla: "", cantidad: "" }])
  }

  function quitarLineaTalla(idx: number) {
    setLineasTalla((prev) => prev.filter((_, i) => i !== idx))
  }

  function setLineaTalla(idx: number, campo: "talla" | "cantidad", valor: string) {
    setLineasTalla((prev) => prev.map((l, i) => (i === idx ? { ...l, [campo]: valor } : l)))
  }
  
  // Price calculator state
  const [showCalculator, setShowCalculator] = useState(true) // desplegada por defecto
  const [calcCosto, setCalcCosto] = useState<number>(0)
  const [calcMargen, setCalcMargen] = useState<number>(30) // Default 30%
  // Precio de venta editable de la calculadora (bidireccional con el margen).
  const [calcPrecio, setCalcPrecio] = useState<number>(0)

  useEffect(() => {
    if (!ready) {
      console.log('[Productos] esperando sesion...')
      return
    }
    if (razonSocialId == null) {
      console.log('[Productos] usuario sin razon_social_id')
      setProductos([])
      setLoading(false)
      return
    }
    loadAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, razonSocialId])

  async function loadAll() {
    setLoading(true)
    try {
      const [prodRes, marcaRes, catRes, subRes, almRes, gruposRes, fabRes, lineasRes] = await Promise.all([
        getProductos(),
        getMarcas(),
        getCategorias(),
        getSubcategorias(),
        getAlmacenes(),
        getGruposTallas(),
        produccionActiva ? getProductosFabricados() : Promise.resolve({ data: new Set<number>(), error: null }),
        getLineasProducto(),
      ])
      if (!lineasRes.error) setLineasProducto(lineasRes.data)
      if (prodRes.error) {
        console.log('[Productos] error:', prodRes.error)
        toast({ title: "No se pudieron cargar los datos", description: prodRes.error, variant: "destructive" })
      } else {
        setProductos(prodRes.data)
      }
      if (!marcaRes.error) setMarcas(marcaRes.data)
      if (!catRes.error) setCategorias(catRes.data)
      if (!subRes.error) setSubcategorias(subRes.data)
      if (!almRes.error) setAlmacenes(almRes.data)
      setGruposTallas(gruposRes.data)
      setFabricados(fabRes.data)
    } catch (err: any) {
      console.log('[Productos] excepcion:', err)
      toast({ title: "No se pudieron cargar los datos", description: err?.message || "Error de conexion", variant: "destructive" })
    } finally {
      setLoading(false)
    }
  }

  async function loadSubcategorias() {
    const { data } = await getSubcategorias()
    setSubcategorias(data)
  }

  async function loadLineas() {
    const { data } = await getLineasProducto()
    setLineasProducto(data)
  }

  // Carga las localizaciones del almacen elegido para el inventario inicial.
  useEffect(() => {
    if (invInicial.almacen_id) {
      getLocalizaciones(invInicial.almacen_id).then((res) => {
        setLocalizacionesInicial(res.data)
        setInvInicial((prev) => ({ ...prev, localizacion_id: 0 }))
      })
    } else {
      setLocalizacionesInicial([])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invInicial.almacen_id])

  async function loadProductos() {
    const [{ data, error }, gruposRes] = await Promise.all([getProductos(), getGruposTallas()])
    if (error) {
      toast({ title: "Error", description: error, variant: "destructive" })
    } else {
      setProductos(data)
    }
    setGruposTallas(gruposRes.data)
  }

  async function loadMarcas() {
    const { data } = await getMarcas()
    setMarcas(data)
  }

  async function loadCategorias() {
    const { data } = await getCategorias()
    setCategorias(data)
  }

  // Subcategorias disponibles para la categoria seleccionada en el form.
  // Cuando no hay categoria activa devolvemos lista vacia para que el
  // selector quede deshabilitado (ver UI mas abajo).
  const subcategoriasFiltradas = useMemo(() => {
    if (!formData.categoria_id) return []
    return subcategorias.filter((s) => s.categoria_id === formData.categoria_id)
  }, [subcategorias, formData.categoria_id])

  // Ordenamiento dinamico de la tabla (click en el encabezado).
  const [sortKey, setSortKey] = useState<SortKey | null>(null)
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")

  function handleSort(k: SortKey) {
    if (sortKey === k) {
      // Mismo campo: alterna mayor→menor / menor→mayor.
      setSortDir((d) => (d === "desc" ? "asc" : "desc"))
    } else {
      // Campo nuevo: arranca de mayor a menor.
      setSortKey(k)
      setSortDir("desc")
    }
  }

  function sortValue(p: Producto, k: SortKey): number | string {
    switch (k) {
      case "precio_venta_sugerido":
        return p.precio_venta_sugerido || 0
      case "costo_promedio":
        return p.costo_promedio || 0
      case "stock_total":
        return p.stock_total || 0
      case "ganancia":
        return (p.precio_venta_sugerido || 0) - (p.costo_promedio || 0)
      case "margen": {
        const precio = p.precio_venta_sugerido || 0
        return precio > 0 ? ((precio - (p.costo_promedio || 0)) / precio) : 0
      }
      case "nombre":
        return (p.nombre ?? "").toString().toLowerCase()
      case "codigo_barras":
        return (p.codigo_barras ?? "").toString().toLowerCase()
      case "marca_nombre":
        return (p.marca_nombre ?? "").toString().toLowerCase()
      case "categoria_nombre":
        return (p.categoria_nombre ?? "").toString().toLowerCase()
      case "subcategoria_nombre":
        return (p.subcategoria_nombre ?? "").toString().toLowerCase()
      case "linea_nombre":
        return (p.linea_nombre ?? "").toString().toLowerCase()
    }
  }

  // Filtered + sorted productos
  const filteredProductos = useMemo(() => {
    const arr = productos.filter(p => {
      const matchMarca = filterMarca === "all" || p.marca_id?.toString() === filterMarca
      const matchCat = filterCategoria === "all" || p.categoria_id?.toString() === filterCategoria
      const matchLinea = filterLinea === "all" || p.linea_id?.toString() === filterLinea
      const search = searchTerm.toLowerCase().trim()
      // Blindamos contra `nombre`/`codigo_barras` nulos o no-string en BD:
      // llamar .toLowerCase() sobre null/undefined lanzaba una excepcion de
      // cliente al teclear en el buscador. Coaccionamos a string seguro.
      const nombre = (p.nombre ?? "").toString().toLowerCase()
      const codigoBarras = (p.codigo_barras ?? "").toString().toLowerCase()
      const matchSearch = !search ||
        nombre.includes(search) ||
        codigoBarras.includes(search)
      return matchMarca && matchCat && matchLinea && matchSearch
    })

    if (sortKey) {
      const dir = sortDir === "asc" ? 1 : -1
      arr.sort((a, b) => {
        const va = sortValue(a, sortKey)
        const vb = sortValue(b, sortKey)
        if (typeof va === "number" && typeof vb === "number") return (va - vb) * dir
        return String(va).localeCompare(String(vb), "es") * dir
      })
    }
    return arr
  }, [productos, filterMarca, filterCategoria, filterLinea, searchTerm, sortKey, sortDir])

  /**
   * Agrupa `filteredProductos` para la lista: los productos que comparten
   * grupo_id (tallas de la misma prenda) se muestran como UNA fila desplegable;
   * el resto como fila normal. Conserva el orden de aparicion de la lista ya
   * filtrada/ordenada (el grupo toma la posicion de su primera talla).
   */
  const filas = useMemo(() => {
    const out: (
      | { tipo: "single"; producto: Producto }
      | {
          tipo: "grupo"
          grupoId: number
          nombre: string
          marca_nombre?: string
          categoria_nombre?: string
          tallas: Producto[]
          stockTotal: number
          precioMin: number
          precioMax: number
        }
    )[] = []
    const grupoIndex = new Map<number, number>() // grupo_id -> indice en out
    for (const p of filteredProductos) {
      // Si el sistema de tallas esta apagado para la empresa, no agrupamos nada.
      const ref = tallasActivo && p.id != null ? gruposTallas.get(p.id) : undefined
      if (!ref) {
        out.push({ tipo: "single", producto: p })
        continue
      }
      const idx = grupoIndex.get(ref.grupo_id)
      if (idx == null) {
        grupoIndex.set(ref.grupo_id, out.length)
        out.push({
          tipo: "grupo",
          grupoId: ref.grupo_id,
          nombre: ref.nombre_grupo || p.nombre,
          marca_nombre: p.marca_nombre,
          categoria_nombre: p.categoria_nombre,
          tallas: [p],
          stockTotal: p.stock_total || 0,
          precioMin: p.precio_venta_sugerido || 0,
          precioMax: p.precio_venta_sugerido || 0,
        })
      } else {
        const g = out[idx]
        if (g.tipo === "grupo") {
          g.tallas.push(p)
          g.stockTotal += p.stock_total || 0
          const precio = p.precio_venta_sugerido || 0
          g.precioMin = Math.min(g.precioMin, precio)
          g.precioMax = Math.max(g.precioMax, precio)
        }
      }
    }
    return out
  }, [filteredProductos, gruposTallas, tallasActivo])

  // Paginación de la lista: se renderiza por páginas para no montar miles de
  // filas de golpe (mismo patrón que Inventario → Valoración). El contador
  // "N de M productos" sigue sobre la lista completa filtrada.
  const [pageSize, setPageSize] = useState(100)
  const [pageIndex, setPageIndex] = useState(0)
  const filasPaginadas = useMemo(
    () => filas.slice(pageIndex * pageSize, pageIndex * pageSize + pageSize),
    [filas, pageIndex, pageSize]
  )
  // Al cambiar la búsqueda o el tamaño de página, vuelve a la primera página.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setPageIndex(0) }, [searchTerm, pageSize])

  function toggleGrupo(grupoId: number) {
    setGruposExpandidos((prev) => {
      const next = new Set(prev)
      if (next.has(grupoId)) next.delete(grupoId)
      else next.add(grupoId)
      return next
    })
  }

  // Tallas (productos) de un grupo, ordenadas por talla para el editor/despliegue.
  function tallasDeGrupo(grupoId: number): Producto[] {
    return productos
      .filter((p) => p.id != null && gruposTallas.get(p.id)?.grupo_id === grupoId)
      .sort((a, b) => (a.talla || "").localeCompare(b.talla || "", "es", { numeric: true }))
  }

  /**
   * Renderiza una fila normal de producto en la tabla desktop. `sangria=true`
   * para las tallas dentro de un grupo desplegado (se indentan y muestran su
   * talla en vez del nombre completo).
   */
  function renderProductoRow(producto: Producto, sangria: boolean) {
    const precio = producto.precio_venta_sugerido || 0
    const costo = producto.costo_promedio || 0
    const ganancia = precio - costo
    const margen = precio > 0 ? (ganancia / precio) * 100 : 0
    const color = ganancia >= 0 ? "text-emerald-700" : "text-red-600"
    return (
      <TableRow key={producto.id} className={sangria ? "bg-stone-50/40" : undefined}>
        <TableCell>
          {producto.foto_url ? (
            <img src={producto.foto_url} alt={producto.nombre} className={`h-10 w-10 rounded-lg object-cover ${sangria ? "ml-6" : ""}`} />
          ) : (
            <div className={`h-10 w-10 rounded-lg bg-stone-100 flex items-center justify-center ${sangria ? "ml-6" : ""}`}>
              <ImageIcon className="h-5 w-5 text-stone-400" />
            </div>
          )}
        </TableCell>
        <TableCell className="font-medium">
          {sangria ? (
            <span className="inline-flex items-center gap-1.5 pl-2">
              <span className="text-stone-300">└</span>
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-900">
                Talla {producto.talla || "—"}
              </span>
            </span>
          ) : (
            <>
              {producto.nombre}
              {producto.talla && (
                <span className="ml-1.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-900">
                  {producto.talla}
                </span>
              )}
            </>
          )}
        </TableCell>
        <TableCell className="font-mono text-sm text-stone-600">{producto.codigo_barras}</TableCell>
        <TableCell>
          {producto.marca_nombre ? (
            <Badge variant="outline" className="bg-amber-50 border-amber-200 text-amber-800 rounded-full font-normal">
              {producto.marca_nombre}
            </Badge>
          ) : (
            <span className="text-stone-400 text-xs">-</span>
          )}
        </TableCell>
        <TableCell>
          {producto.categoria_nombre ? (
            <Badge variant="outline" className="bg-stone-50 border-stone-200 text-stone-700 rounded-full font-normal">
              {producto.categoria_nombre}
            </Badge>
          ) : (
            <span className="text-stone-400 text-xs">-</span>
          )}
        </TableCell>
        <TableCell>
          {producto.subcategoria_nombre ? (
            <Badge variant="outline" className="bg-stone-100 border-stone-300 text-stone-600 rounded-full font-normal">
              {producto.subcategoria_nombre}
            </Badge>
          ) : (
            <span className="text-stone-400 text-xs">-</span>
          )}
        </TableCell>
        {lineasProducto.length > 0 && (
          <TableCell>
            {producto.linea_nombre ? (
              <Badge variant="outline" className="bg-sky-50 border-sky-200 text-sky-800 rounded-full font-normal">
                {producto.linea_nombre}
              </Badge>
            ) : (
              <span className="text-stone-400 text-xs">-</span>
            )}
          </TableCell>
        )}
        <TableCell className="text-right font-medium text-emerald-700">L {precio.toFixed(2)}</TableCell>
        <TableCell className="text-right text-stone-600">L {costo.toFixed(2)}</TableCell>
        <TableCell className={`text-right font-medium ${color}`}>{formatCurrency(ganancia)}</TableCell>
        <TableCell className={`text-right ${color}`}>{margen.toFixed(1)}%</TableCell>
        <TableCell className="text-right">{producto.stock_total || 0}</TableCell>
        <TableCell>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEditDialog(producto)}>
              <Pencil className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8 hover:bg-destructive/10" onClick={() => handleDelete(producto)}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </TableCell>
      </TableRow>
    )
  }

  /**
   * Tarjeta de producto para la vista movil. `sangria=true` para las tallas
   * dentro de un grupo desplegado (muestra la talla en vez del nombre).
   */
  function renderProductoCard(producto: Producto, sangria = false) {
    const precio = producto.precio_venta_sugerido || 0
    const costo = producto.costo_promedio || 0
    const ganancia = precio - costo
    const margen = precio > 0 ? (ganancia / precio) * 100 : 0
    const color = ganancia >= 0 ? "text-emerald-700" : "text-red-600"
    return (
      <div
        key={producto.id}
        className={`border rounded-xl p-3 bg-white flex items-center gap-3 ${sangria ? "border-stone-100 bg-stone-50/60" : "border-stone-200"}`}
      >
        {producto.foto_url ? (
          <img src={producto.foto_url} alt={producto.nombre} className="h-14 w-14 rounded-lg object-cover shrink-0" />
        ) : (
          <div className="h-14 w-14 rounded-lg bg-stone-100 flex items-center justify-center shrink-0">
            <ImageIcon className="h-5 w-5 text-stone-400" />
          </div>
        )}
        <div className="flex-1 min-w-0">
          {sangria ? (
            <p className="font-medium text-sm">
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-900">
                Talla {producto.talla || "—"}
              </span>
            </p>
          ) : (
            <p className="font-medium truncate text-sm">
              {producto.nombre}
              {producto.talla && (
                <span className="ml-1.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-900">
                  {producto.talla}
                </span>
              )}
            </p>
          )}
          <p className="text-xs text-stone-500 font-mono">{producto.codigo_barras}</p>
          {!sangria && (
            <div className="flex flex-wrap gap-1 mt-1">
              {producto.marca_nombre && (
                <Badge variant="outline" className="text-xs bg-amber-50 border-amber-200 text-amber-800 rounded-full">
                  {producto.marca_nombre}
                </Badge>
              )}
              {producto.categoria_nombre && (
                <Badge variant="outline" className="text-xs bg-stone-50 border-stone-200 text-stone-700 rounded-full">
                  {producto.categoria_nombre}
                </Badge>
              )}
              {producto.subcategoria_nombre && (
                <Badge variant="outline" className="text-xs bg-stone-100 border-stone-300 text-stone-600 rounded-full">
                  {producto.subcategoria_nombre}
                </Badge>
              )}
            </div>
          )}
          <div className="flex gap-3 mt-1 text-xs">
            <span className="text-emerald-700 font-medium">L {precio.toFixed(2)}</span>
            <span className="text-stone-500">Stock: {producto.stock_total || 0}</span>
          </div>
          <div className={`mt-0.5 text-xs ${color}`}>
            Ganancia: {formatCurrency(ganancia)} · {margen.toFixed(1)}%
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEditDialog(producto)}>
            <Pencil className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8 hover:bg-destructive/10" onClick={() => handleDelete(producto)}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>
    )
  }

  async function handleCreateMarca() {
    if (!newMarcaName.trim()) {
      toast({ title: "Error", description: "El nombre es requerido", variant: "destructive" })
      return
    }
    setCreatingMarca(true)
    const { data, error } = await createMarca(newMarcaName.trim())
    setCreatingMarca(false)
    if (error) {
      toast({ title: "Error", description: error, variant: "destructive" })
      return
    }
    toast({ title: "Marca creada", description: `"${newMarcaName}" agregada correctamente` })
    await loadMarcas()
    if (data?.id) setFormData(prev => ({ ...prev, marca_id: data.id }))
    setNewMarcaName("")
    setMarcaDialogOpen(false)
  }

  async function handleCreateCategoria() {
    if (!newCategoriaName.trim()) {
      toast({ title: "Error", description: "El nombre es requerido", variant: "destructive" })
      return
    }
    setCreatingCategoria(true)
    const { data, error } = await createCategoria(newCategoriaName.trim())
    setCreatingCategoria(false)
    if (error) {
      toast({ title: "Error", description: error, variant: "destructive" })
      return
    }
    toast({ title: "Categoria creada", description: `"${newCategoriaName}" agregada correctamente` })
    await loadCategorias()
    if (data?.id) setFormData(prev => ({ ...prev, categoria_id: data.id }))
    setNewCategoriaName("")
    setCategoriaDialogOpen(false)
  }

  async function handleCreateLinea() {
    if (!newLineaName.trim()) {
      toast({ title: "Error", description: "El nombre es requerido", variant: "destructive" })
      return
    }
    setCreatingLinea(true)
    const { data, error } = await createLineaProducto(newLineaName.trim())
    setCreatingLinea(false)
    if (error) {
      toast({ title: "Error", description: error, variant: "destructive" })
      return
    }
    toast({ title: "Línea creada", description: `"${newLineaName}" agregada correctamente` })
    await loadLineas()
    if (data?.id) setFormData(prev => ({ ...prev, linea_id: data.id }))
    setNewLineaName("")
    setLineaDialogOpen(false)
  }

  function openNewDialog() {
    setValidationErrors({})
    setEditingProducto(null)
    setFormData({ 
      nombre: "", 
      codigo_barras: "", 
      precio_venta_sugerido: 0, 
      foto_url: "",
      costo_promedio: 0,
      stock_total: 0,
      marca_id: null,
      categoria_id: null,
      subcategoria_id: null,
      linea_id: null,
      talla: "",
    })
    setInvInicial({ cantidad: 0, costo_unitario: 0, almacen_id: 0, localizacion_id: 0 })
    setTieneTallas(false)
    setLineasTalla([])
    setEsFabricado(false)
    setImagePreview("")
    setImageFile(null)
    setImageUrlInput("")
    setShowCalculator(true)
    setCalcCosto(0)
    setCalcMargen(30)
    setCalcPrecio(0)
    setDialogOpen(true)
  }

  function openEditDialog(producto: Producto) {
    setValidationErrors({})
    setEditingProducto(producto)
    // El creador por tallas es solo para productos nuevos. Al editar, se usa el
    // campo de talla individual del producto existente.
    setTieneTallas(false)
    setLineasTalla([])
    setEsFabricado(producto.id != null && fabricados.has(producto.id))
    setFormData({
      ...producto,
      costo_promedio: producto.costo_promedio ?? 0,
      stock_total: producto.stock_total ?? 0,
    })
    setImagePreview(producto.foto_url || "")
    setImageFile(null)
    setImageUrlInput("")
    setShowCalculator(true)
    setCalcCosto(producto.costo_promedio || 0)
    setCalcPrecio(producto.precio_venta_sugerido || 0)
    // Deriva el margen desde el precio y costo actuales del producto.
    {
      const c = producto.costo_promedio || 0
      const p = producto.precio_venta_sugerido || 0
      setCalcMargen(p > 0 ? +(((p - c) / p) * 100).toFixed(2) : 30)
    }
    setDialogOpen(true)
  }

  const handleImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      if (!file.type.startsWith('image/')) {
        toast({ title: "Error", description: "Solo se permiten archivos de imagen", variant: "destructive" })
        return
      }
      // No rechazamos por peso: uploadProductoImage comprime la foto antes de
      // subir (baja resolucion/peso). Si aun asi supera 5MB, el API lo avisa.

      setImageFile(file)
      setImagePreview(URL.createObjectURL(file))
      
      setUploadingImage(true)
      const { url, error } = await uploadProductoImage(file)
      setUploadingImage(false)
      
      if (error) {
        toast({ title: "Error al subir imagen", description: error, variant: "destructive" })
      } else if (url) {
        setFormData(prev => ({ ...prev, foto_url: url }))
        setImagePreview(url)
        setImageUrlInput("")
        setValidationErrors(prev => ({ ...prev, foto_url: "" }))
        toast({ title: "Imagen subida", description: "La imagen se ha subido correctamente" })
      }
    }
  }

  // Descarga la imagen de una URL externa a nuestro almacenamiento y la usa
  // como foto del producto (a prueba de que el origen la borre).
  async function importarImagen(urlExterna: string): Promise<boolean> {
    const url = urlExterna.trim()
    if (!/^https?:\/\/.+/i.test(url)) {
      toast({ title: "URL inválida", description: "Pega una dirección que empiece con http:// o https://", variant: "destructive" })
      return false
    }
    setImportandoImg(true)
    const { url: guardada, error } = await importarImagenDeUrl(url)
    setImportandoImg(false)
    if (error || !guardada) {
      toast({ title: "No se pudo usar la imagen", description: error || "Intenta con otra imagen.", variant: "destructive" })
      return false
    }
    setImageFile(null)
    setFormData(prev => ({ ...prev, foto_url: guardada }))
    setImagePreview(guardada)
    setImageUrlInput("")
    setValidationErrors(prev => ({ ...prev, foto_url: "" }))
    toast({ title: "Imagen guardada", description: "La foto se descargó a tu almacenamiento." })
    return true
  }

  function usarImagenPorUrl() {
    importarImagen(imageUrlInput)
  }

  // Abre Google Imágenes en una pestaña nueva con el nombre del producto ya
  // buscado. El usuario copia la dirección de la imagen que quiera y la pega en
  // el campo de URL (no usa ninguna API; funciona siempre).
  function buscarEnGoogleImagenes() {
    const q = (formData.nombre || "").trim()
    const url = `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(q)}`
    window.open(url, "_blank", "noopener,noreferrer")
  }

  // Calculadora bidireccional: Margen = (Precio - Costo) / Precio.
  //   precio = costo / (1 - margen/100)  |  margen = (precio - costo)/precio*100
  const round2 = (n: number) => Math.round(n * 100) / 100

  // Cambiar el COSTO: mantiene el margen y recalcula el precio.
  function onCambioCalcCosto(nuevoCosto: number) {
    const c = Number.isFinite(nuevoCosto) ? nuevoCosto : 0
    setCalcCosto(c)
    if (calcMargen < 100) setCalcPrecio(round2(c > 0 ? c / (1 - calcMargen / 100) : 0))
  }
  // Cambiar el MARGEN (%): recalcula el precio con el costo actual.
  function onCambioCalcMargen(nuevoMargen: number) {
    const m = Math.min(99.99, Math.max(0, Number.isFinite(nuevoMargen) ? nuevoMargen : 0))
    setCalcMargen(m)
    setCalcPrecio(round2(calcCosto > 0 ? calcCosto / (1 - m / 100) : 0))
  }
  // Cambiar el PRECIO de venta: recalcula el margen con el costo actual.
  function onCambioCalcPrecio(nuevoPrecio: number) {
    const p = Number.isFinite(nuevoPrecio) ? nuevoPrecio : 0
    setCalcPrecio(p)
    setCalcMargen(p > 0 ? round2(((p - calcCosto) / p) * 100) : 0)
  }

  // Precio a aplicar (el editable). Se mantiene por compat con el disabled del botón.
  const calcPrecioSugerido = calcPrecio

  function applyCalculatedPrice() {
    if (calcPrecio <= 0) return
    const precio = round2(calcPrecio)
    const costo = round2(calcCosto)
    // Precio de venta (siempre) + costo. Al CREAR el costo vive en el inventario
    // inicial; al EDITAR vive en formData.costo_promedio.
    setFormData(prev => ({ ...prev, precio_venta_sugerido: precio, ...(editingProducto ? { costo_promedio: costo } : {}) }))
    if (!editingProducto) setInvInicial(prev => ({ ...prev, costo_unitario: costo }))
    setValidationErrors(prev => ({ ...prev, precio_venta_sugerido: "" }))
    toast({ title: "Aplicado", description: `Precio L ${precio.toFixed(2)} · Costo L ${costo.toFixed(2)}` })
  }

  const validateForm = (): boolean => {
    const errors: Record<string, string> = {}
    
    if (!formData.nombre?.trim()) {
      errors.nombre = "El nombre es requerido"
    }
    if (!formData.codigo_barras?.trim()) {
      errors.codigo_barras = "El codigo de barras es requerido"
    }
    // La imagen es opcional: un producto puede crearse/editarse sin foto.
    if (!formData.precio_venta_sugerido || formData.precio_venta_sugerido <= 0) {
      errors.precio_venta_sugerido = "El precio de venta debe ser mayor a 0"
    }
    // La marca NO es obligatoria: si no se elige, se usa "Genérico" (se crea al
    // vuelo en guardarUnProducto). Ver ensureMarcaGenerica.
    if (!formData.categoria_id) {
      errors.categoria_id = "La categoria es requerida"
    }

    // Creador por tallas (solo al crear): exige al menos una linea con talla y
    // sin tallas repetidas. La cantidad por talla es opcional (puede ser 0).
    const modoTallas = !editingProducto && tallasActivo && tieneTallas
    if (modoTallas) {
      const tallas = lineasTalla.map((l) => l.talla.trim()).filter(Boolean)
      if (tallas.length === 0) {
        errors.tallas = "Agrega al menos una línea de talla o desactiva la opción"
      } else if (new Set(tallas.map((t) => t.toLowerCase())).size !== tallas.length) {
        errors.tallas = "Hay tallas repetidas; cada talla debe ser única"
      }
    }

    // Inventario inicial (solo al crear): si se indica cantidad, exige almacen y
    // localizacion. En modo tallas, la cantidad total viene de las lineas.
    const hayCantidadInicial = modoTallas
      ? lineasTalla.some((l) => Number(l.cantidad) > 0)
      : invInicial.cantidad > 0
    if (!editingProducto && hayCantidadInicial) {
      if (!invInicial.almacen_id) errors.inv_almacen = "Selecciona el almacén del inventario inicial"
      if (!invInicial.localizacion_id) errors.inv_localizacion = "Selecciona la localización"
    }

    setValidationErrors(errors)
    return Object.keys(errors).length === 0
  }

  /**
   * Crea (o actualiza) UN producto con la talla indicada y, al crear con
   * cantidad inicial > 0, genera su ingreso manual. Devuelve un error legible
   * o null. `codigoBarras` puede diferir del formulario cuando se crean varias
   * tallas (cada una necesita su propio codigo unico).
   */
  /**
   * Devuelve el id de la marca "Genérico" (la busca en el catálogo; si no
   * existe, la crea). Se usa cuando el usuario no elige marca (ya no es
   * obligatoria). Devuelve null solo si no se pudo crear (no bloquea el guardado).
   */
  async function ensureMarcaGenerica(): Promise<number | null> {
    const existente = marcas.find((m) => (m.nombre || "").trim().toLowerCase() === "genérico")
      || marcas.find((m) => (m.nombre || "").trim().toLowerCase() === "generico")
    if (existente?.id != null) return existente.id
    const { data, error } = await createMarca("Genérico")
    if (error || !data?.id) return null
    setMarcas((prev) => [...prev, data])
    return data.id
  }

  async function guardarUnProducto(
    talla: string | null,
    codigoBarras: string,
    cantidadOverride?: number,
    marcaIdOverride?: number | null,
  ): Promise<{ error: string | null; id: number | null }> {
    const productoData: Producto = {
      ...editingProducto,
      nombre: formData.nombre!,
      codigo_barras: codigoBarras,
      precio_venta_sugerido: Number(formData.precio_venta_sugerido) || 0,
      costo_promedio: Number(formData.costo_promedio) || 0,
      foto_url: formData.foto_url || "",
      // Marca: la elegida, o la resuelta a "Genérico" si no se eligió.
      marca_id: formData.marca_id ?? marcaIdOverride ?? null,
      categoria_id: formData.categoria_id ?? null,
      // Subcategoria es opcional. Si no hay categoria, no puede haber subcat.
      subcategoria_id: formData.categoria_id
        ? formData.subcategoria_id ?? null
        : null,
      // Linea de producto (opcional, independiente de la categoria).
      linea_id: formData.linea_id ?? null,
      talla: talla || null,
    }

    const { data: creado, error } = await saveProducto(productoData, !editingProducto)
    if (error) return { error, id: null }

    // Inventario inicial: genera un ingreso manual con la cantidad indicada.
    // Solo al crear y si la cantidad es > 0. En modo tallas, cada talla trae su
    // propia cantidad (cantidadOverride); el costo es el unico del formulario.
    const cantidad = cantidadOverride ?? invInicial.cantidad
    if (!editingProducto && cantidad > 0 && creado?.id) {
      const ing = await procesarIngresoManual({
        producto_id: creado.id,
        almacen_id: invInicial.almacen_id,
        localizacion_id: invInicial.localizacion_id,
        cantidad,
        costo_unitario: invInicial.costo_unitario,
        observaciones: "Inventario inicial (creación de producto)",
        stock_anterior: 0,
        costo_anterior: 0,
        nuevo_stock: cantidad,
        nuevo_costo: invInicial.costo_unitario,
      })
      if (ing.error) {
        // El producto quedo creado; solo fallo el ingreso inicial.
        return {
          error: `Producto creado sin inventario inicial: ${ing.error}. Regístralo en Inventario → Ingreso Manual.`,
          id: creado?.id ?? null,
        }
      }
    }
    return { error: null, id: creado?.id ?? null }
  }

  async function handleSave() {
    if (!validateForm()) {
      toast({ title: "Error de validacion", description: "Complete todos los campos requeridos", variant: "destructive" })
      return
    }

    setSaving(true)

    // Si no se eligió marca, resolver "Genérico" una sola vez (crear si falta).
    const marcaFallback = formData.marca_id == null ? await ensureMarcaGenerica() : null

    // Camino "por tallas": crea un producto independiente por cada linea de
    // talla, con la cantidad inicial propia de esa talla. Solo al crear. Precio
    // y costo son unicos (del formulario); cada talla lleva su propio codigo
    // (codigo base + "-" + talla) para no chocar entre si.
    const lineasValidas = lineasTalla
      .map((l) => ({ talla: l.talla.trim(), cantidad: Number(l.cantidad) || 0 }))
      .filter((l) => l.talla !== "")
    if (!editingProducto && tallasActivo && tieneTallas && lineasValidas.length > 0) {
      const baseCodigo = formData.codigo_barras!.trim()
      let creados = 0
      const errores: string[] = []
      const idsCreados: number[] = []
      for (const { talla, cantidad } of lineasValidas) {
        const codigoTalla = `${baseCodigo}-${talla}`
        const { error: err, id } = await guardarUnProducto(talla, codigoTalla, cantidad, marcaFallback)
        if (err) errores.push(`${talla}: ${err}`)
        else creados++
        if (id) idsCreados.push(id)
      }
      // Vincula todas las tallas creadas en un mismo grupo, para que en las
      // listas (Productos/Inventario) aparezcan como un solo producto que se
      // despliega en sus tallas. Degrada si el script 043 no se aplico.
      if (idsCreados.length > 1) {
        const g = await crearGrupoConProductos(formData.nombre!.trim(), idsCreados)
        if (g.error && g.error !== GRUPOS_TALLAS_FEATURE_PENDING) {
          errores.push(`Agrupado: ${g.error}`)
        }
      }
      setSaving(false)
      if (creados > 0) {
        const totalUnidades = lineasValidas.reduce((a, l) => a + l.cantidad, 0)
        toast({
          title: `Se crearon ${creados} producto(s) por talla`,
          description:
            errores.length > 0
              ? `Con avisos: ${errores.join(" · ")}`
              : `Tallas: ${lineasValidas.map((l) => `${l.talla}${l.cantidad > 0 ? ` (${l.cantidad})` : ""}`).join(", ")}${totalUnidades > 0 ? ` · ${totalUnidades} unidad(es) en total` : ""}`,
          variant: errores.length > 0 ? "destructive" : undefined,
        })
        setDialogOpen(false)
        loadProductos()
      } else {
        toast({
          title: "No se crearon productos",
          description: errores.join(" · ") || "Revisa los datos e intenta de nuevo.",
          variant: "destructive",
        })
      }
      return
    }

    // Camino normal: un solo producto (con la talla individual del formulario).
    const { error: err, id: prodId } = await guardarUnProducto(
      (formData.talla ?? "").toString().trim() || null,
      formData.codigo_barras!,
      undefined,
      marcaFallback,
    )
    // Marca "producto fabricado" (tabla mapa). Solo si Producción está activa.
    const idParaFabricado = prodId ?? editingProducto?.id ?? null
    if (produccionActiva && idParaFabricado != null && (!err || err.startsWith("Producto creado sin inventario inicial"))) {
      await setProductoFabricado(idParaFabricado, esFabricado)
    }
    setSaving(false)
    if (err) {
      // Si el producto se creó pero falló el inventario inicial, el mensaje ya
      // lo explica; igual cerramos y refrescamos para reflejar el producto.
      const soloAvisoInventario = err.startsWith("Producto creado sin inventario inicial")
      toast({
        title: soloAvisoInventario ? "Producto creado, sin inventario inicial" : "Error",
        description: err,
        variant: "destructive",
      })
      if (soloAvisoInventario) {
        setDialogOpen(false)
        loadProductos()
      }
      return
    }
    toast({ title: "Exito", description: `Producto ${editingProducto ? "actualizado" : "creado"} correctamente` })
    setDialogOpen(false)
    loadProductos()
  }

  async function handleDelete(producto: Producto) {
    if (!producto.id) return

    // Pre-chequeo de dependencias: ventas/compras bloquean; movimientos de
    // inventario se borran en cascada (se avisa antes de confirmar).
    const dep = await getProductoDependencias(producto.id)
    if (dep.error) {
      toast({ title: "Error", description: dep.error, variant: "destructive" })
      return
    }
    const { ventas, compras, transacciones } = dep.data

    if (ventas > 0) {
      toast({
        title: "No se puede eliminar",
        description: `"${producto.nombre}" tiene ${ventas} venta(s) registrada(s). No se borra para conservar el historial de ventas.`,
        variant: "destructive",
      })
      return
    }
    if (compras > 0) {
      toast({
        title: "No se puede eliminar",
        description: `"${producto.nombre}" tiene ${compras} compra(s)/recepcion(es) registrada(s).`,
        variant: "destructive",
      })
      return
    }

    const mensaje =
      transacciones > 0
        ? `"${producto.nombre}" tiene ${transacciones} movimiento(s) de inventario que se eliminaran junto con el producto. ¿Eliminar de todas formas?`
        : `Eliminar producto "${producto.nombre}"?`
    if (!confirm(mensaje)) return

    const { error } = await deleteProducto(producto.id)
    if (error) {
      toast({ title: "Error", description: error, variant: "destructive" })
    } else {
      toast({
        title: "Exito",
        description:
          transacciones > 0
            ? `Producto y ${transacciones} movimiento(s) de inventario eliminados`
            : "Producto eliminado",
      })
      loadProductos()
    }
  }

  async function handleRecomprimirFotos() {
    setRecomprimiendo(true)
    setRecompProgreso({ total: 0, procesados: 0, comprimidas: 0, errores: 0, bytesAhorrados: 0 })
    const { data, error } = await recomprimirFotosProductos((p) => setRecompProgreso({ ...p }))
    setRecomprimiendo(false)
    if (error) {
      toast({ title: "Error", description: error, variant: "destructive" })
      return
    }
    const mb = (data.bytesAhorrados / (1024 * 1024)).toFixed(1)
    toast({
      title: "Fotos optimizadas",
      description: `${data.comprimidas} de ${data.total} comprimidas · ${mb} MB ahorrados${data.errores ? ` · ${data.errores} con error` : ""}`,
    })
    loadProductos()
  }

  return (
    <div className="space-y-4 md:space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-foreground">Configuracion de Productos</h1>
          <p className="text-sm md:text-base text-muted-foreground">Gestiona el catalogo de productos</p>
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <Button
            onClick={() => { setRecompProgreso(null); setRecompOpen(true) }}
            size="sm"
            variant="outline"
            className="flex-1 sm:flex-none"
            title="Optimiza el peso de las fotos ya subidas de esta empresa"
          >
            <ImageDown className="h-4 w-4 mr-1" />
            Comprimir fotos
          </Button>
          <ImportarProductosDialog onImported={loadProductos} />
          <Button onClick={openNewDialog} size="sm" className="flex-1 sm:flex-none">
            <Plus className="h-4 w-4 mr-1" />
            Nuevo Producto
          </Button>
        </div>
      </div>

      {/* Filtros superiores */}
      <Card className="rounded-xl border-stone-200 bg-stone-50/60 shadow-sm">
        <CardContent className="p-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            {/* Busqueda */}
            <div className="md:col-span-2 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-stone-400" />
              <Input
                placeholder="Buscar por nombre o codigo..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9 bg-white border-stone-200 rounded-xl"
              />
            </div>

            {/* Filtro Marca */}
            <Select value={filterMarca} onValueChange={setFilterMarca}>
              <SelectTrigger className="bg-white border-stone-200 rounded-xl">
                <div className="flex items-center gap-2">
                  <Tag className="h-4 w-4 text-stone-500" />
                  <SelectValue placeholder="Todas las marcas" />
                </div>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas las marcas</SelectItem>
                {marcas.map((m) => (
                  <SelectItem key={m.id} value={m.id!.toString()}>{m.nombre}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Filtro Categoria */}
            <Select value={filterCategoria} onValueChange={setFilterCategoria}>
              <SelectTrigger className="bg-white border-stone-200 rounded-xl">
                <div className="flex items-center gap-2">
                  <Layers className="h-4 w-4 text-stone-500" />
                  <SelectValue placeholder="Todas las categorias" />
                </div>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas las categorias</SelectItem>
                {categorias.map((c) => (
                  <SelectItem key={c.id} value={c.id!.toString()}>{c.nombre}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Filtro Linea (solo si la empresa tiene lineas) */}
            {lineasProducto.length > 0 && (
              <Select value={filterLinea} onValueChange={setFilterLinea}>
                <SelectTrigger className="bg-white border-stone-200 rounded-xl">
                  <div className="flex items-center gap-2">
                    <Layers3 className="h-4 w-4 text-stone-500" />
                    <SelectValue placeholder="Todas las líneas" />
                  </div>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas las líneas</SelectItem>
                  {lineasProducto.map((l) => (
                    <SelectItem key={l.id} value={l.id!.toString()}>{l.nombre}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-xl border-stone-200 shadow-sm">
        <CardHeader className="p-4 md:p-6 pb-3 md:pb-4">
          <CardTitle className="flex items-center gap-2 text-base md:text-lg">
            <Package className="h-4 w-4 md:h-5 md:w-5 text-amber-700" />
            Productos
          </CardTitle>
          <CardDescription className="text-xs md:text-sm">
            {filteredProductos.length} de {productos.length} producto{productos.length !== 1 ? "s" : ""}
          </CardDescription>
        </CardHeader>
        <CardContent className="p-4 md:p-6 pt-0">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-stone-400" />
            </div>
          ) : filteredProductos.length === 0 ? (
            <div className="text-center py-8 text-stone-500">
              <Package className="h-10 w-10 md:h-12 md:w-12 mx-auto mb-2 opacity-50" />
              <p className="text-sm md:text-base">
                {productos.length === 0 ? "No hay productos registrados" : "No se encontraron productos con estos filtros"}
              </p>
              <p className="text-xs md:text-sm">
                {productos.length === 0 ? "Crea tu primer producto" : "Prueba ajustando los filtros"}
              </p>
            </div>
          ) : (
            <>
              {/* Mobile Card View */}
              <div className="block md:hidden space-y-3">
                {filasPaginadas.map((fila) => {
                  if (fila.tipo === "single") {
                    return renderProductoCard(fila.producto)
                  }
                  const expandido = gruposExpandidos.has(fila.grupoId)
                  const rangoPrecio =
                    fila.precioMin === fila.precioMax
                      ? `L ${fila.precioMin.toFixed(2)}`
                      : `L ${fila.precioMin.toFixed(2)} - ${fila.precioMax.toFixed(2)}`
                  // Foto del grupo: la primera talla que tenga foto.
                  const fotoGrupo = fila.tallas.find((t) => t.foto_url)?.foto_url
                  const precioG = fila.tallas[0]?.precio_venta_sugerido || 0
                  const costoG = fila.tallas[0]?.costo_promedio || 0
                  const gananciaG = precioG - costoG
                  const margenG = precioG > 0 ? (gananciaG / precioG) * 100 : 0
                  return (
                    <div key={`g-${fila.grupoId}`} className="border border-amber-200 rounded-xl bg-amber-50/40">
                      <div className="p-3 flex items-center gap-3">
                        <div className="relative h-14 w-14 shrink-0">
                          {fotoGrupo ? (
                            <img src={fotoGrupo} alt={fila.nombre} className="h-14 w-14 rounded-lg object-cover" />
                          ) : (
                            <div className="h-14 w-14 rounded-lg bg-stone-100 flex items-center justify-center">
                              <ImageIcon className="h-5 w-5 text-stone-400" />
                            </div>
                          )}
                          {/* Marca de "varias tallas" sobre la foto */}
                          <span className="absolute -bottom-1 -right-1 rounded-full bg-amber-600 text-white h-5 w-5 flex items-center justify-center shadow" title="Producto con varias tallas">
                            <Layers3 className="h-3 w-3" />
                          </span>
                        </div>
                        <button type="button" onClick={() => toggleGrupo(fila.grupoId)} className="flex-1 min-w-0 text-left">
                          <p className="font-medium truncate text-sm flex items-center gap-1">
                            {expandido ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
                            {fila.nombre}
                            <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-900">{fila.tallas.length} tallas</span>
                          </p>
                          <p className="text-xs text-amber-800">Stock: {fila.stockTotal}</p>
                          <p className="text-xs text-emerald-700 font-medium">{rangoPrecio}</p>
                          <p className={`text-xs ${gananciaG >= 0 ? "text-emerald-700" : "text-red-600"}`}>
                            Ganancia: {formatCurrency(gananciaG)} · {margenG.toFixed(1)}%
                          </p>
                        </button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => setGrupoEditando(fila.grupoId)} title="Editar grupo">
                          <Pencil className="h-4 w-4" />
                        </Button>
                      </div>
                      {expandido && (
                        <div className="px-3 pb-3 space-y-2">
                          {tallasDeGrupo(fila.grupoId).map((t) => renderProductoCard(t, true))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>

              {/* Desktop Table */}
              <div className="hidden md:block rounded-xl border border-stone-200 overflow-hidden">
                <Table containerClassName="max-h-[60vh] overflow-y-auto">
                  <TableHeader sticky>
                    <TableRow className="bg-stone-50/80 hover:bg-stone-50/80">
                      <TableHead className="w-16">Imagen</TableHead>
                      <SortHeader label="Nombre" sortField="nombre" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                      <SortHeader label="Codigo" sortField="codigo_barras" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                      <SortHeader label="Marca" sortField="marca_nombre" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                      <SortHeader label="Categoria" sortField="categoria_nombre" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                      <SortHeader label="Subcategoria" sortField="subcategoria_nombre" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                      {lineasProducto.length > 0 && (
                        <SortHeader label="Línea" sortField="linea_nombre" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                      )}
                      <SortHeader label="Precio Venta" sortField="precio_venta_sugerido" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} align="right" />
                      <SortHeader label="Costo Prom." sortField="costo_promedio" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} align="right" />
                      <SortHeader label="Ganancia" sortField="ganancia" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} align="right" />
                      <SortHeader label="Margen" sortField="margen" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} align="right" />
                      <SortHeader label="Stock" sortField="stock_total" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} align="right" />
                      <TableHead className="w-24"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filasPaginadas.map((fila) => {
                      if (fila.tipo === "single") {
                        return renderProductoRow(fila.producto, false)
                      }
                      // Fila de GRUPO de tallas (una prenda, varias tallas).
                      const expandido = gruposExpandidos.has(fila.grupoId)
                      const rangoPrecio =
                        fila.precioMin === fila.precioMax
                          ? `L ${fila.precioMin.toFixed(2)}`
                          : `L ${fila.precioMin.toFixed(2)} - ${fila.precioMax.toFixed(2)}`
                      // Foto del grupo: la primera talla que tenga foto.
                      const fotoGrupo = fila.tallas.find((t) => t.foto_url)?.foto_url
                      // Precio y costo son únicos para el grupo (los tomamos de
                      // la primera talla). Ganancia y margen se derivan de ellos.
                      const precioGrupo = fila.tallas[0]?.precio_venta_sugerido || 0
                      const costoGrupo = fila.tallas[0]?.costo_promedio || 0
                      const gananciaGrupo = precioGrupo - costoGrupo
                      const margenGrupo = precioGrupo > 0 ? (gananciaGrupo / precioGrupo) * 100 : 0
                      const colorGrupo = gananciaGrupo >= 0 ? "text-emerald-700" : "text-red-600"
                      return (
                        <Fragment key={`g-${fila.grupoId}`}>
                          <TableRow className="bg-amber-50/40 hover:bg-amber-50/70">
                            <TableCell>
                              <div className="relative h-10 w-10">
                                {fotoGrupo ? (
                                  <img src={fotoGrupo} alt={fila.nombre} className="h-10 w-10 rounded-lg object-cover" />
                                ) : (
                                  <div className="h-10 w-10 rounded-lg bg-stone-100 flex items-center justify-center">
                                    <ImageIcon className="h-5 w-5 text-stone-400" />
                                  </div>
                                )}
                                {/* Marca de "varias tallas" sobre la foto */}
                                <span className="absolute -bottom-1 -right-1 rounded-full bg-amber-600 text-white h-4 w-4 flex items-center justify-center shadow" title="Producto con varias tallas">
                                  <Layers3 className="h-2.5 w-2.5" />
                                </span>
                              </div>
                            </TableCell>
                            <TableCell className="font-medium">
                              <button
                                type="button"
                                onClick={() => toggleGrupo(fila.grupoId)}
                                className="inline-flex items-center gap-1.5 text-left hover:text-stone-900"
                              >
                                {expandido ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
                                <span>{fila.nombre}</span>
                                <span className="ml-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-900">
                                  {fila.tallas.length} tallas
                                </span>
                              </button>
                            </TableCell>
                            <TableCell className="text-stone-400 text-xs">—</TableCell>
                            <TableCell>
                              {fila.marca_nombre ? (
                                <Badge variant="outline" className="bg-amber-50 border-amber-200 text-amber-800 rounded-full font-normal">
                                  {fila.marca_nombre}
                                </Badge>
                              ) : (
                                <span className="text-stone-400 text-xs">-</span>
                              )}
                            </TableCell>
                            <TableCell>
                              {fila.categoria_nombre ? (
                                <Badge variant="outline" className="bg-stone-50 border-stone-200 text-stone-700 rounded-full font-normal">
                                  {fila.categoria_nombre}
                                </Badge>
                              ) : (
                                <span className="text-stone-400 text-xs">-</span>
                              )}
                            </TableCell>
                            <TableCell className="text-stone-400 text-xs">—</TableCell>
                            <TableCell className="text-right font-medium text-emerald-700">{rangoPrecio}</TableCell>
                            <TableCell className="text-right text-stone-600">L {costoGrupo.toFixed(2)}</TableCell>
                            <TableCell className={`text-right font-medium ${colorGrupo}`}>{formatCurrency(gananciaGrupo)}</TableCell>
                            <TableCell className={`text-right ${colorGrupo}`}>{margenGrupo.toFixed(1)}%</TableCell>
                            <TableCell className="text-right font-medium">{fila.stockTotal}</TableCell>
                            <TableCell>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                onClick={() => setGrupoEditando(fila.grupoId)}
                                title="Editar grupo y sus tallas"
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                            </TableCell>
                          </TableRow>
                          {expandido &&
                            tallasDeGrupo(fila.grupoId).map((t) => renderProductoRow(t, true))}
                        </Fragment>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>

              <TablePaginator
                pageIndex={pageIndex}
                pageSize={pageSize}
                totalItems={filas.length}
                onPageIndexChange={setPageIndex}
                onPageSizeChange={setPageSize}
                className="border-t"
              />
            </>
          )}
        </CardContent>
      </Card>

      {/* Product Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>{editingProducto ? "Editar Producto" : "Nuevo Producto"}</DialogTitle>
            <DialogDescription>
              Complete los datos del producto. Los campos marcados con * son requeridos.
            </DialogDescription>
          </DialogHeader>
          {/* Bloque de campos: crece y hace scroll dentro de la altura del
              diálogo (max-h-[90vh]), dejando el footer con Guardar siempre
              visible aunque la pantalla sea baja. */}
          <div className="grid gap-4 py-4 flex-1 min-h-0 overflow-y-auto pr-2">
            {/* Image Upload Section */}
            <div className="grid gap-2">
              <Label htmlFor="imagen">
                Imagen del Producto{" "}
                <span className="text-muted-foreground font-normal">(opcional)</span>
              </Label>
              <div className="flex flex-col items-center gap-4 rounded-lg border-2 border-dashed p-4">
                {imagePreview ? (
                  <div className="relative">
                    <img
                      src={imagePreview}
                      alt="Preview"
                      className="h-32 w-32 rounded-lg object-cover shadow-md"
                      onError={() => {
                        // La imagen (tipicamente una URL externa) no cargo: avisa
                        // y vuelve al estado sin foto para no dejar rota la vista.
                        if (formData.foto_url) {
                          toast({ title: "No se pudo cargar la imagen", description: "Esa dirección no muestra la foto (puede estar protegida o rota). Prueba con otra URL.", variant: "destructive" })
                        }
                        setImagePreview("")
                        setFormData(prev => ({ ...prev, foto_url: "" }))
                      }}
                    />
                    {uploadingImage && (
                      <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-background/80">
                        <Spinner className="h-8 w-8" />
                      </div>
                    )}
                    {formData.foto_url && !uploadingImage && (
                      <div className="absolute -right-2 -top-2 h-6 w-6 rounded-full bg-green-500 flex items-center justify-center">
                        <svg className="h-4 w-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="flex h-32 w-32 items-center justify-center rounded-lg bg-muted">
                    <ImageIcon className="h-12 w-12 text-muted-foreground" />
                  </div>
                )}
                <label className="cursor-pointer">
                  <Input
                    id="imagen"
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleImageChange}
                    disabled={uploadingImage}
                  />
                  <Button type="button" variant="outline" asChild disabled={uploadingImage}>
                    <span>
                      {uploadingImage ? (
                        <>
                          <Spinner className="mr-2 h-4 w-4" />
                          Subiendo...
                        </>
                      ) : (
                        <>
                          <Upload className="mr-2 h-4 w-4" />
                          {imagePreview ? "Cambiar Imagen" : "Subir Imagen"}
                        </>
                      )}
                    </span>
                  </Button>
                </label>
                <p className="text-xs text-muted-foreground">PNG, JPG o GIF. Maximo 5MB.</p>

                {/* Alternativa: usar una imagen de la web por su URL */}
                <div className="w-full border-t pt-3 space-y-2">
                  <p className="text-xs text-muted-foreground text-center">o usa una imagen de la web</p>
                  <Button type="button" variant="outline" className="w-full h-9 gap-1" onClick={buscarEnGoogleImagenes} disabled={importandoImg}>
                    <Search className="h-4 w-4" /> Buscar en Google Imágenes
                  </Button>
                  <div className="flex gap-2">
                    <Input
                      type="url"
                      inputMode="url"
                      placeholder="…y pega aquí la URL de la imagen"
                      value={imageUrlInput}
                      onChange={(e) => setImageUrlInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); usarImagenPorUrl() } }}
                      className="h-9"
                      disabled={importandoImg}
                    />
                    <Button type="button" variant="outline" className="h-9 shrink-0 gap-1" onClick={usarImagenPorUrl} disabled={!imageUrlInput.trim() || importandoImg}>
                      {importandoImg ? <Spinner className="h-4 w-4" /> : <Link2 className="h-4 w-4" />} Usar
                    </Button>
                  </div>
                  <p className="text-[11px] text-muted-foreground text-center leading-snug">
                    En Google, clic derecho sobre la imagen → «Copiar dirección de la imagen» y pégala. Se descarga a tu almacenamiento.
                  </p>
                </div>
              </div>
              {validationErrors.foto_url && (
                <p className="text-sm text-destructive">{validationErrors.foto_url}</p>
              )}
            </div>

            {/* Product Name */}
            <div className="grid gap-2">
              <Label htmlFor="nombre">
                Nombre <span className="text-destructive">*</span>
              </Label>
              <Input
                id="nombre"
                value={formData.nombre || ""}
                onChange={(e) => {
                  setFormData({ ...formData, nombre: e.target.value })
                  if (validationErrors.nombre) setValidationErrors(prev => ({ ...prev, nombre: "" }))
                }}
                className={validationErrors.nombre ? "border-destructive" : ""}
                placeholder="Ej: Laptop HP ProBook 450"
              />
              {validationErrors.nombre && (
                <p className="text-sm text-destructive">{validationErrors.nombre}</p>
              )}
            </div>

            {/* Barcode */}
            <div className="grid gap-2">
              <Label htmlFor="codigo">
                Codigo de Barras <span className="text-destructive">*</span>
              </Label>
              <Input
                id="codigo"
                value={formData.codigo_barras || ""}
                onChange={(e) => {
                  setFormData({ ...formData, codigo_barras: e.target.value })
                  if (validationErrors.codigo_barras) setValidationErrors(prev => ({ ...prev, codigo_barras: "" }))
                }}
                className={validationErrors.codigo_barras ? "border-destructive" : ""}
                placeholder="Ej: 7501234567890"
              />
              {validationErrors.codigo_barras && (
                <p className="text-sm text-destructive">{validationErrors.codigo_barras}</p>
              )}
            </div>

            {/* Tallas */}
            {editingProducto || !tallasActivo ? (
              // Al editar, o si la empresa NO tiene activado el sistema de tallas:
              // campo de talla individual del producto (comportamiento clasico).
              <div className="grid gap-2">
                <Label htmlFor="talla">
                  Talla <span className="text-stone-400 text-xs font-normal">(opcional)</span>
                </Label>
                <Input
                  id="talla"
                  value={(formData.talla ?? "") as string}
                  onChange={(e) => setFormData({ ...formData, talla: e.target.value })}
                  placeholder="Ej: S, M, L, 38"
                />
              </div>
            ) : (
              // Al crear con el sistema activo: opción "tiene tallas" (producto por talla).
              <div className="grid gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setTieneTallas((v) => !v)
                    if (validationErrors.tallas) setValidationErrors((prev) => ({ ...prev, tallas: "" }))
                  }}
                  aria-pressed={tieneTallas}
                  className={`flex items-center gap-3 rounded-xl border-2 p-3.5 text-left transition-colors ${
                    tieneTallas
                      ? "border-amber-400 bg-amber-50 ring-1 ring-amber-200"
                      : "border-dashed border-stone-300 bg-white hover:border-amber-300 hover:bg-amber-50/40"
                  }`}
                >
                  <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${tieneTallas ? "bg-amber-200 text-amber-800" : "bg-stone-100 text-stone-500"}`}>
                    <Layers3 className="h-5 w-5" />
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-semibold text-stone-800">¿Este producto tiene tallas?</span>
                    <span className="block text-xs text-stone-500">
                      Actívalo para crear una talla por línea (S, M, L…) con su propia cantidad.
                    </span>
                  </span>
                  <Checkbox
                    checked={tieneTallas}
                    onCheckedChange={(v) => {
                      setTieneTallas(!!v)
                      if (validationErrors.tallas) setValidationErrors((prev) => ({ ...prev, tallas: "" }))
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className="h-5 w-5 shrink-0"
                  />
                </button>

                {tieneTallas ? (
                  <div className="rounded-lg border border-stone-200 bg-stone-50/50 p-3 space-y-3">
                    <p className="text-xs text-muted-foreground">
                      Agrega una línea por talla y escribe la cantidad inicial de cada una.
                      El <strong>precio de venta</strong> y el <strong>costo</strong> son los del
                      formulario (únicos para todas). Cada talla se crea como su propio producto
                      (código <span className="font-mono">código-talla</span>) y quedan agrupadas.
                    </p>

                    {/* Datalist con tallas frecuentes para escribir/elegir rápido */}
                    <datalist id="tallas-preset">
                      {TALLAS_PRESET.map((t) => <option key={t} value={t} />)}
                    </datalist>

                    {lineasTalla.length > 0 && (
                      <div className="space-y-2">
                        <div className="hidden sm:flex items-center gap-2 px-1 text-[11px] font-medium text-stone-500">
                          <span className="flex-1">Talla</span>
                          <span className="w-32">Cantidad inicial</span>
                          <span className="w-8" />
                        </div>
                        {lineasTalla.map((linea, idx) => (
                          <div key={idx} className="flex items-end gap-2">
                            <div className="grid gap-1 flex-1 min-w-0">
                              <Label className="text-xs text-stone-500 sm:hidden">Talla</Label>
                              <Input
                                list="tallas-preset"
                                value={linea.talla}
                                onChange={(e) => {
                                  setLineaTalla(idx, "talla", e.target.value)
                                  if (validationErrors.tallas) setValidationErrors((prev) => ({ ...prev, tallas: "" }))
                                }}
                                placeholder="Ej: S, M, 40, XXL"
                                className="h-10"
                              />
                            </div>
                            <div className="grid gap-1 w-32 shrink-0">
                              <Label className="text-xs text-stone-500 sm:hidden">Cantidad</Label>
                              <Input
                                type="number"
                                min="0"
                                step="1"
                                value={linea.cantidad}
                                onChange={(e) => setLineaTalla(idx, "cantidad", e.target.value)}
                                placeholder="0"
                                className="h-10 text-base"
                              />
                            </div>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-10 w-8 shrink-0 text-stone-500 hover:text-destructive"
                              title="Quitar talla"
                              onClick={() => quitarLineaTalla(idx)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}

                    <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={agregarLineaTalla}>
                      <Plus className="h-4 w-4" /> Agregar talla
                    </Button>

                    {lineasTalla.filter((l) => l.talla.trim()).length > 0 && (
                      <p className="text-xs text-stone-600">
                        Se crearán <span className="font-medium">{lineasTalla.filter((l) => l.talla.trim()).length}</span> producto(s)
                        {(() => {
                          const total = lineasTalla.reduce((a, l) => a + (Number(l.cantidad) || 0), 0)
                          return total > 0 ? ` · ${total} unidad(es) en total` : ""
                        })()}
                      </p>
                    )}
                    {validationErrors.tallas && (
                      <p className="text-sm text-destructive">{validationErrors.tallas}</p>
                    )}
                  </div>
                ) : (
                  // Sin tallas: un solo campo de talla individual (opcional).
                  <Input
                    id="talla"
                    value={(formData.talla ?? "") as string}
                    onChange={(e) => setFormData({ ...formData, talla: e.target.value })}
                    placeholder="Talla individual (opcional): S, M, L, 38"
                  />
                )}
              </div>
            )}

            {/* Es producto fabricado (solo si la empresa tiene Producción) */}
            {produccionActiva && (
              <label className="flex items-center gap-3 rounded-lg border border-stone-200 p-3 cursor-pointer">
                <Checkbox checked={esFabricado} onCheckedChange={(v) => setEsFabricado(!!v)} />
                <span>
                  <span className="block text-sm font-medium">Es producto fabricado</span>
                  <span className="block text-xs text-muted-foreground">
                    Márcalo si este producto se fabrica (aparecerá en Recetas y Órdenes de Producción).
                  </span>
                </span>
              </label>
            )}

            {/* Marca */}
            <div className="grid gap-2">
              <Label htmlFor="marca">
                Marca <span className="text-xs font-normal text-muted-foreground">(opcional — si la dejas vacía queda «Genérico»)</span>
              </Label>
              <div className="flex gap-2">
                <Select
                  value={formData.marca_id?.toString() || ""}
                  onValueChange={(v) => {
                    setFormData({ ...formData, marca_id: parseInt(v) })
                    if (validationErrors.marca_id) setValidationErrors(prev => ({ ...prev, marca_id: "" }))
                  }}
                >
                  <SelectTrigger className={`flex-1 rounded-xl ${validationErrors.marca_id ? "border-destructive" : "border-stone-200"}`}>
                    <SelectValue placeholder="Seleccione una marca" />
                  </SelectTrigger>
                  <SelectContent>
                    {marcas.length === 0 ? (
                      <div className="px-2 py-3 text-sm text-stone-500 text-center">
                        Sin marcas. Agregue una nueva.
                      </div>
                    ) : (
                      marcas.map((m) => (
                        <SelectItem key={m.id} value={m.id!.toString()}>{m.nombre}</SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="shrink-0 border-amber-200 bg-amber-50 hover:bg-amber-100 text-amber-700 rounded-xl"
                  onClick={() => { setNewMarcaName(""); setMarcaDialogOpen(true); }}
                  title="Agregar nueva marca"
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
              {validationErrors.marca_id && (
                <p className="text-sm text-destructive">{validationErrors.marca_id}</p>
              )}
            </div>

            {/* Categoria */}
            <div className="grid gap-2">
              <Label htmlFor="categoria">
                Categoria <span className="text-destructive">*</span>
              </Label>
              <div className="flex gap-2">
                <Select
                  value={formData.categoria_id?.toString() || ""}
                  onValueChange={(v) => {
                    // Cambiar categoria invalida cualquier subcategoria previa
                    // (no tiene sentido mantenerla si pertenece a otra rama).
                    setFormData({
                      ...formData,
                      categoria_id: parseInt(v),
                      subcategoria_id: null,
                    })
                    if (validationErrors.categoria_id) setValidationErrors(prev => ({ ...prev, categoria_id: "" }))
                  }}
                >
                  <SelectTrigger className={`flex-1 rounded-xl ${validationErrors.categoria_id ? "border-destructive" : "border-stone-200"}`}>
                    <SelectValue placeholder="Seleccione una categoria" />
                  </SelectTrigger>
                  <SelectContent>
                    {categorias.length === 0 ? (
                      <div className="px-2 py-3 text-sm text-stone-500 text-center">
                        Sin categorias. Agregue una nueva.
                      </div>
                    ) : (
                      categorias.map((c) => (
                        <SelectItem key={c.id} value={c.id!.toString()}>{c.nombre}</SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="shrink-0 border-stone-300 bg-stone-50 hover:bg-stone-100 text-stone-700 rounded-xl"
                  onClick={() => { setNewCategoriaName(""); setCategoriaDialogOpen(true); }}
                  title="Agregar nueva categoria"
                >
                  <Plus className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="shrink-0 border-stone-300 bg-stone-50 hover:bg-stone-100 text-stone-700 rounded-xl"
                  onClick={() => setManageDialogOpen(true)}
                  title="Gestionar categorias y subcategorias"
                >
                  <Settings2 className="h-4 w-4" />
                </Button>
              </div>
              {validationErrors.categoria_id && (
                <p className="text-sm text-destructive">{validationErrors.categoria_id}</p>
              )}
            </div>

            {/*
              Subcategoria (selector cascada).
              - Deshabilitado si no hay categoria seleccionada.
              - Si hay categoria pero ninguna subcategoria registrada para
                esa rama, se sigue mostrando habilitado pero con un
                placeholder informativo.
              - Es OPCIONAL: el usuario puede dejarlo vacio.
              - Se resetea automaticamente al cambiar categoria.
            */}
            <div className="grid gap-2">
              <Label htmlFor="subcategoria">Subcategoria <span className="text-stone-400 text-xs font-normal">(opcional)</span></Label>
              <div className="flex gap-2">
                <Select
                  value={formData.subcategoria_id?.toString() || "none"}
                  onValueChange={(v) =>
                    setFormData({
                      ...formData,
                      subcategoria_id: v === "none" ? null : parseInt(v),
                    })
                  }
                  disabled={!formData.categoria_id}
                >
                  <SelectTrigger className="flex-1 rounded-xl border-stone-200 disabled:opacity-60">
                    <SelectValue
                      placeholder={
                        !formData.categoria_id
                          ? "Selecciona una categoria primero"
                          : "Sin subcategoria"
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Sin subcategoria</SelectItem>
                    {subcategoriasFiltradas.length === 0 && formData.categoria_id ? (
                      <div className="px-2 py-3 text-xs text-stone-500 text-center">
                        No hay subcategorias en esta rama.
                        <br />
                        Crealas desde el boton de gestion.
                      </div>
                    ) : (
                      subcategoriasFiltradas.map((s) => (
                        <SelectItem key={s.id} value={s.id!.toString()}>
                          {s.nombre}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/*
              Linea de producto (script officemart-002): clasificacion
              transversal, independiente de la categoria. Opcional. Si la
              empresa aun no tiene lineas, el boton + permite crear la primera.
            */}
            <div className="grid gap-2">
              <Label htmlFor="linea">
                Línea de producto <span className="text-stone-400 text-xs font-normal">(opcional)</span>
              </Label>
              <div className="flex gap-2">
                <Select
                  value={formData.linea_id?.toString() || "none"}
                  onValueChange={(v) =>
                    setFormData({ ...formData, linea_id: v === "none" ? null : parseInt(v) })
                  }
                >
                  <SelectTrigger className="flex-1 rounded-xl border-stone-200">
                    <SelectValue placeholder="Sin línea" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Sin línea</SelectItem>
                    {lineasProducto.filter((l) => l.activo !== false || l.id === formData.linea_id).map((l) => (
                      <SelectItem key={l.id} value={l.id!.toString()}>{l.nombre}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="shrink-0 border-sky-200 bg-sky-50 hover:bg-sky-100 text-sky-700 rounded-xl"
                  onClick={() => { setNewLineaName(""); setLineaDialogOpen(true); }}
                  title="Agregar nueva línea de producto"
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {/* Suggested Sale Price */}
            <div className="grid gap-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="precio">
                  Precio de Venta Sugerido (LPS) <span className="text-destructive">*</span>
                </Label>
                <Button 
                  type="button" 
                  variant="ghost" 
                  size="sm" 
                  className="h-7 text-xs gap-1 text-amber-700 hover:text-amber-800 hover:bg-amber-50"
                  onClick={() => setShowCalculator(!showCalculator)}
                >
                  <Calculator className="h-3.5 w-3.5" />
                  {showCalculator ? "Ocultar calculadora" : "Calcular precio"}
                </Button>
              </div>
              
              {/* Price Calculator Panel */}
              {showCalculator && (
                <div className="rounded-lg border-2 border-amber-200 bg-gradient-to-br from-amber-50 to-orange-50 p-4 space-y-4">
                  <div className="flex items-center gap-2 text-amber-800">
                    <Calculator className="h-4 w-4" />
                    <span className="text-sm font-medium">Calculadora de Precio por Margen</span>
                  </div>
                  
                  <p className="text-xs text-amber-700">
                    Formula: Margen = (Precio - Costo) / Precio
                  </p>
                  
                  <div className="grid grid-cols-2 gap-3">
                    {/* Cost Input */}
                    <div className="space-y-1.5">
                      <Label htmlFor="calc-costo" className="text-xs text-amber-800 flex items-center gap-1">
                        <DollarSign className="h-3 w-3" />
                        Costo del Producto
                      </Label>
                      <Input
                        id="calc-costo"
                        type="number"
                        step="0.01"
                        min="0"
                        value={calcCosto || ""}
                        onChange={(e) => onCambioCalcCosto(parseFloat(e.target.value) || 0)}
                        placeholder="0.00"
                        className="bg-white/70 border-amber-200 focus:border-amber-400"
                      />
                    </div>
                    
                    {/* Margin Input */}
                    <div className="space-y-1.5">
                      <Label htmlFor="calc-margen" className="text-xs text-amber-800 flex items-center gap-1">
                        <Percent className="h-3 w-3" />
                        Margen Esperado (%)
                      </Label>
                      <Input
                        id="calc-margen"
                        type="number"
                        step="1"
                        min="0"
                        max="99"
                        value={calcMargen || ""}
                        onChange={(e) => onCambioCalcMargen(parseFloat(e.target.value) || 0)}
                        placeholder="30"
                        className="bg-white/70 border-amber-200 focus:border-amber-400"
                      />
                    </div>
                  </div>
                  
                  {/* Precio de venta EDITABLE (bidireccional con el margen) + Aplicar */}
                  <div className="flex items-end justify-between gap-3 rounded-lg bg-white/80 border border-amber-200 p-3">
                    <div className="space-y-1.5 flex-1">
                      <Label htmlFor="calc-precio" className="text-xs text-amber-800">Precio de Venta</Label>
                      <Input
                        id="calc-precio"
                        type="number"
                        step="0.01"
                        min="0"
                        value={calcPrecio || ""}
                        onChange={(e) => onCambioCalcPrecio(parseFloat(e.target.value) || 0)}
                        placeholder="0.00"
                        className="bg-white border-amber-300 focus:border-amber-500 text-lg font-bold text-amber-800"
                      />
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      disabled={calcPrecioSugerido <= 0}
                      onClick={applyCalculatedPrice}
                      className="bg-amber-600 hover:bg-amber-700 text-white"
                    >
                      Aplicar precio y costo
                    </Button>
                  </div>

                  {calcCosto > 0 && calcPrecioSugerido > 0 && (
                    <p className="text-xs text-amber-600 text-center">
                      Ganancia por unidad: L {(calcPrecioSugerido - calcCosto).toFixed(2)} · Margen {calcMargen.toFixed(2)}%
                    </p>
                  )}
                </div>
              )}
              
              <Input
                id="precio"
                type="number"
                step="0.01"
                min="0"
                value={formData.precio_venta_sugerido || ""}
                onChange={(e) => {
                  setFormData({ ...formData, precio_venta_sugerido: parseFloat(e.target.value) || 0 })
                  if (validationErrors.precio_venta_sugerido) setValidationErrors(prev => ({ ...prev, precio_venta_sugerido: "" }))
                }}
                className={validationErrors.precio_venta_sugerido ? "border-destructive" : ""}
                placeholder="0.00"
              />
              {validationErrors.precio_venta_sugerido && (
                <p className="text-sm text-destructive">{validationErrors.precio_venta_sugerido}</p>
              )}
            </div>

            {/* Inventario inicial: SOLO al crear un producto nuevo. En modo tallas
                la cantidad viene por talla; aquí solo se define el costo único y,
                si hay cantidades, el almacén/localización comunes. */}
            {!editingProducto && (() => {
              const modoTallasUI = tallasActivo && tieneTallas
              const hayCantidad = modoTallasUI
                ? lineasTalla.some((l) => Number(l.cantidad) > 0)
                : invInicial.cantidad > 0
              return (
              <div className="rounded-lg border border-sky-200 bg-sky-50/40 p-4 space-y-4">
                <div>
                  <p className="text-sm font-medium text-sky-900">Inventario inicial (opcional)</p>
                  <p className="text-xs text-muted-foreground">
                    {modoTallasUI
                      ? "La cantidad inicial se pone por talla arriba. Aquí define el costo único (igual para todas) y el almacén/localización donde entrará el inventario."
                      : "Indica la cantidad con la que arranca este producto. Se generará un ingreso manual al inventario en el almacén y localización que elijas. Déjalo en 0 si aún no tienes existencias."}
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  {!modoTallasUI && (
                    <div className="grid gap-2">
                      <Label htmlFor="inv-cantidad">Cantidad inicial</Label>
                      <Input
                        id="inv-cantidad"
                        type="number"
                        min="0"
                        step="1"
                        placeholder="0"
                        value={invInicial.cantidad || ""}
                        onChange={(e) =>
                          setInvInicial({ ...invInicial, cantidad: parseFloat(e.target.value) || 0 })
                        }
                      />
                    </div>
                  )}
                  <div className="grid gap-2">
                    <Label htmlFor="inv-costo">Costo unitario (LPS){modoTallasUI ? " · igual para todas las tallas" : ""}</Label>
                    <Input
                      id="inv-costo"
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="0.00"
                      value={invInicial.costo_unitario || ""}
                      onChange={(e) =>
                        setInvInicial({ ...invInicial, costo_unitario: parseFloat(e.target.value) || 0 })
                      }
                    />
                  </div>
                </div>
                {hayCantidad && (
                  <div className="grid grid-cols-2 gap-4">
                    <div className="grid gap-2">
                      <Label htmlFor="inv-almacen">Almacén</Label>
                      <Select
                        value={invInicial.almacen_id ? String(invInicial.almacen_id) : ""}
                        onValueChange={(v) => {
                          setInvInicial({ ...invInicial, almacen_id: Number(v) })
                          setValidationErrors((prev) => ({ ...prev, inv_almacen: "" }))
                        }}
                      >
                        <SelectTrigger id="inv-almacen" className={validationErrors.inv_almacen ? "border-destructive" : ""}>
                          <SelectValue placeholder="Seleccionar" />
                        </SelectTrigger>
                        <SelectContent>
                          {almacenes.map((a) => (
                            <SelectItem key={a.id} value={String(a.id)}>{a.nombre}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {validationErrors.inv_almacen && (
                        <p className="text-sm text-destructive">{validationErrors.inv_almacen}</p>
                      )}
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="inv-localizacion">Localización</Label>
                      <Select
                        value={invInicial.localizacion_id ? String(invInicial.localizacion_id) : ""}
                        onValueChange={(v) => {
                          setInvInicial({ ...invInicial, localizacion_id: Number(v) })
                          setValidationErrors((prev) => ({ ...prev, inv_localizacion: "" }))
                        }}
                        disabled={!invInicial.almacen_id}
                      >
                        <SelectTrigger id="inv-localizacion" className={validationErrors.inv_localizacion ? "border-destructive" : ""}>
                          <SelectValue placeholder={invInicial.almacen_id ? "Seleccionar" : "Elige almacén primero"} />
                        </SelectTrigger>
                        <SelectContent>
                          {localizacionesInicial.map((l) => (
                            <SelectItem key={l.id} value={String(l.id)}>{l.nombre}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {validationErrors.inv_localizacion && (
                        <p className="text-sm text-destructive">{validationErrors.inv_localizacion}</p>
                      )}
                    </div>
                  </div>
                )}
              </div>
              )
            })()}

            {/* Read-only Fields Section */}
            {editingProducto && (
              <div className="rounded-lg border bg-muted/50 p-4 space-y-4">
                <p className="text-sm font-medium text-muted-foreground">
                  Costo promedio editable. Stock controlado por Compras/Ventas.
                </p>
                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="costo_promedio">
                      Costo Promedio (LPS)
                    </Label>
                    <Input
                      id="costo_promedio"
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="0.00"
                      value={formData.costo_promedio || ""}
                      onChange={(e) =>
                        setFormData({ ...formData, costo_promedio: parseFloat(e.target.value) || 0 })
                      }
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="stock_total" className="text-muted-foreground">
                      Stock Total
                    </Label>
                    <Input
                      id="stock_total"
                      type="number"
                      value={formData.stock_total ?? 0}
                      disabled
                      className="bg-muted cursor-not-allowed"
                    />
                  </div>
                </div>

                {/* Convertir en tallado: solo si la empresa usa tallas y el
                    producto no está ya agrupado en tallas. */}
                {tallasActivo && editingProducto?.id != null && !gruposTallas.has(editingProducto.id) && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50/40 p-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-amber-900 flex items-center gap-1.5">
                        <Layers3 className="h-4 w-4" /> ¿Este producto tiene tallas?
                      </p>
                      <p className="text-xs text-amber-800">
                        Conviértelo en tallado y reparte su stock actual ({editingProducto.stock_total ?? 0}) entre las tallas.
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      className="shrink-0 border-amber-300 bg-white text-amber-800 hover:bg-amber-100"
                      onClick={() => { setConvirtiendo(editingProducto); setDialogOpen(false) }}
                    >
                      Convertir
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>
          <DialogFooter className="shrink-0">
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
            <Button onClick={handleSave} disabled={saving || uploadingImage}>
              {saving && <Spinner className="mr-2 h-4 w-4" />}
              Guardar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Editor de grupo de tallas: ver/editar precio por talla y agregar tallas nuevas */}
      {grupoEditando != null && (
        <EditarGrupoDialog
          grupoId={grupoEditando}
          tallas={tallasDeGrupo(grupoEditando)}
          nombreGrupo={gruposTallas.get(tallasDeGrupo(grupoEditando)[0]?.id ?? -1)?.nombre_grupo || tallasDeGrupo(grupoEditando)[0]?.nombre || ""}
          almacenes={almacenes}
          marcas={marcas}
          categorias={categorias}
          subcategorias={subcategorias}
          lineas={lineasProducto}
          onEditarProducto={(p) => { setGrupoEditando(null); openEditDialog(p) }}
          onClose={() => setGrupoEditando(null)}
          onDone={() => { setGrupoEditando(null); loadProductos() }}
        />
      )}

      {/* Convertir un producto existente en tallado (reparte su stock) */}
      {convirtiendo != null && (
        <ConvertirTalladoDialog
          producto={convirtiendo}
          onClose={() => setConvirtiendo(null)}
          onDone={() => { setConvirtiendo(null); loadProductos() }}
        />
      )}

      {/* Quick-create Marca Modal */}
      <Dialog open={marcaDialogOpen} onOpenChange={setMarcaDialogOpen}>
        <DialogContent className="max-w-sm rounded-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Tag className="h-5 w-5 text-amber-700" />
              Nueva Marca
            </DialogTitle>
            <DialogDescription>
              Agrega una nueva marca al catalogo
            </DialogDescription>
          </DialogHeader>
          <div className="py-3">
            <Label htmlFor="marca-nombre">Nombre</Label>
            <Input
              id="marca-nombre"
              value={newMarcaName}
              onChange={(e) => setNewMarcaName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !creatingMarca) handleCreateMarca() }}
              placeholder="Ej: Samsung"
              className="mt-2 rounded-xl border-stone-200"
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMarcaDialogOpen(false)} disabled={creatingMarca}>
              Cancelar
            </Button>
            <Button
              onClick={handleCreateMarca}
              disabled={creatingMarca || !newMarcaName.trim()}
              className="bg-amber-700 hover:bg-amber-800 text-white"
            >
              {creatingMarca && <Spinner className="mr-2 h-4 w-4" />}
              Crear Marca
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/*
        Modal de Gestion de Categorias y Subcategorias.
        Estructura: acordeon donde cada item es una categoria. Al expandirla
        se ven sus subcategorias y un formulario inline para agregar nuevas.
        Al cerrar refrescamos productos por si las subcategorias cambiaron
        mientras el modal estaba abierto.
      */}
      <ManageCategoriasDialog
        open={manageDialogOpen}
        onOpenChange={(o) => {
          setManageDialogOpen(o)
          if (!o) {
            // Refrescamos productos para que la columna "Subcategoria"
            // refleje borrados que hayan ocurrido en cascada.
            loadProductos()
          }
        }}
        categorias={categorias}
        subcategorias={subcategorias}
        onSubcategoriasChanged={loadSubcategorias}
        onCreateCategoria={() => {
          setNewCategoriaName("")
          setCategoriaDialogOpen(true)
        }}
      />

      {/* Quick-create Categoria Modal */}
      <Dialog open={categoriaDialogOpen} onOpenChange={setCategoriaDialogOpen}>
        <DialogContent className="max-w-sm rounded-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Layers className="h-5 w-5 text-stone-700" />
              Nueva Categoria
            </DialogTitle>
            <DialogDescription>
              Agrega una nueva categoria al catalogo
            </DialogDescription>
          </DialogHeader>
          <div className="py-3">
            <Label htmlFor="categoria-nombre">Nombre</Label>
            <Input
              id="categoria-nombre"
              value={newCategoriaName}
              onChange={(e) => setNewCategoriaName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !creatingCategoria) handleCreateCategoria() }}
              placeholder="Ej: Electronica"
              className="mt-2 rounded-xl border-stone-200"
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCategoriaDialogOpen(false)} disabled={creatingCategoria}>
              Cancelar
            </Button>
            <Button
              onClick={handleCreateCategoria}
              disabled={creatingCategoria || !newCategoriaName.trim()}
              className="bg-stone-700 hover:bg-stone-800 text-white"
            >
              {creatingCategoria && <Spinner className="mr-2 h-4 w-4" />}
              Crear Categoria
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Quick-create Linea de producto Modal */}
      <Dialog open={lineaDialogOpen} onOpenChange={setLineaDialogOpen}>
        <DialogContent className="max-w-sm rounded-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Layers3 className="h-5 w-5 text-sky-700" />
              Nueva Línea de Producto
            </DialogTitle>
            <DialogDescription>
              Clasificación transversal (ej. Suministros de impresión, Equipos). Sirve para precios y reportes por línea.
            </DialogDescription>
          </DialogHeader>
          <div className="py-3">
            <Label htmlFor="linea-nombre">Nombre</Label>
            <Input
              id="linea-nombre"
              value={newLineaName}
              onChange={(e) => setNewLineaName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !creatingLinea) handleCreateLinea() }}
              placeholder="Ej: Suministros de impresión"
              className="mt-2 rounded-xl border-stone-200"
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLineaDialogOpen(false)} disabled={creatingLinea}>
              Cancelar
            </Button>
            <Button
              onClick={handleCreateLinea}
              disabled={creatingLinea || !newLineaName.trim()}
              className="bg-sky-700 hover:bg-sky-800 text-white"
            >
              {creatingLinea && <Spinner className="mr-2 h-4 w-4" />}
              Crear Línea
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Comprimir fotos ya subidas (backfill) */}
      <Dialog open={recompOpen} onOpenChange={(o) => { if (!recomprimiendo) setRecompOpen(o) }}>
        <DialogContent className="max-w-sm rounded-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ImageDown className="h-5 w-5 text-stone-700" />
              Comprimir fotos
            </DialogTitle>
            <DialogDescription>
              Optimiza el peso de las fotos ya subidas de los productos de esta
              empresa (baja la resolucion; no borra ni cambia los productos).
              Util si el catalogo carga lento.
            </DialogDescription>
          </DialogHeader>

          {recompProgreso && (recomprimiendo || recompProgreso.procesados > 0) ? (
            <div className="py-2 space-y-2 text-sm">
              <div className="h-2 w-full rounded-full bg-stone-200 overflow-hidden">
                <div
                  className="h-full bg-emerald-500 transition-all"
                  style={{ width: `${recompProgreso.total ? Math.round((recompProgreso.procesados / recompProgreso.total) * 100) : 0}%` }}
                />
              </div>
              <p className="text-muted-foreground">
                {recompProgreso.procesados} / {recompProgreso.total} procesadas · {recompProgreso.comprimidas} optimizadas
                {recompProgreso.errores > 0 ? ` · ${recompProgreso.errores} con error` : ""}
              </p>
              {recomprimiendo && recompProgreso.actual && (
                <p className="text-xs text-stone-400 truncate">Procesando: {recompProgreso.actual}</p>
              )}
            </div>
          ) : (
            <p className="py-2 text-xs text-muted-foreground">
              Se procesan solo las fotos que se puedan reducir; las ya livianas se
              saltan. Puede tardar un poco segun la cantidad de fotos.
            </p>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setRecompOpen(false)} disabled={recomprimiendo}>
              Cerrar
            </Button>
            <Button onClick={handleRecomprimirFotos} disabled={recomprimiendo}>
              {recomprimiendo && <Spinner className="mr-2 h-4 w-4" />}
              {recomprimiendo ? "Comprimiendo..." : "Comprimir ahora"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ==================== EDITOR DE GRUPO DE TALLAS ====================

/**
 * Panel para gestionar un grupo de tallas: ver todas sus tallas con su stock,
 * editar el precio de cada una, quitar una talla del grupo (o eliminarla) y
 * agregar tallas nuevas (crea un producto hermano con el mismo nombre/marca).
 * El stock es de solo lectura (lo gobierna el inventario); al agregar una talla
 * se puede indicar una cantidad inicial que genera su ingreso manual.
 */
function EditarGrupoDialog({
  grupoId,
  tallas,
  nombreGrupo,
  almacenes,
  marcas,
  categorias,
  subcategorias,
  lineas,
  onEditarProducto,
  onClose,
  onDone,
}: {
  grupoId: number
  tallas: Producto[]
  nombreGrupo: string
  almacenes: Almacen[]
  marcas: Marca[]
  categorias: Categoria[]
  subcategorias: Subcategoria[]
  lineas: LineaProducto[]
  onEditarProducto: (p: Producto) => void
  onClose: () => void
  onDone: () => void
}) {
  const { toast } = useToast()
  const base = tallas[0]

  // ── Datos COMUNES del grupo (se aplican a TODAS las tallas al guardar) ──────
  // Precio de venta y costo son ÚNICOS para todo el grupo; lo único distinto
  // entre tallas es la cantidad (stock, que gobierna el inventario).
  const [comunNombre, setComunNombre] = useState(base?.nombre || "")
  const [comunMarcaId, setComunMarcaId] = useState<number | null>(base?.marca_id ?? null)
  const [comunCategoriaId, setComunCategoriaId] = useState<number | null>(base?.categoria_id ?? null)
  const [comunSubcategoriaId, setComunSubcategoriaId] = useState<number | null>(base?.subcategoria_id ?? null)
  const [comunLineaId, setComunLineaId] = useState<number | null>(base?.linea_id ?? null)
  const [comunFotoUrl, setComunFotoUrl] = useState<string>(base?.foto_url || "")
  const [comunPrecio, setComunPrecio] = useState<string>(String(base?.precio_venta_sugerido ?? 0))
  const [comunCosto, setComunCosto] = useState<string>(String(base?.costo_promedio ?? 0))
  const [subiendoFoto, setSubiendoFoto] = useState(false)
  const [guardandoComun, setGuardandoComun] = useState(false)

  const subcatsComunFiltradas = subcategorias.filter((s) => s.categoria_id === comunCategoriaId)

  async function handleFotoComun(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith("image/")) {
      toast({ title: "Error", description: "Solo se permiten imágenes", variant: "destructive" })
      return
    }
    setSubiendoFoto(true)
    const { url, error } = await uploadProductoImage(file)
    setSubiendoFoto(false)
    if (error || !url) {
      toast({ title: "Error al subir imagen", description: error || "", variant: "destructive" })
      return
    }
    setComunFotoUrl(url)
  }

  // Aplica los datos comunes a TODAS las tallas del grupo: foto, nombre, marca,
  // categoría, subcategoría, PRECIO de venta y COSTO (únicos para todo el grupo).
  // No toca el código ni el stock (cantidad) de cada talla.
  async function guardarComunes() {
    if (!comunNombre.trim()) {
      toast({ title: "Falta el nombre", variant: "destructive" })
      return
    }
    const precio = Number(comunPrecio)
    if (!Number.isFinite(precio) || precio <= 0) {
      toast({ title: "Precio inválido", description: "El precio de venta debe ser mayor a 0", variant: "destructive" })
      return
    }
    const costo = Number(comunCosto) || 0
    setGuardandoComun(true)
    const errores: string[] = []
    for (const t of tallas) {
      const { error } = await saveProducto({
        ...t,
        nombre: comunNombre.trim(),
        foto_url: comunFotoUrl || "",
        marca_id: comunMarcaId,
        categoria_id: comunCategoriaId,
        subcategoria_id: comunCategoriaId ? comunSubcategoriaId : null,
        linea_id: comunLineaId,
        precio_venta_sugerido: precio,
        costo_promedio: costo,
      }, false)
      if (error) errores.push(`Talla ${t.talla}: ${error}`)
    }
    setGuardandoComun(false)
    if (errores.length > 0) {
      toast({ title: "Error al guardar", description: errores.join(" · "), variant: "destructive" })
      return
    }
    toast({ title: "Guardado", description: "Se aplicó a todas las tallas del grupo." })
    onDone()
  }

  // Agregar talla nueva.
  const [nuevaTalla, setNuevaTalla] = useState("")
  const [nuevaCantidad, setNuevaCantidad] = useState("")
  const [nuevoAlmacen, setNuevoAlmacen] = useState<number>(0)
  const [nuevaLocalizacion, setNuevaLocalizacion] = useState<number>(0)
  const [locsNueva, setLocsNueva] = useState<Localizacion[]>([])
  const [agregando, setAgregando] = useState(false)

  useEffect(() => {
    if (nuevoAlmacen) {
      getLocalizaciones(nuevoAlmacen).then((r) => { setLocsNueva(r.data); setNuevaLocalizacion(0) })
    } else {
      setLocsNueva([])
    }
  }, [nuevoAlmacen])

  const tallasExistentes = new Set(tallas.map((t) => (t.talla || "").toLowerCase()))

  async function quitarTalla(t: Producto) {
    if (!t.id) return
    if (!confirm(`¿Quitar la talla "${t.talla}" del grupo? El producto no se elimina, solo deja de estar agrupado.`)) return
    const { error } = await quitarDeGrupo(t.id)
    if (error) {
      toast({ title: "Error", description: error, variant: "destructive" })
      return
    }
    toast({ title: "Talla desagrupada", description: `"${t.talla}" ya no pertenece al grupo.` })
    onDone()
  }

  async function agregarTalla() {
    const talla = nuevaTalla.trim()
    if (!talla) {
      toast({ title: "Escribe la talla", variant: "destructive" })
      return
    }
    if (tallasExistentes.has(talla.toLowerCase())) {
      toast({ title: "Talla repetida", description: `El grupo ya tiene la talla ${talla}.`, variant: "destructive" })
      return
    }
    if (!base) return
    const cantidad = Number(nuevaCantidad) || 0
    if (cantidad > 0 && (!nuevoAlmacen || !nuevaLocalizacion)) {
      toast({ title: "Faltan datos", description: "Elige almacén y localización para la cantidad inicial.", variant: "destructive" })
      return
    }
    setAgregando(true)
    // Crea el producto hermano con el nombre/marca/categoria/foto y el PRECIO y
    // COSTO COMUNES del grupo, y su codigo base + talla.
    const codigoBase = (base.codigo_barras || "").replace(/-[^-]*$/, "") || base.codigo_barras || ""
    const precioComun = Number(comunPrecio) || base.precio_venta_sugerido || 0
    const costoComun = Number(comunCosto) || 0
    const nuevoProducto: Producto = {
      nombre: comunNombre.trim() || base.nombre,
      codigo_barras: `${codigoBase}-${talla}`,
      precio_venta_sugerido: precioComun,
      costo_promedio: costoComun,
      foto_url: comunFotoUrl || base.foto_url || "",
      marca_id: comunMarcaId,
      categoria_id: comunCategoriaId,
      subcategoria_id: comunCategoriaId ? comunSubcategoriaId : null,
      linea_id: comunLineaId,
      talla,
    }
    const { data: creado, error } = await saveProducto(nuevoProducto, true)
    if (error || !creado?.id) {
      setAgregando(false)
      toast({ title: "Error", description: error || "No se pudo crear la talla", variant: "destructive" })
      return
    }
    // Vincula la nueva talla al grupo.
    await agregarProductoAGrupo(grupoId, creado.id, nombreGrupo || base.nombre)
    // Inventario inicial opcional (con el costo común del grupo).
    if (cantidad > 0) {
      await procesarIngresoManual({
        producto_id: creado.id,
        almacen_id: nuevoAlmacen,
        localizacion_id: nuevaLocalizacion,
        cantidad,
        costo_unitario: costoComun,
        observaciones: "Inventario inicial (talla nueva)",
        stock_anterior: 0,
        costo_anterior: 0,
        nuevo_stock: cantidad,
        nuevo_costo: costoComun,
      })
    }
    setAgregando(false)
    toast({ title: "Talla agregada", description: `Se creó la talla ${talla}.` })
    setNuevaTalla(""); setNuevaCantidad(""); setNuevoAlmacen(0); setNuevaLocalizacion(0)
    onDone()
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Layers3 className="h-5 w-5 text-amber-700" />
            {nombreGrupo || base?.nombre || "Grupo de tallas"}
          </DialogTitle>
          <DialogDescription>
            {tallas.length} talla(s). Edita los datos comunes (foto, marca, categoría) que
            aplican a todas, el precio de cada una, o edita una talla individual.
          </DialogDescription>
        </DialogHeader>

        {/* ── Datos COMUNES del grupo (foto/nombre/marca/categoría) ─────────── */}
        <div className="rounded-lg border border-stone-200 bg-stone-50/50 p-3 space-y-3">
          <p className="text-sm font-medium text-stone-700">Datos comunes (todas las tallas)</p>
          <div className="flex gap-3">
            {/* Foto */}
            <div className="shrink-0">
              <label className="cursor-pointer block">
                <input type="file" accept="image/*" className="hidden" onChange={handleFotoComun} disabled={subiendoFoto} />
                {comunFotoUrl ? (
                  <img src={comunFotoUrl} alt="" className="h-20 w-20 rounded-lg object-cover border" />
                ) : (
                  <div className="h-20 w-20 rounded-lg border-2 border-dashed border-stone-300 flex items-center justify-center bg-white">
                    {subiendoFoto ? <Spinner className="h-5 w-5" /> : <ImageIcon className="h-6 w-6 text-stone-400" />}
                  </div>
                )}
                <span className="mt-1 block text-center text-[10px] text-amber-700">{subiendoFoto ? "Subiendo…" : "Cambiar foto"}</span>
              </label>
            </div>
            {/* Nombre + selects */}
            <div className="flex-1 min-w-0 grid gap-2">
              <div className="grid gap-1">
                <Label className="text-xs text-stone-500">Nombre</Label>
                <Input value={comunNombre} onChange={(e) => setComunNombre(e.target.value)} className="h-9" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="grid gap-1">
                  <Label className="text-xs text-stone-500">Marca</Label>
                  <Select value={comunMarcaId?.toString() || "none"} onValueChange={(v) => setComunMarcaId(v === "none" ? null : parseInt(v))}>
                    <SelectTrigger className="h-9"><SelectValue placeholder="Sin marca" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Sin marca</SelectItem>
                      {marcas.map((m) => (<SelectItem key={m.id} value={m.id!.toString()}>{m.nombre}</SelectItem>))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-1">
                  <Label className="text-xs text-stone-500">Categoría</Label>
                  <Select value={comunCategoriaId?.toString() || "none"} onValueChange={(v) => { setComunCategoriaId(v === "none" ? null : parseInt(v)); setComunSubcategoriaId(null) }}>
                    <SelectTrigger className="h-9"><SelectValue placeholder="Sin categoría" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Sin categoría</SelectItem>
                      {categorias.map((c) => (<SelectItem key={c.id} value={c.id!.toString()}>{c.nombre}</SelectItem>))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {comunCategoriaId != null && subcatsComunFiltradas.length > 0 && (
                <div className="grid gap-1">
                  <Label className="text-xs text-stone-500">Subcategoría</Label>
                  <Select value={comunSubcategoriaId?.toString() || "none"} onValueChange={(v) => setComunSubcategoriaId(v === "none" ? null : parseInt(v))}>
                    <SelectTrigger className="h-9"><SelectValue placeholder="Sin subcategoría" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Sin subcategoría</SelectItem>
                      {subcatsComunFiltradas.map((s) => (<SelectItem key={s.id} value={s.id!.toString()}>{s.nombre}</SelectItem>))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {lineas.length > 0 && (
                <div className="grid gap-1">
                  <Label className="text-xs text-stone-500">Línea de producto</Label>
                  <Select value={comunLineaId?.toString() || "none"} onValueChange={(v) => setComunLineaId(v === "none" ? null : parseInt(v))}>
                    <SelectTrigger className="h-9"><SelectValue placeholder="Sin línea" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Sin línea</SelectItem>
                      {lineas.map((l) => (<SelectItem key={l.id} value={l.id!.toString()}>{l.nombre}</SelectItem>))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          </div>
          {/* Precio y costo: únicos para todo el grupo */}
          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-1">
              <Label className="text-xs text-stone-500">Precio de venta (L) · todas las tallas</Label>
              <Input type="number" step="0.01" min="0" value={comunPrecio} onChange={(e) => setComunPrecio(e.target.value)} className="h-10 text-base" />
            </div>
            <div className="grid gap-1">
              <Label className="text-xs text-stone-500">Costo (L) · todas las tallas</Label>
              <Input type="number" step="0.01" min="0" value={comunCosto} onChange={(e) => setComunCosto(e.target.value)} className="h-10 text-base" />
            </div>
          </div>
          <Button
            size="sm"
            className="w-full bg-amber-600 hover:bg-amber-700 text-white"
            disabled={guardandoComun || subiendoFoto}
            onClick={guardarComunes}
          >
            {guardandoComun ? <Spinner className="mr-2 h-4 w-4" /> : null}
            Guardar
          </Button>
        </div>

        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Tallas del grupo · la cantidad (stock) de cada una la controla el inventario.
          </p>
          {tallas.map((t) => (
            <div key={t.id} className="rounded-lg border border-stone-200 p-3">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="rounded-full bg-amber-100 px-2.5 py-1 text-center text-xs font-semibold text-amber-900">
                  Talla {t.talla || "—"}
                </span>
                <span className="font-mono text-xs text-stone-500 truncate">{t.codigo_barras}</span>
                <span className="text-xs text-stone-500">Stock: {t.stock_total || 0}</span>
                <div className="ml-auto flex items-center gap-1 shrink-0">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 gap-1"
                    title="Editar esta talla (foto, código, datos)"
                    onClick={() => onEditarProducto(t)}
                  >
                    <Pencil className="h-3.5 w-3.5" /> Editar
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 text-stone-500 hover:text-destructive"
                    title="Quitar del grupo"
                    onClick={() => quitarTalla(t)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Agregar talla nueva */}
        <div className="rounded-lg border border-amber-200 bg-amber-50/40 p-3 space-y-3">
          <p className="text-sm font-medium text-amber-900 flex items-center gap-1.5">
            <Plus className="h-4 w-4" /> Agregar una talla
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label className="text-xs">Talla</Label>
              <Input value={nuevaTalla} onChange={(e) => setNuevaTalla(e.target.value)} placeholder="Ej: XL, 42" className="h-9" />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">Cantidad inicial (opcional)</Label>
              <Input type="number" min="0" value={nuevaCantidad} onChange={(e) => setNuevaCantidad(e.target.value)} placeholder="0" className="h-9" />
            </div>
          </div>
          {Number(nuevaCantidad) > 0 && (
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label className="text-xs">Almacén</Label>
                <Select value={nuevoAlmacen ? String(nuevoAlmacen) : ""} onValueChange={(v) => setNuevoAlmacen(Number(v))}>
                  <SelectTrigger className="h-9"><SelectValue placeholder="Seleccionar" /></SelectTrigger>
                  <SelectContent>
                    {almacenes.map((a) => (<SelectItem key={a.id} value={String(a.id)}>{a.nombre}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label className="text-xs">Localización</Label>
                <Select value={nuevaLocalizacion ? String(nuevaLocalizacion) : ""} onValueChange={(v) => setNuevaLocalizacion(Number(v))} disabled={!nuevoAlmacen}>
                  <SelectTrigger className="h-9"><SelectValue placeholder={nuevoAlmacen ? "Seleccionar" : "Elige almacén"} /></SelectTrigger>
                  <SelectContent>
                    {locsNueva.map((l) => (<SelectItem key={l.id} value={String(l.id)}>{l.nombre}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
          <Button size="sm" onClick={agregarTalla} disabled={agregando || !nuevaTalla.trim()} className="bg-amber-600 hover:bg-amber-700 text-white">
            {agregando && <Spinner className="mr-2 h-4 w-4" />}
            Agregar talla
          </Button>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cerrar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ==================== CONVERTIR PRODUCTO EN TALLADO ====================

/**
 * Convierte un producto normal en tallado repartiendo su stock actual entre
 * las tallas. El producto original queda como una talla más del grupo (su stock
 * sale y se reingresa por talla). Costo y precio se mantienen. La suma de las
 * cantidades debe coincidir EXACTO con el stock actual. Si el stock está en
 * varias localizaciones, se bloquea.
 */
function ConvertirTalladoDialog({
  producto,
  onClose,
  onDone,
}: {
  producto: Producto
  onClose: () => void
  onDone: () => void
}) {
  const { toast } = useToast()
  const [cargando, setCargando] = useState(true)
  const [stockTotal, setStockTotal] = useState(0)
  const [numLocs, setNumLocs] = useState(0)
  // Primera línea = el propio producto original (su talla). Las demás, nuevas.
  const [lineas, setLineas] = useState<{ talla: string; cantidad: string }[]>([
    { talla: "", cantidad: "" },
    { talla: "", cantidad: "" },
  ])
  const [guardando, setGuardando] = useState(false)

  useEffect(() => {
    let cancel = false
    getRepartoInfo(producto.id!).then((r) => {
      if (cancel) return
      setStockTotal(r.stockTotal)
      setNumLocs(r.localizaciones.length)
      setCargando(false)
    })
    return () => { cancel = true }
  }, [producto.id])

  const bloqueadoMultiLoc = stockTotal > 0 && numLocs > 1
  const sumaActual = lineas.reduce((a, l) => a + (Math.max(0, Math.floor(Number(l.cantidad) || 0))), 0)
  const tallasLlenas = lineas.filter((l) => l.talla.trim() !== "").length
  const cuadra = sumaActual === stockTotal

  function setLinea(idx: number, campo: "talla" | "cantidad", valor: string) {
    setLineas((prev) => prev.map((l, i) => (i === idx ? { ...l, [campo]: valor } : l)))
  }
  function agregar() { setLineas((prev) => [...prev, { talla: "", cantidad: "" }]) }
  function quitar(idx: number) { setLineas((prev) => prev.filter((_, i) => i !== idx)) }

  async function confirmar() {
    const limpias = lineas
      .map((l) => ({ talla: l.talla.trim(), cantidad: Math.max(0, Math.floor(Number(l.cantidad) || 0)) }))
      .filter((l) => l.talla !== "")
    if (limpias.length < 2) {
      toast({ title: "Faltan tallas", description: "Agrega al menos dos tallas.", variant: "destructive" })
      return
    }
    setGuardando(true)
    const res = await convertirProductoATallado({
      original: producto,
      tallaOriginal: limpias[0].talla, // la primera línea es el producto original
      lineas: limpias,
    })
    setGuardando(false)
    if (!res.success) {
      toast({ title: "No se pudo convertir", description: res.error || "Error", variant: "destructive" })
      return
    }
    toast({
      title: "Producto convertido en tallado",
      description: res.error || `${limpias.length} tallas creadas y agrupadas.`,
      variant: res.error ? "destructive" : undefined,
    })
    onDone()
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Layers3 className="h-5 w-5 text-amber-700" /> Convertir en producto tallado
          </DialogTitle>
          <DialogDescription>
            {producto.nombre} · Reparte su stock actual entre las tallas. El costo y el
            precio se mantienen para todas.
          </DialogDescription>
        </DialogHeader>

        {cargando ? (
          <div className="flex justify-center py-10"><Spinner className="h-6 w-6" /></div>
        ) : bloqueadoMultiLoc ? (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
            El stock de este producto ({stockTotal}) está repartido en <strong>{numLocs} localizaciones</strong>.
            Consolídalo en una sola (con un traslado en Inventario → Traslados) antes de convertirlo en tallado.
          </div>
        ) : (
          <div className="space-y-3">
            <div className="rounded-lg bg-stone-50 border border-stone-200 p-3 text-sm">
              <span className="text-stone-500">Stock actual a repartir:</span>{" "}
              <span className="font-bold text-stone-800">{stockTotal}</span>
              {stockTotal === 0 && (
                <p className="text-xs text-stone-500 mt-1">
                  Sin stock: solo se crean las tallas (todas en 0). Deja las cantidades en 0.
                </p>
              )}
            </div>

            <datalist id="tallas-preset-conv">
              {TALLAS_PRESET.map((t) => <option key={t} value={t} />)}
            </datalist>

            <p className="text-xs text-muted-foreground">
              La <strong>primera</strong> talla se asigna a este mismo producto (conserva su historial);
              las demás se crean como tallas nuevas. La suma de cantidades debe ser {stockTotal}.
            </p>

            <div className="space-y-2">
              <div className="hidden sm:flex items-center gap-2 px-1 text-[11px] font-medium text-stone-500">
                <span className="flex-1">Talla</span>
                <span className="w-28">Cantidad</span>
                <span className="w-8" />
              </div>
              {lineas.map((l, idx) => (
                <div key={idx} className="flex items-end gap-2">
                  <div className="grid gap-1 flex-1 min-w-0">
                    {idx === 0 && <span className="text-[10px] font-semibold text-amber-700">Este producto</span>}
                    <Input
                      list="tallas-preset-conv"
                      value={l.talla}
                      onChange={(e) => setLinea(idx, "talla", e.target.value)}
                      placeholder="Ej: S, M, 40"
                      className="h-10"
                    />
                  </div>
                  <div className="w-28 shrink-0">
                    <Input
                      type="number"
                      min="0"
                      step="1"
                      value={l.cantidad}
                      onChange={(e) => setLinea(idx, "cantidad", e.target.value)}
                      placeholder="0"
                      className="h-10 text-base"
                    />
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-10 w-8 shrink-0 text-stone-500 hover:text-destructive disabled:opacity-30"
                    disabled={lineas.length <= 2}
                    onClick={() => quitar(idx)}
                    title="Quitar talla"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>

            <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={agregar}>
              <Plus className="h-4 w-4" /> Agregar talla
            </Button>

            <div className={`text-xs font-medium ${cuadra ? "text-emerald-700" : "text-amber-700"}`}>
              Suma: {sumaActual} / {stockTotal} {cuadra ? "✓" : "· debe cuadrar exacto"}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          {!bloqueadoMultiLoc && !cargando && (
            <Button
              onClick={confirmar}
              disabled={guardando || !cuadra || tallasLlenas < 2}
              className="bg-amber-600 hover:bg-amber-700 text-white gap-2"
            >
              {guardando && <Spinner className="h-4 w-4" />}
              Convertir y repartir
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
