"use server";
import { completeItem, quickAddItem, reportProgress, updateItem } from "@workspace/core";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { SESSION_COOKIE, bearerOk, safeEqual, sessionValue } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { env } from "@/lib/env";

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
