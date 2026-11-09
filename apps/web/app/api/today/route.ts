import { todaySummary } from "@hub/core";
import { getDb } from "@/lib/db";
import { env } from "@/lib/env";
import { api } from "@/lib/http";

export const GET = api(async () => todaySummary(getDb(), env.tz));
