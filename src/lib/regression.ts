import type {
  ComplianceRule,
  ExtractedField,
  Product,
  RegulatorySource,
} from "./types";
import { evaluateRules } from "./rules-engine";
import { SOURCE_CATALOG, RULE_CATALOG } from "./regulatory";

export interface RegressionResult {
  rule_key: string;
  name: string;
  passed: boolean;
  expected: string;
  actual: string;
}
export function runRuleRegression(
  candidateRules: ComplianceRule[],
  candidateSources: RegulatorySource[],
): RegressionResult[] {
  const sources = candidateSources.map((s) => ({
    ...s,
    status: "CURRENT" as const,
    content_hash: s.content_hash ?? "fixture-hash",
  }));
  const baseline = RULE_CATALOG.map((r) => ({
    ...r,
    status: "ACTIVE" as const,
    effective_from: null,
  }));
  const rules = baseline
    .map((r) => candidateRules.find((c) => c.rule_key === r.rule_key) ?? r)
    .map((r) => ({
      ...r,
      status: "ACTIVE" as const,
      effective_from: null,
      effective_to: null,
      source_snapshot: r.source_citations
        .map((id) => sources.find((s) => s.id === id)!)
        .filter(Boolean)
        .map((s) => ({
          id: s.id,
          version: s.version,
          content_hash: s.content_hash,
        })),
    }));
  const p: Product = {
    id: "fixture",
    organization_id: "fixture-org",
    name: "Green tea",
    brand: "Fixture",
    category: "dry_packaged_tea",
    form: "loose_leaf",
    market: "US",
    channel: ["retail"],
    expected_us_units_12m: 1000,
    employee_fte: 5,
    classification_status: "conventional_food",
    formula: [
      {
        id: "i",
        name_original: "Trà xanh",
        name_english: "Green tea leaves",
        normalized_name: "green_tea",
        percentage: 100,
        order: 1,
        allergen_groups: [],
        source: "customer_input",
      },
    ],
    claims: [],
    package_size: "40 g",
    net_quantity: "1.41 oz (40 g)",
    manufacturer: { name: "Fixture", address: "1 Street" },
    packer: { name: "", address: "" },
    distributor: { name: "", address: "" },
    importer: { name: "", address: "" },
    certifications: [],
    exemption_requested: false,
    formula_confirmed: true,
    claims_confirmed: true,
    assigned_to: "fixture",
    created_by: "fixture",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    color: "sage",
  };
  const fieldValues: Record<string, string> = {
    statement_of_identity: "Green tea",
    net_quantity: "1.41 oz (40 g)",
    ingredient_list: "Ingredients: Green tea leaves",
    nutrition_facts: "Nutrition Facts",
    responsible_party: "Manufactured by Fixture, 1 Street, USA",
    english_required_information: "detected",
  };
  const fields: ExtractedField[] = Object.entries(fieldValues).map(
    ([field, value], i) => ({
      id: String(i),
      field,
      value,
      confidence: 0.99,
      evidence: {
        file_id: "fixture-file",
        page: 1,
        bbox: [0.1, 0.1 + i * 0.1, 0.8, 0.16 + i * 0.1],
        text: value,
        kind: "observed",
      },
      extraction_model: "test-fixture",
      extracted_at: "2026-01-01T00:00:00Z",
    }),
  );
  const modifications: Record<
    string,
    (product: Product, fields: ExtractedField[]) => void
  > = {
    "IDENTITY-001": (_, f) => {
      f.find((x) => x.field === "statement_of_identity")!.value = null;
    },
    "NETQTY-001": (_, f) => {
      f.find((x) => x.field === "net_quantity")!.value = null;
    },
    "INGREDIENT-001": (_, f) => {
      f.find((x) => x.field === "ingredient_list")!.value = null;
    },
    "NUTRITION-001": (_, f) => {
      f.find((x) => x.field === "nutrition_facts")!.value = null;
    },
    "NUTRITION-002": (p) => {
      p.exemption_requested = true;
      p.claims = ["Sugar-free"];
    },
    "ALLERGEN-001": (p) => {
      p.formula[0].allergen_groups = ["soy"];
    },
    "ALLERGEN-002": (p) => {
      p.formula[0].allergen_groups = ["sesame"];
    },
    "CLAIM-001": (p) => {
      p.claims = ["Helps treat diabetes"];
    },
    "CLAIM-002": (p) => {
      p.claims = ["Low sugar"];
    },
    "CLAIM-003": (p) => {
      p.claims = ["Natural green tea"];
    },
    "FORMULA-001": (p) => {
      p.formula[0].name_english = "Black tea leaves";
    },
    "LABEL-001": (_, f) => {
      f[0].confidence = 0.4;
    },
    "LABEL-002": (_, f) => {
      f.find((x) => x.field === "english_required_information")!.value =
        "uncertain";
    },
    "PARTY-001": (_, f) => {
      f.find((x) => x.field === "responsible_party")!.value = null;
    },
    "CLASS-001": (p) => {
      p.category = "dietary_supplement";
      p.classification_status = "out_of_scope";
    },
  };
  const referenceSources = sources.length ? sources : SOURCE_CATALOG;
  return rules.map((rule) => {
    const product = structuredClone(p);
    const inputFields = structuredClone(fields);
    modifications[rule.rule_key]?.(product, inputFields);
    const output = evaluateRules({
      product,
      fields: inputFields,
      rules,
      sources: referenceSources,
      reviewId: "fixture-review",
    });
    const fired = output.findings.find((f) => f.rule_key === rule.rule_key);
    const diseaseClaimIsTriageOnly = rule.rule_key === "CLAIM-001";
    const passed = diseaseClaimIsTriageOnly
      ? !fired &&
        output.warnings.some((warning) => warning.includes("claim bệnh lý"))
      : !!fired && fired.severity === rule.action_json.severity;
    return {
      rule_key: rule.rule_key,
      name: rule.name,
      passed,
      expected: diseaseClaimIsTriageOnly
        ? "CLAIM-001: expert triage signal without a compliance finding"
        : `${rule.rule_key}: ${rule.action_json.severity}`,
      actual: fired
        ? `${fired.rule_key}: ${fired.severity}`
        : diseaseClaimIsTriageOnly && passed
          ? "Expert triage warning; no automated finding"
          : "Không phát hiện finding kỳ vọng",
    };
  });
}
