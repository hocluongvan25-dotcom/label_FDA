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
import { ReviewCollaborationPanel } from "./review-collaboration";
import { VeximReviewRequestPanel } from "./vexim-review-request-panel";
import type {
  Actor,
  ComplianceRule,
  Evidence,
  ExtractedField,
  Finding,
  LabelFile,
  LabelVersion,
  PipelineStep,
  RegulatorySource,
  Report,
  Review,
  Severity,
} from "@/lib/types";
import {
  DISCLAIMER,
  FINDING_STATUS_LABELS,
  PIPELINE_LABELS,
  RESULT_LABELS,
  SEVERITY_META,
  TRIAGE_REPORT_STATUS_LABELS,
  TRIAGE_RESULT_LABELS,
  TRIAGE_ROUTE_META,
} from "@/lib/constants";
import { can } from "@/lib/permissions";
import { isSyntheticDemoReview } from "@/lib/demo-review";
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
import { approvalIssues, reportDisposition } from "@/lib/reports";
import { PRE_SCREENING_DISCLAIMER } from "@/lib/triage";
import { normalizePages } from "@/lib/files";
import { isBundledDemoArtwork } from "@/lib/demo-artwork";

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
function lowConfidenceOcrFields(fields: ExtractedField[]) {
  return fields.filter(
    (field) =>
      !!field.value?.trim() &&
      !field.manually_verified &&
      field.confidence < 0.7,
  );
}
function hasUnresolvedParagraphPaths(review: Review) {
  return (review.triage_reasons ?? []).some(
    (reason) =>
      reason.code === "UNRESOLVED_REGULATORY_CITATION" &&
      /paragraph paths?/i.test(reason.message) &&
      /unresolved/i.test(reason.message),
  );
}
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
          title="Không tìm thấy lượt rà soát"
          description="Lượt rà soát không tồn tại hoặc bạn không có quyền truy cập tổ chức này."
          action={
            <Link className="btn btn-secondary" href="/reviews">
              Về danh sách
            </Link>
          }
        />
      </Card>
    );
  const demoFixture = isSyntheticDemoReview(review);
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
          description="Vui lòng tải lại màn hình hoặc liên hệ quản trị hệ thống."
        />
      </Card>
    );
  const preScreeningReport = app.data.preScreeningReports
    ?.filter((report) => report.review_id === review.id)
    .sort((a, b) => b.version - a.version)[0];
  const lowOcrFields = lowConfidenceOcrFields(label.extracted_fields);
  const unresolvedParagraphPaths = hasUnresolvedParagraphPaths(review);
  const reviewRules = app.data.rules
    .filter((rule) => rule.scope.includes(product.category))
    .sort((a, b) => a.rule_key.localeCompare(b.rule_key));
  const matchingVeximRequests = (app.data.veximReviewRequests ?? []).filter(
    (request) =>
      request.review_id === review.id &&
      request.label_version_id === review.label_version_id,
  );
  const finalReport = app.data.reports.find(
    (report) =>
      report.review_id === review.id &&
      report.label_version_id === review.label_version_id,
  );
  const activeVeximRequest = matchingVeximRequests.find(
    (request) => request.status === "IN_PROGRESS",
  );
  const reportRequest = finalReport
    ? matchingVeximRequests.find(
        (request) =>
          request.id === finalReport.vexim_review_request_id &&
          request.artwork_hash === finalReport.artwork_sha256,
      )
    : undefined;
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
    !!activeVeximRequest &&
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
              {app.data.organizations.find(
                (o) => o.id === product.organization_id,
              )?.name ??
                app.data.reviewParticipants?.find(
                  (participant) =>
                    participant.review_id === review.id &&
                    participant.party_role === "label_owner",
                )?.organization_name_snapshot ??
                "Doanh nghiệp sở hữu nhãn"}
            </span>
            <span>·</span>
            <span>Nhãn v{label.version}</span>
            <span>·</span>
            <span>Ghi nhãn thực phẩm tại Hoa Kỳ</span>
            {demoFixture && (
              <>
                <span>·</span>
                <span title="Mã hồ sơ demo">{review.idempotency_key}</span>
              </>
            )}
            <span>·</span>
            <span title="Người phụ trách">
              {assigneeName(app.data, review.assigned_to, app.actor)}
            </span>
            <StatusBadge status={review.status} />
          </div>
        </div>
        <div className="review-header-actions">
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
          {can(app.actor, "review") && activeVeximRequest && !demoFixture && (
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
              <FileCheck2 size={15} /> Ký duyệt báo cáo Vexim
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
      {demoFixture && (
        <div style={{ marginBottom: 16 }}>
          <InlineNotice icon={<Info size={15} />}>
            Hồ sơ mẫu tổng hợp, chỉ để chuyên gia rà soát độc lập. Hình nhãn SVG
            tĩnh chưa được quét; không chạy OCR hoặc bộ quy tắc trên dữ liệu
            mẫu.
            {review.triage_evaluated_at
              ? " Dữ liệu phân luồng đang hiển thị chỉ là mẫu kiểm thử giao diện, không phải kết quả đã chạy."
              : " Không có dữ liệu phân luồng hoặc quyết định tuân thủ."}{" "}
            Cả 15 phát hiện vẫn đang mở; bộ quy tắc và nguồn vẫn ở trạng thái
            DRAFT.
          </InlineNotice>
        </div>
      )}
      {!demoFixture && <ReviewCollaborationPanel review={review} />}
      <VeximReviewRequestPanel review={review} />
      {review.status === "SOURCE_UNAVAILABLE" && (
        <div style={{ marginBottom: 16 }}>
          <InlineNotice tone="warning">
            {review.error_message ??
              "Nguồn hoặc bộ quy tắc chưa đủ để xác định kết quả."}{" "}
            <Link href="/sources" className="text-button">
              Xem danh mục nguồn
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
              <div className="tiny muted">
                PHÂN LUỒNG · {review.triage_policy_version}
              </div>
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
                {unresolvedParagraphPaths && (
                  <Badge tone="red">
                    Đường dẫn điều khoản · cần xác minh thủ công
                  </Badge>
                )}
              </div>
            </div>
            <div className="tiny muted" style={{ textAlign: "right" }}>
              Rủi ro {review.triage_risk_score ?? 0}/100
              <br />
              Báo cáo sàng lọc:{" "}
              {review.report_status
                ? TRIAGE_REPORT_STATUS_LABELS[review.report_status]
                : "Chưa ghi nhận"}
            </div>
          </div>
          {unresolvedParagraphPaths && (
            <div style={{ marginTop: 12 }}>
              <InlineNotice tone="warning" icon={<CircleAlert size={15} />}>
                Một hoặc nhiều đường dẫn đến điều khoản chưa được xác minh. Cần
                đối chiếu thủ công trích dẫn; trạng thái này không có nghĩa
                Vexim đã nhận yêu cầu rà soát và không được dùng để tự động phát
                hành.
              </InlineNotice>
            </div>
          )}
          {review.triage_route === "AUTO_SCREENED" && (
            <div style={{ marginTop: 12 }}>
              <InlineNotice tone={preScreeningReport ? "info" : "warning"}>
                Kết quả sàng lọc tự động chỉ dùng để phân luồng, không phải kết
                luận tuân thủ.
                {preScreeningReport
                  ? " Đã tạo bản ghi sàng lọc sơ bộ riêng, kèm tuyên bố giới hạn phạm vi."
                  : " Chưa tạo bản ghi sàng lọc sơ bộ vì tính năng này đang tắt hoặc tổ chức chưa thuộc danh sách được phép."}
              </InlineNotice>
            </div>
          )}
          {!!review.triage_reasons?.length && (
            <ul className="validation-list" style={{ marginTop: 12 }}>
              {review.triage_reasons.map((reason, index) => (
                <li
                  key={`${reason.code}-${reason.source_id ?? ""}-${reason.rule_key ?? index}`}
                >
                  {reason.message}
                  {reason.rule_key ? ` · ${reason.rule_key}` : ""}
                </li>
              ))}
            </ul>
          )}
          {preScreeningReport && (
            <div style={{ marginTop: 12 }}>
              <InlineNotice tone="info">
                <strong>
                  Bản ghi sàng lọc sơ bộ · v{preScreeningReport.version}
                </strong>
                <div style={{ marginTop: 5 }}>
                  {PRE_SCREENING_DISCLAIMER.vi}
                </div>
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
                <FileText size={14} /> Tải bản ghi JSON
              </Button>
            </div>
          )}
        </Card>
      )}
      {!processing && (activeVeximRequest || reportRequest) && (
        <ReviewSignoffSummary
          review={review}
          report={finalReport}
          actor={app.actor}
          staff={app.data.staff ?? []}
          demo={app.mode === "demo"}
          requestInProgress={!!activeVeximRequest}
        />
      )}
      <ReviewComparisonBoard
        review={review}
        label={label}
        rules={reviewRules}
        findings={findings}
        lowOcrFields={lowOcrFields}
        demo={app.mode === "demo"}
      />
      {!processing && (
        <div className="review-summary-strip">
          <div>
            <span className="tiny muted" style={{ marginRight: 3 }}>
              {findings.length} phát hiện
            </span>
            {Object.entries(counts)
              .filter(([, n]) => n > 0)
              .map(([key, n]) => (
                <SeverityBadge key={key} severity={key as Severity} count={n} />
              ))}
            {!findings.length && (
              <Badge tone="green">
                Chưa ghi nhận phát hiện · cần chuyên viên xác nhận
              </Badge>
            )}
          </div>
          <span>
            <ShieldCheck size={13} /> Bằng chứng → Quy tắc → Nguồn → Chuyên viên
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
                <ScanLine size={13} /> Nội dung OCR
              </button>
              {editable && (
                <button
                  className="text-button"
                  onClick={() => setSelectionEnabled((v) => !v)}
                >
                  <ScanLine size={13} />
                  {selectionEnabled ? "Hủy chọn vùng" : "Chọn vùng bằng chứng"}
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
                  aria-label="Lọc trạng thái phát hiện"
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
                      ? "Không có phát hiện phù hợp"
                      : "Chưa ghi nhận phát hiện"
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
                  <Plus size={14} /> Thêm phát hiện thủ công
                </Button>
              ) : (
                <span className="tiny muted">
                  {can(app.actor, "review")
                    ? "Lượt rà soát đã đóng · chỉ được xem dữ liệu"
                    : "Chỉ chuyên viên Vexim được xác nhận phát hiện"}
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
                    : "AI / bộ quy tắc"}
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
                description="Chọn một phát hiện để xem bằng chứng, quy tắc và trích dẫn nguồn; hoặc thêm phát hiện thủ công sau khi đối chiếu nhãn."
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
            {editable && !demoFixture && (
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
function ReviewSignoffSummary({
  review,
  report,
  actor,
  staff,
  demo,
  requestInProgress,
}: {
  review: Review;
  report?: Report;
  actor: Actor;
  staff: { id: string; name: string }[];
  demo: boolean;
  requestInProgress: boolean;
}) {
  const snapshot = report?.snapshot;
  const approvedBy = review.approved_by ?? snapshot?.approved_by ?? null;
  const reviewerName =
    snapshot?.reviewer.name ??
    staff.find((person) => person.id === approvedBy)?.name ??
    (approvedBy === actor.id ? actor.name : approvedBy);
  const disposition = snapshot?.disposition ?? snapshot?.result ?? null;
  const rationale =
    snapshot?.rationale ??
    review.approval_comment ??
    snapshot?.reviewer.comment ??
    null;
  const approvedAt =
    review.approved_at ?? snapshot?.reviewer.approved_at ?? null;

  return (
    <section
      className="card review-signoff-card"
      data-testid="review-signoff-summary"
      aria-label="Tóm tắt ký duyệt nội bộ"
    >
      <div className="review-signoff-header">
        <div>
          <div className="tiny muted">LỊCH SỬ KÝ DUYỆT NỘI BỘ VEXIM</div>
          <h2>Kết quả, người duyệt và lý do</h2>
        </div>
        <Badge tone={demo ? "amber" : approvedBy ? "green" : "amber"}>
          {demo
            ? approvedBy
              ? "DEMO · mẫu ký duyệt"
              : "DEMO · mẫu chưa ký"
            : approvedBy
              ? "Đã ký duyệt nội bộ"
              : "Chưa ký duyệt"}
        </Badge>
      </div>
      <dl className="review-signoff-grid">
        <dt>Chuyên viên</dt>
        <dd>{reviewerName ?? "Chưa ghi nhận"}</dd>
        <dt>Mã người duyệt nội bộ</dt>
        <dd>{approvedBy ?? "Chưa ghi nhận"}</dd>
        <dt>Kết quả trong phạm vi</dt>
        <dd>
          {disposition ? (
            <Badge
              tone={disposition === "NEEDS_CORRECTION" ? "orange" : "neutral"}
            >
              {RESULT_LABELS[disposition]}
            </Badge>
          ) : requestInProgress ? (
            "Chưa ký duyệt · Vexim Review đang được xử lý"
          ) : (
            "Chưa ghi nhận kết quả ký duyệt trong báo cáo."
          )}
        </dd>
        <dt>Lý do</dt>
        <dd>
          {rationale ??
            (requestInProgress
              ? "Chuyên viên sẽ ghi lý do khi ký duyệt báo cáo."
              : "Báo cáo không ghi nhận lý do ký duyệt.")}
        </dd>
        <dt>Thời điểm</dt>
        <dd>{approvedAt ? formatDate(approvedAt, true) : "Chưa ký duyệt"}</dd>
      </dl>
      {demo && (
        <p className="review-signoff-demo-note">
          Dữ liệu trên là mẫu tổng hợp trong Demo; không phải phê duyệt sản
          phẩm, kết luận pháp lý hoặc quyết định của FDA.
        </p>
      )}
    </section>
  );
}

function ReviewArtworkPreview({
  file,
  label,
}: {
  file: LabelFile;
  label: LabelVersion;
}) {
  const app = useApp();
  const appRef = useRef(app);
  appRef.current = app;
  const snapshotRef = useRef({ file, label });
  snapshotRef.current = { file, label };
  const [src, setSrc] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    let objectUrl = "";
    setSrc("");
    setError("");
    setLoading(true);
    const load = async () => {
      const { file: currentFile, label: currentLabel } = snapshotRef.current;
      if (
        appRef.current.mode === "supabase" &&
        currentFile.scan_status !== "clean" &&
        !isBundledDemoArtwork(currentFile)
      )
        throw new Error(
          "Chờ hoàn tất quét phần mềm độc hại thật trước khi mở nhãn gốc.",
        );

      if (currentFile.preview_url) {
        if (active) {
          setSrc(currentFile.preview_url);
          setLoading(false);
        }
        return;
      }

      let blob = await appRef.current.getFileBlob(currentFile);
      if (
        currentFile.mime_type === "application/pdf" ||
        currentFile.mime_type === "image/tiff"
      ) {
        const pages = await normalizePages(blob, currentFile);
        if (!pages[0])
          throw new Error("Không tạo được bản xem trước trang đầu của nhãn.");
        blob = pages[0].image;
      } else if (
        currentFile.mime_type !== "image/png" &&
        currentFile.mime_type !== "image/jpeg"
      ) {
        throw new Error(
          "Định dạng này chưa hỗ trợ xem trước trên màn hình rà soát.",
        );
      }

      objectUrl = URL.createObjectURL(blob);
      if (active) {
        setSrc(objectUrl);
        setLoading(false);
        await appRef.current.logFileAccess(currentLabel, currentFile);
      }
    };
    load().catch((cause) => {
      if (!active) return;
      setError(errorMessage(cause));
      setLoading(false);
    });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [file.id, file.mime_type, file.preview_url, file.scan_status, label.id]);

  return (
    <div
      className="review-artwork-preview"
      data-testid={`review-artwork-preview-${file.id}`}
    >
      {loading ? (
        <div className="review-artwork-unavailable" role="status">
          <Loader2 size={20} className="spin" />
          <span>Đang tạo bản xem trước…</span>
        </div>
      ) : error ? (
        <div className="review-artwork-unavailable" role="status">
          <FileText size={24} />
          <span>Không thể xem trước nhãn gốc</span>
          <small>{error}</small>
        </div>
      ) : (
        <img
          data-testid="review-artwork-preview-image"
          src={src}
          alt={`Nhãn ${file.name}, phiên bản ${label.version}`}
          onError={() => {
            setSrc("");
            setError("Bản xem trước không tải được; file gốc vẫn được giữ.");
          }}
        />
      )}
    </div>
  );
}

function ReviewComparisonBoard({
  review,
  label,
  rules,
  findings,
  lowOcrFields,
  demo,
}: {
  review: Review;
  label: LabelVersion;
  rules: ComplianceRule[];
  findings: Finding[];
  lowOcrFields: ExtractedField[];
  demo: boolean;
}) {
  const app = useApp();
  const draftOnlyDemo = isSyntheticDemoReview(review);
  const demoFixture =
    demo ||
    label.original_files.some(
      (file) =>
        file.sha256 === "DEMO_FIXTURE" || file.scan_status === "dev_unscanned",
    ) ||
    label.extracted_fields.some((field) =>
      field.extraction_model.startsWith("demo-fixture"),
    );
  const executedRules = new Map(
    (review.rule_snapshot ?? []).map((snapshot) => [
      snapshot.rule_key,
      snapshot,
    ]),
  );
  const activeRuleCount = rules.filter(
    (rule) => rule.status === "ACTIVE",
  ).length;

  return (
    <section
      className="card review-comparison-card"
      data-testid="review-comparison-board"
      aria-label="Đối chiếu nhãn gốc, nội dung OCR và quy tắc"
    >
      <div className="review-comparison-header">
        <div>
          <div className="tiny muted">
            ĐỐI CHIẾU NHÃN, NỘI DUNG TRÍCH XUẤT VÀ CĂN CỨ
          </div>
          <h2>
            {draftOnlyDemo
              ? "Nhãn gốc ↔ OCR chưa chạy ↔ 15 quy tắc DRAFT"
              : "Nhãn gốc ↔ kết quả OCR ↔ quy tắc áp dụng"}
          </h2>
          <p>
            Đối chiếu cùng một phiên bản nhãn trước mọi quyết định của chuyên
            viên.
          </p>
        </div>
        <Badge tone={demoFixture ? "amber" : "blue"}>
          {demoFixture ? "DỮ LIỆU DEMO MÔ PHỎNG" : "BẰNG CHỨNG RÀ SOÁT"}
        </Badge>
      </div>
      {demoFixture && (
        <div className="review-comparison-demo-notice">
          <InlineNotice tone="warning" icon={<Info size={15} />}>
            {draftOnlyDemo
              ? review.triage_evaluated_at
                ? "Ảnh nhãn SVG tĩnh; không có OCR hoặc quy tắc được chạy. Dữ liệu phân luồng chỉ là mẫu kiểm thử giao diện. Cả 15 phát hiện là gợi ý rà soát tổng hợp, không phải kết luận pháp lý; bộ quy tắc và nguồn vẫn ở trạng thái DRAFT."
                : "Ảnh nhãn SVG tĩnh; không có OCR hoặc phân luồng. Cả 15 phát hiện là gợi ý rà soát tổng hợp, không phải kết luận pháp lý. Bộ quy tắc và nguồn vẫn ở trạng thái DRAFT; chưa có ký duyệt hoặc báo cáo."
              : "Nhãn, nội dung OCR, nguồn và trạng thái quy tắc trong bản Demo là dữ liệu mô phỏng. Chúng không xác minh sản phẩm hoặc nguồn pháp lý và không hàm ý Vexim hay FDA đã phê duyệt."}
          </InlineNotice>
        </div>
      )}
      {lowOcrFields.length > 0 && (
        <div className="review-ocr-warning" role="alert">
          <CircleAlert size={18} />
          <div>
            <strong>
              {lowOcrFields.length} trường OCR có độ tin cậy dưới 70% — cần đối
              chiếu nhãn gốc.
            </strong>
            <div className="review-ocr-warning-fields">
              {lowOcrFields.map((field) => (
                <Badge key={field.id} tone="red">
                  {fieldLabels[field.field] ?? field.field} ·{" "}
                  {Math.round(field.confidence * 100)}%
                </Badge>
              ))}
            </div>
          </div>
        </div>
      )}
      <div className="review-comparison-grid">
        <section className="review-comparison-panel" aria-label="Ảnh nhãn gốc">
          <div className="review-comparison-panel-header">
            <div>
              <span>01 · NHÃN GỐC</span>
              <h3>Nhãn gốc</h3>
            </div>
            <Badge>{label.original_files.length} file</Badge>
          </div>
          <div className="review-comparison-panel-body review-artwork-grid">
            {label.original_files.map((file) => (
              <article className="review-artwork-item" key={file.id}>
                <ReviewArtworkPreview file={file} label={label} />
                <strong>{file.name}</strong>
                <small>
                  {file.page_count} trang · {file.scan_status}
                  {demoFixture ? " · DEMO FIXTURE" : ""}
                </small>
              </article>
            ))}
            {!label.original_files.length && (
              <EmptyState
                title="Chưa có nhãn gốc"
                description="Chưa có file gốc để đối chiếu."
                icon={<FileText size={24} />}
              />
            )}
          </div>
        </section>

        <section
          className="review-comparison-panel"
          aria-label="Nội dung trích xuất bằng nhận dạng ký tự quang học (OCR)"
        >
          <div className="review-comparison-panel-header">
            <div>
              <span>02 · NỘI DUNG ĐƯỢC TRÍCH XUẤT</span>
              <h3>{draftOnlyDemo ? "OCR chưa chạy" : "Kết quả OCR"}</h3>
            </div>
            <Badge>{label.extracted_fields.length} trường</Badge>
          </div>
          <div className="review-comparison-panel-body review-ocr-list">
            {label.extracted_fields.map((field) => {
              const isLowConfidence = lowOcrFields.some(
                (low) => low.id === field.id,
              );
              return (
                <article
                  key={field.id}
                  className={clsx(
                    "review-ocr-field",
                    isLowConfidence && "review-ocr-field-low",
                  )}
                  data-testid={
                    isLowConfidence ? "ocr-low-confidence-field" : undefined
                  }
                >
                  <div className="review-ocr-field-heading">
                    <div>
                      <strong>{fieldLabels[field.field] ?? field.field}</strong>
                      <small>{field.field}</small>
                    </div>
                    <Badge
                      tone={
                        isLowConfidence
                          ? "red"
                          : field.manually_verified
                            ? "green"
                            : "neutral"
                      }
                    >
                      {field.manually_verified
                        ? "Đã xác minh thủ công"
                        : `Độ tin cậy ${Math.round(field.confidence * 100)}%`}
                    </Badge>
                  </div>
                  <p className="review-ocr-field-value">
                    {field.value ??
                      "Không phát hiện · cần xác minh, không phải kết luận vắng mặt"}
                  </p>
                  <blockquote>{field.evidence.text}</blockquote>
                  <small className="review-ocr-field-meta">
                    Trang {field.evidence.page} · {field.extraction_model}
                  </small>
                  {isLowConfidence && (
                    <p className="review-ocr-field-alert">
                      Độ tin cậy OCR dưới 70% · cần đọc lại trực tiếp trên nhãn
                      gốc.
                    </p>
                  )}
                </article>
              );
            })}
            {!label.extracted_fields.length && (
              <EmptyState
                title={
                  draftOnlyDemo
                    ? "Chưa có dữ liệu OCR"
                    : "Chưa có nội dung được trích xuất"
                }
                description={
                  draftOnlyDemo
                    ? "Hồ sơ mẫu chỉ chứa hình nhãn tĩnh. Không chạy OCR và không suy đoán nội dung vắng mặt."
                    : "Chạy nhận dạng chữ (OCR) và trích xuất nội dung trước khi đối chiếu."
                }
                icon={<ScanLine size={24} />}
              />
            )}
          </div>
        </section>

        <section
          className="review-comparison-panel"
          aria-label="Bộ quy tắc áp dụng cho sản phẩm"
        >
          <div className="review-comparison-panel-header">
            <div>
              <span>03 · QUY TẮC ÁP DỤNG & KẾT QUẢ THEO PHIÊN BẢN</span>
              <h3>Quy tắc đang hoạt động · {activeRuleCount}/15</h3>
            </div>
            <Badge tone={activeRuleCount === 15 ? "neutral" : "amber"}>
              {activeRuleCount} / 15 đang hoạt động
            </Badge>
          </div>
          <div className="review-comparison-panel-body review-rule-list">
            {activeRuleCount !== 15 && (
              <InlineNotice tone="warning" icon={<CircleAlert size={14} />}>
                Bộ quy tắc tham chiếu dự kiến có 15 quy tắc đang hoạt động
                (ACTIVE). Hiện có {activeRuleCount}; các quy tắc bản nháp
                (DRAFT) hoặc đã bị thay thế (SUPERSEDED) không được tính. Chỉ số
                này phản ánh mức sẵn sàng của bộ quy tắc, không phải số vấn đề
                trên nhãn hay kết luận tuân thủ.
              </InlineNotice>
            )}
            {rules.map((rule) => {
              const execution = executedRules.get(rule.rule_key);
              const relatedFindings = findings.filter(
                (finding) => finding.rule_key === rule.rule_key,
              );
              const sources = rule.source_citations
                .map((id) =>
                  app.data.sources.find((source) => source.id === id),
                )
                .filter((source): source is RegulatorySource => !!source);
              return (
                <article
                  className="review-rule-row"
                  key={rule.id}
                  data-testid="review-rule-row"
                >
                  <div className="review-rule-row-title">
                    <div>
                      <strong>{rule.rule_key}</strong>
                      <span>{rule.name}</span>
                    </div>
                    <Badge
                      tone={
                        demoFixture
                          ? "amber"
                          : rule.status === "ACTIVE"
                            ? "green"
                            : rule.status === "DRAFT"
                              ? "neutral"
                              : "red"
                      }
                    >
                      {demoFixture ? `DEMO · ${rule.status}` : rule.status}
                    </Badge>
                  </div>
                  <div className="review-rule-row-meta">
                    <span>
                      Bản ghi quy tắc ở lượt rà soát:{" "}
                      {execution ? `v${execution.version}` : "chưa có"}
                    </span>
                    <span>
                      Kiểm thử hồi quy:{" "}
                      {rule.test_status === "passed"
                        ? "Đạt"
                        : rule.test_status === "failed"
                          ? "Không đạt"
                          : "Chưa chạy"}
                    </span>
                    <span>
                      Phát hiện:{" "}
                      {relatedFindings.length
                        ? relatedFindings
                            .map(
                              (finding) =>
                                FINDING_STATUS_LABELS[finding.status],
                            )
                            .join(", ")
                        : "Chưa ghi nhận"}
                    </span>
                  </div>
                  <div className="review-rule-sources">
                    <span>Nguồn căn cứ</span>
                    {sources.length ? (
                      sources.map((source) => (
                        <span className="review-rule-source" key={source.id}>
                          {source.citation} ·{" "}
                          {demoFixture
                            ? `DEMO · ${source.status}`
                            : source.status}
                        </span>
                      ))
                    ) : (
                      <span className="review-rule-source-missing">
                        Chưa có trích dẫn từ danh mục nguồn
                      </span>
                    )}
                  </div>
                </article>
              );
            })}
            {activeRuleCount === 0 && (
              <EmptyState
                title="Chưa có quy tắc ACTIVE phù hợp"
                description="0/15 là số quy tắc đang hoạt động, không phải số lỗi trên nhãn. Điều này không chứng minh nhãn không có vấn đề hoặc đã tuân thủ. Hãy liên hệ người phụ trách để xác minh quy tắc áp dụng cho sản phẩm."
                icon={<ShieldCheck size={24} />}
              />
            )}
          </div>
        </section>
      </div>
    </section>
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
  const recordedReviewerName = f.reviewed_by
    ? (app.data.staff?.find((person) => person.id === f.reviewed_by)?.name ??
      (f.reviewed_by === app.actor.id ? app.actor.name : f.reviewed_by))
    : null;
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
          ? "Đã loại trừ phát hiện; lý do được ghi vào nhật ký kiểm toán."
          : "Đã xác nhận phát hiện.",
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
      app.notify("Đã gắn trích dẫn từ danh mục nguồn.");
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
          <h4>BẰNG CHỨNG TRÊN NHÃN / HỒ SƠ</h4>
          {f.evidence.map((e, i) => (
            <div key={i} style={{ marginTop: i ? 10 : 0 }}>
              <blockquote className="evidence-quote">“{e.text}”</blockquote>
              <div className="evidence-meta">
                <span>
                  {e.kind === "dossier"
                    ? "Thông tin khách hàng khai báo"
                    : e.kind === "absence"
                      ? "Không phát hiện trong phần nhãn đã đọc"
                      : `Trang ${e.page} · tọa độ vùng trên nhãn`}
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
                  <div>Nguồn trích dẫn trong danh mục · {id.slice(-6)}</div>
                  <p>Liên hệ chuyên viên để xem bản lưu của nguồn.</p>
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
              Trích dẫn đang chờ chuyên viên xác minh. Phát hiện quan trọng chưa
              đủ điều kiện để ký duyệt báo cáo.
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
              Độ tin cậy của kết quả nhận dạng chữ / quy tắc{" "}
              <ProgressBar value={f.ai_confidence * 100} />{" "}
              <strong>{Math.round(f.ai_confidence * 100)}%</strong>
            </>
          ) : isSyntheticDemoReview(review) ? (
            "Gợi ý DRAFT · chưa có kết quả AI hoặc OCR"
          ) : (
            "Phát hiện do chuyên viên tạo"
          )}
          <span title="Độ tin cậy không phải xác suất tuân thủ pháp luật.">
            <Info size={11} />
          </span>
        </div>
        <div
          className="finding-detail-section finding-disposition-card"
          data-testid="finding-disposition"
        >
          <h4>KẾT QUẢ XỬ LÝ PHÁT HIỆN · NHẬT KÝ KIỂM TOÁN</h4>
          <dl>
            <dt>Kết quả xử lý</dt>
            <dd>
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
            </dd>
            <dt>Chuyên viên</dt>
            <dd>{recordedReviewerName ?? "Chưa ghi nhận"}</dd>
            <dt>Lý do</dt>
            <dd>
              {f.reviewer_comment ?? "Bắt buộc trước khi chốt disposition."}
            </dd>
            <dt>Thời điểm ghi nhận</dt>
            <dd>
              {f.reviewed_at
                ? formatDate(f.reviewed_at, true)
                : "Chưa ghi nhận"}
            </dd>
          </dl>
        </div>
      </div>
      {editable && (
        <div className="finding-actions">
          <div
            className="finding-status-control"
            style={{ marginTop: 0, marginBottom: 11 }}
          >
            <Select
              aria-label="Mức độ nghiêm trọng của phát hiện"
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
        title="Gắn trích dẫn từ danh mục nguồn"
        description="Không thể nhập trích dẫn tự do. Nguồn chưa hiện hành sẽ tiếp tục chờ chuyên viên xác minh."
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
            label="Lý do gắn / thay trích dẫn nguồn"
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
  const demoFixture = isSyntheticDemoReview(review);
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
            Giữ bằng chứng và kết quả trung gian · bắt buộc chuyên viên xác
            nhận.
          </p>
        </div>
      </div>
      {demoFixture && (
        <div style={{ marginTop: 20 }}>
          <InlineNotice icon={<Info size={16} />}>
            Quy trình bị khóa cho hồ sơ mẫu này: hình nhãn tĩnh chưa được quét,
            không có OCR hoặc dữ liệu phân luồng; bộ quy tắc vẫn ở trạng thái
            DRAFT.
          </InlineNotice>
        </div>
      )}
      {review.idempotency_key.startsWith("seed-") && (
        <div style={{ marginTop: 20 }}>
          <InlineNotice icon={<Info size={16} />}>
            Đây là trạng thái quy trình minh họa, không có tác vụ nền đang chạy.
            Chọn “Chạy lại kiểm tra” để chạy bộ quy tắc trên dữ liệu mẫu.
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
            ? "Nhận dạng chữ (OCR) xử lý cục bộ · chưa quét mã độc"
            : "Hàng đợi tác vụ · thử lại tối đa 3 lần · sau đó chuyển sang danh sách lỗi"}
        </span>
        {can(actor, "review") &&
          !demoFixture &&
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
  const request = app.data.veximReviewRequests?.find(
    (candidate) =>
      candidate.review_id === review.id &&
      candidate.label_version_id === review.label_version_id &&
      candidate.status === "IN_PROGRESS",
  );
  const issues = approvalIssues(
    app.data,
    review,
    app.mode === "supabase",
    request?.id,
  );
  const findings = app.data.findings.filter((f) => f.review_id === review.id);
  const openFindings = findings.filter((f) => f.status === "open").length;
  const disposition = openFindings ? null : reportDisposition(app.data, review);
  const submit = async () => {
    setBusy(true);
    try {
      if (!request)
        throw new Error(
          "Chưa có VeximReviewRequest đang xử lý cho phiên bản này.",
        );
      const report = await app.approveReport(review.id, request.id, comment);
      app.notify("Đã ký duyệt nội bộ báo cáo Vexim. Có thể tải PDF hoặc JSON.");
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
      title="Ký duyệt nội bộ báo cáo Vexim"
      description="Chỉ ký duyệt báo cáo Vexim cho phiên bản này — không phải phê duyệt/chứng nhận của FDA hoặc kết luận tuân thủ toàn diện."
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
            <FileCheck2 size={15} /> Ký duyệt & phát hành báo cáo Vexim
          </Button>
        </>
      }
    >
      <div className="approval-checklist">
        <div>
          {openFindings ? <CircleAlert size={15} /> : <CheckCheck size={15} />}{" "}
          {findings.length - openFindings}/{findings.length} phát hiện đã có
          quyết định
        </div>
        <div>
          <Avatar name={app.actor.name} size="sm" /> Người ký duyệt nội bộ:{" "}
          <strong>{app.actor.name}</strong>
        </div>
        <div>
          <FileText size={15} /> Nhãn v
          {
            app.data.labelVersions.find((v) => v.id === review.label_version_id)
              ?.version
          }{" "}
          · Phạm vi hỗ trợ hiện tại: ghi nhãn thực phẩm theo quy định liên bang
          Hoa Kỳ
        </div>
      </div>
      {app.mode === "demo" && (
        <div style={{ marginBottom: 14 }}>
          <InlineNotice tone="warning">
            Demo: dữ liệu ký duyệt là dữ liệu mẫu tổng hợp; không phải phê duyệt
            sản phẩm, kết luận pháp lý hoặc quyết định của FDA.
          </InlineNotice>
        </div>
      )}
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
          Bằng chứng, trích dẫn nguồn, bản ghi nguồn và quyết định của chuyên
          viên đã đủ điều kiện để tạo báo cáo. Kết quả vẫn có thể là “Cần chỉnh
          sửa” hoặc “Chưa đủ thông tin”.
        </InlineNotice>
      )}
      <div style={{ marginTop: 22 }}>
        <Textarea
          label="Lý do/ghi chú ký duyệt nội bộ"
          required
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Ghi rõ phạm vi, căn cứ quyết định và những giới hạn còn lại…"
          hint="Tối thiểu 10 ký tự. Lý do được lưu cùng lượt rà soát và bản ghi báo cáo bất biến."
        />
      </div>
      <div
        className="approval-signoff-preview"
        data-testid="approval-signoff-preview"
      >
        <div>
          <span>Mã người duyệt nội bộ</span>
          <strong>{app.actor.id}</strong>
          <small>{app.actor.name}</small>
        </div>
        <div>
          <span>Kết quả dự kiến</span>
          <strong>
            {disposition
              ? RESULT_LABELS[disposition]
              : `Chờ quyết định · ${openFindings} phát hiện chưa xử lý`}
          </strong>
        </div>
        <div>
          <span>Lý do ký duyệt</span>
          <p>{comment.trim() || "Nhập lý do ký duyệt báo cáo nội bộ Vexim."}</p>
        </div>
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
      app.notify("Đã thêm phát hiện thủ công.");
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
      title="Thêm phát hiện thủ công"
      description="Gắn bằng chứng thực tế và nguồn từ danh mục. Trích dẫn chưa xác minh sẽ tiếp tục chờ chuyên viên."
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
            <Plus size={15} /> Thêm phát hiện
          </Button>
        </>
      }
    >
      <Input
        label="Tiêu đề phát hiện"
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
        label="Bằng chứng — nguyên văn trên nhãn"
        required
        value={text}
        onChange={(e) => setText(e.target.value)}
        hint={
          evidence?.bbox
            ? "Gắn vào vùng nhãn đang được chọn trên màn hình rà soát."
            : "Chưa chọn vùng trên nhãn. Chuyên viên cần đối chiếu tệp / trang trong hồ sơ."
        }
      />
      <Select
        label="Nguồn tham chiếu"
        value={citation}
        onChange={(e) => setCitation(e.target.value)}
      >
        <option value="">Trích dẫn chờ chuyên viên xác minh</option>
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
          Chưa có dữ liệu trích xuất của phiên bản trước; chỉ so sánh ảnh gốc,
          không suy đoán khác biệt.
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
  const draftOnlyDemo = isSyntheticDemoReview(review);
  const [editing, setEditing] = useState<ExtractedField | null>(null);
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const lowFields = lowConfidenceOcrFields(label.extracted_fields);
  const save = async () => {
    if (!editing) return;
    setBusy(true);
    try {
      await app.updateField(label.id, editing.id, value, reason);
      app.notify(
        "Đã lưu nội dung đã xác minh; file gốc không thay đổi. Hãy chạy lại bộ quy tắc.",
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
        description="Giữ nguyên câu chữ và tọa độ bằng chứng. Khi chỉnh nội dung đã trích xuất, cần nêu lý do và chạy lại bộ quy tắc."
        wide
        footer={
          <>
            <Button variant="secondary" onClick={onClose}>
              Đóng
            </Button>
            {editable && !isSyntheticDemoReview(review) && (
              <Button
                onClick={() =>
                  void app
                    .rerunReview(review.id, "rules")
                    .then(() => {
                      onClose();
                      app.notify(
                        "Đang chạy lại bộ quy tắc trên nội dung đã trích xuất.",
                        "info",
                      );
                    })
                    .catch((e) => app.notify(errorMessage(e), "error"))
                }
              >
                <RefreshCw size={14} /> Chạy lại bộ quy tắc
              </Button>
            )}
          </>
        }
      >
        {lowFields.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <InlineNotice tone="warning" icon={<CircleAlert size={15} />}>
              {lowFields.length} trường OCR (nhận dạng chữ) dưới 70% độ tin cậy.
              Hãy đối chiếu từng trường với nhãn gốc; độ tin cậy thấp không phải
              kết luận về tuân thủ.
            </InlineNotice>
          </div>
        )}
        <div className="field-list">
          {label.extracted_fields.map((f) => {
            const isLowConfidence = lowFields.some(
              (field) => field.id === f.id,
            );
            return (
              <div
                key={f.id}
                className={clsx(
                  "field-list-item",
                  isLowConfidence && "field-list-item-low",
                )}
              >
                <div>
                  <strong>{fieldLabels[f.field] ?? f.field}</strong>
                  {isLowConfidence && (
                    <Badge tone="red">
                      OCR &lt;70% · {Math.round(f.confidence * 100)}%
                    </Badge>
                  )}
                  <p>{f.value ?? "Chưa phát hiện · không tự điền dữ liệu"}</p>
                  <small>
                    {f.extraction_model} ·{" "}
                    {f.manually_verified
                      ? "Đã xác minh thủ công"
                      : `${Math.round(f.confidence * 100)}% độ tin cậy`}{" "}
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
            );
          })}
          {!label.extracted_fields.length && (
            <EmptyState
              title={
                draftOnlyDemo
                  ? "Chưa có dữ liệu OCR"
                  : "Chưa có dữ liệu trích xuất"
              }
              description={
                draftOnlyDemo
                  ? "Hồ sơ mẫu chỉ chứa hình nhãn tĩnh. Không có tác vụ OCR hoặc kết quả cần xác minh."
                  : "Chờ quy trình hoàn tất hoặc chạy lại từ bước nhận dạng chữ (OCR)."
              }
            />
          )}
        </div>
      </Modal>
      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={`Xác minh ${fieldLabels[editing?.field ?? ""] ?? editing?.field}`}
        description="Bằng chứng gốc được giữ lại. Chỉnh nội dung là quyết định của người rà soát, không phải một lần nhận dạng chữ mới."
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
        "Đã gửi yêu cầu chạy lại. Theo dõi tiến độ trên màn hình rà soát.",
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
      title="Chạy lại một phần quy trình"
      description="Giữ nguyên file gốc và các bước trước đó. Mọi phát hiện được tạo lại cần chuyên viên xác nhận."
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
        <option value="ocr">
          Nhận dạng chữ (OCR) → trích xuất → bộ quy tắc
        </option>
        <option value="rules">
          Bộ quy tắc → xác minh (giữ nguyên nội dung đã trích xuất)
        </option>
      </Select>
      <div style={{ marginTop: 20 }}>
        <InlineNotice tone="warning">
          Quyết định xác nhận / loại trừ cũ không được tự dùng lại. Báo cáo đã
          phát hành không bị chỉnh sửa; lượt rà soát đã đóng cần phiên bản nhãn
          mới.
        </InlineNotice>
      </div>
      <div style={{ marginTop: 20 }}>
        <Checkbox checked={confirmed} onChange={setConfirmed}>
          Tôi đồng ý tạo lại các phát hiện và xác nhận lại quyết định xử lý.
        </Checkbox>
      </div>
    </Modal>
  );
}
