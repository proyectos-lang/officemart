# Validación de flujo completo (datos reales)

Ejecutado el 2026-09-29 con `pnpm test:integracion` sobre la empresa **Office Mart** (usuario `admin@officemart.hn`). Cada paso llama a las mismas funciones que usan las pantallas y verifica el efecto en la base. Todo lo creado lleva el prefijo **VAL** para reconocerlo. Cifras de estado de resultados y balance actualizadas tras las correcciones del mismo día.

## Resultado paso a paso

| # | Paso | Resultado verificado | Dónde revisarlo en la app |
|---|---|---|---|
| 1 | Preparación | Almacén «Principal» (#1) y bodega «General» (#1) | Configuración → Almacenes |
| 2 | Crear producto | Producto #1 «VAL Cuaderno espiral 100 hojas», código VAL-CUAD-001, precio L 85, stock inicial 0 | Configuración → Productos |
| 3 | Compra y recepción de materiales | Compra #1 al contado a «VAL Papelera Centroamericana», L 3 050: papel 20 000 hojas a L 0.10, portada 300 a L 2.50, espiral 300 a L 1.00. Stock y costo promedio correctos | Producción → Compras de materiales / Materiales |
| 4 | Receta | 100 hojas + 1 portada + 1 espiral por cuaderno; costo estimado L 18.00 (13.50 material + 4.50 conversión) | Producción → Recetas |
| 5 | Producción y cargue de inventario | Orden #1, corrida #1 de 100 unidades: consumió 10 000 hojas, 100 portadas y 100 espirales; entraron 100 cuadernos a costo real L 18 (kardex «Entrada Produccion» +100) | Producción → Órdenes / Corridas; Inventario → Kardex |
| 6 | Tesorería | Cuenta «VAL Banco Atlántida» #1 con saldo inicial L 60 000 al 01/09 (asiento con fecha pasada; la cadena de saldos se recalculó bien). Caja abierta con L 1 000 | Finanzas → Movimientos / Caja chica |
| 7 | Venta y descuento de inventario | Factura FC-0001: 30 × L 85 = L 2 550 + ISV L 382.50 = L 2 932.50; pagó L 1 000 en efectivo + L 1 932.50 por banco. Stock 100 → 70, kardex «Salida Venta» −30, caja +L 1 000, banco +L 1 932.50 | Ventas → Historial; Inventario → Kardex |
| 8 | Historial de ventas | FC-0001 aparece con cliente «VAL Distribuidora Escolar S. de R.L.» y total L 2 932.50 | Ventas → Historial |
| 9 | Gastos | Gasto #1 Energía L 1 500 pagado por banco; gasto #2 Alquiler L 8 000 a crédito, en CxP con vencimiento 30/09 | Finanzas → Gastos / CxP |
| 10 | Estado de resultados (antes de nómina) | Ventas netas L 2 550 (sin ISV), CMV L 540, utilidad bruta L 2 010, servicios L 1 500, arriendo L 8 000 | Finanzas → Estado de resultados |
| 11 | Ingreso de personal | Empleada #1 «VAL María Fernanda López», ingreso 01/03/2024, salario L 25 000 mensual | RRHH → Empleados |
| 12 | Causación de vacaciones | 2 años completos: 22 días exigibles + 8.71 proporcionales = 30.71 días; salario diario L 833.33 | RRHH → Empleados → ícono de palmera |
| 13 | Vacaciones gozadas y liquidación | 5 días gozados + 3 días liquidados (pagados en nómina, L 2 500). Saldo 22.71 días (L 18 924.92). Liquidar más que el saldo se rechaza | RRHH → Empleados → palmera; RRHH → Novedades |
| 14 | Expediente del empleado | 2 PDF en el bucket privado (contrato, e identidad con vencimiento); descarga por URL firmada temporal con tamaño correcto | RRHH → Empleados → ícono de documento |
| 15 | Novedades | 4 horas extra diurnas y bono de L 1 000 | RRHH → Novedades |
| 16 | Liquidación de nómina | Nómina #1 de septiembre: devengado L 29 020.83 (salario 25 000 + horas extra 520.83 + bono 1 000 + vacaciones 2 500); IHSS 595.16, RAP 256.77, ISR 909.80; neto L 27 259.10; aportes patronales L 1 268.54. Aprobada y pagada por banco; gasto #3 «Sueldos y salarios» y gasto por pagar «Cargas sociales y retenciones» L 3 030.27 | RRHH → Nómina (boletas PDF y planilla) |
| 17 | Estado de resultados y balance | Ventas netas L 2 550, CMV L 540, nómina L 30 289.37, gastos operativos L 39 789.37, utilidad neta L −37 779.37. Balance: caja L 2 000, bancos L 33 173.40, inventario L 1 260, materiales L 1 700; pasivos L 11 030.27; patrimonio L 27 103.13 | Finanzas → Estado de resultados / Balance |

## Cómo se verificaron los cálculos de nómina

| Concepto | Cálculo | Resultado (L) |
|---|---|---|
| Horas extra | 4 × (25 000 ÷ 240) × 1.25 | 520.83 |
| Vacaciones pagadas | 3 × (25 000 ÷ 30) | 2 500.00 |
| IHSS empleado | techo 11 903.13 × 5 % | 595.16 |
| RAP empleado | (29 020.83 − 11 903.13) × 1.5 % | 256.77 |
| ISR regular | ((25 000 − 595.16) × 12 − 40 000 − 228 324.32) × 15 % ÷ 12 | 306.67 |
| ISR de extras | (520.83 + 1 000 + 2 500) × 15 % | 603.12 |
| Costo total de nómina | devengado 29 020.83 + patronal 1 268.54 | 30 289.37 |

## Conciliación del patrimonio

| Concepto | Monto (L) |
|---|---|
| Aporte de capital (banco 60 000 + caja inicial 1 000) | 61 000.00 |
| Utilidad neta del mes | −37 779.37 |
| Compra de materiales al contado sin salida de tesorería | +3 050.00 |
| Costos de conversión de la receta capitalizados en inventario | +450.00 |
| ISV cobrado que no aparece como pasivo | +382.50 |
| **Patrimonio del balance** | **27 103.13** |

## Hallazgos

**Corregidos durante la validación**

1. **El estado de resultados sumaba el ISV como ingreso.** Las ventas salían en L 2 932.50 en vez de L 2 550, y las devoluciones se restaban sin ISV. Ahora el ISV de las ventas vigentes se descuenta en la vista mensual y anual, y la pantalla dice «Ventas netas (sin ISV)».
2. **Los movimientos de caja y banco de una venta tomaban el número de factura de la vista previa**, no el asignado al guardar. Con dos cajeros simultáneos podían quedar con un número equivocado. Ahora usan el número definitivo.

**Pendientes de decisión (no se cambiaron)**

3. **La compra de materiales al contado no mueve caja ni banco**, y sus abonos tampoco. Es una decisión heredada de EasyCount que está documentada en el código. El dinero sale en la realidad, pero no en el sistema.
4. **El ISV cobrado no aparece como pasivo en el balance operativo.** El balance lo advierte en su leyenda.
5. **Los costos de conversión de la receta** (mano de obra, energía y gastos generales estándar) se suman al costo del producto. La nómina real también se registra como gasto. Si esa mano de obra es la misma, se cuenta dos veces. Conviene que el contador defina si los costos de conversión se dejan en cero o se ajustan contra la nómina.

## Identificadores creados

| Dato | Id |
|---|---|
| Producto VAL-CUAD-001 | 1 |
| Materiales (papel, portada, espiral) | 1, 2, 3 |
| Compra de materiales | 1 |
| Orden de producción / corrida | 1 / 1 |
| Cuenta bancaria | 1 |
| Sesión de caja | 1 |
| Cliente VAL Distribuidora | 2 |
| Venta FC-0001 | 1 |
| Gastos (energía, alquiler, nómina) | 1, 2, 3 |
| Empleada | 1 |
| Nómina | 1 |
