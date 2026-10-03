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
