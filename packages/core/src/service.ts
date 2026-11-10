import { and, asc, desc, eq, getTableColumns, ilike, inArray, isNull, lte, ne, or, sql, type SQL } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema.js";
import { activity, courses, items, type Item, type NewItem } from "./schema.js";
import { matchCourse, parseQuickAdd } from "./quickadd.js";
import { groupByBucket, urgencyScore } from "./scheduling.js";
import {
  itemCreateSchema,
  itemFilterSchema,
  itemUpdateSchema,
  parseDue,
  progressReportSchema,
  type ItemCreate,
  type ItemFilter,
  type ItemUpdate,
  type ProgressReport,
} from "./validation.js";

export type WorkspaceDb = PgDatabase<PgQueryResultHKT, typeof schema>;

export interface Ctx {
  db: WorkspaceDb;
  /** IANA timezone used for date-only dues and "today". */
  tz: string;
  /** Who is acting: "user", an agent name, or a collector name. */
  actor: string;
  now?: Date;
}

export class NotFoundError extends Error {
  constructor(what: string) {
    super(`${what} not found`);
  }
}

const OPEN_STATUSES = ["inbox", "todo", "doing", "blocked"] as const;

export async function listItems(db: WorkspaceDb, rawFilter: ItemFilter = {}): Promise<Item[]> {
  const f = itemFilterSchema.parse(rawFilter);
  const where: SQL[] = [];
  if (f.status?.length) where.push(inArray(items.status, f.status));
  else if (!f.includeDone) where.push(inArray(items.status, [...OPEN_STATUSES]));
  if (f.kind?.length) where.push(inArray(items.kind, f.kind));
  if (f.courseId) where.push(eq(items.courseId, f.courseId));
  if (f.parentId === null) where.push(isNull(items.parentId));
  else if (f.parentId) where.push(eq(items.parentId, f.parentId));
  if (f.dueBefore) where.push(lte(items.dueAt, new Date(f.dueBefore)));
  if (f.search) {
    const q = `%${f.search.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    where.push(or(ilike(items.title, q), ilike(items.notes, q))!);
  }
  return db
    .select()
    .from(items)
    .where(where.length ? and(...where) : undefined)
    .orderBy(sql`${items.dueAt} asc nulls last`, desc(items.priority), asc(items.createdAt))
    .limit(f.limit ?? 200);
}

export async function getItem(db: WorkspaceDb, id: string) {
  const [item] = await db.select().from(items).where(eq(items.id, id));
  if (!item) throw new NotFoundError(`Item ${id}`);
  const [subtasks, log] = await Promise.all([
    db.select().from(items).where(eq(items.parentId, id)).orderBy(asc(items.createdAt)),
    db.select().from(activity).where(eq(activity.itemId, id)).orderBy(desc(activity.createdAt)).limit(50),
  ]);
  return { item, subtasks, activity: log };
}

function toColumns(input: ItemCreate | ItemUpdate, tz: string): Partial<NewItem> {
  const { due, ...rest } = input;
  const cols: Partial<NewItem> = { ...rest } as Partial<NewItem>;
  if ("scheduledAt" in input && input.scheduledAt !== undefined) cols.scheduledAt = new Date(input.scheduledAt);
  const d = parseDue(due, tz);
  if (d) Object.assign(cols, d);
  return cols;
}

/** done ⇒ stamp completion and 100%; leaving done ⇒ clear the stamp. */
function applyStatusSideEffects(cols: Partial<NewItem>, prev: Item | undefined, now: Date) {
  if (cols.status === "done" && prev?.status !== "done") {
    cols.completedAt = now;
    cols.progressPct = 100;
  } else if (cols.status && cols.status !== "done" && prev?.status === "done") {
    cols.completedAt = null;
  }
}

export async function createItem(ctx: Ctx, raw: ItemCreate): Promise<Item> {
  const input = itemCreateSchema.parse(raw);
  const now = ctx.now ?? new Date();
  const cols = toColumns(input, ctx.tz) as NewItem;
  applyStatusSideEffects(cols, undefined, now);
  return ctx.db.transaction(async (tx) => {
    const [item] = await tx.insert(items).values(cols).returning();
    await tx.insert(activity).values({ itemId: item!.id, actor: ctx.actor, message: "Created" });
    return item!;
  });
}

export async function updateItem(ctx: Ctx, id: string, raw: ItemUpdate): Promise<Item> {
  const input = itemUpdateSchema.parse(raw);
  const now = ctx.now ?? new Date();
  return ctx.db.transaction(async (tx) => {
    const [prev] = await tx.select().from(items).where(eq(items.id, id)).for("update");
    if (!prev) throw new NotFoundError(`Item ${id}`);
    const cols = toColumns(input, ctx.tz);
    applyStatusSideEffects(cols, prev, now);
    const [item] = await tx
      .update(items)
      .set({ ...cols, updatedAt: now })
      .where(eq(items.id, id))
      .returning();
    const changed = Object.keys(input).join(", ");
    if (changed) await tx.insert(activity).values({ itemId: id, actor: ctx.actor, message: `Updated ${changed}` });
    return item!;
  });
}

export function completeItem(ctx: Ctx, id: string): Promise<Item> {
  return updateItem(ctx, id, { status: "done" });
}

/** An agent or person logs what happened, and optionally moves progress / next step / status. */
export async function reportProgress(ctx: Omit<Ctx, "actor">, raw: ProgressReport) {
  const r = progressReportSchema.parse(raw);
  const now = ctx.now ?? new Date();
  return ctx.db.transaction(async (tx) => {
    const [prev] = await tx.select().from(items).where(eq(items.id, r.itemId)).for("update");
    if (!prev) throw new NotFoundError(`Item ${r.itemId}`);
    const cols: Partial<NewItem> = { updatedAt: now };
    if (r.progressPct !== undefined) cols.progressPct = r.progressPct;
    if (r.nextStep !== undefined) cols.nextStep = r.nextStep;
    if (r.status) cols.status = r.status;
    else if (prev.status === "todo" || prev.status === "inbox") cols.status = "doing"; // reporting work implies started
    applyStatusSideEffects(cols, prev, now);
    const [item] = await tx.update(items).set(cols).where(eq(items.id, r.itemId)).returning();
    const [entry] = await tx
      .insert(activity)
      .values({ itemId: r.itemId, actor: r.actor, message: r.message, progressPct: r.progressPct ?? null })
      .returning();
    return { item: item!, activity: entry! };
  });
}

/**
 * Collector entry point: insert or refresh an item keyed by (source, sourceRef).
 * Source-owned fields (title, notes, due, url) are refreshed; Workspace's own state
 * (status, progress, next step, priority) is never overwritten by a re-sync.
 */
export async function upsertFromSource(
  ctx: Ctx,
  raw: ItemCreate & { source: schema.ItemSource; sourceRef: string },
): Promise<{ item: Item; created: boolean }> {
  const input = itemCreateSchema.parse(raw);
  const now = ctx.now ?? new Date();
  const cols = toColumns(input, ctx.tz) as NewItem;
  const refresh: Partial<NewItem> = { title: cols.title, updatedAt: now };
  for (const k of ["notes", "dueAt", "dueAllDay", "sourceUrl", "scheduledAt", "kind"] as const) {
    if (k in cols) (refresh as Record<string, unknown>)[k] = cols[k];
  }
  const [row] = await ctx.db
    .insert(items)
    .values(cols)
    .onConflictDoUpdate({ target: [items.source, items.sourceRef], set: refresh })
    // xmax = 0 only on a freshly inserted row, so it tells insert from update in one round trip.
    .returning({ ...getTableColumns(items), created: sql<boolean>`(xmax = 0)` });
  const { created, ...item } = row!;
  if (created) await ctx.db.insert(activity).values({ itemId: item.id, actor: ctx.actor, message: `Imported from ${input.source}` });
  return { item, created };
}

export async function todaySummary(db: WorkspaceDb, tz: string, now = new Date()) {
  const open = await db
    .select()
    .from(items)
    .where(and(inArray(items.status, [...OPEN_STATUSES]), ne(items.status, "inbox"), isNull(items.parentId)));
  const groups = groupByBucket(open, now, tz);
  const [{ inbox } = { inbox: 0 }] = await db
    .select({ inbox: sql<number>`count(*)::int` })
    .from(items)
    .where(eq(items.status, "inbox"));
  const top = [...groups.overdue, ...groups.today].sort((a, b) => urgencyScore(b, now) - urgencyScore(a, now));
  return {
    generatedAt: now.toISOString(),
    timezone: tz,
    counts: { ...Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, v.length])), inbox },
    focus: top.slice(0, 5),
    groups,
  };
}

export async function listCourses(db: WorkspaceDb) {
  return db.select().from(courses).where(eq(courses.archived, false)).orderBy(asc(courses.name));
}

export async function createCourse(db: WorkspaceDb, input: { name: string; code?: string; color?: string }) {
  const [c] = await db.insert(courses).values(input).returning();
  return c!;
}

/** One-line capture used by every surface (web, desktop shortcut, phone, agents). */
export async function quickAddItem(ctx: Ctx, text: string, extra: Partial<ItemCreate> = {}) {
  const parsed = parseQuickAdd(text, ctx.now ?? new Date(), ctx.tz);
  const { courseHint, ...fields } = parsed;
  const course = courseHint ? matchCourse(courseHint, await listCourses(ctx.db)) : undefined;
  // Unknown #hint: keep it visible in the title rather than silently dropping it.
  const title = courseHint && !course ? `${fields.title} #${courseHint}` : fields.title;
  const item = await createItem(ctx, { ...fields, title, courseId: course?.id, ...extra });
  return { item, parsed, course: course ?? null };
}
