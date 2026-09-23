-- =========================================================================
-- OFFICEMART 015 — Módulo "Balance" (balance operativo / de gestión).
-- =========================================================================
-- ADITIVO. Sin tablas: el balance se calcula en la app desde caja, bancos,
-- CxC, inventario (propio y materiales), anticipos a proveedores, CxP de
-- gastos y de órdenes de compra, comisiones por pagar y consignación por
-- liquidar. Requiere officemart-008/011/012 para las partidas nuevas (si
-- faltan, esas partidas van en 0).
-- =========================================================================

INSERT INTO officemart.modulos (nombre) VALUES ('Balance') ON CONFLICT (nombre) DO NOTHING;

NOTIFY pgrst, 'reload schema';
