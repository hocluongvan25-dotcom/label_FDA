import sharp from "sharp";
import { createHash } from "node:crypto";
import type { LabelFile, OcrBlock } from "@/lib/types";
import { validateFileBytes } from "@/lib/files";
import { pdfTextBlocks } from "@/lib/pdf-text";
import { UnsafeFileError } from "./virus-scan";

export interface NodePage {
  bytes: Buffer;
  width: number;
  height: number;
  page: number;
  file_id: string;
  textBlocks: OcrBlock[];
}
export function validateOriginal(bytes: Buffer, file: LabelFile) {
  const mime = validateFileBytes(
    new Uint8Array(bytes.subarray(0, 20)),
    bytes.length,
    file.mime_type,
  );
  const hash = createHash("sha256").update(bytes).digest("hex");
  if (hash !== file.sha256 || bytes.length !== file.size)
    throw new UnsafeFileError(
      "Hash / kích thước file gốc không khớp manifest.",
    );
  return mime;
}
export async function normalizeNodePages(
  bytes: Buffer,
  file: LabelFile,
): Promise<NodePage[]> {
  const mime = validateOriginal(bytes, file);
  if (mime === "application/pdf") {
    const canvasLib = await import("@napi-rs/canvas");
    if (!globalThis.DOMMatrix)
      Object.defineProperty(globalThis, "DOMMatrix", {
        value: canvasLib.DOMMatrix,
        configurable: true,
      });
    if (!globalThis.ImageData)
      Object.defineProperty(globalThis, "ImageData", {
        value: canvasLib.ImageData,
        configurable: true,
      });
    if (!globalThis.Path2D)
      Object.defineProperty(globalThis, "Path2D", {
        value: canvasLib.Path2D,
        configurable: true,
      });
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const task = pdfjs.getDocument({
      data: new Uint8Array(bytes),
      useSystemFonts: true,
      useWorkerFetch: false,
    });
    const doc = await task.promise;
    try {
      if (doc.numPages > 10)
        throw new UnsafeFileError("PDF vượt quá 10 trang.");
      const pages: NodePage[] = [];
      for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
        const page = await doc.getPage(pageNumber);
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({
          scale: Math.min(2, 2400 / Math.max(base.width, base.height)),
        });
        if (
          viewport.width * viewport.height > 32_000_000 ||
          viewport.width <= 0 ||
          viewport.height <= 0
        )
          throw new UnsafeFileError("Kích thước trang PDF không an toàn.");
        const canvas = canvasLib.createCanvas(
          Math.ceil(viewport.width),
          Math.ceil(viewport.height),
        );
        const context = canvas.getContext("2d");
        await page.render({
          canvas: canvas as unknown as HTMLCanvasElement,
          canvasContext: context as unknown as CanvasRenderingContext2D,
          viewport,
        }).promise;
        const content = await page.getTextContent();
        const textBlocks = pdfTextBlocks(content, base, file.id, pageNumber);
        pages.push({
          bytes: canvas.toBuffer("image/png"),
          width: canvas.width,
          height: canvas.height,
          page: pageNumber,
          file_id: file.id,
          textBlocks,
        });
        page.cleanup();
      }
      return pages;
    } finally {
      await doc.loadingTask.destroy();
    }
  }
  const meta = await sharp(bytes, { limitInputPixels: 32_000_000 }).metadata();
  const count = mime === "image/tiff" ? (meta.pages ?? 1) : 1;
  if (count > 10) throw new UnsafeFileError("TIFF vượt quá 10 trang.");
  const pages: NodePage[] = [];
  for (let i = 0; i < count; i++) {
    const result = await sharp(bytes, {
      limitInputPixels: 32_000_000,
      page: i,
      pages: 1,
      sequentialRead: true,
    })
      .rotate()
      .resize({
        width: 2400,
        height: 2400,
        fit: "inside",
        withoutEnlargement: true,
      })
      .flatten({ background: "#fff" })
      .png()
      .toBuffer({ resolveWithObject: true });
    pages.push({
      bytes: result.data,
      width: result.info.width,
      height: result.info.height,
      page: i + 1,
      file_id: file.id,
      textBlocks: [],
    });
  }
  return pages;
}
