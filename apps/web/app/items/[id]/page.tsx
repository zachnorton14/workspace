import { getItem, ITEM_STATUSES, listCourses, NotFoundError } from "@hub/core";
import Link from "next/link";
import { notFound } from "next/navigation";
import { addNote, setStatus } from "@/app/actions";
import { ItemRow } from "@/components/ItemRow";
import { getDb } from "@/lib/db";
import { env } from "@/lib/env";
import { formatDue, kindLabel } from "@/lib/format";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  inbox: "Inbox", todo: "To do", doing: "Doing", blocked: "Blocked", done: "Done", dismissed: "Dismissed",
};

export default async function ItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const db = getDb();
  const detail = await getItem(db, id).catch((e) => { if (e instanceof NotFoundError) notFound(); throw e; });
  const { item, subtasks, activity } = detail;
  const courses = await listCourses(db);
  const course = courses.find((c) => c.id === item.courseId);
  const now = new Date();
  const due = formatDue(item, now, env.tz);
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: env.tz, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

  return (
    <main className="detail">
      <p className="small"><Link href="/" className="muted">← Today</Link></p>
      <h1>{item.title}</h1>
      <div className="row-meta" style={{ fontSize: 13.5 }}>
        {due && <span className={due.overdue ? "due-overdue" : undefined}>Due {due.text}</span>}
        {course && <span className="pill">{course.code ?? course.name}</span>}
        {kindLabel(item.kind) && <span>{kindLabel(item.kind)}</span>}
        <span>{item.progressPct}% done</span>
        {item.source !== "manual" && (item.sourceUrl
          ? <a href={item.sourceUrl} target="_blank" rel="noreferrer" style={{ textDecoration: "underline" }}>Open in {item.source}</a>
          : <span>From {item.source}</span>)}
      </div>
      {item.nextStep && <p className="next"><b>Next step:</b> {item.nextStep}</p>}
      {item.notes && <p style={{ whiteSpace: "pre-wrap" }}>{item.notes}</p>}

      <div className="status-row" role="group" aria-label="Status">
        {ITEM_STATUSES.map((s) => (
          <form key={s} action={setStatus.bind(null, item.id, s)}>
            <button aria-pressed={item.status === s}>{STATUS_LABEL[s]}</button>
          </form>
        ))}
      </div>

      {subtasks.length > 0 && (
        <section className="bucket">
          <h2>Subtasks <span className="n">{subtasks.filter((s) => s.status === "done").length}/{subtasks.length}</span></h2>
          <ul className="items card">
            {subtasks.map((s) => (
              <ItemRow key={s.id} item={{
                id: s.id, title: s.title, priority: s.priority, progressPct: s.progressPct, status: s.status,
                nextStep: s.nextStep, kindLabel: "", courseCode: null, due: formatDue(s, now, env.tz),
              }} />
            ))}
          </ul>
        </section>
      )}

      <section className="bucket">
        <h2>Log progress</h2>
        <form action={addNote.bind(null, item.id)} className="card form-grid">
          <textarea name="message" rows={2} placeholder="What did you do?" required />
          <div className="two">
            <input type="number" name="progressPct" min={0} max={100} placeholder="% done" defaultValue={item.progressPct || undefined} />
            <input type="text" name="nextStep" placeholder="Next step" defaultValue={item.nextStep ?? ""} />
          </div>
          <div><button className="primary">Save</button></div>
        </form>
      </section>

      <section className="bucket">
        <h2>Activity</h2>
        <ul className="log card">
          {activity.map((a) => (
            <li key={a.id}>
              <div>{a.message}</div>
              <div className="small muted">
                {a.actor} · {fmt.format(a.createdAt)}{a.progressPct !== null ? ` · ${a.progressPct}%` : ""}
              </div>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
