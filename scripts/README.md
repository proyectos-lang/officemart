# Migraciones SQL — EasyCount

Estos scripts construyen el esquema de Supabase. Se ejecutan **en orden** en el
SQL Editor de Supabase. Son en su mayoría idempotentes (`IF NOT EXISTS` /
`DROP ... IF EXISTS`), pero conviene aplicarlos en secuencia sobre una base nueva.

## Officemart

La app de Officemart usa el esquema `officemart` (no `public`). Los scripts
numerados 0NN de abajo son los de EasyCount y **no se ejecutan** para
Officemart: su estructura ya viene clonada.

| # | Script | Qué hace |
|---|---|---|
| O-000 | `officemart-000-clonar-esquema.sql` | Crea el esquema `officemart` clonando del **catálogo real** de `public`: tipos, secuencias, tablas (columnas, PK/UNIQUE, índices, identity), funciones y vistas, defaults, CHECK, FKs, triggers, RLS + políticas y privilegios (1:1). Reescribe cada `public.<objeto clonado>` a `officemart.` (las funciones de tenant leen `officemart.usuarios`). Omite las tablas de otra app que conviven en `public` (`gestiones`, `aduanas`, `mensajes`…). Siembra `modulos` y `plataforma_admins`. Todo o nada; solo sobre esquema vacío. **Después**: exponer `officemart` en Project Settings → Data API → Exposed schemas |
| O-001 | `officemart-001-base-comun.sql` | **Base común** de las entregas de Officemart: tabla `auditoria` (bitácora genérica: entidad, acción, motivo, antes/después; RLS solo SELECT/INSERT); tabla `correlativos` + RPC `siguiente_correlativo(serie, prefijo, pad, razon_social_id?)` / `peek_correlativo` (numeración **atómica** por empresa y serie vía UPSERT con lock de fila; sustituye los `COUNT(*)+1` de devoluciones y pedidos; sembrada desde los DEV-/PED- existentes); `ADD COLUMN` nullable en `cuenta_movimientos` (`referencia`, `conciliado_at`, `extracto_linea_id`) y en `transacciones_inventario` (`referencia_tipo`); `CREATE OR REPLACE` de `tg_limpiar_tesoreria_ref` para recalcular la cadena `saldo_resultante` por **(fecha, id)** — desde ahora un movimiento bancario puede llevar fecha pasada (`registrarMovimientoCuenta({fecha})`). Requiere O-000 |
| O-002 | `officemart-002-cimientos.sql` | **Cimientos** de catálogos: tabla `lineas` (línea de producto) + `productos.linea_id`; tablas `zonas` y `vendedores` (con `usuario_id` opcional = auth uid) + `clientes.zona_id/vendedor_id` + `ventas_encabezado.vendedor_id`; `clientes` gana `notas, correo, dias_credito, cliente_relacionado_id, bloqueado, motivo_bloqueo`; `proveedores` gana `correo, telefono, direccion, notas, moneda, pais, dias_credito`. Todas las columnas nuevas nullable sin default/constraint (las relaciones se resuelven en la app). Registra el módulo **Vendedores y Zonas** (nace deshabilitado). Requiere O-001 |
| O-003 | `officemart-003-anulacion-recibos.sql` | **Anulación de ventas** ("compensar, no borrar"): `ventas_encabezado.anulada_at/anulada_por/motivo_anulacion/anulacion_tipo/reclamo_id` (vigente = `anulada_at IS NULL`); tabla `ventas_reclamos`; **recibos de cobro** `recibos_cobro` (RC-####, un movimiento de tesorería `ref_tipo='recibo'` para varias facturas) + `pagos_ventas.recibo_id` + trigger `AFTER DELETE`; `devoluciones_encabezado` gana columnas fiscales (NC CAI 06) y `anulada_at`; `CREATE OR REPLACE` de `plataforma_resumen_empresas` excluyendo anuladas (en un `DO` que no aborta si la firma difiere). Las vistas `vista_cierre_diario`/`vista_estado_resultados_mensual` no se tocan (la app deja de leerlas y calcula desde las tablas). Registra los módulos **Reclamos de Ventas** y **Auditoría**. Requiere O-001 |
| O-004 | `officemart-004-puntos-facturacion.sql` | **Puntos de facturación** (sucursales): tabla `puntos_facturacion` (código, nombre, ciudad, dirección, teléfono, localización por defecto, `serie_prefijo`, activo); `usuarios.punto_facturacion_id`; tabla `facturacion_cai_puntos` (= `facturacion_cai_config` + `punto_facturacion_id`, `UNIQUE (razon, punto, tipo)`, sembrada desde la tabla vieja con punto 0) + RPC `siguiente_correlativo_cai_v2(tipo, punto)` / `peek_correlativo_cai_v2` (atómicos, devuelven rango/fecha límite/imprenta); `ventas_encabezado.punto_facturacion_id/localizacion_id/fiscal_snapshot` (foto de la autorización CAI usada). Serie interna por punto vía `siguiente_correlativo('venta:<id>', prefijo)`. Registra el módulo **Puntos de Facturación**. Requiere O-001 y O-003 |
| O-005 | `officemart-005-listas-reglas.sql` | **Reglas de precio por categoría / subcategoría / línea** en listas de precios: tabla `listas_precios_reglas` (lista_id, una sola dimensión por fila con CHECK, `porcentaje` de descuento, índices únicos parciales). Precedencia al vender: precio individual > subcategoría > categoría > línea > % general > maestro. Requiere O-002 |
| O-006 | `officemart-006-cotizaciones.sql` | **Cotizaciones**: tablas `cotizaciones_encabezado` (COT-#### serie `COT`, cliente o prospecto, vendedor, punto, vigencia, estado Borrador/Enviada/Aprobada/Facturada/Vencida/Rechazada, totales, condiciones, `venta_id`) y `cotizaciones_detalle` (producto o línea libre, cantidad, precio, % por línea). Registra el módulo **Cotizaciones**. Requiere O-001 |
| O-007 | `officemart-007-estado-cuenta-reportes.sql` | Módulo **Estado de Cuenta** (sin tabla: se calcula desde ventas, abonos y devoluciones) y vista `vista_ventas_reporte` (`security_invoker`; una fila por línea vendida con punto, vendedor, zona, cliente, producto, categoría, subcategoría, línea, marca, almacén, cantidad, venta, costo, utilidad y `anulada_at`) + módulos **Reportes de Ventas** y **Trazabilidad** (sin tabla: lotes FIFO sobre `transacciones_inventario`). Requiere O-002 y O-004 |

Scripts nuevos de Officemart: `officemart-NNN-*.sql`, con objetos calificados
`officemart.` Si llega un script 0NN nuevo desde EasyCount que haga falta
aquí, portarlo como `officemart-NNN` cambiando `public.` por `officemart.`

## Orden de ejecución (EasyCount / `public`)

| # | Script | Qué hace |
|---|---|---|
| 001 | `001-create-marcas-categorias.sql` | Tablas `marcas`, `categorias`; FKs en `productos` |
| 002 | `002-create-auth-tables.sql` | `modulos`, `usuarios`, `permisos_usuarios` |
| 003 | `003-add-logo-and-storage.sql` | `logo_url`, bucket de Storage + políticas de logos |
| 004 | `004-multitenant-refactor.sql` | Agrega `razon_social_id` a las tablas de negocio |
| 005 | `005-supabase-auth-refactor.sql` | Enlace con Supabase Auth (`auth_user_id`) |
| 009 | `009-add-valorpago-to-ventas.sql` | Columna `valorpago` en ventas |
| 010 | `010-add-cliente-telefono-fecha-nacimiento.sql` | Teléfono y cumpleaños de clientes |
| 011 | `011-tesoreria-caja-chica.sql` | Tesorería: cuentas, caja chica, pagos multi-método |
| 012 | `012-create-gastos.sql` | `conceptos_gastos`, `gastos` |
| 013 | `013-vista-cierre-diario.sql` | Vista `vista_cierre_diario` |
| 014 | `014-cuentas-por-pagar.sql` | Cuentas por pagar + `gastos_pagos_detalle` |
| 015 | `015-subcategorias.sql` | `subcategorias` |
| 016 | `016-vista-historico-caja-chica.sql` | Vista `vista_historico_caja_chica` |
| 017 | `017-rls-policies.sql` | **Políticas RLS de aislamiento multi-empresa** |
| 018 | `018-funciones-stock-atomico.sql` | **Funciones atómicas de stock y costo promedio** |
| 019 | `019-modulos-finanzas.sql` | Módulos Dashboard Finanzas y Movimientos de Cuentas |
| 020 | `020-devoluciones.sql` | Devoluciones (notas de crédito): 2 tablas + RLS + módulo |
| 021 | `021-pedidos-catalogo.sql` | Pedidos por Catálogo: 4 tablas + RLS + módulo |
| 022 | `022-errores-log.sql` | Log de errores de la app (monitoreo, solo service role) |
| 023 | `023-ajustes-inventario.sql` | Ajustes de Inventario: bitácora + RLS + módulo |
| 024 | `024-ventas-ediciones.sql` | Bitácora de ediciones de ventas + RLS (opcional) |
| 025 | `025-corregir-signo-salida-venta.sql` | Corrige el signo de `Salida Venta` en datos viejos (opcional, 1 vez) |
| 026 | `026-ajuste-costo.sql` | Ajuste de Costo: bitácora + RPC `fijar_costo_promedio`/`recalcular_costo_ventas` + RLS + módulo |
| 027 | `027-homologar-total-venta-bruto.sql` | Reescribe `total_venta` a BRUTO (= suma de líneas + ISV) en el histórico (opcional, 1 vez) |
| 028 | `028-ventas-pagos-detalle-columnas.sql` | Repara `ventas_pagos_detalle`: agrega `porcentaje_comision`/`usuario` y default a `monto_recibido` (bases con esquema viejo) |
| 029 | `029-reconstruir-desglose-pago.sql` | Reconstruye método + comisión de ventas viejas desde tesorería (preview + insert, opcional) |
| 030 | `030-recalcular-recepcion.sql` | Recalcular Recepción: registra el módulo (solo INSERT; reutiliza tablas/RPC del 026) |
| 031 | `031-analisis-financiero.sql` | Análisis Financiero: registra el módulo (solo INSERT; analítica de lectura sobre datos existentes) |
| 032 | `032-fix-rls-permisos-usuarios.sql` | Reactiva y corrige el RLS de `permisos_usuarios` (lectura directa `usuario_id = auth.uid()`; escrituras solo por service role) |
| 033 | `033-producto-talla.sql` | Agrega columna opcional `talla` (text) a `productos` |
| 034 | `034-caja-movimientos-fecha.sql` | Agrega `fecha` (timestamptz) a `caja_chica_movimientos` en bases que se crearon sin ella (aditivo + backfill); sin ella la caja chica no registra movimientos y el Flujo de Caja ignora el efectivo |
| 035 | `035-consolidacion-bancaria.sql` | Consolidación Bancaria: tabla `consolidacion_saldos_iniciales` (override manual del saldo inicial del mes por cuenta) + RLS + módulo |
| 036 | `036-eliminar-producto-rpc.sql` | RPC `eliminar_producto_en_cascada` (SECURITY DEFINER): borra el producto + sus movimientos de inventario ignorando RLS (alcanza filas mal selladas que rompen el FK); bloquea si tiene ventas o compras |
| 037 | `037-plataforma-admin.sql` | Portal de plataforma (super-admin): tabla `plataforma_admins` (allow-list) + RPCs `plataforma_resumen_empresas` / `plataforma_db_stats` (SECURITY DEFINER, solo `service_role`). **Ajusta el email sembrado** al de tu cuenta dueña |
| 038 | `038-razon-social-config.sql` | Mini-personalizaciones por empresa: tabla `razon_social_config` (JSONB de feature flags) + RLS (cada empresa LEE su fila; solo el `service_role`/portal ESCRIBE). Defaults en `lib/constants/feature-flags.ts`. Primer flag: `ventas_mostrar_isv` (oculta el ISV en Nueva Venta) |
| 039 | `039-tesoreria-limpieza-automatica.sql` | Red de seguridad: función + triggers `AFTER DELETE` en `gastos`/`ventas_encabezado`/`devoluciones_encabezado` que borran automáticamente los movimientos de tesorería (`caja_chica_movimientos`/`cuenta_movimientos` con ese `ref_tipo`/`ref_id`) y recalculan el saldo de las cuentas. Garantiza que borrar un padre nunca deje tesorería huérfana |
| 040 | `040-fecha-honduras-backstop.sql` | Backstop de hora de Honduras: triggers `BEFORE INSERT` en `transacciones_inventario`/`cuenta_movimientos`/`caja_chica_movimientos`/`pagos_ventas`/`devoluciones_encabezado` que fuerzan `fecha` a HN (`now()-6h`) cuando viene NULL o en UTC real (app cacheada vieja). Evita el desfase de +6h aunque el cliente esté desactualizado |
| 041 | `041-localizaciones-punto-venta.sql` | Config por localización: tabla `localizaciones_config` (`es_punto_venta`) + RLS (el admin de la empresa lee/escribe su config). La localización marcada como "Punto de venta" se preselecciona en Nueva Venta |
| 042 | `042-listas-precios.sql` | Listas de precios: tablas `listas_precios`, `listas_precios_detalle`, `cliente_lista_precio` + RLS + registro del módulo "Listas de Precios" (nace deshabilitado por empresa) |
| 043 | `043-producto-grupo-tallas.sql` | Grupo de tallas: tabla mapa `producto_grupo_tallas` (producto→grupo) + RLS. Vincula productos hermanos (misma prenda, varias tallas) para agruparlos en Productos/Inventario. No toca `productos` |
| 044 | `044-clientes-inactivos.sql` | Soft-delete de clientes: tabla mapa `clientes_inactivos` (cliente desactivado) + RLS. Un cliente con ventas no se borra (rompería el historial): se desactiva y desaparece de los selectores, pero sigue en el registro de ventas. No toca `clientes` |
| 045 | `045-ventas-detalle-descripcion.sql` | Venta Rápida: tabla mapa `ventas_detalle_descripcion` (texto libre de una línea sin producto) + RLS. La línea se guarda en `ventas_detalle` con producto_id NULL (no afecta inventario) y su descripción vive aquí para verse en el historial. No toca `ventas_detalle` |
| 046 | `046-produccion-materiales.sql` | Producción Fase 1 (Materiales): tablas `materiales`, `materiales_compras_encabezado/_detalle`, `materiales_movimientos` (kardex propio) + RLS + RPCs `mat_ajustar_stock`/`mat_aplicar_entrada` (análogas al 018 sobre materiales) + registro de 3 módulos (Materiales, Compra de Materiales, Inventario de Materiales), que nacen deshabilitados por empresa. Sistema propio de materia prima; no toca `productos` |
| 047 | `047-produccion-recetas.sql` | Producción Fase 2 (Recetas/MRP): tablas `produccion_recetas` (1×producto fabricado: estándar u/min, factores de costo por unidad, costo estimado) y `produccion_receta_materiales` (material + consumo por unidad) + RLS + registro del módulo `Recetas` (deshabilitado por empresa). Requiere el 046 |
| 048 | `048-produccion-ordenes.sql` | Producción Fase 3 (Órdenes): tabla mapa `productos_fabricados` (marca "es fabricado" sin tocar `productos`) + `produccion_ordenes` (producto, receta congelada, cantidad, fecha, estado) + RLS + registro del módulo `Ordenes de Produccion` (deshabilitado por empresa). Requiere 046 y 047 |
| 049 | `049-produccion-corridas.sql` | Producción Fase 4 (Control de Piso): tablas `produccion_corridas` (unidades buenas/defectuosas/procesadas, paros, tiempo, snapshots de costo, estado), `produccion_corrida_defectos` (motivos), `produccion_corrida_consumos` (bitácora del descuento) + RLS + registro del módulo `Control de Piso` (deshabilitado por empresa). Al ejecutar una corrida descuenta materiales (receta × procesadas) vía `mat_ajustar_stock` y snapshotea el costo. Requiere 046, 047, 048 |
| 050 | `050-produccion-dashboard.sql` | Producción Fase 5 (Dashboard/OEE): solo registra el módulo `Dashboard Produccion` (100% lectura, deshabilitado por empresa). Deriva unidades/día y OEE (Disponibilidad × Rendimiento × Calidad) de `produccion_corridas` + `produccion_recetas`. Sin tablas nuevas. Requiere 046-049 |
| 051 | `051-produccion-recepcion.sql` | Producción Fase 6 (Recepción de producto terminado): tabla `produccion_recepciones` + RLS + registro del módulo `Recepcion de Produccion` (deshabilitado por empresa). Al recibir una corrida ejecutada, entran las unidades buenas al inventario (`transacciones_inventario` 'Entrada Produccion' + `aplicar_entrada_compra`, costo ponderado). Requiere 046-049 |
| 060 | `060-facturacion-cai.sql` | Facturación CAI Fase 1 (comprobante fiscal SAR Honduras): tabla `facturacion_cai_config` (una fila por empresa y tipo de documento: CAI, establecimiento/punto, rango autorizado, correlativo, fecha límite, imprenta) + RLS por tenant (la edita el admin de la empresa) + registro del módulo `Facturación CAI` (deshabilitado por empresa). Se activa con el flag `facturacion_cai`. Requiere 017 |
| 061 | `061-correlativo-cai-atomico.sql` | Facturación CAI Fase 2: RPC atómico `siguiente_correlativo_cai(tipo)` que consume el correlativo fiscal de `facturacion_cai_config` con lock de fila, respetando el rango autorizado (falla si se agota/inactiva); + `peek_correlativo_cai(tipo)` (solo lectura, para el preview). SECURITY INVOKER (respeta RLS: cada empresa solo toca su fila). Requiere 060 |
| 062 | `062-ventas-numero-fiscal.sql` | Facturación CAI Fase 2: **`ALTER TABLE ventas_encabezado ADD COLUMN IF NOT EXISTS`** `numero_fiscal`, `cai_emitido`, `tipo_documento_fiscal` (nullable, sin default → instantáneo). Guarda el número fiscal CAI emitido en la venta sin tocar `numero_factura` (FC-#### interno). Excepción aprobada a la regla aditiva. Requiere 060, 061 |
| 063 | `063-fix-correlativo-cai-ambiguo.sql` | **FIX** de `siguiente_correlativo_cai`: la columna `tipo_documento` era ambigua (columna de tabla vs. columna de salida del RETURNS TABLE) → el RPC fallaba (42702) y las ventas quedaban sin `numero_fiscal`. Califica el WHERE con el nombre de la tabla. `CREATE OR REPLACE` (idempotente). Requiere 060, 061 |
| 064 | `064-cliente-limite-credito.sql` | **`ALTER TABLE clientes ADD COLUMN IF NOT EXISTS limite_credito numeric(14,2)`** (nullable → instantáneo). Tope de crédito acumulado por cliente; 0/NULL = sin límite. Editable en Clientes y en la plantilla de ventas; bloquea/omite ventas a crédito que lo excedan. |
| 065 | `065-compras-numero-factura.sql` | **`ALTER TABLE compras_encabezado ADD COLUMN IF NOT EXISTS numero_factura text`** (nullable → instantáneo). Guarda el número de la factura del proveedor. Lo usa Recepción por Factura (que ahora crea una compra real) para el historial y la referencia en el kardex. |
| 066 | `066-indices-rendimiento.sql` | **Índices de rendimiento** (`CREATE INDEX IF NOT EXISTS`, idempotente): `ventas_detalle(venta_id)` y `(producto_id)`, `ventas_encabezado(razon_social_id, fecha_venta)` y `(cliente_id)`, `transacciones_inventario(producto_id)` y `(referencia_id, tipo_movimiento)`, `pagos_ventas(venta_id)`, `ventas_detalle_descripcion(detalle_id)`, `compras_detalle(compra_id)`. No cambia datos ni comportamiento; acelera reportes/joins. Efecto inmediato para todas las empresas. |
| 067 | `067-vistas-valoracion.sql` | **Vistas de agregación** `vista_stock_producto_almacen` (SUM cantidad por producto/almacén) y `vista_ultima_venta_producto` (MAX fecha de 'Salida Venta'), ambas `security_invoker` (respetan la RLS del que consulta). La Valoración de Inventario las usa para no traer todo el kardex y hacer el bucle O(n×m) en JS; si no existen, cae al cálculo actual (fallback). Mismos números, calculados en la base. |
| — | `add-almacen-to-ventas-encabezado.sql` | Agrega `almacen_id` a ventas (aplicar tras 011) |
| — | `agrupar-tallas-coral-razon-10.sql` | ONE-OFF: agrupa las tallas ya existentes de Coral Swimwear (razón 10) por (nombre, marca). Requiere el 043 |

> **Huecos 006–008:** la numeración salta de 005 a 009. No faltan migraciones;
> los números simplemente no se usaron. El orden de arriba es el completo.

> **Nota sobre el script 014:** en la base actual las _columnas_ de cuentas
> por pagar (`fecha_vencimiento`, `monto_pagado`, `estado_pago` en `gastos`)
> sí existen, pero la tabla `gastos_pagos_detalle` **no** se creó. La app no
> la necesita (los abonos a gastos se reconstruyen desde
> `caja_chica_movimientos` y `cuenta_movimientos`), y el script 017 la omite
> si no existe. Si en el futuro quieres el historial de abonos en su propia
> tabla, aplica la parte `CREATE TABLE gastos_pagos_detalle` del script 014 y
> vuelve a correr el 017 (que entonces sí le pondrá RLS).

## Seguridad (RLS)

El aislamiento entre empresas depende de las políticas del script **017**.
Si recreas el proyecto o migras de entorno, **ejecuta 017** o los datos de
todas las empresas quedarán mezclados. Antes de aplicarlo, respalda las
políticas actuales (la consulta está documentada dentro del propio script).

## Consistencia de stock (RPC)

El script **018** crea las funciones `ajustar_stock` y `aplicar_entrada_compra`
que actualizan `stock_total` y `costo_promedio` de forma atómica, evitando la
pérdida de actualizaciones cuando dos ventas o recepciones del mismo producto
ocurren a la vez. Mientras no lo apliques, la app usa una ruta de respaldo
(lee-modifica-escribe, no concurrency-safe) que funciona igual pero sin la
garantía atómica. En cuanto ejecutes el 018, la app empieza a usar las
funciones automáticamente (sin cambios de código).

El script **026** agrega `fijar_costo_promedio` (SET absoluto del costo, para el
módulo Ajuste de Costo) y `recalcular_costo_ventas` (reescribe el costo
congelado de las ventas de un producto en un rango, de forma **transaccional**:
los tres UPDATE —`ventas_detalle`, `transacciones_inventario`,
`devoluciones_detalle`— corren todo-o-nada en el servidor). Sin el 026, el
módulo funciona en modo degradado: fallback JS best-effort (no atómico) y sin
bitácora.
