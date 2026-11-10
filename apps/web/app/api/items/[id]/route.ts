import { getItem, updateItem } from "@workspace/core";
import { getDb } from "@/lib/db";
import { env } from "@/lib/env";
import { api, body } from "@/lib/http";

type Ctx = { params: Promise<{ id: string }> };

export const GET = api<Ctx>(async (_req, { params }) => getItem(getDb(), (await params).id));

export const PATCH = api<Ctx>(async (req, { params }) => {
  const actor = req.headers.get("x-workspace-actor") ?? "user";
  return { item: await updateItem({ db: getDb(), tz: env.tz, actor }, (await params).id, (await body(req)) as never) };
});
