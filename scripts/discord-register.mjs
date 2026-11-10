// Registers the "Send to Workspace" message command with Discord.
// Usage: node --env-file=.env.secrets scripts/discord-register.mjs
const { DISCORD_APP_ID: appId, DISCORD_BOT_TOKEN: token } = process.env;
if (!appId || !token) throw new Error("Set DISCORD_APP_ID and DISCORD_BOT_TOKEN in .env.secrets");

const commands = [
  {
    name: "Send to Workspace",
    type: 3, // MESSAGE: appears under right-click / long-press → Apps
    integration_types: [0, 1], // installable on servers and on your own account
    contexts: [0, 1, 2], // servers, DMs with the bot, and your DMs / group DMs
  },
];

const res = await fetch(`https://discord.com/api/v10/applications/${appId}/commands`, {
  method: "PUT", // replaces the full command list, so re-running is safe
  headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify(commands),
});
const body = await res.json();
if (!res.ok) throw new Error(`Discord ${res.status}: ${JSON.stringify(body)}`);
console.log(`Registered: ${body.map((c) => c.name).join(", ")}`);
