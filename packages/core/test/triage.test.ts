import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { activity, items } from "../src/schema.js";
import { createCourse, createItem, getItem, listItems, type Ctx, type WorkspaceDb } from "../src/service.js";
import {
  ActionStateError,
  approveAction,
  ingestCapture,
  listAgentActions,
  rejectAction,
  triageCapture,
  undoAction,
  type TriageAction,
  type TriageDecision,
  type TriageInput,
  type TriageModel,
} from "../src/triage.js";
import { testDb } from "./db.js";

const TZ = "America/New_York";
const now = new Date("2026-11-09T15:00:00Z"); // Mon 10:00 local
let db: WorkspaceDb;
let ctx: Ctx;

beforeEach(async () => {
  db = await testDb();
  ctx = { db, tz: TZ, actor: "triage", now };
});

const blank: TriageAction = {
  type: "ignore", confidence: "high", rationale: "r", itemId: null, title: null, kind: null, due: null,
  startsAt: null, endsAt: null, location: null, courseId: null, priority: null, notes: null, replyText: null,
};
const act = (a: Partial<TriageAction>): TriageAction => ({ ...blank, ...a });

/** Fake model: records what it was shown and returns a canned decision (or one built from the input). */
function fake(decide: TriageDecision | ((i: TriageInput) => TriageDecision)): TriageModel & { seen: TriageInput[] } {
  const seen: TriageInput[] = [];
  return {
    seen,
    async decide(input) {
      seen.push(input);
      return typeof decide === "function" ? decide(input) : decide;
    },
  };
}

async function capture(text = "hey", extra: Record<string, string> = {}) {
  const { capture } = await ingestCapture(db, {
    source: "discord_dm", externalRef: extra.ref ?? "m1", author: "Sam", context: "DM with Sam", text,
    url: "https://discord.com/channels/@me/1/2", ...extra,
  });
  return capture;
}

describe("ingestCapture", () => {
  it("dedupes the same source message", async () => {
    const a = await ingestCapture(db, { source: "discord_dm", externalRef: "m1", text: "hi" });
    const b = await ingestCapture(db, { source: "discord_dm", externalRef: "m1", text: "hi again" });
    expect(a.created).toBe(true);
    expect(b.created).toBe(false);
    expect(b.capture.id).toBe(a.capture.id);
  });
});

describe("triageCapture", () => {
  it("shows the model open items, courses and local time", async () => {
    const chem = await createCourse(db, { name: "Organic Chemistry", code: "CHEM 241" });
    await createItem({ ...ctx, actor: "user" }, { title: "Lab report 4", courseId: chem.id, due: "2026-11-12" });
    const m = fake({ summary: "nothing", actions: [act({ type: "ignore" })] });
    await triageCapture(ctx, (await capture("lol ok")).id, m);
    const input = m.seen[0]!;
    expect(input.nowLocal).toContain("Monday, November 9, 2026");
    expect(input.courses[0]).toMatchObject({ code: "CHEM 241" });
    expect(input.openItems[0]).toMatchObject({ title: "Lab report 4", due: "2026-11-12", course: "CHEM 241" });
    expect(input.capture.text).toBe("lol ok");
  });

  it("applies high-confidence tasks immediately and links them to the source", async () => {
    const c = await capture("can you finish the slides by friday?");
    const r = await triageCapture(ctx, c.id, fake({
      summary: "Added slides task.",
      actions: [act({ type: "create_task", title: "Finish slides", due: "2026-11-13", priority: 3 })],
    }));
    expect(r.actions[0]).toMatchObject({ status: "applied", type: "create_task" });
    const [item] = await listItems(db);
    expect(item).toMatchObject({ title: "Finish slides", source: "discord", sourceUrl: c.url, priority: 3, dueAllDay: true });
    expect(r.capture).toMatchObject({ status: "done", summary: "Added slides task." });
  });

  it("queues medium/low confidence as proposals, and approve applies them with edits", async () => {
    const r = await triageCapture(ctx, (await capture()).id, fake({
      summary: "s",
      actions: [act({ type: "create_task", confidence: "medium", title: "Maybe review notes" })],
    }));
    expect(r.actions[0]!.status).toBe("proposed");
    expect(await listItems(db)).toHaveLength(0);
    const applied = await approveAction({ ...ctx, actor: "user" }, r.actions[0]!.id, { title: "Review notes", due: "2026-11-10" });
    expect(applied.status).toBe("applied");
    expect((await listItems(db))[0]).toMatchObject({ title: "Review notes", dueAllDay: true });
    await expect(approveAction(ctx, r.actions[0]!.id)).rejects.toBeInstanceOf(ActionStateError);
  });

  it("updates an existing item and undo restores the old deadline", async () => {
    const lab = await createItem({ ...ctx, actor: "user" }, { title: "Lab 4", due: "2026-11-12" });
    const r = await triageCapture(ctx, (await capture("lab moved to friday")).id, fake({
      summary: "Moved Lab 4.",
      actions: [act({ type: "update_task", itemId: lab.id, due: "2026-11-13" })],
    }));
    expect(r.actions[0]!.status).toBe("applied");
    const moved = (await getItem(db, lab.id)).item;
    expect(moved.dueAt!.toISOString()).toBe("2026-11-14T04:59:59.000Z");
    await undoAction({ ...ctx, actor: "user" }, r.actions[0]!.id);
    const back = (await getItem(db, lab.id)).item;
    expect(back.dueAt!.toISOString()).toBe(lab.dueAt!.toISOString());
    expect(back.title).toBe("Lab 4");
  });

  it("creates events with start, end and location; undo deletes them", async () => {
    const r = await triageCapture(ctx, (await capture("study group thurs 7pm hunt library")).id, fake({
      summary: "s",
      actions: [act({ type: "create_event", title: "Study group", startsAt: "2026-11-12T19:00:00-05:00", endsAt: "2026-11-12T21:00:00-05:00", location: "Hunt Library" })],
    }));
    const [ev] = await listItems(db);
    expect(ev).toMatchObject({ kind: "event", location: "Hunt Library" });
    expect(ev!.dueAt!.toISOString()).toBe("2026-11-13T00:00:00.000Z");
    expect(ev!.endsAt!.toISOString()).toBe("2026-11-13T02:00:00.000Z");
    await undoAction(ctx, r.actions[0]!.id);
    expect(await listItems(db)).toHaveLength(0);
  });

  it("drafts a reply as a reply item, and a second draft replaces it", async () => {
    const r1 = await triageCapture(ctx, (await capture("can you send notes?")).id, fake({
      summary: "s", actions: [act({ type: "draft_reply", replyText: "Sure, sending tonight!" })],
    }));
    const [reply] = await listItems(db);
    expect(reply).toMatchObject({ kind: "reply", title: "Reply to Sam", replyDraft: "Sure, sending tonight!" });
    const r2 = await triageCapture(ctx, (await capture("actually need them by 5", { ref: "m2" })).id, fake((input) => ({
      summary: "s",
      actions: [act({ type: "draft_reply", itemId: input.openItems.find((i) => i.hasReplyDraft)!.id, replyText: "Will do by 5." })],
    })));
    expect((await getItem(db, reply!.id)).item.replyDraft).toBe("Will do by 5.");
    await undoAction(ctx, r2.actions[0]!.id);
    expect((await getItem(db, reply!.id)).item.replyDraft).toBe("Sure, sending tonight!");
    await undoAction(ctx, r1.actions[0]!.id);
    expect(await listItems(db)).toHaveLength(0);
  });

  it("adds notes as activity; undo removes the note", async () => {
    const lab = await createItem({ ...ctx, actor: "user" }, { title: "Lab 4" });
    const r = await triageCapture(ctx, (await capture()).id, fake({
      summary: "s", actions: [act({ type: "add_note", itemId: lab.id, notes: "TA: use the 2nd dataset" })],
    }));
    const notes = () => db.select().from(activity).where(eq(activity.itemId, lab.id));
    expect((await notes()).map((a) => a.message)).toContain("TA: use the 2nd dataset");
    await undoAction(ctx, r.actions[0]!.id);
    expect((await notes()).map((a) => a.message)).not.toContain("TA: use the 2nd dataset");
  });

  it("never trusts model output: unknown ids, bad dates and missing fields", async () => {
    const r = await triageCapture(ctx, (await capture()).id, fake({
      summary: "s",
      actions: [
        act({ type: "update_task", itemId: "00000000-0000-4000-8000-000000000000", due: "2026-11-13" }),
        act({ type: "create_task", title: "Read ch 5", due: "next-ish", courseId: "not-a-course" }),
        act({ type: "create_event", title: "Meeting" }),
        act({ type: "ignore" }),
      ],
    }));
    expect(r.actions.map((a) => a.status)).toEqual(["skipped", "applied", "proposed", "skipped"]);
    expect(r.actions[2]!.rationale).toContain("no start time");
    const [task] = await listItems(db);
    expect(task).toMatchObject({ title: "Read ch 5", dueAt: null, courseId: null });
  });

  it("caps the number of actions", async () => {
    const r = await triageCapture(ctx, (await capture()).id, fake({
      summary: "s", actions: Array.from({ length: 9 }, (_, i) => act({ type: "create_task", title: `t${i}` })),
    }));
    expect(r.actions).toHaveLength(5);
  });

  it("marks the capture failed when the model errors, and nothing is applied", async () => {
    const c = await capture();
    const broken: TriageModel = { decide: async () => { throw new Error("rate limited"); } };
    await expect(triageCapture(ctx, c.id, broken)).rejects.toThrow("rate limited");
    const rows = await db.select().from(items);
    expect(rows).toHaveLength(0);
    expect(await listAgentActions(db)).toHaveLength(0);
    const { capture: again } = await ingestCapture(db, { source: "discord_dm", externalRef: "m1", text: "x" });
    expect(again).toMatchObject({ status: "failed", error: "rate limited" });
  });

  it("reject leaves no trace in items; listAgentActions joins context", async () => {
    const r = await triageCapture(ctx, (await capture()).id, fake({
      summary: "s", actions: [act({ type: "create_task", confidence: "low", title: "Guess" })],
    }));
    await rejectAction(ctx, r.actions[0]!.id);
    expect(await listItems(db)).toHaveLength(0);
    const [row] = await listAgentActions(db);
    expect(row).toMatchObject({ action: { status: "rejected" }, capture: { context: "DM with Sam" } });
    await expect(undoAction(ctx, r.actions[0]!.id)).rejects.toBeInstanceOf(ActionStateError);
  });
});
