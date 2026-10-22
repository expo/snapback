# DX6 frontend and proof text evidence

Commits: `babf5cf562` (ReadState starters, historical template custody, proof-owned bridge), `129911f3a5` (test scratch cleanup), `37aa4103ed` (locked public observer and visible-text engine).

Both todo starter lists use the SDK ReadState and distinguish proven absence from partial empty answers. Partial/stale rows and pagination survive. Password starter client modules, including production recipes, omit web witness registration and witness-persona selection. The docs-local component is ReadNotice. Exact previous 0.4.37 templates remain recognized for adaptation; custom source remains application-owned.

The public same-origin proof observer is immutable, selects the first App on each page and locks its bridge. Same-App explicit generated-API registration enriches it; another explicit App refuses E_WITNESS_APP_SELECTION. This is a test observer, not an authentication or confidentiality boundary. Normal launches publish no App global. Separate App instances use separate pages.

The custom Playwright selector traverses composed visible text, including open shadow roots and wrapping labels, excludes hidden/CSS-hidden/zero-opacity/editor text and keeps independent matches ambiguous. Strings remain exact and case-sensitive by default; explicit substring is case-insensitive; regex preserves its source and flags against normalized visible text. waitForFresh compares and returns that same normalized visible text, so a hidden descendant change cannot produce freshness, including after locator chaining. The module registers its optional installed peer before exposing the synchronous constructor; withBrowser also registers the resolved caller peer. A completely foreign Playwright registry must use the same installed peer or withBrowser; it fails loudly rather than falling back.

Final Linux validation:

- `timeout 120s /home/ccheever/.bun-1.4.2/bin/bun run --cwd snapback4/packages/snapback4 build`: PASS, current source including session-clock reconciliation.
- `timeout 240s node --test --test-concurrency=1 snapback4/packages/snapback4/test/proof-contract.test.mjs snapback4/packages/snapback4/test/react.test.mjs snapback4/packages/snapback4/test/proof.test.mjs snapback4/packages/snapback4/test/wave12-kit.test.mjs`: **126 passed, 0 failed**, 62.7 seconds. Includes actual caller-owned Chromium outside withBrowser and supplied-peer browser regression tests. Existing React act diagnostics do not fail tests.
- `timeout 30s node snapback4/scripts/generate-proof-api.mjs`: PASS. Final suite also checks generated table agreement.
- `timeout 10s git diff --check`: PASS.
- Scratch cleanup: no kit12 directory remains under target; census scratch removed in finally. Earlier in-progress visible-reader string-evaluation failures were fixed before final commit and the complete final rerun passed.

## Frontend non-whitespace characters

`timeout 10s node snapback4/scripts/dx6-frontend-census.mjs` copies only authored frontend source to temporary directories, removes client witness plumbing on copies, checks original hashes and deletes its copies. All five frontend files per lane from wave-22's census are counted; authored code is never excluded by looksBuilt. This isolates witness-plumbing removal rather than claiming a domain-UI ReadState retrofit.

| Wave-22 Snapback lane | Before | After | Delta |
| --- | ---: | ---: | ---: |
| 001 stained-glass-restorations | 13,459 | 13,123 | -336 |
| 037 orthotic-casting-orders | 12,580 | 12,226 | -354 |
| 040 excavator-rental-returns | 18,874 | 18,520 | -354 |

Original evidence is hash-identical. No original lane, credential file or other worktree was modified.

Parent owns final amendment reviews, full Rust workspace tests (including new exact historical adaptation regression), packed starter/guide qualification, Mac affected tests, root checks and final WORKSTREAM-REPORT.md. No version bump or push.
