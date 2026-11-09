import { z } from "zod";
import { ITEM_KINDS, ITEM_SOURCES, ITEM_STATUSES } from "./schema.js";

const isoDate = z.iso.datetime({ offset: true }).or(z.iso.date());

export const itemCreateSchema = z.object({
  title: z.string().trim().min(1).max(500),
  notes: z.string().max(20_000).optional(),
  kind: z.enum(ITEM_KINDS).optional(),
  status: z.enum(ITEM_STATUSES).optional(),
  courseId: z.uuid().optional(),
  parentId: z.uuid().optional(),
  /** ISO datetime, or a bare YYYY-MM-DD date (stored as all-day). */
  due: isoDate.optional(),
  scheduledAt: z.iso.datetime({ offset: true }).optional(),
  estMinutes: z.number().int().min(1).max(10_000).optional(),
  priority: z.number().int().min(1).max(4).optional(),
  nextStep: z.string().max(1000).optional(),
  source: z.enum(ITEM_SOURCES).optional(),
  sourceRef: z.string().max(500).optional(),
  sourceUrl: z.url().optional(),
});
export type ItemCreate = z.infer<typeof itemCreateSchema>;

export const itemUpdateSchema = itemCreateSchema
  .omit({ source: true, sourceRef: true })
  .partial()
  .extend({
    progressPct: z.number().int().min(0).max(100).optional(),
    /** Pass null to clear these. */
    due: isoDate.nullable().optional(),
    courseId: z.uuid().nullable().optional(),
    nextStep: z.string().max(1000).nullable().optional(),
  });
export type ItemUpdate = z.infer<typeof itemUpdateSchema>;

export const itemFilterSchema = z.object({
  status: z.array(z.enum(ITEM_STATUSES)).optional(),
  kind: z.array(z.enum(ITEM_KINDS)).optional(),
  courseId: z.uuid().optional(),
  parentId: z.uuid().nullable().optional(),
  /** Only items due on/before this ISO datetime. */
  dueBefore: z.iso.datetime({ offset: true }).optional(),
  search: z.string().max(200).optional(),
  includeDone: z.boolean().optional(),
  limit: z.number().int().min(1).max(500).optional(),
});
export type ItemFilter = z.infer<typeof itemFilterSchema>;

export const progressReportSchema = z.object({
  itemId: z.uuid(),
  actor: z.string().trim().min(1).max(100),
  message: z.string().trim().min(1).max(5000),
  progressPct: z.number().int().min(0).max(100).optional(),
  nextStep: z.string().max(1000).optional(),
  status: z.enum(["todo", "doing", "blocked", "done"]).optional(),
});
export type ProgressReport = z.infer<typeof progressReportSchema>;

/** Converts the API's `due` field to stored columns. Bare dates become all-day at 23:59 in `tz`. */
export function parseDue(due: string | null | undefined, tz: string): { dueAt: Date | null; dueAllDay: boolean } | undefined {
  if (due === undefined) return undefined;
  if (due === null) return { dueAt: null, dueAllDay: false };
  if (/^\d{4}-\d{2}-\d{2}$/.test(due)) return { dueAt: endOfLocalDay(due, tz), dueAllDay: true };
  return { dueAt: new Date(due), dueAllDay: false };
}

/** 23:59:59 on the given calendar date in the given IANA timezone, as a UTC Date. */
export function endOfLocalDay(date: string, tz: string): Date {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const guess = Date.UTC(y, m - 1, d, 23, 59, 59);
  return new Date(guess - tzOffsetMs(new Date(guess), tz));
}

/** Offset of `tz` from UTC at instant `at`, in ms (positive east of UTC). */
export function tzOffsetMs(at: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}
