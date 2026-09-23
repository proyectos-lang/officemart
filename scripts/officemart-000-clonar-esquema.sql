-- =========================================================================
-- OFFICEMART 000 — Clonar la ESTRUCTURA de EasyCount (public) al esquema
--                  `officemart` del MISMO proyecto de Supabase.
-- =========================================================================
-- ADITIVO: crea un esquema nuevo. No modifica ni lee datos de negocio de
-- `public` (solo copia el catálogo `modulos` y la allow-list
-- `plataforma_admins`).
--
-- En vez de re-ejecutar los scripts 001-067 (la base real de EasyCount nació
-- antes que ellos y diverge), este script lee el CATÁLOGO real de `public` y
-- recrea en `officemart`:
--   tipos enum → secuencias → tablas (LIKE ... INCLUDING ALL: columnas,
--   NOT NULL, CHECK, PK/UNIQUE, índices, identity) → funciones y vistas
--   (varias pasadas, por dependencias) → defaults → FKs → triggers →
--   RLS + políticas → privilegios (copiados 1:1 de public) → semillas.
-- Cada referencia `public.<objeto clonado>` se reescribe a
-- `officemart.<objeto>`; las de extensiones (pg_trgm, etc.) se dejan en
-- public. Así las funciones de tenant (app_current_tenant,
-- get_session_razon_social_id) leen `officemart.usuarios`, no los de EasyCount.
--
-- TODO O NADA: si algo falla, el bloque aborta y no queda nada a medias.
-- Solo corre sobre un esquema `officemart` vacío.
--
-- ANTES DE EJECUTAR: nada.
-- DESPUÉS DE EJECUTAR (manual, no se puede por SQL):
--   Dashboard → Project Settings → Data API → "Exposed schemas" → agregar
--   `officemart` y guardar.
--
-- Ejecutar en: Supabase Dashboard → SQL Editor, completo, de una vez.
-- El resultado final es una tabla-resumen de lo que se clonó.
-- =========================================================================

CREATE SCHEMA IF NOT EXISTS officemart;

-- Bitácora de la ejecución (temporal, desaparece al cerrar la sesión).
CREATE TEMP TABLE IF NOT EXISTS clon_log (
  orden   serial,
  paso    text,
  objeto  text,
  detalle text
);
TRUNCATE clon_log;

DO $clone$
DECLARE
  -- Objetos de `public` que NO son de EasyCount (otra app comparte el
  -- esquema). No se clonan.
  excluidas text[] := ARRAY[
    'gestiones','calificaciones','empresas','aduanas','documentos',
    'tipos_documento','estados_catalogo','documentos_requeridos','mensajes',
    'configuracion','notificaciones','eventos',
    'v_tiempos_etapa','v_gestion_estado_actual'
  ];
  re_excl   text;   -- regex: referencia a una tabla excluida
  re_nombres text;  -- regex: public.<objeto clonado>
  nombres   text[];
  r         record;
  col       record;
  ddl       text;
  expr      text;
  pendientes jsonb;
  quedan    jsonb;
  progreso  boolean;
  fallas    text;
  extra     text;
BEGIN
  -- Con search_path = pg_catalog los deparsers (pg_get_expr, pg_get_viewdef,
  -- pg_get_constraintdef, pg_get_triggerdef...) califican TODO con esquema,
  -- lo que permite reescribir `public.x` sin ambigüedad.
  PERFORM set_config('search_path', 'pg_catalog', true);
  -- Funciones SQL que referencian vistas/funciones aún no creadas.
  PERFORM set_config('check_function_bodies', 'off', true);

  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'officemart' AND c.relkind IN ('r','p','v','m','S')
  ) THEN
    RAISE EXCEPTION 'El esquema officemart ya tiene objetos. Este script solo corre sobre un esquema vacío.';
  END IF;

  re_excl := '(\mpublic\.|\m(from|join|into|update|table|on)\s+)(' || array_to_string(excluidas, '|') || ')\M';

  -- ---------------------------------------------------------------------
  -- Conjunto de objetos a clonar (tablas, vistas, secuencias, funciones,
  -- tipos) — excluye miembros de extensiones y la lista `excluidas`.
  -- ---------------------------------------------------------------------
  CREATE TEMP TABLE clon_rel ON COMMIT DROP AS
  SELECT c.oid, c.relname::text AS nombre, c.relkind
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind IN ('r','v','m','S')
    AND NOT (c.relname = ANY (excluidas))
    AND NOT EXISTS (SELECT 1 FROM pg_depend d
                    WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e');

  -- Secuencias: fuera las de columnas identity (las recrea LIKE) y las que
  -- pertenecen a tablas excluidas.
  DELETE FROM clon_rel s
  WHERE s.relkind = 'S' AND EXISTS (
    SELECT 1 FROM pg_depend d
    JOIN pg_class t ON t.oid = d.refobjid
    WHERE d.classid = 'pg_class'::regclass AND d.objid = s.oid
      AND d.refclassid = 'pg_class'::regclass
      AND (d.deptype = 'i' OR (d.deptype = 'a' AND t.relname = ANY (excluidas)))
  );

  CREATE TEMP TABLE clon_fn ON COMMIT DROP AS
  SELECT p.oid, p.proname::text AS nombre
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.prokind IN ('f','p')
    AND NOT EXISTS (SELECT 1 FROM pg_depend d
                    WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e');

  -- Funciones de la otra app (tocan tablas excluidas): no se clonan.
  FOR r IN SELECT f.oid, f.nombre FROM clon_fn f
           WHERE pg_get_functiondef(f.oid) ~* re_excl LOOP
    DELETE FROM clon_fn WHERE oid = r.oid;
    INSERT INTO clon_log (paso, objeto, detalle)
    VALUES ('omitida', r.nombre || '()', 'función de otra app (usa tablas excluidas)');
  END LOOP;

  -- Vistas de la otra app (leen tablas excluidas): no se clonan.
  FOR r IN SELECT c.oid, c.nombre FROM clon_rel c
           WHERE c.relkind IN ('v','m') AND pg_get_viewdef(c.oid) ~* re_excl LOOP
    DELETE FROM clon_rel WHERE oid = r.oid;
    INSERT INTO clon_log (paso, objeto, detalle)
    VALUES ('omitida', r.nombre, 'vista de otra app (usa tablas excluidas)');
  END LOOP;

  CREATE TEMP TABLE clon_tipo ON COMMIT DROP AS
  SELECT t.oid, t.typname::text AS nombre, t.typtype
  FROM pg_type t
  JOIN pg_namespace n ON n.oid = t.typnamespace
  WHERE n.nspname = 'public'
    AND t.typtype IN ('e','d')
    AND NOT EXISTS (SELECT 1 FROM pg_depend d
                    WHERE d.classid = 'pg_type'::regclass AND d.objid = t.oid AND d.deptype = 'e');

  IF EXISTS (SELECT 1 FROM clon_tipo WHERE typtype = 'd') THEN
    RAISE EXCEPTION 'public tiene DOMAINs propios (%); este script no los soporta todavía.',
      (SELECT string_agg(nombre, ', ') FROM clon_tipo WHERE typtype = 'd');
  END IF;

  SELECT array_agg(DISTINCT x) INTO nombres FROM (
    SELECT nombre AS x FROM clon_rel
    UNION SELECT nombre FROM clon_fn
    UNION SELECT nombre FROM clon_tipo
  ) s;
  re_nombres := '(\mpublic|"public")\.("?)(' || array_to_string(nombres, '|') || ')\M';

  -- Reescritor: public.<clonado> → officemart.<clonado>. Todo lo demás
  -- (auth.*, extensions.*, objetos de extensiones en public) queda igual.
  EXECUTE format($f$
    CREATE FUNCTION pg_temp.om_rw(t text) RETURNS text LANGUAGE sql IMMUTABLE AS
    $b$ SELECT regexp_replace(t, %L, 'officemart.\2\3', 'g') $b$
  $f$, re_nombres);

  -- ---------------------------------------------------------------------
  -- 1. Tipos enum
  -- ---------------------------------------------------------------------
  FOR r IN SELECT * FROM clon_tipo WHERE typtype = 'e' LOOP
    SELECT format('CREATE TYPE officemart.%I AS ENUM (%s)', r.nombre,
                  string_agg(quote_literal(e.enumlabel), ', ' ORDER BY e.enumsortorder))
      INTO ddl FROM pg_enum e WHERE e.enumtypid = r.oid;
    EXECUTE ddl;
    INSERT INTO clon_log (paso, objeto) VALUES ('tipo', r.nombre);
  END LOOP;

  -- ---------------------------------------------------------------------
  -- 2. Secuencias (arrancan desde su START; officemart no hereda datos)
  -- ---------------------------------------------------------------------
  FOR r IN SELECT c.nombre, s.* FROM clon_rel c JOIN pg_sequence s ON s.seqrelid = c.oid
           WHERE c.relkind = 'S' LOOP
    EXECUTE format(
      'CREATE SEQUENCE officemart.%I AS %s INCREMENT %s MINVALUE %s MAXVALUE %s START %s CACHE %s %s',
      r.nombre, format_type(r.seqtypid, NULL), r.seqincrement, r.seqmin, r.seqmax,
      r.seqstart, r.seqcache, CASE WHEN r.seqcycle THEN 'CYCLE' ELSE 'NO CYCLE' END);
    INSERT INTO clon_log (paso, objeto) VALUES ('secuencia', r.nombre);
  END LOOP;

  -- ---------------------------------------------------------------------
  -- 3. Tablas: columnas, NOT NULL, PK/UNIQUE, índices, identity.
  --    Defaults y CHECK se agregan después (pasos 5 y 6): pueden invocar
  --    secuencias o funciones de public y hay que reescribirlos.
  -- ---------------------------------------------------------------------
  FOR r IN SELECT * FROM clon_rel WHERE relkind = 'r' ORDER BY nombre LOOP
    EXECUTE format('CREATE TABLE officemart.%I (LIKE public.%I INCLUDING ALL EXCLUDING DEFAULTS EXCLUDING CONSTRAINTS)',
                   r.nombre, r.nombre);

    -- Columnas de tipo enum propio → al enum de officemart.
    FOR col IN SELECT a.attname, t.typname
               FROM pg_attribute a JOIN pg_type t ON t.oid = a.atttypid
               WHERE a.attrelid = r.oid AND a.attnum > 0 AND NOT a.attisdropped
                 AND t.oid IN (SELECT oid FROM clon_tipo) LOOP
      EXECUTE format('ALTER TABLE officemart.%I ALTER COLUMN %I TYPE officemart.%I USING %I::text::officemart.%I',
                     r.nombre, col.attname, col.typname, col.attname, col.typname);
    END LOOP;

    INSERT INTO clon_log (paso, objeto) VALUES ('tabla', r.nombre);
  END LOOP;

  -- Secuencias propiedad de columnas (serial): OWNED BY.
  FOR r IN SELECT s.nombre AS seq, t.relname AS tabla, a.attname AS columna
           FROM clon_rel s
           JOIN pg_depend d ON d.classid = 'pg_class'::regclass AND d.objid = s.oid
                           AND d.refclassid = 'pg_class'::regclass AND d.deptype = 'a'
           JOIN pg_class t ON t.oid = d.refobjid
           JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = d.refobjsubid
           WHERE s.relkind = 'S' LOOP
    EXECUTE format('ALTER SEQUENCE officemart.%I OWNED BY officemart.%I.%I', r.seq, r.tabla, r.columna);
  END LOOP;

  -- ---------------------------------------------------------------------
  -- 4. Funciones y vistas, en varias pasadas hasta resolver dependencias
  --    (una función puede devolver SETOF vista y una vista usar funciones).
  -- ---------------------------------------------------------------------
  SELECT jsonb_agg(x) INTO pendientes FROM (
    SELECT jsonb_build_object('k','fn','oid',oid,'nombre',nombre) AS x FROM clon_fn
    UNION ALL
    SELECT jsonb_build_object('k','vw','oid',oid,'nombre',nombre) FROM clon_rel WHERE relkind IN ('v','m')
  ) s;
  pendientes := coalesce(pendientes, '[]'::jsonb);

  LOOP
    quedan := '[]'::jsonb;
    progreso := false;
    fallas := NULL;
    FOR r IN SELECT value AS o FROM jsonb_array_elements(pendientes) LOOP
      BEGIN
        IF r.o->>'k' = 'fn' THEN
          EXECUTE pg_temp.om_rw(pg_get_functiondef((r.o->>'oid')::oid));
        ELSE
          SELECT format('CREATE %sVIEW officemart.%I%s AS %s',
                        CASE WHEN c.relkind = 'm' THEN 'MATERIALIZED ' ELSE '' END,
                        c.relname,
                        CASE WHEN c.reloptions IS NOT NULL
                             THEN ' WITH (' || array_to_string(c.reloptions, ', ') || ')' ELSE '' END,
                        pg_temp.om_rw(rtrim(pg_get_viewdef(c.oid), ';' || chr(10) || ' ')))
            INTO ddl FROM pg_class c WHERE c.oid = (r.o->>'oid')::oid;
          EXECUTE ddl;
        END IF;
        progreso := true;
      EXCEPTION WHEN OTHERS THEN
        quedan := quedan || jsonb_build_array(r.o || jsonb_build_object('err', SQLERRM));
      END;
    END LOOP;
    pendientes := quedan;
    EXIT WHEN jsonb_array_length(pendientes) = 0 OR NOT progreso;
  END LOOP;

  IF jsonb_array_length(pendientes) > 0 THEN
    SELECT string_agg((o->>'nombre') || ': ' || (o->>'err'), E'\n') INTO fallas
    FROM jsonb_array_elements(pendientes) o;
    RAISE EXCEPTION E'No se pudieron clonar estas funciones/vistas (no se aplicó nada):\n%', fallas;
  END IF;

  -- search_path de las funciones: `public` → `officemart, public` (public se
  -- conserva al final solo para funciones de extensiones como pg_trgm).
  -- Las que no fijaban search_path quedan con uno explícito para no depender
  -- del que traiga la sesión.
  FOR r IN SELECT f.oid, f.nombre, pg_get_function_identity_arguments(f.oid) AS args,
                  (SELECT substr(cfg, length('search_path=') + 1)
                     FROM unnest(p.proconfig) cfg WHERE cfg LIKE 'search_path=%') AS sp
           FROM clon_fn f JOIN pg_proc p ON p.oid = f.oid LOOP
    EXECUTE format('ALTER FUNCTION officemart.%I(%s) SET search_path = %s',
                   r.nombre, pg_temp.om_rw(r.args),
                   CASE WHEN r.sp IS NULL THEN 'officemart, public, extensions'
                        WHEN r.sp IN ('', '""') THEN quote_literal('')
                        WHEN r.sp ~ '\mofficemart\M' THEN r.sp
                        ELSE regexp_replace(r.sp, '("?)\mpublic\M("?)', 'officemart, public') END);
    INSERT INTO clon_log (paso, objeto) VALUES ('función', r.nombre || '(' || r.args || ')');
  END LOOP;

  INSERT INTO clon_log (paso, objeto)
  SELECT 'vista', nombre FROM clon_rel WHERE relkind IN ('v','m') ORDER BY nombre;

  -- ---------------------------------------------------------------------
  -- 5. Defaults (nextval, app_current_tenant(), now(), literales...)
  -- ---------------------------------------------------------------------
  FOR r IN SELECT t.relname, a.attname, pg_get_expr(d.adbin, d.adrelid) AS def
           FROM clon_rel c
           JOIN pg_class t ON t.oid = c.oid
           JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum > 0 AND NOT a.attisdropped
           JOIN pg_attrdef d ON d.adrelid = t.oid AND d.adnum = a.attnum
           WHERE c.relkind = 'r' AND a.attidentity = '' AND a.attgenerated = '' LOOP
    EXECUTE format('ALTER TABLE officemart.%I ALTER COLUMN %I SET DEFAULT %s',
                   r.relname, r.attname, pg_temp.om_rw(r.def));
  END LOOP;

  -- ---------------------------------------------------------------------
  -- 6. CHECK + llaves foráneas
  -- ---------------------------------------------------------------------
  FOR r IN SELECT t.relname, con.conname, pg_get_constraintdef(con.oid) AS def, con.contype,
                  rt.relname AS ref
           FROM clon_rel c
           JOIN pg_class t ON t.oid = c.oid
           JOIN pg_constraint con ON con.conrelid = t.oid
           LEFT JOIN pg_class rt ON rt.oid = con.confrelid
           LEFT JOIN pg_namespace rn ON rn.oid = rt.relnamespace
           WHERE c.relkind = 'r'
             AND con.contype IN ('c','f')
           ORDER BY con.contype, t.relname, con.conname LOOP
    IF r.contype = 'f' AND r.ref = ANY (excluidas) THEN
      INSERT INTO clon_log (paso, objeto, detalle)
      VALUES ('omitida', r.relname || '.' || r.conname, 'FK hacia tabla de otra app: ' || r.ref);
      CONTINUE;
    END IF;
    EXECUTE format('ALTER TABLE officemart.%I ADD CONSTRAINT %I %s',
                   r.relname, r.conname, pg_temp.om_rw(r.def));
    INSERT INTO clon_log (paso, objeto, detalle)
    VALUES (CASE r.contype WHEN 'f' THEN 'fk' ELSE 'check' END, r.relname || '.' || r.conname, r.ref);
  END LOOP;

  -- ---------------------------------------------------------------------
  -- 7. Triggers
  -- ---------------------------------------------------------------------
  FOR r IN SELECT tg.oid, tg.tgname, tg.tgenabled, t.relname
           FROM clon_rel c
           JOIN pg_class t ON t.oid = c.oid
           JOIN pg_trigger tg ON tg.tgrelid = t.oid AND NOT tg.tgisinternal
           ORDER BY t.relname, tg.tgname LOOP
    EXECUTE pg_temp.om_rw(pg_get_triggerdef(r.oid));
    IF r.tgenabled = 'D' THEN
      EXECUTE format('ALTER TABLE officemart.%I DISABLE TRIGGER %I', r.relname, r.tgname);
    END IF;
    INSERT INTO clon_log (paso, objeto) VALUES ('trigger', r.relname || '.' || r.tgname);
  END LOOP;

  -- ---------------------------------------------------------------------
  -- 8. RLS + políticas (idénticas a public, reescritas a officemart)
  -- ---------------------------------------------------------------------
  FOR r IN SELECT t.relname, t.relrowsecurity, t.relforcerowsecurity
           FROM clon_rel c JOIN pg_class t ON t.oid = c.oid
           WHERE c.relkind = 'r' AND t.relrowsecurity LOOP
    EXECUTE format('ALTER TABLE officemart.%I ENABLE ROW LEVEL SECURITY', r.relname);
    IF r.relforcerowsecurity THEN
      EXECUTE format('ALTER TABLE officemart.%I FORCE ROW LEVEL SECURITY', r.relname);
    END IF;
    INSERT INTO clon_log (paso, objeto) VALUES ('rls', r.relname);
  END LOOP;

  FOR r IN SELECT t.relname, p.polname, p.polpermissive, p.polcmd,
                  pg_get_expr(p.polqual, p.polrelid) AS qual,
                  pg_get_expr(p.polwithcheck, p.polrelid) AS chk,
                  CASE WHEN p.polroles = '{0}' THEN 'public'
                       ELSE (SELECT string_agg(quote_ident(rolname), ', ')
                               FROM pg_roles WHERE oid = ANY (p.polroles)) END AS roles
           FROM clon_rel c
           JOIN pg_class t ON t.oid = c.oid
           JOIN pg_policy p ON p.polrelid = t.oid
           ORDER BY t.relname, p.polname LOOP
    EXECUTE format('CREATE POLICY %I ON officemart.%I AS %s FOR %s TO %s%s%s',
      r.polname, r.relname,
      CASE WHEN r.polpermissive THEN 'PERMISSIVE' ELSE 'RESTRICTIVE' END,
      CASE r.polcmd WHEN 'r' THEN 'SELECT' WHEN 'a' THEN 'INSERT' WHEN 'w' THEN 'UPDATE'
                    WHEN 'd' THEN 'DELETE' ELSE 'ALL' END,
      r.roles,
      CASE WHEN r.qual IS NOT NULL THEN ' USING (' || pg_temp.om_rw(r.qual) || ')' ELSE '' END,
      CASE WHEN r.chk  IS NOT NULL THEN ' WITH CHECK (' || pg_temp.om_rw(r.chk) || ')' ELSE '' END);
    INSERT INTO clon_log (paso, objeto) VALUES ('política', r.relname || ': ' || r.polname);
  END LOOP;

  -- ---------------------------------------------------------------------
  -- 9. Privilegios: copia EXACTA de los de public (p. ej. errores_log y las
  --    RPC plataforma_* quedan solo para service_role, igual que allá).
  -- ---------------------------------------------------------------------
  FOR r IN SELECT c.nombre, c.relkind, a.privilege_type,
                  CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE quote_ident(g.rolname) END AS grantee
           FROM clon_rel c
           JOIN pg_class t ON t.oid = c.oid
           CROSS JOIN LATERAL aclexplode(t.relacl) a
           LEFT JOIN pg_roles g ON g.oid = a.grantee
           WHERE t.relacl IS NOT NULL AND a.grantee <> t.relowner LOOP
    EXECUTE format('GRANT %s ON %s officemart.%I TO %s', r.privilege_type,
                   CASE WHEN r.relkind = 'S' THEN 'SEQUENCE' ELSE 'TABLE' END, r.nombre, r.grantee);
  END LOOP;

  FOR r IN SELECT f.oid, f.nombre, pg_get_function_identity_arguments(f.oid) AS args, p.proacl, p.proowner
           FROM clon_fn f JOIN pg_proc p ON p.oid = f.oid LOOP
    extra := format('officemart.%I(%s)', r.nombre, pg_temp.om_rw(r.args));
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', extra);
    IF r.proacl IS NULL THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO PUBLIC', extra);
    ELSE
      FOR col IN SELECT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE quote_ident(g.rolname) END AS grantee
                 FROM aclexplode(r.proacl) a LEFT JOIN pg_roles g ON g.oid = a.grantee
                 WHERE a.privilege_type = 'EXECUTE' AND a.grantee <> r.proowner LOOP
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO %s', extra, col.grantee);
      END LOOP;
    END IF;
  END LOOP;

  -- ---------------------------------------------------------------------
  -- 10. Semillas: catálogo de módulos (mismos IDs) + super-admins.
  -- ---------------------------------------------------------------------
  INSERT INTO officemart.modulos OVERRIDING SYSTEM VALUE SELECT * FROM public.modulos;
  INSERT INTO officemart.plataforma_admins OVERRIDING SYSTEM VALUE SELECT * FROM public.plataforma_admins;
  INSERT INTO clon_log (paso, objeto, detalle)
  VALUES ('semilla', 'modulos', (SELECT count(*) FROM officemart.modulos) || ' filas'),
         ('semilla', 'plataforma_admins', (SELECT string_agg(email, ', ') FROM officemart.plataforma_admins));

  -- Secuencias de las tablas sembradas: continuar después del máximo id.
  FOR r IN SELECT t.relname, a.attname, pg_get_serial_sequence(format('officemart.%I', t.relname), a.attname) AS seq
           FROM pg_class t
           JOIN pg_namespace n ON n.oid = t.relnamespace AND n.nspname = 'officemart'
           JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum > 0 AND NOT a.attisdropped
           WHERE t.relname IN ('modulos','plataforma_admins') LOOP
    IF r.seq IS NOT NULL THEN
      EXECUTE format('SELECT setval(%L, coalesce((SELECT max(%I) FROM officemart.%I), 0) + 1, false)',
                     r.seq, r.attname, r.relname);
    END IF;
  END LOOP;
END
$clone$;

-- -------------------------------------------------------------------------
-- 11. Acceso de la Data API (PostgREST) al esquema y a objetos FUTUROS.
--     (Los objetos clonados ya tienen sus privilegios copiados de public.)
-- -------------------------------------------------------------------------
GRANT USAGE ON SCHEMA officemart TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA officemart GRANT ALL ON TABLES    TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA officemart GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA officemart GRANT ALL ON ROUTINES  TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';

-- Resumen
SELECT paso, count(*) AS cantidad,
       string_agg(objeto || coalesce(' (' || detalle || ')', ''), ', ' ORDER BY orden) AS objetos
FROM clon_log
GROUP BY paso
ORDER BY min(orden);
