# EasyCount — Guía para el desarrollo

ERP/POS multi-empresa: Next.js 16 (App Router) + Supabase. Español de Honduras
(Lempiras, RTN, ISV 15 %). Detalles de arquitectura en `README.md` y esquema de
BD en `docs/DATABASE.md`.

## Officemart (fork de EasyCount)

Este repo es la versión de EasyCount personalizada para **Officemart**.

- **Misma BD, otro esquema**: usa el mismo proyecto de Supabase (mismas
  variables de entorno) pero TODOS sus datos viven en el esquema `officemart`,
  no en `public` (que es EasyCount en producción). El esquema se fija en
  `lib/supabase/schema.ts` (`DB_SCHEMA`) y lo aplican los 3 clientes de
  `lib/supabase/`. **Nunca crear un cliente de Supabase sin
  `db: { schema: DB_SCHEMA }`**, ni escribir SQL contra `public.`.
- **Storage compartido**: los buckets son los de EasyCount; toda ruta de
  archivo va bajo `STORAGE_PREFIX` (`officemart/`) para no pisar archivos de
  EasyCount (los IDs de empresa de ambos esquemas empiezan en 1).
- **Auth compartido**: `auth.users` es común a todos los sistemas del
  proyecto; un correo ya usado en EasyCount u otro sistema no se puede
  registrar de nuevo.
- **Scripts SQL de Officemart**: `scripts/officemart-NNN-*.sql`, siempre
  calificados con `officemart.` (no usar la numeración 0NN de EasyCount, que
  sigue llegando desde `upstream`). El 000 clona la estructura de `public`.
- **Git**: `upstream` = repo de EasyCount (traer mejoras con
  `git pull upstream main`); nunca hacer push de Officemart a `upstream`.

## Reglas del proyecto

- **Multi-tenant**: toda query filtra por `razon_social_id`; todo insert lleva
  el sello de `getTenantStamp` (`lib/services/tenant-stamp.ts`). Toda tabla
  nueva recibe política RLS (patrón de `scripts/017-rls-policies.sql`).
- **Scripts SQL aditivos**: `CREATE TABLE` de tablas nuevas, `CREATE POLICY`
  sobre ellas, `INSERT` de datos y `ADD COLUMN IF NOT EXISTS` sobre tablas
  existentes (solo columnas **nullable, sin default ni constraints** → operación
  instantánea que no reescribe filas). **Nunca `DROP`, renombrar columnas ni
  `ALTER` que reescriba/bloquee** (cambiar tipo, `SET NOT NULL`, defaults, etc.).
- **Stock/costo**: nunca leer-modificar-escribir `productos.stock_total` o
  `costo_promedio`; usar `ajustarStock` / `aplicarEntradaCompra`
  (`lib/services/stock.ts`).
- **Exports**: siempre `.xlsx` vía `exportToXlsx` (`lib/utils/export.ts`).
  Nunca CSV. Moneda con `formatCurrency` (`lib/utils/format.ts`).
- **Verificación mínima** antes de commit: `npx tsc --noEmit`, `pnpm lint`,
  `pnpm build` limpios.

## Checklist al AGREGAR un módulo nuevo

1. Página en `app/(dashboard)/<ruta>/page.tsx` + servicios en `lib/services/`.
2. Entrada en `MODULOS` (`lib/constants/modulos.ts`) — actualizar el conteo
   del comentario.
3. `INSERT INTO modulos (nombre) ... ON CONFLICT DO NOTHING` en un script
   `scripts/NNN-*.sql` (el `nombre` debe calzar EXACTO con la constante).
4. **Tutorial en el Centro de Aprendizaje**: agregar el `TutorialModulo` en el
   `lib/aprendizaje/contenido-<categoria>.ts` correspondiente (`modulo` =
   `nombre` exacto de MODULOS). Si falta, la página `/aprendizaje` muestra un
   banner de cobertura a los admins.

## Checklist al CAMBIAR una función existente

- Si cambia el comportamiento visible de un módulo (nuevos pasos, límites,
  mensajes), **actualizar su tutorial** en `lib/aprendizaje/` en el mismo
  commit: `queHace`/`queNoHace`, `operaciones`, `faqs` y `keywords`.
- Si cambia el esquema de BD, actualizar `docs/DATABASE.md` y
  `scripts/README.md`.
