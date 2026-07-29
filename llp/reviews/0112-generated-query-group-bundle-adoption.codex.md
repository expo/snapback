# Codex-family reviews: LLP 0107

## Round 1 — 2026-07-28

**Reviewer family:** OpenAI Codex  
**Provider / runtime:** Codex CLI 0.145.0, `gpt-5.6-sol`  
**Reasoning effort:** ultra  
**Date:** 2026-07-28  
**Redacted:** no  
**Method:** fresh CLI runner, read-only tools, mutually blind structurally isolated capsule  
**Target SHA-256:** `ee28cbcf285f1e0d6c12370fd2da529e07e50fda1a995d58c2706b0c7d1604e7`  
**Capsule SHA-256:** `15abe0c229ab47f0e16a472a929f33fb40e5337193db33d52ffe5140d486589b`  
**Instruction SHA-256:** `b14396a7c79d37792fd49e87ce40d924773af142f0b365ad2965e65030a31b21`  
**Status:** completed  
**Session:** `019fa767-217c-75c0-aac8-73a1453464a4`

## 1. What holds under stress

- The ownership split is coherent: codegen owns references, the prepared client owns admission and transport, the headless `liveQuery` owns subscription state, and React remains an external-store consumer. This aligns with LLPs 0012, 0034, and 0102.

- Registered boot has a sound intended invariant: one bundle request, one durable commit cut, adoption of the server-created subscriptions, no second snapshot-with-subscribe, visible provenance, and no fabricated commit on fallback.

- Authority replacement, late-response fencing, secret-free inspection, provider disposal, HMR replacement, additive rollout, and versioned rollback all have clear desired outcomes.

- Exact generated result typing is feasible. Existing declarations already demonstrate the necessary phantom-map flow through `QueryGroupEntries`, and the real Signal Desk adapter consumes the generated group without row generics or casts.

- The six acceptance gates are finite and nonvacuous. In particular, requiring a real-adapter receipt and packed cold install prevents package-level mocks from standing in for end-to-end evidence.

## 2. MATERIAL concerns

1. **The parameter domain contradicts the route contract.**

   [LLP 0107](/private/tmp/snapback-0107-r1.n9tK3R/capsule/llp/0107-generated-query-group-bundle-adoption.spec.md:107) requires `{}` in V1 while generating a group for every admitted route. LLP 0092 already defines `params-v1`, and [LLP 0114](/private/tmp/snapback-0107-r1.n9tK3R/capsule/llp/0114-first-class-react-and-query-groups.spec.md:1244) requires typed route parameters. Current codegen and public tests implement that latter contract.

   Failure scenario: `/board/:boardId` is a valid admitted route and receives an authentic generated group, but LLP 0107 requires preparation with `{}`. The request therefore cannot materialize the child arguments and must either be refused or sent incorrectly.

   Bounded resolution: either retain `prepareQueryGroup<Ref>(ref, params: QueryGroupParams<Ref>)` with exact `params-v1` decoding, or explicitly restrict V1 group emission to parameter-free routes and revise “every admitted route,” the generated map, and acceptance accordingly.

2. **The admissible child kind is unresolved.**

   Route compilation admits both `Query` and `LiveQuery`, while register mode requires every child to be `LiveQuery`; the server explicitly refuses ordinary queries in register mode at [src/local.rs](/private/tmp/snapback-0107-r1.n9tK3R/capsule/src/local.rs:7027). LLP 0107 promises groups for every admitted route and says only “non-query” children refuse.

   Failure scenario: a valid route containing an ordinary `Query` gets a generated group, but no registration or subscription ID can exist for that child. One implementation rejects the generated group; another attempts a mixed snapshot/registration capability.

   Bounded resolution: define generated registered groups as all-`LiveQuery` and make mixed or ordinary-query routes deterministically ineligible at codegen/admission, or explicitly design a separate mixed read/register union. The current all-children-one-shot contract cannot silently support both.

3. **Two wire invariants contradict LLP 0092.**

   LLP 0107 admits 1–64 children and requires a positive commit. LLP 0092 pins the route/bundle maximum at 32 and defines `commitVersion` as `u64`, which includes zero. The server schema and current client accept zero.

   Failure scenarios:

   - A 33-child group is valid under LLP 0107 but cannot be admitted by codegen or the bundle endpoint.
   - A newly provisioned database at durable version `0` returns a valid single-commit bundle that an implementation reading “positive” as `> 0` rejects.

   Bounded resolution: use 1–32 for generated bundle groups and accept portable safe integer commit versions from zero through the governing maximum. Any other choice requires explicit amendments to LLPs 0090/0092 and contradicts LLP 0107’s own non-goal of not broadening bundle bounds.

4. **The interoperable group-identity protocol is not fully specified.**

   “Stable occurrence suffix,” “deterministic group id,” and “the generator’s framed canonical encoding” do not determine exact bytes, domains, normalization, default persistence representation, ID grammar, or a collision-free label algorithm.

   Concrete failures already demonstrate the ambiguity:

   - `foo, foo2, foo` currently generates labels `foo, foo2, foo2`.
   - Codegen hashes sorted pretty JSON while the client reconstructs compact canonical JSON. Signal Desk’s authentic `/` group consequently hashes to different values in the two packages.
   - A stale route-manifest set can pass pre-network checks unless the binding is required to compare its route-bearing `inputsHash` or another served route-manifest identity.

   Bounded resolution: specify one domain string, framing algorithm, canonical byte encoding, exact hash preimage and persistence normalization, group-ID grammar, and collision-free total label algorithm. Require pre-network comparison of the generated and deployed route-bearing identity, and add golden vectors covering repeats, suffix collisions, Unicode, key order, parameters, persistence defaults, and the Signal Desk route.

5. **Auth-scoped registered adoption lacks its required composition contract.**

   LLPs 0090/0092 require auth-scoped bundle entries to carry `authorization: {scope, invalidation}`. LLP 0053 requires the corresponding never-reused query namespace, authenticated expectation, authorization fence, and generation-fenced publication. LLP 0107’s response-validation and registration shapes omit this projection and only mention a provider-level barrier.

   Failure scenario: a sessions-mode group receives authorized rows and a registered subscription. An implementation that adopts without installing the projection may expose rows outside the required authorization fence; one that refuses partial adoption performs an ordinary fresh subscribe, violating the no-second-snapshot guarantee.

   Bounded resolution: add the exact authorization union to per-child validation and the private registration capability. Pin namespace creation, exact scope/subscription matching, invalidation installation, authority-independent absence rules, and initialization of the LLP 0053 fence before rows become observable. The provider-level participant should separately cite LLP 0059.

6. **Capability-only fallback has no authoritative signal.**

   LLP 0107 narrows fallback to one explicit target-capability absence, but neither a capability field nor a distinct diagnostic is named. LLP 0092 has no `SNAPBACK_BUNDLE_REGISTER_UNAVAILABLE`; `SNAPBACK_BUNDLE_REGISTER_REQUIRES_CREDENTIAL` is overloaded between ordinary anonymous misuse and the current Cloudflare arm’s missing credentialed register lane.

   Failure scenario: one implementation falls back on every `SNAPBACK_BUNDLE_*` error, including authorization, integrity, limits, and expiry; another never falls back because no recognized unavailability signal exists. Both can plausibly claim compliance with different parts of the cited corpus.

   Bounded resolution: add one positive register-mode capability claim and a distinct closed absence diagnostic, then provide an exhaustive mapping: only that absence may produce `live-fallback`; every existing LLP 0092 code remains a refusal.

7. **Prepared-capability transfer and cleanup are not closed.**

   LLP 0107 says provider creation consumes the capability and that partial consumption refuses. LLP 0114 instead consumes each registration lazily when its canonical child store starts and leaves unused registrations connection-owned until disconnect. The target also specifies cleanup for an authority race and provider disposal, but not malformed post-response validation, failed provider construction, abandonment, or expiry before consumption.

   Failure scenarios:

   - Eagerly starting every child during provider construction violates React/SSR zero-demand behavior; lazy consumption appears to violate “partial consumption refuses.”
   - A successful bundle whose final child fails client validation has already cached its grant and created pending server registrations, but no provider exists to release them.
   - An awaited prepared group that is never mounted retains client-side grant state and consumes pending-owner capacity until reaping.

   Bounded resolution: define an atomic one-time transfer from a preparation owner to exactly one provider. Retain LLP 0114’s lazy per-store child consumption, clarify that reuse of the capability—not unused children—is what refuses, and give the owner idempotent disposal/expiry. Every non-transfer exit, post-response validation failure, provider-construction failure, authority replacement, and terminal expiry must release the connection/grant; provider disposal owns transferred and unconsumed registrations.

## 3. DETAIL concerns

- Show the exact generic public signature, including `Ref`, `QueryGroupParams<Ref>`, `PreparedReactQueryGroup<Ref>`, and the React result mapping. The illustrative broad signature otherwise obscures the exact-typing requirement.

- Clarify whether “synchronous admission error” means throw-before-return or a rejected promise, and enumerate the stable group-specific diagnostics.

- Replace “LLP 0053 authorization-barrier participant” with LLP 0059 and add LLP 0059 to `Related`; LLP 0053 governs per-query authorization fences, not the provider participant protocol.

- Make inherited response checks explicit: required and unexpired `attachDeadline`, distinct subscription IDs, present canonical args, exact result-contract validation, exact `resume` closed-union validation, and dev-mode enforcement for `userId`.

- After resolving the material decisions, extend the evidence list with auth-scoped adoption, commit zero, post-response rollback, abandoned preparation, mixed-query refusal, and suffix-collision vectors.

## 4. Implementation/evidence assessment

The implementation contains substantial feasible foundations: deterministic route compilation, finite generated result maps, prepared binding checks, one register request, low-level registered-subscription adoption, shared React connections, barrier participation, and terminal cleanup. `./ref-check --verbose` passes with 108 LLPs and 2,198 references.

The complete path is not yet demonstrated. Authentic codegen/client hashes disagree; sessions group references use the wrong schema version; naming can collide; auth projections are dropped; fallback catches every bundle diagnostic; one-shot ownership is only provider-local; malformed post-registration responses have no rollback; and React can report registered boot while performing ordinary starts.

Signal Desk’s real adapter source does use the generated group, but the maintained React acceptance test does not import that adapter or include routes, and the retained cold-install receipt remains a checkpoint with `claimSatisfied: false`. Those are explicitly unfinished gates, not independent reasons for the verdict. The verdict rests on the unresolved decisions above.

VERDICT: NOT READY

## Round 2 — 2026-07-28

**Reviewer family:** OpenAI Codex  
**Provider / runtime:** Codex CLI 0.145.0, `gpt-5.6-sol`  
**Reasoning effort:** ultra  
**Date:** 2026-07-28  
**Redacted:** no  
**Method:** fresh CLI runner, read-only tools, mutually blind structurally isolated capsule; delta round with implementer lens  
**Target SHA-256:** `e25182831dff5609583389823f9f86a01d410bb8ea22cb5c86d1f356f8cf3d1f`  
**Capsule SHA-256:** `279e351166fb7702a5f201e2e935b080ba96051361fb4d0ab739e6afd38350b5`  
**Transport archive SHA-256:** `b9f8f44ee47b412edad5467b7c4dbdcad32af972f1779ac18faef7073ae05994`  
**Instruction SHA-256:** `c44d2fa25db7ed40779e0b8fd7552fe61463f830323d789a9e6c1aa08d85c405`  
**Status:** completed; response preserved verbatim below
**Session:** `019fa7ab-c297-7e00-a998-178e7f22c0a3`

Four MATERIAL concerns remain, all IN-DELTA. I found no PRE-EXISTING material defect.

## 1. Derived implementation contract and divergence points

The target defines this lifecycle:

1. Codegen emits groups only for 1–32 all-`LiveQuery` routes, with deterministic labels, exact JCS identity bytes, typed parameters, and complete child references.
2. Preparation validates every generated/deployed identity before I/O, captures authority, and admits development `userId` only for local dev mode.
3. The client allocates one namespace per child and performs exactly one register-mode bundle request.
4. It validates the response positionally: common commit, connection/grant/deadline, generation/stream, unique subscriptions, rows, resume, and authorization projections.
5. A one-shot owner transfers to one provider. The provider registers its LLP 0059 barrier participant and lazily adopts registrations into canonical stores without another snapshot.
6. Only exact capability absence may produce deliberate live fallback. Expiry produces visible live recovery; every other failure refuses and cleans up.

Divergence log:

| Decision point | Disposition |
|---|---|
| Group bounds, labels, hash bytes, identity, positional response matching | Pinned; no design concern. |
| Route-parameter public and wire types, and where substitution occurs | M3 — MATERIAL, IN-DELTA. |
| Prepared rows and authorization projections visible before provider custody | M1 — MATERIAL, IN-DELTA. |
| Expired response acceptance and the publication/attach order | M2 — MATERIAL, IN-DELTA. |
| Duplicate canonical children versus canonical-store sharing | M4 — MATERIAL, IN-DELTA. |
| Auth-scoped classification | Resolved by LLP 0053’s fail-closed default; current implementation gap is D3 — DETAIL, IN-DELTA. |
| Development identity continuity | Governing outcome is derivable from LLP 0114; implementation clarity gap is D1 — DETAIL, IN-DELTA. |
| Abandoned-owner cleanup trigger | Cleanup outcome is decided; trigger/bound is D2 — DETAIL, IN-DELTA. |
| Capability absence versus request failure | Fully pinned: only exact target-owned capability absence may fallback. |

## 2. What holds under stress

- The 1–32 all-live projection and collision-free `foo, foo2, foo3` algorithm are precise. Codegen implements them and has direct fixtures for mixed-route exclusion, the 32-child maximum, and collisions: [codegen implementation](/private/tmp/snapback-0107-r2.5xV5kA/capsule/packages/snapback-codegen/index.mjs:5555), [fixture](/private/tmp/snapback-0107-r2.5xV5kA/capsule/packages/snapback-codegen/authoring-validation.test.mjs:779).
- Server registration is feasible and substantially landed: positional namespace length refusal is explicit, connection negotiation is carried into evaluation, failure purges partial topology, and every entry is evaluated under one serialized commit cut: [server admission](/private/tmp/snapback-0107-r2.5xV5kA/capsule/src/server.rs:17010), [atomic bundle evaluation](/private/tmp/snapback-0107-r2.5xV5kA/capsule/src/local.rs:7028).
- Capability honesty and failure precedence are clear. The client checks the live target manifest and does not downgrade an advertised-target request failure: [capability check](/private/tmp/snapback-0107-r2.5xV5kA/capsule/packages/snapback-client/react-binding.mjs:415), [fallback implementation](/private/tmp/snapback-0107-r2.5xV5kA/capsule/packages/snapback-client/react-binding.mjs:665).
- The server creates per-child scopes from positional namespaces, and the headless client installs authorization state before its registered update callback: [server scope creation](/private/tmp/snapback-0107-r2.5xV5kA/capsule/src/local.rs:7967), [client adoption](/private/tmp/snapback-0107-r2.5xV5kA/capsule/packages/snapback-client/index.mjs:7393). The provider also registers a real barrier participant before returning its registry: [provider barrier](/private/tmp/snapback-0107-r2.5xV5kA/capsule/packages/snapback-react/index.mjs:1407).
- The sessions-mode Signal Desk evidence is real adapter evidence, not a package fake. Its retained receipt records registered source, commit, live mutation delivery, and zero terminal resources: [adapter path](/private/tmp/snapback-0107-r2.5xV5kA/capsule/demos/signal-desk/src/backends/snapback.ts:58), [receipt](/private/tmp/snapback-0107-r2.5xV5kA/capsule/demos/signal-desk/acceptance/results/react-query-group.v1.json:1).

## 3. MATERIAL concerns

### M1 — IN-DELTA — The prepared “public view” bypasses the authority barrier and contradicts its own inspection rule

The public shape exposes rows and `{scope,invalidation}` authorization projections before any provider participant exists: [public shape](/private/tmp/snapback-0107-r2.5xV5kA/capsule/llp/0107-generated-query-group-bundle-adoption.spec.md:195). The same section later says inspection never exposes scope or invalidation payloads: [contrary rule](/private/tmp/snapback-0107-r2.5xV5kA/capsule/llp/0107-generated-query-group-bundle-adoption.spec.md:245). LLP 0059 requires every app-data boundary to be either settled or blank: [exposure invariant](/private/tmp/snapback-0107-r2.5xV5kA/capsule/llp/0059-session-projection-and-client-barrier.spec.md:2490).

Failure scenario: session A prepares a group and retains the frozen result. Authority transitions to B. The provider participant blanks its stores, but the retained prepared object still exposes A’s immutable rows and authorization projection indefinitely. The current implementation constructs exactly that public object: [prepared result construction](/private/tmp/snapback-0107-r2.5xV5kA/capsule/packages/snapback-client/react-binding.mjs:647).

Bounded resolution: make the prepared capability genuinely opaque. Public entries may expose safe child identity and boot provenance, but rows, subscription IDs, resume state, namespaces, and authorization projections must remain private. Only a provider that has registered its barrier participant and revalidated authority may publish rows into child stores.

### M2 — IN-DELTA — Expiry has contradictory admission rules and no server-confirmed publication gate

Response validation requires “no … expired deadline”: [validation rule](/private/tmp/snapback-0107-r2.5xV5kA/capsule/llp/0107-generated-query-group-bundle-adoption.spec.md:192). The recovery section expressly allows an already-expired response to become prepared: [recovery rule](/private/tmp/snapback-0107-r2.5xV5kA/capsule/llp/0107-generated-query-group-bundle-adoption.spec.md:276).

There is also a timebase/order problem. LLP 0092 defines the deadline in absolute server-clock milliseconds and makes server attach authoritative: [deadline contract](/private/tmp/snapback-0107-r2.5xV5kA/capsule/llp/0092-rqs-manifest-bundle-and-channel-a-contract.spec.md:423). Current code compares it with local `Date.now()`, then registered adoption publishes rows before initiating stream attach: [local comparison](/private/tmp/snapback-0107-r2.5xV5kA/capsule/packages/snapback-client/react-binding.mjs:544), [publish-before-attach](/private/tmp/snapback-0107-r2.5xV5kA/capsule/packages/snapback-client/index.mjs:7475).

Failure scenario: the client clock trails the server, or the deadline expires between the local check and socket attach. Rows become visible as registered boot; the server then refuses the expired attach, contrary to the rule that expired rows never become visible.

Bounded resolution: define a recovery-only private state for well-formed expired responses and remove “expired deadline” from malformed-response validation. More importantly, require positive server attach confirmation before registered rows may cross the provider publication gate. A local deadline check may skip an obviously stale attach, but cannot prove a registered boot valid.

### M3 — IN-DELTA — Parameter typing conflicts with the governing bundle wire contract

The target says `QueryGroupParams` is generated exactly and that codegen materializes `$param` mappings before the request: [target parameter contract](/private/tmp/snapback-0107-r2.5xV5kA/capsule/llp/0107-generated-query-group-bundle-adoption.spec.md:132). LLP 0092 instead pins bundle parameters as strings and makes schema-driven substitution server-owned: [wire schema](/private/tmp/snapback-0107-r2.5xV5kA/capsule/llp/0092-rqs-manifest-bundle-and-channel-a-contract.spec.md:284), [server substitution](/private/tmp/snapback-0107-r2.5xV5kA/capsule/llp/0092-rqs-manifest-bundle-and-channel-a-contract.spec.md:675).

Actual codegen infers `number` or `boolean` from a referenced target argument, while the client forwards the value unchanged and Rust requires `BTreeMap<String,String>`: [type inference](/private/tmp/snapback-0107-r2.5xV5kA/capsule/packages/snapback-codegen/index.mjs:5876), [client wire body](/private/tmp/snapback-0107-r2.5xV5kA/capsule/packages/snapback-client/index.mjs:4412), [server request type](/private/tmp/snapback-0107-r2.5xV5kA/capsule/src/bundle.rs:62).

Failure scenario: `/page/:limit` maps `limit` to a numeric argument. Generated TypeScript requires a number, but sending it fails Rust deserialization. Passing the required wire string violates the generated type. If one route parameter feeds both string and number arguments, codegen’s route-order last-write type has no coherent meaning, while the server can correctly decode the same raw string separately for each child.

Bounded resolution: preserve LLP 0092 v1—every generated route parameter is a string. The server remains authoritative for typed substitution. If the client mirrors decoding to validate returned materialized args, specify that as a shared non-authoritative validation algorithm; a truly typed wire input requires a new versioned bundle grammar.

### M4 — IN-DELTA — Duplicate canonical children cannot satisfy both positional adoption and canonical-store sharing

The target permits repeated functions through collision-free labels and requires every positional registration to be consumed exactly once. LLP 0114 simultaneously requires equal reference/args/authority identities to share one canonical store: [shared-store rule](/private/tmp/snapback-0107-r2.5xV5kA/capsule/llp/0114-first-class-react-and-query-groups.spec.md:345).

Failure scenario: an admitted route contains 32 identical `foo({})` children—a pattern already used by the codegen fixture. The server creates 32 distinct subscription IDs and namespaces. The provider indexes registrations in a `Map` keyed only by canonical reference and args, so 31 entries are overwritten; one store adopts one registration and the remaining subscriptions stay active until whole-connection disposal: [registration map](/private/tmp/snapback-0107-r2.5xV5kA/capsule/packages/snapback-react/index.mjs:231).

Bounded resolution: for v1, define “duplicate” as an identical canonical `(function-reference id, canonical args)` child and refuse such generated registered groups before I/O. Repeated function names with different arguments remain valid. This preserves canonical-store sharing without adding a surplus-registration retirement protocol.

## 4. DETAIL concerns

- D1 — IN-DELTA: The target and LLP 0114 imply that prepared `userId` must equal the provider-bound development principal and be forwarded through reconnect/recovery. State that equality explicitly. Current code stores `devUserId` in the private owner but does not pass it to provider `startLiveQuery`: [owner capture](/private/tmp/snapback-0107-r2.5xV5kA/capsule/packages/snapback-client/react-binding.mjs:638), [provider start](/private/tmp/snapback-0107-r2.5xV5kA/capsule/packages/snapback-react/index.mjs:385).
- D2 — IN-DELTA: “Abandoned preparation” has a decided cleanup obligation but no exact abandonment trigger or bound. Pin automatic deadline cleanup and optionally an `AbortSignal`; otherwise a dropped promise has no `dispose()` caller. Current acquisition inserts a grant into the client map, while owner cleanup is invoked only explicitly.
- D3 — IN-DELTA: LLP 0053 resolves auth classification—everything is auth-scoped unless explicitly `authorityIndependent`: [classification](/private/tmp/snapback-0107-r2.5xV5kA/capsule/llp/0053-authorization-invalidation.rfc.md:291). Current response validation instead infers the requirement from whether the server supplied any authorization projection, so omission of all projections is not detected at preparation: [current validation](/private/tmp/snapback-0107-r2.5xV5kA/capsule/packages/snapback-client/react-binding.mjs:735). This is an implementation/evidence gap, not an additional design decision.
- D4 — IN-DELTA: Codegen implements the pinned collision algorithm, but binding reconstruction still uses occurrence counts without the route-local used-name set: [binding reconstruction](/private/tmp/snapback-0107-r2.5xV5kA/capsule/packages/snapback-client/react-binding.mjs:129). The design is unambiguous; parity evidence is incomplete.
- D5 — IN-DELTA: The exact TypeScript discriminated union for `registered-bundle`, `live-fallback`, and `live-recovery`, plus the complete stable `SNAPBACK_REACT_GROUP_*` code registry, should be written down. The behavioral decisions are present, but declaration and diagnostic mechanics remain implicit.

## 5. PRE-EXISTING material

No. Using the supplied delta description as provenance—the isolated capsule contains no Git history—all four material findings concern newly revised parameter, expiry, custody/barrier, or lazy-adoption text. I found no separate MATERIAL defect in the unchanged governing contract.

## 6. Implementation/evidence assessment

The server primitive and real sessions-mode demo establish feasibility: common-cut evaluation, positional registration, authorization namespaces, registered delivery, mutation settlement, and terminal cleanup all have concrete evidence.

The client/provider implementation remains partial in exactly the places noted above. That incompleteness alone does not drive the verdict; the blocking findings are contradictions or missing v1 decisions in the revised design itself. I did not treat any merely uncompleted acceptance gate as MATERIAL.

PRE-EXISTING MATERIAL: NO
VERDICT: NOT READY
 
## Round 3 — 2026-07-28

**Reviewer family:** OpenAI Codex  
**Provider / runtime:** Codex CLI 0.145.0, `gpt-5.6-sol`  
**Reasoning effort:** ultra  
**Date:** 2026-07-28  
**Redacted:** no  
**Method:** fresh CLI runner, read-only tools, mutually blind structurally isolated capsule  
**Target SHA-256:** `a1cdc64d3fcdf34c4e308527b86cd2d7c7523e2b2d55a75525393ad839866b6d`  
**Capsule SHA-256:** `334a932fa474e10e30ded51a4b135fb302a08e40e00d5cd41a2a85fddf220144`  
**Instruction SHA-256:** `706ebc4f4f32f53a9ced62813c5e7dd50a870f93f1b4dad866f6867de540fa8b`  
**Status:** completed  
**Session:** `019fa7ce-e087-7953-81ea-467ce4fa70cd`

The revision is not ready. Two MATERIAL concerns remain, both IN-DELTA. I found no PRE-EXISTING material concern.

## 1. Derived implementation contract and divergence points

The target defines this contract:

1. Codegen emits groups only for routes containing 1–32 `LiveQuery` children. Names, IDs, hashes, ordering, persistence, and generated declarations are deterministic and parity-tested. Mixed or ordinary-query routes remain bundle-readable but receive no adoption reference.

2. Binding preparation admits an exact schema/function/capability/routes set. Group identity, child references, string route params, materialized args, result contracts, and duplicate canonical children are checked before I/O. Every failure is an asynchronously rejected `SNAPBACK_REACT_GROUP_*` promise.

3. Sessions registration requires protocol 1 and one positional namespace per child: real namespace for every non-`authorityIndependent` child and `null` only for `authorityIndependent` children. Both request additions enter the sender-bound replay scope.

4. The client accepts only the exact closed bundle DTO: one commit/generation/stream, exact ordered children, distinct subscriptions, contract-valid rows, closed authorization projections, and resume receipts pinned to app, query artifact, args, rows, commit, generation, and stream.

5. The public preparation exposes only generated/caller-known identity and boot provenance. Rows, grants, subscriptions, namespaces, resume state, authorization projections, and connection ownership stay in private custody through one atomic provider transfer.

6. Before rows publish, the provider registers its barrier and obtains positive server-confirmed socket attachment. Children adopt lazily. Any child frame arriving before actual adoption permanently dirties that bundle snapshot and requires a fresh explicitly superseding subscription.

7. Live fallback occurs only when the exact target capability is absent and the author opted in. Operational failures never downgrade. Attach expiry, dirty-child recovery, and authority replacement discard predecessor data and start fresh subscriptions with closed recovery reasons.

8. Capability advertisement remains experimental and false until the exact target passes the complete conformance suite.

Divergence ledger:

| Decision point | Classification | Derived ruling |
|---|---|---|
| Typed route materialization before/no bundle I/O | IN-DELTA MATERIAL | Unresolved; see M1. |
| `null` namespace predicate | IN-DELTA MATERIAL | Unresolved conflict; see M2. |
| Meaning of public `entries[].args` across registered and fallback variants | IN-DELTA DETAIL | Should be settled together with M1; raw mappings, string substitution, and typed materialized args are observably different. |
| “At most one request” versus same-key transport replay | PRE-EXISTING DETAIL | Read as one logical preparation request; LLP 0092 idempotent replay may require multiple physical attempts. |
| Protocol-1 dev behavior | IN-DELTA DETAIL | The general negotiated-protocol rule applies when offered; only protocol-free settled dev is the legacy exception. Scoped code currently treats authorization projections as sessions-only. |
| Opacity versus LLP 0114’s older public child-registration inspection | IN-DELTA DETAIL | LLP 0107’s narrower, later opacity rule controls; LLP 0114 needs textual reconciliation. |
| HMR order | PRE-EXISTING DETAIL | LLP 0107’s prepared-group-specific predecessor-first rule controls, notwithstanding LLP 0114’s generic successor-overlap witness. |
| Resume `meta.app` | IN-DELTA DETAIL | LLP 0107 and the committed closed schema require it; LLP 0090’s older pseudocode omits it. |
| Attach confirmation mechanism | IN-DELTA DETAIL | A correlated readiness proof after the server’s preflight/attach cut satisfies the contract; a client-clock check does not. |

## 2. What holds under stress

- The reference naming, hash domain, authored hash input, finite type map, and mixed-route exclusion are coherent and implementable in [codegen](/private/tmp/snapback-0107-r3.veZ3Be/capsule/packages/snapback-codegen/index.mjs:5555).

- Rust already preserves string-only request parameters and performs strict server-side typed substitution at the bundle cut in [local.rs](/private/tmp/snapback-0107-r3.veZ3Be/capsule/src/local.rs:7115).

- The request DTO is closed, and replay scope carries both protocol and positional namespaces. Pending-owner reservation, same-key replay, grant rotation, attach expiry, and reaping form a coherent bounded lifecycle in [bundle.rs](/private/tmp/snapback-0107-r3.veZ3Be/capsule/src/bundle.rs:681).

- Socket preflight precedes pending-owner consumption, and expired owners are reaped before upgrade in [server.rs](/private/tmp/snapback-0107-r3.veZ3Be/capsule/src/server.rs:18123). A subsequent correlated ping/pong is a feasible positive readiness witness.

- Receipt validation is suitably adversarial: the client checks the exact metadata keys, app, commit, generation, stream, query artifact, args hash, and row digest in [react-binding.mjs](/private/tmp/snapback-0107-r3.veZ3Be/capsule/packages/snapback-client/react-binding.mjs:895).

- The lazy-child guard and superseding-recovery decision are sound as specified. Authority fencing, unchanged development identity, abandonment cleanup, and exact public fallback/recovery variants are mutually coherent.

- Capability honesty is correctly fail-closed in the current Rust facts: advertisement remains false pending the complete suite in [manifest.rs](/private/tmp/snapback-0107-r3.veZ3Be/capsule/src/manifest.rs:5009).

## 3. MATERIAL concerns

### M1 — IN-DELTA: typed route materialization has no permitted authority where the profile requires it

The target keeps route params as strings, makes the server authoritative for number/boolean decoding, and permits a client mirror only for validating returned args ([LLP 0107](/private/tmp/snapback-0107-r3.veZ3Be/capsule/llp/0107-generated-query-group-bundle-adoption.spec.md:137); [LLP 0092](/private/tmp/snapback-0107-r3.veZ3Be/capsule/llp/0092-rqs-manifest-bundle-and-channel-a-contract.spec.md:691)). But before receiving returned args, the client must:

- reject duplicate canonical materialized children;
- construct each namespace’s canonical function-plus-args query key; and
- in capability fallback, invoke ordinary live subscriptions without making a bundle request.

Codegen explicitly permits route refs targeting `string`, `number`, or `boolean` args in [index.mjs](/private/tmp/snapback-0107-r3.veZ3Be/capsule/packages/snapback-codegen/index.mjs:3924).

Failure scenario: `/page/:page` maps `"2"` into numeric `listPage({page: 2})`, and another child names the same function with literal `{page: 2}`. The server materializes exact duplicates. A client retaining `"2"`:

- misses the required pre-I/O duplicate refusal;
- allocates a query namespace keyed by `{page:"2"}` rather than the canonical store `{page:2}`; and
- sends invalid string args during live fallback.

If it converts `"2"` to `2`, it violates the validation-only/no-invocation-authority rule. The current implementation exhibits the raw-string branch in [react-binding.mjs](/private/tmp/snapback-0107-r3.veZ3Be/capsule/packages/snapback-client/react-binding.mjs:154).

Bounded resolution: for v1, either:

- restrict generated register-adoption groups to `$param` mappings whose target args are strings, leaving LLP 0092’s broader read-bundle grammar unchanged; or
- define and authenticate a parity-tested generated client materializer, explicitly permit it for duplicate identity, namespace identity, and fallback invocation while retaining strings on the wire and server revalidation, and amend LLP 0092’s “nothing evaluated client-side” language.

### M2 — IN-DELTA: LLP 0092 uses `public` where the governing predicate is `authorityIndependent`

LLP 0107 correctly requires namespaces for auth-scoped children and `null` at `authorityIndependent` positions. LLP 0053 defines every subscription as auth-scoped unless explicitly `authorityIndependent` ([LLP 0053](/private/tmp/snapback-0107-r3.veZ3Be/capsule/llp/0053-authorization-invalidation.rfc.md:291)).

The additive LLP 0092 amendment instead says “a public position is exactly `null`” ([LLP 0092](/private/tmp/snapback-0107-r3.veZ3Be/capsule/llp/0092-rqs-manifest-bundle-and-channel-a-contract.spec.md:330)). Public authorization admission and authority independence are orthogonal: a public or `publicInline` function can still be caller-authority-dependent.

Failure scenario: a sessions-mode public “mine OR public” live query is not `authorityIndependent`. An LLP 0107 client sends a namespace and expects authorization projections; an LLP 0092 implementer sends or requires `null`. The pair either rejects registration or omits the LLP 0053 fence for rows whose visibility can shrink after a `public → private` transition.

Bounded resolution: replace LLP 0092’s “public position” with “explicitly `authorityIndependent` position,” state that `public`, `publicInline`, and `AuthRequirement::Public` do not affect the namespace predicate, and add a public-but-auth-scoped sessions fixture to the conformance suite.

## 4. DETAIL concerns

- **IN-DELTA:** Public `entries[].args` should explicitly mean returned typed materialized args for registered boot and name the corresponding fallback representation. M1’s resolution should settle this.

- **IN-DELTA:** Reconcile LLP 0114’s older statement that public inspection may expose child registrations and a connection label with LLP 0107’s stricter opacity rule ([LLP 0114](/private/tmp/snapback-0107-r3.veZ3Be/capsule/llp/0114-first-class-react-and-query-groups.spec.md:1262)).

- **IN-DELTA:** Update LLP 0090’s illustrative `ResumeMeta` object to include `app`; the target and committed DTO already make the correct closed decision.

- **IN-DELTA:** “Safe generated identity” is slightly inaccurate because `params` are caller-supplied. “Generated and caller-known identity” would state the actual exposure boundary.

- **PRE-EXISTING:** Clarify that “at most one register-mode request” means one logical acquisition with one idempotency key, not a prohibition on transport replay.

- **PRE-EXISTING:** Reconcile the prepared-group predecessor-first HMR rule with LLP 0114’s generic successor-before-disposal overlap witness ([LLP 0114](/private/tmp/snapback-0107-r3.veZ3Be/capsule/llp/0114-first-class-react-and-query-groups.spec.md:1284)). The narrower target is usable, but the evidence expectations currently point in opposite orders.

## 5. PRE-EXISTING material

None. Both readiness-blocking concerns depend on round-3 additions: validation-only typed decoding and the new namespace/adoption amendment.

## 6. Implementation/evidence assessment

The scoped implementation demonstrates feasibility for deterministic generation, closed DTO validation, receipt pinning, pending-owner replay/reaping, attach preflight, barriers, cleanup, and capability gating.

It is not yet evidence for this revision:

- The private owner is stored as a discoverable symbol property, exposing rows, subscriptions, resumes, and namespaces through reflection; a `WeakMap` or equivalent truly external custody is needed ([react-binding.mjs](/private/tmp/snapback-0107-r3.veZ3Be/capsule/packages/snapback-client/react-binding.mjs:746)).

- The provider removes a child from its frame guard when creating the store, before the headless owner installs the subscription id. Frames in that interval are ignored by the headless consumer, leaving the exact stale-publication race LLP 0107 intends to close ([React handoff](/private/tmp/snapback-0107-r3.veZ3Be/capsule/packages/snapback-react/index.mjs:530); [headless adoption](/private/tmp/snapback-0107-r3.veZ3Be/capsule/packages/snapback-client/index.mjs:7475)).

- The retained backend-bakeoff receipt predates opacity: its adapter still expects a public connection id ([test](/private/tmp/snapback-0107-r3.veZ3Be/capsule/demos/signal-desk/tests/react-query-group.mjs:291)), while current target facts correctly withhold capability advertisement.

- The isolated capsule does not contain `./ref-check`, so acceptance item 8 could not be exercised. No file was edited.

PRE-EXISTING MATERIAL: NO
VERDICT: NOT READY
