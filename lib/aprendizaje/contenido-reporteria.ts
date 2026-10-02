import type { TutorialModulo } from "./types"

export const TUTORIALES_REPORTERIA: TutorialModulo[] = [
  {
    modulo: "Reportería",
    titulo: "Reportería",
    descripcion:
      "Arma reportes de cualquier sistema (ventas, compras, inventario, producción, finanzas, clientes y RRHH), elige columnas, filtra, agrupa y expórtalos a Excel. Guárdalos para volver a exportarlos cuando quieras.",
    queHace: [
      "Ofrece 34 fuentes de datos agrupadas por sistema: facturas, productos vendidos, cobros, cartera, cotizaciones, devoluciones, comisiones, órdenes de compra, recepciones, pagos y CxP, existencias, kardex, materiales, órdenes y etapas de producción, corridas, estado de resultados, ingresos, egresos, flujo de caja, gastos, bancos, clientes, proveedores, oportunidades y actividades de CRM, empleados, nómina, novedades y asistencia.",
      "Filtra por período con rangos relativos (hoy, esta semana, este mes, mes anterior, trimestre, año, últimos 7/30/90 días), un rango personalizado o todo el historial. Cada fuente indica qué fecha usa (fecha de factura, de recepción, de pago…).",
      "Permite elegir qué columnas salen en el Excel y en qué orden.",
      "Filtros por cualquier columna: contiene, igual, distinto, mayor, menor, entre, está en una lista de valores, vacío o con valor.",
      "Agrupa hasta en 3 niveles (por ejemplo mes → vendedor → cliente); las fechas se agrupan por día, semana, mes, trimestre o año. Por grupo calcula suma, promedio, conteo, conteo de distintos, mínimo o máximo.",
      "Ordena por cualquier columna o medida y agrega una fila de TOTAL.",
      "Muestra una vista previa (hasta 200 filas) que se actualiza al instante al cambiar columnas, filtros o agrupación.",
      "Exporta a Excel (.xlsx) con una columna por campo: fechas como fechas reales de Excel, montos como números con formato, autofiltro y encabezado fijo. Una segunda hoja «Parámetros» registra fuente, período, filtros, agrupación, quién lo generó y cuándo.",
      "Guarda reportes con nombre y descripción para toda la empresa; se pueden marcar como destacados, exportar desde la lista con un clic y llevan el conteo de exportaciones.",
      "Incluye 13 plantillas listas (ventas por mes, por vendedor, productos más vendidos, utilidad por categoría, cartera por antigüedad, compras por proveedor, gastos por categoría, flujo semanal, ingresos por origen, lead time por etapa, cumplimiento de producción, costo de nómina por departamento, mejores clientes).",
    ],
    queNoHace: [
      "No exporta a CSV ni a PDF: siempre genera un Excel .xlsx.",
      "No modifica datos: es solo de consulta. Para corregir una venta, compra o gasto usa su módulo.",
      "No combina dos fuentes en un mismo reporte (por ejemplo ventas y gastos en una sola tabla). Usa el Estado de resultados o el Flujo de caja, que ya cruzan esa información, o exporta dos reportes.",
      "Las fuentes que son una foto del momento (existencias, cartera, cuentas por pagar, empleados, clientes, proveedores) no usan período: muestran el estado actual.",
      "No programa envíos automáticos por correo: el reporte se exporta cuando alguien lo pide.",
      "Si la base aún no tiene la tabla de reportes guardados (script officemart-020), los reportes se guardan solo en tu navegador y no los ven tus compañeros.",
    ],
    operaciones: [
      {
        titulo: "Armar y exportar un reporte nuevo",
        pasos: [
          "Entra a Reportería y, en «1. Datos y período», elige la fuente (están agrupadas por sistema).",
          "Elige el período: un rango relativo como «Este mes» o «Personalizado» con fechas desde y hasta.",
          "En «2. Columnas» marca las columnas que quieres y ordénalas con las flechas; «Todas», «Por defecto» y «Ninguna» ayudan a empezar.",
          "En «3. Filtros» agrega condiciones si las necesitas (por ejemplo Estado igual a Vigente, o Vendedor está en Ana y Luis).",
          "Revisa la vista previa y pulsa «Exportar a Excel».",
        ],
      },
      {
        titulo: "Agrupar y resumir (tabla dinámica)",
        pasos: [
          "En «4. Agrupar, resumir y ordenar» pulsa «+ Nivel» y elige la columna (por ejemplo Fecha → Mes).",
          "Agrega más niveles si quieres (por ejemplo Vendedor) hasta un máximo de 3.",
          "En «Medidas por grupo» elige qué calcular: Registros, Suma de Total, Promedio de Margen, etc.",
          "Ordena por una medida (por ejemplo Suma de Total, mayor a menor) y deja marcada la fila de totales.",
          "Exporta: el Excel trae una fila por grupo con sus medidas y el total al final.",
        ],
      },
      {
        titulo: "Guardar un reporte y volver a exportarlo",
        pasos: [
          "Con el reporte armado pulsa «Guardar», ponle nombre y, si quieres, márcalo como destacado.",
          "El reporte aparece en «Mis reportes» a la izquierda.",
          "Para exportarlo otra vez, pulsa el ícono de descarga en la lista: se recalcula con el período relativo (si guardaste «Este mes», saldrá el mes en curso).",
          "Para cambiarlo, haz clic en él, ajusta y pulsa «Guardar»; «Guardar como» crea una copia.",
        ],
      },
      {
        titulo: "Partir de una plantilla",
        pasos: [
          "En el panel «Plantillas» elige una, por ejemplo «Ventas por vendedor».",
          "Ajusta el período, los filtros o las medidas.",
          "Expórtala directamente o pulsa «Guardar» para tenerla en «Mis reportes».",
        ],
      },
    ],
    faqs: [
      {
        pregunta: "¿Por qué en Excel las fechas se pueden filtrar y sumar?",
        respuesta:
          "Porque se exportan como fechas y números reales de Excel, no como texto. Puedes usar autofiltro, tablas dinámicas y fórmulas directamente.",
      },
      {
        pregunta: "Agrupé y las columnas que elegí ya no salen, ¿es un error?",
        respuesta:
          "No. Con agrupación el reporte muestra los niveles de agrupación y las medidas. Si quieres el detalle con tus columnas, quita los niveles de agrupación.",
      },
      {
        pregunta: "¿El promedio del TOTAL es el promedio de los grupos?",
        respuesta:
          "No: se calcula sobre todos los registros del reporte, que es el promedio correcto ponderado.",
      },
      {
        pregunta: "Cambié la fecha de una venta y el reporte no la muestra",
        respuesta:
          "La vista previa usa los datos que cargó al abrir el reporte o cambiar el período. Pulsa «Actualizar datos» para volver a leer la base.",
      },
      {
        pregunta: "¿Mis compañeros ven los reportes que guardo?",
        respuesta:
          "Sí, los reportes guardados son de la empresa. Si aparece el aviso de que se guardan solo en este navegador, pide al administrador que aplique el script officemart-020.",
      },
      {
        pregunta: "¿Las ventas anuladas entran en los reportes?",
        respuesta:
          "Las fuentes de ventas incluyen la columna Estado (Vigente o Anulada). Las plantillas ya filtran Estado igual a Vigente; agrega ese filtro en tus reportes si no quieres las anuladas.",
      },
    ],
    keywords: ["reportes", "reporte", "excel", "xlsx", "exportar", "informe", "tabla dinamica", "agrupar", "filtros", "columnas", "plantillas", "descargar", "segmentacion"],
  },
]
