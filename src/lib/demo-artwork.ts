import type { LabelFile } from "./types";

type DemoArtworkFile = Pick<
  LabelFile,
  "kind" | "mime_type" | "scan_status" | "storage_path" | "size" | "sha256"
>;
type MockScannableDemoArtworkFile = Pick<
  LabelFile,
  | "id"
  | "name"
  | "kind"
  | "mime_type"
  | "scan_status"
  | "storage_path"
  | "size"
  | "sha256"
  | "preview_url"
>;

const SEEDED_DEMO_ARTWORK_ID_PREFIX = "10000000-0000-4000-8000-";
const SEEDED_FRONT_PREVIEWS = new Set([
  "/samples/lotus-front-v2.svg",
  "/samples/jasmine-front.svg",
  "/samples/oolong-front.svg",
]);
const SEEDED_BACK_PREVIEW = "/samples/lotus-back-v2.svg";

const BUNDLED_DEMO_ARTWORK: Readonly<
  Record<string, { previewUrl: string; size: number; sha256: string }>
> = Object.freeze({
  "demo-static/lotus-front-v2.svg": {
    previewUrl: "/samples/lotus-front-v2.svg",
    size: 3130,
    sha256: "f59f85ab26e113c50d1524ea8ddb7ec78b380672bd7d921a115c5b9719793177",
  },
  "demo-static/lotus-back-v2.svg": {
    previewUrl: "/samples/lotus-back-v2.svg",
    size: 2253,
    sha256: "ae6821bb45d6bca1a3d241a9eab5947cba3b76d7b861c50da0199112f8f8fa02",
  },
});

export function demoArtworkPreviewUrl(file: DemoArtworkFile): string | null {
  if (
    !Object.prototype.hasOwnProperty.call(
      BUNDLED_DEMO_ARTWORK,
      file.storage_path,
    )
  )
    return null;
  const asset = BUNDLED_DEMO_ARTWORK[file.storage_path];
  if (
    !asset ||
    file.kind !== "original" ||
    file.mime_type !== "image/svg+xml" ||
    file.scan_status !== "dev_unscanned" ||
    file.size !== asset.size ||
    file.sha256 !== asset.sha256
  )
    return null;
  return asset.previewUrl;
}

export function isBundledDemoArtwork(file: DemoArtworkFile): boolean {
  return demoArtworkPreviewUrl(file) !== null;
}

/**
 * Local-only Mock Scan allowlist. This recognizes the fixed, bundled seed
 * fixtures without changing their real scan_status from dev_unscanned. It must
 * never be used as evidence for the server-side scan gate.
 */
export function isMockScannableDemoArtwork(
  file: MockScannableDemoArtworkFile,
): boolean {
  if (file.kind !== "original" || file.scan_status !== "dev_unscanned")
    return false;
  if (isBundledDemoArtwork(file)) return true;

  if (
    !file.id.startsWith(SEEDED_DEMO_ARTWORK_ID_PREFIX) ||
    file.mime_type !== "image/svg+xml" ||
    file.sha256 !== "DEMO_FIXTURE"
  )
    return false;
  const seedFileNumber = Number(file.id.slice(SEEDED_DEMO_ARTWORK_ID_PREFIX.length));
  if (!Number.isInteger(seedFileNumber) || seedFileNumber < 3 || seedFileNumber > 24)
    return false;

  if (file.storage_path === "demo/front")
    return (
      seedFileNumber % 2 === 1 &&
      file.name === "tea-front-v2.svg" &&
      file.size === 248832 &&
      !!file.preview_url &&
      SEEDED_FRONT_PREVIEWS.has(file.preview_url)
    );
  if (file.storage_path === "demo/back")
    return (
      seedFileNumber % 2 === 0 &&
      file.name === "tea-back-v2.svg" &&
      file.size === 189120 &&
      file.preview_url === SEEDED_BACK_PREVIEW
    );
  return false;
}
