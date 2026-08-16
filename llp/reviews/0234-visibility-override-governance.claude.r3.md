# Delta review (round 3): LLP 0234 — Visibility override governance

**Reviewer model:** claude-fable-5
**Date:** 2026-08-15
**Document revision reviewed:** Revised 2026-08-15 (round-4 dual-family
delta-review response)
**Review scope:** fresh delta reviewer, blind to every other r3 artifact. Read
in order: both round-2 delta artifacts, the round-4 section of
`REVISION-NOTES.md`, and the revised RFC in full. Load-bearing claims were
verified with `/usr/bin/grep` against this worktree: every elevated read is one
of the four named host calls (`db.elevated.get|getMany|uniqueMany|query`,
`packages/snapback-harness/ctx-bootstrap.js:801-805`), which makes a host-side
capability refusal alias-proof regardless of handler spelling; the current
GitHub seam is in-tree workflows reading `github.event.before`
(`.github/workflows/local-proof.yml:55`), grounding D3's ruling that in-tree
workflow custody is non-compliant and its fail-closed provider profile; and
`issues/20260815-elevated-read-nested-mutation-provenance.md` exists as the
linked G0 closure ticket.

## A. Resolution of the round-4 open set

| Item | Verdict | Reason |
| --- | --- | --- |
| Activation must consume the separation verdict (gpt-5 r1 finding 1) | RESOLVED | D3 now makes the protected observer sign a content-bound separation receipt for the approval-only event, a least-privilege publisher commits it, codegen refuses a missing/forged/mismatched receipt with `..._REMOTE_SEPARATION_REQUIRED` (an author cannot precompute the observer signature), and bundle activation additionally requires a green `governedUpdateVerdict` for the exact source OID plus the latest quarantine checkpoint (`llp/0234-visibility-override-governance.rfc.md:486-551`); a skipped hook lands only inert source, and Acceptance 2-5/25 exercise the bypass, forged-receipt, and custody-unavailable refusals. |
| Self-proving narrowing ledger (gpt-5 r1 finding 7) | RESOLVED | Every transition node retains complete canonical predecessor and successor normalized policy bodies plus resolved audience closures; exported-tree codegen walks to the root, recomputes both digests at every edge, and reruns the partial-order comparator so an authored `narrowing` label is never trusted; label/classification mismatch and body deletion/rebind fail `..._POLICY_PROVENANCE_INVALID` (`:907-950`, Acceptance 11 at `:1701-1713`). |
| Elevated census exactness via the alias-proof host-call boundary (claude r1 finding 4 / claude r2 new finding 1) | RESOLVED | The census is redefined as an exact set of admitted operation × read-form host-call channels enforced at the host, which refuses any `db.elevated.*` call the operation's generated capability entry does not admit (`:217-247`) — exactly the suggested host-boundary construction, and sound against aliasing because the four host-call names are the only execution path (`ctx-bootstrap.js:801-805`). Inline direct calls get exact spans with alias/helper forms refusing `SNAPBACK_ELEVATED_READ_SITE_UNCLASSIFIABLE`; module form is conservatively declared/projected as `opaque-module` with undeclared calls refused before storage; D6 explicitly downgrades the exactness claim to the channel, not opaque source (`:1055-1066`, Acceptance 1/16). |
| Quarantine monotonicity (gpt-5 r2 new finding 1) | RESOLVED | Quarantine verdicts are now a signed, append-only, exact-set ledger consumed by codegen, both admission comparators, and activation, with deletion/rebinding/rollback/shrinkage/old-id reuse invalid and permanently retired ids (`:594-609`, `:972-988`); the contradictory instruction to remove an active ledger head is gone — remediation appends a non-authorizing `quarantined-reversal` that retains the bad head and proves its successor no broader than the last clean policy (`:611-625`, `:936-940`); activation pins the latest remote checkpoint so source-tree rollback cannot revive authority, and Acceptance 11's full quarantine/reversal/reapproval chain fixture retains history throughout. |
| Auditor custody (claude r2 new finding 2) | RESOLVED | The observer's trigger, event subscription, verifier configuration, signing key, ledgers, and publisher permissions must live outside the audited tree; an ordinary in-repository workflow is named non-compliant; same-push deletion of every in-tree workflow cannot suppress evaluation (Acceptance 4 fixture, `:1647-1656`); unavailable custody is refusal, not a weaker audit mode; provider/organization-admin and key compromise are the stated residual with reconciler, key pinning, revocation, and activation freeze (`:578-592`). |
| New-ref/multi-ref predecessor custody (gpt-5 r2 new finding 2) | RESOLVED | The authenticated atomic-envelope profile is defined, and because no such envelope is verified for the current GitHub seam, G0 uses the fail-closed fallback: a precommitted signed anchor-OID witness plus a protected single-ref creation service, with direct creation, multi-ref creation, stale/missing witness, and no-merge-base receiving no green verdict (`:561-576`); the approval-on-anchor plus widening-on-new-ref laundering case is a required Acceptance 5 fixture (`:1657-1665`) — the reviewer's suggested resolution, adopted as written. |
| Principal-mode non-admission behavior (claude r2 minor 3) | RESOLVED | One behavior is chosen: refusal before handler/storage access with the single non-disclosing `SNAPBACK_TABLE_VISIBILITY_OVERRIDE_PRINCIPAL_NOT_ADMITTED`, never an empty result or ordinary-policy fallback (`:304-311`), with the matching Acceptance 17 clause (`:1747-1756`). |
| Transition-closure retention (claude r2 minor 4) | RESOLVED | Transition ledger nodes and their complete closures remain at their original committed paths indefinitely — no archive, re-pointer, or GC without a new versioned migration and author ruling (`:952-956`); the permanent repository growth is named in Costs (`:1584-1585`) and OQ2 is scoped to override approvals only (`:1802-1809`). |
| Quarantine-record governance (claude r2 minor 5) | RESOLVED | Subsumed by the quarantine-ledger redesign: verdict files and `generated/visibility-governance-quarantine-ledger.json` are in the append-only, admission-governed artifact class, enforced by codegen, both comparators, and activation checkpoint pinning (`:594-609`, `:972-988`). |
| Principal admission policy rendering (gpt-5 r2 minor 3) | RESOLVED | The approval record, D5 baseline, and D6 projection all carry the complete canonical admission policy and resolved membership-audience closure beside their digests (`:454-458`, `:819-822`, `:1030-1031`), and Acceptance 17's golden fixture proves an authentication-only policy and the required moderator-role policy differ visibly in canonical bodies and digests (`:1754-1756`). |

All nine open items are resolved with implementable mechanisms — receipts,
verdicts, ledgers, refusal codes, and fixtures — not acknowledgements. The two
overclaim patterns round 3 penalized are gone: the census's exactness claim is
now scoped to the enforced host channel, and the auditor's detection claim now
rests on required external custody that fails closed when absent.

## B. NEW findings introduced by the round-4 revision

### 1. MINOR — the inline elevated-read enforcement locus and its runtime diagnostic are understated for scanner-invisible aliases

D1's inline bullet says aliasing, destructuring, computed read-form access, and
helper mediation "refuse generation" with
`SNAPBACK_ELEVATED_READ_SITE_UNCLASSIFIABLE`
(`llp/0234-visibility-override-governance.rfc.md:224-232`), and Acceptance 1
requires those refusal fixtures (`:1626-1631`). But a static scanner can only
refuse forms it can see; `const c = ctx; c.db.elevated.get(...)` never spells
`ctx.db.elevated` and generates with no capability entry, so the actual fence
is the general host refusal of an unadmitted channel (`:217-222`) — which is
sound and fail-closed, but its diagnostic
(`SNAPBACK_ELEVATED_READ_CAPABILITY_UNDECLARED`) is specified only in the
module-form bullet (`:233-241`). **Suggested resolution:** one sentence stating
that the static `UNCLASSIFIABLE` refusal covers syntactically visible forms,
that a scanner-invisible alias yields an operation with no admitted capability
whose runtime host call refuses with the same
`SNAPBACK_ELEVATED_READ_CAPABILITY_UNDECLARED`, and an Acceptance 1 clause for
that hidden-alias runtime-refusal fixture.

### 2. MINOR — exported-tree codegen's trust root for the separation-receipt signature is unspecified

D3 locus 1 has codegen "verify the protected observer's signature on the
referenced separation receipt" in a tree with no `.git`
(`:488-509`; Acceptance 2 at `:1632-1637`), and target-owned configuration pins
the observer key epoch for activation (`:587-589`) — but the RFC never says
where codegen obtains the trusted public key. If the key ships inside the
audited tree, an attacker-supplied tree passes codegen with a forged receipt
and is caught only at activation's externally pinned key, so no authority goes
live — the design stays fail-closed at the live locus — but the codegen check
then detects accident, not forgery, and the RFC's per-locus honesty should say
so. **Suggested resolution:** name the codegen trust root (a committed key
registry cross-checked against the pinned epoch where target custody exists),
and state explicitly that with only a tree-supplied key the codegen signature
check is integrity/accident detection while activation's externally pinned key
epoch remains the forgery fence.

## Summary

The round-4 open set — activation consumption, the self-proving ledger, the
host-call census, quarantine monotonicity, auditor custody, new-ref/multi-ref
predecessor input, and all four round-2 MINORs — is genuinely resolved with
mechanisms that are implementable and internally consistent, and the two new
findings are wording-level completions of already-sound fail-closed designs,
not gaps in them.

VERDICT: READY
