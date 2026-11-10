// Schedules the Discord channel poller every 10 minutes with Supabase pg_cron + pg_net.
// The CRON_SECRET goes into Supabase Vault, not into the job's SQL text.
// Usage: node --env-file=.env.secrets scripts/schedule-collectors.mjs https://<your-app>.vercel.app
import postgres from "postgres";

const base = process.argv[2];
const { DATABASE_URL_DIRECT: url, CRON_SECRET: secret } = process.env;
if (!base?.startsWith("https://")) throw new Error("Pass the app URL, e.g. https://workspace-xyz.vercel.app");
if (!url || !secret) throw new Error("Set DATABASE_URL_DIRECT and CRON_SECRET in .env.secrets");

const sql = postgres(url, { max: 1 });
try {
  await sql`create extension if not exists pg_cron`;
  await sql`create extension if not exists pg_net`;
  const [existing] = await sql`select id from vault.secrets where name = 'workspace_cron_secret'`;
  if (existing) await sql`select vault.update_secret(${existing.id}, ${secret})`;
  else await sql`select vault.create_secret(${secret}, 'workspace_cron_secret')`;

  const job = `
    select net.http_post(
      url := '${base}/api/collect/discord',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'workspace_cron_secret'),
        'Content-Type', 'application/json'),
      timeout_milliseconds := 290000)`;
  await sql`select cron.schedule('workspace-discord', '*/10 * * * *', ${job})`; // same name = replace
  console.log("Scheduled workspace-discord every 10 minutes.");
} finally {
  await sql.end();
}
