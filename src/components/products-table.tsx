"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  ArrowDown,
  ArrowRight,
  Check,
  Download,
  Filter,
  Plus,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import clsx from "clsx";
import { useApp } from "./app-provider";
import {
  Avatar,
  Badge,
  Button,
  Card,
  EmptyState,
  IconButton,
  Select,
  StatusBadge,
  TeaThumbnail,
} from "./ui";
import {
  assigneeName,
  downloadCsv,
  findingCounts,
  formatDate,
  highestSeverity,
  isCompleted,
  needsAction,
} from "@/lib/utils";
import { STATUS_META } from "@/lib/constants";
import type { Product, ReviewStatus } from "@/lib/types";

export function ProductsTable({
  compact = false,
  title = "Danh sách sản phẩm",
  initialTab = "all",
}: {
  compact?: boolean;
  title?: string;
  initialTab?: string;
}) {
  const { data, actor } = useApp();
  const router = useRouter();
  const [tab, setTab] = useState(initialTab);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [filterOpen, setFilterOpen] = useState(false);
  const [status, setStatus] = useState("all");
  const [severity, setSeverity] = useState("all");
  const [form, setForm] = useState("all");
  const [sort, setSort] = useState<"newest" | "name">("newest");
  const latest = (p: Product) =>
    data.reviews
      .filter((r) => r.product_id === p.id)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  const all = data.products;
  const needs = all.filter((p) => {
    const review = latest(p);
    return !!review && needsAction(review.status, review.triage_route);
  });
  const done = all.filter((p) => latest(p) && isCompleted(latest(p).status));
  const filtered = all
    .filter((p) => {
      const r = latest(p);
      const s = r?.status ?? "DRAFT";
      const fs = data.findings.filter((f) => f.review_id === r?.id);
      const org = data.organizations.find((o) => o.id === p.organization_id);
      return (
        (tab === "all" ||
          (tab === "action" && needsAction(s, r?.triage_route)) ||
          (tab === "completed" && isCompleted(s))) &&
        (status === "all" || status === s) &&
        (severity === "all" ||
          fs.some(
            (f) => f.severity === severity && f.status !== "dismissed",
          )) &&
        (form === "all" || form === p.form) &&
        `${p.name} ${p.brand} ${org?.name ?? ""}`
          .toLowerCase()
          .includes(query.toLowerCase())
      );
    })
    .sort((a, b) =>
      sort === "name"
        ? a.name.localeCompare(b.name, "vi")
        : b.updated_at.localeCompare(a.updated_at),
    );
  const size = compact ? 6 : 8;
  const totalPages = Math.max(1, Math.ceil(filtered.length / size));
  const currentPage = Math.min(page, totalPages);
  const rows = filtered.slice((currentPage - 1) * size, currentPage * size);
  const filterCount = [status, severity, form].filter(
    (x) => x !== "all",
  ).length;
  const reset = () => {
    setStatus("all");
    setSeverity("all");
    setForm("all");
    setQuery("");
    setPage(1);
  };
  const exportData = () =>
    downloadCsv(
      [
        [
          "Sản phẩm",
          "Thương hiệu",
          "Khách hàng",
          "Trạng thái",
          "Critical",
          "Major",
          "Minor",
          "Cập nhật",
        ],
        ...filtered.map((p) => {
          const r = latest(p);
          const c = findingCounts(
            data.findings.filter((f) => f.review_id === r?.id),
          );
          return [
            p.name,
            p.brand,
            data.organizations.find((o) => o.id === p.organization_id)?.name ??
              "",
            STATUS_META[r?.status ?? "DRAFT"].label,
            String(c.critical),
            String(c.major),
            String(c.minor),
            formatDate(p.updated_at),
          ];
        }),
      ],
      "vexim-ho-so-san-pham.csv",
    );
  return (
    <Card className="products-table-card">
      <div className="card-header">
        <div className="card-title-group">
          <h2>{title}</h2>
          <Badge>{all.length}</Badge>
        </div>
        {compact ? (
          <Link href="/products" className="subtle-link">
            Xem tất cả <ArrowRight size={14} />
          </Link>
        ) : (
          <IconButton label="Xuất danh sách CSV" onClick={exportData}>
            <Download size={17} />
          </IconButton>
        )}
      </div>
      <div className="table-tabs">
        {[
          ["all", "Tất cả", all.length],
          ["action", "Cần xử lý", needs.length],
          ["completed", "Hoàn tất", done.length],
        ].map(([id, label, count]) => (
          <button
            key={id}
            onClick={() => {
              setTab(String(id));
              setPage(1);
            }}
            className={clsx(tab === id && "active")}
          >
            {label}
            <span>{count}</span>
          </button>
        ))}
      </div>
      <div className="table-toolbar">
        <div className="table-search">
          <Search size={16} />
          <input
            aria-label="Tìm hồ sơ sản phẩm"
            placeholder="Tìm sản phẩm, thương hiệu…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(1);
            }}
          />
          {query && (
            <IconButton label="Xóa tìm kiếm" onClick={() => setQuery("")}>
              <X size={13} />
            </IconButton>
          )}
        </div>
        <div className="table-tools">
          <div className="filter-anchor">
            <Button
              variant="secondary"
              size="sm"
              className={filterCount ? "has-filter" : ""}
              onClick={() => setFilterOpen((v) => !v)}
            >
              <SlidersHorizontal size={14} /> Bộ lọc{" "}
              {filterCount > 0 && (
                <span className="filter-count">{filterCount}</span>
              )}
            </Button>
            {filterOpen && (
              <>
                <div
                  className="popover-backdrop"
                  onClick={() => setFilterOpen(false)}
                />
                <div className="filter-popover">
                  <div className="filter-title">
                    <strong>Lọc hồ sơ</strong>
                    <IconButton
                      label="Đóng bộ lọc"
                      onClick={() => setFilterOpen(false)}
                    >
                      <X size={15} />
                    </IconButton>
                  </div>
                  <Select
                    label="Trạng thái"
                    value={status}
                    onChange={(e) => {
                      setStatus(e.target.value);
                      setPage(1);
                    }}
                  >
                    <option value="all">Tất cả trạng thái</option>
                    {Object.entries(STATUS_META).map(([key, m]) => (
                      <option key={key} value={key}>
                        {m.label}
                      </option>
                    ))}
                  </Select>
                  <Select
                    label="Mức độ finding"
                    value={severity}
                    onChange={(e) => {
                      setSeverity(e.target.value);
                      setPage(1);
                    }}
                  >
                    <option value="all">Tất cả mức độ</option>
                    <option value="critical">Nghiêm trọng</option>
                    <option value="major">Cần sửa</option>
                    <option value="minor">Cần cải thiện</option>
                  </Select>
                  <Select
                    label="Dạng sản phẩm"
                    value={form}
                    onChange={(e) => {
                      setForm(e.target.value);
                      setPage(1);
                    }}
                  >
                    <option value="all">Tất cả dạng sản phẩm</option>
                    <option value="tea_bag">Trà túi lọc</option>
                    <option value="loose_leaf">Trà lá rời</option>
                    <option value="powder">Dạng bột</option>
                  </Select>
                  <div className="filter-footer">
                    <button className="text-button" onClick={reset}>
                      Xóa bộ lọc
                    </button>
                    <Button size="sm" onClick={() => setFilterOpen(false)}>
                      <Check size={14} /> Áp dụng
                    </Button>
                  </div>
                </div>
              </>
            )}
          </div>
          <button
            className="sort-button"
            title="Đổi thứ tự sắp xếp"
            onClick={() => setSort((v) => (v === "newest" ? "name" : "newest"))}
          >
            <ArrowDown size={14} />
            {sort === "newest" ? "Mới nhất" : "Tên A–Z"}
          </button>
        </div>
      </div>
      {filterCount > 0 && (
        <div className="active-filters">
          <Filter size={12} />
          <span>
            {filtered.length} kết quả theo {filterCount} bộ lọc
          </span>
          <button onClick={reset}>
            Xóa <X size={12} />
          </button>
        </div>
      )}
      <div className="table-scroll">
        <table className={clsx("data-table", compact && "compact-table")}>
          <thead>
            <tr>
              <th>SẢN PHẨM</th>
              {!actor.role.startsWith("customer") && (
                <th className="org-col">KHÁCH HÀNG</th>
              )}
              <th>TRẠNG THÁI</th>
              <th>FINDINGS</th>
              <th className="date-col">CẬP NHẬT</th>
              <th className="assignee-col">PHỤ TRÁCH</th>
              <th>
                <span className="sr-only">Mở hồ sơ</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => {
              const r = latest(p);
              const label = data.labelVersions
                .filter((v) => v.product_id === p.id)
                .sort((a, b) => b.version - a.version)[0];
              const findings = data.findings.filter(
                (f) => f.review_id === r?.id,
              );
              const counts = findingCounts(findings);
              const highest = highestSeverity(findings);
              const org = data.organizations.find(
                (o) => o.id === p.organization_id,
              );
              return (
                <tr
                  key={p.id}
                  onClick={() => router.push(`/products/${p.id}`)}
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") router.push(`/products/${p.id}`);
                  }}
                  aria-label={`Mở hồ sơ ${p.name}`}
                >
                  <td>
                    <div className="product-cell">
                      <TeaThumbnail color={p.color} form={p.form} />
                      <div>
                        <Link
                          onClick={(e) => e.stopPropagation()}
                          href={`/products/${p.id}`}
                        >
                          {p.name}
                        </Link>
                        <span>
                          {p.brand}
                          <span className="cell-dot">·</span>
                          {label ? `Nhãn v${label.version}` : "Chưa có nhãn"}
                        </span>
                      </div>
                    </div>
                  </td>
                  {!actor.role.startsWith("customer") && (
                    <td className="org-col">
                      <span className="org-name">{org?.name ?? "—"}</span>
                    </td>
                  )}
                  <td>
                    <StatusBadge
                      status={(r?.status ?? "DRAFT") as ReviewStatus}
                    />
                  </td>
                  <td>
                    {highest ? (
                      <div
                        className="finding-count-dots"
                        title={`${counts.critical} nghiêm trọng · ${counts.major} cần sửa · ${counts.minor} cần cải thiện`}
                      >
                        <span
                          className={clsx(
                            "finding-number",
                            counts.critical > 0
                              ? "critical"
                              : counts.major > 0
                                ? "major"
                                : "minor",
                          )}
                        >
                          {counts.critical +
                            counts.major +
                            counts.minor +
                            counts.information}
                        </span>
                        <div className="mini-severity-dots">
                          {Object.entries(counts)
                            .filter(([, n]) => n > 0)
                            .map(([s, n]) => (
                              <span
                                key={s}
                                className={`severity-dot dot-${s}`}
                                title={`${n} ${s}`}
                              />
                            ))}
                        </div>
                      </div>
                    ) : r?.status === "PROCESSING" ? (
                      <span className="muted tiny">Đang đọc…</span>
                    ) : isCompleted(r?.status ?? "DRAFT") ? (
                      <span className="table-check">
                        <Check size={14} /> 0
                      </span>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td className="date-col">
                    <span className="table-date">
                      {formatDate(p.updated_at).slice(0, 5)}
                    </span>
                  </td>
                  <td className="assignee-col">
                    {r?.assigned_to || p.assigned_to ? (
                      <Avatar
                        name={assigneeName(
                          data,
                          r?.assigned_to || p.assigned_to,
                          actor,
                        )}
                        size="sm"
                      />
                    ) : (
                      <span className="muted" title="Chưa phân công">
                        —
                      </span>
                    )}
                  </td>
                  <td>
                    <Link
                      href={r ? `/reviews/${r.id}` : `/products/${p.id}`}
                      onClick={(e) => e.stopPropagation()}
                      className="row-arrow"
                      aria-label={r ? `Rà soát ${p.name}` : `Xem ${p.name}`}
                    >
                      <ArrowRight size={16} />
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 && (
          <EmptyState
            title={all.length ? "Không tìm thấy hồ sơ" : "Chưa có sản phẩm nào"}
            description={
              all.length
                ? "Thử tên khác hoặc bỏ bộ lọc để xem thêm sản phẩm."
                : "Tạo hồ sơ đầu tiên, bổ sung công thức và tải nhãn để bắt đầu."
            }
            action={
              all.length ? (
                <Button variant="secondary" onClick={reset}>
                  Xóa bộ lọc
                </Button>
              ) : (
                <Link href="/products/new" className="btn btn-primary">
                  <Plus size={16} /> Tạo hồ sơ
                </Link>
              )
            }
          />
        )}
      </div>
      <div className="table-pagination">
        <span>
          Hiển thị {filtered.length ? (currentPage - 1) * size + 1 : 0}–
          {Math.min(currentPage * size, filtered.length)} trên{" "}
          <strong>{filtered.length}</strong> sản phẩm
        </span>
        <div>
          <Button
            variant="secondary"
            size="sm"
            disabled={currentPage === 1}
            onClick={() => setPage(currentPage - 1)}
          >
            Trước
          </Button>
          {Array.from({ length: totalPages }, (_, i) => (
            <button
              className={clsx("page-number", currentPage === i + 1 && "active")}
              onClick={() => setPage(i + 1)}
              key={i}
              aria-label={`Trang ${i + 1}`}
              aria-current={currentPage === i + 1 ? "page" : undefined}
            >
              {i + 1}
            </button>
          ))}
          <Button
            variant="secondary"
            size="sm"
            disabled={currentPage === totalPages}
            onClick={() => setPage(currentPage + 1)}
          >
            Sau
          </Button>
        </div>
      </div>
    </Card>
  );
}
