import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

export const ITEM_KINDS = [
  "task",
  "reply",
  "assignment",
  "exam",
  "project",
  "reading",
  "chore",
  "event",
] as const;
export const ITEM_STATUSES = ["inbox", "todo", "doing", "blocked", "done", "dismissed"] as const;
export const ITEM_SOURCES = ["manual", "agent", "todoist", "gcal", "gmail", "moodle", "discord"] as const;

export const itemKind = pgEnum("item_kind", ITEM_KINDS);
export const itemStatus = pgEnum("item_status", ITEM_STATUSES);
export const itemSource = pgEnum("item_source", ITEM_SOURCES);

// Every table enables RLS with no policies: Supabase's public REST API (anon key) gets nothing.
// The server connects as the postgres role, which bypasses RLS.
const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

export const courses = pgTable("courses", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  code: text("code"),
  color: text("color"),
  moodleCourseId: integer("moodle_course_id"),
  archived: boolean("archived").notNull().default(false),
  ...timestamps,
}).enableRLS();

export const items = pgTable(
  "items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    notes: text("notes"),
    kind: itemKind("kind").notNull().default("task"),
    status: itemStatus("status").notNull().default("todo"),
    courseId: uuid("course_id").references(() => courses.id, { onDelete: "set null" }),
    parentId: uuid("parent_id").references((): AnyPgColumn => items.id, { onDelete: "cascade" }),
    dueAt: timestamp("due_at", { withTimezone: true }),
    /** Due on a date with no specific time (Todoist date-only tasks, Moodle all-day). */
    dueAllDay: boolean("due_all_day").notNull().default(false),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
    estMinutes: integer("est_minutes"),
    /** 1 (low) – 4 (urgent); same scale as Todoist so sync is 1:1. */
    priority: integer("priority").notNull().default(1),
    progressPct: integer("progress_pct").notNull().default(0),
    nextStep: text("next_step"),
    source: itemSource("source").notNull().default("manual"),
    /** Stable id in the source system; (source, source_ref) is unique so collectors upsert. */
    sourceRef: text("source_ref"),
    sourceUrl: text("source_url"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("items_source_ref_uq").on(t.source, t.sourceRef),
    index("items_status_due_idx").on(t.status, t.dueAt),
    index("items_parent_idx").on(t.parentId),
    check("items_priority_ck", sql`${t.priority} between 1 and 4`),
    check("items_progress_ck", sql`${t.progressPct} between 0 and 100`),
  ],
).enableRLS();

export const activity = pgTable(
  "activity",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    /** "user", a collector name, or an agent's self-chosen name (e.g. "thesis-agent"). */
    actor: text("actor").notNull(),
    message: text("message").notNull(),
    progressPct: integer("progress_pct"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("activity_item_idx").on(t.itemId, t.createdAt)],
).enableRLS();

export const syncState = pgTable("sync_state", {
  source: itemSource("source").primaryKey(),
  cursor: text("cursor"),
  lastRunAt: timestamp("last_run_at", { withTimezone: true }),
  lastError: text("last_error"),
  meta: jsonb("meta").$type<Record<string, unknown>>(),
}).enableRLS();

export type Item = typeof items.$inferSelect;
export type NewItem = typeof items.$inferInsert;
export type Course = typeof courses.$inferSelect;
export type Activity = typeof activity.$inferSelect;
export type ItemKind = (typeof ITEM_KINDS)[number];
export type ItemStatus = (typeof ITEM_STATUSES)[number];
export type ItemSource = (typeof ITEM_SOURCES)[number];
