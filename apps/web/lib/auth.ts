import { env } from "./env";

export const SESSION_COOKIE = "workspace_session";

const enc = new TextEncoder();

/** Constant-time string compare (Web Crypto–safe, works in proxy and route handlers). */
export function safeEqual(a: string, b: string): boolean {
  const x = enc.encode(a), y = enc.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

/** Cookie value = HMAC(token, label): proves the browser once knew the token without storing it. */
export async function sessionValue(): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(env.apiToken), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode("workspace-session-v1"));
  return Buffer.from(sig).toString("hex");
}

export function bearerOk(token: string | undefined | null): boolean {
  return !!token && safeEqual(token, env.apiToken);
}

/** API routes accept either `Authorization: Bearer <WORKSPACE_API_TOKEN>` or the web UI session cookie. */
export async function requestAuthorized(req: Request): Promise<boolean> {
  const h = req.headers.get("authorization");
  if (h?.startsWith("Bearer ") && bearerOk(h.slice(7))) return true;
  const cookie = req.headers.get("cookie")?.match(new RegExp(`(?:^|; )${SESSION_COOKIE}=([^;]+)`))?.[1];
  return !!cookie && safeEqual(cookie, await sessionValue());
}
