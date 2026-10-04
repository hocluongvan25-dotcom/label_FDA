# Local `braces` security patch

This directory contains the published `braces@3.0.3` package source (MIT), with the reviewed depth-guard change from [micromatch/braces PR #72](https://github.com/micromatch/braces/pull/72), commit `d0d575e55e74a4e0218e5248fafb79efc3e54ebb`, applied locally.

The patch addresses [GHSA-vfj7-8cjw-p6xm / CVE-2026-93687](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm): recursively walking deeply nested braces or parentheses can exhaust the JavaScript stack. The parser now caps nesting at 100 by default (and allows callers to select a stricter `maxDepth`); compile, expand, and stringify also guard caller-supplied ASTs.

No fixed upstream npm release was available when this patch was prepared (2026-10-03). The package version `3.0.4+vexim.1` is a **local build identifier**, not a claim that upstream published `braces@3.0.4`. The root `package.json` points its dev-only `braces` dependency at this directory; npm deduplicates the lint toolchain onto the patched copy, without downgrading Next.js or changing runtime dependencies.

Remove the local dev dependency and this directory when an official fixed `braces` release is available; refresh the lockfile and rerun `npm audit`, tests, lint, typecheck, and E2E first.
