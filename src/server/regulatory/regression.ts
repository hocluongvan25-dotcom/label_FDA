import type { SupabaseClient } from "@supabase/supabase-js";
import type { ComplianceRule, RegulatorySource } from "@/lib/types";
import { runRuleRegression } from "@/lib/regression";
import { RULE_CATALOG, SOURCE_CATALOG } from "@/lib/regulatory";
import { dbError, rpc } from "../context";
interface RuleRef {
  id: string;
  rule_key: string;
  version: number;
  definition_hash: string;
}
export async function verifySnapshotRegression(
  db: SupabaseClient,
  snapshotId: string,
  hash: string,
  requester: string | null,
) {
  const refs = await rpc<RuleRef[]>(db, "app_snapshot_rule_refs", {
    sid: snapshotId,
  });
  const sources = await db.from("regulatory_sources").select("*").limit(2000);
  if (sources.error) throw dbError(sources.error);
  if (
    (sources.count ?? sources.data.length) >= 2000 ||
    (sources.count !== null && sources.count > sources.data.length)
  )
    throw new Error(
      "Regulatory regression source cap reached; narrow registry before testing.",
    );
  const rules = refs.length
    ? await db
        .from("compliance_rules")
        .select("*")
        .in(
          "id",
          refs.map((r) => r.id),
        )
    : { data: [], error: null };
  if (rules.error) throw dbError(rules.error);
  // Synthetic fixture approvals are IN MEMORY ONLY. Never mutate the registry or claim the law is verified.
  const fixtureSources = [
    ...(sources.data as RegulatorySource[]),
    ...SOURCE_CATALOG.filter((s) => !sources.data.some((r) => r.id === s.id)),
  ].map((s) => ({
    ...s,
    status: "CURRENT" as const,
    approved_by: "synthetic-regression-only",
    content_hash: s.content_hash ?? "synthetic-fixture-hash",
    effective_from: null,
    effective_to: null,
    raw_snapshot_id: null,
    ingestion_status: null,
  }));
  const results = runRuleRegression(
    rules.data as ComplianceRule[],
    fixtureSources,
  );
  if (
    refs.some((ref) => !RULE_CATALOG.some((r) => r.rule_key === ref.rule_key))
  )
    results.push({
      rule_key: "UNSUPPORTED_RULE",
      name: "No registered fixture for an affected custom rule",
      passed: false,
      expected: "Registered regression fixture",
      actual: "Human engineering/regulatory review required",
    });
  return rpc<{ passed: boolean }>(db, "vexim_record_snapshot_regression", {
    sid: snapshotId,
    expected_hash: hash,
    rule_refs: refs,
    test_results: results,
    requester,
  });
}
