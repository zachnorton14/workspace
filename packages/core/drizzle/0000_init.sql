CREATE TYPE "public"."item_kind" AS ENUM('task', 'reply', 'assignment', 'exam', 'project', 'reading', 'chore', 'event');--> statement-breakpoint
CREATE TYPE "public"."item_source" AS ENUM('manual', 'agent', 'todoist', 'gcal', 'gmail', 'moodle', 'discord');--> statement-breakpoint
CREATE TYPE "public"."item_status" AS ENUM('inbox', 'todo', 'doing', 'blocked', 'done', 'dismissed');--> statement-breakpoint
CREATE TABLE "activity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"actor" text NOT NULL,
	"message" text NOT NULL,
	"progress_pct" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "activity" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "courses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"code" text,
	"color" text,
	"moodle_course_id" integer,
	"archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "courses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"notes" text,
	"kind" "item_kind" DEFAULT 'task' NOT NULL,
	"status" "item_status" DEFAULT 'todo' NOT NULL,
	"course_id" uuid,
	"parent_id" uuid,
	"due_at" timestamp with time zone,
	"due_all_day" boolean DEFAULT false NOT NULL,
	"scheduled_at" timestamp with time zone,
	"est_minutes" integer,
	"priority" integer DEFAULT 1 NOT NULL,
	"progress_pct" integer DEFAULT 0 NOT NULL,
	"next_step" text,
	"source" "item_source" DEFAULT 'manual' NOT NULL,
	"source_ref" text,
	"source_url" text,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "items_priority_ck" CHECK ("items"."priority" between 1 and 4),
	CONSTRAINT "items_progress_ck" CHECK ("items"."progress_pct" between 0 and 100)
);
--> statement-breakpoint
ALTER TABLE "items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sync_state" (
	"source" "item_source" PRIMARY KEY NOT NULL,
	"cursor" text,
	"last_run_at" timestamp with time zone,
	"last_error" text,
	"meta" jsonb
);
--> statement-breakpoint
ALTER TABLE "sync_state" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "activity" ADD CONSTRAINT "activity_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_parent_id_items_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_item_idx" ON "activity" USING btree ("item_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "items_source_ref_uq" ON "items" USING btree ("source","source_ref");--> statement-breakpoint
CREATE INDEX "items_status_due_idx" ON "items" USING btree ("status","due_at");--> statement-breakpoint
CREATE INDEX "items_parent_idx" ON "items" USING btree ("parent_id");