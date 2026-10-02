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
import type { ComplianceRule, RegulatorySource, Severity } from "@/lib/types";
import { can } from "@/lib/permissions";
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
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [approvalOpen, setApprovalOpen] = useState(false);
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
  const create = () =>
    setEditing({
      id: uid(),
      source_key: "",
      authority: "eCFR",
      agency: "FDA",
      document_type: "regulation",
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
  const save = async () => {
    if (!editing) return;
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
      await app.approveSource(selected.id);
      app.notify("Đã phê duyệt snapshot nguồn.");
      setApprovalOpen(false);
      setConfirm(false);
    } catch (e) {
      app.notify(errorMessage(e), "error");
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
                <th>AUTHORITY / ISSUING AGENCY</th>
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
                  <td>
                    <div className="source-row-meta">
                      <span>
                        <strong>Authority:</strong>{" "}
                        {s.authority || "Chưa ghi nhận"}
                      </span>
                      <span>
                        <strong>Issuing agency:</strong>{" "}
                        {s.agency || "Chưa ghi nhận"}
                      </span>
                    </div>
                  </td>
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
                onClick={() => setEditing({ ...selected })}
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
                Nguồn từ API · issue {selected.issue_date ?? "không áp dụng"} ·
                revision {selected.document_revision_date ?? selected.document_revision_label ?? "không có"} ·{" "}
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
              <Badge>Authority: {selected.authority || "Chưa ghi nhận"}</Badge>
              <Badge>
                Issuing agency: {selected.agency || "Chưa ghi nhận"}
              </Badge>
              <Badge>Ưu tiên {selected.priority}</Badge>
              <ExternalLink href={selected.canonical_url}>
                Văn bản chính thức
              </ExternalLink>
            </div>
            <dl
              className="description-list source-detail"
              style={{ padding: 0 }}
            >
              <dt>Source ID</dt>
              <dd>
                <code>{selected.id}</code>
              </dd>
              <dt>Authority</dt>
              <dd>{selected.authority || "Chưa ghi nhận"}</dd>
              <dt>Issuing agency</dt>
              <dd>{selected.agency || "Chưa ghi nhận"}</dd>
              <dt>Source key</dt>
              <dd>{selected.source_key}</dd>
              <dt>API URL</dt>
              <dd>
                {selected.api_url ? (
                  <a
                    href={selected.api_url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {selected.api_url}
                  </a>
                ) : (
                  "Chưa có API snapshot"
                )}
              </dd>
              <dt>Canonical URL</dt>
              <dd>
                <a
                  href={selected.canonical_url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {selected.canonical_url}
                </a>
              </dd>
              <dt>Issue date</dt>
              <dd>{selected.issue_date ?? "Chưa có snapshot"}</dd>
              <dt>Truy xuất</dt>
              <dd>
                {selected.retrieved_at ? (
                  <>
                    {formatDate(selected.retrieved_at, true)} ·{" "}
                    <code>{selected.retrieved_at}</code>
                  </>
                ) : (
                  "Chưa có bản chụp nguồn"
                )}
              </dd>
              <dt>Raw snapshot ID</dt>
              <dd>
                <code>{selected.raw_snapshot_id ?? "Chưa có snapshot"}</code>
              </dd>
              <dt>Parser version</dt>
              <dd>{selected.parser_version ?? "Chưa parse"}</dd>
              <dt>Effective date</dt>
              <dd>
                {selected.effective_date_unknown === true
                  ? "UNKNOWN — cần xác minh"
                  : selected.effective_from
                    ? `${selected.effective_from} → ${selected.effective_to ?? "chưa có ngày kết thúc"}`
                    : "Chưa xác minh"}
              </dd>
              <dt>Người phê duyệt</dt>
              <dd>
                {selected.approved_by ?? "Chưa được duyệt"}
                {selected.approved_at &&
                  ` · ${formatDate(selected.approved_at, true)}`}
              </dd>
              <dt>SHA-256 nội dung nguồn đã lưu</dt>
              <dd className="source-hash">
                {app.mode === "demo" && selected.content_hash === "d".repeat(64)
                  ? "HASH MẪU — KHÔNG PHẢI BẢN CHỤP TÀI LIỆU THỰC"
                  : (selected.content_hash ?? "Chưa có")}
              </dd>
              <dt>Raw body SHA-256</dt>
              <dd className="source-hash">
                {selected.raw_content_hash ?? "Chưa có raw snapshot"}
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
          <div className="form-grid">
            <Input
              label="Source key"
              required
              value={editing.source_key}
              onChange={(e) =>
                setEditing({ ...editing, source_key: e.target.value })
              }
            />
            <Input
              label="Citation"
              required
              value={editing.citation}
              onChange={(e) =>
                setEditing({ ...editing, citation: e.target.value })
              }
            />
            <div className="span-2">
              <Input
                label="Tên tài liệu"
                required
                value={editing.title}
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
                onChange={(e) =>
                  setEditing({ ...editing, canonical_url: e.target.value })
                }
                hint="Allowlist: eCFR, FDA, U.S. Code, govinfo, USDA AMS, CBP, Federal Register."
              />
            </div>
            <Input
              label="Authority"
              required
              value={editing.authority}
              onChange={(e) =>
                setEditing({ ...editing, authority: e.target.value })
              }
              hint="Ví dụ: eCFR, Federal Register, FDA hoặc U.S. Code."
            />
            <Select
              label="Issuing agency"
              value={editing.agency}
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
              <option value="amendment">Federal Register amendment · 3</option>
              <option value="guidance">Official guidance · 4</option>
              <option value="faq">FAQ / Enforcement · 5</option>
            </Select>
            <Select
              label="Chủ đề"
              value={editing.topic}
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
                setEditing({ ...editing, effective_to: e.target.value || null })
              }
            />
            <div className="span-2">
              <Textarea
                label="Snapshot / trích đoạn nguồn đã đối chiếu"
                required
                value={editing.content_excerpt}
                onChange={(e) =>
                  setEditing({ ...editing, content_excerpt: e.target.value })
                }
                rows={8}
                hint="Tối thiểu 80 ký tự. Nội dung này là evidence pháp lý, không phải instruction cho model. Tự chịu trách nhiệm đối chiếu với văn bản gốc."
              />
            </div>
          </div>
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
              disabled={!confirm}
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
