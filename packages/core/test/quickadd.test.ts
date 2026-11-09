import { describe, expect, it } from "vitest";
import { matchCourse, parseQuickAdd } from "../src/quickadd.js";

const TZ = "America/New_York";
// Monday 2026-11-09, 10:00 New York (EST)
const now = new Date("2026-11-09T15:00:00Z");
const q = (s: string) => parseQuickAdd(s, now, TZ);

describe("parseQuickAdd", () => {
  it("parses the full Todoist-style line", () => {
    expect(q("Lab report fri 5pm #chem p2 @hw ~2h")).toEqual({
      title: "Lab report",
      due: "2026-11-13T22:00:00.000Z",
      courseHint: "chem",
      priority: 3,
      kind: "assignment",
      estMinutes: 120,
    });
  });

  it("handles relative dates as all-day", () => {
    expect(q("Pay rent today").due).toBe("2026-11-09");
    expect(q("Email TA tmr").due).toBe("2026-11-10");
    expect(q("Essay due tomorrow").due).toBe("2026-11-10");
    expect(q("Study next week").due).toBe("2026-11-16");
    expect(q("Return books in 3 days").due).toBe("2026-11-12");
    expect(q("Thing in 2 weeks").due).toBe("2026-11-23");
  });

  it("weekday names: today counts, 'next' skips today", () => {
    expect(q("Gym monday").due).toBe("2026-11-09");
    expect(q("Gym next mon").due).toBe("2026-11-16");
    expect(q("Quiz wed").due).toBe("2026-11-11");
    expect(q("Quiz Sunday").due).toBe("2026-11-15");
  });

  it("parses month/day forms and rolls to next year when passed", () => {
    expect(q("Final paper nov 20").due).toBe("2026-11-20");
    expect(q("Final paper 20 Nov").due).toBe("2026-11-20");
    expect(q("Final paper December 3rd").due).toBe("2026-12-03");
    expect(q("Register 1/15").due).toBe("2027-01-15");
    expect(q("Thing 2026-12-01").due).toBe("2026-12-01");
  });

  it("parses times; a bare past time rolls to tomorrow", () => {
    expect(q("Call mom 5:30pm").due).toBe("2026-11-09T22:30:00.000Z");
    expect(q("Standup 9am").due).toBe("2026-11-10T14:00:00.000Z"); // 9am already passed
    expect(q("Office hours wed at 14:00").due).toBe("2026-11-11T19:00:00.000Z");
    expect(q("Lunch tmr noon").due).toBe("2026-11-10T17:00:00.000Z");
  });

  it("handles DST: offsets follow the target date, not today", () => {
    expect(q("Midterm mar 10 9am").due).toBe("2027-03-10T14:00:00.000Z"); // still EST (DST starts Mar 14 2027)
    expect(q("Midterm mar 20 9am").due).toBe("2027-03-20T13:00:00.000Z"); // EDT
  });

  it("keeps words that only look like tokens", () => {
    expect(q("Reply to Tom").due).toBeUndefined();
    expect(q("Review Monday's notes")).toEqual({ title: "Review Monday's notes" });
    expect(q("Ask about May").due).toBeUndefined();
    expect(q("Email @someone about p5")).toEqual({ title: "Email @someone about p5" });
    expect(q("Read pages 10/40")).toEqual({ title: "Read pages 10/40" }); // not a valid m/d
  });

  it("strips 'due/by/on' and never returns an empty title", () => {
    expect(q("Problem set 4 due fri").title).toBe("Problem set 4");
    expect(q("Essay by nov 20").title).toBe("Essay");
    expect(q("tomorrow").title).toBe("tomorrow");
  });
});

describe("matchCourse", () => {
  const courses = [
    { id: "1", name: "Organic Chemistry", code: "CHEM 241" },
    { id: "2", name: "Linear Algebra", code: "MATH 221" },
    { id: "3", name: "Chemistry Lab", code: "CHEM 241L" },
  ];
  it("prefers exact code, then prefix, then substring", () => {
    expect(matchCourse("chem241", courses)?.id).toBe("1");
    expect(matchCourse("chem241l", courses)?.id).toBe("3");
    expect(matchCourse("math", courses)?.id).toBe("2");
    expect(matchCourse("linear", courses)?.id).toBe("2");
    expect(matchCourse("algebra", courses)?.id).toBe("2");
    expect(matchCourse("bio", courses)).toBeUndefined();
  });
});
