import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import type { ReportSnapshot } from "./types";
import {
  CATEGORY_LABELS,
  FINDING_STATUS_LABELS,
  RESULT_LABELS,
  SEVERITY_META,
} from "./constants";
import { formatDate } from "./utils";

export async function generateReportPdf(
  snapshot: ReportSnapshot,
  regularBytes: Uint8Array,
  boldBytes: Uint8Array,
) {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const regular = await doc.embedFont(regularBytes, { subset: true });
  const bold = await doc.embedFont(boldBytes, { subset: true });
  doc.setTitle(`Vexim Label Review — ${snapshot.product.name}`);
  doc.setAuthor(snapshot.reviewer.name);
  doc.setSubject("Preliminary US federal food label review");
  const navy = rgb(0.09, 0.19, 0.18),
    muted = rgb(0.39, 0.45, 0.46),
    teal = rgb(0.13, 0.44, 0.36),
    light = rgb(0.94, 0.96, 0.95);
  const W = 595.28,
    H = 841.89,
    M = 45;
  let page!: PDFPage;
  let y = 0;
  function newPage() {
    page = doc.addPage([W, H]);
    y = H - M;
    page.drawText("VEXIM", {
      x: M,
      y: y - 12,
      size: 18,
      font: bold,
      color: teal,
    });
    page.drawText("LABEL REVIEW", {
      x: M + 90,
      y: y - 11,
      size: 8,
      font: regular,
      color: muted,
    });
    page.drawText(
      snapshot.demo ? "DEMO · KHÔNG DÙNG CHO HỒ SƠ THỰC" : "CONFIDENTIAL",
      { x: W - M - 220, y: y - 10, size: 7, font: bold, color: muted },
    );
    page.drawLine({
      start: { x: M, y: y - 26 },
      end: { x: W - M, y: y - 26 },
      thickness: 0.7,
      color: rgb(0.83, 0.88, 0.86),
    });
    y -= 48;
  }
  function ensure(height: number) {
    if (y - height < 60) newPage();
  }
  function lines(text: string, font: PDFFont, size: number, width: number) {
    const out: string[] = [];
    for (const paragraph of text.split("\n")) {
      const words = paragraph.split(/\s+/);
      let line = "";
      for (const word of words) {
        const test = line ? `${line} ${word}` : word;
        if (font.widthOfTextAtSize(test, size) > width && line) {
          out.push(line);
          line = word;
        } else if (font.widthOfTextAtSize(word, size) > width) {
          if (line) out.push(line);
          line = "";
          for (const char of word) {
            if (font.widthOfTextAtSize(line + char, size) > width) {
              out.push(line);
              line = char;
            } else line += char;
          }
        } else line = test;
      }
      out.push(line);
    }
    return out;
  }
  function text(
    text: string,
    size = 10,
    isBold = false,
    color = navy,
    indent = 0,
  ) {
    const font = isBold ? bold : regular;
    for (const l of lines(text, font, size, W - M * 2 - indent)) {
      ensure(size * 1.65);
      page.drawText(l, { x: M + indent, y, size, font, color });
      y -= size * 1.65;
    }
  }
  function gap(n = 10) {
    y -= n;
  }
  function section(title: string) {
    ensure(42);
    gap(8);
    text(title, 13, true, teal);
    gap(7);
  }
  newPage();
  text("BÁO CÁO RÀ SOÁT NHÃN", 21, true);
  text("Preliminary food label review", 10, false, muted);
  gap(16);
  text(snapshot.product.name, 17, true);
  text(
    `${snapshot.product.brand} · ${CATEGORY_LABELS[snapshot.product.category]} · Thị trường Hoa Kỳ`,
    10,
    false,
    muted,
  );
  gap(12);
  const result = RESULT_LABELS[snapshot.result];
  ensure(60);
  page.drawRectangle({
    x: M,
    y: y - 39,
    width: W - M * 2,
    height: 57,
    color: light,
  });
  y -= 1;
  text("KẾT QUẢ TRONG PHẠM VI RÀ SOÁT", 8, true, muted, 12);
  text(
    result,
    11,
    true,
    snapshot.result === "NEEDS_CORRECTION" ? rgb(0.68, 0.25, 0.16) : teal,
    12,
  );
  gap(22);
  section("01  Thông tin hồ sơ");
  text(`Mã review: ${snapshot.review_id}`, 9);
  text(
    `Phiên bản nhãn: v${snapshot.label_version.version} · Tải lên ${formatDate(snapshot.label_version.uploaded_at, true)}`,
    9,
  );
  text(
    `File gốc: ${snapshot.label_version.original_files.map((f) => `${f.name} (${f.page_count} trang; SHA-256: ${f.sha256})`).join("; ")}`,
    8,
    false,
    muted,
  );
  text(
    `Công thức: ${snapshot.product.formula.map((i) => `${i.name_english}${i.percentage !== null ? ` ${i.percentage}%` : ""}`).join(", ")}`,
    9,
  );
  text(
    `Claims khai báo: ${snapshot.product.claims.join("; ") || "Không có claim khai báo."}`,
    9,
  );
  section("02  Phạm vi và giới hạn");
  text(
    "Trà khô đóng gói và trà túi lọc · US federal food labeling MVP. Không gồm kết luận organic certification, country-of-origin marking hoặc phê duyệt FDA.",
    9,
  );
  text(snapshot.disclaimer, 8.5, false, muted);
  gap(4);
  section("03  Phát hiện và hành động");
  if (!snapshot.findings.length)
    text(
      "Không có finding được ghi nhận trong snapshot đã được chuyên viên xác nhận. Không suy rộng kết quả ra ngoài phạm vi báo cáo.",
      9,
    );
  const ordered = [...snapshot.findings].sort(
    (a, b) => SEVERITY_META[a.severity].order - SEVERITY_META[b.severity].order,
  );
  for (let i = 0; i < ordered.length; i++) {
    const f = ordered[i];
    ensure(95);
    gap(8);
    text(
      `${i + 1}. [${SEVERITY_META[f.severity].label.toUpperCase()}] ${f.title}`,
      11,
      true,
    );
    text(
      `${f.rule_key} v${f.rule_version} · ${FINDING_STATUS_LABELS[f.status]} · Confidence: ${f.ai_confidence !== null ? `${Math.round(f.ai_confidence * 100)}%` : "Thủ công"}`,
      8,
      false,
      muted,
    );
    text(f.description, 9);
    text(`Hành động: ${f.suggested_action}`, 9, true);
    for (const e of f.evidence)
      text(
        `Evidence (${e.kind === "dossier" ? "hồ sơ khách hàng" : `file ${e.file_id}, trang ${e.page}`}): “${e.text}”${e.bbox ? ` · bbox [${e.bbox.map((n) => n.toFixed(3)).join(", ")}]` : ""}`,
        8,
        false,
        muted,
      );
    text(
      `Nguồn: ${f.citation_ids.map((id) => snapshot.sources.find((s) => s.id === id)?.citation ?? "citation pending human review").join("; ") || "citation pending human review"}`,
      8,
      false,
      teal,
    );
    text(
      `Quyết định chuyên viên: ${f.reviewer_comment ?? "Chưa ghi nhận."}`,
      8,
      false,
      muted,
    );
    gap(6);
  }
  section("04  Thông tin còn thiếu và yêu cầu bổ sung");
  if (
    !snapshot.missing_information?.length &&
    !snapshot.customer_requests?.some((r) => r.status === "open")
  )
    text(
      "Không có yêu cầu bổ sung đang mở trong snapshot. Kết luận chỉ áp dụng phạm vi đã nêu.",
      9,
    );
  for (const info of snapshot.missing_information ?? []) text(`• ${info}`, 9);
  for (const request of snapshot.customer_requests ?? []) {
    text(
      `${request.status === "open" ? "Đang chờ" : "Đã giải quyết"}: ${request.message}`,
      9,
    );
    if (request.requested_documents.length)
      text(
        `Tài liệu: ${request.requested_documents.join("; ")}`,
        8,
        false,
        muted,
      );
  }
  section("05  Nguồn và phiên bản");
  for (const s of snapshot.sources) {
    text(`${s.citation} · v${s.version} · ${s.status}`, 9, true);
    text(s.canonical_url, 8, false, teal);
    text(
      `SHA-256: ${s.content_hash ?? "Chưa có snapshot"} · Hiệu lực: ${s.effective_from ?? "Chưa xác định"} — ${s.effective_to ?? "Chưa ghi nhận ngày kết thúc"}`,
      7,
      false,
      muted,
    );
    if (s.raw_snapshot_id) {
      text(
        `API edition: ${s.issue_date ?? "Unknown"} · Retrieved: ${s.retrieved_at ?? "Unknown"} · Parser: ${s.parser_version ?? "Unknown"}`,
        7,
        false,
        muted,
      );
      text(
        `Raw snapshot: ${s.raw_snapshot_id} · Raw SHA-256: ${s.raw_content_hash ?? "Unknown"}`,
        7,
        false,
        muted,
      );
      if (s.api_url) text(s.api_url, 7, false, teal);
      if (s.effective_date_unknown)
        text(
          "Effective date unknown: requires human verification; issue date is not the effective date.",
          7,
          false,
          muted,
        );
    }
    gap(7);
  }
  section("06  Xác nhận của chuyên viên");
  text(`Người rà soát: ${snapshot.reviewer.name}`, 10, true);
  text(`Ngày duyệt: ${formatDate(snapshot.reviewer.approved_at, true)}`, 9);
  text(`Ghi chú: ${snapshot.reviewer.comment}`, 9);
  text(
    "Phê duyệt này chỉ xác nhận nội dung báo cáo của Vexim; không phải phê duyệt sản phẩm hoặc nhãn bởi FDA.",
    8,
    false,
    muted,
  );
  section("07  Lịch sử phiên bản nhãn");
  snapshot.version_history.forEach((v) =>
    text(
      `v${v.version} · ${formatDate(v.uploaded_at, true)}${v.version === snapshot.label_version.version ? " · Phiên bản được review" : ""}`,
      9,
    ),
  );
  const count = doc.getPageCount();
  doc.getPages().forEach((p, i) => {
    p.drawLine({
      start: { x: M, y: 42 },
      end: { x: W - M, y: 42 },
      thickness: 0.5,
      color: rgb(0.85, 0.88, 0.87),
    });
    p.drawText("Vexim Label Review · Preliminary review, not FDA approval", {
      x: M,
      y: 28,
      size: 7,
      font: regular,
      color: muted,
    });
    p.drawText(`${i + 1} / ${count}`, {
      x: W - M - 25,
      y: 28,
      size: 7,
      font: regular,
      color: muted,
    });
  });
  return doc.save();
}
export async function browserReportPdf(snapshot: ReportSnapshot) {
  const [r, b] = await Promise.all(
    ["/fonts/ReportSans.ttf", "/fonts/ReportSans-Bold.ttf"].map(async (url) => {
      const response = await fetch(url);
      if (!response.ok) throw new Error("Không tải được font báo cáo.");
      return new Uint8Array(await response.arrayBuffer());
    }),
  );
  return generateReportPdf(snapshot, r, b);
}
