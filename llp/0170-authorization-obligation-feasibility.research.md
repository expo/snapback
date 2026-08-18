# LLP 0170: Authorization obligation feasibility

**Type:** Research
**Status:** Draft
**Systems:** Authorization, Memberships, Code generation, Runtime, Security, Testing
**Author:** Codex (gpt-5.6-sol) / Charlie Cheever
**Date:** 2026-08-04
**Related:** LLP 0009, LLP 0053, LLP 0055, LLP 0056, LLP 0058, LLP 0065, LLP 0100, LLP 0108, LLP 0131, LLP 0172, LLP 0173

## Summary

Snapback cannot soundly implement the rejected 0170 rule from its current
manifest. Most importantly, `authScopeField` does not authorize a read. It
names a result field for live-query invalidation and disjointness reasoning;
the handler must still enforce the caller filter. Treating it as a discharge
witness would let a leaking JavaScript query pass generation.

The larger universal rule is also under-specified. A JavaScript handler's
`reads` list is a dependency declaration, not result provenance. It does not
say which table contributes returned rows or how an aggregate, projection,
history read, branch read, or auxiliary authorization read relates to the
result. Current JavaScript write declarations and `EffectCeilingV1` likewise
name tables, not fields, and the JavaScript ceiling has an authored rather than
statically proved basis.

This Research document therefore rejects the original mechanism as designed.
It does not rename an unsound witness or weaken the claim. A future read-
obligation RFC is possible for a deliberately analyzable HostPlan subset, but
only after it defines result provenance, executable witnesses, broad role
access, and waiver authority. Two independent pieces survive as separate
proposals: explicit function authorization requirements (LLP 0172) and a
deterministic authorization review projection that makes no enforcement claim
(LLP 0173).

## Evidence boundary

The motivating application evidence is one external four-backend comparative
build: Chessfield, 2026-08-04. Its Snapback arm passed 21 required checks and
two additional checks. That run establishes one concrete vigilance gap: the
author wrote the correct game-membership predicate, but current generation
would also accept the operation without it. It does not establish the
frequency of that error, a complete ownership taxonomy, or a general rule for
all query shapes.

The feasibility findings below were independently checked against the current
repository rather than inferred from the build or the rejected RFC.

## Verified substrate

| Surface | Verified fact | Consequence |
|---|---|---|
| `guide/auth/sessions-and-principals.md`; `crates/snapback/src/live_matcher.rs` | The executable security boundary is the filter comparing a stored field with `authUserId()`. For JavaScript live queries, `authScopeField` only permits invalidation/disjointness reasoning over returned fields. | `authScopeField` is not an authorization proof. |
| `packages/snapback-codegen/index.mjs` | A JavaScript query emits its authored `reads` as `declaredReads` and a list result contract; no carrier binds returned rows to one declared table. | General JavaScript result provenance is absent. |
| `packages/snapback-codegen/index.mjs`; `crates/snapback/src/manifest.rs` | A plain HostPlan query carries a closed table, filters, membership predicates, and result row shape. Relational and composite plans have distinct source and projection structures. | A narrow structural analysis is possible, but it must be plan-class-specific. |
| `packages/snapback-codegen/index.mjs`; `crates/snapback/src/manifest.rs` | HostPlan membership predicates retain the declaration, optional roles, and either a row-field or argument resource reference. | A row-field semi-join can be evidence; an argument membership check alone does not bind returned rows to that argument. |
| `packages/snapback-codegen/index.mjs`; `packages/snapback-codegen/effect-ceiling.mjs`; `crates/snapback/src/manifest.rs` | JavaScript `writes` and `EffectCeilingV1` identify tables and operation classes. JavaScript ceilings have `basis: "declared"`; runtime ceiling validation statically proves closed HostPlans, not opaque handlers. | `writtenBy` cannot be enforced per field for JavaScript handlers. |
| LLP 0058 and its implementation | Function requirements are `public`, `optional-user`, or `authenticated`; absence is the legacy `optional-user` behavior. | Omission is real, but it is an independent declaration contract, not support for read-obligation inference. |
| Generated review surface | `generated/artifacts.json` is the committed review unit; detailed function manifests are regenerable cache entries and the review index records their digests. | A concise authorization projection is useful, but it needs no undefined widening policy to ship. |

## Findings

### 1. The original discharge rule is unsound

A direct-ownership witness must be executable and structural: for a closed
single-table HostPlan, an equality filter whose row field is compared with
`AuthUserId`, or an equivalent host-injected enforcement plan. A membership
witness must authorize each returned resource: a row-field semi-join, or an
argument-addressed membership check plus a proved equality binding the queried
resource to that argument.

The following are not sufficient witnesses:

- `authScopeField`, because it injects no filter;
- a JavaScript author's assertion that a handler is scoped;
- an argument-addressed membership predicate without a binding from returned
  rows to the argument; or
- the presence of `userId` in an authorization-dependence vector, which names
  an input dimension rather than the predicate's information-flow result.

Opaque JavaScript therefore cannot be mechanically discharged under the
current runtime. A future mechanism must either put enforcement in a generated
host wrapper or row-policy layer, or label the operation as author-asserted.
The latter is review evidence, not proof, and cannot support the rejected
headline that the app would not build unless safe.

### 2. The universal result rule lacks provenance

`readSetSummary.tables` is intentionally a dependency/invalidation carrier.
An operation may read a membership table only to authorize a query, read a
base table but return an aggregate, or read several sources and return a
projection. History and branch reads add time and stream identity to the
question. Treating every declared read as returned row data creates false
obligations; treating the first read as the result source creates false
discharges.

A first feasible slice would have to be explicitly limited to one closed
HostPlan class, such as a single-table Query/LiveQuery whose result rows are the
table's stored-document shape. Every other plan class would be outside that
claim until it has its own provenance contract. “Fail or waive everything
else” is not automatically acceptable: if normal JavaScript and aggregate
workloads become mass-waived, the review surface loses signal.

### 3. Ownership is not a complete policy taxonomy

The rejected four-form table declaration (`owner: field | via | public |
unscoped`) fits the chess example but not the repository's own role-based
shapes. An administrator may legitimately read all resources after a role
predicate on a membership relation. Moderation views, audit logs, aggregates,
and public projections also distinguish base-row custody from result audience.

Table-wide `public` and `unscoped` are especially unsafe as automatic
discharges: they silently authorize operations added later and can outlive the
schema facts that motivated them. A future design should model operation
audience and executable policy, not presume one durable owner classification
can discharge every future read of a table. It must test at least direct-owner,
row-membership, argument-addressed membership, role-broad, aggregate, and
public-projection cases before proposing a closed taxonomy.

### 4. Waiver authority is a prerequisite, not polish

A free-text `waived: "reason"` beside the failing operation is cheaper than
understanding the predicate and can be added by the same change that creates
the hole. Counting or rendering such strings does not make them authoritative.
A future RFC must define at least the waiver's scope, who may grant it, how new
waivers are distinguished from an accepted baseline, expiry or ratchet
semantics, and which widening the waiver authorizes. LLP 0055 scoped grants are
a candidate authority, not a decision made here.

### 5. Column write provenance is not implementable as proposed

Closed HostPlan mutations expose field expressions, so a narrow plan-only
check could reject writes to a named field. That does not establish the
original `writtenBy` contract for the whole function surface. JavaScript
handlers declare table writes; the runtime does not enforce a field-granular
ceiling. Nor is there a general user-authored “internal-only” operation class
that turns an ordinary action or mutation into a proven system-only writer.

`writtenBy: 'system'` would therefore be fail-open for opaque handlers and
ambiguous for scheduled targets. No RFC is split out for it. Reconsideration
requires field-granular static or runtime enforcement plus a non-client-
invocable operation authority, or an honestly plan-only feature with no
`system` claim.

### 6. Review output is separable from enforcement

A generated authorization view is useful even before obligation inference.
It can report explicit requirements, read/write summaries, structured HostPlan
membership facts, `authScopeField` with its actual invalidation-only meaning,
JavaScript opacity, and effect-ceiling basis. It cannot declare operations safe
or reject “unexplained widening” without a baseline, partial order, and scoped
acknowledgement format. LLP 0173 proposes only the deterministic projection and
ordinary stale-regeneration gate.

### 7. Explicit auth requirements are a separate contract

The source confirms that omitted `auth` becomes `optional-user`. The coherent
“declare it or be refused” rule is not a default to `authenticated`; it is an
explicit choice among the existing three requirements. LLP 0172 proposes that
sessions-mode contract with a warning-then-error migration. It leaves explicit
`optional-user` valid and does not call authenticated-but-unscoped reads
default-deny.

## Conclusions and open work

| Topic | Disposition | Why |
|---|---|---|
| Original derived read-obligation RFC | Rejected as designed | Its core witness does not prove identity or row binding. |
| HostPlan-only obligation analysis | Open | Feasible in principle after a closed result-provenance and policy taxonomy is specified. |
| JavaScript obligation discharge | Open | Requires generated/runtime enforcement or an honestly asserted evidence class. |
| Aggregates, projections, history, branches | Open | Each needs explicit result and temporal provenance; chess supplies none. |
| Role-broad access | Open | Must be first-class rather than forced through a waiver. |
| Waiver governance | Open | Authority, scope, baseline, and review semantics are load-bearing. |
| Live resume | No new decision needed | Generation can classify a plan, but the executable predicate remains runtime enforcement; LLP 0053/0100 own invalidation and revocation across resume. |
| Column write provenance | Deferred | Current JavaScript and operation-authority surfaces cannot enforce the claim. |
| Explicit auth requirement | Separate Draft RFC | LLP 0172. |
| Authorization review artifact | Separate Draft RFC | LLP 0173; no widening comparator. |

Any future obligation RFC must include adversarial runtime acceptance: an
`authScopeField`-declaring JavaScript query that leaks another user's row must
not count as discharged; an argument membership check whose returned rows are
not bound to that argument must also fail; every accepted witness must be
executed against a non-member caller. Generation-only fixtures cannot prove the
runtime property that motivates the work.

## MATERIAL review disposition

| Review concern | Disposition |
|---|---|
| GPT-5 M1 — `authScopeField` and argument membership are false witnesses | Resolved by Findings 1: neither is a discharge; executable row binding is required. |
| GPT-5 M2 — manifest lacks universal result provenance | Resolved by Finding 2: the universal rule is rejected; a future slice must name one closed HostPlan class or add provenance first. |
| GPT-5 M3 — `writtenBy` is unenforceable | Resolved by Finding 5: no follow-on RFC is created until field-granular enforcement and operation authority exist. |
| GPT-5 M4 — default contract contradicted itself | Resolved by splitting LLP 0172: omission warns then fails; all three explicit values, including `optional-user`, remain valid. |
| GPT-5 M5 — widening semantics undefined | Resolved by LLP 0173's narrow projection; no widening comparator or acknowledgement claim remains. |
| GPT-5 M6 — several security mechanisms shared one gate | Resolved by retyping 0170 as Research, splitting 0172/0173, and deferring column provenance. |
| Claude M1 — JavaScript tier makes the headline unbuildable | Resolved by Findings 1–2: JavaScript is not mechanically discharged; assertion is labeled evidence, not proof. |
| Claude M2 — role-based broad reads break the taxonomy | Resolved by Finding 3: the four-form taxonomy is rejected and role-broad access is a required future case. |
| Claude M3 — free-text waiver has no teeth | Resolved by Finding 4: waiver governance is a prerequisite; the rejected syntax is not retained. |
| Claude M4 — table `public`/`unscoped` fails open for future operations | Resolved by Finding 3: neither table-wide form is accepted as a durable automatic discharge. |
| Claude M5 — ownership declarations had no migration | Resolved by deleting that proposal. A future RFC must include its own migration after the declaration model is sound. |
| Claude M6 — core rule presumed an answer about `authScopeField` | Resolved: source verification answers it; `authScopeField` remains an invalidation declaration and is not subsumed or used as authorization evidence. |
| Claude M7 — acceptance did not test runtime safety | Resolved by the adversarial runtime requirements above; the unsound proposal itself has no Acceptance section. |
| Claude M8 — write provenance is a separate RFC | Resolved more conservatively: it is deleted rather than promoted, because the current substrate cannot enforce it. |

## Confidence

High for the negative feasibility findings: they are direct consequences of
the guide, generated manifest shapes, codegen branches, live matcher, and
effect-ceiling validator in this repository. Moderate for the claim that a
narrow HostPlan-only RFC is worthwhile: chess demonstrates one case, but no
multi-workload corpus yet establishes coverage or waiver pressure.
