# Delta review (round 2): LLP 0234 — Visibility override governance

**Reviewer model:** claude-fable-5
**Date:** 2026-08-15
**Document revision reviewed:** Revised 2026-08-15 (round-3 dual-family
acceptance-review response)
**Review scope:** fresh delta reviewer, blind to the other r2 artifact. Read
in order: both round-1 reviews, `REVISION-NOTES.md`, the revised RFC in full,
LLP 0231 (D1/D7 and the "no handler policy class" ruling),
`issues/20260815-elevated-read-nested-mutation-provenance.md`, and current
code where a revised claim is load-bearing
(`packages/snapback-harness/ctx-bootstrap.js`,
`packages/snapback-codegen/index.mjs`, `scripts/check-module-ownership.mjs`,
`scripts/drift-prone-gates.mjs`, `.github/workflows/`).

Verification notes: the linked P1 ticket exists and matches the RFC's framing
(root-provenance fence, four read forms, G0 fixture requirement). The
diagnostic/symbol anchors the revision switched to are real
(`SNAPBACK_AUTH_TABLE_VISIBILITY_IMPLICIT` at
`packages/snapback-codegen/index.mjs:2877`,
`SNAPBACK_TABLE_VISIBILITY_UNCOMPOSED_READ_SURFACE` at `:3864`,
`enforceMonotonicBaseline`/`attributedRecordMatches` in
`scripts/check-module-ownership.mjs`). Elevated reads are host-mediated as
named host calls (`db.elevated.get|getMany|uniqueMany|query`,
`packages/snapback-harness/ctx-bootstrap.js:801-805`) — load-bearing for new
finding 1.

## A. Resolution of round-1 MATERIAL findings

| Finding | Verdict | Reason |
| --- | --- | --- |
| gpt-5 1 (pre-push not real admission) | RESOLVED | D3 replaces the pre-push guarantee with a never-deferring synchronous hook class + server push-event audit over true `before`/`after` OIDs + quarantine/remediation; the bypass residual and exposure interval are stated, and G0/Acceptance 3–5 no longer claim guaranteed separation. |
| gpt-5 2 (D7 not transitive over nested mutation) | RESOLVED | D1 defines the fence over root invocation provenance, links the verified P1 ticket, and G0/Acceptance 1 require landed nested action/cron→mutation refusal fixtures for all four read forms plus the positive direct-caller case. |
| gpt-5 3 (uncomposed read surfaces escape G1/G2) | RESOLVED | G1 requires zero uncomposed restricted read surfaces with the composition lane's fail-closed flip as an explicit closure dependency; G2 is compose-or-refuse for every named plan class; Acceptance 23–24 add the negative fixtures. |
| gpt-5 4 (delegation has no predecessor ratchet) | RESOLVED | D2 adds the delegated-approver predecessor ratchet and owner baseline; approvals validate against the predecessor owner map; co-landing fails `..._DELEGATION_NOT_PRIOR`; Acceptance 7 has both the negative and the three-update positive sequence. |
| gpt-5 5 (fixture custody unbound) | RESOLVED | The complete fixture-profile id/digest/ceiling/principal/data tuple is bound into declaration, scopeDigest, approval schema, D5 baseline, bundle, projection, and A6 example; any rebind/classification change is growth; Acceptance 9/13 mutation-test it. |
| gpt-5 6 (future `issuedOn` defeats 90 days) | RESOLVED | D4 makes `issuedOn` a not-before boundary with trusted server `admittedAt`, five-minute skew, dual 90-day caps, generation/activation/read checks on trusted time, `..._NOT_YET_VALID`, and Acceptance 12 boundary fixtures; a 2099 record is unusable even if both admission checks are evaded. |
| gpt-5 7 (baseline lacks transition provenance) | RESOLVED | D5 adds `admissionKind` provenance heads plus an append-only per-table digest-chain ledger that codegen validates to the G1/new-table root without Git; policy-equal closure deletion fails `..._POLICY_PROVENANCE_INVALID`; admission comparators govern ledger removal/rebind (Acceptance 11). |
| claude 1 (guarantee overclaim, undetectable landed violation) | RESOLVED | Guarantee language removed; per-push server audit retains the true push boundary so a landed violation is detectable; quarantine/removal/fresh-approval remediation and the exposure interval are specified (but see NEW finding 2 on the auditor's own custody). |
| claude 2 (merge-base undefined for new refs) | RESOLVED | D3 scopes enforcement to configured integration refs containing `refs/heads/main`, defines existing-ref `before`-OID predecessor, new-ref anchor merge-base, no-base refusal, deletion, per-ref multi-ref evaluation, and the topic-ref exemption rationale; Acceptance 5 exercises each. |
| claude 3 (synchronous principal population unrepresentable) | RESOLVED | The `principal` authority mode with a closed host-composed admission policy gives moderation/admin/aggregates a governed spelling; A4 and the taxonomy are reconciled with LLP 0231 D1; Acceptance 17 covers activation and ratchet presence. |
| claude 4 (elevated-read residual invisible to the review surface) | RESOLVED | D1 states the residual plainly; D6 adds `elevatedReadSites[]` and `generated/elevated-read-site-baseline.json` so a new/moved D7 site is a review diff, explicitly not an approval ratchet — the reviewer's suggested shape. The census's exactness claim is a new problem (NEW finding 1), but the round-1 finding as posed is answered. |
| claude 5 (membership-declaration semantics outside the digest) | RESOLVED | D5 normalization closes over declaration id, membership/resource tables, field bindings, `resourceField`, and the effective role vocabulary when `roles` is omitted; the closure digest is shared with override row scopes and admission policies; Acceptance 9–10 test the byte-identical-policy widening. |
| claude 6 (G0 hard-depends on unbuilt LLP 0173) | RESOLVED | G0 owns the minimal severable `generated/visibility-authorization-review.json`; no enforcement locus reads any projection; LLP 0173 folding is a byte-equivalence-gated migration of review convenience only (D6, Acceptance 16). |
| claude 7 (stale line citations) — MINOR | RESOLVED | Citations now use diagnostic/symbol anchors; spot-checked anchors exist on the current tree. |
| claude 8 (G1 choice 2 incoherent) — MINOR | RESOLVED | Choice 2 is restructuring onto job-owned/derived or public-by-design tables; the public-read/no-override baseline fact is stated, with widening still governed. |
| claude 9 (fixture attestation unspecified) — MINOR | RESOLVED | Target-owned startup attestation against committed registration, the `repository-local-fixture` dev default, hosted explicit-configure-or-refuse, and the plumbing cost are all specified (D4, Costs, Acceptance 13). |
| claude 10 (backstop-red invariant unstated) — MINOR | RESOLVED | The committed corpus admits fixture overrides only; zero production overrides is a G1/Acceptance 24 invariant. |

All thirteen round-1 MATERIAL findings are genuinely resolved with
implementable mechanisms, not acknowledgements.

## B. NEW findings introduced by the revision

### 1. MATERIAL — the elevated-read census claims an exactness that no specified mechanism can deliver over opaque JavaScript

D6 specifies `elevatedReadSites[]` as "an exact, sorted census keyed by
operation, repository-relative source path, stable source-span id, read form
… and statically named table set," D1 says D6 "makes every elevated read call
site, read kind, and statically named table visible," and Acceptance 16
requires "exact D7 elevated-read call site/read-form/table evidence." No
evidence basis is specified anywhere, and the only generation-time option —
static scanning of handler source — cannot be exact over code this same RFC
repeatedly rules opaque (its own LLP 0170 citations; LLP 0231's withdrawn
"class J" ruling that handler self-description is not enforcement). A hostile
engineer writes `const e = ctx.db.elevated; e.query(t)` or
`ctx.db.elevated[form](...)` and the site never appears in the census or the
site baseline, yet every artifact still validates — absence of a row is
indistinguishable from absence of a call, which defeats the exact purpose the
surface was added for (round-1 claude finding 4). Meanwhile the runtime
already has an alias-proof observation point: every elevated read is a named
host call (`db.elevated.get|getMany|uniqueMany|query`,
`packages/snapback-harness/ctx-bootstrap.js:801-805`).

**Suggested resolution:** make the census exact by construction at the host
boundary — the manifest declares each operation's elevated capability (read
forms, plus static tables where known), and the host refuses any
`db.elevated.*` host call from an operation absent from that committed
declaration, so the census is enforced-exact at operation × read-form
granularity regardless of handler spelling; source paths/spans downgrade to
best-effort static evidence. Alternatively, delete "exact"/"every," name the
static-scan evidence basis, and state the aliasing-evasion residual in D1 and
D6. Either is a bounded edit; the current text is not implementable as
written.

### 2. MATERIAL — the server push-event auditor's own custody is unspecified, and the natural implementation is disableable by the very push it audits

D3's honest-residual analysis distinguishes an ordinary bypasser ("the server
job then detects an ordinary bypass only after the ref has moved") from a
stronger adversary ("a pusher who can also disable or evade the push-event
job"). But the RFC never requires the job's trigger, configuration, or
verdict retention to live outside the audited tree. This repository's
existing per-push jobs are all in-repo workflows (`.github/workflows/`),
which ride inside the pushed tree — so the natural G0 implementation lets
*every* pusher delete or neuter the audit in the same push that lands the
violation, at the same cost class as `--no-verify`. The two adversary tiers
collapse, the "ordinary bypass is observed" claim fails for exactly the
non-cooperative population that motivated round-1 finding 1, and Acceptance
4's fixtures would still pass because none of them tamper with the audit
configuration.

**Suggested resolution:** add a D3/G0 requirement that the push-event job's
trigger, configuration, and verdict/ticket retention are not modifiable by
the content of an audited push (an external webhook receiver, an
organization-level or otherwise protected workflow, or a scheduler that reads
the remote event/reflog independently), and add an Acceptance 4 fixture in
which the violating push also deletes or edits any in-tree audit
configuration yet the violation is still retained and ticketed. If the
repository cannot host such custody today, say so and fold it into OQ1
explicitly rather than leaving the two-tier adversary framing implying it.

### 3. MINOR — `principal`-mode behavior on non-admission is unspecified

D1/taxonomy say a `principal` override "activates only after" the
host-composed admission policy is satisfied, and Acceptance 17 says a fixture
"cannot activate on authentication alone" — but neither says what the named
operation does when admission fails: refuse with a stable code, or proceed
under ordinary table policy. Both are sound against widening, but they differ
observably and an implementer must guess. **Suggested resolution:** one
sentence choosing the behavior (and, if refusal, the diagnostic code) plus a
clause in Acceptance 17.

### 4. MINOR — transition-closure retention is open-ended

D5's codegen "walks the chain to the G1/new-table root" and "verifies every
required closure," so ordinary-policy transition approvals must remain
resolvable in the tree forever; OQ2's archival question covers override
approvals only. **Suggested resolution:** state whether transition closures
may move to an archive via a governed re-pointer (validated like the re-key
record) or must remain in place indefinitely, and add the accumulation to
Costs.

### 5. MINOR — quarantine records are not in the admission comparators' governed artifact set

D3 makes a landed quarantine record the thing that forces current-tree
generation to refuse the affected ids, and D5 governs ledger removal/rebind —
but nothing names removal of a quarantine record as an admission-governed or
server-audited event, so un-quarantining is an ordinary edit. **Suggested
resolution:** add `snapback/visibility-governance-quarantine/` to the
append-only, admission-governed artifact class alongside the ledger.

## Summary

Every round-1 MATERIAL finding from both families is genuinely resolved with
implementable mechanisms — the convergent D3 rearchitecture, the root-
provenance D7 fence, the delegation and transition-ledger ratchets, trusted
not-before time, the fixture tuple, membership-audience closure, the
`principal` mode, and the severable projection are all real designs, and the
guarantee language is gone. But two of the new surfaces repeat, in miniature,
the overclaim pattern round 1 penalized: the elevated-read census promises an
exactness no specified mechanism can produce over opaque handlers (finding
1), and the push-event auditor's detection claim silently assumes audit
custody the RFC never requires and the repo's natural implementation does not
provide (finding 2). Both have bounded fixes.

VERDICT: MATERIAL
