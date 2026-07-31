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

## Round 2 — 2026-07-31

**Reviewer family:** Claude Fable
**Provider / runtime:** Anthropic Claude Code, `claude-fable-5`, fresh
non-author subagent
**Effort:** session-inherited
**Date:** 2026-07-31
**Redacted:** no
**Method:** round-2 delta review (HEAD `afffd6e1` at review start;
target SHA-pinned). Scope: verification that each Round-1 Fable concern
(C1–C10) is resolved in v0.2, plus first-look review of v0.2's new
shape decisions (the non-auth-scoped scope-down, the
`liveSearchProtocol` negotiation and skew posture, the Appendix B
§B.1/§B.2 amendment routing) as new text. Blind to the codex artifact;
no re-litigation of Round-1-settled text. Re-verified against the tree:
`packages/snapback-codegen/index.mjs` (4074–4082 `assertLiteral`,
4114–4126 `registerGroupEligible`), `src/local.rs` (6680–6709 routes
validation, 7692–7796 subscribe admission incl. the auth-scoped
predicate at 7725–7726 and protocol gates 7727–7777, 13275–13410
`notify_live_subscriptions_in_frame`, 13422/13465 lane fork,
12518–12577 `deliver_authorization_snapshot` obligation raise,
13863–13990 `fail_subscription_fanout` public resync path, 7145–7177
register-child namespace matrix), `src/manifest.rs` (1636–1652
`validate_authority_independent`, 1684–1700 `validate_public_inline`,
1717–1745 `rqs_eligible_digest_kind`, 2353/2414 retention interplay,
3219–3221 `is_protected_query`, 5147–5158 `QueryOutput.cursor`),
`src/live_wire.rs` (47–119 `LiveEnvelope` — no `deny_unknown_fields`;
136–143 `AuthorizationInvalidationSnapshot` — closed, no cursor slot),
`src/server.rs` (4270–4302 `OpenConnectionRequest` offer matrix,
8535–8567 `session_live_protocol_refusal`), and
`diaries/0037-pantry-search-main-rerun.diary.md` (recipes index
declares no owner — public-read).
**Target:** `llp/0136-live-search.spec.md` v0.2 (717 lines)
**Target SHA-256:** `763ecb5a36811ed7104459abd95ba2956ab7bac15de9bc1e862cffc7d512ab46`
**Status:** completed

### Round-1 concern resolution

- **C1 (MATERIAL) — RESOLVED.** §Client composition now states the
  tree-true derivation exactly as the code has it ($param ineligible by
  string-typing; `assertLiteral` admits arbitrary object literals —
  verified at `index.mjs:4074–4082`, `4114–4126`, `local.rs:6680–6709`),
  honestly retracts v0.1's "no rule change" denial, and adds the
  two-sided fail-closed exclusion as seam 7: the codegen derivation
  excludes search-plan children AND the server-side routes validation
  refuses a `registerGroupEligible` route containing one, with a test
  asserting both refusals and an acceptance case 2 row ("refuses at
  build and at load"). The OQ6 register-cliff analysis obligations are
  named as deferred, not silently reachable. The Round-1 open question
  about `routeLiteralMatches` is mooted — the explicit exclusion no
  longer leans on it.
- **C2 (MATERIAL) — RESOLVED** (Round 1's option (b), taken cleanly and
  further than asked). Coalescing is dropped from v1 entirely: the
  delivery-cadence decision pins the shipped synchronous in-frame
  engine by name (`notify_live_subscriptions_in_frame` — re-verified:
  synchronous loop, no in-flight state, no dirty flag; search plans get
  `delta_plan: None` at `local.rs:13344–13352` and ride the replace
  lane), restates per-commit cost as exactly commit rate × affected
  subscriptions, and rests the bound on admission ceilings rather than
  an executor-throughput claim. The bound is genuine on this engine:
  the table-granular matcher wakes at most the admitted live-search
  subscriptions on the table, the per-table aggregate ceiling caps that
  count at admission, and each re-execution is capped by the
  declaration's work ceiling — so worst-case per-commit work ≤
  aggregate ceiling × per-wake ceiling, by admission, with no
  scheduling assumption. Acceptance case 5 is now non-vacuous on the
  shipped engine: per-subscription deliveries monotone in commit order,
  quiescence-head reflection after a burst, the two-index wake, and the
  aggregate ceiling at admission are all falsifiable today. The
  coalescing executor is named as successor machinery with its
  correctness obligations enumerated, and the Summary's remaining-work
  enumeration no longer implies it. Residual wording tension → new
  concern N2.
- **C3 (MATERIAL) — RESOLVED (core); residual → N1.** Seam 6 now owns
  the `authorityIndependent` validator/codegen extension as a numbered
  change with the fail-closed interim named (re-verified: only plain
  `Query` runtimes eligible, `manifest.rs:1646–1652`); `publicInline`
  is foreclosed with a load refusal and an acceptance case 2 row
  (re-verified: `validate_public_inline` accepts it on any valid
  `authorityIndependent` declaration, `manifest.rs:1684–1687`); the
  RQS nonclaim's survival through the independent plan-shape gate is
  correctly claimed (re-verified at `manifest.rs:1733`). The sweep's
  *completeness claim* overstates — see N1.
- **C4 (SHOULD-FIX) — RESOLVED.** Case 1 scopes byte-for-byte to
  rows/rank/highlights/stored fields and compares the cursor by LLP
  0073's semantic oracle (decode class, decoded plaintext, encoded
  length — "never by ciphertext bytes").
- **C5 (SHOULD-FIX) — RESOLVED.** §Noninterference and case 4 now
  carry the identical semantic-transcript list (wake occurrence;
  delivery occurrence, count, and order; delivered rows; cursor
  plaintext and encoded length; termination codes) with an explicit
  not-a-timing-claim disclaimer citing 0073's prohibition.
- **C6 (SHOULD-FIX) — RESOLVED.** The `changed_fields` narrowing is
  excluded from the v1 claim; if later claimed it carries its own
  acceptance case, a noninterference rerun over wake occurrence, and
  the named LLP 0008 L4-style convergence assertion (every skip verdict
  checked against full re-execution in test/dev). The claim is
  tightened to the observable ("cannot alter the delivered page or any
  released fact"), and the disjointness set is closed over future
  declaration extensions — absorbing Round 1's open question 3.
- **C7 (SHOULD-FIX) — RESOLVED.** Carriers pinned:
  `LiveFullTextSearchFactsV1` as a new closed sibling beside the
  closed `FullTextSearchFactsV1`; ceilings as a new closed optional
  member of the `SearchIndexManifestV1` limits family with the
  compatibility rule stated (absent ⇒ defaults; unknown ⇒ existing
  refusal class; declaring the live operation requires the capability,
  so older targets refuse at app load rather than dropping ceilings).
- **C8 (SHOULD-FIX) — RESOLVED.** The cursor member routes as a dated
  LLP 0091 §0B amendment drafted in Appendix B §B.1, landing with the
  regenerated wire schema exports, the JS kit pin under LLP 0051's
  drift gates, and LLP 0093's regenerated fixture corpus (including an
  old-decoder tolerance fixture), with LLP 0094–0096 absorbing the
  member. Old-decoder tolerance is re-proven where pinned, and the
  wire-tolerance/semantic-ignorability distinction is drawn exactly
  right ("LiveEnvelope refuses nothing" — verified: no
  `deny_unknown_fields` on the enum, `live_wire.rs:47–48`).
- **C9 (DETAIL) — RESOLVED.** "Never asked to outlive its TTL *while
  deliveries continue*," with the quiet-index aging case folded into
  the same coded-restart sentence.
- **C10 (DETAIL) — RESOLVED.** Custody stated as a one-clause revision
  of LLP 0127: this Spec owns the live claim boundary and the id; LLP
  0073 owns the shared rank/highlight/cursor contract.
- **Round-1 suggestions:** all four absorbed (establishment/matcher
  no-new-window clause; `limit: 1..50` bound at subscribe; synchronous
  unsubscribe release ahead of same-frame admission; aggregate ×
  per-wake worst-case arithmetic in the measurement gates).

### New-text review (v0.2 shape decisions)

**The non-auth-scoped scope-down composes with LLP 0053, verified by
construction.** The lane fork branches on `subscription.authorization`
(`local.rs:13422/13465`); obligations are raised only inside the
auth-scoped branches (`deliver_authorization_snapshot` requires
`authorization` and raises with `InvalidationDisposition::Quarantine`,
`local.rs:12527–12553`; the failure path's obligation raise is likewise
gated, `local.rs:13911–13944`); and admission sets `authorization` only
when the subscription is auth-scoped (sessions ∧ ¬authority-independent,
`local.rs:7725–7780`). With the v1 admission refusal in place, no
live-search subscription can reach any obligation path — the Spec's
"none is ever auth-scoped ⇒ no quarantine obligation in v1" is true by
construction, and "every delivery rides `live_replace`" is enforced
rather than aspirational. The rationale is tree-true:
`AuthorizationInvalidationSnapshot` is a closed `deny_unknown_fields`
shape carrying exactly subscription/function/version/rows with no
cursor slot (`live_wire.rs:136–143`), so the cursor extension is
genuinely versioned successor wire work. The v1 public failure path
also verifies (`ResyncRequired { reason, clear_retained: true }` plus
the diagnostics ring, `local.rs:13975–13989`; reason strings, not
structured diagnostics). And the demand signal stays served: Diary
0037's recipes index declares no owner — public-read — so Pantry's
type-ahead is fully inside the v1 scope, and check 6 is untouched.

**The `liveSearchProtocol` negotiation stands on a real precedent and
the skew posture is fail-closed as claimed, with two loose edges (N3,
N4).** The open-time offer matrix exists exactly as the design assumes
(`OpenConnectionRequest`'s offer fields, LLP 0094 §0C.5's
known-binds/unknown-refuses/absent-legacy matrix,
`server.rs:4270–4302`). Old client → new target refuses at subscribe
with `SNAPBACK_SEARCH_LIVE_CLIENT_UNSUPPORTED`; new client → old
target is prevented at the app-load capability gate (§Capability id) —
though the mechanism gloss in §Wire is imprecise (see N4).

**Appendix B routing is sound.** §B.1 is a well-formed dated-amendment
draft that correctly separates wire tolerance from semantic
ignorability and names the gate that makes the member safe; §B.2 binds
the successor to the obligation-preserving refresh-failure semantics,
atomic adoption, rotation/clearing acceptance, and its own fixtures —
the right shape for deferred protocol work. One wording edge in B.1 →
N5.

### New concerns

**N1. SHOULD-FIX — seam 6's keyed-surface sweep claims completeness
the tree contradicts; the misses are fail-safe but unswept.** "Sweeping
every surface keyed on a valid `authorityIndependent` declaration"
enumerates two (RQS, `publicInline`); the tree has at least three
more: `is_protected_query` (`manifest.rs:3219–3221` — under the
extension a public-read live search exits the default-deny protected
execution profile, the same treatment plain authority-independent live
queries get; benign by symmetry, but a behavior change the sweep should
say out loud), the register-child authorization-namespace matrix
(`local.rs:7164–7177` — unreachable for search children by seam 7's
exclusion, worth one clause saying so), and the sessions-mode live
protocol gate `session_live_protocol_refusal` (`server.rs:8535–8567` —
fail-closed, and the source of N3's precedence wrinkle). The
retention-validation interplay (`manifest.rs:2353/2414`) is mooted:
search runtimes refuse retention through the plan-shape let-else
regardless of the flag. Resolution: extend the sweep with these rows
(one sentence each) or restate it as covering the claim-relevant
surfaces rather than "every surface."

**N2. SHOULD-FIX — "Nothing in v1's contract forbids it" contradicts
acceptance case 5.** Case 5 pins per-commit delivery ("no wake is lost
(every affected commit produces its delivery)", deliveries monotone in
commit order) — a coalescing target would fail v1 acceptance, so v1's
claim boundary *does* forbid coalescing for claiming targets; the
delivery-cadence paragraph says the opposite in one sentence. The
structure already points the right way (the successor arrives "with its
own spec text and acceptance"). Resolution: one sentence — either "v1's
acceptance pins per-commit delivery; a coalescing target claims under
the successor's amended acceptance," or drop case 5's per-commit
clauses to the quiescence form the paragraph itself calls the
falsifiable one.

**N3. SHOULD-FIX — the sessions-mode refusal's precedence against the
existing auth-invalidation gates is unpinned, and case 2 asserts it
unconditionally.** On a sessions-mode target *without* the invalidation
protocol installed, the current order fires the server-layer gate
(`session_live_protocol_refusal`, `server.rs:8535`) and then
`SNAPBACK_AUTH_INVALIDATION_UNAVAILABLE` (`local.rs:7727–7733`) before
any new guard placed with the auth-scoped admission block — so case 2's
unconditional `SNAPBACK_SEARCH_LIVE_AUTH_SCOPED_UNSUPPORTED` row would
observe a different code on such a target, which is exactly why case 4
conditions its rerun on "a target with the invalidation protocol
installed" while case 2 does not. Resolution: pin the ordering — the
search-scope refusal fires ahead of the generic auth-invalidation
gates at every layer (the right diagnostic: telling the client to
negotiate a protocol that cannot help it is misleading) — or condition
case 2's row the way case 4 already is.

**N4. SHOULD-FIX — the `liveSearchProtocol` offer field has no
amendment routing of its own, and the old-target refusal gloss names
the wrong surface.** Appendix B §B.1 routes the cursor member fully;
the connection-open offer field — a distinct wire surface on
`OpenConnectionRequest`, owned by the LLP 0093/0094 client-protocol
corpus — gets no routing: which document's §0C.5 offer matrix gains
the row, the unknown-value-at-open semantics (known binds / unknown
refuses / absent legacy), the open-frame schema export, and the
generated-client emission. Relatedly, §Wire's "a new client against an
old target refuses on the missing capability" is imprecise: the
served-pairing prevention is the app-load unknown-capability refusal,
and a stale server *binary* receiving the new offer member refuses the
whole connection open via `OpenConnectionRequest`'s
`deny_unknown_fields` (`server.rs:4271`) — coarser than a
capability-scoped refusal, house-consistent with the must-understand
offer posture, but worth stating as the actual mechanism. Resolution:
add the offer field's routing clause beside §B.1 and name both
old-target refusal surfaces.

**N5. DETAIL — §B.1's "when a safe continuation exists" leaves cursor
absence ambiguous.** The client derives `hasMore = cursor != null`, so
an absent cursor asserts "terminal page"; any other reason for absence
(e.g. a mint failure) would silently lie. `QueryOutput.cursor`'s own
contract is the model ("present exactly when…", `manifest.rs:5151–5155`).
Resolution: pin absence to mean exactly "no continuation," and route
mint failure to the failed-wake path, never a cursor-less delivery.

**N6. DETAIL — the per-commit arithmetic is stated for single-table
commits.** A commit touching k indexed tables re-runs the union of
those tables' live-search subscriptions; the worst case is the sum of
the touched tables' aggregate ceilings — still hard-bounded by
admission. One clause in §Budgets closes it.

### Verdict

**READY.** All ten Round-1 concerns are resolved — the three MATERIALs
by exactly the demanded shape (tree-true restatement plus a two-sided
fail-closed exclusion; coalescing dropped with an honest
admission-bounded burst arithmetic and a non-vacuous case 5; the
validator seam enumerated with the `publicInline` foreclosure) — and
every load-bearing claim in the new v0.2 text verifies against the
tree, including the scope-down's by-construction unreachability of
every obligation path and the closed-snapshot rationale that motivates
it. The six new concerns are SHOULD-FIX/DETAIL wording and routing
edges, none touching the architecture, the claim boundary's substance,
or safety; none meets the MATERIAL bar. Under LLP 0130 SD-4 nothing
blocks convergence from this family's side.

### Recommended next step

Fold N1–N4 as targeted edits (a three-row sweep extension in seam 6;
one reconciling sentence between §Invalidation's cadence paragraph and
case 5; the refusal-precedence pin or case-2 conditioning; the offer
field's routing clause plus the two-surface skew gloss) and N5–N6 as
one-liners. No re-review round is needed for these — an author-side
spot check of seam 6, §Wire, and acceptance cases 2/5 suffices before
the author decides acceptance.
