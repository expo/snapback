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
