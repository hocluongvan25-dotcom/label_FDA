"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import clsx from "clsx";
import {
  ArrowUpRight,
  BookOpen,
  Check,
  CheckCheck,
  CircleAlert,
  ClipboardCheck,
  FlaskConical,
  History,
  LockKeyhole,
  Pencil,
  Plus,
  Search,
  ShieldCheck,
} from "lucide-react";
import { useApp } from "./app-provider";
import { isApiError } from "@/lib/supabase";
import {
  Badge,
  Button,
  Card,
  Checkbox,
  EmptyState,
  ExternalLink,
  IconButton,
  InlineNotice,
  Input,
  Modal,
  PageHeader,
  Select,
  SeverityBadge,
  Textarea,
} from "./ui";
import type {
  ComplianceRule,
  GuidanceReviewSummary,
  RegulatorySource,
  Severity,
} from "@/lib/types";
import { can } from "@/lib/permissions";
import {
  bindingEffectLabels,
  bindingEffects,
  guidanceApprovalBlockers,
  guidanceChecklistKeys,
  guidanceChecklistLabels,
  guidanceReviewInputSchema,
  guidanceStatusLabels,
  guidanceStatuses,
  isGuidanceDocument,
  missingGuidanceChecklist,
  translateGuidanceError,
  type BindingEffect,
  type GuidanceChecklist,
  type GuidanceReviewInput,
  type GuidanceStatus,
} from "@/lib/regulatory-guidance";
import { sourceFieldLabels, validateRegulatorySource } from "@/lib/validation";
import {
  errorMessage,
  formatDate,
  now,
  sourceIsCurrent,
  uid,
} from "@/lib/utils";
import { RULE_CATALOG } from "@/lib/regulatory";
import { SEVERITY_META } from "@/lib/constants";
import type { RegressionResult } from "@/lib/regression";
import { REQUIRED_ACTIVE_RULES } from "@/lib/pipeline-status";

const topicLabels: Record<string, string> = {
  identity: "Tên gọi thực phẩm",
  net_quantity: "Khối lượng",
  ingredients: "Nguyên liệu",
  nutrition_labeling: "Nutrition Facts",
  allergens: "Dị nguyên",
  claims: "Claims",
  responsible_party: "Đơn vị chịu trách nhiệm",
  readability: "Trình bày nhãn",
  exemption: "Exemption",
  organic: "Organic",
  general: "Nhãn thực phẩm",
};
const sourceTone = (status: string) =>
  status === "CURRENT" || status === "ACTIVE"
    ? "green"
    : status === "DRAFT"
      ? "amber"
      : status === "UNAVAILABLE"
        ? "red"
        : "neutral";
export function SourcesPage() {
  const app = useApp();
  const params = useSearchParams();
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState("all");
  const [topic, setTopic] = useState("all");
  const [selectedId, setSelectedId] = useState(params.get("source") ?? "");
  const [editing, setEditing] = useState<RegulatorySource | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [approvalOpen, setApprovalOpen] = useState(false);
  const [regressions, setRegressions] = useState<
    Record<string, { hash: string; passed: boolean }>
  >({});
  const fromQuery = params.get("source");
  useEffect(() => {
    if (fromQuery) setSelectedId(fromQuery);
  }, [fromQuery]);
  if (app.actor.role.startsWith("customer"))
    return (
      <Card>
        <EmptyState
          title="Source registry dành cho nhân viên Vexim"
          description="Các citation áp dụng cho sản phẩm của bạn xuất hiện trong finding và báo cáo. Bạn không có quyền truy cập toàn bộ registry."
          icon={<LockKeyhole size={28} />}
        />
      </Card>
    );
  const editable = can(app.actor, "regulatory");
  const sources = app.data.sources
    .filter(
      (s) =>
        (tab === "all" || s.status === tab) &&
        (topic === "all" || s.topic === topic) &&
        `${s.citation} ${s.title} ${s.agency}`
          .toLowerCase()
          .includes(query.toLowerCase()),
    )
    .sort(
      (a, b) => a.priority - b.priority || a.citation.localeCompare(b.citation),
    );
  const selected = app.data.sources.find((s) => s.id === selectedId);
  const affectedRules = selected
    ? app.data.rules.filter(
        (r) =>
          r.status === "ACTIVE" && r.source_citations.includes(selected.id),
      ).length
    : 0;
  const regressionFresh =
    !!selected?.content_hash &&
    regressions[selected.id]?.hash === selected.content_hash &&
    regressions[selected.id]?.passed === true;
  const guidanceBlockers =
    selected && selected.status === "DRAFT"
      ? guidanceApprovalBlockers({
          source: selected,
          actorId: app.actor.id,
          affectedRules,
          regressionFresh,
        })
      : [];
  const reviewGuidance = async (input: GuidanceReviewInput) => {
    if (!selected) return;
    try {
      await app.reviewGuidanceSource(selected.id, input);
      app.notify("Đã ghi nhận đánh giá chuyên gia. Cần admin khác phê duyệt.");
    } catch (e) {
      app.notify(translateGuidanceError(errorMessage(e)), "error");
      throw e;
    }
  };
  const runRegression = async () => {
    if (!selected?.content_hash) {
      app.notify(
        "Nguồn chưa có bản chụp nội dung để chạy regression.",
        "error",
      );
      return;
    }
    try {
      const passed = await app.runSourceRegression(
        selected.id,
        selected.content_hash,
      );
      setRegressions((r) => ({
        ...r,
        [selected.id]: { hash: selected.content_hash as string, passed },
      }));
      app.notify(
        passed
          ? "Regression đạt. Có thể ghi nhận đánh giá chuyên gia."
          : "Regression chưa đạt (15/15). Xem chi tiết và xử lý trước khi duyệt.",
        passed ? "success" : "error",
      );
    } catch (e) {
      app.notify(translateGuidanceError(errorMessage(e)), "error");
    }
  };
  const create = () => {
    setFieldErrors({});
    setEditing({
      id: uid(),
      source_key: "",
      authority: "FDA",
      agency: "FDA",
      document_type: "guidance",
      citation: "",
      title: "",
      canonical_url: "",
      topic: "general",
      status: "DRAFT",
      priority: 4,
      retrieved_at: now(),
      effective_from: null,
      effective_to: null,
      content_hash: null,
      content_excerpt: "",
      approved_by: null,
      approved_at: null,
      version: 1,
      updated_at: now(),
    });
  };
  const save = async () => {
    if (!editing) return;
    const invalid = validateRegulatorySource(editing);
    if (Object.keys(invalid).length) {
      setFieldErrors(invalid);
      app.notify(
        `${Object.keys(invalid).length} trường chưa hợp lệ: ${
          invalid[Object.keys(invalid)[0]]
        }`,
        "error",
      );
      return;
    }
    setBusy(true);
    try {
      if (
        !editing.source_key.trim() ||
        !editing.citation.trim() ||
        !editing.title.trim()
      )
        throw new Error("Cần source key, citation và tên tài liệu.");
      if (
        editing.effective_from &&
        editing.effective_to &&
        editing.effective_from > editing.effective_to
      )
        throw new Error("Ngày kết thúc phải sau ngày bắt đầu hiệu lực.");
      await app.saveSource(editing);
      app.notify("Đã tạo draft nguồn. Cần Regulatory Admin khác xác nhận.");
      setEditing(null);
      setFieldErrors({});
    } catch (e) {
      // The server repeats the same per-field validation; show it next to the input.
      if (isApiError(e) && e.fields.length)
        setFieldErrors(
          Object.fromEntries(e.fields.map((f) => [f.path, f.message])),
        );
      app.notify(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  };
  const approve = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      await app.approveSource(selected.id);
      app.notify("Đã phê duyệt snapshot nguồn.");
      setApprovalOpen(false);
      setConfirm(false);
    } catch (e) {
      app.notify(translateGuidanceError(errorMessage(e)), "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="page">
      <PageHeader
        eyebrow="REGULATORY SOURCE REGISTRY"
        title="Nguồn pháp lý"
        description="Chỉ dùng nguồn có phiên bản, thời điểm truy xuất, hash và xác nhận của chuyên gia."
        actions={
          <>
            <Link href="/knowledge" className="btn btn-secondary">
              <BookOpen size={16} /> Đồng bộ eCFR / Federal Register
            </Link>
            {editable ? (
              <Button onClick={create}>
                <Plus size={16} /> Thêm nguồn tham chiếu
              </Button>
            ) : (
              <Badge>
                <ShieldCheck size={13} /> Quyền xem · Regulatory Admin quản lý
              </Badge>
            )}
          </>
        }
      />
      <div className="regulatory-stats">
        <div>
          <strong>
            {app.data.sources.filter((s) => sourceIsCurrent(s)).length}
          </strong>{" "}
          nguồn hiện hành
        </div>
        <div>
          <strong>
            {app.data.sources.filter((s) => s.status === "DRAFT").length}
          </strong>{" "}
          chờ phê duyệt
        </div>
        <div>
          <strong>
            {
              app.data.sources.filter(
                (s) =>
                  s.status === "UNAVAILABLE" ||
                  (s.effective_to &&
                    s.effective_to < new Date().toISOString().slice(0, 10)),
              ).length
            }
          </strong>{" "}
          cần kiểm tra lại
        </div>
      </div>
      <Card>
        <div className="table-tabs" style={{ paddingTop: 18 }}>
          {[
            ["all", "Tất cả"],
            ["CURRENT", "Hiện hành"],
            ["DRAFT", "Chờ duyệt"],
            ["SUPERSEDED", "Đã thay thế"],
          ].map(([id, label]) => (
            <button
              key={id}
              className={clsx(tab === id && "active")}
              onClick={() => setTab(id)}
            >
              {label}
              <span>
                {id === "all"
                  ? app.data.sources.length
                  : app.data.sources.filter((s) => s.status === id).length}
              </span>
            </button>
          ))}
        </div>
        <div className="queue-toolbar">
          <div className="table-search">
            <Search size={16} />
            <input
              aria-label="Tìm nguồn pháp lý"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Citation, tên tài liệu, cơ quan…"
            />
          </div>
          <div style={{ width: 190 }}>
            <Select
              aria-label="Lọc chủ đề nguồn"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              style={{ fontSize: 9, minHeight: 32, padding: "7px 10px" }}
            >
              <option value="all">Tất cả chủ đề</option>
              {Object.entries(topicLabels).map(([key, text]) => (
                <option value={key} key={key}>
                  {text}
                </option>
              ))}
            </Select>
          </div>
        </div>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>CITATION / TÀI LIỆU</th>
                <th>CƠ QUAN</th>
                <th>CHỦ ĐỀ</th>
                <th>PHIÊN BẢN</th>
                <th>TRẠNG THÁI</th>
                <th>TRUY XUẤT</th>
                <th>
                  <span className="sr-only">Mở nguồn</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {sources.map((s) => (
                <tr key={s.id}>
                  <td style={{ maxWidth: 360 }}>
                    <button
                      className="text-button source-row-title"
                      style={{ textAlign: "left", fontWeight: 500 }}
                      onClick={() => setSelectedId(s.id)}
                    >
                      {s.citation}
                    </button>
                    <span className="source-row-sub">{s.title}</span>
                  </td>
                  <td>{s.agency}</td>
                  <td>
                    <Badge>{topicLabels[s.topic] ?? s.topic}</Badge>
                  </td>
                  <td>v{s.version}</td>
                  <td>
                    <Badge tone={sourceTone(s.status)} dot>
                      {s.status === "CURRENT"
                        ? "Hiện hành"
                        : s.status === "DRAFT"
                          ? "Chờ phê duyệt"
                          : s.status === "SUPERSEDED"
                            ? "Đã thay thế"
                            : "Không sẵn sàng"}
                    </Badge>
                  </td>
                  <td>
                    {s.retrieved_at
                      ? formatDate(s.retrieved_at)
                      : "Chưa truy xuất"}
                  </td>
                  <td>
                    <IconButton
                      label={`Xem ${s.citation}`}
                      onClick={() => setSelectedId(s.id)}
                    >
                      <ArrowUpRight size={15} />
                    </IconButton>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!sources.length && (
            <EmptyState
              title="Không có nguồn phù hợp"
              description="Thử chủ đề khác hoặc bỏ tìm kiếm. Nguồn mới luôn bắt đầu ở trạng thái draft."
              icon={<BookOpen size={28} />}
            />
          )}
        </div>
        <div className="table-pagination">
          <span>
            {sources.length} tài liệu · ưu tiên regulation trước guidance
          </span>
          <span>Không cho phép citation ngoài registry</span>
        </div>
      </Card>
      <div style={{ marginTop: 20 }}>
        <InlineNotice icon={<ShieldCheck size={16} />}>
          Seed production chỉ chứa metadata nguồn ở trạng thái DRAFT. Nội dung
          và hiệu lực phải được đối chiếu với tài liệu chính thức; khi nguồn
          thay đổi, review cũ phải kiểm tra lại trước khi phát hành báo cáo.
        </InlineNotice>
      </div>
      <Modal
        open={!!selected && !editing && !approvalOpen}
        onClose={() => setSelectedId("")}
        title={selected?.citation ?? "Nguồn tham chiếu"}
        description={selected?.title}
        wide
        footer={
          <>
            <Button variant="secondary" onClick={() => setSelectedId("")}>
              Đóng
            </Button>
            {editable && selected && !selected.raw_snapshot_id && (
              <Button
                variant="secondary"
                onClick={() => {
                  setFieldErrors({});
                  setEditing({ ...selected });
                }}
              >
                <Pencil size={14} /> Tạo bản draft mới
              </Button>
            )}
            {editable &&
              selected?.status === "DRAFT" &&
              !selected.raw_snapshot_id && (
                <Button
                  onClick={() => {
                    setApprovalOpen(true);
                    setConfirm(false);
                  }}
                >
                  <CheckCheck size={15} /> Phê duyệt nguồn
                </Button>
              )}
          </>
        }
      >
        {selected && (
          <>
            {selected.raw_snapshot_id && (
              <InlineNotice tone="info">
                Nguồn từ API · issue {selected.issue_date} ·{" "}
                {selected.ingestion_status}. Raw SHA-256:{" "}
                <code style={{ overflowWrap: "anywhere" }}>
                  {selected.raw_content_hash}
                </code>
                <br />
                <Link
                  href={`/knowledge?snapshot=${selected.raw_snapshot_id}`}
                  className="text-link"
                >
                  Mở snapshot / kiểm tra version và raw
                </Link>
              </InlineNotice>
            )}
            <div className="source-meta">
              <Badge tone={sourceTone(selected.status)}>
                {selected.status}
              </Badge>
              <Badge>v{selected.version}</Badge>
              <Badge>{selected.agency}</Badge>
              <Badge>Ưu tiên {selected.priority}</Badge>
              <ExternalLink href={selected.canonical_url}>
                Văn bản chính thức
              </ExternalLink>
            </div>
            <dl
              className="description-list source-detail"
              style={{ padding: 0 }}
            >
              <dt>Source key</dt>
              <dd>{selected.source_key}</dd>
              <dt>Truy xuất</dt>
              <dd>
                {selected.retrieved_at
                  ? formatDate(selected.retrieved_at, true)
                  : "Chưa có bản chụp nguồn"}
              </dd>
              <dt>Hiệu lực</dt>
              <dd>
                {selected.effective_from ?? "Chưa xác minh ngày bắt đầu"} →{" "}
                {selected.effective_to ?? "Chưa ghi nhận ngày kết thúc"}
              </dd>
              <dt>Người phê duyệt</dt>
              <dd>
                {selected.approved_by ?? "Chưa được duyệt"}
                {selected.approved_at &&
                  ` · ${formatDate(selected.approved_at, true)}`}
              </dd>
              <dt>SHA-256 snapshot</dt>
              <dd className="source-hash">
                {app.mode === "demo" && selected.content_hash === "d".repeat(64)
                  ? "HASH MẪU — KHÔNG PHẢI BẢN CHỤP TÀI LIỆU THỰC"
                  : (selected.content_hash ?? "Chưa có")}
              </dd>
              <dt>Rules tham chiếu</dt>
              <dd>
                {app.data.rules
                  .filter(
                    (r) =>
                      r.source_citations.includes(selected.id) &&
                      r.status === "ACTIVE",
                  )
                  .map((r) => `${r.rule_key} v${r.version}`)
                  .join(", ") || "Chưa có rule active sử dụng"}
              </dd>
            </dl>
            {isGuidanceDocument(selected.document_type) &&
              selected.status === "DRAFT" && (
                <GuidanceExpertReview
                  source={selected}
                  actorId={app.actor.id}
                  affectedRules={affectedRules}
                  regressionFresh={regressionFresh}
                  onSubmit={(input) => reviewGuidance(input)}
                  onRunRegression={() => runRegression()}
                  busy={busy}
                />
              )}
            <h3 style={{ fontSize: 12, marginTop: 23 }}>
              Nội dung snapshot / trích đoạn đã lưu
            </h3>
            <div className="source-excerpt">
              {selected.content_excerpt ||
                "Chưa có nội dung nguồn. Không sử dụng metadata này làm căn cứ pháp lý trước khi truy xuất, ghi hiệu lực và được chuyên gia phê duyệt."}
            </div>
            <h3 style={{ fontSize: 12, marginTop: 22 }}>Lịch sử thay đổi</h3>
            {app.data.audit
              .filter(
                (a) =>
                  a.entity_id === selected.id && a.action.startsWith("source"),
              )
              .slice(0, 6)
              .map((a) => (
                <div className="regression-row" key={a.id}>
                  <span>{a.action}</span>
                  <div>
                    {a.actor_name} · {formatDate(a.created_at, true)}
                  </div>
                </div>
              ))}
            {!app.data.audit.some((a) => a.entity_id === selected.id) && (
              <p className="tiny muted" style={{ marginTop: 8 }}>
                Chưa ghi nhận thay đổi sau khi nhập seed.
              </p>
            )}
          </>
        )}
      </Modal>
      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title="Draft nguồn tham chiếu"
        description="Lưu snapshot nội dung, ngày hiệu lực và citation. SHA-256 được tính từ nội dung đã lưu; cần người khác phê duyệt."
        wide
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)}>
              Hủy
            </Button>
            <Button loading={busy} onClick={() => void save()}>
              Lưu draft nguồn
            </Button>
          </>
        }
      >
        {editing && (
          <>
            {Object.keys(fieldErrors).length > 0 && (
              <InlineNotice tone="error" icon={<CircleAlert size={16} />}>
                {Object.entries(fieldErrors)
                  .map(
                    ([path, message]) =>
                      `${sourceFieldLabels[path] ?? path}: ${message}`,
                  )
                  .join(" · ")}
              </InlineNotice>
            )}
            <div className="form-grid">
              <Input
                label="Source key"
                required
                value={editing.source_key}
                error={fieldErrors.source_key}
                onChange={(e) =>
                  setEditing({ ...editing, source_key: e.target.value })
                }
              />
              <Input
                label="Citation"
                required
                value={editing.citation}
                error={fieldErrors.citation}
                onChange={(e) =>
                  setEditing({ ...editing, citation: e.target.value })
                }
              />
              <div className="span-2">
                <Input
                  label="Tên tài liệu"
                  required
                  value={editing.title}
                  error={fieldErrors.title}
                  onChange={(e) =>
                    setEditing({ ...editing, title: e.target.value })
                  }
                />
              </div>
              <div className="span-2">
                <Input
                  label="URL chính thức (HTTPS)"
                  required
                  value={editing.canonical_url}
                  error={fieldErrors.canonical_url}
                  onChange={(e) =>
                    setEditing({ ...editing, canonical_url: e.target.value })
                  }
                  hint="Allowlist: eCFR, FDA, U.S. Code, govinfo, USDA AMS, CBP, Federal Register."
                />
              </div>
              <Select
                label="Cơ quan"
                value={editing.agency}
                error={fieldErrors.agency}
                onChange={(e) =>
                  setEditing({ ...editing, agency: e.target.value })
                }
              >
                <option>FDA</option>
                <option>USDA AMS</option>
                <option>CBP</option>
                <option>U.S. Congress</option>
              </Select>
              <Select
                label="Loại tài liệu / độ ưu tiên"
                value={editing.document_type}
                error={fieldErrors.document_type}
                onChange={(e) => {
                  const d = e.target.value;
                  setEditing({
                    ...editing,
                    document_type: d,
                    priority: (
                      {
                        regulation: 1,
                        statute: 2,
                        amendment: 3,
                        guidance: 4,
                        faq: 5,
                        secondary: 6,
                      } as Record<string, number>
                    )[d],
                  });
                }}
              >
                <option value="regulation">Regulation · 1</option>
                <option value="statute">Statute / U.S. Code · 2</option>
                <option value="amendment">
                  Federal Register amendment · 3
                </option>
                <option value="guidance">Official guidance · 4</option>
                <option value="faq">FAQ / Enforcement · 5</option>
              </Select>
              <Select
                label="Chủ đề"
                value={editing.topic}
                error={fieldErrors.topic}
                onChange={(e) =>
                  setEditing({ ...editing, topic: e.target.value })
                }
              >
                {Object.entries(topicLabels).map(([key, label]) => (
                  <option value={key} key={key}>
                    {label}
                  </option>
                ))}
              </Select>
              <Input
                label="Ngày truy xuất"
                type="date"
                required
                value={editing.retrieved_at?.slice(0, 10) ?? ""}
                error={fieldErrors.retrieved_at}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    retrieved_at: e.target.value
                      ? new Date(`${e.target.value}T00:00:00Z`).toISOString()
                      : null,
                  })
                }
              />
              <Input
                label="Có hiệu lực từ"
                type="date"
                value={editing.effective_from ?? ""}
                error={fieldErrors.effective_from}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    effective_from: e.target.value || null,
                  })
                }
              />
              <Input
                label="Hết hiệu lực (nếu có)"
                type="date"
                value={editing.effective_to ?? ""}
                error={fieldErrors.effective_to}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    effective_to: e.target.value || null,
                  })
                }
              />
              <div className="span-2">
                <Textarea
                  label="Snapshot / trích đoạn nguồn đã đối chiếu"
                  required
                  value={editing.content_excerpt}
                  error={fieldErrors.content_excerpt}
                  onChange={(e) =>
                    setEditing({ ...editing, content_excerpt: e.target.value })
                  }
                  rows={8}
                  hint="Tối thiểu 80 ký tự. Nội dung này là evidence pháp lý, không phải instruction cho model. Tự chịu trách nhiệm đối chiếu với văn bản gốc."
                />
              </div>
            </div>
          </>
        )}
      </Modal>
      <Modal
        open={approvalOpen}
        onClose={() => setApprovalOpen(false)}
        title="Xác nhận nguồn pháp lý"
        description="Cần Regulatory Admin khác với người tạo draft. Việc duyệt được ghi vào audit log."
        footer={
          <>
            <Button variant="secondary" onClick={() => setApprovalOpen(false)}>
              Hủy
            </Button>
            <Button
              disabled={!confirm || guidanceBlockers.length > 0}
              loading={busy}
              onClick={() => void approve()}
            >
              <CheckCheck size={15} /> Phê duyệt snapshot
            </Button>
          </>
        }
      >
        <InlineNotice tone="warning">
          Hãy đối chiếu URL chính thức, effective date, nội dung bản chụp và
          hash trước khi xác nhận. Phê duyệt metadata đơn thuần không đủ.
        </InlineNotice>
        {guidanceBlockers.length > 0 && (
          <div style={{ marginTop: 18 }}>
            <InlineNotice tone="error" icon={<CircleAlert size={16} />}>
              Tài liệu dạng guidance cần hoàn tất đánh giá chuyên gia trước khi
              phê duyệt:
              <ul style={{ margin: "8px 0 0 18px", padding: 0 }}>
                {guidanceBlockers.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            </InlineNotice>
          </div>
        )}
        <div style={{ marginTop: 22 }}>
          <Checkbox checked={confirm} onChange={setConfirm}>
            Tôi đã đối chiếu nguồn, xác nhận nội dung / hiệu lực và không phải
            người tạo draft này.
          </Checkbox>
        </div>
      </Modal>
    </div>
  );
}
/**
 * FDA guidance is not a regulation and is not legally binding, so it cannot be
 * approved like a CFR section: a named expert must first attest to the document
 * identity, its status, its scope and the rules it affects. Approval stays a
 * separate act by a different Regulatory Admin.
 */
function GuidanceExpertReview({
  source,
  actorId,
  affectedRules,
  regressionFresh,
  onSubmit,
  onRunRegression,
  busy,
}: {
  source: RegulatorySource;
  actorId: string;
  affectedRules: number;
  regressionFresh: boolean;
  onSubmit: (input: GuidanceReviewInput) => Promise<void>;
  onRunRegression: () => Promise<void>;
  busy: boolean;
}) {
  const review: GuidanceReviewSummary | null = source.expert_review ?? null;
  const fresh =
    !!review &&
    review.source_version === source.version &&
    review.content_hash === source.content_hash;
  const [checklist, setChecklist] = useState<GuidanceChecklist>({});
  const [guidanceStatus, setGuidanceStatus] = useState<GuidanceStatus>("final");
  const [bindingEffect, setBindingEffect] =
    useState<BindingEffect>("non_binding");
  const [scopeNote, setScopeNote] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const toggle = (key: string, value: boolean) =>
    setChecklist((c) => ({ ...c, [key]: value ? "true" : "false" }));
  const submit = async () => {
    const parsed = guidanceReviewInputSchema.safeParse({
      checklist,
      guidance_status: guidanceStatus,
      binding_effect: bindingEffect,
      scope_note: scopeNote,
    });
    if (!parsed.success) {
      setErrors(
        Object.fromEntries(
          parsed.error.issues.map((i) => [
            String(i.path[i.path.length - 1] ?? "form"),
            i.message,
          ]),
        ),
      );
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      await onSubmit(parsed.data);
      setChecklist({});
      setScopeNote("");
    } finally {
      setSaving(false);
    }
  };
  if (fresh && review)
    return (
      <div style={{ marginTop: 22 }}>
        <h3 style={{ fontSize: 12 }}>Đánh giá chuyên gia · FDA Guidance</h3>
        <InlineNotice icon={<ClipboardCheck size={16} />}>
          Đã ghi nhận đánh giá chuyên gia v{review.source_version} ·{" "}
          {guidanceStatusLabels[review.guidance_status as GuidanceStatus] ??
            review.guidance_status}{" "}
          ·{" "}
          {review.binding_effect === "non_binding"
            ? "không ràng buộc pháp lý"
            : "được ghi nhận là ràng buộc pháp lý"}
          {review.created_at ? ` · ${formatDate(review.created_at, true)}` : ""}
        </InlineNotice>
        <p className="tiny muted" style={{ marginTop: 10 }}>
          Phạm vi áp dụng đã ghi nhận: {review.scope_note}
        </p>
        <p className="tiny" style={{ marginTop: 8 }}>
          {review.reviewer === actorId
            ? "Bạn là người đánh giá chuyên gia văn bản này. Phê duyệt phải do một Regulatory Admin khác thực hiện."
            : "Bước tiếp theo: một Regulatory Admin khác (không phải người đánh giá) phê duyệt nguồn này."}
        </p>
      </div>
    );
  return (
    <div style={{ marginTop: 22 }}>
      <h3 style={{ fontSize: 12 }}>Đánh giá chuyên gia · FDA Guidance</h3>
      <InlineNotice tone="warning" icon={<ClipboardCheck size={16} />}>
        Guidance của FDA không phải quy định và không ràng buộc pháp lý. Trước
        khi được phê duyệt, một Regulatory Admin phải ghi nhận đánh giá chuyên
        gia (đúng văn bản, tình trạng, hiệu lực, phạm vi áp dụng).{" "}
        {review
          ? `Đánh giá gần nhất đã cũ (v${review.source_version}); cần đánh giá lại phiên bản hiện tại.`
          : "Nguồn này chưa có đánh giá chuyên gia."}
      </InlineNotice>
      <div className="form-grid" style={{ marginTop: 16 }}>
        <Select
          label="Tình trạng văn bản"
          value={guidanceStatus}
          onChange={(e) => setGuidanceStatus(e.target.value as GuidanceStatus)}
        >
          {guidanceStatuses.map((s) => (
            <option key={s} value={s}>
              {guidanceStatusLabels[s]}
            </option>
          ))}
        </Select>
        <Select
          label="Hiệu lực pháp lý"
          value={bindingEffect}
          hint="Guidance FDA mặc định không ràng buộc."
          onChange={(e) => setBindingEffect(e.target.value as BindingEffect)}
        >
          {bindingEffects.map((b) => (
            <option key={b} value={b}>
              {bindingEffectLabels[b]}
            </option>
          ))}
        </Select>
        <div className="span-2">
          <Textarea
            label="Phạm vi và điều kiện áp dụng"
            required
            rows={3}
            value={scopeNote}
            error={errors.scope_note}
            onChange={(e) => setScopeNote(e.target.value)}
            hint="Tối thiểu 40 ký tự: áp dụng cho loại sản phẩm/claim nào, ngoại lệ nào, phần nào của văn bản được dùng làm căn cứ."
          />
        </div>
      </div>
      <div
        style={{
          marginTop: 14,
          display: "flex",
          flexDirection: "column",
          gap: 9,
        }}
      >
        {guidanceChecklistKeys.map((key) => (
          <Checkbox
            key={key}
            checked={checklist[key] === "true"}
            onChange={(v) => toggle(key, v)}
          >
            {guidanceChecklistLabels[key]}
          </Checkbox>
        ))}
        {guidanceStatus === "draft" && (
          <Checkbox
            checked={checklist.draft_guidance_ack === "true"}
            onChange={(v) => toggle("draft_guidance_ack", v)}
          >
            Draft guidance không phải căn cứ bắt buộc; tôi xác nhận điều này và
            chỉ dùng văn bản để giải thích cách FDA dự định áp dụng luật.
          </Checkbox>
        )}
      </div>
      {Object.keys(errors).length > 0 && (
        <p className="tiny" style={{ marginTop: 10, color: "var(--red-600)" }}>
          {Object.entries(errors)
            .map(([, message]) => message)
            .join(" · ")}
        </p>
      )}
      {affectedRules > 0 && (
        <div style={{ marginTop: 14 }}>
          <p className="tiny">
            Có <b>{affectedRules}</b> rule đang hoạt động trích dẫn nguồn này.
            Regression phải đạt trên đúng hash hiện tại trước khi ghi nhận đánh
            giá chuyên gia.
          </p>
          <div
            style={{
              display: "flex",
              gap: 10,
              alignItems: "center",
              marginTop: 8,
            }}
          >
            <Button
              variant="secondary"
              loading={busy}
              onClick={() => void onRunRegression()}
            >
              <FlaskConical size={15} /> Chạy regression rule bị ảnh hưởng
            </Button>
            <Badge tone={regressionFresh ? "green" : "amber"} dot>
              {regressionFresh ? "Regression đạt" : "Chưa có regression đạt"}
            </Badge>
          </div>
        </div>
      )}
      <div
        style={{
          marginTop: 16,
          display: "flex",
          gap: 12,
          alignItems: "center",
        }}
      >
        <Button loading={saving} onClick={() => void submit()}>
          <CheckCheck size={15} /> Ghi nhận đánh giá chuyên gia
        </Button>
        <span className="tiny muted">
          Còn {missingGuidanceChecklist(checklist).length} mục checklist chưa
          xác nhận
        </span>
      </div>
    </div>
  );
}
/**
 * Activation runbook. The rule set is never activated automatically: fake law
 * text, hashes or approvals would silently produce fake compliance results.
 */
function RulesActivationGuide({
  active,
  sourcesCurrent,
}: {
  active: number;
  sourcesCurrent: number;
}) {
  const [open, setOpen] = useState(true);
  const steps = [
    {
      title: "1. Có nguồn thật, còn hiệu lực",
      body: `Chạy regulatory worker để đồng bộ eCFR (\`npm run regulatory:worker -- --schedule\`) tạo raw snapshot có hash + issue date và DRAFT chunks, hoặc đăng ký nguồn thủ công tại Nguồn tham chiếu (trích dẫn ≥ 80 ký tự, retrieved_at, canonical URL). Nguồn mới luôn ở DRAFT. Hiện có ${sourcesCurrent} nguồn hiện hành.`,
    },
    {
      title: "2. Admin A kiểm tra checklist",
      body: "Mở snapshot DRAFT trong Kho tri thức pháp quy: xác nhận 9 mục checklist (api_url, issue_date, source_title, hash, parser_complete, citations_traceable, jurisdiction, affected_rules, effective_date), phân loại thay đổi và ngày hiệu lực (hoặc đánh dấu chưa xác định kèm lý do).",
    },
    {
      title: "3. Admin B kích hoạt độc lập",
      body: "Một Regulatory Admin khác (không phải người tạo) kích hoạt snapshot: regression phải đạt trên cùng raw hash, parser và citation hợp lệ. Sau đó nguồn chuyển CURRENT và chunks được APPROVED.",
    },
    {
      title: "4. Tạo / cập nhật đủ 15 rule draft",
      body: "Tại trang này, mỗi rule gắn đúng nguồn CURRENT, condition/action hợp lệ và rule_key nằm trong 15 key của MVP (IDENTITY-001 … CLASS-001).",
    },
    {
      title: "5. Chạy regression trên rule draft",
      body: "15 fixture phải passed, test_hash khớp definition_hash và nguồn trích dẫn không được thay đổi trong lúc chạy.",
    },
    {
      title: "6. Admin B duyệt rule",
      body: "Người khác duyệt (không phải người tạo rule). Rule chuyển ACTIVE, phiên bản cũ được giữ lại. Không thể tự duyệt rule do mình tạo; System Admin không có quyền này.",
    },
    {
      title: "7. Xác nhận trước khi nhận hồ sơ thật",
      body: `Trang này phải hiển thị 15 rules active (đang có ${active}). Khi chưa đủ, review dừng ở SOURCE_UNAVAILABLE và hệ thống không được trả kết luận “không phát hiện vấn đề”.`,
    },
  ];
  return (
    <Card className="activation-guide">
      <div className="card-header">
        <h2>Hướng dẫn kích hoạt bộ quy tắc ({active}/15 đang hoạt động)</h2>
        <button className="text-button" onClick={() => setOpen(!open)}>
          {open ? "Thu gọn" : "Mở hướng dẫn"}
        </button>
      </div>
      <div className="settings-card-body">
        <InlineNotice tone="warning" icon={<CircleAlert size={16} />}>
          Bộ quy tắc không bao giờ được kích hoạt tự động. Nội dung luật, hash
          và chữ ký phê duyệt phải thật; hệ thống không tạo sẵn nội dung luật để
          tránh kết luận tuân thủ giả.
        </InlineNotice>
        {open && (
          <div className="guide-steps" style={{ marginTop: 22 }}>
            {steps.map((s) => (
              <div key={s.title}>
                <span>
                  <ClipboardCheck size={17} />
                </span>
                <div>
                  <h3>{s.title}</h3>
                  <p>{s.body}</p>
                </div>
              </div>
            ))}
          </div>
        )}
        <div style={{ display: "flex", gap: 12, marginTop: 18 }}>
          <Link href="/knowledge" className="btn btn-ghost">
            Kho tri thức pháp quy <ArrowUpRight size={13} />
          </Link>
          <Link href="/sources" className="btn btn-ghost">
            Nguồn tham chiếu <ArrowUpRight size={13} />
          </Link>
        </div>
      </div>
    </Card>
  );
}
export function RulesPage() {
  const app = useApp();
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState("ACTIVE");
  const [selectedId, setSelectedId] = useState("");
  const [editing, setEditing] = useState<ComplianceRule | null>(null);
  const [detailTab, setDetailTab] = useState("detail");
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<RegressionResult[] | null>(null);
  const [approvalOpen, setApprovalOpen] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  if (app.actor.role.startsWith("customer"))
    return (
      <Card>
        <EmptyState
          title="Quy tắc kiểm tra dành cho Vexim staff"
          description="Khách hàng có thể xem finding và citation áp dụng trong báo cáo, nhưng không thể chỉnh sửa regulatory rules."
          icon={<LockKeyhole size={28} />}
        />
      </Card>
    );
  const editable = can(app.actor, "regulatory");
  const rules = app.data.rules
    .filter(
      (r) =>
        (tab === "all" || r.status === tab) &&
        `${r.rule_key} ${r.name}`.toLowerCase().includes(query.toLowerCase()),
    )
    .sort(
      (a, b) => a.rule_key.localeCompare(b.rule_key) || b.version - a.version,
    );
  const selected = app.data.rules.find((r) => r.id === selectedId);
  const previous =
    selected &&
    app.data.rules
      .filter(
        (r) => r.rule_key === selected.rule_key && r.version < selected.version,
      )
      .sort((a, b) => b.version - a.version)[0];
  const create = () => {
    const base = RULE_CATALOG[0];
    setEditing({
      ...structuredClone(base),
      id: uid(),
      version:
        Math.max(
          0,
          ...app.data.rules
            .filter((r) => r.rule_key === base.rule_key)
            .map((r) => r.version),
        ) + 1,
      created_by: app.actor.id,
      updated_at: now(),
    });
  };
  const save = async () => {
    if (!editing) return;
    setBusy(true);
    try {
      await app.saveRule(editing);
      app.notify(
        "Đã lưu rule draft. Cần regression test và người khác phê duyệt.",
      );
      setEditing(null);
      setTab("DRAFT");
    } catch (e) {
      app.notify(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  };
  const test = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      const r = await app.testRule(selected.id);
      setResults(r);
      app.notify(
        `Regression fixtures: ${r.filter((x) => x.passed).length}/${r.length} passed. Không phải bộ đánh giá beta AI.`,
      );
    } catch (e) {
      app.notify(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  };
  const approve = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      await app.approveRule(selected.id);
      app.notify("Đã kích hoạt rule, phiên bản trước được giữ lại.");
      setApprovalOpen(false);
      setSelectedId("");
      setTab("ACTIVE");
    } catch (e) {
      app.notify(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="page">
      <PageHeader
        eyebrow="DETERMINISTIC COMPLIANCE RULES"
        title="Quy tắc kiểm tra"
        description="15 kiểm tra xác định cho MVP trà. Phiên bản mới cần QA, citation hiện hành và người duyệt độc lập."
        actions={
          editable ? (
            <Button onClick={create}>
              <Plus size={16} /> Tạo rule draft
            </Button>
          ) : (
            <Badge>
              <ShieldCheck size={13} /> Chỉ xem
            </Badge>
          )
        }
      />
      <div className="regulatory-stats">
        <div>
          <strong>
            {app.data.rules.filter((r) => r.status === "ACTIVE").length}
          </strong>{" "}
          rules active
        </div>
        <div>
          <strong>
            {app.data.rules.filter((r) => r.status === "DRAFT").length}
          </strong>{" "}
          drafts cần duyệt
        </div>
        <div>
          <strong>
            {app.data.rules.filter((r) => r.status === "SUPERSEDED").length}
          </strong>{" "}
          phiên bản lưu lịch sử
        </div>
      </div>
      {app.data.rules.filter((r) => r.status === "ACTIVE").length <
        REQUIRED_ACTIVE_RULES && (
        <RulesActivationGuide
          active={app.data.rules.filter((r) => r.status === "ACTIVE").length}
          sourcesCurrent={
            app.data.sources.filter((s) => sourceIsCurrent(s)).length
          }
        />
      )}
      <Card>
        <div className="table-tabs" style={{ paddingTop: 18 }}>
          {[
            ["ACTIVE", "Đang hoạt động"],
            ["DRAFT", "Draft"],
            ["SUPERSEDED", "Đã thay thế"],
            ["all", "Tất cả"],
          ].map(([key, label]) => (
            <button
              key={key}
              className={clsx(tab === key && "active")}
              onClick={() => setTab(key)}
            >
              {label}
              <span>
                {key === "all"
                  ? app.data.rules.length
                  : app.data.rules.filter((r) => r.status === key).length}
              </span>
            </button>
          ))}
        </div>
        <div className="queue-toolbar">
          <div className="table-search">
            <Search size={16} />
            <input
              aria-label="Tìm quy tắc"
              placeholder="Rule key hoặc nội dung kiểm tra…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <span className="tiny muted">Scope: trà khô & trà túi lọc</span>
        </div>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>RULE KEY</th>
                <th>NỘI DUNG KIỂM TRA</th>
                <th>SEVERITY</th>
                <th>VERSION</th>
                <th>HIỆU LỰC</th>
                <th>QA</th>
                <th>TRẠNG THÁI</th>
                <th>
                  <span className="sr-only">Chi tiết rule</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rules.map((r) => (
                <tr key={r.id}>
                  <td>
                    <button
                      className="text-button"
                      onClick={() => {
                        setSelectedId(r.id);
                        setDetailTab("detail");
                      }}
                    >
                      <span className="rule-key">{r.rule_key}</span>
                    </button>
                  </td>
                  <td style={{ whiteSpace: "normal", maxWidth: 270 }}>
                    <strong className="source-row-title">{r.name}</strong>
                    <span className="source-row-sub">
                      {r.source_citations
                        .map(
                          (id) =>
                            app.data.sources.find((s) => s.id === id)
                              ?.citation ?? "Nguồn chưa xác định",
                        )
                        .join(" · ")}
                    </span>
                  </td>
                  <td>
                    <SeverityBadge severity={r.action_json.severity} />
                  </td>
                  <td>v{r.version}</td>
                  <td>{r.effective_from ?? "Chưa có"}</td>
                  <td>
                    <Badge
                      tone={
                        r.test_status === "passed"
                          ? "green"
                          : r.test_status === "failed"
                            ? "red"
                            : "neutral"
                      }
                    >
                      {r.test_status === "passed"
                        ? "Passed"
                        : r.test_status === "failed"
                          ? "Failed"
                          : "Chờ test"}
                    </Badge>
                  </td>
                  <td>
                    <Badge tone={sourceTone(r.status)}>{r.status}</Badge>
                  </td>
                  <td>
                    <IconButton
                      label={`Xem ${r.rule_key}`}
                      onClick={() => {
                        setSelectedId(r.id);
                        setDetailTab("detail");
                      }}
                    >
                      <ArrowUpRight size={15} />
                    </IconButton>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rules.length && (
            <EmptyState
              title="Chưa có quy tắc ở trạng thái này"
              description="Nguồn production và 15 rules khởi tạo ở trạng thái draft; cần được chuyên gia duyệt trước khi chạy thật."
              icon={<ClipboardCheck size={29} />}
            />
          )}
        </div>
        <div className="table-pagination">
          <span>
            {rules.length} phiên bản rule · không xóa phiên bản đã có hiệu lực
          </span>
          <span>Draft → QA → Regulatory approval → Active</span>
        </div>
      </Card>
      <div style={{ marginTop: 22 }}>
        <InlineNotice icon={<FlaskConical size={17} />}>
          Regression test ở đây kiểm tra 15 tình huống deterministic fixtures.
          Không thay thế dataset được regulatory reviewer gắn ground truth, cũng
          không chứng minh đạt các ngưỡng recall / citation correctness trước
          beta.
        </InlineNotice>
      </div>
      <Modal
        open={!!selected && !editing && !results && !approvalOpen}
        onClose={() => setSelectedId("")}
        title={`${selected?.rule_key ?? ""} · v${selected?.version ?? ""}`}
        description={selected?.name}
        wide
        footer={
          <>
            <Button variant="secondary" onClick={() => setSelectedId("")}>
              Đóng
            </Button>
            {editable && selected && (
              <Button
                variant="secondary"
                onClick={() => setEditing(structuredClone(selected))}
              >
                <Pencil size={14} />{" "}
                {selected.status === "ACTIVE"
                  ? "Tạo phiên bản mới"
                  : "Sửa draft"}
              </Button>
            )}
            {editable && (
              <Button
                variant="secondary"
                loading={busy}
                onClick={() => void test()}
              >
                <FlaskConical size={15} /> Chạy regression
              </Button>
            )}
            {editable && selected?.status === "DRAFT" && (
              <Button
                disabled={selected.test_status !== "passed"}
                onClick={() => {
                  setApprovalOpen(true);
                  setConfirmed(false);
                }}
              >
                <CheckCheck size={14} /> Phê duyệt
              </Button>
            )}
          </>
        }
      >
        {selected && (
          <>
            <div
              className="table-tabs"
              style={{ padding: 0, marginBottom: 21 }}
            >
              {[
                ["detail", "Chi tiết"],
                ["json", "Schema JSON"],
                ["diff", "Diff phiên bản"],
              ].map(([key, text]) => (
                <button
                  className={clsx(detailTab === key && "active")}
                  key={key}
                  onClick={() => setDetailTab(key)}
                >
                  {text}
                </button>
              ))}
            </div>
            {detailTab === "detail" && (
              <>
                <div className="source-meta">
                  <Badge tone={sourceTone(selected.status)}>
                    {selected.status}
                  </Badge>
                  <SeverityBadge severity={selected.action_json.severity} />
                  <Badge>
                    {selected.action_json.human_review
                      ? "Bắt buộc human review"
                      : "Human review ở cấp báo cáo"}
                  </Badge>
                </div>
                <dl className="description-list" style={{ padding: 0 }}>
                  <dt>Scope</dt>
                  <dd>{selected.scope.join(", ")}</dd>
                  <dt>Kiểu điều kiện</dt>
                  <dd>{String(selected.condition_json.type)}</dd>
                  <dt>Hiệu lực</dt>
                  <dd>
                    {selected.effective_from ?? "Chưa xác minh"} →{" "}
                    {selected.effective_to ?? "Chưa ghi nhận ngày kết thúc"}
                  </dd>
                  <dt>Người tạo</dt>
                  <dd>{selected.created_by}</dd>
                  <dt>Người duyệt</dt>
                  <dd>{selected.approved_by ?? "Chưa được phê duyệt"}</dd>
                  <dt>Hành động đề xuất</dt>
                  <dd>{selected.action_json.suggested_action}</dd>
                  <dt>Citation</dt>
                  <dd>
                    {selected.source_citations
                      .map(
                        (id) =>
                          app.data.sources.find((s) => s.id === id)?.citation ??
                          "Citation không tồn tại",
                      )
                      .join("; ")}
                  </dd>
                </dl>
              </>
            )}
            {detailTab === "json" && (
              <pre className="rule-detail-json">
                {JSON.stringify(
                  {
                    scope: selected.scope,
                    condition_json: selected.condition_json,
                    action_json: selected.action_json,
                    source_citations: selected.source_citations,
                  },
                  null,
                  2,
                )}
              </pre>
            )}
            {detailTab === "diff" &&
              (previous ? (
                <div className="compare-grid">
                  <div>
                    <h3>
                      v{previous.version} · {previous.status}
                    </h3>
                    <pre className="rule-detail-json">
                      {JSON.stringify(
                        {
                          name: previous.name,
                          condition: previous.condition_json,
                          action: previous.action_json,
                          citations: previous.source_citations,
                        },
                        null,
                        2,
                      )}
                    </pre>
                  </div>
                  <div>
                    <h3>
                      v{selected.version} · {selected.status}
                    </h3>
                    <pre className="rule-detail-json">
                      {JSON.stringify(
                        {
                          name: selected.name,
                          condition: selected.condition_json,
                          action: selected.action_json,
                          citations: selected.source_citations,
                        },
                        null,
                        2,
                      )}
                    </pre>
                  </div>
                </div>
              ) : (
                <EmptyState
                  title="Đây là phiên bản đầu tiên"
                  description="Khi có draft kế tiếp, diff giữa các phiên bản sẽ xuất hiện tại đây."
                  icon={<History size={28} />}
                />
              ))}
          </>
        )}
      </Modal>
      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title="Chỉnh rule draft"
        description="MVP dùng 15 evaluator xác định, không cho phép thực thi code / instruction được nhập tự do."
        wide
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)}>
              Hủy
            </Button>
            <Button loading={busy} onClick={() => void save()}>
              Lưu draft
            </Button>
          </>
        }
      >
        {editing && (
          <>
            <div className="form-grid">
              <Select
                label="Rule key / evaluator"
                value={editing.rule_key}
                disabled={app.data.rules.some((r) => r.id === editing.id)}
                onChange={(e) => {
                  const base = RULE_CATALOG.find(
                    (r) => r.rule_key === e.target.value,
                  )!;
                  setEditing({
                    ...structuredClone(base),
                    id: editing.id,
                    version:
                      Math.max(
                        0,
                        ...app.data.rules
                          .filter((r) => r.rule_key === base.rule_key)
                          .map((r) => r.version),
                      ) + 1,
                    created_by: app.actor.id,
                  });
                }}
              >
                {RULE_CATALOG.map((r) => (
                  <option key={r.rule_key} value={r.rule_key}>
                    {r.rule_key} · {r.name}
                  </option>
                ))}
              </Select>
              <Input
                label="Tên quy tắc"
                value={editing.name}
                onChange={(e) =>
                  setEditing({ ...editing, name: e.target.value })
                }
                required
              />
              <Select
                label="Severity mặc định"
                value={editing.action_json.severity}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    action_json: {
                      ...editing.action_json,
                      severity: e.target.value as Severity,
                    },
                  })
                }
              >
                {Object.entries(SEVERITY_META).map(([key, m]) => (
                  <option value={key} key={key}>
                    {m.label}
                  </option>
                ))}
              </Select>
              <Input
                label="OCR threshold"
                type="number"
                min="0"
                max="1"
                step="0.05"
                value={Number(editing.condition_json.ocr_threshold ?? 0.75)}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    condition_json: {
                      ...editing.condition_json,
                      ocr_threshold: Number(e.target.value),
                    },
                  })
                }
              />
              <Input
                label="Có hiệu lực từ"
                type="date"
                value={editing.effective_from ?? ""}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    effective_from: e.target.value || null,
                  })
                }
              />
              <Input
                label="Hết hiệu lực (nếu có)"
                type="date"
                value={editing.effective_to ?? ""}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    effective_to: e.target.value || null,
                  })
                }
              />
              <div className="span-2">
                <Textarea
                  label="Hành động đề xuất"
                  value={editing.action_json.suggested_action}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      action_json: {
                        ...editing.action_json,
                        suggested_action: e.target.value,
                      },
                    })
                  }
                  required
                />
              </div>
              <div className="span-2">
                <Checkbox
                  checked={editing.action_json.human_review}
                  onChange={(checked) =>
                    setEditing({
                      ...editing,
                      action_json: {
                        ...editing.action_json,
                        human_review: checked,
                      },
                    })
                  }
                >
                  Finding bắt buộc human review (mọi báo cáo vẫn cần chuyên viên
                  duyệt)
                </Checkbox>
              </div>
            </div>
            <div className="field-label" style={{ margin: "23px 0 15px" }}>
              Nguồn trong registry
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 14,
              }}
            >
              {app.data.sources.map((s) => (
                <Checkbox
                  key={s.id}
                  checked={editing.source_citations.includes(s.id)}
                  onChange={(checked) =>
                    setEditing({
                      ...editing,
                      source_citations: checked
                        ? [...editing.source_citations, s.id]
                        : editing.source_citations.filter((id) => id !== s.id),
                    })
                  }
                >
                  {s.citation}{" "}
                  <Badge tone={sourceTone(s.status)}>{s.status}</Badge>
                </Checkbox>
              ))}
            </div>
          </>
        )}
      </Modal>
      <Modal
        open={!!results}
        onClose={() => setResults(null)}
        title="Kết quả regression fixtures"
        description="Bộ 15 tình huống deterministic; không phải bài đo chất lượng AI beta."
        wide
        footer={<Button onClick={() => setResults(null)}>Đóng kết quả</Button>}
      >
        {results && (
          <>
            <InlineNotice
              tone={results.every((r) => r.passed) ? "success" : "error"}
            >
              {results.filter((r) => r.passed).length}/{results.length} tình
              huống vượt qua kiểm tra.
            </InlineNotice>
            <div style={{ marginTop: 20 }}>
              {results.map((r) => (
                <div className="regression-row" key={r.rule_key}>
                  <span>{r.rule_key}</span>
                  <span style={{ flex: 1, fontFamily: "inherit", fontSize: 9 }}>
                    {r.name}
                  </span>
                  <div>
                    {r.passed ? <Check size={14} /> : <CircleAlert size={14} />}{" "}
                    {r.passed ? "Passed" : r.actual}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </Modal>
      <Modal
        open={approvalOpen}
        onClose={() => setApprovalOpen(false)}
        title="Phê duyệt phiên bản rule"
        description="Người tạo không tự phê duyệt. Rule cũ được đánh dấu SUPERSEDED, không bị xóa."
        footer={
          <>
            <Button variant="secondary" onClick={() => setApprovalOpen(false)}>
              Hủy
            </Button>
            <Button
              loading={busy}
              disabled={!confirmed}
              onClick={() => void approve()}
            >
              <CheckCheck size={15} /> Kích hoạt rule
            </Button>
          </>
        }
      >
        <InlineNotice tone="warning">
          Nguồn phải hiện hành, regression test đã passed và effective date hợp
          lệ. Các thay đổi Critical / Major cần được chuyên gia đối chiếu với bộ
          nhãn ground truth trước beta.
        </InlineNotice>
        <div style={{ marginTop: 22 }}>
          <Checkbox checked={confirmed} onChange={setConfirmed}>
            Tôi đã đối chiếu citation, scope, severity và regression; tôi không
            phải người tạo phiên bản này.
          </Checkbox>
        </div>
      </Modal>
    </div>
  );
}
