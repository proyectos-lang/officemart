import type { ConfigReporte } from "@/lib/reporteria/motor"

/** Reportes prediseñados: punto de partida que el usuario ajusta y guarda. */
export interface PlantillaReporte {
  id: string
  nombre: string
  descripcion: string
  config: ConfigReporte
}

const p = (id: string, nombre: string, descripcion: string, config: Omit<ConfigReporte, "totales" | "filtros" | "orden"> & Partial<Pick<ConfigReporte, "filtros" | "orden">>): PlantillaReporte => ({
  id, nombre, descripcion, config: { filtros: [], orden: null, totales: true, ...config },
})

export const PLANTILLAS: PlantillaReporte[] = [
  p("ventas_mes", "Ventas por mes", "Total facturado, ISV y saldo por mes (facturas vigentes).", {
    fuente: "ventas_facturas", columnas: [], rango: { preset: "anio" },
    filtros: [{ col: "estado", op: "igual", valor: "Vigente" }],
    agrupar: [{ col: "fecha", nivel: "mes" }], medidas: [{ col: "*", fn: "conteo" }, { col: "subtotal", fn: "suma" }, { col: "impuesto", fn: "suma" }, { col: "total", fn: "suma" }, { col: "saldo", fn: "suma" }],
  }),
  p("ventas_vendedor", "Ventas por vendedor", "Facturas, total vendido y ticket promedio por vendedor.", {
    fuente: "ventas_facturas", columnas: [], rango: { preset: "ultimos_90" },
    filtros: [{ col: "estado", op: "igual", valor: "Vigente" }],
    agrupar: [{ col: "vendedor" }], medidas: [{ col: "*", fn: "conteo" }, { col: "total", fn: "suma" }, { col: "total", fn: "promedio" }],
    orden: { col: "suma__total", dir: "desc" },
  }),
  p("top_productos", "Productos más vendidos", "Cantidad, venta, costo y utilidad por producto.", {
    fuente: "ventas_productos", columnas: [], rango: { preset: "ultimos_90" },
    filtros: [{ col: "estado", op: "igual", valor: "Vigente" }],
    agrupar: [{ col: "producto" }], medidas: [{ col: "cantidad", fn: "suma" }, { col: "venta", fn: "suma" }, { col: "costo", fn: "suma" }, { col: "utilidad", fn: "suma" }],
    orden: { col: "suma__venta", dir: "desc" },
  }),
  p("utilidad_categoria", "Utilidad por categoría", "Venta, costo, utilidad y margen promedio por categoría de producto.", {
    fuente: "ventas_productos", columnas: [], rango: { preset: "ultimos_90" },
    filtros: [{ col: "estado", op: "igual", valor: "Vigente" }],
    agrupar: [{ col: "categoria" }], medidas: [{ col: "venta", fn: "suma" }, { col: "costo", fn: "suma" }, { col: "utilidad", fn: "suma" }, { col: "margen", fn: "promedio" }],
    orden: { col: "suma__utilidad", dir: "desc" },
  }),
  p("cxc_antiguedad", "Cartera por antigüedad", "Saldo por cobrar por cliente y rango de antigüedad.", {
    fuente: "ventas_cxc", columnas: [], rango: { preset: "todo" },
    agrupar: [{ col: "cliente" }, { col: "antiguedad" }], medidas: [{ col: "*", fn: "conteo" }, { col: "saldo", fn: "suma" }],
  }),
  p("compras_proveedor", "Compras por proveedor", "Órdenes, valor recibido y saldo por pagar por proveedor.", {
    fuente: "compras_oc", columnas: [], rango: { preset: "anio" },
    agrupar: [{ col: "proveedor" }], medidas: [{ col: "*", fn: "conteo" }, { col: "recibido", fn: "suma" }, { col: "pagado", fn: "suma" }, { col: "saldo", fn: "suma" }],
    orden: { col: "suma__recibido", dir: "desc" },
  }),
  p("gastos_categoria", "Gastos por categoría y mes", "Gasto mensual por categoría (nómina, arriendo, servicios…).", {
    fuente: "finanzas_gastos", columnas: [], rango: { preset: "anio" },
    agrupar: [{ col: "fecha", nivel: "mes" }, { col: "categoria" }], medidas: [{ col: "monto", fn: "suma" }],
  }),
  p("flujo_semanal", "Flujo de caja semanal", "Ingresos, egresos y neto por semana (bancos y caja).", {
    fuente: "finanzas_flujo", columnas: [], rango: { preset: "ultimos_90" },
    agrupar: [{ col: "fecha", nivel: "semana" }], medidas: [{ col: "ingreso", fn: "suma" }, { col: "egreso", fn: "suma" }, { col: "neto", fn: "suma" }],
  }),
  p("ingresos_origen", "Ingresos por origen", "De dónde entra el dinero: ventas, recibos de cobro, manuales.", {
    fuente: "finanzas_ingresos", columnas: [], rango: { preset: "ultimos_90" },
    agrupar: [{ col: "origen" }, { col: "medio" }], medidas: [{ col: "*", fn: "conteo" }, { col: "monto", fn: "suma" }],
  }),
  p("leadtime_etapa", "Lead time por etapa de producción", "Horas reales promedio y máximas por etapa, con cantidad de órdenes.", {
    fuente: "produccion_etapas", columnas: [], rango: { preset: "ultimos_30" },
    filtros: [{ col: "estado", op: "igual", valor: "Entregada" }],
    agrupar: [{ col: "etapa" }], medidas: [{ col: "*", fn: "conteo" }, { col: "horas", fn: "promedio" }, { col: "horas", fn: "max" }, { col: "desvio", fn: "promedio" }],
  }),
  p("cumplimiento_produccion", "Cumplimiento de órdenes por semana", "Órdenes terminadas por semana y semáforo de entrega.", {
    fuente: "produccion_ordenes", columnas: [], rango: { preset: "ultimos_90" },
    filtros: [{ col: "estado", op: "igual", valor: "Terminada" }],
    agrupar: [{ col: "creada", nivel: "semana" }, { col: "semaforo" }], medidas: [{ col: "*", fn: "conteo" }, { col: "lead_h", fn: "promedio" }],
  }),
  p("nomina_departamento", "Costo de nómina por departamento", "Devengado, deducciones, neto y costo empresa por departamento y mes.", {
    fuente: "rrhh_nomina", columnas: [], rango: { preset: "anio" },
    agrupar: [{ col: "periodo_hasta", nivel: "mes" }, { col: "departamento" }], medidas: [{ col: "devengado", fn: "suma" }, { col: "deducciones", fn: "suma" }, { col: "neto", fn: "suma" }, { col: "costo_empresa", fn: "suma" }],
  }),
  p("clientes_top", "Mejores clientes", "Clientes ordenados por lo comprado en el período, con saldo pendiente.", {
    fuente: "crm_clientes", columnas: ["cliente", "zona", "vendedor", "facturas", "comprado", "ticket", "ultima_compra", "saldo"], rango: { preset: "anio" },
    agrupar: [], medidas: [], filtros: [{ col: "comprado", op: "mayor", valor: "0.01" }], orden: { col: "comprado", dir: "desc" },
  }),
]
