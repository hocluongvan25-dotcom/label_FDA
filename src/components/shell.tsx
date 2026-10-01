"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import {
  Activity,
  ArrowRight,
  Bell,
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Database,
  FileCheck2,
  Files,
  FlaskConical,
  LayoutDashboard,
  LogOut,
  Menu,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Users,
  X,
} from "lucide-react";
import { useApp } from "./app-provider";
import { AuthScreen, OnboardingScreen } from "./auth-screen";
import {
  Avatar,
  Badge,
  Button,
  GuideModal,
  IconButton,
  InlineNotice,
  LoadingSplash,
  Logo,
  Modal,
  TeaThumbnail,
} from "./ui";
import { ROLE_LABELS } from "@/lib/constants";
import { can } from "@/lib/permissions";
import { needsAction, relativeTime } from "@/lib/utils";

const mainNav = [
  { href: "/", label: "Tổng quan", icon: LayoutDashboard },
  { href: "/products", label: "Hồ sơ sản phẩm", icon: Files },
  { href: "/reviews", label: "Không gian rà soát", icon: FileCheck2 },
  { href: "/reports", label: "Báo cáo", icon: BookOpen },
];
const adminNav = [
  {
    href: "/customers",
    label: "Khách hàng",
    icon: Users,
    capability: "organizations" as const,
  },
  { href: "/sources", label: "Nguồn pháp lý", icon: ShieldCheck },
  { href: "/knowledge", label: "Kho tri thức pháp quy", icon: Database },
  { href: "/rules", label: "Quy tắc kiểm tra", icon: SlidersHorizontal },
  {
    href: "/audit",
    label: "Nhật ký hoạt động",
    icon: Activity,
    capability: "audit" as const,
  },
];
export function AppShell({ children }: { children: React.ReactNode }) {
  const app = useApp();
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const [readIds, setReadIds] = useState<string[]>([]);
  const dropdownRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen((v) => !v);
      }
      if (e.key === "Escape") {
        setMobileOpen(false);
        setNotificationsOpen(false);
        setUserOpen(false);
      }
    };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, []);
  useEffect(() => {
    setMobileOpen(false);
    setNotificationsOpen(false);
    setUserOpen(false);
  }, [pathname]);
  useEffect(() => {
    try {
      setReadIds(
        JSON.parse(
          localStorage.getItem(`vexim-notifications-${app.actor.id}`) ?? "[]",
        ),
      );
    } catch {
      setReadIds([]);
    }
  }, [app.actor.id]);
  useEffect(() => {
    if (!notificationsOpen && !userOpen) return;
    const close = (e: MouseEvent) => {
      if (!dropdownRef.current?.contains(e.target as Node)) {
        setNotificationsOpen(false);
        setUserOpen(false);
      }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [notificationsOpen, userOpen]);
  if (app.loading) return <LoadingSplash />;
  if (!app.authenticated) return <AuthScreen />;
  if (app.error)
    return (
      <div className="connection-error">
        <Logo />
        <InlineNotice tone="error">{app.error}</InlineNotice>
        <p>
          Kiểm tra migration và cấu hình Supabase. Không có dữ liệu khách hàng
          được thay thế bằng dữ liệu mẫu tự động.
        </p>
        <Button
          onClick={() =>
            void app.refresh().catch((e) => app.notify(e.message, "error"))
          }
        >
          Thử kết nối lại
        </Button>
        {process.env.NEXT_PUBLIC_ENABLE_DEMO !== "false" && (
          <Button variant="secondary" onClick={app.enterDemo}>
            Mở demo riêng biệt
          </Button>
        )}
        <Button variant="ghost" onClick={() => void app.signOut()}>
          Đăng xuất
        </Button>
      </div>
    );
  if (
    app.mode === "supabase" &&
    app.actor.role.startsWith("customer") &&
    !app.actor.organization_id
  )
    return <OnboardingScreen />;
  const staff = !app.actor.role.startsWith("customer");
  const navMain =
    app.actor.role === "regulatory_admin" ? [mainNav[0], mainNav[3]] : mainNav;
  const navAdmin = adminNav.filter((item) =>
    item.capability ? can(app.actor, item.capability) : staff,
  );
  const route = [
    ...mainNav,
    ...adminNav,
    { href: "/settings", label: "Cài đặt" },
  ]
    .filter((n) =>
      n.href === "/" ? pathname === "/" : pathname.startsWith(n.href),
    )
    .at(-1);
  const tasks = app.data.reviews.filter((r) => needsAction(r.status));
  const notifications = [
    ...app.data.requests
      .filter((r) => r.status === "open")
      .map((r) => ({
        id: r.id,
        title: "Yêu cầu bổ sung hồ sơ",
        description: r.message,
        date: r.created_at,
        href: `/reviews/${r.review_id}`,
        kind: "request",
      })),
    ...tasks.slice(0, 5).map((r) => ({
      id: r.id,
      title:
        app.data.products.find((p) => p.id === r.product_id)?.name ??
        "Hồ sơ cần rà soát",
      description: "Có kết quả cần chuyên viên xác nhận.",
      date: r.updated_at,
      href: `/reviews/${r.id}`,
      kind: "review",
    })),
  ].sort((a, b) => b.date.localeCompare(a.date));
  const unread = notifications.filter((n) => !readIds.includes(n.id));
  const markRead = (ids: string[]) => {
    const next = [...new Set([...readIds, ...ids])];
    setReadIds(next);
    localStorage.setItem(
      `vexim-notifications-${app.actor.id}`,
      JSON.stringify(next),
    );
  };
  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);
  return (
    <div className="app-shell">
      {mobileOpen && (
        <div
          className="sidebar-backdrop"
          onClick={() => setMobileOpen(false)}
        />
      )}
      <aside className={clsx("sidebar", mobileOpen && "sidebar-open")}>
        <Link
          href="/"
          className="sidebar-brand"
          aria-label="Vexim Label Review — Tổng quan"
        >
          <Logo light />
        </Link>
        <div className="workspace-switch">
          <span className="workspace-icon">V</span>
          <div>
            <strong>
              {staff
                ? "Vexim Workspace"
                : (app.data.organizations.find(
                    (o) => o.id === app.actor.organization_id,
                  )?.name ?? "Doanh nghiệp")}
            </strong>
            <small>
              {staff ? "Không gian chuyên viên" : "Không gian khách hàng"}
            </small>
          </div>
          <span
            className="live-dot"
            title={
              app.mode === "demo" ? "Chế độ dữ liệu mẫu" : "Supabase đã kết nối"
            }
          />
        </div>
        <nav>
          <div className="nav-label">KHÔNG GIAN LÀM VIỆC</div>
          {navMain.map((n) => (
            <Link
              href={n.href}
              key={n.href}
              className={clsx("nav-item", isActive(n.href) && "active")}
              aria-current={isActive(n.href) ? "page" : undefined}
            >
              <n.icon size={19} strokeWidth={1.7} />
              <span>{n.label}</span>
              {n.href === "/reviews" && tasks.length > 0 && (
                <span className="nav-count">{tasks.length}</span>
              )}
            </Link>
          ))}
          {navAdmin.length > 0 && (
            <div className="nav-label nav-label-second">QUẢN LÝ & TUÂN THỦ</div>
          )}
          {navAdmin.map((n) => (
            <Link
              href={n.href}
              key={n.href}
              className={clsx("nav-item", isActive(n.href) && "active")}
              aria-current={isActive(n.href) ? "page" : undefined}
            >
              <n.icon size={19} strokeWidth={1.7} />
              <span>{n.label}</span>
            </Link>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-help">
            <span className="help-icon">
              <FlaskConical size={18} />
            </span>
            <strong>Cần một khởi đầu rõ ràng?</strong>
            <p>Tìm hiểu quy trình rà soát nhãn trong 3 bước.</p>
            <button onClick={() => setGuideOpen(true)}>
              Xem hướng dẫn <ArrowRight size={15} />
            </button>
          </div>
          <Link
            href="/settings"
            className={clsx("nav-item", isActive("/settings") && "active")}
          >
            <Settings2 size={19} strokeWidth={1.7} />
            <span>Cài đặt</span>
          </Link>
          <div className="sidebar-profile">
            <Avatar name={app.actor.name} tone="gold" />
            <div>
              <strong>{app.actor.name}</strong>
              <small>{ROLE_LABELS[app.actor.role]}</small>
            </div>
            <IconButton
              label="Mở cài đặt tài khoản"
              onClick={() => router.push("/settings")}
            >
              <ChevronRight size={16} />
            </IconButton>
          </div>
        </div>
        <div className="sidebar-version">
          VEXIM LABEL REVIEW <span>v0.1</span>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="topbar-breadcrumb">
            <IconButton
              label="Mở menu"
              className="mobile-menu-btn"
              onClick={() => setMobileOpen(true)}
            >
              <Menu size={21} />
            </IconButton>
            <span className="workspace-breadcrumb">Workspace</span>
            <ChevronRight size={14} />
            <strong>{route?.label ?? "Hồ sơ sản phẩm"}</strong>
            {pathname.includes("/new") && (
              <>
                <ChevronRight size={14} />
                <span>Tạo mới</span>
              </>
            )}
          </div>
          <div className="topbar-actions" ref={dropdownRef}>
            <button
              className="global-search"
              onClick={() => setSearchOpen(true)}
            >
              <Search size={16} />
              <span>Tìm trong workspace…</span>
              <kbd>⌘ K</kbd>
            </button>
            <span className="topbar-divider" />
            <div className="dropdown-anchor">
              <IconButton
                label="Thông báo"
                className={notificationsOpen ? "active" : ""}
                onClick={() => {
                  setNotificationsOpen((v) => !v);
                  setUserOpen(false);
                }}
              >
                <Bell size={19} />
                {unread.length > 0 && <span className="notification-dot" />}
              </IconButton>
              {notificationsOpen && (
                <div className="notification-dropdown">
                  <div className="dropdown-title">
                    <strong>
                      Thông báo <Badge tone="green">{unread.length}</Badge>
                    </strong>
                    <button
                      className="text-button"
                      onClick={() => markRead(notifications.map((n) => n.id))}
                    >
                      Đánh dấu đã đọc
                    </button>
                  </div>
                  {notifications.length ? (
                    notifications.map((n) => (
                      <Link
                        key={n.id}
                        href={n.href}
                        className={clsx(
                          "notification-item",
                          !readIds.includes(n.id) && "unread",
                        )}
                        onClick={() => markRead([n.id])}
                      >
                        <span className="notification-item-icon">
                          {n.kind === "review" ? (
                            <FileCheck2 size={17} />
                          ) : (
                            <CircleHelp size={17} />
                          )}
                        </span>
                        <div>
                          <strong>{n.title}</strong>
                          <p>{n.description}</p>
                          <small>{relativeTime(n.date)}</small>
                        </div>
                      </Link>
                    ))
                  ) : (
                    <div className="dropdown-empty">
                      Bạn đã xử lý hết các yêu cầu hiện tại.
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="dropdown-anchor">
              <button
                className="topbar-profile"
                aria-label="Menu tài khoản"
                onClick={() => {
                  setUserOpen((v) => !v);
                  setNotificationsOpen(false);
                }}
              >
                <Avatar name={app.actor.name} size="sm" />
                <ChevronDown size={13} />
              </button>
              {userOpen && (
                <div className="user-dropdown">
                  <strong>{app.actor.name}</strong>
                  <span>{app.actor.email}</span>
                  <Link href="/settings">
                    <Settings2 size={16} /> Cài đặt tài khoản
                  </Link>
                  <button onClick={() => void app.signOut()}>
                    <LogOut size={16} /> Đăng xuất
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>
        {app.mode === "demo" && (
          <div className="demo-bar">
            <div>
              <span className="demo-dot" />
              <strong>Không gian dữ liệu mẫu</strong>
              <span className="demo-bar-detail">
                Khám phá quy trình · không dùng kết quả cho nhãn thực.
              </span>
            </div>
            <Link href="/settings">
              Kết nối Supabase <ArrowRight size={13} />
            </Link>
          </div>
        )}
        <main
          className={clsx(
            "main-content",
            pathname.startsWith("/reviews/") && "main-content-review",
          )}
        >
          {children}
        </main>
        <footer className="app-footer">
          <span>
            Vexim Label Review <span className="footer-dot">·</span> Hỗ trợ
            chuyên gia. Không phải phê duyệt của FDA.
          </span>
          <button onClick={() => setGuideOpen(true)}>
            <CircleHelp size={13} /> Hướng dẫn sử dụng
          </button>
        </footer>
      </div>
      <div className="toast-stack" role="status" aria-live="polite">
        {app.toasts.map((t) => (
          <div className={clsx("toast", `toast-${t.tone}`)} key={t.id}>
            {t.tone === "success" ? (
              <Check size={18} />
            ) : (
              <CircleHelp size={18} />
            )}
            <span>{t.message}</span>
            <IconButton
              label="Đóng thông báo"
              onClick={() => app.dismissToast(t.id)}
            >
              <X size={15} />
            </IconButton>
          </div>
        ))}
      </div>
      <GuideModal open={guideOpen} onClose={() => setGuideOpen(false)} />
      <SearchPalette open={searchOpen} onClose={() => setSearchOpen(false)} />
    </div>
  );
}
function SearchPalette({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { data } = useApp();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  useEffect(() => {
    if (open) {
      setQuery("");
      setSelected(0);
    }
  }, [open]);
  const all = [
    ...data.products.map((p) => ({
      id: p.id,
      name: p.name,
      description: `${p.brand} · ${data.organizations.find((o) => o.id === p.organization_id)?.name}`,
      href: `/products/${p.id}`,
      color: p.color,
    })),
    ...data.sources.map((s) => ({
      id: s.id,
      name: s.citation,
      description: s.title,
      href: `/sources?source=${s.id}`,
      color: "",
    })),
    ...mainNav.map((n) => ({
      id: n.href,
      name: n.label,
      description: "Đi đến trang",
      href: n.href,
      color: "",
    })),
  ];
  const results = all
    .filter((x) =>
      `${x.name} ${x.description}`.toLowerCase().includes(query.toLowerCase()),
    )
    .slice(0, 9);
  const choose = (href: string) => {
    router.push(href);
    onClose();
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Tìm kiếm trong workspace"
      description="Hồ sơ sản phẩm, nguồn tham chiếu và trang làm việc."
    >
      <div className="palette-search">
        <Search size={20} />
        <input
          aria-label="Tìm kiếm toàn cục"
          value={query}
          placeholder="Tên sản phẩm, thương hiệu, citation…"
          onChange={(e) => {
            setQuery(e.target.value);
            setSelected(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setSelected((i) => Math.min(i + 1, results.length - 1));
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              setSelected((i) => Math.max(0, i - 1));
            }
            if (e.key === "Enter" && results[selected])
              choose(results[selected].href);
          }}
        />
      </div>
      <div className="palette-results">
        {results.map((r, i) => (
          <button
            className={clsx("palette-result", i === selected && "selected")}
            onClick={() => choose(r.href)}
            key={r.id}
          >
            {r.color ? (
              <TeaThumbnail color={r.color} size="sm" />
            ) : (
              <Search size={19} />
            )}
            <div>
              <strong>{r.name}</strong>
              <span>{r.description}</span>
            </div>
            <ArrowRight size={15} />
          </button>
        ))}
        {!results.length && (
          <p className="dropdown-empty">Không tìm thấy kết quả phù hợp.</p>
        )}
      </div>
      <div className="palette-hint">
        <kbd>↑ ↓</kbd> chọn <kbd>↵</kbd> mở <kbd>esc</kbd> đóng
      </div>
    </Modal>
  );
}
