# Synthetic staging review fixture

The isolated fixture is intended only for Supabase Staging project `brwmwctzzmxrplsgovhv`.

## Apply sequence

1. Deploy the repository migrations through `0007_demo_static_artwork.sql` using the approved staging release path.
2. Review and explicitly run `supabase/seed.sql` in that same Staging project. The seed is deliberately not auto-enabled in `supabase/config.toml`.
3. Sign in to the deployed Reviewer Workspace as an existing active reviewer and open:
   `/reviews/30000000-0000-4000-8000-000000000001`

Do not run this fixture against Production. The transaction aborts unless an active reviewer already exists, pre-screening is already disabled, the exact 15 tea rules and their cited sources remain `DRAFT`, and the reserved review state is compatible. It never creates Auth users, changes roles or feature flags, uploads Storage objects, runs OCR or triage, creates reports, or approves/activates rules or sources. If any guard fails, investigate the environment rather than relaxing the guard or changing unrelated staging state.

## Fixture behavior

- Product: `Trà sen túi lọc`; review: `30000000-0000-4000-8000-000000000001`; case reference: `SRD-ANHIEN-LOTUS-DEMO-001`.
- The 15 findings are open, citation-pending synthetic expert-review prompts. They are not OCR output, legal findings, or approved recommendations.
- The two SVG manifest rows retain `scan_status='dev_unscanned'`. They map only the pinned `demo-static/lotus-*.svg` paths to the repository's static `/samples/lotus-*.svg` assets. These assets are not in Supabase Storage and cannot receive signed URLs.
- No extracted-field rows are created, so the fixture does not imply an OCR run or confidence score.
- The review has no report, triage run, processing job, or approval; the rule pack and source rows remain unchanged and `DRAFT`. Pipeline reruns are disabled for this exact fixture in both the Reviewer Workspace and retry RPC.

`supabase/seed.sql` is idempotent and transactional. If a reserved ID is already used by incompatible data, the transaction fails rather than overwriting it.
