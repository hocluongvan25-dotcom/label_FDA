"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Download,
  FileCheck2,
  FileText,
  Globe2,
  History,
  Pencil,
  Plus,
  ShieldCheck,
  UploadCloud,
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
  Modal,
  StatusBadge,
  TeaThumbnail,
} from "./ui";
import { FileDropzone } from "./file-dropzone";
import { CATEGORY_LABELS, CHANNEL_LABELS, FORM_LABELS } from "@/lib/constants";
import { can } from "@/lib/permissions";
import {
  assigneeName,
  downloadBlob,
  errorMessage,
  findingCounts,
  formatBytes,
  formatDate,
} from "@/lib/utils";
import type { LabelFile, LabelVersion } from "@/lib/types";

export function ProductDetail({ productId }: { productId: string }) {
  const app = useApp();
  const router = useRouter();
  const product = app.data.products.find((p) => p.id === productId);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [filesLabel, setFilesLabel] = useState<LabelVersion | null>(null);
  const [downloadId, setDownloadId] = useState<string | null>(null);
  if (!product)
    return (
      <Card>
        <EmptyState
          title="Không tìm thấy hồ sơ"
          description="Hồ sơ không tồn tại hoặc không thuộc tổ chức của bạn."
          action={
            <Link href="/products" className="btn btn-secondary">
              Về danh sách
            </Link>
          }
        />
      </Card>
    );
  const versions = app.data.labelVersions
    .filter((v) => v.product_id === productId)
    .sort((a, b) => b.version - a.version);
  const reviews = app.data.reviews
    .filter((r) => r.product_id === productId)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const latest = reviews[0];
  const counts = findingCounts(
    app.data.findings.filter((f) => f.review_id === latest?.id),
  );
  const org = app.data.organizations.find(
    (o) => o.id === product.organization_id,
  );
  const organizationName =
    org?.name ??
    app.data.reviewParticipants?.find(
      (participant) =>
        participant.review_id === latest?.id &&
        participant.party_role === "label_owner",
    )?.organization_name_snapshot;
  const canManageProduct =
    can(app.actor, "products") &&
    (!app.actor.role.startsWith("customer") ||
      app.actor.organization_id === product.organization_id);
  const requests = app.data.requests.filter((r) =>
    reviews.some((rv) => rv.id === r.review_id),
  );
  const submit = async (labelId?: string) => {
    setBusy(true);
    try {
      const label = labelId
        ? app.data.labelVersions.find((v) => v.id === labelId)!
        : await app.uploadVersion(product.id, files);
      const review = await app.submitReview(label.id);
      setUploadOpen(false);
      setFiles([]);
      app.notify("Đã gửi phiên bản nhãn để kiểm tra.");
      router.push(`/reviews/${review.id}`);
    } catch (e) {
      app.notify(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  };
  const downloadFile = async (label: LabelVersion, file: LabelFile) => {
    setDownloadId(file.id);
    try {
      const blob = await app.getFileBlob(file);
      downloadBlob(blob, file.name);
      await app.logFileAccess(label, file, "download");
    } catch (e) {
      app.notify(errorMessage(e), "error");
    } finally {
      setDownloadId(null);
    }
  };
  return (
    <div className="page">
      <Link href="/products" className="back-link">
        <ArrowLeft size={13} /> Danh sách sản phẩm
      </Link>
      <div className="page-header">
        <div className="detail-hero">
          <TeaThumbnail color={product.color} form={product.form} size="lg" />
          <div>
            <div className="eyebrow">
              PRODUCT DOSSIER · {product.id.slice(-6).toUpperCase()}
            </div>
            <h1>{product.name}</h1>
            <div className="detail-meta">
              <span>{product.brand}</span>
              <span>·</span>
              <span>{organizationName}</span>
              <StatusBadge status={latest?.status ?? "DRAFT"} />
            </div>
          </div>
        </div>
        <div className="page-actions">
          {canManageProduct && (
            <>
              <Link
                href={`/products/${product.id}/edit`}
                className="btn btn-secondary"
              >
                <Pencil size={14} /> Sửa hồ sơ
              </Link>
              <Button
                onClick={() => {
                  setFiles([]);
                  setConfirmed(false);
                  setUploadOpen(true);
                }}
              >
                <UploadCloud size={15} /> Tải nhãn mới
              </Button>
            </>
          )}
        </div>
      </div>
      <div className="detail-metrics">
        <Card className="detail-metric">
          <span>PHIÊN BẢN NHÃN</span>
          <strong>{versions.length ? `v${versions[0].version}` : "—"}</strong>
          <small>{versions.length} phiên bản được giữ lại</small>
        </Card>
        <Card className="detail-metric">
          <span>FINDINGS HIỆN TẠI</span>
          <strong>
            {counts.critical + counts.major + counts.minor + counts.information}
          </strong>
          <small>
            {counts.critical} nghiêm trọng · {counts.major} cần sửa
          </small>
        </Card>
        <Card className="detail-metric">
          <span>CẬP NHẬT GẦN NHẤT</span>
          <strong>{formatDate(product.updated_at).slice(0, 5)}</strong>
          <small>{formatDate(product.updated_at, true)}</small>
        </Card>
      </div>
      <div className="detail-layout">
        <div>
          <Card className="detail-section">
            <div className="card-header">
              <div className="card-title-group">
                <h2>Thông tin sản phẩm</h2>
                <Badge tone="green">US</Badge>
              </div>
              <Globe2 size={17} color="#a4b893" />
            </div>
            <dl className="description-list">
              <dt>Nhóm sản phẩm</dt>
              <dd>{CATEGORY_LABELS[product.category]}</dd>
              <dt>Dạng sản phẩm</dt>
              <dd>{FORM_LABELS[product.form]}</dd>
              <dt>Quy cách đóng gói</dt>
              <dd>{product.package_size || "Chưa khai báo"}</dd>
              <dt>Khối lượng tịnh</dt>
              <dd>{product.net_quantity || "Chưa khai báo"}</dd>
              <dt>Kênh bán tại Hoa Kỳ</dt>
              <dd>
                {product.channel.map((c) => CHANNEL_LABELS[c] ?? c).join(", ")}
              </dd>
              <dt>Sản lượng / 12 tháng</dt>
              <dd>
                {product.expected_us_units_12m?.toLocaleString("vi-VN") ??
                  "Chưa khai báo"}{" "}
                đơn vị
              </dd>
              <dt>Nhân sự FTE</dt>
              <dd>{product.employee_fte ?? "Chưa khai báo"}</dd>
              <dt>Exemption pre-check</dt>
              <dd>
                {product.exemption_requested
                  ? "Đã đề nghị chuyên gia đánh giá · chưa phải kết luận miễn"
                  : "Không đề nghị"}
              </dd>
            </dl>
          </Card>
          <Card className="detail-section">
            <div className="card-header">
              <h2>Công thức & nguyên liệu</h2>
              <FlaskBadge />
            </div>
            {product.formula.length ? (
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>THỨ TỰ</th>
                      <th>NGUYÊN LIỆU</th>
                      <th>TÊN TIẾNG ANH</th>
                      <th>TỶ LỆ</th>
                      <th>DỊ NGUYÊN</th>
                    </tr>
                  </thead>
                  <tbody>
                    {product.formula.map((i) => (
                      <tr key={i.id}>
                        <td>{i.order}</td>
                        <td>{i.name_original}</td>
                        <td>{i.name_english}</td>
                        <td>
                          {i.percentage !== null
                            ? `${i.percentage}%`
                            : "Theo thứ tự"}
                        </td>
                        <td>
                          {i.allergen_groups.join(", ") || "Chưa khai báo"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState
                title="Chưa có công thức"
                description="Bổ sung nguyên liệu để kiểm tra consistency và allergens."
              />
            )}
            <div style={{ padding: "15px 20px" }}>
              <InlineNotice icon={<ShieldCheck size={15} />}>
                {product.formula_confirmed
                  ? "Khách hàng đã xác nhận công thức và thứ tự khối lượng."
                  : "Công thức chưa được xác nhận. Cần bổ sung trước khi gửi review."}
              </InlineNotice>
            </div>
          </Card>
          <Card className="detail-section">
            <div className="card-header">
              <h2>Claims & đơn vị chịu trách nhiệm</h2>
            </div>
            <div className="detail-tag-row">
              {product.claims.length ? (
                product.claims.map((c) => (
                  <Badge key={c} tone="amber">
                    {c}
                  </Badge>
                ))
              ) : (
                <span className="tiny muted">Không có claim khai báo.</span>
              )}
            </div>
            <dl className="description-list" style={{ paddingTop: 0 }}>
              {(
                [
                  ["manufacturer", "Nhà sản xuất"],
                  ["packer", "Đơn vị đóng gói"],
                  ["distributor", "Nhà phân phối"],
                  ["importer", "Importer / consignee"],
                ] as const
              ).map(([key, label]) => (
                <div key={key} style={{ display: "contents" }}>
                  <dt>{label}</dt>
                  <dd>
                    {product[key].name
                      ? `${product[key].name}${product[key].address ? ` — ${product[key].address}` : ""}`
                      : "Chưa khai báo"}
                  </dd>
                </div>
              ))}
            </dl>
          </Card>
          <Card className="detail-section">
            <div className="card-header">
              <div className="card-title-group">
                <h2>Yêu cầu bổ sung thông tin</h2>
                <Badge>
                  {requests.filter((r) => r.status === "open").length}
                </Badge>
              </div>
            </div>
            {requests.length ? (
              requests.map((r) => (
                <div className="document-request" key={r.id}>
                  <p>{r.message}</p>
                  <div>
                    {r.requested_documents.map((d) => (
                      <Badge key={d} tone="amber">
                        {d}
                      </Badge>
                    ))}
                    <Badge tone={r.status === "open" ? "amber" : "green"}>
                      {r.status === "open" ? "Chờ bổ sung" : "Đã nhận"}
                    </Badge>
                  </div>
                  <div>
                    <small className="tiny muted">
                      {formatDate(r.created_at, true)}
                    </small>
                    {r.status === "open" && can(app.actor, "review") && (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() =>
                          void app
                            .resolveRequest(r.id)
                            .then(() =>
                              app.notify("Đã xác nhận dữ liệu bổ sung."),
                            )
                            .catch((e) => app.notify(errorMessage(e), "error"))
                        }
                      >
                        <Check size={13} /> Xác nhận đã nhận
                      </Button>
                    )}
                  </div>
                </div>
              ))
            ) : (
              <div
                style={{ padding: "0 20px 20px", fontSize: 12 }}
                className="muted"
              >
                Chưa có yêu cầu bổ sung cho hồ sơ này.
              </div>
            )}
          </Card>
        </div>
        <aside>
          <Card className="detail-info-card">
            <h3>
              <FileCheck2 size={16} /> Rà soát phiên bản mới nhất
            </h3>
            <div>
              <span>Chuyên viên</span>
              <span className="assignee-label">
                {latest?.assigned_to && (
                  <Avatar
                    name={assigneeName(app.data, latest.assigned_to, app.actor)}
                    size="sm"
                  />
                )}
                {assigneeName(app.data, latest?.assigned_to, app.actor)}
              </span>
            </div>
            <div>
              <span>Trạng thái</span>
              <StatusBadge status={latest?.status ?? "DRAFT"} />
            </div>
            <div>
              <span>Finding nghiêm trọng</span>
              <strong>{counts.critical}</strong>
            </div>
            {latest ? (
              <Link
                className="btn btn-primary full-width"
                href={`/reviews/${latest.id}`}
              >
                Mở không gian rà soát <ArrowRight size={15} />
              </Link>
            ) : versions.length > 0 ? (
              <Button
                className="full-width"
                loading={busy}
                onClick={() => void submit(versions[0].id)}
              >
                Gửi rà soát <ArrowRight size={15} />
              </Button>
            ) : (
              <Button
                variant="soft"
                className="full-width"
                onClick={() => setUploadOpen(true)}
              >
                <Plus size={14} /> Tải nhãn đầu tiên
              </Button>
            )}
          </Card>
          <Card className="detail-section" style={{ marginTop: 20 }}>
            <div className="card-header">
              <h2>Phiên bản nhãn</h2>
              <History size={16} color="#aabf98" />
            </div>
            {versions.map((v) => {
              const review = reviews.find((r) => r.label_version_id === v.id);
              return (
                <div className="label-version-item" key={v.id}>
                  <span className="label-version-icon">
                    <FileText size={19} />
                  </span>
                  <div>
                    <strong>
                      Nhãn v{v.version}
                      {v === versions[0] && (
                        <Badge tone="green" className="version-tag">
                          Mới nhất
                        </Badge>
                      )}
                    </strong>
                    <p>
                      {formatDate(v.uploaded_at)} · {v.original_files.length}{" "}
                      file
                    </p>
                    <button
                      className="text-button"
                      style={{ fontSize: 11, marginTop: 5 }}
                      onClick={() => setFilesLabel(v)}
                    >
                      Xem file gốc
                    </button>
                  </div>
                  {review ? (
                    <Link
                      href={`/reviews/${review.id}`}
                      className="row-arrow"
                      aria-label={`Mở review nhãn v${v.version}`}
                    >
                      <ArrowRight size={14} />
                    </Link>
                  ) : (
                    <Badge>Bản nhãn</Badge>
                  )}
                </div>
              );
            })}
            {!versions.length && (
              <EmptyState
                title="Chưa có nhãn"
                description="Tải file nhãn để bắt đầu review."
              />
            )}
          </Card>
          <Card style={{ marginTop: 20 }}>
            <div className="card-header">
              <h2>Báo cáo của sản phẩm</h2>
            </div>
            {app.data.reports
              .filter((r) => r.product_id === productId)
              .map((r) => (
                <div className="label-version-item" key={r.id}>
                  <span className="label-version-icon">
                    <FileText size={17} />
                  </span>
                  <div>
                    <strong>{r.report_number}</strong>
                    <p>
                      Nhãn v{r.snapshot.label_version.version} ·{" "}
                      {formatDate(r.created_at)}
                    </p>
                  </div>
                  <IconButton
                    label={`Tải PDF ${r.report_number}`}
                    onClick={() =>
                      void app
                        .downloadReport(r.id, "pdf")
                        .catch((e) => app.notify(errorMessage(e), "error"))
                    }
                  >
                    <Download size={15} />
                  </IconButton>
                </div>
              ))}
            {!app.data.reports.some((r) => r.product_id === productId) && (
              <p className="tiny muted" style={{ padding: "0 20px 20px" }}>
                Báo cáo chỉ được tạo sau khi chuyên viên xác nhận.
              </p>
            )}
          </Card>
          <div style={{ marginTop: 20 }}>
            <InlineNotice tone="warning">
              Hồ sơ chỉ hỗ trợ đánh giá trong phạm vi MVP, không phải phê duyệt
              nhãn hoặc sản phẩm của FDA.
            </InlineNotice>
          </div>
        </aside>
      </div>
      <Modal
        open={uploadOpen}
        onClose={() => !busy && setUploadOpen(false)}
        title={`Tải phiên bản nhãn v${(versions[0]?.version ?? 0) + 1}`}
        description="File cũ không bị ghi đè. Review mới sẽ liên kết chính xác với phiên bản mới."
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => setUploadOpen(false)}
              disabled={busy}
            >
              Hủy
            </Button>
            <Button
              onClick={() => void submit()}
              disabled={!files.length || !confirmed}
              loading={busy}
            >
              Tải lên và rà soát <ArrowRight size={15} />
            </Button>
          </>
        }
      >
        <FileDropzone files={files} onChange={setFiles} disabled={busy} />
        <div style={{ marginTop: 20 }}>
          <Checkbox checked={confirmed} onChange={setConfirmed}>
            Tôi xác nhận nhãn mới tương ứng với công thức và claim hiện tại
            trong hồ sơ.
          </Checkbox>
        </div>
        <div style={{ marginTop: 18 }}>
          <InlineNotice icon={<Pencil size={16} />}>
            Nếu công thức hoặc claim đã thay đổi, hãy sửa hồ sơ trước khi tải
            nhãn. Hệ thống không tự đoán các thay đổi trong thiết kế.
          </InlineNotice>
        </div>
      </Modal>
      <Modal
        open={!!filesLabel}
        onClose={() => setFilesLabel(null)}
        title={`File gốc · Nhãn v${filesLabel?.version ?? ""}`}
        description="Giữ nguyên nội dung tải lên; bản normalized được lưu riêng."
      >
        {filesLabel?.original_files.map((f) => (
          <div className="upload-item" key={f.id} style={{ marginBottom: 12 }}>
            <FileText size={21} />
            <div>
              <strong>{f.name}</strong>
              <span>
                {formatBytes(f.size)} · {f.page_count} trang ·{" "}
                {f.scan_status === "clean"
                  ? "Đã quét virus"
                  : app.mode === "demo"
                    ? "Chưa quét virus (demo)"
                    : "Đang chờ kiểm tra"}
              </span>
              <p className="source-hash">SHA-256: {f.sha256}</p>
            </div>
            <Button
              variant="secondary"
              size="sm"
              loading={downloadId === f.id}
              onClick={() => void downloadFile(filesLabel, f)}
            >
              <Download size={14} />
            </Button>
          </div>
        ))}
      </Modal>
    </div>
  );
}
function FlaskBadge() {
  return <Badge tone="green">Thông tin khách hàng</Badge>;
}
