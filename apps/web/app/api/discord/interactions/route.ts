import { ingestCapture } from "@workspace/core";
import { after } from "next/server";
import { getDb } from "@/lib/db";
import { displayName, editInteractionReply, messageText, messageUrl, verifyDiscordSignature, type DiscordMessage, type DiscordUser } from "@/lib/discord";
import { env } from "@/lib/env";
import { runTriage } from "@/lib/triage";

export const maxDuration = 60;

const PING = 1, APPLICATION_COMMAND = 2;
const PONG = 1, CHANNEL_MESSAGE = 4, DEFERRED_CHANNEL_MESSAGE = 5;
const EPHEMERAL = 64;
const MESSAGE_COMMAND = 3;

interface Interaction {
  type: number;
  token: string;
  guild_id?: string;
  context?: number; // 0 guild, 1 bot DM, 2 DM / group DM
  channel?: { id: string; name?: string | null; type: number; recipients?: DiscordUser[] };
  user?: DiscordUser;
  member?: { user: DiscordUser };
  data?: { name: string; type: number; target_id?: string; resolved?: { messages?: Record<string, DiscordMessage> } };
}

const reply = (content: string) => Response.json({ type: CHANNEL_MESSAGE, data: { content, flags: EPHEMERAL } });

function contextLabel(i: Interaction, author: string) {
  if (i.context === 0 || i.guild_id) return i.channel?.name ? `#${i.channel.name}` : "a server channel";
  if (i.channel?.name) return i.channel.name; // named group DM
  return `DM with ${author}`;
}

export async function POST(req: Request) {
  const { discord } = env;
  const raw = await req.text();
  const ok = await verifyDiscordSignature(discord.publicKey, req.headers.get("x-signature-ed25519"), req.headers.get("x-signature-timestamp"), raw);
  if (!ok) return new Response("invalid request signature", { status: 401 });

  const i = JSON.parse(raw) as Interaction;
  if (i.type === PING) return Response.json({ type: PONG });
  if (i.type !== APPLICATION_COMMAND || i.data?.type !== MESSAGE_COMMAND) return reply("Unsupported command.");

  // The app can be installed by anyone who finds it; only the owner's clicks reach Workspace.
  const clicker = i.user ?? i.member?.user;
  if (clicker?.id !== discord.ownerId) return reply("This is a private app.");

  const msg = i.data.target_id ? i.data.resolved?.messages?.[i.data.target_id] : undefined;
  if (!msg) return reply("Couldn't read that message.");
  const text = messageText(msg);
  if (!text.trim()) return reply("That message has no text to send.");

  const author = displayName(msg.author);
  const { capture, created } = await ingestCapture(getDb(), {
    source: i.context === 0 || i.guild_id ? "discord_channel" : "discord_dm",
    externalRef: msg.id,
    author,
    context: contextLabel(i, author),
    text,
    url: messageUrl(i.guild_id, msg.channel_id, msg.id),
  });
  // A repeat send is a no-op, except after a failure, where it is the natural way to retry.
  if (!created && capture.status !== "failed") {
    return reply(capture.summary ? `Already in Workspace: ${capture.summary}` : `Already sent (status: ${capture.status}).`);
  }

  after(async () => {
    let content: string;
    try {
      const r = await runTriage(capture.id);
      const pending = r.actions.filter((a) => a.status === "proposed").length;
      content = `✅ ${r.summary}${pending ? `\n${pending} suggestion${pending > 1 ? "s" : ""} waiting for your review in Workspace.` : ""}`;
    } catch (e) {
      console.error("triage failed", capture.id, e);
      content = "⚠️ Saved to Workspace, but triage failed. It will show as failed there.";
    }
    await editInteractionReply(discord.appId, i.token, content).catch((e) => console.error("discord edit failed", e));
  });
  return Response.json({ type: DEFERRED_CHANNEL_MESSAGE, data: { flags: EPHEMERAL } });
}
