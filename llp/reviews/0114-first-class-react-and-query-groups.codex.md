# LLP 0114 review — Codex family


## Round 1 — 2026-07-27

**Reviewer family:** OpenAI Codex  
**Provider / runtime:** Codex CLI 0.145.0, `gpt-5.6-sol`  
**Reasoning effort:** ultra  
**Date:** 2026-07-27  
**Redacted:** no  
**Method:** fresh CLI runner, read-only sandbox, mutually blind structurally
isolated capsule  
**Target SHA-256:** `8c705764fbc51a1947870409784729c90a453fcf815ed35a94e596107e426d2e`  
**Capsule SHA-256:** `b7d74be01d7dd4723d9bc97b9aaec0c1b83058c9386397393caed4b7ab199388`  
**Instruction SHA-256:** `2b8c3f3fb4ee645b1a6f4efce41a4ace13dbc3dbbdd14039d1ca2ce07e7b56fd`  
**Status:** completed

## 1. Overall assessment

LLP 0114 has the right product shape and ownership philosophy, but it is not ready to implement. Several core contracts require implementers to invent semantics that belong to existing owners, particularly authority partitioning, authenticated RQS adoption, mutation settlement custody, and protected presence.

The most serious blockers are:

- the proposed authority seam does not exist and conflicts with current custody models;
- canonical identity contradicts LLP 0092 and omits LLP 0101 compatibility identity;
- authenticated registered-bundle adoption is currently refused by the headless client;
- mutation IDs, receipts, acknowledgements, retries, and retention are not a finite lifecycle;
- SSR changes existing external-store semantics while retaining the v1 token; and
- Signal Desk is not an executable, pinned migration target.

## 2. Strengths

- The ownership boundary is excellent: React remains a projection over headless transport, RQS, external stores, and ephemeral rooms rather than becoming another cache, transport, or auth model ([0102:31–43](/private/tmp/snapback-llp0102-r1.UNYXOE/llp/0114-first-class-react-and-query-groups.spec.md:31)).
- Single hooks and query groups share canonical child stores; groups are immutable projections rather than normalized caches ([0102:336–341](/private/tmp/snapback-llp0102-r1.UNYXOE/llp/0114-first-class-react-and-query-groups.spec.md:336)).
- Group status, errors, freshness, connection reduction, and boot provenance are unusually honest. In particular, `boot` is not mislabeled as continuing transactional consistency ([0102:343–395](/private/tmp/snapback-llp0102-r1.UNYXOE/llp/0114-first-class-react-and-query-groups.spec.md:343)).
- The mutation design correctly distinguishes proven rejection from ambiguous transport failure and forbids automatic retry under a new identity ([0102:460–465](/private/tmp/snapback-llp0102-r1.UNYXOE/llp/0114-first-class-react-and-query-groups.spec.md:460)).
- Presence correctly remains ephemeral, uses the shared connection, resnapshots after continuity loss, and stays outside RQS, durable versions, retention, backups, and offline queues ([0102:519–563](/private/tmp/snapback-llp0102-r1.UNYXOE/llp/0114-first-class-react-and-query-groups.spec.md:519)).
- The spec preserves LLP 0101 as the sole result-typing authority and does not manufacture precision for unknown operations ([0102:232–249](/private/tmp/snapback-llp0102-r1.UNYXOE/llp/0114-first-class-react-and-query-groups.spec.md:232)).
- Caps, generation fencing, late-handle disposal, terminal disposal, and broad acceptance coverage are all pointed in the right direction.

## 3. Concerns

### 1. Critical — MATERIAL: `AuthorityPartitionV1` is not an existing or closed authority contract

**Evidence:** The target describes a “current closed” partition obtained through `getAuthoritySnapshot`/`subscribeAuthority` and containing authority instance, auth fingerprint, tenant/provider/delegation, and stream/reset epoch ([0102:178–190](/private/tmp/snapback-llp0102-r1.UNYXOE/llp/0114-first-class-react-and-query-groups.spec.md:178)). Those methods and that type do not exist. The headless client exposes `captureAuthority()` and barrier registration ([index.mjs:1926–1976](/private/tmp/snapback-llp0102-r1.UNYXOE/packages/snapback-client/index.mjs:1926)). Browser custody’s closed capture is `{authorityEpoch,custodyRevision,authorityKey}`, and ordinary publication deliberately ignores same-authority custody rotation ([0059:1653–1694](/private/tmp/snapback-llp0102-r1.UNYXOE/llp/0059-session-projection-and-client-barrier.spec.md:1653)). Agent and external-bearer custody have different axes.

A normal listener is also insufficient: LLP 0059 requires coordinated quiesce, synchronous blanking, memory clearing, durable disposition, and staged successor publication ([0059:2092–2134](/private/tmp/snapback-llp0102-r1.UNYXOE/llp/0059-session-projection-and-client-barrier.spec.md:2092)).

**Resolution criteria:** Define a closed, headless-owned cache projection for dev, browser session, agent, external bearer, clearing, disposed, and exhausted states. Pin equality rules, especially same-authority bearer rotation. Compose the React provider as an auth-barrier participant rather than a post-hoc listener. Add transition-during-start, registration-during-clearing, same-authority rotation, agent replacement, external-bearer replacement, cross-context wakeup, and counter-exhaustion tests.

### 2. High — MATERIAL: canonical query identity omits LLP 0101 compatibility identity and finite canonicalization

**Evidence:** The target keys stores by provider object, generated reference ID, canonical args, and authority ([0102:178–182](/private/tmp/snapback-llp0102-r1.UNYXOE/llp/0114-first-class-react-and-query-groups.spec.md:178)). LLP 0101 requires the complete `ExpectedOperationV1` tuple across live subscriptions and query groups; stable operation ID is authorization identity, not implementation equality ([0101:216–248](/private/tmp/snapback-llp0102-r1.UNYXOE/llp/0101-inline-handlers-and-result-contracts.spec.md:216)). HMR or artifact replacement can therefore reuse predecessor rows under the same stable ID.

“Canonical args” is also unnamed and unbounded. Current external-store canonicalization recursively reads values—including getters—with no depth, node, or byte limit ([external-store.mjs:68–100](/private/tmp/snapback-llp0102-r1.UNYXOE/packages/snapback-client/external-store.mjs:68)).

**Resolution criteria:** Key query stores by the full expected-operation compatibility tuple plus one shared, descriptor-safe, bounded canonical-argument encoding. Reject accessors, cycles, unsupported prototypes, excessive depth/nodes/arrays/bytes, and generation exhaustion before acquiring resources. Test same ID/different implementation tuple, hostile getters, oversized structures, and HMR replacement.

### 3. Critical — MATERIAL: RQS identity, authenticated adoption, and whole-bundle ownership conflict with existing owners

**Evidence:**

- LLP 0114 says different authorities never share RQS adoption ([0102:178–182](/private/tmp/snapback-llp0102-r1.UNYXOE/llp/0114-first-class-react-and-query-groups.spec.md:178)). LLP 0092 requires verified `rqsEligible` queries to use the authority-independent sentinel as their canonical identity so anonymous preload and authenticated consumption share one store ([0092:238–273](/private/tmp/snapback-llp0102-r1.UNYXOE/llp/0092-rqs-manifest-bundle-and-channel-a-contract.spec.md:238)).
- The current registered registry drops the bundle’s authorization projection ([rqs-preload.mjs:99–132](/private/tmp/snapback-llp0102-r1.UNYXOE/packages/snapback-client/rqs-preload.mjs:99)), and `liveQuery` explicitly refuses adoption when an authorization namespace exists ([index.mjs:6623–6654](/private/tmp/snapback-llp0102-r1.UNYXOE/packages/snapback-client/index.mjs:6623)).
- Register mode arms the whole bundle, but 0102 consumes entries lazily per mounted child. Attaching through one child can leave unconsumed registered siblings live with no store, lane consumer, connection count, or cleanup owner.
- `fetchBundle` adopts the grant into the exact originating client’s private cache ([index.mjs:4053–4098](/private/tmp/snapback-llp0102-r1.UNYXOE/packages/snapback-client/index.mjs:4053)), while 0102 permits passing its registry to an arbitrary client.

**Resolution criteria:** Define separate auth-scoped and verified authority-independent identity classes. Make registered registries branded, client-bound, authority-bound, single-owner resources with `claim`/`dispose` semantics. Preserve the full authorization projection and initialize the existing authorization fence before publishing rows. Provider construction must own every registration, attach deadline, and unconsumed-entry cleanup. Persist immutable boot provenance on the canonical child store rather than losing it after one-shot consumption. Test sessions-mode adoption, client/authority mismatch, partial and zero consumption, deadline expiry, provider disposal, and anonymous-preload-to-authenticated adoption.

### 4. Critical — MATERIAL: SSR/hydration changes v1 semantics without a safe handoff

**Evidence:** The current v1 store returns its changing live snapshot from `getServerSnapshot()` ([external-store.mjs:315–331](/private/tmp/snapback-llp0102-r1.UNYXOE/packages/snapback-client/external-store.mjs:315)). LLP 0114 changes that to an immutable construction snapshot while simultaneously stating that changed snapshot meaning requires a new exact token ([0102:605–643](/private/tmp/snapback-llp0102-r1.UNYXOE/llp/0114-first-class-react-and-query-groups.spec.md:605)).

No serializable server-to-browser handoff is defined. A never-reused process-local authority instance cannot match across runtimes, and a registered bundle’s browser grant cannot safely be transferred from a server-side client.

**Resolution criteria:** Either preserve the current v1 meaning or mint a new external-store protocol with an explicit migration path. Define a serializable hydration snapshot carrying operation identity, bundle provenance, schema identity, and public-versus-authority-bound classification—but no bearer or grant. Scope authenticated registered SSR explicitly or exclude it. Add real `react-dom/server` plus `hydrateRoot` tests for public preload, authority mismatch, stale bundle identity, zero server transport, and privacy-safe empty fallback.

### 5. High — MATERIAL: Strict Mode linger, provider replacement, and disposal lack one coherent state machine

**Evidence:** The spec says final unsubscribe synchronously invalidates the attempt generation, yet microtask linger lets Strict Mode reattach without parallel demand ([0102:612–619](/private/tmp/snapback-llp0102-r1.UNYXOE/llp/0114-first-class-react-and-query-groups.spec.md:612)). Current behavior immediately invalidates and disposes the upstream attempt; only the store object lingers ([external-store.mjs:209–220](/private/tmp/snapback-llp0102-r1.UNYXOE/packages/snapback-client/external-store.mjs:209), [external-store.mjs:421–451](/private/tmp/snapback-llp0102-r1.UNYXOE/packages/snapback-client/external-store.mjs:421)). The current Strict Mode test therefore expects at least two starts ([package.test.mjs:90–100](/private/tmp/snapback-llp0102-r1.UNYXOE/packages/snapback-react/package.test.mjs:90)).

Provider replacement is also conflated with authority change. Switching one React root from provider A to B cannot globally invalidate A if another root still uses it. The raw shared store remains publicly exposed, and current `close()` retains its last snapshot.

**Resolution criteria:** Define subscriber, publication, and upstream-attempt states separately. Specify zero-listener callback buffering, pending-handle resolution during linger, forced authority fencing, and whether the guarantee is “one start” or merely “no simultaneous server demand.” Treat provider replacement as binding-scoped detach/blanking, not provider-global authority invalidation. Define who calls terminal `provider.dispose()`, require terminal blanking, and test two roots sharing A while only one switches to B.

### 6. Critical — MATERIAL: mutation identity and retained settlement are neither compositional nor finite

**Evidence:** The React mutation registry is per generated mutation and authority, while a supplied ID becomes the server-wide `clientMutationId` ([0102:437–441](/private/tmp/snapback-llp0102-r1.UNYXOE/llp/0114-first-class-react-and-query-groups.spec.md:437)). The spec does not define operation/args/authority binding, same-ID re-entry, late receipts, standalone or piggyback ACK custody, reload behavior, or authority-return handling.

LLP 0043 requires auth-bound retained settlement until acknowledgement and preserves ambiguous receipt-less requests ([0043:169–206](/private/tmp/snapback-llp0102-r1.UNYXOE/llp/0043-offline-replay-retention.rfc.md:169)). LLP 0101 refuses reuse of one ID under another expected tuple ([0101:401–418](/private/tmp/snapback-llp0102-r1.UNYXOE/llp/0101-inline-handlers-and-result-contracts.spec.md:401)). The headless client already owns receipt observation and `acknowledgeMutations` ([index.mjs:4142–4197](/private/tmp/snapback-llp0102-r1.UNYXOE/packages/snapback-client/index.mjs:4142)); 0102 does not compose that owner.

The 1,024 cap applies only to nonterminal attempts while unacknowledged terminal entries may not be evicted, leaving an unbounded client ledger.

**Resolution criteria:** Either project an existing durable headless mutation owner or explicitly limit plain Online React mutations to non-retryable raw outcomes. Define a provider-wide per-authority ID index bound to the full expected-operation tuple and canonical args. Same-ID exact retry must rejoin/resend; mismatch must refuse before transport. Define late-receipt reconciliation, ACK delivery and retention, disposal/reload handoff, aggregate status, and total record/byte caps without evicting ambiguous or unacknowledged facts. Replace “never reused” with a durable allocator or an honest collision-resistant guarantee.

### 7. High — MATERIAL: optimistic convergence needs a durable-version join

**Evidence:** The target claims query-before-response and response-before-query converge ([0102:443–458](/private/tmp/snapback-llp0102-r1.UNYXOE/llp/0114-first-class-react-and-query-groups.spec.md:443)). Without a matcher, current code retires only after an authoritative revision strictly later than confirmation ([external-store.mjs:139–158](/private/tmp/snapback-llp0102-r1.UNYXOE/packages/snapback-client/external-store.mjs:139)). If the committing query delivery arrives while the mutation is pending, confirmation records the already-advanced revision and no later delivery may occur.

Current retained preload also calls the same authoritative-row path and can incorrectly retire optimistic state ([external-store.mjs:238–255](/private/tmp/snapback-llp0102-r1.UNYXOE/packages/snapback-client/external-store.mjs:238)).

**Resolution criteria:** Join the query’s durable version to the mutation receipt’s authoritative snapshot version, or require a generated authoritative matcher. Retained and connection-only deliveries must never advance that proof. Test both delivery orderings without assuming a later query event, plus retained-after-confirmation and inactive-target-store cases.

### 8. Critical — MATERIAL: protected presence requires an auth model the declared API does not provide

**Evidence:** The target forbids caller-authored user, authority, and permissions ([0102:97–100](/private/tmp/snapback-llp0102-r1.UNYXOE/llp/0114-first-class-react-and-query-groups.spec.md:97)), but current headless ephemeral APIs require `userId` and `permissions` ([index.mjs:4320–4454](/private/tmp/snapback-llp0102-r1.UNYXOE/packages/snapback-client/index.mjs:4320)). Generated runtime collection references contain key and TTL facts but omit the compiled publish/subscribe policy ([codegen:4932–4959](/private/tmp/snapback-llp0102-r1.UNYXOE/packages/snapback-codegen/index.mjs:4932)), while the structural React type omits even key mode and TTL ([0102:223–229](/private/tmp/snapback-llp0102-r1.UNYXOE/llp/0114-first-class-react-and-query-groups.spec.md:223)).

`sessionId` and `ownerUserId` must be assertion-only under LLP 0013, and one connection may legitimately own multiple custom keys ([0013:133–161](/private/tmp/snapback-llp0102-r1.UNYXOE/llp/0013-ephemeral-realtime-state.rfc.md:133)). The target’s blanket “self conflict” rule does not preserve that case.

**Resolution criteria:** Add a versioned, reference-aware headless room capability that derives authority and permissions from the bound client/grant. Emit the complete generated collection policy/profile into runtime references. Make `self` options discriminated by generated key mode; derive session/user ownership from transport authority and allow multiple connection-owned custom keys. Test spoof refusal, protected rooms without app permission strings, key-mode-invalid options, policy mismatch, and missing capability before demand.

### 9. High — MATERIAL: presence TTL and teardown are not clock-safe or necessarily finite

**Evidence:** LLP 0013 requires client-local monotonic expiry scheduling and forbids correctness depending on synchronized wall clocks ([0013:194–210](/private/tmp/snapback-llp0102-r1.UNYXOE/llp/0013-ephemeral-realtime-state.rfc.md:194)). The current overlay compares server epoch timestamps with `Date.now()` and only prunes on reads ([index.mjs:8093–8108](/private/tmp/snapback-llp0102-r1.UNYXOE/packages/snapback-client/index.mjs:8093)). LLP 0114 requires timers but only states “not rendered past `expiresAtMs`.”

The required server-unsubscribe-before-manager-detach ordering can also hang final cleanup unless it is bounded and `finally`-safe.

**Resolution criteria:** Derive a local monotonic deadline from bounded server remaining-TTL metadata and local receipt time; use epoch timestamps only as provenance. Require bounded/abortable unsubscribe with unconditional local detach and timer removal in `finally`. Define publisher heartbeat behavior during app background/foreground. Test clock skew, wall-clock jumps, stale connection, timer replacement, hung unsubscribe, socket loss, disposal during unsubscribe, and sibling-room survival.

### 10. High — MATERIAL: store caps exceed the one-connection wire limit and group construction is not transactional

**Evidence:** A provider uses one connection for every durable query ([0102:138–147](/private/tmp/snapback-llp0102-r1.UNYXOE/llp/0114-first-class-react-and-query-groups.spec.md:138)) but admits 1,024 active query stores ([0102:621–627](/private/tmp/snapback-llp0102-r1.UNYXOE/llp/0114-first-class-react-and-query-groups.spec.md:621)). The backend admits only 64 durable subscriptions per connection ([local.rs:84–94](/private/tmp/snapback-llp0102-r1.UNYXOE/src/local.rs:84)). A 64-child group plus one independent query already violates the wire ceiling.

The group’s canonical identity is undefined, so the inline object shown in the example can create registry churn. Although invalid map shape refuses before acquisition, a later child capability or capacity failure can leak children already acquired, contrary to the existing construction-failure rule ([0034:872–888](/private/tmp/snapback-llp0102-r1.UNYXOE/llp/0034-contract-source-seam-provider-side.rfc.md:872)).

**Resolution criteria:** Separate cached-store, active-upstream, and server-registration limits. Derive active capacity from the target-reported connection limit. Preflight unique new child demand atomically and unwind every partial acquisition. Define group identity as a canonical label-to-child-identity map, including insertion-order and label-normalization rules. Add 64/65, group-plus-single, equivalent-object rerender, and failure-at-every-child-index tests.

### 11. High — MATERIAL: capability and package closure are not executable

**Evidence:** The spec refers to authority-source, presence, subscription, and target bundle capabilities without defining a closed capability snapshot, version, provenance, or change/fencing protocol. Method presence is not target support.

The new public factory names `SnapbackClient`, but `@snapback/client` has no typed root export ([package.json:6–34](/private/tmp/snapback-llp0102-r1.UNYXOE/packages/snapback-client/package.json:6)). Its RQS registry exports also lack declarations. The current Expo provider compensates with a local structural client and `as unknown`/result casts ([Expo provider:11–35](/private/tmp/snapback-llp0102-r1.UNYXOE/demos/competitive-checkpoint/surfaces/react-expo/provider.ts:11)). Workspace-local tests will not catch packed-package or Metro closure failures.

**Resolution criteria:** Define a versioned headless capability projection with fail-closed unknown/downgrade behavior. Ship public declarations for the root client, registries, stores, and hooks. Install packed artifacts in a clean consumer and run strict TypeScript, Vite production, Metro/release, and server-code-exclusion checks without path aliases or casts. Require target-negative tests, including Cloudflare register refusal, and refresh only the OS receipts actually claimed while preserving explicit iOS/Android GAPs.

### 12. High — MATERIAL: the Signal Desk migration is not an executable acceptance target

**Evidence:** The target uses `"signal-desk"` only as an example connection label and later requires an unnamed maintained demo ([0102:80–88](/private/tmp/snapback-llp0102-r1.UNYXOE/llp/0114-first-class-react-and-query-groups.spec.md:80), [0102:749–767](/private/tmp/snapback-llp0102-r1.UNYXOE/llp/0114-first-class-react-and-query-groups.spec.md:749)). The in-repository program identifies Signal Desk as a working-copy comparator, not a pinned source ([program:12–20](/private/tmp/snapback-llp0102-r1.UNYXOE/issues/shelved/20260727-backend-bakeoff-improvement-program.md:12)). The governing ticket specifically expects four hand-built subscriptions and custom aggregation/disposal to be deleted ([group ticket:34–45](/private/tmp/snapback-llp0102-r1.UNYXOE/issues/20260727-typed-live-query-groups.md:34)).

Current maintained demos demonstrate the glue to remove—generated API lookup, structural client casts, per-query connection IDs, and envelope normalization—but neither is a named Signal Desk presence migration.

**Resolution criteria:** Pin the Signal Desk source revision/path or vendor the fixture. Name an unconditional acceptance command and enumerate the code expected to disappear: custom provider subscribe/mutate adapters, generated lookup, per-query connection IDs, caller authority/permissions, custom aggregation, cleanup flags, transport construction, and parallel cache. If that source cannot be included, narrow the claim to a named in-repository demo.

### 13. Low — DETAIL: internal editorial inconsistencies remain

**Evidence:** Metadata says `Review`, while the implementation section calls the document a Draft ([0102:4](/private/tmp/snapback-llp0102-r1.UNYXOE/llp/0114-first-class-react-and-query-groups.spec.md:4), [0102:771](/private/tmp/snapback-llp0102-r1.UNYXOE/llp/0114-first-class-react-and-query-groups.spec.md:771)). The diagnostics list has a semicolon before two remaining entries ([0102:659–671](/private/tmp/snapback-llp0102-r1.UNYXOE/llp/0114-first-class-react-and-query-groups.spec.md:659)).

**Resolution criteria:** Reconcile status and correct the closed diagnostic list punctuation.

## 4. Suggestions

- Put immutable `bootProvenance` on each canonical query store and reduce group provenance over unique children.
- Give RQS registries an opaque, client-bound `claim()`/`dispose()` lifecycle rather than exposing lifecycle ownership through `lookup()`/`consume()`.
- Add normative state tables for query linger, mutation attempts, provider replacement, presence resync, and terminal disposal.
- Distinguish cached objects, active upstream demand, registered server demand, retained settlements, and timers in inspection/capacity reports.
- Make the guide update delete every caller-authored `userId`, `authority`, and permission example from the paved React path.

## 5. Open questions

- Is `AuthorityPartitionV1` a new opaque cache projection, or intended to replace existing authority captures?
- Is authenticated, auth-scoped registered-bundle adoption required in v1, or only dev/authority-independent adoption?
- Is SSR limited to public/read-mode RQS, or expected to include authenticated registered bundles?
- Does Strict Mode require exactly one upstream start, or only no simultaneous server demand?
- May plain Online React mutations use durable `clientMutationId`s, or is an injected retained-mutation owner required?
- Does “1,024 active query stores” mean cached stores or active subscriptions?
- Must the raw canonical `store` remain part of public hook results?
- What exact Signal Desk source and revision is the migration gate?

## 6. Readiness verdict

Not ready. The spec’s direction is strong, but authority composition, RQS ownership, mutation settlement, SSR compatibility, protected presence, finite limits, package closure, and the demo migration must be closed before implementation can proceed without inventing parallel owners.

VERDICT: NOT READY

## Round 2 — 2026-07-27

**Reviewer family:** OpenAI Codex  
**Provider / runtime:** Codex CLI 0.145.0, `gpt-5.6-sol`  
**Reasoning effort:** ultra  
**Date:** 2026-07-27  
**Redacted:** no  
**Method:** fresh CLI runner, read-only sandbox, mutually blind structurally
isolated capsule; delta-round instructions  
**Target SHA-256:** `44adac3c8c66ae95df02544f74e6fa8a51a8fb6fbf26c101494119444d7c4e13`  
**Dependency SHA-256:** `bd1bb9aaaa4f9c9015039d09a716add5ea86dbc442d0954ff49b11931e9fb3ac`  
**Capsule SHA-256:** `c274b7b678658a4af06638f1ded79decad5f394381cae5d6cc97dc68a5aff7f4`  
**Instruction SHA-256:** `288cb574eb466f926debad2f924b2307ff5687b58bb91d10b3c63c89a25189a9`  
**Status before launch:** pending

**Status:** completed  
**Verdict:** NOT READY

## Overall assessment

The narrowed v1 is architecturally sound, but not yet implementation-ready. It can avoid a second authority, transport, or store owner by making React a thin lifetime/context façade over `SnapbackClient`, its `LiveStreamManager`, and the existing external-store registry. The normative section currently assumes that façade already ships and relies on lifecycle, admission, and typing seams that do not exist or are not fully specified.

I reviewed the final reconciliation as the controlling delta, used LLP 0101 only for generated-reference dependencies, and did not consult prior reviews or journals.

## Strengths

- The exclusions are crisp: no React authority DTO, caller authority, RQS adoption, SSR data hydration, presence, optimistic ledger, or atomic multi-query claim ([LLP 0114](/private/tmp/snapback-llp0102-r2.MhCUkB/llp/0114-first-class-react-and-query-groups.spec.md:795)).
- Avoiding a React authority owner matches shipped behavior: the client already synchronously blanks live materializations during authority transitions ([client](/private/tmp/snapback-llp0102-r2.MhCUkB/packages/snapback-client/index.mjs:6591)).
- The headless client already owns one managed socket per chosen connection ID ([client](/private/tmp/snapback-llp0102-r2.MhCUkB/packages/snapback-client/index.mjs:4763)), and the external-store registry already deduplicates canonical stores and fences late deliveries.
- Quantitative caps, pre-attachment refusal, Strict Mode, reconnect, replacement, packed-install, and leak acceptance requirements are materially stronger than an open-ended “first-class React” goal.
- The server already has exact predecessor supersession, providing a viable foundation for net-zero replacement at the 64-subscription ceiling ([server](/private/tmp/snapback-llp0102-r2.MhCUkB/src/local.rs:7499)).

## MATERIAL concerns

### 1. The claimed existing provider-manager boundary does not ship

The final section assumes an existing single `SnapbackProvider` manager and makes it the store owner ([LLP 0114](/private/tmp/snapback-llp0102-r2.MhCUkB/llp/0114-first-class-react-and-query-groups.spec.md:795)). Shipped React instead accepts an arbitrary `{subscribe, mutate}` provider per hook, stores registries in a `WeakMap`, and still accepts `userId` and caller authority ([runtime](/private/tmp/snapback-llp0102-r2.MhCUkB/packages/snapback-react/index.mjs:36), [declarations](/private/tmp/snapback-llp0102-r2.MhCUkB/packages/snapback-react/index.d.mts:17)). The client owns a map of managers keyed by caller-provided connection IDs, not one provider object. The current Expo adapter even mints a distinct connection ID per query ([provider](/private/tmp/snapback-llp0102-r2.MhCUkB/demos/competitive-checkpoint/surfaces/react-expo/provider.ts:58)).

The earlier factory cannot simply survive the reconciliation unchanged because it includes removed authority, RQS, presence, and ledger responsibilities; the final export list itself names only hooks.

**Resolution criteria:** Define the exact first-party construction/context API: prepared client input, provider instance ID, target/app validation, one private connection label, manager acquisition, store-registry ownership, borrowed-versus-owned client disposal, and provider replacement. It must explicitly delegate authority to the prepared client, transport to the existing `LiveStreamManager`, and logical stores to the existing external-store registry.

### 2. Generated typing and public state/error algebra are not closed

The hooks index `Ref["Args"]` and `Ref["Result"]` ([LLP 0114](/private/tmp/snapback-llp0102-r2.MhCUkB/llp/0114-first-class-react-and-query-groups.spec.md:817)), but codegen emits optional `__args` and `__result` phantoms and no `Args` or `Result` properties ([codegen](/private/tmp/snapback-llp0102-r2.MhCUkB/packages/snapback-codegen/index.mjs:4982)). Generated query results are complete arrays, whereas the existing external store is parameterized by a row and itself exposes `rows: Row[]`; `QueryState<Ref["Result"]>` can therefore accidentally become an array-of-arrays.

The state surface is also incomplete:

- `QueryState`, skipped state, `QueryGroupState`, and `ConnectionState` are undefined in the final contract.
- “Same keys plus `status` and connection” collides with legal entry names `status` and `connection`.
- All-skipped, mixed loading/error, active→skip, skip→active, and post-ready error retention have no defined result.
- Capacity refusal is neither clearly a synchronous refusal nor a group error state.
- Cleanup errors have no observable sink after the final consumer disappears.
- The shipped `getServerSnapshot` returns the current mutable snapshot, not the required stable loading/skipped sentinel ([external store](/private/tmp/snapback-llp0102-r2.MhCUkB/packages/snapback-client/external-store.mjs:330)).

**Resolution criteria:** Use shared `FunctionArgs<R>`/`FunctionResult<R>` helpers; define whether query state contains the whole result or rows; publish closed discriminated unions and a complete transition/aggregate truth table. Prefer `{queries, status, connection, error}` to avoid key collisions. Classify authoring/key errors, admission failures, runtime entry errors, provider-terminal errors, and cleanup diagnostics separately. Add positive and negative inference fixtures for required, optional, nullary, skipped, wrong, and excess arguments.

### 3. Strict Mode, replacement, cancellation, and cleanup cannot satisfy the stated lifecycle through current seams

The final rule requires cancellable microtask disposal ([LLP 0114](/private/tmp/snapback-llp0102-r2.MhCUkB/llp/0114-first-class-react-and-query-groups.spec.md:865)). Currently, final unsubscribe disposes the upstream immediately; only registry eviction waits for a microtask ([external store](/private/tmp/snapback-llp0102-r2.MhCUkB/packages/snapback-client/external-store.mjs:318)). The React test consequently expects multiple upstream starts during Strict Mode replay ([test](/private/tmp/snapback-llp0102-r2.MhCUkB/packages/snapback-react/package.test.mjs:90)).

Further, `liveQuery()` exposes its handle only after establishment, has no abort signal, and its disposal launches best-effort remote unsubscribe without settlement ([client](/private/tmp/snapback-llp0102-r2.MhCUkB/packages/snapback-client/index.mjs:6838)). Manager close is synchronous and non-observable ([client](/private/tmp/snapback-llp0102-r2.MhCUkB/packages/snapback-client/index.mjs:7630)). Thus “delete only after the existing bounded close path” names a path the public seam does not provide.

Provider replacement also needs React commit ordering: render cannot synchronously mutate and close the old provider, while effect cleanup may occur after children have rendered against the successor.

**Resolution criteria:** Separate publication generation from an idle-disposal epoch; expose an immediate cancellable live-query attempt plus bounded observable `dispose/settled`; generation-own all pending subscribe/reconnect/heartbeat timers; define provider replacement at commit, including same-client/same-label behavior and terminal snapshot shape; add a provider-level cleanup diagnostic sink. Test replacement/unmount before subscribe resolves, late success and failure, unsubscribe failure, absent socket-close events, Strict Mode reuse, and zero residual timers/listeners/subscriptions.

### 4. Transactional admission and saturated replacement need an existing-owner extension

A 64-entry group may fill the exact server cap, but ref/args updates must attach replacements before detaching retired subscriptions ([LLP 0114](/private/tmp/snapback-llp0102-r2.MhCUkB/llp/0114-first-class-react-and-query-groups.spec.md:844)). The server can perform exact net-zero supersession, but public `liveQuery()` only supersedes its own prior subscription during reconnect; it cannot transfer a predecessor owned by another store.

There is also no batch reservation seam. The registry offers one-key `get`, immediately inserts the store, and the shipped React hook calls it during render ([React](/private/tmp/snapback-llp0102-r2.MhCUkB/packages/snapback-react/index.mjs:77), [registry](/private/tmp/snapback-llp0102-r2.MhCUkB/packages/snapback-client/external-store.mjs:427)). An abandoned or suspended render can therefore leave a never-subscribed entry that is never made idle. Cap accounting is undefined for duplicate identities, shared existing stores, skipped entries, group child edges, and lingered stores.

**Resolution criteria:** Add transactional `reserve/acquireMany` behavior to the existing registry/manager, not another owner. Admission must operate on deduplicated net-new identities and reclaim abandoned reservations. Expose exact predecessor handoff for uniquely owned retired stores; define behavior when the predecessor is shared. Prove 64→64 replacement, partial handoff failure preserving the old group, concurrent near-cap commits, abandoned Suspense renders, and exact 1,024-consumer accounting.

### 5. Canonical identity is not yet one finite executable grammar

The required SHA-256/JCS identity is clear in outline ([LLP 0114](/private/tmp/snapback-llp0102-r2.MhCUkB/llp/0114-first-class-react-and-query-groups.spec.md:802)), but shipped canonicalizers disagree. The external-store helper silently drops undefined members, invokes getters, and has no depth/node/byte bounds ([external store](/private/tmp/snapback-llp0102-r2.MhCUkB/packages/snapback-client/external-store.mjs:68)). The RQS JCS implementation has different bigint and undefined behavior and is likewise structurally unbounded ([RQS](/private/tmp/snapback-llp0102-r2.MhCUkB/packages/snapback-client/rqs.mjs:180)). Client dispatch validates only the operation name, not the complete generated reference ([client](/private/tmp/snapback-llp0102-r2.MhCUkB/packages/snapback-client/index.mjs:8137)).

“Token” and “secret” are also not recognizable runtime value classes when represented as ordinary strings.

**Resolution criteria:** Export one accessor-free, own-data-property-only `CanonicalClientValueV1` validator/canonicalizer with explicit depth, node, field, array, string, and byte limits. Pin the exact reference projection, provider identity source, UTF-8/domain framing, digest encoding, and cross-web/Expo golden vectors. State credential exclusion structurally—credentials never enter hook arguments or the preimage—rather than promising semantic secret detection.

### 6. The mandated package/demo evidence is not presently executable as described

The packed proof has useful foundations, but the headless root exports JS without declarations ([client package](/private/tmp/snapback-llp0102-r2.MhCUkB/packages/snapback-client/package.json:21)). The current Expo fixture uses repository `paths`, a handwritten `SnapbackClient` declaration, casts, and explicit result generics ([tsconfig](/private/tmp/snapback-llp0102-r2.MhCUkB/demos/competitive-checkpoint/surfaces/react-expo/tsconfig.json:9), [shim](/private/tmp/snapback-llp0102-r2.MhCUkB/demos/competitive-checkpoint/surfaces/react-expo/generated/runtime.d.mts:4)). The cold-install test browser-bundles a JS import but does not typecheck React usage ([cold proof](/private/tmp/snapback-llp0102-r2.MhCUkB/scripts/snapback-package-cold-install.mjs:357)).

The spec says Signal Desk is already imported, but it is absent from the maintained demo/generated-artifact inventory ([inventory](/private/tmp/snapback-llp0102-r2.MhCUkB/scripts/check-generated-artifacts:20)).

**Resolution criteria:** Name the exact maintained demo path and acceptance commands; import Signal Desk or replace the claim with an existing maintained target. Ship root client declarations, then typecheck packed-only web and Expo fixtures with no aliases, ambient shims, casts, or explicit result generics. The cold test must execute the generated starter, live update, mutation, and cleanup proof from materialized tarballs.

## DETAIL concerns

1. Pin mutation normalization: `SnapbackClient.mutate` returns an envelope, while the hook promises the logical result ([client](/private/tmp/snapback-llp0102-r2.MhCUkB/packages/snapback-client/index.mjs:4149)). Say explicitly that React unwraps `.result`. “Existing offline settlement behavior” should be narrowed to pass-through behavior; the direct hook neither creates a mutation ID nor owns an offline queue.

2. `useSnapbackConnection` must use passive manager/provider observation. The current manager’s state listener contributes demand, so mounting only the connection hook could otherwise open a socket.

3. Clarify that portable-label syntax and the 1–64 cardinality are runtime checks, while TypeScript preserves per-entry Args/Result correlation.

4. Reconcile the earlier summary, goals, diagnostics, and public-surface sections before acceptance. The final precedence rule prevents those removed claims from being controlling, but leaving presence, RQS, optimistic, and authority text in the main body makes the document unnecessarily hazardous.

5. Publication needs to rewrite and validate the new `@snapback/client` peer range; the current release tool rewrites only dependencies and optional dependencies. Also pin whether `snapback create` is a new alias: the shipped command is currently `snapback new` ([CLI](/private/tmp/snapback-llp0102-r2.MhCUkB/packages/snapback-cli/index.mjs:1782)).

## Suggestions

- Retain the earlier `createSnapbackReactProvider` concept, but reduce it to a façade over one prepared client, one client-owned connection manager, and one existing external-store registry.
- Put all provider/store resource admission behind one synchronous transactional registry API used only during committed subscription.
- Define the types and state table before runtime implementation; they will expose most skip, error, SSR, and cleanup ambiguities cheaply.
- Make the 64→64 supersession case and abandoned concurrent render the first lifecycle proofs, since they exercise the hardest boundaries.

## Open questions

- Is the intended provider a new React context façade over `SnapbackClient`, or is there another shipped `SnapbackProvider` implementation not present here?
- At the 64 ceiling, must changed entries use exact server supersession, or may a saturated update refuse while preserving the old group?
- Should all-skipped groups be `ready`, `loading`, or a distinct aggregate state?
- Does “offline settlement behavior” mean only preserving diagnostics/idempotency supplied by another owner, or is the hook expected to queue/retry?
- Where is the maintained Signal Desk acceptance target intended to live?

## Readiness verdict

The scope no longer needs an architectural reset, but the provider seam, type/state algebra, lifecycle cancellation, transactional cap handling, canonical grammar, and executable package evidence must be closed before implementation can proceed unambiguously.

VERDICT: NOT READY

## Round 3 — 2026-07-27

**Reviewer family:** OpenAI Codex  
**Provider / runtime:** Codex CLI 0.145.0, `gpt-5.6-sol`  
**Reasoning effort:** ultra  
**Date:** 2026-07-27  
**Redacted:** no  
**Method:** fresh CLI runner, read-only sandbox, mutually blind structurally
isolated capsule; final delta-round instructions  
**Target SHA-256:** `c6dc88557f9fcf69437f57b90df24b420c67103445051125689b6523e923634a`  
**Dependency SHA-256:** `bd1bb9aaaa4f9c9015039d09a716add5ea86dbc442d0954ff49b11931e9fb3ac`  
**Capsule SHA-256:** `98e5d5107b96b41ddb9b52d6b919c94eeeeb223d6842e4404f91cfa7bbb8c40e`  
**Instruction SHA-256:** `a069833b0f9d44630da28dfeb6054afe27ca489d9548b49b1f01de6d57684ed7`  
**Session ID:** `019fa698-3858-7473-bb30-a82eeb773e1d`  
**Status:** completed

Overall assessment: the reconciliation is substantially better, especially its generated type extractors, custody blanking, skip algebra, and split Strict Mode epochs. However, seven material in-delta decisions remain unresolved. I found no controlling pre-existing concern; superseded earlier text did not affect the verdict.

1. **MATERIAL · IN-DELTA — Provider and reference admission is not closed.**

   The synchronous factory requires an “already-prepared” client with app, target, profile, auth-mode, and function-manifest identity ([LLP 0114](/private/tmp/snapback-llp0102-r3.fwZqb8/capsule/llp/0114-first-class-react-and-query-groups.spec.md:915)), but shipped `SnapbackClient` has no such immutable preparation accessor ([client](/private/tmp/snapback-llp0102-r3.fwZqb8/capsule/packages/snapback-client/index.mjs:1217)). Generated references carry app and operation identity but no target identity ([generated API](/private/tmp/snapback-llp0102-r3.fwZqb8/capsule/demos/signal-desk/snapback/generated/api.d.ts:21)), so “reference target mismatch” cannot be checked as written.

   `QueryReference` is also undefined narrowly enough: inherited text admits array-result `Query` references, but `generateBrief` is such a query and the server refuses anything except `LiveQuery` for subscription ([server](/private/tmp/snapback-llp0102-r3.fwZqb8/capsule/src/local.rs:7393)).

   Resolution: define one client-owned immutable prepared-identity/manifest API, its readiness and attestation source, the exact target/profile axis, and synchronous-versus-asynchronous refusal ordering. Keep references target-neutral and validate them against that manifest, or explicitly add target identity through LLP 0101/codegen. Define `QueryReference` as the closed subscribable `LiveQuery` type and add ordinary-query negative fixtures.

2. **MATERIAL · IN-DELTA — Registry, custody, and disposal ownership remains contradictory.**

   The reconciliation borrows the client’s “existing external-store registry” ([LLP 0114](/private/tmp/snapback-llp0102-r3.fwZqb8/capsule/llp/0114-first-class-react-and-query-groups.spec.md:927)), but the shipped registry is provider-scoped and currently created by React ([registry](/private/tmp/snapback-llp0102-r3.fwZqb8/capsule/packages/snapback-client/external-store.mjs:421), [React owner](/private/tmp/snapback-llp0102-r3.fwZqb8/capsule/packages/snapback-react/index.mjs:18)). Moving it to the client leaves the promised per-provider cap, two providers sharing one client, and sibling disposal undefined.

   Custody resume also needs one provider-level participant in the existing auth barrier; blanking individual materializations does not itself reopen the provider’s subscriptions. Finally, `disposeClient:true` has no sharing/exclusivity rule and there is no terminal client close/settlement operation—`closeAuth()` only closes auth participation ([client](/private/tmp/snapback-llp0102-r3.fwZqb8/capsule/packages/snapback-client/index.mjs:3946)).

   Resolution: choose provider-owned registries borrowing client transport, or client-owned provider partitions with explicit leases and per-provider accounting. Require exactly one barrier participant per provider with quiesce/blank/clear/resume/unregister semantics. Either remove transferred disposal, enforce an exclusive client lease, or define terminal client disposal across all provider leases.

3. **MATERIAL · IN-DELTA — The query/connection algebra is not total.**

   The new connection states do not map the shipped `connecting | live | polling | stale | disconnected` behavior, even though `liveQuery` defaults to polling and permits polling fallback ([client](/private/tmp/snapback-llp0102-r3.fwZqb8/capsule/packages/snapback-client/index.mjs:4791)). More importantly, an in-band `resync_required` can revalidate while the socket stays open, but `refreshing` is permitted only “while reconnecting” ([LLP 0114](/private/tmp/snapback-llp0102-r3.fwZqb8/capsule/llp/0114-first-class-react-and-query-groups.spec.md:989)). Neither `ready`, `pending`, nor `error` truthfully describes that retained same-authority state.

   Provider-wide versus group-local connection meaning is also unspecified—for example, an all-skipped group inside a provider that has demand from another root—and there are no aggregation/reset rules for `reconnectAttempt` or diagnostics.

   Resolution: pin transport/fallback policy and provide an exhaustive transition and aggregation table covering no demand, initial attach, polling/live readiness, socket loss, freshness failure, open-socket resync, partial resubscribe success/failure, skip/all-skipped, custody blank/resume, provider swap, final release, and terminal disposal.

4. **MATERIAL · IN-DELTA — `startLiveQuery()` is not a complete cancellable protocol.**

   The proposed immediate handle specifies only `dispose()` and `settled()` ([LLP 0114](/private/tmp/snapback-llp0102-r3.fwZqb8/capsule/llp/0114-first-class-react-and-query-groups.spec.md:1019)). The shipped operation returns only after asynchronous establishment ([client](/private/tmp/snapback-llp0102-r3.fwZqb8/capsule/packages/snapback-client/index.mjs:6894)); the replacement needs an explicit active-generation initial-success/failure channel.

   The proposal also assigns heartbeat and reconnect work to each handle generation, although those timers belong to the shared `LiveStreamManager` and must survive disposal of one sibling handle ([manager](/private/tmp/snapback-llp0102-r3.fwZqb8/capsule/packages/snapback-client/index.mjs:6908)). Per-handle settlement therefore cannot wait for “all socket work and timers” while another handle keeps the manager alive.

   Resolution: define a handle state machine with mandatory initial snapshot/error callbacks or `started()`, idempotent disposal, and precisely scoped settlement. Separate handle-owned subscribe/unsubscribe work from manager-owned shared timers, and define manager settlement after final demand.

5. **MATERIAL · IN-DELTA — Atomic 64→64 replacement is unrealizable over the cited protocol.**

   The server’s exact supersession path replaces one predecessor per subscribe request ([server](/private/tmp/snapback-llp0102-r3.fwZqb8/capsule/src/local.rs:7499)). A 64-entry replacement therefore performs 64 independent wire commits. Failure or response loss after commit \(k\) has already destroyed part of the predecessor group; client-side `reserveMany` can hide partial UI publication but cannot preserve the complete old server group as promised.

   Resolution: either add an idempotent, server-owned batch supersession transaction for the complete predecessor/successor set, or refuse saturated multi-entry replacement and remove the successful 64→64 claim. Ambiguous and unsubscribe-failed slots must remain counted until exact supersession, proven absence, or connection reset.

6. **MATERIAL · IN-DELTA — Canonical identity is incomplete and not normatively serializable.**

   The store key omits `implementationHash`, `argsContractHash`, and `resultContractHash`, although LLP 0101 requires complete runtime references and generated references carry those fields ([LLP 0101](/private/tmp/snapback-llp0102-r3.fwZqb8/capsule/llp/0101-inline-handlers-and-result-contracts.spec.md:704), [generated API](/private/tmp/snapback-llp0102-r3.fwZqb8/capsule/demos/signal-desk/snapback/generated/api.d.ts:28)). A regenerated function can consequently reuse an old typed store without triggering upstream compatibility validation.

   The value categories and limits are finite, but “canonical serialization” still lacks normative object ordering, number/string encoding, Unicode and lone-surrogate treatment, normalization, depth/node/byte accounting, and a portable accessor/proxy capture procedure. “Duplicate normalized keys” has no defined normalization rule.

   Resolution: include complete compatibility identity in the key or synchronously validate every complete reference before registry lookup. Specify or name the exact byte-level canonical algorithm and capture procedure, then publish collision-negative and quantitative boundary vectors independently across Web, Node, and Expo.

7. **MATERIAL · IN-DELTA — The package/demo acceptance gate is not executable as written.**

   The Expo gate names no native platform, Metro/export command, simulator/device carrier, or runtime receipt; current cold-install proof only bundles a browser entry. Signal Desk has no generic `test` script ([package](/private/tmp/snapback-llp0102-r3.fwZqb8/capsule/demos/signal-desk/package.json:5)), and its stated React adapter is currently a headless class performing `Promise.all(client.liveQuery(...))` ([adapter](/private/tmp/snapback-llp0102-r3.fwZqb8/capsule/demos/signal-desk/src/backends/snapback.ts:24)). Its Snapback acceptance test exercises headless `liveQuery`, not the provider, query group, Strict Mode, or cleanup contract.

   Resolution: name exact packed-tarball commands and carriers for web and Expo, stating explicitly whether Expo proof is native runtime or typecheck/bundle only. Identify the Signal Desk React integration seam and exact scripts, and require a React-level receipt covering provider reuse, one manager, group migration, Strict Mode, and cleanup.

Details, all **DETAIL · IN-DELTA**:

- Change `disposeClient?: false` to the ownership type selected by finding 2.
- Define whether the 1,024-consumer cap counts hook calls, group-child edges, or deduplicated stores, and define “end of the committing turn.”
- Publish the exact correlated `QueryEntryMap` mapped type and nullary-argument behavior so the claimed type fixtures have one expected result.

VERDICT: NOT READY
