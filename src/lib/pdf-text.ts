import type { TextContent, TextItem } from "pdfjs-dist/types/src/display/api";
import type { OcrBlock, BoundingBox } from "./types";

// Transform PDF glyph coordinates into the *displayed* page, including /Rotate and crop offsets.
// Text layer confidence measures extraction, not whether the glyphs are visible/compliant.
export function pdfTextBlocks(
  content: TextContent,
  viewport: { width: number; height: number; transform: number[] },
  fileId: string,
  page: number,
): OcrBlock[] {
  const v = viewport.transform;
  const clamp = (n: number) => Math.max(0, Math.min(1, n));
  const pieces = content.items
    .filter((x): x is TextItem => "str" in x && !!x.str.trim())
    .flatMap((item) => {
      const t = item.transform;
      const m = [
        v[0] * t[0] + v[2] * t[1],
        v[1] * t[0] + v[3] * t[1],
        v[0] * t[2] + v[2] * t[3],
        v[1] * t[2] + v[3] * t[3],
        v[0] * t[4] + v[2] * t[5] + v[4],
        v[1] * t[4] + v[3] * t[5] + v[5],
      ];
      const height = Math.hypot(m[2], m[3]);
      const axis = Math.hypot(m[0], m[1]);
      if (!height || !axis || !item.width) return [];
      const right = [m[0] / axis, m[1] / axis];
      const up = [m[2] / height, m[3] / height];
      const width = Math.abs(item.width) * Math.hypot(v[0], v[1]);
      const style = content.styles[item.fontName];
      const ascent = style?.ascent ?? 0.8;
      const descent = style?.descent ?? -0.2;
      const points = [ascent, descent].flatMap((h) =>
        [0, width].map((w) => [
          m[4] + right[0] * w + up[0] * height * h,
          m[5] + right[1] * w + up[1] * height * h,
        ]),
      );
      const bbox: BoundingBox = [
        clamp(Math.min(...points.map((p) => p[0])) / viewport.width),
        clamp(Math.min(...points.map((p) => p[1])) / viewport.height),
        clamp(Math.max(...points.map((p) => p[0])) / viewport.width),
        clamp(Math.max(...points.map((p) => p[1])) / viewport.height),
      ];
      if (bbox[2] <= bbox[0] || bbox[3] <= bbox[1]) return [];
      const angle = (Math.atan2(right[1], right[0]) * 180) / Math.PI;
      return [
        {
          text: item.str,
          bbox,
          angle,
          height,
          normal: -right[1] * m[4] + right[0] * m[5],
          along: right[0] * m[4] + right[1] * m[5],
          width,
        },
      ];
    });
  const groups: (typeof pieces)[] = [];
  for (const piece of pieces.sort(
    (a, b) => a.normal - b.normal || a.along - b.along,
  )) {
    const group = groups.find(
      (g) =>
        Math.abs(g[0].angle - piece.angle) < 1 &&
        Math.abs(g[0].normal - piece.normal) <
          Math.max(g[0].height, piece.height) * 0.5 &&
        Math.min(...g.map((x) => Math.abs(piece.along - (x.along + x.width)))) <
          Math.max(g[0].height, piece.height) * 8,
    );
    if (group) group.push(piece);
    else groups.push([piece]);
  }
  return groups.map((group) => ({
    text: group
      .sort((a, b) => a.along - b.along)
      .map((x) => x.text)
      .join(" "),
    confidence: 0.99,
    file_id: fileId,
    page,
    bbox: [
      Math.min(...group.map((x) => x.bbox[0])),
      Math.min(...group.map((x) => x.bbox[1])),
      Math.max(...group.map((x) => x.bbox[2])),
      Math.max(...group.map((x) => x.bbox[3])),
    ],
    detected_language: "und",
    orientation: Math.round(group[0].angle),
    block_type: "line",
  }));
}
