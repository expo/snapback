**Reviewer family:** GPT
**Provider / runtime:** OpenAI GPT-5.6 Sol, collaboration sub-agent
**Date:** 2026-08-12
**Redacted:** no
**Method:** single-family super-refine, xhigh effort
**Protocol deviation:** Claude-family review omitted by explicit author request;
this artifact cannot support a dual-family convergence claim.

# Round 1 — standard design review

**Target hash:** `922a921bf11e06f334353e836d9b20e829bf05e3bab20ae6985587867c071ffa`
**Hash vector:** see the run journal at
`0245-0249-single-family-super-refine.md#round-1--standard-design-review`
**Capsule SHA-256:** `962cbf6bee5e980f827796f980f3a8bf1fce4594f076f15826dd77d5ef9a239d`
**Instruction SHA-256:** `a7152e6e4f990bbac1dfc18d746050fe37344e3db5d7f7d057bf468aa45dce17`
**State:** complete

## Verbatim review body

# Round 1 review

I maintained capsule blindness: I reviewed only `/tmp/llp-super-refine-0245-0249-r1`, inspected no live repository or external review artifact, and made no file edits. This review binds to capsule SHA-256 `962cbf6bee5e980f827796f980f3a8bf1fce4594f076f15826dd77d5ef9a239d` and the five target hashes stated in the instructions, which matched the capsule files.

## LLP 0245 — Infer, show, and freeze declarations

### MATERIAL concerns

1. **The stale-application guarantee has no implementable owner.** LLP 0245 §D1 says applying a stale suggestion must refuse, while §D1 and §D6 also say Snapback has no apply command and applying the patch is an editor/user action. A unified diff can reject textual context drift, but it cannot detect an unchanged source file paired with a changed schema, imported helper, type declaration, compiler configuration, or runtime-witness set. The Acceptance requirement that a source/schema change “refuses the stale patch” therefore cannot be met for manual paste or an unspecified editor action.

   **Concrete resolution:** define a Snapback-owned, single-suggestion verification/apply protocol usable by editors, while retaining the absence of bulk `--apply`. Bind it to one `analysisInputId` covering the complete analyzed source/helper/type closure, schema and generated-type facts, effective compiler configuration, analyzer versions, and any runtime evidence receipts. The editor must verify that identity immediately before writing. Alternatively, explicitly state that manual paste is not stale-safe, remove the stale-refusal claim for that path, and rely on ordinary generation to revalidate it.

### Non-material suggestions

- In §Rollout step 5, measure semantic correction and false-acceptance rates by confidence/evidence class, not only authored lines and elapsed time. That would test whether “show” actually prevents rubber-stamping.
- Give unresolved holes and refused candidate classes stable machine-readable reason codes so editor and CLI projections cannot invent separate vocabularies.

## LLP 0246 — TypeScript handler-module custody

### MATERIAL concerns

None.

The RFC preserves LLP 0237’s portable runtime boundary, keeps TypeScript checking downstream of frozen declarations, separates type-only and runtime edges, and correctly binds compiler/configuration/output changes into LLP 0241 identity and activation custody.

### Non-material suggestions

- Clarify in §D1/§D4 that the inherited file, depth, and source-byte bounds include type-only nodes. Otherwise implementers may accidentally leave the checker graph less bounded than the executable graph.
- Emit a generated editor project/configuration entry point using the exact effective profile from §D2. Merely diagnosing ignored project options may still leave the ordinary editor showing semantics that differ from generation.
- Add a golden for `.mts` import-specifier/output-extension mapping in addition to the general mixed-graph and source-map acceptance cases.

## LLP 0247 — Ordinary client normalization and recovery

### MATERIAL concerns

1. **Portable JavaScript cannot provide the promised Proxy refusal.** LLP 0247 §D1 requires a Proxy to refuse before resource or network work. JavaScript has no portable Proxy-detection operation; a Proxy can trap descriptor and prototype inspection and impersonate an ordinary object. This makes an explicit normalization guarantee infeasible across the headless, browser, React, and Expo arms.

   **Concrete resolution:** define admission in terms of observable own data-property descriptors and allowed prototypes, and state that Proxy traps cannot be excluded during in-process inspection. Keep the important guarantee that the resulting value must pass closed canonicalization before Snapback resource or network work. If executing no application trap is essential, require a separately branded/generated value carrier rather than arbitrary ordinary objects.

2. **The authority-blocked contract conflates one-shot reads with continuing resources.** LLP 0247 §D2 applies to “query/live” references and says anonymous authority produces a stable blocked snapshot, but LLP 0238 §D2 defines `client.read(QueryRef)` as a promise returning the query result, while LLP 0247 §D4 says `client.read` rejects refusals with `SnapbackDiagnosticError`. A one-shot promise has no stable resource snapshot, so the public return and recovery behavior is contradictory.

   **Concrete resolution:** freeze behavior per verb. For example, `watch` and live hooks may expose the stable `blocked/authentication-required` snapshot; `client.read` should either await `loading`/`refreshing` under explicitly bounded/cancellable semantics or reject locally, and should reject `anonymous`/`blocked` with `SnapbackDiagnosticError` before I/O. After authentication, callers issue a fresh `read`, while continuing handles construct a fresh authority-fenced query instance.

3. **Client-issued withdrawal on authority loss conflicts with the governing barrier.** LLP 0247 §D3 says authenticated-owner loss issues a delete under the captured connection/authority generation. LLP 0059 §Transition barrier removes predecessor bearer custody before participant quiescence and requires ephemeral callbacks/work to detach; LLP 0107 §Resync, authority, and lifecycle assigns revocation removal to the server barrier. Starting or awaiting an old-authority application delete during that transition is therefore stale at best and can obstruct the barrier at worst.

   **Concrete resolution:** limit client-issued withdrawal to published→`skip` and ordinary disposal while the captured authority is still current. On authority loss, synchronously stop keepalives, blank/quiesce the local owner, and rely on the server revocation/connection cleanup path plus TTL backstop. If a prompt explicit removal operation is required during transition, define it as a server/barrier-owned control operation rather than predecessor application work.

### Non-material suggestions

- Once the one-shot behavior is chosen, add acceptance coverage for client close/cancellation while a `read` is waiting through `loading` or `refreshing`.
- Specify whether withdrawal latency is measured against a generated target bound or a fixed profile value so the acceptance test is portable.

## LLP 0248 — Bounded batch reads

### MATERIAL concerns

1. **The unique-key domain is incomplete and partly assigned to the wrong phase.** LLP 0248 §D2 requires every indexed component “in index order,” and Acceptance says partial requests refuse at generation. Ordinary object property insertion order should not be an API requirement, and dynamic key objects cannot always be validated at generation. More importantly, LLP 0007 §Index Contract defines automatic unique-where-present indexes for optional fields: absent components do not participate in uniqueness and may correspond to multiple rows. LLP 0248 does not say that absent/null keys for such an index must refuse, yet `uniqueMany` promises one row or `null`.

   **Concrete resolution:** derive an exact runtime key validator from the index manifest. Accept exact component names regardless of object construction order, canonicalize internally in declared index order, and validate every dynamic element before storage work. Generation should refuse an unknown/non-unique index and statically malformed literal calls; runtime should refuse malformed dynamic keys. For `whereApplicable: true`, require every component to be present, non-null, and type-valid, or exclude those indexes from v1. Add single and compound optional-index acceptance vectors proving absent/null keys cannot become non-unique lookups.

### Non-material suggestions

- Add explicit acceptance for the published maximum canonical input bytes and maximum returned host-response bytes, not only the 256-item ceiling.
- State that physical chunk/statement facts exposed publicly depend only on public request/profile facts, never authorization-hidden row matches.

## LLP 0249 — Trusted package-capable actions

### MATERIAL concerns

1. **The authored TypeScript/module custody profile is undefined.** LLP 0249 §D1 uses `handler: "./actions/deliver.ts"`. LLP 0237 deliberately keeps the operation inline and rejects string-named handler custody, while LLP 0246 admits TypeScript only inside the package-free portable handler graph. LLP 0249 §D2 mentions a transform and final bundle identity but does not define the entry export, module graph, compiler configuration, source maps, or relationship to those two profiles. The example is therefore not an implementable closed source contract.

   **Concrete resolution:** either retain an inline operation declaration and define a separately named package-aware trusted-action source profile, or specify a closed external-entry profile including export convention, resolver, TypeScript compiler/configuration, package versus application edges, graph bounds, source maps, and semantic/executable identity. Explicitly state that this profile supersedes LLP 0237’s inline restriction only for trusted actions and does not reuse LLP 0246’s package-free profile unchanged.

2. **The actual isolation and Node capability boundary remains an open question.** LLP 0249 §D3 calls a “worker/process” the authority boundary, while §Open questions 2–3 leave Node built-ins and the authoritative sandbox undecided. A plain child process under the same user can generally read repository/database files, access ambient environment variables, open raw sockets, and signal sibling processes. Node built-ins such as `fs`, `net`, `dns`, `child_process`, `worker_threads`, `vm`, and `module` can bypass declaration-level checks. This conflicts with LLP 0009 §Capability Model, where runtime non-exposure—not static analysis—is the security boundary.

   **Concrete resolution:** close the v1 built-in/global table and map every admitted power to an explicit capability-aware shim or grant. Define a per-target isolation-profile requirement whose receipt names the enforcing OS/container primitives and proves repository, database, environment, process, IPC, and network separation. State that a same-UID unsandboxed child process is nonconforming and cannot advertise or activate the capability.

3. **The destination string does not define an SSRF-safe egress boundary.** LLP 0249 §D1/§D3 declares `network: ["api.vendor.example:443"]` and promises destination-only reachability, but it does not govern DNS rebinding, redirects, alternate address families, private/loopback/link-local/metadata addresses, TLS identity, Unix sockets, or raw Node networking APIs. A hostname allowlist alone can still reach protected host or control-plane services.

   **Concrete resolution:** define egress as a brokered connection policy enforced on every resolution and connection, with hostname/port/protocol and TLS identity binding; redirect reauthorization; denial of loopback, private, link-local, metadata, and local-socket destinations unless separately privileged; DNS-rebinding-resistant resolution/connect checks; and no raw socket/builtin bypass. Require target conformance tests for these cases before activation.

### Non-material suggestions

- Explicitly inherit LLP 0036’s opaque secret-handle, deliberate exposure, in-flight redactor snapshot, and no-value-hash rules for SDKs that require plaintext strings.
- Consider naming the profile `isolated-node-action-v1`; “trusted” can imply that package code itself is trusted when the design actually depends on containing it.
- Include cold-start, bundle size, source-map fidelity, and dependency-vulnerability/provenance output alongside latency and memory in the §Rollout comparison.

## Cross-document consistency

The set is directionally coherent in several important ways:

- LLPs 0245 and 0246 preserve frozen declarations as authority and use TypeScript only as checking or proposal evidence.
- LLP 0248 remains an imperative, bounded fallback beside LLP 0242 and makes no declarative-live, local-execution, or retention claim.
- LLP 0247 preserves LLP 0218’s queued-outcome distinction.
- LLP 0249 remains action-only and target-qualified rather than widening LLP 0237’s portable handlers.
- All five generally compose with LLP 0241’s immutable generation and identity model.

The unresolved cross-document seams are substantive:

- LLP 0247’s authority-loss withdrawal must defer to LLP 0059/0107 barrier ownership.
- LLP 0248 must consume LLP 0007’s `whereApplicable` unique-index fact.
- LLP 0249 must establish a package-aware TypeScript source profile rather than ambiguously straddling LLPs 0237 and 0246.
- The common metadata says `Status: Review`, while each concluding §Status still says “Draft.” Aligning those labels is non-material but should happen before the next bound revision.

VERDICT LLP 0245: NOT READY
VERDICT LLP 0246: READY
VERDICT LLP 0247: NOT READY
VERDICT LLP 0248: NOT READY
VERDICT LLP 0249: NOT READY
VERDICT SET: NOT READY

# Round 3 — final delta + implementer lens

**Target hash:** `06aee0324c71e22e9de1a863e0af16a6f65e891c1c1824c528450155cda3cec4`
**Hash vector:** see the run journal at
`0245-0249-single-family-super-refine.md#round-3--final-delta--implementer-lens`
**Capsule SHA-256:** `da12b8ed0542fb011172a6d2f9b0c71adf8930a10df63e555d0aa5582adc07fa`
**Instruction SHA-256:** `536eb812b77d615f4276419ca5b3d8078815dca9f3e620b7f10fb3733871876f`
**State:** complete

## Verbatim review body

# Round 3 final delta + implementer-lens review

## Scope and binding

I maintained capsule blindness throughout: I inspected only `/tmp/llp-super-refine-0245-0249-r3`, did not inspect the live repository, Git state, run journal, prior review artifacts, or any path outside the capsule, and made no file edits.

All five target files matched the authorized SHA-256 vector. This review is bound to capsule SHA-256 `da12b8ed0542fb011172a6d2f9b0c71adf8930a10df63e555d0aa5582adc07fa`.

No unresolved MATERIAL correctness, coherence, feasibility, safety, decision-quality, or implementer-divergence concern remains. I found no MATERIAL concern in pre-existing text.

## LLP 0245

### MATERIAL concerns

None, whether `IN-DELTA` or `PRE-EXISTING`.

### Non-material suggestions

- `PRE-EXISTING`: Freeze the exact `DeclarationSuggestionV1`, hole, evidence-class, and reason-code schemas before implementation. The RFC already assigns their ownership and required behavior; the remaining work is schema detail.
- `PRE-EXISTING`: Include a golden showing that manual paste and Snapback-owned apply produce identical frozen declaration identity while only the latter receives the stale-CAS guarantee.

### Implementer decision log

Closed with no material fork. The RFC decides that inference is proposal-only; frozen committed source is sole authority; Snapback-owned apply recomputes the complete analysis closure and exact before-state; manual paste carries no stale guarantee; result inference must hole or refuse unsupported refinements; dependency suggestions only add reads/writes; and receipts never acquire runtime authority. Analyzer encoding and presentation details cannot alter those decisions.

## LLP 0246

### MATERIAL concerns

None, whether `IN-DELTA` or `PRE-EXISTING`.

### Non-material suggestions

- `PRE-EXISTING`: Enumerate the editor-only `tsconfig` allowlist in the frozen profile artifact and golden-test representative ignored and refused options.
- `PRE-EXISTING`: Make the `.mts` source-to-emitted-specifier mapping a named conformance table in addition to the required local/hosted golden.

### Implementer decision log

Closed with no material fork. The RFC fixes a package-free, explicit-extension TypeScript profile; bounds type-only nodes inside the checker closure; distinguishes erased type edges from executable value edges; pins compiler, options, resolver, transform, emitted bytes, and source maps; refuses emit-producing TypeScript forms; and preserves frozen declarations as authority. The precise option table is delegated to the versioned profile, not left as ambient project behavior.

## LLP 0247

### MATERIAL concerns

None, whether `IN-DELTA` or `PRE-EXISTING`.

### Non-material suggestions

- `IN-DELTA`: Name the conditional-withdrawal wire outcomes and retry-state transitions explicitly—such as `deleted` and `superseded`—and include the already-required lost-response/retry-after-success vector.
- `IN-DELTA`: State in the generated lifecycle table that the acknowledged pair belongs to the exact room, entry key, connection, and authority generation, even though D3 already binds those facts semantically.

### Implementer decision log

Closed with no material fork. Optional omission is limited to exact optional properties and proceeds only from a captured closed data snapshot. Protected continuing reads block and rebuild across the authority barrier, while one-shot reads reject locally. The Round 2 withdrawal rule now gives the server an exact `(scopeEpoch, entryVersion)` compare under the room lock, additionally fenced by connection/authority generation. Every republish receives a successor version, so an older delayed or ambiguous withdrawal can only settle `superseded`, never delete that successor. Authority-loss cleanup remains exclusively server-barrier-owned. The common typed exception does not collapse queued or ambiguous lifecycle outcomes.

## LLP 0248

### MATERIAL concerns

None, whether `IN-DELTA` or `PRE-EXISTING`.

### Non-material suggestions

- `IN-DELTA`: Assign distinct stable diagnostics to request-item overflow, request-byte overflow, and response-byte overflow.
- `IN-DELTA`: State in the wire schema that the response bound measures the complete duplicate-expanded positional response, although “complete host-response bytes” already determines that outcome.
- `IN-DELTA`: Golden-test that physical chunk/statement facts remain identical when only hidden-versus-absent storage facts vary.

### Implementer decision log

Closed with no material fork. Item and canonical-input bounds are checked before storage; authorized snapshot reads and canonical serialization precede response-bound enforcement; neither phase releases a partial array. Deduplication affects physical work but not positional output. Unique-where-present keys must contain every non-null component. Internal OCC/invalidation evidence may retain logical keys, while public diagnostics expose only bounded count/byte/chunk facts and no key, digest, or commitment. These decisions prevent incompatible implementations from moving request admission after storage or leaking match-dependent public facts.

## LLP 0249

### MATERIAL concerns

None, whether `IN-DELTA` or `PRE-EXISTING`.

### Non-material suggestions

- `IN-DELTA`: Publish the canonical address-classifier corpus, deny-fact schema, challenge-consumption state machine, and receipt encoding alongside `IsolationProfileV1`.
- `IN-DELTA`: Include explicit mixed-answer DNS vectors proving that one non-global, noncanonical, scoped, or target-denied answer refuses the whole resolution.
- `PRE-EXISTING`: State directly that `runtime.secrets` is this profile’s projection of LLP 0036’s per-action `uses` grant into the same secret custody and inspection owner. The normative example and D3 already fix the effective grant behavior; this would consolidate vocabulary.
- `IN-DELTA`: Record the broker’s deterministic admitted-address selection rule for reproducible diagnostics, without weakening the requirement that every answer pass classification.

### Implementer decision log

Closed with no material fork. Static qualification cannot authorize a worker: readiness requires a live, privileged-launcher-signed, server-challenged, atomically consumed, session-bound attestation. Receipt mismatch, replay, expiry, or revocation stops admission and tears down the worker. Network access is positive admission over exact HTTPS tuples; every resolution and connection passes the registry-pinned versioned global-unicast classifier and target deny facts; the broker pins an admitted address and rechecks bounded redirects and TLS identity. The worker receives only the closed, capability-gated Node facade table. Package, runtime, secret, effect, and generation custody remain explicit and action-only.

## Cross-document consistency

The five documents compose coherently:

- LLP 0245 may propose declarations, while LLP 0246’s checker only checks them; neither makes TypeScript inference authoritative.
- LLP 0246’s package-free portable profile and LLP 0249’s separately named package-capable action profile do not overlap.
- Both source profiles feed LLP 0241’s semantic, executable, evidence, bundle, and generation identity split without making evidence-only changes executable.
- LLP 0247’s withdrawal predicate uses the existing room-local epoch/version ordering while preserving LLP 0059/0107 authority-barrier cleanup ownership.
- LLP 0247’s typed refusal carrier composes with LLP 0249 only after acceptance and does not change LLP 0218’s queued-dispatch or task-state truthfulness.
- LLP 0248 preserves existing visibility and unique-where-present semantics while adding only bounded exact-read host operations.
- LLP 0249 retains LLP 0036 secret handles, redaction snapshot, explicit exposure escape hatch, and no value/hash observability.

No cross-document seam remains materially underdetermined at RFC altitude.

PRE-EXISTING MATERIAL CONCERN: NO
VERDICT LLP 0245: READY
VERDICT LLP 0246: READY
VERDICT LLP 0247: READY
VERDICT LLP 0248: READY
VERDICT LLP 0249: READY
VERDICT SET: READY

## Close-out

The final READY verdicts bind to the Round 3 target hash vector and capsule
recorded above. No later target revision exists. This is a single-family
GPT-5.6 Sol recommendation, not dual-family convergence.

# Round 2 — delta + implementer lens

**Target hash:** `06aee0324c71e22e9de1a863e0af16a6f65e891c1c1824c528450155cda3cec4`
**Hash vector:** see the run journal at
`0245-0249-single-family-super-refine.md#round-2--delta--implementer-lens`
**Capsule SHA-256:** `b742700e72b23dd5ac97792caa5b58337b442902f884a5b2d4b88caea4f6004c`
**Instruction SHA-256:** `f1572d713159587381ee2e56dc8de1ad559086f00756e8853cde73ada8e94752`
**State:** complete

## Verbatim review body

# Round 2 delta + implementer-lens review

Capsule blindness was maintained: I inspected only `/tmp/llp-super-refine-0245-0249-r2`, made no edits, and did not inspect the live repository, external review artifacts, or git state. The five target hashes match the required vector. This review is bound to capsule SHA-256 `b742700e72b23dd5ac97792caa5b58337b442902f884a5b2d4b88caea4f6004c`.

Classification rule: `IN-DELTA` means the concern lies in the Round 1 revision summarized by the capsule; `PRE-EXISTING` means it lies in target text not identified as part of that revision.

## LLP 0245 — Infer, show, and freeze declarations

### MATERIAL concerns

None.

### Non-material suggestions

- D4 calls the suggestion receipt optional, while D6 says every acceptance is recorded in one. Clarify whether receipt persistence is best-effort, required for command success, or transactionally coupled to the source write. This does not affect runtime authority because D5 correctly makes the receipt dispensable.
- The eventual `DeclarationSuggestionV1` schema should name the canonical encoding and domain separator for `analysisInputId`, but D1 already assigns ownership and completeness adequately for RFC altitude.

### Implementer decision-log result

The implementation contract is derivable:

| Decision surface | Required behavior |
| --- | --- |
| `suggest` | Stable-snapshot, deterministic, versioned, read-only patch or JSON output |
| `suggestion apply` | Exactly one suggestion for one operation; recompute the complete analysis input; exact before/target comparison; atomic source write |
| Staleness | Any definition/helper/type-source, module-format, schema/generated-type, effective-config, compiler/analyzer, or used-evidence-receipt change refuses with `SNAPBACK_DECLARATION_SUGGESTION_STALE` |
| Result candidate | Exact contract vocabulary produces a candidate; missing refinements produce explicit holes; wider/unsupported types refuse |
| Dependency candidate | Static resolved site or runtime witness may add a declaration; incomplete closure is reported; removal is forbidden |
| Authority-sensitive fields | Auth, effects, secrets, capabilities, exposure, retention, and portability remain author-written |
| Freeze | Accepted source follows ordinary generation; suggestion evidence has no runtime authority |

No materially incompatible implementer choice remains. The Round 1 CAS, manual-paste limitation, stable refusal table, and evidence-class metrics close the stated delta.

## LLP 0246 — TypeScript handler-module custody

### MATERIAL concerns

None.

### Non-material suggestions

- State explicitly that profile-owned TypeScript library files and generated context declarations are not application checker-graph nodes for LLP 0237’s source-file/source-byte accounting, while every authored relative type-only node is. The current distinction is inferable, but an accounting note would prevent misleading diagnostics.
- Freeze the admitted editor-only strictness option list beside the profile artifact. Open question 2 appropriately leaves the exact list to implementation/spec work, because D2 already fixes ownership and forbids output/module-resolution changes.

### Implementer decision-log result

The implementation contract is derivable:

| Decision surface | Required behavior |
| --- | --- |
| Source profile | `.ts`/`.mts` plus existing `.js`/`.mjs`, explicit relative extensions, mixed bounded graph |
| Refusals | `.tsx`, `.cts`, authored declarations, packages/bare imports, Node, aliases, CommonJS, dynamic import, extension inference, output-bearing TS syntax |
| Bounds | LLP 0237 bounds cover authored runtime and type-only checker nodes |
| Compiler | Snapback-pinned TypeScript integrity and closed syntax-erasing ESM configuration |
| Editor | Generated exact `.snapback/typescript/tsconfig.json`; first-party integrations select it |
| Type authority | Frozen declarations type args/context/result checking; inferred TS types never mint declarations |
| Edge classification | Explicit type-only edges affect checker/evidence identity but not executable graph; value edges satisfy LLP 0237 |
| Identity | Runtime-relevant AST/graph/profile in semantic identity; compiler/options/transform/final JS in executable identity |
| Mapping | Integrity-checked source maps to authored TypeScript, with no absolute runtime paths |

The `.mts` golden, type-only-node bounds, and separation from LLP 0249 make the Round 1 delta implementable without widening the portable runtime.

## LLP 0247 — Ordinary client normalization and recovery

### MATERIAL concerns

1. **PRE-EXISTING — Same-authority withdraw/re-publish ordering is not closed.** D3 fences withdrawal only by connection/authority generation. It does not decide what happens when one owner transitions `published → skip → published` under the same authority while the delete is delayed, retried, or has an ambiguous outcome. Two competent implementations can:

   - serialize the successor publish behind withdrawal settlement;
   - publish immediately and cancel only local retries; or
   - use a server-checked owner-intent generation/expected entry version.

   The second choice permits a late predecessor delete to remove the newly published value, and client-side cancellation alone cannot recall an already admitted request. The existing ephemeral delete is idempotent but not described here as conditional on the entry version it intended to withdraw. D3 must select a stale-delete prevention rule and add delayed/ambiguous `published → skip → published` acceptance vectors. This concern is outside the summarized Round 1 authority-loss correction; that correction itself correctly assigns authority-loss cleanup to the server barrier.

### Non-material suggestions

- Freeze exact public codes for `loading`/`refreshing` one-shot refusal in the generated lifecycle table.
- Name the deprecated primary raw-envelope method in the compatibility section so package migration tests have one unambiguous subject.

### Implementer decision-log result

The normalization and auth tables are otherwise derivable:

| State/input | Required behavior |
| --- | --- |
| Optional closed-object property with own `undefined` | Omit before canonicalization; then apply declared defaults |
| Required property, array/tuple slot, open JSON, unknown/symbol/accessor/non-plain shape | Refuse before resource/network work |
| Live `loading`/`refreshing` | Stable pending/refreshing resource, no wrong-authority app request |
| Live `anonymous` | Stable blocked `authentication-required` snapshot |
| Live custody/protocol `blocked` | Preserve typed diagnostic/remediation |
| One-shot protected read in any non-authenticated state | Local `SnapbackDiagnosticError`; caller retries |
| Transition to authenticated | Cross LLP 0059 barrier and construct a fresh query instance |
| Authority-loss presence cleanup | Stop/blank locally; server barrier owns remote removal |
| One-shot primary API refusal | Common typed exception; queued dispatch and continuing task state remain truthful unions |

Because the same-authority presence transition is underdetermined, the full D3 state machine is not implementable safely from the document alone.

## LLP 0248 — Bounded batch reads

### MATERIAL concerns

1. **IN-DELTA — Input-bound and response-bound refusal phases remain textually conflated.** D3 says “bound overflow” refuses before storage work, while D4 adds a complete host-response byte bound whose overflow ordinarily cannot be known until authorized rows have been read and serialized. An implementation that treats all bounds as pre-storage either needs an unstated authoritative preflight or cannot meet the claim; one that checks response bytes after reads violates a literal reading of D3. State that item-count/canonical-input-byte overflow refuses before storage, while response-byte overflow is detected after snapshot-bound authorized reads but before any partial result is released.

2. **PRE-EXISTING — A raw digest is not a confidentiality boundary for requested logical keys.** D4 places a digest of requested keys in public diagnostics while `uniqueMany` explicitly admits low-entropy application keys such as handles. An unkeyed stable digest permits dictionary recovery and cross-receipt correlation even though raw keys are omitted. Separate internal OCC/invalidation identity from the public projection: publish only non-sensitive count/byte facts, or select an explicitly scoped keyed commitment with a stated disclosure model.

### Non-material suggestions

- Say directly that `uniqueMany` shares the portable `0..256` item bound with `getMany`; this is strongly implied by D2’s “match `getMany` semantics” and the single runtime-profile maximum.
- Name request-input overflow separately in D3 to make the intended phase correction obvious.

### Implementer decision-log result

The remaining contract is derivable:

| Decision surface | Required behavior |
| --- | --- |
| `getMany` | `0..256` exact ids; same order/length; duplicate lookup/authorization dedupe; hidden/missing both `null`; empty means no host transition |
| `uniqueMany` | Manifest-owned unique index only; exact closed keys; construction order ignored; canonical index order used |
| `whereApplicable` | Every component present, non-null, and type-valid before storage |
| Batch execution | One JS↔host request, one pinned invocation snapshot, no partial result |
| Failure/data split | Malformed request/index/policy-plan failures reject the batch; ordinary hidden/not-found entries are `null` |
| Dependencies | No weaker than equivalent individual reads for OCC/live invalidation |
| Physical implementation | SQL, values relation, or bounded chunks allowed; public chunk facts independent of hidden matches |
| Product boundary | Imperative positional hydration only; no projection callback, join, live/local/retention eligibility |

The two material evidence/phase issues prevent READY.

## LLP 0249 — Trusted package-capable actions

### MATERIAL concerns

1. **IN-DELTA — `IsolationProfileV1` has no authoritative issuance and binding contract.** D3 requires a “signed” receipt and D4 calls it live, but the RFC does not decide:

   - who may issue it or which trust root verifies it;
   - whether it is a static target qualification or a per-worker construction attestation;
   - which target/profile, worker/runtime build, OS/container policy, probe-corpus digest, launch nonce, and expiry/revocation facts it binds; or
   - how readiness prevents replaying a valid receipt beside a differently constructed worker.

   LLP 0224 establishes that supported-capability authority belongs to the executing runtime’s server-owned target registry, but it does not define this new isolation attestation. A self-signed or replayable local receipt would satisfy the prose without proving the authority boundary. The RFC must select the issuer/verifier and static-qualification-versus-live-attestation model, then bind readiness and negative probes to that model.

2. **IN-DELTA — The SSRF address rule is a non-closed denylist.** D3 names loopback, private, link-local, multicast, unspecified, metadata/control-plane, and local-socket targets, but does not freeze a canonical address classifier or treatment of all non-global/special-use, mapped, translated, and target-reserved forms. Competent brokers can therefore disagree about addresses outside the named categories, with one admitting non-public infrastructure. Define admission positively—canonical globally routable unicast under a versioned classifier, plus target-owned deny facts—and add normalization/equivalence vectors across IPv4/IPv6 forms.

### Non-material suggestions

- Freeze package-subpath, optional/peer dependency, conditional-export, and archive/symlink handling in the source-profile artifact.
- State explicitly that package content digests participate in LLP 0241’s behavior-relevant semantic graph as well as executable/bundle identity where required by that RFC.

### Implementer decision-log result

Most of the package-action contract is otherwise derivable:

| Decision surface | Required behavior |
| --- | --- |
| Selection | Explicit action-only `isolatedNode`; never inferred; never available to portable handlers |
| Source | External default async entry; inline contracts/capabilities; closed explicit-extension ESM app graph |
| Dependencies | One verified lockfile, declared direct packages plus locked ESM closure, no scripts/addons/CommonJS/dynamic or non-registry edges |
| Powers | Closed facade/grant table; process/env/fs/raw network/subprocess/VM/Wasm absent |
| Network | Brokered HTTPS only, exact host/port grant, pinned resolution, TLS identity, at most five separately authorized redirects |
| Secrets | LLP 0036 handles or deliberate `expose()`; attempt-snapshot redaction; no read-back/hash |
| Isolation | Read-only bundle, bounded resources/scratch, no repository/database/admin access, OS-enforced process separation |
| Lifecycle | Snapback owns build/start/health/reload/teardown; unqualified targets refuse activation |
| Effects | Pinned attempt/idempotency/deadline/receipt; post-admission loss remains ambiguous absent provider proof |

The unsigned trust model hidden behind the word “signed” and the incomplete address-admission rule are security-boundary decisions, not implementation details.

## Cross-document consistency

- LLP 0245 correctly keeps inference subordinate to LLP 0108 declarations and composes with LLP 0246 only as evidence.
- LLP 0246 preserves LLP 0237’s package-free runtime; LLP 0249 uses a separately named action source/runtime profile and does not widen the portable graph.
- LLP 0247’s Round 1 authority-loss rule aligns with LLP 0059/0107 by assigning remote removal to the server barrier. Its unresolved same-authority delete race is a separate owner-intent sequencing problem.
- LLP 0248 remains the imperative exact-lookup fallback described by LLP 0242 and makes no declarative/live/local/retention claim.
- LLP 0249’s conditional use of LLP 0247’s public diagnostic type is coherent because it is explicitly gated on LLP 0247 acceptance.
- No additional material contradiction among the five targets or their capsule-local governing documents was found.

Material concern exists in pre-existing text: LLP 0247’s same-authority withdrawal sequencing and LLP 0248’s public logical-key digest. The Round 1 deltas for LLP 0248 and LLP 0249 also retain material concerns.

PRE-EXISTING MATERIAL CONCERN: YES
VERDICT LLP 0245: READY
VERDICT LLP 0246: READY
VERDICT LLP 0247: NOT READY
VERDICT LLP 0248: NOT READY
VERDICT LLP 0249: NOT READY
VERDICT SET: NOT READY
