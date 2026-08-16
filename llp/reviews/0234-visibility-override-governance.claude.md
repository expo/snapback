# Review: LLP 0234 — Visibility override governance

**Reviewer model:** claude-fable-5
**Date:** 2026-08-15
**Document revision reviewed:** Revised 2026-08-15 (distinguish LLP 0231 D7
call-local handler reads from governed invocation overrides)
**Review scope:** independent, mutually blind; no other review artifact was
read. Code claims verified against the worktree at `origin/main`
(`packages/snapback-codegen/index.mjs`, `packages/snapback-codegen/define.mjs`,
`src/manifest.rs`, `.githooks/pre-push`, `scripts/drift-prone-gates.mjs`,
`llp/0231`, `llp/0173`, `llp/0070`, the A6 demo sources).

Verification summary before findings: the RFC's substantive code claims are
true. The implicit-table warning with the "fail phase blocked on override
governance" `@ref` exists (`packages/snapback-codegen/index.mjs:2875-2905`),
plus a second warn-phase diagnostic for uncomposed read surfaces
(`SNAPBACK_TABLE_VISIBILITY_UNCOMPOSED_READ_SURFACE`, ~3846-3870).
`TableVisibilityV1` is a closed union with no override variant
(`src/manifest.rs:1322-1341`); the only `override` field in that file is the
unrelated `local_loopback_test_override` (`src/manifest.rs:13787`); search
visibility is mandatory-or-fail (`packages/snapback-codegen/define.mjs:1014`).
The A6 demo citations are substantively accurate.

## Findings

### 1. MATERIAL — The pre-push separation locus does not match the repository's actual push/gate architecture, and a violation that lands is permanently undetectable

D3 ("There are two enforcement loci", the `SNAPBACK_TABLE_VISIBILITY_OVERRIDE_SELF_APPROVAL`
block, and the sentence "This mechanism guarantees remote-observed record
separation") and G0/Acceptance 3 and 7 place the entire separation property on
the repository pre-push hook. Three facts about the repo undermine that as
written:

- The tracked hook is opt-in per clone (`git config core.hooksPath .githooks`)
  and bypassable with `--no-verify`; many concurrent agent clones push around
  the clock.
- The hook's ordinary posture for `origin/main` pushes is deferral: the
  runner prints "DEFERRED BY DEFAULT" and leaves execution to the scheduled
  backstop unless `SNAPBACK_DRIFT_GATES_STRICT=1` is set
  (`scripts/drift-prone-gates.mjs:865,894`; CLAUDE.md pre-push policy; LLP
  0232 makes optimistic landing the ordinary default, and authorized-bypass
  landings are established practice).
- Critically, **push boundaries are not recoverable from Git history**. Once
  a same-push self-approval lands on `main`, the resulting linear history is
  byte-identical to a compliant two-push sequence (approval commit, then
  widening commit). The advertised old object exists only at the pre-push
  moment. No scheduled backstop, drift gate, or post-hoc audit specified in
  this RFC can ever detect or repair the violation.

So "guarantees" overclaims: the guarantee holds only against cooperative
pushers running an installed, strict, non-deferring hook — exactly the
population that was not the threat.

**Suggested resolution:** (a) state that both D3/D5 comparators are a
synchronous, never-deferred, bypass-refusing class of pre-push check, exempt
from the LLP 0232 deferral posture and from `SNAPBACK_DRIFT_GATES_BYPASS`;
(b) add a server-observed audit to G0 — a CI job triggered per push event
(the push payload carries the true `before`/`after` OIDs) that re-runs the
same comparator against the real push range and files a red ticket on
violation; (c) define remediation for a landed violation (the override is
treated as unapproved: generation refuses until a genuine remotely-prior
approval is re-established). With (b), even a `--no-verify` or hookless push
is caught within one CI cycle, and the "guarantee" language becomes honest.

### 2. MATERIAL — The merge-base rule is undefined for new refs and, read literally, refuses every new-branch push

D3 says the gate runs "for every remote ref being updated" against "the
remote's advertised old object," and Acceptance 7 requires "a multi-ref push
must pass for every updated ref." For a newly created ref the advertised old
object is the null OID: there is no merge-base. Applied literally, the
predecessor snapshot is empty, the entire pre-existing override and policy
baselines register as growth, and every feature-branch push in this repo (a
routine event; agents push worktree branches constantly) is refused. If the
intent is instead to skip new/non-main refs — the drift runner's own behavior
("non-main ref updates left frozen-record execution to an explicit strict
run," `scripts/drift-prone-gates.mjs:918`) — then a widening can incubate on
a branch, which is fine only because the later `main` update re-runs the
comparator; but that choice is nowhere stated.

**Suggested resolution:** specify the predecessor for a newly created ref
(e.g., merge-base with the remote default branch's advertised tip), or scope
D3/D5 enforcement to a named set of integration refs (`refs/heads/main` at
minimum) and state that branch pushes are exempt because the eventual `main`
update re-runs the comparator against `main`'s own old object. Update
Acceptance 7 to match.

### 3. MATERIAL — Principal-carrying cross-cutting reads are unrepresentable, contradicting both LLP 0231 D1 and this RFC's own A4

D1 restricts `authority` to `system` or `capturedGrant`, and pins that "the
override activates only when both the named operation and the declared
authority mode match," so a user-invoked call can never activate an override.
But LLP 0231 D1 defines the override population as "admin views, moderation,
aggregates, and the no-principal paths" — the first three are synchronous,
principal-carrying reads — and this RFC's own A4 rejection argues
"moderation, admin views, and aggregates may be synchronous," i.e., that
overrides must not require the scheduled boundary. As written, a synchronous
moderator-sees-all-rows query has no governed spelling: its only options are
(a) an `any-of` table-policy widening, which broadens *every* read path on
the table rather than one named operation, or (b) D7 `ctx.db.elevated`,
which is explicitly outside this governance (see finding 4). G1's four-choice
taxonomy inherits the gap: it covers cron/jobs/seeds/maintenance (the
no-principal population) but leaves the principal-carrying cross-cutting
population that 0231 assigned to this sibling without an answer.

**Suggested resolution:** decide it explicitly, either way: add a third
authority mode (e.g., `principal`, requiring a declared membership/role
condition on the invoking principal, activation bound to the named operation)
governed identically; or rule that principal-carrying broad reads are served
by ordinary `any-of` policy plus D7 elevated reads and are deliberately not
overrides — and then reconcile A4's text and note the divergence from LLP
0231 D1's enumeration so an implementer is not left with two conflicting
Accepted/near-Accepted definitions of "override."

### 4. MATERIAL — `ctx.db.elevated` is an ungoverned channel that achieves the same read widening this RFC exists to gate, and 0234 requires no census of it

The D7 boundary prose (D1, "LLP 0231 D7's `ctx.db.elevated` is deliberately
not this object") is crisp — an implementer will not confuse the two
authorities, and the activation constraints (no actions, no schedules, no
plans, call-local only) are host-checkable. But the hostile-engineer question
the RFC poses for the second baseline ("delete the override, set the table
public-read" — correctly closed by D5) has a cheaper sibling it leaves open:
write a named query whose handler calls `ctx.db.elevated`, omit or weaken the
preceding `ctx.permissions` check, and return the rows. That widens effective
read exposure of a restricted table to arbitrary callers with zero approval,
expiry, ratchet, baseline entry, or projection row — no 0234 surface trips.
The RFC's "Failure prevented" claims for D1/D5 are therefore overstated in
effect: the invocation-wide escape is governed, but an equivalent call-local
escape is one line of trusted-handler code away and invisible to every
review surface this RFC builds.

**Suggested resolution:** 0234 need not govern D7 (that is 0231's accepted
design), but it should make the residual visible where it builds the review
surface: require D6's projection to enumerate elevated-read call sites per
operation (e.g., `handlerEvidence: elevated`, table set), so an auditor
reading the one page sees every Class-R bypass — governed or call-local —
and consider an exact-set count-plus-sites record so new elevated sites show
up in diff review. Alternatively, state plainly in D1 and the
hostile-engineer analysis that this residual exists, is accepted, and is
controlled only by ordinary code review and D7's own acceptance tests.

### 5. MATERIAL — The ordinary-policy comparator's normalization does not bind referenced membership-declaration semantics, leaving a widening avenue with no policy-digest change

D5's second baseline compares "every table's normalized ordinary visibility
policy." A membership policy may omit `roles` (`roles: Option<Vec<String>>`,
`src/manifest.rs:1331-1336`), meaning any declared role admits. If
normalization records only the policy text (`declaration`, `resourceField`,
omitted roles), then widening the referenced membership *declaration* — a
broader role vocabulary, plus app-authored mutations granting the new role —
widens the effective audience of every table gated on that declaration while
the policy digest stays constant. The comparator sees no transition; no
approval is demanded. This is second-order (it needs cooperating membership
writes), but the hostile engineer writes those mutations too, and the RFC's
own standard is that authority is "a partially ordered set of scopes, not a
number" — the scope here is partly defined by facts outside the digest.

**Suggested resolution:** specify that policy normalization inlines (or
digests) the referenced declaration facts that determine audience — the
effective role set when `roles` is omitted, the resource table, and
`resourceField` — so a declaration edit that broadens any gated table's
effective policy is itself a transition requiring a D5 approval. State the
same for the override row-scope digest, which shares the policy IR.

### 6. MATERIAL — G0 hard-depends on unimplemented LLP 0173 with no stated minimal scope or degraded mode

G0 lists "projection entries" as a deliverable and D6 is written as
"Extend its top level with `visibilityOverrides[]`" — but
`generated/authorization-review.json` does not exist: LLP 0173 is Status
Review, and LLP 0231 records it as "specified, not built." Accepting 0234
therefore makes G0 (and hence G1/G2 and the 0231 D2 phase-2 unblock) depend
on an unaccepted, unimplemented sibling of unstated required scope. The RFC
never says whether a reduced 0173 landing suffices, or what happens if 0173
changes shape or stalls. Note that enforcement (codegen refusal, pre-push
comparators, expiry, fixture fence) does not actually need the projection —
the D5 baselines already carry nearly every fact — so the dependence is
avoidable.

**Suggested resolution:** name the minimal severable surface G0 requires: a
standalone deterministic artifact carrying `visibilityOverrides[]` and
`tablePolicyTransitions[]` (the D6 field lists), emitted whether or not the
full 0173 operation-level projection exists, and folded into
`authorization-review.json` when 0173 lands. State explicitly that no 0234
enforcement locus reads the projection, so a reduced or late 0173 degrades
review convenience, not soundness.

### 7. MINOR — Stale code line citations throughout the evidence section

Verified drift on current `main`: `packages/snapback-codegen/index.mjs:2507/2510/2513/2534`
→ the implicit-visibility block is now at ~2875-2905;
`packages/snapback-codegen/define.mjs:897` (`SNAPBACK_SEARCH_INDEX_VISIBILITY_REQUIRED`)
→ 1014; `src/manifest.rs:1256` (closed policy union) → 1322-1341;
`src/manifest.rs:13136` (loopback override field) → 13787;
`llp/0070-durable-background-work.rfc.md:731` (mode definitions) → ~738-745.
Every underlying claim checked out; only the line anchors drifted, as
expected on this repo's velocity. **Suggested resolution:** refresh the line
numbers at acceptance time, or cite by symbol/diagnostic-code anchor
(`SNAPBACK_AUTH_TABLE_VISIBILITY_IMPLICIT`, `TableVisibilityV1`) so citations
survive drift.

### 8. MINOR — G1 choice 2 is incoherent for the no-principal population it addresses

G1 offers "a narrower ordinary/generated table policy" as one of four
choices for "each no-principal read." No narrower caller-keyed policy admits
a principal-free reader — narrowing strictly reduces what such a read sees
(only `public-read` admits it, and that is a governed *widening*). The
choice presumably means "restructure so the job reads public-by-design or
job-owned tables" — and the taxonomy should also state the implied baseline
fact that a principal-free read of a `public-read` table needs no override.
**Suggested resolution:** reword choice 2 to say restructuring
(job-owned/derived tables, public-by-design tables) and add one sentence
that `public-read` admits principal-free reads without an override.

### 9. MINOR — Fixture-profile attestation and the local-dev default are unspecified

D4 has the host refuse a `fixtureOnly` bundle "in every production, hosted,
or undeclared profile." The trusted input that determines the profile is not
specified, and if "undeclared refuses," a casual local `snapback serve` of
any demo carrying a fixture override fails until profile plumbing is
universal — a migration cost G1 does not list. **Suggested resolution:**
name the profile attestation mechanism (host config, not caller input) and
the local-development default (e.g., a dev-serve profile that satisfies the
fixture fence for repository-registered apps), and add the cost to the
Costs section.

### 10. MINOR — The repo-corpus discipline that keeps production expiry off the scheduled backstop is implied, not stated

D4's fixture relief exists so "the two-hour regenerate-and-compare backstop
does not manufacture quarterly reds," which implies an invariant the RFC
never states: no `lifecycleClass: production` override may appear in the
committed demo/packaged-consumer corpus, since production generation is
wall-clock-dependent and would hand the backstop scheduled reds by design.
**Suggested resolution:** state the invariant and have G1's closure check
enforce it (the corpus admits fixture overrides only), so the determinism
property in Acceptance 10 covers the whole committed corpus.

## Summary

The RFC's core design — content-bound approval records, remote-observed
two-push separation, exact-set ratchets over a partial order, hard
production expiry with fixture fencing, and the mode taxonomy that keeps
`revalidatePrincipal` out of the override census — is internally coherent,
honestly bounded (the identity limit is stated, not hidden), and clearly
better than every alternative it considers. The A6 worked example is real
and its citations check out. But acceptance now would bless G0 acceptance
conditions that are not implementable as literally specified (findings 1,
2), an override definition that contradicts its parent RFC's enumeration for
the synchronous population (finding 3), an unmanaged equivalent-widening
residual the review surface cannot see (finding 4), a comparator input gap
(finding 5), and an unscoped dependency on unbuilt LLP 0173 (finding 6).
All six are fixable with bounded text changes; none requires rethinking the
architecture.

VERDICT: MATERIAL
