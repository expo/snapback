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

# Round 2 — delta + implementer lens

**Target hash:** `06aee0324c71e22e9de1a863e0af16a6f65e891c1c1824c528450155cda3cec4`
**Hash vector:** see the run journal at
`0245-0249-single-family-super-refine.md#round-2--delta--implementer-lens`
**Capsule SHA-256:** `b742700e72b23dd5ac97792caa5b58337b442902f884a5b2d4b88caea4f6004c`
**Instruction SHA-256:** `f1572d713159587381ee2e56dc8de1ad559086f00756e8853cde73ada8e94752`
**State before launch:** awaiting verbatim review body
