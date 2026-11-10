import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import {
  ACTION_TYPES,
  activity,
  agentActions,
  captures,
  ITEM_KINDS,
  items,
  type AgentAction,
  type Capture,
  type CaptureSource,
  type Item,
  type ItemSource,
} from "./schema.js";
import { createItem, listCourses, listItems, updateItem, type Ctx, type WorkspaceDb, NotFoundError } from "./service.js";
import { tzOffsetMs } from "./validation.js";

// ─── What the model returns ──────────────────────────────────────────────────

export const CONFIDENCE = ["high", "medium", "low"] as const;

/** One flat shape for every action type keeps the structured-output schema simple; unused fields are null. */
export const triageActionSchema = z.object({
  type: z.enum(ACTION_TYPES),
  confidence: z.enum(CONFIDENCE),
  rationale: z.string().describe("One short sentence: why this action."),
  itemId: z.string().nullable().describe("id of an existing item from <open_items> (update_task, add_note, or draft_reply on an existing reply item)."),
  title: z.string().nullable(),
  kind: z.enum(ITEM_KINDS).nullable(),
  due: z.string().nullable().describe("YYYY-MM-DD for a date-only deadline, or ISO 8601 with offset for a timed one."),
  startsAt: z.string().nullable().describe("Events: ISO 8601 with offset."),
  endsAt: z.string().nullable(),
  location: z.string().nullable(),
  courseId: z.string().nullable().describe("id from <courses>, only if clearly that course."),
  priority: z.number().int().nullable().describe("1 low – 4 urgent."),
  notes: z.string().nullable().describe("Extra detail for the item, or the note text for add_note."),
  replyText: z.string().nullable().describe("draft_reply: the message the user could send."),
});
export type TriageAction = z.infer<typeof triageActionSchema>;

export const triageDecisionSchema = z.object({
  summary: z.string().describe("One line for the user: what you did with this message."),
  actions: z.array(triageActionSchema),
});
export type TriageDecision = z.infer<typeof triageDecisionSchema>;

export interface TriageInput {
  capture: Pick<Capture, "source" | "author" | "context" | "text" | "url">;
  nowIso: string;
  nowLocal: string;
  timezone: string;
  courses: { id: string; name: string; code: string | null }[];
  openItems: { id: string; title: string; kind: string; status: string; due: string | null; course: string | null; hasReplyDraft: boolean }[];
}

/** The model behind triage. Production uses Claude (triage-anthropic.ts); tests use a fake. */
export interface TriageModel {
  decide(input: TriageInput): Promise<TriageDecision>;
}

// ─── Ingest ──────────────────────────────────────────────────────────────────

export const captureInputSchema = z.object({
  source: z.enum(["discord_dm", "discord_channel", "manual", "agent", "email"]),
  externalRef: z.string().max(200).optional(),
  author: z.string().max(200).optional(),
  context: z.string().max(300).optional(),
  text: z.string().trim().min(1).max(20_000),
  url: z.url().optional(),
});
export type CaptureInput = z.infer<typeof captureInputSchema>;

/** Store raw input. Re-sending the same source message returns the existing capture instead of a duplicate. */
export async function ingestCapture(db: WorkspaceDb, raw: CaptureInput): Promise<{ capture: Capture; created: boolean }> {
  const input = captureInputSchema.parse(raw);
  const [row] = await db.insert(captures).values(input).onConflictDoNothing().returning();
  if (row) return { capture: row, created: true };
  const [existing] = await db
    .select()
    .from(captures)
    .where(and(eq(captures.source, input.source), eq(captures.externalRef, input.externalRef!)));
  return { capture: existing!, created: false };
}

// ─── Triage ──────────────────────────────────────────────────────────────────

const AUTO_APPLY: ReadonlySet<string> = new Set(["create_task", "update_task", "create_event", "draft_reply", "add_note"]);
const MAX_ACTIONS = 5;

function itemSourceFor(source: CaptureSource): ItemSource {
  return source.startsWith("discord") ? "discord" : source === "manual" ? "manual" : "agent";
}

function localNowString(now: Date, tz: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz, weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "2-digit",
  }).format(now);
}

function isoOrNull(v: string | null): string | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function dueOrNull(v: string | null, tz: string): string | null {
  if (!v) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  return isoOrNull(v);
}

/** Model output → safe payload. Unknown ids and unparseable dates become null rather than reaching the DB. */
function sanitize(a: TriageAction, known: { items: Set<string>; courses: Set<string> }, tz: string) {
  return {
    ...a,
    title: a.title?.trim().slice(0, 300) || null,
    itemId: a.itemId && known.items.has(a.itemId) ? a.itemId : null,
    courseId: a.courseId && known.courses.has(a.courseId) ? a.courseId : null,
    due: dueOrNull(a.due, tz),
    startsAt: isoOrNull(a.startsAt),
    endsAt: isoOrNull(a.endsAt),
    priority: a.priority && a.priority >= 1 && a.priority <= 4 ? a.priority : null,
    notes: a.notes?.slice(0, 5000) || null,
    replyText: a.replyText?.slice(0, 5000) || null,
    location: a.location?.slice(0, 300) || null,
  };
}
type Payload = ReturnType<typeof sanitize>;

/** Why an action can't run as-is (missing required field or unknown target), or null if it can. */
function blocker(p: Payload, hadItemId: boolean): string | null {
  switch (p.type) {
    case "create_task":
      return p.title ? null : "no title";
    case "create_event":
      return !p.title ? "no title" : !p.startsAt ? "no start time" : null;
    case "update_task":
      if (!p.itemId) return hadItemId ? "unknown item" : "no item";
      return p.title || p.due || p.priority || p.courseId || p.notes ? null : "nothing to change";
    case "add_note":
      if (!p.itemId) return hadItemId ? "unknown item" : "no item";
      return p.notes ? null : "no note text";
    case "draft_reply":
      return p.replyText ? (hadItemId && !p.itemId ? "unknown item" : null) : "no reply text";
    case "ignore":
      return null;
  }
}

const SNAPSHOT_KEYS = ["title", "notes", "dueAt", "dueAllDay", "priority", "courseId", "replyDraft"] as const;
function snapshot(item: Item, keys: readonly (typeof SNAPSHOT_KEYS)[number][]) {
  const out: Record<string, unknown> = {};
  for (const k of keys) out[k] = item[k] instanceof Date ? (item[k] as Date).toISOString() : item[k];
  return out;
}

/** Perform one action. Returns what to record for undo. Runs inside the caller's transaction. */
async function perform(ctx: Ctx, p: Payload, capture: Capture) {
  const source = itemSourceFor(capture.source);
  const sourceUrl = capture.url ?? undefined;
  const ref = (s?: string | null) => s ?? undefined;
  switch (p.type) {
    case "create_task": {
      const item = await createItem(ctx, {
        title: p.title!, kind: p.kind && p.kind !== "event" ? p.kind : "task", due: ref(p.due),
        courseId: ref(p.courseId), priority: p.priority ?? undefined, notes: ref(p.notes), source, sourceUrl,
      });
      return { itemId: item.id, before: null, activityId: null };
    }
    case "create_event": {
      const item = await createItem(ctx, {
        title: p.title!, kind: "event", scheduledAt: p.startsAt!, due: p.startsAt!, endsAt: ref(p.endsAt),
        location: ref(p.location), courseId: ref(p.courseId), notes: ref(p.notes), source, sourceUrl,
      });
      return { itemId: item.id, before: null, activityId: null };
    }
    case "update_task": {
      const [prev] = await ctx.db.select().from(items).where(eq(items.id, p.itemId!));
      if (!prev) throw new NotFoundError(`Item ${p.itemId}`);
      const patch: Record<string, unknown> = {};
      const touched: (typeof SNAPSHOT_KEYS)[number][] = [];
      if (p.title) { patch.title = p.title; touched.push("title"); }
      if (p.due) { patch.due = p.due; touched.push("dueAt", "dueAllDay"); }
      if (p.priority) { patch.priority = p.priority; touched.push("priority"); }
      if (p.courseId) { patch.courseId = p.courseId; touched.push("courseId"); }
      if (p.notes) { patch.notes = prev.notes ? `${prev.notes}\n\n${p.notes}` : p.notes; touched.push("notes"); }
      await updateItem(ctx, prev.id, patch);
      return { itemId: prev.id, before: snapshot(prev, touched), activityId: null };
    }
    case "add_note": {
      const [row] = await ctx.db.insert(activity).values({ itemId: p.itemId!, actor: ctx.actor, message: p.notes! }).returning();
      return { itemId: p.itemId!, before: null, activityId: row!.id };
    }
    case "draft_reply": {
      if (p.itemId) {
        const [prev] = await ctx.db.select().from(items).where(eq(items.id, p.itemId));
        if (!prev) throw new NotFoundError(`Item ${p.itemId}`);
        await updateItem(ctx, prev.id, { replyDraft: p.replyText! });
        return { itemId: prev.id, before: snapshot(prev, ["replyDraft"]), activityId: null };
      }
      const who = capture.author ? `Reply to ${capture.author}` : "Reply";
      const item = await createItem(ctx, {
        title: p.title ?? who, kind: "reply", replyDraft: p.replyText!, due: ref(p.due),
        courseId: ref(p.courseId), notes: ref(p.notes), source, sourceUrl,
      });
      return { itemId: item.id, before: null, activityId: null };
    }
    case "ignore":
      return { itemId: null, before: null, activityId: null };
  }
}

export interface TriageResult {
  capture: Capture;
  summary: string;
  actions: AgentAction[];
}

/**
 * Hand one capture to the model and act on its decision: high-confidence actions are applied
 * immediately (and can be undone); medium/low ones wait in the review queue as proposals.
 */
export async function triageCapture(ctx: Ctx, captureId: string, model: TriageModel): Promise<TriageResult> {
  const now = ctx.now ?? new Date();
  const [capture] = await ctx.db.select().from(captures).where(eq(captures.id, captureId));
  if (!capture) throw new NotFoundError(`Capture ${captureId}`);
  await ctx.db.update(captures).set({ status: "processing", error: null }).where(eq(captures.id, captureId));

  try {
    const [open, courseList] = await Promise.all([listItems(ctx.db, { limit: 300 }), listCourses(ctx.db)]);
    const courseName = new Map(courseList.map((c) => [c.id, c.code ?? c.name]));
    const input: TriageInput = {
      capture,
      nowIso: now.toISOString(),
      nowLocal: localNowString(now, ctx.tz),
      timezone: ctx.tz,
      courses: courseList.map((c) => ({ id: c.id, name: c.name, code: c.code })),
      openItems: open.map((i) => ({
        id: i.id, title: i.title, kind: i.kind, status: i.status,
        due: i.dueAt ? (i.dueAllDay ? localDate(i.dueAt, ctx.tz) : i.dueAt.toISOString()) : null,
        course: i.courseId ? courseName.get(i.courseId) ?? null : null,
        hasReplyDraft: !!i.replyDraft,
      })),
    };
    const decision = triageDecisionSchema.parse(await model.decide(input));
    const known = { items: new Set(open.map((i) => i.id)), courses: new Set(courseList.map((c) => c.id)) };

    const recorded = await ctx.db.transaction(async (tx) => {
      const txCtx: Ctx = { ...ctx, db: tx as unknown as WorkspaceDb, now };
      const out: AgentAction[] = [];
      for (const raw of decision.actions.slice(0, MAX_ACTIONS)) {
        const p = sanitize(raw, known, ctx.tz);
        const why = blocker(p, !!raw.itemId);
        const auto = AUTO_APPLY.has(p.type) && p.confidence === "high" && !why;
        let status: AgentAction["status"] = p.type === "ignore" ? "skipped" : auto ? "applied" : "proposed";
        let rationale = p.rationale;
        if (why && p.type !== "ignore") {
          // A proposal the user can fix in the UI is still useful; an unknown target is not.
          if (why === "unknown item") status = "skipped";
          rationale = `${rationale} (needs review: ${why})`;
        }
        let done = { itemId: p.itemId as string | null, before: null as Record<string, unknown> | null, activityId: null as string | null };
        if (status === "applied") done = await perform(txCtx, p, capture);
        const [row] = await tx
          .insert(agentActions)
          .values({
            captureId, type: p.type, status, confidence: p.confidence, rationale, payload: p,
            itemId: done.itemId, before: done.before, activityId: done.activityId,
            resolvedAt: status === "applied" ? now : null,
          })
          .returning();
        out.push(row!);
      }
      await tx
        .update(captures)
        .set({ status: "done", summary: decision.summary.slice(0, 500), processedAt: now })
        .where(eq(captures.id, captureId));
      return out;
    });
    const [fresh] = await ctx.db.select().from(captures).where(eq(captures.id, captureId));
    return { capture: fresh!, summary: decision.summary, actions: recorded };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await ctx.db.update(captures).set({ status: "failed", error: message.slice(0, 1000) }).where(eq(captures.id, captureId));
    throw e;
  }
}

function localDate(at: Date, tz: string) {
  const d = new Date(at.getTime() + tzOffsetMs(at, tz));
  return d.toISOString().slice(0, 10);
}

// ─── Review: approve, reject, undo ───────────────────────────────────────────

export class ActionStateError extends Error {}

async function loadAction(db: WorkspaceDb, id: string) {
  const [row] = await db.select().from(agentActions).where(eq(agentActions.id, id));
  if (!row) throw new NotFoundError(`Action ${id}`);
  return row;
}

/** Apply a proposed action, optionally with the user's edits to its fields. */
export async function approveAction(ctx: Ctx, id: string, edits: Partial<Payload> = {}): Promise<AgentAction> {
  const now = ctx.now ?? new Date();
  return ctx.db.transaction(async (tx) => {
    const txCtx: Ctx = { ...ctx, db: tx as unknown as WorkspaceDb, now };
    const action = await loadAction(txCtx.db, id);
    if (action.status !== "proposed") throw new ActionStateError(`Action is ${action.status}, not proposed`);
    const [capture] = await tx.select().from(captures).where(eq(captures.id, action.captureId));
    const p = { ...(action.payload as Payload), ...edits } as Payload;
    const why = blocker(p, !!p.itemId);
    if (why) throw new ActionStateError(`Can't apply: ${why}`);
    const done = await perform(txCtx, p, capture!);
    const [row] = await tx
      .update(agentActions)
      .set({ status: "applied", payload: p, itemId: done.itemId, before: done.before, activityId: done.activityId, resolvedAt: now })
      .where(eq(agentActions.id, id))
      .returning();
    return row!;
  });
}

export async function rejectAction(ctx: Ctx, id: string): Promise<AgentAction> {
  const action = await loadAction(ctx.db, id);
  if (action.status !== "proposed") throw new ActionStateError(`Action is ${action.status}, not proposed`);
  const [row] = await ctx.db
    .update(agentActions)
    .set({ status: "rejected", resolvedAt: ctx.now ?? new Date() })
    .where(eq(agentActions.id, id))
    .returning();
  return row!;
}

const DATE_KEYS = new Set(["dueAt"]);

/** Reverse an applied action: delete what it created, or restore the fields it changed. */
export async function undoAction(ctx: Ctx, id: string): Promise<AgentAction> {
  const now = ctx.now ?? new Date();
  return ctx.db.transaction(async (tx) => {
    const action = await loadAction(tx as unknown as WorkspaceDb, id);
    if (action.status !== "applied") throw new ActionStateError(`Action is ${action.status}, not applied`);
    if (action.type === "add_note" && action.activityId) {
      await tx.delete(activity).where(eq(activity.id, action.activityId));
    } else if (action.itemId && action.before === null && action.type !== "ignore") {
      await tx.delete(items).where(eq(items.id, action.itemId)); // the action created it
    } else if (action.itemId && action.before) {
      const restore: Record<string, unknown> = { updatedAt: now };
      for (const [k, v] of Object.entries(action.before)) restore[k] = DATE_KEYS.has(k) && v ? new Date(v as string) : v;
      await tx.update(items).set(restore).where(eq(items.id, action.itemId));
      await tx.insert(activity).values({ itemId: action.itemId, actor: ctx.actor, message: `Undid ${action.type.replace("_", " ")}` });
    }
    const [row] = await tx.update(agentActions).set({ status: "undone", resolvedAt: now }).where(eq(agentActions.id, id)).returning();
    return row!;
  });
}

// ─── Read models for the UI ──────────────────────────────────────────────────

export async function listAgentActions(db: WorkspaceDb, opts: { status?: AgentAction["status"][]; limit?: number } = {}) {
  const rows = await db
    .select({ action: agentActions, capture: captures, itemTitle: items.title })
    .from(agentActions)
    .innerJoin(captures, eq(agentActions.captureId, captures.id))
    .leftJoin(items, eq(agentActions.itemId, items.id))
    .where(opts.status?.length ? inArray(agentActions.status, opts.status) : undefined)
    .orderBy(desc(agentActions.createdAt))
    .limit(opts.limit ?? 50);
  return rows;
}

export async function listCaptures(db: WorkspaceDb, limit = 30) {
  return db.select().from(captures).orderBy(desc(captures.createdAt)).limit(limit);
}
