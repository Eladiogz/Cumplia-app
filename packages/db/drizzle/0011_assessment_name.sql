ALTER TABLE "assessments" ADD COLUMN "name" text DEFAULT 'Evaluación ISO/IEC 27001:2022' NOT NULL;--> statement-breakpoint
ALTER TABLE "assessments" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_name_length" CHECK (char_length("assessments"."name") between 1 and 120);