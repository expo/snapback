# LLP 0162 super-refine loop — convergence record

**Document:** `llp/0162-agent-safe-storage-profile.rfc.md` (Agent-safe storage
profile — the bounded 80/20 implementation profile derived from LLP 0161)
**Loop:** LLP 0005 review loop at super-refine intensity, run 2026-08-03, no
author round cap; the coordinator declared and honored a stopping rule after
round 6 (one final delta-scoped round, then close regardless of verdict).
**Coordinator:** a Claude (Fable 5) session — per LLP 0005 it did not count
itself as a reviewer (it also did not author the draft; the draft is
Charlie/Codex-authored); all reviews came from fresh non-author contexts.
**Families:** Claude (Fable 5) via fresh Claude Code subagent sessions;
OpenAI Codex via `codex exec` (codex-cli 0.146.0, gpt-5.6-sol,
`model_reasoning_effort=xhigh`, read-only sandbox). All rounds mutually
blind; every round SHA-pinned its target (hashes in the per-family
artifacts). Round 7 was delta-scoped to the changed contracts by explicit
capsule instruction, per both families' round-6 guidance.
**Final version:** v0.8; Draft; v0.8's repairs are **unreviewed**.

## Round ledger

| Round | Target | Fable | Codex | Revision applied |
|---|---|---|---|---|
| 1 | v0.1 (659c28c5) | NOT READY (3 MAJOR, 5 MATERIAL, 5 MINOR) | NOT READY (3 MAJOR, 5 MATERIAL) | v0.2 — envelope keyed by operation identity (commit version demoted to stream-qualified snapshot association); promotable fork pinned to 0097's in-app branch, 0158 derived deployments capture-only; checkpoint substrate split (materialized / receipt-only); per-fact read-set provenance; 0088 history invariants imported; replay-sufficient promotion record; `branches::promote` marked superseded; 0134 capability routing; Related +13 documents |
| 2 | v0.2 (2bee843d) | NOT READY (2 MAJOR, 9 MATERIAL, 4 MINOR) | NOT READY (2 MAJOR, 4 MATERIAL, 1 MINOR) | v0.3 — `operationId` = `ClientMutationIdentity` widened (0133 extend-don't-ride-beside); per-originator identity sources; suppression lifecycle after 0043; 0088 §6 per-post-image rule with elision; diff split into attributed sequence vs net diff (preimage/immutable-base requirement, canonical folding); `DenyAll` named; "covered" defined; base-class axis, 0134 manifest-extension, closed aggregate; statistically controlled baseline; deviation ticket filed |
| 3 | v0.3 (07229078, committed as d26f946e/6bf1a9dd) | NOT READY (3 MAJOR, 6 MATERIAL, 3 MINOR) | NOT READY (0 MAJOR, 5 MATERIAL) | v0.4 — audience = compared fact not key (0133 preserved); promotion identities from non-reusable `childStreamId`; epoch anti-replay floor; dated 0097 amendment declared; serialized admission + rebase budget; snapshot-pinned checkpoint dual-path; current-plus-captured non-row authorization; core per-version rule owned here; sequencing step 0 + mediation split |
| 4 | v0.4 (cb8bbf19) | NOT READY (3 MAJOR, 6 MATERIAL, 3 MINOR) | NOT READY (0 MAJOR, 5 MATERIAL) | v0.5 — epoch issuer/closure protocol; `PromotionRequestV1`; per-source vs aggregate promotion envelope; FIFO tickets + concurrency-scaled budget; pins = finite leases; author-by-dated-revision exception authority; per-fact-class authorization; owner/status framing begins |
| 5 | v0.5 (8dd7e37b) | NOT READY (3 MAJOR, 6 MATERIAL, 3 MINOR) | NOT READY (2 MAJOR, 6 MATERIAL, 1 MINOR) | v0.6 — originator-class keyspace partition + server-authenticated host identities (squatting closed); bounded envelope-identity clock with asymmetric-join dispositions; non-row rule dropped to current-policy; `DenyAll` attempt markers; sealed `PromotionRequestV1` + one-transaction aggregate promotion; server-recorded epoch issuance; per-component owner/status table; 0097 amendment scope widened; bounded envelope enumeration |
| 6 | v0.6 (f4fd6427) | NOT READY (1 MAJOR, 8 MATERIAL, 4 MINOR) + **explicit architecture-converged ruling** | NOT READY (3 MAJOR, 3 MATERIAL, 1 MINOR) | v0.7 — approved-facts re-seal across rebase; admissible identity unified on the aggregate (per-source = provenance joins); conditional-fairness liveness model + bounded head reservation; preallocated authenticated offline identity ranges; acknowledgement-based epoch closure with the wedge stated; `result-expired`; checkpoint re-scoped to copy fidelity + 0158 publication machine + spike named; write-path registry derivation; non-row rule owned; derived deployments out of core; `Promotable(noEffects)` |
| 7 (final, delta-scoped) | v0.7 (2145942d) | NOT READY (2 MAJOR, 9 MATERIAL, 2 MINOR) — "a seventh full cross-family round is not warranted" | NOT READY (4 MAJOR, 2 MATERIAL, 1 MINOR) | v0.8 — full approved-facts digest (reads/ctx/decision facts) with preserved approval + engine attestation; identity tombstones until floor passage (two-identity hole closed) + lookup precedence; write-authority choke point (generated transaction API + SQLite authorizer) with honest inventory fallback; `authorization-unprovable`; promotion copies replay-log facts into canonical; aggregate identity = rebase-invariant admission ticket; reservation quota + p99 contention metric + TTL condition; sentinel + intra-state crash matrix + registry-authority deviation declared; effect axes split; range-exhaustion disposition; `verifiedCopyFidelity` |

**No round produced a READY verdict from either family.** Every finding in
all seven rounds was applied; none was refuted (one round-7 disagreement —
the legacy projection for `Promotable(noEffects)` — was resolved by taking
Codex's fails-weak position over Fable's `CaptureOnly` suggestion, with the
rejection rationale recorded in §8). The loop closed at the coordinator's
declared stopping rule, with both round-6 reviewers having ruled the
architecture converged ("do not reopen the profile boundary, the P1-P9
mapping, the merge posture, the two fork classes, or the layered
aggregate") and the round-7 Fable review explicitly judging a further full
round unwarranted. **v0.8's repairs are unreviewed. The author decides the
status transition**; the round-7 reviews prescribe at most a scoped re-read
of §§1, 4, 5, 8 and Acceptance 2/3/6/10/12 rather than another full round.

## What the loop changed most

- **Round 1's defining catch (both families):** the v0.1 fork was two
  incompatible primitives under one name — LLP 0097's in-app branch and LLP
  0158's derived deployment — and the envelope was keyed by a commit version
  that provably cannot key receipt-only operations. The class split and the
  operation-keyed envelope reshaped everything downstream.
- **The identity thread ran all seven rounds** and ended somewhere much
  stronger than it began: `clientMutationId` widened per 0133's
  extend-don't-ride-beside rule → stream-qualified → audience kept as a
  compared fact (preserving the shipped collision diagnostics) →
  originator-partitioned with server-authenticated host derivations →
  epoch-bearing with preallocated offline ranges, acknowledgement-based
  closure, and identity tombstones. Fable round 5's identity-squatting DoS
  and Codex round 7's two-identity/same-epoch hole were both real security
  findings no single round would have caught.
- **The honesty discipline was repeatedly turned on the document's own
  fixes:** the checkpoint "proof" demoted to `verifiedCopyFidelity`, the
  runtime diff digest demoted to inventory, "journal completeness" refused
  as a word until an enforceable choke point backed it, and the landed
  `branches::promote` and `MaterializedBase` divergences from Accepted 0097
  ticketed independently of this RFC's fate
  (`issues/20260803-branches-promote-postimage-deviation.md`).
- **The meta-lesson this corpus keeps re-learning, at its clearest yet:**
  in a fix-heavy loop, each revision's repairs are the next round's attack
  surface (v0.5's sealed request vs v0.5's FIFO tickets; v0.6's re-seal vs
  0097's meaning-preservation; v0.6's epoch closure vs offline minting).
  The delta-scoped final round was the right instrument for that tail —
  both families found real defects in exactly the changed contracts.

## Open after the loop (author decisions / follow-ups)

1. **The status transition.** Both round-7 reviews prescribe a scoped
   re-read of the v0.8-changed contracts (not a full round) before any
   Draft→Review/Accepted move; the acceptance gates (step-0 baseline
   artifact, OQ13 snapshot-pinning spike, the focused promotion-proof Spec)
   gate advertisement rather than the document.
2. **Open questions 1–14** in the document, most notably: OQ11 (may an agent
   principal approve a `PromotionRequestV1` — Fable round 7 flags this as an
   undecided core dependency for the fleet consumer, not a side question),
   OQ13 (the SQLite backup-under-held-read-transaction spike), OQ14 (whether
   to extract identity/envelope, fork/promotion, and checkpoint/proof into
   focused Specs — both families suggested it independently; the document is
   1,321 lines), and OQ5 (artifact-schema owner; Codex recommends LLP 0037's
   pattern).
3. **Dated amendments this RFC commissions but does not land:** LLP
   0133/0043 (identity widening, `result-expired`, range parameters), LLP
   0012/0095 (client conformance), LLP 0097 (the axis split /
   `Promotable(noEffects)` / §5 protocol additions — scope enumerated in
   §8).
4. **The two 0097 doc/code divergence tickets** (post-image `promote`;
   writable `MaterializedBase`) live in 0097's implementation lane
   regardless of 0162's fate.
5. Round-7 MINOR/editorial residue deliberately not fully taken under the
   stopping rule: splitting acceptance rows 2/10 into per-property gates,
   a transition-table/property-test presentation of the identity lifecycle,
   and an example capability manifest.
