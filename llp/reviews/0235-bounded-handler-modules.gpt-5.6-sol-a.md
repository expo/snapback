# Round 1 isolated review — LLPs 0235–0241

## Provenance

- **Reviewer:** Codex GPT-5.6-sol, reviewer A
- **Effort:** xhigh
- **Round:** 1
- **Review mode:** author-directed single-family adaptation of `llp-super-refine`; isolated capsule review
- **Lens:** architecture, correctness, security, ownership, and cross-RFC coherence; specifically conflicts with governing LLPs, duplicated authority, unsafe inference, unbounded work, false capability claims, missing compatibility boundaries, and set-level sequencing cycles
- **Evidence boundary:** only the supplied review capsule was read. No live-workspace source, review artifacts, or orchestration notes were read.
- **Capsule hash (instructions excluded):** `683c25563bf5e966871fe8d8ec150b88a9230e87e9876b0aab8c81d39a598c20`
- **Target hash vector:**
  - LLP 0235: `fd16424a1120161071d158a5d89c9d7fab92604588dd506fd2e80c4d7167e730`
  - LLP 0236: `6bbe63bde02cfd0df78af3810b29b2459e20a7327f30cdc997755803415e2cd2`
  - LLP 0237: `1d0415cae8ee169ef4a06d76e180cc351f2d74b7ab4d403027959f0a02828808`
  - LLP 0238: `b39f0eeb832c874b81bb818b06b4980fa754ca10f474250035a56b3dfc511d21`
  - LLP 0239: `c94f027ad96369182aed5095ccff631abad025831f89bf223d21b61391f99d8e`
  - LLP 0240: `7af931953fbf8da27bd32fc0261b337064c292847812c55e93de26337ad13c6a`
  - LLP 0241: `626942dbca8cc8a44fc9bb3c01375e37e64028823eae7fa5644f49a20ab15d91`

## LLP 0235 — Bounded handler modules

### Concise summary

The RFC admits literal relative helper imports through a Snapback-owned, closed, bounded, content-addressed graph while retaining inline operations as the declaration and authorization locus. It keeps fresh-per-invocation execution, refuses ambient package/host capabilities, separates executable identity from source evidence, and makes admission rules available through preflight and generated profile metadata.

### MATERIAL concerns

None. The proposal preserves the no-eval and capability boundaries, treats declarations as evidence rather than silently enforced authority ceilings, gives codegen—not a host loader or bundler—admission custody, and keeps unsafe or unknown forms fail-closed.

### MINOR concerns

1. V1 should explicitly state whether module cycles and named re-export chains are refused or admitted. The closed resolver can implement either safely, but cycle/TDZ behavior is part of the authored profile and should appear in the generated rule table rather than emerge from a transform.
2. “Bounded integer expression” needs a closed grammar/range in the implementation Spec and runtime-profile artifact. This is not a design blocker because the RFC already defaults unknown computed access to refusal.
3. The relationship between the graph edge recorded in implementation identity here and LLP 0239’s proposed exclusion of source paths from semantic/executable identity must be reconciled before either identity format freezes; this becomes material in LLP 0239 because that document currently makes conflicting promises.

### Author-decision questions

1. Prefer emitted `.js`/`.mjs` as the v1 custody boundary; direct `.ts` admission can follow only with a pinned transform identity.
2. Keep the reviewed 64-file/16-depth/512-KiB/256-KiB envelope for the opt-in slice, then allow the benchmark to justify a smaller automatic default rather than leaving the first implementation unbounded.
3. Refuse module cycles in v1 unless a concrete diary demand justifies specifying cross-module cycle semantics.

VERDICT: READY

## LLP 0236 — Explicit client lifecycles

### Concise summary

The RFC establishes nominal operation kinds, explicit one-shot/live/dispatch/settlement/task/presence verbs, one observable-handle grammar, kind-specific React/Expo hooks, canonical semantic input keys, and a first-class current-principal projection. It correctly preserves LLP 0218’s distinction between dispatch and durable settlement and projects existing framework-neutral owners rather than creating new transport or auth owners.

### MATERIAL concerns

None. The lifecycle distinctions are coherent with the governing outbox, auth, live-query, and React ownership contracts, and mismatches fail before transport work.

### MINOR concerns

1. `ObservableHandle` does not include `refresh()`, while the acceptance text says a headless watch has typed `refresh`. Define a `WatchHandle` extension and freeze whether initial `subscribe` notification is synchronous or scheduled; React external-store correctness should not depend on an arm-specific interpretation.
2. `useSnapbackRead` is listed as a decided primary hook while Open Question 1 still asks whether it should exist. Resolve that API-shape question before generated manifests and examples freeze.
3. The durable `mutation(id)` observer should state explicitly that lookup remains authority-partitioned and that unknown, predecessor-authority, and collected identities produce typed states; LLP 0218/0043 can remain the owner.

### Author-decision questions

1. Choose `watch` or `live` once and generate it everywhere; `watch` is the clearer contrast with one-shot `read`.
2. Prefer an observable durable mutation handle over a process-local promise, as the RFC proposes.
3. Declare the major compatibility epoch only after published-package call-site measurements; it need not block accepting the lifecycle grammar.

VERDICT: READY

## LLP 0237 — Asset collections and the media field

### Concise summary

The RFC adds a distinguished optional media field, a bounded generated collection relation, a multi-upload command, declarative sharing, and a unified media projection. It correctly refuses opaque arrays of asset references and preserves typed references, finalization, attachment, GC, revocation, and signed-delivery custody.

### MATERIAL concerns

1. **The command’s atomic commit owner is undefined and conflicts with the governing command contract.**
   - **Defective decision:** D3 gives a client command an arbitrary authored `map` callback plus an `attach` directive and promises that the named ordinary mutation and all collection/grant changes commit atomically.
   - **Evidence:** LLP 0180’s “Decision” and “Execution” sections define a command as client composition, explicitly not a server transaction or command endpoint; its closed descriptor contains reference identities and declarative argument mappings, and the ordinary mutation is the sole application commit. In 0237, `attach.parentResult` is learned only after the handler result, but no server-owned wrapper, mutation-manifest augmentation, unforgeable carrier, replay identity, or commit hook is selected. The executable `map` callback also has no stated admission, execution, authority, or identity owner.
   - **Consequence:** The atomicity claim cannot be implemented from the existing client-only command descriptor without inventing a material server execution surface. Executing `map` on the client cannot confer authority; executing it on the server silently adds executable application code outside LLP 0235’s custody. A direct call to the underlying mutation also has undefined attachment behavior.
   - **Concrete repair:** Choose and specify one model. The narrowest repair is a closed declarative mapping IR plus a versioned command binding in the target mutation manifest; the server validates that binding and stages generated collection/grant operations in the same storage commit after the handler result, with command/operation identity, replay behavior, direct-mutation behavior, and commit-time reauthorization frozen. Alternatively, define a generated server-side wrapper mutation with its own args/result/authority/replay identity. In either model, remove the arbitrary `map` callback or admit it explicitly through the bounded handler profile and bind it into executable identity.

### MINOR concerns

1. `grants: "inherit-command"` appears on the collection while D4 places the grant plan on each command. Define precedence and generation identity when several commands can mutate one collection.
2. Retry reuse of already-ready asset ids should explicitly require current commit-time intent, profile, grant, and parent authority revalidation; upload-time authority is not enough.
3. The implementation Spec should freeze whether `MediaRef.kind` is carried on the row or joined from authorized metadata, as already acknowledged by Open Question 1.

### Author-decision questions

1. Is `mediaCommand` a closed specialization of the existing command descriptor, or a generated server mutation? This must be decided before acceptance.
2. Start v1 without arbitrary manual reordering if that materially shortens the collection transaction proof; add it without changing collection identity semantics later.
3. “Playable video” should remain target-qualified until the existing video-finalization/rendition capability is actually present on each claimed target.

VERDICT: NOT READY

## LLP 0238 — Application authority profiles

### Concise summary

The RFC tries to make one application-visible roster and finite role profile feed visibility, writes, live invalidation, search, assets, inspection, and generated roster operations. It also offers an honest online-only declaration for custom function-mediated authority and correctly refuses to infer retention or pushdown from opaque policy.

### MATERIAL concerns

1. **The proposal creates a second finite-role authority architecture instead of defining its relationship to the existing membership authority.**
   - **Defective decision:** D1/D2 introduce `defineAuthorityProfile` and a new `AuthorityProfileV1` IR, while Compatibility says LLP 0056 memberships remain supported and may project or migrate, but does not make the new profile a lowering/extension of the existing membership manifest and predicate IR or prevent both from governing the same scoped relation.
   - **Evidence:** LLP 0056 already decides that memberships are ordinary app tables in a system-recognized shape, with a closed role vocabulary, generated transition methods, a central raw-write fence, last-holder invariants, predicate IR, visibility/invalidation wiring, exports, and a visible-member projection. LLP 0231 D6 separately fixes the table declaration and one policy IR as the shared read/write locus. The proposed profile substantially overlaps both owners but maps neither identity nor lifecycle.
   - **Consequence:** Two role vocabularies, transition machines, generation identities, and policy compilers can disagree about the same roster. Search, assets, table reads, and invalidation could then consume different authority truth—the dual-source problem this RFC is intended to remove.
   - **Concrete repair:** Define `AuthorityProfileV1` as a strict versioned extension/facade that lowers to LLP 0056’s membership manifest, predicate IR, central writer seam, and LLP 0231’s table-policy IR. Map status, hierarchy, owner/bootstrap, transitions, identity, invalidation, and inspection explicitly. If that is impossible, state that the new profile supersedes the old declaration for a relation and add an activation/migration rule that forbids co-active authorities for the same stable profile id.
2. **“Codegen proves every authority-bearing write is governed” has no enforcement mechanism in this RFC.**
   - **Defective decision:** D1 makes complete write ownership an activation condition, and Risks repeats that codegen must prove it, but no host/storage boundary is selected.
   - **Evidence:** LLP 0146 and LLP 0235 explicitly preserve declared/captured reads and writes as evidence, not enforced ceilings. Static declaration inspection therefore cannot prove that arbitrary handler, host-plan, seed, import, admin, or future adapter writes cannot mutate the profile table. LLP 0056 solves this exact problem with a gate below every writer and typed raw-write refusal.
   - **Consequence:** Treating declaration coverage as proof is fail-open: an undeclared or dynamically reached write could mint or preserve authority outside the transition machine. Alternatively, implementers must invent an unreviewed table-write capability system.
   - **Concrete repair:** Bind profile tables to the existing central writer-class seam (or specify an equivalent unbypassable storage gate) so all writer classes enforce the closed transition/final-state invariants transactionally. Use codegen/conformance only to explain reachability and migration; do not make it the security boundary.

### MINOR concerns

1. The example’s owner role is declared on `rooms.ownerId`, while the roster role vocabulary contains only `member` and `admin`, yet `remove` names “admin-not-last-owner.” State whether `owner` is a synthetic lattice role, a protected LLP 0056 holder, or an independent invariant.
2. The custom-policy descriptor should say that any strictness mode may only strengthen refusal; it must never let observed undeclared authority inputs retain the static claims.

### Author-decision questions

1. Ship one source-of-truth mode first. The safest first slice is an app-table-authored facade over the already enforced LLP 0056 machinery, not two independent modes at once.
2. Decide the minimum role/status/transition vocabulary by mapping it to the existing transition grammar before adding hierarchy as a new semantic feature.

VERDICT: NOT READY

## LLP 0239 — Semantic artifact generations

### Concise summary

The RFC separates semantic, executable, evidence, and bundle identities; emits immutable application-generation envelopes; classifies changes into closed reload classes; moves one current pointer only from a server-owned positive activation fact; and reloads custodians only at safe boundaries. Its direction preserves fail-closed identity while removing evidence-only runtime churn.

### MATERIAL concerns

1. **Predecessor generation residency is explicitly unbounded.**
   - **Defective decision:** D5 requires predecessor objects to remain alive until in-flight invocations/tasks release them, while compatible successors continue activating. The maximum lifetime and behavior of a task that exceeds it are left to Open Question 4.
   - **Evidence:** Commands and tasks may be long-running; D5 also preserves exact original generation ids for task, queued mutation, settlement, and resume records. Risks acknowledges that every custodian needs a bounded retirement registry but the Decision specifies no generation-count, byte, time, or outstanding-owner ceiling and no activation backpressure.
   - **Consequence:** Repeated reloads plus stuck or adversarial tasks can retain unbounded executable bundles, VMs, handles, and native resources. An implementation must invent whether to interrupt work, refuse activation, strand replay, or leak predecessors—material lifecycle behavior.
   - **Concrete repair:** Freeze a bounded retirement contract: maximum resident generations/bytes/time per custodian, owner accounting, activation backpressure, and a typed policy for over-bound invocations/tasks (finish within lease, checkpoint into a versioned resumable protocol, cancel/refuse, or block successor activation). Separately state how durable exact-generation records behave after executable retirement; a durable record must not imply indefinite resident code.
2. **The source-relocation and graph-identity rules conflict within this set.**
   - **Defective decision:** D1 excludes source paths from semantic/executable identity and Acceptance says a source relocation with stable canonical source preserves both ids, while Open Question 2 leaves helper moves unresolved. LLP 0235 D4, which this RFC claims to generalize, binds normalized graph edges into implementation identity.
   - **Evidence:** Moving a helper can change relative resolution, module topology, initializer order, and admitted graph edges even if helper AST bytes look equal. The set currently provides no exact equivalence rule that distinguishes a path-only evidence change from an executable graph change.
   - **Consequence:** The same edit can be classified evidence-only by LLP 0239 and implementation-changing by LLP 0235, so activation, stale-reference checks, and verification receipts cannot agree. Treating the edit as evidence-only without a frozen equivalence proof weakens identity safety.
   - **Concrete repair:** Pick the conservative v1 rule and align both RFCs: normalized executable graph-edge/topology changes rotate implementation/semantic identity; only source relocation that leaves the admitted executable graph record and final executable bytes exactly unchanged may be evidence-only. Freeze golden vectors for the permitted case and defer broader semantic relocation equivalence.

### MINOR concerns

1. D3 says every pair gets exactly one reload class but also allows mixed per-consumer dispositions. Define the deterministic global-class join (normally the most restrictive disposition) so two tools cannot summarize the same diff differently.
2. For evidence-only updates, specify the compare-and-swap relation between the file projection, server inspection fact, bundle id, and unchanged readiness nonce; “pointer” must not acquire two writers.

### Author-decision questions

1. Use a Merkle application generation with independently addressable operation/schema/policy sub-identities, while keeping activation atomic at the generation cut.
2. Keep public contract changes exact in v1; earn contract-widening compatibility only with explicit old/new decoder vectors.
3. Make the generated-module loader the first reference `GenerationWatcher`, then generalize after its retirement accounting is proven.

VERDICT: NOT READY

## LLP 0240 — Bounded query composition

### Concise summary

The RFC proposes one closed `ProjectionPlanV1` with shallow children, aggregate, activity, and feed nodes; declared indexes and bounds; authorization-preserving results; target capability facts; and generated explain/refusal surfaces. It correctly keeps arbitrary JavaScript as the explicit escape hatch and separates server, live, local-transform, and retention claims.

### MATERIAL concerns

1. **The aggregate node does not choose a bounded work/result semantics.**
   - **Defective decision:** D3 admits count/exists/sum/min/max and lets the implementation choose on-demand or incrementally maintained execution, but its source example has no `take` or examined-entry ceiling and the RFC does not specify exact-or-refuse, capped, paged, or maintained semantics.
   - **Evidence:** LLP 0120’s “Bounded aggregate result semantics” identifies five materially different products and requires explicit admitted range, overflow, empty-group behavior, and protected-source noninterference. LLP 0155’s Move 1 guardrail says no aggregate exists until those decisions are made. D3 only says integer/finite-real, index-backed min/max, and visible-row disclosure; it leaves integer/real overflow, accumulation order/precision, empty min/max, count limits, refusal disclosure, and write-side behavior of maintained values undefined.
   - **Consequence:** An on-demand aggregate can scan unbounded data despite this RFC’s core constraint. Cross-target byte-equivalence and equivalence between on-demand and incremental execution are impossible to implement without inventing numeric and overflow contracts, and protected overflow/refusal may become a row-existence oracle.
   - **Concrete repair:** Select one explicit v1 profile—prefer bounded exact or exact-or-refuse count/exists over a declared indexed range and integer-only sum at first. Freeze maximum examined entries, result types, overflow/refusal, empty-input values, deterministic accumulation, visibility-before-aggregation, and noninterfering refusal behavior. Treat maintained exact aggregates as a distinct versioned node with transactional write semantics, not an invisible implementation swap, until equivalence is proved.
2. **New multi-child composition omits the common-snapshot/completeness contract.**
   - **Defective decision:** D2 allows one root and four independently paged child collections, but neither D1 nor D2 states that the composite is established at one authoritative snapshot or how completeness changes when one child cursor advances.
   - **Evidence:** LLP 0155 Move 1 requires a composite witness over plan, args, authority partition, query instance/generation, snapshot version, and all nodes; independently hydrated nodes at skewed versions must be `unknown`, not a complete result. The target RFC promises exact results and independent cursors but does not carry that state.
   - **Consequence:** Clients can assemble individually valid but mutually skewed root/child fragments and present them as one exact projection. Cursor advancement or partial refusal can silently preserve a false complete state.
   - **Concrete repair:** Add the common authoritative snapshot and compositional completeness witness to `ProjectionPlanV1` and its client result. Define one-sealed-node behavior, continuation transitions, and that advancing or invalidating any node returns the composite to `unknown` until re-established.

### MINOR concerns

1. Feed continuation should freeze whether its cursor carries a bounded per-scope frontier or a server-side cursor object; the current prose proves fan-in bounds but not continuation state size/lifetime.
2. Activity’s optional one-to-one lookup is an avoidable first-version expansion. Keeping v1 source-self-contained would reduce the cursor/noninterference proof surface.
3. Target-lower feed limits should be part of plan admission identity, not only an activation diagnostic.

### Author-decision questions

1. Start aggregates with scalar count/exists over a closed range; defer enum grouping, real sums, and maintained projections.
2. Require a minimum target capability for `projection.feed.v1`; lower target limits should use a distinct admitted profile rather than return partial pages.
3. Keep maintained projections implementation-owned until migration, backup, write-amplification, and authority-partition semantics are separately accepted.

VERDICT: NOT READY

## LLP 0241 — Policy-aware protected retention

### Concise summary

The RFC productizes protected cold-read retention for exact generated query projections, with server-issued time bounds, pre-storage exclusions, partitioned real client stores, ordinary live-query hooks, reconnect reauthorization, coarse-safe invalidation, and capability truth. Its intended query-scoped custody and explicit `retained` freshness are sound.

### MATERIAL concerns

1. **The RFC creates an apparently parallel lease/store identity and drops the existing never-reused query-instance axis.**
   - **Defective decision:** D2/D3 name new `RetainedProtectedViewV1` and `AuthorizedRetentionLeaseV1` contracts, while D5 keys storage by app/data/user/authority/descriptor/args. The descriptor and lease field lists omit the existing `(clientStoreId, queryKey, queryInstanceId)` identity and do not say they extend the shipped `AuthorizedLease` and JS `authorizedQueryRetention` slot.
   - **Evidence:** LLP 0053 “The lease” and LLP 0043 “JS/React owned carrier composition” make a never-reused query instance load-bearing: lease, obligation, deletion, reservation, rows, and tombstones are scoped to that exact instance so stale completion for A cannot mutate successor B at the same canonical query key. LLP 0043 already owns the atomic JS carrier slot and warns that importing a second store owner would split authority transitions.
   - **Consequence:** A stale lease, invalidation, asynchronous completion, or deletion can address a later retained view with equal descriptor/args, or the implementation must invent a second authority coordinator. The proposal also duplicates an already implemented lease authority instead of productizing it.
   - **Concrete repair:** Make the retained-view descriptor a versioned eligibility/projection input to the existing `AuthorizedLease`/`authorizedQueryRetention` state machine. Preserve the exact client-store/query-key/query-instance tuple, request reservation, composite witness, activation binding, derived deadline/high-water, atomic install, instance-scoped deletion, and terminal retirement. Specify a fail-closed migration from the current slot; do not create a parallel lease owner.
2. **Offline “signature validation” contradicts the governing verification locus.**
   - **Defective decision:** D3 says a corrupt signature deletes before read, D5 validates “lease/signature/time,” and Acceptance requires a corrupt lease to quarantine/delete before application read, without changing the cryptographic scheme or distributing verifier material.
   - **Evidence:** LLP 0053’s amended “Verification locus” is explicit: `AuthorizedLease` uses a server-secret MAC; the client cannot cryptographically verify it. Offline custody can validate structure, exact bindings, duration/clock arithmetic, and the stored unkeyed hash of issued bytes. Unknown keys and a canonically shaped forged MAC are detectable only by the server when presented online. LLP 0043 repeats this boundary.
   - **Consequence:** The stated offline acceptance is impossible under the governing protocol and risks a false security claim. An implementer would either pretend to verify a secret-key MAC or silently introduce a new public-key/key-distribution protocol.
   - **Concrete repair:** Restate client acceptance precisely: before offline read, reject malformed structure, binding/hash substitution, rollback, or expiry; server-side keyed verification happens on revalidation/service. If client-verifiable signatures are desired, commission and specify a new signed-lease protocol with verifier-key distribution, rotation, retirement, target binding, migration, and adversarial vectors rather than implying it here.

### MINOR concerns

1. D7 should distinguish matcher-path/data-plane permission changes from enumerated authorization-epoch events. A global epoch may conservatively handle the latter, but ordinary negative row changes still need the existing result-dependence/obligation path.
2. The exclusion transform should bind derived-field provenance for every admitted plan; validating free-form output paths alone is insufficient if a later plan can derive sensitive source material into an innocently named field.
3. Backup/restore may remain open, but the first capability must explicitly omit protected namespaces from logical export unless the existing physical-custody contract is preserved.

### Author-decision questions

1. Use the existing global authorization epoch for the first productized slice unless a narrower witness is already proven by the governing lease profile.
2. Six hours is a reasonable authored default below the fixed 24-hour hard maximum, but it must remain target-clamped and app-narrowable.
3. Keep v1 to generated plans and closed owner/user/profile policies; exact-result JS handlers can graduate only after dependency and exclusion completeness are independently proved.

VERDICT: NOT READY

## Set-level consistency

The seven documents share the right high-level posture: generated and versioned facts, closed bounded grammars, fail-closed unknowns, server-derived authority, typed diagnostics, target-qualified capabilities, and staged advertisement. LLP 0235 and LLP 0236 are usable foundations for the rest.

The set is not yet coherent enough to accept lockstep:

1. LLP 0237 needs a server-side transactional owner before its media command can compose with LLP 0236’s client task lifecycle truthfully.
2. LLP 0238 must lower to or explicitly supersede LLP 0056/0231 authority rather than create a second policy machine; LLP 0241 must then consume that one admitted authority identity.
3. LLP 0240 must freeze aggregate and composite-witness semantics before LLP 0241 can call a projected result retention-eligible.
4. LLP 0239 must consume the stable sub-identities of 0235/0238/0240/0241, but those RFCs must not depend on automatic generation reload for their own safety. The implementation order should therefore freeze each subsystem’s versioned artifact first, then add the application-generation envelope and watcher.
5. LLP 0239’s graph/source relocation rule must agree with LLP 0235, and LLP 0241 must extend the existing LLP 0053/0043 lease identity rather than treating a new semantic generation id as a substitute for query-instance custody.

A coherent dependency order is: (a) accept/implement the 0235 module profile and 0236 vocabulary; (b) resolve 0238’s lowering to the existing central membership/write seam; (c) resolve 0237’s transactional command binding and 0240’s bounded plan/witness contracts; (d) productize 0241 as an extension of the existing lease carrier for those admitted policies/plans; and (e) classify and reload the resulting stable identities through 0239’s bounded generation-retirement protocol. Capability rows can still flip independently by target and phase.

SET VERDICT: NOT READY
