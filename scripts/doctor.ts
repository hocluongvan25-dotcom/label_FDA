/**
 * Operational pre-flight check: `npm run doctor`.
 *
 * Answers the question "why is my self-check stuck at 0%?" by inspecting the
 * things the web app cannot see: worker env, ClamAV reachability, the job queue
 * and the active rule set. Prints presence/absence of secrets only, never their
 * values. Exits non-zero when something would block a real review.
 */
import { existsSync } from "node:fs";
import { serviceClient } from "../src/server/context";
import { pingScanner } from "../src/server/virus-scan";
import { sourceIsCurrent } from "../src/lib/utils";
import { REQUIRED_ACTIVE_RULES, formatAge } from "../src/lib/pipeline-status";
import { RULE_CATALOG } from "../src/lib/regulatory";

type Level = "ok" | "warn" | "fail";
interface Check {
  level: Level;
  title: string;
  detail: string;
  fix?: string;
}
const checks: Check[] = [];
const add = (level: Level, title: string, detail: string, fix?: string) =>
  checks.push({ level, title, detail, fix });

const symbols: Record<Level, string> = { ok: "✓", warn: "!", fail: "✗" };

function envStatus(name: string): boolean {
  return !!process.env[name]?.trim();
}

async function main() {
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");

  const required = [
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
  ] as const;
  const missing = required.filter((name) => !envStatus(name));
  if (missing.length)
    add(
      "fail",
      "Biến môi trường Supabase",
      `Thiếu: ${missing.join(", ")}.`,
      "Sao chép .env.example thành .env.local và điền URL, anon key, service-role key (chỉ dùng ở server/worker).",
    );
  else
    add(
      "ok",
      "Biến môi trường Supabase",
      "Đã có URL, anon key và service-role key (giá trị không được in ra).",
    );

  if (missing.length) return report();

  const db = serviceClient();

  // Database reachability
  const { error: orgError } = await db
    .from("organizations")
    .select("id", { count: "exact", head: true });
  if (orgError)
    add(
      "fail",
      "Kết nối Postgres",
      orgError.message,
      "Kiểm tra URL/service-role key và đã chạy migration 0001 → 0003 chưa.",
    );
  else
    add(
      "ok",
      "Kết nối Postgres",
      "Truy vấn được schema bằng service-role key.",
    );

  // Malware scanner
  const scanner = await pingScanner();
  if (!scanner.configured)
    add(
      "fail",
      "ClamAV",
      "CLAMAV_HOST chưa được đặt trong môi trường của worker.",
      "docker compose -f docker-compose.worker.yml up -d --build (gồm ClamAV) rồi đặt CLAMAV_HOST/CLAMAV_PORT cho worker.",
    );
  else if (!scanner.reachable)
    add(
      "fail",
      "ClamAV",
      scanner.detail,
      "ClamAV chưa sẵn sàng hoặc worker không cùng mạng với scanner. Chờ container healthy (freshclam có thể mất vài phút khi khởi tạo).",
    );
  else add("ok", "ClamAV", scanner.detail);

  // Rule set
  const { data: rules, error: rulesError } = await db
    .from("compliance_rules")
    .select("rule_key,status,effective_from,effective_to,test_status");
  if (rulesError) add("fail", "Bộ quy tắc", rulesError.message);
  else {
    const rows = rules ?? [];
    const active = rows.filter((r) => r.status === "ACTIVE");
    const activeKeys = new Set(active.map((r) => r.rule_key));
    const missingKeys = RULE_CATALOG.map((r) => r.rule_key).filter(
      (k) => !activeKeys.has(k),
    );
    if (active.length >= REQUIRED_ACTIVE_RULES && !missingKeys.length)
      add("ok", "Bộ quy tắc", `${active.length} rules ACTIVE.`);
    else
      add(
        active.length ? "warn" : "fail",
        "Bộ quy tắc",
        `${active.length}/${REQUIRED_ACTIVE_RULES} rules ACTIVE. Thiếu: ${
          missingKeys.join(", ") || "không"
        }.`,
        "Hai Regulatory Admin độc lập: đăng ký nguồn thật → checklist → kích hoạt snapshot → regression → duyệt rule. Xem docs/OPERATIONS.md.",
      );
  }

  // Sources
  const { data: sources, error: sourcesError } = await db
    .from("regulatory_sources")
    .select("id,status,effective_from,effective_to,citation,issue_date");
  if (sourcesError) add("fail", "Nguồn tham chiếu", sourcesError.message);
  else {
    const rows = (sources ?? []) as Record<string, unknown>[];
    const current = rows.filter((s) => sourceIsCurrent(s as never));
    if (!current.length)
      add(
        "fail",
        "Nguồn tham chiếu",
        `Chưa có nguồn hiện hành (tổng ${rows.length} bản ghi).`,
        "Chạy regulatory worker để đồng bộ eCFR thật, hoặc đăng ký nguồn thủ công rồi duyệt độc lập.",
      );
    else
      add(
        "ok",
        "Nguồn tham chiếu",
        `${current.length}/${rows.length} nguồn hiện hành.`,
      );
  }

  // Queue / worker
  const { data: jobs, error: jobsError } = await db
    .from("pipeline_jobs")
    .select("status,updated_at,last_error")
    .order("updated_at", { ascending: true })
    .limit(1000);
  if (jobsError) add("fail", "Hàng đợi pipeline", jobsError.message);
  else {
    const rows = jobs ?? [];
    const by = (status: string) => rows.filter((r) => r.status === status);
    const queued = by("queued");
    const oldest = queued[0]?.updated_at ?? null;
    const { data: outputs } = await db
      .from("pipeline_outputs")
      .select("created_at")
      .order("created_at", { ascending: false })
      .limit(1);
    if (!outputs?.length)
      add(
        "warn",
        "Worker",
        queued.length
          ? `Chưa có kết quả pipeline nào và ${queued.length} job đang chờ.`
          : "Chưa có kết quả pipeline nào được ghi nhận.",
        "Chạy worker: docker compose -f docker-compose.worker.yml up -d --build hoặc npm run worker với cùng biến môi trường Supabase.",
      );
    else
      add(
        "ok",
        "Worker",
        `Hoạt động gần nhất ${new Date(outputs[0].created_at).toLocaleString("vi-VN")}.`,
      );
    if (queued.length && oldest) {
      const age = (Date.now() - new Date(oldest).getTime()) / 1000;
      add(
        age > 300 ? "fail" : "warn",
        "Hàng đợi",
        `${queued.length} job chờ · lâu nhất ${formatAge(age)}${
          by("dead_letter").length
            ? ` · ${by("dead_letter").length} dead-letter`
            : ""
        }.`,
        "Nếu job chờ lâu mà worker đang chạy: kiểm tra log worker, kết nối ClamAV và quyền service-role.",
      );
    }
    const failed = rows.filter((r) => r.last_error);
    if (failed.length)
      add(
        "warn",
        "Lỗi gần nhất trong hàng đợi",
        String(failed[failed.length - 1].last_error).slice(0, 400),
      );
  }

  // Private storage buckets
  const { data: buckets, error: bucketError } = await db.storage.listBuckets();
  const expected = ["label-originals", "label-normalized", "review-reports"];
  if (bucketError) add("warn", "Storage buckets", bucketError.message);
  else {
    const names = new Set((buckets ?? []).map((b) => b.name));
    const lacking = expected.filter((n) => !names.has(n));
    const publicBuckets = (buckets ?? []).filter(
      (b) => expected.includes(b.name) && b.public,
    );
    if (lacking.length)
      add(
        "fail",
        "Storage buckets",
        `Thiếu bucket: ${lacking.join(", ")}.`,
        "Chạy lại supabase/migrations/0001_initial.sql (phần storage.buckets) và đảm bảo các bucket đều private.",
      );
    else if (publicBuckets.length)
      add(
        "fail",
        "Storage buckets",
        `Bucket đang public: ${publicBuckets.map((b) => b.name).join(", ")}.`,
        "Đặt public=false cho mọi bucket chứa nhãn và báo cáo.",
      );
    else add("ok", "Storage buckets", `${expected.join(", ")} · private.`);
  }

  report();
}

function report() {
  const order: Level[] = ["fail", "warn", "ok"];
  console.log("\nVexim doctor · kiểm tra điều kiện chạy self-check thật\n");
  for (const level of order)
    for (const c of checks.filter((x) => x.level === level)) {
      console.log(`  ${symbols[c.level]} ${c.title}: ${c.detail}`);
      if (c.fix) console.log(`      → ${c.fix}`);
    }
  const failed = checks.filter((c) => c.level === "fail");
  console.log(
    failed.length
      ? `\n${failed.length} mục chặn việc chạy self-check thật. Review sẽ dừng ở validation/rules cho đến khi xử lý xong.\n`
      : "\nKhông có mục chặn nào. Tạo review mới để kiểm chứng end-to-end.\n",
  );
  if (failed.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(
    "\nDoctor không chạy được:",
    error instanceof Error ? error.message : "Lỗi không xác định",
  );
  process.exitCode = 1;
});
