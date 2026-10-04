# Testing / staging checklist

## Automated local checks

Verified: 135 tests (database 25, regulatory DB 17, regulatory clients/parser 24, regulatory orchestration 7, domain 32, native server 15, worker 2, pipeline status 13), 6 browser workflows in demo, TypeScript/lint and production compilation. Rotated PDF bbox and actual TIFF normalization are included. Browser tests start a fresh browser per case to isolate local OCR/PDF resources. No live Supabase or real ClamAV deployment was used.

- `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`.
- `npm run test:e2e`: Playwright browser installed on your machine.
- `npm run test:e2e:bundled`: Linux fallback, npm-packaged Chromium + AL2023 NSS/NSPR libs; no browser CDN download. One worker; creates synthetic data only in demo.
- `npm run doctor`: pre-flight check of a real deployment (Supabase env/connectivity, ClamAV reachability, rule counts, queue state, private buckets). Exits non-zero when a real self-check could not run; see [OPERATIONS.md](OPERATIONS.md).

PGlite tests execute all three migrations with **pgcrypto + pgvector**, role/RLS and trigger semantics. Auth/Storage tables are shims, not an actual Supabase stack. Tests cover spoofed signup roles, tenant isolation, unaffiliated-member NULL role guards, restricted writes, independent legal approvals, frozen input/report, scan-gated Storage reads, leases/retry/dead-letter, transactional evidence validation and report conditions.

Native tests render real PDFs/PNGs, use actual local Tesseract and Unicode PDF output. Worker tests run real orchestration/SQL but use a test PostgREST/Storage-shaped adapter and **simulated ClamAV protocol**. This must not be described as live Supabase or real antivirus testing.

## Required live staging checks (not run in this session)

1. Deploy fresh Supabase migrations; verify private buckets and Auth profile trigger for real signups. Ensure no secrets in browser bundle.
2. Create two customer orgs; customer/contributor attempt direct PostgREST queries and RPCs on the other org. Verify 0 rows/403 and no data in Realtime events or signed URLs.
3. Confirm password/email/OTP/invitation flows with SMTP and exact redirect allowlist. Customer metadata cannot grant staff. Locked profiles/members lose access.
4. Upload actual 1/10/11-page PDFs, JPEG/PNG/TIFF, oversized/invalid MIME/modified hash cases through **real Storage HTTP**. Check manifests/partial upload behavior and immutable no-overwrite policy.
5. Run production-configured ClamAV with updated definitions; verify a sanctioned safe antivirus test fixture is quarantined and no OCR/provider call occurs. Test unavailable scanner/timeout; dev bypass must remain blocked for access/report.
6. Run 2+ workers on real Postgres; exercise SKIP LOCKED concurrency, lease loss/process kill, persisted stage reuse, attempts≤3, dead-letter and manually authorized retry.
7. Register actual verified official law snapshots with real retrieval/effective dates. Two independent legal accounts approve sources and rules. Change source/rule after review; verify rerun requirement and old report immutable.
8. Review complete/absent/disease/food-supplement/sesame/formula mismatch/allergen-free/claim-exemption fixtures. Confirm no missing-data pass or invented citation, manual edits/dismissal need reasons.
9. Human report approval: every finding decided, current citations/snapshot, clean scan, disclaimer. Force Storage/artifact failure; ensure snapshot preserved but review not COMPLETED until PDF/JSON exist.
10. Verify downloads/audit, original/hash/version comparison, tenant-specific report visibility, expiry of signed links, backup/restore and retention. Scale-test before increasing dataset limits.

Provider services must be approved independently (data residency, DPA, log/retention policy, schema validation, payload size, timeout/rate limits). No third-party credentials/data were available for integration testing during development.

## Regulatory Knowledge integration

New tests execute bounded timeout/retry/cache/error handling, issue-vs-up-to-date metadata, 404 title/structure refresh, synthetically shaped XML numbering/inline/notes/tables/hierarchy, no zero/empty/wrong/duplicate sections, private raw access, immutable snapshots, independent activation, current/superseded/as-of filtering, FTS/vector provenance, parser revision/observations, chunk-drop warnings, actual affected-rule QA staleness/failure, and daily schedules. FR orchestration paginates 120 **synthetic** FDA documents without editing rules. Browser workflow asserts **no eCFR/FR HTTP requests** in demo.

These are NOT raw/live government fixtures. See [Regulatory Knowledge staging](REGULATORY_KNOWLEDGE.md#staging-acceptance-còn-phải-chạy) and `tests/fixtures/regulatory/README.md`. Capture genuine raw XML and independently compare all labels/citations/table/source notes before production.
