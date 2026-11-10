import { approveAction, rejectAction, undoAction } from "@workspace/core";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { env } from "@/lib/env";
import { api, body } from "@/lib/http";

type Ctx = { params: Promise<{ id: string }> };

const opSchema = z.object({ op: z.enum(["approve", "reject", "undo"]), edits: z.record(z.string(), z.unknown()).optional() });

/** POST { op: "approve" | "reject" | "undo", edits? } */
export const POST = api<Ctx>(async (req, { params }) => {
  const { id } = await params;
  const { op, edits } = opSchema.parse(await body(req));
  const ctx = { db: getDb(), tz: env.tz, actor: req.headers.get("x-workspace-actor") ?? "user" };
  const action = op === "approve" ? await approveAction(ctx, id, edits as never) : op === "reject" ? await rejectAction(ctx, id) : await undoAction(ctx, id);
  return { action };
});
