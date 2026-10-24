OpenAI Codex v0.164.0
--------
workdir: /home/ccheever/projects/sb4-b27-rel
model: gpt-6.1-sol
provider: openai
approval: never
sandbox: danger-full-access
reasoning effort: high
reasoning summaries: none
session id: 01a16f34-aae3-7aa3-9326-183c324fbb5d
--------
user
Review normative §21 and exact_write_authority implementation for MATERIAL safety/custody/design defects. Return READY if none, otherwise MATERIAL with exact repair. Do not edit files or run builds. Fresh blind review. This revision compares retained guards through complete probe/index identity, obtains historical leading requirements using a synthetic allow invariant (no policy-print/reparse), limits unknown implicit-effect blockers to the operation expanded write footprint, and refuses lifetime/expiring/recorded probe populations. Every branch/loop write is included; scope changes/emits still refuse. An unrelated cascading edge no longer blocks a stable dispatcher guard. Evaluate proof soundness and release semantics.

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
external effects and implicit maintained/sequence/referential writes reachable
from that operation refuse this reduction; unrelated schema features do not.
Probed populations with inherited lifetime, expiry or recorded fields also refuse
this reduction until their full dependency closure is modeled. Leading requirements
are compiled independently using a synthetic allow assertion; no printed current
policy is reparsed or required to exist in the historical schema. Rules depending on row images, negative probes, references or mutable
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
I’ll review §21 against the exact_write_authority code and its governing context, focusing on proof soundness and release selection. I won’t edit files or run builds.
exec
/bin/bash -lc 'cat snapback4/AGENTS.md; cat /home/ccheever/.codex/skills/llp-orient/SKILL.md' in /home/ccheever/projects/sb4-b27-rel
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
/bin/bash -lc "rg -n 'exact_write_authority|Wave-27 release semantics' snapback4 llp; cat snapback4/NOT-DOING.md; cat rules/RULES.md; tail -90 snapback4/JOURNAL.md" in /home/ccheever/projects/sb4-b27-rel
 succeeded in 3ms:
llp/3000.000.000-retained-storage-and-hot-release.rfc.md:1769:## 21. Wave-27 release semantics (REL)
llp/reviews/rel-wave27/r6-brief.md:1:Review normative §21 and exact_write_authority implementation for MATERIAL safety/custody/design defects. Return READY if none, otherwise MATERIAL with exact repair. Do not edit files or run builds. Fresh blind review. This revision compares retained guards through complete probe/index identity, obtains historical leading requirements using a synthetic allow invariant (no policy-print/reparse), limits unknown implicit-effect blockers to the operation expanded write footprint, and refuses lifetime/expiring/recorded probe populations. Every branch/loop write is included; scope changes/emits still refuse. An unrelated cascading edge no longer blocks a stable dispatcher guard. Evaluate proof soundness and release semantics.
llp/reviews/rel-wave27/r6-brief.md:3:## 21. Wave-27 release semantics (REL)
llp/reviews/rel-wave27/r5-brief.md:1:Review the normative §21 amendment and release_bridge.rs exact_write_authority implementation for MATERIAL safety/custody/design defects. Return READY if none, otherwise MATERIAL with concrete repair. Do not edit files or run builds. This is a fresh blind review. The wave-27 full-store replay found source selection falsely refused already-protected dispatcher/planner operations. The revised gate admits closed Boolean containment and stable dominating viewer/literal positive-existence requires over fully expanded IR writes; branches/loops participate in the write set. Scope changes, emits and unknown implicit writes still refuse. Read code if useful; focus on proof soundness and remaining false refusals. Security-owned code is unchanged.
llp/reviews/rel-wave27/r5-brief.md:5:## 21. Wave-27 release semantics (REL)
llp/reviews/rel-wave27/r5-codex.md:13:Review the normative §21 amendment and release_bridge.rs exact_write_authority implementation for MATERIAL safety/custody/design defects. Return READY if none, otherwise MATERIAL with concrete repair. Do not edit files or run builds. This is a fresh blind review. The wave-27 full-store replay found source selection falsely refused already-protected dispatcher/planner operations. The revised gate admits closed Boolean containment and stable dominating viewer/literal positive-existence requires over fully expanded IR writes; branches/loops participate in the write set. Scope changes, emits and unknown implicit writes still refuse. Read code if useful; focus on proof soundness and remaining false refusals. Security-owned code is unchanged.
llp/reviews/rel-wave27/r5-codex.md:17:## 21. Wave-27 release semantics (REL)
llp/reviews/rel-wave27/r5-codex.md:241:I’ll read the applicable design context and trace `exact_write_authority`, focusing on proof soundness and avoidable refusals. I won’t edit files or run builds.
llp/reviews/rel-wave27/r5-codex.md:631:/bin/bash -lc "rg -n 'exact_write_authority|stable.*require|containment' snapback4/crates/snapback4/src/release_bridge.rs" in /home/ccheever/projects/sb4-b27-rel
llp/reviews/rel-wave27/r5-codex.md:955:/bin/bash -lc "head -100 llp/3000-snapback4.explainer.md; head -70 llp/2000.000-keep-the-core-flip-two-substrates.rfc.md; rg -n 'Wave-27 release semantics|@ref' snapback4/crates/snapback4/src/release_bridge.rs llp/3000*" in /home/ccheever/projects/sb4-b27-rel
llp/reviews/rel-wave27/r5-codex.md:1131:llp/3000.000.000-retained-storage-and-hot-release.rfc.md:1769:## 21. Wave-27 release semantics (REL)
llp/reviews/rel-wave27/r5-codex.md:1139:/bin/bash -lc "rg --files snapback4 | rg 'release_bridge.rs|AGENTS.md"'$'"'; rg -n 'exact_write_authority' snapback4; sed -n '1769,1840p' llp/3000.000.000-retained-storage-and-hot-release.rfc.md" in /home/ccheever/projects/sb4-b27-rel
llp/reviews/rel-wave27/r5-codex.md:1144:snapback4/crates/snapback4-lang/src/release_bridge.rs:429:pub fn exact_write_authority(target:&[(String,String)],current:&[(String,String)])->Result<(),String>{
llp/reviews/rel-wave27/r5-codex.md:1145:snapback4/crates/snapback4-lang/tests/release_bridge_security.rs:851:    let error=release_bridge::exact_write_authority(&before,&current).unwrap_err();
llp/reviews/rel-wave27/r5-codex.md:1146:snapback4/crates/snapback4-lang/tests/release_bridge_security.rs:854:    assert!(release_bridge::exact_write_authority(&[("schema.q".into(),guarded)],&current).is_ok());
llp/reviews/rel-wave27/r5-codex.md:1147:snapback4/crates/snapback4-lang/tests/release_bridge_security.rs:894:    assert!(release_bridge::exact_write_authority(&[("schema.q".into(),old.into())],&[("schema.q".into(),current)]).is_ok());
llp/reviews/rel-wave27/r5-codex.md:1148:snapback4/crates/snapback4-lang/tests/release_bridge_security.rs:910:    assert!(release_bridge::exact_write_authority(&before,&next).is_ok());
llp/reviews/rel-wave27/r5-codex.md:1149:snapback4/crates/snapback4-lang/tests/release_bridge_security.rs:912:    assert!(release_bridge::exact_write_authority(&[("schema.q".into(),unstable)],&next).is_err());
llp/reviews/rel-wave27/r5-codex.md:1150:snapback4/crates/snapback4-lang/tests/release_bridge_security.rs:915:    assert!(release_bridge::exact_write_authority(&[("schema.q".into(),wrong)],&[("schema.q".into(),planner)]).is_err());
llp/reviews/rel-wave27/r5-codex.md:1151:snapback4/crates/snapback4/src/verbs/releases.rs:187:        snapback4_lang::release_bridge::exact_write_authority(&target,&current).map_err(|e|format!("E_ADOPT: {e}"))?;
llp/reviews/rel-wave27/r5-codex.md:1152:snapback4/crates/snapback4/src/verbs/releases.rs:190:            snapback4_lang::release_bridge::exact_write_authority(&target,&source).map_err(|e|format!("E_ADOPT: latest source {latest}: {e}"))?;
llp/reviews/rel-wave27/r5-codex.md:1153:## 21. Wave-27 release semantics (REL)
llp/reviews/rel-wave27/r5-codex.md:1400:pub fn exact_write_authority(target:&[(String,String)],current:&[(String,String)])->Result<(),String>{
llp/reviews/rel-wave27/r5-codex.md:1542:    let error=release_bridge::exact_write_authority(&before,&current).unwrap_err();
llp/reviews/rel-wave27/r5-codex.md:1545:    assert!(release_bridge::exact_write_authority(&[("schema.q".into(),guarded)],&current).is_ok());
llp/reviews/rel-wave27/r5-codex.md:1585:    assert!(release_bridge::exact_write_authority(&[("schema.q".into(),old.into())],&[("schema.q".into(),current)]).is_ok());
llp/reviews/rel-wave27/r5-codex.md:1601:    assert!(release_bridge::exact_write_authority(&before,&next).is_ok());
llp/reviews/rel-wave27/r5-codex.md:1603:    assert!(release_bridge::exact_write_authority(&[("schema.q".into(),unstable)],&next).is_err());
llp/reviews/rel-wave27/r5-codex.md:1606:    assert!(release_bridge::exact_write_authority(&[("schema.q".into(),wrong)],&[("schema.q".into(),planner)]).is_err());
llp/reviews/rel-wave27/r5-codex.md:1645:        snapback4_lang::release_bridge::exact_write_authority(&target,&current).map_err(|e|format!("E_ADOPT: {e}"))?;
llp/reviews/rel-wave27/r5-codex.md:1648:            snapback4_lang::release_bridge::exact_write_authority(&target,&source).map_err(|e|format!("E_ADOPT: latest source {latest}: {e}"))?;
llp/reviews/rel-wave27/r5-codex.md:3673:   429	pub fn exact_write_authority(target:&[(String,String)],current:&[(String,String)])->Result<(),String>{
llp/reviews/rel-wave27/r5-codex.md:5239:@@ -433,7 +433,11 @@ pub fn exact_write_authority(target:&[(String,String)],current:&[(String,String)
llp/reviews/rel-wave27/r5-codex.md:5252:@@ -460,10 +464,31 @@ pub fn exact_write_authority(target:&[(String,String)],current:&[(String,String)
llp/reviews/rel-wave27/r5-codex.md:5292:195:        snapback4_lang::release_bridge::exact_write_authority(&target,&current).map_err(|e|format!("E_ADOPT: {e}"))?;
llp/reviews/rel-wave27/r5-codex.md:5293:198:            snapback4_lang::release_bridge::exact_write_authority(&target,&source).map_err(|e|format!("E_ADOPT: latest source {latest}: {e}"))?;
llp/reviews/rel-wave27/r1-brief.md:571:## 21. Wave-27 release semantics (REL)
llp/reviews/rel-wave27/r6-codex.md:13:Review normative §21 and exact_write_authority implementation for MATERIAL safety/custody/design defects. Return READY if none, otherwise MATERIAL with exact repair. Do not edit files or run builds. Fresh blind review. This revision compares retained guards through complete probe/index identity, obtains historical leading requirements using a synthetic allow invariant (no policy-print/reparse), limits unknown implicit-effect blockers to the operation expanded write footprint, and refuses lifetime/expiring/recorded probe populations. Every branch/loop write is included; scope changes/emits still refuse. An unrelated cascading edge no longer blocks a stable dispatcher guard. Evaluate proof soundness and release semantics.
llp/reviews/rel-wave27/r6-codex.md:15:## 21. Wave-27 release semantics (REL)
llp/reviews/rel-wave27/r6-codex.md:243:I’ll review §21 against the exact_write_authority code and its governing context, focusing on proof soundness and release selection. I won’t edit files or run builds.
llp/reviews/rel-wave27/r3-brief.md:571:## 21. Wave-27 release semantics (REL)
llp/reviews/rel-wave27/r4-brief.md:571:## 21. Wave-27 release semantics (REL)
llp/reviews/rel-wave27/r2-brief.md:571:## 21. Wave-27 release semantics (REL)
snapback4/crates/snapback4/src/verbs/releases.rs:195:        snapback4_lang::release_bridge::exact_write_authority(&target,&current).map_err(|e|format!("E_ADOPT: {e}"))?;
snapback4/crates/snapback4/src/verbs/releases.rs:198:            snapback4_lang::release_bridge::exact_write_authority(&target,&source).map_err(|e|format!("E_ADOPT: latest source {latest}: {e}"))?;
snapback4/crates/snapback4-lang/src/release_bridge.rs:429:pub fn exact_write_authority(target:&[(String,String)],current:&[(String,String)])->Result<(),String>{
snapback4/crates/snapback4-lang/tests/release_bridge_security.rs:851:    let error=release_bridge::exact_write_authority(&before,&current).unwrap_err();
snapback4/crates/snapback4-lang/tests/release_bridge_security.rs:854:    assert!(release_bridge::exact_write_authority(&[("schema.q".into(),guarded)],&current).is_ok());
snapback4/crates/snapback4-lang/tests/release_bridge_security.rs:894:    assert!(release_bridge::exact_write_authority(&[("schema.q".into(),old.into())],&[("schema.q".into(),current)]).is_ok());
snapback4/crates/snapback4-lang/tests/release_bridge_security.rs:910:    assert!(release_bridge::exact_write_authority(&before,&next).is_ok());
snapback4/crates/snapback4-lang/tests/release_bridge_security.rs:912:    assert!(release_bridge::exact_write_authority(&[("schema.q".into(),unstable)],&next).is_err());
snapback4/crates/snapback4-lang/tests/release_bridge_security.rs:915:    assert!(release_bridge::exact_write_authority(&[("schema.q".into(),wrong)],&[("schema.q".into(),planner)]).is_err());
snapback4/crates/snapback4-lang/tests/release_bridge_security.rs:922:    assert!(release_bridge::exact_write_authority(&[("schema.q".into(),old.into())],&[("schema.q".into(),current)]).is_ok());
snapback4/crates/snapback4-lang/tests/release_bridge_security.rs:932:    assert!(release_bridge::exact_write_authority(&[("schema.q".into(),before)],&[("schema.q".into(),current)]).is_ok());
snapback4/crates/snapback4-lang/tests/release_bridge_security.rs:939:    assert!(release_bridge::exact_write_authority(&[("schema.q".into(),old.into())],&[("schema.q".into(),current)]).is_err());
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
(`/tmp/s10d3-serve-eyhclews/data`) were explicitly stopped. Independent
`pg_ctl status` returns **3** for both, and neither has a postmaster pidfile.
The final audit finds **4,582 recorded PID/start identities** and the public
witness's **472 PID records** absent, with no live/reused identities.
**Owned PIDs left: none.** Free space after cleanup was **34.30 GiB**.

Raw output, the disk-guard receipt and PID/cleanup audits remain outside Git
under `/tmp/sb4-ff1-fix2/`; the stopped cluster data and public artifacts remain
in their named `/tmp` directories. All builds used this worktree's target,
line-tables-only dev/test debug settings and 24 Cargo build jobs. No
workspace/all-targets build, stash, push or Git configuration change. The fix
and these accurate partial-qualification records are preserved in a new commit
on the commissioned branch; the remaining public qualification requires a
later run with disk headroom.

### 2026-10-24 — G6: bounded read grants and zero-flight revision hits

The author's G6 commission implements the residual read lever of Accepted
LLP 3000.009.001.000.002 §4.1–§4.5, on local branch `sb4-pg/g6` at G5 base
af342f8ef1. There is no cross-revision promotion. `_read_grant` is persisted
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

codex
I’m using the read-only llp-orient skill to load the release constraints. I’ll keep the blind review independent of prior review artifacts.
exec
/bin/bash -lc "sed -n '1,260p' snapback4/crates/snapback4-lang/src/release_bridge.rs" in /home/ccheever/projects/sb4-b27-rel
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
            let (tokens,_)=lexer::lex(&module,&text);
            (module,tokens.into_iter().map(|t|(t.kind,t.value)).collect())
        }).collect()
    }
    signature(target)==signature(current)
}

pub fn loosen(target:&[(String,String)],current:&[(String,String)])->Bridge {
    let mut bridge=loosen_inner(target,current);
    for diagnostic in &mut bridge.diagnostics {
        if diagnostic.site.line==0 {
            let docs=current.iter().map(|(f,t)|parser::parse_document(f,t).0).collect::<Vec<_>>();
            diagnostic.site=docs.iter().flat_map(|d|&d.programs).find(|p|diagnostic.message.contains(&p.name)).map(|p|p.site.clone())
                .or_else(||docs.iter().flat_map(|d|&d.tables).find_map(|t|t.columns.iter().find(|c|diagnostic.message.contains(&format!("{}.{}",t.name,c.name))).map(|c|c.site.clone())))
                .or_else(||docs.iter().flat_map(|d|&d.tables).next().map(|t|t.site.clone()))
                .unwrap_or_else(||crate::Site::new(current.first().map(|s|s.0.as_str()).unwrap_or("schema.q"),1,1));
        }
    }
    bridge
}
fn loosen_inner(target:&[(String,String)],current:&[(String,String)])->Bridge {
    let current_bound=crate::compile(current);
    if current_bound.schema.extractions.iter().any(|e|!e.each)||!current_bound.invariants.is_empty()||current_bound.schema.tables.values().any(|t|!t.column_writes.is_empty()||!t.frozen_columns.is_empty()) {
        let mut allow_guarded=false;
        let complete=super::release_bridge_current::prepare(target,current,&mut allow_guarded);
        if complete.diagnostics.is_empty() || !allow_guarded{return complete;}
        // A complete current closure is preferred, but a selective guarded
        // predecessor is also truthful when its retained contracts compile.
        let guarded=super::release_bridge_current::guarded(target,current);
        if guarded.diagnostics.is_empty(){return guarded;}
        return guarded;
    }
    let guarded=loosen_guarded(target,current);
    if !guarded.diagnostics.is_empty(){
        let complete=super::release_bridge_current::prepare(target,current,&mut false);
        if complete.diagnostics.is_empty(){return complete;}
        let current_bridge=super::release_bridge_current::guarded(target,current);
        if current_bridge.diagnostics.is_empty(){return current_bridge;}
    }
    guarded
}

fn loosen_guarded(target:&[(String,String)],current:&[(String,String)])->Bridge {
    let new: BTreeMap<_,_>=current.iter().flat_map(|(file,text)|parser::parse_document(file,text).0.tables.into_iter().map(move|t|(t.name.clone(),(file,text,t)))).collect();
    let mut new=new;
    for (_,(_,_,table)) in new.clone() {if let Some(old)=&table.renamed_from {if let Some(value)=new.get(&table.name).cloned(){new.insert(old.clone(),value);}}}
    for(file,text)in target {for old in parser::parse_document(file,text).0.tables {if let Some(prior)=&old.renamed_from {if !new.contains_key(&old.name){if let Some(value)=new.get(prior).cloned(){new.insert(old.name.clone(),value);}}}}}
    let mut domain_diagnostics=Vec::new();let mut changes=Vec::new();let mut affected=std::collections::BTreeSet::new();let mut sources=target.to_vec();let mut names=std::collections::BTreeSet::new();
    for (file,text) in &mut sources {
        let document=parser::parse_document(file,text).0;let mut edits=Vec::new();
        for table in &document.tables {
            names.insert(table.name.clone());
            let Some((_,_,next))=new.get(&table.name) else {continue};
            if next.name!=table.name {affected.insert(table.name.clone());changes.push(format!("table {}: current spelling {}; target spelling routes the same identity",table.name,next.name));}
            for column in &table.columns {
                let Some(candidate)=next.columns.iter().find(|c|c.name==column.name || c.renamed_from.as_ref()==Some(&column.name)||column.renamed_from.as_ref()==Some(&c.name)) else {continue};
                if candidate.name!=column.name {affected.insert(table.name.clone());changes.push(format!("{}.{}: current column spelling {}; target spelling routes the same cell",table.name,column.name,candidate.name));}
                let Some(joined)=join(&column.type_,&candidate.type_,&new) else {domain_diagnostics.push(crate::diag::type_error(&column.site,format!("rollback view for {}.{} has incompatible predecessor/current domains {} / {}",table.name,column.name,print::scalar_type(&column.type_),print::scalar_type(&candidate.type_)),"author a truthful compatible source and typed migration before deploying").guide("deploy"));continue};
                // A current guard may rely on a value being impossible under its
                // schema. Never reintroduce predecessor-only values behind that
                // same predicate merely because another column needs widening.
                let mut current_domain=join(&candidate.type_,&candidate.type_,&new).unwrap();
                let mut joined_domain=joined.clone();
                fn normalize(t:&mut ast::ScalarType,tables:&BTreeMap<String,(&String,&String,ast::TableDecl)>){
                    match &mut t.kind {
                        TypeKind::Ref{table}=>{if let Some((_,_,next))=tables.get(table){*table=next.name.clone();}},
                        TypeKind::List{item,..}=>normalize(item,tables),
                        TypeKind::Enum{variants}=>variants.sort(), _=>()
                    }
                }
                normalize(&mut current_domain,&new);normalize(&mut joined_domain,&new);
                if current_domain!=joined_domain {
                    domain_diagnostics.push(crate::diag::type_error(&column.site,format!("rollback view for {}.{} would admit predecessor values excluded by the current domain; current authority may depend on their absence",table.name,column.name),"author a compatible rollback source preserving the current domain and truthful migrations; do not widen a current confidentiality or safety boundary").guide("deploy"));
                }
                if joined==column.type_ {continue;}
                affected.insert(table.name.clone());
                if let Some((start,end))=type_span(file,text,column) {
                    edits.push((start,end,print::scalar_type(&joined)));
                    changes.push(format!("{}.{}: {} → {}",table.name,column.name,print::scalar_type(&column.type_),print::scalar_type(&joined)));
                }
            }
        }
        edits.sort_by_key(|e|std::cmp::Reverse(e.0));for(start,end,value)in edits{text.replace_range(start..end,&value);}
    }
    if !domain_diagnostics.is_empty() {
        let complete=super::release_bridge_current::prepare(target,current,&mut false);
        if complete.diagnostics.is_empty(){return complete;}
        let current_bridge=super::release_bridge_current::guarded(target,current);
        if current_bridge.diagnostics.is_empty(){return current_bridge;}
    }
    // New concepts keep their current rules. They are retained populations,
    // not a promise that a frozen old operation exposes a new concept.
    let aliases:BTreeMap<_,_>=names.iter().filter_map(|old|new.get(old).filter(|(_,_,t)|&t.name!=old).map(|(_,_,t)|(t.name.clone(),old.clone()))).collect();
    let mut additions=String::new();
    for (name,(file,text,table)) in &new {
        if name!=&table.name {continue;} // Alias lookup entries are not declarations.
        if names.contains(name)||aliases.contains_key(name)||table.renamed_from.as_ref().is_some_and(|old|names.contains(old)){continue;}
        affected.insert(name.clone());
        match retained_declaration(file,text,table,&aliases) {
            Ok(source)=>{additions.push_str(&source);additions.push('\n');},
            Err(reason)=>domain_diagnostics.push(crate::diag::type_error(&table.site,reason,"retain an authored compatible guarded source for this table mapping").guide("deploy")),
        }
        changes.push(format!("new table {name}: retained with its current rules; old operations may not expose it"));
    }
    if !additions.is_empty() {let mut name="rollback-retained.q".to_owned();while sources.iter().any(|(f,_)|f==&name){name.insert_str(0,"retained-");}sources.push((name,additions));}
    let transported=super::release_bridge_rules::carry(&mut sources,current,&mut changes,&std::collections::BTreeSet::new());
    affected.extend(transported);
    let (mut diagnostics,fallback)=super::release_bridge_guards::carry(&mut sources,current,&affected,&mut changes);
    if !fallback.is_empty(){
        super::release_bridge_rules::carry(&mut sources,current,&mut changes,&fallback);
        (diagnostics,_)=super::release_bridge_guards::carry(&mut sources,current,&affected,&mut changes);
    }
    let current_bound=crate::compile(current);
    if current_bound.diagnostics.is_empty()&&crate::compile(target).diagnostics.is_empty() {
        super::release_bridge_indexes::prune_unused_equivalent_keys(&mut sources,current,&mut changes);
    }
    let bound=crate::compile(&sources);
    if bound.schema.auth!=current_bound.schema.auth
        || super::release_bridge_guards::current_context_needed(&sources,current,&bound.schema,&current_bound.schema) {
        diagnostics.push(crate::diag::type_error(&crate::Site::default(),"rollback guards need the current ordered execution and schema context","retain the complete current guarded workflow, including authentication and guard-dependent reads").guide("deploy"));
    }
    for(file,text)in target {
        let old=parser::parse_document(file,text).0;
        let Some((_,next))=current.iter().find(|(f,_)|operation_name(f,"")==operation_name(file,""))else{continue};
        let next=parser::parse_document(file,next).0;
        for(name,prior,site)in &old.aliases {
            let qualified=operation_name(file,name);
            let retained=current_bound.programs.iter().any(|p|p.program.name==qualified);
            if retained&&!next.aliases.iter().any(|(alias,target,_)|alias==name&&target==prior) {
                diagnostics.push(crate::diag::type_error(site,format!("rollback export {qualified} needs its current definition or alias target"),"retain the complete current guarded endpoint and dependency closure").guide("deploy"));
            }
        }
    }

    for previous in &crate::compile(target).programs {
        if let Some(current)=current_bound.programs.iter().find(|p|p.program.name==previous.program.name) {
            let mut positions=std::collections::BTreeSet::new();
            let collapsed=previous.program.args.iter().any(|(name,_)| {
                let spellings=std::iter::once(name.as_str()).chain(previous.program.arg_aliases.iter().filter(|(_,owner)|*owner==name).map(|(alias,_)|alias.as_str()));
                let resolved=spellings.filter_map(|name|current.program.argument(name).map(|(canonical,_)|canonical)).collect::<std::collections::BTreeSet<_>>();
                resolved.len()>1||resolved.iter().any(|position|!positions.insert(*position))
            });
            if collapsed {
                diagnostics.push(crate::diag::type_error(&crate::Site::default(),format!("rollback export {} cannot merge or rebind old wire input positions behind current guards",previous.program.name),"author a compatible current guarded endpoint with distinct old argument positions").guide("deploy"));
            }
        }
    }
    let current_authority=match align_current_schema(&bound.schema,&sources,&current_bound.schema,current,&aliases) {
        Ok(schema)=>Some(schema),
        Err(error)=>{diagnostics.push(crate::diag::type_error(&crate::Site::default(),format!("rollback current authority cannot align declared table/column identities: {error}"),"author a compatible guarded identity mapping").guide("deploy"));None},
    };
    for(name,table)in &bound.schema.tables {
        let Some((_,_,next))=new.get(name)else{continue};
        let Some(current_table)=current_bound.schema.table(&next.name)else{continue};
        if current_authority.as_ref().is_some_and(|schema|schema.table(name).is_some_and(|authority| {
            let policies=PolicyComparison::new(&bound.schema,schema);
            table.column_reads.len()!=authority.column_reads.len()
                ||table.column_reads.iter().any(|(column,rule)|!policies.optional_rule(Some(rule),authority.column_reads.get(column)))
                ||table.written_by!=authority.written_by
                ||table.column_writes!=authority.column_writes
                ||table.frozen_columns!=authority.frozen_columns
        })) {
            diagnostics.push(crate::diag::type_error(&next.site,format!("rollback view needs current field authority on {name}"),"retain the complete current guarded workflow and its column read/write authority").guide("deploy"));
        }
        for column in &next.columns {

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
                        // Null placement on insert is not a protected column write in the engine.
                        if effect=="insert"&&object.and_then(|o|o.get(column)).is_some_and(|v|v.get("Literal").is_some_and(|literal|literal.is_null())){continue;}
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
        source.push_str(&format!("\ninvariant {table}.{operation} only allow\n"));
        let proof=crate::compile(&sources);if !proof.diagnostics.is_empty(){return false;}
        let comparison=PolicyComparison::new(&proof.schema,aligned);
        // @ref LLP 3000.000.000#21-wave-27-release-semantics-rel — finite control flow preserves a stable leading guard; scope changes do not.
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
        let writes=snapback4_core::ir::write_tables(&program.program);
        // Refuse unmodeled implicit effects reachable from this operation;
        // an unrelated maintained table or cascading edge is not a write.
        if writes.iter().any(|(name,effect)|proof.schema.table(name).is_none_or(|t|
            !t.maintained.is_empty()||!t.sequences.is_empty()
            ||proof.schema.maintains.iter().any(|m|m.source==*name||m.target==*name)
            ||*effect=="delete"&&proof.schema.tables.values().any(|child|child.columns.iter().any(|(column,kind)|
                matches!(kind.required(),snapback4_core::schema::ColumnType::Ref{table} if table==name)&&child.on_delete.get(column).is_some_and(|a|a.writes()))))) {return false;}
        proof.invariants.iter().any(|inv|inv.table==table&&inv.operation.as_deref()==Some(operation)
            &&inv.requirements.iter().any(|require|stable(require)&&implies(require,policy,&comparison)
                &&crate::security::kernel::dependencies(require).iter().all(|dependency|proof.schema.table(dependency).is_some_and(|t|
                    t.through.is_none()&&!t.is_expiring()&&t.recorded.is_empty())&&!writes.iter().any(|(t,_)|t==dependency))))
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
                    let safe=prior.column_writes.get(column).is_some_and(|old|policies.rule(old,policy)) || match *effect {"insert"=>implies(&prior.rules.insert,policy,&policies),"update"=>!prior.update_transition&&implies(&prior.rules.update,policy,&policies),"upsert"=>!prior.update_transition&&implies(&prior.rules.insert,policy,&policies)&&implies(&prior.rules.update,policy,&policies),_=>false};
                    if !safe && !leading_guard(target,&aligned,name,&program.program.name,policy) {return Err(format!("{}: exact source operation {} can write {name}.{column} without current rule `write <- {}`; retain this audience in a guarded bridge before selecting the source",program.site,program.program.name,policy.quarry()));}
                }
            }
        }
        for(column,condition)in &current.frozen_columns {
            if prior.columns.contains_key(column)&&!prior.frozen_columns.get(column).is_some_and(|old|policies.rule(old,condition))&&*condition!=RuleExpr::Deny&&!prior.constraints.iter().any(|c|matches!(c,snapback4_core::schema::Constraint::Immutable{fields}if fields.contains(column)))&&old.programs.iter().any(|p|snapback4_core::ir::write_tables(&p.program).iter().any(|(t,e)|t==name&&*e!="delete"&&writes_column(&serde_json::to_value(&p.program).unwrap(),name,column,e,false))) {
                return Err(format!("{name}.{column}: exact source omits current rule `immutable when {}`; retain the freeze in an authored bridge before selecting source",condition.quarry()));
            }
        }
    }
    Ok(())
}

exec
/bin/bash -lc "sed -n '1,160p' llp/3000-snapback4.explainer.md; head -85 llp/2000.000-keep-the-core-flip-two-substrates.rfc.md; ls llp/foundation; ls llp/current | rg '3000|2000.000'; head -65 llp/0000-snapback.explainer.md" in /home/ccheever/projects/sb4-b27-rel
 succeeded in 0ms:
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
in the client interpreter alike. A query cut by the meter returns `capped`
with no continuation past the cut, the same observable outcome as a static
ceiling cut today; a mutation aborts with `E_BOUND` naming actual work; a
job is chunked. `check --cost` prints the structural cost class; `test`
prints measured meters on the hub fixture.

**Flip 2 — the viewer's partition is the unit of sync** (LLP 2000.000 §7).
`sync to <audience> last N by <index>` on a table makes the engine maintain,
per principal, the rows that principal may read, as a change log with a
horizon; a table without the word is online-only, and `check` says which
rule term prevented inversion. The client holds a replica of its partitions,
one watermark each, a durable outbox with client-minted ids, and the
interpreter; queries run locally and are `complete` inside the horizon.
Revocation is a scope tombstone; `until-revoked` and `delivered-history`
survive as the client's leave policy. Two client tiers — online-only
without a store, local-first with one — share one language and one server.

**The vocabulary is fixed before the mechanism** (LLP 2000.000 §8):

```ts
type Read<T> = { data: T; complete: boolean; fresh: boolean; since?: number; next?: Cursor }
            | { loading: true } | { denied: Refusal };
row.pending: boolean;
type Write = { state: "pending" } | { state: "sent"; seq: number } | { state: "failed"; why: Refusal };
type Link = "online" | "offline" | "signed-out";
```

A screen that needs a word not on that card is a defect in the mechanism,
not a gap in the card.

**The hub comes first** (LLP 2000.000 §11): the Clique generator's `u0001`
with 1,000 memberships, `u0500` with 500 follows, and about 100,000
messages are the first fixture; day-two changes are designed before the
day-one screen; the native client is in slice one; physical floors are
measured before targets; the simulator is the primary harness.

## 3. The bakeoff protocol

Shared with Snapback 3; LLP 2000 or a sibling record should adopt the same
text so that the two tracks are measured by one instrument.

**Brief.** [`benchmarks/briefs/social-messenger.md`](../benchmarks/briefs/social-messenger.md)
(Clique) M1–M8, plus
[`benchmarks/briefs/messaging-day2-evolution.md`](../benchmarks/briefs/messaging-day2-evolution.md).
The field-work application (LLP 2000 §4) tests generality after the first
slice, on whichever tracks survive the clock.

**Fixture.** The Clique generator at the instrument freeze LLP 1023 and
LLP 1024 record (`f40559f37722c79178be664a11f8a6485f1508fd`): hub `u0001`
with 100 groups and 900 DMs, `u0500` with 500 follows, and the 100,015
messages of the retained 0.0.25 replay database. The same fixture for every
track and for the control.

**Harness and judge.** [`benchmarks/protocol.md`](../benchmarks/protocol.md);
the same three scorers as the 2026-09-05 run (gpt-6-astra, grok-4.6,
muse-spark); Convex as the control arm; published packages; fresh cold
agents with only the installed package and the task. Neither lead runs the
comparison or grades their own track. The author rules on the numbers.

**Decision rule, pre-registered.**
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
| Full acquisition of 10,008 messages: 67.4 s → 53.6 s → 32.6 s → 28.4 s against a 2–3 s objective; 201 requests, 200 acknowledgement mutations, 612 IndexedDB transactions; PowerSync reports 10,000 rows in 0.36 s native and 2.5 s on web | LLP 1018.008.007; LLP 1018.008.009 §4 | **Result cache, not replica.** Every 50-row page is a certified query, a receipt, a durable acknowledgement mutation, and a store swap |
| Adding a count to a thread makes the composite `partial` offline whenever count authority is missing, so the template declares an independent `history` query and `withHistory` bindings; 27 files / 1,718 lines → 28 / 1,751 after the fix | LLP 1018.008 F2; LLP 1018.008.009 §2 | **Result cache.** The count is not a fact the receipt covers, so the client cannot compose locally |
| `shared/thread.ts` describes table identity, row selection, order, create membership, draft fields and mutation targets a second time | LLP 1018.008 F2 | **Result cache.** Items must be reconstructed from answers because there is no local table to read |
| Sending stalled with 85 IDs remaining against a certified 352-ID slice on an 8,192-ID grant; recovery needed a "Sync now" action | LLP 1018.008 F1 | **Result cache + engine-minted IDs.** Prediction needs server ids before commit, so ids are granted in slices |
| A follower browser tab writes through a durable inbox row; the SDK carries `forwarding`, `writer-unresponsive`, `inbox-full`, `follower` states | LLP 1018.004 | **Result cache.** One writer per partition image; other tabs cannot mutate a receipt-proven image |
| Global search over 1,000 memberships costs ~1,010 HTTP requests through a client N-way merge | LLP 1024 §2 | **Result cache** (no local index over the partition) + **static pricing** (the server-side projection is refused) |
| The complete local runtime grew 7.8 KB → 89,843 gzip bytes; the ceiling was raised 34,000 → 50,000 → 66,000 → 82,000 → 82,500 → 84,000 → 85,000 → 90,000 | LLP 1000 §"Revised"; `rules/NOT-DOING.md` §Moves; LLP 1018.008 §10 | **Result cache.** The inputs list of `metrics/twin.jsonl` is coverage spans, extent facts, held directories, posting trees, fact integrity, swap journals — receipt machinery, not the interpreter |
| `Snapshot` carries `data, next, partial, receipt{state, source, seq, next, reason, rule, sites}, freshness{live, staleSince, connection}, local{predicted, retained, caughtUp, watermark}, refusal, status, reason` | LLP 1018.003 §1 | Both. Every field is a true fact about the mechanism; almost none is a fact about the application |
| `Schema::rule_hash` binds every queued write to the complete schema; an optional column on the subject table invalidates unrelated evidence | LLP 1018.002; LLP 1018.008.008 | **Result cache.** Evidence identity exists because held answers must be re-authorized; a replica re-runs the mutation at the server and needs no evidence identity |

Against that, what scored: on the 2026-09-05 three-scorer Clique run
Snapback 2 beat Convex on authorization (82 vs 79) and offline (81 vs 44)
and lost on queries and live (60 vs 85), client integration (59 vs 79),
setup and docs (55 vs 79), diagnostics and loop (66 vs 77), operations (53
vs 76) and scale (62 vs 80); overall 66 vs 81. The later single-lane 0.0.21
0000-snapback.explainer.md
0002-canonical-local-target.decision.md
0031-server-route-taxonomy.spec.md
0033-license-posture.decision.md
0037-schema-source-of-truth.decision.md
0148-prefixed-identifiers.decision.md
0189-verification-cadence-and-claim-gating.decision.md
0192-store-durable-state-set.decision.md
0225-core-modularization.decision.md
0226-identity-architecture.decision.md
0298-durable-effect-scope.decision.md
0303-subject-authority-correlation-policy.decision.md
2000.000-keep-the-core-flip-two-substrates.rfc.md
3000-snapback4.explainer.md
3000.000.000.002-declarative-backfills.rfc.md
3000.001.000-device-engine-handshake.rfc.md
3000.002-end-to-end-resource-bounds.research.md
3000.004-feeds-and-the-interview-reference-app.rfc.md
3000.007-relaxed-quarry-and-explicit-residency.rfc.md
3000.007.000-merge-position-and-drain-cut-continuation.spec.md
3000.007.001-maintained-columns.rfc.md
3000.007.002-common-application-shapes.rfc.md
3000.007.003-the-engine-writes-derived-data.rfc.md
3000.008.002.000-common-client-patterns.rfc.md
3000.009-general-purpose-backend.rfc.md
3000.009.000-the-server-half-opt-in.plan.md
3000.009.001-snapback4-on-postgres.rfc.md
3000.009.001.000-the-postgres-store-port.rfc.md
3000.009.001.000.000-the-committer.rfc.md
3000.009.001.000.000.000-the-write-overlay.rfc.md
3000.009.001.000.000.001-read-sets-and-validation.rfc.md
3000.009.001.000.002-beating-the-postgres-controls.rfc.md
3000.009.001.001-graduating-a-live-store-to-postgres.rfc.md
3000.009.001.002-scale-limits-against-postgres-controls.rfc.md
3000.009.001.003-replicated-sqlite-or-postgres.research.md
3000.010-agent-entry-path-budget.rfc.md
3000.011.001.001-scale-after-clique-030.plan.md
3000.011.005.000-qualify-the-built-application.rfc.md
3000.012-application-still-owns-derived-data.research.md
3000.013-quarry-states-intent.rfc.md
3000.013.000-a-browser-write-journal-without-the-device.rfc.md
3000.013.001-wave-12-semantic-language-gaps.spec.md
3000.013.002-frontend-data-and-actionable-notes.rfc.md
3000.015-shared-baseline-for-snapback5.spec.md
3000.017-ephemeral-tables.rfc.md
3000.019-what-the-builder-still-wrote.rfc.md
3000.020-an-unread-count-the-device-can-certify.rfc.md
3000.021-what-the-comparative-builder-still-wrote.rfc.md
3000.022-delivery-the-sdk-reports.rfc.md
3000.023-answers-stay-on-screen.rfc.md
3000.024-global-search-beyond-one-read.rfc.md
3000.025-expiring-mutation-read-prefix.rfc.md
3000.026-following-over-a-populated-store.rfc.md
3000.028-one-query-online-or-offline.rfc.md
3000.030-native-proof-in-minutes.rfc.md
3000.031-presence-proven-absence-in-the-client-contract.rfc.md
3000.032-client-contract-builder-costs.research.md
3000.034-many-apps-through-exact2.plan.md
3000.035-quarry-semantics-in-lean.plan.md
3000.036-what-the-app-farm-asks-of-the-rule-language.rfc.md
3000.036.000-sharing-shapes-at-sync-and-union-audiences.rfc.md
3000.036.000.000-union-sync-audiences.rfc.md
3000.036.004-security-invariants-and-exposure.rfc.md
3000.036.005-changes-as-an-event-stream.rfc.md
3000.037-app-farm-new-project-friction.research.md
3000.038-file-assets.rfc.md
3000.038.000-durable-offline-media-intents.rfc.md
3000.039-a-reference-declares-what-deleting-its-row-does.rfc.md
3000.040-bounded-ints-calendar-months-and-small-table-caps.rfc.md
# LLP 0000: Snapback

**Type:** Explainer
**Status:** Active
**Systems:** Project
**Role:** Root
**Author:** Charlie Cheever / Codex
**Date:** 2026-06-25
**Revised:** 2026-08-25 (LLP v2 larger kernel: `llp/foundation/` links
0000, 0002, 0031, and the nine standing decisions 0033, 0037, 0148, 0189,
0192, 0225, 0226, 0298, 0303 — each `Active`)
**Revised:** 2026-08-25 (LLP v2 overlay adoption: `llp/current/` is the
declared working set and `llp/foundation/` is the kernel; documents keep
their path for life and `Tombstoned` is a status, not a directory)
**Revised:** 2026-08-13 (ratification ledger records the optimistic-landing
author ruling governed by LLP 0232 and LLP 0189)
**Revised:** 2026-08-03 (author promotion after the dual-family super-refine loops: LLP 0159 and LLP 0161 move Draft → Active, LLP 0160 is Accepted — its gap ledger becomes the migration-experience program, with its OQ6/OQ7 conform-or-amend rulings still open); 2026-08-03 (Program D closeout: the local Phase-1 observability
kernel and local Phase E0/E1 backend error grouping/triage surface now point
to their shipped guide pages and retained evidence. Hosted observability,
declared product analytics, LLP 0156 E2 alert delivery, and E3 client crash
ingest remain deferred by their owning phases and are unbuilt.)
**Revised:** 2026-08-03 (related index catches up LLPs 0148 and 0150–0161 and gains Draft LLP 0162, the bounded agent-safe storage profile derived from LLP 0161; this index update does not ratify the Draft documents); 2026-08-02 (reserved Observability now points to Accepted LLP 0154 and the shipped local Phase-1 guide; hosted arms, product analytics, and error grouping remain follow-ons); 2026-08-02 (related index gains Draft LLP 0155, the local-sync product-direction RFC synthesizing the Zero/Replicache bakeoff into six Snapback-native moves; it does not alter Accepted LLP 0129's sequencing or option-admission authority). 2026-08-01 (related index catches up Draft LLP 0146, the agentic-authoring-affordances RFC, and Draft LLP 0147, the ahead-of-time compiled microclient RFC; adds Draft Research LLP 0149 on agent-native application consumption; LLP 0148 remains reserved on a parallel ref). 2026-08-01 (related index gains Draft LLP 0144, the declared application refusal codes RFC — the option space for payload contracts, typed rejection unions, conformance fixtures, dispositions, and action-boundary composition over the landed LLP 0108 first slice). 2026-08-01 (related index gains Draft LLP 0145, the comparative client-bundle architecture research; no client contract changes). 2026-08-02 (LLP 0141 moves to Implemented for its ratified D1/D4/D5 embedding scope; D2/D3 remain demand-gated and D6 remains unscheduled). 2026-08-01 (related index gained LLP 0141, then Draft, and Draft LLP 0142, the tabled bring-your-own ORM compatibility research; neither changed the current product direction at introduction). 2026-08-01 (related index gains Draft LLP 0140, the Vite/Rolldown/Oxc toolchain-convergence plan; also catches up the already-landed LLP 0139 file-upload bakeoff). 2026-07-31 (related index gains Draft LLP 0138, the focused Snapback versus Zero local-sync bakeoff with a separate Replicache offline-write control). 2026-07-31 (related index gains Draft LLP 0137, the React-web improvement sweep with a deferred backend championship phase and Expo/Exact native sweeps). 2026-07-30 (related index gains Draft LLP 0115, the Convex-parity course-corrections plan sequencing the Diary 0039 rerun's gap-closure work). 2026-07-30 (numbering reconciliation: root index completed to cover all current LLPs 0001–0114 — adds the entries that had lagged the tree (0055, 0056, 0090–0101, 0103–0105, 0107, 0108–0114); no renumbering needed, the on-disk sequence is contiguous and collision-free). 2026-07-28 (related index gains Draft LLP 0106, the agent-native Expo account bootstrap RFC). 2026-07-28 (related index gains Draft LLP 0102, the seven-backend, five-app bakeoff and Snapback learning program). 2026-07-23 (merge reconciliation: preserves the root-index catch-up through LLP 0089, the restored LLP 0080/0081 follow-ons, and the serverless-mesh boundary marker from LLP 0084/0086). 2026-07-23 (Non-goals gains the serverless-mesh boundary marker: the "works with no server, ever" segment — Ditto's, LLP 0084 — named as deliberately unserved per LLP 0086 CC-8 row 13; related index gains LLP 0084 and LLP 0086). 2026-07-22 (related index gains Draft LLP 0074, the Convex-competitive strategy distilled from the Partitime and chat matrices). 2026-07-21 (benchmark-figure reconciliation: the 2026-07-02 fan-out figures in the decision ledger are marked superseded fixture results per the `37f1a2f` corrections — LLP 0035's 2026-07-21 note, LLP 0067 Recommendation 1). 2026-07-15 (related index gains LLP 0061 — the agent-first Snapback guide RFC, adapting Exact LLP 0365's pattern as an independent corpus with a defined seam). 2026-07-15 (author ratification: after ENG-25001 closed the material cross-family review findings and each document's final targeted reviews returned READY, Charlie Cheever accepted LLPs 0057–0060; this accepts LLP 0060's hosted-security contract without claiming that the current local target is hosted-auth ready or advancing frozen LLP 0039). 2026-07-14 (auth-program implementation reconciliation: the complete local item-1-through-item-8 train now has executable route policy, provider/session state, staged shared authority, connection/revocation coordination, protected-query invalidation, authority-descriptor/two-axis storage, and lease-bounded retained reads; LLP 0060 keeps hosted auth honestly disabled on the local bearer target; this records implementation without accepting the Draft implementation Specs). 2026-07-13 (earlier latest: LLP 0054 added — a primary-source TigerBeetle research pass recommending deterministic simulation, crash/reopen fault injection, coherent resource bounds, paired invariants, and measured batching without adopting a custom storage engine; earlier: ENG-24596 records the implemented-but-activation-fenced local auth provider core under LLP 0057 and adds it to the root lineage; earlier: the ratification ledger narrowly refines the 2026-07-02 auth/sync decision in favor of LLP 0053's acceptance-gated authorization-invalidation contract while preserving server authority, fail-closed stale handling, user-switch wipe, and fresh authorized snapshots; earlier: the deliberate All Aboard no-subscriber window records settled idle-to-zero evidence for the Cloudflare proof, and the root index gains LLP 0050; earlier: LLP 0049 added — the All Aboard Cloudflare live-data plan tying deploy-time secrets, action egress, and warm polling to the Cloudflare proof; earlier: the Cloudflare durable-store decision ratified — everything on Durable Objects, ledgered below; LLP 0048 added — the V8 conformance twin executing the DK-5 re-decision, ledgered below; earlier: gap-closure RFCs LLP 0039-0047 added for auth, Cloudflare, packaged dev loop, MCP, offline replay, assets, notifications, Postgres, and hosted execution limits. Earlier, 2026-07-05: related index gains LLP 0038, a whole-system review. Earlier, 2026-07-02: decision ledger: DK-5 twin deferred and DK-9 store-agnostic client store decided (X2/X4); @snapback/* namespace and DK-10 adapter-owned live push decided — the P5/P6 close-out artifacts re-landed 2026-07-03 via ENG-22680; LLP 0036 → Accepted; LLP 0011 v1 auth/sync direction ratified; same day: DK-1/E3 host-plan mutation isolation decided — Option A, client-supplied read_set baseline by design, pending Charlie's ratification (DK-1 fully resolved); DK-3 op-log deltas landed and DK-4 warm-VM leg shipped; DK-2 commit-version graduation decided — LLP 0007 §Commit-version graduation — and DK-7 schema source of truth decided — LLP 0037; related index gains LLP 0034 and LLP 0037; related LLP index and follow-on list updated for LLP 0036; earlier: related LLP index updated for LLP 0031, LLP 0032, LLP 0033, and LLP 0035)
**Related:** LLP 0001, LLP 0002, LLP 0003, LLP 0004, LLP 0005, LLP 0006, LLP 0007, LLP 0008, LLP 0009, LLP 0010, LLP 0011, LLP 0012, LLP 0013, LLP 0014, LLP 0015, LLP 0016, LLP 0017, LLP 0018, LLP 0019, LLP 0020, LLP 0021, LLP 0022, LLP 0023, LLP 0024, LLP 0025, LLP 0026, LLP 0027, LLP 0028, LLP 0029, LLP 0030, LLP 0031, LLP 0032, LLP 0033, LLP 0034, LLP 0035, LLP 0036, LLP 0037, LLP 0038, LLP 0039, LLP 0040, LLP 0041, LLP 0042, LLP 0043, LLP 0044, LLP 0045, LLP 0046, LLP 0047, LLP 0048, LLP 0049, LLP 0050, LLP 0051, LLP 0052, LLP 0053, LLP 0054, LLP 0055, LLP 0056, LLP 0057, LLP 0058, LLP 0059, LLP 0060, LLP 0061, LLP 0062, LLP 0063, LLP 0064, LLP 0065, LLP 0066, LLP 0067, LLP 0068, LLP 0069, LLP 0070, LLP 0071, LLP 0072, LLP 0073, LLP 0074, LLP 0075, LLP 0076, LLP 0077, LLP 0078, LLP 0079, LLP 0080, LLP 0081, LLP 0082, LLP 0083, LLP 0084, LLP 0085, LLP 0086, LLP 0087, LLP 0088, LLP 0089, LLP 0090, LLP 0091, LLP 0092, LLP 0093, LLP 0094, LLP 0095, LLP 0096, LLP 0097, LLP 0098, LLP 0099, LLP 0100, LLP 0101, LLP 0102, LLP 0103, LLP 0104, LLP 0105, LLP 0106, LLP 0107, LLP 0108, LLP 0109, LLP 0110, LLP 0111, LLP 0112, LLP 0113, LLP 0114, LLP 0115, LLP 0116, LLP 0117, LLP 0118, LLP 0119, LLP 0120, LLP 0121, LLP 0122, LLP 0123, LLP 0124, LLP 0125, LLP 0126, LLP 0127, LLP 0128, LLP 0129, LLP 0130, LLP 0131, LLP 0132, LLP 0133, LLP 0134, LLP 0135, LLP 0136, LLP 0137, LLP 0138, LLP 0139, LLP 0140, LLP 0141, LLP 0142, LLP 0143, LLP 0144, LLP 0145, LLP 0146, LLP 0147, LLP 0148, LLP 0149, LLP 0150, LLP 0151, LLP 0152, LLP 0153, LLP 0154, LLP 0155, LLP 0156, LLP 0157, LLP 0158, LLP 0159, LLP 0160, LLP 0161, LLP 0162, https://github.com/ccheever/ibex, https://github.com/expo/valet, https://github.com/ccheever/llp

## Summary

Snapback is a complete backend for application projects. It is designed to
**scale to zero** — to be so light that an idle app costs almost nothing and
needs no babysitting, letting you prototype without worry — while being built so
the same system can **scale up** to the workload of any realistically popular
production app.

It is **comprehensive and coherent**: it aims to give you everything a backend
needs under one roof, with the pieces designed to work together rather than
bolted on, a bit like Ruby on Rails. And it is **truly open** — MIT licensed,
with no source-available restrictions that would stop you from hosting it for
other people.

This document is the root of the Snapback LLP corpus. It captures the project's
intent, its subsystem boundaries, and the non-obvious constraints that every
follow-on design and every line of code is expected to respect. It reflects the
founder's stated direction for the project as of the date above. Treat the
direction here as active; treat subsystem details as boundary-level guidance
until follow-on LLPs turn them into implementation specs.

The corpus is flat under `llp/`. `llp/foundation/` links the kernel documents
from which the design could be recreated; `llp/current/` links the declared
working set. A document keeps its path for its whole life — `Tombstoned` and
`Superseded` are header statuses, not directories. `reviews/`, `current/`, and
`foundation/` are reserved names. Orient from `foundation/`, then `current/`,
then the `@ref`s in scope.

## Source and ratification

This document is based on Charlie Cheever's Snapback project brief from
2026-06-25 and the same-day review/revision pass over the README and LLP corpus.
Charlie is the ratifying source for the product direction captured here. Future
LLPs should preserve this distinction: this root document states the current
direction, while subsystem LLPs define the specific contracts agents implement.

A cross-family review of this document (Claude / Anthropic) was recorded under
[`llp/reviews/0000-snapback.claude.md`](./reviews/0000-snapback.claude.md) on
2026-06-25. Editorial clarifications from it have been applied to sharpen wording
and surface gaps; they do not change the ratified product direction, which
remains Charlie's to set.

exec
/bin/bash -lc "rg -n 'struct PolicyComparison|impl.*PolicyComparison|align_current_schema|@ref' snapback4/crates/snapback4-lang/src/release_bridge.rs; sed -n '1,160p' snapback4/crates/snapback4-lang/src/release_bridge.rs; sed -n '160,260p' snapback4/crates/snapback4/src/verbs/releases.rs; sed -n '820,970p' snapback4/crates/snapback4-lang/tests/release_bridge_security.rs" in /home/ccheever/projects/sb4-b27-rel
 succeeded in 0ms:
2:// @ref LLP 3000.000.000.002#8-wave-21-release-evolution — generated source is reviewable; no automatic business-policy synthesis.
10:pub use super::release_bridge_indexes::align_current_schema;
23:    // @ref LLP 3000.000.000#21-wave-27-release-semantics-rel — column authority alone is not a visibility risk.
243:    let current_authority=match align_current_schema(&bound.schema,&sources,&current_bound.schema,current,&aliases) {
434:    let aligned=align_current_schema(&old.schema,target,&next.schema,current,&aliases)?;
435:    fn implies(rule:&RuleExpr,policy:&RuleExpr,policies:&PolicyComparison<'_>)->bool{
469:        // @ref LLP 3000.000.000#21-wave-27-release-semantics-rel — finite control flow preserves a stable leading guard; scope changes do not.
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
            let (tokens,_)=lexer::lex(&module,&text);
            (module,tokens.into_iter().map(|t|(t.kind,t.value)).collect())
        }).collect()
    }
    signature(target)==signature(current)
}

pub fn loosen(target:&[(String,String)],current:&[(String,String)])->Bridge {
    let mut bridge=loosen_inner(target,current);
    for diagnostic in &mut bridge.diagnostics {
        if diagnostic.site.line==0 {
            let docs=current.iter().map(|(f,t)|parser::parse_document(f,t).0).collect::<Vec<_>>();
            diagnostic.site=docs.iter().flat_map(|d|&d.programs).find(|p|diagnostic.message.contains(&p.name)).map(|p|p.site.clone())
                .or_else(||docs.iter().flat_map(|d|&d.tables).find_map(|t|t.columns.iter().find(|c|diagnostic.message.contains(&format!("{}.{}",t.name,c.name))).map(|c|c.site.clone())))
                .or_else(||docs.iter().flat_map(|d|&d.tables).next().map(|t|t.site.clone()))
                .unwrap_or_else(||crate::Site::new(current.first().map(|s|s.0.as_str()).unwrap_or("schema.q"),1,1));
        }
    }
    bridge
}
fn loosen_inner(target:&[(String,String)],current:&[(String,String)])->Bridge {
    let current_bound=crate::compile(current);
    if current_bound.schema.extractions.iter().any(|e|!e.each)||!current_bound.invariants.is_empty()||current_bound.schema.tables.values().any(|t|!t.column_writes.is_empty()||!t.frozen_columns.is_empty()) {
        let mut allow_guarded=false;
        let complete=super::release_bridge_current::prepare(target,current,&mut allow_guarded);
        if complete.diagnostics.is_empty() || !allow_guarded{return complete;}
        // A complete current closure is preferred, but a selective guarded
        // predecessor is also truthful when its retained contracts compile.
        let guarded=super::release_bridge_current::guarded(target,current);
        if guarded.diagnostics.is_empty(){return guarded;}
        return guarded;
    }
    let guarded=loosen_guarded(target,current);
    if !guarded.diagnostics.is_empty(){
        let complete=super::release_bridge_current::prepare(target,current,&mut false);
        if complete.diagnostics.is_empty(){return complete;}
        let current_bridge=super::release_bridge_current::guarded(target,current);
        if current_bridge.diagnostics.is_empty(){return current_bridge;}
    }
    guarded
}

fn loosen_guarded(target:&[(String,String)],current:&[(String,String)])->Bridge {
    let new: BTreeMap<_,_>=current.iter().flat_map(|(file,text)|parser::parse_document(file,text).0.tables.into_iter().map(move|t|(t.name.clone(),(file,text,t)))).collect();
    let mut new=new;
    for (_,(_,_,table)) in new.clone() {if let Some(old)=&table.renamed_from {if let Some(value)=new.get(&table.name).cloned(){new.insert(old.clone(),value);}}}
    for(file,text)in target {for old in parser::parse_document(file,text).0.tables {if let Some(prior)=&old.renamed_from {if !new.contains_key(&old.name){if let Some(value)=new.get(prior).cloned(){new.insert(old.name.clone(),value);}}}}}
    let mut domain_diagnostics=Vec::new();let mut changes=Vec::new();let mut affected=std::collections::BTreeSet::new();let mut sources=target.to_vec();let mut names=std::collections::BTreeSet::new();
    for (file,text) in &mut sources {
        let document=parser::parse_document(file,text).0;let mut edits=Vec::new();
        for table in &document.tables {
            names.insert(table.name.clone());
            let Some((_,_,next))=new.get(&table.name) else {continue};
            if next.name!=table.name {affected.insert(table.name.clone());changes.push(format!("table {}: current spelling {}; target spelling routes the same identity",table.name,next.name));}
            for column in &table.columns {
                let Some(candidate)=next.columns.iter().find(|c|c.name==column.name || c.renamed_from.as_ref()==Some(&column.name)||column.renamed_from.as_ref()==Some(&c.name)) else {continue};
                if candidate.name!=column.name {affected.insert(table.name.clone());changes.push(format!("{}.{}: current column spelling {}; target spelling routes the same cell",table.name,column.name,candidate.name));}
                let Some(joined)=join(&column.type_,&candidate.type_,&new) else {domain_diagnostics.push(crate::diag::type_error(&column.site,format!("rollback view for {}.{} has incompatible predecessor/current domains {} / {}",table.name,column.name,print::scalar_type(&column.type_),print::scalar_type(&candidate.type_)),"author a truthful compatible source and typed migration before deploying").guide("deploy"));continue};
                // A current guard may rely on a value being impossible under its
                // schema. Never reintroduce predecessor-only values behind that
                // same predicate merely because another column needs widening.
                let mut current_domain=join(&candidate.type_,&candidate.type_,&new).unwrap();
                let mut joined_domain=joined.clone();
                fn normalize(t:&mut ast::ScalarType,tables:&BTreeMap<String,(&String,&String,ast::TableDecl)>){
                    match &mut t.kind {
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
}

pub(super) fn command_lock(dir: &Path) -> Result<std::fs::File, String> {
    #[cfg(unix)]
    {
        let file = snapback4_core::private_fs::auxiliary_file(
            &dir.join("store.sqlite"),
            &dir.join(".release-command"),
            true,
            0,
        )
        .map_err(|e| e.to_string())?;
        file.lock().map_err(|e| e.to_string())?;
        Ok(file)
    }
    #[cfg(not(unix))]
    Err("release commands require Unix".into())
}
fn target(dir: &Path) -> Result<Option<Owner>, String> {
    match deployment_lock(dir) {
        Ok(owner) => Ok(Some(owner)),
        Err(error) if error.contains("E_STORE_BUSY") => Ok(None),
        Err(error) => Err(error),
    }
}
fn activation_target(dir: &Path) -> Result<(Option<Owner>, serde_json::Value), String> {
    let started = std::time::Instant::now();
    let owner = match crate::store_owner::release_command(&dir.join("store.sqlite")) {
        Ok(owner) => Some(owner),
        Err(error) if error.contains("E_STORE_BUSY") => None,
        Err(error) => return Err(error),
    };
    match status(dir, owner.as_ref(), 0, None, None) {
        Ok(held) => Ok((owner, held)),
        // Status is read-only: a shutting-down control socket cannot have
        // admitted activation. Never repeat a deploy/rollback control request.
        Err(control_error) if owner.is_none() => {
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

#[test]
fn exact_source_null_insert_does_not_grant_a_protected_value_write() {
    let old="table docs:\n  body: text <=40 ?\n  public\n  insert <- allow\n  online only\nmutation add():\n  return insert docs {body:null}\n";
    let current=old.replace("body: text <=40 ?\n","body: text <=40 ? write <- deny\n");
    assert!(release_bridge::exact_write_authority(&[("schema.q".into(),old.into())],&[("schema.q".into(),current)]).is_ok());
}

#[test]
fn exact_source_guard_keeps_named_probe_meaning_without_printing_current_policy() {
    let old="table roles:\n  principal: principal\n  delegate: principal\n  unique byPrincipal: principal\n  unique byDelegate: delegate\n  public\n  online only\ntable docs:\n  body: text <=40\n  public\n  insert <- allow\n  online only\nmutation add(body: text <=40):\n  require exists roles[principal = viewer] else NO\n  return insert docs {body}\n";
    let unrelated="table roots:\n  public\n  online only\ntable leaves:\n  root: roots on delete cascade\n  cap 3 by root\n  public\n  online only\n";
    let before=old.to_owned()+unrelated;
    let current=before.replace("body: text <=40\n","body: text <=40 write <- exists roles[principal = viewer] or exists admins[viewer]\n")+"table admins:\n  principal: principal\n  unique principal\n  public\n  online only\n";
    assert!(compile(&[("schema.q".into(),current.clone())]).diagnostics.is_empty());
    assert!(release_bridge::exact_write_authority(&[("schema.q".into(),before)],&[("schema.q".into(),current)]).is_ok());
}

#[test]
fn exact_source_equal_policy_ir_cannot_hide_a_changed_index_key() {
    let old="table roles:\n  principal: principal\n  delegate: principal\n  unique gate: principal\n  public\n  online only\ntable docs:\n  body: text <=40 write <- exists roles[principal = viewer]\n  public\n  insert <- allow\n  online only\nmutation add(body: text <=40):\n  return insert docs {body}\n";
    let current=old.replace("unique gate: principal","unique gate: delegate").replace("exists roles[principal = viewer]","exists roles[delegate = viewer]");
    assert!(release_bridge::exact_write_authority(&[("schema.q".into(),old.into())],&[("schema.q".into(),current)]).is_err());
}

exec
/bin/bash -lc "cat snapback4/crates/snapback4-lang/src/release_bridge_policy.rs; cat snapback4/crates/snapback4-lang/src/release_bridge_indexes.rs; rg -n 'requirements|invariant' snapback4/crates/snapback4-lang/src/bind/invariant*; rg -n 'pub fn write_tables|enum Expr|enum Stmt' snapback4/crates/snapback4-core/src/ir.rs" in /home/ccheever/projects/sb4-b27-rel
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
rg: snapback4/crates/snapback4-lang/src/bind/invariant*: IO error for operation on snapback4/crates/snapback4-lang/src/bind/invariant*: No such file or directory (os error 2)
153:pub enum Stmt {
219:pub enum Expr {
922:pub fn write_tables(program: &Program) -> Vec<(String, &'static str)> {

exec
/bin/bash -lc "sed -n '150,360p' snapback4/crates/snapback4-core/src/ir.rs; sed -n '910,1040p' snapback4/crates/snapback4-core/src/ir.rs; rg -n 'requirements|invariants' snapback4/crates/snapback4-lang/src/security snapback4/crates/snapback4-lang/src | head -100" in /home/ccheever/projects/sb4-b27-rel
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
rg: snapback4/crates/snapback4-lang/src/security: No such file or directory (os error 2)
snapback4/crates/snapback4-lang/src/release_bridge_rules.rs:174:            // immutable fields and final-existence requirements verbatim.
snapback4/crates/snapback4-lang/src/release_bridge_guards.rs:252:            // Keep the old workflow; add current requirements after its reads,
snapback4/crates/snapback4-lang/src/guide.rs:74:    ("invariants", "security"), ("invariant", "security"), ("audit", "security"), ("privacy", "security"),
snapback4/crates/snapback4-lang/src/parser/security.rs:18:        self.document.invariants.push(InvariantDecl { table, target, column, value, site });
snapback4/crates/snapback4-lang/src/parser/expr.rs:387:                    "pin a full unique key and compare the row field outside the brackets, or use a bounded program `exists table[key] where .column != value`; program probes see only caller-readable rows, while table-rule probes see all rows; use unique/cap/after insert constraints for invariants across hidden rows"));
snapback4/crates/snapback4-lang/src/release_bridge_current.rs:150:        for inv in &doc.invariants {
snapback4/crates/snapback4-lang/src/release_bridge_current.rs:400:    for inv in &mut inspect.invariants {
snapback4/crates/snapback4-lang/src/release_bridge_current.rs:467:    for inv in &doc.invariants {
snapback4/crates/snapback4-lang/src/release_bridge_current.rs:515:    other.invariants.clear();
snapback4/crates/snapback4-lang/src/release_bridge.rs:20:        && !crate::compile(current).invariants.is_empty()
snapback4/crates/snapback4-lang/src/release_bridge.rs:118:    if current_bound.schema.extractions.iter().any(|e|!e.each)||!current_bound.invariants.is_empty()||current_bound.schema.tables.values().any(|t|!t.column_writes.is_empty()||!t.frozen_columns.is_empty()) {
snapback4/crates/snapback4-lang/src/release_bridge.rs:495:        proof.invariants.iter().any(|inv|inv.table==table&&inv.operation.as_deref()==Some(operation)
snapback4/crates/snapback4-lang/src/release_bridge.rs:496:            &&inv.requirements.iter().any(|require|stable(require)&&implies(require,policy,&comparison)
snapback4/crates/snapback4-lang/src/release_bridge_indexes.rs:158:        for invariant in &mut doc.invariants {crate::bind::intent_walk::expression(&mut invariant.value,&mut visit);}
snapback4/crates/snapback4-lang/src/lib.rs:66:        return Bound { rollback_hides:Vec::new(), invariants: Vec::new(), receipt_members: Default::default(), refusal_sites: Default::default(), view_types: Default::default(), server: documents.iter().any(|doc| doc.server), schema: Default::default(), programs: Vec::new(), personas: Vec::new(), diagnostics, notes: Vec::new() };
snapback4/crates/snapback4-lang/src/ast.rs:579:    pub invariants: Vec<InvariantDecl>,
snapback4/crates/snapback4-lang/src/guide/security.md:1:# Security invariants
snapback4/crates/snapback4-lang/src/guide/security.md:37:Review `snapback/generated/security-invariants.q.draft`: each role gets a row
snapback4/crates/snapback4-lang/src/guide/security.md:163:  An ordinary mutation with stable role requirements can prove that mutation's
snapback4/crates/snapback4-lang/src/guide/security.md:403:N_TABLE_QUESTIONNAIRE: Role-wide access and restating invariants share one table questionnaire. Answer from the specification; JSON retains every underlying note and individual decision ID. The grouped line is advisory and has no separate ID. This is a specification question, never a proof or a new gate.
snapback4/crates/snapback4-lang/src/bind/security.rs:46:    pub requirements: Vec<RuleExpr>,
snapback4/crates/snapback4-lang/src/bind/security.rs:56:    for decl in catalog.documents.iter().flat_map(|d| &d.invariants) {
snapback4/crates/snapback4-lang/src/bind/security.rs:76:        let requirements=named_operation.as_ref().map(|(_,p)| operation::requirements(catalog,info,p)).unwrap_or_default();
snapback4/crates/snapback4-lang/src/bind/security.rs:77:        out.push(Invariant{operation:named_operation.map(|(name,_)|name),requirements,syntax:Some(decl.value.clone()),table:decl.table.clone(),target:decl.target.clone(),column:decl.column.clone(),predicate:crate::print::expression(&decl.value),site:decl.site.clone(),policy,unsupported});
snapback4/crates/snapback4-lang/src/bind/security.rs:99:    pub invariants: Vec<Verdict>,
snapback4/crates/snapback4-lang/src/bind/security.rs:107:    pub fn refuted(&self)->bool {self.invariants.iter().any(|v|v.status==Status::Refuted&&v.counterexample.as_ref().is_some_and(|c|c.reachability.is_reachable()))}
snapback4/crates/snapback4-lang/src/bind/security.rs:112:        for v in &self.invariants {
snapback4/crates/snapback4-lang/src/bind/security.rs:147:    if report.invariants.iter().any(|v|v.invariant.target=="read"&&v.direct_rule!=Status::Proved){
snapback4/crates/snapback4-lang/src/bind/security.rs:157:    for inv in &bound.invariants {
snapback4/crates/snapback4-lang/src/bind/security.rs:196:    if !missing.is_empty() {notes.push(Diagnostic::new(&Site::default(),"N_SECURITY_INTENT",format!("{} tables have access rules and no security invariants: {}; declare the spec's privacy rules as invariants (`guide security`)",missing.len(),missing.join(", ")),"review snapback/generated/security-invariants.q.draft against the spec; candidates are never auto-accepted").guide("security"));}
snapback4/crates/snapback4-lang/src/bind/security.rs:200:        exclusions:vec!["system-principal trust boundary".into(),"physical timing, examined counts and resource/meter side channels".into(),"offline access may use a snapshot predating server revocation".into()],invariants:verdicts,exposures,roles,notes,uncovered,campaign_coverage:BTreeSet::new()}
snapback4/crates/snapback4-lang/src/guide/cheatsheet.md:197:`npx snapback4 audit`. State invariants from the spec's roles, resource relationships
snapback4/crates/snapback4-lang/src/bind/write_affordances.rs:41:// @ref LLP 3000.036.002#7 — these notes state conditional argument requirements, never an impossibility theorem over dynamic inputs.
snapback4/crates/snapback4-lang/src/bind/mod.rs:84:    pub invariants: Vec<security::Invariant>,
snapback4/crates/snapback4-lang/src/bind/mod.rs:421:    let invariants = security::bind(&catalog, &mut diagnostics);
snapback4/crates/snapback4-lang/src/bind/mod.rs:428:    Bound { rollback_hides, invariants, receipt_members, refusal_sites, view_types, server, schema, programs, personas, diagnostics, notes }
snapback4/crates/snapback4-lang/src/guide/bounds.rs:161:diagnostics: check --args types, --query requirements or held coverage respectively. Failed receipts retain caller query/args.
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
snapback4/crates/snapback4-lang/src/guide/testing.md:47:`test` names invariants it cannot fully evaluate, including unsupported clock,
snapback4/crates/snapback4-lang/src/guide/rule_recipes_wave15.md:404:The expected-version check and increment are application invariants in this
snapback4/crates/snapback4-lang/src/guide/start.rs:10:        let mut text = String::from("# Start here: the common application path\n\nDefault loop: check, edit with dev, then deploy staging --staging and serve staging for shared previews and probe:serve. Run `snapback4 guide staging` for real password users, operator-provisioned roles and replayable first-admin. Staging clock: `guide time` (MIG). Read these eight patterns in order; each named card continues with its complete reference. Writing rules includes writing independent privacy invariants from the spec. Start with `snapback4 guide security`: run `snapback4 check` → `snapback4 test` → `snapback4 audit`. Check asks which roles and row conditions each rule admits. Answer from the spec: may this role see other owners' rows, this column, and every lifecycle state? Answer the per-role/per-column questions in snapback/generated/security-invariants.q.draft, write independent read invariants, repair wider rules, then repeat the loop. Keep confirmed simple owner intent. Test synthesizes per-role fixtures even for password-only apps, and audit lists uncovered role/column exposures. Examples identify their schema context; copy the full recipe when starting without it. Calling the backend without the JS client (curl, scripts, other languages): `snapback4 guide wire`. A browser app that writes needs `createApp`: with no synced table it needs no device (writes are journaled in localStorage, no wasm), and synced tables need `webDevice()`, about 650 KB gzip of wasm fetched when a session opens (`guide client`). A page that staff read whole and members read their own rows of is one query that branches on the grant: `if exists staff[viewer]:` returns the whole page, then `return requests where .author = viewer …` answers the rest; both are complete (`guide roles`, compiled in `guide cheatsheet`).\n\n");
snapback4/crates/snapback4-lang/src/bind/residency/horizons/sync_order.rs:19:            // requirements: changing their page order cannot establish them.
snapback4/crates/snapback4-lang/src/guide/why/EMPTY_READ.md:21:  and coverage requirements. Match the arguments and viewer of the empty read.
snapback4/crates/snapback4-lang/src/guide/codes.rs:2:    ("N_TABLE_QUESTIONNAIRE", "Role-wide access and restating invariants share one table questionnaire. Answer from the specification; JSON retains every underlying note and individual decision ID. The grouped line is advisory and has no separate ID. Advisory only. guide security."),
snapback4/crates/snapback4-lang/src/guide/codes.rs:47:    ("N_SECURITY_INTENT", "tables have access rules but no independent policy intent; declare invariants from the product spec; guide security."),
snapback4/crates/snapback4-lang/src/guide/codes.rs:233:    ("N_UNREADABLE_PROBE", "a program guard probes rows its caller may not read. Hidden rows are filtered by the target read rule; a negative guard cannot enforce global absence. Use a unique/cap/final constraint for cross-reader invariants; guide rules."),
snapback4/crates/snapback4-lang/src/guide/codes.rs:401:    ("N_SYNC_ORDER", "a note, not an error — a device-capable query pages a windowed table on another index (including a calendar index) or oldest first. Whole-domain aggregates and word indexes have separate coverage requirements and are outside this ordering advice. Its acquisition boundary proves only newest-first pages on the window's own index, within that boundary. The note names both orders and the source site. A paste-ready page uses last N on the window index, audience equalities in bracket keys, and the original predicates and cursor. It requires a cursor, a cap covering the whole group, or the same ordered columns already read newest first. A cursorless partial page in another order gets words because reordering could select different rows. Restart pagination when changing order; the full traversal keeps the same rows. Only scope-independent range endpoints can move into residual filters. Outer-row endpoints, generated membership lanes, explicit merges and projected views get the window order and index in words without a paste-ready replacement; one lane is not the whole read. Capped pages get last N from their bound scan. Otherwise the ordinary query needs the server; offline coverage is unknown. A held query stays on the device and reports incomplete coverage without server fallback. online only currently applies to tables and views, not query headers. guide sync."),
snapback4/crates/snapback4-lang/src/bind/security/authority_walk.rs:19:        Expr::Write{..}=>{let mut context=p.clone();context.prelude=Vec::new();context.body=guards.to_vec();if let Some(column)=column{for change in changes{if change.matches(e,column,p){context.body.extend(change.requirements.clone());}}}out.push((e.clone(),context));},
snapback4/crates/snapback4-lang/src/bind/security/authority_walk.rs:31:// Conditional/loop-local requirements never become caller assumptions.
snapback4/crates/snapback4-lang/src/bind/security/presentation.rs:20:        out.push(crate::Diagnostic::new(site,code,format!("{table}: confirm role, row relationship, lifecycle and private-column intent ({subjects}; {} underlying questions). Answer the per-table questionnaire in snapback/generated/security-invariants.q.draft; check --json keeps every audience, source site and individual review ID",notes.len()),"keep confirmed specification intent; narrow unintended authority; record individual decisions with check --ack-security <ID> --reason '<spec rationale>'").guide("security"));
snapback4/crates/snapback4-lang/src/bind/security/presentation.rs:58:        let failures = self.invariants.iter().filter(|v| v.status == Status::Refuted &&
snapback4/crates/snapback4-lang/src/bind/security/presentation.rs:78:        let proved = self.invariants.iter().filter(|v| v.status == Status::Proved).count();
snapback4/crates/snapback4-lang/src/bind/security/presentation.rs:79:        let refuted = self.invariants.iter().filter(|v|v.status==Status::Refuted).count();
snapback4/crates/snapback4-lang/src/bind/security/presentation.rs:80:        let unproved = self.invariants.len()-proved-refuted;
snapback4/crates/snapback4-lang/src/bind/security/presentation.rs:82:        let supplemental = self.invariants.iter().filter(|v| v.status == Status::Refuted &&
snapback4/crates/snapback4-lang/src/bind/security/presentation.rs:88:        if self.invariants.is_empty() {out.push_str("  next: answer snapback/generated/security-invariants.q.draft from the spec; declare intent and run snapback4 test\n");}
snapback4/crates/snapback4-lang/src/guide/sync.rs:150:aggregates and word searches have separate coverage requirements; this
snapback4/crates/snapback4-lang/src/guide/sync.rs:270:Current engines and devices refuse unknown requirements with `E_SCHEMA_CAPABILITY`, including when an explicit backend would replace an unsupported kept backend.
snapback4/crates/snapback4-lang/src/guide/sync.rs:315:Application invariants such as `else EVENT_REMOVED` keep their guards.
snapback4/crates/snapback4-lang/src/guide/sync.rs:362:`N_NO_HORIZON` can be suppressed by prediction requirements, and a cap per
snapback4/crates/snapback4-lang/src/guide/production.md:21:Write invariants from the specification: name which current roles may read each
snapback4/crates/snapback4-lang/src/bind/security/concrete.rs:138:        assert_eq!(evaluate(b.invariants[0].syntax.as_ref().unwrap(),&project,&rows,&b.schema,"viewer","projects",super::super::challenges::NOW),Some(true));
snapback4/crates/snapback4-lang/src/bind/security/privilege.rs:39:pub(super) fn membership_grant_risk(bound:&Bound,roster:&str,operation:&str,requirements:&[RuleExpr],op:ast::WriteOp,fields:&[ast::ObjectField])->bool{
snapback4/crates/snapback4-lang/src/bind/security/privilege.rs:40:    if op==ast::WriteOp::Upsert{return membership_grant_risk(bound,roster,operation,requirements,ast::WriteOp::Insert,fields)||membership_grant_risk(bound,roster,operation,requirements,ast::WriteOp::Update,fields);}
snapback4/crates/snapback4-lang/src/bind/security/privilege.rs:47:    let admission=RuleExpr::And(std::iter::once(write_admission(table,op,fields)).chain(requirements.iter().cloned()).collect());
snapback4/crates/snapback4-lang/src/bind/security/privilege.rs:50:    bound.invariants.iter().filter(|i|i.table==roster&&i.column.is_none()&&(i.operation.as_deref()==Some(operation)||i.operation.is_none()&&(i.target=="write"||i.target==if op==ast::WriteOp::Insert{"insert"}else{"update"}))).filter_map(|i|i.policy.as_ref()).any(|p|super::operation::safe(p)&&kernel::implies(&ordinary,p)==Ok(false))
snapback4/crates/snapback4-lang/src/bind/security/privilege.rs:70:pub(super) fn risk(bound:&Bound,roster:&str,column:&str,operation:&str,targets:&[String],op:ast::WriteOp,requirements:&[RuleExpr],dynamic:bool,fields:&[ast::ObjectField])->Option<String>{
snapback4/crates/snapback4-lang/src/bind/security/privilege.rs:71:    if op==ast::WriteOp::Upsert{return risk(bound,roster,column,operation,targets,ast::WriteOp::Insert,requirements,dynamic,fields).or_else(||risk(bound,roster,column,operation,targets,ast::WriteOp::Update,requirements,dynamic,fields));}
snapback4/crates/snapback4-lang/src/bind/security/privilege.rs:73:    if requirements.iter().any(|r|!r.disjuncts().is_empty()&&r.disjuncts().iter().all(|b|b.service_grant().is_some())){return None;}
snapback4/crates/snapback4-lang/src/bind/security/privilege.rs:75:    let intents=bound.invariants.iter().filter(|i|i.table==roster&&i.column.as_deref().is_none_or(|c|c==column)&&(i.operation.as_deref()==Some(operation)||i.operation.is_none()&&(i.target=="write"||i.target==if op==ast::WriteOp::Insert{"insert"}else{"update"}))).filter_map(|i|i.policy.as_ref()).collect::<Vec<_>>();
snapback4/crates/snapback4-lang/src/bind/security/privilege.rs:80:    let admission=RuleExpr::And(std::iter::once(write_admission(table,op,fields)).chain(requirements.iter().cloned()).collect());
snapback4/crates/snapback4-lang/src/bind/security/advice.rs:44:    let media=t.columns.values().any(ColumnType::contains_asset)||bound.invariants.iter().any(|i|i.table==name&&i.target=="read"&&i.column.is_some());
snapback4/crates/snapback4-lang/src/bind/security/advice.rs:109:            let requirements=catalog.tables.get(table).map(|info|super::operation::requirements(catalog,info,&context)).unwrap_or_default();
snapback4/crates/snapback4-lang/src/bind/security/advice.rs:127:                if gates.iter().any(|g|g.disjuncts().iter().any(|b|self_only(b,&f.name)&&requirements.iter().all(|r|self_only(r,&f.name))))&&seen.insert((table.clone(),f.name.clone())){
snapback4/crates/snapback4-lang/src/bind/security/advice.rs:128:                    let roles=requirements.iter().flat_map(|r|role_names(bound,r)).collect::<Vec<_>>();
snapback4/crates/snapback4-lang/src/bind/security/write_intent.rs:29:  for inv in &b.invariants {assert!(empty_creation(&b,inv,None,&row));assert!(!empty_creation(&b,inv,Some(&row),&row));assert_eq!(policy(&b,inv,"update"),inv.policy);}
snapback4/crates/snapback4-lang/src/bind/security/operation.rs:18:pub(super) fn requirements(catalog:&Catalog,info:&TableInfo,p:&ProgramDecl)->Vec<RuleExpr>{

exec
/bin/bash -lc "rg -n 'column_writes|frozen_columns|fn dependencies' snapback4/crates/snapback4-core/src snapback4/crates/snapback4-lang/src/security | head -100; rg -n 'deploy|rollback|write <-|immutable when|invariant' snapback4/crates/snapback4-lang/src/guide*.rs | head -70; sed -n '1540,1620p' llp/3000.000.000-retained-storage-and-hot-release.rfc.md" in /home/ccheever/projects/sb4-b27-rel
 succeeded in 0ms:
rg: snapback4/crates/snapback4-lang/src/security: No such file or directory (os error 2)
snapback4/crates/snapback4-core/src/schema/field_authority.rs:72:        for rule in table.column_writes.values().chain(table.frozen_columns.values()){private_rule(schema,name,rule,false,&mut issue);}
snapback4/crates/snapback4-core/src/schema/reservations.rs:97:    plan.server_only = !table.column_writes.is_empty() || !table.frozen_columns.is_empty();
snapback4/crates/snapback4-core/src/engine/column_writes.rs:6:    pub(super) fn check_frozen_columns(&mut self, name:&str, old:&Value, next:&Value)->Result<(),RuntimeError>{
snapback4/crates/snapback4-core/src/engine/column_writes.rs:8:        if table.frozen_columns.is_empty(){return Ok(());}
snapback4/crates/snapback4-core/src/engine/column_writes.rs:11:        for (field,condition) in &table.frozen_columns {
snapback4/crates/snapback4-core/src/schema/capabilities.rs:79:    ("column-write-v1", |s| s.tables.values().any(|t| !t.column_writes.is_empty() || !t.frozen_columns.is_empty())),
snapback4/crates/snapback4-core/src/engine/field_authority.rs:101:            for field in definition.column_writes.keys().chain(definition.frozen_columns.keys()) {
snapback4/crates/snapback4-core/src/schema/column_reads.rs:215:        for rule in table.column_writes.values().chain(table.frozen_columns.values()){walk.rule(name,rule,&path);}
snapback4/crates/snapback4-core/src/engine/timeline_authority_tests.rs:12:    let table = Table { ephemeral: None, sequences: Default::default(), column_writes: Default::default(), frozen_columns: Default::default(), column_reads: Default::default(), written_by: Default::default(), update_transition: false, through: None, on_delete: Default::default(), recorded: Default::default(), maintained: Default::default(), residency: Default::default(), defaults: Default::default(),
snapback4/crates/snapback4-core/src/schema.rs:41:pub mod column_writes;
snapback4/crates/snapback4-core/src/schema.rs:358:    pub column_writes: BTreeMap<String, RuleExpr>,
snapback4/crates/snapback4-core/src/schema.rs:360:    pub frozen_columns: BTreeMap<String, RuleExpr>,
snapback4/crates/snapback4-core/src/schema.rs:1111:        sequences: Default::default(), column_writes: Default::default(), frozen_columns: Default::default(), column_reads: Default::default(), written_by: Default::default(), update_transition: false, through: None, on_delete: BTreeMap::new(),
snapback4/crates/snapback4-core/src/schema.rs:1139:    issues.extend(column_writes::validate(schema));
snapback4/crates/snapback4-core/src/schema/column_writes.rs:7:        if self.column_writes.is_empty() || !matches!(effect,Effect::Insert|Effect::Update) { return base; }
snapback4/crates/snapback4-core/src/schema/column_writes.rs:9:        for (column,policy) in &self.column_writes {
snapback4/crates/snapback4-core/src/schema/column_writes.rs:20:        for (column,rule) in t.column_writes.iter().chain(&t.frozen_columns) {
snapback4/crates/snapback4-core/src/schema/column_writes.rs:21:            let path=format!("tables.{name}.column_writes.{column}");
snapback4/crates/snapback4-core/src/engine/write_target.rs:16:        if self.device&&self.schema.tables.get(table).is_some_and(|t|!t.column_writes.is_empty()||!t.frozen_columns.is_empty()){
snapback4/crates/snapback4-core/src/engine/write_target.rs:58:        let hidden_probes=table.column_writes.keys().chain(table.frozen_columns.keys()).filter_map(|c|table.column_reads.get(c)).map(rule_probes).fold(0u64,u64::saturating_add);
snapback4/crates/snapback4-core/src/engine/write_target.rs:59:        let frozen_probes=table.frozen_columns.values().map(rule_probes).fold(hidden_probes,u64::saturating_add);
snapback4/crates/snapback4-core/src/engine/write_target.rs:60:        let frozen_heap=table.frozen_columns.values().chain(table.column_writes.keys().chain(table.frozen_columns.keys()).filter_map(|c|table.column_reads.get(c))).map(|rule|self.rule_scratch(rule)).max().unwrap_or(0);
snapback4/crates/snapback4-core/src/store/asset_renames.rs:12:    table.column_writes=replace_keys(std::mem::take(&mut table.column_writes),map);
snapback4/crates/snapback4-core/src/store/asset_renames.rs:13:    table.frozen_columns=replace_keys(std::mem::take(&mut table.frozen_columns),map);
snapback4/crates/snapback4-core/src/store/asset_renames.rs:19:    for r in table.column_reads.values_mut().chain(table.column_writes.values_mut()).chain(table.frozen_columns.values_mut()){rule(r,map)}
snapback4/crates/snapback4-core/src/maintain.rs:128:    pub fn dependencies(&self) -> BTreeSet<String> {
snapback4/crates/snapback4-core/src/store/rollback_guard_population.rs:409:    if schema.tables.values().any(|t|t.frozen_columns.values().any(|r|json_taint(&serde_json::to_value(r).unwrap(),&BTreeSet::new(),hidden))) {return Err(refuse());}
snapback4/crates/snapback4-core/src/engine/mod.rs:117:mod column_writes;
snapback4/crates/snapback4-core/src/engine/mod.rs:1104:                if let Some(old)=&old {runner.check_frozen_columns(&name,old,&row)?;}
snapback4/crates/snapback4-core/src/engine/mod.rs:1173:                if mode==LoadMode::Import && let Some(old)=&old {runner.check_frozen_columns(&table_name,old,&row)?;}
snapback4/crates/snapback4-core/src/engine/write.rs:43:        if self.device && (!self.schema.tables[table_name].column_writes.is_empty() || !self.schema.tables[table_name].frozen_columns.is_empty() || self.schema.tables[table_name].not_before.is_some() || self.schema.tables[table_name].column_server_reads()) {
snapback4/crates/snapback4-core/src/engine/write.rs:272:        if self.device && (!self.schema.tables[table_name].column_writes.is_empty() || !self.schema.tables[table_name].frozen_columns.is_empty() || self.schema.tables[table_name].not_before.is_some() || self.schema.tables[table_name].column_server_reads()) {
snapback4/crates/snapback4-core/src/engine/write.rs:306:        if self.device && (!self.schema.tables[table_name].column_writes.is_empty() || !self.schema.tables[table_name].frozen_columns.is_empty() || self.schema.tables[table_name].not_before.is_some() || self.schema.tables[table_name].column_server_reads()) {
snapback4/crates/snapback4-core/src/engine/write.rs:400:        self.check_frozen_columns(table_name, &old, &new).map_err(|e|if readable{e}else{self.no_write_target()})?;
snapback4/crates/snapback4-core/src/engine/write.rs:416:        if self.device && (!self.schema.tables[table_name].column_writes.is_empty() || !self.schema.tables[table_name].frozen_columns.is_empty() || self.schema.tables[table_name].not_before.is_some() || self.schema.tables[table_name].column_server_reads()) {
69:pub const KEYWORDS: &[&str] = &["language", "from-sql", "app", "types", "recipes", "rule-recipes", "time", "indexes", "maintains", "totals", "offline-interactions", "rules", "sync", "sharing", "residency", "prediction", "evolution", "rename", "deploy", "release-json", "expire", "ephemeral", "assets", "client", "api", "wire", "social", "reads", "shapes", "writes", "cleanup", "sequences", "programs", "jobs", "native", "feeds", "search", "effects", "actions", "routes", "services", "presence", "receipts", "read-only", "manual-receipts", "bounds", "refusals", "personas", "testing", "witness", "start", "cheatsheet", "changes", "production", "staging", "security"];
74:    ("invariants", "security"), ("invariant", "security"), ("audit", "security"), ("privacy", "security"),
75:    ("schema", "language"), ("reference", "types"), ("references", "types"), ("principal", "personas"), ("principals", "personas"), ("first admin", "deploy"),
78:    ("release", "deploy"), ("serve", "deploy"), ("rollback", "deploy"), ("upgrade", "changes"), ("optional param", "types"), ("mutation default", "writes"), ("service seat", "deploy"),
79:    ("identity", "deploy"), ("password", "deploy"), ("tokens", "deploy"), ("migrations", "deploy"),
102:    ("recipe", "recipes"), ("roles", "recipes"), ("role", "recipes"), ("admin", "deploy"), ("rbac", "recipes"),
128:    ("backfill", "deploy"), ("fields", "types"), ("auth/headless", "personas"),
129:    ("migration", "deploy"), ("migrate", "deploy"), ("schema-evolution", "evolution"), ("adoption", "evolution"),
130:    ("releases", "deploy"), ("prune", "deploy"),
135:    ("auth", "personas"), ("signin", "deploy"), ("login", "deploy"), ("session", "personas"),
137:    ("headless", "personas"), ("signup", "deploy"), ("sign-up", "deploy"), ("register", "deploy"),
264:        "deploy" => include_str!("guide/deploy.md"),
397:fixture, offline `token`, `deploy`, `rollback`) lock its `-owner` sidecar for their lifetime.
446:`snapback4 doctor --repair-expiry-orphan table:id` (add `--release dir` for deployed
remain outside replaced type spans. Mappings must be injective and cannot capture table, argument,
local-binding or shape names. Derived declarations, migrations, deliveries,
actions/effects, recursive/merge expressions and unsupported source forms require
an authored compatible source. The adapted closure recompiles and must satisfy
the same complete predecessor contract checks. Multi-module sources may use the
unchanged current closure directly; automatic cross-module renaming is not
claimed. No runtime policy, default, selection order or value conversion is
synthesized. Native/worker bundle requirements remain in force. Both predecessor and current
stage automatic/named worker dependencies are checked; a newly introduced
current worker cannot disappear from a generated view. The CLI additionally
compares complete executable digests, excluding registration/compiler/location
metadata: changing only worker/native bytes behind unchanged Quarry intent
triggers preparation and the same bundle boundary. Identical executable content
remains a no-op. Until complete immutable
bundles are captured and qualified, those generated views refuse.

For a pre-0.4.39 deployment without registered views, default rollback either
succeeds under writer-enforced visibility or refuses atomically with the logical
target and both recovery steps: `rollback <deployment> --to N --exact` (preview
its hiding first) and "redeploy with 0.4.39 to register a view". An equal-source
redeploy with an obsolete/missing view set still performs registration rather
than returning an unqualified UNCHANGED receipt.

### 20.2 Writer-enforced visibility

Default rollback, even without a registered view, admits zero unacknowledged
hidden predecessor-table rows. Candidate preview also refuses uncovered hiding
on reverse snapshots. Future bad projections refuse selection under the writer.
Preview populations are privileged retained-row counts, not viewer guarantees.

The initial intentional-hiding spelling is:
`rollback N hides TABLE where COLUMN = null because 'REASON'`.
The candidate column must be nullable, the predecessor column nonnullable, and
table/column spellings identical. N is the immutable original. No arbitrary
predicate, blanket exemption or rename combination is admitted. Its view keeps
the null restriction while joining the nonnull domain: nullable 0..1000 versus
required 0..100 becomes required 0..1000, preserving widened nonnull values.
The nonempty reason travels in immutable metadata and repeats on selection.

Under the actual writer transaction, capture the before image, run full adoption,
then compare every retained hidden predecessor row. Only acknowledged null rows
and the actual hidden-reference closure rooted in them are allowed; unrelated
hidden rows refuse atomically. The closure graph contains only scalar/optional
nominal Ref cells in before-image active rows, as typed by the source schema;
ids are aligned through the catalog identity. An edge qualifies only when its
parent was also active before, is actually retained-hidden after adoption, and
has no invalid reference-lifetime marker. No list, synthetic extraction anchor,
asset, dormant overlay, cascade or set-null declaration invents an edge. A
renamed identity uses its same catalog number. Before-hidden rows are outside
this newly-hidden population; newer-only tables are distinguished. The snapshot
preview is advisory; concurrent writes cannot bypass activation revalidation.
Acknowledgment never changes physical preservation or permits broader read/write
authority. After collecting the actual newly hidden table set, the writer rejects
negative existence authority, reference comparisons that can admit absence, or
population-tainted requirements/control flow. Positive existence requirements
may only become denials. A direct point assertion may discharge absence taint:
if its row is hidden it aborts before subsequent work; its surviving field values
remain unchanged. Writes to affected existing targets require that same exact
point-presence guard. Transitive bindings and compiler-expanded helper bodies
are followed; unknown paths refuse. Tainted branch/loop/conditional-write keys AND persisted write values,
negative/count-based guard dependencies, nested job-query scope and maintained
populations depending on hidden sources are conservatively outside this initial
acknowledgment form. This is a closed syntactic admission check, not an inferred
semantic implication or a finite-snapshot security proof. Explicit reasons do
not bypass it. Source may retain the safety witness in a visible bridge instead.
Ordinary hidden-row occupancy/retention laws remain explicit in the preview;
intentional hiding supplies no promise of automatic forward conflict resolution.

Point-presence proofs discharge taint only for subsequent work in program
order on that exact table/key. A guard cannot justify any earlier tainted read
or write. Mutations/jobs retain their existing atomic transaction law: a later
refusal rolls back all prior writes in the operation, including work before a
point assertion. The population checker does not weaken that transaction law.

### 20.3 Edited transformation outputs

An edited in-place migration output reverses through an applicable down on its
assembled current image, or stays exact if the compiled selected view's full
type/constraints accept that physical value. This never widens a schema per row,
coerces, truncates, null-fills or invents defaults. Otherwise selection refuses.
Original preimage, actual authored newer output, prior computation and physical

exec
/bin/bash -lc "cat snapback4/crates/snapback4-lang/src/bind/security/operation.rs; cat snapback4/crates/snapback4-core/src/ir/writes.rs; cat snapback4/crates/snapback4-core/src/schema/column_writes.rs; cat snapback4/crates/snapback4-core/src/engine/column_writes.rs; sed -n '40,85p' snapback4/crates/snapback4-lang/src/bind/security.rs; rg -n 'pub fn dependencies|fn dependencies' snapback4/crates/snapback4-lang/src/bind/security/kernel.rs" in /home/ccheever/projects/sb4-b27-rel
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
//! Conditional immutability is a store constraint, including system updates.
// @ref LLP 3000.036.004.000#3-conditional-immutability — judge the preimage; unknown never permits a change.
use super::runner::Runner;
use crate::{schema::{Effect, RuleExpr, materialize_optional_fields}, error::{RuntimeError,MeterKind}, Value};
impl Runner<'_> {
    pub(super) fn check_frozen_columns(&mut self, name:&str, old:&Value, next:&Value)->Result<(),RuntimeError>{
        let table=&self.schema.tables[name];
        if table.frozen_columns.is_empty(){return Ok(());}
        let mut old=old.clone();materialize_optional_fields(&mut old,table);
        let mut next=next.clone();materialize_optional_fields(&mut next,table);
        for (field,condition) in &table.frozen_columns {
            if old.field(field).ok()==next.field(field).ok(){continue;}
            let rule=RuleExpr::Not(Box::new(condition.clone()));
            let permitted=self.authorized_scratch(self.rule_scratch(&rule), &[(MeterKind::RuleProbes,super::rules::rule_probes(&rule))], |runner,allowance|runner.evaluate_sequence_rule(allowance,name,&rule,Effect::Update,None,&old))?;
            if !permitted{return Err(RuntimeError::Constraint(format!("{name}.{field} is immutable while {} holds on the old row",condition.quarry())));}
        }
        Ok(())
    }
}
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
85:pub fn dependencies(rule: &R) -> BTreeSet<String> {

codex
The new comparison checks compiled probe keys, and the write-set traversal includes branches, loops and expression blocks. I’m now checking whether equal probe IR guarantees equal authority across releases, and whether the leading-require reduction uses the same bindings as runtime execution.
exec
/bin/bash -lc "sed -n '1,145p' snapback4/crates/snapback4-lang/src/bind/security/kernel.rs; cat snapback4/crates/snapback4-lang/src/guide/deploy.md | head -185; sed -n '145,185p' snapback4/crates/snapback4-lang/src/guide/security.md; rg -n 'Exists|is_expiring|through' snapback4/crates/snapback4-core/src/rules.rs snapback4/crates/snapback4-core/src/rules/*.rs" in /home/ccheever/projects/sb4-b27-rel
 exited 2 in 0ms:
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
# Deploy: upgrade, real accounts and schema evolution

A release is immutable source over one durable store. JSON fields, bounded ready waits and worker roots: `guide release-json`. Deploy from the app directory:

```sh
bunx snapback4 check
bunx snapback4 test
bunx snapback4 deploy ./deployment
bunx snapback4 serve ./deployment --port 4400
```
For Postgres, prefer `SNAPBACK4_STORE_URL` with explicit schema/ha=none and Unix sockets; a password in `--store-url` is visible in process arguments. Serve requires `--worker-state-dir /absolute/durable/path` or `SNAPBACK4_WORKER_STATE_DIR`. Queries, identified writes, sessions, ephemeral state and ordinary maintained count/sum columns are admitted. A deploy may add, redefine or drop those columns and indexes on them; it atomically recounts sources and mirrors parents before publishing the generation. Ordinary releases may also add tables, add optional or literal-defaulted columns, add/drop/redefine indexes, and retire ordinary tables or columns into dormant storage. Use `deploy DIR --restore-dormant` to restore retired names and their exact rows/values. A restored column must repeat its retained declaration: changing its type, default, text constraints or deletion policy refuses just as an in-place edit would. Unique collisions refuse the whole activation. Ordinary Postgres schema evolution currently refuses `evolution-authority` when the schema contains a durable temporal, read-through or recorded table, including an unchanged one. Their activation-time source retirement needs the later lifetime slice. Previously admitted maintained-column transitions with unchanged ordinary declarations remain available. Existing column types/defaults, rules, audiences and other authority declarations must stay unchanged. Type narrowing, backfills, renames, temporal/read-through/recorded evolution and retirement of tables with maintained columns remain named refusals. Token minting (`token`), SQL/data and release inspection, rollback, previews, prune, staging, saved versions and hot activation refuse; excluded runners, certified sync and complete configuration: `guide release-json`. SDK guest/signup/login and proof seedAccounts retry explicit identity 429 refusals using retryAfterMs (Retry-After for older servers). Sign-in has at most four attempts within timeoutMs (default three minutes); signal cancels requests/waits. No lost or malformed reply is replayed. Time-gated mutations on the real clock need a bounded retry of the authored refusal (for example `NOT_OPEN`), with a deadline and short delay; never retry unrelated refusals. Development and classified staging proofs can advance the clock (`guide time`); production always uses wall time.

Managed storage refuses foreign triggers, rewrite rules or row security with `E_STORE` / `SNAPBACK_MANAGED_RELATION_INTERCEPTION` on open, activation, reconnect and `doctor`, including foreign incoming foreign keys. Remove the reported interception and retry. Snapback's own index-key and device-residency triggers require their exact installed definitions; only recognized legacy constraints and their exact built-in triggers are admitted. Database event triggers are allowed; activation checks their managed-relation effects after installer DDL before moving data, and again before committing.

Runtime DDL on managed relations while serving is explicitly outside the store fence model. Owner/head locks do not prevent external DDL, and admission does not poll catalogs on each request. Doctor and the next open, activation or connection replacement detect such changes.

For a single-owner Linux Postgres deployment, zero-flight revision-cache hits are opt-in through `SNAPBACK4_READ_GRANT_CLOCK_BOUNDS=rate_ppm,forward_jump_ms`. These numbers declare a guarantee: during any grant, database time advances at most `(1 + rate_ppm/1000000) * CLOCK_BOOTTIME_elapsed + forward_jump_ms`, including suspend and every supported failover. They are not tuning estimates. For example, `1000,250` declares a maximum 0.1% relative rate excess and 250 ms cumulative forward adjustment; the three-second grant gets a local deadline below 2.747 s. Use this only when the deployment guarantees those bounds and all writers run the grant-aware protocol. Unset it for arbitrary clock steps, unqualified failover or mixed versions. The ordinary one-statement G5 validation remains the default. A grant hit rechecks bearer authority and expiry with a fresh clock. Every local commit invalidates revision equality. Grant loss falls back to database reads; unknown COMMIT stops cached reads and new writers until fenced reacquisition with a fresh process/epoch. Graceful release drains cached reads first.

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
`deploy ./deployment --check` previews deploy direction and restoration intent. `bunx snapback4 check --store ./deployment/store.sqlite --release 1` also previews a selection; `bunx snapback4 releases ./deployment latest` inspects it. Forward with `bunx snapback4 rollback ./deployment --to latest`. Preview runs exact adoption on a private disk snapshot and removes it, without activating; disk/time scales with the store, and later writes can change the plan. Release is immutable source; latest is the highest successfully adopted source even after rollback. A refused deploy removes its candidate directory and private stage. An ambiguous reply preserves source until committed history resolves the outcome; inspect releases before retrying. Bare rollback selects the previously active release; rollback prints the resolved target before preview or activation. Generation is a monotone identity; releases N/latest inspects source. Source identical to an active ordinary release is a no-op; a deploy equal to an ordinary release selects that release when its rollback view is live. source matching a retained release reactivates its existing id with restoration and full validation. Deploy/rollback return after serve switches: `release N is current as generation G`. In-flight one-shot operations finish in their generation; no settle sleep is needed. Default adoption is one measured receipt; --verbose/--json includes phases/cache advice. N_ADOPTION_PAUSE appears above one second. Deploy/rollback wait up to five seconds for a shutting-down store owner before admission; live serve keeps its authenticated control path. A remaining owner refuses with E_STORE_BUSY; stop that owned process before retrying. Failed or ambiguous activation is never automatically replayed. `await host.stop()` from startServe waits for its native child and the kernel store lock, including delayed worker cleanup, before resolving. `snapback4 stop ./deployment` asks the retained owner to shut down through its same-owner private control socket and waits for the store lock; it never signals a recorded PID or removes a lock. `serve ./deployment --wait-stopped` remains the bounded five-second lock barrier after a caller has already requested shutdown; it neither stops a process nor opens SQLite. It refuses other serve flags. A timeout rejects cleanup rather than claiming the store is free. Widened enum values, or short codes a loose release wrote, become dormant rows when selected types cannot hold them; compatible forward restores exact values. Reference dependents also leave the active population. Rules, counts, maintained views and reacquired sync partitions see only active rows. Point reads/updates/ deletes see absent rows; dormant ids stay reserved. Nominal reference values stay legal, as for other missing ids; require/read-through decides live-target admission. Dormant rows occupy no cap/unique slots, so older writes can require a bridge repair. Removed tables/columns/indexes also stay dormant. Fresh-source name reuse needs --restore-dormant; selecting retained source by deploy or rollback already selects restoration. The same --restore-dormant flag is accepted by both commands. Old active updates keep dormant cells; active deletion removes them. Only active referential actions run: parent deletion invalidates dormant lifetimes. Narrowed rows with invalid visible references stay dormant; whole-table/column restoration retains its E_ADOPT barrier. Prune previews counts/bytes/sample ids; `prune ./deployment --allow-destructive` permanently drops all dormant storage. No age collector or implicit pruning exists. Deploy/rollback --allow-destructive bypasses neither validation nor retention. --allow-feed-adoption permits the explicit feed launch. Inspect releases after an ambiguous reply. Details: [SERVER.md — Release lifecycle](SERVER.md#release-lifecycle).

`releases --json` reports `live.{source, view, exact}`: source is the logical ordinary release, view is the selected compiled-view id or null, and exact distinguishes original source. A view also names its registration parent. Default view writes use its compiled guarded workflow, including current defaults/operations when retained; `--exact` requests the immutable original source and still enforces write-authority compatibility.

## Visible rollback by default (SQLite)
Deploy prepares compiled rollback views when a predecessor cannot hold newly allowed values. An implementation repair behind unchanged data/intent declarations also prepares a view. A new column write audience alone does not; exact historical writes must preserve its rule or selection refuses with the operation and column. These views retain the complete authored current schema, helpers, programs and policy while admitting old names and inputs; unsupported mappings require authored compatible guarded source. Old inputs may fit wider same-format text/list bounds or omit new optional arguments. Incompatible old write exports pause with E_OP; required queries need a compatible endpoint. Removed data-bearing inputs need a consuming compatibility endpoint, never deprecated-and-discarded inputs. `rollback --to 1` selects release 1's registered view in the active deployment's context, retaining current guards and widened domains; each move prints a stdout `live:` line naming the selected source or registered view. A view retains current guards; its operation surface can be the guarded old workflow or the complete current workflow. Inspect its immutable source and preview checklist before depending on an old write. The original source remains immutable. After upgrading the CLI/runtime, restart an older running serve before switching releases; an older host refuses the new custody control feature before admission. `--exact` deliberately selects that source and reports its dormant population. Newer views never become ordinary latest. If a guard cannot be transported safely or a view cannot compile, deploy refuses until source supplies a compatible workflow. Nullable old results remain a client compatibility change: render an amount still to follow as pending, never zero. Optional media must remain optional in old UI consumers. Intentional null hiding uses `rollback 1 hides orders where fee = null because 'An unquoted fee must not look free.'` in candidate source. The writer permits only those null rows and their actual hidden-reference dependents. Widened nonnull values still stay visible. Removed defaulted fields require truthful `down` expressions; previews suggest cross-table candidates for moved values, never silently show a misleading old default. Snapshot previews do not freeze later writes: activation revalidates under its writer transaction.

## Bridge a safety gate before exact rollback (SQLite)
Use this beside the enum-widening rollback recipe above. Suppose v2 added `grounding.state = 'inspection'`; v1 holds only `'clear'`/`'hold'`. Selecting exact v1 hides that row and its children, so v1's `book` guard may allow a booking that v2 blocks. Counts and sample ids are snapshot dependencies, not predicate matches; later writes can change the plan.

1. Start from the old UI/operations, but keep v2's widened `grounding.state` domain, safety table, read audience and booking `require`. Save this complete source as `versions/bridge/schema.q` and deploy it with `deploy ./deployment --schema versions/bridge/schema.q --check`, then without `--check`. 2. While the gate still runs, migrate each inspection to a truthful old-domain hold through an authorized bridge mutation. Do not relabel it clear just to satisfy v1. Keep linked metadata until its parent can be safely represented; if v1 cannot invalidate newer metadata, keep that behavior in the bridge too. 3. Prove the same booking/payment still refuses for the blocked case and that the named lists/counts preserve the intended business denominator. Re-run the final old-source preview against the repaired live population. 4. Select v1 only when those checks pass. If the old source cannot preserve the invariant, keep the bridge or pause that workflow. Retained storage cannot supply absent logic.

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

Keep old callable names with operation aliases and old argument spellings with argument aliases; supply literal defaults only for real default choices. Preserve data-bearing inputs with a compatibility endpoint that consumes them. Use `deprecated` only for deliberately discarded, non-data-bearing input; it forbids body references. Aliases stay within a module and cannot chain. See `guide evolution` for input contracts and `guide rename` for a packed, persistent two-cycle example.

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
- Maintained counts/sums: retain privacy fields as ordinary bare group keys
  and protect the aggregate with the same audience predicate. Recorded
  reference paths, calendar keys, derived values, private columns and temporal
  contributors need their own reduction; their names are not source fields.
- Owner fields: declare column-write intent too. `written by` authorizes
  patches even when the ordinary update rule denies. To prove a particular
  mutation's role authority, use a dominating current-role requirement and
  operation-specific intent over a role table the mutation cannot change.
  This does not prove every owner-field or old/next-image path.
- Raw rule probes: inspect the observing table and its writers. A protected
  target's read rule does not protect predicates probed from another rule.
  Apply the intended audience at that observer, or remove the raw dependency;
  the report retains the unsupported edge until it can establish implication.
- Cascade/set-null: automatic child changes bypass child write rules. An
  explicit authorized child mutation with `restrict` removes that automatic
  writer, but parent refusal/existence and transitive references remain
  separate observations. Read-through/live-parent authority requires a separate reduction.
- Jobs/native workers/actions: the audit names the trusted or opaque writer.
  An ordinary mutation with stable role requirements can prove that mutation's
  authority; arbitrary native/worker output cannot acquire a proof from a
  caller's role or a passing finite test.
- Schedules: use a stored `not before`/`expire at` lifetime for exact read
  boundaries, or compare server `now` in the write itself. A scheduled status
  update leaves the old status visible between deadline and sweep.

Default `test` challenges pure-schema applications through a private production
`serve`: unauthenticated calls, forged persona headers and development doors.
The host uses no pre-existing developer credentials or development mode. Applications needing
native/worker artifacts are explicitly not covered by that schema-only host.
Focused fixtures also enable short ordered mutation histories followed by
ordinary reads; traces record actual calls and current policy evaluation.
Named personas/service seats and enum argument combinations are enumerated
within reported limits. Asset challenges use real foreign-upload and verified
non-image ledgers; video arguments and unvisited histories remain named. Complete fixture stores preserve image/file ledgers, captures, read-through deadlines, maintained views and expiry. Histories include fixture principals and reference-row candidates, under a reported work cap. Neither
these finite campaigns nor an offline device's retained snapshot establishes
current-server revocation at a disconnected access.

### E_SECURITY_TARGET

E_SECURITY_TARGET means the invariant target does not name a declared table, column or effect. Correct the target name; inspect `audit` and the policy before changing a rule.

rg: snapback4/crates/snapback4-core/src/rules.rs: No such file or directory (os error 2)
rg: snapback4/crates/snapback4-core/src/rules/*.rs: No such file or directory (os error 2)

exec
/bin/bash -lc "rg -n 'RuleExpr::Exists|Exists \\{' snapback4/crates/snapback4-lang/src/bind/schema* snapback4/crates/snapback4-lang/src/bind/rule*; rg -n 'fn update_rule_judged|old_and_next|evaluate_sequence_rule|RuleExpr::Exists' snapback4/crates/snapback4-core/src/schema* snapback4/crates/snapback4-core/src/engine/rules*; sed -n '1,130p' snapback4/crates/snapback4-lang/src/bind/program.rs; rg -n 'prelude' snapback4/crates/snapback4-lang/src/bind/*.rs | head -55" in /home/ccheever/projects/sb4-b27-rel
 succeeded in 0ms:
snapback4/crates/snapback4-lang/src/bind/rule_reference.rs:106:            Expr::Exists { read, .. } => {
snapback4/crates/snapback4-lang/src/bind/rule_reference.rs:263:        Expr::Exists { read, .. } | Expr::Created { read, .. } => read.keys.iter().find_map(|key| find(&key.value)).map(|(names, _)| (names, None)),
snapback4/crates/snapback4-lang/src/bind/rule_composition.rs:79:    let Expr::Exists { read, .. } = expr else { return None };
snapback4/crates/snapback4-lang/src/bind/schema.rs:237:        let Expr::Exists { read, .. } = value else { continue };
snapback4/crates/snapback4-lang/src/bind/schema.rs:487:            RuleExpr::Exists { .. } => infer_audience(catalog, info, sync, disjunct, rule, source, named)?,
snapback4/crates/snapback4-lang/src/bind/schema.rs:514:        RuleExpr::Exists { table, index, key, equalities, .. } if equalities.is_empty() && key.last() == Some(&RuleTerm::Viewer) => {
snapback4/crates/snapback4-lang/src/bind/schema.rs:544:            RuleExpr::Exists { key, equalities, .. } | RuleExpr::Created { key, equalities, .. } => key.iter().chain(equalities.iter().map(|(_, t)| t)).any(term),
snapback4/crates/snapback4-lang/src/bind/schema.rs:549:        RuleExpr::Exists { key, equalities, .. } => equalities.is_empty() && key.last() == Some(&RuleTerm::Viewer)
snapback4/crates/snapback4-lang/src/bind/schema.rs:811:        Expr::Exists { read, site } => {
snapback4/crates/snapback4-lang/src/bind/schema.rs:813:            Ok(RuleExpr::Exists { table, index, key, equalities, provenance: KeyProvenance::Shape })
snapback4/crates/snapback4-lang/src/bind/schema.rs:899:        if error.code == "E_QUARRY_RULE_HOP" { error.rewrite = reference::reference_rewrite(catalog, info, &Expr::Exists { read: read.clone(), site: site.clone() }); }
snapback4/crates/snapback4-core/src/schema.rs:336:        RuleExpr::Exists { table: target, index: target_index, key, equalities, .. } if target == table && target_index == index && equalities.is_empty() => {
snapback4/crates/snapback4-core/src/schema.rs:339:        RuleExpr::Deny | RuleExpr::Compare(..) | RuleExpr::Ne(_, _) | RuleExpr::Not(_) | RuleExpr::Exists { .. } | RuleExpr::Created { .. } => false,
snapback4/crates/snapback4-core/src/schema.rs:1394:        RuleExpr::Exists { table: target, index, key, equalities, .. } | RuleExpr::Created { table: target, index, key, equalities, .. } => {
snapback4/crates/snapback4-core/src/schema.rs:1541:            (RuleExpr::Exists { table, key, equalities, .. }, Audience::Target { table: target, prefix, .. }) => table == target && equalities.is_empty() && key == &prefix.iter().cloned().map(RuleTerm::Field).chain([RuleTerm::Viewer]).collect::<Vec<_>>(),
snapback4/crates/snapback4-core/src/schema.rs:1681:        RuleExpr::Exists { table, index, key, .. } => table == audience_name && audience.index(index).is_some_and(|index| {
snapback4/crates/snapback4-core/src/schema.rs:1720:    let probe = RuleExpr::Exists { table: target_name.to_owned(), index: binding.group_index.clone(), key, equalities: Vec::new(), provenance: crate::ir::KeyProvenance::Shape };
snapback4/crates/snapback4-core/src/schema.rs:1815:            audience_rule.disjuncts().into_iter().find(|disjunct| matches!(disjunct, RuleExpr::Exists { .. })).ok_or_else(|| exact.clone())?
snapback4/crates/snapback4-core/src/schema.rs:1817:        let RuleExpr::Exists { table: probed, index, key, equalities, .. } = probe else { return Err(exact) };
snapback4/crates/snapback4-core/src/engine/rules.rs:396:            RuleExpr::Exists { table, index, key, equalities, .. } => {
snapback4/crates/snapback4-core/src/engine/rules.rs:512:        RuleExpr::Not(inner) => if let RuleExpr::Exists { table, index, .. } = inner.as_ref() {
snapback4/crates/snapback4-core/src/engine/rules.rs:518:        RuleExpr::Exists { table: target, index, key, equalities, .. } => {
snapback4/crates/snapback4-core/src/engine/rules.rs:551:        (RuleExpr::Exists { table: a, index: ai, key: ak, equalities: ae, .. }, RuleExpr::Exists { table: b, index: bi, key: bk, equalities: be, .. }) =>
snapback4/crates/snapback4-core/src/engine/rules.rs:690:        let RuleExpr::Exists { table, index, key, equalities, .. } = inner.as_ref() else { return false };
snapback4/crates/snapback4-core/src/engine/rules.rs:706:        let RuleExpr::Exists { table, index, key, equalities, .. } = inner.as_ref() else { return false };
snapback4/crates/snapback4-core/src/engine/rules.rs:834:        let RuleExpr::Exists { table, index, key, equalities, .. } = rule else { return false };
snapback4/crates/snapback4-core/src/engine/rules.rs:908:    let (Expr::Exists(read), RuleExpr::Exists { table, index, key, equalities, .. }) = (filter, rule) else { return false };
snapback4/crates/snapback4-core/src/engine/rules.rs:1072:        RuleExpr::Exists { key, equalities, .. } | RuleExpr::Created { key, equalities, .. } => key.iter().chain(equalities.iter().map(|(_, term)| term)).all(term),
snapback4/crates/snapback4-core/src/engine/rules.rs:1103:    let RuleExpr::Exists { table: target, index, key, equalities, .. } = other else { return false };
snapback4/crates/snapback4-core/src/engine/rules.rs:1154:        RuleExpr::Exists { table: target, index, key, equalities, .. } if truth && target == table_name => {
snapback4/crates/snapback4-core/src/engine/rules.rs:1269:        let RuleExpr::And(terms) = rule else { unreachable!("old_and_next is a conjunction") };
snapback4/crates/snapback4-core/src/engine/rules.rs:1347:        RuleExpr::Exists { table, index, key, equalities, .. } | RuleExpr::Created { table, index, key, equalities, .. } => {
snapback4/crates/snapback4-core/src/engine/rules.rs:1392:        RuleExpr::Exists { key, equalities, .. } => 1 + key.iter().chain(equalities.iter().map(|(_,t)| t)).map(|t| hops(&[t])).sum::<u64>(),
snapback4/crates/snapback4-core/src/engine/rules.rs:1409:        RuleExpr::Exists { table, index, key, equalities, .. } | RuleExpr::Created { table, index, key, equalities, .. } => {
snapback4/crates/snapback4-core/src/engine/rules.rs:1433:        let exists = |name: &str| RuleExpr::Exists { table: name.into(), index: "byId".into(), key: vec![], provenance: crate::ir::KeyProvenance::Const, equalities: vec![] };
snapback4/crates/snapback4-core/src/engine/rules/snapshots.rs:165:        RuleExpr::Exists {table,index,key,equalities,..} if goal => {
snapback4/crates/snapback4-core/src/schema/references.rs:406:            RuleExpr::Exists { table, index, key, equalities, .. } | RuleExpr::Created { table, index, key, equalities, .. } => {
snapback4/crates/snapback4-core/src/schema/field_authority.rs:99:        RuleExpr::Exists { table, key, equalities, .. } | RuleExpr::Created { table, key, equalities, .. } => {
snapback4/crates/snapback4-core/src/schema/field_authority.rs:178:                    let exists = RuleExpr::Exists { table:"guesses".into(),index:"byValue".into(),provenance:crate::ir::KeyProvenance::Const,key:key.clone(),equalities:predicates.clone() };
snapback4/crates/snapback4-core/src/schema/live.rs:52:        RuleExpr::Exists {
snapback4/crates/snapback4-core/src/schema/update_images.rs:26:    pub fn old_and_next(&self) -> RuleExpr {
snapback4/crates/snapback4-core/src/schema/update_images.rs:53:    pub fn update_rule_judged(&self) -> std::borrow::Cow<'_, RuleExpr> {
snapback4/crates/snapback4-core/src/schema/update_images.rs:54:        if self.judges_old_image() { std::borrow::Cow::Owned(self.rules.update.old_and_next()) } else { std::borrow::Cow::Borrowed(&self.rules.update) }
snapback4/crates/snapback4-core/src/schema/union.rs:74:        (Audience::Target { table: target, prefix, .. }, RuleExpr::Exists { table, key, equalities, .. }) => table == target && equalities.is_empty()
snapback4/crates/snapback4-core/src/schema/column_reads.rs:107:            RuleExpr::Exists {
snapback4/crates/snapback4-core/src/schema/column_reads.rs:165:        if let RuleExpr::Exists {
snapback4/crates/snapback4-core/src/schema/ephemeral.rs:163:        RuleExpr::Exists { table, .. } | RuleExpr::Created { table, .. } => {
snapback4/crates/snapback4-core/src/schema/tests.rs:34:    RuleExpr::Exists { table: table.into(), index: index.into(), key, provenance: crate::ir::KeyProvenance::Shape, equalities: Vec::new() }
snapback4/crates/snapback4-core/src/schema/columns.rs:115:            RuleExpr::Exists { table: target, index, key, equalities, .. } | RuleExpr::Created { table: target, index, key, equalities, .. } => {
snapback4/crates/snapback4-core/src/schema/column_writes.rs:12:            rules.push(RuleExpr::Or(vec![same,if effect==Effect::Insert {policy.clone()} else {policy.old_and_next()}]));
//! Lowering one Quarry program to the IR: a scope of typed names, one
//! statement list that expressions may hoist temporaries into, reads that
//! choose their index, writes that read their target once, and shapes that
//! become bounded loops. Refusals carry verified repairs or prose guidance.

use super::catalog::{Catalog, TableInfo};
use crate::ast::{self, Expr as A, Literal, ObjectField, ProgramKind, ReadExpr, ShapeField, Stmt as S, WriteOp};
use crate::diag::{Diagnostic, Fallible, Site, ambiguous, name_rewrite, placement, type_error, unbound_loop, unknown, unsupported};
use crate::print;
use crate::types::Ty;
use snapback4_core::ir::{self, BinaryOp, Bound, Builtin, Expr, IndexKeyExpr, Input, KeyProvenance, LoopDomain, Merge, MergeLane, Order, Program, Read, Recurse, Scan, SortKey, Stmt, UnaryOp};
use snapback4_core::value::Value;
use std::collections::BTreeMap;

mod control;
mod read_diagnostics;
mod job_reads;
mod pure_calls;
mod point_facts;
mod aggregate_facts;
pub(super) mod maintain_types;
mod flow;
mod enum_flow;
mod conditional;
mod joins;
mod returned_shapes;
mod shape_meter;
mod diagnostics;
mod constraints;
mod expr;
mod extrema;
mod objects;
mod write_keys;
mod immutable;
mod filtered_rows;
mod snapshot_authority;
mod system_principal;
mod denied_writes;
mod keys;
mod reads;
mod prefix;
mod lanes;
mod views;
pub(crate) mod setup;

/// A bound operation: the IR plus the types the client sees.
#[derive(Clone, Debug)]
pub struct BoundProgram {
    /// Source statement ownership stays beside flat IR, like diagnostic sites.
    pub(crate) statement_ends: Vec<usize>,
    pub(crate) maintenance_scopes: BTreeMap<String, String>,
    pub view_types: BTreeMap<String, Ty>,
    pub(crate) filters: BTreeMap<String, String>,
    /// Whole-domain consumers for diagnostics only; absent from IR/wire.
    pub(crate) constraint_domains: std::collections::BTreeSet<String>,
    pub(crate) sources: BTreeMap<String, (Site, String)>,
    pub(crate) receipt_sources: Vec<(Expr, Site)>,
    pub(crate) receipt_returns: Vec<(String, Site)>,
    pub(crate) implicit_write_results: Vec<Expr>,
    /// Source-table pages before binding filters, for executable horizon repairs only.
    pub(crate) page_sources: BTreeMap<String, ReadExpr>,
    pub(crate) canonical_sources: BTreeMap<String, String>,
    pub(crate) selections: BTreeMap<String, String>,
    /// Scan sites the compiler generated for a timeline read: the only scans whose
    /// filter is exactly the platform's retirement check.
    pub(crate) timeline_scans: std::collections::BTreeSet<String>,
    pub program: Program,
    pub(crate) presence: Option<snapback4_core::schema::Execution>,
    pub module: String,
    pub args: Vec<(String, Ty)>,
    pub result: Ty,
    pub notes: Vec<Diagnostic>,
    pub site: Site,
    /// Job helpers with reads that need a non-uniform meter in a query too; never IR/wire.
    pub job_bound_helpers: std::collections::BTreeSet<String>,
}

impl BoundProgram {
    pub fn filter_source(&self, site: &str) -> Option<&str> { self.filters.get(site).map(String::as_str) }
    pub fn domain_source(&self, site: &str) -> Option<&str> { self.sources.get(&format!("domain/{site}")).map(|(_, text)| text.as_str()) }
    pub fn loop_source(&self, binding: &str) -> Option<&str> { self.sources.get(&format!("for/{binding}")).map(|(_, text)| text.as_str()) }
    pub fn selections(&self) -> &BTreeMap<String, String> { &self.selections }
    /// Whether the scan at `site` is a timeline read's own expansion, not an authored scan.
    pub fn timeline_scan(&self, site: &str) -> bool { self.timeline_scans.contains(site) }
    /// The actual binder choice, shared by `why` and structural cost reports.
    pub fn selection(&self, site: &str) -> Option<&str> { self.selections.get(site).map(String::as_str) }
}

#[derive(Clone)]
pub struct Binder<'a> {
    historical: bool,
    viewer_depth: Option<u32>,
    pure_functions: BTreeMap<String, bool>,
    maintenance_scopes: BTreeMap<String, String>,
    call_types: BTreeMap<Vec<String>, Ty>,
    filters: BTreeMap<String, String>,
    view_types: BTreeMap<String, Ty>,
    constraint_domains: std::collections::BTreeSet<String>,
    sources: BTreeMap<String, (Site, String)>,
    page_sources: BTreeMap<String, ReadExpr>,
    canonical_sources: BTreeMap<String, String>,
    selections: BTreeMap<String, String>,
    presence_sources: Vec<(Expr, Site, String)>,
    receipt_sources: Vec<(Expr, Site)>,
    receipt_returns: Vec<(String, Site)>,
    implicit_write_results: Vec<Expr>,
    catalog: &'a Catalog,
    schema: &'a snapback4_core::schema::Schema,
    name: String,
    kind: ProgramKind,
    caller_kind: ProgramKind,
    /// Diagnostic-only caller path; helpers never change execution authority.
    call_chain: Vec<(String, Site)>,
    job_bound_helpers: std::collections::BTreeSet<String>,
    scopes: Vec<BTreeMap<String, Binding>>,
    focal: Option<(String, Ty)>,
    /// Only direct scanned-row columns get false-on-null ordering in where.
    in_predicate: bool,
    returned_data: bool,
    shape_field: Option<(String, Site)>,
    variants: Vec<(String, bool)>,
    temps: u32,
    sites: u32,
    returns: Vec<(Ty, A)>,
    /// Depth of helper expansion, to bound recursion.
    depth: u32,
    /// Enclosing `for` and `chunk` bodies: where `break` may stand.
    loops: u32,
    /// Binding facts carried by the current loop's transfer edges. Ordinary
    /// fallthrough remains in the lexical scope; these edges meet their own
snapback4/crates/snapback4-lang/src/bind/complete_form.rs:87:    let mut prelude = String::new();
snapback4/crates/snapback4-lang/src/bind/complete_form.rs:88:    if !grants.is_empty() { prelude.push_str(&format!("  if {}:\n    return {}\n", grants.join(" or "), print(&value))); }
snapback4/crates/snapback4-lang/src/bind/complete_form.rs:89:    for test in &decided { prelude.push_str(&format!("  if {test}:\n    return {}\n", print(&value))); }
snapback4/crates/snapback4-lang/src/bind/complete_form.rs:97:        queries.push(format!("{header}\n{prelude}  return {}", print(&pinned)));
snapback4/crates/snapback4-lang/src/bind/complete_form.rs:249:        if !program.prelude.is_empty() { return Err("not be a branch of returns".into()); }
snapback4/crates/snapback4-lang/src/bind/intent_aggregates.rs:43:            intent_walk::statements(&mut program.prelude, &mut visit);
snapback4/crates/snapback4-lang/src/bind/intent.rs:526:            walk::statements(&mut program.prelude, &mut |value| visit(value, lanes));
snapback4/crates/snapback4-lang/src/bind/maintain_authorization.rs:20:            let statements: Vec<_> = program.prelude.iter().chain(&program.body).cloned().collect();
snapback4/crates/snapback4-lang/src/bind/program.rs:135:    in_prelude: bool,
snapback4/crates/snapback4-lang/src/bind/program.rs:195:        let mut binder = Binder { historical, viewer_depth: None, maintenance_scopes: BTreeMap::new(), pure_functions: BTreeMap::new(), call_types: BTreeMap::new(), page_sources: BTreeMap::new(), canonical_sources: BTreeMap::new(), constraint_domains: Default::default(), filters: BTreeMap::new(), variants: Vec::new(), view_types: BTreeMap::new(), sources: BTreeMap::new(), selections: BTreeMap::new(), presence_sources: Vec::new(), receipt_sources: Vec::new(), receipt_returns: Vec::new(), implicit_write_results: Vec::new(), catalog, schema, name: decl.name.clone(), kind: decl.kind, caller_kind: decl.kind, call_chain: Vec::new(), job_bound_helpers: Default::default(), scopes: vec![BTreeMap::new()], focal: None, in_predicate: false, returned_data: false, shape_field: None, temps: 0, sites: 0, returns: Vec::new(), depth: 0, loops: 0, loop_transfers: Vec::new(), caller_loops: 0, in_prelude: false, total: None, record_ownership, expanding_feed: None, timeline_scans: Default::default(), notes: Vec::new(), may_have_written: false, errors: Vec::new(), pending_totals: Vec::new() };
snapback4/crates/snapback4-lang/src/bind/program.rs:262:                binder.in_prelude = true;
snapback4/crates/snapback4-lang/src/bind/program.rs:263:                let mut prelude = setup::Body::default();
snapback4/crates/snapback4-lang/src/bind/program.rs:264:                for statement in &decl.prelude {
snapback4/crates/snapback4-lang/src/bind/program.rs:265:                    if let Err(diagnostic) = binder.statement(statement, &mut prelude, false) {
snapback4/crates/snapback4-lang/src/bind/program.rs:271:                binder.in_prelude = false;
snapback4/crates/snapback4-lang/src/bind/program.rs:272:                if !prelude.is_empty() {
snapback4/crates/snapback4-lang/src/bind/program.rs:273:                    // @ref LLP 3000.007#5.2 — each sweep carries its prelude as setup in the existing serialized statement vocabulary.
snapback4/crates/snapback4-lang/src/bind/program.rs:274:                    body.push_if(Expr::Literal(Value::Bool(true)), prelude, setup::Body::default());
snapback4/crates/snapback4-lang/src/bind/program.rs:1140:        if self.in_prelude {
snapback4/crates/snapback4-lang/src/bind/rule_composition.rs:338:        let body: Vec<_> = p.prelude.iter().chain(&p.body).cloned().collect();
snapback4/crates/snapback4-lang/src/bind/pin_rewrite.rs:104:    if !decl.prelude.is_empty() { return None; }
snapback4/crates/snapback4-lang/src/bind/intent_walk.rs:90:    for program in &mut doc.programs { statements(&mut program.prelude, visit); statements(&mut program.body, visit); }
snapback4/crates/snapback4-lang/src/bind/intent_views.rs:19:                kind: ProgramKind::Query, name: format!("$view:{}", view.name), args: Vec::new(), prelude: Vec::new(), site: site.clone(),
snapback4/crates/snapback4-lang/src/bind/generated.rs:75:        statement_sites(&mut program.prelude, &clause.site);
snapback4/crates/snapback4-lang/src/bind/intent_variants.rs:33:            body(&mut program.prelude, &mut inputs, &catalog.functions, &catalog.tables, &mut notes);
snapback4/crates/snapback4-lang/src/bind/backfills.rs:14:        name: format!("{}{}{}",if down{"down"}else{"backfill"},d.table,d.name), args:d.args.clone(), prelude:vec![],
snapback4/crates/snapback4-lang/src/bind/owner_equality.rs:64:        let mut changed=false;let mut body=p.prelude.clone();body.extend(p.body.clone());
snapback4/crates/snapback4-lang/src/bind/refusals.rs:94:        requires(catalog, &program.prelude, kind, &mut out);
snapback4/crates/snapback4-lang/src/bind/optional_patches.rs:20:        conditions(&program.prelude, &mut tested);
snapback4/crates/snapback4-lang/src/bind/optional_patches.rs:24:        let mut body = program.prelude.clone();
snapback4/crates/snapback4-lang/src/bind/intent_search.rs:35:            if program.kind != ProgramKind::Query || program.held || !program.prelude.is_empty() { continue; }
snapback4/crates/snapback4-lang/src/bind/auth_lints.rs:152:    let mut body = program.prelude.clone();
snapback4/crates/snapback4-lang/src/bind/auth_lints.rs:209:            conditions(&program.prelude, &mut tested);
snapback4/crates/snapback4-lang/src/bind/auth_lints.rs:300:        let mut body = program.prelude.clone(); body.extend(program.body.iter().cloned());
snapback4/crates/snapback4-lang/src/bind/auth_lints.rs:345:    let mut body = program.prelude.clone();
snapback4/crates/snapback4-lang/src/bind/auth_lints.rs:354:        conditions(&program.prelude, &mut tested);
snapback4/crates/snapback4-lang/src/bind/auth_lints.rs:437:        requires(&program.prelude, &mut tested);
snapback4/crates/snapback4-lang/src/bind/auth_lints.rs:1299:    for program in programs { conditions(&program.prelude, &mut tested); conditions(&program.body, &mut tested); }
snapback4/crates/snapback4-lang/src/bind/auth_lints.rs:1317:        let mut statements = program.prelude.clone(); statements.extend(program.body.iter().cloned());
snapback4/crates/snapback4-lang/src/bind/reference_arguments.rs:61:                .prelude
snapback4/crates/snapback4-lang/src/bind/reference_actions.rs:112:        let mut body=program.prelude.clone();body.extend(program.body.clone());
snapback4/crates/snapback4-lang/src/bind/reference_actions.rs:299:    let statements: Vec<Stmt> = program.prelude.iter().chain(&program.body).cloned().collect();
snapback4/crates/snapback4-lang/src/bind/stable_page_keys.rs:9:    if program.kind != ProgramKind::Query || program.native || !program.prelude.is_empty() { return; }
snapback4/crates/snapback4-lang/src/bind/delete_guards.rs:117:    writes(&decl.prelude, &mut Vec::new(), &mut out);
snapback4/crates/snapback4-lang/src/bind/delete_guards.rs:144:    all.iter().any(|decl| decl.native || has_as(&decl.prelude) || has_as(&decl.body))
snapback4/crates/snapback4-lang/src/bind/delete_guards.rs:200:    for statement in decl.prelude.iter().chain(&decl.body) {
snapback4/crates/snapback4-lang/src/bind/delete_guards.rs:272:            let rebound = |name: &str| program.body.iter().chain(&program.prelude).filter(|s| matches!(s, Stmt::Bind { names, .. } if names.iter().any(|n| n == name))).count() > 1;
snapback4/crates/snapback4-lang/src/bind/query_branches.rs:90:        let body: Vec<_> = program.prelude.iter().chain(&program.body).cloned().collect();
snapback4/crates/snapback4-lang/src/bind/aggregate_provenance.rs:47:            scan.body(&program.prelude, &mut env, &budget.scalar(0));

exec
/bin/bash -lc "sed -n '355,448p' snapback4/crates/snapback4-core/src/engine/rules.rs; cat snapback4/crates/snapback4-core/src/schema/update_images.rs; rg -n 'Exists|Name|viewer' snapback4/crates/snapback4-lang/src/bind/schema/rules.rs; sed -n '1,160p' snapback4/crates/snapback4-lang/src/bind/schema/rules.rs; sed -n '1,145p' snapback4/crates/snapback4-core/src/schema/live.rs" in /home/ccheever/projects/sb4-b27-rel
 succeeded in 0ms:
    fn when_true<'e>(&'e self, condition: &'e Expr) -> Vec<Vec<Fact<'e>>> {
        use crate::ir::{BinaryOp, UnaryOp};
        match condition {
            Expr::Variable(name) if self.conditions.contains_key(name) => self.when_true(&self.conditions[name]),
            Expr::Binary { op: BinaryOp::And, left, right } => product(self.when_true(left), self.when_true(right)),
            Expr::Binary { op: BinaryOp::Or, left, right } => union(self.when_true(left), self.when_true(right)),
            Expr::Binary { op: BinaryOp::Eq, left, right } => vec![vec![Fact::Compare(true, left, right)]],
            Expr::Binary { op: BinaryOp::Ne, left, right } => vec![vec![Fact::Compare(false, left, right)]],
            Expr::Unary { op: UnaryOp::Not, value } => self.when_false(value),
            Expr::Exists(read) => vec![vec![Fact::Exists(read)]],
            _ => vec![Vec::new()],
        }
    }

    /// The alternatives `condition` being false establishes.
    fn when_false<'e>(&'e self, condition: &'e Expr) -> Vec<Vec<Fact<'e>>> {
        use crate::ir::{BinaryOp, UnaryOp};
        match condition {
            Expr::Variable(name) if self.conditions.contains_key(name) => self.when_false(&self.conditions[name]),
            Expr::Binary { op: BinaryOp::Or, left, right } => product(self.when_false(left), self.when_false(right)),
            Expr::Binary { op: BinaryOp::And, left, right } => union(self.when_false(left), self.when_false(right)),
            Expr::Binary { op: BinaryOp::Eq, left, right } => vec![vec![Fact::Compare(false, left, right)]],
            Expr::Binary { op: BinaryOp::Ne, left, right } => vec![vec![Fact::Compare(true, left, right)]],
            Expr::Unary { op: UnaryOp::Not, value } => self.when_true(value),
            _ => vec![Vec::new()],
        }
    }

    /// The facts imply one of the grant's disjuncts.
    fn implies(&self, facts: &[Fact]) -> bool {
        self.grant.disjuncts().iter().any(|disjunct| self.implies_rule(disjunct, facts))
    }

    fn implies_rule(&self, rule: &RuleExpr, facts: &[Fact]) -> bool {
        let pinned_term = |term: &RuleTerm, expression: &Expr| pinned_term(term, expression)
            || matches!(term, RuleTerm::Field(column) if self.pins.iter().any(|(pinned, value)| *pinned == column && *value == expression));
        let same = |expression: &Expr, term: &RuleTerm| pinned_term(term, expression);
        match rule {
            RuleExpr::And(items) => !items.is_empty() && items.iter().all(|item| self.implies_rule(item, facts)),
            RuleExpr::Eq(a, b) => facts.iter().any(|fact| matches!(fact, Fact::Compare(true, left, right)
                if (same(left, a) && same(right, b)) || (same(left, b) && same(right, a)))),
            RuleExpr::Exists { table, index, key, equalities, .. } => {
                if self.written.contains(table) { return false; }
                let keyed = |read: &crate::ir::Read| &read.table == table && &read.index == index && read.key.len() == key.len()
                    && read.key.iter().zip(key).all(|(expression, term)| pinned_term(term, expression));
                if equalities.is_empty() && facts.iter().any(|fact| matches!(fact, Fact::Exists(read) if keyed(read))) { return true; }
                // `$probe != null` for a bound point read of the same key, and
                // `$probe.col = term` for every named equality.
                self.probes.iter().filter(|(_, read)| keyed(read)).any(|(name, _)| {
                    let variable = |expression: &Expr| matches!(expression, Expr::Variable(bound) if bound == name);
                    let present = facts.iter().any(|fact| matches!(fact, Fact::Compare(false, left, right)
                        if (variable(left) && matches!(right, Expr::Literal(Value::Null))) || (variable(right) && matches!(left, Expr::Literal(Value::Null)))));
                    let field = |expression: &Expr, column: &str| matches!(expression, Expr::Field { base, name } if name == column && variable(base));
                    present && equalities.iter().all(|(column, term)| facts.iter().any(|fact| matches!(fact, Fact::Compare(true, left, right)
                        if (field(left, column) && same(right, term)) || (field(right, column) && same(left, term)))))
                })
            }
            _ => false,
        }
    }

    /// Every alternative under which `condition` is true implies a grant.
    fn holds_when_true(&self, condition: &Expr) -> bool {
        self.when_true(condition).iter().all(|facts| self.implies(facts))
    }

    fn holds_when_false(&self, condition: &Expr) -> bool {
        self.when_false(condition).iter().all(|facts| self.implies(facts))
    }
}

/// More alternatives than this and a guard proves nothing (the sound default).
const MAX_ALTERNATIVES: usize = 32;

fn union<'e>(mut a: Vec<Vec<Fact<'e>>>, b: Vec<Vec<Fact<'e>>>) -> Vec<Vec<Fact<'e>>> {
    a.extend(b);
    if a.len() > MAX_ALTERNATIVES { return vec![Vec::new()]; }
    a
}

fn product<'e>(a: Vec<Vec<Fact<'e>>>, b: Vec<Vec<Fact<'e>>>) -> Vec<Vec<Fact<'e>>> {
    if a.len() * b.len() > MAX_ALTERNATIVES { return vec![Vec::new()]; }
    a.iter().flat_map(|left| b.iter().map(move |right| left.iter().chain(right).cloned().collect())).collect()
}

struct Dominance<'s> { scan: &'s Scan, found: usize, guarded: usize }

impl Dominance<'_> {
    fn count(&mut self, scans: Vec<&Scan>, guarded: bool) {
        let n = scans.into_iter().filter(|candidate| *candidate == self.scan).count();
        self.found += n;
        if guarded { self.guarded += n; }
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
rg: snapback4/crates/snapback4-lang/src/bind/schema/rules.rs: IO error for operation on snapback4/crates/snapback4-lang/src/bind/schema/rules.rs: No such file or directory (os error 2)
sed: can't read snapback4/crates/snapback4-lang/src/bind/schema/rules.rs: No such file or directory
//! Closed admission and schema-fixed prices for transactional live authority.
// @ref LLP 3000.014.000#2-surface-and-admission — never widen an unsupported whole rule.
use super::references::OnDelete;
use super::*;
use reservations::Price;
use through::LIVE_CHILDREN;

pub fn has_live(schema: &Schema) -> bool {
    schema
        .tables
        .values()
        .any(|t| t.through.as_ref().is_some_and(|t| t.live.is_some()))
}
pub fn parent(schema: &Schema, name: &str) -> bool {
    schema.children(name).any(|(_, _, t)| t.live.is_some())
}
fn nonnull(source: &Table, term: &RuleTerm) -> bool {
    match term {
        RuleTerm::Viewer => true,
        RuleTerm::Literal(value) => *value != Value::Null,
        RuleTerm::Field(field) => source.columns.get(field).is_some_and(|t| !t.is_optional()),
        _ => false,
    }
}
fn scalar(kind: &ColumnType) -> bool {
    !matches!(
        kind.required(),
        ColumnType::List { .. }
            | ColumnType::ListRange { .. }
            | ColumnType::Json { .. }
            | ColumnType::Image { .. }
            | ColumnType::Video { .. }
            | ColumnType::File { .. }
    )
}
fn term(source: &Table, term: &RuleTerm) -> bool {
    match term {
        RuleTerm::Viewer => true,
        RuleTerm::Literal(value) => matches!(value,Value::Null|Value::Bool(_)|Value::Int(_)|Value::String(_)|Value::Id(_)|Value::Bytes(_)),
        RuleTerm::Field(field) => {
            source.columns.get(field).is_some_and(scalar) && !source.engine_field(field)
        }
        _ => false,
    }
}
fn rule(schema: &Schema, source: &Table, expr: &RuleExpr, targets: &mut Vec<String>) -> bool {
    match expr {
        RuleExpr::Public { .. } | RuleExpr::Allow | RuleExpr::Deny => true,
        RuleExpr::Eq(a, b) | RuleExpr::Ne(a, b) => term(source, a) && term(source, b),
        RuleExpr::And(xs) | RuleExpr::Or(xs) => xs.iter().all(|e| rule(schema, source, e, targets)),
        RuleExpr::Not(x) => rule(schema, source, x, targets),
        RuleExpr::Exists {
            table,
            index,
            key,
            equalities,
            ..
        } => {
            targets.push(table.clone());
            let Some(target) = schema.table(table) else {
                return false;
            };
            let Some(index) = target.index(index) else {
                return false;
            };
            index.unique
                && index.is_plain()
                && index.columns().len() == key.len()
                && key.iter().all(|t| term(source, t))
                && index.columns().iter().zip(key).all(|(f, t)| {
                    target
                        .columns
                        .get(f)
                        .is_some_and(|k| !k.is_optional() || nonnull(source, t))
                })
                && equalities.iter().all(|(field, t)| {
                    target.columns.get(field).is_some_and(scalar)
                        && !target.engine_field(field)
                        && term(source, t)
                })
        }
        _ => false,
    }
}
fn endpoint(schema: &Schema, name: &str, allow_child: bool, probe: bool) -> bool {
    let Some(t) = schema.table(name) else {
        return false;
    };
    schema.visible(name) && t.ephemeral.is_none() && t.expire.is_none() && t.not_before.is_none()
        && t.recorded.is_empty() && t.maintained.is_empty() && t.written_by.is_empty() && t.sequences.is_empty()
        && (allow_child || t.through.is_none())
        && (probe || !t.on_delete.values().any(|a| a.writes()))
        && !schema.timelines.iter().any(|tl| tl.owns(name) || tl.maps(name))
        && !schema.maintains.iter().any(|m| m.source == name || m.target == name || m.row_key.as_ref().is_some_and(|k| k.table == name))
        && (probe || !schema.receipts.iter().any(|f| [&f.scope,&f.messages,&f.members,&f.runs].iter().any(|n| n.as_str() == name)))
        && (probe || !schema.synced().any(|(_,_,sync)| matches!(&sync.audience, Audience::Target { table, .. } if table == name)))
}
/// Maximum owned encoded key, including tags/terminators and escaped payload.
pub(crate) fn key_column(kind: &ColumnType) -> Option<u64> {
    use ColumnType::*;
    Some(match kind.required() {
        Id | Principal | Ref { .. } => 2 * 144 + 3,
        Text { max } => u64::from(*max).checked_mul(8)?.checked_add(3)?,
        Bytes { max } => u64::from(*max).checked_mul(2)?.checked_add(3)?,
        Enum { variants } => (variants.iter().map(|s| s.len()).max().unwrap_or(0) as u64)
            .checked_mul(2)?
            .checked_add(3)?,
        Bool => 2,
        Int | IntRange { .. } | Time | Decimal { .. } | Money { .. } => 16,
        _ => return None,
    })
}
pub fn key_shapes(table_name: &str, table: &Table) -> bool {
    table.indexes.iter().all(|(name, index)| {
        index.is_plain()
            && name.len().saturating_add(table_name.len()) <= crate::rows::MAX_INDEX_LABEL_BYTES
            && index
                .columns()
                .iter()
                .try_fold(key_column(&ColumnType::Id).unwrap(), |n, f| {
                    n.checked_add(key_column(table.columns.get(f)?)?)
                })
                .is_some_and(|n| n <= crate::rows::MAX_INDEX_KEY_BYTES as u64)
    })
}

pub fn validate(schema: &Schema) -> Vec<SchemaIssue> {
    let mut out = Vec::new();
    for (name, child) in &schema.tables {
        let Some(edge) = child.through.as_ref().filter(|t| t.live.is_some()) else {
            continue;
        };
        let mut fail = |message: &str| {
            out.push(SchemaIssue { path: format!("tables.{name}.through"), message: format!("live parent: {message}; use guide rule-recipes current-roster for manual maintenance") })
        };
        let n = edge.live.unwrap();
        let matching = child
            .constraints
            .iter()
            .filter_map(|c| match c {
                Constraint::Cap { by, max } if by == &[edge.reference.clone()] => Some(*max),
                _ => None,
            })
            .min();
        if n == 0 || matching != Some(n) {

exec
/bin/bash -lc "rg -n 'RuleExpr::Exists|fn evaluate_sequence_rule' snapback4/crates/snapback4-core/src/engine/rule* snapback4/crates/snapback4-core/src/rule*; rg -n 'fn bind_rule|fn bind_term|RuleTerm::Viewer|A::Name|Expr::Name' snapback4/crates/snapback4-lang/src/bind/schema.rs; rg --files snapback4/crates/snapback4-core/src | rg 'rule|author'; rg --files snapback4/crates/snapback4-lang/src/bind | rg 'rule' " in /home/ccheever/projects/sb4-b27-rel
 succeeded in 0ms:
rg: snapback4/crates/snapback4-core/src/rule*: No such file or directory (os error 2)
snapback4/crates/snapback4-core/src/engine/rules.rs:396:            RuleExpr::Exists { table, index, key, equalities, .. } => {
snapback4/crates/snapback4-core/src/engine/rules.rs:512:        RuleExpr::Not(inner) => if let RuleExpr::Exists { table, index, .. } = inner.as_ref() {
snapback4/crates/snapback4-core/src/engine/rules.rs:518:        RuleExpr::Exists { table: target, index, key, equalities, .. } => {
snapback4/crates/snapback4-core/src/engine/rules.rs:551:        (RuleExpr::Exists { table: a, index: ai, key: ak, equalities: ae, .. }, RuleExpr::Exists { table: b, index: bi, key: bk, equalities: be, .. }) =>
snapback4/crates/snapback4-core/src/engine/rules.rs:690:        let RuleExpr::Exists { table, index, key, equalities, .. } = inner.as_ref() else { return false };
snapback4/crates/snapback4-core/src/engine/rules.rs:706:        let RuleExpr::Exists { table, index, key, equalities, .. } = inner.as_ref() else { return false };
snapback4/crates/snapback4-core/src/engine/rules.rs:834:        let RuleExpr::Exists { table, index, key, equalities, .. } = rule else { return false };
snapback4/crates/snapback4-core/src/engine/rules.rs:908:    let (Expr::Exists(read), RuleExpr::Exists { table, index, key, equalities, .. }) = (filter, rule) else { return false };
snapback4/crates/snapback4-core/src/engine/rules.rs:1072:        RuleExpr::Exists { key, equalities, .. } | RuleExpr::Created { key, equalities, .. } => key.iter().chain(equalities.iter().map(|(_, term)| term)).all(term),
snapback4/crates/snapback4-core/src/engine/rules.rs:1103:    let RuleExpr::Exists { table: target, index, key, equalities, .. } = other else { return false };
snapback4/crates/snapback4-core/src/engine/rules.rs:1154:        RuleExpr::Exists { table: target, index, key, equalities, .. } if truth && target == table_name => {
snapback4/crates/snapback4-core/src/engine/rules.rs:1347:        RuleExpr::Exists { table, index, key, equalities, .. } | RuleExpr::Created { table, index, key, equalities, .. } => {
snapback4/crates/snapback4-core/src/engine/rules.rs:1392:        RuleExpr::Exists { key, equalities, .. } => 1 + key.iter().chain(equalities.iter().map(|(_,t)| t)).map(|t| hops(&[t])).sum::<u64>(),
snapback4/crates/snapback4-core/src/engine/rules.rs:1409:        RuleExpr::Exists { table, index, key, equalities, .. } | RuleExpr::Created { table, index, key, equalities, .. } => {
snapback4/crates/snapback4-core/src/engine/rules.rs:1433:        let exists = |name: &str| RuleExpr::Exists { table: name.into(), index: "byId".into(), key: vec![], provenance: crate::ir::KeyProvenance::Const, equalities: vec![] };
snapback4/crates/snapback4-core/src/engine/rule_reference.rs:11:        let RuleExpr::Exists { key, .. } = rule else { unreachable!() };
snapback4/crates/snapback4-core/src/engine/rules/snapshots.rs:165:        RuleExpr::Exists {table,index,key,equalities,..} if goal => {
50:                .or_else(|| maintain.keys.iter().any(|key| matches!(key, Expr::Name { name, .. } if name == column)).then(|| column.clone()));
486:            RuleExpr::Eq(RuleTerm::Field(column), RuleTerm::Viewer) | RuleExpr::Eq(RuleTerm::Viewer, RuleTerm::Field(column)) => Audience::Column(column.clone()),
513:        RuleExpr::Eq(RuleTerm::Field(column), RuleTerm::Viewer) | RuleExpr::Eq(RuleTerm::Viewer, RuleTerm::Field(column)) if named.is_none() => Ok(Audience::Column(column.clone())),
514:        RuleExpr::Exists { table, index, key, equalities, .. } if equalities.is_empty() && key.last() == Some(&RuleTerm::Viewer) => {
538:        let term = |term: &RuleTerm| matches!(term, RuleTerm::Viewer);
548:        RuleExpr::Eq(RuleTerm::Field(_), RuleTerm::Viewer) | RuleExpr::Eq(RuleTerm::Viewer, RuleTerm::Field(_)) => true,
549:        RuleExpr::Exists { key, equalities, .. } => equalities.is_empty() && key.last() == Some(&RuleTerm::Viewer)
607:pub fn bind_rule(catalog: &Catalog, info: &TableInfo, rule: &RuleDecl) -> Fallible<RuleExpr> {
634:            let reference = match args.as_slice() { [Expr::Name { name, .. }] => name.clone(), _ => "parent".into() };
695:        Expr::Name { name, .. } => match name.as_str() {
737:                if matches!(l, RuleTerm::Viewer) {
740:                if matches!(r, RuleTerm::Viewer) {
748:                    && !matches!((&l, &r), (RuleTerm::Viewer, _) | (_, RuleTerm::Viewer))
834:        Expr::Name { name, .. } if name == "viewer" => Ok((RuleTerm::Viewer, Ty::Principal)),
850:            Expr::Name { name: binder, .. } if bindings.old.as_deref() == Some(binder) => {
854:            Expr::Name { name: binder, .. } if bindings.next.as_deref() == Some(binder) => {
858:            Expr::Name { name: binder, .. } if bindings.update && bindings.old.is_none()
865:        Expr::Name { name, .. } if bindings.update && (bindings.old.as_deref() == Some(name) || bindings.next.as_deref() == Some(name)) => Err(unknown(site, format!("select a field of {name} explicitly"), format!("{name}.id"))),
866:        Expr::Name { name, .. } => Err(unknown(site, format!("`{name}` is not a rule term; rules read the row as .{name}"), format!(".{name}"))),
snapback4/crates/snapback4-core/src/authority/test_cases.rs
snapback4/crates/snapback4-core/src/authority.rs
snapback4/crates/snapback4-core/src/engine/authorized_scan.rs
snapback4/crates/snapback4-core/src/engine/rule_reference.rs
snapback4/crates/snapback4-core/src/schema/field_authority.rs
snapback4/crates/snapback4-core/src/engine/authorized_point.rs
snapback4/crates/snapback4-core/src/engine/field_authority.rs
snapback4/crates/snapback4-core/src/engine/timeline_authority_tests.rs
snapback4/crates/snapback4-core/src/engine/rules.rs
snapback4/crates/snapback4-core/src/engine/timeline_authority.rs
snapback4/crates/snapback4-core/src/engine/rules_reference.rs
snapback4/crates/snapback4-core/src/engine/field_authority_tests.rs
snapback4/crates/snapback4-core/src/engine/rules/snapshots.rs
snapback4/crates/snapback4-core/src/store/authority_origin.rs
snapback4/crates/snapback4-core/src/store/authority.rs
snapback4/crates/snapback4-core/src/engine/postgres/authority.rs
snapback4/crates/snapback4-lang/src/bind/rule_operator.rs
snapback4/crates/snapback4-lang/src/bind/rule_reference.rs
snapback4/crates/snapback4-lang/src/bind/rule_helpers.rs
snapback4/crates/snapback4-lang/src/bind/rule_composition.rs

exec
/bin/bash -lc "sed -n '607,711p' snapback4/crates/snapback4-lang/src/bind/schema.rs; sed -n '711,837p' snapback4/crates/snapback4-lang/src/bind/schema.rs; sed -n '1,115p' snapback4/crates/snapback4-core/src/engine/rules.rs; rg -n 'Exists|through|recorded|expiry' snapback4/crates/snapback4-core/src/authority.rs | head -65; rg -n 'Expr::Block|block' snapback4/crates/snapback4-lang/src/bind/program/objects.rs snapback4/crates/snapback4-lang/src/bind/program/setup.rs" in /home/ccheever/projects/sb4-b27-rel
 exited 1 in 0ms:
pub fn bind_rule(catalog: &Catalog, info: &TableInfo, rule: &RuleDecl) -> Fallible<RuleExpr> {
    let bindings = RuleBindings { old: rule.bindings.first().cloned(), next: rule.bindings.get(1).cloned(), update: rule.effect == Effect::Update, insert: rule.effect == Effect::Insert, hops: rule.effect != Effect::Read, present: Vec::new() };
    rule_expr(catalog, info, &rule.value, &bindings).map_err(|error| {
        let mut error = super::first_paste::inherited_rule(catalog, info, rule).unwrap_or(error);
        if error.code == "E_QUARRY_RULE_OPERATOR" && rule.effect == Effect::Update && rule.bindings.is_empty()
            && error.rewrite == "write this as a named transition" {
            let source = super::rule_operator::named_update_source(&rule.value);
            error.rewrite = format!("name both row images: `{source}`");
            error.source_rewrite = Some(source);
            error.source_rewrite_kind = Some(crate::diag::SourceRewriteKind::NamedUpdate);
        }
        // @ref LLP 3000.036#13.6 — the named form of a whole unnamed update rule, so the rewrite keeps every other clause.
        if error.code == "E_QUARRY_RULE_OPERATOR" && rule.effect == Effect::Update && rule.bindings.is_empty() && error.rewrite.starts_with("name both images") {
            let comparison = error.message.split('`').nth(1).unwrap_or_default().to_owned();
            error.rewrite = super::rule_operator::named_update(&info.decl.name, &rule.value, &comparison);
        }
        if error.code == "E_QUARRY_RULE_HOP" {
            error.rewrite = match rule.effect {
                Effect::Read => reference::read_hop_rewrite(catalog, info, &rule.value).unwrap_or_else(|| "a read rule probes one hop: copy the deciding value onto this row (immutable, checked against the parent by the insert rule), or use read through .parent".into()),
                _ => reference::reference_rewrite(catalog, info, &rule.value),
            };
        }
        // @ref LLP 3000.036#14.3 — a read-through child binds its parent's rule over hidden
        // captures (`.$enrollment.dancer`): its refusal is the parent's (`internal_names` drops the copy).
        // @ref LLP 3000.036#15.6 — a `read through` that did not expand (E_READ_THROUGH says why)
        // leaves its internal call; its refusal is that problem's cascade, spelled as written.
        if let Expr::Call { name, args, .. } = &rule.value && matches!(name.as_str(), "$readThrough" | "$readThroughLive") {
            let reference = match args.as_slice() { [Expr::Name { name, .. }] => name.clone(), _ => "parent".into() };
            error.message = format!("`read through .{reference}` did not expand, so {} has no read rule yet", info.decl.name);
            // The cascade convention: `check` hides it beside its cause unless --verbose.
            error.rewrite = "fix this Quarry line and rerun snapback4 check".into();
            error.cascade_of = Some(rule.site.clone());
            error.mechanical = false;
            return error;
        }
        if rule.effect == Effect::Read && let Some(through) = &info.through {
            error.rewrite = format!("repair {}'s read rule (its own diagnostic prints the repair); {} reads through it", through.parent, info.decl.name);
            error.cascade_of = Some(error.site.clone());
        }
        error
    })
}

#[derive(Clone)]
struct RuleBindings {
    old: Option<String>,
    next: Option<String>,
    update: bool,
    insert: bool,
    hops: bool,
    present: Vec<RuleTerm>,
}

// @ref LLP 3000.013#2.2 — presence facts retain a reference term's old/next image.
// Facts hold on the logical edge where the next operand can affect truth.
// Expiry accounting may evaluate other edges too: the shared runtime returns
// no witness for an ordinary unique null key, without accessing tied rows.
// Thus admission does not require physical short-circuiting. Facts still
// cannot leak from one OR alternative into an unrelated alternative.
fn present_terms(rule: &RuleExpr, truth: bool) -> Vec<RuleTerm> {
    match rule {
        RuleExpr::Ne(left, right) if truth => non_null_term(left, right),
        RuleExpr::Eq(left, right) if !truth => non_null_term(left, right),
        RuleExpr::Not(inner) => present_terms(inner, !truth),
        RuleExpr::And(parts) | RuleExpr::Or(parts) => {
            let union = matches!(rule, RuleExpr::And(_)) == truth;
            let mut facts = parts.iter().map(|part| present_terms(part, truth));
            let mut result = facts.next().unwrap_or_default();
            for facts in facts {
                if union { for term in facts { if !result.contains(&term) { result.push(term); } } }
                else { result.retain(|term| facts.contains(term)); }
            }
            result
        }
        _ => Vec::new(),
    }
}

fn non_null_term(left: &RuleTerm, right: &RuleTerm) -> Vec<RuleTerm> {
    match (left, right) {
        (RuleTerm::Literal(Value::Null), term) | (term, RuleTerm::Literal(Value::Null)) => vec![term.clone()],
        _ => Vec::new(),
    }
}

fn rule_expr(catalog: &Catalog, info: &TableInfo, expr: &Expr, bindings: &RuleBindings) -> Fallible<RuleExpr> {
    let site = expr.site();
    match expr {
        Expr::Name { name, .. } => match name.as_str() {
            "allow" => Ok(RuleExpr::Allow),
            "deny" => Ok(RuleExpr::Deny),
            "public" => Ok(RuleExpr::Public { reason: format!("{} is public", info.decl.name) }),
            "true" => Ok(RuleExpr::Allow),
            "false" => Ok(RuleExpr::Deny),
            other => Err(unknown(site, format!("`{other}` is not a rule; rules are allow, deny, public, exists, created, and comparisons over ., viewer and literals"), "read <- .ownerId = viewer")),
        },
        Expr::Call { name, args, .. } if name == "public" => {
            let reason = match args.first() {
                Some(Expr::Literal { value: crate::ast::Literal::Str(reason), .. }) => reason.clone(),
                _ => format!("{} is public", info.decl.name),
            };
            Ok(RuleExpr::Public { reason })
        }
        Expr::Binary { op, left, right, .. } => match op.as_str() {
            "and" | "or" => {
            "and" | "or" => {
                let left = rule_expr(catalog, info, left, bindings)?;
                let mut guarded = bindings.clone();
                guarded.present.extend(present_terms(&left, op == "and"));
                let right = rule_expr(catalog, info, right, &guarded)?;
                Ok(if op == "and" { RuleExpr::And(vec![left, right]) } else { RuleExpr::Or(vec![left, right]) })
            }
            "=" | "!=" | ">=" | ">" | "<=" | "<" => {
                let ordered = !matches!(op.as_str(), "=" | "!=");
                let transition = bindings.update && bindings.old.is_some();
                let effect = super::rule_operator::effect_word(bindings.insert, bindings.update, !bindings.hops);
                // @ref LLP 3000.036#11 — unsupported terms and misplaced ordered comparisons name what rules evaluate and move the author's comparison into the mutation.
                if let Some(what) = [left.as_ref(), right.as_ref()].into_iter().find_map(super::rule_operator::unsupported_side) {
                    return Err(super::rule_operator::diagnostic(site, &info.decl.name, effect, transition, expr, what));
                }
                if ordered && !transition && !bindings.insert { return Err(super::rule_operator::diagnostic(site, &info.decl.name, effect, transition, expr, "an ordered comparison")); }
                let (mut l, mut lt) = rule_term(catalog, info, left, bindings)?;
                let (mut r, mut rt) = rule_term(catalog, info, right, bindings)?;
                // `viewer = 'service:ranker'`: a text literal beside the
                // viewer names a principal, as it does beside `=` in a program.
                let as_principal = |term: &mut RuleTerm, ty: &mut Ty| {
                    if let RuleTerm::Literal(Value::String(text)) = term {
                        *term = RuleTerm::Literal(Value::Id(text.clone()));
                        *ty = Ty::Principal;
                    }
                };
                if matches!(l, RuleTerm::Viewer) {
                    as_principal(&mut r, &mut rt);
                }
                if matches!(r, RuleTerm::Viewer) {
                    as_principal(&mut l, &mut lt);
                }
                if !lt.comparable(&rt) {
                    return Err(type_error(site, format!("rule comparison joins {} with {}", lt.name(), rt.name()), "compare a principal column with viewer, or a column with a literal of its own type"));
                }
                if let (Ty::Principal, other) | (other, Ty::Principal) = (&lt, &rt)
                    && !matches!(other, Ty::Principal | Ty::Id)
                    && !matches!((&l, &r), (RuleTerm::Viewer, _) | (_, RuleTerm::Viewer))
                {
                    return Err(type_error(site,
                        format!("rule comparison joins {} with {}; a principal value cannot equal a value that may be null", lt.name(), rt.name()),
                        "compare required principal columns, or copy the present principal into a required immutable field when the mutation creates this row"));
                }
                if ordered && !transition {
                    // An insert rule orders only the new row's own required
                    // int/time/decimal/money columns and integer literals (a
                    // literal beside decimal or money is minor units, as the
                    // wire and programs read it).
                    // @ref LLP 3000.036#12 — money and decimal hold integer minor units, so they order like int.
                    let own = |term: &RuleTerm| match term { RuleTerm::Field(field) => info.columns.contains_key(field), RuleTerm::Literal(Value::Int(_)) => true, _ => false };
                    if !own(&l) || !own(&r) || matches!((&l, &r), (RuleTerm::Literal(_), RuleTerm::Literal(_))) {
                        return Err(super::rule_operator::diagnostic(site, &info.decl.name, effect, transition, expr, "an ordered comparison beyond this row's own columns"));
                    }
                    let scalar = |ty: &Ty| matches!(ty, Ty::Int | Ty::Time | Ty::Decimal(_) | Ty::Money(..));
                    let literal = |term: &RuleTerm| matches!(term, RuleTerm::Literal(_));
                    if !scalar(&lt) || !scalar(&rt) || (lt != rt && !literal(&l) && !literal(&r)) {
                        let optional = matches!(lt, Ty::Optional(_)) || matches!(rt, Ty::Optional(_));
                        let both_columns = !literal(&l) && !literal(&r);
                        let help = if optional { "declare the column required, or check it in the mutation with require".to_owned() }
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

fn rule_term(catalog: &Catalog, info: &TableInfo, expr: &Expr, bindings: &RuleBindings) -> Fallible<(RuleTerm, Ty)> {
    let site = expr.site();
    match expr {
        Expr::Name { name, .. } if name == "viewer" => Ok((RuleTerm::Viewer, Ty::Principal)),
        Expr::Member { base, name, .. } => match base.as_ref() {
            Expr::Read(read) if read.keys.len() == 1 && read.keys[0].column.as_deref().is_none_or(|c| c == "id")
                && read.range.is_none() && read.filter.is_none() && read.matching.is_none()
//! Rule evaluation and the static facts about it that the engine hoists: a
//! rule that is proven true by the scanned prefix (`decided_true`) costs no
//! probes; a rule whose deciding fields are pinned by the prefix (`uniform`) is
//! decided once for the whole range. Copied from Snapback 2's uniformity
//! analysis (LLP 2000.000 §5.1); the certificate that priced these is gone,
//! the analysis is not.

use crate::ir::{Bound, Expr, IndexKeyExpr, Input, Merge, Scan};
use crate::schema::{ColumnType, RuleExpr, RuleTerm, Schema, Table};
use crate::value::Value;
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Visibility {
    /// One verdict serves every row of the scanned prefix.
    pub uniform: bool,
    /// That verdict is `true` before any row is read.
    pub decided_true: bool,
}

pub fn scan_visibility(schema: &Schema, scan: &Scan) -> Visibility {
    let Some(table) = schema.table(&scan.table) else { return Visibility::default() };
    let Some(index) = table.index(&scan.index) else { return Visibility::default() };
    let pinned = |name: &str| index.components.iter().zip(&scan.prefix).find_map(|(part, key)| (part.column().is_some_and(|column| column == name)).then(|| key.scalar()).flatten());
    visibility(&scan.table, table, &table.rules.read, &pinned)

}

// @ref LLP 3000.007#20.5 — a missing upsert may insert only when the complete held group and its key decide that no hidden target can exist.
pub fn upsert_absence(schema: &Schema, name: &str, index: &str, key: &[Expr]) -> Result<Visibility, &'static str> {
    let table = schema.table(name).ok_or("the target is online only")?;
    let sync = table.sync.as_ref().ok_or("the target is online only")?;
    if sync.horizon.is_some() { return Err("the target has a horizon"); }
    let rule = table.rules.read.device_audience_rule();
    // Public subset sync has no whole-table absence proof. Its group coverage
    // is a separate decision; do not infer it merely from the public read rule.
    if rule.is_uniformly_readable() && sync.audience != crate::schema::Audience::Public { return Err("the key's synced group is not established"); }
    let index = table.index(index).ok_or("the key does not pin readability")?;
    let pinned = crate::small_map::collect(index.components.iter().zip(key).filter_map(|(part, expression)| part.column().map(|column| (column, expression))));
    let visibility = prefix_visibility(name, table, &rule, &pinned);
    if !visibility.uniform { return Err("the key does not pin readability"); }
    Ok(visibility)
}

// @ref LLP 3000.007#18.1 — simplify self-witnesses, then pre-check only the leading conjuncts whose fields the scope pins, in evaluation order.
pub(super) fn prefix_decision(schema: &Schema, scan: &Scan) -> Option<RuleExpr> {
    let table = schema.table(&scan.table)?;
    let index = table.index(&scan.index)?;
    let pinned: BTreeMap<_,_> = crate::small_map::collect(index.components.iter().zip(&scan.prefix).filter_map(|(part, key)| part.column().zip(key.scalar())));
    if table.through.as_ref().is_some_and(|t| pinned.contains_key(&t.reference)) { return Some(table.rules.read.clone()); }
    let rule = simplify_prefix(&table.rules.read, &scan.table, table, &pinned);
    if matches!(rule, RuleExpr::Allow) { return None; }
    let mut terms = Vec::new();
    conjuncts(rule, &mut terms);
    let decided: Vec<_> = terms.into_iter().take_while(|term| {
        let mut fields = BTreeSet::new();
        term.fields(&mut fields);
        fields.iter().all(|field| pinned.contains_key(field))
    }).collect();
    (!decided.is_empty()).then_some(RuleExpr::And(decided))
}

// Flatten only conjunctions, preserving left-to-right short-circuit order.
fn conjuncts(rule: RuleExpr, out: &mut Vec<RuleExpr>) {
    match rule { RuleExpr::And(terms) => for term in terms { conjuncts(term, out); }, rule => out.push(rule) }
}

fn simplify_prefix(rule: &RuleExpr, name: &str, table: &Table, pinned: &BTreeMap<&String, &Expr>) -> RuleExpr {
    let pin = |name: &str| pinned.iter().find_map(|(key, value)| (key.as_str() == name).then_some(*value));
    if rule_known(rule, true, name, table, &pin) { return RuleExpr::Allow; }
    if rule_known(rule, false, name, table, &pin) { return RuleExpr::Deny; }
    match rule {
        RuleExpr::And(terms) => {
            let mut out = Vec::new();
            for term in terms { conjuncts(simplify_prefix(term, name, table, pinned), &mut out); }
            out.retain(|term| !matches!(term, RuleExpr::Allow));
            RuleExpr::And(out)
        },
        RuleExpr::Or(_) => {
            // Use the same self-witness absorption as uniformity, but remove
            // the absorbed field read from the expression we actually run.
            let terms = rule.disjuncts();
            let mut out: Vec<_> = terms.iter()
                .filter(|term| !terms.iter().any(|other| self_probe_absorbs(name, table, term, other)))
                .map(|term| simplify_prefix(term, name, table, pinned))
                .filter(|term| !matches!(term, RuleExpr::Deny))
                .collect();
            match out.len() {
                0 => RuleExpr::Deny,
                1 => out.pop().unwrap(),
                _ => RuleExpr::Or(out),
            }
        }
        RuleExpr::Not(inner) => {
            let inner = simplify_prefix(inner, name, table, pinned);
            negate_required_bool(&inner, table).unwrap_or_else(|| RuleExpr::Not(Box::new(inner)))
        }
        RuleExpr::Ne(left, right) => required_bool_equality(left, right, table, false).unwrap_or_else(|| rule.clone()),
        _ => rule.clone(),
    }
}

/// Required booleans have exactly two values, so their negated equality and
/// inequality forms can share one positive equality identity. Optional bools
/// retain their original expression because `null` is distinct from `false`.
// @ref LLP 3000.036.001#9 — prefix simplification and guard coverage use the same required-Boolean identity.
fn required_bool_equality(left: &RuleTerm, right: &RuleTerm, table: &Table, equal: bool) -> Option<RuleExpr> {
    [(left, right), (right, left)].into_iter().find_map(|(field, value)| {
        let (RuleTerm::Field(column), RuleTerm::Literal(Value::Bool(expected))) = (field, value) else { return None };
        matches!(table.columns.get(column), Some(ColumnType::Bool)).then(|| RuleExpr::Eq(
            RuleTerm::Field(column.clone()),
            RuleTerm::Literal(Value::Bool(if equal { *expected } else { !*expected })),
        ))
    })
}
100:    let Some(standing) = family_authority_expiry(tx, principal, &session.family, generation, now)?
112:/// expiry is deliberately not an ongoing cap: refresh lifetime and admission
114:pub(crate) fn family_authority_expiry(
160:pub(crate) fn work_authority_expiry(
171:        (Some(family), Some(generation), Some(_)) => family_authority_expiry(
200:    Ok(claim_window_is_live(&work, now) && work_authority_expiry(tx, &work, now)?.is_some())

exec
/bin/bash -lc "rg -n 'RuleExpr::Exists' snapback4/crates/snapback4-core/src | rg -v 'rules.rs|schema|test|proof' | head -50; rg -n 'evaluate_sequence_rule' snapback4/crates/snapback4-core/src | head -25; rg -n 'is_expiring' snapback4/crates/snapback4-core/src/schema.rs; rg -n 'viewer|allow|deny' snapback4/crates/snapback4-lang/src/bind/program/expr.rs | head -30; sed -n '1,95p' snapback4/crates/snapback4-lang/src/bind/program/objects.rs" in /home/ccheever/projects/sb4-b27-rel
 succeeded in 0ms:
snapback4/crates/snapback4-core/src/search_plan/ordinary.rs:29:    let RuleExpr::Exists { table: members, index: membership, key, equalities, .. } = &table.rules.read else { return None };
snapback4/crates/snapback4-core/src/engine/rule_reference.rs:11:        let RuleExpr::Exists { key, .. } = rule else { unreachable!() };
snapback4/crates/snapback4-core/src/engine/committer/closure.rs:118:            RuleExpr::Exists {
snapback4/crates/snapback4-core/src/engine/committer/closure.rs:385:            RuleExpr::Exists {
snapback4/crates/snapback4-core/src/engine/prefetch.rs:221:        RuleExpr::Exists { table, index, key, provenance, .. } => {
snapback4/crates/snapback4-core/src/engine/prefetch.rs:331:        let probe = |field: &str| RuleExpr::Exists { table: "probes".into(), index: "byId".into(), key: vec![RuleTerm::Field(field.into())], equalities: vec![], provenance: KeyProvenance::Shape };
snapback4/crates/snapback4-core/src/revocation.rs:113:            RuleExpr::Exists { table, key, equalities, .. } | RuleExpr::Created { table, key, equalities, .. } => {
snapback4/crates/snapback4-core/src/engine/rules/snapshots.rs:165:        RuleExpr::Exists {table,index,key,equalities,..} if goal => {
snapback4/crates/snapback4-core/src/engine/postgres/read_closure.rs:453:            RuleExpr::Exists {
snapback4/crates/snapback4-core/src/engine/postgres/read_plan.rs:224:            RuleExpr::Exists { table,index,key,.. } => {
snapback4/crates/snapback4-core/src/engine/postgres/read_plan.rs:244:        RuleExpr::Exists {table,..} => crate::rows::disclosed::decode_reservation(&s.tables[table]).saturating_add(256),
snapback4/crates/snapback4-core/src/engine/postgres/read_plan.rs:249:    match r { RuleExpr::Exists {..}|RuleExpr::Created{..} => true, RuleExpr::And(rs)|RuleExpr::Or(rs)=>rs.iter().any(has_probe), RuleExpr::Not(r)=>has_probe(r), _=>false }
snapback4/crates/snapback4-core/src/engine/postgres/read_plan.rs:256:        RuleExpr::Exists {table,key,equalities,..} => safe_table(s,table)
snapback4/crates/snapback4-core/src/engine/column_writes.rs:14:            let permitted=self.authorized_scratch(self.rule_scratch(&rule), &[(MeterKind::RuleProbes,super::rules::rule_probes(&rule))], |runner,allowance|runner.evaluate_sequence_rule(allowance,name,&rule,Effect::Update,None,&old))?;
snapback4/crates/snapback4-core/src/engine/row_views.rs:788:                    runner.evaluate_sequence_rule(scope, &m.source, &rule, crate::schema::Effect::Read, None, &row)
snapback4/crates/snapback4-core/src/engine/read.rs:522:            runner.evaluate_sequence_rule(allowance, table_name, &rule, effect, old.as_ref(), &next)
snapback4/crates/snapback4-core/src/engine/sequences.rs:114:    pub(super) fn evaluate_sequence_rule(&mut self, allowance: &Authorization, name: &str, rule: &RuleExpr, effect: Effect, old: Option<&Value>, next: &Value) -> Result<bool, RuntimeError> {
1445:    if source.is_expiring() && target.indexes.values().any(|index| index.columns().iter().any(|column| column == "value")) {
1450:    if target.is_expiring() {
79:        // the shared IR allowlist; this only improves already-failing calls.
321:            "viewer" | "$input:viewer" => Ok((Expr::Input(Input::Viewer), Ty::Principal)),
329:                if self.viewer_depth.is_some() { return Err(job_reads::read_only(site)); }
346:                let declared: Vec<&str> = self.scopes.iter().flat_map(|s| s.keys().map(String::as_str)).chain(["viewer", "now", "new"]).collect();
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
            } else {
                match &field.value {
                    Some(value) => self.expr(value, &mut setup),
                    None => self.name(&field.name, &field.site),
                }
            };
            let bound = bound.and_then(|(value, ty)| {
                if let (Some(table), false) = (table, field.spread) && let Some(scalar) = table.columns.get(&field.name) {
                    super::literal_in_range(table, &field.name, scalar, &value, &field.site)?;
                }
                Ok((value, ty))
            });
            let (value, ty) = match bound {
                Ok(bound) => bound,
                Err(error) => { self.record_error(error.clone()); failed.get_or_insert(error); continue; }

exec
/bin/bash -lc "sed -n '1,210p' snapback4/crates/snapback4-core/src/engine/sequences.rs; rg -n 'set.null|SetNull|check_frozen' snapback4/crates/snapback4-core/src/engine/references.rs snapback4/crates/snapback4-core/src/engine/*reference*; rg -n 'frozen|column_writes|exact_write' snapback4/crates/snapback4/src snapback4/crates/snapback4-core/src/store | head -75; nl -ba snapback4/crates/snapback4-lang/src/release_bridge.rs | sed -n '429,530p'; rg -n 'fn is_expiring' snapback4/crates/snapback4-core/src/schema* -g '*.rs'" in /home/ccheever/projects/sb4-b27-rel
 succeeded in 0ms:
//! Transactional per-parent ordinals and device suffix predictions.
// @ref LLP 3000.015#2 — the counter is shared across tables and commits only with the write.
use super::{runner::Runner, authorized_scan::Authorization};
use crate::rows::word_heap;
use crate::{
    error::{MeterKind, RuntimeError},
    rows::{Bounds, Dir},
    schema::{ColumnType, Effect, RuleExpr, Table},
    value::Value,
};
use std::collections::BTreeMap;

pub(super) fn exhausted() -> RuntimeError {
    RuntimeError::Structural {
        code: "E_SEQUENCE_EXHAUSTED",
        message: "parent sequence exhausted the int range; create a new parent (guide types)".into(),
    }
}

pub(super) fn refuse_fields(table: &Table, name: &str, row: &Value) -> Result<(), RuntimeError> {
    for column in table.sequences.keys() {
        if row.as_object()?.contains_key(column) {
            return Err(RuntimeError::Structural {
                code: "E_SEQUENCE_SUPPLIED",
                message: format!("{name}.{column} is engine-assigned; omit {column} from inserts and patches (guide writes)"),
            });
        }
    }
    Ok(())
}

impl Runner<'_> {
    /// The insert image is supplied, unlike a write target's hidden old row.
    /// Reserve its exact copy and static authorization/counter allowance before
    /// learning a read witness; do not reserve schema-maximum hidden payloads.
    pub(super) fn reserve_sequence_authorization(&mut self, table: &Table, row: &crate::value::Supplied, insert_checks: u64) -> Result<(), RuntimeError> {
        let probes = super::rules::rule_probes(&table.rules.read).saturating_add(super::rules::rule_probes(&table.guarded_rule(Effect::Insert)).saturating_mul(insert_checks));
        for (kind, amount, used, ceiling) in [
            (MeterKind::RuleProbes, probes, self.meter.used.rule_probes, self.meter.ceilings.rule_probes),
            (MeterKind::IndexEntries, table.sequences.len() as u64, self.meter.used.index_entries, self.meter.ceilings.index_entries),
            (MeterKind::HeapBytes, row.heap_bytes(), self.meter.used.heap_bytes, self.meter.ceilings.heap_bytes),
        ] {
            if !self.meter.room(kind, amount) { return Err(RuntimeError::Bound { kind, actual: used.saturating_add(amount), ceiling, site: self.meter.site().into() }); }
        }
        Ok(())
    }

    pub(super) fn sequence_insert_readable(&mut self, name: &str, row: &Value) -> Result<bool, RuntimeError> {
        let table = &self.schema.tables[name];
        if table.sequences.is_empty() || self.context.is_system() || table.rules.read.is_uniformly_readable() { return Ok(true); }
        // Read authority must be established from supplied/defaulted fields,
        // independently of the hidden counter's eventual assignment.
        if super::rules::deciding_fields(name, table, &table.rules.read).iter().any(|field| table.sequences.contains_key(field)) { return Ok(false); }
        self.evaluate_read_rule(name, row)
    }

    // @ref LLP 3000.015#2 — index membership and order consume provisional
    // ordinals even when the requested suffix currently contains no rows.
    pub(super) fn observe_sequence_selection(&mut self, name: &str, index_name: &str, prefix: &[Value]) -> Result<(), RuntimeError> {
        if !self.device || self.device_allowance.is_none() || self.provisional_sequence_read { return Ok(()); }
        let table = &self.schema.tables[name];
        let index = &table.indexes[index_name];
        let Some(position) = index.components.iter().position(|part| part.column().is_some_and(|field| table.sequences.contains_key(field))) else { return Ok(()); };
        self.observe_provisional_selection(name, index, &prefix[..prefix.len().min(position)])
    }

    // @ref LLP 3000.020#3.2 — inspect only overlay metadata, including rows whose
    // eventual ordinal could enter an empty suffix. Confirmed history is irrelevant.
    pub(super) fn observe_provisional_selection(&mut self, name: &str, index: &crate::schema::Index, prefix: &[Value]) -> Result<(), RuntimeError> {
        let table = &self.schema.tables[name];
        let bytes = crate::rows::disclosed::decode_reservation(table);
        // Observation has no caller charge; both decoding and metadata iteration
        // spend the device work allowance and the shared private fetch allowance.
        let dependent = self.device_work(|runner| runner.prepaid_witnesses(|runner, allowance| {
            let mut after = String::new();
            let mut local = runner.provisional_rows.iter().filter(|(table, _)| table == name);
            loop {
                let mark = runner.meter.mark();
                runner.meter.step(1)?;
                runner.meter.heap(crate::rows::MAX_INDEX_KEY_BYTES as u64 * 4)?;
                // Newly written rows cover raw core callers without overlay metadata.
                let id = if let Some((_, id)) = local.next() { id.as_str() } else {
                    let Some(id) = runner.tx.provisional_id_after(name, &after)? else {
                        runner.meter.release_heap(mark); return Ok(false);
                    };
                    after = id;
                    &after
                };
                runner.meter.charge(MeterKind::Examined, 1)?;
                runner.meter.heap(bytes)?;
                let provisional = if let Some(row) = runner.tx.get(allowance, name, id)? {
                    // Non-column key components cannot disprove membership here.
                    // Keep the stable column pins and conservatively observe the row.
                    index.components.iter().zip(prefix)
                        .all(|(field, value)| field.column().is_none_or(|field| row.field(field).ok() == Some(value)))
                        && runner.is_provisional(name, &row)?
                } else { false };
                runner.meter.release_heap(mark);
                if provisional { return Ok(true); }
            }
        }))?;
        self.provisional_sequence_read |= dependent;
        Ok(())
    }

    pub(super) fn sequence_field_is_provisional(&self, row: &Value, field: &str) -> Result<bool, RuntimeError> {
        if !self.device || row.field("id").and_then(Value::as_str).is_err() { return Ok(false); }
        for (name, table) in &self.schema.tables {
            if table.sequences.contains_key(field) && self.is_provisional(name, row)? { return Ok(true); }
        }
        Ok(false)
    }

    pub(super) fn evaluate_sequence_rule(&mut self, allowance: &Authorization, name: &str, rule: &RuleExpr, effect: Effect, old: Option<&Value>, next: &Value) -> Result<bool, RuntimeError> {
        let next_provisional = self.device && (effect == Effect::Insert || self.is_provisional(name, next)?);
        let old_provisional = old.map(|row| self.is_provisional(name, row)).transpose()?.unwrap_or(false);
        let viewer = self.context.viewer.clone();
        super::rules::evaluate(rule, &viewer, old, next, effect == Effect::Insert, &mut SequenceProbe {
            runner: self, allowance, table: name, old: old_provisional, next: next_provisional,
        })
    }

    #[cfg(feature = "sqlite")]
    pub(super) fn evaluate_update_rule(&mut self, allowance: &Authorization, name: &str, rule: &RuleExpr, both: bool, old: Option<&Value>, next: &Value) -> Result<(bool, &'static str), RuntimeError> {
        let next_provisional = self.device && self.is_provisional(name, next)?;
        let old_provisional = old.map(|row| self.is_provisional(name, row)).transpose()?.unwrap_or(false);
        let viewer = self.context.viewer.clone();
        super::rules::evaluate_update(rule, both, &viewer, old, next, &mut SequenceProbe {
            runner: self, allowance, table: name, old: old_provisional, next: next_provisional,
        })
    }

    pub(super) fn observe_sequence_columns(&mut self, name: &str, row: &Value, fields: &[String], inserting: bool) -> Result<(), RuntimeError> {
        if self.device && fields.iter().any(|field| self.schema.tables[name].sequences.contains_key(field)) {
            self.provisional_sequence_read |= inserting || self.is_provisional(name, row)?;
        }
        Ok(())
    }

    /// Author-facing point reads and pages share the sequence result contract.
    pub(super) fn sequence_read_result(&mut self, name: &str, mut row: Value) -> Result<Value, RuntimeError> {
        if row != Value::Null && row.field("pending") != Ok(&Value::Bool(true)) && (!self.schema.tables[name].sequences.is_empty() || self.schema.receipt_insert(name)) && self.is_provisional(name, &row)? {
            let bytes = self.project_row(name, row.clone())?.heap_bytes();
            self.meter.heap(bytes + word_heap::insertion::<String, Value>(row.as_object()?.len()) + word_heap::text("pending"))?;
            if let Value::Row(fields) | Value::Map(fields) = &mut row { fields.insert("pending".into(), Value::Bool(true)); }
        }
        Ok(row)
    }

    #[cfg(feature = "sqlite")]
    pub(super) fn import_sequences(&mut self, name: &str, mut row: Value, old: Option<&Value>, restore: bool) -> Result<Value, RuntimeError> {
        let table = self.schema.table(name).ok_or_else(|| RuntimeError::Schema(format!("missing table {name}")))?;
        if table.sequences.is_empty() {
            return Ok(row);
        }
        if !restore {
            refuse_fields(table, name, &row)?;
            if let Some(old) = old {
                for (column, reference) in &table.sequences {
                    if row.field(reference)? != old.field(reference)? {
                        return Err(RuntimeError::Structural {
                            code: "E_SEQUENCE_PARENT",
                            message: format!("{name}.{reference} cannot change after sequence allocation; import a new row id (guide types)"),
                        });
                    }
                    if let Value::Row(fields) | Value::Map(fields) = &mut row {
                        fields.insert(column.clone(), old.field(column)?.clone());
                    }
                }
            } else {
                let (candidate, full) = self.sequence_fields(name, row.import_input(&super::ImportInput(())))?;
                if full {
                    return Err(exhausted());
                }
                row = candidate;
            }
        }
        for (column, reference) in &self.schema.tables[name].sequences {
            let ColumnType::Ref { table: parent } = &self.schema.tables[name].columns[reference] else {
                unreachable!("validated sequence")
            };
            let value = row.field(column)?.as_int()?;
            if value < 1 || value > crate::value::I53_MAX {
                return Err(RuntimeError::Input("restored sequences must be positive ints".into()));
            }
            let id = row.field(reference)?.as_str()?;
            let previous = self.metered_scan(|runner, allowance| runner.tx.sequence_value(allowance, parent, id))?;
            self.tx.set_sequence(parent, id, previous.max(value))?;
        }
        Ok(row)
    }

    pub(super) fn sequence_fields(&mut self, name: &str, row: crate::value::Supplied) -> Result<(Value, bool), RuntimeError> {
        let table = self.schema.table(name).ok_or_else(|| RuntimeError::Schema(format!("missing table {name}")))?;
        if table.sequences.is_empty() {
            return Ok((row.into_value(), false));
        }
        refuse_fields(table, name, &row)?;
        self.meter.heap(row.heap_bytes())?;
        let mut row = row.into_value();
        let mut values = BTreeMap::new();
        let mut full = false;
        for (column, reference) in &table.sequences {
            let Some(ColumnType::Ref { table: parent }) = table.columns.get(reference) else {
                return Err(RuntimeError::Structural {
                    code: "E_SEQUENCE_PARENT",
                    message: format!("{name}.{reference} must be a required parent reference (guide types)"),
                });
            };
            let id = row.field(reference)?.as_str()?.to_owned();
rg: snapback4/crates/snapback4-core/src/engine/references.rs: No such file or directory (os error 2)
snapback4/crates/snapback4-core/src/engine/write_references.rs:4://! from outside the closure, clear `set null` references outside it, and
snapback4/crates/snapback4-core/src/engine/write_references.rs:6:// @ref LLP 3000.039#3 — closure first; probes exclude the closure; deletion dominates set null.
snapback4/crates/snapback4-core/src/engine/write_references.rs:133:        // child. Decide that blocker before set-null writes begin, so expiry
snapback4/crates/snapback4-core/src/engine/write_references.rs:148:                if r.action != OnDelete::SetNull { continue; }
snapback4/crates/snapback4-core/src/engine/write_references.rs:176:    /// (cascade, set null) reads `PAGE` rows per seek and holds at most the
snapback4/crates/snapback4-core/src/engine/write_references.rs:237:    /// The engine's own write of a `set null` reference: no rule, every constraint.
snapback4/crates/snapback4-core/src/store/release_cycle_tests.rs:107:    let mut e=engine(current);seed(&mut e,"locks",json!({"id":"lock","value":null}));seed(&mut e,"docs",json!({"id":"d","body":"frozen"}));
snapback4/crates/snapback4-core/src/store/rollback_guard_population.rs:409:    if schema.tables.values().any(|t|t.frozen_columns.values().any(|r|json_taint(&serde_json::to_value(r).unwrap(),&BTreeSet::new(),hidden))) {return Err(refuse());}
snapback4/crates/snapback4/src/dev_clock.rs:62:    frozen: bool,
snapback4/crates/snapback4/src/dev_clock.rs:69:            epoch: snapback4_core::ids::mint(snapback4_core::now_ms(), &mut snapback4_core::ids::Mint::default()).map_err(|e| e.refusal())?, revision: 0, #[cfg(test)] frozen: false })
snapback4/crates/snapback4/src/dev_clock.rs:78:    pub(crate) fn freeze(&mut self, now: i64) { self.base = now; self.frozen = true; }
snapback4/crates/snapback4/src/dev_clock.rs:80:        #[cfg(test)] if self.frozen { return self.base; }
snapback4/crates/snapback4/src/dev_clock.rs:99:        #[cfg(test)] { self.frozen = false; }
snapback4/crates/snapback4/src/scale/following.rs:3:// server protocol, including its frozen domain, omissions and stalled exception.
snapback4/crates/snapback4/src/scale/following.rs:20:const GUARANTEE: &str = "each page is a correct prefix of the frozen viewer/edge/birth domain; bounded requests continue to completion once post-bound backdated births and follow additions stop obstructing unscanned keys; obstruction checkpoints as stalled, never false exhaustion; oversized cards are named omissions; expiry or authority loss may restart; post-bound births and follows are covered by the next session (refresh), with recent live previews retained until withdrawal or reset";
snapback4/crates/snapback4-core/src/store/asset_renames.rs:12:    table.column_writes=replace_keys(std::mem::take(&mut table.column_writes),map);
snapback4/crates/snapback4-core/src/store/asset_renames.rs:13:    table.frozen_columns=replace_keys(std::mem::take(&mut table.frozen_columns),map);
snapback4/crates/snapback4-core/src/store/asset_renames.rs:19:    for r in table.column_reads.values_mut().chain(table.column_writes.values_mut()).chain(table.frozen_columns.values_mut()){rule(r,map)}
snapback4/crates/snapback4/src/verbs/releases.rs:195:        snapback4_lang::release_bridge::exact_write_authority(&target,&current).map_err(|e|format!("E_ADOPT: {e}"))?;
snapback4/crates/snapback4/src/verbs/releases.rs:198:            snapback4_lang::release_bridge::exact_write_authority(&target,&source).map_err(|e|format!("E_ADOPT: latest source {latest}: {e}"))?;
snapback4/crates/snapback4/src/verbs/run_refusal.rs:186:    const SCHEMA: &str = "table orders:\n  author: principal\n  read <- .author = viewer\n  update <- deny   -- frozen\n";
snapback4/crates/snapback4/src/verbs/run_refusal.rs:225:        assert_eq!(code("update <- deny -- frozen"), "update <- deny");
snapback4/crates/snapback4/src/verbs/rollback_views.rs:209:                            || !policies.optional_rule(table.column_writes.get(c),next.column_writes.get(c))
snapback4/crates/snapback4/src/verbs/rollback_views.rs:210:                            || !policies.optional_rule(table.frozen_columns.get(c),next.frozen_columns.get(c))
snapback4/crates/snapback4/src/verbs/release_bridge.rs:9:    lines.push("Review nullable old result fields in the frozen UI; never substitute zero for an amount still to follow. Deploy with --restore-dormant --check, then --restore-dormant to activate.".into());
snapback4/crates/snapback4/src/verbs/init/day2-proof.mjs:22:  // Return [{ id:"table/id", fields:["changedField"] }, ...] for writes by the frozen v1
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
   452	                        // Null placement on insert is not a protected column write in the engine.
   453	                        if effect=="insert"&&object.and_then(|o|o.get(column)).is_some_and(|v|v.get("Literal").is_some_and(|literal|literal.is_null())){continue;}
   454	                        if object.is_none_or(|o|o.contains_key(column)) || effect!="update"&&defaulted {return true;}
   455	                    }
   456	                    if writes_column(body,table,column,effect,defaulted){return true;}
   457	                }false
   458	            },
   459	            serde_json::Value::Array(xs)=>xs.iter().any(|x|writes_column(x,table,column,effect,defaulted)),
   460	            _=>false,
   461	        }
   462	    }
   463	    fn leading_guard(target:&[(String,String)],aligned:&snapback4_core::Schema,table:&str,operation:&str,policy:&RuleExpr)->bool {
   464	        let mut sources=target.to_vec();
   465	        let Some((_,source))=sources.first_mut()else{return false};
   466	        source.push_str(&format!("\ninvariant {table}.{operation} only allow\n"));
   467	        let proof=crate::compile(&sources);if !proof.diagnostics.is_empty(){return false;}
   468	        let comparison=PolicyComparison::new(&proof.schema,aligned);
   469	        // @ref LLP 3000.000.000#21-wave-27-release-semantics-rel — finite control flow preserves a stable leading guard; scope changes do not.
   470	        fn stable(rule:&RuleExpr)->bool {
   471	            use snapback4_core::schema::RuleTerm;
   472	            match rule {
   473	                RuleExpr::Exists{key,equalities,..}=>key.iter().chain(equalities.iter().map(|(_,t)|t)).all(|t|matches!(t,RuleTerm::Viewer|RuleTerm::Literal(_))),
   474	                RuleExpr::And(xs)|RuleExpr::Or(xs)=>xs.iter().all(stable),
   475	                RuleExpr::Eq(a,b)|RuleExpr::Ne(a,b)=>[a,b].iter().all(|t|matches!(t,RuleTerm::Viewer|RuleTerm::Literal(_))),
   476	                RuleExpr::Allow|RuleExpr::Deny=>true,_=>false,
   477	            }
   478	        }
   479	        fn opaque(value:&serde_json::Value)->bool {match value {
   480	            serde_json::Value::Object(m) if m.contains_key("Literal")=>false,
   481	            serde_json::Value::Object(m)=>m.keys().any(|k|matches!(k.as_str(),"JobAs"|"JobQuery"|"Emit"))||m.values().any(opaque),
   482	            serde_json::Value::String(s)=>matches!(s.as_str(),"JobAs"|"JobQuery"),
   483	            serde_json::Value::Array(xs)=>xs.iter().any(opaque),_=>false,
   484	        }}
   485	        let Some(program)=proof.programs.iter().find(|p|p.program.name==operation) else{return false};
   486	        if opaque(&serde_json::to_value(&program.program).unwrap()) {return false;}
   487	        let writes=snapback4_core::ir::write_tables(&program.program);
   488	        // Refuse unmodeled implicit effects reachable from this operation;
   489	        // an unrelated maintained table or cascading edge is not a write.
   490	        if writes.iter().any(|(name,effect)|proof.schema.table(name).is_none_or(|t|
   491	            !t.maintained.is_empty()||!t.sequences.is_empty()
   492	            ||proof.schema.maintains.iter().any(|m|m.source==*name||m.target==*name)
   493	            ||*effect=="delete"&&proof.schema.tables.values().any(|child|child.columns.iter().any(|(column,kind)|
   494	                matches!(kind.required(),snapback4_core::schema::ColumnType::Ref{table} if table==name)&&child.on_delete.get(column).is_some_and(|a|a.writes()))))) {return false;}
   495	        proof.invariants.iter().any(|inv|inv.table==table&&inv.operation.as_deref()==Some(operation)
   496	            &&inv.requirements.iter().any(|require|stable(require)&&implies(require,policy,&comparison)
   497	                &&crate::security::kernel::dependencies(require).iter().all(|dependency|proof.schema.table(dependency).is_some_and(|t|
   498	                    t.through.is_none()&&!t.is_expiring()&&t.recorded.is_empty())&&!writes.iter().any(|(t,_)|t==dependency))))
   499	    }
   500	    let policies=PolicyComparison::new(&old.schema,&aligned);
   501	    for(name,current)in &aligned.tables {
   502	        let Some(prior)=old.schema.table(name)else{continue};
   503	        for (column,policy) in &current.column_writes {
   504	            if !prior.columns.contains_key(column){continue;}
   505	            for program in &old.programs {
   506	                let writes=snapback4_core::ir::write_tables(&program.program);
   507	                for(_,effect)in writes.iter().filter(|(t,e)|t==name&&*e!="delete") {
   508	                    let defaulted=prior.defaults.get(column).is_some_and(|d|!matches!(d,snapback4_core::schema::ColumnDefault::Literal(snapback4_core::Value::Null)));
   509	                    if !writes_column(&serde_json::to_value(&program.program).unwrap(),name,column,effect,defaulted){continue;}
   510	                    let safe=prior.column_writes.get(column).is_some_and(|old|policies.rule(old,policy)) || match *effect {"insert"=>implies(&prior.rules.insert,policy,&policies),"update"=>!prior.update_transition&&implies(&prior.rules.update,policy,&policies),"upsert"=>!prior.update_transition&&implies(&prior.rules.insert,policy,&policies)&&implies(&prior.rules.update,policy,&policies),_=>false};
   511	                    if !safe && !leading_guard(target,&aligned,name,&program.program.name,policy) {return Err(format!("{}: exact source operation {} can write {name}.{column} without current rule `write <- {}`; retain this audience in a guarded bridge before selecting the source",program.site,program.program.name,policy.quarry()));}
   512	                }
   513	            }
   514	        }
   515	        for(column,condition)in &current.frozen_columns {
   516	            if prior.columns.contains_key(column)&&!prior.frozen_columns.get(column).is_some_and(|old|policies.rule(old,condition))&&*condition!=RuleExpr::Deny&&!prior.constraints.iter().any(|c|matches!(c,snapback4_core::schema::Constraint::Immutable{fields}if fields.contains(column)))&&old.programs.iter().any(|p|snapback4_core::ir::write_tables(&p.program).iter().any(|(t,e)|t==name&&*e!="delete"&&writes_column(&serde_json::to_value(&p.program).unwrap(),name,column,e,false))) {
   517	                return Err(format!("{name}.{column}: exact source omits current rule `immutable when {}`; retain the freeze in an authored bridge before selecting source",condition.quarry()));
   518	            }
   519	        }
   520	    }
   521	    Ok(())
   522	}
snapback4/crates/snapback4-core/src/schema/through.rs:31:    pub fn is_expiring(&self) -> bool {

exec
/bin/bash -lc "sed -n '298,345p' snapback4/crates/snapback4-lang/src/bind/program/expr.rs; sed -n '232,274p' snapback4/crates/snapback4-core/src/engine/write_references.rs; cat snapback4/crates/snapback4-core/src/schema/through.rs | head -55; rg -n 'pub\\(.*\\) fn evaluate|pub fn evaluate|fn exists' snapback4/crates/snapback4-core/src/engine/rules*; rg -n 'match rule|Exists \\{' snapback4/crates/snapback4-core/src/engine/rules_reference.rs | head -35; rg -n 'fn latest|check_change\\(|command_lock\\(' snapback4/crates/snapback4/src/verbs/releases.rs" in /home/ccheever/projects/sb4-b27-rel
 succeeded in 0ms:

    /// `connected[p]`: how many connections the principal holds open on the
    /// server now, an int; `exists connected[p]` is the bool. Not a table:
    /// the server's registry of long polls answers it, a device answers 1
    /// and marks its read, and the server decides the write.
    fn connected(&mut self, read: &ReadExpr, out: &mut setup::Body) -> Fallible<(Expr, Ty)> {
        let site = &read.site;
        if read.keys.len() != 1 || read.range.is_some() || read.matching.is_some() || read.index.is_some() {
            return Err(unknown(site, "connected takes one principal: connected[p] counts its connections, exists connected[p] tests", "exists connected[m.principal]"));
        }
        let key = &read.keys[0];
        let (e, t) = self.expr_as_identity(&key.value, out, &Ty::Principal)?;
        if !matches!(t.required(), Ty::Principal | Ty::Id) {
            return Err(type_error(key.value.site(), format!("connected takes a principal, got {}", t.name()), "connected[m.principal]"));
        }
        // @ref LLP 3000.007#20.1 — retain the author's deciding read alongside the IR, never in its serialized form.
        self.presence_sources.push((e.clone(), site.clone(), print::read_expr(read)));
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
        // unacquired range is unknown even when the rule admits the viewer).
        if self.device_work(|runner| runner.upsert_absence_proven(&child, &index, &key))? && self.tx.current_group(&child, &index, &key)? { return Ok(()); }
        Err(RuntimeError::Prediction(format!("deleting needs every {} row that references it held; queued without a local delete", r.child)))
    }

    /// The engine's own write of a `set null` reference: no rule, every constraint.
    fn clear_reference(&mut self, table: &str, column: &str, old: Value) -> Result<(), RuntimeError> {
        let mut new = old.clone();
        if let Value::Row(fields) | Value::Map(fields) = &mut new { fields.insert(column.to_owned(), Value::Null); }
        let patch = crate::value::object([(column, Value::Null)]);
        let outer = std::mem::replace(&mut self.engine_action, true);
        let result = self.target_attempt(table, |runner| {
            runner.reserve_maintains(table, &runner.schema.tables[table])?;
            runner.replace_authorized(table, old, new, true, &patch, 0)
        });
        self.engine_action = outer;
        result
    }

    /// The engine's own delete of a closure row: no rule, its constraints, its
    /// `read through` children's probe, maintains and partition events.
    fn delete_reached(&mut self, table_name: &str, old: Value) -> Result<(), RuntimeError> {
        self.target_attempt(table_name, |runner| {
            runner.refuse_engine_owned(table_name, Effect::Delete)?;
            let table = &runner.schema.tables[table_name];
            runner.reserve_maintains(table_name, table)?;
            runner.delete_row(table_name, old)
        })
    }
}

/// Rows a child scan holds per seek: the reservation's transient `4 × row`
/// (LLP 3000.039 §5.1, `Schema::delete_reservation`).
const PAGE: usize = crate::schema::references::REFERENCE_PAGE;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Context, rows::{MemoryRows, Rows}, value::{Value, object}};

    #[test]
    fn prepaid_actions_keep_nested_device_proofs_bounded() {
        let bound = snapback4_lang::compile(&[("nested-allowance.q".into(), r#"
//! Lifetime-bound rule inputs, distinct from historical recorded attribution.
// @ref LLP 3000.014#4-the-capture — captures have their parent's type and activation lifecycle.
use super::*;

pub const PARENT_DEADLINE: &str = "$parentDeadline";
pub const DEADLINE: &str = "$deadline";
pub const CHILDREN: &str = "$children";
pub const LIVE_CHILDREN: &str = "$liveChildren";

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Through {
    /// Bounded live maintenance; absence preserves captured wire bytes.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub live: Option<u32>,
    pub reference: String,
    pub parent: String,
    /// Child engine field -> immediate parent field (including its captures).
    pub fields: BTreeMap<String, String>,
    pub identity: String,
    pub expiring: bool,
}

impl Table {
    pub fn engine_field(&self, field: &str) -> bool {
        (self.ephemeral.is_some() && field == DEADLINE) || self.recorded.contains_key(field)
            || self.through.as_ref().is_some_and(|t| {
                t.fields.contains_key(field) || matches!(field, DEADLINE | PARENT_DEADLINE)
            })
    }
    /// One classification for every expiry gate, including inherited deadlines.
    pub fn is_expiring(&self) -> bool {
        self.ephemeral.is_some() || self.expire.is_some() || self.through.as_ref().is_some_and(|t| t.expiring)
    }
    pub fn expiry_column(&self) -> Option<&str> {
        if self.ephemeral.is_some() || self.through.is_some() && self.is_expiring() {
            Some(DEADLINE)
        } else {
            self.expire.as_deref()
        }
    }
    pub fn deadline(&self, row: &Value) -> Option<i64> {
        match self
            .expiry_column()
            .and_then(|field| row_image(row, self).field(field).ok().cloned())
        {
            Some(Value::Int(at)) => Some(at),
            _ => None,
        }
    }
    /// Never trust a restored effective instant; recompute from immutable capture.
    pub fn recompute_deadline(&self, row: &mut Value) -> Result<(), crate::error::RuntimeError> {
        if self.through.is_none() {
            return Ok(());
        }
        let authored = self
snapback4/crates/snapback4-core/src/engine/rules_reference.rs:4:pub(crate) fn evaluate(rule: &RuleExpr, viewer: &str, old: Option<&Value>, next: &Value, probe: &mut dyn Probe) -> Result<bool, crate::RuntimeError> {
snapback4/crates/snapback4-core/src/engine/rules.rs:1198:    fn exists(&mut self, table: &str, index: &str, key: &[Value], equalities: &[(String, Value)]) -> Result<bool, crate::error::RuntimeError>;
snapback4/crates/snapback4-core/src/engine/rules.rs:1218:pub fn evaluate(rule: &RuleExpr, viewer: &str, old: Option<&Value>, next: &Value, created_allowed: bool, probe: &mut dyn Probe) -> Result<bool, crate::error::RuntimeError> {
snapback4/crates/snapback4-core/src/engine/rules.rs:1222:pub(super) fn evaluate_verdict(rule: &RuleExpr, viewer: &str, old: Option<&Value>, next: &Value, created_allowed: bool, probe: &mut dyn Probe) -> Result<Verdict, crate::error::RuntimeError> {
snapback4/crates/snapback4-core/src/engine/rules.rs:1266:pub(super) fn evaluate_update(rule: &RuleExpr, both: bool, viewer: &str, old: Option<&Value>, next: &Value, probe: &mut dyn Probe) -> Result<(bool, &'static str), crate::error::RuntimeError> {
snapback4/crates/snapback4-core/src/engine/rules.rs:1425:        fn exists(&mut self, table: &str, _: &str, _: &[Value], _: &[(String,Value)]) -> Result<bool, crate::RuntimeError> {
14:    match rule {
185:fn check_change(
226:pub(super) fn command_lock(dir: &Path) -> Result<std::fs::File, String> {
396:            let _command = command_lock(&dir)?;
434:            check_change(&dir, previous, &bound, options, None)?;
499:                check_change(&dir,previous,&bound,options,Some(n))?;
599:            let _command = command_lock(&dir)?;
650:            check_change(&dir, Some(active), &bound, options, Some(previous)).map_err(&legacy_refusal)?;
723:            let _command = command_lock(&dir)?;
970:pub(super) fn latest(dir:&Path)->Result<u64,String>{

exec
/bin/bash -lc "sed -n '1185,1268p' snapback4/crates/snapback4-core/src/engine/rules.rs; rg -n 'impl.*Probe for|fn exists\\(' snapback4/crates/snapback4-core/src/engine/sequences.rs; sed -n '290,385p' snapback4/crates/snapback4-core/src/engine/sequences.rs; sed -n '1330,1408p' snapback4/crates/snapback4-core/src/schema.rs; sed -n '375,455p' snapback4/crates/snapback4/src/verbs/releases.rs; sed -n '470,525p' snapback4/crates/snapback4/src/verbs/releases.rs; sed -n '970,997p' snapback4/crates/snapback4/src/verbs/releases.rs" in /home/ccheever/projects/sb4-b27-rel
 succeeded in 0ms:
/// Something that can answer an `exists`/`created` probe while a rule runs.
pub trait Probe {
    fn reference(&mut self, _table: &str, _id: &Value, _field: &str) -> Result<Option<Value>, crate::error::RuntimeError> { Ok(None) }
    /// Exact count-predicate transitions, distinct from ordinary witness expiry.
    fn take_changes(&mut self) -> Option<Vec<(i64, super::rules::Verdict)>> { None }
    /// Exchange the private expiry accumulator; ordinary probes have none.
    fn replace_expiry(&mut self, _expiry: Option<i64>) -> Option<i64> { None }
    /// Coverage of the most recent leaf, consumed once by the shared evaluator.
    fn take_unknown(&mut self) -> bool { false }
    /// Called only when evaluation loads a field, after short-circuit decisions.
    fn field(&mut self, _field: &str, _old: bool) {}
    /// Apply the schema's point-key null rule before storage access. Timeline
    /// evaluation can visit operands that logical short-circuiting would skip.
    fn exists(&mut self, table: &str, index: &str, key: &[Value], equalities: &[(String, Value)]) -> Result<bool, crate::error::RuntimeError>;
    fn created(&mut self, table: &str, index: &str, key: &[Value]) -> bool;
}

#[derive(Clone, Copy, PartialEq, Eq, Default)]
pub enum Verdict { Readable, Denied, #[default] Unknown }

impl Verdict {
    fn not(self) -> Self {
        match self { Self::Readable => Self::Denied, Self::Denied => Self::Readable, Self::Unknown => Self::Unknown }
    }
    fn combine(self, other: Self, conjunction: bool) -> Self {
        let decisive = if conjunction { Self::Denied } else { Self::Readable };
        if self == decisive || other == decisive { decisive }
        else if self == Self::Unknown || other == Self::Unknown { Self::Unknown }
        else { decisive.not() }
    }
}

/// Evaluate a rule over a row image (and its old image, for update rules).
pub fn evaluate(rule: &RuleExpr, viewer: &str, old: Option<&Value>, next: &Value, created_allowed: bool, probe: &mut dyn Probe) -> Result<bool, crate::error::RuntimeError> {
    evaluate_verdict(rule, viewer, old, next, created_allowed, probe).map(|verdict| verdict == Verdict::Readable)
}

pub(super) fn evaluate_verdict(rule: &RuleExpr, viewer: &str, old: Option<&Value>, next: &Value, created_allowed: bool, probe: &mut dyn Probe) -> Result<Verdict, crate::error::RuntimeError> {
    let prior = probe.replace_expiry(None);
    let result = timeline(rule, viewer, old, next, created_allowed, probe);
    probe.replace_expiry(match &result {
        Ok(answer) if answer.value == Verdict::Readable => earliest(prior, answer.changes.first().map(|(time, _)| *time)),
        _ => prior,
    });
    result.map(|answer| answer.value)
}

pub(super) fn earliest(a: Option<i64>, b: Option<i64>) -> Option<i64> {
    match (a, b) { (Some(a), Some(b)) => Some(a.min(b)), (a, b) => a.or(b) }
}

struct Timeline {
    value: Verdict,
    changes: Vec<(i64, Verdict)>,
    // Proven from rule structure and verdicts, never from witness deadlines.
    invariant: bool,
}
impl Timeline {
    fn constant(value: Verdict) -> Self { Self { value, changes: Vec::new(), invariant: true } }
    fn combine(self, other: Self, conjunction: bool) -> Self {
        let (mut left, mut right) = (self.value, other.value);
        let mut result = Self::constant(left.combine(right, conjunction));
        let decisive = if conjunction { Verdict::Denied } else { Verdict::Readable };
        result.invariant = (self.invariant && left == decisive)
            || (other.invariant && right == decisive) || (self.invariant && other.invariant);
        let (mut a, mut b) = (self.changes.as_slice(), other.changes.as_slice());
        let mut previous = result.value;
        while let Some(time) = earliest(a.first().map(|(t, _)| *t), b.first().map(|(t, _)| *t)) {
            // All rows expiring at the same instant disappear together. This
            // preserves correlations, including A or not A and A and not A.
            if let Some((head, tail)) = a.split_first() && head.0 == time { left = head.1; a = tail; }
            if let Some((head, tail)) = b.split_first() && head.0 == time { right = head.1; b = tail; }
            let value = left.combine(right, conjunction);
            if value != previous { result.changes.push((time, value)); previous = value; }
        }
        result
    }
}

// @ref LLP 3000.036.002#11 — observe the existing evaluation, never re-probe for diagnostics.
#[cfg(feature = "sqlite")]
pub(super) fn evaluate_update(rule: &RuleExpr, both: bool, viewer: &str, old: Option<&Value>, next: &Value, probe: &mut dyn Probe) -> Result<(bool, &'static str), crate::error::RuntimeError> {
    let prior = probe.replace_expiry(None);
    let result = if both {
353:impl super::rules::Probe for SequenceProbe<'_, '_> {
361:    fn exists(&mut self, table: &str, index: &str, key: &[Value], equalities: &[(String, Value)]) -> Result<bool, RuntimeError> {
                && !table.maintained.contains_key(field) && (ty.is_optional() || table.defaults.contains_key(field)))
    }

    // @ref LLP 3000.007#5.4 — complete the result only after supplied-field
    // authority and defaults have run; omission is never an explicit null input.
    pub(super) fn complete_insert_result(&mut self, name: &str, row: Value, prepaid: bool) -> Result<Value, RuntimeError> {
        let table = &self.schema.tables[name];
        let missing = |field: &String, ty: &ColumnType| row.field(field).is_err()
            && !table.engine_field(field) && !crate::schema::timeline::is_slot(field)
                && !table.maintained.contains_key(field) && (ty.is_optional() || table.defaults.contains_key(field));
        let bytes = table.columns.iter().filter(|(f,t)| missing(f,t)).fold(0u64, |bytes, (f,_)|
            bytes.saturating_add(80 + f.len() as u64).saturating_add(
                match table.defaults.get(f) {
                    Some(crate::schema::ColumnDefault::Literal(value)) => super::runner::expression_copy(value),
                    Some(crate::schema::ColumnDefault::Viewer) => self.context.viewer.len() as u64,
                    Some(crate::schema::ColumnDefault::Now) | None => 0,
                }));
        if bytes == 0 { return Ok(row); }
        if !prepaid { self.meter.heap(super::runner::expression_heap(&row).saturating_add(bytes))?; }
        let now = self.context.now.ok_or_else(|| RuntimeError::Input("write clock is not pinned".into()))?;
        let mut fields = row.as_object()?.clone();
        for (field, ty) in &table.columns {
            if missing(field, ty) {
                fields.insert(field.clone(), table.defaults.get(field).map_or(Value::Null, |d| d.value(now, &self.context.viewer)));
            }
        }
        Ok(Value::Row(fields.into()))
    }

    /// Fill the result without making engine values caller-supplied fields.
    pub(super) fn sequence_result(&mut self, name: &str, row: Value) -> Result<Value, RuntimeError> {
        // Receipt completion shares the existing full-row copy reservation in
        // receipt_result; completing here would charge the same map twice.
        let mut row = if self.schema.receipt_insert(name) { row }
            else { self.complete_insert_result(name, row, false)? };
        let table = self.schema.table(name).ok_or_else(|| RuntimeError::Schema(format!("missing table {name}")))?;
        if table.sequences.is_empty() {
            return self.receipt_result(name, row);
        }
        let stored = self.metered_scan(|runner, allowance| runner.tx.get(allowance, name, row.field("id")?.as_str()?))?.expect("just inserted");
        let stored = self.project_row(name, stored)?;
        self.meter.heap(stored.heap_bytes())?;
        let stored = stored.into_value();
        if let Value::Row(fields) | Value::Map(fields) = &mut row {
            for column in table.sequences.keys() {
                fields.insert(column.clone(), stored.field(column)?.clone());
            }
            if self.device {
                fields.insert("pending".into(), Value::Bool(true));
            }
        }
        self.receipt_result(name, row)
    }
}

/// Dependency tracking follows rule evaluation, including its short circuits.
struct SequenceProbe<'a, 'b> {
    runner: &'a mut Runner<'b>,
    allowance: &'a Authorization,
    table: &'a str,
    old: bool,
    next: bool,
}
impl super::rules::Probe for SequenceProbe<'_, '_> {
    fn reference(&mut self, table: &str, id: &Value, field: &str) -> Result<Option<Value>, RuntimeError> { self.runner.rule_reference(table, id, field) }
    fn take_changes(&mut self) -> Option<Vec<(i64, super::rules::Verdict)>> { self.runner.witness_changes.take() }
    fn replace_expiry(&mut self, expiry: Option<i64>) -> Option<i64> { self.runner.next_expiry.replace(expiry) }
    fn field(&mut self, field: &str, old: bool) {
        self.runner.provisional_sequence_read |= (if old { self.old } else { self.next })
            && self.runner.schema.tables[self.table].sequences.contains_key(field);
    }
    fn exists(&mut self, table: &str, index: &str, key: &[Value], equalities: &[(String, Value)]) -> Result<bool, RuntimeError> {
        super::rules::Probe::exists(&mut super::read::RuleProbe { runner: self.runner, allowance: self.allowance }, table, index, key, equalities)
    }
    fn created(&mut self, table: &str, index: &str, key: &[Value]) -> bool {
        self.runner.created(table, index, key)
    }
}

#[cfg(all(test, feature = "sqlite"))]
mod tests {
    use super::*;
    use crate::{Context, meter::{Ceilings, Cut, Meter}, store::Store, value::object};

    #[test]
    fn pending_copy_is_charged_before_mutation_at_the_heap_ceiling() {
        let bound = snapback4_lang::compile(&[("schema.q".into(), "table parents:\n  public\n  online only\ntable messages:\n  parent: parents\n  ordinal: sequence by parent\n  payload: text <=20000\n  public\n  sync public\n".into())]);
        assert!(bound.diagnostics.is_empty());
        let schema: crate::schema::Schema = crate::json_codec::from_text(&crate::json_codec::to_text(&bound.schema).unwrap()).unwrap();
        let mut store = Store::memory().unwrap();
        store.install(&schema).unwrap();
        let tx = store.transaction().unwrap();
        let original = object([("id", Value::Id("pending".into())), ("parent", Value::Id("p".into())), ("ordinal", Value::Int(1)), ("payload", Value::String("x".repeat(20000)))]);
        let mut pricing = Runner::new(&tx, &schema, Context::new("alice", Default::default()), Meter::new(Ceilings::default(), Cut::Abort), 0);
        let copy = pricing.project_row("messages", original.clone()).unwrap().heap_bytes() + word_heap::insertion::<String, Value>(original.as_object().unwrap().len()) + word_heap::text("pending");
        for room in [copy - 1, copy] {
        }
        if let Some(column) = &table.expire {
            let epath = format!("{path}.expire");
            match table.columns.get(column).map(ColumnType::required) {
                Some(ColumnType::Time) => {}
                Some(kind) => issue(&mut issues, epath.clone(), format!("expire at .{column} needs a time column; {column} is {kind}")),
                None => issue(&mut issues, epath.clone(), format!("expire names undeclared column {column}")),
            }
            if table.expiry_index().is_none() {
                issue(&mut issues, epath, format!("expire at .{column} needs an index leading with {column}"));
            }
        }
        if let Some(column) = &table.not_before {
            let opath = format!("{path}.notBefore");
            match table.columns.get(column).map(ColumnType::required) {
                Some(ColumnType::Time) => {}
                Some(kind) => issue(&mut issues, opath.clone(), format!("not before .{column} needs a time column; {column} is {kind}")),
                None => issue(&mut issues, opath.clone(), format!("not before names undeclared column {column}")),
            }
            if table.opening_index().is_none() { issue(&mut issues, opath, format!("not before .{column} needs an index leading with {column}")); }
        }
    }
    for (position, maintain) in schema.maintains.iter().enumerate() {
        validate_maintain(schema, position, maintain, &mut issues);
        if let Err(message) = own_keys::validate(schema, maintain) {
            issues.push(SchemaIssue { path: format!("maintains[{position}]"), message });
        }
    }
    for issue in &mut issues {
        for maintain in schema.maintains.iter().filter(|m|m.private.is_some()) {
            issue.path = issue.path.replace(&maintain.target, &maintain.label());
            issue.message = issue.message.replace(&maintain.target, &maintain.label());
        }
    }
    issues
}

// @ref LLP 3000.036#11 — an insert rule may order the new row's own required
// int/time columns and integer literals: one image, no clock, no hop, no null.
// @ref LLP 3000.036#12 — decimal and money are integer minor units and order the same way.
fn insert_order(table: &Table, left: &RuleTerm, right: &RuleTerm) -> bool {
    let own = |term: &RuleTerm| match term {
        RuleTerm::Field(field) => table.columns.get(field).is_some_and(|kind| matches!(kind, ColumnType::Int | ColumnType::IntRange { .. } | ColumnType::Time | ColumnType::Decimal { .. } | ColumnType::Money { .. })),
        RuleTerm::Literal(Value::Int(_)) => true,
        _ => false,
    };
    let same = match (left, right) {
        (RuleTerm::Field(a), RuleTerm::Field(b)) => table.columns.get(a) == table.columns.get(b),
        _ => true,
    };
    own(left) && own(right) && same && !matches!((left, right), (RuleTerm::Literal(_), RuleTerm::Literal(_)))
}

fn validate_rule(schema: &Schema, table: &Table, rule: &RuleExpr, update: bool, insert: bool, path: &str, issues: &mut Vec<SchemaIssue>) {
    let check_term = |term: &RuleTerm, issues: &mut Vec<SchemaIssue>| reference::validate_term(schema, table, term, update, path, issues);
    match rule {
        RuleExpr::Public { .. } | RuleExpr::Allow | RuleExpr::Deny => {}
        RuleExpr::Eq(l, r) | RuleExpr::Ne(l, r) | RuleExpr::Compare(_, l, r) => {
            if matches!(rule, RuleExpr::Compare(..)) && !(update && table.update_transition) && !(insert && insert_order(table, l, r)) { issues.push(SchemaIssue { path: path.into(), message: "ordered comparisons require a named update transition, or an insert rule over the row's own required int, time, decimal or money columns (two columns of one type)".into() }); }
            check_term(l, issues);
            check_term(r, issues);
        }
        RuleExpr::And(items) | RuleExpr::Or(items) => items.iter().for_each(|item| validate_rule(schema, table, item, update, insert, path, issues)),
        RuleExpr::Not(inner) => validate_rule(schema, table, inner, update, insert, path, issues),
        RuleExpr::Exists { table: target, index, key, equalities, .. } | RuleExpr::Created { table: target, index, key, equalities, .. } => {
            if matches!(rule, RuleExpr::Created { .. }) && !insert {
                issues.push(SchemaIssue { path: path.to_owned(), message: "created probes are valid only in insert rules".into() });
            }
            match schema.table(target).and_then(|t| t.index(index)) {
                Some(target_index) => {
                    if !target_index.is_plain() {
                        issues.push(SchemaIssue {
                            path: path.to_owned(),
                            message: format!("probe of {target}.{index} needs a plain index"),
                        });
                    }
                    if target_index.columns().len() != key.len() {
                        issues.push(SchemaIssue { path: path.to_owned(), message: format!("probe of {target}.{index} has {} terms; the index has {}", key.len(), target_index.columns().len()) });
                    }
    match result {
        Ok(()) => 0,
        Err(error) => {
            eprintln!("{verb}: {error}");
            1
        }
    }
}

pub fn deploy(options: &Options) -> i32 {
    match crate::store_config::StoreConfig::resolve(options) {
        Ok(Some(config)) => return report("deploy", super::configured_release::deploy(options, config)),
        Err(error) => return report("deploy", Err(error)),
        Ok(None) => {},
    }
    let mut security_summary=None;
    let mut failure_inventory=None;
    let mut failure_problems=None;
    let result=(|| {
            let dir = canonical_directory(options)?;
            crate::store_config::local_deployment(options, &dir)?;
            let _command = command_lock(&dir)?;
            let existed = dir.join("store.sqlite").exists();
            let checking=options.flags.contains_key("check");
            let (_deployment, held) = if checking { (None, None) } else { let (owner, held) = activation_target(&dir)?; (owner, Some(held)) };
            if let Some(owner) = &_deployment { owner.report_reclaim(options.flags.contains_key("verbose")); }
            let project = super::proof_source::project(options, "schema")?;
            let sources = super::proof_source::sources(&project, options, "schema")?;
            let bound = super::proof_source::compile(&sources, options, "schema");
            if !bound.diagnostics.is_empty(){
                failure_problems=Some(serde_json::json!({"problems":bound.diagnostics,"notes":bound.notes}));
                if !options.json{eprintln!("deploy verdict: REFUSED; compilation");super::report_diagnostics(&bound,false,false,true);}
                return Err("selected source does not compile".into())
            }
            let mut saved_version = super::saved_version::SavedVersion::prepare(&project,&sources,&bound,options,&dir)?;
            if options.flags.contains_key("staging") {
                staging::classify(&dir, _deployment.as_ref(), existed, checking)?;
            }
            std::fs::create_dir_all(dir.join("releases")).map_err(|e| e.to_string())?;
            let held = if checking {
                if dir.join("store.sqlite").exists() {snapback4_core::store_port::AnyStore::open_read_only(&dir.join("store.sqlite")).and_then(|mut s|s.release_status(0,None,None)).map_err(|e|e.to_string())?}
                else {serde_json::json!({"release":null,"revision":0,"generation":1})}
            } else {held.expect("live activation target status")};
            let previous = if let Some(owner) = _deployment.as_ref() {
                current(&dir, owner)?
            } else {
                held["release"].as_u64()
            };
            security_summary={
                let prior=previous.map(|n|bound_at(dir.join("releases").join(n.to_string()))).transpose()?;
                super::security::release_loop(&project,&bound,&sources,prior.as_ref(),options)?
            };
            super::security::enforce_release(security_summary.as_ref(),options)?;
            let baseline=crate::client_compatibility::report(&project,&bound).map_err(|e|e.to_string())?.1;
            let mut options=options.clone();
            options.flags.insert("client-baseline-advice".into(),serde_json::to_string(&baseline).unwrap());
            if let Some(summary)=&security_summary {options.flags.insert("security-summary".into(),summary.clone());}
            let options=&options;
            let revision = held["revision"].as_u64().unwrap_or(0);
            check_change(&dir, previous, &bound, options, None)?;
            let releases = dir.join("releases").canonicalize().map_err(|e| e.to_string())?;
            let stage = releases.join(format!(".stage-{}", std::process::id()));
            if stage.exists() {std::fs::remove_dir_all(&stage).map_err(|e|e.to_string())?;}
            std::fs::create_dir(&stage).map_err(|e| e.to_string())?;
            let _cleanup=Stage(stage.clone());
            std::fs::create_dir(stage.join("snapback")).map_err(|e| e.to_string())?;
            let source_hash = {
                use sha2::{Digest, Sha256};
                let mut hash = Sha256::new();
                let mut ordered = sources.iter().collect::<Vec<_>>();
                ordered.sort_by(|a,b| a.0.cmp(&b.0));
                for (name,text) in ordered {
                    hash.update((name.len() as u64).to_le_bytes()); hash.update(name.as_bytes());
                    hash.update((text.len() as u64).to_le_bytes()); hash.update(text.as_bytes());
                }
                format!("{:x}", hash.finalize())
            };
            for (name,text) in sources {
                let path=stage.join("snapback").join(name);
                if let Some(parent)=path.parent(){std::fs::create_dir_all(parent).map_err(|e|e.to_string())?;}
                std::fs::write(path,text).map_err(|e|e.to_string())?;
                    .map_err(|e| e.to_string())?;
            }
            std::fs::write(stage.join("device-compatibility.json"), serde_json::to_vec_pretty(&snapback4_core::device_protocol::compatibility(&bound.schema.public_projection())).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
            crate::dev_worker::package_entry(build_project, &stage)?;
            let staged_digest = crate::release_files::executable_digest(&stage)?;
            let mut matching = std::fs::read_dir(&releases).map_err(|e|e.to_string())?
                .filter_map(Result::ok).filter_map(|e| e.file_name().to_str()?.parse::<u64>().ok())
                .filter(|n| !super::rollback_views::is_view(&dir,*n) && selectable(&dir, *n).is_ok())
                .collect::<Vec<_>>();
            matching.sort_unstable_by(|a,b| b.cmp(a));
            let mut matched = None;
            for n in matching {
                if crate::release_files::executable_digest(&releases.join(n.to_string()))? == staged_digest { matched=Some(n); break; }
            }
            let mut n=std::fs::read_dir(&releases).map_err(|e|e.to_string())?.filter_map(Result::ok).filter_map(|e|e.file_name().to_str()?.parse::<u64>().ok()).max().unwrap_or(0);
            let staged_bound=bound_at(stage.clone())?;
            let parent=n.checked_add(1).ok_or("release identity exhausted")?;
            let views=super::rollback_views::prepare(&dir,&stage,&staged_bound,parent)?;
            let register_views=super::rollback_views::needs_registration(&dir,matched,&views)?;
            if let Some(previous)=previous {
                if !register_views && matched==Some(previous) && held["release"].as_u64()==Some(previous) {
                    std::fs::remove_dir_all(&stage).map_err(|e|e.to_string())?;
                    if let Some(saved) = &mut saved_version { saved.finish(previous,&source_hash)?; }
                    if options.json {println!("{}",serde_json::json!({"unchanged":true,"release":previous,"generation":held["generation"],"live":live_identity(&dir,previous)?}));}
                    else {print_live(&live_identity(&dir,previous)?);println!("deploy verdict: UNCHANGED; {}",super::security::release_verdict(security_summary.as_ref()));println!("unchanged; release {previous} stays current as generation {}",held["generation"]);}
                    return Ok(());
                }
            }
            if let Some(n) = matched.filter(|_|!register_views) {
                check_change(&dir,previous,&bound,options,Some(n))?;
                let mut preview_options=options.clone();
                if let Some(summary)=&security_summary {preview_options.flags.insert("security-summary".into(),summary.clone());}
                preview_options.flags.insert("deploy-direction".into(),String::new());
                preview_options.flags.insert("restore-dormant".into(),String::new());
                if !checking { preview_options.flags.insert("validation-only".into(),String::new()); }
                let details=super::release_preview::plan(&dir.join("store.sqlite"),releases.join(n.to_string()),n,&preview_options,_deployment.as_ref())?;
                if checking { return Ok(()); }
                let mut with_details=options.clone();with_details.flags.insert("release-preview".into(),details.to_string());let options=&with_details;
                let selected = bound_at(releases.join(n.to_string()))?;
                activate(&dir,_deployment.as_ref(),n,previous,revision,selected,false,true,options.flags.contains_key("allow-feed-adoption"),options,None)?;
                if let Some(saved)=&mut saved_version {saved.finish(n,&source_hash)?;}
                return Ok(());
            }
            let mut qualified_options=options.clone();
            if let Some(origin)=matched.filter(|_|register_views){qualified_options.flags.insert("source-release".into(),origin.to_string());qualified_options.flags.insert("restore-dormant".into(),String::new());}
            let options=&qualified_options;
            if options.flags.contains_key("check") {
                let mut preview_options=options.clone();
                if let Some(summary)=&security_summary {preview_options.flags.insert("security-summary".into(),summary.clone());}preview_options.flags.insert("deploy-direction".into(),String::new());
                let result=super::release_preview::preview(&dir.join("store.sqlite"),stage.clone(),n.checked_add(1).ok_or("release identity exhausted")?,&preview_options,None);
                let _=std::fs::remove_dir_all(&stage);
                return result;
            }
            let mut validation=options.clone();
            validation.flags.insert("deploy-direction".into(),String::new());
            validation.flags.insert("validation-only".into(),String::new());
pub(super) fn latest(dir:&Path)->Result<u64,String>{
    std::fs::read_dir(dir.join("releases")).map_err(|e|e.to_string())?.filter_map(Result::ok)
        .filter_map(|e|e.file_name().to_str()?.parse::<u64>().ok().filter(|n|!super::rollback_views::is_view(dir,*n)&&selectable(dir,*n).is_ok()))
        .max().ok_or("no complete immutable releases".into())
}
pub(super) fn check_release(options:&Options)->i32 {
    report("check",(|| {
        let store=PathBuf::from(options.flags.get("store").ok_or("--store required")?);
        let dir=store.parent().ok_or("store has no deployment directory")?;
        let selected=options.flags.get("release").ok_or("--release required")?;
        let n=if selected=="latest"{latest(dir)?}else{selected.parse::<u64>().ok().filter(|n|*n>0).ok_or("--release requires N or latest")?};
        selectable(dir,n)?;
        super::release_preview::preview(&store,dir.join("releases").join(n.to_string()),n,options,None)
    })())
}

pub(super) fn selectable(dir:&Path,release:u64)->Result<(),String> {
    let root=dir.join("releases").join(release.to_string());
    if let Some(view)=super::rollback_views::metadata(&root)? {super::rollback_views::verify(dir,&view)?;return bound_at(root).map(|_|());}
    let store=snapback4_core::store_port::AnyStore::open_read_only(&dir.join("store.sqlite")).map_err(|e|e.to_string())?;
    let history:bool=store.has_release_history()?;
    if history || root.join(".pending-adoption").exists() {
        let committed=if history {store.release_adopted(i64::try_from(release).map_err(|_|"release identity exceeds SQLite range")?)?} else {false};
        if !committed {return Err(format!("release {release} did not complete adoption; select a successful release with --to latest"));}
    }
    bound_at(root).map(|_|())
}


codex
I found a freeze bypass: the gate checks direct IR writes, but an old parent delete can implicitly clear a child reference whose current schema freezes that field. I’m also checking the equal-source registration path for a release-selection bypass.
exec
/bin/bash -lc "sed -n '1,245p' snapback4/crates/snapback4/src/verbs/rollback_views.rs; sed -n '525,595p' snapback4/crates/snapback4/src/verbs/releases.rs; sed -n '1,115p' snapback4/crates/snapback4-core/src/schema/references.rs; rg -n 'frozen|immutable|set null' snapback4/crates/snapback4-lang/tests/column_writes.rs snapback4/crates/snapback4-lang/tests/*column* snapback4/crates/snapback4-core/src/schema/references.rs" in /home/ccheever/projects/sb4-b27-rel
 succeeded in 0ms:
//! Immutable default rollback views, authorized by a committed parent deploy.
// @ref LLP 3000.000.000#20-visible-rollback-views-roll — registration shares the deployment's commit boundary.
use super::Project;
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
};
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub(super) struct View {
    pub target: u64,
    pub release: u64,
    pub parent: u64,
    pub digest: String,
    pub changes: Vec<String>,
    pub hides: Vec<String>,
}
pub(super) fn is_view(dir: &Path, n: u64) -> bool {
    dir.join("releases")
        .join(n.to_string())
        .join("rollback-view.json")
        .is_file()
}
pub(super) fn metadata(root: &Path) -> Result<Option<View>, String> {
    match fs::read(root.join("rollback-view.json")) {
        Ok(bytes) => serde_json::from_slice(&bytes)
            .map(Some)
            .map_err(|e| e.to_string()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}
pub(super) fn manifest(root: &Path) -> Result<Vec<View>, String> {
    match fs::read(root.join("rollback-views.json")) {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(|e| e.to_string()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(e) => Err(e.to_string()),
    }
}
pub(super) fn resolve(dir:&Path,target:u64)->Result<Option<View>,String>{
    let store=snapback4_core::store_port::AnyStore::open_read_only(&dir.join("store.sqlite")).map_err(|e|e.to_string())?;
    let Some(active)=store.release_value().map_err(|e|e.to_string())?.map(|s|s.parse::<u64>().map_err(|e|e.to_string())).transpose()?else{return Ok(None)};
    drop(store);
    let root=dir.join("releases").join(active.to_string());
    let context=if let Some(view)=metadata(&root)?{verify(dir,&view)?;view.parent}else{active};
    super::releases::selectable(dir,context)?;
    let view=manifest(&dir.join("releases").join(context.to_string()))?.into_iter().find(|v|v.target==target);
    if let Some(view)=&view{verify(dir,view)?;}Ok(view)
}
pub(super) fn verify(dir: &Path, view: &View) -> Result<(), String> {
    if view.parent == view.release || is_view(dir, view.parent) {
        return Err("invalid rollback view parent".into());
    }
    super::releases::selectable(dir, view.parent)?;
    let parent = dir.join("releases").join(view.parent.to_string());
    if !manifest(&parent)?.iter().any(|v| v == view) {
        return Err("rollback view is not registered by its committed parent".into());
    }
    let root = dir.join("releases").join(view.release.to_string());
    if metadata(&root)?.as_ref()!=Some(view){return Err("rollback view metadata differs from its committed manifest".into())}
    if crate::release_files::executable_digest(&root)? != view.digest {
        return Err("rollback view source digest changed".into());
    }
    Ok(())
}
pub(super) fn prepare(
    dir: &Path,
    stage: &Path,
    bound: &snapback4_lang::Bound,
    parent: u64,
) -> Result<Vec<View>, String> {
    let current = Project { root: stage.into() }
        .sources()
        .map_err(|e| e.to_string())?;
    let mut views = Vec::new();
    let mut id = parent;
    for target in super::releases::ordinary_releases(dir)? {
        let old_root = dir.join("releases").join(target.to_string());
        let old = super::releases::bound_at(old_root.clone())?;
        let original=Project{root:old_root.clone()}.sources().map_err(|e|e.to_string())?;
        let risks = super::rollback_foresight::risks(&bound.schema, &old.schema, target, dir);
        let widening=snapback4_lang::release_bridge::requires_view(&original,&current);
        let defaulting=super::rollback_foresight::missing_defaults(&bound.schema,&old.schema)?;
        if !defaulting.is_empty(){return Err(format!("E_ADOPT: rollback to release {target} would misrepresent a removed defaulted column {}; declare a truthful cross-table down before deploy: {}",defaulting.join(", "),risks.join("; ")))}
        // Quarry text is only part of the authored execution closure. A worker
        // or native-only repair must not restore an older executable behind
        // unchanged intent declarations. Metadata-only registration is excluded
        // by the shared executable digest, keeping equal-source no-ops finite.
        let closure_changed = !bound.invariants.is_empty()
            && snapback4_lang::release_bridge::same_data_and_intent(&original,&current)
            && crate::release_files::executable_digest(&old_root)?
                != crate::release_files::executable_digest(stage)?;
        let visibility_risks=super::rollback_foresight::old_row_risks(&bound.schema,&old.schema,target,dir);
        if !widening && !closure_changed && visibility_risks.is_empty() {
            continue;
        }
        if crate::dev_worker::source(&Project {root:stage.into()}).is_some()
            || !crate::dev_worker::declared(&Project {root:stage.into()})?.is_empty()
            || crate::dev_worker::source(&Project {
            root: old_root.clone(),
        })
        .is_some()
            || !crate::dev_worker::declared(&Project {
                root: old_root.clone(),
            })?
            .is_empty()
        {
            return Err("E_ADOPT: a generated rollback view needs an authored worker bundle; retain a compatible guarded source".into());
        }
        let hides = bound
            .rollback_hides
            .iter()
            .filter(|h| h.release == target)
            .collect::<Vec<_>>();
        let mut source = current.clone();
        // A typed null acknowledgment retains this one old nonnullable domain;
        // all other widened columns still receive the visible bridge union.
        for hide in &hides {
            let old_kind = old
                .schema
                .table(&hide.table)
                .and_then(|t| t.columns.get(&hide.column))
                .ok_or("rollback hides names no predecessor column")?;
            if bound.schema.table_renames.contains_key(&hide.table)
                || bound
                    .schema
                    .asset_renames
                    .get(&hide.table)
                    .is_some_and(|m| m.contains_key(&hide.column))
            {
                return Err("rollback hides requires the same table/column spelling in the original release".into());
            }
            if old_kind.is_optional() {
                return Err("rollback hides requires a nonnullable predecessor column".into());
            }
            for (file, text) in &mut source {
                let doc = snapback4_lang::parse_document(file, text).0;
                if let Some(column) = doc
                    .tables
                    .iter()
                    .find(|t| t.name == hide.table)
                    .and_then(|t| t.columns.iter().find(|c| c.name == hide.column))
                {
                    if let Some((start, end)) =
                        snapback4_lang::release_bridge::type_span(file, text, column)
                    {
                        let scalar = column.type_.required();
                        text.replace_range(
                            start..end,
                            &snapback4_lang::print::scalar_type(&scalar),
                        );
                    }
                }
            }
        }
        let bridge = snapback4_lang::release_bridge::loosen(
            &original,
            &source,
        );
        if !bridge.diagnostics.is_empty() {
            return Err(format!(
                "E_ADOPT: rollback view for release {target} does not compile; retain a truthful guarded old workflow or declare its intentional hiding: {}",
                bridge
                    .diagnostics
                    .iter()
                    .map(ToString::to_string)
                    .collect::<Vec<_>>()
                    .join("; ")
            ));
        }
        let compiled = snapback4_lang::compile(&bridge.sources);
        let mut aliases:std::collections::BTreeMap<String,String> = bound
            .schema
            .table_renames
            .iter()
            .filter(|(_, old)| compiled.schema.tables.contains_key(*old))
            .map(|(new, old)| (new.clone(), old.clone()))
            .collect();
        for(new,prior)in &compiled.schema.table_renames{if bound.schema.tables.contains_key(prior)&&!bound.schema.tables.contains_key(new){aliases.insert(prior.clone(),new.clone());}}
        // @ref LLP 3000.000.000#20-visible-rollback-views-roll — source transport and hard constraints must agree on scalar as well as reference identities.
        let current=snapback4_lang::release_bridge::align_current_schema(
            &compiled.schema,&bridge.sources,&bound.schema,&source,&aliases,
        ).map_err(|e|format!("E_ADOPT: rollback view for release {target} cannot align declared identities: {e}; author a compatible guarded rollback workflow"))?;
        let policies=snapback4_lang::release_bridge::PolicyComparison::new(&compiled.schema,&current);
        for (name, table) in &compiled.schema.tables {
            if let Some(next) = current.table(name) {
                use snapback4_core::schema::Constraint;
                let hard=|c:&Constraint|!matches!(c,Constraint::Text{..}|Constraint::Unique{..}|Constraint::Capabilities(_)|Constraint::Recorded);
                for c in next.constraints.iter().filter(|c|hard(c)) {
                    if !table.constraints.iter().any(|view|policies.constraint(view,c)){return Err(format!("E_ADOPT: rollback view for release {target} cannot preserve current constraint on {name}; author a compatible guarded rollback workflow"))}
                }
                for index in next.indexes.values().filter(|i|i.unique){
                    if !table.indexes.values().any(|i|i.unique&&i.components==index.components){return Err(format!("E_ADOPT: rollback view for release {target} cannot preserve a current unique key on {name}; author a compatible guarded rollback workflow"))}
                }
                if table.expire!=next.expire||table.not_before!=next.not_before||table.through!=next.through||table.on_delete!=next.on_delete||!policies.sync(name,table.sync.as_ref(),next.sync.as_ref())||table.leave!=next.leave {
                    return Err(format!("E_ADOPT: rollback view for release {target} cannot preserve current lifetime or sync audience on {name}; author a compatible guarded rollback workflow"))
                }
                if ![
                    (&table.rules.read, &next.rules.read),
                    (&table.rules.insert, &next.rules.insert),
                    (&table.rules.update, &next.rules.update),
                    (&table.rules.delete, &next.rules.delete),
                ]
                .iter()
                .all(|(view, current)| policies.rule(view,current))
                    || table.columns.keys().any(|c| {
                        !policies.optional_rule(table.column_reads.get(c),next.column_reads.get(c))
                            || table.written_by.get(c) != next.written_by.get(c)
                            || !policies.optional_rule(table.column_writes.get(c),next.column_writes.get(c))
                            || !policies.optional_rule(table.frozen_columns.get(c),next.frozen_columns.get(c))
                    })
                {
                    return Err(format!(
                        "E_ADOPT: rollback view for release {target} cannot preserve current authority on {name}; retain an authored compatible guarded old workflow before deploying this widening"
                    ));
                }
            }
        }
        if compiled.programs.iter().any(|p| p.program.native) {
            return Err("E_ADOPT: a generated rollback view needs an authored native bundle; retain a compatible guarded source".into());
        }
        id = id.checked_add(1).ok_or("release identity exhausted")?;
        let root = stage.join("rollback-views").join(id.to_string());
        fs::create_dir_all(root.join("snapback")).map_err(|e| e.to_string())?;
        for (name, text) in &bridge.sources {
            let path = root.join("snapback").join(name);
            if let Some(parent) = path.parent() {
                fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            fs::write(path, text).map_err(|e| e.to_string())?;
        }
        let mut view = View {
            target,
            release: id,
            parent,
            digest: String::new(),
            changes: bridge.changes,
            hides: hides
                .iter()
                .map(|h| format!("{} where {} = null because {}", h.table, h.column, h.reason))
                .collect(),
        };
        fs::write(
            root.join("device-compatibility.json"),
            serde_json::to_vec_pretty(&snapback4_core::device_protocol::compatibility(
            validation.flags.insert("validation-only".into(),String::new());
            let details=super::release_preview::plan(&dir.join("store.sqlite"),stage.clone(),n.checked_add(1).ok_or("release identity exhausted")?,&validation,_deployment.as_ref())?;
            let mut with_details=options.clone();with_details.flags.insert("release-preview".into(),details.to_string());let options=&with_details;
            if staged_bound.schema != bound.schema { return Err("staged source does not match the compiled schema".into()); }
            n=n.checked_add(1).ok_or("release identity exhausted")?;
            let final_dir=releases.join(n.to_string());
            // @ref LLP 3000.000.000#10-wave-10-release-lifecycle-amendment — only committed adoption makes a candidate selectable.
            std::fs::write(stage.join(".pending-adoption"), b"pending\n").map_err(|e|e.to_string())?;
            if staged_bound.schema != bound.schema {
                return Err("staged source does not match the compiled schema".into());
            }
            // @ref LLP 3000.000.000.000.000#4-cli-surface-contracts — provenance is immutable metadata, excluded from executable identity so identical deploys stay no-ops.
            std::fs::write(stage.join("provenance.json"), format!("{}\n", serde_json::json!({
                "release": n, "sourceHash": source_hash, "cliVersion": env!("CARGO_PKG_VERSION"), "createdAt": snapback4_core::now_ms()
            }))).map_err(|e|e.to_string())?;
            let mut installed_views=super::rollback_views::install(&dir,&stage,n,&views)?;
            crate::release_files::durable(&stage)?;
            std::fs::rename(&stage, &final_dir).map_err(|e| e.to_string())?;
            let mut candidate=crate::release_files::Candidate::new(&dir,n);
            std::fs::File::open(&releases)
                .and_then(|f| f.sync_all())
                .map_err(|e| e.to_string())?;
            let result=activate(
                &dir,
                _deployment.as_ref(),
                n,
                previous,
                revision,
                staged_bound,
                false,
                options.flags.contains_key("restore-dormant"),
                options.flags.contains_key("allow-feed-adoption"),
                options,
                Some(&mut candidate),
            );
            installed_views.pending=candidate.pending;
            match result {
                Ok(()) => {
                    candidate.committed=true;
                    if let Err(error)=std::fs::remove_file(final_dir.join(".pending-adoption")) {eprintln!("release {n} committed; pending-marker cleanup failed: {error}; history proves adoption");}
                    if let Some(saved) = &mut saved_version {saved.finish(n,&source_hash).map_err(|e|format!("release {n} committed, but saving its snapshot failed: {e}; retry unchanged deploy with --save-version"))?;}
                }
                Err(error) => {
                    if options.json && error.contains("dormant names") {
                        let mut inventory=Vec::new();let mut cursor=None;
                        loop {
                            let page=status(&dir,_deployment.as_ref(),0,cursor,None)?;
                            let items=page["items"].as_array().ok_or("invalid dormant inventory response")?;
                            if items.is_empty() {break;}
                            inventory.extend(items.iter().cloned());
                            cursor=items.last().and_then(|i|i["key"].as_str()).map(str::to_owned);
                            if cursor.is_none() {break;}
                        }
                        failure_inventory=Some(inventory);
                    }
                    return Err(error);
                }
            }
            Ok(())
        })();
    if !options.json {
        if let Err(error)=&result {eprintln!("deploy: {error}");eprintln!("deploy verdict: REFUSED; {}",super::security::release_verdict(security_summary.as_ref()));}
        super::security::print_release(security_summary.as_ref());
        eprintln!("deploy verdict: {}; {}",if result.is_ok(){"READY / completed"}else{"REFUSED"},super::security::release_verdict(security_summary.as_ref()));
    }
    if options.json {if let Err(error)=&result {println!("{}",serde_json::json!({"ok":false,"message":error,"dormant":failure_inventory,"compilation":failure_problems,"security":security_summary.as_ref().and_then(|s|serde_json::from_str::<serde_json::Value>(s).ok())}));}}
    report("deploy",result)
}

pub fn rollback(options: &Options) -> i32 {
    report(
//! Referential actions: what deleting a referenced row does to the rows that
//! name it (`on delete restrict | cascade | set null`).
// @ref LLP 3000.039#2 — every reference between ordinary durable tables carries one action; restrict is the default.
use super::*;
pub use reservations::Price;

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum OnDelete {
    Restrict,
    Cascade,
    SetNull,
    /// The referencing row stays and names a deleted row (the pre-0.5 meaning),
    /// declared on purpose: history, audit trails, contributions that outlive
    /// their target.
    Keep,
}

impl OnDelete {
    pub fn words(self) -> &'static str {
        match self { Self::Restrict => "on delete restrict", Self::Cascade => "on delete cascade", Self::SetNull => "on delete set null", Self::Keep => "on delete keep" }
    }
    /// The actions that write the children, bounded by a cap on the reference.
    pub fn writes(self) -> bool { matches!(self, Self::Cascade | Self::SetNull) }
    /// The actions a delete must consult (every one but `keep`).
    pub fn acts(self) -> bool { self != Self::Keep }
}

/// One action-carrying reference `child.column -> parent`.
#[derive(Clone, Copy, Debug)]
pub struct Referencing<'a> {
    pub child: &'a str,
    pub table: &'a Table,
    pub column: &'a str,
    pub action: OnDelete,
}

/// The prefix of the reference index a live child of `parent` is found under.
pub const REFERENCE_INDEX_PREFIX: &str = "$reference:";
pub fn reference_index_name(column: &str) -> String { format!("{REFERENCE_INDEX_PREFIX}{column}") }

/// Heap a closure keeps per reached row: its table and id (an id is at most
/// 144 canonical bytes) and the set and queue entries holding them.
pub const CLOSURE_IDENTITY_BYTES: u64 = 384;
/// Child rows a cascade or set-null walk reads per seek (LLP 3000.039 §5.1).
pub const REFERENCE_PAGE: usize = 4;

impl Schema {
    /// Whether rows of `name` take part in referential actions, as child or
    /// parent: an ordinary durable application table. Ephemeral rows, engine
    /// derivations and receipt/timeline bookkeeping keep their own lifetimes.
    pub fn actionable(&self, name: &str) -> bool {
        let Some(table) = self.table(name) else { return false };
        table.ephemeral.is_none() && self.maintain_for(name).is_none() && self.private_owner(name).is_none()
            && !self.is_recount_work(name) && !self.timelines.iter().any(|t| t.owns(name))
            && !self.receipts.iter().any(|f| [&f.scope, &f.members, &f.runs].iter().any(|t| t.as_str() == name))
    }

    /// Every reference into `parent` a delete consults (all but `keep`), in
    /// (child, column) order.
    pub fn referencing<'a>(&'a self, parent: &str) -> Vec<Referencing<'a>> {
        // A plain loop into a vector: iterator adapters monomorphize per call site on the web device.
        let mut out = Vec::new();
        for (child, table) in &self.tables {
            for (column, action) in &table.on_delete {
                if action.acts() && matches!(table.columns.get(column).map(ColumnType::required), Some(ColumnType::Ref { table: target }) if target == parent) {
                    out.push(Referencing { child, table, column, action: *action });
                }
            }
        }
        out
    }

    /// A delete of a `parent` row consults its referencing rows, so it needs
    /// read authority on that row (LLP 3000.039 §3 step 1).
    pub fn is_referenced(&self, parent: &str) -> bool { !self.referencing(parent).is_empty() }

    /// The index a reference is probed through: its column first, then the
    /// child's deadline column when the child can expire, so one seek skips an
    /// expired backlog. A `read through` reference uses its child index.
    pub fn reference_index(&self, child: &str, column: &str) -> Option<&str> {
        let table = self.table(child)?;
        if table.through.as_ref().is_some_and(|t| t.reference == column) {
            return table.indexes.contains_key(through::CHILDREN).then_some(through::CHILDREN);
        }
        // The effective deadline: a read-through child's `$deadline`, else `expire at`.
        let deadline = table.expiry_column();
        table.indexes.iter().find(|(_, index)| {
            let columns = index.columns();
            index.is_plain() && columns.first().map(String::as_str) == Some(column)
                && deadline.is_none_or(|deadline| columns.get(1).map(String::as_str) == Some(deadline))
        }).map(|(name, _)| name.as_str())
    }

    /// The cap bounding a reference's children: `cap N by <column>` exactly,
    /// or one when the reference itself is a plain unique key. A nullable
    /// reference may have many nulls, but a parent delete probes one non-null
    /// parent id, whose unique group still has at most one row.
    pub fn reference_cap(&self, child: &str, column: &str) -> Option<u32> {
        let table = self.table(child)?;
        let declared = table.constraints.iter().find_map(|c| match c {
            Constraint::Cap { by, max } if by.len() == 1 && by[0] == column => Some(*max),
            _ => None,
        });
        let unique = table.indexes.values().any(|index| index.unique && index.is_plain() && index.columns() == [column]).then_some(1);
        declared.into_iter().chain(unique).min()
    }

    /// Whether `cap` on `table` skips a group whose reference is null: only a
    /// `set null` reference's own cap does (a null reference has no parent).
    pub fn cap_skips_null(&self, table: &Table, by: &[String], group: &[Value]) -> bool {
        by.iter().zip(group).any(|(column, value)| *value == Value::Null && table.on_delete.get(column) == Some(&OnDelete::SetNull))
    }

    /// The tables a delete of a `parent` row may write through its writing
snapback4/crates/snapback4-core/src/schema/references.rs:2://! name it (`on delete restrict | cascade | set null`).
snapback4/crates/snapback4-core/src/schema/references.rs:21:        match self { Self::Restrict => "on delete restrict", Self::Cascade => "on delete cascade", Self::SetNull => "on delete set null", Self::Keep => "on delete keep" }
snapback4/crates/snapback4-core/src/schema/references.rs:110:    /// `set null` reference's own cap does (a null reference has no parent).
snapback4/crates/snapback4-core/src/schema/references.rs:424:// @ref LLP 3000.039#2.2 — set null never changes any rule's verdict, moves a row between audiences, or rewrites a fact resolved through the reference.
snapback4/crates/snapback4-core/src/schema/references.rs:435:    else if table.through.as_ref().is_some_and(|t| t.reference == column) { Some("a read-through reference is required and immutable".into()) }
snapback4/crates/snapback4-core/src/schema/references.rs:436:    else if table.immutable_fields().any(|f| f == column) { Some("the column is immutable".into()) }
snapback4/crates/snapback4-core/src/schema/references.rs:499:                OnDelete::SetNull => if let Some(reason) = set_null_refusal(schema, name, table, column) { fail(format!("on delete set null on {name}.{column}: {reason}")); },
snapback4/crates/snapback4-lang/tests/column_writes.rs:11:  immutable cell when .approved = true
snapback4/crates/snapback4-lang/tests/column_writes.rs:113:    let source="table groups:\n  read <- allow\n  insert <- allow\n  online only\ntable entries:\n  parent: groups\n  ordinal: sequence by parent\n  payload: text write <- .ordinal != 1\n  immutable parent\n  read <- allow\n  insert <- allow\n  online only\nmutation add(parent: groups):\n  return insert entries {parent,payload:'value'}\nmutation absent(parent: groups):\n  return insert entries {parent,payload:'value'} if absent\nmutation put(id: entries,parent: groups):\n  return upsert entries[id] {parent,payload:'value'}\n";
snapback4/crates/snapback4-lang/tests/column_writes.rs:115:        let source=if inherited{source.replace("  immutable parent\n  read <- allow","  immutable parent\n  read through .parent")}else{source.to_owned()};
snapback4/crates/snapback4-lang/tests/column_writes.rs:123:fn omitted_optional_null_is_equal_during_frozen_import(){
snapback4/crates/snapback4-lang/tests/column_writes.rs:145: let source="table tours:\n  status: enum('booked','on_trail')\n  read <- allow\n  insert <- allow\n  update <- allow\n  online only\ntable bookings:\n  tour: tours\n  weight: int\n  immutable tour\n  immutable weight when .tour.status != 'booked'\n  read <- allow\n  insert <- allow\n  update <- allow\n  online only\nmutation depart(tour: tours):\n  update tours[tour] {status:'on_trail'}\nmutation edit(booking: bookings,weight: int):\n  update bookings[booking] {weight}\n";
snapback4/crates/snapback4-lang/tests/column_writes.rs:156: let source="table roles:\n  principal: principal\n  role: enum('desk','manager','family','tech')\n  unique principal\n  immutable principal, role\n  read <- allow\n  online only\ntable docs:\n  cell: text ? write <- exists roles[viewer,role = 'desk']\n  read <- allow\n  insert <- allow\n  update <- allow\n  online only\nmutation add(cell: text ?):\n  return insert docs {cell}\nmutation absent(cell: text ?):\n  return insert docs {cell} if absent\nmutation put(id: docs,cell: text ?):\n  return upsert docs[id] {cell}\nmutation edit(id: docs,cell: text ?):\n  return update docs[id] {cell}\n";
snapback4/crates/snapback4-lang/tests/maintained_columns.rs:122:    for line in ["  read <- .likeCount = 0","  immutable likeCount","  unique byCount: likeCount","  cap 1 by likeCount","  sync public last 2 by byLikes"] {
snapback4/crates/snapback4-lang/tests/maintained_columns.rs:439:fn moving_key_cursor_is_a_key_boundary_not_a_frozen_ranking() {
snapback4/crates/snapback4-lang/tests/maintained_columns.rs:511:    let source=MODEL.replacen("  at: time","  parentId: posts ?\n  immutable parentId\n  at: time",1)
snapback4/crates/snapback4-lang/tests/maintained_columns.rs:513:        .replace("  active: bool","  immutable postId\n  active: bool").replace("{ postId, active, amount }", "{ active, amount }");
snapback4/crates/snapback4-lang/tests/column_reads.rs:313:    let source = "table parents:\n  owner: principal\n  immutable owner\n  read <- .owner = viewer\n  online only\ntable children:\n  parent: parents\n  body: text <= 80\n  immutable parent\n  read through .parent\n  online only\nquery child(id: children):\n  return children[id]\n";
snapback4/crates/snapback4-lang/tests/column_reads.rs:584:    let source="table parents:\n  owner: principal\n  immutable owner\n  read <- .owner = viewer\n  insert <- allow\n  online only\ntable children:\n  parent: parents\n  body: text <=80 read <- allow\n  entries: count childEntries by child\n  immutable parent\n  read through .parent\n  insert <- allow\n  online only\ntable childEntries:\n  child: children\n  public 'shared entries'\n  online only\nmutation add():\n  insert parents { id: 'p', owner: viewer }\n  return insert children { parent: 'p', body: 'authorized' }\nmutation maybe():\n  return insert children { id: 'fixed', parent: 'p', body: 'authorized' } if absent\n";
snapback4/crates/snapback4-lang/tests/column_reads.rs:719:fn protected_immutable_patches_never_test_guesses_and_keep_the_stored_cell() {
snapback4/crates/snapback4-lang/tests/column_reads.rs:720:    let source = format!("{}\nmutation guess(id: records, secret: text <=500):\n  return update records[id] {{ secret }}\nmutation put(id: records, secret: text <=500):\n  return upsert records[id] {{ owner: 'alice', title: 'shared', secret }}\n", SOURCE.replace("  online only", "  immutable secret\n  online only"));
snapback4/crates/snapback4-lang/tests/column_reads.rs:739:fn protected_immutable_asset_guesses_never_change_placement_or_test_ownership() {
snapback4/crates/snapback4-lang/tests/column_reads.rs:740:    let source="table docs:\n  owner: principal\n  document: file <=1000 ('application/pdf') read <- .owner = viewer\n  immutable document\n  read <- allow\n  insert <- allow\n  update <- allow\n  online only\nmutation add(document: file <=1000 ('application/pdf')):\n  return insert docs {owner:viewer,document}\nmutation patch(id: docs, document: file <=1000 ('application/pdf')):\n  return update docs[id] {document}\n";
snapback4/crates/snapback4-lang/tests/column_writes.rs:11:  immutable cell when .approved = true
snapback4/crates/snapback4-lang/tests/column_writes.rs:113:    let source="table groups:\n  read <- allow\n  insert <- allow\n  online only\ntable entries:\n  parent: groups\n  ordinal: sequence by parent\n  payload: text write <- .ordinal != 1\n  immutable parent\n  read <- allow\n  insert <- allow\n  online only\nmutation add(parent: groups):\n  return insert entries {parent,payload:'value'}\nmutation absent(parent: groups):\n  return insert entries {parent,payload:'value'} if absent\nmutation put(id: entries,parent: groups):\n  return upsert entries[id] {parent,payload:'value'}\n";
snapback4/crates/snapback4-lang/tests/column_writes.rs:115:        let source=if inherited{source.replace("  immutable parent\n  read <- allow","  immutable parent\n  read through .parent")}else{source.to_owned()};
snapback4/crates/snapback4-lang/tests/column_writes.rs:123:fn omitted_optional_null_is_equal_during_frozen_import(){
snapback4/crates/snapback4-lang/tests/column_writes.rs:145: let source="table tours:\n  status: enum('booked','on_trail')\n  read <- allow\n  insert <- allow\n  update <- allow\n  online only\ntable bookings:\n  tour: tours\n  weight: int\n  immutable tour\n  immutable weight when .tour.status != 'booked'\n  read <- allow\n  insert <- allow\n  update <- allow\n  online only\nmutation depart(tour: tours):\n  update tours[tour] {status:'on_trail'}\nmutation edit(booking: bookings,weight: int):\n  update bookings[booking] {weight}\n";
snapback4/crates/snapback4-lang/tests/column_writes.rs:156: let source="table roles:\n  principal: principal\n  role: enum('desk','manager','family','tech')\n  unique principal\n  immutable principal, role\n  read <- allow\n  online only\ntable docs:\n  cell: text ? write <- exists roles[viewer,role = 'desk']\n  read <- allow\n  insert <- allow\n  update <- allow\n  online only\nmutation add(cell: text ?):\n  return insert docs {cell}\nmutation absent(cell: text ?):\n  return insert docs {cell} if absent\nmutation put(id: docs,cell: text ?):\n  return upsert docs[id] {cell}\nmutation edit(id: docs,cell: text ?):\n  return update docs[id] {cell}\n";

exec
/bin/bash -lc "sed -n '285,335p' snapback4/crates/snapback4/src/verbs/rollback_views.rs; sed -n '424,450p' snapback4/crates/snapback4-core/src/schema/references.rs; sed -n '115,155p' snapback4/crates/snapback4-core/src/schema/references.rs; rg -n 'fn old_row_risks' snapback4/crates/snapback4/src/verbs/rollback_foresight.rs; sed -n '1,105p' snapback4/crates/snapback4/src/verbs/rollback_foresight.rs; nl -ba snapback4/crates/snapback4/src/verbs/releases.rs | sed -n '480,527p'" in /home/ccheever/projects/sb4-b27-rel
 succeeded in 0ms:
    views: &[View],
) -> Result<Installed, String> {
    let mut installed = Installed {
        dir: dir.into(),
        parent,
        ids: Vec::new(),
        pending: false,
    };
    for v in views {
        let from = stage.join("rollback-views").join(v.release.to_string());
        crate::release_files::durable(&from)?;
        fs::rename(&from, dir.join("releases").join(v.release.to_string()))
            .map_err(|e| e.to_string())?;
        installed.ids.push(v.release);
    }
    if stage.join("rollback-views").exists() {
        fs::remove_dir(stage.join("rollback-views")).map_err(|e| e.to_string())?;
    }
    Ok(installed)
}

pub(super) fn needs_registration(dir:&Path,matched:Option<u64>,prepared:&[View])->Result<bool,String>{
    let held=matched.map(|n|manifest(&dir.join("releases").join(n.to_string()))).transpose()?.unwrap_or_default();
    for view in &held{verify(dir,view)?;}
    Ok(held.len()!=prepared.len()||prepared.iter().any(|v|!held.iter().any(|old|old.target==v.target&&old.digest==v.digest&&old.hides==v.hides)))
}

/// Compile production rollback views on check's read-only store selection.
pub(super) fn check(project:&Project,sources:&[(String,String)],bound:&snapback4_lang::Bound,store:Option<&String>)->Result<Vec<snapback4_lang::diag::Diagnostic>,String>{
    if let Some(store)=store {
        let path=Path::new(store);let dir=path.parent().unwrap_or(Path::new("."));
        if dir.join("releases").is_dir() {
            struct Stage(PathBuf);impl Stage {fn path(&self)->&Path{&self.0}}impl Drop for Stage {fn drop(&mut self){let _=fs::remove_dir_all(&self.0);}}
            let stage=Stage(std::env::temp_dir().join(format!("snapback4-check-views-{}",std::process::id())));
            fs::create_dir(&stage.0).map_err(|e|e.to_string())?;
            fs::create_dir(stage.path().join("snapback")).map_err(|e|e.to_string())?;
            for(name,text)in sources {let path=stage.path().join("snapback").join(name);fs::create_dir_all(path.parent().unwrap()).map_err(|e|e.to_string())?;fs::write(path,text).map_err(|e|e.to_string())?;}
            let parent=fs::read_dir(dir.join("releases")).map_err(|e|e.to_string())?.filter_map(Result::ok).filter_map(|e|e.file_name().to_str()?.parse::<u64>().ok()).max().unwrap_or(0).checked_add(1).ok_or("release identity exhausted")?;
            prepare(dir,stage.path(),bound,parent)?;
            return Ok(Vec::new());
        }
    }
    let config=project.root.join("snapback/client-compatibility.json");
    if !config.is_file(){return Ok(Vec::new());}
    let config:serde_json::Value=serde_json::from_slice(&fs::read(config).map_err(|e|e.to_string())?).map_err(|e|e.to_string())?;
    let Some(baseline)=config["baseline"].as_str()else{return Ok(Vec::new())};
    let prior=crate::client_compatibility::sources(&project.root.join(baseline)).map_err(|e|e.to_string())?;
    if snapback4_lang::release_bridge::requires_view(&prior,sources) {return Ok(snapback4_lang::release_bridge::loosen(&prior,sources).diagnostics);}
    Ok(Vec::new())
}
// @ref LLP 3000.039#2.2 — set null never changes any rule's verdict, moves a row between audiences, or rewrites a fact resolved through the reference.
pub fn set_null_refusal(schema: &Schema, name: &str, table: &Table, column: &str) -> Option<String> {
    let audience = table.sync.as_ref().is_some_and(|sync| std::iter::once((&sync.audience, sync.horizon.as_ref()))
        .chain(sync.also.iter().map(|arm| (&arm.audience, arm.horizon.as_ref())))
        .any(|(audience, horizon)| match audience {
        Audience::Public => false,
        Audience::Column(c) => c == column,
        Audience::Target { prefix, .. } => prefix.iter().any(|c| c == column),
    } || horizon.is_some_and(|h| table.index(&h.by).is_some_and(|i| i.uses_column(column)))));
    let maintained = schema.maintains.iter().any(|m| m.source == name && m.by.iter().any(|by| by.trim_start_matches('.').starts_with(&format!("{column}."))));
    if !table.columns.get(column).is_some_and(ColumnType::is_optional) { Some("the reference is required; declare it optional (`?`) or choose cascade".into()) }
    else if table.through.as_ref().is_some_and(|t| t.reference == column) { Some("a read-through reference is required and immutable".into()) }
    else if table.immutable_fields().any(|f| f == column) { Some("the column is immutable".into()) }
    else if table.written_by.contains_key(column) { Some("the column is written by its field owner".into()) }
    else if table.sequences.values().any(|p| p == column) { Some("a sequence counts within it".into()) }
    else if table.recorded.values().any(|r| r.reference == column) || maintained { Some("a recorded or maintained path resolves through it".into()) }
    else if carries_authority(schema, name, column) { Some("a rule reads it, so clearing it would change that rule's verdict; a reference that carries authority chooses cascade, restrict or keep".into()) }
    else if audience { Some("the sync audience or horizon uses it, so clearing it would move the row between partitions".into()) }
    else if table.constraints.iter().any(|c| matches!(c, Constraint::Cap { by, .. } if by.iter().any(|b| b == column) && by.len() != 1)) { Some(format!("a cap groups by it with other columns; its only cap is `cap N by {column}`")) }
    else { None }
}

/// Why rows of `name` cannot be deleted or cleared by another row's delete.
pub fn write_target_refusal(schema: &Schema, name: &str) -> Option<String> {
    let table = schema.table(name)?;
    if table.constraints.iter().any(|c| matches!(c, Constraint::AppendOnly)) { Some(format!("{name} is append only")) }
    else if !table.written_by.is_empty() { Some(format!("{name} has field-owned (`written by`) columns, whose owners the schema singled out")) }
    /// The tables a delete of a `parent` row may write through its writing
    /// actions, and the tables its actions read. A function of the schema, so
    /// a commit's touched set never says which of them a delete reached.
    pub fn action_tables(&self, parent: &str) -> ActionTables {
        let mut out = ActionTables::default();
        let mut queue = vec![parent.to_owned()];
        let mut visited = BTreeSet::new();
        while let Some(table) = queue.pop() {
            if !visited.insert(table.clone()) { continue; }
            for r in self.referencing(&table) {
                out.read.insert(r.child.to_owned());
                if r.action.writes() { out.written.insert(r.child.to_owned()); }
                if r.action == OnDelete::Cascade { queue.push(r.child.to_owned()); }
            }
        }
        // What a write of each of those tables writes in turn: the derived
        // destinations `row_changed` names (aggregate targets, maintained-column
        // owners, row-keyed views).
        let derived: Vec<String> = self.maintains.iter().filter(|m| out.written.contains(&m.source) || m.row_key.as_ref().is_some_and(|k| out.written.contains(&k.table)))
            .flat_map(|m| [Some(m.target.clone()), m.private.as_ref().map(|owner| owner.table.clone())]).flatten().collect();
        out.written.extend(derived);
        out.written.retain(|name| self.visible(name));
        // Private derivations disappear from the device's projection; their
        // event envelope is exported with each direct source's write price.
        let sources: Vec<String> = out.written.iter().cloned().collect();
        for source in sources {
            if let Some(events) = self.write_reservation(&source).and_then(|plan| plan.action_events) { out.written.extend(events.tables); }
        }
        out
    }

    /// The order a delete's closure is removed in: a row before any table it
    /// must not outlive — its cascade parent, and its `read through` parent.
    /// A cycle through those edges has no valid order and is refused.
    pub fn deletion_precedes(&self, child: &str, parent: &str) -> bool {
        self.table(child).is_some_and(|t| t.through.as_ref().is_some_and(|through| through.parent == parent))
            || self.referencing(parent).into_iter().any(|r| r.child == child && r.action == OnDelete::Cascade)
    }

    /// A table that reaches itself through cascade and `read through` edges.
    pub fn deletion_cycle(&self) -> Option<String> {
23:pub(super) fn old_row_risks(candidate:&Schema,old:&Schema,release:u64,dir:&Path)->Vec<String>{
//! @ref LLP 3000.000.000#16-release-reactivation-and-rollback-foresight-rel5 — future-write risks are distinct from snapshot validation.
use snapback4_core::{Schema, successor::{self, Change}, schema::ColumnDefault};
use std::path::Path;

pub(super) fn missing_defaults(candidate:&Schema,old:&Schema)->Result<Vec<String>,String>{
    let names=candidate.table_renames.iter().filter(|(new,prior)|old.table(prior).is_some()&&old.table(new).is_none()).map(|(new,prior)|(prior.clone(),new.clone())).collect();
    let old=old.with_table_names(&names).map_err(|e|e.to_string())?;
    let mut missing=Vec::new();
    for(name,target)in old.visible_tables().filter(|(_,t)|t.ephemeral.is_none()){
        let Some(from)=candidate.table(name)else{continue};if old.maintain_for(name).is_some(){continue}
        for(column,kind)in &target.columns {
            let renamed=candidate.asset_renames.get(name).is_some_and(|map|map.iter().any(|(new,prior)|prior==column&&from.columns.contains_key(new)));
            if !target.engine_field(column)&&!snapback4_core::schema::timeline::is_slot(column)&&!target.maintained.contains_key(column)&&matches!(target.defaults.get(column),Some(ColumnDefault::Literal(_)))&&!from.columns.contains_key(column)&&!renamed&&!projected(candidate,name,column,kind){missing.push(format!("{name}.{column}"));}
        }
    }Ok(missing)
}

pub(super) fn risks(candidate: &Schema, old: &Schema, release: u64, dir: &Path) -> Vec<String> {
    risks_for(candidate,old,release,dir,true,true)
}
// Timeline event slots are compiler-owned delivery metadata, not authored old
// cells. Retiring a rebuildable feed must not manufacture a visibility view.
pub(super) fn old_row_risks(candidate:&Schema,old:&Schema,release:u64,dir:&Path)->Vec<String>{
    risks_for(candidate,old,release,dir,false,false)
}
fn risks_for(candidate:&Schema,old:&Schema,release:u64,dir:&Path,include_new_tables:bool,include_constraints:bool)->Vec<String>{
    let names:std::collections::BTreeMap<_,_>=candidate.table_renames.iter().filter(|(new,prior)|old.table(prior).is_some() && old.table(new).is_none()).map(|(new,prior)|(prior.clone(),new.clone())).collect();
    if names.is_empty(){return risks_aligned(candidate,old,release,dir,include_new_tables,include_constraints)}
    let aligned=match old.with_table_names(&names){Ok(schema)=>schema,Err(error)=>return vec![format!("rollback foresight cannot compare renamed identities: {error}; run exact rollback --check")]};
    risks_aligned(candidate,&aligned,release,dir,include_new_tables,include_constraints).into_iter().map(|line|{
        let (mut facts,command)=line.split_once("; run `").map_or((line.clone(),String::new()),|(facts,command)|(facts.to_owned(),format!("; run `{command}")));
        for (prior,new) in &names {facts=facts.replace(&format!(", {new}."),&format!(", {prior} (current {new}).")).replace(&format!("table {new}:"),&format!("table {prior} (current {new}):")).replace(&format!("unique index {new}."),&format!("unique index {prior} (current {new})."));}
        facts+&command
    }).collect()
}
fn risks_aligned(candidate:&Schema,old:&Schema,release:u64,dir:&Path,include_new_tables:bool,include_constraints:bool)->Vec<String>{
    let mut risks:Vec<_>=successor::classify(candidate,old).into_iter().filter_map(|step| {
        let path=step.path.strip_prefix("tables.")?;
        let (table,column)=path.split_once(".columns.")?;
        let target=old.tables.get(table)?;
        if target.engine_field(column) || snapback4_core::schema::timeline::is_slot(column) || old.maintain_for(table).is_some() || target.maintained.contains_key(column) {return None;}
        let before=target.columns.get(column)?;
        if projected(candidate,table,column,before) {return None;}

        let from=candidate.tables.get(table)?;
        let source_kind=from.columns.get(column).or_else(||candidate.asset_renames.get(table)?.iter().find(|(_,old)|old.as_str()==column).and_then(|(new,_)|from.columns.get(new)));
        let reason=match source_kind {
            None if !before.is_optional() && !matches!(target.defaults.get(column),Some(ColumnDefault::Literal(_))) =>
                "without a fitting reverse projection, new rows will lack the old required field, so rollback can refuse".to_owned(),
            Some(kind) if kind!=before && matches!(step.change,Change::Narrowing|Change::Destructive) =>
                format!("new writes allowed by {kind} may not fit {before}, so rollback can hide rows; {}", remedy(before)),
            _ => return None,
        };
        Some(format!("rollback foresight: release {release}, {table}.{column}: {reason}; keep an expand/contract bridge with the old required fields and compatible domains; run `snapback4 rollback {} --to {release} --check --bridge <new-dir>` after writes",dir.display()))
    }).collect();
    // @ref LLP 3000.000.000#19-dormant-visibility-and-migration-dorm — warn before new writes, including harmless newer-only facts and empty legacy cells.
    for (name, _) in candidate.visible_tables().filter(|(name,t)|t.ephemeral.is_none() && candidate.maintain_for(name).is_none()) {
        if include_new_tables && old.table(name).is_none() && !candidate.table_renames.get(name).is_some_and(|source|old.table(source).is_some()) {
            risks.push(format!("rollback foresight: rows written to new table {name} will be hidden while release {release} is live; release {release} has no such table, so these are newer-only facts, not lost old-table records; a same-table `down` cannot create this missing table; keep it in a loosened bridge or declare a table rename; run `snapback4 rollback {} --to {release} --check --bridge <new-dir>` after writes",dir.display()));
        }
    }
    for (name,target) in old.visible_tables().filter(|(_,t)|t.ephemeral.is_none()) {
        let Some(from)=candidate.tables.get(name) else {continue;};
        if old.maintain_for(name).is_some() {continue;}
        for (column,kind) in &target.columns {
            if projected(candidate,name,column,kind) || from.columns.contains_key(column) || target.engine_field(column) || snapback4_core::schema::timeline::is_slot(column) || target.maintained.contains_key(column) {continue;}
            let interpretation=if kind.is_optional() {"null".to_owned()} else if let Some(ColumnDefault::Literal(value))=target.defaults.get(column) {format!("the old default {}",snapback4_core::wire::to_json(value))} else {continue;};
            let suggestions=cross_table_suggestions(candidate,old,name,column,kind,target.defaults.get(column));
            risks.push(format!("rollback foresight: release {release}, {name}.{column}: without a fitting reverse projection, records created while this field is absent have no retained old cell and will show {interpretation} to release {release} users; declare a reverse projection from the replacement value, or retain the field in a bridge release; {suggestions}run `snapback4 rollback {} --to {release} --check --bridge <new-dir>` after writes",dir.display()));
        }
        // Registration compares constraint domains structurally in
        // release_bridge::requires_view (including renamed fields). General
        // foresight advice also explains constraint changes, but is not a
        // second, less precise admission predicate.
        if include_constraints {
        for (index,definition) in &target.indexes {
            if definition.unique && from.indexes.get(index)!=Some(definition) {
                risks.push(format!("rollback foresight: release {release}, unique index {name}.{index}: future writes may introduce duplicate keys and refuse restoration; keep the old uniqueness in a bridge; run `snapback4 rollback {} --to {release} --check --bridge <new-dir>` after writes",dir.display()));
            }
        }
        if target.constraints.iter().any(|constraint| {
            if from.constraints.contains(constraint){return false;}
            match constraint {
                snapback4_core::schema::Constraint::Text{field,..}=>!target.columns.get(field).is_some_and(|kind|projected(candidate,name,field,kind)),
                snapback4_core::schema::Constraint::Cap{by,max}=>!from.constraints.iter().any(|c|matches!(c,snapback4_core::schema::Constraint::Cap{by:next_by,max:next_max}if next_by==by&&next_max<=max)),
                snapback4_core::schema::Constraint::FinalExistsOnInsert{..}=>true,
                _=>false,
            }
        }) {
            risks.push(format!("rollback foresight: release {release}, table {name}: changed constraints may let future writes refuse rollback; preserve old bounds/quotas in a bridge; run `snapback4 rollback {} --to {release} --check --bridge <new-dir>` after writes",dir.display()));
        }
        }
    }
    risks
}

fn projected(candidate:&Schema,table:&str,column:&str,kind:&snapback4_core::schema::ColumnType)->bool {
    candidate.extractions.iter().any(|e|e.parent==table&&e.fields.values().any(|c|c==column)) || (scalar(kind) && candidate.downfills.iter().any(|f|f.table==table && f.outputs.contains(column))) || candidate.asset_renames.get(table).is_some_and(|map|map.iter().any(|(new,old)|old==column && candidate.tables.get(table).and_then(|t|t.columns.get(new))==Some(kind)))
}
fn scalar(kind:&snapback4_core::schema::ColumnType)->bool {
    use snapback4_core::schema::ColumnType::*;
    match kind {Optional(k)=>scalar(k),Image{..}|Video{..}|File{..}|List{..}|ListRange{..}|Ref{..}=>false,_=>true}
}
fn remedy(kind:&snapback4_core::schema::ColumnType)->&'static str {
    if scalar(kind) {"declare a truthful scalar `down`, or generate a loosened bridge"}
   480	            let mut matched = None;
   481	            for n in matching {
   482	                if crate::release_files::executable_digest(&releases.join(n.to_string()))? == staged_digest { matched=Some(n); break; }
   483	            }
   484	            let mut n=std::fs::read_dir(&releases).map_err(|e|e.to_string())?.filter_map(Result::ok).filter_map(|e|e.file_name().to_str()?.parse::<u64>().ok()).max().unwrap_or(0);
   485	            let staged_bound=bound_at(stage.clone())?;
   486	            let parent=n.checked_add(1).ok_or("release identity exhausted")?;
   487	            let views=super::rollback_views::prepare(&dir,&stage,&staged_bound,parent)?;
   488	            let register_views=super::rollback_views::needs_registration(&dir,matched,&views)?;
   489	            if let Some(previous)=previous {
   490	                if !register_views && matched==Some(previous) && held["release"].as_u64()==Some(previous) {
   491	                    std::fs::remove_dir_all(&stage).map_err(|e|e.to_string())?;
   492	                    if let Some(saved) = &mut saved_version { saved.finish(previous,&source_hash)?; }
   493	                    if options.json {println!("{}",serde_json::json!({"unchanged":true,"release":previous,"generation":held["generation"],"live":live_identity(&dir,previous)?}));}
   494	                    else {print_live(&live_identity(&dir,previous)?);println!("deploy verdict: UNCHANGED; {}",super::security::release_verdict(security_summary.as_ref()));println!("unchanged; release {previous} stays current as generation {}",held["generation"]);}
   495	                    return Ok(());
   496	                }
   497	            }
   498	            if let Some(n) = matched.filter(|_|!register_views) {
   499	                check_change(&dir,previous,&bound,options,Some(n))?;
   500	                let mut preview_options=options.clone();
   501	                if let Some(summary)=&security_summary {preview_options.flags.insert("security-summary".into(),summary.clone());}
   502	                preview_options.flags.insert("deploy-direction".into(),String::new());
   503	                preview_options.flags.insert("restore-dormant".into(),String::new());
   504	                if !checking { preview_options.flags.insert("validation-only".into(),String::new()); }
   505	                let details=super::release_preview::plan(&dir.join("store.sqlite"),releases.join(n.to_string()),n,&preview_options,_deployment.as_ref())?;
   506	                if checking { return Ok(()); }
   507	                let mut with_details=options.clone();with_details.flags.insert("release-preview".into(),details.to_string());let options=&with_details;
   508	                let selected = bound_at(releases.join(n.to_string()))?;
   509	                activate(&dir,_deployment.as_ref(),n,previous,revision,selected,false,true,options.flags.contains_key("allow-feed-adoption"),options,None)?;
   510	                if let Some(saved)=&mut saved_version {saved.finish(n,&source_hash)?;}
   511	                return Ok(());
   512	            }
   513	            let mut qualified_options=options.clone();
   514	            if let Some(origin)=matched.filter(|_|register_views){qualified_options.flags.insert("source-release".into(),origin.to_string());qualified_options.flags.insert("restore-dormant".into(),String::new());}
   515	            let options=&qualified_options;
   516	            if options.flags.contains_key("check") {
   517	                let mut preview_options=options.clone();
   518	                if let Some(summary)=&security_summary {preview_options.flags.insert("security-summary".into(),summary.clone());}preview_options.flags.insert("deploy-direction".into(),String::new());
   519	                let result=super::release_preview::preview(&dir.join("store.sqlite"),stage.clone(),n.checked_add(1).ok_or("release identity exhausted")?,&preview_options,None);
   520	                let _=std::fs::remove_dir_all(&stage);
   521	                return result;
   522	            }
   523	            let mut validation=options.clone();
   524	            validation.flags.insert("deploy-direction".into(),String::new());
   525	            validation.flags.insert("validation-only".into(),String::new());
   526	            let details=super::release_preview::plan(&dir.join("store.sqlite"),stage.clone(),n.checked_add(1).ok_or("release identity exhausted")?,&validation,_deployment.as_ref())?;
   527	            let mut with_details=options.clone();with_details.flags.insert("release-preview".into(),details.to_string());let options=&with_details;

exec
/bin/bash -lc "sed -n '200,285p' snapback4/crates/snapback4-lang/src/release_bridge.rs; sed -n '22,34p' snapback4/crates/snapback4/src/verbs/rollback_foresight.rs; sed -n '1,150p' snapback4/crates/snapback4-lang/src/release_bridge_rules.rs; sed -n '107,139p' snapback4/crates/snapback4-lang/src/release_bridge_current.rs; rg -n 'column_writes|frozen|column.write' snapback4/crates/snapback4-lang/src/release_bridge_rules.rs snapback4/crates/snapback4-lang/src/release_bridge_current.rs; rg -n 'source-release' snapback4/crates/snapback4/src/verbs/release* snapback4/crates/snapback4-core/src/store/*.rs" in /home/ccheever/projects/sb4-b27-rel
 succeeded in 0ms:
    if !additions.is_empty() {let mut name="rollback-retained.q".to_owned();while sources.iter().any(|(f,_)|f==&name){name.insert_str(0,"retained-");}sources.push((name,additions));}
    let transported=super::release_bridge_rules::carry(&mut sources,current,&mut changes,&std::collections::BTreeSet::new());
    affected.extend(transported);
    let (mut diagnostics,fallback)=super::release_bridge_guards::carry(&mut sources,current,&affected,&mut changes);
    if !fallback.is_empty(){
        super::release_bridge_rules::carry(&mut sources,current,&mut changes,&fallback);
        (diagnostics,_)=super::release_bridge_guards::carry(&mut sources,current,&affected,&mut changes);
    }
    let current_bound=crate::compile(current);
    if current_bound.diagnostics.is_empty()&&crate::compile(target).diagnostics.is_empty() {
        super::release_bridge_indexes::prune_unused_equivalent_keys(&mut sources,current,&mut changes);
    }
    let bound=crate::compile(&sources);
    if bound.schema.auth!=current_bound.schema.auth
        || super::release_bridge_guards::current_context_needed(&sources,current,&bound.schema,&current_bound.schema) {
        diagnostics.push(crate::diag::type_error(&crate::Site::default(),"rollback guards need the current ordered execution and schema context","retain the complete current guarded workflow, including authentication and guard-dependent reads").guide("deploy"));
    }
    for(file,text)in target {
        let old=parser::parse_document(file,text).0;
        let Some((_,next))=current.iter().find(|(f,_)|operation_name(f,"")==operation_name(file,""))else{continue};
        let next=parser::parse_document(file,next).0;
        for(name,prior,site)in &old.aliases {
            let qualified=operation_name(file,name);
            let retained=current_bound.programs.iter().any(|p|p.program.name==qualified);
            if retained&&!next.aliases.iter().any(|(alias,target,_)|alias==name&&target==prior) {
                diagnostics.push(crate::diag::type_error(site,format!("rollback export {qualified} needs its current definition or alias target"),"retain the complete current guarded endpoint and dependency closure").guide("deploy"));
            }
        }
    }

    for previous in &crate::compile(target).programs {
        if let Some(current)=current_bound.programs.iter().find(|p|p.program.name==previous.program.name) {
            let mut positions=std::collections::BTreeSet::new();
            let collapsed=previous.program.args.iter().any(|(name,_)| {
                let spellings=std::iter::once(name.as_str()).chain(previous.program.arg_aliases.iter().filter(|(_,owner)|*owner==name).map(|(alias,_)|alias.as_str()));
                let resolved=spellings.filter_map(|name|current.program.argument(name).map(|(canonical,_)|canonical)).collect::<std::collections::BTreeSet<_>>();
                resolved.len()>1||resolved.iter().any(|position|!positions.insert(*position))
            });
            if collapsed {
                diagnostics.push(crate::diag::type_error(&crate::Site::default(),format!("rollback export {} cannot merge or rebind old wire input positions behind current guards",previous.program.name),"author a compatible current guarded endpoint with distinct old argument positions").guide("deploy"));
            }
        }
    }
    let current_authority=match align_current_schema(&bound.schema,&sources,&current_bound.schema,current,&aliases) {
        Ok(schema)=>Some(schema),
        Err(error)=>{diagnostics.push(crate::diag::type_error(&crate::Site::default(),format!("rollback current authority cannot align declared table/column identities: {error}"),"author a compatible guarded identity mapping").guide("deploy"));None},
    };
    for(name,table)in &bound.schema.tables {
        let Some((_,_,next))=new.get(name)else{continue};
        let Some(current_table)=current_bound.schema.table(&next.name)else{continue};
        if current_authority.as_ref().is_some_and(|schema|schema.table(name).is_some_and(|authority| {
            let policies=PolicyComparison::new(&bound.schema,schema);
            table.column_reads.len()!=authority.column_reads.len()
                ||table.column_reads.iter().any(|(column,rule)|!policies.optional_rule(Some(rule),authority.column_reads.get(column)))
                ||table.written_by!=authority.written_by
                ||table.column_writes!=authority.column_writes
                ||table.frozen_columns!=authority.frozen_columns
        })) {
            diagnostics.push(crate::diag::type_error(&next.site,format!("rollback view needs current field authority on {name}"),"retain the complete current guarded workflow and its column read/write authority").guide("deploy"));
        }
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
// cells. Retiring a rebuildable feed must not manufacture a visibility view.
pub(super) fn old_row_risks(candidate:&Schema,old:&Schema,release:u64,dir:&Path)->Vec<String>{
    risks_for(candidate,old,release,dir,false,false)
}
fn risks_for(candidate:&Schema,old:&Schema,release:u64,dir:&Path,include_new_tables:bool,include_constraints:bool)->Vec<String>{
    let names:std::collections::BTreeMap<_,_>=candidate.table_renames.iter().filter(|(new,prior)|old.table(prior).is_some() && old.table(new).is_none()).map(|(new,prior)|(prior.clone(),new.clone())).collect();
    if names.is_empty(){return risks_aligned(candidate,old,release,dir,include_new_tables,include_constraints)}
    let aligned=match old.with_table_names(&names){Ok(schema)=>schema,Err(error)=>return vec![format!("rollback foresight cannot compare renamed identities: {error}; run exact rollback --check")]};
    risks_aligned(candidate,&aligned,release,dir,include_new_tables,include_constraints).into_iter().map(|line|{
        let (mut facts,command)=line.split_once("; run `").map_or((line.clone(),String::new()),|(facts,command)|(facts.to_owned(),format!("; run `{command}")));
        for (prior,new) in &names {facts=facts.replace(&format!(", {new}."),&format!(", {prior} (current {new}).")).replace(&format!("table {new}:"),&format!("table {prior} (current {new}):")).replace(&format!("unique index {new}."),&format!("unique index {prior} (current {new})."));}
        facts+&command
    }).collect()
//! Intersect authored authority and reuse an authored old endpoint when a
//! deliberately relaxed unique key invalidates its former point lookup.
// @ref LLP 3000.000.000#20-visible-rollback-views-roll — no invented row choice or broader audience.
use crate::{
    ast,
    lexer::{self, Kind},
    parser, print,
};
use std::collections::{BTreeMap, BTreeSet};
fn offset(text: &str, line: u32, col: u32) -> usize {
    let start=text.split_inclusive('\n').take(line.saturating_sub(1) as usize).map(str::len).sum::<usize>();
    start+text[start..].chars().take(col.saturating_sub(1) as usize).map(char::len_utf8).sum::<usize>()
}
fn line_span(file: &str, text: &str, site: &crate::Site) -> Option<(usize, usize)> {
    let (tokens, _) = lexer::lex(file, text);
    let at = tokens.iter().position(|t| t.site == *site)?;
    let end = tokens[at..].iter().find(|t| t.kind == Kind::Newline)?;
    Some((
        offset(text, site.line, 1),
        offset(text, end.site.line, end.site.col),
    ))
}
fn declaration(text: &str, line: u32) -> (usize, usize, String) {
    let start = offset(text, line, 1);
    let mut end = text.len();
    for (next, s) in text.lines().enumerate().skip(line as usize) {
        if !s.trim().is_empty() && !s.starts_with(char::is_whitespace) && !s.starts_with("--") {
            end = offset(text, next as u32 + 1, 1);
            break;
        }
    }
    (start, end, text[start..end].to_owned())
}
pub(super) fn carry(
    sources: &mut [(String, String)],
    current: &[(String, String)],
    changes: &mut Vec<String>,
    forced_programs: &BTreeSet<String>,
) -> BTreeSet<String> {
    let docs = current
        .iter()
        .map(|(f, t)| (f, t, parser::parse_document(f, t).0))
        .collect::<Vec<_>>();
    let mut aliases = BTreeMap::new();
    let mut tables = BTreeMap::new();
    let mut programs = BTreeMap::new();
    for (file, text, doc) in &docs {
        for table in &doc.tables {
            tables.insert(table.name.clone(), table);
            if let Some(old) = &table.renamed_from {
                aliases.insert(table.name.clone(), old.clone());
                tables.insert(old.clone(), table);
            }
        }
        for p in &doc.programs {
            programs.insert(super::release_bridge::operation_name(file,&p.name), (*file, *text, p));
        }
        for(name,target,_)in &doc.aliases {if let Some(p)=doc.programs.iter().find(|p|p.name==*target){programs.insert(super::release_bridge::operation_name(file,name),(*file,*text,p));}}
    }
    for(file,text)in sources.iter(){for old in parser::parse_document(file,text).0.tables{if let Some(prior)=&old.renamed_from{if !tables.contains_key(&old.name){if let Some(next)=tables.get(prior).copied(){tables.insert(old.name.clone(),next);aliases.insert(prior.clone(),old.name.clone());}}}}}
    let before_schema=crate::compile(sources).schema;
    let current_schema=crate::compile(current).schema.with_table_names(&aliases).ok();
    let remap = |expr: &ast::Expr| {
        let mut expr = expr.clone();
        crate::bind::intent_walk::expression(&mut expr, &mut |e| {
            if let ast::Expr::Read(r)
            | ast::Expr::Exists { read: r, .. }
            | ast::Expr::Created { read: r, .. } = e
            {
                if let Some(old) = aliases.get(&r.table) {
                    r.table = old.clone();
                }
            }
        });
        expr
    };
    let mut relaxed = BTreeSet::new();
    let mut expanded = BTreeSet::new();
    for (file, text) in sources {
        let doc = parser::parse_document(file, text).0;
        let mut edits = Vec::new();
        for old in &doc.tables {
            let Some(next) = tables.get(&old.name) else {
                continue;
            };
            let current_text=docs.iter().find(|(_,_,d)|d.tables.iter().any(|t|t.name==next.name)).map(|(_,text,_)|*text).unwrap();
            let authored_read=|rule:&ast::RuleDecl|->Option<String>{
                if rule.effect!=ast::Effect::Read{return None}
                let(a,b)=line_span(&rule.site.file,current_text,&rule.site)?;let raw=&current_text[a..b];
                raw.trim_start().starts_with("read through ").then(||raw.to_owned())
            };
            // Replacement and insertion must use the same set: strengthening
            // a named ordering to unique cannot leave two declarations behind.
            let columns=super::release_bridge_indexes::column_names(old,next);
            let same_key=|before:&ast::IndexDecl,after:&ast::IndexDecl| {
                let Some(columns)=&columns else{return false};
                current_schema.as_ref().is_some_and(|schema|
                    super::release_bridge_indexes::same_key(&before_schema,schema,&old.name,before,after,columns))
            };
            let carried_indexes=next.indexes.iter().filter(|i|
                !old.indexes.iter().any(|o|o.name==i.name)
                || old.indexes.iter().any(|o|o.name==i.name&&o.unique!=i.unique)
                || (i.unique&&!old.indexes.iter().any(|o|o.unique&&same_key(o,i)))
                || old.indexes.iter().any(|o|o.name==i.name&&o.unique&&!next.indexes.iter().any(|n|n.unique&&same_key(o,n))))
                .collect::<Vec<_>>();
            for index in &old.indexes {
                let loses_unique=index.unique&&!next.indexes.iter().any(|n|n.unique&&same_key(index,n));
                if !loses_unique&&!carried_indexes.iter().any(|n|n.name==index.name){continue}
                if let Some((start, end)) = line_span(file, text, &index.site) {
                    edits.push((start, end, String::new()));
                    if loses_unique {
                        relaxed.insert(old.name.clone());
                        changes.push(format!("{}: current source permits multiple rows for {}; current authored endpoint supplies the old-client selection",old.name,index.columns.join(", ")));
                    }
                }
            }
            for column in &next.columns {
                if let Some(prior)=old
                    .columns
                    .iter()
                    .find(|c| c.name == column.name || column.renamed_from.as_ref() == Some(&c.name)||c.renamed_from.as_ref()==Some(&column.name))
                {
                    if let Some(edit)=current_default(file,text,prior,column){
                        edits.push(edit);
                        changes.push(format!("{}.{}: retained current authored default",old.name,prior.name));
                    }
                    continue;
                }
                let Some((_, current_text, _)) = docs
                    .iter()
                    .find(|(_, _, d)| d.tables.iter().any(|t| t.name == next.name))
                else {
                    continue;
                };
                if let Some((a, b)) = line_span(&column.site.file, current_text, &column.site) {
                    let at = declaration(text, old.site.line).1;
                    edits.push((at, at, format!("{}\n", &current_text[a..b])));
                    expanded.insert(old.name.clone());
                    changes.push(format!(
                        "{}.{}: retained current guard/input field",
                        old.name, column.name
                    ));
                }
            }
            if next.public.is_none(){if let Some((_,site))=&old.public {if let Some((a,b))=line_span(file,text,site){edits.push((a,b,String::new()));}}}
            if old.public.is_none(){if let Some((_,site))=&next.public {if let Some((a,b))=line_span(&site.file,current_text,site){let at=declaration(text,old.site.line).1;edits.push((at,at,format!("{}\n",&current_text[a..b])));}}}
            for current in &next.rules {
                if old.rules.iter().any(|r| r.effect == current.effect) {
                    continue;
                }
                let target=doc.aliases.iter().find(|(name,_,_)|super::release_bridge::operation_name(file,name)==*qualified).map(|(_,target,_)|target).or_else(||restored.get(qualified))?;
                doc.programs.iter().find(|p|p.name==*target)
            });
            let Some(endpoint)=endpoint else{continue};
            let actual=super::release_bridge::operation_name(file,&endpoint.name);
            let Some(current)=next.programs.iter().find(|p|p.program.name==*qualified||p.program.name==actual)else{continue};
            for(alias,owner)in &previous.program.arg_aliases {
                if current.program.argument(alias).is_some(){continue;}
                let Some((canonical,_))=current.program.argument(owner)else{continue};
                let Some(arg)=endpoint.args.iter().find(|arg|arg.name==canonical&&arg.alias.is_none())else{continue};
                if let Ok((_,end))=arg_type(text,&tokens,arg){edits.push((end,end,format!(" alias {alias}")));changes.push(format!("operation {qualified}: retained wire alias {alias} on {canonical}"));}
            }
        }
        edits.sort();edits.dedup();edits.sort_by_key(|edit|std::cmp::Reverse(edit.0));
        for(start,end,value)in edits{text.replace_range(start..end,&value);}
        if !extra.is_empty(){if !text.ends_with('\n'){text.push('\n');}text.push_str(&extra);}
    }
    // A view can pause an incompatible write; it cannot guess a required
    // choice or silently consume a removed data-bearing argument.
    let available=crate::compile(&sources);
    let delete_roots=destructive_delete_roots(&old,&available);
    let mut paused=BTreeSet::new();
    for (file,text) in &mut sources {
        let doc=parser::parse_document(file,text).0;
        let mut edits=Vec::new();
        for endpoint in &doc.programs {
            let actual=super::release_bridge::operation_name(file,&endpoint.name);
            let exports=std::iter::once(actual.clone()).chain(doc.aliases.iter().filter(|(_,target,_)|target==&endpoint.name).map(|(name,_,_)|super::release_bridge::operation_name(file,name))).collect::<Vec<_>>();
            let incompatible=old.programs.iter().filter(|p|exports.contains(&p.program.name)).find(|p|available.programs.iter().find(|n|n.program.name==actual).is_some_and(|n|!endpoint_contract(&p.program,&n.program)||snapback4_core::ir::write_tables(&n.program).iter().any(|(table,effect)|*effect=="delete"&&delete_roots.contains(table))));
            if let Some(previous)=incompatible {
                if matches!(previous.program.kind,snapback4_core::ir::ProgramKind::Query){continue;}
                paused.extend(exports);
                let (a,b)=declaration(text,endpoint.site.line);edits.push((a,b));
snapback4/crates/snapback4-lang/src/release_bridge_current.rs:412:            for value in [&mut column.read, &mut column.write, &mut column.default]
snapback4/crates/snapback4/src/verbs/release_preview.rs:234:    let payload=serde_json::json!({"sourceRelease":options.flags.get("source-release").and_then(|s|s.parse::<u64>().ok()),"preview":true,"security":options.flags.get("security-summary").and_then(|s|serde_json::from_str::<serde_json::Value>(s).ok()),"visibility":visibility,"rollbackVisibility":rollback_visibility,"rollbackViews":rollback_views,"rollbackViewEffects":view_effects,"rollbackView":options.flags.get("rollback-view").and_then(|s|serde_json::from_str::<serde_json::Value>(s).ok()),"clientCompatibility":client_compatibility,"checklist":checklist,"hazards":hazards,"notes":notes,"current":held,"plan":planned,"steps":steps,"estimate":estimate,"phases":engine.store().adoption_report().summary(),"backfills":engine.store().adoption_report().backfills});
snapback4/crates/snapback4/src/verbs/releases.rs:358:        if let Some(origin)=options.flags.get("source-release").and_then(|v|v.parse::<u64>().ok()){result["sourceRelease"]=origin.into();}
snapback4/crates/snapback4/src/verbs/releases.rs:363:            if let Some(origin)=options.flags.get("source-release"){println!("  retained source {origin} requalified as release {release} to register its current rollback views");}
snapback4/crates/snapback4/src/verbs/releases.rs:514:            if let Some(origin)=matched.filter(|_|register_views){qualified_options.flags.insert("source-release".into(),origin.to_string());qualified_options.flags.insert("restore-dormant".into(),String::new());}
snapback4/crates/snapback4/src/verbs/releases.rs:967:    if options.json {println!("{}",serde_json::json!({"live":live,"sourceRelease":options.flags.get("source-release").and_then(|s|s.parse::<u64>().ok()),"release":release,"generation":generation,"adoption":report.compact(),"details":report.summary(),"backfills":report.backfills,"security":options.flags.get("security-summary").and_then(|s|serde_json::from_str::<serde_json::Value>(s).ok()),"rollbackView":options.flags.get("rollback-view").and_then(|s|serde_json::from_str::<serde_json::Value>(s).ok()),"preview":options.flags.get("release-preview").and_then(|s|serde_json::from_str::<serde_json::Value>(s).ok())}));}
snapback4/crates/snapback4/src/verbs/releases.rs:968:    else {print_live(live);println!("release {release} is current as generation {generation}; {}",report.compact());if let Some(origin)=options.flags.get("source-release"){println!("  retained source {origin} requalified as release {release} to register its current rollback views");}for fill in &report.backfills {println!("  backfill: {fill}");}if options.flags.contains_key("verbose"){println!("{}",report.summary());}}

exec
/bin/bash -lc "sed -n '1,90p' snapback4/crates/snapback4-lang/src/release_bridge_current.rs; sed -n '430,500p' snapback4/crates/snapback4-lang/src/release_bridge_current.rs; sed -n '1,95p' snapback4/crates/snapback4-lang/src/release_bridge_guards.rs; rg -n 'sourceRelease|exact_write_authority|check_change' snapback4/crates/snapback4/src/verbs/release_preview.rs; rg -n 'frozen_columns|column_writes' snapback4/crates/snapback4-core/src/store/rollback_guard_population.rs; nl -ba snapback4/crates/snapback4-core/src/engine/write_references.rs | sed -n '237,249p'; nl -ba snapback4/crates/snapback4-core/src/schema/column_writes.rs | sed -n '17,26p'" in /home/ccheever/projects/sb4-b27-rel
 succeeded in 0ms:
//! Independent policy follows the complete authored current execution closure.
// @ref LLP 3000.000.000#20-visible-rollback-views-roll — no restored workflow may bypass current independent intent.
use crate::{
    ast::{self, TypeKind},
    lexer::{self, Kind},
    parser, print,
    release_bridge::Bridge,
};
use snapback4_core::ir::ArgType;
use std::collections::{BTreeMap, BTreeSet};

type Source = (String, String);

pub(super) fn prepare(target: &[Source], current: &[Source], guarded_fallback: &mut bool) -> Bridge {
    *guarded_fallback=false;
    let old = crate::compile(target);
    let next = crate::compile(current);
    if !old.diagnostics.is_empty() {
        return Bridge {
            sources: target.to_vec(),
            changes: vec![],
            diagnostics: old.diagnostics,
        };
    }
    if !next.diagnostics.is_empty() {
        return Bridge {
            sources: current.to_vec(),
            changes: vec![],
            diagnostics: next.diagnostics,
        };
    }
    if contracts(&old, &next) {
        if !destructive_delete_roots(&old,&next).is_empty(){*guarded_fallback=true;return guarded(target,current);}
        return retained(current.to_vec(), false);
    }
    match alpha(target, current) {
        Ok(Some(sources)) => {
            let bound = crate::compile(&sources);
            if !bound.diagnostics.is_empty() {
                return Bridge {
                    sources,
                    changes: vec![],
                    diagnostics: bound.diagnostics,
                };
            }
            if contracts(&old, &bound) {
                if !destructive_delete_roots(&old,&bound).is_empty(){*guarded_fallback=true;return guarded(target,current);}
                return retained(sources, true);
            }
        }
        Err(error) => {*guarded_fallback=error.unsupported;return refused(current, &error.reason)},
        Ok(None) => {}
    }
    *guarded_fallback=true;
    refused(current,"the complete current workflow does not retain every predecessor table, field, operation and accepted input")
}
fn retained(sources: Vec<Source>, alpha: bool) -> Bridge {
    Bridge {sources,diagnostics:vec![],changes:vec![format!("current independent intent: retained the complete current authored schema, defaults, programs, helpers, jobs and policy declarations{}; predecessor names and accepted inputs remain available; review current results in the old UI",if alpha {" under declared table identity renames"}else{""})]}
}
fn refused(current: &[Source], reason: &str) -> Bridge {
    let docs=current.iter().map(|(file,text)|parser::parse_document(file,text).0).collect::<Vec<_>>();
    let site=docs.iter().flat_map(|d|&d.tables).find_map(|t|t.columns.iter().find(|c|reason.contains(&format!("{}.{}",t.name,c.name))).map(|c|c.site.clone()))
        .or_else(||docs.iter().flat_map(|d|&d.tables).find(|t|reason.contains(&format!("{}.",t.name))).map(|t|t.site.clone()))
        .or_else(||docs.iter().flat_map(|d|&d.programs).find(|p|reason.contains(&p.name)).map(|p|p.site.clone()))
        .or_else(||docs.iter().flat_map(|d|&d.tables).next().map(|t|t.site.clone()))
        .unwrap_or_else(||crate::Site::new("schema.q",1,1));
    Bridge {sources:current.to_vec(),changes:vec![],diagnostics:vec![crate::diag::type_error(&site,format!("rollback view cannot preserve current independent intent: {reason}"),"author a compatible guarded source retaining the predecessor fields and inputs, truthful migrations and the current policy; an acknowledgment does not authorize restoring an unsafe workflow").guide("deploy")]}
}

/// A loosened current workflow may omit a predecessor's nullable, default-free
/// field rather than invent its value. All current schema and executable
/// declarations stay intact; old wire aliases are the only source additions.
pub(super) fn guarded(target:&[Source],current:&[Source])->Bridge {
    let normalized=match alpha(target,current) {
        Ok(sources)=>sources,
        Err(error)=>return refused(current,&error.reason),
    };
    let current=normalized.as_deref().unwrap_or(current);
    let old=crate::compile(target);let next=crate::compile(current);
    if !old.diagnostics.is_empty()||!next.diagnostics.is_empty(){return refused(current,"both authored sources must compile before preparing a guarded view");}
    if !table_contracts(&old,&next,true){
        let missing=old.schema.tables.iter().flat_map(|(table,t)|{let old=&old;let next=&next;t.columns.iter().filter_map(move |(column,kind)|{
            let absent=next.schema.table(table).is_none_or(|n|!n.columns.contains_key(column));
            (absent&&renamed_column(&old,&next,table,column).is_none()&&(!kind.is_optional()||t.defaults.contains_key(column))).then(||format!("{table}.{column}"))
        })}).collect::<Vec<_>>();
        return refused(current,&format!("guarded view needs a truthful reverse projection for required/defaulted columns [{}]; retain these fields in an authored bridge",missing.join(", ")));
    }
    let mut sources=current.to_vec();let mut changes=vec!["guarded loosened view: retained the complete current schema, defaults, helpers, programs, jobs, aliases and independent intent; omitted nullable default-free predecessor fields are absent results, never invented values; review current results in the old UI".into()];
    if normalized.is_some(){changes.push("declared table identities: complete current guarded workflow retained under predecessor spellings, without rewriting business strings or weakening authority".into());}
    for(file,text)in &mut sources {
        || !doc.effects.is_empty()
        || !doc.maintains.is_empty()
        || !doc.timelines.is_empty()
        || !doc.views.is_empty()
        || !doc.feed_views.is_empty()
        || !doc.backfills.is_empty()
        || !doc.downfills.is_empty()
        || !doc.extractions.is_empty()
        || doc.programs.iter().any(|p| p.delivery.is_some())
        || doc
            .tables
            .iter()
            .any(|t| t.receipts.is_some() || t.columns.iter().any(|c| c.maintained.is_some()))
    {
        return Err(MappingError{reason:"this table identity mapping includes a derived, receipt or migration declaration outside the closed current-source adapter".into(),unsupported:true});
    }
    let (tokens, _) = lexer::lex(file, text);
    let mut edits = Vec::<(usize, usize, String)>::new();
    for table in &doc.tables {
        let mut source = super::release_bridge::retained_declaration(file, text, table, &names)?;
        if let Some(name) = names.get(&table.name) {
            let prior = old
                .tables
                .iter()
                .find(|t| &t.name == name)
                .ok_or("missing predecessor identity")?;
            source = header(
                file,
                &source,
                &table.name,
                name,
                prior.renamed_from.as_deref(),
            )?;
        }
        let (a, b) = declaration(text, table.site.line);
        edits.push((a, b, source));
    }
    for inv in &doc.invariants {
        let table = names.get(&inv.table).unwrap_or(&inv.table);
        let mut value = inv.value.clone();
        crate::bind::intent_walk::expression(&mut value, &mut |e| match e {
            ast::Expr::Read(r)
            | ast::Expr::Exists { read: r, .. }
            | ast::Expr::Created { read: r, .. } => {
                if let Some(name) = names.get(&r.table) {
                    r.table = name.clone()
                }
            }
            ast::Expr::Write { table, .. } => {
                if let Some(name) = names.get(table) {
                    *table = name.clone()
                }
            }
            _ => (),
        });
        let target = if let Some(column) = &inv.column {
            format!("{table}.{column} {} only", inv.target)
        } else if inv.target == "always" {
            format!("{table} always")
        } else {
            format!("{table}.{} only", inv.target)
        };
        let (a, b) = declaration(text, inv.site.line);
        edits.push((
            a,
            b,
            format!("invariant {target} {}\n", print::expression(&value)),
        ));
    }
    fn loop_domains(body:&[ast::Stmt],bound:&mut BTreeSet<String>,names:&BTreeMap<String,String>,text:&str,edits:&mut Vec<(usize,usize,String)>){
        for stmt in body {match stmt {
//! Carry authored guards; never invent a value for a newly optional field.
// @ref LLP 3000.000.000#20-visible-rollback-views-roll — compilation gates automatic registration.
use crate::{ast::Stmt, parser, print};
use std::collections::BTreeSet;

// Guard meaning depends on statement order and named definitions, not merely
// the last textual binding. Compare declared row identities, then select
// current execution when that guarded context cannot be transported intact.
// Field/table authority is validated separately before choosing a strategy.
pub(super) fn current_context_needed(
    sources:&[(String,String)],current:&[(String,String)],
    view_schema:&snapback4_core::Schema,current_schema:&snapback4_core::Schema,
)->bool {
    let view_docs=sources.iter().map(|(f,t)|parser::parse_document(f,t).0).collect::<Vec<_>>();
    let mut next_docs=current.iter().map(|(f,t)|parser::parse_document(f,t).0).collect::<Vec<_>>();
    let mut names=current_schema.table_renames.iter().filter(|(_,old)|view_schema.tables.contains_key(*old)).map(|(new,old)|(new.clone(),old.clone())).collect::<std::collections::BTreeMap<_,_>>();
    for(name,prior)in &view_schema.table_renames {
        if current_schema.tables.contains_key(prior)&&!current_schema.tables.contains_key(name){names.insert(prior.clone(),name.clone());}
    }
    for doc in &mut next_docs{normalize_identities(doc,&names);}
    if super::release_bridge_indexes::current_context_needed(&view_docs,&next_docs,view_schema,current_schema,&names){return true;}
    let exports=|docs:&[crate::ast::Document]| {
        let mut out=std::collections::BTreeMap::new();
        for doc in docs {
            for p in &doc.programs{out.insert(super::release_bridge::operation_name(&doc.file,&p.name),p.clone());}
            for(name,target,_)in &doc.aliases{if let Some(p)=doc.programs.iter().find(|p|p.name==*target){out.insert(super::release_bridge::operation_name(&doc.file,name),p.clone());}}
        }out
    };
    let shapes=|docs:&[crate::ast::Document]| {
        let mut out=std::collections::BTreeMap::new();
        for doc in docs {
            for shape in &doc.shapes {
                let fields=shape.fields.iter().map(|field|match field {
                    crate::ast::ShapeField::Spread{..}=>"...".into(),
                    crate::ast::ShapeField::NamedSpread{name,..}=>format!("...{name}"),
                    crate::ast::ShapeField::Bare{name,..}=>name.clone(),
                    crate::ast::ShapeField::Field{name,value,..}=>format!("{name}:{}",expression_signature(value)),
                }).collect::<Vec<_>>();
                out.insert(shape.name.clone(),fields);
            }
        }out
    };
    let shapes_changed=shapes(&view_docs)!=shapes(&next_docs);
    let view=exports(&view_docs);let next=exports(&next_docs);
    for(name,p)in next {
        let Some(old)=view.get(&name)else{continue};
        let mut sensitive=p.prelude.iter().chain(&p.body).any(|s|matches!(s,Stmt::Require{..}|Stmt::If{..}|Stmt::For{..}|Stmt::As{..}));
        let mut doc=crate::ast::Document::default();doc.programs.push(p.clone());
        crate::bind::intent_walk::document(&mut doc,&mut |expr|{
            sensitive|=matches!(expr,crate::ast::Expr::Read(_)|crate::ast::Expr::Exists{..}|crate::ast::Expr::Created{..}|crate::ast::Expr::Walk{..}|crate::ast::Expr::Merge(_)|crate::ast::Expr::If{..}|crate::ast::Expr::Assert{..}|crate::ast::Expr::Call{..}|crate::ast::Expr::Write{condition:Some(_),..});
        });
        let body=|p:&crate::ast::ProgramDecl|p.prelude.iter().chain(&p.body).map(normalized_statement).collect::<Vec<_>>();
        if sensitive&&(body(old)!=body(&p)||shapes_changed){return true;}
    }
    false
}

// Only typed row-reference slots change spelling. Literal values, member names,
// helper identities and business strings retain their authored meaning.
fn normalize_identities(doc:&mut crate::ast::Document,names:&std::collections::BTreeMap<String,String>) {
    fn kind(ty:&mut crate::ast::ScalarType,names:&std::collections::BTreeMap<String,String>){
        match &mut ty.kind {
            crate::ast::TypeKind::Ref{table}=>if let Some(old)=names.get(table){*table=old.clone();},
            crate::ast::TypeKind::List{item,..}=>kind(item,names),
            _=>(),
        }
    }
    for p in &mut doc.programs{for a in &mut p.args{kind(&mut a.type_,names);}}
    for f in &mut doc.functions{for a in &mut f.args{kind(&mut a.type_,names);}}
    let table=|name:&mut String|{if let Some(old)=names.get(name){*name=old.clone();}};
    crate::bind::intent_walk::document(doc,&mut |expr|match expr {
        crate::ast::Expr::Read(r)|crate::ast::Expr::Exists{read:r,..}|crate::ast::Expr::Created{read:r,..}=>table(&mut r.table),
        crate::ast::Expr::Write{table:name,..}|crate::ast::Expr::Walk{table:name,..}=>table(name),
        crate::ast::Expr::Merge(m)=>{table(&mut m.table);for lane in &mut m.lanes{if let Some(name)=&mut lane.table{table(name);}if let Some(r)=&mut lane.planned{table(&mut r.table);}if let Some((_,r))=&mut lane.nulls{table(&mut r.table);}}},
        _=>(),
    });
}

pub(super) fn carry(
    sources: &mut [(String, String)],
    current: &[(String, String)],
    _affected: &BTreeSet<String>,
    changes: &mut Vec<String>,
) -> (Vec<crate::Diagnostic>,BTreeSet<String>) {
    let mut diagnostics = Vec::new();
    let mut fallback=BTreeSet::new();
    let mut current_documents = current
        .iter()
        .map(|(file, text)| parser::parse_document(file, text).0)
        .collect::<Vec<_>>();
    let target_documents = sources
        .iter()
        .map(|(file, text)| parser::parse_document(file, text).0)
        .collect::<Vec<_>>();
    let target_tables=target_documents.iter().flat_map(|d|&d.tables).map(|t|t.name.clone()).collect::<BTreeSet<_>>();
234:    let payload=serde_json::json!({"sourceRelease":options.flags.get("source-release").and_then(|s|s.parse::<u64>().ok()),"preview":true,"security":options.flags.get("security-summary").and_then(|s|serde_json::from_str::<serde_json::Value>(s).ok()),"visibility":visibility,"rollbackVisibility":rollback_visibility,"rollbackViews":rollback_views,"rollbackViewEffects":view_effects,"rollbackView":options.flags.get("rollback-view").and_then(|s|serde_json::from_str::<serde_json::Value>(s).ok()),"clientCompatibility":client_compatibility,"checklist":checklist,"hazards":hazards,"notes":notes,"current":held,"plan":planned,"steps":steps,"estimate":estimate,"phases":engine.store().adoption_report().summary(),"backfills":engine.store().adoption_report().backfills});
409:    if schema.tables.values().any(|t|t.frozen_columns.values().any(|r|json_taint(&serde_json::to_value(r).unwrap(),&BTreeSet::new(),hidden))) {return Err(refuse());}
   237	    /// The engine's own write of a `set null` reference: no rule, every constraint.
   238	    fn clear_reference(&mut self, table: &str, column: &str, old: Value) -> Result<(), RuntimeError> {
   239	        let mut new = old.clone();
   240	        if let Value::Row(fields) | Value::Map(fields) = &mut new { fields.insert(column.to_owned(), Value::Null); }
   241	        let patch = crate::value::object([(column, Value::Null)]);
   242	        let outer = std::mem::replace(&mut self.engine_action, true);
   243	        let result = self.target_attempt(table, |runner| {
   244	            runner.reserve_maintains(table, &runner.schema.tables[table])?;
   245	            runner.replace_authorized(table, old, new, true, &patch, 0)
   246	        });
   247	        self.engine_action = outer;
   248	        result
   249	    }
    17	pub fn validate(schema:&Schema)->Vec<SchemaIssue>{
    18	    let mut issues=Vec::new();
    19	    for (name,t) in &schema.tables {
    20	        for (column,rule) in t.column_writes.iter().chain(&t.frozen_columns) {
    21	            let path=format!("tables.{name}.column_writes.{column}");
    22	            if column=="id" || !t.columns.contains_key(column) || t.engine_field(column) || t.maintained.contains_key(column) || t.sequences.contains_key(column) || schema.maintain_for(name).is_some() || schema.timelines.iter().any(|timeline|timeline.owns(name)||timeline.maps(name)) || schema.receipts.iter().any(|r|r.messages==*name||r.members==*name||r.runs==*name) || t.written_by.contains_key(column) || t.on_delete.get(column)==Some(&references::OnDelete::SetNull) {
    23	                issues.push(SchemaIssue{path:path.clone(),message:"column write/freeze needs an ordinary payload column without owner-field bypass or on delete set null".into()});
    24	            }
    25	            super::validate_rule(schema,t,rule,false,false,&path,&mut issues);
    26	            if rule.any_term(&|term|matches!(term,RuleTerm::OldField(_)|RuleTerm::NextField(_))) {

codex
MATERIAL — two safety defects remain.

1. **Implicit writes can erase a current freeze.** [release_bridge.rs:516](/home/ccheever/projects/sb4-b27-rel/snapback4/crates/snapback4-lang/src/release_bridge.rs:516) checks only direct program writes. Consider historical `children.parent: parents ? on delete set null`, with an operation deleting a parent. Current source changes that edge to `restrict` and adds `immutable parent when true`. Historical selection passes because no IR statement directly updates `children`; its parent delete subsequently clears the frozen reference.

   **Exact repair:** include reachable implicit column writes in authority/freeze admission, including set-null edges reached through transitive cascades. Refuse unmodeled effects that may change protected cells. Apply this before declaring a column unwritten; the blocker inside `leading_guard` cannot cover this path. Add this rollback regression.

2. **Equal-source deployment bypasses admission when registration changes.** [releases.rs:498](/home/ccheever/projects/sb4-b27-rel/snapback4/crates/snapback4/src/verbs/releases.rs:498) calls historical `check_change` only when `register_views` is false. The registration branch at [releases.rs:514](/home/ccheever/projects/sb4-b27-rel/snapback4/crates/snapback4/src/verbs/releases.rs:514) activates identical historical executable content under a new parent without checking active/latest column authority.

   Concrete sequence: R1 has optional `n` and unguarded `body`; R2 makes `n` required and protects `body`. Redeploying R1 requires a new view for R2’s narrower domain, routing around the authority gate and restoring the unguarded writer.

   **Exact repair:** whenever `matched` exists, run historical admission against active and latest ordinary source before either identity reuse or new-parent registration. Registration metadata must not turn historical selection into an unrestricted ordinary policy change. Add the sequence above as a regression.

Static review only; no edits or builds.
tokens used
141,423
MATERIAL — two safety defects remain.

1. **Implicit writes can erase a current freeze.** [release_bridge.rs:516](/home/ccheever/projects/sb4-b27-rel/snapback4/crates/snapback4-lang/src/release_bridge.rs:516) checks only direct program writes. Consider historical `children.parent: parents ? on delete set null`, with an operation deleting a parent. Current source changes that edge to `restrict` and adds `immutable parent when true`. Historical selection passes because no IR statement directly updates `children`; its parent delete subsequently clears the frozen reference.

   **Exact repair:** include reachable implicit column writes in authority/freeze admission, including set-null edges reached through transitive cascades. Refuse unmodeled effects that may change protected cells. Apply this before declaring a column unwritten; the blocker inside `leading_guard` cannot cover this path. Add this rollback regression.

2. **Equal-source deployment bypasses admission when registration changes.** [releases.rs:498](/home/ccheever/projects/sb4-b27-rel/snapback4/crates/snapback4/src/verbs/releases.rs:498) calls historical `check_change` only when `register_views` is false. The registration branch at [releases.rs:514](/home/ccheever/projects/sb4-b27-rel/snapback4/crates/snapback4/src/verbs/releases.rs:514) activates identical historical executable content under a new parent without checking active/latest column authority.

   Concrete sequence: R1 has optional `n` and unguarded `body`; R2 makes `n` required and protects `body`. Redeploying R1 requires a new view for R2’s narrower domain, routing around the authority gate and restoring the unguarded writer.

   **Exact repair:** whenever `matched` exists, run historical admission against active and latest ordinary source before either identity reuse or new-parent registration. Registration metadata must not turn historical selection into an unrestricted ordinary policy change. Add the sequence above as a regression.

Static review only; no edits or builds.
