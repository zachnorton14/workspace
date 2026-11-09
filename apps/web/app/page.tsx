import { listCourses, listItems, todaySummary, type Bucket, type Item } from "@hub/core";
import { ItemRow, type RowItem } from "@/components/ItemRow";
import { getDb } from "@/lib/db";
import { env } from "@/lib/env";
import { formatDue, kindLabel } from "@/lib/format";
import { quickAdd } from "./actions";

export const dynamic = "force-dynamic";

const SECTIONS: [Bucket, string][] = [
  ["overdue", "Overdue"], ["today", "Today"], ["tomorrow", "Tomorrow"],
  ["this_week", "This week"], ["later", "Later"], ["no_date", "No date"],
];

export default async function Today() {
  const db = getDb();
  const now = new Date();
  const [summary, inbox, courses] = await Promise.all([
    todaySummary(db, env.tz, now),
    listItems(db, { status: ["inbox"], limit: 50 }),
    listCourses(db),
  ]);
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

      {Object.values(summary.groups).every((l) => l.length === 0) && inbox.length === 0 && (
        <div className="card empty">Nothing on your list yet. Add something above.</div>
      )}
    </main>
  );
}
