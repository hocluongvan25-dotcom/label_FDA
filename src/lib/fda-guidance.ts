export const FDA_GUIDANCE_SOURCES = {
  "fda-label-claims": {
    source_key: "fda-label-claims",
    job_kind: "fda_label_claims_html",
    format: "HTML",
    authority: "FDA",
    agency: "FDA",
    document_type: "guidance",
    citation: "FDA Label Claims Guidance",
    title: "Label claims for conventional foods and dietary supplements",
    canonical_url:
      "https://www.fda.gov/food/nutrition-food-labeling-and-critical-foods/label-claims-conventional-foods-and-dietary-supplements",
    topic: "claims",
  },
  "fda-food-label-guide": {
    source_key: "fda-food-label-guide",
    job_kind: "fda_food_label_guide_pdf",
    format: "PDF",
    authority: "FDA",
    agency: "FDA",
    document_type: "guidance",
    citation: "FDA Food Labeling Guide",
    title: "A Food Labeling Guide",
    canonical_url:
      "https://www.fda.gov/files/food/published/Food-Labeling-Guide-%28PDF%29.pdf",
    topic: "general",
  },
} as const;

export type FdaGuidanceSourceKey = keyof typeof FDA_GUIDANCE_SOURCES;
export type FdaGuidanceJobKind =
  (typeof FDA_GUIDANCE_SOURCES)[FdaGuidanceSourceKey]["job_kind"];
export type FdaGuidanceFormat =
  (typeof FDA_GUIDANCE_SOURCES)[FdaGuidanceSourceKey]["format"];
export type RegulatoryJobKind =
  | "ecfr_part101"
  | "ecfr_section"
  | "ecfr_discovery"
  | "fr_monitor"
  | FdaGuidanceJobKind;

export const FDA_GUIDANCE_BY_JOB = {
  fda_label_claims_html: FDA_GUIDANCE_SOURCES["fda-label-claims"],
  fda_food_label_guide_pdf: FDA_GUIDANCE_SOURCES["fda-food-label-guide"],
} as const;

export function fdaGuidanceSourceForJob(kind: string) {
  if (!Object.hasOwn(FDA_GUIDANCE_BY_JOB, kind)) return null;
  return FDA_GUIDANCE_BY_JOB[kind as FdaGuidanceJobKind];
}
