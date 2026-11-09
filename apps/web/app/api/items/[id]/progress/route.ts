import { reportProgress } from "@hub/core";
import { getDb } from "@/lib/db";
import { env } from "@/lib/env";
import { api, body } from "@/lib/http";

type Ctx = { params: Promise<{ id: string }> };

/** POST { actor, message, progressPct?, nextStep?, status? } */
export const POST = api<Ctx>(async (req, { params }) => {
  const b = (await body(req)) as Record<string, unknown>;
  return reportProgress({ db: getDb(), tz: env.tz }, { ...b, itemId: (await params).id } as never);
});
