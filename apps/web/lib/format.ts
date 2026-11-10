import { bucketFor, type Item } from "@workspace/core";

const KIND_LABEL: Record<string, string> = {
  task: "", reply: "Reply", assignment: "Assignment", exam: "Exam", project: "Project",
  reading: "Reading", chore: "Chore", event: "Event",
};
export const kindLabel = (k: string) => KIND_LABEL[k] ?? k;

export function formatDue(item: Pick<Item, "dueAt" | "dueAllDay" | "status" | "priority" | "progressPct" | "kind">, now: Date, tz: string) {
  if (!item.dueAt) return null;
  const b = bucketFor(item, now, tz);
  const time = item.dueAllDay ? "" : new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(item.dueAt);
  const day =
    b === "today" ? "Today"
    : b === "tomorrow" ? "Tomorrow"
    : new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric" }).format(item.dueAt);
  return { text: [day, time].filter(Boolean).join(" "), overdue: b === "overdue" };
}
