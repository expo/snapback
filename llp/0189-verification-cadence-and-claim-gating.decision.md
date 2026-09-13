# LLP 0189: Verification cadence and claim gating

**Type:** Decision
**Status:** Active
**Systems:** Testing, CI, Packaging, Documentation, Developer experience, LLP governance
**Author:** Charlie Cheever / Claude (Fable 5)
**Date:** 2026-08-07
**Revised:** 2026-08-25 (Active: linked into `llp/foundation/` as part of the
LLP v2 larger kernel)
**Revised:** 2026-08-10 (D-8 coverage-shape amendment, author-directed in
session, Charlie Cheever: system behavior is a cross-product of axes while
tests and docs pin points; two same-day defects from Diary 0074's probe sat
in uncovered cells — sessions-mode 3× frame delivery, shipping in card-game,
and the keyed-surface ephemeral-link omission. D-8 adds cross-cell parity
evidence on the battery cadence, named boot refusals for combinations a
construction path cannot serve, and cell-explicit claim scopes. D-1–D-7
unchanged.) 2026-08-07 (round-1 dual-family review amendments — mechanism
tightening only; the cadence ruling is unchanged: D-1 signature-keyed tickets,
claim cross-references, and escalation; D-3 mandatory demotion window,
scope-edit rule, and battery-red triage; D-4 semantic-role scoping, gate
quality bar, and input closure; D-5 semantic-conflict note; D-6 battery
containment and freshness; D-7 names the telemetry exact-current carve-out;
LLP 0175 Acceptance #10 and D2.4 re-scoped in the same landing.) 2026-08-07
(round-2 delta review, dual-READY: convergent minors only — signature-slug
ticket filenames, pending-marker escalation mirror, D-4 categorical sentence
qualified by semantic role, D-6 "eligible" wording, derived-fork sequencing
repair, legacy-digest temporary-scope fallback.) 2026-08-07
(D-3/D-4 implemented: claim-scoped v3 digests, nine-file coverage
transfer to registered canonical gates, and stands/invalid snapshot
classification — see the implementation ticket; battery-red automation,
piece 3, remains open.)
**Revised:** 2026-08-09 (author clarification, Charlie Cheever in session:
post-qualification evolution of a published derived-fork claim's scoped source
is a typed requalification-due state that stands until the next natural cycle;
publication-chain inconsistency remains a hard refusal.)
**Revised:** 2026-08-09 (author clarification, Charlie Cheever in session:
the derived-fork validator no longer borrows qualification-C custody of the
local persistent-store, relation/activity, or sequence-allocation publication
chains; their registered LLP 0175 drift gates retain integrity custody, while
post-C carrier regeneration is reported as ordinary scoped evolution.)
**Revised:** 2026-08-13 (optimistic-landing amendment, author ruling by Charlie
Cheever in session: D-2 defers ordinary `origin/main` frozen-record drift
verdicts to the scheduled backstop, which uses the LLP 0232 D-3 classifier;
affected product reds and semantic integration changes remain landing
concerns; irreversible release/promotion gates are unchanged.)
**Revised:** 2026-08-24 (temporary low-noise development posture, author
direction by Charlie Cheever in session: stop automatic main-push fan-out while
the repository is landing in bursts and several baselines are already red;
retain cheap/path-scoped feedback, PR affected proof, six-hour/manual complete
proof, and explicit qualification entry points; keep visibility widening
activation-disabled until protected custody exists.)
**Related:** LLP 0005, LLP 0010, LLP 0061, LLP 0154, LLP 0158, LLP 0162, LLP
0175, LLP 0185, LLP 0232 (D-4 health projection and ticket transitions
cross-reference D-1's battery-red tickets without weakening fix-forward or
claim rules),
issues/20260807-derived-fork-publication-wave-drift-requalification.md,
issues/20260803-wave3-program.md,
issues/20260806-main-red-agent-safe-leaf-set-drift.md

## Context

`main` lands continuously — the median gap between commits is about 0.1
minutes (LLP 0175's measurement), and many concurrent agent sessions push
around the clock. LLP 0175 already fixed the *CI* half of this problem: pushes
get fast/affected verdicts, and the complete canonical inventory runs on a
six-hour scheduled latest-main cadence instead of per commit.

But the *claim and publication* layer still binds exact commits, and that
layer keeps failing the same way:

- **The C27–C33 qualification loop (2026-08-05/06).** Seven successive Track B
  candidate cuts were abandoned because "the mandatory post-review fetch found
  newer main" before performance could run. The loop was broken only by an
  author ruling (recorded in
  `issues/shelved/20260803-0163-public-operation-identity-carrier.md`) that dual-READY
  reviews survive normal merges.
- **The derived-fork publication withdrawal (2026-08-07).** The
  `operating.instance-forks` claim landed at `7cada777b` after twelve review
  rounds — most of them spent hardening the publication gate rather than the
  feature — and was withdrawn about seven hours later (`a5465b4a2`) because
  wave landings changed nine proof/checker/metrology files inside its
  qualification digest. No fork runtime code changed. The claim died of
  unrelated churn.
- **The 433-commit red gate (2026-08-06).** An exact-count leaf-set assertion
  that any landing could invalidate went red and stayed red for 433 commits,
  blocking the npm promotion's "green local proof at the exact candidate SHA"
  precondition (that promotion has since closed) for every commit in the
  range.
- **Queued, overlapping verification.** Full proofs, qualification cycles, and
  review loops each take longer than the landing gap, so processes queue,
  overlap, and invalidate one another instead of converging.

The common defect: processes that gate landing, claims, or promotion on
*complete verification bound to an exact commit* are structurally incompatible
with this repository's landing cadence. Verification per commit must be cheap;
completeness must come from a schedule; claims must be snapshots that
unrelated landings cannot kill.

## Decision

Ruled by the author (Charlie Cheever), 2026-08-07. These are repo-wide
defaults; LLP 0005's honesty rules stay fully in force.

**D-1 — The scheduled complete battery is the authoritative verdict.** The
complete canonical inventory (LLP 0175 D2.3) runs on schedule — at least
twice daily; the current six-hour cadence satisfies this — and on demand.
Its red results become fix-forward filesystem tickets (one per root failure,
idempotent per still-open ticket, following the
`scripts/drift-prone-gates.mjs backstop` pattern) that the fleet fixes
promptly. A battery red does not retroactively invalidate unrelated landings
or standing claims; it names work. Tickets key on the root-failure signature,
not just the gate: each distinct signature gets its own ticket (the filename
carries a stable signature slug alongside the gate), a re-observation of an
unchanged signature updates its existing open ticket, and a new distinct
failure of an already-ticketed gate is never silently coalesced. When a red gate is
claim-relevant to a standing published claim (its D-4 scoped surface), the
ticket names that claim and the claim record names the open ticket while it
stands — "standing, with known red" is a visible state, and it feeds D-3's
triage. A red persisting across four consecutive scheduled runs escalates to
the author.

**D-2 — Landing gates stay fast and affected; frozen-record verdicts are
deferred by default.** Ordinary landings run the LLP 0175 D2.1/D2.2
fast/affected product checks. The pre-push hook still selects and reports the
frozen-record gates affected by the complete ref-update stream, but does not
execute them unless strict mode is explicitly requested. For revisions
targeting `origin/main`, their ordinary verdict moves to the scheduled LLP 0175
drift backstop, whose reds become
visible, attributable fix-forward tickets under D-1/LLP 0232. There is no
ambient same-change frozen-record blocking requirement.

Non-main ref updates are reported but are neither executed nor described as
scheduled in ordinary mode; a later `origin/main` landing is selected from its
own update. The backstop repeats clean content reds under LLP 0232 D-3 before
attribution, records contradictory determinate executions as nondeterminism
without a causal landing, leaves merge topologies that cannot support a
first-parent claim unattributed, and retains runner-setup self-health handling.

If the affected tests passed before integration, the tested semantic delta is
unchanged after merge/rebase, and integration required no semantic conflict
resolution, advancement of `main` alone does not require rerunning expensive
checks. Changed semantic inputs rerun their affected checks; known failing
affected product tests still require attention. No process, gate, or
qualification loop may require a complete battery at an exact commit as a
precondition for ordinary landing. Explicit strict drift enforcement and the
qualified protocols for publication, promotion, destructive migrations,
urgent security exposure, active destructive corruption, and similar external
effects remain available and blocking where their governing decisions require
it. (LLP 0175 implements the cadence; LLP 0232 owns landing economics.)

### Temporary low-noise development posture (2026-08-24)

Ruled by the author (Charlie Cheever), 2026-08-24. This is an explicit,
reversible operational exception to D-2 while direct pushes arrive in bursts
and known baseline failures make per-push GitHub Actions repeat an already
known verdict. In the measured hour preceding the ruling, 16 pushes produced
130 workflow runs: 66 failed and 40 were cancelled.

- `ref-check` remains on every push, and already path-scoped platform proof
  remains affected by path.
- `local-proof` remains on pull requests and on its six-hour/manual complete
  cadence, but not on every direct `main` push.
- heavyweight cold-clone, required-surface, and Linux-package proofs become
  explicit qualification actions rather than per-push actions.
- deployment-identity and generated-inventory checks remain available on pull
  requests and by explicit dispatch while their current baseline reds are
  repaired; restoration must add reviewed path selection rather than restoring
  unconditional main-push fan-out.
- visibility observation and reconciliation become explicit-only until their
  protected environment, signing material, and external custody exist.
  LLP 0234's fail-closed consequence is unchanged: no visibility widening may
  activate without the protected verdict.

No test, assertion, or qualification command is deleted. Publication,
promotion, destructive migration, urgent-security, active-corruption, and
other irreversible/high-danger protocols retain their own blocking gates.
Restoration is tracked in
`issues/shelved/20260824-restore-automatic-actions-after-low-noise-interval.md` and
requires an author-directed end to this exception.

**D-3 — Claims are snapshots.** A capability claim, publication, or promotion
binds the qualification commit and the scoped evidence surface it names
(D-4). It remains valid until a claim-relevant change lands without
requalification. Unrelated landings — including changes to wave-shared proof
harnesses, metrology, fixtures, or documentation — never invalidate a claim.
Withdrawal is warranted only when (a) the scoped surface changed without
requalification, or (b) the claim is discovered to be factually wrong. A
battery red on the claim's own claim-relevant gates is prima facie (b)
evidence and must be triaged through its cross-referenced ticket (D-1); a red
anywhere else never touches the claim. When the publication validator detects
(a), demotion is mandatory, not discretionary: within one battery period the
claim's advertised state drops to its prior honest tier or gains an explicit
requalification-pending marker naming the ticket, and that ticket names an
owner. A requalification-pending marker outstanding across four consecutive
scheduled batteries escalates to the author, exactly like a persistent
battery red (D-1). Editing a published claim's digest scope is itself a
scoped-surface change: a re-scope takes effect only with requalification or
fresh named-author acceptance binding the new scope. Requalification then happens
on the next natural cycle — the claim's normal qualification protocol at the
next scheduled opportunity — not as an emergency that races the fleet.

**D-3 clarifying amendment — 2026-08-09 (author ruling, Charlie Cheever in
session).** For an already **PUBLISHED** derived-fork record, post-C evolution
of the bound scoped source does not itself refuse or withdraw the publication.
The publication oracle reports the record as published with
`requalificationDue: { scopedChanges, since: C }`, emits a conspicuous warning,
and exits successfully so the drift-backstop pattern can ticket the next
natural requalification cycle. This applies only to post-C evolution. Any
inconsistency in the frozen claim chain — including digest, scope, acceptance,
receipt, or evidence binding mismatch; artifact tampering; historical-byte
rewrite; or C not being an ancestor — remains a hard refusal exactly as before.
Withheld-record behavior is unchanged.

**D-4 — Qualification digests are scoped to the claim.** A qualification
digest covers the claim-relevant surface only: the runtime/implementation of
the claimed capability plus the checkers that define that claim's semantics.
Wave-shared proof harnesses, metrology, and fixture files that neither define
nor affect the claim's semantics move out of claim digests and are protected
instead by their own frozen-record drift gates (the
LLP 0175 `driftProneGates` registry pattern; the R12-1 per-file gate in
`issues/20260807-codegen-declaration-has-no-drift-gate.md` is the model).
Coverage moves; it never vanishes: removing a file from a digest is legal
only in the same change that adds (or names the existing) drift gate covering
it. Scoping is by semantic role, not file category: a checker that defines
the claim's semantics stays in the digest even when wave-shared, and the
digest closes over the semantics-affecting inputs of its in-digest checkers,
pinned by content in the claim record. The scope classification is itself
part of the claim record the named author accepts. A replacement drift gate
must meet LLP 0175's admission bar — a genuinely recomputed value compared
against a committed frozen record; a content-hash pin regenerated alongside
any edit is presence, not coverage, and does not satisfy this rule.

**D-4 custody clarification — 2026-08-09 (author ruling, Charlie Cheever in
session).** The published derived-fork validator does not bind sibling
capability publication chains to the fork's qualification C. Post-C changes to
the local persistent-store carrier/anchor and the relation/activity and
sequence-allocation carriers are ordinary scoped evolution and therefore
appear in the fork claim's `requalificationDue` report. Their integrity is
owned by the registered LLP 0175 `local-store-publication`,
`local-store-carrier-receipt`, `relation-activity-publication`, and
`sequence-allocation-publication` frozen-record gates. Coverage moves; it never
vanishes. The storage record's own transform validation and every fork-chain
anchor, carrier, receipt, evidence, scope, acceptance, and ancestry binding
remain unchanged.

**D-5 — Reviews bind content, not HEAD.** This generalizes the 2026-08-06
landing-discipline ruling repo-wide: mutually blind dual-READY verdicts on a
cut remain valid across normal merges of newer `main`; only genuinely new
conflict-resolution work needs fresh scrutiny. Conflict-resolution work
includes semantic integration — adapting the cut to interface, schema, or
invariant changes merged from `main` — not only textual conflicts; the lander
judges which it was and records it. No process may require re-review solely
because `main` advanced.

**D-6 — Promotion and release preconditions reference the battery, not
per-commit proofs.** A candidate needs (a) green scoped evidence for exactly
what it claims, and (b) the most recent eligible complete battery green on
its claim-relevant gates, with any unrelated red gates ticketed and named in
the promotion record rather than blocking it. The referenced battery run must
have tested a revision containing the qualification commit — wait for the
next scheduled run or invoke the battery on demand; an on-demand complete run
over the same canonical inventory is eligible, the newest eligible completed
run controls (a newer red is never trumped by an older green), and a run
older than two scheduled periods is not "most recent." The claim-relevant
gate set is derived from the claim record's D-4 scope, not enumerated ad hoc
at promotion time. Existing "green local proof at the exact candidate SHA"
preconditions are re-scoped to this form.

**D-7 — Stricter per-claim protocols remain available by explicit author
ruling.** Where the author has ruled that a specific claim needs exact-commit
binding (for example, LLP 0162 Track B row 13's paired performance protocol,
and LLP 0175 D2.4's exact-current telemetry authority for frozen release
candidates under LLP 0154's trust contract), that protocol stands as written
until separately amended. The default is this
decision; extra strictness is opt-in per claim, never ambient.

**D-8 — Coverage shape: axes, cells, and parity evidence (added 2026-08-10,
author-directed in session, Charlie Cheever).** Snapback's observable
behavior is a cross-product of orthogonal axes — server auth mode
(dev/sessions), live-query family (declarative/JS), scope construction
(unkeyed/keyed), client arm, transport — while tests, demos, and guide pages
naturally pin *points* in that space. Defects then accumulate in the
uncovered cells and ship silently: on 2026-08-10 a single small probe app
surfaced two same-day instances — sessions-mode live updates delivered as
three byte-identical frames (present in the shipped `card-game` demo;
unnoticed because nothing counted frames in the sessions cell —
`issues/20260810-sessions-live-updates-delivered-three-times.md`), and the
keyed Contract surface omitting the generated ephemeral link family
(unnoticed because nothing booted that composition; fixed with
`SNAPBACK_CONTRACT_EPHEMERAL_UNSUPPORTED`, LLP 0034 §10.11). The ruling has
three parts:

1. *Cross-cell observables carry parity evidence.* A small parity-harness
   class in the canonical inventory runs one app across the axis cells and
   asserts the observables that must not vary or must match spec across
   cells: frames per commit version per subscription, envelope kind where
   the wire contract (LLP 0094) specifies it, the link families a surface
   construction returns, and teardown (a disposed subscription actually
   unregisters). It runs on the D-1 battery cadence; D-2 is unchanged —
   parity is battery evidence, not a landing gate.
2. *Unproven combinations refuse by name.* When a construction path cannot
   serve a declared combination of axis values, it refuses at boot with a
   stable `SNAPBACK_*` diagnostic naming the combination and what is
   missing (the pattern of `SNAPBACK_CONTRACT_EPHEMERAL_UNSUPPORTED` and
   the keyed-offline refusals), rather than degrading silently. Silent
   degradation across an axis is a defect class, not a documentation gap.
3. *Claims are cell-explicit.* A capability claim's D-4 scope names the
   cells its evidence actually exercised; evidence from one cell never
   extends a claim to another (a dev-mode proof says nothing about sessions
   mode unless the scope says so). This is D-4 scoping applied along axes,
   not a new digest mechanism.

## Consequences

- The derived-fork requalification
  (`issues/20260807-derived-fork-publication-wave-drift-requalification.md`)
  proceeds under D-4: first re-scope the digest with drift gates for the
  departing wave-shared files (landing the two deferred checker-hardening
  tickets in the same cycle), then select the fresh qualification C once
  against the re-scoped digest, and future wave landings stop rotating it. That ticket's "must not exclude them"
  constraint is superseded by this ruling — exclusion is permitted exactly
  when the same change installs the replacement drift gate.
- The two deferred checker-hardening tickets
  (`issues/20260807-review-prose-history-not-frozen.md`,
  `issues/20260807-codegen-declaration-has-no-drift-gate.md`) land as part of
  that same cycle.
- The wave 3 close condition ("a green named commit") is re-scoped per D-6 to
  the battery form; recorded in `issues/20260803-wave3-program.md`. The
  first-npm-promotion precondition that hit the same wall is already closed
  (`issues/closed/20260803-first-npm-latest-promotion.md`); future promotion
  ceremonies use the D-6 form.
- The pattern-based leaf matching follow-up in
  `issues/20260806-main-red-agent-safe-leaf-set-drift.md` (match
  content-addressed leaves by pattern under registered roots, enumerate only
  non-content-addressed leaves) is endorsed: it is the same principle — exact
  enumeration only where the enumerated thing is the claim.
- Battery-red ticket filing (D-1) extends the existing backstop pattern from
  drift gates to complete-proof root failures; implementation tracked in
  `issues/20260807-llp-0189-claim-snapshot-implementation.md`.
- Published claims still carrying legacy unscoped digests are not stranded:
  until re-scoped under D-4, the complete legacy digest serves as the claim's
  temporary scope — for D-1 cross-references, D-6 gate relevance, and D-3's
  (a) handling alike — so a legacy claim never falls out of battery tracking
  or promotion gating before migration. The derived-fork claim is the first
  re-scope, not a special case.

## Non-goals and preserved honesty

- No test or assertion is deleted. Frozen-record checks move from ambient
  same-change enforcement to the scheduled authoritative backstop and remain
  available synchronously through explicit strict mode.
- Battery reds are never ignored: each becomes an open ticket the fleet is
  expected to fix forward promptly, and D-6 forces promotion records to name
  any outstanding unrelated reds.
- Claims still name their qualification commit, digest, receipts, review
  heads, and named-author acceptance exactly as before; what changes is only
  which later events can invalidate them.
- LLP 0175's fail-broad selection is retained: unknown/broad paths select the
  configured tier, reported and deferred ordinarily or executed in strict
  mode.
- This decision does not slow the deliberate burst cadence on `main`, and it
  does not convert any `BLOCKED`/`FAIL` state into a silent skip.

## Required updates

- `AGENTS.md` working guidance — done in this landing.
- LLP 0175 — Revised pointer to this decision (its D2 cadence design is the
  substrate D-1/D-2 stand on), plus body re-scope of Acceptance #10 and the
  D2.4 release-claim sentence to the D-6 form, with the exact-current
  telemetry authority explicitly preserved under D-7 — done in this landing.
- `scripts/check-agent-safe-publication.mjs` digest scoping (D-4) and
  snapshot/withdrawal semantics (D-3) — implemented 2026-08-07; battery-red
  ticket automation (D-1) remains open in
  `issues/20260807-llp-0189-claim-snapshot-implementation.md`.
- Ticket amendments (requalification, npm promotion) — done in this landing.
