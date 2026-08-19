# LLP 0232: Landing economics and the green pointer

**Type:** RFC
**Status:** Accepted
**Systems:** Source control, CI, Testing, Developer experience, Agent operations
**Author:** Charlie Cheever / GPT-5.6 (codex, lead author rev2) / Claude (Fable 5, rev1)
**Date:** 2026-08-11
**Revised:** 2026-08-11 (round-1 dual-family NOT READY; codex lead-author rewrite recenters content-keyed landing economics, makes `green` health state, and constrains sheriff authority)
**Revised:** 2026-08-11 (round-2 dual NOT READY; contract repair for per-gate reuse, closed outcome typing, proof-producer boundaries, and deferred revert activation)
**Revised:** 2026-08-11 (round-3 delta convergence — pre-existing text clean across families; in-delta punch-list repair; this revision unreviewed per LLP 0010 §2 delta rule)
**Revised:** 2026-08-11 (Accepted by author ruling, Charlie Cheever in session: all three requested rulings granted as specified — 24h owner priority then fix-forward-by-anyone; narrow baseline-corroborated reversal of LLP 0175 D2.1 infrastructure fail-closed; future separately-reviewed revert-activation decision permitted. Acceptance recorded with the rev4-unreviewed label acknowledged; final review verdicts bind to rev3. LLP 0175 amendments landed in the accepting change.)
**Revised:** 2026-08-13 (optimistic-landing living amendment, author ruling
by Charlie Cheever in session: ordinary `origin/main` pushes select but defer
frozen-record drift gates; explicit strict mode retains D-3 synchronous
enforcement; the scheduled backstop now uses D-3 classification and
same-closure contradiction detection; irreversible/high-danger operations and
known affected reds remain blocking; the observed closure binds the complete
installed dependency mirror, including linked package targets)
**Related:** LLP 0189, LLP 0175, LLP 0225, LLP 0041, LLP 0005,
`issues/closed/20260810-prepush-gate-battery-landing-livelock.md`

## Summary

Make repeated landing work cheap before changing how the fleet branches. A successful
gate result becomes a per-gate, content-keyed receipt reusable after a rebase when its
verified semantic input closure is unchanged; heavyweight gates reuse prepared runtime;
infrastructure outcomes become narrowly typed, corroborated, ticketed evidence; and
generated records become rebase-stable or seconds-regenerable. These are required work.

Keep the green pointer inside a machine-readable main-health projection naming the last
completely green SHA and current producer-labeled reds. It supports triage and an optional
branch-cut pilot, not proof or a mandatory base. Keep repair routing advisory and
fix-forward-default. This RFC defines eligibility conditions for a possible automated
revert but grants no source-mutation authority; activation requires a later reviewed decision.

## Evidence and decision weight

Push failures appeared in 41 of 176 sessions, but gate-block lines outnumbered race lines
177 to 26. A plain fetch/rebase/repush took about 1–2 minutes; one measured regeneration
and re-verification cycle took 69 minutes. Forty-two sessions used the generated-file
conflict pattern, 16 used the loud bypass, and 128 raw events blocked because a gate could
not reach a staleness conclusion. Repo history estimates about 14% of 3,372 commits as
integration/regeneration churn.

The livelock ticket measures a roughly 10-minute Rust-core pre-push battery against an
approximately 8-minute landing interval and six-plus lost green cycles. Prepared runtime
reuse and safe receipt transfer address that dominant cost. Broken-base investigation appeared in 31 sessions: real but secondary, so health and branch-cut mechanisms stay small.

## Design

### D-1. Per-gate content receipts

The LLP 0175 registry contract adds a versioned `semanticInputClosure` for every gate in
the frozen-record registry (the 18 drift-prone gates). Trigger rules select gates; they are
not closures. Admission follows LLP 0189 D-4's bar: the reviewed declaration must close
over every semantics-affecting, transitive input to the prepare and check commands,
including source, generated inputs, toolchain, platform, and relevant environment. Content
pins and mutation fixtures must show each declared input class changes the closure digest.
An incomplete or uncomputable closure fails closed to execution; changing the declaration
or registry invalidates prior receipts.

Each successful gate emits an execution receipt binding gate id/version, closure schema,
input blob map and digest, command identities, toolchain/environment identity, old selector
base and selector digest, tested revision, and determinate result. The checked validator,
not the receipt, is authoritative.

Retry reuse is one transaction: validate the prior execution receipt and its old selector
base; resolve the new remote selector base; recompute old and new selections; recompute
each selected gate's old and new closures; reuse that gate only when its prior result is
green and its version and verified closure are byte-identical; run every other selected
gate; then emit a derived validation receipt binding all reuse/execution decisions to the
new pushed revision and its gate-relevant projection. The projection—not whole-tree hash
equality—is what transfers. Always-run status alone never invalidates an unchanged gate
closure, and an intervening commit's selecting a gate is not independently disqualifying.
Strict-mode receipt reuse is defined only when the push contains exactly one
eligible ref update targeting `main`; a strict multi-ref push runs all selected
gates. Ordinary mode follows the 2026-08-13 amendment below.

`auth-invalidation-report` must honestly approximate the Rust build closure, including
the crate, Cargo/build/toolchain inputs, acceptance inputs, and runtime qualification.
Reuse is therefore strongly expected for the evidenced core-versus-docs/LLP races and
weakly expected for core-versus-core races. No broader economic claim is made.

Fixtures must prove tamper refusal, selector/registry/closure invalidation, same-gate
invalidation, merge/rewrite handling, and non-vacuous reuse under representative traffic,
including docs/LLP commits racing a heavyweight core landing. A valid derived receipt also
licenses skipping discretionary post-rebase re-verification covered by unchanged gates;
new semantic integration or uncovered checks still run. Red or indeterminate evidence is
never reusable as green.

### D-2. Prepared execution and rebase-stable records

`auth-invalidation-report` consumes a digest-bound runtime-readiness receipt when the
binary and its semantics-affecting source, toolchain, platform, and qualification closure
match. “Source” means that closure, not exact commit identity. A miss performs the current
cold bootstrap; readiness reuse removes work, never proof.

Each registered frozen record must become invariant under gate-disjoint rebases or
deterministically regenerable in single-digit seconds. An expensive executable check may
remain only behind D-1 reuse. Exact-commit, ambient-toolchain, and calendar inputs leave a
record unless semantically required. Coverage may move only in the change installing an
equally honest replacement gate, per LLP 0189 D-4 and LLP 0175.

The inventory covers every record, starting with guide projections, diagnostics registry,
deployment identities, receipts, codegen, and metrology. Restoring discrimination after
guide-warning saturation is a named follow-on, not a goal of this RFC.

### D-3. Closed outcome classification and ticketing

After collecting required executions, the pre-push runner evaluates these mutually exclusive outcomes in the listed order per gate:

- `NONDETERMINISTIC`: contradictory determinate executions over an identical verified closure; it blocks as a control-plane failure, supplies no attribution, and enters ticket/backstop handling below.
- `PASS`: a determinate check passes.
- `INFRASTRUCTURE`: only a runner-controlled setup/provision failure whose normalized signature reproduces at every required merge-base through existing baseline-attribution machinery; it proceeds. A green, different, or unavailable baseline does not corroborate it.
- `INHERITED_RED`: a determinate content failure is classified here only when the same normalized signature reproduces at every required merge-base; it proceeds, and absence of a pre-existing ticket never re-blocks the lander.
- `CONTENT_RED`: any other determinate content failure, including a content-caused prepare/check failure; it blocks, preserving pushed-revision build breaks.

Anything outside those proofs is unknown classification, blocks as a control-plane failure,
and cannot be coerced into `INFRASTRUCTURE`. For `INHERITED_RED`, `INFRASTRUCTURE`, and
`NONDETERMINISTIC`, the pre-push runner emits an idempotent, signature-keyed durable signed
ticket request as part of its receipt output. An explicitly authorized least-privilege
source-ticket publisher—the same class as D-8's other publishers, or the existing backstop's committing identity—validates the request and projects it onto `main`. `INHERITED_RED` and `INFRASTRUCTURE` proceed on the recorded request, not main-committed ticket state; `NONDETERMINISTIC` remains blocking. The explicit unticketed interval is bounded by the next two-hour backstop cycle, which retries all three outcomes and ticket projection.
`module-ownership` retains its set-based predecessor protocol and never enters generic
Boolean inherited-red attribution. No indeterminate result may support repair attribution,
revert, claim, or promotion.

Adversarial fixtures must cover pushed Rust build failure, baseline setup failure,
signature mismatch, unavailable baseline, contradictory same-closure runs, unknown output,
and ticket idempotency. The acceptance target is zero blocks only for corroborated
infrastructure—not for unclassified or push-introduced failures.

### D-4. Health records, producer map, and green pointer

Two authenticated append-only external ledgers remain distinct and feed one projection:

| Health field | Authoritative producer and transition |
|---|---|
| latest canonical observation: main/tested SHA, run id, completion, inventory digest | LLP 0175 D2.3 complete canonical battery (six-hour/on-demand) |
| `lastGreen` SHA/run | advances only on a determinate pass of the complete canonical inventory |
| canonical root-failure signatures, gate, attribution window, ticket, claim refs | complete canonical battery under LLP 0189 D-1 |
| frozen-record stale/infrastructure/nondeterministic signatures and tickets | two-hour drift backstop; pre-push may open/update early but never closes |
| current infrastructure/blocking-nondeterministic state | projection union of open producer-labeled signatures; no implicit cross-producer coalescing |

The two-hour backstop uses D-3's same closed classifier and normalized
signature taxonomy. A clean content red is repeated over the same revision
closure before stale attribution. The observed-closure digest binds the
tracked tree, prepare/check identity, dependency-mirror key, the complete
installed dependency-tree bytes including symlink targets, actual resolved
module-package bytes, submodule Git trees/status and prepared runtime artifact
bytes, declared prepared-path bytes, sanitized environment, and the bytes of
the named Node/shell/build tool executables at both execution boundaries; a
changed or unclean closure is
`UNKNOWN`, not nondeterminism evidence. Contradictory determinate observations
are ticketed as `NONDETERMINISTIC` without repair attribution, while stable
content reds enter the first-parent signature epoch. When the latest record
epoch is not on that topology, the ticket stays causally unattributed rather
than naming a later head. Runner-controlled setup failures retain the backstop
self-health streak rather than becoming stale.
A canonical `FAIL` or `BLOCKED` opens or updates its producer/signature ticket; a later
complete canonical run that determinately exercises the same gate/surface and no longer
emits that signature closes it, even if another gate remains red. A pre-push observation
or two-hour drift observation opens/updates a drift signature; only a later determinate
two-hour backstop pass of that gate on a descendant closes it. Each signature transition
names its source event. A deregistered or renamed gate's open signatures close administratively through a named source event referencing the registry change. Frozen-record self-health is visible beside, not substituted for, the canonical inventory.

Before any completely green canonical run, `lastGreen` is `null` and the green ref is
absent. The protected, forward-only `refs/heads/green` mirrors non-null `lastGreen` by
ancestry-checked compare-and-swap. If the projection is valid but the ref is missing, the
publisher may recreate it from `lastGreen` after ancestry and ledger verification; until
then automation freezes. A non-ancestor candidate or any ledger/projection/ref disagreement
also freezes automation. The projection, not the ref alone, is authoritative.

### D-5. Optional branch cuts

Recent `main` remains the default base. A session may opt into `green` for a relevant
known main red or a long-running task. This removes only known-content ambiguity at the
tested SHA; infrastructure, dependency drift, and post-rebase failures still use D-3 evidence, while nondeterminism blocks and supplies no attribution.

The comparative pilot requires at least 30 completed landings per arm, including 10
heavyweight/core landings, and reports green age, branch-to-land latency, generated-file
conflicts, reruns avoided, and triage time. Pause immediately on false attribution, ref
integrity failure, or lost work; stop after the minimum sample if p95 landing latency or
conflict rate is more than 20% worse than recent-main cuts. Expansion requires reduced
triage without worse landing time or conflicts. Universal green branching needs amendment.

### D-6. Advisory fix-forward routing

A completed canonical red activates idempotent advisory routing by root-failure signature. It
ensures a durable signed LLP 0189 D-1 ticket request is recorded, attaches its health window
and receipts, relies on D-3's authorized source-ticket publisher to project the ticket onto
`main`, routes to likely landing owners, may dispatch the authorized on-demand battery, and
itself writes neither source nor `main`; routing proceeds on the request, and D-4 observations alone close signatures.
The routing pilot reports time-to-owner/close, ownership collisions, and cases where an
eligible revert would have outperformed fix-forward; that evidence gates any D-7 successor.

Pending the author ruling, the landing author has first repair choice for 24 hours from
first observation. An owner is active only while named with a repair update since the
previous scheduled battery; routing avoids competing work. Then an unclaimed or inactive
ticket becomes fix-forward-by-anyone. Four consecutive scheduled observations still escalate under LLP 0189 D-1. Fix-forward remains the default.

### D-7. Eligibility conditions for a later revert decision

This box constrains any later automated-revert activation; it does not activate or approve
one, and automated revert is outside this RFC's acceptance. A later, separately reviewed
decision may grant authority only when all are recorded: one causal landing from bounded
evidence; no interacting/multi-commit cause; descendant/dependency and file-delta audits;
the intended inverse passing the red gate and affected landing checks on current integration;
no active owner and permission under D-6; required LLP 0189 claim demotion/requalification;
and a corrective-release plan for already-published immutable bytes. Unknown means fix-forward or author escalation, never revert.

### D-8. Retained control plane

Read-only proof jobs keep no write credential. Separate least-privilege publishers validate
producer identity, run/event id, tested SHA, inventory or closure digest, outcome, and ticket
signature before appending a ledger event, updating a ticket, deriving the CAS projection,
or advancing only the green ref. Writes and retries are idempotent; partial or unreconciled
state disables projection/ref/routing automation. No identity defined here may write `main`
except the explicitly authorized source-ticket publisher, which may project only validated ticket requests.

## Required amendments and compatibility

- LLP 0175 D2.1 and its 2026-08-07 ruling must be amended in the accepting change: “infrastructure ambiguity still blocks” is reversed only for D-3 baseline-corroborated runner setup/provision failures; all other ambiguity continues to block.
- LLP 0175's 2026-08-07 “trigger-matched gates always run” ruling is amended to permit receipt-validated reuse under D-1.
- LLP 0175's rule that failed prepare commands are infrastructure errors is narrowed by D-3: only runner-controlled, baseline-corroborated setup/provision failures are infrastructure; content-caused prepare failures are content.
- LLP 0175 D2.1's rule that exit-2 files no backstop ticket is amended to permit D-3's runner ticket-request and source-ticket publisher authority.
- LLP 0175's frozen-record registry contract must add D-1 per-gate semantic closures, admission/completeness checks, execution receipts, and derived validation receipts.
- LLP 0189 D-1 remains the canonical-battery authority; add a cross-reference to D-4's producer projection and ticket transitions without weakening fix-forward or claim rules.

## Rollout, success, and rollback

Acceptance commits D-1 through D-3 as required work. Phase 1 shadows per-gate receipts,
then enables conservative reuse, prepared-runtime reuse, the record inventory, and closed
outcome typing. Phase 2 publishes both ledgers, the health projection, and green ref. Phase
3 runs advisory routing and the optional-cut pilot. Revert activation is a later decision.

Benchmarks record hardware/OS, pinned toolchain, cache state, and input size; cold and warm
runs are separate and report p50/p95. On the recorded ruling-machine class, prepared-runtime
hits must achieve p95 <= 120 seconds over at least ten warm runs, with cold misses reported
separately; each in-scope regeneration must achieve p95 below ten seconds over at least ten
cold and ten warm runs. Timeout and error runs count as misses in each distribution. Favorable samples may not be pooled across states.

Implementation is complete only when non-vacuous eligible retries reuse every and only
closure-identical gate; representative traffic fixtures pass; prepared receipts and record
bounds hold; corroborated infrastructure and inherited reds proceed with idempotent tickets
while introduced/unknown/nondeterministic failures block; producer and ticket transition
conformance passes; and ledger/ref replay, race, partial-write, initialization, and missing-ref recovery pass.

Any false receipt reuse, content red admitted by reuse, content failure admitted as
`INFRASTRUCTURE`, backward/unauthorized pointer move, or silent health/claim mismatch disables
the responsible automation, restores full gate execution or fail-closed classification as
applicable, and opens an incident ticket before re-enable.

## Author ruling (recorded 2026-08-11, Charlie Cheever in session)

All three points ruled as specified: (1) the 2026-08-10 24-hour landing-author
priority is preserved, after which an unclaimed or inactive ticket becomes
fix-forward-by-anyone; (2) the narrow reversal of LLP 0175 D2.1's
“infrastructure ambiguity still blocks” ruling is approved only when the same
runner-controlled failure is corroborated at every merge-base — effective when
the D-3 implementation lands, with fail-closed behavior standing until then;
(3) a later, separately reviewed automated-revert activation decision may
proceed under D-7 after pilot evidence. That last ruling activates nothing here. Admitting nondeterministic outcomes non-blocking would be a separate future carve-out requiring its own ruling and amendment to LLP 0175; this RFC does not request it. Urgent security exposure, ongoing destructive data corruption, or complete publication inability triggers immediate author escalation, never autonomous action under this RFC.

## Optimistic landing default (2026-08-13)

Author ruling by Charlie Cheever, recorded in session as a living amendment to
this accepted RFC: **ordinary source landings optimize for throughput and
fix-forward recovery.** When the affected tests passed on the candidate, the
tested semantic delta survives integration unchanged, and merge/rebase adds no
semantic conflict resolution, the candidate lands immediately. Advancement of
`main` alone does not require repeating expensive verification. If integration
changes a tested semantic input, the checks whose inputs changed run again;
known failing affected product tests still require attention before landing.
This creates no exact-HEAD retest, merge queue, serializer, quiet-main window,
or new receipt ceremony.

The tracked pre-push hook still consumes every ref update and runs the checked
LLP 0175 selector. For a revision targeting `origin/main`, ordinary mode
reports the selected frozen-record gates and defers their commands to the
two-hour `drift-prone-gates.mjs backstop`.
The backstop remains authoritative for frozen-record health and converts reds
into visible, attributable, idempotent fix-forward tickets. The complete
canonical battery remains authoritative under LLP 0189 D-1. Selection is
retained because it gives immediate scope visibility and keeps the explicit
strict path honest; a selected gate is not an ordinary landing veto.

A ref update not targeting `origin/main` is not called scheduled or deferred:
ordinary mode reports its selected gates, runs none, and states that no
scheduled-main verdict is claimed. If that revision later lands on
`origin/main`, that landing's own ref update is selected and becomes backstop
input. A same-tip main/non-main push reports both ref dispositions while the
one revision is covered once by the main landing. Explicit strict mode
continues to execute every selected revision, including multi-ref and non-main
pushes.

`SNAPBACK_DRIFT_GATES_STRICT=1 git push ...` explicitly restores synchronous
execution and D-3's complete outcome protocol: introduced content reds and
nondeterminism block; inherited reds and corroborated runner infrastructure
proceed with their existing attribution and ticket requests. Add
`SNAPBACK_DRIFT_GATES_FULL=1` to select the complete registry. For compatibility,
`SNAPBACK_DRIFT_GATES_FULL=1` by itself implies strict full-registry execution,
and `SNAPBACK_DRIFT_GATES_BYPASS=1` remains accepted and loud even though its
skip behavior matches the ordinary default. Non-`1` values refuse.

D-1/D-2 receipt reuse, prepared execution, and record normalization remain
valuable for strict runs, on-demand diagnosis, the scheduled backstop, and
release qualification, but they are no longer prerequisites for ordinary
landing. D-3 remains the strict synchronous classifier rather than the default
landing classifier, and is also the scheduled backstop's outcome taxonomy.
D-4/D-6 health and fix-forward routing remain authoritative.

This ruling does not weaken gates around irreversible or unusually dangerous
operations: npm candidate publication and `latest` promotion, destructive
migrations, known urgent security exposure, ongoing destructive data
corruption, or similar external side effects retain their qualified blocking
protocols. LLP 0041 and LLP 0233 publication qualification are unchanged.

## Portability

The contracts may generalize, but this RFC adopts them only for Snapback. Packaging for other repositories waits for pilot evidence; no “four primitive” claim is made.

## Review dispositions

- gpt-r3 M1 — made determinate content outcomes an ordered, mutually exclusive inherited-then-content partition.
- gpt-r3 M2 — made nondeterminism blocking, ticketed, retried, and non-attributive; reserved any future carve-out for a separate ruling and LLP 0175 amendment.
- gpt-r3 M3 — added the trigger-matched reuse and prepare-failure amendments to LLP 0175.
- gpt-r3 M4 — defined durable signed requests, authorized source-ticket publication, proceed-on-request semantics, and the bounded unticketed interval.
- gpt-r3 M5 — limited reuse to one eligible main ref update; multi-ref pushes execute all selected gates.
- gpt-r3 minor 1 — scoped D-1 to the frozen-record registry's 18 drift-prone gates.
- gpt-r3 minor 2 — set prepared-runtime p95 <= 120 seconds and counted timeouts/errors as misses.
- gpt-r3 minor 3 — restored four consecutive scheduled observations.
- claude-r3 M1a — added the LLP 0175 D2.1 exit-2 ticket-filing amendment.
- claude-r3 M1b — made nondeterminism blocking and reserved a future carve-out.
- claude-r3 minor 1 — stated classifier precedence and the inherited/content fallback.
- claude-r3 minor 2 — added registry-change source events for administrative signature retirement.
- claude-r3 minor 3 — required backstop classifier/signature parity before cross-producer projection.
- claude-r3 minor 4 — retained trigger admission as implementation-phase work while making baseline attribution and ticket custody explicit without new scope.
- claude-r3 minor 5 — replaced the approximate runtime bound with an exact threshold.
