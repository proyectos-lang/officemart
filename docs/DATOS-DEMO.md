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

## Notas

- La empresa también conserva los datos de la validación anterior, con prefijo **VAL**: un producto, una venta y una empleada con su nómina de septiembre.
- Los movimientos de kardex de las ventas se fecharon con la fecha de la venta. Los movimientos bancarios de pagos y gastos pasados llevan la fecha en que se cargaron.
- El cargador es reanudable: si se vuelve a correr, salta lo que ya existe y no duplica.
