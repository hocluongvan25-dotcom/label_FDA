"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";
import {
  ArrowUpRight,
  Check,
  ChevronDown,
  CircleHelp,
  FileSearch,
  Leaf,
  Loader2,
  X,
} from "lucide-react";
import type { ReviewStatus, Severity } from "@/lib/types";
import { SEVERITY_META, STATUS_META } from "@/lib/constants";
import { initials } from "@/lib/utils";

export function Button({
  children,
  className,
  variant = "primary",
  size,
  loading,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger" | "soft";
  size?: "sm" | "icon";
  loading?: boolean;
}) {
  return (
    <button
      type="button"
      {...props}
      disabled={props.disabled || loading}
      className={clsx(
        "btn",
        `btn-${variant}`,
        size && `btn-${size}`,
        className,
      )}
    >
      {loading && <Loader2 size={16} className="spin" />}
      {children}
    </button>
  );
}
export function IconButton({
  children,
  label,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      {...props}
      aria-label={label}
      title={label}
      className={clsx("icon-btn", className)}
    >
      {children}
    </button>
  );
}
export function Badge({
  children,
  tone = "neutral",
  dot = false,
  className,
}: {
  children: ReactNode;
  tone?: string;
  dot?: boolean;
  className?: string;
}) {
  return (
    <span className={clsx("badge", `badge-${tone}`, className)}>
      {dot && <span className="badge-dot" />}
      {children}
    </span>
  );
}
export function StatusBadge({ status }: { status: ReviewStatus }) {
  const meta = STATUS_META[status] ?? STATUS_META.DRAFT;
  return (
    <Badge tone={meta.tone} dot>
      {meta.short}
    </Badge>
  );
}
export function SeverityBadge({
  severity,
  count,
}: {
  severity: Severity;
  count?: number;
}) {
  const meta = SEVERITY_META[severity];
  return (
    <Badge tone={meta.color} dot>
      {meta.label}
      {count !== undefined && <strong>{count}</strong>}
    </Badge>
  );
}
export function Avatar({
  name,
  size = "md",
  tone = "sage",
}: {
  name: string;
  size?: "sm" | "md" | "lg";
  tone?: string;
}) {
  return (
    <span
      className={clsx("avatar", `avatar-${size}`, `avatar-${tone}`)}
      title={name}
    >
      {initials(name)}
    </span>
  );
}
export function Logo({
  light = false,
  compact = false,
}: {
  light?: boolean;
  compact?: boolean;
}) {
  return (
    <div className={clsx("logo", light && "logo-light")}>
      <span className="logo-symbol">
        <svg viewBox="0 0 36 38" fill="none" aria-hidden="true">
          <path
            d="M18 30C4 30 1 14 4 7c15 0 20 12 14 23Z"
            fill="currentColor"
            opacity=".8"
          />
          <path
            d="M18 30C14 12 23 1 33 2c2 16-5 27-15 28Z"
            fill="currentColor"
          />
          <path
            d="m18 34-7-17m7 12 9-15"
            stroke={light ? "#133b33" : "white"}
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      </span>
      {!compact && (
        <div>
          <strong>VEXIM</strong>
          <span>LABEL REVIEW</span>
        </div>
      )}
    </div>
  );
}
export function TeaThumbnail({
  color = "sage",
  form = "tea_bag",
  size = "md",
}: {
  color?: string;
  form?: string;
  size?: "sm" | "md" | "lg";
}) {
  return (
    <div
      className={clsx("tea-thumbnail", `tea-${color}`, `tea-${size}`)}
      aria-hidden="true"
    >
      <svg viewBox="0 0 40 48" fill="none">
        <path
          d={form === "tea_bag" ? "M10 8h20l3 8v27H7V16l3-8Z" : "M8 7h24v36H8z"}
          fill="currentColor"
          opacity=".14"
        />
        <path
          d={form === "tea_bag" ? "M10 8h20l3 8v27H7V16l3-8Z" : "M8 7h24v36H8z"}
          stroke="currentColor"
          strokeWidth="1.2"
        />
        <path d="M7 17h26M13 11h14" stroke="currentColor" opacity=".45" />
        <path
          d="M20 34c-8-2-8-9-7-13 8 1 11 7 7 13Zm0 0c-1-8 2-14 7-14 2 7-1 13-7 14Z"
          fill="currentColor"
          opacity=".65"
        />
        <path d="M15 39h10" stroke="currentColor" strokeWidth=".8" />
      </svg>
    </div>
  );
}
export function Field({
  label,
  required,
  hint,
  error,
  tooltip,
  children,
  className,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  error?: string;
  tooltip?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={clsx("field", error && "field-error", className)}>
      <div className="field-label">
        {label}
        {required && <span className="required">*</span>}
        {tooltip && (
          <span title={tooltip} tabIndex={0} className="field-tip">
            <CircleHelp size={14} />
            <span className="tooltip-content" role="tooltip">
              {tooltip}
            </span>
          </span>
        )}
      </div>
      {children}
      {error ? (
        <span className="field-error-text" role="alert">
          {error}
        </span>
      ) : hint ? (
        <span className="field-hint">{hint}</span>
      ) : null}
    </div>
  );
}
export function Input({
  label,
  hint,
  error,
  tooltip,
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  label?: string;
  hint?: string;
  error?: string;
  tooltip?: string;
}) {
  const id = useId();
  const input = (
    <input
      {...props}
      id={props.id ?? id}
      aria-label={props["aria-label"] ?? label}
      aria-invalid={!!error}
      aria-describedby={error ? `${id}-error` : undefined}
      className={clsx("input", className)}
    />
  );
  return label ? (
    <Field
      label={label}
      required={props.required}
      hint={hint}
      error={error}
      tooltip={tooltip}
    >
      {input}
      {error && (
        <span id={`${id}-error`} className="sr-only">
          {error}
        </span>
      )}
    </Field>
  ) : (
    input
  );
}
export function Textarea({
  label,
  hint,
  error,
  className,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label?: string;
  hint?: string;
  error?: string;
}) {
  const id = useId();
  const input = (
    <textarea
      {...props}
      id={props.id ?? id}
      aria-label={props["aria-label"] ?? label}
      aria-invalid={!!error}
      className={clsx("input textarea", className)}
    />
  );
  return label ? (
    <Field label={label} hint={hint} required={props.required} error={error}>
      {input}
    </Field>
  ) : (
    input
  );
}
export function Select({
  label,
  hint,
  error,
  children,
  className,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & {
  label?: string;
  hint?: string;
  error?: string;
}) {
  const id = useId();
  const control = (
    <div className="select-wrap">
      <select
        {...props}
        id={props.id ?? id}
        aria-label={props["aria-label"] ?? label}
        aria-invalid={!!error}
        className={clsx("input", className)}
      >
        {children}
      </select>
      <ChevronDown size={15} />
    </div>
  );
  return label ? (
    <Field label={label} required={props.required} hint={hint} error={error}>
      {control}
    </Field>
  ) : (
    control
  );
}
export function Checkbox({
  children,
  checked,
  onChange,
  disabled = false,
}: {
  children: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className={clsx("checkbox-label", disabled && "disabled")}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
      />
      <span className="checkbox-ui">
        {checked && <Check size={12} strokeWidth={3} />}
      </span>
      <span>{children}</span>
    </label>
  );
}
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="page-header">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}
export function Card({
  children,
  className,
  ...props
}: {
  children: ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <section {...props} className={clsx("card", className)}>
      {children}
    </section>
  );
}
export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon">
        {icon ?? <FileSearch size={30} strokeWidth={1.4} />}
      </span>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}
export function ProgressBar({
  value,
  tone = "teal",
}: {
  value: number;
  tone?: string;
}) {
  return (
    <div
      className={clsx("progress-track", `progress-${tone}`)}
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  wide = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const [mounted, setMounted] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const timer = setTimeout(() => {
      const el = ref.current?.querySelector<HTMLElement>(
        "input, textarea, select, button",
      );
      el?.focus();
    }, 20);
    const keydown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeRef.current();
      }
      if (e.key === "Tab" && ref.current) {
        const focusable = Array.from(
          ref.current.querySelectorAll<HTMLElement>(
            'button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex="0"]',
          ),
        ).filter((e) => e.offsetParent !== null);
        const first = focusable[0],
          last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", keydown);
    return () => {
      clearTimeout(timer);
      document.body.style.overflow = prevOverflow;
      document.removeEventListener("keydown", keydown);
      prev?.focus();
    };
  }, [open]);
  if (!open || !mounted) return null;
  return createPortal(
    <div
      className="modal-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        className={clsx("modal", wide && "modal-wide")}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="modal-header">
          <div>
            <h2 id={titleId}>{title}</h2>
            {description && <p>{description}</p>}
          </div>
          <IconButton label="Đóng" onClick={onClose}>
            <X size={20} />
          </IconButton>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
export function ExternalLink({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="external-link"
    >
      {children}
      <ArrowUpRight size={14} />
    </a>
  );
}
export function InlineNotice({
  children,
  tone = "info",
  icon,
}: {
  children: ReactNode;
  tone?: "info" | "warning" | "error" | "success";
  icon?: ReactNode;
}) {
  return (
    <div className={clsx("inline-notice", `notice-${tone}`)}>
      {icon ?? <CircleHelp size={17} />}
      <div>{children}</div>
    </div>
  );
}
export function LoadingSplash() {
  return (
    <div className="loading-splash">
      <Logo />
      <Loader2 size={26} className="spin" />
      <p>Đang mở không gian làm việc…</p>
    </div>
  );
}
export function GuideModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Một quy trình rõ ràng, từ nhãn đến báo cáo"
      description="Vexim Label Review hỗ trợ chuyên gia, không thay thế quyết định pháp lý."
      footer={
        <Button onClick={onClose}>
          Tôi đã hiểu <Check size={16} />
        </Button>
      }
    >
      <div className="guide-steps">
        {[
          [
            "01",
            "Tạo hồ sơ sản phẩm",
            "Nhập công thức, khối lượng, thị trường và các tuyên bố trên nhãn. Tải PDF, PNG, JPEG hoặc TIFF; tối đa 50 MB/tệp, 20 tệp và 10 trang/PDF.",
          ],
          [
            "02",
            "Rà soát bằng chứng",
            "Nhận dạng chữ (OCR) đọc nhãn, hệ thống trích xuất thông tin và bộ quy tắc đối chiếu. Dữ liệu thiếu không được suy đoán là đạt; tuyên bố liên quan bệnh lý luôn cần chuyên gia.",
          ],
          [
            "03",
            "Chuyên viên xác nhận",
            "Đối chiếu nhãn, nguồn pháp lý và từng phát hiện. Mọi chỉnh sửa / loại trừ cần lý do. Chỉ chuyên viên Vexim được ký duyệt nội bộ nội dung báo cáo; đây không phải phê duyệt của FDA.",
          ],
        ].map(([n, title, text]) => (
          <div key={n}>
            <span>{n}</span>
            <div>
              <h3>{title}</h3>
              <p>{text}</p>
            </div>
          </div>
        ))}
      </div>
      <InlineNotice tone="warning" icon={<Leaf size={18} />}>
        Kết quả chỉ có giá trị trong phạm vi rà soát và dữ liệu đã cung cấp.
        Vexim không cấp chứng nhận hoặc phê duyệt của FDA.
      </InlineNotice>
    </Modal>
  );
}
