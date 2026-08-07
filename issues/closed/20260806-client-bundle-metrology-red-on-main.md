# client-bundle-metrology ratchet is red on main

**Status:** Resolved 2026-08-06 — disposition minted locally; awaiting its required Git carrier
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

## 2026-08-06 — G3/E2 attribution review and governed disposition

The owning lane reproduced the same 19-metric shape under the pinned Node
24.18.0 / esbuild 0.28.1 method, then reviewed the module attribution before
disposing any ceiling.

The suspected assets-subpath import leak is **not present**. Both
`public-subpath-assets` and `resolved-public-subpath-assets` contain exactly
`packages/snapback-client/assets.mjs` plus their generated fixture. Neither
`commands.mjs` nor an `@expo/snapback-expo` module crosses that runtime
boundary. The `CommandAssetSource` / platform-source split is declaration-only
(`.d.mts` and generated declarations), so it cannot add JavaScript bytes to
the assets entry. The +588 minified bytes are two real asset-owner additions
from `47b4a59ac`: the host-fetch seam used by Expo binary TUS transport and the
public-immutable rendition URL used by the G3 image surface. Removing either
would change the landed E2/G3 behavior rather than repair an import graph.

The current tip also includes `02bf40745` after the earlier 19-regression table
was measured. Its command-task disposal/authority fence and truthful
settlement handling account for the command/React successor being larger than
the table's `430c48669` figures. The complete governed successor is therefore:

| profile | leak bytes recovered (min / gzip / Brotli) | ratified successor delta (min / gzip / Brotli) |
| --- | ---: | ---: |
| `external-react-application` | 0 / 0 / 0 | +3,419 / +854 / +740 |
| `react-external` | 0 / 0 / 0 | +3,419 / +864 / +713 |
| `public-subpath-assets` | 0 / 0 / 0 | +588 / +143 / +121 |
| `resolved-public-subpath-assets` | 0 / 0 / 0 | +588 / +144 / +129 |
| `public-subpath-commands` | 0 / 0 / 0 | +3,043 / +749 / +693 |
| `resolved-public-subpath-commands` | 0 / 0 / 0 | +3,043 / +751 / +691 |
| `public-subpath-ir-evaluator` | 0 / 0 / 0 | 0 / 0 / +1 |

`baseline.client-bundle-disposition.v2.json` is the LLP 0145 / LLP 0063
prospective rollover. It SHA-256-binds the complete v1 disposition, S2 command,
and local-read-admission predecessors; records before/after rows for all seven
profiles; and carries dated, per-profile justifications tied to
`17e7ca8ca` (G3 engine), `47b4a59ac` (E2 adapter and platform receipts),
`02bf40745` (command lifecycle correctness), and `f782431bd` (the reachable
auth fix whose output changes only Brotli by one byte).

`volta run node scripts/client-bundle-metrology.mjs
--write-rollover-baseline` passed its complete behavior train and final
comparison, minting the v2 ledger and updated `current.v1.json`. Ordinary
`--check` now refuses only because the new immutable ledger has no reachable
carrier introduction. That refusal is intentional: the task prohibited a
commit, and the gate must not accept an uncommitted ceiling as durable
evidence. Land the declaration, v2 ledger, current report, and this note
together; then rerun `--check` and move this ticket (and
`20260806-commands-profile-blocks-all-metrology-writers.md`) to `issues/closed/`.
