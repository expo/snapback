# LLP 0136 review — Fable family


## Round 1 — 2026-07-31

**Reviewer family:** Claude Fable
**Provider / runtime:** Anthropic Claude Code, `claude-fable-5`, fresh non-author subagent
**Effort:** session-inherited
**Date:** 2026-07-31
**Redacted:** no
**Method:** fresh non-author subagent context, read-only review of the
working tree (HEAD `cffe06ff` at review start; target SHA-pinned);
mutually blind — no `llp/reviews/` artifact for LLP 0136 read, blind to
this Spec's codex artifact. Verified against: the commissioning ticket
`issues/20260730-move4-live-search-design-and-react-arm.md` (full read),
LLP 0119 v0.2 (full read), LLP 0073 (full read), LLP 0053 §Design
through §Two orthogonal declarations plus the obligation/retainability
text, LLP 0112 §authoring/§preparation, LLP 0114 (hook surface), LLP
0091 §0B.1–0B.3, LLP 0115 CV-11 (v0.5 note, at plan v0.7), LLP 0127
move 4, LLP 0130 SD-4/ER-2, and the code seams: `src/manifest.rs`
(kind/runtime pairing match, implied capabilities,
`validate_authority_independent`, `validate_public_inline`,
`rqs_eligible_digest_kind`), `src/local.rs`
(`subscribe_live_prepared_with_invalidation`, `execute_query_invocation`
dispatch arms, `notify_live_subscriptions_in_frame`, routes-manifest
validation), `src/live_matcher.rs` (`live_subscription_may_be_affected`,
`compute_live_delta`), `src/storage.rs` (`ChangedRow`),
`src/live_wire.rs` (`LiveEnvelope`), and
`packages/snapback-codegen/index.mjs` (route compilation,
`registerGroupEligible` derivation, `assertLiteral`).
**Target:** `llp/0136-live-search.spec.md` (401 lines)
**Target SHA-256:** `5bfe7b882ee4b168f00f42e355dfe6fa2d6a7dc141bcc9b4efeb61f432b1f9bb`
**Status:** completed

## Verbatim review

1. **Overall assessment**

This is a disciplined, commission-faithful design whose central code claims
verify exactly. I checked every load-bearing seam claim against the tree:
the manifest pairing match admits `(Query|LiveQuery, Query)`,
`(Query|LiveQuery, RelationalQuery)`, `(Query, SearchQuery)` only, and
`(LiveQuery, BoundedChildrenQuery)` only, with the fallthrough refusing
`SNAPBACK_FUNCTION_KIND_RUNTIME_MISMATCH` (`src/manifest.rs:939–980`) —
both cited precedents exist exactly as claimed; the implied-capability
mirroring is accurate (relational-under-LiveQuery implies
`relational_query_v1` + `live_subscriptions`, `manifest.rs:983–995`);
subscription admission keys on `function.kind != FunctionKind::LiveQuery`
and nothing else (`src/local.rs:7703–7709`), so the ordinary search
function's `SNAPBACK_FUNCTION_NOT_LIVE` refusal is preserved verbatim on
exactly the pinned functions with no change; the
`SNAPBACK_BOUNDED_CHILDREN_LIVE_CURSOR_UNSUPPORTED` first-page-only
precedent exists (`local.rs:7783–7796`); execution dispatch pairs search
with `Query` only (`execute_query_invocation`, `local.rs:16308`), and
because establishment, wake rerun, and ordinary invocation all route
through that one dispatch, the proposed single added arm genuinely covers
every execution path; the matcher's `SearchQuery` arm is table-granular
and otherwise unreachable (`src/live_matcher.rs:180–182`); `ChangedRow`
carries exactly table/id/op/row/changed-fields and no posting keys
(`src/storage.rs:256–263`); `rqs_eligible_digest_kind` returns `None` for
any runtime that is not a plain `HandlerPlan::Query`
(`src/manifest.rs:1733`), so the retention/resume-ineligibility claim is
indeed free by construction — and it survives the Spec's own
authority-independent extension, since the RQS gate is plan-shape-gated
independently; the delta lane excludes non-`Query` plans by construction
in the fanout (`local.rs:13344–13352`) and `compute_live_delta` declines
ordered/limited windows exactly as characterized
(`live_matcher.rs:650–652`), so "the replace lane is the honest carrier,
not a fallback" is true and the claim that live search never uses
`live_delta` requires no new enforcement; `LiveEnvelope::LiveReplace` has
no cursor slot and its optional `resume` member carries the exact LLP
0091 §0B.2 old-decoder-tolerance precedent in both spec text and code
comment (`src/live_wire.rs:51–61`); and the auth-scoped admission gates
(negotiated protocol + validated namespace, sessions-mode ∧
not-authority-independent) are exactly as described
(`local.rs:7725–7777`). The five-blocker inventory covers LLP 0119's
six-item coordinated-change list completely once §Authoring surface and
§Capability id are counted, OQ1 and OQ2 are answered as proposals for the
author as commissioned, the measurement gates cover every OQ7 quantity in
this design's scope, the claim posture is honestly nothing-changes-until-
acceptance, Appendix A's amendment is correctly deferred and correctly
scoped (the pin re-scopes to the ordinary operation; Diary 0037 check 6
stays green), and the out-of-scope list matches the commission's
exclusions precisely.

Three concerns are MATERIAL, and all three are of the same kind: a
composition fact asserted as current-tree truth that the tree contradicts
or does not contain. The register-group ineligibility claim is wrong for
literal-AST children (the eligibility derivation would admit a live-search
child today, silently extending the register/bundle surface to search);
the coalescing contract is normative and load-bearing for the budget
bound, but no coalescing machinery exists in the synchronous in-frame
fanout and the Summary's remaining-work enumeration omits it; and the
public-read `authorityIndependent` claim conceals a required validator and
codegen change (the validator admits only plain `Query` runtimes today)
plus an unswept second-order surface (`publicInline`). None touches the
architecture, which is sound; all are fixable in text.

VERDICT: NOT READY

2. **Strengths**

- **The admission-path decision is argued from the closed kind vocabulary
  and both real precedents, and it is right.** No fifth kind, no new plan
  variant; the `(LiveQuery, SearchQuery)` pairing follows the relational
  shape exactly, and the Spec correctly observes that the authored
  classification stays untouched, neither anticipating nor foreclosing the
  watch-gated 1a. Every code citation in the blocker list verifies.
- **Blocker 5 is handled with exemplary honesty.** The posting-key carrier
  is named as option 5's work, not smuggled in; v1's wake-precision claim
  is pinned at exactly table-granular; and the optional `changed_fields`
  narrowing is fail-closed in the right direction (unknown or empty always
  wakes — matching LLP 0053's own `permissionFields` rule for known
  updates only) and uses only the carrier that exists.
- **First-page-only liveness genuinely composes with the stateless
  120-second cursor contract.** The design never asks the cursor to be a
  subscription token: each delivery re-mints under current authority
  inside the pinned snapshot, superseded-page cursors resolve under LLP
  0073's existing keyset honesty or the coded restart, and "same cursor
  contract is literal" holds. The bounded-children precedent for the scope
  shape and the refusal diagnostic is real and apt.
- **Retainability-free-by-construction is verified, not asserted.** The
  Spec claims no retention while showing the declared-dependence
  precondition would hold — exactly the right posture — and the claim that
  `rqs_eligible_digest_kind` already enforces it is true in code.
- **The capability-id discipline is the cleanest section.** Sibling id,
  parents required but never sufficient, composition never implies the
  claim, per-target acceptance, named facts for scope/granularity/lane/
  ceilings and the nonclaims — this is LLP 0074's evidence discipline
  applied without a loose edge.
- **Appendix A is the right shape for a pinned-contract amendment:**
  drafted now, dated, applied only when acceptance evidence lands, with
  the pin narrowing to exactly the ordinary operation and the residual
  nonclaims enumerated. No boundary weakens before evidence.
- **Per-delivery safety composes with LLP 0053 correctly on the paths the
  Spec admits.** Every delivery is a full re-execution under the retained
  subscriber authority with the per-row release recheck; auth-scoped
  deliveries ride the conservative obligation-backed `live_replace`
  predicate automatically by using the existing lane; shrinkage is
  delivered, never suppressed; the 0073 resolution that the global epoch
  is not asked to witness ordinary owner-row changes carries over
  coherently; and coalesced delivery at the latest head is consistent with
  obligation discharge (acknowledgement at-or-after the causing commit).

3. **Concerns**

**C1. MATERIAL — the register-group ineligibility claim is contradicted by
the eligibility derivation; a literal-AST live-search child would enter
the register/bundle surface unanalyzed.** §Client composition asserts a
live-search child is "register-ineligible today by 0112's own admission,
no rule change," because its `query` argument "is a per-interaction
structured AST, which route-static register groups cannot carry under LLP
0112's existing literal/parameter rules." That is true only for the
`$param` half: a `$param` mapping into `query` fails the string-primitive
eligibility test (`packages/snapback-codegen/index.mjs:4110`;
`src/local.rs:6700–6709`). But nothing excludes a **literal** AST:
`assertLiteral` accepts arbitrary object literals (it refuses only nested
`$param` references, `index.mjs:4060–4067`), and `registerGroupEligible`
is derived from exactly two facts — every child `__kind === 'LiveQuery'`
and every `$param`-mapped arg string-typed (`index.mjs:4100–4112`); the
server-side routes validation enforces the same two and nothing more
(`local.rs:6680–6709`). The moment the `(LiveQuery, SearchQuery)` pairing
exists, a route `{ pinned: { function: liveRecipeSearch, args: { query:
<literal AST>, limit: 10 } } }` with otherwise-live children derives
`registerGroupEligible: true` and the LLP 0090/0092 register-mode bundle
boots a search subscription — a path this Spec never analyzes: whether the
bundle establishment path dispatches search at the commit cut, whether
`SNAPBACK_SEARCH_LIVE_SUBSCRIPTION_LIMIT` admission (specified "before
any storage work" on the subscription path) binds on the register path at
all, and what the bundle snapshot does with the continuation cursor. The
only remaining guard would be `routeLiteralMatches` against the generated
`query` arg validator (`index.mjs:4086`), which the Spec does not examine
and which, if it admits the AST shape, closes nothing. **Resolution:**
either specify explicit register-ineligibility for search-plan children
(a derivation change in codegen plus the routes validation — and then
"no rule change" must be retracted), or analyze and admit the
literal-AST register path with the ceilings enforced there; in both cases
restate the §Client composition claim on tree-true grounds ($param
ineligible by string-typing; literal eligibility is the open edge the
Spec must close, not deny).

**C2. MATERIAL — coalescing is specified as normative contract and the
budget bound leans on it, but no such machinery exists and the
remaining-work enumeration omits it; acceptance case 5 is vacuous on the
engine as built.** §Invalidation and delivery pins "per subscription, at
most one re-execution is in flight; commits arriving meanwhile set a
dirty flag and one trailing re-execution runs against the latest commit
head," and §Budgets rests the burst bound on it ("coalescing bounds burst
cost by executor throughput rather than commit rate"). The current
delivery engine is synchronous and in-frame: `notify_live_subscriptions_
in_frame` re-executes every affected subscription inside the commit's
notification frame (`src/local.rs:13275–13410`); there is no per-
subscription in-flight state, no dirty flag, and no trailing-run
scheduler anywhere in the live path. On that engine "commits arriving
meanwhile" cannot occur, so acceptance case 5 ("a commit burst during an
in-flight re-execution") is untestable as written, and the burst-cost
claim is false for the synchronous shape — per-commit cost is exactly
commit rate × affected subscriptions, which is precisely the write
amplification the section is bounding. Meanwhile the Summary's
option-4-hypothesis assessment enumerates the remainder as
"admission/dispatch seams, one additive wire member, an authoring entry
point, budgets, and evidence" — no coalescing executor. **Resolution:**
pick one honestly. Either (a) name the coalescing delivery executor as
new work — it is composition-not-invalidation-science, but it is real
machinery with its own correctness obligations (no lost wake, monotone
delivery, obligation-discharge composition) — and amend the Summary's
enumeration and the hypothesis assessment accordingly; or (b) demote
coalescing to permitted-not-required behavior (synchronous per-commit
delivery trivially satisfies at-most-one-in-flight and
final-head-reflection), restate the burst bound per implementation shape,
and scope acceptance case 5 to targets with an asynchronous delivery
path. Option (a) seems truer to the intent, since §Budgets' fanout bound
is meaningless without it.

**C3. MATERIAL — the public-read `authorityIndependent` claim conceals a
required admission change and leaves its second-order surface unswept.**
§Auth-scoped admission states a public-read live search "carries the
generated `authorityIndependent` fact (the validator's admitted shapes
extend to the `public-read` search plan), so it admits without the
protocol." Today `validate_authority_independent` admits **only** plain
`HandlerPlan::Query` runtimes — every other HostPlan and every IbexModule
is ineligible (`src/manifest.rs:1646–1652`) — so a search-plan function
declaring `authorityIndependent` refuses at load with
`SNAPBACK_AUTHORITY_INDEPENDENT_INVALID`. The parenthetical is a needed
change (validator arm + codegen emission for `public-read` search
declarations), presented in the grammar of a present fact, and absent
from the blocker inventory whose completeness the Summary claims. The
failure mode of forgetting it is fail-closed (the function would be
treated auth-scoped and demand the protocol — conservative, not unsafe),
which is why this is a completeness defect rather than a safety one; but
the bar here is exhausted pre-empirical analysis, and an admission seam
hidden in a parenthetical fails it. Second-order: everything keyed on a
valid `authorityIndependent` declaration must be enumerated once the
admitted shapes widen. `rqs_eligible_digest_kind` stays `None`
(plan-shape-gated independently, `manifest.rs:1733`) — the Spec's
retention nonclaim survives, and it says so correctly. But
`validate_public_inline` accepts `publicInline` on any function with a
valid `authorityIndependent` declaration (`manifest.rs:1684–1687`), so
the extension makes `publicInline` newly declarable on public-read search
functions — an unanalyzed disclosure surface the Spec should either
foreclose (refuse `publicInline` on search plans) or argue safe.
**Resolution:** add the validator/codegen extension to the change
inventory as its own numbered seam, and add one paragraph sweeping the
`authorityIndependent`-keyed surfaces (RQS: unchanged by construction;
`publicInline`: forbidden or analyzed; anything else the sweep finds).

**C4. SHOULD-FIX — acceptance case 1's "byte-for-byte" is falsified by
cursor nonce randomization.** LLP 0073 pins that two equivalent cursors
need not be byte-identical and excludes nonce/ciphertext bytes from the
observation boundary; a pushed page containing a fresh `sbsc1.` cursor
can never equal a request-path page byte-for-byte. The parenthetical
"(rank, highlights, stored fields, cursor semantics)" gestures at the
carve-out but the headline term contradicts it. **Resolution:** state the
comparison as byte-for-byte over rows/rank/highlights/stored fields and
semantic-equivalence over the cursor (decode class, plaintext, encoded
length — 0073's oracle).

**C5. SHOULD-FIX — "delivery timing class" overreaches LLP 0073's pinned
claim, and the body and acceptance case 4 disagree.** §Noninterference
requires paired databases indistinguishable across "wake occurrence,
delivery timing class, delivered rows, decoded cursor plaintext and
encoded length, and termination codes"; acceptance case 4 lists the same
minus timing. 0073's semantic claim is explicitly value/code/
continuation-shape, termination-insensitive noninterference, **not** a
timing claim, and forbids reporting stronger timing claims without
separate evidence. If "delivery timing class" means delivery
occurrence/count/order in the semantic transcript, say that; as worded it
reads as a timing-channel claim the acceptance suite then (correctly)
declines to test. **Resolution:** align both lists on 0073's vocabulary —
wake occurrence, delivery occurrence/count/order, delivered rows, cursor
plaintext/length, termination codes.

**C6. SHOULD-FIX — the `changed_fields` narrowing is an
authorization-sensitive skip proof and must carry LLP 0053's convergence
obligation by name.** 0053 requires an LLP 0008 L4-style convergence
assertion in test/dev for **every** authorization-sensitive skip or delta
proof. The narrowing's disjointness set includes the visibility fields,
so a wake skip is exactly such a proof. "Requires its own acceptance case
if claimed" points the right direction but underspecifies it.
**Resolution:** name the obligation — the skip verdict runs against full
re-execution in test/dev profiles, 0053-style — and, since the release
recheck is now digest-based, tighten "cannot alter any posting" to the
observable claim (cannot alter the delivered page or any released fact),
so the wording does not depend on whether maintenance physically
rewrites a posting's bookkeeping on disjoint updates.

**C7. SHOULD-FIX — the new facts and ceilings have no named carrier, and
both candidate carriers are closed shapes that refuse unknown members.**
Inspection facts land "beside `FullTextSearchFactsV1`" — a closed LLP
0037-owned projection — and the ceilings live in "the search
declaration's limits family" inside `SearchIndexManifestV1`, whose closed
object refuses unknown members by 0073's own pin. Adding members to
either is a carrier evolution (new sibling facts object such as
`LiveFullTextSearchFactsV1`? a new closed limits member with a
formatVersion consequence?) that the admission-epoch machinery has to
tolerate across releases. 0073 pinned its carriers exactly; this Spec
should too. **Resolution:** name the facts carrier and the ceilings'
manifest member, and state the compatibility rule for pre-existing
manifests (absent member ⇒ defaults, refusal class for unknown members
unchanged).

**C8. SHOULD-FIX — the wire change's ownership and drift-gate route are
unstated.** The `LiveReplace` cursor member is an LLP 0091-owned surface
with LLP 0051 drift gates (schema exports, the JS kit pin
`demos/_kit/tests/live-wire-schema.mjs`) and LLP 0093 Swift-client
fixtures. The §0B.2 precedent is cited correctly, but "this is the
design's one wire change" should also say where the change lands (a dated
0091 amendment plus the schema-export/fixture updates) so the
old-decoder-tolerance claim is re-proven where it is pinned, not assumed
transitively.

**C9. DETAIL — "the cursor is never asked to outlive its TTL" is
overstated for quiet indexes.** A subscriber holding an established page
on an index with no commits holds its cursor past 120 seconds with no
re-minting delivery; paging then fails closed with
`SNAPBACK_SEARCH_CURSOR_RESTART`. The following sentence's fail-closed
clause already covers this — tighten the lead claim to "never asked to
outlive its TTL *while deliveries continue*" or fold the quiet-index case
into the restart sentence.

**C10. DETAIL — capability-id custody after acceptance is left implicit
against 0127's "LLP 0073 owns live search and its capability id."**
Appendix A points 0073's Non-goals at "this Spec's claim boundary,"
making 0136 the owning document of `live_full_text_search_v1` — a
reasonable resolution, but it quietly revises 0127's what-lands-where
line. One sentence stating the custody outcome (0136 owns the live claim
boundary; 0073 owns the shared rank/highlight/cursor contract both
operations bind) would close it.

4. **Suggestions**

- **State the establishment/matcher registration ordering.** The design
  inherits the existing live machinery's no-missed-commit property between
  the establishment snapshot and matcher registration; one clause saying
  the search path adds no new window (same subscribe path, same pinned
  snapshot) would preempt the reviewer question.
- **Name the `limit` bound at subscription admission.** The `after` guard
  is specified; saying explicitly that `limit: 1..50` validates at
  subscribe exactly as at request (shared argument validation) closes the
  argument surface.
- **The per-connection ceiling (8) will interact with React remount
  behavior** (StrictMode double-invocation, rapid keystroke churn before
  the debounce hook exists — OQ3). A sentence on whether unsubscribe is
  synchronous release (so subscribe-after-release in one keystroke cannot
  trip the ceiling) would make the type-ahead story concrete.
- **Consider naming the wake-side cost of the ceiling check** — admission
  refusal "before any storage work" is specified for subscribe; stating
  that wake-path re-execution consumes the declaration's existing work
  ceiling *per subscription* (so a hot commit's worst case is ceiling ×
  64 by declaration) in the measurement-gate preregistration would make
  the gate's budget arithmetic explicit.

5. **Open questions**

- **Where does the coalescing executor live per target?** (C2's fork.)
  The local engine is synchronous; hosted targets (container-VM lane, DO
  second) will have genuinely concurrent delivery. If coalescing is
  required behavior, its first real implementation is hosted-shaped work
  this Spec's local-first acceptance never exercises — worth saying which
  target proves case 5 first.
- **Does `routeLiteralMatches` admit structured-AST literals for search
  args today?** (C1's residual guard.) The answer decides whether the
  register exposure is live-on-landing or latent behind an authoring
  refusal — either way the Spec should know, not guess.
- **Is the `changed_fields` narrowing's disjointness set closed under
  future declaration extensions** (e.g. CV-12a range filters adding
  filter fields)? A sentence tying the set to "every field named by the
  index declaration, whatever its role" would future-proof the proof.

6. **Verdict**

**NOT READY.** Three MATERIAL concerns — the tree-contradicted
register-ineligibility claim with its unanalyzed literal-AST bundle path
(C1), the normative-but-nonexistent coalescing machinery propping up the
burst-cost bound while absent from the remaining-work enumeration (C2),
and the concealed `authorityIndependent` validator/codegen change with
its unswept `publicInline` surface (C3) — all sit on load-bearing
composition claims in a Spec whose bar is exhausted pre-empirical
analysis. All are locally fixable in text without touching the
architecture, which is sound: the admission-path decision is right and
fully code-verified, the five 0119 blockers are genuinely addressed, the
0073 pin is preserved verbatim on exactly the pinned functions with an
honestly deferred amendment, the first-page-only cursor proposal
composes, the auth composition holds on every admitted path, the
capability-id discipline is exemplary, and nothing weakens an evidence
boundary (ER-2 clean; claim posture nothing-until-acceptance
throughout).

7. **Recommended next step**

Apply C1–C3 in one revision (close or admit-and-analyze the literal-AST
register path and restate §Client composition on tree-true grounds;
either own the coalescing executor as enumerated work or demote it to
permitted behavior with an honest burst bound and a rescoped acceptance
case 5; add the `authorityIndependent` validator/codegen seam to the
change inventory with the keyed-surface sweep), fold C4–C8 as targeted
edits to §Acceptance, §Authorization composition, §Budgets, and §Wire,
and the details as one-liners. Then re-review as a delta on §Summary,
§Admission path, §Invalidation and delivery, §Authorization composition,
§Budgets, §Client composition, and §Acceptance. No empirical work gates
the revision; under LLP 0130 SD-4 the document cannot converge to
standing acceptance while any MATERIAL concern is unresolved, so round 2
should follow the fix commit.
