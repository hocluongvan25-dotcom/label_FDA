# Risk-based triage and pre-screening

## Policy and independent state fields

The deterministic policy is versioned as `risk-based-triage/1.0.0` in `src/lib/triage.ts`. Reviews store the process route (`triage_route`), automated outcome (`overall_result`), reason list (`triage_reasons`), risk score, report lifecycle (`report_status`), and expert lifecycle (`expert_review_status`) independently. Findings remain in `public.findings`; they are not inferred from the route or score. Each worker evaluation is also appended to `public.review_triage_runs`.

The route precedence is fixed and is evaluated only after every gate has been collected:

1. `OUT_OF_SCOPE`
2. `BLOCKED_REGULATORY_SOURCE`
3. `EXPERT_REVIEW_REQUIRED`
4. `NEEDS_CUSTOMER_INFORMATION`
5. `AUTO_SCREENED`

All applicable reasons are retained, including reasons behind the winning route. Risk scoring can add an expert-review gate; it cannot clear or bypass any higher-priority hard gate.

Disease, health, and structure/function claim signals go to an expert without an automated legal-violation finding. A disease-claim keyword alone is not recorded as a compliance violation. Unsupported product scope, incomplete source/rule packs, unresolved references, failed or missing parser coverage, unclear effective dates, incomplete OCR coverage, low OCR confidence, and missing customer confirmations each have explicit reason codes.

## Report boundaries

`AUTO_SCREENED` is a route, not a compliance result. Candidate results use neutral values such as `NO_AUTOMATED_ISSUE_DETECTED` or `POTENTIAL_ISSUES_FOUND`; neither is a final determination. A machine-created artifact, when separately enabled, is stored only in `public.pre_screening_reports` with disclaimer profile `PRE_SCREENING_ONLY`. It does not insert into `public.reports`, approve a review, or satisfy the reviewer gate. Final reports continue to use the existing reviewer-approved `vexim_approve_report` flow. A final report insertion updates `overall_result` from the reviewed report, sets `report_status` and `expert_review_status='EXPERT_REVIEWED'`, and leaves the original route intact; the append-only triage run retains the automated result. `EXPERT_REVIEWED` is lifecycle state, never a route.

The pre-screen artifact intentionally excludes raw label text and includes only safe finding summaries, route/outcome metadata, and the versioned rules/source identifiers. Both the service and database reject prohibited approval/export wording in that artifact.

## Activation controls

Pre-screening artifact issuance is **off by default**. Issuance requires all of the following:

- `REGULATORY_PRE_SCREENING_ENABLED=true`, `REGULATORY_PRE_SCREENING_ENV=staging`, and a positive staging marker (`DEPLOYMENT_ENV=staging` or Vercel preview) in the trusted worker runtime;
- the runtime must not identify as Vercel production or `DEPLOYMENT_ENV=production`;
- the staging database flag must be enabled for the exact allowlisted organization via `vexim_set_triage_pre_screening`; and
- triage must select `AUTO_SCREENED`, with every hard gate clear.

The migration initializes the database flag as disabled with an empty allowlist. Do not activate a production allowlist or copy staging settings into the production database. This code change does not enable staging or production issuance.

## Staging qualification before limited activation

Use only synthetic tea-family dossiers and synthetic label assets in an isolated staging Supabase project. Before changing either activation control:

1. Confirm dry packaged tea / tea-bag scope and the staging organization allowlist.
2. Confirm the complete 15-rule tea pack is `ACTIVE`, regression-tested, and references only current/approved source versions.
3. Confirm source snapshots are `ACTIVE`, effective dates are known, parser `coverage_complete` and `citations_valid` are true, and every rule/finding citation resolves to the exact version and content hash.
4. Exercise each route, the fixed precedence, and simultaneous gates using synthetic cases; confirm all reasons persist and disease/health claims do not create automated violation findings.
5. Verify that only `AUTO_SCREENED` creates a separate `PRE_SCREENING_ONLY` artifact; it must not create or approve a final report. Verify downloads remain tenant-scoped and the final report still requires a reviewer.
6. Review the complete staging run and its audit records. Only after it passes may an administrator enable the staging database allowlist and the matching staging worker runtime flags for the smallest required organization set.

No staging credentials or live source pack are part of this repository change. Staging qualification and activation remain operational steps; production pre-screening stays disabled.
