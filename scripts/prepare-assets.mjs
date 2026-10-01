import { mkdir, copyFile } from "node:fs/promises";
import { resolve } from "node:path";

// Browser OCR is fully local: no label is sent to a third-party OCR service.
const root = process.cwd();
await mkdir(resolve(root, "public/ocr/lang"), { recursive: true });
await mkdir(resolve(root, "public/pdf"), { recursive: true });
const assets = [
  ["node_modules/tesseract.js/dist/worker.min.js", "public/ocr/worker.min.js"],
  [
    "node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js",
    "public/ocr/tesseract-core-lstm.wasm.js",
  ],
  [
    "node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js",
    "public/ocr/tesseract-core-simd-lstm.wasm.js",
  ],
  [
    "node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz",
    "public/ocr/lang/eng.traineddata.gz",
  ],
  [
    "node_modules/pdfjs-dist/build/pdf.worker.min.mjs",
    "public/pdf/pdf.worker.min.mjs",
  ],
];
for (const [from, to] of assets)
  await copyFile(resolve(root, from), resolve(root, to));
console.log("Local OCR and PDF assets prepared.");
