# LLP 0164: Fork and promotion

**Type:** Spec
**Status:** Draft
**Systems:** Storage, Runtime, Effects, Auth, Agent experience, Testing
**Author:** Charlie Cheever / Claude
**Date:** 2026-08-03
**Revised:** 2026-08-05 (LLP 0185 Phase 0 ownership reconciliation — this
Spec owns the remaining row-5 derived post-fork-parent-write fixture and both
row-9 diff oracles; LLP 0158 remains the derived-deployment contract authority
and LLP 0165 retains only journal-completeness closure. No row state changed.)
2026-08-03 (first in-app implementation slice — immutable
current-head bases, replay-sufficient branch operations, independent exact
diffs, bounded durable `DenyAll` markers, sealed strict-CAS promotion by
re-execution, aggregate envelope/source joins, FIFO admission/rebase/re-seal,
resource reap, generated schemas, and absolute-latency instrumentation landed;
the row matrix below records the remaining corpus gaps and all capability axes
stay `Missing`); 2026-08-03 (derived-deployment implementation note — LLP 0158
F0a landed the non-promotable class's scrub-and-mint custody proof and
`DenyAll` durable attempt-marker corpus. This supplies the substrate for the
derived-deployment legs of LLP 0162 Acceptance rows 5 and 7; those legs remain
gated on F0b surface-level acceptance and are not advertised complete.)
2026-08-03 (initial Draft — extracted from Accepted LLP 0162
§§3-5 under its OQ14 decision; carries the fork-class, diff, and promotion
contracts so they can version independently of the profile umbrella)
**Related:** LLP 0037, LLP 0055, LLP 0066, LLP 0088, LLP 0097, LLP 0148,
LLP 0158, LLP 0162, LLP 0163, LLP 0165

**Implementation evidence:** 2026-08-03 (promotion now commits an independent
LLP 0165 boundary proof and aggregate LLP 0163 provenance through an
enumerated, journal-verified ordinary-mutation writer; exact durable ticket,
sealed schema/request retry, and host-ticket lifecycle negatives are green.
The aggregate envelope explicitly retains a coverage-manifest GAP, F0b is only
the first derived-deployment consumer, and integrated latency is now recorded;
author-ratified bounds, p99 contention, and the residual corpus remain missing,
so the Spec stays Draft and every capability stays `Missing`)

## Purpose

This Spec owns the committed contracts and artifact schemas for the fork and
promotion half of the agent-safe storage profile. LLP 0162 (Accepted) is the
umbrella and holds the acceptance corpus (rows 5-10 gate these components,
with the derived-deployment legs of rows 5 and 7 gating the separate
0158-gated additive capability). The dated LLP 0097 amendment this work
rides on is recorded in LLP 0097 itself; this Spec implements it. §4 is
shared with LLP 0165 under an explicit split: this Spec owns the diff
surfaces (attributed change sequence, net diff, folding rules, substrate
naming); LLP 0165 owns journal completeness, digest domains, and
checkpoints; on a §4 divergence the owning Spec per this split is the
defect. Where this
Spec and LLP 0162 §§3-5 diverge, this Spec is the defect until a dated
revision reconciles them.

## Contract summary (normative; details per LLP 0162 §§3-5)

- **Two fork classes, never blurred.** The promotable class is LLP 0097's
  in-app branch (shared bundle, current head, typed child stream over a
  materialized base plus overlay). The non-promotable class is LLP 0158's
  derived deployment (own stream, scrub-and-mint, may diverge schema;
  checkpoint-based forks are always this class). No nested forks in v1.
  Class-appropriate identity and per-class credential acceptance apply.
- **Egress.** `DenyAll` refuses fail-loud and records a bounded payload-free
  attempt marker (durable across branch crash); `CaptureOnly` is reserved
  for 0097's ledger-backed intents. A branch with empty attempt markers is
  promotable under `DenyAll` (`Promotable(noEffects)` — strictly narrower
  than 0097's `Promotable`; legacy three-value consumers see `Missing`).
  Replay-input retention classification at admission; an uncovered-lane
  co-write or unretainable input makes the branch non-promotable with a
  diagnostic naming the foreclosing operation.
- **Diff.** Two surfaces: the attributed change sequence (journal-derived)
  and the net base-to-head diff, which requires an immutable retained base
  or first-write preimages (target's choice, named on the receipt) with
  canonical folding rules. Sibling forks compare through their common base.
  Runtime diff digests are inventory except at the promotion boundary.
- **Promotion.** Strict CAS on base equality; staged re-execution over the
  replay-sufficient operation log (a named schema here); never post-images —
  the former `branches::promote` path deviated from Accepted 0097 §5 and is now
  compile-disabled and replaced by the strict path. Promotion consumes a
  sealed `PromotionRequestV1` binding the reviewed child-stream head
  (branch-head CAS), the log/diff/manifest digests, the approver (a human
  or an agent principal holding an LLP 0055 scoped grant — decided at 0162's
  acceptance), and the rebase-invariant admission-ticket identity —
  server-minted at first admission, governed by LLP 0163's host-originator
  epoch protocol — which is
  the sole admissible suppression/retry identity. The approval binds the
  full approved-facts digest (reads, ctx answers, decision/result facts,
  writes, effects, artifact, coverage); a rebase reproducing it re-seals as
  a separately identified engine attestation over the preserved approval;
  any divergence forces fresh approval. Promotion commits as one canonical
  transaction/version with one aggregate envelope, per-source
  write-fact-granularity provenance joins, and durably copied replay-log
  envelope facts.
- **Contention.** Serialized fair admission per canonical stream: FIFO
  tickets inherited across rebase-by-replay, a rebase budget as a declared
  function of queue position/R/losses (floor = observed concurrent forks),
  a quotaed bounded head reservation after R consecutive losses, ticket
  lifetime = fork TTL with a declared TTL-sufficiency condition, and a p99
  under-contention latency metric. Bounded eventual progress holds under
  the declared conditional-fairness terms; outside them the
  contention-exhausted diagnostic is the honest outcome.

## Owned artifacts

`PromotionRequestV1`, the replay-sufficient branch operation log schema
(per LLP 0097 §5's field list: function/artifact identity, canonical
arguments, principal/grant, read baseline, idempotency identity, ctx
answers, effect observations, causal ordering, custody classes), the
attempt-marker record, the branch/fork receipt, the
admission-ticket/reservation records, the diff
receipts (substrate-naming, folding), and their wire projections — generated
per LLP 0037.

## Acceptance

LLP 0162 Acceptance rows 5-10 (core legs) gate these components, plus row
13's applicable submetrics (fork creation, diff, promotion, reap latency,
p99 under contention); the
derived-deployment legs of rows 5 and 7 gate the 0158-gated additive
capability. No parallel corpus here.

**Evidence note — 2026-08-03:** LLP 0158 F0a proves fork-class identity
separation, credential negatives, fail-closed unknown custody, crash-atomic
publication, and bounded payload-free `DenyAll` markers for derived
deployments. F0b now exercises create/list/diff/drop/reap through a dated
two-session, function-divergent Todo fleet dogfood, including finite TTL,
default secret scrubbing, inert workers/assets, and deny-all egress. That closes
the first consumer dependency for the derived-deployment legs of rows 5 and 7;
it does not complete the in-app branch corpus or advertise either capability.

**Owner note — 2026-08-05:** the remaining derived-deployment fixture proving
that a parent write committed after the fork point stays invisible to the
existing fork is this Spec's LLP 0162 row-5 acceptance work, not LLP 0158 F1's
guide/harness work. For row 9, this Spec likewise owns the independent net-diff
and attributed-sequence oracles, folding, and schema/system-field coverage;
LLP 0165 owns the separate generated-writer/SQLite-authorizer completeness
leg. The consolidated ticket tracks both without changing either to green.

### Implementation record — 2026-08-03

The first core in-app slice lives in `src/fork_promotion.rs`. The superseded
`branches::promote` post-image entry point is compile-disabled, while
`MaterializedBase` now retains a SQLite-enforced query-only base distinct from
its writable head. Rust is the source of truth for the nine committed
branch/promotion schemas registered in `schema_export`.

This is intentionally a progress record, not a capability advertisement:

| LLP 0162 row | Evidence in this slice | Status after this slice |
| --- | --- | --- |
| 5 — fork isolation | current-head base, canonical/sibling isolation, immutable-base fixture, and F0b derived-deployment fleet dogfood | Partial — F0b closes the first derived consumer leg; a derived fixture with parent writes after fork, the in-app product/runtime surface, and the full class/credential corpus remain open |
| 6 — effect quarantine | bounded payload-free `DenyAll` marker, crash/reopen persistence, promotion foreclosure | Partial — exhaustive host-egress-family mediation/bypass coverage and `CaptureOnly` are missing |
| 7 — identity/authority | closed branch grant allowlists, promotion-time authority revalidation, and F0b scrub-and-mint/credential negatives | Partial — product auth wiring, stale/revoked corpus breadth, and later settlement remain |
| 8 — resources | principal/app counts, operation/byte/diff/TTL bounds and reap-without-canonical-change fixture | Partial — the digest-work limit and replay-floor/envelope-clock joint corpus remain |
| 9 — exact diff | independent immutable-base/head comparison, emitted attributed sequence, and deterministic 32-seed add/update/delete/revert folding corpus | Partial — the randomized corpus mutates the fixture directly rather than comparing a journal-derived net diff; a separate attributed-sequence oracle, schema/system-field coverage, and the complete journal-completeness corpus owned with LLP 0165 remain |
| 10 — strict promotion | sealed head/log/diff/manifest/facts/schema request; unchanged-base read-only re-execution; exact durable ticket and retry binding; changed-head refusal; rebase/re-seal divergence; FIFO/reservation mechanics; forged-post-image and unjournaled-trigger refusal; aggregate envelope/source joins; independently derived expected-versus-staged-actual boundary comparison with mismatch rollback | Partial — the enumerated ordinary-mutation promotion seam is creditable, but its envelope honestly marks the active canonical coverage manifest as uncovered; global generated-writer/SQLite-authorizer coverage, the full concurrent-writer fairness/crash matrix, exhausted-budget fixture, identical-write/divergent-read-or-result re-seal negatives, provisional effect chains, and frozen production contention terms remain |
| 13 — applicable performance | historical and final-integrated dated release-mode records follow the step-0 11-run median/MAD protocol for fork/diff/promotion/reap | Partial — the integrated record closes the final-revision rerun only; author-ratified absolute bounds, p99 contention evidence, and applicable correctness gates remain incomplete |

The runner refuses measurement while another Cargo/Rust compiler is active,
retains every raw run, and writes the missing bound-ratification fact into its
output artifact. The historical dated record is
[`agent-safe-fork-promotion-absolute-2026-08-03`](../tests/acceptance/fixtures/agent-safe-storage/fork-promotion-performance.2026-08-03.v1.json),
recorded on the step-0 Mac17,3 machine and identifying source revision
`83d0e71901357733293f66a5b125991bbfd892f8`. Median/MAD latencies are
171.250/0.625 µs for fork creation, 694.375/4.375 µs for exact diff,
1,500.208/20.875 µs for promotion, and 27.625/0.166 µs for TTL reap. The
artifact explicitly preserves the missing author-bound and claim-boundary
facts; it does not measure p99 contention and predates the final ticket,
coverage, schema-binding, and canonical-writer hardening. It remains preserved
as historical instrumentation evidence.

The final-integrated dated record is
[`agent-safe-fork-promotion-absolute-integrated-2026-08-03`](../tests/acceptance/fixtures/agent-safe-storage/fork-promotion-performance.integrated.2026-08-03.v1.json),
recorded on the same machine at source revision
`882a337fe5a71ad0b65497d98c44338ec4d44870`. Median/MAD latencies are
219.333/3.001 µs for fork creation, 707.959/6.501 µs for exact diff,
2,227.292/23.875 µs for promotion, and 29.458/0.583 µs for TTL reap. The
artifact records the still-missing author bounds, makes no p99 contention
claim, and explicitly keeps capabilities `Missing`; it closes only the
integrated-revision rerun sub-gate in row 13.
`CaptureOnly`, exhaustive product egress mediation, and capability manifest
publication are explicitly outside this slice.

## Open items

1. The declared numeric terms (R, reservation interval and quota, budget
   formula, maximum promotion-commit duration). The reservation quota is
   fairness-coupled: quota sufficiency is one of LLP 0162 §5's declared
   conditional-fairness terms, so its value bounds the progress claim, not
   just resource use.
2. *(Executed in LLP 0162.)* Divergence surfaces through the stable refusal
   diagnostics and receipt fields already named by the accepted umbrella; no
   separate OQ10 vocabulary decision remains open here.
3. Fork-receipt enumerability ("list my live forks", LLP 0162 OQ12).
4. Remaining wiring order is LLP 0097's exhaustive product mediation before
   `CaptureOnly`; LLP 0158 F0a/F0b are landed dependencies, not blockers.
5. The consolidated acceptance tail, including author bound ratification and
   the residual corpus, is tracked in
   [`issues/20260803-agent-safe-storage-acceptance-tail.md`](../issues/20260803-agent-safe-storage-acceptance-tail.md).
