"use client";

import { useState } from "react";
import {
  CheckCheck,
  CircleAlert,
  Clipboard,
  Database,
  Download,
  ExternalLink,
  FileText,
  Info,
  Leaf,
  LogOut,
  RefreshCw,
  ShieldCheck,
  Users,
} from "lucide-react";
import clsx from "clsx";
import { useApp } from "./app-provider";
import {
  Avatar,
  Badge,
  Button,
  Card,
  Checkbox,
  GuideModal,
  InlineNotice,
  Modal,
  PageHeader,
} from "./ui";
import { ROLE_LABELS } from "@/lib/constants";
import { api, isSupabaseConfigured } from "@/lib/supabase";
import { downloadJson, errorMessage } from "@/lib/utils";
import type { Role } from "@/lib/types";

export function SettingsPage() {
  const app = useApp();
  const [guide, setGuide] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [health, setHealth] = useState<{
    database: string;
    scanner_configured: boolean;
    worker_last_activity: string | null;
    local_ocr: boolean;
  } | null>(null);
  const roles: { role: Role; name: string; alternate?: boolean }[] = [
    { role: "reviewer", name: "Linh Nguyễn" },
    { role: "customer_admin", name: "Minh Anh · An Nhiên Tea" },
    { role: "customer_contributor", name: "Tuấn Anh · An Nhiên Tea" },
    { role: "regulatory_admin", name: "Hà Trần · tạo draft" },
    {
      role: "regulatory_admin",
      name: "Minh Phạm · người duyệt",
      alternate: true,
    },
    { role: "system_admin", name: "Quang Lê" },
  ];
  const checkConnection = async () => {
    setBusy(true);
    try {
      if (!isSupabaseConfigured() || app.mode === "demo") {
        app.notify(
          "Demo đang lưu dữ liệu trên thiết bị. Cần cấu hình .env.local và migration để dùng Supabase thật.",
          "info",
        );
        return;
      }
      const result = await api<typeof health>("/health");
      setHealth(result);
      app.notify("Đã kiểm tra kết nối Supabase.");
    } catch (e) {
      app.notify(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  };
  const reset = async () => {
    setBusy(true);
    try {
      await app.resetDemo();
      setResetOpen(false);
      setConfirmed(false);
    } catch (e) {
      app.notify(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(
        "NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co\nNEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR_PUBLIC_ANON_KEY\n# Server/worker ONLY — never put service-role keys in NEXT_PUBLIC variables\nSUPABASE_SERVICE_ROLE_KEY=YOUR_SERVER_ONLY_KEY",
      );
      app.notify(
        "Đã sao chép mẫu cấu hình. Điền khóa trong .env.local, không gửi khóa bí mật qua chat.",
      );
    } catch {
      app.notify(
        "Trình duyệt không cho phép clipboard. Bạn có thể sao chép trực tiếp phần cấu hình bên dưới.",
        "info",
      );
    }
  };
  return (
    <div className="page">
      <PageHeader
        eyebrow="WORKSPACE SETTINGS"
        title="Cài đặt"
        description="Thông tin tài khoản, kết nối dữ liệu và những kiểm soát cần thiết để triển khai thật."
      />
      <div className="settings-layout">
        <div>
          <Card className="settings-card">
            <div className="card-header">
              <h2>Tài khoản & quyền truy cập</h2>
              <Users size={17} color="#94ac7b" />
            </div>
            <div className="settings-card-body">
              <div className="profile-summary">
                <Avatar name={app.actor.name} size="lg" />
                <div>
                  <strong>{app.actor.name}</strong>
                  <p>{app.actor.email}</p>
                </div>
                <Badge tone="green">
                  {app.mode === "demo" ? "Persona mẫu" : "Supabase Auth"}
                </Badge>
              </div>
              <div className="settings-info-row">
                <span>Vai trò hiện tại</span>
                <strong>{ROLE_LABELS[app.actor.role]}</strong>
              </div>
              <div className="settings-info-row">
                <span>Doanh nghiệp</span>
                <strong>
                  {app.actor.organization_id
                    ? app.data.organizations.find(
                        (o) => o.id === app.actor.organization_id,
                      )?.name
                    : "Vexim Staff"}
                </strong>
              </div>
              <div className="settings-info-row">
                <span>Phân quyền</span>
                <strong>
                  {app.mode === "demo"
                    ? "Mô phỏng trên trình duyệt"
                    : "RLS + RBAC trên server"}
                </strong>
              </div>
              <div style={{ marginTop: 20 }}>
                <Button
                  variant="secondary"
                  onClick={() =>
                    void app
                      .signOut()
                      .catch((e) => app.notify(errorMessage(e), "error"))
                  }
                >
                  <LogOut size={14} /> Đăng xuất
                </Button>
              </div>
            </div>
          </Card>
          <Card className="settings-card">
            <div className="card-header">
              <h2>Kết nối Supabase</h2>
              <Badge tone={app.mode === "supabase" ? "green" : "amber"} dot>
                {app.mode === "supabase" ? "Đã kết nối" : "Chưa cấu hình"}
              </Badge>
            </div>
            <div className="settings-card-body">
              <div className="connection-state">
                <Database size={22} />
                <div>
                  <strong>
                    {app.mode === "supabase"
                      ? "Supabase PostgreSQL · Auth · Private Storage"
                      : "Chế độ mẫu · LocalStorage + IndexedDB"}
                  </strong>
                  <p>
                    {app.mode === "supabase"
                      ? "Dữ liệu truy cập theo token người dùng và quyền tổ chức."
                      : "Không gian riêng trên trình duyệt này. Dữ liệu mẫu không được đồng bộ lên Supabase."}
                  </p>
                </div>
              </div>
              <p className="tiny muted" style={{ marginBottom: 15 }}>
                Cấu hình dự án trong repository, không nhập service-role key
                trong giao diện hoặc chat.
              </p>
              <pre className="code-block">
                NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co{"\n"}
                NEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR_PUBLIC_ANON_KEY{"\n"}# Server
                / worker only:{"\n"}
                SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVER_ONLY_KEY
              </pre>
              <ol className="setup-steps">
                <li>
                  Tạo dự án Supabase và chạy{" "}
                  <code>supabase/migrations/0001_initial.sql</code>, sau đó{" "}
                  <code>0002_registry_seed.sql</code>.
                </li>
                <li>
                  Chép <code>.env.example</code> thành <code>.env.local</code>,
                  điền cấu hình và khởi động lại ứng dụng.
                </li>
                <li>
                  Đăng ký tài khoản, xác nhận email, tạo doanh nghiệp. Quyền
                  staff phải được cấp bằng SQL bởi project owner.
                </li>
                <li>
                  Cấu hình ClamAV, chạy <code>npm run worker</code>. Regulatory
                  Admin truy xuất và duyệt nguồn / 15 rules trước khi nhận nhãn
                  thật.
                </li>
              </ol>
              <div style={{ display: "flex", gap: 9, flexWrap: "wrap" }}>
                <Button variant="secondary" onClick={() => void copy()}>
                  <Clipboard size={14} /> Sao chép mẫu
                </Button>
                <Button
                  variant="secondary"
                  loading={busy}
                  onClick={() => void checkConnection()}
                >
                  <RefreshCw size={14} /> Kiểm tra kết nối
                </Button>
                <a
                  className="btn btn-ghost"
                  href="https://supabase.com/dashboard"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Supabase Dashboard <ExternalLink size={13} />
                </a>
              </div>
              {health && (
                <div style={{ marginTop: 18 }}>
                  <InlineNotice
                    tone={health.scanner_configured ? "success" : "warning"}
                  >
                    Database: {health.database} · Malware scanner:{" "}
                    {health.scanner_configured
                      ? "Đã cấu hình (cần kiểm thử kết nối)"
                      : "Chưa cấu hình"}{" "}
                    · Worker:{" "}
                    {health.worker_last_activity
                      ? `Có hoạt động gần nhất ${health.worker_last_activity}`
                      : "Chưa có tác vụ được xử lý"}
                  </InlineNotice>
                </div>
              )}
            </div>
          </Card>
          {app.mode === "demo" && (
            <Card className="settings-card">
              <div className="card-header">
                <h2>Khám phá theo vai trò</h2>
                <Badge tone="amber">Chỉ có trong demo</Badge>
              </div>
              <div className="settings-card-body">
                <p className="tiny muted">
                  Đổi persona để thử cách dữ liệu và thao tác thay đổi theo
                  quyền. Dữ liệu thật không thể tự cấp quyền trong trình duyệt.
                </p>
                <div className="settings-demo-roles">
                  {roles.map((r) => (
                    <button
                      key={`${r.role}-${r.alternate}`}
                      className={clsx(
                        "role-button",
                        app.actor.role === r.role &&
                          (r.role !== "regulatory_admin" ||
                            !!r.alternate ===
                              app.actor.id.endsWith("approver")) &&
                          "active",
                      )}
                      onClick={() => app.setDemoRole(r.role, r.alternate)}
                    >
                      <Avatar
                        name={r.name.split(" · ")[0]}
                        size="sm"
                        tone="sage"
                      />
                      <div>
                        <strong>{ROLE_LABELS[r.role]}</strong>
                        <span>{r.name}</span>
                      </div>
                    </button>
                  ))}
                </div>
                <div style={{ marginTop: 19 }}>
                  <InlineNotice icon={<Info size={16} />}>
                    Regulatory Admin tạo draft không tự phê duyệt. Đổi sang
                    persona “Minh Phạm · người duyệt” để thử quy trình xác nhận
                    độc lập.
                  </InlineNotice>
                </div>
              </div>
            </Card>
          )}
          {app.mode === "demo" && (
            <Card className="settings-card danger-zone">
              <div className="card-header">
                <h2>Dữ liệu thử nghiệm trên thiết bị</h2>
              </div>
              <div className="settings-card-body">
                <p>
                  Đặt lại demo sẽ xóa hồ sơ / nhãn bạn đã tạo ở chế độ mẫu, bao
                  gồm file trong IndexedDB. Không ảnh hưởng database Supabase.
                </p>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <Button
                    variant="secondary"
                    onClick={() =>
                      downloadJson(
                        {
                          schema_version: 3,
                          data: app.data,
                          actor: app.actor,
                          note: "Metadata only. Files in IndexedDB are not included.",
                        },
                        "vexim-demo-metadata.json",
                      )
                    }
                  >
                    <Download size={14} /> Xuất metadata mẫu
                  </Button>
                  <Button
                    variant="danger"
                    onClick={() => {
                      setConfirmed(false);
                      setResetOpen(true);
                    }}
                  >
                    Đặt lại demo
                  </Button>
                </div>
              </div>
            </Card>
          )}
        </div>
        <aside className="settings-aside">
          <Card>
            <h3>
              <ShieldCheck size={18} /> Triển khai có kiểm soát
            </h3>
            <div className="security-list">
              {[
                [
                  "Tách dữ liệu theo tổ chức",
                  "RLS trên bảng nghiệp vụ và đường dẫn Storage; không dùng service-role key ở client.",
                ],
                [
                  "File riêng tư & bất biến",
                  "Signed URL có hạn, SHA-256, bucket gốc riêng, normalized file riêng.",
                ],
                [
                  "Malware scan trước xử lý",
                  "Production chặn pipeline nếu chưa có ClamAV hoặc nếu scanner thất bại.",
                ],
                [
                  "Nguồn / rule cần phê duyệt",
                  "Seed pháp lý là draft. Cần snapshot, hash, QA và người duyệt độc lập.",
                ],
                [
                  "Audit & báo cáo bất biến",
                  "Database trigger ghi lịch sử. Báo cáo lưu snapshot thay vì tham chiếu dữ liệu có thể thay đổi.",
                ],
              ].map(([title, text]) => (
                <div className="security-item" key={title}>
                  <CheckCheck size={16} />
                  <div>
                    <strong>{title}</strong>
                    <p>{text}</p>
                  </div>
                </div>
              ))}
            </div>
          </Card>
          <Card>
            <h3>
              <Leaf size={18} /> Bắt đầu đúng cách
            </h3>
            <p>
              Đọc hướng dẫn triển khai, chọn OCR / model được phép xử lý nhãn và
              xác định người duyệt pháp lý trước khi mở beta.
            </p>
            <a
              href="/setup-guide.md"
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-secondary full-width"
            >
              <FileText size={14} /> Hướng dẫn triển khai
            </a>
            <Button
              variant="ghost"
              className="full-width"
              onClick={() => setGuide(true)}
            >
              Xem quy trình sử dụng <ArrowIcon />
            </Button>
          </Card>
          <InlineNotice tone="warning" icon={<CircleAlert size={16} />}>
            Chưa có dataset ground truth và kiểm định beta AI. Không dùng bản
            demo để cam kết tuân thủ, thông quan hoặc chất lượng AI.
          </InlineNotice>
        </aside>
      </div>
      <Modal
        open={resetOpen}
        onClose={() => setResetOpen(false)}
        title="Đặt lại không gian dữ liệu mẫu?"
        description="Thao tác này không thể hoàn tác. Supabase thật không bị ảnh hưởng."
        footer={
          <>
            <Button variant="secondary" onClick={() => setResetOpen(false)}>
              Hủy
            </Button>
            <Button
              variant="danger"
              disabled={!confirmed}
              loading={busy}
              onClick={() => void reset()}
            >
              Xóa dữ liệu cục bộ & đặt lại
            </Button>
          </>
        }
      >
        <InlineNotice tone="warning">
          Hồ sơ, quyết định, báo cáo mẫu và file nhãn đã tải lên trong demo sẽ
          bị xóa. Bản export metadata không bao gồm file nhãn.
        </InlineNotice>
        <div style={{ marginTop: 20 }}>
          <Checkbox checked={confirmed} onChange={setConfirmed}>
            Tôi đã tải các file cần giữ và đồng ý đặt lại dữ liệu thử nghiệm.
          </Checkbox>
        </div>
      </Modal>
      <GuideModal open={guide} onClose={() => setGuide(false)} />
    </div>
  );
}
function ArrowIcon() {
  return <ExternalLink size={13} />;
}
