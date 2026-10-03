import { DISCLAIMER, DISCLAIMER_EN } from "./constants";
import type {
  Actor,
  AppData,
  ReportDisposition,
  ReportSnapshot,
  Review,
} from "./types";
import { assertCan, assertOrg } from "./permissions";
import { now, sourceIsCurrent } from "./utils";

export function approvalIssues(
  data: AppData,
  review: Review,
  requireScan = false,
): string[] {
  const issues: string[] = [];
  if (
    requireScan &&
    data.labelVersions
      .find((v) => v.id === review.label_version_id)
      ?.original_files.some((f) => f.scan_status !== "clean")
  )
    issues.push(
      "File gốc phải hoàn thành malware scan trước khi phê duyệt báo cáo.",
    );
  const findings = data.findings.filter((f) => f.review_id === review.id);
  if (!["HUMAN_REVIEW", "REVISION_REQUIRED"].includes(review.status))
    issues.push(
      "Báo cáo chỉ được duyệt trong giai đoạn rà soát của chuyên viên.",
    );
  if (review.pipeline.some((s) => s.status !== "complete"))
    issues.push(
      "Pipeline chưa hoàn thành; cần xử lý hoặc xác minh các bước bị lỗi.",
    );
  if (findings.some((f) => f.status === "open"))
    issues.push(
      `Còn ${findings.filter((f) => f.status === "open").length} finding chưa được xác nhận hoặc loại trừ.`,
    );
  if (
    findings.some(
      (f) => f.status !== "open" && (!f.reviewer_comment || !f.reviewed_by),
    )
  )
    issues.push("Mọi quyết định cần người rà soát và lý do.");
  const activeFindings = findings.filter((f) => f.status === "accepted");
  if (
    activeFindings.some(
      (f) =>
        ["critical", "major"].includes(f.severity) &&
        (f.citation_pending ||
          !f.citation_ids.length ||
          f.citation_ids.some(
            (id) =>
              !data.sources.some((s) => s.id === id && sourceIsCurrent(s)),
          )),
    )
  )
    issues.push(
      "Có finding quan trọng thiếu citation đã được phê duyệt và còn hiệu lực.",
    );
  if (!review.rule_snapshot || review.rule_snapshot.length < 15)
    issues.push(
      "Chưa có snapshot đầy đủ 15 quy tắc MVP. Hãy chạy lại bộ rules đã duyệt.",
    );
  for (const rule of review.rule_snapshot ?? []) {
    if (
      !data.rules.some(
        (r) =>
          r.rule_key === rule.rule_key &&
          r.version === rule.version &&
          r.status === "ACTIVE" &&
          (!r.effective_from || r.effective_from <= now().slice(0, 10)) &&
          (!r.effective_to || r.effective_to >= now().slice(0, 10)),
      )
    ) {
      issues.push(
        "Bộ rules đã thay đổi hoặc hết hiệu lực. Hãy chạy lại rà soát trước khi duyệt.",
      );
      break;
    }
    if (
      !rule.source_versions.length ||
      rule.source_versions.some((ref) => {
        const s = data.sources.find((s) => s.id === ref.id);
        return (
          !s ||
          !sourceIsCurrent(s) ||
          s.version !== ref.version ||
          s.content_hash !== ref.content_hash
        );
      })
    ) {
      issues.push(
        "Nguồn đã thay đổi, chưa duyệt hoặc hết hiệu lực từ lần review. Hãy rà soát lại.",
      );
      break;
    }
  }
  return [...new Set(issues)];
}
export function reportDisposition(
  data: AppData,
  review: Review,
): ReportDisposition {
  const findings = data.findings.filter((f) => f.review_id === review.id);
  const accepted = findings.filter((f) => f.status === "accepted");
  const missing =
    (review.missing_information?.length ?? 0) > 0 ||
    data.requests.some((r) => r.review_id === review.id && r.status === "open");
  return accepted.some((f) => ["critical", "major"].includes(f.severity))
    ? "NEEDS_CORRECTION"
    : missing
      ? "INSUFFICIENT_INFORMATION"
      : "NO_ISSUE_DETECTED_IN_SCOPE";
}

export function buildReportSnapshot(
  data: AppData,
  review: Review,
  actor: Actor,
  comment: string,
  demo: boolean,
): ReportSnapshot {
  assertCan(actor, "review");
  assertOrg(actor, review.organization_id);
  if (comment.trim().length < 10)
    throw new Error("Cần ghi chú phê duyệt ít nhất 10 ký tự.");
  const issues = approvalIssues(data, review);
  if (issues.length) throw new Error(issues.join(" "));
  const product =
    review.dossier_snapshot ??
    data.products.find((p) => p.id === review.product_id);
  const label = data.labelVersions.find(
    (v) => v.id === review.label_version_id,
  );
  if (!product || !label)
    throw new Error("Không tìm thấy hồ sơ hoặc phiên bản nhãn.");
  const findings = data.findings.filter((f) => f.review_id === review.id);
  const disposition = reportDisposition(data, review);
  const citationIds = new Set([
    ...findings.flatMap((f) => f.citation_ids),
    ...(review.rule_snapshot ?? []).flatMap((r) =>
      r.source_versions.map((s) => s.id),
    ),
  ]);
  return structuredClone({
    schema_version: "1.1",
    review_id: review.id,
    product,
    label_version: label,
    review_scope: review.review_scope,
    disposition,
    approved_by: actor.id,
    rationale: comment.trim(),
    result: disposition,
    disclaimer: `${DISCLAIMER}\n\n${DISCLAIMER_EN}`,
    findings,
    sources: data.sources.filter((s) => citationIds.has(s.id)),
    reviewer: {
      id: actor.id,
      name: actor.name,
      approved_at: now(),
      comment: comment.trim(),
    },
    version_history: data.labelVersions
      .filter((v) => v.product_id === product.id)
      .sort((a, b) => a.version - b.version)
      .map((v) => ({ version: v.version, uploaded_at: v.uploaded_at })),
    missing_information: review.missing_information,
    customer_requests: data.requests.filter((r) => r.review_id === review.id),
    rule_snapshot: review.rule_snapshot,
    generated_at: now(),
    demo,
  });
}
