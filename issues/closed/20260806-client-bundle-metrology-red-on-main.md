# client-bundle-metrology ratchet is red on main

**Status:** Resolved
**Opened:** 2026-08-06
**Related:** scripts/client-bundle-metrology.mjs;
tests/fixtures/client-bundle-metrology/baseline.v1.json; LLP 0063
workstream 8 (packaging budgets)

## 2026-08-06 — 0.1.10 release candidate remains blocked after the disposition rollover

The ten-package 0.1.10 release preflight re-ran the complete 133-gate local
proof on clean `origin/main` candidate
`430c48669ff7a716e6296f1ae6cb3b5db1575968`, using the repository-pinned
Node 24.18.0 runtime and a process-private `TMPDIR`. The measurement method
matched the committed baseline exactly, but `client-bundle-metrology` still
refused with 19 frozen-ceiling regressions:

| profile | minified | gzip | Brotli |
| --- | ---: | ---: | ---: |
| `external-react-application` | 89,345 → 91,033 (+1,688) | 27,938 → 28,352 (+414) | 24,378 → 24,719 (+341) |
| `react-external` | 89,170 → 90,858 (+1,688) | 27,875 → 28,296 (+421) | 24,315 → 24,661 (+346) |
| `public-subpath-assets` | 15,229 → 15,817 (+588) | 5,879 → 6,022 (+143) | 5,087 → 5,208 (+121) |
| `resolved-public-subpath-assets` | 15,238 → 15,826 (+588) | 5,883 → 6,027 (+144) | 5,087 → 5,216 (+129) |
| `public-subpath-commands` | 24,752 → 26,350 (+1,598) | 8,643 → 9,039 (+396) | 7,510 → 7,880 (+370) |
| `resolved-public-subpath-commands` | 24,761 → 26,359 (+1,598) | 8,647 → 9,045 (+398) | 7,511 → 7,864 (+353) |
| `public-subpath-ir-evaluator` | unchanged | unchanged | 6,739 → 6,740 (+1) |

This is later than the already-reviewed
`baseline.client-bundle-disposition.v1.json` rollover: commit `47b4a59ac`
added the Expo E2 picker/asset-source adapter and expanded the client asset,
command, and React closures after that rollover. The release preflight does
not authorize silently advancing those ceilings. The owning repair must
either reduce the closure or record a prospective, reviewed rollover for the
E2 capability mass, then rerun the complete local proof.

This release session stopped before staging and issued no npm publish or
dist-tag command. While its proof was running, however, another operator or
session published the complete ten-package 0.1.10 vector from retained ledger
`~/snapback-release-ledgers/fastpath-ledger-0.1.10-b6afed6ef3.json`. npm records
the publications between 2026-08-06T18:34:48Z and 18:35:32Z, including the
first `@expo/snapback-expo` publication at 18:35:23Z; `latest` now selects
0.1.10 on all ten names. A read-only re-download proved every registry
tarball byte-identical to that ledger.

That external publication does not discharge this blocker. The ledger binds
old revision `b6afed6ef3eedd7be18e845e31b953da438ddc5a`, not the orchestrator's
required fresh candidate `430c48669…`; `b6afed6ef3` predates the
capability-maturity repair that caused the prior release attempt to stop.
Neither the fresh candidate's full proof nor its staged ten-package rehearsal
completed. Do not record LLP 0176 G4's publication prerequisite as met from
this vector without an explicit reconciliation ruling.

`node scripts/client-bundle-metrology.mjs --check` fails with
`SNAPBACK_CLIENT_BUNDLE_RATCHET_FAILED` — ~28 metric regressions, the
largest `react-external` / `external-react-application` minifiedBytes
49,943 → 67,655 (+35%), plus 2–8% on every rqs-store profile.

Reproduction evidence (all under volta node 24.18.0):

- red on the main checkout at 3a6da9133 (origin/main tip, 2026-08-06);
- red at b884202e1 (pre-sbsb2 base) in a fresh worktree — byte-identical
  numbers, so the sbsb2 implementation series is NOT the cause;
- red at 05306b990 and its child 753329137 (fix(react): presence bridge)
  — byte-identical, so that commit is not the (sole) cause either;
- red even at 474900850 (2026-08-03, the last commit that touched
  baseline.v1.json) — the very commit that froze the current baselines
  reproduces bigger bundles today;
- identical numbers under two different node_modules trees (the main
  checkout's install and a fresh bun install in a worktree).

Since the baseline-freezing commit itself no longer reproduces its own
baselines, the regression is either (a) environmental — bundler/minifier
or zlib/brotli version drift in the dependency tree relative to when the
baselines were recorded (gzip/brotli bytes vary with zlib; minified bytes
with the bundler) — or (b) a landed dependency change that rotated
resolution for every profile. Either way the ratchet has been failing for
every fresh proof run, and `scripts/verify-local-proof` aborts at this leg
(the ~40 legs after it never run), which is how it stayed unnoticed.

Next steps: identify when the leg last passed in a recorded proof receipt;
diff the bundle module-attribution output (the script emits per-module
attribution) between a recorded green run and today; either fix the
resolution drift or re-freeze baselines deliberately with the growth
accounted for (the ratchet is "never loosened" by design — a re-freeze
needs review, not a silent bump). Until then, proof runs mask this leg
explicitly and say so.

Filed by the sbsb2 implementation session, which hit it as a false
positive on an unrelated series (2,312/2,312 cargo tests green).

## Resolution — 2026-08-06 wave-drift pass

The apparent environment-only diagnosis mixed two real, sequential capability
steps. This branch already carried the reviewed August client-capability and
final G2 rollovers that account for the earlier React/store growth without
mutating their predecessors. Merging `17e7ca8ca` then exposed a second,
independently attributable S2 step:

- `external-react-application`: 72,960 -> 85,811 minified bytes;
- `react-external`: 72,784 -> 85,635;
- `public-subpath-assets`: 13,860 -> 15,092; and
- `resolved-public-subpath-assets`: 13,864 -> 15,101.

The successor attribution names the intended shipped modules:
`commands.mjs` contributes 9,824 bytes to each React closure, while the
authority-preserving `assets.mjs` seam contributes 14,536 bytes to each React
closure and 14,831 bytes to each asset-only closure. This is accepted LLP 0180
/ LLP 0179 S2 capability mass, not a server/dev import or duplicated runtime.

The guarded writer therefore froze a prospective four-profile
`baseline.s2-command-assets.v1.json` rollover, retaining every predecessor
unchanged. The new `commands` export is separately frozen as two additive
profiles (`public-subpath-commands` and
`resolved-public-subpath-commands`) in `baseline.s2-commands.v1.json`. Both
writers ran the complete declared behavior train before minting.

## Final reconciliation — Expo E2 and post-S2 correctness landings

Later completed-main work advanced seven of those active closures again. This
is not unexplained environment drift:

- `47b4a59ac` added LLP 0181 E2's picker/content-URI structural source and
  native platform adapter, which is retained by the assets, commands, and
  React entrypoints;
- `02bf40745` added the LLP 0180 command-task disposal fence and corrected
  false mutation-ambiguity reporting, increasing the commands and React
  closures; and
- `f782431bd` repaired auth-custody lock ordering. Tree shaking keeps the
  `public-subpath-ir-evaluator` minified size, gzip size, and module byte
  attribution identical, but the changed auth-coordinator input rotates the
  output and raises its exact Brotli artifact from 6,739 to 6,740 bytes.

Node 24.18.0 / esbuild 0.28.1 measured the final seven-profile vector as:

| profile | minified | gzip | Brotli |
| --- | ---: | ---: | ---: |
| `external-react-application` | 92,630 | 28,756 | 25,100 |
| `react-external` | 92,455 | 28,715 | 25,004 |
| `public-subpath-assets` | 15,680 | 6,004 | 5,205 |
| `resolved-public-subpath-assets` | 15,689 | 6,010 | 5,209 |
| `public-subpath-commands` | 27,660 | 9,366 | 8,176 |
| `resolved-public-subpath-commands` | 27,669 | 9,372 | 8,196 |
| `public-subpath-ir-evaluator` | 21,295 | 7,615 | 6,740 |

`baseline.e2-command-correctness.v1.json` prospectively supersedes only those
seven rows. Its predecessor receipts and every unrelated ceiling remain
immutable, and its guarded writer runs the client, asset, command, IR,
browser-closure, React, and surface behavior train before minting.
