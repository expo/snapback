# LLP 0164: Fork and promotion

**Type:** Spec
**Status:** Draft
**Systems:** Storage, Runtime, Effects, Auth, Agent experience, Testing
**Author:** Charlie Cheever / Claude
**Date:** 2026-08-03
**Revised:** 2026-08-03 (first in-app implementation slice — immutable
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
  the landed `branches::promote` deviates from Accepted 0097 §5 and is
  replaced or disabled (ticketed in 0097's lane). Promotion consumes a
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

**Evidence note — 2026-08-03:** LLP 0158 F0a now proves fork-class identity
separation, credential negatives, fail-closed unknown custody, crash-atomic
publication, and bounded payload-free `DenyAll` markers for derived
deployments. This unblocks the implementation dependency for the row-5 and
row-7 derived legs; it does not close or advertise those legs before the F0b
consumer surface exercises them end to end.

### Implementation record — 2026-08-03

The first core in-app slice lives in `src/fork_promotion.rs`. The superseded
`branches::promote` post-image entry point is compile-disabled, while
`MaterializedBase` now retains a SQLite-enforced query-only base distinct from
its writable head. Rust is the source of truth for the nine committed
branch/promotion schemas registered in `schema_export`.

This is intentionally a progress record, not a capability advertisement:

| LLP 0162 row | Evidence in this slice | Status after this slice |
| --- | --- | --- |
| 5 — fork isolation | current-head base, canonical/sibling isolation, and immutable-base fixture | Partial — the product/runtime consumer surface and derived F0b leg are not closed |
| 6 — effect quarantine | bounded payload-free `DenyAll` marker, crash/reopen persistence, promotion foreclosure | Partial — exhaustive host-egress-family mediation/bypass coverage and `CaptureOnly` are missing |
| 7 — identity/authority | closed branch grant allowlists and promotion-time authority revalidation | Partial — product auth wiring, stale/revoked corpus breadth, later settlement, and derived F0b remain |
| 8 — resources | principal/app counts, operation/byte/diff/TTL bounds and reap-without-canonical-change fixture | Partial — replay-floor/envelope-clock joint corpus remains |
| 9 — exact diff | independent immutable-base/head comparison, attributed sequence, deterministic 32-seed add/update/delete/revert corpus | Partial — schema/system-field coverage and the complete journal-completeness corpus owned with LLP 0165 remain |
| 10 — strict promotion | sealed head/log/diff/manifest/facts request; unchanged-base re-execution; changed-head refusal; receipt retry; rebase/re-seal divergence; FIFO/reservation mechanics; negative post-image-source guard | Partial — full concurrent-writer fairness/crash matrix, provisional effect chains, frozen production contention terms, and the LLP 0163/0165 integration seams remain |
| 13 — applicable performance | `snapback-fork-promotion-bench` instruments release-mode absolute fork/diff/promotion/reap latency with the step-0 11-run median/MAD protocol | Missing — the quiescent dated run, author-ratified absolute bounds, and p99 contention evidence are not complete |

The runner refuses measurement while another Cargo/Rust compiler is active,
retains every raw run, and writes the missing bound-ratification fact into its
output artifact. The implementation machine was carrying other Wave-3 builds,
so this landing does not mislabel a contaminated run as dated evidence.
`CaptureOnly`, exhaustive product egress mediation, and capability manifest
publication are explicitly outside this slice.

## Open items

1. The declared numeric terms (R, reservation interval and quota, budget
   formula, maximum promotion-commit duration). The reservation quota is
   fairness-coupled: quota sufficiency is one of LLP 0162 §5's declared
   conditional-fairness terms, so its value bounds the progress claim, not
   just resource use.
2. Divergence-surfacing receipt vocabulary (LLP 0162 OQ10 residue).
3. Fork-receipt enumerability ("list my live forks", LLP 0162 OQ12).
4. Wiring order with LLP 0097's mediation prerequisite and LLP 0158 F0a
   (LLP 0162 §Sequencing steps 3/5/6).
