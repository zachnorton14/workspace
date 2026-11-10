import { beforeEach, describe, expect, it } from "vitest";
import {
  completeItem, createCourse, quickAddItem, createItem, getItem, listItems, NotFoundError,
  reportProgress, todaySummary, updateItem, upsertFromSource, type Ctx, type WorkspaceDb,
} from "../src/service.js";
import { testDb } from "./db.js";

const TZ = "America/New_York";
const now = new Date("2026-11-09T15:00:00Z");
let db: WorkspaceDb;
let ctx: Ctx;

beforeEach(async () => {
  db = await testDb();
  ctx = { db, tz: TZ, actor: "user", now };
});

describe("items", () => {
  it("creates, lists, filters and searches", async () => {
    const course = await createCourse(db, { name: "Organic Chemistry", code: "CHEM 241" });
    await createItem(ctx, { title: "Lab report 4", kind: "assignment", courseId: course.id, due: "2026-11-12" });
    await createItem(ctx, { title: "Reply to Prof. Lee", kind: "reply" });
    expect(await listItems(db)).toHaveLength(2);
    expect(await listItems(db, { kind: ["reply"] })).toHaveLength(1);
    expect(await listItems(db, { courseId: course.id })).toHaveLength(1);
    expect((await listItems(db, { search: "lab" }))[0]?.title).toBe("Lab report 4");
    expect(await listItems(db, { search: "100%_" })).toHaveLength(0); // wildcards escaped
  });

  it("stamps completion, hides done by default, and un-stamps on reopen", async () => {
    const it1 = await createItem(ctx, { title: "Read ch. 5" });
    const done = await completeItem(ctx, it1.id);
    expect(done.completedAt).toEqual(now);
    expect(done.progressPct).toBe(100);
    expect(await listItems(db)).toHaveLength(0);
    expect(await listItems(db, { includeDone: true })).toHaveLength(1);
    const reopened = await updateItem(ctx, it1.id, { status: "todo" });
    expect(reopened.completedAt).toBeNull();
  });

  it("clears fields with null and rejects bad input", async () => {
    const it1 = await createItem(ctx, { title: "x", due: "2026-11-12", nextStep: "start" });
    const cleared = await updateItem(ctx, it1.id, { due: null, nextStep: null });
    expect(cleared.dueAt).toBeNull();
    expect(cleared.nextStep).toBeNull();
    await expect(createItem(ctx, { title: "" })).rejects.toThrow();
    await expect(updateItem(ctx, it1.id, { priority: 9 })).rejects.toThrow();
    await expect(updateItem(ctx, "00000000-0000-4000-8000-000000000000", { title: "y" })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("returns subtasks and the activity log", async () => {
    const parent = await createItem(ctx, { title: "Research paper", kind: "project" });
    await createItem(ctx, { title: "Lit review", parentId: parent.id });
    const detail = await getItem(db, parent.id);
    expect(detail.subtasks).toHaveLength(1);
    expect(detail.activity[0]?.message).toBe("Created");
    expect(await listItems(db, { parentId: null })).toHaveLength(1);
  });
});

describe("reportProgress", () => {
  it("moves progress, next step and status, and logs the agent", async () => {
    const it1 = await createItem(ctx, { title: "Thesis ch. 2" });
    const r = await reportProgress({ db, tz: TZ, now }, {
      itemId: it1.id, actor: "thesis-agent", message: "Drafted section 2.1", progressPct: 30, nextStep: "Write 2.2",
    });
    expect(r.item).toMatchObject({ progressPct: 30, nextStep: "Write 2.2", status: "doing" });
    expect(r.activity.actor).toBe("thesis-agent");
    const fin = await reportProgress({ db, tz: TZ, now }, { itemId: it1.id, actor: "thesis-agent", message: "Done", status: "done" });
    expect(fin.item).toMatchObject({ status: "done", progressPct: 100 });
  });
});

describe("upsertFromSource", () => {
  it("inserts once, then refreshes source fields without clobbering workspace state", async () => {
    const a = await upsertFromSource(ctx, { title: "HW 3", source: "moodle", sourceRef: "assign:42", due: "2026-11-12" });
    expect(a.created).toBe(true);
    await updateItem(ctx, a.item.id, { status: "doing", progressPct: 40 });
    const b = await upsertFromSource(ctx, { title: "HW 3 (updated)", source: "moodle", sourceRef: "assign:42", due: "2026-11-13" });
    expect(b.created).toBe(false);
    expect(b.item.id).toBe(a.item.id);
    expect(b.item).toMatchObject({ title: "HW 3 (updated)", status: "doing", progressPct: 40 });
    expect(await listItems(db)).toHaveLength(1);
  });
});

describe("todaySummary", () => {
  it("groups top-level open items and counts the inbox", async () => {
    await createItem(ctx, { title: "Overdue", due: "2026-11-08" });
    await createItem(ctx, { title: "Today", due: "2026-11-09" });
    await createItem(ctx, { title: "Later", due: "2026-12-20" });
    await createItem(ctx, { title: "Maybe from email", status: "inbox" });
    const s = await todaySummary(db, TZ, now);
    expect(s.counts).toMatchObject({ overdue: 1, today: 1, later: 1, inbox: 1 });
    expect(s.focus.map((i) => i.title)).toEqual(["Overdue", "Today"]);
  });
});

describe("quickAddItem", () => {
  it("parses, links the course, and keeps unknown hints in the title", async () => {
    const chem = await createCourse(db, { name: "Organic Chemistry", code: "CHEM 241" });
    const a = await quickAddItem(ctx, "Lab report fri #chem p1 @hw");
    expect(a.item).toMatchObject({ title: "Lab report", courseId: chem.id, priority: 4, kind: "assignment", dueAllDay: true });
    const b = await quickAddItem(ctx, "Buy goggles #bio");
    expect(b.item).toMatchObject({ title: "Buy goggles #bio", courseId: null });
  });
});
