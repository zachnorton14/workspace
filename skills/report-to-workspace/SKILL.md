---
name: report-to-workspace
description: Report homework, research and coding progress to the user's Workspace to-do system. Use at the start of any school, homework, research or project work session, at meaningful milestones, when blocked, and before ending the session. Also use when the user mentions a new deadline, assignment or thing to do, so it gets captured.
---

# Report to Workspace

The user keeps every to-do (assignments, research projects, replies, chores) in Workspace. You reach it through the `my-workspace` MCP server. Your report is how the user sees what happened in this terminal from their phone or laptop, so keep it accurate and short.

## Pick a name for yourself
Use one short, stable `actor` name for the whole session, based on the work, for example `chem241-hw`, `thesis-agent` or `ml-research`. Pass it on every write call.

## At the start of work
1. Call `list_items` with `search` set to a keyword from the task (course code, assignment name, project name).
2. If one item clearly matches, use its `id`. If several match, ask the user which one.
3. If none match, create one:
   - Use `create_item` with a clear title, `kind` (assignment, project, reading, exam or task), and `due` if you know it.
   - Use `list_courses` to set `courseId`.
   - For a big project, create the parent first, then subtasks with `parentId`.
4. Call `report_progress` with a one-line message such as "Started: reading the problem set". This moves the item to `doing`.

## During work
Call `report_progress` at real milestones only, never after every edit. Examples: a section drafted, tests passing, a problem solved, an experiment finished. Each call has:
- `message`: what happened, 1–3 sentences, facts only.
- `progressPct`: your honest estimate for the whole item.
- `nextStep`: the single concrete next action, for example "Write discussion for Fig. 3", not "continue".

If you are stuck on something only the user can resolve, report `status: "blocked"` and say why in `message`.

## When the session ends
Always send a final `report_progress` with the current `progressPct` and a `nextStep` that would let a fresh session pick up cold. If the work is finished, pass `status: "done"`.

## Capturing new to-dos
When the user or the material mentions a new deadline or task ("the lab writeup is due Friday", "email the TA"), capture it with `quick_add` in one line, for example `Lab writeup fri #chem @hw`. Tell the user you added it.

## Rules
- Never mark an item `done` unless the work is actually complete or the user says so.
- Never edit or complete items unrelated to your current work.
- If Workspace tools are unavailable, tell the user once and continue. Do not retry in a loop.
