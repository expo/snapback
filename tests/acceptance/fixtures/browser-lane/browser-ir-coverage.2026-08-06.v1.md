# LLP 0129 Phase 2a browser-IR coverage gate — first run

Date: 2026-08-06
Status: gate evidence run; not a phase-exit, capability, or Parity claim
Scope: LLP 0129 Phase 2a browser ladder, OQ9-designated exit gate
Runner: `tests/acceptance/browser-ir-coverage-v1.mjs` (`--retain` produced the sibling receipt)
Receipt: `browser-ir-coverage.2026-08-06.v1.json`
Base revision: `e99d2a328e864c0d4021bec750328d861176ebc3` (run from the uncommitted gate worktree; executed bytes are digest-bound in the receipt)

## The gate, verbatim

LLP 0129 §Open questions 9 (RESOLVED 2026-08-06, Charlie Cheever):

> Phase 2a's falsifiable exit is therefore the **browser-IR-coverage gate**
> (assessment exit option 2): ≥90% semantic IR coverage of the versioned
> reference-app durable-mutation corpus plus 100% execution coverage for the
> designated browser common-path mutations, proven by generated artifacts under
> a real-browser IndexedDB acceptance run with exact LLP 0051 D5 results.

"Exit option 2" is Option B of
`wasm-assessment.2026-08-05.v1.md` §5, whose pass conditions are: (1) ≥90% of
the frozen corpus is semantically IR-expressible; (2) 100% of mutations
designated browser common-path carry a generated local artifact and complete
the real-browser suite; (3) D5 is exact on both evaluators; (4) every
remainder is explicitly server-only or offline-nonclaim. "IR-expressible" is
the assessment §1 definition: the closed v1 plan grammar can represent the
semantics and `evaluateBrowserIrPlanV1` can execute the resulting data, over
the 13 durable mutations frozen as LLP 0051's measured demo corpus.

## Component results

| Component | Threshold | Result |
| --- | --- | --- |
| Semantic IR coverage of the frozen corpus | ≥90% | **12/13 = 92.3% — PASS** (carried from the pinned, dated assessment classification; not re-audited) |
| Exact LLP 0051 D5 results in a real browser | exact for all 37 pinned cases | **37/37 — PASS** |
| Execution coverage of designated browser common-path mutations | 100% | **INDETERMINATE** — the designated set is not frozen anywhere |
| Whole gate | all of the above | **NOT-DECLARABLE** (no PASS is claimed; no FAIL is measured) |

## What the D5 component actually ran

- The 37-case corpus was verified byte-for-byte against
  `tests/conformance/data-tier/corpus.manifest.json`
  (`sha256:ec6968a66ad7161cd37bdb5059965e08ed071c66cb77344bdb569fa56f98a3e1`);
  any drift refuses with `SNAPBACK_BROWSER_IR_COVERAGE_CORPUS_DRIFT`.
- The shipping evaluator closure (`@expo/snapback-client/ir-evaluator` via the
  D5 adapter `js-d5-harness.mjs`) was esbuild-bundled for browser/ESM/ES2022
  and executed inside **Google Chrome 151.0.7922.76** (headless, raw CDP over
  Node's WebSocket, no automation dependency), launched by the shared
  `demos/_kit/chrome-process.mjs` owner.
- Every case's normalized outcome was persisted into IndexedDB and **read
  back**, and the read-back value — not the in-memory one — was compared
  against `expect` using the exact Phase-1 D5 policy (status, whole-plan
  return, changed count, ledger echo, count-exact rows, typed rejection code,
  all-table rollback).
- Browser-vs-Node byte equality held for all 37 normalized outcomes, and the
  corpus manifest digest equals the one pinned in
  `phase1-d5-evidence.2026-08-03.v1.json`, chaining browser == Node == Rust
  host by manifest identity ("D5 exact on both evaluators", Option B
  condition 3).
- The Chrome profile was placed under literal `/tmp`
  (`/tmp/snapback-browser-ir-coverage-*`) per the scoped workaround in
  `issues/20260806-chrome-indexeddb-profile-macos-tmpdir.md`; no IndexedDB
  backing-store error occurred. Cleanup deleted the database, stopped the
  owned Chrome tree, and removed the profile.

## Why the common-path component is INDETERMINATE, not a number

The gate requires 100% execution coverage for "the designated browser
common-path mutations," proven by generated artifacts. No frozen designation
of that mutation set exists: Option B locates the designation act in
`tests/acceptance/fixtures/browser-lane/handler-coverage.v1.json`, which has
not been created, and the dated rulings that mention common paths designate
verb sets (Kanban: `Insert`/`Get`/`Guard`/`Patch`) or exit applications, not a
mutation subset of the frozen corpus. Publishing a percentage against an
invented designation would not be falsifiable against the author's wording, so
the axis is recorded INDETERMINATE and the designation is routed to the author:
`issues/20260806-phase2a-common-path-designation-absent.md`.

As evidence only (NOT the gate metric), the plan-shape M1 admission
classification of the 37 D5 conformance cases is: 22 `ready`, 10 `refused`
(effect classes beyond the `Insert`/`Get`/`Guard`/`Patch` ceiling or bounds
rejections), 5 `server-only` (authoritative expressions or server-only steps).

## Nonclaims

- No phase exit or advancement: per LLP 0129's standing rule, advancement is
  author-presented; this artifact records evidence for that presentation.
- No Parity, capability, store, settlement, or React-presentation claim.
- Semantic coverage is a carried, digest-pinned classification of the frozen
  corpus — this run adds no new audit of demo handler sources.
- The D5 conformance cases are corpus data; nothing here claims generated
  local artifacts exist for any specific demo mutation.

## Reproduce

```sh
node tests/acceptance/browser-ir-coverage-v1.mjs --dry-run   # corpus + bundle only, no browser
node tests/acceptance/browser-ir-coverage-v1.mjs --retain    # full run, writes the dated receipt
```
