"use client";
import { useTransition } from "react";
import { reviewAction } from "@/app/actions";

export interface ReviewItem {
  id: string;
  type: string;
  rationale: string;
  confidence: string;
  from: string | null;
  sourceText: string;
  url: string | null;
  title: string | null;
  due: string | null;
  replyText: string | null;
  itemTitle: string | null;
}

const LABEL: Record<string, string> = {
  create_task: "New task", update_task: "Update", create_event: "New event",
  draft_reply: "Reply draft", add_note: "Add note",
};

export function ReviewCard({ a }: { a: ReviewItem }) {
  const [pending, start] = useTransition();
  const editable = a.type === "create_task" || a.type === "update_task" || a.type === "create_event";
  return (
    <li className="review" style={pending ? { opacity: 0.5 } : undefined}>
      <form action={(f) => start(() => reviewAction(a.id, "approve", f))} className="review-form">
        <div className="row-meta">
          <span className="pill">{LABEL[a.type] ?? a.type}</span>
          {a.itemTitle && <span>on “{a.itemTitle}”</span>}
          <span>{a.confidence} confidence</span>
          {a.from && <span>from {a.from}</span>}
        </div>
        {editable && (
          <div className="two" style={{ marginTop: 6 }}>
            <input type="text" name="title" defaultValue={a.title ?? ""} placeholder={a.type === "update_task" ? "New title (optional)" : "Title"} aria-label="Title" />
            <input type="text" name="due" defaultValue={a.due ?? ""} placeholder="Due YYYY-MM-DD" aria-label="Due date" />
          </div>
        )}
        {a.type === "draft_reply" && <textarea name="replyText" rows={3} defaultValue={a.replyText ?? ""} aria-label="Reply text" style={{ marginTop: 6 }} />}
        <p className="small muted" style={{ margin: "6px 0" }}>{a.rationale}</p>
        <blockquote className="quote small">
          {a.sourceText.length > 280 ? `${a.sourceText.slice(0, 280)}…` : a.sourceText}
          {a.url && <> · <a href={a.url} target="_blank" rel="noreferrer">open</a></>}
        </blockquote>
        <div className="inbox-actions">
          <button className="primary" disabled={pending}>Apply</button>
          <button type="button" disabled={pending} onClick={() => start(() => reviewAction(a.id, "reject"))}>Dismiss</button>
        </div>
      </form>
    </li>
  );
}
