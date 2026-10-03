import type { LabelFile } from "./types";

type DemoArtworkFile = Pick<
  LabelFile,
  "kind" | "mime_type" | "scan_status" | "storage_path" | "size" | "sha256"
>;

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
