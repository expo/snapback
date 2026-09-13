# LLP 0129 super-refine journal

## Authorization

Charlie Cheever invoked `/llp-super-refine` on LLP 0129 on 2026-08-01,
the day the Snapback/Zero/Replicache bakeoff (LLP 0138) landed and an
uncommitted revision added `## Option-C empirical decision protocol`
to this Plan. That section had received no review; the Plan's earlier
v0.2/v0.3 text had already converged dual-family READY in the closed
`{0115, 0129}` lockstep loop (see `0115-0129-lockstep.super-refine.md`).

**Status boundary.** LLP 0129 is `Accepted`. `/llp-super-refine`
authorizes only a `Draft` → `Review` transition, so this loop cannot
move the document at all. It exists solely to make the document
correct. No status change is proposed or made.

## Runtime deviation, recorded

The skill pins orchestration to Claude Fable 5 Max. This loop was
orchestrated from **Claude Opus 5**. The invariants that carry the
loop's meaning are intact: each round used a fresh Claude Fable 5
reviewer and a fresh OpenAI `gpt-5.6-sol` Codex CLI reviewer at `ultra`
effort, neither of which was the orchestrating/editing session, and the
orchestrator belongs to neither reviewer family — so reviewer
independence is stronger, not weaker, than the pinned configuration.
Recorded here and in both artifacts rather than passed over.

## Mechanics

Per round: one fresh reviewer per family, mutually blind, both given
the same SHA-pinned revision and the same SHA-pinned instruction
capsule. Reviewers were barred from `llp/reviews/` entirely (this
loop's artifacts and the prior closed loop's), so no verdict is
contaminated by another reviewer's findings; the document's own
`**Revised:**` header is allowed. Reviewer sessions are never resumed.
Between rounds the orchestrator verifies decisive claims against the
tree before acting on them, then revises. Reviews are recorded verbatim
with provenance; verification and disposition notes sit outside the
verbatim body.

## Concurrency, recorded honestly

This is the shared primary worktree, edited live by other fleet
sessions. Two consequences the record should carry:

1. LLP 0138 and `issues/20260801-fleet-burst-mutation-not-visible.md`
   changed under the round-1 Codex reviewer mid-review; it pinned its
   reading to the hash-matched snapshots it was given and said so in
   its own §1 scope note.
2. **Another session applied most of round 1's findings concurrently**,
   working from the artifacts this loop had just written into
   `llp/reviews/`. The orchestrator did not clobber that work: it
   re-read the file, dropped the fixes already applied, resolved one
   direct contradiction in favor of the other session's stricter text
   (its "the browser-carrier half of the evidence gate is NOT CLEARED"
   disposition supersedes a drafted "gate stays CLEARED" sentence), and
   applied only the verified residue. Attribution below marks which
   fixes this loop applied itself.

## Round 1 — 2026-08-01

Target: LLP 0129 working tree at commit `a9286aba`
SHA-256 `0bbc11efcb0fa0994bbc0d4791b14751a48def6bd118973e69237e2ab805ecca`
Instruction capsule SHA-256
`5698b78a576c15327758e6bdf9d9629b0b02fbdc1a8e0c436798ba3390a36713`

**Both families NOT READY.** Fable: 3 material, 4 detail. Codex: 6
material, 1 multi-part detail.

The two families converged independently on the same lead finding: the
Revised header claimed the bakeoff **detected the recorded OQ4
trigger**, while the body, ER-1, and the new section's own detection
rule all say otherwise — the trigger is "the IR rung proves
insufficient … after measurement," the IR rung is unbuilt, and
detection is defined as Candidate A failing a frozen fact. Both also
independently verified the section's *body-level* evidence claim as
supported: the orchestrator confirmed Diary 0043's "duplicated the move
transformation in `update`" (line 91), Diary 0044's app-local sidecar
(lines 32–37, 99), and Diary 0046's two capability-gap findings (lines
141–142) against `demos/zero-bakeoff/reports/summary.md`.

Codex's heaviest finding was outside the new section and is the round's
most consequential result: **Phase 0's capability claims exceeded its
acceptance**, violating this Plan's own exit criterion 4. The
orchestrator verified it against the tree before acting, and it holds:

- `demos/public-dashboard/tests/acceptance/offline-local-first.mjs`
  sets `SNAPBACK_CLIENT_RQS_DIR` and asserts
  `rqsStoreInfo.implementation === 'file'` — the node/durable-file
  carrier, never a standards-real browser. The browser IndexedDB arm
  has `fake-indexeddb` unit tests only
  (`packages/snapback-client/rqs-store.test.mjs`, `rqs-resume.test.mjs`,
  `outbox-store.test.mjs`).
- No test in `packages/snapback-react` touches retention, `rqsStore`,
  or freshness — the "JS/React arm" was proven on its JS half only.
- The suite's one retention-refusal check asserts
  `SNAPBACK_RETENTION_NOT_RQS_ELIGIBLE` (a non-eligible **public**
  query). `SNAPBACK_RETENTION_NOT_RETAINABLE` — the auth-scoped/opaque
  refusal LLP 0053's retainability invariant actually governs — is
  produced in `packages/snapback-client/index.mjs` and asserted by no
  test in the repository.

No reviewer finding was refuted by verification.

### Round-1 dispositions

Applied by the concurrent session (this loop verified rather than
duplicated them): the header reworded to "credible browser-write
expressiveness pressure, not the recorded OQ4 trigger"; new
§When the lab can run (Candidate-A prerequisite = the Phase 1 evaluator
passing sizing + D5, owner/timebox gate, evidence home) and
§Interaction with intervening product work (baseline-freeze rule);
Candidate C's workload matrix resolved; `PASS`/`FAIL`/`N/A` gate
semantics with protected data as a hard nonclaim; the Candidate-C
`Parity` vocabulary pin; Candidate A restated against LLP 0133 lane L;
the owner-amendment boundary for shippable B/C mechanisms; LLP 0133
added to Related; OQ4's residue closed; "schedules no product phase for
it"; the two-builder role assignment; Playwright/CDP-class carrier and
real process kill; p95 sample count raised to 20; must-have facts
approved by the author before freeze; fresh check-ID namespaces; the
guide row narrowed to `partial` with a browser-carrier GAP and ticket
`issues/20260801-guide-gap-js-arm-browser-indexeddb-proof.md`.

Applied by this loop:

1. The Phase 0 **proof-scope correction** block — what the acceptance
   actually proves, the three things it does not, and the consequence
   for exit criterion 1 (the cold-boot beat is claimed at
   file-store/headless reach until a browser carrier proves it).
2. Exit criterion 2 rewritten: the arm-scoped row structure now partly
   exists, so the criterion states the *exact* remaining closure
   (`auth.authorized-leases` still arm-agnostic; `sync.offline-js-arm`'s
   reach must widen to browser/React/protected) and is falsified by a
   row whose stated reach exceeds its gating acceptance.
3. The protected-refusal half of the claim gap, which the concurrent
   fix did not cover: recorded in the guide row and added to the
   browser-carrier ticket, with the point that the browser witness
   cannot "avoid borrowing the Node result" for that fact because there
   is no Node result to borrow.
4. Safety gate 3 reconciled with LLP 0008's pinned v1 default
   (field-level LWW, delete-wins) — the gate demands no silent merge of
   a *semantic* conflict, not per-operation opt-in; a candidate wanting
   per-operation declaration is proposing a change to 0008 and must say
   so.
5. A standing nonclaim on gate 2 naming LLP 0138's retained Snapback
   FAIL (`issues/20260801-fleet-burst-mutation-not-visible.md`, open),
   so gate-2 passes inside the lab are not read as a general
   atomicity/visibility claim.
6. The decision lab added to §Measurement's named empirical questions.

`./ref-check` and `node scripts/check-guide.mjs` green after the pass
(the guide manifest was regenerated).

## Round 2 — 2026-08-01

Target: LLP 0129 working tree at commit `cfbee870`
SHA-256 `ea33e2e80433a42fd98f7849f48b0d0c587d8d509d45561c247400e014d2bd0d`

**Both families NOT READY.** Fable: 2 material, 2 detail. Codex: 4
blocking, 4 material.

A Codex round-2 session was killed by the harness before producing any
output. Per the skill's failure rule that attempt is not counted and no
artifact was written for it; a fresh session reviewed the identical,
unchanged target snapshot.

Both families independently found the same two defects — and both were
in text **this loop wrote in round 1**, which is the loop working as
intended:

1. The gate-2 standing nonclaim was stale. The Fleet failure had been
   re-diagnosed (all 1,000 writes durable; the defect was an implicit
   1,024-row query prefix silently treated as complete) and remediated
   on `origin/main` as `b52e3b9c`, closing as
   `issues/closed/20260801-fleet-query-implicit-limit.md`. The
   orchestrator had written the nonclaim from the pre-revision snapshot
   of LLP 0138 while the fleet corrected the underlying fact mid-loop.
2. Exit criterion 2 said `sync.offline-js-arm` was "shipped" where
   `guide/capabilities.md` records `partial`.

Codex additionally found four blocking defects in text that predates
this loop, three of them verified against their owning documents:

- **Phase 0 claimed `Parity`.** LLP 0043 pins "no local execution means
  no local-first/parity claim" and permits `Parity` "only for a
  store-configured surface whose complete mutation set is locally
  IR-derivable." Phase 0 ships no local execution by its own status
  text. CONFIRMED.
- **The gate disposition contradicted itself**, reading both "is
  CLEARED" and "NOT CLEARED" after the round-1 fixes from two sources
  met in the same block.
- **Safety gate 7 conflated four authority cases** that LLP 0053 keeps
  deliberately separate ("Not on this list, and deliberately so:
  session revocation … authority transitions, not authorization
  events"). CONFIRMED.
- **Phase 1's gate is D5-only** while the phase promises end-to-end
  `Parity` that needs lane-L settlement, id mapping, partial-read
  admission, schema fencing, and receipt projection — none of which D5
  exercises, and LLP 0133 is accepted *design*, not landed
  implementation.

No reviewer finding was refuted by verification.

### Round-2 dispositions

Applied: the `Parity` → `Online` correction at Phase 0 with LLP 0043's
rule quoted; one coherent gate disposition (implementation lane landed,
Phase 0's gate NOT met, phase not exited, SD-5 does not fire) replacing
the contradiction; exit criterion 2's literal terminal row set plus the
`partial` word aligned with the guide row; the Fleet nonclaim
re-diagnosed and moved from gate 2 to gate 9 with the remediation cited
(and reused as the worked example of the intervening-work freeze rule);
safety gate 7 split into LLP 0053's four cases with the fault matrix
following; the lab's start boundary declared not to depend on the
successor rerun; Phase 1's IR overlays carved out of the Outcome-2
freeze (closing a circularity where the freeze forbade the very surface
Candidate A needs); preregistered coherence ceilings for Candidate B so
the recorded burden metrics can affect the recommendation; trigger
detection made to distinguish IR insufficiency from collision with an
owned policy pin (LLP 0090 D3 named); the mobile spike and the lab
marked conditional research rather than completion requirements;
Outcome 3 renamed to name the lab's act; storage-eviction and
two-tab-contention faults added to the carrier matrix; the p95 sample
honesty note; `@snapback/client` → `@expo/snapback-client`; the
IndexedDB resolver qualified as requiring Web Locks too.

**Routed to the author rather than decided here** — three residues where
the reviewers exposed a genuine product/program decision, which per the
skill stops the loop from settling them unilaterally. New §Open
questions 7–9: Phase 0's gate disposition (split into landed
Node/file/public and open browser/React/authorized halves, or hold the
whole gate); whether Phase 1's D5-only gate should split into
evaluator/conformance and end-to-end shipping slices so SD-5 cannot
advance the phase on D5 alone; and Phase 2a's non-falsifiable exit
("the WASM assessment, dated" names no pass/fail condition) against the
Plan's own rule that a phase without a falsifiable criterion does not
exit.

`./ref-check` and `node scripts/check-guide.mjs` green after the pass.

## Round 3 — 2026-08-01

Target: LLP 0129 working tree at commit `1daf6aa4`
SHA-256 `ffb631508a063e33678de943d6a4c118b4eb12811063cfd515d5d50a3208e96f`
Instruction capsule SHA-256
`53bf0f6b7934cf764d2d74500fded1d4bcbf2d59bf7913662cddb8942543818d`

**Split verdict — Fable READY, Codex NOT READY. The loop did not
converge**, so the document was revised again rather than stopped.

Fable found no blocking or material concern: it re-derived the Phase 0
proof-scope facts independently, verified `b52e3b9c` via `git show`
(that commit is not an ancestor of this branch), confirmed the gate-9
reclassification against LLP 0138's corrected diagnosis and the v2
receipt, and judged ER-1 hygiene airtight. Its six concerns were all
DETAIL-grade.

Codex, on the same revision, found 3 blocking and 5 material. The
sharpest — and the round's most valuable catch — was that safety gate
7(b), which round 2 had just rewritten *to match* LLP 0053, used a
disposition name LLP 0053 does not have. Verified: 0053's table maps
"every ordinary coarse permission/activation/out-of-band revocation
event" to **`quarantine`**, and `delete` only to proof; its prose is
"Coarse events quarantine; only proof deletes," and it records that
mapping coarse events to `delete` was attempt four's bug. The v0.4 text
said "obligation-backed retirement." Also verified: no owning document
defines a degraded local external effect (LLP 0133 excludes action
replay; LLP 0126 pins them impossible offline), so gate 6's "degrade"
was not an executable condition; the guide still credited the untested
`SNAPBACK_RETENTION_NOT_RETAINABLE` refusal to the headless witness;
the acceptance script's header still called itself a self-advancing
SD-5 gate; and LLP 0133's §Status said `Draft` against `Accepted`
metadata.

Codex also found two genuine logic gaps in the protocol this loop had
been building: the "exactly one of three outcomes" claim was **not
total** (a pin-collision-only A failure, or an expressive-but-incoherent
B, fit none of them), and the trigger rests on a universal claim
("Candidate A cannot express F") for which the protocol had no rule of
proof.

No reviewer finding was refuted by verification.

### Round-3 dispositions (v0.5)

Applied: gate 7(b) rebuilt on LLP 0053's actual dispositions
(matcher-mediated delivery / coarse-event `quarantine` / proof-backed
`delete`), with the public-data-only case dispositions stated; gate 6
converted from "degrade" to a declared, frozen candidate sandbox that
denies external effects and ambient capability, with negative tests;
**Outcome 0** added to make the outcome set total; a
proof-of-inexpressibility rule added (one valid A implementation
defeats the claim; both independent attempts must fail the same fact
with sealed per-builder evidence; the missing primitive named and
owner-validated; B held to the same standard; authoring-time
descriptive only given fixed A→B→C ordering); a misattribution log
classifying every A gap as IR-inherent / pin-collision / missing shared
mechanism; the lab barred from scheduling before OQ8 is answered; the
Outcome-2 freeze carve-out widened to every mechanism an accepted
owning document already requires as substrate (lane-L id-map delivery);
the four mandatory measurements bound to phases and to the completion
boundary; and the Phase 2a falsifiability collision stated outright —
completion is unreachable until OQ9 is answered — rather than resolved
by quietly relaxing the rule. Fable's details folded in: the stale
2026-07-31 "CLEARED" header entry marked WITHDRAWN, and LLP 0138's
"appears to satisfy" phrasing named and superseded in the section
intro.

Out-of-document corrections landed in the same pass:
`guide/sync/offline-and-retention.md` stops crediting the untested
protected refusal to the headless witness; the acceptance script's
header stops calling itself a self-advancing SD-5 gate; LLP 0133's
§Status is reconciled to its `Accepted` metadata.

`./ref-check` and `node scripts/check-guide.mjs` green after the pass.

## Round 4 — 2026-08-01

Target: LLP 0129 working tree at commit `2506ed72`
SHA-256 `251ded42c41fcadd53cd343fbbd4bd572dcf29fea5919a35531b219138241989`
Instruction capsule SHA-256
`7f459f35f2ec635b25fa133f19358a04ad6bbc40f76b701f2bd659d64e1a6795`

**Second split verdict — Fable READY, Codex NOT READY (1 blocking, 5
material).** Severity is falling round over round (round 3: 3 blocking;
round 4: 1), and no finding in any round has been refuted by
verification.

The round's best result is a **cross-family convergence**: Fable's C2
and Codex's material 2 independently found that the Plan's worked
example for pin-collision misattributed a policy to LLP 0090. Verified —
0090 §D3 pins a *resume* rule ("a relaunching client with a non-empty
mutation outbox does not send `resumeFromToken`; it takes the 0043 path
… Composing resume with a pending outbox is milestone-3 work co-owned
by LLP 0043"), not a prohibition on restoring a labeled speculative
overlay. The Plan had inherited the stronger phrasing from Diary 0046.
Preclassifying that gap as a pin would have suppressed a legitimate
Candidate A deficiency before the attribution test ran.

Codex's two other decisive findings were verified in the tree and both
hold:

- The Phase 0 acceptance's "cold relaunch" is a **same-process**
  client/store re-instantiation — `closeClient(clientA)` then
  `openClient()` in one Node process, with only the server stopped. Not
  a client-process restart, so criterion 1's process-restart element is
  unproven on *every* carrier, not just the browser.
- The Notebook restart/rebase findings are immediate `suite.gap(...)`
  declarations plus a source audit. The bakeoff never restarted the
  pending client or introduced a concurrent edit, so the Plan was
  reading declared GAPs as executed observations.

Codex's blocking finding stands too: the v0.5 public-data-only `N/A`
branch was unsafe, because absence of protected retention does not
imply absence of authority-bound queues, overlays, or public retained
rows held by an authenticated client — and LLP 0039 requires authority
transitions to delete retained rows *and* queued mutations.

### Round-4 dispositions (v0.6)

Applied: "cold boot" restated as same-process client/store
re-instantiation with the process-restart element marked unproven
everywhere; the Notebook evidence restated as declared GAP plus source
audit; the LLP 0090 pin preclassification withdrawn, with pins now
requiring an owning document to adopt the prohibition before freeze;
gate 7's public-only branch narrowed so case (a) always runs when an
authenticated client is in scope, cases (b)/(c) made mutually exclusive
on lease expiry, and (d)'s resnapshot scoped to auth-scoped
subscriptions; one status vocabulary with fixed eligibility effects
(`FAIL` and `GAP` both disqualify); Outcome 0 surfaced in §Candidate
outcomes; Outcome 3 raised to two independent failed B attempts,
matching the proof rule it had contradicted; **SD-5 auto-advance
suspended for Phase 1** pending OQ8, closing a premature-advance path
that blocking only the lab had left open; exit criterion 2's closure map
extended with M1 implementation, protected-row promotion, and one
integrated authenticated React/browser/full-process-restart witness.
Guide corrections landed with it: the capability row states the
resolver's real prerequisites and fallbacks (IndexedDB **and** Web
Locks; a usable Node state directory; in-memory otherwise), and
refused-replay evidence is reattributed to the package unit test that
covers it.

`./ref-check` and `node scripts/check-guide.mjs` green after the pass.

## Round 5 — 2026-08-01

Target: LLP 0129 working tree at commit `2506ed72`
SHA-256 `80397b59b3251bd9c639e85a34d7e27ade322017c88243fcffecac886ccfea3a`
Instruction capsule SHA-256
`bbfbbf45b1c5dee903057691a163948dc480f3531d63dff1ec95c14a8e6d7d7e`

**Both families NOT READY.** Fable: 1 material, 6 detail. Codex: 3
blocking, 5 material.

Two of the round's findings were against text **this loop wrote in
v0.6**, which is the loop catching its own regressions:

- Fable C1: the reworded least-power selection rule contradicted B's
  coherence ceilings in Outcome 0's own case (ii) — B passes every
  workload and gate but exceeds a ceiling, so one sentence recommended
  Outcome 2 while another mandated Outcome 0. Exactly the shape v0.6
  had just repaired in Outcome 3.
- Codex blocking 1: v0.6 withdrew the cold-boot claim and re-asserted
  it three lines later.
- Codex material 6: v0.6's "SD-5 auto-advance is SUSPENDED" had this
  Plan amending a rule LLP 0130 owns — a constraint-7 violation by the
  fix for a different constraint problem.

Codex's most important finding was a genuine safety regression that had
survived two rounds of gate-7 rewriting: v0.5/v0.6 flattened LLP 0053's
durable, level-triggered shrink obligation — carried by an exact remove
delta or conservative replacement, discharged only on acknowledgement
of a snapshot at or after the causing version — into "the resnapshot
carries it." Without the ACK-backed discharge, a lost removal leaves
forbidden rows visible indefinitely. Verified. It also established that
the public-data-only `N/A` branch was still unsafe even after v0.6's
narrowing, because LLP 0053 defines auth-scoped **fail-closed**
("undeclared means auth-scoped") and LLP 0080 keeps even
all-`public-read` relational plans auth-scoped in v1.

Both families independently flagged ledger row 7's "unbuilt … no client
caller" as stale. Fable's framing was the more careful one and the fix
follows it: re-scoped to LLP 0008's journal-delta path and left **open
pending a dated wire-path verification** rather than marked landed on a
reviewer's reading.

No reviewer finding was refuted by verification.

### Round-5 dispositions (v0.7)

Applied: the least-power rule now includes each outcome's own
conditions; the cold-boot beat is **not claimed at any reach**, with
the guide prose and acceptance header corrected; the SD-5 language
reframed as invoking that rule's existing scope-change escalation
rather than suspending it; LLP 0053's shrink obligation and ACK
discharge restored to gate 7(b); lease expiry removed from (b)'s proof
list; the public-only `N/A` narrowed to require proof that nothing in
frozen scope is auth-scoped; the misattribution taxonomy extended with
candidate-implementation defect, harness/evidence defect,
environmental, ambiguous-frozen-fact, and unresolved — none able to
detect the trigger, each producing Outcome 0 plus a sealed rerun; gates
2 and 9 partitioned on commit-versus-visibility; the workload and
safety status vocabularies split into separate typed fields; ledger row
7 re-scoped.

**Routed to the author** as new §Open questions 10–11: what Candidate B
actually is and who owns it (without a frozen B language, two failed B
attempts cannot support Outcome 3), and who owns execution-identity
element 5's store-semantics profile and mismatch disposition.

Carried into round 6 rather than applied, to keep the round-6 target
pinned: Fable C4 (the refused-replay guide sentence covers the store
contract, not the client's refusal wiring, which is untested) and C7
(exit criterion 2's integrated witness has no owning ticket).

`./ref-check` and `node scripts/check-guide.mjs` green after the pass;
the edited acceptance script passes `node --check`.

## Round 6 — 2026-08-01

Target: LLP 0129 working tree at commit `449a43f7`
SHA-256 `5b04d52f0b908669a45226dba5d565d2f72641e7f6921cc9dbdb2ed15652474d`
Instruction capsule SHA-256
`2208029c14caa96ddd7e80e433ef816e39ac4023af0731bef0f0ca5b5131f992`

**Third split verdict — Fable READY (its third), Codex NOT READY (3
blocking, 2 material).** Both of Codex's genuinely new blockers were
defects in text this loop wrote, and both are CONFIRMED:

- Gate 6's v0.5 sandbox list said the candidate's complete input surface
  was the store, outbox, IR plan, and ledger "**and nothing else**."
  Read literally — and gate 6 binds every candidate — no arg-bearing
  Candidate A could execute, and Candidate C, whose defining artifact is
  an app-authored mutator rather than an IR plan, could not exist. LLP
  0051 D5 requires schema, initial rows, an IR plan **or module**,
  arguments, ledger, and principal; LLP 0133 treats explicit application
  arguments as validated data.
- "The matrix marks protected cases `N/A`" left "protected cases"
  undefined. Because `N/A` changes eligibility, the reading under which
  it waives gate-7 authority tests had to be closed outright.

Its remaining findings restate residues the document already routes to
the author (element 5's owner, the unowned integrated witness) or reach
documents this Plan does not own (LLP 0043/0053 still say "cold process"
for a same-process proof — their owners' amendment under constraint 7).

### Round-6 dispositions (v0.8)

Applied: gate 6's frozen surface rebuilt to bound *ambient* capability
while enumerating ordinary execution inputs against LLP 0051 D5 and LLP
0133; the protected `N/A` narrowed to the protected-retention
recommendation scope, with gate-7 applicability determined exclusively
by 7(a)–(d); exit criterion 3's element-5 harness raised from activation
carriage to conformance-plus-mismatch-tests, with the normative
consequence stated (criterion 3 cannot pass and no same-code claim may
ship until element 5 has an owner). Fable's four details applied: the
Notebook no-restart claim scoped to the Snapback arm (the Replicache
control *did* execute a concurrent rebase); the SD-5 clause rephrased so
it cannot be quoted against SD-5's own text; §Open questions reordered
9–11; the safety/workload vocabulary opener aligned with the typed-field
split. The guide's refused-replay sentence narrowed to the store
contract, disclosing that the client's refusal wiring is untested.

Two dangling obligations filed as tickets rather than left as prose:
`issues/shelved/20260801-js-arm-integrated-authenticated-restart-witness.md` and
`issues/20260801-cold-process-claim-vocabulary-collision.md`.

`./ref-check` and `node scripts/check-guide.mjs` green; the edited
acceptance script passes `node --check`.

## Program conclusion — 2026-08-01

| Round | Target | Fable | Codex |
| --- | --- | --- | --- |
| 1 | v0.4 draft `0bbc11ef` | NOT READY | NOT READY |
| 2 | v0.4 `ea33e2e8` | NOT READY | NOT READY |
| 3 | v0.5 `ffb63150` | **READY** | NOT READY |
| 4 | v0.6 `251ded42` | **READY** | NOT READY |
| 5 | v0.7 `80397b59` | NOT READY | NOT READY |
| 6 | v0.8 `5b04d52f` | **READY** | NOT READY |

Final revision: **v0.8**, SHA-256
`ef30e46a71e9c35b553bf01a7ce0c9a64bc05a6922eb9d458c9579787a7a186a`.
Status unchanged at **Accepted** — this loop never had authority to move
it.

**The loop did not converge, and it is stopped rather than continued.**
The skill's stopping rule is dual independent READY on one revision;
that was not reached. Its other stopping rule was: *if convergence
cannot be reached because the reviewers expose a human product decision,
stop and ask the author.* That is the situation. Across rounds 3–6 the
Codex family's blocking findings decomposed steadily into author-owned
questions — Phase 0's gate disposition, Phase 1's gate sufficiency,
Phase 2a's falsifiability, Candidate B's frozen definition and owner,
execution-identity element 5's owner — which are now §Open questions
7–11 and which this loop may not settle. Continuing would generate more
rounds without being able to close them.

Honest characterization of what the rounds produced: no reviewer finding
in any round was refuted by verification, and the severity trend was not
monotone — each fix opened new surface, and rounds 5 and 6 both found
defects introduced by the immediately preceding fix pass (the
least-power/ceiling contradiction, the cold-boot re-assertion, the SD-5
constraint-7 violation, gate 6's over-narrow input list). That is a real
signal about the section's complexity, not only about reviewer
thoroughness.

What the loop did accomplish, all verified against the tree rather than
narration: the Phase 0 claim/acceptance mismatch was found and
corrected across the Plan, `guide/capabilities.md`,
`guide/sync/offline-and-retention.md`, and the acceptance script's own
header; a withdrawn `Parity` claim that LLP 0043 forbids outright; a
mischaracterization of LLP 0090 D3 that both families caught
independently and that originated in the bakeoff's own receipt; a
restored LLP 0053 shrink obligation whose loss would have let a dropped
removal leave forbidden rows visible; a re-diagnosed Fleet nonclaim; and
five separate internal contradictions in the decision protocol.

**Author decisions this loop is waiting on** — §Open questions 7–11,
in the priority both families converged on: OQ8 (Phase 1's gate — it
gates SD-5 advancement *and* the lab's schedulability, so it is the
critical path), OQ10 (Candidate B's frozen language and owner — without
it the lab's ceiling is Outcome 0/1), OQ7 (Phase 0 gate split or hold),
OQ9 (Phase 2a's falsifiability — completion is currently unreachable by
the Plan's own admission), OQ11 (element 5's owner — criterion 3 cannot
pass without it).
