import type { TutorialModulo } from "./types"

export const TUTORIALES_FINANZAS: TutorialModulo[] = [
  {
    modulo: "Dashboard Finanzas",
    titulo: "Dashboard de Finanzas",
    descripcion:
      "Panorama financiero del negocio: saldos por cuenta, cartera por cobrar y pagar, ventas del mes, balance de bancos y flujo de caja mensual.",
    queHace: [
      "Tarjetas KPI: Ventas del Mes, Por Cobrar (CxC), Por Pagar (CxP) y Balance de Bancos (bancos + caja + CxC − CxP).",
      "Una tarjeta de saldo por cada cuenta bancaria activa, más la caja chica.",
      "Gráfico del flujo de caja real por mes: dinero efectivamente entrado vs. salido (excluye transferencias internas para no inflar cifras).",
      "Acciones rápidas: registrar una entrada/salida de dinero a una cuenta o a la caja, y transferir entre cuentas, sin salir del dashboard.",
    ],
    queNoHace: [
      "No detalla movimiento por movimiento (para eso está Movimientos de Cuentas).",
      "Las ventas al crédito no aparecen en el flujo de caja hasta que se cobran (el flujo es dinero real).",
    ],
    operaciones: [
      {
        titulo: "Registrar una entrada o salida rápida de dinero",
        pasos: [
          "Abre Finanzas → Dashboard Finanzas.",
          "Presiona el botón 'Movimiento'.",
          "Elige el destino: Caja Chica o una cuenta bancaria.",
          "Elige Entrada o Salida, escribe el monto y un concepto.",
          "Guarda: el saldo se actualiza al instante y el movimiento queda en el historial.",
        ],
      },
      {
        titulo: "Transferir dinero entre cuentas bancarias",
        pasos: [
          "Presiona el botón 'Transferencia'.",
          "Elige la cuenta origen y la cuenta destino.",
          "Escribe el monto y confirma.",
          "Se registra un egreso en la origen y un ingreso en la destino, enlazados como transferencia.",
        ],
      },
      {
        titulo: "Interpretar el Balance de Bancos",
        pasos: [
          "El Balance de Bancos = saldos de cuentas + caja chica + lo que te deben (CxC) − lo que debes (CxP).",
          "Es tu posición financiera real: cuánto tendrías si hoy cobraras y pagaras todo.",
          "Si es negativo, debes más de lo que tienes más lo que te deben: revisa CxP.",
        ],
      },
    ],
    faqs: [
      {
        pregunta: "¿Por qué la transferencia entre cuentas no aparece en el flujo de caja?",
        respuesta:
          "Porque no es dinero que entra o sale del negocio, solo cambia de bolsillo. Incluirla duplicaría entradas y salidas.",
      },
      {
        pregunta: "El saldo de una cuenta no cuadra con el banco real, ¿qué hago?",
        respuesta:
          "Revisa Movimientos de Cuentas de esa cuenta y compara contra el estado de cuenta bancario. Registra los movimientos faltantes (comisiones bancarias, intereses) con una entrada/salida manual.",
      },
    ],
    keywords: ["finanzas", "saldos", "balance", "flujo de caja", "cxc", "cxp", "transferencia", "kpi"],
  },
  {
    modulo: "Movimientos de Cuentas",
    titulo: "Movimientos de Cuentas",
    descripcion:
      "El historial de entradas y salidas de cada cuenta bancaria, con filtros por cuenta y rango de fechas, totales y export a Excel.",
    queHace: [
      "Lista todos los movimientos de tus cuentas: ventas cobradas, gastos pagados, transferencias, ajustes manuales y saldos iniciales.",
      "Filtro por cuenta específica o todas, y por rango de fechas.",
      "Tarjetas de Total Entradas, Total Salidas y Neto del período filtrado.",
      "Cada movimiento muestra fecha, cuenta, tipo, concepto, monto y el saldo resultante después del movimiento.",
      "Export a Excel del listado filtrado.",
    ],
    queNoHace: [
      "No incluye la caja chica (su historial vive en Finanzas → Caja Chica).",
      "No permite editar ni borrar movimientos: las correcciones se hacen con un movimiento contrario.",
    ],
    operaciones: [
      {
        titulo: "Revisar los movimientos de una cuenta en un período",
        pasos: [
          "Abre Finanzas → Movimientos de Cuentas.",
          "Selecciona la cuenta en el filtro (o deja 'Todas las cuentas').",
          "Define el rango Desde / Hasta.",
          "Revisa los totales y la tabla; la columna Saldo muestra el saldo después de cada movimiento.",
        ],
      },
      {
        titulo: "Conciliar contra el estado de cuenta del banco",
        pasos: [
          "Filtra la cuenta y el mes a conciliar.",
          "Exporta a Excel y compara línea por línea con el estado de cuenta del banco.",
          "Registra las diferencias (comisiones, intereses) como movimientos manuales desde el Dashboard de Finanzas.",
        ],
      },
    ],
    faqs: [
      {
        pregunta: "¿Qué significa la referencia 'venta' o 'devolucion' en un movimiento?",
        respuesta:
          "Indica el documento que originó el movimiento: una venta cobrada por banco, el reembolso de una devolución, una transferencia, etc. Sirve para rastrear el porqué de cada entrada o salida.",
      },
    ],
    keywords: ["historial banco", "extracto", "conciliar", "entradas salidas", "filtrar fechas", "excel"],
  },
  {
    modulo: "Estado de Resultados",
    titulo: "Estado de Resultados (P&L)",
    descripcion:
      "La utilidad del negocio mes a mes: ventas netas, costo de lo vendido, gastos por categoría, comisiones bancarias y utilidad neta.",
    queHace: [
      "Calcula por mes (o acumulado del año): Ventas − CMV = Utilidad Bruta; − Gastos Operativos − Comisiones Bancarias = Utilidad Neta.",
      "Las ventas son NETAS: descuentan automáticamente las devoluciones del período.",
      "Desglosa los gastos por categoría (Servicios, Publicidad, Nómina, Arriendo, etc.).",
      "Muestra márgenes bruto y neto en porcentaje.",
      "Gráficos de evolución y export del reporte a PDF.",
    ],
    queNoHace: [
      "No es flujo de caja: una venta al crédito cuenta como venta aunque no se haya cobrado (el flujo real está en Dashboard Finanzas).",
      "No incluye gastos sin registrar: si no capturas los gastos en Finanzas → Gastos, la utilidad se sobreestima.",
    ],
    operaciones: [
      {
        titulo: "Revisar la utilidad de un mes",
        pasos: [
          "Abre Finanzas → Estado de Resultados.",
          "Elige el año y el mes.",
          "Lee de arriba a abajo: Ingresos → Costos → Utilidad Bruta → Gastos → Utilidad Neta.",
          "Revisa el Margen Neto: es el porcentaje de cada lempira vendido que queda como ganancia.",
        ],
      },
      {
        titulo: "Comparar el año completo",
        pasos: [
          "Cambia a la vista Acumulado / Anual.",
          "Analiza la evolución mensual en el gráfico para detectar meses malos y estacionalidad.",
        ],
      },
    ],
    faqs: [
      {
        pregunta: "¿Qué es el CMV?",
        respuesta:
          "Costo de la Mercancía Vendida: la suma del costo promedio (al momento de la venta) de cada unidad vendida. Es lo que te costó lo que vendiste, no lo que compraste en el mes.",
      },
      {
        pregunta: "¿Por qué mis ventas aquí no cuadran con el total de facturas?",
        respuesta:
          "Este reporte muestra ventas netas: descuenta las devoluciones del período. Además excluye impuestos si así se registraron las ventas.",
      },
    ],
    keywords: ["utilidad", "ganancia", "perdidas", "pyg", "p&l", "margen", "cmv", "resultados"],
  },
  {
    modulo: "Gastos",
    titulo: "Gastos y Cuentas por Pagar",
    descripcion:
      "Registrar los gastos del negocio, controlar facturas de proveedores con vencimiento y abonarlas parcialmente.",
    queHace: [
      "Registra gastos por concepto (los conceptos tienen categoría: Servicios, Nómina, Arriendo…) con proveedor opcional.",
      "Adjunta el comprobante como imagen.",
      "Maneja cuentas por pagar: facturas con fecha de vencimiento, monto pagado acumulado y estado (Pendiente/Parcial/Pagado).",
      "Los abonos pueden salir de la caja chica (efectivo) o de una cuenta bancaria, quedando enlazados al gasto.",
      "Registro por foto de factura con IA (Registrar Gasto por Factura).",
      "Alimenta el Estado de Resultados por categoría de gasto.",
    ],
    queNoHace: [
      "No registra compras de mercancía para inventario (eso va por Compras, que afecta stock y costo). Las órdenes de compra a crédito aparecen en la pestaña Cuentas por Pagar como 'Compras a crédito' (saldo = recibido − pagos) y se abonan desde el detalle de la orden; no se crea un gasto por ellas (su costo va al P&L por el costo de ventas).",
      "No programa pagos automáticos: los abonos los registras tú.",
      "Los conceptos marcados 'fuera del estado de resultados' (p. ej. el antiguo 'Compra de mercadería') no suman en el P&L ni en el análisis de gastos.",
    ],
    operaciones: [
      {
        titulo: "Registrar un gasto pagado de inmediato",
        pasos: [
          "Abre Finanzas → Gastos y presiona Nuevo Gasto.",
          "Elige el concepto (créalo si no existe, con su categoría).",
          "Ingresa monto, fecha y método de pago; adjunta el comprobante si lo tienes.",
          "Registra el pago completo: el gasto queda Pagado y el dinero sale de caja o banco según el método.",
        ],
      },
      {
        titulo: "Registrar una factura a crédito y abonarla",
        pasos: [
          "Crea el gasto con su fecha de vencimiento y sin pago inicial (queda Pendiente).",
          "Cuando abones, abre el gasto y registra el abono indicando si sale de caja o de qué cuenta.",
          "El estado pasa a Parcial y luego a Pagado al completar el monto.",
          "La vista de Cuentas por Pagar muestra el saldo vivo y los días vencidos.",
        ],
      },
    ],
    faqs: [
      {
        pregunta: "¿La compra de mercancía va aquí o en Compras?",
        respuesta:
          "En Compras: ahí afecta inventario y costo promedio. Gastos es para todo lo demás (alquiler, luz, sueldos, publicidad…). Registrar mercancía como gasto duplicaría el costo en el Estado de Resultados.",
      },
      {
        pregunta: "¿Por qué me pide caja abierta al pagar en efectivo?",
        respuesta:
          "Todo efectivo sale de la caja chica para mantener el control. Abre la sesión en Finanzas → Caja Chica.",
      },
    ],
    keywords: ["gasto", "pagar", "proveedor", "factura", "vencimiento", "abono", "cxp", "comprobante"],
  },
  {
    modulo: "Caja Chica",
    titulo: "Caja Chica",
    descripcion:
      "El control del efectivo: abrir la caja con un saldo inicial, registrar entradas y salidas, transferir al banco y cerrar contando el dinero real.",
    queHace: [
      "Abre una sesión de caja con el efectivo inicial (solo puede haber UNA sesión abierta por empresa a la vez).",
      "Recibe automáticamente el efectivo de las ventas.",
      "Registra ingresos manuales y salidas de efectivo con su concepto.",
      "Transfiere efectivo de la caja a una cuenta bancaria (depósito), reflejándose en ambos lados.",
      "Al cerrar, cuentas el efectivo en una cuadrícula por denominación (billetes y monedas): escribes cuántos hay de cada una y el saldo real se calcula solo, luego se compara con el calculado y registra la diferencia (faltante/sobrante).",
      "Elige la fecha del cierre: por defecto es hoy, pero puedes retroceder a un día anterior para cuadrar la jornada de ayer con SU fecha (útil cuando cierras a la mañana siguiente). Fechar un cierre en un día anterior solo se permite si hay una caja abierta; si no hay caja abierta o ya está cerrada, no se puede.",
      "Historial de sesiones anteriores con sus movimientos.",
    ],
    queNoHace: [
      "No permite salidas que dejen el saldo negativo.",
      "No permite dos sesiones abiertas a la vez.",
      "Sin sesión abierta, la app bloquea ventas y pagos en efectivo.",
      "Si el administrador de la plataforma activó 'Ocultar saldo de caja', los usuarios que NO son admin no ven el saldo ni los montos (movimientos, historial ni el saldo/diferencia al cerrar): pueden operar y cerrar caja 'a ciegas'. El admin ve todo.",
    ],
    operaciones: [
      {
        titulo: "Abrir la caja del día",
        pasos: [
          "Abre Finanzas → Caja Chica.",
          "Presiona 'Abrir Caja' e ingresa el efectivo con el que inicias.",
          "Desde ese momento las ventas en efectivo entran solas a la caja.",
        ],
      },
      {
        titulo: "Registrar una salida de efectivo",
        pasos: [
          "Con la sesión abierta, presiona 'Salida'.",
          "Ingresa el monto y el concepto (ej. compra de bolsas).",
          "El saldo de caja baja y el movimiento queda en la lista.",
        ],
      },
      {
        titulo: "Depositar efectivo al banco",
        pasos: [
          "Presiona 'Transferencia a Banco'.",
          "Elige la cuenta destino y el monto.",
          "La caja baja y la cuenta bancaria sube, con ambos movimientos enlazados.",
        ],
      },
      {
        titulo: "Cerrar la caja",
        pasos: [
          "Presiona 'Cerrar Caja'.",
          "Revisa la 'Fecha del cierre': por defecto es hoy. Si estás cuadrando la jornada de ayer, retrocédela al día que corresponde (no puede ser futura); el cierre se registrará con esa fecha.",
          "En la cuadrícula de denominaciones escribe cuántos billetes/monedas hay de cada una (500, 100, 50…); el 'Total contado' se calcula solo.",
          "El sistema compara ese total contra el saldo calculado y muestra la diferencia.",
          "Confirma con 'Cerrar Caja' y revisa el cierre en el Historial de Sesiones.",
        ],
      },
    ],
    faqs: [
      {
        pregunta: "Cerré la caja con diferencia, ¿qué significa?",
        respuesta:
          "Faltante: contaste menos de lo que el sistema esperaba (posible vuelto mal dado o salida no registrada). Sobrante: contaste más. La diferencia queda registrada en la sesión para control.",
      },
      {
        pregunta: "¿Puedo tener una caja por cajero?",
        respuesta:
          "No: hay una sola sesión de caja abierta por empresa. Todos los cobros en efectivo entran a esa sesión.",
      },
      {
        pregunta: "Estoy cerrando hoy la caja de ayer y sale con la fecha de hoy, ¿cómo lo corrijo?",
        respuesta:
          "En el diálogo 'Cerrar Caja' cambia la 'Fecha del cierre' al día anterior antes de confirmar. El cierre quedará fechado en esa jornada, así que aparecerá en el reporte de Cierre Diario y en el Historial de Sesiones del día que corresponde, no en el de hoy. Solo cambia la fecha del cierre; los saldos y la diferencia no se alteran. Nota: fechar el cierre en un día anterior requiere una caja abierta; si no hay ninguna abierta, primero abre la caja.",
      },
    ],
    keywords: ["efectivo", "caja", "abrir caja", "cerrar caja", "arqueo", "deposito", "faltante", "sobrante", "denominaciones", "billetes", "monedas", "conteo", "fecha cierre", "dia anterior", "cerrar ayer", "jornada anterior"],
  },
  {
    modulo: "Cierre Diario",
    titulo: "Cierre Diario",
    descripcion:
      "El resumen de un día de operación: cuánto se vendió, cuánto entró por cada método de pago, gastos pagados y estado de la caja.",
    queHace: [
      "Resumen del día: cantidad de tickets, total vendido, ingresos en efectivo, por banco (bruto y neto), crédito otorgado y comisiones.",
      "Desglose '¿Cómo se cobró lo vendido hoy?': reparte el total vendido entre efectivo, banco (bruto menos comisiones = neto) y crédito, para que se vea que nada se pierde aunque el banco entre neto y la caja de efectivo esté en cero.",
      "Desglose por cuenta bancaria con sus movimientos del día.",
      "Productos vendidos en el día.",
      "Gastos del día y pagos a gastos (efectivo y banco).",
      "Devoluciones (notas de crédito) registradas en el día, con su factura y monto reembolsado.",
      "Detalle de la caja: sesiones y movimientos del día.",
      "Imprime el cierre en dos formatos: tirilla térmica (80 mm) o PDF A4, ambos con el nombre de la empresa.",
    ],
    queNoHace: [
      "No cierra la caja (eso se hace en Caja Chica); este módulo solo reporta.",
      "No permite modificar nada: es un reporte de consulta.",
    ],
    operaciones: [
      {
        titulo: "Hacer el corte del día",
        pasos: [
          "Abre Finanzas → Cierre Diario.",
          "Elige la fecha (por defecto, hoy).",
          "Revisa el resumen: ventas, efectivo, banco, crédito y comisiones.",
          "Expande cada cuenta bancaria para ver sus movimientos.",
          "Compara los ingresos en efectivo con el arqueo de caja antes de cerrarla.",
          "Imprime el corte con 'Tirilla (80 mm)' para la impresora térmica o 'PDF (A4)' para archivar o enviar.",
        ],
      },
    ],
    faqs: [
      {
        pregunta: "El efectivo del cierre no cuadra con mi caja, ¿qué reviso?",
        respuesta:
          "Verifica salidas de caja no registradas y ventas cobradas con método incorrecto (ej. marcada Banco cuando fue efectivo). El detalle de ingresos en efectivo del cierre lista cada movimiento con su venta.",
      },
      {
        pregunta: "Vendí bastante pero el cierre muestra el efectivo y el banco en cifras distintas al total, ¿se perdió dinero?",
        respuesta:
          "No. El total vendido es el bruto; el banco entra NETO (se le restan las comisiones de tarjeta) y el crédito no ingresa dinero el mismo día. Mira el recuadro '¿Cómo se cobró lo vendido hoy?': ahí el total vendido se reparte en efectivo + banco (bruto) − comisiones + crédito, y verás que cuadra. Si todo se cobró por tarjeta, la caja de efectivo queda casi en cero y eso es correcto.",
      },
    ],
    keywords: ["corte", "dia", "resumen diario", "cuadre", "reporte dia", "pdf", "tirilla", "termica", "imprimir cierre", "metodos de pago", "bruto neto", "comisiones tarjeta", "no cuadra", "se perdio"],
  },
  {
    modulo: "Analisis Financiero",
    titulo: "Análisis Financiero",
    descripcion:
      "Análisis integral de rentabilidad del negocio en un período: cómo se genera el valor, qué productos dan más o menos margen, dónde crecen los gastos y si los productos están bien costeados.",
    queHace: [
      "Trabaja sobre un rango de fechas libre con atajos (este mes, mes pasado, este año).",
      "Resumen / P&L: cascada de Ingresos → CMV → Utilidad bruta → Gastos operativos → Comisiones → Utilidad neta, con márgenes; netea devoluciones.",
      "Rentabilidad por producto: unidades, ingreso, utilidad y % de margen por producto, con cuadrante margen×volumen (Estrella, Vaca lechera, Nicho, Bajo desempeño) y Pareto de utilidad.",
      "Análisis de gastos: desglose por categoría, concepto y proveedor; gasto como % de ventas; y detección de incrementos anómalos (vs promedio de meses previos y vs mes anterior).",
      "Auditoría de costeo: lista de productos mal costeados (costo 0, costo ≥ precio, margen negativo) e historial de costo por producto reconstruido de compras/importaciones y ajustes.",
      "Exporta a Excel la rentabilidad por producto y los gastos.",
    ],
    queNoHace: [
      "No modifica datos: es solo lectura/análisis. Para corregir costos usa «Ajuste de Costo» o «Recalcular Recepción».",
      "No guarda una serie histórica de costo: el historial por producto se reconstruye del kardex, las compras y la bitácora de ajustes.",
      "La utilidad por producto usa precio − costo por línea (sin ISV ni descuento de factura), por lo que puede no cuadrar al centavo con la utilidad neta del P&L.",
    ],
    operaciones: [
      {
        titulo: "Saber si vendo mucho con poco margen o poco con mucho margen",
        pasos: [
          "Abre Finanzas → Análisis Financiero y elige el período.",
          "Entra a «Rentabilidad por producto».",
          "Mira el cuadrante margen×volumen: los puntos abajo-derecha (Vaca lechera) venden mucho con poco margen; arriba-izquierda (Nicho) venden poco con mucho margen; arriba-derecha (Estrella) es lo ideal.",
          "Revisa el Pareto para ver cuántos productos concentran la utilidad.",
        ],
      },
      {
        titulo: "Detectar una fuga de dinero en gastos",
        pasos: [
          "Entra a «Análisis de gastos».",
          "Observa la mayor categoría y el gasto como % de ventas.",
          "En la tabla de anomalías, las filas resaltadas superan +30% contra el promedio de meses previos o contra el mes anterior.",
        ],
      },
      {
        titulo: "Auditar el costeo de un producto",
        pasos: [
          "Entra a «Auditoría de costeo».",
          "Revisa la lista de productos mal costeados (costo en 0, costo ≥ precio o margen negativo).",
          "Abajo, busca un producto y mira su historial de costo: entradas de compra/importación (con costos fijos) y ajustes previos.",
        ],
      },
    ],
    faqs: [
      {
        pregunta: "¿Por qué la utilidad neta del P&L no coincide con la suma de utilidades por producto?",
        respuesta:
          "El P&L usa las ventas totales (con ISV y descuento) y resta gastos y comisiones; la utilidad por producto usa precio − costo por línea (sin ISV ni descuento). Sirven para fines distintos: el P&L mide el resultado del negocio; la vista por producto compara márgenes entre productos.",
      },
      {
        pregunta: "¿Cómo se marca un gasto como anómalo?",
        respuesta:
          "Se compara el gasto del mes por categoría contra el promedio de los meses previos y contra el mes anterior; si supera +30% en cualquiera de las dos, se resalta.",
      },
      {
        pregunta: "¿De dónde sale el historial de costo si no se guarda?",
        respuesta:
          "Se reconstruye combinando el kardex (entradas de compra con su costo final), el contexto del lote en compras (importación, moneda, prorrateo) y la bitácora de ajustes de costo.",
      },
    ],
    keywords: ["rentabilidad", "margen", "utilidad", "pareto", "cuadrante", "volumen", "gastos", "anomalia", "costeo", "auditoria", "pyl", "p&l", "fuga", "analisis"],
  },
  {
    modulo: "Consolidacion Bancaria",
    titulo: "Consolidación Bancaria",
    descripcion:
      "La consolidación de tus bancos día por día en un mes: por cada cuenta el saldo inicial, entradas, salidas y saldo final de cada día, más el total consolidado de todos los bancos. El admin puede fijar manualmente el saldo con el que arranca el mes.",
    queHace: [
      "Eliges un mes y ves, día por día, el saldo corriente de cada cuenta bancaria (saldo inicial → entradas − salidas → saldo final).",
      "Pestaña 'Consolidado' con el total de todos los bancos por día, más una pestaña por cada cuenta.",
      "Indicadores del mes: saldo inicial total, entradas, salidas y saldo final consolidado.",
      "El saldo inicial del mes se calcula solo (neto de todos los movimientos anteriores al mes); si no cuadra, el admin lo fija a mano por cuenta.",
      "Export a Excel de la consolidación.",
    ],
    queNoHace: [
      "No incluye la caja chica (efectivo): consolida solo las cuentas bancarias. Para el efectivo usa Caja Chica.",
      "No crea movimientos: la consolidación se calcula desde los movimientos que ya existen en cada cuenta.",
      "El saldo inicial manual es por cuenta y por mes; no se propaga a otros meses.",
    ],
    operaciones: [
      {
        titulo: "Ver la consolidación de un mes",
        pasos: [
          "Abre Finanzas → Consolidación Bancaria.",
          "Elige el mes en el selector (por defecto el mes actual).",
          "Revisa la pestaña 'Consolidado' para el total de todos los bancos, o abre la pestaña de una cuenta para su detalle diario.",
          "La columna 'Saldo final' de cada día es el 'Saldo inicial' del día siguiente.",
        ],
      },
      {
        titulo: "Fijar manualmente el saldo de inicio del mes (solo admin)",
        pasos: [
          "Abre la pestaña de la cuenta que quieres ajustar.",
          "Presiona 'Editar saldo inicial'.",
          "El sistema te muestra el saldo calculado como referencia; escribe el saldo real con el que arranca el mes (ej. el del estado de cuenta del banco al día 1).",
          "Guarda: toda la consolidación del mes se recalcula desde ese saldo, y la cuenta queda marcada como 'Manual'.",
          "Para volver al cálculo automático, usa 'Usar saldo calculado'.",
        ],
      },
    ],
    faqs: [
      {
        pregunta: "¿Cuándo debo fijar el saldo inicial a mano?",
        respuesta:
          "Cuando el sistema no tiene el historial completo de movimientos previos y el saldo inicial calculado arranca en un valor incorrecto. Fijándolo al saldo real del banco al inicio del mes, el resto de los días cuadra solo.",
      },
      {
        pregunta: "¿Por qué el saldo final de un día es el inicial del siguiente?",
        respuesta:
          "Porque es un saldo corriente: cada día parte de donde cerró el anterior y le suma las entradas y le resta las salidas de ese día.",
      },
      {
        pregunta: "¿El saldo inicial manual afecta otros meses o la caja chica?",
        respuesta:
          "No. El override es solo para esa cuenta y ese mes, y la consolidación no toca la caja chica (efectivo), solo las cuentas bancarias.",
      },
    ],
    keywords: ["consolidacion", "bancaria", "bancos", "saldo diario", "dia por dia", "saldo inicial", "conciliacion", "cuentas", "flujo bancario", "excel"],
  },
]
