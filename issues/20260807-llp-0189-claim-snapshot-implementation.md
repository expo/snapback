# Implement LLP 0189 claim-snapshot and battery mechanics

**Status:** Open
**Opened:** 2026-08-07
**Systems:** Testing, CI, Packaging, Publication
**Related:** LLP 0189, LLP 0175,
`issues/20260807-derived-fork-publication-wave-drift-requalification.md`

LLP 0189 (Accepted 2026-08-07) rules that claims are snapshots with scoped
qualification digests, the scheduled complete battery is the authoritative
verdict, and landing/promotion gates reference the battery rather than
complete proofs at exact commits. Four mechanical pieces implement it:

1. **Digest scoping in the publication oracle (D-4).**
   `scripts/check-agent-safe-publication.mjs` (and the v2 digest machinery it
   verifies) must support a claim-scoped `IMPLEMENTATION_ROOTS`: the claimed
   capability's runtime/CLI plus the checkers defining the claim's semantics.
   Scoping is by semantic role, not file category: a semantics-defining
   checker stays in the digest even when wave-shared, the digest closes over
   the semantics-affecting inputs of in-digest checkers (pinned by content in
   the claim record), and the scope classification itself is part of the
   named-author-accepted claim record. Each wave-shared
   proof/checker/metrology file leaving a digest must, in the same change,
   gain (or name) a frozen-record drift gate in the LLP 0175
   `driftProneGates` registry that meets the admission bar — a recomputed
   value against a committed record; a content-hash pin regenerated alongside
   any edit does not qualify. Fixtures: a departing file without its gate
   refuses; an in-scope change invalidates; an out-of-scope change leaves the
   claim standing; a scope-manifest edit without requalification or fresh
   acceptance refuses; a semantics-defining checker cannot leave via a
   generic gate.

2. **Snapshot/withdrawal semantics (D-3).** The oracle's combined-tree check
   distinguishes "scoped surface changed without requalification" (claim
   invalid → mandatory demotion to the prior honest tier, or an explicit
   requalification-pending marker naming an owned ticket, within one battery
   period) from "only out-of-scope files changed" (claim stands). Editing a
   published claim's digest scope is itself a scoped-surface change. The
   2026-08-07 fork withdrawal is the motivating case: nine changed
   wave-shared files should not have invalidated the claim once scoping
   lands.

3. **Battery-red ticket automation (D-1) — SHIPPED 2026-08-16.** Extend the
   `scripts/drift-prone-gates.mjs backstop` pattern to the scheduled complete
   proof: each root failure files one idempotent
   `issues/YYYYMMDD-battery-<gate>-<signature-slug>.md` ticket, keyed on the
   root-failure signature (same gate + same signature = update the existing
   open ticket; a new distinct signature files its own ticket — never
   silently coalesces, and each ticket carries independent open/closed and
   consecutive-run escalation state). Tickets
   cross-reference any standing published claim whose D-4 scoped surface the
   failing gate is claim-relevant to, and the claim record names the open
   ticket while it stands. A red persisting across four consecutive scheduled
   runs escalates to the author. Dependent `BLOCKED` results do not file
   tickets.

4. **Capability-maturity validator re-scope — SPLIT 2026-08-16.** E2's own-
   corpus binding across the closed supporting target-profile population,
   E4(a)'s exact claim-surface audit/ref-check binding, and A5's actual-parent
   and staged-tree checks are implemented. Promotion still requires
   `candidateParentSha == candidateSourceSha ==` the transition's actual sole
   parent. The D-4 range relaxation is deferred to
   `issues/20260816-llp0134-d4-range-relaxation-needs-sound-derivation.md`;
   prior-receipt derivation, conditional range evidence, and the D-6 promotion
   receipt field were removed with that unsound path.

The derived-fork requalification consumes piece 1+2 (its digest re-scope) and
should be the first user; do not close this ticket until that requalification
has landed on the scoped digest and survived at least one subsequent wave
landing without rotation.

## 2026-08-07 implementation record — pieces 1 and 2

Pieces 1 and 2 are implemented in the publication oracle. A v3 qualification
digest binds a canonical `implementationScope` from the receipt itself; the
derived-fork scope is `crates/snapback/src/`, Cargo/build/submodule authority, and the two
publication-checker modules. Ambient v2 receipts remain readable while
withheld, but cannot publish without a fresh scoped qualification.

The exact nine wave-shared leaves behind the withdrawn 2026-08-07 digest now
transfer to registered canonical gates:

- `tests/agent_safe_publication_checker_v1.mjs` →
  `agent-safe-publication-fixtures`;
- `tests/ci_workflows_v0.mjs` → `ci-workflow-fixtures`;
- both versioned-seed conformance scripts and
  `tests/local_proof_inventory_v0.mjs` → `local-proof-inventory`;
- the four changed client-bundle baseline ledgers →
  `client-bundle-metrology`.

The transfer validator refuses a missing or falsely named gate. Combined-tree
evaluation now returns `stands` with enumerated out-of-scope drift, or
`invalid` with enumerated scoped drift. Fixtures prove both directions and
reproduce all nine wave changes standing while a one-byte `crates/snapback/src/` change
refuses.

Piece 3 (battery-red ticket automation) remains open. The live storage and
derived-fork anchors remain `withheld`; the upcoming requalification must mint
a fresh C, v3 receipt, evidence, reviews, and named-author acceptance before
any publication state changes.

## 2026-08-07 requalification round-1 checker findings

The Codex round-1 implementation review returned `NOT READY` on two D-4
custody defects in the v3 checker; Fable independently identified the same
scope and input-closure gaps as F2/F1. Both checker findings are closed in the
round-1 fix branch:

- A derived-fork v3 receipt must now carry the exact canonical
  `DERIVED_FORK_IMPLEMENTATION_SCOPE` before the receipt can select digest,
  snapshot, review, or evidence behavior. The v3 named-author acceptance
  contract carries and exactly matches that scope too.
- The round-1 repair put `scripts/local-proof-selection-policy.v1.json` in the
  canonical scope. Transfer validation accepts only the four exact reviewed
  registry entries, verifies their committed record paths exist, requires
  trigger rules (not record prose) to cover each transferred leaf, and pins
  each registered regeneration command. Post-C
  deletion/remapping/command-tamper fixtures all invalidate the claim.

The fresh named-author acceptance must also state Fable F3's residual v2→v3
departing class: `packages/snapback-codegen/`,
`packages/snapback-contract/`, and the rest of `tests/` beyond the nine
separately ledgered transfer paths. The exact accepted record classifies those
as qualification-time evidence/non-claim-semantics support that is re-inspected
at each fresh qualification; it may not silently imply that the nine explicit
transfer rows exhaust every path that left the ambient v2 digest.

Codex finding 3 is closed in the same dated round. App-root identity is now an
install-once authority: each first writer syncs a same-directory temporary,
uses a hard link as the atomic no-replace publication step, unlinks its
temporary, and fsyncs the directory. A losing writer reads and compares the
winner; the same identity succeeds idempotently, while a different identity
returns `SNAPBACK_FORK_APP_BINDING_MISMATCH` before mint or launch. Deterministic
two-party barrier tests cover both outcomes, the original 32-writer regression
still passes, and the complete `instance_fork::` library filter passes 52/52.

## 2026-08-07 selection-policy custody refinement

The round-1 Codex finding 2 explicitly sanctioned either scope membership or
an exact content pin read from qualification C. The first repair chose scope
membership, but routine fleet-selector registrations immediately demonstrated
that this would rotate the derived-fork qualification digest for wave-shared
policy evolution. This refinement takes the sanctioned content-pin branch and
supersedes only the second round-1 bullet above.

`scripts/local-proof-selection-policy.v1.json` is no longer in
`DERIVED_FORK_IMPLEMENTATION_SCOPE`. The v3 receipt and v3 named-author
acceptance instead carry `selectionPolicySha256`, the SHA-256 of the exact
policy bytes committed at C. Transfer validation reads those bytes through
Git at `C:path`, requires the receipt pin to match, parses that frozen policy,
and verifies its admitted gate record paths in C's tree. The acceptance pin
must exactly match the receipt pin.

Consequently, later working-tree or committed policy evolution is visible as
out-of-scope drift and does not rotate or invalidate the claim; it also cannot
change the transfer result already validated for C. Synthetic fixtures make
the live policy deliberately disagree with C, prove the claim still stands on
the C-bound transfer result, and refuse receipt/C or acceptance/receipt digest
mismatches. Both live anchors remain `withheld`, and no historical publication,
review, receipt, carrier, or acceptance artifact is changed.

## 2026-08-09 D-3 author clarification — evolution is due, inconsistency refuses

Charlie Cheever ruled in session that an already published derived-fork record
must not be refused merely because its claim-scoped source evolved after
qualification C. The oracle now keeps that record published and returns
`requalificationDue: { scopedChanges, since: C }`; its CLI emits a conspicuous
`PUBLISHED_REQUALIFICATION_DUE` warning and exits successfully so backstop
automation can ticket the next natural requalification cycle.

This supersedes the earlier piece-2 fixture expectation that one changed
`crates/snapback/src/` byte immediately makes the published record invalid. The replacement
fixture proves that one-byte evolution stands with typed requalification due,
and a companion fixture proves that publication-chain tampering still refuses
while that state is pending. Qualification-C digest and scope mismatches,
acceptance/receipt/evidence binding failures, artifact or historical-byte
tampering, and C-not-ancestor remain fatal. Withheld records are unchanged.

## 2026-08-09 D-4 final sibling-chain custody decoupling

Charlie Cheever ruled in session that the published derived-fork path must no
longer validate the local persistent-store carrier/anchor as a mechanical
transform of the fork's qualification C. The store chain belongs to the
separate local-store capability, and the god-file-split carrier regeneration
demonstrated that its structural evolution cannot honestly be reduced to the
old single-digest-substitution exception.

The oracle now applies `validateLocalStorePublicationTransform` only to a
published `agent_safe_storage_v1` result. For a published derived-fork result,
post-C changes to the persistent-store carrier/anchor and the relation/activity
and sequence-allocation carriers are ordinary scoped evolution: the claim
remains published with all changed carrier paths named in `requalificationDue`.
Integrity custody remains with the already-registered LLP 0175 frozen-record
gates `local-store-publication`, `local-store-carrier-receipt`,
`relation-activity-publication`, and `sequence-allocation-publication`, so
coverage moves and does not vanish.

Fixtures prove a structural four-file carrier regeneration validates the fork
as published with typed due paths, and prove structural persistent-store
carrier tampering selects and fails its own `local-store-publication`
conformance gate. The storage transform tests and all existing fork-chain
tamper negatives remain intact. Withheld behavior is unchanged.

## 2026-08-09 mechanical sibling-custody closure

The requalification review found that the preceding sibling-chain transfer was
described in prose but absent from the qualification-C transfer validator. The
oracle now carries a separate `DERIVED_FORK_SIBLING_CUSTODY_TRANSFERS` ledger
because these four source records remain inside the D-4 claim scope rather than
departing it. The persistent-store carrier and anchor map to their direct
recomputing owner, `local-store-publication`; the relation/activity and
sequence-allocation carriers map to their respective publication gates.

All four named chain gates — `local-store-publication`,
`local-store-carrier-receipt`, `relation-activity-publication`, and
`sequence-allocation-publication` — now have their complete admitted
record-path, trigger-rule, regeneration-command, and optional dependency
definitions frozen inside `scripts/check-agent-safe-publication.mjs`. The
receipt gate remains a required persistent-store chain owner without being
misrepresented as the direct recomputing owner of the carrier or anchor.
`validateDerivedForkCoverageTransfers` reads the policy bytes committed at C,
requires every admitted gate and record to exist there with that exact
definition, and separately requires each of the four sibling paths to match
its mapped trigger. The original nine departing transfers use the same exact
admission predicate.

The checker fixtures now refuse a C-bound policy missing any one of the four
required gates, refuse trigger removal for each mapped sibling path, and prove
the real policy at HEAD passes. The gate-selection pin covers all four paths,
closing Fable F-1. The storage claim's qualification-C transform, the fork
chain's own frozen bindings, and both live records' `withheld` state remain
unchanged.

## 2026-08-15 implementation record — pieces 3 and 4

Piece 3 now extends the frozen-record backstop pattern to structured complete-
battery results. Complete runs retain a normalized root-failure signature in
the gate JSONL. The battery projector files
`issues/YYYYMMDD-battery-<gate>-<signature-slug>.md`, never files a dependent
`BLOCKED` result, and keeps each signature's open/closed state and consecutive-
run streak independent. A determinate pass closes the signature, recurrence
reopens its one ticket, and the fourth consecutive red marks author escalation.
Ticket claim links are derived from each standing publication record's D-4
scope through the checked local-proof group/dependency map. Scheduled and
on-demand GitHub workflow runs invoke a report-only projector: their read-only,
throwaway checkout cannot own durable ticket state. The separate six-hour local
`com.snapback.local-proof-backstop` schedule runs the complete inventory in a
dedicated clone, invokes the mutating projector, commits open/closed/streak
changes under `issues/`, rebases, and pushes them to `main`, following the
existing frozen-record backstop's durable publisher shape.

Piece 4 updates `scripts/capability-maturity.mjs` to the 2026-08-07 LLP 0134
amendment. Promotion receipts now bind a D-4 claim scope, own-corpus E2 records,
the freshest D-6 battery reference, and an E4(a) candidate audit whose
`ref-check` scope exactly matches the claim. `candidateSourceSha` remains the
qualification revision while `candidateParentSha` may advance: the receipt
must name the exact range and a staged scoped-surface check, the validator
recomputes the range diff and refuses any claim-scoped path, and A5 compares
the transition's sole parent to `candidateParentSha` while preserving exact
source pins for candidate evidence. Introduction and demotion pin semantics are
unchanged.

This ticket remains **Open**. Pieces 1–4 are implemented, but closure is still
gated on
`issues/20260807-derived-fork-publication-wave-drift-requalification.md`
surviving one subsequent wave landing without qualification rotation. That
derived-fork requalification hold is the only recorded closure residue here.

## 2026-08-15 pieces 3 and 4 review-fix round

The initial NOT READY reviews were verified against the implementation and
their reported fixes landed in this worktree. Complete-battery projection is now
order-insensitive over an exact duplicate-free gate-id set, accepts
host-conditioned `NOT_SELECTED`, and normalizes TAP timing/temp-path noise.
The 2026-08-21 gate-reconciliation review-fix supersedes that one disposition:
complete batteries reject cadence `NOT_SELECTED`, while statically declared
host/policy absence uses structured, consumer-validated `INAPPLICABLE`.
The GitHub workflow is report-only; a separate six-hour local publisher owns
durable ticket commits. Reopen/reset removes stale author escalation, and
standing claims are discovered from the complete on-disk publication-anchor
registry, including `single_table_v1`.

The first maturity repair added a generic five-path D-4 authority floor before
trusting a receipt's scope, shared codegen's closed target-profile population,
required every supporting profile, and resolved each unrelated-red reference
to an open signature-keyed battery ticket at the candidate parent. That floor
closed only the reported `README.md`/`crates/snapback/src/manifest.rs` probe; it was not a
complete per-capability surface. The delta review correctly retained one
MATERIAL: a floor-only receipt could still omit runtime modules, semantic
checkers, conformance inputs, and capability manifests. LLP 0134's staged-audit
wording did match the advanced-parent validator, apart from the residual
diagnostic wording corrected below.

## 2026-08-16 final targeted D-4 scope closure

The range validator now derives a code-owned required scope for every promoted
id and requires the receipt's `claimScope` to be a superset, with the generic
five-path floor retained only as an additional minimum. Sources are ordered by
the capability's own authority:

- an earlier maturity D-4 promotion record supplies its accepted `claimScope`;
- a published agent-safe capability supplies its checked publication
  anchor/receipt and `implementationScope`; and
- otherwise a code-owned capability scope-source registry entry locates the
  source-owned publication/manifest record, runtime-module maps,
  conformance/acceptance paths, and semantic checkers. The shared closed target-
  profile definition and every capability-manifest input that drives E2 are
  added to every successfully derived surface.

The relation/activity pair is the first registry-backed entry. Its required
surface is derived from
`crates/snapback/src/local-relation-activity-publication.v1.json` (including `crates/snapback/src/local.rs`
and the schema-source modules), its conformance receipt/vectors/checker, the
maturity semantic checker, and both E2 capability manifests. A receipt that
names only the five generic paths now refuses and lists the omitted runtime and
conformance paths. A complete derived scope accepts. If any capability in an
advanced atomic set has no derivable surface, the range relaxation refuses with
`MATURITY_CANDIDATE_SCOPE_UNDERIVED`; equality of `candidateSourceSha` and
`candidateParentSha` remains the fail-closed pre-amendment path. The staged-
locator diagnostic now says it binds `candidateSourceSha`, matching the field
actually checked.

The full drift, proof-runner, capability-maturity, and CI-workflow reruns and
their verbatim results are recorded in `LANE_REPORT.md` under **Final targeted
D-4 closure**.

## 2026-08-16 fix round 3 — transition-bound latest-effective prior scopes

The remaining Codex round-3 MATERIAL is closed. A prior maturity promotion
receipt now contributes D-4 derivation authority only when its exact committed
bytes were introduced by a sole-parent commit whose maturity projection
actually promoted the receipt's exact capability set and whose parent matches
`candidateParentSha`. A schema-valid receipt added without that transition is
an orphan: it is ignored as a derivation source, so it cannot bootstrap an
underived capability or hide an intervening runtime change.

Selection is per capability and ancestry-latest. Older promotion scopes are no
longer unioned into the required surface. A fresh named-author narrowing is
honored only when every id has a genuine prior claim and the new receipt is
itself byte-bound to another actual promotion transition; this implements LLP
0189 D-3 without allowing an orphan or first promotion to self-authorize. The
independent agent-safe and code-owned capability-registry minima continue to
apply.

The regressions reproduce the four-step orphan-bootstrap attack and require the
real promotion to refuse with `MATURITY_CANDIDATE_SCOPE_UNDERIVED`. A separate
three-promotion history proves a genuine broad claim can be narrowed through a
transition-bound re-scope and that a later promotion derives only the narrow
latest-effective scope, without resurrecting the older broad path. The prior
complete-derived, floor-only omission, underived equal-pin, and candidate-drift
cases remain in the same suite. The four requested suite reruns and verbatim
results are recorded in `LANE_REPORT.md` under **Fix round 3**.

## 2026-08-16 lane split — piece 3 shipped, D-4 range deferred

This section supersedes the piece-4 completion claims in the dated records
above; those entries remain as review history.

Piece 3 is **SHIPPED**. Complete-battery root failures have signature-keyed
ticket automation, independent streak/open state, four-run escalation,
claim cross-references, report-only GitHub projection, and a six-hour local
durable publisher. Its implementation and tests remain unchanged by this
split.

Piece 4 retains only the parts that do not depend on range authority:

- E2 promotion evidence binds exactly the promoted capability set, a green
  own-corpus run at `candidateSourceSha`, and exactly every supporting member
  of codegen's closed target-profile population.
- E4(a)'s candidate audit and its `./ref-check --verbose` result exact-match
  the receipt's declared claim surface at that same candidate revision.
- A5 still derives the changed capability set from the transition, requires
  both equal candidate pins to match the actual sole parent, checks the exact
  promotion record/citation, and recomputes the landed staged-tree digest.
- `packages/snapback-codegen/target-profiles.mjs` remains as a standalone
  codegen artifact: codegen builds its own target map from it, while E2 reads
  the same closed population. It grants no range authority.

The D-4 range relaxation is **DEFERRED** to
`issues/20260816-llp0134-d4-range-relaxation-needs-sound-derivation.md` after
four review cycles found floor-only self-narrowing, orphan non-transition
promotion authority, and equal-pin promote/demote/re-promote bootstrapping.
The validator again hard-refuses unequal promotion pins. All prior-receipt,
derived-id, fresh-rescope, code-owned range derivation, conditional
`candidateRange`, and D-6 promotion-receipt machinery has been removed.

This ticket remains **Open** on two residues: the new D-4 range-design ticket,
and the existing derived-fork requalification requirement in
`issues/20260807-derived-fork-publication-wave-drift-requalification.md`.
