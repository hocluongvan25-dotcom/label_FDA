"use client";

import { useState } from "react";
import {
  Activity,
  ArrowRight,
  Building2,
  Download,
  Eye,
  KeyRound,
  LockKeyhole,
  MailPlus,
  Pencil,
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
  Input,
  Modal,
  PageHeader,
  Select,
} from "./ui";
import type { Organization, Role } from "@/lib/types";
import { ROLE_LABELS } from "@/lib/constants";
import { can } from "@/lib/permissions";
import {
  downloadJson,
  errorMessage,
  formatDate,
  isCompleted,
  now,
  uid,
} from "@/lib/utils";

export function CustomersPage() {
  const app = useApp();
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [editing, setEditing] = useState<Organization | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("customer_contributor");
  const [busy, setBusy] = useState(false);
  if (!can(app.actor, "organizations"))
    return (
      <Card>
        <EmptyState
          title="Bạn không có quyền quản lý khách hàng"
          description="Quản trị khách hàng, chuyên viên và System Admin có thể xem tổ chức theo phạm vi được cấp quyền."
          icon={<LockKeyhole size={28} />}
        />
      </Card>
    );
  const organizations = app.data.organizations.filter((o) =>
    `${o.name} ${o.contact_email} ${o.contact_name}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const selected = app.data.organizations.find((o) => o.id === selectedId);
  const canManage = ["system_admin", "customer_admin"].includes(app.actor.role);
  const save = async () => {
    if (!editing) return;
    setBusy(true);
    try {
      await app.saveOrganization(editing);
      app.notify("Đã lưu thông tin doanh nghiệp.");
      setEditing(null);
    } catch (e) {
      app.notify(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  };
  const invite = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      await app.inviteMember(selected.id, name, email, role);
      app.notify(
        app.mode === "demo"
          ? "Đã tạo lời mời mẫu, không gửi email thật."
          : "Đã gửi lời mời tham gia qua email.",
      );
      setInviteOpen(false);
      setName("");
      setEmail("");
    } catch (e) {
      app.notify(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="page">
      <PageHeader
        eyebrow="ORGANIZATIONS & TEAM"
        title={
          app.actor.role === "customer_admin"
            ? "Doanh nghiệp & thành viên"
            : "Khách hàng"
        }
        description="Hồ sơ tập trung theo doanh nghiệp. Dữ liệu và quyền truy cập được phân tách giữa các tổ chức."
        actions={
          app.actor.role === "system_admin" && (
            <Button
              onClick={() =>
                setEditing({
                  id: uid(),
                  name: "",
                  country: "VN",
                  contact_email: "",
                  contact_name: "",
                  status: "active",
                  created_at: now(),
                })
              }
            >
              <Plus size={16} /> Tạo khách hàng
            </Button>
          )
        }
      />
      <div
        className="table-search"
        style={{
          width: 340,
          maxWidth: "100%",
          marginBottom: 23,
          background: "white",
        }}
      >
        <Search size={16} />
        <input
          aria-label="Tìm khách hàng"
          placeholder="Tên doanh nghiệp, người liên hệ hoặc email…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="org-grid">
        {organizations.map((o) => {
          const products = app.data.products.filter(
            (p) => p.organization_id === o.id,
          );
          const reviews = app.data.reviews.filter(
            (r) => r.organization_id === o.id,
          );
          const members = app.data.members.filter(
            (m) => m.organization_id === o.id,
          );
          return (
            <Card className="org-card" key={o.id}>
              <div className="org-card-top">
                <span className="org-card-logo">{o.name[0]}</span>
                <Badge tone={o.status === "active" ? "green" : "neutral"} dot>
                  {o.status === "active" ? "Đang hoạt động" : "Tạm khóa"}
                </Badge>
              </div>
              <h2>{o.name}</h2>
              <p>{o.contact_email}</p>
              <div className="org-card-stats">
                <div>
                  <strong>{products.length}</strong>
                  <span>sản phẩm</span>
                </div>
                <div>
                  <strong>
                    {reviews.filter((r) => !isCompleted(r.status)).length}
                  </strong>
                  <span>đang review</span>
                </div>
                <div>
                  <strong>{members.length}</strong>
                  <span>thành viên</span>
                </div>
              </div>
              <div className="org-card-footer">
                <span>🇻🇳 Việt Nam</span>
                <button
                  className="text-button"
                  onClick={() => setSelectedId(o.id)}
                >
                  Xem doanh nghiệp <ArrowRight size={13} />
                </button>
              </div>
            </Card>
          );
        })}
      </div>
      {!organizations.length && (
        <Card>
          <EmptyState
            title="Không có doanh nghiệp phù hợp"
            description="Thử tên khác hoặc liên hệ quản trị hệ thống để được cấp quyền."
            icon={<Building2 size={29} />}
          />
        </Card>
      )}
      <Modal
        open={!!selected && !inviteOpen && !editing}
        onClose={() => setSelectedId("")}
        title={selected?.name ?? "Doanh nghiệp"}
        description={selected?.contact_email}
        wide
        footer={
          <>
            <Button variant="secondary" onClick={() => setSelectedId("")}>
              Đóng
            </Button>
            {canManage && selected && (
              <Button
                variant="secondary"
                onClick={() => setEditing({ ...selected })}
              >
                <Pencil size={14} /> Sửa thông tin
              </Button>
            )}
            {can(app.actor, "members") && (
              <Button onClick={() => setInviteOpen(true)}>
                <MailPlus size={15} /> Mời thành viên
              </Button>
            )}
          </>
        }
      >
        {selected && (
          <>
            <dl
              className="description-list"
              style={{ padding: 0, marginBottom: 23 }}
            >
              <dt>Người liên hệ</dt>
              <dd>{selected.contact_name}</dd>
              <dt>Quốc gia</dt>
              <dd>
                {selected.country === "VN" ? "Việt Nam" : selected.country}
              </dd>
              <dt>Ngày tạo</dt>
              <dd>{formatDate(selected.created_at)}</dd>
              <dt>Trạng thái</dt>
              <dd>
                {selected.status === "active" ? "Đang hoạt động" : "Tạm khóa"}
              </dd>
            </dl>
            <h3 style={{ fontSize: 12, marginBottom: 16 }}>
              Thành viên & quyền truy cập
            </h3>
            {app.data.members
              .filter((m) => m.organization_id === selected.id)
              .map((m) => (
                <div className="member-row" key={m.id}>
                  <Avatar name={m.name} />
                  <div>
                    <strong>{m.name}</strong>
                    <p>
                      {m.email} · {ROLE_LABELS[m.role]}
                    </p>
                  </div>
                  <Badge
                    tone={
                      m.status === "active"
                        ? "green"
                        : m.status === "locked"
                          ? "red"
                          : "amber"
                    }
                  >
                    {m.status === "active"
                      ? "Hoạt động"
                      : m.status === "locked"
                        ? "Đã khóa"
                        : "Đã mời"}
                  </Badge>
                  {can(app.actor, "members") && m.status !== "invited" && (
                    <IconButton
                      label={
                        m.status === "locked"
                          ? `Mở khóa ${m.name}`
                          : `Khóa ${m.name}`
                      }
                      onClick={() =>
                        void app
                          .setMemberStatus(
                            m.id,
                            m.status === "locked" ? "active" : "locked",
                          )
                          .then(() =>
                            app.notify("Đã cập nhật trạng thái thành viên."),
                          )
                          .catch((e) => app.notify(errorMessage(e), "error"))
                      }
                    >
                      {m.status === "locked" ? (
                        <KeyRound size={15} />
                      ) : (
                        <LockKeyhole size={15} />
                      )}
                    </IconButton>
                  )}
                </div>
              ))}
            {!app.data.members.some(
              (m) => m.organization_id === selected.id,
            ) && (
              <p className="tiny muted">
                Chưa có thành viên. Dùng lời mời để thêm Customer Admin /
                Contributor.
              </p>
            )}
            <div style={{ marginTop: 20 }}>
              <InlineNotice icon={<ShieldCheck size={16} />}>
                Lời mời doanh nghiệp không cấp quyền nhân viên Vexim. System
                Admin cũng không được thay đổi luật nếu không có quyền
                Regulatory Admin.
              </InlineNotice>
            </div>
          </>
        )}
      </Modal>
      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={
          editing && app.data.organizations.some((o) => o.id === editing.id)
            ? "Cập nhật doanh nghiệp"
            : "Tạo khách hàng"
        }
        description="Thông tin liên hệ được dùng trong hồ sơ; không công khai với tổ chức khác."
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)}>
              Hủy
            </Button>
            <Button loading={busy} onClick={() => void save()}>
              Lưu doanh nghiệp
            </Button>
          </>
        }
      >
        {editing && (
          <>
            <Input
              label="Tên doanh nghiệp"
              required
              value={editing.name}
              onChange={(e) => setEditing({ ...editing, name: e.target.value })}
            />
            <Input
              label="Người liên hệ"
              value={editing.contact_name}
              onChange={(e) =>
                setEditing({ ...editing, contact_name: e.target.value })
              }
            />
            <Input
              label="Email liên hệ"
              type="email"
              required
              value={editing.contact_email}
              onChange={(e) =>
                setEditing({ ...editing, contact_email: e.target.value })
              }
            />
            <Select
              label="Quốc gia"
              value={editing.country}
              onChange={(e) =>
                setEditing({ ...editing, country: e.target.value })
              }
            >
              <option value="VN">Việt Nam</option>
              <option value="US">Hoa Kỳ</option>
              <option value="TH">Thái Lan</option>
              <option value="CN">Trung Quốc</option>
              <option value="OTHER">Khác</option>
            </Select>
            {app.actor.role === "system_admin" && (
              <Select
                label="Trạng thái"
                value={editing.status}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    status: e.target.value as Organization["status"],
                  })
                }
              >
                <option value="active">Đang hoạt động</option>
                <option value="inactive">Tạm khóa</option>
              </Select>
            )}
          </>
        )}
      </Modal>
      <Modal
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        title="Mời thành viên"
        description={`Tham gia ${selected?.name}. Chỉ cấp quyền trong tổ chức này.`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setInviteOpen(false)}>
              Hủy
            </Button>
            <Button
              loading={busy}
              disabled={!name.trim() || !email.trim()}
              onClick={() => void invite()}
            >
              <MailPlus size={15} />{" "}
              {app.mode === "demo" ? "Tạo lời mời mẫu" : "Gửi lời mời"}
            </Button>
          </>
        }
      >
        <Input
          label="Họ và tên"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
        <Input
          label="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <Select
          label="Vai trò"
          value={role}
          onChange={(e) => setRole(e.target.value as Role)}
        >
          <option value="customer_contributor">
            Customer Contributor — nhập dữ liệu & tải nhãn
          </option>
          <option value="customer_admin">
            Customer Admin — quản lý doanh nghiệp & thành viên
          </option>
        </Select>
        {app.mode === "demo" && (
          <div style={{ marginTop: 20 }}>
            <InlineNotice tone="warning">
              Trong demo, lời mời chỉ được lưu trong dữ liệu mẫu. Không gửi
              email ra ngoài.
            </InlineNotice>
          </div>
        )}
      </Modal>
    </div>
  );
}
export function AuditPage() {
  const app = useApp();
  const [query, setQuery] = useState("");
  const [action, setAction] = useState("all");
  const [orgId, setOrgId] = useState("all");
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState("");
  if (!can(app.actor, "audit"))
    return (
      <Card>
        <EmptyState
          title="Nhật ký được giới hạn theo vai trò"
          description="Liên hệ Customer Admin hoặc quản trị hệ thống để kiểm tra hoạt động."
          icon={<LockKeyhole size={30} />}
        />
      </Card>
    );
  const entries = app.data.audit
    .filter(
      (a) =>
        (action === "all" || a.action.startsWith(action)) &&
        (orgId === "all" ||
          a.organization_id === orgId ||
          (orgId === "regulatory" && !a.organization_id)) &&
        `${a.action} ${a.description} ${a.actor_name}`
          .toLowerCase()
          .includes(query.toLowerCase()),
    )
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const size = 15;
  const maxPage = Math.max(1, Math.ceil(entries.length / size));
  const current = Math.min(page, maxPage);
  const rows = entries.slice((current - 1) * size, current * size);
  const selected = app.data.audit.find((a) => a.id === selectedId);
  return (
    <div className="page">
      <PageHeader
        eyebrow="APPEND-ONLY AUDIT TRAIL"
        title="Nhật ký hoạt động"
        description="Ai đã làm gì, với hồ sơ nào và tại thời điểm nào. Người dùng thông thường không được sửa hoặc xóa nhật ký."
        actions={
          <Button
            variant="secondary"
            onClick={() => downloadJson(entries, "vexim-audit-log.json")}
          >
            <Download size={15} /> Xuất JSON
          </Button>
        }
      />
      <Card>
        <div className="audit-filter">
          <div className="table-search">
            <Search size={16} />
            <input
              aria-label="Tìm nhật ký"
              placeholder="Thao tác, người thực hiện, nội dung…"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <Select
            aria-label="Lọc loại thao tác"
            value={action}
            onChange={(e) => {
              setAction(e.target.value);
              setPage(1);
            }}
          >
            <option value="all">Tất cả thao tác</option>
            {[
              ["product", "Hồ sơ sản phẩm"],
              ["label", "Phiên bản nhãn"],
              ["file", "Truy cập file"],
              ["review", "Review"],
              ["finding", "Finding"],
              ["rule", "Quy tắc"],
              ["source", "Nguồn pháp lý"],
              ["report", "Báo cáo"],
              ["information", "Yêu cầu bổ sung"],
              ["member", "Thành viên"],
            ].map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </Select>
          <Select
            aria-label="Lọc tổ chức trong nhật ký"
            value={orgId}
            onChange={(e) => {
              setOrgId(e.target.value);
              setPage(1);
            }}
          >
            <option value="all">Tất cả tổ chức</option>
            {app.data.organizations.map((o) => (
              <option value={o.id} key={o.id}>
                {o.name}
              </option>
            ))}
            {!app.actor.role.startsWith("customer") && (
              <option value="regulatory">Source / rule registry</option>
            )}
          </Select>
        </div>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>THỜI ĐIỂM</th>
                <th>NGƯỜI THỰC HIỆN</th>
                <th>THAO TÁC</th>
                <th>NỘI DUNG</th>
                <th>TỔ CHỨC</th>
                <th>
                  <span className="sr-only">Chi tiết</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id}>
                  <td>{formatDate(a.created_at, true)}</td>
                  <td>
                    <div
                      style={{ display: "flex", alignItems: "center", gap: 7 }}
                    >
                      <Avatar name={a.actor_name} size="sm" />
                      {a.actor_name}
                    </div>
                  </td>
                  <td>
                    <span className="audit-action">{a.action}</span>
                  </td>
                  <td>
                    <div className="audit-description">{a.description}</div>
                  </td>
                  <td style={{ fontSize: 9 }}>
                    {app.data.organizations.find(
                      (o) => o.id === a.organization_id,
                    )?.name ?? "Regulatory registry"}
                  </td>
                  <td>
                    <IconButton
                      label="Xem chi tiết audit"
                      onClick={() => setSelectedId(a.id)}
                    >
                      <Eye size={15} />
                    </IconButton>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length && (
            <EmptyState
              title="Không có hoạt động phù hợp"
              description="Thử bỏ bộ lọc. Các thao tác mới sẽ được ghi lại tự động."
              icon={<Activity size={27} />}
            />
          )}
        </div>
        <div className="table-pagination">
          <span>{entries.length} sự kiện · chỉ đọc</span>
          <div>
            <Button
              variant="secondary"
              size="sm"
              disabled={current <= 1}
              onClick={() => setPage(current - 1)}
            >
              Trước
            </Button>
            <span>
              {current}/{maxPage}
            </span>
            <Button
              variant="secondary"
              size="sm"
              disabled={current >= maxPage}
              onClick={() => setPage(current + 1)}
            >
              Sau
            </Button>
          </div>
        </div>
      </Card>
      <div style={{ marginTop: 20 }}>
        <InlineNotice icon={<LockKeyhole size={16} />}>
          {app.mode === "demo"
            ? "Nhật ký demo minh họa quy trình. LocalStorage không phải kho audit chống sửa đổi; dữ liệu thật dùng RLS, trigger append-only và quyền database trong Supabase."
            : "Nhật ký được ghi bằng database trigger / RPC được bảo vệ. API không cung cấp thao tác cập nhật hoặc xóa audit log."}
        </InlineNotice>
      </div>
      <Modal
        open={!!selected}
        onClose={() => setSelectedId("")}
        title="Chi tiết sự kiện"
        description={selected?.action}
        wide
      >
        {selected && (
          <>
            <dl className="description-list" style={{ padding: 0 }}>
              <dt>Thời điểm</dt>
              <dd>{formatDate(selected.created_at, true)}</dd>
              <dt>Người thực hiện</dt>
              <dd>
                {selected.actor_name} · {selected.actor_id}
              </dd>
              <dt>Đối tượng</dt>
              <dd>
                {selected.entity_type} · {selected.entity_id}
              </dd>
              <dt>Nội dung</dt>
              <dd>{selected.description}</dd>
            </dl>
            <pre className="rule-detail-json" style={{ marginTop: 23 }}>
              {JSON.stringify(selected.metadata, null, 2)}
            </pre>
          </>
        )}
      </Modal>
    </div>
  );
}
