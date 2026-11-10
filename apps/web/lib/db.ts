import "server-only";
import { schema, type WorkspaceDb } from "@workspace/core";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "./env";

// One pool per server instance; reused across hot reloads in dev.
const g = globalThis as unknown as { __workspaceSql?: ReturnType<typeof postgres> };

export function getDb(): WorkspaceDb {
  // prepare:false — Supabase's transaction pooler (port 6543) doesn't support prepared statements.
  g.__workspaceSql ??= postgres(env.databaseUrl, { prepare: false, max: 5 });
  return drizzle(g.__workspaceSql, { schema }) as unknown as WorkspaceDb;
}
