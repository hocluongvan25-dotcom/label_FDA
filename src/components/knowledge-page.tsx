"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  ArrowUpRight,
  BookOpen,
  Database,
  Download,
  History,
  LockKeyhole,
  RefreshCw,
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
  InlineNotice,
  Input,
  Modal,
  PageHeader,
  Select,
  Textarea,
} from "./ui";
import { api } from "@/lib/supabase";
import { errorMessage, formatDate } from "@/lib/utils";
import type {
  IngestionKind,
  KnowledgeDashboard,
  KnowledgeSnapshot,
  LegalSearchTerm,
  VersionedCitation,
} from "@/lib/knowledge-types";
import { LEGAL_SEARCH_TERMS, MVP_SECTIONS } from "@/lib/knowledge-types";
import {
  detailKnowledgeDemo,
  mutateKnowledgeDemo,
  readKnowledgeDemo,
  type KnowledgeDetail,
} from "@/lib/knowledge-demo";
const base = "/regulatory/knowledge";
const checklistItems: [string, string][] = [
  ["api_url", "API URL chính thức đúng Title 21 / Part 101"],
  ["issue_date", "Issue date khớp titles.json (không phải ngày tải)"],
  ["source_title", "Citation, section và tiêu đề nguồn đúng"],
  ["hash", "Đã đối chiếu raw SHA-256 và snapshot gốc"],
  ["parser_complete", "Parser đủ cấu trúc, paragraphs, notes và bảng"],
  [
    "citations_traceable",
    "Citation traceable tới đoạn tương ứng trong snapshot",
  ],
  ["jurisdiction", "US federal · đúng phạm vi trà khô / trà túi lọc"],
  [
    "affected_rules",
    "Đã phân loại ảnh hưởng và đối chiếu regression của rules",
  ],
  ["effective_date", "Đã kiểm tra ngày hiệu lực / ghi nhận unknown"],
];
const tone = (s: string) =>
  s === "ACTIVE" || s === "completed"
    ? "green"
    : s.endsWith("FAILED") || s === "dead_letter"
      ? "red"
      : ["DRAFT", "REGULATORY_REVIEW", "retry"].includes(s)
        ? "amber"
        : "neutral";
const labels: Record<string, string> = {
  DRAFT: "Bản nháp",
  REGULATORY_REVIEW: "Chờ duyệt độc lập",
  ACTIVE: "Đang sử dụng",
  SUPERSEDED: "Đã thay thế",
  WITHDRAWN: "Đã rút",
  FETCHED: "Đã tải",
  PARSE_FAILED: "Lỗi parser",
  FETCH_FAILED: "Lỗi tải",
  queued: "Trong hàng đợi",
  running: "Đang chạy",
  retry: "Chờ thử lại",
  completed: "Hoàn thành",
  dead_letter: "Cần xử lý",
};
export function KnowledgePage() {
  const app = useApp();
  const requestedSnapshot = useSearchParams().get("snapshot");
  const reg = app.actor.role === "regulatory_admin";
  const customer = app.actor.role.startsWith("customer");
  const [dashboard, setDashboard] = useState<KnowledgeDashboard | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState("snapshots");
  const [selected, setSelected] = useState<KnowledgeDetail | null>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [kind, setKind] = useState<IngestionKind>("ecfr_part101");
  const [section, setSection] = useState("101.9");
  const [term, setTerm] = useState<LegalSearchTerm>("food labeling");
  const [start, setStart] = useState(() =>
    new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10),
  );
  const [end, setEnd] = useState(() => new Date().toISOString().slice(0, 10));
  const [docType, setDocType] = useState("");
  const [force, setForce] = useState(false);
  const [cfrOnly, setCfrOnly] = useState(false);
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const [classification, setClassification] = useState("unknown");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [unknown, setUnknown] = useState(false);
  const [override, setOverride] = useState("");
  const [confirm, setConfirm] = useState<"activate" | "withdraw" | null>(null);
  const [reason, setReason] = useState("");
  const [question, setQuestion] = useState(
    "Nutrition Facts labeling requirements for packaged dry tea",
  );
  const [topic, setTopic] = useState("nutrition_labeling");
  const [scope, setScope] = useState("dry_packaged_tea");
  const [asof, setAsof] = useState(() => new Date().toISOString().slice(0, 10));
  const [citations, setCitations] = useState<VersionedCitation[] | null>(null);
  const load = useCallback(async () => {
    if (customer) return;
    try {
      setDashboard(
        app.mode === "demo"
          ? readKnowledgeDemo()
          : await api<KnowledgeDashboard>(base),
      );
      setError("");
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [app.mode, customer]);
  useEffect(() => {
    void load();
    if (app.mode === "demo") return;
    const timer = setInterval(() => void load(), 15000);
    return () => clearInterval(timer);
  }, [load, app.mode]);
  useEffect(() => {
    if (
      customer ||
      !requestedSnapshot ||
      !/^[a-f0-9-]{36}$/i.test(requestedSnapshot)
    )
      return;
    let mounted = true;
    const request =
      app.mode === "demo"
        ? Promise.resolve().then(() => detailKnowledgeDemo(requestedSnapshot))
        : api<KnowledgeDetail>(`${base}/snapshots/${requestedSnapshot}`);
    void request
      .then((d) => {
        if (mounted) {
          setSelected(d);
          setChecks(
            Object.fromEntries(
              checklistItems.map(([k]) => [
                k,
                d.snapshot.review_checklist[k] === true,
              ]),
            ),
          );
          setUnknown(
            d.snapshot.review_checklist.unknown_effective_ack === true,
          );
          setFrom(d.snapshot.effective_from ?? "");
          setTo(d.snapshot.effective_to ?? "");
          setClassification(d.snapshot.change_classification ?? "unknown");
          setOverride(
            String(d.snapshot.review_checklist.override_reason ?? ""),
          );
        }
      })
      .catch((e) => {
        if (mounted) setError(errorMessage(e));
      });
    return () => {
      mounted = false;
    };
  }, [app.mode, customer, requestedSnapshot]);
  const perform = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      app.notify(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  };
  const mutate = async (path: string, body: Record<string, unknown>) =>
    app.mode === "demo"
      ? mutateKnowledgeDemo(path, body, app.actor)
      : api(`${base}/${path}`, { method: "POST", body: JSON.stringify(body) });
  const detail = async (id: string, offset = 0) => {
    const result =
      app.mode === "demo"
        ? detailKnowledgeDemo(id, offset)
        : await api<KnowledgeDetail>(
            `${base}/snapshots/${id}?offset=${offset}`,
          );
    setSelected(result);
    return result;
  };
  const open = async (s: KnowledgeSnapshot) => {
    const d = await detail(s.id);
    setChecks(
      Object.fromEntries(
        checklistItems.map(([k]) => [
          k,
          d.snapshot.review_checklist[k] === true,
        ]),
      ),
    );
    setUnknown(d.snapshot.review_checklist.unknown_effective_ack === true);
    setFrom(d.snapshot.effective_from ?? "");
    setTo(d.snapshot.effective_to ?? "");
    setClassification(d.snapshot.change_classification ?? "unknown");
    setOverride(String(d.snapshot.review_checklist.override_reason ?? ""));
    setConfirm(null);
    setReason("");
  };
  const queue = () =>
    perform(async () => {
      const params: Record<string, unknown> = {};
      if (kind === "ecfr_section") params.section = section;
      if (kind === "ecfr_discovery") params.term = term;
      if (kind === "fr_monitor") {
        params.term = term;
        params.start_date = start;
        params.end_date = end;
        if (docType) params.document_type = docType;
        if (cfrOnly) params.cfr_part101_only = true;
      }
      if (force && kind !== "fr_monitor") params.force_refresh = true;
      await mutate("jobs", { kind, params });
      await load();
      setTab(kind === "fr_monitor" ? "alerts" : "snapshots");
      app.notify(
        app.mode === "demo"
          ? "Đã tạo snapshot mô phỏng riêng biệt. Không gọi API thật."
          : "Đã đưa yêu cầu vào hàng đợi regulatory worker.",
      );
    });
  const review = () =>
    perform(async () => {
      if (!selected) return;
      await mutate(`snapshots/${selected.snapshot.id}/review`, {
        expected_hash: selected.snapshot.content_hash,
        checklist: {
          ...checks,
          unknown_effective_ack: unknown,
          override_reason: override,
        },
        classification,
        effective_from: from || null,
        effective_to: to || null,
      });
      await detail(selected.snapshot.id);
      await load();
      app.notify(
        "Checklist đã lưu. Cần Regulatory Admin khác kiểm tra và kích hoạt.",
      );
    });
  const activateOrWithdraw = () =>
    perform(async () => {
      if (!selected || !confirm) return;
      await mutate(
        `snapshots/${selected.snapshot.id}/${confirm}`,
        confirm === "activate"
          ? { expected_hash: selected.snapshot.content_hash }
          : { reason },
      );
      await detail(selected.snapshot.id);
      await load();
      if (app.mode === "supabase") await app.refresh();
      setConfirm(null);
      app.notify(
        confirm === "activate"
          ? "Đã kích hoạt phiên bản; rules bị ảnh hưởng cần QA/reapprove."
          : "Đã rút nguồn khỏi truy xuất tự động.",
      );
    });
  const raw = () =>
    perform(async () => {
      if (!selected) return;
      if (app.mode === "demo") {
        const url = URL.createObjectURL(
          new Blob(
            [
              String(
                selected.snapshot.metadata.raw_text ??
                  "DEMO ONLY: no real raw government bytes.",
              ),
            ],
            { type: "text/plain" },
          ),
        );
        const a = document.createElement("a");
        a.href = url;
        a.download = "DEMO-not-a-government-snapshot.txt";
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        app.notify("File mô phỏng. Không phải raw response từ chính phủ.");
        return;
      }
      const result = await api<{ url: string }>(
        `${base}/snapshots/${selected.snapshot.id}/raw`,
      );
      const a = document.createElement("a");
      a.href = result.url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.click();
      app.notify("Đã ghi audit và cấp raw URL riêng tư (5 phút).");
    });
  if (customer)
    return (
      <Card>
        <EmptyState
          title="Kho tri thức dành cho nhân sự Vexim"
          description="Khách hàng xem các nguồn trích dẫn trong báo cáo, không truy cập raw snapshot hoặc thay đổi pháp quy."
          icon={<LockKeyhole size={28} />}
        />
      </Card>
    );
  const snapshots = (dashboard?.snapshots ?? []).filter(
    (s) =>
      (status === "all" || s.status === status) &&
      `${s.citation} ${s.title} ${s.source_version}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const alerts = dashboard?.alerts.filter((a) => !a.resolved_at) ?? [];
  const snap = selected?.snapshot;
  const independent =
    !!snap &&
    snap.reviewed_by !== app.actor.id &&
    snap.created_by !== app.actor.id;
  const canReview =
    reg &&
    !!snap &&
    snap.source_family === "ecfr" &&
    (snap.status === "DRAFT" ||
      (snap.status === "REGULATORY_REVIEW" &&
        snap.reviewed_by === app.actor.id));
  let officialPdf: string | undefined;
  try {
    const url = new URL(String(snap?.metadata.pdf_url ?? ""));
    if (
      url.protocol === "https:" &&
      ["govinfo.gov", "www.govinfo.gov"].includes(url.hostname)
    )
      officialPdf = url.href;
  } catch {
    /* Not an official verified PDF link. */
  }
  const validChecks =
    checklistItems.every(([k]) => checks[k]) &&
    (!!from || unknown) &&
    (!from || !to || to >= from);
  return (
    <div className="knowledge-page">
      <PageHeader
        eyebrow="REGULATORY KNOWLEDGE · API FIRST"
        title="Kho tri thức pháp quy"
        description="Đồng bộ nguồn chính thức. Giữ nguyên từng snapshot. Chỉ sử dụng phiên bản đã được chuyên viên phê duyệt."
        actions={
          <>
            <Link href="/sources" className="btn btn-secondary">
              <BookOpen size={16} /> Source registry
            </Link>
            <Button
              variant="secondary"
              loading={busy}
              onClick={() => void perform(load)}
            >
              <RefreshCw size={16} /> Làm mới
            </Button>
          </>
        }
      />
      {app.mode === "demo" && (
        <InlineNotice tone="warning">
          Đang mô phỏng trên trình duyệt: không gọi API chính phủ, không có raw
          XML thật và không cập nhật registry/rules. Chuyển sang persona
          Regulatory Admin trong Cài đặt để thử quy trình hai người.
        </InlineNotice>
      )}
      {error && (
        <InlineNotice tone="error">
          {error} · Kiểm tra migration 0003, Supabase và regulatory worker.
          Không tự thay bằng dữ liệu mẫu.
        </InlineNotice>
      )}
      <div className="knowledge-metrics">
        {[
          ["API requests · 24h", dashboard?.metrics.requests ?? 0],
          ["HTTP / body lỗi · 24h", dashboard?.metrics.failures ?? 0],
          ["429 · 24h", dashboard?.metrics.rate_limited ?? 0],
          ["Đang chờ review", dashboard?.metrics.pending_approval ?? 0],
          [
            "Tuổi nguồn active",
            dashboard?.metrics.active_age_days === null || !dashboard
              ? "—"
              : `${dashboard.metrics.active_age_days} ngày`,
          ],
          [
            "Retrieval có hit · 24h",
            `${dashboard?.metrics.retrieval_hits ?? 0} / ${dashboard?.metrics.retrieval_requests ?? 0}`,
          ],
        ].map(([label, value]) => (
          <Card key={label}>
            <small>{label}</small>
            <strong>{value}</strong>
          </Card>
        ))}
      </div>
      <div className="knowledge-layout">
        <Card className="knowledge-controls">
          <div className="knowledge-card-title">
            <Database size={19} />
            <div>
              <h3>Đồng bộ có kiểm soát</h3>
              <p>Tất cả kết quả mới đều là DRAFT.</p>
            </div>
          </div>
          <Select
            label="Nguồn / công việc"
            value={kind}
            onChange={(e) => setKind(e.target.value as IngestionKind)}
          >
            <option value="ecfr_part101">eCFR · toàn bộ Part 101</option>
            <option value="ecfr_section">eCFR · một section</option>
            <option value="ecfr_discovery">
              eCFR · discovery & legal search
            </option>
            <option value="fr_monitor">Federal Register · theo dõi FDA</option>
          </Select>
          {kind === "ecfr_section" && (
            <Select
              label="Section MVP"
              value={section}
              onChange={(e) => setSection(e.target.value)}
            >
              {MVP_SECTIONS.map((s) => (
                <option key={s} value={s}>
                  21 CFR {s}
                </option>
              ))}
            </Select>
          )}
          {(kind === "fr_monitor" || kind === "ecfr_discovery") && (
            <Select
              label="Từ khóa pháp quy cố định"
              value={term}
              onChange={(e) => setTerm(e.target.value as LegalSearchTerm)}
            >
              {LEGAL_SEARCH_TERMS.map((q) => (
                <option key={q}>{q}</option>
              ))}
            </Select>
          )}
          {kind === "fr_monitor" && (
            <>
              <div className="form-grid">
                <Input
                  label="Từ ngày xuất bản"
                  type="date"
                  value={start}
                  onChange={(e) => setStart(e.target.value)}
                />
                <Input
                  label="Đến ngày"
                  type="date"
                  value={end}
                  onChange={(e) => setEnd(e.target.value)}
                />
              </div>
              <Select
                label="Loại văn bản"
                value={docType}
                onChange={(e) => setDocType(e.target.value)}
              >
                <option value="">RULE / PRORULE / NOTICE</option>
                <option value="RULE">Final rule</option>
                <option value="PRORULE">Proposed rule</option>
                <option value="NOTICE">Notice</option>
              </Select>
              <Checkbox checked={cfrOnly} onChange={setCfrOnly}>
                Chỉ văn bản có tham chiếu 21 CFR Part 101
              </Checkbox>
              <p className="knowledge-help">
                FDA + ngày xuất bản + từ khóa. Tối đa 32 ngày / 2.000 kết quả;
                cần thu hẹp nếu vượt. Văn bản mới tạo review task, không tự sửa
                rules.
              </p>
            </>
          )}
          {kind !== "fr_monitor" && (
            <Checkbox checked={force} onChange={setForce}>
              Bỏ cache để kiểm tra lại raw body / hash
            </Checkbox>
          )}
          <Button
            loading={busy}
            disabled={
              !reg ||
              (app.mode === "supabase" && !dashboard?.contact_configured)
            }
            onClick={queue}
          >
            <RefreshCw size={16} />
            {app.mode === "demo"
              ? "Chạy đồng bộ mô phỏng"
              : "Đưa vào hàng đợi đồng bộ"}
          </Button>
          {!reg && (
            <p className="knowledge-help">
              Chỉ Regulatory Admin được yêu cầu sync / review / raw.
            </p>
          )}
          {reg && app.mode === "supabase" && !dashboard?.contact_configured && (
            <InlineNotice tone="warning">
              Cần cấu hình REGULATORY_CONTACT_EMAIL cho User-Agent và chạy
              regulatory worker độc lập.
            </InlineNotice>
          )}
          <div className="knowledge-safe">
            <ShieldCheck size={18} />
            <p>
              HTTPS · contact User-Agent · tối đa 3 attempts · raw SHA-256 ·
              không gửi nhãn, công thức hay PII khách hàng.
            </p>
          </div>
          <div className="knowledge-guide">
            <strong>Ba mốc ngày, ba ý nghĩa</strong>
            <p>
              <b>Issue date:</b> edition từ titles.json.
              <br />
              <b>Retrieved at:</b> lúc nhận response.
              <br />
              <b>Effective date:</b> chuyên viên xác minh riêng.
            </p>
          </div>
          <Link href="/setup-guide.md" className="text-link">
            Hướng dẫn triển khai <ArrowUpRight size={14} />
          </Link>
        </Card>
        <div className="knowledge-main">
          <div className="tabs">
            {[
              ["snapshots", "Snapshots & phiên bản"],
              ["jobs", "Ingestion jobs"],
              ["alerts", `Theo dõi (${alerts.length})`],
              ["retrieve", "Truy xuất có citation"],
            ].map(([key, label]) => (
              <button
                className={tab === key ? "tab active" : "tab"}
                key={key}
                onClick={() => setTab(key)}
              >
                {label}
              </button>
            ))}
          </div>
          {tab === "snapshots" && (
            <Card>
              <div className="knowledge-toolbar">
                <Input
                  aria-label="Tìm snapshot"
                  placeholder="Tìm citation, nguồn, edition…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <Select
                  aria-label="Lọc trạng thái snapshot"
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                >
                  <option value="all">Tất cả trạng thái</option>
                  {[
                    "DRAFT",
                    "REGULATORY_REVIEW",
                    "ACTIVE",
                    "SUPERSEDED",
                    "WITHDRAWN",
                    "PARSE_FAILED",
                    "FETCHED",
                  ].map((s) => (
                    <option key={s} value={s}>
                      {labels[s]}
                    </option>
                  ))}
                </Select>
              </div>
              {!snapshots.length ? (
                <EmptyState
                  title="Chưa có snapshot phù hợp"
                  description="Regulatory Admin đưa yêu cầu sync vào hàng đợi. Worker tải raw response và tạo bản DRAFT; nguồn hiện tại vẫn giữ nguyên."
                />
              ) : (
                <div className="knowledge-snapshot-list">
                  {snapshots.map((s) => (
                    <button
                      className="knowledge-snapshot"
                      key={s.id}
                      onClick={() => void perform(() => open(s))}
                    >
                      <div className="knowledge-snapshot-icon">
                        {s.status === "SUPERSEDED" ? (
                          <History size={21} />
                        ) : (
                          <BookOpen size={21} />
                        )}
                      </div>
                      <div>
                        <div className="knowledge-snapshot-heading">
                          <strong>{s.citation}</strong>
                          <Badge tone={tone(s.status)}>
                            {labels[s.status] ?? s.status}
                          </Badge>
                          <Badge>
                            {s.source_family === "ecfr"
                              ? "eCFR"
                              : "FR · monitor only"}
                          </Badge>
                        </div>
                        <p>{s.title}</p>
                        <div className="knowledge-snapshot-meta">
                          <span>
                            Issue: <b>{s.issue_date ?? "Không áp dụng"}</b>
                          </span>
                          <span>{s.chunk_count.toLocaleString()} chunks</span>
                          <span>Tải {formatDate(s.retrieved_at)}</span>
                        </div>
                        <code>SHA-256 {s.content_hash.slice(0, 18)}…</code>
                      </div>
                      <ArrowUpRight size={17} />
                    </button>
                  ))}
                </div>
              )}
              <p className="knowledge-help knowledge-list-note">
                Tối đa 100 snapshot gần nhất. Raw và lịch sử không bị ghi đè.
                Metric tổng hợp độc lập với giới hạn danh sách.
              </p>
            </Card>
          )}
          {tab === "jobs" && (
            <Card>
              {!dashboard?.jobs.length ? (
                <EmptyState
                  title="Chưa có ingestion job"
                  description="Công việc regulatory tách biệt với pipeline OCR / label review."
                />
              ) : (
                <div className="table-scroll">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Công việc</th>
                        <th>Trạng thái</th>
                        <th>Attempts</th>
                        <th>Kết quả / lỗi</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dashboard.jobs.map((j) => (
                        <tr key={j.id}>
                          <td>
                            <strong>{j.kind}</strong>
                            <small>{formatDate(j.requested_at)}</small>
                          </td>
                          <td>
                            <Badge tone={tone(j.status)}>
                              {labels[j.status]}
                            </Badge>
                          </td>
                          <td>{j.attempts} / 3</td>
                          <td>
                            <code>
                              {j.error_code ?? String(j.result.status ?? "—")}
                            </code>
                            {j.error_message && (
                              <small>{j.error_message}</small>
                            )}
                            {!!j.result.issue_date && (
                              <small>
                                Issue: {String(j.result.issue_date)}
                              </small>
                            )}
                            {typeof j.result.snapshot_id === "string" && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() =>
                                  void perform(async () => {
                                    const s = dashboard.snapshots.find(
                                      (s) => s.id === j.result.snapshot_id,
                                    );
                                    await open(
                                      s ??
                                        (
                                          await detail(
                                            String(j.result.snapshot_id),
                                          )
                                        ).snapshot,
                                    );
                                  })
                                }
                              >
                                Mở snapshot
                              </Button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="knowledge-help">
                Polling 15 giây khi kết nối Supabase. Retry / dead-letter không
                thay active index. Discovery chỉ lưu tham chiếu response, không
                là legal evidence đã duyệt.
              </p>
            </Card>
          )}
          {tab === "alerts" && (
            <Card>
              {!alerts.length ? (
                <EmptyState
                  title="Chưa có cảnh báo cần xử lý"
                  description="Worker giám sát issue/hash thay đổi, HTTP failures, parser, chunk drop và văn bản FDA mới. Không thay rules tự động."
                />
              ) : (
                alerts.map((a) => (
                  <div className="knowledge-alert" key={a.id}>
                    <Badge tone={a.severity === "critical" ? "red" : "amber"}>
                      {a.code}
                    </Badge>
                    <p>{a.message}</p>
                    <small>{formatDate(a.created_at)}</small>
                    <div className="knowledge-alert-actions">
                      {a.snapshot_id && (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() =>
                            void perform(async () => {
                              const s = dashboard?.snapshots.find(
                                (s) => s.id === a.snapshot_id,
                              );
                              if (s) await open(s);
                              else {
                                await detail(a.snapshot_id!);
                              }
                            })
                          }
                        >
                          Xem snapshot / tác vụ
                        </Button>
                      )}
                      {reg && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            const reason = window.prompt(
                              "Lý do xử lý / kết quả kiểm tra (ít nhất 20 ký tự):",
                            );
                            if (reason && reason.trim().length >= 20)
                              void perform(async () => {
                                await mutate(`alerts/${a.id}/resolve`, {
                                  reason,
                                });
                                await load();
                                app.notify(
                                  "Đã ghi nhận quyết định regulatory trong audit.",
                                );
                              });
                          }}
                        >
                          Ghi nhận đã xử lý
                        </Button>
                      )}
                    </div>
                  </div>
                ))
              )}
              <InlineNotice tone="info">
                Federal Register là lớp theo dõi thay đổi, không thay thế CFR.
                Kiểm tra bản chính thức tại govinfo và affected rules trước khi
                cập nhật interpretation / điều kiện bắt buộc / exemption /
                claim.
              </InlineNotice>
            </Card>
          )}
          {tab === "retrieve" && (
            <Card className="knowledge-retrieval">
              <div className="knowledge-card-title">
                <Search size={19} />
                <div>
                  <h3>Truy xuất bằng full-text có version</h3>
                  <p>
                    Không dùng LLM để tạo citation. Không gửi câu hỏi này lên
                    API chính phủ.
                  </p>
                </div>
              </div>
              <Textarea
                label="Câu hỏi nội bộ"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                maxLength={2000}
              />
              <div className="form-grid">
                <Select
                  label="Topic"
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                >
                  {[
                    "identity",
                    "net_quantity",
                    "ingredients",
                    "nutrition_labeling",
                    "exemption",
                    "claims",
                    "responsible_party",
                    "readability",
                    "allergens",
                    "general",
                  ].map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </Select>
                <Select
                  label="Product scope"
                  value={scope}
                  onChange={(e) => setScope(e.target.value)}
                >
                  <option value="dry_packaged_tea">Trà khô đóng gói</option>
                  <option value="tea_bag">Trà túi lọc</option>
                </Select>
                <Input
                  label="Review as-of"
                  type="date"
                  value={asof}
                  max={new Date().toISOString().slice(0, 10)}
                  onChange={(e) => setAsof(e.target.value)}
                />
                <Input label="Jurisdiction" value="US_FEDERAL" readOnly />
              </div>
              <Button
                loading={busy}
                disabled={question.trim().length < 3 || !asof}
                onClick={() =>
                  void perform(async () => {
                    const r = (await mutate("retrieve", {
                      question,
                      topic,
                      product_scope: scope,
                      jurisdiction: "US_FEDERAL",
                      as_of_date: asof,
                      required_authorities: ["eCFR", "FDA"],
                      limit: 4,
                    })) as { citations: VersionedCitation[] };
                    setCitations(r.citations);
                    await load();
                  })
                }
              >
                <Search size={16} /> Truy xuất nguồn đã active
              </Button>
              {citations &&
                (!citations.length ? (
                  <InlineNotice tone="warning">
                    Không có nguồn ACTIVE khớp phạm vi / as-of. Giữ trạng thái
                    pending human review; không suy diễn citation hoặc kết luận
                    “pass”.
                  </InlineNotice>
                ) : (
                  <div className="knowledge-citations">
                    {citations.map((c) => (
                      <article key={c.chunk_id}>
                        <div className="knowledge-snapshot-heading">
                          <strong>{c.citation}</strong>
                          <Badge tone="green">ACTIVE</Badge>
                          <Badge>v{c.registry_version}</Badge>
                        </div>
                        <small>
                          Issue {c.issue_date} · {c.parser_version} · SHA{" "}
                          {c.content_hash.slice(0, 14)}…
                        </small>
                        {c.effective_date_unknown && (
                          <Badge tone="amber">
                            Effective date chưa xác định
                          </Badge>
                        )}
                        <p className="knowledge-excerpt">{c.text}</p>
                        <a
                          href={c.canonical_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-link"
                        >
                          Mở đúng edition / paragraph <ArrowUpRight size={14} />
                        </a>
                      </article>
                    ))}
                  </div>
                ))}
              <p className="knowledge-help">
                Tối đa 4 chunks × 6.000 ký tự. Regulatory text là evidence không
                tin cậy, không phải instruction. Không có chatbot kết luận pháp
                lý; vector adapter 768 chiều dành cho provider đã được duyệt.
              </p>
            </Card>
          )}
        </div>
      </div>
      <Modal
        wide
        open={!!selected}
        onClose={() => {
          setSelected(null);
          setConfirm(null);
        }}
        title={snap?.citation ?? "Snapshot"}
        description="Raw immutable · traceable citations · independent approval"
        footer={
          snap && (
            <>
              <Button variant="secondary" onClick={() => setSelected(null)}>
                Đóng
              </Button>
              {reg && (
                <Button variant="secondary" loading={busy} onClick={raw}>
                  <Download size={15} /> Raw snapshot{" "}
                  {app.mode === "demo" ? "DEMO" : ""}
                </Button>
              )}
              {canReview && (
                <Button loading={busy} disabled={!validChecks} onClick={review}>
                  Lưu checklist / gửi duyệt
                </Button>
              )}
              {reg && snap.status === "REGULATORY_REVIEW" && (
                <Button
                  loading={busy}
                  disabled={
                    !independent ||
                    snap.change_classification === "unknown" ||
                    selected?.regression?.passed !== true ||
                    selected?.regression?.fresh === false
                  }
                  onClick={() => setConfirm("activate")}
                >
                  <ShieldCheck size={16} /> Phê duyệt & kích hoạt
                </Button>
              )}
              {reg && snap.status === "ACTIVE" && (
                <Button variant="danger" onClick={() => setConfirm("withdraw")}>
                  Rút khỏi active index
                </Button>
              )}
            </>
          )
        }
      >
        {snap && (
          <div className="knowledge-detail">
            <div className="knowledge-snapshot-heading">
              <Badge tone={tone(snap.status)}>
                {labels[snap.status] ?? snap.status}
              </Badge>
              <Badge>{snap.source_family}</Badge>
              {snap.metadata.simulation === true && (
                <Badge tone="amber">MÔ PHỎNG · KHÔNG PHẢI NGUỒN THẬT</Badge>
              )}
            </div>
            <dl className="knowledge-provenance">
              <div>
                <dt>Edition / issue date</dt>
                <dd>{snap.issue_date ?? "Không áp dụng (FR metadata)"}</dd>
              </div>
              <div>
                <dt>Retrieved at</dt>
                <dd>{formatDate(snap.retrieved_at)}</dd>
              </div>
              <div>
                <dt>Effective from / to</dt>
                <dd>
                  {snap.effective_from ?? "Unknown"} →{" "}
                  {snap.effective_to ?? "Chưa có mốc kết thúc"}
                </dd>
              </div>
              <div>
                <dt>Source version / parser</dt>
                <dd>
                  {snap.source_version} · {snap.parser_version ?? "Chưa parse"}
                </dd>
              </div>
              <div className="knowledge-provenance-wide">
                <dt>Raw SHA-256</dt>
                <dd>
                  <code>{snap.content_hash}</code>
                </dd>
              </div>
              <div className="knowledge-provenance-wide">
                <dt>API request · đúng snapshot</dt>
                <dd>
                  <a
                    href={snap.api_url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {snap.api_url}
                  </a>
                </dd>
              </div>
            </dl>
            {snap.source_family === "federal_register" ? (
              <>
                <InlineNotice tone="warning">
                  Tác vụ monitor-only. Xác minh bản govinfo chính thức, phân
                  loại tác động, cập nhật nguồn eCFR / FDA riêng. Văn bản này
                  không được kích hoạt vào RAG và không tự sửa rules.
                </InlineNotice>
                {officialPdf && (
                  <a
                    href={officialPdf}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-link"
                  >
                    PDF bản chính thức (govinfo) <ArrowUpRight size={14} />
                  </a>
                )}
                <p className="knowledge-help">
                  Publication date:{" "}
                  {String(snap.metadata.publication_date ?? "Chưa có")} ·
                  Effective date từ metadata:{" "}
                  {String(snap.metadata.effective_on ?? "Unknown")} · Chỉ là
                  metadata cần xác minh, không là ngày hiệu lực đã phê duyệt.
                </p>
              </>
            ) : (
              <>
                <div className="knowledge-validation">
                  <strong>Kiểm tra tự động</strong>
                  {[
                    ["Coverage", snap.validation_results.coverage_complete],
                    ["Citations", snap.validation_results.citations_valid],
                    [
                      "Deterministic regression",
                      snap.validation_results.regression_passed,
                    ],
                  ].map(([l, v]) => (
                    <Badge key={String(l)} tone={v === true ? "green" : "red"}>
                      {String(l)} · {v === true ? "PASS" : "CHƯA ĐẠT"}
                    </Badge>
                  ))}
                  <p>
                    Regression kiểm tra code bằng fixtures, không xác nhận
                    interpretation của phiên bản luật mới. Cần chuyên viên đối
                    chiếu riêng.
                  </p>
                </div>
                <div className="knowledge-validation">
                  <strong>Regression của rules bị ảnh hưởng</strong>
                  <Badge
                    tone={
                      selected?.regression?.passed &&
                      selected.regression.fresh !== false
                        ? "green"
                        : "amber"
                    }
                  >
                    {selected?.regression?.passed &&
                    selected.regression.fresh !== false
                      ? "PASS · fresh"
                      : "CẦN CHẠY LẠI / CHƯA ĐẠT"}
                  </Badge>
                  <p>
                    {selected?.regression?.rule_refs.length ?? 0} active rules ·
                    fixture inputs tổng hợp, không phải kiểm chứng
                    interpretation luật mới.
                  </p>
                  {reg &&
                    ["DRAFT", "REGULATORY_REVIEW"].includes(snap.status) && (
                      <Button
                        variant="secondary"
                        size="sm"
                        loading={busy}
                        onClick={() =>
                          void perform(async () => {
                            await mutate(`snapshots/${snap.id}/regression`, {
                              expected_hash: snap.content_hash,
                            });
                            await detail(snap.id);
                            app.notify(
                              "Đã chạy fixtures trên definitions hiện tại của các rules bị ảnh hưởng.",
                            );
                          })
                        }
                      >
                        Chạy lại affected-rule regression
                      </Button>
                    )}
                </div>
                {Array.isArray(snap.validation_results.warnings) &&
                  snap.validation_results.warnings.length > 0 && (
                    <InlineNotice tone="warning">
                      {snap.validation_results.warnings.map(String).join(" · ")}
                    </InlineNotice>
                  )}
                <h3>
                  Chunks có nguồn gốc (
                  {selected?.total_count ?? snap.chunk_count})
                </h3>
                <div className="knowledge-chunks">
                  {selected?.chunks.map((c) => (
                    <article key={c.id}>
                      <div className="knowledge-snapshot-heading">
                        <strong>{c.citation}</strong>
                        <Badge
                          tone={
                            c.review_status === "APPROVED" ? "green" : "amber"
                          }
                        >
                          {c.review_status}
                        </Badge>
                        <Badge>{c.citation_precision}</Badge>
                      </div>
                      <p className="knowledge-excerpt">{c.content}</p>
                      <small>
                        Chunk SHA {c.chunk_content_hash?.slice(0, 18)}… ·{" "}
                        {c.topic}
                      </small>
                    </article>
                  ))}
                </div>
                {selected && selected.total_count > 50 && (
                  <div className="knowledge-pagination">
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={busy || selected.offset === 0}
                      onClick={() =>
                        void perform(async () => {
                          await detail(
                            snap.id,
                            Math.max(0, selected.offset - 50),
                          );
                        })
                      }
                    >
                      Trước
                    </Button>
                    <span>
                      {selected.offset + 1}–
                      {Math.min(selected.offset + 50, selected.total_count)} /{" "}
                      {selected.total_count}
                    </span>
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={
                        busy || selected.offset + 50 >= selected.total_count
                      }
                      onClick={() =>
                        void perform(async () => {
                          await detail(snap.id, selected.offset + 50);
                        })
                      }
                    >
                      Tiếp
                    </Button>
                  </div>
                )}
                <h3>Rules bị ảnh hưởng</h3>
                {selected?.affected_rules.length ? (
                  <ul className="knowledge-rules">
                    {selected.affected_rules.map((r) => (
                      <li key={r.id}>
                        <strong>{r.rule_key}</strong> · {r.name}{" "}
                        <Badge>
                          {r.status} / {r.test_status}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="knowledge-help">
                    {app.mode === "demo"
                      ? "Demo không liên kết sources/rules thực."
                      : "Chưa có rule active liên kết với các section trong snapshot này."}
                  </p>
                )}
                <Link href="/rules" className="text-link">
                  Mở rule registry để QA / cập nhật interpretation{" "}
                  <ArrowUpRight size={14} />
                </Link>
                {[
                  "DRAFT",
                  "REGULATORY_REVIEW",
                  "ACTIVE",
                  "SUPERSEDED",
                  "WITHDRAWN",
                ].includes(snap.status) && (
                  <div className="knowledge-checklist">
                    <h3>Checklist Regulatory Admin</h3>
                    {!canReview && (
                      <p className="knowledge-help">
                        Checklist đã lưu · chỉ xem. Người duyệt độc lập kiểm tra
                        raw, kết quả QA và ngày hiệu lực trước khi xác nhận.
                      </p>
                    )}
                    {checklistItems.map(([k, label]) => (
                      <Checkbox
                        key={k}
                        disabled={!canReview}
                        checked={!!checks[k]}
                        onChange={(v) => setChecks((c) => ({ ...c, [k]: v }))}
                      >
                        {label}
                      </Checkbox>
                    ))}
                    <Select
                      disabled={!canReview}
                      label="Phân loại thay đổi"
                      value={classification}
                      onChange={(e) => setClassification(e.target.value)}
                    >
                      {[
                        ["unknown", "Chưa phân loại"],
                        ["text_only", "Text-only"],
                        ["interpretation", "Ảnh hưởng interpretation"],
                        ["mandatory_conditions", "Điều kiện bắt buộc"],
                        ["exemption", "Exemption"],
                        ["claim_criteria", "Claim criteria"],
                      ].map(([v, l]) => (
                        <option key={v} value={v}>
                          {l}
                        </option>
                      ))}
                    </Select>
                    <div className="form-grid">
                      <Input
                        disabled={!canReview}
                        label="Effective from đã xác minh"
                        type="date"
                        value={from}
                        onChange={(e) => setFrom(e.target.value)}
                      />
                      <Input
                        disabled={!canReview}
                        label="Effective to (nếu có)"
                        type="date"
                        value={to}
                        onChange={(e) => setTo(e.target.value)}
                      />
                    </div>
                    <Checkbox
                      disabled={!canReview}
                      checked={unknown}
                      onChange={setUnknown}
                    >
                      Chưa xác định được effective date; ghi cờ unknown, không
                      suy đoán từ issue date.
                    </Checkbox>
                    <Textarea
                      disabled={!canReview}
                      label="Ghi chú đối chiếu / lý do xử lý cảnh báo"
                      hint="Cảnh báo hash/chunk/parser cần đối chiếu cụ thể, ít nhất 20 ký tự."
                      value={override}
                      onChange={(e) => setOverride(e.target.value)}
                      maxLength={2000}
                    />
                  </div>
                )}
                {snap.status === "REGULATORY_REVIEW" && (
                  <InlineNotice tone="info">
                    {independent
                      ? "Bạn là người duyệt độc lập. Kiểm tra raw, checklist và affected rules trước khi kích hoạt."
                      : "Người tạo hoặc người checklist không tự kích hoạt. Cần Regulatory Admin khác phê duyệt."}
                  </InlineNotice>
                )}
              </>
            )}
            {confirm && (
              <div className="knowledge-confirm">
                <h3>
                  {confirm === "activate"
                    ? "Xác nhận kích hoạt phiên bản này?"
                    : "Xác nhận rút khỏi active index?"}
                </h3>
                <p>
                  {confirm === "activate"
                    ? "Phiên bản trước sẽ được giữ lại và đánh dấu superseded. Rules đang tham chiếu bản cũ cần regression/reapproval; báo cáo đã phát hành vẫn giữ snapshot nguyên gốc."
                    : "Nguồn và chunks sẽ ngừng xuất hiện trong truy xuất tự động. Không xóa snapshot hoặc báo cáo lịch sử."}
                </p>
                {confirm === "withdraw" && (
                  <Textarea
                    label="Lý do rút nguồn (ít nhất 20 ký tự)"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    maxLength={2000}
                  />
                )}
                <div className="knowledge-alert-actions">
                  <Button
                    loading={busy}
                    variant={confirm === "withdraw" ? "danger" : "primary"}
                    disabled={
                      confirm === "withdraw" && reason.trim().length < 20
                    }
                    onClick={activateOrWithdraw}
                  >
                    {confirm === "activate"
                      ? "Xác nhận phê duyệt độc lập"
                      : "Xác nhận rút nguồn"}
                  </Button>
                  <Button variant="secondary" onClick={() => setConfirm(null)}>
                    Hủy
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
