"use server";
import { approveAction, completeItem, quickAddItem, rejectAction, reportProgress, undoAction, updateItem } from "@workspace/core";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { SESSION_COOKIE, bearerOk, safeEqual, sessionValue } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { env } from "@/lib/env";
import { runTriage } from "@/lib/triage";

const userCtx = () => ({ db: getDb(), tz: env.tz, actor: "user" });

async function assertSession() {
  const c = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!c || !safeEqual(c, await sessionValue())) throw new Error("unauthorized");
}

export async function login(_: unknown, form: FormData) {
  if (!bearerOk(String(form.get("token") ?? ""))) return { error: "Wrong token" };
  (await cookies()).set(SESSION_COOKIE, await sessionValue(), {
    httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 180,
  });
  redirect("/");
}

export async function quickAdd(form: FormData) {
  await assertSession();
  const text = String(form.get("text") ?? "").trim();
  if (text) await quickAddItem(userCtx(), text);
  revalidatePath("/");
}

export async function toggleDone(id: string, done: boolean) {
  await assertSession();
  if (done) await completeItem(userCtx(), id);
  else await updateItem(userCtx(), id, { status: "todo" });
  revalidatePath("/");
}

export async function setStatus(id: string, status: "inbox" | "todo" | "doing" | "blocked" | "done" | "dismissed") {
  await assertSession();
  await updateItem(userCtx(), id, { status });
  revalidatePath("/");
  revalidatePath(`/items/${id}`);
}

export async function addNote(id: string, form: FormData) {
  await assertSession();
  const message = String(form.get("message") ?? "").trim();
  const pct = String(form.get("progressPct") ?? "");
  const nextStep = String(form.get("nextStep") ?? "").trim();
  if (!message) return;
  await reportProgress({ db: getDb(), tz: env.tz }, {
    itemId: id, actor: "user", message,
    progressPct: pct ? Number(pct) : undefined,
    nextStep: nextStep || undefined,
  });
  revalidatePath(`/items/${id}`);
}

export async function reviewAction(id: string, op: "approve" | "reject" | "undo", form?: FormData) {
  await assertSession();
  const ctx = userCtx();
  if (op === "approve") {
    const edits: Record<string, unknown> = {};
    const title = String(form?.get("title") ?? "").trim();
    const due = String(form?.get("due") ?? "").trim();
    const replyText = String(form?.get("replyText") ?? "").trim();
    if (title) edits.title = title;
    if (due) edits.due = due;
    if (replyText) edits.replyText = replyText;
    await approveAction(ctx, id, edits);
  } else if (op === "reject") await rejectAction(ctx, id);
  else await undoAction(ctx, id);
  revalidatePath("/");
}

export async function saveReplyDraft(id: string, form: FormData) {
  await assertSession();
  await updateItem(userCtx(), id, { replyDraft: String(form.get("replyDraft") ?? "") });
  revalidatePath(`/items/${id}`);
}

export async function retryCapture(id: string) {
  await assertSession();
  await runTriage(id).catch(() => undefined); // failure is recorded on the capture and shown again
  revalidatePath("/");
}
