# LLP 0230 + 0231 — gpt-5 family review

**Reviewer family:** gpt-5
**Provider / runtime:** local `codex exec -m gpt-5.6-sol -c model_reasoning_effort=xhigh --sandbox read-only`
**Date:** 2026-08-11
**Round:** 1
**Redacted:** no
**Method:** local CLI process, fresh (no prior session context)
**Cluster:** lockstep; 0231 primary, 0230 secondary
**Bound to revisions:**
- 0231 `sha256 1ce122fb4448f46b4c2afd5c787672d632c551396ac6b9eff07ed8d57f0b4c64`
- 0230 `sha256 2b910b243d1f6ba73deecdc57c58ec299702a5f5a6301e3635dc56e836ea64a8`

Blindness: instruction-based, self-attested; the reviewer confirmed compliance
in its first line. Body below is verbatim.

---

I complied with the blindness requirement. I read both targets in full and did not read `llp/reviews/0230-*`, `llp/reviews/0231-*`, or any run journal.

## MATERIAL findings

1. **0231 defers the actual decision it purports to make.** It explicitly calls D1 versus A1 “the real decision” and leaves the visibility grammar—the central feasibility constraint—open ([0231:315](/Users/ridley/projects/snapback/llp/0231-entity-and-permissioning-recommendation.rfc.md:315)). That disclosure is honest, but advancing the RFC for acceptance without resolving it would dodge the decision. “Fail-closed versus reviewable” is also a false tradeoff: both a missing per-query declaration that fails generation and a missing table policy that denies access are fail-closed, while codegen can project an effective table policy beside every query. LLP 0011 already says effective permission composes table visibility rules with query filters and function checks ([0011:203](/Users/ridley/projects/snapback/llp/0011-auth-and-permissions.rfc.md:203)) and rejects absent-rule default allow ([0011:517](/Users/ridley/projects/snapback/llp/0011-auth-and-permissions.rfc.md:517)). My judgment is that A1—or a hybrid with mandatory table defaults, per-query refinements, and a separately governed privileged override—is the stronger base. The card-game evidence itself points toward a policy on `hands`, not repeated owner predicates on every query.

2. **D3 fails immediately on a real workload that 0231 cites as supporting evidence.** Pointing Room’s security boundary is cross-table, disjunctive, and field-level: it reads `rounds` and `votes`, then reveals a vote value when the round is revealed **or** the caller owns the vote ([functions.mjs:37](/Users/ridley/projects/snapback/demos/pointing-room/snapback/functions.mjs:37), [functions.mjs:47](/Users/ridley/projects/snapback/demos/pointing-room/snapback/functions.mjs:47), [functions.mjs:70](/Users/ridley/projects/snapback/demos/pointing-room/snapback/functions.mjs:70)). A row predicate cannot represent that cell-level masking. Under D2/D3 it must either declare `public()`—leaving the handler as the real security boundary—or be refused. Current HostPlan filters are a conjunction ([live_matcher.rs:415](/Users/ridley/projects/snapback/src/live_matcher.rs:415)); membership references admit only an argument, row field, or app singleton, not computed relationships or third-table joins ([0056:1083](/Users/ridley/projects/snapback/llp/0056-scoped-roles-and-memberships.rfc.md:1083)). Real apps therefore hit the cap immediately, not eventually. The RFC needs a plan-class and output-provenance model covering stored rows, joins, projections, aggregates, and field redaction—or an honestly narrower scope.

3. **The proposal does not survive the write side or even all data-returning function surfaces.** D2 covers “every query,” but mutations and actions can read protected data and return or copy it into a broader surface. It also leaves integrity authorization—insert, old-row update/delete, and post-update checks—untouched ([0231:206](/Users/ridley/projects/snapback/llp/0231-entity-and-permissioning-recommendation.rfc.md:206), [0231:323](/Users/ridley/projects/snapback/llp/0231-entity-and-permissioning-recommendation.rfc.md:323)). LLP 0011 requires two-sided write enforcement ([0011:190](/Users/ridley/projects/snapback/llp/0011-auth-and-permissions.rfc.md:190)), and LLP 0056 says the full two-sided contract belongs with declarative rules ([0056:171](/Users/ridley/projects/snapback/llp/0056-scoped-roles-and-memberships.rfc.md:171)). PostgreSQL’s table policies likewise share one locus across visibility and modification checks ([PostgreSQL RLS documentation](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)). A separate write RFC is acceptable, but 0231 must first decide whether reads and writes share the policy IR and locus. Otherwise the read decision may force two incompatible policy systems. This is a defective architectural decision, not a demand for implementation syntax.

4. **D4’s exact-invalidation claim contradicts the existing substrate.** The acceptance criterion requires a membership change to invalidate “exactly” dependent subscriptions and no others ([0231:341](/Users/ridley/projects/snapback/llp/0231-entity-and-permissioning-recommendation.rfc.md:341)). LLP 0056 says membership queries currently use conservative re-query/`live_replace`, not an incremental semi-join ([0056:1025](/Users/ridley/projects/snapback/llp/0056-scoped-roles-and-memberships.rfc.md:1025)). LLP 0053 says v1 still uses the global epoch and subject-scoped suppression is computed but not used ([0053:1672](/Users/ridley/projects/snapback/llp/0053-authorization-invalidation.rfc.md:1672)). Existing machinery provides revocation correctness, not exact blast radius. The safety acceptance should require no false-negative invalidation and allow conservative extra wakes; exact suppression must either be specified and proved or remain an optimization.

5. **The census supporting D2 is materially wrong.** At the cited snapshot, the relevant demo files are unchanged from the reviewed source:

   - There are 96 syntactic `define*Query(...)` call sites. Three `*KeysetPages` call sites produce six additional exported queries, for 102 query operations. Thus “~90” is loose but recognizable.
   - There are 8 ordinary query specs carrying `membership:` plus one membership-pages declaration that produces 2 queries: 10 resulting membership-gated queries. The reported 9 is merely the count of textual `membership:` properties and is mislabeled as query definitions.
   - `31` is the raw textual count of `authUserId()` across 13 demos—including writes and comments. There are 12 source-level uses in query `filter:` lists across 8 demos, or 16 generated HostPlan uses after owned-page expansion. Examples include [card-game:42](/Users/ridley/projects/snapback/demos/card-game/snapback/functions.mjs:42), [team-chat:24](/Users/ridley/projects/snapback/demos/team-chat/snapback/functions.mjs:24), [todo-v2:27](/Users/ridley/projects/snapback/demos/todo-v2/snapback/functions.mjs:27), and [dispatch-board:11](/Users/ridley/projects/snapback/demos/dispatch-board/snapback/functions.mjs:11). The claimed 31/9 “3–4×” ratio is therefore invalid; comparable generated-operation counts are 16/10.
   - The five named counter-evidence demos contain 14 queries, not 20: all-aboard 6, public-dashboard 3, chat-matrix 2, latency-kanban 2, pulse-monitor 1 ([all-aboard:66](/Users/ridley/projects/snapback/demos/all-aboard/snapback/functions.mjs:66), [public-dashboard:19](/Users/ridley/projects/snapback/demos/public-dashboard/snapback/functions.mjs:19), [chat-matrix:37](/Users/ridley/projects/snapback/demos/chat-matrix/snapback/functions.mjs:37), [latency-kanban:26](/Users/ridley/projects/snapback/demos/latency-kanban/snapback/functions.mjs:26), [pulse-monitor:13](/Users/ridley/projects/snapback/demos/pulse-monitor/snapback/functions.mjs:13)).
   - The conclusion that the other four-fifths have a real scoping story does not follow. For example, Partiful Matrix has four unscoped read queries while its `authUserId()` uses occur in writes ([partiful-matrix:13](/Users/ridley/projects/snapback/demos/partiful-matrix/snapback/functions.mjs:13)).

   D2 may still be defensible as a principle, but “the card-game pattern is dominant” has not been established.

6. **Several authority claims are overstated or out of context.**

   - The card-game leak claim is accurate: deleting the owner predicate returns both principals’ cards for the same game, as the fixture installs both hands and asserts disjoint results ([authority-scope.mjs:212](/Users/ridley/projects/snapback/demos/card-game/tests/acceptance/authority-scope.mjs:212)). But the predicates are not indistinguishable in the manifest: one is explicitly `AuthUserId`, the other `Arg: gameId` ([functions.manifest.json:260](/Users/ridley/projects/snapback/demos/card-game/snapback/generated/functions.manifest.json:260)). The manifest distinguishes mechanism; it does not distinguish authorial obligation. That narrower claim supports mandatory intent, not necessarily a new predicate slot.
   - LLP 0170 accurately says `authScopeField` is not authorization and that the handler must enforce the caller filter ([0170:10](/Users/ridley/projects/snapback/llp/0170-authorization-obligation-feasibility.research.md:10)). It also says future enforcement must be plan-class-specific and that general JavaScript lacks result provenance ([0170:80](/Users/ridley/projects/snapback/llp/0170-authorization-obligation-feasibility.research.md:80), [0170:96](/Users/ridley/projects/snapback/llp/0170-authorization-obligation-feasibility.research.md:96)). 0231 adopts the first fact while bypassing the second.
   - LLP 0172 does say `authenticated` does not scope returned rows ([0172:19](/Users/ridley/projects/snapback/llp/0172-explicit-function-authorization.rfc.md:19)). It does **not** establish a completed two-phase precedent: it proposes the error phase ([0172:89](/Users/ridley/projects/snapback/llp/0172-explicit-function-authorization.rfc.md:89)), and the implementation presently emits only a warning ([index.mjs:2778](/Users/ridley/projects/snapback/packages/snapback-codegen/index.mjs:2778)). “As 0172 ran them” is false.
   - The LLP 0011 quotation is not exact. The source continues “pushdown as needed in 2024 and had not verifiably shipped it by mid-2026” ([0011:462](/Users/ridley/projects/snapback/llp/0011-auth-and-permissions.rfc.md:462)). It reports an undesirable implementation shape and missing optimization, not an observed failure. More importantly, LLP 0011’s recorded fallback is online-only/non-syncable execution ([0011:456](/Users/ridley/projects/snapback/llp/0011-auth-and-permissions.rfc.md:456)); D3 instead refuses generation. Citing 0011 as direct authority for D3 is incorrect unless 0231 explicitly supersedes that choice.

7. **0230 is not yet adequate prior art for the decision it supports.** Its opening claim that Snapback “does not scope returned rows” is false as written; Snapback does scope rows through HostPlan filters and membership predicates—the gap is that such scoping is not universally mandatory ([0230:12](/Users/ridley/projects/snapback/llp/0230-data-layer-authorization-prior-art.research.md:12)). Its structural-mismatch thesis also says only Zero and IVM engage authorization lifetime, while its own InstantDB evidence says policy is evaluated during live invalidation ([0230:30](/Users/ridley/projects/snapback/llp/0230-data-layer-authorization-prior-art.research.md:30), [0230:65](/Users/ridley/projects/snapback/llp/0230-data-layer-authorization-prior-art.research.md:65)).

   The Zero treatment omits the facts most relevant to D1/A1: the surveyed RLS API was table-scoped, deny-by-default, applied automatically to every read and write, and stored its policy in a live-replicated table; it is also now explicitly deprecated ([official Zero RLS documentation](https://zero.rocicorp.dev/docs/deprecated/rls-permissions), [Zero 0.15 live-permission notes](https://zero.rocicorp.dev/docs/release-notes/0.15)). Those facts bear directly on the unresolved table/query locus, expressiveness, invalidation, and write policy.

   Blockaid is described correctly in 0230 as runtime SQL interception, but 0231 turns it into generate-time proof with zero authoring burden. The paper instead expects application access checks, verifies each runtime SQL query in request-trace context, and caches generalized decisions ([Blockaid paper](https://www.usenix.net/system/files/osdi22-zhang.pdf)). A4 therefore is not the Blockaid alternative. Finally, “we already have a zookie” ([0230:132](/Users/ridley/projects/snapback/llp/0230-data-layer-authorization-prior-art.research.md:132)) is too strong when the document later asks whether the commit version is usable as one ([0230:264](/Users/ridley/projects/snapback/llp/0230-data-layer-authorization-prior-art.research.md:264)); it is a promising correspondence hypothesis, not a verified primitive.

## DETAIL findings

- The requested codegen check passes: `memberOf()`/`hasRole()` are genuinely declaration-bound and `hasRole()` validates the declared role vocabulary ([define.mjs:1202](/Users/ridley/projects/snapback/packages/snapback-codegen/define.mjs:1202), [define.mjs:1263](/Users/ridley/projects/snapback/packages/snapback-codegen/define.mjs:1263)). `spec.membership` is genuinely optional and, when present, must be an array of those predicates ([define.mjs:2326](/Users/ridley/projects/snapback/packages/snapback-codegen/define.mjs:2326)).
- 0230’s internal corpus-coverage counts reproduce when matching exact topic names and excluding 0230/0231.
- Siren assessment: S3’s automatic foreign-key inference is genuinely a trap, but it must not be conflated with explicit table policy. S2 correctly rejects partitioning as an independent source of authority, but policy-derived partitioning is a valid enforcement/optimization layer and offline revocation is a limitation of all plaintext sync. S1 is only a trap when it means arbitrary runtime-only predicates; a closed, compiled policy language is exactly what 0231 proposes. S4 correctly identifies per-row encryption as a poor architectural fit, but capability tokens do not inherently require ciphertext or re-keying and should not be bundled into the same dismissal.
- Both documents have `Status: Review` in metadata but end with “Draft” ([0231:348](/Users/ridley/projects/snapback/llp/0231-entity-and-permissioning-recommendation.rfc.md:348), [0230:281](/Users/ridley/projects/snapback/llp/0230-data-layer-authorization-prior-art.research.md:281)).
- LLP 0173 is still a proposed projection, not existing implemented machinery ([0173:41](/Users/ridley/projects/snapback/llp/0173-authorization-review-projection.rfc.md:41)).
- Exact diagnostic wording, source-span behavior, whether migration is mechanically lifted, and the concrete `asUser` API are implementation-phase details. They should not block the decision once policy locus, supported plan classes, write composition, and invalidation semantics are settled.

## Verdict: 0231 — NOT READY
## Verdict: 0230 — NOT READY
## Verdict: SET — NOT READY

---

## Round 2 — 2026-08-10/11

**Reviewer family:** gpt-5
**Provider / runtime:** local `codex exec --ignore-user-config -m gpt-5.6-sol -c model_reasoning_effort=xhigh --sandbox read-only`, fresh process, no prior session context
**Round:** 2
**Redacted:** no
**Cluster:** lockstep; 0231 primary, 0230 secondary (0230's single author-scoped sanity round)
**Bound to revisions:**
- 0231 `sha256 6330152a1935f35a8ac64b913cce07e93d059338c868478dc2754d3f879b1978`
- 0230 `sha256 f74b0723d06c2158dc9dce52d2292f89c356b1e46f035482b1b829588400c296`

Blindness: instruction-based, self-attested; compliance confirmed in the reviewer's first line. Round-1 findings were not disclosed to this reviewer. Body below is verbatim.

---

Blindness compliance: I did not read any `llp/reviews/0230-*` or `llp/reviews/0231-*` file, and I did not read any super-refine run journal.

Review binding: 0231 `6330152a1935f35a8ac64b913cce07e93d059338c868478dc2754d3f879b1978`; 0230 `f74b0723d06c2158dc9dce52d2292f89c356b1e46f035482b1b829588400c296`.

## MATERIAL findings

1. **0231 — Class J contradicts the unbypassable table-policy locus and substitutes testing for enforcement.** D1 and D6 say every read automatically composes the table policy. D3 instead says a class-J handler enforces its own boundary, with `visibility: handler(...)` and an identity-switching test as “the only enforcement their declaration gets.” These cannot both describe the same data-access path. If `ctx.db` returns policy-filtered and field-masked data, class J cannot bypass table visibility and its remaining problem is output/egress information flow, which needs a different contract. If it receives raw data, `handler(...)` is a self-authorized waiver of D1. A finite acceptance test is evidence, not production enforcement or proof over arbitrary data and branches. This is not a rare escape hatch: 20 of the 96 direct query call sites in the bound census revision are JavaScript queries. The separately governed override is likewise left as open question 6, despite LLP 0170 making waiver authority a prerequisite. The RFC needs a fundamental decomposition: policy-aware reads plus a distinct egress contract, or an explicitly governed exception system with authority, scope, baseline/ratchet, and expiry semantics.

2. **0231 — Class M does not yet define a safe field-authorization class.** Nulling a field at final projection prevents direct release of its value, but does not prevent the hidden value from influencing row presence, ordering, joins, aggregates, counts, or another computed output. A new query can therefore disclose facts about a masked field without selecting it—the same omitted-boundary failure the RFC is intended to prevent. D2 also makes row-policy intent mandatory only at table granularity: adding a sensitive field to a public or broadly visible table silently inherits disclosure unless the field-policy structure has an exhaustive or fail-closed default. Finally, a disclosed→masked transition is a security-negative field update. LLP 0053’s proved add/update path is best-effort, whereas durable obligations are attached to removals and conservative `live_replace`; the RFC neither forces Class M through `live_replace` nor extends the obligation classifier to redactions. Pointing-room proves only the monotonic masked→revealed direction. Before Class M is accepted, the design must pin operator-level noninterference/restrictions, field-addition defaults, and obligation-backed re-masking—or split field authorization into a sibling RFC and keep this one row-only.

3. **0231/0230 — S1 rejects Rego and CEL on a false equivalence between source-language openness and runtime post-evaluation.** OPA has a first-party Compile API and a defined data-filtering fragment that partially evaluates Rego into SQL predicates, refusing unsupported constructs rather than requiring per-row runtime evaluation ([OPA SQL filtering](https://www.openpolicyagent.org/docs/filtering/tutorial-sql-filtering), [supported fragment](https://www.openpolicyagent.org/docs/filtering/fragment)). CEL similarly exposes checked ASTs, host-defined environments, validators, and partial evaluation ([CEL overview](https://cel.dev/overview/cel-overview)). Neither fact proves Snapback should adopt those languages, but it disproves “Rego/CEL implies post-query evaluation.” The relevant decision is whether a language has a closed, statically admissible pushdown fragment—the exact model this RFC wants. Since 0231 leaves the grammar open, it should evaluate these existing compilation approaches before declaring the family a siren. 0230 identifies OPA as a corpus gap but never actually surveys it.

4. **0230 — Hasura is a major missing direct comparator, making the survey’s central landscape claim incomplete.** Hasura has long shipped model/table-scoped row and column authorization, relationship predicates and session variables, compiles those rules into SQL, and applies them to live and streaming GraphQL subscriptions ([Hasura’s authorization and streaming architecture](https://hasura.io/blog/instant-streaming-api-built-in-authorization-new-existing-postgres)). That is substantially closer to 0231’s proposed table locus, field surface, relationship composition, and durable live-query execution than most systems in Tiers 2–4. It may still have limitations around policy-metadata activation, offline retention, conditional cell masking, and revocation delivery, but those are precisely the questions the survey claims only Zero/IVM/Instant engage structurally. The research and recommendation should study Hasura before treating Zero’s deprecated RLS API as the strongest shipped table-locus precedent.

5. **0230/0231 — Policy-fact changes and policy-program changes are conflated.** The Noria/DBSP section says composing policy into a query makes a policy change and data change “the same kind of event.” That is true only when the changing permission fact—membership, role, reveal bit—is modeled as an input row. Changing the policy expression itself changes the dataflow/query program and requires control-plane activation, plan replacement, and reauthorization; it is not an ordinary input delta. LLP 0053 already records authorization-metadata activation as a distinct event for this reason. D4 and its acceptance criteria mention membership/reveal changes but do not explicitly bind policy activation to that existing fail-closed event and fresh-result path. The survey must narrow the IVM claim, and the RFC must cover both data-backed policy dependencies and policy-program activation.

## DETAIL findings

1. **0231 census recount:** the principal counts at `5373238eb` are correct. I found 96 direct `define*Query` call sites; three `*KeysetPages` declarations generate six additional operations, yielding 102. Eight direct membership-bearing queries plus one membership-pages declaration yield 9 textual declarations and 10 generated operations. Twelve direct query-filter uses of `authUserId()` plus two owned-pages declarations yield 16 generated uses. Those generated membership and caller-filter sets are disjoint, so the exact “neither declared mechanism” number is **76 of 102**, rather than “roughly 75.” The five named no-authorization demos total 14 queries as stated.

2. **0230 Zero needs a current/legacy split.** Zero 0.25 removed the first-class RLS permission system; current authorization is expressed in authenticated named-query definitions, while the table-scoped RLS API is deprecated ([Zero 0.25](https://zero.rocicorp.dev/docs/release-notes/0.25), [current authentication and permission patterns](https://zero.rocicorp.dev/docs/auth)). Current Zero also documents query re-transformation on reconnect/token refresh and a configurable interval for out-of-band role or membership changes ([zero-cache auth re-transformation](https://zero.rocicorp.dev/docs/zero-cache-config)). Open question 2 is therefore partly answerable now and should distinguish relational permission-data changes, auth-context changes, policy-code deployment, and the deprecated live-replicated policy-table mechanism.

3. **0230 Zanzibar confidence is internally inconsistent.** The paper description merits high confidence; the claim that Snapback’s per-app commit version is a viable zookie does not. The body correctly labels it a candidate and leaves jurisdictional/multi-object ordering open, while the confidence sentence says “high” on the correspondence. Split this into high confidence on Zanzibar and low/medium confidence on the Snapback mapping.

4. **0230 is missing a recent provenance/egress result relevant to Class M and D6.** The June 2026 Data Flow Control/Passant paper specifies tuple-level flow policies and query rewriting without materializing provenance ([Data Flow Control](https://arxiv.org/abs/2606.05679)). It is preliminary and broader than authorization, but directly addresses the hidden-field-through-derived-output problem that row predicates and final projection masks do not solve. It belongs near Blockaid or Meta PAI with an appropriately cautious confidence label.

5. **0230 overstates the Meta inference.** Meta’s public material says point checks plus lineage were inadequate for scalable purpose-limitation enforcement and motivated runtime information-flow controls; it does not specifically establish that Ent-style per-load authorization was judged insufficient ([Meta PAI/Policy Zones](https://engineering.fb.com/2024/08/27/security/privacy-aware-infrastructure-purpose-limitation-meta/)). Mark the connection to Ent as an inference rather than Meta’s own verdict.

6. Apart from the findings above, the characterizations of Blockaid, Zanzibar itself, Cedar, PostgreSQL RLS, Firebase rules, Expo Entity, and the Jeeves/Jacqueline line are directionally accurate at their stated confidence. The overall “medium-high” survey confidence is nevertheless too strong until the Hasura and OPA omissions and the current Zero behavior are reconciled.

## Verdict: 0231 — NOT READY
## Verdict: 0230 — NOT READY
## Verdict: SET — NOT READY

---

## Round 3 — 2026-08-10/11 (delta round, 0231 only)

**Reviewer family:** gpt-5
**Provider / runtime:** local `codex exec --ignore-user-config -m gpt-5.6-sol -c model_reasoning_effort=xhigh --sandbox read-only`, fresh process, no prior session context
**Round:** 3 — delta round per LLP 0010 §2 addendum; capsule enumerated the round-2 delta; concerns classified IN-DELTA vs PRE-EXISTING
**Topology:** 0231 only (0230 exited the cluster after its author-scoped single round; provided as disclosed-unreviewed context)
**Redacted:** no
**Bound to revision:** 0231 `sha256 161bab9158489422b05d046029aa0511340935f65c7fb95e408b7575816538f7`

Blindness: instruction-based, self-attested; compliance confirmed in the reviewer's first line. Prior-round findings not disclosed. Body below is verbatim.

---

Blindness compliance: I did not read any `llp/reviews/0230-*` or `llp/reviews/0231-*` file, nor any super-refine run journal.

Review bound to sha256 `161bab9158489422b05d046029aa0511340935f65c7fb95e408b7575816538f7`.

## MATERIAL findings

1. **IN-DELTA — The sole policy bypass remains ungoverned.** D1 calls overrides “separately governed,” but leaves waiver authority, expiry, and ratchet semantics open. Schema placement, justification, projection, and a breadth test make a bypass visible; they do not establish who may authorize it or prevent the same change that introduces a widening from approving itself. This directly leaves unresolved LLP 0170 §4’s prerequisite. Because overrides are the only route outside the table policy, either their authority and lifecycle must be decided here, or overrides must remain unavailable/fail generation until a sibling governance decision lands.

2. **IN-DELTA — Class M does not actually fail closed on the first sensitive field.** The field-addition fence applies only to a table “carrying any masking rule.” A table with no existing mask—including an explicitly public table—can therefore add a newly sensitive field and silently expose it through existing queries and `ctx.db` reads. That recreates the omission hazard D2 removes at table level and contradicts “disclosure-with-row must be said, not inherited silently” plus Acceptance’s claim of the full safety envelope. The fence needs to cover the transition from zero masks to differentiated field visibility, such as through explicit treatment of every new field or an equivalently closed schema classification.

No PRE-EXISTING material findings.

## DETAIL findings

1. **IN-DELTA — The census conclusion is phrased too absolutely.** “Nothing today distinguishes public by design from scoping forgotten” conflicts with the later acknowledgment that some unscoped queries explicitly declare `auth: 'public'`. That is operation-level rather than table-level intent, so it does not defeat D2, but the load-bearing sentence should say that no row/table visibility declaration distinguishes them.

2. **PRE-EXISTING — Exact effective-policy projection is impossible for opaque JS filters.** D2 promises the table policy composed with “the query’s own filters” for every query, while LLP 0170/0173 establish that JS handler filtering is opaque. The projection can soundly show the enforced table policy and declared refinements, with handler-local narrowing labeled opaque; it cannot claim to render the exact composed filter.

3. **IN-DELTA — “The policy language is built … that is the whole gap” understates the new surface.** The shipped visibility forms are strong precedents, but universal table-policy injection into `ctx.db`, class-M masking, and their invalidation semantics are new machinery. Narrowing this wording would make implementation risk and feasibility clearer without changing the recommendation.

## Verdict: 0231 — NOT READY

---

## Round 4 — 2026-08-10/11 (delta round, 0231 only)

**Reviewer family:** gpt-5
**Provider / runtime:** local `codex exec --ignore-user-config -m gpt-5.6-sol -c model_reasoning_effort=xhigh --sandbox read-only`, fresh process, no prior session context
**Round:** 4 — delta round; capsule enumerated the round-3 delta; concerns classified IN-DELTA vs PRE-EXISTING
**Redacted:** no
**Bound to revision:** 0231 `sha256 09c2a3426acbf200c7e2143fe78383d346a523c9b9bb75ec87a85e37ade254db`

Blindness: instruction-based, self-attested; compliance confirmed in the reviewer's first line. Prior-round findings not disclosed. Body below is verbatim.

---

Blindness compliance: I did not read any `llp/reviews/0230-*` or `llp/reviews/0231-*` artifact or any super-refine run journal.

The reviewed bytes match `sha256 09c2a3426acbf200c7e2143fe78383d346a523c9b9bb75ec87a85e37ade254db`.

## MATERIAL findings

None.

## DETAIL findings

1. **IN-DELTA — The census mixes call-site syntax with effective generated policy.** The 96 direct call sites and 102 generated operations re-derive, but `signal-desk`’s `defineSearchQuery` inherits mandatory `public-read` visibility from its search-index declaration even though its function call contains no `visibility:` property. Counting effective generated policies therefore yields 65, not roughly 66, operations carrying none of the three mechanisms. This does not change the “roughly two-thirds” conclusion.

   The same parenthetical says “plus one `authScopeField` site”; the pinned tree has three such query sites—two in `competitive-checkpoint` and one in `todo`, with one overlapping an `authUserId()` filter. Since `authScopeField` is correctly excluded as authorization proof, this is only an inventory correction.

2. **IN-DELTA — The override sibling should distinguish scheduled authority modes.** LLP 0070 separates `system`, `revalidatePrincipal`, and `capturedGrant`; only the first is intrinsically principal-free. The sibling should decide whether revalidated-principal reads evaluate ordinary table policy and whether captured grants are a first-class policy authority or a governed override subtype. Treating every scheduled execution as a routine waiver would weaken override-review signal, but D1’s current fail-closed blocking posture prevents this from being a safety defect in this RFC.

## Verdict: 0231 — READY
