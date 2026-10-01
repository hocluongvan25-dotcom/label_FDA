"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import clsx from "clsx";
import {
  ArrowRight,
  BookOpen,
  CheckCheck,
  Download,
  Eye,
  FileCheck2,
  FileJson2,
  FileText,
  Plus,
  Search,
  ShieldCheck,
} from "lucide-react";
import { useApp } from "./app-provider";
import {
  Avatar,
  Badge,
  Button,
  Card,
  EmptyState,
  IconButton,
  InlineNotice,
  Modal,
  PageHeader,
  Select,
  SeverityBadge,
  StatusBadge,
  TeaThumbnail,
} from "./ui";
import { ProductsTable } from "./products-table";
import type { Report, Severity } from "@/lib/types";
import { can } from "@/lib/permissions";
import { RESULT_LABELS, STATUS_META } from "@/lib/constants";
import {
  errorMessage,
  findingCounts,
  formatDate,
  highestSeverity,
  isCompleted,
  needsAction,
} from "@/lib/utils";

export function ProductsPage() {
  const app = useApp();
  const params = useSearchParams();
  if (!can(app.actor, "products"))
    return (
      <Card>
        <EmptyState
          title="Vai trò này không quản lý hồ sơ sản phẩm"
          description="Regulatory Admin làm việc với source registry và compliance rules. Trong demo, đổi persona tại Cài đặt để xem quy trình chuyên viên."
          icon={<ShieldCheck size={28} />}
          action={
            <Link href="/sources" className="btn btn-primary">
              Mở source registry
            </Link>
          }
        />
      </Card>
    );
  return (
    <div className="page">
      <PageHeader
        eyebrow="PRODUCT DOSSIERS"
        title="Hồ sơ sản phẩm"
        description="Một nơi cho thông tin sản phẩm, công thức, nhãn và toàn bộ lịch sử rà soát."
        actions={
          <Link href="/products/new" className="btn btn-primary">
            <Plus size={16} /> Tạo hồ sơ mới
          </Link>
        }
      />
      <ProductsTable initialTab={params.get("tab") ?? "all"} />
      <div style={{ marginTop: 20 }}>
        <InlineNotice icon={<FileText size={16} />}>
          Mỗi phiên bản nhãn được lưu riêng, không ghi đè file gốc. Kết quả
          review và báo cáo luôn gắn với một phiên bản cụ thể.
        </InlineNotice>
      </div>
    </div>
  );
}
export function ReviewsPage() {
  const app = useApp();
  const params = useSearchParams();
  const [tab, setTab] = useState(params.get("tab") ?? "action");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const reviews = app.data.reviews
    .filter((r) => {
      const p = app.data.products.find((p) => p.id === r.product_id);
      return (
        (tab === "all" ||
          (tab === "action" && needsAction(r.status)) ||
          (tab === "processing" &&
            ["PROCESSING", "WAITING_FOR_CUSTOMER"].includes(r.status)) ||
          (tab === "completed" && isCompleted(r.status))) &&
        (status === "all" || r.status === status) &&
        `${p?.name} ${p?.brand}`.toLowerCase().includes(query.toLowerCase())
      );
    })
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  const tabs = [
    [
      "action",
      "Cần xử lý",
      app.data.reviews.filter((r) => needsAction(r.status)).length,
    ],
    [
      "processing",
      "Đang xử lý / chờ dữ liệu",
      app.data.reviews.filter((r) =>
        ["PROCESSING", "WAITING_FOR_CUSTOMER"].includes(r.status),
      ).length,
    ],
    [
      "completed",
      "Hoàn tất",
      app.data.reviews.filter((r) => isCompleted(r.status)).length,
    ],
    ["all", "Tất cả", app.data.reviews.length],
  ];
  return (
    <div className="page">
      <PageHeader
        eyebrow="REVIEW WORKSPACE"
        title="Không gian rà soát"
        description="Ưu tiên hồ sơ cần chuyên viên. Đối chiếu nhãn, finding và citation trong cùng một workspace."
        actions={
          can(app.actor, "products") && (
            <Link className="btn btn-secondary" href="/products">
              <FileCheck2 size={15} /> Danh sách sản phẩm
            </Link>
          )
        }
      />
      <Card style={{ marginBottom: 20 }}>
        <div className="table-tabs" style={{ paddingTop: 16 }}>
          {tabs.map(([id, text, count]) => (
            <button
              key={id}
              className={clsx(tab === id && "active")}
              onClick={() => setTab(String(id))}
            >
              {text}
              <span>{count}</span>
            </button>
          ))}
        </div>
        <div className="queue-toolbar">
          <div className="table-search">
            <Search size={16} />
            <input
              value={query}
              aria-label="Tìm review"
              placeholder="Tìm sản phẩm đang rà soát…"
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div style={{ width: 200 }}>
            <Select
              aria-label="Lọc trạng thái review"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              style={{ minHeight: 32, padding: "7px 10px", fontSize: 11 }}
            >
              <option value="all">Tất cả trạng thái</option>
              {Object.entries(STATUS_META).map(([key, m]) => (
                <option key={key} value={key}>
                  {m.label}
                </option>
              ))}
            </Select>
          </div>
        </div>
      </Card>
      <div className="queue-grid">
        {reviews.map((r) => {
          const p = app.data.products.find((p) => p.id === r.product_id)!;
          const label = app.data.labelVersions.find(
            (v) => v.id === r.label_version_id,
          );
          const fs = app.data.findings.filter((f) => f.review_id === r.id);
          const counts = findingCounts(fs);
          const highest = highestSeverity(fs);
          return (
            <Card className="queue-card" key={r.id}>
              <div className="queue-card-header">
                <TeaThumbnail color={p.color} form={p.form} />
                <StatusBadge status={r.status} />
              </div>
              <div>
                <h3>{p.name}</h3>
                <p>
                  {
                    app.data.organizations.find(
                      (o) => o.id === p.organization_id,
                    )?.name
                  }{" "}
                  · Nhãn v{label?.version}
                </p>
              </div>
              <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
                {highest ? (
                  Object.entries(counts)
                    .filter(([, n]) => n > 0)
                    .map(([s, n]) => (
                      <SeverityBadge
                        key={s}
                        severity={s as Severity}
                        count={n}
                      />
                    ))
                ) : (
                  <Badge>
                    {r.status === "PROCESSING"
                      ? `Tiến độ ${r.progress}%`
                      : "Chưa ghi nhận finding"}
                  </Badge>
                )}
              </div>
              <div className="queue-card-footer">
                <span>{formatDate(r.updated_at, true)}</span>
                <Link
                  href={`/reviews/${r.id}`}
                  className="btn btn-secondary btn-sm"
                >
                  {can(app.actor, "review") ? "Rà soát" : "Xem kết quả"}{" "}
                  <ArrowRight size={13} />
                </Link>
              </div>
            </Card>
          );
        })}
      </div>
      {!reviews.length && (
        <Card>
          <EmptyState
            title="Không có review phù hợp"
            description="Thử đổi trạng thái hoặc bỏ tìm kiếm. Bạn có thể tạo hồ sơ và tải nhãn để bắt đầu."
            action={
              <Button
                variant="secondary"
                onClick={() => {
                  setQuery("");
                  setStatus("all");
                  setTab("all");
                }}
              >
                Xem tất cả review
              </Button>
            }
          />
        </Card>
      )}
    </div>
  );
}
export function ReportsPage() {
  const app = useApp();
  const params = useSearchParams();
  const [query, setQuery] = useState("");
  const [result, setResult] = useState("all");
  const [selectedId, setSelectedId] = useState(params.get("report") ?? "");
  const [busy, setBusy] = useState("");
  const target = params.get("report");
  const reviewTarget = params.get("review");
  useEffect(() => {
    if (target) setSelectedId(target);
    else if (reviewTarget)
      setSelectedId(
        app.data.reports.find((r) => r.review_id === reviewTarget)?.id ?? "",
      );
  }, [target, reviewTarget, app.data.reports]);
  const reports = app.data.reports
    .filter(
      (r) =>
        (result === "all" || r.snapshot.result === result) &&
        `${r.report_number} ${r.snapshot.product.name} ${r.snapshot.product.brand}`
          .toLowerCase()
          .includes(query.toLowerCase()),
    )
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const selected = app.data.reports.find((r) => r.id === selectedId);
  const download = async (r: Report, format: "pdf" | "json") => {
    setBusy(`${r.id}:${format}`);
    try {
      await app.downloadReport(r.id, format);
      app.notify(`Đã tải ${format.toUpperCase()} · ${r.report_number}`);
    } catch (e) {
      app.notify(errorMessage(e), "error");
    } finally {
      setBusy("");
    }
  };
  return (
    <div className="page">
      <PageHeader
        eyebrow="HUMAN-APPROVED REPORTS"
        title="Báo cáo rà soát"
        description="Snapshot bất biến: phiên bản nhãn, finding, nguồn tham chiếu và quyết định của người rà soát."
        actions={
          <Badge tone="green">
            <CheckCheck size={13} /> {app.data.reports.length} báo cáo được
            chuyên viên xác nhận
          </Badge>
        }
      />
      <Card>
        <div className="card-header">
          <h2>Danh sách báo cáo</h2>
          <Badge>{reports.length}</Badge>
        </div>
        <div className="queue-toolbar">
          <div className="table-search">
            <Search size={16} />
            <input
              aria-label="Tìm báo cáo"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Tìm mã báo cáo hoặc sản phẩm…"
            />
          </div>
          <div style={{ width: 230 }}>
            <Select
              aria-label="Lọc kết quả báo cáo"
              value={result}
              onChange={(e) => setResult(e.target.value)}
              style={{ minHeight: 32, fontSize: 11, padding: "7px 10px" }}
            >
              <option value="all">Tất cả kết quả</option>
              <option value="NEEDS_CORRECTION">Cần chỉnh sửa</option>
              <option value="NO_ISSUE_DETECTED_IN_SCOPE">
                Chưa phát hiện vấn đề trong phạm vi
              </option>
              <option value="INSUFFICIENT_INFORMATION">
                Chưa đủ thông tin
              </option>
            </Select>
          </div>
        </div>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>BÁO CÁO / SẢN PHẨM</th>
                <th>PHIÊN BẢN</th>
                <th>KẾT QUẢ</th>
                <th>CHUYÊN VIÊN</th>
                <th>PHÁT HÀNH</th>
                <th>TẢI BÁO CÁO</th>
              </tr>
            </thead>
            <tbody>
              {reports.map((r) => (
                <tr key={r.id}>
                  <td>
                    <div className="report-cell">
                      <span className="report-icon">
                        <FileText size={19} />
                      </span>
                      <div>
                        <strong>{r.snapshot.product.name}</strong>
                        <span>
                          {r.report_number}
                          {r.snapshot.demo && " · DEMO"}
                        </span>
                      </div>
                    </div>
                  </td>
                  <td>
                    <Badge>Nhãn v{r.snapshot.label_version.version}</Badge>
                  </td>
                  <td>
                    <Badge
                      tone={
                        r.snapshot.result === "NEEDS_CORRECTION"
                          ? "orange"
                          : r.snapshot.result === "INSUFFICIENT_INFORMATION"
                            ? "amber"
                            : "green"
                      }
                    >
                      {r.snapshot.result === "NO_ISSUE_DETECTED_IN_SCOPE"
                        ? "Chưa phát hiện vấn đề trong phạm vi"
                        : RESULT_LABELS[r.snapshot.result]}
                    </Badge>
                  </td>
                  <td>
                    <div
                      style={{ display: "flex", gap: 7, alignItems: "center" }}
                    >
                      <Avatar name={r.snapshot.reviewer.name} size="sm" />
                      {r.snapshot.reviewer.name}
                    </div>
                  </td>
                  <td>{formatDate(r.created_at)}</td>
                  <td>
                    <div className="table-actions">
                      <IconButton
                        label={`Xem báo cáo ${r.report_number}`}
                        onClick={() => setSelectedId(r.id)}
                      >
                        <Eye size={15} />
                      </IconButton>
                      <Button
                        variant="secondary"
                        size="sm"
                        loading={busy === `${r.id}:pdf`}
                        onClick={() => void download(r, "pdf")}
                      >
                        <Download size={12} /> PDF
                      </Button>
                      <IconButton
                        label={`Tải JSON ${r.report_number}`}
                        onClick={() => void download(r, "json")}
                        disabled={!!busy}
                      >
                        <FileJson2 size={15} />
                      </IconButton>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!reports.length && (
            <EmptyState
              title="Chưa có báo cáo phù hợp"
              description="Báo cáo chỉ xuất hiện sau khi chuyên viên xử lý các finding và phê duyệt nội dung."
              icon={<BookOpen size={29} />}
              action={
                <Link href="/reviews" className="btn btn-secondary">
                  Mở không gian rà soát
                </Link>
              }
            />
          )}
        </div>
        <div className="table-pagination">
          <span>
            {reports.length} báo cáo · mọi lượt tải được ghi audit log
          </span>
          <span>PDF dành cho khách hàng · JSON dành cho hệ thống</span>
        </div>
      </Card>
      <div style={{ marginTop: 22 }}>
        <InlineNotice icon={<ShieldCheck size={17} />}>
          “Phê duyệt báo cáo” là quyết định nội bộ của chuyên viên Vexim, không
          phải sự phê duyệt của FDA. Kết quả chỉ áp dụng cho phiên bản nhãn và
          phạm vi ghi trong báo cáo.
        </InlineNotice>
      </div>
      <Modal
        open={!!selected}
        onClose={() => setSelectedId("")}
        title="Báo cáo rà soát nhãn"
        description={selected?.report_number}
        wide
        footer={
          selected && (
            <>
              <Button
                variant="secondary"
                loading={busy === `${selected.id}:json`}
                onClick={() => void download(selected, "json")}
              >
                <FileJson2 size={15} /> Tải JSON
              </Button>
              <Button
                loading={busy === `${selected.id}:pdf`}
                onClick={() => void download(selected, "pdf")}
              >
                <Download size={15} /> Tải báo cáo PDF
              </Button>
            </>
          )
        }
      >
        {selected && <ReportPreview report={selected} />}
      </Modal>
    </div>
  );
}
function ReportPreview({ report }: { report: Report }) {
  const s = report.snapshot;
  return (
    <div className="report-preview">
      <div className="report-preview-header">
        <div>
          <h3>{s.product.name}</h3>
          <p>
            {s.product.brand} · Nhãn v{s.label_version.version} ·{" "}
            {formatDate(s.generated_at, true)}
          </p>
        </div>
        <Badge tone="green">
          <FileCheck2 size={13} /> Chuyên viên đã xác nhận
        </Badge>
      </div>
      {s.demo && (
        <div style={{ marginBottom: 18 }}>
          <InlineNotice tone="warning">
            BÁO CÁO MẪU — không dùng kết quả này cho hồ sơ, nhãn thực hoặc tư
            vấn pháp lý.
          </InlineNotice>
        </div>
      )}
      <div className="report-result-box">
        <span>KẾT QUẢ TRONG PHẠM VI RÀ SOÁT</span>
        <h3>{RESULT_LABELS[s.result]}</h3>
      </div>
      <dl className="description-list">
        <dt>Review scope</dt>
        <dd>{s.review_scope}</dd>
        <dt>Phiên bản nhãn</dt>
        <dd>
          v{s.label_version.version} · {s.label_version.original_files.length}{" "}
          file gốc
        </dd>
        <dt>Chuyên viên</dt>
        <dd>
          {s.reviewer.name} · {formatDate(s.reviewer.approved_at, true)}
        </dd>
        <dt>Ghi chú xác nhận</dt>
        <dd>{s.reviewer.comment}</dd>
      </dl>
      <h3 style={{ fontSize: 12, marginBottom: 14 }}>Findings & hành động</h3>
      {s.findings.length ? (
        s.findings.map((f) => (
          <div
            className="field-list-item"
            key={f.id}
            style={{ marginBottom: 12 }}
          >
            <div>
              <SeverityBadge severity={f.severity} />
              <h3 style={{ marginTop: 10 }}>{f.title}</h3>
              <p>{f.description}</p>
              <p>
                <strong>Đề xuất:</strong> {f.suggested_action}
              </p>
              {f.evidence.map((e, i) => (
                <blockquote
                  key={i}
                  className="evidence-quote"
                  style={{ marginTop: 9 }}
                >
                  {e.text}
                </blockquote>
              ))}
              <p className="tiny">
                {f.citation_ids
                  .map(
                    (id) =>
                      s.sources.find((source) => source.id === id)?.citation ??
                      "Citation pending human review",
                  )
                  .join(" · ")}
              </p>
              <small>
                {FINDING_STATUS_LABELS[f.status]} · {f.reviewer_comment}
              </small>
            </div>
          </div>
        ))
      ) : (
        <p className="tiny muted" style={{ marginBottom: 18 }}>
          Không có finding trong snapshot được duyệt. Kết quả không suy rộng ra
          ngoài phạm vi rà soát.
        </p>
      )}
      <h3 style={{ fontSize: 12, marginBottom: 14 }}>
        Nguồn đóng băng trong báo cáo
      </h3>
      <div className="knowledge-citations" style={{ marginBottom: 18 }}>
        {s.sources.map((source) => (
          <article key={source.id}>
            <strong>
              {source.citation} · v{source.version}
            </strong>
            <p className="tiny muted">
              {source.raw_snapshot_id
                ? `Issue ${source.issue_date} · Raw SHA-256 ${source.raw_content_hash}`
                : `Section SHA-256 ${source.content_hash ?? "Chưa xác minh"}`}
            </p>
            <p className="tiny muted">
              Tải{" "}
              {source.retrieved_at
                ? formatDate(source.retrieved_at, true)
                : "Chưa xác minh"}{" "}
              · Hiệu lực {source.effective_from ?? "Unknown"} →{" "}
              {source.effective_to ?? "Chưa có mốc kết thúc"}
            </p>
            {source.raw_snapshot_id && source.effective_date_unknown && (
              <Badge tone="amber">Effective date chưa xác định</Badge>
            )}
            <a
              href={source.canonical_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-link"
            >
              Mở edition đã dùng trong báo cáo
            </a>
          </article>
        ))}
      </div>
      <InlineNotice icon={<InfoIcon />}>{s.disclaimer}</InlineNotice>
      <div style={{ marginTop: 22 }}>
        <h3 style={{ fontSize: 11, marginBottom: 12 }}>Lịch sử phiên bản</h3>
        {s.version_history.map((v) => (
          <p key={v.version} className="tiny muted" style={{ marginTop: 7 }}>
            Nhãn v{v.version} · {formatDate(v.uploaded_at, true)}
            {v.version === s.label_version.version
              ? " · Phiên bản được rà soát"
              : ""}
          </p>
        ))}
      </div>
    </div>
  );
}
import { FINDING_STATUS_LABELS } from "@/lib/constants";
function InfoIcon() {
  return <ShieldCheck size={17} />;
}
