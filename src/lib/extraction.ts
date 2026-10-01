import { z } from "zod";
import type { ClaimClass, ExtractedField, OcrResult } from "./types";
import { now, uid } from "./utils";

const diseasePattern =
  /\b(cure[sd]?|treat[s]?|prevent[s]?\s+(?:cancer|diabetes|disease)|anti[- ]?cancer|diabetes|cancer|hypertension|arthritis|therapeutic)\b|(?:chữa|điều trị|ngăn ngừa)\s+(?:bệnh|ung thư|tiểu đường)/i;
const nutrientPattern =
  /\b(?:(?:low|high|reduced|free|zero|no added)[ -]?(?:sugar|fat|sodium|calorie|cholesterol|fiber|protein)|(?:sugar|fat|sodium|calorie|cholesterol)[ -]?free|rich in (?:fiber|protein)|good source of)\b/i;
export function classifyClaim(text: string): {
  classification: ClaimClass;
  confidence: number;
} {
  if (diseasePattern.test(text))
    return { classification: "DISEASE_CLAIM", confidence: 0.96 };
  if (/\borganic\b|hữu cơ/i.test(text))
    return { classification: "ORGANIC_CLAIM", confidence: 0.96 };
  if (nutrientPattern.test(text))
    return { classification: "NUTRIENT_CONTENT_CLAIM", confidence: 0.9 };
  if (
    /\b(allergen[- ]free|gluten[- ]free|(?:milk|egg|fish|shellfish|nut|peanut|soy|wheat|sesame|dairy)[- ]free|no peanuts)\b/i.test(
      text,
    )
  )
    return { classification: "ALLERGEN_CLAIM", confidence: 0.88 };
  if (
    /\b(reduces? (?:the )?risk|heart health|protects? (?:the )?heart)\b/i.test(
      text,
    )
  )
    return { classification: "HEALTH_CLAIM", confidence: 0.78 };
  if (
    /\b(supports?|boosts?|promotes?)\s+(?:immun|digestion|metabolism|energy|relaxation)/i.test(
      text,
    )
  )
    return { classification: "STRUCTURE_FUNCTION_CLAIM", confidence: 0.78 };
  if (
    /\b(premium|hand[- ]?picked|traditional|aromatic|delicious|natural|non[- ]?gmo)\b/i.test(
      text,
    )
  )
    return { classification: "MARKETING_ONLY", confidence: 0.8 };
  return { classification: "UNCERTAIN", confidence: 0.5 };
}
export function parseNetQuantity(text: string) {
  const find = (regex: RegExp) => {
    const m = text.match(regex);
    return m ? Number(m[1].replace(",", ".")) : null;
  };
  const grams = find(/([\d]+(?:[.,]\d+)?)\s*g(?:rams?)?\b/i);
  const kilos = find(/([\d]+(?:[.,]\d+)?)\s*kg\b/i);
  const ounces = find(/([\d]+(?:[.,]\d+)?)\s*oz\b/i);
  const pounds = find(/([\d]+(?:[.,]\d+)?)\s*(?:lb|lbs)\b/i);
  const metric_value = grams ?? kilos;
  const imperial_value = ounces ?? pounds;
  const converted_g =
    ounces !== null
      ? ounces * 28.349523125
      : pounds !== null
        ? pounds * 453.59237
        : null;
  const stated_g = grams ?? (kilos !== null ? kilos * 1000 : null);
  return {
    metric_value,
    metric_unit: grams !== null ? "g" : kilos !== null ? "kg" : null,
    imperial_value,
    imperial_unit: ounces !== null ? "oz" : pounds !== null ? "lb" : null,
    consistent:
      converted_g !== null && stated_g !== null
        ? Math.abs(converted_g - stated_g) <= Math.max(1, stated_g * 0.02)
        : null,
  };
}
export function normalizeIngredient(text: string) {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/\([^)]*\)/g, "")
    .replace(/\d+(?:\.\d+)?%/g, "")
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^green tea(?: leaves)?$/, "green tea")
    .replace(/^black tea(?: leaves)?$/, "black tea")
    .replace(/^lotus (?:flower|flowers|petals)$/, "lotus flower")
    .replace(/^tra xanh$/, "green tea")
    .replace(/^tra den$/, "black tea")
    .replace(/^hoa sen$/, "lotus flower")
    .replace(/^(?:me|vung|hat me|hat vung|sesame seeds?)$/, "sesame");
}
export function parseIngredientList(text: string) {
  return text
    .replace(/^\s*(?:ingredients?|thành phần)\s*:\s*/i, "")
    .split(/[,;]+/)
    .map(normalizeIngredient)
    .filter(Boolean);
}
export const ALLERGENS: Record<string, RegExp> = {
  milk: /(?<![\p{L}\p{N}_])(milk|whey|casein|butter|cheese|sữa)(?![\p{L}\p{N}_])/iu,
  egg: /(?<![\p{L}\p{N}_])(eggs?|albumen|trứng)(?![\p{L}\p{N}_])/iu,
  fish: /(?<![\p{L}\p{N}_])(fish|salmon|tuna|cod)(?![\p{L}\p{N}_])/iu,
  shellfish:
    /(?<![\p{L}\p{N}_])(shrimp|prawn|crab|lobster|crayfish|tôm|cua)(?![\p{L}\p{N}_])/iu,
  tree_nuts:
    /(?<![\p{L}\p{N}_])(almonds?|walnuts?|cashews?|pecans?|pistachios?|hazelnuts?|macadamia)(?![\p{L}\p{N}_])/iu,
  peanut:
    /(?<![\p{L}\p{N}_])(peanuts?|groundnuts?|đậu phộng|lạc)(?![\p{L}\p{N}_])/iu,
  wheat: /(?<![\p{L}\p{N}_])(wheat|lúa mì)(?![\p{L}\p{N}_])/iu,
  soy: /(?<![\p{L}\p{N}_])(soy|soya|soybeans?|đậu nành|đậu tương)(?![\p{L}\p{N}_])/iu,
  sesame: /(?<![\p{L}\p{N}_])(sesame|mè|vừng)(?![\p{L}\p{N}_])/iu,
};
export function detectAllergens(text: string) {
  // Milk thistle is a plant, not automatically the milk allergen.
  const clean = text.replace(/milk thistle/gi, "botanical thistle");
  return Object.entries(ALLERGENS)
    .filter(([, p]) => p.test(clean))
    .map(([key]) => key);
}

export function detectDeclaredAllergens(text: string) {
  const affirmative = text
    .replace(/^.*\bmay\s+contain\b.*$/gim, "")
    .replace(/(?:no|without|free from|free of)\s+[^,;\n]+/gi, "")
    .replace(
      /\b(?:milk|egg|fish|shellfish|nuts?|peanuts?|soy|wheat|sesame|dairy|gluten)[ -]free\b/gi,
      "",
    );
  return detectAllergens(affirmative);
}

export function extractFromOcr(ocr: OcrResult): ExtractedField[] {
  const lines = ocr.blocks.filter((b) => b.block_type !== "word");
  const ts = now();
  const definitions: [string, RegExp][] = [
    [
      "statement_of_identity",
      /\b(?:green tea|black tea|oolong tea|herbal tea|lotus tea|jasmine tea|tea bags?|tea leaves)\b/i,
    ],
    [
      "net_quantity",
      /(?:net\s*(?:wt\.?|weight|quantity|contents?)|\d+(?:[.,]\d+)?\s*(?:oz|lb|g|kg)\b)/i,
    ],
    ["ingredient_list", /^\s*(?:ingredients?|thành phần)\s*:/i],
    ["nutrition_facts", /nutrition\s+facts/i],
    ["allergen_statement", /^\s*(?:contains|may contain|allergen)\s*:/i],
    [
      "responsible_party",
      /(?:manufactured|packed|distributed|imported)\s+(?:by|for)(?:\s*:|\s)|manufacturer\s*:/i,
    ],
    ["country_of_origin", /(?:product|made)\s+(?:of|in)\s+|country of origin/i],
    ["caffeine_statement", /caffeine/i],
    ["storage_instruction", /store\s+(?:in|at)|keep\s+(?:dry|in)/i],
    ["use_instruction", /(?:brew|steep|brewing instructions)/i],
  ];
  const fields: ExtractedField[] = definitions.map(([field, pattern]) => {
    const block = lines.find((b) => pattern.test(b.text));
    const next = block ? lines[lines.indexOf(block) + 1] : undefined;
    const isPartyContinuation =
      field === "responsible_party" &&
      next &&
      next.file_id === block?.file_id &&
      next.page === block?.page &&
      next.bbox[1] >= block.bbox[1] &&
      next.bbox[1] - block.bbox[3] < 0.1 &&
      /\d|street|road|ave|vietnam|viet nam|hanoi|usa|ca\s|ny\s|district/i.test(
        next.text,
      );
    const value = block
      ? block.text + (isPartyContinuation ? `\n${next.text}` : "")
      : null;
    const bbox = block
      ? isPartyContinuation
        ? [
            Math.min(block.bbox[0], next.bbox[0]),
            block.bbox[1],
            Math.max(block.bbox[2], next.bbox[2]),
            next.bbox[3],
          ]
        : block.bbox
      : null;
    return {
      id: uid(),
      field,
      value,
      normalized:
        field === "net_quantity" && value ? parseNetQuantity(value) : undefined,
      confidence: block ? block.confidence : 0,
      evidence: {
        file_id: block?.file_id ?? ocr.blocks[0]?.file_id ?? "",
        page: block?.page ?? 1,
        bbox: bbox as ExtractedField["evidence"]["bbox"],
        text:
          value ??
          "Chưa phát hiện trường thông tin này trong các trang đã đọc.",
        kind: block ? "observed" : "absence",
      },
      extraction_model: "deterministic-extractor-v1",
      extracted_at: ts,
    };
  });
  const claimLines = lines.filter(
    (b) =>
      /FDA\s+(approved|certified)|100%\s+legal|guaranteed\s+customs\s+clearance/i.test(
        b.text,
      ) ||
      classifyClaim(b.text).classification !== "UNCERTAIN" ||
      diseasePattern.test(b.text) ||
      nutrientPattern.test(b.text) ||
      /\b(?:organic|natural|non[- ]?gmo|supports?|boosts?|caffeine[- ]free|gluten[- ]free|(?:milk|egg|nut|peanut|soy|wheat|sesame|dairy)[- ]free)\b/i.test(
        b.text,
      ),
  );
  for (const b of claimLines)
    fields.push({
      id: uid(),
      field: "claim",
      value: b.text,
      normalized: classifyClaim(b.text),
      confidence: b.confidence,
      evidence: {
        file_id: b.file_id,
        page: b.page,
        bbox: b.bbox,
        text: b.text,
        kind: "observed",
      },
      extraction_model: "deterministic-extractor-v1",
      extracted_at: ts,
    });
  const english =
    !!fields.find((f) => f.field === "statement_of_identity")?.value &&
    !!fields.find((f) => f.field === "net_quantity")?.value &&
    /^\s*ingredients?\s*:/i.test(
      fields.find((f) => f.field === "ingredient_list")?.value ?? "",
    ) &&
    /(?:manufactured|packed|distributed|imported)\s+(?:by|for)|manufacturer/i.test(
      fields.find((f) => f.field === "responsible_party")?.value ?? "",
    );
  fields.push({
    id: uid(),
    field: "english_required_information",
    value: english ? "detected" : "uncertain",
    confidence: english ? 0.85 : 0.3,
    evidence: {
      file_id: ocr.blocks[0]?.file_id ?? "",
      page: 1,
      bbox: null,
      text: ocr.text.slice(0, 700) || "Không đọc được text.",
      kind: "observed",
    },
    extraction_model: "deterministic-extractor-v1",
    extracted_at: ts,
  });
  return fields;
}
const FIELD_NAMES = [
  "statement_of_identity",
  "net_quantity",
  "ingredient_list",
  "nutrition_facts",
  "allergen_statement",
  "responsible_party",
  "country_of_origin",
  "caffeine_statement",
  "storage_instruction",
  "use_instruction",
  "claim",
  "english_required_information",
] as const;
const evidenceSchema = z.object({
  file_id: z.string(),
  page: z.number().int().min(1).max(10),
  bbox: z
    .tuple([
      z.number().min(0).max(1),
      z.number().min(0).max(1),
      z.number().min(0).max(1),
      z.number().min(0).max(1),
    ])
    .nullable(),
  text: z.string(),
  kind: z.enum(["observed", "absence", "dossier"]).optional(),
});
export const extractionResultSchema = z
  .object({
    fields: z.array(
      z.object({
        field: z.enum(FIELD_NAMES),
        value: z.string().nullable(),
        normalized: z.record(z.string(), z.unknown()).optional(),
        confidence: z.number().min(0).max(1),
        evidence: evidenceSchema,
      }),
    ),
  })
  .strict();
export function validateStructuredExtraction(
  raw: unknown,
  ocr: OcrResult,
): ExtractedField[] {
  const result = extractionResultSchema.parse(raw);
  const seen = new Set<string>();
  const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  return result.fields.map((f) => {
    if (f.field !== "claim" && seen.has(f.field))
      throw new Error("Provider trả field trùng lặp.");
    seen.add(f.field);
    const blocks = ocr.blocks.filter(
      (b) => b.file_id === f.evidence.file_id && b.page === f.evidence.page,
    );
    if (!blocks.length)
      throw new Error("Provider trả về file/page evidence không tồn tại.");
    if (f.evidence.kind === "dossier")
      throw new Error("OCR extraction không được giả mạo evidence từ dossier.");
    if (
      f.evidence.bbox &&
      (f.evidence.bbox[2] <= f.evidence.bbox[0] ||
        f.evidence.bbox[3] <= f.evidence.bbox[1])
    )
      throw new Error("Bounding box không hợp lệ.");
    if (f.value) {
      if (!f.evidence.bbox || f.evidence.kind === "absence")
        throw new Error("Observed field cần bbox và observed evidence.");
      const box = f.evidence.bbox;
      const matching = blocks.filter(
        (b) =>
          b.bbox[0] < box[2] &&
          b.bbox[2] > box[0] &&
          b.bbox[1] < box[3] &&
          b.bbox[3] > box[1],
      );
      const text = normalize(matching.map((b) => b.text).join(" "));
      if (
        !text.includes(normalize(f.value)) ||
        !text.includes(normalize(f.evidence.text))
      )
        throw new Error("Provider trả nội dung ngoài vùng OCR evidence.");
      f.confidence = Math.min(
        f.confidence,
        ...matching.map((b) => b.confidence),
      );
    } else {
      f.value = null;
      f.confidence = 0;
      f.evidence.kind = "absence";
    }
    return {
      ...f,
      id: uid(),
      extraction_model: "approved-structured-provider",
      extracted_at: now(),
    };
  });
}
