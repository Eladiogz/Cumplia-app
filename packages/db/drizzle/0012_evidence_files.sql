ALTER TABLE "evidence" ADD COLUMN "file_key" text;--> statement-breakpoint
ALTER TABLE "evidence" ADD COLUMN "file_name" text;--> statement-breakpoint
ALTER TABLE "evidence" ADD COLUMN "file_size" integer;--> statement-breakpoint
ALTER TABLE "evidence" ADD COLUMN "content_type" text;--> statement-breakpoint
ALTER TABLE "evidence" ADD COLUMN "sha256" text;