# Review: LLP 0131 — Structured argument contracts (round 1, Fable family)

**Family:** Fable (Claude)
**Runtime:** Claude Code / claude-fable-5
**Effort:** session-inherited
**Date:** 2026-07-31
**Method:** fresh non-author context, blind to this Spec's codex artifact.
Provenance note for honesty: after this review's code verification was
substantially complete, a mid-task coordinator note relayed that the codex
round-1 review had reached NOT READY on overlapping identity-section
grounds. Concerns C1, C2 (consumers 2–4), C3, and C4 below were found
independently before that note; the note prompted the check that produced
C2 consumer 1 (the `implementationHash` feed), which was then verified
directly against code. The codex artifact itself was not read.
**Target:** `llp/0131-structured-argument-contracts.spec.md` (387 lines)
**Target SHA-256:** `e78bb47e953ae35cd5cd9c059870f1ddbe94bd93f72bfac36966247d137b6726`
**Status:** completed

Reviewed against: LLP 0115 v0.7 (CV-4a/CV-5 exits, §Governing constraints,
OQ1, OQ8 registry), LLP 0117 v0.3 (§Option A, §CV-5, findings 3–9,
§Confidence, OQ1–3), LLP 0108 (§vocabulary/bounds at lines 290–381,
redaction at 405, replay at 422), LLP 0004 (2026-07-30 dated pointer,
lines 600–631), LLP 0073 (§Rust-owned artifacts and operation carrier,
version-binding rule at 332–335, OQ11/OQ12), LLP 0130 (SD-1, SD-4, ER-2),
LLP 0070 (enqueue at 91–106, state machine), LLP 0008 (§Mutation Replay),
issues/20260730-move1-structured-args-and-search-ast.md, plus code
spot-checks listed in the verification log.

## Overall assessment

The architecture is sound and commission-faithful: the one-grammar merge,
the platform-only `SchemaRef` with delegation-to-owning-parser, the
ingress seam's replay/enqueue postures, and the search fixture's
single-generator design all survive scrutiny, and the Spec's scope
discipline against its exclusion list (option E, CV-4b, strictness,
CV-16/17) is exact. But the §Identity and hashing section rests on two
false code claims — the witness is not computed over the lossy descriptor,
and the hash has real semantic consumers the Spec says do not exist,
including a feed into `implementationHash` that falsifies the section's
own "untouched identities" sentence. The re-key conclusion likely
survives a corrected analysis, but a Spec's identity section must state
the code facts correctly and design the migration it actually implies.
Two further material gaps: the CV-5 acceptance corpus drops introspection
(named in the commissioned exit), and the seam's interaction with LLP
0073's stable search diagnostics is left contradictory. NOT READY, with a
clear v0.2 path; no evidence-boundary weakening found anywhere.

## Verification log (raw data)

Code cites verified accurate on current main:

- `packages/snapback-codegen/index.mjs:3300` (recursive gate), map at
  3309–3315 (closed primitive map: string/boolean/number/unknown/object
  with String/Principal/Boolean/Integer/Real/Json fieldTypes plus
  Id/RelationIncarnation escape); applied to args at 1242, legacy result
  at 1251, schema fields at 681, ephemeral at 2607/2614.
- `index.mjs:3354–3373`: `argDescriptors`/`validatorDescriptor` emit only
  `shape`/`name`(`fields`)/`optional` — the descriptor projection is
  bounds-blind as claimed.
- `index.mjs:1942`: `fn.argsContractHash = argsContractHash(def?.args ??
  {})` — computed over the **raw authored validator objects**, NOT the
  descriptor (see C1). `result-contracts.mjs:38–43`: domain prefix
  `snapback:function-args:v1`, canonicalJson = sorted-key stringify.
- Raw validator shape (`define.mjs:168–284`): `{__validator, fieldType,
  primitive, optional}` plus `resultOptions` carrying authored bounds
  (`v.string({maxBytes})` at 173–181, `v.integer({min,max})` at 203–211)
  and internal metadata `resultKind`/`resultOnly` (array 263–274, union
  276–284; `resultOnly` also on finiteReal 228, null 239, literal 249).
  `resultOnly` has zero readers repo-wide (grep confirmed) — finding-3
  claim holds.
- `src/manifest.rs:1546–1565`: format gate only (sha256 hex shape check)
  — the Rust half of the no-consumer claim is true; grep of `src/` finds
  no other `args_contract_hash` consumer beyond serde carry.
- `index.mjs:2072`: `binding.argsHash = fn.argsContractHash` (carrier).
- **`index.mjs:4156–4189`: `implementationIdentity` includes
  `argsContractHash` (line 4170) and is hashed into `implementationHash`
  (4187–4189, domain `snapback:function-implementation:v1`)** — C2.
- **`packages/snapback-client/index.mjs:147–172`:
  `SEARCH_REQUEST_ARGS_CONTRACT_HASH_V1` hard-coded digest, compared at
  167 (`ref.argsContractHash !== …` throws); carries an @ref to LLP 0073
  §rust-owned-artifacts-and-operation-carrier calling the digest "the
  runtime discriminator that keeps client.search off arbitrary query
  refs"** — C2.
- **`packages/snapback-client/react-binding.mjs:125–133`:
  `exactDeploymentFunction` joins id/kind/implementationHash/
  argsContractHash/resultContractHash; equality-compared at 248 and
  1095** — C2.
- **`packages/snapback-client/canonical-client-value.mjs:218–250`:
  `canonicalReactStoreKeyV1` embeds argsContractHash and
  implementationHash in every client store key** — C2.
- `src/search/sqlite.rs:1616–1638`: profile check, then the serde parse
  at 1625 with `map_err(|_| …)` — fail-closed, path-blind, discards the
  serde error; out-of-range `limit` refuses at 1631–1636 with
  `SNAPBACK_SEARCH_QUERY_INVALID` "search limit must be in 1..50" (C4).
- `src/server.rs:5882`: `MAX_LIVE_SOCKET_FRAME_BYTES = 64 * 1_024`.
- `src/handler_wire.rs:93–96`: `args_json` pre-serialized JSON text.
- `src/value_expr.rs:121–128`: `ValueExpr::Arg` path lookup yields
  whatever JSON sits at the path; `ValueExpr::Args` clones the whole
  object — reference-shape claim verified.
- `src/result_contract.rs:15–17`: 4 MiB / 65,536 nodes / depth 16.
- `define.mjs:773–781`: `defineSearchQuery` args exactly
  `{query: v.json(), limit: v.optional(v.integer({min:1,max:50})),
  after: v.optional(v.string({maxBytes:2_048}))}`.
- `index.mjs:5899–5908` codegen-emitted search interfaces;
  `packages/snapback-client/index.d.mts:145–167` independently
  hand-authored duplicates; `src/search/types.rs:183–213` Rust owner,
  `JsonSchema` derived, `deny_unknown_fields` on the structs (the
  `SearchClauseV1`/`SearchMatchAtomV1` enums use default external
  tagging).
- Ephemeral refusal code is `EPHEMERAL_INVALID_VALIDATOR`
  (index.mjs:2608, 2615), not the two codes §Unchanged positions lists
  (m2).
- LLP 0108 bounds enumeration matches the Spec exactly (lines 290–297,
  371–381: depth 16, 128 fields per contract, 8 variants + syntactic
  disjointness at 325–327/349, 1,024 items, 1 MiB per string/JSON value,
  omitted-bounds-take-maxima, narrow-only); redaction ("never include
  the rejected value", 405) and replay-under-original-expected-tuple
  (422) match the Spec's postures. Note 0108:377–380 routes finite-real
  canonicalization to LLP 0007 (m1).
- LLP 0073: version-binding rule verified at 332–335; OQ12 verified Open
  (lines 904–911), tracked as CV-5; `SNAPBACK_SEARCH_QUERY_INVALID`
  listed among stable application diagnostics (lines 204–208).
- LLP 0004 pointer section (600–631) verified: two scope facts (arguments
  first + ingress seam + IR interaction; stored fields separate) — both
  correctly absorbed; Appendix A succeeds it without editing 0004 and
  gates on acceptance with a dated landing. Faithful.
- LLP 0070:91–96 verified: enqueue validation/insertion transactional
  with the mutation; rollback-schedules-nothing. The Spec's
  enqueue-time-here/execution-time-0070 split (OQ5 as interface) is
  consistent with 0070's ownership.
- Commissioning ticket verified: exclusions honored; CV-4a exit covered
  verbatim by acceptance 1–2; CV-5 exit coverage has the C3 gap; OQ12
  deferral to 0073's frame is consistent with "CV-5 lands in LLP 0073's
  frame," with the m4 landing-plan gap.
- 0117 v0.3 evidence base used faithfully (findings 3/4, §CV-5's
  witness-not-carrier, OQ1–3); note 0117's own "no runtime consumer"
  wording (§Confidence, "unconsumed… identity witness") scoped narrower
  than the Spec's generalization — the Spec strengthened an inherited
  claim without re-verifying it (C2).

## Strengths

- **The one-grammar answer is right and was stress-tested.** I searched
  for a node that validates at an argument position but cannot round-trip
  the wire/receipt path and found none: strict JSON ingress kills the
  non-finite case (and the Spec's real/finiteReal unification is exactly
  correct, including for host-originated enqueue args where the 0108
  post-image rule maps non-finite to null and fails both spellings
  identically); union disjointness, optional-absence, literal, and JSON
  budgets inherit 0108's already-adversarially-covered semantics; the
  host-plan interaction is correctly scoped to operator semantics with
  reference shape verifiably unchanged. Per the Spec's OQ1 challenge
  protocol: this reviewer has no node to name for exclusion.
- **SchemaRef holds the single-authority property.** Closed platform
  registry, no `v.*` builder emits it, validation delegates to the owning
  parser's deserialization rather than respelling the grammar, hash by
  reference id with artifact bytes gated by the drift test — each choice
  is individually argued and the composition leaves exactly one grammar
  authority. Option E is genuinely open: nothing in v1 depends on OQ2,
  and the machinery is reusable under either placement.
- **The ingress seam's replay and scheduling postures are sound.**
  Fresh-invocation-only validation mirrors 0108's replay identity
  correctly (re-validating history against a newer contract is indeed a
  different and wrong claim); LLP 0008 offline outbox replays arrive as
  fresh server mutation requests and are uniformly validated, consistent
  with 0008's drop-on-refusal semantics without needing a special case;
  enqueue-time validation composes with 0070's transactional enqueue
  (refusal ⇒ no job, per 0070:93), and execution-time revalidation is
  correctly ceded to 0070 as a recorded interface.
- **Honest evidence framing throughout the runtime section.** The
  "evidence addition" claim is code-true (the only server-side args
  check on main is search's path-blind serde parse); acceptance 3
  ("demonstrably does not occur on current main") is the right
  falsifiable form; the never-echo diagnostic rule matches 0108
  redaction; the degraded-args severity is explicitly not decided,
  respecting CV-6/SD-1's frame; the 64 KiB transport bound is disclosed
  rather than papered over.
- **Scope discipline.** Every exclusion in the commissioning ticket is
  respected, and everything the Spec does decide (one grammar, platform
  SchemaRef, capability id, re-key, ceiling proposal) is a question 0115
  OQ8/the ticket routed to this Spec's loop. No boundary weakening found;
  ER-2 is not implicated.

## Concerns

**C1 (MATERIAL — false code claim at the heart of the identity
section).** §The argument-contract descriptor and §Identity state the
witness "is computed over that lossy form" (the bounds-blind
shape/name/optional descriptor) and rationalize the re-key with "the v1
descriptor drops all bounds, so a hash-stable extension would leave the
witness blind to exactly the facts this Spec makes contractual." Code
reality: `index.mjs:1942` hashes `def?.args` — the raw authored builder
objects — which **do** carry authored bounds (`resultOptions.maxBytes`,
`min`/`max`; the search fixture's own pinned digest has `min:1, max:50,
maxBytes:2048` in its preimage) plus internal metadata (`fieldType`,
`resultKind`, `resultOnly`). The carried manifest descriptor and the
hashed form are *different objects today*: nothing could recompute the
witness from the manifest. So (a) the stated rationale is unsound as
written, and (b) the *stronger, true* rationale goes unstated: the
current witness is over an unstable internal spelling — the Spec's own
mandated deletion of dead `resultOnly` metadata would silently churn v1
hashes for every function using `v.finiteReal()` args — which is itself a
compelling reason to re-key onto a canonical descriptor. The conclusion
survives; the factual basis must be rewritten from code.

**C2 (MATERIAL — the no-semantic-consumer claim is false and the re-key
cascade is undesigned).** §Identity: "the hash currently has no semantic
consumer — the Rust host format-gates it … and the provider binding
carries it …, but nothing recomputes or compares it. Every function's
`argsContractHash` therefore changes once, visibly, at adoption — a diff,
not a behavior change." Four verified consumers falsify this:

  1. **`implementationHash` incorporates it** (index.mjs:4170 inside
     `implementationIdentity`, hashed at 4187–4189). The section's own
     "Untouched identities: `resultContractHash` and
     `implementationHash` are unaffected" is therefore false as designed
     — the v2 re-key changes every function's `implementationHash`
     unless the Spec also redesigns implementation identity. That hash
     has its own downstream custody (deployment equality, fixtures,
     receipts).
  2. **`client.search()` hard-pins the v1 digest**
     (snapback-client/index.mjs:147, compared at 167, throwing a plain
     TypeError). Hit twice: by the re-key and by CV-5's own
     `v.json()`→`SchemaRef` descriptor change. The Spec cites the
     adjacent typings file (index.d.mts:145) as a carrier but never
     names this runtime discriminator. Required: the pin becomes a
     generated/regenerated artifact rather than hand-kept; a lockstep
     snapback-client release; and a stated version-skew posture (today's
     failure mode for old-client + v2 artifacts is an uncoded TypeError
     bricking search).
  3. **React deployment-identity equality** (react-binding.mjs:125–133,
     compared at 248/1095): mixed-generation manifest/reference pairs
     refuse across the v1→v2 boundary. Fail-closed and arguably
     desirable — but it is a behavior, not "a diff," and deserves one
     sentence.
  4. **Client store keys** (canonical-client-value.mjs:225–235): every
     keyed/persisted client entry rotates at adoption.

  The section needs a complete consumer inventory, a migration statement
  per consumer, and an acceptance bullet covering the cascade (e.g. the
  comparator fixture at
  packages/snapback-cli/fixtures/comparator/…/api.mjs pins six v1
  hashes that all regenerate). Note the claim's provenance: 0117 said
  "no *runtime* consumer" (Rust-scoped, true); the Spec widened it to
  "no semantic consumer" without re-verifying — the analysis-layer
  discipline (§Commission: "nothing below re-derives what that document
  verified") does not cover claims the Spec strengthens.

**C3 (MATERIAL — acceptance drops introspection from the CV-5 corpus).**
The commissioned exit (0115 CV-5, quoted verbatim by the ticket):
"accepted/rejected AST fixtures agree across **all carriers**," with
0115's Work naming them: "Rust deserialization, the exported schema,
**introspection**, and generated client types." Spec §fixture point 4 and
acceptance 5 run the corpus against Rust deserialization, the exported
schema, codegen-emitted types, and client-package typings — the provider
projection (which per §Carriers embeds the expansion *by value*, a copy
that can drift) and the per-operation args JSON Schema are checked only
for no-`unknown`, never corpus-validated. An embedding bug would pass
this acceptance while violating the quoted exit. Add both carriers to
the corpus (the JSON-Schema validation leg already exists for the
exported artifact; pointing it at the embedded copies is cheap).

**C4 (MATERIAL — seam vs. LLP 0073's stable search diagnostics).**
§Runtime ingress has the seam validate search invocations' full declared
args and refuse with `SNAPBACK_FUNCTION_ARGS_CONTRACT_VIOLATION`;
§Diagnostics says `SNAPBACK_SEARCH_QUERY_INVALID` is the "unchanged
public code for search grammar refusals." These collide on search's
scalar args: today an out-of-range `limit` refuses with
`SNAPBACK_SEARCH_QUERY_INVALID` (sqlite.rs:1631–1636); under the seam,
`v.integer({min:1,max:50})` intercepts first with the new code — changing
a diagnostic LLP 0073 lists as stable — unless the seam special-cases
search functions (unstated). The code mapping for `SchemaRef` delegation
failures is likewise only inferable. State the precedence rule (proposed
shape: SchemaRef-delegated failures surface under the owning parser's
public code with the added path; scalar-arg refusals on search functions
either keep the legacy code explicitly or the 0073 diagnostic-stability
consequence is named and accepted), and add the expected codes to the
acceptance tests.

**m1 (minor).** §Canonicalization's domain parenthetical ("sorted keys
over strings, booleans, and safe integers") is wrong for the grammar the
Spec itself admits: `v.finiteReal({min,max})` bounds and real-valued
`v.literal` put finite reals in the descriptor domain; 0108 (377–380)
explicitly routes finite-real canonicalization to LLP 0007. Since the
sentence already defers to 0108's rule, fix or drop the parenthetical.

**m2 (minor).** §Unchanged positions lists the ephemeral lane's refusal
codes as `SCHEMA_INVALID_VALIDATOR`/`FUNCTION_INVALID_VALIDATOR`;
ephemeral scope/value shapes actually refuse with
`EPHEMERAL_INVALID_VALIDATOR` (index.mjs:2608, 2615). Also, `resultOnly`
rides five builders (array, union, finiteReal, null, literal), not the
two cited lines; the deletion mandate should name the full set.

**m3 (minor).** "Refusal precedes every effect: no handler bytes
execute…" is written for the direct lanes; in the scheduled-work enqueue
lane the *enclosing* mutation's handler has already executed, and the
refusal's meaning is 0070's transactional no-job-exists (plus the
enclosing transaction's fate). One per-lane sentence fixes the
overbreadth.

**m4 (minor).** The ticket routes CV-5's landing to LLP 0073's frame
with LLP 0037 as carrier-alignment co-owner, and OQ12 is "resolved
there" — but unlike Appendix A for 0004, the Spec proposes no dated
0073/0037 amendment text and no statement of when that recording lands.
Name the landing plan so the 0073-frame half of the commission is not
orphaned.

**m5 (observation, rides OQ3).** The disclosed 64 KiB live-socket frame
cap means per-transport effective args ceilings diverge: a contract
admitting up to 1 MiB works over HTTP but cannot bind over the live
socket, failing with a transport error rather than the args-contract
code. Consider a codegen advisory when a live-query function's maximum
declared args payload exceeds the frame budget; at minimum the OQ3
adjudication should name the divergence.

## Suggestions

- Rewrite §Identity from code: state that today's witness hashes the raw
  authored builder objects (bounds included, internal metadata included)
  while the manifest carries a different, bounds-blind descriptor; ground
  the re-key in witness-recomputability and spelling-stability, which is
  both true and stronger than the current rationale.
- Decide C2's `implementationHash` question explicitly — either accept
  the cascade (and say "every implementationHash also changes once") or
  drop `argsContractHash` from `implementationIdentity` in the same
  landing, arguing why implementation identity should not depend on the
  args witness's domain version.
- Make the client search pin a generated constant emitted from the same
  descriptor pipeline, with a conformance test asserting it equals the
  codegen-computed hash of `defineSearchQuery`'s contract.
- Add an acceptance bullet: mixed-generation behavior at the v1→v2
  boundary (old client reference vs. new manifest) refuses with a coded
  diagnostic, not an uncoded TypeError.

## Open questions

For the loop, answering the Spec's own OQ1–3 from this review's
verification: (1) one grammar — endorsed; no excludable node found under
the Spec's challenge protocol. (2) Option E as a dated v2 section of
this Spec — no objection; nothing in v1 was found to depend on it.
(3) The 1 MiB ceiling is plausible but the adjudication should absorb
m5's per-transport divergence and a measured hot-mutation-path budget as
the Spec already proposes; the capability-id half (`args_contract_v1`)
is well-formed and correctly patterned on `result_contract_v1`.

## Verdict

**NOT READY.** The design architecture — one grammar, platform-only
SchemaRef, the ingress seam's postures, the fixture mechanism — survives
exhaustive pre-empirical scrutiny, and scope/commission fidelity is
otherwise exact. But §Identity and hashing contains genuine defects, not
polish items: a false statement of what the current witness hashes (C1),
a false no-semantic-consumer claim whose four verified consumers include
a feed that falsifies the section's own "implementationHash …
unaffected" sentence (C2), and the migration design those facts demand
does not exist yet. C3 is a fidelity gap against the verbatim
commissioned exit; C4 is an internal contradiction touching a diagnostic
LLP 0073 declares stable. All are resolvable without disturbing the
architecture.

## Recommended next step

Author revises to v0.2: rewrite §Identity from code reality (C1), add
the consumer inventory + cascade/migration design + acceptance coverage
(C2), add introspection and the operation args schema to the corpus and
acceptance 5 (C3), state the search diagnostic precedence rule and its
0073 consequence (C4), and sweep m1–m4. Then a round-2 delta review; on
dual-family READY with zero unresolved MATERIALs, LLP 0130 SD-4's
standing acceptance applies.

## Round 2 — 2026-07-31

**Family:** Fable (Claude)
**Runtime:** Claude Code / claude-fable-5
**Effort:** session-inherited
**Date:** 2026-07-31
**Method:** round-2 delta review — verify each round-1 Fable concern
genuinely resolved in v0.2, then review the new v0.2 text for fresh
defects; settled text not re-litigated. Codex artifact still unread.
**Target:** `llp/0131-structured-argument-contracts.spec.md` v0.2 (733 lines)
**Target SHA-256:** `0463e0be0122b599ed2b5454eb2c6bf69963ad378e318face88699962930360a`
**Status:** completed

Note on the code baseline: current main moved since round 1 — commit
`4d72c407` (same-file helper sharing, LLP 0118) shifted
`packages/snapback-codegen/index.mjs` by ~14 lines, and client commits
(`3a7a980a`, `b444db73`, `00f1f218`) landed. Every identity-section code
fact was therefore re-verified from scratch on current main rather than
trusted from round 1.

### Round-2 verification log (raw data)

- `index.mjs:1956` (spec cites 1942): `fn.argsContractHash =
  argsContractHash(def?.args ?? {})` — raw-builder preimage claim still
  true. `define.mjs` `resultOnly` at exactly the five cited lines
  (228, 239, 249, 273, 282) — cite exact.
- `index.mjs:4183–4213`: `implementationIdentity` includes
  `argsContractHash` (4205; spec cites 4170), hashed at 4222–4224 (spec
  cites 4187–4189) — cascade item 1's factual basis holds. New wrinkle:
  the domain is now `snapback:function-implementation:${v1|v2}` (v2 when
  inline helpers exist, LLP 0118) — does not affect the claim.
- **`src/manifest.rs:1566–1594` (new v0.2 cite) verified exact:** the
  host recomputes `result_contract_hash(contract)` from the carried
  contract and exact-compares, refusing
  `SNAPBACK_FUNCTION_CONTRACT_HASH_INVALID` — the recompute-decision's
  precedent claim is code-true, including the paired
  contract-without-hash refusal and the capability check
  (`result_contract_v1`, 1595–1609) the capability posture mirrors.
- `snapback-client/index.mjs:147/167`, `react-binding.mjs:125–133,
  248, 1095`, `canonical-client-value.mjs:232–233` — all four cascade
  consumers still at (or within) the spec's cited lines after the
  client commits.
- **`SNAPBACK_REACT_REFERENCE_INVALID` exists today**
  (react-binding.mjs:1090, 1098, 1106, 1130); the mixed-generation
  mismatch path (`exactDeploymentFunction` inequality at 1095) already
  throws it at 1098 — cascade item 3 names a real existing code, and
  acceptance 11's react half is satisfiable on current code.
  `SNAPBACK_SEARCH_REFERENCE_INVALID` has zero occurrences repo-wide —
  correctly marked "new" in the diagnostics table.
- **Settlement-identity claim verified true:** `ClientMutationIdentity`
  = client mutation id, function name, auth fingerprint, authority
  instance id, input fingerprint (`src/storage.rs:663–680`), and
  `mutation_input_fingerprint` hashes args/readSet/ctxLedger only
  (storage.rs:14908–14921). No `argsContractHash`, no
  `implementationHash` — "retained-settlement identity does not
  incorporate the args witness in v1" is true directly, not merely
  transitively, and replay lane 2 is generation-insensitive server-side.
- **Store-key cold-start posture verified honest:**
  `canonicalReactStoreKeyV1` call sites are
  `packages/snapback-react/index.mjs:689, 1656`; the react store and
  `pendingMutations` (snapback-react/index.mjs:644) are in-memory
  session state — no durable v1-keyed store exists on main to leak.
- **Degraded-introspection claim verified:** v.json() projects as
  `{shape:'unknown'}` (index.mjs:3379); `renderObjectFields` routes
  every args field through `renderDataType`
  (provider-introspection.mjs:675–681), whose shape-unknown branch
  emits warning-severity `PROVIDER_INTROSPECTION_RESULT_TYPE_DEGRADED`
  (619–627) — "a declared v.json() argument included" is code-true.
- Search fixture cites: `define.mjs:778` (`query: v.json()`) exact;
  `src/search/types.rs:183–213` exact (enums external-tagged, structs
  `deny_unknown_fields`); `index.d.mts:145` exact;
  codegen-emitted `SearchQueryAstV1`/`SearchRequestV1` now at
  index.mjs:5942–5943 (spec cites 5899–5908). `sqlite.rs:1616–1638`
  exact including the limit refusal at 1631–1637.
- `server.rs:5882`, `handler_wire.rs:93–96`, `result_contract.rs:15–17`,
  `value_expr.rs:121–128` — all exact. `src/schema_export.rs` and
  `tests/artifact_schemas_v0.rs` exist; `full_text_search_v1` is a real
  manifest capability (manifest.rs:5256).
- Result-side object fields are entry-shaped (`ResultObjectFieldContract`)
  — the normalization rule's "optionality is a field-entry property,
  mirroring the result contract" is consistent with the code.
- Id structural validation is non-empty-string only
  (result_contract.rs:104–108); generated TS brands ids
  (`Id<Table> = string & {__snapbackIdTable}` at index.mjs:5932);
  incarnation values are freshly minted UUIDv7 tokens
  (storage.rs:13972) with `primitive:'string'` +
  `fieldType.RelationIncarnation` validators (define.mjs:199) — inputs
  to N3 below.

### Round-1 concern resolution

**C1 — RESOLVED.** §Identity's "Code baseline" now states exactly the
verified facts: the witness hashes the raw authored builder objects
(`def?.args`) whose preimage carries authored bounds and internal
metadata, while the manifest carries the bounds-blind
shape/name/optional descriptor; unrecomputability and the
resultOnly-deletion churn are now the stated grounds. §One argument
grammar names all five `resultOnly` builders with exact lines. This is
the true, stronger rationale round 1 asked for, and every sentence of it
re-verified against current main.

**C2 — RESOLVED.** The four-consumer inventory is complete, accurate,
and normative. Item 1 decides the `implementationHash` question
explicitly (keep the feed; every implementationHash rotates once;
fixtures regenerate; acceptance 11) and the "untouched identities"
sentence is corrected with the v0.1 error named. Item 2 makes the search
pin generated with a lockstep client release and a new coded skew
refusal (verified not yet existing — honestly marked new). Item 3
correctly calls the react refusal a behavior and names the code that
already backs it. Item 4's cold-start posture matches the in-memory
reality. The settlement-identity boundary claim was verified true in
code. Round 1's four suggestion bullets are all absorbed.

**C3 — RESOLVED.** Fixture point 4 and acceptance 5 now corpus-validate
the expansions embedded by value in the provider projection and the
per-operation args JSON Schema ("an embedded copy that drifts is a
corpus failure, not merely a no-`unknown` finding") — the introspection
carrier the commissioned CV-5 exit names is covered, alongside Rust
deserialization, the exported schema, codegen-emitted types, and the
client typings.

**C4 — RESOLVED.** The precedence rule is decided and node-scoped:
`PlatformSchemaRef` refusals surface under the owning parser's stable
code with the added pointer (delegation rule = diagnostic rule);
every non-reference node uses the generic code, search scalars
included. The 0073-stability consequence is named, accepted, routed
through the dated Appendix B amendment that lands only at acceptance
(0073 unedited until then; OQ12 stays Open there), and pinned in
acceptance 13. Internally consistent and honestly routed; rejecting a
function-classed special case is the right call for a Spec whose
purpose is removing special cases.

**m1 — swept.** §Canonicalization now routes finite reals to LLP 0007
via 0108's routing with LLP 0051 covering the remainder, and acceptance
7 freezes golden vectors on exactly the sensitive cases.
**m2 — swept.** `EPHEMERAL_INVALID_VALIDATOR` named with correct
(round-1-era) lines; all five `resultOnly` builders enumerated.
**m3 — swept.** Per-lane refusal wording: invocation lanes vs. the
narrower-by-construction enqueue lane, with 0070's transactional
no-job-exists meaning.
**m4 — swept.** Appendix B carries the dated 0073 amendment text with
0037 as co-owner and an explicit landing trigger.
**m5 — absorbed.** OQ3 records the 64 KiB per-transport divergence and
proposes the codegen advisory.

### New concerns (v0.2 text)

**N1 (minor — stale line cites).** The spec landed after commit
`4d72c407` shifted `packages/snapback-codegen/index.mjs` by ~14 lines,
so its codegen cites are stale on the tree it landed on: 1942→1956,
1242→~1253, 2608/2615→2622/2629, 3300/3309→3314/3323–3329,
3354–3373→3368–3387, 4170→4205, 4187–4189→4222–4224,
5899–5908→5942–5943. Every underlying fact re-verified true — this is
cite hygiene, not substance. Sweep in the next touch.

**N2 (minor — untestable load-time refusal clause).** §descriptor and
§Identity refuse at manifest load when "a registry entry whose exported
artifact and runtime validator disagree." Both registry halves derive
from one Rust type (the schemars-generated artifact and the serde
parser), so at load time the disagreement is either impossible by
construction or requires an unstated mechanism (e.g., the registry pins
the committed artifact digest and load compares it against a
regenerated schema digest). As written the clause names a refusal no
specified check can produce, and acceptance 7's tampered-manifest
negatives cover unknown-id but not this case. State the mechanism or
narrow the refusal to what load can actually observe (unknown id,
descriptor/hash mismatch), leaving artifact/validator agreement to the
CI drift gate that actually owns it.

**N3 (minor — relation-incarnation normalization is semantically
imprecise).** "Relation incarnations emit their underlying `id(table)`
node" is ambiguous (which table?) and, on the natural reading
(`parentTable`), wrong about the value domain: incarnation values are
freshly minted UUIDv7 tokens (`storage.rs:13972`), not parentTable row
ids. Runtime-harmless in v1 (id validation is non-empty-string,
result_contract.rs:104–108) — but generated TS brands ids
(`Id<Table>`, index.mjs:5932), so if v2 arg projections brand id nodes,
incarnation args acquire a false referent type: a genuine parent row id
would typecheck and be semantically wrong, while a held incarnation
string would not typecheck. The normalization also makes
`v.id(parent)` and an incarnation witness-identical. One-sentence fix:
normalize incarnations to the string node (or a dedicated alias),
or pin the arg projection unbranded and state the witness collision as
accepted.

**N4 (observation).** The diagnostics table omits
`SNAPBACK_REACT_REFERENCE_INVALID` even though acceptance 11 pins it
and the table lists other unchanged codes. One row ("client, existing,
unchanged — named by acceptance 11") would make the table complete.

**N5 (observation).** `implementationIdentity` now carries a format
version (`v1`/`v2` with inline helpers, LLP 0118, landed between
rounds). Cascade item 1 is unaffected, but the regeneration event in
acceptance 11 will span both formats; no text change required.

**N6 (observation, forward-looking).** If LLP 0008's offline outbox
ever becomes durable across app upgrades while embedding generated
references, cascade item 3's "partial adoption is not a supported
state" meets a temporal mixed state at the re-key boundary. Verified
harmless today: no durable client mutation queue exists on main, and
the server-side settlement identity carries no contract hashes, so
lane-1/lane-2 replay is generation-insensitive where it counts. Worth
one sentence whenever the durable queue lands, owned there.

### Verdict

**READY.** All four round-1 MATERIALs are genuinely resolved — each fix
was re-verified against current main rather than taken on faith, and
the two claims round 1 flagged as false are now stated correctly and
carry the migration design they imply. The new v0.2 text (recompute
decision, normalization rules, consumer cascade, `PlatformSchemaRef`
authority enum, three-lane replay taxonomy, acceptance 7–13) survives
code-grounded scrutiny with zero new false claims found; the residual
items are three minors and three observations, none material under the
round-1 severity ladder. Under LLP 0130 SD-4, this family's half of the
dual-READY condition is met with no unresolved MATERIALs.

### Recommended next step

Sweep N1–N3 in a v0.3 touch (N2 and N3 are normative-rule precision
fixes and should land before implementation; N1 is cite hygiene), leave
N4–N6 to author discretion, and proceed per SD-4 on the other family's
round-2 outcome. The loop should still adjudicate open questions 1–3
before implementation starts, as the Status section already requires.

## Round 3 — 2026-07-31 (fix verification)

**Family:** Fable (Claude)
**Runtime:** Claude Code / claude-fable-5
**Effort:** session-inherited
**Date:** 2026-07-31
**Method:** round-3 fix-verification — verify the three round-2 minors
(N1–N3) genuinely resolved in v0.3 and sanity-skim the other v0.3
changes for damage to previously verified-clean text; not a full round.
Codex artifact still unread.
**Target:** `llp/0131-structured-argument-contracts.spec.md` v0.3 (931 lines)
**Target SHA-256:** `8cf3170c12e6867f86eb7715dd3df344de2aa77d8782d253378346ef27c84a98`
**Status:** completed

Baseline note: HEAD at verification time is `afffd6e1` — the v0.3
landing commit itself — with a clean tree, and
`packages/snapback-codegen/index.mjs` unmoved since `4d72c407` (the
commit whose shift caused round-2 N1). Two `packages/snapback-client`
commits landed between round 2 and v0.3 (`2a7bf058` LLP 0129 Phase 0
durable outbox + default rqsStore persistence; `fb03e65a`), which both
the N1 check and the cascade sanity-skim below account for.

### Round-3 verification log (raw data)

- **N1 spot-check 1:** index.mjs:1956 = `fn.argsContractHash =
  argsContractHash(def?.args ?? {})` — exact.
- **N1 spot-check 2:** gate function at index.mjs:3314, primitive map
  at 3323–3329 (`'number' → {'Integer','Real'}` at 3326, backing the
  v0.3 finiteReal-reachability narrowing), descriptor projection at
  3368–3387 (`shape`/`name`/`fields`/`optional` only) — all exact.
- **N1 spot-check 3:** `argsContractHash` inside
  `implementationIdentity` at index.mjs:4205; hashed at 4222–4224
  under `snapback:function-implementation:${implementationFormatVersion}`
  — exact (the v1/v2 format version confirms round-2 N5; cascade item
  1 unaffected).
- N1 extras, all exact: index.mjs:1253 (args gate application),
  2622/2629 (`EPHEMERAL_INVALID_VALIDATOR`), 5932 (`Id<Table>`
  branding), 5942–5943 (search interfaces); define.mjs:778
  (`query: v.json()`), `resultOnly` at exactly 228/239/249/273/282;
  result-contracts.mjs:40 (`snapback:function-args:v1` domain);
  manifest.rs:1546–1565 (format gate), 1566–1580 (pairing refusal),
  1581–1594 (recompute + exact-compare,
  `SNAPBACK_FUNCTION_CONTRACT_HASH_INVALID`);
  react-binding.mjs:125–133 / 248 / 1095 / 1090–1098;
  canonical-client-value.mjs:225–235 (argsContractHash at 233);
  tests/artifact_schemas_v0.rs exists.
- **N1 residual found:** cascade item 2's client cites are stale on
  the very tree v0.3 landed on — `SEARCH_REQUEST_ARGS_CONTRACT_HASH_V1`
  now sits at snapback-client/index.mjs:167 (spec: 147) and the
  comparison at 187 (spec: 167), shifted by the pre-v0.3 client
  commits. Constant, digest, and comparison semantics unchanged —
  cite hygiene only, but the Revised-header claim "every stale code
  cite is refreshed against current main" overreaches by this one
  pair. Also sub-minor: the result-side witness formula sits at LLP
  0108:380–381, one line off the spec's `0108:381–382` cite; the
  formula itself (RFC 8785 JCS + `snapback:function-result:v1` domain
  prefix) verified verbatim, so the v2 args formula is genuinely
  parallel.
- **N3 grounds:** `src/storage.rs:13972` =
  `let incarnation = Uuid::now_v7().to_string();` (host-minted UUIDv7,
  predecessor incarnations deactivated in the same transaction) —
  exact. `v.relationIncarnationOf` builds a `'string'`-primitive
  validator (define.mjs ~199), so today's projection is
  `{shape: 'primitive', name: 'string'}` via validatorDescriptor
  (index.mjs:3383) — the spec's "matches both today's projection and
  today's runtime reality" is code-true on both halves.
- **Wire-form grounds:** manifest.rs:2957–3000 = the internally tagged
  camelCase `deny_unknown_fields` `ResultValueContract` enum; the
  spec's closed node table matches it member-for-member (string
  maxBytes; integer/finiteReal min/max; id table; literal value; json
  maxDepth/maxBytes; array element/maxItems; union variants; object
  fields/allowExtra). manifest.rs:3004–3008 =
  `ResultObjectFieldContract { name, required, value }` — the frozen
  entry shape mirrors it exactly, grounding the optional→required
  correction.
- **Appendix C grounds (LLP 0070):** "canonical, validator-checked
  argument bytes and their digest" (0070:75), immutable jobs with
  operator replay creating a successor (0070:23–24; "Arguments are
  immutable; migration creates a successor," 0070:247), successor only
  through authenticated authorization admission (0070:124–131) — the
  lane-3 rule and Appendix C compose with 0070's existing model
  faithfully.
- **Post-round-2 ground shift checked:** the LLP 0129 Phase 0 durable
  outbox stores `{id, function: name, args, userId, readSet,
  correlation, authorityDescriptor, environment}`
  (outbox-shared.mjs:60–80) — no generated references, no contract
  hashes — so a drained intent is exactly replay lane 1's fresh
  server mutation request and the mixed-generation-reference hazard
  round-2 N6 conditioned on did not materialize.
  `canonicalReactStoreKeyV1` call sites remain only the in-memory
  react store (snapback-react/index.mjs:689, 1656); no persisted
  client surface (rqsStore, outbox) embeds
  argsContractHash/implementationHash (grep clean). Cascade items 3–4
  hold on current main despite the persistence landing.

### Per-item verification

**N1 — VERIFIED, with one residual pair.** All three commissioned
spot-checks (1956; 3314/3323; 4205/4222–4224) and every other
refreshed codegen/Rust cite are exact on the v0.3 landing tree. The
one miss is client-side: the search-pin pair (spec 147/167, actual
167/187 after the pre-v0.3 client commits), plus the one-line-off 0108
formula cite. Same class as round-2 N1 — facts intact, hygiene only —
and it does not gate.

**N2 — RESOLVED.** The unexecutable load-time registry-pair refusal is
explicitly withdrawn, with the withdrawal honestly recorded twice
("withdrawn as unexecutable" in §descriptor; again in the Status v0.3
note), and the reasoning is correct: both registry halves derive from
one Rust type, so pair disagreement is not a load-time-observable
fact. The replacement is the executable shape round 2 asked for:
generation-time gate leg (a) byte-identical regeneration through the
existing drift lane (tests/artifact_schemas_v0.rs, exists) and leg (b)
the shared golden corpus run against both halves, with acceptance 6
making both legs falsifiable via tamper negatives and naming itself
"the executable meaning of registry-pair disagreement." Load time now
refuses exactly what load can observe (unknown id; descriptor/hash
mismatch — §Identity, acceptance 7). The epistemics are right:
agreement is framed as corpus-defined, not totality-proven. Sound and
honest.

**N3 — RESOLVED.** Normalization corrected to the `string` node with
the profile-maximum bound; both stated grounds verified in code
(UUIDv7 mint at storage.rs:13972; `Id<Table>` branding hazard at
index.mjs:5932 — a branded `id(parentTable)` projection would
type-admit a semantically wrong parent row id while rejecting a held
token). The v0.2 error is named rather than papered over ("which v0.2
wrongly implied"). The witness collision (`v.string()` ≡ incarnation)
is stated in-spec as an accepted consequence with ownership correctly
routed to the relation machinery (LLP 0110), and acceptance 7 requires
the golden asserting the collision as identical. The dedicated-node
alternative is deferred to v2 with the right rationale (new vocabulary
= its own hash churn). This fully resolves the round-2 semantic
concern.

### Sanity-skim of the other v0.3 changes

No damage found to previously verified-clean text.

- **Frozen wire form:** node table member-for-member against
  `ResultValueContract` (verified above); entry shape mirrors
  `ResultObjectFieldContract` exactly; the optional→required change is
  flagged as a deliberate v0.2 correction, not slipped in silently;
  the JCS witness formula parallels 0108's verified result-side
  formula; always-materialized bounds mirror the Rust side's
  non-optional members.
- **Per-direction skew:** v0.2's both-directions-coded claim is
  explicitly withdrawn as impossible — correct, since a shipped pre-v2
  client is immutable code — and the surviving guarantee is stated
  only in the direction new code can promise, with the lockstep rule
  carrying the legacy direction's mitigation and acceptance 11 pinning
  the coded direction while recording the uncoded mode as
  documentation. Honest and sound.
- **Successor-replay decision (OQ5 closed, Appendix C, acceptance
  14):** composes faithfully with LLP 0070's verified model (canonical
  validator-checked bytes at enqueue, immutable args,
  migration-creates-successor, successor admission recheck); the
  enqueue-authoritative rule is lane 2's history posture applied
  consistently; the amendment is routed dated-at-acceptance without
  editing 0070 now. Sound.
- **OQ3 closure:** preregistered numeric gates with a pro-rata budget,
  ceiling-reduction fallback floored at the 64 KiB live-frame cap, and
  the validation short-circuit rejected for exactly the right reason;
  the per-transport divergence recorded per round-2 m5.
- **N4 absorbed:** the diagnostics table now carries the
  `SNAPBACK_REACT_REFERENCE_INVALID` row (cites verified exact).
- **Ground-shift robustness (beyond the letter of this round):** LLP
  0129 Phase 0's durable outbox and default rqsStore persistence
  landed before v0.3; verified above that no persisted record embeds
  the hashes the cascade reasons about, so replay lane 1, cascade item
  3's partial-adoption rule, and cascade item 4's cache-identity
  posture all remain code-true on current main.

### Verdict

**READY.** All three round-2 minors are genuinely resolved — N2 and
N3, the two normative-rule items, by sound and honestly recorded
decisions whose stated code grounds were re-verified against the
landing tree, and N1 by a refresh that is exact everywhere it was
commissioned to be checked. The sanity-skim found the remaining v0.3
changes clean and, where they decide (skew direction, successor
replay, OQ3 numbers), correctly reasoned. Residuals: the stale client
search-pin cite pair (167/187) and the one-line 0108 formula cite —
sub-minor hygiene for the next touch, not gates. This family's half of
the LLP 0130 SD-4 dual-READY condition stands at round 3 with zero
unresolved concerns above cite hygiene.

### Recommended next step

Fix the client search-pin cite pair (snapback-client/index.mjs 147/167
→ 167/187) in the next touch of the document — no re-review needed —
and proceed per SD-4 on the Codex round-3 outcome. The loop still
adjudicates open questions 1–2 before implementation starts, as the
Status section requires.
