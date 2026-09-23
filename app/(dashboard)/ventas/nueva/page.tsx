"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Plus, Minus, Trash2, FileText, ShoppingCart, User, Receipt, Warehouse, MapPin, AlertTriangle, UserPlus, Wallet, X, Landmark, Printer, CheckCircle2, Maximize2, Minimize2, ChevronsUpDown, Check, Zap } from "lucide-react"
import { generarFacturaPdf, type FacturaPdfFiscal } from "@/lib/utils/factura-pdf"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { Separator } from "@/components/ui/separator"
import { Badge } from "@/components/ui/badge"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useToast } from "@/hooks/use-toast"
import { getClientes, getProductos, buscarProductos, getAlmacenes, getLocalizaciones, getMarcas, getCategorias, saveCliente, type Cliente, type Producto, type Almacen, type Localizacion, type Marca, type Categoria } from "@/lib/services/catalogos"
import { ProductCatalog } from "./product-catalog"
import { getStockMultipleProducts } from "@/lib/services/inventario"
import { 
  getNextCorrelativo,
  crearVenta,
  getRazonSocialForPdf,
  getSaldoPendienteCliente,
  excedeLimiteCredito,
  bloqueoCreditoCliente,
  getFacturasVencidasCliente,
  type VentaEncabezado,
  type VentaDetalle,
  type PagoVentaDetalleInput,
} from "@/lib/services/ventas"
import { getVendedores, getVendedorDeUsuario, resolverVendedorPorDefecto, type Vendedor } from "@/lib/services/vendedores"
import {
  getPuntosFacturacion,
  resolverPuntoVenta,
  fiscalDesdeSnapshot,
  parseFiscalSnapshot,
  etiquetaPunto,
  type PuntoFacturacion,
} from "@/lib/services/puntos-facturacion"
import { useTenant } from "@/lib/hooks/use-tenant"
import { useAuth } from "@/lib/contexts/auth-context"
import { getListaAplicadaCliente, calcularPrecioLista, type ListaAplicada } from "@/lib/services/listas-precios"
import { getCuentas, type CuentaConfig } from "@/lib/services/cuentas"
import { useCajaSesion } from "@/lib/hooks/use-caja-sesion"
import { printTirilla } from "@/lib/print-tirilla"
import { tirillaLogoUrl } from "@/lib/utils/tirilla-logos"
import { buildTirillaVentaHtml, metodoPagoLabel, type TirillaVenta, type TirillaFiscal } from "@/lib/utils/tirilla-venta"
import {
  getConfigsCai,
  calcularDesgloseFiscal,
  formatearCorrelativoCai,
  fmtFechaCorta,
  totalEnLetras,
  type ConfigCai,
} from "@/lib/services/facturacion-cai"
import { hoyISO, timestampNaiveLocal } from "@/lib/utils/fecha"
import { leerConversionPendiente, marcarCotizacionFacturada } from "@/lib/services/cotizaciones"

interface LineaVenta {
  /** Key estable para React/dedupe (las lineas de Venta Rapida no tienen id). */
  _key: string
  /** NULL en lineas de "Venta Rapida" (producto/servicio no catalogado, sin inventario). */
  producto_id: number | null
  producto_nombre: string
  producto_codigo: string
  /** Descripcion libre (solo Venta Rapida). Se persiste aparte para el historial. */
  descripcion_libre?: string | null
  cantidad: number
  precio_unitario: number
  costo_promedio: number
  subtotal: number
  utilidad_linea: number
  stock_disponible: number
  /** Precio pactado (viene de una cotización): no se re-precia al cambiar de cliente. */
  precio_fijo?: boolean
}

let ventaRapidaSeq = 0

export default function NuevaVentaPage() {
  const router = useRouter()
  const { toast } = useToast()
  const { ready, razonSocialId } = useTenant()
  const { user, hasModulo } = useAuth()
  // Feature Listas de Precios (habilitada por empresa por el super-admin).
  const puedeListas = hasModulo("Listas de Precios")
  // Flag por empresa: si es false, la empresa vende SIN ISV (se oculta el campo).
  const mostrarIsv = user?.flags?.ventas_mostrar_isv ?? true
  // Flag por empresa: activa el lector de codigo de barras (escanear = ubicar/agregar).
  const lectorCodigoBarras = user?.flags?.ventas_lector_codigo_barras ?? false
  // Flag por empresa: habilita "Venta Rapida" (linea manual sin inventario).
  const ventaRapidaActiva = user?.flags?.venta_rapida ?? false
  // Flag por empresa: bloquear precio de venta + descuento a los NO admin.
  const esAdmin = (user?.rol || "").trim().toLowerCase() === "admin"
  const bloquearPrecioDescuento = (user?.flags?.ventas_bloquear_precio_descuento ?? false) && !esAdmin
  // Modulo "Vendedores y Zonas" (habilitado por empresa): campo Vendedor en la venta.
  const usaVendedores = hasModulo("Vendedores y Zonas")
  // Flag por empresa: no se puede guardar la venta sin elegir vendedor.
  const vendedorObligatorio = usaVendedores && (user?.flags?.ventas_vendedor_obligatorio ?? false)

  // Modo pantalla completa (kiosko POS): el modulo abarca el 100% de la pantalla.
  const [fullscreen, setFullscreen] = React.useState(false)
  const posRootRef = React.useRef<HTMLDivElement>(null)

  // Dialogo "Venta Rapida" (linea manual sin inventario).
  const [ventaRapidaOpen, setVentaRapidaOpen] = React.useState(false)
  const [vrDescripcion, setVrDescripcion] = React.useState("")
  const [vrPrecio, setVrPrecio] = React.useState("")
  const [vrCantidad, setVrCantidad] = React.useState("1")

  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)
  const [clientes, setClientes] = React.useState<Cliente[]>([])
  // Lista de precios del cliente seleccionado (null = precio del maestro).
  const [listaAplicada, setListaAplicada] = React.useState<ListaAplicada | null>(null)
  const [productos, setProductos] = React.useState<Producto[]>([])
  const [marcas, setMarcas] = React.useState<Marca[]>([])
  const [categorias, setCategorias] = React.useState<Categoria[]>([])
  const [almacenes, setAlmacenes] = React.useState<Almacen[]>([])
  const [localizaciones, setLocalizaciones] = React.useState<Localizacion[]>([])
  const [localizacionesFiltradas, setLocalizacionesFiltradas] = React.useState<Localizacion[]>([])
  
  const [clienteId, setClienteId] = React.useState<string>("")
  const [clienteComboOpen, setClienteComboOpen] = React.useState(false)
  // Vendedor de la venta (modulo Vendedores y Zonas). "" = sin vendedor.
  const [vendedores, setVendedores] = React.useState<Vendedor[]>([])
  const [vendedorId, setVendedorId] = React.useState<string>("")
  // Vendedor que ES el usuario logueado (si esta vinculado): se preselecciona.
  const [vendedorUsuarioId, setVendedorUsuarioId] = React.useState<number | null>(null)
  const [numeroFactura, setNumeroFactura] = React.useState("")
  // Cotización que se está facturando (módulo Cotizaciones): al guardar la
  // venta se marca Facturada con el id de la venta.
  const cotizacionRef = React.useRef<{ id: number; numero: string } | null>(null)
  // Puntos de facturación (script officemart-004). "" = sin punto (flujo clásico).
  // El punto define serie interna, CAI y almacén/localización por defecto.
  const [puntos, setPuntos] = React.useState<PuntoFacturacion[]>([])
  const [puntoId, setPuntoId] = React.useState<string>("")
  const puntoSeleccionado = React.useMemo(
    () => puntos.find((p) => String(p.id) === puntoId) ?? null,
    [puntos, puntoId]
  )
  // El admin (o un usuario sin punto asignado) puede cambiar de punto.
  const puedeElegirPunto = puntos.length > 1 && (esAdmin || user?.punto_facturacion_id == null)
  // Fecha local (dia de negocio). NO usar toISOString(): de noche adelanta el dia.
  const [fecha, setFecha] = React.useState(hoyISO())
  // ISV desactivado por defecto: la mayoria de ventas se registran sin ISV.
  const [aplicaIsv, setAplicaIsv] = React.useState(false)
  const [almacenId, setAlmacenId] = React.useState<string>("")
  const [localizacionId, setLocalizacionId] = React.useState<string>("")
  const [descuentoPct, setDescuentoPct] = React.useState<number>(0)

  // Desglose multi-metodo de pago. Cada linea representa un instrumento
  // de pago distinto (Efectivo, Banco, Link de Pago, Credito). La suma de
  // `monto_bruto` define el `valorpago` y, derivado, el `estado_pago`:
  //   suma === 0       -> Pendiente
  //   suma >= total    -> Pagado
  //   0 < suma < total -> Parcial
  // Se permite explicitamente que la suma sea < total: el saldo restante
  // queda como cuenta por cobrar (CXC).
  type PagoLinea = PagoVentaDetalleInput & { _id: string }
  const [pagosDetalle, setPagosDetalle] = React.useState<PagoLinea[]>([])
  // Efectivo con el que paga el cliente por linea (solo para calcular el
  // vuelto). NO se persiste: lo que se registra es `monto_bruto` (el monto de
  // la venta); el vuelto es una ayuda para el cajero. Clave = _id de la linea.
  const [efectivoRecibido, setEfectivoRecibido] = React.useState<Record<string, string>>({})
  const [cuentas, setCuentas] = React.useState<CuentaConfig[]>([])
  const { sesion: cajaSesion, featurePending: cajaFeaturePending } = useCajaSesion()

  // Venta recien registrada: alimenta el dialogo con las opciones de impresion
  // (tirilla 80 mm / factura PDF). Es una FOTO de la venta; sobrevive al
  // resetForm() para que el usuario pueda imprimir despues de guardar.
  const [ventaExitosa, setVentaExitosa] = React.useState<{
    numeroFactura: string
    total: number
    tirilla: TirillaVenta
    ventaData: { encabezado: VentaEncabezado; detalles: VentaDetalle[] }
    cliente: Cliente | undefined
  } | null>(null)
  const [imprimiendo, setImprimiendo] = React.useState(false)
  
  const [lineas, setLineas] = React.useState<LineaVenta[]>([])

  const [stockPorLocalizacion, setStockPorLocalizacion] = React.useState<Record<number, number>>({})
  const [loadingStock, setLoadingStock] = React.useState(false)
  // Stock de TODO el catalogo en la localizacion seleccionada. Se usa para
  // filtrar el catalogo y mostrar solo referencias disponibles (stock > 0)
  // con su cantidad exacta en esa localizacion. Vacio = sin localizacion.
  const [stockCatalogo, setStockCatalogo] = React.useState<Record<number, number>>({})
  const [loadingCatalogo, setLoadingCatalogo] = React.useState(false)
  // Busqueda de productos "desde cero" contra la BD (boton Buscar del catalogo).
  // null = modo navegacion (catalogo precargado); array = resultados de la ultima
  // busqueda. Asi encontramos productos aunque el catalogo pase de 1000.
  const [resultadosBusqueda, setResultadosBusqueda] = React.useState<Producto[] | null>(null)
  const [buscandoProductos, setBuscandoProductos] = React.useState(false)
  // Texto del buscador del catalogo (controlado, para que el lector de codigo
  // de barras pueda inyectar/limpiar el codigo escaneado).
  const [busquedaTexto, setBusquedaTexto] = React.useState("")

  // Quick client creation
  const [showClienteDialog, setShowClienteDialog] = React.useState(false)
  const [savingCliente, setSavingCliente] = React.useState(false)
  const [nuevoCliente, setNuevoCliente] = React.useState<Partial<Cliente>>({
    nombre: "",
    rtn: "",
    direccion: "",
    telefono: "",
    fecha_nacimiento: "",
  })

  React.useEffect(() => {
    if (!ready) {
      console.log("[NuevaVenta] esperando sesion...")
      return
    }
    if (razonSocialId == null) {
      console.log("[NuevaVenta] usuario sin razon_social_id; mostrando formulario vacio")
      setLoading(false)
      return
    }
    loadData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, razonSocialId])

  async function loadData() {
    setLoading(true)
    try {
      console.log("[NuevaVenta] cargando datos...")
      // Punto de facturación primero: define la serie del correlativo a mostrar.
      const puntosRes = await getPuntosFacturacion({ soloActivos: true })
      const listaPuntos = puntosRes.data || []
      const puntoInicial = resolverPuntoVenta(user, listaPuntos)
      setPuntos(listaPuntos)
      setPuntoId(puntoInicial?.id != null ? String(puntoInicial.id) : "")

      const [clientesRes, productosRes, almacenesRes, localizacionesRes, correlativo, cuentasRes, marcasRes, categoriasRes, vendedoresRes, vendedorUsuario] = await Promise.all([
        getClientes({ soloActivos: true }),
        getProductos(),
        getAlmacenes(),
        getLocalizaciones(),
        getNextCorrelativo(puntoInicial),
        getCuentas(),
        getMarcas(),
        getCategorias(),
        usaVendedores ? getVendedores({ soloActivos: true }) : Promise.resolve({ data: [] as Vendedor[], error: null }),
        usaVendedores ? getVendedorDeUsuario(user?.auth_user_id) : Promise.resolve(null),
      ])
      setVendedores(vendedoresRes.data || [])
      setVendedorUsuarioId(vendedorUsuario?.id ?? null)
      if (vendedorUsuario?.id != null) setVendedorId(String(vendedorUsuario.id))

      console.log("[NuevaVenta] datos recibidos:", {
        clientes: clientesRes.data?.length,
        productos: productosRes.data?.length,
        almacenes: almacenesRes.data?.length,
        localizaciones: localizacionesRes.data?.length,
        correlativo,
        errores: {
          clientes: clientesRes.error,
          productos: productosRes.error,
          almacenes: almacenesRes.error,
          localizaciones: localizacionesRes.error,
        },
      })
      
      const listaClientes = clientesRes.data || []
      setClientes(listaClientes)
      // Cliente por defecto: "Consumidor Final" (si existe en el catalogo).
      const consumidorFinal = listaClientes.find(
        (c) => (c.nombre || "").trim().toLowerCase() === "consumidor final"
      )
      if (consumidorFinal?.id != null) setClienteId(String(consumidorFinal.id))
      setProductos(productosRes.data || [])
      setMarcas(marcasRes.data || [])
      setCategorias(categoriasRes.data || [])
      setAlmacenes(almacenesRes.data || [])
      setLocalizaciones(localizacionesRes.data || [])
      setNumeroFactura(correlativo)
      // Solo cuentas activas se ofrecen para nuevos pagos. Si la migracion 011
      // aun no se aplico, cuentasRes.data viene vacio y el desglose ofrecera
      // solo Efectivo / Credito (modo degradado).
      setCuentas((cuentasRes.data || []).filter((c) => c.activo ?? true))
      
      // Preseleccion: la localizacion del punto de facturación del usuario
      // (officemart-004) tiene prioridad; si no, la marcada como "Punto de
      // venta" (config 041); si no, el default de almacen unico.
      const locs = localizacionesRes.data || []
      const locPunto = puntoInicial?.localizacion_id != null
        ? locs.find((l) => l.id === puntoInicial.localizacion_id)
        : undefined
      const puntoVenta = locPunto ?? locs.find((l) => l.es_punto_venta)
      let locSeleccionada: number | null = null
      if (puntoVenta) {
        setAlmacenId(String(puntoVenta.almacen_id))
        setLocalizacionesFiltradas(locs.filter((l) => l.almacen_id === puntoVenta.almacen_id))
        setLocalizacionId(String(puntoVenta.id))
        locSeleccionada = puntoVenta.id ?? null
      } else if (almacenesRes.data && almacenesRes.data.length === 1) {
        const defaultAlmacenId = String(almacenesRes.data[0].id)
        setAlmacenId(defaultAlmacenId)
        const filtradas = locs.filter(l => l.almacen_id === almacenesRes.data[0].id)
        setLocalizacionesFiltradas(filtradas)
        if (filtradas.length === 1) {
          setLocalizacionId(String(filtradas[0].id))
          locSeleccionada = filtradas[0].id ?? null
        }
      }

      // Conversión de cotización a venta (módulo Cotizaciones): prellena
      // cliente, ISV, descuento y líneas con el precio COTIZADO (precio_fijo:
      // no se re-precia con la lista del cliente).
      const conv = leerConversionPendiente()
      if (conv) {
        cotizacionRef.current = { id: conv.cotizacion_id, numero: conv.numero }
        if (conv.cliente_id != null) setClienteId(String(conv.cliente_id))
        setAplicaIsv(!!conv.aplica_impuesto)
        setDescuentoPct(conv.descuento || 0)
        const prods = productosRes.data || []
        const ids = conv.lineas.map((l) => l.producto_id).filter((id): id is number => id != null)
        let stockMap: Record<number, number> = {}
        if (locSeleccionada != null && ids.length > 0) {
          const r = await getStockMultipleProducts(ids, locSeleccionada)
          stockMap = r.data || {}
        }
        const nuevas: LineaVenta[] = []
        let omitidas = 0
        for (const [idx, l] of conv.lineas.entries()) {
          const precio = +(l.precio_unitario * (1 - (l.descuento_linea || 0) / 100)).toFixed(2)
          const cant = Math.max(0, l.cantidad)
          if (cant <= 0) continue
          const prod = l.producto_id != null ? prods.find((p) => p.id === l.producto_id) : undefined
          if (l.producto_id != null && !prod) { omitidas += 1; continue }
          if (prod) {
            nuevas.push({
              _key: `p-${prod.id}`,
              producto_id: prod.id!,
              producto_nombre: prod.nombre,
              producto_codigo: prod.codigo_barras,
              cantidad: cant,
              precio_unitario: precio,
              costo_promedio: prod.costo_promedio || 0,
              subtotal: +(precio * cant).toFixed(2),
              utilidad_linea: calculateUtilidadLinea(cant, precio, prod.costo_promedio || 0),
              stock_disponible: stockMap[prod.id!] || 0,
              precio_fijo: true,
            })
          } else {
            nuevas.push({
              // Clave propia (no toca el contador global de Venta Rápida).
              _key: `vr-cot-${conv.cotizacion_id}-${idx}`,
              producto_id: null,
              producto_nombre: l.descripcion,
              producto_codigo: "",
              descripcion_libre: l.descripcion,
              cantidad: cant,
              precio_unitario: precio,
              costo_promedio: 0,
              subtotal: +(precio * cant).toFixed(2),
              utilidad_linea: +(precio * cant).toFixed(2),
              stock_disponible: Infinity,
              precio_fijo: true,
            })
          }
        }
        setLineas(nuevas)
        setStockPorLocalizacion((prev) => ({ ...prev, ...stockMap }))
        toast({
          title: `Cotización ${conv.numero} cargada`,
          description: omitidas > 0
            ? `${omitidas} línea(s) con producto inexistente se omitieron. Revisa y cobra para facturar.`
            : "Revisa las líneas y cobra para facturarla.",
        })
      }
    } catch (err: any) {
      console.log("[NuevaVenta] excepcion cargando datos:", err)
      toast({
        title: "No se pudieron cargar los datos",
        description: err?.message || "Error de conexion",
        variant: "destructive"
      })
    } finally {
      setLoading(false)
    }
  }

  /**
   * Cambio de punto de facturación (solo admin / usuario sin punto): refresca
   * la vista previa del correlativo (serie del punto) y abre su almacén.
   */
  async function handlePuntoChange(nuevoPuntoId: string) {
    setPuntoId(nuevoPuntoId)
    const punto = puntos.find((p) => String(p.id) === nuevoPuntoId) ?? null
    const correlativo = await getNextCorrelativo(punto)
    setNumeroFactura(correlativo)
    if (punto?.localizacion_id != null) {
      const loc = localizaciones.find((l) => l.id === punto.localizacion_id)
      if (loc) {
        setAlmacenId(String(loc.almacen_id))
        setLocalizacionesFiltradas(localizaciones.filter((l) => l.almacen_id === loc.almacen_id))
        setLocalizacionId(String(loc.id))
        fetchStockForLineas(Number(loc.id))
      }
    }
  }

  function handleAlmacenChange(newAlmacenId: string) {
    setAlmacenId(newAlmacenId)
    setLocalizacionId("")
    setStockPorLocalizacion({})
    setStockCatalogo({})
    // Reset stock disponible in lineas
    setLineas(prev => prev.map(l => ({ ...l, stock_disponible: 0 })))
    const filtradas = localizaciones.filter(l => l.almacen_id === Number(newAlmacenId))
    setLocalizacionesFiltradas(filtradas)
    // Auto-select if only one localization
    if (filtradas.length === 1) {
      const locId = String(filtradas[0].id)
      setLocalizacionId(locId)
      // Stock de las lineas para esta localizacion (el del catalogo lo
      // maneja el useEffect de abajo, que tambien cubre la autoseleccion
      // inicial cuando hay un solo almacen/localizacion).
      fetchStockForLineas(Number(locId))
    }
  }

  async function handleLocalizacionChange(newLocalizacionId: string) {
    setLocalizacionId(newLocalizacionId)
    if (newLocalizacionId) {
      fetchStockForLineas(Number(newLocalizacionId))
    } else {
      setStockPorLocalizacion({})
      setStockCatalogo({})
      setLineas(prev => prev.map(l => ({ ...l, stock_disponible: 0 })))
    }
  }

  // Carga el stock del catalogo cuando hay localizacion Y productos cargados.
  // Clave: cubre la AUTOSELECCION inicial (un solo almacen/localizacion),
  // donde antes el catalogo quedaba vacio porque no se disparaba la carga.
  React.useEffect(() => {
    if (localizacionId && productos.length > 0) {
      fetchStockCatalogo(Number(localizacionId))
    } else {
      setStockCatalogo({})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localizacionId, productos])

  /**
   * Carga el stock de TODOS los productos del catalogo en una localizacion.
   * El catalogo usara este mapa para mostrar unicamente las referencias con
   * existencias (> 0) y su cantidad real en esa localizacion.
   */
  async function fetchStockCatalogo(locId: number) {
    // Incluye tanto el catalogo precargado como los resultados de la ultima
    // busqueda contra la BD (para que conserven su stock al cambiar de
    // localizacion).
    const ids = new Set<number>()
    for (const p of productos) if (p.id) ids.add(p.id)
    for (const p of resultadosBusqueda ?? []) if (p.id) ids.add(p.id)
    if (ids.size === 0) return
    setLoadingCatalogo(true)
    try {
      const { data: stockMap } = await getStockMultipleProducts([...ids], locId)
      setStockCatalogo(stockMap || {})
    } catch (err) {
      console.error('Error cargando stock del catalogo:', err)
      setStockCatalogo({})
    } finally {
      setLoadingCatalogo(false)
    }
  }

  // Busca productos "desde cero" contra la BD y renderiza esos resultados en el
  // catalogo. Con query vacia vuelve al modo navegacion (catalogo precargado).
  async function buscarProductosServidor(query: string) {
    const q = query.trim()
    if (!q) {
      setResultadosBusqueda(null)
      return
    }
    setBuscandoProductos(true)
    try {
      const { data, error } = await buscarProductos(q)
      if (error) {
        toast({ title: "Error", description: error, variant: "destructive" })
        return
      }
      setResultadosBusqueda(data)
      // Carga el stock de los resultados en la localizacion activa para que se
      // vea su disponibilidad (y no queden ocultos por el filtro de stock).
      if (localizacionId && data.length > 0) {
        const ids = data.map((p) => p.id!).filter(Boolean)
        const { data: stockMap } = await getStockMultipleProducts(ids, Number(localizacionId))
        if (stockMap) setStockCatalogo((prev) => ({ ...prev, ...stockMap }))
      }
    } finally {
      setBuscandoProductos(false)
    }
  }

  // ===== Lector de codigo de barras (flag ventas_lector_codigo_barras) =====
  // Un escaner actua como teclado: teclea el codigo muy rapido y manda Enter.
  // Detectamos esa rafaga a nivel global, ubicamos el producto por su codigo
  // exacto y lo agregamos a la venta. Sin match exacto, dejamos el codigo en el
  // buscador con las coincidencias para ubicarlo a mano.
  async function procesarEscaneo(codigoRaw: string) {
    const codigo = codigoRaw.trim()
    if (!codigo) return
    const norm = codigo.toLowerCase()
    const matchExacto = (p: Producto) =>
      (p.codigo_barras || "").trim().toLowerCase() === norm

    // 1) En lo ya cargado (catalogo precargado + resultados de la ultima busqueda).
    let prod: Producto | undefined =
      productos.find(matchExacto) || (resultadosBusqueda ?? []).find(matchExacto)

    // 2) Si no esta cargado, consulta la BD por ese codigo.
    let dataBusqueda: Producto[] | null = null
    if (!prod) {
      const { data, error } = await buscarProductos(codigo)
      if (error) {
        toast({ title: "Error", description: error, variant: "destructive" })
        return
      }
      dataBusqueda = data
      prod = data.find(matchExacto)
    }

    if (prod) {
      if (!almacenId) {
        toast({ title: "Selecciona un almacen", description: "Elige el almacen antes de escanear productos.", variant: "destructive" })
        return
      }
      addProducto(prod)
      setBusquedaTexto("") // no dejamos el codigo escrito en el buscador
      toast({ title: "Agregado por escaneo", description: prod.nombre })
      return
    }

    // 3) Sin codigo exacto: lo dejamos en el buscador con las coincidencias.
    setBusquedaTexto(codigo)
    if (dataBusqueda && dataBusqueda.length > 0) {
      setResultadosBusqueda(dataBusqueda)
      toast({ title: "Revisa el buscador", description: `No hubo codigo exacto para "${codigo}"; se muestran coincidencias.` })
    } else {
      toast({ title: "Sin coincidencias", description: `No se encontro un producto con el codigo ${codigo}.`, variant: "destructive" })
    }
  }

  // Ref a la ultima version del handler para no re-montar el listener global.
  const procesarEscaneoRef = React.useRef(procesarEscaneo)
  React.useEffect(() => {
    procesarEscaneoRef.current = procesarEscaneo
  })

  React.useEffect(() => {
    if (!lectorCodigoBarras) return
    let buffer = ""
    let lastTime = 0
    const GAP_MS = 50 // teclas de escaner: < ~50 ms entre si; el humano, mas lento
    function onKeyDown(e: KeyboardEvent) {
      const now = Date.now()
      if (now - lastTime > GAP_MS) buffer = "" // gap grande -> reinicia (tecleo humano)
      lastTime = now
      if (e.key === "Enter") {
        const code = buffer
        buffer = ""
        // Rafaga rapida de >=4 caracteres + Enter => escaneo: lo tomamos nosotros
        // (evitamos que dispare el submit/Buscar del input enfocado).
        if (code.length >= 4) {
          e.preventDefault()
          e.stopPropagation()
          procesarEscaneoRef.current(code)
        }
        return
      }
      if (e.key.length === 1) buffer += e.key
    }
    window.addEventListener("keydown", onKeyDown, true)
    return () => window.removeEventListener("keydown", onKeyDown, true)
  }, [lectorCodigoBarras])

  async function fetchStockForLineas(locId: number) {
    if (lineas.length === 0) return

    setLoadingStock(true)
    // Solo productos reales; las lineas de Venta Rapida (producto_id NULL) no
    // tienen stock (se mantienen en Infinity, sin bloqueo).
    const productoIds = lineas.map(l => l.producto_id).filter((id): id is number => id != null)
    const { data: stockMap } = await getStockMultipleProducts(productoIds, locId)
    setStockPorLocalizacion(stockMap)

    // Update lineas with stock disponible
    setLineas(prev => prev.map(l => ({
      ...l,
      stock_disponible: l.producto_id == null ? Infinity : (stockMap[l.producto_id] || 0)
    })))
    setLoadingStock(false)
  }

  function calculateUtilidadLinea(cantidad: number, precio: number, costo: number): number {
    return (precio - costo) * cantidad
  }

  // Carga la lista de precios del cliente al seleccionarlo (si la empresa tiene
  // el modulo). Con lista, el catalogo muestra el precio base tachado + el final.
  React.useEffect(() => {
    if (!puedeListas || !clienteId) { setListaAplicada(null); return }
    const cid = Number(clienteId)
    if (!cid) { setListaAplicada(null); return }
    getListaAplicadaCliente(cid).then((r) => setListaAplicada(r.data))
  }, [clienteId, puedeListas])

  // Precio de venta efectivo de un producto: precio de la lista del cliente si
  // aplica (individual > subcategoría > categoría > línea > % general), o el
  // precio del maestro.
  const precioDeVenta = React.useCallback(
    (p: Producto) => calcularPrecioLista(p.precio_venta_sugerido || 0, listaAplicada, p),
    [listaAplicada]
  )

  // Al cambiar de cliente (y por tanto de lista) se RE-PRECIAN las líneas ya
  // agregadas con el precio que le corresponde al nuevo cliente. Las líneas de
  // Venta Rápida (sin producto) conservan su precio manual.
  const listaAplicadaId = listaAplicada?.lista.id ?? null
  React.useEffect(() => {
    setLineas((prev) => {
      if (prev.length === 0) return prev
      let cambio = false
      const next = prev.map((l) => {
        if (l.producto_id == null || l.precio_fijo) return l
        const prod = productos.find((p) => p.id === l.producto_id)
        if (!prod) return l
        const precio = calcularPrecioLista(prod.precio_venta_sugerido || 0, listaAplicada, prod)
        if (precio === l.precio_unitario) return l
        cambio = true
        return {
          ...l,
          precio_unitario: precio,
          subtotal: +(precio * l.cantidad).toFixed(2),
          utilidad_linea: calculateUtilidadLinea(l.cantidad, precio, l.costo_promedio),
        }
      })
      return cambio ? next : prev
    })
    // Solo cuando cambia la lista aplicada (no en cada edición de líneas).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listaAplicadaId])

  async function addProducto(producto: Producto) {
    const existing = lineas.findIndex(l => l.producto_id === producto.id)
    if (existing >= 0) {
      updateCantidad(existing, 1)
    } else {
      // Get stock for this product in selected localization
      let stockDisponible = stockPorLocalizacion[producto.id!] || 0
      
      if (localizacionId && !stockPorLocalizacion[producto.id!]) {
        const { data: stockMap } = await getStockMultipleProducts([producto.id!], Number(localizacionId))
        stockDisponible = stockMap[producto.id!] || 0
        setStockPorLocalizacion(prev => ({ ...prev, [producto.id!]: stockDisponible }))
      }
      
      const precio = precioDeVenta(producto)
      setLineas(prev => [...prev, {
        _key: `p-${producto.id}`,
        producto_id: producto.id!,
        producto_nombre: producto.nombre,
        producto_codigo: producto.codigo_barras,
        cantidad: 1,
        precio_unitario: precio,
        costo_promedio: producto.costo_promedio || 0,
        subtotal: precio,
        utilidad_linea: calculateUtilidadLinea(1, precio, producto.costo_promedio || 0),
        stock_disponible: stockDisponible
      }])
    }
  }

  // Agrega una linea de "Venta Rapida": descripcion y precio a mano, sin
  // producto ni inventario. producto_id NULL, costo 0 (utilidad = precio),
  // stock_disponible Infinity para no disparar el bloqueo por stock.
  function addVentaRapida(descripcion: string, precio: number, cantidad: number) {
    const desc = descripcion.trim()
    const p = Math.max(0, precio)
    const c = Math.max(1, cantidad)
    ventaRapidaSeq += 1
    setLineas(prev => [...prev, {
      _key: `vr-${ventaRapidaSeq}`,
      producto_id: null,
      producto_nombre: desc,
      producto_codigo: "",
      descripcion_libre: desc,
      cantidad: c,
      precio_unitario: p,
      costo_promedio: 0,
      subtotal: +(p * c).toFixed(2),
      utilidad_linea: +(p * c).toFixed(2),
      stock_disponible: Infinity,
    }])
  }

  function confirmarVentaRapida() {
    const desc = vrDescripcion.trim()
    const precio = Number(vrPrecio)
    const cantidad = Number(vrCantidad) || 1
    if (!desc) {
      toast({ title: "Falta la descripción", description: "Escribe qué se está vendiendo", variant: "destructive" })
      return
    }
    if (!Number.isFinite(precio) || precio <= 0) {
      toast({ title: "Precio inválido", description: "El precio debe ser mayor a 0", variant: "destructive" })
      return
    }
    addVentaRapida(desc, precio, cantidad)
    setVrDescripcion(""); setVrPrecio(""); setVrCantidad("1")
    setVentaRapidaOpen(false)
  }

  // Agrega en lote todas las referencias filtradas (boton "Seleccionar todo").
  // Omite las que ya estan en la venta y carga su stock en la localizacion.
  async function agregarProductos(lista: Producto[]) {
    const existentes = new Set(lineas.map((l) => l.producto_id))
    const nuevos = lista.filter((p) => p.id != null && !existentes.has(p.id))
    if (nuevos.length === 0) {
      toast({ title: "Ya estan en la venta", description: "Esas referencias ya fueron agregadas" })
      return
    }
    let stockMap: Record<number, number> = {}
    if (localizacionId) {
      const ids = nuevos.map((p) => p.id!).filter(Boolean)
      const r = await getStockMultipleProducts(ids, Number(localizacionId))
      stockMap = r.data || {}
      setStockPorLocalizacion((prev) => ({ ...prev, ...stockMap }))
    }
    setLineas((prev) => [
      ...prev,
      ...nuevos.map((p) => {
        const precio = precioDeVenta(p)
        return {
          _key: `p-${p.id}`,
          producto_id: p.id!,
          producto_nombre: p.nombre,
          producto_codigo: p.codigo_barras,
          cantidad: 1,
          precio_unitario: precio,
          costo_promedio: p.costo_promedio || 0,
          subtotal: precio,
          utilidad_linea: calculateUtilidadLinea(1, precio, p.costo_promedio || 0),
          stock_disponible: stockMap[p.id!] || 0,
        }
      }),
    ])
    toast({ title: "Agregados", description: `${nuevos.length} producto(s) agregado(s) a la venta` })
  }

  function updateCantidad(index: number, delta: number) {
    setLineas(lineas.map((l, i) => {
      if (i === index) {
        const newCantidad = Math.max(1, l.cantidad + delta)
        const newSubtotal = newCantidad * l.precio_unitario
        const newUtilidad = calculateUtilidadLinea(newCantidad, l.precio_unitario, l.costo_promedio)
        return { ...l, cantidad: newCantidad, subtotal: newSubtotal, utilidad_linea: newUtilidad }
      }
      return l
    }))
  }

  // Fija la cantidad exacta de una linea (permite decimales, p. ej. 2.5 lbs).
  function setCantidadLinea(index: number, value: number) {
    setLineas(lineas.map((l, i) => {
      if (i === index) {
        const cantidad = value >= 0 ? value : 0
        const newSubtotal = cantidad * l.precio_unitario
        const newUtilidad = calculateUtilidadLinea(cantidad, l.precio_unitario, l.costo_promedio)
        return { ...l, cantidad, subtotal: newSubtotal, utilidad_linea: newUtilidad }
      }
      return l
    }))
  }

  function updatePrecio(index: number, precio: number) {
    setLineas(lineas.map((l, i) => {
      if (i === index) {
        const newSubtotal = l.cantidad * precio
        const newUtilidad = calculateUtilidadLinea(l.cantidad, precio, l.costo_promedio)
        return { ...l, precio_unitario: precio, subtotal: newSubtotal, utilidad_linea: newUtilidad }
      }
      return l
    }))
  }

  function removeLinea(index: number) {
    setLineas(lineas.filter((_, i) => i !== index))
  }

  // ---------- Handlers del Desglose de Pago -------------------------------
  // Generamos un id local con crypto.randomUUID() (fallback a Math.random
  // por si el navegador es muy viejo). Sirve solo para keys de React; no
  // se persiste.
  function nextPagoId() {
    return typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `p_${Math.random().toString(36).slice(2, 10)}`
  }

  function agregarPagoLinea() {
    // Default EFECTIVO siempre que la caja este disponible (abierta o migracion
    // pendiente). Si no hay caja, cae a Banco (si hay cuentas) y por ultimo Otro.
    let metodo: PagoVentaDetalleInput["metodo_pago"] = "Otro"
    let cuentaIdDefault: number | null = null
    let comisionDefault = 0
    const efectivoDisponible = cajaFeaturePending || !!cajaSesion
    if (efectivoDisponible) {
      metodo = "Efectivo"
    } else if (cuentas.length > 0) {
      metodo = "Banco"
      cuentaIdDefault = cuentas[0].id ?? null
      comisionDefault = cuentas[0].porcentaje_comision ?? 0
    }
    // Pre-completar con el saldo restante para acelerar el flujo comun
    // de "un solo metodo cubre todo el total".
    const sumaActual = pagosDetalle.reduce(
      (acc, p) => acc + (Number(p.monto_bruto) || 0),
      0
    )
    const sugerido = Math.max(0, +(total - sumaActual).toFixed(2))
    setPagosDetalle((prev) => [
      ...prev,
      {
        _id: nextPagoId(),
        metodo_pago: metodo,
        cuenta_id: cuentaIdDefault,
        porcentaje_comision: comisionDefault,
        monto_bruto: sugerido,
      },
    ])
  }

  function actualizarPagoLinea(
    id: string,
    patch: Partial<Omit<PagoVentaDetalleInput, never>>
  ) {
    setPagosDetalle((prev) =>
      prev.map((p) => (p._id === id ? { ...p, ...patch } : p))
    )
  }

  function eliminarPagoLinea(id: string) {
    setPagosDetalle((prev) => prev.filter((p) => p._id !== id))
    setEfectivoRecibido((prev) => {
      const { [id]: _omit, ...rest } = prev
      return rest
    })
  }

  async function handleCreateCliente() {
    if (!nuevoCliente.nombre?.trim()) {
      toast({ title: "Error", description: "El nombre del cliente es requerido", variant: "destructive" })
      return
    }
    
    setSavingCliente(true)
    try {
      const { data, error } = await saveCliente(nuevoCliente as Cliente, true)
      
      if (error) {
        toast({ title: "Error", description: error, variant: "destructive" })
        return
      }
      
      if (data) {
        // Add to local list and select it
        setClientes(prev => [...prev, data])
        setClienteId(String(data.id))
        
        toast({ title: "Cliente creado", description: `${data.nombre} agregado correctamente` })
        
        // Reset form and close dialog
        setNuevoCliente({
          nombre: "",
          rtn: "",
          direccion: "",
          telefono: "",
          fecha_nacimiento: "",
        })
        setShowClienteDialog(false)
      }
    } catch (err) {
      toast({ title: "Error", description: "Error al crear el cliente", variant: "destructive" })
    } finally {
      setSavingCliente(false)
    }
  }

  const subtotal = lineas.reduce((acc, l) => acc + l.subtotal, 0)
  // Normalizamos el descuento a un rango seguro [0, 100]. El monto se calcula
  // sobre el subtotal bruto; el ISV se aplica despues del descuento.
  const descuentoPctSafe = Math.min(100, Math.max(0, Number.isFinite(descuentoPct) ? descuentoPct : 0))
  const montoDescuento = subtotal * (descuentoPctSafe / 100)
  const subtotalNeto = subtotal - montoDescuento
  // Si la empresa oculta el ISV (flag ventas_mostrar_isv=false), no se cobra.
  const isvActivo = mostrarIsv && aplicaIsv
  const isv = isvActivo ? subtotalNeto * 0.15 : 0
  // `total` = total BRUTO (lo que paga el cliente: subtotal - desc + ISV).
  // Es el valor que el desglose `pagosDetalle` debe igualar (cada linea
  // contiene `monto_bruto` = lo que el cliente entrega).
  const total = subtotalNeto + isv
  const totalItems = lineas.reduce((acc, l) => acc + l.cantidad, 0)

  // --- Comisiones bancarias y total NETO -----------------------------------
  // Cuando una linea de pago tiene `porcentaje_comision` > 0 (tarjetas,
  // link de pago, etc.), el banco retiene esa comision: el cliente paga el
  // bruto pero al comercio le llega el neto. Sumamos todas las comisiones
  // del desglose para mostrarlas como linea separada en los totales y para
  // calcular `totalNeto`, que es:
  //   - el valor que ve el usuario como "Total" (lo que efectivamente
  //     recibira el comercio)
  //   - lo que se persiste en `ventas_encabezado.total_venta`
  // Para registros sin comision (efectivo, otros), `totalComisiones = 0`
  // y `totalNeto === total`, asi el comportamiento legacy se conserva.
  const totalComisiones = pagosDetalle.reduce((acc, p) => {
    const monto = Number(p.monto_bruto || 0)
    const comisionPct = Number(p.porcentaje_comision ?? 0)
    if (monto <= 0 || comisionPct <= 0) return acc
    return acc + monto * (comisionPct / 100)
  }, 0)
  const totalComisionesR = +totalComisiones.toFixed(2)
  const totalNeto = +(total - totalComisionesR).toFixed(2)
  // Suma de lo que efectivamente netea el comercio (monto_bruto * (1 - c%)).
  // Se usa para derivar `valorpago`/`estado_pago` contra `totalNeto`.
  const sumaPagosNeto = pagosDetalle.reduce((acc, p) => {
    const monto = Number(p.monto_bruto || 0)
    const comisionPct = Number(p.porcentaje_comision ?? 0)
    return acc + monto * (1 - comisionPct / 100)
  }, 0)
  const sumaPagosNetoR = +sumaPagosNeto.toFixed(2)

  // --- Auto-sincronizacion del desglose de pago con el total ---------------
  // Cuando el usuario activa/desactiva ISV o cambia el porcentaje de
  // descuento, el `total` se recalcula automaticamente. Sin embargo,
  // los `monto_bruto` de cada linea de `pagosDetalle` son estaticos:
  // se setean al agregar la linea y no se reajustan solos. Para evitar
  // que el desglose quede desfasado (sobrepago o pago insuficiente),
  // detectamos cualquier cambio en `total` y aplicamos el delta a la
  // ULTIMA linea de pago, que es la que el flujo "agregar pago" pre-
  // completa con el residuo. Asi el sumatorio del desglose siempre
  // coincide con el total mostrado.
  //
  // Si el usuario edito manualmente los pagos, el cambio se aplica solo
  // sobre la ultima linea (clamp a 0) para no destruir su intencion en
  // las anteriores.
  const prevTotalRef = React.useRef(total)
  React.useEffect(() => {
    const prev = prevTotalRef.current
    if (prev === total) return
    const delta = +(total - prev).toFixed(2)
    prevTotalRef.current = total
    if (delta === 0) return
    setPagosDetalle((arr) => {
      if (arr.length === 0) return arr
      const last = arr[arr.length - 1]
      const montoActual = Number(last.monto_bruto) || 0
      const nuevoMonto = Math.max(0, +(montoActual + delta).toFixed(2))
      if (nuevoMonto === montoActual) return arr
      return [
        ...arr.slice(0, -1),
        { ...last, monto_bruto: nuevoMonto },
      ]
    })
  }, [total])

  // Pedido puntual (razon social 14): el desglose de pago arranca con una
  // linea de Efectivo ya creada (sin tener que presionar "Agregar pago"). Su
  // monto se completa con el total via el efecto de arriba a medida que se
  // agregan productos. Se siembra una sola vez por venta (el ref se reinicia
  // en resetForm); si el usuario la borra, no se vuelve a crear.
  const efectivoSeededRef = React.useRef(false)
  React.useEffect(() => {
    if (user?.razon_social_id !== 14) return
    if (loading) return
    if (efectivoSeededRef.current) return
    if (pagosDetalle.length > 0) {
      efectivoSeededRef.current = true
      return
    }
    efectivoSeededRef.current = true
    setPagosDetalle([
      {
        _id: nextPagoId(),
        metodo_pago: "Efectivo",
        cuenta_id: null,
        porcentaje_comision: 0,
        monto_bruto: Math.max(0, +total.toFixed(2)),
      },
    ])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.razon_social_id, loading, pagosDetalle.length])

  const selectedCliente = clientes.find(c => c.id?.toString() === clienteId)

  // Vendedor por defecto al cambiar de cliente: el del usuario logueado; si no,
  // el vendedor asignado al cliente. No pisa una eleccion manual previa.
  React.useEffect(() => {
    if (!usaVendedores) return
    const cliente = clientes.find(c => c.id?.toString() === clienteId)
    const porDefecto = resolverVendedorPorDefecto({
      vendedorUsuarioId,
      vendedorClienteId: cliente?.vendedor_id ?? null,
    })
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setVendedorId(porDefecto != null ? String(porDefecto) : "")
    // Solo reacciona al cliente (y a que cargue el vendedor del usuario).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clienteId, vendedorUsuarioId, usaVendedores])

  // Stock validation
  const lineasConStockInsuficiente = lineas.filter(l => l.cantidad > l.stock_disponible)
  const hayStockInsuficiente = lineasConStockInsuficiente.length > 0 && localizacionId !== ""
  const lineasQueAgotan = lineas.filter(l => l.stock_disponible > 0 && l.cantidad === l.stock_disponible)

  async function handleSubmit() {
    if (!clienteId) {
      toast({ title: "Error", description: "Seleccione un cliente", variant: "destructive" })
      return
    }
    if (!almacenId) {
      toast({ title: "Error", description: "Seleccione un almacen", variant: "destructive" })
      return
    }
    if (!localizacionId) {
      toast({ title: "Error", description: "Seleccione una localizacion", variant: "destructive" })
      return
    }
    if (lineas.length === 0) {
      toast({ title: "Error", description: "Agregue al menos un producto", variant: "destructive" })
      return
    }

    // ----- Validacion del Desglose de Pago -------------------------------
    // Reglas:
    //  - Cada linea debe tener monto_bruto > 0.
    //  - Lineas Banco / Link_Pago requieren cuenta_id.
    //  - La suma de monto_bruto NO puede exceder el total de la venta
    //    (sobrepago no permitido). Puede ser menor: el saldo restante
    //    queda como cuenta por cobrar.
    //  - Si hay efectivo en el desglose y la sesion de Caja Chica no
    //    esta abierta, bloqueamos. Si la migracion 011 aun no se aplico
    //    (cajaFeaturePending=true), permitimos seguir en modo degradado.
    const sumaPagos = pagosDetalle.reduce((acc, p) => acc + (Number(p.monto_bruto) || 0), 0)
    const sumaPagosRound = +sumaPagos.toFixed(2)

    for (const p of pagosDetalle) {
      if (!(Number(p.monto_bruto) > 0)) {
        toast({
          title: "Pago invalido",
          description: "Cada linea de pago debe tener un monto mayor a 0",
          variant: "destructive",
        })
        return
      }
      if ((p.metodo_pago === "Banco" || p.metodo_pago === "Link_Pago") && !p.cuenta_id) {
        toast({
          title: "Cuenta requerida",
          description: `Seleccione la cuenta para el pago de tipo ${p.metodo_pago === "Link_Pago" ? "Link de Pago" : "Banco"}`,
          variant: "destructive",
        })
        return
      }
    }

    if (sumaPagosRound > +total.toFixed(2)) {
      toast({
        title: "Sobrepago no permitido",
        description: `La suma de pagos (L ${sumaPagosRound.toFixed(2)}) excede el total de la venta (L ${total.toFixed(2)})`,
        variant: "destructive",
      })
      return
    }

    const tieneEfectivo = pagosDetalle.some(
      (p) => p.metodo_pago === "Efectivo" && Number(p.monto_bruto) > 0
    )
    if (tieneEfectivo && !cajaFeaturePending && !cajaSesion) {
      toast({
        title: "Caja Chica cerrada",
        description: "No hay sesion de Caja Chica abierta. Imposible registrar pagos en efectivo.",
        variant: "destructive",
      })
      return
    }

    // Derivamos `valorpago` y `estado_pago` desde el BRUTO (lo que paga el
    // cliente). `total_venta` tambien se persiste en BRUTO. La comision
    // bancaria es un costo del comercio: NO reduce la venta ni la deuda del
    // cliente. Asi saldo = total_venta - valorpago (ambos brutos).
    const sumaPagosBrutoR = +pagosDetalle
      .reduce((acc, p) => acc + Number(p.monto_bruto || 0), 0)
      .toFixed(2)
    const valorpago = sumaPagosBrutoR
    const estadoPago: "Pendiente" | "Parcial" | "Pagado" =
      valorpago <= 0
        ? "Pendiente"
        : valorpago >= total - 0.005
          ? "Pagado"
          : "Parcial"

    const saldoNuevo = +Math.max(0, total - valorpago).toFixed(2)

    // Consumidor Final NO puede quedar a crédito: es un genérico de mostrador,
    // no un cliente identificable a quien cobrar después. Si deja saldo, se
    // bloquea (debe pagarse completa).
    const esConsumidorFinalCliente =
      (selectedCliente?.nombre || "").trim().toLowerCase() === "consumidor final"
    if (saldoNuevo > 0 && esConsumidorFinalCliente) {
      toast({
        title: "Consumidor Final no admite crédito",
        description: "Una venta a 'Consumidor Final' debe pagarse completa. Registra el pago total, o elige un cliente identificado para venderle a crédito.",
        variant: "destructive",
      })
      return
    }

    // Límite de crédito: si la venta deja saldo (crédito) y el cliente tiene un
    // límite > 0, se bloquea cuando el saldo ACUMULADO (lo que ya debe + este
    // nuevo saldo) supera el límite. Límite 0/vacío = sin restricción.
    const limiteCliente = Number(selectedCliente?.limite_credito || 0)
    if (saldoNuevo > 0 && limiteCliente > 0) {
      const saldoActual = await getSaldoPendienteCliente(parseInt(clienteId))
      if (excedeLimiteCredito(saldoActual, saldoNuevo, limiteCliente)) {
        const money = (n: number) => `L ${n.toLocaleString("es-HN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        toast({
          title: "Excede el límite de crédito",
          description: `${selectedCliente?.nombre ?? "El cliente"} debe ${money(saldoActual)} y esta venta a crédito lo llevaría a ${money(saldoActual + saldoNuevo)}, sobre su límite de ${money(limiteCliente)}. Cobra parte de contado o aumenta su límite.`,
          variant: "destructive",
        })
        return
      }
    }

    // Bloqueo de crédito por estado del cliente (script officemart-002): bloqueo
    // manual del admin o mora (facturas con saldo más allá de sus días de crédito).
    if (saldoNuevo > 0 && selectedCliente?.id != null) {
      const mora = await getFacturasVencidasCliente(selectedCliente.id, selectedCliente.dias_credito)
      const motivoBloqueo = bloqueoCreditoCliente({
        bloqueado: selectedCliente.bloqueado,
        motivoBloqueo: selectedCliente.motivo_bloqueo,
        diasCredito: selectedCliente.dias_credito,
        facturasVencidas: mora.vencidas,
        diasMaxVencido: mora.diasMaxVencido,
      })
      if (motivoBloqueo) {
        toast({
          title: "No se puede vender a crédito a este cliente",
          description: `${motivoBloqueo} Cobra la venta completa o pide al administrador que revise el cliente.`,
          variant: "destructive",
        })
        return
      }
    }

    // Vendedor obligatorio (flag por empresa).
    if (vendedorObligatorio && !vendedorId) {
      toast({ title: "Falta el vendedor", description: "Elige el vendedor de esta venta antes de guardar.", variant: "destructive" })
      return
    }

    setSaving(true)
    try {
      const encabezado = {
        numero_factura: numeroFactura,
        cliente_id: parseInt(clienteId),
        // Usamos la fecha seleccionada en la parte superior + la hora local
        // actual, en "naive-local" (sin convertir a UTC) para que el dia
        // guardado sea EXACTAMENTE el elegido y no se corra de noche.
        fecha_venta: timestampNaiveLocal(fecha),
        aplica_impuesto: isvActivo,
        porcentaje_impuesto: 15,
        descuento: descuentoPctSafe,
        subtotal,
        impuesto_total: isv,
        // Persistimos el BRUTO (subtotal - descuento + ISV): la venta real
        // que factura/paga el cliente. La comision bancaria NO reduce la
        // venta; es un costo aparte. Asi el "total de venta" cuadra con la
        // suma de las lineas de producto en el Historial.
        total_venta: total,
        estado_pago: estadoPago,
        valorpago,
        // Vendedor (modulo Vendedores y Zonas); null si la empresa no lo usa.
        ...(usaVendedores ? { vendedor_id: vendedorId ? Number(vendedorId) : null } : {}),
      }

      const detalles = lineas.map(l => ({
        producto_id: l.producto_id,
        descripcion_libre: l.producto_id == null ? (l.descripcion_libre ?? l.producto_nombre) : null,
        cantidad: l.cantidad,
        precio_unitario: l.precio_unitario,
        costo_promedio_momento: l.costo_promedio,
        utilidad_linea: l.utilidad_linea
      }))

      const { data, error } = await crearVenta({
        encabezado,
        detalles,
        almacen_id: parseInt(almacenId),
        localizacion_id: parseInt(localizacionId),
        // Convertimos las lineas locales (con _id) al payload del servicio.
        pagos_detalle: pagosDetalle.map(({ _id: _omit, ...rest }) => rest),
        // Emite numero fiscal CAI si la empresa tiene Facturación CAI activa.
        emitirNumeroFiscal: user?.flags?.facturacion_cai ?? false,
        // Punto de facturación (serie interna + CAI del punto), si hay.
        punto_facturacion: puntoSeleccionado,
      })

      if (error) {
        toast({ title: "Error", description: error, variant: "destructive" })
        return
      }

      // El numero DEFINITIVO lo asigna el servidor (correlativo atomico); el de
      // la pantalla era solo una vista previa y puede haber cambiado.
      const numeroDefinitivo = data?.numero_factura || numeroFactura
      toast({ title: "Venta creada", description: `Factura ${numeroDefinitivo} generada correctamente` })

      // Si la venta nació de una cotización, se marca Facturada (best-effort).
      if (cotizacionRef.current && data?.id) {
        const { error: cotErr } = await marcarCotizacionFacturada(cotizacionRef.current.id, data.id)
        if (cotErr) console.warn("[NuevaVenta] no se marcó la cotización como facturada:", cotErr)
        cotizacionRef.current = null
      }

      const ventaData = {
        encabezado: {
          ...encabezado,
          id: data?.id,
          numero_factura: numeroDefinitivo,
          cliente_nombre: selectedCliente?.nombre || "",
          fecha_venta: encabezado.fecha_venta,
          // Copiar el numero fiscal CAI emitido por el servidor: la carta A4
          // (generatePdfFromData) lo lee de aqui para armar el bloque fiscal.
          numero_fiscal: data?.numero_fiscal ?? null,
          cai_emitido: data?.cai_emitido ?? null,
          tipo_documento_fiscal: data?.tipo_documento_fiscal ?? null,
          punto_facturacion_id: data?.punto_facturacion_id ?? puntoSeleccionado?.id ?? null,
          fiscal_snapshot: data?.fiscal_snapshot ?? null,
        },
        detalles: lineas.map((l, i) => ({ 
          id: i + 1, 
          venta_id: data?.id || 0,
          producto_id: l.producto_id,
          producto_nombre: l.producto_nombre,
          producto_codigo: l.producto_codigo,
          cantidad: l.cantidad,
          precio_unitario: l.precio_unitario,
          costo_promedio_momento: l.costo_promedio,
          utilidad_linea: l.utilidad_linea
        }))
      }
      
      // Efectivo recibido / vuelto (solo lineas Efectivo con "recibido" puesto).
      const lineasConVuelto = pagosDetalle.filter(
        (p) => p.metodo_pago === "Efectivo" && (efectivoRecibido[p._id] ?? "") !== ""
      )
      const efectivoRecibidoTotal = +lineasConVuelto
        .reduce((a, p) => a + (Number(efectivoRecibido[p._id]) || 0), 0)
        .toFixed(2)
      const efectivoAplicado = +lineasConVuelto
        .reduce((a, p) => a + (Number(p.monto_bruto) || 0), 0)
        .toFixed(2)
      const vueltoTotal = +(efectivoRecibidoTotal - efectivoAplicado).toFixed(2)

      // Foto de la venta para la tirilla termica (80 mm). Se arma AQUI, con el
      // estado local aun disponible, y sobrevive al resetForm().
      const razonSocial = await getRazonSocialForPdf()

      // Bloque fiscal CAI: solo si la empresa tiene Facturación CAI activa Y la
      // venta obtuvo un numero fiscal (`data.numero_fiscal`). Trae la config CAI
      // (rango, fecha limite, imprenta) para el encabezado del comprobante SAR.
      // Con puntos (officemart-004) la venta trae su foto fiscal; si no, se
      // lee la config CAI vigente del punto (0 = empresa sin puntos).
      let fiscal: TirillaFiscal | null = null
      if ((user?.flags?.facturacion_cai ?? false) && data?.numero_fiscal) {
        const desglose = calcularDesgloseFiscal(subtotal - montoDescuento, isv, mostrarIsv)
        const esConsumidorFinal = !selectedCliente?.rtn
        const foto = fiscalDesdeSnapshot(parseFiscalSnapshot(data.fiscal_snapshot))
        let base: NonNullable<ReturnType<typeof fiscalDesdeSnapshot>>
        if (foto) {
          base = { ...foto, cai: data.cai_emitido || foto.cai }
        } else {
          const { data: cfgs } = await getConfigsCai(puntoSeleccionado?.id ?? 0)
          const cfg: ConfigCai | undefined = cfgs.find((c) => c.tipo_documento === "01")
          base = {
            cai: data.cai_emitido || cfg?.cai || "",
            rangoDesde: cfg ? formatearCorrelativoCai(cfg.establecimiento, cfg.punto_emision, cfg.tipo_documento, cfg.rango_inicial) : null,
            rangoHasta: cfg && cfg.rango_final > 0 ? formatearCorrelativoCai(cfg.establecimiento, cfg.punto_emision, cfg.tipo_documento, cfg.rango_final) : null,
            fechaLimite: cfg?.fecha_limite_emision ? fmtFechaCorta(cfg.fecha_limite_emision) : null,
            imprentaNombre: cfg?.imprenta_nombre || null,
            imprentaRtn: cfg?.imprenta_rtn || null,
            imprentaRegistro: cfg?.imprenta_registro || null,
          }
        }
        fiscal = {
          ...base,
          numeroFiscal: data.numero_fiscal,
          clienteRtn: selectedCliente?.rtn || null,
          esConsumidorFinal,
          ...desglose,
          totalEnLetras: totalEnLetras(total),
        }
      }

      const tirilla: TirillaVenta = {
        empresa: {
          nombre:
            razonSocial?.nombre_comercial ||
            razonSocial?.nombre_empresa ||
            user?.razon_social_nombre ||
            "",
          rtn: razonSocial?.documento || null,
          direccion: razonSocial?.direccion || null,
          telefono: razonSocial?.telefono || null,
          // Logo estatico de la tirilla si la empresa tiene uno asignado. URL
          // absoluta: la tirilla se renderiza en un iframe blob (origen opaco),
          // por lo que una ruta relativa no resolveria.
          logoUrl: tirillaLogoUrl(user?.razon_social_id),
        },
        numeroFactura: numeroDefinitivo,
        fechaISO: encabezado.fecha_venta,
        cliente: selectedCliente?.nombre || "Consumidor Final",
        fiscal,
        lineas: lineas.map((l) => ({
          nombre: l.producto_nombre,
          cantidad: l.cantidad,
          precioUnitario: l.precio_unitario,
          codigo: l.producto_codigo,
        })),
        subtotal,
        descuentoPct: descuentoPctSafe,
        descuentoMonto: montoDescuento,
        mostrarIsv,
        isv,
        total,
        pagos: pagosDetalle.map((p) => ({
          metodo: metodoPagoLabel(
            p.metodo_pago,
            cuentas.find((c) => c.id === p.cuenta_id)?.nombre
          ),
          monto: Number(p.monto_bruto) || 0,
        })),
        valorPagado: valorpago,
        saldo: Math.max(0, +(total - valorpago).toFixed(2)),
        efectivoRecibido: efectivoRecibidoTotal > 0 ? efectivoRecibidoTotal : null,
        vuelto: vueltoTotal > 0 ? vueltoTotal : null,
        mostrarCodigoProducto: user?.flags?.tirilla_mostrar_codigo ?? false,
      }

      // Deja el formulario listo para la siguiente venta y abre el dialogo con
      // las opciones de impresion (tirilla 80 mm / factura PDF).
      resetForm()
      setVentaExitosa({
        numeroFactura: numeroDefinitivo,
        total: ventaData.encabezado.total_venta ?? total,
        tirilla,
        ventaData,
        cliente: selectedCliente,
      })
    } catch (err) {
      toast({ title: "Error", description: "Error al guardar la venta", variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  // Imprime la tirilla termica (80 mm) de la venta recien registrada. Mide el
  // alto real del contenido para que el papel salga del largo EXACTO.
  function handleImprimirTirilla() {
    if (!ventaExitosa) return
    setImprimiendo(true)
    try {
      printTirilla(buildTirillaVentaHtml(ventaExitosa.tirilla), { widthMm: 80 })
    } catch {
      toast({ title: "Error", description: "No se pudo preparar la tirilla", variant: "destructive" })
    } finally {
      setImprimiendo(false)
    }
  }

  // Descarga la factura A4 en PDF de la venta recien registrada.
  async function handleDescargarPdf() {
    if (!ventaExitosa) return
    await generatePdfFromData(ventaExitosa.ventaData, ventaExitosa.cliente)
  }

  async function generatePdfFromData(
    ventaData: { encabezado: VentaEncabezado; detalles: VentaDetalle[] },
    cliente: Cliente | undefined
  ) {
    const razonSocial = await getRazonSocialForPdf()
    const enc = ventaData.encabezado

    // Bloque fiscal CAI para la carta A4 (mismo criterio que la tirilla): solo si
    // la venta tiene numero fiscal. Reusa la config CAI y el desglose.
    let fiscal: FacturaPdfFiscal | null = null
    if (enc.numero_fiscal) {
      const subt = enc.subtotal ?? 0
      const descMonto = +(subt * ((enc.descuento ?? 0) / 100)).toFixed(2)
      const desglose = calcularDesgloseFiscal(subt - descMonto, enc.impuesto_total ?? 0, !!enc.aplica_impuesto)
      // Foto fiscal de la venta (officemart-004) o, si no hay, CAI vigente del punto.
      const foto = fiscalDesdeSnapshot(parseFiscalSnapshot(enc.fiscal_snapshot))
      let base: NonNullable<ReturnType<typeof fiscalDesdeSnapshot>>
      if (foto) {
        base = { ...foto, cai: enc.cai_emitido || foto.cai }
      } else {
        const { data: cfgs } = await getConfigsCai(enc.punto_facturacion_id ?? 0)
        const cfg = cfgs.find((c) => c.tipo_documento === (enc.tipo_documento_fiscal || "01"))
        base = {
          cai: enc.cai_emitido || cfg?.cai || "",
          rangoDesde: cfg ? formatearCorrelativoCai(cfg.establecimiento, cfg.punto_emision, cfg.tipo_documento, cfg.rango_inicial) : null,
          rangoHasta: cfg && cfg.rango_final > 0 ? formatearCorrelativoCai(cfg.establecimiento, cfg.punto_emision, cfg.tipo_documento, cfg.rango_final) : null,
          fechaLimite: cfg?.fecha_limite_emision ? fmtFechaCorta(cfg.fecha_limite_emision) : null,
          imprentaNombre: cfg?.imprenta_nombre || null,
          imprentaRtn: cfg?.imprenta_rtn || null,
          imprentaRegistro: cfg?.imprenta_registro || null,
        }
      }
      fiscal = {
        ...base,
        numeroFiscal: enc.numero_fiscal,
        esConsumidorFinal: !cliente?.rtn,
        ...desglose,
        totalEnLetras: totalEnLetras(enc.total_venta ?? 0),
      }
    }

    const mostrarIsvPdf = (user?.flags?.ventas_mostrar_isv ?? true) && !!enc.aplica_impuesto
    const { ok } = await generarFacturaPdf({
      tipo: "venta",
      empresa: razonSocial,
      numeroDocumento: enc.numero_factura,
      clienteNombre: cliente?.nombre || "Consumidor Final",
      clienteRtn: cliente?.rtn || null,
      fecha: enc.fecha_venta || new Date().toISOString(),
      lineas: ventaData.detalles.map((d) => ({
        nombre: d.producto_nombre || "",
        cantidad: d.cantidad ?? 0,
        precioUnitario: d.precio_unitario ?? 0,
      })),
      subtotal: enc.subtotal ?? 0,
      descuentoPct: enc.descuento ?? 0,
      mostrarIsv: mostrarIsvPdf,
      isvPct: enc.porcentaje_impuesto ?? 15,
      isv: enc.impuesto_total ?? 0,
      total: enc.total_venta ?? 0,
      fiscal,
    })
    if (ok) {
      toast({ title: "PDF Generado", description: "La factura se descargo automaticamente" })
    } else {
      toast({ title: "Error", description: "No se pudo generar el PDF", variant: "destructive" })
    }
  }


  // Limpia completamente el formulario y obtiene un nuevo correlativo + datos
  // frescos de catalogos. Se llama siempre que el usuario sale del dialog de
  // factura generada (boton "Nueva Venta" o al cerrar el dialog con X).
  function resetForm() {
    setLineas([])
    setClienteId("")
    setPagosDetalle([])
    setEfectivoRecibido({})
    efectivoSeededRef.current = false // re-siembra el Efectivo (razon social 14)
    setDescuentoPct(0)
    setAplicaIsv(false) // vuelve al default (sin ISV) para la siguiente venta
    setFecha(hoyISO())
    setStockPorLocalizacion({})
    // loadData() vuelve a seleccionar "Consumidor Final" por defecto.
    // Recarga el correlativo y los catalogos para reflejar altas recientes
    // (nuevos clientes, productos, correlativo incrementado).
    loadData()
  }

  // Alterna el modo POS a pantalla completa. IMPORTANTE: solo usamos el layout
  // in-app (fixed inset-0 que cubre el sidebar/topbar), NO la Fullscreen API del
  // navegador. Con la Fullscreen API, el navegador solo pinta el subarbol del
  // elemento en fullscreen y los portales de Radix (Select de cliente/metodo y
  // el modal de impresion) se renderizan en document.body -> quedaban invisibles
  // e inutilizables. Con el modo CSS, todo el documento se pinta y los portales
  // funcionan normalmente.
  function toggleFullscreen() {
    setFullscreen((v) => !v)
  }

  if (loading) {
    return (
      <div className="min-h-[calc(100vh-4rem)] flex flex-col lg:flex-row">
        <div className="flex-1 p-4 md:p-6">
          <Skeleton className="h-10 w-full mb-4" />
          <Skeleton className="h-64 md:h-[calc(100%-6rem)] w-full" />
        </div>
        <div className="w-full lg:w-96 border-t lg:border-t-0 lg:border-l p-4 md:p-6">
          <Skeleton className="h-64 w-full" />
        </div>
      </div>
    )
  }

  return (
    <div
      ref={posRootRef}
      className={
        fullscreen
          ? "fixed inset-0 z-50 h-screen w-screen overflow-hidden flex flex-col lg:flex-row bg-background"
          : "min-h-[calc(100vh-4rem)] lg:h-[calc(100vh-4rem)] lg:overflow-hidden flex flex-col lg:flex-row bg-muted/30"
      }
    >
      {/* Main Content - Products */}
      <div className="flex-1 flex flex-col p-3 md:p-4 lg:min-h-0 lg:overflow-hidden">
        {/* Row 1: Factura + fecha + pantalla completa */}
        <div className="flex items-center justify-between gap-3 mb-3">
          <div className="flex flex-wrap items-center gap-2 md:gap-3">
            <div className="flex items-center gap-2 bg-primary/10 text-primary px-3 py-1.5 rounded-lg">
              <Receipt className="h-4 w-4 md:h-5 md:w-5" />
              <span className="font-mono font-bold text-base md:text-lg">{numeroFactura}</span>
            </div>
            {/* Punto de facturación (officemart-004): selector para admin /
                usuario sin punto; etiqueta fija para el resto. */}
            {puedeElegirPunto ? (
              <Select value={puntoId || "__none__"} onValueChange={(v) => handlePuntoChange(v === "__none__" ? "" : v)}>
                <SelectTrigger className="h-9 w-44 md:w-52 bg-background text-sm">
                  <SelectValue placeholder="Punto de facturación" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Sin punto (serie global)</SelectItem>
                  {puntos.map((p) => (
                    <SelectItem key={p.id} value={String(p.id)}>{etiquetaPunto(p)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : puntoSeleccionado ? (
              <Badge variant="outline" className="gap-1 font-normal">
                <MapPin className="h-3 w-3" /> {etiquetaPunto(puntoSeleccionado)}
              </Badge>
            ) : null}
            <Input
              type="date"
              value={fecha}
              onChange={(e) => setFecha(e.target.value)}
              className="w-36 md:w-40 bg-background text-sm"
            />
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={toggleFullscreen}
            className="gap-2 shrink-0"
            title={fullscreen ? "Salir de pantalla completa" : "Pantalla completa (modo POS)"}
          >
            {fullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            <span className="hidden sm:inline">{fullscreen ? "Salir" : "Pantalla completa"}</span>
          </Button>
        </div>

        {/* Contenedor unificado: despacho + catalogo (todo en una sola tarjeta) */}
        <Card className="flex-1 flex flex-col overflow-hidden min-h-[280px] lg:min-h-0">
          <CardContent className="p-3 md:p-4 h-full flex flex-col gap-3 min-h-0">
            {/* Almacen de despacho + localizacion */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div>
                <Label className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1 flex items-center gap-1.5">
                  <Warehouse className="h-3.5 w-3.5" />
                  Almacen de Despacho
                </Label>
                <Select value={almacenId} onValueChange={handleAlmacenChange}>
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="Seleccionar almacen..." />
                  </SelectTrigger>
                  <SelectContent>
                    {almacenes.map(a => (
                      <SelectItem key={a.id} value={a.id!.toString()}>
                        {a.nombre}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1 flex items-center gap-1.5">
                  <MapPin className="h-3.5 w-3.5" />
                  Localizacion
                </Label>
                <Select
                  value={localizacionId}
                  onValueChange={handleLocalizacionChange}
                  disabled={!almacenId}
                >
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder={almacenId ? "Seleccionar..." : "Seleccione almacen"} />
                  </SelectTrigger>
                  <SelectContent>
                    {localizacionesFiltradas.map(l => (
                      <SelectItem key={l.id} value={l.id!.toString()}>
                        {l.nombre}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {!almacenId && (
              <p className="text-xs text-amber-700 flex items-center gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5" />
                Seleccione un almacen para poder agregar productos
              </p>
            )}

            {ventaRapidaActiva && (
              <Button
                type="button"
                variant="outline"
                className="w-full gap-2 border-sky-300 bg-sky-50 text-sky-800 hover:bg-sky-100"
                onClick={() => setVentaRapidaOpen(true)}
              >
                <Zap className="h-4 w-4" /> Venta rápida (producto o servicio no catalogado)
              </Button>
            )}

            <Separator />

            {/* Catalogo de productos (ocupa el resto del contenedor) */}
            <div className="flex-1 min-h-0">
              <ProductCatalog
                productos={resultadosBusqueda ?? productos}
                marcas={marcas}
                categorias={categorias}
                idsEnVenta={lineas.map((l) => l.producto_id).filter((id): id is number => id != null)}
                onAdd={(producto) => addProducto(producto)}
                disabled={!almacenId}
                localizacionSeleccionada={!!localizacionId}
                stockPorLocalizacion={stockCatalogo}
                loadingStock={loadingCatalogo}
                serverSearch
                onBuscar={buscarProductosServidor}
                buscando={buscandoProductos}
                searchValue={busquedaTexto}
                onSearchChange={setBusquedaTexto}
                onAddTodos={agregarProductos}
                precioFinal={precioDeVenta}
              />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Sidebar - Productos seleccionados + Resumen */}
      <div className="w-full lg:w-[26rem] xl:w-[28rem] border-t lg:border-t-0 lg:border-l bg-background flex flex-col lg:min-h-0 lg:overflow-y-auto">
        <div className="px-4 py-3 border-b flex items-center gap-2 shrink-0">
          <ShoppingCart className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">Productos en la venta</span>
          {lineas.length > 0 && (
            <Badge variant="secondary" className="ml-auto text-xs">
              {lineas.length}
            </Badge>
          )}
        </div>
        <div className="overflow-auto lg:max-h-[38vh] border-b shrink-0">
            {lineas.length === 0 ? (
              <div className="min-h-[140px] flex flex-col items-center justify-center text-muted-foreground p-4">
                <ShoppingCart className="h-10 w-10 md:h-12 md:w-12 mb-3 opacity-20" />
                <p className="text-sm md:text-base text-center">No hay productos en la venta</p>
                <p className="text-xs md:text-sm text-center">Seleccione productos del catalogo de la izquierda</p>
              </div>
            ) : (
              <div className="divide-y">
                {lineas.map((linea, index) => {
                  const stockInsuficiente = localizacionId && linea.cantidad > linea.stock_disponible
                  const seAgotara = localizacionId && linea.stock_disponible > 0 && linea.cantidad === linea.stock_disponible
                  
                  return (
                  <div
                    key={linea._key}
                    className={`p-3 transition-colors ${
                      stockInsuficiente ? "bg-amber-50/80 border-l-4 border-l-amber-600" : "hover:bg-muted/50"
                    }`}
                  >
                    {/* Top row: product name + delete */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-foreground text-sm leading-snug line-clamp-2">
                          {linea.producto_nombre}
                          {linea.producto_id == null && (
                            <span className="ml-1.5 rounded-full bg-sky-100 px-1.5 py-0.5 text-[10px] font-semibold text-sky-700 align-middle">Venta rápida</span>
                          )}
                        </p>
                        <p className="text-xs text-muted-foreground font-mono mt-0.5 truncate">{linea.producto_codigo}</p>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => removeLinea(index)}
                        className="text-destructive hover:text-destructive hover:bg-destructive/10 h-7 w-7 shrink-0"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>

                    {/* Stock badge + warnings (solo productos reales; Venta Rapida no tiene stock) */}
                    {localizacionId && linea.producto_id != null && (
                      <div className="mt-1.5">
                        <Badge
                          variant={stockInsuficiente ? "destructive" : "secondary"}
                          className={`text-xs ${
                            stockInsuficiente 
                              ? "bg-amber-600 hover:bg-amber-700" 
                              : seAgotara 
                                ? "bg-yellow-500 text-yellow-950 hover:bg-yellow-600"
                                : "bg-emerald-100 text-emerald-700 hover:bg-emerald-200"
                          }`}
                        >
                          Disp: {linea.stock_disponible}
                        </Badge>
                        {stockInsuficiente && (
                          <p className="text-xs text-amber-700 mt-1 flex items-center gap-1">
                            <AlertTriangle className="h-3 w-3 shrink-0" />
                            <span>Stock insuficiente</span>
                          </p>
                        )}
                        {seAgotara && !stockInsuficiente && (
                          <p className="text-xs text-yellow-700 mt-1 flex items-center gap-1">
                            <AlertTriangle className="h-3 w-3 shrink-0" />
                            <span>Quedara agotado</span>
                          </p>
                        )}
                      </div>
                    )}

                    {/* Bottom row: quantity controls + price + subtotal */}
                    <div className="flex items-center justify-between gap-2 mt-2">
                      {/* Quantity Controls */}
                      <div className="flex items-center gap-1 shrink-0">
                        <Button 
                          variant="outline" 
                          size="icon" 
                          className="h-7 w-7"
                          onClick={() => updateCantidad(index, -1)}
                        >
                          <Minus className="h-3 w-3" />
                        </Button>
                        <input
                          type="number"
                          step="any"
                          min="0"
                          value={linea.cantidad}
                          onChange={(e) => setCantidadLinea(index, parseFloat(e.target.value) || 0)}
                          className="w-14 h-7 text-center font-bold text-sm rounded-md border border-stone-200 focus:outline-none focus:ring-1 focus:ring-stone-300"
                        />
                        <Button 
                          variant="outline" 
                          size="icon" 
                          className="h-7 w-7"
                          onClick={() => updateCantidad(index, 1)}
                        >
                          <Plus className="h-3 w-3" />
                        </Button>
                      </div>

                      {/* Price input — bloqueado (solo lectura) si el flag lo pide y no es admin. */}
                      <div className="flex items-center gap-1 min-w-0">
                        <span className="text-xs text-muted-foreground shrink-0">L</span>
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          value={linea.precio_unitario}
                          onChange={(e) => updatePrecio(index, parseFloat(e.target.value) || 0)}
                          readOnly={bloquearPrecioDescuento}
                          disabled={bloquearPrecioDescuento}
                          title={bloquearPrecioDescuento ? "El precio no se puede editar (definido por el administrador)" : undefined}
                          className="text-right font-medium text-sm h-7 w-20 px-2 disabled:opacity-100 disabled:cursor-not-allowed"
                        />
                      </div>

                      {/* Line Subtotal */}
                      <div className="text-right shrink-0 min-w-[64px]">
                        <p className="font-bold text-sm">L {(linea.subtotal ?? 0).toFixed(2)}</p>
                      </div>
                    </div>
                  </div>
                  )
                })}
              </div>
            )}
        </div>

        {/* Client Selection */}
        <div className="p-4 border-b">
          <div className="flex items-center justify-between mb-2">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">Cliente</Label>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    className="h-7 text-xs gap-1 text-primary hover:text-primary hover:bg-primary/10"
                    onClick={() => setShowClienteDialog(true)}
                  >
                    <UserPlus className="h-3.5 w-3.5" />
                    Nuevo
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Crear cliente rapido</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          <Popover open={clienteComboOpen} onOpenChange={setClienteComboOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                role="combobox"
                aria-expanded={clienteComboOpen}
                className="w-full h-12 justify-between text-base font-normal"
              >
                <span className="flex items-center gap-2 min-w-0">
                  <User className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="truncate">{selectedCliente ? selectedCliente.nombre : "Seleccionar cliente..."}</span>
                </span>
                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
              <Command>
                <CommandInput placeholder="Buscar cliente por nombre o RTN..." className="h-10" />
                <CommandList className="max-h-72">
                  <CommandEmpty>No se encontraron clientes.</CommandEmpty>
                  <CommandGroup>
                    {clientes.map((c) => (
                      <CommandItem
                        key={c.id}
                        value={`${c.nombre} ${c.rtn || ""}`}
                        onSelect={() => { setClienteId(c.id!.toString()); setClienteComboOpen(false) }}
                        className="cursor-pointer"
                      >
                        <Check className={`mr-2 h-4 w-4 shrink-0 ${clienteId === c.id!.toString() ? "opacity-100" : "opacity-0"}`} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate">{c.nombre}</p>
                          {c.rtn && <p className="truncate font-mono text-xs text-muted-foreground">{c.rtn}</p>}
                        </div>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
          {selectedCliente && (
            <p className="text-xs text-muted-foreground mt-2">
              RTN: {selectedCliente.rtn || "N/A"}
            </p>
          )}
          {/* Notas especiales y bloqueo del cliente (script officemart-002). */}
          {selectedCliente?.notas && (
            <div className="mt-2 p-2 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800">
              <span className="font-medium">Nota del cliente: </span>{selectedCliente.notas}
            </div>
          )}
          {selectedCliente?.bloqueado && (
            <div className="mt-2 p-2 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700 flex items-start gap-2">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>
                Bloqueado para crédito{selectedCliente.motivo_bloqueo ? `: ${selectedCliente.motivo_bloqueo}` : ""}. Solo ventas de contado.
              </span>
            </div>
          )}
          {/* Vendedor (modulo Vendedores y Zonas). */}
          {usaVendedores && (
            <div className="mt-3">
              <Label className="text-xs text-muted-foreground">
                Vendedor{vendedorObligatorio ? " *" : ""}
              </Label>
              <Select value={vendedorId || "__none__"} onValueChange={(v) => setVendedorId(v === "__none__" ? "" : v)}>
                <SelectTrigger className="h-10 mt-1">
                  <SelectValue placeholder="Sin vendedor" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Sin vendedor</SelectItem>
                  {vendedores.map((v) => (
                    <SelectItem key={v.id} value={String(v.id)}>{v.nombre}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        {/* Stock Warning */}
        {hayStockInsuficiente && (
          <div className="mx-4 mt-3 p-3 rounded-lg bg-amber-50 border border-amber-200">
            <p className="text-sm text-amber-800 font-medium flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              Stock Insuficiente
            </p>
            <p className="text-xs text-amber-700 mt-1">
              {lineasConStockInsuficiente.length} producto(s) exceden el stock disponible en esta ubicacion
            </p>
          </div>
        )}

        {/* ISV Toggle (oculto si la empresa vende sin ISV) */}
        {mostrarIsv && (
        <div className="px-4 py-3 border-b flex items-center justify-between">
          <Label htmlFor="isv-switch" className="text-sm">Aplicar ISV (15%)</Label>
          <Switch
            id="isv-switch"
            checked={aplicaIsv}
            onCheckedChange={setAplicaIsv}
          />
        </div>
        )}

        {/* Descuento — oculto si el flag bloquea precio/descuento y no es admin. */}
        {!bloquearPrecioDescuento && (
        <div className="px-4 py-3 border-b flex items-center justify-between gap-3">
          <Label htmlFor="descuento-input" className="text-sm">Descuento (%)</Label>
          <div className="relative w-28">
            <Input
              id="descuento-input"
              type="number"
              inputMode="decimal"
              min={0}
              max={100}
              step={0.01}
              value={descuentoPct === 0 ? "" : descuentoPct}
              placeholder="0"
              onChange={(e) => {
                const raw = e.target.value
                if (raw === "") {
                  setDescuentoPct(0)
                  return
                }
                const parsed = Number(raw)
                if (!Number.isFinite(parsed)) return
                setDescuentoPct(Math.min(100, Math.max(0, parsed)))
              }}
              className="pr-7 text-right"
            />
            <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-xs text-muted-foreground">
              %
            </span>
          </div>
        </div>
        )}

        {/* Desglose de Pago (multi-metodo) */}
        <div className="px-4 py-3 border-b space-y-3">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-medium">Desglose de Pago</Label>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs gap-1"
              onClick={() => agregarPagoLinea()}
            >
              <Plus className="h-3.5 w-3.5" />
              Agregar pago
            </Button>
          </div>

          {/* Aviso si no hay caja abierta */}
          {!cajaFeaturePending && !cajaSesion && (
            <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 leading-tight">
              <Wallet className="h-3 w-3 inline mr-1" />
              Caja Chica cerrada. Los pagos en efectivo estaran deshabilitados.
            </p>
          )}

          {/* Lineas de pago */}
          {pagosDetalle.length === 0 ? (
            <p className="text-[11px] text-muted-foreground italic">
              Sin pagos registrados. La venta quedara como{" "}
              <span className="text-red-700 font-medium">Pendiente</span> (credito).
            </p>
          ) : (
            <div className="space-y-2">
              {pagosDetalle.map((linea) => {
                const cuenta = cuentas.find((c) => c.id === linea.cuenta_id)
                const requiereCuenta =
                  linea.metodo_pago === "Banco" || linea.metodo_pago === "Link_Pago"
                const comision = linea.porcentaje_comision ?? cuenta?.porcentaje_comision ?? 0
                const monto = Number(linea.monto_bruto || 0)
                const neto = +(monto * (1 - comision / 100)).toFixed(2)
                return (
                  <div
                    key={linea._id}
                    className="rounded-md border border-stone-200 bg-stone-50/40 p-2 space-y-2"
                  >
                    <div className="flex items-center gap-2">
                      <Select
                        value={linea.metodo_pago}
                        onValueChange={(v) => actualizarPagoLinea(linea._id, { metodo_pago: v as PagoVentaDetalleInput["metodo_pago"], cuenta_id: null, porcentaje_comision: 0 })}
                      >
                        <SelectTrigger className="h-8 flex-1 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Efectivo" disabled={!cajaFeaturePending && !cajaSesion}>
                            Efectivo
                          </SelectItem>
                          <SelectItem value="Banco">Banco</SelectItem>
                          <SelectItem value="Link_Pago">Link de Pago</SelectItem>
                          <SelectItem value="Otro">Otro</SelectItem>
                        </SelectContent>
                      </Select>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                        onClick={() => eliminarPagoLinea(linea._id)}
                        aria-label="Eliminar pago"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>

                    {requiereCuenta && (
                      <Select
                        value={linea.cuenta_id?.toString() ?? ""}
                        onValueChange={(v) => {
                          const cId = parseInt(v)
                          const c = cuentas.find((x) => x.id === cId)
                          actualizarPagoLinea(linea._id, {
                            cuenta_id: cId,
                            porcentaje_comision: c?.porcentaje_comision ?? 0,
                          })
                        }}
                      >
                        <SelectTrigger className="h-8 w-full text-xs">
                          <SelectValue placeholder="Seleccione cuenta..." />
                        </SelectTrigger>
                        <SelectContent>
                          {cuentas.length === 0 && (
                            <div className="px-2 py-1.5 text-xs text-muted-foreground">
                              No hay cuentas configuradas
                            </div>
                          )}
                          {cuentas.map((c) => (
                            <SelectItem key={c.id} value={c.id!.toString()}>
                              <span className="flex items-center gap-1.5">
                                <Landmark className="h-3 w-3" />
                                {/*
                                  La columna real es `nombre`. Mantenemos
                                  fallbacks a `banco`/`alias` por si en el
                                  futuro se reincorporan, pero hoy bastara
                                  con `nombre` para que el SelectItem se
                                  vea poblado.
                                */}
                                {c.nombre || ""}
                                {(c.porcentaje_comision ?? 0) > 0 && (
                                  <span className="text-[10px] text-muted-foreground">
                                    ({c.porcentaje_comision}%)
                                  </span>
                                )}
                              </span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}

                    <div className="relative">
                      <span className="pointer-events-none absolute inset-y-0 left-2 flex items-center text-xs text-muted-foreground">
                        L
                      </span>
                      <Input
                        type="number"
                        inputMode="decimal"
                        min={0}
                        step={0.01}
                        value={monto === 0 ? "" : monto}
                        placeholder="0.00"
                        onChange={(e) => {
                          const raw = e.target.value
                          const parsed = raw === "" ? 0 : Number(raw)
                          if (!Number.isFinite(parsed)) return
                          actualizarPagoLinea(linea._id, { monto_bruto: Math.max(0, parsed) })
                        }}
                        className="pl-6 h-8 text-right text-sm"
                      />
                    </div>

                    {linea.metodo_pago === "Efectivo" && (
                      <div className="space-y-1">
                        <div className="relative">
                          <span className="pointer-events-none absolute inset-y-0 left-2 flex items-center text-xs text-muted-foreground">
                            L
                          </span>
                          <Input
                            type="number"
                            inputMode="decimal"
                            min={0}
                            step={0.01}
                            value={efectivoRecibido[linea._id] ?? ""}
                            placeholder="Con cuanto paga (efectivo recibido)"
                            onChange={(e) =>
                              setEfectivoRecibido((prev) => ({ ...prev, [linea._id]: e.target.value }))
                            }
                            className="pl-6 h-8 text-right text-sm"
                          />
                        </div>
                        {(efectivoRecibido[linea._id] ?? "") !== "" &&
                          (() => {
                            const recibido = Number(efectivoRecibido[linea._id]) || 0
                            const vuelto = +(recibido - monto).toFixed(2)
                            const falta = vuelto < 0
                            return (
                              <div
                                className={`mt-1 flex items-center justify-between rounded-lg border px-3 py-2 ${
                                  falta
                                    ? "border-destructive/30 bg-destructive/5"
                                    : "border-emerald-300 bg-emerald-50"
                                }`}
                              >
                                <span
                                  className={`text-sm font-semibold ${
                                    falta ? "text-destructive" : "text-emerald-700"
                                  }`}
                                >
                                  {falta ? "Falta" : "Vuelto"}
                                </span>
                                <span
                                  className={`text-2xl font-extrabold tabular-nums ${
                                    falta ? "text-destructive" : "text-emerald-700"
                                  }`}
                                >
                                  L {Math.abs(vuelto).toLocaleString("es-HN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </span>
                              </div>
                            )
                          })()}
                      </div>
                    )}

                    {requiereCuenta && monto > 0 && comision > 0 && (
                      <p className="text-[10px] text-muted-foreground flex justify-between leading-none">
                        <span>Comision {comision}%</span>
                        <span>Neto: <span className="font-medium text-foreground">L {neto.toFixed(2)}</span></span>
                      </p>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {/* Resumen del desglose
              `Total pagado (bruto)` = lo que el cliente entrega.
              `Neto a recibir`     = lo que llega al comercio (descontando
                                     comisiones bancarias de las lineas).
              El sobrepago se valida a nivel BRUTO (el cliente no puede
              entregar mas que el total cobrado). El estado_pago se valida
              a nivel NETO contra `totalNeto`, que es el valor registrado
              de la venta.
          */}
          {pagosDetalle.length > 0 && (
            <div className="rounded-md bg-stone-50 border border-stone-200 px-2 py-1.5 text-[11px] space-y-0.5">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Total pagado (bruto)</span>
                <span className="font-medium">
                  L {pagosDetalle.reduce((a, p) => a + (Number(p.monto_bruto) || 0), 0).toFixed(2)}
                </span>
              </div>
              {totalComisionesR > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Neto a recibir</span>
                  <span className="font-medium">L {sumaPagosNetoR.toFixed(2)}</span>
                </div>
              )}
              {(() => {
                const sumBrutoR = +pagosDetalle
                  .reduce((a, p) => a + (Number(p.monto_bruto) || 0), 0)
                  .toFixed(2)
                const totalBrutoR = +total.toFixed(2)
                if (sumBrutoR > totalBrutoR) {
                  return (
                    <p className="text-destructive font-medium">
                      Sobrepago: L {(sumBrutoR - totalBrutoR).toFixed(2)} excede el total
                    </p>
                  )
                }
                if (sumBrutoR === 0) {
                  return <p className="text-red-700 font-medium">Estado: Pendiente</p>
                }
                if (sumBrutoR >= totalBrutoR - 0.005) {
                  return <p className="text-emerald-700 font-medium">Estado: Pagado</p>
                }
                return (
                  <p className="text-amber-700 font-medium">
                    Estado: Parcial - Saldo L {(totalBrutoR - sumBrutoR).toFixed(2)}
                  </p>
                )
              })()}
            </div>
          )}
        </div>

        {/* Totals
            El "Total" prominente representa el NETO (lo que recibe el
            comercio despues de comisiones bancarias del desglose de pago).
            Si no hay comisiones, totalNeto === total y se conserva el
            comportamiento legacy. Cuando hay comisiones, mostramos como
            lineas separadas el subtotal bruto (lo que paga el cliente)
            y la deduccion por comisiones, para transparencia.
        */}
        <div className="flex-1 p-3 md:p-4 flex flex-col justify-end">
          <div className="space-y-2 md:space-y-3">
            <div className="flex justify-between text-xs md:text-sm">
              <span className="text-muted-foreground">Articulos ({totalItems})</span>
              <span>L {subtotal.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-xs md:text-sm">
              <span className="text-muted-foreground">Subtotal</span>
              <span>L {subtotal.toFixed(2)}</span>
            </div>
            {descuentoPctSafe > 0 && (
              <div className="flex justify-between text-xs md:text-sm">
                <span className="text-muted-foreground">
                  Descuento ({descuentoPctSafe.toFixed(descuentoPctSafe % 1 === 0 ? 0 : 2)}%)
                </span>
                <span className="text-primary">- L {montoDescuento.toFixed(2)}</span>
              </div>
            )}
            {mostrarIsv && (
              <div className="flex justify-between text-xs md:text-sm">
                <span className="text-muted-foreground">ISV (15%)</span>
                <span>L {isv.toFixed(2)}</span>
              </div>
            )}
            <Separator />
            <div className="flex justify-between items-baseline">
              <span className="text-base md:text-lg font-semibold">Total</span>
              <span className="text-2xl md:text-3xl font-bold text-primary">
                L {total.toFixed(2)}
              </span>
            </div>
            {totalComisionesR > 0 && (
              <div className="space-y-0.5 pt-1 text-[11px] text-muted-foreground">
                <div className="flex justify-between">
                  <span>Comision bancaria</span>
                  <span className="text-destructive">- L {totalComisionesR.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Neto a recibir</span>
                  <span>L {totalNeto.toFixed(2)}</span>
                </div>
              </div>
            )}
          </div>

          {/* Action Buttons */}
          <div className="mt-4 md:mt-6 space-y-3">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="w-full">
                    <Button 
                      size="lg" 
                      className="w-full h-12 md:h-14 text-base md:text-lg gap-2"
                      onClick={handleSubmit}
                      disabled={
                        saving ||
                        lineas.length === 0 ||
                        !clienteId ||
                        !almacenId ||
                        !localizacionId ||
                        hayStockInsuficiente ||
                        // Desglose: rechazamos sobrepago. Otras validaciones
                        // (cuenta requerida, caja cerrada, monto <=0 por linea)
                        // se muestran como toasts en handleSubmit.
                        pagosDetalle.reduce(
                          (a, p) => a + (Number(p.monto_bruto) || 0),
                          0
                        ) > +total.toFixed(2)
                      }
                    >
                      {saving ? (
                        "Procesando..."
                      ) : (
                        <>
                          <FileText className="h-4 w-4 md:h-5 md:w-5" />
                          Generar Factura
                        </>
                      )}
                    </Button>
                  </div>
                </TooltipTrigger>
                {hayStockInsuficiente && (
                  <TooltipContent side="top" className="bg-amber-800 text-amber-50">
                    <p>No se puede facturar: hay productos con stock insuficiente</p>
                  </TooltipContent>
                )}
              </Tooltip>
            </TooltipProvider>
          </div>
        </div>
      </div>

      {/* Quick Client Creation Dialog */}
      <Dialog open={showClienteDialog} onOpenChange={setShowClienteDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserPlus className="h-5 w-5 text-primary" />
              Crear Cliente Rapido
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="cliente-nombre">
                Nombre <span className="text-destructive">*</span>
              </Label>
              <Input
                id="cliente-nombre"
                placeholder="Nombre del cliente"
                value={nuevoCliente.nombre || ""}
                onChange={(e) => setNuevoCliente(prev => ({ ...prev, nombre: e.target.value }))}
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cliente-rtn">RTN</Label>
              <Input
                id="cliente-rtn"
                placeholder="RTN (opcional)"
                value={nuevoCliente.rtn || ""}
                onChange={(e) => setNuevoCliente(prev => ({ ...prev, rtn: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cliente-direccion">Direccion</Label>
              <Input
                id="cliente-direccion"
                placeholder="Direccion (opcional)"
                value={nuevoCliente.direccion || ""}
                onChange={(e) => setNuevoCliente(prev => ({ ...prev, direccion: e.target.value }))}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="cliente-telefono">Telefono</Label>
                <Input
                  id="cliente-telefono"
                  type="tel"
                  inputMode="tel"
                  placeholder="9999-9999"
                  value={nuevoCliente.telefono || ""}
                  onChange={(e) =>
                    setNuevoCliente((prev) => ({ ...prev, telefono: e.target.value }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="cliente-fecha-nac">
                  Fecha de Nacimiento
                  <span className="ml-1 text-xs font-normal text-muted-foreground">
                    (opcional)
                  </span>
                </Label>
                <Input
                  id="cliente-fecha-nac"
                  type="date"
                  value={nuevoCliente.fecha_nacimiento || ""}
                  onChange={(e) =>
                    setNuevoCliente((prev) => ({ ...prev, fecha_nacimiento: e.target.value }))
                  }
                />
              </div>
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button 
              variant="outline" 
              onClick={() => {
                setShowClienteDialog(false)
                setNuevoCliente({
                  nombre: "",
                  rtn: "",
                  direccion: "",
                  telefono: "",
                  fecha_nacimiento: "",
                })
              }}
              disabled={savingCliente}
            >
              Cancelar
            </Button>
            <Button 
              onClick={handleCreateCliente} 
              disabled={savingCliente || !nuevoCliente.nombre?.trim()}
              className="gap-2"
            >
              {savingCliente ? "Guardando..." : "Crear y Seleccionar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialogo post-venta: opciones de impresion (tirilla 80 mm / factura PDF) */}
      <Dialog
        open={ventaExitosa !== null}
        onOpenChange={(o) => { if (!o) setVentaExitosa(null) }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-green-600" />
              Venta registrada
            </DialogTitle>
          </DialogHeader>

          {ventaExitosa && (
            <div className="space-y-1 rounded-md border bg-muted/40 px-4 py-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Factura</span>
                <span className="font-medium">{ventaExitosa.numeroFactura}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Total</span>
                <span className="font-semibold">L {ventaExitosa.total.toFixed(2)}</span>
              </div>
            </div>
          )}

          <p className="text-sm text-muted-foreground">
            ¿Deseas imprimir el comprobante?
          </p>

          <DialogFooter className="flex-col gap-2 sm:flex-col sm:space-x-0">
            <Button
              onClick={handleImprimirTirilla}
              disabled={imprimiendo}
              className="w-full gap-2"
            >
              <Printer className="h-4 w-4" />
              Imprimir tirilla (80 mm)
            </Button>
            <Button
              variant="outline"
              onClick={handleDescargarPdf}
              className="w-full gap-2"
            >
              <FileText className="h-4 w-4" />
              Descargar factura (PDF)
            </Button>
            <Button
              variant="ghost"
              onClick={() => setVentaExitosa(null)}
              className="w-full"
            >
              Cerrar / Nueva venta
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialogo: Venta Rapida (linea manual sin inventario) */}
      <Dialog open={ventaRapidaOpen} onOpenChange={setVentaRapidaOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Zap className="h-5 w-5 text-sky-600" /> Venta rápida
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-1">
            <p className="text-sm text-muted-foreground">
              Agrega al carrito un producto o servicio no catalogado. <strong>No afecta el inventario.</strong>
            </p>
            <div className="grid gap-2">
              <Label htmlFor="vr-desc">Descripción</Label>
              <Input
                id="vr-desc"
                value={vrDescripcion}
                onChange={(e) => setVrDescripcion(e.target.value)}
                placeholder="Ej: Reparación de máquina, flete, servicio…"
                autoFocus
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); confirmarVentaRapida() } }}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label htmlFor="vr-precio">Precio (L)</Label>
                <Input
                  id="vr-precio"
                  type="number"
                  step="0.01"
                  min="0"
                  value={vrPrecio}
                  onChange={(e) => setVrPrecio(e.target.value)}
                  placeholder="0.00"
                  className="h-10 text-base"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="vr-cant">Cantidad</Label>
                <Input
                  id="vr-cant"
                  type="number"
                  min="1"
                  step="1"
                  value={vrCantidad}
                  onChange={(e) => setVrCantidad(e.target.value)}
                  className="h-10 text-base"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setVentaRapidaOpen(false)}>Cancelar</Button>
            <Button onClick={confirmarVentaRapida} className="gap-2">
              <Plus className="h-4 w-4" /> Agregar al carrito
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  )
}
