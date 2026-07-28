# LLP 0101 review — Codex family

## Round 1 — 2026-07-27

**Reviewer family:** OpenAI Codex  
**Provider / runtime:** OpenAI Codex CLI 0.145.0, `gpt-5.6-sol`  
**Effort:** ultra  
**Date:** 2026-07-27  
**Redacted:** no  
**Method:** fresh non-interactive CLI runner, read-only sandbox, mutually blind
structurally isolated capsule  
**Target SHA-256:** `59c1501196eeda374f4e3fdebbdc9717862791c42fe668a0b5ac3109af627ab4`  
**Capsule SHA-256:** `684a72ddc8a0ba153000b66349473dc1f26cdbaed7044ff2fef1d805cc4eebd6`  
**Instruction SHA-256:** `ed91ccf3c9830b01aa80e0af057a8fea4bd56d9a0b4bc0123b7f7052117ec2ef`  
**Status:** completed — NOT READY  
**Thread ID:** `019fa615-7e32-7d33-a078-fc2caa41fd37`  
**Review body:** preserved verbatim below.

## 1. Overall assessment

LLP 0101 has a strong architectural direction: colocated handlers without `toString()`, Rust-owned result contracts, pre-publication validation, and generated-reference inference all fit Snapback’s governing principles.

It is not ready for acceptance, however. Several load-bearing behaviors contradict active LLPs or shipped interfaces, while others lack enough normative detail for one interoperable implementation. The blockers concern the runtime module graph, warm-VM semantics, public source custody, stale-reference protocol, query wire compatibility, result-value extraction, legacy compatibility, and retained mutation replay.

## 2. Strengths

- The prohibition on `Function.prototype.toString()`, runtime capture inference, and public-manifest execution is correct. The build-internal strict-JSON marker and atomic artifact replacement are good authority boundaries.

- Separating stable operation identity from content-addressed implementation identity is the right model for preserving authorization while preventing stale code from running under an old proof.

- The distinction between stored documents, computed records, and direct values addresses a real soundness gap. In particular, computed records should not gain invented system fields, while stored optional fields should reflect storage’s present-`null` behavior.

- Omitted contracts degrading explicitly to `unknown`, rather than being inferred from opaque JavaScript, is appropriately honest.

- Precommit mutation validation is correctly placed, and the specification accurately states that action-result validation cannot roll back already-performed external effects.

- Making one Rust-owned contract project into JSON Schema, TypeScript, provider metadata, operation schemas, and capability inspection follows LLP 0037’s ownership model.

- The Exact/Contract posture is directionally correct: an explicit unsupported projection is preferable to silently emitting a lossy descriptor.

## 3. Concerns

### C1 — MATERIAL: The inline runtime module graph is not closed or implementable as specified

**Evidence.** The proposed algorithm creates a virtual entry that imports the authored operation and exports its handler, while requiring builder machinery to be tree-shaken or rejected ([LLP 0101 §Bounded static bundling](/private/tmp/snapback-llp0101-r1.bISbx6/llp/0101-inline-handlers-and-result-contracts.spec.md:97)). Importing that operation necessarily evaluates its definition module, imports, builders, and reachable top-level side effects. The handler-to-marker replacement is defined only for the isolated definition-evaluation graph, not for the runtime graph. Meanwhile, governing LLP 0010 explicitly defines handler modules as a closed single-file profile whose imports are rejected ([LLP 0010](/private/tmp/snapback-llp0101-r1.bISbx6/llp/0010-agent-dx-and-acceptance.spec.md:364)).

“Existing handler bundler” therefore refers to rules that do not currently admit the graph this proposal requires. Tree shaking also cannot erase arbitrary side effects safely.

**Resolution criteria.** Define the original source graph, transformed definition-evaluation graph, and runtime-handler graph separately. Specify how the exact handler expression and its lexical dependencies are exported without executing Snapback builders in the server runtime. Pin resolver roots, allowed edge kinds, module formats, symlink/file-attestation rules, graph depth/file/byte limits, top-level side-effect semantics, runtime registration shape, final capability scanning, and all graph-identity inputs. Amend LLP 0010 and resolve LLP 0051’s static-dependency question explicitly.

### C2 — MATERIAL: Warm-VM acceptance contradicts the governing lifecycle semantics

**Evidence.** Inline handlers inherit legacy warm-VM behavior, but acceptance says a reused VM cannot retain predecessor authority, arguments, or results ([LLP 0101 §Acceptance](/private/tmp/snapback-llp0101-r1.bISbx6/llp/0101-inline-handlers-and-result-contracts.spec.md:319)). LLP 0009 deliberately permits module-level lexical state to persist on trusted-local warm VMs, including per-user values if application code places them there ([LLP 0009](/private/tmp/snapback-llp0101-r1.bISbx6/llp/0009-code-execution-security.rfc.md:670)). Imported modules enlarge that persistent closure surface.

The existing guarantee prevents a stale continuation from exercising another invocation’s host authority; it does not erase arbitrary closure-held data.

**Resolution criteria.** Either narrow acceptance to host-owned registries, capabilities, active contexts, and executable continuations—while retaining LLP 0009’s documented lexical-value residue—or require fresh/reset-equivalent module evaluation and amend LLP 0009. Preserve the distinct trusted-local, hosted, and fresh-action postures.

### C3 — MATERIAL: Public source paths and spans violate the active custody decision

**Evidence.** LLP 0101 places source paths/spans in public manifests, client references, inspection, diagnostics, and summaries ([§Identity, artifacts, and public custody](/private/tmp/snapback-llp0101-r1.bISbx6/llp/0101-inline-handlers-and-result-contracts.spec.md:153)). LLP 0031 expressly removes `sourceSpan` from public function inspection as a source-path leak and restricts detailed diagnostics to the gated twin ([LLP 0031](/private/tmp/snapback-llp0101-r1.bISbx6/llp/0031-server-route-taxonomy.spec.md:583)).

**Resolution criteria.** Define custody per artifact and route. Keep canonical source links in local build output and appropriately gated developer/admin artifacts; exclude them from browser/client/public inspection projections. Add LLP 0031 to Related and semantic acceptance, with schema-owned public/private sentinel tests.

### C4 — MATERIAL: Implementation identity and stale-reference refusal are internally incomplete

**Evidence.** The enumerated `implementationHash` preimage omits `handlerForm`, yet the compatibility section says changing only that form changes the hash ([identity inputs](/private/tmp/snapback-llp0101-r1.bISbx6/llp/0101-inline-handlers-and-result-contracts.spec.md:137), [form-change rule](/private/tmp/snapback-llp0101-r1.bISbx6/llp/0101-inline-handlers-and-result-contracts.spec.md:283)). Extractor, bundler, evaluator, and admission-evidence versions are also absent despite affecting semantics.

Stale refs are required to refuse, but no versioned request token, comparison algorithm, validation order, rollout behavior, or stable diagnostic is defined. Today generated refs contain app/id/name/kind only ([codegen](/private/tmp/snapback-llp0101-r1.bISbx6/packages/snapback-codegen/index.mjs:4932)), and the client reduces every ref to its name ([client](/private/tmp/snapback-llp0101-r1.bISbx6/packages/snapback-client/index.mjs:8137)).

**Resolution criteria.** Define one ordered, domain-separated, length-framed hash preimage, including `handlerForm`, source-custody/admission identity, toolchain/profile versions, normalized graph data, and canonical contracts. Provide golden vectors. Define a versioned expected-operation identity carried by query, live subscribe/resume, mutation, action, grouped query, and queued-replay lanes; specify check ordering, mixed-version deployment behavior, legacy string calls, and stable refusal codes. Keep this compatibility check separate from consent bound to stable operation identity.

### C5 — MATERIAL: Scalar queries and generated results lack a compatible wire and consumer contract

**Evidence.** `results.value(...)` allows a query to return a scalar directly ([LLP 0101 §Result contract vocabulary](/private/tmp/snapback-llp0101-r1.bISbx6/llp/0101-inline-handlers-and-result-contracts.spec.md:184)). The shipped Rust and JSON contract requires `{version, rows: [...]}` ([query output schema](/private/tmp/snapback-llp0101-r1.bISbx6/schemas/query.output.schema.json:12)); live subscriptions and `snapback.external-store.v1` are likewise row-array protocols. React currently accepts caller-selected row/result generics and operates on arrays ([React types](/private/tmp/snapback-llp0101-r1.bISbx6/packages/snapback-react/index.d.mts:17)).

The specification also does not distinguish `FunctionResult<R>`—the handler payload—from the query, mutation, and action transport envelopes returned by headless clients and grouped calls.

**Resolution criteria.** Either remove scalar queries from v1 or define a versioned discriminated query envelope and its JSON schemas. Specify live eligibility, cursor behavior, external-store protocol versioning, old-client refusal, React and grouped-query behavior, and exact generic signatures for payloads versus transport envelopes.

### C6 — MATERIAL: Stored-document and recursive result semantics are not operationally closed

**Evidence.** A `documents(table)` contract must reject a computed lookalike and validate table identity ([runtime validation](/private/tmp/snapback-llp0101-r1.bISbx6/llp/0101-inline-handlers-and-result-contracts.spec.md:223)). Handler results currently cross as ordinary JSON, while `_id` is an opaque UUID rather than a table-encoded identifier ([LLP 0007](/private/tmp/snapback-llp0101-r1.bISbx6/llp/0007-storage-portability.spec.md:109)). A literal, clone, or row from an identically shaped table is consequently indistinguishable after serialization.

There is also no singular stored-document result contract, although existing HostPlan and generated CRUD mutations return complete documents ([ReturnValue](/private/tmp/snapback-llp0101-r1.bISbx6/src/manifest.rs:3146), [standard CRUD](/private/tmp/snapback-llp0101-r1.bISbx6/packages/snapback-codegen/standard-patterns.mjs:326)). Reexpressing those as `value(v.object(...))` loses installed-schema reuse, system-field semantics, and present-null optionals.

Finally, the recursive manifest variants, constructor grammar, numeric and collection limits, union distinguishability algorithm, canonical ordering, and contract-hash bytes are not specified.

**Resolution criteria.** Decide whether documents are nominal or structural. For nominal behavior, define trusted provenance or same-snapshot storage verification, including clone behavior and evaluator parity; otherwise remove the lookalike/table-origin claim. Add a singular document contract or explicitly define migration for document-returning mutations. Specify the complete `FunctionResultContractV1` enum, source constructors, bounds, canonicalization, and hash domain.

### C7 — MATERIAL: Result validation conflicts with the actual strict-JSON boundary

**Evidence.** The specification says present `undefined` fails and validation does not invoke application code ([LLP 0101](/private/tmp/snapback-llp0101-r1.bISbx6/llp/0101-inline-handlers-and-result-contracts.spec.md:197)). Current settlement uses `JSON.stringify`, normalizes root `undefined` to `null`, omits object properties containing `undefined`, and can invoke getters, proxy traps, and `toJSON` before Rust sees the result ([settlement boundary](/private/tmp/snapback-llp0101-r1.bISbx6/packages/snapback-harness/ctx-bootstrap.js:1101)).

Rust-side validation cannot recover the pre-coercion distinction afterward.

**Resolution criteria.** State whether contracts govern the pre-serialization JavaScript graph or the resulting JSON image. If pre-serialization, define one trusted, side-effect-free extraction algorithm across Hermes, V8, IR, and hosted evaluators, including accessors, proxies, custom prototypes, sparse arrays, cycles, `toJSON`, non-finite numbers, and `undefined`. Otherwise revise the optionality and “does not call application code” claims to match post-serialization semantics.

### C8 — MATERIAL: The promised legacy compatibility lane is breaking and incomplete

**Evidence.** Existing `result: v.object(...)` is reinterpreted as an exact computed record contract ([LLP 0101 §Compatibility](/private/tmp/snapback-llp0101-r1.bISbx6/llp/0101-inline-handlers-and-result-contracts.spec.md:273)). Shipped codegen explicitly defines that form as app fields with document system fields riding along ([define.mjs](/private/tmp/snapback-llp0101-r1.bISbx6/packages/snapback-codegen/define.mjs:1209), [projection](/private/tmp/snapback-llp0101-r1.bISbx6/packages/snapback-codegen/index.mjs:2971)). The maintained todo demo uses this declaration and returns stored documents. Exact-record validation would reject those system fields; a warning does not preserve compatibility.

The generic legacy discriminant also does not cover shipped actions, whose JS arm is nested as `defineAction({js:{source, exportName}})` alongside a plan arm ([defineAction](/private/tmp/snapback-llp0101-r1.bISbx6/packages/snapback-codegen/define.mjs:1354)).

**Resolution criteria.** Preserve a versioned legacy-row contract through v1 or require explicit source migration to `documents`/`records` before strict validation is activated. Define closed handler-form unions per operation kind. For actions, preserve both the plan arm and nested legacy JS arm, add an unambiguous inline arm, and specify every mixed-form rejection.

### C9 — MATERIAL: Contract changes can make exactly-once settlements permanently unreclaimable

**Evidence.** LLP 0101 says a retained mutation result is refused whenever the current contract hash differs, without rerunning or reinterpreting it ([replay rule](/private/tmp/snapback-llp0101-r1.bISbx6/llp/0101-inline-handlers-and-result-contracts.spec.md:229)). LLP 0043 requires a lost-response client to reclaim the original settlement until authenticated acknowledgement and forbids evicting unacknowledged results ([LLP 0043](/private/tmp/snapback-llp0101-r1.bISbx6/llp/0043-offline-replay-retention.rfc.md:169)). After a deployment changes the contract, a client with an ambiguous delivery can neither recover the result nor safely acknowledge it, potentially leaving an immortal ledger record.

The proposal also does not define the `resultContractHash` domain, whether it binds the installed table schema, or migration for retained rows without the new hash.

**Resolution criteria.** Define durable contract identity and legacy-row migration. Specify either release under the exact original client/artifact/contract tuple using the original validator, or an explicit terminal discard-and-ack protocol that preserves no-rerun semantics. Maintain credential preparation and authority-descriptor checking before settlement lookup, and preserve bounded exactly-once retention behavior.

### C10 — DETAIL: The Exact/Contract GAP needs a named, versioned witness

**Evidence.** `contractProjection: Missing(reason)` is the correct posture, but the specification does not name its owning artifact/schema, define a closed reason enum, state whether unsupported operations remain present, or define consumer behavior ([Contract GAP](/private/tmp/snapback-llp0101-r1.bISbx6/llp/0101-inline-handlers-and-result-contracts.spec.md:267)).

**Resolution criteria.** Define a Rust-owned, versioned `Supported | Missing` projection witness, closed reason codes, operation/contract-hash linkage, artifact placement, diagnostics, and the exact boundary requiring an Exact-owned schema change.

### C11 — DETAIL: The action effect receipt is undefined

**Evidence.** The specification says an action’s effect receipt records `resultContractViolation` ([action validation](/private/tmp/snapback-llp0101-r1.bISbx6/llp/0101-inline-handlers-and-result-contracts.spec.md:239)), but the shipped receipt schema covers mutations and subscriptions, not actions ([receipt schema](/private/tmp/snapback-llp0101-r1.bISbx6/schemas/receipt.schema.json:18)). Direct actions, cron actions, and streamed actions also have different settlement surfaces.

**Resolution criteria.** Define the Rust-owned receipt/run-record type, persistence and transport surfaces, privacy projection, and mapping for direct, cron, and streamed actions—or replace “effect receipt” with the actual diagnostic/run-record behavior intended.

### C12 — DETAIL: Deterministic redacted diagnostics need a canonical algorithm

**Evidence.** A JSON path can contain an attacker-controlled unknown key, and union validation can produce several plausible failures. The specification does not define path syntax, escaping, traversal order, union-error selection, bounds, or public versus gated detail. The stable list also omits stale implementation and stale mutation-contract codes.

**Resolution criteria.** Define canonical bounded paths and traversal/error precedence, redact or classify unknown keys, cap every diagnostic field, separate public and gated projections, and include every refusal code promised elsewhere in the specification.

### C13 — DETAIL: Document status is inconsistent

**Evidence.** Metadata says `Status: Review`, while the final section calls it a Draft proposal ([metadata](/private/tmp/snapback-llp0101-r1.bISbx6/llp/0101-inline-handlers-and-result-contracts.spec.md:3), [status prose](/private/tmp/snapback-llp0101-r1.bISbx6/llp/0101-inline-handlers-and-result-contracts.spec.md:341)).

**Resolution criteria.** Use `Review` consistently unless the document is intentionally moved back to Draft.

## 4. Suggestions

- Add normative matrices for operation kind × handler form, result kind × operation kind, and consumer surface × payload/envelope type.

- Add golden vectors for implementation hashes, contract hashes, graph identities, and every Rust-owned projection.

- Define one adversarial cross-evaluator result corpus covering getters, proxies, `toJSON`, sparse arrays, undefined properties, cycles, ambiguous unions, nominal document copies, bounds, and redacted errors.

- Add a deployment compatibility matrix covering old client/new server, new client/old server, stale live resume, queued mutation replay, and contract-only changes.

- Add LLP 0031, LLP 0043, and the applicable action-stream/query-group LLPs to Related and semantic acceptance.

## 5. Open questions

- Does the runtime handler graph import the authored definition module, or a synthetic handler-only transform?

- Are stored-document contracts nominal, snapshot-equal, or purely structural? Are clones of genuine documents valid?

- Are scalar online queries necessary in v1, or should they wait for a versioned query protocol?

- What does a client do with an ambiguously settled mutation after its original result contract is no longer installed?

- Are source links intentionally public, or only available in local/gated developer artifacts?

- Does `FunctionResult<R>` denote the handler payload, the public transport envelope, or a surface-specific projection of both?

## 6. Readiness verdict

Not ready for acceptance. The architectural direction should be retained, but the MATERIAL concerns require normative resolution before implementation can produce compatible, security-preserving evidence.

VERDICT: NOT READY

## Round 3 — 2026-07-27

**Reviewer family:** OpenAI Codex  
**Provider / runtime:** Codex CLI 0.145.0, `gpt-5.6-sol`  
**Reasoning effort:** ultra  
**Date:** 2026-07-27  
**Redacted:** no  
**Method:** fresh CLI runner, read-only sandbox, mutually blind structurally
isolated capsule; final delta-round instructions  
**Target SHA-256:** `1946e22cae8db27a46992d149318ba7b0bd857f317acae319546d139fa0f43e5`  
**Capsule SHA-256:** `4a79417082edce9568cd48e7fc0e4b92fad5ef8fe6ed9aef04e4cf4733507614`  
**Instruction SHA-256:** `700b4fc1af2a15bba41e4a3f4fc062a0f9c87fdd16350376ba56989d73ee8392`  
**Status before launch:** received

## 1. Overall assessment

LLP 0101 is substantially stronger, but it is not ready. The post-JSON behavior, warm-VM posture, result vocabulary, atomicity, custody, and diagnostics are credible. However, the transformed graph, compatibility predicate, and replay state machine are not yet finite or unambiguous.

## 2. Strengths

- Post-JSON semantics now match the serializer, including root `undefined`, non-finite numbers, cycles, prototypes, and unserializable roots ([LLP 0101:313](/private/tmp/snapback-llp0101-r3.DWJ7Gy/llp/0101-inline-handlers-and-result-contracts.spec.md:313), [ctx-bootstrap.js:1109](/private/tmp/snapback-llp0101-r3.DWJ7Gy/packages/snapback-harness/ctx-bootstrap.js:1109), [handler_settlement_v0.rs:174](/private/tmp/snapback-llp0101-r3.DWJ7Gy/tests/handler_settlement_v0.rs:174)).
- The honest warm-VM contract—host-owned state reset, application lexical state permitted to persist—is aligned with LLP 0009. One shared bundle/pool key is the correct direction ([LLP 0101:168](/private/tmp/snapback-llp0101-r3.DWJ7Gy/llp/0101-inline-handlers-and-result-contracts.spec.md:168), [LLP 0009:779](/private/tmp/snapback-llp0101-r3.DWJ7Gy/llp/0009-code-execution-security.rfc.md:779)).
- Stable authorization identity is cleanly separated from implementation compatibility, and public/private source custody is conservative.
- Documents, computed records, singular documents, and direct values are usefully distinguished. The bounded recursive vocabulary and structural document semantics are implementable in isolation.
- Mutation validation is correctly required before commit, while action validation explicitly does not claim rollback of external effects. The current runtime has suitable precommit seams ([runtime.rs:279](/private/tmp/snapback-llp0101-r3.DWJ7Gy/src/runtime.rs:279)).
- Retaining the original validator with an unacknowledged settlement and keeping acknowledgement available to stale clients are sound goals.
- Bounded redacted JSON pointers and value-free diagnostics are carefully specified.

## 3. Concerns

1. **CRITICAL — MATERIAL: `contract-compatible.v1` does not bind the contract it claims to preserve.**

   Evidence: `ExpectedOperationV1` contains no argument-contract or schema-contract identity, while compatible admission ignores `implementationHash` and compares only `resultContractHash` ([LLP 0101:216](/private/tmp/snapback-llp0101-r3.DWJ7Gy/llp/0101-inline-handlers-and-result-contracts.spec.md:216), [LLP 0101:235](/private/tmp/snapback-llp0101-r3.DWJ7Gy/llp/0101-inline-handlers-and-result-contracts.spec.md:235)). An argument change therefore remains “compatible.” `Documents {table}` and `Document {table}` contain only a table name, so their JCS hash does not change when installed fields, optional-storage behavior, or system-field shape changes ([LLP 0101:334](/private/tmp/snapback-llp0101-r3.DWJ7Gy/llp/0101-inline-handlers-and-result-contracts.spec.md:334), [LLP 0101:363](/private/tmp/snapback-llp0101-r3.DWJ7Gy/llp/0101-inline-handlers-and-result-contracts.spec.md:363)). This conflicts with LLP 0064’s requirement that native compatibility bind app, schema, bundle, and input identities ([LLP 0064:52](/private/tmp/snapback-llp0101-r3.DWJ7Gy/llp/0064-native-client-surfaces.rfc.md:52)).

   Resolution criteria: add an exact argument-contract hash and bind result identity to the fully resolved structural schema—including system fields and optional semantics—or carry an exact schema-contract hash separately. Compatible admission may relax implementation bytes only; protocol, app, operation, kind, inputs, schema, and resolved result shape must remain exact.

2. **CRITICAL — MATERIAL: replay, predecessor admission, and acknowledgement contradict the global admission order.**

   Evidence: comparison is required before storage or settlement lookup ([LLP 0101:220](/private/tmp/snapback-llp0101-r3.DWJ7Gy/llp/0101-inline-handlers-and-result-contracts.spec.md:220)), but retained replay must locate an old stored tuple after another contract becomes current ([LLP 0101:401](/private/tmp/snapback-llp0101-r3.DWJ7Gy/llp/0101-inline-handlers-and-result-contracts.spec.md:401)). Stale clients must also be able to acknowledge independently of their tuple ([LLP 0101:411](/private/tmp/snapback-llp0101-r3.DWJ7Gy/llp/0101-inline-handlers-and-result-contracts.spec.md:411)). Current duplicate detection necessarily happens at settlement lookup ([storage.rs:1632](/private/tmp/snapback-llp0101-r3.DWJ7Gy/src/storage.rs:1632)). The rolling policy also does not say how an admitted predecessor tuple selects predecessor bytes rather than the current implementation.

   Under compatible admission, a client presents expectation `E` while implementation `A` executes. Storing only “the original ExpectedOperation” cannot simultaneously attribute the actual execution and support an ambiguous retry whose client still knows only `E`.

   Resolution criteria: specify separate algorithms for fresh invocation, rolling predecessor execution, replay hit, replay miss, live resume, standalone ACK, and piggyback ACK. Persist presented tuple, effective executed tuple, policy, and validator identity. Permit an authority-checked settlement-binding lookup before current-operation comparison on replay hits; compare against current executable only on misses. Define exact predecessor artifact selection and retirement.

3. **HIGH — MATERIAL: ExpectedOperation wire placement and client conformance are not schema-closed.**

   Evidence: the tuple purportedly rides every finite and live lane, but field name, casing, nesting, policy carrier, success notice, and response attribution are unspecified. LLP 0093 explicitly says finite routes have no connection-version carrier and that a new client field needs capability proof ([LLP 0093:264](/private/tmp/snapback-llp0101-r3.DWJ7Gy/llp/0093-client-protocol-and-native-clients.rfc.md:264), [LLP 0093:291](/private/tmp/snapback-llp0101-r3.DWJ7Gy/llp/0093-client-protocol-and-native-clients.rfc.md:291)). LLP 0094 currently classifies `HandlerInput` and live inputs as open decoders ([LLP 0094:651](/private/tmp/snapback-llp0101-r3.DWJ7Gy/llp/0094-wire-envelope-contract.spec.md:651)). The “structured compatibility notice” has no DTO or code. LLP 0095’s fixture action vocabulary is closed and contains no notice/adoption action ([LLP 0095:299](/private/tmp/snapback-llp0101-r3.DWJ7Gy/llp/0095-client-lifecycle-and-conformance.spec.md:299)).

   Resolution criteria: define one Rust-owned DTO and exact placement on each lane, the policy fact and binding for finite requests and sessions, a common compatibility-notice schema, requested/actual attribution, all refusal rows with HTTP/retry semantics, and corresponding LLP 0095 states/actions—not fixtures alone. Amend LLP 0093 as well as 0094/0095. Also correct “authenticated `/inspect`”: root `/inspect` is public and trimmed; the gated twin is `/_snapback/api/inspect` ([LLP 0031:136](/private/tmp/snapback-llp0101-r3.DWJ7Gy/llp/0031-agent-remote-control-plane.spec.md:136)).

4. **HIGH — MATERIAL: existing RQS groups and token resume contradict exact resume.**

   Evidence: route bundles contain only function and arguments ([routes.manifest.schema.json:3](/private/tmp/snapback-llp0101-r3.DWJ7Gy/schemas/routes.manifest.schema.json:3)); RQS tokens independently bind `generation` and `queryArtifact` ([rqs.rs:1265](/private/tmp/snapback-llp0101-r3.DWJ7Gy/src/rqs.rs:1265)). An artifact/token refusal deliberately falls back to a fresh snapshot ([local.rs:7471](/private/tmp/snapback-llp0101-r3.DWJ7Gy/src/local.rs:7471)), while LLP 0101 says resume is exact and must not retarget. LLPs 0090–0092 are absent from both `Related` and same-landing reconciliation.

   Resolution criteria: either prove `queryArtifact`/`generation` is the canonical equivalent of ExpectedOperation or extend bundle entries and tokens with its tuple/digest. Define bundle-wide stale atomicity, and distinguish expected-operation mismatch—which must refuse—from ordinary availability-oriented RQS fallback. Reconcile LLPs 0090–0092 and their schemas.

5. **HIGH — MATERIAL: the 4 MiB retained-result rule conflicts with LLP 0043 and current enforcement.**

   Evidence: LLP 0101 applies 4 MiB to retention and replay ([LLP 0101:354](/private/tmp/snapback-llp0101-r3.DWJ7Gy/llp/0101-inline-handlers-and-result-contracts.spec.md:354)). LLP 0043 caps each retained result at 65,536 bytes, globally at 64 MiB, and per authority at 8 MiB ([LLP 0043:217](/private/tmp/snapback-llp0101-r3.DWJ7Gy/llp/0043-offline-replay-retention.rfc.md:217)); those exact limits are enforced in [storage.rs:162](/private/tmp/snapback-llp0101-r3.DWJ7Gy/src/storage.rs:162) and [storage.rs:13342](/private/tmp/snapback-llp0101-r3.DWJ7Gy/src/storage.rs:13342). The current retained limit measures the serialized `MutationOutput`, not merely the handler payload.

   Resolution criteria: retain 64 KiB as an explicitly advertised stricter settlement/replay limit beneath the general 4 MiB egress ceiling, or amend LLP 0043 in the same landing with new per-result, global, per-auth, accounting, inspection, migration, and denial-of-service budgets.

6. **HIGH — MATERIAL: the no-top-level-side-effects proof is unsound.**

   Evidence: replacing only the handler expression does not remove unrelated definition-module initializers before isolated evaluation ([LLP 0101:110](/private/tmp/snapback-llp0101-r3.DWJ7Gy/llp/0101-inline-handlers-and-result-contracts.spec.md:110)). Current codegen deliberately evaluates the complete definitions module. More directly, the pure grammar admits class declarations and says their bodies are inert ([LLP 0101:120](/private/tmp/snapback-llp0101-r3.DWJ7Gy/llp/0101-inline-handlers-and-result-contracts.spec.md:120), [LLP 0101:149](/private/tmp/snapback-llp0101-r3.DWJ7Gy/llp/0101-inline-handlers-and-result-contracts.spec.md:149)); ECMAScript evaluates heritage expressions, computed keys, static fields, and static blocks at class definition time. The runtime executes bundle top level during preflight and warm setup ([runtime.rs:2227](/private/tmp/snapback-llp0101-r3.DWJ7Gy/src/runtime.rs:2227), [runtime.rs:2293](/private/tmp/snapback-llp0101-r3.DWJ7Gy/src/runtime.rs:2293)).

   Resolution criteria: define purity/slicing for the definition graph before it executes. Either disallow classes or validate heritage/computed/static components under an exact pure grammar and reject static blocks. Add adversarial definition- and runtime-graph tests.

7. **HIGH — MATERIAL: co-resident graph synthesis and implementation hashing are not deterministic enough.**

   Evidence: step 4 describes singular `export default <handler-expression>`, while the final artifact must contain one map for every handler ([LLP 0101:117](/private/tmp/snapback-llp0101-r3.DWJ7Gy/llp/0101-inline-handlers-and-result-contracts.spec.md:117), [LLP 0101:131](/private/tmp/snapback-llp0101-r3.DWJ7Gy/llp/0101-inline-handlers-and-result-contracts.spec.md:131)). Registration-ID derivation, map order, collisions, grouping, and operation count are not pinned.

   The hash section supplies outer framing but omits the digest algorithm, exact tag strings, scalar/composite encodings, list-count width, set ordering, and logical source-root encoding ([LLP 0101:193](/private/tmp/snapback-llp0101-r3.DWJ7Gy/llp/0101-inline-handlers-and-result-contracts.spec.md:193)). In addition, `declarationOrderedFields[]` remains order-sensitive under JCS because JCS does not reorder arrays, contrary to LLP 0037’s name-keyed encoding rule ([LLP 0037:135](/private/tmp/snapback-llp0101-r3.DWJ7Gy/llp/0037-schema-source-of-truth.decision.md:135)).

   Resolution criteria: specify one deterministic group-entry/map algorithm, registration key, collision refusal, ordering, and operation cap. Add a normative hash field table or pseudocode covering SHA-256, every tag/value/count encoding, name-keyed semantic object fields, and cross-language vectors. Keep author declaration order only as non-semantic projection/diagnostic metadata. Put measurable latency/RSS thresholds in the LLP 0009 benchmark amendment.

8. **HIGH — MATERIAL: the closed result/form migration is incomplete.**

   Evidence: `LegacyQueryRowsV0` is introduced after, but absent from, the closed Rust enum ([LLP 0101:334](/private/tmp/snapback-llp0101-r3.DWJ7Gy/llp/0101-inline-handlers-and-result-contracts.spec.md:334), [LLP 0101:482](/private/tmp/snapback-llp0101-r3.DWJ7Gy/llp/0101-inline-handlers-and-result-contracts.spec.md:482)). It merely permits the four system fields; current generated typing requires all four with concrete string/number types ([index.mjs:2971](/private/tmp/snapback-llp0101-r3.DWJ7Gy/packages/snapback-codegen/index.mjs:2971)). A row missing `_id` or returning `_version: "bad"` could therefore pass while violating its generated type.

   The supposedly closed form matrix also omits existing HostPlan query, live-query, mutation, and relational-query arms, although they are shipped authoring APIs ([define.d.ts:370](/private/tmp/snapback-llp0101-r3.DWJ7Gy/packages/snapback-codegen/define.d.ts:370), [define.d.ts:394](/private/tmp/snapback-llp0101-r3.DWJ7Gy/packages/snapback-codegen/define.d.ts:394), [define.d.ts:424](/private/tmp/snapback-llp0101-r3.DWJ7Gy/packages/snapback-codegen/define.d.ts:424)). No total mapping is given from their deterministic return arms and standard patterns into the result enum.

   Resolution criteria: add a canonical `LegacyQueryRowsV0 { object }` variant and hash/schema; require and type-check the exact four system fields while preserving undeclared non-system extras. Expand the form matrix and define a total result-contract mapping for every existing HostPlan, relational, action-plan, and standard-pattern return arm.

9. **HIGH — MATERIAL: Contract/provider projection is not a total transform.**

   Evidence: the result vocabulary adds null, literals, bounded scalars, IDs, arrays, unions, and JSON, but the closed missing reasons do not cover several of those shapes ([LLP 0101:273](/private/tmp/snapback-llp0101-r3.DWJ7Gy/llp/0101-inline-handlers-and-result-contracts.spec.md:273), [LLP 0101:458](/private/tmp/snapback-llp0101-r3.DWJ7Gy/llp/0101-inline-handlers-and-result-contracts.spec.md:458)). Current provider introspection supports only unknown, string/number/boolean, and object shapes ([provider-introspection.schema.json:94](/private/tmp/snapback-llp0101-r3.DWJ7Gy/packages/snapback-codegen/provider-introspection.schema.json:94)). Mutations have no result member, and actions have no bucket at all ([provider-introspection.schema.json:230](/private/tmp/snapback-llp0101-r3.DWJ7Gy/packages/snapback-codegen/provider-introspection.schema.json:230)), despite LLP 0101 requiring unsupported operations to remain present.

   Resolution criteria: mint an explicit provider-introspection revision carrying all operation kinds, result hashes, and witnesses. Define a total recursive mapping from every result-contract node to either a non-lossy descriptor or an exact closed missing reason. If `exact-vocabulary-version` is intended as a catch-all, define it as such and carry the offending path/kind.

10. **MEDIUM — DETAIL: shipped React evidence is incorrectly conditional.**

    Evidence: acceptance defers React and typed-group evidence together ([LLP 0101:576](/private/tmp/snapback-llp0101-r3.DWJ7Gy/llp/0101-inline-handlers-and-result-contracts.spec.md:576)), but React is already shipped ([capabilities.md:75](/private/tmp/snapback-llp0101-r3.DWJ7Gy/guide/capabilities.md:75)). The current hook strips a generated ref to its name before provider invocation and exposes user-selected result generics ([index.mjs:21](/private/tmp/snapback-llp0101-r3.DWJ7Gy/packages/snapback-react/index.mjs:21), [index.d.mts:63](/private/tmp/snapback-llp0101-r3.DWJ7Gy/packages/snapback-react/index.d.mts:63)).

    Resolution criteria: make React/React Expo evidence unconditional and conditionalize only genuinely unshipped typed groups. Require the complete runtime reference to cross the provider boundary and prohibit result-generic overrides.

## 4. Suggestions

- Replace “bounded retention eviction” with “acknowledged GC”; LLP 0043 explicitly forbids eviction of unacknowledged settlements.
- Add the three capability IDs to LLP 0058’s closed registry with maturity, positive predicates, absence behavior, and schema drift evidence.
- Name the guide pages that must change—getting started, queries, mutations, actions, live queries, protocol/native clients, offline retention, React, diagnostics, and the capability index.
- Update `Revised`; the target still records only the round-1 reconciliation.
- Add one compact lane table covering fresh, compatible, predecessor, resume, replay-hit, replay-miss, and acknowledgement behavior.

## 5. Open questions

- Is 4 MiB intended to replace the 64 KiB durable settlement limit or only govern general egress?
- Does “query groups” explicitly include the shipped `/app/bundle`/RQS surface?
- What exact literal does `ExpectedOperationV1.protocol` carry, and how is the observed admission policy bound to finite requests?
- Does tuple-independent acknowledgement include piggyback ACK or only the standalone route?
- May unrelated definition-module top-level application code execute inside the isolated evaluator?
- Is `exact-vocabulary-version` intended as a universal unsupported-shape reason?

## 6. Readiness verdict

The result vocabulary is mostly finite, but the full transformed graph is not; contract-compatible admission is unsound for inputs/schema; and replay/resume is not a total state machine. Those are implementation- and safety-blocking, not preferences.

VERDICT: NOT READY

## Round 2 — 2026-07-27

**Reviewer family:** OpenAI Codex  
**Provider / runtime:** Codex CLI 0.145.0, `gpt-5.6-sol`  
**Reasoning effort:** ultra  
**Date:** 2026-07-27  
**Redacted:** no  
**Method:** fresh CLI runner, read-only sandbox, mutually blind structurally
isolated capsule; delta-round instructions  
**Target SHA-256:** `412e4e2b53efc137d72d09b77fd0404f86f3fec10c9e196840430b01c41bcda1`  
**Capsule SHA-256:** `33f647eda6d95d3f487543422683e20817ce5a0e21730bcf63893120a6a96489`  
**Instruction SHA-256:** `ea678662e24a6ec47b4247efbd43267164803202d97fda39e7b9efbbf0083871`  
**Status:** completed

## 1. Overall assessment

LLP 0101 is substantially improved but not ready. The graph separation, warm-VM posture, source custody, result categories, and pre-publication validation direction are sound. However, the revision still contains critical replay and identity contradictions, and several supposedly closed graph, wire, and result-contract mechanisms remain under-specified or incompatible with shipped runtime arms.

## 2. Strengths

- Stable authorization identity is correctly separated from implementation compatibility.
- The original, definition-evaluation, and runtime graphs are explicitly distinguished without relying on `Function.prototype.toString()`.
- Resolver limits, root containment, reread attestation, and final capability scanning provide a strong foundation.
- The warm-VM language accurately distinguishes host-owned reset/fencing from persistent application lexical state.
- Query/action validation is placed before publication, while mutation validation is correctly required before commit.
- Retaining the original mutation validator and refusing lossy Contract projections are the right design directions.
- Public custody correctly excludes executable source, maps, paths, and spans.

## 3. Concerns

1. **Critical — MATERIAL: retained replay contradicts expected-operation ordering and artifact lifetime.**

   **Evidence:** Expected-operation members must be compared before settlement lookup, and predecessor tuples are accepted only while both complete artifacts remain installed ([LLP 0101 identity](/private/tmp/snapback-llp0101-r2.cg0wcR/llp/0101-inline-handlers-and-result-contracts.spec.md:202)). Yet replay under the original tuple must continue after a new deployment while only the validator is explicitly retained ([LLP 0101 replay](/private/tmp/snapback-llp0101-r2.cg0wcR/llp/0101-inline-handlers-and-result-contracts.spec.md:355)). Once the predecessor executable is evicted, the original tuple cannot pass the pre-lookup comparison. Pinning every predecessor until acknowledgement makes executable retention depend on indefinitely unacknowledged settlements.

   **Resolution criteria:** Define separate executable-tuple and settlement-only registries. After credential, authority, and descriptor validation, an existing `clientMutationId` must be compared against its stored tuple and frozen validator without requiring executable bytes. Settlement misses and fresh executions must require an installed exact executable tuple. Specify transactional reference counts, crash recovery, policy/removal behavior, capacity accounting, and ACK-driven collection.

2. **High — MATERIAL: structural document contracts do not identity-bind the schema they validate.**

   **Evidence:** `Documents {table}` and `Document {table}` validate against the named table’s current structural schema, but `resultContractHash` hashes only the nominal contract containing the table name ([LLP 0101 result hash](/private/tmp/snapback-llp0101-r2.cg0wcR/llp/0101-inline-handlers-and-result-contracts.spec.md:292)). The implementation-hash field list likewise omits the referenced structural schema. A schema-only field or optionality change can therefore alter runtime validation and generated TypeScript types without changing either expected hash.

   **Resolution criteria:** Bind a normalized expansion of the table schema and system-field policy into an effective validator hash carried by `ExpectedOperationV1` or `implementationHash`. Retained validators must be self-contained frozen expansions, never later table-name lookups. Add schema-only stale-reference and original-settlement replay vectors.

3. **High — MATERIAL: the stated post-JSON semantics disagree with the actual boundary.**

   **Evidence:** The proposal says non-finite numbers and unsupported prototypes fail serialization ([LLP 0101 post-JSON rules](/private/tmp/snapback-llp0101-r2.cg0wcR/llp/0101-inline-handlers-and-result-contracts.spec.md:276)). The harness actually uses captured `JSON.stringify` ([settlement serializer](/private/tmp/snapback-llp0101-r2.cg0wcR/packages/snapback-harness/ctx-bootstrap.js:1109)): `NaN`/infinity become `null`, `-0` becomes `0`, array holes/functions/symbols become `null`, object properties may be omitted, `Date`/`toJSON` can become strings, and maps or custom prototypes can serialize. LLP 0051 also distinguishes normalization from non-serializable suppression ([LLP 0051 value model](/private/tmp/snapback-llp0101-r2.cg0wcR/llp/0051-language-neutral-data-tier.rfc.md:523)).

   **Resolution criteria:** Either specify the exact existing ECMAScript JSON image—including all coercions—or introduce a stricter serializer and reconcile LLP 0051. Pin an adversarial cross-evaluator corpus covering non-finite values, `-0`, holes, functions/symbols, accessors, proxies, `toJSON`, dates, maps, custom prototypes, cycles, BigInt, and lone-surrogate sanitization.

4. **High — MATERIAL: the transformed graph is neither fully side-effect-free nor fully bounded.**

   **Evidence:** Class declarations are admitted as inert, but class evaluation can immediately execute `extends` expressions, computed keys, static field initializers, and static blocks ([LLP 0101 bundling grammar](/private/tmp/snapback-llp0101-r2.cg0wcR/llp/0101-inline-handlers-and-result-contracts.spec.md:121)). Replacing only the handler expression also leaves other definition-module top-level code executable, contradicting the claim that codegen executes no application top-level effects. Finally, the quantitative limits cover the runtime resolver, while the current definition bundler and generation worker have no equivalent file, AST, output, or elapsed-work caps ([definition bundler](/private/tmp/snapback-llp0101-r2.cg0wcR/packages/snapback-codegen/index.mjs:5757), [worker boundary](/private/tmp/snapback-llp0101-r2.cg0wcR/packages/snapback-codegen/index.mjs:442)).

   **Resolution criteria:** Reject classes in v1 or define a complete class grammar for heritage, keys, fields, blocks, and decorators. Qualify or enforce the definition-graph side-effect claim. Add per-graph and aggregate file, edge, depth, source-byte, AST-node, output-byte, handler-count, and elapsed-work limits before bundling/evaluation.

5. **High — MATERIAL: the runtime handler handoff and private-artifact split are unspecified.**

   **Evidence:** The proposal requires one default-exported handler and no global registry lookup, but every current runtime arm dispatches through `globalThis.__snapbackHandlers` ([Ibex preflight](/private/tmp/snapback-llp0101-r2.cg0wcR/src/runtime.rs:2216), [harness dispatch](/private/tmp/snapback-llp0101-r2.cg0wcR/packages/snapback-harness/ctx-bootstrap.js:1062)). Hermes script evaluation cannot consume an ESM default export directly. Separately, executable `IbexModule.source` currently lives in `FunctionManifest`, and codegen publicly exports that manifest from the generated package ([generated package exports](/private/tmp/snapback-llp0101-r2.cg0wcR/packages/snapback-codegen/index.mjs:1880)).

   **Resolution criteria:** Define a versioned sealed one-shot registration or lexical-handoff profile, including installation order, spoof resistance, exactly-once behavior, preflight, and warm-reset semantics for Ibex and Workerd. Define separate Rust-owned private-runtime and public-client artifact schemas, filenames, exports, publication paths, and exhaustive absence sentinels. Classify the proposed committed review manifest explicitly.

6. **High — MATERIAL: `implementationHash` is not a complete canonical transcript and omits shipped forms.**

   **Evidence:** The proposal does not enumerate exact tag strings, structured `valueBytes` encodings, list-count width, optional/boolean/digest encodings, canonical args encoding, or ordering for set-like declarations. “Resolved file identity,” source-root identity, and source-map paths are also ambiguous between logical hash identity and filesystem attestation. The closed form matrix and `handlerForm` omit shipped HostPlan queries, relational queries, and HostPlan mutations, despite their current first-class APIs ([current authoring forms](/private/tmp/snapback-llp0101-r2.cg0wcR/packages/snapback-codegen/define.d.ts:370), [relational codegen arm](/private/tmp/snapback-llp0101-r2.cg0wcR/packages/snapback-codegen/index.mjs:1146)). Declaration-order hashing also needs reconciliation with LLP 0037’s name-keyed encoding rule ([LLP 0037](/private/tmp/snapback-llp0101-r2.cg0wcR/llp/0037-schema-source-of-truth.decision.md:135)).

   **Resolution criteria:** Define a Rust-owned closed preimage schema with exact tags and encodings, semantic-set ordering, logical root-relative path rules, digest syntax, and golden preimage/digest vectors. Include every HostPlan, relational, standard-pattern, inline, legacy-module, and action-plan arm, with explicit absent-field rules.

7. **High — MATERIAL: rolling selection and the cross-lane wire carrier are not closed.**

   **Evidence:** `ExpectedOperationV1` is prose rather than a bounded Rust/serde DTO with an exact protocol token and placement in every wire schema. Rolling behavior is only one sentence, whereas the runtime currently has one active function vector and singular lookup. Nested `ctx.runMutation` carries only a string name ([nested action bridge](/private/tmp/snapback-llp0101-r2.cg0wcR/packages/snapback-harness/ctx-bootstrap.js:771)), so a predecessor action could silently invoke a successor mutation. RQS already MAC-binds `queryArtifact`, `generation`, and arguments ([RQS identity](/private/tmp/snapback-llp0101-r2.cg0wcR/src/rqs.rs:825)); LLP 0101 does not say whether `implementationHash` replaces or coexists with that identity.

   **Resolution criteria:** Define the DTO and its embedding in HTTP, live socket, bundle/group, resume-token, offline-store, external-store, React, and native lanes. Specify a bounded multi-artifact registry with atomic install/activate/evict rules. Nested calls must resolve within the outer operation’s captured complete artifact or carry their own expected tuple. Normatively reconcile `implementationHash` with RQS `queryArtifact` and generation rotation.

8. **High — MATERIAL: the recursive result vocabulary is not operationally finite or authorable.**

   **Evidence:** Per-node depth and fan-out limits do not provide a total validator-node or serialized-contract limit; nested unions can grow exponentially, and `Literal {canonicalJson}` has no explicit depth/byte accounting. Source constructors, defaults, and normalized encodings for null, literal, array, union, and scalar bounds are absent. The current `v` surface has only string, principal, id, boolean, integer, real, JSON, object, and optional ([current validators](/private/tmp/snapback-llp0101-r2.cg0wcR/packages/snapback-codegen/define.mjs:145)). Integer and finite-real variants also overlap on integral values unless both are treated as the same JSON-number kind for union disjointness.

   **Resolution criteria:** Specify exact builders and defaults, global contract-node and byte caps, aggregate variant limits, cycle/shared-graph treatment, and counting of literals under JSON limits. Define numeric union disjointness and canonical encodings, then freeze them with source-to-Rust/hash vectors.

9. **High — MATERIAL: the claimed legacy and query-envelope compatibility is not exact.**

   **Evidence:** Current legacy query `result` is a typing declaration; runtime validates only that the handler returned an outer array ([current runtime check](/private/tmp/snapback-llp0101-r2.cg0wcR/src/runtime.rs:467)). `LegacyQueryRowsV0` introduces field validation but does not define extra application fields, missing fields, optionals, nulls, or system-field outcomes. The proposal calls `{version, rows}` the existing query envelope, but shipped `QueryOutput` also has an optional relational cursor ([current envelope](/private/tmp/snapback-llp0101-r2.cg0wcR/src/manifest.rs:3703)). Finally, an omitted query contract must remain `unknown[]`; a kind-neutral `Unknown` payload would lose the row-array invariant.

   **Resolution criteria:** Either preserve the typing-only legacy lane or explicitly capability/version-gate the breaking validation change. Pin its complete field matrix. Preserve `cursor` in `QueryInvocation`, and define degraded results by operation kind: query/live `unknown[]`, mutation/action `unknown`.

10. **High — MATERIAL: `ContractProjectionWitnessV1` is not a total projection contract.**

    **Evidence:** The current provider vocabulary supports only unknown/string/number/boolean/object, has no action collection, and mutation entries have no result ([provider data types](/private/tmp/snapback-llp0101-r2.cg0wcR/packages/snapback-codegen/provider-introspection.schema.json:94), [mutation schema](/private/tmp/snapback-llp0101-r2.cg0wcR/packages/snapback-codegen/provider-introspection.schema.json:230)). The proposal nevertheless requires unsupported actions to remain in provider inspection. It gives no total mapping or precedence for arrays, null/literals, nominal IDs, and bounded scalar variants, and `descriptorHash` has no domain, preimage, or version definition.

    **Resolution criteria:** Version the provider schema to carry actions and mutation/action results, define an exhaustive projection matrix for every result enum arm, establish deterministic missing-reason precedence, and specify the canonical descriptor hash with golden vectors.

11. **Medium — DETAIL: bounded diagnostic pointers cannot always be constructed canonically.**

    **Evidence:** Pointers are capped at 16 segments and 256 UTF-8 bytes while declared field names are merely unique UTF-8 strings, and declared segments must use normal RFC 6901 escaping ([diagnostic rules](/private/tmp/snapback-llp0101-r2.cg0wcR/llp/0101-inline-handlers-and-result-contracts.spec.md:468)). One long declared name, or several ordinary names, can exceed the limit. No truncation or hashing rule exists for known segments.

    **Resolution criteria:** Bound authored field-name bytes so every maximum-depth pointer fits, or define deterministic escaped-segment truncation/hashing for known and unknown segments. Specify the unknown-key hash domain and privacy objective, and test long multibyte names plus `~` and `/`.

## 4. Suggestions

- Add normative matrices for operation form → hash fields, invocation lane → carrier location/check order, and deployment state → executable or settlement-only selection.
- Distinguish a declaration hash from an effective schema-expanded validator hash.
- Make the serializer corpus, hash transcript, and result-contract normalization shared golden-vector artifacts consumed by Rust, codegen JavaScript, browser/native clients, Hermes, and Workerd.
- Add crash-recovery tests for retained-validator references and predecessor artifact collection.

## 5. Open questions

- Must exact retained replay survive eviction of every predecessor executable artifact?
- Is expected-operation identity scoped to one operation or to a complete app artifact graph, including nested calls?
- Is `resultContractHash` intended to identify authored syntax or the effective installed-schema validator?
- Does `implementationHash` replace RQS `queryArtifact`, or must both remain?
- Are existing HostPlan and relational operations in the v1 result/expected-operation protocol?
- Is legacy query `result` intentionally becoming runtime-enforced?

## 6. Readiness verdict

The replay contradiction, schema-unbound validation identity, inaccurate JSON boundary, incomplete graph/runtime handoff, under-specified wire and hash contracts, and compatibility gaps are material blockers.

VERDICT: NOT READY
