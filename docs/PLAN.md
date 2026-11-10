# School Hub — one place for every to-do

## Context
Today tasks are spread across Todoist, Google Calendar, email, Moodle, Discord and memory. Homework/research agents run in separate VS Code terminals with no shared view. Goal: one hub showing everything from "reply to X" to "finish research paper", with progress and next steps — on the laptop (personal desktop app), on the phone (Claude artifact), and writable by any Claude agent.

Repo: `/Users/znorton/git/workspace` (empty, `origin` = github.com/zachnorton14/workspace).

Decisions made: Vercel + Supabase backend · Tauri desktop app · artifact for phone · Todoist: one-time import, then dropped (user, mid-build) · global quick-add shortcut is a must-have · Discord via own bot · iMessage skipped for now · stack my choice (TypeScript) · Moodle access TBD.

## Architecture
```
 Gmail ─┐  GCal ─┐  Todoist (import once)  Moodle ─┐  Discord bot ─┐
        └────────┴──── collectors (Vercel routes, run by Supabase pg_cron) ──┐
                                                                               ▼
                         Supabase Postgres (single source of truth) + Realtime
                              ▲                ▲                     ▲
              Tauri desktop app      /api/mcp (MCP server)     Next.js web UI (fallback/PWA)
              (laptop, realtime)      ▲              ▲
                               phone artifact    Claude Code agents in any terminal
                            (claude.ai "mcp"     (`claude mcp add` + report-to-hub skill)
                             capability via custom connector)
```
Key point: artifacts can't call arbitrary URLs, but they **can** call claude.ai connectors. The backend's MCP endpoint is added once as a claude.ai custom connector, and the phone artifact and agents both use it.

## Repo layout (pnpm monorepo)
- `apps/web` — Next.js on Vercel: REST API, `/api/mcp`, `/api/collect/*` collector routes, web UI
- `apps/desktop` — Tauri 2 app; reuses the UI package; talks to Supabase directly (realtime) + web API
- `packages/core` — Drizzle schema, zod types, shared domain logic (dedupe, priority scoring)
- `packages/ui` — React components shared by web + desktop (Today, Inbox, Courses, Projects views)
- `supabase/` — migrations, RLS (single user), `pg_cron` + `pg_net` jobs that call collector routes (avoids Vercel Hobby's once-a-day cron limit)
- `artifact/phone.html` — phone hub published via the Artifact tool with `mcp` capability
- `skills/report-to-hub/SKILL.md` — installed to `~/.claude/skills/` so any agent can report

## Data model (`packages/core/schema.ts`)
- `items`: id, title, notes, kind (reply | assignment | exam | project | reading | chore | event), status (inbox | todo | doing | blocked | done), course_id, parent_id (subtasks), due_at, scheduled_at, est_minutes, priority, progress_pct, next_step, source, source_ref (unique per source → dedupe), source_url, updated_at
- `courses`: name, code, color, moodle_course_id
- `activity`: item_id, actor (user | agent name | collector), message, progress_pct, created_at — the agent "report" log
- `sync_state`: source, cursor / sync_token, last_run, last_error
- `inbox` = items with status `inbox` that collectors created from free text (email/Discord) and that still need one-tap accept/dismiss

## MCP server (`apps/web/app/api/mcp/route.ts`)
Streamable HTTP via `@modelcontextprotocol/sdk` (or Vercel `mcp-handler`). Tools: `list_items(filter)`, `get_item`, `create_item`, `update_item`, `complete_item`, `report_progress(item, pct, next_step, message)`, `today_summary`, `list_courses`. Auth: OAuth through Supabase Auth's OAuth server (needed for a claude.ai custom connector); bearer token for Claude Code (`claude mcp add --transport http hub <url> --header "Authorization: Bearer …"`).

## Collectors (`apps/web/app/api/collect/*`)
1. **Todoist** (one-time import): pull active tasks + projects (→ courses) once through the API, keyed by `source_ref` so re-running is safe. No ongoing sync.
2. **Google Calendar**: Calendar API incremental sync (`syncToken`) → `event` items; optional write-back of `scheduled_at` blocks.
3. **Gmail**: `history.list` since last historyId → Claude API (Haiku tier) pulls out action items ("needs reply", deadlines) → `inbox`. Load the `claude-api` skill before writing this.
4. **Moodle**: first test the school's site for a web service token (`/login/token.php?service=moodle_mobile_app`) → `mod_assign_get_assignments` + submission status; otherwise fall back to the calendar export iCal URL.
5. **Discord** (top priority, built right after deploy): own bot application (Message Content intent), added to class servers; watches **only channels the user picks**. Collector polls `GET /channels/{id}/messages` per watched channel with a stored last-message id (no always-on gateway needed on Vercel). Claude reads new messages with surrounding context and proposes **suggestions** → Inbox. Each suggestion is an **editable draft** (title, due, course, kind pre-filled; fix with a tap, then accept/dismiss) linked to the source message. When someone asks the user something, Claude also writes a **draft reply**: edit → copy → jump-link to the message in Discord to send. Limit: a bot cannot read the user's personal DMs/group DMs or servers it isn't in.

Google OAuth: own GCP project. Set the app to "In production" (unverified, personal use) so refresh tokens don't expire after 7 days.

## Surfaces
- **Quick add** (`packages/core/src/quickadd.ts`): Todoist-style one-line parsing ("Lab report fri 5pm #chem p2") shared by web, desktop and phone.
- **Desktop (Tauri)**: global quick-add shortcut (top priority), Today / Inbox / Courses / Projects / Calendar strip, global quick-add shortcut, menu-bar tray with the count due today, native notifications for upcoming deadlines, realtime via Supabase.
- **Phone artifact**: Today + Inbox + quick add + check off; uses `claude.use("mcp")` → `watchTool("list_items")` / `callTool("complete_item")`. Opens in the Claude app or browser. The web UI is a PWA fallback.
- **Agents**: the `report-to-hub` skill tells any session to find or create its item at start, call `report_progress` at milestones, and set `next_step` when stopping.

## Build phases
1. Monorepo scaffold, Supabase project + schema + RLS, core package, MCP server, minimal web UI. Deploy to Vercel.
2. Add the custom connector in claude.ai, publish the phone artifact, install the `report-to-hub` skill + `claude mcp add` globally.
3. Todoist one-time import, Google Calendar.
4. Discord bot + suggestions + reply drafts (moved up: do this right after Phase 2), then Gmail + Claude extraction, Moodle (probe the school's URL).
5. Tauri desktop app.

## Needed from you during build
Supabase + Vercel accounts, Todoist API token, Google Cloud OAuth client, Anthropic API key, Discord bot token + server/channel list, school Moodle URL, and whether school email is Gmail/Google Workspace or Outlook (Outlook would need Microsoft Graph instead).

## Verification
- Phase 1: `pnpm test` (core domain logic); MCP Inspector against `/api/mcp`: create → update → report_progress shows in the web UI live.
- Phase 2: from a separate terminal, `claude` session calls `report_progress`; the phone artifact shows it (ArtifactData/mcp check after publish).
- Phase 3: Todoist import brings in every active task (counts match); running it again creates no duplicates. A GCal event shows up as an item.
- Phase 4: send a test email / Discord message containing a deadline → it shows in Inbox; a Moodle assignment shows with its course and due date.
- Phase 5: Tauri dev build; quick-add shortcut creates an item that shows up on the phone.
