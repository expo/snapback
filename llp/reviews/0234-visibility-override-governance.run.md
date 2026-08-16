# Review run journal — LLP 0234 visibility override governance

**Orchestrator:** Claude (Fable 5), author-directed session of 2026-08-15
(Class R row-authorization completion program).
**Reviser:** Codex (gpt-5.6-sol, xhigh) as lead author for every revision round.
**Stop rule reached:** dual-family same-revision READY (round-6 revision).

## Rounds

| Round | Kind | gpt-5.6-sol (xhigh) | claude-fable-5 | Outcome |
| --- | --- | --- | --- | --- |
| 1 | Full, mutually blind | MATERIAL (7 findings) — `.gpt-5.md` | MATERIAL (6 + 4 minor) — `.claude.md` | Round-3 revision (594 insertions; 17 dispositions) |
| 2 | Delta, mutually blind | MATERIAL (3 r1 held open + 2 new + 1 minor) — `.gpt-5.r2.md` | MATERIAL (r1 all resolved; 2 new + 3 minor) — `.claude.r2.md` | Round-4 revision (957 insertions; 6-concern union) |
| 3 | Delta, mutually blind | MATERIAL (1 new: verdict/deployment-identity binding) — `.gpt-5.r3.md` | READY (2 minors) — `.claude.r3.md` | Round-6 targeted revision (3 dispositions) |
| 4 | Confirming, mutually blind | READY — `.gpt-5.r4.md` | READY — `.claude.r4.md` | Converged; author-directed acceptance recorded |

## Material findings resolved (distinct, across rounds)

1. Push-boundary separation unenforceable under the deferred/opt-in hook
   architecture; violations post-hoc undetectable → redesigned: synchronous
   never-deferred check class + protected per-push-event observer over true
   before/after OIDs + widening admission consumes a committed, signed,
   content-bound separation receipt; residuals and remediation stated.
2. D7 elevation not transitive across `action.runMutation` → root-provenance
   fence required; verified as a live code hole and filed as
   `issues/20260815-elevated-read-nested-mutation-provenance.md` (fix lane
   landed separately).
3. Uncomposed read surfaces as a visibility-widening escape → G1 requires zero
   uncomposed restricted surfaces; compose-or-refuse in G2 (the composition
   and fail-closed flip landed independently the same day).
4. Delegated-approver same-push ordering hole → predecessor owner-map ratchet.
5. Fixture-profile custody unbound → full profile tuple bound into
   declarations, digests, approvals, bundles, baselines, projection.
6. Future-dated `issuedOn` defeats the 90-day ceiling → trusted not-before
   semantics anchored to the observed admission event.
7. Transition ledger not self-proving → append-only ledger with canonical
   predecessor/successor policy bodies; history-independent re-proof.
8. Merge-base undefined for new refs → governed integration-ref scoping with
   explicit new-ref/deletion/multi-ref rules.
9. Principal-carrying cross-cutting reads unrepresentable → governed
   `principal` authority mode.
10. Membership-declaration audience widening invisible to the comparator →
    normalization closes over declaration audience facts.
11. Unscoped dependence on unbuilt LLP 0173 → severable standalone G0
    projection (the full 0173 projection landed independently the same day).
12. Quarantine not monotone → append-only quarantine ledger +
    `quarantined-reversal` transition.
13. Auditor custody/new-ref predecessor gaps, then verdict-to-deployment
    identity binding → attested `DeploymentIdentity` digests inside the signed
    green verdict, host deep-match before activation, swap-negative fixtures.

## Provenance

All eight review artifacts in this directory carry their own provenance
headers. No review was fabricated; every verdict line above quotes the
artifact's own final line. Revision notes for each round were kept as
uncommitted orchestration scratch (`REVISION-NOTES.md`, not landed).
