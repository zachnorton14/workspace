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
1. **Supabase:** create a project. Use the *session pooler* connection string (port 5432) for both `DATABASE_URL` and `DATABASE_URL_DIRECT`. Don't use the transaction pooler (port 6543): with postgres.js, queries that wait for a busy connection there never finish.
2. **Migrate:** `DATABASE_URL_DIRECT=... npm run db:migrate`. All tables have row-level security on with no policies, so Supabase's public API exposes nothing.
3. **Vercel:** import the repo and set Root Directory to `apps/web`. Set the env vars `DATABASE_URL`, `WORKSPACE_API_TOKEN` (`openssl rand -hex 32`) and `WORKSPACE_TIMEZONE`.

## Connect Claude Code agents
```sh
claude mcp add --scope user --transport http my-workspace https://<your-app>.vercel.app/api/mcp \
  --header "Authorization: Bearer $WORKSPACE_API_TOKEN"
cp -r skills/report-to-workspace ~/.claude/skills/
```
Every Claude Code session then has the `my-workspace` tools, and the skill tells it when to report. (The server label can't be plain `workspace`: Claude Code reserves that name.)

## Triage agent
Everything that arrives without structure goes to one agent, which decides what to do:
- Discord DMs you send with **Send to Workspace**
- watched Discord channels
- `POST /api/captures`
- the `capture` MCP tool

It looks at your open items and courses, then returns up to 5 actions: `create_task`, `update_task`, `create_event`, `draft_reply`, `add_note` or `ignore`.

- **High-confidence actions apply immediately.** Each appears under **Agent activity** on the Today page with **Undo**.
- **Medium and low confidence actions wait under Needs review.** You can edit the title, date or reply before you apply them.
- **Message text is treated as data, never as instructions.** Every ID and date the model returns is validated before anything touches the database.
- **Model:** `claude-opus-5-5` at low effort, with server-side refusal fallback (`packages/core/src/triage-anthropic.ts`).

### Discord setup
1. **Create the app.** In the [Developer Portal](https://discord.com/developers/applications), create an application. Copy the Application ID and Public Key, then create a bot under **Bot** and copy its token.
2. **Turn on Message Content Intent** (on the **Bot** page), so the bot can read the channels it watches.
3. **Set the interactions URL.** Under **General Information**, set the Interactions Endpoint URL to `https://<your-app>/api/discord/interactions`. Discord sends a signed ping to check it, so set the Discord env vars on Vercel and deploy first.
4. **Install it twice.** Under **Installation**, enable **User Install** and **Guild Install** (`bot` scope, Read Messages/View Channels + Read Message History). Install it on your own account, and add it to the class servers you want watched.
5. **Register the command:** `node --env-file=.env.secrets scripts/discord-register.mjs`
6. **Schedule the channel poller:** `node --env-file=.env.secrets scripts/schedule-collectors.mjs https://<your-app>`

Bots can't read your personal DMs, and Discord bans accounts that automate a personal login. **Send to Workspace** is the supported route: right-click (long-press on mobile) any message → **Apps → Send to Workspace**.

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
| POST / GET | `/api/captures` | `{text, source?, author?, context?, url?}`: triaged in the background |
| POST | `/api/actions/:id` | `{op: "approve" \| "reject" \| "undo", edits?}` |
