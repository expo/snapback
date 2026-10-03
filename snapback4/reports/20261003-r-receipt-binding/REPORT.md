# Lane R — generated receipt binding and useSeen

Base `22f2207f3fadb355f2964ba0e463e002e16c3f07`, branch
`sb5/r-receipt-binding`, eb1000, 2026-10-03. Implements LLP 3000.032 §4.3
under Charlie's full-implementation ruling. Governing contract:
[LLP 3000.022 §14.6](../../../llp/3000.022-delivery-the-sdk-reports.rfc.md#14.6).
No push or publication.

## API and decisions

```tsx
const history = usePage(api.history, { conversation: id });
const through = Math.max(0, ...history.items
  .filter(m => visibleIds.has(m.id) && !m.pending).map(m => m.ordinal));
const seen = useSeen(api.receiptFamilies.chat, { scope: id, through, active: foreground });
const decorations = usePage(api.messageReceipts, { conversation: id });
```

The generated typed descriptor contains member/seen operations, their actual
scope/through argument names, the existing delivery fingerprint and the
scope/counter/message/member/progress mapping. It follows explicit names,
module-qualified operations and hygienic argument collisions. Member names
are compiler-only metadata; no core schema, wire, receipt capability or
fingerprint change. `why seen` names the generated family and accounting fields.
The `receiptFamilies` API namespace refuses collisions only when clauses exist.

`useSeen` names the one assertion this hook owns. `useReceipts` would imply
history, delivery or receipt-query ownership. The app still supplies actual
viewport/foreground evidence on web/native. Numeric `through` cannot prove row
origin or human attention. It must exclude pending rows and reflect currently
visible confirmed messages, not all acquired/loaded messages or the counter.
No DOM calls, automatic paging, delivery mutation or catch-up query is added.

Mounted screens share one member observation and one admission/pending flight per
client/family/scope. Progress is monotonic; member seen/join floors and successful
calls suppress duplicates. Only current nonpending member observations permit
progress. Withdrawal, member identity/floor replacement, session/viewer changes
and client/store/generation fences retire local progress and ignore late results.
Default read retention is kept; a fresh committed visible render supplies the
positions again after withdrawal. Last unmount removes observations/timers/state;
same-turn Strict Mode replay retains the shared flight. No remount cache.

Writes use the existing outbox and `waitSeconds: 0`. A minted ID binds an early
terminal notification even before mutate resolves; receipt lookup also handles
recovered terminal results. Known pre-admission E_ADMISSION,
E_ADMISSION_STORE and E_ADMISSION_TIMEOUT retry at 1 second doubling to 60,
with eight retries. Hidden owners do not dispatch; reconnect or `retry()` wakes
only those known failures after repair. Terminal refusals and thrown unknown
outcomes remain failed. Submitted calls can finish admission after unmount;
no new calls start. Restart preserves admitted SDK custody, not an extra queue.
The returned `state`, `through`, `why`, `retry` are local progress, never a
confirmed receipt or delivery claim.

Rejected: guessing default names; changing core receipt serialization; weakening
prediction or receipt accounting; automatic visibility detection; a global
unbounded progress cache; a second durable retry queue; retrying unknown writes;
a recipe-only substitute for the commissioned helper. The two reads keep
independent authority. Decoration refusal never withdraws retained history or
authorizes media. No allocator, recipient, removal, hole/compaction, replay or
metering semantics change.

Docs: client, receipt and social guide cards; package README and
CLIENT-AND-OPERATIONS; social starter README/Conversation; generated API comments
and built public `.d.ts` comments. README stays at 300/300 physical lines and the
client card at 1,200 words. The starter consumes the real exported hook and its
existing FlatList viewability IDs.

## Real builder pilots

[Preserved before/after files and hashes](./pilots/measurements.json).
R3's full source is the original G47 lane on this host. Cal29's full client is
`/tmp/cx-cal29/src/chat.tsx`, preserved by the earlier CX evidence work; its
SHA-256 `c859b8c1f6e747231c93b40c4c0cb3f25c03da75fd3edfa9a311d220c21ebaac`
matches the original evidence ledger. Its schema matches the supplied Cal29
bundle; `windows.q` comes from that bundle. Frozen benchmark originals were not
edited. Both selected before spans exactly reproduce §2.3's lines and bytes.

Counts are physical source lines (including blanks in whole blocks), UTF-8
bytes excluding the final newline. No reformatting to manufacture savings.
Different pilots are not added together.

| Specimen | Before lines / bytes | After lines / bytes | Change |
|---|---:|---:|---:|
| G47 R3 hook, imports excluded | 37 / 1,742 | 6 / 366 | −31 / −1,376 |
| Cal29 R4 newest position + call | 2 / 371 | 2 / 297 | 0 / −74 |
| G47 complete changed hook file, imports included | 41 / 1,924 | 9 / 468 | −32 / −1,456 |
| G47 complete ConversationView, visibility integration included | 411 / 15,736 | 421 / 16,590 | +10 / +854 |
| G47 both changed client files | 452 / 17,660 | 430 / 17,058 | −22 / −602 |
| Cal29 complete chat client, visibility integration included | 46 / 16,754 | 50 / 17,135 | +4 / +381 |
| Cal29 schema + windows (unchanged) | 406 / 20,082 | 406 / 20,082 | 0 / 0 |
| G47 schema migration to existing receipts clause | 642 / 25,969 | 566 / 22,592 | −76 / −3,377; **not helper savings** |

Behavior changes: R3 no longer gates on global acquisition or reports every
loaded row from an always-active screen. FlatList viewport IDs, route focus and
AppState supply actual visibility. Cal29's ScrollView supplies viewport offset
and size plus row bounds, intersected with current nonpending page rows; it also
uses route focus and initializes foreground from AppState. Both reset viewport
state on scope/client/viewer changes, coalesce progress and get tested admission
retry handling. Cal29 loses its redundant member query and seen ref. History
and decoration queries remain separate. These additions are included in the
full-file rows above, not hidden in the selected hook reductions.

G47 predates declarative receipt allocation. Its pilot migrates the existing
manual recipe to the current clause with explicit old names, removing manual
progress/runs definitions, allocation/count/floor writes and leave cleanup.
This is an existing-platform prerequisite, not new receipt-protocol savings.
It gains existing v4 provisional-accounting exclusions and bounded hole
compaction; no migration of a live historical store was performed. Cal29's
seven mapping and four independent query lines remain byte-for-byte intact.

The helper has real lifecycle/duplication value and a measured net reduction in
G47. Cal29 gets stronger ownership/correctness but **no overall LOC or byte
saving** once missing visibility handling is supplied. No score uplift, full
app benchmark rerun or native UI runtime claim follows from these pilots.
Both after schemas compile; actual generated APIs and the selected receipt
integration code strictly typecheck; full edited client files parse. Run
`node reports/20261003-r-receipt-binding/pilot-check.mjs` from `snapback4/`.

## Checks and failure classification

Command output is retained verbatim in lossless `.log.gz` archives (read with
`gzip -cd FILE.log.gz`). This preserves test-runner whitespace without adding
whitespace errors to the source patch.

Environment for canonical checks:

```sh
export PATH=$HOME/.local/bin:$HOME/.cargo/bin:$HOME/.bun/bin:$PATH
export CARGO_TARGET_DIR=$HOME/sb5-lanes/target
export CARGO_INCREMENTAL=0
```

The ignored worktree-local `snapback4/target` is a real directory; its build
subdirectories link to the requested shared target. File-backed tests require
a real data parent, so linking the entire target directory was insufficient. Node 24.13.1. No budget increase, package version bump, publication
or product-test relaxation.

- `cargo test -p snapback4-lang --test declarative_receipts --test guide` — initial
  [log](./guide.log.gz): `test result: ok. 152 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 214.94s`
  and `test result: ok. 110 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 4.48s`.
  This precedes the final guide edits; it is the existing accounting regression
  evidence, not final guide qualification.
- `cargo test -p snapback4-lang --test guide --test declarative_receipts client_binding`
  — [log](./binding-tests.log.gz): `test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 152 filtered out; finished in 0.04s`.
  The filtered guide target runs zero cases and is not counted as guide qualification.
- `bun run --cwd packages/snapback4 build` — [log](./client-build.log.gz), exit 0;
  emits `receipt-family.d.ts`, `seen-progress.d.ts` and `react.d.ts` with public docs.
- `node --test packages/snapback4/test/seen.test.mjs packages/snapback4/test/seen-devices.test.mjs packages/snapback4/test/react.test.mjs`
  — [log](./focused-final.log.gz): `ℹ tests 68`, `ℹ pass 68`, `ℹ fail 0`, `ℹ skipped 0`.
  Eight local-lifecycle cases; real React Strict Mode/viewport cases; real process
  and wasm generated-binding/offline-restart/leave-rejoin/retained-denial cases.
- `node --test packages/snapback4/test/read-types.test.mjs` — [log](./types-final.log.gz):
  `ℹ tests 6`, `ℹ pass 6`, `ℹ fail 0`, `ℹ skipped 0`.
- Social starter/browser checks initially passed 32/34 including the parent
  failure; one actual assertion expected every member read to use keep:false.
  **Ours**, corrected to assert both the composer's immediate read and the
  hook's default fenced read, with no subscriber-free linger. The affected
  browser rerun [log](./social-final.log.gz): `ℹ tests 24`, `ℹ pass 24`, `ℹ fail 0`, `ℹ skipped 0`.
  The initial [log](./social.log.gz) also retains the passing generated starter
  and guide TypeScript check and real process/wasm starter behavior.
- `SNAPBACK4_BIN=/tmp/lane-r-snapback4 node reports/20261003-r-receipt-binding/pilot-check.mjs`
  — [log](./pilots.log.gz):
  `g47: schema check, generated API + receipt specimen strict typecheck, full edited client syntax: PASS`
  and `cal29: schema check, generated API + receipt specimen strict typecheck, full edited client syntax: PASS`.
  Initial Cal29 copied only schema.q; missing windows.q refused three names.
  **Ours, pilot setup**, corrected by copying unchanged windows.q from the bundle.
- `bash scripts/build-wasm.sh` — first qualified [log](./wasm.log.gz):
  `wasm 2030224 B raw, 610085 B gzip (budget 610782: ok)`.
  The final nonincremental full-suite build reports
  `wasm 2031329 B raw, 610520 B gzip (budget 610782: ok)`.
  These are two measured whole artifacts under different build inputs; no
  per-feature byte attribution or cross-host measurement is claimed. Final
  headroom is 262 B; `metrics/wasm-budget.json` is unchanged. The source and
  distribution artifacts are byte-identical; [hashes](./wasm-artifacts.json).
- Initial wasm setup failed with `error: failed reading 'target/wasm32-unknown-unknown/wasm/snapback4_device.wasm'`:
  **environmental**, script uses a local target path while Cargo used the shared
  directory. The local target symlink repaired it. Initial source typecheck also
  found a new exact-optional-property error (**ours**, fixed) and missing wasm
  declarations (**environmental**, generated by the repaired build).
- A read-types invocation from the repository root failed six cases with TS2688
  missing Node types: **environmental command working directory**. The unchanged
  checks, including the new case, all pass from the required Snapback 4 workspace.
- Two incremental guide runs and a diagnostic rerun returned old embedded
  `type Viewed`/`client.mutate(api.seen...)` card text while the source and new
  CLI contained `useSeen`: **environmental stale shared incremental artifacts**.
  [Diagnostic output](./guide-diagnosis.log.gz) preserves the actual old card.
  Nonincremental rebuilding exercised the edited card and revealed **our**
  overlong client card and replaced wording required by existing assertions.
  Both were corrected without raising budgets or dropping assertions. The
  intermediate [clean log](./guide-clean.log.gz) and [budget-fix log](./guide-qualified.log.gz)
  retain these development failures; the latter started before the final
  1,200-word edit. Final guide results belong to the repaired complete Rust run below.
- `node scripts/docs-budget.mjs` initially reported
  `docs budget: README 333/300 physical lines`: **ours**, fixed by updating the
  existing README receipt paragraph and putting the complete recipe in its
  linked client reference. The full suite reports `docs budget: README 300/300 physical lines`.
- `./ref-check --verbose` — [log](./ref-check.log.gz):
  `ref-check: ok — 526 LLP docs, 10108 refs in 32528 files, 0 errors, 0 unchecked`.
- `/tmp/lane-r-snapback4 why seen` in the Cal29 after pilot — exit 0;
  [output](./why-seen.log.gz) identifies `api.receiptFamilies.chat`, `receiptMember`,
  `seen`, and all accounting fields.
- Final `./ref-check --verbose` — [log](./ref-check-final.log.gz):
  `ref-check: ok — 526 LLP docs, 10108 refs in 32532 files, 0 errors, 0 unchecked`.
- `git diff --check` — exit 0. Staging raw runner logs initially reported
  whitespace in their output; storing them losslessly compressed resolves those
  evidence-only warnings. Final `git diff --cached --check` passes.
- Final `node snapback4/scripts/docs-budget.mjs` — exit 0:
  `docs budget: README 300/300 physical lines` and
  `test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 109 filtered out; finished in 0.00s`.
- Preserved pilot ledger recheck —
  `All 12 preserved pilot file hashes, line counts and byte counts agree with the ledger.`

`bash scripts/test.sh` ran once, exit 1. Its summary is **verbatim**:

```text
== 2 failure(s) in 1518 s
   cargo test
   client tests
```

The client sweep reports `ℹ tests 5806`, `ℹ pass 5751`, `ℹ fail 45`,
`ℹ skipped 10`. Its separate full-count models report `ℹ tests 79`,
`ℹ pass 79`, `ℹ fail 0`, `ℹ skipped 0`, and
`-- ok: client models (377 s)`. The ten existing skips name unavailable macOS
media/native witnesses, managed identity fixtures and pinned legacy binaries;
they remain skips, not passes. All other script stages pass.

The complete Rust stage was rerun with `node scripts/run-rust-tests.mjs` after
fixing its artifact-build blocker. It reports
`-- rust inventory: 285 test binaries, 998 executions; at most 24 concurrent processes`.
993 executions and the workspace doctests pass; five target executions contain
the fixture/environment failures below. Their affected reruns all pass. The
original Rust-stage rerun remains exit 1, not retroactively green.

[FAILURES.md](./FAILURES.md) maps every failed client case and Rust target to
its cause and passing rerun. There are no unresolved introduced failures and
no inherited-failure claims requiring an unperformed base proof. Classifications:

- **Ours, fixture construction:** adding compiler-only `Bound.receipt_members`
  left `tests/serve_poison/mod.rs`'s explicit initializer incomplete. Corrected;
  the complete test inventory now builds.
- **Ours, source census:** the delivery await boundary snapshot records every
  TypeScript file, including zero-await files. Added the two zero-await entries
  for `receipt-family.ts` and `seen-progress.ts`; no existing delivery site or
  fault recipe changes. `node --test --test-name-pattern='every delivery await is explicitly classified' packages/snapback4/test/delivery-fault-matrix.test.mjs`
  — [repaired log](./delivery-census-repaired.log.gz): `ℹ tests 1`, `ℹ pass 1`, `ℹ fail 0`.
- **Ours, copied-contract fixtures:** two frontend cases copy `contract.ts` into
  a scratch directory and now also need its type-only `receipt-family.ts`
  dependency. Corrected both fixtures. `cargo test -p snapback4-lang --test frontend_regressions`
  — [repaired log](./frontend-repaired.log.gz): `test result: ok. 40 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.87s`.
- **Environmental, local target layout:** 25 unchanged file-store cases in four
  core test targets rejected the target-directory symlink with
  `Store("private store: private data directory must be a real directory")`.
  Replaced it with a real directory and linked only build subdirectories.
  The original failures remain in [complete Rust log](./rust-repaired.log.gz);
  [integration rerun](./real-directory-repaired.log.gz) and
  [eight core-case rerun](./core-directory-repaired.log.gz) retain the repaired checks.
  No product source or filesystem protection was changed. The unchanged
  integration targets now report:
  `test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 9.26s`,
  `test result: ok. 18 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 197.49s`,
  `test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 8.96s`.
  The eight exact-filter core reruns report
  `8 formerly failing core cases passed; source unchanged.`

- **Ours, documentation example:** the added package recipe initially omitted
  imports and typed parameters. Made it a self-contained `useReceiptScreen`
  function; extended the README test's generated-API fixture with typed receipt
  operations. Its existing every-public-function coverage now includes useSeen.
- **Environmental, shared CLI replacement:** the two seen-device tests observed
  generated APIs without `receiptFamilies`, and social-browser saw the old
  starter. The shared binary SHA-256 had changed from the lane's saved binary.
  Worker route/restart cases also reported repeated startup ENOENT; the launcher
  re-executes its own pathname, so concurrent replacement is the supported
  diagnosis. Rebuilt with the requested shared Cargo target, then copied the
  binary into the real worktree-local `target/lane-r/` for the reruns.
- **Environmental, witness helper lookup:** all 36 witness-acquire failures came
  from running the shared executable outside a checkout/package hierarchy:
  `E_WITNESS_PROCESS: install the matching snapback4 client package to run witness acquire`,
  or consequential missing/empty output. The isolated local copy restores helper
  discovery through its ancestors. No witness source changes.
- **Environmental, Node HTTP teardown:** `per-row-liveness.test.mjs`'s cases
  passed, then asynchronous activity raised
  `TypeError: Cannot destructure property 'socket' of 'parser.deref(...)' as it is undefined.`
  The unchanged file passes in the repaired run. This is a transient runtime
  failure under the original concurrent pool, not an inherited product claim.

Final repaired client command (after the README fix, with an isolated binary):

```sh
export SNAPBACK4_BIN=$PWD/target/lane-r/snapback4
node --test --test-concurrency=4 \
  packages/snapback4/test/per-row-liveness.test.mjs \
  packages/snapback4/test/readme-examples.test.mjs \
  packages/snapback4/test/routes.test.mjs \
  packages/snapback4/test/seen-devices.test.mjs \
  packages/snapback4/test/server-e2e.test.mjs \
  packages/snapback4/test/social-browser.test.mjs \
  packages/snapback4/test/social-starter.test.mjs \
  packages/snapback4/test/witness-acquire.test.mjs
```

[Repaired client log](./client-repaired.log.gz), exit 0, verbatim counts:

```text
ℹ tests 126
ℹ suites 0
ℹ pass 126
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 113922.009954
```

No second full-script invocation masks the first red; the original complete
run plus explicit failed-stage repairs is the qualification record. No source
change remains untested in its affected scope.

The complete declarative receipt target reports
`-- rust target: snapback4-lang::declarative_receipts (225.4 s): test result: ok. 154 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 225.36s`.
The final complete guide result is
`-- rust target: snapback4-lang::guide (5.8 s): test result: ok. 110 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 5.75s`.

## Limits

The hook cannot validate that a caller's numeric position was visible/confirmed;
the recipe and starter enforce that selection. Native device behavior is tested
through the process device and the same DOM-free owner; React Native viewability
uses browser host stubs, not a macOS/iOS simulator on this Linux host. The pilot
checks cover receipt integration, not unrelated full application behavior.
The final-unmount policy intentionally requires renewed visible evidence and
leaves already submitted mutation custody with the existing SDK.


## Round 1 — both blind reviews (2026-10-03)

Folds Astra and Grok's round-0 READY WITH CHANGES reviews of `23049b4fc2`.
All requested fixes are implemented. No push, publication or full-suite rerun.

- **Namespace collision:** check the final bound programs' emitted API roots,
  including actions, instead of the earlier declaration-only `api_roots` map.
  A bare `receiptFamilies` action and an action-only `receiptFamilies.q` module
  now refuse `E_RECEIPTS_CLAUSE` when a receipt clause exists. Both still compile
  without a receipt clause. Added separate positive/negative regression cases.
- **Terminal failure recovery:** a non-admission failure remembers the rejected
  flight position, resets `target` to `max(floor, acknowledged)`, then publishes
  `failed`. A later active, different safe position above that covered floor
  clears the failure and starts a new attempt. Repeated rejected input,
  reconnect and `retry()` cannot resubmit that position. `reset` clears it.
  Exhausted admission retries still require reconnect or explicit repair.
  LLP 3000.022 §14.6, the receipts card, client reference and public hook comments
  now state this distinction; monotonic coalescing excludes a discarded target.
- **Regression strength:** each of `PAST_LAST_MESSAGE`, `NOT_MEMBER` with the
  member still present, and a thrown `E_CLIENT` exercises `100` refused → `40`
  sent; rejected `100` stays suppressed until reset. The tests also cover queued
  input discarded by the failure, covered/invalid/hidden input, and reset.
  Rejoin checks both the exact floor and unchanged `seenOrdinal` after viewing
  it on process and wasm. Fixtures expose listener counts; final unmount reaches
  zero after shared ownership, same-turn replay and real React Strict Mode.

Verification used the requested PATH, `CARGO_TARGET_DIR=$HOME/sb5-lanes/target`
and `CARGO_INCREMENTAL=0`. The newly built CLI was copied to
`target/lane-r-round1/snapback4` before device tests and pilots, avoiding shared
binary replacement. [Artifact hashes and tool versions](./round1/artifacts.log.gz)
record the isolated binary and matching source/distribution wasm.

| Command / scope | Result | Evidence |
|---|---|---|
| `cargo test -p snapback4-lang --test declarative_receipts client_binding` | 4 passed, 0 failed | [binding](./round1/binding.log.gz) |
| `cargo test -p snapback4-lang --test guide` | 110 passed, 0 failed; whole guide | [guide](./round1/guide.log.gz) |
| `cargo build -p snapback4` | exit 0 | [CLI build](./round1/cli-build.log.gz) |
| `bun run --cwd packages/snapback4 build` | exit 0; rebuilt after wasm | [client build](./round1/client-build.log.gz) |
| `node --test --test-concurrency=2` on `seen.test.mjs`, `seen-devices.test.mjs`, `client-lifecycle.test.mjs` | 68 passed, 0 failed/skipped: 9 seen, 2 seen-device, 57 client lifecycle | [lifecycle](./round1/lifecycle.log.gz) |
| `node --test --test-concurrency=2` on `react.test.mjs`, `read-types.test.mjs` | 64 passed, 0 failed/skipped: 58 React, 6 public types | [React/types](./round1/react-types.log.gz) |
| `bash scripts/build-wasm.sh` | 2,031,329 B raw / 610,519 B gzip; budget 610,782 B | [wasm](./round1/wasm.log.gz) |
| `node scripts/docs-budget.mjs` | README 300/300 lines; self-contained first-screen test passes | [docs budget](./round1/docs-budget.log.gz) |
| `./ref-check --verbose` | 526 LLP docs, 10,108 refs, 0 errors/unchecked | [references](./round1/ref-check-final.log.gz) |
| `git diff --check` | exit 0 | final working/staged diff checked |

The wasm ceiling is unchanged, with 263 B headroom. This round's gzip measurement
is 1 B below round 0's final measurement; no per-feature byte saving is claimed.
The source and distributed wasm SHA-256 hashes match.

The new tests were checked against temporary mutations of the built module,
then the original module was restored before final verification:

- Removing the `failed` guard admits a tenth call after the nine allowed
  admission attempts; the new render-after-exhaustion assertion fails
  ([log](./round1/mutant-failed-guard.log.gz)).
- Removing the `Progress.close()` unsubscription loop leaves four client
  listeners after final unmount, including replay; the zero-count assertions
  fail ([log](./round1/mutant-unsubscribe.log.gz)).
- Changing the coverage test from `<=` to `<` fails the exact-floor unit case
  ([log](./round1/mutant-join-floor.log.gz)). The same broad mutant also fails
  both real-device journeys before rejoin through repeated covered writes;
  that additional run is supplementary, not isolated evidence for the rejoin
  assertion ([log](./round1/mutant-device-floor.log.gz)).
- Removing the terminal target reset fails the new terminal recovery case
  ([log](./round1/mutant-terminal-target.log.gz)).

One development failure was ours: the first two action fixtures omitted the
required `use server` directive. The [initial log](./round1/binding-initial.log.gz)
retains that refusal; both fixtures were corrected and the binding target passes
4/4. Intentional mutant reds above are test-strength evidence, not unresolved
product failures. No other final check failed.

**Pilots rerun:** `SNAPBACK4_BIN=$PWD/target/lane-r-round1/snapback4 node
reports/20261003-r-receipt-binding/pilot-check.mjs` passes for G47 R3 and Cal29:
schema compilation, actual generated API plus receipt specimen strict typecheck,
and full edited client syntax ([pilot log](./round1/pilots.log.gz)). Raw compiler
outputs are preserved for [G47](./round1/pilot-g47-check.log.gz) and
[Cal29](./round1/pilot-cal29-check.log.gz). All 12 preserved before/after source
hashes, line counts and byte counts match round 0
([measurement recheck](./round1/pilot-measurements.log.gz)).

**Round 1 pilot line/byte change: zero in every file.** R3 remains 37 lines /
1,742 B → 6 / 366; Cal29 R4 remains 2 / 371 → 2 / 297. Including visibility
wiring, G47's two changed client files remain 452 → 430 lines (−22 / −602 B),
and Cal29 remains 46 → 50 (+4 / +381 B). The original scope limits stand: this
is receipt integration qualification, not a full application benchmark or
native UI runtime qualification. Cal29 has no overall code-size saving.
