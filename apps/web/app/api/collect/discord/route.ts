import { ingestCapture, schema } from "@workspace/core";
import { eq } from "drizzle-orm";
import { bearerOkFor } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { discordApi, displayName, messageText, messageUrl, type DiscordMessage } from "@/lib/discord";
import { env } from "@/lib/env";
import { runTriage } from "@/lib/triage";

export const maxDuration = 300;

type Cursors = Record<string, string>; // channel id -> last seen message id

const byId = (a: DiscordMessage, b: DiscordMessage) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1);

/**
 * Poll the watched channels for new messages. Each channel's new messages become one capture,
 * so the agent sees the conversation together. Called by the scheduler with CRON_SECRET.
 */
export async function POST(req: Request) {
  if (!bearerOkFor(req, env.cronSecret)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { botToken, watchChannels } = env.discord;
  if (!botToken || watchChannels.length === 0) return Response.json({ skipped: "no bot token or watched channels" });

  const db = getDb();
  const [state] = await db.select().from(schema.syncState).where(eq(schema.syncState.source, "discord"));
  const cursors: Cursors = { ...((state?.meta?.channels as Cursors | undefined) ?? {}) };
  const report: Record<string, string> = {};
  const errors: string[] = [];

  for (const channelId of watchChannels) {
    try {
      const last = cursors[channelId];
      if (!last) {
        // First sight of a channel: start from now instead of triaging its whole history.
        const [newest] = await discordApi<DiscordMessage[]>(`/channels/${channelId}/messages?limit=1`, { botToken });
        if (newest) cursors[channelId] = newest.id;
        report[channelId] = "cursor initialised";
        continue;
      }
      const fresh = (await discordApi<DiscordMessage[]>(`/channels/${channelId}/messages?after=${last}&limit=100`, { botToken })).sort(byId);
      if (fresh.length === 0) { report[channelId] = "no new messages"; continue; }
      cursors[channelId] = fresh.at(-1)!.id;
      const human = fresh.filter((m) => !m.author.bot && messageText(m).trim());
      if (human.length === 0) { report[channelId] = "only bot messages"; continue; }

      const channel = await discordApi<{ name?: string; guild_id?: string }>(`/channels/${channelId}`, { botToken });
      const transcript = human.map((m) => `[${m.timestamp}] ${displayName(m.author)}: ${messageText(m)}`).join("\n");
      const { capture, created } = await ingestCapture(db, {
        source: "discord_channel",
        externalRef: `${channelId}:${human.at(-1)!.id}`,
        context: channel.name ? `#${channel.name}` : `channel ${channelId}`,
        text: transcript.slice(0, 20_000),
        url: messageUrl(channel.guild_id, channelId, human[0]!.id),
      });
      if (created) {
        const r = await runTriage(capture.id);
        report[channelId] = `${human.length} messages → ${r.summary}`;
      } else report[channelId] = "already captured";
    } catch (e) {
      errors.push(`${channelId}: ${e instanceof Error ? e.message : e}`);
    }
  }

  const meta = { ...(state?.meta ?? {}), channels: cursors };
  const values = { source: "discord" as const, meta, lastRunAt: new Date(), lastError: errors.join("\n") || null };
  await db.insert(schema.syncState).values(values).onConflictDoUpdate({ target: schema.syncState.source, set: values });
  return Response.json({ report, errors });
}
