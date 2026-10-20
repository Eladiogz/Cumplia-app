CREATE TABLE "organization_deletions" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"deleted_by" uuid,
	"deleted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invitations" DROP CONSTRAINT "invitations_invited_by_users_id_fk";
--> statement-breakpoint
ALTER TABLE "invitations" DROP CONSTRAINT "invitations_accepted_by_users_id_fk";
--> statement-breakpoint
ALTER TABLE "memberships" DROP CONSTRAINT "memberships_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_accepted_by_users_id_fk" FOREIGN KEY ("accepted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

-- Constancia de organizaciones eliminadas: la API no la lee ni la escribe (solo la
-- función de abajo, como dueña). RLS igual que el resto, por regla general.
REVOKE ALL ON "organization_deletions" FROM cumplia_app;--> statement-breakpoint
ALTER TABLE "organization_deletions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "organization_deletions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "organization_deletions"
  USING ("organization_id" = app_current_organization())
  WITH CHECK ("organization_id" = app_current_organization());--> statement-breakpoint

-- La auditoría sigue siendo de solo agregar, con UNA excepción: eliminar la
-- organización completa (derecho de supresión, fin del servicio). Solo puede
-- hacerlo app_purge_organization: la API no tiene permiso DELETE sobre audit_logs.
CREATE OR REPLACE FUNCTION audit_logs_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('app.purging_organization', true) = OLD.organization_id::text THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'audit_logs es de solo agregar: % no permitido', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;--> statement-breakpoint

-- Borra TODOS los datos de una organización, auditoría incluida, y deja constancia.
-- Solo la organización fijada en la transacción (la de la sesión de quien la elimina):
-- un error en la API no puede borrar otra. Corre como dueña de las tablas.
-- Las cuentas que quedan sin ninguna organización también se borran: no pueden
-- volver a ingresar y no tiene sentido conservar sus datos. Devuelve sus ids.
CREATE OR REPLACE FUNCTION app_purge_organization(target uuid, actor uuid) RETURNS SETOF uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  former_members uuid[];
BEGIN
  IF target IS NULL OR target IS DISTINCT FROM app_current_organization() THEN
    RAISE EXCEPTION 'app_purge_organization: la organización no coincide con el contexto'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT coalesce(array_agg(user_id), '{}') INTO former_members FROM memberships WHERE organization_id = target;
  PERFORM set_config('app.purging_organization', target::text, true);
  DELETE FROM evidence WHERE organization_id = target;
  DELETE FROM control_answers WHERE organization_id = target;
  DELETE FROM assessments WHERE organization_id = target;
  DELETE FROM risks WHERE organization_id = target;
  DELETE FROM invitations WHERE organization_id = target;
  DELETE FROM mfa_challenges WHERE organization_id = target;
  DELETE FROM sessions WHERE organization_id = target;
  DELETE FROM memberships WHERE organization_id = target;
  DELETE FROM audit_logs WHERE organization_id = target;
  DELETE FROM organizations WHERE id = target;
  INSERT INTO organization_deletions (organization_id, deleted_by) VALUES (target, actor);
  PERFORM set_config('app.purging_organization', '', true);
  RETURN QUERY
    DELETE FROM users u
    WHERE u.id = ANY (former_members)
      AND NOT EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = u.id)
    RETURNING u.id;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION app_purge_organization(uuid, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_purge_organization(uuid, uuid) TO cumplia_app;