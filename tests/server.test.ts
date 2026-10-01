import { afterEach, describe, expect, it, vi } from "vitest";
import { readFile, mkdir } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { createCanvas } from "@napi-rs/canvas";
import { validateFileBytes } from "../src/lib/files";
import { normalizeNodePages, validateOriginal } from "../src/server/node-files";
import {
  LocalOcrProvider,
  ApprovedOcrProvider,
  getOcrProvider,
} from "../src/server/providers";
import { scanFile, UnsafeFileError } from "../src/server/virus-scan";
import { readJson } from "../src/server/context";
import { apiHandler } from "../src/server/api-handler";
import { generateReportPdf } from "../src/lib/pdf-report";
import { createSeedData } from "../src/lib/seed";
import type { LabelFile } from "../src/lib/types";
import { simulatedScanner } from "./helpers/scanner";
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
function manifest(bytes: Uint8Array, mime = "application/pdf"): LabelFile {
  return {
    id: randomUUID(),
    name: "synthetic.pdf",
    mime_type: mime,
    size: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    page_count: 1,
    kind: "original",
    storage_path: "test/original",
    scan_status: "clean",
  };
}
async function pdf(pages = 1) {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++) {
    const page = document.addPage([500, 650]);
    [
      "Green tea",
      "Net Wt 1.41 oz (40 g)",
      "Ingredients: Green tea leaves",
      "Nutrition Facts",
      "Manufactured by Test, 1 Street, USA",
    ].forEach((line, n) =>
      page.drawText(line, { x: 30, y: 600 - n * 70, font, size: 16 }),
    );
  }
  return Buffer.from(await document.save());
}

describe("Server boundaries", () => {
  it("returns a real-mode setup error, never demo data from the API", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    const response = await apiHandler(
      new Request("https://app.example/api/v1/workspace"),
      ["workspace"],
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: expect.stringContaining("Supabase"),
    });
  });
  it("requires a bearer token before any workspace/health query", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://supabase.example");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "test-key");
    const response = await apiHandler(
      new Request("https://app.example/api/v1/health"),
      ["health"],
    );
    expect(response.status).toBe(401);
  });
  it("rejects malformed/array/oversized JSON including bodies without content-length", async () => {
    for (const body of [
      "not-json",
      "[]",
      '{"a":"' + "x".repeat(1024 * 1024) + '"}',
    ])
      await expect(
        readJson(new Request("https://app.example", { method: "POST", body })),
      ).rejects.toThrow();
    expect(
      await readJson(
        new Request("https://app.example", {
          method: "POST",
          body: '{"name":"Trà"}',
        }),
      ),
    ).toEqual({ name: "Trà" });
  });
  it("will not send images to an unapproved OCR provider or downgrade invalid provider names", async () => {
    vi.stubEnv("APPROVED_OCR_URL", "https://ocr.example");
    vi.stubEnv("APPROVED_PROVIDER_CONSENT", "false");
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await expect(
      new ApprovedOcrProvider().recognize([], () => {}),
    ).rejects.toThrow(/phê duyệt/);
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.stubEnv("OCR_PROVIDER", "typo-provider");
    expect(() => getOcrProvider()).toThrow(/không được hỗ trợ/);
  });
  it("rejects non-HTTPS approved endpoints before any external request", async () => {
    vi.stubEnv("APPROVED_OCR_URL", "http://ocr.example");
    vi.stubEnv("APPROVED_PROVIDER_CONSENT", "true");
    await expect(
      new ApprovedOcrProvider().recognize([], () => {}),
    ).rejects.toThrow(/HTTPS/);
  });
});

describe("ClamAV protocol (simulated server, not a real antivirus deployment)", () => {
  it("streams complete bytes with bounded frames and accepts an OK response", async () => {
    const scanner = await simulatedScanner();
    vi.stubEnv("CLAMAV_HOST", "127.0.0.1");
    vi.stubEnv("CLAMAV_PORT", String(scanner.port));
    try {
      const bytes = Buffer.alloc(2 * 1024 * 1024, 42);
      expect(await scanFile(bytes)).toBe("clean");
      expect(scanner.received[0].equals(bytes)).toBe(true);
    } finally {
      await scanner.close();
    }
  });
  it("blocks a FOUND response as terminal before OCR", async () => {
    const scanner = await simulatedScanner(
      "stream: Synthetic-Detection FOUND\0",
    );
    vi.stubEnv("CLAMAV_HOST", "127.0.0.1");
    vi.stubEnv("CLAMAV_PORT", String(scanner.port));
    try {
      await expect(
        scanFile(Buffer.from("synthetic test data, not malware")),
      ).rejects.toBeInstanceOf(UnsafeFileError);
    } finally {
      await scanner.close();
    }
  });
  it("fails closed in production despite dev bypass being requested", async () => {
    vi.stubEnv("CLAMAV_HOST", "");
    vi.stubEnv("ALLOW_UNSCANNED_DEV_UPLOADS", "true");
    vi.stubEnv("NODE_ENV", "production");
    await expect(scanFile(Buffer.from("test"))).rejects.toThrow(/scanner/);
    vi.stubEnv("NODE_ENV", "test");
    expect(await scanFile(Buffer.from("test"))).toBe("dev_unscanned");
  });
});

describe("Actual local file normalization / OCR / Unicode PDF rendering", () => {
  it("rejects unsafe types, spoofed MIME, immutable hash/size mismatch", () => {
    expect(() =>
      validateFileBytes(Buffer.from("<svg></svg>"), 11, "image/png"),
    ).toThrow();
    expect(() =>
      validateFileBytes(Buffer.from("%PDF-1.7"), 9, "image/png"),
    ).toThrow(/khớp/);
    const bytes = Buffer.from("%PDF-1.7");
    expect(() =>
      validateOriginal(bytes, { ...manifest(bytes), sha256: "a".repeat(64) }),
    ).toThrow(/Hash/);
    expect(() =>
      validateFileBytes(bytes, 51 * 1024 * 1024, "application/pdf"),
    ).toThrow(/50 MB/);
  });
  it("normalizes an actual two-page PDF and preserves page-grounded text boxes without a model call", async () => {
    const bytes = await pdf(2);
    const pages = await normalizeNodePages(bytes, manifest(bytes));
    expect(pages).toHaveLength(2);
    expect(
      pages.every((p) => p.bytes.subarray(1, 4).toString() === "PNG"),
    ).toBe(true);
    const ocr = await new LocalOcrProvider().recognize(pages, () => {});
    expect(ocr.pages).toBe(2);
    expect(ocr.text).toContain("Nutrition Facts");
    expect(
      ocr.blocks.every(
        (b) =>
          b.bbox[2] > b.bbox[0] &&
          b.bbox[3] > b.bbox[1] &&
          b.bbox.every((n) => n >= 0 && n <= 1),
      ),
    ).toBe(true);
  });
  it("rejects actual PDFs beyond 10 pages", async () => {
    const bytes = await pdf(11);
    await expect(normalizeNodePages(bytes, manifest(bytes))).rejects.toThrow(
      /10 trang/,
    );
  });
  it("runs actual local Tesseract on a normalized PNG, using bundled English data", async () => {
    await mkdir("/tmp/vexim-ocr-cache", { recursive: true });
    const canvas = createCanvas(1300, 550);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "black";
    ctx.font = "bold 64px sans-serif";
    ctx.fillText("GREEN TEA", 50, 130);
    ctx.font = "52px sans-serif";
    ctx.fillText("Net Wt 1.41 oz (40 g)", 50, 260);
    ctx.fillText("Ingredients: Green tea leaves", 50, 390);
    const bytes = canvas.toBuffer("image/png");
    const pages = await normalizeNodePages(bytes, manifest(bytes, "image/png"));
    const result = await new LocalOcrProvider().recognize(pages, () => {});
    expect(result.text.toLowerCase()).toContain("green tea");
    expect(result.blocks.length).toBeGreaterThan(1);
  }, 60000);
  it("creates a real Unicode PDF with the frozen report and explicit demo disclaimer", async () => {
    const report = createSeedData().reports[0];
    const fonts = await Promise.all(
      ["ReportSans.ttf", "ReportSans-Bold.ttf"].map((name) =>
        readFile(`public/fonts/${name}`),
      ),
    );
    const bytes = await generateReportPdf(
      report.snapshot,
      new Uint8Array(fonts[0]),
      new Uint8Array(fonts[1]),
    );
    expect(Buffer.from(bytes.subarray(0, 5)).toString()).toBe("%PDF-");
    const loaded = await PDFDocument.load(bytes);
    expect(loaded.getPageCount()).toBeGreaterThan(1);
    expect(loaded.getAuthor()).toBe(report.snapshot.reviewer.name);
    expect(bytes.length).toBeGreaterThan(15000);
  });
});

describe("Native page coordinate and TIFF regressions", () => {
  it("keeps rotated PDF evidence inside the displayed page with the right orientation", async () => {
    const { degrees } = await import("pdf-lib");
    const doc = await PDFDocument.create();
    const page = doc.addPage([500, 650]);
    page.setRotation(degrees(90));
    page.drawText("Green tea", { x: 30, y: 600, size: 16 });
    page.drawText("Ingredients: Green tea leaves", { x: 30, y: 565, size: 16 });
    page.drawText("NET WT 1.41 OZ (40 g)", { x: 30, y: 530, size: 16 });
    const bytes = await doc.save();
    const result = await normalizeNodePages(
      Buffer.from(bytes),
      manifest(bytes),
    );
    expect(result[0].width).toBeGreaterThan(result[0].height);
    expect(result[0].textBlocks[0].orientation).toBe(90);
    for (const b of result[0].textBlocks) {
      expect(b.bbox.every((v) => v >= 0 && v <= 1)).toBe(true);
      expect(b.bbox[2]).toBeGreaterThan(b.bbox[0]);
      expect(b.bbox[3]).toBeGreaterThan(b.bbox[1]);
    }
    expect(result[0].textBlocks.map((b) => b.text).join("\n")).toContain(
      "Green tea",
    );
  });
  it("normalizes a real TIFF into PNG while preserving the original file identity", async () => {
    const { default: sharp } = await import("sharp");
    const bytes = await sharp({
      create: { width: 240, height: 160, channels: 3, background: "#fff" },
    })
      .tiff()
      .toBuffer();
    const file = manifest(bytes, "image/tiff");
    const pages = await normalizeNodePages(bytes, file);
    expect(pages).toHaveLength(1);
    expect(pages[0]).toMatchObject({
      file_id: file.id,
      page: 1,
      width: 240,
      height: 160,
    });
    expect(validateFileBytes(pages[0].bytes, pages[0].bytes.length)).toBe(
      "image/png",
    );
  });
});
