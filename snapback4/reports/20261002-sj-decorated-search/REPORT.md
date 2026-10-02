# SJ round 0 — decorated ordinary search

Date: 2026-10-02. Branch: `sb4-intent/sj-decorated-search`.
Starting commit: `96ae8da9a59a0d157f2bc361d0c9bfa101c98d15`.
Local work only; nothing pushed or published.

## Design

LLP 3000.028 §3.3.1 defines the lifted form before its implementation:

```quarry
return messages matching q last 20 by .at after c {
  *, chatTitle: conversations[.conversation].title,
  senderName: profiles[principal = .sender].name
}
```

The compiler recognizes the single row-preserving collector over an ordinary
search. It proves that the projection uses source fields, literals, and total
unique-key point reads, including nested key reads. It records the execution
fact and preserves the original bare page. The same proof drives the runtime,
SDK descriptor, generated row identity and `check --cost` explanation.
Pinned-chat pages use their original horizon/retained proof. Explicit guards,
held declarations and explicit membership predicates keep their authored lane.

The bare stage decides source IDs, ordering, completeness, cut and continuation.
The decoration stage has a separate coverage frame and shares the actual logical
meter and physical authorization allowance. Every distinct `(table,index,key)`
is cached for this page/authority only, including null. Point reads use the
ordinary row/field authorization, expiry and disclosure path. Missing or
unreadable decoration rows yield null without removing the hit. Device
retention observed while decorating cannot change source freshness.

For the online merge, the existing bounded candidate-ID request also carries
source ordering values and the retained continuation bit. The server validates
the candidates through the ordinary overlap read and decorates only current
rows selected by that combined prefix. It returns source keys separately from
presentation values, allowing projections that omit or rename `id`/order fields.
Unconsumed server slots need no presentation value. These ordering hints confer
no authority. The SDK decorates only emitted retained rows in its existing final
`search_state` call, then validates delivery, membership epoch and credentials.
There is still one server call and no extra device await, refill or saved session.
A server missing the source-key protocol refuses explicitly.

The orientation constraints were the Snapback 4 fence, LLP 3000/2000.000,
3000.028 §3.3, 3000.024, and the search/client guide cards: preserve the compact
membership opening, bounded consumed-prefix merge, current-ID suppression,
retained device custody, authorization door and shared meters. `llp-orient` was
read from the initialized sibling vendor checkout because this worktree's
project skill symlink was uninitialized. No root Snapback 1 runtime was built.

## Evidence

Permanent Rust `decorated_search` integration tests cover page/point-read
comparison, key sharing, pinned search, projections omitting source keys,
identity-preserving generated handles, selection before current decoration,
explicit resource refusal, wide word expansion, and device word-cut metadata.
The CLI unit tests cover lifted cost explanations, per-hit non-key/aggregate
refusals and decoration predicates; ordering by a decoration is rejected by the
existing language diagnostics.

The generated JS oracle runs eight seeds on **each** real process and Wasm
host. Each seed has 24 state transitions with randomized initial membership,
message scopes, order/limit, departures/rejoins, moves, same-ID delete/reinsert,
presentation edits and online/offline observations. It checks global and pinned
pages against the bare query on the same state and each decoration against an
independent ordinary point read on the selected authority host. Nested room →
owner-profile reads share the same key cache.

Each host passed **985** page comparisons: **686 online / 299 offline**,
including **8 short pages with continuation**, **996 current null-profile
observations** and **1,802 retained null-profile observations**. This includes
unreadable current cards, shared keys, a deleted room whose departed device still
lawfully holds its image, and a deleted publicly delivered profile that becomes
null while messages remain retained. Another projection omits ID/order fields.
The oracle checks IDs/order, `complete`, `cut`, freshness/`since`, source
continuation positions and one server call per online global form. Opaque SDK
cursors bind operation names: comparison removes only that intentionally
different binding, not source positions, audience or state fences.

The real Chromium social-search witness checks the title and sender name,
current server-only hits outside the local horizon, departed hits, leave during
search, accumulated pages and no duplicates. Its instrumentation records every
query path and requires only `/q/search`, excluding separate detail reads.
`search` and `searchChat` now return the decorations directly; `Search.tsx`
renders nullable labels. The guide's search, client, code and why surfaces teach
this form while retaining bare search as valid.

## Cost

All rows below use a 20-hit page and the same server state. Counts include
ordinary authorization work. No logical or physical runtime ceiling was raised.

| Corpus | Bare examined | Decorated examined | Extra distinct keys |
|---|---:|---:|---:|
| 60 messages, 3 rooms | 46 | 50 | 3 rooms + 1 sender |
| Pinned room, 20 hits | 20 | 22 | 1 room + 1 sender |
| 1,000 scopes, 60 messages | 1,080 | 1,101 | 20 rooms + 1 sender |
| Established W13 scale seed: 30,030 messages, 1,000 readable rooms + 1 hidden | 2,040 | 2,061 | 20 rooms + 1 sender |

For W13, index entries stay **2,040**; rule probes **1,040 → 1,060**;
steps **20,196 → 32,917**; heap **2,938,717 → 3,143,581 B**;
output **60,531 → 62,682 B**. These are read-count bounds, not a claim that
projection/copying/serialization is free. The selected prefix containing only
retained hits adds **zero current decoration reads**, even when the server
fetched a nonempty current candidate page. `cost.txt` preserves the complete
small metering summaries and the CLI's named lifted plan/distinct-key reads.

## Wasm

Locked Linux build: **2,050,348 B raw / 616,951 B gzip**. The inherited cap was
610,782 B. Raise it to **617,581 B**, with the reason in the budget and commit:
the new planner proof, projection interpreter/cache and device merge-fence
projection need 6,169 B beyond the old cap. Requested macOS estimate:
**617,081 B gzip** (+130 B), leaving **500 B** cross-host headroom. This is an
estimate, not a measured macOS build. `wasm.json` records the inputs and numbers.

## Verification and limits

Completed focused validation on the final artifact:

- `cargo test -p snapback4 --bins --tests --no-fail-fast`: **848 passed**, 10 ignored, 41 target summaries; includes the binary unit tests and CLI integration targets.
- Final core/device/lang `--lib`: **260 passed**, 1 ignored (plus the core subprocess control); guide integration target: **110 passed**.
- Final `cargo test -p snapback4-sim --test decorated_search -- --nocapture`: **9 passed**, including both scale corpora and device word cuts.
- Final JS selection: **462 passed**, no failures/skips. Files: `decorated-search`, `ordinary-search`, `ordinary-search-ledger`, `retention-pages`, `social-browser`, `social-starter`, and `delivery-fault-matrix`.
- `check --cost`, package typecheck/build, docs budget and `./ref-check --verbose` pass. Reference audit: 525 LLP documents, 10,089 references, zero errors/unchecked.

The two changed search await expressions keep their original matrix recipes,
required/optional classifications and absorption flags; the census count is
unchanged. The tight-budget test now injects the remaining allowance at the
candidate-scan receipt, before decoding/merging, and retains fixed exact-fit
and one-step-short controls. No assertion was weakened to accommodate a failure.
Numeric CLI allowances conservatively include up to one point per emitted row
per syntactic lookup, alongside the distinct-key execution explanation.
Cache key escaping, vector growth and B-tree splits are prepaid.

The explicit affected-crate sweep completed successfully:
`cargo test -p snapback4-core -p snapback4-lang -p snapback4-device -p snapback4-sim -p snapback4 --lib --bins --tests` logged **4,662 passes, 34 ignored, zero failures**, with 286 test summaries. This includes every `guide::card(` consumer in the touched crates, the CLI binary units and integration targets. The frozen final script independently repeats the complete workspace inventory (286 binaries, 999 executions) and doctests; its Rust phase passed in 452 seconds.
Frozen final qualification: **`== 0 failure(s) in 1390 s`**.
The complete `scripts/test.sh` invocation passed every stage: all workspace Rust
executions/doctests; docs, release guard and package/app checks; **5,800 client
passes with 10 conditional skips**; and **79 model passes**. No final failure
remains to classify. Source hashes matched before and after the run, and the
source/package Wasm copies are identical. `verification.txt` retains the exact
stage summaries. The earlier overlapping attempt remains recorded below; it
is not substituted for or hidden by this final green run.

Unsupported non-key subqueries, cross-hit aggregates, decoration predicates,
computed decorations and non-ordinary bodies are not silently promoted. They
retain the evaluator/diagnostics appropriate to their authored shape. This
checkout's explicit nested key-lookup spelling is tested; it adds no new parser
syntax. Deduplication is per table/index/key and authority, not across distinct
indexes that happen to find the same physical row. Current server and retained
device images may intentionally differ.

The page retains its source metadata on successful decoration. If decoration
cannot fit the remaining allowance it explicitly refuses; it does not return a
trimmed page or reinterpret exhaustion as an absent row. Empty-needle browsing,
source horizon limits, word cuts and unstable authored order keys retain their
existing semantics. Source-row projection copying and wire source keys have
measured heap/step/output costs in addition to distinct point reads.


### Failure accounting

The preliminary full invocation reported exactly **`== 1 failure(s) in 1510 s`**
(the `client tests` stage). Its client runner recorded 5,795 passes, 5 failures
and 10 conditional skips; four failing leaf cases plus their model parent
account for the five failures. All four leaf errors were `ENOENT` opening the
Wasm artifact while **this lane rebuilt it during the run**. Classification:
**ours — verification orchestration**, not baseline or environmental. Cases:

- `CCP zero-wait native admit deny fails before dispatch` (its fixture also loads Wasm).
- `wasm: child-replace keep=undefined expire=false ...` in `live-propagation`.
- Wasm one-shot model sessions 5 and 6, plus the failed parent model summary.

The three complete files reran against the stable final artifact: **119 passed,
zero failed/skipped**. The isolated four cases also passed (1 + 14 including
model subtests). The preliminary Rust phase, all non-client stages and all
79 client models passed. This attempt is not claimed as final qualification;
the final full invocation starts after it exits, with source hashes fixed in
`source-sha256.txt` and no concurrent artifact rebuild.

Development failures were ours and corrected: the device's cleared scope map
on the second read, generator writes against absent memberships/deleted profiles,
a missing optional schema access in the minimal SDK fixture, old bare-label
browser selectors, the moved ledger-injection checkpoint, an incorrect uniform
server word-cut expectation, and initial numeric allowance assertions that
reversed examined-row and probe increments. The final regression tests cover
those respective fixes; temporary scaffolding compile errors were also ours.

One intermediate concurrent CLI unit run additionally hit
`smoke_barrier_advances_only_the_commit_clock` with `E_WITNESS_BACKEND` while
reacquiring the fixture store. Classification: **environmental/transient store
ownership conflict in an unchanged test**; the complete CLI rerun passed all
848 tests, including it. No baseline product failure was identified or waived.
