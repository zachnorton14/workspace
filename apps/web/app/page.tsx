import { listAgentActions, listCaptures, listCourses, listItems, todaySummary, type Bucket, type Item } from "@workspace/core";
import { ItemRow, type RowItem } from "@/components/ItemRow";
import { ReviewCard } from "@/components/ReviewCard";
import { getDb } from "@/lib/db";
import { env } from "@/lib/env";
import { formatDue, kindLabel } from "@/lib/format";
import { quickAdd, retryCapture, reviewAction } from "./actions";

export const dynamic = "force-dynamic";

const SECTIONS: [Bucket, string][] = [
  ["overdue", "Overdue"], ["today", "Today"], ["tomorrow", "Tomorrow"],
  ["this_week", "This week"], ["later", "Later"], ["no_date", "No date"],
];

export default async function Today() {
  const db = getDb();
  const now = new Date();
  const [summary, inbox, courses, proposed, recent, captures] = await Promise.all([
    todaySummary(db, env.tz, now),
    listItems(db, { status: ["inbox"], limit: 50 }),
    listCourses(db),
    listAgentActions(db, { status: ["proposed"], limit: 20 }),
    listAgentActions(db, { status: ["applied", "undone"], limit: 8 }),
    listCaptures(db, 20),
  ]);
  const failed = captures.filter((c) => c.status === "failed");
  const fmtTime = new Intl.DateTimeFormat("en-US", { timeZone: env.tz, weekday: "short", hour: "numeric", minute: "2-digit" });
  const code = new Map(courses.map((c) => [c.id, c.code ?? c.name]));
  const row = (i: Item): RowItem => ({
    id: i.id, title: i.title, priority: i.priority, progressPct: i.progressPct, status: i.status,
    nextStep: i.nextStep, kindLabel: kindLabel(i.kind),
    courseCode: i.courseId ? code.get(i.courseId) ?? null : null,
    due: formatDue(i, now, env.tz),
  });
  const dateLine = new Intl.DateTimeFormat("en-US", { timeZone: env.tz, weekday: "long", month: "long", day: "numeric" }).format(now);
  const c = summary.counts as Record<string, number>;

  return (
    <main>
      <header className="top">
        <h1>Today</h1>
        <span className="muted small">{dateLine}</span>
      </header>

      <form action={quickAdd} className="card quickadd">
        <input type="text" name="text" placeholder="Add a to-do…" aria-label="Quick add" autoComplete="off" required />
        <button className="primary">Add</button>
      </form>
      <p className="hint muted small">
        Try <code>Lab report fri 5pm #chem p1 @hw ~2h</code>
      </p>

      <div className="stats">
        {[["Overdue", c.overdue], ["Today", c.today], ["This week", (c.tomorrow ?? 0) + (c.this_week ?? 0)], ["Inbox", c.inbox]].map(([label, n]) => (
          <div key={label} className="card stat"><b>{n ?? 0}</b><span>{label}</span></div>
        ))}
      </div>

      {failed.length > 0 && (
        <section className="bucket overdue">
          <h2>Couldn't triage <span className="n">{failed.length}</span></h2>
          <ul className="log card activity">
            {failed.map((c) => (
              <li key={c.id}>
                <div>
                  <div>{c.text.length > 140 ? `${c.text.slice(0, 140)}…` : c.text}</div>
                  <div className="small muted">{c.context ?? c.source} · {c.error?.slice(0, 120)}</div>
                </div>
                <form action={retryCapture.bind(null, c.id)}><button>Retry</button></form>
              </li>
            ))}
          </ul>
        </section>
      )}

      {proposed.length > 0 && (
        <section className="bucket">
          <h2>Needs review <span className="n">{proposed.length}</span></h2>
          <ul className="reviews card">
            {proposed.map(({ action: a, capture: c, itemTitle }) => {
              const p = a.payload as Record<string, string | null>;
              return (
                <ReviewCard key={a.id} a={{
                  id: a.id, type: a.type, rationale: a.rationale, confidence: a.confidence, from: c.context,
                  sourceText: c.text, url: c.url, title: p.title ?? null, due: p.due ?? p.startsAt ?? null,
                  replyText: p.replyText ?? null, itemTitle,
                }} />
              );
            })}
          </ul>
        </section>
      )}

      {inbox.length > 0 && (
        <section className="bucket">
          <h2>Inbox <span className="n">{inbox.length} to review</span></h2>
          <ul className="items card">{inbox.map((i) => <ItemRow key={i.id} item={row(i)} />)}</ul>
        </section>
      )}

      {SECTIONS.map(([b, label]) => {
        const list = summary.groups[b];
        if (!list.length) return null;
        return (
          <section key={b} className={`bucket ${b}`}>
            <h2>{label} <span className="n">{list.length}</span></h2>
            <ul className="items card">{list.map((i) => <ItemRow key={i.id} item={row(i)} />)}</ul>
          </section>
        );
      })}

      {recent.length > 0 && (
        <section className="bucket">
          <h2>Agent activity</h2>
          <ul className="log card activity">
            {recent.map(({ action: a, capture: c, itemTitle }) => (
              <li key={a.id}>
                <div className={a.status === "undone" ? "undone" : undefined}>
                  <div>{c.summary ?? a.rationale}</div>
                  <div className="small muted">
                    {itemTitle ? `${itemTitle} · ` : ""}{c.context ?? c.source} · {fmtTime.format(a.createdAt)}
                  </div>
                </div>
                {a.status === "applied" && (
                  <form action={reviewAction.bind(null, a.id, "undo")}><button>Undo</button></form>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {Object.values(summary.groups).every((l) => l.length === 0) && inbox.length === 0 && (
        <div className="card empty">Nothing on your list yet. Add something above.</div>
      )}
    </main>
  );
}
