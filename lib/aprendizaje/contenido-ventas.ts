import type { TutorialModulo } from "./types"

export const TUTORIALES_VENTAS: TutorialModulo[] = [
  {
    modulo: "Dashboard Ventas",
    titulo: "Dashboard de Ventas",
    descripcion:
      "Analítica del área de ventas: tendencias, comparativos, top de clientes y productos más vendidos.",
    queHace: [
      "Gráficos de ventas y ganancia por mes y por año, con filtros de período.",
      "Ranking de clientes que más compran y de productos más vendidos.",
      "Comparativo entre almacenes/bodegas.",
      "Conteo de clientes activos y productos vendidos en el período.",
    ],
    queNoHace: [
      "No registra ventas (eso es Nueva Venta) ni las modifica.",
      "No muestra el flujo de dinero por método de pago — para eso está el Cierre Diario y el Dashboard de Finanzas.",
    ],
    operaciones: [
      {
        titulo: "Analizar las ventas de un período",
        pasos: [
          "Entra a Ventas → Dashboard Ventas.",
          "Elige el año y el mes en los filtros superiores.",
          "Revisa el gráfico de tendencia: compara meses para detectar temporadas.",
          "Baja al top de clientes y productos para saber qué y a quién le vendes más.",
        ],
      },
    ],
    faqs: [
      {
        pregunta: "¿La 'ganancia' incluye los gastos del negocio?",
        respuesta:
          "No. Aquí la ganancia es utilidad bruta de las ventas (precio menos costo del producto). La utilidad neta con gastos está en Finanzas → Estado de Resultados.",
      },
    ],
    keywords: ["analitica", "graficos", "top clientes", "mas vendidos", "tendencia", "estadisticas"],
  },
  {
    modulo: "Nueva Venta",
    titulo: "Nueva Venta (punto de venta)",
    descripcion:
      "Registrar una venta: elegir cliente y productos, aplicar descuento e impuesto, y cobrar con uno o varios métodos de pago.",
    queHace: [
      "Genera el número de factura correlativo automáticamente (FC-0001, FC-0002…). El número de la pantalla es una vista previa; el definitivo lo asigna el servidor al guardar (es el que sale en el aviso, la tirilla y el PDF).",
      "Punto de facturación (si tu empresa tiene sucursales): la venta sale del punto asignado a tu usuario, con su almacén preseleccionado, su serie (p. ej. FC-SPS-0001) y su CAI. El admin, o un usuario sin punto, lo elige junto al número de factura.",
      "Catálogo de productos con búsqueda y stock disponible por almacén. El botón 'Seleccionar todo' agrega de una vez todas las referencias que coinciden con tu búsqueda/filtros.",
      "Lector de código de barras (si tu empresa lo tiene activo): al escanear un producto, el sistema lo ubica por su código y lo agrega solo a la venta. Un escáner USB/Bluetooth funciona como teclado, no requiere configuración extra.",
      "Venta rápida (si tu empresa la tiene activa): botón para agregar al carrito un producto o servicio NO catalogado escribiendo su descripción y precio a mano. Esta línea NO afecta el inventario (no descuenta stock ni genera movimiento en el kardex); sirve para vender algo que no está creado. Se cobra y factura como cualquier otra línea.",
      "Descuento porcentual sobre el subtotal e impuesto ISV (15 %). El ISV viene DESACTIVADO por defecto: actívalo por venta cuando aplique.",
      "El cliente 'Consumidor Final' queda seleccionado por defecto; cámbialo si la venta es a un cliente registrado.",
      "Botón 'Pantalla completa' (arriba a la derecha): expande el módulo al 100% de la pantalla para usarlo como caja/POS físico; se sale con el mismo botón o con ESC.",
      "Pago multi-método en una misma venta: efectivo, banco/tarjeta, link de pago, crédito. Ej.: 500 en efectivo + 1,000 con tarjeta. Al agregar una línea de pago viene Efectivo preseleccionado por defecto (si la caja está disponible).",
      "Aplica la comisión bancaria configurada en cada cuenta: registra el monto bruto que paga el cliente y el neto que entra al banco.",
      "El efectivo entra automáticamente a la caja chica abierta; lo de banco entra a la cuenta elegida.",
      "En pagos en efectivo puedes escribir con cuánto paga el cliente (efectivo recibido) y el sistema calcula el vuelto; se registra el monto de la venta, no el recibido. Ej.: venta L 800, recibido L 1,000 → vuelto L 200 (se registran L 800).",
      "Descuenta el stock del almacén y deja rastro en el kardex de inventario.",
      "Límite de crédito del cliente: si la venta deja saldo a crédito y el cliente tiene un límite configurado (> 0), el sistema bloquea la venta cuando su deuda total (lo que ya debe + esta venta) superaría ese límite. Cobra parte de contado o sube su límite en Configuración → Clientes.",
      "Al guardar, el formulario queda en blanco y aparece una ventana con las opciones de impresión: imprimir tirilla térmica de 80 mm (largo exacto, sin espacios en blanco) o descargar la factura A4 en PDF.",
    ],
    queNoHace: [
      "No permite vender en efectivo sin una sesión de caja chica abierta (el sistema lo bloquea).",
      "No deja cerrar una venta a crédito que supere el límite de crédito del cliente (0 o vacío = sin límite).",
      "No permite dejar a crédito una venta al cliente 'Consumidor Final': debe pagarse completa. Para vender a crédito, elige un cliente identificado.",
      "Si el administrador de la plataforma activó 'Bloquear precio y descuento', los usuarios que NO son admin no pueden cambiar el precio de venta por línea ni aplicar descuento (los campos quedan fijos/ocultos). El admin sí puede.",
      "No permite editar una venta ya guardada: se corrige con una Devolución (parcial) o eliminándola desde Historial (total).",
      "No modifica el precio de lista del producto: el precio se puede cambiar por línea solo para esa venta.",
    ],
    operaciones: [
      {
        titulo: "Registrar una venta de contado",
        pasos: [
          "Abre Ventas → Nueva Venta.",
          "Selecciona el cliente (o créalo rápido si no existe) y el almacén del que sale la mercancía.",
          "En el catálogo, escribe el nombre (o parte del nombre) o el código del producto y presiona 'Buscar': la búsqueda consulta toda tu base (no solo lo visible) y muestra las coincidencias. Toca el producto para agregarlo y ajusta cantidades con + / −. Deja la búsqueda vacía y presiona Buscar para volver a ver todo el catálogo.",
          "Si aplica, ingresa el descuento (%) y activa el impuesto.",
          "En el desglose de pago agrega una línea 'Efectivo' (o 'Banco' y elige la cuenta) por el total.",
          "Verifica el total y presiona Guardar. El formulario queda en blanco y se abre la ventana de impresión: elige 'Imprimir tirilla (80 mm)' o 'Descargar factura (PDF)', o cierra para seguir con la próxima venta.",
        ],
      },
      {
        titulo: "Imprimir la tirilla térmica (80 mm)",
        pasos: [
          "Al guardar la venta, en la ventana 'Venta registrada' presiona 'Imprimir tirilla (80 mm)'.",
          "Se abre el diálogo de impresión del navegador ya ajustado al ancho de 80 mm y al largo exacto del contenido (sin papel en blanco de más). Elige tu impresora térmica y confirma.",
          "Según la configuración de tu empresa, la tirilla puede incluir el código de cada producto debajo de su nombre (se activa de forma centralizada para tu empresa).",
          "Si sale papel en blanco de sobra o se corta la última línea, revisa el tamaño de papel del driver de la impresora: debe estar en 'rollo/continuo' o un tamaño personalizado, no en A4/Carta.",
        ],
      },
      {
        titulo: "Escanear productos con lector de código de barras",
        pasos: [
          "Requiere que tu empresa tenga activo el lector de código de barras (se activa de forma centralizada).",
          "Selecciona el almacén (y localización si aplica) antes de escanear.",
          "Escanea el producto: el sistema detecta el código y lo agrega solo a la venta (muestra un aviso 'Agregado por escaneo'). Escanea de nuevo el mismo para sumar otra unidad.",
          "Si el código no coincide exacto, el código queda en el buscador con las coincidencias para que lo ubiques y lo agregues a mano.",
          "Un escáner USB o Bluetooth funciona como teclado: no necesita instalación; solo conéctalo.",
        ],
      },
      {
        titulo: "Venta rápida (producto o servicio no catalogado)",
        pasos: [
          "Requiere que tu empresa tenga activa la Venta Rápida (se activa de forma centralizada).",
          "En Nueva Venta presiona el botón 'Venta rápida'.",
          "Escribe la descripción de lo que vendes (ej. 'Reparación', 'Flete', 'Servicio'), el precio y la cantidad.",
          "Presiona 'Agregar al carrito': la línea aparece en la venta marcada como 'Venta rápida'.",
          "Continúa la venta normal (cliente, descuento, pago) y guarda. Esa línea NO descuenta inventario ni deja movimiento en el kardex; sí entra al total, al cobro y a la factura/tirilla.",
        ],
      },
      {
        titulo: "Venta con pago mixto (efectivo + tarjeta)",
        pasos: [
          "Arma la venta normalmente (cliente, productos, totales).",
          "En el desglose de pago agrega una línea 'Efectivo' con el monto en efectivo.",
          "Agrega otra línea 'Banco', elige la cuenta (ej. BAC) e ingresa el monto con tarjeta.",
          "El sistema muestra la comisión bancaria y el neto que entrará al banco.",
          "La suma de las líneas debe cubrir el total; guarda la venta.",
        ],
      },
      {
        titulo: "Venta al crédito",
        pasos: [
          "Arma la venta y en el desglose de pago usa el método 'Crédito' por el monto fiado (puede combinarse con un abono inicial en efectivo).",
          "La venta queda con estado 'Pendiente' o 'Parcial'.",
          "Los abonos posteriores se registran en Ventas → Cuentas por Cobrar / Pagos.",
        ],
      },
    ],
    faqs: [
      {
        pregunta: "Me dice 'Debe abrir caja antes de realizar ventas en efectivo', ¿qué hago?",
        respuesta:
          "Ve a Finanzas → Caja Chica y abre la sesión del día con el efectivo inicial. Solo entonces el sistema acepta cobros en efectivo (así el dinero queda controlado en caja).",
      },
      {
        pregunta: "¿Por qué el total que entra al banco es menor a lo que pagó el cliente?",
        respuesta:
          "Porque la cuenta tiene un % de comisión configurado (Configuración → Cuentas Bancarias). El cliente paga el bruto; el banco deposita el neto. La diferencia queda registrada como comisión y aparece en el Estado de Resultados.",
      },
      {
        pregunta: "Vendí un producto equivocado, ¿cómo lo corrijo?",
        respuesta:
          "Si el cliente devuelve parte, usa Ventas → Devoluciones (repone stock y reembolsa dinero). Si toda la venta fue un error, elimínala desde Ventas → Historial: se revierte inventario, caja y banco por completo.",
      },
      {
        pregunta: "¿Puedo vender sin stock?",
        respuesta:
          "El catálogo muestra el stock disponible como referencia. Evita vender sin existencias: el inventario quedaría negativo y la valoración se distorsiona.",
      },
      {
        pregunta: "La tirilla sale con mucho espacio en blanco o se corta, ¿por qué?",
        respuesta:
          "El sistema calcula el largo exacto del contenido, pero la impresora solo lo respeta si su tamaño de papel en el driver está en 'rollo/continuo' o en un tamaño personalizado. Si el driver está en A4/Carta, el navegador coloca la tirilla sobre esa hoja y reaparece el blanco: cámbialo en la configuración de la impresora del sistema. Si se corta la última línea, es cuestión de milímetros del margen inferior del rollo.",
      },
    ],
    keywords: [
      "vender", "factura", "pos", "cobrar", "efectivo", "tarjeta", "credito",
      "descuento", "isv", "impuesto", "comision", "ticket", "punto de venta",
      "punto de facturacion", "sucursal", "serie",
      "tirilla", "termica", "impresora", "80mm", "imprimir", "comprobante", "recibo",
      "pantalla completa", "pos", "kiosko", "caja",
      "vuelto", "cambio", "efectivo recibido", "con cuanto paga",
      "codigo de barras", "escaner", "escanear", "lector", "pistola", "barcode",
      "venta rapida", "servicio", "no catalogado", "sin inventario", "linea manual",
    ],
  },
  {
    modulo: "Historial Ventas",
    titulo: "Historial de Ventas",
    descripcion:
      "Consultar todas las facturas emitidas, ver su detalle, reimprimir PDF, registrar abonos y eliminar ventas erróneas.",
    queHace: [
      "Lista todas las facturas con filtros por fecha, cliente y método de pago.",
      "En la pestaña 'Resumen de Facturas', la columna 'Método' muestra cómo se cobró cada venta y, cuando fue por Banco (o Mixto), debajo indica a qué cuenta destino entró el dinero (ej. 'POS BP'). También sale en el Excel exportado, en la columna 'Cuenta Destino'.",
      "Detalle de cada factura: productos, cantidades, pagos registrados y saldo pendiente.",
      "Reimprime cualquier factura en dos formatos: factura A4 en PDF (ícono de descarga) o tirilla térmica de 80 mm (ícono de impresora), con el mismo formato que se imprime al momento de la venta.",
      "Registra abonos (parciales o totales) a facturas con saldo pendiente: el botón verde de pago aparece directo en la fila. El efectivo entra a la caja chica y los pagos por banco a la cuenta que elijas.",
      "Pestaña 'Detalle por Producto': todas las líneas vendidas con costo y utilidad, exportable a Excel.",
      "Si la empresa tiene Puntos de Facturación (sucursales), aparece la columna 'Punto' y un filtro por punto. Al reimprimir una factura fiscal se usa la foto de la autorización CAI con la que se emitió (CAI, rango, fecha límite), aunque el CAI se haya renovado después.",
      "Importar ventas desde Excel: sube una plantilla (una línea por producto), el sistema agrupa por factura y crea cada venta con sus mismas transacciones (inventario, caja/banco). Cada factura puede traer su método de pago en la columna «Metodo de Pago» (Efectivo, Banco o Credito): las de crédito quedan como cuenta por cobrar.",
      "ANULA una venta (botón rojo de prohibido) en vez de borrarla: la factura conserva su número y su detalle, pero deja de contar en reportes, cierre y cartera; los productos vuelven al inventario y, si había dinero cobrado, indicas de dónde sale el reembolso (caja chica o cuenta bancaria). Pide un MOTIVO obligatorio, queda en la bitácora de Auditoría y la factura se muestra tachada con la etiqueta ANULADA (oculta por defecto; actívala con el interruptor 'Mostrar anuladas'). Si la factura es fiscal (CAI) y el cliente ya se llevó el comprobante, lo correcto es una nota de crédito desde Devoluciones. No se puede anular una factura con devoluciones vigentes ni con abonos por recibo de cobro: anula primero esos documentos.",
      "Eliminar (borrado físico, con copia en 'Eliminadas') solo aparece si el administrador de la plataforma lo permitió para tu empresa. Con facturación fiscal se recomienda solo anular.",
      "Pestaña 'Eliminadas': lista las facturas borradas con su número, cliente, total, quién y cuándo las eliminó y el motivo; puedes abrir el detalle (productos) de cada una.",
      "Edita una venta (botón lápiz): cambia cantidades, productos, cliente o método de pago; el cambio se propaga a inventario, caja chica, cuentas bancarias y cuentas por cobrar, conservando el número de factura.",
    ],
    queNoHace: [
      "Al editar, no cambia el almacén ni la localización de la venta (para eso, elimínala y créala de nuevo).",
      "No se puede editar una factura con devoluciones asociadas (anúlalas primero), ni editar con efectivo sin una caja chica abierta.",
      "La eliminación no es reversible: una vez confirmada, la factura desaparece.",
      "La importación NO duplica facturas: si un número de factura ya existe, esa se omite. Los productos deben existir en el catálogo (se buscan por código de barras o nombre).",
    ],
    operaciones: [
      {
        titulo: "Buscar y reimprimir una factura",
        pasos: [
          "Abre Ventas → Historial Ventas.",
          "Filtra por rango de fechas o busca por cliente/número.",
          "Haz clic en el ícono de ojo para ver el detalle.",
          "En la fila, usa el ícono de descarga para regenerar la factura A4 en PDF, o el ícono de impresora para reimprimir la tirilla térmica de 80 mm.",
          "La tirilla respeta la configuración de tu empresa (mostrar u ocultar el ISV y el código de cada producto), igual que al momento de la venta.",
        ],
      },
      {
        titulo: "Registrar un abono a una factura pendiente",
        pasos: [
          "En Resumen de Facturas, ubica la factura con saldo (estado Pendiente o Parcial).",
          "Presiona el botón verde de pago en la fila (o dentro del detalle).",
          "El monto viene pre-llenado con el saldo total; edítalo si es un abono parcial.",
          "Elige el método: Efectivo (requiere caja abierta; entra a la caja), Banco (elige la cuenta; entra como ingreso) u Otro (solo baja el saldo, sin movimiento de dinero).",
          "Guarda: el saldo y el estado de la factura se actualizan, y el dinero queda en tesorería.",
        ],
      },
      {
        titulo: "Editar una venta",
        pasos: [
          "Ubica la factura y presiona el botón de lápiz (Editar).",
          "Ajusta lo que necesites: cliente, productos (agregar/quitar/cantidad/precio), descuento, ISV y el desglose de método de pago.",
          "Si cambias un pago de efectivo a banco (o al revés), el dinero se moverá solo entre la caja y la cuenta al guardar.",
          "Escribe un motivo (opcional) y presiona Guardar; confirma el resumen.",
          "El sistema revierte la venta original y la vuelve a aplicar con los datos nuevos; la factura conserva su número. Verifica el kardex, la caja y los bancos.",
        ],
      },
      {
        titulo: "Eliminar una venta errónea",
        pasos: [
          "Ubica la factura en la lista y presiona el ícono de basurero.",
          "Lee el resumen de lo que se revertirá (stock, caja, banco), escribe el MOTIVO (obligatorio) y confirma.",
          "La factura queda registrada en la pestaña 'Eliminadas' (con su detalle y motivo) por si necesitas consultarla después.",
          "Verifica en Inventario y Caja/Banco que los saldos volvieron a su estado anterior.",
        ],
      },
      {
        titulo: "Consultar una factura eliminada",
        pasos: [
          "Abre la pestaña 'Eliminadas' en el Historial de Ventas.",
          "Busca la factura por su número o cliente; verás quién la eliminó, cuándo y el motivo.",
          "Presiona el ojo para ver su detalle (productos y montos) tal como estaba al eliminarla.",
        ],
      },
      {
        titulo: "Exportar el detalle de ventas a Excel",
        pasos: [
          "Ve a la pestaña 'Detalle por Producto'.",
          "Aplica los filtros de fecha que necesites.",
          "Presiona 'Exportar': se descarga un .xlsx con columnas separadas (fecha, factura, cliente, producto, cantidades, costos y utilidad).",
        ],
      },
      {
        titulo: "Importar ventas desde un Excel",
        pasos: [
          "En 'Resumen de Facturas' presiona 'Importar ventas'.",
          "Descarga la plantilla y llénala: una fila por producto, con la columna Factura como agrupador (varias filas con la misma factura = una sola venta).",
          "Cliente por factura: la plantilla trae la columna «Cliente». Si el cliente no existe, se crea automáticamente (con su «Limite Credito» si lo pones). Si dejas la celda vacía, se usa el cliente por defecto del diálogo.",
          "Método de pago por factura: la columna «Metodo de Pago» (Efectivo, Banco o Credito). Las que pongas en Credito quedan como cuenta por cobrar (sin pago). Si la celda está vacía, se usa el método por defecto del diálogo.",
          "En el diálogo elige el cliente por defecto, el almacén/localización, el método por defecto y la cuenta bancaria (para las filas con Banco), y si aplica ISV.",
          "Sube el archivo: verás un resumen (facturas, líneas, total) y avisos de facturas duplicadas o productos no encontrados.",
          "Presiona 'Importar': cada factura se crea como una venta normal (baja stock; las de contado ingresan a caja/banco, las de crédito quedan pendientes). Una factura a crédito que supere el límite del cliente se omite con aviso.",
        ],
      },
    ],
    faqs: [
      {
        pregunta: "¿Cuándo eliminar una venta y cuándo hacer una devolución?",
        respuesta:
          "Eliminar es para errores de captura (la venta nunca debió existir): borra todo el rastro. Devolución es para cuando el cliente regresa productos de una venta real: la factura original queda intacta y se genera una nota de crédito.",
      },
      {
        pregunta: "¿Puedo eliminar una factura que ya tiene una devolución?",
        respuesta:
          "Sí. Al eliminar la factura, el sistema primero anula la(s) devolución(es) asociada(s) —revierte el stock que habían repuesto y el reembolso de caja/banco, y borra la devolución— y luego revierte la venta. La confirmación te avisa cuántas devoluciones se anularán. Todo queda cuadrado, sin movimientos huérfanos.",
      },
      {
        pregunta: "No veo facturas viejas en la lista, ¿dónde están?",
        respuesta:
          "El listado carga las 100 facturas más recientes; usa el botón 'Cargar más facturas' al final de la tabla para traer las anteriores, o el buscador para ubicar una específica.",
      },
      {
        pregunta: "Falta un número de factura (ej. salta del 1827 al 1829), ¿es un error?",
        respuesta:
          "No. Los números de factura no se reutilizan: si una factura se elimina (o su creación se interrumpe), su número queda 'usado' y la numeración continúa, dejando un salto. Es normal y evita duplicados. Si esa factura se eliminó, la encuentras en la pestaña 'Eliminadas' con su motivo.",
      },
      {
        pregunta: "Registré un abono y no bajó el saldo, ¿qué reviso?",
        respuesta:
          "Confirma que el abono se guardó en la factura correcta (detalle → pagos). El saldo pendiente es total menos abonos acumulados.",
      },
      {
        pregunta: "¿Puedo reimprimir la tirilla de una venta de días pasados?",
        respuesta:
          "Sí. En Resumen de Facturas cada fila tiene el ícono de impresora: reimprime la tirilla de 80 mm de esa venta con sus productos, pagos y saldo tal como quedaron guardados. Junto a él, el ícono de descarga regenera la factura A4 en PDF.",
      },
    ],
    keywords: ["facturas", "consultar", "reimprimir", "tirilla", "termica", "80mm", "abono", "eliminar venta", "anular", "anulada", "anulacion", "motivo", "reembolso", "mostrar anuladas", "exportar", "excel", "historial", "punto", "sucursal"],
  },
  {
    modulo: "Catalogo",
    titulo: "Catálogo (pedidos por link)",
    descripcion:
      "Genera links de catálogo para enviar a tus clientes: ellos arman su carrito sin necesidad de usuario, y tú conviertes el pedido en una venta al aprobarlo.",
    queHace: [
      "Genera links únicos de catálogo: completo (todos tus productos) o una selección específica para ese cliente.",
      "Al 'Seleccionar productos', puedes filtrar el listado por nombre/código, marca, categoría, subcategoría y talla (la subcategoría se limita a la categoría elegida) y 'Seleccionar todo lo filtrado' de un clic.",
      "El cliente abre el link SIN iniciar sesión, ve productos con foto, precio de catálogo y disponibilidad, arma su carrito y lo envía con su nombre y teléfono.",
      "El link se vence automáticamente al enviarse el carrito, al pasar su vigencia (días configurables) o si lo anulas.",
      "Los pedidos llegan a tu bandeja en estado Pendiente: puedes modificar cantidades y precios, rechazar con motivo, o aprobar.",
      "Al aprobar se genera una VENTA real: factura correlativa, descuento de inventario, y el cobro entra a caja o banco según el método que elijas (o queda al crédito).",
      "El pedido aprobado queda enlazado a su factura; historial exportable a Excel.",
    ],
    queNoHace: [
      "El pedido NO descuenta inventario ni mueve dinero hasta que lo APRUEBAS: es solo una solicitud del cliente.",
      "El cliente no ve costos, stock exacto ni datos internos — solo nombre, foto, precio de catálogo y Disponible/Agotado.",
      "Los precios que ve el cliente son los de catálogo (precio de venta sugerido); el sistema nunca acepta precios manipulados desde el navegador del cliente.",
      "Un link usado no revive: si el cliente quiere pedir de nuevo, genera otro link.",
      "Para que el link funcione fuera de tu red local, la aplicación debe estar publicada en internet.",
    ],
    operaciones: [
      {
        titulo: "Generar y enviar un link de catálogo",
        pasos: [
          "Abre Ventas → Catálogo, pestaña 'Links de catálogo' y presiona 'Nuevo link' (se abre una pantalla completa).",
          "Ponle una referencia interna (ej. 'Catálogo Doña María') y define la vigencia en días (ej. 7).",
          "Elige el tipo: catálogo completo o selección de productos. Si es selección, usa los filtros (marca, categoría, subcategoría, talla o texto) para acotar y marca los productos.",
          "Presiona 'Generar link': se copia solo al portapapeles; pégalo en WhatsApp o correo al cliente.",
        ],
      },
      {
        titulo: "Revisar y aprobar un pedido",
        pasos: [
          "Cuando el cliente envía su carrito, aparece en la pestaña 'Pedidos' como Pendiente.",
          "Presiona 'Revisar': verás los productos, cantidades, precios y las notas del cliente.",
          "Ajusta cantidades o precios si es necesario (la columna Stock te muestra la disponibilidad real).",
          "Presiona 'Aprobar y facturar': asocia el cliente (o créalo con un clic desde los datos del pedido), elige almacén/localización y el método de pago.",
          "Confirma: se genera la factura, baja el stock y el dinero entra a caja o banco (o queda por cobrar si fue a crédito).",
        ],
      },
      {
        titulo: "Rechazar un pedido",
        pasos: [
          "Abre el pedido con 'Revisar'.",
          "Presiona 'Rechazar', escribe el motivo y confirma.",
          "El pedido queda Rechazado con su motivo guardado; no afecta inventario ni dinero.",
        ],
      },
    ],
    faqs: [
      {
        pregunta: "El cliente dice que el link 'no está disponible', ¿por qué?",
        respuesta:
          "El link muere al enviarse un carrito, al pasar su vigencia o si fue anulado. Genera un link nuevo y envíaselo.",
      },
      {
        pregunta: "¿Puedo cambiar los precios que pidió el cliente?",
        respuesta:
          "Sí. En la revisión puedes ajustar precio y cantidad de cada línea antes de aprobar; la factura se genera con los valores finales que dejes.",
      },
      {
        pregunta: "¿Qué pasa si ya no tengo stock de algo que pidieron?",
        respuesta:
          "La columna Stock de la revisión te lo marca en rojo. Baja la cantidad de esa línea (o recházala) — el sistema no deja facturar más de lo disponible.",
      },
      {
        pregunta: "¿El mismo link sirve para varios clientes?",
        respuesta:
          "Sirve para quien lo abra primero y envíe un carrito: en ese momento muere. Si quieres atender a varios clientes, genera un link para cada uno.",
      },
    ],
    keywords: [
      "catalogo", "link", "whatsapp", "carrito", "pedido", "cliente pide",
      "aprobar", "rechazar", "vender a distancia", "compartir catalogo",
    ],
  },
  {
    modulo: "Devoluciones",
    titulo: "Devoluciones (notas de crédito)",
    descripcion:
      "Devolver productos de una factura: repone el inventario y reembolsa el dinero, dejando la factura original intacta.",
    queHace: [
      "Busca la factura por número o cliente y muestra sus líneas.",
      "Permite elegir cuántas unidades devolver por producto (devolución parcial), con tope en lo vendido menos lo ya devuelto.",
      "Repone el stock al almacén del que salió la venta y deja rastro en el kardex.",
      "Reembolsa el dinero al destino que elijas: efectivo de caja chica o egreso de una cuenta bancaria.",
      "Pide confirmación con un resumen (productos, cantidades, monto, destino) antes de ejecutar.",
      "Genera un correlativo DEV-0001, guarda el motivo, y mantiene un historial exportable a Excel.",
      "Si tu empresa tiene Facturación CAI activa y la factura original lleva número fiscal, la devolución emite además una NOTA DE CRÉDITO fiscal (tipo 06) con su propio correlativo del SAR (requiere configurar el CAI de Nota de Crédito en Configuración → Facturación CAI).",
      "No se puede devolver una factura anulada. Una devolución registrada se puede anular (queda marcada, el stock devuelto vuelve a salir y el reembolso vuelve a entrar).",
      "Al procesar la devolución abre un diálogo para imprimir su comprobante: tirilla térmica (80 mm) o factura de devolución en PDF (mismo formato que la factura normal), con los datos de la factura original y los productos específicos devueltos. Desde el Historial puedes volver a imprimir cualquiera de los dos.",
      "El Estado de Resultados descuenta automáticamente las devoluciones (ventas netas).",
    ],
    queNoHace: [
      "No modifica ni elimina la factura original: la devolución es un registro aparte (nota de crédito).",
      "No permite devolver más unidades de las vendidas (ni de las que ya se devolvieron antes).",
      "No recalcula el costo promedio del producto: la mercancía reingresa al costo que tenía al venderse.",
      "El reembolso en efectivo requiere una sesión de caja chica abierta.",
    ],
    operaciones: [
      {
        titulo: "Procesar una devolución parcial",
        pasos: [
          "Abre Ventas → Devoluciones, pestaña 'Nueva devolución'.",
          "Busca la factura (ej. FC-0042) y selecciónala.",
          "En cada producto a devolver, indica la cantidad con los botones + / − (la columna 'Ya devuelto' muestra devoluciones previas).",
          "Elige a dónde devolver el dinero: Caja Chica (efectivo) o una cuenta bancaria.",
          "Escribe el motivo (opcional) y presiona 'Procesar devolución'.",
          "Revisa el resumen del diálogo de confirmación y confirma.",
          "Al confirmar se abre un diálogo para imprimir el comprobante: tirilla (80 mm) o factura de devolución (PDF) con los productos devueltos.",
          "Verifica el resultado en la pestaña 'Historial'.",
        ],
      },
      {
        titulo: "Consultar el historial y reimprimir la factura de devolución",
        pasos: [
          "Entra a la pestaña 'Historial'.",
          "Revisa devolución, fecha, factura, cliente, vía de reembolso y monto.",
          "Usa los botones 'Tirilla' y 'PDF' de cada fila para volver a imprimir el comprobante de esa devolución.",
          "Presiona 'Exportar a Excel' para descargar el listado completo.",
        ],
      },
    ],
    faqs: [
      {
        pregunta: "¿El dinero sale de donde entró originalmente?",
        respuesta:
          "Tú eliges el destino al confirmar: caja (efectivo) o la cuenta bancaria que indiques, sin importar cómo pagó el cliente. Elige la vía por la que realmente le devuelves el dinero.",
      },
      {
        pregunta: "La venta era al crédito y no se ha pagado, ¿igual devuelvo dinero?",
        respuesta:
          "Si no hubo pago real, no deberías sacar dinero. Registra la devolución solo si vas a entregar dinero; para ajustar una deuda no cobrada, considera eliminar la venta y refacturar correctamente.",
      },
      {
        pregunta: "Me dice que no puedo devolver esa cantidad.",
        respuesta:
          "El tope por línea es lo vendido menos lo ya devuelto en devoluciones anteriores. Revisa la columna 'Ya devuelto'.",
      },
      {
        pregunta: "¿Dónde veo el efecto en los reportes?",
        respuesta:
          "El stock sube en Inventario, el dinero sale en Caja Chica o Movimientos de Cuentas (concepto 'Devolución DEV-XXXX'), y el Estado de Resultados del mes resta la devolución de las ventas.",
      },
    ],
    keywords: [
      "devolver", "reembolso", "nota de credito", "cambio", "producto defectuoso",
      "regresar", "reversar", "dev",
      "factura de devolucion", "imprimir devolucion", "pdf devolucion", "comprobante devolucion",
      "nota de credito fiscal", "cai 06", "anular devolucion",
    ],
  },
  {
    modulo: "Reclamos de Ventas",
    titulo: "Reclamos de Ventas",
    descripcion:
      "Registrar los reclamos del cliente sobre una factura (producto, precio, entrega u otro) y documentar cómo se resolvieron.",
    queHace: [
      "Registra un reclamo sobre una factura vigente: tipo (Producto, Precio, Entrega, Otro) y descripción. Queda 'Abierto' con fecha y quién lo registró.",
      "Resuelve el reclamo con una decisión (procede / no procede), lo acordado con el cliente y qué se hizo: sin cambio, devolución/nota de crédito o anulación de la factura.",
      "La devolución o la anulación en sí se ejecutan desde Ventas → Devoluciones o desde el Historial (botón Anular); el reclamo solo las documenta.",
      "Lista los reclamos abiertos, resueltos y rechazados, con búsqueda por factura o cliente; un reclamo cerrado se puede reabrir.",
      "Cada registro y resolución queda en la bitácora de Auditoría.",
    ],
    queNoHace: [
      "No mueve inventario ni dinero: eso lo hacen Devoluciones y la anulación de la factura.",
      "No aparece si el administrador de la plataforma no habilitó el módulo para tu empresa.",
    ],
    operaciones: [
      {
        titulo: "Registrar y resolver un reclamo",
        pasos: [
          "Abre Ventas → Reclamos de Ventas y presiona Nuevo Reclamo.",
          "Busca la factura (por número o cliente), elige el tipo y describe el reclamo. Guarda.",
          "Cuando tengas la respuesta, presiona Resolver: indica si procede, qué se hizo (sin cambio / devolución / anulación) y escribe la resolución.",
          "Si procede una devolución, regístrala en Ventas → Devoluciones; si procede anular, hazlo desde el Historial con el botón Anular.",
        ],
      },
    ],
    faqs: [
      {
        pregunta: "¿El reclamo devuelve el dinero al cliente?",
        respuesta:
          "No por sí solo. El reclamo documenta la queja y la decisión; el dinero y el inventario se mueven al registrar la devolución (nota de crédito) o al anular la factura, que son las acciones que quedan enlazadas al reclamo.",
      },
    ],
    keywords: ["reclamo", "reclamos", "queja", "garantia", "resolucion", "procede", "no procede", "seguimiento", "cliente insatisfecho"],
  },
  {
    modulo: "Cotizaciones",
    titulo: "Cotizaciones (presupuestos)",
    descripcion:
      "Cotiza a clientes o prospectos con vigencia, envíala en PDF, márcala aprobada y factúrala en un clic desde Nueva Venta.",
    queHace: [
      "Crea cotizaciones con número correlativo COT-####, cliente registrado o solo el nombre del prospecto, vendedor, vigencia (15 días por defecto), descuento global, ISV opcional, condiciones (van en el PDF) y notas internas.",
      "Líneas del catálogo (con el precio de la lista del cliente si tiene) o líneas libres (servicios, conceptos), cada una con cantidad, precio y % de descuento propio.",
      "Estados: Borrador → Enviada → Aprobada → Facturada. Una Borrador/Enviada que pasa su vigencia se marca Vencida automáticamente al abrir el módulo; se puede reactivar con nueva vigencia. Rechazada guarda el motivo (precio, plazo…).",
      "Facturar: lleva la cotización a Nueva Venta con el cliente, las líneas y los precios cotizados (no se re-precian); al cobrar, la cotización queda Facturada con el número de la factura.",
      "PDF de la cotización con logo, vigencia y condiciones; Excel del listado; duplicar cualquier cotización como nuevo borrador.",
      "El menú muestra cuántas cotizaciones enviadas/aprobadas vencen en los próximos 3 días.",
    ],
    queNoHace: [
      "No afecta inventario ni dinero: solo la venta que se genera al facturarla descuenta stock y cobra.",
      "No se edita una cotización Aprobada, Facturada, Vencida o Rechazada: duplícala para hacer una nueva versión.",
      "No envía correos por sí misma (descarga el PDF y envíalo); la firma digital y el envío automático llegan en fases posteriores.",
      "Solo se elimina un Borrador; las demás se rechazan para conservar la historia.",
    ],
    operaciones: [
      {
        titulo: "Crear y enviar una cotización",
        pasos: [
          "Abre Ventas → Cotizaciones → 'Nueva cotización'.",
          "Elige el cliente (o escribe el nombre del prospecto), la vigencia y, si aplica, el vendedor, descuento e ISV.",
          "Agrega productos del catálogo (buscador) o líneas libres con descripción, cantidad y precio; ajusta % por línea si hace falta.",
          "Escribe las condiciones (forma de pago, entrega) y guarda: se asigna el número COT-####.",
          "En el listado, menú de la fila → PDF para enviarla, y 'Marcar como enviada'.",
        ],
      },
      {
        titulo: "Aprobar y facturar",
        pasos: [
          "Cuando el cliente confirme, menú → 'Aprobada por el cliente'.",
          "Menú → 'Facturar (Nueva Venta)': se abre el punto de venta con todo cargado.",
          "Revisa almacén, stock y cobro, y guarda la venta. La cotización pasa a Facturada.",
        ],
      },
      {
        titulo: "Reactivar una vencida o registrar una perdida",
        pasos: [
          "Vencida → menú → 'Reactivar (nueva vigencia)' y vuelve a Enviada.",
          "Si el cliente no compró: menú → 'Rechazada / perdida' con el motivo.",
        ],
      },
    ],
    faqs: [
      {
        pregunta: "¿Por qué en Nueva Venta el precio no cambió al elegir el cliente?",
        respuesta:
          "Las líneas que vienen de una cotización llevan el precio pactado y no se re-precian con la lista del cliente. Si quieres el precio de lista, quita la línea y vuelve a agregarla desde el catálogo.",
      },
      {
        pregunta: "Facturé pero la cotización sigue Aprobada.",
        respuesta:
          "La venta se creó desde Nueva Venta sin pasar por 'Facturar' en Cotizaciones. Usa siempre ese botón para que se enlacen; si ya ocurrió, márcala Rechazada con el motivo 'facturada aparte' o duplícala.",
      },
      {
        pregunta: "Veo 'Cotizaciones pendientes: aplica scripts/officemart-006…'.",
        respuesta: "La base de datos aún no tiene las tablas del módulo. Pide al administrador que ejecute ese script en Supabase.",
      },
    ],
    keywords: [
      "cotizacion", "cotizaciones", "presupuesto", "proforma", "prospecto", "vigencia", "vencida",
      "aprobada", "facturar cotizacion", "convertir a venta", "pdf cotizacion", "condiciones", "cot",
    ],
  },
]
