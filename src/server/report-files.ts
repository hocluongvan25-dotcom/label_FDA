import { readFile } from "node:fs/promises";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Report } from "@/lib/types";
import { generateReportPdf } from "@/lib/pdf-report";
import { HttpError, serviceClient } from "./context";
import { isObjectExists } from "./storage-errors";

export async function ensureReportFiles(report: Report): Promise<Report> {
  if (report.pdf_path && report.json_path) return report;
  const db = serviceClient();
  const [regular, bold] = await Promise.all(
    ["ReportSans.ttf", "ReportSans-Bold.ttf"].map((name) =>
      readFile(path.join(process.cwd(), "public/fonts", name)),
    ),
  );
  const pdf = await generateReportPdf(
    report.snapshot,
    new Uint8Array(regular),
    new Uint8Array(bold),
  );
  const pdfPath = `${report.organization_id}/${report.id}/report.pdf`;
  const jsonPath = `${report.organization_id}/${report.id}/report.json`;
  for (const [storagePath, bytes, mime] of [
    [pdfPath, pdf, "application/pdf"],
    [
      jsonPath,
      Buffer.from(JSON.stringify(report.snapshot, null, 2)),
      "application/json",
    ],
  ] as const) {
    const { error } = await db.storage
      .from("review-reports")
      .upload(storagePath, bytes, { upsert: false, contentType: mime });
    if (error && !isObjectExists(error)) {
      await db.from("reports").update({ status: "failed" }).eq("id", report.id);
      throw new HttpError(
        502,
        "Không lưu được file báo cáo. Snapshot vẫn được giữ; hãy thử tải lại.",
      );
    }
  }
  const { data, error } = await db
    .from("reports")
    .update({ pdf_path: pdfPath, json_path: jsonPath, status: "generated" })
    .eq("id", report.id)
    .select("*")
    .single();
  if (error)
    throw new HttpError(502, "Không cập nhật được trạng thái file báo cáo.");
  const final = await db
    .from("reviews")
    .update({ status: "COMPLETED", updated_at: new Date().toISOString() })
    .eq("id", report.review_id)
    .eq("status", "APPROVED_WITH_NOTES");
  if (final.error)
    throw new HttpError(
      502,
      "Báo cáo đã lưu nhưng chưa cập nhật được trạng thái review.",
    );
  await db
    .from("label_versions")
    .update({ status: "reviewed" })
    .eq("id", report.label_version_id);
  return data as Report;
}
export async function reportSignedUrl(
  db: SupabaseClient,
  report: Report,
  format: "pdf" | "json",
) {
  const storagePath = format === "pdf" ? report.pdf_path : report.json_path;
  if (!storagePath) throw new HttpError(409, "File báo cáo chưa sẵn sàng.");
  const { data, error } = await db.storage
    .from("review-reports")
    .createSignedUrl(storagePath, 300, {
      download: `${report.report_number}.${format}`,
    });
  if (error || !data)
    throw new HttpError(502, "Không tạo được signed URL cho báo cáo.");
  return data.signedUrl;
}
