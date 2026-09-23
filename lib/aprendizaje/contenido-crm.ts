import type { TutorialModulo } from "./types"

/** Tutoriales de la categoría CRM (script officemart-016). */
export const TUTORIALES_CRM: TutorialModulo[] = [
  {
    modulo: "CRM Pipeline",
    titulo: "CRM · Pipeline de oportunidades",
    descripcion:
      "Tablero de negocios en curso por etapa (Prospecto → Contacto → Propuesta → Negociación → Cierre), con valor estimado, vendedor, contactos y enlace directo a cotizaciones.",
    queHace: [
      "Tablero (kanban) con una columna por etapa: arrastra la tarjeta a otra columna para avanzarla, o usa «Mover a» en el menú de la tarjeta (celular).",
      "Cada oportunidad tiene cliente (o prospecto sin ficha), contacto, vendedor, valor estimado, fecha de cierre esperada, origen y notas. Semáforos: cierre vencido (rojo) y más de 14 días sin movimiento (ámbar).",
      "Desde la tarjeta: programar actividad, crear cotización (abre Nueva Cotización con el cliente ya elegido y la liga a la oportunidad), marcar ganada o perdida (con motivo) y reabrir.",
      "Pestaña Lista con filtros (estado, vendedor, búsqueda) y exportación a Excel; pestaña Contactos (personas por cliente, con cumpleaños); pestaña Etapas (solo admin) para renombrar, ordenar, cambiar la probabilidad o desactivar columnas.",
      "Desde Clientes, el botón CRM abre el pipeline filtrado por ese cliente (ficha 360°).",
      "Si la empresa no tiene etapas, se crean 5 por defecto la primera vez.",
    ],
    queNoHace: [
      "No factura ni mueve inventario: la venta se registra en Ventas cuando se concreta.",
      "Marcar «ganada» no crea la venta ni cambia la cotización; es el cierre comercial para los reportes.",
      "No envía correos ni recordatorios automáticos (la agenda muestra lo pendiente al entrar).",
    ],
    operaciones: [
      { titulo: "Registrar una oportunidad nueva", pasos: ["CRM → Pipeline → Nueva oportunidad.", "Escribe el título; elige el cliente (o marca «Prospecto» y escribe su nombre), contacto, etapa, valor estimado y fecha de cierre esperada.", "Guarda. Aparece en la columna de su etapa; programa la primera actividad con «+ programar actividad»."] },
      { titulo: "Avanzar y cerrar", pasos: ["Arrastra la tarjeta a la siguiente etapa (o menú → Mover a).", "En Propuesta: menú → Crear cotización; al guardarla queda ligada (menú → Ver cotización).", "Al concretar: menú → Marcar ganada. Si se pierde: Marcar perdida e indica el motivo (alimenta el reporte de motivos)."] },
      { titulo: "Configurar etapas (admin)", pasos: ["Pestaña Etapas → Nueva etapa o el lápiz.", "Define orden y probabilidad (%): el reporte pondera el valor de cada oportunidad por la probabilidad de su etapa.", "Una etapa con oportunidades no se puede eliminar: muévelas o desactívala."] },
    ],
    faqs: [
      { pregunta: "¿Puedo tener oportunidades sin cliente registrado?", respuesta: "Sí: marca «Prospecto (sin ficha)» y escribe el nombre. Cuando se concrete, crea el cliente en Configuración → Clientes y edita la oportunidad para ligarlo." },
      { pregunta: "¿Quién ve qué?", respuesta: "Todos los usuarios con el módulo ven todas las oportunidades de la empresa; el filtro por vendedor recuerda al tuyo si estás ligado a un vendedor (Vendedores y Zonas)." },
    ],
    keywords: ["crm", "pipeline", "oportunidad", "prospecto", "embudo", "kanban", "etapa", "negociacion", "ganada", "perdida", "contactos", "probabilidad", "ponderado", "seguimiento comercial"],
  },
  {
    modulo: "CRM Agenda",
    titulo: "CRM · Agenda de seguimiento",
    descripcion:
      "Llamadas, visitas, reuniones, correos y tareas programadas por vendedor: vencidas, de hoy y de los próximos 7 días, más cumpleaños de clientes y contactos.",
    queHace: [
      "Programa actividades con fecha y hora, ligadas a una oportunidad, cliente y contacto; el responsable es un vendedor.",
      "Tres bloques: Vencidas (rojo), Hoy y Próximos 7 días. El sidebar muestra en rojo cuántas están vencidas o son de hoy.",
      "Completar pide el resultado (qué pasó) y permite programar la siguiente actividad de una vez; las completadas de los últimos 30 días se ven en el historial.",
      "Cumpleaños de la semana: usa la fecha de nacimiento del cliente (Configuración → Clientes) y el cumpleaños de los contactos del CRM.",
      "Si estás ligado a un vendedor, la agenda abre filtrada por ti; puedes ver la de todos o la de otro vendedor.",
    ],
    queNoHace: [
      "No envía recordatorios por correo/WhatsApp ni sincroniza con Google Calendar.",
      "Completar una actividad no cambia la etapa de la oportunidad (hazlo en el pipeline).",
    ],
    operaciones: [
      { titulo: "Programar un seguimiento", pasos: ["CRM → Agenda → Nueva actividad (o desde la tarjeta en el pipeline).", "Elige tipo, fecha/hora, asunto, oportunidad (rellena cliente y contacto) y responsable.", "Guarda. Aparece en Hoy o Próximos según la fecha."] },
      { titulo: "Cerrar el día", pasos: ["Revisa Vencidas y Hoy; en cada una pulsa Completar, anota el resultado y marca «Programar la siguiente» si hace falta.", "Lo que no se hizo puede editarse (lápiz) para moverlo de fecha."] },
    ],
    faqs: [
      { pregunta: "¿Qué zona horaria usan las fechas?", respuesta: "Hora de Honduras, como el resto del sistema." },
      { pregunta: "¿Por qué no veo un cumpleaños?", respuesta: "Solo se listan los de los próximos 7 días y requieren fecha de nacimiento en el cliente o cumpleaños en el contacto." },
    ],
    keywords: ["agenda", "actividades", "llamada", "visita", "reunion", "tarea", "seguimiento", "vencidas", "cumpleaños", "recordatorio", "pendientes", "crm"],
  },
  {
    modulo: "CRM Reportes",
    titulo: "CRM · Reportes de gestión",
    descripcion:
      "Pipeline ponderado por etapa, tasa de cierre por vendedor y por origen, motivos de pérdida y actividades realizadas en un rango de fechas.",
    queHace: [
      "Tarjetas: oportunidades abiertas, valor del pipeline, valor ponderado (valor × probabilidad de la etapa), ganadas/perdidas con valor ganado, tasa de cierre y cierres vencidos.",
      "Gráfico de barras por etapa (valor vs ponderado) y tablas por vendedor y por origen con abiertas, ganadas, perdidas y tasa.",
      "Motivos de pérdida más frecuentes y conteo de actividades por tipo en el rango.",
      "Exporta todo a Excel en una hoja con la columna Sección.",
    ],
    queNoHace: [
      "No mide ventas facturadas ni comisiones (eso está en Reportes de Ventas y Comisiones).",
      "El pipeline es la foto actual de las abiertas: el rango de fechas solo aplica a cerradas y actividades.",
    ],
    operaciones: [
      { titulo: "Revisar el mes comercial", pasos: ["CRM → Reportes; ajusta «Cerradas desde/hasta» al mes y pulsa Aplicar.", "Mira la tasa de cierre por vendedor y los motivos de pérdida.", "Exporta a Excel para la reunión de ventas."] },
    ],
    faqs: [
      { pregunta: "¿Cómo se calcula el ponderado?", respuesta: "Suma de valor estimado × probabilidad (%) de la etapa en que está cada oportunidad abierta. Ajusta las probabilidades en Pipeline → Etapas (admin)." },
    ],
    keywords: ["reporte crm", "tasa de cierre", "pipeline ponderado", "motivos de perdida", "origen", "por vendedor", "embudo de ventas", "forecast", "pronostico"],
  },
]
