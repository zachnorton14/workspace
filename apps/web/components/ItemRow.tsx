"use client";
import Link from "next/link";
import { useOptimistic, useTransition } from "react";
import { setStatus, toggleDone } from "@/app/actions";

export interface RowItem {
  id: string;
  title: string;
  priority: number;
  progressPct: number;
  status: string;
  nextStep: string | null;
  kindLabel: string;
  courseCode: string | null;
  due: { text: string; overdue: boolean } | null;
}

export function ItemRow({ item }: { item: RowItem }) {
  const [, start] = useTransition();
  const [done, setDone] = useOptimistic(item.status === "done");
  const inbox = item.status === "inbox";
  return (
    <li style={done ? { opacity: 0.5 } : undefined}>
      {!inbox && (
        <input
          type="checkbox"
          className={`check p${item.priority}`}
          aria-label={`Complete ${item.title}`}
          checked={done}
          onChange={(e) => {
            const v = e.target.checked;
            start(async () => { setDone(v); await toggleDone(item.id, v); });
          }}
        />
      )}
      <div className="row-main">
        <Link href={`/items/${item.id}`} className="row-title" style={done ? { textDecoration: "line-through" } : undefined}>
          {item.title}
        </Link>
        <div className="row-meta">
          {item.due && <span className={item.due.overdue ? "due-overdue" : undefined}>{item.due.text}</span>}
          {item.courseCode && <span className="pill">{item.courseCode}</span>}
          {item.kindLabel && <span>{item.kindLabel}</span>}
          {item.status === "doing" && <span>In progress</span>}
          {item.status === "blocked" && <span className="due-overdue">Blocked</span>}
        </div>
        {item.nextStep && <div className="next muted">Next: {item.nextStep}</div>}
        {item.progressPct > 0 && item.progressPct < 100 && (
          <div className="bar" aria-label={`${item.progressPct}% done`}><span style={{ width: `${item.progressPct}%` }} /></div>
        )}
      </div>
      {inbox && (
        <div className="inbox-actions">
          <button onClick={() => start(() => setStatus(item.id, "todo"))}>Keep</button>
          <button onClick={() => start(() => setStatus(item.id, "dismissed"))} aria-label="Dismiss">✕</button>
        </div>
      )}
    </li>
  );
}
