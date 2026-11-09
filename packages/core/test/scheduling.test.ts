import { describe, expect, it } from "vitest";
import { bucketFor, groupByBucket, urgencyScore } from "../src/scheduling.js";
import { endOfLocalDay, parseDue } from "../src/validation.js";

const TZ = "America/New_York";
// 2026-11-09 10:00 New York (EST, UTC-5)
const now = new Date("2026-11-09T15:00:00Z");
const base = { dueAllDay: false, status: "todo", priority: 1, progressPct: 0, kind: "task" } as const;
const at = (iso: string, extra = {}) => ({ ...base, dueAt: new Date(iso), ...extra });

describe("endOfLocalDay / parseDue", () => {
  it("maps a bare date to 23:59:59 local time", () => {
    expect(endOfLocalDay("2026-11-09", TZ).toISOString()).toBe("2026-11-10T04:59:59.000Z");
    expect(endOfLocalDay("2026-07-01", TZ).toISOString()).toBe("2026-07-02T03:59:59.000Z"); // EDT
  });
  it("marks bare dates all-day and keeps datetimes exact", () => {
    expect(parseDue("2026-11-09", TZ)?.dueAllDay).toBe(true);
    expect(parseDue("2026-11-09T12:00:00-05:00", TZ)).toEqual({ dueAt: new Date("2026-11-09T17:00:00Z"), dueAllDay: false });
    expect(parseDue(null, TZ)).toEqual({ dueAt: null, dueAllDay: false });
    expect(parseDue(undefined, TZ)).toBeUndefined();
  });
});

describe("bucketFor", () => {
  it("buckets by local calendar day", () => {
    expect(bucketFor({ ...base, dueAt: null }, now, TZ)).toBe("no_date");
    expect(bucketFor(at("2026-11-09T14:00:00Z"), now, TZ)).toBe("overdue"); // 9am today, past
    expect(bucketFor(at("2026-11-10T04:00:00Z"), now, TZ)).toBe("today"); // 11pm local, still today
    expect(bucketFor(at("2026-11-10T06:00:00Z"), now, TZ)).toBe("tomorrow"); // 1am local next day
    expect(bucketFor(at("2026-11-14T15:00:00Z"), now, TZ)).toBe("this_week");
    expect(bucketFor(at("2026-11-30T15:00:00Z"), now, TZ)).toBe("later");
  });
  it("keeps all-day items due today out of overdue", () => {
    expect(bucketFor({ ...base, dueAt: endOfLocalDay("2026-11-09", TZ), dueAllDay: true }, now, TZ)).toBe("today");
    expect(bucketFor({ ...base, dueAt: endOfLocalDay("2026-11-08", TZ), dueAllDay: true }, now, TZ)).toBe("overdue");
  });
});

describe("urgencyScore", () => {
  it("ranks a half-done assignment due tomorrow above a low chore due next week", () => {
    const essay = at("2026-11-10T15:00:00Z", { kind: "assignment", progressPct: 50, priority: 3 });
    const chore = at("2026-11-16T15:00:00Z", { kind: "chore" });
    expect(urgencyScore(essay, now)).toBeGreaterThan(urgencyScore(chore, now));
  });
  it("puts overdue above everything due later and penalises blocked", () => {
    expect(urgencyScore(at("2026-11-08T15:00:00Z"), now)).toBeGreaterThan(urgencyScore(at("2026-11-09T16:00:00Z", { priority: 4 }), now));
    expect(urgencyScore(at("2026-11-10T15:00:00Z", { status: "blocked" }), now)).toBeLessThan(urgencyScore(at("2026-11-10T15:00:00Z"), now));
  });
  it("sorts each bucket by urgency", () => {
    const g = groupByBucket([at("2026-11-09T20:00:00Z"), at("2026-11-09T20:00:00Z", { priority: 4 })], now, TZ);
    expect(g.today.map((i) => i.priority)).toEqual([4, 1]);
  });
});
