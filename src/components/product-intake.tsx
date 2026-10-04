"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCheck,
  CircleAlert,
  FileText,
  FlaskConical,
  Globe2,
  Info,
  Leaf,
  Plus,
  Save,
  ShieldCheck,
  Tags,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react";
import { useApp } from "./app-provider";
import {
  Badge,
  Button,
  Card,
  Checkbox,
  Field,
  IconButton,
  InlineNotice,
  Input,
  Modal,
  PageHeader,
  ProgressBar,
  Select,
} from "./ui";
import { FileDropzone } from "./file-dropzone";
import { createEmptyProduct } from "@/lib/seed";
import { CATEGORY_LABELS, CHANNEL_LABELS, FORM_LABELS } from "@/lib/constants";
import type { Ingredient, Product } from "@/lib/types";
import {
  classifyClaim,
  detectAllergens,
  normalizeIngredient,
} from "@/lib/extraction";
import { errorMessage, now, uid } from "@/lib/utils";
import { validateIntake } from "@/lib/validation";
import { can } from "@/lib/permissions";

const steps = [
  { title: "Thông tin sản phẩm", subtitle: "Tên, thương hiệu & phân loại" },
  {
    title: "Công thức & bao bì",
    subtitle: "Nguyên liệu, quy cách, khối lượng",
  },
  {
    title: "Tuyên bố trên nhãn & các bên",
    subtitle: "Nội dung nhãn và đơn vị chịu trách nhiệm",
  },
  { title: "Nhãn & thị trường", subtitle: "File nhãn, kênh bán & xác nhận" },
];
const allergenNames: Record<string, string> = {
  milk: "Sữa",
  egg: "Trứng",
  fish: "Cá",
  shellfish: "Giáp xác",
  tree_nuts: "Hạt cây",
  peanut: "Đậu phộng",
  wheat: "Lúa mì",
  soy: "Đậu nành",
  sesame: "Mè / vừng",
};
export function ProductIntake({ productId }: { productId?: string }) {
  const app = useApp();
  const notify = app.notify;
  const router = useRouter();
  const existing = productId
    ? app.data.products.find((p) => p.id === productId)
    : null;
  const [product, setProduct] = useState<Product>(() =>
    structuredClone(
      existing ??
        createEmptyProduct(
          app.actor.organization_id ?? app.data.organizations[0]?.id ?? "",
        ),
    ),
  );
  const [step, setStep] = useState(0);
  const [files, setFiles] = useState<File[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [claimInput, setClaimInput] = useState("");
  const [certInput, setCertInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [allergenRow, setAllergenRow] = useState<string | null>(null);
  const draftKey = `vexim-intake:${app.mode}:${app.actor.id}:${productId ?? "new"}`;
  const initialized = useRef(false);
  useEffect(() => {
    try {
      const value = localStorage.getItem(draftKey);
      if (value) {
        const draft = JSON.parse(value);
        if (
          draft?.organization_id &&
          draft?.id &&
          (existing
            ? new Date(draft.updated_at) > new Date(existing.updated_at)
            : true)
        )
          setProduct(draft);
      }
    } catch {
      /* Invalid autosave is ignored. */
    }
    initialized.current = true;
  }, [draftKey, existing]);
  useEffect(() => {
    if (!initialized.current) return;
    setSaved(false);
    const timeout = setTimeout(() => {
      try {
        localStorage.setItem(
          draftKey,
          JSON.stringify({ ...product, updated_at: now() }),
        );
        setSaved(true);
      } catch {
        notify(
          "Không lưu được bản nháp trên thiết bị. Hãy dùng nút Lưu nháp.",
          "error",
        );
      }
    }, 700);
    return () => clearTimeout(timeout);
  }, [product, draftKey, notify]);
  if (!can(app.actor, "products"))
    return (
      <Card>
        <div className="empty-state">
          <ShieldCheck size={32} />
          <h3>Bạn không có quyền tạo hồ sơ sản phẩm</h3>
          <p>
            Vai trò hiện tại chỉ quản lý nguồn / quy tắc. Trong demo, bạn có thể
            đổi persona tại Cài đặt.
          </p>
          <Link href="/settings" className="btn btn-secondary">
            Mở cài đặt
          </Link>
        </div>
      </Card>
    );
  if (productId && !existing)
    return (
      <Card>
        <div className="empty-state">
          <h3>Không tìm thấy hồ sơ</h3>
          <p>Hồ sơ không tồn tại hoặc không thuộc tổ chức của bạn.</p>
          <Link href="/products" className="btn btn-secondary">
            Về danh sách
          </Link>
        </div>
      </Card>
    );
  const update = <K extends keyof Product>(key: K, value: Product[K]) => {
    setProduct((p) => ({
      ...p,
      [key]: value,
      ...(key === "form"
        ? {
            classification_status:
              ["dry_packaged_tea", "tea_bag"].includes(p.category) &&
              value !== "liquid"
                ? "conventional_food"
                : "out_of_scope",
          }
        : {}),
    }));
    setErrors((e) => {
      const next = { ...e };
      delete next[key];
      return next;
    });
  };
  const patchIngredient = (id: string, patch: Partial<Ingredient>) =>
    update(
      "formula",
      product.formula.map((i) => (i.id === id ? { ...i, ...patch } : i)),
    );
  const addIngredient = () =>
    update("formula", [
      ...product.formula,
      {
        id: uid(),
        name_original: "",
        name_english: "",
        normalized_name: "",
        percentage: null,
        order: product.formula.length + 1,
        allergen_groups: [],
        source: "customer_input",
      },
    ]);
  const addClaim = () => {
    const value = claimInput.trim();
    if (!value) return;
    if (!product.claims.includes(value))
      update("claims", [...product.claims, value]);
    setClaimInput("");
  };
  const next = () => {
    const all = validateIntake(product);
    const paths =
      step === 0
        ? ["name", "brand", "organization_id", "category", "form"]
        : step === 1
          ? ["formula", "package_size", "net_quantity"]
          : ["manufacturer"];
    const relevant = Object.fromEntries(
      Object.entries(all).filter(([key]) =>
        paths.some((path) => key === path || key.startsWith(`${path}.`)),
      ),
    );
    if (Object.keys(relevant).length) {
      setErrors(relevant);
      app.notify("Còn thông tin cần bổ sung ở bước này.", "error");
      return;
    }
    setErrors({});
    setStep(Math.min(3, step + 1));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const saveDraft = async () => {
    setBusy(true);
    try {
      const p = await app.saveProduct(product);
      localStorage.removeItem(draftKey);
      app.notify("Đã lưu bản nháp hồ sơ.");
      router.push(`/products/${p.id}`);
    } catch (e) {
      app.notify(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  };
  const submit = async () => {
    const all = validateIntake(product);
    const latestLabel = app.data.labelVersions
      .filter((v) => v.product_id === product.id)
      .sort((a, b) => b.version - a.version)[0];
    if (!files.length && (!latestLabel || existing))
      all.files = existing
        ? "Hãy tải phiên bản nhãn mới để lưu thay đổi hồ sơ và giữ nguyên lịch sử rà soát."
        : "Tải ít nhất một file nhãn.";
    if (Object.keys(all).length) {
      setErrors(all);
      app.notify(
        "Hồ sơ chưa đủ dữ liệu. Vui lòng kiểm tra các mục còn thiếu.",
        "error",
      );
      return;
    }
    setBusy(true);
    try {
      const p = await app.saveProduct({
        ...product,
        formula: product.formula.map((i, n) => ({
          ...i,
          normalized_name: normalizeIngredient(i.name_english),
          order: n + 1,
        })),
      });
      const label = files.length
        ? await app.uploadVersion(p.id, files)
        : latestLabel!;
      const review = await app.submitReview(label.id);
      localStorage.removeItem(draftKey);
      app.notify(
        "Đã lưu hồ sơ và bắt đầu Self-check. Chưa tạo yêu cầu Vexim Review.",
        "info",
      );
      router.push(`/reviews/${review.id}`);
    } catch (e) {
      app.notify(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  };
  const missing = Object.keys(validateIntake(product)).length;
  const percentage = product.formula.reduce(
    (s, i) => s + (i.percentage ?? 0),
    0,
  );
  const targetIngredient = product.formula.find((i) => i.id === allergenRow);
  return (
    <div className="page intake-page">
      <Link
        href={existing ? `/products/${existing.id}` : "/products"}
        className="back-link"
      >
        <ArrowLeft size={13} />
        {existing ? "Về hồ sơ sản phẩm" : "Danh sách sản phẩm"}
      </Link>
      <PageHeader
        eyebrow="HỒ SƠ SẢN PHẨM"
        title={existing ? "Cập nhật hồ sơ sản phẩm" : "Tạo hồ sơ sản phẩm"}
        description="Thông tin đầy đủ giúp chuyên viên rà soát chính xác hơn. Bạn có thể lưu nháp bất cứ lúc nào."
        actions={
          <Button
            variant="secondary"
            onClick={() => void saveDraft()}
            loading={busy}
          >
            <Save size={15} /> Lưu nháp
          </Button>
        }
      />
      <div className="intake-layout">
        <aside className="intake-step-nav">
          {steps.map((s, i) => (
            <button
              key={s.title}
              className={clsx(i === step && "active")}
              onClick={() => {
                setStep(i);
                setErrors({});
              }}
            >
              <span className={clsx("step-circle", i < step && "step-done")}>
                {i < step ? (
                  <Check size={13} />
                ) : (
                  String(i + 1).padStart(2, "0")
                )}
              </span>
              <div>
                <strong>{s.title}</strong>
                <small>{s.subtitle}</small>
              </div>
            </button>
          ))}
          <div className="intake-save-state">
            {saved ? <CheckCheck size={13} /> : <Save size={13} />}
            {saved ? "Nháp tự lưu trên thiết bị" : "Đang lưu nháp…"}
          </div>
        </aside>
        <Card className="intake-card">
          {step === 0 && (
            <div className="form-section">
              <div className="form-section-header">
                <span>
                  <Leaf size={19} />
                </span>
                <div>
                  <h2>Hãy bắt đầu với sản phẩm của bạn</h2>
                  <p>
                    Phân loại đúng là nền tảng cho một lượt rà soát đúng phạm
                    vi.
                  </p>
                </div>
              </div>
              <div className="form-grid">
                {!app.actor.role.startsWith("customer") && (
                  <Select
                    label="Khách hàng / doanh nghiệp"
                    required
                    value={product.organization_id}
                    onChange={(e) => update("organization_id", e.target.value)}
                    error={errors.organization_id}
                    className="span-2"
                  >
                    <option value="">Chọn doanh nghiệp</option>
                    {app.data.organizations
                      .filter((o) => o.status === "active")
                      .map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.name}
                        </option>
                      ))}
                  </Select>
                )}
                <Input
                  label="Tên sản phẩm"
                  required
                  placeholder="Ví dụ: Trà sen túi lọc"
                  value={product.name}
                  onChange={(e) => update("name", e.target.value)}
                  error={errors.name}
                />
                <Input
                  label="Thương hiệu"
                  required
                  placeholder="Tên thương hiệu trên nhãn"
                  value={product.brand}
                  onChange={(e) => update("brand", e.target.value)}
                  error={errors.brand}
                />
                <Select
                  label="Nhóm sản phẩm"
                  required
                  value={product.category}
                  onChange={(e) => {
                    const category = e.target.value as Product["category"];
                    setProduct((p) => ({
                      ...p,
                      category,
                      form:
                        category === "tea_bag"
                          ? "tea_bag"
                          : category === "ready_to_drink"
                            ? "liquid"
                            : p.form,
                      classification_status:
                        ["dry_packaged_tea", "tea_bag"].includes(category) &&
                        (category === "tea_bag" ? "tea_bag" : p.form) !==
                          "liquid"
                          ? "conventional_food"
                          : "out_of_scope",
                    }));
                  }}
                >
                  {Object.entries(CATEGORY_LABELS).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </Select>
                <Select
                  label="Dạng sản phẩm"
                  required
                  value={product.form}
                  onChange={(e) =>
                    update("form", e.target.value as Product["form"])
                  }
                >
                  {Object.entries(FORM_LABELS).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </Select>
                <Input
                  label="Thị trường mục tiêu"
                  value="Hoa Kỳ (United States)"
                  readOnly
                  hint="Phạm vi hỗ trợ hiện tại: ghi nhãn thực phẩm liên bang tại Hoa Kỳ."
                />
                <Input
                  label="Người phụ trách"
                  value={
                    app.actor.role === "reviewer"
                      ? app.actor.name
                      : "Chuyên viên Vexim được phân công"
                  }
                  readOnly
                />
              </div>
              {product.classification_status !== "conventional_food" && (
                <div style={{ marginTop: 21 }}>
                  <InlineNotice tone="warning" icon={<CircleAlert size={18} />}>
                    <strong>
                      Sản phẩm nằm ngoài phạm vi xử lý tự động hiện tại.
                    </strong>
                    <br />
                    Hồ sơ vẫn được tiếp nhận, nhưng phải chuyển chuyên gia.
                    Không tự động kết luận đây là thực phẩm bổ sung hoặc đồ uống
                    pha sẵn.
                  </InlineNotice>
                </div>
              )}
            </div>
          )}
          {step === 1 && (
            <>
              <div className="form-section">
                <div className="form-section-header">
                  <span>
                    <FlaskConical size={19} />
                  </span>
                  <div>
                    <h2>Công thức và thứ tự nguyên liệu</h2>
                    <p>
                      Nhập theo thứ tự khối lượng giảm dần. Có thể để trống tỷ
                      lệ nếu đã xác nhận thứ tự.
                    </p>
                  </div>
                </div>
                <div className="ingredient-head">
                  <span>TÊN NGUYÊN LIỆU</span>
                  <span>TÊN TIẾNG ANH</span>
                  <span>TỶ LỆ (%)</span>
                  <span />
                </div>
                {product.formula.map((i, n) => (
                  <div key={i.id}>
                    <div className="ingredient-row">
                      <Input
                        aria-label={`Nguyên liệu ${n + 1}`}
                        placeholder="Trà xanh"
                        value={i.name_original}
                        onChange={(e) =>
                          patchIngredient(i.id, {
                            name_original: e.target.value,
                          })
                        }
                        error={errors[`formula.${n}.name_original`]}
                      />
                      <Input
                        aria-label={`Nguyên liệu tiếng Anh ${n + 1}`}
                        placeholder="Green tea leaves"
                        value={i.name_english}
                        onChange={(e) =>
                          patchIngredient(i.id, {
                            name_english: e.target.value,
                            normalized_name: normalizeIngredient(
                              e.target.value,
                            ),
                          })
                        }
                        error={errors[`formula.${n}.name_english`]}
                      />
                      <Input
                        aria-label={`Tỷ lệ nguyên liệu ${n + 1}`}
                        type="number"
                        min="0"
                        max="100"
                        step="0.01"
                        placeholder="—"
                        value={i.percentage ?? ""}
                        onChange={(e) =>
                          patchIngredient(i.id, {
                            percentage:
                              e.target.value === ""
                                ? null
                                : Number(e.target.value),
                          })
                        }
                      />
                      <IconButton
                        label={`Xóa nguyên liệu ${n + 1}`}
                        onClick={() =>
                          update(
                            "formula",
                            product.formula
                              .filter((x) => x.id !== i.id)
                              .map((x, n) => ({ ...x, order: n + 1 })),
                          )
                        }
                      >
                        <Trash2 size={15} />
                      </IconButton>
                    </div>
                    <div
                      className="ingredient-controls"
                      style={{ marginTop: 6, justifyContent: "flex-start" }}
                    >
                      <button
                        className="text-button"
                        onClick={() => setAllergenRow(i.id)}
                        style={{ fontSize: 11 }}
                      >
                        Khai báo dị nguyên{" "}
                        {i.allergen_groups.length
                          ? `(${i.allergen_groups.map((a) => allergenNames[a]).join(", ")})`
                          : ""}
                      </button>
                      {detectAllergens(`${i.name_original} ${i.name_english}`)
                        .length > 0 && (
                        <Badge tone="amber">
                          Có thể chứa:{" "}
                          {detectAllergens(
                            `${i.name_original} ${i.name_english}`,
                          )
                            .map((a) => allergenNames[a])
                            .join(", ")}
                        </Badge>
                      )}
                    </div>
                  </div>
                ))}
                <div className="ingredient-controls">
                  <Button variant="secondary" size="sm" onClick={addIngredient}>
                    <Plus size={14} /> Thêm nguyên liệu
                  </Button>
                  <span className="ingredient-total">
                    Tổng tỷ lệ:{" "}
                    <strong>{percentage.toFixed(2).replace(".00", "")}%</strong>
                  </span>
                </div>
                {Object.keys(errors).some((k) => k.startsWith("formula")) && (
                  <p className="field-error-text" style={{ marginTop: 10 }}>
                    {errors.formula ??
                      "Bổ sung tên gốc và tên tiếng Anh cho mọi nguyên liệu."}
                  </p>
                )}
              </div>
              <div className="form-section">
                <div className="form-section-header">
                  <span>
                    <FileText size={19} />
                  </span>
                  <div>
                    <h2>Bao bì và khối lượng</h2>
                    <p>Nhập chính xác cách thể hiện dự kiến trên nhãn.</p>
                  </div>
                </div>
                <div className="form-grid">
                  <Input
                    label="Quy cách đóng gói"
                    required
                    placeholder="20 túi × 2 g / hộp"
                    value={product.package_size}
                    onChange={(e) => update("package_size", e.target.value)}
                    error={errors.package_size}
                  />
                  <Input
                    label="Khối lượng tịnh trên nhãn"
                    required
                    placeholder="1.41 oz (40 g)"
                    value={product.net_quantity}
                    onChange={(e) => update("net_quantity", e.target.value)}
                    tooltip="Net quantity là lượng thực phẩm không bao gồm bao bì. Chuyên viên sẽ đối chiếu cách ghi US customary / metric."
                    error={errors.net_quantity}
                  />
                </div>
              </div>
            </>
          )}
          {step === 2 && (
            <>
              <div className="form-section">
                <div className="form-section-header">
                  <span>
                    <Tags size={19} />
                  </span>
                  <div>
                    <h2>Tuyên bố trên nhãn và chứng nhận dự kiến</h2>
                    <p>
                      Giữ nguyên câu chữ trên nhãn, kể cả tuyên bố quảng bá hoặc
                      thông tin sức khỏe.
                    </p>
                  </div>
                </div>
                <Field
                  label="Tuyên bố trên nhãn về đặc tính sản phẩm"
                  hint="Để trống nếu không có tuyên bố. Nhấn Enter để thêm từng nội dung."
                >
                  <div className="claim-entry">
                    <Input
                      aria-label="Nội dung tuyên bố trên nhãn"
                      placeholder="Ví dụ: trà xanh hữu cơ"
                      value={claimInput}
                      onChange={(e) => setClaimInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          addClaim();
                        }
                      }}
                    />
                    <Button variant="secondary" onClick={addClaim}>
                      <Plus size={16} />
                    </Button>
                  </div>
                </Field>
                <div className="claim-tags">
                  {product.claims.map((c) => (
                    <span key={c} className="claim-tag">
                      {c}
                      <IconButton
                        label={`Xóa tuyên bố ${c}`}
                        onClick={() =>
                          update(
                            "claims",
                            product.claims.filter((x) => x !== c),
                          )
                        }
                      >
                        <X size={12} />
                      </IconButton>
                    </span>
                  ))}
                </div>
                {product.claims.some(
                  (c) => classifyClaim(c).classification === "DISEASE_CLAIM",
                ) && (
                  <div style={{ marginTop: 16 }}>
                    <InlineNotice tone="error" icon={<CircleAlert size={17} />}>
                      Có tuyên bố liên quan bệnh lý / điều trị. Hồ sơ cần chuyên
                      gia rà soát; không tự động kết luận sản phẩm hợp lệ.
                    </InlineNotice>
                  </div>
                )}
                <div style={{ marginTop: 23 }}>
                  <Field
                    label="Chứng nhận / dấu chứng nhận"
                    hint="Thông tin khai báo không thay thế chứng nhận thực tế."
                  >
                    <div className="claim-entry">
                      <Input
                        aria-label="Chứng nhận dự kiến"
                        placeholder="Ví dụ: chứng nhận hữu cơ, không biến đổi gen…"
                        value={certInput}
                        onChange={(e) => setCertInput(e.target.value)}
                      />
                      <Button
                        variant="secondary"
                        onClick={() => {
                          if (certInput.trim()) {
                            update("certifications", [
                              ...product.certifications,
                              certInput.trim(),
                            ]);
                            setCertInput("");
                          }
                        }}
                      >
                        <Plus size={16} />
                      </Button>
                    </div>
                  </Field>
                  <div className="claim-tags">
                    {product.certifications.map((c, i) => (
                      <span key={`${c}-${i}`} className="claim-tag">
                        {c}
                        <IconButton
                          label={`Xóa chứng nhận ${c}`}
                          onClick={() =>
                            update(
                              "certifications",
                              product.certifications.filter((_, n) => n !== i),
                            )
                          }
                        >
                          <X size={12} />
                        </IconButton>
                      </span>
                    ))}
                  </div>
                </div>
              </div>
              <div className="form-section">
                <div className="form-section-header">
                  <span>
                    <Globe2 size={19} />
                  </span>
                  <div>
                    <h2>Đơn vị chịu trách nhiệm</h2>
                    <p>
                      Nhà sản xuất bắt buộc; các đơn vị khác khai báo khi đã xác
                      định.
                    </p>
                  </div>
                </div>
                <div className="party-grid">
                  {(
                    [
                      ["manufacturer", "Nhà sản xuất"],
                      ["packer", "Đơn vị đóng gói"],
                      ["distributor", "Đơn vị phân phối"],
                      ["importer", "Nhà nhập khẩu thương mại"],
                    ] as const
                  ).map(([key, label]) => (
                    <div className="party-card" key={key}>
                      <h3>{label}</h3>
                      <Input
                        label={`Tên ${label.toLowerCase()}`}
                        required={key === "manufacturer"}
                        value={product[key].name}
                        onChange={(e) =>
                          update(key, { ...product[key], name: e.target.value })
                        }
                        error={errors[`${key}.name`]}
                      />
                      <Input
                        label={`Địa chỉ ${label.toLowerCase()}`}
                        required={key === "manufacturer"}
                        value={product[key].address}
                        onChange={(e) =>
                          update(key, {
                            ...product[key],
                            address: e.target.value,
                          })
                        }
                        error={errors[`${key}.address`]}
                      />
                    </div>
                  ))}
                </div>
                <p className="tiny muted" style={{ marginTop: 12 }}>
                  Trường nhà nhập khẩu thương mại không ghi nhận riêng bên nhận
                  hàng (consignee) nếu hai bên khác nhau và không xác lập tư
                  cách FSVP Importer. Tư cách FSVP được xác nhận độc lập trong
                  luồng cộng tác.
                </p>
              </div>
            </>
          )}
          {step === 3 && (
            <>
              <div className="form-section">
                <div className="form-section-header">
                  <span>
                    <UploadCloud size={19} />
                  </span>
                  <div>
                    <h2>Tải nhãn để bắt đầu rà soát</h2>
                    <p>
                      File gốc được giữ bất biến. Bản normalized được tạo riêng
                      để xử lý.
                    </p>
                  </div>
                </div>
                <FileDropzone
                  files={files}
                  onChange={setFiles}
                  disabled={busy}
                />
                {errors.files && (
                  <p className="field-error-text" style={{ marginTop: 9 }}>
                    {errors.files}
                  </p>
                )}
                {app.mode === "demo" && (
                  <div style={{ marginTop: 15 }}>
                    <InlineNotice icon={<Info size={16} />}>
                      Trong demo, nhãn của bạn ở trên thiết bị này (IndexedDB)
                      và nhận dạng chữ (OCR) chạy cục bộ. Chưa quét phần mềm độc
                      hại; chỉ thử với file tin cậy.
                    </InlineNotice>
                  </div>
                )}
              </div>
              <div className="form-section">
                <div className="form-section-header">
                  <span>
                    <Globe2 size={19} />
                  </span>
                  <div>
                    <h2>Kênh bán hàng & điều kiện miễn ghi nhãn</h2>
                    <p>
                      Chỉ thu thập dữ liệu; quyết định miễn ghi nhãn cần chuyên
                      viên xác nhận.
                    </p>
                  </div>
                </div>
                <Field
                  label="Kênh bán hàng tại Hoa Kỳ"
                  required
                  error={errors.channel}
                >
                  <div className="channels">
                    {Object.entries(CHANNEL_LABELS).map(([key, label]) => (
                      <Checkbox
                        key={key}
                        checked={product.channel.includes(key)}
                        onChange={(v) =>
                          update(
                            "channel",
                            v
                              ? [...product.channel, key]
                              : product.channel.filter((x) => x !== key),
                          )
                        }
                      >
                        {label}
                      </Checkbox>
                    ))}
                  </div>
                </Field>
                <div className="form-grid" style={{ marginTop: 24 }}>
                  <Input
                    label="Số đơn vị bán dự kiến / 12 tháng"
                    required
                    type="number"
                    min="0"
                    step="1"
                    placeholder="Ví dụ: 10000"
                    value={product.expected_us_units_12m ?? ""}
                    onChange={(e) =>
                      update(
                        "expected_us_units_12m",
                        e.target.value === "" ? null : Number(e.target.value),
                      )
                    }
                    error={errors.expected_us_units_12m}
                  />
                  <Input
                    label="Nhân sự tương đương toàn thời gian (FTE)"
                    type="number"
                    min="0"
                    step="0.1"
                    placeholder="Ví dụ: 20"
                    value={product.employee_fte ?? ""}
                    onChange={(e) =>
                      update(
                        "employee_fte",
                        e.target.value === "" ? null : Number(e.target.value),
                      )
                    }
                    tooltip="FTE là số nhân sự quy đổi tương đương toàn thời gian. Cần xác nhận phạm vi theo quy định áp dụng."
                    error={errors.employee_fte}
                  />
                </div>
                <div style={{ marginTop: 21 }}>
                  <Checkbox
                    checked={product.exemption_requested}
                    onChange={(v) => update("exemption_requested", v)}
                  >
                    Đề nghị chuyên viên đánh giá điều kiện miễn ghi nhãn dinh
                    dưỡng (Nutrition Labeling Exemption)
                  </Checkbox>
                </div>
              </div>
              <div className="form-section">
                <div className="form-section-header">
                  <span>
                    <CheckCheck size={19} />
                  </span>
                  <div>
                    <h2>Xác nhận thông tin cung cấp</h2>
                    <p>
                      Thông tin thiếu không được hệ thống suy đoán thành đạt.
                    </p>
                  </div>
                </div>
                <div style={{ display: "grid", gap: 16 }}>
                  <Checkbox
                    checked={product.formula_confirmed}
                    onChange={(v) => update("formula_confirmed", v)}
                  >
                    Tôi xác nhận công thức, nguyên liệu và thứ tự khối lượng
                    tương ứng với nhãn tải lên.
                  </Checkbox>
                  <Checkbox
                    checked={product.claims_confirmed}
                    onChange={(v) => update("claims_confirmed", v)}
                  >
                    Tôi xác nhận đã khai báo đầy đủ tuyên bố trên nhãn và các
                    dấu chứng nhận dự kiến.
                  </Checkbox>
                </div>
                {Object.keys(errors).length > 0 && (
                  <div style={{ marginTop: 20 }}>
                    <InlineNotice tone="error">
                      <strong>Các thông tin còn thiếu</strong>
                      <ul className="validation-list">
                        {[...new Set(Object.values(errors))].map((e) => (
                          <li key={e}>{e}</li>
                        ))}
                      </ul>
                    </InlineNotice>
                  </div>
                )}
              </div>
            </>
          )}
          <div className="intake-footer">
            <Button
              variant="ghost"
              onClick={() =>
                step ? setStep(step - 1) : router.push("/products")
              }
            >
              <ArrowLeft size={14} />
              {step ? "Quay lại" : "Thoát"}
            </Button>
            <div>
              <span className="tiny muted" style={{ alignSelf: "center" }}>
                {step + 1} / 4
              </span>
              {step < 3 ? (
                <Button onClick={next}>
                  Tiếp tục <ArrowRight size={15} />
                </Button>
              ) : (
                <Button onClick={() => void submit()} loading={busy}>
                  <FileText size={15} /> Lưu và chạy Self-check
                </Button>
              )}
            </div>
          </div>
        </Card>
        <aside className="intake-aside">
          <Card>
            <h3>
              <ShieldCheck size={17} /> Hồ sơ có thể giải thích
            </h3>
            <p>
              Mỗi phát hiện gắn với bằng chứng, quy tắc, căn cứ trích dẫn và
              quyết định của chuyên viên.
            </p>
            <ul>
              <li>
                <Check size={12} /> Giữ lịch sử phiên bản nhãn
              </li>
              <li>
                <Check size={12} /> Không suy đoán dữ liệu thiếu
              </li>
              <li>
                <Check size={12} /> Không tự động phê duyệt
              </li>
            </ul>
          </Card>
          <Card>
            <h3>
              <FileText size={17} /> Mức độ đầy đủ
            </h3>
            <div style={{ marginTop: 15 }}>
              <ProgressBar value={Math.max(0, 100 - missing * 7)} />
            </div>
            <p>
              {missing
                ? `${missing} mục cần bổ sung hoặc xác nhận trước khi chạy Self-check.`
                : "Thông tin đã đầy đủ. Hãy kiểm tra file nhãn và chạy Self-check."}
            </p>
          </Card>
          <div className="inline-notice" style={{ fontSize: 11 }}>
            <Info size={15} />
            <div>
              Self-check chỉ là rà soát sơ bộ trong phạm vi hỗ trợ hiện tại.
              Thao tác này không gửi yêu cầu Vexim Review và không xác định việc
              tuân thủ hoặc phê duyệt của FDA.
            </div>
          </div>
        </aside>
      </div>
      <Modal
        open={!!allergenRow}
        onClose={() => setAllergenRow(null)}
        title="Dị nguyên trong nguyên liệu"
        description={`Khai báo dựa trên thông tin thực tế của ${targetIngredient?.name_english || "nguyên liệu"}.`}
        footer={<Button onClick={() => setAllergenRow(null)}>Xác nhận</Button>}
      >
        <div
          style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 17 }}
        >
          {Object.entries(allergenNames).map(([key, name]) => (
            <Checkbox
              key={key}
              checked={targetIngredient?.allergen_groups.includes(key) ?? false}
              onChange={(v) => {
                if (targetIngredient)
                  patchIngredient(targetIngredient.id, {
                    allergen_groups: v
                      ? [...targetIngredient.allergen_groups, key]
                      : targetIngredient.allergen_groups.filter(
                          (x) => x !== key,
                        ),
                  });
              }}
            >
              {name}
            </Checkbox>
          ))}
        </div>
        <div style={{ marginTop: 22 }}>
          <InlineNotice tone="warning">
            Dữ liệu công thức chỉ hỗ trợ đối chiếu; cần chứng cứ từ nhà cung cấp
            hoặc allergen control statement khi chuyên viên yêu cầu.
          </InlineNotice>
        </div>
      </Modal>
    </div>
  );
}
