ALTER TABLE "sessions" ADD COLUMN "user_agent" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "ip_address" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "last_seen_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
-- Las sesiones ya abiertas no tienen actividad registrada: se toma su inicio (sessions no tiene RLS).
UPDATE "sessions" SET "last_seen_at" = "created_at";