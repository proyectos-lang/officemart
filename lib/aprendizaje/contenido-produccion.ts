import type { TutorialModulo } from "./types"

/**
 * Tutoriales del módulo PRODUCCIÓN (Fase 1: Materiales). Cada `modulo` debe
 * calzar EXACTO con el nombre en `lib/constants/modulos.ts`. Al agregar más
 * módulos de producción (recetas, órdenes, etc.), agrega aquí su TutorialModulo.
 */
export const TUTORIALES_PRODUCCION: TutorialModulo[] = [
  {
    modulo: "Operaciones de Produccion",
    titulo: "Operaciones de Producción",
    descripcion:
      "Define la secuencia de operaciones (etapas) de tu producción — cada empresa arma su propio flujo (Operación 1 → 2 → 3…) que luego recorrerán las órdenes.",
    queHace: [
      "Cada empresa crea su propia lista de operaciones/etapas: diseño, impresión, confección, empaque… las que necesites.",
      "Las operaciones tienen un ORDEN (secuencia): así se define por dónde empieza y termina el trabajo de cada orden de producción.",
      "Reordena las etapas con las flechas de cada fila (subir/bajar).",
      "Puedes desactivar una operación sin borrarla: las inactivas no se usan en las órdenes nuevas.",
      "Tiempo estándar (horas laborales): duración normal de la etapa sin esperas. Con él se planean las fechas de cada etapa de las órdenes (Mastertracking). Si no lo defines se usa un valor por defecto según el nombre (Diseño 3 h, Impresión 2.5 h, Corte 2 h, Entrega 4 h, otras 4 h).",
    ],
    queNoHace: [
      "No procesa producción por sí solo: aquí solo defines el flujo. El avance de cada orden por sus etapas se hace en la vista de flujo/órdenes.",
      "Cambiar la secuencia no altera las órdenes ya creadas: cada orden congela su secuencia al crearse (los cambios aplican a órdenes nuevas).",
    ],
    operaciones: [
      {
        titulo: "Crear tu secuencia de operaciones",
        pasos: [
          "Abre Producción → Operaciones de Producción.",
          "Presiona 'Nueva operación' y escribe su nombre (ej. 'Diseño') y una descripción opcional.",
          "Repite para cada etapa de tu flujo (Impresión, Confección, Empaque…).",
          "Usa las flechas de cada fila para dejarlas en el orden en que se trabajan.",
        ],
      },
    ],
    faqs: [
      {
        pregunta: "¿No me aparece el módulo?",
        respuesta:
          "Producción se habilita por empresa desde el panel de administración (super-admin). Si no lo ves, pídele a tu administrador que active 'Operaciones de Producción' para tu empresa.",
      },
      {
        pregunta: "¿Cada empresa puede tener un número distinto de operaciones?",
        respuesta:
          "Sí. Una empresa puede tener 2 operaciones, otra 4, otra 3. Cada quien define su propia secuencia según su proceso.",
      },
    ],
    keywords: ["operaciones", "etapas", "secuencia", "flujo", "proceso", "produccion", "estaciones", "workflow", "ruteo", "diseno", "impresion", "confeccion", "empaque"],
  },
  {
    modulo: "Flujo de Produccion",
    titulo: "Flujo de Producción",
    descripcion:
      "El tablero donde cada orden recorre tus operaciones etapa por etapa: recibir → trabajar → entregar a la siguiente, hasta completar el proceso.",
    queHace: [
      "Inicia el flujo de una orden: genera sus etapas con tu secuencia de operaciones vigente (se CONGELA en ese momento; cambios posteriores no afectan órdenes ya iniciadas).",
      "Muestra en qué etapa va cada orden y el avance (etapas entregadas / total).",
      "En cada etapa registras: responsable, fecha de recepción, cantidad procesada y notas.",
      "'Recibir' marca que el trabajo llegó a esa etapa; 'Iniciar' la pone En Proceso; 'Entregar' la cierra y deja la siguiente lista para recibir automáticamente.",
      "La primera etapa queda lista para trabajar apenas inicias el flujo.",
      "Vista 'Tablero': una columna por operación con las órdenes que están en esa etapa (tarjetas con cliente, responsable, días en la etapa y semáforo: verde al día, ámbar 3+ días, rojo fecha compromiso vencida); la última columna son las terminadas. La vista 'Lista' es el acordeón por orden.",
      "'Consumo' en la etapa activa (o 'Consumo general de la orden'): declara materiales y/o productos usados (pestañas Material / Producto; el producto pide almacén y localización). Valida stock, descuenta del inventario al costo promedio, deja kardex ('Salida Produccion' con la OP/OT) y suma al costo real de la orden. Un consumo se puede anular (vuelve el stock).",
      "Al entregar una etapa puedes declarar la mano de obra (L) de esa etapa; también suma al costo real.",
    ],
    queNoHace: [
      "Las corridas del Control de Piso siguen siendo la forma de producir un producto con receta; el consumo por etapa es para lo que la receta no cubre y para las órdenes de trabajo.",
      "No inicia el flujo solo: debes presionar 'Iniciar flujo' en la orden (y tener operaciones definidas). Las OT generan sus etapas al crearse con las operaciones elegidas.",
    ],
    operaciones: [
      {
        titulo: "Iniciar el flujo de una orden",
        pasos: [
          "Abre Producción → Flujo de Producción.",
          "En 'Iniciar flujo', busca la orden y presiona 'Iniciar flujo': se generan sus etapas según tu secuencia de operaciones.",
          "La orden aparece en 'Órdenes en flujo' con su primera etapa lista.",
        ],
      },
      {
        titulo: "Avanzar una orden por sus etapas",
        pasos: [
          "Despliega la orden en 'Órdenes en flujo'.",
          "En la etapa actual, presiona 'Entregar' cuando termines: registra responsable, cantidad y notas.",
          "Al entregar, la siguiente etapa queda 'Recibida' (lista para trabajar) automáticamente.",
          "Cuando entregues la última etapa, el flujo queda 'Completado' y la orden se cierra automáticamente.",
        ],
      },
    ],
    faqs: [
      {
        pregunta: "Cambié mis operaciones, ¿se actualizan las órdenes que ya están en flujo?",
        respuesta:
          "No. Cada orden congela su secuencia al iniciar el flujo. Los cambios en Operaciones de Producción solo aplican a las órdenes cuyo flujo inicies después.",
      },
      {
        pregunta: "No puedo iniciar el flujo de una orden.",
        respuesta:
          "Necesitas tener operaciones definidas en Producción → Operaciones de Producción, y que la orden esté Abierta o En Proceso.",
      },
    ],
    keywords: ["flujo", "etapas", "recepcion", "entrega", "avance", "tablero", "operaciones", "produccion", "recorrido", "estaciones", "wip", "proceso"],
  },
  {
    modulo: "Reporte de Flujo",
    titulo: "Reporte de Flujo",
    descripcion:
      "Los indicadores del flujo por etapas: lead time de punta a punta, cumplimiento de la fecha comprometida, cuánto tarda cada operación, cuánta carga tiene cada una y qué órdenes están trabadas (cuellos de botella).",
    queHace: [
      "Lead time: órdenes terminadas en el rango, lead time promedio y P90 (de la primera recepción a la última entrega), entregas a tiempo frente a la fecha comprometida y órdenes en piso (WIP).",
      "Tendencia semanal: órdenes terminadas, lead time promedio y % a tiempo por semana, para ver si el piso mejora o se atrasa.",
      "Tiempo por operación: promedio (y máximo) que tarda cada etapa desde que se recibe hasta que se entrega, en el rango de fechas elegido. Incluye la espera en cola, porque la etapa se recibe cuando la anterior entrega.",
      "Carga actual por operación: cuántas órdenes están AHORA en cada etapa (etapas no entregadas).",
      "Etapas en curso: lista de etapas recibidas/en proceso sin entregar, ordenadas por antigüedad — para ver dónde se atasca el trabajo.",
      "El rango de fechas afecta los tiempos por operación; la carga y las etapas en curso son del estado actual.",
    ],
    queNoHace: [
      "No mueve órdenes ni etapas: es solo un reporte de consulta (el avance se hace en Flujo de Producción).",
      "No calcula costos: eso es del Control de Piso y el Dashboard de Producción.",
    ],
    operaciones: [
      {
        titulo: "Analizar el flujo",
        pasos: [
          "Abre Producción → Reporte de Flujo.",
          "Elige el rango de fechas y presiona 'Consultar'.",
          "Mira el tiempo por operación para ver cuál etapa tarda más, la carga por operación para ver dónde se acumulan órdenes, y las etapas en curso para detectar las que llevan más tiempo sin avanzar (en rojo si pasan de un día).",
        ],
      },
    ],
    faqs: [
      {
        pregunta: "¿Cómo se calcula el lead time y el % a tiempo?",
        respuesta:
          "Para cada orden con todas sus etapas entregadas: desde la primera recepción hasta la última entrega, en horas de reloj (incluye noches y fines de semana). Es «a tiempo» si la última entrega cae en o antes de la fecha comprometida de la orden; las órdenes sin fecha no cuentan para el %. El rango filtra por el día de la última entrega.",
      },
      {
        pregunta: "¿Por qué una operación no aparece en 'tiempo por operación'?",
        respuesta:
          "Solo aparecen operaciones con al menos una etapa ENTREGADA en el rango (necesita recepción y entrega para medir el tiempo). Las que aún no se entregan salen en 'carga' y 'etapas en curso'.",
      },
    ],
    keywords: ["reporte", "flujo", "tiempos", "cuello de botella", "carga", "operaciones", "etapas", "produccion", "atascada", "trabada", "indicadores", "lead time", "tiempo de entrega", "cumplimiento", "a tiempo", "wip", "trabajo en proceso", "control de piso"],
  },
  {
    modulo: "Mastertracking",
    titulo: "Mastertracking (seguimiento de órdenes)",
    descripcion:
      "Cada orden de producción o de trabajo con su recorrido por etapas: fechas planeadas contra reales, etapa actual, lead time, atraso contra la fecha comprometida y semáforo, en tabla o en línea de tiempo.",
    queHace: [
      "Planeación: a cada etapa se le asigna un inicio y fin planeado encadenando los tiempos estándar de las operaciones (horas laborales: L–V 8–17, sábado 8–12) desde que entra la orden. Las órdenes nuevas se planean solas; «Generar planeación» planea las que aún no tienen plan.",
      "Tabla: código, cliente y trabajo, creación, compromiso, recorrido por etapas (gris pendiente, ámbar recibida, azul en proceso, verde entregada), etapa actual, lead time y semáforo. Al desplegar la fila se ven plan y real de cada etapa, responsable, horas reales y desvío contra el plan.",
      "Línea de tiempo: barra planeada (contorno) y real (sólida) por etapa, línea roja de «ahora» y bandera de la fecha comprometida; ventanas de 1 a 6 semanas.",
      "Semáforo: rojo si la fecha comprometida ya pasó o se entregó tarde; ámbar si vence hoy o lo que falta (según estándares) no alcanza; verde si va o llegó a tiempo; gris sin fecha.",
      "Filtros: búsqueda, estado (en piso, terminadas, sin flujo), etapa actual, semáforo, cliente, tipo (OT/OP), solo urgentes y rango de creación. Exporta a Excel una fila por orden y etapa.",
    ],
    queNoHace: [
      "No mueve etapas: el avance se registra en Flujo de Producción.",
      "No replanifica por capacidad: el plan asume que cada etapa empieza al terminar la anterior, sin colas; la diferencia con lo real muestra la espera.",
    ],
    operaciones: [
      { titulo: "Revisar el piso cada mañana", pasos: ["Producción → Mastertracking con el filtro «En piso».", "Filtra el semáforo «Atrasadas» y luego «En riesgo» para priorizar.", "Despliega una orden para ver en qué etapa se atrasó contra el plan y quién la tiene."] },
      { titulo: "Ajustar la planeación", pasos: ["Define el tiempo estándar de cada operación en Operaciones de Producción.", "Vuelve a Mastertracking y usa «Generar planeación» para las órdenes sin plan."] },
    ],
    faqs: [
      { pregunta: "¿Qué significa el asterisco en el plan?", respuesta: "Que el plan se calculó al vuelo porque aún no está guardado como línea base (falta aplicar el script officemart-019 o generar la planeación)." },
      { pregunta: "¿Lead time en horas de reloj o laborales?", respuesta: "De reloj (incluye noches y fines de semana), desde que entra la orden hasta la última entrega o hasta ahora si sigue en piso. El plan usa horas laborales." },
    ],
    keywords: ["mastertracking", "seguimiento de ordenes", "tracking", "gantt", "linea de tiempo", "planeacion", "plan vs real", "atraso", "semaforo", "etapa actual", "fecha comprometida", "lead time"],
  },
  {
    modulo: "Materiales",
    titulo: "Materiales de fabricación",
    descripcion:
      "El catálogo de materia prima para fabricar: nombre, unidad de medida, costo promedio y stock. Es la base del módulo de Producción.",
    queHace: [
      "Crea y edita materiales con su unidad de medida (kg, m, unidad, caja… texto libre con sugerencias).",
      "Al crear un material puedes ingresar su CARGA INICIAL: stock inicial y costo promedio. Si pones stock, eliges almacén y localización y se registra un movimiento 'Carga Inicial' en el kardex del material.",
      "Carga masiva por Excel: descarga la plantilla (Nombre, Código, Unidad, Stock Inicial, Costo Promedio), llénala y súbela para crear muchos materiales de una vez (con su stock inicial).",
      "Muestra el costo promedio y el stock de cada material, que luego se actualizan con las compras de material.",
      "Al EDITAR un material puedes ajustar su costo promedio a mano: escribes el nuevo valor y se registra un movimiento 'Ajuste de Costo' en el kardex del material (deja rastro; no mueve stock).",
      "Es un catálogo SEPARADO de los productos que vendes: la materia prima no aparece en el punto de venta.",
    ],
    queNoHace: [
      "Al EDITAR un material NO se cambia el stock a mano: eso se mueve con la carga inicial (al crear), las compras o el consumo en producción. El costo promedio SÍ es editable (ajuste manual).",
      "No se vende: los materiales no aparecen en Nueva Venta ni en el catálogo de productos.",
    ],
    operaciones: [
      {
        titulo: "Crear un material (con carga inicial opcional)",
        pasos: [
          "Abre Producción → Materiales y presiona 'Nuevo material'.",
          "Escribe el nombre (ej. 'Tela algodón'), un código opcional y la unidad de medida.",
          "Si ya tienes existencias, en 'Carga inicial' pon el stock inicial y el costo promedio, y elige almacén y localización.",
          "Guarda. Si dejas el stock en 0, el material se crea sin existencias (las cargas después con una compra).",
        ],
      },
      {
        titulo: "Ajustar el costo promedio de un material",
        pasos: [
          "En Producción → Materiales, presiona el ícono de editar del material.",
          "Cambia el campo 'Costo promedio' al valor correcto.",
          "Guarda: el nuevo costo queda vigente y se registra un movimiento 'Ajuste de Costo' en el kardex (no cambia el stock).",
        ],
      },
      {
        titulo: "Cargar muchos materiales por Excel",
        pasos: [
          "Presiona 'Plantilla' para descargar el Excel de ejemplo.",
          "Llena una fila por material: Nombre, Código, Unidad, Stock Inicial y Costo Promedio.",
          "Presiona 'Importar Excel', sube el archivo. Si hay materiales con stock inicial, elige el almacén y la localización (aplican a toda la carga).",
          "Confirma: se crean los materiales y se registra la carga inicial de los que traigan stock.",
        ],
      },
    ],
    faqs: [
      {
        pregunta: "¿No me aparece el módulo de Producción?",
        respuesta:
          "El módulo de Producción se habilita por empresa desde el panel de administración (super-admin). Si no lo ves, pídele a tu administrador que lo active para tu empresa.",
      },
      {
        pregunta: "¿Cómo cargo el stock de un material?",
        respuesta:
          "Dos formas: (1) al CREARLO, en 'Carga inicial' pones stock y costo y eliges almacén/localización; o por Excel con la columna Stock Inicial. (2) Después, con Producción → Compra de Materiales: registras la compra y la recibes.",
      },
      {
        pregunta: "En la importación por Excel, ¿por qué me pide almacén y localización?",
        respuesta:
          "Solo cuando hay materiales con Stock Inicial mayor a 0: la carga inicial debe entrar a una ubicación para que el kardex y el stock por localización queden bien. Los materiales con stock 0 se crean sin pedir ubicación.",
      },
    ],
    keywords: ["material", "materia prima", "insumo", "produccion", "fabricacion", "unidad de medida", "kg", "metro", "carga inicial", "stock inicial", "costo promedio", "editar costo", "ajuste de costo", "ajustar costo", "importar", "excel", "plantilla", "carga masiva"],
  },
  {
    modulo: "Compra de Materiales",
    titulo: "Compra de Materiales",
    descripcion:
      "Comprar materia prima a un proveedor y recibirla para cargar su inventario y costo, con prorrateo de costos de importación.",
    queHace: [
      "Registra una compra de material: proveedor, moneda (LPS/USD con tasa), líneas de material con cantidad y costo, y costos extra (importación, impuestos, otros).",
      "Prorratea los costos extra entre las líneas en proporción a su valor y calcula el costo final por material.",
      "Forma de pago: 'Contado' deja la compra como pagada; 'Crédito' deja saldo por pagar (con fecha de vencimiento opcional). Desde la lista registras abonos y el sistema lleva el saldo (Pendiente/Parcial/Pagado).",
      "Al RECIBIR la compra, suma el stock del material en el almacén/localización elegidos y recalcula su costo promedio ponderado.",
    ],
    queNoHace: [
      "No mueve inventario hasta que recibes la compra: una compra 'Pendiente' aún no cargó stock. Crear y recibir son DOS pasos.",
      "Los abonos son control de saldo: NO descuentan de caja ni banco automáticamente (eso se maneja aparte en Finanzas).",
      "No permite recibir dos veces la misma compra (evita duplicar stock).",
    ],
    operaciones: [
      {
        titulo: "Comprar y recibir material",
        pasos: [
          "Abre Producción → Compra de Materiales y presiona 'Nueva compra'.",
          "Elige el proveedor (opcional) y la moneda; en USD indica la tasa de cambio.",
          "Agrega una línea por material con su cantidad y costo unitario; ingresa los costos extra si aplica (se prorratean solos).",
          "Elige la forma de pago: Contado (queda pagada) o Crédito (indica el vencimiento; quedará saldo).",
          "Guarda: la compra queda 'Pendiente' de recepción. Verás el total con el prorrateo aplicado.",
          "Presiona 'Recibir', elige almacén y localización y confirma: el material entra al inventario y se actualiza su costo promedio.",
        ],
      },
      {
        titulo: "Registrar el pago de una compra a crédito",
        pasos: [
          "En la lista, la columna 'Pago' muestra la forma de pago, el estado (Pendiente/Parcial/Pagado) y el saldo.",
          "En una compra con saldo, presiona 'Pagar'.",
          "Ingresa el monto (puede ser parcial), el método (informativo) y una nota opcional; confirma.",
          "El saldo baja y el estado cambia a Parcial o Pagado. Puedes ver los abonos registrados en el mismo diálogo.",
        ],
      },
    ],
    faqs: [
      {
        pregunta: "¿Por qué el costo final del material es distinto al que puse?",
        respuesta:
          "Porque los costos extra (importación, impuestos, otros) se reparten entre los materiales según su valor. El costo final que entra al inventario incluye esa parte prorrateada.",
      },
      {
        pregunta: "Creé la compra pero no aparece como recibida / no cargó el stock.",
        respuesta:
          "Crear y recibir son dos pasos. Al crearla queda 'Pendiente' y todavía NO carga inventario. Para eso presiona el botón 'Recibir' en su fila, elige almacén y localización y confirma. Ahí entra el stock y se actualiza el costo promedio.",
      },
      {
        pregunta: "Marqué la compra a crédito, ¿dónde registro los pagos?",
        respuesta:
          "En la lista de compras, en la fila de esa compra, presiona 'Pagar' y registra el abono (total o parcial). El sistema lleva el saldo y el estado. Nota: es control de saldo, no mueve caja/banco automáticamente.",
      },
    ],
    keywords: ["compra material", "proveedor", "recepcion", "prorrateo", "importacion", "costo material", "produccion", "contado", "credito", "pago", "abono", "saldo", "recibir"],
  },
  {
    modulo: "Inventario de Materiales",
    titulo: "Inventario de Materiales",
    descripcion:
      "La valoración de tu materia prima (stock, costo y valor) y el kardex de movimientos de cada material.",
    queHace: [
      "Lista cada material con su stock, costo promedio y valor total (stock × costo).",
      "Muestra el valor total del inventario de materiales.",
      "Kardex por material: todos sus movimientos (entradas por compra, consumos de producción, ajustes) con fecha, cantidad y costo.",
      "Exporta la valoración a Excel.",
    ],
    queNoHace: [
      "No edita el stock ni el costo directamente: son el resultado de las compras y (más adelante) los consumos de producción.",
    ],
    operaciones: [
      {
        titulo: "Ver la valoración y el kardex de un material",
        pasos: [
          "Abre Producción → Inventario de Materiales.",
          "Busca el material por nombre o código; ves su stock, costo promedio y valor.",
          "Presiona el ícono de historial para ver su kardex (movimientos cronológicos).",
          "Usa 'Exportar' para descargar la valoración completa en Excel.",
        ],
      },
    ],
    faqs: [
      {
        pregunta: "¿El valor del inventario de materiales suma al de los productos?",
        respuesta:
          "No. Los materiales tienen su inventario y valoración propios, separados del inventario de productos terminados (Inventario → Valoración).",
      },
    ],
    keywords: ["inventario material", "valoracion", "kardex", "stock material", "costo promedio", "produccion", "exportar"],
  },
  {
    modulo: "Recetas",
    titulo: "Recetas (MRP)",
    descripcion:
      "La receta de cada producto fabricado: qué materiales consume por unidad y sus factores de costo (energía, mano de obra, overhead). Calcula el costo estimado del artículo.",
    queHace: [
      "Dos pestañas: 'Productos fabricados' (tabla) y 'Crear/Editar receta' (editor).",
      "La tabla lista los productos marcados como fabricados e indica si cada uno tiene o no receta y su costo estimado por unidad; al desplegar un producto con receta, muestra el detalle de materiales y el desglose de costos.",
      "El editor arma la receta de un producto: agrega una línea por material con su consumo por unidad producida.",
      "Registra factores de costo POR UNIDAD: energía, mano de obra y overhead (en Lempiras).",
      "Calcula en vivo el costo estimado por unidad = Σ(consumo × costo del material) + factores.",
      "Guarda el estándar de producción (unidades por minuto), usado luego para el rendimiento/OEE.",
    ],
    queNoHace: [
      "No cambia el costo real del producto: el costo estimado es una referencia. El costo REAL se fija al recibir cada corrida de producción (con el consumo real de esa corrida).",
      "No crea el producto ni lo marca como fabricado: el producto debe existir y estar marcado 'Es producto fabricado' en Configuración → Productos para aparecer aquí.",
      "No consume inventario: la receta es solo la definición; el consumo ocurre en Control de Piso.",
    ],
    operaciones: [
      {
        titulo: "Ver qué productos tienen receta y sus costos",
        pasos: [
          "Abre Producción → Recetas, pestaña 'Productos fabricados'.",
          "Cada fila muestra si el producto tiene receta ('Con receta'/'Sin receta') y su costo estimado por unidad.",
          "Despliega una fila con receta para ver sus materiales (consumo y costo) y el desglose completo del costo.",
        ],
      },
      {
        titulo: "Crear o editar la receta de un producto",
        pasos: [
          "En la pestaña 'Crear/Editar receta' elige el producto (o presiona 'Crear/Editar receta' desde la tabla).",
          "Escribe su estándar de producción (unidades por minuto), si lo conoces.",
          "Agrega una línea por cada material y su consumo por unidad producida (ej. 0.5 m de tela por camiseta).",
          "Ingresa los factores de costo por unidad (energía, mano de obra, overhead).",
          "Revisa el costo estimado por unidad que se calcula solo y presiona 'Guardar receta'.",
        ],
      },
    ],
    faqs: [
      {
        pregunta: "¿El costo estimado se vuelve el costo del producto?",
        respuesta:
          "No directamente. Es una estimación con el costo actual de los materiales. El costo real del producto se fija al recibir cada corrida de producción, con los materiales realmente consumidos y los factores de esa corrida.",
      },
      {
        pregunta: "Cambié el costo de un material, ¿se actualiza la receta?",
        respuesta:
          "El costo estimado se recalcula cuando abres la receta (usa el costo promedio vigente de cada material). Vuelve a guardarla para dejar cacheado el nuevo estimado.",
      },
    ],
    keywords: ["receta", "mrp", "bom", "consumo", "material por unidad", "costo estimado", "factores", "mano de obra", "overhead", "estandar", "unidades por minuto", "fabricado", "produccion"],
  },
  {
    modulo: "Ordenes de Produccion",
    titulo: "Órdenes de Producción",
    descripcion:
      "Planifica qué producto fabricar, cuánto y para cuándo, y prográmalo en el día con un planeador tipo Gantt. Cada orden congela la receta del producto para el control de piso y el costeo.",
    queHace: [
      "Dos pestañas: 'Órdenes' (crear y listar) y 'Planeador' (programar el día).",
      "Crea órdenes para productos marcados como fabricados: cantidad a producir, fecha objetivo y notas.",
      "Al crear la orden, congela la receta vigente del producto (si tiene) para que el control de piso sepa qué materiales consumir.",
      "Planeador: eliges un día y su horario de trabajo (entrada/salida, se guarda por día) y colocas las órdenes en una línea de tiempo. Arrastra cada orden para fijar su hora de inicio (se guarda al soltar); la hora de fin sale de su duración.",
      "La duración de cada orden se calcula desde la receta (cantidad ÷ estándar de producción) y se puede ajustar; cada barra muestra el avance según lo ya fabricado (unidades buenas).",
      "Maneja el estado de cada orden: Abierta, En Proceso, Cerrada o Cancelada.",
      "Solo muestra productos marcados como 'Es producto fabricado' (se marca en Configuración → Productos).",
      "Órdenes de TRABAJO (OT): 'Nueva orden de trabajo' crea una orden sin producto fabricado (rotulación, impresión especial, un proyecto) con descripción, cliente opcional, cantidad, fecha compromiso y las etapas (operaciones) que recorre. Se numera OT-#### y se sigue en Flujo de Producción; sus materiales y productos se declaran como consumo por etapa.",
      "Columna 'Costo real': suma de consumos por etapa, corridas ejecutadas y mano de obra declarada al entregar cada etapa (OP y OT).",
      "Desde Ventas → Cotizaciones, el menú 'Crear orden de trabajo' genera la OT ya enlazada a la cotización y al cliente.",
    ],
    queNoHace: [
      "No descuenta materiales ni fabrica nada: eso ocurre en el Control de Piso al registrar las corridas.",
      "No obliga a que el producto tenga receta para crear la orden, pero avisa: sin receta no se podrá descontar materiales ni costear la producción.",
      "El planeador no traslapa validando capacidad: es una guía visual del orden y horario del día.",
    ],
    operaciones: [
      {
        titulo: "Marcar un producto como fabricado",
        pasos: [
          "Abre Configuración → Productos y edita el producto.",
          "Activa la casilla 'Es producto fabricado' y guarda.",
          "Ese producto ya aparece en Recetas y en Órdenes de Producción.",
        ],
      },
      {
        titulo: "Crear una orden de producción",
        pasos: [
          "En la pestaña 'Órdenes' presiona 'Nueva orden'.",
          "Elige el producto fabricado, la cantidad a producir, la fecha objetivo y notas si aplica.",
          "Guarda. Si el producto no tiene receta, el sistema te avisa para que la definas en Recetas.",
          "Usa el selector de estado para pasar la orden a 'En Proceso' o 'Cerrada' (o Cancelada).",
        ],
      },
      {
        titulo: "Programar el día en el planeador",
        pasos: [
          "Abre la pestaña 'Planeador' y elige el día; ajusta la hora de entrada y salida (se guarda para ese día).",
          "En 'Sin programar', presiona 'Agregar' en las órdenes que trabajarás ese día: se colocan en la línea de tiempo.",
          "Arrastra cada barra para mover su hora de inicio; la hora de fin se recalcula por su duración. Se guarda al soltar.",
          "Cada barra muestra el rango de horas y el avance (fabricado/objetivo). La 'X' quita la orden del día.",
        ],
      },
    ],
    faqs: [
      {
        pregunta: "No me aparece mi producto al crear la orden.",
        respuesta:
          "Solo se muestran los productos marcados como 'Es producto fabricado'. Edítalo en Configuración → Productos y activa esa casilla.",
      },
      {
        pregunta: "Creé la orden pero dice 'Sin receta', ¿qué hago?",
        respuesta:
          "Define la receta del producto en Producción → Recetas. Sin receta, el control de piso no puede descontar materiales ni calcular el costo real de la producción.",
      },
    ],
    keywords: ["orden de produccion", "orden", "fabricar", "planificar", "cantidad", "fecha objetivo", "estado", "abierta", "en proceso", "cerrada", "produccion"],
  },
  {
    modulo: "Control de Piso",
    titulo: "Control de Piso",
    descripcion:
      "Registra las corridas de producción de cada orden y monitorea lo procesado por día y por rango. Al ejecutar una corrida, descuenta automáticamente los materiales según la receta.",
    queHace: [
      "Tres pestañas: 'Registro' (por orden), 'En vivo' (por día) y 'Consolidado' (por rango de fechas).",
      "Registro: LISTA todas las órdenes abiertas o en proceso (las PROGRAMADAS en el planeador primero, con su número OP-####). Despliega una orden para ver sus corridas y registrar una nueva. Cada corrida guarda: operador (texto libre), hora de inicio/fin, unidades buenas y defectuosas (con motivos), VARIOS paros (cada uno con su motivo y minutos), tiempo planificado y novedades.",
      "Al escribir las unidades, muestra en vivo el CONSUMO de materia prima que corresponde (receta × unidades procesadas) por material, y avisa en rojo si el stock no alcanza.",
      "En vivo: muestra lo procesado en un día (por defecto hoy) — corridas con su operador, los paros registrados (motivo y duración) e indicadores del día (buenas, defectuosas, calidad, paros). Puedes moverte a días anteriores.",
      "Consolidado: al filtrar un rango de fechas, una tabla con una fila por día y sus indicadores (corridas, órdenes, buenas, defectuosas, calidad, paros, tiempo planificado y los productos trabajados).",
      "Al 'Ejecutar' la corrida, descuenta los materiales = receta × unidades PROCESADAS (buenas + defectuosas) y calcula el costo real (materiales + factores) por unidad buena.",
      "Bloquea la ejecución si algún material no alcanza (nunca deja el stock de material en negativo).",
    ],
    queNoHace: [
      "No descuenta material al registrar la corrida: solo al ejecutarla.",
      "No permite ejecutar una corrida dos veces (evita doble descuento).",
      "No recibe el producto terminado al inventario: eso es Producción → Recepción de Producción (fase siguiente).",
      "No permite ejecutar si la orden no tiene receta.",
    ],
    operaciones: [
      {
        titulo: "Registrar y ejecutar una corrida",
        pasos: [
          "En la pestaña 'Registro', busca la orden en el listado (las programadas aparecen primero) y despliégala.",
          "Presiona 'Registrar corrida' y captura el operador, las horas, las unidades buenas/defectuosas y el tiempo planificado.",
          "Agrega los paros que hubo (cada uno con su motivo y minutos) y, si hubo defectos, sus motivos. Al escribir las unidades verás el consumo de materia prima estimado.",
          "Guarda: la corrida queda 'Registrada' (aún no descuenta material) y aparece dentro de la orden.",
          "Presiona 'Ejecutar' en la fila de la corrida: se descuentan los materiales de la receta según las unidades procesadas y se calcula el costo real. Si falta material, te avisa y no ejecuta.",
        ],
      },
      {
        titulo: "Ver la producción del día (en vivo)",
        pasos: [
          "Abre la pestaña 'En vivo': por defecto muestra el día de hoy.",
          "Revisa los indicadores del día y la lista de corridas con su hora, y los paros/defectos con su motivo.",
          "Usa las flechas o el selector de fecha para revisar días anteriores; 'Actualizar' refresca los datos.",
        ],
      },
      {
        titulo: "Consolidar varios días",
        pasos: [
          "Abre la pestaña 'Consolidado' y elige el rango de fechas (Desde / Hasta).",
          "Presiona 'Consultar': verás los totales del rango y una fila por día con sus indicadores y los productos trabajados.",
        ],
      },
    ],
    faqs: [
      {
        pregunta: "¿Por qué el consumo usa las unidades defectuosas también?",
        respuesta:
          "Porque el material se gastó aunque algunas unidades salieran defectuosas. Por eso el consumo se calcula sobre las procesadas (buenas + defectuosas), y el costo de esas unidades malas se reparte encareciendo la unidad buena.",
      },
      {
        pregunta: "No me deja ejecutar: 'Stock de material insuficiente'.",
        respuesta:
          "Falta stock de uno o más materiales para el consumo requerido. Compra o ajusta ese material (Producción → Compra de Materiales) y vuelve a ejecutar.",
      },
    ],
    keywords: ["control de piso", "corrida", "produccion", "consumo material", "defectos", "paros", "oee", "unidades procesadas", "descuento material", "costo real"],
  },
  {
    modulo: "Dashboard Produccion",
    titulo: "Dashboard de Producción",
    descripcion:
      "Los indicadores de producción del período: órdenes y flujo por procesos (cumplimiento, lead time por proceso, carga por etapa, atrasadas) y fabricación (unidades, calidad y OEE).",
    queHace: [
      "Órdenes y flujo: órdenes creadas, en piso, terminadas, % de cumplimiento contra la fecha comprometida, lead time promedio, atrasadas, en riesgo y sin iniciar flujo.",
      "Gráficos: lead time por proceso (real contra planeado), órdenes por proceso ahora (en proceso, recibidas y pendientes de recibir) y tendencia semanal de terminadas y % a tiempo; tabla de las órdenes atrasadas en piso con enlace a Mastertracking.",
      "El período por defecto son los últimos 30 días; el estado en piso siempre es la foto actual.",
      "Muestra en un rango de fechas (con atajos: este mes, mes pasado, 7 días, este año) las unidades buenas y defectuosas, número de corridas y costo unitario promedio.",
      "Calcula el OEE y sus tres componentes: Disponibilidad (tiempo operativo vs planificado), Rendimiento (producción real vs el estándar de la receta) y Calidad (buenas ÷ procesadas).",
      "Grafica las unidades fabricadas por día (buenas y defectuosas).",
      "Solo considera corridas ya ejecutadas.",
    ],
    queNoHace: [
      "No captura datos: se alimenta de las corridas registradas en Control de Piso.",
      "Si una corrida no tiene tiempo planificado/horas o el producto no tiene estándar de producción, esa corrida se excluye del componente del OEE que no se puede calcular (se te indica); la Calidad siempre se calcula.",
    ],
    operaciones: [
      {
        titulo: "Revisar el rendimiento de producción",
        pasos: [
          "Abre Producción → Dashboard Producción.",
          "Elige el período (usa un atajo o fija desde/hasta).",
          "Revisa los KPIs, el OEE con sus tres componentes y la gráfica de unidades por día.",
          "Para mejorar el OEE: si la Disponibilidad es baja, revisa paros; si el Rendimiento es bajo, revisa el estándar y la velocidad real; si la Calidad es baja, revisa los defectos y sus motivos.",
        ],
      },
    ],
    faqs: [
      {
        pregunta: "El OEE me sale con guiones o incompleto.",
        respuesta:
          "Un componente aparece en '—' cuando ninguna corrida del período tenía el dato para calcularlo: Disponibilidad necesita tiempo planificado u horas de inicio/fin; Rendimiento necesita el estándar de producción (u/min) en la receta. Captura esos datos para ver el OEE completo.",
      },
    ],
    keywords: ["dashboard produccion", "oee", "disponibilidad", "rendimiento", "calidad", "unidades por dia", "indicadores", "produccion", "eficiencia"],
  },
  {
    modulo: "Recepcion de Produccion",
    titulo: "Recepción de Producción",
    descripcion:
      "Confirma las corridas ejecutadas y recibe el producto terminado al inventario, con el costo real de la corrida (promedio ponderado).",
    queHace: [
      "Dos pestañas: 'Por recibir' (pendientes) e 'Historial' (recepciones anteriores).",
      "Por recibir: lista las corridas ejecutadas pendientes de recibir, con sus unidades buenas y el costo unitario real.",
      "Al recibir, entran las unidades BUENAS al almacén y localización que elijas.",
      "Registra la entrada en el kardex del producto (movimiento 'Entrada Producción') y recalcula su costo promedio ponderado, igual que una compra.",
      "Historial: al filtrar un rango de fechas, muestra las recepciones ya hechas (fecha, producto, destino, cantidad, costo, valor y usuario) con sus totales.",
      "No permite recibir dos veces la misma corrida.",
    ],
    queNoHace: [
      "No recibe unidades defectuosas: solo entran al inventario las unidades buenas (vendibles).",
      "No descuenta materiales: eso ya ocurrió al ejecutar la corrida en Control de Piso.",
    ],
    operaciones: [
      {
        titulo: "Recibir una corrida al inventario",
        pasos: [
          "Abre Producción → Recepción de Producción, pestaña 'Por recibir'.",
          "En la lista de corridas por recibir, presiona 'Recibir' en la que corresponda.",
          "Elige el almacén y la localización donde entra el producto terminado y confirma.",
          "El stock del producto sube por las unidades buenas y su costo promedio se recalcula con el costo real de la corrida.",
        ],
      },
      {
        titulo: "Consultar el historial de recepciones",
        pasos: [
          "Abre la pestaña 'Historial' y elige el rango de fechas (Desde / Hasta).",
          "Presiona 'Consultar': verás cada recepción con su producto, destino, cantidad, costo y valor, y los totales del rango.",
        ],
      },
    ],
    faqs: [
      {
        pregunta: "¿Por qué el costo del producto cambió tras recibir?",
        respuesta:
          "Porque el producto entra con el costo real de esa corrida y su costo promedio se pondera con el stock que ya tenías (como una recepción de compra). Así el costo refleja tanto lo anterior como lo recién producido.",
      },
      {
        pregunta: "Una corrida no aparece para recibir.",
        respuesta:
          "Solo aparecen las corridas en estado 'Ejecutada' con unidades buenas mayores a 0. Ejecuta la corrida primero en Control de Piso (eso descuenta el material y calcula el costo).",
      },
    ],
    keywords: ["recepcion produccion", "recibir", "producto terminado", "entrada produccion", "costo real", "inventario", "corrida", "almacen"],
  },
]
