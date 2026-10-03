import { regulatoryKnowledgeApi } from "./regulatory/api";
import { z } from "zod";
import { createHash, randomUUID } from "node:crypto";
import type {
  ComplianceRule,
  LabelFile,
  LabelVersion,
  Product,
  RegulatorySource,
  Report,
  Review,
} from "@/lib/types";
import { MAX_FILE_SIZE, MAX_FILES } from "@/lib/constants";
import {
  findingPatchSchema,
  approvalSchema,
  partySchema,
} from "@/lib/validation";
import { validateFileBytes } from "@/lib/files";
import { runRuleRegression } from "@/lib/regression";
import { RULE_CATALOG } from "@/lib/regulatory";
import {
  authenticate,
  dbError,
  HttpError,
  readJson,
  row,
  rpc,
  serviceClient,
  workspace,
  type ServerContext,
} from "./context";
import { ensureReportFiles, reportSignedUrl } from "./report-files";

const uuid = z.string().uuid();
const proposedChangeSchema = z
  .object({
    field: z.string().trim().min(1).max(200),
    current_value: z.string().max(5000).optional(),
    proposed_value: z.string().trim().min(1).max(5000),
    reason: z.string().trim().min(5).max(2000),
  })
  .strict();
const partyDecisionSchema = z
  .object({
    party_role: z.enum(["label_owner", "commercial_importer"]),
    decision: z.enum(["accepted", "changes_requested", "proposed_edit"]),
    comment: z.string().trim().min(5).max(10000),
    proposed_changes: z.array(proposedChangeSchema).max(50).default([]),
  })
  .strict();
const draftSchema = z.object({
  id: uuid.optional(),
  organization_id: uuid.optional(),
  name: z.string().trim().min(2).max(300),
  brand: z.string().max(150).default(""),
  category: z
    .enum([
      "dry_packaged_tea",
      "tea_bag",
      "dietary_supplement",
      "ready_to_drink",
      "other",
    ])
    .default("dry_packaged_tea"),
  form: z
    .enum(["loose_leaf", "tea_bag", "powder", "liquid", "other"])
    .default("loose_leaf"),
  market: z.literal("US").default("US"),
  channel: z
    .array(
      z.enum(["retail", "amazon", "wholesale", "food_service", "ecommerce"]),
    )
    .default([]),
  expected_us_units_12m: z
    .number()
    .int()
    .nonnegative()
    .max(2147483647)
    .nullable()
    .default(null),
  employee_fte: z.number().nonnegative().nullable().default(null),
  formula: z
    .array(
      z.object({
        name_original: z.string().max(300),
        name_english: z.string().max(300),
        normalized_name: z.string().max(300).default(""),
        percentage: z.number().min(0).max(100).nullable(),
        allergen_groups: z
          .array(
            z.enum([
              "milk",
              "egg",
              "fish",
              "shellfish",
              "tree_nuts",
              "peanut",
              "wheat",
              "soy",
              "sesame",
            ]),
          )
          .default([]),
      }),
    )
    .max(200)
    .default([]),
  claims: z.array(z.string().max(1500)).max(100).default([]),
  package_size: z.string().max(1000).default(""),
  net_quantity: z.string().max(500).default(""),
  manufacturer: partySchema.default({ name: "", address: "" }),
  packer: partySchema.default({ name: "", address: "" }),
  distributor: partySchema.default({ name: "", address: "" }),
  importer: partySchema.default({ name: "", address: "" }),
  certifications: z.array(z.string().max(1000)).max(100).default([]),
  exemption_requested: z.boolean().default(false),
  formula_confirmed: z.boolean().default(false),
  claims_confirmed: z.boolean().default(false),
});
const manifestSchema = z
  .array(
    z.object({
      id: uuid,
      name: z.string().min(1).max(500),
      mime_type: z.enum([
        "application/pdf",
        "image/png",
        "image/jpeg",
        "image/tiff",
      ]),
      size: z.number().int().positive().max(MAX_FILE_SIZE),
      sha256: z.string().regex(/^[a-f0-9]{64}$/),
      page_count: z.number().int().min(1).max(10),
    }),
  )
  .min(1)
  .max(MAX_FILES);
const sourceSchema = z.object({
  id: uuid,
  source_key: z.string().trim().min(2).max(200),
  authority: z.string().min(1).max(50),
  agency: z.string().min(1).max(100),
  document_type: z.enum([
    "regulation",
    "statute",
    "amendment",
    "guidance",
    "faq",
    "secondary",
  ]),
  citation: z.string().trim().min(2).max(200),
  title: z.string().trim().min(2).max(2000),
  canonical_url: z.url(),
  topic: z.string().min(1).max(100),
  priority: z.number().int().min(1).max(6),
  retrieved_at: z.iso.datetime(),
  effective_from: z.string().nullable(),
  effective_to: z.string().nullable(),
  content_excerpt: z.string().trim().min(80).max(500_000),
});
const manualSchema = z.object({
  title: z.string().trim().min(2).max(1000),
  description: z.string().trim().min(10).max(10000),
  severity: z.enum(["critical", "major", "minor", "information"]),
  suggested_action: z.string().trim().min(2).max(10000),
  citation_ids: z.array(uuid).max(30),
  evidence: z
    .array(
      z.object({
        file_id: z.string(),
        page: z.number().int().min(1).max(10),
        bbox: z
          .tuple([
            z.number().min(0).max(1),
            z.number().min(0).max(1),
            z.number().min(0).max(1),
            z.number().min(0).max(1),
          ])
          .nullable(),
        text: z.string().min(1).max(10000),
        kind: z.enum(["observed", "absence", "dossier"]).optional(),
      }),
    )
    .min(1)
    .max(30),
});
function requireStaff(
  ctx: ServerContext,
  role?: "reviewer" | "regulatory_admin" | "system_admin",
) {
  if (
    ctx.actor.role.startsWith("customer") ||
    (role && ctx.actor.role !== role)
  )
    throw new HttpError(
      403,
      "Thao tác này yêu cầu vai trò nhân viên Vexim phù hợp.",
    );
}
async function getLabel(ctx: ServerContext, id: string): Promise<LabelVersion> {
  const label = await row<LabelVersion>(
    ctx.db,
    "label_versions",
    uuid.parse(id),
  );
  const [files, fields] = await Promise.all([
    ctx.db.from("label_files").select("*").eq("label_version_id", id),
    ctx.db.from("extracted_fields").select("*").eq("label_version_id", id),
  ]);
  if (files.error || fields.error)
    throw new HttpError(502, "Không đọc được thông tin file / extraction.");
  return {
    ...label,
    original_files: (files.data as LabelFile[]).filter(
      (f) => f.kind === "original",
    ),
    normalized_files: (files.data as LabelFile[]).filter(
      (f) => f.kind === "normalized",
    ),
    extracted_fields: fields.data as LabelVersion["extracted_fields"],
  };
}
async function products(ctx: ServerContext, id?: string) {
  let query = ctx.db
    .from("products")
    .select("*,formula:formula_ingredients(*)");
  if (id) query = query.eq("id", uuid.parse(id));
  const { data, error } = await query
    .order("updated_at", { ascending: false })
    .limit(2000);
  if (error) throw dbError(error);
  if (id && !data?.length)
    throw new HttpError(
      404,
      "Không tìm thấy sản phẩm hoặc không có quyền truy cập.",
    );
  return id ? data![0] : data;
}
export async function apiHandler(request: Request, segments: string[]) {
  try {
    const ctx = await authenticate(request);
    const method = request.method;
    const url = new URL(request.url);
    const path = segments.join("/");
    let result: unknown;
    if (segments[0] === "regulatory" && segments[1] === "knowledge")
      result = await regulatoryKnowledgeApi(ctx, request, segments.slice(2));
    else if (method === "GET" && path === "workspace")
      result = await workspace(ctx);
    else if (method === "GET" && path === "health") {
      const { data, error } = await ctx.db
        .from("pipeline_outputs")
        .select("created_at")
        .order("created_at", { ascending: false })
        .limit(1);
      if (error) throw dbError(error);
      result = {
        database: "connected",
        scanner_configured: !!process.env.CLAMAV_HOST,
        worker_last_activity: data?.[0]?.created_at ?? null,
        local_ocr: process.env.OCR_PROVIDER !== "approved",
      };
    } else if (
      method === "GET" &&
      segments[0] === "products" &&
      segments.length <= 2
    )
      result = await products(ctx, segments[1]);
    else if (method === "POST" && path === "products") {
      const parsed = draftSchema.parse(await readJson(request));
      const org = parsed.organization_id ?? ctx.actor.organization_id;
      if (!org) throw new HttpError(400, "Cần organization_id.");
      result = await rpc<Product>(ctx.db, "vexim_save_product", {
        p: { ...parsed, organization_id: org },
      });
    } else if (
      method === "POST" &&
      segments[0] === "products" &&
      segments[2] === "label-versions" &&
      segments.length === 3
    ) {
      const pid = uuid.parse(segments[1]);
      await row(ctx.db, "products", pid);
      if (
        request.headers.get("content-type")?.startsWith("multipart/form-data")
      ) {
        // For large/multiple files, use JSON manifest + direct private Storage uploads.
        const length = Number(request.headers.get("content-length") ?? 0);
        if (!length || length > 100 * 1024 * 1024)
          throw new HttpError(
            413,
            "Multipart cần Content-Length và tổng dưới 100 MB. Dùng JSON manifest + private Storage cho file lớn.",
          );
        const form = await request.formData();
        const files = form
          .getAll("files")
          .filter((f): f is File => f instanceof File);
        if (!files.length || files.length > MAX_FILES)
          throw new HttpError(400, "Cần từ 1 đến 20 file trong trường files.");
        const bytes: Buffer[] = [];
        const manifest: z.infer<typeof manifestSchema> = [];
        for (const file of files) {
          if (file.size > MAX_FILE_SIZE)
            throw new HttpError(413, "Mỗi file tối đa 50 MB.");
          const b = Buffer.from(await file.arrayBuffer());
          const mime = validateFileBytes(
            new Uint8Array(b.subarray(0, 20)),
            b.length,
            file.type,
          );
          bytes.push(b);
          manifest.push({
            id: randomUUID(),
            name: file.name,
            mime_type: manifestSchema.element.shape.mime_type.parse(mime),
            size: b.length,
            sha256: createHash("sha256").update(b).digest("hex"),
            page_count: 1,
          });
        }
        const label = await rpc<LabelVersion>(
          ctx.db,
          "vexim_create_label_version",
          { pid, manifest: manifestSchema.parse(manifest) },
        );
        for (let i = 0; i < files.length; i++) {
          const metadata = label.original_files.find(
            (f) => f.id === manifest[i].id,
          )!;
          const { error } = await ctx.db.storage
            .from("label-originals")
            .upload(metadata.storage_path, bytes[i], {
              upsert: false,
              contentType: metadata.mime_type,
            });
          if (error)
            throw new HttpError(
              502,
              "Upload không hoàn thành. File đã tải không bị ghi đè; tạo phiên bản mới hoặc liên hệ hỗ trợ.",
            );
        }
        result = { ...label, label_version_id: label.id };
      } else {
        const body = await readJson(request);
        const manifest = manifestSchema.parse(body.manifest);
        result = await rpc<LabelVersion>(ctx.db, "vexim_create_label_version", {
          pid,
          manifest,
        });
      }
    } else if (
      method === "GET" &&
      segments[0] === "label-versions" &&
      segments.length === 2
    )
      result = await getLabel(ctx, segments[1]);
    else if (
      method === "POST" &&
      segments[0] === "label-versions" &&
      segments[2] === "reviews" &&
      segments.length === 3
    ) {
      const lid = uuid.parse(segments[1]);
      const body = z
        .object({
          review_scope: z.literal("us_federal_food_labeling_mvp"),
          formula_confirmed: z.literal(true),
          claims_confirmed: z.literal(true),
          idempotency_key: z.string().min(1).max(200).optional(),
        })
        .parse(await readJson(request));
      const review = await rpc<Review>(ctx.db, "vexim_submit_review", {
        lid,
        idem:
          request.headers.get("idempotency-key") ??
          body.idempotency_key ??
          `${lid}:us-labeling-v1`,
      });
      result = { ...review, review_id: review.id };
    } else if (
      method === "GET" &&
      segments[0] === "reviews" &&
      segments.length === 2
    ) {
      const review = await row<Review>(
        ctx.db,
        "reviews",
        uuid.parse(segments[1]),
      );
      const { data, error } = await ctx.db
        .from("findings")
        .select("severity,status")
        .eq("review_id", review.id);
      if (error) throw dbError(error);
      result = {
        ...review,
        review_id: review.id,
        finding_count: (data ?? [])
          .filter((f) => f.status !== "dismissed")
          .reduce((c, f) => ({ ...c, [f.severity]: c[f.severity] + 1 }), {
            critical: 0,
            major: 0,
            minor: 0,
            information: 0,
          } as Record<string, number>),
      };
    } else if (
      method === "GET" &&
      segments[0] === "reviews" &&
      segments[2] === "findings" &&
      segments.length === 3
    ) {
      const rid = uuid.parse(segments[1]);
      await row(ctx.db, "reviews", rid);
      const { data, error } = await ctx.db
        .from("findings")
        .select("*")
        .eq("review_id", rid)
        .order("created_at");
      if (error) throw dbError(error);
      result = data;
    } else if (
      method === "PATCH" &&
      segments[0] === "findings" &&
      segments.length === 2
    ) {
      requireStaff(ctx, "reviewer");
      const patch = findingPatchSchema.parse(await readJson(request));
      result = await rpc(ctx.db, "vexim_update_finding", {
        fid: uuid.parse(segments[1]),
        p: patch,
      });
    } else if (
      method === "POST" &&
      segments[0] === "reviews" &&
      segments[2] === "findings" &&
      segments.length === 3
    ) {
      requireStaff(ctx, "reviewer");
      result = await rpc(ctx.db, "vexim_add_finding", {
        rid: uuid.parse(segments[1]),
        p: manualSchema.parse(await readJson(request)),
      });
    } else if (
      method === "PATCH" &&
      segments[0] === "label-versions" &&
      segments[2] === "fields" &&
      segments.length === 4
    ) {
      requireStaff(ctx, "reviewer");
      const body = z
        .object({
          value: z.string().max(20000),
          reason: z.string().trim().min(5).max(5000),
        })
        .parse(await readJson(request));
      await rpc(ctx.db, "vexim_update_field", {
        lid: uuid.parse(segments[1]),
        fid: uuid.parse(segments[3]),
        new_value: body.value,
        reason: body.reason,
      });
      result = { saved: true };
    } else if (
      method === "POST" &&
      segments[0] === "reviews" &&
      segments[2] === "requests" &&
      segments.length === 3
    ) {
      requireStaff(ctx, "reviewer");
      const body = z
        .object({
          message: z.string().trim().min(10).max(10000),
          requested_documents: z.array(z.string().max(1000)).max(30),
        })
        .parse(await readJson(request));
      await rpc(ctx.db, "vexim_request_information", {
        rid: uuid.parse(segments[1]),
        message: body.message,
        documents: body.requested_documents,
      });
      result = { saved: true };
    } else if (
      method === "PATCH" &&
      segments[0] === "requests" &&
      segments.length === 2
    ) {
      requireStaff(ctx, "reviewer");
      z.object({ status: z.literal("resolved") }).parse(
        await readJson(request),
      );
      await rpc(ctx.db, "vexim_resolve_request", {
        request_id: uuid.parse(segments[1]),
      });
      result = { saved: true };
    } else if (
      method === "POST" &&
      segments[0] === "reviews" &&
      segments[2] === "participants" &&
      segments.length === 3
    ) {
      const body = z
        .object({
          organization_contact_email: z.string().trim().email().max(254),
          party_role: z.enum(["commercial_importer", "fsvp_importer"]),
        })
        .strict()
        .parse(await readJson(request));
      result = await rpc(ctx.db, "vexim_invite_review_participant_by_email", {
        rid: uuid.parse(segments[1]),
        participant_email: body.organization_contact_email,
        requested_role: body.party_role,
      });
    } else if (
      method === "POST" &&
      segments[0] === "review-participants" &&
      segments[2] === "accept" &&
      segments.length === 3
    ) {
      const body = z
        .object({
          attests_fsvp: z.boolean().default(false),
          attestation_note: z.string().trim().max(5000).optional(),
        })
        .strict()
        .parse(await readJson(request));
      result = await rpc(ctx.db, "vexim_accept_review_participant", {
        participant_id: uuid.parse(segments[1]),
        attests_fsvp: body.attests_fsvp,
        attestation_note: body.attestation_note ?? null,
      });
    } else if (
      method === "DELETE" &&
      segments[0] === "review-participants" &&
      segments.length === 2
    ) {
      const body = z
        .object({ reason: z.string().trim().min(5).max(5000) })
        .strict()
        .parse(await readJson(request));
      await rpc(ctx.db, "vexim_remove_review_participant", {
        participant_id: uuid.parse(segments[1]),
        reason: body.reason,
      });
      result = { removed: true };
    } else if (
      method === "POST" &&
      segments[0] === "reviews" &&
      segments[2] === "share" &&
      segments.length === 3
    ) {
      const body = z
        .object({ comment: z.string().trim().min(5).max(5000) })
        .strict()
        .parse(await readJson(request));
      await rpc(ctx.db, "vexim_share_review_with_importer", {
        rid: uuid.parse(segments[1]),
        share_comment: body.comment,
      });
      result = { shared: true };
    } else if (
      method === "POST" &&
      segments[0] === "reviews" &&
      segments[2] === "party-decisions" &&
      segments.length === 3
    ) {
      const body = partyDecisionSchema.parse(await readJson(request));
      result = await rpc(ctx.db, "vexim_record_party_decision", {
        rid: uuid.parse(segments[1]),
        requested_role: body.party_role,
        requested_decision: body.decision,
        decision_comment: body.comment,
        proposed_changes: body.proposed_changes,
      });
    } else if (
      method === "POST" &&
      segments[0] === "reviews" &&
      segments[2] === "assign" &&
      segments.length === 3
    ) {
      const body = z
        .object({
          reviewer_id: uuid,
          reason: z.string().trim().min(5).max(5000),
        })
        .parse(await readJson(request));
      await rpc(ctx.db, "vexim_assign_review", {
        rid: uuid.parse(segments[1]),
        reviewer_id: body.reviewer_id,
        reason: body.reason,
      });
      result = { assigned: true };
    } else if (
      method === "PATCH" &&
      segments[0] === "reviews" &&
      segments.length === 2
    ) {
      const body = z
        .object({
          status: z.enum([
            "HUMAN_REVIEW",
            "WAITING_FOR_CUSTOMER",
            "REVISION_REQUIRED",
            "MANUAL_ESCALATION_REQUIRED",
            "ARCHIVED",
          ]),
          reason: z.string().trim().min(5).max(5000),
        })
        .parse(await readJson(request));
      await rpc(ctx.db, "vexim_transition_review", {
        rid: uuid.parse(segments[1]),
        target: body.status,
        reason: body.reason,
      });
      result = { saved: true };
    } else if (
      method === "POST" &&
      segments[0] === "reviews" &&
      segments[2] === "retry" &&
      segments.length === 3
    ) {
      requireStaff(ctx, "reviewer");
      const body = z
        .object({
          from_stage: z.enum([
            "validation",
            "ocr",
            "extraction",
            "rules",
            "verification",
          ]),
        })
        .parse(await readJson(request));
      await rpc(ctx.db, "vexim_retry_review", {
        rid: uuid.parse(segments[1]),
        stage: body.from_stage,
      });
      result = { queued: true };
    } else if (
      method === "POST" &&
      segments[0] === "reviews" &&
      segments[2] === "reports" &&
      segments.length === 3
    ) {
      requireStaff(ctx, "reviewer");
      serviceClient();
      const body = approvalSchema.parse(await readJson(request));
      const report = await rpc<Report>(ctx.db, "vexim_approve_report", {
        rid: uuid.parse(segments[1]),
        comment: body.comment,
      });
      const files = await ensureReportFiles(report);
      result = {
        ...files,
        report_id: files.id,
        status: "generated",
        pdf_url: await reportSignedUrl(ctx.db, files, "pdf"),
        json_url: await reportSignedUrl(ctx.db, files, "json"),
      };
    } else if (
      method === "GET" &&
      segments[0] === "reports" &&
      segments[2] === "download" &&
      segments.length === 3
    ) {
      const report = await row<Report>(
        ctx.db,
        "reports",
        uuid.parse(segments[1]),
      );
      const format = z
        .enum(["pdf", "json"])
        .parse(url.searchParams.get("format") ?? "pdf");
      const files = await ensureReportFiles(report);
      await rpc(ctx.db, "vexim_log_report_download", {
        report_id: report.id,
        format,
      });
      result = {
        url: await reportSignedUrl(ctx.db, files, format),
        expires_in: 300,
      };
    } else if (
      method === "GET" &&
      segments[0] === "files" &&
      segments[2] === "signed-url" &&
      segments.length === 3
    ) {
      const file = await row<LabelFile & { organization_id: string }>(
        ctx.db,
        "label_files",
        uuid.parse(segments[1]),
      );
      if (file.scan_status !== "clean")
        throw new HttpError(
          409,
          "File chưa hoàn thành malware scan hoặc đã bị từ chối.",
        );
      await rpc(ctx.db, "vexim_log_file_access", {
        fid: file.id,
        access_action: "signed_url",
      });
      const { data, error } = await ctx.db.storage
        .from(file.kind === "original" ? "label-originals" : "label-normalized")
        .createSignedUrl(file.storage_path, 300);
      if (error || !data)
        throw new HttpError(502, "Không tạo được signed URL.");
      result = { url: data.signedUrl, expires_in: 300 };
    } else if (
      method === "POST" &&
      segments[0] === "files" &&
      segments[2] === "access" &&
      segments.length === 3
    ) {
      const body = z
        .object({ action: z.enum(["view", "download"]) })
        .parse(await readJson(request));
      await rpc(ctx.db, "vexim_log_file_access", {
        fid: uuid.parse(segments[1]),
        access_action: body.action,
      });
      result = { logged: true };
    } else if (method === "POST" && path === "organizations") {
      const body = z
        .object({
          id: uuid.optional(),
          name: z.string().trim().min(2).max(300),
          contact_name: z.string().max(300),
          contact_email: z.email(),
          country: z.string().min(2).max(20),
          status: z.enum(["active", "inactive"]).optional(),
        })
        .parse(await readJson(request));
      result = await rpc(ctx.db, "vexim_save_organization", { p: body });
    } else if (method === "POST" && path === "members/invite") {
      const body = z
        .object({
          organization_id: uuid,
          name: z.string().trim().min(1).max(300),
          email: z.email(),
          role: z.enum(["customer_admin", "customer_contributor"]),
        })
        .parse(await readJson(request));
      const permitted = await rpc<boolean>(ctx.db, "app_can_admin_org", {
        org: body.organization_id,
      });
      if (!permitted)
        throw new HttpError(
          403,
          "Bạn không có quyền mời thành viên vào tổ chức này.",
        );
      const admin = serviceClient();
      const existing = await admin
        .from("profiles")
        .select("id,staff_role")
        .eq("email", body.email.toLowerCase())
        .maybeSingle();
      if (existing.error) throw dbError(existing.error);
      if (existing.data?.staff_role)
        throw new HttpError(
          400,
          "Lời mời doanh nghiệp chỉ dành cho tài khoản khách hàng.",
        );
      let userId = existing.data?.id as string | undefined;
      if (!userId) {
        const invitation = await admin.auth.admin.inviteUserByEmail(
          body.email.toLowerCase(),
          {
            data: { full_name: body.name },
            redirectTo: process.env.NEXT_PUBLIC_APP_URL || url.origin,
          },
        );
        if (invitation.error || !invitation.data.user)
          throw new HttpError(
            502,
            "Không gửi được lời mời. Kiểm tra SMTP / redirect allowlist của Supabase.",
          );
        userId = invitation.data.user.id;
      }
      const membership = await rpc(ctx.db, "vexim_add_invited_member", {
        org: body.organization_id,
        uid: userId,
        new_role: body.role,
      });
      if (existing.data) {
        const emailResult = await ctx.db.auth.signInWithOtp({
          email: body.email.toLowerCase(),
          options: {
            shouldCreateUser: false,
            emailRedirectTo: process.env.NEXT_PUBLIC_APP_URL || url.origin,
          },
        });
        if (emailResult.error)
          throw new HttpError(
            502,
            "Thành viên đã được mời nhưng chưa gửi được email đăng nhập. Người nhận có thể đăng nhập bằng tài khoản hiện có.",
          );
      }
      result = { membership, sent: true };
    } else if (
      method === "PATCH" &&
      segments[0] === "members" &&
      segments.length === 2
    ) {
      const body = z
        .object({ status: z.enum(["active", "locked"]) })
        .parse(await readJson(request));
      await rpc(ctx.db, "vexim_set_member_status", {
        mid: uuid.parse(segments[1]),
        new_status: body.status,
      });
      result = { saved: true };
    } else if (method === "GET" && path === "regulatory/sources") {
      requireStaff(ctx);
      let q = ctx.db.from("regulatory_sources").select("*");
      if (url.searchParams.get("topic"))
        q = q.eq("topic", url.searchParams.get("topic"));
      if (url.searchParams.get("status"))
        q = q.eq(
          "status",
          url.searchParams.get("status") === "current"
            ? "CURRENT"
            : url.searchParams.get("status"),
        );
      const { data, error } = await q.order("priority");
      if (error) throw dbError(error);
      result = data;
    } else if (method === "POST" && path === "regulatory/sources") {
      requireStaff(ctx, "regulatory_admin");
      result = await rpc(ctx.db, "vexim_save_source", {
        p: sourceSchema.parse(await readJson(request)),
      });
    } else if (
      method === "POST" &&
      segments[0] === "regulatory" &&
      segments[1] === "sources" &&
      segments[3] === "approve" &&
      segments.length === 4
    ) {
      requireStaff(ctx, "regulatory_admin");
      await rpc(ctx.db, "vexim_approve_source", {
        sid: uuid.parse(segments[2]),
      });
      result = { approved: true };
    } else if (method === "GET" && path === "regulatory/rules") {
      requireStaff(ctx);
      const { data, error } = await ctx.db
        .from("compliance_rules")
        .select("*")
        .order("rule_key");
      if (error) throw dbError(error);
      result = data;
    } else if (method === "POST" && path === "regulatory/rules") {
      requireStaff(ctx, "regulatory_admin");
      const body = z
        .object({
          id: uuid,
          rule_key: z.string(),
          name: z.string().trim().min(2).max(1000),
          scope: z.array(z.enum(["dry_packaged_tea", "tea_bag"])).min(1),
          condition_json: z.object({
            type: z.string(),
            ocr_threshold: z.number().min(0).max(1),
          }),
          action_json: z.object({
            severity: z.enum(["critical", "major", "minor", "information"]),
            human_review: z.boolean(),
            suggested_action: z.string().trim().min(2).max(10000),
          }),
          source_citations: z.array(uuid).min(1).max(30),
          effective_from: z.string().nullable(),
          effective_to: z.string().nullable(),
        })
        .parse(await readJson(request));
      const base = RULE_CATALOG.find((r) => r.rule_key === body.rule_key);
      if (!base || base.condition_json.type !== body.condition_json.type)
        throw new HttpError(
          400,
          "Rule key và evaluator type phải khớp bộ 15 rules MVP.",
        );
      result = await rpc(ctx.db, "vexim_save_rule", { p: body });
    } else if (
      method === "POST" &&
      segments[0] === "regulatory" &&
      segments[1] === "rules" &&
      segments[3] === "test" &&
      segments.length === 4
    ) {
      requireStaff(ctx, "regulatory_admin");
      const candidate = await row<ComplianceRule>(
        ctx.db,
        "compliance_rules",
        uuid.parse(segments[2]),
      );
      const { data, error } = await ctx.db
        .from("regulatory_sources")
        .select("*");
      if (error) throw dbError(error);
      const sources = data as RegulatorySource[];
      const tests = runRuleRegression([candidate], sources);
      const refs = candidate.source_citations
        .map((id) => sources.find((s) => s.id === id)!)
        .filter(Boolean)
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((s) => ({
          id: s.id,
          version: s.version,
          content_hash: s.content_hash,
        }));
      await rpc(serviceClient(), "vexim_record_rule_test", {
        rid: candidate.id,
        expected_hash: candidate.definition_hash,
        source_refs: refs,
        results: tests,
        tester: ctx.actor.id,
      });
      result = tests;
    } else if (
      method === "POST" &&
      segments[0] === "regulatory" &&
      segments[1] === "rules" &&
      segments[3] === "approve" &&
      segments.length === 4
    ) {
      requireStaff(ctx, "regulatory_admin");
      await rpc(ctx.db, "vexim_approve_rule", { rid: uuid.parse(segments[2]) });
      result = { approved: true };
    } else throw new HttpError(404, "Không tìm thấy API endpoint.");
    return Response.json(result ?? { ok: true }, {
      status:
        method === "POST" && ["products", "organizations"].includes(path)
          ? 201
          : 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof z.ZodError)
      return Response.json(
        {
          error: "Dữ liệu đầu vào chưa hợp lệ.",
          fields: error.issues.map((i) => ({
            path: i.path.join("."),
            message: i.message,
          })),
        },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    if (error instanceof HttpError)
      return Response.json(
        { error: error.message },
        { status: error.status, headers: { "Cache-Control": "no-store" } },
      );
    console.error(
      "API request failed:",
      error instanceof Error ? error.name : "Unknown error",
    );
    return Response.json(
      {
        error:
          "Không thực hiện được yêu cầu. Thử lại hoặc liên hệ quản trị hệ thống.",
      },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
