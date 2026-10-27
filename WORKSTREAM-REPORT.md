# SEC11 workstream report

Worktree: `/home/ccheever/projects/sb4-b31-sec11`, branch `sb4-b31-sec11`. Base:
`f032742ac8`, Snapback 4 0.4.43. No version bump or push.

This delivery stops at the item 1 boundary allowed by the brief. It does not claim
structurally zero medium holes. Items 2–9 and the full fix-forward matrix remain
outstanding. New witnessed questions remain advisory: a concrete replay establishes
admitted behavior, and cannot establish the builder's product intent.

## Item 1: witnessed decisions

Implemented current-witness refusal messages and additional bounded advisory replays for
omitted/empty media, text evidence, child-presence transitions, unchanged direct guards
used twice, and compiler-typed broad-read payloads. Answers retain SEC10's current
witness digest, exact `permit OP as CALLER` clause and audience/effect rationale. A
rejected batch publishes no decisions.

Read witnesses include the actual redacted delivered payload, distinct from the policy
row, effective logical time and visible identities. Changed delivered fields renew the
decision. Raw query results remain live-only, excluded from serialization and Debug.
Search deduplication still uses mutation prefixes.

The implementation deliberately leaves unsupported shapes uncovered: indirect or
compound guards, complex histories/assets/jobs, assignment-specific role questions, and
child-presence operations where another write or opaque effect could repair an
intermediate observation. These are coverage gaps, not gates.

Commits:

- `063c847045`: witness classes and decision refusal detail.
- `88a173a7c2`: exact guard identity, actual transitions and null redaction.
- `6525082163`: copied-schema/scoped verification runners.
- `d959a35bc1`: preserve mutation-prefix search deduplication.
- `f3612f3dbd`: actual delivered payload identity and live-only redaction.
- `267c579701`: atomic-call, cascade and commit-end expiry safeguards.
- `d9734feab5`: merge origin/main (experiment records only).
- `0dffd02350`: narrow the verification targets and retain exclusions.
- `58f30f47f0`: measurement tooling and qualified fix-forward evidence.
- `0dd5622566`: migrate existing assertions to terminal query histories.

Design: LLP 3000.036.004.001. Independent Muse and fresh Codex reviews are retained
verbatim under `llp/reviews/`; earlier findings and corrections remain visible. The
0.4.44 Guide changes entry documents this surface without bumping 0.4.43.

## Items 2–9

2. Approval-act inference: deferred; no new structural approval inference.
3. Assignment scoping: deferred; role-specific questions deliberately do not
   borrow unrelated broad-read witnesses.
4. Declared transitions/sibling prerequisites: deferred.
5. Entitlement consumption: deferred; item 1's bounded guard-reuse question is
   not an entitlement enforcement contract.
6. Caller-asserted history/latest subject: deferred.
7. Evidence typing gates: deferred; optional/text/child questions remain advisory.
8. Duplicable-row keyed exists/age intent: deferred.
9. Latency optimization: deferred; measured final production latency recorded
   below without claiming the targets passed.

## Verification and measurements

All 41 calibrated medium findings were matched individually by operation, material
predicate/column and relevant actual row values, using copies whose schema hashes match
Integration 27. The final 800-schema survey reports zero assessed false gates and zero
false production refusals, with no unclassified result. All fresh production verdicts
match Integration 27 (19 refusals); all post-test verdicts match SEC10's retained post-
test evidence (26 refusals). These are carried source-reviewed security findings, not
false refusals. `test` exits are 769 success and 31 exit-1 results; no watchdog/tool
exits occurred. This is not a claim that all app security tests pass despite the
commissioned holes.

Default output across 800 schemas: check median 3 / p90 7 / max 14 lines; deploy median
5 / p90 9 / max 20. Median targets pass. Wave30 check is 2 / 6 / 8 and deploy 5 / 9 /
11. The global check p90 rises from Integration27's 6 to 7; existing p90 output work
remains open. Cold production-profile timing on 50 wave30 schemas, one worker with an
independent fresh copy per call: review median **13.63 s**, p90 **25.14 s**, max 52.85
s; deploy median **18.27 s**, p90 **32.83 s**, max 70.48 s. Both the <10 s review and
<15 s deploy p90 targets are missed. No timing tool failed; peak one-minute host load
was 0.202 per available CPU. Every cold source hash and verdict matches its
corresponding completed survey result. No comparison claims an isolated machine or equal
load to SEC10's earlier measurement. Item 9 optimization remains deferred.

| Wave | M findings | Before gate / default question | After gate / default question | After advisory / nothing | Already type-prevented (subset of nothing) |
| --- | ---: | ---: | ---: | ---: | ---: |
| 26 | 15 | 6 / 0 | 6 / 2 | 6 / 1 | 1 |
| 28 | 12 | 2 / 2 | 2 / 4 | 0 / 6 | 1 |
| 30 | 14 | 1 / 0 | 1 / 3 | 4 / 6 | 0 |

The seven newly visible M questions are wave26 024 F1 and 033 F2; wave28 023 F1 and 047
F1; and wave30 002 F1, 030 F1 and 033 F2. No new production gate codes were added. The
two inherited text-type preventions receive no SEC11 credit; their requested finding
category is `nothing` (no current finding/witness), with an explicit prevention flag
explaining the existing rejection. The wave30 14/14 target remains unmet. Codex holes
004 F1 (assignment) and 038 F1 (duplicable guards) remain with deferred items 3 and 8.

Every wave30 gate was classified by hand: only 033 F1, `advanceJob` with the exact job's
`dampSigned=true` and `dampApproved=false`. Source inspection confirms that this
admitted advance reads only status; owner approval and recorded consent are separate.
Its one-line fix passes the app's acceptance.

Final security CLI unit target: 53 passed, including all 17 witness regression cases.
All 32 selected CLI integration tests pass. The full language run completed 195 targets:
2,847 passed, 3 stale history-format assertions failed, 16 ignored. Commit `0dd5622566`
updates those assertions to require the actual terminal query's caller, arguments,
clock, observed state and live payload. Each of the three exact tests then passes from
an immutable rebuilt executable, for 2,850 resolved language tests. No production source
changed. All six selected client files pass (17 tests), as do wasm/client builds,
Snapback4 docs-budget, packaged-doc lint, diagnostics and reference validation.

The original scoped receipt remains FAIL, unchanged at `58f30f47f0`, with the three old
assertions and legacy root checks recorded. The separate final scoped retry at
`0dd5622566` is PASS. Their explicit composition is recorded in `qualification.json`; it
does not claim the original canonical full pool passed. Root Snapback1 codegen failed
for missing `acorn`; its root guide reported missing JS dependencies and was cancelled,
as was the legacy root inventory check. These are outside the Snapback4 fence; no
Snapback1 bootstrap was run. Snapback4's language guide tests, two guide client files
and packaged docs were checked. No new integration-test file, metadata-declared demo or
publication leaf was added. Superseded or interrupted runs are not PASS.

Setup completed: frozen Bun install, native build, wasm build and package build. Wasm
remains 738,613 gzip bytes within its 739,113-byte budget.

Difftest: 2,000-case `run` passed with zero disagreements. 2,000-case `run-lean`
returned 18 disagreements, exactly the Integration 27 signature counts: continuation-
next 5, next 8, and E_RULE/NOT_FOUND prelude 5. This is an inherited red, not a clean
Lean pass. No interpreter/planner/store semantics changed. These differential runs were
recorded at `88a173a7c2`; the subsequent witness/report changes leave the interpreter,
planner and store oracle inputs unchanged.

The canonical affected plan expands these security/docs edits to six Rust crates and 439
client files. That conflicts with the explicit brief prohibition on full Rust/client
pools. The retained runner records the original plan, the scoped plan and omitted steps;
only the changed CLI/language crates plus six affected security/guide client files and
relevant Snapback4 docs checks are run. Final CLI targets are `verbs::security*` unit
modules and dx11, dx11_refusals, dx13, security_reviews and security_wave19 integration
targets. The earlier broad CLI attempt reached unrelated 6,929-row residency
calibration; it was interrupted and is not a full-crate PASS. `0dffd02350` records this
scope. This is not a claim that the original canonical plan completed. See
`issues/20261026-snapback4-sec11-affected-selector-expands-for-docs.md`.

## Fix-forward

On a source-only copy of wave30 lane 033, adding `require not j.dampSigned or
j.dampApproved else DAMP_APPROVAL_REQUIRED` in `advanceJob` clears the existing gate;
the app's own acceptance script passes. The raw acceptance log stays private outside the
repository. Final production-binary reconfirmation also passes; the measured binary SHA
is `9d432a5fed665c418cbed5aa26995811411ee46c10f09f9e5181139ce7924a95`.

The remaining wave30 hole lanes have no completed fix-forward acceptance claim. They
depend on deferred mechanisms above; do not infer completion from an unrelated advisory
or gate in the same lane.

## Presentation limitation

The optional-list default card currently names the admitted operation and caller but
omits the focal list value (`absent -> {}`). Full JSON and failed acknowledgments retain
the exact row and predicate. The shared compact field selector is DX14's scope; the
concrete reproduction and suggested correction are recorded in
`issues/20261027-snapback4-sec11-optional-evidence-witness-fields.md`. Counts of default
witnessed questions mean the default names the question and its admitted-call replay,
with full concrete fields retained in JSON; they do not claim every witness field is
printed inline.

Scalar-only query payloads do not satisfy the current structured read-witness check;
object/array payloads are supported. This remains an explicit coverage gap.

## Delivery and reproducibility

The final evidence bundle is `snapback4/reports/sec11-item1/`: the compressed 800 actual
results; exact per-hole coverage; gate/FIX classifications; all 50-schema cold timings
and verdict/source comparisons; the original and retry receipts; test counts; and the
lane033 fix-forward patch. The production binary and private acceptance logs remain
under `~/sb4-loop/reports/sec11/`. `provenance.json` binds the binary, build flags and
product source. The final report/evidence-only commit does not change executable inputs.

`origin/main` was merged before completion; no semantic conflict was authored. No
version bump or push. Mac, complete five-crate/client pools, device/20k campaigns and
publication qualification were outside this brief's scope.

This is a committed, measured item 1 boundary. The wave30 14/14 target, the two latency
targets, items 2–9's implementation, and the remaining hole-lane fix-forward acceptance
matrix remain outstanding. No new gate is half-wired.
