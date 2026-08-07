# Review artifact — LLP 0189, GPT-5 family

## Round 1 — 2026-08-07

- Reviewer: gpt-5.6-sol @ xhigh via codex exec 0.146.1, fresh session,
  capsule-only working directory (read-only sandbox)
- Target revision r1 (branch commit `485582c60`) sha256
  `9726125565d9b428feab289559b3438cce69851eaf17a40d65f9823b93ee0479`;
  capsule `78653c9a6f675353`; instructions
  `aac8a48a96b1b7a7088a818cc98c3f58e312f0f925af5454a9eae99398057ff3`
- Runtime 326 s (a prior launch failed in 0.7 s on a git-repo check before
  any model output; not counted). External send authorized by the author's
  explicit invocation; capsule inventory = the six files hashed in the run
  record. Note: the runner read the generic `llp-review` skill file from the
  local machine before the capsule; no 0189 review artifacts existed anywhere
  at launch, so blindness holds.
- Author scope guidance in force: cadence philosophy ruled, mechanism flaws
  in scope
- Body below is verbatim from the reviewer's final message.

---

# Review of LLP 0189: Verification cadence and claim gating

**Target:** `0189-verification-cadence-and-claim-gating.decision.md`  
**Verified SHA-256:** `9726125565d9b428feab289559b3438cce69851eaf17a40d65f9823b93ee0479`

## Overall assessment

The core ruling is coherent and appropriate for the stated fleet economics: fast/affected landing checks, scheduled completeness, and snapshot claims avoid requiring a quiet `main`. D-7 also correctly preserves genuinely claim-specific strict protocols.

The current revision is not ready because several mechanisms can lose coverage or preserve a stale claim while still complying literally with the decision. These concerns can be resolved without restoring complete exact-commit gating.

## Strengths

- D-1 and D-2 cleanly separate per-change attribution from repository-wide integration coverage.
- D-3 preserves qualification provenance rather than pretending historical evidence becomes fabricated when `main` advances.
- D-4 requires same-change replacement coverage instead of permitting silent file removal.
- D-6 correctly prevents unrelated failures from becoming ambient global promotion blockers while still requiring them to be disclosed.
- D-7 provides an explicit escape hatch for claims whose evidence genuinely requires exact-commit coupling.
- The implementation ticket correctly excludes dependent `BLOCKED` results from root-failure ticket creation.

## Concerns

### MATERIAL — The claim-relevant surface is not defined or checked fail-closed

D-3 says a claim remains valid until “a claim-relevant change lands without requalification,” and D-4 defines the digest as “the runtime/implementation of the claimed capability plus the checkers that define that claim’s semantics.” The implementation ticket reduces this to claim-scoped `IMPLEMENTATION_ROOTS`.

A roots-based digest only detects changes already inside the declared roots. It does not necessarily detect:

- a newly introduced dependency outside those roots;
- changes to shared runtime, schema, build, configuration, or toolchain inputs;
- changes to the scope declaration or its resolution algorithm;
- a new file that becomes semantically relevant but is not covered by an existing pattern; or
- changes to the mapping used by D-6 to decide which battery gates are “claim-relevant.”

LLP 0175’s fail-closed affected-test selector does not automatically make the separate claim digest fail-closed. An implementation can therefore classify a real behavioral dependency as out of scope, leave the digest unchanged, and honestly report that the claim stands. Likewise, without a frozen claim-to-gate mapping, a promotion ceremony can classify a red gate as unrelated after seeing its result.

The claim record needs to bind an immutable, versioned scope manifest containing the scope algorithm, resolved dependency closure, claim-relevant gate IDs and prerequisites, and replacement-gate mappings. Changes to that manifest or closure must themselves be claim-relevant. Adding an external dependency must fail closed until the claim is re-scoped.

D-3 must also require an active publication to be atomically requalified or withdrawn when that check detects a relevant change. “Withdrawal is warranted” plus requalification on a later natural cycle does not ensure that a now-invalid public claim is actually withheld in the interim.

### MATERIAL — A frozen-record drift gate is not generally equivalent to qualification-digest coverage

D-4 says:

> “Wave-shared proof harnesses, metrology, and fixture files move out of claim digests and are protected instead by their own frozen-record drift gates.”

It also says the digest includes “the checkers that define that claim’s semantics.” A checker can be both wave-shared and semantics-defining, so the categorical removal rule conflicts with the semantic inclusion rule.

More importantly, LLP 0175 defines a drift gate narrowly: it recomputes a value from current source and compares it with a committed frozen record. That proves present source/record consistency. It does not prove that evidence produced at the qualification commit remains sufficient after a harness, checker, fixture, or metrology rule changes.

For example, a shared checker can add a previously untested invariant while its associated record is regenerated correctly. The drift gate passes, but the standing claim’s qualification never exercised the new invariant. D-3 nevertheless treats the shared-checker landing as unrelated.

Departure from a digest must therefore depend on semantic role, not file category. A semantics-defining checker must remain in the claim surface or trigger requalification when it changes. A drift gate should be accepted as replacement coverage only under an explicit contract showing that it revalidates the claim-relevant invariant, rather than merely keeping a current frozen record synchronized.

### MATERIAL — Battery ticketing can hide new failures and allows an unbounded red queue

D-1 promises “one per root failure, idempotent per still-open ticket.” The implementation ticket instead specifies one `issues/YYYYMMDD-battery-<gate>.md` ticket using an open gate marker as its idempotency key.

Those are not equivalent identities. If gate `G` already has an open ticket for failure A and a later battery reports A plus independent failure B, gate-level idempotency can suppress B. Nothing requires the existing ticket to be updated with new fingerprints, latest observations, or affected claims.

The decision also gives “fixes promptly” no operational meaning: there is no owner, acknowledgement bound, aging or escalation rule, recurrence update, or closure requirement tied to a later green battery. A permanently red prerequisite can leave dependent gates `BLOCKED` indefinitely, creating an expanding verification blackout while the system continues to satisfy the ticket-filing rule.

The mechanism should require:

- stable failure fingerprints beneath the gate identity;
- creation or update for every newly observed root fingerprint;
- first-seen, last-seen, latest tested revision, recurrence count, and owner;
- bounded triage and escalation for aging red or blocked coverage;
- closure only after a later canonical battery proves the root green and permits blocked descendants to execute; and
- claim-impact triage, so a confirmed failure of a standing claim invokes D-3(b) rather than remaining merely ticketed.

These controls add teeth to fix-forward handling without blocking unrelated landings.

### MATERIAL — D-6 can authorize from a stale or superseded battery verdict

D-1 runs the authoritative battery both on schedule and on demand, but D-6 requires “the most recent scheduled complete battery” and gives no freshness bound.

This permits several contradictory outcomes:

- If scheduled execution stops, an arbitrarily old green remains the “most recent scheduled” result.
- A newer authoritative on-demand red can be ignored in favor of the older scheduled green.
- An on-demand green proving a fix cannot supersede the prior scheduled red.
- Missing, cancelled, or infrastructure-failed scheduled runs have no defined effect.
- “At least twice daily” constrains intended production but does not make consumers reject stale evidence.

This also drops LLP 0175 D2.4’s explicit requirement that the applicable matrix be “recent and green.”

D-6 should define an authoritative-battery record and precedence rule: eligible scheduled and on-demand runs must use the same canonical inventory against latest `main`; the newest eligible completed run controls; the result has a maximum age derived from the cadence; missing or infrastructure-incomplete execution is not green; and promotion records bind the run ID, revision, completion time, inventory identity, and relevant gate results. Diagnostic manual runs against arbitrary revisions should be marked ineligible rather than silently entering that ordering.

### MATERIAL — “Only conflict-resolution work” is too narrow to define review-content stability

D-5 says reviews survive normal merges and that “only genuinely new conflict-resolution work needs fresh scrutiny.” The desired content-not-HEAD rule is sound, but the decision never defines the content to which a review binds.

A conflict-free merge can change a reviewed change’s semantic context: an imported API, shared schema, security invariant, generated projection, or dependency can change in another file without producing textual conflict. The reviewed patch bytes may be unchanged while assumptions considered by the reviewers are no longer true. D-3 requalification can retest behavior, but it does not replace design, security, or governance review.

Each review should bind a reproducible content manifest: reviewed patch or files, relevant contextual inputs, generated artifacts where applicable, and the manifest algorithm. Re-review should occur when that manifest changes or genuinely new resolution work is introduced—not merely because HEAD advanced, and not only when Git reports a conflict.

### MATERIAL — LLP 0175 remains normatively inconsistent with D-6

LLP 0189 D-6 permits promotion when claim-relevant battery gates are green and unrelated reds are ticketed. LLP 0175 Acceptance item 10 still requires:

> “a complete latest-main proof is green before release or capability promotion.”

The landing diff only adds a revision-history pointer to LLP 0175; it does not amend this normative acceptance criterion. Consequently, one accepted document requires the entire battery to be green while the other expressly permits unrelated reds.

LLP 0175 also preserves exact-current telemetry as a release/promotion obligation. That may correctly qualify under D-7, but LLP 0189 does not name it, so an implementer cannot tell whether D-6 re-scopes it or D-7 preserves it.

The normative clauses in LLP 0175 should be amended directly: replace its ambient whole-battery requirement with D-6’s relevant-gate rule, while explicitly listing any exact-current protocols preserved under D-7.

### MINOR — The implementation ticket lacks boundary acceptance fixtures

The ticket requires a fixture proving that a departing file without a drift gate refuses, but that alone does not exercise the core state transitions. It should also test:

- an in-scope change invalidates an active claim;
- an out-of-scope change leaves it standing;
- a scope-manifest or dependency-closure change fails closed;
- a semantics-defining shared checker cannot leave via a generic drift gate; and
- withdrawal and requalification update the public carrier atomically.

These are implementation-phase acceptance details, but adding them would prevent regressions at the exact boundary LLP 0189 introduces.

## Recommended next step

Revise D-1 and D-3 through D-6 to define the claim manifest, replacement-coverage standard, withdrawal state transition, battery-record precedence and freshness, lossless ticket lifecycle, and review-content identity. Amend LLP 0175’s conflicting normative clauses in the same revision, then repeat independent review.

VERDICT: NOT READY