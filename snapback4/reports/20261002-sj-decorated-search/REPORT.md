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

## Round 1 — expiry, exact ordering and main integration

Read both complete round-0 reviews: Astra READY/P3 and Grok READY WITH
CHANGES/Medium+Low. Merged `origin/main` at `e15de2e49a` with the real merge
commit `878da80018` (parents `90c6b168b6` and `e15de2e49a`). The only textual
conflict was the JOURNAL tail; both entries survive. The automatic core,
runner, compiler, SDK descriptor and boundary-manifest merges retain SJ's
projection and BG's count/maintenance semantics. CT, FDL and FIM remain intact.
No push or publication.

### Corrections

Decoration expiry is now `decorationExpiry`, separate from the bare page's
`nextExpiry`. The decoration child contributes its value wakeup and read
dependencies, never its deadline or coverage to the source page. Local,
composed and online watches schedule a value refresh: they keep the existing
rows, continuation, completeness and freshness while the ordinary interpreter
re-evaluates the fields to null. Both device/server wakeups are consumed once;
a later source deadline still withdraws normally. One-shot publication rejects
an in-flight expired decoration attempt through its existing bounded retry,
without publishing loading or an empty page. Each attempt retains one original
server query, the source merge fence and its own shared allowance. The LLP
§3.3.1 and guide state the distinction.

Internal source-order keys outside JavaScript's exact-number range travel as
canonical decimal strings. Server selection keeps i64 comparison; the SDK uses
BigInt and emits canonical numeric i64 cursor tokens without Number conversion.
Bare server pages supply separate keys only when required; retained candidate
rows carry exact keys in their existing body, and the device restores their typed
order before projection. Serialization and comparison costs use the existing
meters. This does **not** expand the public numeric domain: ordinary writes
already reject values outside signed 53-bit range. The Rust regression therefore
uses a storage-level i64 fixture. Eight SDK cases cover both directions, adjacent
keys around positive/negative 2^53 and the signed-i64 extrema, opposing ID ties,
selected current decorations and exact continuation tokens.

Astra's P3 is implemented. Ordinary devices neither construct nor meter nor
serialize unused `searchRows`. Server replies retain those source keys for the
coordinator. Retained candidate queries already return bare rows and keep that
path. The isolated merged-tree cleanup saves **400 B gzip**.

### Measurements

Locked `build-wasm.sh` builds, Rust 1.97.0 / wasm-bindgen 0.2.127 / workspace
Binaryen 132.0.0, on Linux:

| Tree | Raw Wasm B | Gzip B |
| --- | ---: | ---: |
| Rebuilt shared base `96ae8da9a5` | 2,032,879 | 610,147 |
| Rebuilt incoming main `e15de2e49a` | 2,030,224 | 610,085 |
| SJ round 0 merged with that main | 2,047,686 | 616,742 |
| Same merged tree with only P3 | 2,046,217 | 616,342 |
| Final round 1 | 2,048,753 | 617,410 |

The base/main controls use the same separate worktree and toolchain. Attribution
is successive whole-artifact deltas: incoming main/BG **−2,655 raw / −62 gzip**;
SJ on incoming main **+18,529 raw / +7,325 gzip**; total versus rebuilt base
**+15,874 raw / +7,263 gzip**. Within the merged SJ correction, P3 saves 400 gzip
and the correctness changes add 1,068 gzip. These are conditional build deltas,
not additive function-size estimates. Historical round-0 receipts are not
substituted for rebuilt controls.

The cap is **618,040 B**: measured Linux **617,410** + estimated macOS **130** +
requested headroom **500**. Estimated macOS is **617,540 B**; no macOS measurement
is claimed. This raises round 0's 617,581 B cap by 459 B to preserve the reserve.
The budget file, final commit and JOURNAL record that reason. Runtime ceilings
are unchanged. `round1-wasm.json` retains the small measurement receipt.

The scale assertions remain **2,040 → 2,061 examined rows** for W13's 30,030
messages/1,000 rooms: 20 distinct rooms and one sender. Source-key validation
adds bounded steps, not point reads. Selection, physical authorization and
explicit exhaustion behavior remain covered by the same integration target.

### Verification

- `LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT cargo test -p snapback4-core -p snapback4-lang -p snapback4-device -p snapback4-sim -p snapback4 --lib --bins --tests --no-fail-fast`: **4,713 passed, 0 failed, 34 ignored**, 286 logged summaries, exit 0. This includes the CLI binary units and all five crates' integration targets; the guide target is **110/110**.
- Final `cargo test -p snapback4-sim --test decorated_search -- --nocapture`: **11/11**, including expiry, exact one-slot selection and both scale corpora. W13 uses 20,216 → 32,957 steps with unchanged examined/index/probe/heap/output counts versus round 0.
- Focused JS selection: 539 passed and one stale hash check, corrected with its targeted 1/1 rerun as detailed below. Final expiry/watch/scheduler regressions: **6/6**; final generic deadline/recovery/retention selection: **64/64**. Both expanded generated oracles and the eight exact-order protocol cases passed.
- Client typecheck/build, docs budget and reference audit pass. The measured source and packaged Wasm SHA-256 are identical. All product source remained frozen during the full suite. Final diff review restored the pre-existing W13 fixture's normal seed path (only the unsafe-i64 regression needs direct storage seeding); its already-compiled full-suite binary used the earlier equivalent fixture, and a final affected-target run verifies the restored test. Final source/test hashes cover 23 changed files.

The single final `LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT bash scripts/test.sh`
run exits 0 and reports exactly **`== 0 failure(s) in 1394 s`**. The Rust runner
covers 286 test binaries / 999 executions plus doctests; clients report
**5,816 passed, 0 failed, 10 skipped**, and models **79/79**. All build, docs,
release, typecheck, app and fixture stages pass. The ten client skips are explicit
macOS, legacy-binary or managed-identity fixture gates. The final restored-fixture
rerun passes **11/11** with unchanged W13 query meters. `round1-verification.json`
and `round1-source-sha256.txt` retain compact receipts; raw logs remain outside git.

The oracle still checks 985 pages per host (**1,970 total**, process and Wasm),
with 686 online/299 offline and eight short pages per host. Decoration tables
now declare expiry; every generated comparison also checks raw `nextExpiry`.
Four explicit process/Wasm deadline witnesses require both current and retained
rows to survive with identical freshness, completeness, cut and normalized cursor.
The two watch cases hold the refresh in flight and require the old rows to remain
published throughout. All four require expired
fields—including nested owner reads—to become null and `nextExpiry` to stay
null. One-shot boundary witnesses require exactly two publication attempts.
Two independent scheduler cases consume each authority's value wakeup without
withdrawing rows, preserve the other authority's later value wakeup, then require
the later bare deadline to withdraw. Rust checks
the exact before/at/after deadline and unchanged bare metadata.

### Failure classification

All development failures below are **ours**, and corrected before the final
suite; none is waived as baseline or environmental:

- Two Cargo commands were accidentally launched from the repository root and
  stopped at the uninitialized Snapback 1 Ibex dependency. No root runtime was
  built; subsequent commands use the Snapback 4 workspace.
- Initial edits failed TypeScript's exact optional-property checks and Rust's
  private-field/import/type-inference checks; corrected declarations, accessor,
  qualification and explicit fixture types compile.
- Initial integer fixtures tried to seed values the existing public signed-53
  domain refuses: one Rust case and four process/Wasm cases returned NOT_FOUND.
  Replaced invalid public fixtures with a storage-level Rust case and eight SDK
  protocol regressions; the public limit remains unchanged.
- The first two watched-expiry tests timed out because their frozen wall clock
  jumped without changing its offset or delivering the hour-away timer. The
  corrected witness exercises the synchronous snapshot deadline check before
  holding the real refresh; both hosts pass. The two one-shot cases passed in
  that initial run too.
- One docs command named a nonexistent script; the actual `docs-budget.mjs`
  command passes.
- Focused JS initially passed 539/540: the only failure was the stale `client.ts`
  await-boundary hash after adding value-refresh scheduling inside its existing
  awaited observation callback. All 58 awaits and every classified site ID,
  recipe, required/optional classification and absorption rule are unchanged.
  Updated that one hash; the classification check passes. All fault cases had
  already passed and the final suite repeats them.

Final full-suite failures: **ours 0, baseline 0, environmental 0**. No rerun
of `scripts/test.sh`, failure waiver, or runtime ceiling increase.
