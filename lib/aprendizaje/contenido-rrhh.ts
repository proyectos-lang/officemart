import type { TutorialModulo } from "./types"

/** Tutoriales de la categoría RRHH (script officemart-018). */
export const TUTORIALES_RRHH: TutorialModulo[] = [
  {
    modulo: "Empleados",
    titulo: "Empleados y expediente",
    descripcion: "Ficha del colaborador: datos personales, puesto, fecha de ingreso, salario mensual, frecuencia y forma de pago, afiliaciones IHSS/RAP y expediente digital con vencimientos.",
    queHace: [
      "Alta y edición en tres pestañas: Personal (identidad, RTN, nacimiento, contacto), Laboral (puesto, ingreso, contrato, frecuencia Mensual/Quincenal, salario, usuario de la app para marcar, vendedor para comisiones) y Pago y afiliaciones (transferencia/efectivo, banco, IHSS, RAP, ISR).",
      "Expediente: sube identidad, contrato, certificados… al bucket privado; con fecha de vencimiento avisa 30 días antes (banner arriba).",
      "Baja con fecha de salida: el empleado deja de entrar en nóminas posteriores y se prorratea la última; se puede reactivar.",
      "Muestra antigüedad y días de vacaciones que corresponden (10/12/15/20 según años). Exporta a Excel.",
      "Vacaciones (ícono de palmera): causación por antigüedad (años completos + proporcional del año en curso), días gozados, días pagados y saldo en días y en lempiras; registra días gozados o liquida (paga) días no gozados, que la próxima nómina paga a salario diario.",
    ],
    queNoHace: [
      "No calcula prestaciones por despido (cesantía, preaviso) ni liquidaciones finales: eso se registra como novedades.",
      "No crea usuarios de la app: primero créalo en Configuración → Usuarios y luego lígalo aquí.",
    ],
    operaciones: [
      { titulo: "Liquidar vacaciones no gozadas", pasos: ["RRHH → Empleados → ícono de palmera del empleado.", "Revisa el saldo causado.", "Elige «Liquidar (pagar)», los días (no más que el saldo) y la fecha; Registrar.", "Genera la nómina del período: aparece la línea «Vacaciones pagadas» por días × salario diario."] },
      { titulo: "Dar de alta un empleado", pasos: ["RRHH → Empleados → Nuevo empleado.", "Llena Personal y Laboral (salario mensual y frecuencia son la base de la nómina).", "En Pago y afiliaciones marca si cotiza IHSS/RAP y si se le retiene ISR (normalmente sí).", "Guarda y sube su identidad y contrato en el expediente."] },
    ],
    faqs: [
      { pregunta: "¿Empleado por hora?", respuesta: "Registra el salario mensual equivalente y usa novedades de ausencia/horas extra; el cálculo de horas usa salario ÷ 30 ÷ 8." },
    ],
    keywords: ["vacaciones", "causacion de vacaciones", "liquidacion de vacaciones", "saldo de vacaciones", "empleado", "empleados", "colaborador", "expediente", "contrato", "identidad", "salario", "alta", "baja", "vacaciones", "antiguedad", "rrhh"],
  },
  {
    modulo: "Asistencia",
    titulo: "Asistencia y marcación",
    descripcion: "Marcación de entrada/salida desde la app (usuario ligado a empleado), registro manual e importación del reloj marcador en Excel; resumen de días y horas por rango.",
    queHace: [
      "«Mi marcación de hoy»: si tu usuario está ligado a un empleado, marca entrada y salida con la hora de Honduras; calcula las horas del día.",
      "Registro manual por empleado y día (reemplaza el día si ya existe) e importación desde Excel con columnas Empleado (código o nombre), Fecha, Entrada, Salida; vista previa con filas resueltas y errores.",
      "Tabla por rango con filtro de empleado, edición y borrado; resumen de días y horas por empleado y aviso de días sin salida. Exporta a Excel.",
    ],
    queNoHace: [
      "No descuenta automáticamente ausencias en la nómina: registra la ausencia como novedad (tipo Ausencia) para que reste días.",
      "No controla geolocalización ni foto.",
    ],
    operaciones: [
      { titulo: "Importar el reloj del mes", pasos: ["RRHH → Asistencia → Importar y elige el Excel exportado del reloj.", "Revisa la vista previa: las filas en rojo no se importan (empleado no encontrado o fecha inválida).", "Importar válidas. Ajusta con el lápiz lo que haga falta."] },
    ],
    faqs: [
      { pregunta: "¿Por qué no aparece «Mi marcación»?", respuesta: "Tu usuario no está ligado a un empleado: Empleados → editar → Laboral → Usuario de la app." },
    ],
    keywords: ["asistencia", "marcacion", "marcar", "entrada", "salida", "reloj", "horas trabajadas", "importar asistencia", "control de asistencia"],
  },
  {
    modulo: "Novedades",
    titulo: "Novedades de nómina",
    descripcion: "Todo lo que cambia el pago del período: horas extra (diurna, mixta, nocturna), bonos, comisiones, aguinaldos, permisos, incapacidades, ausencias, deducciones, anticipos y préstamos.",
    queHace: [
      "Cada novedad tiene empleado, tipo, fecha y horas/días o monto. Los ingresos indican si gravan ISR y si cotizan IHSS/RAP (valores por defecto según el tipo; el aguinaldo nace exento).",
      "Ausencias y permisos sin goce descuentan días (salario ÷ 30 por día); vacaciones gozadas, permisos con goce e incapacidades son informativos. «Vacaciones pagadas» (liquidación) paga días × salario diario y descuenta el saldo de vacaciones.",
      "«Generar 13.º/14.º» crea el aguinaldo proporcional por empleado activo (salario × meses trabajados en la ventana ÷ 12) como novedad exenta.",
      "Al generar la nómina, las novedades pendientes con fecha hasta el fin del período se aplican y quedan ligadas (#nómina); si la nómina se anula, se liberan.",
    ],
    queNoHace: [
      "No calcula el aguinaldo con promedio de los últimos 6 meses (usa el salario actual); ajusta el monto si tu política es otra.",
      "No amortiza préstamos automáticamente: registra cada cuota como novedad Prestamo.",
    ],
    operaciones: [
      { titulo: "Registrar horas extra", pasos: ["RRHH → Novedades → Nueva novedad.", "Empleado, tipo Horas extra diurna/mixta/nocturna, fecha y horas.", "Guarda: se paga en la próxima nómina con el recargo de Parámetros (25 %, 50 %, 75 %)."] },
    ],
    faqs: [
      { pregunta: "Registré mal una novedad ya aplicada", respuesta: "Anula la nómina (si está en borrador o aprobada), corrige la novedad y vuelve a generar." },
    ],
    keywords: ["novedad", "novedades", "horas extra", "bono", "comision", "aguinaldo", "decimo tercer", "decimo cuarto", "catorceavo", "treceavo", "permiso", "incapacidad", "ausencia", "anticipo", "prestamo", "deduccion"],
  },
  {
    modulo: "Nómina",
    titulo: "Nómina (planilla)",
    descripcion: "Corrida mensual o quincenal: salario del período, horas extra, novedades, IHSS, RAP e ISR por empleado; aprobación, pago como gasto, planilla Excel y boletas PDF.",
    queHace: [
      "Generar: elige tipo y período; toma los empleados activos de esa frecuencia (prorratea altas y bajas dentro del período), sus novedades sin aplicar y los parámetros vigentes a la fecha final. Queda en Borrador.",
      "Por empleado: salario del período, horas extra, otros ingresos, devengado; IHSS y RAP del empleado sobre el equivalente mensual (con techos), ISR proyectando el salario ×12 menos IHSS y L 40,000 de gastos médicos (los extras gravables tributan a la tasa marginal), otras deducciones, neto y aportes patronales. Despliega la fila para ver cada línea.",
      "Borrador → Recalcular (si cambiaste empleados/novedades/parámetros) o Aprobar. Aprobada → Pagar: crea el gasto «Sueldos y salarios» por el neto (pagado desde caja o banco) y «Cargas sociales y retenciones» pendiente de pago a IHSS/RAP/SAR.",
      "Anular (borrador o aprobada) libera las novedades. Planilla Excel y boletas PDF (una página por empleado con firma de recibido).",
      "El ojo de cada nómina abre su detalle en una ventana. En cada empleado, «Comprobante» descarga su comprobante de pago en PDF para enviárselo: datos del empleado (identidad, puesto, ingreso, antigüedad, IHSS, RAP, cuenta), base salarial (mensual, diaria, por hora, días pagados), ingresos, deducciones, neto en número y letras, y prestaciones informativas (aportes patronales, saldo de vacaciones, 13.º y 14.º acumulados a la fecha de corte).",
      "Nómina complementaria: si ya existe una nómina vigente del mismo tipo y período, generar otra incluye solo a los empleados que faltan (altas a mitad de mes u omisiones) y se marca «Complementaria».",
    ],
    queNoHace: [
      "No genera archivos bancarios de pago masivo ni la planilla oficial del IHSS/SAR (usa la planilla Excel).",
      "Una nómina pagada no se anula desde aquí: anula el gasto en Gastos y vuelve a correrla.",
      "No calcula prestaciones laborales (cesantía, preaviso, vacaciones pagadas al salir).",
    ],
    operaciones: [
      { titulo: "Cerrar la quincena", pasos: ["Registra novedades del período (horas extra, ausencias, anticipos).", "RRHH → Nómina → Generar nómina (Quincenal, 1–15 o 16–fin).", "Revisa cada empleado (despliega la fila); si algo falta, corrige y Recalcular.", "Aprobar → Pagar (banco o caja) → Boletas PDF para firmar."] },
    ],
    faqs: [
      { pregunta: "¿Por qué el IHSS es igual para salarios altos?", respuesta: "Se cotiza hasta el techo (L 11,903.13 en 2026): máximo L 595.16 del empleado. Ajusta el techo en Parámetros cuando cambie." },
      { pregunta: "¿Cómo se reparte en quincenas?", respuesta: "Salario, IHSS, RAP e ISR se calculan sobre el equivalente mensual y se toma la mitad en cada quincena." },
    ],
    keywords: ["nomina", "planilla", "quincena", "pago de salarios", "boleta", "comprobante de pago", "colilla", "volante de pago", "liquidacion de nomina", "ihss", "rap", "isr", "retencion", "aporte patronal", "neto", "devengado", "sueldos"],
  },
  {
    modulo: "Parámetros RRHH",
    titulo: "Parámetros de nómina",
    descripcion: "Porcentajes y techos del IHSS, RAP, tabla progresiva del ISR, deducción médica, recargos de horas extra y base de jornada, versionados por fecha de vigencia.",
    queHace: [
      "Guarda versiones con «vigente desde»: la nómina usa la última versión vigente a la fecha final del período (así una nómina de diciembre no cambia si en enero actualizas la tabla).",
      "Valores 2026 de referencia precargados: IHSS EM 2.5 %/5 % e IVM 2.5 %/3.5 % con techo L 11,903.13; RAP 1.5 %/1.5 % sobre el excedente de L 11,903.13 hasta L 57,896.16; ISR exento hasta L 228,324.32 anual y tramos 15/20/25 %; deducción médica L 40,000; recargos 25/50/75 %.",
      "Simulador: escribe un salario y ve IHSS, RAP, ISR, neto y costo empresa con los valores del formulario antes de guardar.",
    ],
    queNoHace: [
      "No se actualiza solo cuando el IHSS o la SAR publican nuevos techos o tablas: crea una versión nueva cada enero (o cuando cambien) y valida con tu contador.",
    ],
    operaciones: [
      { titulo: "Actualizar la tabla del año", pasos: ["RRHH → Parámetros → ajusta techos, porcentajes y tramos.", "Pon «Vigente desde» al 1 de enero y un nombre (p. ej. «SAR 2027»).", "Guardar versión. Las nóminas de ese año usarán la nueva versión."] },
    ],
    faqs: [
      { pregunta: "Sin versiones guardadas, ¿qué usa la nómina?", respuesta: "Los valores 2026 de referencia incluidos en el sistema." },
    ],
    keywords: ["parametros", "techo ihss", "porcentaje ihss", "rap", "tabla isr", "tramos", "deduccion medica", "recargo horas extra", "salario minimo", "sar"],
  },
]
