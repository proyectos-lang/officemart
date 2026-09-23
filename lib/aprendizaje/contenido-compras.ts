import type { TutorialModulo } from "./types"

export const TUTORIALES_COMPRAS: TutorialModulo[] = [
  {
    modulo: "Orden de Compra",
    titulo: "Orden de Compra",
    descripcion:
      "Crear órdenes de compra a proveedores, en Lempiras o dólares, con costos de importación que se reparten al costo final de cada producto.",
    queHace: [
      "Crea órdenes con proveedor, fecha tentativa de llegada y líneas de productos con costo unitario.",
      "Soporta moneda LPS o USD con tasa de cambio.",
      "Registra costos de importación, impuestos de compra y otros costos; el sistema los prorratea en el costo final local de cada producto.",
      "Estados de la orden: Pendiente → Recibida (o Cancelada).",
      "Genera la orden en PDF con el logo de la empresa para enviarla al proveedor.",
    ],
    queNoHace: [
      "No mueve inventario ni costos al crearla: el stock y el costo promedio cambian solo al RECIBIR la mercancía (Recepción por OC).",
      "No registra el pago al crearla. Los anticipos y abonos al proveedor se registran desde el detalle de la orden (secciones 'Recepciones' y 'Pagos al proveedor'), y el saldo aparece en Finanzas → Gastos → Cuentas por Pagar → Compras a crédito.",
    ],
    operaciones: [
      {
        titulo: "Crear una orden de compra local (Lempiras)",
        pasos: [
          "Abre Compras → Orden de Compra y presiona Nueva Orden.",
          "Elige el proveedor y la fecha tentativa de llegada.",
          "Agrega los productos con cantidad y costo unitario.",
          "Guarda: la orden queda 'Pendiente' y aparece en el Dashboard como compra por recibir.",
          "Genera el PDF si necesitas enviarla al proveedor.",
        ],
      },
      {
        titulo: "Crear una orden de importación (USD)",
        pasos: [
          "Crea la orden y elige moneda USD con su tasa de cambio.",
          "Ingresa los costos unitarios en dólares.",
          "Registra los costos de importación, impuestos y otros costos (flete, aduana…).",
          "El sistema calcula el costo final en Lempiras por producto, con el prorrateo incluido — ese será el costo que entre al inventario al recibir.",
        ],
      },
    ],
    faqs: [
      {
        pregunta: "¿Puedo modificar una orden ya creada?",
        respuesta:
          "Mientras esté Pendiente puedes cancelarla y crear una nueva. Una vez recibida, los movimientos de inventario ya se generaron.",
      },
      {
        pregunta: "¿Cómo afecta la orden al costo de mis productos?",
        respuesta:
          "Al recibirla, el sistema recalcula el costo promedio ponderado de cada producto usando el costo final local (incluye el prorrateo de importación).",
      },
    ],
    keywords: ["oc", "pedido", "proveedor", "importacion", "dolares", "tasa cambio", "prorrateo", "flete"],
  },
  {
    modulo: "Recepcion por OC",
    titulo: "Recepción por Orden de Compra",
    descripcion:
      "Recibir la mercancía de una orden de compra: ingresa el stock al almacén y actualiza el costo promedio de cada producto.",
    queHace: [
      "Lista las órdenes pendientes y permite recibirlas total o PARCIALMENTE en varias recepciones: cada línea muestra Ordenado / Recibido / Recibir; por defecto se recibe lo pendiente y puedes bajar la cantidad (nunca más de lo pendiente). La orden sigue Pendiente hasta completarse y lo que falta se ve en Compras → Backorder.",
      "Cada recepción queda registrada aparte (número 1, 2, 3… por orden) con sus propios costos extra, tasa y número de factura del proveedor; el prorrateo se calcula SOLO sobre lo que entra en esa recepción. Al elegir una orden con recepciones previas se listan arriba.",
      "Botón 'Cerrar pendiente': si el proveedor ya no entregará el resto, cierras el backorder con un motivo y la orden pasa a Recibida con lo que entró.",
      "Puedes EDITAR por línea la cantidad, el costo final y el precio de venta. Ves en vivo el margen, la utilidad por unidad, el costo anterior y el precio anterior del producto para decidir.",
      "El precio de venta que pongas ACTUALIZA el precio de lista del producto en el catálogo.",
      "Ingresa las unidades al almacén y localización que elijas.",
      "Recalcula el costo promedio ponderado del producto con el costo final de la compra.",
      "Método de pago: Efectivo (sale de caja chica) o Banco (sale de una cuenta) registran un ABONO a la orden por lo recibido; Cuenta por pagar deja la orden con saldo y fecha de vencimiento (hoy + días de crédito del proveedor o los que indiques). Ya NO se crea un gasto 'Compra de mercadería': el costo de la mercancía entra al Estado de Resultados por el costo de ventas, y el saldo al proveedor se ve en Cuentas por Pagar → Compras a crédito.",
      "Deja rastro en el kardex como 'Entrada Compra' vinculada a la orden.",
      "Marca la orden como Recibida cuando se completa.",
      "Muestra un desglose explícito del prorrateo: cuánto de los costos de importación/impuestos/otros se asigna a cada producto (según su valor) y cómo se forma el costo final unitario, con total de control.",
      "Guarda un borrador automático: si el sistema se cierra o refrescas la página a mitad de una recepción, al volver retoma la orden y lo que habías capturado (costos, tasa, destino, ediciones por línea y método de pago). Puedes continuar o presionar 'Descartar' para empezar de cero.",
    ],
    queNoHace: [
      "No crea órdenes (eso es Orden de Compra) ni recibe mercancía sin orden — para eso está Recepción por Factura o Ingreso Manual.",
      "El borrador se guarda solo en ese navegador y ese usuario: no se sincroniza a otra computadora ni a otro equipo.",
    ],
    operaciones: [
      {
        titulo: "Recibir una orden completa",
        pasos: [
          "Abre Compras → Recepción por OC.",
          "Selecciona la orden pendiente.",
          "Elige el almacén y la localización donde entra la mercancía.",
          "Revisa/edita por línea la cantidad, el costo y el precio de venta (ves margen, utilidad, costo y precio anteriores).",
          "Elige el método de pago: Efectivo, Banco (con su cuenta) o Cuenta por pagar.",
          "Guarda: el stock sube, el costo promedio y el precio se actualizan, se registra el pago/gasto y la orden queda Recibida.",
        ],
      },
      {
        titulo: "Entender el costo con importación (prorrateo)",
        pasos: [
          "Al recibir, ingresa los costos de importación, impuestos y otros costos en Lempiras.",
          "Aparece la tabla 'Cómo se calcula el costo': cada producto muestra su valor, el % que representa del total, cuánto costo adicional se le asignó y el costo final unitario.",
          "Los costos se reparten en proporción al valor de cada línea (más caro = recibe más costo). Verifica el total de control: valor de mercancía + costos adicionales = inventario recibido.",
        ],
      },
      {
        titulo: "Recepción parcial (llegó menos de lo pedido)",
        pasos: [
          "Selecciona la orden y ajusta la cantidad recibida en cada línea a lo que realmente llegó.",
          "Guarda la recepción: solo esas unidades entran al inventario.",
          "La orden mantiene el saldo pendiente para recibir el resto después.",
        ],
      },
    ],
    faqs: [
      {
        pregunta: "¿Por qué cambió el costo de mi producto después de recibir?",
        respuesta:
          "El sistema usa costo promedio ponderado: mezcla el stock existente a su costo anterior con las unidades nuevas a su costo de compra. Es el método correcto para valorar inventario.",
      },
      {
        pregunta: "Recibí en el almacén equivocado, ¿cómo corrijo?",
        respuesta:
          "Usa Inventario → Traslados para mover las unidades al almacén correcto. El kardex conserva ambos movimientos para auditoría.",
      },
      {
        pregunta: "Se me cerró el sistema a mitad de la recepción, ¿perdí lo que había capturado?",
        respuesta:
          "No. La recepción se guarda como borrador en tu navegador: al volver a abrir Recepción por OC retoma la orden y lo que llevabas (costos, tasa, almacén, ediciones y método de pago). Continúa donde ibas o presiona 'Descartar' para empezar de nuevo. El borrador se borra solo al confirmar la recepción.",
      },
    ],
    keywords: ["recibir", "mercancia", "entrada", "costo promedio", "parcial", "almacen", "precio de venta", "margen", "utilidad", "metodo de pago", "cuenta por pagar", "pago proveedor", "borrador", "retomar", "recuperar", "se cerro"],
  },
  {
    modulo: "Recepcion por Factura",
    titulo: "Recepción por Factura (con IA)",
    descripcion:
      "Subir la foto de una factura de proveedor: la inteligencia artificial extrae los productos y cantidades para ingresarlos al inventario sin digitar.",
    queHace: [
      "Tres modos: 'Digitalizar (IA)' (subir foto/PDF), 'Captura manual' (agregar productos por nombre o código de barras, sin imagen) e 'Historial' (facturas de compra recibidas).",
      "Campo para el número de factura del proveedor, que se guarda con la compra.",
      "Cada recepción crea una compra real (con proveedor, número de factura, fecha, líneas y total), así queda registrada en el historial y el kardex puede apuntar a ella.",
      "Historial: lista las facturas de compra recibidas; abre cada una para ver su desglose de productos (cantidad, costo, subtotal).",
      "Acepta foto o PDF de la factura del proveedor.",
      "La IA (Gemini) lee la factura y extrae cada línea: nombre del producto, cantidad y costo unitario.",
      "Permite mapear cada línea extraída con un producto del catálogo (o crear el producto al vuelo).",
      "Editas por línea la cantidad, el costo y el precio de venta; ves el margen, la utilidad por unidad, el costo anterior y el precio anterior. El precio que pongas actualiza el precio de lista del producto.",
      "Ingresa el stock y actualiza el costo promedio, igual que una recepción normal.",
      "Método de pago: Efectivo (caja chica) o Banco (una cuenta) registran un abono a la compra; Cuenta por pagar la deja con saldo y vencimiento (Finanzas → Gastos → Cuentas por Pagar → Compras a crédito). No se crea un gasto aparte: el costo entra al P&L por el costo de ventas.",
      "Con costos de importación/impuestos/otros, muestra el mismo desglose explícito del prorrateo que la Recepción por OC.",
      "Detección de tallas (si tu empresa usa tallas): cuando la factura desglosa una referencia por talla (S/M/L… o 6/8/10…), la IA la agrupa en una sola línea y marca las tallas detectadas. Al crear ese producto, el diálogo llega precargado con las tallas y sus cantidades; al guardarlo se crean los productos hermanos agrupados y la línea de factura se reemplaza por una línea por talla (cada una entra a inventario con su cantidad).",
      "Agregar tallas a un producto ya asociado (si tu empresa usa tallas): en una línea ya mapeada a un producto que aún NO es tallado, aparece 'Agregar tallas'. Le asignas una talla al producto asociado y agregas las demás con sus cantidades; el producto pasa a ser tallado (conserva su stock e historial), se crean sus hermanas y la línea se reparte en una por talla para el ingreso.",
      "Guarda un borrador automático: si el sistema se cierra o refrescas la página a mitad de una recepción, al volver retoma lo que habías capturado (líneas, proveedor, número de factura, costos, destino y método de pago; la imagen no se guarda). Puedes continuar o presionar 'Descartar y empezar de nuevo'.",
    ],
    queNoHace: [
      "No es infalible: la IA puede leer mal cantidades o precios en facturas borrosas — siempre revisa antes de confirmar.",
      "No asocia productos automáticamente: el mapeo línea → producto del catálogo lo confirmas tú.",
      "La detección de tallas depende de que la factura las liste legibles; siempre puedes corregir/agregar tallas y cantidades a mano en el diálogo.",
      "El borrador no guarda la imagen de la factura (por su tamaño) y solo vive en ese navegador y ese usuario: no se sincroniza a otro equipo.",
    ],
    operaciones: [
      {
        titulo: "Ingresar mercancía desde una foto de factura",
        pasos: [
          "Abre Compras → Recepción por Factura, pestaña 'Digitalizar (IA)'.",
          "Arrastra o sube la imagen/PDF de la factura (JPG, PNG o PDF) y presiona 'Extraer Productos'.",
          "Elige el proveedor y escribe el número de factura.",
          "Revisa las líneas extraídas: corrige cantidad, costo y precio de venta si hace falta (ves margen y utilidad).",
          "Asocia cada línea con su producto del catálogo (o créalo con el botón rápido).",
          "Elige almacén/localización, el método de pago (Efectivo/Banco/Cuenta por pagar) y confirma. Se crea la compra y queda en el historial.",
        ],
      },
      {
        titulo: "Crear una factura de compra manual (sin imagen)",
        pasos: [
          "Abre Compras → Recepción por Factura, pestaña 'Captura manual'.",
          "Elige el proveedor y escribe el número de factura.",
          "Presiona 'Agregar producto' y búscalo por nombre o código de barras; se agrega una línea editable (repite por cada producto).",
          "Ajusta cantidad, costo y precio de venta de cada línea.",
          "Elige almacén/localización, el método de pago y confirma.",
        ],
      },
      {
        titulo: "Ver el historial de facturas de compra",
        pasos: [
          "Abre la pestaña 'Historial'.",
          "Verás las facturas recibidas con su número, proveedor, fecha y total.",
          "Presiona 'Ver' en una factura para abrir su desglose de productos.",
        ],
      },
      {
        titulo: "Ingresar una referencia con tallas desde la factura",
        pasos: [
          "Requiere que tu empresa use tallas (se activa de forma centralizada).",
          "Tras procesar con IA, la línea con tallas aparece marcada con las tallas detectadas (ej. 'Tallas: S(5) M(8) L(3)').",
          "Presiona 'Crear producto tallado' en esa línea: el diálogo llega con la casilla 'Este producto tiene tallas' activa y las tallas precargadas.",
          "Corrige o completa las tallas y cantidades si hace falta; define el costo y el precio (iguales para todas las tallas) y guarda.",
          "La línea de la factura se reemplaza por una línea por talla, cada una asociada a su producto. Confirma el ingreso: entra el stock de cada talla con el costo prorrateado.",
        ],
      },
      {
        titulo: "Convertir en tallado un producto ya asociado (agregar tallas)",
        pasos: [
          "Requiere que tu empresa use tallas.",
          "En una línea ya asociada a un producto que aún NO tiene tallas, presiona 'Agregar tallas'.",
          "Asigna la talla que corresponde al producto asociado y su cantidad para este ingreso.",
          "Agrega las tallas restantes con sus cantidades (se crean como productos hermanos con el mismo costo y precio).",
          "Presiona 'Convertir en tallado': el producto original conserva su stock e historial y se agrupa con las nuevas tallas; la línea se reparte en una por talla.",
          "Confirma la recepción: cada talla entra con su cantidad y el costo prorrateado.",
        ],
      },
    ],
    faqs: [
      {
        pregunta: "La IA no extrajo nada o marcó error, ¿qué hago?",
        respuesta:
          "Verifica que la foto sea legible y bien iluminada. Si persiste, puede faltar la clave de IA en el servidor (avisar al administrador) o la factura tiene un formato muy inusual — ingresa las líneas a mano con Ingreso Manual.",
      },
      {
        pregunta: "¿Se guarda la foto de la factura?",
        respuesta:
          "En este módulo la imagen solo se usa para la extracción. Si quieres guardar el comprobante, adjúntalo al gasto correspondiente en Finanzas → Gastos.",
      },
      {
        pregunta: "Se cerró el sistema mientras capturaba la factura, ¿perdí todo?",
        respuesta:
          "No. Lo capturado se guarda como borrador en tu navegador: al volver a abrir Recepción por Factura retoma las líneas, el proveedor, el número de factura, los costos y el destino (la imagen no se guarda; vuelve a subirla si la necesitas). Continúa donde ibas o presiona 'Descartar y empezar de nuevo'. El borrador se borra al confirmar la recepción.",
      },
      {
        pregunta: "Asocié un producto y luego me di cuenta que tiene tallas, ¿tengo que borrarlo?",
        respuesta:
          "No. En la línea ya asociada presiona 'Agregar tallas': asigna la talla del producto y agrega las demás con sus cantidades. El producto pasa a ser tallado conservando su stock e historial, y la línea se reparte en una por talla para el ingreso. (Requiere que tu empresa use tallas.)",
      },
    ],
    keywords: ["ia", "inteligencia artificial", "foto", "escanear", "gemini", "factura proveedor", "ocr", "tallas", "talla", "tallado", "detectar tallas", "agregar tallas", "convertir en tallado", "precio de venta", "margen", "utilidad", "metodo de pago", "cuenta por pagar", "pago proveedor", "borrador", "retomar", "recuperar", "se cerro"],
  },
  {
    modulo: "Recalcular Recepcion",
    titulo: "Recalcular Recepción",
    descripcion:
      "Tomar una compra ya recibida y recomputar el costo del lote con costos fijos corregidos (importación, impuestos, otros, tasa de cambio), aplicando la diferencia al costo de los productos.",
    queHace: [
      "Lista las compras ya recibidas (por Orden de Compra) para elegir el lote a corregir.",
      "Precarga los costos fijos del lote (importación, impuestos, otros, tasa) y permite editarlos.",
      "Re-corre el prorrateo y muestra, por producto, el costo final antiguo vs. el nuevo y la diferencia.",
      "Actualiza el costo final de cada línea, el kardex de la entrada y el total del lote.",
      "Corrige el costo promedio de cada producto por la diferencia del lote proporcional al stock actual (ajuste por delta).",
      "Opcional: recalcula el costo de las ventas pasadas de esos productos en un rango de fechas (afecta el CMV y el margen histórico).",
    ],
    queNoHace: [
      "No recalcula recepciones hechas por Recepción por Factura (IA): esas no generan una compra en el sistema y no aparecen en la lista.",
      "No cambia las cantidades recibidas ni los costos unitarios de compra; solo redistribuye los costos fijos.",
      "No revierte el promedio ponderado lote por lote: aplica la diferencia sobre el stock actual, así que si ya se vendió gran parte del lote el ajuste es aproximado.",
      "No aplica a órdenes recibidas en VARIAS recepciones parciales (cada recepción prorrateó sus propios costos): para corregir el costo usa Inventario → Ajuste de Costo.",
    ],
    operaciones: [
      {
        titulo: "Corregir el flete/aduana de una importación ya recibida",
        pasos: [
          "Abre Compras → Recalcular Recepción y busca la compra por número o proveedor.",
          "Selecciona la compra recibida: se precargan sus costos fijos.",
          "Ajusta los costos de importación, impuestos, otros costos y/o la tasa de cambio a los valores reales.",
          "Revisa el desglose del prorrateo y la tabla de impacto por producto (costo final y costo promedio, antiguo → nuevo).",
          "Si quieres corregir también las ventas ya hechas, activa «Recalcular ventas» y elige el rango (por defecto desde la recepción hasta hoy).",
          "Presiona Aplicar recálculo y confirma.",
        ],
      },
    ],
    faqs: [
      {
        pregunta: "¿Por qué el costo promedio no cambia exactamente al nuevo costo final del lote?",
        respuesta:
          "Porque el costo promedio mezcla todos los lotes en stock. Se aplica solo la diferencia del lote proporcional al stock actual, para no borrar el costo de la mercancía de otras compras.",
      },
      {
        pregunta: "¿Qué pasa si el producto ya no tiene stock?",
        respuesta:
          "Sin stock no hay ajuste del costo actual hacia adelante; el costo final de la línea y el kardex sí se actualizan. Si activas el recálculo de ventas, el CMV histórico del rango sí se corrige.",
      },
      {
        pregunta: "¿Queda registro del cambio?",
        respuesta:
          "Sí. Cada ajuste de costo por producto queda en la bitácora de ajustes de costo, con el motivo «Recálculo recepción #<número>».",
      },
    ],
    keywords: ["recalcular", "recepcion", "importacion", "prorrateo", "costos fijos", "flete", "aduana", "costo lote", "delta", "tasa cambio"],
  },
  {
    modulo: "Backorder",
    titulo: "Backorder (pendiente de entrega)",
    descripcion:
      "Órdenes de compra que ya tuvieron al menos una recepción y a las que el proveedor todavía debe mercancía: qué falta, desde cuándo, y cerrar lo que no llegará.",
    queHace: [
      "Lista cada orden con recepción parcial: proveedor, fecha de la orden, días esperando, fecha tentativa (marca si ya venció) y, por producto, Ordenado / Recibido / Pendiente con su costo.",
      "Resumen: órdenes con pendiente, líneas pendientes y valor aproximado de lo que falta.",
      "Botón 'Recibir' te lleva a Recepción por OC para registrar la siguiente entrega.",
      "'Cerrar pendiente': con un motivo, la orden pasa a Recibida con lo que entró (no llegará más). Queda en la bitácora de Auditoría.",
      "El menú muestra cuántas órdenes tienen backorder. Exporta a Excel.",
    ],
    queNoHace: [
      "No incluye órdenes sin ninguna recepción (esas están en Recepción por OC como pendientes).",
      "No modifica inventario ni costos al cerrar: solo deja de esperar lo pendiente.",
      "No reabre una orden cerrada: si el proveedor entrega después, crea una orden nueva.",
    ],
    operaciones: [
      {
        titulo: "Revisar qué debe cada proveedor",
        pasos: [
          "Abre Compras → Backorder.",
          "Revisa cada tarjeta: las líneas con Pendiente en naranja son lo que falta; 'días esperando' te dice desde cuándo.",
          "Si ya llegó, presiona Recibir y registra la recepción; si no llegará, 'Cerrar pendiente' con el motivo.",
        ],
      },
    ],
    faqs: [
      {
        pregunta: "Recibí una orden completa y sigue apareciendo aquí.",
        respuesta:
          "Alguna línea quedó con cantidad recibida menor a la ordenada (por ejemplo bajaste la cantidad al recibir). Recibe el resto o cierra el pendiente.",
      },
    ],
    keywords: ["backorder", "pendiente de entrega", "falta mercancia", "proveedor debe", "recepcion parcial", "cerrar pendiente", "orden incompleta"],
  },
  {
    modulo: "Reportes de Compras",
    titulo: "Reportes de Compras",
    descripcion:
      "Estadísticas de órdenes de compra (cumplimiento, tiempos de entrega, mercancía en tránsito, top productos y proveedores) y estado de cuenta por proveedor con PDF/Excel.",
    queHace: [
      "Estadísticas de OC por rango de fecha de orden: órdenes, valor ordenado vs recibido, en tránsito (lo pendiente de OCs abiertas), lead time promedio (días entre la orden y la primera recepción) y órdenes que llegaron tarde respecto a la fecha tentativa.",
      "Tabla por proveedor (órdenes, valor, cumplimiento %, lead time, tardías) y productos más comprados (unidades, valor, costo promedio de compra).",
      "Detalle por orden con cumplimiento, en tránsito, lead time y retraso; exportable a Excel.",
      "Estado de cuenta de proveedor: recepciones de OC (débitos), gastos registrados a ese proveedor, y pagos (anticipos, abonos y pagos de gastos) con saldo corrido, saldo inicial por rango y documentos con saldo/vencidos. PDF y Excel. Se abre también desde Proveedores (ícono de estado de cuenta).",
    ],
    queNoHace: [
      "No registra pagos: los abonos a OC se hacen desde el detalle de la orden y los de gastos desde Finanzas → Gastos.",
      "Las OC recibidas con el flujo anterior (antes de recepciones parciales) no tienen lead time real ni recepciones separadas; se muestran con lo que hay.",
    ],
    operaciones: [
      { titulo: "Evaluar a un proveedor", pasos: ["Compras → Reportes de Compras → pestaña Estadísticas de OC.", "Ajusta el rango y Consultar; en 'Por proveedor' compara cumplimiento %, lead time y órdenes tarde.", "Abre la pestaña Estado de cuenta de proveedor para ver cuánto le debes y desde cuándo."] },
    ],
    faqs: [
      { pregunta: "El saldo del proveedor no cuadra con Cuentas por Pagar.", respuesta: "Cuentas por Pagar muestra saldos a hoy; el estado de cuenta depende del rango de fechas (lo anterior a 'Desde' va al saldo inicial). Sin rango deben coincidir." },
    ],
    keywords: ["reportes compras", "estadisticas oc", "lead time", "cumplimiento", "en transito", "estado de cuenta proveedor", "cuanto le debo", "proveedor", "top productos comprados"],
  },
]
