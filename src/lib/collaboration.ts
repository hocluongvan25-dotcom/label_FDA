import type { LabelVersion } from "./types";
import { sha256 } from "./utils";

/**
 * Local-demo counterpart to the database's ordered original-file manifest
 * hash. It deliberately refuses unscanned fixtures rather than treating a
 * browser-only demo file as malware-cleared.
 */
export async function localLabelBundleSha256(label: LabelVersion) {
  const originals = label.original_files
    .filter((file) => file.kind === "original")
    .map((file) => ({ name: file.name, sha256: file.sha256 }))
    .sort((a, b) =>
      a.name === b.name
        ? a.sha256.localeCompare(b.sha256)
        : a.name.localeCompare(b.name),
    );
  if (!originals.length)
    throw new Error("Phiên bản nhãn không có file gốc để xác nhận.");
  if (
    label.original_files.some(
      (file) => file.kind === "original" && file.scan_status !== "clean",
    )
  )
    throw new Error(
      "Mọi file gốc phải hoàn thành malware scan trước khi ghi nhận quyết định hoặc chia sẻ.",
    );
  return sha256(JSON.stringify(originals));
}
