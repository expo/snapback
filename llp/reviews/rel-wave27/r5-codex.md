OpenAI Codex v0.164.0
--------
workdir: /home/ccheever/projects/sb4-b27-rel
model: gpt-6.1-sol
provider: openai
approval: never
sandbox: danger-full-access
reasoning effort: high
reasoning summaries: none
session id: 01a16f2f-06e6-7fc0-9233-7435e467af91
--------
user
Review the normative §21 amendment and release_bridge.rs exact_write_authority implementation for MATERIAL safety/custody/design defects. Return READY if none, otherwise MATERIAL with concrete repair. Do not edit files or run builds. This is a fresh blind review. The wave-27 full-store replay found source selection falsely refused already-protected dispatcher/planner operations. The revised gate admits closed Boolean containment and stable dominating viewer/literal positive-existence requires over fully expanded IR writes; branches/loops participate in the write set. Scope changes, emits and unknown implicit writes still refuse. Read code if useful; focus on proof soundness and remaining false refusals. Security-owned code is unchanged.

Normative section:

## 21. Wave-27 release semantics (REL)

Implementer: Codex for Charlie Cheever, 2026-10-24. Commission: wave-27
fix list 10b #1, #2, #3, #5, #7 and #8. This amendment supersedes the narrower
input adapter and extraction type equality restrictions in §20 only as stated
below. Retention, transactional validation, lifetime custody and current policy
admission remain in force. No publication, version bump or push is authorized.

### Registration and guarded source

A new column write audience or frozen column alone does not register a view.
Structural domain widening, actual old-row hiding/misrepresentation and the
existing unchanged-data/intent executable repair protection determine need.
Historical source selection (including an equal-source forward deploy) checks
column write/freeze authority against both the active source AND latest ordinary
source (both must pass), so an intervening old selection cannot erase that boundary. This is a
closed static admission gate under command locking and activation CAS. It aligns
declared table/column identities and complete probe-index meaning. Every old
insert/update/upsert that can supply a protected column must retain the policy,
or a conjunctive table guard must contain the exact compiled current policy as a
conjunct after identity/probe alignment (deny implies every policy, allow needs
no guard). Closed Boolean containment additionally admits each branch of an old
OR only when it admits the new policy, an old conjunct when it admits the policy,
a new OR when one branch is admitted, and a new AND only when every branch is
admitted. These are structural sufficient conditions, never sampled implication.
A dominating leading `require` may supply that same containment when its compiled
policy uses only viewer/literal equality or positive existence with viewer/literal
keys and equalities (and AND/OR). Every dependency must be disjoint from the
operation's complete expanded IR write set. Conditional/loop writes participate
in that set; they do not themselves change the viewer. JobAs/JobQuery/emitted
external effects and implicit maintained/sequence/referential writes refuse this
reduction. Rules depending on row images, negative probes, references or mutable
locals cannot supply it. Other operations, jobs or external writers cannot
interleave within this atomic mutation; their presence alone is not a blocker.
Finite campaigns never supply proof.
A known object patch is the compiled syntactic fixed-key object with no spread,
computed key or dynamic base. If it omits a field it is not a write to that field;
all other patch forms remain conservative. Insert defaults count. Upserts must satisfy both arms.
Transition-bound guards and missing freezes need an authored guarded bridge;
there is no guessed implication. Selection refuses with operation, column and
rule before those old writes become live. Read-only/unrelated writes remain
selectable. New ordinary source may deliberately change policy through the
normal deployment review. Historical selection never dynamically rewrites its
immutable executable or grants an acknowledgment bypass. `check` compiles needed views against an explicitly selected deployment
store as well as the normal saved-client baseline, without registering them or
mutating immutable source. Production deploy repeats compilation and writer
validation. A source-only check with no predecessor cannot qualify a production
transition and says so in the guide.

Typed table alpha conversion edits only nominal type and table-reference AST
slots. For-loop table domains are adapted only without an argument/local shadow
in that lexical scope; named values/shapes stay untouched. The compiler resolves
explicit Read/Write AST slots as tables and Name/ShapeUse slots as values/shapes,
so unchanged argument/local/shape slots cannot capture a rewritten typed read.
The complete adapted closure recompiles; unsupported resolution still refuses. Argument/local/shape spelling equal to a table name is safe when those
slots remain unchanged. Table mappings stay injective, every destination must
reparse nominally, and conflicting/unsupported source spans refuse. Column write
and frozen predicates participate in exactly the same transport and compiled
current-authority comparison as read predicates. Business literals never change.

Guarded views retain the current execution closure. An incompatible old write
export (new required argument, removed input, narrowed domain or merged wire
position) may be paused with E_OP, including a same-name current write. The
view removes that export and reports its operation and incompatible argument;
it does not revive an old body, make a required choice optional, supply an
invented default, or mark a removed data-bearing input deprecated. Other names
of the same authored endpoint are considered independently. Required old
queries still need compatible current endpoints; refusal identifies their real
source site and argument. Removed required/defaulted fields need a truthful
reverse projection or an authored bridge. Every refusal identifies the concrete
site and relevant table/column/argument/rule instead of an empty :0:0 site.

### Selection and identity

Every successful human deploy/rollback, including unchanged deploy, prints one
stdout `live:` line. JSON reports `live` with selected `release`, logical ordinary `source`, numeric selected `view` (null for original source),
logical `target`, and Boolean `exact`. A view also names its registration
`parent`; source/target are the predecessor and release/view the actual compiled
source. Ordinary source has no view and all source/target/release ids agree. `releases --json` exposes the same object. Previews identify the candidate
separately and never claim a move. An equal forward deploy matches ordinary
releases only: it selects that ordinary id under the normal restoration/CAS
validation rather than leaving an equal-content view selected. A genuinely
changed desired registry may still require a new registration parent.

A default view writes with its immutable compiled guarded workflow and current
registered authority. Complete-current views retain current programs/defaults;
selective predecessor views retain old programs with carried guards and reused
current endpoints as recorded in their change checklist. Existing registered
selective views remain valid under that narrower disclosed promise. Identity
output names the registration parent, never claims a view runs every program of
that parent, and directs inspection to the actual compiled source. Exact
selection requests immutable original source, subject to current safety gates.
Foresight distinguishes exact-source risks from a registered view that covers
them and names that view. Legacy redeploy advice applies only to parents lacking
a view manifest; a modern refusal names the actual migration/repair instead.

### Extraction and migration cycles

Forward extraction accepts an identical authoritative source type or required
to optional widening of that identical type; no bounds, MIME, once, nominal or
cardinality conversion is implied. Reverse validates the actual child value
against the selected parent domain; null cannot be invented for a required
parent. A receipt-owned, validly anchored child whose asset cell is absent/null may be
refilled only with the current parent cell. A nonnull source must have the live
ledger home on that parent and matching existing bytes before transfer; no
historical receipt value is used to recover a cleared/released upload. A null
source moves no bytes and remains null. This ledger-home proof distinguishes a
reversal-moved value from a child clear whose released asset has no parent home.
A distinct nonnull child asset still conflicts. Transfer verifies the live ledger home and bytes inside the same adoption writer transaction as transfer, under command locking and CAS; failure rolls back homes, cells and receipts together. It never recreates deleted/pruned child history.

Every non-each extraction that replaces a predecessor cell prepares a
current-workflow view, including empty deployments: independent future children
cannot truthfully fit one old cell. Its current schema may omit that extracted
parent field while retaining the entire child population; old query/result
changes are disclosed, no child is chosen, and no parent row is hidden.
Inherited read-through admits an identical or structurally stricter parent rule.
Source/child payload policies compare under explicitly copied immutable scalar
identities. The inclusion direction is CHILD audience ⊆ SOURCE audience, never its inverse.
The closed subset rule admits equality, child deny, source allow, and Boolean
conjunction/union inclusion only: every child-disjunction arm must fit the
source; every source-conjunction arm must cover the child; a child-conjunction
may narrow via any covering conjunct, and a source-disjunction may cover via
any covering arm. All other cases refuse. Different atoms are never equated. Row-field
transport requires immutable scalar copies in BOTH source and child. Unmapped
source fields cannot accidentally match same-spelled child fields. Probe index
meaning and read policy must remain the source context. A source payload gate must be covered by the child row rule, inherited parent
rule or an identical/structurally stricter child column gate after that identity
transport; otherwise refusal names source, destination and the missing read rule.
No gate is silently discarded and no semantic policy implication is inferred. A parent with multiple independent children has no automatic single
asset representation. `rollback --check --bridge DIR` always writes a usable
current-source bridge plus a repair checklist naming the parent/reference and
mapped fields: keep the current population visible, choose a truthful old
representation through an authorized mutation, preview exact rollback, and only
then select it. No arbitrary child is selected, discarded or hidden.

Backfill/down receipts distinguish current native output from its projected old
view on every cycle. Reversing again verifies the physical value against the
previously accepted view before reusing retained native output, so a projection
must not become a new authored value merely because a second cycle occurs.
Actual changes to old dependencies still recompute or refuse competing authored
values. Definition names keep their immutable meaning; repairs name the order:
select/deploy a bridge preserving current values, apply authorized repairs, add a
new transformation name for new meaning, preview, then select the destination.
Reference rename may change deletion policy in the same release provided its
nominal target, nullability, full type bounds, lifetime bindings and capture shape remain exactly identical (these define unchanged lifetime ownership); widening remains a separate migration; activation applies the
selected policy to subsequent deletes, never recapturing a reference lifetime.
`alias TABLE.COLUMN 'old' = 'new'` is an injective enum spelling declaration:
old is predecessor-only, new a current variant, and neither side can merge.
It lowers to normal immutable named backfill/down receipts, with current and
historical enum domains and no separate value codec. Wire arguments retain
their declared domain; a data-bearing old input needs an explicit consuming
compatibility endpoint. Arbitrary enum merges remain explicit transformations.

### Artifacts and proof

Saved versions capture a complete generated TypeScript module unit, including
its package marker. Source-selecting deploy uses private codegen and leaves the
working generated unit untouched. Extra deploy/rollback/release positionals
refuse before filesystem/store work. Human deploy prints the concrete refusal
before REVIEW notes. Day-two starter proof compares persisted rows by id across
two rollback/forward cycles; it excludes writes intentionally performed through
the v1 client and permits v2-native rows without fabricated v1 preimages.
Changed guide/starter fences execute against a packed package. Qualification
records affected tests, short language/store differential runs, all 50 copied
wave-27 stores and all 50 copied wave-25 stores against 0.4.40 and this build.
Read-only originals and credentials never enter artifacts. Mac is skipped.

### Review clarifications

Enforcing-key weakening, including changed compiled key meaning, remains an
explicit empty-population registration trigger in §20.1. Default domain joins
use nullable-if-either-nullable and the union cardinality interval; only an
explicit null-hiding acknowledgment retains a required joined domain. Optional
arguments use their authored literal default first, otherwise language null.
Backfill/down names are rejected on normalized definition/digest mismatch across
all retained history, including gaps and prune; repair wording states the ordered
bridge/authorized-write/new-name/preview sequence rather than suggesting name
reuse. Same-release reopen runs no alternate runtime: cold/preview/restart use
this runtime's format-9+ custody laws directly; the explicit protocol feature
fences the other process on hot requests. No foreign manifest is borrowed across
active-source contexts, regardless of chronology.

A reference policy change is an intentional authored behavioral change under
ordinary delete admission and cascade budgeting. In a generated current-source
view, predecessor delete exports that now reach a newly cascading/set-null edge
are paused with E_OP, including transitive cascade roots. The source view keeps
the current deletion policy, but never reuses an old delete name to destroy
children that old source would retain/refuse. This applies regardless of current
population or one-to-one/many shape; ordinary compilation still proves the full
cascade product bound. A compatible current delete wrapper may preserve the old
refusal. Exact source retains its original policy. Restrict/cascade behavior is
tested both ways. It does not recapture any parent lifetime.

Writer-time population checking includes conditional freezes separately from
grants: any freeze depending on a hidden population conservatively refuses,
including trusted system writes. Compiler-expanded helpers/transitive references participate in this same dependency closure; unknown dependencies refuse. Positive existence cannot disable a freeze
merely because its predicate IR stayed equal.

The starter excludes only explicitly enumerated fields (including named expected
derived changes) of deliberate v1 writes from unchanged-value assertions; it
checks the other fields, still requires those ids on forward and separately
checks authored business assertions. New rows are allowed, not fabricated as v1 preimages. Short
verification means difftest run-lean plus 2,000 ordinary generated cases.
Mac is skipped by the commission; no Darwin qualification is claimed. Existing
private native/worker source custody stays in force. Saved generated siblings
are evidence for the selected unit; known API/server/package artifacts regenerate
from the selected bound and never from a different working schema.

The backfill cycle repair gives current active successor receipts ownership of
their output cells; inactive receipts retain history without competing for that
ownership. An entering transform may consume another inactive receipt's accepted
reversed view, but its computed output must equal any retained authored native
output for that cell. Disagreement still refuses with both values and the ordered
repair path. This prevents a new transform name from laundering a discarded edit.
No predecessor/view image is promoted to authored native output merely because
another release cycle occurred.

Equal-source deploy continues §20.1's private desired-registry comparison: targets,
executable digests AND hiding reasons must match before identity reuse/collapse.
Missing or changed entries create a newly validated registration parent. The
`live:` line reports the resulting actual selection, not a digest-based guess.


codex
I’ll read the applicable design context and trace `exact_write_authority`, focusing on proof soundness and avoidable refusals. I won’t edit files or run builds.
exec
/bin/bash -lc pwd in /home/ccheever/projects/sb4-b27-rel
 succeeded in 0ms:
/home/ccheever/projects/sb4-b27-rel

exec
/bin/bash -lc 'cat snapback4/AGENTS.md' in /home/ccheever/projects/sb4-b27-rel
 succeeded in 0ms:
# Snapback 4 — agent command sheet

Read this, then [LLP 3000](../llp/3000-snapback4.explainer.md) (the root and
the bakeoff protocol), [LLP 2000.000](../llp/2000.000-keep-the-core-flip-two-substrates.rfc.md)
(the design brief), [`NOT-DOING.md`](./NOT-DOING.md), and the tail of
[`JOURNAL.md`](./JOURNAL.md). `rules/RULES.md` at the repository root is
adopted here as written; LLPs for Snapback 4 are numbered **3000 and up**
(`llp-create --under 3000` for a child; extend LLP 3000 or LLP 2000.000
before minting a new number).

```
cargo build                          # the binary; no JS engine, no bootstrap; crates.io plus one vendored patch (vendor/tiny_http)
node scripts/affected.mjs --base origin/main --worktree --run # landing: fast/affected; prints every reason and retains a receipt
scripts/test.sh                      # complete battery: schedule/on demand; packed qualification: publication
./target/debug/snapback4 --help      # init [--online|--expo] · check [--cost|--residency|--fix|--json] · dev · deploy · rollback · serve · run (an op, or a job as the system) · test · why · guide · data · sql · token (a service's seat) · doctor · device · types · --version
./target/debug/snapback4 guide       # lists cards (`guide aliases` lists aliases); `guide language` for the language card — every card's Quarry is compiled by the suite (crates/snapback4-lang/tests/guide.rs)
cd apps/chat && ../../target/debug/snapback4 check     # compiles snapback/*.q, writes snapback/generated/api.ts
cd apps/chat && ../../target/debug/snapback4 dev       # serves 127.0.0.1:4400; re-adopts the schema on save
cd apps/chat && bun run dev                            # the app on the real client (?as=bob picks a persona)
bun run --cwd packages/snapback4 typecheck   # the contract, the client and the hooks typecheck
cargo test -p snapback4-core --test corpus -- --nocapture   # the conformance corpus, with skip reasons
cargo test -p snapback4-difftest     # fixed seeds, oracle regressions and replay (opt-in, no database by default)
cargo run --release -p snapback4-difftest -- compile case.q   # a generated or hand-written source's binder diagnostics ("ok" when none)
cargo run --release -p snapback4-difftest -- run --seed 0 --cases 100000 --workers 6 --out /tmp/quarry-difftest
cargo run --release -p snapback4-difftest -- replay crates/snapback4-difftest/cases/found/rewrite-identity--why--NOT_FOUND
cargo run --release -p snapback4-difftest -- run-devices --seed 0 --cases 100000 --workers 8 --out /tmp/quarry-devices   # server against both device stores; no database
cargo run --release -p snapback4-difftest -- replay crates/snapback4-difftest/cases/found/device-sqlite--write-predicted-refused--admitted
(cd lean && lake build) && cargo run --release -p snapback4-difftest -- run-lean --seed 0 --cases 100000 --workers 8 --out /tmp/quarry-lean   # the engine against the Lean model (LLP 3000.035 §5.2); ~900 cases/s on 8 workers
cargo run --release -p snapback4-difftest -- replay 'crates/snapback4-difftest/cases/found/lean--kind--committed~NOT_FOUND'   # needs the model built, or SNAPBACK4_LEAN_ORACLE=<quarry-oracle>
./target/debug/snapback4 check --emit-lean schema.q   # one checked file as the Lean model's case JSON; programs outside its fragment listed with a reason
# Store tests require SNAPBACK4_EVAL_POSTGRES pointing to a private evaluation cluster.
cargo test -p snapback4-difftest --features postgres  # fails if the cluster is absent
cargo run --release -p snapback4-difftest --features postgres -- run-stores --seed 0 --cases 1000000 --workers 8 --seconds 10800 --out /tmp/quarry-stores
cargo run --release -p snapback4-difftest --features postgres -- replay /path/to/found-case
python3 scripts/test-difftest-scheduled.py  # runner/ticket tests; no schedule or push
scripts/difftest-scheduled.sh --checkout "$HOME/quarry-difftest-runner" --state-dir "$HOME/.snapback-quarry-difftest" --hours 3
# Operator only: install daily launchd (Darwin) or user systemd timer (Linux).
scripts/install-difftest-schedule.sh --checkout "$HOME/quarry-difftest-runner"
cargo test -p snapback4-sim          # the chat world under faults: the seven invariants
cargo test -p snapback4-sim --test exhaustive   # every sequence of two writes (two viewers, two groups): disclosure and write authority against a model of the rules
SNAPBACK4_EXHAUSTIVE_DEPTH=3 cargo test -p snapback4-sim --test exhaustive -- --ignored   # three writes: ~7,000 states, minutes
scripts/kani.sh [harness...]         # Kani proofs of the key encoding (crates/snapback4-core/src/key_proofs.rs; minutes, ~12 GB peak); outside test.sh
(cd lean && ./check.sh)              # the Lean model of Quarry's core (LLP 3000.035 §5.2): lake build (~15 s cold, needs elan), no-sorry/axiom audit, 53 examples, the quarry-oracle I/O fixture; outside test.sh; open points in lean/OPEN.md
cargo test -p snapback4-sim --test native   # native jobs: builds native-fixtures/rescore for wasm32-unknown-unknown (cold ~20 s, then cached under target/native-fixture) and runs it
bash scripts/build-wasm.sh           # the device as wasm into packages/snapback4/src/wasm/ (the web tier and the Chromium witness need it); fails when the gzip exceeds metrics/wasm-budget.json — a landing that needs the bytes raises the budget in the same commit, with the reason
node witness/idb.mjs                 # the Chromium witness: the client on the wasm device over IndexedDB (needs Chrome)
WITNESS_UDID=<dedicated-udid> node witness/expo.mjs   # published witness verb/helper; freshly install apps/chat-expo Release first (simctl uninstall a previous build: its store belongs to an earlier backend); port 4400, no Metro
node witness/scale.mjs [G] [N] [M]   # cold sync at scale: G groups × N messages × M members into the wasm device; wall time + JS heap → metrics/witness.jsonl
node scripts/measure-storage.mjs     # what the store weighs on the scale seed (rows, indexes, partition log) → metrics/storage.jsonl
                                     # SNAPBACK4_BIN=target/release/snapback4 measures the release build (throughput numbers)
node scripts/measure-client.mjs      # each client tier's bytes on the pinned toolchain → metrics/client.jsonl
node scripts/attribute-wasm.mjs [--families] [--check-families] [--check-absent] # class bytes and concrete serde families; --check-families refuses non-text readers/non-Vec writers outside the exact dynamic-envelope, counting-writer and Scan map-replay allowlists; content-buffer families name the duplicated types and refuse Deserialize representations using untagged, tag or flatten; --check-absent refuses the core's prefetch, admission or log-event symbols in the web artifact (needs twiggy; slow, outside test.sh)
bash scripts/check-release-guard.sh # the web artifact's configuration plus the debug-only `web-device-check` feature must refuse to build (in test.sh)
bash scripts/measure-wasm.sh         # the device core as wasm (crates/snapback4-device), family-checked, bound and measured → metrics/wasm.jsonl
bash scripts/build-xcframework.sh    # the device as an iOS xcframework for packages/snapback4-expo (staticlib alone, stripped; 13.2 MB with native reads)
node loopbar/run.mjs --n 3           # the loop bar: fresh agents on the published pin build reduced Clique M1–M3 → metrics/loopbar.jsonl
node scripts/publish.mjs --prepare-client # rebuild wasm + clean client, pack once for cross-host qualification
# Linux qualification host: strace >=6.8 on PATH (audits every successful TCP listen).
node scripts/qualify-linux.mjs --client /path/client.tgz --expo /path/expo.tgz --out /path/qualification # Linux suite + Ubuntu/Alpine proof, no publish
# Add --consumer-only for packed frontend/toolchain proofs without test.sh; this writes consumer.json, never a publication receipt.
node scripts/publish.mjs             # Mac: qualify/sign Darwin; optional --linux-receipt + --linux-tarball import; platforms before client
```

Ordinary landings use `node snapback4/scripts/affected.mjs --base origin/main --run`
from the repository root; add `--worktree` for staged, unstaged and untracked
changes. `--json` prints the plan. Every command has a timeout, failures are
collected, and receipts live in `target/affected/`. Cargo runs with
`CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0`.
The selector reads Cargo's workspace graph, closes source changes over reverse
dependencies, narrows test-only changes to targets/files, and follows client
imports/process consumers. Unknown paths, locks/manifests, build scripts,
proc-macros and shared test support fail broad with a reason per file. The
complete battery belongs to the schedule; packed qualification belongs to
publication. An affected receipt does not qualify a release. See
[LLP 0189](../llp/0189-verification-cadence-and-claim-gating.decision.md#snapback-4-affected-selection-2026-10-24).

Crates: `snapback4-core` (value model, schema with `sync`, IR, key encoding,
SQLite store, rules with hoisting, the meter, the interpreter, the partition
log, at-most-once, the day-two classifier, wire forms), `snapback4-lang`
(Quarry lexer, parser, binder, diagnostics, the TypeScript emitter),
`snapback4` (verbs and the HTTP wire), `snapback4-sim` (the deterministic
world hosting the engine and a replica device), `snapback4-difftest` (seeded
Quarry source generator, rewrite and meter oracles, optional Postgres store
oracles with prefetch on/off, the server-against-device oracle on both device stores, the engine-against-Lean-model oracle, structural shrinking and replay; not published or linked by shipped crates), `snapback4-device` (the
interpreter over a `DeviceStore`: the core's SQLite under the native
module for Expo and Exact2 hosts, memory under wasm on the web; one
dispatcher, one suite on both)). The guide (`snapback4-lang/src/guide.rs`) is
the language card and the keyword cards; packages: `snapback4` (the client
over the device and the CLI shim), `snapback4-darwin-arm64` and `snapback4-linux-x64` (the binaries), `snapback4-expo`
(the Swift module over the device's C ABI).

What exists, by week (LLP 3000 §5):

| Week | Lands |
|---|---|
| 1 | the contract (`packages/snapback4/src/contract.ts`), the mocked chat app against it, the hub fixture wrapper, the five floor measurements in the journal, the simulator skeleton (`crates/snapback4-sim`), the Snapback 2 corpus copied in, 0.0.1 published |
| 2 | server: SQLite transaction and interpreter, rules and uniformity, the meter, the partition log (`sync`), generations, personas, the wire, `check`/`dev`/`run`/`test`/`why`/`guide`, the seven simulator invariants |
| 3 | web client: replica store, outbox with client-minted ids, local interpreter, reactive local queries, the online-only tier, the chat app on the real client |
| 4 | Expo client, day-two scenarios, deploy, the loop bar, the Clique hub run, the comparison record |

Gotchas you cannot derive from the code:

- Own Cargo and Bun workspaces; the repository root excludes them. Run cargo/bun from `snapback4/`. Node 24.x (`engines`): run the suite with the pinned runtime on PATH, not the ambient Homebrew node.
- Web builds require `bun install --frozen-lockfile` first. Binaryen 132.0.0 is
  an exact workspace devDependency; build/measurement invoke its portable
  `node_modules/binaryen/bin/wasm-opt` through Node, never a PATH optimizer.
  Missing/mismatched dependencies and optimizer failures refuse the build.
  See README's web-device build instructions and HV round 4 for host parity.
- The suite schedules client files in one pool: `max(1, min(24,
  floor(os.availableParallelism() / 3)))` slots (3 on 10 CPUs, 24 on 96).
  This counts Linux CPU affinity and leaves room for each file's servers,
  browser renderers and workers. Acquisition and server-e2e share that pool;
  there are no extra shard processes outside it. Real-timer files listed in
  `TIMER_CLIENT_FILES` drain that pool and run individually afterward with
  unchanged timing bounds. The quote-jump browser witness remains pooled.
  The two full-count model
  files retain a separate serial slot. `SNAPBACK4_TEST_SERIAL_CLIENT_FILES=1`
  still forces one client file at a time. The external file watchdog measures
  time since a subtest started or finished: max(900 seconds, largest single
  declared guard + max(60 seconds, 25%)). There is no absolute duration cap.
  Console output does not count as progress. Serial mode uses the same bounds.
  See `scripts/run-client-tests.mjs` and the QF round-2 guard census; update
  named work counts and recheck the census when declarations change. Every
  file runs as native `node --test` with default isolation, in a process group
  whose first member is a tiny Node keeper. The runner closes the keeper's stdin
  on completion, stall or abort; only the keeper calls `kill(0, SIGKILL)`.
  Runner death also closes that pipe. An unexpectedly exited keeper fails the
  file and never authorizes a runner signal. Cleanup requires two consecutive
  completed inspections (50 ms apart) with no living group member. Observed leftovers
  fail as TEST_FILE_LEAK. Failed listings and unclassifiable PID/PPID/PGID
  prefixes remain fail-closed. A ps timeout at two seconds retries once with a
  60-second bound; all other command errors refuse immediately. Listings use
  asynchronous spawn so other files' timers and keeper EOF delivery keep running.
  File watchdogs and cleanup's five-second window use per-file monotonic time.
  Expiry requires another completed snapshot: a live group after the deadline
  refuses; two consecutive empty snapshots pass even when the second is late.
  Precisely
  recognized exit-time routing anomalies
  discard the whole snapshot and retry at most twice, 50 ms apart; persistent
  anomalies refuse and never confer ownership (LLP 3000 §7, QF2).
  Metadata is validated for group members and
  their visible descendants; unrelated rows only increment diagnostics.
  Signed Darwin UIDs, variable lstart spacing and comm spaces are accepted.
  Vanished members count as exited. Processes leaving the group (setsid,
  setpgid or detached spawns) are outside cleanup custody; visible descendants
  receive metadata validation but are never signalled by the runner. Native Node's exit
  status alone decides test success; reporter counts are diagnostic only.
  The reporter observes progress as Node delivers it: synchronous work that
  does not yield may buffer events in Node's child until that work finishes.
  Such an unreported interval is subject to the same stall bound. See QF Round 7.
  The M5 MacBook is the publication host; the office M1 is calibration-only.
- Client tests and their helpers must gate Linux APIs (`/proc`, `strace`, `ss`,
  `taskset`, namespace/network tools) at the test or call, or implement a
  portable fallback. Keep portable assertions running on Darwin and give each
  skipped witness an explicit reason. The client pool runs
  `test-platform-audit.test.mjs`: a cheap static census follows static named/namespace `.mjs`
  imports and named helpers and checks scoped Linux skips/branches/early returns.
  A gate in another test does not count. This conservative common-case guard
  does not prove dynamic imports, generated scripts or arbitrary control flow;
  review those paths and run affected tests on the publication Mac.
  Listener snapshots and syscall tracing are Linux qualification capabilities,
  never dependencies of the published `snapback4/proof` browser helper.
- Before a publication dry run, warm the test artifacts **in that publication
  worktree**, while the host is free of calibration work:
  `LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT cargo test --workspace --no-run`.
  Use the dry run's toolchain, target directory, profile/features, `RUSTFLAGS`
  and Cargo profile environment. Do not add `--release` or `--profile production`:
  the suite uses the default test profile. The suite still asks Cargo for the
  complete test inventory, runs every binary and runs doctests separately.
  Warming compiles without executing tests and supplies no qualification receipt.
- One owner on the core (LLP 3000 decision 4): the engine, the store and the client contract are written by the lead session; Codex lanes take the fixture generator, the reference apps, the device witnesses and the periphery. Do not reshape `contract.ts` from a lane; propose the change in the journal.
- No ceiling is raised in slice one (LLP 2000.000 §12). A thing that does not fit changes the design or waits.
- The journal is append-only and dated; never rewrite an entry. LLP 3000 §7 carries decisions that must outlive it.
- Nothing here depends on `snapback2/` at runtime. Copy source deliberately, split under 1,500 lines on the way in, and say so in the journal.
- Named lane: `~/projects/snapback-sb4` on `sb4/*` branches. Never `git stash`; commit checkpoints.
- The conformance corpus (`corpus/`) is Snapback 2's serialized IR and value
  model; the core keeps those serializations so it binds. A case the slice
  cannot run is skipped with a named reason, never counted as a pass.
- `snapback/generated/api.ts` is built by `check` and `dev`, never committed;
  the app's typecheck needs a `check` first (the suite does one).
- Point rule probes and `exists` require a unique key. A fully pinned superset
  of a required unique key is unique too (for example an explicit role index
  containing the unique conversation/principal pair). Nullable unique key
  arguments need non-null proof. Other existence checks use bounded populations
  in code. Named equalities covering a total unique key check extra columns on
  that one row without an additional index.
- The packaged CLI uses `LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT` during both publication tests and its production build (LLP 3000 §7). A plain production Cargo build retains the dependency's ordinary SQLite policy; use the same build input when comparing with the package. The variable is unnecessary at runtime.
- When creating a stage, `scripts/publish.mjs` runs the suite and refuses on red, builds the production binary, packs `snapback4-darwin-arm64` and verifies the installed digest, then publishes both packages. Bump `version` in `packages/snapback4/package.json` (and its `optionalDependencies`), `packages/snapback4-darwin-arm64/package.json`,
  `packages/snapback4-linux-x64/package.json` and `Cargo.toml` together; a test refuses a mismatch.
- Publication retains exact qualified tarballs under `target/publication/`. If a
  stage exists, use `node scripts/publish.mjs --resume` to validate its recorded
  suite qualification, requalify those exact bytes through the installed-consumer
  proof, and finish missing registry artifacts; an existing version must match
  its staged integrity. This also applies after `--dry-run`. An ordinary invocation
  refuses an existing stage so changed source cannot silently publish old bytes.
  Bump the version to build a new pair; preserve a partially published stage.
- Cross-host publication (LLP 3000.021 §3.3): prepare the common client once
  from clean release source, qualify that tarball on Linux, and import the
  Linux tarball plus its receipt on the Mac. Source commit, client SRI and
  Linux SRI must agree. Linux prefers working Docker/Podman, otherwise uses checksum-pinned proot
  with clean Ubuntu 24.04/Alpine root filesystems in a user cache, and refuses
  `NPM_TOKEN` or `NODE_AUTH_TOKEN`, even when empty. It never signs or packs
  the client. The Mac never rebuilds or executes Linux; `--resume` rechecks
  its copied receipt. No receipt packs a Darwin-only client; an existing
  two-platform preparation is refused on that path. Packed dependencies must
  match the staged set. Uploads use verified private snapshots, with each
  digest checked again immediately before publish.
  Commands and current qualification limits:
  [`reports/20260927-lx-linux-package/REPORT.md`](./reports/20260927-lx-linux-package/REPORT.md).
- The guide is tested text. Every ```quarry block in `crates/snapback4-lang/src/guide.rs` and in `packages/snapback4/README.md` is compiled by `crates/snapback4-lang/tests/guide.rs` with no diagnostic and no note (the language card is also run against the engine); every refusal code the sources emit must be in `guide::CODES`; every `guide("..")` a diagnostic carries must name a card. Add a form to the language card when you add it to the parser, fence README Quarry as ```quarry, and never fence Quarry as plain text to dodge the test.
- Native jobs (LLP 3000.005) need `rustup target add wasm32-unknown-unknown`; the suite's fixture build fails loudly without it. The guest SDK `crates/snapback4-native` is a path dependency until it is published; an app's `snapback/native/Cargo.toml` names it by path.

Quarry store testing (LLP 3000.035 §5.1): `SNAPBACK4_EVAL_POSTGRES` is an
explicit evaluation connection. The factory owns one physical schema per worker,
restores its rows and bookkeeping, installs the compiled fixture, then opens the
ordinary engine. Mutation attempts restore a seeded snapshot; shrinking reuses
that same factory. `Database::connect_fresh()` is an opt-in test mode. Fresh and
restored outcomes must serialize to identical bytes. The local wire observer
retains SQLSTATE, message, detail and SQL statement before the public query API
converts a driver error to a refusal; it never changes the traffic.

Reads sweep every public boundary. Mutations compare every discovered position
twice on SQLite, and compare up to eight seeded positions per dimension on
Postgres (including first/last), plus the case's original budget. Sampling
counters are in `store_stats`; each selected position runs prefetch on and off.
Physical prefetch counters are separate from the exact public outcome record.
The widened generator (`src/widen.rs`) emits prefetch-reachable reads: pages
projecting `tags[.tag]` and `tags[name = .label]` (a `Get` and a unique
`Lookup` whose keys vary across rows) and a loop reading `tags[row.tag]`, so
`store_stats` reports marked reads, transferred rows, cases with a transfer
and `prefetch_consumption_witness_probes` (fewer database calls with prefetch
on: cached answers were consumed). A planted cached-hit-to-miss fault is caught
by the random corpus (LLP 3000.035 §5.1; the closed
[coverage ticket](../issues/closed/20261007-quarry-store-oracle-prefetch-coverage-gap.md)).
Heap is charged identically on every store and the device (LLP 3000.007
§20.24.5); any disagreement is a ticket candidate, never normalized into a pass.
The cluster regression asserts it finds no signature and refuses any new one.

`run-stores --seconds N` stops each worker between cases after N seconds; a case
and any shrinking already underway finish. `cases` remains the requested count,
`generated` is actual completed generation, and `time_limited_workers` reports
the early stop. Slowest-case timing includes generation, comparisons, shrinking
and artifact saving. It does not silently claim the requested million. The scheduled
runner rejects incomplete reports; its own `--hours` option instead chooses a
case count from a 256-case calibration of both campaigns, with 20% headroom and
a million-case cap. This is a sizing estimate, not a hard deadline.

Generator widening (`src/widen.rs`, LLP 3000.035 §5.1): from a stream
independent of the base generator (`generate::base`; a seed it leaves alone is
the base case byte for byte), cases gain prefetch-reachable reads, mutation
blocks (lets, `require`, `if`, several writes to `key` and `k2`, reads after
writes), a prelude of mutations `prep0..` run in order on the same store before
`run` (`Case::steps`, sometimes as the other viewer; `observe` then reads both
keys), and expiry (`expire at .until`, a clock advancing from `seeded_at`
through each step to `clock`, sweeps, `until: now + ttl`). Every oracle runs the
prelude (`execute::world`) and compares its outcomes (`prelude-*` fields;
`store-postgres-prelude`); a device acquires at the seed clock and catches up by
one sync round after the server's prelude. The prelude is emitted first so no
rewrite moves its sites. `lean::generate` narrows half the cases outside the
model (projections, expiry) back into its fragment; the rest stay named
unsupported (`shape`, `loop`, `table-expiry`). The report's `coverage` counts
each new feature (`block/*`, `prelude/*`, `projection/*`, `expire/*`, `clock/*`).

Quarry device testing (`src/devices.rs`, `src/device_writes.rs`, LLP 3000.035
§5.1 oracle 4): each case runs on a server engine and on a device of each store
(native SQLite at a file path, and memory), both brought up through the client's
own path: the `/schema` backend as JSON text, then `local.ts::syncRound` (capture
`sync_state`, `/sync` snapshot pages built as `serve_sync.rs` builds them,
`observe_store`, `apply` through `call_text`, catch-up stream). Never seed a
device store directly. Reads the device publishes without the server (`complete`
with `unknown` false, or a known refusal) compare the whole outcome record
except `seq` (and server-only `delivery`); every other read counts under a named
reason (`online-only-*`). Low ceilings reach the device only through `call`'s
`spent` ledger (`default - n`), compared at the server's boundary positions.
Writes go through `admit`: a device refusal must equal the server's, a
predicted row must equal the committed one (less its `pending` marker), and
after `settle` plus a sync round the device must answer `observe` as the server
does. `run-devices` accepts `--seconds`. Known findings are retained under
`cases/found/device-*` with a `DIAGNOSIS.md`; `tests/devices.rs` replays them
and `tests/smoke.rs` pins the fixed-seed signature set.

The Lean oracle (`run-lean`, LLP 3000.035 §5.2): `snapback4_lang::emit::lean`
translates each generated program's surface tree (never the binder's IR) to
the model's case JSON; `quarry-oracle` (`lean/Oracle.lean`, one process per
worker) answers one tagged outcome per line; the engine runs on SQLite at
default ceilings. Compared: kind, refusal code, data (tagged: an id is not a
text), `complete`, `next` presence, each side's own continuation, and a
mutation's `observe` reread. Not compared: meter fields and sites. Programs
outside the model's fragment are named unsupported reasons, never passes.
`lean::generate` adds Lean-only variants (per-effect rules, a hidden probe
target, nullable/id orders, residual filters) aimed at `lean/OPEN.md`. A
disagreement is a Rust defect, a model defect (only when a document
contradicts the model: fix the model, rerun `lean/check.sh`), or an open
point (record the engine's behaviour in `OPEN.md`); never change the model to
match the engine without a document. Findings live in
`cases/found/lean--*` with `DIAGNOSIS.md`; `tests/lean.rs` replays them and
pins the open signature set. Lean-dependent tests skip loudly without the
built model; `SNAPBACK4_REQUIRE_LEAN=1` makes that a failure.

Quarry scheduled testing: prepare a separate clean clone whose current branch
can fast-forward to `origin/main`. The runner fetches/fast-forwards it and starts
its own socket-only evaluation cluster with `fsync=off`,
`synchronous_commit=off`, `full_page_writes=off`, `shared_buffers=1GB`, and
`max_connections=200`. It builds the Lean model's `quarry-oracle` first
(`lake build` in `lean/`; a host without `lake` fails the run), then runs the
SQLite, store, device and Lean campaigns on the selected
seed window, replays shrunk findings twice, and files/appends open `issues/*.md`
tickets. Only ticket changes are committed/pushed, with three fetch/rebase
retries. State and reports live outside Git under `--state-dir`; seeds advance
only after completed work and successful owned-cluster cleanup. Dirty/diverged
trees, overlap, setup failures, partial reports and failed publication refuse.
A crash can retain the lock and cluster directory; inspect `lock/owner.json`
and the run report. Never stop a cluster by process name.

`--dry-run --cases 32` writes previews and a separate `next-seed.dry-run.json`,
never commits or pushes. Dry runs may explicitly supply `--external-postgres
'host=... user=... dbname=...'`; that cluster is neither started nor stopped by
the runner. Ambient connections do not override normal private-cluster ownership.
The installer remains an operator action; do not invoke it during development.

The Lean oracle on a scheduled host (one-time, per user, no sudo): install
elan with `curl https://raw.githubusercontent.com/leanprover/elan/master/elan-init.sh -sSf | sh -s -- -y --default-toolchain none`.
The runner finds `lake` on `PATH` or in `~/.elan/bin`; the first `lake build`
downloads the toolchain pinned in `lean/lean-toolchain` (Lean 4.34.1, no
Mathlib), so the first scheduled run needs network. Check by hand with
`(cd lean && ./check.sh)` in the runner's clone. `run.json` records the pinned
toolchain and the oracle binary's digest.

exec
/bin/bash -lc 'cat /home/ccheever/.codex/skills/llp-orient/SKILL.md' in /home/ccheever/projects/sb4-b27-rel
 succeeded in 0ms:
---
name: llp-orient
description: Before editing a subsystem, file, or starting a task, assemble the governing LLP context — read the root LLP, follow the @ref annotations on the code in scope, and find the LLPs covering the relevant systems. Produces a compact context pack of the constraints a change must respect. Read-only.
source: ccheever/llp@v0.5.2
---

# llp-orient

<!-- @ref https://github.com/ccheever/llp/blob/v0.5.2/llp/0008-distributed-agent-skills.rfc.md#the-skills--core-five-plus-flags — skill contract -->
<!-- @ref https://github.com/ccheever/llp/blob/v0.5.2/llp/0000-linked-literate-programming.explainer.md#2-reference-syntax — the grammar this reads -->

Load the design rationale governing the area you're about to touch, before touching it. This is the consumption side of LLP — orienting first is what turns `@ref` from a possibility into a habit.

Invoke as `/llp-orient <path-or-task>` (file, directory, subsystem, or task description). With no argument, use the current change scope (`git diff --name-only`).

## Trigger

Start of a coding task that touches an area with documented design. The orient-first *rule* lives in the repo's always-loaded `AGENTS.md`; this skill is the detailed form that rule routes to for non-trivial work — don't rely on ambient description-match alone.

## Invariants

- MUST be read-only: never edit code or LLP documents.
- MUST scope to the task: pull the constraints that bind this change, not a corpus summary.
- MUST cite, not restate: reference policy as `LLP NNNN#anchor` rather than paraphrasing sections.
- MUST NOT invent constraints. If something isn't documented, say so.
- MUST NOT guess the rationale behind a broken `@ref` — report it and hand off to `llp-maintain`.

## Workflow

> **Recipe (advisory)** — corpus root = nearest `llp/` walking up from the path in scope (LLP 0001 §Unit of adoption); "no corpus" is an empty walk, not cwd-relative absence. Read `llp/foundation/` first (the kernel; the root LLP is there once `Active` — on a fresh adoption it is still `Draft` and sits in `current/`), then skim `llp/current/` (the declared working set); both hold relative links — symlinks, or small files containing the relative path — so `ls` answers and either form resolves. Then the root LLP's systems vocabulary. `Grep '@ref'` over the files in scope and `Read` each target — these are the highest-signal context. `Grep` the `**Systems:**` headers across `llp/` for LLPs governing the subsystems touched; read the governing ones (Spec, Decision, Principles, relevant RFCs). Follow `Related:` and nearby `@ref` targets one hop out; stop there unless something is clearly load-bearing. Stale-pin nudge (skip offline): read the installed tag from the skills receipt (or a `source:` pin), compare `git ls-remote --tags <origin>` — if upstream is newer, say so in one line ("skills at v0.3.0, upstream v0.5.2 — run /llp-adopt update") and move on; never update from here.

## Artifact

A context pack with these sections, faster to read than the documents it points at:

- **Scope** — files / subsystems queried
- **Governing LLPs** — numbered list, one-line gloss each; mark which are in `foundation/` and which are in `current/` (in-flight — its guidance may still move)
- **Active constraints** — bullets, each citing `LLP NNNN#anchor`
- **Relevant rationale** — the *why*, same citation form
- **Open questions / risks** for this area
- **Likely doc updates** if the change lands
- **Hand-off** — one of `none | llp-adopt | llp-create | llp-review | llp-maintain`

## Hand-offs

- No corpus (no `llp/` walking up from the path in scope) → `llp-adopt`.
- The task needs a decision no LLP covers → `llp-create` (or `llp-review` if proposal-shaped).
- An `@ref` target or anchor doesn't resolve → `llp-maintain`.

exec
/bin/bash -lc "rg -n 'exact_write_authority|stable.*require|containment' snapback4/crates/snapback4/src/release_bridge.rs" in /home/ccheever/projects/sb4-b27-rel
 exited 2 in 0ms:
rg: snapback4/crates/snapback4/src/release_bridge.rs: IO error for operation on snapback4/crates/snapback4/src/release_bridge.rs: No such file or directory (os error 2)

exec
/bin/bash -lc 'cat snapback4/NOT-DOING.md rules/RULES.md; tail -70 snapback4/JOURNAL.md' in /home/ccheever/projects/sb4-b27-rel
 succeeded in 0ms:
# What Snapback 4 Does Not Do

Longer than the doing-list on purpose. Moving something off it means writing one
line naming what it unblocks and taking something off the doing-list in the same
change. Nothing comes off during slice one (LLP 3000 §3: the clock is four weeks).

## The bars

The bakeoff gates in [LLP 3000 §3](../llp/3000-snapback4.explainer.md) are the
bars: the loop bar, hub acquisition within 2× the measured floor, client bytes
under the competitor-anchored budgets, the six scenarios green in the simulator
on the hub fixture. Everything not required to pass them does not exist yet.

## Not building

- **A second authoring language.** Quarry, one spelling, copied from Snapback 2 (LLP 1004, LLP 1007 §4b). TypeScript is for seeds, journeys, effect bodies and the client.
- **Byte- and step-priced certification.** No closure, heap, output or step ceilings at `check`; the certificate certifies shape, uniformity, completeness class and prediction eligibility. Resources are metered at runtime (LLP 2000.000 §6).
- **A device per-query result cache.** No range receipts, halos, absence evidence, coverage spans, extent facts, held directories, fact integrity or swap journals. The client replicates declared partitions with one watermark each (LLP 2000.000 §7). The server's narrow Postgres revision-equality cache and explicitly clock-qualified G6 read grant are the exceptions below; cross-revision promotion remains excluded.
- **Engine-minted ids for client inserts, grants, ID slices.** Ids are client-minted, time-ordered, 128-bit; the engine mints for its own writes.
- **The `drain` protocol, follower-tab inbox rows, `defineItems`, `withHistory`, `mutationTarget`, `receipt.source`, `local.caughtUp`, `partial` reason codes.** The card (`packages/snapback4/src/contract.ts`) is the whole client vocabulary; `why` carries the rest.
- **`retain` as a receipt rule.** `until-revoked` and `delivered-history` survive as the client's leave policy on a scope tombstone.
- **JavaScript in the data plane.** Queries and mutations run in the Rust interpreter inside the SQLite transaction, and in the same interpreter on the client (host decided at week 3 by measurement, LLP 2000.000 §9). A *job* may be the app's own Rust, hosted as wasm through the interpreter's operations under the job's meter (LLP 3000.005, the Moves line below); a query or mutation may not.
- **An embedded JS engine for effects.** The data plane never calls out. `emit` writes the effect durably in the mutation's commit and an external worker holding a service token claims, performs and settles it over the wire (`snapback4/worker`); the four reference effects run on the builder's Node (LLP 2000.000 §10, decided 2026-09-13).
- **Committed generated code; an auth mode; a supervised bundler.** As Snapback 2 (`rules/NOT-DOING.md`): types by inference, personas not modes, `SNAPBACK_URL` is the client contract.
- **A TypeScript twin of the interpreter.** Retired by the author's ruling of 2026-09-13 (LLP 3000 §7): one implementation, in Rust, on every host — the core's SQLite under the native module, memory under wasm on the web with the host persisting each commit's changes. The web pays 312,924 B gzip before the diet where the twin's tier paid 16,842; the conformance obligation between two interpreters ends. Expo Go runs the online tier.
- **More than one hosted target, an admin console, media transcoding or thumbnails, push delivery itself (a worker's), cron syntax beyond `every N at HH:MM`, vector or relevance-ranked search (word-prefix search is in: `words(..)` and `matching`), federation, multi-region, device-to-device sync, at-rest encryption claims.** After the clock, on evidence.
- **General observability beyond `why`, `trace`, `logs`, `data`, `sql`, server operation latency, and bounded client subscription inspection.** The `sql` verb is read-only inspection of the developer's own store (LLP 3000.007 §8.8), never an application surface. Separately declared application SQL reads are admitted for increment D (LLP 3000.009 §6.2, §14.4; the 2026-09-16 Moves line below), not implemented by this inspection verb.
- **A guide corpus.** The compiler's facts, one language card and keyword cards, as Snapback 2; no freshness dates. Every card's Quarry is compiled by the suite and the language card is run, so a card cannot promise a form the parser refuses.

- **Partial union delivery, two group audiences, a public branch.** A union syncs principal-column branches and at most one group branch, each a whole disjunct of the read rule (LLP 3000.036.000.000); a branch with an extra condition, a second group or a `public` branch is refused with the rewrite, never partially delivered; service grants add no device audience (LLP 3000.007 §20.6). A union does not combine with delivered history, read-through children, synced or row-keyed views, owner keys, timelines, private field owners, acquisition windows or direct/inherited expiry on content or membership scopes.
- **Exact horizon maintenance.** The horizon bounds acquisition (a snapshot, a bootstrap); the log never evicts or back-fills to hold a device's group at exactly N rows. A local read past the acquired horizon by key says `complete: false`.

- **Clock expressions in rules.** A read rule compares with `=` and `!=` only; `.expiresAt > now` remains a mutation `require`. Stored lifetimes use `not before .col` for server-controlled opening and `expire at .col` for expiry. The engine publishes opening commits; devices receive no unopened payload. The supported compositions and explicit exclusions are in LLP 3000.036.003.
- **A jobs framework.** No priorities, worker pools or dead letters: one FIFO of runs, one chunk at a time, a refused chunk parked with its refusal. Actions, effects and scheduled actions carry per-operation retries, deadlines and cancellation, and a record per external step (LLP 3000.009 §5.2; the Moves line below). Missed period boundaries while a server is down fire once on return, not once per missed period.
- **Asset processing.** No transcoding, thumbnails, rungs or HEIC: the bytes are served as uploaded; JPEG, PNG, WebP and MP4 only; image dimensions and optional MP4 duration read from the header; MP4 dimensions are not extracted.
- **Search beyond word prefixes.** One tokenizer (NFC, lowercase, alphanumeric words), one index shape (`scope, words(cols), order.., id`), one read (`matching`): every term a prefix of some word, the first term's words merged as lanes, bounded by the meter in a uniform scope, at most 32 words in an admitted non-uniform scope. No stemming, no ranking by relevance, no phrase or mid-word matching, no per-language folding, no intersection index for the second term (it filters the page).
- **An identity provider.** Guests, password accounts, service seats, and sessions a service mints for accounts the application authenticated itself. No phone, OAuth, magic links or MFA in the engine: an application's worker verifies those and mints the session.
- **No multi-server presence, no presence history or last-seen storage, no broadcast event stream, no connection-bound rows.** `connected[p]` stays server-wide, counting held polls and their 35 s grace; a live query that may read it re-runs in the background about every 5 seconds to stay current (LLP 3000.018). Typing and viewing use short-lived, authorized ephemeral tables in one server process (LLP 3000.017); they never sync or decide durable invariants. A device does not know presence and says so.

## Process not doing

- **2026-09-28 — ordinary mixed search** (LLP 3000.028 §3.3, lane OS round 1).
  Admit the SDK's bounded merge of current server rows and certified Left images
  for the proved single time-ordered word page. This removes application-owned
  online/held selection for that shape. One server call per requested page;
  recomputation pays again from consumed positions. The coordinator shares the
  existing device read allowance. No durable search session, extra synced rows,
  new authority or additional allowance is admitted.

- **2026-09-28 — inferred current-scope word search** (LLP 3000.028 §3.3,
  lane OS). A single bare ordinary word page may derive the exact non-expiring
  membership audience for the existing compact server plan. This removes the
  requirement to repeat that audience predicate in this narrow server query.
  The compiler supplies a scoped words index when absent; it is an ordinary
  schema index, maintained on writes and on devices, with no extra synced rows
  or new authority. The device keeps its original bare scan. Round 0 left ordered composition
  and combined accounting outside its independent subset; round 1 above admits
  that bounded SDK composition. Durable search sessions remain excluded.
- **2026-10-12 — union sync audiences** (LLP 3000.036.000.000, workstream UNION, two blind review rounds). A table syncs to the union of principal-column audiences and one group audience; a device holds a row while any branch admits its viewer. What it unblocks: owner-or-team, buyer-or-seller and owner-or-staff tables offline for every reader, the shape three app farms asked for. Taken off: "one `sync` audience per table". Partial delivery, two groups and a public branch stay excluded (above).
- **2026-09-28 — explicit owner-key coverage** (LLP 3000.028 §3.4, Lane OK commission). A public window may opt into a compiler-owned, horizon-free principal key partition to answer ordinary own-key existence offline. Taken off: the exclusion of narrower platform key distribution beside one public window. General union audiences, full own-row replication and per-query absence caches remain excluded. The projection uses existing metered maintains, adoption and whole-partition publication; existing windows do not expand.
- **2026-09-26 — a live query keeps presence current** (LLP 3000.018). A 0.4.2 probe found an observed `connected[p]` reporting `fresh: true` while stale for over a minute, and a comparative builder polled around it. What it unblocks: online marks and presence-aware lists that stay current. Taken off: "a presence stream" as an exclusion for live queries; a presence API, last-seen storage and multi-server presence stay out. Under the author's standing authorization for reworks that make queries excellent (2026-09-25).

- **No drift registries, inventories, line-pinned diagnostics registries, claim digests or frozen-record gates.** Generated projections are built, not committed.
- **No gate bound to an exact commit; no push gated on a battery.** Five blocking checks in sixty seconds, run before push; everything slower on a schedule with bounded tickets.
- **No ceiling raised in slice one.** Budgets are anchored to a competitor's measured number and recorded once in the journal.
- **No standing panel** except the two blind reviews LLP 3000 decision 4 names (partition inversion; the meter's cut on non-uniform scans). The author explicitly commissioned the one-off LLP 3000.008 panel and disjoint Astra implementation lanes on 2026-09-14; its bounded disposition is recorded in that umbrella and LLP 3000 §7.
- **No new LLP number** without first extending LLP 3000 or LLP 2000.000; no spec without running code (`rules/RULES.md`: only implemented specs bind).
- **No second session on the core** during slice one; lanes take the periphery.
- **No test matrix as the primary harness.** The simulator is; real-browser and device witnesses cover only what it cannot reach.
- **No files over 1,500 lines**, including ones copied from Snapback 2. Split on
  the way in. The one exception is the package's published documents
  (`packages/snapback4/README.md` and its linked references): the rule exists to
  keep a *source* file reviewable, and the 0.2.25 calibration measured the cost of
  applying it to a document — splitting the README was that run's single largest
  scoring loss, because the builder then had four places to look instead of one
  (LLP 3000.007 §20.19). A published document is bounded by whether a builder can
  find one way in, not by a line count; the census that enforces this rule covers
  source, and says so.

## Deliberately worse

- No compatibility with Snapback 1 or Snapback 2 apps, packages or on-disk formats.
- No API stability before the clock; every publish is `0.0.x`.
- Sparse prose documentation; the diagnostics and the recipes carry the load.
- One hosted target, one platform binary at a time. SQLite remains the default store; Postgres deploy/serve admits the initial Unix-socket HTTP profile under LLP 3000.009.001 (Moves, 2026-10-20; `guide release-json`). Provider HA, full parity and publication remain outside that profile.

## Moves

- **2026-10-24 — a bounded server read grant moves onto the doing-list** (author's G6 commission, LLP 3000.009.001.000.002 §4.2). It unblocks zero-flight Postgres hits after G5's measured validation CPU limit. Taken off the doing-list: mandatory per-hit database validation for the explicitly qualified, single-owner Linux deployment. Unqualified clocks/failover and lost/uncertain epochs use G5; device result caches and cross-revision promotion remain excluded.

- **2026-10-24 — Postgres server revision-equality read reuse** (LLP
  3000.009.001.000.002 §4/§6 G5). This removes repeated interpretation and
  data decoding for eligible pure queries at an unchanged durable revision.
  Taken off: the blanket server result-cache exclusion. Every reuse still
  validates fresh authority, revision and code in one database statement;
  SQLite stays on ordinary reads because it has no complete revision stream.
  Device caches, dependency promotion, retained authority and zero-flight
  grants stay excluded. Operator-local counters add no HTTP or authoring API.

- **2026-10-20 — Snapback 4 on Postgres moves onto the doing-list** (author: "commit and push these things, then do your \"what i'd do next\" things, then get this working on postgres and measure it"; LLP 3000.009.001 and its children). Unblocks: the store-port extraction on SQLite (P0, including the `Committer` seam with the serial batch); the Postgres adapters for every durable-state family and `serve`/`deploy`/`doctor` over Postgres (P1), with store-held fencing, the declared HA mode and `BlobStore`; the optimistic committer, commissioned on 2026-10-19 and built after its execution stage is sized; the scale program of LLP 3000.009.001.002 with its raw-Postgres, Supabase and Convex controls on fleet machines; and a research note comparing replicated SQLite with Postgres for applications that outgrow one SQLite file. Taken off in the same change: the evaluation-only framing of the Postgres adapter. Stands: no publication or managed-service deployment authority, no lowering of Quarry to SQL, no SQL writes to managed data, one core owner. Several serving processes (P2), log retention, live graduation (LLP 3000.009.001.001) and the async-safe external anchor each wait for their own Moves line.

- **2026-10-13 — stored lower lifetimes (`not before`) are commissioned by PAGE2** (LLP 3000.036.003). This unblocks timed disclosure without an application publication job. Per-application jobs that flip a publication flag leave this admitted path; clock expressions in rules, captured lower lifetimes for read-through children, and boundary recounts for maintained data remain excluded. HS owns handshake transport; PAGE2 declares the new semantic capability.

- **2026-10-06 — exact Following history (FH delegated round-1 ruling).**
  Admit a Following-specific server traversal and bounded volatile frontier/replay
  state under LLP 3000.026 §9. The approved design reads exact history online
  from the first page; the SDK will own continuation. The first milestone is internal event metadata
  and the oracle, with no public completeness claim. Taken off: a blanket ban on
  state for this one expiring read. General result caches, resumable queries,
  device traversal, inbox coverage certificates and history-only blocks remain
  excluded. Existing inbox bytes and runtime ceilings remain unchanged.

- **2026-09-26 — server operation latency (LLP 3000.019 §3.7).** Calibration #22
  measured each read once and could not claim repeated p95/degradation testing.
  Unblocks percentile measurements of the application's own load without a
  custom timing harness. Taken off: a latency harness written by the builder;
  general metrics, tracing infrastructure and an admin console remain excluded.

- **2026-09-23 — Quarry states intent moves onto the doing-list** (Charlie:
  "if you need to try making *significant* architectural reworks in order to
  make the data modeling, queries, and scalability be excellent and elegant,
  you can experiment with that"; LLP 3000.013). Unblocks reads that state
  predicates and order, one `view` declaration for derived data, Following
  without caps, jobs and aggregates without author-chosen bounds, an app
  object and an offline web shell. Taken off: index names and author-chosen
  engine numbers on the paved path; the timeline's promotion, pull routes and
  caps; the "Time in rules" refusal is unchanged. Stands: one interpreter, no
  JavaScript in the data plane, no lowering Quarry to SQL, no relevance-ranked
  search.

- **2026-09-16 — the remaining general-purpose program moves onto the doing-list**
  (Charlie: "complete everything ... we'll remove services when we are done
  with the workroom test rather than wait to add them in ... use the fleet";
  LLP 3000.009 §14.7). Unblocks the §7 integrated-service baseline, C3 production
  Postgres, D's authorized database capabilities and measurement-led C2/E
  work while Workroom continues. Taken off: waiting for Workroom before
  starting services, and keeping production Postgres integration outside the
  current implementation program. The completed Workroom record drives a
  retain/remove pass. Stands: one interpreter and managed writer, no managed
  SQL writes, no JavaScript transactions, no SQL in the first Workroom cell,
  no invented performance/real-provider evidence, no expo-build-1000 load,
  and no new publication or managed-service deployment authority.

- **2026-09-16 — application SQL reads move onto the doing-list** (Charlie: "admit application SQL reads"; LLP 3000.009 §6.2, §14.4, increment D). Unblocks reporting and search over authorized projection inputs and declared database-owned tables, with authorization before selection, ordering and limits. Taken off in the same change: the inspection-only exclusion for application SQL and D's pending-author gate. Implementation and qualification remain pending; SQLite and Postgres halves ship together, channels follow candidates, and A1–A3 plus the fixture pack stay first. Stands: no SQL writes into managed data, no lowering Quarry to SQL, no SQL in the first Snapback brief cell, and no publication authorization.

- **2026-09-15 — a Postgres evaluation backend moves onto the doing-list** (author: "Build the evaluation prototype"). Unblocks concrete evaluation of storage agnosticism, interpreter/database round trips and transactional sync ordering. This bounded prototype replaces full CLI/deployment integration as the next backend task; those product surfaces remain off this increment's doing-list. It shares Quarry, rules, maintains and partition logic, but uses an experimental Postgres store. Native SQL exists only as an explicitly separate comparison workload, not an application escape hatch. SQLite remains the production and local-device store. See [the experiment](./experiments/postgres/README.md).

- **2026-09-15 — the server half of LLP 3000.009 moves onto the doing-list** (author: "begin implementation using astra xhigh to code"; LLP 3000.009 §10.2, increments A1–A3). Unblocks the online-only brief's invitation, webhook and scheduled journeys without a second application server: work records whose authority is bound at admission, ids bound to their operation and arguments, declared action results, a generated handler context with a durable record per external step, declared routes and webhooks, scheduled actions under service seats, and `serve` supervising the runtime. Taken off in the same change: "A jobs framework" narrows — actions, effects and scheduled actions get per-operation retries, deadlines and cancellation; priorities, worker pools and dead letters stay out — and the actions card's "supervise the worker as an ordinary Node process" leaves. Stands: no JavaScript in the data plane, no identity provider in the engine, and no `ctx.sql`, projections or SQL reads in this increment.

- **2026-09-15 — the Postgres access boundary moves onto the doing-list** (LLP 3000.009 §10.2, increment C1). Unblocks measuring Postgres behind a batched access boundary instead of row-at-a-time calls: transaction-scoped prefetch, a pipelined commit tail, one portable index-key bound checked on both stores, and the corpus, conformance and device suites on both stores. Taken off in the same change: the evaluation prototype's single-adapter framing, in which the only next step was an unbatched store. Stands: Postgres is not a hosted or deployable target; its refusals of assets, jobs, actions and schedules, and `serve`, `deploy` and backup on Postgres, wait for increment C3.

- **2026-09-13 — word search, effects, service seats and presence move onto the doing-list** (author: "add all the things we need for Clique and Interview"; the full-brief Clique record's remaining capability lines and Interview's adapter responsibilities). What it unblocks: Clique M5's three search scopes online and offline on one index, M6's push seam without connection leases hand-built in tables, M8's digest emitted rather than logged into a table, Interview's phone sign-in and model workers as a service that mints sessions instead of proxying every request, and the ranked feed of LLP 3000.004 on the `feeds` card. Taken off in the same change: "an embedded JS engine for effects, until measured" (the engine never calls out; a worker does), "word search" from the package's exclusions. Stands: no JavaScript in the data plane, no relevance ranking, no identity provider in the engine.
- **2026-09-12 — expiry, assets and jobs move onto the doing-list** (author: "complete snapback4 to the point where the entire clique benchmark can be run"). What it unblocks: the struck half of the Clique brief (M4 media, M5 view-once and expiry with no client open, M8's scheduled digest). Taken off in the same change: the "one photo path" and "cron syntax" exclusions above narrow to transcoding and to cron beyond `every N [at HH:MM]`; the "time in rules" exclusion stands, answered by `expire at .col` rather than a rule.
- **2026-09-13 — native jobs on (author: "write up an LLP about this and then implement").** Unblocks the scoring half of a feed — floats, vectors, real loops, a typed schema — without putting any of it into Quarry, and gives the model half of LLP 3000.004 a seat inside the bounds: one chunk per commit, the job ceilings, fuel, no I/O. Off the doing-list in the same change: the "external ranker with a service seat" of LLP 3000.004 §6.5 is no longer the only shape for compute over the store; it remains the shape for the network. Ranked and vector search, effects execution and an embedded JS engine stay above.
- **2026-09-13 — `sql`, a fifth named observability verb, moves onto the doing-list** (author ruling on LLP 3000.007 §14.10). Read-only SQL over generated per-table views of the developer's own store, under `dev` or against a `--release` directory; never rule-filtered, never an application surface. What it unblocks: the ground truth two Clique essays said Snapback lacked beside Postgres ("there is no underlying Postgres to query"), and the inspection the 0.2.6 Astra lane did by copying its SQLite file. Taken off in the same change: SQL reads as an application query surface (LLP 3000.007 §9.1) leave the doing-list until the reporting gap is measured after the language relaxations; reporting is Quarry's, inspection is `sql`'s. Stands: no JavaScript in the data plane, one authoring language.

- **2026-09-14 — the simulator witness is published for app builders (LLP 3000.007 §20.10, S30).** Unblocks native offline proof artifacts; replaces the repository-only Metro witness on the doing-list. Real-browser and device witnesses still cover only what the deterministic simulator cannot reach.

- **2026-09-14 — development clock control (S27, calibration F5)** moves onto the doing-list to unblock expiry and scheduled-digest tests without real-minute waits or backdated seeds; waiting on real time leaves the development test path, while production clock controls stay off the doing-list.

- **2026-09-25 — ephemeral tables enact the standing realtime line of LLP 3000.009 §12 (LLP 3000.017).** Unblocks typing and viewing without durable outbox traffic. Nothing leaves the doing-list: this enacts an already admitted scope. Last-seen storage, multi-server presence, a separate presence stream and ephemeral authority over durable invariants remain excluded.

- **2026-09-30 — bounded client subscription inspection (author's PR round-0 task)**
  moves onto the doing-list: query-group queue/in-flight/withdrawal counts and
  bounded latency/cause samples explain mounted screens flashing empty. Taken off
  the doing-list: builders must reconstruct this pressure from ad-hoc console
  instrumentation. General observability beyond the named verbs remains excluded;
  there is no telemetry transport or server admin console (LLP 3000.023 §10).
# Rules

**Snapback 2 optimizes the edit-to-verified loop — the agent's building an app on it, and ours building it.**

Speed is the constraint. Everything below exists to keep the edit-to-verified loop short
and to stop this repository accreting apparatus faster than anyone can remove it. These
rules bind `snapback2/` and the LLPs numbered 1000 and up; Snapback 1 is baselined, not
exempt, and its numbers may only fall.

Each rule is **[check]** (enforced by `caps`) or **[review]** (enforced by a human).

## Budgets — every budget is a trade, not a limit

- **5 blocking checks, 60s total.** A sixth requires deleting one, in the same PR. **[check]**
- **59 documents in the working set** (`llp/current/`). Today's count. A 60th requires
  archiving one — which is just removing the link. Snapback 2 aims to leave this at 15;
  Snapback 1's links are archived at promotion. **[check]**
- **12 documents in the foundation** (`llp/foundation/`). **[check]**
- **This file: 700 words.** If it grows, something becomes a check or stops being a rule. **[check]**
- **1,500 lines per source file, baseline 204.** Generated files exempt — and generated
  files are built, not committed; so are benchmark run records under `benchmarks/runs/`,
  which are evidence, not source. The baseline is Snapback 1's oversize count on the day
  the rule landed; it may not grow, and `snapback2/` contributes zero to it. **[check]**

## Blocking checks

`caps` · `ref-check` · `snapback2/scripts/test.sh` · `snapback2/scripts/measure.mjs --check` · `check-inventories`

## Loop shape

- **Every check reports all failures in one run.** Fail-fast is banned. **[check]**
- **Nothing blocks on anything slower than 60 seconds.** Slow verification runs on a
  schedule, attributed to the breaking commit, and files a bounded set of issues. **[review]**
- **Fix loops get 3 rounds.** Then stop: escalate to a human or descope. **[review]**

## Time budgets

Tracked every run of `snapback2/scripts/measure.mjs` (appends `snapback2/metrics/loop.jsonl`).
A regression is a P0 with a name on it.

| | budget |
|---|---|
| Incremental rebuild after a one-line edit | 15s |
| Test what you just changed | 30s |
| Blocking gate suite | 60s |
| Full build, warm cache | 5 min |
| **`snapback2 check` on a program (the agent's product latency)** | **1s** |
| **`snapback2 doctor` boot-to-ready** | **0.5s** |

## Scope

- **`NOT-DOING.md` is binding.** Moving something onto the doing-list means writing why
  and taking something off. **[review]**
- **Delete; don't deprecate.** No compat shims or migration paths before promotion. **[review]**
- **Nothing is compiled, transpiled, or generated at runtime that could be built ahead of
  time.** **[review]**
- **A spec needs an implementer and a date, or it isn't written.** **[review]**
- **Only implemented specs bind.** A document with no running code behind it is a
  proposal, and a proposal cannot block a PR or justify a check. **[review]**

## Agents

- **Agents remove apparatus freely and add none.** An agent PR that adds a check, script,
  registry, config file, or design doc needs explicit human approval saying so. **[review]**
- **2026-09-06 session exception:** the user delegated the search implementation
  decisions; one `snapback2-core/build.rs` may generate pinned Unicode tables at
  build time, alongside the existing package build. No new gate, registry,
  runtime generator, or Unicode dependency is authorized by this exception. **[review]**
- **Snapback 2 LLPs are numbered 1000 and up**; `llp-create` must be told. **[review]**
- **Snapback 4 LLPs are numbered 3000 and up** (`snapback4/`, LLP 3000); it adopts these budgets
  and loop shape as its own and keeps its scope in `snapback4/NOT-DOING.md`. **[review]**

## Shared machines

- Warm, named lanes, one per stream of work. Never clone fresh; reuse the worktree.
- **Never `git stash`.** Use a temporary commit.
- Kill only PIDs you recorded at launch. Never by name or pattern.
ownership-lease traffic, tied to store/holder/token/epoch; every current foreign
claim checks its expiry after the conflicting owner claim and before any
termination. Renewal follows the same lock order, independently of publication;
graceful release stops/drains cache reads before shortening the exact epoch.
Startup refuses enabling a grant after an owned handle has opened.

The explicit Linux deployment setting
`SNAPBACK4_READ_GRANT_CLOCK_BOUNDS=rate_ppm,forward_jump_ms` declares the rate and
cumulative forward-jump guarantee needed for a suspend-aware CLOCK_BOOTTIME
deadline. It is an assumption, not inferred from empirical timing. Unset stays
on G5; an invalid/unsupported explicit setting refuses startup. Arbitrary jumps,
mixed old writer versions and unqualified failover require leaving it unset.
The safe rustix clock dependency preserves the core's unsafe-code prohibition;
the main, evaluator and seed lockfiles retain its qualified dependency pins.

A G6 hit takes one gate read, checks live grant/epoch and exact published
revision/code/store/generation, resolves retained ordinary authority facts with
a fresh service clock, and rechecks the grant before returning at that head.
The physical committer closes the gate before COMMIT and installs publication
only on confirmation. Known rollback retains the old publication; uncertainty
keeps reuse closed and pauses writer admission/execution until fenced
reacquisition with a fresh process/epoch. Candidate waits are bounded to one
second before G5 fallback; ordinary misses capture fill epochs without waiting.
Every local commit invalidates equality. SQLite remains ordinary.

Retained authority and pre-encoded Plain JSON data share the existing bounded
cache retention budget. The temporary encoder is bounded by its fill reservation,
including JSON escaping. HTTP reuses those data bytes while retaining ordinary
worker permits, framing, limits, deadlines, envelope metadata and logical meters.
Initial qualification passes core 1,170/0 with five ignored across 49 targets,
binary 588/0 with 50 ignored, the three HTTP RT0 cases 3/0, the complete cache
suite 31/0, and the clock-window unit 1/0. G6 W1/W2/W3 is 0/0/0 flights, including
the first admitted hit; G5/miss and SQLite ratchets remain unchanged. The
[report](reports/20261024-g6/REPORT.md) carries the final negative controls,
complete Postgres qualification, release measurements and process custody.


Final G6 qualification: the cache suite passes **32/0**, clock window **1/0**,
and mixed-harness schedule/ratio tests **2/0**. The complete Postgres script
runs every stage, with **753/2** across 35 Rust targets and a passing public
serving milestone. Its reds are the inherited evaluator `40001` and a non-timing
stale-token fixture whose unrenewed 300 ms lease expired during cold setup.
That fixture now uses 30 seconds, preserving explicit release and all fencing/
replay assertions; the complete affected ownership suite passes **25/0**. Only
`40001` remains unresolved. The whole script is not relabeled as a clean rerun.
Main, evaluator, seed and commit-path consumer locks retain the new dependency
pins; locked checks/metadata pass. Root ref-check passes with zero errors or
unchecked references. Seven restored runtime negative controls each fail 0/1,
including a real deferred COMMIT gap and a parked old reader after successor
revocation. An already-admitted writer also releases its fence when the uncertain
gate refuses before physical COMMIT dispatch.

Release measurements use the declared `1000,250` clock bounds. At C128 loopback,
W2/W3 rise **10,786/10,672 → 27,347/27,757 reads/s**. The S1-shaped pinned split
rises **9,330/8,764 → 18,887/20,797**, clearing both 16k bars. Pinned server
CPU/read falls **244.4/211.1 → 187.1/178.5 µs**, PG **630.0/682.1 → 101.2/56.1**.
All 25 windows have zero errors, valid process counters and at most 0.112 other
CPU core during measurement; the longest quiet-gate wait is 149.45 seconds.
The unchanged 448 MiB retention cap now causes evictions, reducing C128 W2's
hit rate to 84.44%; W3 is 97.04%. One percent unrelated writes reduces W3 to
**5,095 reads/s**, 92.32% misses, **16.744%** gate closure and **166.93 µs**
candidate wait/read. Successful G6-hit stall is zero in all measured windows;
one hit outside them waits 131.859 µs. No delayed-link or HA claim is made.

The disk guard stops one build at 39.9827 GiB; owned descendants are confirmed
gone before reclaiming this worktree's inactive targets and resuming with
incremental compilation disabled. Both private PG16 masters (**312515** and
**789152**) are stopped and independently confirmed (status 3, no pidfile or
process). The recorded PID/start audit finds no active process or zombie.
No PIDs remain; no push, stash, Git config, q24 or shared PG17 change occurs.

exec
/bin/bash -lc "head -100 llp/3000-snapback4.explainer.md; head -70 llp/2000.000-keep-the-core-flip-two-substrates.rfc.md; rg -n 'Wave-27 release semantics|@ref' snapback4/crates/snapback4/src/release_bridge.rs llp/3000*" in /home/ccheever/projects/sb4-b27-rel
 exited 2 in 0ms:
# LLP 3000: Snapback 4 — the decided-substrates candidate

**Type:** Explainer
**Status:** Active
**Role:** Root of the Snapback 4 corpus (LLPs 3000 and up)
**Systems:** Everything under `snapback4/` once it exists; the bakeoff protocol shared with Snapback 3 (LLP 2000) and Snapback 2 (LLP 1000)
**Author:** Charlie Cheever / Claude Fable 5.1
**Date:** 2026-09-12
**Revised:** 2026-10-24 (RCPU bounded short-queue capacity); 2026-10-23 (§7: G4a bounded short admission, current worker/queue constants and original deadlines); 2026-10-23 (author view-once start-time contract, §7); 2026-10-22 (K0-Q fix round 1: reserve view-once consumption before byte delivery under bounded committer admission); 2026-10-13 (FLAKE: isolate real-timer client fixtures and keep quote layout pooled); 2026-10-13 (§7: timed-out compiler-group inspector retries within the unchanged drain deadline); 2026-10-12 (§7: a reference declares what deleting its row does, LLP 3000.039); 2026-10-12 (§7: `file` assets, LLP 3000.038); 2026-10-08 (§7: S3 long-wait capacity — sized viewer and claim pools, per-principal share, `E_STREAMS`, shared change answers, per-ticket engine wakeups); 2026-10-08 (§7: FL asynchronous initial identity capture and independent owned cleanup); 2026-10-07 (§7: FL fault dispatch checks exact birth and command); 2026-10-06 (§7: PD stale-enumeration regression distinguishes Darwin identity rereads); 2026-10-06 (§7: PS Round 2 asynchronous inspection and completed-snapshot cleanup deadlines); 2026-10-05 (§7: PW immutable browser fixtures and navigation diagnostics); 2026-10-04 (§7: NZ integration, bounded release-command diagnostic drain); 2026-10-04 (§7: LU round 2, adaptive delivery lookahead and repayment of empty-kind CPU); 2026-10-04 (§7: QF2 bounded fresh snapshots for exiting routing anomalies); 2026-10-04 (§7: LU round 1, durable pending-item share under continuing arrivals); 2026-10-03 (§7: LU rotates bounded Following turns between pending items); 2026-10-03 (§7: QF Round 9, fresh Darwin identity reads retain file scope); 2026-10-03 (§7: QF Round 8, signed ps UIDs and ownership-scoped metadata validation); 2026-10-03 (§7: QF Round 6, process-group-only custody and Node result semantics); 2026-10-03 (§7: QF Round 4, vanished PIDs are exited; retain exact malformed metadata and the first error); 2026-10-03 (§7: QF Round 3, unreadable candidates are diagnostic-only on shared hosts); 2026-10-03 (§7: QF round 2 and Grok follow-up, group/session/token custody and a subtest-progress watchdog); 2026-10-02 (§7: QF round 1, retained process groups, fail-closed inspection and guard-aware file caps); 2026-10-02 (§7: QF fixture admission barriers and independent test-file watchdog); 2026-10-03 (§7: DR bounded startup banner ordering); 2026-10-02 (§7: FDL round 2, server-based doctor remediation and UDP probe initialization); 2026-10-02 (§7: FDL round 1, paced descriptor exhaustion, effective limits and scoped runtime evidence); 2026-10-02 (§7: FDL descriptor startup policy and fallible HTTP clones); 2026-10-02 (CT round 4: ordinary-priority engine holders, gate-free admission, paced bulk and recount budgets); 2026-10-02 (§7: CT round 3, ordinary timing work and aged bulk progress); 2026-10-02 (§7: CT round 2, partial-exit refusal, scoped QoS evidence and maintenance-aware qualification); 2026-10-02 (§7: CT round 1, intake/child QoS, inline comparison and mixed qualification); 2026-09-30 (§7: idle HTTP leases and one proven reused-socket retry, KA round 0); 2026-09-30 (§7: independent witness watchdog, expiry wakeup oracle and aggregate model guards, SL round 1); 2026-09-30 (§7: independent process-diagnostic records in loaded tests); 2026-09-29 (§7: publication-suite semantics under host contention); 2026-09-29 (§7: AV round 3 preserves completed asset bytes across same-principal rotation); 2026-09-29 (§7: CPU-aware publication suite and Cargo test warm-up, Lane MT); 2026-09-28 (§7: FU round 5, overload scope restored; refresh custody deferred); 2026-09-28 (§7: FU round 4, shared rotation custody and visible polling refusals); 2026-09-28 (§7: FU round 3, startup refresh outcome and malformed ephemeral replies); 2026-09-28 (§7: FU round 2, complete client refusal and ambiguous-retry audit); 2026-09-28 (§7: FU round 1, overload accounting and safe reporting/retries); 2026-09-28 (§7: HTTP overload diagnostics, Lane FU); 2026-09-28 (§7: explicit sync observes a round begun after its call); 2026-09-26 (§7: 0.4.4, what calibration #21's builder still wrote and what calibration #22 charged); 2026-09-26 (§7: release only the matching asset home; restore scalar receipts); 2026-09-26 (§7: bounded asset lists share scalar placement and declared ledger allowances); 2026-09-26 (§7: 0.4.3, receipts in one query and presence that stays current); 2026-09-25 (§7: 0.4.2 merged into the LLP 3000.015 baseline under one authorization law); 2026-09-25 (§7: 0.4.2, what calibration #20 and the comparatives found); 2026-09-25 (§7: restored authorization walk bound, LLP 3000.015); 2026-09-24 (§7: 0.4.1, what calibration #19 found); 2026-09-24 (§7: a row whose lifetime ended by its own commit's end is retired in it); 2026-09-24 (§7: Quarry states intent implemented); 2026-09-23 (§7: Quarry states intent, LLP 3000.013); 2026-09-23 (§7: logical expiry revokes only a grant once held live); 2026-09-23 (§7: a row or a grant born and undone inside one commit logs nothing); 2026-09-22 (§7: author-commissioned research on derived data after calibration #16, LLP 3000.012, with its two proposals placed under their owners, LLP 3000.007.003 and LLP 3000.009.000); 2026-09-22 (§7: author-commissioned diary synthesis, six proposal pairs and review/implementation/publication/benchmark sequence); 2026-09-18 (§7: S6's option 2 written down as S6a–c in LLP 3000.002, not commissioned); 2026-09-18 (§7: the author's four diet rulings landed — S3 guarded NFC-only, the budget ratchet, the target retired with S6 deferred, `since` on composed reads); 2026-09-17 (§7: author-requested common-application-shapes Draft in LLP 3000.007.002); 2026-09-17 (§7: S4a measured at −34,781 B gzip and stopped by the plan's rule; the diet's open decisions gathered for the author); 2026-09-17 (§7: S1b landed — serde's content reader out of the web device, the suite census that refuses what selects it; five Grok review records corrected); 2026-09-17 (§7: the diet's reachability rung landed with the web admission trust boundary stated; one `untagged` attribute on `main` measured at 33,460 B gzip and a repair lane commissioned); 2026-09-17 (§7: the device diet's first rungs landed; S2 measured and shelved; the ladder restated to end near 300,000 B gzip); 2026-09-17 (§7: retained-read composition landed; a program-only generation losing left history found and ticketed); 2026-09-17 (§7: five author-requested review proposals in covering LLPs); 2026-09-17 (§7: the device diet and retained-read composition plans rewritten from measurements and commissioned); 2026-09-16 (§7: author-requested planning for the device diet and mixed retained reads); 2026-09-16 (§7: W8c adoption health and default dev meters); 2026-09-15 (§7: LLP 3000.009's panel and disposition; increments A1–A3 and C1 on the doing-list); 2026-09-15 (§7: LLP 3000.009 accepted in direction — the brief, both deployment targets, the panel and implementation); 2026-09-15 (§7: LLP 3000.009 rewritten after a directional review); 2026-09-15 (§7: author-commissioned Draft general-purpose backend architecture); 2026-09-15 (§7: author-commissioned Postgres evaluation prototype); 2026-09-15 (§7: signal-line framing; the full 0.2.10 cell and qualified SQL recommendation); 2026-09-14 (§7: .008 panel and delegated residual program); 2026-09-14 (§7: borrowed sync replies, bounded HTTP query reader reuse and signal-stack diagnostics); 2026-09-13 (§7: ruling 15 — LLP 3000.007 §8.7 and §5.9 as revised are built); 2026-09-13 (§7: LLP 3000.007 accepted as ruled — every §14 question; the blind review of write authority commissioned; `sql` a fifth verb); 2026-09-13 (§7: the first ruling on LLP 3000.007 — the SDK media cache lands with the language); 2026-09-13 (§7: LLP 3000.007 rev 2 — pushed further after the Grok and Muse lanes; LLP 3000.006 absorbed and superseded); 2026-09-13 (§7: relaxed Quarry and explicit residency proposed in LLP 3000.007); 2026-09-13 (§7: explicit data residency and server execution proposed in LLP 3000.006); 2026-09-13 (§7: qualified packaged SQLite page-cache policy); 2026-09-13 (ticket repair qualification: logical device expiry and generation-bound native cache); 2026-09-13 (§7: SQLite plan reuse across bound inputs); 2026-09-13 (§7 and §9: security boundary and remediation); 2026-09-13 (§7: the device-side twin — native reads, LLP 3000.005 §9); 2026-09-13 (search, effects, services, presence, the ranked feed: §7, §8); 2026-09-13 (§7: production compiler trade); 2026-09-13 (§7: native jobs — the app's Rust in the data plane, hosted as wasm, metered like a job; §8: LLP 3000.005); 2026-09-13 (§7: the guide is compiled); 2026-09-13 (§7: explicit reference-ID semantics; remaining open-ticket corrections); 2026-09-13 (§7: borrowed query serialization, shared chat observations and HTTP worker reservation); 2026-09-13 (§9: implementation of the review corrections); 2026-09-12 (§9: architecture review and 37 correction tickets); 2026-09-13 (§7: feeds — the serving half is the substrate's, the model half is the app's; LLP 3000.004); 2026-09-13 (§7: one interpreter hosted two ways, the wasm measurement, ordered merge heads and measured performance work); 2026-09-12 (§8: the full-brief Clique record, 0.1.1–0.1.9); 2026-09-12 (§7: expiry as a lifetime, one asset one home, jobs as sweeps and schedules as boundaries; §8: 0.1.0, the whole brief); 2026-09-12 (§8: the local-first tier, H0); 2026-09-12 (§7: Quarry in Rust, one key encoding, sync forms, operation names; §8: the week-two day-one map); 2026-09-12 (§8: the week-one implementation map);  2026-09-12 (§7: toolchain, simulator host, the clock's commit); 2026-09-12 (initial: the author's decisions of 2026-09-12, the bet on one page, the bakeoff protocol, the fence, the first four weeks)
**Related:** [LLP 2000](./2000-snapback3.rfc.md) (Snapback 3, the sibling candidate), [LLP 2000.000](./2000.000-keep-the-core-flip-two-substrates.rfc.md) (the design brief this corpus builds), [LLP 1000](./1000-snapback2.explainer.md) (Snapback 2, the incumbent and the control), LLP 0000, LLP 0329, LLP 0329.014.004, LLP 0329.016, LLP 1001, LLP 1002, LLP 1012, LLP 1016, LLP 1019, LLP 1020, [LLP 1023](./1023-clique-builder-jump.rfc.md), [LLP 3000.004](./3000.004-feeds-and-the-interview-reference-app.rfc.md) (feeds; Interview as the second reference application), [LLP 3000.005](./3000.005-native-jobs.rfc.md) (native jobs), [LLP 3000.006](./3000.006-explicit-data-residency-and-server-execution.rfc.md) (explicit online-only data, execution classification and synced projections), [LLP 3000.007](./3000.007-relaxed-quarry-and-explicit-residency.rfc.md) (relaxed Quarry and explicit residency: the language's constraints re-derived under the meter), `rules/RULES.md`, `rules/NOT-DOING.md`, [`benchmarks/protocol.md`](../benchmarks/protocol.md), [`benchmarks/briefs/social-messenger.md`](../benchmarks/briefs/social-messenger.md), [`benchmarks/briefs/messaging-day2-evolution.md`](../benchmarks/briefs/messaging-day2-evolution.md)

## Summary

Snapback 4 is one of two parallel candidates for the successor to Snapback 2,
and the sibling of Snapback 3, not its successor. It builds
[LLP 2000.000](./2000.000-keep-the-core-flip-two-substrates.rfc.md) as
written: the Snapback 2 core kept verbatim, two substrates flipped up front —
resources metered at runtime instead of priced statically, and a client that
replicates the viewer's declared partition instead of caching receipted
results — proved first on the hub fixture, with a deterministic simulator as
the primary harness. Snapback 3 ([LLP 2000](./2000-snapback3.rfc.md), led by
Codex / GPT-6 Astra) keeps the same two questions open and discovers their
answers in its first slice. Snapback 2 ([LLP 1000](./1000-snapback2.explainer.md))
continues as the incumbent and the control. All three are judged by one
pre-registered comparison on one clock.

This document records the author's decisions of 2026-09-12 that created the
track, restates the bet on one page so a reader can orient without the brief,
fixes the bakeoff protocol, draws the fence, and plans the first four weeks.
The design argument and its evidence stay in LLP 2000.000. Only running code
will bind (`rules/RULES.md`).

## 1. Decisions (author, 2026-09-12)

On 2026-09-12 Charlie Cheever asked whether Claude Fable 5.1 should lead a
Snapback 4 while Codex / GPT-6 Astra leads Snapback 3 and Snapback 2
continues, "and see which one turns out best." The lead answered yes with
conditions; the author accepted them ("Sounds good") and asked for this
document. The decisions below are therefore the lead's proposal as accepted
by the author. Where the author has not separately ruled, the text says so.

1. **Three tracks, one comparison.** Snapback 2 continues as the incumbent
   and the control. Snapback 3 builds LLP 2000; Snapback 4 builds LLP
   2000.000. This is a bakeoff of *bets* — discover the substrates in the
   slice versus decide them first — not of models. The result will say more
   about the bets than about the leads, and §3 is written so that it can.
2. **The name is Snapback 4.** Siblings, not a sequence: "4" does not mean
   "after 3." A separate number gives the track its own corpus root,
   directory, package identity and data directory with no rename when the
   bakeoff resolves, and files never move in LLP. If Snapback 4 loses, it is
   a number that never shipped. "Snapback 3b" was considered and rejected:
   it reads as a variant of 3, and this is a different bet.
3. **Snapback 4 builds LLP 2000.000 as written.** Its §14 open questions are
   the lead's to decide inside the track, recorded in §7 as they are
   decided. The author rules on the bar, the comparison and promotion (§3).
4. **One owner on the core.** The lead writes the engine, the store and the
   client contract. Codex lanes build the fixture generator, the reference
   applications, the device witnesses and the periphery. Blind reviews from
   two model families are reserved for the two disclosure-sensitive
   mechanisms: partition inversion of read rules (LLP 2000.000 §7.1) and
   the meter's cut behaviour on non-uniform scans (LLP 2000.000 §6). This
   departs from the standing rule that Codex codes and Claude orchestrates,
   deliberately, for the core only.
5. **The clock is four weeks** from the first commit under `snapback4/` to
   the first slice running on the hub fixture. At the clock the author kills
   the track, merges its substrates into a survivor, or continues it. There
   is no third month without a ruling.
6. **Shared and not shared.** Shared with Snapback 3: the LLP corpus, the
   Clique harness and scorers, the fixtures, the briefs, and the simulator
   once either track has one. Not shared: code, except the Snapback 2 pieces
   both are expected to copy (LLP 2000.000 §5.1).
7. **Snapback 2 keeps shipping and freezes new substrate work for the
   duration.** Fix-forward, the loop bar, acquisition and papercuts continue;
   no new certificate axes, client custody mechanisms or ceiling changes.
   This is accepted here as a condition of the bakeoff. Making it binding on
   concurrent Snapback 2 sessions needs one line in `rules/NOT-DOING.md`'s
   Moves ledger, which this document does not write.
8. **Reading load.** This root, updated in place, and one append-only
   journal, `snapback4/JOURNAL.md`. Sub-LLPs only for a decision that must
   outlive the journal. No panels beyond decision 4's two reviews.

## 2. The bet on one page

**Keep verbatim from Snapback 2** (LLP 2000.000 §5.1): the rule language
with its uniformity and hoist analysis, `decided_true` and the
structural-fact refusals; one data language, Quarry, with `--` comments,
`require … else CODE`, `shape`, `merge`, `walk`, `chunk`; the value model
and its conformance corpus; typed read and write states with no silent state
and the refusal envelope `{code, family, site, message, rewrite, guide}`; the
successor classifier (widening additive, checked narrowing, exact projection
ownership); `deliver`'s engine-computed audience, tombstones and
`bootstrap`; `schedule`, `job`, `chunk` and rehearsal; personas; `init`,
`dev`, `check`, `doctor`, `run`, `test`, `why`, `trace`, `guide`; H0
`deploy`, `rollback`, `secret`; channels; assets; the word-prefix index.

**Flip 1 — certify authorization, meter resources** (LLP 2000.000 §6). The
certificate keeps every read site's shape, uniformity, completeness class
and prediction eligibility, and stops pricing bytes and steps. A
deterministic meter charges examined rows, index entries, rule probes,
steps, heap, output and rows written as the program runs, on the server and
# LLP 2000.000: Snapback 3 — keep the core, flip two substrates, start at hub scale

**Type:** RFC
**Status:** Draft
**Role:** Second opinion on LLP 2000; since 2026-09-12 also the design brief Snapback 4 builds (LLP 3000)
**Systems:** Snapback 3 product architecture, bounded computation, client data model, client API vocabulary, language and tooling, effects runtime, verification (simulation), performance budgets, process
**Author:** Claude Fable 5.1, at Charlie Cheever's request
**Date:** 2026-09-12
**Revised:** 2026-09-12 (adopted as the Snapback 4 design brief by LLP 3000 decision 3); 2026-09-12 (initial)
**Related:** [LLP 2000](./2000-snapback3.rfc.md) (parent), [LLP 3000](./3000-snapback4.explainer.md) (the Snapback 4 root that builds this brief), LLP 0000, [LLP 0329](./0329-agent-native-rebuild-diagnosis.research.md), [LLP 0329.014.004](./0329.014.004-bounded-data-programs-v1-design.rfc.md), [LLP 0329.016](./0329.016-agentic-dev-loop-from-scratch.rfc.md), [LLP 1000](./1000-snapback2.explainer.md), [LLP 1001](./1001-query-engine.spec.md), [LLP 1002](./1002-dev-loop.spec.md), [LLP 1012](./1012-local-first-v1.spec.md), [LLP 1018.003](./1018.003-truthful-and-composed-client.decision.md), [LLP 1018.008](./1018.008-elegance-after-the-corrections.research.md), [LLP 1018.008.007](./1018.008.007-affordable-offline-acquisition.research.md), [LLP 1018.008.008](./1018.008.008-locality-of-application-changes.research.md), [LLP 1018.008.009](./1018.008.009-residual-ergonomic-gaps.research.md), [LLP 1019](./1019-derived-delivery-custody.rfc.md), [LLP 1020](./1020-day-two-evolution-and-legible-ceilings.rfc.md), [LLP 1023](./1023-clique-builder-jump.rfc.md), [LLP 1024](./1024-single-lane-delivered-search.rfc.md), [LLP 1025](./1025-digest-final-emission-at-hub-scale.research.md), `rules/RULES.md`, `rules/NOT-DOING.md`, `benchmarks/runs/2026-09-05-clique-full-3x3/holistic-scores.md`

## 1. Summary

LLP 2000 is right that the whole application is the unit of design, right
that ownership comes before abstraction, and right to ask for deterministic
simulation and an early real deployment. Its weakness is that it treats the
two structural choices that produced Snapback 2's costs as open research
questions, and then proposes a first experiment at exactly the scale where
those costs are invisible. This document takes a position on both, names
what to keep from Snapback 2 verbatim, and rewrites the first slice so it
can fail for the right reasons.

The position, in one paragraph. Snapback 2's *core* is excellent and should
be copied: the rule language and its uniformity analysis, the structural-fact
family, one data language, typed states with no silence, refusals that paste
a rewrite, personas, the successor classifier, the derived per-recipient
log, the loop verbs and their sub-second budgets. Two *substrates* under
that core are where the record shows the hours went, and both should be
flipped rather than re-investigated: (1) the static certificate should keep
certifying **authorization and shape** and stop pricing **bytes and steps**,
which move to a deterministic runtime meter with honest `capped`/abort
outcomes; and (2) the client should hold **a replica of the viewer's declared
partition** — the local-first shape every shipped sync engine and Snapback
2's own `deliver` log converge on — instead of a per-query result cache
proven by receipts. Those two flips dissolve most of the machinery that
leaked into the application (receipts, coverage, halos, validators, grants,
ID slices, drains, `withHistory`, follower inboxes, per-table retention
words) and turn the 28-second acquisition into a bulk stream whose floor is
the device's write speed. The first slice should be built on the **hub
fixture** (1,000 memberships, 500 follows, 100,000 messages), with the
day-two change designed before the day-one screen, a native client in the
first slice, and a deterministic simulator as the primary test harness.

Three claims this document makes that LLP 2000 does not:

1. **The costs have two named causes, and both are decisions, not
   mysteries.** Byte-priced static certification and the receipt-proven
   result cache account for every ergonomic residual in LLP 1018.008.009
   except documentation. §2 shows the mapping.
2. **The first experiment must include the hub.** Snapback 2 was "elegant on
   day one and hostile on day two" (LLP 1020) and broke at 1,000 memberships
   (LLPs 1023, 1024, 1025). A two-principal slice will pass and teach nothing.
3. **The process is part of the product.** Seventy-one LLPs, over two
   thousand commits, and seven ceiling raises in fourteen days produced a
   sound system nobody can hold in their head. Snapback 3 needs one owner on
   the core, a simulator instead of a test matrix, and budgets anchored to
   competitors so that raising one means admitting a loss.

## 2. What the record says, read as causes

The evidence LLP 2000 §2 cites is right; its reading is too gentle. Every
row below is a Snapback 2 cost recorded in the corpus, with the substrate
that produced it. Numbers are the corpus's own and retain its scope limits.

| Recorded cost | Where | Cause |
| --- | --- | --- |
| Adding `editedAt: time ?` (44 bytes × 244 retained copies = 10,736) pushed `messages.searchAll` to 4,199,688 closure bytes against 4,194,304; the builder shrank a page from 20 to 19 | LLP 1018.008.008; 0.0.21 day-two diary | **Static byte pricing.** Closure bytes are a bound on what a receipt could ship; the product paid for the bound, not the work |
| The 1,000-membership digest fold certifies at 9,922,698 heap and 8,691,704 closure bytes and is refused; the recipient-keyed form is admitted at 2,733,253 / 1,848,418 | LLP 1025 §3 | **Static byte pricing** (heap = steps × 32 + closure scratch). A runtime meter would have run the fold and reported actual bytes |
| A message page is 50, not 200, because a row "prices at 16,016 bytes" and 200 exceed the 1 MiB output ceiling | LLP 1012 §3 | **Static byte pricing** of the worst-case row width |
| A per-recipient search projection is refused at 20,863,641 reserved steps against 1,000,000 | LLP 1024 §1 | **Static step pricing** of a derivation the engine would perform incrementally |
rg: snapback4/crates/snapback4/src/release_bridge.rs: No such file or directory (os error 2)
llp/3000.036-what-the-app-farm-asks-of-the-rule-language.rfc.md:305:(`@ref LLP 3000#7-decisions-during-execution — typed references do not imply
llp/3000.036-what-the-app-farm-asks-of-the-rule-language.rfc.md:397:under `@ref LLP 3000.007#8 — explain the hidden-collision idiom without
llp/3000.036-what-the-app-farm-asks-of-the-rule-language.rfc.md:613:`@ref LLP 3000.007#20.22.1`), ordered against the applied watermark (LLP
llp/3000.000.000-retained-storage-and-hot-release.rfc.md:1769:## 21. Wave-27 release semantics (REL)
llp/3000.011.003.000-offline-ready-application-starters.rfc.md:276:- Every starter is written without `@ref` pointers: init keeps each
llp/3000.017-ephemeral-tables.rfc.md:1333:`@ref` anchors were then corrected to the numeric section form.
llp/3000.009.001-snapback4-on-postgres.rfc.md:469:| Retention by deleting below a floor: no re-acquisition path exists for a device behind the head, and sync rebuilds authority from the whole membership history, so devices above the floor lose owed revocations | Grok F1, Fable F2, Astra F4 | Accepted (`partition.rs` `stream`/`intervals`/`memberships_before`; the `@ref LLP 3000#7` truncated-ledger annotation). Retention becomes checkpoint plus floor under LLP 3000.002's proposal, with explicit refusals, leaves P1 and gets a Moves line; graduation copies the whole log (child A §7.3, child B §4.2, §7 here). Fable's reading of `NOT-DOING.md`'s "the log never evicts" as a retention exclusion is accepted in part: that line concerns horizon maintenance, but a Moves line is needed anyway |
llp/3000.009.001.000-the-postgres-store-port.rfc.md:2848:  sequence zero with their commit times. The code's own annotation (`@ref
llp/3000.001.000-device-engine-handshake.rfc.md:89:Muse returned READY with a stale copied-adapter provenance finding; the fixture now records the actual Exact2 revision and the local @ref substitution. Codex found an explicit device declaration could be suppressed by a readable entry, and static custom declarations could be missed after regex quotes, escaped slashes, or URL cache suffixes. Explicit `snapback4/ts` declarations now always gate their default artifact. Static discovery skips regex bodies, decodes string escapes, and resolves `/assets/` query/fragment and URL-encoded filenames. Regressions retain each supplied counterexample. The fixture stops its server before directory removal. Both reviewers' responses are retained verbatim; another mutually blind round reviews the repair.

exec
/bin/bash -lc "rg --files snapback4 | rg 'release_bridge.rs|AGENTS.md"'$'"'; rg -n 'exact_write_authority' snapback4; sed -n '1769,1840p' llp/3000.000.000-retained-storage-and-hot-release.rfc.md" in /home/ccheever/projects/sb4-b27-rel
 succeeded in 37ms:
snapback4/AGENTS.md
snapback4/crates/snapback4-lang/src/release_bridge.rs
snapback4/crates/snapback4/src/verbs/release_bridge.rs
snapback4/crates/snapback4-lang/src/release_bridge.rs:429:pub fn exact_write_authority(target:&[(String,String)],current:&[(String,String)])->Result<(),String>{
snapback4/crates/snapback4-lang/tests/release_bridge_security.rs:851:    let error=release_bridge::exact_write_authority(&before,&current).unwrap_err();
snapback4/crates/snapback4-lang/tests/release_bridge_security.rs:854:    assert!(release_bridge::exact_write_authority(&[("schema.q".into(),guarded)],&current).is_ok());
snapback4/crates/snapback4-lang/tests/release_bridge_security.rs:894:    assert!(release_bridge::exact_write_authority(&[("schema.q".into(),old.into())],&[("schema.q".into(),current)]).is_ok());
snapback4/crates/snapback4-lang/tests/release_bridge_security.rs:910:    assert!(release_bridge::exact_write_authority(&before,&next).is_ok());
snapback4/crates/snapback4-lang/tests/release_bridge_security.rs:912:    assert!(release_bridge::exact_write_authority(&[("schema.q".into(),unstable)],&next).is_err());
snapback4/crates/snapback4-lang/tests/release_bridge_security.rs:915:    assert!(release_bridge::exact_write_authority(&[("schema.q".into(),wrong)],&[("schema.q".into(),planner)]).is_err());
snapback4/crates/snapback4/src/verbs/releases.rs:187:        snapback4_lang::release_bridge::exact_write_authority(&target,&current).map_err(|e|format!("E_ADOPT: {e}"))?;
snapback4/crates/snapback4/src/verbs/releases.rs:190:            snapback4_lang::release_bridge::exact_write_authority(&target,&source).map_err(|e|format!("E_ADOPT: latest source {latest}: {e}"))?;
## 21. Wave-27 release semantics (REL)

Implementer: Codex for Charlie Cheever, 2026-10-24. Commission: wave-27
fix list 10b #1, #2, #3, #5, #7 and #8. This amendment supersedes the narrower
input adapter and extraction type equality restrictions in §20 only as stated
below. Retention, transactional validation, lifetime custody and current policy
admission remain in force. No publication, version bump or push is authorized.

### Registration and guarded source

A new column write audience or frozen column alone does not register a view.
Structural domain widening, actual old-row hiding/misrepresentation and the
existing unchanged-data/intent executable repair protection determine need.
Historical source selection (including an equal-source forward deploy) checks
column write/freeze authority against both the active source AND latest ordinary
source (both must pass), so an intervening old selection cannot erase that boundary. This is a
closed static admission gate under command locking and activation CAS. It aligns
declared table/column identities and complete probe-index meaning. Every old
insert/update/upsert that can supply a protected column must retain the policy,
or a conjunctive table guard must contain the exact compiled current policy as a
conjunct after identity/probe alignment (deny implies every policy, allow needs
no guard). Closed Boolean containment additionally admits each branch of an old
OR only when it admits the new policy, an old conjunct when it admits the policy,
a new OR when one branch is admitted, and a new AND only when every branch is
admitted. These are structural sufficient conditions, never sampled implication.
A dominating leading `require` may supply that same containment when its compiled
policy uses only viewer/literal equality or positive existence with viewer/literal
keys and equalities (and AND/OR). Every dependency must be disjoint from the
operation's complete expanded IR write set. Conditional/loop writes participate
in that set; they do not themselves change the viewer. JobAs/JobQuery/emitted
external effects and implicit maintained/sequence/referential writes refuse this
reduction. Rules depending on row images, negative probes, references or mutable
locals cannot supply it. Other operations, jobs or external writers cannot
interleave within this atomic mutation; their presence alone is not a blocker.
Finite campaigns never supply proof.
A known object patch is the compiled syntactic fixed-key object with no spread,
computed key or dynamic base. If it omits a field it is not a write to that field;
all other patch forms remain conservative. Insert defaults count. Upserts must satisfy both arms.
Transition-bound guards and missing freezes need an authored guarded bridge;
there is no guessed implication. Selection refuses with operation, column and
rule before those old writes become live. Read-only/unrelated writes remain
selectable. New ordinary source may deliberately change policy through the
normal deployment review. Historical selection never dynamically rewrites its
immutable executable or grants an acknowledgment bypass. `check` compiles needed views against an explicitly selected deployment
store as well as the normal saved-client baseline, without registering them or
mutating immutable source. Production deploy repeats compilation and writer
validation. A source-only check with no predecessor cannot qualify a production
transition and says so in the guide.

Typed table alpha conversion edits only nominal type and table-reference AST
slots. For-loop table domains are adapted only without an argument/local shadow
in that lexical scope; named values/shapes stay untouched. The compiler resolves
explicit Read/Write AST slots as tables and Name/ShapeUse slots as values/shapes,
so unchanged argument/local/shape slots cannot capture a rewritten typed read.
The complete adapted closure recompiles; unsupported resolution still refuses. Argument/local/shape spelling equal to a table name is safe when those
slots remain unchanged. Table mappings stay injective, every destination must
reparse nominally, and conflicting/unsupported source spans refuse. Column write
and frozen predicates participate in exactly the same transport and compiled
current-authority comparison as read predicates. Business literals never change.

Guarded views retain the current execution closure. An incompatible old write
export (new required argument, removed input, narrowed domain or merged wire
position) may be paused with E_OP, including a same-name current write. The
view removes that export and reports its operation and incompatible argument;
it does not revive an old body, make a required choice optional, supply an
invented default, or mark a removed data-bearing input deprecated. Other names
of the same authored endpoint are considered independently. Required old
queries still need compatible current endpoints; refusal identifies their real
source site and argument. Removed required/defaulted fields need a truthful
reverse projection or an authored bridge. Every refusal identifies the concrete
site and relevant table/column/argument/rule instead of an empty :0:0 site.


codex
I’m using `llp-orient` to identify the governing constraints for this read-only review. I found the gate in `snapback4-lang`; next I’ll trace its write-set analysis and rule alignment against §21.
exec
/bin/bash -lc "sed -n '260,670p' snapback4/crates/snapback4-lang/src/release_bridge.rs" in /home/ccheever/projects/sb4-b27-rel
 succeeded in 0ms:
        for column in &next.columns {
            let old_name=column.renamed_from.as_ref().filter(|name|table.columns.contains_key(*name)).unwrap_or(&column.name);
            if table.columns.contains_key(old_name)&&table.defaults.get(old_name)!=current_table.defaults.get(&column.name) {
                diagnostics.push(crate::diag::type_error(&column.site,format!("rollback view cannot preserve current default for {name}.{}",column.name),"retain the current authored default in a compatible guarded rollback source").guide("deploy"));
            }
        }
    }
    if bound.diagnostics.is_empty() && !super::release_bridge_current::contracts(&crate::compile(target),&bound) {
        diagnostics.push(crate::diag::type_error(&crate::Site::default(),"rollback view cannot preserve every predecessor wire contract, including argument aliases and distinct input positions","retain the old parameter aliases on compatible current endpoints, or author a guarded compatibility endpoint before deploying").guide("deploy"));
    }
    diagnostics.extend(bound.diagnostics);diagnostics.extend(domain_diagnostics);
    Bridge {sources,changes,diagnostics}
}
fn offset(text:&str,line:u32,col:u32)->usize {
    let start=text.split_inclusive('\n').take(line.saturating_sub(1) as usize).map(str::len).sum::<usize>();
    start+text[start..].chars().take(col.saturating_sub(1) as usize).map(char::len_utf8).sum::<usize>()
}
pub fn type_span(file:&str,text:&str,column:&ast::ColumnDecl)->Option<(usize,usize)> {
    let(tokens,_)=lexer::lex(file,text);let at=tokens.iter().position(|t|t.site==column.site)?;
    let start=tokens.get(at+2)?;let mut depth=0;
    for (ordinal,token) in tokens.iter().skip(at+2).enumerate() {
        // A nominal type may itself be named `default`, `read`, etc. Only
        // recognize metadata after consuming the first token of the type.
        if ordinal>0 && depth==0 && (token.kind==Kind::Newline || matches!(token.value.as_str(),"default"|"renamed"|"on"|"read"|"write"|"written"|"readable")) {
            // End before whitespace preceding metadata/comment/newline.
            let end=offset(text,token.site.line,token.site.col);
            let start=offset(text,start.site.line,start.site.col);let end=text[..end].trim_end().len();
            return (start<=end).then_some((start,end));
        }
        match token.value.as_str(){"("|"["=>depth+=1,")"|"]"=>depth-=1,_=>()}
    }None
}
fn declaration(text:&str,line:u32)->String {
    let lines:Vec<_>=text.lines().collect();let start=line.saturating_sub(1) as usize;let mut end=start+1;
    while end<lines.len() {let s=lines[end];if !s.trim().is_empty() && !s.starts_with(char::is_whitespace) && !s.starts_with("--"){break;}end+=1;}
    lines[start..end].join("\n")+"\n"
}
// Rewrite only structural table references; strings, column names and bound
// rule parameters retain their spelling and policy meaning.
pub(super) fn retained_declaration(file:&str,text:&str,table:&ast::TableDecl,aliases:&BTreeMap<String,String>)->Result<String,String> {
    let mut source=declaration(text,table.site.line);
    let mut decl=parser::parse_document(file,&source).0.tables.into_iter().next().ok_or("missing retained table declaration")?;
    let mut edits=Vec::new();
    fn remap_type(t:&mut ast::ScalarType,aliases:&BTreeMap<String,String>) {
        match &mut t.kind {TypeKind::Ref{table}=>{if let Some(name)=aliases.get(table){*table=name.clone();}},TypeKind::List{item,..}=>remap_type(item,aliases),_=>()}
    }
    for column in &decl.columns {
        let mut type_=column.type_.clone();remap_type(&mut type_,aliases);
        if type_!=column.type_ {if let Some((start,end))=type_span(file,&source,column){edits.push((start,end,print::scalar_type(&type_)));}}
    }
    let mut visit=|expr:&mut ast::Expr| {
        if let ast::Expr::Read(read)|ast::Expr::Exists{read,..}|ast::Expr::Created{read,..}=expr {
            if let Some(name)=aliases.get(&read.table) {let start=offset(&source,read.site.line,read.site.col);edits.push((start,start+read.table.len(),name.clone()));}
        }
    };
    for rule in decl.rules.iter_mut().chain(decl.column_reads.iter_mut().map(|(_,r)|r)) {crate::bind::intent_walk::expression(&mut rule.value,&mut visit);}
    for column in &mut decl.columns {
        for expr in [&mut column.read,&mut column.write,&mut column.default].into_iter().flatten(){crate::bind::intent_walk::expression(expr,&mut visit);}
        if let Some(expr)=column.maintained.as_mut().and_then(|a|a.filter.as_mut()){crate::bind::intent_walk::expression(expr,&mut visit);}
    }
    for (_,expr,_) in &mut decl.immutable_when {crate::bind::intent_walk::expression(expr,&mut visit);}
    for (expr,_) in &mut decl.final_exists {crate::bind::intent_walk::expression(expr,&mut visit);}
    // Sync targets are structural table probes outside the expression AST.
    if let Some(sync)=&decl.sync {
        let (tokens,_)=lexer::lex(file,&source);
        // Lexer continuation rules keep indented `or` arms in this logical
        // declaration even when their physical line differs from `sync`.
        if let Some(start)=tokens.iter().position(|t|t.site==sync.site) {
            let end=tokens[start..].iter().position(|t|matches!(t.kind,Kind::Newline|Kind::Eof)).map_or(tokens.len(),|n|start+n);
            for pair in tokens[start..end].windows(2) {if pair[0].kind==Kind::Word && pair[1].value=="[" {if let Some(name)=aliases.get(&pair[0].value){let start=offset(&source,pair[0].site.line,pair[0].site.col);edits.push((start,start+pair[0].value.len(),name.clone()));}}}
        }
    }
    edits.sort();edits.dedup();
    if edits.iter().any(|(a,b,_)|a>b||*b>source.len()||!source.is_char_boundary(*a)||!source.is_char_boundary(*b))
        || edits.windows(2).any(|pair|pair[0].1>pair[1].0) {
        return Err("unsupported or overlapping retained-table source spans".into());
    }
    edits.sort_by_key(|e|std::cmp::Reverse(e.0));
    for (start,end,value) in edits {source.replace_range(start..end,&value);}
    Ok(source)
}
fn join(old:&ast::ScalarType,new:&ast::ScalarType,tables:&BTreeMap<String,(&String,&String,ast::TableDecl)>)->Option<ast::ScalarType> {
    let kind=match (&old.kind,&new.kind) {
        (TypeKind::Int|TypeKind::IntRange{..},TypeKind::Int|TypeKind::IntRange{..})=>{
            let bounds=|k:&TypeKind|match k{TypeKind::IntRange{min,max}=>(min.unwrap_or(i64::MIN),max.unwrap_or(i64::MAX)),_=>(i64::MIN,i64::MAX)};
            let(a,b)=bounds(&old.kind);let(x,y)=bounds(&new.kind);let(min,max)=(a.min(x),b.max(y));
            if min==i64::MIN && max==i64::MAX {TypeKind::Int}else{TypeKind::IntRange{min:(min!=i64::MIN).then_some(min),max:(max!=i64::MAX).then_some(max)}}
        }
        (TypeKind::Image{max:a,once:b},TypeKind::Image{max:x,once:y}) if b==y=>TypeKind::Image{max:(*a).max(*x),once:*b},
        (TypeKind::Video{max:a},TypeKind::Video{max:b})=>TypeKind::Video{max:(*a).max(*b)},
        (TypeKind::File{max:a,types:b},TypeKind::File{max:x,types:y}) if b==y=>TypeKind::File{max:(*a).max(*x),types:b.clone()},
        (TypeKind::Text{min:a,max:b,format:c},TypeKind::Text{min:x,max:y,format:z}) if c==z=>TypeKind::Text{min:Some(a.unwrap_or(0).min(x.unwrap_or(0))).filter(|v|*v>0),max:(*b).max(*y),format:c.clone()},
        (TypeKind::Enum{variants:a},TypeKind::Enum{variants:b})=>{let mut v=a.clone();for x in b {if !v.contains(x){v.push(x.clone());}}TypeKind::Enum{variants:v}},
        (TypeKind::List{item:a,min:b,max:c},TypeKind::List{item:x,min:y,max:z})=>TypeKind::List{item:Box::new(join(a,x,tables)?),min:(*b).min(*y),max:(*c).max(*z)},
        // Only an explicit rename provides nominal identity; structural similarity
        // or independently declared replacement tables cannot justify a bridge.
        (TypeKind::Ref{table:a},TypeKind::Ref{table:b}) if a==b || tables.get(a).is_some_and(|(_,_,t)| t.name==*b)=>TypeKind::Ref{table:a.clone()},
        (a,b) if a==b=>a.clone(),
        // Other conversions require an explicit typed migration. A bridge never
        // guesses a nominal reference, money currency or asset policy.
        _=>return None,
    };
    Some(ast::ScalarType{kind,optional:old.optional||new.optional})
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn mixed_narrowing_keeps_current_domains_and_the_complete_current_closure() {
        let old="table items:\n  kind: enum('private', 'public')\n  amount: int\n  read <- .kind != 'public'\n  online only\nquery readItem(id: items):\n  return items[id]\n";
        let new=old.replace("enum('private', 'public')","enum('public')").replace("amount: int","amount: int ?");
        let b=loosen(&[("schema.q".into(),old.into())],&[("schema.q".into(),new)]);
        assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);
        assert!(b.sources[0].1.contains("kind: enum('public')"));
        assert!(!b.sources[0].1.contains("'private'"));
        let renamed=b.sources[0].1.replace("query readItem", "query currentRead")+"alias readItem = currentRead\n";
        let aliased=loosen(&[("schema.q".into(),old.into())],&[("schema.q".into(),renamed)]);
        assert!(aliased.diagnostics.is_empty(),"{:?}",aliased.diagnostics);
        assert!(aliased.sources[0].1.contains("alias readItem = currentRead"));
    }
    #[test]
    fn mixed_domain_closure_refuses_missing_fields_and_incompatible_inputs() {
        let old="table items:\n  kind: enum('private', 'public')\n  amount: int\n  public\n  online only\nquery readItem(id: items, n: int):\n  return items[id]\n";
        for new in [old.replace("enum('private', 'public')","enum('public')").replace("amount: int\n", ""),old.replace("enum('private', 'public')","enum('public')").replace("n: int)","n: int 1..10)")] {
            let b=loosen(&[("schema.q".into(),old.into())],&[("schema.q".into(),new)]);
            assert!(!b.diagnostics.is_empty());
        }
    }
    #[test]
    fn view_trigger_uses_full_domains_and_identity_not_advice_strings(){
        let old="table items:\n  text: text 4..100\n  cap 2 by text\n  public\n  online only\n";
        for new in [old.replace("4..100","<=100"),old.replace("cap 2","cap 3")] {assert!(requires_view(&[("s.q".into(),old.into())],&[("s.q".into(),new)]));}
        assert!(!requires_view(&[("s.q".into(),old.into())],&[("s.q".into(),old.replace("cap 2","cap 1"))]));
        let old="table people:\n  public\n  online only\ntable items:\n  buyer: people\n  unique buyer\n  public\n  online only\n";
        let new=old.replace("buyer: people","customer: people renamed from buyer").replace("unique buyer","unique customer");
        assert!(!requires_view(&[("s.q".into(),old.into())],&[("s.q".into(),new.clone())]));
        assert!(!requires_view(&[("s.q".into(),new)],&[("s.q".into(),old.into())]));
    }
    #[test]
    fn current_quota_immutability_and_lifetime_survive_a_widened_view(){
        let old="table items:\n  amount: int\n  owner: principal\n  until: time\n  cap 2 by owner\n  insert <- allow\n  online only\nmutation add():\n  return insert items {amount:1,owner:viewer,until:1000000}\n";
        let new=old.replace("amount: int","amount: int ?").replace("cap 2 by owner","cap 1 by owner\n  immutable owner\n  expire at .until");
        let b=loosen(&[("s.q".into(),old.into())],&[("s.q".into(),new)]);assert!(b.diagnostics.is_empty(),"{:?} {:?}",b.diagnostics,b.sources);
        let bound=crate::compile(&b.sources);let table=&bound.schema.tables["items"];
        assert!(table.constraints.contains(&snapback4_core::schema::Constraint::Cap{by:vec!["owner".into()],max:1}));
        assert!(table.constraints.contains(&snapback4_core::schema::Constraint::Immutable{fields:vec!["owner".into()]}));assert_eq!(table.expire.as_deref(),Some("until"));
    }
    #[test]
    fn aliased_current_endpoint_keeps_its_guard_on_a_union_view() {
        let old="table items:\n  amount: int\n  public\n  online only\nquery oldRead(id: items):\n  item = items[id] ! else MISSING\n  return item.amount + 1\n";
        let new="table items:\n  amount: int ?\n  public\n  online only\nquery currentRead(id: items):\n  item = items[id] ! else MISSING\n  require item.amount != null else AMOUNT_PENDING\n  return item.amount + 1\nalias oldRead = currentRead\n";
        let b=loosen(&[("schema.q".into(),old.into())],&[("schema.q".into(),new.into())]);
        assert!(b.diagnostics.is_empty(),"{:?} {:?}",b.diagnostics,b.sources);
        assert!(b.sources[0].1.contains("query oldRead"));assert!(b.sources[0].1.contains("AMOUNT_PENDING"));
    }
    #[test]
    fn loosens_target_domains_preserving_its_operations_and_rules() {
        let old="table items:\n  amount: money USD\n  photos: [image <=1024] 1..8\n  public\n  online only\nquery oldRead():\n  return items first 10 by .id {amount,photos}\n";
        let new=old.replace("money USD","money USD ?").replace("1..8","<=8").replace("oldRead","newRead");
        let b=loosen(&[("schema.q".into(),old.into())],&[("schema.q".into(),new)]);
        assert!(b.diagnostics.is_empty(),"{:?}\n{:?}",b.diagnostics,b.sources);
        assert!(b.sources[0].1.contains("query oldRead"));assert!(!b.sources[0].1.contains("query newRead"));
        assert!(b.sources[0].1.contains("amount: money USD 2 ?"));assert!(!b.changes.iter().any(|c|c.contains("verify operation oldRead")));
    }
}

/// Historical source cannot silently erase an enforced column audience.
/// This closed proof accepts an identical guard or a conjunctive table guard;
/// other workflows need an authored compatibility endpoint, never an ack.
pub fn exact_write_authority(target:&[(String,String)],current:&[(String,String)])->Result<(),String>{
    use snapback4_core::schema::RuleExpr;
    let old=crate::compile(target);let next=crate::compile(current);
    if next.schema.tables.values().all(|t|t.column_writes.is_empty()&&t.frozen_columns.is_empty()){return Ok(());}
    let aliases=next.schema.table_renames.iter().filter(|(_,prior)|old.schema.tables.contains_key(*prior)).map(|(new,prior)|(new.clone(),prior.clone())).chain(old.schema.table_renames.iter().filter(|(new,prior)|!next.schema.tables.contains_key(*new)&&next.schema.tables.contains_key(*prior)).map(|(new,prior)|(prior.clone(),new.clone()))).collect();
    let aligned=align_current_schema(&old.schema,target,&next.schema,current,&aliases)?;
    fn implies(rule:&RuleExpr,policy:&RuleExpr,policies:&PolicyComparison<'_>)->bool{
        policies.rule(rule,policy) || *rule==RuleExpr::Deny || *policy==RuleExpr::Allow
            || matches!(rule,RuleExpr::And(xs) if xs.iter().any(|r|implies(r,policy,policies)))
            || matches!(rule,RuleExpr::Or(xs) if xs.iter().all(|r|implies(r,policy,policies)))
            || matches!(policy,RuleExpr::Or(xs) if xs.iter().any(|p|implies(rule,p,policies)))
            || matches!(policy,RuleExpr::And(xs) if xs.iter().all(|p|implies(rule,p,policies)))
    }
    fn writes_column(value:&serde_json::Value,table:&str,column:&str,effect:&str,defaulted:bool)->bool {
        match value {
            serde_json::Value::Object(fields)=>{
                if fields.contains_key("Literal"){return false;}
                for(kind,body)in fields {
                    let write_effect=match kind.as_str(){"Insert"|"InsertIfAbsent"=>"insert","Update"=>"update","Upsert"=>"upsert","WriteTarget"=>if body["upsert"]==true{"upsert"}else{"update"},_=>""};
                    let target=body["table"].as_str().or_else(||body["target"]["table"].as_str());
                    if write_effect==effect&&target==Some(table){
                        let patch=body.get("patch").or_else(||body.get("row"));
                        let object=patch.and_then(|p|p.get("Object")).and_then(serde_json::Value::as_object);
                        if object.is_none_or(|o|o.contains_key(column)) || effect!="update"&&defaulted {return true;}
                    }
                    if writes_column(body,table,column,effect,defaulted){return true;}
                }false
            },
            serde_json::Value::Array(xs)=>xs.iter().any(|x|writes_column(x,table,column,effect,defaulted)),
            _=>false,
        }
    }
    fn leading_guard(target:&[(String,String)],aligned:&snapback4_core::Schema,table:&str,operation:&str,policy:&RuleExpr)->bool {
        let mut sources=target.to_vec();
        let Some((_,source))=sources.first_mut()else{return false};
        source.push_str(&format!("\ninvariant {table}.{operation} only {}\n",policy.quarry()));
        let proof=crate::compile(&sources);if !proof.diagnostics.is_empty(){return false;}
        let comparison=PolicyComparison::new(&proof.schema,aligned);
        // @ref LLP 3000.000.000#21-day-two-release-semantics-rel — finite control flow preserves a stable leading guard; scope changes do not.
        fn stable(rule:&RuleExpr)->bool {
            use snapback4_core::schema::RuleTerm;
            match rule {
                RuleExpr::Exists{key,equalities,..}=>key.iter().chain(equalities.iter().map(|(_,t)|t)).all(|t|matches!(t,RuleTerm::Viewer|RuleTerm::Literal(_))),
                RuleExpr::And(xs)|RuleExpr::Or(xs)=>xs.iter().all(stable),
                RuleExpr::Eq(a,b)|RuleExpr::Ne(a,b)=>[a,b].iter().all(|t|matches!(t,RuleTerm::Viewer|RuleTerm::Literal(_))),
                RuleExpr::Allow|RuleExpr::Deny=>true,_=>false,
            }
        }
        fn opaque(value:&serde_json::Value)->bool {match value {
            serde_json::Value::Object(m) if m.contains_key("Literal")=>false,
            serde_json::Value::Object(m)=>m.keys().any(|k|matches!(k.as_str(),"JobAs"|"JobQuery"|"Emit"))||m.values().any(opaque),
            serde_json::Value::String(s)=>matches!(s.as_str(),"JobAs"|"JobQuery"),
            serde_json::Value::Array(xs)=>xs.iter().any(opaque),_=>false,
        }}
        let Some(program)=proof.programs.iter().find(|p|p.program.name==operation) else{return false};
        if opaque(&serde_json::to_value(&program.program).unwrap()) {return false;}
        // Unknown implicit writes cannot establish dependency stability.
        if proof.schema.tables.values().any(|t|!t.maintained.is_empty()||!t.sequences.is_empty()||t.on_delete.values().any(|a|a.writes()))||!proof.schema.maintains.is_empty(){return false;}
        let writes=snapback4_core::ir::write_tables(&program.program);
        proof.invariants.iter().any(|inv|inv.table==table&&inv.operation.as_deref()==Some(operation)
            &&inv.policy.as_ref().is_some_and(|compiled|comparison.rule(compiled,policy))
            &&inv.requirements.iter().any(|require|stable(require)&&implies(require,policy,&comparison)
                &&crate::security::kernel::dependencies(require).iter().all(|dependency|!writes.iter().any(|(t,_)|t==dependency))))
    }
    let policies=PolicyComparison::new(&old.schema,&aligned);
    for(name,current)in &aligned.tables {
        let Some(prior)=old.schema.table(name)else{continue};
        for (column,policy) in &current.column_writes {
            if !prior.columns.contains_key(column){continue;}
            for program in &old.programs {
                let writes=snapback4_core::ir::write_tables(&program.program);
                for(_,effect)in writes.iter().filter(|(t,e)|t==name&&*e!="delete") {
                    let defaulted=prior.defaults.get(column).is_some_and(|d|!matches!(d,snapback4_core::schema::ColumnDefault::Literal(snapback4_core::Value::Null)));
                    if !writes_column(&serde_json::to_value(&program.program).unwrap(),name,column,effect,defaulted){continue;}
                    let safe=prior.column_writes.get(column)==Some(policy) || match *effect {"insert"=>implies(&prior.rules.insert,policy,&policies),"update"=>!prior.update_transition&&implies(&prior.rules.update,policy,&policies),"upsert"=>!prior.update_transition&&implies(&prior.rules.insert,policy,&policies)&&implies(&prior.rules.update,policy,&policies),_=>false};
                    if !safe && !leading_guard(target,&aligned,name,&program.program.name,policy) {return Err(format!("{}: exact source operation {} can write {name}.{column} without current rule `write <- {}`; retain this audience in a guarded bridge before selecting the source",program.site,program.program.name,policy.quarry()));}
                }
            }
        }
        for(column,condition)in &current.frozen_columns {
            if prior.columns.contains_key(column)&&prior.frozen_columns.get(column)!=Some(condition)&&*condition!=RuleExpr::Deny&&!prior.constraints.iter().any(|c|matches!(c,snapback4_core::schema::Constraint::Immutable{fields}if fields.contains(column)))&&old.programs.iter().any(|p|snapback4_core::ir::write_tables(&p.program).iter().any(|(t,e)|t==name&&*e!="delete"&&writes_column(&serde_json::to_value(&p.program).unwrap(),name,column,e,false))) {
                return Err(format!("{name}.{column}: exact source omits current rule `immutable when {}`; retain the freeze in an authored bridge before selecting source",condition.quarry()));
            }
        }
    }
    Ok(())
}

exec
/bin/bash -lc "sed -n '800,950p' snapback4/crates/snapback4-lang/tests/release_bridge_security.rs; sed -n '150,215p' snapback4/crates/snapback4/src/verbs/releases.rs; rg -n 'release|rollback|frozen' snapback4/crates/snapback4-lang/src/guide.rs | head -30" in /home/ccheever/projects/sb4-b27-rel
 succeeded in 0ms:
        .replace("table labels:","table tags renamed from labels:")
        .replace("label: text <=20","name: text <=20 renamed from label")
        .replace("owner: labels","tag: tags renamed from owner")
        .replace("codes[code = .owner.label]","catalog[slug = .tag.name]");
    let source=|s:&str|vec![("schema.q".into(),s.to_owned())];
    for s in [old,next.as_str()] {let b=compile(&source(s));assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);}
    assert!(!release_bridge::requires_view(&source(old),&source(&next)));
    // A differently named index does not change the same typed existence obligation.
    let changed=next.replace("catalog[slug = .tag.name]","catalog[slug = 'name']");
    assert!(release_bridge::requires_view(&source(old),&source(&changed)));
}

#[test]
fn current_column_write_and_freeze_survive_default_bridge_without_invariants() {
    let old = "table docs:\n  owner: principal\n  approved: bool default false\n  body: text <=40 ?\n  read <- allow\n  insert <- allow\n  update <- allow\n  online only\nmutation create(owner: principal, body: text <=40 ?):\n  return insert docs {owner, body}\n";
    let current=old.replace("  body: text <=40 ?", "  body: text <=80 ? write <- .owner = viewer")
        .replace("  online only", "  immutable body when .approved = true\n  online only");
    let target=vec![("schema.q".into(),old.into())];
    let source=vec![("schema.q".into(),current)];
    assert!(release_bridge::requires_view(&target,&source));
    let bridge=release_bridge::loosen(&target,&source);
    assert!(bridge.diagnostics.is_empty(),"{:?}",bridge.diagnostics);
    let got=compile(&bridge.sources);let expected=compile(&source);
    assert!(got.diagnostics.is_empty(),"{:?}",got.diagnostics);
    assert!(!expected.schema.tables["docs"].column_writes.is_empty());
    assert!(!expected.schema.tables["docs"].frozen_columns.is_empty());
    assert_eq!(got.schema.tables["docs"].column_writes,expected.schema.tables["docs"].column_writes);
    assert_eq!(got.schema.tables["docs"].frozen_columns,expected.schema.tables["docs"].frozen_columns);
    assert_eq!(got.programs[0].program,expected.programs[0].program);
}

#[test]
fn declared_column_identity_transports_write_and_freeze_terms() {
    let source="table docs:\n  owner: principal\n  approved: bool\n  body: text <=40 ? write <- .owner = viewer\n  immutable body when .approved = true\n  public\n  online only\n";
    let before=compile(&[("schema.q".into(),source.into())]);
    assert!(before.diagnostics.is_empty(),"{:?}",before.diagnostics);
    let renamed=source.replace("owner","author").replace("approved","accepted").replace("body","payload");
    let after=compile(&[("schema.q".into(),renamed)]);
    assert!(after.diagnostics.is_empty(),"{:?}",after.diagnostics);
    let map=std::collections::BTreeMap::from([("docs".into(),std::collections::BTreeMap::from([("author".into(),"owner".into()),("accepted".into(),"approved".into()),("payload".into(),"body".into())]))]);
    let aligned=after.schema.with_column_names(&map);
    assert_eq!(aligned.tables["docs"].column_writes,before.schema.tables["docs"].column_writes);
    assert_eq!(aligned.tables["docs"].frozen_columns,before.schema.tables["docs"].frozen_columns);
}

#[test]
fn wave27_exact_source_proves_column_audiences_or_refuses_the_named_write() {
    let old="table docs:\n  owner: principal\n  body: text <=40\n  public\n  insert <- allow\n  update <- allow\n  online only\nmutation add(owner: principal, body: text <=40):\n  return insert docs {owner,body}\n";
    let next=old.replace("body: text <=40\n","body: text <=40 write <- .owner = viewer\n");
    let before=vec![("schema.q".into(),old.into())];let current=vec![("schema.q".into(),next)];
    assert!(!release_bridge::requires_view(&before,&current));
    let error=release_bridge::exact_write_authority(&before,&current).unwrap_err();
    assert!(error.contains("docs.body")&&error.contains("add")&&error.contains("write <-"),"{error}");
    let guarded=old.replace("insert <- allow","insert <- .owner = viewer");
    assert!(release_bridge::exact_write_authority(&[("schema.q".into(),guarded)],&current).is_ok());
}

#[test]
fn wave27_needed_view_retains_column_policy_probes_through_captured_names() {
    let old="table staff:\n  principal: principal\n  unique principal\n  public\n  online only\ntable docs:\n  owner: principal\n  amount: int\n  body: text <=40\n  public\n  online only\nquery read(docs: docs):\n  return docs[docs]\nmutation edit(docs: docs, body: text <=40):\n  update docs[docs] {body}\n";
    let next=old.replace("table docs:","table records renamed from docs:")
        .replace("docs: docs","docs: records").replace("return docs[docs]","return records[docs]")
        .replace("update docs[docs]","update records[docs]").replace("amount: int","amount: int ?")
        .replace("body: text <=40\n","body: text <=40 write <- exists staff[viewer] and exists records[.id]\n");
    let bridge=release_bridge::loosen(&[("schema.q".into(),old.into())],&[("schema.q".into(),next)]);
    assert!(bridge.diagnostics.is_empty(),"{:?}",bridge.diagnostics);
    let b=compile(&bridge.sources);assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);
    assert!(!b.schema.tables["docs"].column_writes.is_empty());
    assert!(bridge.sources[0].1.contains("docs: docs"));
}

#[test]
fn enum_aliases_refuse_merging_business_values_and_missing_variants() {
    let source="table tasks:\n  state: enum('ready','done')\n  public\n  online only\n";
    for aliases in ["alias tasks.state 'old' = 'missing'\n","alias tasks.state 'a' = 'done'\nalias tasks.state 'b' = 'done'\n","alias tasks.state 'ready' = 'done'\n"] {
        let b=compile(&[("schema.q".into(),source.to_owned()+aliases)]);assert!(b.diagnostics.iter().any(|d|d.message.contains("injective")),"{:?}",b.diagnostics);
    }
}

#[test]
fn current_views_pause_old_deletes_that_newly_cascade_through_a_renamed_reference() {
    let old="table parents:\n  public\n  delete <- allow\n  online only\ntable items:\n  parent: parents on delete restrict\n  n: int\n  cap 3 by parent\n  public\n  online only\nmutation remove(id: parents):\n  delete parents[id]\nquery rows():\n  return items first 10 by .id\n";
    let next=old.replace("parent: parents on delete restrict","anchor: parents renamed from parent on delete cascade").replace("cap 3 by parent","cap 3 by anchor").replace("n: int","n: int ?");
    let bridge=release_bridge::loosen(&[("schema.q".into(),old.into())],&[("schema.q".into(),next)]);
    assert!(bridge.diagnostics.is_empty(),"{:?}",bridge.diagnostics);
    let b=compile(&bridge.sources);assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);
    assert!(!b.programs.iter().any(|p|p.program.name=="remove"));assert!(b.programs.iter().any(|p|p.program.name=="rows"));
    assert!(bridge.changes.iter().any(|c|c.contains("cascade/set-null")&&c.contains("E_OP")));
}

#[test]
fn exact_source_accepts_a_proved_stable_dominating_column_audience_require() {
    let old="table docs:\n  body: text <=40\n  public\n  insert <- allow\n  online only\nmutation add(body: text <=40):\n  require viewer = 'alice' else FORBIDDEN\n  return insert docs {body}\n";
    let current=old.replace("body: text <=40\n","body: text <=40 write <- viewer = 'alice'\n");
    assert!(release_bridge::exact_write_authority(&[("schema.q".into(),old.into())],&[("schema.q".into(),current)]).is_ok());
}

#[test]
fn enum_alias_reverse_projection_avoids_an_unneeded_rollback_view() {
    let old="table tasks:\n  label: text <=40\n  state: enum('queued','done')\n  public\n  online only\n";
    let current=old.replace("label: text <=40","title: text <=40 renamed from label").replace("'done'","'ready'")+"alias tasks.state 'done' = 'ready'\n";
    let before=vec![("schema.q".into(),old.into())];let after=vec![("schema.q".into(),current)];
    assert!(compile(&after).diagnostics.is_empty());assert!(!release_bridge::requires_view(&before,&after));
}

#[test]
fn exact_source_stable_role_guard_survives_control_flow_and_boolean_audience() {
    let old="table roles:\n  principal: principal\n  role: enum('planner','owner')\n  unique principal\n  public\n  online only\ntable docs:\n  body: text <=40\n  public\n  insert <- allow\n  online only\nmutation add(body: text <=40, again: bool):\n  require exists roles[principal = viewer, role = 'planner'] else NO\n  if again:\n    insert docs {body}\n  return insert docs {body}\n";
    let current=old.replace("body: text <=40\n","body: text <=40 write <- exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'planner']\n");
    let before=vec![("schema.q".into(),old.into())];let next=vec![("schema.q".into(),current)];
    assert!(release_bridge::exact_write_authority(&before,&next).is_ok());
    let unstable=old.replace("  if again:","  if again:\n    delete roles[viewer]");
    assert!(release_bridge::exact_write_authority(&[("schema.q".into(),unstable)],&next).is_err());
    let wrong=old.replace("= 'planner'] else NO","= 'owner'] else NO");
    let planner=next[0].1.replace("exists roles[principal = viewer, role = 'owner'] or ","");
    assert!(release_bridge::exact_write_authority(&[("schema.q".into(),wrong)],&[("schema.q".into(),planner)]).is_err());
}
    // pointer. The next activation records it transactionally.
    match std::fs::read_to_string(dir.join("current")) {
        Ok(text) => text
            .trim()
            .parse()
            .map(Some)
            .map_err(|_| "invalid current release file".into()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("cannot read current release: {e}")),
    }
}
pub(super) fn bound_at(root: PathBuf) -> Result<snapback4_lang::Bound, String> {
    let project = Project { root };
    if project.sources().map_err(|e| e.to_string())?.is_empty() {
        return Err("release has no Quarry source; select a complete immutable release".into());
    }
    let bound = project.compile().map_err(|e| e.to_string())?;
    if !bound.diagnostics.is_empty() {
        return Err(bound
            .diagnostics
            .iter()
            .map(ToString::to_string)
            .collect::<Vec<_>>()
            .join("\n"));
    }
    Ok(bound)
}
fn check_change(
    dir: &Path,
    previous: Option<u64>,
    bound: &snapback4_lang::Bound,
    options: &Options,
    target_release: Option<u64>,
) -> Result<(), String> {
    if target_release.is_some() {if let Some(n)=previous {
        let current=Project{root:dir.join("releases").join(n.to_string())}.sources().map_err(|e|e.to_string())?;
        let target=Project{root:dir.join("releases").join(target_release.unwrap().to_string())}.sources().map_err(|e|e.to_string())?;
        snapback4_lang::release_bridge::exact_write_authority(&target,&current).map_err(|e|format!("E_ADOPT: {e}"))?;
        let latest=latest(dir)?;
        if latest!=n {let source=Project{root:dir.join("releases").join(latest.to_string())}.sources().map_err(|e|e.to_string())?;
            snapback4_lang::release_bridge::exact_write_authority(&target,&source).map_err(|e|format!("E_ADOPT: latest source {latest}: {e}"))?;
        }

    }}
    if !options.flags.contains_key("check") && options.flags.contains_key("verbose") && let Some(n) = previous {
        let old = bound_at(dir.join("releases").join(n.to_string()))?;
        let store = snapback4_core::store_port::AnyStore::open_read_only(&dir.join("store.sqlite")).map_err(|e| e.to_string())?;
        let target_label = target_release.map(|n| format!("release {n}")).unwrap_or_else(|| "the new release".into());
        let lines = super::release_narration::compatibility(&store, &old.schema, &bound.schema, n, &target_label, target_release.is_none())?;
        for line in lines {
            eprintln!("{line}");
        }
        if target_release.is_some() {
            for warning in snapback4_lang::client_contracts::compact(&snapback4_lang::client_contracts::compare(&old,bound,&format!("release {n}"))) {
                if snapback4_lang::client_contracts::is_note(&warning) {eprintln!("NOTE {warning}");}
                else {eprintln!("WARNING {warning}");}
            }
        }
    }
    if options.flags.contains_key("allow-destructive") {
        eprintln!(
            "deploy/rollback retain storage; --allow-destructive does not bypass validation or prune. To drop dormant storage: snapback4 prune {} --allow-destructive",
            dir.display()
        );
    }
    Ok(())
69:pub const KEYWORDS: &[&str] = &["language", "from-sql", "app", "types", "recipes", "rule-recipes", "time", "indexes", "maintains", "totals", "offline-interactions", "rules", "sync", "sharing", "residency", "prediction", "evolution", "rename", "deploy", "release-json", "expire", "ephemeral", "assets", "client", "api", "wire", "social", "reads", "shapes", "writes", "cleanup", "sequences", "programs", "jobs", "native", "feeds", "search", "effects", "actions", "routes", "services", "presence", "receipts", "read-only", "manual-receipts", "bounds", "refusals", "personas", "testing", "witness", "start", "cheatsheet", "changes", "production", "staging", "security"];
78:    ("release", "deploy"), ("serve", "deploy"), ("rollback", "deploy"), ("upgrade", "changes"), ("optional param", "types"), ("mutation default", "writes"), ("service seat", "deploy"),
130:    ("releases", "deploy"), ("prune", "deploy"),
266:        "release-json" => include_str!("guide/release-json.md"),
397:fixture, offline `token`, `deploy`, `rollback`) lock its `-owner` sidecar for their lifetime.
446:`snapback4 doctor --repair-expiry-orphan table:id` (add `--release dir` for deployed
687:List placement and release reserve four examinations, two writes, eight steps
788:Removing an element releases it; reordering keeps its home and view history;
789:deleting the row releases all.
863:or frozen Expo responses, without modifying the response or its prototype.
902:A released or unreadable home reports `E_ASSET_UNKNOWN` on download;
911:until placed, one home, served by that row's read rule, released on delete,

exec
/bin/bash -lc "rg -n 'requirements|leading|dominat' snapback4/crates/snapback4-lang/src/*invariant* snapback4/crates/snapback4-lang/src/bind/*invariant*; cat snapback4/crates/snapback4-lang/src/guide/deploy.md" in /home/ccheever/projects/sb4-b27-rel
 succeeded in 0ms:
rg: snapback4/crates/snapback4-lang/src/*invariant*: No such file or directory (os error 2)
rg: snapback4/crates/snapback4-lang/src/bind/*invariant*: No such file or directory (os error 2)
# Deploy: upgrade, real accounts and schema evolution

A release is immutable source over one durable store. JSON fields, bounded ready waits and worker roots: `guide release-json`. Deploy from the app directory:

```sh
bunx snapback4 check
bunx snapback4 test
bunx snapback4 deploy ./deployment
bunx snapback4 serve ./deployment --port 4400
```
For Postgres, prefer `SNAPBACK4_STORE_URL` with explicit schema/ha=none and Unix sockets; a password in `--store-url` is visible in process arguments. Serve requires `--worker-state-dir /absolute/durable/path` or `SNAPBACK4_WORKER_STATE_DIR`. Queries, identified writes, sessions, ephemeral state and ordinary maintained count/sum columns are admitted. A deploy may add, redefine or drop those columns and indexes on them; it atomically recounts sources and mirrors parents before publishing the generation. Ordinary releases may also add tables, add optional or literal-defaulted columns, add/drop/redefine indexes, and retire ordinary tables or columns into dormant storage. Use `deploy DIR --restore-dormant` to restore retired names and their exact rows/values. A restored column must repeat its retained declaration: changing its type, default, text constraints or deletion policy refuses just as an in-place edit would. Unique collisions refuse the whole activation. Ordinary Postgres schema evolution currently refuses `evolution-authority` when the schema contains a durable temporal, read-through or recorded table, including an unchanged one. Their activation-time source retirement needs the later lifetime slice. Previously admitted maintained-column transitions with unchanged ordinary declarations remain available. Existing column types/defaults, rules, audiences and other authority declarations must stay unchanged. Type narrowing, backfills, renames, temporal/read-through/recorded evolution and retirement of tables with maintained columns remain named refusals. Token minting (`token`), SQL/data and release inspection, rollback, previews, prune, staging, saved versions and hot activation refuse; excluded runners, certified sync and complete configuration: `guide release-json`. SDK guest/signup/login and proof seedAccounts retry explicit identity 429 refusals using retryAfterMs (Retry-After for older servers). Sign-in has at most four attempts within timeoutMs (default three minutes); signal cancels requests/waits. No lost or malformed reply is replayed. Time-gated mutations on the real clock need a bounded retry of the authored refusal (for example `NOT_OPEN`), with a deadline and short delay; never retry unrelated refusals. Development and classified staging proofs can advance the clock (`guide time`); production always uses wall time.

Managed storage refuses foreign triggers, rewrite rules or row security with
`E_STORE` / `SNAPBACK_MANAGED_RELATION_INTERCEPTION` on open, activation,
reconnect and `doctor`, including foreign incoming foreign keys. Remove the
reported interception and retry. Snapback's own index-key and device-residency
triggers require their exact installed definitions; only recognized legacy
constraints and their exact built-in triggers are admitted. Database event
triggers are allowed; activation checks their managed-relation effects after
installer DDL before moving data, and again before committing.

Runtime DDL on managed relations while serving is explicitly outside the
store fence model. Owner/head locks do not prevent external DDL, and admission
does not poll catalogs on each request. Doctor and the next open, activation
or connection replacement detect such changes.

For a single-owner Linux Postgres deployment, zero-flight revision-cache hits
are opt-in through `SNAPBACK4_READ_GRANT_CLOCK_BOUNDS=rate_ppm,forward_jump_ms`.
These numbers declare a guarantee: during any grant, database time advances at
most `(1 + rate_ppm/1000000) * CLOCK_BOOTTIME_elapsed + forward_jump_ms`, including
suspend and every supported failover. They are not tuning estimates. For example,
`1000,250` declares a maximum 0.1% relative rate excess and 250 ms cumulative
forward adjustment; the three-second grant gets a local deadline below 2.747 s.
Use this only when the deployment guarantees those bounds and all writers run
the grant-aware protocol. Unset it for arbitrary clock steps, unqualified failover
or mixed versions. The ordinary one-statement G5 validation remains the default.
A grant hit rechecks bearer authority and expiry with a fresh clock. Every local
commit invalidates revision equality. Grant loss falls back to database reads;
unknown COMMIT stops cached reads and new writers until fenced reacquisition
with a fresh process/epoch. Graceful release drains cached reads first.

## Upgrade
`snapback4 upgrade [version]` resolves once and exactly pins core and installed Expo adapters with npm/bun/pnpm. Rebuild native apps after adapter changes; commit the lockfile, run check/typecheck/acceptance. `test` uses ./fixtures; `--fixture dir` overrides it. Use the password and first-admin recipes below.

## Deploy and password identity (SQLite)
Add `use identity password` (below). Serve admits bearer sessions; personas are 401 and /seed/dev doors 403, even through proxies. Signup creates an account, not a privileged role. See guide client for SDK session stores; auth/headless for account setup. HTTP auth returns session/denied; SDK signup/login from `snapback4/auth` returns ok/why. Check warns on installed version skew.
```sh
U=http://127.0.0.1:4400
curl -s "$U/auth/signup" -H 'Content-Type: application/json' -d '{"email":"admin@example.test","password":"replace-with-a-private-password"}'
# {session:{principal,kind,token,expiresAt,scope}}
curl -s "$U/auth/login" -H 'Content-Type: application/json' -d '{"email":"admin@example.test","password":"replace-with-a-private-password"}'
```
Keep the session and send `Authorization: Bearer <token>`. Wrong credentials or a disabled identity method are 401 E_AUTH. Sessions survive ordinary deployments and restarts until expiry/revocation; a replaced/reset store requires sign-in again. Never delete a store to make adoption pass. `serve --port N` accepts 0 or A-B; stdout's first line is its URL, stderr includes SNAPBACK4_READY. Wait for readiness. Layout: releases/N/ holds source; store.sqlite data/sessions/queues; assets/ uploads. The database owns current release/history; current is a text convenience copy, releases.jsonl a convenience ledger. Back up the whole directory, including sidecars/assets/releases, with serve and external workers stopped (CLIENT-AND-OPERATIONS.md §6). A restore does not rewind external effects.

## First admin: a service seat (SQLite)
Provision roles through an operator seat, with no public first-user race:
```quarry
use identity password
table admins:
  principal: principal
  unique principal
  immutable principal
  sync
  read <- .principal = viewer or viewer = 'service:ops'
  insert <- viewer = 'service:ops' or exists admins[principal = viewer]
mutation grantAdmin(principal: principal):
  return insert admins { principal }
table notes:
  owner: principal
  body: text <=200
  archived: bool default false
  status: enum('draft', 'live') default 'draft'
  read <- .owner = viewer
  insert <- .owner = viewer
```
```sh
TOKEN=$(bunx snapback4 token --service ops --release ./deployment)
curl -s "$U/m/grantAdmin" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"args":{"principal":"user:SIGNED_UP_ID"}}'
unset TOKEN
```
This roster is synced. A whole service-seat branch may add the first member; ordinary callers must already hold the roster. Service grants add no device audience. The seat's own program lookups and `exists` obey read rules too: to inspect a roster, add `or viewer = 'service:ops'` to its read rule, as above. A rule probe has authorization visibility; a program probe does not. The mutation completes before the grant syncs; wait for the enrolled account's client to receive its scope before using offline staff reads. A synced row has at most one group-roster audience: cross-table crew grants are not a second group. Enroll those readers in the same roster or keep the table `online only` (`guide rule-recipes`). Mint locally against the same store. Token stdout is only the credential; prose is stderr. Protect it; it expires under the seat-session policy. Rotate the credential by revoking its session (guide services) and minting a replacement. Expired or revoked bearer sessions cannot invoke the mutation. A repeat grant hits uniqueness; add membership revocation deliberately. Programmatic account sessions use `mintSession(url, serviceToken, principal)` from `snapback4/worker` (guide services); service seats themselves are minted locally by `token`.

## Migrations and adoption (SQLite)
Optional/defaulted columns, new tables/ops, non-unique indexes and wider types are additive. Required new fields need a literal default or a declarative `backfill table name(fields: types): {column: expression}`; default now/viewer cannot invent historical values. Dev check/adoption refuses incompatible values with E_ADOPT. Release type narrowing instead retains each row whose present values cannot fit. Unique/cap conflicts still refuse atomically; repair active rows, or restore through a widened non-unique bridge, repair, then reinstate constraints. Prefer expand → migrate → contract for client compatibility. Generations climb on actual switches, including rollback/forward; identical execution content is a no-op.

For a complete field/enum rename with stored edits and v2-native rows, run `guide rename`.

## Which migration shape survives edits and rollback?
Choose the shape before writing a migration:

- **Only a spelling changed, with identical types?** Use `renamed from`; `$rename:down` presents the edited scalar under its old name, while file/reference homes and lifetimes stay put. Preserve frozen endpoint/result wrappers separately.
- **A historical value must be computed?** Use a named `backfill`; every input and lookup reads the assembled pre-patch row/snapshot before simultaneous patches, so a renamed destination names its historical source. Retain a declaration while its meaning holds, rename a different transform, and use digest-bearing refusals; pruning never resets a name.
- **The current value needs a truthful old representation?** Declare `down`; it reads the assembled newer snapshot when leaving it. Exact forward preimages and nonnull retained old cells win, except a generated identical-type rename presents the current value. Preview both directions after edits.
- **An image/file/list moved into a child record?** Use `extract CHILD from PARENT via REF`; scalar transforms cannot duplicate assets, and one child per parent differs from `each` list elements (`guide evolution`).
- **The old domain cannot hold null media, a new enum or wider money?** Keep a widened rollback view or authored bridge with current guards. Exact old source may retain dormant rows but cannot invent truthful values. Inspect the registered view and use `--exact` only deliberately.

Preview rollback after a v2 edit, forward after a v1 edit, and v2-native rows without a v1 preimage. A bridge keeps current value and old workflow until authorized repair. `prune` discards migration preimages and dormant data, names blinded `down` projections, and can make reversal/re-entry refuse; keep history or a backup.

## Rollback after widening, restore and prune (SQLite)
```sh
bunx snapback4 rollback ./deployment --to 1 --check
bunx snapback4 rollback ./deployment --to 1
```
`deploy ./deployment --check` previews deploy direction and restoration intent. `bunx snapback4 check --store ./deployment/store.sqlite --release 1` also previews a selection; `bunx snapback4 releases ./deployment latest` inspects it. Forward with `bunx snapback4 rollback ./deployment --to latest`. Preview runs exact adoption on a private disk snapshot and removes it, without activating; disk/time scales with the store, and later writes can change the plan. Release is immutable source; latest is the highest successfully adopted source even after rollback. A refused deploy removes its candidate directory and private stage. An ambiguous reply preserves source until committed history resolves the outcome; inspect releases before retrying. Bare rollback selects the previously active release; rollback prints the resolved target before preview or activation. Generation is a monotone identity; releases N/latest inspects source. Source identical to an active ordinary release is a no-op; a deploy equal to an ordinary release selects that release when its rollback view is live. source matching a retained release reactivates its existing id with restoration and full validation. Deploy/rollback return after serve switches: `release N is current as generation G`. In-flight one-shot operations finish in their generation; no settle sleep is needed. Default adoption is one measured receipt; --verbose/--json includes phases/cache advice. N_ADOPTION_PAUSE appears above one second. Deploy/rollback wait up to five seconds for a shutting-down store owner before admission; live serve keeps its authenticated control path. A remaining owner refuses with E_STORE_BUSY; stop that owned process before retrying. Failed or ambiguous activation is never automatically replayed. `await host.stop()` from startServe waits for its native child and the kernel store lock, including delayed worker cleanup, before resolving. `snapback4 stop ./deployment` asks the retained owner to shut down through its same-owner private control socket and waits for the store lock; it never signals a recorded PID or removes a lock. `serve ./deployment --wait-stopped` remains the bounded five-second lock barrier after a caller has already requested shutdown; it neither stops a process nor opens SQLite. It refuses other serve flags. A timeout rejects cleanup rather than claiming the store is free.
Widened enum values, or short codes a loose release wrote, become dormant rows when selected types cannot hold them; compatible forward restores exact values. Reference dependents also leave the active population. Rules, counts, maintained views and reacquired sync partitions see only active rows. Point reads/updates/ deletes see absent rows; dormant ids stay reserved. Nominal reference values stay legal, as for other missing ids; require/read-through decides live-target admission. Dormant rows occupy no cap/unique slots, so older writes can require a bridge repair. Removed tables/columns/indexes also stay dormant. Fresh-source name reuse needs --restore-dormant; selecting retained source by deploy or rollback already selects restoration. The same --restore-dormant flag is accepted by both commands. Old active updates keep dormant cells; active deletion removes them. Only active referential actions run: parent deletion invalidates dormant lifetimes. Narrowed rows with invalid visible references stay dormant; whole-table/column restoration retains its E_ADOPT barrier. Prune previews counts/bytes/sample ids; `prune ./deployment --allow-destructive` permanently drops all dormant storage. No age collector or implicit pruning exists. Deploy/rollback --allow-destructive bypasses neither validation nor retention. --allow-feed-adoption permits the explicit feed launch. Inspect releases after an ambiguous reply. Details: [SERVER.md — Release lifecycle](SERVER.md#release-lifecycle).

`releases --json` reports `live.{source, view, exact}`: source is the logical ordinary release, view is the selected compiled-view id or null, and exact distinguishes original source. A view also names its registration parent. Default view writes use its compiled guarded workflow, including current defaults/operations when retained; `--exact` requests the immutable original source and still enforces write-authority compatibility.

## Visible rollback by default (SQLite)
Deploy prepares compiled rollback views when a predecessor cannot hold newly allowed values. An implementation repair behind unchanged data/intent declarations also prepares a view. A new column write audience alone does not; exact historical writes must preserve its rule or selection refuses with the operation and column. These views retain the complete authored current schema, helpers, programs and policy while admitting old names and inputs; unsupported mappings require authored compatible guarded source. Old inputs may fit wider same-format text/list bounds or omit new optional arguments. Incompatible old write exports pause with E_OP; required queries need a compatible endpoint. Removed data-bearing inputs need a consuming compatibility endpoint, never deprecated-and-discarded inputs. `rollback --to 1` selects release 1's registered view in the active deployment's context, retaining current guards and widened domains; each move prints a stdout `live:` line naming the selected source or registered view. A view retains current guards; its operation surface can be the guarded old workflow or the complete current workflow. Inspect its immutable source and preview checklist before depending on an old write. The original source remains immutable. After upgrading the CLI/runtime, restart an older running serve before switching releases; an older host refuses the new custody control feature before admission. `--exact` deliberately selects that source and reports its dormant population. Newer views never become ordinary latest. If a guard cannot be transported safely or a view cannot compile, deploy refuses until source supplies a compatible workflow. Nullable old results remain a client compatibility change: render an amount still to follow as pending, never zero. Optional media must remain optional in old UI consumers. Intentional null hiding uses `rollback 1 hides orders where fee = null because 'An unquoted fee must not look free.'` in candidate source. The writer permits only those null rows and their actual hidden-reference dependents. Widened nonnull values still stay visible. Removed defaulted fields require truthful `down` expressions; previews suggest cross-table candidates for moved values, never silently show a misleading old default. Snapshot previews do not freeze later writes: activation revalidates under its writer transaction.

## Bridge a safety gate before exact rollback (SQLite)
Use this beside the enum-widening rollback recipe above. Suppose v2 added `grounding.state = 'inspection'`; v1 holds only `'clear'`/`'hold'`. Selecting exact v1 hides that row and its children, so v1's `book` guard may allow a booking that v2 blocks. Counts and sample ids are snapshot dependencies, not predicate matches; later writes can change the plan.

1. Start from the old UI/operations, but keep v2's widened `grounding.state` domain, safety table, read audience and booking `require`. Save this complete source as `versions/bridge/schema.q` and deploy it with `deploy ./deployment --schema versions/bridge/schema.q --check`, then without `--check`.
2. While the gate still runs, migrate each inspection to a truthful old-domain hold through an authorized bridge mutation. Do not relabel it clear just to satisfy v1. Keep linked metadata until its parent can be safely represented; if v1 cannot invalidate newer metadata, keep that behavior in the bridge too.
3. Prove the same booking/payment still refuses for the blocked case and that the named lists/counts preserve the intended business denominator. Re-run the final old-source preview against the repaired live population.
4. Select v1 only when those checks pass. If the old source cannot preserve the invariant, keep the bridge or pause that workflow. Retained storage cannot supply absent logic.

## What the old release sees (SQLite)
| Request after rollback | Result |
|---|---|
| An operation absent from the old release | HTTP 404 `{denied:{code:"E_OP"}}` |
| Bare point query of a dormant row | Reads null |
| Point query or mutation with an explicit `! else CODE` guard | Refuses its guard code (`NOT_FOUND` when authored that way) |
| Added columns after rollback | Ignored by the older release; their cells stay dormant |
| Counts, rules, maintained views and sync | Only the active population |
| Compatible forward to the newer release | Original dormant values restored |

These dormant-row outcomes require `rollback <deployment> --to 1 --exact`. A registered default view keeps widened old-table rows visible with the current guard. Ordinary renames, required-field additions and splits with a fitting down do not require a view merely because the app declares an invariant. A needed view uses the current workflow or a compatible loosened bridge with current guards. A guarded current view names removed nullable fields as absent results and removed writes as E_OP; author a compatible current endpoint to keep an old write available. On a pre-0.4.39 store, a refusal names `rollback <deployment> --to N --exact` and "redeploy with 0.4.39 to register a view"; preview exact selection with --check before accepting its historical behavior. Absent operations still return E_OP. Test audiences and guards with real accounts. Rollback previews lead with records hidden from tables the target release has, then empty/defaulted legacy cells and newer-only table rows. Counts precede read rules; they do not infer birth release or a viewer’s query result. Declare a reverse projection for a truthful old representation, or keep a bridge. Guard/refusal and query/count/safety diffs follow. Verify filtered/paged/per-viewer results and denominators. Literal-default backfills print `table.column ← value on N rows` in previews and cold/hot deploy receipts: interpreted historical fields, not physical writes. Preview shows old and new rule clauses and mutation `require`s side by side, preserving Boolean parentheses. A proved tightening is a note, including `require A else X` becoming `require A else X; require B else Y` when A's refusal contract is unchanged; changed codes/messages still warn. A loosening or unproved implication is a WARNING, including rollback that removes a new guard. Unchanged clauses and consulted keys, fields, rules, auth and visibility are silent. Unread column domains and forward domain widening do not unprove a probe; narrowing still gets exact dormant-value/population warnings. Changed dependencies group once: verify refusal cases. Comparison never changes admission. Missing operations/schedules, populated removed tables, changed clauses and job bodies are named separately. An unchanged job compiling differently after a dependency change gets a note. Predicate-only read-through changes preserve bound captures and parent lifetimes; structural capture changes and new uncaptured rows still need safe audience correspondence. Receipts and previews count storage by kind: `1 row, 2 cells, 0 index entries dormant`. Dormant rows cover their retained cells; standalone cell counts/samples belong only to active rows. Bytes/assets follow the same disjoint ownership. Samples are labelled and unique within each kind/path, for example `rows notes [A]; cells notes.color [B, C]`. A retained index definition represents logical entries to rebuild, not a dormant physical index. A widening note describes values later writes could use; a compatibility WARNING counts only current values the selected release cannot hold. Compatible forward has no such warning.

## Clients across rollback (SQLite)
Save versions/v1/schema.q (and any other .q modules with their original names) outside snapback/ and create `snapback/client-compatibility.json` containing `{"baseline":"versions/v1","since_release":2}`. `check`/`dev` emit added row/result fields as optional, labelled "Since release 2", retaining older result value domains. Required operation parameters remain required; only declared optional, defaulted or deprecated arguments may be omitted. Baseline generation warns about real old-client input breaks and changed/removed result domains; a declared table rename preserves reference input identity, and purely additive result fields print a RESULT NOTE. This is your release label, not server generation; ordinary types stay required without opt-in. Use `row.color ?? "none"` for the baseline fallback. Keep contemporary fixtures in versions/v1/fixtures/; deploy with `--schema versions/v1` and test with `--source versions/v1` (guide testing). Baselines resolve from the original project root, including saved-source deploys.

`useRelease()` from snapback4/react follows the authenticated catalog even when query gates are closed: loading, denied, or `{generation, operations, tables}` with public argument/field shapes. Generated `api.op.available(release)` is false while unready or when name/kind/existing-argument signatures differ or the server adds a required argument; extra optional served parameters are compatible. This checks capability, not authorization or unchanged business semantics; still handle E_OP/E_INPUT and authored guard refusals when a switch races it. The SDK withdraws old metadata on observed generations, polls while subscribed, and returns loading offline/on catalog failure; account retirement/close withdraws it. Keep draft state above generation-sensitive read/action gates; remount only the gated children. Dormant means unavailable on this release, not deleted. Test v2 → v1 → v2 with one frontend: field fallbacks, missing operations, retained drafts and restored values. Alternatively check selected immutable source in a separate copy and rebuild its matching frontend. Preserve deployment source; Expo/Exact runtime changes also require a device rebuild.

## Trigger a deployed job (SQLite)
A running serve accepts `POST /jobs/<job>` with a full service token; the job executes as the system on its FIFO queue and server clock. Every full service seat can trigger system jobs, so provision these tokens only to trusted operators. Guest/account sessions, read-scoped tokens and personas cannot use this door. `POST /dev/jobs/<job>` remains development-only.
```sh
export SNAPBACK4_SERVICE_TOKEN=$(bunx snapback4 token --service ops --release ./deployment)
bunx snapback4 run reconcile --release ./deployment --json
unset SNAPBACK4_SERVICE_TOKEN
```
`--token-env NAME` reads another environment variable. The command uses served source, so it also works outside the app directory. A lost reply is ambiguous; inspect the queue before retrying. Starter/client recipes: `guide client`.

Real-account production and its durable role/restart/rollback proof: `guide production`.

## Inspection, proxies and TLS (SQLite)

`data TABLE --release ./deployment --json` returns `{rows, more, limit}`. The default limit is 50; `more:true` means the snapshot was truncated. Increase `--limit N` to inspect more; `--limit 0` returns no rows and reports whether any exist. Non-JSON output remains one row per line. `snapback4 sql 'SELECT id, archived FROM notes' --release ./deployment --json` returns positional rows under `columns`; `--json-objects` returns object rows with direct booleans and schema-proven media columns decoded to ordinary wire JSON. Positional `--json` retains tagged media text. Schema-qualified relations, recursive or shadowing/forward-reference CTEs need positional --json. A truncated JSON query reports its repair on stderr without corrupting stdout. Default `sql`, `data` and `releases` output also reports a nonzero dormant-row count on stderr; a missing active table names its retained rows and the concrete dormant query. `sql --dormant --release ./deployment` shows retained rows/cells, including removed tables; `sql --all-releases --release ./deployment` adds active images. `_snapback_state`, `_snapback_source` and `_snapback_columns` identify provenance and provided cells; these are retained images, not historical snapshots. Both modes are read-only; internal tables remain unavailable. Inspection bypasses read rules and can show expired stored rows; it is an operator tool, not an app query surface. Bind loopback behind a TLS proxy. Forward Authorization and preserve response bodies; allow long polls without buffering or early timeouts. Non-loopback HTTP requires `--i-understand-cleartext` and a trusted private hop behind TLS. Identity rate keys use the socket peer, not forwarded headers. Serve refuses personas and dev doors even through a local proxy; see SERVER.md for capacity. `--json-objects` returns `{header, columns, rows, limit, more, ruleFiltered:false}` with object `rows`; `--json` uses positional `rows`. Put flags outside the quoted SQL. N_NO_PRODUCTION_WRITER means no production insert path can bootstrap this table. It groups root blockers with their dependents; persona-only schemas get one identity note. Add a service-seat insert mutation and provision real account relationships. E_UPGRADE means installation or post-upgrade check failed. Repair the package-manager or registry error and rerun upgrade. Packages may already be pinned: if check failed, repair the reported schema/device refusal and rerun check.

## Capture a saved version (SQLite)
After check and business cases pass, from the app root:
```sh
snapback4 deploy ./deployment --save-version versions/v1
snapback4 rollback ./deployment --to 1 --check --bridge ./bridge
snapback4 deploy ./deployment --schema ./bridge --restore-dormant --check
```
The new versions/v1 captures selected modules, their contemporary fixtures, an importable `versions/v1/generated/api.ts` plus its package marker, and `versions/v1/release.json` with the actual immutable release id, source hash and CLI version. An unchanged deploy keeps its id and may refresh those derived generated/label artifacts only when the saved directory's complete Quarry source set and bytes exactly match the selected source; source and fixture evidence stay intact, and differing source refuses. Choose a new positive-numbered versions/vN for changed source; saving cannot combine with --check. Saved-source deploy uses its own fixtures and emits the saved source's API rather than the working tree's API. Use the recorded id when choosing a baseline; since_release remains the author-supplied newer-schema label. The bridge starts from complete target Quarry operations with compatible value domains loosened to include current data, retaining new tables with their current rules, plus this app's `bridge/ROLLBACK-CHECKLIST.md`. Retain current domains, audiences, guards and quotas; repair records through authorized mutations; prove blocked cases refuse and affected lists/counts remain correct; repeat the old-source preview. No bridge is activated or business migration synthesized. JSON includes checklist; --verbose retains full evidence/index paths. Dormant rows reserve ids but no unique slots: new active rows may block restoration. A widened non-unique bridge permits repair before reinstating uniqueness; retained storage cannot supply absent safety logic.

Hot deploy and rollback require the running `serve` host to support this CLI's activation protocol, including `--exact` selection of original source. If `E_RELEASE_RUNTIME` says the host predates release custody, restart `serve` with this CLI and repeat the command; the mixed-version request refuses before activation.

## Keep v1 clients working (SQLite)

`deploy --check --json` reports `clientCompatibility` separately from data adoption: missing operations, changed kinds, required new arguments, removed or narrowed inputs, result shape/value changes and changed refusal codes/messages. Deploy prints the same warnings. Input breaks name the old release and the E_INPUT/E_OP outcome. A result or behavior review asks you to verify the intended contract; a correct new privacy denial is intentional behavior, not an input shape failure. The comparison is conservative, not a proof of unchanged logic. For example, save this v1 source and its callers sending `{name:"Ada",obsolete:"old input"}` to `greet`:

```quarry
use identity guests
query greet(name: text <=40, obsolete: text <=40):
  return {message: name + '!'}
```
Deploy this v2 source. The unchanged v1 call still returns `{message:"Ada!"}`; new callers can use `greeting` and omit `suffix` and `obsolete`:

```quarry
use identity guests
query greeting(displayName: text <=40 alias name, suffix: text <=1 default '!', obsolete: text <=40 deprecated):
  return {message: displayName + suffix}
alias greet = greeting
```
`alias name` maps the old argument to `displayName`; supply either spelling, never both. Use the alias for renames; `deprecated` deliberately discards its value. A literal default handles omitted or null arguments and must fit the declared scalar type; explicit non-null input still validates. `deprecated` accepts a validated optional argument but forbids referring to it in the body. Unknown arguments still refuse. These modifiers apply to non-native Quarry queries and mutations; helpers, actions and jobs keep their distinct invocation contracts. Aliases target an authored query/mutation in the same module, carry the same rules/guards/results, and cannot chain. Retain the old endpoint until its callers have retired; preserve the old result projection and handle intended denials.

Deploy registers a compiled visible view for widened domains and relaxed unique keys, or refuses unsupported adaptation. It also reports remaining reverse-projection risks: dropping a required old column or widening a value domain can strand newly written rows. The preflight separately attempts exact reverse adoption on its post-deploy snapshot, naming present-data failures. Keep old fields and compatible domains in an expand/contract bridge; after writes run the named `rollback <deployment> --to N --check --bridge <new-dir>` before selecting N. A green snapshot never freezes later writes.

## Persistent production: SQLite v1 → v2 → rollback → forward

Replacement transforms read reversible preimages; input types cover original/native rows. `down table name(typedInputs): {oldField: expression}` declares a reversible old view for newer rows; exact old preimages win, conflicting projected-cell edits refuse forward. Native preimages and old-view outputs must be authoritative scalars; use separate scalar columns instead of replacing a reference, asset, collection or lifetime field. Reference inputs retain their parent lifetimes across older views; deleted/reused parents refuse forward. Unrepresentable values stay dormant. `newField: Type renamed from oldField` carries a scalar cell both ways; asset columns and asset lists move their actual cell and single home together. Reference renames require identical target/type and preserve their reference lifetime; the selected release supplies its on-delete policy and retain lifetime evidence; engine-owned moves refuse before activation; keep old operation/result wrappers where clients need them.

A table declares `table observations renamed from behaviors:` to preserve its row/reference identity and old-release writes; it refuses merging independent table histories. Ordinary backfill expressions may read indexed cross-table `exists` or unique points against one pre-patch snapshot. The language-card example uses migration-only `fileText(file)` with `nonemptyLines(text)` for repeated nonempty UTF-8 entries; unavailable bytes, invalid UTF-8 or a job-meter cut refuse atomically. It never supplies ordinary mutation-time file validation. Active writes refresh accepted backfill inputs; older-release edits still need recomputation agreement or conflict repair. An absent optional rename destination is not a conflict.

Computed `down` cannot replace files/images, asset lists, references or a missing table. Required → optional media, an album becoming empty, or nullable money needs a generated loosened-target bridge when no truthful scalar substitution exists. Review target operations reading loosened columns and nullable UI assumptions. Keep current safety guards absent from the target; retaining new tables does not make them visible through frozen old operations. Automatic registered views handle compatible widenings. For an authored bridge, deploy it as a new release with `--restore-dormant`, first with `--check`.

Save this script and run it with Node. `PRODUCTION_DIR` selects its persistent store; reruns preserve rows/users. It proves backfill, privacy and rollback/forward behavior. This example widens the stored weight domain, so deploy registers a view. Default rollback preserves current privacy through that view; `--exact` deliberately restores v1's broader reads after an explicit review. REL5 owns reactivation/old-client reporting; SEC3 owns privacy/audit.

```js
// day-two-production.mjs — this exact fence runs against the packed package.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { cli, deploy, rollback, startServe } from "snapback4/proof";
import { signup } from "snapback4/auth";
const directory = resolve(process.env.PRODUCTION_DIR ?? "production-day-two");
const v1 = `use identity password
table roles:
  principal: principal
  role: enum('member', 'reviewer')
  unique principal
  read <- .principal = viewer or viewer = 'service:operator'
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  online only
mutation provision(principal: principal, role: enum('member', 'reviewer')):
  require viewer = 'service:operator' else NOT_OPERATOR
  return upsert roles[principal] {principal, role}
table tickets:
  owner: principal
  body: text 1..200
  legacy: text <=200 ?
  weight: int 0..5000
  length: int
  read <- .owner = viewer or exists roles[principal = viewer, role = 'reviewer']
  insert <- .owner = viewer
  update <- .owner = viewer
  online only
mutation add(body: text 1..200, weight: int 0..5000, length: int):
  return insert tickets {owner:viewer, body, legacy:body, weight, length}
mutation revise(ticket: tickets, weight: int 0..5000):
  update tickets[ticket] {weight}
query ticket(ticket: tickets):
  return tickets[ticket]
`;
const v2 = v1.replaceAll("weight: int 0..5000", "weight: int 0..10000").replace("  owner: principal", "  vehicleClass: enum('car', 'van', 'commercial')\n  owner: principal")
  .replace("  read <- .owner = viewer or exists roles[principal = viewer, role = 'reviewer']", "  read <- .owner = viewer")
  .replace("{owner:viewer, body, legacy:body, weight, length}", "{owner:viewer, body, legacy:body, weight, length, vehicleClass:'commercial' if weight > 3500 else 'van' if length >= 500 else 'car'}")
  + `backfill tickets vehicleClass(weight: int, length: int):
  {vehicleClass:'commercial' if weight > 3500 else 'van' if length >= 500 else 'car'}
-- Spec: only the ticket owner may revise its weight.
invariant tickets.revise only .owner = viewer
invariant tickets.read only .owner = viewer
down tickets legacyText(body: text 1..200): {legacy:body}
`;
for (const [version, source] of [["v1", v1], ["v2", v2]]) {
  mkdirSync(`versions/${version}`, { recursive: true });
  writeFileSync(`versions/${version}/schema.q`, source);
}
async function checked(args) {
  const result = await cli(args);
  assert.equal(result.code, 0, result.stderr + result.stdout);
  return result.stdout;
}
async function snapshot() {
  const count = JSON.parse(await checked(["sql", "SELECT COUNT(*) FROM tickets", "--release", directory, "--json"])).rows[0][0];
  const full = JSON.parse(await checked(["sql", "SELECT id, owner, body, weight, length FROM tickets ORDER BY id", "--release", directory, "--limit", String(Math.max(1, count + 1)), "--json"]));
  assert.equal(full.rows.length, count, "complete population");
  return new Map(full.rows.map(row => [row[0], row]));
}
if (existsSync(directory + "/store.sqlite")) await rollback(directory, 1, {args:["--exact"]});
else await deploy(directory, "versions/v1");
const host = await startServe(directory);
try {
  const before = await snapshot();
  const users = [];
  for (const role of ["member", "reviewer"]) {
    const signed = await signup(host.url, `${role}-${randomUUID()}@example.test`, randomUUID() + randomUUID());
    assert.equal(signed.ok, true);
    users.push(signed.session);
  }
  const [alice, reviewer] = users;
  async function post(path, session, args) {
    const response = await fetch(host.url + path, { method:"POST", headers:{"content-type":"application/json", authorization:`Bearer ${session.token}`}, body:JSON.stringify({args}), signal:AbortSignal.timeout(10000) });
    assert.equal(response.status, 200);
    return response.json();
  }
  const operator = {token:await host.operatorToken()};
  for (const [index, role] of ["member", "reviewer"].entries()) {
    assert.equal((await post("/m/provision", operator, {principal:users[index].principal, role})).state, "sent");
  }
  const first = await post("/m/add", alice, {body:"historical ticket", weight:1000, length:400});
  assert.equal(first.state, "sent");
  const ticket = first.result.id;
  assert.equal((await post("/q/ticket", reviewer, {ticket})).data.body, "historical ticket", "v1 reviewer can read");
  const historical = await snapshot(); assert.equal(historical.size, before.size + 1);
  const preview = await checked(["deploy", directory, "--schema", "versions/v2", "--check", "--restore-dormant"]);
  assert.match(preview, /vehicleClass/);
  assert.deepEqual(await snapshot(), historical, "read-only preview");
  await deploy(directory, "versions/v2", {args:["--restore-dormant"]});
  assert.deepEqual(await snapshot(), historical, "historical fields preserved");
  assert.equal((await post("/q/ticket", alice, {ticket})).data.vehicleClass, "car");
  assert.equal((await post("/q/ticket", reviewer, {ticket})).data, null, "v2 tightened privacy");
  const oldCall = await post("/m/add", alice, {body:"old-shaped call on v2", weight:4000, length:400});
  assert.equal(oldCall.state, "sent"); assert.equal(oldCall.result.vehicleClass, "commercial");
  const allV2 = await snapshot(); assert.equal(allV2.size, historical.size + 1);
  await rollback(directory, 1);
  assert.deepEqual(await snapshot(), allV2, "native rows preserved"); assert.equal((await post("/q/ticket", reviewer, {ticket})).data, null, "default view keeps current privacy");
  assert.equal((await post("/q/ticket", alice, {ticket})).data.vehicleClass, "car");
  await rollback(directory, 1, {args:["--exact"]}); // Deliberate original-source exercise; default keeps v2 policy.
  const oldView = (await post("/q/ticket", reviewer, {ticket})).data;
  assert.equal(oldView.body, "historical ticket"); assert.ok(!("vehicleClass" in oldView));
  assert.equal((await post("/q/ticket", alice, {ticket:oldCall.result.id})).data.legacy, "old-shaped call on v2", "declared reverse view for native row");
  assert.equal((await post("/m/revise", alice, {ticket, weight:4000})).state, "sent");
  const changed = await snapshot(); const expected = new Map(allV2); const changedRow = [...expected.get(ticket)]; changedRow[3] = 4000; expected.set(ticket, changedRow);
  assert.deepEqual(changed, expected, "only intended edit");
  await rollback(directory, "latest");
  assert.deepEqual(await snapshot(), changed, "complete population preserved");
  assert.equal((await post("/q/ticket", alice, {ticket})).data.vehicleClass, "commercial", "old edit caught up");
  assert.equal((await post("/q/ticket", reviewer, {ticket})).data, null, "privacy restored");
  console.log(JSON.stringify({status:"passed", persistent:true, before:before.size, after:changed.size, backfill:"car → commercial after v1 edit", privacy:"v1 broad → v2 private → default private → exact v1 broad → v2 private"}));
} finally { await host.stop(); }
```
Storage, users and rows survive. Resolve reported conflicts through a truthful bridge.
Deploy and deploy --check lead with a verdict and test status. Changed-scope security review is last, followed by a repeated verdict; full JSON retains all findings. Ordinary check policy belongs to SEC7. The recorded test result includes its age; stale or missing evidence is explicit. Without a matching completed campaign they demand `snapback4 test` for the selected source and fixtures (saved-source previews name `test --source`). Add `--strict` to refuse reachable refuted intent before activation; unproved intent and no-invariant notes remain advisory. A finite campaign is evidence, not proof. See `guide security` for the independent-intent loop.

Migration warnings require a recorded older version crossing the behavior's introduction. Fresh init/check stays quiet; stderr delivery acknowledges the installed version, including CI. Paths cover session literals, advance arithmetic, persistent startDev and data --json. Future known-family store formats refuse with “a newer Snapback (FORMAT)”; upgrade the CLI. SQL inspection also exits nonzero.

`check --store ./deployment/store.sqlite` compiles required rollback views against that deployment without registering them. A configured client baseline is checked too. Source-only check cannot qualify a production transition without a predecessor. New UI starters include `day2:proof`: snapshots compare by id over two cycles, retain v2-native rows, and exclude values deliberately changed by v1-client writes from equal-value comparisons. Add authenticated business/refusal assertions in its hook; the default proves storage conservation only.

exec
/bin/bash -lc "rg -n 'fn dependencies|pub fn dependencies' snapback4/crates/snapback4-lang/src/security -g '*.rs'; rg -n 'column_writes|frozen_columns' snapback4/crates/snapback4-core/src/schema* snapback4/crates/snapback4-core/src/*rules*" in /home/ccheever/projects/sb4-b27-rel
 exited 2 in 0ms:
rg: snapback4/crates/snapback4-lang/src/security: IO error for operation on snapback4/crates/snapback4-lang/src/security: No such file or directory (os error 2)
rg: snapback4/crates/snapback4-core/src/*rules*: No such file or directory (os error 2)
snapback4/crates/snapback4-core/src/schema.rs:41:pub mod column_writes;
snapback4/crates/snapback4-core/src/schema.rs:358:    pub column_writes: BTreeMap<String, RuleExpr>,
snapback4/crates/snapback4-core/src/schema.rs:360:    pub frozen_columns: BTreeMap<String, RuleExpr>,
snapback4/crates/snapback4-core/src/schema.rs:1111:        sequences: Default::default(), column_writes: Default::default(), frozen_columns: Default::default(), column_reads: Default::default(), written_by: Default::default(), update_transition: false, through: None, on_delete: BTreeMap::new(),
snapback4/crates/snapback4-core/src/schema.rs:1139:    issues.extend(column_writes::validate(schema));
snapback4/crates/snapback4-core/src/schema/field_authority.rs:72:        for rule in table.column_writes.values().chain(table.frozen_columns.values()){private_rule(schema,name,rule,false,&mut issue);}
snapback4/crates/snapback4-core/src/schema/reservations.rs:97:    plan.server_only = !table.column_writes.is_empty() || !table.frozen_columns.is_empty();
snapback4/crates/snapback4-core/src/schema/capabilities.rs:79:    ("column-write-v1", |s| s.tables.values().any(|t| !t.column_writes.is_empty() || !t.frozen_columns.is_empty())),
snapback4/crates/snapback4-core/src/schema/column_writes.rs:7:        if self.column_writes.is_empty() || !matches!(effect,Effect::Insert|Effect::Update) { return base; }
snapback4/crates/snapback4-core/src/schema/column_writes.rs:9:        for (column,policy) in &self.column_writes {
snapback4/crates/snapback4-core/src/schema/column_writes.rs:20:        for (column,rule) in t.column_writes.iter().chain(&t.frozen_columns) {
snapback4/crates/snapback4-core/src/schema/column_writes.rs:21:            let path=format!("tables.{name}.column_writes.{column}");
snapback4/crates/snapback4-core/src/schema/column_reads.rs:215:        for rule in table.column_writes.values().chain(table.frozen_columns.values()){walk.rule(name,rule,&path);}

exec
/bin/bash -lc "head -95 snapback4/crates/snapback4-lang/src/release_bridge.rs; rg -n 'struct PolicyComparison|fn align_current_schema|fn rule\\(' snapback4/crates/snapback4-lang/src/release*; rg -n 'pub fn write_tables|enum (Step|Stmt|Expr)|struct Program' snapback4/crates/snapback4-core/src/ir*" in /home/ccheever/projects/sb4-b27-rel
 succeeded in 0ms:
//! A rollback view joins value domains and retains current authored authority.
// @ref LLP 3000.000.000.002#8-wave-21-release-evolution — generated source is reviewable; no automatic business-policy synthesis.
use crate::{ast::{self,TypeKind}, lexer::{self,Kind}, parser, print};
use std::collections::BTreeMap;
pub struct Bridge {pub sources:Vec<(String,String)>,pub changes:Vec<String>,pub diagnostics:Vec<crate::diag::Diagnostic>}

/// Injective current-to-view column identities from authored rename declarations.
/// Shared by index source transport and CLI hard-constraint admission.
pub use super::release_bridge_indexes::column_names as declared_column_names;
pub use super::release_bridge_indexes::align_current_schema;
pub use super::release_bridge_policy::Policies as PolicyComparison;

/// Source-domain inclusion includes text minima/formats, which live outside
/// ColumnType in the compiled schema. Never infer admission from advice prose.
pub fn requires_view(target:&[(String,String)],current:&[(String,String)])->bool {
    // An executable repair behind unchanged data and intent must not restore
    // the old implementation. Ordinary schema/intent evolution is governed by
    // visibility facts below, rather than the mere presence of an invariant.
    if same_data_and_intent(target,current)
        && !crate::compile(current).invariants.is_empty()
        && modules(target)!=modules(current) {return true;}
    let before_schema=crate::compile(target).schema;
    // @ref LLP 3000.000.000#21-wave-27-release-semantics-rel — column authority alone is not a visibility risk.
    let after_schema=crate::compile(current).schema;
    // One historical child is not a uniqueness promise for future parents.
    // Retain the current child population when old source has only one cell.
    if after_schema.extractions.iter().any(|e|!e.each&&before_schema.table(&e.parent).is_some_and(|t|e.fields.values().any(|c|t.columns.contains_key(c)))) {return true;}

    let mut table_names=after_schema.table_renames.iter()
        .filter(|(_,old)|before_schema.tables.contains_key(*old))
        .map(|(new,old)|(new.clone(),old.clone())).collect::<BTreeMap<_,_>>();
    for(new,prior)in &before_schema.table_renames {
        if after_schema.tables.contains_key(prior)&&!after_schema.tables.contains_key(new) {
            table_names.insert(prior.clone(),new.clone());
        }
    }
    let after_schema=after_schema.with_table_names(&table_names).ok();
    let docs=current.iter().map(|(f,t)|parser::parse_document(f,t).0).collect::<Vec<_>>();
    let tables=docs.iter().flat_map(|d|&d.tables).collect::<Vec<_>>();
    let mut aliases=tables.iter().filter_map(|t|t.renamed_from.as_ref().map(|old|(t.name.clone(),old.clone()))).collect::<BTreeMap<_,_>>();
    for(file,text)in target{for t in parser::parse_document(file,text).0.tables{if let Some(prior)=t.renamed_from{aliases.insert(t.name,prior);}}}
    fn normalize(t:&mut ast::ScalarType,aliases:&BTreeMap<String,String>){match &mut t.kind{TypeKind::Ref{table}=>{let mut seen=std::collections::BTreeSet::new();while let Some(old)=aliases.get(table){if !seen.insert(table.clone()){*table=seen.into_iter().min().unwrap();break}*table=old.clone();}},TypeKind::List{item,..}=>normalize(item,aliases),_=>()}}
    if super::release_bridge_constraints::relaxed(target,current) {return true;}
    for(file,text)in target {
        for old in parser::parse_document(file,text).0.tables {
            let Some(next)=tables.iter().find(|t|t.name==old.name||t.renamed_from.as_ref()==Some(&old.name)||old.renamed_from.as_ref()==Some(&t.name))else{continue};
            for col in &old.columns {
                let Some(candidate)=next.columns.iter().find(|c|c.name==col.name||c.renamed_from.as_ref()==Some(&col.name)||col.renamed_from.as_ref()==Some(&c.name))else{continue};
                let scalar=!matches!(&col.type_.kind,TypeKind::Ref{..}|TypeKind::List{..}|TypeKind::Image{..}|TypeKind::File{..}|TypeKind::Video{..});
                if scalar&&after_schema.as_ref().is_some_and(|s|s.downfills.iter().any(|d|d.table==old.name&&d.outputs.contains(&col.name))){continue;}
                let mut from=candidate.type_.clone();let mut to=col.type_.clone();normalize(&mut from,&aliases);normalize(&mut to,&aliases);
                if !crate::client_contracts::accepts(&crate::types::scalar_to_arg(&from),&crate::types::scalar_to_arg(&to)){return true}
            }
            let Some(columns)=declared_column_names(&old,next)else{return true};
            let normalize_columns=|fields:&[String]|fields.iter().map(|c|columns.get(c).unwrap_or(c).clone()).collect::<Vec<_>>();
            if old.indexes.iter().any(|i|i.unique&&!next.indexes.iter().any(|n|n.unique&&after_schema.as_ref().is_some_and(|schema|
                super::release_bridge_indexes::same_key(&before_schema,schema,&old.name,i,n,&columns)))){return true}
            if old.caps.iter().any(|c|!next.caps.iter().any(|n|normalize_columns(&n.by)==c.by&&n.max<=c.max)){return true}
        }
    }false
}

fn modules(sources:&[(String,String)])->Vec<(String,String)> {
    let mut out=sources.iter().map(|(file,text)|(std::path::Path::new(file).file_stem().unwrap_or(std::ffi::OsStr::new("schema")).to_string_lossy().into_owned(),text.clone())).collect::<Vec<_>>();out.sort();out
}

pub(super) fn operation_name(file:&str,name:&str)->String {
    let module=std::path::Path::new(file).file_stem().and_then(|s|s.to_str()).unwrap_or("schema");
    if module=="schema"{name.to_owned()}else{format!("{module}.{name}")}
}

/// Compare authored data/intent declarations and executable signatures, while
/// excluding executable bodies. Module identity and wire signatures still count.
pub fn same_data_and_intent(target:&[(String,String)],current:&[(String,String)])->bool {
    fn signature(sources:&[(String,String)])->Vec<(String,Vec<(lexer::Kind,String)>)> {
        modules(sources).into_iter().map(|(module,text)| {
            let doc=parser::parse_document(&module,&text).0;
            let mut edits=Vec::new();
            for site in doc.programs.iter().map(|p|&p.site).chain(doc.functions.iter().map(|p|&p.site)) {
                let start=offset(&text,site.line,1);
                let declaration=declaration(&text,site.line);
                let (tokens,_)=lexer::lex(&module,&declaration);
                let mut depth=0;
                if let Some(colon)=tokens.iter().find(|token| {
                    match token.value.as_str(){"("|"["|"{"=>depth+=1,")"|"]"|"}"=>depth-=1,_=>()}
                    token.value==":"&&depth==0
                }) {
                    let end=(start+declaration.len()).min(text.len());
                    let body=start+offset(&declaration,colon.site.line,colon.site.col)+1;
                    edits.push((body,end));
                }
            }
            let mut text=text;
            edits.sort_by_key(|e|std::cmp::Reverse(e.0));
            for (start,end) in edits {text.replace_range(start..end,"\n");}
snapback4/crates/snapback4-lang/src/release_bridge_policy.rs:30:    pub fn rule(&self, view: &RuleExpr, current: &RuleExpr) -> bool {
snapback4/crates/snapback4-lang/src/release_bridge_indexes.rs:80:pub fn align_current_schema(
snapback4/crates/snapback4-core/src/ir.rs:21:pub struct Program {
snapback4/crates/snapback4-core/src/ir.rs:153:pub enum Stmt {
snapback4/crates/snapback4-core/src/ir.rs:219:pub enum Expr {
snapback4/crates/snapback4-core/src/ir.rs:922:pub fn write_tables(program: &Program) -> Vec<(String, &'static str)> {

exec
/bin/bash -lc "cat snapback4/crates/snapback4-lang/src/release_bridge_policy.rs; sed -n '1,215p' snapback4/crates/snapback4-lang/src/release_bridge_indexes.rs" in /home/ccheever/projects/sb4-b27-rel
 succeeded in 0ms:
//! Compare aligned policy meaning without confusing a key with its label.
// @ref LLP 3000.000.000#20-visible-rollback-views-roll — compiled key meaning and every guard operand survive a visible rollback.
use snapback4_core::{Schema, schema::{Constraint, Horizon, RuleExpr, Sync}};

pub struct Policies<'a> {
    view: &'a Schema,
    current: &'a Schema,
}

impl<'a> Policies<'a> {
    pub fn new(view: &'a Schema, current: &'a Schema) -> Self { Self { view, current } }

    fn index(&self, table: &str, view: &str, current: &str) -> bool {
        match (self.view.table(table).and_then(|t|t.indexes.get(view)),
            self.current.table(table).and_then(|t|t.indexes.get(current))) {
            (Some(view),Some(current))=>view==current,
            _=>false,
        }
    }

    pub fn constraint(&self, view: &Constraint, current: &Constraint) -> bool {
        match (view,current) {
            (Constraint::FinalExistsOnInsert{table:a,index:ai,key:ak},
                Constraint::FinalExistsOnInsert{table:b,index:bi,key:bk})=>
                a==b&&ak==bk&&self.index(a,ai,bi),
            _=>view==current,
        }
    }

    pub fn rule(&self, view: &RuleExpr, current: &RuleExpr) -> bool {
        use RuleExpr::*;
        match (view,current) {
            (Exists{table:a,index:ai,key:ak,provenance:ap,equalities:ae},
                Exists{table:b,index:bi,key:bk,provenance:bp,equalities:be}) |
            (Created{table:a,index:ai,key:ak,provenance:ap,equalities:ae},
                Created{table:b,index:bi,key:bk,provenance:bp,equalities:be})=>
                a==b&&ak==bk&&ap==bp&&ae==be&&self.index(a,ai,bi),
            (And(a),And(b))|(Or(a),Or(b))=>a.len()==b.len()&&a.iter().zip(b).all(|(a,b)|self.rule(a,b)),
            (Not(a),Not(b))=>self.rule(a,b),
            _=>view==current,
        }
    }

    pub fn optional_rule(&self, view: Option<&RuleExpr>, current: Option<&RuleExpr>) -> bool {
        match (view,current) { (Some(a),Some(b))=>self.rule(a,b),(None,None)=>true,_=>false }
    }

    fn horizon(&self, table: &str, view: Option<&Horizon>, current: Option<&Horizon>) -> bool {
        match (view,current) {
            (Some(a),Some(b))=>a.last==b.last&&self.index(table,&a.by,&b.by),
            (None,None)=>true,
            _=>false,
        }
    }

    pub fn sync(&self, table: &str, view: Option<&Sync>, current: Option<&Sync>) -> bool {
        match (view,current) {
            (Some(a),Some(b))=>a.audience==b.audience&&self.horizon(table,a.horizon.as_ref(),b.horizon.as_ref())
                &&a.also.len()==b.also.len()&&a.also.iter().zip(&b.also).all(|(a,b)|
                    a.audience==b.audience&&self.horizon(table,a.horizon.as_ref(),b.horizon.as_ref())),
            (None,None)=>true,
            _=>false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use snapback4_core::{Value, ir::KeyProvenance, schema::{Audience, RuleTerm}};
    fn schema(name: &str, key: &str) -> Schema {
        let source=format!("table target:\n  code: text <=20\n  other: text <=20\n  unique {name}: {key}\n  public\n  online only\n");
        let bound=crate::compile(&[("schema.q".into(),source)]);
        assert!(bound.diagnostics.is_empty(),"{:?}",bound.diagnostics);bound.schema
    }
    fn probe(name: &str) -> RuleExpr {
        RuleExpr::Exists{table:"target".into(),index:name.into(),key:vec![RuleTerm::Field("value".into())],provenance:KeyProvenance::Shape,equalities:Vec::new()}
    }
    #[test]
    fn equivalent_labels_keep_all_probe_operands_and_provenance() {
        let view=schema("oldKey","code");let current=schema("newKey","code");let policy=Policies::new(&view,&current);
        let a=probe("oldKey");let b=probe("newKey");assert!(policy.rule(&a,&b));
        let mut changed=b.clone();if let RuleExpr::Exists{key,..}=&mut changed{*key=vec![RuleTerm::Field("different".into())];}assert!(!policy.rule(&a,&changed));
        let mut changed=b.clone();if let RuleExpr::Exists{provenance,..}=&mut changed{*provenance=KeyProvenance::Const;}assert!(!policy.rule(&a,&changed));
        let mut changed=b.clone();if let RuleExpr::Exists{equalities,..}=&mut changed{equalities.push(("code".into(),RuleTerm::Literal(Value::String("a".into()))));}assert!(!policy.rule(&a,&changed));
        let created=match b.clone(){RuleExpr::Exists{table,index,key,provenance,equalities}=>RuleExpr::Created{table,index,key,provenance,equalities},_=>unreachable!()};assert!(!policy.rule(&a,&created));
        let ca=Constraint::FinalExistsOnInsert{table:"target".into(),index:"oldKey".into(),key:vec![RuleTerm::Field("value".into())]};
        let cb=Constraint::FinalExistsOnInsert{table:"target".into(),index:"newKey".into(),key:vec![RuleTerm::Field("value".into())]};assert!(policy.constraint(&ca,&cb));
        assert!(policy.rule(&RuleExpr::Not(Box::new(a.clone())),&RuleExpr::Not(Box::new(b.clone()))));
        assert!(!policy.rule(&RuleExpr::And(vec![a]),&RuleExpr::Or(vec![b])));
    }
    #[test]
    fn a_shared_label_cannot_hide_a_different_key_or_uniqueness() {
        let view=schema("key","code");let mut current=schema("key","other");
        assert!(!Policies::new(&view,&current).rule(&probe("key"),&probe("key")));
        current=schema("key","code");current.tables.get_mut("target").unwrap().indexes.get_mut("key").unwrap().unique=false;
        assert!(!Policies::new(&view,&current).rule(&probe("key"),&probe("key")));
        assert!(!Policies::new(&view,&current).rule(&probe("missing"),&probe("missing")));
    }
    #[test]
    fn a_window_keeps_its_audience_limit_and_complete_key() {
        let view=schema("oldKey","code");let current=schema("newKey","code");let policy=Policies::new(&view,&current);
        let a=Sync::single(Audience::Public,Some(Horizon{last:10,by:"oldKey".into()}));
        let mut b=Sync::single(Audience::Public,Some(Horizon{last:10,by:"newKey".into()}));
        assert!(policy.sync("target",Some(&a),Some(&b)));
        b.horizon.as_mut().unwrap().last=20;assert!(!policy.sync("target",Some(&a),Some(&b)));
        b.horizon.as_mut().unwrap().last=10;b.audience=Audience::Column("code".into());assert!(!policy.sync("target",Some(&a),Some(&b)));
        assert!(!policy.sync("target",Some(&a),None));
    }
}
//! A current indexed read must not acquire an older index's meaning.
// @ref LLP 3000.000.000#20-visible-rollback-views-roll — named read dependencies are part of current execution context.
use crate::{ast, lexer};
use snapback4_core::{Schema, schema::IndexComponent};
use std::collections::{BTreeMap, BTreeSet};

pub(super) fn current_context_needed(
    view: &[ast::Document], current: &[ast::Document],
    view_schema: &Schema, current_schema: &Schema, names: &BTreeMap<String, String>,
) -> bool {
    let Ok(aligned) = current_schema.with_table_names(names) else { return true };
    for next in current.iter().flat_map(|doc| &doc.tables) {
        let name = names.get(&next.name).unwrap_or(&next.name);
        let Some(prior) = view.iter().flat_map(|doc| &doc.tables).find(|table| &table.name == name) else { continue };
        let (Some(before), Some(after)) = (view_schema.table(name), aligned.table(name)) else { continue };
        // Only declared physical column identities are normalized. Never edit
        // business strings, a computed expression, or an opaque token contract.
        let Some(columns) = column_names(prior, next) else { return true };
        if after.columns.keys().map(|column| columns.get(column).unwrap_or(column)).collect::<BTreeSet<_>>().len() != after.columns.len() {
            return true;
        }
        for declaration in &next.indexes {
            let (Some(actual), Some(expected)) = (before.index(&declaration.name), after.index(&declaration.name)) else { continue };
            // Complex components retain their complete compiled contract. A
            // rename inside one needs the complete current workflow rather
            // than guessed rewrites of its embedded semantics.
            if !expected.is_plain() && columns.keys().any(|column| expected.uses_column(column)) { return true; }
            let mut components = expected.components.clone();
            for component in &mut components {
                if let IndexComponent::Column(column) = component {
                    if let Some(old) = columns.get(column) { *column = old.clone(); }
                }
            }
            if actual.components != components { return true; }
        }
    }
    false
}

/// Complete enforcing-key identity, shared by registration and preparation.
/// Opaque contracts are compared intact; only typed plain-column identities
/// may be aligned. Printed calendar/function names are not their meaning.
pub(super) fn same_key(
    before: &Schema, after: &Schema, table: &str,
    old: &ast::IndexDecl, next: &ast::IndexDecl,
    columns: &BTreeMap<String, String>,
) -> bool {
    let (Some(old), Some(next)) = (
        before.table(table).and_then(|t| t.index(&old.name)),
        after.table(table).and_then(|t| t.index(&next.name)),
    ) else { return false };
    let mut next = next.clone();
    for component in &mut next.components {
        if let IndexComponent::Column(column) = component {
            if let Some(prior) = columns.get(column) { *column = prior.clone(); }
        }
    }
    old == &next
}

/// One injective declared identity map serves both source transport and checks.
pub fn column_names(prior: &ast::TableDecl, next: &ast::TableDecl) -> Option<BTreeMap<String, String>> {
    let mut columns = BTreeMap::new();
    for column in &next.columns {
        if let Some(old) = column.renamed_from.as_ref().filter(|old| prior.columns.iter().any(|p| &p.name == *old)) {
            if old != &column.name { columns.insert(column.name.clone(), old.clone()); }
        }
    }
    for column in &prior.columns {
        if let Some(old) = column.renamed_from.as_ref().filter(|old| next.columns.iter().any(|p| &p.name == *old)) {
            if !next.columns.iter().any(|p| p.name == column.name) { columns.insert(old.clone(), column.name.clone()); }
        }
    }
    let distinct = next.columns.iter().map(|column| columns.get(&column.name).unwrap_or(&column.name)).collect::<BTreeSet<_>>();
    (distinct.len() == next.columns.len()).then_some(columns)
}

/// Align comparison metadata only; never change authored executable source.
/// Both preparation and CLI admission must see the same declared identities.
pub fn align_current_schema(
    view: &Schema, view_sources: &[(String,String)],
    current: &Schema, current_sources: &[(String,String)],
    table_names: &BTreeMap<String,String>,
) -> Result<Schema,String> {
    let current=current.with_table_names(table_names).map_err(|e|e.to_string())?;
    let view_docs=view_sources.iter().map(|(f,t)|crate::parser::parse_document(f,t).0).collect::<Vec<_>>();
    let current_docs=current_sources.iter().map(|(f,t)|crate::parser::parse_document(f,t).0).collect::<Vec<_>>();
    let mut columns=BTreeMap::new();
    for name in view.tables.keys() {if let Some(next)=current.table(name) {
        let prior=view_docs.iter().flat_map(|d|&d.tables).find(|t|&t.name==name);
        let authored=current_docs.iter().flat_map(|d|&d.tables).find(|t|table_names.get(&t.name).unwrap_or(&t.name)==name);
        if let(Some(prior),Some(authored))=(prior,authored) {
            let map=column_names(prior,authored).ok_or_else(||format!("unambiguous declared column identities required on {name}"))?;
            if next.columns.keys().map(|c|map.get(c).unwrap_or(c)).collect::<BTreeSet<_>>().len()!=next.columns.len() {
                return Err(format!("cannot merge independent column identities on {name}"));
            }
            if !map.is_empty(){columns.insert(name.clone(),map);}
        }
    }}
    Ok(current.with_column_names(&columns))
}

/// Rewrite only plain-key column tokens. Index labels, refusal codes/messages
/// and every other literal retain their current authored spelling.
pub(super) fn plain_declaration(file: &str, raw: &str, index: &ast::IndexDecl, prior: &ast::TableDecl, next: &ast::TableDecl) -> String {
    if !index.is_plain() { return raw.into(); }
    let Some(columns) = column_names(prior, next) else { return raw.into() };
    let (tokens, diagnostics) = lexer::lex(file, raw);
    if !diagnostics.is_empty() { return raw.into(); }
    let Some(keyword) = tokens.iter().position(|token| matches!(token.value.as_str(), "by" | "unique")) else { return raw.into() };
    let mut cursor = keyword + 1;
    if tokens.get(cursor + 1).is_some_and(|token| token.value == ":") { cursor += 2; }
    let mut edits = Vec::new();
    for (ordinal, column) in index.columns.iter().enumerate() {
        let Some(token) = tokens.get(cursor).filter(|token| &token.value == column) else { return raw.into() };
        if let Some(old) = columns.get(column) {
            let start = raw.split_inclusive('\n').take(token.site.line.saturating_sub(1) as usize).map(str::len).sum::<usize>();
            let start = start + raw[start..].chars().take(token.site.col.saturating_sub(1) as usize).map(char::len_utf8).sum::<usize>();
            edits.push((start, start + token.value.len(), old.clone()));
        }
        cursor += 1;
        if ordinal + 1 < index.columns.len() {
            if !tokens.get(cursor).is_some_and(|token| token.value == ",") { return raw.into(); }
            cursor += 1;
        }
    }
    let mut source = raw.to_owned();
    edits.sort_by_key(|edit| std::cmp::Reverse(edit.0));
    for (start, end, value) in edits { source.replace_range(start..end, &value); }
    source
}

/// Retain every named dependency, without introducing an unused duplicate
/// unique key that changes an otherwise unambiguous positional point lookup.
pub(super) fn prune_unused_equivalent_keys(sources: &mut [(String, String)], current: &[(String, String)], changes: &mut Vec<String>) {
    let mut docs=sources.iter().map(|(f,t)|crate::parser::parse_document(f,t).0).collect::<Vec<_>>();
    let current=current.iter().map(|(f,t)|crate::parser::parse_document(f,t).0).collect::<Vec<_>>();
    let mut used=BTreeSet::new();
    let mut visit=|value:&mut ast::Expr|match value {
        ast::Expr::Read(read)|ast::Expr::Exists{read,..}|ast::Expr::Created{read,..}=>{
            if let Some(index)=&read.index {used.insert((read.table.clone(),index.clone()));}
        }
        ast::Expr::Merge(merge)=>{used.insert((merge.table.clone(),merge.index.clone()));}
        _=>{}
    };
    for doc in &mut docs {
        crate::bind::intent_walk::document(doc,&mut visit);
        for table in &mut doc.tables {
            for rule in &mut table.rules {crate::bind::intent_walk::expression(&mut rule.value,&mut visit);}
            for value in table.column_read_values_mut() {crate::bind::intent_walk::expression(value,&mut visit);}
            for column in &mut table.columns {
                if let Some(value)=&mut column.default {crate::bind::intent_walk::expression(value,&mut visit);}
                if let Some(value)=column.maintained.as_mut().and_then(|m|m.filter.as_mut()) {crate::bind::intent_walk::expression(value,&mut visit);}
            }
            for(value,_)in &mut table.final_exists {crate::bind::intent_walk::expression(value,&mut visit);}
            for index in &mut table.indexes {for value in index.computed.values_mut(){crate::bind::intent_walk::expression(value,&mut visit);}}
        }
        for invariant in &mut doc.invariants {crate::bind::intent_walk::expression(&mut invariant.value,&mut visit);}
        for maintain in &mut doc.maintains {
            for value in &mut maintain.keys {crate::bind::intent_walk::expression(value,&mut visit);}
            if let Some(value)=&mut maintain.filter {crate::bind::intent_walk::expression(value,&mut visit);}
            if let Some(rule)=&mut maintain.read {crate::bind::intent_walk::expression(&mut rule.value,&mut visit);}
        }
        for timeline in &mut doc.timelines {if let Some(value)=&mut timeline.filter {crate::bind::intent_walk::expression(value,&mut visit);}}
        for view in &mut doc.views {for branch in &mut view.branches {
            if let Some(value)=&mut branch.predicate {crate::bind::intent_walk::expression(value,&mut visit);}
            for field in &mut branch.fields {if let ast::ShapeField::Field{value,..}=field{crate::bind::intent_walk::expression(value,&mut visit);}}
        }}
        for view in &mut doc.feed_views {crate::bind::intent_walk::expression(&mut view.predicate,&mut visit);}
        for action in &mut doc.actions {crate::bind::intent_walk::expression(&mut action.rule,&mut visit);}
        for arg in doc.programs.iter_mut().flat_map(|p|&mut p.args)
            .chain(doc.functions.iter_mut().flat_map(|f|&mut f.args))
            .chain(doc.actions.iter_mut().flat_map(|a|&mut a.args)) {
            if let Some(value)=&mut arg.default {crate::bind::intent_walk::expression(value,&mut visit);}
        }
    }
    for doc in &docs {for table in &doc.tables {
        if let Some((_,ast::SyncOrder::Index(index)))=table.sync.as_ref().and_then(|s|s.horizon.as_ref()) {
            used.insert((table.name.clone(),index.clone()));
        }
    }}
    for ((_,text),doc) in sources.iter_mut().zip(&docs) {
        let mut edits=Vec::new();
        for table in &doc.tables {
            let mut groups=BTreeMap::<Vec<String>,Vec<&ast::IndexDecl>>::new();
            for index in table.indexes.iter().filter(|i|i.unique&&i.is_plain()) {groups.entry(index.columns.clone()).or_default().push(index);}
            for group in groups.values().filter(|g|g.len()>1) {
                let named=group.iter().filter(|i|used.contains(&(table.name.clone(),i.name.clone()))).collect::<Vec<_>>();
                let preferred=current.iter().flat_map(|d|&d.tables)
                    .filter(|t|t.name==table.name||t.renamed_from.as_ref()==Some(&table.name)||table.renamed_from.as_ref()==Some(&t.name))
                    .flat_map(|t|&t.indexes).find_map(|i|group.iter().find(|old|old.name==i.name));
                let keep=preferred.unwrap_or(&group[0]);
                for index in group {
                    if used.contains(&(table.name.clone(),index.name.clone())) || (named.is_empty()&&index.name==keep.name) {continue}
                    let start=text.split_inclusive('\n').take(index.site.line.saturating_sub(1)as usize).map(str::len).sum::<usize>();
                    let end=text[start..].find('\n').map_or(text.len(),|n|start+n+1);
                    edits.push((start,end));
                    changes.push(format!("{}: omitted unused equivalent unique index {}; the identical ordered key remains enforced",table.name,index.name));
                }
            }
        }
        edits.sort_by_key(|edit|std::cmp::Reverse(edit.0));
        for(start,end)in edits {text.replace_range(start..end,"");}
    }
}

exec
/bin/bash -lc "sed -n '150,320p' snapback4/crates/snapback4-core/src/ir.rs; sed -n '900,1010p' snapback4/crates/snapback4-core/src/ir.rs; rg --files snapback4/crates/snapback4-lang | rg 'security|invariant'" in /home/ccheever/projects/sb4-b27-rel
 succeeded in 0ms:
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum Stmt {
    Const { name: String, value: Expr },
    Let { name: String, value: Expr },
    Assign { name: String, value: Expr },
    Push { target: String, value: Expr },
    If { condition: Expr, then_body: Vec<Stmt>, else_body: Vec<Stmt> },
    For { binding: String, domain: LoopDomain, body: Vec<Stmt> },
    Require {
        condition: Expr,
        code: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        site: Option<String>,
        /// The author's text for the refusal (`require … else CODE 'message'`); the code stays the contract.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        message: Option<String>,
    },
    /// A false predicate rolls the transaction back and re-reads `current`.
    Check { condition: Expr, current: Read },
    /// A unique clash yields absence, never the conflicting row.
    InsertIfAbsent { table: String, row: Expr, result: String },
    Insert { table: String, row: Expr },
    Update { table: String, key: Expr, patch: Expr },
    Upsert { table: String, key: Expr, row: Expr },
    /// Target lookup and the old image stay inside the engine. Only a read-filtered result is bound.
    WriteTarget { target: Read, patch: Expr, upsert: bool, condition: Option<WriteCondition>, result: Option<String> },
    Delete { table: String, key: Expr },
    /// Alternate-key delete resolves inside the engine before charging hidden expiry work.
    DeleteTarget { target: Read },
    Emit { effect: String, payload: Expr, #[serde(default, skip_serializing_if = "Option::is_none")] once: Option<Expr> },
    Return(Expr),
    Break,
    Continue,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct WriteCondition {
    pub old: String,
    pub setup: Vec<Stmt>,
    pub value: Expr,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum LoopDomain {
    Page(Scan),
    LiteralRange { start: i64, end_exclusive: i64 },
    ExpressionRange { start: Expr, end_exclusive: Expr },
    ArgList { name: String, max: u32 },
    DerivedArray { value: Expr, max: u32, bound_source: String },
    Recurse(Recurse),
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Recurse {
    pub site: String,
    pub table: String,
    pub index: String,
    pub seed: Box<Expr>,
    pub next_field: String,
    pub depth: u32,
    pub fanout: u32,
    pub provenance: KeyProvenance,
}

pub const MAX_RECURSE_DEPTH: u32 = 10_000;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum Expr {
    Literal(Value),
    Variable(String),
    Input(Input),
    Field { base: Box<Expr>, name: String },
    Array(Vec<Expr>),
    Object(BTreeMap<String, Expr>),
    Shape { base: Box<Expr>, fields: BTreeMap<String, Expr> },
    Binary { op: BinaryOp, left: Box<Expr>, right: Box<Expr> },
    Unary { op: UnaryOp, value: Box<Expr> },
    Builtin { builtin: Builtin, args: Vec<Expr> },
    Get(Read),
    Exists(Read),
    Block { body: Vec<Stmt>, value: Box<Expr> },
    Scan(Scan),
    Merge(Merge),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum Input {
    Viewer,
    Now,
    NewId,
    ReadTime,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum BinaryOp {
    Eq,
    Ne,
    SameValueZero,
    Lt,
    Lte,
    Gt,
    Gte,
    Add,
    Sub,
    Mul,
    And,
    Or,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum UnaryOp {
    Not,
    Neg,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum Builtin {
    /// Server job read scope; its second argument is a read-only expression block.
    #[cfg(feature = "sqlite")]
    JobAs,
    /// A separately bound ordinary query, retaining its return/cursor plan.
    #[cfg(feature = "sqlite")]
    JobQuery { program: Box<Program>, cursor: Option<String>, all: bool },
    /// Compiler-owned projection of a successful insert result.
    ProjectFields { table: String },
    ReceiptSettled { table: String },
    /// A private field may be absent from a projected row.
    OptionalField { field: String, #[serde(default, skip_serializing_if = "std::ops::Not::not")] omit: bool, #[serde(default, skip_serializing_if = "std::ops::Not::not")] fallback: bool },
    Calendar { millis: i64 },
    // @ref LLP 3000.040#22-builtins — a new tag: an older device cannot decode a program that uses it.
    Civil(crate::calendar::Civil),
    Len,
    Slice,
    Concat,
    Lower,
    Trim,
    Text(crate::text::Function),
    Sha256,
    Join,
    Group { field: String, #[serde(default, skip_serializing_if = "std::ops::Not::not")] optional: bool },
    First,
    Last,
    At,
    Min,
    Max,
    /// SQL-style column extrema; domain reads require complete coverage.
    Extremum { field: String, max: bool, domain: bool },
    /// @ref LLP 3000.019#3.2 — expression extrema bind `$filter` per authorized row;
    /// args[0] is the source and args[1] the projection, as in streaming sum.
    /// The existing column extremum encoding is unchanged.
    ExtremumOf { max: bool, domain: bool },
    Divmod { remainder_sink: String },
    /// Checked exact integer division with an author-selected rounding rule.
    // @ref LLP 3000.013.001#2-rounded-division-table — the mode is a closed wire enum and evaluation never uses floating point.
    Divide {
        rounding: Rounding,
        /// Decimal places requested by the four-argument surface. `None`
        /// preserves the dividend's already-scaled representation.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        scale: Option<u8>,
    },
    Sort { keys: Vec<SortKey> },
    MentionTokens,
    SearchPresent,
    /// A query row assertion cannot classify a metered-out point as absent.
    RequireUncapped,
    DeterministicShare,
    Count,
    Sum,
            out.push(scan);
        }
        Expr::Merge(merge) => {
            merges.push(merge);
            if let Some(after) = merge.position.as_ref().and_then(|position| position.after.as_ref()) { expr_scans(after, out, merges); }
            for lane in &merge.lanes {
                if let Some(guard) = &lane.guard { expr_scans(guard, out, merges); }
                if let Some(project) = &lane.project { expr_scans(project, out, merges); }
                if let Some(value) = &lane.distinct { expr_scans(value, out, merges); }
                stmts_scans(&lane.setup, out, merges);
                if let Some(source) = &lane.source {
                    if let Some(scan) = source.scan() { expr_scans_of_scan(scan, out, merges); out.push(scan); }
                    for value in source.expressions() { expr_scans(value, out, merges); }
                }
                expr_scans_of_scan(&lane.scan, out, merges);
                out.push(&lane.scan);
            }
        }
    }
}

/// Every table a program writes, by statement kind.
pub fn write_tables(program: &Program) -> Vec<(String, &'static str)> {
    let mut out = Vec::new();
    stmts_write_tables(&program.body, &mut out);
    out
}

mod writes;
use writes::stmts_write_tables;
snapback4/crates/snapback4-lang/examples/security_corpus.rs
snapback4/crates/snapback4-lang/tests/security_sec7.rs
snapback4/crates/snapback4-lang/tests/security_sec5_output.rs
snapback4/crates/snapback4-lang/tests/security_wave16.rs
snapback4/crates/snapback4-lang/tests/security_sec5_refutations.rs
snapback4/crates/snapback4-lang/tests/security_sec7_day2.rs
snapback4/crates/snapback4-lang/tests/security_sec5_intent.rs
snapback4/crates/snapback4-lang/tests/security.rs
snapback4/crates/snapback4-lang/tests/security_wave19.rs
snapback4/crates/snapback4-lang/tests/security_sec6.rs
snapback4/crates/snapback4-lang/tests/security_custody.rs
snapback4/crates/snapback4-lang/tests/security_observers.rs
snapback4/crates/snapback4-lang/tests/wave26_security.rs
snapback4/crates/snapback4-lang/tests/security_sec4.rs
snapback4/crates/snapback4-lang/tests/release_bridge_security.rs
snapback4/crates/snapback4-lang/tests/security_sec5_notes.rs
snapback4/crates/snapback4-lang/tests/security_sec9.rs
snapback4/crates/snapback4-lang/tests/security_histories.rs
snapback4/crates/snapback4-lang/tests/security_sec8.rs
snapback4/crates/snapback4-lang/src/guide/security.md
snapback4/crates/snapback4-lang/src/parser/security.rs
snapback4/crates/snapback4-lang/tests/security/wave22/037.q
snapback4/crates/snapback4-lang/tests/security/wave22/026-spec.q
snapback4/crates/snapback4-lang/tests/security/wave22/011-spec.q
snapback4/crates/snapback4-lang/tests/security/wave22/009.q
snapback4/crates/snapback4-lang/tests/security/wave22/040-spec.q
snapback4/crates/snapback4-lang/tests/security/wave22/040-specF2.q
snapback4/crates/snapback4-lang/tests/security/wave22/021-spec.q
snapback4/crates/snapback4-lang/tests/security/wave22/030-spec.q
snapback4/crates/snapback4-lang/tests/security/wave22/021.q
snapback4/crates/snapback4-lang/tests/security/wave22/004-spec.q
snapback4/crates/snapback4-lang/tests/security/wave22/manifest.json
snapback4/crates/snapback4-lang/tests/security/wave22/001.q
snapback4/crates/snapback4-lang/tests/security/wave22/044-specF2.q
snapback4/crates/snapback4-lang/tests/security/wave22/011.q
snapback4/crates/snapback4-lang/tests/security/wave22/040.q
snapback4/crates/snapback4-lang/tests/security/wave22/044.q
snapback4/crates/snapback4-lang/tests/security/wave22/041.q
snapback4/crates/snapback4-lang/tests/security/wave22/026.q
snapback4/crates/snapback4-lang/tests/security/wave22/030.q
snapback4/crates/snapback4-lang/tests/security/wave22/004.q
snapback4/crates/snapback4-lang/tests/security/wave22/037-spec.q
snapback4/crates/snapback4-lang/tests/security/wave20/050.q
snapback4/crates/snapback4-lang/tests/security/wave20/036.q
snapback4/crates/snapback4-lang/tests/security/wave16/045.q
snapback4/crates/snapback4-lang/tests/security/wave16/021.q
snapback4/crates/snapback4-lang/tests/security/wave16/048.q
snapback4/crates/snapback4-lang/tests/security/wave16/015-fixed.q
snapback4/crates/snapback4-lang/tests/security/wave16/020.q
snapback4/crates/snapback4-lang/tests/security/wave16/019.q
snapback4/crates/snapback4-lang/tests/security/wave16/015.q
snapback4/crates/snapback4-lang/src/bind/security.rs
snapback4/crates/snapback4-lang/tests/security/wave24/007.q
snapback4/crates/snapback4-lang/tests/security/wave24/013.q
snapback4/crates/snapback4-lang/tests/security/wave24/029.q
snapback4/crates/snapback4-lang/tests/security/wave24/031.q
snapback4/crates/snapback4-lang/tests/security/wave24/015.q
snapback4/crates/snapback4-lang/tests/security/wave24/016.q
snapback4/crates/snapback4-lang/tests/security/wave24/048.q
snapback4/crates/snapback4-lang/tests/security/wave24/036.q
snapback4/crates/snapback4-lang/tests/security/wave24/033.q
snapback4/crates/snapback4-lang/tests/security/wave24/008.q
snapback4/crates/snapback4-lang/tests/security/wave24/011.q
snapback4/crates/snapback4-lang/tests/security/wave21/040.q
snapback4/crates/snapback4-lang/tests/security/wave21/048.q
snapback4/crates/snapback4-lang/tests/security/wave23/018.q
snapback4/crates/snapback4-lang/tests/security/wave23/042.q
snapback4/crates/snapback4-lang/tests/security/wave23/wave19-046.q
snapback4/crates/snapback4-lang/tests/security/wave23/031.q
snapback4/crates/snapback4-lang/tests/security/wave23/028.q
snapback4/crates/snapback4-lang/tests/security/wave23/047.q
snapback4/crates/snapback4-lang/tests/security/wave23/019.q
snapback4/crates/snapback4-lang/tests/security/wave23/015.q
snapback4/crates/snapback4-lang/tests/security/wave23/027.q
snapback4/crates/snapback4-lang/tests/security/wave23/040.q
snapback4/crates/snapback4-lang/tests/security/wave23/043.q
snapback4/crates/snapback4-lang/tests/security/wave23/030.q
snapback4/crates/snapback4-lang/tests/security/wave23/007.q
snapback4/crates/snapback4-lang/tests/security/wave23/wave18-046.q
snapback4/crates/snapback4-lang/tests/security/wave23/wave15-030.q
snapback4/crates/snapback4-lang/tests/security/wave23/023.q
snapback4/crates/snapback4-lang/tests/security/wave23/011.q
snapback4/crates/snapback4-lang/tests/security/wave23/wave15-027.q
snapback4/crates/snapback4-lang/tests/security/wave23/039.q
snapback4/crates/snapback4-lang/tests/security/wave23/wave21-038.q
snapback4/crates/snapback4-lang/src/bind/security/intent.rs
snapback4/crates/snapback4-lang/src/bind/security/presentation.rs
snapback4/crates/snapback4-lang/src/bind/security/audit.rs
snapback4/crates/snapback4-lang/src/bind/security/authority_walk.rs
snapback4/crates/snapback4-lang/src/bind/security/kernel.rs
snapback4/crates/snapback4-lang/src/bind/security/concrete.rs
snapback4/crates/snapback4-lang/src/bind/security/operation.rs
snapback4/crates/snapback4-lang/src/bind/security/challenges.rs
snapback4/crates/snapback4-lang/src/bind/security/lifecycle_advice.rs
snapback4/crates/snapback4-lang/src/bind/security/temporal.rs
snapback4/crates/snapback4-lang/src/bind/security/derived.rs
snapback4/crates/snapback4-lang/src/bind/security/write_advice.rs
snapback4/crates/snapback4-lang/src/bind/security/lints.rs
snapback4/crates/snapback4-lang/src/bind/security/images.rs
snapback4/crates/snapback4-lang/src/bind/security/time_advice.rs
snapback4/crates/snapback4-lang/src/bind/security/privilege.rs
snapback4/crates/snapback4-lang/src/bind/security/observers.rs
snapback4/crates/snapback4-lang/src/bind/security/creation_advice.rs
snapback4/crates/snapback4-lang/src/bind/security/result_advice.rs
snapback4/crates/snapback4-lang/tests/security/wave25/043.q
snapback4/crates/snapback4-lang/src/bind/security/columns.rs
snapback4/crates/snapback4-lang/src/bind/security/challenges/generated.rs
snapback4/crates/snapback4-lang/src/bind/security/challenges/executed.rs
snapback4/crates/snapback4-lang/src/bind/security/challenges/assets.rs
snapback4/crates/snapback4-lang/src/bind/security/write_intent.rs
snapback4/crates/snapback4-lang/src/bind/security/creation_advice/eligibility.rs
snapback4/crates/snapback4-lang/src/bind/security/challenges/column_reads.rs
snapback4/crates/snapback4-lang/src/bind/security/census.rs
snapback4/crates/snapback4-lang/src/bind/security/advice.rs
snapback4/crates/snapback4-lang/src/bind/security/challenges/histories.rs
snapback4/crates/snapback4-lang/src/bind/security/creation_advice/lifecycle.rs
snapback4/crates/snapback4-lang/src/bind/security/adoption.rs
snapback4/crates/snapback4-lang/src/bind/security/challenges/timed.rs
snapback4/crates/snapback4-lang/src/bind/security/challenges/stability.rs
snapback4/crates/snapback4-lang/src/bind/security/challenges/paired.rs
snapback4/crates/snapback4-lang/src/bind/security/authority_walk/changes.rs
snapback4/crates/snapback4-lang/tests/security/wave23/035.q
snapback4/crates/snapback4-lang/tests/security/wave23/003.q
snapback4/crates/snapback4-lang/tests/security/wave23/manifest.json

exec
/bin/bash -lc "rg -n 'requirements|fn dependencies' snapback4/crates/snapback4-lang -g '*.rs' | head -75; cat snapback4/crates/snapback4-core/src/schema/column_writes.rs; rg -n 'column_write_rule|frozen_columns|frozen' snapback4/crates/snapback4-core/src/interpret* -g '*.rs'" in /home/ccheever/projects/sb4-b27-rel
 exited 2 in 0ms:
snapback4/crates/snapback4-lang/src/emit/settlement.rs:127:pub fn dependencies(schema: &Schema, program: &Program) -> Option<Dependencies> {
snapback4/crates/snapback4-lang/src/release_bridge.rs:490:            &&inv.requirements.iter().any(|require|stable(require)&&implies(require,policy,&comparison)
snapback4/crates/snapback4-lang/src/release_bridge_guards.rs:252:            // Keep the old workflow; add current requirements after its reads,
snapback4/crates/snapback4-lang/tests/security_wave19.rs:19:fn generated_payloads_preserve_creator_copies_and_cold_approval_requirements(){
snapback4/crates/snapback4-lang/tests/derived_maintains.rs:340:    assert_eq!(notes.len(), 9, "unrelated, stale, and visibility-only requirements must not suppress the note: {:#?}", b.notes);
snapback4/crates/snapback4-lang/tests/held_unknown.rs:41:fn guide_histories_are_bare_pages_without_membership_requirements() {
snapback4/crates/snapback4-lang/tests/security_sec7_day2.rs:140:#[test]fn effectful_requirements_and_conditions_do_not_become_stable_edit_guards(){
snapback4/crates/snapback4-lang/src/guide/sync.rs:150:aggregates and word searches have separate coverage requirements; this
snapback4/crates/snapback4-lang/src/guide/sync.rs:270:Current engines and devices refuse unknown requirements with `E_SCHEMA_CAPABILITY`, including when an explicit backend would replace an unsupported kept backend.
snapback4/crates/snapback4-lang/src/guide/sync.rs:362:`N_NO_HORIZON` can be suppressed by prediction requirements, and a cap per
snapback4/crates/snapback4-lang/src/guide/prediction.rs:216:its ordinary prediction requirements. `! else CODE`, `require`, potentially
snapback4/crates/snapback4-lang/src/guide/prediction.rs:367:explicitly, and keep the existence read's coverage and authority requirements.
snapback4/crates/snapback4-lang/src/guide/bounds.rs:161:diagnostics: check --args types, --query requirements or held coverage respectively. Failed receipts retain caller query/args.
snapback4/crates/snapback4-lang/src/guide/codes.rs:401:    ("N_SYNC_ORDER", "a note, not an error — a device-capable query pages a windowed table on another index (including a calendar index) or oldest first. Whole-domain aggregates and word indexes have separate coverage requirements and are outside this ordering advice. Its acquisition boundary proves only newest-first pages on the window's own index, within that boundary. The note names both orders and the source site. A paste-ready page uses last N on the window index, audience equalities in bracket keys, and the original predicates and cursor. It requires a cursor, a cap covering the whole group, or the same ordered columns already read newest first. A cursorless partial page in another order gets words because reordering could select different rows. Restart pagination when changing order; the full traversal keeps the same rows. Only scope-independent range endpoints can move into residual filters. Outer-row endpoints, generated membership lanes, explicit merges and projected views get the window order and index in words without a paste-ready replacement; one lane is not the whole read. Capped pages get last N from their bound scan. Otherwise the ordinary query needs the server; offline coverage is unknown. A held query stays on the device and reports incomplete coverage without server fallback. online only currently applies to tables and views, not query headers. guide sync."),
snapback4/crates/snapback4-lang/src/release_bridge_rules.rs:174:            // immutable fields and final-existence requirements verbatim.
snapback4/crates/snapback4-lang/tests/guide/definitions.rs:462:    ("E_SCHEMA_CAPABILITY", "Current engines and devices refuse unknown requirements with `E_SCHEMA_CAPABILITY`, including when an explicit backend would replace an unsupported kept backend."),
snapback4/crates/snapback4-lang/src/bind/security.rs:46:    pub requirements: Vec<RuleExpr>,
snapback4/crates/snapback4-lang/src/bind/security.rs:76:        let requirements=named_operation.as_ref().map(|(_,p)| operation::requirements(catalog,info,p)).unwrap_or_default();
snapback4/crates/snapback4-lang/src/bind/security.rs:77:        out.push(Invariant{operation:named_operation.map(|(name,_)|name),requirements,syntax:Some(decl.value.clone()),table:decl.table.clone(),target:decl.target.clone(),column:decl.column.clone(),predicate:crate::print::expression(&decl.value),site:decl.site.clone(),policy,unsupported});
snapback4/crates/snapback4-lang/src/bind/write_affordances.rs:41:// @ref LLP 3000.036.002#7 — these notes state conditional argument requirements, never an impossibility theorem over dynamic inputs.
snapback4/crates/snapback4-lang/src/bind/security/kernel.rs:85:pub fn dependencies(rule: &R) -> BTreeSet<String> {
snapback4/crates/snapback4-lang/src/bind/security/time_advice.rs:105:            let requirements=catalog.tables.get(&table).map(|info|super::operation::requirements(catalog,info,&context)).unwrap_or_default();
snapback4/crates/snapback4-lang/src/bind/security/time_advice.rs:106:            if requirements.iter().any(|r|!r.disjuncts().is_empty()&&r.disjuncts().iter().all(|b|b.service_grant().is_some())){continue;}
snapback4/crates/snapback4-lang/src/bind/residency/components.rs:38:    fn dependencies(facts: &Facts, bindings: &BTreeMap<String, (usize, Facts)>, used: &mut BTreeSet<usize>, reads: &mut BTreeSet<usize>) {
snapback4/crates/snapback4-lang/src/bind/security/authority_walk.rs:19:        Expr::Write{..}=>{let mut context=p.clone();context.prelude=Vec::new();context.body=guards.to_vec();if let Some(column)=column{for change in changes{if change.matches(e,column,p){context.body.extend(change.requirements.clone());}}}out.push((e.clone(),context));},
snapback4/crates/snapback4-lang/src/bind/security/authority_walk.rs:31:// Conditional/loop-local requirements never become caller assumptions.
snapback4/crates/snapback4-lang/src/bind/security/lints.rs:141:                    let requirements=catalog.tables.get(table).map(|info|super::operation::requirements(&catalog,info,&context)).unwrap_or_default();
snapback4/crates/snapback4-lang/src/bind/security/lints.rs:142:                    if super::privilege::membership_grant_risk(bound,table,&operation,&requirements,if *op==ast::WriteOp::Upsert&&!reassigns{ast::WriteOp::Insert}else{*op},fields)&&seen.insert((table.clone(),"$membership".into())){
snapback4/crates/snapback4-lang/src/bind/security/lints.rs:161:                    let requirements=catalog.tables.get(table).map(|info|super::operation::requirements(&catalog,info,&context)).unwrap_or_default();
snapback4/crates/snapback4-lang/src/bind/security/lints.rs:163:                    if let Some(risk)=super::privilege::risk(bound,table,column,&super::super::operation_name(std::path::Path::new(&doc.file).file_stem().unwrap().to_string_lossy().as_ref(),&p.name),&targets,effective_op,&requirements,dynamic,fields)&&seen.insert((table.clone(),format!("$privilege:{column}"))) {
snapback4/crates/snapback4-lang/src/bind/security/advice.rs:109:            let requirements=catalog.tables.get(table).map(|info|super::operation::requirements(catalog,info,&context)).unwrap_or_default();
snapback4/crates/snapback4-lang/src/bind/security/advice.rs:127:                if gates.iter().any(|g|g.disjuncts().iter().any(|b|self_only(b,&f.name)&&requirements.iter().all(|r|self_only(r,&f.name))))&&seen.insert((table.clone(),f.name.clone())){
snapback4/crates/snapback4-lang/src/bind/security/advice.rs:128:                    let roles=requirements.iter().flat_map(|r|role_names(bound,r)).collect::<Vec<_>>();
snapback4/crates/snapback4-lang/src/bind/security/write_advice.rs:26:            let requirements=super::operation::requirements(&catalog,info,&context);
snapback4/crates/snapback4-lang/src/bind/security/write_advice.rs:29:            let admission=RuleExpr::And(requirements.into_iter().chain([gate]).collect());
snapback4/crates/snapback4-lang/src/bind/security/write_advice.rs:48:            let requirements=super::operation::requirements(&catalog,info,&context);
snapback4/crates/snapback4-lang/src/bind/security/write_advice.rs:49:            let restriction=RuleExpr::And(requirements.into_iter().chain([bound.schema.tables[&table].update_rule_judged().into_owned()]).collect());
snapback4/crates/snapback4-lang/src/bind/security/derived.rs:47:    out.push(Invariant{table:table.into(),column:Some(column.into()),target:target.into(),predicate:policy.quarry(),policy:Some(policy),site,operation:None,requirements:Vec::new(),syntax:None,unsupported:None});
snapback4/crates/snapback4-lang/src/bind/security/derived.rs:77:                    let guards=operation::requirements(&catalog,info,specific);
snapback4/crates/snapback4-lang/src/bind/security/creation_advice.rs:47:            let mut requirements=super::operation::requirements(&catalog,info,&context);
snapback4/crates/snapback4-lang/src/bind/security/creation_advice.rs:50:                if let Ok(rule)=super::super::schema::bind_rule(&catalog,info,&ast::RuleDecl{effect:ast::Effect::Read,bindings:Vec::new(),value,site:site.clone()}){requirements.push(rule);}
snapback4/crates/snapback4-lang/src/bind/security/creation_advice.rs:53:            writes.push(Write{p,name:super::super::operation_name(std::path::Path::new(&p.site.file).file_stem().and_then(|s|s.to_str()).unwrap_or(""),&p.name),op,table,fields,keys,site,context,conditional:if_absent||condition.is_some(),gate:RuleExpr::And(requirements.into_iter().chain([rule]).collect())});
snapback4/crates/snapback4-lang/src/bind/security/creation_advice.rs:65:            // Only unconditional requirements before the FIRST creating write
snapback4/crates/snapback4-lang/src/bind/residency/horizons/sync_order.rs:19:            // requirements: changing their page order cannot establish them.
snapback4/crates/snapback4-lang/src/bind/maintain_authorization.rs:19:            let mut requirements: Vec<Expr> = Vec::new();
snapback4/crates/snapback4-lang/src/bind/maintain_authorization.rs:21:            inspect(&statements, &mut requirements, &mut |read, requirements| {
snapback4/crates/snapback4-lang/src/bind/maintain_authorization.rs:28:                    || expected.as_ref().is_some_and(|expected| requirements.iter().any(|condition| requirement_proves_raw_rule(schema, condition, expected)))
snapback4/crates/snapback4-lang/src/bind/maintain_authorization.rs:72:/// Visit returns with the requirements that still dominate them. Branches
snapback4/crates/snapback4-lang/src/bind/maintain_authorization.rs:76:fn inspect(statements: &[Stmt], requirements: &mut Vec<Expr>, visit: &mut impl FnMut(&ReadExpr, &[Expr])) {
snapback4/crates/snapback4-lang/src/bind/maintain_authorization.rs:79:            Stmt::Require { condition, .. } => requirements.push(condition.clone()),
snapback4/crates/snapback4-lang/src/bind/maintain_authorization.rs:80:            Stmt::Bind { names, .. } => requirements.retain(|condition| !mentions_any(condition, names)),
snapback4/crates/snapback4-lang/src/bind/maintain_authorization.rs:81:            Stmt::Return { value: Expr::Read(read), .. } => visit(read, requirements),
snapback4/crates/snapback4-lang/src/bind/maintain_authorization.rs:83:                let mut then_requirements = requirements.clone();
snapback4/crates/snapback4-lang/src/bind/maintain_authorization.rs:84:                inspect(then_body, &mut then_requirements, visit);
snapback4/crates/snapback4-lang/src/bind/maintain_authorization.rs:85:                let mut else_requirements = requirements.clone();
snapback4/crates/snapback4-lang/src/bind/maintain_authorization.rs:86:                inspect(else_body, &mut else_requirements, visit);
snapback4/crates/snapback4-lang/src/bind/maintain_authorization.rs:87:                then_requirements.retain(|condition| contains(&else_requirements, condition));
snapback4/crates/snapback4-lang/src/bind/maintain_authorization.rs:88:                then_requirements.dedup_by(|left, right| canonical(left.clone()) == canonical(right.clone()));
snapback4/crates/snapback4-lang/src/bind/maintain_authorization.rs:89:                *requirements = then_requirements;
snapback4/crates/snapback4-lang/src/bind/maintain_authorization.rs:93:                // preceding one. Invalidate loop-carried requirements before
snapback4/crates/snapback4-lang/src/bind/maintain_authorization.rs:98:                let mut body_requirements = requirements.clone();
snapback4/crates/snapback4-lang/src/bind/maintain_authorization.rs:99:                body_requirements.retain(|condition| !mentions_any(condition, &assigned));
snapback4/crates/snapback4-lang/src/bind/maintain_authorization.rs:100:                body_requirements.retain(|condition| !mentions_any(condition, std::slice::from_ref(name)));
snapback4/crates/snapback4-lang/src/bind/maintain_authorization.rs:101:                inspect(body, &mut body_requirements, visit);
snapback4/crates/snapback4-lang/src/bind/maintain_authorization.rs:102:                requirements.retain(|condition| !mentions_any(condition, &assigned));
snapback4/crates/snapback4-lang/src/bind/maintain_authorization.rs:110:                requirements.retain(|condition| !mentions_any(condition, &assigned));
snapback4/crates/snapback4-lang/src/bind/maintain_authorization.rs:118:fn contains(requirements: &[Expr], condition: &Expr) -> bool {
snapback4/crates/snapback4-lang/src/bind/maintain_authorization.rs:120:    requirements.iter().any(|candidate| canonical(candidate.clone()) == condition)
snapback4/crates/snapback4-lang/src/bind/security/challenges.rs:479:        let dummy=Invariant{table:target,target:"read".into(),column:None,predicate:"allow".into(),site:crate::Site::default(),policy:Some(RuleExpr::Allow),operation:Some(p.program.name.clone()),requirements:Vec::new(),syntax:None,unsupported:None};
snapback4/crates/snapback4-lang/src/bind/security/challenges/stability.rs:25:pub(super) fn dependencies(bound:&Bound,rule:&RuleExpr)->BTreeSet<String>{
snapback4/crates/snapback4-lang/src/bind/security/operation.rs:18:pub(super) fn requirements(catalog:&Catalog,info:&TableInfo,p:&ProgramDecl)->Vec<RuleExpr>{
snapback4/crates/snapback4-lang/src/bind/security/operation.rs:30:    let dependencies=inv.requirements.iter().flat_map(kernel::dependencies).collect::<BTreeSet<_>>();
snapback4/crates/snapback4-lang/src/bind/security/operation.rs:37:    let admission=RuleExpr::And(inv.requirements.clone());
snapback4/crates/snapback4-lang/src/bind/security/privilege.rs:39:pub(super) fn membership_grant_risk(bound:&Bound,roster:&str,operation:&str,requirements:&[RuleExpr],op:ast::WriteOp,fields:&[ast::ObjectField])->bool{
snapback4/crates/snapback4-lang/src/bind/security/privilege.rs:40:    if op==ast::WriteOp::Upsert{return membership_grant_risk(bound,roster,operation,requirements,ast::WriteOp::Insert,fields)||membership_grant_risk(bound,roster,operation,requirements,ast::WriteOp::Update,fields);}
//! Conjunctive payload write authority shared by all write arms.
// @ref LLP 3000.036.004.000#2-column-write-authority — defaults and both upsert arms use the ordinary rule boundary.
use super::*;
impl Table {
    pub fn guarded_rule(&self, effect: Effect) -> std::borrow::Cow<'_, RuleExpr> {
        let base = if effect == Effect::Update { self.update_rule_judged() } else { std::borrow::Cow::Borrowed(self.rules.for_effect(effect)) };
        if self.column_writes.is_empty() || !matches!(effect,Effect::Insert|Effect::Update) { return base; }
        let mut rules=vec![base.into_owned()];
        for (column,policy) in &self.column_writes {
            let same = if effect == Effect::Insert { RuleExpr::Eq(RuleTerm::Field(column.clone()),RuleTerm::Literal(Value::Null)) }
                else { RuleExpr::Eq(RuleTerm::OldField(column.clone()),RuleTerm::Field(column.clone())) };
            rules.push(RuleExpr::Or(vec![same,if effect==Effect::Insert {policy.clone()} else {policy.old_and_next()}]));
        }
        std::borrow::Cow::Owned(RuleExpr::And(rules))
    }
}
pub fn validate(schema:&Schema)->Vec<SchemaIssue>{
    let mut issues=Vec::new();
    for (name,t) in &schema.tables {
        for (column,rule) in t.column_writes.iter().chain(&t.frozen_columns) {
            let path=format!("tables.{name}.column_writes.{column}");
            if column=="id" || !t.columns.contains_key(column) || t.engine_field(column) || t.maintained.contains_key(column) || t.sequences.contains_key(column) || schema.maintain_for(name).is_some() || schema.timelines.iter().any(|timeline|timeline.owns(name)||timeline.maps(name)) || schema.receipts.iter().any(|r|r.messages==*name||r.members==*name||r.runs==*name) || t.written_by.contains_key(column) || t.on_delete.get(column)==Some(&references::OnDelete::SetNull) {
                issues.push(SchemaIssue{path:path.clone(),message:"column write/freeze needs an ordinary payload column without owner-field bypass or on delete set null".into()});
            }
            super::validate_rule(schema,t,rule,false,false,&path,&mut issues);
            if rule.any_term(&|term|matches!(term,RuleTerm::OldField(_)|RuleTerm::NextField(_))) {
                issues.push(SchemaIssue{path,message:"column write/freeze policies use current-row fields, never named transition images".into()});
            }
        }
    }
    issues
}
rg: snapback4/crates/snapback4-core/src/interpret*: IO error for operation on snapback4/crates/snapback4-core/src/interpret*: No such file or directory (os error 2)

exec
/bin/bash -lc "cat snapback4/crates/snapback4-lang/src/bind/security/operation.rs; sed -n '1,130p' snapback4/crates/snapback4-lang/src/bind/security/kernel.rs; sed -n '922,980p' snapback4/crates/snapback4-core/src/ir.rs; sed -n '150,220p' snapback4/crates/snapback4-core/src/ir.rs; rg -n 'update_rule_judged|old_and_next|frozen_columns' snapback4/crates/snapback4-core/src -g '*.rs' | head -60" in /home/ccheever/projects/sb4-b27-rel
 succeeded in 0ms:
//! Narrow stable leading-require reduction for operation-specific authority.
// @ref LLP 3000.036.004#81-exact-conservative-boundary-review-clarification — unknown write sets never establish stability.
use super::*;
use crate::ast::{Stmt,ProgramDecl,ProgramKind,InvariantDecl,RuleDecl};
use super::super::catalog::TableInfo;
pub(super) fn resolve<'a>(catalog:&'a Catalog,decl:&InvariantDecl)->Option<(String,&'a ProgramDecl)>{
    if matches!(decl.target.as_str(),"read"|"insert"|"update"|"delete"|"always"|"write"){return None;}
    let matches=catalog.documents.iter().flat_map(|d|{let module=std::path::Path::new(&d.file).file_stem().unwrap().to_string_lossy();d.programs.iter().map(move|p|(super::super::operation_name(&module,&p.name),p))})
        .filter(|(name,p)|p.kind==ProgramKind::Mutation&&(name==&decl.target||p.name==decl.target)).collect::<Vec<_>>();
    if matches.len()==1 {matches.into_iter().next()}else{None}
}
pub(super) fn safe(rule:&RuleExpr)->bool {match rule{
    RuleExpr::Exists{key,equalities,..}=>key.iter().chain(equalities.iter().map(|(_,t)|t)).all(|t|matches!(t,RuleTerm::Viewer|RuleTerm::Literal(_))),
    RuleExpr::And(xs)|RuleExpr::Or(xs)=>xs.iter().all(safe),
    RuleExpr::Eq(a,b)|RuleExpr::Ne(a,b)=>[a,b].iter().all(|t|matches!(t,RuleTerm::Viewer|RuleTerm::Literal(_))),
    RuleExpr::Allow|RuleExpr::Deny|RuleExpr::Public{..}=>true,_=>false,
}}
pub(super) fn requirements(catalog:&Catalog,info:&TableInfo,p:&ProgramDecl)->Vec<RuleExpr>{
    let mut out=Vec::new();
    for s in p.prelude.iter().chain(&p.body){let Stmt::Require{condition,site,..}=s else{break};
        let decl=RuleDecl{effect:ast::Effect::Read,bindings:Vec::new(),value:condition.clone(),site:site.clone()};
        if let Ok(rule)=super::super::schema::bind_rule(catalog,info,&decl)&&safe(&rule){out.push(rule);}
    }out
}
pub(super) fn prove(bound:&Bound,inv:&Invariant)->Result<bool,String>{
    let p=bound.programs.iter().find(|p|Some(&p.program.name)==inv.operation.as_ref()).ok_or("operation did not bind")?;
    if !safe(inv.policy.as_ref().ok_or("unsupported policy")?){return Err("operation policy needs unsupported target-image, negative-probe or live-reference bindings".into());}
    let writes=snapback4_core::ir::write_tables(&p.program);
    if !writes.iter().any(|(t,_)|t==&inv.table){return Err("operation has no direct write to the named table; implicit effects require a reduction".into());}
    let dependencies=inv.requirements.iter().flat_map(kernel::dependencies).collect::<BTreeSet<_>>();
    if writes.iter().any(|(t,_)|dependencies.contains(t)) {return Err("require dependency can be changed by this operation, including its target write".into());}
    if bound.schema.tables.values().any(|t|!t.maintained.is_empty()||!t.sequences.is_empty()||t.on_delete.values().any(|a|a.writes())) || !bound.schema.maintains.is_empty(){return Err("implicit maintain/sequence/referential writes require dependency stability reduction".into());}
    // Source helpers/control flow may hide write sets or viewer changes.
    let json=serde_json::to_value(&p.program).unwrap();
    fn opaque(v:&serde_json::Value)->bool{match v{serde_json::Value::Object(m)=>m.keys().any(|k|matches!(k.as_str(),"For"|"If"|"JobAs"|"JobQuery"|"Emit"))||m.values().any(opaque),serde_json::Value::Array(xs)=>xs.iter().any(opaque),_=>false}}
    if opaque(&json){return Err("operation control flow or opaque effects are outside stable leading-require reduction".into());}
    let admission=RuleExpr::And(inv.requirements.clone());
    // Table-rule gates can only further restrict a dominating stable require;
    // using the require alone overapproximates effective owner-field gates.
    kernel::implies(&admission,inv.policy.as_ref().unwrap())
}
//! Finite three-valued implication, deliberately independent of database facts.
// @ref LLP 3000.036.004#3-sound-proof-boundary — impossible valuations overapproximate all snapshots.
use snapback4_core::schema::{RuleExpr as R, RuleTerm as T};
use std::collections::BTreeSet;

pub const MAX_ATOMS: usize = 10;
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Truth { Yes, No, Unknown }
impl Truth {
    fn not(self) -> Self { match self { Self::Yes => Self::No, Self::No => Self::Yes, Self::Unknown => Self::Unknown } }
    fn combine(self, other: Self, and: bool) -> Self {
        let decisive = if and { Self::No } else { Self::Yes };
        if self == decisive || other == decisive { decisive }
        else if self == Self::Unknown || other == Self::Unknown { Self::Unknown }
        else { decisive.not() }
    }
}
#[derive(Clone, Debug)]
enum Formula { Constant(Truth), Atom(usize), Not(Box<Self>), And(Vec<Self>), Or(Vec<Self>) }
impl Formula {
    fn eval(&self, values: &[Truth]) -> Truth {
        match self {
            Self::Constant(v) => *v, Self::Atom(n) => values[*n], Self::Not(x) => x.eval(values).not(),
            Self::And(xs) => xs.iter().fold(Truth::Yes, |v, x| v.combine(x.eval(values), true)),
            Self::Or(xs) => xs.iter().fold(Truth::No, |v, x| v.combine(x.eval(values), false)),
        }
    }
}
fn term(t: &T) -> T { match t { T::NextField(f) => T::Field(f.clone()), other => other.clone() } }
fn atom(rule: &R) -> String {
    let mut r = rule.clone();
    match &mut r {
        R::Eq(a,b) | R::Compare(_,a,b) => { *a=term(a); *b=term(b); }
        R::Exists { key, equalities, .. } | R::Created { key, equalities, .. } => {
            for t in key { *t=term(t); }
            for (_,t) in equalities.iter_mut() { *t=term(t); }
            equalities.sort_by(|a,b| a.0.cmp(&b.0));
        }
        _ => {}
    }
    if let R::Eq(a,b)=&mut r && serde_json::to_string(a).unwrap()>serde_json::to_string(b).unwrap() { std::mem::swap(a,b); }
    let mut json=serde_json::to_value(&r).unwrap();
    // Provenance controls planning, not rule evaluation. Remove only this
    // leaf's metadata, never a similarly named literal-object field.
    for name in ["Exists","Created"] { if let Some(body)=json.get_mut(name).and_then(serde_json::Value::as_object_mut) { body.remove("provenance"); } }
    json.to_string()
}
fn formula(rule: &R, atoms: &mut Vec<String>, nodes: &mut usize) -> Result<Formula, String> {
    *nodes+=1; if *nodes>1024 { return Err("formula exceeds 1024 nodes".into()); }
    Ok(match rule {
        R::Allow | R::Public {..} => Formula::Constant(Truth::Yes), R::Deny => Formula::Constant(Truth::No),
        R::And(xs) => Formula::And(xs.iter().map(|r| formula(r,atoms,nodes)).collect::<Result<_,_>>()?),
        R::Or(xs) => Formula::Or(xs.iter().map(|r| formula(r,atoms,nodes)).collect::<Result<_,_>>()?),
        R::Not(x) => Formula::Not(Box::new(formula(x,atoms,nodes)?)),
        R::Ne(a,b) => Formula::Not(Box::new(formula(&R::Eq(a.clone(),b.clone()),atoms,nodes)?)),
        R::Eq(T::Literal(a),T::Literal(b)) => Formula::Constant(if a==b {Truth::Yes}else{Truth::No}),
        R::Eq(T::Viewer,T::Viewer) => Formula::Constant(Truth::Yes),
        other => { let key=atom(other); let n=atoms.iter().position(|a| a==&key).unwrap_or_else(|| {atoms.push(key);atoms.len()-1});
            if atoms.len()>MAX_ATOMS {return Err(format!("more than {MAX_ATOMS} independent predicates"));} Formula::Atom(n) }
    })
}
// @ref LLP 3000.036.004#133-coverage-and-bounded-checking — exact inputs only; no fixture assumptions.
thread_local! {
    static IMPLICATIONS: std::cell::RefCell<std::collections::BTreeMap<String,Result<bool,String>>> = const { std::cell::RefCell::new(std::collections::BTreeMap::new()) };
}
/// Only exact kernel implication results are reused, never concrete judgments.
pub fn implies(admission: &R, policy: &R) -> Result<bool,String> {
    let key=serde_json::to_string(&(admission,policy)).unwrap();
    if let Some(result)=IMPLICATIONS.with(|cache|cache.borrow().get(&key).cloned()){return result;}
    let result=uncached(admission,policy);
    IMPLICATIONS.with(|cache|{let mut cache=cache.borrow_mut();if cache.len()>=4096{cache.clear();}cache.insert(key,result.clone());});
    result
}
fn uncached(admission: &R, policy: &R) -> Result<bool,String> {
    let (mut atoms,mut nodes)=(Vec::new(),0);
    let a=formula(admission,&mut atoms,&mut nodes)?;
    let p=formula(policy,&mut atoms,&mut nodes)?;
    let mut values=vec![Truth::Unknown;atoms.len()];
    for mut n in 0..3usize.pow(atoms.len() as u32) {
        for v in &mut values { *v=match n%3 {0=>Truth::Yes,1=>Truth::No,_=>Truth::Unknown}; n/=3; }
        if a.eval(&values)==Truth::Yes && p.eval(&values)!=Truth::Yes { return Ok(false); }
    }
    Ok(true)
}
pub fn dependencies(rule: &R) -> BTreeSet<String> {
    let mut out=BTreeSet::new();
    match rule {
        R::Exists{table,key,equalities,..}|R::Created{table,key,equalities,..} => {out.insert(table.clone());for term in key.iter().chain(equalities.iter().map(|(_,t)|t)){for (table,_) in term.references(){out.insert(table.into());}}}
        R::And(xs)|R::Or(xs) => for x in xs {out.extend(dependencies(x));}, R::Not(x) => out.extend(dependencies(x)),
        R::Eq(a,b)|R::Ne(a,b)|R::Compare(_,a,b) => for t in [a,b] { for (table,_) in t.references() {out.insert(table.into());} },
        _=>{}
    }
    out
}
#[cfg(test)] mod tests {
    use super::*;
    fn a() -> R { R::Eq(T::Field("owner".into()),T::Viewer) }
    #[test] fn kleene_unknown_is_neither_true_nor_false() {
        assert_eq!(Truth::Unknown.not(),Truth::Unknown);
        assert_eq!(Truth::No.combine(Truth::Unknown,true),Truth::No);
        assert_eq!(Truth::Yes.combine(Truth::Unknown,false),Truth::Yes);
        assert!(!implies(&R::Allow,&R::Or(vec![a(),R::Not(Box::new(a()))])).unwrap());
    }
    #[test] fn no_boolean_assignment_is_a_concrete_refutation() {
        assert!(implies(&R::And(vec![a(),R::Deny]),&R::Deny).unwrap());
        assert!(!implies(&R::Allow,&a()).unwrap());
        assert!(implies(&a(),&R::Eq(T::Viewer,T::Field("owner".into()))).unwrap());
        let xs=(0..11).map(|n|R::Eq(T::Field(format!("f{n}")),T::Viewer)).collect();
        assert!(implies(&R::And(xs),&a()).is_err());
    }
}
pub fn write_tables(program: &Program) -> Vec<(String, &'static str)> {
    let mut out = Vec::new();
    stmts_write_tables(&program.body, &mut out);
    out
}

mod writes;
use writes::stmts_write_tables;
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum Stmt {
    Const { name: String, value: Expr },
    Let { name: String, value: Expr },
    Assign { name: String, value: Expr },
    Push { target: String, value: Expr },
    If { condition: Expr, then_body: Vec<Stmt>, else_body: Vec<Stmt> },
    For { binding: String, domain: LoopDomain, body: Vec<Stmt> },
    Require {
        condition: Expr,
        code: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        site: Option<String>,
        /// The author's text for the refusal (`require … else CODE 'message'`); the code stays the contract.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        message: Option<String>,
    },
    /// A false predicate rolls the transaction back and re-reads `current`.
    Check { condition: Expr, current: Read },
    /// A unique clash yields absence, never the conflicting row.
    InsertIfAbsent { table: String, row: Expr, result: String },
    Insert { table: String, row: Expr },
    Update { table: String, key: Expr, patch: Expr },
    Upsert { table: String, key: Expr, row: Expr },
    /// Target lookup and the old image stay inside the engine. Only a read-filtered result is bound.
    WriteTarget { target: Read, patch: Expr, upsert: bool, condition: Option<WriteCondition>, result: Option<String> },
    Delete { table: String, key: Expr },
    /// Alternate-key delete resolves inside the engine before charging hidden expiry work.
    DeleteTarget { target: Read },
    Emit { effect: String, payload: Expr, #[serde(default, skip_serializing_if = "Option::is_none")] once: Option<Expr> },
    Return(Expr),
    Break,
    Continue,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct WriteCondition {
    pub old: String,
    pub setup: Vec<Stmt>,
    pub value: Expr,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum LoopDomain {
    Page(Scan),
    LiteralRange { start: i64, end_exclusive: i64 },
    ExpressionRange { start: Expr, end_exclusive: Expr },
    ArgList { name: String, max: u32 },
    DerivedArray { value: Expr, max: u32, bound_source: String },
    Recurse(Recurse),
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Recurse {
    pub site: String,
    pub table: String,
    pub index: String,
    pub seed: Box<Expr>,
    pub next_field: String,
    pub depth: u32,
    pub fanout: u32,
    pub provenance: KeyProvenance,
}

pub const MAX_RECURSE_DEPTH: u32 = 10_000;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum Expr {
    Literal(Value),
snapback4/crates/snapback4-core/src/schema/field_authority.rs:72:        for rule in table.column_writes.values().chain(table.frozen_columns.values()){private_rule(schema,name,rule,false,&mut issue);}
snapback4/crates/snapback4-core/src/schema/reservations.rs:97:    plan.server_only = !table.column_writes.is_empty() || !table.frozen_columns.is_empty();
snapback4/crates/snapback4-core/src/engine/write_target.rs:16:        if self.device&&self.schema.tables.get(table).is_some_and(|t|!t.column_writes.is_empty()||!t.frozen_columns.is_empty()){
snapback4/crates/snapback4-core/src/engine/write_target.rs:58:        let hidden_probes=table.column_writes.keys().chain(table.frozen_columns.keys()).filter_map(|c|table.column_reads.get(c)).map(rule_probes).fold(0u64,u64::saturating_add);
snapback4/crates/snapback4-core/src/engine/write_target.rs:59:        let frozen_probes=table.frozen_columns.values().map(rule_probes).fold(hidden_probes,u64::saturating_add);
snapback4/crates/snapback4-core/src/engine/write_target.rs:60:        let frozen_heap=table.frozen_columns.values().chain(table.column_writes.keys().chain(table.frozen_columns.keys()).filter_map(|c|table.column_reads.get(c))).map(|rule|self.rule_scratch(rule)).max().unwrap_or(0);
snapback4/crates/snapback4-core/src/schema/update_images.rs:26:    pub fn old_and_next(&self) -> RuleExpr {
snapback4/crates/snapback4-core/src/schema/update_images.rs:53:    pub fn update_rule_judged(&self) -> std::borrow::Cow<'_, RuleExpr> {
snapback4/crates/snapback4-core/src/schema/update_images.rs:54:        if self.judges_old_image() { std::borrow::Cow::Owned(self.rules.update.old_and_next()) } else { std::borrow::Cow::Borrowed(&self.rules.update) }
snapback4/crates/snapback4-core/src/schema/update_images.rs:71:        assert_eq!(*table.update_rule_judged(), RuleExpr::And(vec![
snapback4/crates/snapback4-core/src/schema/update_images.rs:75:        assert_eq!(*table.update_rule_judged(), owner_rule());
snapback4/crates/snapback4-core/src/schema/capabilities.rs:79:    ("column-write-v1", |s| s.tables.values().any(|t| !t.column_writes.is_empty() || !t.frozen_columns.is_empty())),
snapback4/crates/snapback4-core/src/schema/column_reads.rs:215:        for rule in table.column_writes.values().chain(table.frozen_columns.values()){walk.rule(name,rule,&path);}
snapback4/crates/snapback4-core/src/engine/field_authority.rs:101:            for field in definition.column_writes.keys().chain(definition.frozen_columns.keys()) {
snapback4/crates/snapback4-core/src/schema/column_writes.rs:6:        let base = if effect == Effect::Update { self.update_rule_judged() } else { std::borrow::Cow::Borrowed(self.rules.for_effect(effect)) };
snapback4/crates/snapback4-core/src/schema/column_writes.rs:12:            rules.push(RuleExpr::Or(vec![same,if effect==Effect::Insert {policy.clone()} else {policy.old_and_next()}]));
snapback4/crates/snapback4-core/src/schema/column_writes.rs:20:        for (column,rule) in t.column_writes.iter().chain(&t.frozen_columns) {
snapback4/crates/snapback4-core/src/engine/timeline_authority_tests.rs:12:    let table = Table { ephemeral: None, sequences: Default::default(), column_writes: Default::default(), frozen_columns: Default::default(), column_reads: Default::default(), written_by: Default::default(), update_transition: false, through: None, on_delete: Default::default(), recorded: Default::default(), maintained: Default::default(), residency: Default::default(), defaults: Default::default(),
snapback4/crates/snapback4-core/src/engine/column_writes.rs:6:    pub(super) fn check_frozen_columns(&mut self, name:&str, old:&Value, next:&Value)->Result<(),RuntimeError>{
snapback4/crates/snapback4-core/src/engine/column_writes.rs:8:        if table.frozen_columns.is_empty(){return Ok(());}
snapback4/crates/snapback4-core/src/engine/column_writes.rs:11:        for (field,condition) in &table.frozen_columns {
snapback4/crates/snapback4-core/src/engine/rules.rs:1269:        let RuleExpr::And(terms) = rule else { unreachable!("old_and_next is a conjunction") };
snapback4/crates/snapback4-core/src/engine/update_image_tests.rs:30:                let judged=rule.old_and_next();
snapback4/crates/snapback4-core/src/engine/update_image_tests.rs:46:        let (allowed,actual)=rules::evaluate_update(&rule.old_and_next(),true,"alice",Some(&old),&next,&mut probe).unwrap();
snapback4/crates/snapback4-core/src/engine/update_image_tests.rs:68:                        schema.tables.get_mut("notes").unwrap().rules.update=schema.tables["notes"].rules.update.old_and_next();
snapback4/crates/snapback4-core/src/schema.rs:360:    pub frozen_columns: BTreeMap<String, RuleExpr>,
snapback4/crates/snapback4-core/src/schema.rs:1111:        sequences: Default::default(), column_writes: Default::default(), frozen_columns: Default::default(), column_reads: Default::default(), written_by: Default::default(), update_transition: false, through: None, on_delete: BTreeMap::new(),
snapback4/crates/snapback4-core/src/engine/write.rs:43:        if self.device && (!self.schema.tables[table_name].column_writes.is_empty() || !self.schema.tables[table_name].frozen_columns.is_empty() || self.schema.tables[table_name].not_before.is_some() || self.schema.tables[table_name].column_server_reads()) {
snapback4/crates/snapback4-core/src/engine/write.rs:272:        if self.device && (!self.schema.tables[table_name].column_writes.is_empty() || !self.schema.tables[table_name].frozen_columns.is_empty() || self.schema.tables[table_name].not_before.is_some() || self.schema.tables[table_name].column_server_reads()) {
snapback4/crates/snapback4-core/src/engine/write.rs:306:        if self.device && (!self.schema.tables[table_name].column_writes.is_empty() || !self.schema.tables[table_name].frozen_columns.is_empty() || self.schema.tables[table_name].not_before.is_some() || self.schema.tables[table_name].column_server_reads()) {
snapback4/crates/snapback4-core/src/engine/write.rs:400:        self.check_frozen_columns(table_name, &old, &new).map_err(|e|if readable{e}else{self.no_write_target()})?;
snapback4/crates/snapback4-core/src/engine/write.rs:416:        if self.device && (!self.schema.tables[table_name].column_writes.is_empty() || !self.schema.tables[table_name].frozen_columns.is_empty() || self.schema.tables[table_name].not_before.is_some() || self.schema.tables[table_name].column_server_reads()) {
snapback4/crates/snapback4-core/src/store/asset_renames.rs:13:    table.frozen_columns=replace_keys(std::mem::take(&mut table.frozen_columns),map);
snapback4/crates/snapback4-core/src/store/asset_renames.rs:19:    for r in table.column_reads.values_mut().chain(table.column_writes.values_mut()).chain(table.frozen_columns.values_mut()){rule(r,map)}
snapback4/crates/snapback4-core/src/engine/mod.rs:1104:                if let Some(old)=&old {runner.check_frozen_columns(&name,old,&row)?;}
snapback4/crates/snapback4-core/src/engine/mod.rs:1173:                if mode==LoadMode::Import && let Some(old)=&old {runner.check_frozen_columns(&table_name,old,&row)?;}
snapback4/crates/snapback4-core/src/store/rollback_guard_population.rs:409:    if schema.tables.values().any(|t|t.frozen_columns.values().any(|r|json_taint(&serde_json::to_value(r).unwrap(),&BTreeSet::new(),hidden))) {return Err(refuse());}

exec
/bin/bash -lc "cat snapback4/crates/snapback4-core/src/ir/writes.rs; cat snapback4/crates/snapback4-core/src/schema/update_images.rs; sed -n '220,420p' snapback4/crates/snapback4-core/src/ir.rs; sed -n '1,110p' snapback4/crates/snapback4-lang/src/bind/security.rs" in /home/ccheever/projects/sb4-b27-rel
 succeeded in 0ms:
//! Expanded helpers can write from any expression block.
// @ref LLP 3000.022#14.3 — legacy eligibility examines the complete expanded write footprint.
use super::*;
pub(super) fn stmts_write_tables(stmts: &[Stmt], out: &mut Vec<(String, &'static str)>) {
    for stmt in stmts {
        match stmt {
            Stmt::Insert { table, .. } | Stmt::InsertIfAbsent { table, .. } => out.push((table.clone(), "insert")),
            Stmt::Update { table, .. } => out.push((table.clone(), "update")),
            Stmt::Upsert { table, .. } => out.push((table.clone(), "upsert")),
            Stmt::WriteTarget { target, upsert, .. } => out.push((target.table.clone(), if *upsert { "upsert" } else { "update" })),
            Stmt::Delete { table, .. } => out.push((table.clone(), "delete")),
            Stmt::DeleteTarget { target } => out.push((target.table.clone(), "delete")),
            _ => {}
        }
        match stmt {
            Stmt::Const { value, .. } | Stmt::Let { value, .. } | Stmt::Assign { value, .. } | Stmt::Push { value, .. } | Stmt::Return(value) => expr_write_tables(value, out),
            Stmt::Emit { payload: value, once, .. } => { expr_write_tables(value, out); if let Some(value) = once { expr_write_tables(value, out); } },
            Stmt::If { condition, then_body, else_body } => {
                expr_write_tables(condition, out);
                stmts_write_tables(then_body, out);
                stmts_write_tables(else_body, out);
            }
            Stmt::For { domain, body, .. } => {
                match domain {
                    LoopDomain::Page(scan) => scan_write_tables(scan, out),
                    LoopDomain::ExpressionRange { start, end_exclusive } => { expr_write_tables(start, out); expr_write_tables(end_exclusive, out); }
                    LoopDomain::DerivedArray { value, .. } => expr_write_tables(value, out),
                    LoopDomain::Recurse(recurse) => {
                        expr_write_tables(&recurse.seed, out);
                    }
                    LoopDomain::LiteralRange { .. } | LoopDomain::ArgList { .. } => {}
                }
                stmts_write_tables(body, out);
            }
            Stmt::Require { condition, .. } => expr_write_tables(condition, out),
            Stmt::Check { condition, current } => {
                expr_write_tables(condition, out);
                for key in &current.key { expr_write_tables(key, out); }
            }
            Stmt::InsertIfAbsent { row, .. } | Stmt::Insert { row, .. } => expr_write_tables(row, out),
            Stmt::Update { key, patch, .. } => {
                expr_write_tables(key, out);
                expr_write_tables(patch, out);
            }
            Stmt::Upsert { key, row, .. } => {
                expr_write_tables(key, out);
                expr_write_tables(row, out);
            }
            Stmt::WriteTarget { target, patch, condition, .. } => {
                for key in &target.key { expr_write_tables(key, out); }
                expr_write_tables(patch, out);
                if let Some(condition) = condition { stmts_write_tables(&condition.setup, out); expr_write_tables(&condition.value, out); }
            }
            Stmt::Delete { key, .. } => expr_write_tables(key, out),
            Stmt::DeleteTarget { target } => {
                for key in &target.key { expr_write_tables(key, out); }
            }
            Stmt::Break | Stmt::Continue => {}
        }
    }
}

fn scan_write_tables(scan: &Scan, out: &mut Vec<(String, &'static str)>) {
    if let Some(filter) = &scan.filter { expr_write_tables(filter, out); }
    if let Some(range) = &scan.range {
        for bound in [&range.gt, &range.gte, &range.lt, &range.lte].into_iter().flatten() { expr_write_tables(bound, out); }
    }
    for key in &scan.prefix {
        match key { IndexKeyExpr::Scalar(expr) | IndexKeyExpr::WordPrefix(expr) => expr_write_tables(expr, out) }
    }
    for cursor in [&scan.after, &scan.before].into_iter().flatten() { expr_write_tables(cursor, out); }
}

fn expr_write_tables(expr: &Expr, out: &mut Vec<(String, &'static str)>) {
    match expr {
        Expr::Literal(_) | Expr::Variable(_) | Expr::Input(_) => {}
        Expr::Field { base, .. } => expr_write_tables(base, out),
        Expr::Array(items) => items.iter().for_each(|item| expr_write_tables(item, out)),
        Expr::Object(fields) => fields.values().for_each(|item| expr_write_tables(item, out)),
        Expr::Shape { base, fields } => { expr_write_tables(base, out); fields.values().for_each(|item| expr_write_tables(item, out)); }
        Expr::Binary { left, right, .. } => {
            expr_write_tables(left, out);
            expr_write_tables(right, out);
        }
        Expr::Unary { value, .. } => expr_write_tables(value, out),
        Expr::Builtin { args, .. } => args.iter().for_each(|item| expr_write_tables(item, out)),
        Expr::Get(read) | Expr::Exists(read) => {
            read.key.iter().for_each(|item| expr_write_tables(item, out));
        }
        Expr::Block { body, value } => { stmts_write_tables(body, out); expr_write_tables(value, out); }
        Expr::Scan(scan) => scan_write_tables(scan, out),
        Expr::Merge(merge) => {
            if let Some(after) = merge.position.as_ref().and_then(|position| position.after.as_ref()) { expr_write_tables(after, out); }
            for lane in &merge.lanes {
                if let Some(guard) = &lane.guard { expr_write_tables(guard, out); }
                if let Some(project) = &lane.project { expr_write_tables(project, out); }
                if let Some(value) = &lane.distinct { expr_write_tables(value, out); }
                stmts_write_tables(&lane.setup, out);
                if let Some(source) = &lane.source {
                    if let Some(scan) = source.scan() { scan_write_tables(scan, out); }
                    for value in source.expressions() { expr_write_tables(value, out); }
                }
                scan_write_tables(&lane.scan, out);
            }
        }
    }
}
//! Which row images an update rule judges.
// @ref LLP 3000.007#8 — item 7(a): an unnamed `update <- R` judges the row before and after the write, `R[old] and R[next]`.
//
// The rules card and `why NOT_FOUND` say "the update rule judges old and
// next", as Postgres applies an `UPDATE` policy's `USING` to the old row and
// (absent `WITH CHECK`) to the new one. Judging only the next image let any
// caller take over another principal's row under `update <- .owner = viewer`
// by writing `owner: viewer` (found by the Lean oracle, LLP 3000.035 §5.2).
use super::{RuleExpr, RuleTerm, Table};

impl RuleExpr {
    fn terms_mut(&mut self, term: &mut dyn FnMut(&mut RuleTerm)) {
        match self {
            Self::Eq(a, b) | Self::Ne(a, b) | Self::Compare(_, a, b) => { term(a); term(b); }
            Self::And(items) | Self::Or(items) => for item in items { item.terms_mut(term); },
            Self::Not(inner) => inner.terms_mut(term),
            Self::Exists { key, equalities, .. } | Self::Created { key, equalities, .. } =>
                key.iter_mut().chain(equalities.iter_mut().map(|(_, value)| value)).for_each(term),
            Self::Public { .. } | Self::Allow | Self::Deny => {}
        }
    }

    /// An unnamed update rule's meaning: `R[old] and R[next]`, old first.
    /// In the old copy `.f` becomes `old.f` and reference hops start from the
    /// old row; literals and `viewer` are unchanged.
    pub fn old_and_next(&self) -> RuleExpr {
        let mut old = self.clone();
        old.terms_mut(&mut |term| match term {
            RuleTerm::Field(field) => *term = RuleTerm::OldField(std::mem::take(field)),
            RuleTerm::Reference { old, .. } | RuleTerm::ReferenceChain { old, .. } => *old = true,
            _ => {}
        });
        Self::And(vec![old, self.clone()])
    }
}

impl Table {
    /// Whether the engine judges this table's update rule over the old image
    /// as well: true for an unnamed rule that reads a column a patch can
    /// change. A named `update (old, next)` transition is judged as written.
    /// A rule reading only `id` and immutable columns is judged once: a patch
    /// cannot change those inputs (a hidden target drops immutable patch
    /// fields; a readable mismatch is refused), so both images give one
    /// verdict at one prepaid probe cost. The decision is static, so the
    /// meter never depends on the row.
    pub fn judges_old_image(&self) -> bool {
        !self.update_transition && self.rules.update.any_term(&|term| matches!(term,
            RuleTerm::Field(column) | RuleTerm::Reference { column, .. } | RuleTerm::ReferenceChain { column, .. }
                if column != "id" && !self.constraints.iter().any(|constraint| matches!(constraint, super::Constraint::Immutable { fields } if fields.contains(column)))))
    }

    /// The update rule exactly as the engine evaluates it, for cost reports.
    pub fn update_rule_judged(&self) -> std::borrow::Cow<'_, RuleExpr> {
        if self.judges_old_image() { std::borrow::Cow::Owned(self.rules.update.old_and_next()) } else { std::borrow::Cow::Borrowed(&self.rules.update) }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::schema::Constraint;
    use crate::value::Value;

    fn owner_rule() -> RuleExpr { RuleExpr::Eq(RuleTerm::Field("owner".into()), RuleTerm::Viewer) }

    #[test]
    fn unnamed_rule_judges_both_images_unless_its_inputs_are_immutable() {
        let mut table = crate::schema::public_table(Default::default(), Default::default());
        table.rules.update = owner_rule();
        assert!(table.judges_old_image());
        assert_eq!(*table.update_rule_judged(), RuleExpr::And(vec![
            RuleExpr::Eq(RuleTerm::OldField("owner".into()), RuleTerm::Viewer), owner_rule()]));
        table.constraints.push(Constraint::Immutable { fields: vec!["owner".into()] });
        assert!(!table.judges_old_image(), "immutable inputs agree on both images");
        assert_eq!(*table.update_rule_judged(), owner_rule());
        table.rules.update = RuleExpr::Eq(RuleTerm::Field("id".into()), RuleTerm::Literal(Value::Id("x".into())));
        assert!(!table.judges_old_image(), "id never changes");
        table.update_transition = true;
        table.rules.update = RuleExpr::Eq(RuleTerm::NextField("state".into()), RuleTerm::Literal(Value::Int(1)));
        assert!(!table.judges_old_image(), "a named transition is judged as written");
    }
}
    Literal(Value),
    Variable(String),
    Input(Input),
    Field { base: Box<Expr>, name: String },
    Array(Vec<Expr>),
    Object(BTreeMap<String, Expr>),
    Shape { base: Box<Expr>, fields: BTreeMap<String, Expr> },
    Binary { op: BinaryOp, left: Box<Expr>, right: Box<Expr> },
    Unary { op: UnaryOp, value: Box<Expr> },
    Builtin { builtin: Builtin, args: Vec<Expr> },
    Get(Read),
    Exists(Read),
    Block { body: Vec<Stmt>, value: Box<Expr> },
    Scan(Scan),
    Merge(Merge),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum Input {
    Viewer,
    Now,
    NewId,
    ReadTime,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum BinaryOp {
    Eq,
    Ne,
    SameValueZero,
    Lt,
    Lte,
    Gt,
    Gte,
    Add,
    Sub,
    Mul,
    And,
    Or,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum UnaryOp {
    Not,
    Neg,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum Builtin {
    /// Server job read scope; its second argument is a read-only expression block.
    #[cfg(feature = "sqlite")]
    JobAs,
    /// A separately bound ordinary query, retaining its return/cursor plan.
    #[cfg(feature = "sqlite")]
    JobQuery { program: Box<Program>, cursor: Option<String>, all: bool },
    /// Compiler-owned projection of a successful insert result.
    ProjectFields { table: String },
    ReceiptSettled { table: String },
    /// A private field may be absent from a projected row.
    OptionalField { field: String, #[serde(default, skip_serializing_if = "std::ops::Not::not")] omit: bool, #[serde(default, skip_serializing_if = "std::ops::Not::not")] fallback: bool },
    Calendar { millis: i64 },
    // @ref LLP 3000.040#22-builtins — a new tag: an older device cannot decode a program that uses it.
    Civil(crate::calendar::Civil),
    Len,
    Slice,
    Concat,
    Lower,
    Trim,
    Text(crate::text::Function),
    Sha256,
    Join,
    Group { field: String, #[serde(default, skip_serializing_if = "std::ops::Not::not")] optional: bool },
    First,
    Last,
    At,
    Min,
    Max,
    /// SQL-style column extrema; domain reads require complete coverage.
    Extremum { field: String, max: bool, domain: bool },
    /// @ref LLP 3000.019#3.2 — expression extrema bind `$filter` per authorized row;
    /// args[0] is the source and args[1] the projection, as in streaming sum.
    /// The existing column extremum encoding is unchanged.
    ExtremumOf { max: bool, domain: bool },
    Divmod { remainder_sink: String },
    /// Checked exact integer division with an author-selected rounding rule.
    // @ref LLP 3000.013.001#2-rounded-division-table — the mode is a closed wire enum and evaluation never uses floating point.
    Divide {
        rounding: Rounding,
        /// Decimal places requested by the four-argument surface. `None`
        /// preserves the dividend's already-scaled representation.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        scale: Option<u8>,
    },
    Sort { keys: Vec<SortKey> },
    MentionTokens,
    SearchPresent,
    /// A query row assertion cannot classify a metered-out point as absent.
    RequireUncapped,
    DeterministicShare,
    Count,
    Sum,
    CountCapped,
    #[cfg(feature="sqlite")]
    FileText,
    /// `connected[p]`: how many connections the principal holds open on the
    /// server now; `exists connected[p]` is `> 0`. A device answers 1.
    Connected,
}

impl Builtin {
    pub fn arity(&self) -> usize {
        match self {
            Self::Text(f) => f.arity(),
            #[cfg(feature = "sqlite")]
            Self::JobQuery { .. } | Self::FileText => 1,
            #[cfg(feature = "sqlite")]
            Self::JobAs => 2,
            Self::ReceiptSettled { .. } | Self::Extremum { .. } | Self::ProjectFields { .. } | Self::OptionalField { fallback: false, .. } | Self::Calendar { .. } | Self::Civil(_) | Self::Group { .. } | Self::First | Self::Last | Self::Len | Self::Lower | Self::Trim | Self::Sha256 | Self::Sort { .. } | Self::MentionTokens | Self::SearchPresent | Self::RequireUncapped | Self::Count | Self::Sum | Self::CountCapped | Self::Connected => 1,
            Self::OptionalField { fallback: true, .. } | Self::ExtremumOf { .. } | Self::At | Self::Concat | Self::Join | Self::Min | Self::Max | Self::Divmod { .. } | Self::Divide { .. } => 2,
            Self::Slice | Self::DeterministicShare => 3,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Rounding {
    TowardZero,
    AwayFromZero,
    Floor,
    Ceiling,
    HalfAwayFromZero,
    HalfEven,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct SortKey {
    pub field: String,
    pub order: Order,
    /// The declared private field can be omitted by row projection.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub optional: bool,
}

/// A point read: one indexed key, all components bound.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Read {
    pub site: String,
    pub table: String,
    pub index: String,
    pub key: Vec<Expr>,
    pub provenance: KeyProvenance,
}

/// One index-key component of a scan prefix. Snapback 2 spelled a search
/// atom here too; Snapback 4 keeps only the scalar form.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum IndexKeyExpr {
    Scalar(Expr),
    WordPrefix(Expr),
}

impl IndexKeyExpr {
    pub fn scalar(&self) -> Option<&Expr> {
        match self {
            Self::Scalar(expr) => Some(expr),
            Self::WordPrefix(_) => None,
        }
    }
}

/// Stable presence identity: fixed storage and lossless JSON on every host.
pub type VariantId = [u32; 4];

/// A bounded range over an index prefix.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Scan {
    pub site: String,
    pub table: String,
    pub index: String,
    pub prefix: Vec<IndexKeyExpr>,
    pub order: Order,
    pub take: Bound,
    /// A program existence test consumes at most its first match below page ownership.
    #[serde(default, skip_serializing_if = "is_false")]
    pub existence: bool,
    #[serde(default)]
    pub after: Option<Box<Expr>>,
    #[serde(default)]
    pub before: Option<Box<Expr>>,
    #[serde(default)]
    pub range: Option<Range>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub filter: Option<Box<Expr>>,
    #[serde(default, skip_serializing_if = "is_false")]
    pub opaque_cursor: bool,
    #[serde(default)]
    pub merge_site: Option<String>,
    pub provenance: KeyProvenance,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub variant: Option<crate::ir::VariantId>,
//! Independent security intent and conservative exposure obligations.
// @ref LLP 3000.036.004#3-sound-proof-boundary — a direct-rule theorem never clears an unmodeled path.
use super::{catalog::Catalog, Bound};
use crate::{ast, Diagnostic, Site};
use snapback4_core::schema::{RuleExpr, RuleTerm, Schema, Effect};
use serde::Serialize;
use std::collections::{BTreeMap, BTreeSet};
pub mod kernel;
mod audit;
mod presentation;
pub use presentation::{note_priority,questionnaire_notes,gated_note,GATED_NOTE_CODES};
mod write_intent;
pub mod challenges;
mod lints;
mod write_advice;
pub mod derived;
mod creation_advice;
mod result_advice;
mod advice;
mod time_advice;
mod lifecycle_advice;
mod operation;
mod concrete;
mod census;
mod observers;
mod temporal;
mod adoption;
mod intent;
mod images;
mod columns;
mod privilege;
mod authority_walk;
pub use audit::{Exposure, Grant};
pub use observers::Obligation;
pub use adoption::{draft, UncoveredExposure};

#[derive(Clone, Debug, Serialize)]
pub struct Invariant {
    pub table: String,
    pub target: String,
    pub column: Option<String>,
    pub predicate: String,
    pub site: Site,
    pub policy: Option<RuleExpr>,
    pub operation: Option<String>,
    pub requirements: Vec<RuleExpr>,
    #[serde(skip)]
    pub syntax: Option<ast::Expr>,
    pub unsupported: Option<String>,
}
impl Invariant {
    pub fn target_label(&self)->String {match &self.column{Some(c)=>format!("{}.{} {}",self.table,c,self.target),None=>format!("{}.{}",self.table,self.target)}}
}
pub(super) fn bind(catalog: &Catalog, diagnostics: &mut Vec<Diagnostic>) -> Vec<Invariant> {
    let mut out=Vec::new();
    for decl in catalog.documents.iter().flat_map(|d| &d.invariants) {
        let Some(info)=catalog.tables.get(&decl.table) else {
            diagnostics.push(Diagnostic::new(&decl.site,"E_SECURITY_TARGET",format!("invariant names unknown table {}",decl.table),"declare the table or correct its name").guide("security")); continue;
        };
        let named_operation=operation::resolve(catalog,decl);
        if (!matches!(decl.target.as_str(),"read"|"insert"|"update"|"delete"|"write"|"always") && named_operation.is_none())
            || decl.column.as_ref().is_some_and(|c|c!="id"&&!info.columns.contains_key(c)) {
            diagnostics.push(Diagnostic::new(&decl.site,"E_SECURITY_TARGET","invariant needs a declared column or table effect","use invariant table.read only <policy>, table.column write only <policy>, or table always <predicate>").guide("security")); continue;
        }
        let effect=match decl.target.as_str(){"insert"=>ast::Effect::Insert,"update"|"write"=>ast::Effect::Update,"delete"=>ast::Effect::Delete,_=>ast::Effect::Read};
        // Independent intent may use authorized reference operands even when a
        // runtime read gate must use captured authority. It never installs a gate.
        let effect=if effect==ast::Effect::Read{ast::Effect::Insert}else{effect};
        let rule=ast::RuleDecl{effect,bindings:Vec::new(),value:decl.value.clone(),site:decl.site.clone()};
        let (policy,unsupported)=match super::schema::bind_rule(catalog,info,&rule) {
            Ok(rule)=>(Some(rule),None),Err(error)=>match temporal::bind(catalog,info,&decl.value) {
                Some(rule) if decl.target=="read" => (Some(rule),None),
                _ => (None,Some(format!("policy outside rule proof fragment: {} ({})",error.message,error.code))),
            },
        };
        let requirements=named_operation.as_ref().map(|(_,p)| operation::requirements(catalog,info,p)).unwrap_or_default();
        out.push(Invariant{operation:named_operation.map(|(name,_)|name),requirements,syntax:Some(decl.value.clone()),table:decl.table.clone(),target:decl.target.clone(),column:decl.column.clone(),predicate:crate::print::expression(&decl.value),site:decl.site.clone(),policy,unsupported});
    }
    out
}
#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all="lowercase")]
pub enum Status { Proved, Refuted, Unproved }
#[derive(Clone, Debug, Serialize)]
pub struct Verdict {
    pub invariant: Invariant,
    pub status: Status,
    pub direct_rule: Status,
    pub paths: Vec<String>,
    pub reasons: Vec<String>,
    pub counterexample: Option<challenges::Counterexample>,
    pub obligations: Vec<Obligation>,
}
#[derive(Clone, Debug, Serialize)]
pub struct Report {
    pub format: u32,
    pub scope: String,
    pub exclusions: Vec<String>,
    pub invariants: Vec<Verdict>,
    pub exposures: Vec<Exposure>,
    pub roles: BTreeMap<String,Vec<String>>,
    pub notes: Vec<Diagnostic>,
    pub uncovered: Vec<UncoveredExposure>,
    pub campaign_coverage: BTreeSet<String>,
}
impl Report {
    pub fn refuted(&self)->bool {self.invariants.iter().any(|v|v.status==Status::Refuted&&v.counterexample.as_ref().is_some_and(|c|c.reachability.is_reachable()))}
    pub fn text(&self)->String {self.text_with_all(false)}
    pub fn text_with_all(&self,all:bool)->String {
        let mut out=self.action_text(if all {usize::MAX} else {5});

codex
The branch and loop writes are covered by `ir::write_tables`. I found a separate concern: the retained-policy shortcut uses raw rule equality, bypassing the probe-index comparison used by containment. I’m checking whether a changed key can pass that shortcut.
exec
/bin/bash -lc "nl -ba snapback4/crates/snapback4-lang/src/release_bridge.rs | sed -n '429,528p'; rg -n 'fn quarry|Self::Exists|RuleExpr::Exists' snapback4/crates/snapback4-core/src/schema/rule* | head -50; sed -n '140,195p' snapback4/crates/snapback4-lang/src/guide/deploy.md" in /home/ccheever/projects/sb4-b27-rel
 succeeded in 0ms:
   429	pub fn exact_write_authority(target:&[(String,String)],current:&[(String,String)])->Result<(),String>{
   430	    use snapback4_core::schema::RuleExpr;
   431	    let old=crate::compile(target);let next=crate::compile(current);
   432	    if next.schema.tables.values().all(|t|t.column_writes.is_empty()&&t.frozen_columns.is_empty()){return Ok(());}
   433	    let aliases=next.schema.table_renames.iter().filter(|(_,prior)|old.schema.tables.contains_key(*prior)).map(|(new,prior)|(new.clone(),prior.clone())).chain(old.schema.table_renames.iter().filter(|(new,prior)|!next.schema.tables.contains_key(*new)&&next.schema.tables.contains_key(*prior)).map(|(new,prior)|(prior.clone(),new.clone()))).collect();
   434	    let aligned=align_current_schema(&old.schema,target,&next.schema,current,&aliases)?;
   435	    fn implies(rule:&RuleExpr,policy:&RuleExpr,policies:&PolicyComparison<'_>)->bool{
   436	        policies.rule(rule,policy) || *rule==RuleExpr::Deny || *policy==RuleExpr::Allow
   437	            || matches!(rule,RuleExpr::And(xs) if xs.iter().any(|r|implies(r,policy,policies)))
   438	            || matches!(rule,RuleExpr::Or(xs) if xs.iter().all(|r|implies(r,policy,policies)))
   439	            || matches!(policy,RuleExpr::Or(xs) if xs.iter().any(|p|implies(rule,p,policies)))
   440	            || matches!(policy,RuleExpr::And(xs) if xs.iter().all(|p|implies(rule,p,policies)))
   441	    }
   442	    fn writes_column(value:&serde_json::Value,table:&str,column:&str,effect:&str,defaulted:bool)->bool {
   443	        match value {
   444	            serde_json::Value::Object(fields)=>{
   445	                if fields.contains_key("Literal"){return false;}
   446	                for(kind,body)in fields {
   447	                    let write_effect=match kind.as_str(){"Insert"|"InsertIfAbsent"=>"insert","Update"=>"update","Upsert"=>"upsert","WriteTarget"=>if body["upsert"]==true{"upsert"}else{"update"},_=>""};
   448	                    let target=body["table"].as_str().or_else(||body["target"]["table"].as_str());
   449	                    if write_effect==effect&&target==Some(table){
   450	                        let patch=body.get("patch").or_else(||body.get("row"));
   451	                        let object=patch.and_then(|p|p.get("Object")).and_then(serde_json::Value::as_object);
   452	                        if object.is_none_or(|o|o.contains_key(column)) || effect!="update"&&defaulted {return true;}
   453	                    }
   454	                    if writes_column(body,table,column,effect,defaulted){return true;}
   455	                }false
   456	            },
   457	            serde_json::Value::Array(xs)=>xs.iter().any(|x|writes_column(x,table,column,effect,defaulted)),
   458	            _=>false,
   459	        }
   460	    }
   461	    fn leading_guard(target:&[(String,String)],aligned:&snapback4_core::Schema,table:&str,operation:&str,policy:&RuleExpr)->bool {
   462	        let mut sources=target.to_vec();
   463	        let Some((_,source))=sources.first_mut()else{return false};
   464	        source.push_str(&format!("\ninvariant {table}.{operation} only {}\n",policy.quarry()));
   465	        let proof=crate::compile(&sources);if !proof.diagnostics.is_empty(){return false;}
   466	        let comparison=PolicyComparison::new(&proof.schema,aligned);
   467	        // @ref LLP 3000.000.000#21-day-two-release-semantics-rel — finite control flow preserves a stable leading guard; scope changes do not.
   468	        fn stable(rule:&RuleExpr)->bool {
   469	            use snapback4_core::schema::RuleTerm;
   470	            match rule {
   471	                RuleExpr::Exists{key,equalities,..}=>key.iter().chain(equalities.iter().map(|(_,t)|t)).all(|t|matches!(t,RuleTerm::Viewer|RuleTerm::Literal(_))),
   472	                RuleExpr::And(xs)|RuleExpr::Or(xs)=>xs.iter().all(stable),
   473	                RuleExpr::Eq(a,b)|RuleExpr::Ne(a,b)=>[a,b].iter().all(|t|matches!(t,RuleTerm::Viewer|RuleTerm::Literal(_))),
   474	                RuleExpr::Allow|RuleExpr::Deny=>true,_=>false,
   475	            }
   476	        }
   477	        fn opaque(value:&serde_json::Value)->bool {match value {
   478	            serde_json::Value::Object(m) if m.contains_key("Literal")=>false,
   479	            serde_json::Value::Object(m)=>m.keys().any(|k|matches!(k.as_str(),"JobAs"|"JobQuery"|"Emit"))||m.values().any(opaque),
   480	            serde_json::Value::String(s)=>matches!(s.as_str(),"JobAs"|"JobQuery"),
   481	            serde_json::Value::Array(xs)=>xs.iter().any(opaque),_=>false,
   482	        }}
   483	        let Some(program)=proof.programs.iter().find(|p|p.program.name==operation) else{return false};
   484	        if opaque(&serde_json::to_value(&program.program).unwrap()) {return false;}
   485	        // Unknown implicit writes cannot establish dependency stability.
   486	        if proof.schema.tables.values().any(|t|!t.maintained.is_empty()||!t.sequences.is_empty()||t.on_delete.values().any(|a|a.writes()))||!proof.schema.maintains.is_empty(){return false;}
   487	        let writes=snapback4_core::ir::write_tables(&program.program);
   488	        proof.invariants.iter().any(|inv|inv.table==table&&inv.operation.as_deref()==Some(operation)
   489	            &&inv.policy.as_ref().is_some_and(|compiled|comparison.rule(compiled,policy))
   490	            &&inv.requirements.iter().any(|require|stable(require)&&implies(require,policy,&comparison)
   491	                &&crate::security::kernel::dependencies(require).iter().all(|dependency|!writes.iter().any(|(t,_)|t==dependency))))
   492	    }
   493	    let policies=PolicyComparison::new(&old.schema,&aligned);
   494	    for(name,current)in &aligned.tables {
   495	        let Some(prior)=old.schema.table(name)else{continue};
   496	        for (column,policy) in &current.column_writes {
   497	            if !prior.columns.contains_key(column){continue;}
   498	            for program in &old.programs {
   499	                let writes=snapback4_core::ir::write_tables(&program.program);
   500	                for(_,effect)in writes.iter().filter(|(t,e)|t==name&&*e!="delete") {
   501	                    let defaulted=prior.defaults.get(column).is_some_and(|d|!matches!(d,snapback4_core::schema::ColumnDefault::Literal(snapback4_core::Value::Null)));
   502	                    if !writes_column(&serde_json::to_value(&program.program).unwrap(),name,column,effect,defaulted){continue;}
   503	                    let safe=prior.column_writes.get(column)==Some(policy) || match *effect {"insert"=>implies(&prior.rules.insert,policy,&policies),"update"=>!prior.update_transition&&implies(&prior.rules.update,policy,&policies),"upsert"=>!prior.update_transition&&implies(&prior.rules.insert,policy,&policies)&&implies(&prior.rules.update,policy,&policies),_=>false};
   504	                    if !safe && !leading_guard(target,&aligned,name,&program.program.name,policy) {return Err(format!("{}: exact source operation {} can write {name}.{column} without current rule `write <- {}`; retain this audience in a guarded bridge before selecting the source",program.site,program.program.name,policy.quarry()));}
   505	                }
   506	            }
   507	        }
   508	        for(column,condition)in &current.frozen_columns {
   509	            if prior.columns.contains_key(column)&&prior.frozen_columns.get(column)!=Some(condition)&&*condition!=RuleExpr::Deny&&!prior.constraints.iter().any(|c|matches!(c,snapback4_core::schema::Constraint::Immutable{fields}if fields.contains(column)))&&old.programs.iter().any(|p|snapback4_core::ir::write_tables(&p.program).iter().any(|(t,e)|t==name&&*e!="delete"&&writes_column(&serde_json::to_value(&p.program).unwrap(),name,column,e,false))) {
   510	                return Err(format!("{name}.{column}: exact source omits current rule `immutable when {}`; retain the freeze in an authored bridge before selecting source",condition.quarry()));
   511	            }
   512	        }
   513	    }
   514	    Ok(())
   515	}
rg: snapback4/crates/snapback4-core/src/schema/rule*: IO error for operation on snapback4/crates/snapback4-core/src/schema/rule*: No such file or directory (os error 2)
export SNAPBACK4_SERVICE_TOKEN=$(bunx snapback4 token --service ops --release ./deployment)
bunx snapback4 run reconcile --release ./deployment --json
unset SNAPBACK4_SERVICE_TOKEN
```
`--token-env NAME` reads another environment variable. The command uses served source, so it also works outside the app directory. A lost reply is ambiguous; inspect the queue before retrying. Starter/client recipes: `guide client`.

Real-account production and its durable role/restart/rollback proof: `guide production`.

## Inspection, proxies and TLS (SQLite)

`data TABLE --release ./deployment --json` returns `{rows, more, limit}`. The default limit is 50; `more:true` means the snapshot was truncated. Increase `--limit N` to inspect more; `--limit 0` returns no rows and reports whether any exist. Non-JSON output remains one row per line. `snapback4 sql 'SELECT id, archived FROM notes' --release ./deployment --json` returns positional rows under `columns`; `--json-objects` returns object rows with direct booleans and schema-proven media columns decoded to ordinary wire JSON. Positional `--json` retains tagged media text. Schema-qualified relations, recursive or shadowing/forward-reference CTEs need positional --json. A truncated JSON query reports its repair on stderr without corrupting stdout. Default `sql`, `data` and `releases` output also reports a nonzero dormant-row count on stderr; a missing active table names its retained rows and the concrete dormant query. `sql --dormant --release ./deployment` shows retained rows/cells, including removed tables; `sql --all-releases --release ./deployment` adds active images. `_snapback_state`, `_snapback_source` and `_snapback_columns` identify provenance and provided cells; these are retained images, not historical snapshots. Both modes are read-only; internal tables remain unavailable. Inspection bypasses read rules and can show expired stored rows; it is an operator tool, not an app query surface. Bind loopback behind a TLS proxy. Forward Authorization and preserve response bodies; allow long polls without buffering or early timeouts. Non-loopback HTTP requires `--i-understand-cleartext` and a trusted private hop behind TLS. Identity rate keys use the socket peer, not forwarded headers. Serve refuses personas and dev doors even through a local proxy; see SERVER.md for capacity. `--json-objects` returns `{header, columns, rows, limit, more, ruleFiltered:false}` with object `rows`; `--json` uses positional `rows`. Put flags outside the quoted SQL. N_NO_PRODUCTION_WRITER means no production insert path can bootstrap this table. It groups root blockers with their dependents; persona-only schemas get one identity note. Add a service-seat insert mutation and provision real account relationships. E_UPGRADE means installation or post-upgrade check failed. Repair the package-manager or registry error and rerun upgrade. Packages may already be pinned: if check failed, repair the reported schema/device refusal and rerun check.

## Capture a saved version (SQLite)
After check and business cases pass, from the app root:
```sh
snapback4 deploy ./deployment --save-version versions/v1
snapback4 rollback ./deployment --to 1 --check --bridge ./bridge
snapback4 deploy ./deployment --schema ./bridge --restore-dormant --check
```
The new versions/v1 captures selected modules, their contemporary fixtures, an importable `versions/v1/generated/api.ts` plus its package marker, and `versions/v1/release.json` with the actual immutable release id, source hash and CLI version. An unchanged deploy keeps its id and may refresh those derived generated/label artifacts only when the saved directory's complete Quarry source set and bytes exactly match the selected source; source and fixture evidence stay intact, and differing source refuses. Choose a new positive-numbered versions/vN for changed source; saving cannot combine with --check. Saved-source deploy uses its own fixtures and emits the saved source's API rather than the working tree's API. Use the recorded id when choosing a baseline; since_release remains the author-supplied newer-schema label. The bridge starts from complete target Quarry operations with compatible value domains loosened to include current data, retaining new tables with their current rules, plus this app's `bridge/ROLLBACK-CHECKLIST.md`. Retain current domains, audiences, guards and quotas; repair records through authorized mutations; prove blocked cases refuse and affected lists/counts remain correct; repeat the old-source preview. No bridge is activated or business migration synthesized. JSON includes checklist; --verbose retains full evidence/index paths. Dormant rows reserve ids but no unique slots: new active rows may block restoration. A widened non-unique bridge permits repair before reinstating uniqueness; retained storage cannot supply absent safety logic.

Hot deploy and rollback require the running `serve` host to support this CLI's activation protocol, including `--exact` selection of original source. If `E_RELEASE_RUNTIME` says the host predates release custody, restart `serve` with this CLI and repeat the command; the mixed-version request refuses before activation.

## Keep v1 clients working (SQLite)

`deploy --check --json` reports `clientCompatibility` separately from data adoption: missing operations, changed kinds, required new arguments, removed or narrowed inputs, result shape/value changes and changed refusal codes/messages. Deploy prints the same warnings. Input breaks name the old release and the E_INPUT/E_OP outcome. A result or behavior review asks you to verify the intended contract; a correct new privacy denial is intentional behavior, not an input shape failure. The comparison is conservative, not a proof of unchanged logic. For example, save this v1 source and its callers sending `{name:"Ada",obsolete:"old input"}` to `greet`:

```quarry
use identity guests
query greet(name: text <=40, obsolete: text <=40):
  return {message: name + '!'}
```
Deploy this v2 source. The unchanged v1 call still returns `{message:"Ada!"}`; new callers can use `greeting` and omit `suffix` and `obsolete`:

```quarry
use identity guests
query greeting(displayName: text <=40 alias name, suffix: text <=1 default '!', obsolete: text <=40 deprecated):
  return {message: displayName + suffix}
alias greet = greeting
```
`alias name` maps the old argument to `displayName`; supply either spelling, never both. Use the alias for renames; `deprecated` deliberately discards its value. A literal default handles omitted or null arguments and must fit the declared scalar type; explicit non-null input still validates. `deprecated` accepts a validated optional argument but forbids referring to it in the body. Unknown arguments still refuse. These modifiers apply to non-native Quarry queries and mutations; helpers, actions and jobs keep their distinct invocation contracts. Aliases target an authored query/mutation in the same module, carry the same rules/guards/results, and cannot chain. Retain the old endpoint until its callers have retired; preserve the old result projection and handle intended denials.

Deploy registers a compiled visible view for widened domains and relaxed unique keys, or refuses unsupported adaptation. It also reports remaining reverse-projection risks: dropping a required old column or widening a value domain can strand newly written rows. The preflight separately attempts exact reverse adoption on its post-deploy snapshot, naming present-data failures. Keep old fields and compatible domains in an expand/contract bridge; after writes run the named `rollback <deployment> --to N --check --bridge <new-dir>` before selecting N. A green snapshot never freezes later writes.

## Persistent production: SQLite v1 → v2 → rollback → forward

Replacement transforms read reversible preimages; input types cover original/native rows. `down table name(typedInputs): {oldField: expression}` declares a reversible old view for newer rows; exact old preimages win, conflicting projected-cell edits refuse forward. Native preimages and old-view outputs must be authoritative scalars; use separate scalar columns instead of replacing a reference, asset, collection or lifetime field. Reference inputs retain their parent lifetimes across older views; deleted/reused parents refuse forward. Unrepresentable values stay dormant. `newField: Type renamed from oldField` carries a scalar cell both ways; asset columns and asset lists move their actual cell and single home together. Reference renames require identical target/type and preserve their reference lifetime; the selected release supplies its on-delete policy and retain lifetime evidence; engine-owned moves refuse before activation; keep old operation/result wrappers where clients need them.

A table declares `table observations renamed from behaviors:` to preserve its row/reference identity and old-release writes; it refuses merging independent table histories. Ordinary backfill expressions may read indexed cross-table `exists` or unique points against one pre-patch snapshot. The language-card example uses migration-only `fileText(file)` with `nonemptyLines(text)` for repeated nonempty UTF-8 entries; unavailable bytes, invalid UTF-8 or a job-meter cut refuse atomically. It never supplies ordinary mutation-time file validation. Active writes refresh accepted backfill inputs; older-release edits still need recomputation agreement or conflict repair. An absent optional rename destination is not a conflict.

Computed `down` cannot replace files/images, asset lists, references or a missing table. Required → optional media, an album becoming empty, or nullable money needs a generated loosened-target bridge when no truthful scalar substitution exists. Review target operations reading loosened columns and nullable UI assumptions. Keep current safety guards absent from the target; retaining new tables does not make them visible through frozen old operations. Automatic registered views handle compatible widenings. For an authored bridge, deploy it as a new release with `--restore-dormant`, first with `--check`.

Save this script and run it with Node. `PRODUCTION_DIR` selects its persistent store; reruns preserve rows/users. It proves backfill, privacy and rollback/forward behavior. This example widens the stored weight domain, so deploy registers a view. Default rollback preserves current privacy through that view; `--exact` deliberately restores v1's broader reads after an explicit review. REL5 owns reactivation/old-client reporting; SEC3 owns privacy/audit.

```js
// day-two-production.mjs — this exact fence runs against the packed package.

exec
/bin/bash -lc "rg -n 'Expr::Object|Expr::Write|Expr::Exists|Stmt::Require' snapback4/crates/snapback4-lang/src/bind/expr* snapback4/crates/snapback4-lang/src/bind/program* snapback4/crates/snapback4-lang/src/bind/schema* | head -90; rg -n 'kind.*Word|identifier|expect_name' snapback4/crates/snapback4-lang/src/parser/expr* | head -50; rg -n 'invariant|module' snapback4/crates/snapback4-lang/src/parser/in*" in /home/ccheever/projects/sb4-b27-rel
 exited 2 in 0ms:
rg: snapback4/crates/snapback4-lang/src/bind/expr*: No such file or directory (os error 2)
snapback4/crates/snapback4-lang/src/bind/program.rs:1069:                        if let (Expr::Object(nested_fields) | Expr::Shape { fields: nested_fields, .. }, Ty::Object(nested_types) | Ty::RowShape(nested_types) | Ty::RowObject(nested_types)) = (nested, nested_ty) {
snapback4/crates/snapback4-lang/src/bind/program.rs:1096:            } else { Ok((Expr::Object(fields), Ty::Object(types))) }
snapback4/crates/snapback4-lang/src/bind/program.rs:1316:                Ok((Expr::Object(exprs.into_iter().collect()), Ty::Object(types)))
snapback4/crates/snapback4-lang/src/bind/program.rs:1365:        Ok((Expr::Object(exprs.into_iter().collect()), self.write_result_type(info)))
snapback4/crates/snapback4-lang/src/bind/schema.rs:237:        let Expr::Exists { read, .. } = value else { continue };
snapback4/crates/snapback4-lang/src/bind/schema.rs:487:            RuleExpr::Exists { .. } => infer_audience(catalog, info, sync, disjunct, rule, source, named)?,
snapback4/crates/snapback4-lang/src/bind/schema.rs:514:        RuleExpr::Exists { table, index, key, equalities, .. } if equalities.is_empty() && key.last() == Some(&RuleTerm::Viewer) => {
snapback4/crates/snapback4-lang/src/bind/schema.rs:544:            RuleExpr::Exists { key, equalities, .. } | RuleExpr::Created { key, equalities, .. } => key.iter().chain(equalities.iter().map(|(_, t)| t)).any(term),
snapback4/crates/snapback4-lang/src/bind/schema.rs:549:        RuleExpr::Exists { key, equalities, .. } => equalities.is_empty() && key.last() == Some(&RuleTerm::Viewer)
snapback4/crates/snapback4-lang/src/bind/schema.rs:811:        Expr::Exists { read, site } => {
snapback4/crates/snapback4-lang/src/bind/schema.rs:813:            Ok(RuleExpr::Exists { table, index, key, equalities, provenance: KeyProvenance::Shape })
snapback4/crates/snapback4-lang/src/bind/schema.rs:899:        if error.code == "E_QUARRY_RULE_HOP" { error.rewrite = reference::reference_rewrite(catalog, info, &Expr::Exists { read: read.clone(), site: site.clone() }); }
snapback4/crates/snapback4-lang/src/bind/program/returned_shapes.rs:65:                Stmt::Return(value) | Stmt::Require { condition: value, .. }
snapback4/crates/snapback4-lang/src/bind/program/returned_shapes.rs:101:            Expr::Object(fields) => { for field in fields.values() { self.expr(field); } }
snapback4/crates/snapback4-lang/src/bind/program/returned_shapes.rs:105:            Expr::Get(read) | Expr::Exists(read) => self.read(read),
snapback4/crates/snapback4-lang/src/bind/program/job_reads.rs:94:            Ok((Expr::Builtin { builtin: Builtin::JobQuery { program: Box::new(query.program), cursor, all }, args: vec![Expr::Object(fields)] }, ty))
snapback4/crates/snapback4-lang/src/bind/program/objects.rs:40:        } else { Ok((Expr::Object(values), Ty::Object(types))) }
snapback4/crates/snapback4-lang/src/bind/program/objects.rs:64:        match failed { Some(error) => Err(error), None => Ok((Expr::Object(exprs.into_iter().collect()), Ty::Object(types))) }
snapback4/crates/snapback4-lang/src/bind/program/objects.rs:177:    Some(Expr::Object(BTreeMap::from([("pending".into(), pending)])))
snapback4/crates/snapback4-lang/src/bind/program/constraints.rs:149:        ir::Stmt::Require { condition: Expr::Binary { op, left, right }, code, .. } if counts(left) => {
snapback4/crates/snapback4-lang/src/bind/program/constraints.rs:172:        ir::Stmt::Require { condition: Expr::Unary { op: ir::UnaryOp::Not, value }, code, .. } if reads(value, site) => Some(code.clone()),
snapback4/crates/snapback4-lang/src/bind/program/immutable.rs:9:        let Expr::Object(patch) = patch else { return Ok(()) };
snapback4/crates/snapback4-lang/src/bind/program/immutable.rs:155:        Stmt::Require { condition, .. } => value(condition),
snapback4/crates/snapback4-lang/src/bind/program/immutable.rs:175:        Expr::Object(fields) => fields.values().all(child),
snapback4/crates/snapback4-lang/src/bind/program/immutable.rs:180:        Expr::Get(read) | Expr::Exists(read) => read.key.iter().all(child),
snapback4/crates/snapback4-lang/src/bind/program/immutable.rs:189:        Expr::Object(fields) => transparent_expr(expr,32).then_some((fields, prior)),
snapback4/crates/snapback4-lang/src/bind/program/immutable.rs:253:        Expr::Object(fields) => Expr::Object(fields.iter().map(|(name,value)|Some((name.clone(),scalar(value,prior,fuel-1,stable)?))).collect::<Option<_>>()?),
snapback4/crates/snapback4-lang/src/bind/program/immutable.rs:285:        Expr::Object(fields) => Expr::Object(fields.iter().map(|(name,value)|Some((name.clone(),resolve(value,prior,fuel-1,stable)?))).collect::<Option<_>>()?),
snapback4/crates/snapback4-lang/src/bind/program/flow.rs:30:            Stmt::Require { condition: Expr::Literal(Value::Bool(false)), .. } => RETURNS,
snapback4/crates/snapback4-lang/src/bind/program/flow.rs:31:            Stmt::Require { .. } => FALLS_THROUGH | RETURNS,
snapback4/crates/snapback4-lang/src/bind/program/flow.rs:55:        Stmt::Require { condition: Expr::Literal(Value::Bool(false)), code: "STOP".into(), site: None, message: None }
snapback4/crates/snapback4-lang/src/bind/program/pure_calls.rs:101:        Expr::Get(_) | Expr::Exists(_) | Expr::Scan(_) | Expr::Merge(_) => false,
snapback4/crates/snapback4-lang/src/bind/program/pure_calls.rs:104:        Expr::Object(fields) => fields.values().all(expression),
snapback4/crates/snapback4-lang/src/bind/program/pure_calls.rs:131:        Stmt::Require { condition, .. } => expression(condition),
snapback4/crates/snapback4-lang/src/bind/program/point_facts.rs:199:        RuleExpr::Exists { table, .. } | RuleExpr::Created { table, .. } => table == target,
snapback4/crates/snapback4-lang/src/bind/program/point_facts.rs:209:        RuleExpr::Exists { table, .. } | RuleExpr::Created { table, .. } => schema.table(table)
snapback4/crates/snapback4-lang/src/bind/program/control.rs:165:                out.push(Stmt::Require { condition: expr, code: code.clone(), site: Some(site.to_string()), message: message.clone() });
snapback4/crates/snapback4-lang/src/bind/program/expr.rs:254:                out.push(Stmt::Require { condition: Expr::Binary { op: BinaryOp::Ne, left: Box::new(ir::var(&tmp)), right: Box::new(Expr::Literal(Value::Null)) }, code: code.clone(), site: Some(site.to_string()), message: message.clone() });
snapback4/crates/snapback4-lang/src/bind/program/expr.rs:1048:        Expr::Object(fields) => fields.values().any(allocates),
snapback4/crates/snapback4-lang/src/bind/program/reads.rs:67:        if equalities.is_empty() { return Ok(if mode == ReadMode::Exists { Expr::Exists(point) } else { Expr::Get(point) }); }
99:        if token.value == "-" && !(self.peek_at(1).kind == Kind::Word && self.peek_at(2).value == "[") {
128:        if (token.value == "+" && (self.peek_at(1).kind == Kind::Word || self.peek_at(1).value == "~")) || token.value == "~" || (token.value == "-" && self.peek_at(1).kind == Kind::Word && self.peek_at(2).value == "[") {
151:                } else if self.peek().kind == Kind::Word && self.peek().site.line == token.site.line && self.peek().site.col == token.site.col + token.value.len() as u32 {
176:                if self.at_kind(Kind::Word) {
264:                && self.at_kind(Kind::Word)
297:            } else if self.at(".") && self.peek_at(1).kind == Kind::Word {
358:            } else if self.at_kind(Kind::Word) && !stops.contains(&"<probe-shape>") && precedence(&self.peek().value).is_none() && !stops.contains(&self.peek().value.as_str()) && !matches!(self.peek().value.as_str(), "else" | "for" | "in" | "if" | "absent") {
381:            if self.at_kind(Kind::Word) {
382:                while self.peek_at(end).value == "." && self.peek_at(end + 1).kind == Kind::Word { end += 2; }
384:            if self.at_kind(Kind::Word) && self.peek_at(end).value == "!=" {
389:            if self.at_kind(Kind::Word) && self.peek_at(end).value == "=" {
393:            if column.is_none() && self.at_kind(Kind::Word) && matches!(self.peek_at(end).value.as_str(), ">" | ">=" | "<" | "<=") {
482:                            } else if next.kind == Kind::Word && matches!(self.peek_at(2).value.as_str(), ":" | "," | "}") {
484:                            } else if next.kind == Kind::Word {
rg: snapback4/crates/snapback4-lang/src/parser/in*: IO error for operation on snapback4/crates/snapback4-lang/src/parser/in*: No such file or directory (os error 2)

exec
/bin/bash -lc "rg -n 'fn bind_rule|Expr::Exists' snapback4/crates/snapback4-lang/src/bind/schema/rules*; git status --short; rg -n 'literal.*Object|Expr::Object\\(|Expr::Block' snapback4/crates/snapback4-lang/src/bind/expr.rs | head -40" in /home/ccheever/projects/sb4-b27-rel
 succeeded in 135ms:
rg: snapback4/crates/snapback4-lang/src/bind/schema/rules*: IO error for operation on snapback4/crates/snapback4-lang/src/bind/schema/rules*: No such file or directory (os error 2)
 M llp/3000.000.000-retained-storage-and-hot-release.rfc.md
 M snapback4/crates/snapback4-lang/src/release_bridge.rs
 M snapback4/crates/snapback4-lang/tests/release_bridge_security.rs
 M snapback4/crates/snapback4/src/verbs/saved_version.rs
 M snapback4/crates/snapback4/tests/roll_views.rs
?? llp/reviews/rel-wave27/r5-brief.md
?? llp/reviews/rel-wave27/r5-codex.md
?? llp/reviews/rel-wave27/r5-muse.md
rg: snapback4/crates/snapback4-lang/src/bind/expr.rs: IO error for operation on snapback4/crates/snapback4-lang/src/bind/expr.rs: No such file or directory (os error 2)

exec
/bin/bash -lc "rg -n 'fn invariant|InvariantDecl|at\\(\"invariant\"' snapback4/crates/snapback4-lang/src/parser* -g '*.rs'; sed -n '770,830p' snapback4/crates/snapback4-lang/src/bind/schema.rs; sed -n '110,175p' snapback4/crates/snapback4-lang/src/bind/program/control.rs; sed -n '120,210p' snapback4/crates/snapback4-lang/src/bind/program/expr.rs; sed -n '1,80p' snapback4/crates/snapback4-lang/src/bind/program/objects.rs; rg -n 'fn write|ast::Expr::Write|A::Write' snapback4/crates/snapback4-lang/src/bind/program/expr.rs snapback4/crates/snapback4-lang/src/bind/program.rs" in /home/ccheever/projects/sb4-b27-rel
 succeeded in 0ms:
snapback4/crates/snapback4-lang/src/parser/security.rs:18:        self.document.invariants.push(InvariantDecl { table, target, column, value, site });
                            else if both_columns && scalar(&lt) && scalar(&rt) { format!("columns ordered against each other need one type ({} and {} differ); compare each with an integer literal, or check it in the mutation with require", lt.name(), rt.name()) }
                            else { format!("an insert rule orders int, time, decimal and money columns; check this {} comparison in the mutation with require", if scalar(&lt) { rt.name() } else { lt.name() }) };
                        return Err(type_error(site, format!("an insert-rule ordered comparison joins {} with {}{}", lt.name(), rt.name(), if optional { "; an optional column may be null, which is not ordered" } else { "" }), help));
                    }
                } else if ordered {
                    // A named transition orders int, time, decimal and money images; an
                    // integer literal beside decimal or money is minor units, as in an
                    // insert rule (the engine compares the stored integers).
                    // @ref LLP 3000.036#13.6 — wave 3 I4: one ordering rule for insert rules and named updates.
                    let scalar = |ty: &Ty| matches!(ty.required(), Ty::Int | Ty::Time | Ty::Decimal(_) | Ty::Money(..));
                    let literal = |term: &RuleTerm| matches!(term, RuleTerm::Literal(Value::Int(_)));
                    // A private (`written by`) decimal or money input stays refused: the disclosure
                    // suite verifies ordered private transitions at runtime for int and time only.
                    let private = |term: &RuleTerm| matches!(term, RuleTerm::OldField(f) | RuleTerm::NextField(f)
                        if info.decl.columns.iter().any(|c| &c.name == f && c.written_by.is_some() && !c.readable_by_audience));
                    let units = |ty: &Ty| matches!(ty.required(), Ty::Decimal(_) | Ty::Money(..));
                    if (units(&lt) || units(&rt)) && (private(&l) || private(&r)) {
                        return Err(type_error(site, format!("ordered transition terms over a private decimal or money field are not evaluated in rules; got {} and {}", lt.name(), rt.name()),
                            super::rule_operator::transition_require(&info.decl.name, expr)));
                    }
                    if !scalar(&lt) || !scalar(&rt) || (lt.required() != rt.required() && !literal(&l) && !literal(&r)) {
                        // Never a rewrite that changes the policy: the same comparison, in the mutation.
                        return Err(type_error(site, format!("ordered transition terms need one int, time, decimal or money type (or an integer literal); got {} and {}", lt.name(), rt.name()),
                            super::rule_operator::transition_require(&info.decl.name, expr)));
                    }
                }
                Ok(match op.as_str() { "=" => RuleExpr::Eq(l,r), "!=" => RuleExpr::Ne(l,r),
                    ">=" => RuleExpr::Compare(snapback4_core::ir::BinaryOp::Gte,l,r), ">" => RuleExpr::Compare(snapback4_core::ir::BinaryOp::Gt,l,r),
                    "<=" => RuleExpr::Compare(snapback4_core::ir::BinaryOp::Lte,l,r), _ => RuleExpr::Compare(snapback4_core::ir::BinaryOp::Lt,l,r) })
            }
            other => {
                let effect = super::rule_operator::effect_word(bindings.insert, bindings.update, !bindings.hops);
                Err(super::rule_operator::diagnostic(site, &info.decl.name, effect, bindings.update && bindings.old.is_some(), expr, &format!("the operator `{other}`")))
            }
        },
        Expr::Unary { op, value, .. } if op == "not" => Ok(RuleExpr::Not(Box::new(rule_expr(catalog, info, value, bindings)?))),
        Expr::Member { .. } => {
            let (term, ty) = rule_term(catalog,info,expr,bindings)?;
            if ty != Ty::Bool { return Err(type_error(site,"a bare rule field must be bool","compare this field with a value of its declared type")); }
            Ok(RuleExpr::Eq(term,RuleTerm::Literal(Value::Bool(true))))
        }
        Expr::Exists { read, site } => {
            let (table, index, key, equalities) = probe(catalog, info, read, site, bindings, true).map_err(|error| super::bracket_ranges::refusal(read, true, error))?;
            Ok(RuleExpr::Exists { table, index, key, equalities, provenance: KeyProvenance::Shape })
        }
        Expr::Created { read, site } => {
            if !bindings.insert {
                return Err(unknown(site, "created is valid only in an insert rule", "use exists in read, update and delete rules"));
            }
            let (table, index, key, equalities) = probe(catalog, info, read, site, bindings, true)?;
            Ok(RuleExpr::Created { table, index, key, equalities, provenance: KeyProvenance::Shape })
        }
        Expr::Literal { value: Literal::Bool(b), .. } => Ok(if *b { RuleExpr::Allow } else { RuleExpr::Deny }),
        Expr::Call { .. } => {
            let effect = super::rule_operator::effect_word(bindings.insert, bindings.update, !bindings.hops);
            Err(super::rule_operator::diagnostic(site, &info.decl.name, effect, bindings.update && bindings.old.is_some(), expr, "a helper or function call"))
        }
        other => Err(unknown(site, format!("`{}` is not a rule", crate::print::expression(other)), "read <- exists memberships[.conversationId, viewer]")),
    }
}

                    if !ty.assignable_to(&joined) || !item.assignable_to(&joined) {
                        return Err(self.assignment_type_error(type_error(site, format!("{name} holds {}; cannot append {}", item.name(), ty.name()), "append an item of the list's type"), name, value, site));
                    }
                    // @ref LLP 3000.007#5.1 — append in place; the heap meter is the accumulated list's bound.
                    binding.ty = Ty::List(Box::new(joined), u32::MAX);
                    binding.origins = origins;
                    binding.declared = binding.ty.clone();
                    binding.fields.clear();
                    binding.error = None;
                    binding.revision += 1;
                    out.push(Stmt::Push { target: binding.runtime.clone(), value: element });
                    self.scopes.last_mut().expect("a scope").insert(name.clone(), binding);
                    return Ok(());
                }
                let (expr, ty) = self.value_of(value, out)?;
                if matches!(value, A::Write { op: WriteOp::Delete, .. }) {
                    return Err(unknown(site, "delete does not yield a value; return a confirmation value after the write", "delete the row, then `return null`"));
                }
                let count_capture = self.count_capture(name, value);
                // @ref LLP 3000.007#5.1 — rebinding preserves the local slot and resets its flow refinement.
                if let Some(mut binding) = self.binding(name).cloned() {
                    let mut origins = binding.origins.clone();
                    origins.push((ty.clone(), value.clone()));
                    let joined = binding.declared.join(&ty).map_err(|error| self.assignment_type_error(self.assignment_join_error(error, name, &origins), name, value, site))?;
                    if ty != Ty::Null && binding.declared != Ty::Null && !ty.value_compatible(&binding.declared) {
                        return Err(self.assignment_type_error(type_error(site, format!("{name} is {}; cannot rebind it to {}", binding.declared.name(), ty.name()), "use a different local for a different type"), name, value, site));
                    }
                    binding.declared = if self.loops > 0 { joined.rebound() } else { joined };
                    binding.ty = if self.loops > 0 { ty.rebound() } else { ty };
                    binding.origins = origins;
                    binding.fields.clear();
                    binding.error = None;
                    binding.revision += 1;
                    out.push(Stmt::Assign { name: binding.runtime.clone(), value: expr });
                    self.scopes.last_mut().expect("a scope").insert(name.clone(), binding);
                } else {
                    let runtime = self.declare(name, ty.clone());
                    self.maintenance_local(&runtime, site, name);
                    self.scopes.last_mut().unwrap().get_mut(name).unwrap().origins.push((ty, value.clone()));
                    out.push(Stmt::Let { name: runtime, value: expr });
                }
                if matches!(value, A::Assert { value, .. } if matches!(value.as_ref(), A::Read(_))) {
                    self.scopes.last_mut().unwrap().get_mut(name).unwrap().fields
                        .insert(vec!["$sourceSnapshot".into()], Ty::Bool);
                }
                self.record_count_capture(name, count_capture);
                Ok(())
            }
            S::Require { condition, code, message, site } => {
                validate_code(site, code)?;
                let (expr, ty) = self.expr(condition, out)?;
                if !ty.is_bool() {
                    return Err(type_error(condition.site(), format!("require needs a bool condition, got {}", ty.name()), bool_condition_rewrite(&ty, "require x {} else CODE")));
                }
                self.narrow(condition, true);
                out.push(Stmt::Require { condition: expr, code: code.clone(), site: Some(site.to_string()), message: message.clone() });
                Ok(())
            }
            S::Emit { effect, payload, once, site } => {
                if self.viewer_depth.is_some() { return Err(job_reads::read_only(site)); }
                if self.in_prelude {
                    return Err(placement(site, "a write belongs to a chunk", "move emit inside a top-level `for row in table:` job sweep"));
                }
                if self.kind == ProgramKind::Query {
                    return Err(Diagnostic::new(site, "E_EMIT_IN_QUERY", "queries cannot emit effects", "change query to mutation before emitting an effect"));
                }
    fn expr_inner(&mut self, expr: &A, out: &mut setup::Body) -> Fallible<(Expr, Ty)> {
        let site = expr.site();
        match expr {
            A::Name { name, .. } if self.binding(name).is_none() && self.catalog.view_reads.contains_key(name) => {
                let mut merge = self.catalog.view_reads[name].clone();
                merge.site = site.clone();
                self.planned_view(&merge, out, prefix::Position::Page)
            }
            A::Name { name, .. } if self.binding(name).is_none()
                && self.catalog.tables.get(name).and_then(|table| table.maintained.as_ref()).is_some_and(|maintain| maintain.by.is_empty()) => {
                // @ref LLP 3000.013.001#3-global-maintained-view-representation — an ungrouped view name is its scalar, not a table page.
                self.read(&ReadExpr { cursor_prefix: None, computed: Default::default(), table: name.clone(), keys: Vec::new(), seeks: Vec::new(), filter: None, index: Some("byGroup".into()), order_keys: Vec::new(), range: None, matching: None, site: site.clone() }, out)
            }
            A::Name { name, .. } if self.binding(name).is_none() && self.catalog.tables.contains_key(name) => {
                self.read(&ReadExpr { cursor_prefix: None, computed: Default::default(), table: name.clone(), keys: Vec::new(), seeks: Vec::new(), filter: None, index: Some("byId".into()),
                    order_keys: vec!["id".into()], range: None, matching: None, site: site.clone() }, out)
            }
            A::Name { name, .. } => self.name(name, site),
            A::Focal { .. } => match &self.focal {
                Some((var, ty)) => Ok((ir::var(var), ty.clone())),
                None => Err(unknown(site, "focal . is valid only inside a row shape", "name the row: `row.field`")),
            },
            A::Literal { value, .. } => Ok(match value {
                Literal::Str(text) => (Expr::Literal(Value::String(text.clone())), Ty::Text(text.chars().count() as u32)),
                Literal::Number(text) => (Expr::Literal(Value::Int(super::super::integer_literal(text, site)?)), Ty::Int),
                Literal::Bool(b) => (Expr::Literal(Value::Bool(*b)), Ty::Bool),
                Literal::Null => (Expr::Literal(Value::Null), Ty::Null),
            }),
            A::Array { items, .. } => {
                let mut exprs = Vec::new();
                let mut item_ty: Option<Ty> = None;
                let args = self.strict_args(items, out)?;
                let origins: Vec<_> = args.iter().zip(items).map(|((_, ty), source)| (ty.clone(), source.clone())).collect();
                for (e, t) in args {
                    item_ty = Some(match item_ty {
                        Some(j) => j.join_item(&t).map_err(|error| self.join_error_many(error.at("[]"), &origins))?,
                        None => t,
                    });
                    exprs.push(e);
                }
                let max = exprs.len() as u32;
                Ok((Expr::Array(exprs), Ty::List(Box::new(item_ty.unwrap_or(Ty::Unknown)), max)))
            }
            A::Object { fields, .. } => self.object(fields, out),
            A::Unary { op, value, .. } => {
                let (e, t) = self.expr(value, out)?;
                if op == "not" {
                    if !t.is_bool() {
                        let operand = print::expression(value);
                        return Err(type_error(site, format!("not needs a bool, got {} — `not` binds tighter than a comparison, so `not {operand} = x` reads as `(not {operand}) = x`", t.name()),
                            format!("write `{operand} != x`, or parenthesize: `not ({operand} = x)`")));
                    }
                    Ok((Expr::Unary { op: UnaryOp::Not, value: Box::new(e) }, Ty::Bool))
                } else {
                    if !t.is_numeric() {
                        return Err(type_error(site, format!("unary - needs a present number, got {}", t.name()), "negate an int, decimal or money value"));
                    }
                    Ok((Expr::Unary { op: UnaryOp::Neg, value: Box::new(e) }, t))
                }
            }
            A::Binary { op, left, right, .. } => self.binary(op, left, right, site, out),
            A::If { then, condition, otherwise, .. } => self.conditional(then, condition, otherwise, out),
            A::Member { base, name, .. } => {
                // Generated maintain keys are literal path-named columns. Resolve
                // the full chain before ordinary member/reference traversal.
                if let Some((root, path)) = aggregate_path(expr) {
                    let (e, t) = self.computation(root, out)?;
                    if let Ty::Row(table) = t.required()
                        && let Some(info) = self.catalog.tables.get(&table)
                        && info.maintained.is_some() && info.columns.contains_key(&path)
                    {
                        let (value, ty) = self.member(e, t, &path, site)?;
                        return Ok((value, self.field_refinement(expr).unwrap_or(ty)));
                    }
                }
                let (e, t) = self.computation(base, out)?;
                if name == "length" && matches!(t.required(), Ty::Text(_) | Ty::Enum(_) | Ty::List(..) | Ty::Page(..) | Ty::Collection(..)) {
                    return Err(unsupported(site, ".length", format!("count({})", print::expression(base))));
                }
                // @ref LLP 3000.036#12 — a required reference's field reads its row:
                // `x.ref.col` is `t[x.ref].col`, the same authorized point read
                // (null when the row is missing or hidden), bound once.
                // A recorded attribution column spelled `ref.col` names the value
                // copied at insert; the live read would be a second meaning.
                let recorded = matches!(base.as_ref(), A::Member { name: column, .. }
                    if self.catalog.tables.values().any(|info| info.recorded.contains_key(&format!("{column}.{name}"))));
                if let Ty::Ref(table) = &t && name != "id" && !recorded
                    && self.catalog.tables.get(table).is_some_and(|info| info.maintained.is_none() && info.decl.ephemeral.is_none())
                {
                    let local = self.temp("reference");
                    let runtime = self.declare(&local, t.clone());
//! Object spread is binder sugar: no new runtime or wire form.
// @ref LLP 3000.013#7 — intent forms lower into the existing ruled, metered interpreter.
use super::*;

type Field = (String, Expr, Ty, Site);

/// Inherited fields may be replaced; writing a name explicitly twice is a
/// separate authoring error, even when a spread sits between the two sites.
pub(super) fn explicit_fields<'a>(fields: impl Iterator<Item = (&'a str, &'a Site)>) -> Fallible<()> {
    let mut names = BTreeMap::new();
    for (name, site) in fields {
        if let Some(first) = names.insert(name, site) {
            return Err(Diagnostic::new(site, "E_QUARRY_DUPLICATE_FIELD",
                format!("field {name} is explicit twice: {first} and {site}"),
                format!("rename {name} at {site} to {name}Detail or remove it; the first explicit {name} is at {first}")).guide("shapes"));
        }
    }
    Ok(())
}

impl Binder<'_> {
    pub(super) fn object(&mut self, fields: &[ObjectField], out: &mut setup::Body) -> Fallible<(Expr, Ty)> {
        explicit_fields(fields.iter().filter(|f| !f.spread).map(|f| (f.name.as_str(), &f.site)))?;
        if fields.iter().all(|field| !field.spread) {
            return self.plain_object(fields, out);
        }
        let (expanded, base) = self.object_fields(fields, None, out)?;
        let mut values = BTreeMap::new();
        let mut types = BTreeMap::new();
        for (name, value, ty, _) in merge_fields(expanded)? {
            values.insert(name.clone(), value);
            types.insert(name, ty);
        }
        if let Some(base) = base {
            if types.contains_key("pending") {
                return Err(type_error(&fields.iter().find(|field| field.name == "pending").unwrap_or(&fields[0]).site,
                    "pending is the device's row metadata", "omit pending from the object; it is preserved from the spread row"));
            }
            Ok((Expr::Shape { base: Box::new(base), fields: values }, Ty::RowObject(types)))
        } else { Ok((Expr::Object(values), Ty::Object(types))) }
    }

    fn plain_object(&mut self, fields: &[ObjectField], out: &mut setup::Body) -> Fallible<(Expr, Ty)> {
        let mut exprs = Vec::<(String, Expr)>::new();
        let mut types = BTreeMap::new();
        let mut failed = None;
        for field in fields {
            let mut setup = setup::Body::default();
            let value = match &field.value {
                Some(value) => self.expr(value, &mut setup),
                None => self.name(&field.name, &field.site),
            };
            let (e, t) = match value {
                Ok(value) => value,
                Err(error) => { self.record_error(error.clone()); failed.get_or_insert(error); continue; }
            };
            self.sequence_setup(exprs.iter_mut().map(|(_, e)| e), setup, out);
            // Object IR stores fields by name. Minted ids still follow source
            // field order when no child needs a statement-producing expansion.
            let e = if expr::allocates(&e) { self.snapshot(e, out) } else { e };
            exprs.push((field.name.clone(), e));
            types.insert(field.name.clone(), t);
        }
        match failed { Some(error) => Err(error), None => Ok((Expr::Object(exprs.into_iter().collect()), Ty::Object(types))) }
    }

    /// Bind operands once, in source order, including overwritten operands.
    /// Field selections and an optional row base reach the existing IR. Reads
    /// still authorize the source before any of its fields can be selected.
    fn object_fields(&mut self, fields: &[ObjectField], table: Option<&TableInfo>, out: &mut setup::Body) -> Fallible<(Vec<Field>, Option<Expr>)> {
        let mut result = Vec::new();
        let mut bases = Vec::new();
        let mut failed = None;
        for field in fields {
            let mut setup = setup::Body::default();
            let bound = if field.spread {
                self.expr(field.value.as_ref().expect("a spread operand"), &mut setup)
            } else if let Some(expected) = table.and_then(|t| t.columns.get(&field.name)).map(Ty::from_scalar)
                .or_else(|| (table.is_some() && field.name == "id").then_some(Ty::Id)) {
                self.field_value(field, &expected, &mut setup)
snapback4/crates/snapback4-lang/src/bind/program.rs:1107:    fn write(&mut self, expr: &A, out: &mut setup::Body, valued: bool) -> Fallible<Option<(Expr, Ty)>> {
snapback4/crates/snapback4-lang/src/bind/program.rs:1114:    fn write_inner(&mut self, expr: &A, out: &mut setup::Body, valued: bool) -> Fallible<Option<(Expr, Ty)>> {
snapback4/crates/snapback4-lang/src/bind/program.rs:1116:        let A::Write { op, table, keys, fields, if_absent, condition, site } = expr else { unreachable!() };
snapback4/crates/snapback4-lang/src/bind/program.rs:1137:            let resolved = A::Write { op: *op, table: target, keys: vec![key], fields: fields.clone(), if_absent: *if_absent, condition: condition.clone(), site: site.clone() };
snapback4/crates/snapback4-lang/src/bind/program.rs:1240:    fn write_key(&mut self, info: &'a TableInfo, keys: &[ast::KeyPart], site: &Site, out: &mut setup::Body) -> Fallible<WriteKey> {
snapback4/crates/snapback4-lang/src/bind/program.rs:1270:    fn write_row(&mut self, info: &'a TableInfo, fields: &[ObjectField], current: Option<&str>, site: &Site, out: &mut setup::Body) -> Fallible<(Expr, Ty)> {
snapback4/crates/snapback4-lang/src/bind/program.rs:1321:    fn write_row_with_id(&mut self, info: &'a TableInfo, fields: &[ObjectField], id: Expr, site: &Site, out: &mut setup::Body) -> Fallible<(Expr, Ty)> {
snapback4/crates/snapback4-lang/src/bind/program.rs:1374:    fn write_result_type(&self, info: &TableInfo) -> Ty {
snapback4/crates/snapback4-lang/src/bind/program.rs:1495:                if let A::Write { fields, .. } = expr && fields.iter().any(|field| moving.contains(&field.name.as_str())) { changes_order = true; }
snapback4/crates/snapback4-lang/src/bind/program/expr.rs:25:        if let A::Write { .. } = value {
snapback4/crates/snapback4-lang/src/bind/program/expr.rs:75:        if !matches!(expr, A::Write { .. }) && point_facts::writes(&out[start..]) { self.invalidate_points(); }
snapback4/crates/snapback4-lang/src/bind/program/expr.rs:295:            A::Write { .. } => self.write(expr, out, true).map(|opt| opt.expect("a valued write")),

exec
/bin/bash -lc "cat snapback4/crates/snapback4-lang/src/parser/security.rs; sed -n '1,125p' snapback4/crates/snapback4-lang/src/bind/program/expr.rs; rg -n 'fn computation|fn conditional|Expr::Block|sequence_setup' snapback4/crates/snapback4-lang/src/bind/program/*.rs snapback4/crates/snapback4-lang/src/bind/program.rs | head -100; sed -n '1105,1240p' snapback4/crates/snapback4-lang/src/bind/program.rs; cat snapback4/crates/snapback4-lang/src/bind/program/setup.rs" in /home/ccheever/projects/sb4-b27-rel
 succeeded in 0ms:
use super::*;
impl Parser {
    // @ref LLP 3000.036.004#2-surface — one existing expression grammar.
    pub(super) fn parse_invariant(&mut self) -> Fallible<()> {
        let site = self.take("invariant")?.site;
        let table = self.word()?.value;
        let (target, column) = if self.maybe(".") {
            let mut field = self.word()?.value;
            while self.maybe(".") {field.push('.');field.push_str(&self.word()?.value);}
            if self.maybe("write") { ("write".into(), Some(field)) }
            else if self.maybe("update") { ("update".into(), Some(field)) }
            else if self.maybe("read") { ("read".into(), Some(field)) }
            else { (field, None) }
        } else { (self.take("always")?.value, None) };
        if target != "always" { self.take("only")?; }
        let value = self.expression(0, &[])?;
        self.end_line(&site)?;
        self.document.invariants.push(InvariantDecl { table, target, column, value, site });
        Ok(())
    }

}
//! Expression lowering with branch-owned setup statements.

use super::*;
use snapback4_core::calendar::Civil;

impl Binder<'_> {
    /// Bare tables are domains only at an aggregate/loop consumer; ordinary
    /// names keep their lexical meaning and ordinary pages keep their bounds.
    pub(super) fn aggregate_domain(&self, value: &A) -> Option<ReadExpr> {
        match value {
            A::Read(read) if read.range.is_none() && read.matching.is_none()
                && !self.catalog.tables.get(&read.table).and_then(|table| table.maintained.as_ref()).is_some_and(|maintain| maintain.by.is_empty()) => Some(read.clone()),
            A::Name { name, site } if self.binding(name).is_none() && self.catalog.tables.contains_key(name)
                && !self.catalog.tables.get(name).and_then(|table| table.maintained.as_ref()).is_some_and(|maintain| maintain.by.is_empty()) =>
                Some(ReadExpr { cursor_prefix: None, order_keys: Vec::new(), computed: Default::default(), table: name.clone(), keys: Vec::new(), index: Some("byId".into()), range: None, matching: None, filter: None, seeks: Vec::new(), site: site.clone() }),
            _ => None,
        }
    }

    // ----- expressions -----

    /// An expression whose value is used (bound, returned, or a final
    /// write): writes yield their row.
    pub(super) fn value_of(&mut self, value: &A, out: &mut setup::Body) -> Fallible<(Expr, Ty)> {
        if let A::Write { .. } = value {
            return self.write(value, out, true).map(|opt| opt.expect("a valued write"));
        }
        self.expr(value, out)
    }

    /// Strict compound children run in source order, before setup emitted by
    /// a later child. Lexical values and their fields cannot change here;
    /// leaving those fields in their object also preserves pending provenance.
    pub(super) fn snapshot(&mut self, value: Expr, out: &mut setup::Body) -> Expr {
        if matches!(value, Expr::Literal(_) | Expr::Input(Input::Viewer | Input::Now)) || lexical_value(&value) {
            return value;
        }
        let name = self.temp("value");
        out.push(Stmt::Let { name: name.clone(), value });
        ir::var(&name)
    }

    pub(super) fn sequence_setup<'e>(&mut self, prior: impl Iterator<Item = &'e mut Expr>, setup: setup::Body, out: &mut setup::Body) {
        if !setup.is_empty() {
            for value in prior {
                *value = self.snapshot(std::mem::replace(value, Expr::Literal(Value::Null)), out);
            }
            out.extend(setup);
        }
    }

    pub(super) fn strict_args(&mut self, args: &[A], out: &mut setup::Body) -> Fallible<Vec<(Expr, Ty)>> {
        let mut values = Vec::<(Expr, Ty)>::new();
        let mut failed = None;
        for arg in args {
            let mut setup = setup::Body::default();
            match self.expr(arg, &mut setup) {
                Ok(value) => {
                    self.sequence_setup(values.iter_mut().map(|(e, _)| e), setup, out);
                    values.push(value);
                }
                Err(error) => { self.record_error(error.clone()); failed.get_or_insert(error); }
            }
        }
        match failed { Some(error) => Err(error), None => Ok(values) }
    }

    pub(super) fn expr(&mut self, expr: &A, out: &mut setup::Body) -> Fallible<(Expr, Ty)> {
        // Only shape/object/list construction forwards output position. Every
        // operator, call, key, predicate and assertion consumes its operands.
        let prior = self.returned_data;
        self.returned_data &= matches!(expr, A::Array { .. } | A::Object { .. } | A::Shape { .. } | A::ShapeUse { .. } | A::Member { .. } | A::Name { .. } | A::Focal { .. });
        let start = out.len();
        let result = self.expr_inner(expr, out);
        if !matches!(expr, A::Write { .. }) && point_facts::writes(&out[start..]) { self.invalidate_points(); }
        self.returned_data = prior;
        // Even a builtin's ordinary type refusal should explain why a whole
        // maintained value cannot be consumed. Successful calls are checked by
        // the shared IR allowlist; this only improves already-failing calls.
        if result.as_ref().is_err_and(|d| d.code == "E_QUARRY_TYPE") {
            let args: Vec<&A> = match expr { A::Call { args, .. } => args.iter().collect(), A::Binary { left, right, .. } => vec![left, right], _ => vec![] };
            let mut probe = self.clone();
            for arg in args {
                if let Ok((_, ty)) = probe.expr(arg, &mut setup::Body::default()) {
                    self.maintenance_operand(&ty, arg.site())?;
                }
            }
        }
        let result = result?;
        if !self.schema.receipts.is_empty() {
            let site = self.call_chain.iter().find(|(name, _)| self.catalog.documents.iter().flat_map(|d| &d.tables).filter_map(|t| t.receipts.as_ref()).any(|clause| &clause.operations[0] == name))
                .map(|(_, site)| site).unwrap_or_else(|| expr.site());
            self.receipt_sources.push((result.0.clone(), site.clone()));
        }
        Ok(result)
    }

    fn maintenance_operand(&self, ty: &Ty, site: &Site) -> Fallible<()> {
        match ty {
            Ty::Row(table) | Ty::WriteRow(table) | Ty::Page(table, _) => {
                if self.schema.row_view_predicate_field(table, "recountPending").is_some() {
                    return Err(Diagnostic::new(site, "E_VIEW_KEY", format!("value contains {table}.recountPending/pending maintenance state"),
                        "project the field you need first (value, member identity or copied member fields); return maintenance state only as query data").guide("maintains"));
                }
            },
            Ty::Optional(item) | Ty::Omittable(item) | Ty::List(item, _) | Ty::Collection(item, _) => self.maintenance_operand(item, site)?,
            Ty::Object(fields) | Ty::RowShape(fields) | Ty::RowObject(fields) => for ty in fields.values() { self.maintenance_operand(ty, site)?; },
            _ => {},
        }
        Ok(())
    }

    pub(super) fn computation(&mut self, expr: &A, out: &mut setup::Body) -> Fallible<(Expr, Ty)> {
        let prior = std::mem::replace(&mut self.returned_data, false);
        let result = self.expr(expr, out);
        self.returned_data = prior;
        result
    }

    fn expr_inner(&mut self, expr: &A, out: &mut setup::Body) -> Fallible<(Expr, Ty)> {
        let site = expr.site();
        match expr {
            A::Name { name, .. } if self.binding(name).is_none() && self.catalog.view_reads.contains_key(name) => {
                let mut merge = self.catalog.view_reads[name].clone();
                merge.site = site.clone();
snapback4/crates/snapback4-lang/src/bind/program/views.rs:111:            let project = if projection_setup.is_empty() { project } else { Expr::Block { body: projection_setup.code, value: Box::new(project) } };
snapback4/crates/snapback4-lang/src/bind/program/views.rs:160:            lane.source = Some(ir::LaneSource::List { max, value: Expr::Block { body: vec![
snapback4/crates/snapback4-lang/src/bind/program/keys.rs:14:            self.sequence_setup(keys.iter_mut().map(|(_, e, _)| e), setup, out);
snapback4/crates/snapback4-lang/src/bind/program/objects.rs:57:            self.sequence_setup(exprs.iter_mut().map(|(_, e)| e), setup, out);
snapback4/crates/snapback4-lang/src/bind/program.rs:1047:                binder.sequence_setup(exprs.iter_mut().map(|(_, e)| e), setup, out);
snapback4/crates/snapback4-lang/src/bind/program.rs:1306:                    self.sequence_setup(exprs.iter_mut().map(|(_, e)| e), setup, out);
snapback4/crates/snapback4-lang/src/bind/program.rs:1333:            self.sequence_setup(exprs.iter_mut().map(|(_, e)| e), setup, out);
snapback4/crates/snapback4-lang/src/bind/program/job_reads.rs:33:        out.push(Stmt::Let { name: self.temp("as"), value: Expr::Builtin { builtin: Builtin::JobAs, args: vec![value, Expr::Block { body: code.code, value: Box::new(ir::lit(Value::Null)) }] } });
snapback4/crates/snapback4-lang/src/bind/program/returned_shapes.rs:16:            LoopDomain::DerivedArray { value: value @ Expr::Block { .. }, .. } => snapback4_core::engine::expression_page_site(value)?,
snapback4/crates/snapback4-lang/src/bind/program/returned_shapes.rs:44:                        Expr::Block { .. } => {
snapback4/crates/snapback4-lang/src/bind/program/returned_shapes.rs:118:            Expr::Block { body, value } => { self.body(body); self.expr(value); }
snapback4/crates/snapback4-lang/src/bind/program/immutable.rs:181:        Expr::Block { .. } | Expr::Scan(_) | Expr::Merge(_) => false,
snapback4/crates/snapback4-lang/src/bind/program/pure_calls.rs:108:        Expr::Block { body, value } => statements(body) && expression(value),
snapback4/crates/snapback4-lang/src/bind/program/extrema.rs:67:        let value = if body.is_empty() { value } else { Expr::Block { body: body.code, value: Box::new(value) } };
snapback4/crates/snapback4-lang/src/bind/program/reads.rs:234:        Ok(if body.is_empty() { value } else { Expr::Block { body: body.code, value: Box::new(value) } })
snapback4/crates/snapback4-lang/src/bind/program/expr.rs:43:    pub(super) fn sequence_setup<'e>(&mut self, prior: impl Iterator<Item = &'e mut Expr>, setup: setup::Body, out: &mut setup::Body) {
snapback4/crates/snapback4-lang/src/bind/program/expr.rs:59:                    self.sequence_setup(values.iter_mut().map(|(e, _)| e), setup, out);
snapback4/crates/snapback4-lang/src/bind/program/expr.rs:113:    pub(super) fn computation(&mut self, expr: &A, out: &mut setup::Body) -> Fallible<(Expr, Ty)> {
snapback4/crates/snapback4-lang/src/bind/program/control.rs:190:                    self.sequence_setup([&mut expr].into_iter(), setup, out);
snapback4/crates/snapback4-lang/src/bind/program/constraints.rs:167:            Expr::Block { value, body } => reads(value, site) || body.iter().any(|statement| matches!(statement, ir::Stmt::Let { value, .. } if reads(value, site))),
snapback4/crates/snapback4-lang/src/bind/program/conditional.rs:6:    pub(super) fn conditional(&mut self, then: &A, condition: &A, otherwise: &A, out: &mut setup::Body) -> Fallible<(Expr, Ty)> {
snapback4/crates/snapback4-lang/src/bind/program/conditional.rs:48:        let value = if variant.is_some() { Expr::Block { body: variant_body.code, value: Box::new(ir::var(&temp)) } } else { ir::var(&temp) };
    /// Bind a write. When `valued`, the write yields its row (an insert's
    /// image, an update's or upsert's re-read row, null for a delete).
    fn write(&mut self, expr: &A, out: &mut setup::Body, valued: bool) -> Fallible<Option<(Expr, Ty)>> {
        let result = self.write_inner(expr, out, valued);
        self.may_have_written = true;
        self.invalidate_after_write(expr);
        result
    }

    fn write_inner(&mut self, expr: &A, out: &mut setup::Body, valued: bool) -> Fallible<Option<(Expr, Ty)>> {
        if self.viewer_depth.is_some() { return Err(job_reads::read_only(expr.site())); }
        let A::Write { op, table, keys, fields, if_absent, condition, site } = expr else { unreachable!() };
        // @ref LLP 3000.036#12 — `delete row` and `update row { … }` write the
        // row a present row variable holds: the same write as `t[row]`.
        if keys.is_empty() && matches!(op, WriteOp::Delete | WriteOp::Update) {
            let resolved = match self.lookup(table) {
                Some(Ty::Row(target)) => Some(target.clone()),
                _ => None,
            };
            let Some(target) = resolved else {
                let (message, rewrite) = match self.lookup(table) {
                    Some(Ty::Optional(inner)) if matches!(inner.as_ref(), Ty::Row(_)) => {
                        let Ty::Row(target) = inner.as_ref() else { unreachable!() };
                        (format!("{table} may be null; {} needs a present row", op.word()), format!("{table} = {target}[id] ! else NOT_FOUND, then {} {table}", op.word()))
                    }
                    Some(other) => (format!("{} {table} needs a row variable; {table} is {}", op.word(), other.name()), format!("{} t[{table}]", op.word())),
                    None if self.catalog.tables.contains_key(table.as_str()) => (format!("{} {table} names no row", op.word()), format!("{} {table}[id]{}", op.word(), if *op == WriteOp::Update { " { … }" } else { "" })),
                    None => (format!("unknown row variable {table}"), format!("bind it first: row = t[id] ! else NOT_FOUND, then {} row", op.word())),
                };
                return Err(unknown(site, message, rewrite));
            };
            let key = ast::KeyPart { column: None, value: A::Name { name: table.clone(), site: site.clone() }, site: site.clone() };
            let resolved = A::Write { op: *op, table: target, keys: vec![key], fields: fields.clone(), if_absent: *if_absent, condition: condition.clone(), site: site.clone() };
            return self.write_inner(&resolved, out, valued);
        }
        if self.in_prelude {
            return Err(placement(site, "a write belongs to a chunk", format!("move {} {table} inside a top-level `for row in table:` job sweep", op.word())));
        }
        if self.kind == ProgramKind::Query {
            return Err(Diagnostic::new(site, "E_QUARRY_PLACEMENT", format!("queries cannot {} {table}", op.word()), "move the write into a mutation").guide("programs"));
        }
        let info = self.table(table, site)?;
        if info.maintained.is_some() {
            return Err(unknown(site, format!("{table} is a maintained aggregate; write its source rows instead"), format!("{} {}", op.word(), info.maintained.as_ref().map(|m| m.source.clone()).unwrap_or_default())));
        }
        for field in fields {
            if info.decl.columns.iter().any(|c| c.name == field.name && c.sequence.is_some()) {
                return Err(Diagnostic::new(&field.site, "E_SEQUENCE_SUPPLIED", format!("{table}.{} is assigned by the engine", field.name),
                    format!("omit {} from the {} payload", field.name, op.word())).guide("writes"));
            }
            if super::columns::fields(info).any(|name|name == field.name) {
                return Err(super::columns::refusal(&field.site,format!("{table}.{} is engine-maintained; write its source rows instead",field.name)));
            }
        }
        self.system_principal_write(info, op, fields, *if_absent, site)?;
        self.note_denied_write(info, op, fields, site);
        // Writes share table-level residency facts, but every source occurrence
        // (including an expanded helper) belongs in a changed-prediction note.
        let write_name = format!("{} {table}", op.word());
        self.sources.insert(format!("write/{write_name}/{site}"), (site.clone(), write_name));
        match op {
            WriteOp::Insert => {
                let (row, row_ty) = self.write_row(info, fields, None, site, out)?;
                let row_ty = if self.schema.tables[table].column_reads.is_empty() || self.ordinary_write_lifetime(table) && self.row_independent_read_proved(table) { row_ty } else { row_ty.optional() };
                let tmp = self.temp("inserted");
                out.push(Stmt::Const { name: tmp.clone(), value: row });
                if *if_absent {
                    let result = self.temp("absent");
                    out.push(Stmt::InsertIfAbsent { table: table.clone(), row: ir::var(&tmp), result: result.clone() });
                    return Ok(valued.then(|| (self.project_insert(info, ir::var(&result)), row_ty.optional())));
                }
                out.push(Stmt::Insert { table: table.clone(), row: ir::var(&tmp) });
                Ok(valued.then(|| (self.project_insert(info, ir::var(&tmp)), row_ty)))
            }
            WriteOp::Update | WriteOp::Upsert => {
                // @ref LLP 3000.007#17 — upsert's insert arm has no old row on which to decide a condition.
                if *op == WriteOp::Upsert && condition.is_some() {
                    return Err(unknown(site, "upsert cannot take a condition", "a condition belongs on update; an upsert inserts or patches"));
                }
                // @ref LLP 3000.007#8 — item 7: target resolution and conditional old images belong to the engine.
                let key = self.write_key(info, keys, site, out).map_err(|error| self.extra_write_test(info, expr, error))?;
                let upsert = *op == WriteOp::Upsert;
                if upsert && fields.iter().any(|f| f.name == "id") {
                    return Err(unknown(site, "upsert cannot spell id; the key names the row", "remove id from the patch; the key names the row"));
                }
                let (patch, _) = self.write_row(info, fields, Some("patch"), site, out)?;
                self.immutable_patch(info, &key, &patch, fields, site, out, upsert, condition.is_some())?;
                let condition = if let Some(condition) = condition {
                    let old = self.temp("condition");
                    let prior = self.focal.replace((old.clone(), Ty::Row(table.clone())));
                    let mut setup = setup::Body::default();
                    let bound = self.expr(condition, &mut setup);
                    self.focal = prior;
                    let (value, ty) = bound?;
                    if !ty.is_bool() {
                        return Err(type_error(condition.site(), format!("update's condition must be bool, got {}", ty.name()), "update t[key] { body } if .body = expected"));
                    }
                    out.nest(&format!("{}.condition", out.len()), &setup.ownership);
                    Some(ir::WriteCondition { old, setup: setup.code, value })
                } else { None };
                let result = valued.then(|| self.temp("written"));
                let target = Read { site: site.to_string(), table: table.clone(), index: key.index, key: key.key, provenance: KeyProvenance::Shape };
                out.push(Stmt::WriteTarget { target, patch, upsert, condition, result: result.clone() });
                let row_ty = self.write_result_type(info);
                let row_ty = if self.ordinary_write_lifetime(table) && self.row_independent_read_proved(table) {
                    row_ty
                } else { row_ty.optional() };
                Ok(result.map(|name| (ir::var(&name), row_ty)))
            }
            WriteOp::Delete => {
                let key = self.write_key(info, keys, site, out).map_err(|error| self.extra_write_test(info, expr, error))?;
                if key.alternate {
                    let location = self.site();
                    self.sources.insert(location.clone(), (site.clone(), format!("delete {table}")));
                    out.push(Stmt::DeleteTarget { target: Read { site: location, table: table.clone(), index: key.index, key: key.key, provenance: KeyProvenance::Shape } });
                } else {
                    out.push(Stmt::Delete { table: table.clone(), key: key.key[0].clone() });
                }
                Ok(valued.then(|| (Expr::Literal(Value::Null), Ty::Null)))
            }
        }
    }

    /// `t[row]` where `row` is a present row of `t`: the same read as `t[row.id]`.
    fn row_as_key(&self, read: &ReadExpr) -> Option<ReadExpr> {
        if read.keys.len() != 1 || read.keys[0].column.is_some() || read.range.is_some() || read.filter.is_some() || read.matching.is_some() || !read.seeks.is_empty() || read.index.is_some() || !read.order_keys.is_empty() { return None; }
        let key = &read.keys[0].value;
        if !matches!(key, A::Name { .. }) { return None; }
        let (_, ty) = self.clone().expr(key, &mut setup::Body::default()).ok()?;
        if !matches!(ty, Ty::Row(ref table) | Ty::WriteRow(ref table) if *table == read.table) { return None; }
        let mut by_id = read.clone();
        by_id.keys[0].value = A::Member { base: Box::new(key.clone()), name: "id".into(), site: key.site().clone() };
        Some(by_id)
    }

    fn write_key(&mut self, info: &'a TableInfo, keys: &[ast::KeyPart], site: &Site, out: &mut setup::Body) -> Fallible<WriteKey> {
//! Binder-only expression ownership. No grouping enters the executed IR.
use super::*;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Owner { Condition, Payload }
#[derive(Clone, Debug)]
pub(crate) struct Owned { pub kind: Owner, pub by: String }
pub(crate) type Ownership = BTreeMap<String, Owned>;

// @ref LLP 3000.007#19.1 — ownership travels beside flat baseline statements, never through their lowering or serialization.
#[derive(Default)]
pub(super) struct Body {
    pub code: Vec<Stmt>,
    pub ownership: Ownership,
}

impl std::ops::Deref for Body {
    type Target = [Stmt];
    fn deref(&self) -> &[Stmt] { &self.code }
}

impl Body {
    pub fn push(&mut self, stmt: Stmt) { self.code.push(stmt); }

    pub fn nest(&mut self, prefix: &str, ownership: &Ownership) {
        self.ownership.extend(ownership.iter().map(|(path, owner)| (format!("{prefix}.{path}"), Owned { kind: owner.kind, by: format!("{prefix}.{}", owner.by) })));
    }

    pub fn extend(&mut self, other: Body) {
        let offset = self.len();
        self.ownership.extend(other.ownership.into_iter().map(|(path, owner)| {
            (shift(&path, offset), Owned { kind: owner.kind, by: shift(&owner.by, offset) })
        }));
        self.code.extend(other.code);
    }

    pub fn push_if(&mut self, condition: Expr, then_body: Body, else_body: Body) {
        self.nest(&format!("{}.then", self.len()), &then_body.ownership);
        self.nest(&format!("{}.else", self.len()), &else_body.ownership);
        self.push(Stmt::If { condition, then_body: then_body.code, else_body: else_body.code });
    }

    pub fn push_for(&mut self, binding: String, domain: LoopDomain, body: Body) {
        self.nest(&format!("{}.loop", self.len()), &body.ownership);
        self.push(Stmt::For { binding, domain, body: body.code });
    }

    pub fn own(&mut self, start: usize, owner: Owner) {
        // More deeply nested owners remain: an emit's setup resets effect
        // control even when that emit occurs in another condition's helper.
        let by = self.len().to_string();
        for index in start..self.len() {
            let entry = self.ownership.entry(index.to_string()).or_insert_with(|| Owned { kind: owner, by: by.clone() });
            if owner == Owner::Payload { *entry = Owned { kind: owner, by: by.clone() }; }
        }
    }
}

/// Translate only the side map through baseline helper-return lowering.
/// No branch here can change the code that helper_returns receives or emits.
/// Original statement ownership includes a new guard around that statement;
/// nested ownership follows it into :then. A return's two assignments share
/// its ownership, and a loop's generated break has no expression owner.
pub(super) fn helper_ownership(body: &Body) -> Ownership {
    if body.ownership.is_empty() { return Ownership::new(); }
    let mut paths = BTreeMap::new();
    helper_paths(&body.code, "", "", &mut paths);
    let mut result = Ownership::new();
    for (path, owner) in &body.ownership {
        for target in &paths[path].cover {
            result.insert(target.clone(), Owned { kind: owner.kind, by: paths[&owner.by].statement.clone() });
        }
    }
    result
}

fn shift(path: &str, offset: usize) -> String {
    let (head, tail) = path.split_once('.').map_or((path, String::new()), |(head, tail)| (head, format!(".{tail}")));
    format!("{}{tail}", head.parse::<usize>().unwrap() + offset)
}

struct Location { cover: Vec<String>, statement: String }

fn child(prefix: &str, index: usize) -> String {
    if prefix.is_empty() { index.to_string() } else { format!("{prefix}.{index}") }
}

fn helper_paths(body: &[Stmt], source: &str, target: &str, paths: &mut BTreeMap<String, Location>) -> bool {
    let mut may_return = false;
    let mut offset = 0;
    for (index, stmt) in body.iter().enumerate() {
        let from = child(source, index);
        let to = child(target, offset);
        let inner = if may_return { format!("{to}.then.0") } else { to.clone() };
        let returns = match stmt {
            Stmt::Return(_) => true,
            Stmt::If { then_body, else_body, .. } => {
                let a = helper_paths(then_body, &format!("{from}.then"), &format!("{inner}.then"), paths);
                let b = helper_paths(else_body, &format!("{from}.else"), &format!("{inner}.else"), paths);
                a || b
            }
            Stmt::For { body, .. } => helper_paths(body, &format!("{from}.loop"), &format!("{inner}.loop"), paths),
            // Write-condition setup does not contain helper-local returns;
            // baseline helper_returns leaves it alone.
            Stmt::WriteTarget { condition: Some(condition), .. } => {
                unchanged_paths(&condition.setup, &format!("{from}.condition"), &format!("{inner}.condition"), paths);
                false
            }
            _ => false,
        };
        let width = if !may_return && matches!(stmt, Stmt::Return(_)) { 2 } else { 1 };
        paths.insert(from, Location { cover: (0..width).map(|n| child(target, offset + n)).collect(), statement: inner });
        offset += width;
        may_return |= returns;
    }
    may_return
}

fn unchanged_paths(body: &[Stmt], source: &str, target: &str, paths: &mut BTreeMap<String, Location>) {
    for (index, stmt) in body.iter().enumerate() {
        let from = child(source, index);
        let to = child(target, index);
        paths.insert(from.clone(), Location { cover: vec![to.clone()], statement: to.clone() });
        match stmt {
            Stmt::If { then_body, else_body, .. } => {
                unchanged_paths(then_body, &format!("{from}.then"), &format!("{to}.then"), paths);
                unchanged_paths(else_body, &format!("{from}.else"), &format!("{to}.else"), paths);
            }
            Stmt::For { body, .. } => unchanged_paths(body, &format!("{from}.loop"), &format!("{to}.loop"), paths),
            Stmt::WriteTarget { condition: Some(condition), .. } => unchanged_paths(&condition.setup, &format!("{from}.condition"), &format!("{to}.condition"), paths),
            _ => {}
        }
    }
}

pub(crate) fn runtime_path(program: &str, path: &str) -> String {
    let mut result = program.to_owned();
    for part in path.split('.') {
        match part { "loop" => {}, "then" | "else" | "condition" => { result.push(':'); result.push_str(part); }, index => {
            let Ok(index) = index.parse::<usize>() else { return String::new(); };
            result.push_str(&format!(":{}", index + 1));
        } }
    }
    result
}

exec
/bin/bash -lc "rg -n 'fn quarry' snapback4/crates/snapback4-core/src -g '*.rs'; sed -n '200,245p' snapback4/crates/snapback4-lang/src/bind/program/reads.rs; cat snapback4/crates/snapback4-lang/src/bind/program/extrema.rs | head -95; sed -n '1,85p' snapback4/crates/snapback4-lang/src/bind/program/conditional.rs; sed -n '1270,1325p' snapback4/crates/snapback4-lang/src/bind/program.rs; rg -n 'struct Index|enum IndexComponent' snapback4/crates/snapback4-core/src/schema.rs" in /home/ccheever/projects/sb4-b27-rel
 succeeded in 0ms:
snapback4/crates/snapback4-core/src/schema.rs:968:    pub fn quarry(&self) -> String {
            let rewrite = match always_true(&predicate, info) {
                Some(column) => format!("drop this `where`: .{column} is required, so every row passes it"),
                None if follows => "pin a column with `where .col = value`, choose `by .col`, or read a `view` (see `snapback4 guide feeds`)".to_owned(),
                None => "pin a column with `where .col = value`, choose `by .col`, read a `view` for a count or total, or drop a `where` every row passes".to_owned(),
            };
            self.notes.push(Diagnostic::new(predicate.site(), "N_SPARSE_FILTER",
                format!("{} by {}: this unscoped `where` pins no index prefix; {consequence}", read.table, index.name),
                rewrite).guide(if follows { "feeds" } else { "reads" }));
        }
        let value = self.row_predicate(&read.table, &predicate)?;
        Ok((read, Some(Box::new(value))))
    }

    pub(super) fn row_predicate(&mut self, table: &str, predicate: &A) -> Fallible<Expr> {
        let row_ty = Ty::Row(table.into());
        let prior = self.focal.replace(("$filter".into(), row_ty.clone()));
        let kind = std::mem::replace(&mut self.kind, ProgramKind::Query);
        let predicate_context = std::mem::replace(&mut self.in_predicate, true);
        let mut body = setup::Body::default();
        self.push_scope();
        // A fresh lexical row snapshot lets short-circuit guards narrow its
        // fields without leaking facts to another scan or an enclosing row.
        self.scopes.last_mut().unwrap().insert("$filter".into(), Binding {
            runtime: "$filter".into(), declared: row_ty.clone(), ty: row_ty,
            parameter: false, revision: 0, fields: BTreeMap::new(), error: None, origins: Vec::new(), inline: None,
        });
        let bound = self.expr(predicate, &mut body);
        self.pop_scope();
        self.kind = kind;
        self.in_predicate = predicate_context;
        self.focal = prior;
        let (value, ty) = bound?;
        if !ty.is_bool() { return Err(type_error(predicate.site(), format!("where needs a bool predicate, got {}", ty.name()), "where .col = value")); }
        // @ref LLP 3000.007#5.6 — predicate setup, including lazy reads, runs afresh for each rule-visible row.
        Ok(if body.is_empty() { value } else { Expr::Block { body: body.code, value: Box::new(value) } })
    }
}

fn pins_leading_column(expr: &A, column: Option<&str>) -> bool {
    let focal_column = |value: &A| matches!(value, A::Member { base, name, .. } if matches!(base.as_ref(), A::Focal { .. }) && Some(name.as_str()) == column);
    match expr {
        A::Binary { op, left, right, .. } if op == "and" => pins_leading_column(left, column) || pins_leading_column(right, column),
        A::Binary { op, left, right, .. } if op == "or" => pins_leading_column(left, column) && pins_leading_column(right, column),
        A::Binary { op, left, right, .. } if op == "=" => (focal_column(left) && !has_focal(right)) || (focal_column(right) && !has_focal(left)),
        _ => false,
    }
//! Resolve row extrema without changing the binary min/max overload.
use super::*;

impl Binder<'_> {
    // @ref LLP 3000.019#3.2 — literal columns retain their encoding and seek;
    // other scalar values bind to the aggregate row and fold the whole scan.
    pub(super) fn extremum(&mut self, name: &str, args: &[A], out: &mut setup::Body) -> Fallible<Option<(Expr, Ty)>> {
        if matches!(&args[1], A::Member { base, .. } if matches!(base.as_ref(), A::Focal { .. })) {
            return self.column_extremum(name, args, out);
        }
        let candidate = self.aggregate_domain(&args[0]).or_else(|| {
            self.catalog.extremum_domains.get(&args[0].site().to_string()).filter(|read|
                !self.catalog.tables.get(&read.table).and_then(|table| table.maintained.as_ref())
                    .is_some_and(|maintain| maintain.by.is_empty())).cloned()
        });
        let domain = if let Some(read) = candidate {
            self.is_page(&read, ReadMode::FilteredPoint)?.then_some(read)
        } else { None };
        let nonempty = domain.as_ref().is_some_and(|read| self.aggregate_nonempty(read));
        let mut probe = self.clone();
        let source_ty = match probe.expr(&args[0], &mut setup::Body::default()) {
            Ok((_, ty)) => {
                if ty.sequence().is_none() { return Ok(None); }
                Some(ty)
            }
            Err(error) if domain.is_none() => return Err(error),
            Err(_) => None,
        };
        let outer = probe.expr(&args[1], &mut setup::Body::default());
        if let Ok((_, other)) = &outer {
            if !other.is_optional() && source_ty.as_ref().is_some_and(|ty| ty.comparable(other)) {
                return Ok(None); // the existing binary collection overload
            }
            // An expression which needs the enclosing focal row cannot silently
            // switch to the aggregate row. Removing just that focal binding also
            // distinguishes nested shapes/aggregates that own their own `.`.
            probe.focal = None;
            if self.focal.is_some() && probe.expr(&args[1], &mut setup::Body::default()).is_err() {
                return Err(ambiguous(args[1].site(), format!("{name}'s value expression can bind the enclosing row"),
                    format!("move `{name}({}, {})` into a helper outside the enclosing shape; pass enclosing values as named arguments", print::expression(&args[0]), print::expression(&args[1]))).guide("reads"));
            }
        }
        let (source, item, domain) = if let Some(read) = domain {
            let (scan, _) = self.scan_at(&read, out, prefix::Position::Aggregate)?;
            self.shape_meter_note(&scan, &read);
            (Expr::Scan(scan), Ty::Row(read.table), true)
        } else {
            let (source, ty) = self.expr(&args[0], out)?;
            (source, ty.sequence().expect("probed sequence").0, false)
        };
        let saved = self.focal.replace(("$filter".into(), item.clone()));
        let predicate = std::mem::replace(&mut self.in_predicate, false);
        let kind = std::mem::replace(&mut self.kind, ProgramKind::Query);
        self.push_scope();
        self.declare("$filter", item);
        let mut body = setup::Body::default();
        let projected = self.expr(&args[1], &mut body);
        self.pop_scope();
        self.kind = kind;
        self.in_predicate = predicate;
        self.focal = saved;
        let (value, ty) = projected?;
        if matches!(ty.required(), Ty::List(..) | Ty::Collection(..) | Ty::Page(..) | Ty::Object(..) | Ty::RowShape(..) | Ty::RowObject(..) | Ty::Row(..) | Ty::WriteRow(..)) {
            return Err(type_error(args[1].site(), format!("{name} needs a scalar row expression, got {}", ty.name()),
                format!("{name}({}, .column + 1)", print::expression(&args[0]))));
        }
        let value = if body.is_empty() { value } else { Expr::Block { body: body.code, value: Box::new(value) } };
        let result = if nonempty && !ty.is_optional() { ty } else { ty.optional() };
        Ok(Some((Expr::Builtin { builtin: Builtin::ExtremumOf { max: name == "max", domain }, args: vec![source, value] }, result)))
    }

    // @ref LLP 3000.013#5.1 — domains retain aggregate admission and coverage.
    fn column_extremum(&mut self, name: &str, args: &[A], out: &mut setup::Body) -> Fallible<Option<(Expr, Ty)>> {
        let A::Member { base, name: field, .. } = &args[1] else { return Ok(None); };
        if !matches!(base.as_ref(), A::Focal { .. }) { return Ok(None); }
        // Speculation must not emit setup or consume fresh names for a scalar
        // binary call such as min(value, .column) inside an existing shape.
        let mut probe = self.clone();
        let domain = if let Some(read) = self.aggregate_domain(&args[0]) {
            self.is_page(&read, ReadMode::FilteredPoint)?.then_some(read)
        } else { None };
        let probed = match probe.expr(&args[0], &mut setup::Body::default()) {
            Ok(value) => Some(value),
            Err(error) if domain.is_none() => return Err(error),
            // A streaming domain need not be a valid materialized page.
            Err(_) => None,
        };
        if let Some((_, ty)) = probed {
            let Some((item, _)) = ty.sequence() else { return Ok(None); };
            if let Ok((_, other)) = probe.expr(&args[1], &mut setup::Body::default())
                && !other.is_optional() && ty.comparable(&other) {
                if self.member(Expr::Literal(Value::Null), item, field, args[1].site()).is_ok() {
                    return Err(ambiguous(args[1].site(), format!("{name} can compare two collections or aggregate .{field} from the first"),
                        format!("bind `other = .{field}` before this call and write `{name}({}, other)` for the binary comparison; for an aggregate, call `{name}(rows, .{field})` outside the enclosing shape", print::expression(&args[0]))).guide("reads"));
                }
//! Conditional values keep lazy execution; incompatible row arms are refused.
// @ref LLP 3000.013#7 — authoring sugar lowers to the existing ruled, metered IR.
use super::*;

impl Binder<'_> {
    pub(super) fn conditional(&mut self, then: &A, condition: &A, otherwise: &A, out: &mut setup::Body) -> Fallible<(Expr, Ty)> {
        let variant = super::super::intent_variants::condition(condition)
            .map(|(kind, input)| format!("{kind}:{}", print::expression(input)));
        let mut variant_body = setup::Body::default();
        let output = if variant.is_some() { &mut variant_body } else { &mut *out };
        let (cond, cond_ty) = self.expr(condition, output)?;
        if !cond_ty.is_bool() {
            return Err(type_error(condition.site(), format!("a conditional value needs a bool condition, got {}", cond_ty.name()), control::bool_condition_rewrite(&cond_ty, "x if ttl {} else y")));
        }
        // Each arm binds under its narrowing and runs only when taken.
        let temp = self.temp("if");
        if let Some(name) = &variant { self.variants.push((name.clone(), true)); }
        let variant_start = self.sites;
        let mut then_out = setup::Body::default();
        self.push_scope();
        self.narrow(condition, true);
        let then_bound = self.expr(then, &mut then_out);
        self.pop_scope();
        let (then_expr, then_ty) = then_bound?;
        let then_sites = self.sites;
        if variant.is_some() { self.variants.last_mut().unwrap().1 = false; self.sites = variant_start; }
        let mut else_out = setup::Body::default();
        self.push_scope();
        self.narrow(condition, false);
        let else_bound = self.expr(otherwise, &mut else_out);
        self.pop_scope();
        let (else_expr, else_ty) = else_bound?;
        if variant.is_some() { self.variants.pop(); self.sites = self.sites.max(then_sites); }
        // @ref LLP 3000.011.003.000.001#4-declaration-and-recipe-corrections — a literal fallback must not erase the other arm's enum domain.
        let literal_domain = |expression: &Expr, ty| match expression {
            Expr::Literal(Value::String(value)) => Ty::Enum(vec![value.clone()]),
            _ => ty,
        };
        // Plain text conditionals retain text operations such as concatenation.
        // Only a declared/inferred enum in the other arm calls for a finite join.
        let then_ty = if matches!(else_ty.required(), Ty::Enum(_)) { literal_domain(&then_expr, then_ty) } else { then_ty };
        let else_ty = if matches!(then_ty.required(), Ty::Enum(_)) { literal_domain(&else_expr, else_ty) } else { else_ty };
        let ty = then_ty.join(&else_ty).map_err(|error| self.join_error(error, &then_ty, &else_ty, then, otherwise, Some(condition)))?;
        then_out.push(Stmt::Assign { name: temp.clone(), value: then_expr });
        else_out.push(Stmt::Assign { name: temp.clone(), value: else_expr });
        output.push(Stmt::Let { name: temp.clone(), value: Expr::Literal(Value::Null) });
        output.push_if(cond, then_out, else_out);
        let value = if variant.is_some() { Expr::Block { body: variant_body.code, value: Box::new(ir::var(&temp)) } } else { ir::var(&temp) };
        Ok((value, ty))
    }
}
    fn write_row(&mut self, info: &'a TableInfo, fields: &[ObjectField], current: Option<&str>, site: &Site, out: &mut setup::Body) -> Fallible<(Expr, Ty)> {
        objects::explicit_fields(fields.iter().filter(|f| !f.spread).map(|f| (f.name.as_str(), &f.site)))?;
        let expanded;
        let fields = if fields.iter().any(|field| field.spread) {
            expanded = self.expand_object_fields(fields, Some(info), out)?;
            &expanded
        } else { fields };
        for field in fields {
            if super::columns::fields(info).any(|name|name == field.name) {
                return Err(super::columns::refusal(&field.site,format!("{}.{} is engine-maintained; write its source rows instead",info.decl.name,field.name)));
            }
        }
        match current {
            None => {
                if fields.iter().any(|f| f.name == "id") {
                    let (given, ty) = fields.iter().find(|f| f.name == "id").map(|f| f.value.as_ref().map(|v| self.expr_as_reference(v, out, &Ty::Id)).unwrap_or_else(|| self.name("id", site))).unwrap()?;
                    if !ty.assignable_to(&Ty::Id) { return Err(type_error(site,format!("an inserted id must be an id, got {}",ty.name()),"use row.id for a row snapshot; reference columns accept a required same-table row")); }
                    return self.write_row_with_id(info, &fields.iter().filter(|f| f.name != "id").cloned().collect::<Vec<_>>(), given, site, out);
                }
                self.write_row_with_id(info, fields, Expr::Input(Input::NewId), site, out)
            }
            Some(_) => {
                // A patch: only the named columns, each typed.
                let mut exprs = Vec::<(String, Expr)>::new();
                let mut types = BTreeMap::new();
                for field in fields {
                    if field.name == "id" {
                        return Err(unknown(&field.site, "update cannot change id", "remove id from the patch"));
                    }
                    let Some(scalar) = info.columns.get(&field.name) else {
                        return Err(unknown(&field.site, format!("{} has no column {}", info.decl.name, field.name), name_rewrite(&field.name, info.columns.keys().map(String::as_str), None)));
                    };
                    let expected = Ty::from_scalar(scalar);
                    let mut setup = setup::Body::default();
                    let (e, t) = self.field_value(field, &expected, &mut setup)?;
                    literal_in_range(info, &field.name, scalar, &e, &field.site)?;
                    self.sequence_setup(exprs.iter_mut().map(|(_, e)| e), setup, out);
                    if !t.writable_to(&expected) {
                        return Err(diagnostics::write_field_type(info, field, &expected, &t));
                    }
                    let e = if expr::allocates(&e) { self.snapshot(e, out) } else { e };
                    exprs.push((field.name.clone(), e));
                    if types.insert(field.name.clone(), t).is_some() {
                        return Err(unknown(&field.site, format!("field {} is written twice", field.name), "keep one"));
                    }
                }
                Ok((Expr::Object(exprs.into_iter().collect()), Ty::Object(types)))
            }
        }
    }

    fn write_row_with_id(&mut self, info: &'a TableInfo, fields: &[ObjectField], id: Expr, site: &Site, out: &mut setup::Body) -> Fallible<(Expr, Ty)> {
        let id = self.snapshot(id, out);
        let mut exprs = vec![("id".to_owned(), id)];
        let mut given = std::collections::BTreeSet::new();
        for field in fields {
733:pub struct Index {
781:pub enum IndexComponent {

exec
/bin/bash -lc "cat snapback4/crates/snapback4-lang/src/bind/intent_variants.rs | head -130; sed -n '960,1015p' snapback4/crates/snapback4-core/src/schema.rs; sed -n '1,115p' snapback4/crates/snapback4-lang/src/bind/program/pure_calls.rs; rg -n 'fn proof|proof\\.diagnostics|notes' snapback4/crates/snapback4-lang/src/lib.rs snapback4/crates/snapback4-lang/src/bind.rs | head -40" in /home/ccheever/projects/sb4-b27-rel
 succeeded in 0ms:
//! Argument-presence decisions select ordinary admitted reads, before planning.
use super::{catalog::{Catalog, TableInfo}, intent, intent_walk as walk};
use crate::{ast::*, diag::{Diagnostic, Site}};
use std::collections::{BTreeMap, BTreeSet};

pub(super) const PRESENT: &str = "$intentPresent";
pub(super) const SEARCH: &str = "$intentSearch";
type Inputs = BTreeMap<String, bool>; // argument-only binding -> possibly optional

pub(super) fn condition(expr: &Expr) -> Option<(&str, &Expr)> {
    if let Expr::Call { name, args, .. } = expr && matches!(name.as_str(), PRESENT | SEARCH) {
        args.first().map(|arg| (name.as_str(), arg))
    } else { None }
}

// @ref LLP 3000.013#2.1 — presence alternatives share normal planning,
// authorization, admission, meters and the server/device interpreter.
pub(super) fn expand(catalog: &mut Catalog) {
    let mut notes = Vec::new();
    // Keep authored expressions in why/check output before snapshots and
    // alternatives introduce private compiler names at those same sites.
    for doc in &mut catalog.documents {
        walk::document(doc, &mut |value| {
            if let Expr::Read(read) | Expr::Exists { read, .. } = value {
                catalog.read_origins.entry(read.site.to_string()).or_insert_with(|| catalog.source.expression(&Expr::Read(read.clone())));
                catalog.canonical_read_origins.entry(read.site.to_string()).or_insert_with(|| if read.index.is_none() { crate::print::read_expr(read) } else { catalog.source.expression(&Expr::Read(read.clone())) });
            }
        });
    }
    for doc in &mut catalog.documents {
        for program in &mut doc.programs {
            let mut inputs = inputs(&program.args);
            body(&mut program.prelude, &mut inputs, &catalog.functions, &catalog.tables, &mut notes);
            body(&mut program.body, &mut inputs, &catalog.functions, &catalog.tables, &mut notes);
        }
        for function in &mut doc.functions {
            let mut inputs = inputs(&function.args);
            match &mut function.body {
                FunctionBody::Expression(value) => expression(value, &inputs, &catalog.functions, &catalog.tables, &mut notes),
                FunctionBody::Block(stmts) => body(stmts, &mut inputs, &catalog.functions, &catalog.tables, &mut notes),
            }
        }
        for shape in &mut doc.shapes {
            walk::shape(&mut shape.fields, &mut |value| rewrite(value, &Inputs::new(), &catalog.functions, &catalog.tables, &mut notes));
        }
    }
    catalog.planner_notes.extend(notes);
}

fn inputs(args: &[ArgDecl]) -> Inputs { args.iter().map(|arg| (arg.name.clone(), arg.type_.optional)).collect() }

fn input_only(value: &Expr, inputs: &Inputs, functions: &BTreeMap<String, FunctionDecl>) -> bool {
    fn check(value: &Expr, inputs: &Inputs, functions: &BTreeMap<String, FunctionDecl>, stack: &mut BTreeSet<String>) -> bool {
        match value {
            Expr::Name { name, .. } => inputs.contains_key(name),
            Expr::Literal { .. } => true,
            Expr::Unary { value, .. } | Expr::Assert { value, .. } => check(value, inputs, functions, stack),
            Expr::Binary { left, right, .. } => check(left, inputs, functions, stack) && check(right, inputs, functions, stack),
            Expr::If { condition, then, otherwise, .. } => [condition, then, otherwise].iter().all(|value| check(value, inputs, functions, stack)),
            Expr::Array { items, .. } => items.iter().all(|value| check(value, inputs, functions, stack)),
            Expr::Call { name, args, .. } => {
                if !args.iter().all(|value| check(value, inputs, functions, stack)) { return false; }
                if let Some(function) = functions.get(name) {
                    if !stack.insert(name.clone()) { return false; }
                    let mut local = self::inputs(&function.args);
                    let result = match &function.body {
                        FunctionBody::Expression(value) => check(value, &local, functions, stack),
                        FunctionBody::Block(body) => pure_body(body, &mut local, functions, stack),
                    };
                    stack.remove(name); result
                } else { ["lower", "trim", "count", "first", "last", "at", "slice", "min", "max", "join", "tokens", "range", "sha256", "share"].contains(&name.as_str()) }
            }
            _ => false,
        }
    }
    fn pure_body(body: &[Stmt], inputs: &mut Inputs, functions: &BTreeMap<String, FunctionDecl>, stack: &mut BTreeSet<String>) -> bool {
        body.iter().all(|stmt| match stmt {
            Stmt::Bind { names, value, .. } => {
                if !check(value, inputs, functions, stack) { return false; }
                for name in names { inputs.insert(name.clone(), true); } true
            }
            Stmt::Return { value, .. } | Stmt::Expr { value, .. } => check(value, inputs, functions, stack),
            Stmt::Require { condition, .. } => check(condition, inputs, functions, stack),
            Stmt::If { condition, then_body, else_body, .. } => check(condition, inputs, functions, stack)
                && pure_body(then_body, &mut inputs.clone(), functions, stack) && pure_body(else_body, &mut inputs.clone(), functions, stack),
            Stmt::For { name, domain, body, .. } => {
                if !check(domain, inputs, functions, stack) { return false; }
                let mut local = inputs.clone();
                local.insert(name.clone(), true);
                pure_body(body, &mut local, functions, stack)
            }
            _ => false,
        })
    }
    check(value, inputs, functions, &mut BTreeSet::new())
}

fn possibly_optional(value: &Expr, inputs: &Inputs) -> bool {
    match value {
        Expr::Name { name, .. } => inputs.get(name).copied().unwrap_or(true),
        Expr::Literal { value, .. } => matches!(value, Literal::Null),
        Expr::Assert { .. } | Expr::Unary { .. } => false,
        Expr::Binary { op, right, .. } => op == "??" && possibly_optional(right, inputs),
        Expr::If { then, otherwise, .. } => possibly_optional(then, inputs) || possibly_optional(otherwise, inputs),
        Expr::Array { .. } => false,
        _ => true,
    }
}

fn body(stmts: &mut [Stmt], inputs: &mut Inputs, functions: &BTreeMap<String, FunctionDecl>, tables: &BTreeMap<String, TableInfo>, notes: &mut Vec<Diagnostic>) {
    for stmt in stmts {
        match stmt {
            Stmt::Bind { names, value, .. } => {
                let only = input_only(value, inputs, functions);
                let optional = possibly_optional(value, inputs);
                expression(value, inputs, functions, tables, notes);
                for name in names { if only { inputs.insert(name.clone(), optional); } else { inputs.remove(name); } }
            }
            Stmt::If { condition, then_body, else_body, .. } => {
                expression(condition, inputs, functions, tables, notes);
                let (mut yes, mut no) = (inputs.clone(), inputs.clone());
                body(then_body, &mut yes, functions, tables, notes); body(else_body, &mut no, functions, tables, notes);
                inputs.retain(|name, optional| {
                    if let (Some(a), Some(b)) = (yes.get(name), no.get(name)) { *optional = *a || *b; true } else { false }
                });
            }
            Stmt::As { principal, body: stmts, .. } => {
                expression(principal, inputs, functions, tables, notes);
                body(stmts, inputs, functions, tables, notes);
            }
    pub fn normal_disjunct(&self) -> RuleExpr {
        match self {
            Self::Eq(RuleTerm::Viewer, other) => Self::Eq(other.clone(), RuleTerm::Viewer),
            other => other.clone(),
        }
    }

    /// The rule as Quarry text, for diagnostics and rewrites.
    pub fn quarry(&self) -> String {
        fn term(term: &RuleTerm) -> String {
            match term {
                RuleTerm::Reference { table, column, field, old } => format!("{table}[{}.{column}].{field}", if *old { "old" } else { "" }),
                RuleTerm::ReferenceChain { column, hops, old } => hops.iter().fold(format!("{}.{column}", if *old { "old" } else { "" }), |key, hop| format!("{}[{key}].{}", hop.table, hop.field)),
                RuleTerm::Field(f) => format!(".{f}"),
                RuleTerm::OldField(f) => format!("old.{f}"),
                RuleTerm::NextField(f) => format!("next.{f}"),
                RuleTerm::Viewer => "viewer".to_owned(),
                RuleTerm::Literal(Value::String(s)) => format!("'{s}'"),
                RuleTerm::Literal(Value::Id(s)) => format!("'{s}'"),
                RuleTerm::Literal(Value::Bool(b)) => b.to_string(), RuleTerm::Literal(Value::Int(n)) => n.to_string(), RuleTerm::Literal(Value::Null) => "null".to_owned(), // Quarry, never `{"Bool":true}`
                RuleTerm::Literal(v) => crate::value::canonical_json(v),
            }
        }
        match self {
            Self::Public { .. } => "public".to_owned(),
            Self::Allow => "allow".to_owned(),
            Self::Deny => "deny".to_owned(),
            Self::Eq(l, r) => format!("{} = {}", term(l), term(r)),
            Self::Compare(op,l,r) => format!("{} {} {}", term(l), match op { crate::ir::BinaryOp::Gte => ">=", crate::ir::BinaryOp::Gt => ">", crate::ir::BinaryOp::Lte => "<=", _ => "<" }, term(r)),
            Self::Ne(l, r) => format!("{} != {}", term(l), term(r)),
            Self::And(items) => items.iter().map(|i| if matches!(i,Self::Or(_)){format!("({})",i.quarry())}else{i.quarry()}).collect::<Vec<_>>().join(" and "),
            Self::Or(items) => items.iter().map(|i| i.quarry()).collect::<Vec<_>>().join(" or "),
            Self::Not(inner) => format!("not ({})", inner.quarry()),
            Self::Exists { table, key, equalities, .. } => format!("exists {table}[{}]", key.iter().map(term).chain(equalities.iter().map(|(col, value)| format!("{col} = {}", term(value)))).collect::<Vec<_>>().join(", ")),
            Self::Created { table, key, equalities, .. } => format!("created {table}[{}]", key.iter().map(term).chain(equalities.iter().map(|(col, value)| format!("{col} = {}", term(value)))).collect::<Vec<_>>().join(", ")),
        }
    }
}

pub use reference::{RuleTerm, RuleHop, MAX_RULE_HOPS};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum Constraint {
    /// Shared decoder fence. Only the schema codec writes this wire carrier.
    Capabilities(BTreeSet<String>),
    /// Decode-only marker from unpublished F2 stores; the schema codec removes it.
    #[serde(skip_serializing)]
    Recorded,
    Unique { index: String },
    Cap { by: Vec<String>, max: u32 },
    AppendOnly,
    Immutable { fields: Vec<String> },
    Text { field: String, #[serde(default)] min: u32, #[serde(default, skip_serializing_if = "Option::is_none")] format: Option<TextFormat> },
    /// After every statement and before commit, the indexed target point
    /// must exist for each row this transaction inserted (`after insert`).
    FinalExistsOnInsert { table: String, index: String, key: Vec<RuleTerm> },
//! Null facts for repeated, effect-free helper calls over lexical snapshots.
use super::*;
use std::collections::BTreeSet;

pub(super) const CONSTANTS: &str = "$pureCallConstants";

#[derive(Debug)]
pub(super) enum Stable {
    Literal(String),
    Snapshot(String, Vec<String>),
    Viewer,
    Call(String, Vec<Stable>),
}

impl Binder<'_> {
    // @ref LLP 3000.007#5.2 — a repeated pure call narrows like a snapshot field.
    // Facts live on *every* argument root so the existing branch intersections,
    // reassignment invalidation and loop fixed point apply to them as to fields.
    fn stable_call(&self, value: &A) -> Option<(Vec<String>, BTreeSet<String>)> {
        if !matches!(value, A::Call { .. }) { return None; }
        let mut roots = BTreeSet::new();
        let stable = self.stable_value(value, &mut roots)?;
        if roots.is_empty() { roots.insert(CONSTANTS.into()); }
        Some((vec!["$pureCall".into(), stable.key()], roots))
    }

    pub(super) fn stable_value(&self, value: &A, roots: &mut BTreeSet<String>) -> Option<Stable> {
        match value {
            A::Literal { .. } => Some(Stable::Literal(print::expression(value))),
            A::Name { name, .. } if name == "viewer" => Some(Stable::Viewer),
            A::Name { name, .. } if matches!(name.as_str(), "now" | "commit" | "new") => None,
            A::Name { .. } | A::Member { .. } | A::Focal { .. } => {
                let (root, path) = control::field_path(value, self.focal.as_ref().map(|(name, _)| name.as_str()))?;
                let runtime = if let Some(binding) = self.binding(&root) {
                    roots.insert(root.clone());
                    binding.runtime.clone()
                } else {
                    // A shape's implicit row is an immutable lexical snapshot.
                    // Its unique runtime identity separates projection scopes;
                    // with no mutable argument roots, use the constant anchor.
                    self.focal.as_ref().filter(|(name, _)| name == &root)?.0.clone()
                };
                Some(Stable::Snapshot(runtime, path))
            }
            A::Call { name, args, .. } => {
                let function = self.catalog.functions.get(name)?;
                if !self.pure_functions.get(&function.name).copied().unwrap_or(false) { return None; }
                Some(Stable::Call(function.name.clone(), args.iter().map(|arg| self.stable_value(arg, roots)).collect::<Option<_>>()?))
            }
            _ => None,
        }
    }

    pub(super) fn narrow_call(&mut self, value: &A, present: bool) {
        let Some((key, roots)) = self.stable_call(value) else { return; };
        let Some(ty) = self.call_types.get(&key) else { return; };
        let ty = if present { ty.required() } else { Ty::Null };
        for root in roots {
            let mut binding = self.binding(&root).expect("a stable root").clone();
            binding.fields.insert(key.clone(), ty.clone());
            self.scopes.last_mut().expect("a scope").insert(root, binding);
        }
    }

    pub(super) fn record_call(&mut self, value: &A, ty: &Ty) {
        if let Some((key, _)) = self.stable_call(value) { self.call_types.insert(key, ty.clone()); }
    }

    pub(super) fn call_refinement(&self, value: &A) -> Option<Ty> {
        let (key, roots) = self.stable_call(value)?;
        let mut result = None;
        for root in roots {
            let ty = self.binding(&root)?.fields.get(&key)?;
            if result.as_ref().is_some_and(|other| other != ty) { return None; }
            result = Some(ty.clone());
        }
        result
    }
}

impl Stable {
    // Escaped serialization of the structured identity, never source
    // sites or helper temporaries. Argument order and snapshot identity matter.
    pub(super) fn key(&self) -> String {
        match self {
            Self::Literal(value) => format!("literal:{value:?}"),
            Self::Snapshot(root, path) => format!("snapshot:{root:?}:{path:?}"),
            Self::Viewer => "viewer".into(),
            Self::Call(name, args) => format!("call:{name:?}:{:?}", args.iter().map(Self::key).collect::<Vec<_>>()),
        }
    }
}

// Inspect expanded IR, after argument setup: this covers transitive helpers,
// named shapes, aggregates and reads hidden in blocks without a second AST
// effect model. It only classifies effects; calls still execute and are metered.
pub(super) fn expression(value: &Expr) -> bool {
    match value {
        Expr::Literal(_) | Expr::Variable(_) | Expr::Input(Input::Viewer) => true,
        Expr::Input(Input::Now | Input::ReadTime | Input::NewId) => false,
        Expr::Get(_) | Expr::Exists(_) | Expr::Scan(_) | Expr::Merge(_) => false,
        Expr::Field { base, .. } | Expr::Unary { value: base, .. } => expression(base),
        Expr::Array(values) => values.iter().all(expression),
        Expr::Object(fields) => fields.values().all(expression),
        Expr::Shape { base, fields } => expression(base) && fields.values().all(expression),
        Expr::Binary { left, right, .. } => expression(left) && expression(right),
        Expr::Builtin { builtin, args } => builtin_pure(builtin) && args.iter().all(expression),
        Expr::Block { body, value } => statements(body) && expression(value),
    }
}

fn builtin_pure(builtin: &Builtin) -> bool {
    match builtin {
        Builtin::RequireUncapped => false,
        Builtin::FileText | Builtin::JobAs | Builtin::JobQuery { .. } => false,
rg: snapback4/crates/snapback4-lang/src/bind.rs: No such file or directory (os error 2)
snapback4/crates/snapback4-lang/src/lib.rs:66:        return Bound { rollback_hides:Vec::new(), invariants: Vec::new(), receipt_members: Default::default(), refusal_sites: Default::default(), view_types: Default::default(), server: documents.iter().any(|doc| doc.server), schema: Default::default(), programs: Vec::new(), personas: Vec::new(), diagnostics, notes: Vec::new() };

exec
/bin/bash -lc 'git diff -- snapback4/crates/snapback4-lang/src/release_bridge.rs' in /home/ccheever/projects/sb4-b27-rel
 succeeded in 0ms:
diff --git a/snapback4/crates/snapback4-lang/src/release_bridge.rs b/snapback4/crates/snapback4-lang/src/release_bridge.rs
index b9d65ce402..1867e82748 100644
--- a/snapback4/crates/snapback4-lang/src/release_bridge.rs
+++ b/snapback4/crates/snapback4-lang/src/release_bridge.rs
@@ -123,7 +123,7 @@ fn loosen_inner(target:&[(String,String)],current:&[(String,String)])->Bridge {
         // predecessor is also truthful when its retained contracts compile.
         let guarded=super::release_bridge_current::guarded(target,current);
         if guarded.diagnostics.is_empty(){return guarded;}
-        return Bridge{diagnostics:complete.diagnostics.into_iter().chain(guarded.diagnostics).collect(),..guarded};
+        return guarded;
     }
     let guarded=loosen_guarded(target,current);
     if !guarded.diagnostics.is_empty(){
@@ -433,7 +433,11 @@ pub fn exact_write_authority(target:&[(String,String)],current:&[(String,String)
     let aliases=next.schema.table_renames.iter().filter(|(_,prior)|old.schema.tables.contains_key(*prior)).map(|(new,prior)|(new.clone(),prior.clone())).chain(old.schema.table_renames.iter().filter(|(new,prior)|!next.schema.tables.contains_key(*new)&&next.schema.tables.contains_key(*prior)).map(|(new,prior)|(prior.clone(),new.clone()))).collect();
     let aligned=align_current_schema(&old.schema,target,&next.schema,current,&aliases)?;
     fn implies(rule:&RuleExpr,policy:&RuleExpr,policies:&PolicyComparison<'_>)->bool{
-        policies.rule(rule,policy) || *rule==RuleExpr::Deny || *policy==RuleExpr::Allow || match rule {RuleExpr::And(xs)=>xs.iter().any(|r|implies(r,policy,policies)),_=>false}
+        policies.rule(rule,policy) || *rule==RuleExpr::Deny || *policy==RuleExpr::Allow
+            || matches!(rule,RuleExpr::And(xs) if xs.iter().any(|r|implies(r,policy,policies)))
+            || matches!(rule,RuleExpr::Or(xs) if xs.iter().all(|r|implies(r,policy,policies)))
+            || matches!(policy,RuleExpr::Or(xs) if xs.iter().any(|p|implies(rule,p,policies)))
+            || matches!(policy,RuleExpr::And(xs) if xs.iter().all(|p|implies(rule,p,policies)))
     }
     fn writes_column(value:&serde_json::Value,table:&str,column:&str,effect:&str,defaulted:bool)->bool {
         match value {
@@ -460,10 +464,31 @@ pub fn exact_write_authority(target:&[(String,String)],current:&[(String,String)
         source.push_str(&format!("\ninvariant {table}.{operation} only {}\n",policy.quarry()));
         let proof=crate::compile(&sources);if !proof.diagnostics.is_empty(){return false;}
         let comparison=PolicyComparison::new(&proof.schema,aligned);
-        let report=crate::security::analyze_rules(&proof);
-        report.invariants.iter().any(|v|v.status==crate::security::Status::Proved&&v.invariant.table==table&&v.invariant.operation.as_deref()==Some(operation)
-            &&v.invariant.policy.as_ref().is_some_and(|compiled|comparison.rule(compiled,policy))
-            &&v.invariant.requirements.iter().any(|require|comparison.rule(require,policy)))
+        // @ref LLP 3000.000.000#21-wave-27-release-semantics-rel — finite control flow preserves a stable leading guard; scope changes do not.
+        fn stable(rule:&RuleExpr)->bool {
+            use snapback4_core::schema::RuleTerm;
+            match rule {
+                RuleExpr::Exists{key,equalities,..}=>key.iter().chain(equalities.iter().map(|(_,t)|t)).all(|t|matches!(t,RuleTerm::Viewer|RuleTerm::Literal(_))),
+                RuleExpr::And(xs)|RuleExpr::Or(xs)=>xs.iter().all(stable),
+                RuleExpr::Eq(a,b)|RuleExpr::Ne(a,b)=>[a,b].iter().all(|t|matches!(t,RuleTerm::Viewer|RuleTerm::Literal(_))),
+                RuleExpr::Allow|RuleExpr::Deny=>true,_=>false,
+            }
+        }
+        fn opaque(value:&serde_json::Value)->bool {match value {
+            serde_json::Value::Object(m) if m.contains_key("Literal")=>false,
+            serde_json::Value::Object(m)=>m.keys().any(|k|matches!(k.as_str(),"JobAs"|"JobQuery"|"Emit"))||m.values().any(opaque),
+            serde_json::Value::String(s)=>matches!(s.as_str(),"JobAs"|"JobQuery"),
+            serde_json::Value::Array(xs)=>xs.iter().any(opaque),_=>false,
+        }}
+        let Some(program)=proof.programs.iter().find(|p|p.program.name==operation) else{return false};
+        if opaque(&serde_json::to_value(&program.program).unwrap()) {return false;}
+        // Unknown implicit writes cannot establish dependency stability.
+        if proof.schema.tables.values().any(|t|!t.maintained.is_empty()||!t.sequences.is_empty()||t.on_delete.values().any(|a|a.writes()))||!proof.schema.maintains.is_empty(){return false;}
+        let writes=snapback4_core::ir::write_tables(&program.program);
+        proof.invariants.iter().any(|inv|inv.table==table&&inv.operation.as_deref()==Some(operation)
+            &&inv.policy.as_ref().is_some_and(|compiled|comparison.rule(compiled,policy))
+            &&inv.requirements.iter().any(|require|stable(require)&&implies(require,policy,&comparison)
+                &&crate::security::kernel::dependencies(require).iter().all(|dependency|!writes.iter().any(|(t,_)|t==dependency))))
     }
     let policies=PolicyComparison::new(&old.schema,&aligned);
     for(name,current)in &aligned.tables {

exec
/bin/bash -lc "rg -n 'update_rule_judged|check_frozen|foreign|guard_population|exact' snapback4/crates/snapback4/src/verbs/releases.rs | head -50; rg -n 'rule probes|exists|read rule' snapback4/crates/snapback4-core/src/engine/rules.rs | head -30; sed -n '100,170p' snapback4/crates/snapback4-lang/src/bind/program/views.rs; rg -n 'present|optional.*if|if.*null' snapback4/crates/snapback4-lang/src/bind/intent_variants.rs | tail -30" in /home/ccheever/projects/sb4-b27-rel
 succeeded in 0ms:
195:        snapback4_lang::release_bridge::exact_write_authority(&target,&current).map_err(|e|format!("E_ADOPT: {e}"))?;
198:            snapback4_lang::release_bridge::exact_write_authority(&target,&source).map_err(|e|format!("E_ADOPT: latest source {latest}: {e}"))?;
624:            let view=if options.flags.contains_key("exact"){None}else{super::rollback_views::resolve(&dir,logical)?};
631:            if !options.flags.contains_key("exact"){selected_options.flags.insert("visible-rollback".into(),String::new());}
640:                if view.is_none() && !options.flags.contains_key("exact") && parent_predates_views(&dir.join("releases").join(active.to_string())) {
641:                    format!("{error}; this parent predates rollback views; deploy the current source with this CLI to register needed views, or explicitly select the historical workflow with `snapback4 rollback {} --to {logical} --exact` (preview its hiding with --check first)",dir.display())
647:                eprintln!("bridge starter written to {path}; follow ROLLBACK-CHECKLIST.md before exact rollback");
926:                    "--exact",
1024:        Some(view)=>serde_json::json!({"release":release,"source":view.target,"parent":view.parent,"view":release,"target":view.target,"exact":false}),
1025:        None=>serde_json::json!({"release":release,"source":release,"view":null,"target":release,"exact":true}),
1029:    if live["exact"]==true {println!("live: release {} = exact source {}",live["release"],live["source"]);}
36:    // is a separate decision; do not infer it merely from the public read rule.
127:/// A read rule `A or G` whose disjunct `G` reads no column of the row (a
128:/// role such as `exists staff[viewer]`, or a service seat) is true for every
135:/// target row must be readable by its own read rule once the probe key pins
143:/// The disjuncts of `scan`'s read rule that decide the page for a caller they
146:/// read (`pinned_probe_readable`), such as `exists boards[.board, owner =
223:/// `G` may be an `exists` probe (with the grant's named equalities, as
224:/// `exists staff[principal = viewer, role = 'manager']` lowers them) or a
226:/// A page guard on a pinned column (`exists boards[.board, owner = viewer]`
228:/// (`exists boards[b, owner = viewer]`) when that value is a literal,
345:/// an `exists` probe that holds.
354:    // @ref LLP 3000.036#14.1 — a guard `if exists A or exists B:` holds a grant on each alternative.
495:/// A disjunct whose row columns a page pins (`exists cats[.cat, owner =
497:/// row it probes, so a program's own `exists cats[cat, owner = viewer]` (which
539:            // The witness row's own read rule, decided by what the probe pins,
540:            // or carrying this very probe as a disjunct (`read <- exists staff[viewer]`).
627:/// Exhaustion is observable only when the authored read rule itself contains
1025:/// decide such as `exists boards[.board, owner = viewer]` under `.board = b`),
1026:/// only when they are every disjunct of the read rule that is not a party
1036:    // the read rule in the same domain, including exact boolean pins.
1185:/// Something that can answer an `exists`/`created` probe while a rule runs.
1198:    fn exists(&mut self, table: &str, index: &str, key: &[Value], equalities: &[(String, Value)]) -> Result<bool, crate::error::RuntimeError>;
1361:            probe.exists(table, index, &key, &equalities)
1393:        // @ref LLP 3000.007#17 — created facts with extra equalities take the metered exists path when the fact holds.
1425:        fn exists(&mut self, table: &str, _: &str, _: &[Value], _: &[(String,Value)]) -> Result<bool, crate::RuntimeError> {
1433:        let exists = |name: &str| RuleExpr::Exists { table: name.into(), index: "byId".into(), key: vec![], provenance: crate::ir::KeyProvenance::Const, equalities: vec![] };
1436:        for early in [exists("early"), created] {
1439:                    (RuleExpr::Or(vec![early.clone(), exists("stable")]), true, true, vec!["early", "stable"]),
1440:                    (RuleExpr::And(vec![early.clone(), exists("stable")]), false, false, vec!["early"]),
                    old.join(&ty).map_err(|error| self.join_error_many(error.at(&name), origins))?;
                    let joined = view_join(old, &ty).ok_or_else(|| type_error(&lane.site,
                        format!("view {} field {name}: {} conflicts with {} at {}", merge.table, ty.name(), old.name(), first_site.as_ref().unwrap()),
                        format!("project compatible values for {name} in every branch")).guide("reads"))?;
                    prior.insert(name, joined);
                }
            } else {
                first_site = Some(lane.site.clone());
                field_sources = fields.keys().map(|name| (name.clone(), vec![(fields[name].clone(), projection_source(lane, name))])).collect();
                result = Some(fields);
            }
            let project = if projection_setup.is_empty() { project } else { Expr::Block { body: projection_setup.code, value: Box::new(project) } };
            self.pop_scope();
            self.push_value_lane(&mut lanes, lane, MergeLane { guard, distinct, branch: lane.branch.clone(), setup: setup.code, scan, source, binding, project: Some(project) }, position)?;
        }
        if result.is_none() && !lanes.is_empty() {
            let planned = Merge { variant: self.variant(), position: None, view: None, order_keys: Vec::new(), site, lanes };
            // @ref LLP 3000.036.001#3 — the binding check: the runtime's own analysis must agree that every
            // lane is decided (a grant lane by a grant covering the rule) and that the lanes share one
            // position. Otherwise a page with a grant branch reads as written, the grant branch alone.
            if planned.branches() && !snapback4_core::engine::rules::branch_merge_lazy(self.schema, &planned)
                && let Some(read) = merge.lanes.iter().find(|lane| matches!(lane.branch.as_deref(), Some(ir::GRANT_LANE | ir::SYSTEM_LANE))).and_then(|lane| lane.planned.as_deref()) {
                // @ref LLP 3000.036.002#131-notes-and-declarations — declining a branch merge must preserve the caller's continuation.
                let mut original = read.clone();
                if let Some(range) = &mut original.range { range.cursor = merge.cursor.clone(); }
                return self.read(&original, out);
            }
            return Ok((Expr::Merge(planned), Ty::Page(merge.table.clone(), merge.take)));
        }
        let fields = match self.catalog.view_types.get(&merge.table) {
            Some(Ty::RowShape(fields)) => fields.clone(), _ => result.unwrap_or_default(),
        };
        let mut names = merge.view_order.clone();
        // Keep the projected order aligned with each branch's source scan,
        // including an explicitly ordered id before another field.
        if !names.iter().any(|name| name == "id") { names.push("id".into()); }
        let mut suffix = names.into_iter().map(|name| {
            let kind = fields.get(&name).and_then(cursor_kind).ok_or_else(|| type_error(&merge.site,
                format!("view order .{name} has no scalar column type"), "order by a field projecting a scalar source column in every branch"))?;
            Ok(snapback4_core::cursor::CursorColumn { name, kind })
        }).collect::<Fallible<Vec<_>>>()?;
        suffix.push(snapback4_core::cursor::CursorColumn { name: "$branch".into(), kind: snapback4_core::schema::ColumnType::Text { max: 1024 } });
        let position = ir::ViewPosition { take: merge.take, order: if merge.order == ast::Order::Asc { Order::Asc } else { Order::Desc }, after: cursor.map(|(value, _)| Box::new(value)), suffix };
        self.view_types.insert(merge.table.clone(), Ty::RowShape(fields.clone()));
        Ok((Expr::Merge(Merge { variant: self.variant(), position: Some(position), view: Some(merge.table.clone()), order_keys: merge.view_order.clone(), site, lanes }), Ty::Collection(Box::new(Ty::RowShape(fields)), merge.take)))
    }

    // @ref LLP 3000.013#2.1 — nullable membership is an ordinary filtered lane,
    // below source authorization; no null value is used as an index prefix.
    fn push_value_lane(&mut self, lanes: &mut Vec<MergeLane>, ast: &ast::MergeLane, mut lane: MergeLane, position: prefix::Position) -> Fallible<()> {
        if let Some((_, read)) = &ast.nulls
            && !matches!(&lane.source, Some(ir::LaneSource::Range { .. })) {
            let Some(ir::LaneSource::List { value, max }) = lane.source.take() else {
                return Err(type_error(&ast.site, "nullable in needs a bounded list", "use a bounded list argument or expression after in"));
            };
            let values = self.temp("lane_values");
            let nulls = self.temp("null_lane");
            let item = self.temp("lane_value");
            // Evaluate the list once, inside lane discovery so a cut/cap keeps
            // its existing incompleteness latch. Record at most one null lane.
            lane.source = Some(ir::LaneSource::List { max, value: Expr::Block { body: vec![
                Stmt::Let { name: values.clone(), value },
                Stmt::Let { name: nulls.clone(), value: Expr::Array(Vec::new()) },
                Stmt::For { binding: item.clone(), domain: LoopDomain::ArgList { name: values.clone(), max }, body: vec![
                    Stmt::If { condition: Expr::Binary { op: BinaryOp::Eq, left: Box::new(ir::var(&item)), right: Box::new(ir::lit(Value::Null)) },
                        then_body: vec![Stmt::Push { target: nulls.clone(), value: ir::lit(Value::Bool(true)) }, Stmt::Break], else_body: Vec::new() },
                ] },
            ], value: Box::new(ir::var(&values)) } });
            let mut setup = setup::Body::default();
            let mut read = *read.clone();
            if let Some(range) = &mut read.range { range.cursor = None; }
202:        let mut present = required.clone();
203:        if let Some((PRESENT, Expr::Name { name, .. })) = self::condition(condition) { present.insert(name.clone()); }
204:        Expr::If { then: Box::new(lift(name, &yes, site, tables, &present)), condition: condition.clone(), otherwise: Box::new(lift(name, &no, site, tables, required)), site: branch.clone() }
276:            required.extend(names.iter().zip(bits).filter(|(_, present)| **present).map(|(name, _)| name.clone()));

exec
/bin/bash -lc "rg -n 'reserved|viewer.*(arg|bind)|name == \"viewer\"|\"viewer\" =>' snapback4/crates/snapback4-lang/src/bind/program.rs snapback4/crates/snapback4-lang/src/bind/program/*.rs snapback4/crates/snapback4-lang/src/bind/*.rs | head -100; rg -n 'fn name\\(|fn bind_rule|fn rule_term' snapback4/crates/snapback4-lang/src/bind/program.rs snapback4/crates/snapback4-lang/src/bind/schema.rs; sed -n '300,390p' snapback4/crates/snapback4-lang/src/bind/program.rs; sed -n '870,935p' snapback4/crates/snapback4-lang/src/bind/schema.rs" in /home/ccheever/projects/sb4-b27-rel
 succeeded in 0ms:
snapback4/crates/snapback4-lang/src/bind/program/maintain_types.rs:293:        A::Name { name, .. } if name == "viewer" => Some(RuleTerm::Viewer),
snapback4/crates/snapback4-lang/src/bind/actions.rs:91:        let reserved = ["SNAPBACK_", "SNAPBACK4_", "NODE_", "DYLD_", "LD_", "LC_"].iter().any(|prefix| secret.starts_with(prefix))
snapback4/crates/snapback4-lang/src/bind/actions.rs:93:        if !valid || reserved {
snapback4/crates/snapback4-lang/src/bind/actions.rs:94:            return Err(type_error(site, format!("secret {secret} must be an uppercase environment name outside the runtime's reserved names"), "secrets [MAIL_API_KEY]").guide("actions"));
snapback4/crates/snapback4-lang/src/bind/actions.rs:118:            let viewer = |e: &A| matches!(e, A::Name { name, .. } if name == "viewer");
snapback4/crates/snapback4-lang/src/bind/actions.rs:128:    type_error(expr.site(), "an action rule compares viewer with a principal; it cannot read data or arguments", "action invite(email: text <=200) <- viewer = 'service:worker'  -- or allow / deny").guide("actions")
snapback4/crates/snapback4-lang/src/bind/rule_helpers.rs:35:        Expr::Name {name,..} if name == "viewer" => Some(Ty::Principal),
snapback4/crates/snapback4-lang/src/bind/rule_composition.rs:87:            (TypeKind::Principal, Expr::Name { name, .. }) => name == "viewer",
snapback4/crates/snapback4-lang/src/bind/rule_composition.rs:134:            let pair = |a: &Expr, b: &Expr| matches!(a, Expr::Name { name, .. } if name == "viewer")
snapback4/crates/snapback4-lang/src/bind/rule_composition.rs:171:        Expr::Name { name, .. } if name == "viewer" => Some("viewer".into()),
snapback4/crates/snapback4-lang/src/bind/maintains.rs:140:        if !names.insert(field.clone()) { return Err(refusal(key.site(), format!("maintain output name {field} is duplicated or reserved"), "use distinct bare keys and at most one day, hour and bucket key; id and value are reserved")); }
snapback4/crates/snapback4-lang/src/bind/program/system_principal.rs:1://! A write whose value can only be the reserved system principal is refused
snapback4/crates/snapback4-lang/src/bind/program/system_principal.rs:23:            if let Some(cause) = reserved(value, job) {
snapback4/crates/snapback4-lang/src/bind/program/system_principal.rs:33:                    Some(A::Name { name, .. }) if job && name == "viewer" => "this insert omits it and its `default viewer` is the system in a job",
snapback4/crates/snapback4-lang/src/bind/program/system_principal.rs:34:                    Some(value) if reserved(value, false).is_some() => "this insert omits it and its default is the literal 'system'",
snapback4/crates/snapback4-lang/src/bind/program/system_principal.rs:54:fn reserved(value: &A, job: bool) -> Option<&'static str> {
snapback4/crates/snapback4-lang/src/bind/program/system_principal.rs:57:        A::Name { name, .. } if job && name == "viewer" => Some("this writes `viewer`, which in a job (outside `as`) is the system"),
snapback4/crates/snapback4-lang/src/bind/program/system_principal.rs:58:        A::Array { items, .. } => items.iter().find_map(|item| reserved(item, job)),
snapback4/crates/snapback4-lang/src/bind/program/system_principal.rs:70:        format!("{table}.{column} cannot store the reserved system principal, and {cause}: the write can never succeed and {}", if job { "would park the job at runtime" } else { "would refuse with E_INPUT at runtime" }), rewrite)
snapback4/crates/snapback4-lang/src/bind/program/objects.rs:37:                    "pending is the device's row metadata", "omit pending from the object; it is preserved from the spread row"));
snapback4/crates/snapback4-lang/src/bind/program/objects.rs:128:                // in the object so existing device provenance is preserved.
snapback4/crates/snapback4-lang/src/bind/pin_rewrite.rs:131:        parts.len() > 1 && parts.iter().all(|part| matches!(part, A::Binary { op, left, right, .. } if op == "=" && matches!(right.as_ref(), A::Name { name, .. } if name == "viewer") && matches!(left.as_ref(), A::Member { base, .. } if matches!(base.as_ref(), A::Focal { .. }))))
snapback4/crates/snapback4-lang/src/bind/timeline.rs:185:        return Err(refusal(decl, "E_TIMELINE_SHAPE", "reserved timeline follower index differs from its canonical definition", "restore the compiler-owned follower index; declare application indexes under a separate name"));
snapback4/crates/snapback4-lang/src/bind/timeline.rs:195:    fn reserved_follower_index_requires_its_exact_definition() {
snapback4/crates/snapback4-lang/src/bind/program.rs:1093:                if types.contains_key("pending") { return Err(type_error(site, "pending is the device's row metadata", "omit pending from the shape; it is preserved from the row")); }
snapback4/crates/snapback4-lang/src/bind/program.rs:1460:        return Err(Diagnostic::new(site, "E_OP_RESERVED", format!("application refusal code {code} uses the reserved E_ namespace"), code.trim_start_matches("E_").to_owned()).guide("programs"));
snapback4/crates/snapback4-lang/src/bind/program/snapshot_authority.rs:35:            A::Name { name, .. } => name == "viewer" || self.binding(name).is_some_and(|binding| binding.parameter),
snapback4/crates/snapback4-lang/src/bind/generated.rs:51:            if name == "viewer" {
snapback4/crates/snapback4-lang/src/bind/write_affordances.rs:10:    let name = |e: &Expr| matches!(e, Expr::Name { name,.. } if name == "viewer");
snapback4/crates/snapback4-lang/src/bind/program/constraints.rs:93:        let example = format!("declare one row per reserved unit with `unique resource, unit else TAKEN`, then insert those rows inside `{}`", self.program.name);
snapback4/crates/snapback4-lang/src/bind/feed_view.rs:27:fn viewer(value: &Expr) -> bool { matches!(value, Expr::Name { name, .. } if name == "viewer") }
snapback4/crates/snapback4-lang/src/bind/audience_diagnostics.rs:97:            let probe = format!("exists {target}[{}viewer]", binding.columns.iter().map(|column| format!(".{column}, ")).collect::<String>());
snapback4/crates/snapback4-lang/src/bind/audience_diagnostics.rs:108:                    else { format!("`.{} = viewer` alone lets anyone join", binding.principal) }),
snapback4/crates/snapback4-lang/src/bind/audience_diagnostics.rs:125:                format!("{rewrite}; for a production staff roster, replace its insert rule with `insert <- viewer = 'service:ops' or {probe}`. A minimal roster recipe using your writable fields is below; apply it in the existing schema, retaining referenced tables, other constraints and write rules:\n\nuse identity password\ntable {target}:\n{fields}\n  unique {}\n  immutable {}\n  read <- {} or viewer = 'service:ops'\n  insert <- viewer = 'service:ops' or {probe}\n  {residency}\n\nmutation {operation}({args}):\n  return insert {target} {{ {payload} }}\n\nMint `snapback4 token --service ops --release ./deployment` locally against that store; call {operation} with the signed-up account principal and its bearer seat token. Service grants add no device audience (guide deploy).",
snapback4/crates/snapback4-lang/src/bind/intent_lanes.rs:93:        Expr::Name { name, .. } if name == "viewer" => Some((Ty::Principal, false)),
snapback4/crates/snapback4-lang/src/bind/mod.rs:928:                Some(format!(" For parent-scoped history, reading {parent}[{argument}] alone does not prove a copied child audience. If the whole parent audience is intended, declare read through .{reference}; for a parent-owner branch, declare exists {parent}[.{reference}, {owner} = viewer] in the child's read rule and guard its page with require exists {parent}[{argument}, {owner} = viewer] else FORBIDDEN (guide recipes)."))
snapback4/crates/snapback4-lang/src/bind/receipts.rs:72:                    "receipt {role} mapping `{name}` is reserved expression or scalar-type syntax"
snapback4/crates/snapback4-lang/src/bind/receipts.rs:161:                format!("receipt {role} mapping `{name}` is reserved expression syntax"),
snapback4/crates/snapback4-lang/src/bind/program/read_diagnostics.rs:106:        if matches!(value, A::Name { name, .. } if name == "viewer" || self.binding(name)
snapback4/crates/snapback4-lang/src/bind/program/reads.rs:302:        A::Exists { read, .. } => read.keys.iter().any(|key| matches!(&key.value, A::Name { name, .. } if name == "viewer"))
snapback4/crates/snapback4-lang/src/bind/auth_lints.rs:147:fn is_viewer(expr: &Expr) -> bool { matches!(expr, Expr::Name { name, .. } if name == "viewer" || name == "$input:viewer") }
snapback4/crates/snapback4-lang/src/bind/auth_lints.rs:735:                        || key.len() == 1 && key[0] == "viewer" && target.columns().len() == 1
snapback4/crates/snapback4-lang/src/bind/auth_lints.rs:1033:                if is_viewer(arg) || (!readonly && !matches!(arg, Expr::Name { .. })) { continue; }
snapback4/crates/snapback4-lang/src/bind/auth_lints.rs:1058:            if is_viewer(arg) { out.insert(format!("({} = viewer)", param.name)); }
snapback4/crates/snapback4-lang/src/bind/defaults.rs:26:        Expr::Name { name, .. } if name == "viewer" && matches!(decl.type_.kind, TypeKind::Principal) => ColumnDefault::Viewer,
snapback4/crates/snapback4-lang/src/bind/program/pure_calls.rs:30:            A::Name { name, .. } if name == "viewer" => Some(Stable::Viewer),
snapback4/crates/snapback4-lang/src/bind/intent_branches.rs:345:        let non_null = matches!(&key.value, Expr::Name { name, .. } if name == "viewer")
snapback4/crates/snapback4-lang/src/bind/intent_branches.rs:631:fn is_viewer(value: &Expr) -> bool { matches!(value, Expr::Name { name, .. } if name == "viewer") }
snapback4/crates/snapback4-lang/src/bind/schema.rs:505:    sync_error(&sync.site, format!("sync cannot infer an audience from `{source}`: a synced table's read rule must be `public`, `.column = viewer`, `exists target[.columns, viewer]`, or an `or` of whole `.column = viewer` disjuncts and at most one `exists target[.columns, viewer]`, so each device holds every row its viewer may read and no other; do not make private rows public to get past this"), audience_split(catalog, info, rule))
snapback4/crates/snapback4-lang/src/bind/schema.rs:834:        Expr::Name { name, .. } if name == "viewer" => Ok((RuleTerm::Viewer, Ty::Principal)),
snapback4/crates/snapback4-lang/src/bind/program.rs:1093:                if types.contains_key("pending") { return Err(type_error(site, "pending is the device's row metadata", "omit pending from the shape; it is preserved from the row")); }
snapback4/crates/snapback4-lang/src/bind/program.rs:1460:        return Err(Diagnostic::new(site, "E_OP_RESERVED", format!("application refusal code {code} uses the reserved E_ namespace"), code.trim_start_matches("E_").to_owned()).guide("programs"));
snapback4/crates/snapback4-lang/src/bind/schema.rs:607:pub fn bind_rule(catalog: &Catalog, info: &TableInfo, rule: &RuleDecl) -> Fallible<RuleExpr> {
snapback4/crates/snapback4-lang/src/bind/schema.rs:831:fn rule_term(catalog: &Catalog, info: &TableInfo, expr: &Expr, bindings: &RuleBindings) -> Fallible<(RuleTerm, Ty)> {
                }
                Err(diagnostic) => {
                    binder.record_error(diagnostic);
                    failed = true;
                }
            }
            // @ref LLP 3000.025#3-proposed-rule — include payload and helper setup in the enclosing source statement.
            statement_ends.push(body.len());
        }
        if failed {
            binder.append_errors(diagnostics);
            return None;
        }
        // The interpreter returns null when control reaches the end. Include
        // that observable path in the generated result type; a return nested
        // in one branch or in a possibly-empty loop does not cover it.
        if !control::exits(&body) {
            if decl.kind == ProgramKind::Query {
                binder.notes.push(read_diagnostics::fallthrough(decl));
            }
            binder.returns.push((Ty::Null, A::Literal { value: Literal::Null, site: decl.site.clone() }));
        }
        let result = match binder.return_type() {
            Ok(ty) => ty,
            Err(error) => { diagnostics.push(error); return None; }
        };
        let full_name = super::operation_name(module, &decl.name);
        let kind = match decl.kind {
            ProgramKind::Query => ir::ProgramKind::Query,
            ProgramKind::Mutation => ir::ProgramKind::Mutation,
            ProgramKind::Job => ir::ProgramKind::Job,
        };
        let ownership = body.ownership;
        let returned_shapes = returned_shapes::marks(&body.code, &full_name, &shape_candidates);
        let program = Program { name: full_name, kind, args, arg_aliases, read_time_granularity_ms: None, body: body.code, native: false, returned_shapes };
        if kind == ir::ProgramKind::Query
            && let Some((work, allowance)) = snapback4_core::engine::rules::bounded_query_work(schema, &program)
            && work >= allowance {
            binder.notes.push(Diagnostic::new(&decl.site, "N_QUERY_RESERVATION",
                format!("query {}: one executable path reserves {work} physical authorization reads, leaving no room in the {allowance}-read allowance; its bounded pages return an empty partial answer before opening", decl.name),
                "reduce the declared population caps or split independent reads into separate queries; mutually exclusive returning branches already share a reservation; loops retain the sum of their static reads").guide("reads"));
        }
        // @ref LLP 3000.036#17.8 — a total behind its grant's guard is the holder's whole total, as the server computes it.
        let mut refused = false;
        for (site, diagnostic) in std::mem::take(&mut binder.pending_totals) {
            let guarded = ir::scans(&program).into_iter().filter(|scan| scan.site == site).all(|scan| snapback4_core::engine::rules::grant_dominated(schema, &program, scan));
            if !guarded { diagnostics.push(diagnostic); refused = true; }
        }
        if refused { return None; }
        let presence = if kind == ir::ProgramKind::Mutation {
            Some(super::residency::presence_facts(schema, &program, &ownership, &binder.presence_sources))
        } else { None };
        Some(BoundProgram { maintenance_scopes: binder.maintenance_scopes, statement_ends, page_sources: binder.page_sources, canonical_sources: binder.canonical_sources, constraint_domains: binder.constraint_domains, filters: binder.filters, view_types: binder.view_types, selections: binder.selections, sources: binder.sources, receipt_sources: binder.receipt_sources, receipt_returns: binder.receipt_returns, implicit_write_results: binder.implicit_write_results, timeline_scans: binder.timeline_scans, program, presence, module: module.to_owned(), args: arg_types, result, notes: binder.notes, site: decl.site.clone(), job_bound_helpers: binder.job_bound_helpers })
    }

    fn site(&mut self) -> String {
        self.sites += 1;
        format!("programs.{}.{}", self.name, self.sites - 1)
    }

    fn temp(&mut self, hint: &str) -> String {
        self.temps += 1;
        format!("${hint}{}", self.temps)
    }

    fn lookup(&self, name: &str) -> Option<&Ty> {
        self.binding(name).map(|binding| &binding.ty)
    }

    fn binding(&self, name: &str) -> Option<&Binding> {
        self.scopes.iter().rev().find_map(|scope| scope.get(name))
    }

    fn declare(&mut self, name: &str, ty: Ty) -> String {
        let runtime = if name.starts_with('$') { name.to_owned() } else { self.temp(name) };
        self.scopes.last_mut().expect("a scope").insert(name.to_owned(), Binding { runtime: runtime.clone(), declared: ty.clone(), ty, parameter: false, revision: 0, fields: BTreeMap::new(), error: None, origins: Vec::new(), inline: None });
        runtime
    }

    // @ref LLP 3000.015#3 — one maintenance type per helper declaration across all calls.
    fn maintenance_local(&mut self, runtime: &str, site: &Site, name: &str) {
        if self.depth > 0 {
            self.maintenance_scopes.insert(runtime.into(), format!("helper/{}/local/{site}/{name}", self.call_chain.last().unwrap().0));
        }
    }

    fn push_scope(&mut self) {
        self.scopes.push(BTreeMap::new());
    }

    fn pop_scope(&mut self) {
            Literal::Bool(b) => (RuleTerm::Literal(Value::Bool(*b)), Ty::Bool),
            Literal::Null => (RuleTerm::Literal(Value::Null), Ty::Null),
        }),
        Expr::Unary { op, value, .. } if op == "-" => {
            let (term, _) = rule_term(catalog, info, value, bindings)?;
            match term {
                RuleTerm::Literal(Value::Int(n)) => Ok((RuleTerm::Literal(Value::Int(-n)), Ty::Int)),
                _ => Err(type_error(site, "a negative rule literal needs an integer", "compare .column with an integer literal")),
            }
        }
        other => {
            let _ = catalog;
            Err(unknown(site, format!("`{}` is not a rule term", crate::print::expression(other)), "compare .column with viewer or a literal"))
        }
    }
}

fn column_ty(info: &TableInfo, name: &str) -> Option<Ty> {
    if name == "id" {
        return Some(Ty::Ref(info.decl.name.clone()));
    }
    info.columns.get(name).or_else(|| info.captures.get(name)).map(Ty::from_scalar)
}

/// Final-insert obligations retain their exact-index write-path contract.
/// Ordinary effect rules use `probe` with residual equalities enabled.
pub fn bind_probe(catalog: &Catalog, info: &TableInfo, read: &ReadExpr, site: &Site, update: bool) -> Fallible<(String, String, Vec<RuleTerm>)> {
    let bindings = RuleBindings { old: None, next: None, update, insert: false, hops: true, present: Vec::new() };
    let (table, index, key, _) = probe(catalog, info, read, site, &bindings, false).map_err(|mut error| {
        if error.code == "E_QUARRY_RULE_HOP" { error.rewrite = reference::reference_rewrite(catalog, info, &Expr::Exists { read: read.clone(), site: site.clone() }); }
        error
    })?;
    Ok((table, index, key))
}

fn probe(catalog: &Catalog, info: &TableInfo, read: &ReadExpr, site: &Site, bindings: &RuleBindings, extras: bool) -> Fallible<(String, String, Vec<RuleTerm>, Vec<(String, RuleTerm)>)> {
    if catalog.tables.get(&read.table).is_some_and(|t| t.decl.ephemeral.is_some()) {
        return Err(Diagnostic::new(site, "E_QUARRY_EPHEMERAL", format!("a rule or after insert cannot probe ephemeral table {}", read.table), "probe a durable table instead").guide("ephemeral"));
    }
    // @ref LLP 3000.013.001#3-global-maintained-view-representation — rules
    // and postconditions must not recover the compiler-owned physical row.
    if catalog.tables.get(&read.table).and_then(|table| table.maintained.as_ref())
        .is_some_and(|maintain| maintain.by.is_empty())
    {
        return Err(type_error(site, format!("{} is one global maintained scalar, not a rule-probe table", read.table),
            format!("read `{}` as a scalar in a query; keep rules over application tables", read.table)).guide("maintains"));
    }
    // `exists pieces[.id = .piece, …]`: a comparison where a key belongs. Name
    // the column (`id = .piece`) or give the full unique key by position first.
    // @ref LLP 3000.036#11 — app-farm pattern 27: the positional unique-key form.
    for key in &read.keys {
        if let Expr::Binary { op, left, right, .. } = &key.value && op == "="
            && let Expr::Member { base, name, .. } = left.as_ref() && matches!(base.as_ref(), Expr::Focal { .. }) {
            let others: Vec<String> = read.keys.iter().filter(|other| !std::ptr::eq(*other, key)).map(|other| match &other.column {
                Some(column) => format!("{column} = {}", crate::print::expression(&other.value)),
                None => crate::print::expression(&other.value),
            }).collect();
            let value = crate::print::expression(right);
            let positional = if name == "id" { std::iter::once(value.clone()).chain(others.iter().cloned()).collect::<Vec<_>>().join(", ") } else { std::iter::once(format!("{name} = {value}")).chain(others.iter().cloned()).collect::<Vec<_>>().join(", ") };
            return Err(unknown(&key.site, format!("`.{name} = {value}` is a comparison inside a probe key; in {}[..] a key names a column without a dot (`{name} = {value}`), or gives a full unique key by position first", read.table),
                format!("exists {}[{positional}]", read.table)).guide("rules"));
        }
    }
    let mixed = read.keys.iter().any(|key| key.column.is_some()) && read.keys.iter().any(|key| key.column.is_none());
    let types = if mixed { Some(read.keys.iter().take_while(|key| key.column.is_none()).map(|key| rule_term(catalog, info, &key.value, bindings)
        .map(|(term, ty)| (ty, matches!(term, RuleTerm::Literal(Value::String(_)))))).collect::<Fallible<Vec<_>>>()?) } else { None };

exec
/bin/bash -lc "rg -n 'fn name\\(' snapback4/crates/snapback4-lang/src/bind/program* -g '*.rs'; sed -n '155,285p' snapback4/crates/snapback4-lang/src/bind/program.rs; sed -n '830,869p' snapback4/crates/snapback4-lang/src/bind/schema.rs; rg -n 'viewer' snapback4/crates/snapback4-lang/src/parser/programs.rs snapback4/crates/snapback4-lang/src/parser.rs snapback4/crates/snapback4-lang/src/bind/program/expr.rs | tail -20" in /home/ccheever/projects/sb4-b27-rel
 succeeded in 0ms:
snapback4/crates/snapback4-lang/src/bind/program/expr.rs:319:    pub(super) fn name(&mut self, name: &str, site: &Site) -> Fallible<(Expr, Ty)> {
struct Binding {
    runtime: String,
    /// Compiler-only write-spread aliases retain property presence until assembly.
    inline: Option<Expr>,
    ty: Ty,
    declared: Ty,
    parameter: bool,
    revision: u32,
    fields: BTreeMap<Vec<String>, Ty>,
    /// An invalid binding retains its original cause; its unknown type never escapes compilation.
    error: Option<Diagnostic>,
    /// Original operands for a diagnostic rewrite, never type or runtime provenance.
    origins: Vec<(Ty, A)>,
}

#[derive(Clone, Default)]
struct LoopTransfers {
    /// Binding state is keyed by runtime identity so a same-named loop item
    /// cannot hide an outer local from the header or exit meet.
    breaks: Vec<BTreeMap<String, Binding>>,
    continues: Vec<BTreeMap<String, Binding>>,
}

const MAX_EXPANSION_DEPTH: u32 = 8;
const MENTION_MAX: u32 = 64;

impl<'a> Binder<'a> {
    pub fn bind(catalog: &'a Catalog, schema: &'a snapback4_core::schema::Schema, module: &str, decl: &ast::ProgramDecl, diagnostics: &mut Vec<Diagnostic>) -> Option<BoundProgram> {
        Self::bind_with_ownership(catalog, schema, module, decl, diagnostics, true)
    }

    /// Differential-test control: lowering is identical with the side map disabled.
    #[doc(hidden)]
    pub fn bind_with_ownership(catalog: &'a Catalog, schema: &'a snapback4_core::schema::Schema, module: &str, decl: &ast::ProgramDecl, diagnostics: &mut Vec<Diagnostic>, record_ownership: bool) -> Option<BoundProgram> {
        Self::bind_context(catalog,schema,module,decl,diagnostics,record_ownership,false)
    }
    pub(super) fn bind_historical(catalog:&'a Catalog,schema:&'a snapback4_core::schema::Schema,module:&str,decl:&ast::ProgramDecl,diagnostics:&mut Vec<Diagnostic>)->Option<BoundProgram>{
        Self::bind_context(catalog,schema,module,decl,diagnostics,true,true)
    }
    fn bind_context(catalog:&'a Catalog,schema:&'a snapback4_core::schema::Schema,module:&str,decl:&ast::ProgramDecl,diagnostics:&mut Vec<Diagnostic>,record_ownership:bool,historical:bool)->Option<BoundProgram>{
        let mut binder = Binder { historical, viewer_depth: None, maintenance_scopes: BTreeMap::new(), pure_functions: BTreeMap::new(), call_types: BTreeMap::new(), page_sources: BTreeMap::new(), canonical_sources: BTreeMap::new(), constraint_domains: Default::default(), filters: BTreeMap::new(), variants: Vec::new(), view_types: BTreeMap::new(), sources: BTreeMap::new(), selections: BTreeMap::new(), presence_sources: Vec::new(), receipt_sources: Vec::new(), receipt_returns: Vec::new(), implicit_write_results: Vec::new(), catalog, schema, name: decl.name.clone(), kind: decl.kind, caller_kind: decl.kind, call_chain: Vec::new(), job_bound_helpers: Default::default(), scopes: vec![BTreeMap::new()], focal: None, in_predicate: false, returned_data: false, shape_field: None, temps: 0, sites: 0, returns: Vec::new(), depth: 0, loops: 0, loop_transfers: Vec::new(), caller_loops: 0, in_prelude: false, total: None, record_ownership, expanding_feed: None, timeline_scans: Default::default(), notes: Vec::new(), may_have_written: false, errors: Vec::new(), pending_totals: Vec::new() };
        binder.call_chain.push((super::operation_name(module, &decl.name), decl.site.clone()));
        binder.declare(pure_calls::CONSTANTS, Ty::Null);
        let mut args = BTreeMap::new();
        let mut arg_aliases = BTreeMap::new();
        let mut arg_types = Vec::new();
        let mut defaults = setup::Body::default();
        let canonical_names: std::collections::BTreeSet<_> = decl.args.iter().map(|arg| arg.name.as_str()).collect();
        for arg in &decl.args {
            if args.contains_key(&arg.name) {
                diagnostics.push(unknown(&arg.site, format!("duplicate argument {}", arg.name), "rename one argument"));
                return None;
            }
            if let ast::TypeKind::Ref { table } = &arg.type_.kind
                && !catalog.tables.contains_key(table)
            {
                diagnostics.push(type_error(&arg.site, format!("argument {} references unknown table {table}", arg.name), name_rewrite(table, catalog.tables.keys().map(String::as_str), None)));
                return None;
            }
            if let Some(alias) = &arg.alias {
                if canonical_names.contains(alias.as_str()) {
                    diagnostics.push(unknown(&arg.site, format!("argument alias {alias} collides with a canonical argument"), "choose a legacy name that is not otherwise declared in this operation").guide("deploy"));
                    return None;
                }
                if let Some(previous) = arg_aliases.insert(alias.clone(), arg.name.clone()) {
                    diagnostics.push(unknown(&arg.site, format!("argument alias {alias} is already used by {previous}"), "give each canonical argument a distinct legacy name").guide("deploy"));
                    return None;
                }
            }
            let ty = if arg.default.is_some() {Ty::from_scalar(&arg.type_).required()} else {Ty::from_scalar(&arg.type_)};
            let (wire_type, default) = match super::operation_evolution::argument(arg, schema) {
                Ok(value) => value,
                Err(error) => {diagnostics.push(error);return None;}
            };
            let runtime = if let Some(value)=default {
                let runtime=binder.temp("argumentDefault");
                defaults.push(Stmt::Let {name:runtime.clone(),value:ir::var(&arg.name)});
                let mut fallback=setup::Body::default();
                fallback.push(Stmt::Assign {name:runtime.clone(),value:Expr::Literal(value)});
                defaults.push_if(Expr::Binary {op:ir::BinaryOp::Eq,left:Box::new(ir::var(&runtime)),right:Box::new(Expr::Literal(Value::Null))},fallback,setup::Body::default());
                runtime
            } else {arg.name.clone()};
            if !arg.deprecated { binder.scopes[0].insert(arg.name.clone(), Binding { runtime, ty: ty.clone(), declared: ty.clone(), parameter: true, revision: 0, fields: BTreeMap::new(), error: None, origins: Vec::new(), inline: None });
            }
            args.insert(arg.name.clone(), wire_type);
            arg_types.push((arg.name.clone(), if arg.default.is_some() || arg.deprecated {ty.optional()} else {ty}));
        }
        if decl.native {
            // The body is the app's Rust (LLP 3000.005): nothing to bind, the
            // module is checked against the declaration by `check`.
            let full_name = super::operation_name(module, &decl.name);
            let (kind, result) = match decl.kind {
                ProgramKind::Query => (ir::ProgramKind::Query, Ty::Json),
                _ => (ir::ProgramKind::Job, Ty::Null),
            };
            return Some(BoundProgram { maintenance_scopes: binder.maintenance_scopes, statement_ends: Vec::new(), page_sources: binder.page_sources, canonical_sources: binder.canonical_sources, constraint_domains: binder.constraint_domains, filters: binder.filters, view_types: binder.view_types, selections: binder.selections, sources: binder.sources, receipt_sources: binder.receipt_sources, receipt_returns: binder.receipt_returns, implicit_write_results: binder.implicit_write_results, timeline_scans: binder.timeline_scans, program: Program { name: full_name, kind, args, arg_aliases, read_time_granularity_ms: None, body: Vec::new(), native: true, returned_shapes: Default::default() }, presence: None, module: module.to_owned(), args: arg_types, result, notes: binder.notes, site: decl.site.clone(), job_bound_helpers: binder.job_bound_helpers });
        }
        let mut body = defaults;
        let mut shape_candidates = Vec::new();
        let mut statement_ends = Vec::new();
        let mut failed = false;
        let count = decl.body.len();
        let arguments = binder.scopes.clone();
        for (index, statement) in decl.body.iter().enumerate() {
            if decl.kind == ProgramKind::Job {
                binder.scopes = arguments.clone();
                binder.push_scope();
                binder.in_prelude = true;
                let mut prelude = setup::Body::default();
                for statement in &decl.prelude {
                    if let Err(diagnostic) = binder.statement(statement, &mut prelude, false) {
                        binder.record_error(diagnostic);
                        binder.append_errors(diagnostics);
                        return None;
                    }
                }
                binder.in_prelude = false;
                if !prelude.is_empty() {
                    // @ref LLP 3000.007#5.2 — each sweep carries its prelude as setup in the existing serialized statement vocabulary.
                    body.push_if(Expr::Literal(Value::Bool(true)), prelude, setup::Body::default());
                }
            }
            match binder.statement(statement, &mut body, index + 1 == count) {
                Ok(()) => {
                    if decl.kind == ProgramKind::Query && let S::Return { value: A::Shape { base, .. }, .. } = statement
                        && matches!(base.as_ref(), A::Read(_) | A::Merge(_) | A::Name { .. }) {
                        shape_candidates.push(body.len().saturating_sub(2));
                    }
                    // Binding a chunk prefix may hoist setup statements. The
                    // chunk itself is the final statement emitted for this
                    // declaration, so validate that scan directly instead of

fn rule_term(catalog: &Catalog, info: &TableInfo, expr: &Expr, bindings: &RuleBindings) -> Fallible<(RuleTerm, Ty)> {
    let site = expr.site();
    match expr {
        Expr::Name { name, .. } if name == "viewer" => Ok((RuleTerm::Viewer, Ty::Principal)),
        Expr::Member { base, name, .. } => match base.as_ref() {
            Expr::Read(read) if read.keys.len() == 1 && read.keys[0].column.as_deref().is_none_or(|c| c == "id")
                && read.range.is_none() && read.filter.is_none() && read.matching.is_none()
                && read.index.is_none() && read.seeks.is_empty() => {
                let result = rule_reference(catalog, info, &read.keys[0].value, name, bindings, site)?;
                if result.0.references().last().is_some_and(|(table, _)| table == read.table) { Ok(result) }
                else { Err(type_error(site, "the lookup table differs from the reference type", "use the reference's declared table")) }
            }
            Expr::Focal { .. } => {
                if bindings.update && bindings.old.is_some() {
                    return Err(unknown(site, "an update (old, next) rule names its images; . is not bound", format!("next.{name}")));
                }
                let ty = column_ty(info, name).ok_or_else(|| unknown(site, format!("rule reads undeclared column {}.{name}", info.decl.name), name_rewrite(name, info.columns.keys().map(String::as_str).chain(["id"]), None)))?;
                Ok((RuleTerm::Field(name.clone()), ty))
            }
            Expr::Name { name: binder, .. } if bindings.old.as_deref() == Some(binder) => {
                let ty = column_ty(info, name).ok_or_else(|| unknown(site, format!("rule reads undeclared column {}.{name}", info.decl.name), name_rewrite(name, info.columns.keys().map(String::as_str).chain(["id"]), None)))?;
                Ok((RuleTerm::OldField(name.clone()), ty))
            }
            Expr::Name { name: binder, .. } if bindings.next.as_deref() == Some(binder) => {
                let ty = column_ty(info, name).ok_or_else(|| unknown(site, format!("rule reads undeclared column {}.{name}", info.decl.name), name_rewrite(name, info.columns.keys().map(String::as_str).chain(["id"]), None)))?;
                Ok((RuleTerm::NextField(name.clone()), ty))
            }
            Expr::Name { name: binder, .. } if bindings.update && bindings.old.is_none()
                && matches!(binder.as_str(), "old" | "next") => Err(Diagnostic::new(site,
                    "E_QUARRY_RULE_OPERATOR",
                    format!("`{binder}.{name}` names a row image, but this update rule did not bind old and next"),
                    "write this as a named transition").guide("rules")),
            other => rule_reference(catalog, info, other, name, bindings, site),
        },
        Expr::Name { name, .. } if bindings.update && (bindings.old.as_deref() == Some(name) || bindings.next.as_deref() == Some(name)) => Err(unknown(site, format!("select a field of {name} explicitly"), format!("{name}.id"))),
        Expr::Name { name, .. } => Err(unknown(site, format!("`{name}` is not a rule term; rules read the row as .{name}"), format!(".{name}"))),
        Expr::Literal { value, .. } => Ok(match value {
            Literal::Str(text) => (RuleTerm::Literal(Value::String(text.clone())), Ty::Text(text.chars().count() as u32)),
            Literal::Number(text) => (RuleTerm::Literal(Value::Int(super::integer_literal(text, site)?)), Ty::Int),
snapback4/crates/snapback4-lang/src/bind/program/expr.rs:321:            "viewer" | "$input:viewer" => Ok((Expr::Input(Input::Viewer), Ty::Principal)),
snapback4/crates/snapback4-lang/src/bind/program/expr.rs:329:                if self.viewer_depth.is_some() { return Err(job_reads::read_only(site)); }
snapback4/crates/snapback4-lang/src/bind/program/expr.rs:346:                let declared: Vec<&str> = self.scopes.iter().flat_map(|s| s.keys().map(String::as_str)).chain(["viewer", "now", "new"]).collect();
snapback4/crates/snapback4-lang/src/parser.rs:503:                        if self.peek_at(1).value == "=" || self.at("viewer") || self.peek_at(2).value == "viewer" {
snapback4/crates/snapback4-lang/src/parser.rs:504:                            return Err(syntax_with(&site, format!("sync to {table}[...] names this row's group columns, never the viewer; a roster every member reads is the inferred audience"),
snapback4/crates/snapback4-lang/src/parser.rs:505:                                format!("read <- exists {table}[viewer] (a unique principal roster), then a bare `sync` line; or sync to {table}[.groupColumn] for a roster per group (guide sharing)")).guide("sharing"));

codex
The raw-equality shortcut can accept the same probe label after its indexed columns change. I also found an avoidable refusal in the leading-guard path: it prints the policy as Quarry and reparses it, losing named key information. I’ll check the binder’s ambiguity rule before finalizing that finding.
exec
/bin/bash -lc "sed -n '930,1050p' snapback4/crates/snapback4-lang/src/bind/schema.rs; rg -n 'ambiguous|positional|matches.len|candidates' snapback4/crates/snapback4-lang/src/bind/lookup.rs snapback4/crates/snapback4-lang/src/bind/point*.rs snapback4/crates/snapback4-lang/src/bind/brackets* snapback4/crates/snapback4-lang/src/bind/schema.rs | tail -55; rg -n 'unique.*principal|ambiguous' snapback4/crates/snapback4-lang/tests/rules* | head -35; sed -n '315,345p' snapback4/crates/snapback4-lang/src/bind/program/expr.rs" in /home/ccheever/projects/sb4-b27-rel
 succeeded in 0ms:
                format!("exists {}[{positional}]", read.table)).guide("rules"));
        }
    }
    let mixed = read.keys.iter().any(|key| key.column.is_some()) && read.keys.iter().any(|key| key.column.is_none());
    let types = if mixed { Some(read.keys.iter().take_while(|key| key.column.is_none()).map(|key| rule_term(catalog, info, &key.value, bindings)
        .map(|(term, ty)| (ty, matches!(term, RuleTerm::Literal(Value::String(_)))))).collect::<Fallible<Vec<_>>>()?) } else { None };
    let normalized = catalog.tables.get(&read.table).map(|target| super::mixed_keys::read_typed(target, read, catalog, types.as_deref())).transpose()?;
    let read = normalized.as_deref().unwrap_or(read);
    super::validate_key_names(read)?;
    if read.range.is_some() || !read.seeks.is_empty() || read.matching.is_some() || read.filter.is_some() { return Err(unknown(site, "a rule probe takes equalities, not a range", "exists t[key = .key]")); }
    let Some(target) = catalog.tables.get(&read.table) else {
        return Err(unknown(site, format!("exists probes unknown table {}", read.table), name_rewrite(&read.table, catalog.tables.keys().map(String::as_str), None)));
    };
    for key in &read.keys {
        if let Some(field) = &key.column { super::row_views::predicate_field(target, field, site)?; }
    }
    let mut terms = Vec::new();
    let mut types = Vec::new();
    for key in &read.keys {
        let (term, ty) = rule_term(catalog, info, &key.value, bindings)?;
        terms.push((key.column.clone(), term));
        types.push(ty);
    }
    let named: Option<Vec<String>> = if terms.iter().all(|(c, _)| c.is_some()) && !terms.is_empty() { Some(terms.iter().map(|(c, _)| c.clone().unwrap()).collect()) } else { None };
    // @ref LLP 3000.007#17 — an expiring maintain's physical value is not its live fact; only existence is a one-unit rule probe.
    if named.as_ref().is_some_and(|names| names.iter().any(|name| name == "value"))
        && catalog.maintains.get(&read.table).filter(|m| m.row_key.is_none()).and_then(|maintain| catalog.tables.get(&maintain.source)).is_some_and(|source| source.decl.expire.is_some() || source.through.as_ref().is_some_and(|t| t.expiring)) {
        return Err(Diagnostic::new(site, "E_QUARRY_LIVE_MAINTAIN_PROBE", format!("a rule cannot probe {}.value because its source expires", read.table),
            "read the view in the program; its live value cannot be probed at one unit").guide("expire"));
    }
    if let Some(names) = &named {
        for ((_, term), (column, ty)) in terms.iter_mut().zip(names.iter().zip(&mut types)) {
            let expected = column_ty(target, column).ok_or_else(|| unknown(site, format!("{} has no column {column}", read.table), name_rewrite(column, target.columns.keys().map(String::as_str).chain(["id"]), None)))?;
            if !ty.comparable(&expected) && !(expected.is_identity() && matches!(term, RuleTerm::Literal(Value::String(_)))) { return Err(type_error(site, format!("{column} is {}; {}.{column} is {}", ty.name(), read.table, expected.name()), format!("use {} for {column}", expected.name()))); }
            if expected.required().is_identity() && let RuleTerm::Literal(Value::String(text)) = term { *term = RuleTerm::Literal(Value::Id(text.clone())); *ty = Ty::Id; }
            if let (Ty::Enum(variants), RuleTerm::Literal(Value::String(text))) = (expected.required(), &*term) {
                if !variants.contains(text) { return Err(type_error(site, format!("'{text}' is not one of {}.{column}'s variants {}", read.table, variants.join(", ")), format!("'{}'", variants[0]))); }
            }
        }
    }
    if named.is_none() {
        let typed = types.iter().cloned().zip(terms.iter().map(|(_, term)| matches!(term, RuleTerm::Literal(Value::String(_))))).collect::<Vec<_>>();
        let declared = super::positional_keys::candidates(target, read, &typed, &catalog.synthesized);
        if declared.len() != 1 {
            return Err(super::positional_keys::refusal(target, read, &typed, &declared, catalog));
        }
        if read.index.is_none() {
            let mut selected = read.clone();
            selected.index = Some(declared[0].name.clone());
            return probe(catalog, info, &selected, site, bindings, extras);
        }
    }
    let mut candidates: Vec<&IndexDecl> = target
        .indexes
        .iter()
        .filter(|index| index.is_plain())
        .filter(|index| named.is_some() || !catalog.synthesized.contains(&(read.table.clone(), index.name.clone())))
        .filter(|index| match &read.index {
            Some(explicit) => &index.name == explicit,
            None => true,
        })
        .filter(|index| match &named {
            Some(names) => (index.columns.len() == names.len() && names.iter().all(|n| index.columns.contains(n))) || (extras && target.total_unique(index) && index.columns.iter().all(|column| names.contains(column))),
            None => (index.unique || read.index.is_some()) && index.columns.len() == terms.len(),
        })
        .filter(|index| {
            index.columns.iter().enumerate().all(|(position, column)| {
                let ty = match &named {
                    Some(names) => names.iter().position(|n| n == column).map(|p| &types[p]),
                    None => types.get(position),
                };
                let expected = if column == "id" { Ty::Ref(read.table.clone()) } else { target.columns.get(column).map(Ty::from_scalar).unwrap_or(Ty::Unknown) };
                ty.is_some_and(|ty| ty.comparable(&expected) || (expected.is_identity() && matches!(terms[position].1, RuleTerm::Literal(Value::String(_)))))
            })
        })
        .collect();
    if extras && named.is_some() {
        if let Some(width) = candidates.iter().filter(|i| target.total_unique(i)).map(|i| i.columns.len()).min() {
            candidates.retain(|i| target.total_unique(i) && i.columns.len() == width);
            // @ref LLP 3000.036#11 — named equalities covering two total unique keys
            // test one row either way (the other key's columns are extra
            // equalities on it), so the first declared key decides; no ambiguity.
            candidates.truncate(1);
        }
        else if candidates.iter().any(|i| i.unique) { candidates.retain(|i| i.unique); }
    }
    if named.is_none() {
        let unique: Vec<_> = candidates.iter().copied().filter(|index| index.unique && index.columns.len() == terms.len()).collect();
        if unique.len() == 1 { candidates = unique; }
    }
    let index = match candidates.as_slice() {
        [one] => (*one).clone(),
        [] => {
            if read.index.is_none() {
                if let Some(names) = &named {
                    let name = names.iter().map(|n| { let mut chars = n.chars(); chars.next().map(|c| c.to_uppercase().to_string()).unwrap_or_default() + chars.as_str() }).collect::<String>();
                    return Err(unknown(site, format!("{} has no index with {} columns matching this key", read.table, names.len()), format!("by by{name}: {}", names.join(", "))).guide("indexes"));
                }
            }
            let declared: Vec<String> = target.indexes.iter().map(|i| format!("{}: {}", i.name, i.columns.join(", "))).collect();
            return Err(unknown(site, format!("{} has no index with {} column{} matching this key", read.table, terms.len(), if terms.len() == 1 { "" } else { "s" }), format!("declare `unique by{}: <columns>` on {}; its indexes are {}", read.table.chars().next().map(|c| c.to_uppercase().to_string()).unwrap_or_default(), read.table, if declared.is_empty() { "none".to_owned() } else { declared.join("; ") }) + if extras && named.is_some() { "; an index is needed when the named equalities do not cover a total unique key" } else { "" }));
        }
        many => {
            let names: Vec<&str> = many.iter().map(|i| i.name.as_str()).collect();
            let changes = many.iter().filter(|index| !catalog.synthesized.contains(&(read.table.clone(), index.name.clone())))
                .map(|index| crate::repair::ReadChange::Index(index.name.clone())).collect();
            return Err(ambiguous(site, format!("{} has {} indexes matching this key: {}; choose a unique key with admitted arguments", read.table, many.len(), names.join(", ")), "")
                .repair_read(&read.site, changes));
        }
    };
    super::point_key::check(target, &index, read, &terms.iter().zip(&types).map(|((column, term), ty)|
        (column.as_deref(), (!ty.is_optional() && *ty != Ty::Unknown) || bindings.present.contains(term))).collect::<Vec<_>>(), true)?;
    let equalities = terms.iter().filter_map(|(column, term)| column.as_ref().filter(|col| !index.columns.contains(col)).map(|col| (col.clone(), term.clone()))).collect();
    let mut ordered: Vec<RuleTerm> = match &named {
        Some(names) => index.columns.iter().map(|column| {
            let position = names.iter().position(|n| n == column).ok_or_else(|| unknown(site, format!("key omits column {column} of {}.{}", read.table, index.name), format!("name each column once: {}", index.columns.join(", "))))?;
            Ok(terms[position].1.clone())
        }).collect::<Fallible<_>>()?,
        None => terms.into_iter().map(|(_, term)| term).collect(),
    };
    // Literals take the column's nominal form: an id in an identity column,
rg: snapback4/crates/snapback4-lang/src/bind/lookup.rs: No such file or directory (os error 2)
rg: snapback4/crates/snapback4-lang/src/bind/brackets*: No such file or directory (os error 2)
snapback4/crates/snapback4-lang/src/bind/schema.rs:7:use crate::diag::{Diagnostic, Fallible, Site, ambiguous, name_rewrite, sync_error, type_error, unknown};
snapback4/crates/snapback4-lang/src/bind/schema.rs:919:    // @ref LLP 3000.036#11 — app-farm pattern 27: the positional unique-key form.
snapback4/crates/snapback4-lang/src/bind/schema.rs:928:            let positional = if name == "id" { std::iter::once(value.clone()).chain(others.iter().cloned()).collect::<Vec<_>>().join(", ") } else { std::iter::once(format!("{name} = {value}")).chain(others.iter().cloned()).collect::<Vec<_>>().join(", ") };
snapback4/crates/snapback4-lang/src/bind/schema.rs:930:                format!("exists {}[{positional}]", read.table)).guide("rules"));
snapback4/crates/snapback4-lang/src/bind/schema.rs:972:        let declared = super::positional_keys::candidates(target, read, &typed, &catalog.synthesized);
snapback4/crates/snapback4-lang/src/bind/schema.rs:974:            return Err(super::positional_keys::refusal(target, read, &typed, &declared, catalog));
snapback4/crates/snapback4-lang/src/bind/schema.rs:982:    let mut candidates: Vec<&IndexDecl> = target
snapback4/crates/snapback4-lang/src/bind/schema.rs:1007:        if let Some(width) = candidates.iter().filter(|i| target.total_unique(i)).map(|i| i.columns.len()).min() {
snapback4/crates/snapback4-lang/src/bind/schema.rs:1008:            candidates.retain(|i| target.total_unique(i) && i.columns.len() == width);
snapback4/crates/snapback4-lang/src/bind/schema.rs:1012:            candidates.truncate(1);
snapback4/crates/snapback4-lang/src/bind/schema.rs:1014:        else if candidates.iter().any(|i| i.unique) { candidates.retain(|i| i.unique); }
snapback4/crates/snapback4-lang/src/bind/schema.rs:1017:        let unique: Vec<_> = candidates.iter().copied().filter(|index| index.unique && index.columns.len() == terms.len()).collect();
snapback4/crates/snapback4-lang/src/bind/schema.rs:1018:        if unique.len() == 1 { candidates = unique; }
snapback4/crates/snapback4-lang/src/bind/schema.rs:1020:    let index = match candidates.as_slice() {
snapback4/crates/snapback4-lang/src/bind/schema.rs:1036:            return Err(ambiguous(site, format!("{} has {} indexes matching this key: {}; choose a unique key with admitted arguments", read.table, many.len(), names.join(", ")), "")
snapback4/crates/snapback4-lang/src/bind/point_key.rs:54:        format!("{}.{} is a nullable unique key: a null argument can tie several rows; a point is ambiguous across replicas because each device may hold different tied rows. {}; alternatively read a bounded population or key the row by id (guide indexes)", read.table, index.name, advice.join("; ")),
rg: snapback4/crates/snapback4-lang/tests/rules*: IO error for operation on snapback4/crates/snapback4-lang/tests/rules*: No such file or directory (os error 2)
        self.sources.insert(format!("presence/{site}"), (site.clone(), print::read_expr(read)));
        Ok((Expr::Builtin { builtin: Builtin::Connected, args: vec![e] }, Ty::Int))
    }

    pub(super) fn name(&mut self, name: &str, site: &Site) -> Fallible<(Expr, Ty)> {
        match name {
            "viewer" | "$input:viewer" => Ok((Expr::Input(Input::Viewer), Ty::Principal)),
            "now" | "commit" => {
                if self.kind == ProgramKind::Query && name == "commit" {
                    return Err(unknown(site, "commit is the mutation commit clock; queries read now", "now"));
                }
                Ok((Expr::Input(Input::Now), Ty::Time))
            }
            "new" => {
                if self.viewer_depth.is_some() { return Err(job_reads::read_only(site)); }
                if self.kind == ProgramKind::Query {
                    return Err(unknown(site, "queries cannot mint ids", "mint ids in a mutation"));
                }
                Ok((Expr::Input(Input::NewId), Ty::Id))
            }
            "true" => Ok((Expr::Literal(Value::Bool(true)), Ty::Bool)),
            "false" => Ok((Expr::Literal(Value::Bool(false)), Ty::Bool)),
            "null" => Ok((Expr::Literal(Value::Null), Ty::Null)),
            _ => {
                if let Some(binding) = self.binding(name) {
                    if let Some(error) = &binding.error { return Err(error.clone()); }
                    return Ok((binding.inline.clone().unwrap_or_else(|| ir::var(&binding.runtime)), binding.ty.clone()));
                }
                if self.catalog.tables.contains_key(name) {
                    return Err(unknown(site, format!("{name} is a table; a read needs a key or a range"), format!("{name}[key]  -- or: {name}[prefix] first 50 by index")));
                }

codex
MATERIAL — three defects remain.

1. **Retained-policy equality bypasses probe meaning.** [release_bridge.rs:503](/home/ccheever/projects/sb4-b27-rel/snapback4/crates/snapback4-lang/src/release_bridge.rs:503) and the freeze comparison at line 509 use raw `RuleExpr` equality. Changing `unique gate: person` to `unique gate: delegate`, alongside the corresponding named policy probe, can produce identical rule IR while authorizing different principals. Historical selection then passes despite weaker authority. **Repair:** compare retained write/freeze policies through `PolicyComparison::rule`, including complete aligned index meaning. This also admits equivalent policies whose index labels merely changed.

2. **Policy printing creates false refusals.** [release_bridge.rs:464](/home/ccheever/projects/sb4-b27-rel/snapback4/crates/snapback4-lang/src/release_bridge.rs:464) reparses `policy.quarry()`, which drops probe index/key names. With two unique principal keys, an unambiguous authored `exists roles[principal = viewer]` becomes ambiguous `exists roles[viewer]`. A valid stable leading require therefore refuses. Printing the entire policy also unnecessarily requires unsupported branches of a current OR to bind in historical source. **Repair:** extract historical leading requirements independently, then compare their compiled rules directly against the aligned current policy; avoid the policy-text round trip.

3. **Unrelated schema features disable every leading-guard proof.** [release_bridge.rs:486](/home/ccheever/projects/sb4-b27-rel/snapback4/crates/snapback4-lang/src/release_bridge.rs:486) rejects whenever *any* table has maintenance, sequences or writing deletion actions—even when the operation cannot touch those tables. This preserves broad false refusals for already-protected workflows. **Repair:** restrict implicit-effect refusal to effects reachable from the operation’s complete expanded write footprint; continue refusing unknown reachable effects.

The Boolean containment directions and branch/loop write traversal appear sound. No files edited, builds or tests run.
tokens used
131,716
MATERIAL — three defects remain.

1. **Retained-policy equality bypasses probe meaning.** [release_bridge.rs:503](/home/ccheever/projects/sb4-b27-rel/snapback4/crates/snapback4-lang/src/release_bridge.rs:503) and the freeze comparison at line 509 use raw `RuleExpr` equality. Changing `unique gate: person` to `unique gate: delegate`, alongside the corresponding named policy probe, can produce identical rule IR while authorizing different principals. Historical selection then passes despite weaker authority. **Repair:** compare retained write/freeze policies through `PolicyComparison::rule`, including complete aligned index meaning. This also admits equivalent policies whose index labels merely changed.

2. **Policy printing creates false refusals.** [release_bridge.rs:464](/home/ccheever/projects/sb4-b27-rel/snapback4/crates/snapback4-lang/src/release_bridge.rs:464) reparses `policy.quarry()`, which drops probe index/key names. With two unique principal keys, an unambiguous authored `exists roles[principal = viewer]` becomes ambiguous `exists roles[viewer]`. A valid stable leading require therefore refuses. Printing the entire policy also unnecessarily requires unsupported branches of a current OR to bind in historical source. **Repair:** extract historical leading requirements independently, then compare their compiled rules directly against the aligned current policy; avoid the policy-text round trip.

3. **Unrelated schema features disable every leading-guard proof.** [release_bridge.rs:486](/home/ccheever/projects/sb4-b27-rel/snapback4/crates/snapback4-lang/src/release_bridge.rs:486) rejects whenever *any* table has maintenance, sequences or writing deletion actions—even when the operation cannot touch those tables. This preserves broad false refusals for already-protected workflows. **Repair:** restrict implicit-effect refusal to effects reachable from the operation’s complete expanded write footprint; continue refusing unknown reachable effects.

The Boolean containment directions and branch/loop write traversal appear sound. No files edited, builds or tests run.
