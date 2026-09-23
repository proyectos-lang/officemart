-- =========================================================================
-- OFFICEMART 007 — Estado de cuenta de cliente y reportes dinámicos de ventas.
-- =========================================================================
-- ADITIVO. Requiere officemart-002 (líneas, vendedores, zonas) y 004 (puntos).
--
--   1. Módulo "Estado de Cuenta" (sin tabla: se calcula desde ventas, abonos y
--      devoluciones).
--   2. Vista `vista_ventas_reporte` (security_invoker: respeta RLS) — una fila
--      por línea vendida con todas las dimensiones para el reporte dinámico:
--      fecha, punto, vendedor, zona, cliente, producto, categoría,
--      subcategoría, línea, marca, almacén; cantidad, venta, costo, utilidad
--      y `anulada_at` (la app filtra vigentes).
--   3. Módulo "Reportes de Ventas".
--   4. Módulo "Trazabilidad" (sin tabla: lotes FIFO sobre transacciones_inventario).
-- =========================================================================

INSERT INTO officemart.modulos (nombre) VALUES ('Estado de Cuenta') ON CONFLICT (nombre) DO NOTHING;

CREATE OR REPLACE VIEW officemart.vista_ventas_reporte
WITH (security_invoker = true) AS
SELECT
  vd.id                                   AS detalle_id,
  ve.id                                   AS venta_id,
  ve.razon_social_id,
  ve.numero_factura,
  ve.fecha_venta,
  (ve.fecha_venta)::date                  AS fecha,
  ve.anulada_at,
  ve.estado_pago,
  ve.punto_facturacion_id,
  pf.codigo                               AS punto_codigo,
  pf.nombre                               AS punto_nombre,
  ve.vendedor_id,
  vd_.nombre                              AS vendedor_nombre,
  ve.cliente_id,
  c.nombre                                AS cliente_nombre,
  c.zona_id,
  z.nombre                                AS zona_nombre,
  ve.almacen_id,
  a.nombre                                AS almacen_nombre,
  vd.producto_id,
  p.nombre                                AS producto_nombre,
  p.codigo_barras                         AS producto_codigo,
  p.categoria_id,
  cat.nombre                              AS categoria_nombre,
  p.subcategoria_id,
  sub.nombre                              AS subcategoria_nombre,
  p.linea_id,
  l.nombre                                AS linea_nombre,
  p.marca_id,
  m.nombre                                AS marca_nombre,
  vd.cantidad,
  vd.precio_unitario,
  (vd.cantidad * vd.precio_unitario)      AS venta,
  vd.costo_promedio_momento               AS costo_unitario,
  (vd.cantidad * COALESCE(vd.costo_promedio_momento, 0)) AS costo,
  vd.utilidad_linea                       AS utilidad
FROM officemart.ventas_detalle vd
JOIN officemart.ventas_encabezado ve ON ve.id = vd.venta_id
LEFT JOIN officemart.productos p           ON p.id = vd.producto_id
LEFT JOIN officemart.categorias cat        ON cat.id = p.categoria_id
LEFT JOIN officemart.subcategorias sub     ON sub.id = p.subcategoria_id
LEFT JOIN officemart.lineas l              ON l.id = p.linea_id
LEFT JOIN officemart.marcas m              ON m.id = p.marca_id
LEFT JOIN officemart.clientes c            ON c.id = ve.cliente_id
LEFT JOIN officemart.zonas z               ON z.id = c.zona_id
LEFT JOIN officemart.vendedores vd_        ON vd_.id = ve.vendedor_id
LEFT JOIN officemart.puntos_facturacion pf ON pf.id = ve.punto_facturacion_id
LEFT JOIN officemart.almacenes a           ON a.id = ve.almacen_id;

GRANT SELECT ON officemart.vista_ventas_reporte TO authenticated;

INSERT INTO officemart.modulos (nombre) VALUES ('Reportes de Ventas') ON CONFLICT (nombre) DO NOTHING;
INSERT INTO officemart.modulos (nombre) VALUES ('Trazabilidad')       ON CONFLICT (nombre) DO NOTHING;

NOTIFY pgrst, 'reload schema';
