"use client";
import { useState, useTransition } from "react";
import { saveReplyDraft } from "@/app/actions";

export function ReplyDraft({ itemId, draft, url }: { itemId: string; draft: string; url: string | null }) {
  const [text, setText] = useState(draft);
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard blocked: the text is still selectable */ }
  };
  return (
    <form action={(f) => start(() => saveReplyDraft(itemId, f))} className="card form-grid">
      <textarea name="replyDraft" rows={4} value={text} onChange={(e) => setText(e.target.value)} aria-label="Reply draft" />
      <div className="inbox-actions">
        <button type="button" className="primary" onClick={copy}>{copied ? "Copied" : "Copy"}</button>
        {url && <a className="button" href={url} target="_blank" rel="noreferrer">Open in Discord</a>}
        <button disabled={pending || text === draft}>{pending ? "Saving…" : "Save edits"}</button>
      </div>
    </form>
  );
}
