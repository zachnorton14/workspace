import "server-only";
import { anthropicTriageModel, triageCapture, type TriageModel } from "@workspace/core";
import { getDb } from "./db";
import { env } from "./env";

let model: TriageModel | undefined;

/** Run triage for one capture. Errors are recorded on the capture (status "failed") and rethrown. */
export async function runTriage(captureId: string) {
  model ??= anthropicTriageModel({ apiKey: env.anthropicApiKey });
  return triageCapture({ db: getDb(), tz: env.tz, actor: "triage", now: new Date() }, captureId, model);
}
