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

## Round 2 — value deadlines in every client path (2026-10-02)

Read both complete round-1 reviews: Astra READY WITH CHANGES/P2 and Grok
READY WITH CHANGES/Medium. This round starts at `5929c5d164`, on merge
`878da80018`. No further merge, push or publication.

### Rule and implementation

LLP 3000.028 §3.3.1 and the search guide now state the same rule for local,
composed, online-only, remembered, watched and one-shot answers. Decoration
expiry never participates in page acceptance. At publication or a value wakeup,
the page remains available and expired or uncertain decoration fields become
null synchronously, including while the next read waits. The bare page retains
its identity/order, completeness, cut, continuation and freshness. Source-row
expiry, sequence/authority fences, and actual revocation keep their existing
withdrawal behavior.

The chosen policy is conservative: null all top-level output fields containing
point reads, across the page, when either decoration authority's deadline is
due or unknown. Source fields and point-independent output fields survive.
A nested lookup makes its containing output field a decoration. The existing
page-wide deadline cannot identify individual affected rows or fields. Adding
per-field deadlines would enlarge both the engine protocol and retained data;
this round adds none. The online reply carries one static field-name list;
the local client derives the same list from its compiled projection. Explicit
`decorationExpiry: null` proves no upcoming value expiry; an absent deadline
on a decorated answer is unknown and masks values without rejecting the page.

Value retries use the existing expiry scheduler, independently of row expiry,
with backoff beginning at 25 ms and capped at one second, with no attempt
limit. An uncertain reply is accepted with nulled decorations, not routed to
`ReadObservation.fetch`'s bounded rejection loop. A server answer that proves
no upcoming decoration expiry ends retries even while the client's estimate
remains ahead. Offline recovery keeps the remembered page and its confirmation
age; it does not repeatedly reject the same expired cache entry. Masked copies
preserve answer identity, revocation episodes and facade ownership. An older
approved answer also retains its own value timer while raw replacements await
approval.

### Witnesses and byte accounting

- Astra's public, unsynced `messages` plus expiring `profiles['p'].name`:
  both process and Wasm clients cache online, disconnect, cross the deadline,
  and return the hit from the one-shot and watch with `label: null`. A stable
  literal field remains present. The watch never publishes loading/empty.
- Grok's `createClient` window: the real server stays before expiry while the
  estimate is two hours ahead. Held HTTP exposes immediate nulling; a one-shot
  returns its page. More than four paced refreshes run beyond 175 ms. A second
  case starts with a revocation episode open. An unknown deadline also returns
  the nulled page. Advancing the server proves expiry and stops the retries.
- The mixed current/retained process/Wasm witnesses now require null values
  while HTTP is still held, and exactly one one-shot server call across expiry.
  The later source deadline still withdraws, in the online client and in the
  independent device/server scheduler controls. An older approved facade page
  nulls its label while a newer raw page remains independently fresh.
- The independent seed stream now sets expiries on rooms, profiles and cards;
  the server clock advances through them. It preserves the original membership,
  write and cursor trace: **985 pages per host, 1,970 total**. Each host has
  **764 pages after the profile deadline and 355 explicit expired-label checks
  before deletion**. Both authorities' ordinary point reads remain the value
  oracle. Fixture rename/delete operations tolerate rows the expiry sweep has
  already removed.

Locked Wasm is byte-identical to round 1: **2,048,753 B raw / 617,410 B gzip**,
SHA-256 `6d436f5ce09e6c6e86dcb5f33c04fcd7e1e2809f32d9ff1c69d9dbe18ad55bd8`.
The **618,040 B** budget has **630 B** remaining; no raise. The Rust field-list
helper is server-only. No macOS measurement is claimed. `round2-wasm.json`
records the build and wire accounting: one field name adds **29 B/page**,
the four-field oracle adds **64 B/page**; when round 1 omitted a null deadline,
the new explicit null adds another **24 B/page**. These are UTF-8 JSON deltas
independent of the row count, not per-row deadlines or compressed estimates.

### Verification and failure classification

The affected JS selection initially reports **1,027 passed, 3 failed, 0 skipped**
(1,030 tests). All three failures are ours: the scheduler unnecessarily called
`estimatedServerNow` on bare-deadline test clocks that supply the two delay
methods. It now checks each value deadline through its own delay method.
The selection includes createClient, local reads, recovery, one-shot settlement,
clock/expiry/retention, and the complete delivery fault matrix. The await census
has exactly one addition: the new synchronous `read-decoration.ts` module with
zero awaits. Existing await counts, digests and fault-site classifications are
unchanged.

Affected Rust decorated-search: **11/11**. Guide: **110/110**. The established
30,030-message scale witness remains **2,040 → 2,061 examined rows**.
Typecheck/build, documentation budget and reference validation pass.

Other development failures, all corrected:

- Ours: initial TypeScript generic spread/read narrowing errors.
- Ours: the first focused run's six failures were two obsolete assertions that
  assumed null values implied a completed HTTP refresh, and four new fixtures
  using incorrect Quarry spellings. The next run's two failures omitted the
  persona on a direct schema request.
- Ours: the first expiry-seeded oracle tried to edit/delete rows already removed
  by expiry. The corrected fixture preserves the historical search trace and
  passes all seeds on both hosts.
- Ours: one Cargo invocation used the repository root and stopped at the
  uninitialized Snapback 1 Ibex dependency; no root runtime was built. One edit
  command also used a path relative to the wrong directory, and the initial
  edit script used unavailable `python` instead of `python3`. None changed
  product behavior or qualified as a successful check.
- Environment/orientation only: this lane's `llp-orient` symlink target is absent;
  used the existing skill in `lane-dx/vendor/llp/skills/llp-orient/SKILL.md`.
  Governing context: LLP 3000.028 §3.3.1, LLP 3000.007 §6.5,
  LLP 3000.019 §3.3, and LLP 3000.023 §§10–11.

The corrected clock/decorated selection passes **83/83**, and the final
focused expiry/remembered/skew/facade selection passes **9/9**. The complete
Rust battery passes: **286 binaries / 999 executions plus doctests**, zero
failures and 34 explicit ignores. The single final
`LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT bash scripts/test.sh`
run exits 0 and reports exactly **`== 0 failure(s) in 1419 s`**. Client tests:
**5,822 passed, 0 failed, 10 skipped**; client models: **79/79**. The skips
are five platform cases and five optional fixture cases, named in the receipt.
All build, budget, release, package/app and fixture stages pass. Full-suite
failure classification: **ours 0, baseline 0, environmental 0**. No suite
rerun or waiver. All 15 qualified source hashes remained unchanged throughout
the suite; the final source and packaged Wasm hashes match round 1. Full logs remain in
`/home/ccheever/sb4-intent/sj-r2-evidence/`; the verification receipt binds their
hashes and the qualified source/artifact hashes.


`round2-verification.json` records commands, counts, all ten skip reasons,
source hashes, artifact hashes, and raw/compressed log hashes. The source review
keeps the generic row-expiry and authority fences; all full-suite changes after
qualification are this report, the receipt and the append-only journal entry.
The local commit carries `Co-Authored-By: GPT-6 Astra <noreply@openai.com>`.
Nothing pushed or published.

## Round 3 — structural value deadlines and nested placeholders (2026-10-03)

Starting commit: `1202d4cb56`, branch `sb4-intent/sj-decorated-search`.
Read both complete round-2 reviews from `~/sb4-intent/reviews/sj-r2.astra.md`
and `sj-r2.grok.md` (both READY WITH CHANGES, one finding each). All work and
qualification ran locally on Linux `expose-builder-pixel`; neither the office
M1 nor M5 was used. Nothing merged, pushed or published.

### Corrections and policy

Astra's nested-type mismatch is fixed by static output paths, replacing the
round-2 top-level field list. Server replies carry `decorationPaths`; local
clients derive the same paths from the compiled projection. Masking copies
only the containers along those paths, preserving object shape and every
point-independent sibling at every depth. A complete point-read row is a
nullable leaf; an authored object containing that row is not. Selections from
constructed objects resolve to the selected expression, so an unused lookup in
another sibling cannot make a selected literal nullable. Earlier read objects
are not mutated.

The compiler's existing generated types were already correct for these forms;
no type widening is needed. Executed generated-output assertions require
`bundle: { deep: { label: string | null; stable: string }; label: string | null;
stable: string }`, with a nullable whole point-read value. The matching runtime
witnesses access both stable fields after masking and restore the nested values
when a subsequent answer proves a later deadline.

Grok's two composition returns now use `mergeValueDeadlines`: retain the earliest
device deadline and earliest server deadline independently. `null` is no
upcoming value deadline; `NaN` is unknown and dominates a merge. The shared
`ValueDeadlines` interface requires both fields as `number | null`, with neither
optional nor `undefined`, in `Result<R>`, `SearchResult` and `QueryResult<R>`.
Loading and refusal constructors explicitly provide nulls. Publication wrappers
spread a typed result rather than reconstructing partial metadata. Recovery
has no device-derived values and carries its remembered server value deadline.
Three deliberate compiler mutations, each removing `valueServer` from one of
these result types' constructors, all fail typecheck. Restoring the sources
passes typecheck.

LLP 3000.028 §3.3.1 and `guide search_all` now say plainly that a masked decoration
is a placeholder, not proof of absence; page freshness does not prove every
decoration is current; a refresh restores values once a later deadline is
proven. The policy remains conservative across all hits and dependent leaves
under each page-wide deadline. There are no per-row/per-field clocks, new
requests, extra authority, or changes to source-page withdrawal/retry rules.

### Exhaustive internal result return-site audit

Line numbers below identify this round's final sources. This lists every
query-result/candidate return and its base constructor, including early exits;
Boolean, cursor, ledger, transport and comparison helpers return other types.
The common interface is in `packages/snapback4/src/read-decoration.ts`.

| File / sites | How both value deadlines are carried |
|---|---|
| `local-query.ts:99` loading base; `109–113` fallback/localCandidate | Base explicitly sets both null; fallback chooses a typed latest result or that base, and localCandidate spreads it. |
| `local-query.ts:118,120–122` checkpoint interruptions | Denial spreads loading; other interruptions hold loading. `Interrupted<R>` accepts only `Result<R>`. |
| `local-query.ts:138` ephemeral recovery | Spreads loading, both null. |
| `local-query.ts:139,141` recovery without usable memory / blocked memory | Forwards localCandidate unchanged. |
| `local-query.ts:153` remembered recovery | Explicit device null; remembered server deadline normalized from `decorationExpiry`, including unknown; absent memory gives server null. |
| `local-query.ts:169` device preflight refusal | Returns latest containing the typed loading base. |
| `local-query.ts:175–176` ordinary device result | Explicit device deadline from the evaluated outcome (unknown if decorated and missing), server null; no data gives both null. |
| `local-query.ts:180,193` server blocked / transport failure | Forwards the typed recovery candidate, adding only the transport flag. |
| `local-query.ts:205` accepted server candidate | Explicit device null, normalized server deadline; no data gives both null. |
| `local-query.ts:210–211` watch-fetch wrapper / server return | Spreads the candidate for observation and forwards its complete result. |
| `local-query.ts:217,225,236,237,239,241,253` local routing exits | Forwards localCandidate, preserving its complete typed result. |
| `local-query.ts:227` blocked routing | Forwards recovery. |
| `local-query.ts:230,233,240,252` remote routing exits | Forwards remote, including both deadlines. |
| `local-query.ts:245–249` retained-row merge | Spreads `mergeValueDeadlines(second.result, remote.result)`, earliest per authority. |
| `local-query.ts:257` object-component merge | The same merge constructor, independent of which components are kept. |
| `local-query.ts:263` cold route | Typed loading candidate if held; otherwise server result. |
| `local-query.ts:264,272` ephemeral / unavailable device routes | Forward server result. |
| `local-query.ts:279` ordinary-search route | Spreads required `SearchResult` fields, changing only read typing and tables. |
| `local-query.ts:282` normal route | Forwards routeLocal's typed candidate. |
| `local-query.ts:310,348–349,351,352` publication withdrawal / stale ephemeral / credentials | Every branch uses or spreads loading, with explicit null value deadlines; the remembered-source withdrawal preserves only its local source wakeup. |
| `local-query.ts:367,369` non-local / local publication | Both spread the complete result; freshness bookkeeping cannot omit either deadline. |
| `local-query.ts:377` outer success | Spreads published result; installs paths using its required deadlines without `?? null` defaults. |
| `local-query.ts:379,381` interruption returns | Spread the checkpoint's typed `Interrupted<R>.result`. Other exceptions throw. |
| `local-search.ts:167` loading base | Required `SearchResult` with both null. |
| `local-search.ts:170,171,174,189,192,205,206,209` state, ledger, cursor and local-source early exits | Return loading or spread it for a refusal. |
| `local-search.ts:222,223,228,229,232,235,240` HTTP, authority, remote-source and source-key early exits | Return/spread loading, retaining both null fields. |
| `local-search.ts:244,246,252,258,262` audience/scope early exits | Return loading. |
| `local-search.ts:265,268` source expiry / unsafe remote prefix | Spread loading; retry flag or empty cut page cannot omit the null value fields. |
| `local-search.ts:281,282,289` invalid-overlap helper and both callers | Helper spreads loading; both callers return its complete result. |
| `local-search.ts:349,351,353,355` final device/state/decoration checks | Return/spread loading. |
| `local-search.ts:368–373` successful merged page | Explicit normalized device deadline from final retained decoration evaluation, and server deadline from the remote page; no retained decorations requires no device value deadline. |
| `local-search.ts:375` metering refusal | Spreads loading. Other exceptions throw. |
| `client.ts:594,595,597,598,599,602` closed/refused/auth/offline/server-denied results | Every object explicitly constructs both null fields under `QueryResult<R>`. |
| `client.ts:606` loading / absent data | Explicitly constructs both null fields. |
| `client.ts:603,610–612` online ready result | A typed pair sets device null and normalizes server expiry; that pair supplies both synchronous masking and the returned result. |
| `client.ts:589` runQuery wrapper | Spreads the complete typed runQueryOnce result. One-shots and watches consume it; watch scheduling uses `valueServer`. |
| `local.ts:896,899,900,902,907,909,914` unchanged outer evaluation wrapper | Every success, denial, stale-ephemeral, search-race and identity branch spreads the inferred evaluateLocal result; the outer return forwards that promise. |

### Regression evidence

- Nested and doubly nested object projections run on **process, Wasm, and the
  online client**. They hold a refresh in flight while the old page remains
  `fresh: true`, retain both stable siblings, mask nullable leaves and a whole
  point row, preserve selected literals, and restore values under a later
  proven deadline. Process/Wasm remembered-offline witnesses also check the
  nested object shape.
- **16 live local-client browse cases**: process/Wasm × watch/one-shot × empty,
  whitespace, punctuation-only and emoji-only needles. These use the existing
  read-through device protocol to create retained history during a partial
  rejoin before an unacquired parent arrives. A new server row plus the retained
  row reaches `routeLocal`'s actual row merge: the raw local reply must name
  `unknown: true`, retained provenance and a value deadline; the HTTP request
  must request provenance. Crossing expiry keeps both rows and page facts,
  masks nested leaves while watch HTTP is held, triggers refresh, and returns
  one-shots in one call. This fixture pins the composed return, rather than
  assuming every unscoped browse happens to reach it.
- **32 routing cases** exercise both row and object-component merges with null,
  past, future and unknown deadlines on each authority. A separate combinatorial
  merge check verifies earliest-per-authority and unknown dominance.
- Deliberately collapsing paths back to the top-level object fails all three
  nested tests. Deliberately discarding composed deadlines fails all eight
  one-shot browse cases, exposing `Label` where null is required. Sources and
  built modules are restored before qualification.
- The oracle retains the original eight word-search seeds and adds four seeds
  for empty, whitespace, punctuation and emoji browse. Every seed still crosses
  seeded profile/room/card deadlines and compares decoration values with ordinary
  authorized point reads on the actual authority host. Each host checks
  **1,475 pages**, including **490 browse pages**, **379 browse pages after profile
  expiry**, **1,143 total pages after profile expiry**, and **526 explicit expired
  labels before deletion**. Totals across both hosts: **2,950 pages / 758 browse
  expiry pages / 1,052 explicit expired-label checks**.

### Qualification

The final affected client selection passes **955/955**, with zero skips or
failures, in 622.327 seconds. This includes the 12-seed decorated oracle on
both hosts, all 600 seeds of the existing ordinary-search oracle, both search
ledgers, deadline/clock/recovery/approval/publication paths, read-through
provenance and the delivery-fault matrix. Guide **110/110**, existing Rust
decorated-search **11/11**, package typecheck and the await-boundary check pass.

Locked Wasm is **2,048,753 B raw / 617,410 B gzip**, byte-identical to round 2,
SHA-256 `6d436f5ce09e6c6e86dcb5f33c04fcd7e1e2809f32d9ff1c69d9dbe18ad55bd8`.
The unchanged **618,040 B** budget has **630 B** remaining. No Mac measurement
or budget increase. Static leaf paths add **30 B/page** for one top-level leaf,
**71 B/page** for the four-field oracle and **112 B/page** for the five-path
nested/selected-object fixture, including the property and comma. They add no
per-hit deadline bytes. `round3-wasm.json` records the command and accounting.

The single full suite, run with
`LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT bash scripts/test.sh`
from `snapback4/`, exits **0** with exactly:

```text
== 0 failure(s) in 1509 s
```

It passes **4,729 Rust tests** (34 ignored), **5,882 client tests** (10 explicit
platform/legacy/identity-fixture skips), and **79/79 client models**. Rust
inventory: **286 binaries / 999 executions plus doctests**. Full-suite failures:
**ours 0, baseline 0, environmental 0**. No full-suite rerun, waived failure,
or publication claim. The affected selection and full suite both reproduce the
same decorated-oracle counts. All **11** qualified source hashes match after
the suite; its Wasm remains byte-identical to the measured artifact.

`round3-verification.json`, `round3-wasm.json`, `round3-source-sha256.txt` and
`round3-log-sha256.json` retain small receipts and custody. Full raw logs remain
at `~/sb4-intent/reviews/sj-r3-evidence/`. Final `ref-check --verbose` passes: **525 LLP docs, 10,112 refs, zero errors
or unchecked refs**. `git diff --check` passes. The local commit carries the
requested Astra co-author trailer. Nothing pushed or published.

### Development failure classification

All development failures below are ours, not baseline failures or waived
infrastructure problems:

- Initial TypeScript inference rejected the masking reducer's `unknown` result;
  its explicit accumulator type fixes it.
- The first 16 browse fixture attempts assumed a remote reply from a complete
  local source. The next 16 horizon-based cases (and one diagnostic rerun) returned only the current row:
  that unscoped source did not emit retained-row provenance. Both were fixture
  errors. The permanent read-through witness asserts actual retained provenance
  and an actual composed request; all 16 cases pass.
- One build command was invoked from the repository root and refused the
  uninitialized Snapback 1 Ibex dependency. No root runtime was built. The
  corrected command uses `snapback4/` and passes.
- The first deadline-drop mutation waited for a deliberately disabled refresh
  before asserting stale values, so its harness timed out at 70 seconds. The
  permanent watch asserts masked data before waiting, and the completed mutation
  uses all eight one-shots to produce direct stale-label assertion failures.
  This was a mutation-harness error, not a product qualification failure.

Intentional negative evidence is separate: three omitted-field typechecks,
three collapsed-shape cases and eight discarded-deadline cases must fail.
The changed `client.ts` await-expression hash is refreshed because the existing
callback now schedules `valueServer`; all **58 awaits** and all classified site
IDs, recipes and required/optional assignments remain unchanged.
