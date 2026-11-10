import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { fileURLToPath } from "node:url";
import * as schema from "../src/schema.js";
import type { WorkspaceDb } from "../src/service.js";

/** Fresh in-memory Postgres with the real migrations applied. */
export async function testDb(): Promise<WorkspaceDb> {
  const db = drizzle(new PGlite(), { schema });
  await migrate(db, { migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)) });
  return db as unknown as WorkspaceDb;
}
