-- =========================================================================
-- OFFICEMART 019 — Planeación en línea de tiempo y Mastertracking.
-- =========================================================================
-- ADITIVO (solo columnas nullable sin default + INSERT de módulo).
--
--   produccion_operaciones.duracion_estandar_horas: tiempo estándar de la
--     operación en HORAS LABORALES (L–V 8–17, sábado 8–12). Base del plan.
--   produccion_orden_etapas.plan_inicio / plan_fin: fecha planeada de cada
--     etapa (línea base). Se calcula al generar las etapas de una orden o con
--     "Generar planeación" en Mastertracking. Sin estas columnas la app
--     calcula el plan al vuelo (no queda guardado como línea base).
--   Módulo "Mastertracking" (categoría Producción).
-- =========================================================================

ALTER TABLE officemart.produccion_operaciones ADD COLUMN IF NOT EXISTS duracion_estandar_horas numeric;
ALTER TABLE officemart.produccion_orden_etapas ADD COLUMN IF NOT EXISTS plan_inicio timestamptz;
ALTER TABLE officemart.produccion_orden_etapas ADD COLUMN IF NOT EXISTS plan_fin timestamptz;

INSERT INTO officemart.modulos (nombre) VALUES ('Mastertracking') ON CONFLICT (nombre) DO NOTHING;

NOTIFY pgrst, 'reload schema';
