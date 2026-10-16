-- Destinos de las FK compuestas: deben existir antes que las FK que los usan.
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_id_org_uq" UNIQUE("id","organization_id");--> statement-breakpoint
ALTER TABLE "control_answers" ADD CONSTRAINT "control_answers_id_org_uq" UNIQUE("id","organization_id");--> statement-breakpoint
-- Sesiones y desafíos de usuarios que ya no son miembros: no sirven y bloquearían la FK nueva.
DELETE FROM "sessions" s WHERE NOT EXISTS (
  SELECT 1 FROM "memberships" m WHERE m."user_id" = s."user_id" AND m."organization_id" = s."organization_id"
);--> statement-breakpoint
DELETE FROM "mfa_challenges" c WHERE NOT EXISTS (
  SELECT 1 FROM "memberships" m WHERE m."user_id" = c."user_id" AND m."organization_id" = c."organization_id"
);--> statement-breakpoint
ALTER TABLE "control_answers" DROP CONSTRAINT "control_answers_assessment_id_assessments_id_fk";--> statement-breakpoint
ALTER TABLE "evidence" DROP CONSTRAINT "evidence_control_answer_id_control_answers_id_fk";--> statement-breakpoint
ALTER TABLE "control_answers" ADD CONSTRAINT "control_answers_assessment_org_fk" FOREIGN KEY ("assessment_id","organization_id") REFERENCES "public"."assessments"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_control_answer_org_fk" FOREIGN KEY ("control_answer_id","organization_id") REFERENCES "public"."control_answers"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mfa_challenges" ADD CONSTRAINT "mfa_challenges_membership_fk" FOREIGN KEY ("user_id","organization_id") REFERENCES "public"."memberships"("user_id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_membership_fk" FOREIGN KEY ("user_id","organization_id") REFERENCES "public"."memberships"("user_id","organization_id") ON DELETE cascade ON UPDATE no action;
