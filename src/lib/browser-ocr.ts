import type { LabelFile, OcrBlock, OcrResult } from "./types";
import type { NormalizedPage } from "./files";

export async function recognizePages(
  pages: { file: LabelFile; page: NormalizedPage }[],
  onProgress: (progress: number, message: string) => void,
): Promise<OcrResult> {
  const allBlocks: OcrBlock[] = [];
  let worker:
    | Awaited<ReturnType<(typeof import("tesseract.js"))["createWorker"]>>
    | undefined;
  try {
    for (let i = 0; i < pages.length; i++) {
      const { file, page } = pages[i];
      if (page.textBlocks.length >= 3) {
        allBlocks.push(...page.textBlocks);
        onProgress(
          (i + 1) / pages.length,
          `Đã đọc text layer trang ${page.page}: ${file.name}`,
        );
        continue;
      }
      if (!worker) {
        const { createWorker } = await import("tesseract.js");
        worker = await createWorker(
          "eng",
          1,
          {
            workerPath: "/ocr/worker.min.js",
            corePath: "/ocr",
            langPath: "/ocr/lang",
            cacheMethod: "write",
            logger: (m) => {
              if (m.status === "recognizing text")
                onProgress(
                  (i + (m.progress ?? 0)) / pages.length,
                  `OCR trang ${page.page}: ${file.name}`,
                );
            },
          },
          { load_system_dawg: "1", load_freq_dawg: "1" },
        );
      }
      const { data } = await worker.recognize(
        page.image,
        {},
        { blocks: true, text: true },
      );
      const lines =
        data.blocks?.flatMap((block) =>
          block.paragraphs.flatMap((paragraph) => paragraph.lines),
        ) ?? [];
      for (const line of lines) {
        const { x0, y0, x1, y1 } = line.bbox;
        allBlocks.push({
          text: line.text.trim(),
          confidence: Math.max(0, Math.min(1, line.confidence / 100)),
          file_id: file.id,
          page: page.page,
          bbox: [
            x0 / page.width,
            y0 / page.height,
            x1 / page.width,
            y1 / page.height,
          ],
          detected_language: "en",
          orientation: 0,
          block_type: "line",
        });
      }
      onProgress(
        (i + 1) / pages.length,
        `Đã đọc trang ${page.page}: ${file.name}`,
      );
    }
  } finally {
    await worker?.terminate();
  }
  if (!allBlocks.length)
    throw new Error(
      "OCR không đọc được nội dung. Hãy tải nhãn rõ hơn hoặc chuyển chuyên viên nhập thủ công.",
    );
  return {
    text: allBlocks.map((b) => b.text).join("\n"),
    blocks: allBlocks,
    confidence:
      allBlocks.reduce((s, b) => s + b.confidence, 0) / allBlocks.length,
    pages: pages.length,
    model: "local-tesseract-6/pdf-text-layer",
  };
}
