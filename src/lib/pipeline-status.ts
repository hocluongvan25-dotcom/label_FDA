import type { PipelineDiagnostics, Review, ReviewJob } from "./types";

export type { PipelineDiagnostics, ReviewJob };

/**
 * Shared, dependency-free explanation of *why* a review is not progressing.
 *
 * The worker runs outside the web app (Vercel/serverless never runs it). When no
 * worker, no ClamAV or no ACTIVE rule set is available the pipeline stays at 0%
 * with every stage "pending". Saying so precisely is a compliance requirement:
 * an unfinished check must never look like a finished one.
 */

export const REQUIRED_ACTIVE_RULES = 15;

export type BlockerId =
  | "no-job"
  | "worker-missing"
  | "worker-queued"
  | "lease-expired"
  | "job-failed"
  | "dead-letter"
  | "scanner-missing"
  | "rules-inactive";

export interface PipelineBlocker {
  id: BlockerId;
  tone: "warning" | "error";
  title: string;
  detail: string;
  action: string;
}

export interface BlockerInput {
  review: Review;
  diagnostics?: PipelineDiagnostics | null;
  rulesActive?: number | null;
  rulesTotal?: number | null;
  /** Customers cannot read the rule registry; do not report counts they cannot see. */
  rulesVisible?: boolean;
  mode: "demo" | "supabase";
  now?: Date;
}

const FINAL_STATUSES = [
  "COMPLETED",
  "APPROVED_WITH_NOTES",
  "ARCHIVED",
] as const;
/** Statuses where the queue, not a human, owns the next step. */
export const PIPELINE_OWNED_STATUSES = [
  "PROCESSING",
  "PROCESSING_FAILED",
  "MODEL_FAILED",
];

export function formatAge(seconds: number): string {
  if (seconds < 60) return `${Math.max(0, Math.round(seconds))} giây`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} phút`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} giờ ${rest} phút` : `${hours} giờ`;
}

export function isFinalReview(status: string): boolean {
  return (FINAL_STATUSES as readonly string[]).includes(status);
}

/** A job that has been waiting longer than this is reported as "no worker picked it up". */
export const QUEUE_STALE_SECONDS = 60;

export function explainPipelineBlockers({
  review,
  diagnostics,
  rulesActive,
  rulesTotal,
  rulesVisible = true,
  mode,
  now = new Date(),
}: BlockerInput): PipelineBlocker[] {
  // Demo runs the pipeline inside the browser tab; nothing external can be missing.
  if (mode !== "supabase") return [];
  const blockers: PipelineBlocker[] = [];
  const job = review.job ?? null;
  const active = rulesActive ?? diagnostics?.rules_active ?? null;
  const total = rulesTotal ?? diagnostics?.rules_total ?? null;

  if (PIPELINE_OWNED_STATUSES.includes(review.status)) {
    if (!job) {
      blockers.push({
        id: "no-job",
        tone: "error",
        title: "Không tìm thấy tác vụ trong hàng đợi",
        detail:
          "Review đang chờ pipeline xử lý nhưng không có job tương ứng trong pipeline_jobs. Tác vụ chưa được tạo hoặc đã bị xóa.",
        action:
          "Dùng “Chạy lại kiểm tra” để tạo job mới. Nếu lặp lại, kiểm tra migration và quyền ghi của hàng đợi.",
      });
    } else if (job.status === "queued") {
      const ageSeconds = Math.max(
        0,
        (now.getTime() - new Date(job.updated_at).getTime()) / 1000,
      );
      if (ageSeconds >= QUEUE_STALE_SECONDS) {
        const neverRan = !diagnostics?.worker_last_activity;
        blockers.push({
          id: neverRan ? "worker-missing" : "worker-queued",
          tone: "error",
          title: neverRan
            ? "Chưa có worker nào nhận tác vụ này"
            : "Tác vụ đang chờ worker",
          detail: neverRan
            ? `Job đã nằm trong hàng đợi ${formatAge(ageSeconds)} và hệ thống chưa ghi nhận hoạt động nào của worker. Worker (tiến trình \`npm run worker\` hoặc container) chưa chạy hoặc đang trỏ tới dự án Supabase khác.`
            : `Job chờ ${formatAge(ageSeconds)}. Worker gần nhất ghi kết quả lúc ${new Date(
                diagnostics!.worker_last_activity!,
              ).toLocaleString("vi-VN")}${
                diagnostics?.queue.queued
                  ? `; đang có ${diagnostics.queue.queued} tác vụ chờ trong phạm vi bạn được xem.`
                  : "."
              }`,
          action:
            "Chạy worker ngoài web app: `docker compose -f docker-compose.worker.yml up -d --build` (gồm ClamAV) hoặc `npm run worker` với cùng biến môi trường Supabase. Kiểm tra nhanh bằng `npm run doctor`.",
        });
      }
    } else if (job.status === "running" && job.locked_until) {
      if (new Date(job.locked_until).getTime() < now.getTime()) {
        blockers.push({
          id: "lease-expired",
          tone: "warning",
          title: "Worker đang xử lý nhưng lease đã hết hạn",
          detail: `Job bị khóa bởi một worker tới ${new Date(
            job.locked_until,
          ).toLocaleString(
            "vi-VN",
          )} nhưng chưa cập nhật tiến độ. Có thể worker bị dừng giữa chừng hoặc mất kết nối.`,
          action:
            "Hàng đợi sẽ trả job về trạng thái chờ để worker khác nhận lại. Nếu lặp lại, kiểm tra log worker và độ ổn định của kết nối tới Supabase/ClamAV.",
        });
      }
    } else if (job.status === "retry") {
      blockers.push({
        id: "job-failed",
        tone: "error",
        title: `Lần thử ${job.attempts} không thành công`,
        detail:
          job.last_error ??
          "Worker ghi nhận lỗi nhưng không kèm thông điệp. Job sẽ được thử lại tối đa 3 lần.",
        action:
          "Xử lý nguyên nhân trong thông báo lỗi rồi chạy lại. Lỗi lặp ở bước validation thường do ClamAV chưa cấu hình hoặc file vượt giới hạn.",
      });
    } else if (job.status === "dead_letter") {
      blockers.push({
        id: "dead-letter",
        tone: "error",
        title: "Tác vụ đã chuyển sang dead-letter",
        detail:
          job.last_error ??
          "Job đã vượt quá số lần thử tự động và không được xử lý tiếp.",
        action:
          "Khắc phục nguyên nhân, sau đó dùng “Chạy lại kiểm tra” từ bước phù hợp. Quyết định cũ không được dùng lại.",
      });
    }

    if (diagnostics && !diagnostics.scanner_configured) {
      const alreadyExplained = blockers.some((b) =>
        /Malware scanner|ClamAV/i.test(b.detail),
      );
      if (!alreadyExplained)
        blockers.push({
          id: "scanner-missing",
          tone: "warning",
          title: "Chưa cấu hình trình quét mã độc cho worker",
          detail:
            "CLAMAV_HOST chưa được đặt trong môi trường của worker. Khi đó worker dừng ở bước validation vì file gốc chưa được quét thật; OCR và rules không chạy.",
          action:
            "Chạy ClamAV (kèm sẵn trong docker-compose.worker.yml) và đặt CLAMAV_HOST/CLAMAV_PORT cho worker. Chỉ môi trường dev mới được dùng ALLOW_UNSCANNED_DEV_UPLOADS=true, và khi đó file bị gắn dev_unscanned, không mở được file gốc.",
        });
    }
  }

  if (
    rulesVisible &&
    active !== null &&
    active < REQUIRED_ACTIVE_RULES &&
    !isFinalReview(review.status)
  ) {
    blockers.push({
      id: "rules-inactive",
      tone: "warning",
      title: `Mới có ${active}${
        total ? `/${total}` : `/${REQUIRED_ACTIVE_RULES}`
      } quy tắc đang hoạt động`,
      detail: `Bộ kiểm tra cần đủ ${REQUIRED_ACTIVE_RULES} quy tắc ACTIVE trên nguồn hiện hành. Chưa đủ thì hệ thống không được trả kết luận “không phát hiện vấn đề”; review sẽ dừng ở SOURCE_UNAVAILABLE.`,
      action:
        "Regulatory Admin thực hiện: đăng ký nguồn thật → Admin A kiểm tra checklist → Admin B kích hoạt độc lập → chạy regression → Admin B duyệt rule. Xem “Hướng dẫn kích hoạt bộ quy tắc” tại trang Rules.",
    });
  }

  return blockers;
}
