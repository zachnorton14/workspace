import "server-only";
import { schema, type WorkspaceDb } from "@workspace/core";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "./env";

// One pool per server instance; reused across hot reloads in dev.
const g = globalThis as unknown as { __workspaceSql?: ReturnType<typeof postgres> };

export function getDb(): WorkspaceDb {
  // DATABASE_URL must be Supabase's *session* pooler (port 5432). Through the transaction pooler
  // (port 6543), postgres.js queries that queue behind a busy connection never complete, so any
  // request running more queries at once than `max` hangs until the function times out.
  // Session mode pins a real connection per client, so keep the pool small and release idle ones.
  g.__workspaceSql ??= postgres(env.databaseUrl, { prepare: false, max: 4, idle_timeout: 20, max_lifetime: 60 * 30 });
  return drizzle(g.__workspaceSql, { schema }) as unknown as WorkspaceDb;
}
