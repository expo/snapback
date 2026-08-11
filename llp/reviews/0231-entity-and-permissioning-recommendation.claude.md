# LLP 0230 + 0231 — claude family review

## Round 2 — 2026-08-10/11

**Reviewer family:** claude
**Provider / runtime:** fresh general-purpose subagent (Anthropic), no prior
context, launched by the continuation orchestrator (Claude Fable 5 session)
**Date:** 2026-08-10 (session local; run journal dates the round 2026-08-11)
**Round:** 2 (first delivered claude-family review; both round-1 claude
launches failed and are recorded as failed in the run journal)
**Redacted:** no
**Method:** in-repo subagent; blindness instruction-based, self-attested;
compliance confirmed in the reviewer's first line
**Cluster:** lockstep; 0231 primary, 0230 secondary
**Bound to revisions:**
- 0231 `sha256 6330152a1935f35a8ac64b913cce07e93d059338c868478dc2754d3f879b1978`
- 0230 `sha256 f74b0723d06c2158dc9dce52d2292f89c356b1e46f035482b1b829588400c296`

Body below is verbatim.

---

Blindness compliance: I did not read anything under `llp/reviews/` beginning with `0230-` or `0231-`, nor any super-refine run journal. Verdicts bind to 0231 sha256 `6330152a…f879b1978` and 0230 sha256 `f74b0723…88400c296`, both verified against the working tree.

**Method.** I re-derived the full census at `5373238eb` (via `git archive` into a scratch tree, not by disturbing any worktree), read both documents in full, and checked them against: `demos/card-game`, `demos/pointing-room`, `demos/competitive-checkpoint`, `demos/team-chat`, `demos/signal-desk`, `demos/triage-graph`, `demos/fleet-observatory-move1`, `demos/partiful-matrix` and the other cited demos; `packages/snapback-codegen/define.mjs` and `index.mjs`; LLP 0011 §462, 0053, 0056, 0070/0073/0080 (visibility surfaces), 0170, 0172, 0173; diaries 0031 and 0074.

**Census re-derivation (priority check).** Every number in 0231 §census reproduces exactly under its own definitions: 96 `define*Query` call sites (58 `defineLiveQuery`, 12 `defineJsLiveQuery`, 8 `defineJsQuery`, 6 `defineBoundedChildrenQuery`, 5 `defineQuery`, 4 `defineRelationalQuery`, 2 `defineSnapshotBatchQuery`, 1 `defineSearchQuery`); +6 from three `define*KeysetPages` sites = 102 generated. Membership: 9 textual declarations, 10 generated (8 on queries + 2 from `defineMembershipKeysetPages`). `authUserId()` in query `filter:` lists: exactly 12, across exactly 8 demos (browser-local-first, card-game, competitive-checkpoint, dispatch-board 2, shindig, team-chat 2, todo-v2 3, todo), +4 generated owned pages = 16; the partiful-matrix and signal-desk `authUserId()` uses are write-side (mutation `deleteWhere`/guard), as the RFC says. The five no-auth demos count 6+3+2+2+1 = 14 of 102. The arithmetic is right. The taxonomy is not — see MATERIAL 1.

## MATERIAL findings

1. **(0231 — census taxonomy and "What already exists" omit a third, already-shipped declared-visibility mechanism; the load-bearing "silent majority" claim is wrong as stated.)** The repository already ships a declared visibility union — `{ kind: 'public-read' } | { kind: 'owner', field } | { kind: 'membership', … }`, plus `owner()` / `throughParent()` / `throughScope()` on bounded-children queries and per-side `root/joined/output` visibility on relational queries — governed by LLP 0073 (search; the `@ref LLP 0073#the-third-visibility-variant` in `packages/snapback-codegen/define.mjs:861`), LLP 0080 (relational; `catalog-lens/snapback/functions.mjs:1` cites `LLP 0080#3-visibility-and-authority`), and the keyset-pages/owned-CRUD kits. Mechanically: **11 of the 96 counted query call sites carry a `visibility` declaration** (catalog-lens `booksWithPublisher`; competitive-checkpoint `conversationsWithModel`, `listConversationCards`; fleet-observatory-move1 `latestEventsWithVehicles`, `vehicleRollupPage`; signal-desk `incidentTasks`, `incidentComments`, `incidentActivity`; triage-graph `activeIssuePage`, `transitionPage`, `retainedInbox`), across 6 demos, and the four generated owned pages carry `visibility: { kind: 'owner', … }` textually. Additionally, `defineOwnedCrud` (list/get), and `defineOwnedUniqueLookup` generate query operations that are **absent from the 102 denominator entirely**. Consequences, in decreasing order of severity:
   - The census's central corrected conclusion — "roughly 75 of 102 carry *neither* mechanism," called "the load-bearing observation for D2" — overcounts by roughly ten: by my count ~65 of 102 carry none of the **three** mechanisms. "Two scoping paths" (the section title) is factually wrong.
   - "What already exists" — the section that exists precisely to inventory the machinery and that "makes the recommendation small rather than large" — omits the strongest item in the inventory: a *shipped, mandatory-or-fail, pushdown-compiled* visibility declaration. `define.mjs:846-847` refuses generation of a search index without explicit visibility ("use `{ kind: 'public-read' }` only for intentionally public data") — which means the explicit-`public()`-or-fail precedent D2 wants is not merely 0172's unshipped warn-then-fail trajectory; it is already executed, at generate time, on the search surface. The RFC argues from its weaker precedent while not knowing it holds the stronger one.
   - Open question 2 asks whether `visibility` subsumes `authScopeField`, but the live coherence risk is different: the RFC's proposed table-level `visibility: public()` vocabulary versus the shipped `visibility: { kind: 'public-read' }` union. Unreconciled, D1/D2 create the "two overlapping concepts would be worse than either" outcome OQ2 itself warns about — with the same keyword. OQ1's grammar design should start from the shipped union (which already includes exactly the owner/membership/through-parent shapes class R needs) rather than treat the grammar as unpinned from zero.

   Direction of the recommendation survives — indeed it is strengthened (the declared, composed, generate-time-refused shape already works in production surfaces of this codebase) — but a census whose revision history is "overturned by a review recount once already" cannot advance carrying a second, structural census error plus an inventory omission that changes the precedent argument. This is a correctness-and-decision-quality defect, not a detail request.

2. **(0230 — the summary's characterization of Snapback is false as a universal.)** "…no query is obliged to use it, and the manifest cannot distinguish a security predicate from a convenience filter." Search queries fail generation without an explicit visibility declaration; relational and bounded-children queries require per-source visibility; those declarations are generation-time facts carried into the manifest (LLP 0073 pins visibility into the search profile identity; 0080 relational manifests carry per-side visibility). The true statement is that the *plain filter-list* surfaces (`defineLiveQuery`/`defineQuery`/`defineJs*`) — the majority — carry no obligation and no security/convenience distinction. A survey whose one-paragraph self-characterization is the premise for its sibling RFC must state that precisely.

3. **(0230 — the "only" claim in the second shaping finding is falsified by shipped systems the survey missed.)** The summary asserts "Only the incremental-view-maintenance line and Rocicorp Zero engage with that structurally; InstantDB engages it by brute force." At minimum two production systems at exactly the Tier-1 intersection are absent: **Hasura** — declarative, table-locus, per-role row *and column* permissions compiled into the generated SQL, with live subscriptions served by multiplexed polling cohorted by session variables (a shipped answer to both the composition question and the decision-lifetime question, and the closest living relative of 0231's D1–D3 shape — arguably closer than Zero); and **Supabase Realtime's RLS enforcement (WALRUS)** — per-WAL-change, per-subscriber policy evaluation on the live path, i.e., a second independent empirical instance of the InstantDB brute-force shape that Finding 1 currently rests on a single vendor's self-report for. (Assess both before citing; my characterizations are from general knowledge, not a fresh reading for this review — the same standard 0230's own Confidence section applies to its tiers.) Also relevant and absent: Oso/Polar's data-filtering (policy compiled into query predicates, as a product library). Given the survey's explicit brief this round — "is anything important missing?" — these are material omissions, and the first directly corrects a load-bearing sentence.

4. **(SET — class M has zero grounding in the survey.)** Round 1 moved 0231 to commit to masked projections (class M) with pointing-room as the acceptance-gated worked case, but 0230 contains no field/column-level enforcement prior art at all — no column privileges, no dynamic data masking, no Hasura column permissions, no GraphQL field-authorization literature, nothing on masking semantics (e.g., null-substitution versus row-splitting, and the known inference/side-channel problems of masked columns under filtering and ordering — a masked field that still participates in `order`/`filter` leaks). The lockstep cluster therefore has its newest and least-conventional design commitment supported by the survey's silence. Either 0230 grows a masking section or 0231 must acknowledge class M is being designed without surveyed prior art; as the set stands, the two documents do not cover each other.

## DETAIL findings

1. (0231) "Five demos carry no authorization concept whatsoever" — public-dashboard and latency-kanban declare explicit `auth: 'public'` on every query (the 0172-style declared function-level intent). The 14/102 arithmetic stands, but "no authorization concept whatsoever" overstates, and those explicit publics are worth naming: they are exactly the declared public-by-design intent D2 wants, one level up.
2. (0230) Finding 0's "Firebase Security Rules: 0" is off by a passing mention — LLP 0139's vendor table row includes "Cloud Storage + security rules." Immaterial to the coverage-gap conclusion; "mechanically counted" should survive a recount, though.
3. (0231) Verified accurate against sources, for the record: card-game `functions.mjs:42-45` quote and line cite; pointing-room `functions.mjs:70` quote, and its field-level/disjunctive/cross-table characterization; diary 0031:296 and 0031:565 quotes exact; diary 0074 "cross-table disclosure" framing; LLP 0011 §462 content including the online-only fallback D3 supersedes; LLP 0170's "does not authorize a read"/"must still enforce the caller filter" and its plan-class-specific conclusion; 0172's "does not claim" sentence and the implemented-warning/unshipped-fail status (`index.mjs:2750-2799`); 0173 Status Review (proposed, not built); 0056's revocation-correctness quote; 0053 v1 global-epoch/shadow-suppression claims; `queryDef`'s `membership:` array slot.
4. (0230) Confidence labels are otherwise honest and well-calibrated — Tier 4 admits reputation-level knowledge, Zero's deprecation rationale and Blockaid's cache-hit claims are flagged unverified, and the Confidence section correctly scopes the high-confidence claims to the two corpus-internal findings.
5. (0231) When §census is restated per MATERIAL 1, the counter-evidence section's "~75 of 102" and the "roughly even split" sentence need the same restatement; the qualitative-counter-evidence caveat (OQ5) is unaffected.
6. (0231) The acceptance section is strong — the pointing-room class-M gate and the "deleting the card-game policy fails a test" gate are falsifiable and correctly placed; no change requested.

## Verdict: 0231 — NOT READY
## Verdict: 0230 — NOT READY
## Verdict: SET — NOT READY

---

## Round 3 — 2026-08-10/11 (delta round, 0231 only)

**Reviewer family:** claude
**Provider / runtime:** fresh general-purpose subagent (Anthropic), no prior context, launched by the continuation orchestrator
**Round:** 3 — delta round per LLP 0010 §2 addendum; capsule enumerated the round-2 delta; concerns classified IN-DELTA vs PRE-EXISTING
**Topology:** 0231 only (0230 exited the cluster after its author-scoped single round; provided as disclosed-unreviewed context)
**Redacted:** no
**Bound to revision:** 0231 `sha256 161bab9158489422b05d046029aa0511340935f65c7fb95e408b7575816538f7`

Blindness: instruction-based, self-attested; compliance confirmed in the reviewer's first line. Prior-round findings not disclosed. Body below is verbatim.

---

# LLP 0231 — Delta-round (round 3) review

**Blindness compliance:** I have not read anything under `llp/reviews/` beginning `0230-` or `0231-`, nor any super-refine run journal. My inputs were the target at sha256 `161bab9…538f7` (verified), LLP 0230 as context, the cited LLPs (0011, 0053, 0056, 0073, 0080, 0170, 0172, 0173, 0187), diaries 0031 and 0074, `packages/snapback-codegen/define.mjs` and `index.mjs`, and the demo corpus at the pinned commit `5373238eb`.

## Verification performed

I re-derived the census independently at `5373238eb` with a block-level parser rather than raw greps. The following all reproduce exactly: **96** `define*Query` call sites across 31 demo `functions.mjs` files; **102** generated operations (96 + 3 `*KeysetPages` calls × 2); **10** call sites carrying a declared `visibility` union, across exactly 5 demos (catalog-lens, competitive-checkpoint, fleet-observatory-move1, signal-desk, triage-graph); **12** source-level `authUserId()` uses inside query `filter:` lists across exactly 8 demos; **9** textual `membership:` declarations / **10** generated (8 direct + `defineMembershipKeysetPages` × 2); the 76 = 102 − 10 − 16 and ~66 arithmetic; partiful-matrix's 4 read queries all unscoped with its `authUserId()` uses write-side; `auth: 'public'` on all 3 public-dashboard and both latency-kanban queries; 85 diaries. Code citations verified at the exact lines: card-game `functions.mjs:42–45` and pointing-room `functions.mjs:70` match the quoted snippets verbatim. `SNAPBACK_SEARCH_INDEX_VISIBILITY_REQUIRED` is a real mandatory-or-fail assert in `define.mjs` (~line 848) with the quoted "intentionally public data" instruction; `queryDef` accepts a `membership` array of declaration-bound predicates; `owner()`/`throughParent()`/`throughScope()` and `memberOf()`/`hasRole()` exist as described; 0172's warning-only phase status matches `index.mjs` (~line 2763, diagnostic emitted, generation does not fail); the 0170 quotes ("does not authorize a read", "the handler must still enforce the caller filter", plan-class-specific), the 0011 §462 InstantDB characterization *and* its recorded online-only fallback, diary 0031:296/0031:565, and diary 0074's pointing-room account are all quoted or characterized accurately. LLP 0080 confirms caller-relative root/joined/output visibility.

## MATERIAL findings

1. **IN-DELTA (counter-evidence, corrected counts): the "five demos carry no row-scoping concept" list is incomplete; the count 14 of 102 is wrong.** Two demos meet the section's own criterion and are omitted:
   - **campfire** (4 queries): zero `authUserId()`, zero `ctx.auth`, zero `membership:`/`visibility:`/`authScopeField`, no `auth:` requirement on any function — the identical zero-mechanism profile of the five listed demos. Its schema even carries the comment "app is deliberately public — no room membership model," so it is unambiguous.
   - **chirp** (3 queries): zero auth mechanisms of any kind; its only scoping is client-asserted handle *arguments* (`viewerHandle`) — and arg-scoping demonstrably does not exclude a demo from this list, since chat-matrix (listed) scopes by `conversationId` arg the same way.

   The correct figure is **seven demos, 21 of 102** (minimally six/18 if chirp's client-asserted viewer arg is judged a "row-scoping concept"). The error is direction-preserving — it understates the no-op-typing counter-evidence, and campfire is actually a gift to D2 (public-by-design intent recorded only in a comment is precisely what D2 makes machine-checkable) — but this is the third count defect in the same section of a document whose Status section stakes "cross-checked across the orchestrator and both review families," and the author's guidance is to trust a disagreeing re-derivation. It must be corrected (and the Status claim re-worded) before the census can be called settled. The fix is small and strengthens rather than weakens the recommendation.

No other MATERIAL findings. Specifically: the D1 table-locus decision, the class R/M two-class model with the class-J withdrawal, the pinned class-M safety envelope with grammar deferred to a sibling spec, the policy-fact/policy-program split bound to LLP 0053 activation, the D6 single-IR locus decision, and the S1 restatement are internally coherent, correctly sourced, and I judge none of the deferral decisions defective — the envelope (noninterference, fail-closed field addition, obligation-backed re-masking) is the right minimum to pin before a grammar exists.

## DETAIL findings

1. **IN-DELTA (D1):** "A query may declare a **refinement** — a further narrowing" — nothing states how narrowing is *verified*. If refinements compose by conjunction (AND) they are structurally narrowing and no check is needed; say so, or a "refinement" that widens becomes an undeclared override. One sentence closes it.
2. **IN-DELTA (D1):** the override examples name admin views, moderation, and aggregates, but the largest override population under an unbypassable caller-keyed table policy will likely be **no-principal access paths** — scheduled functions (LLP 0070 `runAfter`), seeds, maintenance sweeps — which see nothing under an `authUserId()` policy. The override mechanism accommodates them; the migration-cost paragraph and OQ6 should name them so the override census isn't a surprise at implementation time.
3. **IN-DELTA (census table):** generated owned pages are annotated under *both* the `authUserId()` row ("16 generated uses") and the visibility row ("plus the generated owned pages, which carry `visibility: { kind: 'owner' }`"). The 76/66 derivation counts them once (under the first). State which row owns them arithmetically; as written a reader double-counting them cannot reproduce 76.
4. **PRE-EXISTING (Acceptance):** "Deleting the visibility policy that hides card-game hands fails a test" is weaker than the RFC's own mechanism — under D1/D2 the deletion should fail *generation* (or be impossible, since the table policy survives query edits). As written the bullet is arguably already satisfied today by the acceptance fixture the Evidence section itself describes ("asserts disjoint results"), which would make it vacuous. Restate as a generate-time/data-layer refusal obligation.
5. **IN-DELTA (D3 interim):** worth one sentence of candor: the `fieldBoundary:` interim does **not** carry the envelope's noninterference property — the handler sees raw values, so a hidden value can still influence ordering or computed output until the sibling spec ships. The document implies this via "handler-enforced (not proven)" but the contrast with the envelope bullet ("withheld from handler view entirely") is sharp enough that the interim's weaker guarantee should be explicit.

## Verdict: 0231 — NOT READY

---

## Round 4 — 2026-08-10/11 (delta round, 0231 only)

**Reviewer family:** claude
**Provider / runtime:** fresh general-purpose subagent (Anthropic), no prior context, launched by the continuation orchestrator
**Round:** 4 — delta round; capsule enumerated the round-3 delta; concerns classified IN-DELTA vs PRE-EXISTING
**Redacted:** no
**Bound to revision:** 0231 `sha256 09c2a3426acbf200c7e2143fe78383d346a523c9b9bb75ec87a85e37ade254db`

Blindness: instruction-based, self-attested; compliance confirmed in the reviewer's first line. Prior-round findings not disclosed. Body below is verbatim.

---

# LLP 0231 — Round 4 (delta round) review

**Blindness compliance:** I did not read anything under `llp/reviews/` with a `0230-` or `0231-` prefix, nor any super-refine run journal. Verdict binds to `llp/0231-entity-and-permissioning-recommendation.rfc.md` at sha256 `09c2a3426acbf200c7e2143fe78383d346a523c9b9bb75ec87a85e37ade254db` (hash verified locally).

## Verification performed

I re-derived the census independently at `5373238eb` and checked the load-bearing citations against their sources rather than taking either on faith.

**Census re-derivation (delta items 5, 6, and the point-2 rephrase):**

- `define*Query` call sites under `demos/*/snapback/functions.mjs` (top-level glob, matching the document's stated scope): **96 exactly**. Three `*KeysetPages` sites (competitive-checkpoint ×1 owned, team-chat ×1 owned + ×1 membership); 96 + 3×2 = 102 generated operations, and 2 owned sites × 2 owned pages = the "four generated owned pages," which with 12 textual `authUserId()` filter uses gives the stated 16 generated — the arithmetic is internally consistent.
- `authUserId()` in query `filter:` lists: **12 uses across 8 demos** (browser-local-first, card-game, competitive-checkpoint, dispatch-board ×2, shindig, team-chat ×2, todo-v2 ×3, todo). Matches exactly.
- Textual `membership:` declarations: **9** (access-desk, party-wall, rbac, shindig ×3, team-chat ×3). Matches.
- The no-scoping roster: I grepped all candidate demos for any scoping token (`authUserId()`, `membership:`, `visibility:`, `authScopeField`, `ctx.auth`). Exactly the seven named demos — all-aboard, campfire, public-dashboard, chirp, chat-matrix, latency-kanban, pulse-monitor — have **zero** tokens, and their per-demo query counts (6/4/3/3/2/2/1 = **21 of 102**) match the document precisely. No eighth zero-token demo exists in the top-level glob. The delta's roster correction is right.
- Delta item 6's specific characterizations verified: campfire's public intent lives only in a schema comment ("deliberately public — no room membership model"); chirp's only scoping is client-asserted `handle`/`viewerHandle` string args; public-dashboard (3/3) and latency-kanban (2/2) declare `auth: 'public'` on every query.

**Citation checks:**

- Card-game snippet and line number (`functions.mjs:42-45`) verbatim-correct; pointing-room `functions.mjs:70` ternary verbatim-correct.
- `SNAPBACK_SEARCH_INDEX_VISIBility_REQUIRED` is real and mandatory-or-fail today (`packages/snapback-codegen/define.mjs:846-849`), with exactly the quoted "intentionally public data" instruction. Notably, the shipped membership-kind visibility already binds by `resourceField` — a row field, not a query arg — so the document's claim that the table-locus vocabulary substantially exists is stronger than it might appear, not weaker.
- LLP 0011 (auth-and-permissions RFC) lines 457–463 say exactly what §Evidence claims: InstantDB post-query CEL `view` evaluation including live invalidation, unshipped pushdown, and the online-only non-syncable fallback the RFC supersedes for visibility expressions.
- LLP 0170 verified for all three uses: "the handler must still enforce the caller filter," the `authScopeField`-is-not-authorization quote (S3, verbatim), plan-class-specific enforcement, and waiver governance as prerequisite (0170 Finding 4 / lines 124–126).
- LLP 0172 Phase W/Phase E structure verified; codegen emits `SNAPBACK_AUTH_REQUIREMENT_IMPLICIT` at `severity: 'warning'` and generation does not fail — the document's honest "second phase has not shipped" framing is correct.
- LLP 0053: `live_replace` delivery-obligation-backed as potentially shrinking; v1 "ships **only** the global epoch" with subject-scoped targeting deferred (0053:1674); activation modeled as distinct and fail-closed. D4's characterization is accurate.
- Diary 0031:296–297 and :564–565 quotes verbatim; diary 0074 slice 1 supports the pointing-room framing; LLP 0230's Blockaid characterization (runtime interceptor, cached generalized decisions) matches A4, and 0230 indeed contains no field-level enforcement literature, as D3 discloses.
- Statuses claimed match headers: 0173 Review (proposed, not built), 0170 Draft, 0053 Accepted.

## MATERIAL findings

None. Specifically, on the delta:

- **D1 overrides fail-closed until the governance sibling (delta item 1):** I probed this as the most consequential delta decision. It creates a hard transitive dependency — the RFC's central protection (D2 phase 2) is blocked on an undesigned sibling, and no-principal paths cannot read caller-keyed tables until it lands. But the document states this plainly in all four places it matters (D1, Costs, OQ6, and the phasing via 0172's trajectory), and the alternative — an ungoverned escape hatch — would reintroduce exactly the hole the RFC exists to close. Deferral-with-fail-closed is coherent here, not defective.
- **D3 field-addition fence on every table (delta item 4):** the rationale (a public table silently exposing a newly sensitive field recreates the D2 omission hazard at field granularity) is sound, and the per-field cost is honestly carried into §Costs (delta item 7). Not defective.
- **The census and roster corrections (delta items 5, 6, 10):** verified above; the "trust your own count" invitation was exercised and the delta's numbers survive it. The re-derive-before-citing posture in §Status is the right resolution for figures that have been overturned three times.
- **Effective-policy projection with opaque handler-local narrowing (delta item 2):** consistent with 0170's non-derivability finding; the projection now claims only what composition can actually show. Honest and correct.

No pre-existing MATERIAL defect found either. The recommendation's core chain — obligation not recorded → declared table-locus policy → composed into the plan → projected and identity-tested, with a two-class plan model and fail-closed interims — is internally coherent, and every authority claim I checked is now stated at or below the strength its source supports.

## DETAIL findings

1. **[IN-DELTA] Census: "plus one `authScopeField` site" undercounts.** I find **three** textual `authScopeField` occurrences on query call sites: `todo` `listTodos` (defineJsLiveQuery), `competitive-checkpoint` `listMessages` (defineJsLiveQuery), and `competitive-checkpoint` `listConversationCards` (defineLiveQuery, which also carries an `authUserId()` filter and is presumably counted there). Two sites have `authScopeField` as their *only* scoping token, not one. This moves "roughly 66 of 102" by ~1 and changes no conclusion — and per 0170, `authScopeField` authorizes nothing anyway — but the parenthetical should say two, or state its exclusion rule.
2. **[PRE-EXISTING] "machine-applicable remediations" overstates the 0172 warning.** The emitted remediations in `packages/snapback-codegen/index.mjs` (~line 2780) are all `machineApplicable: false, requiresApproval: true` — correctly, since choosing an auth level is a policy decision. The load-bearing claim (warning implemented, failure phase not) is verified true; the adjective is wrong.
3. **[PRE-EXISTING] The interim `fieldBoundary:` obligation is a norm, not a fence, and the document doesn't quite say so.** An author who writes a masking ternary *without* declaring `fieldBoundary:` passes generation undetected — JS is opaque (0170), so the "must be declared" requirement is unenforceable during the interim, which is precisely the mechanism-vs-obligation gap this RFC's thesis names. The interim decision itself is the only feasible one (row policy still applies underneath; nothing could detect undeclared concealment), so this is not a defective decision — but one candor sentence acknowledging that undeclared field boundaries remain invisible until the class-M sibling ships would bring this passage up to the document's own standard. The delta's missing-noninterference disclosure (item 4 of the delta list) covers declared boundaries only.
4. **[IN-DELTA] Field-addition fence activation timing is unstated.** The fence lives inside the class-M safety envelope, but class M "is not enforced" until the sibling spec ships, while §Costs treats the fence as part of migration. Whether the fence activates with D2's second phase (declarable as disclosed-with-row or `fieldBoundary:`) or only with the class-M sibling is inferable but never said. Implementation-phase sequencing; worth one clause.
5. **[PRE-EXISTING] Acceptance bullet on overrides describes a state this RFC forbids.** "Every override … appears on the projection and carries an identity-switching acceptance test" can only be satisfied after the governance sibling lands, since no override is generatable under this RFC alone. A "(post-governance)" qualifier would keep §Acceptance self-consistent with D1.
6. **[PRE-EXISTING] Related header drift.** The body cites LLP 0035, 0070, 0073, 0080, 0085, and 0187, none of which appear in **Related**, while 0039, 0082, and 0100 are listed but uncited in the body. Header hygiene only.

## Verdict: 0231 — READY
