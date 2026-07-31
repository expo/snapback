# Review: LLP 0135 — Sequence allocation and snapshot-batch composition (round 1, Fable family)

**Family:** Fable (Claude)
**Runtime:** Claude Code / claude-fable-5
**Effort:** session-inherited
**Date:** 2026-07-31
**Method:** fresh non-author subagent context, read-only review of the
working tree; blind to this Spec's codex artifact (not opened)
**Target:** `llp/0135-sequence-allocation-and-snapshot-batch.spec.md` (476 lines)
**Target SHA-256:** `cac4af442dae8e94c4430cf9618fe2c64b155380699a3f18a1b1caccf8894ae5`
**Status:** completed

Reviewed against: the commissioning ticket
`issues/20260730-move6-sequence-and-3a-design-passes.md` (full read),
LLP 0120 v0.2 (full read — the sequence semantics map, option 3a,
findings 4/8/9, OQ1–OQ8), LLP 0110 (§§1.1–1.5, 2.1–2.5, Non-goals,
OQ2/OQ4, round-2/3 reconciliations: relation registry lifecycle,
`sbbc1` protocol, uniqueness rule, effect formulas), LLP 0080 (§1, §2
`root-window-v1`, §3, OQ1/OQ7), LLP 0113 §1, LLP 0134 (full read),
LLP 0130 (SD-2/SD-4/ER-2), LLP 0125 option 5, LLP 0133 (full read —
lanes Q/L, divergence classes, vocabulary), LLP 0108 (manifest and
`implementationHash` field list), LLP 0051 recorded-answer rows,
LLP 0043 settlement identity text via 0110 §2.4, LLP 0115 CV-8
(v0.5–v0.7), LLP 0127 move 6 + decision-3 record, LLP 0007's 1,024
frame, Diary 0033 line 39, Diary 0034 lines 195–196, and code
spot-checks: `src/manifest.rs` (no `sequence_allocation_v1` /
`snapshot_batch_v1` registered — the ids are genuinely new),
`packages/snapback-harness/ctx-bootstrap.js` (no `ctx.sequence`).

---

## 1. Overall assessment

This is a disciplined, largely faithful execution of the two
commissioned design passes. Part 1 maps every surface the 0120
semantics map demands — scope identity via incarnation, same-transaction
allocation-versus-commit posture, gap taxonomy (density over allocation
events, not surviving rows), idempotency through the existing 0043/0051
settlement path, exhaustion fail-closed, hot-key statements labeled as
named empirical expectations with 0125 option 5 owning the measurement,
and an allocation-authority section. Part 2 delivers the four 3a design
demands by name: structural parent-auth dedup, a coordinated composite
cursor, summed ceilings with own identity, and seal-entirely partial
refusal pinned as the only v1 behavior. The maturity posture is honest
and verified against 0113 §1 and 0134 §8 (which does name both ids as
default-route entrants), the fold-on-acceptance amendment discipline
(CV-8's no-widening rule) is applied, and SD-2 hygiene is genuinely
clean — the aggregate residue is recorded, routed, and not pre-decided.

Judged against the bar — exhausted pre-empirical analysis, no flaws —
the Spec falls short in five places that are all resolvable by more
analysis of documents already in the corpus: the incarnation-registry
enrollment mechanism for counter scopes does not exist in the corpus
and is not created here (which makes the Campfire acceptance
unimplementable as written); the handler-tier allocation-authority
sentence claims a structural property only the generated profile has;
the "exactly like `runtime.id`" analogy is wrong in one direction
against the same-wave LLP 0133 lanes; the composite cursor's inherited
1,024-byte cap fails arithmetic for the composite's own worst case; and
`relational_query_v1` nodes are admitted by §2.1 but the composite
cursor, seal, restart, and ceiling text is written only in
bounded-children vocabulary. A sixth, smaller consistency gap: the
handler-tier `sequences` manifest member changes LLP 0108's closed
manifest surface, and §4 drafts no 0108 amendment.

## 2. Verification log (raw data)

Facts checked and their outcomes:

- **Commission fidelity.** Ticket work item 1's mapped-surface list
  (scope identity/incarnation, allocation-vs-commit, gap observability,
  idempotency, exhaustion, hot-key as named expectation, authority) ↔
  §§1.1–1.7 one-to-one. Work item 2's list (per-node auth dedup,
  coordinated-resume cursors, composite ceilings and identity,
  sealing-entirely) ↔ §§2.2–2.5. Exit conditions: no implementation
  claim (§Nonclaims: "support is false everywhere; every §5 claim is a
  future witness"), no maturity shortcut (§2.6/§1.8 match 0113 §1's
  "publication CAS changes only the verified runtime-support fact,
  never the maturity constant" and 0120 finding 9), no stable-surface
  widening (§Nonclaims: "composing a stable `relational_query_v1` node
  changes that profile's admission not at all"; §4 defers all edits to
  Accepted). Ticket exclusions respected: OQ5/OQ6/OQ8 and option-2a
  budgets are not decided here (§1.9, §Nonclaims).
- **Shipping order / decision 3.** §Summary's "the shipping order 0127
  decision 3 fixed on 2026-07-30" matches the ticket and 0115 CV-8
  v0.6 ("sequence-allocation primitive ships first, then the 3a
  snapshot-batch composite; the contracted-aggregate profile decision
  is deferred until 3a usage evidence exists"). ✓
- **0134 cross-references.** §2.6's "LLP 0134 already names both of
  this Spec's ids as default-route entrants" ↔ 0134 §8 verbatim intent
  ("enter the registry at experimental on the default route when their
  designs land, and reach stable only through this Spec"). §1.8's
  "promotion to stable runs only through LLP 0134's path (§2.6)" ↔
  0134 §§2–4. ✓ (One addition 0134 does not contain: the composite's
  min-maturity coupling rule — see D9.)
- **0110 §2.1 / OQ4.** The refused range-collect and the moveCard
  instance match 0110 OQ4's Diary 0039 annotation verbatim in
  substance. §4.1's drafted amendment (closed `AllocateSequence` step;
  no-range-read admission unchanged; OQ4 annotated; OQ2 pointer) is
  the right owner and shape. ✓
- **0110 uniqueness rule.** §1.1's "(scopeId, relationIncarnation)
  prefix" ↔ 0110 round-2 reconciliation ("Activity/source tables must
  scope every client-observable unique constraint by the same
  `(scopeId, relationIncarnation)` prefix"). Faithful citation — but
  see B1 for what the reuse presumes.
- **0110 registry lifecycle.** 0110's registry rows are created by
  "every insert into a table named as a bounded-children parent";
  activation requires reviewed backfill ("no row is silently
  blessed"). Nothing in 0110 or 0135 enrolls a counter-scope table
  that is not a bounded-children parent. → B1.
- **0043/0110 §2.4 settlement.** §1.4's first-success-stores /
  exact-duplicate-returns-retained-bytes / failed-attempt-stores-
  nothing sequence matches 0110 §2.4 and its LLP 0043
  `ClientMutationIdentity` description, including concurrent-duplicate
  single-commit. ✓
- **0133 lanes.** Lane Q accepts client-captured `{generatedIds, now}`
  (the LLP 0008 pin); lane L re-derives ctx answers with a normative
  id-map whose pending-intent rewrite is "exact value-equality of
  string leaves against the client's own minted-id ledger — the client
  minted these high-entropy ids." A sequence value is a small integer:
  neither lane's machinery covers it. → M2.
- **0108 manifest closure.** `implementationHash` binds "declared
  reads, writes, auth, effects, `uses`, and `outgrewIr`" as a frozen
  ordered field list; the JS-mutation manifest requirements are
  per-kind and closed. A `sequences` member is new vocabulary. §4
  amends 0110, 0080, and the 0051 orbit only. → M5.
- **Cursor cap arithmetic.** Wire cap 1,024 bytes; `sbsb1 "." ` prefix
  leaves ≤1,018 base64url chars → ≤763 decoded bytes → ≤723 plaintext
  bytes after the 24-byte nonce and 16-byte tag. The sbbc1-shaped
  shared envelope (format, key generation, app/database/target, stream
  and restore epoch, function identity, 64-hex plan hash, authority
  partition, issuance, expiry, member names) plausibly consumes
  250–350 of those. Eight nodes × (parent id + 36-char UUIDv7
  incarnation + `_version` + complete boundary values incl. child
  `_id` + JSON framing) exceeds the remainder even with empty
  boundaries (~72+ bytes/node before boundary state); string order
  fields are unbounded. → M3.
- **0080 relational node shape.** Callable plans take
  argument-referencing filters ("A callable `RelationalQueryPlanV1`
  adds caller-relative … argument-referencing filters"), and the
  standalone relational cursor binds "the normalized non-cursor
  arguments." Each consumed root performs one joined-side unique-index
  lookup. §2.4/§2.5 accommodate neither. → M4.
- **SD-2 hygiene (explicitly checked, per the bar).** §Summary routes
  the contracted-aggregate decision to SD-2; §1.7 refuses the counter
  read surface *because* "the aggregate question belongs to LLP 0130
  SD-2, not this Spec"; §5.2's final bullet records the run as SD-2
  usage evidence "alongside the explicit record that `boardSummary`
  and the Split ledger derivation were *not* expressed," and says
  SD-2's criteria decide. No branch of SD-2 is pre-decided; recording
  the aggregates as inexpressible is exactly what 0120 option 3a
  already establishes ("it does not touch aggregation") and what SD-2's
  criteria require as input. PASS.
- **0125 ownership.** §1.6's "LLP 0125's burst-profiling work (its
  option 5) owns the measurement" ↔ 0125 option 5 ("a contention-safe
  sequence-allocation primitive so append-heavy apps stop scanning to
  derive order"). ✓
- **Diary claims.** Diary 0033 line 39 has the exact
  `{cardId, activityId, sequence}` shape; Diary 0034 lines 195–196
  carry the send-scan contention concern. ✓
- **Registry novelty.** `src/manifest.rs` contains neither id;
  `ctx-bootstrap.js` has no `ctx.sequence`. The "new registry entries"
  claim is accurate. ✓
- **0007 frame.** §2.1's Σ take ≤ 1,024 ↔ 0007's `0..=1,024`
  query bound. ✓

## 3. Strengths

- **The semantic surface really is mapped.** Every item 0120's map
  demands has a section with a decided posture, not a gesture: the
  same-transaction/no-preallocation split is pinned as two profiles
  that must not share an id (§1.3), density is defined over allocation
  events with the deleted-row non-gap called out, and exhaustion is
  specified precisely because "'practically' is not a semantics"
  (§1.5) — the same reasoning discipline 0120 applies to overflow.
- **Honest labeling under LLP 0115 constraint 1.** §1.6 keeps both
  contention statements as named empirical expectations, claims "no
  numbers and no relative performance," and the multi-writer
  commit-order claim is per-target with a structured-GAP fallback and
  a demotion path already sketched (OQ3). This is the posture 0120
  option 5's labeling rule asks for, applied without slippage.
- **Seal-entirely is specified to the byte.** §2.3 pins one sealed
  envelope regardless of which node, how many, or which cause, with
  the 0110 §1.3 ordering extension (visibility before composite cursor
  validation) so malformed cursor bytes cannot split the outcome —
  and §5.2 makes it falsifiable across result, code, status,
  transport, live initial state, and inspection. The composite
  discloses at most the OR of facts each standalone sealed plan
  already discloses, so no new channel opens.
- **Structural dedup is decided the right way.** §2.2's
  same-declaration-not-same-runtime-value rule is statically decidable
  at normalization, changes work counting only, and §5.2 instruments
  it. "Never runtime coincidence" holds by construction.
- **Maturity honesty.** §1.8/§2.6 quote the 0113 terminus correctly,
  defer promotion to 0134 (which does name both ids), and make the
  experimental-dependency acknowledgment loud on purpose. §Nonclaims
  repeats that this Spec "cannot and does not shorten" the path.
- **SD-2 hygiene is exemplary** — see the verification log. The Spec
  resists the available temptation in both directions: it neither
  smuggles a count through the counter (no read surface, containment
  rule, information-flow fact stated plainly) nor declares SD-2's
  outcome from the inexpressibility it documents.
- **The fold-on-acceptance section is the right mechanism.** Drafting
  the 0110/0080/0051 amendments inside the Draft so their scope is
  reviewable, with no normative effect until Accepted, is CV-8's rule
  done properly (its one omission is M5).

## 4. Concerns

### BLOCKING-FOR-BAR

- **B1 — The incarnation-registry enrollment mechanism for counter
  scopes does not exist, and the Spec neither creates it nor amends
  0110 to create it.** §1.1 keys counter identity to "that row's
  current active incarnation in LLP 0110's protected
  relation-incarnation registry," and §1.2 refuses allocation against
  a scope "missing, deleted, or **never registered**." But 0110's
  registry acquires rows only through inserts into "a table named as a
  bounded-children parent," plus a reviewed backfill at capability
  activation ("no row is silently blessed"). A counter's scope table
  is only required to *satisfy* 0110 §1.1's eligibility rules — it is
  nowhere required or caused to be an enrolled registry participant.
  Consequences, all pre-empirical: (a) for any scope table that is not
  also a bounded-children parent — Campfire's rooms table in the §5.1
  acceptance is exactly this — every row is "never registered" and
  every allocation refuses `SNAPBACK_RELATION_PARENT_UNAVAILABLE`
  forever, so the Campfire acceptance is unimplementable as specified;
  (b) §5.1's delete/recreate-restarts-at-1 acceptance presumes
  registry rows that nothing minted; (c) §1.1's reuse of the
  `(scopeId, relationIncarnation)`-prefixed uniqueness rule presumes
  incarnation *stamps* on the value-storing rows, and 0110's protected
  stamping boundary is defined only for declared `relationIncarnationOf`
  child fields of bounded-children relations — a messages table
  storing allocated sequences has no stamp source; and (d) §4.1's
  drafted 0110 amendment covers §2.1 vocabulary, effect formulas, and
  two open-question annotations, but not the registry-lifecycle text
  that would have to change ("named as a bounded-children parent" →
  "…or as a sequence-counter scope"), nor the activation/backfill gate
  for scope tables with pre-existing rows. The fix is analysis, not
  evidence: state that declaring a counter enrolls its scope table in
  the registry under the full 0110 lifecycle (same-transaction insert
  registration, reviewed backfill before activation, restore
  validation), extend §4.1 accordingly, and state the stamp obligation
  for tables carrying prefixed unique constraints over allocated
  values.

### MATERIAL

- **M1 — §1.7's allocation-authority sentence overclaims for the
  handler tier.** "It is admitted exactly where the enclosing
  operation's declared authorization already admits writing into the
  scope" is structurally true for the generated profile (the counter
  scope must be the plan's authorized scope row). For the handler tier
  the section's own gate list is: declared `sequences` entry,
  active-incarnation check, and "the operation's own declared
  authorization" — none of which ties the caller to *the scope row*.
  A public (anonymous-callable) handler with a declared counter can
  allocate against any `scopeId` passed as an argument and return the
  value, disclosing the prior-allocation count of a scope row the
  caller cannot see — precisely the information-flow fact §1.7 itself
  states, escaping the through-scope containment because the
  containment rule governs storage, not results. This is the 0120
  "allocation authority" surface answered structurally for one tier
  and only rhetorically for the other. Fix by one of: (a) restate
  honestly — handler-tier allocation authority *is* invocation
  authority, and the writes-into-the-scope claim is
  generated-profile-only, extending the declared-versus-proved
  limitation (and OQ1) to authority; or (b) add a structural gate:
  `ctx.sequence.allocate` refuses unless the scope row is visible to
  the effective subject under a declared visibility. Either is
  pre-empirical; the current text is neither.
- **M2 — "A recorded answer under LLP 0051, exactly like `runtime.id`"
  is wrong in one direction against the same-wave settlement lanes.**
  Under LLP 0133, `runtime.id` answers are client-capturable: lane Q
  *accepts* the captured `{generatedIds, now}` (the LLP 0008 pin), and
  lane L re-derives them with a normative id-map whose pending-intent
  rewrite is sound only because minted ids are high-entropy strings
  the client can leaf-match. A sequence allocation has neither
  property: a client cannot know the authoritative next value, so
  nothing sequence-shaped may ever join the accepted captured
  environment, and a re-derived sequence is a small integer whose
  divergence fits none of 0133's three divergence classes
  (leaf-equality rewrite of small integers is unsound; it is not
  time). §1.2's "exists only inside a mutation's authoritative
  transaction" does the scoping work implicitly, but the Spec never
  names the interaction: LLP 0129/0133 are absent from Related, and
  there is no nonclaim or open question for local execution of
  allocating operations. The analogy invites exactly the wrong
  inference for the §4.3 amendment (0051's recorded-answer set is what
  the 0008 pin transmits). Fix: qualify the analogy to the
  server-side settlement-replay path it actually means; add an
  explicit nonclaim — the allocated value is recorded at authoritative
  execution only, is never a client-capturable environment member in
  any lane, and local-execution admission of allocating operations is
  out of scope pending LLP 0133's row-2 admission vocabulary (or an
  OQ); and pin that restriction in the drafted 0051-orbit amendment.
- **M3 — The composite cursor's 1,024-byte wire cap fails arithmetic
  for the composite's own worst case.** §2.4 adopts the `sbbc1`
  protocol shape including its cap, but binds per-node state for two
  through eight nodes: after the prefix, nonce, and tag, at most ~723
  plaintext bytes remain; the shared identity envelope plausibly
  consumes 250–350; the residue cannot hold eight × (parent id +
  36-char UUIDv7 incarnation + `_version` + complete boundary values
  including child `_id` + framing), and string order fields are
  unbounded, so even the flagship three-node `boardView` composite is
  tight. Under the inherited mint-failure rule the consequence is a
  refused page — a data-dependent availability cliff for exactly the
  compositions the profile exists to serve. This is falsifiable today
  by arithmetic, which is what pre-empirical exhaustion demands. Fix:
  size the cap for the admitted worst case (a larger `sbsb1` cap with
  the sizing shown), and/or bound cumulative boundary width at
  generation (order-field count/type or declared width limits per
  composite), and/or bind structurally-deduplicated parents once
  (see D9); add a mint-failure acceptance vector either way.
- **M4 — `relational_query_v1` nodes are admitted but the composite
  semantics are written only in bounded-children vocabulary.** §2.1
  admits them; then §2.2 (parent dedup), §2.3 ("if any node's parent
  is absent or invisible"), and §2.4 (plaintext binds "every node's
  parent id, incarnation, and current parent `_version`"; restart on
  parent change) have no mapping for a node with no parent. Three
  concrete holes: (a) the composite cursor is not stated to bind the
  composite's merged non-cursor *argument values* — for
  bounded-children nodes the parent id is the only argument and is
  bound, but a relational node's argument-referencing filters (0080
  §1) are bound in its standalone cursor ("the normalized non-cursor
  arguments") and would be unbound here, letting a resumed composite
  replay a stale boundary under different filter arguments; (b) the
  relational node's within-composite restart trigger (what replaces
  parent `_version`?) and terminal semantics are unstated; (c) §2.5's
  ceiling — "Σ (takeᵢ + 1) examined child/root entries plus one
  point-read per deduplicated parent declaration" — omits the
  relational node's per-consumed-root joined-side unique-index
  lookups (up to takeᵢ additional point-reads per 0080 §1), so the
  "static fact of the normalized plan" is not the complete work bound
  for mixed composites. Fix: either specify the relational node's
  composite binding (bind merged normalized arguments; define its
  boundary/terminal/restart mapping; count joined lookups in the
  ceiling) or narrow v1's normative text to bounded-children nodes and
  let OQ5 carry relational admission as a design question rather than
  a first-publication question.
- **M5 — The handler-tier surface changes LLP 0108's closed manifest
  and §4 drafts no 0108 amendment.** The `sequences` manifest list
  (§1.2.2) is new per-kind manifest vocabulary for LLP 0108's tier,
  whose `implementationHash` binds a frozen ordered field list
  ("declared reads, writes, auth, effects, `uses`, and `outgrewIr`") —
  adding a declared member is exactly the kind of change the Spec's
  own fold-on-acceptance discipline exists to make reviewable, and
  `ctx.sequence.allocate` extends the harness ctx surface. §4 amends
  0110, 0080, and the 0051 orbit only. Related: §3 classes
  `SNAPBACK_SEQUENCE_UNDECLARED` as a stable *authoring* diagnostic
  while §1.2.2 says an undeclared allocation "refuses at admission" —
  for imperative handler code the check can only be enforced when the
  ctx call executes (generation cannot see through the handler; that
  is the Spec's own declared-versus-proved premise), so the
  enforcement locus is runtime and the diagnostic classification and
  "at admission" wording overstate static verifiability. Fix: add the
  0108 amendment to §4 (manifest member, hash field-list extension,
  ctx surface) and restate the undeclared-allocation refusal as a
  runtime ctx-boundary refusal with the diagnostic classed
  accordingly.

### DETAIL

- **D1 — Exhaustion off-by-one.** §1.5 refuses when the next value
  "would exceed" the JavaScript-safe maximum, so an allocation
  *returning* the maximum succeeds; §5.1 expects "a counter seeded at
  the safe-integer maximum refuses." Both cannot hold. Pin whether
  `MAX_SAFE_INTEGER` is allocatable and seed the acceptance at the
  refusing state.
- **D2 — Commit-order assignment lacks a direct falsifier.** §5.1's
  "dense, strictly increasing committed history" does not name the
  ordering relation being tested. Add the direct witness: values
  sorted by their receipts' commit versions are 1..n. Without it the
  §1.3 claim is only indirectly tested.
- **D3 — §2.3's node content shape contradicts §2.4 as written.**
  "`nodes` is the tuple of each node's own visible-shape content" —
  but `BoundedChildrenRow`'s visible shape includes a per-node
  `continuation`, which the composite forbids. State that node content
  excludes per-node continuation members (composite-level
  `continuation` only).
- **D4 — "Terminal nodes are not re-read" invites a wrong reading.**
  §2.3's ordering and §2.5's per-parent point-reads imply terminal
  nodes' parents are still point-read and visibility-checked on every
  resume (they must be, for seal-entirely and the `_version` restart
  binding to hold). Say so next to the zero-examined-entries sentence.
- **D5 — The containment rule's enforcement boundary is unstated.**
  §1.7's storage rule is provable only for the allocating generated
  plan; a later operation republishing a value its caller legitimately
  read is ordinary data flow no rule here can reach, and the
  handler-tier uniqueness obligation (§1.1) is likewise
  declared-not-proved. One sentence scoping the rule to the allocating
  operation's own writes (and folding the authority half per M1 into
  OQ1's declared-versus-proved frame) closes it.
- **D6 — §1.1's eligibility enumeration is incomplete against the rule
  it cites.** 0110 §1.1 also rejects retired and independently
  authority-bearing tables; the parenthetical list omits both. Match
  the enumeration or drop it in favor of the bare citation.
- **D7 — Handler-tier concurrent-allocation conflict semantics.**
  Under buffered execution with captured-read commit validation, two
  concurrent allocators conflict on the counter row; whether that
  surfaces as serialization or as an OCC abort (and under which
  diagnostic) is unstated. Single-writer SQLite moots it and
  multi-writer is GAP'd, so delegation is fine — but say the question
  is owned by the target execution model (LLP 0003) rather than
  leaving it silent under a "serializes concurrent allocators" claim.
- **D8 — §5.1's moveCard acceptance silently presumes an
  owner-provenanced arm.** §1.9 correctly leaves the anonymous-arm
  gap (0120 OQ5) unlifted, and `write-with-activity.v1` remains
  `existing-owner.v1`-only — so the acceptance arm must authenticate.
  One clause in §5.1 keeps the acceptance congruent with §1.9.
- **D9 — Three small pins.** (a) Whether `sbsb1` binds a
  structurally-deduplicated parent once or once per node (once is
  smaller and matches dedup semantics; interacts with M3). (b) §5.2's
  acknowledgment vector says "refuses generation" where the 0113/0134
  gate is an *admission* refusal (0134 E3); name the locus, or both.
  (c) The §2.6 min-maturity coupling rule is this Spec's own addition
  (0134 does not contain it) with no enforcement locus, and the
  qualification route needs dated LLP 0113 §4 family-kind additions
  for both ids (0134 §1, OQ4) that §4 could point at.

## 5. Suggestions

- Resolve M3 and M4 together by considering bounded-children-only v1
  normative text (OQ5's smaller branch): every §5.2 acceptance shape
  is three bounded-children nodes; relational nodes could enter by
  dated revision with their binding specified, and the cursor sizing
  becomes tractable.
- For B1, the cheapest coherent shape is: the counter declaration
  names the scope table into the same registry lifecycle 0110 already
  specifies, reusing its activation/backfill/restore gates verbatim,
  with the §4.1 amendment extending 0110's "named as a bounded-children
  parent" clause — no new machinery, one clause plus a gate.
- Add a §5.1 vector for the recorded-answer/registry interplay B1
  exposes: allocation against a scope in a table with pre-existing
  unregistered rows refuses until the reviewed backfill runs.
- Consider an explicit Related/nonclaim line for LLP 0129/0133 (M2)
  even if the answer is only "out of scope, owned by row-2 admission"
  — same-wave Drafts that cross-reference in one direction only are
  where drift starts.

## 6. Open questions (for the author, beyond the Spec's own)

1. Should counter-scope enrollment reuse 0110's registry activation
   gate wholesale (reviewed backfill, restore validation, stamping
   corpus), or does a counter-only scope — no stamped children unless
   values are stored under prefixed unique constraints — justify a
   narrower activation with the stamp obligation conditional on the
   uniqueness rule's use? (B1's shape question.)
2. Should the handler tier require scope-row visibility to the
   effective subject as a structural gate (M1's option b), accepting
   that the anonymous rerun arms then need public-read scope
   declarations rather than bare invocation authority?

## 7. Verdict

**NOT READY** (round 1). One blocking concern (B1 — the
incarnation-enrollment mechanism the whole scope-identity design and
the Campfire acceptance stand on is unspecified and unamended), five
material concerns (M1 handler-tier authority overclaim; M2 the
`runtime.id` analogy against 0133's lanes; M3 the composite cursor cap
arithmetic; M4 relational nodes under-specified in the composite; M5
the missing 0108 amendment and the undeclared-allocation enforcement
locus), and nine details. Every finding is pre-empirical and fixable
by revision within the corpus — no measurement, implementation, or
author decision outside the commission is needed, and nothing here
questions the design direction, the commission fidelity of what is
mapped, or the SD-2 boundary hygiene, which passes cleanly.

## Recommended next step

Author applies a v0.2 addressing B1 and M1–M5 (B1 and M5 land mostly
in §4's drafted amendments; M2 is a nonclaim plus one qualified
sentence; M3/M4 either specify or narrow per OQ5), sweeps the details,
and requests targeted re-review of §§1.1–1.2, 1.4, 1.7, 2.2–2.5, §3,
and §4. Under LLP 0130 SD-4 the Spec can then be accepted only on
dual-family READY with zero unresolved MATERIAL concerns; this round
records six above that threshold, so convergence needs the revision
first.

---

## Round 2 — 2026-07-31

**Family:** Fable (Claude)
**Runtime:** Claude Code / claude-fable-5
**Effort:** session-inherited
**Date:** 2026-07-31
**Method:** round-2 delta — verify each round-1 Fable concern against
v0.2, then review the new v0.2 text for fresh defects; no
re-litigation of settled text; blind to the codex artifact (not
opened)
**Target:** `llp/0135-sequence-allocation-and-snapshot-batch.spec.md`
v0.2 (832 lines)
**Target SHA-256:**
`e89cc5b5a10dd60d9ae402b7ea95c47a76c13a3a4d0b823e72692ba9ed139e17`
**Status:** completed

Re-verified against the corpus for this round: LLP 0110 lines
165–203 (eligibility enumeration, admitted order types), 960–1004
(registry lifecycle, stamping boundary, `sbbc1` parameters),
1116–1120 (both-direction activation/restore validation), 1138–1148
(XChaCha20-Poly1305 construction — 24-byte nonce, 16-byte tag);
LLP 0133 v0.3 (lanes Q/L at 156/170, the three divergence classes at
422–508, element 4 "host-call answer surface" at 549–586, the receipt
privacy rule at 540–545); LLP 0129 ledger row 2 (partial-replica read
satisfiability — the local-execution admission artifact, proposed
into the move-6 owners) and rows 1–5; LLP 0051 D1 (ledger
`{version, ids: [...], now}`, no random channel, the wire-split
table); LLP 0003 lines 266–350 (buffered `ctx.db`,
drive-to-completion, brief commit with captured-read validation, lock
never held across handler execution, retry-or-reject owned there);
LLP 0007 line 120 (`_id` is host-minted UUIDv7 — id widths closed);
LLP 0113 §4 (closed `familyKind` union); LLP 0134 §5/E3
(acknowledgment refusal "at admission"), line 111 (family kinds added
by dated LLP 0113 amendment), and the §8 default-route naming of both
ids; LLP 0130 SD-4's three conditions; and a negative search for any
string-width declaration vocabulary in LLP 0007/0110/0080/0047 and
`guide/` (none exists).

### Round-1 concern resolution

- **B1 — RESOLVED.** §1.1 makes counter declaration a **second
  registration ground** in 0110's incarnation registry, restating the
  lifecycle faithfully against 0110:968–973 (same-transaction insert
  registration, inactive-on-delete, new UUIDv7 on recreate, patch
  preserves, transactional restore carry), reusing the activation
  gates verbatim ("no row is silently blessed", 0110:984;
  both-direction restore validation, 0110:1117), stating the stamp
  obligation via `relationIncarnationOf {foreignKeyField,
  parentTable}` (0110:976) for tables under prefixed unique
  constraints, and answering round-1 open question 1 with the
  conditional activation (counter-only scopes gate on
  registry-lifecycle validation alone). §4.1 now extends 0110's
  registration clause and stamping availability; §5.1 adds the
  pre-existing-rows backfill vector; §1.9/§5.1 state Campfire's rooms
  enrollment. The Campfire acceptance and the delete/recreate
  acceptance are now admissible as specified. The
  two-authorities-disagree rejection rationale is a correct addition.
- **M1 — RESOLVED.** §1.7 adopts round-1 option (b): a structural
  scope-visibility gate (declared read-or-write reach evaluated
  against the scope row at allocation time) or an explicit
  `scopeAccess: "public.v1"` declaration; bare invocation authority
  no longer reaches a non-public counter. The anonymous Campfire arm
  routes through the public declaration — exactly round-1 open
  question 2's anticipated shape. The sink matrix enumerates the
  observation surfaces, and the containment rule's enforcement
  boundary is stated honestly (allocating operation's own writes
  only; D5 folded; OQ1 extended). One residue of this same concern
  class is new — see M-B below.
- **M2 — RESOLVED.** §1.4 replaces the "exactly like `runtime.id`"
  analogy with the settlement-replay-evidence framing and states the
  two disqualifying properties correctly against 0133 v0.3: lane Q
  accepts captured `{generatedIds, now}` (0133:160–161), lane L's
  id-map leaf-rewrite is sound only for high-entropy minted strings
  (0133:462–463), and a re-derived small integer fits none of the
  three divergence classes (0133:422–508 — the id class pairs mint
  sites, not values). The 0051 D1 ledger claim ("`{ids, now}`") is
  accurate (D1: `{version, ids: [...], now}`, no random channel).
  Allocating operations are scoped out of lane-L local execution as a
  Nonclaim with OQ6 naming the successor (typed declarations,
  0133 OQ2's graduation path — the right pointer); LLP 0129/0133
  joined Related; §4.5 drafts the dated 0133 element-4 note (element
  4 verified as the host-call answer surface, 0133:554) and registers
  with 0129 row 2's owner (row 2 verified as the local-execution
  admission artifact); §4.3 pins the never-a-ledger-member
  restriction in the 0051-orbit amendment.
- **M3 — RESOLVED** (arithmetic verified), with one new concern in
  the fix's mechanism (M-A below). The shown numbers check: 8,192 −
  6 (`sbsb1.`) = 8,186 base64url chars; 8,186 = 4·2046 + 2 → 6,138 +
  1 = 6,139 decoded bytes; − 24 (nonce) − 16 (tag) = 6,099 plaintext
  bytes — and 24/16 match 0110's `sbbc1` XChaCha20-Poly1305
  construction (0110:1138). The static establishment-time budget with
  `SNAPBACK_SNAPSHOT_BATCH_CURSOR_BUDGET_EXCEEDED`, deduplicated
  parents bound once (D9a), and the closed-width enumeration —
  integer, boolean, id — is exactly complete against 0110's admitted
  order types (string, table-scoped id, safe integer, boolean;
  floats refuse, 0110:194–197), and ids are closed-width (host-minted
  UUIDv7, 0007:120). §5.2 adds the round-trip, establishment-refusal,
  and custody-ground mint-failure vectors.
- **M4 — RESOLVED.** §2.1 narrows v1 to bounded-children-only (OQ5's
  smaller branch, as round 1 suggested); the Nonclaims pin it; OQ5's
  successor enumeration carries all three round-1 holes (merged
  normalized argument binding, boundary/terminal/restart mapping
  under root-window semantics, per-consumed-root joined-lookup
  counting) plus seal semantics. §2.5's ceiling is now exact for the
  admitted node kind.
- **M5 — RESOLVED.** §4.4 drafts the LLP 0108 amendment (per-kind
  `sequences` member, dated `implementationHash` field-list extension
  with new golden vectors, `ctx.sequence.allocate` surface), and
  `SNAPBACK_SEQUENCE_UNDECLARED` is reclassified as a stable public
  **runtime** diagnostic with the ctx-boundary enforcement locus
  stated in both §1.2 and §3 — the declared-versus-proved reasoning
  round 1 asked for, verbatim in spirit.
- **D1 — RESOLVED.** Complete `next_value` transition; the maximum is
  allocatable; `next_value = 2^53` is the durable exhausted state
  (i64-representable, never returned); §5.1 seeds at MAX−1 and walks
  MAX−1 → MAX → refusal. Arithmetic consistent.
- **D2 — RESOLVED.** The direct witness (values sorted by receipts'
  commit versions are 1..n) plus the two-transaction race falsifier.
- **D3 — RESOLVED.** §2.3's node content is the cursor-free
  `{parent, children}` page; no per-node `continuation`, no `sbbc1`
  credential inside a composite result; §5.2 instruments it.
- **D4 — RESOLVED.** Every resume point-reads and visibility-checks
  every deduplicated parent, terminal nodes included; "zero examined
  entries" redefined to child-range entries; §5.2 vector added.
- **D5 — RESOLVED** (folded into §1.7's enforcement-boundary text).
- **D6 — RESOLVED.** §1.1's enumeration now matches 0110:172–174
  exactly (membership, permission-backing, protected/system,
  maintained-projection output, retired, independently
  authority-bearing).
- **D7 — RESOLVED.** §1.2 specifies the buffered read-modify-write
  protocol and delegates the contention surface and diagnostic to
  LLP 0003's target execution model — verified as 0003's own text
  (buffered `ctx.db`, brief commit, captured-read validation,
  retry-or-reject at 0003:349–350). See D-N1 for a residual tension
  in the §5.1 vector.
- **D8 — RESOLVED.** §5.1's moveCard arm is stated
  owner-provenanced, congruent with §1.9.
- **D9 — RESOLVED** in all three parts: (a) deduplicated parents
  bound once in the cursor; (b) the acknowledgment gate's locus named
  as admission (matches 0134 E3, "refused at admission", 0134:168);
  (c) the min-maturity coupling recast as a proposed LLP 0134
  prerequisite routed to 0134's own loop, with §4.6 adding the dated
  LLP 0113 §4 `familyKind` amendment (0113:426's closed union;
  0134:111's dated-amendment rule).

### New concerns (v0.2 text)

MATERIAL:

- **M-A — The string order-field width bound has no declaration
  surface, no owning amendment, and no stated enforcement — and the
  no-cliff claim depends on all three.** §2.4 requires "every string
  order field must carry a declared maximum encoded length in its
  contract, without which the composite refuses establishment." No
  such declaration exists anywhere in the corpus: LLP 0007's type
  map, LLP 0110's order-field contract, LLP 0080, LLP 0047's limit
  rows, and the guide carry no string-length declaration vocabulary
  (verified by search). §4 drafts no amendment creating it — the
  round-1 B1/M5 pattern recurring in the fix for M3: as specified,
  every string-ordered composite refuses establishment forever, and
  §5.2's "at its declared order-field bounds" round-trip vector is
  unimplementable. Worse, the budget's soundness needs the bound
  **write-enforced**, which the Spec never states: if a stored string
  may exceed its declared maximum (nothing today refuses such a
  write), a resumed boundary can exceed the computed "worst case,"
  the mint can exceed the cap mid-flight, and §2.4's "runtime mint
  failure therefore has custody grounds only / never a data-dependent
  runtime cliff" is false — the exact cliff the v0.2 fix exists to
  close. "In its contract" is also ambiguous between the field's
  schema contract and a composite-level declaration; only a
  schema-level, write-enforced bound makes the static budget a real
  bound. Fix: pin the declaration's owner and draft the amendment in
  §4 (LLP 0007's field-contract surface, or 0110's plan contract if
  scoped to order fields), state that the write boundary refuses a
  value exceeding its declared encoded length (making the worst case
  sound), and keep the establishment refusal for undeclared widths.
- **M-B — The §1.7 gate refusal is unnamed and its relationship to
  `SNAPBACK_RELATION_PARENT_UNAVAILABLE` is unspecified, which as
  written opens a scope-row existence oracle.** §1.2 assigns
  PARENT_UNAVAILABLE to missing/deleted/never-registered scopes;
  §1.7's visibility-gate refusal has no diagnostic in §3 and no
  stated precedence, and §5.1 lists the two refusals as separate
  vectors with a code named only for one — implying they are
  distinguishable. For a non-public counter, a caller with no
  declared reach can then probe `scopeId` values and distinguish
  "exists but hidden" (gate refusal) from "missing"
  (PARENT_UNAVAILABLE) — the absent-versus-invisible disclosure the
  corpus deliberately seals (0110's discipline, which §2.3 itself
  extends on the read side), reopened on the allocation path this
  Spec creates. The domains even overlap (a missing row also fails
  every declared visibility), so an implementation must guess the
  order. Fix is one sentence plus a §3 entry: for a non-public
  counter, absence and no-reach refuse indistinguishably (one code,
  with the visibility evaluation ordered before — or collapsed into —
  the incarnation check); the public-scope case may keep
  PARENT_UNAVAILABLE since the declaration already discloses
  existence semantics deliberately.

DETAIL:

- **D-N1 — §5.1's race vector overbinds the mechanism §1.2
  delegates.** The vector requires "T1's paused attempt aborted by
  captured-read validation … and its fresh re-execution allocating
  after T2," but §1.2's own normative contract is only
  currency-at-commit plus no-trace-on-failure, with the surface
  delegated to LLP 0003 — whose menu (0003:349–350) is retry **or
  reject**. A rejecting target satisfies §1.2 and fails the vector as
  written. Restate the pass condition in contract terms: T1's stale
  attempt never commits its value; every committed value is ordered
  by commit version; whether T1's caller sees a retried success or a
  typed conflict is the target's per-0003 choice.
- **D-N2 — §1.4's lane-Q "unaffected" understates the optimistic
  gap.** Lane Q's overlay is args/write-plan-derived (0133:156–159),
  and order fields are schema-required/non-null (0110:192–193): an
  offline Campfire send's optimistic message has no sequence value to
  carry or sort by, so the overlay cannot faithfully present the
  write at all — omit the field, skip the row, or degrade is
  unspecified and unowned. State the behavior or delegate it
  explicitly (LLP 0043 M2 / 0133's overlay owners) beside OQ6, and
  soften "unaffected" to name the presentation gap.
- **D-N3 — Cursor-refusal vocabulary drift.** §2.4's collapse list
  (malformed, cross-app, cross-plan, cross-authority,
  boundary-invalid) omits **cross-parent**, which §5.2's matrix
  tests; a composite cursor presented with different bound parent
  arguments should be named in §2.4's list as collapsing to
  `SNAPBACK_SNAPSHOT_BATCH_CURSOR_INVALID`.

Also checked, no concern: the SD-2 hygiene expansion in §5.2/
§Nonclaims keeps round 1's PASS — the added reasoning states the
evidence/decision boundary more explicitly without claiming any
branch; the pause-and-race, settlement-replay-evidence, and
0051-orbit texts are otherwise faithful to their cited authorities;
the header's provenance for the Fable round-1 counts is accurate.

### Verdict

**NOT READY** (round 2) — but sharply narrowed. All fifteen round-1
Fable concerns (B1, M1–M5, D1–D9) are resolved, and the resolutions
are faithful to the corpus documents they cite. Two new MATERIAL
concerns arise inside v0.2's own new mechanism — M-A (the string
width bound's missing declaration surface, owning amendment, and
write-enforcement, on which the no-cliff claim depends) and M-B (the
unnamed §1.7 refusal opening an absent-versus-hidden oracle) — plus
three details. Under LLP 0130 SD-4's zero-unresolved-MATERIAL bar the
Spec cannot converge this round, but both MATERIALs are small,
pre-empirical, and fixable within the corpus: M-A is one §4 amendment
row plus one enforcement sentence; M-B is one sentence plus a §3
entry.

### Recommended next step

Author applies a v0.3 addressing M-A (name the width-declaration
owner in §4, state write-boundary enforcement) and M-B (one
indistinguishability sentence and the diagnostic pin), sweeps
D-N1–D-N3, and requests a targeted round-3 delta of §1.7, §2.4, §3,
§4, and the two §5 vectors touched. On that revision this family
expects READY.

---

## Round 3 — 2026-07-31

**Family:** Fable (Claude)
**Runtime:** Claude Code / claude-fable-5
**Effort:** session-inherited
**Date:** 2026-07-31
**Method:** round-3 delta — verify the round-2 Fable items (M-A, M-B,
D-N1–D-N3) and the Codex-originated diagnostics narrowing against
v0.3's delta surface (§1.2, §1.4, §1.7, §2.4, §3, §4.1, and the
touched §5.1/§5.2 vectors); new text reviewed for fresh defects only;
blind to the codex artifact (not opened)
**Target:** `llp/0135-sequence-allocation-and-snapshot-batch.spec.md`
v0.3 (956 lines)
**Target SHA-256:**
`a58bc797a08238e8953e7d2fff6b5d24ba6e08cbc124450a870bb4c55b37a941`
**Status:** completed

Re-verified against the corpus for this round: LLP 0110 lines
140–204 (plan shape — the order-field list is a **per-plan**
declaration, "one non-empty ordered list of ascending child scalar
fields"; admitted order types at 194–197), 1123–1124 ("Every central
writer—plan, inline/JS buffered commit, seed, migration, import, and
restore—uses the same protected stamping boundary" — the
central-writer enumeration §4.1's enforcement claim rides on),
1148–1157 (`sbbc1` plaintext: "a closed, unknown-field-denying
record"; the 14-day age and mint-failure rule); LLP 0043 M2 lines
150–184 (the overlay is "computed from what the client *can* know:
host-plan write plans and mutation args"; "Overlay application is
all-or-nothing per changeset — 0008 pins multi-row atomicity after
Valet's half-applied-kanban bug"; drop-and-mark-failed at 178–179);
LLP 0133 lines 140–177 (lane Q's "args/write-plan-derived optimistic
overlay (LLP 0043 M2)") and 420–512 (divergence class 3 is named
**Outcome divergence**; class 1's leaf-rewrite soundness grounds);
LLP 0003 line 288 ("if the handler throws, no writes are applied and
the mutation is rejected").

### Round-2 item resolution

- **M-A — RESOLVED.** All four demands are met. The declaration
  surface exists and has an owner: §4.1 drafts the LLP 0110
  order-field-declaration `maxEncodedBytes` member (a declared UTF-8
  encoded-length maximum for string order fields). Write enforcement
  is stated with the new coded refusal
  `SNAPBACK_ORDER_FIELD_MAX_ENCODED_BYTES_EXCEEDED`, classed in §3 as
  a stable public **runtime** diagnostic (the right class for a
  write-boundary refusal), and "enforced at the write boundary by
  every central writer" is genuinely total against 0110's own
  enumeration — plan, inline/JS buffered commit, seed, migration,
  import, **and restore** (0110:1123–1124) — so the
  restore/import/migration side doors that would have let an
  oversized value in behind the bound are closed by the cited
  authority, not by hope. Reviewed adoption over pre-existing rows
  ("no row silently blessed") mirrors 0110's activation discipline.
  With the bound write-enforced, no stored boundary can exceed the
  computed worst case: §2.4's static establishment-time budget is now
  a real bound, the no-cliff claim ("runtime mint failure therefore
  has custody grounds only") holds, and §5.2's
  round-trip-at-declared-bounds vector is implementable once the
  amendment folds on acceptance. Two small residues in the fix's
  wording → D-R1, D-R2 below.
- **M-B — RESOLVED.** The oracle is closed. §1.7 pins the collapse:
  for a non-public counter, no-reach and absence refuse
  **byte-identically** with `SNAPBACK_RELATION_PARENT_UNAVAILABLE`,
  and the order of checks is stated — "the visibility evaluation is
  ordered before (and collapses into) the incarnation check" — so an
  implementation cannot accidentally sequence the registry lookup
  first and leak existence through a differing code. §1.2
  cross-references the collapse; §3 carries the single-code entry
  naming both causes byte-indistinguishable; §5.1's vector now tests
  hidden and absent causes against the **single** outcome rather than
  listing them as separately-coded refusals. Checked for residual
  distinguishers: `SNAPBACK_SEQUENCE_UNDECLARED` is a counter-name
  declaration check at the ctx boundary, disclosing nothing about
  scope rows; the public-scope case keeps PARENT_UNAVAILABLE with the
  disclosure deliberate (the declaration is the reviewable consent);
  timing stays a named nonclaim in the sink matrix, consistent with
  the corpus-wide posture (0110's absent-versus-invisible discipline
  makes no constant-time claim either). No distinguishing surface
  remains on the result path.
- **D-N1 — RESOLVED.** §5.1's race vector now binds the invariant —
  T1's stale attempt never commits its value; the committed history
  stays dense, duplicate-free, and ordered by commit version — and
  explicitly admits both LLP 0003 recovery shapes ("a fresh
  re-execution allocating after T2 or a typed conflict … either
  recovery shape passes"). The parenthetical abort mechanism
  (captured-read validation on the counter row) is no longer
  overbinding: §1.2 makes that protocol normative on both surfaces,
  and the writer-lock-never-held-across-handler-execution rule makes
  "T2 driven to commit first" realizable on every conforming target.
- **D-N2 — RESOLVED.** Verified against 0043 M2's actual text: the
  overlay is exactly "host-plan write plans and mutation args"
  (0043:160–161), so §1.4's premise is faithful, and the allocated
  value genuinely cannot exist in the overlay's inputs. The
  omission-not-fabrication posture is the only sound v1 choice — a
  sentinel would present a speculative allocated value, which §1.4
  prohibits on settlement-soundness grounds (class-3 has no typed
  mapping for copied speculative integers) — and the overlay
  lifecycle owner (0043 M2 within lane Q, LLP 0133) is correctly
  named for the successor. Coherence for Campfire checked: `send` is
  handler-tier, so lane Q's write-plan-derived overlay has no host
  plan to derive from there anyway — the pending message was already
  unpresentable pre-0135, and this Spec makes the gap explicit and
  owned rather than creating it. The message-invisible-until-
  settlement UX is a real product gap but an honestly-specified one.
  One unstated interaction with 0043's atomicity rule → D-R3.
- **D-N3 — RESOLVED.** Cross-parent appears in §2.4's collapse list
  (malformed, cross-app, cross-plan, cross-parent, cross-authority,
  boundary-invalid → `SNAPBACK_SNAPSHOT_BATCH_CURSOR_INVALID`),
  matching §5.2's cursor matrix.

### Codex-originated diagnostics narrowing (checked as directed)

**Sound, and the information-flow story survives.** The narrowed
no-trace claim (§1.2/§1.3: trace-free on durable and protocol
surfaces — counter state, stored rows, settlement, receipts,
activity, results — with handler-authored diagnostics the named
exception) is honest where the old absolute claim was not: a handler
holds the tentative integer as an ordinary value, and imperative code
can always stringify it outward. The buffering-rejection rationale
holds on both horns: buffering only sequence-bearing diagnostics is
unenforceable (a derived or stringified copy is untrackable without
dynamic taint analysis — the same declared-versus-proved reality the
Spec already concedes for the containment rule), and whole-channel
buffering until commit would blind exactly the aborted attempts
diagnostics exist to explain; the generated profile authors no
diagnostics, so the narrowing is confined to the tier that needs it.
§1.7's story stays intact because the gate runs **before** the value
exists: a handler only ever holds a tentative value for a scope its
effective subject already reached (or a declared-public scope), so
the diagnostics channel can disclose prior-allocation counts only to
parties the sink matrix already admits — no new count oracle opens,
and the matrix row makes the channel reviewable rather than hidden.
Two vector-level residues → D-R4, D-R5.

### New concerns (v0.3 text)

DETAIL (no new MATERIAL):

- **D-R1 — "Schema-level" versus the per-plan declaration surface.**
  §2.4 calls the `maxEncodedBytes` bound "schema-level and
  write-enforced," but §4.1 attaches the member to LLP 0110's
  order-field declaration, which in 0110 is **per plan** ("one
  non-empty ordered list of ascending child scalar fields",
  0110:150). Two plans ordering the same child field could then carry
  different bounds, and the write boundary needs exactly one
  authoritative bound per (table, field) for the budget to stay
  sound (enforcing only the larger while a composite computed against
  the smaller breaks the worst case). §2.4's "schema-level" is the
  controlling normative word, so the coherent reading exists on the
  page; pin it with one clause in §4.1 — the member is single-valued
  per (table, field), with conflicting declarations refusing at
  admission (or the member lives on the field contract and the order
  declaration references it).
- **D-R2 — The worst case must be computed over serialized bytes.**
  The budget subtracts nonce and tag correctly, but the plaintext is
  a closed record (0110:1150), and a bounded string's in-record
  encoding can exceed its raw UTF-8 length (escaping/framing,
  depending on the record encoding the golden vectors pin). One
  clause: establishment computes each boundary's worst case as the
  **serialized** size of a maximal value in the credential's actual
  plaintext encoding, not the raw `maxEncodedBytes` sum — otherwise
  an implementation summing declared bounds can undercount and
  reintroduce the mid-flight cliff on adversarial strings.
- **D-R3 — The omission posture's interaction with 0043 M2's
  atomicity rule is unstated.** 0043 pins "Overlay application is
  all-or-nothing per changeset" (multi-row atomicity after the
  half-applied-kanban bug, 0043:162–163). §1.4's omission is row-and-
  projection-scoped: a generated changeset writing a sequence-bearing
  activity row plus a sequence-free card patch would present the
  patch while omitting the activity row — a partially presented
  changeset, the class that atomicity rule exists to prevent. State
  which posture governs when a changeset mixes sequence-bearing and
  sequence-free writes (whole-changeset withholding is the reading
  congruent with 0043's rule), or delegate that choice explicitly to
  the named overlay owner.
- **D-R4 — §5.1's aborted-allocation vector is unimplementable as a
  single run.** The vector has the handler stringify the tentative
  value into "a console log and a thrown-error payload" **and** be
  "driven to abort by captured-read invalidation on the counter row"
  — but a handler that throws never reaches commit-time captured-read
  validation (LLP 0003:288 rejects on throw), and a handler that
  reaches captured-read validation completed without throwing. Split
  it into two arms: a console-log arm aborted by captured-read
  invalidation, and a thrown-error arm aborted by its own throw; the
  trace-free assertions apply to both.
- **D-R5 — The thrown-error payload's channel classification needs
  one pin.** §1.7 classes thrown-error payloads as handler-authored
  diagnostics, while §1.2/§5.1 keep "results" trace-free — but under
  LLP 0003:288 a handler throw rejects the mutation, and the
  rejection the submitting caller receives is, in ordinary protocol
  vocabulary, a response surface. State where the thrown payload
  rides (app-error rejection payload classed as the diagnostics
  channel, distinct from the declared result contract) so the §5.1
  assertion "results record nothing" stays falsifiable rather than
  definitional. No information-flow consequence either way: the
  submitting caller passed the §1.7 gate before the value existed.

Also checked, no concern: §1.4's Codex-D1 reframing is faithful to
LLP 0133 — class 3 is named Outcome divergence, authoritative-wins is
its rule, and the stated gap (no typed mapping for a speculative
small integer copied into later pending args; leaf rewrite sound only
for high-entropy minted strings) matches class 1's own scope-honesty
text verbatim in substance. §5.2's softened SD-2 bullet (Codex D2)
keeps the round-1 hygiene PASS: "expected consequence" is a
prediction attributed to LLP 0120's own prior record, with the
trigger and branch adjudication explicitly left to SD-2's owner — no
branch is decided here. The v0.3 Revised-header's account of both
families' round-2 counts matches this artifact.

### Verdict

**READY** (round 3). All five round-2 Fable items (M-A, M-B,
D-N1–D-N3) are resolved, and the resolutions are verified against the
authorities they cite — including the load-bearing facts that 0110's
central-writer enumeration covers restore/import/migration (making
the write-enforcement claim total) and that 0043 M2's overlay really
is write-plan-and-args-derived (making omission the only sound
posture). The Codex-originated diagnostics narrowing is sound and
keeps §1.7's information-flow story closed. Five new DETAILs
(D-R1–D-R5) are one-clause pins — no new MATERIAL concern, so under
LLP 0130 SD-4's zero-unresolved-MATERIAL bar this family's half of
the dual-READY condition is met.

### Recommended next step

Sweep D-R1–D-R5 as an editorial pass (D-R1/D-R2 belong in §4.1/§2.4,
D-R3 in §1.4, D-R4/D-R5 in §5.1/§1.7); none requires re-review by
this family. Convergence then rests on the Codex family's round-3
verdict per SD-4.
