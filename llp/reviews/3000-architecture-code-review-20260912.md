# Snapback 4 — comprehensive architecture and code review, 2026-09-12

**Reviewer:** Codex / GPT-6
**Requested by:** Charlie Cheever
**Scope:** Architecture, correctness, performance and ergonomics across the entire `snapback4/` project. The author's updated instruction assigns security holes to another model; this record makes no security assessment.
**Baseline:** repository commit `d6c803878a5432cce5f045777786a049972d3d70`; Snapback 4 Git tree `cf0a13dca32b3e1721d1d947a3f82c262a0807f0`; package/crate version 0.0.16.
**Method (original review):** One reviewer, source inspection plus independent executable probes; no delegated or second-family review is represented.
**Artifacts at review time:** Four Draft Research LLPs; 37 filesystem tickets (23 P1, 14 P2).
**Resolution follow-up (2026-09-13):** All 37 tickets are closed with individual resolution and regression pointers. See the [corrections, qualification and independent review record](./3000-review-corrections-20260913.md). The assessment and examples below describe the 0.0.16 review baseline.

## Assessment

Snapback 4 has a compact architecture worth continuing: one small Rust binary,
a declarative schema and bounded IR, ordinary indexed SQLite storage, explicit
partition acquisition, and a public read/write card that reference screens can
consume without understanding the storage machinery. The group-keyed log
avoids a per-recipient copy of every row event. The engine's transaction and
applied-operation record give server mutations a useful atomic core. The
fenced workspace and fast suite also make direct experiments inexpensive.

The main weakness is disagreement between boundaries. The successor classifier
and installer do not establish the same facts. Confirmed rows and predictions
share storage without sufficient recovery information. The TypeScript
interpreter and compiler lowering do not preserve all of the retained value
and expression semantics. The simulator models safeguards that the shipped
client lacks. The HTTP host and partition acquisition perform substantial work
outside the effective meter boundary.

The result is several ordinary workflows producing a plausible but wrong
answer: a failed edit becomes a complete, fresh missing row; a live observation
never sees a peer's update; a complete-looking combined page omits or duplicates
rows; a valid text aggregate splits into two identities; a helper expression
returns 4 instead of 3. These should be addressed before treating the existing
green suite or bakeoff result as evidence for the affected capabilities.
This does not invalidate unrelated working behavior or reopen the author's
choice of substrates.

## Architecture questions requiring deeper consideration

| Research LLP | Question | Concrete pressure from the review |
|---|---|---|
| [3000.000 — Atomic schema and release activation](../3000.000-atomic-schema-and-release-activation.research.md) | What process owns activation, and what state changes atomically? | Unchecked narrowing, undeleted columns, unchanged restart generation, reused release directories, partial install/rebuild publication |
| [3000.001 — Durable replica and write lifecycle](../3000.001-durable-replica-and-write-lifecycle.research.md) | How do confirmed state, admitted order, predictions and terminal outcomes coexist durably? | Failed snapshot replacement, overlapping transactions/syncs, refused updates deleting confirmed data, stranded retries, nondurable outcome discovery |
| [3000.002 — End-to-end resource bounds](../3000.002-end-to-end-resource-bounds.research.md) | Which boundary limits each physical allocation, wait, acquisition and retained history? | Four polls consume all HTTP workers, output cuts return oversized data, unbounded input/snapshot buffering, per-group stream acquisition, indefinite log growth |
| [3000.003 — One semantics and credible verification](../3000.003-one-semantics-and-credible-verification.research.md) | How is the same meaning enforced across compiler, Rust, TypeScript and test hosts? | Numeric/tag/order drift, missing online-only routing, false horizon completeness, lowering bugs, ignored result states and a bespoke simulated client |

The LLPs give alternatives and tradeoffs rather than prescribing an accepted
rewrite. The named core owner can choose the smallest adequate model. Clear
bugs in the index below do not need to wait for every architectural question
to be settled.

## Coverage and execution

The source inventory included 54 Rust files under `crates/` (15,284 lines),
13 client source files (2,776 lines), 13 reference-app source files (421 lines),
and the fixture, floor, witness, loop-bar, measurement and publication code.
Counts exclude dependencies, generated files and build output; they describe
scope rather than a completeness proof.

| Area | Review coverage | Execution in this review |
|---|---|---|
| Governing design and authoring contract | SB4 agent fence, root/brief, exclusions, append-only journal, builtin guide, package README, prior review dispositions | Reconciled findings with implemented/deferred scope |
| Core values and persistence | Value/key/cursor model, schema and constraints, store/indexes, meter, reads/writes/rules, maintains, idempotency, wire, successor, partition lifecycle | Existing Rust suite; focused schema, projection, JSON and output probes; authored created-fact mutation |
| Quarry frontend | Lexer/parser/AST/types/diagnostics, catalog/schema/program binding, lowering and TS emission | Helper, short-circuit, namespace, named-key panic, enum emission, rule-number and null-narrowing examples |
| CLI and HTTP host | Project discovery/bootstrap, check/run/data/doctor, serving, changes/sync, deployment/rollback, launcher | Fresh temporary dev servers; real queries/mutations/observations; restart; isolated deploy/rollback sequence; four-waiter latency probe |
| Online/local clients | Public contract, session-facing API behavior, watches, outbox, prediction, generation/catch-up, local interpreter | Real server plus actual built clients; controlled response ordering and retry failures |
| Stores and React | Memory, IndexedDB and SQLite implementations; Expo driver; query/page/mutation hooks | Node SQLite transactions and snapshot failure; memory rollback; headless Chromium with real React development hooks; built page-resource behavior |
| Reference apps | Web and Expo client initialization, inbox/thread/composer, backend schema | Prescribed app typechecks; lifecycle/draft behavior inspected; no physical-device UI session |
| Verification and periphery | Corpus selection/assertions, simulator world/network/disk/host/replica/invariants, fixture replay/audit, floors, witnesses, measurements, loop bar, package publishing | Prescribed simulator and fixture tests; witness helper used for the headless React probe; publication and cleanup reviewed without invoking them |

The prescribed command completed successfully on the review baseline:

```sh
cd snapback4
PATH=/Users/ccheever/.volta/tools/image/node/24.19.0/bin:$PATH \
  CARGO_BUILD_JOBS=4 bash scripts/test.sh
# == 0 failure(s) in 46 s
# client tests: 13 passed, 0 failed
```

A frozen Bun install and workspace build preceded the suite. Node 24.19.0,
Bun 1.3.12 and Rust 1.97.0 were used. The baseline suite exercised the existing
Rust tests, package build/typecheck, web/Expo typechecks, fixture tests and
client tests. It did not contain the new review probes. No complete suite was
rerun just to retest unchanged product code.

Additional probes ran against the root checkout's built code and disposable
local stores/apps. They did not use the independently changing named SB4 lane.
Only launched process handles were stopped. The review did not publish npm
packages, activate a real deployment, signal loop-bar processes, run a
large-scale soak, or claim real server power-loss/device-crash testing. The
Expo adapter's concurrency concern is code-traced; its Node counterpart was
executed. IndexedDB replacement atomicity follows the shared apply path and
adapter implementation; the injected disk-failure reproduction used SQLite.

## Evidence highlights

| Experiment | Desired behavior | Observed behavior |
|---|---|---|
| Narrow text <=100 to <=1 over existing longer data | Refuse activation without changes | `Ok(2)` |
| Make duplicate existing values unique | Refuse activation | `Ok(2)` |
| Fail snapshot installation after clear | Old rows/watermark survive together | Row absent, watermark still 10 |
| Resolve two syncs as watermark 3 then 2 | Keep 3 | Persisted watermark 2 and older row |
| Transaction B succeeds while A waits, then A aborts | B remains committed | B disappears |
| Refuse a predicted update of an existing row | Restore confirmed `body: "start"` | Local `null`, complete/fresh, even after sync |
| Recover after mutation HTTP 503 | Retry the same admitted write | Pending row remains; server has no new row |
| Foreign commit after online observation | Observation reaches two rows | Observation stays at one; direct query sees two |
| Add missing membership after denied observation | Mounted observation recovers | Still denied; direct query succeeds |
| Predict a text-grouped count | One group with count 2 | Separate `Id` and `String` group ids, each count 1 |
| Four two-second changes waits, then health request | Health does not wait for idle clients | 1,904 ms health latency |
| `identity(1) + identity(2)` | 3 | 4 |
| Skipped `or` branch containing null assertion | true, no right-hand evaluation | Refused with `MISSING` |
| Live first-page boundary shifts | Coherent combined pages | `[z,a,c,d]` omits b; `[b,c,c,d]` duplicates c |
| Actual React Strict Mode mutation and unmount | Settled state; all resources closed | `last: undefined, inFlight: true`; one page observer remains unclosed |

Each ticket identifies whether its evidence was executed, measured or traced.
An executed example does not imply every adjacent failure mode in its
acceptance criteria was also executed. The criteria specify work for the fix.

## Ticket index

P1 means significant incorrect state/results or low-load service degradation
that should be addressed promptly. P2 means a narrower authoring, lifecycle,
verification or tooling defect. No P0 designation or security severity is
assigned by this review. The order groups related fixes rather than asserting
an exact total implementation order.

| ID | Priority | Finding and filesystem ticket | Evidence |
|---|---|---|---|
| R01 | P1 | [Validate stored rows before accepting schema narrowing](../../issues/closed/20260912-snapback4-schema-narrowing-validation.md) | Reproduced |
| R02 | P1 | [Apply the declared row projection when columns or tables are removed](../../issues/closed/20260912-snapback4-schema-row-projection.md) | Execution + trace |
| R03 | P1 | [Publish schema, programs, derived state and generation together](../../issues/closed/20260912-snapback4-schema-generation-atomicity.md) | Execution + trace |
| R04 | P1 | [Keep release identities immutable and propagate activation I/O failures](../../issues/closed/20260912-snapback4-release-identity-and-io.md) | Execution + trace |
| R05 | P1 | [Replace snapshot rows and their watermark in one transaction](../../issues/closed/20260912-snapback4-snapshot-replacement-atomicity.md) | Reproduced |
| R06 | P1 | [Serialize or compare-and-apply overlapping sync responses](../../issues/closed/20260912-snapback4-concurrent-sync-regression.md) | Reproduced |
| R07 | P1 | [Isolate unrelated asynchronous SQLite transactions](../../issues/closed/20260912-snapback4-sqlite-transaction-isolation.md) | Execution + trace |
| R08 | P2 | [Make MemoryStore honor the store transaction contract](../../issues/closed/20260912-snapback4-memory-store-rollback.md) | Reproduced |
| R09 | P1 | [Preserve timestamp bits and durable outbox admission order](../../issues/closed/20260912-snapback4-operation-id-and-outbox-order.md) | Execution + trace |
| R10 | P1 | [Restore confirmed state when a predicted write is refused](../../issues/closed/20260912-snapback4-rejected-prediction-restoration.md) | Reproduced |
| R11 | P1 | [Resume pending writes after transient HTTP failures](../../issues/closed/20260912-snapback4-outbox-retry-after-503.md) | Reproduced |
| R12 | P1 | [Return and preserve dependencies for online live queries](../../issues/closed/20260912-snapback4-online-observation-invalidation.md) | Reproduced |
| R13 | P1 | [Keep read dependencies when a local query refuses](../../issues/closed/20260912-snapback4-denied-observation-recovery.md) | Reproduced |
| R14 | P1 | [Run operations outside replica coverage on the server](../../issues/closed/20260912-snapback4-online-only-operation-routing.md) | Execution + trace |
| R15 | P1 | [Do not infer complete absence from a truncated partition](../../issues/closed/20260912-snapback4-horizon-completeness.md) | Execution + trace |
| R16 | P1 | [Preserve the server value model in client arithmetic, ordering and aggregate keys](../../issues/closed/20260912-snapback4-client-value-semantics.md) | Reproduced |
| R17 | P1 | [Stop oversized query output before returning it](../../issues/closed/20260912-snapback4-query-output-budget.md) | Reproduced |
| R18 | P1 | [Bound HTTP admission and release the engine before network response work](../../issues/closed/20260912-snapback4-http-body-and-response-bounds.md) | Source trace |
| R19 | P1 | [Keep idle changes polls from occupying every HTTP worker](../../issues/closed/20260912-snapback4-long-poll-worker-starvation.md) | Measured |
| R20 | P1 | [Give inlined helpers fresh lexical bindings](../../issues/closed/20260912-snapback4-helper-binding-hygiene.md) | Reproduced |
| R21 | P1 | [Keep right-hand lowering inside short-circuit branches](../../issues/closed/20260912-snapback4-short-circuit-lowering.md) | Reproduced |
| R22 | P2 | [Reject duplicate named index keys without panicking](../../issues/closed/20260912-snapback4-duplicate-named-key-diagnostic.md) | Reproduced |
| R23 | P2 | [Check operation uniqueness after module qualification](../../issues/closed/20260912-snapback4-module-operation-names.md) | Reproduced |
| R24 | P2 | [Escape literals and property names in generated TypeScript](../../issues/closed/20260912-snapback4-typescript-literal-escaping.md) | Reproduced |
| R25 | P1 | [Reject unsupported JSON numbers instead of replacing them with zero](../../issues/closed/20260912-snapback4-json-number-decoding.md) | Reproduced |
| R26 | P1 | [Keep sibling created facts when one inserted row is updated](../../issues/closed/20260912-snapback4-created-facts-after-update.md) | Reproduced |
| R27 | P2 | [Assert retained result states and distinguish intentional corpus exclusions](../../issues/closed/20260912-snapback4-corpus-state-and-skip-coverage.md) | Source trace |
| R28 | P2 | [Make React hook resources survive Strict Mode setup and cleanup](../../issues/closed/20260912-snapback4-react-strict-mode-lifecycle.md) | Reproduced |
| R29 | P2 | [Reconcile live page boundaries when earlier pages change](../../issues/closed/20260912-snapback4-live-pagination-boundaries.md) | Reproduced |
| R30 | P2 | [Limit loop-bar cleanup to recorded process ownership](../../issues/closed/20260912-snapback4-loopbar-owned-process-cleanup.md) | Source trace |
| R31 | P2 | [Honor the documented bare-token client option](../../issues/closed/20260912-snapback4-bare-token-client-authentication.md) | Reproduced |
| R32 | P1 | [Diagnose unrepresentable rule literals instead of compiling them as zero](../../issues/closed/20260912-snapback4-numeric-rule-literal-decoding.md) | Execution + trace |
| R33 | P2 | [Keep null narrowing inside the control-flow branch that proves it](../../issues/closed/20260912-snapback4-branch-local-null-narrowing.md) | Reproduced |
| R34 | P2 | [Resolve witness tools from the Snapback 4 workspace](../../issues/closed/20260912-snapback4-witness-workspace-dependencies.md) | Source trace |
| R35 | P2 | [Preserve reference-app drafts and show failed writes](../../issues/closed/20260912-snapback4-reference-composer-draft-loss.md) | Source trace |
| R36 | P2 | [Align the distributed binary with the profile used for shipped-size claims](../../issues/closed/20260912-snapback4-publication-build-profile.md) | Source trace |
| R37 | P2 | [Close clients that finish opening after their component unmounts](../../issues/closed/20260912-snapback4-reference-client-open-cleanup.md) | Source trace |

## Suggested repair order

First restore state invariants: transactional store scopes and snapshot
replacement (R05–R08), sync serialization (R06), then confirmed-state recovery,
admission order and retries (R09–R11). These influence many other client
observations. Schema admission/projection/activation and immutable release
identity (R01–R04) are independent fixes for the core owner to prioritize
alongside the client work.

Fix the independent live-query and compiler errors next or alongside those
state changes: dependency propagation/recovery, eligibility, value-model parity,
helper hygiene and short-circuit lowering have small concrete reproductions.
The four-worker starvation and output bound should also be addressed promptly;
neither needs a complete serving rewrite to establish a focused failing test.
The narrower P2 items can be batched by owner without reopening the design.

The larger representation, activation and acquisition choices should produce
small implemented decisions in the existing root/children, with their evidence
kept close to the code. This review does not prescribe a new proof framework,
gate, registry, full-corpus audit or publication approval flow.

## Reproduction recipes for the state failures

The following sequences summarize the exact test seams, independent of the
temporary file paths used during review. All names are from the shipped source
and can be added to existing tests by the implementing owner.

```text
SQLite transaction isolation:
  store = openSqlite(nodeSqliteDriver(new DatabaseSync(':memory:')), schema)
  A = store.write(async tx => { put A; signal ready; await gate; throw abort })
  await ready
  await store.write(tx => put B)     # this resolves successfully
  release gate; await A's rejection
  read B                            # actual: absent; required: present

Snapshot replacement:
  persist row old, generation 1, watermark 10
  wrap store.write so the next call rejects; delegate clearRows normally
  Replica.apply({snapshot:true, events:[], watermark:11, more:false})
  inspect underlying store          # actual: no old row, watermark 10

Overlapping syncs:
  persist generation 1, watermark 1
  start syncOnce A and B with deferred transport responses
  resolve A with row value 3 / watermark 3; await A
  resolve B with row value 2 / watermark 2; await B
  inspect state                     # actual: 2; required: 3
```

For the end-to-end client cases, create a temporary `snapback/schema.q`, run
`target/debug/snapback4 dev --port 0 --no-watch`, seed only that temporary
server, and import the freshly built `packages/snapback4/dist` clients. Use
`store: "memory"` for a small reproducible UI/query case and persistent adapters
for transaction/recovery acceptance. Inject failures in the transport or store
boundary rather than claiming to have produced an operating-system crash.

The helper, short-circuit and narrowing tickets contain minimal Quarry
programs; the deployment ticket gives the exact isolated release sequence.
The page example used the built `Pages` class with controlled observed pages;
the Strict Mode example mounted the actual exported hooks under real React in
headless Chromium. Neither relies on a simulated React lifecycle.

## Scope choices and corpus housekeeping

Existing exclusions were respected: effects/jobs execution, word search,
assets, time in rules and exact horizon maintenance were not filed as missing
features. A horizon-related ticket asks for honest completeness, not the
explicitly deferred eviction/backfill machinery. The labelled mock was reviewed
as a mock; its shortcuts are not presented as bugs in a production engine.
Security holes and any security verdict are left to the separately assigned
review, as instructed during this task.

LLP 3000 was extended first. No previous child of 3000 existed in the corpus or
the scanned deletion history, so the new children are 3000.000–3000.003, all
Draft Research with relative links in `llp/current/`. To preserve the adopted
59-document budget, this review archived only the working-set links for the
historical Snapback 1 research records 0329.011, 0329.014, 0329.019 and 0329.021.
Their files, statuses, conclusions and references remain in place. Their
historical analysis is still reachable through the root/family; removing the
links does not settle their open questions or change another track's design.
The four links are traded for the four current SB4 investigations. No
foundation link was changed.

The journal has an append-only entry linking this record. Product source,
public contracts and tests were left unchanged; the artifact checks below
verify the written review, not implementation of the findings.

## Artifact validation

- **Passed:** metadata and local links for all 37 tickets, four new LLPs,
  review record, root update and appended journal entry; relative current
  links; unique child numbers; whitespace and scoped `git diff --check`.
- **Passed:** `llp/current/` contains 59 entries, with no foundation changes.
- **Passed:** the only changed tracked path under `snapback4/` is
  `JOURNAL.md`; product source and test files match the tested baseline.
- **Repository-wide check failed outside this review:** `./ref-check --verbose`
  reported 39 broken references in `.llp/ship-runs/**/*.jsonl` agent
  transcripts, with zero unchecked references. Every reported error was in
  those unrelated transcripts. The existing
  reference-scanner ticket `issues/shelved/20260912-ref-check-agent-transcripts.md`
  tracks this behavior; no duplicate ticket or transcript edit was made.
