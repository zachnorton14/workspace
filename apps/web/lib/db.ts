import "server-only";
import { schema, type HubDb } from "@hub/core";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "./env";

// One pool per server instance; reused across hot reloads in dev.
const g = globalThis as unknown as { __hubSql?: ReturnType<typeof postgres> };

export function getDb(): HubDb {
  // prepare:false — Supabase's transaction pooler (port 6543) doesn't support prepared statements.
  g.__hubSql ??= postgres(env.databaseUrl, { prepare: false, max: 5 });
  return drizzle(g.__hubSql, { schema }) as unknown as HubDb;
}
