CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA IF NOT EXISTS app;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'zen_web') THEN
    CREATE ROLE zen_web LOGIN PASSWORD 'zen_web' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'zen_studio') THEN
    CREATE ROLE zen_studio LOGIN PASSWORD 'zen_studio' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'zen_portal') THEN
    CREATE ROLE zen_portal LOGIN PASSWORD 'zen_portal' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'zen_worker') THEN
    CREATE ROLE zen_worker LOGIN PASSWORD 'zen_worker' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'zen_api') THEN
    CREATE ROLE zen_api LOGIN PASSWORD 'zen_api' NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT;
  END IF;
END
$$;

GRANT zen_web TO zen_api;
GRANT zen_studio TO zen_api;
GRANT zen_portal TO zen_api;
GRANT zen_worker TO zen_api;

GRANT CONNECT ON DATABASE zenops TO zen_web, zen_studio, zen_portal, zen_worker, zen_api;
GRANT USAGE ON SCHEMA public TO zen_web, zen_studio, zen_portal, zen_worker, zen_api;
GRANT USAGE ON SCHEMA app TO zen_web, zen_studio, zen_portal, zen_worker, zen_api;

CREATE OR REPLACE FUNCTION app.nullif_blank(value text)
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(TRIM(value), '');
$$;

CREATE OR REPLACE FUNCTION app.current_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT CASE
    WHEN app.nullif_blank(current_setting('app.tenant_id', true)) IS NULL THEN NULL
    ELSE app.nullif_blank(current_setting('app.tenant_id', true))::uuid
  END;
$$;

CREATE OR REPLACE FUNCTION app.current_user_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT CASE
    WHEN app.nullif_blank(current_setting('app.user_id', true)) IS NULL THEN NULL
    ELSE app.nullif_blank(current_setting('app.user_id', true))::uuid
  END;
$$;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO zen_web, zen_studio, zen_portal, zen_worker;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
GRANT USAGE, SELECT ON SEQUENCES TO zen_web, zen_studio, zen_portal, zen_worker;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'work_orders') THEN
    ALTER TABLE public.work_orders
      ADD CONSTRAINT work_orders_portal_user_required_for_external
      CHECK (
        source <> 'external'::"WorkOrderSource"
        OR portal_user_id IS NOT NULL
      );
  END IF;
END $$;
