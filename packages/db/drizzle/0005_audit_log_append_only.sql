-- El registro de auditoría es de solo agregar (ISO/IEC 27001 A.8.15): la base rechaza
-- modificar o borrar entradas, aunque el pedido venga de un bug o de un acceso indebido.
CREATE OR REPLACE FUNCTION audit_logs_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs es de solo agregar: % no permitido', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;--> statement-breakpoint
CREATE TRIGGER audit_logs_no_update_delete
  BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION audit_logs_append_only();--> statement-breakpoint
CREATE TRIGGER audit_logs_no_truncate
  BEFORE TRUNCATE ON "audit_logs"
  FOR EACH STATEMENT EXECUTE FUNCTION audit_logs_append_only();
