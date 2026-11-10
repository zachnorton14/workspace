# Workspace

One place for every to-do: replies, assignments, exams, research projects. Views: a desktop app (laptop), a Claude artifact (phone), and a web app (fallback). Any Claude agent can report progress to it. The full plan and build phases are in [`docs/PLAN.md`](docs/PLAN.md).

```
apps/web        Next.js on Vercel: web UI, REST API, MCP server (/api/mcp)
packages/core   Schema, migrations, service layer, quick-add parser (all logic + tests)
skills/         Claude Code skill that teaches agents to report progress
```

## Quick add syntax
`Lab report fri 5pm #chem p1 @hw ~2h`

| Token | Meaning |
|---|---|
| `today` `tmr` `fri` `next mon` `in 3 days` `nov 20` `11/20` `2026-11-20` | due date (all-day) |
| `5pm` `5:30pm` `17:30` `noon` | due time. A time with no date means today, or tomorrow if that time has passed. |
| `p1`–`p4` | priority (p1 = most urgent, same as Todoist) |
| `@hw` `@exam` `@reply` `@reading` `@project` `@chore` `@event` | kind |
| `#chem` | course (matches code or name) |
| `~2h` `~30m` | time estimate |

## Run locally
```sh
npm install
docker run -d --name workspace-pg -e POSTGRES_PASSWORD=dev -p 54329:5432 postgres:17-alpine
cp .env.example apps/web/.env.local   # DATABASE_URL=postgresql://postgres:dev@localhost:54329/postgres
DATABASE_URL_DIRECT=postgresql://postgres:dev@localhost:54329/postgres npm run db:migrate
npm run build -w @workspace/core && npm run dev   # http://localhost:3000, sign in with WORKSPACE_API_TOKEN
npm test                                    # core tests (in-memory Postgres, no Docker needed)
```

## Deploy (Supabase + Vercel)
1. **Supabase:** create a project. Copy two connection strings from Project Settings → Database: the *transaction pooler* (port 6543) for `DATABASE_URL`, and the *direct* one (port 5432) for `DATABASE_URL_DIRECT`.
2. **Migrate:** `DATABASE_URL_DIRECT=... npm run db:migrate`. All tables have row-level security on with no policies, so Supabase's public API exposes nothing.
3. **Vercel:** import the repo and set Root Directory to `apps/web`. Set the env vars `DATABASE_URL`, `WORKSPACE_API_TOKEN` (`openssl rand -hex 32`) and `WORKSPACE_TIMEZONE`.

## Connect Claude Code agents
```sh
claude mcp add --scope user --transport http workspace https://<your-app>.vercel.app/api/mcp \
  --header "Authorization: Bearer $WORKSPACE_API_TOKEN"
cp -r skills/report-to-workspace ~/.claude/skills/
```
Every Claude Code session then has the `workspace` tools, and the skill tells it when to report.

## REST API
All routes need `Authorization: Bearer <WORKSPACE_API_TOKEN>`. Agents can add `x-workspace-actor: <name>` to identify themselves.

| Method | Path | Body / query |
|---|---|---|
| GET | `/api/today` | buckets, counts, top 5 focus items |
| GET | `/api/items` | `?status=todo,doing&kind=assignment&course=<id>&q=lab&includeDone=1` |
| POST | `/api/items` | `{title, kind?, due?, priority?, courseId?, parentId?, nextStep?, ...}` |
| GET / PATCH | `/api/items/:id` | GET also returns subtasks and the activity log |
| POST | `/api/items/:id/progress` | `{actor, message, progressPct?, nextStep?, status?}` |
| POST | `/api/quick-add` | `{text}` |
