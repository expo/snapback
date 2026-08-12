# Round 2 delta review: LLPs 0235–0241

## Provenance

- Reviewer: Codex GPT-5.6-sol xhigh, reviewer B
- Review mode: fresh skeptical-implementer delta review; author-directed single-family adaptation of `llp-super-refine`
- Date: 2026-08-12
- Review input: sealed capsule `/tmp/snapback-llp-super-refine-r2-min.2KGrDu`
- Independence: only the sealed capsule and `REVIEWER_B.md` were read; no live target, sibling review artifact, or orchestration note was inspected
- Instructions-excluded capsule SHA-256 (supplied): `235147b6fdbc5963734808c3fce9c35886d032e0603efe3377fb6b9646135507`
- Target SHA-256 vector (supplied and independently verified):
  - LLP 0235: `2d3118645c67aec72f7b8d2b560789d73bbeacaaf7dcca85f612f15f31025ab6`
  - LLP 0236: `14ab7278154814b715fea8b78e1897789b158187db6c54221aa722453cb58247`
  - LLP 0237: `ef0e8553807c7e90d6f4ab078273527602d91127df20bd8dc84c8478fd381d11`
  - LLP 0238: `06658688843b51c2a34e824e7dbd9bcb85c870002ed86fca0b735afdd28d875b`
  - LLP 0239: `9f28cbaed244cdaf8d16ed448fc656e6055b5f512b67c724a0797c03b6375dfe`
  - LLP 0240: `0f79e2cfb522541ace43b54103c637d9862fc3f8c431f6b1550671bc9481d3e1`
  - LLP 0241: `78d23b0a9b6244c94f6e44e013017ec718e8211550fcd525b3081cdbd9f0dffc`

The review applies the supplied rule that a MATERIAL finding requires two plausible implementations to diverge on material public, durable-state, identity, authority, failure, or rollback semantics. Every MATERIAL below is classified exactly `IN-DELTA` or `PRE-EXISTING`.

## LLP 0235: Bounded handler modules

### Summary

The RFC now defines an implementable bounded ESM custody profile rather than merely permitting helper imports. Literal relative edges, re-export and cycle refusals, stable snapshot reads, closed top-level initialization, capability rescanning, graph bounds, target conformance, and fail-closed candidate replacement form a coherent admission boundary. D4 is deliberately conservative: normalized graph edges and final executable bytes are identity inputs, while comments, spans, source maps, and local paths are evidence. D6 also prevents profile selection from becoming an ambient CLI fact that rollback cannot reconstruct.

### MATERIAL

None.

### MINOR

- The implementation Spec should make imported constant ordering and the pure-helper allowlist part of the same golden-vector corpus as helper-call edges. D2 already requires a versioned closed grammar, so this is implementation precision rather than an unresolved semantic choice.
- D4's evidence-only relocation exception is necessarily rare because normalized root-relative graph targets are semantic inputs. A diagnostic that prints the exact changed graph record would make that conservative rule easier to understand.

### Author questions

None blocking.

VERDICT: READY

## LLP 0236: Explicit client lifecycles

### Summary

The explicit reference kinds, `read`/`watch`/`dispatch`/`mutation`/`run`/`start` verbs, observable-handle grammar, in-place refresh contract, canonical argument keys, and current-principal projection give the client arms a strong common vocabulary. The decision not to invent an underspecified one-shot React cache is especially clean. One part of the claimed durable mutation-state closure, however, conflicts with the inherited owner and is not yet a derivable public state machine.

### MATERIAL

#### M-0236-1 — `IN-DELTA`: durable mutation observation invents post-acknowledgement and predecessor-authority states without defining their custody or information-flow contract

**Evidence.** D2 says `mutation(id)` observes “LLP 0218's complete mutation-disposition union,” then requires an unknown id, a predecessor-authority id, a quarantined/stranded record, a collected result, and an acknowledged record to be distinct typed states. LLP 0218's complete union is `pending | settled | failed | stranded | quarantined | resultGone | unknown`; it explicitly defines `unknown` to include an ACK-consumed and collected record, and its payload-free acknowledgement releases the successor fence. LLP 0236 neither amends that transition nor defines a durable acknowledged tombstone, retention horizon, garbage-collection rule, or wire/local-only status. It also says lookup is scoped to the current user and authority instance while exposing a predecessor-authority match as distinct, despite the inherited synchronous user-switch fence.

**Consequence.** Two plausible implementations materially diverge. One can preserve LLP 0218 and report `unknown` after acknowledgement/collection and for a record outside the current authority partition. Another can persist new acknowledged and authority-mismatch tombstones across relaunch and expose them through the public handle. They differ in durable bytes, collection/fence release, what a successor principal can learn about predecessor records, and whether callers may infer a known prior outcome rather than “no current durable record.” This is not just a TypeScript spelling choice.

**Repair.** Freeze one exact facade disposition table. Either align it to LLP 0218—mapping ACK-consumed/collected and out-of-partition ids to `unknown` at the public boundary while retaining existing internal cleanup diagnostics—or explicitly amend LLP 0218 with the new durable tombstone states, their transition sources, authority-redaction rule, retention/GC horizon, relaunch behavior, and successor-fence consequences. If an authority-mismatch diagnostic is useful, specify whether it is developer inspection only rather than a caller-visible existence oracle.

### MINOR

- The D2 example unconditionally evaluates `dispatched.clientMutationId`, but LLP 0218 guarantees that field only on the `queued` branch. Branch the example or state that this RFC intentionally adds the id to the settled branch.
- D3's initial microtask notification and serialized later notifications are clear; the generated lifecycle table should also pin whether multiple state changes before delivery coalesce, because test adapters will otherwise differ while remaining semantically safe.

### Author questions

1. Is `acknowledged` intended as a new durable LLP 0218 state, or should an acknowledged-and-collected id be `unknown` as LLP 0218 currently specifies?
2. Is predecessor-authority recognition public, developer-only, or redacted to `unknown` after the synchronous authority fence?

VERDICT: NOT READY

## LLP 0237: Asset collections and the media field

### Summary

The revision closes the most important ownership question. `MediaCommandBindingV1` is callback-free and installed into the target mutation manifest; the ordinary mutation host validates it, invokes the authored mutation once, and stages collection rows, attachment changes, and grants in the same transaction. Command-only mutation admission prevents a direct attachment-skipping path. Mutation-attempt-derived item plans, non-reused item ids, retry reuse, ambiguity, cancellation, and residue provenance preserve LLP 0180's task semantics while extending them to multiple assets. Authority-profile sharing remains generation-refused until both independent halves qualify, avoiding an activation cycle.

### MATERIAL

None.

### MINOR

- D3's phase sketch uses `validating`, `uploading`, and terminal `committed`, while inherited LLP 0180 uses snapshot states such as `preparing`, `transferring`, and `succeeded` with outcome `committed`. State whether the media command exposes a renamed specialization or merely maps those inherited states in presentation metadata.
- The deterministic item-id acceptance vectors should include hash collision refusal for ordinary append/replace, not only migration. The mutation-attempt derivation already supplies the intended identity semantics.

### Author questions

1. Are the D3 phase names normative `TaskHandle.snapshot()` discriminants or explanatory aliases over LLP 0180's existing task snapshot?

VERDICT: READY

## LLP 0238: Application authority profiles

### Summary

The authority profile is now a strict facade over the LLP 0056 membership machine and LLP 0231 policy IR, not a second roster or evaluator. V1 selects app-table ownership, requires the true uniqueness and reverse-holder indexes, uses the inherited central writer-class seam, and freezes a real owner/transfer/last-holder state machine. Read, write, invalidation, search, and asset consumers share one profile identity. Custom authorization has two honest lanes: enforced input completeness with precise invalidation, or online-only coarse-global reauthorization with no pushdown or retention claim.

### MATERIAL

None.

### MINOR

- D4's coarse lane says “every relevant application/authorization change.” The emitted IR should name the exact conservative event universe and target wake capability so an implementer cannot narrow “relevant” from observation. The required refusal when even that wake is unavailable already establishes the safety rule.
- The generated `transferOwner` diagnostics should name self-transfer and ineligible/pending targets explicitly; the inherited final-state invariant already makes either unsafe transition refuse.

### Author questions

None blocking.

VERDICT: READY

## LLP 0239: Semantic artifact generations

### Summary

The five identities, unique immutable generation address, fixed per-consumer disposition reduction, atomic server-owned pointer, exact durable-generation fences, and bounded predecessor residency are the right pieces. Graph identity agrees with LLP 0235, evidence-only cuts remain uniquely addressable, and activation is correctly described as the conjunction of consumer dispositions rather than the displayed maximum. The remaining problem is that the document gives two materially different orders for global activation and per-custodian drain failure.

### MATERIAL

#### M-0239-1 — `IN-DELTA`: the global pointer can move before the drain decision that D5 says prevents pointer movement

**Evidence.** D4's dev sequence has the server activate the complete generation, settle readiness, and only then move the current-generation pointer. D5 says first-party custodians “observe the pointer/served generation fact” and stage the successor. Yet D5 also says that if owners or bytes cannot drain within the limits, automatic activation is abandoned, current resumes admissions, the candidate becomes `restart-required`, and “There is no pointer swap.” The final D5 paragraph instead says that when reload cannot occur safely the consumer stops accepting new work. No candidate-notification/prepare acknowledgement protocol connects the per-consumer drain result to the server activation and pointer CAS.

**Consequence.** Two main-honest implementations diverge materially. A pre-activation two-phase implementation can stage and drain every required first-party custodian, keep the global predecessor current on any failure, and resume predecessor admissions. A pointer-driven implementation necessarily lets the server and pointer advance before some custodians discover they cannot drain; those custodians must remain stale and stop admitting work until restart. The difference affects which generation is authoritative, whether old clients continue serving, rollback behavior, stale request refusals, and the truth of “no pointer swap.” Crashes between prepare and commit make the missing choice observable even if the happy path is fast.

**Repair.** Choose and specify one protocol. The semantics suggested by the stronger D5 claims require a distinct candidate fact, a generated set of required consumer acknowledgements, per-consumer staged/drain-ready or restart-required responses, and a server activation/pointer CAS only after all hot-activation prerequisites settle. Define timeout/crash behavior before commit and stale-consumer behavior after the commit point. Alternatively, explicitly choose post-pointer best effort, remove the no-pointer-swap/resume-predecessor claim, and require failed custodians to stop until controlled restart. In either design, reconcile “current resumes admissions” with “consumer stops accepting new work.”

### MINOR

- D1/D2 should pin the ordinary self-reference exclusion for `bundleId`, `integrity.json`, and `generation.json` in canonical hash vectors. The content-addressed intent is clear, but the root manifest cannot hash a byte representation containing its own final root without an explicit normalized omission.
- D4 can clarify whether an evidence-only pointer update mints a new readiness receipt digest over the new `generationId` while retaining the semantic/readiness nonce, or carries a prior receipt as compatible evidence.

### Author questions

1. Must every required first-party custodian acknowledge staging/drain readiness before server activation and the pointer CAS, or is temporary post-pointer `stale-consumer` an accepted state?
2. On a drain timeout, does that custodian resume the predecessor or stop admissions? D5 currently says both.

VERDICT: NOT READY

## LLP 0240: Bounded query composition

### Summary

The common-snapshot composite witness, exact-or-sealed aggregate contract, shallow algebra, capability separation, and feed frontier cursor substantially improve implementability and honesty. In particular, the feed now refills the winning scope until it can prove the global next item, charges rejected reads to `maxExamined`, and seals instead of returning a short or misordered page. The scope-source ceiling itself, however, does not say how the executor proves that the admitted scope set is complete.

### MATERIAL

#### M-0240-1 — `IN-DELTA`: a feed with more than 256 visible scopes can either truncate silently or refuse, and the RFC does not choose

**Evidence.** D5's example gives the scope query `take: 256`; the v1 limit says “at most 256 admitted scopes after authorization”; the executor then opens “every visible scope's” frontier and claims an exact bounded top-k. The cursor binds the scope-set generation and a frontier/exhausted witness for every admitted scope. There is no rule requiring the scope source to prove exhaustion at or before 256, probe the 257th visible scope, rely on a declared cardinality invariant, or return a sealed scope-limit refusal. The general no-silent-full-scan and exactness constraints do not determine which of those public outcomes is intended.

**Consequence.** One plausible implementation treats the first 256 rows from the bounded scope query as the feed universe and returns a complete-looking page that can omit a globally higher-ranked item from scope 257. Another reads/proves exhaustion and returns a typed refusal when the user follows or belongs to too many scopes. Their result rows, completeness witness, continuation behavior, and failure contract materially differ. A cursor that faithfully records all 256 admitted frontiers does not repair an incomplete scope universe.

**Repair.** Require one same-snapshot scope-completeness proof before item merge: either a schema/policy invariant proving cardinality `<= 256`, or a bounded 257th-visible-scope probe that returns a sealed `SNAPBACK_PROJECTION_FEED_SCOPE_LIMIT` with no partial rows. Specify how authorization-hidden scopes avoid influencing that outcome and whether scope-enumeration work is included in `maxExamined` or a separate declared bound. Bind the complete scope witness—not merely the truncated set—to the cursor.

### MINOR

- D4 should explicitly say whether activity sources require authorization pushdown completeness, or which sealed work-limit outcome applies when a residual visibility policy would require refill. The global constraints rule out leakage and unbounded work, but the aggregate/feed sections make this admission rule much easier to implement consistently.
- The 64-KiB feed cursor floor should have a worst-case vector using maximum-length admitted order keys and 256 scopes; otherwise a capability can advertise the floor yet deterministically return cursor-size overflow for a legal plan.

### Author questions

1. Is the intended feed scope contract “exactly the first declared 256 scopes” or “all visible scopes, refusing if there are more than 256”? The current exact-top-k language implies the latter.

VERDICT: NOT READY

## LLP 0241: Policy-aware protected retention

### Summary

The RFC is now a narrow extension of the existing LLP 0053/0043 query-instance and lease carrier. Eligibility is generated-plan-only; the descriptor binds exact result, authority, exclusion, store, lease, and generation facts; client custody validation does not overclaim server-MAC verification; exclusion occurs before durable storage; real stores are partitioned and bounded; and reconnect must reauthorize and fresh-snapshot before `current` release. The global authorization epoch remains a conservative v1 invalidator only for the closed authorization-event class, while data-plane matcher obligations stay distinct. The rollout keeps capability false until each real carrier and supported authority plan qualifies.

### MATERIAL

None.

### MINOR

- D5's phrase “opaque encrypted/controlled record” could be read as an at-rest encryption guarantee even though the RFC correctly says encryption is not the policy mechanism and does not commission a new key-distribution design. Tie that adjective to an advertised carrier capability or use “opaque carrier-controlled record.”
- Physical-backup eligibility should be a named carrier capability with a tested rollback-high-water restoration contract; the text already refuses best-effort logical restore, so this is manifest precision.

### Author questions

None blocking.

VERDICT: READY

## Set-level consistency

The set is directionally coherent and the implementation sequence avoids the claimed cross-capability activation cycles:

- LLP 0235 can ship closed handler admission and preflight without LLP 0239 automatic generation reload; LLP 0239 later enrolls its identities.
- LLP 0237's media field/collection/command can qualify independently, while authority-profile sharing remains generation-refused until LLP 0238 also qualifies.
- LLP 0238's roster and policy profile does not depend on media, query composition, or retention activation.
- LLP 0240's generated plans can ship online before LLP 0241; LLP 0241 keeps protected retention false until a generated plan and strict owner/membership authority profile have full carrier proof.
- Authority/profile, collection/sharing, query-plan, retention, and executable identities all enter LLP 0239's semantic cut, and incompatible durable records retain exact generation fences.

The three blockers are independent but set-relevant:

1. LLP 0236 must align or explicitly extend the durable mutation-disposition owner before generated lifecycle tables can be authoritative.
2. LLP 0239 must choose a pre- or post-pointer custodian coordination protocol before its “atomic generation” and restart behavior can be implemented honestly.
3. LLP 0240 must prove or refuse scope-set overflow before the feed can claim exact global top-k and complete cursor custody.

No MATERIAL concern found in this round is classified `PRE-EXISTING`; all three arise in semantics the claimed Round 2 delta says it froze.

SET VERDICT: NOT READY
