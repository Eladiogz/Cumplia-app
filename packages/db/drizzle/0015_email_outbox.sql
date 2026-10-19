CREATE TABLE "email_outbox" (
	"id" uuid PRIMARY KEY NOT NULL,
	"payload" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_until" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"failed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "email_outbox_due_idx" ON "email_outbox" USING btree ("next_attempt_at");--> statement-breakpoint
-- Tabla del sistema (sin organization_id, como sessions): la usa solo la API. El contenido va cifrado.
GRANT SELECT, INSERT, UPDATE, DELETE ON "email_outbox" TO cumplia_app;