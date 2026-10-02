import type {
  Actor,
  AppData,
  Finding,
  ReviewStatus,
  TriageRoute,
} from "./types";
import { SEVERITY_META } from "./constants";

export const uid = () => crypto.randomUUID();
export const now = () => new Date().toISOString();
export function initials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(-2)
    .map((x) => x[0])
    .join("")
    .toUpperCase();
}
export function formatDate(date: string, withTime = false) {
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    day: "2-digit",
    month: "2-digit",
    ...(withTime
      ? { hour: "2-digit", minute: "2-digit" }
      : { year: "numeric" }),
  }).format(new Date(date));
}
export function relativeTime(date: string) {
  const diff = Math.max(0, Date.now() - new Date(date).getTime());
  const m = Math.floor(diff / 60000);
  if (m < 1) return "Vừa xong";
  if (m < 60) return `${m} phút trước`;
  if (m < 1440) return `${Math.floor(m / 60)} giờ trước`;
  if (m < 10080) return `${Math.floor(m / 1440)} ngày trước`;
  return formatDate(date);
}
export function formatBytes(bytes: number) {
  return bytes < 1024 * 1024
    ? `${Math.round(bytes / 1024)} KB`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
export function slug(text: string) {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}
export function findingCounts(findings: Finding[]) {
  return findings
    .filter((f) => f.status !== "dismissed")
    .reduce((acc, f) => ({ ...acc, [f.severity]: acc[f.severity] + 1 }), {
      critical: 0,
      major: 0,
      minor: 0,
      information: 0,
    });
}
export function highestSeverity(findings: Finding[]) {
  return findings
    .filter((f) => f.status !== "dismissed")
    .sort(
      (a, b) =>
        SEVERITY_META[a.severity].order - SEVERITY_META[b.severity].order,
    )[0]?.severity;
}
export const isCompleted = (status: ReviewStatus) =>
  ["COMPLETED", "APPROVED_WITH_NOTES", "ARCHIVED"].includes(status);
export const needsAction = (
  status: ReviewStatus,
  triageRoute?: TriageRoute,
) =>
  triageRoute === "AUTO_SCREENED" && status === "AI_REVIEW_READY"
    ? false
    : [
        "HUMAN_REVIEW",
        "AI_REVIEW_READY",
        "REVISION_REQUIRED",
        "MANUAL_ESCALATION_REQUIRED",
        "PROCESSING_FAILED",
        "MODEL_FAILED",
        "SOURCE_UNAVAILABLE",
      ].includes(status);
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
export function downloadJson(data: unknown, filename: string) {
  downloadBlob(
    new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
    filename,
  );
}
export function downloadCsv(rows: string[][], filename: string) {
  // Protect spreadsheets from formula injection in customer-controlled strings.
  const safe = (s: string) =>
    /^[\s\uFEFF]*[=+\-@]|^[\t\r]/.test(s) ? `'${s}` : s;
  const csv = rows
    .map((row) => row.map((s) => `"${safe(s).replace(/"/g, '""')}"`).join(","))
    .join("\r\n");
  downloadBlob(
    new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8;" }),
    filename,
  );
}
export function errorMessage(err: unknown) {
  return err instanceof Error
    ? err.message
    : "Có lỗi xảy ra. Vui lòng thử lại.";
}
export async function sha256(data: ArrayBuffer | string) {
  const bytes =
    typeof data === "string" ? new TextEncoder().encode(data) : data;
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
export function sourceIsCurrent(
  source: {
    status: string;
    effective_from: string | null;
    effective_to: string | null;
    content_hash?: string | null;
    raw_snapshot_id?: string | null;
    raw_content_hash?: string | null;
    ingestion_status?: string | null;
    issue_date?: string | null;
  },
  at = new Date(),
) {
  const d = at.toISOString().slice(0, 10);
  return (
    source.status === "CURRENT" &&
    (!source.raw_snapshot_id ||
      (source.ingestion_status === "ACTIVE" &&
        !!source.raw_content_hash &&
        !!source.issue_date &&
        source.issue_date <= d)) &&
    !!source.content_hash &&
    (!source.effective_from || source.effective_from <= d) &&
    (!source.effective_to || source.effective_to >= d)
  );
}
export function safeExternalUrl(url: string) {
  try {
    const u = new URL(url);
    return u.protocol === "https:" ? u.href : null;
  } catch {
    return null;
  }
}

export function assigneeName(
  data: AppData,
  assignedId: string | null | undefined,
  actor?: Actor,
) {
  if (!assignedId) return "Chưa phân công";
  return (
    data.staff?.find((s) => s.id === assignedId)?.name ??
    (actor?.id === assignedId ? actor.name : undefined) ??
    data.audit.find((a) => a.actor_id === assignedId)?.actor_name ??
    data.reports.find((r) => r.snapshot.reviewer.id === assignedId)?.snapshot
      .reviewer.name ??
    "Chuyên viên Vexim"
  );
}
