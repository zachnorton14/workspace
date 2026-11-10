import {
  completeItem,
  createCourse,
  createItem,
  getItem,
  ITEM_KINDS,
  ITEM_STATUSES,
  itemCreateSchema,
  itemFilterSchema,
  itemUpdateSchema,
  listCourses,
  listItems,
  NotFoundError,
  quickAddItem,
  reportProgress,
  todaySummary,
  updateItem,
} from "@workspace/core";
import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { ZodError, z } from "zod";
import { bearerOk } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { env } from "@/lib/env";

/** Drop nulls/empties so agents spend fewer tokens reading results. */
function compact(v: unknown): unknown {
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return v.map(compact);
  if (v && typeof v === "object") {
    return Object.fromEntries(
      Object.entries(v)
        .filter(([, x]) => x !== null && x !== undefined && !(Array.isArray(x) && x.length === 0))
        .map(([k, x]) => [k, compact(x)]),
    );
  }
  return v;
}

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

async function run(fn: () => Promise<unknown>): Promise<ToolResult> {
  try {
    return { content: [{ type: "text", text: JSON.stringify(compact(await fn())) }] };
  } catch (e) {
    const msg =
      e instanceof ZodError ? `Invalid input: ${e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`
      : e instanceof NotFoundError ? e.message
      : "Internal error";
    if (!(e instanceof ZodError || e instanceof NotFoundError)) console.error(e);
    return { content: [{ type: "text", text: msg }], isError: true };
  }
}

const actorField = z
  .string()
  .min(1)
  .max(100)
  .describe('Who is acting. Agents: a short stable name for yourself, e.g. "chem-hw-agent". Humans: "user".');

const ctx = (actor: string) => ({ db: getDb(), tz: env.tz, actor });

const mcp = createMcpHandler(
  (server) => {
    server.registerTool(
      "today_summary",
      {
        title: "Today summary",
        description:
          "What needs attention now: counts per bucket (overdue/today/tomorrow/this_week/later/no_date/inbox), the top 5 focus items by urgency, and every open top-level item grouped by bucket. Start here.",
        inputSchema: z.object({}),
        annotations: { readOnlyHint: true },
      },
      () => run(() => todaySummary(getDb(), env.tz)),
    );

    server.registerTool(
      "list_items",
      {
        title: "List items",
        description:
          "Search or filter to-do items. Open items only unless includeDone or status is given. Use `search` to find the item for the work you are doing before creating a new one.",
        inputSchema: itemFilterSchema,
        annotations: { readOnlyHint: true },
      },
      (f) => run(async () => ({ items: await listItems(getDb(), f) })),
    );

    server.registerTool(
      "get_item",
      {
        title: "Get item",
        description: "One item with its subtasks and recent activity log (newest first).",
        inputSchema: z.object({ id: z.uuid() }),
        annotations: { readOnlyHint: true },
      },
      ({ id }) => run(() => getItem(getDb(), id)),
    );

    server.registerTool(
      "create_item",
      {
        title: "Create item",
        description: `Create a to-do. kind: ${ITEM_KINDS.join("|")}. due: ISO datetime with offset, or YYYY-MM-DD for an all-day due date. priority 1 (low) – 4 (urgent). Set parentId to make it a subtask of a project. Use status "inbox" for things the user should confirm.`,
        inputSchema: itemCreateSchema.omit({ source: true, sourceRef: true }).extend({ actor: actorField }),
      },
      ({ actor, ...input }) => run(async () => ({ item: await createItem(ctx(actor), { ...input, source: actor === "user" ? "manual" : "agent" }) })),
    );

    server.registerTool(
      "quick_add",
      {
        title: "Quick add",
        description:
          'Capture a to-do from one line of text, Todoist-style: "Lab report fri 5pm #chem p2 @hw ~2h". Dates: today, tmr, fri, next mon, in 3 days, nov 20, 11/20, 2026-11-20. Times: 5pm, 17:30, noon. p1 = most urgent. @kind: hw, exam, reply, reading, project, chore, event. #course matches a course code or name. ~2h = time estimate. Use create_item instead when you already have structured fields.',
        inputSchema: z.object({ text: z.string().min(1).max(500), actor: actorField }),
      },
      ({ text, actor }) => run(() => quickAddItem(ctx(actor), text, { source: actor === "user" ? "manual" : "agent" })),
    );

    server.registerTool(
      "update_item",
      {
        title: "Update item",
        description: `Change fields on an item. status: ${ITEM_STATUSES.join("|")}. Pass null to clear due, courseId or nextStep. To log work done, prefer report_progress.`,
        inputSchema: itemUpdateSchema.extend({ id: z.uuid(), actor: actorField }),
      },
      ({ id, actor, ...patch }) => run(async () => ({ item: await updateItem(ctx(actor), id, patch) })),
    );

    server.registerTool(
      "complete_item",
      {
        title: "Complete item",
        description: "Mark an item done (sets progress to 100%).",
        inputSchema: z.object({ id: z.uuid(), actor: actorField }),
        annotations: { idempotentHint: true },
      },
      ({ id, actor }) => run(async () => ({ item: await completeItem(ctx(actor), id) })),
    );

    server.registerTool(
      "report_progress",
      {
        title: "Report progress",
        description:
          "Log what you just did on an item and move it forward. Call at meaningful milestones and when you stop working. Always set nextStep to the concrete next action so the user (or the next session) can pick up. Reporting on a todo item moves it to doing; pass status \"done\" when finished or \"blocked\" if stuck (say why in message).",
        inputSchema: z.object({
          itemId: z.uuid(),
          actor: actorField,
          message: z.string().min(1).max(5000).describe("What happened, 1–3 sentences."),
          progressPct: z.number().int().min(0).max(100).optional(),
          nextStep: z.string().max(1000).optional(),
          status: z.enum(["todo", "doing", "blocked", "done"]).optional(),
        }),
      },
      (r) => run(() => reportProgress({ db: getDb(), tz: env.tz }, r)),
    );

    server.registerTool(
      "list_courses",
      {
        title: "List courses",
        description: "Active courses (id, name, code). Use the id as courseId on items.",
        inputSchema: z.object({}),
        annotations: { readOnlyHint: true },
      },
      () => run(async () => ({ courses: await listCourses(getDb()) })),
    );

    server.registerTool(
      "create_course",
      {
        title: "Create course",
        description: "Add a course so items can be grouped under it.",
        inputSchema: z.object({ name: z.string().min(1).max(200), code: z.string().max(50).optional(), color: z.string().max(20).optional() }),
      },
      (c) => run(async () => ({ course: await createCourse(getDb(), c) })),
    );
  },
  { serverInfo: { name: "workspace", version: "0.1.0" } },
);

// Phase 1: static bearer token (WORKSPACE_API_TOKEN). Phase 2 adds OAuth for the claude.ai connector.
const handler = withMcpAuth(
  mcp,
  (_req, token) => (bearerOk(token) ? { token: token!, clientId: "workspace-token", scopes: ["workspace"] } : undefined),
  { required: true },
);

export { handler as GET, handler as POST, handler as DELETE };
