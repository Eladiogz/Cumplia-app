CREATE TYPE "public"."risk_status" AS ENUM('identified', 'in_treatment', 'accepted', 'closed');--> statement-breakpoint
CREATE TYPE "public"."risk_treatment" AS ENUM('mitigate', 'accept', 'transfer', 'avoid');--> statement-breakpoint
CREATE TABLE "risks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"asset" text,
	"threat" text,
	"likelihood" integer NOT NULL,
	"impact" integer NOT NULL,
	"treatment" "risk_treatment" DEFAULT 'mitigate' NOT NULL,
	"treatment_plan" text,
	"control_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"residual_likelihood" integer,
	"residual_impact" integer,
	"status" "risk_status" DEFAULT 'identified' NOT NULL,
	"owner_id" uuid,
	"due_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "risks_org_number_uq" UNIQUE("organization_id","number"),
	CONSTRAINT "risks_title_length" CHECK (char_length("risks"."title") between 1 and 200),
	CONSTRAINT "risks_likelihood_range" CHECK ("risks"."likelihood" between 1 and 5),
	CONSTRAINT "risks_impact_range" CHECK ("risks"."impact" between 1 and 5),
	CONSTRAINT "risks_residual_pair" CHECK (("risks"."residual_likelihood" is null) = ("risks"."residual_impact" is null)
          and ("risks"."residual_likelihood" is null or "risks"."residual_likelihood" between 1 and 5)
          and ("risks"."residual_impact" is null or "risks"."residual_impact" between 1 and 5))
);
--> statement-breakpoint
ALTER TABLE "risks" ADD CONSTRAINT "risks_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "risks_org_idx" ON "risks" USING btree ("organization_id");--> statement-breakpoint
-- El responsable debe ser MIEMBRO de la misma organización. Si deja de serlo,
-- el riesgo queda sin responsable (solo se anula owner_id, nunca organization_id).
-- Drizzle no sabe expresar SET NULL por columna (PostgreSQL 15+), por eso va a mano.
ALTER TABLE "risks" ADD CONSTRAINT "risks_owner_membership_fk" FOREIGN KEY ("owner_id","organization_id") REFERENCES "public"."memberships"("user_id","organization_id") ON DELETE SET NULL ("owner_id");--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "risks" TO cumplia_app;--> statement-breakpoint
ALTER TABLE "risks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "risks" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "risks"
  USING ("organization_id" = app_current_organization())
  WITH CHECK ("organization_id" = app_current_organization());