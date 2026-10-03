# Lane B — pending intent presentation

Base: `22f2207f3fadb355f2964ba0e463e002e16c3f07`, branch
`sb5/b-pending-intents`, eb1000. Implements Charlie’s 2026-10-02 ruling on
LLP 3000.032 §4.2. No push or publication.

## API and decisions

`snapback4/react` exports `usePendingItems`, `usePendingState`, and public
item/phase/options types. The pure composition functions remain internal.

```tsx
const items = usePendingItems({
  writes: [api.send, api.sendMedia], rows: page.items,
  scope: w => w.args.conversation === id,
  rowKey: row => row.id, intentKey: w => w.args.id,
});
const like = usePendingState(api.setLike, {
  scope: w => w.args.postId === card?.id,
  current: card?.liked, value: args => args.set,
});
```

Items discriminate `{kind:"row", key, row}` from
`{kind:"intent", key, write, phase, receipt?}`. Phases are `saving`, `queued`,
`unknown`, `held`, `settling`. The app supplies scope and identity mapping;
mutation IDs are never treated as row IDs. The state selector returns
`{value, intent}` from the last matching admitted intent in FIFO order.

The local view reads existing outbox entries plus the existing receipt window
and unpersisted known receipts. Successful, unobserved entries stay visible
although `pendingWrites()` omits them. Prediction only suppresses a duplicate
card while its mapped row is present. The device’s observed-write retirement
and terminal refusal remain authoritative. No second outbox, resend loop,
receipt persistence, artificial row, ordinal, recipient count, delivery/seen
proof, or media handle is created. No timer guesses completion. A terminal
receipt wins over a not-yet-released identity/admission caller.

One shared React source subscribes before reading, preserves equal snapshots,
rejects superseded reads, and gates access synchronously by scope token. Facades
also run their existing authority check. Sign-out, close, account/credential,
backend/store and generation retirement cannot expose old arguments, even while
a refresh fails or waits. This concerns future access, not copies already taken
by application code. Supplied rows remain the caller’s live-read responsibility.

The online client has no device observed-write log. Its session presentation
holds the original successful submission reference until a matching confirmed
row is supplied; set-state observations retire successes through the matching
position so an earlier opposite value cannot reappear. This adds no persistence
or replay authority, and does not change online journal retirement. Successful
online references do not survive close/restart. A saved scoped intent reference
and `usePendingWrite(op, id)` remain the failure/unknown-recovery recipe. No-op
or out-of-page online successes can remain for the live scope; no timeout
pretends that they were observed. The mock’s close fence is also registered.

Rejected: mapping `usePendingWrites()` alone (loses settlement), equating mutation
and row IDs, guaranteeing predicted rows under unknown authority/coverage,
timer retirement, and replaying saved UI references. `contract.ts`, Rust engine,
device protocol, custody ordering, and receipt accounting are unchanged.

Governing decision: LLP 3000.019 §3.3.1, with references to .022 §14 and .023.
The client/writes/social guide cards, starter README, package README and
Client and operations contain the paved form. Source JSDoc is emitted into
`dist/react.d.ts` and `dist/pending-items.d.ts`; generated files are not committed.
A consumer test compiles those declarations and rejects row/intent confusion.

## Real builder pilot

See [PILOT.md](./PILOT.md) and [exact measurements](./pilot/measurements.json).
The full original and rewritten files are retained under `pilot/`.

| Specimen | Before physical lines / bytes | After | Byte delta |
| --- | ---: | ---: | ---: |
| B1 | 1 / 42 | 1 / 152 | +110 |
| B2 | 1 / 238 | 1 / 318 | +80 |
| B3 | 1 / 281 | 1 / 283 | +2 |

UTF-8 bytes exclude the selected excerpt’s final newline, matching §2.3. B1+B2
are 2 / 280 → 2 / 470. Combined B1–B3 are 3 / 561 → 3 / 753 (+192 B).
The complete two-file change, including imports and the pending indicator,
grows 204 B with no physical-line change. The rewritten real app typechecks.

The pilot does not establish a code-size win: it misses the original reduction
target. It adds media-send coverage, truthful phases and the tested settlement
interval. Its benefit is centralized correctness for that composition; no
builder-score uplift or causal experience improvement is claimed.

## Verification

Complete outputs are retained as `.log.gz` artifacts. Commands run from
`snapback4/` with Node 24.13.1 and `CARGO_TARGET_DIR=~/sb5-lanes/target`.
The final guide and affected Rust reruns additionally use
`CARGO_BUILD_TARGET=x86_64-unknown-linux-gnu CARGO_BUILD_JOBS=6`, isolating native
artifacts under the requested shared target root after another lane’s guide
binary appeared in an early default-target run.

- `bun run --cwd packages/snapback4 typecheck` and `bun run --cwd packages/snapback4 build`: exit 0; declarations emitted.
- `node --test packages/snapback4/test/pending-writes.test.mjs`: `ℹ tests 39`, `ℹ pass 39`, `ℹ fail 0`.
- Initial affected run: `ℹ tests 470`, `ℹ pass 469`, `ℹ fail 1`. The failure was the delivery-await census after adding read-only presentation awaits. Regenerated the census with an explicit classification comment; delivery custody awaits and fault recipes are unchanged.
- Focused rerun (pending items, React, declaration consumer, delivery-boundary census): `ℹ tests 72`, `ℹ pass 72`, `ℹ fail 0`. The two later regression cases and final prediction-reappearance/hold assertions are also included in the final package run.
- Pilot `/tmp/lane-b-cal29`: `bun run typecheck` emitted `$ tsc --noEmit`, exit 0.
- `cargo test -p snapback4-lang --test guide`: `test result: ok. 110 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 4.71s`. Earlier documentation failures were ours: word/line limits and a slash interpreted as a file reference. Fixed without raising budgets or changing tests; the early foreign-lane guide run is environmental and makes no qualification claim.
- `bash scripts/build-wasm.sh`: initial 2,030,224 B raw / 610,085 B gzip; full suite rebuilt 2,031,329 B raw / 610,520 B gzip. Both pass the unchanged 610,782 B gzip cap (latest headroom 262 B). This lane changes no wasm engine source. Shared build outputs changed during concurrent lane work; these are recorded artifacts, not a paired feature-size attribution.

The required full `bash scripts/test.sh` run and final reference audit are recorded
below. [FAILURES.md](./FAILURES.md) names every failed case and its classification.
No failure is labelled inherited without a base reproduction.

The new tests exercise no prediction, prediction withdrawal/reappearance,
receipt before sync/admission completion, FIFO and refused tail, actual media
upload, offline restart (including unknown outcomes), and backend replacement
on process and wasm. Additional source/React tests cover read-only receipts,
store-qualified sequence evidence, saving versus admission, last set-state,
StrictMode sharing/remount, async authority fences, account retirement,
failed refresh, the online session interval, and mock close. The generated
declaration test enforces the row/intent union and mixed-operation argument types.

Affected corrections, verbatim summaries:

```text
# node --test packages/snapback4/test/pending-items.test.mjs
ℹ tests 14
ℹ pass 14
ℹ fail 0
# cargo test -p snapback4-core --test row_view_accounting --test row_view_disclosure --test row_view_witness -- --test-threads=2
test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 9.35s
test result: ok. 18 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 195.73s
test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 8.15s
# cargo test -p snapback4-core --lib engine::row_views:: -- --test-threads=2
test result: ok. 56 passed; 0 failed; 0 ignored; 0 measured; 149 filtered out; finished in 130.62s
# cargo test -p snapback4-device --test event_slots_trace
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.38s
# node --test packages/snapback4/test/event-slot-capability.test.mjs packages/snapback4/test/event-slots.test.mjs
ℹ tests 48
ℹ pass 48
ℹ fail 0
```

The full package run initially reported `ℹ tests 5753`, `ℹ pass 5702`,
`ℹ fail 41`, `ℹ skipped 10`. Classification: one lane-owned documentation
example failure; two missing generated-trace files; two social starter/browser
failures from a foreign shared CLI emitting Lane R APIs; and 36 witness tests
whose shared CLI path could not find the checkout's SDK helper. The browser log
explicitly names the unavailable `useSeen` export. See FAILURES.md for every
case and exact evidence in `client-full-initial.log.gz`.

Corrected the documentation examples and their strict operation fixture. Pure
selectors are internal implementation; the two hooks and item types are the
public surface. Rebuilt this checkout with the explicit native host target,
then copied the resulting CLI to `snapback4/target/lane-b-bin/snapback4`, a
private immutable path with the correct SDK-helper ancestry. With
`SNAPBACK4_BIN=$PWD/target/lane-b-bin/snapback4`:

```text
# node --test --test-concurrency=4 packages/snapback4/test/readme-examples.test.mjs packages/snapback4/test/read-types.test.mjs packages/snapback4/test/react.test.mjs packages/snapback4/test/social-browser.test.mjs packages/snapback4/test/social-starter.test.mjs packages/snapback4/test/witness-acquire.test.mjs
ℹ tests 150
ℹ suites 0
ℹ pass 150
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 92365.631774
# cargo test -p snapback4-lang --test guide
test result: ok. 110 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 4.54s
```

These are affected reruns, not a claim that the original full invocation was
green. Every original failing test has now passed after its documented correction.
The full suite's model stage passed all 79 tests. Required full-run summary,
verbatim (`bash scripts/test.sh`, exit 1):

```text
-- ok: client models (309 s)
== 2 failure(s) in 2103 s
   cargo test
   client tests
```

The complete original output is `suite.log.gz`; build, release guard, docs budget,
package typecheck/build, app checks/typechecks, fixture tests and full-count
models all passed. Rust and client failures are individually classified above;
all affected corrections pass. The full run was executed once, without lowering
model counts or suppressing failures. No known lane correctness failure remains;
there is no single green full-suite receipt for this concurrent-host run.

Unresolved product limits: the online terminal presentation is session-only,
and no-op/out-of-page online successes can persist until observed or scope close.
The pilot has no LOC or byte saving and does not measure a builder-score effect.
No runtime or wasm ceiling was raised. Nothing was pushed or published.

Final audit:

```text
# ./ref-check --verbose
ref-check: ok — 526 LLP docs, 10106 refs in 32516 files, 0 errors, 0 unchecked
# git diff --check
# exit 0; no output
```


## Round 1 — both blind reviews folded (2026-10-03)

Based on round 0 `80ec6b66dd`; read both `b-r0.astra.md` and `b-r0.grok.md`
in full. This section supersedes round 0's unbounded online-lifetime limitation
and its credential/generation presentation fence. All requested fixes are in
the local change; no push or publication. No full suite was run this round.

### Fixes and reproductions

| Finding | Fix and regression evidence |
| --- | --- |
| Astra High / Grok Medium retention | Only mounted matching operation/resource owners retain online arguments. Last unmount and resource changes release them. The pool is capped at the existing receipt-history limit, 256, plus 1 MiB of serialized write payloads; oldest entries are removed. Payloads are copied/frozen once, with reference reuse on reads. Previously returned references become `evicted`, while subsequent reads omit them. Eviction never calls observation and no timer was added. 1,000 unowned completed writes: **0 entries / 2 serialized bytes**. The owned 1 KiB-payload case keeps **256 / 316,674 B**, then larger payloads exercise the independent byte cap. Both original count probes fail on round 0. |
| Grok High routine resets | Presentation scope is principal/store. Read revision separately fences bearer/schema/generation resets. Success text survives `refreshSession()` and a real `/changes` generation bump; an old in-flight query cannot publish. Local presentation also uses principal/store with its own credential/incarnation read revision. The online test fails on round 0 at bearer refresh; the exact round-0 local reader fails the new delayed-read test. LLP 3000.019 §3.3.1 and Client and operations now distinguish watch reset from intent retirement. |
| Astra Medium stale toggle | `usePendingState` accepts the authorized `read` supplying `current`. A private, scope-qualified sequence attached to that read retires receipts it covers, including opposite values. Two real-online React regressions fail on round 0: true at receipt sequence 1 followed by false at read sequence 2, and equal true at read sequence 0 (which cannot observe receipt 1). Fabricated/unavailable/revalidating reads have no qualifying evidence. Local observed-write retirement is unchanged. |
| Astra Medium peer settlement | A mounted online owner captures scoped arguments it sees in the existing shared journal. Receipt transitions settle those references even when another owner dispatched. No journal format or durable terminal payload was added. Two real online clients with one session store show the same settling text; B can observe and retire its own presentation independently. Round 0 drops B's card. |
| Grok Medium ordering | Journal entries precede identification callers; already listed IDs are omitted from identification output. Queued/dispatched A plus pre-identification B reads A, B. Round 0 reads B, A. |
| Astra Low / Grok Medium test strength | React now uses real online custody/presentation with actual removal. A confirmed row is supplied, withdrawn, and cannot resurrect its intent; a predicted row against a settling success is withdrawn and must restore text. Removing the observation effect fails the first test; removing the prediction filter fails the second. Restart checks now assert both argument texts, and an empty-args mutation fails on process and wasm. |

A further real React regression changes resource ownership and adds an unrelated
pending write: unowned payloads are released, and filtering does not trigger a
render/read loop. Round 0 fails its unowned-terminal assertion. The helper's
shared snapshot applies the owner filter on incoming reads as well as cleanup.

The six new Node cases and three React correctness cases fail on round-0
implementations (the local case uses the exact old reader transpiled against
unchanged dependencies). The two test-strength cases correctly pass unmutated
round 0 and fail the precise mutations the reviewers said survived its old
harness. These are mutation-sensitive regressions, not claims that correct
round-0 behavior is defective. Evidence: `round1/baseline-node.log.gz`,
`baseline-local.log.gz`, `negative-controls-final.log.gz`, and
`negative-empty-args.log.gz`. Negative controls ran in isolated temporary source
or dist copies, removed afterward; qualified source was never mutated by them.

### Verification

All commands use the supplied PATH, Node 24.13.1, the existing shared Cargo target
`/home/ccheever/sb5-lanes/target`, and the lane's private CLI snapshot
`$PWD/target/lane-b-bin/snapback4` for client fixtures. The CLI has no relevant
runtime delta in this round; the changed client package was rebuilt locally.

| Check | Result | Evidence under `round1/` |
| --- | --- | --- |
| New regressions + existing pending-intent process/wasm tests + complete React harness | **83 passed, 0 failed, 0 skipped, each of five runs** (415 executions). All 11 new cases ran five times. | `final-repeat-1.log.gz` through `final-repeat-5.log.gz`, `final-repeats.txt` |
| Affected clients across online/process/wasm | **363 passed, 0 failed, 0 skipped** | `affected.log.gz` |
| Whole language/client guide (`cargo test -p snapback4-lang --test guide`) | **110 passed** | `guide.log.gz` |
| Package build and typecheck | pass | `build-final-2.log.gz`, `typecheck-final-2.log.gz` |
| Read declarations + all README/Client examples | **14 passed** | `types-examples-final.log.gz` |
| Docs budget and named first-screen test | **300/300 lines; 1 passed** | `docs-budget.log.gz` |
| Wasm build and budget | **2,031,329 B raw / 610,519 B gzip**, cap **610,782**, headroom **263 B** | `wasm.log.gz` |
| Actual Cal29 rewritten app typecheck | pass | `pilot-typecheck.log.gz` |
| Reference/metadata audit | **526 LLP docs, 10,106 refs; 0 errors, 0 unchecked** | `references.log.gz` |
| Whitespace check | pass | `diff-check.log.gz` |

Repeated command:

```sh
node --test --test-concurrency=3 \
  packages/snapback4/test/pending-items-round1.test.mjs \
  packages/snapback4/test/pending-items.test.mjs \
  packages/snapback4/test/react.test.mjs
```

The affected run used `node --test --test-concurrency=4` on these files:
`pending-items`, `pending-writes`, `app-online`, `app-receipts`,
`app-local-receipts`, `app-outcomes`, `app-local-outcomes`, `app-handles`,
`app-retirement`, `app-store-replacement`, `online-store-order`,
`online-store-terminal`, `online-intent-store`, `online-session`,
`refresh-behavior`, `schema-session`, `keep-observation`,
`query-publication-session`, `retention-store-withdrawal`, `write-ids`, and
`admit-before-identity` (each `.test.mjs`). The final owner-filter correction
only affected the presentation source; its whole React and process/wasm
pending-intent coverage was rerun five times after that correction.

No runtime/wasm budget was raised. Wasm engine source is unchanged; the one-byte
gzip difference from round 0's last shared-target artifact is **not** a paired
feature-size result. Source/test/wasm/private-CLI hashes are in
`round1/source-hashes.json`. The affected-scope LLP audit is in CONTEXT.md.

### B1–B3 pilot rerun

The actual local-device Cal29 specimens were rechecked byte-for-byte against
`/tmp/lane-b-cal29/src`, whose `snapback4` package link names this lane's rebuilt
package. Typecheck passes. New measurements and hashes are in
`round1/pilot-measurements.json`:

| Specimen | Before lines / bytes | Round 1 lines / bytes | Delta |
| --- | ---: | ---: | ---: |
| B1 | 1 / 42 | 1 / 152 | 0 lines, +110 B |
| B2 | 1 / 238 | 1 / 318 | 0 lines, +80 B |
| B3 | 1 / 281 | 1 / 283 | 0 lines, +2 B |
| Total selected excerpts | 3 / 561 | 3 / 753 | **0 lines, +192 B** |

Whole files remain 46 lines / 16,755 → 16,961 B (chat) and 34 lines /
6,178 → 6,176 B (social): **+204 B total**. Relative to round 0, this pilot
changes zero lines and zero bytes. There is no saving or builder-score claim.
This local-device pilot relies on existing observed-write retirement; it does
not measure online `read`-evidence plumbing. That online path has its own actual
React regressions above.

### Failure classification and remaining limits

All intentional baseline and mutation failures are retained as negative-control
evidence. Development failures were ours: the first TypeScript build needed
exact-optional-property and query-result typing corrections; the initial React
fixture tried browser writes without the required custody owner; its async
conversion missed two awaits; later assertions ran before the browser journal
notification completed; and the new handcrafted local sequence fixture initially
omitted `observed_seq`, producing a 122-second hang-guard failure. Corrected
fixtures use actual custody and explicit journal/state barriers. One temporary
baseline-loader attempt named a nonexistent package-local TypeScript path; the
ordinary workspace import fixed it. The early `baseline-react.log.gz` is not
accepted as a product reproduction. Intermediate red/green logs are retained;
only the final evidence table qualifies the result. No final ordinary test is
red, and no environmental or inherited failure is being waived.

The peer must have owned/observed the pending arguments, or be the submitting
owner; receipt-only late mounting cannot reconstruct released arguments. Online
settling is bounded, and can be evicted before a row is observed. Previously
returned application-held references are outside the SDK retention bound.
A single payload larger than 1 MiB is not retained after terminal settlement.
No hook means no terminal history; close/restart still uses saved references
and receipt lookup. Online set-state retirement needs the actual authorized
read that supplied its current value; unrelated pages or value equality are not
evidence. These limits are documented rather than hidden by timers or new
custody. Nothing was pushed or published.


## Round 2 — both round-1 reviews folded (2026-10-03)

Based on `6cd62525b405dac9f707a2c4a52550ad8181265b`. Read both complete
reviews, `~/sb5-lanes/reviews/b-r1.astra.md` and `b-r1.grok.md`, plus Astra's
original peer-order and receipt-save probes. Fixed the raw viewer disclosure
first. This section supersedes Round 1's shared pending/terminal retention pool
and terminal-before-pending merge. No push, publication or full-suite run.

### Fixes and baseline evidence

| Finding | Correction and permanent regression |
| --- | --- |
| Grok 3: raw viewer-change disclosure | Raw queue entries carry their admitting principal. A principal retirement permanently fences those entries in `pendingWrites`, presentation reads and late receipt capture. The regression starts with a real Alice session, exposes a held send, installs Bob through a query response, then checks the direct list, mounted snapshot, ordinary pending list, late receipt and return to Alice. Token-only initial identification still adopts its queue; a separate positive control enforces that. |
| Audit extension: custody viewer round trip | Direct `onlineCustody` had a second path: Alice → Bob → Alice could reactivate its original journal presentation. The custody lifetime now pauses on the first viewer change. A separate regression fails on the reviewed commit. The account's durable journal is unchanged; a new authenticated lifetime retains existing recovery rules. |
| Grok 1: pending rows consumed the terminal cap | Pending journal payloads are borrowed outside the terminal pool. Only a new successful receipt copies/freezes arguments and can evict an older settlement. Repeated reads and settlement retries reuse the same terminal reference. One success plus 256 held sends, and one success plus twelve held 100 KiB sends, both preserve that exact successful card. |
| Astra 1 / Grok 2: admission order | Each id receives one internal admission ordinal on first custody sight. A settlement callback sees the journal's order before promoting its own entry; the combined pending/settling output sorts by that order before `pendingState`. Two clients share a journal: A's `set(false)` is held, B's `set(true)` succeeds; selection is true and order is A, B. A's later receipt also leaves order and selection unchanged. |
| Astra 2: observation resurrection after receipt-save failure | Payload-free retirement markers suppress both journal recapture and settlement retries while custody remains outstanding. They survive unmount/remount and release after durable custody retirement or scope retirement. The original failed-save probe is extended through repeated reads, same-id mutation/receipt retries, remount and eventual storage repair; the observed card never returns. |
| Astra 3: saved read invalidation untested | The actual React harness saves an authorized covering read at sequence 2, rotates the bearer through `refreshSession()`, and then supplies that saved read to `usePendingState`. The success at sequence 1 remains settling despite unchanged principal/store scope. A fresh replacement read retires it. Removing only `evidence.current()` now fails this assertion. |

`round2/round1-baseline.mjs` loads the exact three reviewed implementation files
from git without modifying the working tree; Node uses transpiled originals and
Vite uses the original TypeScript. With the final seven Node cases, **six fail
on 6cd62525b4** at their intended assertions; initial token-only identification
passes as the preservation control (`baseline-exact-final.log.gz`). Baseline
and intermediate reproductions are retained, including the disclosure-first run.

The read-evidence finding was a missing assertion, not missing product code:
unmutated round 1 already contains `evidence.current()`. The new React case
passes against that baseline and rejects the precise reviewer mutation on both
round 1 and final source. The two mutation logs each fail only the new case
and its parent suite, with `invalidated covering read must not retire success`.
The preload files are retained for reproduction. They change loaded temporary
source only; no qualified source file was mutated.

### Bounds and presentation audit

The cap remains **256 terminal references / 1 MiB serialized terminal write
payloads**. Pending custody remains complete and follows its existing journal
bounds; this change does not impose a new 1 MiB cap on pending arguments.
The backlog probes read 34,522 B (256 small pending writes) and 1,230,530 B
(twelve 100 KiB writes), including the same 217 B terminal card in each.
Assertions bound each full read to pending payload bytes plus bounded terminal
and per-item metadata, with no duplicate ids or terminal recopy. The earlier
1,000-completion count/byte/ownership regressions remain green five times.
Pending payload references release when custody disappears or matching owners
unmount. Admission metadata lasts only with custody or retained terminal entries;
observation markers carry no arguments and retire with custody/scope.

Audited every built-in presentation source: raw transport, online custody,
local/device, mock, facade guards and the shared React source. Raw ordinary
pending reads and late receipt capture use the same principal fence. Custody
permanently retires on a viewer change. Local/device sources read owner-scoped
custody and check scope/revision across each await. Facades check authority
before reading and recheck afterward. The mock has one configured viewer and
closes at sign-out. React snapshots synchronously withdraw on scope loss and
reject superseded async results. Existing account, store replacement/restoration,
principal-changing refresh and createApp fences are covered by the affected
client run. LLP 3000.019 §3.3.1 and CLIENT-AND-OPERATIONS describe the corrected
bounds, order and retirement. No Client contract, journal format, server/device
meter, delivery accounting, media authority, replay or wasm engine change.

### Verification

All commands use the requested PATH and
`CARGO_TARGET_DIR=/home/ccheever/sb5-lanes/target CARGO_INCREMENTAL=0`, with
Node 24.13.1. Process fixtures use the retained lane-private
`SNAPBACK4_BIN=$PWD/target/lane-b-bin/snapback4`. The final locally rebuilt
package includes the wasm artifact measured below. Native guide commands add
`CARGO_BUILD_TARGET=x86_64-unknown-linux-gnu CARGO_BUILD_JOBS=6`; they wait for
other users of the shared Cargo build lock rather than modifying their builds.

| Check | Result | Evidence under `round2/` |
| --- | --- | --- |
| Every new regression, all round-0/round-1 pending-intent process/wasm regressions, whole React harness | **91 passed, zero failures/skips, in each of five runs** (455 executions) | `repeat-1.log.gz` through `repeat-5.log.gz`, `repeats.txt` |
| Affected online/process/wasm client tests | **363 passed, zero failures/skips** | `affected-final.log.gz` |
| Package build and typecheck | pass | `build-final.log.gz`, `typecheck.log.gz` |
| Read declarations and README/client examples | **14 passed** | `types-examples.log.gz` |
| Package-without-dist and generated ephemeral type tests | **2 passed** | `remaining-types.log.gz` |
| Delivery-await boundary and classification | **1 passed**; same await count and delivery recipes | `delivery-boundary-final.log.gz` |
| Whole guide | **110 passed** | `guide.log.gz` |
| Docs budget / named first-screen guide check | **300/300 lines; 1 passed** | `docs-budget-final.log.gz` |
| Wasm build and budget | **2,030,224 B raw / 610,085 B gzip**, unchanged **610,782 B** cap, **697 B headroom** | `wasm.log.gz` |
| Actual Cal29 pilot typecheck and measurements | pass; no specimen changes | `pilot-typecheck.log.gz`, `pilot-measurements.json` |
| Reference/metadata audit and whitespace | **526 LLPs, 10,109 refs; zero errors/unchecked; whitespace clean** | `references-final.log.gz`, `diff-check.log.gz` |

Repeated command from `snapback4/`:

```sh
node --test --test-concurrency=3 \
  packages/snapback4/test/pending-items-round2.test.mjs \
  packages/snapback4/test/pending-items-round1.test.mjs \
  packages/snapback4/test/pending-items.test.mjs \
  packages/snapback4/test/react.test.mjs
```

The affected command is Round 1's same 21-file list and concurrency 4. The guide
command is `cargo test -p snapback4-lang --test guide`; the wasm command is
`bash scripts/build-wasm.sh`. This is affected qualification, with no claim of
a new complete-suite receipt. Shared-target wasm changes relative to Round 1
are not a paired feature-size attribution. `source-hashes.json` records product,
test, type, private CLI and generated wasm artifacts.

### Pilot rerun

Reran `bun run typecheck` in the actual `/tmp/lane-b-cal29` app with its package
link pointing to this lane's rebuilt client. Verified both app files byte-for-byte
against the retained rewritten specimens and recomputed excerpt/whole-file
measurements and hashes. B1/B2/B3 remain respectively 42 → 152, 238 → 318 and
281 → 283 B, each one physical line. Total selected excerpts remain **3 lines,
561 → 753 B (+192 B)**; whole files remain **+204 B, zero line savings**.
There is no builder-score claim. This is the local-device pilot; online
read-evidence behavior is qualified by the actual React cases above.

### Failure classification

Intentional controls: baseline Node failures, the audit's real-principal
counterexample, and both disabled-currentness failures are expected evidence.
The first custody audit fixture used persona `dev:alice` but returned `alice`,
so it did not exercise a true round trip. Corrected it to a real Alice session;
that version fails the reviewed code and passes the fix.

Development failures were ours: the first presentation refactor removed the
`items()` scope-check method still called by routine resets (one TypeScript
error and one focused failure); restoring it fixed both. The first affected
run passed 347 and failed 16 because minimal receipt/retirement test transports
omitted the Client's `onViewer` method newly subscribed by custody. Updated
those fixtures with their inert viewer subscription; product checks are not
weakened. The delivery boundary seal changed because its existing `await
change(...)` contains the revised synchronous settlement callback; recorded the
classification and refreshed that one digest, without a new await or recipe.
One docs-budget command used a nonexistent filename; the correct existing
`scripts/docs-budget.mjs` invocation is retained separately. Earlier logs remain
available, and only the final evidence table qualifies the result. No final
ordinary test failure is waived as inherited or environmental.
