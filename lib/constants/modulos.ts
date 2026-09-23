/**
 * Fuente unica de verdad para los modulos granulares del sistema.
 *
 * El campo `nombre` DEBE coincidir exactamente (case-sensitive) con la columna
 * `modulos.nombre` en la base de datos, ya que se usa como clave de los
 * permisos (`permisos_usuarios.modulo_id -> modulos.nombre`).
 *
 * Estructura:
 *   - `nombre`: clave del permiso en la DB y etiqueta visible.
 *   - `href`: ruta que se abre al hacer click (y que protege el RouteGuard).
 *   - `categoria`: grupo visual en el sidebar.
 *   - `icon`: icono (lucide-react).
 */

import {
  LayoutDashboard,
  BarChart3,
  ShoppingCart,
  History,
  FileText,
  PackageCheck,
  ClipboardList,
  PackagePlus,
  ArrowLeftRight,
  DollarSign,
  Building2,
  Users,
  Package,
  Warehouse,
  Truck,
  Landmark,
  Wallet,
  ClipboardCheck,
  PieChart,
  Undo2,
  Send,
  Scale,
  Coins,
  Calculator,
  LineChart,
  Banknote,
  Tags,
  Boxes,
  Factory,
  Gauge,
  Workflow,
  Receipt,
  UserCheck,
  MessageSquareWarning,
  ScrollText,
  MapPin,
  Route,
  PackageMinus,
  type LucideIcon,
} from "lucide-react"

export type Categoria =
  | "Dashboard"
  | "Ventas"
  | "Compras"
  | "Inventario"
  | "Produccion"
  | "Finanzas"
  | "Configuracion"

export interface ModuloGranular {
  /** Coincide exactamente con `modulos.nombre` en la DB */
  nombre: string
  /** Ruta del modulo (sirve tambien para la proteccion de rutas) */
  href: string
  /** Grupo visual en el sidebar */
  categoria: Categoria
  /** Icono lucide */
  icon: LucideIcon
  /**
   * Nombres alternativos que pueden aparecer en la DB (sinonimos abreviados).
   * Se matchean de forma exacta con `findModuloByDBName` (tolerando tildes).
   * Usalo cuando la DB guarde un nombre mas corto que no contiene todos los
   * tokens del nombre canonico (ej. DB "Historial" -> canonico "Historial Ventas").
   */
  aliases?: string[]
}

/**
 * 54 modulos granulares. Cualquier cambio aqui debe replicarse en la tabla
 * `modulos` (y viceversa). NOTA: "Listas de Precios", "Facturación CAI",
 * "Vendedores y Zonas", "Reclamos de Ventas", "Auditoría", "Puntos de
 * Facturación", "Cotizaciones", "Estado de Cuenta", "Reportes de Ventas",
 * "Trazabilidad", "Backorder" y TODOS los de la
 * categoria "Produccion" NO van en MODULOS_BASE (nacen deshabilitados por
 * empresa; el super-admin los habilita desde /plataforma).
 */
export const MODULOS: ReadonlyArray<ModuloGranular> = [
  // ── Dashboard ──────────────────────────────────────────────────────────
  { nombre: "Dashboard", href: "/dashboard", categoria: "Dashboard", icon: LayoutDashboard },

  // ── Ventas ─────────────────────────────────────────────────────────────
  { nombre: "Dashboard Ventas", href: "/ventas/dashboard", categoria: "Ventas", icon: BarChart3 },
  { nombre: "Nueva Venta", href: "/ventas/nueva", categoria: "Ventas", icon: ShoppingCart },
  {
    nombre: "Historial Ventas",
    href: "/ventas/historial",
    categoria: "Ventas",
    icon: History,
    aliases: ["Historial"],
  },
  { nombre: "Devoluciones", href: "/ventas/devoluciones", categoria: "Ventas", icon: Undo2 },
  {
    nombre: "Catalogo",
    href: "/ventas/pedidos",
    categoria: "Ventas",
    icon: Send,
    // La fila historica en la tabla `modulos` se llama 'Pedidos por Catalogo';
    // el alias mantiene validos los permisos ya otorgados con ese nombre.
    aliases: ["Pedidos por Catalogo"],
  },
  // NUEVO (no-base, officemart-003): reclamos del cliente sobre una factura,
  // con resolución (anulación / devolución / sin cambio).
  { nombre: "Reclamos de Ventas", href: "/ventas/reclamos", categoria: "Ventas", icon: MessageSquareWarning },
  // NUEVO (no-base, officemart-006): cotizaciones/presupuestos con vigencia,
  // estados y conversión a venta desde Nueva Venta.
  { nombre: "Cotizaciones", href: "/ventas/cotizaciones", categoria: "Ventas", icon: FileText },
  // NUEVO (no-base, officemart-007): estado de cuenta por cliente (saldo
  // corrido, antigüedad, PDF/Excel) y reporte dinámico de ventas por
  // punto/vendedor/zona/línea/categoría + productos sin movimiento.
  { nombre: "Estado de Cuenta", href: "/ventas/estado-cuenta", categoria: "Ventas", icon: ClipboardList },
  { nombre: "Reportes de Ventas", href: "/ventas/reportes", categoria: "Ventas", icon: BarChart3 },

  // ── Compras ────────────────────────────────────────────────────────────
  { nombre: "Orden de Compra", href: "/compras/orden", categoria: "Compras", icon: FileText },
  { nombre: "Recepcion por OC", href: "/compras/recepcion", categoria: "Compras", icon: PackageCheck },
  { nombre: "Recepcion por Factura", href: "/compras/recepcion-ia", categoria: "Compras", icon: FileText },
  { nombre: "Recalcular Recepcion", href: "/compras/recalcular", categoria: "Compras", icon: Calculator },
  // NUEVO (no-base, officemart-008): órdenes recibidas parcialmente con
  // pendiente de entrega; permite cerrar lo que no llegará.
  { nombre: "Backorder", href: "/compras/backorder", categoria: "Compras", icon: PackageMinus },

  // ── Inventario ─────────────────────────────────────────────────────────
  {
    nombre: "Historial de Transacciones",
    href: "/inventario/kardex",
    categoria: "Inventario",
    icon: ClipboardList,
  },
  {
    nombre: "Movimientos Manuales",
    href: "/inventario/ingreso",
    categoria: "Inventario",
    icon: PackagePlus,
    // La fila historica en la tabla `modulos` se llama 'Ingreso Manual'; el
    // alias mantiene validos los permisos ya otorgados con ese nombre.
    aliases: ["Ingreso Manual"],
  },
  { nombre: "Traslados", href: "/inventario/traslados", categoria: "Inventario", icon: ArrowLeftRight },
  { nombre: "Ajustes de Inventario", href: "/inventario/ajustes", categoria: "Inventario", icon: Scale },
  { nombre: "Ajuste de Costo", href: "/inventario/ajuste-costo", categoria: "Inventario", icon: Coins },
  { nombre: "Valoracion", href: "/inventario/valoracion", categoria: "Inventario", icon: DollarSign },
  // NUEVO (no-base, officemart-007): trazabilidad por producto y por orden de
  // compra (lotes FIFO: de qué OC vino cada unidad y a qué venta fue).
  { nombre: "Trazabilidad", href: "/inventario/trazabilidad", categoria: "Inventario", icon: Route },

  // ── Produccion (modulos NUEVOS, nacen deshabilitados: no estan en MODULOS_BASE) ──
  { nombre: "Operaciones de Produccion", href: "/produccion/operaciones", categoria: "Produccion", icon: Workflow },
  { nombre: "Flujo de Produccion", href: "/produccion/flujo", categoria: "Produccion", icon: ArrowLeftRight },
  { nombre: "Reporte de Flujo", href: "/produccion/reporte-flujo", categoria: "Produccion", icon: BarChart3 },
  { nombre: "Materiales", href: "/produccion/materiales", categoria: "Produccion", icon: Boxes },
  { nombre: "Compra de Materiales", href: "/produccion/compras-materiales", categoria: "Produccion", icon: Truck },
  { nombre: "Inventario de Materiales", href: "/produccion/inventario-materiales", categoria: "Produccion", icon: Warehouse },
  { nombre: "Recetas", href: "/produccion/recetas", categoria: "Produccion", icon: ClipboardList },
  { nombre: "Ordenes de Produccion", href: "/produccion/ordenes", categoria: "Produccion", icon: FileText },
  { nombre: "Control de Piso", href: "/produccion/control-piso", categoria: "Produccion", icon: Gauge },
  { nombre: "Dashboard Produccion", href: "/produccion/dashboard", categoria: "Produccion", icon: BarChart3 },
  { nombre: "Recepcion de Produccion", href: "/produccion/recepcion", categoria: "Produccion", icon: PackageCheck },

  // ── Finanzas ───────────────────────────────────────────────────────────
  { nombre: "Dashboard Finanzas", href: "/finanzas/dashboard", categoria: "Finanzas", icon: PieChart },
  { nombre: "Movimientos de Cuentas", href: "/finanzas/movimientos", categoria: "Finanzas", icon: ArrowLeftRight },
  {
    nombre: "Estado de Resultados",
    href: "/finanzas/estado-resultados",
    categoria: "Finanzas",
    icon: FileText,
  },
  { nombre: "Gastos", href: "/finanzas/gastos", categoria: "Finanzas", icon: DollarSign },
  { nombre: "Caja Chica", href: "/finanzas/caja-chica", categoria: "Finanzas", icon: Wallet },
  {
    nombre: "Cierre Diario",
    href: "/finanzas/cierre-diario",
    categoria: "Finanzas",
    icon: ClipboardCheck,
  },
  { nombre: "Analisis Financiero", href: "/finanzas/analisis", categoria: "Finanzas", icon: LineChart },
  {
    nombre: "Consolidacion Bancaria",
    href: "/finanzas/consolidacion",
    categoria: "Finanzas",
    icon: Banknote,
  },

  // ── Configuracion ──────────────────────────────────────────────────────
  { nombre: "Razon Social", href: "/configuracion/razon-social", categoria: "Configuracion", icon: Building2 },
  { nombre: "Listas de Precios", href: "/configuracion/listas-precios", categoria: "Configuracion", icon: Tags },
  { nombre: "Usuarios y Permisos", href: "/configuracion/usuarios", categoria: "Configuracion", icon: Users },
  { nombre: "Productos", href: "/configuracion/productos", categoria: "Configuracion", icon: Package },
  { nombre: "Almacenes", href: "/configuracion/almacenes", categoria: "Configuracion", icon: Warehouse },
  { nombre: "Clientes", href: "/configuracion/clientes", categoria: "Configuracion", icon: Users },
  // NUEVO (no-base, officemart-002): vendedores (para asociarlos a ventas y
  // comisiones) y zonas de clientes. Nace deshabilitado por empresa.
  { nombre: "Vendedores y Zonas", href: "/configuracion/vendedores", categoria: "Configuracion", icon: UserCheck },
  { nombre: "Proveedores", href: "/configuracion/proveedores", categoria: "Configuracion", icon: Truck },
  {
    nombre: "Cuentas Bancarias",
    href: "/configuracion/cuentas-bancarias",
    categoria: "Configuracion",
    icon: Landmark,
  },
  {
    nombre: "Preview PDFs",
    href: "/configuracion/previsualizacion-pdf",
    categoria: "Configuracion",
    icon: FileText,
  },
  // NUEVO (no-base): nace deshabilitado. Solo se ve/usa si el super-admin
  // enciende el flag `facturacion_cai` Y habilita este modulo para la empresa.
  {
    nombre: "Facturación CAI",
    href: "/configuracion/facturacion-cai",
    categoria: "Configuracion",
    icon: Receipt,
  },
  // NUEVO (no-base, officemart-004): sucursales/puntos de venta con su serie
  // de factura, almacén por defecto y CAI propio. Nace deshabilitado.
  {
    nombre: "Puntos de Facturación",
    href: "/configuracion/puntos-facturacion",
    categoria: "Configuracion",
    icon: MapPin,
  },
  // NUEVO (no-base, officemart-003): bitácora de acciones (ventas anuladas,
  // recibos, devoluciones, reclamos...) consultable por el admin.
  { nombre: "Auditoría", href: "/configuracion/auditoria", categoria: "Configuracion", icon: ScrollText },
] as const

/**
 * Snapshot CONGELADO de los modulos "base" (los que existian al 1-sep-2026).
 * Habilitados por defecto para toda empresa. Los modulos que se AGREGUEN despues
 * NO deben ponerse aqui: asi quedan DESHABILITADOS por defecto y el super-admin
 * los habilita empresa por empresa desde /plataforma. (No derivar de MODULOS: es
 * un snapshot a proposito para que los nuevos no se auto-incluyan.)
 */
export const MODULOS_BASE: ReadonlyArray<string> = [
  "Dashboard",
  "Dashboard Ventas", "Nueva Venta", "Historial Ventas", "Devoluciones", "Catalogo",
  "Orden de Compra", "Recepcion por OC", "Recepcion por Factura", "Recalcular Recepcion",
  "Historial de Transacciones", "Movimientos Manuales", "Traslados", "Ajustes de Inventario", "Ajuste de Costo", "Valoracion",
  "Dashboard Finanzas", "Movimientos de Cuentas", "Estado de Resultados", "Gastos", "Caja Chica", "Cierre Diario", "Analisis Financiero", "Consolidacion Bancaria",
  "Razon Social", "Usuarios y Permisos", "Productos", "Almacenes", "Clientes", "Proveedores", "Cuentas Bancarias", "Preview PDFs",
]
const MODULOS_BASE_SET = new Set<string>(MODULOS_BASE)

/** true = modulo base (ON por defecto). false = modulo NUEVO (OFF por defecto). */
export function moduloEsBase(nombre: string): boolean {
  return MODULOS_BASE_SET.has(nombre)
}

/**
 * ¿La empresa tiene HABILITADO este modulo (por nombre canonico)?
 *  - Base: habilitado salvo que este en `deshabilitados` (opt-out).
 *  - Nuevo: deshabilitado salvo que este en `habilitados` (opt-in).
 */
export function moduloHabilitadoParaEmpresa(
  nombre: string,
  deshabilitados: string[] | undefined | null,
  habilitados: string[] | undefined | null
): boolean {
  if (MODULOS_BASE_SET.has(nombre)) {
    return !(deshabilitados || []).includes(nombre)
  }
  return (habilitados || []).includes(nombre)
}

/** Orden fijo de categorias para el sidebar */
export const CATEGORIAS_ORDEN: ReadonlyArray<Categoria> = [
  "Dashboard",
  "Ventas",
  "Compras",
  "Inventario",
  "Produccion",
  "Finanzas",
  "Configuracion",
]

/**
 * Devuelve el modulo (si existe) que protege la ruta actual.
 * Usa prefijo con `startsWith` para que /ventas/nueva/abc tambien matchee
 * "Nueva Venta". En caso de colision (ej. /ventas/dashboard vs /ventas),
 * gana el match mas largo.
 */
export function findModuloByPath(pathname: string): ModuloGranular | null {
  let best: ModuloGranular | null = null
  for (const m of MODULOS) {
    if (pathname === m.href || pathname.startsWith(m.href + "/")) {
      if (!best || m.href.length > best.href.length) best = m
    }
  }
  return best
}

/**
 * Normaliza un nombre a tokens: lowercase, sin tildes, sin palabras vacias,
 * con un stemming basico (quita la 's' final) para que
 * "venta"/"ventas", "compra"/"compras", etc. se consideren iguales.
 *
 * Asi "Valoración" y "Valoracion" producen los mismos tokens, y
 * "Historial de Ventas" matchea contra "Historial Ventas" aunque
 * un lado use singular y el otro plural.
 */
const STOPWORDS = new Set([
  "de", "del", "la", "el", "los", "las", "y", "por", "en", "a",
])

function stem(t: string): string {
  // Stem minimo para espanol: quita 's' final solo si la palabra tiene >=4
  // chars (evita reducir palabras cortas como "mas", "tres").
  if (t.length >= 4 && t.endsWith("s")) return t.slice(0, -1)
  return t
}

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[\s_\-/.,]+/)
    .filter((t) => t.length > 0 && !STOPWORDS.has(t))
    .map(stem)
}

/**
 * Dado un nombre proveniente de la DB (columna `modulos.nombre`), encuentra
 * el ModuloGranular de constants que mejor lo representa.
 *
 * Criterio: todos los tokens del constants deben estar presentes en el nombre
 * de DB. Cuando varios candidatos califican, gana el MAS ESPECIFICO (mas
 * tokens en el nombre del constants).
 *
 * Ejemplos:
 *   - DB "Valoración"             -> constants "Valoracion"
 *   - DB "Recepción por OC"       -> constants "Recepcion por OC"
 *   - DB "Dashboard de Ventas"    -> constants "Dashboard Ventas"
 *   - DB "Dashboard"              -> constants "Dashboard"
 */
export function findModuloByDBName(dbName: string): ModuloGranular | null {
  const dbTokens = new Set(tokenize(dbName))
  if (dbTokens.size === 0) return null

  // 1) Prioridad maxima: alias exacto (mismos tokens). Esto permite que
  //    un nombre corto en la DB (ej. "Historial") se mapee a su canonico
  //    ("Historial Ventas") sin ambiguedad.
  const dbKey = [...dbTokens].sort().join("|")
  for (const m of MODULOS) {
    if (!m.aliases) continue
    for (const alias of m.aliases) {
      const aliasKey = [...new Set(tokenize(alias))].sort().join("|")
      if (aliasKey === dbKey) return m
    }
  }

  // 2) Criterio general: todos los tokens del canonico deben estar en el
  //    nombre de DB. Gana el match mas especifico (mas tokens).
  let best: ModuloGranular | null = null
  let bestScore = 0
  for (const m of MODULOS) {
    const cTokens = tokenize(m.nombre)
    if (cTokens.length === 0) continue
    const allIn = cTokens.every((t) => dbTokens.has(t))
    if (!allIn) continue
    if (cTokens.length > bestScore) {
      best = m
      bestScore = cTokens.length
    }
  }
  return best
}
