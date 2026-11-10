CREATE TYPE "public"."action_status" AS ENUM('applied', 'proposed', 'undone', 'rejected', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."action_type" AS ENUM('create_task', 'update_task', 'create_event', 'draft_reply', 'add_note', 'ignore');--> statement-breakpoint
CREATE TYPE "public"."capture_source" AS ENUM('discord_dm', 'discord_channel', 'manual', 'agent', 'email');--> statement-breakpoint
CREATE TYPE "public"."capture_status" AS ENUM('pending', 'processing', 'done', 'failed');--> statement-breakpoint
CREATE TABLE "agent_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"capture_id" uuid NOT NULL,
	"type" "action_type" NOT NULL,
	"status" "action_status" NOT NULL,
	"confidence" text NOT NULL,
	"rationale" text NOT NULL,
	"item_id" uuid,
	"payload" jsonb NOT NULL,
	"before" jsonb,
	"activity_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "agent_actions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "captures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" "capture_source" NOT NULL,
	"external_ref" text,
	"author" text,
	"context" text,
	"text" text NOT NULL,
	"url" text,
	"status" "capture_status" DEFAULT 'pending' NOT NULL,
	"summary" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "captures" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "ends_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "location" text;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "reply_draft" text;--> statement-breakpoint
ALTER TABLE "agent_actions" ADD CONSTRAINT "agent_actions_capture_id_captures_id_fk" FOREIGN KEY ("capture_id") REFERENCES "public"."captures"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_actions" ADD CONSTRAINT "agent_actions_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_actions_status_idx" ON "agent_actions" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "agent_actions_capture_idx" ON "agent_actions" USING btree ("capture_id");--> statement-breakpoint
CREATE UNIQUE INDEX "captures_source_ref_uq" ON "captures" USING btree ("source","external_ref");--> statement-breakpoint
CREATE INDEX "captures_status_idx" ON "captures" USING btree ("status","created_at");