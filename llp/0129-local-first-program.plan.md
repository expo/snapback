# LLP 0129: The local-first program

**Type:** Plan
**Status:** Accepted
**Systems:** Sync, Storage, Runtime, Client integration, Auth, Wire Protocol, Realtime, Packaging, Testing, Documentation, Competitive evaluation
**Author:** Charlie Cheever / Claude (Fable 5)
**Date:** 2026-07-30
**Revised:** 2026-08-07, later still (Phase 2a common-path designation
FROZEN under the author's delegation —
`tests/acceptance/fixtures/browser-lane/handler-coverage.v1.json`, 12
designated cases over the pinned D5 corpus, every remainder excluded
with reasons — and the browser-IR coverage gate rerun against it:
semantic 12/13 PASS, exact-D5 37/37 PASS, common-path 11/12 **FAIL**
with the single named gap `todo-v2-delete-todo` (a plain single-row
delete, refused `SNAPBACK_PLAN_EFFECT_CEILING`); receipt
`browser-ir-coverage.2026-08-07.v2.{json,md}`, gap ticketed at
`issues/20260807-single-row-delete-effect-ceiling.md`; no exit
declared, disposition due to the author by 2026-08-14.)
**Revised:** 2026-08-07, later (author gate packet RULED — all seven items of
`issues/closed/20260807-local-first-author-gate-packet.md` carry dated
author rulings, Charlie Cheever, recorded this revision: OQ7's Phase-0
gate split extends — the Node/file/public and browser/public halves are
landed, the authenticated/authorized half stays open on M1 lease custody,
and SD-5 keys off the split disposition; the Phase-0 remainder and the
Phase-2a disposition are assigned to the standing orchestration lane,
each presented by 2026-08-14; the Phase-2a common-path designation is
delegated by the author to the orchestrating agent; the decision lab is
explicitly DEFERRED with a verbatim reopen trigger, so Move 4 stays
parked by decision, not drift; the LLP 0107 strand backstop is ruled
options 2+3, with the amendment landing in a separate lane; zerobugs
§13's durable-disconnected-intent candidate is RATIFIED; and Phase-1
governance is ruled — the owner-landing ledger governs the claims, the
2026-08-04 EXIT note's "OQ8's mechanisms shipped" wording carries a
dated correction, `Parity` labeling stays barred until ledger rows 2–4
land, and rows 2–4 get owners: partial-read admission retained here with
the orchestration lane implementing, schema/identity fencing → LLP 0081,
receipt projection → LLP 0043.)
**Revised:** 2026-08-07 (§Open questions items 8, 10, and 11 stamped
inline with the 2026-08-06 author sitting #4 rulings, matching item 9's
convention; question bodies retained. The consolidated author-gate packet
for the remaining open decisions — OQ7, phase owners/timeboxes, the
Phase 2a common-path designation, decision-lab scheduling, the LLP 0107
strand backstop, zerobugs §13 ratification, and the Phase-1 end-to-end
governing-artifact question — is filed at
`issues/closed/20260807-local-first-author-gate-packet.md` (filed open;
ruled and closed 2026-08-07 — see the later entry above).)
**Revised:** 2026-08-06 (Phase-2b pending-work follow-on BUILT, with the
listener-bound promotion gate still awaiting its outside-sandbox run: the
sidecar now carries an explicit shared-store handoff, candidate URL + startup
nonce + store-writer + fresh-snapshot + exact-generation binding, and a checked
client adoption receipt. Pending replay preserves the original
`clientMutationId` against the shared SQLite settlement ledger; identity,
writer, freshness, store, and compatibility failures stop the candidate and
reattach the predecessor. This is pending-work-preserving stop/start, not
zero-request-downtime.)
**Revised:** 2026-08-06 (Listener-bound promotion gate run OUTSIDE the
sandbox in an isolated worktree at origin/main commit `e99d2a328`: the named
`node --test tests/acceptance/desktop-sidecar-v1.mjs` gate passed 1/1,
including the pending-drain, duplicate-republish, identity-divergence
rollback, writer-fence rollback, incompatible-generation rollback, and empty
swap scenarios; the same-database two-runtime settlement PoC
(`hot-swap-settlement-poc.2026-08-06.v1.mjs`) also passed
(`sameResult`/`sameReceipt` true, one settled row), clearing the earlier
managed-sandbox EPERM block. The Phase-2b hot-swap-with-pending build is now
evidence-promoted at the first-rung boundary. Dated evidence:
`tests/acceptance/fixtures/desktop-sidecar/hot-swap-promotion.2026-08-06.v1.json`.
Honest boundary language is unchanged: still pending-work-preserving
stop/start, not zero-request-downtime.)
**Revised:** 2026-08-06 (Phase-2b package-boundary follow-on closed: LLP 0123
Option 3 now seals binary + Hermes header/runtime digests with the successful
CV-2 verdict at package production, and the packaged CLI resolver re-verifies
that seal before returning a runtime binary. This does not claim the distinct
in-serving-process boot witness or pending-intent hot-swap follow-on.)
2026-08-06 (Phase-2b hot-swap design-spike correction: a durable
outbox record is store-owned, not client-instance-owned. A fresh client over
the same explicit store sees and replays it; the reproduced empty view comes
from the default file store's full-origin identity selecting a different blob
on the candidate's new ephemeral port, while a separate same-identity store
instance sees the record but needs writer takeover. The scoped recommendation
is BUILD: preserve global per-origin isolation, inject one stable sidecar store,
add a fail-closed adoption receipt, and rely on the existing same-database
settlement identity. See the dated design-spike note and retained PoCs below.)
2026-08-06 (Phase 2a browser-IR coverage gate FIRST RUN at base commit
e99d2a328: `tests/acceptance/browser-ir-coverage-v1.mjs` executed the
pinned 37-case LLP 0051 D5 corpus through the shipped browser IR
evaluator inside real Chrome 151.0.7922.76 with per-case IndexedDB
read-back — 37/37 exact, browser==Node byte-identical,
manifest-digest-chained to the Phase-1 Rust receipt; semantic IR
coverage stands at 12/13 = 92.3% (PASS ≥90%, carried from the pinned
assessment classification); the 100%-common-path component is
INDETERMINATE — the designated common-path mutation set was never
frozen (`issues/20260806-phase2a-common-path-designation-absent.md`
routes the designation to the author) — so the whole gate is
NOT-DECLARABLE and no exit is presented. Receipt:
`tests/acceptance/fixtures/browser-lane/browser-ir-coverage.2026-08-06.v1.json`.)
2026-08-06 (OQ9 RESOLVED by the author — Phase 2a browser
story is IR-only; full-runtime WASM deferred; Phase 2a's falsifiable exit
is the browser-IR-coverage gate (≥90% semantic + 100% common-path,
real-browser, exact D5); a narrow engine-free WASM slice is a
demand-triggered reopen. See §Open questions 9. The completion boundary's
OQ9 dependency is thereby satisfied on the exit-semantics axis.)
2026-08-05 (Phase-2b client-outbox re-adoption boundary: the
shipped replay path drains through the same client instance that queued on a
transport failure; a fresh post-swap client does not re-adopt that durable
pending record. The honest first rung therefore proves empty-outbox swap and
pending-intent fail-closed rollback with the record still pending; cross-client
re-adoption is a named follow-on); 2026-08-05 (Phase-2b swap-replay correction: the app-owned
client must attest an explicit rebind to the candidate's ephemeral URL before
resume, and a URL-bound replay receipt with zero remaining pending intent is
required before the sidecar commits `swapped`); 2026-08-05 (Phase-2b desktop-sidecar first-rung implementation:
the productized `@expo/snapback-sidecar` supervisor, client-outbox swap
protocol, and real-runtime acceptance runner landed. The local sandbox refused
the runner's listener bind, so no PASS receipt was manufactured and the
evidence gate remains unpromoted here until the orchestrator reruns the exact
command recorded in the dated note. The in-process ABI spike, LLP 0081
tombstone-and-re-entry quarantine, and LLP 0123 package sealing remain named
follow-ons, not sidecar claims.) 2026-08-05 (Phase 2a dated WASM assessment landed: the frozen
LLP 0051 durable-mutation corpus is 12/13 IR-expressible, the measured pure-Rust
evaluator WASM anchor is 306,890 raw / 117,353 gzip / 95,830 Brotli bytes, and
full Hermes/JSI remains an explicitly estimated multi-MiB, policy-inadmissible
browser path; recommendation: pin browser execution to the shipped IR evaluator
and defer narrow engine-free WASM until a falsifiable demand trigger. The
assessment meets Phase 2a's named evidence gate but does not build a runtime or
resolve author-owned OQ9's exit/disposition choice.) 2026-08-04 (write-rung-2 EXIT accepted — Calendar gate 8/8on the unwidened ceiling; rung 2 closes, no write-lane phase open; see
the dated EXIT block under OQ5.)
2026-08-04 (rung-2 evidence-gate half (a) accepted — the
no-widening reading; W2/W3 collapse as evidence-vacuous, W4 proceeds on
rung 1's ceiling; see the dated acceptance under OQ5.)
2026-08-04 (read-lane capability activation record:
`single_table_v1` registered/required and source-qualified local support
published; no write-rung authority changes). 2026-08-04 (OQ5 dated ruling — write rung 2 (LLP 0155
Move 4) opened: owner/timebox recorded, Candidate-A framing and the
Calendar shipping-vs-lab disposition stated;
`issues/20260804-0129-write-rung2-ruling.md`.)
2026-08-03 (OQ7 ruled — the Phase-0 evidence gate splits;
author decision sitting #2,
`issues/20260803-author-decision-sitting-2.md`; see §Open questions 7.)
2026-08-02 (ledger row 1 implementation record — LLP 0133's
buildable-now settlement substrate is implemented: synthetic lane-L
re-derivation, labeled/private settlement evidence, exact identity and logical
mint mapping, bounded-skew admission, plus client id rewrite/cascade and
authoritative-delivery bridging. This does not ship local execution or clear
rows 2–5, and it does not change Phase 0/1 gate dispositions.) 2026-08-02 (dated product-direction cross-reference — LLP 0155
"Local sync product direction" was Accepted by the author today and names
this Plan's program as the write lane of its two-lane execution: LLP 0155
moves 1–3 are the chosen product-direction consumers of this program.
Recorded here per LLP 0155 §Sequencing Stage 0: (1) the lane split — LLP
0155's read lane (bounded-node composition, completeness, custody
inspection, fragment-baseline materialization) proceeds under this Plan's
existing §Interaction-with-intervening-product-work permission and its
governing no-browser-write-expressiveness criterion; the write lane is
this Plan's phases unmodified, and on any conflict this Plan wins until a
dated amendment lands here. (2) No phase, gate, ledger row, or standing
decision is amended by the cross-reference; OQ5/OQ7/OQ8/OQ10 remain open
and author-owned under this Plan's own machinery. (3) LLP 0155's read lane
commits to landing the browser store/outbox and presentation slice of the
substrate OQ8 names — offered as evidence toward closing OQ8, with ledger
rows 1–4 remaining OQ8's other half. (4) LLP 0155 adopts the conservative
reading of this Plan's prototype/implement distinction for Candidate-B
work and requires a retained A inexpressibility result plus OQ10's frozen
boundary/owner before any B-shaped prototyping. (5) Proposal, not yet
adopted: register Incident Room — LLP 0155's Stage-0-frozen
product-direction safety-control manifest, the bakeoff's
protected-retirement/authority-transition witness — as a named
safety-control artifact of the decision lab; until the author adopts that
here, the lab's frozen manifests remain exactly Kanban, Calendar, and
Notebook.)
2026-08-01 (React Native durable-store arm landed — the option-A
default carrier now reaches React Native. Design decision recorded here
because no prior revision answered it: the default ladder CANNOT import a
platform filesystem module (Metro statically resolves every literal
specifier reachable from the client root), so the conservative default is an
explicit one-line registration at the app root —
`registerExpoFileSystemRqsFiles(FileSystem)` — after which every client
resolves the durable file arm (`rqs-store-file.mjs` over an injected
expo-file-system files adapter, `rqs-store-expo.mjs`); unregistered RN
resolves memory with the actionable reason `no-native-files-registered`,
never a silent import attempt. Same store contract, same DK-9 reporting;
conformance = the full Channel B resume suite on the node projection of the
pinned expo-file-system API (`rqs-resume-expo.test.mjs`, 18/18) plus an
on-device witness (iOS simulator, release Hermes build, real
expo-file-system: ladder resolution, flushResumeState persistence,
protected-sentinel-never-at-rest, cold-boot retained render
`freshness:'retained'` — `demos/rn-durable-store-witness/`). Phase 0's
own gate disposition is unchanged: the chosen arm remains JS/React
BROWSER, and this RN witness is recorded as carrier reach, not as that
gate's evidence. Known residue ticketed: sequential short-lived clients in
one process degrade to non-persisting readers because nothing releases the
default store's writer lock —
`issues/20260801-rqs-default-store-lifecycle-sequential-clients.md`.)
2026-08-01 (v0.8, super-refine round 6 — Fable READY,
Codex NOT READY, the third split; the loop closed here with the
fixable residue applied and the author-owned residue routed, not
silently settled. **Gate 6's sandbox list was literally wrong** and is
rebuilt: v0.5's "the retained query store, the outbox, the IR plan and
its ledger, and nothing else" omitted mutation arguments and the
operation artifact, so no arg-bearing Candidate A could execute and
Candidate C — an app-authored mutator, not an IR plan — could not exist
at all, while gate 6 binds every candidate. The frozen surface now
bounds *ambient* capability and enumerates ordinary execution inputs
against LLP 0051 D5 and LLP 0133. **The protected `N/A` language** is
narrowed to the protected-*retention* recommendation scope, with
gate-7 applicability determined exclusively by 7(a)–(d), closing a
reading under which "protected cases are N/A" could waive required
authority tests. **Exit criterion 3's element-5 harness** is raised
from activation *carriage* to conformance on both executions plus
mismatch refusal/quarantine/resync, with the normative consequence
stated: criterion 3 cannot pass and no same-code claim may ship until
element 5 has an owner (§Open questions 11). Two dangling obligations
are ticketed rather than left as prose:
`issues/20260801-js-arm-integrated-authenticated-restart-witness.md`
(the authenticated React/browser/full-process-restart conjunction that
neither existing ticket forces into one run) and
`issues/20260801-cold-process-claim-vocabulary-collision.md` (retained
receipts and LLP 0043/0053 still say "cold process" for a same-process
proof — an amendment those owners must make, not this Plan). Details:
the Notebook no-restart claim scoped to the Snapback arm, since the
Replicache control *did* execute a concurrent rebase; the SD-5 clause
rephrased so it cannot be quoted against SD-5's own text; §Open
questions reordered 9–11; the safety/workload vocabulary opener
aligned with the typed-field split; and the guide's refused-replay
sentence narrowed to the store contract, disclosing that the client's
refusal wiring is untested.)
2026-08-01 (v0.7, super-refine round 5 — **both families
NOT READY**; Fable found one material, Codex three blocking and five
material. **Self-inflicted contradictions from v0.6, both repaired:**
the least-power selection rule contradicted B's coherence ceilings in
Outcome 0's own case (ii), recommending Outcome 2 where the ceilings
mandate Outcome 0 — the rule now includes each outcome's own
conditions; and the Phase 0 block withdrew the cold-boot claim in one
paragraph and re-asserted it three lines later ("claimed at
file-store/headless reach") — the beat is now **not claimed at any
reach**, with the guide prose and the acceptance header's "cold boot"
wording corrected to match. **Constraint 7:** v0.6 said this Plan
"SUSPENDS" SD-5, which would be amending a rule LLP 0130 owns; it is
reframed as invoking SD-5's existing scope-change escalation, with any
change to the rule itself left to a dated LLP 0130 amendment only the
author can make. **Safety, verified against owners:** gate 7(b) had
flattened LLP 0053's shrink obligation to "the resnapshot carries it,"
dropping the durable level-triggered obligation and its ACK-at-or-after
-causing-version discharge — restored, because without it a lost
removal leaves forbidden rows visible indefinitely; lease expiry
removed from (b)'s proof list (it is (c)'s); and the public-data-only
`N/A` narrowed hard, since LLP 0053 defines auth-scoped fail-closed
("undeclared means auth-scoped") and LLP 0080 keeps even all-public-read
relational plans auth-scoped, so "the lab uses public data" never
licenses `N/A` on (b). **Decision quality:** the misattribution
taxonomy gains candidate-implementation defect, harness/evidence
defect, environmental, ambiguous-frozen-fact, and unresolved — none of
which may detect the trigger, each producing Outcome 0 plus a sealed
rerun — because the three-way partition had no home for failure modes
this program has already experienced; gates 2 and 9 are partitioned on
commit-versus-visibility so the Fleet result cannot be argued into
either; and the workload and safety status vocabularies are split into
separate typed fields. **Ledger row 7's "unbuilt … no client caller"
was stale** and is re-scoped to the LLP 0008 journal-delta path, left
open pending a dated wire-path verification rather than marked landed
on a reading. New §Open questions 10–11 route two more author-owned
residues: what Candidate B actually is and who owns it — without a
frozen B language, two failed B attempts cannot support Outcome 3 —
and who owns execution-identity element 5's store-semantics profile and
mismatch disposition.)
2026-08-01 (v0.6, super-refine round 4 — Fable READY,
Codex NOT READY, a second split; this revision answers Codex's residue
and Fable's details. **Evidence-strength corrections, both verified in
the tree before applying:** the Phase 0 "cold boot" is a *same-process*
client/store re-instantiation (`closeClient` then `openClient` in one
Node process, with only the server stopped), so criterion 1's
process-restart element is unproven on *every* carrier, not just the
browser; and Notebook's restart/rebase findings are immediate
`suite.gap(...)` declarations plus a source audit, not executed runs —
the bakeoff never restarted the pending client or introduced a
concurrent edit. **Withdrawn:** the "known pin" preclassification of
workload 3's speculative-restart gap. Both reviewers checked LLP 0090
and it does not refuse speculative reconstruction — D3 pins a *resume*
rule with composition deferred to milestone 3, which is the
missing-shared-mechanism class if anything; preclassifying it as a pin
would have suppressed a real Candidate A deficiency, so no gap is
preclassified and a pin now requires an owning document to adopt the
prohibition before freeze. **Safety:** the public-data-only `N/A`
branch was unsafe — absence of protected retention does not imply
absence of authority-bound queues, overlays, or public retained rows,
and LLP 0039 requires authority transitions to delete retained rows and
queued mutations, so case (a) now always runs when an authenticated
client is in scope; cases (b)/(c) are made mutually exclusive on lease
expiry; and (d)'s resnapshot is scoped to auth-scoped subscriptions
rather than any authenticated session. **Consistency:** one status
vocabulary with fixed eligibility effects (`FAIL` and `GAP` both
disqualify); Outcome 0 surfaced in §Candidate outcomes so the
four-state set is visible where the outcomes are defined; Outcome 3
now requires two independent failed B attempts, matching the proof
rule that previously contradicted it. **Advancement:** SD-5
auto-advance is suspended for Phase 1 pending §Open questions 8 —
blocking only the lab left a premature-advance path on an
evaluator-only gate. **Closure map:** exit criterion 2 adds M1
implementation, protected-row promotion, and one *integrated*
authenticated React/browser/full-process-restart witness, since the two
existing tickets can both close without proving criterion 1's
conjunction. Guide corrections landed with it: the capability row states
the resolver's real prerequisites and fallbacks, and refused-replay
evidence is reattributed to the package unit test that actually covers
it.)
2026-08-01 (v0.5, super-refine round 3 — Fable READY,
Codex NOT READY, so the loop did not converge and this revision answers
Codex's residue. **Safety, both verified against owners before
applying:** gate 7(b) used "retirement," a disposition LLP 0053 does
not have — the connected case now carries 0053's actual rule, "coarse
events quarantine; only proof deletes," split into matcher-mediated
delivery, coarse-event `quarantine`, and proof-backed `delete`, with
the public-data-only dispositions stated; gate 6 no longer says
external effects "degrade" (no owning document defines a degraded local
external effect — LLP 0133 excludes action replay and LLP 0126 pins
them impossible offline), and instead denies them through a declared,
frozen candidate sandbox with negative tests. **Decision quality:**
Outcome 0 added, because "exactly one of three outcomes" was not total
(a pin-collision-only failure, or an expressive-but-incoherent B, fit
none of 1–3); a proof-of-inexpressibility rule added, since the trigger
rests on a universal claim the protocol had no way to establish — one
valid A implementation defeats it, both independent attempts must fail
the same fact with sealed per-builder evidence, the missing primitive
must be named and owner-validated, B gets the same standard, and
authoring-time figures are descriptive only given the fixed A→B→C
ordering; a misattribution log classifies every A gap as IR-inherent,
pin-collision, or missing shared mechanism. **Feasibility:** the lab may
not be scheduled before §Open questions 8 is answered, and the
Outcome-2 freeze carve-out widens to every mechanism an accepted owning
document already requires as substrate (lane-L id-map delivery
specifically), closing a circularity where the freeze forbade what
Candidate A needs. **Completion:** the four mandatory measurements are
bound to phases and to the completion boundary instead of floating; and
the collision between "no falsifiable criterion, no exit" and "Phase 2a
must execute for completion" is stated rather than papered over —
completion is unreachable until §Open questions 9 is answered.
Out-of-document corrections landed with it: the guide stops crediting
the untested `SNAPBACK_RETENTION_NOT_RETAINABLE` refusal to the
headless witness, the acceptance script's header stops calling itself a
self-advancing SD-5 gate, and LLP 0133's §Status is reconciled to its
Accepted metadata.)
2026-08-01 (v0.4, super-refine rounds 1–2 — artifacts
`reviews/0129-local-first-program.fable.md`,
`reviews/0129-local-first-program.codex.md`, journal
`reviews/0129-local-first-program.super-refine.md`. Round 2 returned
NOT READY from both families and forced these corrections. **Claims:**
Phase 0's "carry the retention/replay `Parity` claims" was wrong on its
face — LLP 0043 pins that no local execution means no parity claim, so
Phase 0's claims are `Online`-class and the wording is withdrawn; the
Plan and `guide/capabilities.md` now use the same maturity word
(`partial`) for `sync.offline-js-arm`; exit criterion 2 names its
literal terminal row set. **Contradictions removed:** the Phase 0 gate
disposition read both "is CLEARED" and "NOT CLEARED" — one disposition
now stands (implementation lane landed; Phase 0's gate NOT met; the
phase has not exited), with the split-or-hold choice routed to the
author as §Open questions 7; the decision lab no longer implies the
successor rerun is a prerequisite; and Phase 1's IR overlays are carved
out of the Outcome-2 freeze that would otherwise forbid the very
surface Candidate A needs. **Safety:** safety gate 7 splits into LLP
0053's four distinct authority cases (logout deletes, connected
revocation retires, disconnected is lease-bounded, reconnect
resnapshots) instead of one conflated "authority loss" row; the Fleet
standing nonclaim is re-diagnosed and moved to gate 9 — all 1,000
writes were durable, the defect was an implicit 1,024-row query prefix,
remediated by `b52e3b9c`. **Decision quality:** Candidate B gains
preregistered coherence ceilings so the recorded burden evidence can
affect the recommendation; trigger detection distinguishes IR
insufficiency from collision with an owned policy pin (LLP 0090 D3
named); Outcome 3 is renamed to name the lab's act as a recommendation.
New §Open questions 7–9 route the three author-owned residues: Phase
0's gate disposition, whether Phase 1's D5-only gate is sufficient for
what Phase 1 promises, and Phase 2a's non-falsifiable exit.)
2026-08-01 (Phase 0 evidence correction: the retained 9-check
acceptance proves the headless JS/Node-file carrier, not React, standards-real
IndexedDB, or browser-process restart; the browser half of the gate remains
open and guide claims are narrowed.) 2026-08-01 (Option-C empirical decision protocol: the
Snapback/Zero/Replicache bakeoff detected credible browser-write
expressiveness pressure, not the recorded OQ4 trigger; after the Phase 1 IR
evaluator passes its sizing and D5 gates, a frozen three-workload browser lab
may compare the shared-IR rung, constrained typed extension points, and
Replicache-class app-authored client mutators under safety gates, real
IndexedDB crash/restart evidence, authoring/runtime measurements, and an
author-only dated admission artifact.) 2026-07-31 (wave-1 state refresh: lane C5 landed on main
(`2a7bf058`/`e416fb89`/`b53c28fd`) and the
Phase 0 evidence gate is recorded CLEARED under SD-5 **(this
disposition is WITHDRAWN — superseded by v0.4/v0.5; the gate is NOT
met and Phase 0 has not exited)**, with the
lease-custody/sessions-queue remainders ticketed and holding exit
criterion 2's `auth.authorized-leases` half open at program level;
ledger row 1 UN-GATED — the owning settlement Spec landed as LLP
0133, Accepted 2026-07-31 under LLP 0130 SD-4.) 2026-07-31 (Phase 0 status note added under §Phases: the
option-A JS-arm slice is implemented in-branch with its diary-grade
offline acceptance green — see the dated block for what landed, the
environment-capture honesty note, and the ticketed remainders.)
2026-07-31 (standing-decisions pointer: LLP 0130 records
the author's pre-adjudicated conditional rules for this program's
mid-flight gates — SD-3 folds the offline dimension into the shared
successor rerun, answering §Measurement's pending composition; SD-5
makes the phase gates self-advancing on gate success; ER-1 reserves
option-C admission as the author's call alone.)
2026-07-31 (v0.3, lockstep round-1 fixes: round 1 of the
{0115 v0.6, 0129 v0.2} lockstep super-refine returned Fable READY /
Codex NOT READY for this Plan (artifacts
`reviews/0115-0129-lockstep.fable.md`,
`reviews/0115-0129-lockstep.codex.md`). Codex blocking 1: v0.2's "one
rerun serves both programs" silently decided rerun composition, which
is LLP 0115 open question 4's still-open adjudication — §Measurement
and §Cross-gates now carry the fold as this Plan's proposal pending
OQ4, with the program's diary-grade offline acceptance and
measurement independently mandatory either way. Codex blocking 2:
§Exit criteria gains the program-completion boundary — criteria 1–2
are Phase 0's exit and Phase 0's exit is not program completion;
criterion 3 binds same-code claims from Phase 1 on; criterion 4 binds
every phase; "program complete" is defined over all authorized
phases (0, 1, 2a, 2b) plus a stated disposition for the Option F
rider. Codex material 3 + Fable material 1 (same territory): ledger
row 1 gains decision 10's domain and lane scoping —
application-visible values vs. the protocol-lane `clientMutationId`,
verified against LLP 0008 §Replay environment contract on
2026-07-31: 0008's replay-accept pin (the wire transmits
`{generatedIds, now}`; the server accepts them on replay) STANDS for
the queued-intent replay lane Phase 0 ships, while the settlement
Spec governs the local-execution lanes, where re-derivation is the
stricter default; any future change to the 0008 pin lands as a dated
0008 amendment. Detail fixes: criterion 3's ledger gate restated as
all five unowned designs with row 1 merely first (Codex detail 4);
criterion 2's arm-scoped guide rows named as a Phase 0 deliverable —
`guide/capabilities.md` is arm-agnostic today (Fable D1);
LLP 0084/0107/0108/0118 added to Related (Fable D2); the decision
registry cited as "LLP 0115 open question 8" by question, not
version (Fable D3). Per the LLP 0063-style delegation, this revision
was agent-executed under the author's 2026-07-31 direction.)
2026-07-30 (v0.2, decisions recorded: 0127 decisions 2
and 10 were adjudicated by the author on 2026-07-30 — decision 2
confirms this Plan's shape and authority, the JS/React browser arm as
first carrier, and the two-parallel-ladder staging with IR-rung-first
resourcing, with option C not admitted and held behind a named trigger
(open question 4 records the wording verbatim); decision 10 sets
server re-derivation as the settle-time default, client-captured
values carried in receipts as labeled claims, bounded-skew only as
per-field declared opt-in, owned by a new settlement Spec under this
program — the program's first owned-Spec deliverable. §Decision
posture updated: the phases are authorized to start; open questions
1–2 are decided and question 3 is moot; the LLP 0115 cross-references
now cite its landed v0.6, whose open question 8 is the decision
registry of record.) 2026-07-30 (initial draft, directed by the author
the day LLP 0127 was Accepted; drafted with 0127's open decisions 2
and 10 deliberately unmade — see §Decision posture)
**Related:** LLP 0003, LLP 0008, LLP 0012, LLP 0013, LLP 0034, LLP 0043, LLP 0051, LLP 0053, LLP 0059, LLP 0070, LLP 0073, LLP 0074, LLP 0080, LLP 0081, LLP 0084, LLP 0090, LLP 0093, LLP 0107, LLP 0108, LLP 0110, LLP 0111, LLP 0112, LLP 0113, LLP 0114, LLP 0115, LLP 0116, LLP 0118, LLP 0119, LLP 0123, LLP 0125, LLP 0126, LLP 0127, LLP 0130, LLP 0133, LLP 0138

## Summary

This is the successor Plan that LLP 0127 §Sequencing 5 proposes for the
local-first program: "a successor Plan, not a 0115 tranche," with its
own sequencing document under 0126 OQ7's answer, cross-gated with
LLP 0115 where the substrate is shared. It executes the analysis of
LLP 0126 (Active, v0.4) as staged by LLP 0127 move 3's
displaced-in-space half. The deferred-in-time half — slice 3-jobs,
transactional one-off scheduling — is **not** this program; it rides
LLP 0070 under 0115's CV-9 and is out of scope here.

Why now, on the record:

- **The diaries scored offline as decisive and the rerun measured none
  of it.** Diaries 0027–0029 recorded offline GAPs as a primary reason
  not to choose Snapback, and recorded the same cold-boot GAP for
  Convex: a reopened browser with the backend down "yielded no
  authenticated application shell and zero retained query rows"
  (Diary 0027, quoted in LLP 0126). Diary 0039's rerun scope excluded
  the territory, so the 55/45 score contains no local-first signal.
  Against Convex this front is an opportunity claim against recorded
  absence; the diaries' measured bar is Firebase and InstantDB
  (LLP 0126 finding 1).
- **The shipped slice is unwired to the scored arm.** LLP 0043's
  retention/replay slice is implemented on the Contract arm (guide
  rows `sync.offline` and `auth.authorized-leases` shipped on the
  local target; local manifest claims `offline_retention` and
  `optimistic_replay`) while the browser JS/React arm the diaries
  actually score has none of it — execution lag and arm coverage, not
  design absence (LLP 0126 finding 3; LLP 0116 finding 2).
- **The field retreated toward Snapback's posture.** Two dated
  first-party retreats from CRDT cores (Electric 2024, Jazz 2026),
  Ditto's read-time-derivation guidance, and LLP 0084's five-to-zero
  materialized-state count corroborate server authority, tentative
  client writes, and state-delta delivery — LLP 0008's pin — without
  any surveyed peer holding Snapback's distinctive ingredient set for
  same-code-both-sides re-execution (LLP 0126 findings 2 and 5).

What the program delivers, its staging now confirmed (0127 decision 2,
2026-07-30), if its exit criteria hold: a scored browser arm that beats
Convex's measured
cold-boot GAP for the retainable subset; the JS/React arm carrying the
same retention/replay claims the Contract arm already proves; and a
tested path toward LLP 0051 §D6's "Parity by construction" — with
every claim scaled to exactly what its acceptance proves.

## Decision posture

LLP 0127 is Accepted, and the two of its routed author decisions that
bear directly on this Plan were adjudicated by the author on
2026-07-30 (registry of record: LLP 0115, open question 8 — cited by
question, durable across that Plan's revisions). Both are
**decided**; §Open questions 1–2 record them:

- **0127 decision 2 — DECIDED.** The successor-Plan shape (this
  document) is confirmed as the program's authority; the JS/React
  browser arm is the first carrier; the two-parallel-ladder staging
  with IR-rung-first resourcing is confirmed (0126 OQ1/OQ7). Option C
  (client mutators) is NOT admitted; it is held behind a named
  trigger — admit only if the IR rung proves insufficient for
  browser-side write expressiveness after measurement (§Open
  questions 4 records the wording).
- **0127 decision 10 — DECIDED.** Server re-derivation is the default
  for client-captured `now`/ids at settlement; client-captured values
  are carried in receipts as labeled claims, never authority;
  bounded-skew acceptance only as a per-field declared opt-in
  (0126 OQ3). The policy is owned by a new settlement Spec under this
  program — the program's first owned-Spec deliverable (ledger
  row 1).

Consequences, stated plainly: this Plan's phases are authorized to
start under its authority, and §Phases is the program's staging
rather than a proposal. What was drafted to hold under any resolution
now binds: Phase 0's arm is the JS/React browser arm; ledger row 1's
owner is the settlement Spec, which gates every
`Parity`-by-construction claim until it lands (0127 records item 10
joining move 3's displaced-in-space exit); exit criteria 1 and 3 bind
as §Exit criteria states. Per-phase owners and timeboxes (§Open
questions 5) remain the outstanding before-start requirement for each
phase. Under LLP 0130 SD-5 (2026-07-31), the phase gates are
self-advancing: a phase whose named gate passes advances without
fresh adjudication; gate failure or scope change escalates to the
author.

## Governing constraints

Constraints 1–2 are inherited verbatim in force from LLP 0115
§Governing constraints; 3–7 are this program's own.

1. **No evidence regression.** A work item that improves ergonomics by
   weakening an evidence boundary is out of scope. The options 0126
   marked as boundary-erasing (raw client SQL replicas, unbounded
   caches, CRDT core) are rejected by 0127 §What this deliberately
   does not do and stay rejected here.
2. **Honest capability claims only.** LLP 0012's rule governs: no
   local execution means no local-first/parity claim (quoted by
   LLP 0043, whose proof rule — `Parity` only when every required
   proof is present — is this program's claim gate).
3. **Server-derived authority is not surrendered offline.** Settlement
   is authoritative server re-execution; a locally produced result is
   speculative and never presented as settlement; claims that depend
   on trusted time or server-minted identity degrade per the
   settle-time policy (decision 10, decided: server re-derivation
   default, owned by the settlement Spec) or are excluded from
   the locally executable set. Authoritative settlement, revocation
   delivery, global uniqueness, and trusted timestamps stay impossible
   offline (LLP 0126 approach 9, "What stays impossible").
4. **The ephemeral lane does not sync.** Presence is
   connection-scoped by definition; the pins stand (LLP 0107/0111),
   and 0127 proposes making it a named contract line via an LLP 0013
   amendment (0126 OQ8) — a proposal this Plan carries, not a decided
   change. Every phase below applies to the durable lane only.
5. **Claims scale with the execution-identity tuple's proven
   elements.** The tuple (LLP 0126 approach 9): (1) source/plan
   identity, (2) runtime/evaluator identity, (3) deterministic-tier
   semantics, (4) the host-call answer surface, (5) store semantics
   and schema epoch. Only element 1 is shipped in checkable form (the
   LLP 0118 implementation hash). A claim may assert exactly the
   elements its harness proves; "same code both sides" stays a
   testable hypothesis until the whole tuple is proven.
6. **Browser and desktop ladders stay independent.** Nothing on the
   desktop ladder waits on WASM; nothing on the browser ladder waits
   on the sidecar or the embedding ABI (LLP 0126 v0.4's restaging,
   preserved by 0127 move 3). A design that pretends one lane covers
   both platforms is wrong on day one.
7. **Owning documents stay owners.** This Plan owns program state —
   staging, the ledger, exit criteria, its open questions.
   Substantive design lands in the owners named per phase and per
   ledger row (or a new owned Spec), never here.

## Phases

Staging from LLP 0126/0127, confirmed by 0127 decision 2
(2026-07-30); the previously decision-gated markers are resolved in
place. The phase numbers order the resourcing (the confirmed
IR-rung-first staging puts Phase 1 before either ladder continues);
they are not a strict dependency chain beyond the gates named. Per
LLP 0130 SD-5, phases advance automatically when their named gates
pass; gate failure or scope change escalates.

**Phase 0 — Option A cache hardening on the first arm.** *Arm decided
(0127 decision 2): the JS/React browser arm, the
arm the diaries score and LLP 0074 names as the graduation path.*
Absorb the shipped LLP 0043 lanes into the scored arm: persist the
client cache by default via the shipped `rqsStore` seam; wire the
opt-in resume stores (LLP 0090's token path) into `@expo/snapback-client`
and the LLP 0114 hooks; wire M1 leases and the M2 outbox; mint
`clientMutationId` client-side against the existing settlement
ledger; carry the retention/replay claims under LLP 0043's
proof rule — which for this phase means **`Online`-class** claims, not
`Parity`: LLP 0043 pins "no local execution means no
local-first/parity claim," reports `Parity` "only for a
store-configured surface whose complete mutation set is locally
IR-derivable," and Phase 0 ships no local execution (v0.4 correction;
the earlier "`Parity` claims" wording was wrong on its face and is
withdrawn). `Parity` first becomes reachable at Phase 1, and only then
under exit criterion 3's ledger gate. Reach is bounded by design: protected opaque queries stay
non-retainable under LLP 0053's retainability invariant ("Retainable
⇒ declared authorization dependence ⇒ enumerated events"), so cold
retention comes to the declared/analyzable subset. The version-based
delta-resume consumer (designed in LLP 0008, unbuilt) is a named
prerequisite of this lane's minimum wire surface — LLP 0008/0090/0093
territory no rung skips. Owners: LLP 0043/0114/0090, wire in
0008/0093. *Evidence gate:* a diary-grade offline acceptance rerun on
the chosen arm (0126 option A's gate).

> **Phase 0 status (2026-07-31, wave-1 lane C5 — LANDED on main:
> `2a7bf058` client slice, `e416fb89` acceptance, `b53c28fd`
> guide/claims).** The option-A slice is implemented on
> `packages/snapback-client` and proven by a new diary-grade harness
> acceptance, `demos/public-dashboard/tests/acceptance/
> offline-local-first.mjs` (9 non-vacuous checks against the real
> server, registered in the workout inventory). **Evidence correction
> (2026-08-01):** that acceptance is a headless Node/file-store carrier; it
> does not run React, standards-real IndexedDB, or a browser-process restart.
> It proves the JS/Node-file slice, while the browser/React/IndexedDB claim
> remains a GAP tracked in
> `issues/20260801-guide-gap-js-arm-browser-indexeddb-proof.md`. Landed: (1) default
> `rqsStore` persistence — IndexedDB **plus Web Locks** (browser; the
> resolver requires both and degrades otherwise) / durable file (node) /
> in-memory fallback, resolution and durability reported on
> `client.rqsStoreInfo` (DK-9); (2) the LLP 0090 token path rides the
> default store, and a cold boot with a verified persisted entry now
> survives a connectivity-refused first subscribe (retained render,
> bounded-backoff re-entry) — the Diary 0027 Convex-GAP scenario; (3)
> the LLP 0043 M2 outbox on all three store arms with client-minted
> `clientMutationId` (protocol-lane identity, decision 10's carve-out)
> and ordered exactly-once replay after a completed fresh snapshot;
> the LLP 0090 D3 outbox rule is now enforced on *every* fresh
> subscribe, not only relaunch seeding; (4) the retainability boundary
> refused with clarity per LLP 0053 (`handle.retention` names the
> refusal; protected/opaque queries never silently act local-first);
> (5) arm-scoped guide claims: `sync.offline-js-arm` (maturity
> `partial`, gated on the acceptance at the reach the proof-scope
> correction below records) and `sync.offline-js-arm-protected`
> (explicit GAP). Environment honesty: with no local execution and no
> id-bearing optimistic derivation on this arm, a queued intent
> usually captures no `{generatedIds}` ledger; a caller-supplied
> `ctxLedger` is transmitted verbatim per the 0008 accept pin, and
> the captured enqueue wall-clock is retained as a labeled claim,
> never authority. Remainders, ticketed in
> `issues/20260731-js-arm-lease-custody-and-sessions-outbox.md`:
> M1 lease custody on this arm (exit criterion 2's
> `auth.authorized-leases` half is therefore still open) and the
> sessions-custody queue leg (the JS-arm outbox covers
> dev/external-bearer custody; session-fenced clients defer to the
> Contract arm). **Gate disposition — restated v0.4 to remove a
> contradiction both round-2 reviewers caught (the block previously
> read both "is CLEARED" and "NOT CLEARED").** The single disposition
> that now stands: Phase 0's *implementation lane* LANDED on main with
> its named acceptance green (9/9) and registered in the workout
> inventory, but **Phase 0's evidence gate is NOT met and Phase 0 has
> not exited.** The gate is "a diary-grade offline acceptance rerun on
> **the chosen arm**," and the chosen arm is the JS/**React browser**
> arm (decision 2); the retained run is Node/file/headless over public
> queries, so it does not discharge the gate as written. Two further
> gaps in the same direction: exit criterion 1 asks for an
> *authenticated* shell and *authorized* rows after restart, and this
> acceptance proves neither; and M1 lease custody, a named Phase 0
> deliverable, is ticketed rather than shipped. No later decision may
> cite this Node run as React/IndexedDB restart evidence, and SD-5's
> self-advancing rule does not fire, because its precondition (gate
> success) has not occurred.
>
> Consequences, stated rather than implied. (a) Phase 1 is **not**
> advanced by Phase 0. Under §Phases' standing rule the phase numbers
> order resourcing and "are not a strict dependency chain beyond the
> gates named," so Phase 1 may be started independently — but that is
> the non-dependency rule doing the work, not a Phase 0 exit, and
> Phase 1's own preconditions (the IR-evaluator sizing spike) stand
> either way. (b) Whether to split the Phase 0 gate into a landed
> Node/file/public half and an open browser/React/authorized half, or
> to hold the whole gate open until the browser witness lands, is an
> **author disposition** this Plan does not make for itself; §Open
> questions 7 records it. (c) §Open questions 5's pre-start
> owner/timebox requirement was not satisfied for Phase 0 before it
> started; that is recorded here as a fact, and any retrospective
> exception is likewise the author's to date and record.
>
> **Proof-scope correction (2026-08-01, v0.4 — super-refine round 1,
> Codex concern 2; verified against the tree before recording).** The
> claims above must be read at exactly the acceptance's reach, per
> constraint 2 and exit criterion 4. What the named suite actually
> proves: the **node/durable-file** store arm (it sets
> `SNAPBACK_CLIENT_RQS_DIR` and asserts
> `rqsStoreInfo.implementation === 'file'`), against a headless
> client, for **public `rqsEligible`** queries; its one refusal check
> is a non-eligible public query
> (`SNAPBACK_RETENTION_NOT_RQS_ELIGIBLE`). Three things item (1),
> item (4), and the `sync.offline-js-arm` guide row could be read to
> claim are **not** proven by it: (a) the browser IndexedDB arm —
> implemented and covered by `fake-indexeddb` unit tests
> (`packages/snapback-client/rqs-store.test.mjs`,
> `rqs-resume.test.mjs`, `outbox-store.test.mjs`), never by a
> standards-real browser, which is exactly the carrier class LLP 0138
> recorded as its own evidence GAP; (b) the LLP 0114 React surface —
> **updated at landing, 2026-08-01:** a concurrent session landed
> `packages/snapback-react/offline.test.mjs`, which does exercise the
> hook's `freshness`/`retention` axis, so the round-1 finding that *no*
> React test touched retention is superseded. What remains unproven is
> narrower and still real: that test drives a **stub transport**, not a
> real server and not a browser, so the React surface is covered at the
> binding level only — no standards-real IndexedDB, no browser-process
> restart, no end-to-end React path; (c) the **protected/auth-scoped**
> refusal —
> `SNAPBACK_RETENTION_NOT_RETAINABLE` is produced in
> `packages/snapback-client/index.mjs` and asserted by no test —
> which means the browser witness cannot merely avoid "borrowing the
> Node result" for that fact; there is no Node result to borrow. The
> guide row is narrowed to match in the same landing and all three
> gaps are ticketed in
> `issues/20260801-guide-gap-js-arm-browser-indexeddb-proof.md`.
> **"Cold boot" is the wrong word for what runs (v0.6, round 4).** The
> suite disposes the handle, calls `closeClient(clientA)`, stops the
> server, and constructs `clientB` — **in the same Node process**. That
> proves fresh client and store *instances* reading persisted bytes with
> the backend unreachable, which is real and is the Diary 0027
> comparator's shape, but it is **not** a client-process restart.
> Exit criterion 1 asks for a full process/browser restart, so that
> element is unproven at *any* carrier today, not merely at the browser
> carrier. Wherever this block says "cold boot" or "cold relaunch,"
> read: same-process client/store re-instantiation against a durable
> file store. A real witness needs either a client subprocess with hard
> termination or the browser-carrier harness the ticket describes.
>
> Consequence for criterion 1 (restated v0.7 — v0.6 still said "the
> cold-boot beat is claimed at file-store/headless reach," which
> re-asserted three lines later exactly the claim the paragraph above
> withdraws): **the cold-boot beat is not claimed at any reach.** No
> full client-process restart has been proven on any carrier, and
> criterion 1 additionally wants an authenticated shell and authorized
> rows, which this suite does not exercise either. What is claimed is
> narrower and true: retained render from a durable file store, by a
> fresh client instance in the same process, with the backend
> unreachable. The integrated witness exit criterion 2 names is what
> would establish the beat. A
> third ticketed remainder, recorded here for completeness: the
> lease-custody ticket also carries unbounded per-origin
> default-store blob accumulation.

> **Gate split + owner/timebox (2026-08-07, Charlie Cheever — author
> gate packet items 1 and 2).** The §Open questions 7 split disposition
> now extends: the Node/file/public half **and** the browser/public
> half are recorded landed (browser public witness `5ef7950c3`, 8/8
> legs in real Chrome against the real runtime; the Node/file evidence
> is the acceptance cited above), and the authenticated/authorized
> conjunction half remains the phase's open remainder, gated on M1
> lease custody. The remainder is owned by the standing orchestration
> lane (Charlie Cheever as deciding author, executing through the
> orchestrated fleet lane under session supervision), with its evidence
> presented to the author by **2026-08-14** — see the dated ruling at
> §Open questions 5.

**Phase 1 — The shared IR rung.** *Staging confirmed by decision 2;
IR-rung-first resourcing puts this phase before either ladder
continues.* The LLP 0051 D2 mutation-IR evaluator as the local
execution tier — browser-safe, already designed, deriving optimistic
overlays from host plans and earning honest `Parity` for IR-complete
surfaces under the rule LLP 0043 already enforces. Its determinism
conformance gate is LLP 0051 D5's corpus (replay cases, IR profile
cases, enumerated rejections, one shared data-tier version); no IR
`Parity` claim ships before the evaluator passes it. `Parity`-by-
construction claims additionally gate on the owner-landing ledger —
decision 10's decided policy, landing as the settlement Spec, is the
first design this phase's claims hit.
Owners: LLP 0051 (IR, ctx ledger, conformance), LLP 0043 (claim
rule). *Evidence gate:* the IR-evaluator sizing spike (0126 finding
11: nothing is measured) plus the D5 corpus passing on both sides.

> **This phase's gate is escalated to the author under SD-5's own
> scope-change clause, pending §Open questions 8 (v0.6; reframed v0.7
> — the v0.6 wording said this Plan "SUSPENDS" SD-5, which would be
> this Plan amending a rule LLP 0130 owns, in violation of its own
> constraint 7. It does not. SD-5 escalates on gate failure *or scope
> change*, and discovering that the named gate does not cover the
> phase's promised scope is exactly a scope change; this Plan is
> invoking that clause, not rewriting it. If the author prefers the
> rule itself to change, that lands as a dated LLP 0130 amendment,
> which only the author can make.)** Round 4 found a reachable
> premature-advance
> path: SD-5 advances a phase when its named gate passes, this phase's
> named gate is sizing + D5, and OQ8 records that sizing + D5 omit the
> settlement/id-mapping, partial-read admission, schema/identity
> fencing, receipt projection, browser store/outbox, and React
> presentation that the phase's own promised end-to-end behavior needs.
> Blocking only the decision lab on OQ8 was not enough — Phase 1 could
> still self-advance on an evaluator-only gate. Until the author
> answers OQ8 (one gate or two, and which one SD-5 keys off), Phase 1
> does not auto-advance; while that scope-change escalation is pending, a passing gate is
> presented to the author rather than auto-advancing (phrased this way in
> v0.8 so the clause cannot be quoted against SD-5's own "gate success does
> not escalate" — the escalating event is the standing scope change, not the
> gate passing). This suspends an advancement rule, never a claim rule:
> exit criterion 3 and the owner-landing ledger already bar the
> `Parity` claim independently.

**Phase 2a — Browser ladder.** WASM handler artifacts (LLP 0051 D3)
for logic past the IR; full-runtime WASM only behind its named
assessment (0126 OQ5 — size, performance, feasibility are unassessed;
LLP 0051 §Rejected refuses shipping a JS engine to clients for
Parity). Store side rides the proven wa-sqlite/IndexedDB lane
(LLP 0008 DK-9). *Evidence gate:* the WASM assessment, dated, before
the browser story is pinned.

> **Dated WASM assessment — 2026-08-05.** The retained evidence artifact is
> [`tests/acceptance/fixtures/browser-lane/wasm-assessment.2026-08-05.v1.md`](../tests/acceptance/fixtures/browser-lane/wasm-assessment.2026-08-05.v1.md),
> with its reproducible pure-Rust evaluator size witness beside it. The frozen
> LLP 0051 durable-mutation corpus is 12/13 (92.3%) semantically expressible by
> the shipped complete browser IR evaluator; only all-aboard
> `applyLiveFeedSnapshot` requires general data-dependent control flow. The
> current local-admission wrapper is narrower, so this is not a 12/13 shipping
> claim. Measured payload anchors are 21,295 minified / 7,615 gzip / 6,739
> Brotli bytes for the shipped JS evaluator and 306,890 raw / 117,353 gzip /
> 95,830 Brotli for the bounded Rust evaluator WASM PoC. No full-runtime WASM
> exists; its 5–15 MiB raw / 2–6 MiB gzip range is a labeled planning estimate,
> and no latency number is fabricated. Full Hermes-in-WASM remains contrary to
> LLP 0051 §Rejected. Recommendation: pin the browser to IR-only, defer WASM,
> and reopen only for a named, product-critical IR-negative handler after a
> bounded extension review. This dated finding satisfies the named assessment
> gate; it neither builds a runtime nor settles OQ9's author-owned
> assessment-versus-implementation exit choice.

> **Browser-IR coverage gate — first run, 2026-08-06 (base commit
> e99d2a328).** The OQ9-designated gate ran end to end:
> `tests/acceptance/browser-ir-coverage-v1.mjs` verified the D5 corpus
> manifest (37/37 SHA-256 exact, drift refuses typed), esbuild-bundled the
> shipping `@expo/snapback-client/ir-evaluator` closure, and replayed every
> case in real system Chrome 151.0.7922.76, with each normalized outcome
> persisted to and read back from IndexedDB before comparison. Results:
> **exact-D5 component 37/37 PASS**, browser-vs-Node byte-identical
> normalized outcomes, manifest-digest-chained to the Phase-1 Rust receipt
> (Option B condition 3 on both evaluators); **semantic IR coverage
> 12/13 = 92.3% PASS ≥90%**, carried from the pinned dated assessment
> classification of the frozen corpus; **100%-common-path execution
> component INDETERMINATE** — no frozen designated-browser-common-path
> mutation set exists (Option B locates that designation act in
> `handler-coverage.v1.json`, which was never created), so measuring it
> would mean inventing the author's designation; the plan-shape M1
> admission counts over the corpus (22 ready / 10 refused / 5 server-only)
> are retained in the receipt as evidence only. Receipt and write-up:
> `tests/acceptance/fixtures/browser-lane/browser-ir-coverage.2026-08-06.v1.{json,md}`;
> the designation gap is ticketed at
> `issues/20260806-phase2a-common-path-designation-absent.md`. **No gate
> PASS, phase exit, or advancement is declared**; per this Plan's standing
> rule the evidence is recorded here for author presentation.

> **Owner/timebox (2026-08-07, Charlie Cheever — author gate packet
> item 2).** Phase 2a's disposition is owned by the standing
> orchestration lane (Charlie Cheever as deciding author, executing
> through the orchestrated fleet lane under session supervision), with
> the disposition presented to the author by **2026-08-14**; see the
> dated ruling at §Open questions 5. The common-path designation itself
> was **delegated by the author to the orchestrating agent** at the
> same sitting (packet item 3); the frozen designation and the gate
> rerun against it land as their own dated note here when executed.

> **Designation frozen + gate rerun — 2026-08-07.** The delegated
> designation act is executed:
> `tests/acceptance/fixtures/browser-lane/handler-coverage.v1.json`
> freezes the 12-case designated browser-common-path set over the
> pinned D5 corpus (field toggle, patch incl. missing-row softness,
> single-row delete, guarded read, six expression-semantics cases, and
> the two argument-validation refusals; every remaining corpus case is
> excluded with a recorded reason — creates are server-owned per
> decision 10 with optimistic creation deliberately Move-4-deferred,
> auth-guarded writes because prediction is never authority (LLP 0155
> P4), batch/fanout/multi-step power paths behind deliberate effect
> ceilings, and bounds/semantic-depth cases covered by the 90% axis).
> The author's delegation is recorded verbatim in the artifact's
> provenance. The gate is now fully measurable and the runner reran
> against the frozen designation in real Chrome 151.0.7922.76:
> **semantic 12/13 = 92.3% PASS; exact-D5 37/37 PASS; common-path
> 11/12 FAIL — whole gate FAIL** with one named gap:
> `todo-v2-delete-todo` (inspected before freezing: a plain single-row
> `Delete` by arg id) is refused by the M1 admission ceiling
> (`SNAPBACK_PLAN_EFFECT_CEILING`). Nothing was tuned; the gap is the
> gate doing its job and is ticketed at
> `issues/20260807-single-row-delete-effect-ceiling.md`. Receipt:
> `tests/acceptance/fixtures/browser-lane/browser-ir-coverage.2026-08-07.v2.{json,md}`.
> Phase disposition: owned by the standing orchestration lane,
> presented to the author by **2026-08-14** (the 2026-08-07
> owner/timebox ruling above); no exit or advancement is declared.

> **Single-row Delete admitted + gate rerun — author ruling,
> 2026-08-07 (Charlie Cheever).** The author ruled on the ticketed gap:
> single-row `Delete` is **admitted** into the M1 local evaluator verb
> set. The admitted shape is exactly the designated
> `todo-v2-delete-todo` form — a plan whose steps include at most one
> `Delete` step addressing one row by id (`ChangedCount` semantics; a
> missing row is the Rust host's soft no-op). Filtered, batch, and
> fanout deletes (`DeleteWhere`, `InsertEach`, multi-`Delete` plans)
> remain refused with `SNAPBACK_PLAN_EFFECT_CEILING`: the ruling widens
> the verb set by one narrow shape, not the effect ceiling generally.
> The `snapback.browser-ir.insert-get-guard-patch.v1` effect-class
> string is kept stable and widened in place; codegen still classifies
> delete handlers `server-only`, so generated-carrier emission is a
> named follow-up in the closed ticket. The rung-2 sizing write-up's
> deliberately-unwidened recommendation is superseded on this point by
> a dated addendum in that artifact. Gate rerun against the UNCHANGED
> frozen designation and corpus: **semantic 12/13 = 92.3% PASS
> (carried — the audited miss is all-aboard `applyLiveFeedSnapshot`,
> not delete); exact-D5 37/37 PASS; common-path 12/12 PASS — whole
> gate PASS.** Receipt:
> `tests/acceptance/fixtures/browser-lane/browser-ir-coverage.2026-08-07.v3.{json,md}`,
> superseding the v2 11/12 measurement; resolution recorded in
> `issues/closed/20260807-single-row-delete-effect-ceiling.md`.
> Disposition remains author-presented (2026-08-14 timebox); **no
> phase exit or advancement is declared here.**

**Phase 2b — Desktop ladder (independent of 2a).** First the sidecar:
the packaged native runtime spawned next to the app, carrying
0127 move 5's sealed, attested artifact (LLP 0123) — process
lifecycle, IPC, port custody, and updater-driven swap against a
client-custodied outbox (exactly LLP 0081's quarantine seam) are the
named costs. Then in-process embedding behind a stable ABI that does
not exist today, behind its own spike. *Evidence gate:* a working
sidecar behind an acceptance suite; the in-process spike before any
embedding claim.

**Mobile — after the OQ10 spike, not a phase.** Hermes is proven on
mobile as React Native's engine, but the Rust host, suspension,
store-policy fit, battery budget, and at-rest custody are unassessed.
A dated spike with named success criteria precedes any mobile
plausibility claim; until it runs, mobile is a question, not a lane
(0126 OQ10).

**Option F rider — explicit-sync backup/export/restore.** Carried
where 0127 §Sequencing 5 put it: a proposed cheap rider on this Plan,
packaging properties that are already true (a locally run Snapback is
a full-authority local app), evidence-positive and foreclosing
nothing. "Near-zero" stays a hypothesis until the surface is sized
(0126 option F). It is single-authority, never marketed as sync.
*Evidence gate:* a paved backup/restore walkthrough proven by an
acceptance script.

Option C (Replicache-class app-authored client mutators) is **not a
phase**, and decision 2 (2026-07-30) decided its posture: option C is
NOT admitted — same-by-convention dual implementations are the drift
the content address exists to remove — and it is held behind a named
trigger: admit only if the IR rung proves insufficient for
browser-side write expressiveness after measurement. This Plan
schedules no product phase for it. The decision-grade lab in §Option-C
empirical decision protocol is the only conditional work, and it cannot start
until that section's prerequisites and §Open questions 5's owner/timebox rule
are satisfied. §Open questions 4 records the trigger wording.

## The owner-landing ledger

LLP 0126 approach 9 names five unowned designs; 0127 move 3 binds
them to the program's exit: **no `Parity`-by-construction claim ships
before each design lands in an owning document.** The ledger below
carries those five plus two program prerequisites that are owned or
designed but unbuilt. Proposed owners are proposals (constraint 7).

1. **Settle-time trust policy** for client-captured `now`/ids under
   local execution (0126 OQ3 posed accept/clamp/flag). **DECIDED
   (v0.2, 0127 decision 10):** server re-derivation is the default at
   settlement; client-captured values are carried in receipts as
   labeled claims, never authority; bounded-skew acceptance only as a
   per-field declared opt-in. Owner: a **new settlement Spec** under
   this program — of 0126 OQ3's candidate owners, the
   new-owned-Spec branch — and the program's first owned-Spec
   deliverable. Still first among these: the first design the program
   hits once Phase 0 lands; the row un-gates when the Spec lands.
   **LANDED (2026-07-31): LLP 0133 ("Local settlement") is that
   Spec**, Accepted under LLP 0130 SD-4 after a dual-family loop; it
   pins the lane Q (shipped 0008 accept pin) / lane L (re-derivation
   default) split below, the (mint site, occurrence) logical mint
   identity, labeled-claim receipts, and bounded-skew as a per-field
   declared opt-in inert in lane Q. This row is UN-GATED.
   **IMPLEMENTED SUBSTRATE (2026-08-02):** LLP 0133's buildable-now
   six-ticket program is landed. Synthetic lane-L submissions exercise the
   full server settlement path; receipts carry the lane/private evidence with
   fan-out redaction; identity collisions fail closed before freshness;
   logical mint maps never guess across sites/counts; bounded skew is
   structurally admitted and capability-scoped; and the client store/outbox
   performs delivery bridging, exact-leaf rewrite, submission fencing, and
   terminal cascade. Acceptance sketches 1–4 and 7–10 are executable. This is
   an implementation state for row 1's substrate only: local capture/execution
   and speculative receipts (sketch 5) remain LLP 0155 Stage 2 / LLP 0051
   work, identity-mismatch disposition (sketch 6) remains with rows 3/5's
   owners, and rows 2–5 still bar any `Parity`-by-construction claim.
   **Domain and lane scoping (v0.3; verified against LLP 0008
   §Replay environment contract, 2026-07-31).** (a) Decision 10
   governs *application-visible* values: client-captured time and
   ids that enter durable application state — the `generatedIds`/
   `now` class of LLP 0008's replay environment. (b) The
   client-minted `clientMutationId` Phase 0 requires is a
   *protocol-lane* idempotency/correlation key, not an application
   value; decision 10 does not govern it, and there is no collision
   with Phase 0's minting. The settlement Spec pins the two domains
   separately. (c) Lane scoping: LLP 0008's shipped pin — the wire
   transmits `{generatedIds, now}` and the server accepts them on
   replay, because "divergent ids or timestamps between the
   optimistic run and the server run would corrupt data" — **stands
   for its lane**. Phase 0's M2 queued-intent replay lane ships
   under the shipped 0008 accept pin; the settlement Spec governs
   the local-execution lanes (Phase 1 on), where re-derivation is
   the default — stricter than accept, so no boundary weakens under
   either policy. Two lanes, two policies, both labeled in receipts;
   if the settlement Spec ever proposes revisiting 0008's pin, that
   change lands as a dated LLP 0008 amendment, named there.
2. **Partial-replica read satisfiability.** A handler is locally
   executable only if its reads are provably satisfiable from the
   retained subset; table-granular JS-tier declarations cannot prove
   it. 0127 move 6 proposes the bounded-profile grammar
   (LLP 0080/0110) as the admission artifact — 0127's answer to 0126
   OQ4, which poses it as a question; the design pass lands in the
   move 6 owners. **OWNER ASSIGNED (2026-08-07, author gate packet
   item 7): retained in this Plan (LLP 0129), with the standing
   orchestration lane as implementer.** The row stays here rather than
   moving to a proposed owner; it remains a bar on any
   `Parity`-by-construction claim until it lands.
3. **Schema-at-capture versus schema-at-settle skew.** A mutation
   executed locally against schema S1 and settled after migration to
   S2; the content hash does not name a schema era (tuple element 5
   exists precisely because of this). LLP 0081 — owner of the shipped
   quarantine/resync-before-replay seam for queued intent — is 0127's
   *proposed* home for the capture policy, explicitly proposed, not
   settled. **OWNER ASSIGNED (2026-08-07, author gate packet item 7):
   LLP 0081 accepts ownership** (dated acceptance note in LLP 0081's
   header); the proposal above is settled. The row remains a bar on any
   `Parity`-by-construction claim until the capture policy lands there.
4. **Speculative/settlement receipt shapes.** Speculative receipts
   carry content address plus captured environment; settlement
   receipts bind them to the authoritative commit version (receipts
   already carry `snapshotVersion`); a locally executed result is
   never presented as settlement. Proposed owners: LLP 0043/0034/0093.
   **OWNER ASSIGNED (2026-08-07, author gate packet item 7): LLP 0043
   accepts ownership** of the receipt-projection design (dated
   acceptance note in LLP 0043's header); 0034/0093 remain
   collaborators, not owners. The row remains a bar on any
   `Parity`-by-construction claim until the receipt shapes land there.
5. **The execution-identity tuple itself** as an owned, versioned
   artifact. Proposed owners: LLP 0051 for the semantics elements
   (D5's conformance-corpus version pins element 3; D1's ctx-answer
   ledger is element 4's channel), with LLP 0123's binary+Hermes
   digest attestation seeding element 2.
6. **Revocation-while-offline under the lease bound** (owned;
   inherited, listed to keep the inheritance visible). The shipped
   contract is the strictest surveyed: server-MACed `AuthorizedLease`,
   24-hour hard maximum, equality-is-expiry, deletion-before-render,
   renewal only by fresh full revalidation (LLP 0043 M1; LLP 0053
   §The lease, including the ENG-24992 verification-locus amendment —
   the client trusts retained server-issued facts and cannot verify
   the MAC offline). Fail-closed disconnected means retained data
   expires to deletion; the local-execution lane inherits this
   contract unchanged and must not widen it. What lands: dated
   confirmations in 0043/0053 that locally executed results render
   only under lease-valid retained state.
7. **The version-based delta-resume consumer** (designed in LLP 0008
   §Retention and Resume). **Status re-scoped 2026-08-01 (v0.7) — the
   flat "unbuilt … no client caller" wording was stale, and both
   round-5 reviewers caught it.** What ships: LLP 0090's token-resume
   ladder, which LLP 0008 itself names as this consumer's widening —
   the client sends `resumeFromToken` and consumes the rung answers,
   and `journal_resume_requires_resnapshot` has a server-side caller
   (`crates/snapback/src/local.rs`). What this row still tracks, at its honest reach:
   the LLP 0008 **journal-delta** path specifically, and the exact
   `rqsEligible`/`mset1` boundary of what the shipped ladder covers.
   That boundary has not been verified end to end by this loop, so the
   row stays open pending a **dated verification note against the wire
   path** rather than being marked landed on a reviewer's reading or
   this Plan's. LLP 0127 carries the same stale "unbuilt" assertion and
   needs the same reconciliation. Owners LLP 0008/0090/0093. LLP 0090's
   outbox rule stands: a non-empty outbox never resumes — full resync,
   then replay.

## Exit criteria

Falsifiable, per the program. A phase that cannot state its criterion
in this form does not exit.

1. **The cold-boot beat.** In the successor rerun's offline-scored
   dimension, the scored browser arm — after a full process/browser
   restart with the backend unreachable — renders the authenticated
   application shell and retained authorized rows for its retainable
   queries: the scenario where Diary 0027 recorded Convex's "no
   authenticated application shell and zero retained query rows."
   Falsified if the successor diary records the same GAP-row family
   (cold retained boot, restart-safe queue, reconnect settlement) for
   the Snapback arm. Scope honesty: claimed for the retainable subset
   only; protected opaque queries stay out by design (LLP 0053).
2. **Arm claim parity.** The retention/replay claims on the JS/React
   arm match the Contract arm's. **The literal terminal row set
   (named v0.4, because v0.3 named the Contract-arm rows and then
   switched to JS-specific ones, leaving no executable target):** this
   criterion is met when `sync.offline-js-arm` reports `shipped`,
   `sync.offline-js-arm-protected` reports `shipped`, and
   `auth.authorized-leases` carries a JS-arm row reporting `shipped` —
   all three on the local target under exactly LLP 0043's proof rule.
   Structural deliverable, named in v0.3 and **partly landed
   (restated v0.4)**: `guide/capabilities.md` now carries the
   arm-scoped rows `sync.offline-js-arm` (maturity **`partial`** — the
   narrowed reach recorded in the Phase 0 proof-scope correction; the
   Plan and the row use the same word by v0.4, having disagreed in
   v0.4's first draft) and
   `sync.offline-js-arm-protected` (explicit GAP), so the per-arm row
   structure exists for the retention half. The exact remaining
   closure: `auth.authorized-leases` is still one arm-agnostic row
   with no JS-arm split; `sync.offline-js-arm`'s reach must widen
   from the same-process/file-store/public-query slice its acceptance
   proves to the browser-IndexedDB, React-surface,
   protected-refusal, and **full client-process restart** coverage this
   criterion reads; **LLP 0043 M1 lease custody must actually be
   implemented on this arm** and `sync.offline-js-arm-protected`
   promoted off its GAP row (v0.6 — the v0.4 closure list named neither,
   though the Phase 0 status says M1 is unshipped, so a reader could
   have thought two ticket closures sufficed); and **one integrated
   witness** must cover the authenticated React/browser/full-process
   -restart scenario together, because the two existing tickets can each
   close without ever proving criterion 1's conjunction — the browser
   ticket proves a public React/IndexedDB restart plus protected
   refusal, the lease ticket permits a headless witness, and neither
   requires authenticated shell **and** authorized rows **and** a real
   process restart in one run. That integrated witness is now ticketed
   (v0.8):
   `issues/20260801-js-arm-integrated-authenticated-restart-witness.md`.
   Whether it is a conjunct of the SD-5 Phase 0 gate, of the Phase 0
   exit criteria, or both follows from §Open questions 7; until that is
   answered, a public-browser-only witness must not be treated as
   advancing the phase. All of it lands under
   LLP 0061's guide conventions with LLP 0043's proof rule as the
   row-level gate; the criterion is executable per-row as each row's
   proof set exists. Falsified by any claim row on the
   JS arm lacking the Contract arm's proof set (durable store,
   complete retained identity, local IR-derivability where `Parity`
   is claimed) — including a row whose stated reach exceeds the
   acceptance that gates it.
3. **Tuple harness before any same-code claim.** Before the program
   asserts "same code both sides" anywhere, each execution-identity
   element has a per-element test harness: hash equality (element 1),
   attestation checks (element 2), the D5 conformance corpus passing
   on both executors (element 3), ledger record/replay (element 4),
   and, for element 5, **conformance on both executions plus mismatch
   refusal/quarantine/resync tests** (raised in v0.8; the v0.3 wording asked
   only for "an activation-carry check in the settlement submission," and
   carriage proves neither store-semantic compatibility nor safe behavior on a
   schema/artifact mismatch — LLP 0133 is explicit that the activation travels
   as an untrusted claim, that mismatch must be detectable, and that silently
   settling as matched is forbidden). **Normative consequence, stated plainly:
   criterion 3 cannot pass today and no same-code or `Parity`-by-construction
   claim may ship**, because element 5 has no owner for its store-semantics
   profile and mismatch disposition — §Open questions 11 routes that to the
   author, and safety gate 5 makes the same closure a decision-lab
   prerequisite, so the lab's prerequisite list is complete only once OQ11 is
   answered alongside OQ8. Falsified by a same-code claim shipped with any
   element untested.
4. **Claims equal acceptance.** Every phase's capability claims match
   exactly what its acceptance proves — no phase ships a manifest or
   guide claim its acceptance suite does not exercise. Falsified by
   any claim/acceptance mismatch found in review or rerun.

Criterion 1 binds to the JS/React browser arm (decision 2, decided
2026-07-30). Criterion 3's gate is the full ledger, restated in v0.3
against a misreadable v0.2 sentence: **all five unowned designs
(ledger rows 1–5) must land in owning documents before any
`Parity`-by-construction claim ships** — row 1's settlement Spec is
merely the first of them, and decision 10 being decided changes that
row's content, not the gate's breadth. Neither criterion weakened in
the resolution — only the binding was fixed.

**Which criteria bind which phases, and what "program complete"
means (v0.3).** Criteria 1 and 2 are Phase 0's exit: they bind the
Phase 0 arm and can pass with every later phase unexecuted — so
**Phase 0's exit is not program completion**. Criterion 3 binds
every phase from Phase 1 on that ships a same-code or
`Parity`-by-construction claim; it is vacuous only while no such
claim ships, and Phase 1's IR `Parity` claims make it live.
Criterion 4 binds every phase and the Option F rider. The program
is **complete** when all authorized phases — 0, 1, 2a, and 2b —
have executed with their named evidence gates passed and their
binding criteria met, and the Option F rider's disposition is
stated: either landed behind its acceptance-script gate or declined
by a dated note in this Plan, **plus** retained artifacts for the four
mandatory measurements §Measurement binds. The mobile spike and the
Option-C decision lab sit outside the
completion boundary by construction (questions, not lanes; their
dispositions are OQ-grade, not phase-grade). A phase the program
abandons rather than executes exits only by a dated author decision
recorded here, naming successor authority if the scope moves.

**Completion is currently unreachable, and that is a fact rather than
an oversight (v0.5).** Two of this section's own rules collide: a phase
that cannot state its exit criterion in falsifiable form does not exit,
and completion requires Phase 2a to have executed with its gate passed
— but Phase 2a's gate is "the WASM assessment, dated," which names no
pass/fail condition and no artifact. Both rules stand; the consequence
is that **program completion cannot be declared until §Open questions 9
is answered**, either by giving Phase 2a a falsifiable
artifact/threshold exit or by reclassifying it as conditional research
outside this boundary. The Plan will not pick for the author, and it
will not paper over the collision by quietly relaxing the
falsifiability rule.

## Measurement

The program's measurement is **the offline/cold-boot dimension of the
successor rerun** — the scenario dimension 0127 §Sequencing 6
proposes adding to the existing arms, cross-gated with LLP 0115
§Sequencing 5's rerun checkpoint. Composition, restated in v0.3
(v0.2's "one rerun serves both programs" silently decided it): rerun
composition — the contracts, the dimensions, whether this program's
offline scoring folds into the matrix rerun — is LLP 0115 open
question 4's adjudication. **Answered (2026-07-31): LLP 0130 SD-3
adjudicates 0115 OQ4** — the seven contracts run unchanged, the
React-surface measurement is included, and this program's offline
dimension folds into the same shared rerun, as this Plan proposed.
This program's diary-grade offline acceptance and the measurements
below remain independently mandatory, and the two programs' exits
stay separate either way. Two preconditions travel from 0127
§Measurement: Phase 0's diary-grade offline acceptance on the chosen
arm, and the normalized-profile burst benchmark before any
performance claim (0125 option 5 — its numbers are stale and
machine-confounded).

The named empirical questions from LLP 0126 this program must answer
(finding 11: nothing in the local-first corpus is measured today):

- the IR-evaluator sizing spike (Phase 1's gate);
- client-store footprint and replica-hydration cost;
- local-execution latency against settlement latency;
- the WASM assessment — size, performance, feasibility (0126 OQ5,
  Phase 2a's gate);
- the mobile spike with named success criteria (0126 OQ10);
- resume-storm behavior at reconnect scale (0126 §Hosted topology);
- the Option-C decision lab (§Option-C empirical decision protocol) —
  the program's second-largest planned measurement by scope, behind the
  successor rerun,
  and the only one whose output is a decision recommendation rather
  than a number. **The successor rerun is not a prerequisite for it**
  (v0.4 clarification: "after the successor rerun" ranks size, not
  sequence); §When the lab can run states the prerequisites
  exhaustively **as of this revision** — §Open questions 8's resolution
  may extend them, and the same dated revision that answers it updates
  that list.

Two of the entries above are **conditional research, not completion
requirements** (v0.4, reconciling this list against §Exit criteria's
completion boundary, which excludes both): the mobile spike and the
Option-C decision lab. Both stay listed here because they are the
program's named empirical questions; neither gates program completion.

**"Must answer" now binds (v0.5).** The other four — client-store
footprint and replica-hydration cost, local-execution latency against
settlement latency, the WASM assessment, and resume-storm behavior at
reconnect scale — were called mandatory while nothing in §Exit
criteria's completion boundary named them, so the program could have
declared itself complete without answering them. Each is hereby bound:
the WASM assessment is Phase 2a's gate; the store-footprint and
latency measurements are Phase 1's deliverables alongside its gate;
resume-storm behavior binds Phase 2a. Each needs a named artifact and
a target, and program completion additionally requires that all four
have retained artifacts. Whether each also needs a pass/fail threshold
rather than a recorded number is part of §Open questions 9's
falsifiability question.

## Option-C empirical decision protocol

This section turns open question 4's trigger into a pre-registered experiment.
It does **not** admit Option C or detect the OQ4 trigger. LLP 0138's synthesis
requested this reconsideration and phrased its own evidence as one that
"appears to satisfy LLP 0129's condition for reconsidering" client mutators;
**this section is that request's answer, and it supersedes that phrasing** —
the condition for *reconsidering* is met, the OQ4 trigger is not detected, and
nothing about admission follows (v0.5, after both round-3 reviewers flagged
the summary sentence as citable out of context). The 2026-08-01
Snapback/Zero/Replicache bakeoff (LLP 0138) detected credible browser-write
expressiveness pressure: Kanban's move duplicated one transformation,
Calendar's server-ID optimistic create needed an application-local pending
sidecar, and Notebook — **by declared GAP and source audit, not by an executed
run** (v0.6 precision fix: `fn.stretch-offline-restart` and
`fn.stretch-concurrent-rebase` are immediate `suite.gap(...)` declarations; the
**Snapback arm's** run never restarted the pending client or introduced a
concurrent remote edit, though the React source genuinely lacks both surfaces.
Scope matters here, corrected v0.8: the **Replicache control** *did* introduce
a concurrent remote edit and executed its rebase as a PASS, so this is a claim
about the Snapback arm, not about the bakeoff as a whole) — neither
reconstructed speculative UI after restart nor
exposed a typed semantic-conflict surface. That evidence is sufficient to
specify the decision lab. It does not prove standards-real-browser restart
failure. The trigger itself remains undetected until Candidate A runs against
the frozen facts and meets §Trigger detection and recommendation rule.

The question is deliberately narrow:

> Can the shared mutation-IR rung, possibly with constrained typed extension
> points that preserve one authoritative operation, express the browser-local
> write experiences Snapback needs? If not, does a Replicache-class
> app-authored client mutator solve the missing cases without weakening server
> authority, replay, revocation, or execution identity enough to justify its
> drift surface?

### Candidate outcomes

The lab records exactly one of **four** states: the three recommendations
below, or **Outcome 0 — no recommendation** (defined in §Trigger detection and
recommendation rule, for the states where none of 1–3 is justified). Only the
author can adopt a recommendation.

1. **IR sufficient — Option C remains not admitted.** The mutation IR derives
   useful optimistic and offline behavior for every frozen workload without
   application-authored duplicate mutation semantics.
2. **IR plus constrained typed extensions — Option C remains not admitted.**
   The IR remains the operation authority, but the public surface gains only
   narrowly typed mechanisms proven necessary by the lab, such as provisional
   identity presentation, settlement mapping, or application-defined conflict
   rendering. An extension cannot write arbitrary local rows, override server
   settlement, or replace the IR operation.
3. **Recommend bounded Option-C admission.** (The heading names the
   lab's act, which is a recommendation; only the author admits — ER-1.)
   At least one required
   workload is inexpressible through both the IR and constrained extensions,
   while an app-authored client mutator passes every safety gate and produces a
   material user/DX improvement. Admission must define its deterministic input
   surface, local store powers, rebase lifecycle, schema/version fencing,
   diagnostics, bounded-custody ceilings, and claim vocabulary; “run arbitrary
   client code” is not an acceptable contract.

The least powerful outcome whose candidate passes every required workload,
every applicable gate, **and every additional condition that outcome's own
recommendation rule imposes** — for Outcome 2 that includes staying within B's
preregistered coherence ceilings — becomes the
program's recommendation; only the author may adopt or reject it. Source
brevity or lower local latency cannot promote a candidate past a safety gate.

### Frozen workloads

Before implementing any candidate, the author or a named product authority
approves which facts are genuinely must-have behavior. Then freeze one
provider-neutral acceptance manifest per workload, including check IDs,
fixtures, actors, network/crash profiles, expected evidence, cleanup, and Stop
classes.

1. **Latency Kanban — ordinary optimistic update.** Move one row immediately;
   issue twenty rapid moves; reject a locked row; race two revisions; preserve
   unrelated optimistic layers; distinguish input-to-paint, server result, and
   independent-observer convergence. This is the common-path test: a solution
   that needs application-authored duplicate logic here has not earned the IR
   premise.
2. **Contention Calendar — optimistic create with canonical identity.** Render
   a provisional reservation when the server mints the canonical row ID; race
   two clients for one unique slot; map exactly one intent to one canonical
   row; visibly correct the loser; retry an ambiguous delivery without a
   duplicate. The provisional item must participate in the same typed
   query-derived ordering, filtering, and count lifecycle as authoritative
   reservations; an application-owned parallel collection does not pass this
   composability fact even when honestly labeled. No candidate may forge a
   branded authoritative ID or pretend a provisional ID is canonical.
3. **Field Notebook — durable restart and semantic rebase.** Queue a create and
   update; terminate the browser process while authority is unreachable;
   restart from durable client state; render retained and speculative state
   with distinct labels; pull a concurrent remote edit; rebase or surface a
   typed conflict containing enough application data to resolve it; settle
   exactly once. This is the discriminator: a same-session memory-store
   demonstration does not count.

The workloads reuse LLP 0138's facts where possible, but the decision lab has
its own frozen manifests, fresh check-ID namespaces, and evidence. A later
implementation may not weaken a check because one candidate cannot pass it.

### When the lab can run

The lab is not runnable at this revision. Candidate A requires the Phase 1
browser-safe mutation-IR evaluator to complete the sizing spike and pass LLP
0051 D5's conformance corpus on both the server and browser sides at pinned
identities. A spike-only evaluator that has not passed D5 cannot stand in for
Candidate A, because the lab would then be measuring missing implementation
rather than the IR rung's expressive limit.

Before manifests freeze, the author must record a named owner and timebox in a
dated revision here or a single repository filesystem ticket, following §Open
questions 5. Evidence will live under
`demos/local-first-option-c-decision/`, with digests and environment identity
in the retained run capsules; chronological experience goes in newly numbered
`diaries/` entries.

> **DEFERRED (2026-08-07, Charlie Cheever — author gate packet item
> 4).** The decision lab is explicitly deferred. Reopen trigger,
> verbatim: "schedule the lab when a real application (zerobugs-class
> or a customer app) hits an expressiveness wall attributable to
> Candidate A, or when Move 4 becomes commercially wanted." Move 4
> remains parked **by decision, not drift**. Sitting #4's rulings
> stand: OQ8's scheduling bar is lifted and the lab stays capped at
> Outcomes 0/1 until a concrete Candidate B arrives with a named
> adjudicating owner; nothing here detects the OQ4 trigger or admits
> Option C.

**§Open questions 8 must be answered before the lab is
scheduled** (v0.5): until the shared substrate Candidate A depends on is
either landed or explicitly bounded, a Candidate A failure cannot be
attributed to the IR rung, and the prerequisites above are the list as of
this revision rather than a settled one. Until the evaluator, owner, and timebox gates are all
satisfied, the protocol is design state rather than scheduled execution.
Once those gates are satisfied it is a conditional decision workstream after
Phase 1, not a shipping phase. It does not gate Phase 2a or program completion
unless the author records a later dated change to those boundaries.

### Interaction with intervening product work

Work that does not change browser-write expressiveness may proceed while the
lab is pending: relational query planning and custody inspection, query
completeness, stable application-error payloads, guide improvements, and other
authority-preserving correctness fixes do not wait for this decision.
Outcome-2-shaped public surfaces do wait: shared/generated optimistic
transforms, provisional/canonical identity settlement, semantic conflict
hooks, or any other constrained client-write extension may be prototyped only
inside decision evidence and may not ship as a public capability before the
lab reports and its owning design is admitted through the normal LLP process.

**Explicit carve-out (v0.4, widened v0.5 after round 3 found the narrow
version still circular):** the freeze does not reach any mechanism LLP 0133
already requires as shared substrate — in particular **lane-L id-map delivery
and logical-mint mapping**, which the accepted Spec mandates and which
Candidate A cannot run without, even though "provisional/canonical identity
settlement" reads like Outcome-2 territory. The distinction is ownership, not
shape: a mechanism an accepted owning document already requires is substrate;
a mechanism this lab would invent to extend the public authoring surface is
Outcome-2 work. Likewise, Phase 1's
D5-qualified mutation-IR evaluator and the IR-derived optimistic overlays it
produces are **not** an Outcome-2 surface and are **not** frozen by this rule.
They are Candidate A — the thing the lab exists to measure — and the lab
cannot start until they exist. The freeze binds *application-authored or
app-extensible* client-write surfaces layered on top of the IR, never the IR
rung itself.

If a relevant public surface nevertheless lands before manifest freeze, the
lab records it as a dated baseline change and freezes against that version. If
it lands after freeze, every affected candidate and workload is re-frozen and
rerun; evidence may not silently compare different product baselines. This
rule prevents the protocol from blocking unrelated DX/correctness work without
letting Candidate B arrive by incremental fait accompli.

### Candidate implementations

Run candidates in increasing order of authority surface.

**Candidate A — shared IR only.** The server mutation remains the sole authored
operation. A browser-safe evaluator derives the optimistic overlay from the
content-addressed mutation IR. The browser records deterministic host answers
as labeled claims and the server re-derives authoritative values under LLP
0133; the server does not consume client claims as authority.
Unsupported operations fail at build/admission time with a closed reason; they
do not silently fall back to a handwritten reducer.

**Candidate B — IR plus constrained extensions.** Implement only after A has a
retained inexpressibility result. Each extension must name the exact frozen
fact it unlocks and remain subordinate to the IR. Candidate examples, not
pre-decisions:

- a typed `clientIntentId`/provisional reference that maps to a server-minted
  canonical ID at settlement;
- a pure presentation mapper over the IR-derived overlay;
- a typed conflict renderer/resolver that consumes authoritative and pending
  values but cannot declare settlement; or
- an explicit degradation result for trusted time, identity, or unavailable
  host answers.

**Candidate C — app-authored client mutator.** Start only after B leaves a
retained inexpressibility result. For Outcome 3 evidence, implement C across all
three workloads and run the common safety suite, not only the fact that blocked
B. It may speculatively transform the bounded local query store and replay
after a fresh snapshot, but the server re-executes the authoritative mutation
independently. The candidate is a non-shipping prototype and must make
duplication and drift visible in source and evidence rather than hiding them
behind a shared adapter.

No candidate shares a lowest-common-denominator backend abstraction. Neutral
fixture and UI code may be shared; provider state machines and authored
mutation logic remain countable. Candidate B/C prototypes do not define public
product contracts. Any recommended shippable mechanism must amend its existing
owner (including LLP 0008, 0051, 0053, or 0133 as applicable) or land a new
owned Spec before implementation or capability claims.

### Required carrier and fault matrix

The acceptance carrier is a standards-real browser with durable IndexedDB, not
Node memory storage or `fake-indexeddb`. The harness controls a real browser
process (for example through Playwright/CDP), kills that process rather than
merely closing an in-page store, and restarts offline against the same browser
profile. Each candidate runs, at minimum:

- warm connected use and cold first hydration;
- transport loss before input, after local paint, during submission, after
  server commit but before acknowledgement, and during pull/resnapshot;
- full tab and browser-process termination, then offline restart;
- reconnect requiring a fresh full snapshot before pending replay;
- concurrent remote update of the same semantic field;
- schema/operation identity change while pending work exists;
- each of safety gate 7's four authority cases run separately — session
  logout/expiry/user switch, connected permission revocation, disconnected
  lease-bounded expiry, and reconnect resnapshot — while retained or pending
  state exists;
- origin storage eviction / quota pressure, with the harness's
  `navigator.storage.persist()` posture recorded;
- two tabs on one browser profile contending for the store (the fault LLP
  0090's single-writer/Web Locks discipline exists for, and one
  `fake-indexeddb` structurally cannot show);
- duplicate delivery and lost acknowledgement; and
- independent-observer convergence after every terminal outcome.

If the protected JS-arm authorized-lease capability has shipped when the lab
freezes, at least one run uses protected retainable data. Otherwise the matrix
marks **only the protected-retention recommendation scope** `N/A` (narrowed in
v0.8 — "protected cases" was undefined and could be read as waiving gate-7
authority tests, which it never licenses): the lab remains public-data-only,
protected local
mutation/retention is a hard nonclaim, and no recommendation can include that
scope until a later owned conformance gate passes. **Gate-7 applicability is
determined exclusively by gate 7(a)–(d)'s own rules**, including the authority
transitions that apply to any authenticated client over public data; nothing
in this paragraph waives them, and every `N/A` anywhere in the matrix names the
exact scope it excludes. The public-query result may
not stand in for protected evidence. Hostile-device byte erasure remains a
nonclaim.

### Safety gates

Every candidate must pass every gate applicable to its frozen scope. **Safety rows use one
vocabulary wherever they appear; workload checks keep their own (v0.6 unified
the safety half, v0.8 states the split):** safety rows take `PASS`,
`FAIL`, `GAP`, or `N/A`. Their eligibility effects are fixed — every
applicable row must be `PASS`; **`FAIL` and `GAP` both make the candidate
ineligible** (a gate with no evidence is not a gate that passed); `N/A` is
permitted only for a capability excluded from the recommendation boundary,
never for missing evidence inside it, and every `N/A` names the scope it
excludes. A single applicable non-`PASS` makes a candidate ineligible,
regardless of ergonomics. Frozen-workload *checks* keep their own
`PASS`/`GAP`/`FAIL` reporting, where a `GAP` is an unproved behavior rather
than an automatic disqualification — but a workload `GAP` on a must-have fact
still blocks the outcome that fact supports.

1. **Authority:** local output is always labeled speculative; only server
   re-execution can settle it.
2. **Atomicity and idempotence (partition sharpened v0.7):** a
   claimed-successful intent's authoritative effects **commit** atomically and
   idempotently, exactly once; rejection or rollback cannot strand a partial
   authoritative write. Whether those committed effects are then **visible**
   to a query — completeness, truncation, staleness — is **gate 9's**
   territory, not this one. The two gates previously overlapped on the word
   "visible," which is why the Fleet result below could be argued into either;
   the partition is now unambiguous, and a candidate is scored against exactly
   one of them per failure.
3. **Conflict honesty:** semantic conflicts are explicit closed outcomes, not
   silent last-write-wins unless that policy is the declared one in force.
   Note the baseline this gate sits on: LLP 0008 pins field-level
   last-write-wins with delete-wins as the **v1 default**, so the gate is not
   a demand that every operation opt in — it is a demand that a candidate
   never present a *semantic* conflict (one the workload's frozen facts name
   as needing resolution) as a silently merged success. Any candidate that
   wants per-operation conflict declaration is proposing a change to 0008's
   default and must say so in its evidence.
4. **Replay order:** a non-empty outbox performs full resync before ordered
   replay; resume never skips that barrier.
5. **Identity:** source/IR/runtime/store/schema identities fence local
   execution and replay; stale code cannot settle under a new operation by
   name alone.
6. **Trusted inputs, and the candidate sandbox (v0.5).** Server time, canonical
   IDs, authorization, and global uniqueness re-derive at settlement per LLP
   0133; the client cannot mint authority by prediction. **External effects are
   not "degraded" — they are denied.** LLP 0133 excludes action replay and LLP
   0126 pins actions and external effects as impossible offline and never
   automatically replayed, so no owning document defines a degraded local
   external effect and this Plan will not invent one.

   **The frozen surface bounds *ambient* capability, not ordinary execution
   inputs (corrected v0.8).** v0.5's "the retained query store, the outbox, the
   IR plan and its ledger, and nothing else" was read literally by round 6 and
   it is wrong: it omitted mutation arguments and the operation artifact, so no
   arg-bearing Candidate A could execute, and Candidate C — whose defining
   artifact is an app-authored mutator rather than an IR plan — could not exist
   at all, while gate 6 binds every candidate. The declared inputs, frozen with
   the manifests and conforming to the owning contracts (LLP 0051 D5 requires
   schema, initial rows, an IR plan **or module**, arguments, ledger, and
   principal; LLP 0133 treats explicit application arguments as legitimate
   validated data): the schema and store snapshot; the operation artifact
   appropriate to that candidate (an IR plan for A, the IR plus its declared
   extensions for B, the app-authored mutator for C); validated mutation
   arguments; a bounded client-visible principal/context projection, explicitly
   labeled non-authoritative; the outbox; and the recorded deterministic
   host-answer ledger.

   **Denied to every candidate:** network, action invocation, ambient clock or
   randomness outside the ledger, and any undeclared host capability. The lab
   runs **negative sandbox tests** proving each denial, and a candidate that
   reaches an ambient capability fails gate 6
   outright. Any broader local capability must land in an owning design first.
7. **Revocation — four cases with LLP 0053's own disposition names (split in
   v0.4; disposition names corrected in v0.5 after round 3 found 7(b) using a
   word LLP 0053 does not use).** Each case has its own expected disposition,
   and a candidate that satisfies one by doing another's thing fails:
   (a) **session logout / expiry / user switch** — an *authority transition*,
   not an authorization event (LLP 0053: "Not on this list, and deliberately
   so: session revocation"); the disposition is client-wide **`delete`** (LLP
   0039's rule, grant-scoped for multi-grant agent clients per LLP 0055);
   (b) **connected permission change** — LLP 0053's rule is "**coarse events
   quarantine; only proof deletes**," and it has three distinct paths, not one:
   matcher-mediated shrinking delivery — **and v0.7 imports the obligation
   machinery v0.5/v0.6 flattened into "the resnapshot carries it," which
   dropped the load-bearing security property**: every auth-scoped result
   shrink raises a **durable, level-triggered delivery obligation**, carried by
   an exact remove delta or a conservative replacement, and discharged **only
   on acknowledgement of a snapshot at or after the causing version**. Without
   the ACK-backed discharge a lost removal leaves forbidden rows visible
   indefinitely, which is precisely the hole LLP 0053 §Obligations exists to
   close, so the lab tests the obligation's durability and its ACK discharge,
   not merely that a resnapshot eventually happened; every ordinary
   coarse/out-of-band permission or activation
   revocation → **`quarantine`** (hide from render immediately, block reads,
   preserve suspended, release only on a satisfying superseding snapshot);
   and **`delete`** only on proof — typed `SNAPBACK_AUTH_PERMISSION_DENIED`
   or a superseding snapshot proving access is gone. (Lease expiry without
   revalidation is also a `delete` producer in LLP 0053, but it belongs to
   case (c) and is **removed from (b)'s list in v0.7**, so a lab operator
   scoring the matrix cannot count one lease-expiry delete as a (b) pass.)
   A candidate that deletes on a coarse event fails this gate:
   that was attempt four's bug, and LLP 0053 corrected it precisely because
   routine membership churn would otherwise destroy every client's retained
   data;
   (c) **disconnected authorization change** — undiscoverable by construction;
   the unexpired `AuthorizedLease` is the bound, and fail-closed expiry to
   `delete` is the only correct behavior. A candidate is never asked to detect
   an offline revocation, and a lab check that demands it is malformed;
   (d) **reconnect** — every auth-scoped reconnect requires a fresh
   resnapshot before release or deletion, and pending work never bypasses the
   execution-time authorization check.
   *Under the public-data-only branch* — **narrowed in v0.6; the v0.5 rule was
   unsafe.** `N/A` is **not** licensed merely because the protected capability
   row is unshipped. Absence of protected-query retention does not imply
   absence of authority-bound state: an authenticated client in a public-data
   lab still holds queued intents, optimistic overlays, and public retained
   rows, and LLP 0039 requires authenticated→anonymous and
   authenticated→different-user transitions to delete retained rows *and*
   queued mutations. So: **whenever an authenticated client is in scope, case
   (a) runs** — including its pending-outbox half — and `N/A` is available only
   when the frozen recommendation scope contains no authority-bound retained
   rows, overlays, or outbox work at all (e.g. a wholly anonymous
   configuration). **Case (b) is `N/A` only when the frozen scope proves no
   subscription or result is auth-scoped or permission-dependent — which is a
   high bar, not a default (v0.7):** LLP 0053 defines auth-scoped fail-closed
   ("every subscription is auth-scoped unless its function is explicitly
   declared `authorityIndependent`; undeclared means auth-scoped"), and LLP
   0080 keeps even all-`public-read` relational plans auth-scoped in v1. "The
   lab uses public data" is therefore *not* sufficient to `N/A` case (b).
   Case (c) is `N/A` only when there is no lease-backed retained auth state.
   When either is `N/A`, the recommendation scope narrows accordingly, and the
   artifact names the exclusion. Cases (b) and (c) are
   mutually exclusive on their shared producer: **lease expiry without
   revalidation belongs to (c)**,
   the disconnected case, and is not also a (b) producer. Case (d)'s
   reconnect-resnapshot obligation is scoped to **auth-scoped subscriptions**,
   which is narrower than v0.5's "any authenticated session"; the separate
   full-resync-before-replay barrier for pending work comes from LLP 0043/0090
   and is gate 4's, not gate 7's.
8. **Bounded custody:** queries, overlays, outbox entries, replay attempts, and
   conflict materialization have explicit resource ceilings and observable
   cleanup.
9. **No false completion:** partial query materialization, interrupted replay,
   and pending acknowledgement remain visibly incomplete.

Candidate C's duplicated application-authored semantics can never earn the
same-code `Parity` claim merely by passing this experiment. Its maximum claim
from this lab is LLP 0126's `Online` plus explicitly labeled speculation; any
stronger vocabulary needs an independently owned and accepted design.

Standing nonclaim, corrected in v0.4 and filed under **gate 9**, not gate 2
(both round-2 reviewers caught the original as stale): LLP 0138 retained one
primary Snapback FAIL in its immutable v1 receipt — a 1,000-row burst mutation
reported success while neither a fresh authoritative query nor the active live
result observed the changes. Exact-fixture follow-up **falsified the
atomicity/visibility reading**: all 1,000 writes were durable, and the defect
was an implicit 1,024-row query prefix silently treated as complete before
application-side ordering (LLP 0138's 2026-08-01 Revised header and §Status).
That is false completion — gate 9's territory — and it is **remediated**:
`b52e3b9c` ("fix(query): refuse implicit result truncation") landed
`SNAPBACK_QUERY_IMPLICIT_LIMIT_REACHED` with regressions in `crates/snapback/tests/local_v0.rs`
and `crates/snapback/tests/workerd_twin_v0.rs`, closed as
`issues/closed/20260801-fleet-query-implicit-limit.md`, and the v2 remediation
receipt reads 7 PASS / 1 GAP / 0 FAIL. What survives as a nonclaim: the v1
receipt stays immutable evidence, and gate-9 passes inside this lab's three
frozen workloads are evidence about those workloads only — never a general
query-completeness claim for the product. No standing gate-2 nonclaim is
asserted, because no current evidence supports one.

(This remediation is also the worked example of §Interaction with intervening
product work: an authority-preserving correctness fix that proceeds while the
lab is pending, and that a freeze would record as a dated baseline change.)

Cross-candidate performance numbers are invalid unless machine, browser,
fixture, warmup, network profile, target class, and measurement code are
identical.

### Measurements and diaries

For each workload/candidate record raw evidence plus:

- frozen workload checks as PASS/GAP/FAIL (a required must-have fact never
  accepts `N/A`) and safety rows as PASS/GAP/FAIL/N/A, in **separate typed
  fields** (v0.7 — one combined enum blurred the two vocabularies §Safety
  gates keeps distinct), with Stop-class failures
  controlling and each N/A naming the excluded recommendation scope;
- authored product files, lines, concepts, duplicated transformation lines,
  and provider-specific escape hatches;
- time to first correct implementation and assistance events;
- input-to-local-paint, server result, and observer convergence as separate
  distributions (warmup plus at least twenty retained samples; median and
  nearest-rank p95 — at n=20 that is the 19th value, so any p95 entering a
  cross-candidate comparison is labeled indicative unless the sample floor is
  raised for that comparison);
- browser bundle delta, evaluator startup, cold hydration, IndexedDB bytes,
  retained query rows/bytes, pending-intent bytes, and peak attributable
  memory;
- crash/restart recovery time and replay count;
- number and quality of build-time refusals, runtime diagnostics, and
  application-visible terminal outcomes; and
- one chronological diary per workload that freezes the first attempt and
  appends remediation rather than rewriting it.

The minimum role assignment is two independent builders plus one non-building
evidence reviewer. Both builders attempt Candidate A across all three frozen
workloads before seeing the other's diary. If B or C runs, assignments are
crossed so no candidate is represented only by the builder who designed its
surface; the same assistance budget applies to every candidate. The reviewer
freezes the contract before implementation and adjudicates classifications
without editing product code. Assistance is disclosed rather than normalized
away.

### Trigger detection and recommendation rule

The recorded trigger is **detected** when Candidate A cannot express a frozen
required fact without one of these disqualifying workarounds:

- duplicating the mutation transformation in application React/client code;
- forging or weakening authoritative identity/type distinctions;
- failing a frozen query-composability fact by keeping provisional items in an
  application-owned parallel collection, even when that sidecar is honest;
- omitting durable restart/rebase behavior required by the workload;
- broadening the deterministic host-answer surface solely for one app; or
- passing only by weakening a safety, carrier, or evidence requirement.

**Separating IR insufficiency from a missing shared mechanism (v0.5).** The
same attribution discipline applies, and this is the hazard §Open questions 8
names: Candidate A is the IR evaluator *plus* the shared substrate it needs to
run at all — lane-L settlement and id mapping, partial-read admission, schema
and identity fencing, receipt projection, the browser store/outbox, and the
React presentation path. A gap attributable to any of those being unlanded is
**missing implementation, not trigger detection**, and must be recorded as
such. The lab keeps a **misattribution log**: every Candidate A gap classified
as exactly one of {IR-inherent, pin-collision, missing shared mechanism,
**candidate-implementation defect, harness/evidence defect, environmental,
ambiguous frozen fact, unresolved**} — the last five added in v0.7, because
the three-way partition had no home for the failure modes this program has
actually experienced (the bakeoff misread fulfilled Zero error results, and
Fleet's first diagnosis was reversed by exact-fixture investigation), and two
independent builders can share one defective evaluator, settlement
integration, store, or React path. **None of the added five can detect the
trigger.** Each produces Outcome 0 and requires repair plus a fresh sealed
rerun; "unresolved" is an allowed terminal state and is never resolved toward
detection by default. Each classification carries
the test applied and the owner who validated it. Because that substrate is
partly unbuilt today, the lab may not be scheduled before §Open questions 8 is
answered — otherwise it measures absence and feeds a false negative into an
Option-C recommendation.

**Separating IR insufficiency from collision with an owned pin (v0.4;
the worked example withdrawn in v0.6).** When
a Candidate A gap coincides with a deliberate policy pin rather than an
expressive limit, the evidence must say which it is, or the trigger measures
the wrong thing.

*No gap is preclassified as a pin.* v0.4 named workload 3's
speculative-restart-render gap as a known pin, on the strength of Diary 0046's
phrasing that "the JS arm deliberately refuses persisted speculative render
while an outbox is pending (LLP 0090 D3)." **Both round-4 reviewers checked
LLP 0090 and it does not say that.** What D3 pins is a *resume* rule — "a
relaunching client with a non-empty mutation outbox does not send
`resumeFromToken`; it takes the 0043 path (full resync, then replay).
Composing resume with a pending outbox is milestone-3 work co-owned by LLP
0043." That is a deferred-composition boundary, not a prohibition on restoring
a distinctly labeled speculative overlay; LLP 0043 M2 even carries local
optimistic patch metadata. The render behavior is an implementation
consequence of the v1 milestone boundary, which puts the gap in the
*missing shared mechanism* class if anywhere. Preclassifying it as a pin would
have suppressed a legitimate Candidate A deficiency before the attribution
test ran, so the classification is left to the lab and its owner-validation
step. A gap counts as a pin collision only if an owning document explicitly
adopts the prohibition **before** the experiment freezes.

For any candidate pin collision the lab must record whether
Candidate A could express the fact under a relaxed presentation policy; if it
could, the finding is a proposed dated amendment to the owning document (LLP
0090 here), **not** trigger detection. The trigger is about the IR rung's
expressive reach and nothing else.

Trigger detection starts Candidate B; it does not admit C. Recommend Outcome 2
when constrained extensions cover every detected A gap, pass every gate, and
stay within B's preregistered coherence ceilings.

**B's coherence ceilings (added v0.4; without them Outcome 2 wins
automatically and the burden metrics the lab collects cannot affect the
recommendation, so an incoherent pile of extensions would beat a bounded C
contract).** Freeze the exact numbers with the manifests, before
implementation. B is no longer "constrained," and the lab must say so in its
recommendation, when any of these is exceeded: the count of distinct public
extension mechanisms; the share of extensions unlocking exactly one frozen
fact for exactly one workload (app-specificity); authored product lines and
concepts relative to Candidate A; browser bundle delta; or the number of
extension-specific diagnostics an author must learn. Exceeding a ceiling does
not by itself recommend Outcome 3 — every Outcome 3 condition below still
binds, and the least-power default still governs — but it does bar a silent
Outcome 2, and it obliges the lab to report B as an incoherent-surface result
and hand the author an explicit comparison against the bounded C contract.

Recommend Outcome 3 only when all of the following are true:

1. at least one must-have fact remains inexpressible after **two independent B
   attempts fail the same fact** (v0.6: "a concrete B attempt," singular,
   contradicted the proof rule below, which holds B to A's standard), with the
   missing expressive power named and owner-validated;
2. Candidate C passes every safety gate on all three workloads, including real
   crash/restart and every authority scope included in the recommendation;
3. C materially improves the blocked workload rather than merely reducing
   lines — it removes the inexpressibility and does not add a worse drift,
   custody, or diagnostic burden; and
4. the proposed bounded C contract is reviewable as a product surface, with no
   undeclared arbitrary-code or client-authority escape hatch.

**Outcome 0 — no recommendation (added v0.5; the "exactly one of three
outcomes" claim was not total).** At least two reachable states fit none of
outcomes 1–3: (i) Candidate A's only failure is attributable to an owned
policy pin or an unlanded shared mechanism, so it is not trigger detection,
Outcome 1 is not yet demonstrated, and 2–3 are unjustified; (ii) Candidate B
expresses every fact but exceeds its coherence ceilings, so Outcome 2 is
barred while Outcome 3's condition 1 (remaining inexpressibility) is false. In
any such state the lab records **Outcome 0**: no Option-C recommendation, the
current authority decision stands unchanged, and the artifact names what would
have to change — an owner-policy amendment, a landed shared mechanism, a
repaired protocol, or a narrower follow-up. Outcome 0 does not close the lab;
a rerun requires the named change plus a fresh dated owner/timebox record.

If evidence is mixed, retain the current decision and run a narrower follow-up;
uncertainty never defaults to the more powerful authority surface.

**What counts as proof of inexpressibility (added v0.5).** "Candidate A cannot
express fact F" is a universal claim, and the protocol previously had no rule
for establishing one. The controlling rules:

- **One valid implementation defeats the claim.** If either builder produces a
  Candidate A that passes F within the gates, F is expressible — full stop,
  regardless of the other builder's failure or of how much harder it was.
- **Both independent attempts must fail the same fact**, in separate source
  trees, with per-builder × per-workload × per-attempt evidence sealed before
  the diaries are compared. A single failure is a builder result, not a
  language result.
- **The failure must name the missing primitive** — which admitted IR or
  profile capability would have expressed F — and the relevant owner (LLP 0051
  for IR/conformance, LLP 0080/0110 for profiles) must validate that
  classification. An unnamed "we couldn't find a way" is not a finding.
- **Candidate B gets the same standard** before Outcome 3 may be recommended:
  a single concrete B attempt is not enough to establish that B is
  inexpressive.
- **Ordering bias is disclosed, not normalized away.** Candidates always run
  A→B→C, so later candidates inherit workload and harness familiarity;
  authoring-time and assistance figures are therefore **descriptive only** and
  may not by themselves move the recommendation between outcomes. Runtime
  comparisons additionally preregister their sampling unit, clean-profile
  repetitions, and pooling rule, or they are descriptive too.

### Decision artifact and ownership

The lab produces an immutable evidence directory, three diaries, a
dimension-separated comparison, and a proposed dated amendment to this
section. That amendment records evidence and disposition, not a shippable
product contract. It must name:

- the exact candidate, bounded recommendation scope, and owning documents that
  would have to accept its product design;
- every safety-gate result, N/A scope, and remaining nonclaim;
- what happens to Option C (`not admitted` or `admitted within <boundary>`);
- the source commit, target, browser, store, and evidence digests; and
- follow-up owners for implementation, guide, migration, and conformance.

The program may declare the trigger detected and recommend an outcome. Per LLP
0130 ER-1, **only the author can record the admission decision**. Until that
dated amendment lands, Option C remains not admitted and no implementation may
ship a capability claim for it. Even after a disposition, product work waits
for the owning RFC/Spec changes named by the amendment.

## Cross-gates with LLP 0115

LLP 0115 remains the parity program's sequencing authority; this Plan
is deliberately **not** a 0115 tranche — the two programs have
different exit criteria and 0127 §Sequencing 5 keeps them uncoupled.
LLP 0115 (from its v0.6, 2026-07-30) records these cross-gates
reciprocally, along with the registry of the ten adjudicated 0127
decisions (its open question 8 — cited by question, durable across
revisions). The shared substrate, by gate:

- **The sealed runtime artifact** (0127 move 5; 0115 Tranche A,
  CV-2/CV-3; LLP 0123): Phase 2b's sidecar carrier and the tuple's
  runtime-identity element. One artifact family serves the adopter's
  server and the app's embedded runtime.
- **The closed graph** (0127 move 2; CV-7; LLP 0118/0108): ground for
  every phase past 0 — a helper mechanism that broke closure would
  forfeit execution-identity element 1.
- **The profile vocabulary** (0127 move 6; CV-8; LLP 0080/0110):
  ledger row 2's proposed admission artifact for partial replication.
- **The rerun** (0115 §Sequencing 5): this program proposed adding
  the offline-scored dimension to that rerun — the fold is decided,
  LLP 0130 SD-3 answering 0115 OQ4 (§Measurement) — and, per 0115's
  requirement,
  at least one arm consumes the LLP 0114 React surface — the arm
  Phase 0 targets (decision 2 confirmed it).

## Open questions

> **2026-08-06 (sitting #4) rulings:** OQ8 — the Phase 1 gate SPLITS
> into evaluator/conformance and end-to-end shipping slices; SD-5 cannot
> advance the phase on the LLP 0051 D5 corpus alone. OQ10 — Candidate B
> is DEMAND-GATED: no speculative definition, Outcomes 0/1 only until a
> concrete candidate arrives with a named adjudicating owner (LLP 0141
> OQ1 posture). OQ11 — execution-identity element 5 is OWNED BY LLP
> 0166; its owner inherits the store-semantics profile and mismatch
> disposition, and exit criterion 3's element-5 harness upgrades to
> conformance-on-both-executions plus mismatch-refusal tests.

Questions 1–2 were LLP 0127's open decisions carried verbatim in
scope; both were adjudicated 2026-07-30 and no longer gate this Plan
(§Decision posture).

1. **0127 decision 2 — DECIDED (v0.2)** (0126 OQ1/OQ7): the
   successor-Plan shape (this document), the JS/React arm as first
   carrier, and the two-parallel-ladder staging with IR-rung-first
   resourcing are confirmed. Option C (client mutators) is NOT
   admitted; it is held behind the named trigger recorded in open
   question 4. This Plan's authority, Phase 0's arm, and the phase
   structure are set.
2. **0127 decision 10 — DECIDED (v0.2)** (0126 OQ3): server
   re-derivation is the default for client-captured `now` and ids at
   settlement; client-captured values are carried in receipts as
   labeled claims, never authority; bounded-skew acceptance only as a
   per-field declared opt-in. Owner: a new settlement Spec under this
   program — the program's first owned-Spec deliverable. Ledger
   row 1 un-gates as that Spec lands; exit criterion 3's binding
   stands. Domain and lane scoping recorded at ledger row 1 (v0.3):
   the queued-intent replay lane keeps LLP 0008's shipped accept
   pin; re-derivation governs the local-execution lanes; the
   client-minted `clientMutationId` is protocol-lane identity
   outside decision 10's domain.
3. **First-arm fallback shape — MOOT (v0.2).** Decision 2 confirmed
   the JS/React arm as first carrier, so the Contract-arm-first
   fallback (0126 OQ1's alternative) does not arise; retained for the
   record only.
4. **Option-C trigger wording — RECORDED (v0.2, decision 2).** The
   named trigger, verbatim: admit option C only if the IR rung proves
   insufficient for browser-side write expressiveness after
   measurement. The Option-C empirical decision protocol now defines who
   observes the measurement and where the dated recommendation/admission
   amendment is recorded; its owner and timebox remain gated by open question
   5. LLP 0130 ER-1 (2026-07-31) reserves the admission: the
   program may detect the trigger, but admitting option C is the
   author's call alone — no standing decision covers it. (0127's
   earlier phrasing — C "available if demand for
   arbitrary offline client logic arrives before D matures" — is
   superseded by the decided trigger.)
5. **Phase timeboxes and owners.** This Plan assigns none. Each phase
   needs a named owner and a timebox before it starts; whether those
   land as revisions here or as filesystem tickets per phase is an
   author call.

   > **Dated ruling (2026-08-03, Charlie Cheever) — Phase 1 only.**
   > Owner: Charlie Cheever as deciding author, executing through the
   > wave-3 Track A fleet lane under session supervision. Timebox: the
   > Phase-1 evidence gate — the browser-safe IR-evaluator sizing spike
   > plus the LLP 0051 D5 conformance-corpus evidence — is presented to
   > the author by **2026-08-10**; the phase's Kanban-gate exit
   > presentation by **2026-08-17**. Per this Plan's standing rule,
   > advancement remains author-presented (never automatic) while OQ8
   > pends, and a missed timebox returns here for a fresh dated ruling
   > rather than sliding silently. Later phases remain unassigned; this
   > ruling opens exactly Phase 1 (LLP 0155 Move 3's entry point).
   >
   > **Gate outcome (2026-08-03, Charlie Cheever): ADVANCED.** Both
   > evidence halves were presented ahead of the timebox and the author
   > advanced Phase 1 the same day: the sizing spike (Kanban's common
   > path is exactly Insert/Get/Guard/Patch; measured browser-evaluator
   > closure 23,368 min / 8,547 gzip, +19,913/+6,846 over the landed
   > LLP 0166 store — `tests/acceptance/fixtures/write-lane/
   > phase1-sizing-spike.2026-08-03.v1.md`) and the D5 evidence (37/37
   > corpus cases Rust-vs-JS exact, all five multi-table cases replayed,
   > zero placeholders — `phase1-d5-evidence.2026-08-03.v1.md`).
   > Advancement was author-presented per the standing rule; OQ8 remains
   > pending and its unshipped mechanisms (read admission, identity,
   > receipts, presentation beyond the landed store slice) are Phase-1
   > implementation obligations, not waived. The Phase-1 implementation
   > program is commissioned as
   > `issues/20260803-move3-phase1-program.md`; the Kanban-gate exit
   > presentation stays due 2026-08-17.
   >
   > **Phase-1 EXIT (2026-08-04, Charlie Cheever): ACCEPTED.** The
   > Kanban exit gate was presented and accepted ahead of the timebox:
   > the Move-3 program's four lanes landed (M1 shipping evaluator, M2
   > read admission, M3 optimistic rebase, M4 generated-IR mutations +
   > the Latency Kanban exit at 2ca5e7f7c) and the transcribed gate
   > passed 5/5 with 0 blocked sections on a real served run
   > (`tests/acceptance/fixtures/latency-kanban/
   > move3-exit.2026-08-04.v1.json`: local paint ~21–24 ms per verb,
   > locked refusal 21 ms, 20-move stack 258 ms, exact settlement
   > retirement, second-client convergence, SIGKILL loss-free
   > pre-network reload). OQ8's mechanisms shipped inside the program
   > (admission, identity-bound coverage, receipts, the answer-class
   > presentation). The gate's first real run also caught and fixed the
   > mutate-after-subscribe admission-source defect (live-registration
   > volatile answers vs the proof-or-nothing durable store), recorded
   > in the program ticket. **Phase-2 scheduling returns to this
   > document's machinery**: no phase is open; opening Phase 2 is a
   > future author act with its own owner/timebox ruling.
   >
   > **Dated correction (2026-08-07, Charlie Cheever — author gate
   > packet item 7): the owner-landing ledger governs the CLAIMS.**
   > Phase 1 exited its evaluator/conformance slice legitimately, but
   > the sentence "OQ8's mechanisms shipped inside the program" above is
   > corrected as **overstated**: the core machinery landed, while
   > ledger rows 2–4 (partial-read admission, schema/identity fencing,
   > receipt projection) remain, and `Parity` labeling stays barred
   > until rows 2–4 land. Row owners are assigned in §The owner-landing
   > ledger (dated 2026-08-07 assignments on rows 2–4).
   >
   > **Dated ruling (2026-08-04, Charlie Cheever) — write rung 2 only.**
   > Recorded from `issues/20260804-0129-write-rung2-ruling.md`. This
   > ruling opens exactly LLP 0155 write rung 2 (Move 4's entry point)
   > as the write lane's next phase under this Plan's machinery. Owner:
   > Charlie Cheever as deciding author, executing through the current
   > session's codex-implemented lane under session supervision.
   > Evidence gate, presented to the author by **2026-08-11**: (a) a
   > widened-ceiling sizing spike — the measured browser-evaluator
   > closure delta for exactly the verb subset Contention Calendar's
   > common path needs (candidate set `AllocateSequence`, `Delete`,
   > `Let`; widened further only with measurement) — and (b) the LLP
   > 0051 D5 conformance corpus extended to cover every newly exported
   > verb, passing Rust-vs-JS exactly. Exit: the Calendar-gate exit
   > presentation by **2026-08-18**. Advancement stays author-presented;
   > a missed timebox returns here for a fresh dated ruling rather than
   > sliding silently. Two explicit dispositions: verb widening is
   > Candidate-A substrate work under rung 1's authority per LLP 0155 —
   > it is not a detection of open question 4's Option-C trigger and
   > makes no admission claim (LLP 0130 ER-1 reserves that to the
   > author); Contention Calendar serves as this rung's shipping exit
   > application while remaining the decision lab's frozen manifest —
   > the lab is untouched and Field Notebook, the rung-3 discriminator,
   > is not used or repurposed. The browser-WASM ladder (Phase 2a) and
   > desktop ladder (Phase 2b) remain unassigned.
   >
   > **Evidence-gate half (a) ACCEPTED (2026-08-04, Charlie Cheever) —
   > the no-widening reading.** The W1 sizing spike
   > (`tests/acceptance/fixtures/write-lane/
   > rung2-sizing-spike.2026-08-04.v1.md`, landed 589bee2cc) measured
   > Contention Calendar's frozen common path as exactly one `Insert` —
   > `AllocateSequence`, `Delete`, and `Let` occur zero times (loser
   > correction is settlement-layer retirement; retry idempotence is
   > protocol identity) — and recommended retaining the
   > `Insert`/`Get`/`Guard`/`Patch` ceiling; measured widening deltas
   > (+1,118 min / +328 gzip cumulative) are retained as evidence. The
   > author accepts the reading: the ceiling stays unwidened, the
   > program's W2 (D5 extension for newly exported verbs) and W3
   > (evaluator widening) lanes collapse as evidence-vacuous, and the
   > rung proceeds directly to W4 (the Calendar exit application) on
   > rung 1's existing ceiling. A later inexpressibility finding
   > returns here for a fresh dated ruling; nothing in this acceptance
   > is an Option-C trigger detection or admission (LLP 0130 ER-1).
   >
   > **Write-rung-2 EXIT (2026-08-04, Charlie Cheever): ACCEPTED.** The
   > Calendar exit gate was presented and accepted the same day, two
   > weeks ahead of the timebox: the transcribed gate passed 8/8 with 0
   > blocked on a real served run
   > (`tests/acceptance/fixtures/contention-calendar/
   > rung2-exit.2026-08-04.r1.v1.json`, landed 917b16e7c) — provisional
   > sub-frame render, exactly-one winner across two racing clients,
   > loser-correction with zero provisional residue, ambiguous-retry
   > idempotence with identical idMap, non-overlap success, observer
   > convergence, owned cleanup — all on rung 1's unwidened
   > `Insert`/`Get`/`Guard`/`Patch` ceiling (the generated plan carries a
   > sole `Insert`). W1 and W4 complete; W2/W3 collapsed under the
   > accepted evidence reading. Write rung 2 closes; LLP 0155 Move 4's
   > exit application is delivered. Rung-3 and decision-lab scheduling
   > return to this document's machinery: no write-lane phase is open,
   > and opening one is a future author act with its own owner/timebox
   > ruling (OQ10/OQ11 remain the lab's open prerequisites).
   >
   > **Dated ruling (2026-08-07, Charlie Cheever) — Phase 0 remainder
   > and Phase 2a disposition.** Recorded from
   > `issues/closed/20260807-local-first-author-gate-packet.md` item 2.
   > Both are assigned to the **standing orchestration lane**: Charlie
   > Cheever as deciding author, executing through the orchestrated
   > fleet lane under session supervision — the same formula as the
   > Phase-1 ruling
   > (`issues/closed/20260803-p0-0129-phase1-ruling.md`). Timebox ~one
   > week each: the Phase-0-remainder evidence (M1 lease custody + the
   > authenticated conjunction witness) is presented to the author by
   > **2026-08-14**; the Phase 2a disposition is presented by
   > **2026-08-14**. Per this Plan's standing rule, advancement remains
   > author-presented, and a missed timebox returns here for a fresh
   > dated ruling rather than sliding silently.
6. **The ephemeral no-sync pin.** Does the proposed LLP 0013
   amendment (0126 OQ8; constraint 4) land with Phase 0 or
   independently, and who writes it?
7. **Phase 0's gate disposition — OPEN (v0.4, raised by round 2).**
   Phase 0's implementation lane landed, but its evidence gate reads
   "a diary-grade offline acceptance rerun on **the chosen arm**" and
   the chosen arm is the JS/React *browser* arm, while the retained
   acceptance is Node/file/headless over public queries — and exit
   criterion 1 additionally wants an authenticated shell and
   authorized rows. Does the gate **split** into a landed
   Node/file/public half plus an open browser/React/authorized half,
   or does the **whole** gate stay open until the browser witness
   (`issues/20260801-guide-gap-js-arm-browser-indexeddb-proof.md`)
   lands? Either answer is defensible; only the author can pick,
   because SD-5's self-advancing rule keys off it. Related: whether
   Phase 0's missing pre-start owner/timebox (question 5) gets a dated
   retrospective exception.
   **RULED 2026-08-03 — author decision sitting #2
   (`issues/20260803-author-decision-sitting-2.md`): the gate splits.**
   The Node/file half is recorded as landed; the browser React+server
   witness remains an explicit open remainder
   (`issues/20260801-guide-gap-js-arm-browser-indexeddb-proof.md`).
   SD-5's self-advancing rule keys off this split reading.
   **RULED 2026-08-07 — author gate packet item 1
   (`issues/closed/20260807-local-first-author-gate-packet.md`): the
   split extends.** *Ruling:* Phase 0's evidence gate splits into a
   Node/file/public half and a browser/public half, both recorded as
   **landed** — the browser public witness landed at `5ef7950c3` (8/8
   legs in real Chrome against the real runtime), joining the earlier
   Node/file evidence already cited in this Plan — while the
   authenticated/authorized conjunction half remains **open** and gates
   on M1 lease custody
   (`issues/20260731-js-arm-lease-custody-and-sessions-outbox.md`
   leg 1). SD-5 keys off this split disposition.
8. **Is Phase 1's gate sufficient for what Phase 1 promises? — RULED
   (2026-08-06, author sitting #4, ruling #8; raised OPEN at v0.4 by
   round 2).** *Ruling:* the gate **splits** into an
   evaluator/conformance slice and an end-to-end shipping slice; SD-5
   cannot advance the phase on the LLP 0051 D5 corpus alone
   (`issues/closed/20260806-author-decision-sitting-4.md`). The tension
   between this item's pre-ruling body below and the 2026-08-04 Phase-1
   EXIT note's shipped-claim is routed to the author in
   `issues/closed/20260807-local-first-author-gate-packet.md` item 7 —
   **ruled 2026-08-07: the owner-landing ledger governs the claims**;
   see the dated correction at item 5's Phase-1 EXIT note and the dated
   2026-08-07 owner assignments on ledger rows 2–4. Original
   question: Phase 1's named gate is the
   IR-evaluator sizing spike plus the LLP 0051 D5 corpus passing on
   both sides. But the phase promises local optimistic overlays and
   honest `Parity`, and `Parity` needs mechanisms D5 does not
   exercise: LLP 0133's lane-L settlement/id-map substrate and client
   store/outbox reconciliation are landed (2026-08-02), but local execution,
   speculative receipts, and the delegated receipt-wire freeze remain
   unshipped or owner-gated; partial-read admission (ledger row 2),
   schema/identity fencing (row 3), receipt projection (row 4), and the
   browser React presentation paths also remain. Exit criterion 3 and
   the ledger already bar the *claim*; the open question is whether
   the *gate* should be split into evaluator/conformance and
   end-to-end shipping slices so SD-5 cannot advance the phase on D5
   alone. Consequence for the decision lab: Candidate A cannot be
   called inexpressive until these shared mechanisms exist, or the lab
   measures missing implementation instead of the IR rung's reach.
9. **Phase 2a's exit is not falsifiable — OPEN (v0.4, raised by round
   2).** §Exit criteria says a phase that cannot state its criterion
   in falsifiable form does not exit, and program completion requires
   Phase 2a to have executed; but Phase 2a's only gate is "the WASM
   assessment, dated," which names no pass/fail condition and no
   artifact. Either give Phase 2a a falsifiable artifact/conformance
   exit, or reclassify it as an assessment whose disposition is an
   author call like the Option F rider's — and say which in the
   completion boundary.
   **Evidence update (2026-08-05):** the dated artifact now exists and presents
   three falsifiable replacement options: an assessment-disposition check, a
   ≥90%-plus-100%-common-path real-browser IR coverage gate, and a narrow
   engine-free WASM conformance/size/latency gate. This closes the missing-
   artifact half of the concern, not the author-owned choice of which exit
   semantics govern Phase 2a.
   **RESOLVED (2026-08-06, Charlie Cheever): IR-only.** The browser story is
   pinned to the shipped JS IR evaluator (the assessment's recommended option
   (i)); full-runtime WASM is deferred. Phase 2a's falsifiable exit is
   therefore the **browser-IR-coverage gate** (assessment exit option 2):
   ≥90% semantic IR coverage of the versioned reference-app durable-mutation
   corpus plus 100% execution coverage for the designated browser common-path
   mutations, proven by generated artifacts under a real-browser IndexedDB
   acceptance run with exact LLP 0051 D5 results. A narrow, engine-free WASM
   slice is a **demand-triggered reopen** (the assessment's IR-negative
   trigger), never a Phase-2a exit requirement — so LLP 0051 §Rejected's
   no-JS-engine-to-browser constraint is preserved. This resolves the
   author-owned half; the missing-artifact half was already closed above.
10. **What is Candidate B, exactly, and who owns it? — RULED
    (2026-08-06, author sitting #4, ruling #9; raised OPEN at v0.7 by
    round 5).** *Ruling:* Candidate B is **demand-gated** — the decision
    lab is limited to Outcomes 0/1 until a concrete candidate arrives
    with a named adjudicating owner
    (`issues/closed/20260806-author-decision-sitting-4.md`). Original
    question: Outcome 3 requires that a fact be
    inexpressible after B, but B is currently an open-ended list of
    *example* extensions, and its coherence ceilings bound counts and
    costs rather than semantics. Two failed B implementations
    therefore support "two preregistered B designs failed," not "every
    permitted B design is inexpressive" — and no owner exists who could
    validate the stronger claim. Before B is tested, someone must
    freeze its typed inputs and outputs, its allowed computation and
    effects, its composition rules, its explicit prohibition on
    duplicated mutation semantics, and its adjudicating owner. Until
    that exists, the lab can reach Outcome 0 or 1 but not a sound
    Outcome 3.
11. **Who owns execution-identity element 5? — RULED (2026-08-06,
    author sitting #4, ruling #10; raised OPEN at v0.7 by round 5).**
    *Ruling:* element 5 is **owned by LLP 0166**, and exit criterion 3's
    element-5 harness upgrades to conformance-on-both-executions plus
    mismatch-refusal/quarantine/resync tests under that ownership
    (`issues/closed/20260806-author-decision-sitting-4.md`). Original
    question: Exit criterion 3 asks only for "an activation-carry
    check in the settlement submission" for element 5 (store semantics
    and schema epoch). Carriage proves neither store-semantic
    compatibility nor safe behavior on mismatch, and LLP 0133 is
    explicit that the activation travels as an untrusted claim whose
    mismatch disposition is owned elsewhere and must never settle
    silently as matched. Ledger row 5 proposes owners for the other
    elements but leaves element 5's store-semantics profile and
    mismatch disposition unowned. Criterion 3's element-5 harness
    should become conformance on both executions plus mismatch
    refusal/quarantine/resync tests — but naming that owner is the
    author's call.

## Read-lane capability activation record — 2026-08-04

The LLP 0155/0157/0166 read lane has activated `single_table_v1`: the id is
registered at experimental maturity, qualifying generated artifacts require
it, and the contributor-source local target publishes support only through
LLP 0110's exact store/class carrier. The legacy-to-QMK path stays
connected-only prove-or-fresh and pending-intent-safe; Arm A adds no
`AuthorizedLease`. Public packages, remote/hosted targets, and Fleet remain
false/GAP. This record satisfies the capability board for the introduction
act and changes no Phase, Option-C trigger, write-rung owner/timebox, or
current OQ disposition in this Plan.

## Phase-2b desktop-sidecar first-rung note — 2026-08-05

The desktop sidecar implementation now lives at
`packages/snapback-sidecar/`. An application embeds one in-process supervisor,
which resolves the platform runtime through `@expo/snapback-cli`, spawns
`snapback start --ready-file <path> --db <path> --port 0`, and accepts an
attachment only after the Rust-owned `HostReadyDescriptor` passes database,
port/URL, child-pid, loopback, startup-nonce, and owner-only capability-sibling
validation. The typed attachment exposes the actual HTTP origin and redacting
handles for the admin-token, secret-read-root, and impersonation files. HTTP
remains the runtime data plane; `start`, `health`, `stop`, `status`, and `swap`
are the embedding application's in-process lifecycle control plane. This is
the sidecar rung under §Phases, not an in-process native embedding.

Lifecycle ownership is bounded and explicit. Native `snapback stop` rechecks
the descriptor nonce before signaling only the spawned child; the supervisor
then attests child exit, descriptor removal, and health loss. An unexpected
exit surfaces a `SIDECAR_CHILD_DIED` error before an application-selected
restart decision. Even an always-restart decision is capped by
`maxAttempts` and bounded backoff. Every normal start and restart requests OS
port `0`; no stale fixed-port fallback exists.

Updater swap is a journaled stop-then-attach protocol over the same SQLite
custody domain. Before the predecessor stops, an application-owned outbox
adapter quiesces new submissions and settles any in-flight submission back to
durable client custody or completion; pending durable intents may remain
queued. The supervisor persists the old/new runtime selections, stops the old
child cleanly, and starts and health-attests the candidate. Because each child
owns a new OS-assigned port, the app then must use the candidate attachment to
re-point or replace its app-owned data client and return a binding receipt for
that exact URL before replay begins. An adapter with an adoption path may then
resume the same outbox through that rebound client; this first rung instead
reports the application store's authoritative nonzero pending count without
attempting unsupported cross-instance replay. In either case it returns a
URL-bound receipt: `stopped: true` or any nonzero `remaining` count is a failed
swap, not a successful no-op. The supervisor commits the candidate attachment
only after a zero-remaining receipt.
Candidate start, verification, rebind, or resume failure stops
the candidate and reattaches the old package, with the candidate as the
second recovery choice if the old package itself became unavailable. A
retained swap journal lets a recreated supervisor recover either selection;
it cannot turn a broken/missing pair of runtime packages into a runnable one,
and reports `SIDECAR_SWAP_RECOVERY_FAILED` without deleting the journal in
that physically unrecoverable case.

This split records the ownership boundary exposed by the outside-sandbox
acceptance runs: the supervisor owns lifecycle sequencing and verifies the
selected attachment, while the embedding app owns the `SnapbackClient` and
client-custodied outbox. The original combined `resume()` callback could
resolve after a connectivity-stopped replay (`replayed: 0`, `remaining: 1`),
allowing `swapped` to commit while intent remained stranded. The `rebind()`
then receipted `resume()` cut makes that state unrepresentable as success.

The harder underlying behavior was initially recorded as client-outbox
re-adoption. The shipped proof queues on a transport failure and drains through
that **same** `SnapbackClient` instance, and the bounded Phase-2b rung therefore
does **not** ask its fresh client to drain the intent. The 2026-08-06 spike below
corrects the causal claim, however: the record carries no client-instance or
origin identity, and a fresh client over the same explicit store does see and
replay it. The reproduced empty view comes from default file-store resolution:
the candidate's new ephemeral port selects a different full-origin-keyed blob.
A second store instance over the same stable identity sees the pending record
but remains replay-fenced until it acquires the writer role. The first rung's
behavior remains correctly fail-closed: a pending-intent attempt returns
`SIDECAR_OUTBOX_RESUME_INCOMPLETE`, stops the candidate, reattaches the old
runtime, and leaves the client-minted record safely pending. A successful
landed-rung swap still requires an already empty outbox.

The named **hot-swap-with-pending-intent follow-on** must add an explicit stable
sidecar store/writer handoff, bind replay through the fresh client's attested
candidate transport, and prove durable exactly-once settlement of the original
mutation identity on the candidate. It does not need to move or retag outbox
records. Neither `/health`, capability-file readiness, nor constructing a fresh
client alone is that proof.

The executable evidence owner is
`tests/acceptance/desktop-sidecar-v1.mjs`. Its real-child journey proves the
healthy descriptor/capability attachment, OS-assigned port reporting,
nonce-verified graceful stop, typed killed-child event plus one-attempt
restart, a pending-intent swap refusing with
`SIDECAR_OUTBOX_RESUME_INCOMPLETE` and recovering the old runtime without a
false `swap-completed` while the genuine transport-failure-queued intent stays
durably pending, a separate empty-outbox swap attaching the candidate, and a
candidate killed after readiness but before commit recovering exactly one
old-or-new attachment. A fully passing run writes the source- and
runtime-digest-bound receipt
`tests/acceptance/fixtures/desktop-sidecar/phase-2b.2026-08-05.v1.json`; the
`--check` mode refuses absent, non-PASS, or source-drifted evidence.

The listener-bound command is:

```sh
DYLD_FRAMEWORK_PATH=$PWD/vendor/ibex/ios/Frameworks \
SNAPBACK_RUNTIME_BINARY=$PWD/target/debug/snapback \
node --test tests/acceptance/desktop-sidecar-v1.mjs
```

This worktree's managed sandbox refused the real listener with `EPERM`, and
the runner emitted `SIDECAR_LISTENER_BLOCKED`; therefore this dated note does
not claim the Phase-2b evidence gate is met yet and no PASS receipt is checked
in. The same lifecycle and swap state machine has a listener-free,
process-real package test, but that is diagnostic support rather than a
substitute for the named real-runtime gate. The orchestrator must rerun the
command above outside the listener-blocked sandbox; only its retained PASS
receipt promotes the gate.

Two follow-on boundaries stay explicit:

- LLP 0081 attaches at `onUpgradeRequired`. The sidecar provides the refusal
  and app-owned outbox snapshot to that hook, but does not implement
  quarantine, redacted tombstones, or action re-entry.
- LLP 0123's runtime-package-production follow-on is **closed at the package
  boundary (2026-08-06)**. Each Darwin/Linux package carries the binary,
  Hermes header/runtime, and one source/build/digest-bound successful
  `runtime-qualify` verdict; the packaged CLI resolver re-verifies it before
  returning the binary. Descriptor/health nonce attestation remains the live
  child attachment proof, while the optional `verifyCandidate` hook can add
  app policy. This closure does not supply LLP 0123 Option 2's distinct
  in-serving-process boot witness, which remains with LLP 0009/Ibex
  host-handoff owners.
- Hot swap with pending outbox intent attaches at cross-client adoption of the
  application-owned durable queue after `rebind()`. The current first rung
  proves fail-closed rollback with the record still pending plus empty-outbox
  swap, not predecessor-intent replay against the candidate.

No diary was added: this landing introduces a package/control surface, not a
new or substantially changed demo application under the repository diary
rule. The stable native ABI required for in-process embedding still does not
exist; §Phases' separate spike remains the prerequisite to any such claim.

## Phase-2b hot-swap-with-pending design spike — 2026-08-06

The retained design artifact is
[`tests/acceptance/fixtures/desktop-sidecar/hot-swap-design.2026-08-06.v1.md`](../tests/acceptance/fixtures/desktop-sidecar/hot-swap-design.2026-08-06.v1.md).
It traces the client/store/writer relationship, designs the stable-store
handoff, candidate-origin binding, and same-database settlement proof, and
recommends **BUILD** as a narrow sidecar-only follow-on. The global default
store remains isolated by origin; no application queue is silently merged
across arbitrary servers.

The listener-free characterization PoC passes: a fresh client over one
explicit caller-owned store sees the predecessor's pending record, dispatches
it to its own new `baseUrl`, preserves the original `clientMutationId`, and
drains it; the negative control with two default ephemeral origins produces an
empty candidate store; a second same-identity store sees the record but cannot
replay before exact writer takeover. The exact command and real output are in
the artifact.

The bounded two-runtime/same-database settlement PoC did not run in this
managed sandbox: the first runtime listener failed with `EPERM` before
readiness, so no settlement assertion executed and no PASS is claimed. The
retained script names the exact outside-sandbox rerun. At design level, the
candidate preserves `clientMutationId` and the complete compared settlement
identity against the shared `_snapback_client_mutations` row; the process URL,
port, pid, and startup nonce are not duplicate-suppression inputs. LLP 0133's
`(mint site, occurrence)` identity remains the speculative-id reconciliation
mechanism, not the server idempotency key.

This design makes pending-work-preserving stop/start swap buildable. It does
not promote the current rung, change any capability claim, or turn the
stop-then-start sidecar into literal zero-request-downtime; a stable front door
or overlapping-runtime design would be a separate author-facing decision.

## Phase-2b hot-swap-with-pending build — 2026-08-06

The design follow-on is now built at the client/sidecar boundary. Ordinary
`SnapbackClient` construction still resolves the default Node/file store by
full origin, including port. The embedding application instead creates one
durable caller-owned store for the canonical sidecar database custody domain
and injects that same store into predecessor, candidate, and rollback clients.
The sidecar never silently merges queues from unrelated origins and the durable
outbox record format remains unchanged.

`SnapbackClient.adoptQueuedMutations()` is the checked adoption cut. It requires
the predecessor's `clientStoreId` and complete artifact generation plus an
application-owned passed full-snapshot barrier; awaits writer settlement;
requires exact writer custody and store-id equality; compares the candidate's
public `/inspect` app/schema/function identity; requires each pending record to
carry that same complete generation; then drains the existing sequence-ordered
replay single-flight. Its frozen receipt binds candidate origin, store id,
writer status, freshness evidence, artifact generation, authoritative
before/after disposition counts, replayed count, terminal deltas, remaining,
and stopped. The generic non-writer replay path now reads the shared store and
reports the authoritative unresolved count instead of `remaining: 0`.

The sidecar v2 binding and resume receipts bind the candidate attachment URL
and startup nonce to the exact predecessor store handoff, writer custody,
passed full-snapshot barrier, and matching artifact generation. A v1 receipt
remains accepted only for a positively observed empty-outbox cold swap. Hot
commit requires zero remaining, `stopped: false`, and zero newly failed,
quarantined, or result-gone dispositions. Store mismatch, absent writer,
freshness failure, artifact/schema/function mismatch, identity divergence,
connectivity stop, or any nonzero terminal delta fails closed: the candidate is
stopped, the predecessor package is reattached, and candidate identity refusal
does not mark the intent failed.

Replay itself keeps the record's original `clientMutationId`, expected
generation, authority, and settlement facts. The candidate client's `baseUrl`
selects the new ephemeral origin; URL, port, pid, and startup nonce never enter
duplicate identity. Exactly-once therefore remains the existing atomic
application-write + `_snapback_client_mutations` row in the shared SQLite
database: an unsettled id executes once, while a predecessor-committed/
response-lost id republishes the stored result without a second application
write. LLP 0133's mint-site/occurrence mapping remains orthogonal.

The listener-free sidecar package test and focused client outbox suite pass in
the managed sandbox. The real-child acceptance now owns the pending drain,
duplicate republish/unchanged row count, identity-divergence rollback,
writer-fence rollback, incompatible-generation rollback, and unchanged empty
swap. Its listener was blocked in the managed sandbox, so the dated build was
**implemented but not evidence-promoted** until the orchestrator ran:

```sh
DYLD_FRAMEWORK_PATH=$PWD/vendor/ibex/ios/Frameworks \
SNAPBACK_RUNTIME_BINARY=$PWD/target/debug/snapback \
node --test tests/acceptance/desktop-sidecar-v1.mjs
```

**2026-08-06 update — evidence-promoted.** This gate ran outside the sandbox
in an isolated worktree at origin/main commit `e99d2a328`, on a rebuilt
`target/debug/snapback` qualified by `scripts/bootstrap-ibex-runtime`: 1/1
suite pass, covering the pending-drain, duplicate-republish,
identity-divergence rollback, writer-fence rollback, incompatible-generation
rollback, and empty swap scenarios named above. The same-database
two-runtime settlement PoC also passed on the same run (see the dated
addendum in `hot-swap-design.2026-08-06.v1.md` §5). Dated evidence:
`tests/acceptance/fixtures/desktop-sidecar/hot-swap-promotion.2026-08-06.v1.json`.
The Phase-2b hot-swap-with-pending build is therefore evidence-promoted at
the first-rung boundary.

Honest boundary: this is a pending-work-preserving **stop predecessor, start
candidate** swap. Requests cannot be served during that cut. Literal
zero-request-downtime needs a separately designed stable front door or
overlapping runtime ownership and is neither implemented nor claimed here.
