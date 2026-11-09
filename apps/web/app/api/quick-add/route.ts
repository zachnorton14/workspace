import { quickAddItem } from "@hub/core";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { env } from "@/lib/env";
import { api, body } from "@/lib/http";

/** POST { text } — used by the desktop global shortcut and any script. */
export const POST = api(async (req) => {
  const { text } = z.object({ text: z.string().trim().min(1).max(500) }).parse(await body(req));
  const actor = req.headers.get("x-hub-actor") ?? "user";
  const out = await quickAddItem({ db: getDb(), tz: env.tz, actor }, text, { source: actor === "user" ? "manual" : "agent" });
  return Response.json(out, { status: 201 });
});
