# Lane OK round 2 — integrate DG diagnostics and SS Worker device

Date: 2026-09-28. Branch: `sb4-intent/ok-owner-key-coverage`.
Starting HEAD: `ad9e1c76ce7559767656cbf95659c4ce5a0d15ce`.
Fetched and merged `origin/main` at
`80036b4664d0059a91ba5b19223a9e7e9fc6b70d`, containing the DG and SS landings.
The working tree was clean before the merge. Nothing pushed or published.
No tools installed, no shared tool paths or other worktrees changed, no original
calibration store opened. `scripts/test.sh` was not run; the supervisor owns
that landing suite.

## Merge resolution

- `bind/mod.rs`: resolved by hand, keeping both private `mod own_keys` and
  crate-visible `pub(crate) mod audience_diagnostics`. The conflict was the
  neighboring module declarations, not competing implementations of one
  algorithm. Inspected the automatically merged callers: `bind_schema` still
  lowers explicit owner-key projections before schema validation, and its
  E_SYNC branch still calls DG's `public_conflict` to report inherited public
  residency. Parser diagnostic enrichment remains linked to that module.
  Full-key caller-only existence lowering remains in `program/reads.rs`;
  M8's helper/caller/query-cap gates are unchanged. SS's Worker runtime
  imports the same `WebResidency` as the main-thread device, retaining the
  owner-key table counters on both paths.
- LLP 3000.028: used `~/sb4-intent/merge-both.py` to keep both conflict sides,
  then combined their complete Revised text into one metadata field and
  appended this integration revision. The owner-key implementation record
  in §3.4.1 and DG's §10 record remain in place. The original DG-only status
  is explicitly historical; the new §10 paragraph records the integrated
  capability and source/guide guidance.
- `JOURNAL.md`: used the same helper. A line-by-line subsequence check proves
  every line from each parent survives in its original order; this round's
  entry is appended after both. See [merge-preservation.json](round2/merge-preservation.json).
- Removed one inherited extra blank line at EOF in SS's `web-receipts.ts`
  after the staged whitespace check flagged it. No behavior changed there.

## Diagnostics and guide

DG's `offline-interactions` card still said the source owner-key policy was
unavailable. It now preserves the public-summary example and its 6,012-row /
1,342,672 logical-row-byte census, and adds a separately compiled explicit
`with own keys .principal` / ordinary `exists` alternative. Admission,
durable whole-partition publication, caller isolation, sign-out retention,
adoption, old-device refusal and lifetime/write costs are stated. The older
568-byte private-table pilot remains clearly distinct from the implemented
representation; it is not used as its size claim.

M6's E_SYNC and enriched E_QUARRY_SYNTAX repair retain DG's public-read and
online-only alternatives with their consequences, and additionally offer
source owner-key coverage for viewer-owned existence on an eligible public
window. They explicitly exclude aggregate totals from that alternative.
The maintains and sync cards point to the same supported alternative.
N_MAINTAIN_SYNCED and `why ownLikes` already link the updated card; their
aggregate-inheritance statements remain valid. Generic view-sync refusals
retain their remove-to-inherit/online-only repair and DG's scope gates.

The builder diagnostic regression checks the new qualified advice for both
like and repost views and both invalid edits. A compiler regression compiles
both complete card examples: the old summary keeps N_MAINTAIN_SYNCED and no
owner-key capability, while the alternative preserves the source's public
window, removes `ownLikes`, requires the new capability, and reads the private
key projection. The complete existing M6/M8 suite is run with these changes.

## Validation

Logs and exact command/result records are in `round2/`.

| Check | Result | Evidence |
| --- | --- | --- |
| Full `snapback4-device` | 1,373 passed, 0 failed, 5 existing ignored | `lang-device.log`, `rust-summary.json` |
| Full `snapback4-lang`, including DG diagnostics and whole guide | 1,065 passed, 0 failed, 11 existing ignored | `lang-device.log`, `rust-summary.json` |
| Focused compiler integration + whole guide | 9 diagnostics + 93 guide + 4 owner-key tests passed | `integration-smoke.log` |
| CLI check and timeline adoption | 76 + 15 passed | `cli-check-timeline.log` |
| Core schema, timeline authority and authorization | 4 + 5 + 1 passed | `core-schema.log`, `core-timeline-authority.log`, `core-authorization.log` |
| JS device/web, owner-key lifecycle, residency, session security and wire clock | 224 passed, no failures/skips | `web-device.log`, `web-summary.json` |
| Real Chromium Worker protocol | 48 cases passed; zero failures/page errors | `worker-protocol.json` |
| Real Chromium Worker observation/restore fences | 5 cases passed; zero page errors | `worker-watch.json` |
| Native, wasm and package builds; TypeScript | All passed | `build-results.json` |
| Root reference audit | Passed, no errors/unchecked | `ref-check.log` |
| Affected source-file cap | 30 source files within 1,500 lines | `source-cap.json` |

Node 24.13.1, existing worktree dependencies and installed Chromium; no
installation. Rust used `CARGO_INCREMENTAL=0`, `CARGO_BUILD_JOBS=8`,
`RUST_TEST_THREADS=8` and
`LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT`. Commands from `snapback4/`:

```sh
cargo test -p snapback4-lang -p snapback4-device --no-fail-fast
cargo test -p snapback4 --test check --test timeline_adoption --no-fail-fast
cargo test -p snapback4-core --lib schema:: --no-fail-fast
cargo test -p snapback4-core --lib timeline_authority --no-fail-fast
cargo test -p snapback4-core --lib authorization --no-fail-fast
bash scripts/build-wasm.sh
cargo build -p snapback4
bun run --cwd packages/snapback4 build
bun run --cwd packages/snapback4 typecheck
node --test --test-reporter=tap --test-concurrency=1 \
  packages/snapback4/test/device*.test.mjs packages/snapback4/test/web*.test.mjs \
  packages/snapback4/test/own-keys.test.mjs packages/snapback4/test/residency.test.mjs \
  packages/snapback4/test/session-security.test.mjs packages/snapback4/test/server-clock-wire.test.mjs
node witness/worker-protocol.mjs reports/20260928-ok-owner-key-coverage/round2/worker-protocol.json
node witness/worker-watch.mjs reports/20260928-ok-owner-key-coverage/round2/worker-watch.json
```

While the full device run was in its existing long generated-pairs target,
a focused compiler pass ran `cargo test -p snapback4-lang --test own_keys
--test audience_bounds --test guide --no-fail-fast` to validate the merge
without waiting for unrelated device cases. All 106 tests passed; the full
run also includes them, so these are not counted twice in the full totals.

The Node driver sorts/deduplicates the expanded paths; `web-worker-results.json`
retains the exact argv. The native build waited on Cargo's test-build lock;
its 456.590 seconds includes that wait, not just compilation. The separate
Worker witnesses ran after the JS batch and both exit 0. Root ref-check and
whitespace checks run from the repository root.

## Wasm

Fresh build with Rust 1.97.0 and wasm-bindgen 0.2.127, without wasm-opt:
**2,017,908 B raw / 585,100 B GNU gzip-9**, byte-for-byte identical to the
preserved round-1 artifact. Delta **0 / 0 B**. The unchanged **586,193 B**
gzip budget has **1,093 B** headroom. SHA-256:
`1050652571e0f696a94b737f281273ebf73583769a34142e584e52d1f6edfd2a`.
See [wasm.json](round2/wasm.json) and [build log](round2/wasm-build.log).
No meter, dependency, version or budget change in this round.

## Failure ledger

**Test/build failures: ours 0, baseline 0, environmental 0.** All requested
checks exit 0. The initial stale DG guide claim was an integration issue,
corrected before testing; no regression failure was observed. Existing Rust
warnings remain in the logs. No new test was ignored: `rust-summary.json`
lists all 16 inherited ignored entries and their reasons (explicit measurements,
external calibration copies, child-process helpers and tracked reservations).
The owner-key device tests pass 6/6, compiler tests 4/4; DG's diagnostic tests
pass 9/9 and runtime tests 2/2 with their existing external-copy witness ignored.
The whole guide passes 93/93. The full Rust invocation took 1,973.886 seconds,
including compilation and its existing exhaustive/corpus targets.

Historical unresolved limits were not rerun or claimed fixed: round 0's
million-row IndexedDB acquisition stalls, round 1's deliberate custom-opener
shared-store boundary, and SS's separate IDB orphan-recovery witness ticket.
Round 1's web exit-transport timeout did not recur in the complete 224-test
batch. The final run is green; the prior failure remains in its round-1 log.
No `scripts/test.sh` or publication qualification claim is made here.

Non-test failures/inspection misses:

- **Ours, corrected:** the first staging of the new evidence logs retained
  extra blank lines at EOF in eight Cargo logs, which `git diff --cached
  --check` rejected. Removed trailing log whitespace only; test statements,
  assertions, summaries and exit codes are unchanged. Final whitespace checks
  pass.
The merge's initial exit 1 was the three expected content conflicts, all
resolved above. The initial staged whitespace check found the inherited
web-receipts EOF blank line (baseline, corrected). Exploratory inspection
used nonexistent `bind/maintain_diagnostic.rs`, `src/why*`,
`witness/browser.mjs`, `.cargo/config.toml`, and a package-local node_modules
path (ours, inspection assumptions); source discovery and the existing
workspace dependencies supplied the correct paths. These were not test or
build failures. Two exploratory core test filters (`own_keys` and
`timeline_authority_tests`) selected zero cases and are not counted as evidence;
the correct schema and `timeline_authority` filters were then run. No tool
installation was needed.

## Scoped orientation and corpus audit

Read the previous OK prompts, reports and journal entries, Snapback 4's command
sheet/exclusions, adopted rules, governing RFC and DG/SS reports. Applied
`llp-orient` read-only from the initialized lane-a5 skill because this worktree's
aggregate link remains unpopulated. Scope: merge of compiler modules and
source-aware diagnostic/guide integration; no new design or admission policy.

Governing LLPs (current, not foundation): LLP 3000 §4 for the fence;
LLP 2000.000 §§6–7 for metering and per-principal partition custody;
LLP 3000.028 §§3.4, 4, 7.3–7.5 for owner proofs and M6/M8 source context.
Existing implementation records and their `@ref` targets still apply.
No new LLP or gate; updated the existing RFC and current guide together.
Remaining search/React/Expo acceptance belongs to its existing lanes;
this merge makes no new performance, million-key browser or publication claim.
Hand-off: none for the merge. Local commit carries
`Co-Authored-By: GPT-6 Astra <noreply@openai.com>`.
