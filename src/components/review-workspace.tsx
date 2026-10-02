"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Check,
  CheckCheck,
  ChevronRight,
  CircleAlert,
  Clock3,
  Columns2,
  FileCheck2,
  FileText,
  Info,
  ListChecks,
  Loader2,
  MessageSquarePlus,
  Pencil,
  Plus,
  RefreshCw,
  ScanLine,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import { useApp } from "./app-provider";
import {
  Avatar,
  Badge,
  Button,
  Card,
  Checkbox,
  EmptyState,
  IconButton,
  InlineNotice,
  Input,
  Modal,
  ProgressBar,
  Select,
  SeverityBadge,
  StatusBadge,
  Textarea,
} from "./ui";
import { LabelViewer } from "./label-viewer";
import type {
  Evidence,
  ExtractedField,
  Finding,
  LabelVersion,
  PipelineStep,
  Review,
  Severity,
} from "@/lib/types";
import {
  DISCLAIMER,
  EXPERT_REVIEW_STATUS_LABELS,
  FINDING_STATUS_LABELS,
  PIPELINE_LABELS,
  SEVERITY_META,
  TRIAGE_REPORT_STATUS_LABELS,
  TRIAGE_RESULT_LABELS,
  TRIAGE_ROUTE_META,
} from "@/lib/constants";
import { can } from "@/lib/permissions";
import {
  assigneeName,
  downloadJson,
  errorMessage,
  findingCounts,
  formatDate,
  now,
  sourceIsCurrent,
  uid,
} from "@/lib/utils";
import { approvalIssues } from "@/lib/reports";
import { PRE_SCREENING_DISCLAIMER } from "@/lib/triage";

const fieldLabels: Record<string, string> = {
  statement_of_identity: "Tên gọi thực phẩm",
  net_quantity: "Khối lượng tịnh",
  ingredient_list: "Danh sách nguyên liệu",
  nutrition_facts: "Nutrition Facts",
  allergen_statement: "Khai báo dị nguyên",
  responsible_party: "Đơn vị chịu trách nhiệm",
  claim: "Claim",
  country_of_origin: "Country of origin",
  caffeine_statement: "Thông tin caffeine",
  storage_instruction: "Hướng dẫn bảo quản",
  use_instruction: "Hướng dẫn sử dụng",
  english_required_information: "Thông tin bằng tiếng Anh",
};
export function ReviewWorkspace({ reviewId }: { reviewId: string }) {
  const app = useApp();
  const review = app.data.reviews.find((r) => r.id === reviewId);
  const [selectedId, setSelectedId] = useState("");
  const [severity, setSeverity] = useState("all");
  const [status, setStatus] = useState("all");
  const [evidenceIndex, setEvidenceIndex] = useState(0);
  const [requestOpen, setRequestOpen] = useState(false);
  const [approveOpen, setApproveOpen] = useState(false);
  const [selectionEnabled, setSelectionEnabled] = useState(false);
  const [manualEvidence, setManualEvidence] = useState<Evidence | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  const [fieldsOpen, setFieldsOpen] = useState(false);
  const [rerunOpen, setRerunOpen] = useState(false);
  const [revisionOpen, setRevisionOpen] = useState(false);
  const [revisionReason, setRevisionReason] = useState("");
  const [busy, setBusy] = useState(false);
  const findings = app.data.findings
    .filter((f) => f.review_id === reviewId)
    .sort(
      (a, b) =>
        SEVERITY_META[a.severity].order - SEVERITY_META[b.severity].order,
    );
  useEffect(() => {
    if (!selectedId || !findings.some((f) => f.id === selectedId))
      setSelectedId(findings[0]?.id ?? "");
  }, [findings, selectedId]);
  if (!review)
    return (
      <Card>
        <EmptyState
          title="Không tìm thấy review"
          description="Review không tồn tại hoặc bạn không có quyền truy cập tổ chức này."
          action={
            <Link className="btn btn-secondary" href="/reviews">
              Về danh sách
            </Link>
          }
        />
      </Card>
    );
  const product =
    review.dossier_snapshot ??
    app.data.products.find((p) => p.id === review.product_id)!;
  const label = app.data.labelVersions.find(
    (v) => v.id === review.label_version_id,
  )!;
  if (!product || !label)
    return (
      <Card>
        <EmptyState
          title="Dữ liệu hồ sơ chưa đầy đủ"
          description="Vui lòng tải lại workspace hoặc liên hệ quản trị hệ thống."
        />
      </Card>
    );
  const preScreeningReport = app.data.preScreeningReports
    ?.filter((report) => report.review_id === review.id)
    .sort((a, b) => b.version - a.version)[0];
  const counts = findingCounts(findings);
  const selected = findings.find((f) => f.id === selectedId);
  const filtered = findings.filter(
    (f) =>
      (severity === "all" || severity === f.severity) &&
      (status === "all" || status === f.status),
  );
  const evidence = selected?.evidence[evidenceIndex] ?? selected?.evidence[0];
  const editable =
    can(app.actor, "review") &&
    !["COMPLETED", "APPROVED_WITH_NOTES", "ARCHIVED", "PROCESSING"].includes(
      review.status,
    );
  const versions = app.data.labelVersions
    .filter((v) => v.product_id === product.id)
    .sort((a, b) => b.version - a.version);
  const processing = [
    "PROCESSING",
    "INPUT_VALIDATION",
    "PROCESSING_FAILED",
    "MODEL_FAILED",
  ].includes(review.status);
  const approve = () => setApproveOpen(true);
  const revision = async () => {
    setBusy(true);
    try {
      await app.transitionReview(
        review.id,
        "REVISION_REQUIRED",
        revisionReason,
      );
      setRevisionOpen(false);
      app.notify("Đã đánh dấu cần chỉnh sửa nhãn.");
    } catch (e) {
      app.notify(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="page review-page">
      <div className="review-header">
        <div>
          <Link href={`/products/${product.id}`} className="back-link">
            <ArrowLeft size={13} /> Hồ sơ sản phẩm
          </Link>
          <h1>{product.name}</h1>
          <div className="review-subtitle">
            <span>
              {
                app.data.organizations.find(
                  (o) => o.id === product.organization_id,
                )?.name
              }
            </span>
            <span>·</span>
            <span>Nhãn v{label.version}</span>
            <span>·</span>
            <span>US federal food labeling</span>
            <span>·</span>
            <span title="Người phụ trách">
              {assigneeName(app.data, review.assigned_to, app.actor)}
            </span>
            <StatusBadge status={review.status} />
          </div>
        </div>
        <div className="review-header-actions">
          {can(app.actor, "review") &&
            !review.assigned_to &&
            !["COMPLETED", "APPROVED_WITH_NOTES", "ARCHIVED"].includes(
              review.status,
            ) && (
              <Button
                variant="secondary"
                onClick={() =>
                  void app
                    .assignReview(review.id)
                    .then(() => app.notify("Đã nhận phụ trách hồ sơ."))
                    .catch((e) => app.notify(errorMessage(e), "error"))
                }
              >
                <Check size={14} /> Nhận phụ trách
              </Button>
            )}
          <Button
            variant="secondary"
            onClick={() => setCompareOpen(true)}
            disabled={versions.length < 2}
          >
            <Columns2 size={14} /> So sánh phiên bản
          </Button>
          {editable && (
            <Button variant="secondary" onClick={() => setRequestOpen(true)}>
              <MessageSquarePlus size={14} /> Yêu cầu bổ sung
            </Button>
          )}
          {can(app.actor, "review") && review.status === "AI_REVIEW_READY" && (
            <Button
              variant="secondary"
              onClick={() =>
                void app
                  .transitionReview(
                    review.id,
                    "HUMAN_REVIEW",
                    "Chuyển sang rà soát chuyên viên trước khi cân nhắc báo cáo cuối.",
                  )
                  .then(() => app.notify("Đã chuyển sang rà soát chuyên viên."))
                  .catch((e) => app.notify(errorMessage(e), "error"))
              }
            >
              <ShieldCheck size={14} /> Chuyển sang rà soát chuyên viên
            </Button>
          )}
          {can(app.actor, "review") && (
            <Button
              onClick={approve}
              disabled={
                processing ||
                !["HUMAN_REVIEW", "REVISION_REQUIRED"].includes(
                  review.status,
                ) ||
                ["COMPLETED", "ARCHIVED", "APPROVED_WITH_NOTES"].includes(
                  review.status,
                )
              }
            >
              <FileCheck2 size={15} /> Phê duyệt báo cáo
            </Button>
          )}
          {review.status === "COMPLETED" && (
            <Link
              href={`/reports?review=${review.id}`}
              className="btn btn-primary"
            >
              <FileText size={15} /> Xem báo cáo
            </Link>
          )}
        </div>
      </div>
      {review.status === "SOURCE_UNAVAILABLE" && (
        <div style={{ marginBottom: 16 }}>
          <InlineNotice tone="warning">
            {review.error_message ??
              "Nguồn hoặc bộ rules chưa đủ để xác định kết quả."}{" "}
            <Link href="/sources" className="text-button">
              Xem source registry
            </Link>
          </InlineNotice>
        </div>
      )}
      {review.triage_route && review.triage_evaluated_at && (
        <Card style={{ marginBottom: 16, padding: 16 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <div>
              <div className="tiny muted">TRIAGE · {review.triage_policy_version}</div>
              <h3 style={{ margin: "5px 0 8px" }}>Phân luồng hồ sơ</h3>
              <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
                <Badge tone={TRIAGE_ROUTE_META[review.triage_route].tone}>
                  {TRIAGE_ROUTE_META[review.triage_route].label}
                </Badge>
                {review.overall_result && (
                  <Badge tone="neutral">
                    {TRIAGE_RESULT_LABELS[review.overall_result]}
                  </Badge>
                )}
              </div>
            </div>
            <div className="tiny muted" style={{ textAlign: "right" }}>
              Rủi ro {review.triage_risk_score ?? 0}/100
              <br />
              Chuyên gia: {review.expert_review_status
                ? EXPERT_REVIEW_STATUS_LABELS[review.expert_review_status]
                : "Chưa ghi nhận"}
              <br />
              Artifact: {review.report_status
                ? TRIAGE_REPORT_STATUS_LABELS[review.report_status]
                : "Chưa ghi nhận"}
            </div>
          </div>
          {review.triage_route === "AUTO_SCREENED" && (
            <div style={{ marginTop: 12 }}>
              <InlineNotice tone={preScreeningReport ? "info" : "warning"}>
                AUTO_SCREENED là route phân luồng, không phải kết luận tuân thủ.
                {preScreeningReport
                  ? ` Artifact riêng có disclaimer profile ${preScreeningReport.disclaimer_profile}.`
                  : " Hiện chưa phát hành artifact vì cờ pre-screening đang tắt hoặc tổ chức chưa được allowlist."}
              </InlineNotice>
            </div>
          )}
          {!!review.triage_reasons?.length && (
            <ul className="validation-list" style={{ marginTop: 12 }}>
              {review.triage_reasons.map((reason, index) => (
                <li key={`${reason.code}-${reason.source_id ?? index}`}>
                  {reason.message}
                  {reason.rule_key ? ` · ${reason.rule_key}` : ""}
                </li>
              ))}
            </ul>
          )}
          {preScreeningReport && (
            <div style={{ marginTop: 12 }}>
              <InlineNotice tone="info">
                <strong>Artifact sàng lọc sơ bộ · v{preScreeningReport.version}</strong>
                <div style={{ marginTop: 5 }}>{PRE_SCREENING_DISCLAIMER.vi}</div>
              </InlineNotice>
              <Button
                variant="secondary"
                style={{ marginTop: 10 }}
                onClick={() =>
                  downloadJson(
                    preScreeningReport.snapshot,
                    `pre-screening-${review.id}-v${preScreeningReport.version}.json`,
                  )
                }
              >
                <FileText size={14} /> Tải artifact JSON
              </Button>
            </div>
          )}
        </Card>
      )}
      {!processing && (
        <div className="review-summary-strip">
          <div>
            <span className="tiny muted" style={{ marginRight: 3 }}>
              {findings.length} finding
            </span>
            {Object.entries(counts)
              .filter(([, n]) => n > 0)
              .map(([key, n]) => (
                <SeverityBadge key={key} severity={key as Severity} count={n} />
              ))}
            {!findings.length && (
              <Badge tone="green">
                Chưa ghi nhận finding · cần chuyên viên xác nhận
              </Badge>
            )}
          </div>
          <span>
            <ShieldCheck size={13} /> Evidence → Rule → Citation → Chuyên viên
          </span>
        </div>
      )}
      {processing ? (
        <PipelinePanel review={review} onRerun={() => setRerunOpen(true)} />
      ) : (
        <div className="review-workspace">
          <section className="review-pane label-pane">
            <div className="pane-header">
              <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                <FileText size={15} color="#9bb681" />
                <h2>Phiên bản nhãn v{label.version}</h2>
              </div>
              <button
                className="text-button"
                style={{ fontSize: 11 }}
                onClick={() => setFieldsOpen(true)}
              >
                <ScanLine size={13} /> Extraction
              </button>
              {editable && (
                <button
                  className="text-button"
                  onClick={() => setSelectionEnabled((v) => !v)}
                >
                  <ScanLine size={13} />
                  {selectionEnabled ? "Hủy chọn vùng" : "Chọn vùng evidence"}
                </button>
              )}
            </div>
            <LabelViewer
              selectionEnabled={editable && selectionEnabled}
              onSelectRegion={(ev) => {
                setManualEvidence(ev);
                setSelectionEnabled(false);
                setManualOpen(true);
              }}
              label={label}
              evidence={evidence}
              severity={selected?.severity}
            />
          </section>
          <section className="review-pane findings-pane">
            <div className="pane-header">
              <h2>
                Phát hiện cần rà soát{" "}
                <span className="tiny muted">({findings.length})</span>
              </h2>
              <IconButton
                label="Xem / sửa dữ liệu trích xuất"
                onClick={() => setFieldsOpen(true)}
              >
                <ListChecks size={16} />
              </IconButton>
            </div>
            <div className="finding-filter-row">
              {[
                ["all", `Tất cả ${findings.length}`],
                ["critical", `Nghiêm trọng ${counts.critical}`],
                ["major", `Cần sửa ${counts.major}`],
                ["minor", `Cải thiện ${counts.minor}`],
              ].map(([key, text]) => (
                <button
                  key={key}
                  className={clsx(severity === key && "active")}
                  onClick={() => setSeverity(key)}
                >
                  {text}
                </button>
              ))}
              <div style={{ width: "100%", marginTop: 4 }}>
                <Select
                  aria-label="Lọc trạng thái finding"
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                  style={{ fontSize: 11, padding: "7px 10px", minHeight: 30 }}
                >
                  <option value="all">Tất cả quyết định</option>
                  <option value="open">Chưa xử lý</option>
                  <option value="accepted">Đã xác nhận</option>
                  <option value="dismissed">Đã loại trừ</option>
                </Select>
              </div>
            </div>
            <div className="findings-list">
              {filtered.map((f) => (
                <button
                  key={f.id}
                  className={clsx(
                    "finding-list-item",
                    f.status,
                    selectedId === f.id && "selected",
                  )}
                  onClick={() => {
                    setSelectedId(f.id);
                    setEvidenceIndex(0);
                  }}
                >
                  <div className="finding-list-item-top">
                    <SeverityBadge severity={f.severity} />
                    <span>{f.rule_key}</span>
                  </div>
                  <h3>{f.title}</h3>
                  <p>{f.description}</p>
                  <div className="finding-list-item-bottom">
                    <span>
                      {f.status === "accepted" ? (
                        <CheckCheck size={12} />
                      ) : f.status === "dismissed" ? (
                        <X size={12} />
                      ) : (
                        <Clock3 size={12} />
                      )}
                      {FINDING_STATUS_LABELS[f.status]}
                    </span>
                    <span>
                      {f.ai_confidence !== null
                        ? `${Math.round(f.ai_confidence * 100)}%`
                        : "Thủ công"}
                      <ChevronRight size={12} />
                    </span>
                  </div>
                </button>
              ))}
              {!filtered.length && (
                <EmptyState
                  title={
                    findings.length
                      ? "Không có finding phù hợp"
                      : "Chưa ghi nhận finding"
                  }
                  description={
                    findings.length
                      ? "Thử mức độ hoặc trạng thái khác."
                      : "Kết quả vẫn cần chuyên viên xác nhận phạm vi, độ đầy đủ và nguồn trước khi báo cáo."
                  }
                  icon={<FileCheck2 size={25} />}
                />
              )}
            </div>
            <div className="findings-footer">
              {editable ? (
                <Button
                  variant="secondary"
                  onClick={() => {
                    setManualEvidence(null);
                    setManualOpen(true);
                  }}
                >
                  <Plus size={14} /> Thêm finding thủ công
                </Button>
              ) : (
                <span className="tiny muted">
                  {can(app.actor, "review")
                    ? "Review đã đóng · dữ liệu chỉ đọc"
                    : "Chỉ chuyên viên Vexim được xác nhận finding"}
                </span>
              )}
            </div>
          </section>
          <section className="review-pane details-pane">
            <div className="pane-header">
              <h2>Chi tiết phát hiện</h2>
              {selected && (
                <Badge>
                  {selected.reasoning_category === "manual"
                    ? "Thủ công"
                    : "AI / Rules"}
                </Badge>
              )}
            </div>
            {selected ? (
              <FindingDetail
                key={selected.id}
                finding={selected}
                review={review}
                editable={editable}
                evidenceIndex={evidenceIndex}
                onEvidence={setEvidenceIndex}
              />
            ) : (
              <EmptyState
                title="Mỗi quyết định cần một căn cứ"
                description="Chọn finding để xem evidence, rule và citation; hoặc thêm phát hiện thủ công sau khi đối chiếu nhãn."
                icon={<BookOpen size={28} />}
              />
            )}
          </section>
        </div>
      )}
      {!processing && (
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
            marginTop: 15,
            flexWrap: "wrap",
          }}
        >
          <div
            className="tiny muted"
            style={{ display: "flex", alignItems: "center", gap: 6 }}
          >
            <Info size={12} /> Rà soát sơ bộ. Không phải phê duyệt của FDA.
          </div>
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            {editable && (
              <button
                className="text-button"
                style={{ fontSize: 11 }}
                onClick={() => setRerunOpen(true)}
              >
                <RefreshCw size={12} /> Chạy lại kiểm tra
              </button>
            )}
            {editable && review.status === "HUMAN_REVIEW" && (
              <button
                className="text-button"
                style={{ fontSize: 11 }}
                onClick={() => setRevisionOpen(true)}
              >
                Yêu cầu chỉnh sửa <ArrowRight size={12} />
              </button>
            )}
          </div>
        </div>
      )}
      {review.missing_information?.length ? (
        <div style={{ marginTop: 15 }}>
          <InlineNotice tone="warning">
            <strong>Các điểm cần chuyên viên làm rõ</strong>
            <ul className="validation-list">
              {review.missing_information.map((m, i) => (
                <li key={i}>{m}</li>
              ))}
            </ul>
          </InlineNotice>
        </div>
      ) : null}
      <RequestModal
        review={review}
        open={requestOpen}
        onClose={() => setRequestOpen(false)}
      />
      <ApprovalModal
        review={review}
        open={approveOpen}
        onClose={() => setApproveOpen(false)}
      />
      <ManualFindingModal
        review={review}
        label={label}
        evidence={manualEvidence ?? evidence}
        open={manualOpen}
        onClose={() => setManualOpen(false)}
      />
      <CompareModal
        current={label}
        versions={versions}
        open={compareOpen}
        onClose={() => setCompareOpen(false)}
      />
      <ExtractionModal
        label={label}
        review={review}
        editable={editable}
        open={fieldsOpen}
        onClose={() => setFieldsOpen(false)}
      />
      <RerunModal
        review={review}
        open={rerunOpen}
        onClose={() => setRerunOpen(false)}
      />
      <Modal
        open={revisionOpen}
        onClose={() => setRevisionOpen(false)}
        title="Yêu cầu chỉnh sửa nhãn"
        description="Khách hàng sẽ thấy trạng thái cần chỉnh sửa và có thể tải phiên bản mới."
        footer={
          <>
            <Button variant="secondary" onClick={() => setRevisionOpen(false)}>
              Hủy
            </Button>
            <Button
              loading={busy}
              onClick={() => void revision()}
              disabled={revisionReason.trim().length < 5}
            >
              Xác nhận yêu cầu
            </Button>
          </>
        }
      >
        <Textarea
          label="Lý do yêu cầu chỉnh sửa"
          value={revisionReason}
          onChange={(e) => setRevisionReason(e.target.value)}
          placeholder="Tóm tắt các lỗi cần sửa trước khi in / xuất khẩu…"
        />
      </Modal>
    </div>
  );
}
function FindingDetail({
  finding: f,
  review,
  editable,
  evidenceIndex,
  onEvidence,
}: {
  finding: Finding;
  review: Review;
  editable: boolean;
  evidenceIndex: number;
  onEvidence: (index: number) => void;
}) {
  const app = useApp();
  const [comment, setComment] = useState(f.reviewer_comment ?? "");
  const [severity, setSeverity] = useState(f.severity);
  const [busy, setBusy] = useState(false);
  const [citationOpen, setCitationOpen] = useState(false);
  const [citations, setCitations] = useState(f.citation_ids);
  const [citationReason, setCitationReason] = useState("");
  const decide = async (status: Finding["status"]) => {
    setBusy(true);
    try {
      await app.patchFinding(f.id, {
        severity,
        status,
        reviewer_comment: comment,
      });
      app.notify(
        status === "dismissed"
          ? "Đã loại trừ finding, lý do được ghi vào audit log."
          : "Đã xác nhận finding.",
      );
    } catch (e) {
      app.notify(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  };
  const saveCitation = async () => {
    setBusy(true);
    try {
      await app.patchFinding(f.id, {
        severity: f.severity,
        status: f.status,
        reviewer_comment: citationReason,
        citation_ids: citations,
      });
      setCitationOpen(false);
      app.notify("Đã gắn citation từ registry.");
    } catch (e) {
      app.notify(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <div className="finding-detail-scroll">
        <div className="finding-detail-section">
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 8,
              alignItems: "center",
              marginBottom: 12,
            }}
          >
            <SeverityBadge severity={f.severity} />
            <span className="tiny muted" style={{ fontSize: 7 }}>
              {f.rule_key} · v{f.rule_version}
            </span>
          </div>
          <h3 className="finding-detail-title">{f.title}</h3>
          <p className="finding-detail-text">{f.description}</p>
        </div>
        <div className="finding-detail-section">
          <h4>EVIDENCE TRÊN NHÃN / HỒ SƠ</h4>
          {f.evidence.map((e, i) => (
            <div key={i} style={{ marginTop: i ? 10 : 0 }}>
              <blockquote className="evidence-quote">“{e.text}”</blockquote>
              <div className="evidence-meta">
                <span>
                  {e.kind === "dossier"
                    ? "Thông tin khách hàng khai báo"
                    : e.kind === "absence"
                      ? "Không phát hiện trong panel đã đọc"
                      : `Trang ${e.page} · bbox có tọa độ`}
                </span>
                {e.bbox && (
                  <button className="text-button" onClick={() => onEvidence(i)}>
                    {evidenceIndex === i ? "Đang đánh dấu" : "Xem trên nhãn"}{" "}
                    <ArrowUpRight size={11} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
        <div className="finding-detail-section">
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 8,
              alignItems: "center",
              marginBottom: 8,
            }}
          >
            <h4
              style={{
                fontSize: 7,
                letterSpacing: 1.1,
                fontWeight: 500,
                color: "#9bae84",
                margin: 0,
              }}
            >
              NGUỒN THAM CHIẾU
            </h4>
            {editable && (
              <button
                className="text-button"
                style={{ fontSize: 7 }}
                onClick={() => {
                  setCitations(f.citation_ids);
                  setCitationReason("");
                  setCitationOpen(true);
                }}
              >
                <Pencil size={10} /> Gắn nguồn
              </button>
            )}
          </div>
          {f.citation_ids.map((id) => {
            const s = app.data.sources.find((s) => s.id === id);
            if (!s)
              return (
                <div className="citation-card" key={id}>
                  <div>Citation từ registry · {id.slice(-6)}</div>
                  <p>Liên hệ chuyên viên để xem nguồn snapshot.</p>
                </div>
              );
            const original = review.rule_snapshot
              ?.find((r) => r.rule_key === f.rule_key)
              ?.source_versions.find((ref) => ref.id === id);
            return (
              <a
                className="citation-card"
                key={id}
                href={s.canonical_url}
                target="_blank"
                rel="noopener noreferrer"
              >
                <div>
                  <strong>{s.citation}</strong>
                  <ArrowUpRight size={13} />
                </div>
                <p>{s.title}</p>
                <small>
                  {s.agency} · nguồn v{original?.version ?? s.version} ·{" "}
                  {sourceIsCurrent(s)
                    ? "Nguồn hiện hành"
                    : "Cần xác minh nguồn"}
                  {original?.version !== undefined &&
                  original.version !== s.version
                    ? " · ĐÃ THAY ĐỔI"
                    : ""}
                </small>
              </a>
            );
          })}
          {f.citation_pending && (
            <InlineNotice tone="warning" icon={<Clock3 size={14} />}>
              Citation pending human review. Finding quan trọng chưa đủ điều
              kiện để duyệt báo cáo.
            </InlineNotice>
          )}
        </div>
        <div className="finding-detail-section">
          <h4>HÀNH ĐỘNG ĐỀ XUẤT</h4>
          <div className="suggested-action">{f.suggested_action}</div>
        </div>
        <div className="finding-confidence">
          <Sparkles size={12} />
          {f.ai_confidence !== null ? (
            <>
              Độ tin cậy đọc / rules{" "}
              <ProgressBar value={f.ai_confidence * 100} />{" "}
              <strong>{Math.round(f.ai_confidence * 100)}%</strong>
            </>
          ) : (
            "Finding do chuyên viên tạo"
          )}
          <span title="Confidence không phải xác suất tuân thủ pháp luật.">
            <Info size={11} />
          </span>
        </div>
        {f.reviewer_comment && (
          <div className="finding-detail-section">
            <h4>QUYẾT ĐỊNH ĐÃ LƯU</h4>
            <p className="finding-detail-text">{f.reviewer_comment}</p>
            <div className="tiny muted" style={{ marginTop: 7, fontSize: 7 }}>
              {FINDING_STATUS_LABELS[f.status]} ·{" "}
              {f.reviewed_at ? formatDate(f.reviewed_at, true) : ""}
            </div>
          </div>
        )}
      </div>
      {editable && (
        <div className="finding-actions">
          <div
            className="finding-status-control"
            style={{ marginTop: 0, marginBottom: 11 }}
          >
            <Select
              aria-label="Mức độ finding"
              value={severity}
              onChange={(e) => setSeverity(e.target.value as Severity)}
            >
              {Object.entries(SEVERITY_META).map(([s, m]) => (
                <option key={s} value={s}>
                  {m.label}
                </option>
              ))}
            </Select>
            <Badge
              tone={
                f.status === "accepted"
                  ? "green"
                  : f.status === "dismissed"
                    ? "neutral"
                    : "amber"
              }
            >
              {FINDING_STATUS_LABELS[f.status]}
            </Badge>
          </div>
          <Textarea
            label="Lý do / ghi chú chuyên viên"
            placeholder="Ghi rõ căn cứ xác nhận hoặc loại trừ…"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            hint="Bắt buộc ít nhất 5 ký tự. Mọi quyết định được ghi lịch sử."
          />
          <div>
            <Button
              variant="secondary"
              disabled={comment.trim().length < 5}
              loading={busy}
              onClick={() => void decide("dismissed")}
            >
              <X size={13} /> Loại trừ
            </Button>
            <Button
              disabled={comment.trim().length < 5}
              loading={busy}
              onClick={() => void decide("accepted")}
            >
              <Check size={13} /> Xác nhận
            </Button>
          </div>
        </div>
      )}
      <Modal
        open={citationOpen}
        onClose={() => setCitationOpen(false)}
        title="Gắn citation từ source registry"
        description="Không thể nhập citation tự do. Nguồn chưa hiện hành sẽ giữ trạng thái pending human review."
        footer={
          <>
            <Button variant="secondary" onClick={() => setCitationOpen(false)}>
              Hủy
            </Button>
            <Button
              loading={busy}
              disabled={citationReason.trim().length < 5}
              onClick={() => void saveCitation()}
            >
              Lưu nguồn tham chiếu
            </Button>
          </>
        }
      >
        <div style={{ display: "grid", gap: 14 }}>
          {app.data.sources.map((s) => (
            <Checkbox
              key={s.id}
              checked={citations.includes(s.id)}
              onChange={(checked) =>
                setCitations((prev) =>
                  checked ? [...prev, s.id] : prev.filter((id) => id !== s.id),
                )
              }
            >
              {s.citation}{" "}
              <Badge tone={sourceIsCurrent(s) ? "green" : "amber"}>
                {s.status}
              </Badge>
            </Checkbox>
          ))}
        </div>
        <div style={{ marginTop: 22 }}>
          <Textarea
            label="Lý do gắn / thay citation"
            value={citationReason}
            onChange={(e) => setCitationReason(e.target.value)}
          />
        </div>
      </Modal>
    </>
  );
}
function PipelinePanel({
  review,
  onRerun,
}: {
  review: Review;
  onRerun: () => void;
}) {
  const { actor, mode } = useApp();
  return (
    <Card className="pipeline-panel">
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginBottom: 12,
        }}
      >
        <span className="auth-badge" style={{ margin: 0 }}>
          <ScanLine size={24} />
        </span>
        <div>
          <h2>Phân tích nhãn theo từng bước</h2>
          <p className="tiny muted" style={{ marginTop: 4 }}>
            Giữ evidence và kết quả trung gian · bắt buộc chuyên viên xác nhận.
          </p>
        </div>
      </div>
      {review.idempotency_key.startsWith("seed-") && (
        <div style={{ marginTop: 20 }}>
          <InlineNotice icon={<Info size={16} />}>
            Đây là trạng thái pipeline minh họa, không có job nền đang chạy.
            Chọn “Chạy lại kiểm tra” để chạy bộ rules trên fixture mẫu.
          </InlineNotice>
        </div>
      )}
      <div className="pipeline-progress">
        <div>
          <span>Tiến độ xử lý</span>
          <strong>{review.progress}%</strong>
        </div>
        <ProgressBar value={review.progress} />
      </div>
      {review.pipeline.map((s, i) => (
        <div className="pipeline-stage" key={s.stage}>
          <span className={s.status}>
            {s.status === "complete" ? (
              <Check size={16} />
            ) : s.status === "running" ? (
              <Loader2 size={16} className="spin" />
            ) : s.status === "failed" ? (
              <CircleAlert size={16} />
            ) : (
              i + 1
            )}
          </span>
          <div>
            <h3>{PIPELINE_LABELS[s.stage]}</h3>
            <p>
              {s.message ??
                (s.status === "pending"
                  ? "Chờ bước trước hoàn thành."
                  : s.status === "complete"
                    ? "Đã hoàn thành."
                    : "Đang xử lý dữ liệu.")}
            </p>
          </div>
          <small>
            {s.status === "complete"
              ? "Hoàn thành"
              : s.status === "running"
                ? "Đang xử lý"
                : s.status === "failed"
                  ? "Thất bại"
                  : "Chờ"}
          </small>
        </div>
      ))}
      {review.error_message && (
        <div style={{ marginTop: 20 }}>
          <InlineNotice tone="error">{review.error_message}</InlineNotice>
        </div>
      )}
      <div className="pipeline-actions">
        <span className="tiny muted">
          {mode === "demo"
            ? "OCR xử lý cục bộ · chưa có virus scan"
            : "Job queue · tối đa 3 lần thử · dead-letter khi hết retry"}
        </span>
        {can(actor, "review") &&
          (review.status !== "PROCESSING" ||
            review.idempotency_key.startsWith("seed-")) && (
            <Button variant="secondary" onClick={onRerun}>
              <RefreshCw size={14} /> Chạy lại kiểm tra
            </Button>
          )}
      </div>
    </Card>
  );
}
function RequestModal({
  review,
  open,
  onClose,
}: {
  review: Review;
  open: boolean;
  onClose: () => void;
}) {
  const app = useApp();
  const [message, setMessage] = useState("");
  const [docs, setDocs] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const documents = [
    "Công thức xác nhận",
    "Certificate of analysis",
    "Laboratory caffeine result",
    "Organic certificate",
    "Allergen control statement",
    "Claim substantiation",
    "Formula revision history",
  ];
  const submit = async () => {
    setBusy(true);
    try {
      await app.requestInformation(review.id, message, docs);
      app.notify(
        "Đã tạo yêu cầu bổ sung. Khách hàng sẽ thấy yêu cầu trong hồ sơ.",
      );
      onClose();
      setMessage("");
      setDocs([]);
    } catch (e) {
      app.notify(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Yêu cầu khách hàng bổ sung"
      description="Review sẽ chuyển sang Chờ khách bổ sung. Yêu cầu được lưu trong hồ sơ và audit log."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Hủy
          </Button>
          <Button
            loading={busy}
            disabled={message.trim().length < 10}
            onClick={() => void submit()}
          >
            <MessageSquarePlus size={15} /> Gửi yêu cầu
          </Button>
        </>
      }
    >
      <Textarea
        label="Nội dung yêu cầu"
        required
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder="Nêu rõ thông tin cần bổ sung và lý do…"
      />
      <div className="field-label" style={{ margin: "22px 0 14px" }}>
        Tài liệu cần bổ sung
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        {documents.map((d) => (
          <Checkbox
            key={d}
            checked={docs.includes(d)}
            onChange={(v) =>
              setDocs((prev) =>
                v ? [...prev, d] : prev.filter((x) => x !== d),
              )
            }
          >
            {d}
          </Checkbox>
        ))}
      </div>
      {app.mode === "demo" && (
        <p className="tiny muted" style={{ marginTop: 20 }}>
          Demo lưu yêu cầu tại chỗ, không gửi email. Bản Supabase lưu yêu cầu để
          khách hàng xem trong workspace.
        </p>
      )}
    </Modal>
  );
}
function ApprovalModal({
  review,
  open,
  onClose,
}: {
  review: Review;
  open: boolean;
  onClose: () => void;
}) {
  const app = useApp();
  const router = useRouter();
  const [comment, setComment] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const issues = approvalIssues(app.data, review, app.mode === "supabase");
  const findings = app.data.findings.filter((f) => f.review_id === review.id);
  const openFindings = findings.filter((f) => f.status === "open").length;
  const submit = async () => {
    setBusy(true);
    try {
      const report = await app.approveReport(review.id, comment);
      app.notify("Đã phê duyệt nội dung báo cáo. Có thể tải PDF hoặc JSON.");
      onClose();
      router.push(`/reports?report=${report.id}`);
    } catch (e) {
      app.notify(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Phê duyệt nội dung báo cáo"
      description="Chỉ xác nhận báo cáo Vexim — không phải phê duyệt nhãn hoặc sản phẩm bởi FDA."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Quay lại rà soát
          </Button>
          <Button
            disabled={
              !!issues.length || !confirmed || comment.trim().length < 10
            }
            loading={busy}
            onClick={() => void submit()}
          >
            <FileCheck2 size={15} /> Duyệt & tạo báo cáo
          </Button>
        </>
      }
    >
      <div className="approval-checklist">
        <div>
          {openFindings ? <CircleAlert size={15} /> : <CheckCheck size={15} />}{" "}
          {findings.length - openFindings}/{findings.length} finding đã có quyết
          định
        </div>
        <div>
          <Avatar name={app.actor.name} size="sm" /> Người duyệt:{" "}
          {app.actor.name}
        </div>
        <div>
          <FileText size={15} /> Nhãn v
          {
            app.data.labelVersions.find((v) => v.id === review.label_version_id)
              ?.version
          }{" "}
          · US federal food labeling MVP
        </div>
      </div>
      {issues.length > 0 ? (
        <InlineNotice tone="warning">
          <strong>Chưa đủ điều kiện phát hành</strong>
          <ul className="validation-list">
            {issues.map((i) => (
              <li key={i}>{i}</li>
            ))}
          </ul>
        </InlineNotice>
      ) : (
        <InlineNotice tone="success">
          Evidence, citation, snapshot nguồn và quyết định chuyên viên đã đủ
          điều kiện để tạo báo cáo. Kết quả báo cáo vẫn có thể là “Cần chỉnh
          sửa” hoặc “Chưa đủ thông tin”.
        </InlineNotice>
      )}
      <div style={{ marginTop: 22 }}>
        <Textarea
          label="Ghi chú phê duyệt"
          required
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Ghi rõ phạm vi, căn cứ quyết định và những giới hạn còn lại…"
          hint="Tối thiểu 10 ký tự. Ghi chú được lưu trong snapshot báo cáo bất biến."
        />
      </div>
      <div style={{ marginTop: 20 }}>
        <Checkbox checked={confirmed} onChange={setConfirmed}>
          Tôi đã đối chiếu nhãn gốc và xác nhận disclaimer, nguồn tham chiếu,
          phạm vi và nội dung báo cáo.
        </Checkbox>
      </div>
      <p
        style={{
          fontSize: 11,
          color: "#637658",
          marginTop: 17,
          lineHeight: 1.9,
        }}
      >
        {DISCLAIMER}
      </p>
    </Modal>
  );
}
function ManualFindingModal({
  review,
  label,
  evidence,
  open,
  onClose,
}: {
  review: Review;
  label: LabelVersion;
  evidence?: Evidence;
  open: boolean;
  onClose: () => void;
}) {
  const app = useApp();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [severity, setSeverity] = useState<Severity>("major");
  const [action, setAction] = useState("");
  const [text, setText] = useState("");
  const [citation, setCitation] = useState("");
  const [busy, setBusy] = useState(false);
  const evidenceKey = JSON.stringify(evidence ?? {});
  const evidenceRef = useRef(evidence);
  evidenceRef.current = evidence;
  useEffect(() => {
    if (open) setText(evidenceRef.current?.text ?? "");
  }, [open, evidenceKey]);
  const submit = async () => {
    setBusy(true);
    try {
      const f: Finding = {
        id: uid(),
        review_id: review.id,
        organization_id: review.organization_id,
        rule_key: "MANUAL",
        rule_version: 1,
        severity,
        status: "open",
        title: title.trim(),
        description: description.trim(),
        evidence: [
          {
            ...(evidence?.kind === "observed"
              ? evidence
              : {
                  file_id: label.original_files[0]?.id ?? "",
                  page: 1,
                  bbox: null,
                }),
            text: text.trim(),
            kind: "observed",
          },
        ],
        citation_ids: citation ? [citation] : [],
        citation_pending:
          !citation ||
          !app.data.sources.some(
            (s) => s.id === citation && sourceIsCurrent(s),
          ),
        suggested_action: action.trim(),
        ai_confidence: null,
        reasoning_category: "manual",
        human_review_required: true,
        reviewer_comment: null,
        reviewed_by: null,
        reviewed_at: null,
        created_at: now(),
      };
      await app.addFinding(f);
      app.notify("Đã thêm finding thủ công.");
      onClose();
      setTitle("");
      setDescription("");
      setAction("");
      setText("");
    } catch (e) {
      app.notify(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Thêm finding thủ công"
      description="Gắn evidence thật và nguồn trong registry. Thiếu nguồn sẽ ở trạng thái citation pending human review."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Hủy
          </Button>
          <Button
            loading={busy}
            disabled={
              !title.trim() ||
              description.trim().length < 10 ||
              !text.trim() ||
              !action.trim()
            }
            onClick={() => void submit()}
          >
            <Plus size={15} /> Thêm finding
          </Button>
        </>
      }
    >
      <Input
        label="Tiêu đề finding"
        required
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      <Select
        label="Mức độ"
        value={severity}
        onChange={(e) => setSeverity(e.target.value as Severity)}
      >
        {Object.entries(SEVERITY_META).map(([key, m]) => (
          <option key={key} value={key}>
            {m.label}
          </option>
        ))}
      </Select>
      <Textarea
        label="Mô tả rủi ro"
        required
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />
      <Textarea
        label="Evidence — nguyên văn trên nhãn"
        required
        value={text}
        onChange={(e) => setText(e.target.value)}
        hint={
          evidence?.bbox
            ? "Gắn vào vùng nhãn đang được chọn ở workspace."
            : "Không có bbox được chọn. Chuyên viên phải đối chiếu file / trang trong hồ sơ."
        }
      />
      <Select
        label="Nguồn tham chiếu"
        value={citation}
        onChange={(e) => setCitation(e.target.value)}
      >
        <option value="">Citation pending human review</option>
        {app.data.sources.map((s) => (
          <option key={s.id} value={s.id}>
            {s.citation} · {s.status}
          </option>
        ))}
      </Select>
      <Textarea
        label="Hành động đề xuất"
        required
        value={action}
        onChange={(e) => setAction(e.target.value)}
      />
    </Modal>
  );
}
function CompareModal({
  current,
  versions,
  open,
  onClose,
}: {
  current: LabelVersion;
  versions: LabelVersion[];
  open: boolean;
  onClose: () => void;
}) {
  const [previousId, setPreviousId] = useState(
    versions.find((v) => v.id !== current.id)?.id ?? "",
  );
  const previous = versions.find((v) => v.id === previousId);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="So sánh hai phiên bản nhãn"
      description="Mỗi bản giữ nguyên file gốc. So sánh trực quan và extracted fields; không tự kết luận mọi thay đổi đã được xử lý."
      wide
      footer={
        <Button variant="secondary" onClick={onClose}>
          Đóng so sánh
        </Button>
      }
    >
      <div style={{ maxWidth: 290, marginBottom: 20 }}>
        <Select
          label="Phiên bản đối chiếu"
          value={previousId}
          onChange={(e) => setPreviousId(e.target.value)}
        >
          {versions
            .filter((v) => v.id !== current.id)
            .map((v) => (
              <option value={v.id} key={v.id}>
                Nhãn v{v.version} · {formatDate(v.uploaded_at)}
              </option>
            ))}
        </Select>
      </div>
      <div className="compare-grid">
        <div>
          <h3>Phiên bản trước · v{previous?.version}</h3>
          {previous && (
            <LabelViewer key={previous.id} label={previous} compact />
          )}
        </div>
        <div>
          <h3>Đang rà soát · v{current.version}</h3>
          <LabelViewer label={current} compact />
        </div>
      </div>
      {previous && previous.extracted_fields.length > 0 ? (
        <div className="table-scroll" style={{ marginTop: 20 }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>TRƯỜNG</th>
                <th>PHIÊN BẢN TRƯỚC</th>
                <th>PHIÊN BẢN ĐANG RÀ SOÁT</th>
              </tr>
            </thead>
            <tbody>
              {current.extracted_fields
                .filter((f) => f.field !== "claim")
                .map((f) => {
                  const old = previous.extracted_fields.find(
                    (x) => x.field === f.field,
                  );
                  return (
                    <tr key={f.id}>
                      <td>{fieldLabels[f.field] ?? f.field}</td>
                      <td style={{ whiteSpace: "normal" }}>
                        {old?.value ?? "Chưa phát hiện"}
                      </td>
                      <td style={{ whiteSpace: "normal" }}>
                        {f.value ?? "Chưa phát hiện"}
                        {old?.value !== f.value && (
                          <Badge tone="amber">Thay đổi</Badge>
                        )}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="tiny muted" style={{ marginTop: 17 }}>
          Chưa có extraction của phiên bản trước; chỉ so sánh ảnh gốc, không suy
          đoán khác biệt.
        </p>
      )}
    </Modal>
  );
}
function ExtractionModal({
  label,
  review,
  editable,
  open,
  onClose,
}: {
  label: LabelVersion;
  review: Review;
  editable: boolean;
  open: boolean;
  onClose: () => void;
}) {
  const app = useApp();
  const [editing, setEditing] = useState<ExtractedField | null>(null);
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!editing) return;
    setBusy(true);
    try {
      await app.updateField(label.id, editing.id, value, reason);
      app.notify(
        "Đã lưu giá trị có xác nhận; file gốc không thay đổi. Hãy chạy lại rules.",
      );
      setEditing(null);
    } catch (e) {
      app.notify(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Modal
        open={open && !editing}
        onClose={onClose}
        title="Dữ liệu trích xuất từ nhãn"
        description="Giữ nguyên wording và tọa độ evidence. Khi chỉnh extracted value, cần lý do và chạy lại rules."
        wide
        footer={
          <>
            <Button variant="secondary" onClick={onClose}>
              Đóng
            </Button>
            {editable && (
              <Button
                onClick={() =>
                  void app
                    .rerunReview(review.id, "rules")
                    .then(() => {
                      onClose();
                      app.notify(
                        "Đang chạy lại rules trên extracted fields đã lưu.",
                        "info",
                      );
                    })
                    .catch((e) => app.notify(errorMessage(e), "error"))
                }
              >
                <RefreshCw size={14} /> Chạy lại rules
              </Button>
            )}
          </>
        }
      >
        <div className="field-list">
          {label.extracted_fields.map((f) => (
            <div key={f.id} className="field-list-item">
              <div>
                <strong>{fieldLabels[f.field] ?? f.field}</strong>
                <p>{f.value ?? "Chưa phát hiện · không tự điền dữ liệu"}</p>
                <small>
                  {f.extraction_model} ·{" "}
                  {f.manually_verified
                    ? "Đã xác minh thủ công"
                    : `${Math.round(f.confidence * 100)}% confidence`}{" "}
                  · Trang {f.evidence.page}
                </small>
              </div>
              {editable && (
                <IconButton
                  label={`Sửa ${fieldLabels[f.field] ?? f.field}`}
                  onClick={() => {
                    setEditing(f);
                    setValue(f.value ?? "");
                    setReason("");
                  }}
                >
                  <Pencil size={15} />
                </IconButton>
              )}
            </div>
          ))}
          {!label.extracted_fields.length && (
            <EmptyState
              title="Chưa có extraction"
              description="Chờ pipeline hoàn thành hoặc chạy lại từ OCR."
            />
          )}
        </div>
      </Modal>
      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={`Xác minh ${fieldLabels[editing?.field ?? ""] ?? editing?.field}`}
        description="Evidence gốc được giữ lại. Chỉnh value là quyết định của người rà soát, không phải OCR mới."
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)}>
              Hủy
            </Button>
            <Button
              onClick={() => void save()}
              loading={busy}
              disabled={reason.trim().length < 5}
            >
              Lưu xác minh
            </Button>
          </>
        }
      >
        <Textarea
          label="Giá trị đã đối chiếu trên nhãn"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <Textarea
          label="Lý do chỉnh sửa"
          required
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <blockquote className="evidence-quote" style={{ marginTop: 20 }}>
          Evidence gốc: {editing?.evidence.text}
        </blockquote>
      </Modal>
    </>
  );
}
function RerunModal({
  review,
  open,
  onClose,
}: {
  review: Review;
  open: boolean;
  onClose: () => void;
}) {
  const app = useApp();
  const [stage, setStage] = useState<PipelineStep["stage"]>("rules");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      await app.rerunReview(review.id, stage);
      app.notify(
        "Đã gửi tác vụ chạy lại. Theo dõi tiến độ tại workspace.",
        "info",
      );
      onClose();
      setConfirmed(false);
    } catch (e) {
      app.notify(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Chạy lại một phần pipeline"
      description="Giữ file gốc và các bước trước đó. Các finding được tạo lại phải được chuyên viên xác nhận lại."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Hủy
          </Button>
          <Button
            disabled={!confirmed}
            loading={busy}
            onClick={() => void submit()}
          >
            <RefreshCw size={14} /> Chạy lại
          </Button>
        </>
      }
    >
      <Select
        label="Bước bắt đầu"
        value={stage}
        onChange={(e) => setStage(e.target.value as PipelineStep["stage"])}
      >
        <option value="ocr">OCR → extraction → rules</option>
        <option value="rules">
          Rules → verification (giữ extracted values)
        </option>
      </Select>
      <div style={{ marginTop: 20 }}>
        <InlineNotice tone="warning">
          Quyết định accept / dismiss cũ không được tự dùng lại. Báo cáo đã phát
          hành không bị chỉnh sửa; review đã đóng cần phiên bản nhãn mới.
        </InlineNotice>
      </div>
      <div style={{ marginTop: 20 }}>
        <Checkbox checked={confirmed} onChange={setConfirmed}>
          Tôi đồng ý tạo lại finding và xác nhận lại các quyết định.
        </Checkbox>
      </div>
    </Modal>
  );
}
