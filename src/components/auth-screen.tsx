"use client";

import { useState } from "react";
import {
  ArrowRight,
  CheckCheck,
  Leaf,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { useApp } from "./app-provider";
import { Button, Input, InlineNotice, Logo } from "./ui";
import { api, getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import { errorMessage } from "@/lib/utils";

export function AuthScreen() {
  const app = useApp();
  const [tab, setTab] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      if (!isSupabaseConfigured())
        throw new Error(
          "Chưa kết nối Supabase. Bạn có thể mở không gian mẫu bên dưới.",
        );
      const client = getSupabase();
      if (tab === "login") {
        const { error } = await client.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
        await app.refresh();
      } else {
        if (password.length < 8)
          throw new Error("Mật khẩu cần ít nhất 8 ký tự.");
        const { data, error } = await client.auth.signUp({
          email,
          password,
          options: {
            data: { full_name: name },
            emailRedirectTo: window.location.origin,
          },
        });
        if (error) throw error;
        if (data.session) await app.refresh();
        else
          setMessage(
            "Đã gửi email xác nhận. Hãy kiểm tra hộp thư trước khi đăng nhập.",
          );
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="auth-layout">
      <div className="auth-story">
        <Logo light />
        <div className="auth-copy">
          <span className="auth-eyebrow">
            <Leaf size={16} /> TỪ NHÃN HÀNG ĐẾN THỊ TRƯỜNG HOA KỲ
          </span>
          <h1>
            Xuất khẩu tự tin hơn.
            <br />
            <em>
              Bắt đầu từ một
              <br />
              nhãn hàng rõ ràng.
            </em>
          </h1>
          <p>
            Phát hiện sớm thiếu sót và rủi ro trên nhãn thực phẩm, với evidence
            rõ ràng và chuyên gia đồng hành.
          </p>
          <div className="auth-benefits">
            <span>
              <FileIcon /> Hồ sơ và phiên bản tập trung
            </span>
            <span>
              <ShieldCheck size={19} /> Dữ liệu riêng cho từng tổ chức
            </span>
            <span>
              <CheckCheck size={19} /> Chuyên viên xác nhận báo cáo
            </span>
          </div>
        </div>
        <div className="auth-story-footer">
          Vexim Label Review <span>Trà khô & trà túi lọc · MVP</span>
        </div>
      </div>
      <main className="auth-form-panel">
        <div className="auth-form">
          <BadgeIcon />
          <h2>Chào mừng đến Vexim</h2>
          <p>Không gian rà soát nhãn thực phẩm của bạn.</p>
          <>
            {app.error && (
              <div style={{ marginBottom: 18 }}>
                <InlineNotice tone="error">
                  {app.error}{" "}
                  <a
                    href="/setup-guide.md"
                    className="text-button"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Hướng dẫn kết nối
                  </a>
                </InlineNotice>
              </div>
            )}
          </>
          <div className="segmented">
            <button
              onClick={() => setTab("login")}
              className={tab === "login" ? "active" : ""}
            >
              Đăng nhập
            </button>
            <button
              onClick={() => setTab("signup")}
              className={tab === "signup" ? "active" : ""}
            >
              Tạo tài khoản
            </button>
          </div>
          <form onSubmit={submit}>
            {tab === "signup" && (
              <Input
                label="Họ và tên"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                autoComplete="name"
              />
            )}
            <Input
              label="Email công việc"
              type="email"
              placeholder="ban@doanhnghiep.vn"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
            <Input
              label="Mật khẩu"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={tab === "signup" ? 8 : undefined}
              autoComplete={
                tab === "signup" ? "new-password" : "current-password"
              }
            />
            {error && <InlineNotice tone="error">{error}</InlineNotice>}
            {message && <InlineNotice tone="success">{message}</InlineNotice>}
            <Button type="submit" loading={busy} className="full-width">
              {tab === "login" ? "Đăng nhập" : "Tạo tài khoản"}{" "}
              <ArrowRight size={17} />
            </Button>
          </form>
          {process.env.NEXT_PUBLIC_ENABLE_DEMO !== "false" && (
            <>
              <div className="auth-divider">
                <span>hoặc khám phá trước</span>
              </div>
              <Button
                variant="secondary"
                onClick={app.enterDemo}
                className="full-width"
              >
                <Sparkles size={16} /> Mở không gian dữ liệu mẫu
              </Button>
              <p className="auth-demo-note">
                Không cần tài khoản · Không gửi email hay dữ liệu tới AI bên
                ngoài.
              </p>
            </>
          )}
          <p className="auth-disclaimer">
            Hệ thống hỗ trợ rà soát sơ bộ, không phải phê duyệt hoặc chứng nhận
            của FDA.
          </p>
        </div>
      </main>
    </div>
  );
}
function FileIcon() {
  return (
    <svg
      width="19"
      height="19"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6M8 13h8m-8 4h5" />
    </svg>
  );
}
function BadgeIcon() {
  return (
    <span className="auth-badge">
      <Leaf size={26} />
    </span>
  );
}
export function OnboardingScreen() {
  const app = useApp();
  const [name, setName] = useState("");
  const [contact, setContact] = useState(app.actor.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api("/organizations", {
        method: "POST",
        body: JSON.stringify({
          name,
          contact_name: contact,
          contact_email: app.actor.email,
          country: "VN",
        }),
      });
      await app.refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="onboarding">
      <Logo />
      <div className="card">
        <span className="auth-badge">
          <Leaf size={24} />
        </span>
        <h1>Tạo không gian doanh nghiệp</h1>
        <p>
          Xin chào {app.actor.name}. Hồ sơ và nhãn của bạn sẽ được tách riêng
          theo tổ chức.
        </p>
        <form onSubmit={submit}>
          <Input
            label="Tên doanh nghiệp"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
          <Input
            label="Người liên hệ"
            value={contact}
            onChange={(e) => setContact(e.target.value)}
            required
          />
          {error && <InlineNotice tone="error">{error}</InlineNotice>}
          <Button type="submit" loading={busy}>
            Tạo tổ chức <ArrowRight size={16} />
          </Button>
        </form>
        <button className="text-button" onClick={() => void app.signOut()}>
          Đăng xuất
        </button>
      </div>
    </div>
  );
}
