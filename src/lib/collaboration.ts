import type { LabelVersion } from "./types";
import { isMockScannableDemoArtwork } from "./demo-artwork";
import { sha256 } from "./utils";

/**
 * Local-demo counterpart to the database's ordered original-file manifest
 * hash. Mock scan IDs are optional and validated against the bundled demo
 * artwork allowlist; production/server scan gates remain unchanged.
 */
export async function localLabelBundleSha256(
  label: LabelVersion,
  options: { demoMockScannedFileIds?: ReadonlySet<string> } = {},
) {
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
  const mockScannedFileIds = options.demoMockScannedFileIds ?? new Set<string>();
  if (
    label.original_files.some(
      (file) =>
        file.kind === "original" &&
        file.scan_status !== "clean" &&
        !(
          file.scan_status === "dev_unscanned" &&
          mockScannedFileIds.has(file.id) &&
          isMockScannableDemoArtwork(file)
        ),
    )
  )
    throw new Error(
      "Mọi file gốc phải hoàn thành malware scan thật hoặc thuộc Mock Scan Demo hợp lệ trước khi ghi nhận quyết định/chia sẻ.",
    );
  return sha256(JSON.stringify(originals));
}
