-- Row-Level Security: tercera barrera de aislamiento entre organizaciones.
-- Aunque una consulta olvide filtrar por organization_id, Postgres solo devuelve
-- (y solo deja escribir) filas de la organización fijada en la transacción con
-- set_config('app.organization_id', ...). Sin ese valor: ninguna fila.
--
-- La API debe conectarse con un usuario que pertenezca al rol cumplia_app (sin
-- privilegios de dueño ni de superusuario: esos se saltean RLS). Las migraciones
-- siguen corriendo con el dueño de las tablas.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cumplia_app') THEN
    CREATE ROLE cumplia_app NOLOGIN;
  END IF;
END
$$;--> statement-breakpoint

GRANT USAGE ON SCHEMA public TO cumplia_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO cumplia_app;--> statement-breakpoint
-- Tablas que creen futuras migraciones (del mismo dueño) también quedan accesibles;
-- el test de RLS verifica que toda tabla con organization_id tenga su política.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO cumplia_app;--> statement-breakpoint
-- La auditoría es de solo agregar también a nivel de permisos (además del trigger).
REVOKE UPDATE, DELETE, TRUNCATE ON "audit_logs" FROM cumplia_app;--> statement-breakpoint

CREATE OR REPLACE FUNCTION app_current_organization() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.organization_id', true), '')::uuid
$$;--> statement-breakpoint

ALTER TABLE "assessments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "assessments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "assessments"
  USING ("organization_id" = app_current_organization())
  WITH CHECK ("organization_id" = app_current_organization());--> statement-breakpoint

ALTER TABLE "control_answers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "control_answers" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "control_answers"
  USING ("organization_id" = app_current_organization())
  WITH CHECK ("organization_id" = app_current_organization());--> statement-breakpoint

ALTER TABLE "evidence" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "evidence" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "evidence"
  USING ("organization_id" = app_current_organization())
  WITH CHECK ("organization_id" = app_current_organization());--> statement-breakpoint

ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "audit_logs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "audit_logs"
  USING ("organization_id" = app_current_organization())
  WITH CHECK ("organization_id" = app_current_organization());
