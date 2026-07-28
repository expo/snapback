# Codex-family reviews: LLP 0106

## Round 1 — 2026-07-27

**Reviewer family:** OpenAI Codex  
**Provider / runtime:** Codex CLI 0.145.0, `gpt-5.6-sol`  
**Reasoning effort:** ultra  
**Date:** 2026-07-27  
**Redacted:** no  
**Method:** fresh CLI runner, read-only sandbox, mutually blind structurally
isolated capsule  
**Target SHA-256:** `c1d52efd6c130b6c6c3ad8c18a018a9d946384cfc3bfad12b3bfc999491311f2`  
**Capsule SHA-256:** `f76e1d0192fd1466719d8782c04d88fe360fb3804187e7ec775e2c63e7b8841f`  
**Instruction SHA-256:** `f6fa6d45663997f5c7e3ec52ce076aff1eec48c59ded01656c74b75beda1138b`  
**Status:** completed

## Overall assessment

The ownership direction is sound: React remains a projection over the prepared client, ephemeral overlay, external query store, and existing optimistic ledger. The local-only capability stance and “latest authoritative base” rollback rule are also correct.

The specification is not ready, however, because several required behaviors cannot be implemented through the existing seams as written.

## Material concerns

1. **MATERIAL — Optimistic query typing loses the selected query type.**

   The optimistic option uses the broad `QueryReference`, so `args`, `current`, and the updater result are not correlated with the selected query ([LLP 0106](/private/tmp/snapback-llp0106-r1.6ubjRs/capsule/llp/0106-react-presence-and-optimistic-lifecycle.spec.md:44)).

   Resolution: infer `Q extends QueryReference` from `optimistic.query` and use `FunctionArgs<Q>`/`FunctionResult<Q>` throughout. Add strict generated fixtures rejecting wrong args and updater results without casts or explicit generics.

2. **MATERIAL — Presence ownership is defined only for connection-keyed collections, while the API accepts every key mode.**

   LLP 0013 supports Connection, Session, User, and Custom keys ([LLP 0013](/private/tmp/snapback-llp0106-r1.6ubjRs/capsule/llp/0013-ephemeral-realtime-state.rfc.md:141)), but 0106 universally treats `grantedConnectionId` as self identity and assumes one connection-owned value ([LLP 0106](/private/tmp/snapback-llp0106-r1.6ubjRs/capsule/llp/0106-react-presence-and-optimistic-lifecycle.spec.md:80)).

   Resolution: either restrict v1—statically where possible and synchronously at runtime—to connection-keyed generated references, or specify self identity, conflicts, publishing, and deletion for every admitted key mode.

3. **MATERIAL — `PresenceState` is not actually a closed state algebra.**

   Its status, entries, self key, and diagnostic are freely combinable in TypeScript despite prose forbidding most combinations ([LLP 0106](/private/tmp/snapback-llp0106-r1.6ubjRs/capsule/llp/0106-react-presence-and-optimistic-lifecycle.spec.md:105)). It also cannot represent an authoritative readable room alongside a failed managed publish/heartbeat without either hiding entries or losing the publisher failure.

   Resolution: define a discriminated union for pending/ready/stale/resyncing/error/unsupported and an explicit publisher substate or documented terminal-publisher policy. Add negative fixtures for impossible combinations.

4. **MATERIAL — The existing overlay is not a sufficient lifecycle handle.**

   `subscribeEphemeral` establishes the HTTP overlay, but shared-socket demand is owned separately by `LiveStreamManager`. Some epoch/invalid-snapshot paths set `needsResync` without notifying ([client overlay](/private/tmp/snapback-llp0106-r1.6ubjRs/capsule/packages/snapback-client/index.mjs:8028)), and `overlay.dispose()` only detaches local registrations ([dispose](/private/tmp/snapback-llp0106-r1.6ubjRs/capsule/packages/snapback-client/index.mjs:7909)); it does not send server unsubscribe or offer bounded settlement. The existing Contract adapter demonstrates the required unsubscribe-before-final-demand-detach ordering ([Contract teardown](/private/tmp/snapback-llp0106-r1.6ubjRs/capsule/packages/snapback-contract/index.mjs:3581)).

   Resolution: specify one client-owned ephemeral room-handle extension exposing granted identity, exhaustive level-triggered resync/connection events, manager demand, idempotent disposal, and bounded `settled()`. React should borrow that handle, not reach into private manager machinery or create another transport owner.

5. **MATERIAL — TTL and heartbeat scheduling are incomplete.**

   LLP 0013 requires local monotonic expiry independent of synchronized wall clocks ([LLP 0013](/private/tmp/snapback-llp0106-r1.6ubjRs/capsule/llp/0013-ephemeral-realtime-state.rfc.md:194)). The current overlay only prunes lazily with `Date.now()` when read ([client overlay](/private/tmp/snapback-llp0106-r1.6ubjRs/capsule/packages/snapback-client/index.mjs:8124)), while 0106 allocates no expiry timer for observer-only rooms. Its heartbeat formula also exceeds legal TTLs of 250 ms or less. Rate budgets are per connection plus collection, but 0106 validates rooms independently, permitting many individually valid rooms to exceed the shared budget.

   Resolution: define a per-room monotonic expiry scheduler, including observer-only rooms; require a strict pre-expiry heartbeat margin or refuse short TTLs; aggregate automatic publish demand per connection/collection; and define differing `ttlMs` declarations plus explicit publish/delete interaction with a managed publisher.

6. **MATERIAL — Transactional admission has no defined transaction boundary.**

   “A group of concurrent mounts” is not represented by any public grouping construct, and the current registry exposes no reservation operation ([registry declaration](/private/tmp/snapback-llp0106-r1.6ubjRs/capsule/packages/snapback-client/external-store.d.mts:63)). The stated 64-room limit is also described as an existing server per-connection ephemeral limit, but the shipped 64 limit applies to durable subscriptions.

   Resolution: define an exact provider reservation API and batching boundary, or weaken atomicity to one committed hook/store acquisition. Label 64 as React-owned unless a capability-reported server limit is added. Test deduplication, abandoned reservations, concurrent boundary commits, and exact cleanup counts.

7. **MATERIAL — Optimistic lifecycle behavior is not total over the existing ledger.**

   The current `runMutation` installs its layer and attempt, then executes the updater before entering its cleanup `try` block ([external store](/private/tmp/snapback-llp0106-r1.6ubjRs/capsule/packages/snapback-client/external-store.mjs:333)). A throwing updater leaves both records installed; a direct probe produced `optimisticLayers: 1` and `pendingMutations: 1` with zero network calls. Additionally, `isAuthoritative` receives an undefined result when live delivery precedes the response and is not rerun when the response arrives, so the layer can remain indefinitely. Final query release can evict a store despite pending layers, and 0106 specifies neither an optimistic-layer cap nor final authority fencing, despite LLP 0059 requiring equal fencing after every success and failure ([LLP 0059](/private/tmp/snapback-llp0106-r1.6ubjRs/capsule/llp/0059-session-projection-and-client-barrier.spec.md:1679)).

   Resolution: extend the same ledger with transactional installation, validation on every rebase, exception cleanup, remembered authoritative evidence for both response/query orderings, store pinning or explicit relinquishment, bounded pending layers, and authority checks after the final await.

8. **MATERIAL — Provider replacement conflicts with LLP 0102 multi-root ownership.**

   LLP 0106 says the predecessor overlay is blanked and disposed before successor subscribe ([LLP 0106](/private/tmp/snapback-llp0106-r1.6ubjRs/capsule/llp/0106-react-presence-and-optimistic-lifecycle.spec.md:150)). LLP 0102 says an A→B context swap releases only that subtree; provider A may remain active in another root ([LLP 0102](/private/tmp/snapback-llp0106-r1.6ubjRs/capsule/llp/0102-first-class-react-and-query-groups.spec.md:944)).

   Resolution: distinguish subtree context replacement from an in-place client custody transition. Only the latter blanks every provider store.

9. **MATERIAL — Hosted qualification depends on absent LLP 0105.**

   LLP 0105 is referenced for Fly authority-instance and native-republisher requirements ([LLP 0106](/private/tmp/snapback-llp0106-r1.6ubjRs/capsule/llp/0106-react-presence-and-optimistic-lifecycle.spec.md:10)), but no LLP 0105 exists in the corpus.

   Resolution: land that governing document before accepting hosted qualification, or remove the references and make all hosted presence explicitly unsupported until a complete future specification replaces them.

10. **MATERIAL — Acceptance is not yet finite and nonvacuous.**

    The package bullets do not bind claims to exact runners/check identifiers, and the comparator receipt has no schema, retained path, target identity, or cleanup oracle. The current six-check demo uses one client for its “cross-client” test and proves neither TTL/disconnect cleanup, optimistic rollback, nor zero residual resources ([demo acceptance](/private/tmp/snapback-llp0106-r1.6ubjRs/capsule/demos/backend-bakeoff/tests/snapback.mjs:68)). SSR/no-demand and hosted-refusal behavior are also absent from the mandatory rows.

    Resolution: name canonical commands, check IDs/counts, zero-skip rules, receipt schema and target identity; require two independently constructed clients with polling disabled; and prove TTL plus forced-disconnect removal, rollback over newer authority, both matcher orderings, SSR no-demand, and zero provider/store/timer/listener/subscription/grant/socket counters.

## Detail concerns

- **DETAIL —** `scopeEpoch` is declared as `string`; accepted and shipped semantics use a safe integer ([client declaration](/private/tmp/snapback-llp0106-r1.6ubjRs/capsule/packages/snapback-client/index.d.mts:125)).
- **DETAIL —** The generated field is `defaultTtlMs`, not `ttlMs`.
- **DETAIL —** “Every snapshot is frozen” should say whether nested presence values are cloned/deep-frozen; the current overlay returns wrappers around shared value objects.
- **DETAIL —** The demo’s rejected-mutation rollback is shared UI logic, not Snapback-adapter-local logic ([App.tsx](/private/tmp/snapback-llp0106-r1.6ubjRs/capsule/demos/backend-bakeoff/src/App.tsx:326)).
- **DETAIL —** “Native delivery” should explicitly mean backend-native WebSocket delivery here, distinct from the separate Expo runtime claim.

`./ref-check --verbose` passes. The current canonical demo wiring does not: `tests/demo_setup_v0.mjs` omits `backend-bakeoff`, and `check-required-surface-builds --list` rejects its required acceptance surface for missing `buildTargets`. No repository files were modified.

VERDICT: NOT READY

## Round 2 — 2026-07-27

**Reviewer family:** OpenAI Codex  
**Provider / runtime:** Codex CLI 0.145.0, `gpt-5.6-sol`  
**Reasoning effort:** ultra  
**Date:** 2026-07-27  
**Redacted:** no  
**Method:** fresh CLI runner, read-only sandbox, mutually blind structurally
isolated capsule  
**Target SHA-256:** `443f38de7a59a9eea3b6c450c74bc6112837878a798f547948a54b2d5bfe7f05`  
**Capsule SHA-256:** `0844ccc5b58af48decb1830e70843a9b36693b0237d575c647eb6faf7bb01a2f`  
**Instruction SHA-256:** `f3cd50fa999bd83c2d3eacc0671d05d5a9a85a82ee7a726f353a5359de3bec1f`  
**Status:** completed  
**Session:** `019fa6bb-6520-7910-847a-b0f4e6791828`

## Overall assessment

LLP 0106 is not ready. Round 2 resolves many headline ambiguities, but several load-bearing lifecycle and projection contracts remain underspecified or contradict the current prepared provider/client seams.

### Strengths

- The capability boundary is honest: local mode works; hosted mode refuses explicitly.
- Presence keys remain server-owned and connection-scoped.
- Presence state is discriminated and provider replacement is distinct from client custody transfer.
- The optimistic design correctly rejects HTTP success as authority and preserves latest-base rebasing.
- Provider-local caps and the ten-check retained receipt are a strong acceptance skeleton.

## Material concerns

1. **[MATERIAL · IN-DELTA] The specified optimistic delegation target does not exist in the prepared provider.**

   LLP 0106 §5.1 says the hook resolves a canonical query store in the provider’s “existing external-store registry” and delegates to its existing `runMutation`. The current React provider instead owns a bespoke `stores` map and calls `client.mutate` directly: [packages/snapback-react/index.mjs](/private/tmp/snapback-llp0106-r2.WQdgcd/capsule/packages/snapback-react/index.mjs:139). The actual external-store ledger is separate: [packages/snapback-client/external-store.mjs](/private/tmp/snapback-llp0106-r2.WQdgcd/capsule/packages/snapback-client/external-store.mjs:333).

   This exposes pre-existing drift from LLPs 0012/0064, but LLP 0106 makes that drift load-bearing. An implementation could satisfy the prose by adding a second ledger, violating the core “strict projection” constraint.

   **Bounded resolution:** Amend LLP 0106 to name the exact canonical store object exposed by the prepared binding/provider, including its lookup key and mutation method. Require `useSnapbackQuery` and `useSnapbackMutation` to share that same instance, and add an acceptance assertion that one query has one store and one optimistic ledger.

2. **[MATERIAL · IN-DELTA] Optimistic reducer failure is not a total state machine.**

   The spec says every rebase failure leaves “no state or network work,” but a rebase can occur after the network request has begun. The current external store installs a layer before invoking its reducer, and later rebases and matchers are also invoked without an isolating transition boundary. A thrown reducer can strand ledger state or escape authoritative delivery.

   The spec also does not decide whether optimism is permitted before the query has received an authoritative base; the current placeholder `[]` could otherwise become the update input. Query-first correlation additionally needs bounded remembered evidence while the mutation result is unavailable.

   **Bounded resolution:** Split the contract into:

   - Initial installation: validate against a same-authority committed base before visibility and before sending.
   - Later rebase: if the reducer fails, atomically remove only that presentation layer, emit a local diagnostic, preserve other layers and the in-flight mutation’s settlement, and never rerun the failed reducer.
   - Correlation: define a bounded scalar/version receipt rather than retaining arbitrary live snapshots.
   - Pinning: state whether a pin keeps upstream demand alive and the exact terminal events that release it.

   Add tests for reducer failure during initial installation, authoritative delivery while pending, rejection after newer authority, and both response/query orderings with concurrent attempts.

3. **[MATERIAL · IN-DELTA] `EphemeralRoomHandleV1` is conceptual rather than an implementable client seam.**

   The current client exposes asynchronous subscribe/unsubscribe operations and an overlay whose `dispose()` releases local listeners, but it has no single handle covering manager demand, grants, unsubscribe, cancellation, late completions, and settlement. LLP 0106 nevertheless requires React to avoid direct manager access and promises zero remaining stores, timers, listeners, subscriptions, grants, and sockets after `settled()`.

   In particular, an unresolved subscribe request, a late successful grant, and cached connection grants make that guarantee impossible without a specified lower-level extension.

   **Bounded resolution:** Specify the exact client factory and closed handle interface—such as `startEphemeralRoom`—including:

   - started/state subscription/snapshot operations;
   - publish, delete, and resync-reason delivery;
   - generation fencing and caller cancellation;
   - `dispose()` ordering;
   - bounded `settled()` semantics;
   - provider-level grant/socket sharing and release;
   - exact integration with LLP 0105 republish registration.

   Acceptance must cover never-resolving subscribe/unsubscribe, late success and failure, dispose during startup, shared connections, and the final grant/socket count.

4. **[MATERIAL · IN-DELTA] Monotonic expiry cannot be derived from the existing wire payload.**

   LLP 0106 correctly requires monotonic local expiry, following LLP 0013. The current schema supplies server wall-clock `received_at_ms` and `expires_at_ms`, but no snapshot server time or per-entry remaining TTL. For an aged snapshot, `expires_at_ms - received_at_ms` is the original TTL, not the remaining lifetime; comparing absolute server time to the client clock is unsafe under skew.

   **Bounded resolution:** Decide the wire carrier: snapshot server time or per-entry remaining TTL. At receipt, convert it once into a hidden client-monotonic deadline; retain wall-clock fields only for presentation. If this changes the protocol, describe its offer/version gating. Add large positive/negative clock-skew tests using aged initial snapshots.

5. **[MATERIAL · IN-DELTA] Prepared-reference admission and connection-only typing are incomplete.**

   The shown hook signature accepts any `EphemeralCollectionReference`; its claimed connection-only narrowing exists only in prose. The current prepared React binding admits function references, not ephemeral collection definitions, and generated ephemeral references do not contain the `publishRate` data LLP 0106 says drives admission.

   Without an exact binding extension, runtime comparison can trust caller-supplied deployment facts or accept stale/forged references.

   **Bounded resolution:** Define a `ConnectionEphemeralCollectionReference` type and use it in the public signature. Extend `prepareReactBinding` with a private admitted ephemeral-definition map derived from generated and deployed manifests. Enumerate the closed identity/configuration fields—including rate, TTL, scope, value-schema and authority identity—and require runtime behavior to use admitted values. Add compile-time and runtime refusals for Session/User/Custom, stale, and forged references.

6. **[MATERIAL · IN-DELTA] Publisher intent transitions remain ambiguous.**

   Declarative `options.value` and imperative `publish`/`delete` share one hook token, but precedence on rerender is not defined. A failed rate/size/auth publish is said not to retry silently, while heartbeat and authority republish would naturally retry the retained intent. Heartbeat failures have no caller promise, and `publishing` does not distinguish awaiting-current from authority-acknowledged current.

   **Bounded resolution:** Add a per-token transition table covering desired versus acknowledged value, declarative/imperative precedence, pending actions, rerender, heartbeat, resync, delete, failure classes, intent suspension/clearing, and token release. Tests should include initial and heartbeat failure, delete while a non-skip prop remains, prop change after an imperative override, action during startup, and conflicting publisher tokens.

## Detail concerns

- **[DETAIL · IN-DELTA]** “Fits the sustained/burst budget” needs an exact conservative admission formula, including first publish, synchronized authority republish, timer rounding, and whether user-driven changes share the reserved burst budget.
- **[DETAIL · IN-DELTA]** `forced-disconnect-delete` can pass vacuously by observing ordinary TTL expiry. Require peer-observed removal before the TTL deadline, with evidence distinguishing disconnect cleanup from expiry. Define inspected namespaces and a deadline for `zero-resources`.

The document needs another revision that closes these contracts before implementation or retained evidence can demonstrate a unique, strict projection rather than several plausible new ownership layers.

VERDICT: NOT READY

## Round 3 — 2026-07-27

**Reviewer family:** OpenAI Codex  
**Provider / runtime:** Codex CLI 0.145.0, `gpt-5.6-sol`  
**Reasoning effort:** ultra  
**Date:** 2026-07-27  
**Redacted:** no  
**Method:** fresh CLI runner, read-only sandbox, mutually blind structurally
isolated capsule; declared implementer lens  
**Target SHA-256:** `99f34faa1ca1d1ef8655f221e3b26373320fd46a44bbcf7f51a682902d5f91ba`  
**Capsule SHA-256:** `d6613c1187fac0ed34380b596826f5ab086f9c29f5b10383de28450268bc3e9a`  
**Instruction SHA-256:** `157079b096962389b0e7b5ae6042293a87fc915ffe7d6a071ddedb1add88737f`  
**Status:** completed  
**Session:** `019fa6d5-8c95-75b1-b881-580af937858d`

NOT READY. The core ownership, ledger, authority, and evidence decisions are derivable, but one in-delta wire-protocol choice remains open.

### Findings

1. **MATERIAL · IN-DELTA — `ephemeral_remaining_ttl_v1` has no defined negotiation carrier.**

   [LLP 0106](/private/tmp/snapback-llp0106-r3.uGGZfT/capsule-final/llp/0106-react-presence-and-optimistic-lifecycle.spec.md:152) requires `serverObservedAtMs` under a named offer, but does not say whether that offer is:

   - a capability-manifest fact with unconditional server emission;
   - a connection-open must-understand offer/echo with conditional emission; or
   - a new wire-version binding.

   Those produce materially different old/new rollout behavior. The current open DTO is closed and has only `authInvalidationProtocol` and `wireVersion` ([server.rs](/private/tmp/snapback-llp0106-r3.uGGZfT/capsule-final/src/server.rs:4120)); there is no generic offer carrier. LLP 0094 requires capability proof or version gating for such evolution ([LLP 0094](/private/tmp/snapback-llp0106-r3.uGGZfT/capsule-final/llp/0094-wire-envelope-contract.spec.md:686)), while LLP 0105 demonstrates the exact offer/echo and four-way rollout expected for an ephemeral wire addition ([LLP 0105](/private/tmp/snapback-llp0106-r3.uGGZfT/capsule-final/llp/0105-fly-completion-and-hosted-ephemeral.plan.md:423)).

   **Bounded resolution:** replace the offer sentence with one exact carrier, token/value, witness, binding scope, absent/unknown behavior, and emission rule covering HTTP snapshots, WebSocket frames, and lane-P drains. Alternatively, choose manifest-only gating and add old-client/new-server tolerance fixtures for every carrier plus new-client/old-server refusal. No broader explanation is needed.

2. **DETAIL · IN-DELTA — the private prepared-ephemeral artifact shape is not pinned.**

   The required comparison is clear, but today `prepareReactBinding` accepts only functions plus capability metadata ([react-binding.mjs](/private/tmp/snapback-llp0106-r3.uGGZfT/capsule-final/packages/snapback-client/react-binding.mjs:56)); generated references omit schemas and policy identity ([codegen](/private/tmp/snapback-llp0106-r3.uGGZfT/capsule-final/packages/snapback-codegen/index.mjs:5544)); deployed collection facts contain fields, bounds, and policies but not scope/value schemas ([ephemeral.rs](/private/tmp/snapback-llp0106-r3.uGGZfT/capsule-final/src/ephemeral.rs:687)).

   **Bounded resolution:** pin `PreparedEphemeralDefinitionV1` and its generated/deployed sources in a type or comparator test. Replace “authority identity” with the exact static policy/projection digest; LLP 0059 authority captures and LLP 0105 authority instances must remain per-generation runtime facts.

3. **DETAIL · IN-DELTA — latest-intent ordering needs one race test.**

   The desired/acknowledged/suspended choice is fixed, but publish replacement or delete can overlap a queued heartbeat or stale acknowledgement. Add a test proving that a superseded send cannot restore `published`, and that successful last-publisher deletion cannot be followed by an old heartbeat. This is implementation sequencing, not a new design decision.

4. **DETAIL · IN-DELTA — pin the room-handle TypeScript spelling.**

   `started` is named without saying whether it is a promise property or `started(): Promise<void>`, while `dispose()` and `settled()` are explicit. The governing live-query handle uses the method form. A declaration/type fixture is sufficient.

No PRE-EXISTING concern affects readiness. The one-store/one-ledger ownership, room-handle cleanup boundary, authority gates, optimistic pin releases, and ten receipt checks otherwise compose without another material fork.

VERDICT: NOT READY
