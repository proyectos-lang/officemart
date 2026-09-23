/**
 * Officemart vive en el MISMO proyecto de Supabase que EasyCount, pero en su
 * propio esquema de Postgres. Todos los clientes (navegador, servidor, service
 * role y route handlers) deben usar `db: { schema: DB_SCHEMA }`; si no, las
 * queries caen en `public` (los datos de EasyCount).
 *
 * Está fijo en código a propósito (no en una variable de entorno): si faltara
 * la variable en Vercel, la app escribiría en `public` sin avisar.
 *
 * Requisito en Supabase: Dashboard → Project Settings → Data API →
 * "Exposed schemas" debe incluir `officemart`.
 */
export const DB_SCHEMA = 'officemart' as const

/**
 * Los buckets de Storage (`logos`, `productos`, `gastos`) se comparten con
 * EasyCount y los IDs de razón social de este esquema empiezan en 1, igual que
 * los de `public`. Toda ruta de archivo va bajo esta carpeta para que un
 * `logo_1.png` de Officemart no pise (ni borre) el de la empresa 1 de EasyCount.
 */
export const STORAGE_PREFIX = `${DB_SCHEMA}/`
