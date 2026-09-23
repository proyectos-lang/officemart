# Office Mart · Lettra · IACO — Mapeo de brechas y plan macro de adaptación

> Cotización de referencia: **COT-EC-2026-003** (14-sep-2026). Base técnica:
> EasyCount al 22-sep-2026 (commit `1e5d3bc`), operando en el esquema
> `officemart` (ver `CLAUDE.md`). Estado verificado contra el código, no contra
> el texto de la cotización.
>
> Leyenda: **✅ Existe** · **⚠️ Parcial** (hay base, falta lo pedido) · **❌ No existe**
> · 🔴 = la cotización lo presenta como *ya cubierto* y hoy **no** lo está.

---

## 0. Resumen ejecutivo

| | Requerimientos | ✅ | ⚠️ | ❌ |
|---|---|---|---|---|
| Prioridad A (inventarios, producción, ventas, compras, bancos, general) | 42 | 16 | 12 | 14 |
| Prioridad B (CRM, RRHH/nómina, firma digital) | 3 | 0 | 0 | 3 |

**Lo que EasyCount ya resuelve bien** para este cliente: operación multi-empresa
(las 3 empresas = 3 razones sociales aisladas, módulos opt-in por empresa),
venta integrada (inventario + kardex + caja/banco + CxC en una operación),
devoluciones, listas de precios por cliente, límite de crédito, kardex,
multi-almacén, prorrateo de importación, OC → recepción, tesorería completa,
P&L, flujo de caja, y un módulo de producción por etapas configurables con
recibe/entrega por etapa, OEE y reporte de cuellos de botella.

**Compromisos de la cotización que hay que construir** (sección 3 los da por
existentes 🔴): precio/descuento **por categoría** en listas, reportes de ventas
**por vendedor / zona / línea / sin movimiento**, **pagos parciales a la OC**
con saldo por fecha, **backorder** de ítems faltantes, **estadísticas de OC**,
**estado de cuenta de proveedor** y **conciliación bancaria** contra el extracto.
Suman ~15–18 días y no tienen precio aparte en la cotización: van dentro de
los L. 15,000 de prioridad A.

**Esfuerzo total estimado** (días de desarrollo efectivos, con asistencia de
IA, un desarrollador): **Prioridad A: 38–48 d** · **Prioridad B: 17–23 d**.
El cronograma cotizado (A en 2 semanas, B en semanas 3–4) no cabe: la
sección 6 propone un orden por valor que entrega lo operativo en las
primeras 2 semanas y el resto de A en las semanas 3–4, corriendo B a las
semanas 5–8. Es una decisión comercial tuya; el plan técnico soporta
cualquiera de los dos calendarios, pero no ambos alcances en un mes.

---

## 1. Decisiones de arquitectura ya tomadas (aplican a todo el plan)

- **Esquema propio `officemart`** en el mismo Supabase; `public` sigue siendo
  EasyCount producción. Todo script nuevo: `scripts/officemart-NNN-*.sql`,
  calificado `officemart.`, aditivo (tablas nuevas, `ADD COLUMN` nullable).
- **3 empresas = 3 `razon_social`**: Office Mart, Lettra, IACO. Aislamiento
  por RLS; módulos habilitados por empresa desde `/plataforma`.
- **Todo módulo nuevo nace opt-in** (fuera de `MODULOS_BASE`) + feature flag
  cuando cambia el comportamiento de un módulo existente. Así cada empresa
  activa solo lo suyo (p. ej. IACO sin cotizaciones, Office Mart sin
  producción) y los desarrollos quedan portables a EasyCount upstream.
- **Cada módulo nuevo** sigue el checklist de `CLAUDE.md`: página +
  servicio + `MODULOS` + `INSERT modulos` + tutorial en `lib/aprendizaje/`.
- **Intercompañía** (Lettra e IACO compran a Office Mart): hoy son ventas y
  compras independientes en cada empresa. Se propone un puente opcional en la
  sección 5 para cumplir "sin doble ingreso" entre las tres.

---

## 2. Mapeo requerimiento → estado actual

### 2.1 Inventarios

| # | Requerimiento del cliente | Estado | Qué existe hoy | Brecha |
|---|---|---|---|---|
| I1 | Categorizar productos por **línea** | ⚠️ | Categoría → subcategoría + marca (`productos.categoria_id/subcategoria_id/marca_id`) | No hay concepto "línea" separado de categoría; los reportes y precios no filtran por él |
| I2 | Almacenes/bodegas | ✅ | Multi-almacén + localizaciones, stock por localización, punto de venta por localización (`localizaciones_config`) | — |
| I3 | Producto **en consignación** (de terceros) | ❌ | Nada distingue stock propio de stock de terceros | Segregar stock por propietario, no valorarlo como propio, liquidar al consignante lo vendido |
| I4 | **Trazabilidad por OC** | ⚠️ | Cada entrada del kardex referencia su OC (`referencia_id`, tipo `Entrada Compra`; columna "Referencia" desde el 21-sep) | Falta pantalla producto → OCs de origen y OC → productos/destino, y reporte |
| I5 | **Congelar inventario** para toma física | ❌ | Ajustes por conteo (`ajustes_inventario`), pero el stock sigue moviéndose durante el conteo | Congelar snapshot por almacén, capturar conteo, cuadrar y aplicar ajustes |
| I6 | Kardex | ✅ | `transacciones_inventario` + `/inventario/kardex` con documento origen | — |
| I7 | Ingreso con **prorrateo de gastos** del embarque | ✅ | OC con `costos_importacion`, `impuestos_compra`, `otros_costos` prorrateados a `costo_final_local` | — |
| I8 | Punto de reorden / mínimos críticos con alerta | ❌ | Dashboard "stock bajo" con umbral fijo = 5 unidades (`getProductosStockBajo`) | Mínimo y punto de reorden por producto y almacén + alerta + sugerido de compra |

### 2.2 Producción por áreas

| # | Requerimiento | Estado | Qué existe hoy | Brecha |
|---|---|---|---|---|
| P1 | Ruta multi-etapa configurable (diseño, impresión, post-impresión, confección, empaque…) | ✅ | `produccion_operaciones` por empresa (secuencia editable) | — |
| P2 | Orden de trabajo con recorrido por estaciones | ⚠️ | `produccion_ordenes` + `produccion_orden_etapas` (secuencia congelada por orden) | La orden exige un **producto fabricado con receta** y cantidad. Los trabajos de imprenta son a la medida (1 lona 3×2, 500 tarjetas de X) y nacen de una cotización/venta con cliente; no hay OT "libre" ni vínculo a cotización/factura |
| P3 | Captura recibe/entrega por etapa con responsable, fecha y hora | ✅ | Estados Pendiente → Recibida → En Proceso → Entregada, `responsable`, `fecha_recepcion`, `fecha_entrega`, `cantidad_procesada` | Responsable es texto libre; conviene elegir usuario |
| P4 | **Consumo de materiales por etapa** con descuento automático | ⚠️ | Consumo por **corrida** según receta global (`produccion_corrida_consumos`, `mat_ajustar_stock`) | No hay consumo declarado en cada etapa, ni consumo desde el inventario de **productos** (los suministros de Office Mart son productos, no "materiales") |
| P5 | Trazabilidad de principio a fin y estado del trabajo en piso | ⚠️ | `/produccion/flujo` (por orden) y `/produccion/reporte-flujo` (tiempos, carga, cuellos de botella), OEE | Falta tablero de piso por área (kanban) y línea de tiempo cliente → cotización → OT → etapas → entrega |

### 2.3 Ventas

| # | Requerimiento | Estado | Qué existe hoy | Brecha |
|---|---|---|---|---|
| V1 | Facturar en **2 ciudades, 3 puntos** independientes | ❌ | Correlativo interno único por empresa (`venta_correlativos`), CAI con **una** config por tipo de documento (`facturacion_cai_config UNIQUE (razon, tipo)`), un solo punto de venta preseleccionado por empresa | Puntos de facturación con serie interna y rango CAI propios, usuario/almacén asignado, reportes por punto |
| V2 | **Cotizaciones** (crear, guardar, reabrir, editar ítems, vigencia, estado, facturar) | ❌ | "Catálogo/Pedidos" es el cliente pidiendo por link, no una cotización interna | Módulo completo |
| V3 | Devoluciones por ítem o factura completa | ✅ | `/ventas/devoluciones` con nota de crédito, reposición de stock y reembolso | — |
| V4 | 🔴 **Categorías de precios** (precio/descuento por categoría dentro de una lista) | ❌ | Listas por % global o precio por producto (`listas_precios_detalle`) | Regla por categoría/línea dentro de la lista, con precedencia producto > categoría > global |
| V5 | Comisiones de vendedores por políticas | ❌ | Solo comisión bancaria de tarjeta; `ventas_encabezado.usuario` guarda quién registró | Vendedor en la venta, políticas y liquidación por período |
| V6 | Pagos: factura completa / parcial | ✅ | `pagos_ventas`, abonos con método y cuenta | — |
| V7 | Pago aplicado a **múltiples facturas** | ❌ | Se abona una factura a la vez | Recibo de cobro que distribuye un monto entre varias facturas |
| V8 | Maestro de clientes: dirección, RTN | ✅ | `clientes` | — |
| V9 | Notas especiales, **días de crédito**, **segundo cliente**, bloqueo por mora | ❌ | Solo `limite_credito` (script 064, con bloqueo al exceder) | Campos nuevos + regla de bloqueo por mora |
| V10 | Límite de crédito | ✅ | Bloquea venta a crédito que exceda el tope | — |
| V11 | Lista de precios asignada a cliente | ✅ | `cliente_lista_precio` | — |
| V12 | Seguimiento por usuario: anulación, devolución, reclamo, nota de crédito | ⚠️ | Bitácora de ediciones (`ventas_ediciones`), eliminadas con motivo (`ventas_eliminadas`), devoluciones | Hoy se **borra** la factura (copia aparte); con CAI debe **anularse** conservando el número. No hay reclamos ni pantalla de auditoría por usuario |
| V13 | 🔴 Reportes dinámicos: más vendidos ✅, **sin movimiento**, **por vendedor**, **por zona**, **por línea**, por fecha ✅ | ⚠️ | Dashboard de ventas: top productos/clientes, por almacén, por fecha; `vista_ultima_venta_producto` | No existen vendedor, zona ni línea como dimensiones; falta un reporte con dimensión y medida elegibles |
| V14 | Estado de cuenta de clientes | ⚠️ | CxC por factura con antigüedad 0-30/31-60/61-90/90+ | Documento consolidado cronológico (débitos/créditos, saldo corriente), imprimible |
| V15 | Rentabilidad de productos | ✅ | Costo, utilidad y margen en productos y ventas | — |

### 2.4 Compras

| # | Requerimiento | Estado | Qué existe hoy | Brecha |
|---|---|---|---|---|
| C1 | OC a proveedor → recepción a inventario | ✅ | `/compras/orden` + `/compras/recepcion` (multi-moneda, prorrateo) | — |
| C2 | Estadísticas de **tránsito** origen→destino para mínimos críticos | ❌ | `fecha_orden`, `fecha_tentativa` y fecha de recepción existen como datos | Lead time real por proveedor/producto, alimentando el punto de reorden (I8) |
| C3 | 🔴 **Pagos parciales a la OC** y seguimiento de saldos por fecha | ⚠️ | Al recibir se puede registrar el pago total o dejarlo a crédito, pero como **Gasto** (CxP en `gastos`), no ligado a la OC; sin anticipos antes de recibir | Cuenta por pagar nacida de la OC: anticipos, abonos, vencimiento, saldo |
| C4 | 🔴 **Backorder** de ítems no recibidos (ya pagados) | ❌ | `compras_detalle.cantidad_recibida` admite recibir menos, pero la OC pasa a `Recibida` y cierra | Múltiples recepciones por OC, saldo pendiente por línea, estado y seguimiento de faltantes, retirar ítems |
| C5 | 🔴 Estadísticas de OC colocadas | ❌ | Solo "compras pendientes" en el dashboard | Reporte por período/proveedor: monto, cumplimiento, lead time, ítems |
| C6 | 🔴 Estado de cuenta de proveedores | ❌ | Maestro mínimo (`nombre, rtn, contacto`) | Maestro ampliado + estado de cuenta (OC/facturas vs pagos) |

### 2.5 Bancos y finanzas

| # | Requerimiento | Estado | Qué existe hoy | Brecha |
|---|---|---|---|---|
| B1 | Cuentas, movimientos, transferencias, saldos | ✅ | `cuentas_config`, `cuenta_movimientos`, transferencias, comisiones por cuenta | — |
| B2 | 🔴 **Conciliación contra el estado de cuenta del banco** | ❌ | "Consolidación bancaria" = saldo día a día interno (`consolidacion_saldos_iniciales`) | Importar extracto, cruzar, marcar conciliado, diferencias |
| B3 | Reportes financieros y **balances** en línea | ⚠️ | P&L mensual, flujo de caja, análisis financiero, cierre diario | Balance general (operativo) |
| B4 | Caja / cierres | ✅ | Caja chica con arqueo, cierre diario | — |

### 2.6 General

| # | Requerimiento | Estado | Qué existe hoy | Brecha |
|---|---|---|---|---|
| G1 | Reportes estadísticos por área | ⚠️ | Ventas, inventario, producción, finanzas | Compras/proveedores (C5, C6) |
| G2 | Modular pero sincronizado, sin doble ingreso | ⚠️ | Ventas 100 % integrada; compras → inventario; pago de compra vía gastos | CxP ligada a la OC (C3); intercompañía Office Mart ↔ Lettra/IACO (sección 5) |
| G3 | Todo en la nube | ✅ | Supabase + Vercel, PWA instalable | — |
| G4 | Usuarios, roles y permisos por módulo | ✅ | `usuarios`, `permisos_usuarios` | Rol "vendedor" ligado a comisiones (V5) |

### 2.7 Prioridad B

| # | Módulo | Estado | Qué existe hoy |
|---|---|---|---|
| B-1 | CRM | ❌ | Solo maestro de clientes |
| B-2 | RRHH y nómina | ❌ | "Nómina" solo como categoría de gasto |
| B-3 | Firma digital de documentos | ❌ | Líneas de firma manuscrita en los PDF |

---

## 3. Plan macro — Prioridad A

Cada épica indica: qué se construye, diseño técnico (BD → servicio → UI),
esfuerzo (días efectivos) y dependencias. Nombres de tablas y módulos son
propuestas para empezar a codificar; se ajustan al implementar.

### Bloque 0 — Implementación y puesta en marcha (3–4 d)

- Ejecutar `officemart-000` (clonado), exponer esquema, crear 3 empresas y
  admins desde `/plataforma`; habilitar módulos por empresa.
- Cargas masivas ya existentes: productos, clientes, proveedores, materiales,
  ventas (para cartera inicial a crédito). Saldos iniciales de inventario por
  Movimientos Manuales o importación de productos con stock.
- Almacenes/localizaciones por ciudad; puntos de facturación (V1) y CAI por
  punto; usuarios y permisos; cuentas bancarias y saldos iniciales.
- Capacitación: el Centro de Aprendizaje ya trae tutorial por módulo; cada
  módulo nuevo agrega el suyo (obligatorio por `CLAUDE.md`).

### Bloque T — Cimientos transversales (5–6 d)

Datos maestros de los que dependen las demás épicas. Van primero.

| Épica | Diseño | Esfuerzo |
|---|---|---|
| **T1 Línea de producto** (I1) | Catálogo `lineas` + `productos.linea_id` (ADD COLUMN nullable) + import/edición de productos + filtro en Productos, Valoración, Kardex. Alimenta V4 y V13 | 1.5 d |
| **T2 Vendedor y zona** (V5, V13) | `vendedores` (usuario opcional, activo) y `zonas`; `clientes.zona_id`, `clientes.vendedor_id`, `ventas_encabezado.vendedor_id` (ADD COLUMN). Nueva Venta preselecciona el vendedor del usuario/cliente. Flag `ventas_vendedor_obligatorio` | 1.5 d |
| **T3 Maestro de clientes ampliado** (V9) | `clientes`: `notas`, `dias_credito`, `cliente_relacionado_id` (segundo cliente / facturar a), `correo`, `bloqueado`, `motivo_bloqueo` (ADD COLUMN). Regla en Nueva Venta: bloquear crédito si `bloqueado` o si hay facturas vencidas más allá de `dias_credito` (además del `limite_credito` existente). Notas visibles al seleccionar el cliente | 1.5 d |
| **T4 Maestro de proveedores ampliado** (C6) | `proveedores`: `correo`, `telefono`, `direccion`, `dias_credito`, `moneda`, `pais`, `notas` (ADD COLUMN) + carga masiva actualizada | 0.5 d |

### Bloque 1 — Inventarios (9–11 d)

| Épica | Diseño | Esfuerzo |
|---|---|---|
| **1.1 Consignación** (I3) | `localizaciones_config.tipo` (`propia`/`consignacion`) + `propietario_proveedor_id` (ADD COLUMN). El stock de terceros vive en localizaciones de consignación: se excluye de Valoración (o se muestra aparte), el kardex lo marca. Al vender desde una localización de consignación se genera `consignacion_liquidaciones_detalle` (venta, producto, cantidad, costo pactado) y la pantalla **Liquidación de consignación** agrupa lo vendido por propietario y período, genera la CxP al consignante (Bloque C) y marca liquidado | 3 d |
| **1.2 Trazabilidad por OC** (I4) | Sin tablas: pantalla `Trazabilidad` (producto → entradas por OC con proveedor, costo, fecha, almacén; OC → productos y a dónde fueron trasladados) leyendo `transacciones_inventario` + `compras_*`. Export .xlsx. Opcional después: lote/serie por línea de recepción | 1.5 d |
| **1.3 Toma física con congelamiento** (I5) | `tomas_fisicas` (almacén, estado `Abierta`/`Cerrada`, fecha congelación, usuario) + `tomas_fisicas_detalle` (producto, localización, `stock_sistema` snapshot, `conteo`, diferencia). Mientras haya toma abierta en un almacén, `ajustarStock`/traslados/ventas de ese almacén se bloquean (validación en servicio + trigger `BEFORE INSERT` en `transacciones_inventario` como red de seguridad). Cierre = ajustes vía `procesarAjusteInventario` con motivo "Toma física #". Captura por lista o lector de código de barras (flag existente). Export de hoja de conteo y de diferencias | 3 d |
| **1.4 Reorden y mínimos** (I8, C2) | `productos_reorden` (producto, almacén, `stock_minimo`, `punto_reorden`, `cantidad_sugerida`). Lead time real = promedio (`fecha recepción − fecha_orden`) por proveedor y producto desde compras. Pantalla **Reposición**: bajo mínimo / bajo reorden, días de cobertura (venta promedio diaria), sugerido de compra → crea OC borrador. Alerta en dashboard reemplaza el umbral fijo de 5 | 2.5 d |

### Bloque 2 — Producción por áreas (7–9 d)

Construye sobre lo existente (operaciones, etapas, corridas, OEE, reporte de
flujo). No se rehace nada.

| Épica | Diseño | Esfuerzo |
|---|---|---|
| **2.1 Orden de trabajo a la medida** (P2) | `produccion_ordenes`: `cliente_id`, `cotizacion_id`, `venta_id`, `descripcion`, `fecha_compromiso` (ADD COLUMN); el producto pasa a opcional para la OT "libre" (flag `produccion_ot_libre`). Desde una cotización aprobada o una venta se crea la OT con sus etapas (secuencia por defecto de la empresa, editable por orden). Número `OT-####` | 2.5 d |
| **2.2 Consumo de materiales por etapa** (P4) | `produccion_etapa_consumos` (etapa_id, `material_id` **o** `producto_id`, cantidad, costo). Al entregar una etapa se declaran consumos (con sugerido desde receta por etapa si existe: `produccion_receta_materiales.operacion_id` ADD COLUMN). Descuento con `mat_ajustar_stock` o `ajustarStock` según origen; el costo real de la OT suma consumos por etapa. Cubre que Lettra/IACO consuman **productos** (suministros comprados a Office Mart) | 2.5 d |
| **2.3 Tablero de piso** (P5) | Página **Tablero de Piso**: columnas = operaciones, tarjetas = OT con cliente, cantidad, responsable, antigüedad y semáforo por `fecha_compromiso`. Acciones Recibir / Entregar desde la tarjeta (mismos servicios de `produccion-flujo`). Responsable = usuario elegible (T2) | 1.5 d |
| **2.4 Línea de tiempo y notificaciones** (P5, recomendación) | Vista cronológica por OT: cotización → venta → etapas → entrega → despacho. Correos opcionales (confirmación de pedido, producción terminada, despacho) vía Resend con plantilla por empresa; flag `notificaciones_correo` | 1.5 d |

### Bloque 3 — Ventas (18–22 d)

| Épica | Diseño | Esfuerzo |
|---|---|---|
| **3.1 Puntos de facturación** (V1) | `puntos_facturacion` (nombre, ciudad, almacén/localización por defecto, `establecimiento`, `punto_emision`, activo) + `puntos_facturacion_cai` (punto, tipo documento, CAI, rango, correlativo, fecha límite) — nueva tabla en lugar de alterar el `UNIQUE` de `facturacion_cai_config`; `usuarios_punto_facturacion` (usuario ↔ punto por defecto). `ventas_encabezado.punto_facturacion_id` (ADD COLUMN). RPC `siguiente_correlativo_cai_punto` (mismo patrón atómico del 061). Serie interna por punto (`FC-A-####`). Filtro por punto en historial, cierre diario y reportes | 3.5 d |
| **3.2 Cotizaciones** (V2) | `cotizaciones_encabezado` (`COT-####`, cliente, vendedor, vigencia, estado `Borrador`/`Enviada`/`Aprobada`/`Facturada`/`Vencida`/`Rechazada`, notas, condiciones) + `cotizaciones_detalle` (producto o descripción libre, cantidad, precio, descuento). Reusa el formulario de Nueva Venta (mismo selector de productos, listas de precios, ISV). Acciones: guardar, reabrir/editar, duplicar, PDF con logo, marcar enviada, **Facturar** (prellena Nueva Venta y enlaza `venta_id`), **Crear OT** (2.1). Vencimiento automático por job diario o al listar | 4 d |
| **3.3 Comisiones de vendedor** (V5) | `politicas_comision` (vendedor o global; base: venta bruta / utilidad; % por línea/categoría opcional; condición: al facturar o al cobrar; vigencia). `comisiones_liquidaciones` + detalle por venta/pago. Pantalla **Liquidación de comisiones** por período: calcula, permite ajustar, cierra y genera gasto "Comisiones" (opcionalmente pago por caja/banco). Reporte por vendedor | 3.5 d |
| **3.4 Recibo de cobro multi-factura** (V7) | `recibos_cobro` (`RC-####`, cliente, fecha, monto, método, cuenta, referencia) y `pagos_ventas.recibo_id` (ADD COLUMN). UI: elegir cliente → facturas con saldo → distribuir manual o automático (más antigua primero). Un solo movimiento de caja/banco por recibo. PDF del recibo | 2.5 d |
| **3.5 Anulación, reclamos y auditoría** (V12) | `ventas_encabezado.estado_documento` (`Activa`/`Anulada`), `anulada_motivo`, `anulada_por`, `anulada_en` (ADD COLUMN). Anular reutiliza la reversión de `eliminarVenta` (stock, caja, banco, CxC) pero conserva el documento y el número (requisito CAI: nota de crédito o anulación, nunca borrar). `reclamos` (venta, cliente, tipo, descripción, estado, resolución, usuario). `auditoria` (entidad, id, acción, usuario, antes/después JSONB) alimentada por ventas, anulaciones, devoluciones, ediciones, reclamos, cotizaciones. Pantalla **Auditoría** con filtro por usuario/fecha/acción | 3 d |
| **3.6 Estado de cuenta de cliente** (V14) | Reporte cronológico por cliente: facturas (débito), recibos/abonos y notas de crédito (crédito), saldo corriente, resumen por antigüedad. PDF y .xlsx. Botón desde Clientes y CxC | 2 d |
| **3.7 Precio por categoría/línea en listas** (V4 🔴) | `listas_precios_reglas` (lista, categoría o línea, `porcentaje` o `precio`). Resolución de precio: producto > categoría/línea > % global de la lista. Ajustar `listas-precios.ts` y el resolutor en Nueva Venta/Cotización | 1.5 d |
| **3.8 Reportes dinámicos de ventas** (V13 🔴) | Página **Reportes de Ventas**: dimensión (fecha día/semana/mes, vendedor, zona, línea, categoría, cliente, punto, almacén) × medida (unidades, venta, costo, utilidad, margen), con filtros y export. Vista SQL `vista_ventas_reporte` (security_invoker) que junta encabezado+detalle+producto+cliente. Reporte **Sin movimiento** (productos sin venta en N días con stock y valor) sobre `vista_ultima_venta_producto` | 2.5 d |

### Bloque C — Compras (comprometido como existente 🔴) (9–11 d)

| Épica | Diseño | Esfuerzo |
|---|---|---|
| **C.1 Cuenta por pagar ligada a la OC** (C3) | `compras_pagos` (compra_id, fecha, monto, método, cuenta, referencia, tipo `Anticipo`/`Abono`) + `compras_encabezado.monto_pagado`, `estado_pago`, `fecha_vencimiento` (ADD COLUMN). Cada pago mueve caja/banco (mismos servicios de tesorería). La recepción ya no crea un gasto: la OC **es** la CxP. Pantalla **Cuentas por pagar a proveedores** con vencimientos y saldos; los gastos siguen para lo que no es OC. Migración de convivencia: gastos con `proveedor_id` siguen mostrándose | 3 d |
| **C.2 Recepciones parciales y backorder** (C4) | `compras_recepciones` (compra_id, fecha, número de factura, costos de importación de **esa** recepción, usuario) + `compras_recepciones_detalle` (línea de OC, cantidad recibida, costo final). Estado de OC: `Pendiente` → `Parcial` → `Recibida`/`Cerrada`; pendiente por línea = ordenado − recibido; estado por línea (`En tránsito`, `Backorder`, `Cancelada`). Pantalla **Backorder**: faltantes por proveedor/OC, pagado vs recibido, retirar ítem (cancela la línea y ajusta el saldo de la CxP). El prorrateo se calcula por recepción; `aplicarEntradaCompra` no cambia | 4 d |
| **C.3 Estadísticas de OC** (C5, C2) | Reporte: OC por período/proveedor, monto ordenado vs recibido, % cumplimiento, lead time promedio y máximo, ítems más comprados, en tránsito hoy. Reutiliza el cálculo de lead time de 1.4 | 1.5 d |
| **C.4 Estado de cuenta de proveedor** (C6) | Cronológico: OC/recepciones y gastos del proveedor (débito) vs pagos (crédito), saldo, antigüedad. PDF y .xlsx | 1.5 d |

### Bloque F — Finanzas (5–7 d)

| Épica | Diseño | Esfuerzo |
|---|---|---|
| **F.1 Conciliación bancaria** (B2 🔴) | `conciliaciones` (cuenta, período, saldo extracto, estado) + `conciliaciones_extracto` (líneas importadas: fecha, descripción, referencia, monto) + `cuenta_movimientos.conciliacion_id` (ADD COLUMN). Importar extracto .xlsx (plantilla por banco, mapeo de columnas guardado). Cruce automático por monto+fecha±2 días (+referencia), pareo manual, partidas solo en banco (crear movimiento: comisión, interés) o solo en sistema (pendiente en tránsito). Cierre con diferencia = 0 | 3.5 d |
| **F.2 Balance operativo en línea** (B3) | Reporte a fecha: activos (caja chica, bancos, CxC, inventario valorado, anticipos a proveedores), pasivos (CxP a proveedores, gastos pendientes, comisiones por pagar), patrimonio = diferencia. Sin partida doble: es un balance de gestión, se declara así en pantalla y tutorial | 2 d |

### Totales prioridad A

| Bloque | Días |
|---|---|
| 0 Implementación | 3–4 |
| T Cimientos | 5–6 |
| 1 Inventarios | 9–11 |
| 2 Producción | 7–9 |
| 3 Ventas | 18–22 |
| C Compras 🔴 | 9–11 |
| F Finanzas | 5–7 |
| **Total** | **56–70 brutos → 38–48 efectivos** (los bloques comparten cimientos, servicios y patrones de UI; la estimación efectiva descuenta esa reutilización) |

---

## 4. Plan macro — Prioridad B (17–23 d)

### B-1 CRM (5–7 d)

- **Datos**: `crm_contactos` (por cliente o prospecto: nombre, cargo, teléfono,
  correo), `crm_etapas` (pipeline configurable por empresa, con probabilidad),
  `crm_oportunidades` (cliente/prospecto, vendedor, valor estimado, etapa,
  fecha de cierre esperada, origen, estado ganada/perdida/motivo),
  `crm_actividades` (oportunidad o cliente, tipo llamada/visita/correo/tarea,
  fecha, resultado, próxima acción, usuario).
- **UI**: tablero kanban del pipeline (arrastrar entre etapas), ficha de
  cliente 360° (datos, notas, oportunidades, actividades, cotizaciones,
  facturas, saldo), agenda de actividades pendientes por vendedor, reporte de
  gestión por vendedor (actividades, oportunidades abiertas, tasa de cierre,
  valor ponderado).
- **Integración**: oportunidad → **Cotización** (3.2) → venta; el vendedor es
  el de T2. Cumpleaños de clientes (ya existe) entra a la agenda.

### B-2 RRHH y nómina (9–12 d)

- **Empleados**: `empleados` (empresa, datos personales, identidad, puesto,
  departamento, fecha ingreso/salida, tipo contrato, salario base, forma de
  pago, cuenta bancaria, IHSS/RAP) + **carpeta de documentos** por empleado
  en Storage (`officemart/rrhh/<id>/`) con tipo y vencimiento (contrato,
  identidad, exámenes, permisos).
- **Asistencia**: `rrhh_marcaciones` (entrada/salida desde la app, con
  usuario y hora de servidor) **o** importación .xlsx del reloj marcador
  actual; `rrhh_novedades` (horas extra diurnas/nocturnas, permisos con/sin
  goce, incapacidades, vacaciones, bonos, deducciones, anticipos).
- **Nómina**: `rrhh_parametros` versionados por vigencia (techo y % IHSS
  EM/IVM, % RAP, tabla progresiva de ISR anual y su exención, recargos de
  horas extra, décimo tercero y décimo cuarto) editables sin código;
  `rrhh_nominas` (período quincenal/mensual, estado borrador/cerrada) +
  `rrhh_nominas_detalle` por empleado (devengado, deducciones de ley, otras
  deducciones, neto) calculado desde salario + novedades + asistencia.
  Boleta de pago PDF, planilla .xlsx, cierre genera el gasto de nómina y su
  pago por caja/banco (concepto "Nómina" ya existe).
- **Módulos**: Empleados, Asistencia, Novedades, Nómina, Reportes RRHH (todos
  opt-in). Permisos: RRHH separado de Finanzas.

### B-3 Firma digital de documentos (3–4 d)

- **Alcance legal**: firma electrónica **simple** (Ley de Firmas Electrónicas
  de Honduras, Decreto 149-2013): válida entre las partes con evidencia de
  quién, cuándo y qué firmó; no es firma certificada por PKI (eso requiere
  proveedor acreditado y no está en la cotización).
- **Mecánica**: el documento (cotización, OT, acta de entrega, recibo de
  cobro, boleta de pago, documento de RRHH) se genera en PDF, se calcula su
  hash SHA-256 y se firma de dos formas: **interna** (usuario logueado, firma
  manuscrita en canvas o clic) o **externa** (link con vigencia enviado por
  correo, verificación por código OTP, firma en canvas desde el celular).
- **Evidencia**: `documentos_firmados` (entidad, id, hash, PDF original y
  firmado en Storage, estado) + `documentos_firmas` (firmante, correo, rol,
  método, fecha/hora servidor, IP, user-agent, imagen de firma). El PDF
  firmado lleva la firma estampada y un pie con folio y hash; una página
  pública `/verificar/<folio>` confirma integridad.

---

## 5. Recomendaciones transversales (no cotizadas, alto valor)

1. **Intercompañía Office Mart ↔ Lettra/IACO**: una venta de Office Mart a
   Lettra crea automáticamente la OC + recepción en Lettra (mismo esquema,
   distinta `razon_social_id`, con service role y auditoría). Elimina el
   doble ingreso más frecuente del grupo. ~2 d sobre C.2. Requiere mapear
   productos entre empresas (`productos_equivalencias`).
2. **Rol "vendedor" y usuarios por punto**: T2 y 3.1 permiten que un vendedor
   solo vea su punto y sus clientes (política RLS adicional, opcional).
3. **Correos transaccionales** (2.4) también para cotización enviada y
   recibo de cobro; alinean con la oferta de "funciones de mayor valor para
   el cliente final".
4. **Portabilidad a EasyCount**: todo lo anterior se diseña como módulos
   opt-in con flags; una vez estable en Officemart se puede llevar a
   `public` con scripts `0NN` equivalentes y vender a otros clientes.

---

## 6. Secuencia sugerida y calendario

Cada entrega va a producción al cerrar (la cotización lo permite). Orden por
dependencia y por valor operativo para que las tres empresas facturen desde
la semana 2.

| Semana | Entrega | Contenido |
|---|---|---|
| 1 | **Arranque operativo** | Bloque 0 · T1–T4 · 3.1 Puntos de facturación · 3.5 Anulación/auditoría (necesario antes de facturar con CAI) · 3.7 Precio por categoría |
| 2 | **Vender y cobrar** | 3.2 Cotizaciones · 3.4 Recibo multi-factura · 3.6 Estado de cuenta cliente · 3.8 Reportes dinámicos · 1.2 Trazabilidad OC |
| 3 | **Comprar y pagar** | C.1 CxP a la OC · C.2 Backorder · C.3/C.4 Estadísticas y estado de cuenta proveedor · 1.4 Reorden |
| 4 | **Producción y control** | 2.1–2.4 Producción por áreas · 3.3 Comisiones · 1.1 Consignación · 1.3 Toma física · F.1 Conciliación · F.2 Balance |
| 5–6 | **Prioridad B (1/2)** | B-1 CRM · B-3 Firma digital |
| 7–8 | **Prioridad B (2/2)** | B-2 RRHH y nómina · Intercompañía (opcional) |

Frente a la cotización (A en 2 semanas, B en 3–4): las semanas 1–2 entregan
lo que las empresas necesitan para operar y **todo lo marcado 🔴 de ventas**;
compras 🔴, producción por áreas y finanzas caen en las semanas 3–4; B
corre a 5–8. Si el cliente necesita el calendario original, la alternativa
es recortar alcance de A a lo de las semanas 1–3 y negociar el resto.

---

## 7. Riesgos, supuestos y preguntas para el cliente

**Riesgos**
- 🔴 Siete capacidades "ya cubiertas" en la cotización no existen (~15–18 d).
  Conviene no mostrarlas en demo hasta tenerlas.
- Backorder (C.2) cambia el modelo de recepción (una OC → N recepciones);
  es la épica con más riesgo de regresión en costos promedio. Se mitiga
  manteniendo `aplicarEntradaCompra` intacto y probando prorrateo parcial.
- Facturación CAI por punto: el SAR autoriza rangos por punto de emisión;
  el cliente debe tener CAI vigente para los 3 puntos antes de la semana 1.
- Nómina Honduras: parámetros legales cambian; se diseñan versionados, pero
  la validación de cálculos requiere un caso real del contador del cliente.
- Firma digital: dejar claro por escrito que es firma electrónica simple.

**Supuestos**
- Las 3 empresas usan el mismo catálogo de módulos con activación
  independiente; los datos no se comparten (salvo intercompañía si se
  contrata).
- "Materiales" de Lettra/IACO son suministros comprados a Office Mart: el
  consumo por etapa debe poder descontar **productos** (2.2), no solo el
  inventario de materiales de producción.
- Un usuario factura desde un punto a la vez; el punto se asigna al usuario y
  puede cambiarse por venta si tiene permiso.

**Preguntas que destraban diseño**
1. Los 3 puntos de facturación: ¿qué empresa, ciudad, almacén y CAI tiene
   cada uno? ¿Un usuario puede facturar en más de un punto?
2. Políticas de comisión: ¿sobre venta o utilidad? ¿Al facturar o al cobrar?
   ¿Varían por línea o por vendedor? ¿Se descuentan devoluciones?
3. Consignación: ¿quién es el propietario (proveedor externo, Office Mart
   hacia Lettra)? ¿Se liquida por venta o por período? ¿Precio de liquidación
   fijo o por lista?
4. Etapas de producción por empresa (Lettra confección vs. impresión, IACO
   uniformes): lista exacta y si una OT puede saltarse etapas.
5. "Segundo cliente": ¿es facturar a un tercero, un contacto autorizado, o
   una cuenta consolidada (casa matriz)?
6. Bloqueo por mora: ¿días desde vencimiento o cualquier factura vencida?
   ¿Quién puede desbloquear?
7. Bancos y formato de extracto para la conciliación (BAC, Atlántida,
   Ficohsa…): un archivo de muestra por banco.
8. Reloj marcador actual (marca/formato de exportación) o marcación desde la
   app.
9. ¿Qué documentos se firman primero (cotización, acta de entrega, recibos,
   RRHH) y quién firma: cliente externo, empleado o ambos?
