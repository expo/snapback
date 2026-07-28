# LLP 0101 review — Fable family

## Round 1 — 2026-07-27

**Reviewer family:** Claude Fable  
**Provider / runtime:** Anthropic Claude Code 2.1.220,
`claude-fable-5`  
**Effort:** max  
**Date:** 2026-07-27  
**Redacted:** no  
**Method:** fresh CLI runner, read-only tools, mutually blind structurally
isolated capsule  
**Target SHA-256:** `59c1501196eeda374f4e3fdebbdc9717862791c42fe668a0b5ac3109af627ab4`  
**Capsule SHA-256:** `684a72ddc8a0ba153000b66349473dc1f26cdbaed7044ff2fef1d805cc4eebd6`  
**Instruction SHA-256:** `ed91ccf3c9830b01aa80e0af057a8fea4bd56d9a0b4bc0123b7f7052117ec2ef`  
**Status:** unavailable — provider HTTP 429 before a review was delivered  
**Session ID:** `78741b8c-e66c-4bd3-b615-cb48c5dbb612`  
**Duration:** 671,684 ms  
**Failure:** the provider reported that the account reached its monthly spend
limit. This is not a review or verdict and does not count toward convergence.

## Round 2 — 2026-07-27

**Reviewer family:** Claude Fable  
**Provider / runtime:** Anthropic Claude Code 2.1.220,
`claude-fable-5` on the approved M4 Mac mini fleet lane  
**Effort:** max  
**Date:** 2026-07-27  
**Redacted:** no  
**Method:** fresh remote CLI runner, read-only tools, mutually blind
structurally isolated capsule; delta-round instructions  
**Target SHA-256:** `412e4e2b53efc137d72d09b77fd0404f86f3fec10c9e196840430b01c41bcda1`  
**Capsule SHA-256:** `33f647eda6d95d3f487543422683e20817ce5a0e21730bcf63893120a6a96489`  
**Instruction SHA-256:** `ea678662e24a6ec47b4247efbd43267164803202d97fda39e7b9efbbf0083871`  
**Status:** completed  
**Session ID:** `c73dd0bd-7ced-495c-816d-fdc405543ae6`  
**Duration:** 997,843 ms  
**Cost:** $18.744192

I've now reviewed the target against the governing corpus (0004, 0009, 0010, 0012, 0031, 0037, 0043, 0051, 0055, 0064, 0065, 0074, plus 0093/0094/0095), the codegen (`packages/snapback-codegen/define.mjs`, `index.mjs`), the runtime (`src/runtime.rs`, `src/warm_vm.rs`, `packages/snapback-harness/ctx-bootstrap.js`), the manifest/custody layer (`src/manifest.rs`), the wire contract, and the sibling program tickets. Here is the review.

---

# Review — LLP 0101 (super-refine round 2)

## 1. Overall assessment

This revision is a large, genuine improvement over what the ticket record implies round 1 contained. The three-graph separation (original source / marker-bearing definition-evaluation graph / handler-only runtime graph) is now closed, finite, and compatible with the LLP 0010 isolated-evaluator architecture: the marker is extractor-keyed strict JSON, so executable source never crosses the definition evaluator's JSON boundary; the resolver, side-effect grammar, and bounds (64 files / depth 16 / 512 KiB source / 256 KiB bundle) are explicit and implementable; the warm-VM paragraph now states exactly LLP 0009's DK-4 posture (host-owned slot reset + epoch fencing, explicit lexical-residue nonclaim, actions/hosted stay fresh) rather than overclaiming. Source custody matches LLP 0031 D3 as shipped (`PublicFunctionManifest` drops `IbexModule.source` and `sourceSpan`; spans live only in local/gated custody). The retained-replay design (content-addressed normalized validators, original-tuple release without rerun, tuple-independent acknowledgement GC) composes correctly with LLP 0043's settlement caps and refuse-don't-evict rule. The structural (non-nominal) reading of `Documents`/`Document` is honest about what JSON can prove.

However, the revision still contains a small number of contradictions with the implementation it pins and unstated consequences of its own new mechanisms — chiefly: the post-JSON-image section misdescribes the existing serializer's treatment of non-finite numbers and non-plain prototypes; the per-operation runtime graph silently defeats DK-4's warm-VM pool as bounded today; the new wire carrier is introduced without reconciling the wire-governance authorities (0093/0094/0095); exact-tuple equality on every lane has an unanalyzed availability blast radius for the native-client consumer class the spec itself lists as Related; and the legacy query-row contract's enforcement semantics are not pinned enough to honor the "exact legacy compatibility" claim. All are resolvable with bounded text changes; none require architectural rework.

## 2. Strengths

- **The handler-only transform is now a real, closed design.** Marker forgery is answered (extractor-owned table, `SNAPBACK_INLINE_HANDLER_MARKER_INVALID`), the pure top-level initializer grammar refuses the bundler-folklore escape hatches (`new`, computed properties, expression statements, "tree-shakeable" effects), the final capability rescan runs on bundled bytes, and parse-vs-attested-reread and case-fold refusals match LLP 0010's fd-attestation discipline. Failed generation leaves the previous complete artifact graph untouched, per the no-silent-drops rule.
- **The warm-VM paragraph is exactly right.** It distinguishes host-owned reset/fencing from the trusted-local application-lexical-residue nonclaim, matches DK-4 as-built (including "stale continuations cannot exercise a successor context" — refusal, not prevention), and forbids imported modules from silently strengthening any isolation claim.
- **Post-image validation is the correct locus** (validate the strict JSON image, validator invokes no application code), and the root-`undefined` → `null` claim is verified against the implementation (`ctx-bootstrap.js:1114` explicitly maps root `undefined` to `null`; `parse_handler_output` maps a missing `value` to `Null`).
- **Replay identity is coherent end to end**: pre-commit mutation validation at the commit seam (not post-commit transport), original normalized validator materialized and content-addressed so replay never consults the successor schema, `SNAPBACK_MUTATION_RESULT_CONTRACT_STALE` never reinterprets or reruns, and acknowledgement-driven eviction closes the immortal-settlement hole consistently with LLP 0043's caps and admin purge.
- **Custody and identity separation is clean**: stable operation id (`{appId}:{exportedName}`, LLP 0004 ENG-24905) stays the authorization identity; `implementationHash` is compatibility only; consent/grants stay on the stable id (LLP 0055); public artifacts carry digests and capability facts, never source/spans/dependency paths; the public sentinel is absence, not a redacted basename.
- **Honest degradation is preserved**: omitted results are explicit `unknown` with a counted, source-linked diagnostic; the Contract witness refuses lossy bindings as explicit GAPs rather than forking the Exact-owned descriptor schema — consistent with the capability-honesty regime and LLP 0034's seam ownership.
- **The capability gate on the carrier is the right mechanism** for LLP 0094's open `HandlerInput`/live-subscribe decoders (a new client-sent member gated by capability proof, exactly LLP 0093 D1's rule), and refusing a target that lacks it rather than silently dropping identity is the correct fail posture.

## 3. Concerns

**C1 — MATERIAL. The post-JSON-image section contradicts the serializer it pins (non-finite numbers, non-plain prototypes).**
Evidence: the spec pins "the strict JSON image after the existing evaluator serializer" and then asserts "Cycles, non-finite numbers, unsupported prototypes, or other values that cannot cross that boundary fail serialization before validation." The existing serializer is plain `JSON.stringify` semantics via the single-sourced settle wrapper (`packages/snapback-harness/ctx-bootstrap.js:1114`, shared by both engine legs per LLP 0048): `NaN`/`Infinity` serialize as `null` (they cross, they do not fail), and non-plain-prototype values cross as their enumerable image (a `Map` crosses as `{}`; a class instance crosses as its own properties). Only cycles and root-level unserializable values (`function`/`symbol` → `SNAPBACK_HANDLER_RESULT_INVALID`) fail. Two of the three named examples are therefore wrong against the named serializer, and the "identical across Hermes, V8, IR, and hosted evaluators" corpus cannot satisfy both sentences.
Resolution criteria: either (a) restate the rule to match the serializer — non-finite numbers arrive as JSON `null` and fail the numeric contract kind as actual-kind `null` (and continue to pass under `unknown`, today's behavior), non-plain prototypes arrive as their JSON image and fail structurally — or (b) explicitly specify a strict-serialization extension of the settle wrapper as a behavior change, including its effect on `unknown`-contract operations, and drop the "existing serializer" attribution.

**C2 — MATERIAL. Per-operation runtime graphs silently defeat the DK-4 warm-VM pool as bounded today.**
Evidence: the transformed runtime graph "exports exactly one handler registration," so N inline operations produce N distinct bundle texts. LLP 0009 keys warm VMs by exact module source text and bounds the pool at 4 VMs per instance, with the recorded rationale "the common case is one bundle shared by all functions, so 1–2 live VMs"; beyond-bound check-ins destroy the VM. An inline-form app with more than 4 operations therefore thrashes the pool on the mutation and live fan-out paths and repays fresh-VM cost (~3.9 ms, the "single biggest compute lever," LLP 0035/DK-4) — a regression the legacy shared-`handlers.mjs` form does not have. The spec never mentions the pool interaction. This is a defect newly visible from this round's closed per-operation graph design.
Resolution criteria: the spec states the intended policy — e.g., per-graph pooling with a revised bound/keying (with the LLP 0009 amendment named), grouped bundling of co-resident operations, or an explicitly accepted cost with a DK-4/LLP 0035 bench re-run obligation — so implementation does not discover this in production.

**C3 — MATERIAL. The new wire surface is not reconciled with the wire-governance authorities (LLP 0093/0094/0095).**
Evidence: `ExpectedOperationV1` rides `HandlerInput` and the live subscribe/resume bodies — open decoders whose evolution rule (capability proof / fallback / new token, plus closure-matrix recording) is owned by LLP 0094 §0C, with new refusal codes owned by §0E's registry and client conformance fixtures owned by LLP 0095. The spec's Related list (line 15) and its semantic-acceptance sentence ("this Spec and the governing LLP 0004/0009/0010/0012/0031/0037/0043 contracts to agree…") omit 0093/0094/0095 entirely; the §0E registration of `SNAPBACK_OPERATION_IMPLEMENTATION_STALE`/`SNAPBACK_MUTATION_RESULT_CONTRACT_STALE`, the §0C rows, and 0095 fixture coverage are not named as required amendments; and the advertisement surface for the `expected_operation_v1` capability (capability manifest, connection grant, `/inspect`) is unspecified. The gating mechanism itself complies with LLP 0093 D1 — the gap is governance and discoverability, not design.
Resolution criteria: add 0093/0094/0095 to Related and to the acceptance agreement list; name the closure-matrix/refusal-registry/conformance-fixture amendments as landing with the wire change; name where the capability is advertised.

**C4 — MATERIAL. Exact-tuple equality on every lane has an unanalyzed deploy-compatibility blast radius for long-lived clients.**
Evidence: `implementationHash` changes on any handler byte, dependency, toolchain, or admission-profile change, and the server refuses any tuple mismatch on every lane; the only relief is a rolling window of "explicitly listed predecessor/successor tuples only while both complete artifacts are installed." For same-checkout local/dev clients this is fine (and consistent with LLP 0043's existing artifact-change quarantine of queued writes). But LLP 0064 native clients — listed as Related and named as consumers of these generated refs — bake refs into shipped binaries; under this contract every backend deploy hard-refuses every installed app until an app update, unless months of predecessor tuples are listed with their complete artifact graphs kept installed. The spec's only remediation is "upgrade/reload," and the alternative (legacy string calls) forfeits exactly the protections the spec introduces. The carrier itself is settled; what is missing is the statement of scope/policy for this consumer class.
Resolution criteria: an explicit compatibility-policy paragraph — e.g., scope v1 tuple enforcement to local/dev targets and defer the native/hosted tuple policy to a named LLP 0064/0098 amendment, or define a result-contract-hash-compatible acceptance mode with notice — so the availability consequence is a decision, not an accident.

**C5 — MATERIAL. `LegacyQueryRowsV0` enforcement semantics are underspecified against the "exact legacy compatibility" claim.**
Evidence: today `result: v.object(...)` on JS queries is typing-only (no egress validation — the motivating unsoundness, `issues/20260727-sound-handler-result-contracts.md`; `jsQueryRowDescriptor` injects the four system fields unconditionally, `packages/snapback-codegen/index.mjs:2976`). The spec says the legacy contract "validates the declared application fields while permitting the shipped document system fields," is "not reinterpreted as exact `results.records`," and that authors migrate "before strict v1 semantics activate" — but it does not pin (a) whether undeclared non-system extra fields refuse or pass under `LegacyQueryRowsV0` (if they refuse, previously working handlers that over-return break at upgrade; if they pass, "validates" is weaker than stated), (b) whether declared-but-absent fields refuse, or (c) whether legacy validation activates immediately at egress or only at the strict-v1 activation the migration sentence implies. §Runtime validation reads as unconditional for every declared contract, which conflicts with the staged-activation reading.
Resolution criteria: one paragraph pinning unknown-field and missing-field behavior for `LegacyQueryRowsV0` and the activation stage, with the compatibility consequence for previously deviating handlers stated explicitly and covered by the legacy-row matrix.

**C6 — DETAIL. The normative authoring example uses a nonexistent field.**
Evidence: `listTodos` declares `syncable: true`; `syncable` is a table property (`defineTable(...).sync()`, `define.mjs:348`), not a function-spec field — `assertKnownSpecFields` refuses it today, and the spec neither defines it nor mentions it in the form matrix (live-ness is the builder kind plus `defaultLive`).
Resolution criteria: fix the example (drop the field or define it).

**C7 — DETAIL. "The existing 4 MiB result transport ceiling" does not exist as stated.**
Evidence: the local capability report declares `maximum_result_size` **Advisory** (`src/manifest.rs:4467`); the only 4 MiB constant is the RQS bundle row-bytes cap (`cloudflare/src/coordinator.js:231`, LLP 0092), a different lane; mutation replay retention caps at 64 KiB (`src/storage.rs:169`). Anchoring a normative bound to a nonexistent enforced ceiling risks acceptance written against nothing, contrary to the capability-honesty rule.
Resolution criteria: either specify the ceiling as newly enforced at validation/serialization (with the capability report updated from Advisory) or re-anchor the sentence to the real limits.

**C8 — DETAIL. JSON-Pointer bounds are off by the outer array index.**
Evidence: contracts may nest to depth 16, and query contracts are validated per-row from the result root with "arrays by ascending index," but pointers cap at 16 segments/256 bytes; a depth-16 failure inside row `/42/…` needs 17 segments. Truncation/refusal behavior at the cap is unspecified.
Resolution criteria: make the segment budget consistent with maximum contract depth plus the row index (or scope pointers per-row), and state the at-cap behavior.

**C9 — DETAIL. "The repository's length-framed hash discipline" misattributes the framing.**
Evidence: the repo ships decimal-text framing in codegen (`sha256Framed`, `index.mjs:5603` — `"{len}:" || bytes`) and u32be framing in auth crypto (`src/auth/crypto.rs:755`); the spec's `u32be(tag)‖u64be(value)` TLV is a third, new scheme. It is fully specified in place with golden vectors, so it is implementable — only the attribution is wrong.
Resolution criteria: present the framing as this Spec's own frozen v1 encoding (or cite the specific discipline it extends).

**C10 — DETAIL. Cross-ticket acceptance dependencies are unconditional.**
Evidence: typed query groups exist only as sibling ticket `20260727-typed-live-query-groups.md` (no shipped lane, no governing LLP), and generated-ref React hook inference is ticket 5 (`useSnapbackQuery<Row = unknown>` takes caller generics today). Acceptance bullets require group-lane carriage and cast-free hook/group inference, making this Spec's acceptance blocked on later program items without saying so.
Resolution criteria: mark those bullets conditional on the named sibling tickets, or scope them to "when the surface exists."

**C11 — DETAIL. "Gated action run log" is not an existing artifact for direct actions.**
Evidence: cron runs have gated run records; a direct action produces the `FunctionRunResult` response envelope (`src/local.rs:1333`) and gated recent diagnostics — there is no persisted direct-action run log.
Resolution criteria: name the actual artifacts (cron run records + gated diagnostics) or specify the new run-log artifact and its custody.

**C12 — DETAIL. Source spellings for the new value vocabulary are undefined.**
Evidence: the manifest enum has `Array`, `Union`, `Literal`, bounded `Integer`/`FiniteReal`/`String`, but the authoring vocabulary (`v`) has no array/union/literal builders and no bound parameters today; the spec gives only `results.*` and "valueValidator."
Resolution criteria: enumerate the authoring spellings (or explicitly delegate them to implementation with the manifest enum as the contract).

## 4. Suggestions

- State explicitly that acknowledgement is tuple-independent — that is the load-bearing reason a contract rollout cannot strand an unacknowledged settlement, and it currently must be inferred.
- Pin the tuple-less-legacy-call × tuple-bearing-settlement cell of the replay matrix (refuse `SNAPBACK_MUTATION_RESULT_CONTRACT_STALE`, then ACK-reclaimable) in the adversarial corpus.
- The "closed generated pure-helper allowlist" needs one sentence of provenance (Snapback-owned pinned library in the LLP 0065/`PINNED_FUNCTIONS` style, not app-proven purity) — as written it is the one extension point in an otherwise closed grammar.
- The examples are fenced as `ts` while the runtime resolver admits only `.js`/`.mjs`; switch the fences or add the TS-authoring open question below to the text.
- "Execute … through every claimed evaluator" in acceptance should read "every claimed JS evaluator" — the IR tier applies the contract, not the handlers.
- Name the sibling ticket (`20260727-codegen-review-surface.md`) as the owner of the "committed review manifest" custody location, which is otherwise defined nowhere in the corpus.

## 5. Open questions

1. The witness reason `optional-field`: current Contract descriptors already emit `optional: true` (table row descriptors, left-join relational leaves) — in which positions is optionality genuinely unrepresentable in the Exact-owned vocabulary, so that this closed reason fires?
2. Can inline handlers be authored in TypeScript definition modules at all, given the runtime resolver admits only `.js`/`.mjs`, or is inline authoring `.mjs`-only for v1?
3. Are `Documents`/`Records` outer arrays deliberately unbounded except by the transport ceiling (cf. C7), while inner `Array` values cap at 1,024?
4. Must an inline builder be a named export (the id derives from the exported binding name) — i.e., is `export default defineJsQuery(...)` refused under `SNAPBACK_INLINE_HANDLER_EXPORT_REQUIRED`?
5. Where is `expected_operation_v1` advertised (capability manifest, `/inspect`, connection grant), and does a stale-tuple refusal on a live *resume* terminate the subscription or the connection?

## 6. Readiness verdict

The architecture is right and consistent with the governing corpus on every axis the round-1 claims name: graph separation, custody, warm-VM honesty, replay identity, structural contracts, and honest degradation are all coherent and finite/implementable in this repository. But five MATERIAL items remain: one internal contradiction with the pinned serializer (C1), one newly visible performance/design interaction with DK-4's pool (C2), one governance omission for the new wire surface (C3), one unstated availability consequence for the native-client consumer class (C4), and one underpinned compatibility-lane semantics (C5). Each is resolvable with bounded spec-text changes in one more pass; none invalidates the design. Until they are resolved, the Spec cannot be accepted as the implementation contract.

VERDICT: NOT READY

## Round 3 — 2026-07-27

**Reviewer family:** Claude Fable  
**Provider / runtime:** Anthropic Claude Code 2.1.220,
`claude-fable-5` on the approved M4 Mac mini fleet lane  
**Effort:** max  
**Date:** 2026-07-27  
**Redacted:** no  
**Method:** fresh remote CLI runner, read-only tools, mutually blind
structurally isolated capsule; final delta-round instructions  
**Target SHA-256:** `1946e22cae8db27a46992d149318ba7b0bd857f317acae319546d139fa0f43e5`  
**Capsule SHA-256:** `4a79417082edce9568cd48e7fc0e4b92fad5ef8fe6ed9aef04e4cf4733507614`  
**Instruction SHA-256:** `700b4fc1af2a15bba41e4a3f4fc062a0f9c87fdd16350376ba56989d73ee8392`  
**Status:** completed  
**Session ID:** `a084ade4-04f5-4f15-bcb5-f7affa5cad8c`  
**Duration:** 1,030,051 ms  
**Cost:** $31.123350

All five verification agents have reported. The last one (warm-VM/retention) confirmed the warm-pool sharing model matches shipped keying exactly, but found the "DK-4 benchmark" gate cites artifacts and budgets that don't exist, plus several corpus-citation misattributions. I now have first-hand or agent-verified evidence for every claimed resolution. Here is the review.

---

# LLP 0101 super-refine — Round 3 review

## 1. Overall assessment

The round's headline fixes are real, and most verify cleanly against the shipped implementation. The post-JSON-image section now matches the single actual serializer byte-for-byte in behavior; the shared-bundle/warm-pool-key design matches the shipped source-text keying model exactly; `LegacyQueryRowsV0` describes precisely the shipped `jsQueryRowDescriptor`/LLP 0032 P3 pipeline and its activation point; the action-artifact, custody, acknowledgement, and advisory-`maximum_result_size` claims all check out against code. The transformed-graph contract (3-graph custody, extractor-keyed markers, 64-file/depth-16/512 KiB/256 KiB resolver bounds, closed pure-initializer grammar) is finite and implementable, and the genuinely new element — imports for the handler graph — is correctly identified as an extension of LLP 0010's closed single-file profile while the multi-file definition-evaluation machinery already exists in codegen.

What keeps this revision short of READY is a band of edges on exactly the contracts this round claims to close: the newly enforced 4 MiB result ceiling contradicts a shipped 64 KiB hard cap on the durable-replay lane it names; the admission-policy carrier conflicts with LLP 0093 D1's deliberate exclusion of the finite routes from any connection-bound version domain, and two of its three advertisement surfaces don't exist as described; `contract-compatible.v1` relaxes LLP 0064's native refusal doctrine without routing an amendment; `LegacyQueryRowsV0` leaves the shipped legacy validator spellings (`v.number()`, `v.real()`, nullary `v.json()`) unmapped; the rolling-deployment exact-admission window doesn't pin which artifact executes; and the same-landing LLP 0009 gate cites a benchmark and memory budgets that don't exist. All are bounded-edit fixes, not rework — but several are load-bearing for the compatibility and replay contracts.

## 2. Strengths

- **Serializer fidelity, verified first-hand.** All six post-image claims are supported by the one shipped serializer (`snapbackSettle`, `packages/snapback-harness/ctx-bootstrap.js:1109-1136`, embedded via `include_str!` into both the Ibex and workerd legs): root `undefined → null` via the explicit guard at `:1114` (pinned by `tests/handler_settlement_v0.rs:174-185`), root function/symbol → fail closed, cycles → fail closed with rollback, non-finite → `null`, `Map → {}`, and the getter/proxy/`toJSON` hazard the spec acknowledges is the same hazard the harness itself documents (`ctx-bootstrap.js:1128-1131`). The spec's distinction between this coercing runtime boundary and the rejecting codegen definition normalizer (`packages/snapback-codegen/index.mjs:5970-6032`, getters never run) is exactly right.
- **Deep corpus grounding.** LLP 0004 already specifies the colocated `handler:` API (`0004:130-152`), pre-authorizes the bundling decision (`0004:179-184`), and bans `toString()` custody verbatim (`0004:487-490`); both P1 parent tickets exist (`issues/20260727-colocated-function-authoring.md`, `issues/20260727-sound-handler-result-contracts.md`) and the program's LLP-first rule is satisfied. This is a restoration, not an invention.
- **The compatibility target is real and correctly characterized.** Today's `result: v.object(...)` is typing-only (`define.mjs:1209-1215`), the generated row descriptor merges the four system fields (`index.mjs:2976-2993`), and the shipped demo (`demos/todo/snapback/functions.mjs:32`) is exactly the pattern `LegacyQueryRowsV0` preserves. The documents/records split fixes the named unsoundness (invented system fields on computed records), and `T | null` pins verified storage reality (`src/storage.rs:12325-12339` materializes optional absence as NULL; the four system fields are exact, `index.mjs:64`).
- **Warm-pool economics match shipped keying.** VMs are keyed by exact module source text (`0009:396-400`, `src/warm_vm.rs:45-49`); `demos/all-aboard` already shares one 27 KiB handler source across six functions. One-graph → one-bundle → one-key preserves that model, and group-digest invalidation of co-resident identities is honestly stated.
- **Replay and acknowledgement fit LLP 0043's shipped machinery.** Exact replay releases stored bytes without rerun (`tests/offline_replay_v0.rs:206-235`); the ack path is already tuple-blind and authority-checked (`src/storage.rs:1491-1563`); `Unknown` migration follows the established nullable-no-backfill precedent (`0043:179-187`).
- **Conventions fit.** The three capability ids match the dominant snake_case `_v1` style (9 of 11 existing ids); the stale-refusal shape has a direct precedent (`SNAPBACK_AUTH_STALE_RESULT`); the redacted public/gated diagnostic split matches shipped `PublicDiagnostic` (`inspect.public.schema.json:1446-1465`); `maximum_result_size` is genuinely Advisory in all three shipped manifests.

## 3. Concerns

**C1 — Result-size ceiling contradicts the shipped enforced durable-replay cap; validator-artifact retention accounting unspecified. MATERIAL, high.**
Evidence: the spec applies a "newly enforced 4 MiB complete post-serialization result ceiling" to "mutation, … retention, and replay lanes" and says validation "refuses before publication or commit when the complete encoded result would exceed it." The retained-mutation lane already enforces 64 KiB as a hard refusal: `CLIENT_MUTATION_MAX_RESULT_BYTES = 65,536` (`src/storage.rs:169-170`, `src/value_expr.rs:46`) with `SNAPBACK_CLIENT_MUTATION_RESULT_TOO_LARGE` — "the durable replay cap" (`src/storage.rs:13357-13369`). A 100 KiB retainable mutation result passes the spec's ceiling and then refuses at settlement. Additionally, `ResourceLimit` is `{name, status}` only (`src/manifest.rs:4305-4315`) — there is no value carrier for the newly enforced number — and LLP 0043's cap counters (`src/storage.rs:1486-1563`) count only ledger-row bytes, so retained validator artifacts are uncounted durable bytes.
Resolution: pin the per-lane relationship (4 MiB as the cross-lane publication/transport ceiling with the retained-settlement lane keeping — or explicitly changing, with cost analysis — its 64 KiB cap); name where the enforced value is reported; state whether validator-artifact bytes count against the 0043 caps.

**C2 — Expected-operation policy carrier conflicts with LLP 0093 D1, and two advertisement surfaces don't exist as described. MATERIAL, high.**
Evidence: the spec says the admission policy is "included in every connection/session identity," but LLP 0093 D1 (`0093:271-289`) deliberately keeps `/query`, `/mutation`, `/action` — the primary lanes the tuple flows through — outside any connection-bound version domain and states that pulling them in "would be its own proposal." `ConnectionGrant` (`schemas/connection.grant.schema.json:143-167`) has no capability or policy member (an additive member is sanctioned by 0094 §0C.2:701 but the spec never names the schema/matrix change). And the capability manifest is a **required member of the public** `/inspect` projection (`inspect.public.schema.json:2355-2429`; `0094:140`), so "authenticated `/inspect` projection" misnames the surface — inconsistently with the spec's own custody paragraph, which puts capability facts in public inspection.
Resolution: spell policy discovery per surface (target-level capability manifest for the finite routes; a named additive `ConnectionGrant` member with its §0C.2 row for connection-scoped lanes); either amend 0093 D1 in the same landing or scope the connection-identity claim; correct the `/inspect` description.

**C3 — `contract-compatible.v1` relaxes LLP 0064's refusal doctrine without a routed amendment; LLP 0058 capability maturity is unengaged. MATERIAL, medium.**
Evidence: LLP 0064 requires a native adapter to "refuse an incompatible artifact or provider before publishing application data," pins function-bundle identity among the compared identities (`0064:54-61`), and forbids "silently accepting a shape superset" (`0064:82-84`). Treating an implementation-hash mismatch as a notice is defensible (equal `resultContractHash` ⇒ not incompatible) but is the corpus's first deliberate downgrade of an exact-token comparison, and 0064 is in **Related** yet absent from the Acceptance agreement list (which names 0004/0009/0010/0012/0031/0037/0043/0093/0094/0095 only). Separately, LLP 0058's capability-maturity amendment (`0058:375-418`) governs whether ids whose authority is not Accepted may be advertised at all (`experimental`, requiring `acknowledgedExperimentalCapabilities`; `src/manifest.rs:3849-3860` currently hardcodes Stable); the spec's advertisement and "clients refuse a target that lacks the capability" language never engages it.
Resolution: add 0064 to the agreement list with one reconciliation paragraph; state the 0058 maturity path for `expected_operation_v1`, `result_contract_v1`, `inline_handler_v1`.

**C4 — `LegacyQueryRowsV0` leaves the shipped legacy validator spellings unmapped. MATERIAL, medium.**
Evidence: the shipped vocabulary is ten nullary/option-less spellings including `v.integer()`, `v.real()`, `v.number()`, `v.json()` (`packages/snapback-codegen/define.mjs:152-182`), all legal inside existing `result: v.object(...)` declarations. The spec's closed list omits `real`/`number`, requires optioned forms, and says "All other spellings refuse under `SNAPBACK_HANDLER_RESULT_CONTRACT_INVALID`." `LegacyQueryRowsV0` pins required/present/extra/system-field behavior and its activation point, but not the per-field validation semantics of existing declarations — so activation could refuse previously valid legacy authoring at generation time, against "the legacy forms remain supported through v1."
Resolution: one paragraph mapping each shipped spelling into `LegacyQueryRowsV0` (e.g., `v.number`/`v.real` → finite-real at profile bounds, nullary `v.json` → profile maxima) and scoping the closed-spelling refusal to the new `results.*` path.

**C5 — Rolling-deployment `exact.v1` window doesn't pin executed-artifact selection or the recorded tuple. MATERIAL, medium.**
Evidence: "A rolling deployment admits explicitly listed predecessor and successor tuples only while both complete artifacts are installed" says which tuples *admit* but not which implementation *executes* for an admitted predecessor tuple, and "Retained mutation output stores the complete original `ExpectedOperationV1`" would then freeze a client-sent tuple that may not match the bytes that ran — the exact identity skew the tuple exists to prevent, inherited by replay.
Resolution: one sentence — an admitted tuple executes the installed artifact whose `implementationHash` matches, and retained output records the executed implementation's tuple.

**C6 — The same-landing LLP 0009 gate cites a benchmark and budgets that don't exist. MATERIAL, medium.**
Evidence: DK-4 is a lifecycle *decision* (`0009:325`), not a benchmark; the only warm-reuse budget is `warm_invoke_us < 0.75 × vm_cost_us` on a single noop bundle (`llp/0035:212-215`, `src/bench.rs:1025`); nothing is parametrized by operation/graph count; and no memory budget exists to be "within" — 0009 keeps memory honestly Missing and names the 4-VM pool cap as the memory control (`0009:765-768, 779-783`). As written, the gate for advertising `inline_handler_v1` is unimplementable.
Resolution: define the gate concretely — name the new count-parametrized benchmark and the budget(s) it must satisfy; replace "memory budgets" with the enforced pool-cap/eviction behavior or define a budget.

**C7 — Corpus-citation fidelity: five misattributed or nonexistent authorities. DETAIL.**
Evidence: "LLP 0051's canonical JSON boundary" — the phrase and any inheritable `maxDepth`/`maxBytes` bounds don't exist (0051's construct is the recursive JSON-transport boundary, `0051:523-542`, with no size bounds); "finite-real canonicalization follows LLP 0007" — 0051 owns non-finite→null, 0007 owns only integer safety (`0007:74-90`); trimming "schema-driven under LLP 0037" — 0037 is Rust-first schema custody and never states a trimming doctrine, while LLP 0031 owns trimming and explicitly bounds what schemas can prove (`0031:187-196`); "LLP 0031's authenticated/gated developer-admin twin" — not an 0031 class (actual: D3's gated `/_snapback/api/inspect`, AdminRead, `0031:136, 564-565`); "the committed review manifest" — no such artifact exists anywhere. Also, 0010 spells its profile "single-file **runtime** profile" (`0010:368-370`), and its text ("imports are rejected before emission") will directly contradict this spec unless the 0010 amendment is named among the same-landing edits.
Resolution: correct each citation; add the 0010 §-level amendment to Acceptance; define or drop the review-manifest custody surface.

**C8 — Registry/fixture edits under-scoped, and refusal precedence unpinned. DETAIL.**
Evidence: 0094 §0E is a *negotiation* refusal registry whose rows carry HTTP status and route/stage — the nine build-time codegen diagnostics have no home there, and the spec doesn't distinguish the classes; the 0095 landing also requires revising §1.5's **closed** action vocabulary and §2.2's tuple axis ("additions revise this spec," `0095:299-308, 366-374`), beyond "adds … fixtures"; and `SNAPBACK_MUTATION_RESULT_CONTRACT_STALE`'s precedence against the three shipped overlapping refusals (`SNAPBACK_CLIENT_MUTATION_ID_REUSED` on function/args mismatch, `SNAPBACK_AUTH_STALE_RESULT` on authority mismatch — `src/storage.rs:1673-1731`) is unspecified although 0043 pins that "the server owns error precedence." Likewise the ordering against the existing `SNAPBACK_HANDLER_RESULT_INVALID` rows-array refusal is unstated.
Resolution: a registry-target table (wire codes → §0E with status/route; generation codes → build-diagnostic custody), "revises 0095 §1.5/§2.2," and a short precedence list.

**C9 — Normative carriage list names "query groups" unconditionally; the lane exists nowhere. DETAIL.**
Evidence: repo-wide, "query group" appears only in this spec; the Acceptance bullets correctly hedge ("whenever those sibling lanes exist"), but the §Identity sentence carries the tuple "through … query groups" as if the lane were present.
Resolution: condition the normative sentence the same way as Acceptance.

**C10 — Post-image and wire-shape precision. DETAIL.**
Evidence: the query envelope is `{version, rows, cursor?}` (`schemas/query.output.schema.json`, LLP 0080 §2), not strictly `{version, rows}`; live resume and `/client-mutations/acknowledge` are local-arm-only (`0094:147,150`) while the spec states their obligations arm-agnostically against 0094 §0A.0's doctrine; and root-`undefined → null` is a settle-path special case (`ctx-bootstrap.js:1114`), not `JSON.stringify` behavior — the observable contract matches, but "follows the existing JSON boundary" could mislead an implementer of a new evaluator.
Resolution: three one-line precision fixes.

**C11 — Diagnostic-path sentinels and union-kind edges. DETAIL.**
Evidence: `/<truncated>` and `/<unknown>#<hex>` are literal segments; RFC 6901 escaping leaves `<` untouched, so a declared field legitimately named `<truncated>` emits an indistinguishable pointer. The union rule's "different primitive kinds" must be pinned to post-JSON-image kind classes to stay decidable (`Id`/`Principal`/`String` all serialize as strings; `Integer`/`FiniteReal` are both numbers); and whether `v.json({maxDepth})` counts against the contract-wide depth 16 is unstated.
Resolution: reserve the sentinel spellings; define the disjointness kind-classes; one sentence on depth composition.

**C12 — Name collisions and an undefined relation. DETAIL.**
Evidence: `implementationHash` already ships with a different meaning — the provider-introspection field aliased to the whole-artifact `bundleHash` (`packages/snapback-codegen/provider-introspection.mjs:82`) — while the spec introduces a per-operation hash in the same artifact family and requires projections to "agree"; "every generated plan or standard-pattern identity **consumed by** the operation" has no consumption relation in LLP 0065, which attaches `standardPattern {helper, profile}` to the generated function itself (`functions.manifest.schema.json:689-699, 1715-1726`); `QueryInvocation` collides with an unrelated `pub(crate)` Rust struct (`src/local.rs:2983`).
Resolution: disambiguate the hash names; reword "consumed" to the operation's own standard-pattern/plan identity; the Rust collision is cosmetic but worth a rename.

## 4. Suggestions

- Extend the **Revised** header to record this reconciliation round; it currently stops at the round-1 entry.
- State explicitly that the mixed-form refusal changes today's silent behavior in the legacy action lane — `defineAction` currently prefers `js` when both `js` and `plan` are supplied (`define.mjs:1354-1386`) — so a previously ambiguous authoring will newly refuse.
- Name the capability-index row id(s) and guide page(s) the landing adds; no row or GAP row exists for either seam today, and `guide/conventions.md:131-138` requires witnessed rows with CI-exercised snippet sources (which the committed maintained-demo bullet can satisfy).
- Clarify that "reclaimable through the legacy string/tuple lane" means acknowledgeable/purgeable, not replayable — legacy rows the authority axis already quarantines (`SNAPBACK_CLIENT_MUTATION_LEGACY_AUTH_QUARANTINED`) are not resurrected by the `Unknown` migration.
- Wording: "four-VM bound" is a per-instance pool **cap** with LRU eviction (thrash, not breach, is the risk); "generation-fences" conflates 0009's per-invocation epoch with the pool-generation counter; "reset-equivalent module evaluation" should use 0009's term "equivalently reset context."

## 5. Open questions

1. Under `exact.v1` replay, a long-lived native client's queued-but-never-sent offline mutation refuses after any deployment even when the result contract is unchanged. Is that accepted UX, or should never-executed queued work be distinguishable from ambiguous replay?
2. The runtime resolver refuses imports whose resolved target escapes the canonical app source root — the shipped `demos/_kit` shared-helper layout would refuse. Is the kit expected to move in-root, or is the root identity configurable?
3. Where does the enforced result-size value surface to clients, given `ResourceLimit` carries no numeric member?
4. Can a client upgraded from the legacy string lane to generated refs replay its pre-upgrade queued mutations at all, or only acknowledge their settlements?

## 6. Readiness verdict

The transformed-graph contract is finite and implementable, and the round's central fixes verify against the shipped system. But the compatibility and replay contracts — the other half of what this revision claims to close — still contain one direct collision with shipped enforcement (C1), one direct conflict with governing doctrine plus two misdescribed advertisement surfaces (C2), an unrouted doctrinal relaxation (C3), an unmapped legacy vocabulary (C4), an unpinned rolling-window execution rule (C5), and an unimplementable advertisement gate (C6). Each is a bounded edit; together they are too load-bearing to accept as-is.

VERDICT: NOT READY
