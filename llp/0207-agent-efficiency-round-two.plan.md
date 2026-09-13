# LLP 0207: Agent efficiency round two — the no-refusal failure layer

**Type:** Plan
**Status:** Withdrawn
**Systems:** Agent experience, Developer experience, Diagnostics, CLI,
Codegen, Guide
**Author:** Charlie Cheever / Claude
**Date:** 2026-08-09
**Revised:** 2026-08-09 (g — administrative: Withdrawn by author ruling;
dissolution note prepended. The dual-READY verdicts bind to revision (f);
no reviewed content below the note changed.)
**Revised:** 2026-08-09 (f — sixth same-day revision under the
super-refine loop (extension rounds author-authorized). (b) Draft→Review
+ S1 rescope onto LLP 0146 D7; (c) restructure to measurement-gated
commissioning; (d) P1a partition, operational gates, spike-gated
tombstones; (e) exhaustive partition, per-surface authorities,
external-validity requirement; (f) Swift exits ratcheted individually
(whole-arm deferral stays open), app-derived names get their own
authority, the external-validity escape valve removed (naturalistic
evidence only), tombstone projection dual-gated on feasibility and
demand. Round history: `llp/reviews/0207-*.run.md`)
**Related:** LLP 0186 (W1/W5 instrument), LLP 0193 (refusal quality;
consumes P1a's codes), LLP 0194 (symbol registry — proposed home for
lifecycle metadata), LLP 0202 (audit evidence), LLP 0203 (principles
P1/P2/P3/P6/P7), LLP 0146 (D7 substrate, D2 verifier), LLP 0156
(proposed evidence-bundle owner), LLP 0041 (publish-often posture), LLP
0189 (verification cadence)

> **Withdrawn (2026-08-09, author ruling) — dissolved to its owners.**
> This Plan reached dual-family READY at revision (f) (run record:
> `llp/reviews/0207-agent-efficiency-round-two.run.md`), and the author
> then ruled that what survived five review rounds did not justify a
> sixth coordination document: every live mechanism already belonged to
> an existing owner. Where the pieces went:
>
> - **Failure-to-recovery traces (P0.1)** → LLP 0186, dated amendment
>   (m), 2026-08-09.
> - **Authored symbol lifecycle facts + undeclared-removal refusal
>   (P1b)** → LLP 0194, dated amendment, 2026-08-09 — the one
>   time-critical piece.
> - **Uncoded-exit conversion (P1a)** → found already substantially
>   executed by fleet ticket work of 2026-08-08
>   (`issues/closed/20260808-uncoded-throws-and-untyped-client-errors.md`:
>   codegen `SNAPBACK_CODEGEN_*` family, client bare throws, typed
>   error exports, Swift stable codes, all through the registry drift
>   gate; `issues/closed/20260808-native-cli-machine-mode.md`: exit
>   taxonomy, `hostOpsResult` projection, coded `controls describe`
>   refusal with repair pointer) — confirming the dissolution rationale
>   that this work rode its existing tickets.
> - **Evidence bundle (was S5)** →
>   `issues/shelved/20260809-runtime-failure-evidence-bundle-proposal.md`
>   (proposal to LLP 0156).
> - **Feedback verb (was S6)** →
>   `issues/shelved/20260809-snapback-feedback-verb-proposal.md` (proposal to
>   LLP 0193 Phase 4).
> - **P2a/P2b/P2c and the tombstone/`whatsnew` projections** —
>   deliberately not commissioned anywhere. They remain evaluated-and-
>   deferred ideas whose demand gates never fired; the review artifacts
>   (`llp/reviews/0207-*.{claude,gpt-5}.md`) are the durable record of
>   why, including the rejected alternatives (deterministic replay,
>   code-frequency telemetry, diff-inferred renames, universal
>   `--dry-run`) — consult them before re-proposing any of these.
>
> The body below is preserved as reviewed at revision (f), plus this
> note (revision g, administrative).

## Summary

Round one (LLP 0186) and its executors made Snapback's refusal
*machinery* strong (its grading program, LLP 0193, is mid-execution). This Plan targets the layer that machinery cannot see:
**failures that never reach a `SNAPBACK_*` refusal** — the uncoded
codegen throw, the bare client-arm exception, the prose native failure,
the hallucinated or stale symbol that dies in typecheck. The audit
counted the raw population; what it cannot yet say is which of these
failure presentations actually cost agent sessions, so this is a
**measurement-gated commissioning plan**, not a six-lane portfolio.

What this Plan itself owns: (1) a failure-to-recovery trace added to the
LLP 0186 W1/W5 instrument, plus pre-registered commissioning gates; (2)
the **conversion program** — enumerate the genuinely uncoded failure
exits and convert each into a coded refusal or a recorded
classification, after which LLP 0193's existing ratchet and grading
absorb them; (3) the commissioning decisions for a small set of
mechanism extensions that land under their real owners (LLP 0146, 0194,
0203, 0156, 0193) — never as parallel machinery here. All mechanisms
obey LLP 0203 P1 (generated or gated, never transcribed) and P7 (one
result grammar). No new verifier, verb family, or *gate family*: the two
enforcement points below are extensions of LLP 0193's
diagnostic-inventory drift gate and of the publication qualification
pipeline, and are named as such where they appear.

## Evidence — and what it does not show

- **The no-refusal population is real, counted, and heterogeneous.**
  From LLP 0202: 20 uncoded codegen throws; uncoded bare throws on
  documented client subpaths; thrown mutation errors typed `unknown`;
  native CLI failures as prose with exit 1. These never become refusals,
  so they cannot carry LLP 0146 D7 candidates or enter LLP 0193's
  grading. Distinct and *excluded from this plan's inventory*: the 138
  undocumented client-raised codes are already coded refusals inside
  LLP 0193's graded population; they route to 0193, not here.
- **The flagship discovery loss is not this plan's failure class.** The
  three bakeoff arms that hand-rolled `defineRelationalQuery` failed on
  the *search* side — no wrong name was ever guessed, so no suggestion
  mechanism could have fired. That loss is owned by LLP 0203 P6. Whether
  agents also fail by *guessing wrong names* at the authoring layer is a
  hypothesis with no verified instance; P0 confirms or refutes it
  before P2a is sized.
- **First-error serialization is likewise unmeasured.** Run 5's action
  multiplicity (131 tool calls vs 39) shows Snapback lanes act more, and
  LLP 0186 W5 forbids decomposing that number into causes. Whether
  serialized validation cycles contribute materially is what the P0
  trace measures; P2b is gated on it.
- **Model-knowledge skew is future tense, honestly.** Snapback's public
  closure is weeks old and unlikely to appear in any current model's
  training data (not independently verifiable), and the
  observed skew channel — published skill/guide/template drift — is
  already fenced per LLP 0186's implementation record. P1b's ledger
  decision therefore rests on archival timing alone: rename facts not
  recorded at the change site are unrecoverable later.
- **No channel exists for out-of-checkout friction** (inferred from LLP
  0202 theme 5's surface inventory; the audit did not directly measure
  observability) — motivating the feedback-verb proposal to LLP 0193
  Phase 4, and nothing more in this plan.

## Program

### P0 — Measure first (gates every P2 commissioning)

1. **Failure-to-recovery traces in W1/W5 lane reports.** For every
   costly episode: the first failed action, its carrier class
   (`SNAPBACK_*` refusal · compiler/codegen diagnostic · bare not-found
   · silent discovery miss · other), semantic actions until recovery,
   and the recovery outcome. The trace schema also folds in W5's
   semantic-action classes (guide/reference lookups, orientation reads),
   so reorientation cost is observable without a failed action. A
   run-record schema plus post-run annotation — no runtime telemetry.
2. **A stale-knowledge / wrong-guess probe lane.** One W1 lane variant
   pinned to an earlier-closure surface description, one seeded with
   Convex-vocabulary priors, both run against the current closure. A
   synthetic probe is a *carrier test only*: it proves a presentation
   class occurs and is unserved, never that real sessions pay for it —
   demand evidence comes from the naturalistic requirement in the P2a
   gate.
3. **Gate registration.** Before the first measured run, each P2 gate is
   registered with its cost measure, denominator, recurrence/sample
   rule, commissioning threshold, and decider (the lane proposes; the
   author adjudicates, mirroring OQ2). "Costly episode" is defined here
   too. An unregistered gate cannot commission anything.

### P1 — Commission now (timing-critical or evidence-complete)

**P1a — The conversion program (owned here).** One bounded audit lane
over the *genuinely uncoded* authoring-layer failure exits — the 20
codegen throws, uncoded bare throws on documented client subpaths,
`unknown`-typed throw seams, and prose native-CLI failures (P7
machine-mode conversion) — partitioned explicitly from
already-coded-but-undocumented emissions, which route to LLP 0193's
grading. The Swift arm's uncoded client-originated errors are in scope
with their own enumeration sweep (the `.rs`/`.mjs` sweep cannot see
them), and its enumerated exit sites join the drift-gate ratchet like
any other; each Swift exit is converted or classified *individually* —
the arm's not-consumable status (LLP 0202 theme 5) is not a
classification, and any whole-arm deferral stays an **open** ledger
entry with a named owner and reopening trigger, which Outcome 2 counts
as unmet. Verify receipts carrying raw Node codes route to the open
`20260808-verify-trust-gaps` ticket, not here. Each in-scope exit
either mints a `SNAPBACK_*` coded refusal
(entering 0193's ledger and ratchet, carrying D7 candidates where the
substrate applies) or is recorded unreachable/out-of-scope with a
reason. Rides `20260808-uncoded-throws-and-untyped-client-errors` and
`20260808-native-cli-machine-mode`. Enforcement: the negative test that
refuses a *new* uncoded authoring-layer exit lands as an extension of
LLP 0193's diagnostic-inventory drift gate, scoped to the syntactic exit
sites the audit sweep can soundly enumerate. The boundary in one
sentence: LLP 0193 owns refusal quality; **this plan owns making
failures become refusals.**

**P1b — Authored lifecycle facts now; tombstone projection
dual-gated.** A symbol change records `replaces`, `removedIn`, and the
replacement identity *at the change site* (proposed as an amendment
landing under LLP 0194 and the publication pipeline; the same author
adjudicates); publication generates release diffs from
those authored facts and refuses an undeclared removal (an extension of
its existing qualification checks, not a new gate family). Renames are
never inferred from registry diffs — snapshots cannot distinguish
rename from remove-plus-add; the diff is only the safety net. The
*consumer projection* — codegen emitting renamed/removed names as typed
tombstones whose use fails typecheck carrying the migration text — is
commissioned only when **both** its gates pass: *feasibility*, a small
spike proving the diagnostic carrier per symbol shape (plain
`@deprecated` is advisory and fails nothing); and *demand*, a
naturalistic (non-seeded) P0 trace showing a stale-change episode whose
missing fact the projection would have supplied — the same trigger that
un-defers a standalone `whatsnew` projection. Error-vs-warning per
lifecycle kind and tombstone retention/name-reuse policy are decided at
the 0194 lifecycle-metadata landing.

### P2 — Commission on P0 evidence (gates registered in P0.3)

- **P2a — Authoring-surface suggestion extension**, landing under LLP
  0146 D7: extend the shipped substrate's typed candidates to codegen
  unknown-export failures, generated-binding diagnostics, and the
  native CLI (`controls describe <unknown>` included). Candidates come
  from the authoritative source *per surface* — the LLP 0194 registry
  (identities, signatures) for published package-surface symbols; the
  application's own codegen manifest / caller-visible served generation
  for app-derived names (schema fields, functions, generated-binding
  exports — the authority D7's shipped substrate already reads); the
  control catalog for native operations — each layered with a
  *generated alias join* (P6 alias/intent metadata lives in
  Rosetta/capability records, so the join artifact is part of the
  work); no surface borrows another's authority (P1). Gate: the probe
  lane exhibits wrong-guess presentations *that die unserved*, **plus**
  a naturalistic wrong-guess episode in a non-seeded scheduled lane's
  traces — synthetic evidence alone never commissions. No TypeScript
  language-service plugin unless enriched compiler/codegen diagnostics
  prove insufficient.
- **P2b — One aggregated static-diagnostic pass**, landing as a phase of
  LLP 0146 D2's `snapback verify` — not a new verb or verifier. Scope:
  all *independently knowable* static diagnostics (schema, functions,
  bindings) collected via structured APIs, batched in one P7-grammar
  result, joined to registry symbols, tombstones, and guide anchors —
  and no completeness promise beyond that scope. No universal
  `--dry-run` (preflight cannot predict authorization- or
  state-dependent outcomes). Gate: P0 traces show
  serialized correction cycles at or above the registered threshold.
- **P2c — Orientation fields on the canonical onboarding verb**,
  landing in LLP 0203 on whichever verb its open OQ1 canonicalizes
  (`snapback agent setup` is the default proposal; if OQ1 rules against
  any canonical verb, the fields are proposed to 0203's designated
  orientation surface instead, and absent an accepting surface the gate
  result is recorded with nothing commissioned): installed/deployed
  closure versions, schema digest, auth mode, runtime-readiness receipt,
  last verify outcome — every fact carrying identity and timestamp with
  explicit stale/absent states, per P3. Gate: P0 traces show repeated
  rediscovery of those facts at or above the registered threshold.

### Proposals to other owners (conditional, with fallbacks)

- **Evidence bundle, not replay** (was S5). A state digest cannot
  reconstruct state; deterministic replay would need the executable
  artifact, data snapshot, principal, environment, time, randomness, and
  external responses — a privacy/retention design far beyond this plan.
  Retained core: a sanitized, identity-bound local bundle on runtime
  failure (diagnostic, closure/build IDs, redacted request shape,
  principal class, readiness facts, bounded logs) converting
  reconstruction into inspection. Proposed to LLP 0156 as a spike (OQ3),
  contingent on its owner accepting the scope; if declined, it remains a
  filed ticket. Replay returns, if ever, as a per-operation-class
  replayability matrix there.
- **Feedback verb** (was S6). `snapback feedback` is proposed as an
  amendment to LLP 0193 Phase 4, whose grading loop is its consumer
  (0193 does not yet specify an intake verb); if declined, it remains a
  filed ticket, not a mechanism here. Code-frequency telemetry is
  dropped: it observes the refusal-reachable population, and frequency
  without denominator or outcome cannot feed one-attempt grading.

## Sequencing and ownership

P0 first — trace schema, probe lanes, and gate registration are week-one
work on existing W1 infrastructure. P1a and P1b's authored-facts half
run concurrently with P0; neither depends on its results. Each P2 item
is commissioned only when its registered gate fires, and lands under its
named owner — LLP 0146 (P2a, P2b), LLP 0203 (P2c) — with this plan
holding only the commissioning record. LLP 0156 and LLP 0193 decide the
conditional proposals addressed to them; LLP 0193 owns all
refusal-quality grading, including the codes P1a mints. Verification
follows LLP 0189: conversion and publication gates run in affected-scope
proofs; probe and eval lanes run on the scheduled cadence.

## Measurable outcomes

1. **P0:** every costly episode (as defined at gate registration) in the
   next two scheduled benchmark runs carries a carrier-class trace; the
   schema is part of the lane report format.
2. **P1a:** the partitioned uncoded-exit inventory reaches zero open
   entries — each converted or classified — with the lane's own
   per-class enumeration as the denominator, seeded by LLP 0202's named
   classes (counted where the audit counted); the extended drift gate
   refuses a new uncoded authoring-layer exit (negative test).
3. **P1b:** publication refuses an undeclared removal (negative test).
   The tombstone projection records one of two branches: *both gates
   pass* (feasibility spike positive, naturalistic demand trace
   observed) — the projection is commissioned with per-lifecycle-kind
   severity registered at the 0194 lifecycle-metadata landing, and each
   kind gains an eval case verifying its registered behavior (hard-fail
   kinds fail typecheck carrying the migration entry); *either gate
   fails* — the projection is not commissioned, the result is recorded,
   and the residual floor is stated explicitly: the authored release
   diff plus the publication refusal, joined by the P2a/P2b carriers
   only if their own gates fire.
4. **P2a–P2c:** each is commissioned against its registered baseline and
   threshold with a pass/fail delta on that same measure; a mechanism
   whose gate never fires is recorded as not commissioned — a success of
   the gating, not a failure of the plan.

## Open questions

- OQ1 (author): the typecheck-layer carrier — are tombstones plus
  enriched compiler/codegen diagnostics sufficient, or does any case
  justify a language-service plugin? Default: no plugin.
- OQ2: adjudication — grading authority for P1a's
  unreachable/out-of-scope classifications and for P2 gate decisions.
  Proposal: the lane proposes, the author adjudicates, spot-checked in
  review (mirroring LLP 0193 OQ2).
- OQ3 (author): the evidence-bundle spike proposed to LLP 0156 —
  content bounds, redaction contract, local-vs-hosted capture posture.
- OQ4 (author): the feedback-verb amendment proposed to LLP 0193 —
  endpoint ownership, retention, consent copy; fallback if declined.
