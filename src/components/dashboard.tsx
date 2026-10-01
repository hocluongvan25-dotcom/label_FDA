"use client";

import Link from "next/link";
import { useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  CheckCheck,
  CircleAlert,
  Clock3,
  FileCheck2,
  Files,
  Leaf,
  Plus,
  ScanLine,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { useApp } from "./app-provider";
import {
  Badge,
  Card,
  EmptyState,
  GuideModal,
  PageHeader,
  ProgressBar,
  SeverityBadge,
} from "./ui";
import { ProductsTable } from "./products-table";
import { can } from "@/lib/permissions";
import {
  findingCounts,
  highestSeverity,
  isCompleted,
  needsAction,
  relativeTime,
  sourceIsCurrent,
} from "@/lib/utils";
import { PIPELINE_LABELS } from "@/lib/constants";

export function Dashboard() {
  const { data, actor } = useApp();
  const [guide, setGuide] = useState(false);
  const tasks = data.reviews.filter((r) => needsAction(r.status));
  const revision = data.reviews.filter((r) => r.status === "REVISION_REQUIRED");
  const complete = data.reviews.filter((r) => isCompleted(r.status));
  const priority = [...tasks]
    .sort(
      (a, b) =>
        findingCounts(data.findings.filter((f) => f.review_id === b.id))
          .critical -
          findingCounts(data.findings.filter((f) => f.review_id === a.id))
            .critical || a.due_at.localeCompare(b.due_at),
    )
    .slice(0, 3);
  const processing = data.reviews.filter((r) => r.status === "PROCESSING");
  const stats = [
    {
      label: "Tổng hồ sơ sản phẩm",
      count: data.products.length,
      icon: Files,
      tone: "sage",
      note: `${data.organizations.length} doanh nghiệp`,
      href: "/products",
    },
    {
      label: "Chờ chuyên viên xử lý",
      count: tasks.length,
      icon: ScanLine,
      tone: "lavender",
      note: "Cần bạn rà soát & xác nhận",
      href: "/reviews?tab=action",
    },
    {
      label: "Cần chỉnh sửa nhãn",
      count: revision.length,
      icon: CircleAlert,
      tone: "peach",
      note: "Chờ phiên bản nhãn cập nhật",
      href: "/products?tab=action",
    },
    {
      label: "Review đã hoàn tất",
      count: complete.length,
      icon: CheckCheck,
      tone: "mint",
      note: `${data.reports.length} báo cáo đã phát hành`,
      href: "/reports",
    },
  ];
  if (actor.role === "regulatory_admin")
    return (
      <div className="page">
        <PageHeader
          eyebrow="REGULATORY WORKSPACE"
          title="Kiến thức rõ nguồn. Quy tắc rõ phiên bản."
          description="Quản lý nguồn pháp lý và bộ quy tắc trước khi áp dụng cho hồ sơ khách hàng."
          actions={
            <Link href="/sources" className="btn btn-primary">
              <ShieldCheck size={16} /> Quản lý nguồn
            </Link>
          }
        />
        <div className="stats-grid">
          {[
            {
              label: "Nguồn hiện hành",
              count: data.sources.filter((s) => sourceIsCurrent(s)).length,
              href: "/sources",
              icon: ShieldCheck,
            },
            {
              label: "Nguồn chờ duyệt",
              count: data.sources.filter((s) => s.status === "DRAFT").length,
              href: "/sources",
              icon: Clock3,
            },
            {
              label: "Quy tắc đang hoạt động",
              count: data.rules.filter((r) => r.status === "ACTIVE").length,
              href: "/rules",
              icon: FileCheck2,
            },
            {
              label: "Rules draft",
              count: data.rules.filter((r) => r.status === "DRAFT").length,
              href: "/rules",
              icon: Files,
            },
          ].map((s) => (
            <Link className="stat-card" href={s.href} key={s.label}>
              <div className="stat-top">
                <span>{s.label}</span>
                <span className="stat-icon stat-sage">
                  <s.icon size={19} />
                </span>
              </div>
              <strong className="stat-value">{s.count}</strong>
              <span className="stat-bottom">
                Xem chi tiết <ArrowUpRight size={13} />
              </span>
            </Link>
          ))}
        </div>
        <Card>
          <div className="card-header">
            <h2>Lịch sử nguồn & quy tắc</h2>
            <Link href="/audit" className="subtle-link">
              Xem nhật ký <ArrowRight size={14} />
            </Link>
          </div>
          <ActivityList />
        </Card>
        <GuideModal open={guide} onClose={() => setGuide(false)} />
      </div>
    );
  return (
    <div className="page dashboard-page">
      <PageHeader
        eyebrow="TỔNG QUAN · THỊ TRƯỜNG HOA KỲ"
        title="Rà soát nhãn, rõ từng bước."
        description={`Xin chào ${actor.name.split(" ")[0]}. Theo dõi hồ sơ và tập trung vào những việc cần xử lý.`}
        actions={
          <>
            <div className="header-date">
              <CalendarDays size={16} />
              <span>
                {new Intl.DateTimeFormat("vi-VN", {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                  timeZone: "Asia/Ho_Chi_Minh",
                }).format(new Date())}
              </span>
            </div>
            {can(actor, "products") && (
              <Link href="/products/new" className="btn btn-primary">
                <Plus size={17} /> Tạo hồ sơ mới
              </Link>
            )}
          </>
        }
      />
      <div className="stats-grid">
        {stats.map((s) => (
          <Link href={s.href} className="stat-card" key={s.label}>
            <div className="stat-top">
              <span>{s.label}</span>
              <span className={`stat-icon stat-${s.tone}`}>
                <s.icon size={19} strokeWidth={1.7} />
              </span>
            </div>
            <div className="stat-number-line">
              <strong className="stat-value">
                {String(s.count).padStart(2, "0")}
              </strong>
              <ArrowUpRight size={17} className="stat-arrow" />
            </div>
            <div className="stat-bottom">
              <span>{s.note}</span>
            </div>
          </Link>
        ))}
      </div>
      <div className="dashboard-grid">
        <div className="dashboard-primary">
          <ProductsTable compact title="Hồ sơ gần đây" />
          <div className="dashboard-lower">
            <Card className="weekly-card">
              <div className="card-header">
                <h2>Nhịp độ rà soát</h2>
                <span className="tiny muted">7 ngày gần nhất</span>
              </div>
              <WeeklyChart />
              <div className="chart-legend">
                <span>
                  <i className="legend-dot legend-teal" /> Đã hoàn tất
                </span>
                <span>
                  <i className="legend-dot legend-light" /> Đang rà soát
                </span>
              </div>
            </Card>
            <Card className="activity-card">
              <div className="card-header">
                <h2>Hoạt động gần nhất</h2>
                <Link
                  href="/audit"
                  aria-label="Xem toàn bộ nhật ký"
                  className="row-arrow"
                >
                  <ArrowUpRight size={17} />
                </Link>
              </div>
              <ActivityList limit={3} />
            </Card>
          </div>
          <div className="scope-note">
            <span className="scope-note-icon">
              <Leaf size={19} />
            </span>
            <div>
              <strong>Chuyên gia quyết định. Công nghệ hỗ trợ.</strong>
              <p>
                Mỗi phát hiện được đối chiếu với evidence và nguồn tham chiếu
                trước khi phát hành báo cáo.
              </p>
            </div>
            <button onClick={() => setGuide(true)}>
              Tìm hiểu quy trình <ArrowRight size={14} />
            </button>
          </div>
        </div>
        <aside className="dashboard-aside">
          <Card className="priority-card">
            <div className="card-header">
              <div className="card-title-group">
                <h2>Ưu tiên xử lý</h2>
                <span className="priority-count">{tasks.length}</span>
              </div>
              <span className="live-dot" />
            </div>
            <p className="aside-description">
              Những hồ sơ cần bạn chú ý trước.
            </p>
            <div className="priority-list">
              {priority.map((r, i) => {
                const product = data.products.find(
                  (p) => p.id === r.product_id,
                )!;
                const fs = data.findings.filter((f) => f.review_id === r.id);
                const c = findingCounts(fs);
                const highest = highestSeverity(fs);
                return (
                  <Link
                    href={`/reviews/${r.id}`}
                    key={r.id}
                    className="priority-item"
                  >
                    <div className="priority-item-top">
                      <span className="priority-index">0{i + 1}</span>
                      {highest && <SeverityBadge severity={highest} />}
                    </div>
                    <h3>{product.name}</h3>
                    <p>
                      {
                        data.organizations.find(
                          (o) => o.id === product.organization_id,
                        )?.name
                      }
                      <span>·</span>Nhãn v
                      {
                        data.labelVersions.find(
                          (v) => v.id === r.label_version_id,
                        )?.version
                      }
                    </p>
                    <div className="priority-item-bottom">
                      <span>
                        {c.critical
                          ? `${c.critical} vấn đề nghiêm trọng`
                          : `${c.major + c.minor + c.information} finding cần kiểm tra`}
                      </span>
                      <ArrowRight size={15} />
                    </div>
                  </Link>
                );
              })}
              {!priority.length && (
                <EmptyState
                  title="Đã xử lý hết"
                  description="Không còn hồ sơ cần xử lý ở thời điểm này."
                  icon={<CheckCheck size={25} />}
                />
              )}
            </div>
            <Link href="/reviews?tab=action" className="aside-footer-link">
              Mở không gian rà soát <ArrowRight size={14} />
            </Link>
          </Card>
          {processing.length > 0 && (
            <Card className="processing-card">
              <div className="small-card-header">
                <span className="processing-icon">
                  <Sparkles size={16} />
                </span>
                <strong>Đang phân tích</strong>
                <Badge tone="blue">{processing.length}</Badge>
              </div>
              {processing.slice(0, 1).map((r) => (
                <Link
                  key={r.id}
                  href={`/reviews/${r.id}`}
                  className="processing-body"
                >
                  <h3>
                    {data.products.find((p) => p.id === r.product_id)?.name}
                  </h3>
                  <div>
                    <span>
                      {r.pipeline.find((s) => s.status === "running")
                        ? PIPELINE_LABELS[
                            r.pipeline.find((s) => s.status === "running")!
                              .stage
                          ]
                        : "Chờ bước xử lý tiếp theo"}
                    </span>
                    <strong>{r.progress}%</strong>
                  </div>
                  <ProgressBar value={r.progress} />
                  <small>
                    {r.idempotency_key.startsWith("seed-")
                      ? "Trạng thái pipeline minh họa"
                      : "Cập nhật theo tiến độ xử lý thực"}
                  </small>
                </Link>
              ))}
            </Card>
          )}
          {!actor.role.startsWith("customer") && (
            <Card className="knowledge-card">
              <div className="small-card-header">
                <ShieldCheck size={17} />
                <strong>Nền tảng pháp lý</strong>
                <span className="verified-dot">
                  <CheckCheck size={12} />
                </span>
              </div>
              <p>
                Nguồn có phiên bản.
                <br />
                Quy tắc được chuyên gia xác nhận.
              </p>
              <div className="knowledge-numbers">
                <div>
                  <strong>
                    {data.sources.filter((s) => sourceIsCurrent(s)).length}
                  </strong>
                  <span>nguồn hiện hành</span>
                </div>
                <div>
                  <strong>
                    {data.rules.filter((r) => r.status === "ACTIVE").length}
                  </strong>
                  <span>quy tắc active</span>
                </div>
              </div>
              <Link href="/sources">
                Xem nguồn tham chiếu <ArrowUpRight size={14} />
              </Link>
            </Card>
          )}
          <div className="review-scope">
            <span>PHẠM VI MVP</span>
            <strong>Trà khô & trà túi lọc</strong>
            <p>
              Hỗ trợ nhãn thực phẩm xuất khẩu Hoa Kỳ, trong phạm vi liên bang.
            </p>
            <div>
              <span className="country-flag">🇺🇸</span> United States{" "}
              <Badge tone="green">US</Badge>
            </div>
          </div>
        </aside>
      </div>
      <GuideModal open={guide} onClose={() => setGuide(false)} />
    </div>
  );
}
function WeeklyChart() {
  const { data } = useApp();
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - 6 + i);
    const localDay = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Ho_Chi_Minh",
    }).format(d);
    const rs = data.reviews.filter(
      (r) =>
        new Intl.DateTimeFormat("en-CA", {
          timeZone: "Asia/Ho_Chi_Minh",
        }).format(new Date(r.created_at)) === localDay,
    );
    return {
      label: new Intl.DateTimeFormat("vi-VN", {
        weekday: "short",
        timeZone: "Asia/Ho_Chi_Minh",
      })
        .format(d)
        .replace("Th ", "T"),
      total: rs.length,
      complete: rs.filter((r) => isCompleted(r.status)).length,
    };
  });
  const max = Math.max(1, ...days.map((d) => d.total));
  const total = days.reduce((sum, d) => sum + d.total, 0);
  return (
    <div className="weekly-chart">
      <div className="chart-summary">
        <strong>{total}</strong>
        <span>hồ sơ được tiếp nhận</span>
        <Badge tone="green">Tuần này</Badge>
      </div>
      <div className="chart-bars">
        {days.map((d, i) => (
          <div className="chart-column" key={i}>
            <div className="chart-bar-area">
              <div
                className="chart-bar"
                style={{ height: `${Math.max(3, (d.total / max) * 100)}%` }}
                title={`${d.label}: ${d.total} review, ${d.complete} hoàn tất`}
              >
                <span
                  style={{
                    height: d.total ? `${(d.complete / d.total) * 100}%` : "0%",
                  }}
                />
              </div>
              {d.total > 0 && <span className="chart-value">{d.total}</span>}
            </div>
            <span className={i === 6 ? "today" : ""}>{d.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
export function ActivityList({ limit = 7 }: { limit?: number }) {
  const { data } = useApp();
  const rows = data.audit.slice(0, limit);
  return (
    <div className="activity-list">
      {rows.map((a) => (
        <div className="activity-item" key={a.id}>
          <span
            className={`activity-icon ${a.action.startsWith("report") ? "activity-green" : a.action.startsWith("finding") ? "activity-amber" : ""}`}
          >
            {a.action.startsWith("report") ? (
              <CheckCheck size={15} />
            ) : a.action.startsWith("label") ? (
              <Files size={15} />
            ) : (
              <FileCheck2 size={15} />
            )}
          </span>
          <div>
            <p>{a.description}</p>
            <span>
              {a.actor_name}
              <span className="cell-dot">·</span>
              {relativeTime(a.created_at)}
            </span>
          </div>
        </div>
      ))}
      {!rows.length && (
        <div className="muted activity-empty">
          Thao tác của bạn sẽ được ghi nhận tại đây.
        </div>
      )}
    </div>
  );
}
