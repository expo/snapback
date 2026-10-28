# Integration 32 — Snapback 4 0.4.48

TOK5 and GEN1 are integrated on `sb4-loop`. The external landing receipt at
`~/sb4-loop/reports/integration32/landing.json` records the pushed tip and final
porcelain. Complete commands, raw logs, original failures, receipts and retained
tarballs remain in that evidence directory; compact summaries are committed here.

## Commits and behavior

| Change | Commit | Result |
| --- | --- | --- |
| Initial main reconciliation | `6ba2242ffb` | Pre-merge main `589a950dfb69a29dd3333bde2dda3a699ff70adf`; five issue records only. |
| TOK5, source `c34934c347` | `18889a3f5a` | No-ff merge; sole root README, relocated references, Write.why and refusalOf. |
| GEN1, source `5e22ca9f35` | `fbc147990c` | No-ff merge; app-specific generated client usage and bounded pointers. |
| Early version bump | `618b59468b` | `snapback4 0.4.48: compact package references and app-specific client usage`. |
| Generated snapshot/review evidence | `248aecfa83` | Regenerated actual emitter output; verbatim review results and provenance. |
| Wasm ratchet | `e98de6641c` | Measurement plus exactly 500 bytes. |
| Server opt-in fixture repair | `1fe5731984` | Keep declaration assertions outside the exact inert usage comment. |
| Final main reconciliation | `56c3becf55` | No-ff merge of `d6f0253bfa`; tree unchanged. |

All SDK, Expo, platform and Cargo versions agree on 0.4.48. One coherent guide
changes entry describes all three surfaces. README is the sole root Markdown
file, and all five references remain under `reference/`. Existing application
source/runtime behavior remains; direct documentation readers follow the moved
paths. Every Write arm permits reading why; pending/sent return undefined while
failed retains Refusal. Pending reason strings remain. refusalOf is available
from client, React and contract.

Generated api.ts packets describe calls, arguments/results, session ownership
and declared refusals. The merged literal example uses refusalOf. All 35 fixture
operations compile: CPAP 2,344, Trailer 2,385 and Talent 2,366 o200k tokens, each
within 2,400; the largest operation is 223/480. Green check uses its existing
verdict line; client/react/generated guide API pointers lead to the packet.
Per-card budgets, TOK1's <=10,000-token reading replay and DX11 output checks
pass. Existing apps receive generated usage when check/dev regenerates their API.
The parent friction research records the 0.4.48 response.

## Reviews and deterministic reds

Only authored conflict resolutions/repairs were reviewed. Initial Muse and fresh
Codex reviews correctly found my greedy conflict-removal regex had dropped TOK5
records and prior release history. Bump 618b restores the exact parent journal
prefix and the changelog's 0.4.47-onward suffix, preserves TOK5 section 15 and
GEN1 section 16 with matching references, and combines the changes entry. Both
repair reviews are READY. Original NOT READY results, repair diff hashes and
provenance remain verbatim under `llp/reviews/3000.037.000-integration32-*`.
These are conflict/repair reviews, not invented full-lane review verdicts.

The inherited API-index red is fixed: resolve the manifest's string-valued
proof-runner export with allowJs while retaining all typed-module export checks;
add its guide row and five omitted proof helpers. Both tests pass. The ticket is
resolved under `issues/closed/20261028-snapback4-api-index-proof-runner-export.md`.

The selected set exposed two stale server_opt_in assertions that treated hook
names inside GEN1's inert comment as server declarations. Commit 1fe5731984
removes only that exact comment from these declaration assertions, preserving
the operation index, executable bytes and server-gating checks. All seven tests
pass. No runtime fix was needed. Original FAIL/source-change receipts remain
literal; no assertion, skip, runtime ceiling or product refusal was waived.
Root-generation lock files also caused two selector preflight refusals before
product execution; execution waited for regeneration without weakening custody.

## Affected and root verification

The repaired source-bound affected receipt at 1fe5731984 is PASS/unchanged:
879 Rust tests across 25 targets pass, with five existing ignored tests; all
31 selected client files pass 510 tests, with zero failures/skips. The final
repair run reruns all 13 language targets, five integration-seam client files,
both API digests and references. The audited delta is exactly the repaired test
file; every other selected product/test input matches its passing execution.
Exact commands and retained results are in `affected-summary.json`.

The original conservative seven-crate/460-client plan is retained compressed
and explicitly unexecuted under the commissioned lean scope, following
Integrations 28–31. No complete client/model/difftest battery is claimed.
Post-report affected execution and the final product-object audit are recorded
externally in `final-affected-result.json` and `final-affected-plan.json`.

All root checks pass: generated artifacts, inventories, 22/22 guide checks,
reference validation with zero errors/unchecked, and docs budget. Diagnostics,
guide projections and declaration/API digests regenerate without tracked drift.
The authoring census regenerates byte-identically: 932 rows, 586 mutation
occurrences and 95 private write sites. Incoming main's census refresh is already
identical; the final reconciliation changes ancestry without changing the tree.

Clean wasm measurement at 1fe5731984: 2,416,601 raw / 738,518 gzip / 555,443
Brotli bytes. Budget 739,018 = measurement + exactly 500. Strict family and
server-only absence audits pass. Gzip is 122 bytes smaller than 0.4.47, with
unchanged raw length; no runtime ceiling or independent feature-cost claim.

## Packed consumers and survey

The complete `qualify-linux.mjs --consumer-only` chain passes on 1fe5731984:
2,535.5 seconds, native SHA256
`006bb09d51d52b369a6eca78122ed42890dacaa08c4a3ba9aca5e324cc3a5af3`.
It covers installed client/Write recipes, generated scaffolds, release/migration,
production/security/staging rules, all six host starters with real typechecks
and builds, all 12 frontend positive/negative entries, and clean Ubuntu 24.04
and Alpine consumers. Packed root Markdown is exactly README.md; all five
references remain. Starters compile their generated APIs with usage packets.
The receipt has suite:not-run and publicationQualified:false; it is not a
publication receipt. Receipt SHA256:
`b7c1d14dd5907091a1ce982c2d31697d0bb4519dc3fefbd131a8ed27ed8db3b2`.

The complete waves 15–34 survey runs 1,020 schemas on the exact same optimized
binary, with four workers and exact wave-31 predecessor context. All source
hashes match Integration 31. There are zero new gates, production refusals,
changed check/default-deploy exits, hidden gate IDs or default-output line growth.
The seven existing gates, 20 legitimate production refusals and 21 enforced
refutations remain unchanged. Default check lines median/p90/max: 4/7/17;
deploy: 3/3/5. No wave store was opened: schemas/fixtures were copied to private
fresh stores. The initial slow debug survey is retained as partial evidence;
the complete optimized survey is authoritative.

## Retention and deferrals

Removed all 24 completed consumer workspace directories, retaining top-level
receipts/checkpoints, logs, hashes and tarballs. Builds disable incremental/debug
information, cap Cargo at 16 and use 40 GB scopes; at most two heavy jobs and
four survey workers run together. Publication targets/worktrees were untouched.
Root WORKSTREAM-REPORT.md is this lane-local report.

Publication owns full platform/client qualification, Mac/native Expo rebuilds,
non-consumer qualification and npm release. The 20k/device campaigns and whole
session replays are deferred as commissioned. The post-landing Snapback-only
rerun owns token/wall measurement; no whole-session performance win is claimed.
