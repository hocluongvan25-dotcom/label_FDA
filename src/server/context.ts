import {
  createClient,
  type SupabaseClient,
  type User,
} from "@supabase/supabase-js";
import type {
  Actor,
  AppData,
  ComplianceRule,
  CustomerRequest,
  ExtractedField,
  Finding,
  LabelFile,
  LabelVersion,
  Organization,
  PipelineDiagnostics,
  Product,
  RegulatorySource,
  Report,
  Review,
  ReviewJob,
  AuditEntry,
} from "@/lib/types";
import { sourceIsCurrent } from "@/lib/utils";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export interface ServerContext {
  db: SupabaseClient;
  user: User;
  actor: Actor;
}
export function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key)
    throw new HttpError(
      503,
      "Chưa cấu hình Supabase service-role key cho server / worker. Không đưa khóa này vào client hoặc chat.",
    );
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
export async function authenticate(request: Request): Promise<ServerContext> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key)
    throw new HttpError(
      503,
      "Chưa cấu hình Supabase. Chế độ dữ liệu mẫu hoạt động riêng trên trình duyệt.",
    );
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ") || authorization.length > 10000)
    throw new HttpError(401, "Vui lòng đăng nhập.");
  const db = createClient(url, key, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const {
    data: { user },
    error,
  } = await db.auth.getUser(authorization.slice(7));
  if (error || !user)
    throw new HttpError(401, "Phiên đăng nhập không hợp lệ hoặc đã hết hạn.");
  const { data: profile, error: profileError } = await db
    .from("profiles")
    .select("id,full_name,email,staff_role,active")
    .eq("id", user.id)
    .maybeSingle();
  if (profileError || !profile)
    throw new HttpError(
      503,
      "Không tìm thấy profile. Vui lòng chạy migration Supabase.",
    );
  if (!profile.active)
    throw new HttpError(
      403,
      "Tài khoản đã bị khóa. Liên hệ quản trị hệ thống.",
    );
  await rpc(db, "vexim_accept_memberships", {});
  const { data: members, error: memberError } = await db
    .from("organization_members")
    .select("organization_id,role,status")
    .eq("user_id", user.id)
    .eq("status", "active")
    .order("created_at");
  if (memberError) throw dbError(memberError);
  const member = members?.[0];
  return {
    db,
    user,
    actor: {
      id: user.id,
      name: profile.full_name || user.email?.split("@")[0] || "Người dùng",
      email: user.email ?? profile.email,
      role: profile.staff_role ?? member?.role ?? "customer_contributor",
      organization_id: member?.organization_id ?? null,
    },
  };
}
export function dbError(error: { message: string; code?: string }) {
  if (error.code === "42501")
    return new HttpError(
      403,
      "Bạn không có quyền truy cập tổ chức hoặc thao tác này.",
    );
  if (error.code === "23505")
    return new HttpError(
      409,
      "Dữ liệu đã tồn tại. Kiểm tra phiên bản, source key hoặc thành viên.",
    );
  if (["PGRST202", "42P01", "42883"].includes(error.code ?? ""))
    return new HttpError(
      503,
      "Schema Supabase chưa đầy đủ. Vui lòng chạy các migration trong repository.",
    );
  return new HttpError(400, error.message);
}
export async function rpc<T = unknown>(
  db: SupabaseClient,
  name: string,
  args: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await db.rpc(name, args);
  if (error) throw dbError(error);
  return data as T;
}
export async function row<T>(
  db: SupabaseClient,
  table: string,
  id: string,
): Promise<T> {
  const { data, error } = await db
    .from(table)
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw dbError(error);
  if (!data)
    throw new HttpError(
      404,
      "Không tìm thấy dữ liệu hoặc bạn không có quyền truy cập.",
    );
  return data as T;
}
export async function readJson(
  request: Request,
): Promise<Record<string, unknown>> {
  const limit = 1024 * 1024;
  if (Number(request.headers.get("content-length") ?? 0) > limit)
    throw new HttpError(413, "JSON payload vượt giới hạn 1 MB.");
  if (!request.body) return {};
  const reader = request.body.getReader();
  let bytes = 0;
  const parts: Uint8Array[] = [];
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.length;
      if (bytes > limit) {
        await reader.cancel();
        throw new HttpError(413, "JSON payload vượt giới hạn 1 MB.");
      }
      parts.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const data = new Uint8Array(bytes);
  let offset = 0;
  for (const p of parts) {
    data.set(p, offset);
    offset += p.length;
  }
  let result: unknown;
  try {
    result = bytes ? JSON.parse(new TextDecoder().decode(data)) : {};
  } catch {
    throw new HttpError(400, "JSON không hợp lệ.");
  }
  if (!result || Array.isArray(result) || typeof result !== "object")
    throw new HttpError(400, "Payload cần là JSON object.");
  return result as Record<string, unknown>;
}
/**
 * Queue + registry state that explains why a review is (or is not) moving.
 * Counts respect RLS, so a customer only ever sees the queue of their own org.
 */
async function pipelineDiagnostics(
  ctx: ServerContext,
  input: { rules: ComplianceRule[]; sources: RegulatorySource[] },
): Promise<PipelineDiagnostics> {
  const [outputs, queue] = await Promise.all([
    ctx.db
      .from("pipeline_outputs")
      .select("created_at")
      .order("created_at", { ascending: false })
      .limit(1),
    ctx.db
      .from("pipeline_jobs")
      .select("status,updated_at")
      .order("updated_at", { ascending: true })
      .limit(1000),
  ]);
  // Never report "no worker" for what is actually an unreadable queue.
  if (outputs.error) throw dbError(outputs.error);
  if (queue.error) throw dbError(queue.error);
  const rows = (queue.data ?? []) as {
    status: string;
    updated_at: string;
  }[];
  const queued = rows.filter((r) => r.status === "queued");
  const oldest = queued[0]?.updated_at ?? null;
  return {
    scanner_configured: !!process.env.CLAMAV_HOST,
    rules_active: input.rules.filter((r) => r.status === "ACTIVE").length,
    rules_total: input.rules.length,
    sources_current: input.sources.filter((s) => sourceIsCurrent(s)).length,
    worker_last_activity: outputs.data?.[0]?.created_at ?? null,
    queue: {
      queued: queued.length,
      running: rows.filter((r) => r.status === "running").length,
      dead_letter: rows.filter((r) => r.status === "dead_letter").length,
      oldest_queued_age_seconds: oldest
        ? Math.max(
            0,
            Math.round((Date.now() - new Date(oldest).getTime()) / 1000),
          )
        : null,
    },
  };
}

export async function workspace(ctx: ServerContext): Promise<{
  data: AppData;
  actor: Actor;
  diagnostics: PipelineDiagnostics;
}> {
  const tables = [
    "organizations",
    "organization_members",
    "profiles",
    "products",
    "formula_ingredients",
    "label_versions",
    "label_files",
    "extracted_fields",
    "reviews",
    "findings",
    "customer_requests",
    "reports",
    "audit_logs",
    "regulatory_sources",
    "compliance_rules",
  ] as const;
  const results = await Promise.all(
    tables.map((t) =>
      ctx.db
        .from(t)
        .select("*")
        .limit(t === "audit_logs" ? 500 : 2000)
        .order(t === "audit_logs" ? "created_at" : "id", {
          ascending: t !== "audit_logs",
        }),
    ),
  );
  for (const r of results) if (r.error) throw dbError(r.error);
  if (
    results.some(
      (r, i) => tables[i] !== "audit_logs" && (r.data?.length ?? 0) >= 2000,
    )
  )
    throw new HttpError(
      413,
      "Workspace vượt giới hạn MVP. Cần bật phân trang server / phân vùng lưu trữ trước khi tiếp tục; không trả dữ liệu bị cắt ngầm.",
    );
  const values = Object.fromEntries(
    tables.map((t, i) => [t, results[i].data ?? []]),
  );
  const products = (values.products as Product[]).map((p) => ({
    ...p,
    assigned_to: p.assigned_to ?? "",
    formula: (
      values.formula_ingredients as (Product["formula"][number] & {
        product_id: string;
      })[]
    )
      .filter((i) => i.product_id === p.id)
      .sort((a, b) => a.order - b.order),
  }));
  const files = values.label_files as (LabelFile & {
    label_version_id: string;
  })[];
  const fields = values.extracted_fields as (ExtractedField & {
    label_version_id: string;
  })[];
  const labels = (values.label_versions as LabelVersion[]).map((l) => ({
    ...l,
    original_files: files.filter(
      (f) => f.label_version_id === l.id && f.kind === "original",
    ),
    normalized_files: files
      .filter((f) => f.label_version_id === l.id && f.kind === "normalized")
      .sort((a, b) => (a.page ?? 1) - (b.page ?? 1)),
    extracted_fields: fields.filter((f) => f.label_version_id === l.id),
  }));
  const profiles = values.profiles as {
    id: string;
    full_name: string;
    email: string;
    staff_role: "reviewer" | "regulatory_admin" | "system_admin" | null;
    active: boolean;
  }[];
  const members = (
    values.organization_members as {
      id: string;
      organization_id: string;
      user_id: string;
      role: "customer_admin" | "customer_contributor";
      status: "active" | "invited" | "locked";
    }[]
  ).map((m) => ({
    ...m,
    name: profiles.find((p) => p.id === m.user_id)?.full_name || "Thành viên",
    email: profiles.find((p) => p.id === m.user_id)?.email || "",
  }));
  const sources = ctx.actor.role.startsWith("customer")
    ? await rpc<RegulatorySource[]>(ctx.db, "vexim_customer_citations", {})
    : (values.regulatory_sources as RegulatorySource[]);
  const rules = values.compliance_rules as ComplianceRule[];
  const rawReviews = values.reviews as Review[];
  const [diagnostics, jobs] = await Promise.all([
    pipelineDiagnostics(ctx, { rules, sources }),
    (async () => {
      if (!rawReviews.length) return [];
      const { data, error } = await ctx.db
        .from("pipeline_jobs")
        .select(
          "id,review_id,status,attempts,current_stage,locked_until,next_run_at,last_error,created_at,updated_at",
        )
        .in(
          "review_id",
          rawReviews.map((r) => r.id),
        )
        .limit(2000);
      if (error) throw dbError(error);
      return (data ?? []) as (ReviewJob & { review_id: string })[];
    })(),
  ]);
  const reviews = rawReviews.map((r) => ({
    ...r,
    job: jobs.find((j) => j.review_id === r.id) ?? null,
  }));
  return {
    actor: ctx.actor,
    diagnostics,
    data: {
      staff: ctx.actor.role.startsWith("customer")
        ? []
        : profiles
            .filter((p) => p.staff_role)
            .map((p) => ({
              id: p.id,
              name: p.full_name,
              role: p.staff_role!,
              active: p.active,
            })),
      organizations: values.organizations as Organization[],
      members,
      products,
      labelVersions: labels,
      reviews,
      findings: values.findings as Finding[],
      requests: values.customer_requests as CustomerRequest[],
      reports: values.reports as Report[],
      audit: values.audit_logs as AuditEntry[],
      sources,
      rules: rules.map((r) => ({
        ...r,
        created_by: r.created_by ?? "seed",
      })),
    },
  };
}
