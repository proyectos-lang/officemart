# Datos de demostración Office Mart

Cargados el 29/09/2026 en la empresa **Office Mart** con `pnpm test:integracion datos-demo`, usando las mismas funciones que las pantallas. Los movimientos van de julio a septiembre de 2026. Entrar con `admin@officemart.hn`.

## Qué se cargó

| Área | Registros |
|---|---|
| Zonas de venta / vendedores | 3 / 3 |
| Clientes (instituciones, colegios, hoteles, comercios) | 14 |
| Proveedores | 4 |
| Categorías / productos | 5 / 20 (18 de reventa y 2 fabricados) |
| Órdenes de compra recibidas | 16 (4 iniciales y 12 de reabastecimiento mensual) |
| Materiales / recetas / órdenes y corridas de producción | 4 / 2 / 4 y 4 |
| Ventas / líneas de venta | 66 / 216 |
| Recibos de cobro | 22 |
| Gastos operativos / gastos de nómina | 18 / 16 |
| Cuentas bancarias y política de comisión 3 % | 2 y 1 |
| Empleados | 10 |
| Marcaciones de asistencia (últimas dos semanas) | 116 |
| Novedades de nómina / registros de vacaciones | 12 / 3 |
| Nóminas (48 líneas de empleado) | 9 |
| Cotizaciones | 8 (3 enviadas, 3 aprobadas, 1 borrador, 1 rechazada) |
| CRM: contactos / oportunidades / actividades | 6 / 10 / 16 |

## Cifras que se verán

| Mes | Ventas netas (sin ISV) | Utilidad bruta | Nómina | Otros gastos | Utilidad neta |
|---|---|---|---|---|---|
| Julio | 971 439.00 | 350 884.90 | 271 695.15 | 34 174.83 | 44 544.60 |
| Agosto | 970 102.25 | 352 207.55 | 278 596.70 | 31 939.34 | 40 991.48 |
| Septiembre | 934 641.00 | 337 667.25 | 223 314.37 | 41 554.86 | 72 604.42 |

Septiembre tiene menos nómina porque la segunda quincena quedó **en borrador** para mostrar en vivo cómo se aprueba y se paga.

| Balance operativo al 29/09 | Lempiras |
|---|---|
| Bancos | 1 329 408.55 |
| Cuentas por cobrar | 315 012.88 |
| Inventario a costo | 395 948.09 |
| Total activos | 2 048 549.52 |
| Total pasivos | 920 081.05 |
| Patrimonio operativo | 1 128 468.47 |

## Recorrido sugerido para la demo

1. **Dashboard y Finanzas → Estado de resultados**: tres meses con utilidad, ventas sin ISV y nómina como principal gasto.
2. **Ventas → Historial y Reportes de ventas**: 66 facturas con pagos por banco, tarjeta POS con comisión 3.5 %, efectivo y crédito. Reportes por vendedor, zona y categoría.
3. **Ventas → Cuentas por cobrar y Estado de cuenta**: facturas de septiembre a crédito pendientes; abonos de julio y agosto con recibo.
4. **Compras → Órdenes y Cuentas por pagar**: reabastecimiento mensual; las compras de septiembre quedaron a crédito a 30 días.
5. **Producción**: talonarios fiscales y tarjetas de presentación con receta, órdenes, corridas con defectos y consumo de materiales.
6. **Ventas → Cotizaciones**: una de cada estado; desde una aprobada se puede facturar o crear orden de trabajo.
7. **CRM → Pipeline, Agenda y Reportes**: 10 oportunidades en distintas etapas (una ganada y una perdida), actividades vencidas y próximas, y un cumpleaños de contacto esta semana.
8. **RRHH → Empleados**: 10 colaboradores con antigüedad; el ícono de palmera muestra la causación de vacaciones.
9. **RRHH → Asistencia**: marcaciones de dos semanas con alguna ausencia.
10. **RRHH → Nómina**: julio y agosto pagadas; septiembre con la primera quincena pagada, la mensual como complementaria y la segunda quincena en borrador para aprobar y pagar en vivo; boletas PDF y planilla Excel.
11. **Finanzas → Balance y Conciliación bancaria**: saldos de banco, CxC, inventario y CxP.

## Consignación y toma física

Cargados con `pnpm test:integracion datos-consignacion-toma`.

**Consignación** (Inventario → Consignación)

| Dato | Detalle |
|---|---|
| Localizaciones en consignación | «Consignación TecnoImport» (impresoras, proyectores, laptops) y «Consignación Muebles y Oficinas» (pizarras, mesas de reuniones), dentro del almacén Principal |
| Entrada de mercancía | 1 de agosto, a costo pactado: 12 impresoras, 5 proyectores, 6 laptops, 15 pizarras y 3 mesas |
| Ventas desde consignación | 9 facturas entre el 5 de agosto y el 26 de septiembre |
| Liquidación hecha | #1 a TecnoImport por L 47 500 (ventas de agosto), con su orden de compra a crédito a 30 días |
| Pendiente de liquidar | TecnoImport L 37 900 (septiembre) y Muebles y Oficinas L 19 950 (agosto y septiembre) |
| Valoración | Propio L 395 764 y consignado L 136 500 (23 unidades) por separado |

En la demo se puede liquidar en vivo lo pendiente de Muebles y Oficinas.

**Toma física** (Inventario → Toma física)

| Toma | Estado | Detalle |
|---|---|---|
| #1 Bodega San Pedro Sula | Cerrada | 8 líneas contadas; faltan 3 resmas carta y 1 memoria USB (L 374) y sobran 2 libras de café (L 190); 3 ajustes aplicados al inventario |
| #2 Sala de exhibición Tegucigalpa | Abierta | 6 líneas, 3 contadas (faltan 2 mouse); el almacén está congelado hasta cerrarla o cancelarla |

En la demo se puede terminar de contar la #2 y cerrarla para ver los ajustes, o mostrar que no se puede vender ni trasladar desde ese almacén mientras está abierta.

## Producción por áreas: simulación de piso

Cargada con `pnpm test:integracion simulacion-piso` sobre las operaciones Diseño → Impresión → Corte → Entrega. Son 121 órdenes de trabajo del 24 de agosto a hoy, de 11 tipos (lonas, tarjetas, volantes, talonarios, stickers, rotulación y otros). El 30 % llega con arte del cliente y no pasa por Diseño, el 20 % es urgente (prometido a 1 día hábil) y algunas tienen cambios del cliente.

| Indicador (Producción → Reporte de flujo, 24/08 a hoy) | Valor |
|---|---|
| Órdenes terminadas | 97 |
| Lead time promedio / P90 | 79.9 h / 142.5 h (horas de reloj, incluye noches) |
| Entregas a tiempo | 67 % |
| Órdenes en piso (WIP) | 24: Impresión 10, Entrega 6, Corte 5, Diseño 3 |

| Semana | Terminadas | Lead time promedio | A tiempo |
|---|---|---|---|
| 24/08 | 12 | 41.7 h | 83.3 % |
| 31/08 | 18 | 75.9 h | 83.3 % |
| 07/09 | 18 | 59.0 h | 77.8 % |
| 14/09 | 12 | 72.0 h | 75.0 % |
| 21/09 | 26 | 100.6 h | 53.8 % |
| 28/09 | 11 | 121.5 h | 27.3 % |

**Historia para la demo**: el pico de pedidos de fin de mes (últimos 10 días hábiles) saturó la única impresora. La cola se acumula en Impresión (10 órdenes), el lead time sube semana a semana y el cumplimiento cae del 83 % al 27 %. En Producción → Flujo (vista Tablero) se ven las tarjetas en cada estación con su antigüedad y el semáforo de fecha comprometida. En el Reporte de flujo, «Etapas en curso» muestra las más trabadas.

## Notas

- La empresa también conserva los datos de la validación anterior, con prefijo **VAL**: un producto, una venta y una empleada con su nómina de septiembre.
- Los movimientos de kardex de las ventas se fecharon con la fecha de la venta. Los movimientos bancarios de pagos y gastos pasados llevan la fecha en que se cargaron.
- El cargador es reanudable: si se vuelve a correr, salta lo que ya existe y no duplica.
