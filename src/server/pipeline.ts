import { isObjectExists } from "./storage-errors";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import type {
  ComplianceRule,
  ExtractedField,
  LabelFile,
  OcrResult,
  PipelineStep,
  Product,
  RegulatorySource,
  Review,
  TriageReportStatus,
} from "@/lib/types";
import { evaluateRules, verifyFindings } from "@/lib/rules-engine";
import {
  buildPreScreeningSnapshot,
  evaluateTriage,
  mayIssuePreScreening,
  runtimePreScreeningEnabled,
  type RegulatoryParserQuality,
} from "@/lib/triage";
import {
  normalizeNodePages,
  validateOriginal,
  type NodePage,
} from "./node-files";
import { scanFile, UnsafeFileError } from "./virus-scan";
import { getExtractionProvider, getOcrProvider } from "./providers";
import { rpc, row, dbError } from "./context";

export interface PipelineJob {
  id: string;
  review_id: string;
  organization_id: string;
  from_stage: PipelineStep["stage"];
  current_stage: string;
  attempts: number;
}
const sequence: PipelineStep["stage"][] = [
  "validation",
  "ocr",
  "extraction",
  "rules",
  "verification",
];
export async function processJob(
  db: SupabaseClient,
  job: PipelineJob,
  workerId: string,
) {
  const review = await row<Review>(db, "reviews", job.review_id);
  const product = review.dossier_snapshot as Product;
  if (!product || product.organization_id !== job.organization_id)
    throw new UnsafeFileError("Dossier snapshot không cùng organization.");
  let pipeline = review.pipeline;
  let writes = Promise.resolve();
  let leaseLost = false;
  let lastProgressTime = 0;
  const heartbeat = setInterval(() => {
    rpc<boolean>(db, "vexim_heartbeat_job", {
      jid: job.id,
      worker_id: workerId,
    })
      .then((ok) => {
        if (!ok) leaseLost = true;
      })
      .catch(() => {
        leaseLost = true;
      });
  }, 30_000);
  const stageUpdate = (
    stage: PipelineStep["stage"],
    status: PipelineStep["status"],
    progress: number,
    message: string,
  ) => {
    pipeline = pipeline.map((s) =>
      s.stage === stage
        ? {
            ...s,
            status,
            message,
            attempts: job.attempts,
            ...(status === "complete"
              ? { completed_at: new Date().toISOString() }
              : {}),
          }
        : s,
    );
    const snapshot = structuredClone(pipeline);
    writes = writes.then(async () => {
      if (leaseLost) throw new Error("Mất lease của job; dừng ghi kết quả.");
      await rpc(db, "vexim_set_job_progress", {
        jid: job.id,
        worker_id: workerId,
        stage_name: stage,
        pipeline_json: snapshot,
        progress_value: progress,
      });
    });
    return writes;
  };
  const saveOutput = async (stage: PipelineStep["stage"], payload: unknown) => {
    await writes;
    await rpc(db, "vexim_save_pipeline_output", {
      jid: job.id,
      worker_id: workerId,
      stage_name: stage,
      payload_json: payload,
    });
  };
  try {
    const { data: outputs, error: outputsError } = await db
      .from("pipeline_outputs")
      .select("stage,payload")
      .eq("job_id", job.id);
    if (outputsError) throw dbError(outputsError);
    const cache = new Map((outputs ?? []).map((o) => [o.stage, o.payload]));
    const start = sequence.indexOf(job.from_stage);
    const shouldRun = (stage: PipelineStep["stage"]) =>
      sequence.indexOf(stage) >= start &&
      (job.attempts === 1 || !cache.has(stage));
    const pages: NodePage[] = [];
    let ocr: OcrResult | undefined;
    let fields: ExtractedField[] = [];
    const fileResult = await db
      .from("label_files")
      .select("*")
      .eq("label_version_id", review.label_version_id)
      .eq("kind", "original");
    if (fileResult.error) throw dbError(fileResult.error);
    const originals = fileResult.data as LabelFile[];
    if (!originals.length || originals.length > 20)
      throw new UnsafeFileError("Review cần từ 1 đến 20 file gốc.");
    if (shouldRun("validation") || !cache.has("validation")) {
      await stageUpdate(
        "validation",
        "running",
        3,
        "Kiểm tra magic bytes, hash, malware và normalized images.",
      );
      const normalizedManifest: Record<string, unknown>[] = [];
      for (const file of originals) {
        const download = await db.storage
          .from("label-originals")
          .download(file.storage_path);
        if (download.error || !download.data)
          throw new Error("Không tải được file gốc từ private Storage.");
        const bytes = Buffer.from(await download.data.arrayBuffer());
        validateOriginal(bytes, file);
        let scan: "clean" | "dev_unscanned";
        try {
          scan = await scanFile(bytes);
        } catch (e) {
          if (e instanceof UnsafeFileError) {
            await rpc(db, "vexim_mark_file_scanned", {
              jid: job.id,
              worker_id: workerId,
              fid: file.id,
              result: "rejected",
            });
            await db
              .from("label_versions")
              .update({ status: "rejected" })
              .eq("id", review.label_version_id);
          }
          throw e;
        }
        const normalizedPages = await normalizeNodePages(bytes, file);
        await rpc(db, "vexim_mark_file_scanned", {
          jid: job.id,
          worker_id: workerId,
          fid: file.id,
          result: scan,
          page_total: normalizedPages.length,
        });
        for (const p of normalizedPages) {
          normalizedManifest.push({
            original_file_id: file.id,
            page: p.page,
            name: `${file.name} · trang ${p.page}`,
            size: p.bytes.length,
            sha256: createHash("sha256").update(p.bytes).digest("hex"),
          });
          pages.push(p);
          if (
            pages.reduce((sum, page) => sum + page.bytes.length, 0) >
            128 * 1024 * 1024
          )
            throw new UnsafeFileError(
              "Normalized output vượt ngân sách 128 MB. Hãy chia nhỏ hồ sơ / giảm độ phân giải và nhờ chuyên viên hỗ trợ.",
            );
        }
      }
      const normalized = await rpc<LabelFile[]>(db, "vexim_store_normalized", {
        jid: job.id,
        worker_id: workerId,
        manifest: normalizedManifest,
      });
      for (const f of normalized) {
        const page = pages.find(
          (p) => p.file_id === f.original_file_id && p.page === f.page,
        )!;
        const upload = await db.storage
          .from("label-normalized")
          .upload(f.storage_path, page.bytes, {
            contentType: "image/png",
            upsert: false,
          });
        if (upload.error && !isObjectExists(upload.error))
          throw new Error("Không lưu được normalized image.");
      }
      const payload = {
        normalized,
        text_blocks: pages.flatMap((p) => p.textBlocks),
        pages: pages.map((p) => ({
          file_id: p.file_id,
          page: p.page,
          width: p.width,
          height: p.height,
        })),
        validated_at: new Date().toISOString(),
      };
      await saveOutput("validation", payload);
      cache.set("validation", payload);
      await stageUpdate(
        "validation",
        "complete",
        15,
        "File được kiểm tra và normalized pages được lưu riêng.",
      );
    }
    if (shouldRun("ocr") || !cache.has("ocr")) {
      if (!pages.length) {
        const validation = cache.get("validation") as {
          normalized: LabelFile[];
          text_blocks: NodePage["textBlocks"];
          pages: {
            file_id: string;
            page: number;
            width: number;
            height: number;
          }[];
        };
        if (!validation?.normalized?.length)
          throw new Error(
            "Không có validation output; cần chạy lại từ validation.",
          );
        for (const f of validation.normalized) {
          const image = await db.storage
            .from("label-normalized")
            .download(f.storage_path);
          if (image.error || !image.data)
            throw new Error("Normalized file chưa sẵn sàng.");
          const meta = validation.pages.find(
            (p) => p.file_id === f.original_file_id && p.page === f.page,
          )!;
          const bytes = Buffer.from(await image.data.arrayBuffer());
          if (createHash("sha256").update(bytes).digest("hex") !== f.sha256)
            throw new UnsafeFileError("Normalized image hash mismatch.");
          pages.push({
            bytes,
            ...meta,
            textBlocks: validation.text_blocks.filter(
              (b) => b.file_id === f.original_file_id && b.page === f.page,
            ),
          });
        }
      }
      await stageUpdate(
        "ocr",
        "running",
        20,
        "Đọc text layer hoặc OCR bằng provider được cấu hình.",
      );
      ocr = await getOcrProvider().recognize(pages, (value, message) => {
        const timestamp = Date.now();
        if (timestamp - lastProgressTime > 1200 || value === 1) {
          lastProgressTime = timestamp;
          void stageUpdate(
            "ocr",
            "running",
            Math.round(20 + value * 35),
            message,
          ).catch(() => {
            leaseLost = true;
          });
        }
      });
      await saveOutput("ocr", ocr);
      cache.set("ocr", ocr);
      await stageUpdate(
        "ocr",
        "complete",
        55,
        `Đã đọc ${ocr.pages} trang; confidence ${Math.round(ocr.confidence * 100)}%.`,
      );
    } else ocr = cache.get("ocr") as OcrResult;
    if (shouldRun("extraction") || !cache.has("extraction")) {
      if (!ocr)
        throw new Error("OCR output thiếu. Không được tự tạo evidence.");
      await stageUpdate(
        "extraction",
        "running",
        60,
        "Trích xuất JSON có evidence; dữ liệu thiếu là null.",
      );
      fields = await getExtractionProvider().extract({ ocr, product });
      await saveOutput("extraction", {
        fields,
        provider: process.env.APPROVED_LLM_URL
          ? "approved-structured"
          : "deterministic-extractor-v1",
      });
      await stageUpdate(
        "extraction",
        "complete",
        70,
        `${fields.length} fields được kiểm tra schema và evidence.`,
      );
    } else {
      // Human-corrected fields supersede cached extraction when only rerunning rules.
      const result = await db
        .from("extracted_fields")
        .select("*")
        .eq("label_version_id", review.label_version_id);
      if (result.error) throw dbError(result.error);
      fields = result.data as ExtractedField[];
    }
    if (!fields.length)
      throw new Error("Không có extracted fields để đánh giá.");
    await stageUpdate(
      "rules",
      "running",
      77,
      "Áp dụng bộ quy tắc đã duyệt và nguồn hiện hành.",
    );
    const [ruleResult, sourceResult] = await Promise.all([
      // Triage needs inactive/DRAFT rows too so it can record every blocking reason.
      db.from("compliance_rules").select("*"),
      db.from("regulatory_sources").select("*"),
    ]);
    if (ruleResult.error || sourceResult.error)
      throw new Error("Source registry / rules chưa sẵn sàng.");
    const rules = ruleResult.data as ComplianceRule[];
    const sources = sourceResult.data as RegulatorySource[];
    const output = evaluateRules({
      product,
      fields,
      rules,
      sources,
      reviewId: review.id,
    });
    const refs = output.rules_executed.map((e) => ({
      rule_key: e.rule_key,
      version: e.version,
      source_versions: (
        rules.find((r) => r.rule_key === e.rule_key && r.version === e.version)
          ?.source_citations ?? []
      )
        .map((id) => sources.find((s) => s.id === id))
        .filter((s): s is RegulatorySource => !!s)
        .map((s) => ({
          id: s.id,
          version: s.version,
          content_hash: s.content_hash,
          ...(s.raw_snapshot_id
            ? {
                snapshot_id: s.raw_snapshot_id,
                raw_content_hash: s.raw_content_hash,
                issue_date: s.issue_date,
                parser_version: s.parser_version,
              }
            : {}),
        })),
    }));
    await saveOutput("rules", { ...output, rule_snapshot: refs });
    await stageUpdate(
      "rules",
      "complete",
      90,
      `${output.rules_executed.length} rules; ${output.findings.length} findings.`,
    );
    await stageUpdate(
      "verification",
      "running",
      95,
      "Xác minh evidence, scope, registry citations và ngôn ngữ kết luận.",
    );
    verifyFindings(output.findings, sources, product);
    const warningResult = await db
      .from("label_files")
      .select("scan_status")
      .eq("label_version_id", review.label_version_id)
      .eq("kind", "original");
    if (warningResult.data?.some((f) => f.scan_status !== "clean"))
      output.warnings.push(
        "Malware scan chưa xác minh; không được cấp signed URL hoặc duyệt báo cáo thật.",
      );
    const candidateSourceIds = [
      ...new Set(
        rules
          .filter(
            (rule) =>
              rule.scope.includes(product.category) ||
              rule.rule_key === "CLASS-001",
          )
          .flatMap((rule) => rule.source_citations),
      ),
    ];
    const snapshotIds = [
      ...new Set(
        candidateSourceIds
          .map((id) => sources.find((source) => source.id === id)?.raw_snapshot_id)
          .filter((id): id is string => !!id),
      ),
    ];
    const parserQuality: RegulatoryParserQuality[] = [];
    if (snapshotIds.length) {
      const snapshotResults = await Promise.all(
        snapshotIds.map((snapshotId) =>
          db
            .from("regulatory_snapshots")
            .select("id,status,parser_version,effective_date_unknown,validation_results")
            .eq("id", snapshotId)
            .maybeSingle(),
        ),
      );
      for (const snapshotResult of snapshotResults) {
        if (snapshotResult.error || !snapshotResult.data) continue;
        const snapshot = snapshotResult.data as {
          id: string;
          status: string;
          parser_version?: string | null;
          effective_date_unknown?: boolean;
          validation_results?: Record<string, unknown> | null;
        };
        const validation = snapshot.validation_results ?? {};
        parserQuality.push({
          snapshot_id: snapshot.id,
          status: snapshot.status,
          parser_version: snapshot.parser_version,
          coverage_complete: validation.coverage_complete === true,
          citations_valid: validation.citations_valid === true,
          effective_date_unknown:
            snapshot.effective_date_unknown === true ||
            validation.effective_date_unknown === true,
        });
      }
    }
    const decision = evaluateTriage({
      product,
      fields,
      findings: output.findings,
      rules,
      sources,
      rule_snapshot: refs,
      parser_quality: parserQuality,
      ocr_confidence: ocr?.confidence ?? null,
      ocr_pages: ocr?.pages ?? null,
      expected_pages: originals.reduce((sum, file) => sum + file.page_count, 0),
    });
    const runtimeEnabled = runtimePreScreeningEnabled(process.env);
    let databaseEnabled = false;
    if (decision.triage_route === "AUTO_SCREENED" && runtimeEnabled) {
      const allowed = await db.rpc("vexim_pre_screening_allowed", {
        p_organization_id: review.organization_id,
      });
      databaseEnabled = !allowed.error && allowed.data === true;
    }
    const issuePreScreening = mayIssuePreScreening({
      runtimeEnabled,
      databaseEnabled,
      organizationId: review.organization_id,
      allowedOrganizationIds: databaseEnabled ? [review.organization_id] : [],
    });
    let reportStatus: TriageReportStatus = decision.report_status;
    const preScreeningSnapshot = issuePreScreening
      ? buildPreScreeningSnapshot({
          reviewId: review.id,
          labelVersionId: review.label_version_id,
          decision: {
            ...decision,
            report_status: "PRE_SCREENING_ISSUED",
          },
          findings: output.findings,
          ruleSnapshot: refs,
        })
      : null;
    if (preScreeningSnapshot) reportStatus = "PRE_SCREENING_ISSUED";
    const triageData = {
      ...decision,
      report_status: reportStatus,
      customer_questions: decision.customer_questions,
    };
    const completionWarnings = [
      ...new Set([...output.warnings, ...decision.customer_questions]),
    ];
    await saveOutput("verification", {
      valid: true,
      source_refs: refs,
      warnings: completionWarnings,
      triage: triageData,
      verified_at: new Date().toISOString(),
    });
    const verificationMessage =
      decision.triage_route === "AUTO_SCREENED"
        ? preScreeningSnapshot
          ? "Triage hoàn tất; artifact PRE_SCREENING_ONLY đã được tạo theo allowlist staging."
          : "Triage hoàn tất; chưa phát hành artifact vì pre-screening đang tắt hoặc chưa được allowlist."
        : `Triage hoàn tất: ${decision.triage_route}. Không tự phê duyệt báo cáo cuối.`;
    await stageUpdate("verification", "complete", 99, verificationMessage);
    await rpc(db, "vexim_complete_triage", {
      jid: job.id,
      worker_id: workerId,
      new_findings: output.findings,
      rule_refs: refs,
      warnings: completionWarnings,
      triage_data: triageData,
      pre_screening_snapshot: preScreeningSnapshot,
    });
  } finally {
    clearInterval(heartbeat);
    await writes.catch(() => undefined);
  }
}
