import "server-only";

const API = "https://discord.com/api/v10";
const enc = new TextEncoder();

function hexBytes(hex: string): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(hex.length / 2));
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** Discord signs every interaction with Ed25519; reject anything that doesn't verify. */
export async function verifyDiscordSignature(publicKeyHex: string, signatureHex: string | null, timestamp: string | null, rawBody: string) {
  if (!signatureHex || !timestamp || !/^[0-9a-f]+$/i.test(signatureHex) || signatureHex.length !== 128) return false;
  try {
    const key = await crypto.subtle.importKey("raw", hexBytes(publicKeyHex), { name: "Ed25519" }, false, ["verify"]);
    return await crypto.subtle.verify("Ed25519", key, hexBytes(signatureHex), enc.encode(timestamp + rawBody));
  } catch {
    return false;
  }
}

export async function discordApi<T>(path: string, init: RequestInit & { botToken?: string } = {}): Promise<T> {
  const { botToken, ...rest } = init;
  const res = await fetch(`${API}${path}`, {
    ...rest,
    headers: {
      "Content-Type": "application/json",
      ...(botToken ? { Authorization: `Bot ${botToken}` } : {}),
      ...rest.headers,
    },
  });
  if (!res.ok) throw new Error(`Discord ${res.status} on ${path}: ${(await res.text()).slice(0, 200)}`);
  return (res.status === 204 ? undefined : await res.json()) as T;
}

/** Replace the "thinking…" reply of an interaction with final text (ephemeral, only you see it). */
export function editInteractionReply(appId: string, token: string, content: string) {
  return discordApi(`/webhooks/${appId}/${token}/messages/@original`, {
    method: "PATCH",
    body: JSON.stringify({ content: content.slice(0, 1900) }),
  });
}

export interface DiscordUser { id: string; username: string; global_name?: string | null; bot?: boolean }
export interface DiscordMessage {
  id: string;
  channel_id: string;
  content: string;
  timestamp: string;
  author: DiscordUser;
  attachments?: { filename: string; url: string }[];
}

export const displayName = (u: DiscordUser) => u.global_name || u.username;
export const messageUrl = (guildId: string | undefined, channelId: string, messageId: string) =>
  `https://discord.com/channels/${guildId ?? "@me"}/${channelId}/${messageId}`;

/** Message text plus attachment names, so "see attached rubric.pdf" isn't lost. */
export function messageText(m: DiscordMessage) {
  const files = (m.attachments ?? []).map((a) => `[attachment: ${a.filename}]`);
  return [m.content, ...files].filter(Boolean).join("\n");
}
