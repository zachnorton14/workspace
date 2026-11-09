import type { ItemKind } from "./schema.js";
import { tzOffsetMs } from "./validation.js";

/**
 * Todoist-style one-line quick add:
 *   "Lab report fri 5pm #chem p2 @hw ~2h"
 *   → { title: "Lab report", due: <Fri 17:00 local>, courseHint: "chem", priority: 3, kind: "assignment", estMinutes: 120 }
 *
 * Tokens may appear anywhere. Date/time words only match as whole words, so "Monday's notes" stays in the title.
 */
export interface QuickAdd {
  title: string;
  /** YYYY-MM-DD (all-day) or ISO datetime (UTC). */
  due?: string;
  /** 1 (low) – 4 (urgent). Todoist's p1 is the most urgent, so p1 → 4. */
  priority?: number;
  kind?: ItemKind;
  /** Text after #, to match against course code/name. */
  courseHint?: string;
  estMinutes?: number;
}

const KIND_ALIASES: Record<string, ItemKind> = {
  task: "task", todo: "task",
  reply: "reply", respond: "reply", email: "reply", msg: "reply",
  hw: "assignment", homework: "assignment", assignment: "assignment", assign: "assignment", lab: "assignment",
  exam: "exam", test: "exam", quiz: "exam", midterm: "exam", final: "exam",
  project: "project", proj: "project", research: "project",
  reading: "reading", read: "reading",
  chore: "chore", errand: "chore",
  event: "event", meeting: "event",
};

const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

// Whole-word boundaries that don't treat apostrophes as word breaks ("monday's" ≠ "monday").
const B = String.raw`(?<=^|\s)`;
const E = String.raw`(?=\s|$|[,.;])`;
const LEAD = String.raw`(?:(?:due|by|on|at)\s+)?`;

type Ymd = { y: number; m: number; d: number };

function localYmd(at: Date, tz: string): Ymd {
  const local = new Date(at.getTime() + tzOffsetMs(at, tz));
  return { y: local.getUTCFullYear(), m: local.getUTCMonth() + 1, d: local.getUTCDate() };
}
function addDays({ y, m, d }: Ymd, n: number): Ymd {
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}
function weekday({ y, m, d }: Ymd): number {
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}
const ymdStr = ({ y, m, d }: Ymd) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const cmp = (a: Ymd, b: Ymd) => Date.UTC(a.y, a.m - 1, a.d) - Date.UTC(b.y, b.m - 1, b.d);

/** Local wall-clock time on a date → UTC instant (offset looked up at that instant, so DST is right). */
function zoned(day: Ymd, h: number, min: number, tz: string): Date {
  const guess = Date.UTC(day.y, day.m - 1, day.d, h, min);
  const first = guess - tzOffsetMs(new Date(guess), tz);
  return new Date(guess - tzOffsetMs(new Date(first), tz));
}

/** Month/day with no year → the next occurrence (today counts). */
function nextMonthDay(m: number, d: number, today: Ymd): Ymd | undefined {
  if (m < 1 || m > 12 || d < 1 || d > 31) return undefined;
  const thisYear = { y: today.y, m, d };
  return cmp(thisYear, today) >= 0 ? thisYear : { y: today.y + 1, m, d };
}

export function parseQuickAdd(input: string, now: Date, tz: string): QuickAdd {
  let s = ` ${input.trim()} `;
  const out: Omit<QuickAdd, "title"> = {};
  const take = (re: RegExp, fn: (m: RegExpMatchArray) => boolean | void) => {
    const m = s.match(re);
    if (m && fn(m) !== false) s = s.slice(0, m.index) + " " + s.slice(m.index! + m[0].length);
  };

  take(new RegExp(`${B}p([1-4])${E}`, "i"), (m) => { out.priority = 5 - Number(m[1]); });
  take(new RegExp(`${B}#([\\w-]+)`), (m) => { out.courseHint = m[1]!.toLowerCase(); });
  take(new RegExp(`${B}@(\\w+)${E}`), (m) => {
    const k = KIND_ALIASES[m[1]!.toLowerCase()];
    if (!k) return false;
    out.kind = k;
  });
  take(new RegExp(`${B}~(\\d+(?:\\.\\d+)?)\\s*(h|hr|hrs|m|min|mins)${E}`, "i"), (m) => {
    out.estMinutes = Math.round(Number(m[1]) * (m[2]!.toLowerCase().startsWith("h") ? 60 : 1));
  });

  // Time first, so "fri 5pm" leaves "fri" for the date pass.
  let time: { h: number; min: number } | undefined;
  take(new RegExp(`${B}(?:at\\s+)?(noon|midnight|(\\d{1,2})(?::(\\d{2}))?\\s*(am|pm)|([01]?\\d|2[0-3]):(\\d{2}))${E}`, "i"), (m) => {
    const word = m[1]!.toLowerCase();
    if (word === "noon") time = { h: 12, min: 0 };
    else if (word === "midnight") time = { h: 23, min: 59 };
    else if (m[4]) {
      let h = Number(m[2]);
      if (h < 1 || h > 12) return false;
      if (m[4].toLowerCase() === "pm" && h !== 12) h += 12;
      if (m[4].toLowerCase() === "am" && h === 12) h = 0;
      time = { h, min: Number(m[3] ?? 0) };
    } else time = { h: Number(m[5]), min: Number(m[6]) };
  });

  const today = localYmd(now, tz);
  let day: Ymd | undefined;
  const dateRules: [RegExp, (m: RegExpMatchArray) => Ymd | undefined][] = [
    [/(\d{4})-(\d{2})-(\d{2})/, (m) => ({ y: +m[1]!, m: +m[2]!, d: +m[3]! })],
    [/(?:today|tod|tonight)/i, () => today],
    [/(?:tomorrow|tmr|tmrw)/i, () => addDays(today, 1)],
    [/next\s+week/i, () => addDays(today, ((8 - weekday(today)) % 7) || 7)], // next Monday
    [/in\s+(\d+)\s+(days?|weeks?)/i, (m) => addDays(today, +m[1]! * (m[2]!.toLowerCase().startsWith("w") ? 7 : 1))],
    [/(?:next\s+)?(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)(?:day|nesday|sday|urday)?/i, (m) => {
      const target = WEEKDAYS.indexOf(m[1]!.slice(0, 3).toLowerCase());
      const diff = (target - weekday(today) + 7) % 7; // "fri" on a Friday = today, like Todoist
      // "next fri" = the first Friday strictly after today.
      return addDays(today, /^next/i.test(m[0]) && diff === 0 ? 7 : diff);
    }],
    [/(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?/i,
      (m) => nextMonthDay(MONTHS.indexOf(m[1]!.slice(0, 3).toLowerCase()) + 1, +m[2]!, today)],
    [/(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*/i,
      (m) => nextMonthDay(MONTHS.indexOf(m[2]!.slice(0, 3).toLowerCase()) + 1, +m[1]!, today)],
    [/(\d{1,2})\/(\d{1,2})/, (m) => nextMonthDay(+m[1]!, +m[2]!, today)], // US m/d
  ];
  for (const [re, fn] of dateRules) {
    let hit = false;
    take(new RegExp(`${B}${LEAD}(?:${re.source})${E}`, re.flags), (m) => {
      // Re-run the inner pattern alone so capture groups line up with the rule.
      const inner = m[0].replace(/^(?:due|by|on|at)\s+/i, "").match(new RegExp(`^${re.source}$`, re.flags));
      const d = inner && fn(inner);
      if (!d) return false;
      day = d;
      hit = true;
    });
    if (hit) break;
  }

  if (time) {
    // A bare time means today, or tomorrow if that time already passed.
    let d = day ?? today;
    let at = zoned(d, time.h, time.min, tz);
    if (!day && at.getTime() <= now.getTime()) at = zoned((d = addDays(today, 1)), time.h, time.min, tz);
    out.due = at.toISOString();
  } else if (day) out.due = ymdStr(day);

  const title = s.replace(/\s+/g, " ").trim().replace(/[\s,;]+$/, "");
  return { title: title || input.trim(), ...out };
}

/** Pick the course a "#hint" refers to: exact code, then code/name prefix, then name substring. */
export function matchCourse<C extends { id: string; name: string; code: string | null }>(hint: string, list: C[]): C | undefined {
  const norm = (v: string) => v.toLowerCase().replace(/[\s_-]+/g, "");
  const h = norm(hint);
  return (
    list.find((c) => c.code && norm(c.code) === h) ??
    list.find((c) => (c.code && norm(c.code).startsWith(h)) || norm(c.name).startsWith(h)) ??
    list.find((c) => norm(c.name).includes(h))
  );
}
