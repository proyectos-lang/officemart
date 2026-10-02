import type { TutorialModulo } from "./types"

export const TUTORIALES_REPORTERIA: TutorialModulo[] = [
  {
    modulo: "Reportería",
    titulo: "Reportería",
    descripcion:
      "Arma reportes de cualquier sistema (ventas, compras, inventario, producción, finanzas, clientes y RRHH), elige columnas, filtra por fecha y expórtalos a Excel. Guárdalos para volver a exportarlos cuando quieras.",
    queHace: [
      "Ofrece 34 fuentes de datos agrupadas por sistema: facturas, productos vendidos, cobros, cartera, cotizaciones, devoluciones, comisiones, órdenes de compra, recepciones, pagos y CxP, existencias, kardex, materiales, órdenes y etapas de producción, corridas, estado de resultados, ingresos, egresos, flujo de caja, gastos, bancos, clientes, proveedores, oportunidades y actividades de CRM, empleados, nómina, novedades y asistencia.",
      "Filtra por período con rangos relativos (hoy, esta semana, este mes, mes anterior, trimestre, año, últimos 7/30/90 días), un rango personalizado o todo el historial. Cada fuente indica qué fecha usa (fecha de factura, de recepción, de pago…).",
      "Permite elegir qué columnas salen en el Excel y en qué orden.",
      "Filtros por cualquier columna: contiene, igual, distinto, mayor, menor, entre, está en una lista de valores, vacío o con valor.",
      "Agrega una fila de TOTAL con la suma de las columnas de monto y cantidad.",
      "Muestra el resultado en pantalla (hasta 200 filas) a todo el ancho; se actualiza al instante al cambiar columnas o filtros.",
      "Exporta a Excel (.xlsx) con una columna por campo: fechas como fechas reales de Excel, montos como números con formato, autofiltro y encabezado fijo. Una segunda hoja «Parámetros» registra fuente, período, filtros, quién lo generó y cuándo.",
      "Guarda reportes con nombre y descripción para toda la empresa; se pueden marcar como destacados, exportar desde la lista con un clic y llevan el conteo de exportaciones.",
    ],
    queNoHace: [
      "No exporta a CSV ni a PDF: siempre genera un Excel .xlsx.",
      "No modifica datos: es solo de consulta. Para corregir una venta, compra o gasto usa su módulo.",
      "No agrupa ni resume en pantalla: exporta el detalle, una fila por registro. Para totales por vendedor, mes o categoría, usa una tabla dinámica en Excel sobre el archivo exportado (las fechas y montos ya salen como valores reales).",
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
          "En «2. Columnas» marca las columnas que quieres; abajo aparecen en el orden en que saldrán en el Excel y puedes moverlas con las flechas. «Todas», «Por defecto» y «Ninguna» ayudan a empezar.",
          "En «3. Filtros» agrega condiciones si las necesitas (por ejemplo Estado igual a Vigente, o Vendedor está en Ana y Luis).",
          "Revisa la tabla de resultado al final de la pantalla y pulsa «Exportar a Excel».",
        ],
      },
      {
        titulo: "Guardar un reporte y volver a exportarlo",
        pasos: [
          "Con el reporte armado pulsa «Guardar», ponle nombre y, si quieres, márcalo como destacado.",
          "El reporte aparece en «Mis reportes», arriba de la pantalla.",
          "Para exportarlo otra vez, pulsa el ícono de descarga en la tarjeta: se recalcula con el período relativo (si guardaste «Este mes», saldrá el mes en curso).",
          "Para cambiarlo, haz clic en la tarjeta, ajusta y pulsa «Guardar»; «Guardar como» crea una copia.",
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
        pregunta: "Quiero el total por vendedor o por mes, ¿cómo lo saco?",
        respuesta:
          "Exporta el detalle con las columnas Vendedor (o Fecha) y Total, y en Excel inserta una tabla dinámica sobre la hoja «Reporte». Como las fechas salen como fechas reales, Excel las agrupa por mes o año con un clic.",
      },
      {
        pregunta: "Cambié la fecha de una venta y el reporte no la muestra",
        respuesta:
          "La tabla usa los datos que cargó al abrir el reporte o cambiar el período. Pulsa «Actualizar datos» para volver a leer la base.",
      },
      {
        pregunta: "¿Mis compañeros ven los reportes que guardo?",
        respuesta:
          "Sí, los reportes guardados son de la empresa. Si aparece el aviso de que se guardan solo en este navegador, pide al administrador que aplique el script officemart-020.",
      },
      {
        pregunta: "¿Las ventas anuladas entran en los reportes?",
        respuesta:
          "Las fuentes de ventas incluyen la columna Estado (Vigente o Anulada). Agrega el filtro Estado igual a Vigente si no quieres las anuladas.",
      },
    ],
    keywords: ["reportes", "reporte", "excel", "xlsx", "exportar", "informe", "filtros", "columnas", "descargar", "segmentacion", "guardado"],
  },
]
