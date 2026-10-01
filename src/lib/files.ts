import { pdfTextBlocks } from "./pdf-text";
import { ACCEPTED_MIMES, MAX_FILE_SIZE, MAX_PDF_PAGES } from "./constants";
import type { LabelFile, OcrBlock } from "./types";
import { sha256, uid } from "./utils";

export function detectMime(bytes: Uint8Array): string | null {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  )
    return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return "image/jpeg";
  if (new TextDecoder().decode(bytes.slice(0, 5)) === "%PDF-")
    return "application/pdf";
  if (
    (bytes[0] === 0x49 &&
      bytes[1] === 0x49 &&
      bytes[2] === 0x2a &&
      bytes[3] === 0) ||
    (bytes[0] === 0x4d &&
      bytes[1] === 0x4d &&
      bytes[2] === 0 &&
      bytes[3] === 0x2a)
  )
    return "image/tiff";
  return null;
}
export function validateFileBytes(
  bytes: Uint8Array,
  size: number,
  claimedMime?: string,
) {
  if (size === 0) throw new Error("File rỗng.");
  if (size > MAX_FILE_SIZE) throw new Error("File vượt quá giới hạn 50 MB.");
  const mime = detectMime(bytes);
  if (!mime || !ACCEPTED_MIMES.includes(mime))
    throw new Error(
      "Nội dung file không phải PDF, PNG, JPEG hoặc TIFF hợp lệ.",
    );
  if (
    claimedMime &&
    ACCEPTED_MIMES.includes(claimedMime) &&
    claimedMime !== mime
  )
    throw new Error("Loại file khai báo không khớp với nội dung thực tế.");
  return mime;
}
export async function loadPdf(buffer: ArrayBuffer) {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf/pdf.worker.min.mjs";
  const document = await pdfjs.getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
  }).promise;
  if (document.numPages > MAX_PDF_PAGES) {
    await document.loadingTask.destroy();
    throw new Error("PDF vượt quá giới hạn 10 trang.");
  }
  return document;
}
export async function prepareUpload(
  file: File,
  inspectPages = true,
): Promise<LabelFile> {
  const bytes = await file.arrayBuffer();
  const mime = validateFileBytes(
    new Uint8Array(bytes.slice(0, 20)),
    file.size,
    file.type,
  );
  let pages = 1;
  if (inspectPages && mime === "application/pdf") {
    const pdf = await loadPdf(bytes.slice(0));
    pages = pdf.numPages;
    await pdf.loadingTask.destroy();
  }
  if (inspectPages && mime === "image/tiff") {
    const utif = await import("utif");
    const ifds = utif.decode(bytes);
    pages = ifds.length;
    if (!pages || pages > 10) throw new Error("TIFF cần từ 1 đến 10 trang.");
  }
  const id = uid();
  return {
    id,
    name: file.name,
    mime_type: mime,
    size: file.size,
    storage_path: `local/${id}`,
    sha256: await sha256(bytes),
    page_count: pages,
    scan_status: "dev_unscanned",
    kind: "original",
  };
}
export interface NormalizedPage {
  image: Blob;
  width: number;
  height: number;
  page: number;
  textBlocks: OcrBlock[];
}
function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) =>
        b ? resolve(b) : reject(new Error("Không tạo được ảnh normalized.")),
      "image/png",
    ),
  );
}
export async function normalizePages(
  blob: Blob,
  file: LabelFile,
): Promise<NormalizedPage[]> {
  if (file.mime_type === "application/pdf") {
    const pdf = await loadPdf(await blob.arrayBuffer());
    const pages: NormalizedPage[] = [];
    try {
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({
          scale: Math.min(2, 2400 / Math.max(base.width, base.height)),
        });
        if (
          viewport.width <= 0 ||
          viewport.height <= 0 ||
          viewport.width * viewport.height > 32_000_000
        )
          throw new Error("Kích thước trang PDF không an toàn.");
        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Trình duyệt không hỗ trợ canvas.");
        await page.render({ canvasContext: context, viewport, canvas }).promise;
        const textContent = await page.getTextContent();
        const blocks = pdfTextBlocks(textContent, base, file.id, i);
        pages.push({
          image: await canvasBlob(canvas),
          width: canvas.width,
          height: canvas.height,
          page: i,
          textBlocks: blocks,
        });
        page.cleanup();
      }
    } finally {
      await pdf.loadingTask.destroy();
    }
    return pages;
  }
  if (file.mime_type === "image/tiff") {
    const UTIF = await import("utif");
    const bytes = await blob.arrayBuffer();
    const ifds = UTIF.decode(bytes);
    const pages: NormalizedPage[] = [];
    for (let i = 0; i < ifds.length; i++) {
      const ifd = ifds[i];
      UTIF.decodeImage(bytes, ifd);
      if (!ifd.width || !ifd.height || ifd.width * ifd.height > 32_000_000)
        throw new Error("Ảnh TIFF quá lớn hoặc không có kích thước hợp lệ.");
      const canvas = document.createElement("canvas");
      canvas.width = ifd.width;
      canvas.height = ifd.height;
      const rgba = new Uint8ClampedArray(UTIF.toRGBA8(ifd));
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Không tạo được canvas.");
      ctx.putImageData(new ImageData(rgba, ifd.width, ifd.height), 0, 0);
      pages.push({
        image: await canvasBlob(canvas),
        width: ifd.width,
        height: ifd.height,
        page: i + 1,
        textBlocks: [],
      });
    }
    return pages;
  }
  const bitmap = await createImageBitmap(blob);
  try {
    if (bitmap.width * bitmap.height > 32_000_000)
      throw new Error("Ảnh vượt 32 megapixel. Hãy giảm độ phân giải.");
    const ratio = Math.min(1, 2400 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * ratio);
    canvas.height = Math.round(bitmap.height * ratio);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Không tạo được canvas.");
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return [
      {
        image: await canvasBlob(canvas),
        width: canvas.width,
        height: canvas.height,
        page: 1,
        textBlocks: [],
      },
    ];
  } finally {
    bitmap.close();
  }
}
