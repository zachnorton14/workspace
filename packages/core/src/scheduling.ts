import type { Item } from "./schema.js";
import { tzOffsetMs } from "./validation.js";

export const BUCKETS = ["overdue", "today", "tomorrow", "this_week", "later", "no_date"] as const;
export type Bucket = (typeof BUCKETS)[number];

/** Local calendar day number (days since epoch in `tz`) — lets us compare "same day" across timezones. */
function localDay(at: Date, tz: string): number {
  return Math.floor((at.getTime() + tzOffsetMs(at, tz)) / 86_400_000);
}

type Schedulable = Pick<Item, "dueAt" | "dueAllDay" | "status" | "priority" | "progressPct" | "kind">;

export function bucketFor(item: Schedulable, now: Date, tz: string): Bucket {
  if (!item.dueAt) return "no_date";
  const due = item.dueAt;
  const dayDiff = localDay(due, tz) - localDay(now, tz);
  // A timed item is overdue the moment it passes; an all-day item only once its day is over.
  if (item.dueAllDay ? dayDiff < 0 : due.getTime() < now.getTime()) return "overdue";
  if (dayDiff <= 0) return "today";
  if (dayDiff === 1) return "tomorrow";
  if (dayDiff <= 7) return "this_week";
  return "later";
}

/**
 * Higher = do sooner. Mixes deadline proximity, priority, and remaining work, so a
 * half-finished essay due tomorrow ranks above an untouched low-priority chore due today.
 */
export function urgencyScore(item: Schedulable, now: Date): number {
  let score = item.priority * 10;
  if (item.dueAt) {
    const hours = (item.dueAt.getTime() - now.getTime()) / 3_600_000;
    if (hours < 0) score += 100 + Math.min(50, -hours); // overdue: grows with lateness, capped
    else score += 80 * Math.exp(-hours / 48); // ~halves every 33h
  }
  if (item.kind === "exam" || item.kind === "assignment") score += 10;
  if (item.status === "doing") score += 5;
  if (item.status === "blocked") score -= 15;
  score += (100 - item.progressPct) / 10; // remaining work
  return Math.round(score * 10) / 10;
}

export function groupByBucket<T extends Schedulable>(list: T[], now: Date, tz: string): Record<Bucket, T[]> {
  const out = Object.fromEntries(BUCKETS.map((b) => [b, [] as T[]])) as Record<Bucket, T[]>;
  for (const it of list) out[bucketFor(it, now, tz)].push(it);
  for (const b of BUCKETS) out[b].sort((a, c) => urgencyScore(c, now) - urgencyScore(a, now));
  return out;
}
