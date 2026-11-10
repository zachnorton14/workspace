import { createItem, itemFilterSchema, listItems } from "@workspace/core";
import { getDb } from "@/lib/db";
import { env } from "@/lib/env";
import { api, body } from "@/lib/http";

const list = (v: string | null) => (v ? v.split(",") : undefined);

/** GET /api/items?status=todo,doing&kind=assignment&course=<uuid>&q=lab&includeDone=1 */
export const GET = api(async (req) => {
  const u = new URL(req.url).searchParams;
  const filter = itemFilterSchema.parse({
    status: list(u.get("status")),
    kind: list(u.get("kind")),
    courseId: u.get("course") ?? undefined,
    search: u.get("q") ?? undefined,
    includeDone: u.get("includeDone") === "1" || undefined,
    limit: u.get("limit") ? Number(u.get("limit")) : undefined,
  });
  return { items: await listItems(getDb(), filter) };
});

export const POST = api(async (req) => {
  const actor = req.headers.get("x-workspace-actor") ?? "user";
  return Response.json({ item: await createItem({ db: getDb(), tz: env.tz, actor }, (await body(req)) as never) }, { status: 201 });
});
