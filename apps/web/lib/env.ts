function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var ${name} — see .env.example`);
  return v;
}

export const env = {
  get databaseUrl() { return required("DATABASE_URL"); },
  get apiToken() { return required("WORKSPACE_API_TOKEN"); },
  get anthropicApiKey() { return required("ANTHROPIC_API_KEY"); },
  /** Shared secret the scheduler sends to /api/collect/* routes. */
  get cronSecret() { return required("CRON_SECRET"); },
  get discord() {
    return {
      publicKey: required("DISCORD_PUBLIC_KEY"),
      appId: required("DISCORD_APP_ID"),
      botToken: process.env.DISCORD_BOT_TOKEN ?? "",
      /** Your Discord user id: only your clicks on "Send to Workspace" are accepted. */
      ownerId: required("DISCORD_OWNER_ID"),
      watchChannels: (process.env.DISCORD_WATCH_CHANNELS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    };
  },
  get tz() { return process.env.WORKSPACE_TIMEZONE || "America/New_York"; },
};
