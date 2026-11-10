import { captureInputSchema, ingestCapture, listCaptures } from "@workspace/core";
import { after } from "next/server";
import { getDb } from "@/lib/db";
import { api, body } from "@/lib/http";
import { runTriage } from "@/lib/triage";

export const maxDuration = 60;

/** POST { text, source?, author?, context?, url?, externalRef? } — hand anything to the triage agent. */
export const POST = api(async (req) => {
  const b = (await body(req)) as Record<string, unknown>;
  const input = captureInputSchema.parse({ source: "manual", ...b });
  const { capture, created } = await ingestCapture(getDb(), input);
  if (created || capture.status === "failed") after(() => runTriage(capture.id).catch((e) => console.error("triage failed", capture.id, e)));
  return Response.json({ capture, created }, { status: created ? 202 : 200 });
});

export const GET = api(async () => ({ captures: await listCaptures(getDb()) }));
