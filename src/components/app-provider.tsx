"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import type {
  Actor,
  AppData,
  ComplianceRule,
  ExtractedField,
  Finding,
  LabelFile,
  LabelVersion,
  Member,
  Organization,
  PipelineStep,
  Product,
  RegulatorySource,
  Report,
  Review,
  ReviewParticipant,
  ReviewPartyDecisionEntry,
  ReviewPartyDecisionType,
  ReviewStatus,
  Role,
} from "@/lib/types";
import { DEMO_ACTOR, PIPELINE_LABELS, MAX_FILES } from "@/lib/constants";
import {
  createSeedData,
  refreshDraftOnlyDemoFixture,
  sampleFields,
} from "@/lib/seed";
import { demoArtworkPreviewUrl } from "@/lib/demo-artwork";
import { isSyntheticDemoReview } from "@/lib/demo-review";
import { localLabelBundleSha256 } from "@/lib/collaboration";
import {
  DEMO_MOCK_SCAN_SESSION_STORAGE_KEY,
  createDemoMockScanRecord,
  demoMockScannedFileIdsFor,
  parseDemoMockScanSession,
  type DemoMockScanRecord,
} from "@/lib/demo-mock-scan";
import { canAccessOrg, assertCan, assertOrg } from "@/lib/permissions";
import {
  uid,
  now,
  errorMessage,
  sha256,
  sourceIsCurrent,
  downloadBlob,
  downloadJson,
} from "@/lib/utils";
import {
  api,
  getSupabase,
  isSupabaseConfigured,
  isSupabaseRequested,
  isDemoEnabled,
} from "@/lib/supabase";
import {
  prepareUpload,
  normalizePages,
  type NormalizedPage,
} from "@/lib/files";
import { clearLocalFiles, getLocalFile, putLocalFile } from "@/lib/storage";
import { extractFromOcr } from "@/lib/extraction";
import { evaluateRules } from "@/lib/rules-engine";
import { evaluateTriage } from "@/lib/triage";
import { validateIntake, findingPatchSchema } from "@/lib/validation";
import { buildReportSnapshot } from "@/lib/reports";
import { assertTransition } from "@/lib/workflow";
import { runRuleRegression, type RegressionResult } from "@/lib/regression";

const STORAGE_KEY = "vexim-workspace-v3";
const DEMO_FIXTURE_REVISION_KEY = "vexim-demo-fixture-revision";
const DEMO_FIXTURE_REVISION = "tea-review-draft-15-v1";
const empty: AppData = {
  organizations: [],
  members: [],
  products: [],
  labelVersions: [],
  reviews: [],
  findings: [],
  sources: [],
  rules: [],
  requests: [],
  reports: [],
  reviewParticipants: [],
  partyDecisions: [],
  audit: [],
};
interface Toast {
  id: string;
  message: string;
  tone: "success" | "error" | "info";
}
interface WorkspaceResponse {
  data: AppData;
  actor: Actor;
}
interface ContextValue {
  data: AppData;
  actor: Actor;
  mode: "demo" | "supabase";
  demoMockScans: Record<string, DemoMockScanRecord>;
  loading: boolean;
  authenticated: boolean;
  error: string | null;
  toasts: Toast[];
  notify: (message: string, tone?: Toast["tone"]) => void;
  dismissToast: (id: string) => void;
  refresh: () => Promise<void>;
  enterDemo: () => void;
  signOut: () => Promise<void>;
  setDemoRole: (role: Role, alternate?: boolean) => void;
  resetDemo: () => Promise<void>;
  runDemoMockScan: (reviewId: string) => Promise<DemoMockScanRecord>;
  saveProduct: (product: Product) => Promise<Product>;
  uploadVersion: (productId: string, files: File[]) => Promise<LabelVersion>;
  submitReview: (labelId: string) => Promise<Review>;
  rerunReview: (
    reviewId: string,
    from?: PipelineStep["stage"],
  ) => Promise<void>;
  patchFinding: (
    id: string,
    patch: Pick<Finding, "severity" | "status" | "reviewer_comment"> & {
      citation_ids?: string[];
    },
  ) => Promise<void>;
  addFinding: (finding: Finding) => Promise<void>;
  updateField: (
    labelId: string,
    fieldId: string,
    value: string,
    reason: string,
  ) => Promise<void>;
  requestInformation: (
    reviewId: string,
    message: string,
    docs: string[],
  ) => Promise<void>;
  resolveRequest: (requestId: string) => Promise<void>;
  assignReview: (reviewId: string) => Promise<void>;
  transitionReview: (
    reviewId: string,
    status: ReviewStatus,
    reason: string,
  ) => Promise<void>;
  inviteReviewParticipant: (
    reviewId: string,
    organizationContactEmail: string,
    partyRole: "commercial_importer" | "fsvp_importer",
  ) => Promise<void>;
  acceptReviewParticipant: (
    participantId: string,
    attestsFsvp?: boolean,
    attestationNote?: string,
  ) => Promise<void>;
  removeReviewParticipant: (
    participantId: string,
    reason: string,
  ) => Promise<void>;
  shareReview: (reviewId: string, comment: string) => Promise<void>;
  recordPartyDecision: (
    reviewId: string,
    partyRole: "label_owner" | "commercial_importer",
    decision: ReviewPartyDecisionType,
    comment: string,
    proposedChanges?: ReviewPartyDecisionEntry["proposed_changes"],
  ) => Promise<void>;
  approveReport: (reviewId: string, comment: string) => Promise<Report>;
  downloadReport: (reportId: string, format: "pdf" | "json") => Promise<void>;
  getFileBlob: (file: LabelFile) => Promise<Blob>;
  logFileAccess: (
    label: LabelVersion,
    file: LabelFile,
    action?: "view" | "download",
  ) => Promise<void>;
  saveOrganization: (organization: Organization) => Promise<void>;
  inviteMember: (
    orgId: string,
    name: string,
    email: string,
    role: Role,
  ) => Promise<void>;
  setMemberStatus: (id: string, status: Member["status"]) => Promise<void>;
  saveSource: (source: RegulatorySource) => Promise<void>;
  approveSource: (id: string) => Promise<void>;
  saveRule: (rule: ComplianceRule) => Promise<void>;
  testRule: (id: string) => Promise<RegressionResult[]>;
  approveRule: (id: string) => Promise<void>;
}
const AppContext = createContext<ContextValue | null>(null);
export const useApp = () => {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("AppProvider missing");
  return ctx;
};

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [rawData, setData] = useState<AppData>(empty);
  const dataRef = useRef<AppData>(empty);
  const [demoMockScans, setDemoMockScans] = useState<
    Record<string, DemoMockScanRecord>
  >({});
  const demoMockScansRef = useRef<Record<string, DemoMockScanRecord>>({});
  const [actor, setActor] = useState<Actor>(DEMO_ACTOR);
  const actorRef = useRef<Actor>(DEMO_ACTOR);
  const [mode, setMode] = useState<"demo" | "supabase">(
    isSupabaseRequested() ? "supabase" : "demo",
  );
  const modeRef = useRef(mode);
  const [loading, setLoading] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const running = useRef(new Set<string>());
  const persistWarning = useRef(false);
  const notify = useCallback(
    (message: string, tone: Toast["tone"] = "success") => {
      const id = uid();
      setToasts((prev) => [...prev.slice(-3), { id, message, tone }]);
      setTimeout(
        () => setToasts((prev) => prev.filter((t) => t.id !== id)),
        6000,
      );
    },
    [],
  );
  const updateActor = useCallback((a: Actor) => {
    actorRef.current = a;
    setActor(a);
  }, []);
  const replace = useCallback((d: AppData) => {
    dataRef.current = d;
    setData(d);
  }, []);
  const replaceDemoMockScans = useCallback(
    (scans: Record<string, DemoMockScanRecord>, persistSession = true) => {
      demoMockScansRef.current = scans;
      setDemoMockScans(scans);
      if (persistSession && typeof window !== "undefined") {
        try {
          window.sessionStorage.setItem(
            DEMO_MOCK_SCAN_SESSION_STORAGE_KEY,
            JSON.stringify(scans),
          );
        } catch {
          // Session persistence is optional; the current tab can still test the flow.
        }
      }
    },
    [],
  );
  const clearDemoMockScans = useCallback(() => {
    demoMockScansRef.current = {};
    setDemoMockScans({});
    if (typeof window !== "undefined") {
      try {
        window.sessionStorage.removeItem(DEMO_MOCK_SCAN_SESSION_STORAGE_KEY);
      } catch {
        // The mock state is also cleared from memory.
      }
    }
  }, []);
  const restoreDemoMockScans = useCallback(
    (data: AppData) => {
      let serialized: string | null = null;
      try {
        serialized = window.sessionStorage.getItem(
          DEMO_MOCK_SCAN_SESSION_STORAGE_KEY,
        );
      } catch {
        // The mock scan remains available for this tab, even without sessionStorage.
      }
      replaceDemoMockScans(parseDemoMockScanSession(data, serialized));
    },
    [replaceDemoMockScans],
  );
  const commit = useCallback(
    (fn: (draft: AppData) => void) => {
      const next = structuredClone(dataRef.current);
      fn(next);
      replace(next);
      if (modeRef.current === "demo") {
        try {
          localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify({ version: 3, data: next, actor: actorRef.current }),
          );
        } catch {
          if (!persistWarning.current) {
            persistWarning.current = true;
            notify(
              "Bộ nhớ trình duyệt đầy. Thay đổi hiện tại chưa được lưu bền vững; hãy xuất dữ liệu.",
              "error",
            );
          }
        }
      }
    },
    [replace, notify],
  );
  const log = (
    d: AppData,
    action: string,
    entityType: string,
    entityId: string,
    description: string,
    orgId: string | null,
    metadata: Record<string, unknown> = {},
  ) => {
    d.audit.unshift({
      id: uid(),
      organization_id: orgId,
      actor_id: actorRef.current.id,
      actor_name: actorRef.current.name,
      action,
      entity_type: entityType,
      entity_id: entityId,
      description,
      metadata: { ...metadata, demo: true },
      created_at: now(),
    });
  };
  const loadRemote = useCallback(async () => {
    const result = await api<WorkspaceResponse>("/workspace");
    clearDemoMockScans();
    replace(result.data);
    updateActor(result.actor);
    setAuthenticated(true);
    setError(null);
  }, [clearDemoMockScans, replace, updateActor]);
  const loadDemo = useCallback(() => {
    modeRef.current = "demo";
    setMode("demo");
    const seeded = createSeedData();
    let d = seeded;
    let a = { ...DEMO_ACTOR };
    let hasSavedDemoData = false;
    let refreshFixture = false;
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
      if (
        saved?.version === 3 &&
        Array.isArray(saved.data?.products) &&
        Array.isArray(saved.data?.reviews)
      ) {
        d = saved.data;
        a = saved.actor ?? a;
        hasSavedDemoData = true;
      }
      refreshFixture =
        localStorage.getItem(DEMO_FIXTURE_REVISION_KEY) !==
        DEMO_FIXTURE_REVISION;
    } catch {
      /* An invalid local snapshot is replaced by an explicitly marked demo. */
    }
    if (refreshFixture && hasSavedDemoData)
      d = refreshDraftOnlyDemoFixture(d, seeded);
    // A browser job cannot survive closing the tab. Never pretend that it is still running.
    d.reviews = d.reviews.map((r) =>
      r.status === "PROCESSING" && !r.idempotency_key.startsWith("seed-")
        ? {
            ...r,
            status: "PROCESSING_FAILED",
            error_message:
              "Phiên xử lý cục bộ bị gián đoạn. File gốc vẫn được giữ; hãy chạy lại từ bước chưa hoàn thành.",
            pipeline: r.pipeline.map((s) =>
              s.status === "running" ? { ...s, status: "failed" } : s,
            ),
          }
        : r,
    );
    replace(d);
    updateActor(a);
    restoreDemoMockScans(d);
    if (refreshFixture || !hasSavedDemoData) {
      try {
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({ version: 3, data: d, actor: a }),
        );
        localStorage.setItem(DEMO_FIXTURE_REVISION_KEY, DEMO_FIXTURE_REVISION);
      } catch {
        /* Retry the narrow fixture migration on the next demo load. */
      }
    }
    setAuthenticated(true);
    setError(null);
    setLoading(false);
  }, [replace, restoreDemoMockScans, updateActor]);
  useEffect(() => {
    if (!isSupabaseConfigured()) {
      if (isSupabaseRequested()) {
        setError(
          "Cấu hình Supabase chưa đầy đủ. Cần URL và public anon key. Không chuyển sang dữ liệu mẫu tự động.",
        );
        setLoading(false);
      } else loadDemo();
      return;
    }
    let cancelled = false;
    const client = getSupabase();
    client.auth.getSession().then(async ({ data: { session } }) => {
      if (cancelled) return;
      if (session) {
        try {
          await loadRemote();
        } catch (e) {
          setError(errorMessage(e));
        }
      }
      setLoading(false);
    });
    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((event, session) => {
      if (modeRef.current !== "supabase" || cancelled) return;
      if (event === "SIGNED_OUT" || !session) {
        setAuthenticated(false);
        replace(empty);
      }
      // Avoid nested Supabase auth calls inside its synchronous auth callback.
      else if (event === "SIGNED_IN")
        setTimeout(() => {
          if (!cancelled)
            loadRemote()
              .catch((e) => setError(errorMessage(e)))
              .finally(() => setLoading(false));
        }, 0);
    });
    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [loadDemo, loadRemote, replace]);
  useEffect(() => {
    if (mode !== "supabase" || !authenticated) return;
    const client = getSupabase();
    const channel = client
      .channel(`workspace-${actor.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "reviews" },
        () => {
          loadRemote().catch(() => undefined);
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "findings" },
        () => {
          loadRemote().catch(() => undefined);
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "review_participants" },
        () => {
          loadRemote().catch(() => undefined);
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "review_party_decisions" },
        () => {
          loadRemote().catch(() => undefined);
        },
      )
      .subscribe();
    // Realtime is optional; one interval also handles deployments without publication setup.
    const timer = setInterval(() => {
      if (document.visibilityState === "visible")
        loadRemote().catch(() => undefined);
    }, 15000);
    return () => {
      clearInterval(timer);
      void client.removeChannel(channel);
    };
  }, [mode, authenticated, actor.id, loadRemote]);

  const refresh = async () => {
    if (modeRef.current === "supabase") await loadRemote();
    else replace(structuredClone(dataRef.current));
  };
  const enterDemo = () => {
    if (!isDemoEnabled()) {
      notify("Demo đã tắt trong cấu hình triển khai.", "error");
      return;
    }
    loadDemo();
  };
  const signOut = async () => {
    clearDemoMockScans();
    if (isSupabaseConfigured()) {
      modeRef.current = "supabase";
      setMode("supabase");
      await getSupabase().auth.signOut();
    }
    setAuthenticated(false);
    replace(empty);
    setError(null);
  };
  const setDemoRole = (role: Role, alternate = false) => {
    if (modeRef.current !== "demo")
      throw new Error(
        "Quyền thực tế được xác định bởi Supabase, không thể đổi trong trình duyệt.",
      );
    const identities: Record<
      Role,
      { id: string; name: string; email: string }
    > = {
      reviewer: DEMO_ACTOR,
      regulatory_admin: {
        id: alternate ? "demo-regulatory-approver" : "demo-regulatory",
        name: alternate ? "Minh Phạm" : "Hà Trần",
        email: alternate ? "minh.pham@vexim.example" : "ha.tran@vexim.example",
      },
      system_admin: {
        id: "demo-system",
        name: "Quang Lê",
        email: "quang.le@vexim.example",
      },
      customer_admin: alternate
        ? {
            id: "demo-customer-admin-importer",
            name: "Hoàng Nam",
            email: "export@moctraviet.example",
          }
        : {
            id: "demo-customer-admin",
            name: "Minh Anh",
            email: "contact@annhientea.example",
          },
      customer_contributor: alternate
        ? {
            id: "demo-contributor-importer",
            name: "Khánh Linh",
            email: "linh@moctraviet.example",
          }
        : {
            id: "demo-contributor",
            name: "Tuấn Anh",
            email: "tuan.anh@annhientea.example",
          },
    };
    const next = {
      ...identities[role],
      role,
      organization_id: role.startsWith("customer")
        ? (dataRef.current.organizations[alternate ? 1 : 0]?.id ?? null)
        : null,
    };
    updateActor(next);
    commit(() => undefined);
    notify(`Đang mô phỏng vai trò: ${next.name}.`, "info");
  };
  const resetDemo = async () => {
    if (running.current.size)
      throw new Error("Hãy chờ tác vụ OCR kết thúc trước khi đặt lại dữ liệu.");
    await clearLocalFiles();
    clearDemoMockScans();
    localStorage.removeItem(STORAGE_KEY);
    updateActor(DEMO_ACTOR);
    const d = createSeedData();
    commit((draft) => Object.assign(draft, d));
    notify("Đã đặt lại không gian dữ liệu mẫu.");
  };
  const remoteAction = async <T,>(
    path: string,
    body: unknown,
    method = "POST",
  ) => {
    const result = await api<T>(path, { method, body: JSON.stringify(body) });
    await loadRemote();
    return result;
  };
  const productFor = (productId: string) => {
    const p = dataRef.current.products.find((p) => p.id === productId);
    if (!p) throw new Error("Không tìm thấy sản phẩm.");
    assertOrg(actorRef.current, p.organization_id);
    return p;
  };
  const reviewFor = (reviewId: string) => {
    const r = dataRef.current.reviews.find((r) => r.id === reviewId);
    if (!r) throw new Error("Không tìm thấy review.");
    assertOrg(actorRef.current, r.organization_id);
    return r;
  };
  const saveProduct = async (product: Product) => {
    assertCan(actorRef.current, "products");
    assertOrg(actorRef.current, product.organization_id);
    if (product.name.trim().length < 2)
      throw new Error("Nhập tên sản phẩm ít nhất 2 ký tự.");
    if (modeRef.current === "supabase")
      return remoteAction<Product>("/products", product);
    const exists = dataRef.current.products.some((p) => p.id === product.id);
    const saved = {
      ...product,
      classification_status: (["dry_packaged_tea", "tea_bag"].includes(
        product.category,
      ) && product.form !== "liquid"
        ? "conventional_food"
        : "out_of_scope") as Product["classification_status"],
      assigned_to: exists
        ? product.assigned_to
        : actorRef.current.role === "reviewer"
          ? actorRef.current.id
          : "",
      name: product.name.trim(),
      updated_at: now(),
      created_by: exists ? product.created_by : actorRef.current.id,
    };
    commit((d) => {
      const idx = d.products.findIndex((p) => p.id === product.id);
      if (idx < 0) d.products.unshift(saved);
      else d.products[idx] = saved;
      log(
        d,
        exists ? "product.updated" : "product.created",
        "product",
        saved.id,
        `${exists ? "Cập nhật" : "Tạo hồ sơ"} ${saved.name}`,
        saved.organization_id,
        { changed_fields: ["formula", "claims", "intake"] },
      );
    });
    return saved;
  };
  const uploadVersion = async (productId: string, files: File[]) => {
    assertCan(actorRef.current, "products");
    const p = productFor(productId);
    if (!files.length || files.length > MAX_FILES)
      throw new Error("Mỗi phiên bản cần từ 1 đến 20 file.");
    if (modeRef.current === "supabase") {
      const manifest: LabelFile[] = [];
      for (const file of files) manifest.push(await prepareUpload(file, false));
      const result = await api<LabelVersion>(
        `/products/${productId}/label-versions`,
        { method: "POST", body: JSON.stringify({ manifest }) },
      );
      for (let i = 0; i < files.length; i++) {
        const entry = result.original_files.find(
          (f) => f.id === manifest[i].id,
        );
        if (!entry) throw new Error("Manifest file không khớp.");
        const { error } = await getSupabase()
          .storage.from("label-originals")
          .upload(entry.storage_path, files[i], {
            upsert: false,
            contentType: entry.mime_type,
            cacheControl: "3600",
          });
        if (error) {
          await loadRemote();
          throw new Error(
            `Tải ${files[i].name} thất bại: ${error.message}. File đã tải không bị ghi đè; vui lòng tạo phiên bản mới.`,
          );
        }
      }
      await loadRemote();
      return result;
    }
    const prepared: LabelFile[] = [];
    for (const file of files) {
      const info = await prepareUpload(file);
      await putLocalFile(info.id, file);
      prepared.push(info);
    }
    const version =
      Math.max(
        0,
        ...dataRef.current.labelVersions
          .filter((v) => v.product_id === productId)
          .map((v) => v.version),
      ) + 1;
    const label: LabelVersion = {
      id: uid(),
      organization_id: p.organization_id,
      product_id: productId,
      version,
      original_files: prepared,
      normalized_files: [],
      status: "uploaded",
      uploaded_by: actorRef.current.id,
      uploaded_at: now(),
      extracted_fields: [],
    };
    commit((d) => {
      d.labelVersions.unshift(label);
      log(
        d,
        "label.uploaded",
        "label_version",
        label.id,
        `Tải nhãn v${version} · ${files.length} file · ${p.name}`,
        p.organization_id,
        {
          hashes: prepared.map((f) => f.sha256),
          virus_scan: "NOT_AVAILABLE_IN_DEMO",
        },
      );
    });
    return label;
  };
  const getFileBlob = async (file: LabelFile) => {
    if (modeRef.current === "supabase") {
      const demoPreviewUrl = demoArtworkPreviewUrl(file);
      if (demoPreviewUrl) {
        const response = await fetch(demoPreviewUrl);
        if (!response.ok)
          throw new Error("Không tải được artwork SVG mẫu đã allowlist.");
        const blob = await response.blob();
        if (
          blob.size !== file.size ||
          (await sha256(await blob.arrayBuffer())) !== file.sha256
        )
          throw new Error("Artwork SVG mẫu không khớp SHA-256 đã allowlist.");
        return blob;
      }
      const result = await api<{ url: string }>(`/files/${file.id}/signed-url`);
      const response = await fetch(result.url);
      if (!response.ok)
        throw new Error("Link file đã hết hạn hoặc không truy cập được.");
      return response.blob();
    }
    if (file.preview_url?.startsWith("/samples/")) {
      const response = await fetch(file.preview_url);
      if (!response.ok) throw new Error("Không tải được file mẫu.");
      return response.blob();
    }
    const blob = await getLocalFile(file.id);
    if (!blob)
      throw new Error(
        "File cục bộ không còn trong trình duyệt. Vui lòng tải lại phiên bản nhãn.",
      );
    return blob;
  };
  const runPipeline = async (
    reviewId: string,
    from: PipelineStep["stage"] = "validation",
  ) => {
    if (running.current.has(reviewId)) return;
    running.current.add(reviewId);
    const sequence: PipelineStep["stage"][] = [
      "validation",
      "ocr",
      "extraction",
      "rules",
      "verification",
    ];
    const start = sequence.indexOf(from);
    const r = reviewFor(reviewId);
    const label = dataRef.current.labelVersions.find(
      (v) => v.id === r.label_version_id,
    )!;
    const product = r.dossier_snapshot ?? productFor(r.product_id);
    const changeStep = (
      stage: PipelineStep["stage"],
      status: PipelineStep["status"],
      progress: number,
      message?: string,
    ) =>
      commit((d) => {
        const review = d.reviews.find((r) => r.id === reviewId)!;
        review.progress = progress;
        review.updated_at = now();
        review.pipeline = review.pipeline.map((s) =>
          s.stage === stage
            ? {
                ...s,
                status,
                message,
                attempts:
                  s.attempts +
                  (status === "running" && s.status !== "running" ? 1 : 0),
                ...(status === "complete" ? { completed_at: now() } : {}),
              }
            : s,
        );
      });
    commit((d) => {
      const review = d.reviews.find((r) => r.id === reviewId)!;
      review.status = "PROCESSING";
      review.error_message = null;
      review.approved_by = null;
      review.approved_at = null;
      review.pipeline = review.pipeline.map((s, i) =>
        i >= start ? { ...s, status: "pending" } : s,
      );
    });
    let fields: ExtractedField[] = label.extracted_fields;
    let localOcrConfidence: number | null = null;
    let localOcrPages: number | null = null;
    try {
      if (start <= 0) {
        changeStep(
          "validation",
          "running",
          3,
          "Kiểm tra nội dung file, số trang và SHA-256. Chế độ mẫu không có virus scan.",
        );
        if (!label.original_files.length)
          throw new Error("Phiên bản nhãn không có file.");
        changeStep(
          "validation",
          "complete",
          10,
          "File gốc được lưu bất biến trong IndexedDB; chưa quét malware.",
        );
      }
      if (start <= 2) {
        if (
          label.original_files.every((f) => f.storage_path.startsWith("demo/"))
        ) {
          changeStep(
            "ocr",
            "running",
            20,
            "Nạp evidence fixture minh họa, không phải OCR thực.",
          );
          fields = sampleFields(label.original_files);
          changeStep("ocr", "complete", 55, "Evidence từ bộ fixture minh họa.");
        } else {
          changeStep(
            "ocr",
            "running",
            15,
            "OCR cục bộ trong trình duyệt. File không được gửi đến provider bên ngoài.",
          );
          const pages: { file: LabelFile; page: NormalizedPage }[] = [];
          const normalized: LabelFile[] = [];
          for (const file of label.original_files) {
            const blob = await getFileBlob(file);
            if ((await sha256(await blob.arrayBuffer())) !== file.sha256)
              throw new Error(
                "SHA-256 file gốc không khớp. Không tiếp tục xử lý.",
              );
            for (const page of await normalizePages(blob, file)) {
              const normalizedId = `${file.id}:page-${page.page}`;
              await putLocalFile(normalizedId, page.image);
              normalized.push({
                id: normalizedId,
                name: `${file.name} · trang ${page.page}`,
                mime_type: "image/png",
                size: page.image.size,
                storage_path: `local/${normalizedId}`,
                sha256: await sha256(await page.image.arrayBuffer()),
                page_count: 1,
                scan_status: "dev_unscanned",
                kind: "normalized",
                original_file_id: file.id,
                page: page.page,
              });
              pages.push({ file, page });
            }
          }
          commit((d) => {
            d.labelVersions.find((v) => v.id === label.id)!.normalized_files =
              normalized;
          });
          const { recognizePages } = await import("@/lib/browser-ocr");
          const ocr = await recognizePages(pages, (progress, message) =>
            changeStep(
              "ocr",
              "running",
              Math.round(15 + progress * 40),
              message,
            ),
          );
          localOcrConfidence = ocr.confidence;
          localOcrPages = ocr.pages;
          fields = extractFromOcr(ocr);
          changeStep(
            "ocr",
            "complete",
            55,
            `Đã đọc ${ocr.pages} trang; confidence ${Math.round(ocr.confidence * 100)}%.`,
          );
        }
        changeStep(
          "extraction",
          "running",
          60,
          "Trích xuất cấu trúc bằng bộ parser xác định; không suy đoán dữ liệu thiếu.",
        );
        commit((d) => {
          d.labelVersions.find((v) => v.id === label.id)!.extracted_fields =
            fields;
        });
        changeStep(
          "extraction",
          "complete",
          68,
          `${fields.length} trường thông tin có evidence.`,
        );
      }
      if (!fields.length)
        throw new Error("Chưa có structured extraction. Chạy lại từ OCR.");
      if (localOcrConfidence === null) {
        const observed = fields.filter(
          (field) => field.value && field.evidence.kind === "observed",
        );
        localOcrConfidence = observed.length
          ? observed.reduce((sum, field) => sum + field.confidence, 0) /
            observed.length
          : null;
        localOcrPages = label.normalized_files.length ||
          label.original_files.reduce((sum, file) => sum + file.page_count, 0);
      }
      changeStep("rules", "running", 75, "Chạy bộ quy tắc đang có hiệu lực.");
      const current = dataRef.current;
      const output = evaluateRules({
        product,
        fields,
        rules: current.rules,
        sources: current.sources,
        reviewId,
      });
      const executed = output.rules_executed.map((e) => ({
        rule_key: e.rule_key,
        version: e.version,
        source_versions: (
          current.rules.find(
            (rule) =>
              rule.rule_key === e.rule_key && rule.version === e.version,
          )?.source_citations ?? []
        )
          .map((id) => current.sources.find((s) => s.id === id))
          .filter((s): s is RegulatorySource => !!s)
          .map((s) => ({
            id: s.id,
            version: s.version,
            content_hash: s.content_hash,
          })),
      }));
      const decision = evaluateTriage({
        product,
        fields,
        findings: output.findings,
        rules: current.rules,
        sources: current.sources,
        rule_snapshot: executed,
        parser_quality: [],
        ocr_confidence: localOcrConfidence,
        ocr_pages: localOcrPages,
        expected_pages: label.original_files.reduce(
          (sum, file) => sum + file.page_count,
          0,
        ),
      });
      const completionWarnings = [
        ...new Set([...output.warnings, ...decision.customer_questions]),
      ];
      const routeStatus = {
        OUT_OF_SCOPE: "MANUAL_ESCALATION_REQUIRED",
        BLOCKED_REGULATORY_SOURCE: "SOURCE_UNAVAILABLE",
        EXPERT_REVIEW_REQUIRED: "MANUAL_ESCALATION_REQUIRED",
        NEEDS_CUSTOMER_INFORMATION: "WAITING_FOR_CUSTOMER",
        AUTO_SCREENED: "AI_REVIEW_READY",
      } as const;
      commit((d) => {
        d.findings = [
          ...d.findings.filter((f) => f.review_id !== reviewId),
          ...output.findings,
        ];
        const rv = d.reviews.find((r) => r.id === reviewId)!;
        rv.rule_snapshot = executed;
        rv.missing_information = completionWarnings;
        rv.triage_route = decision.triage_route;
        rv.overall_result = decision.overall_result;
        rv.report_status = decision.report_status;
        rv.expert_review_status = decision.expert_review_status;
        rv.triage_reasons = decision.reasons;
        rv.triage_risk_score = decision.risk_score;
        rv.triage_policy_version = decision.policy_version;
        rv.triage_evaluated_at = decision.evaluated_at;
        rv.status = routeStatus[decision.triage_route];
        rv.progress = 100;
        rv.updated_at = now();
        rv.error_message =
          decision.triage_route === "BLOCKED_REGULATORY_SOURCE"
            ? "Nguồn hoặc bộ quy tắc chưa đủ điều kiện phát hành sàng lọc tự động."
            : decision.triage_route === "OUT_OF_SCOPE"
              ? "Sản phẩm nằm ngoài phạm vi tự động hiện được hỗ trợ."
              : null;
        d.labelVersions.find((v) => v.id === label.id)!.status = "under_review";
        for (const fired of output.rules_executed.filter((e) => e.fired))
          log(
            d,
            "rule.fired",
            "review",
            reviewId,
            `${fired.rule_key} v${fired.version} phát hiện rủi ro · ${product.name}`,
            product.organization_id,
          );
        log(
          d,
          "review.processed",
          "review",
          reviewId,
          `Hoàn thành triage · ${product.name} · ${decision.triage_route}`,
          product.organization_id,
          {
            ruleset: executed,
            warnings: completionWarnings,
            triage_route: decision.triage_route,
            overall_result: decision.overall_result,
            reasons: decision.reasons,
            policy_version: decision.policy_version,
          },
        );
      });
      const notification =
        decision.triage_route === "AUTO_SCREENED"
          ? "Đã phân luồng sàng lọc tự động; artifact chưa được phát hành trong chế độ mẫu."
          : decision.triage_route === "NEEDS_CUSTOMER_INFORMATION"
            ? "Cần bổ sung thông tin trước khi tiếp tục."
            : decision.triage_route === "BLOCKED_REGULATORY_SOURCE"
              ? "Nguồn hoặc quy tắc chưa đủ điều kiện; đã chặn phát hành tự động."
              : decision.triage_route === "OUT_OF_SCOPE"
                ? "Sản phẩm ngoài phạm vi hỗ trợ tự động."
                : "Hồ sơ cần chuyên gia rà soát.";
      notify(notification, "info");
    } catch (e) {
      const message = errorMessage(e);
      commit((d) => {
        const rv = d.reviews.find((r) => r.id === reviewId)!;
        rv.status = "PROCESSING_FAILED";
        rv.error_message = message;
        rv.pipeline = rv.pipeline.map((s) =>
          s.status === "running" ? { ...s, status: "failed", message } : s,
        );
        log(
          d,
          "review.failed",
          "review",
          reviewId,
          message,
          product.organization_id,
        );
      });
      notify(message, "error");
    } finally {
      running.current.delete(reviewId);
    }
  };
  const submitReview = async (labelId: string) => {
    assertCan(actorRef.current, "products");
    const label = dataRef.current.labelVersions.find((v) => v.id === labelId);
    if (!label) throw new Error("Không tìm thấy phiên bản nhãn.");
    const product = productFor(label.product_id);
    const errors = validateIntake(product);
    if (Object.keys(errors).length)
      throw new Error(`Hồ sơ chưa đủ dữ liệu: ${Object.values(errors)[0]}`);
    const existing = dataRef.current.reviews.find(
      (r) => r.label_version_id === labelId,
    );
    if (existing) return existing;
    if (modeRef.current === "supabase")
      return remoteAction<Review>(`/label-versions/${labelId}/reviews`, {
        review_scope: "us_federal_food_labeling_mvp",
        formula_confirmed: true,
        claims_confirmed: true,
        idempotency_key: `${labelId}:us-labeling-v1`,
      });
    const review: Review = {
      id: uid(),
      organization_id: product.organization_id,
      product_id: product.id,
      label_version_id: labelId,
      review_scope: "us_federal_food_labeling_mvp",
      status: "PROCESSING",
      progress: 0,
      assigned_to: product.assigned_to,
      created_at: now(),
      updated_at: now(),
      due_at: new Date(Date.now() + 2 * 86400000).toISOString(),
      pipeline: Object.keys(PIPELINE_LABELS).map((stage) => ({
        stage: stage as PipelineStep["stage"],
        status: "pending",
        attempts: 0,
      })),
      error_message: null,
      idempotency_key: `${labelId}:us-labeling-v1`,
      approved_by: null,
      approved_at: null,
      approval_comment: null,
      dossier_snapshot: structuredClone(product),
      rule_snapshot: [],
      missing_information: [],
    };
    commit((d) => {
      d.reviews.unshift(review);
      log(
        d,
        "review.started",
        "review",
        review.id,
        `Bắt đầu kiểm tra · ${product.name} · nhãn v${label.version}`,
        product.organization_id,
      );
    });
    void runPipeline(review.id);
    return review;
  };
  const rerunReview = async (
    reviewId: string,
    from: PipelineStep["stage"] = "rules",
  ) => {
    assertCan(actorRef.current, "review");
    const r = reviewFor(reviewId);
    if (isSyntheticDemoReview(r))
      throw new Error(
        "Đây là review demo tĩnh: không chạy OCR, triage hoặc rules trên fixture.",
      );
    if (["COMPLETED", "APPROVED_WITH_NOTES", "ARCHIVED"].includes(r.status))
      throw new Error(
        "Review đã đóng. Hãy tải phiên bản nhãn mới để giữ lịch sử báo cáo.",
      );
    if (r.status === "PROCESSING" && !r.idempotency_key.startsWith("seed-"))
      throw new Error("Tác vụ đang chạy. Vui lòng chờ.");
    if (modeRef.current === "supabase") {
      await remoteAction(`/reviews/${reviewId}/retry`, { from_stage: from });
      return;
    }
    commit((d) => {
      log(
        d,
        "review.retried",
        "review",
        reviewId,
        `Chạy lại từ ${PIPELINE_LABELS[from]}; quyết định cũ không được dùng lại`,
        r.organization_id,
      );
    });
    void runPipeline(reviewId, from);
  };
  const editableReview = (r: Review) => {
    if (
      ["COMPLETED", "APPROVED_WITH_NOTES", "ARCHIVED", "PROCESSING"].includes(
        r.status,
      )
    )
      throw new Error(
        "Review này đang xử lý hoặc đã đóng; không thể chỉnh sửa finding.",
      );
  };
  const patchFinding = async (
    id: string,
    patch: Pick<Finding, "severity" | "status" | "reviewer_comment"> & {
      citation_ids?: string[];
    },
  ) => {
    assertCan(actorRef.current, "review");
    findingPatchSchema.parse(patch);
    const f = dataRef.current.findings.find((f) => f.id === id);
    if (!f) throw new Error("Finding không tồn tại.");
    const review = reviewFor(f.review_id);
    editableReview(review);
    if (
      patch.citation_ids?.some(
        (id) => !dataRef.current.sources.some((s) => s.id === id),
      )
    )
      throw new Error("Citation không nằm trong source registry.");
    if (modeRef.current === "supabase") {
      await remoteAction(`/findings/${id}`, patch, "PATCH");
      return;
    }
    commit((d) => {
      const finding = d.findings.find((f) => f.id === id)!;
      const old = structuredClone(finding);
      Object.assign(finding, patch, {
        reviewed_by: actorRef.current.id,
        reviewed_at: now(),
      });
      finding.citation_pending =
        !finding.citation_ids.length ||
        finding.citation_ids.some(
          (id) => !d.sources.some((s) => s.id === id && sourceIsCurrent(s)),
        );
      log(
        d,
        "finding.updated",
        "finding",
        id,
        `${finding.status === "dismissed" ? "Loại trừ" : "Cập nhật"}: ${finding.title}`,
        f.organization_id,
        { before: old, after: finding },
      );
    });
  };
  const addFinding = async (finding: Finding) => {
    assertCan(actorRef.current, "review");
    const review = reviewFor(finding.review_id);
    editableReview(review);
    if (
      !finding.title.trim() ||
      finding.description.trim().length < 10 ||
      !finding.evidence.length
    )
      throw new Error("Finding cần tiêu đề, mô tả và evidence.");
    if (
      finding.citation_ids.some(
        (id) => !dataRef.current.sources.some((s) => s.id === id),
      )
    )
      throw new Error("Citation không nằm trong registry.");
    if (modeRef.current === "supabase") {
      await remoteAction(`/reviews/${review.id}/findings`, finding);
      return;
    }
    commit((d) => {
      d.findings.push({
        ...finding,
        organization_id: review.organization_id,
        citation_pending:
          !finding.citation_ids.length ||
          finding.citation_ids.some(
            (id) => !d.sources.some((s) => s.id === id && sourceIsCurrent(s)),
          ),
      });
      log(
        d,
        "finding.created",
        "finding",
        finding.id,
        `Thêm finding thủ công: ${finding.title}`,
        review.organization_id,
      );
    });
  };
  const updateField = async (
    labelId: string,
    fieldId: string,
    value: string,
    reason: string,
  ) => {
    assertCan(actorRef.current, "review");
    if (reason.trim().length < 5)
      throw new Error("Nhập lý do thay đổi ít nhất 5 ký tự.");
    const label = dataRef.current.labelVersions.find((v) => v.id === labelId);
    if (!label) throw new Error("Không tìm thấy nhãn.");
    assertOrg(actorRef.current, label.organization_id);
    const review = dataRef.current.reviews.find(
      (r) => r.label_version_id === labelId,
    );
    if (review) editableReview(review);
    if (modeRef.current === "supabase") {
      await remoteAction(
        `/label-versions/${labelId}/fields/${fieldId}`,
        { value, reason },
        "PATCH",
      );
      return;
    }
    commit((d) => {
      const field = d.labelVersions
        .find((v) => v.id === labelId)!
        .extracted_fields.find((f) => f.id === fieldId);
      if (!field) throw new Error("Không có extracted field.");
      const before = field.value;
      field.value = value || null;
      field.manually_verified = true;
      field.confidence = 1;
      field.extraction_model = "human-verified";
      const rv = d.reviews.find((r) => r.label_version_id === labelId);
      if (rv) {
        rv.rule_snapshot = [];
        rv.missing_information = [
          ...(rv.missing_information ?? []),
          "Extracted value đã thay đổi; cần chạy lại rules trước khi duyệt báo cáo.",
        ];
      }
      log(
        d,
        "extraction.updated",
        "label_version",
        labelId,
        `Xác minh ${field.field}: ${reason}`,
        label.organization_id,
        { before, after: value, evidence_preserved: true },
      );
    });
  };
  const requestInformation = async (
    reviewId: string,
    message: string,
    docs: string[],
  ) => {
    assertCan(actorRef.current, "review");
    if (message.trim().length < 10)
      throw new Error("Nhập yêu cầu ít nhất 10 ký tự.");
    const review = reviewFor(reviewId);
    editableReview(review);
    if (modeRef.current === "supabase") {
      await remoteAction(`/reviews/${reviewId}/requests`, {
        message,
        requested_documents: docs,
      });
      return;
    }
    commit((d) => {
      d.requests.unshift({
        id: uid(),
        review_id: reviewId,
        organization_id: review.organization_id,
        message: message.trim(),
        requested_documents: docs,
        status: "open",
        created_by: actorRef.current.id,
        created_at: now(),
      });
      d.reviews.find((r) => r.id === reviewId)!.status = "WAITING_FOR_CUSTOMER";
      log(
        d,
        "information.requested",
        "review",
        reviewId,
        `Yêu cầu bổ sung: ${message}`,
        review.organization_id,
      );
    });
  };
  const resolveRequest = async (requestId: string) => {
    const request = dataRef.current.requests.find((r) => r.id === requestId);
    if (!request) throw new Error("Không tìm thấy yêu cầu.");
    assertOrg(actorRef.current, request.organization_id);
    assertCan(actorRef.current, "review");
    if (modeRef.current === "supabase") {
      await remoteAction(
        `/requests/${requestId}`,
        { status: "resolved" },
        "PATCH",
      );
      return;
    }
    commit((d) => {
      d.requests.find((r) => r.id === requestId)!.status = "resolved";
      if (
        !d.requests.some(
          (r) => r.review_id === request.review_id && r.status === "open",
        )
      )
        d.reviews.find((r) => r.id === request.review_id)!.status =
          "HUMAN_REVIEW";
      log(
        d,
        "information.resolved",
        "review",
        request.review_id,
        "Xác nhận đã nhận đủ dữ liệu bổ sung",
        request.organization_id,
      );
    });
  };
  const assignReview = async (reviewId: string) => {
    assertCan(actorRef.current, "review");
    const review = reviewFor(reviewId);
    if (
      ["COMPLETED", "APPROVED_WITH_NOTES", "ARCHIVED"].includes(review.status)
    )
      throw new Error("Review đã đóng.");
    if (modeRef.current === "supabase") {
      await remoteAction(`/reviews/${reviewId}/assign`, {
        reviewer_id: actorRef.current.id,
        reason: "Chuyên viên nhận phụ trách rà soát hồ sơ.",
      });
      return;
    }
    commit((d) => {
      d.reviews.find((r) => r.id === reviewId)!.assigned_to =
        actorRef.current.id;
      const product = d.products.find((p) => p.id === review.product_id);
      if (product) product.assigned_to = actorRef.current.id;
      log(
        d,
        "review.assigned",
        "review",
        reviewId,
        "Chuyên viên nhận phụ trách rà soát hồ sơ.",
        review.organization_id,
      );
    });
  };
  const transitionReview = async (
    reviewId: string,
    status: ReviewStatus,
    reason: string,
  ) => {
    const review = reviewFor(reviewId);
    if (reason.trim().length < 5)
      throw new Error("Cần lý do thay đổi trạng thái.");
    assertTransition(review.status, status, actorRef.current);
    if (
      status === "ARCHIVED" &&
      !["reviewer", "system_admin", "customer_admin"].includes(
        actorRef.current.role,
      )
    )
      throw new Error("Bạn không có quyền lưu trữ review.");
    if (
      [
        "PROCESSING",
        "AI_REVIEW_READY",
        "APPROVED_WITH_NOTES",
        "COMPLETED",
      ].includes(status)
    )
      throw new Error(
        "Trạng thái này phải đi qua pipeline hoặc phê duyệt báo cáo.",
      );
    if (modeRef.current === "supabase") {
      await remoteAction(`/reviews/${reviewId}`, { status, reason }, "PATCH");
      return;
    }
    commit((d) => {
      const current = d.reviews.find((r) => r.id === reviewId)!;
      current.status = status;
      if (status === "HUMAN_REVIEW" && current.expert_review_status === "NOT_REQUIRED")
        current.expert_review_status = "PENDING";
      log(
        d,
        "review.status_changed",
        "review",
        reviewId,
        reason,
        review.organization_id,
        { from: review.status, to: status },
      );
    });
  };
  const collaborationReviewFor = (reviewId: string) => {
    const review = dataRef.current.reviews.find((r) => r.id === reviewId);
    if (!review) throw new Error("Không tìm thấy review hoặc chưa được chia sẻ.");
    return review;
  };
  const requireDemoOrganizationAdmin = (organizationId: string) => {
    const current = actorRef.current;
    if (
      current.role !== "system_admin" &&
      (current.role !== "customer_admin" ||
        current.organization_id !== organizationId)
    )
      throw new Error("Thao tác này cần quản trị viên của tổ chức liên quan.");
  };
  const runDemoMockScan = async (reviewId: string) => {
    if (modeRef.current !== "demo")
      throw new Error("Mock Scan chỉ khả dụng trong Demo cục bộ.");
    const review = collaborationReviewFor(reviewId);
    const label = dataRef.current.labelVersions.find(
      (version) => version.id === review.label_version_id,
    );
    if (!label) throw new Error("Không tìm thấy phiên bản nhãn.");
    const record = createDemoMockScanRecord(review, label, now());
    replaceDemoMockScans({
      ...demoMockScansRef.current,
      [label.id]: record,
    });
    return record;
  };
  const inviteReviewParticipant = async (
    reviewId: string,
    organizationContactEmail: string,
    partyRole: "commercial_importer" | "fsvp_importer",
  ) => {
    if (modeRef.current === "supabase") {
      await remoteAction(`/reviews/${reviewId}/participants`, {
        organization_contact_email: organizationContactEmail,
        party_role: partyRole,
      });
      return;
    }
    const review = collaborationReviewFor(reviewId);
    requireDemoOrganizationAdmin(review.organization_id);
    const email = organizationContactEmail.trim().toLowerCase();
    const emailParts = email.split("@");
    if (
      email.length > 254 ||
      email.includes(" ") ||
      emailParts.length !== 2 ||
      !emailParts[0] ||
      !emailParts[1]?.includes(".")
    )
      throw new Error("Nhập email liên hệ hợp lệ của tổ chức importer.");
    const matches = dataRef.current.organizations.filter(
      (organization) =>
        organization.status === "active" &&
        organization.contact_email.trim().toLowerCase() === email,
    );
    if (matches.length !== 1)
      throw new Error(
        "Không tìm thấy duy nhất một tổ chức đang hoạt động với email đã nhập.",
      );
    const target = matches[0];
    if (target.id === review.organization_id)
      throw new Error("Importer phải là một tổ chức khác với chủ nhãn.");
    const prior = (dataRef.current.reviewParticipants ?? []).find(
      (participant) =>
        participant.review_id === reviewId &&
        participant.organization_id === target.id &&
        participant.party_role === partyRole,
    );
    if (prior && prior.status !== "removed")
      throw new Error("Tổ chức này đã được mời hoặc đang tham gia review.");
    const timestamp = now();
    const participant: ReviewParticipant = prior
      ? {
          ...prior,
          organization_name_snapshot: target.name,
          status: "invited",
          invited_by: actorRef.current.id,
          invited_at: timestamp,
          activated_by: null,
          activated_at: null,
          fsvp_attested_by: null,
          fsvp_attested_at: null,
          fsvp_attestation_note: null,
        }
      : {
          id: uid(),
          review_id: reviewId,
          organization_id: target.id,
          organization_name_snapshot: target.name,
          party_role: partyRole,
          status: "invited",
          invited_by: actorRef.current.id,
          invited_at: timestamp,
          activated_by: null,
          activated_at: null,
          fsvp_attested_by: null,
          fsvp_attested_at: null,
          fsvp_attestation_note: null,
          created_at: timestamp,
        };
    commit((d) => {
      d.reviewParticipants ??= [];
      const existingIndex = d.reviewParticipants.findIndex(
        (entry) => entry.id === participant.id,
      );
      if (existingIndex >= 0) d.reviewParticipants[existingIndex] = participant;
      else d.reviewParticipants.push(participant);
      log(
        d,
        "review.participant_invited",
        "review",
        reviewId,
        `Đã mời ${target.name} tham gia review với vai trò ${partyRole}.`,
        review.organization_id,
        { participant_id: participant.id, party_role: partyRole },
      );
    });
  };
  const acceptReviewParticipant = async (
    participantId: string,
    attestsFsvp = false,
    attestationNote = "",
  ) => {
    if (modeRef.current === "supabase") {
      await remoteAction(`/review-participants/${participantId}/accept`, {
        attests_fsvp: attestsFsvp,
        attestation_note: attestationNote,
      });
      return;
    }
    const participant = (dataRef.current.reviewParticipants ?? []).find(
      (entry) => entry.id === participantId,
    );
    if (!participant || participant.status !== "invited")
      throw new Error("Lời mời không còn ở trạng thái chờ chấp nhận.");
    requireDemoOrganizationAdmin(participant.organization_id);
    const note = attestationNote.trim();
    if (participant.party_role === "fsvp_importer") {
      if (!attestsFsvp || note.length < 10 || note.length > 5000)
        throw new Error(
          "Cần xác nhận rõ tư cách FSVP importer và nhập căn cứ ít nhất 10 ký tự.",
        );
    } else if (attestsFsvp || note) {
      throw new Error(
        "Vai trò commercial importer không tự xác nhận tư cách FSVP.",
      );
    }
    const review = collaborationReviewFor(participant.review_id);
    const timestamp = now();
    commit((d) => {
      const current = d.reviewParticipants!.find(
        (entry) => entry.id === participantId,
      )!;
      Object.assign(current, {
        status: "active",
        activated_by: actorRef.current.id,
        activated_at: timestamp,
        fsvp_attested_by:
          current.party_role === "fsvp_importer" ? actorRef.current.id : null,
        fsvp_attested_at:
          current.party_role === "fsvp_importer" ? timestamp : null,
        fsvp_attestation_note:
          current.party_role === "fsvp_importer" ? note : null,
      });
      log(
        d,
        "review.participant_accepted",
        "review",
        review.id,
        "Đã chấp nhận lời mời tham gia review.",
        review.organization_id,
        { participant_id: participantId, party_role: current.party_role },
      );
    });
  };
  const removeReviewParticipant = async (
    participantId: string,
    reason: string,
  ) => {
    if (modeRef.current === "supabase") {
      await remoteAction(
        `/review-participants/${participantId}`,
        { reason },
        "DELETE",
      );
      return;
    }
    const participant = (dataRef.current.reviewParticipants ?? []).find(
      (entry) => entry.id === participantId,
    );
    if (!participant || participant.party_role === "label_owner")
      throw new Error("Không thể xóa participant chủ sở hữu nhãn.");
    const review = collaborationReviewFor(participant.review_id);
    requireDemoOrganizationAdmin(review.organization_id);
    const note = reason.trim();
    if (note.length < 5 || note.length > 5000)
      throw new Error("Nhập lý do thu hồi quyền từ 5 đến 5.000 ký tự.");
    if (participant.status === "removed") return;
    commit((d) => {
      d.reviewParticipants!.find((entry) => entry.id === participantId)!.status =
        "removed";
      log(
        d,
        "review.participant_removed",
        "review",
        review.id,
        note,
        review.organization_id,
        { participant_id: participantId, party_role: participant.party_role },
      );
    });
  };
  const shareReview = async (reviewId: string, comment: string) => {
    if (modeRef.current === "supabase") {
      await remoteAction(`/reviews/${reviewId}/share`, { comment });
      return;
    }
    const review = collaborationReviewFor(reviewId);
    requireDemoOrganizationAdmin(review.organization_id);
    const note = comment.trim();
    if (note.length < 5 || note.length > 5000)
      throw new Error("Nêu lý do chia sẻ từ 5 đến 5.000 ký tự.");
    if (
      !["AI_REVIEW_READY", "HUMAN_REVIEW", "REVISION_REQUIRED"].includes(
        review.status,
      )
    )
      throw new Error("Phân tích cần sẵn sàng trước khi chia sẻ review.");
    if ((review.collaboration_status ?? "not_shared") !== "not_shared")
      throw new Error(
        "Review đã được chia sẻ; cần tạo chu kỳ review mới cho phiên bản nhãn khác.",
      );
    const commercial = (dataRef.current.reviewParticipants ?? []).find(
      (participant) =>
        participant.review_id === reviewId &&
        participant.party_role === "commercial_importer" &&
        participant.status === "active",
    );
    if (!commercial)
      throw new Error("Cần có một commercial importer đã chấp nhận lời mời.");
    const label = dataRef.current.labelVersions.find(
      (version) => version.id === review.label_version_id,
    );
    if (!label) throw new Error("Không tìm thấy phiên bản nhãn.");
    const bundleHash = await localLabelBundleSha256(label, {
      demoMockScannedFileIds: demoMockScannedFileIdsFor(
        review,
        label,
        demoMockScansRef.current,
      ),
    });
    const owner = (dataRef.current.reviewParticipants ?? []).find(
      (participant) =>
        participant.review_id === reviewId &&
        participant.party_role === "label_owner" &&
        participant.organization_id === review.organization_id &&
        participant.status === "active",
    );
    if (
      !owner ||
      !(dataRef.current.partyDecisions ?? []).some(
        (decision) =>
          decision.review_id === reviewId &&
          decision.label_version_id === review.label_version_id &&
          decision.participant_id === owner.id &&
          decision.decision === "accepted" &&
          decision.label_bundle_sha256 === bundleHash,
      )
    )
      throw new Error("Chủ nhãn phải xác nhận đúng phiên bản trước khi chia sẻ.");
    commit((d) => {
      d.reviews.find((entry) => entry.id === reviewId)!.collaboration_status =
        "awaiting_importer";
      d.reviews.find((entry) => entry.id === reviewId)!.updated_at = now();
      log(
        d,
        "review.shared_with_importer",
        "review",
        reviewId,
        note,
        review.organization_id,
        {
          label_version_id: review.label_version_id,
          label_bundle_sha256: bundleHash,
        },
      );
    });
  };
  const recordPartyDecision = async (
    reviewId: string,
    partyRole: "label_owner" | "commercial_importer",
    decisionType: ReviewPartyDecisionType,
    comment: string,
    proposedChanges: ReviewPartyDecisionEntry["proposed_changes"] = [],
  ) => {
    if (modeRef.current === "supabase") {
      await remoteAction(`/reviews/${reviewId}/party-decisions`, {
        party_role: partyRole,
        decision: decisionType,
        comment,
        proposed_changes: proposedChanges,
      });
      return;
    }
    const review = collaborationReviewFor(reviewId);
    const note = comment.trim();
    if (note.length < 5 || note.length > 10000)
      throw new Error("Nhập lý do từ 5 đến 10.000 ký tự.");
    if (proposedChanges.length > 50)
      throw new Error("Tối đa 50 chỉnh sửa có chú thích trong một đề xuất.");
    if (decisionType === "proposed_edit") {
      if (
        !proposedChanges.length ||
        proposedChanges.some(
          (change) =>
            !change.field.trim() ||
            change.field.trim().length > 200 ||
            !change.proposed_value.trim() ||
            change.proposed_value.trim().length > 5000 ||
            change.reason.trim().length < 5 ||
            change.reason.trim().length > 2000 ||
            (change.current_value?.length ?? 0) > 5000,
        )
      )
        throw new Error("Đề xuất cần chú thích hợp lệ cho từng trường.");
    } else if (proposedChanges.length) {
      throw new Error("Chỉ đề xuất chỉnh sửa mới chứa các thay đổi có chú thích.");
    }
    if (
      !["AI_REVIEW_READY", "HUMAN_REVIEW", "REVISION_REQUIRED"].includes(
        review.status,
      )
    )
      throw new Error("Review chưa sẵn sàng ghi nhận quyết định của các bên.");
    const actorOrganization = actorRef.current.organization_id;
    if (!actorOrganization)
      throw new Error("Cần tài khoản thành viên của tổ chức tham gia review.");
    const participant = (dataRef.current.reviewParticipants ?? []).find(
      (entry) =>
        entry.review_id === reviewId &&
        entry.party_role === partyRole &&
        entry.organization_id === actorOrganization &&
        entry.status === "active",
    );
    if (!participant)
      throw new Error("Tài khoản này chưa tham gia review với vai trò đó.");
    if (
      partyRole === "label_owner" &&
      (participant.organization_id !== review.organization_id ||
        decisionType !== "accepted" ||
        (review.collaboration_status ?? "not_shared") !== "not_shared")
    )
      throw new Error("Chỉ chủ nhãn có thể xác nhận trước khi chia sẻ review.");
    if (partyRole === "commercial_importer") {
      const collaborationStatus = review.collaboration_status ?? "not_shared";
      if (!["awaiting_importer", "changes_requested"].includes(collaborationStatus))
        throw new Error("Chủ nhãn chưa chia sẻ phiên bản này với importer.");
      if (decisionType === "accepted") {
        requireDemoOrganizationAdmin(participant.organization_id);
        if (collaborationStatus !== "awaiting_importer")
          throw new Error("Yêu cầu chỉnh sửa cần phiên bản nhãn mới trước khi xác nhận.");
      }
    }
    if (partyRole === "label_owner" && decisionType !== "accepted")
      throw new Error("Yêu cầu thay đổi hoặc đề xuất chỉ dành cho commercial importer.");
    const label = dataRef.current.labelVersions.find(
      (version) => version.id === review.label_version_id,
    );
    if (!label) throw new Error("Không tìm thấy phiên bản nhãn.");
    const bundleHash = await localLabelBundleSha256(label, {
      demoMockScannedFileIds: demoMockScannedFileIdsFor(
        review,
        label,
        demoMockScansRef.current,
      ),
    });
    if (partyRole === "commercial_importer" && decisionType === "accepted") {
      const owner = (dataRef.current.reviewParticipants ?? []).find(
        (entry) =>
          entry.review_id === reviewId &&
          entry.party_role === "label_owner" &&
          entry.organization_id === review.organization_id &&
          entry.status === "active",
      );
      if (
        !owner ||
        !(dataRef.current.partyDecisions ?? []).some(
          (entry) =>
            entry.review_id === reviewId &&
            entry.label_version_id === review.label_version_id &&
            entry.participant_id === owner.id &&
            entry.decision === "accepted" &&
            entry.label_bundle_sha256 === bundleHash,
        )
      )
        throw new Error("Chủ nhãn chưa xác nhận đúng phiên bản này.");
    }
    const row: ReviewPartyDecisionEntry = {
      id: uid(),
      review_id: reviewId,
      label_version_id: review.label_version_id,
      participant_id: participant.id,
      party_role: partyRole,
      decision: decisionType,
      comment: note,
      proposed_changes: proposedChanges,
      label_bundle_sha256: bundleHash,
      actor_id: actorRef.current.id,
      actor_name_snapshot: actorRef.current.name,
      created_at: now(),
    };
    commit((d) => {
      d.partyDecisions ??= [];
      d.partyDecisions.push(row);
      if (partyRole === "commercial_importer")
        d.reviews.find((entry) => entry.id === reviewId)!.collaboration_status =
          decisionType === "accepted" ? "mutually_accepted" : "changes_requested";
      log(
        d,
        "review.party_decision_recorded",
        "review",
        reviewId,
        "Đã ghi nhận quyết định của một bên cho phiên bản nhãn hiện tại.",
        review.organization_id,
        {
          decision_id: row.id,
          participant_id: participant.id,
          party_role: partyRole,
          decision: decisionType,
          label_version_id: review.label_version_id,
          label_bundle_sha256: bundleHash,
        },
      );
    });
  };
  const approveReport = async (reviewId: string, comment: string) => {
    const review = reviewFor(reviewId);
    if (isSyntheticDemoReview(review))
      throw new Error(
        "Hồ sơ demo này chỉ dành cho rà soát độc lập; không thể ký duyệt hoặc tạo báo cáo.",
      );
    if (modeRef.current === "supabase")
      return remoteAction<Report>(`/reviews/${reviewId}/reports`, {
        comment,
        disclaimer_confirmed: true,
      });
    const snapshot = buildReportSnapshot(
      dataRef.current,
      review,
      actorRef.current,
      comment,
      true,
    );
    const year = new Date().getFullYear();
    const report: Report = {
      id: uid(),
      review_id: reviewId,
      organization_id: review.organization_id,
      product_id: review.product_id,
      label_version_id: review.label_version_id,
      report_number: `VLR-${year}-${String(dataRef.current.reports.length + 1).padStart(4, "0")}`,
      snapshot,
      created_at: now(),
      pdf_path: null,
      json_path: null,
    };
    commit((d) => {
      d.reports.unshift(report);
      const r = d.reviews.find((r) => r.id === reviewId)!;
      r.status = "COMPLETED";
      r.overall_result = snapshot.result;
      r.report_status = "FINAL_REPORT_ISSUED";
      r.expert_review_status = "EXPERT_REVIEWED";
      r.approved_by = actorRef.current.id;
      r.approved_at = snapshot.reviewer.approved_at;
      r.approval_comment = comment;
      d.labelVersions.find((v) => v.id === review.label_version_id)!.status =
        "reviewed";
      log(
        d,
        "report.approved",
        "report",
        report.id,
        `Phê duyệt nội dung báo cáo · ${snapshot.product.name}`,
        review.organization_id,
        { result: snapshot.result, snapshot_immutable: true },
      );
    });
    return report;
  };
  const downloadReport = async (reportId: string, format: "pdf" | "json") => {
    const report = dataRef.current.reports.find((r) => r.id === reportId);
    if (!report) throw new Error("Báo cáo không tồn tại.");
    assertOrg(actorRef.current, report.organization_id);
    if (modeRef.current === "supabase") {
      const result = await api<{ url: string }>(
        `/reports/${reportId}/download?format=${format}`,
      );
      const response = await fetch(result.url);
      if (!response.ok) throw new Error("Không tải được báo cáo.");
      downloadBlob(await response.blob(), `${report.report_number}.${format}`);
      await loadRemote();
      return;
    }
    if (format === "json")
      downloadJson(report.snapshot, `${report.report_number}.json`);
    else {
      const { browserReportPdf } = await import("@/lib/pdf-report");
      const pdf = await browserReportPdf(report.snapshot);
      downloadBlob(
        new Blob([new Uint8Array(pdf)], { type: "application/pdf" }),
        `${report.report_number}.pdf`,
      );
    }
    commit((d) =>
      log(
        d,
        "report.downloaded",
        "report",
        reportId,
        `Tải ${format.toUpperCase()} · ${report.report_number}`,
        report.organization_id,
      ),
    );
  };
  const logFileAccess = async (
    label: LabelVersion,
    file: LabelFile,
    action: "view" | "download" = "view",
  ) => {
    assertOrg(actorRef.current, label.organization_id);
    if (modeRef.current === "supabase") {
      await api(`/files/${file.id}/access`, {
        method: "POST",
        body: JSON.stringify({ action }),
      });
      return;
    }
    commit((d) =>
      log(
        d,
        `file.${action === "view" ? "viewed" : "downloaded"}`,
        "label_version",
        label.id,
        `${action === "view" ? "Xem" : "Tải"} file ${file.name}`,
        label.organization_id,
        { file_id: file.id },
      ),
    );
  };
  const saveOrganization = async (organization: Organization) => {
    if (!["system_admin", "customer_admin"].includes(actorRef.current.role))
      throw new Error(
        "Chỉ quản trị tổ chức hoặc hệ thống được tạo / sửa khách hàng.",
      );
    const exists = dataRef.current.organizations.some(
      (o) => o.id === organization.id,
    );
    if (actorRef.current.role === "customer_admin" && exists)
      assertOrg(actorRef.current, organization.id);
    if (
      actorRef.current.role === "customer_admin" &&
      !exists &&
      actorRef.current.organization_id
    )
      throw new Error("Quản trị khách hàng không được tạo tổ chức khác.");
    if (
      !organization.name.trim() ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(organization.contact_email)
    )
      throw new Error("Cần tên tổ chức và email liên hệ hợp lệ.");
    if (modeRef.current === "supabase") {
      await remoteAction("/organizations", organization);
      return;
    }
    commit((d) => {
      const i = d.organizations.findIndex((o) => o.id === organization.id);
      if (i < 0) d.organizations.unshift(organization);
      else d.organizations[i] = organization;
      log(
        d,
        exists ? "organization.updated" : "organization.created",
        "organization",
        organization.id,
        `${exists ? "Cập nhật" : "Tạo"} khách hàng ${organization.name}`,
        organization.id,
      );
    });
  };
  const inviteMember = async (
    orgId: string,
    name: string,
    email: string,
    role: Role,
  ) => {
    assertCan(actorRef.current, "members");
    assertOrg(actorRef.current, orgId);
    if (!["customer_admin", "customer_contributor"].includes(role))
      throw new Error(
        "Không thể cấp quyền nhân viên Vexim qua lời mời tổ chức.",
      );
    if (!name.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      throw new Error("Nhập tên và email hợp lệ.");
    if (modeRef.current === "supabase") {
      await remoteAction("/members/invite", {
        organization_id: orgId,
        name,
        email,
        role,
      });
      return;
    }
    if (
      dataRef.current.members.some(
        (m) => m.organization_id === orgId && m.email === email,
      )
    )
      throw new Error("Email đã có trong tổ chức.");
    commit((d) => {
      d.members.push({
        id: uid(),
        organization_id: orgId,
        name,
        email,
        role,
        status: "invited",
      });
      log(
        d,
        "member.invited",
        "organization",
        orgId,
        `Lời mời mẫu: ${email} · không gửi email thật`,
        orgId,
      );
    });
  };
  const setMemberStatus = async (id: string, status: Member["status"]) => {
    assertCan(actorRef.current, "members");
    const member = dataRef.current.members.find((m) => m.id === id);
    if (!member) throw new Error("Không tìm thấy thành viên.");
    assertOrg(actorRef.current, member.organization_id);
    if (id === actorRef.current.id)
      throw new Error("Không thể tự khóa tài khoản.");
    if (modeRef.current === "supabase") {
      await remoteAction(`/members/${id}`, { status }, "PATCH");
      return;
    }
    commit((d) => {
      d.members.find((m) => m.id === id)!.status = status;
      log(
        d,
        "member.status_changed",
        "member",
        id,
        `${status === "locked" ? "Khóa" : "Mở khóa"} ${member.name}`,
        member.organization_id,
      );
    });
  };
  const saveSource = async (source: RegulatorySource) => {
    assertCan(actorRef.current, "regulatory");
    if (source.content_excerpt.trim().length < 80 || !source.retrieved_at)
      throw new Error(
        "Nguồn cần bản chụp nội dung tối thiểu 80 ký tự và thời điểm truy xuất.",
      );
    const url = new URL(source.canonical_url);
    if (
      url.protocol !== "https:" ||
      ![
        "www.ecfr.gov",
        "www.fda.gov",
        "www.govinfo.gov",
        "uscode.house.gov",
        "www.ams.usda.gov",
        "www.cbp.gov",
        "www.federalregister.gov",
      ].includes(url.hostname)
    )
      throw new Error(
        "Nguồn phải là đường dẫn HTTPS thuộc cơ quan chính thức trong allowlist.",
      );
    const existing = dataRef.current.sources.find((s) => s.id === source.id);
    const draft = {
      ...source,
      status: "DRAFT" as const,
      version: (existing?.version ?? 0) + 1,
      content_hash: await sha256(source.content_excerpt),
      created_by: actorRef.current.id,
      approved_by: null,
      approved_at: null,
      updated_at: now(),
    };
    if (modeRef.current === "supabase") {
      await remoteAction("/regulatory/sources", draft);
      return;
    }
    commit((d) => {
      const i = d.sources.findIndex((s) => s.id === draft.id);
      if (i < 0) d.sources.push(draft);
      else d.sources[i] = draft;
      log(
        d,
        "source.updated",
        "source",
        draft.id,
        `Tạo draft nguồn ${draft.citation} v${draft.version}`,
        null,
        { before: existing, after: draft, created_by: actorRef.current.id },
      );
    });
  };
  const approveSource = async (id: string) => {
    assertCan(actorRef.current, "regulatory");
    const source = dataRef.current.sources.find((s) => s.id === id);
    if (
      !source ||
      source.status !== "DRAFT" ||
      !source.content_hash ||
      source.content_excerpt.length < 80 ||
      !source.retrieved_at
    )
      throw new Error(
        "Nguồn chưa có snapshot hợp lệ hoặc không ở trạng thái DRAFT.",
      );
    const latestEdit = dataRef.current.audit.find(
      (a) => a.action === "source.updated" && a.entity_id === id,
    );
    if (latestEdit?.actor_id === actorRef.current.id)
      throw new Error(
        "Người tạo draft không được tự phê duyệt. Dùng một Regulatory Admin khác; trong demo có persona người duyệt tại Cài đặt.",
      );
    if (
      source.effective_to &&
      source.effective_to < new Date().toISOString().slice(0, 10)
    )
      throw new Error("Không thể phê duyệt nguồn đã hết hiệu lực.");
    if (modeRef.current === "supabase") {
      await remoteAction(`/regulatory/sources/${id}/approve`, {});
      return;
    }
    commit((d) => {
      const s = d.sources.find((s) => s.id === id)!;
      s.status = "CURRENT";
      s.approved_by = actorRef.current.id;
      s.approved_at = now();
      log(
        d,
        "source.approved",
        "source",
        id,
        `Phê duyệt nguồn ${s.citation} v${s.version}`,
        null,
        { hash: s.content_hash },
      );
    });
  };
  const saveRule = async (rule: ComplianceRule) => {
    assertCan(actorRef.current, "regulatory");
    if (
      !rule.name.trim() ||
      !rule.source_citations.length ||
      rule.source_citations.some(
        (id) => !dataRef.current.sources.some((s) => s.id === id),
      )
    )
      throw new Error("Quy tắc cần tên và citation trong source registry.");
    const existing = dataRef.current.rules.find((r) => r.id === rule.id);
    const draft = {
      ...rule,
      id: existing && existing.status !== "DRAFT" ? uid() : rule.id,
      version:
        existing && existing.status !== "DRAFT"
          ? Math.max(
              ...dataRef.current.rules
                .filter((r) => r.rule_key === rule.rule_key)
                .map((r) => r.version),
            ) + 1
          : rule.version,
      status: "DRAFT" as const,
      test_status: "pending" as const,
      created_by: actorRef.current.id,
      approved_by: null,
      updated_at: now(),
    };
    if (modeRef.current === "supabase") {
      await remoteAction("/regulatory/rules", draft);
      return;
    }
    commit((d) => {
      const i = d.rules.findIndex((r) => r.id === draft.id);
      if (i < 0) d.rules.push(draft);
      else d.rules[i] = draft;
      log(
        d,
        "rule.updated",
        "rule",
        draft.id,
        `Tạo draft ${draft.rule_key} v${draft.version}`,
        null,
        { before: existing, after: draft },
      );
    });
  };
  const testRule = async (id: string) => {
    assertCan(actorRef.current, "regulatory");
    const rule = dataRef.current.rules.find((r) => r.id === id);
    if (!rule) throw new Error("Quy tắc không tồn tại.");
    if (modeRef.current === "supabase")
      return remoteAction<RegressionResult[]>(
        `/regulatory/rules/${id}/test`,
        {},
      );
    const results = runRuleRegression([rule], dataRef.current.sources);
    const passed = results.every((r) => r.passed);
    commit((d) => {
      const candidate = d.rules.find((r) => r.id === id)!;
      candidate.test_status = passed ? "passed" : "failed";
      if (!passed && candidate.status === "ACTIVE")
        candidate.status = "SUPERSEDED";
      log(
        d,
        "rule.tested",
        "rule",
        id,
        `Regression fixtures: ${results.filter((r) => r.passed).length}/${results.length} passed`,
        null,
        { results },
      );
    });
    return results;
  };
  const approveRule = async (id: string) => {
    assertCan(actorRef.current, "regulatory");
    const rule = dataRef.current.rules.find((r) => r.id === id);
    if (!rule || rule.status !== "DRAFT" || rule.test_status !== "passed")
      throw new Error(
        "Quy tắc cần ở trạng thái DRAFT và đã vượt qua regression test.",
      );
    if (rule.created_by === actorRef.current.id)
      throw new Error(
        "Người tạo rule không được tự phê duyệt. Cần Regulatory Admin thứ hai.",
      );
    if (
      rule.source_citations.some(
        (id) =>
          !dataRef.current.sources.some(
            (s) => s.id === id && sourceIsCurrent(s),
          ),
      )
    )
      throw new Error(
        "Citation cần trỏ tới nguồn hiện hành đã được phê duyệt.",
      );
    if (modeRef.current === "supabase") {
      await remoteAction(`/regulatory/rules/${id}/approve`, {});
      return;
    }
    commit((d) => {
      d.rules
        .filter((r) => r.rule_key === rule.rule_key && r.status === "ACTIVE")
        .forEach((r) => {
          r.status = "SUPERSEDED";
        });
      const next = d.rules.find((r) => r.id === id)!;
      next.status = "ACTIVE";
      next.source_snapshot = next.source_citations
        .map((id) => d.sources.find((s) => s.id === id)!)
        .map((s) => ({
          id: s.id,
          version: s.version,
          content_hash: s.content_hash,
        }));
      next.approved_by = actorRef.current.id;
      next.effective_from =
        next.effective_from ?? new Date().toISOString().slice(0, 10);
      log(
        d,
        "rule.approved",
        "rule",
        id,
        `Kích hoạt ${next.rule_key} v${next.version}; giữ nguyên lịch sử phiên bản`,
        null,
      );
    });
  };

  const visible = actor.role.startsWith("customer")
    ? (() => {
        const sharedReviewIds = new Set(
          (rawData.reviewParticipants ?? [])
            .filter(
              (participant) =>
                participant.organization_id === actor.organization_id &&
                participant.status === "active" &&
                participant.party_role !== "label_owner",
            )
            .map((participant) => participant.review_id)
            .filter((reviewId) => {
              const review = rawData.reviews.find((r) => r.id === reviewId);
              return (
                !!review &&
                (review.collaboration_status ?? "not_shared") !== "not_shared"
              );
            }),
        );
        const reviews = rawData.reviews.filter(
          (r) =>
            canAccessOrg(actor, r.organization_id) || sharedReviewIds.has(r.id),
        );
        const visibleReviewIds = new Set(reviews.map((r) => r.id));
        const visibleProductIds = new Set(reviews.map((r) => r.product_id));
        const visibleLabelVersionIds = new Set(
          reviews.map((r) => r.label_version_id),
        );
        const findings = rawData.findings.filter((finding) =>
          visibleReviewIds.has(finding.review_id),
        );
        return {
          ...rawData,
          staff: [],
          organizations: rawData.organizations.filter((o) =>
            canAccessOrg(actor, o.id),
          ),
          members: rawData.members.filter((m) =>
            canAccessOrg(actor, m.organization_id),
          ),
          products: rawData.products.filter(
            (p) =>
              canAccessOrg(actor, p.organization_id) ||
              visibleProductIds.has(p.id),
          ),
          labelVersions: rawData.labelVersions.filter(
            (v) =>
              canAccessOrg(actor, v.organization_id) ||
              visibleLabelVersionIds.has(v.id),
          ),
          reviews,
          findings,
          requests: rawData.requests.filter((request) =>
            visibleReviewIds.has(request.review_id),
          ),
          reports: rawData.reports.filter((report) =>
            visibleReviewIds.has(report.review_id),
          ),
          reviewParticipants: (rawData.reviewParticipants ?? []).filter(
            (participant) =>
              canAccessOrg(actor, participant.organization_id) ||
              visibleReviewIds.has(participant.review_id),
          ),
          partyDecisions: (rawData.partyDecisions ?? []).filter((decision) =>
            visibleReviewIds.has(decision.review_id),
          ),
          preScreeningReports: (rawData.preScreeningReports ?? []).filter(
            (report) => visibleReviewIds.has(report.review_id),
          ),
          audit: rawData.audit.filter(
            (a) => a.organization_id && canAccessOrg(actor, a.organization_id),
          ),
          sources: rawData.sources.filter((source) =>
            findings.some((finding) => finding.citation_ids.includes(source.id)),
          ),
          rules: [],
        };
      })()
    : actor.role === "regulatory_admin"
      ? {
          ...rawData,
          organizations: [],
          members: [],
          products: [],
          labelVersions: [],
          reviews: [],
          findings: [],
          requests: [],
          reports: [],
          audit: rawData.audit.filter((a) => a.organization_id === null),
        }
      : rawData;
  return (
    <AppContext.Provider
      value={{
        data: visible,
        actor,
        mode,
        demoMockScans,
        loading,
        authenticated,
        error,
        toasts,
        notify,
        dismissToast: (id) => setToasts((t) => t.filter((x) => x.id !== id)),
        refresh,
        enterDemo,
        signOut,
        setDemoRole,
        resetDemo,
        runDemoMockScan,
        saveProduct,
        uploadVersion,
        submitReview,
        rerunReview,
        patchFinding,
        addFinding,
        updateField,
        requestInformation,
        resolveRequest,
        assignReview,
        transitionReview,
        inviteReviewParticipant,
        acceptReviewParticipant,
        removeReviewParticipant,
        shareReview,
        recordPartyDecision,
        approveReport,
        downloadReport,
        getFileBlob,
        logFileAccess,
        saveOrganization,
        inviteMember,
        setMemberStatus,
        saveSource,
        approveSource,
        saveRule,
        testRule,
        approveRule,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}
