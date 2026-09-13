# Snapback 4 — review corrections, 2026-09-13

**Author:** Codex / GPT-6
**Requested by:** Charlie Cheever — fix all tickets from the comprehensive review.
**Scope:** R01–R37 in the [original review and ticket index](./3000-architecture-code-review-20260912.md): correctness, performance, architecture and ergonomics. Security assessment remains assigned separately.
**Source:** `3623754dd`, based on upstream `e99eef7e8` (Snapback 4 0.1.15). The complete suite and production binary bind `b13453048`; the JavaScript-only native compatibility follow-up has the affected verification below.
**State:** All 37 filesystem tickets closed; product, package and native compatibility verification passed.

## Implemented corrections

The implementation covers all 37 findings (23 P1, 14 P2). Each ticket retains
its original evidence and records the correction and regression locations.
R09's timestamp packing and R19's waiting-worker bottleneck were already
corrected upstream; this run retained and exercised those changes rather than
claiming a second implementation.

Schema, programs, row projection, changed maintains and persisted generation
publish in one checked transaction. Immutable release directories and the
SQLite activation pointer give inspection, serving and deployment a common
owner. Stale owners cannot mutate a newer generation, including through jobs.

Both device arms retain confirmed before-images and ordered durable writes.
Snapshots remain private through delta catch-up; the drained transaction
publishes the repaired base, acknowledgements and replay together. Watermark,
generation, snapshot owner and durable send revision prevent competing clients
from installing stale data or predicting a write twice. Failed writes restore
confirmed state, transient failures retry, and observations retain dependencies.

Compiler lowering preserves lexical scope, evaluation order, short circuiting
and branch-local narrowing. Actual Rust/TypeScript comparisons cover checked
i53 arithmetic, Unicode ordering, typed aggregate keys and identical cursor
bytes. The corpus checks retained result states and continuations and reports
named exclusions separately. Feed examples now declare their capped immediate
audience; asset examples handle nullable metadata explicitly.

HTTP admission and encoded output have enforced bounds, with shared engine
guards released before socket writes. The integration preserves upstream
response batching. React and live pages have owned lifetimes and coherent
boundaries; reference apps retain drafts and close late-opening clients.
Loop-bar cleanup owns its process handles, and witnesses resolve dependencies
from the Snapback 4 workspace.

## Verification

Executed in the isolated, reused `snapback-sb4-fixtures` worktree with Node
24.19.0, Bun 1.3.12, Rust 1.97.0 and `CARGO_BUILD_JOBS=2`:

| Check | Result |
|---|---|
| `bun install --frozen-lockfile` after 0.1.15 integration | Passed; no tracked lockfile mutation |
| `cargo test --workspace --no-fail-fast` | 121 passed, zero failed/ignored; 18.54 s compilation, 26.96 s summed test execution |
| Existing `scripts/test.sh`, invoked by publication dry run | Zero failures: 121 Rust tests, 91 client tests, 9 fixture tests, package build/typecheck and web/Expo typechecks |
| Rust server conformance within the workspace suite | 211 passing cases, 82 named exclusions; all 24 retained structural refusal cases execute |
| Actual cross-host execution | 24 differential value cases, exact scan/merge cursor comparisons, and 13 compound-expression cases; selected coverage, not full cross-host conformance |
| Final native compatibility follow-up | Package build/typecheck and all 94 client tests passed, including 32 lifecycle cases; no skips/cancellations |
| Final JavaScript repack/install | 72,025-byte client tarball; all 36 shipped dist files match the rebuilt package, installed types/mock/native compatibility checks pass, platform hash unchanged |
| Independent source review | No material findings remain in the reviewed scopes below |
| Production pack/install proof | Passed: production profile, installed CLI version and SHA-256 match; consumer types and online/offline mock behavior pass |
| Final references, moved-ticket links and whitespace | Passed: 471 LLP documents, 8,681 refs, zero errors/unchecked; 366 local Markdown targets resolve; all 37 tickets closed; whitespace clean |

The dry run built and unpacked a **2,710,816-byte** darwin-arm64 production
binary, `snapback4 0.1.15`, with SHA-256
`2c796e9cd0fefb4cb93ec0f2f92c0504d82ef1621a34e6e35a18c21c45cfa934`.
Cargo reported size optimization `z`, no debug information or debug assertions.
The source and installed binary hashes matched. The record is appended to
[the existing publication measurements](../../snapback4/metrics/publish.jsonl).
This completed dry run binds source `b13453048`. The subsequent native startup
guard changes JavaScript only; its rebuilt package was repacked and installed
in the same disposable consumer. Every shipped dist file matches the rebuilt
source, and the installed native entry point refuses the old protocol and
closes its handle. Installed typechecks and mock behavior still pass, with the
same production binary hash.

The full suite's wall time was 277 seconds on this run. Newly linked macOS
executables repeatedly waited before entering `main` with negligible resident
memory and zero CPU; compiled `--list` warmups were launched separately with
at most four children and their PIDs recorded. Warmups are not counted as tests.
This run establishes passing results, not the 60-second cold-start budget.

Detailed local logs and process receipts are retained under
`.llp/ship-runs/sb4-review-fixes-20260913/` in the original source checkout:
`final-cargo-tests.log`, `publication-dry-run-final.log` and the publication
warmup records. The first publication dry run failed on two outdated simulator
examples and a merge fixture's coverage assumption. Those failures were fixed
with retained behavioral assertions and additional refusal/coverage checks;
the final complete suite above passed.

## Independent review provenance

These were same-family Codex agents that did not implement the code in their
assigned review scopes. Findings were returned to the implementation owners.
The verdicts summarize actual agent messages; no cross-family panel or
independent test execution is represented.

- `/root/review_core_final` reviewed activation, core/job ownership and native
  lifecycle corrections. Its final protocol re-review found no material
  findings: drained streams advance through commits without viewer events;
  snapshot/catch-up remains private until atomic publication, acknowledgement
  recording and replay; owner/send-revision checks happen inside the write
  transaction. The final source includes the two-owner, intervening-send
  regression. This was read-only review; the lead ran Cargo.
- `/root/review_periphery_final` returned **“No material findings remain in my
  defined periphery review scope.”** That scope covered compiler, CLI, HTTP,
  React, reference apps and tooling. Its final expression follow-up checked
  source ordering, lazy branches and pending projection provenance.
- The same independent periphery reviewer then inspected `e7bc993ad` and the
  HTTP integration onto `e99eef7e8`, returning **“No material findings remain
  in this integration delta.”** It checked bounded encoding with batching and
  response-before-drain behavior, capped feed examples, nullable duration and
  the full-versus-horizon merge fixtures. No additional builds or tests were
  run by that reviewer.

The packaging audit also reproduced a mixed-version startup failure with the
old Expo 0.1.14 operation set. `/root/react_apps` implemented an early read-only
receipt check with owned cleanup and rebuild guidance. The independent
`/root/review_periphery_final` then returned **“No material findings remain in
this compatibility delta.”** It checked online/offline startup, malformed
receipts, operational error preservation and current-core acceptance. That
review was read-only; the implementation lane ran the 94-test client suite.

## Remaining design scope

[3000.000](../3000.000-atomic-schema-and-release-activation.research.md),
[3000.001](../3000.001-durable-replica-and-write-lifecycle.research.md),
[3000.002](../3000.002-end-to-end-resource-bounds.research.md) and
[3000.003](../3000.003-one-semantics-and-credible-verification.research.md)
remain Draft Research with implementation follow-ups. Their larger questions
include durable terminal-outcome discovery, bounded replay/history/acquisition,
global physical memory and connection/deadline policy, asset argument
normalization, and complete cross-host conformance. Ticket closure does not
accept those proposals on the author's behalf.

Native execution here covers the Rust device and C ABI hosted by the real
client tests. The iOS XCFramework and simulator witness were not rebuilt or
rerun; native Expo publication requires those artifacts to be rebuilt from the
updated core. The publication action in this run is a local dry run.
