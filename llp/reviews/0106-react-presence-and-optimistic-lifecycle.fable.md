# Fable-family reviews: LLP 0106

## Round 1 — 2026-07-27

**Reviewer family:** Claude Fable  
**Provider / runtime:** Anthropic Claude Code 2.1.220,
`claude-fable-5` on the approved M4 Mac mini fleet lane  
**Effort:** max  
**Date:** 2026-07-27  
**Redacted:** no  
**Method:** fresh remote CLI runner, read-only tools, mutually blind
structurally isolated capsule  
**Target SHA-256:** `c1d52efd6c130b6c6c3ad8c18a018a9d946384cfc3bfad12b3bfc999491311f2`  
**Capsule SHA-256:** `f76e1d0192fd1466719d8782c04d88fe360fb3804187e7ec775e2c63e7b8841f`  
**Instruction SHA-256:** `f6fa6d45663997f5c7e3ec52ce076aff1eec48c59ded01656c74b75beda1138b`  
**Status:** completed  
**Session:** `6f70b32d-2581-427b-bb29-f8c6e2b15a80`  
**Duration:** 928473 ms  
**Cost:** $9.984186

I've completed the verification pass. Everything I need is in hand — the spec, LLP 0013/0101/0102, the shipped client overlay and external store, the server's ephemeral/limit code, the generated artifacts, and the demo/comparator sources. Here is the review.

---

# Blind review: LLP 0106 (round 1)

**Scope note.** I reviewed `llp/0106-react-presence-and-optimistic-lifecycle.spec.md` against LLP 0013 (Accepted), LLP 0101/0102 (dependency context), and the shipped sources in `packages/snapback-client`, `packages/snapback-react`, `demos/backend-bakeoff`, plus the server's `src/ephemeral.rs`/`src/local.rs` where the Spec makes claims about server contracts. I did not consult `llp/reviews` or any run/orchestrator material, and modified nothing.

## What held under stress

The central premise — presence and optimistic lifecycle as a strict projection over existing owners — is verified sound against the shipped code, not aspirational:

- **Headless overlay seam is real and sufficient.** `subscribeEphemeral` returns an overlay only after the authoritative snapshot, binds `overlay.grantedConnectionId` from the grant (not the readable label) including on grant-refresh retry (`index.mjs:4351-4398`, `7789-7800`), and the overlay owns `onChange`, room isolation, pre-snapshot buffering, epoch/high-water stale rejection, `needs_resync` (including `outbox_overflow` and `permission_epoch_changed` reasons, `index.mjs:7780-7784`), authority blanking, and dispose. Every resync trigger 0106 lists except the LLP 0105 one maps to an existing client signal.
- **The optimistic section is a faithful description of shipped behavior.** `runMutation` already implements stacked layers rebased in attempt order over the newest authoritative rows, rejection removing only its own layer with recompute from the latest base (never a mutation-start snapshot), the `isAuthoritative` matcher consulted only on authoritative deliveries, and the conservative retire-on-next-authoritative-delivery rule (`external-store.mjs:133-160, 333-396`). No second ledger is needed; the Spec's claims match the code line for line.
- **Demo/comparator evidence is finite and nonvacuous.** The app-local glue 0106 promises to remove actually exists: hand-rolled presence overlay + `setInterval` heartbeat (`demos/backend-bakeoff/src/backends/snapback.ts:108-149`) and a hand-rolled optimistic toggle that restores the mutation-start value on rejection (`src/App.tsx:331-357`) — the exact anti-pattern the Spec forbids. The comparator suite already proves native live delivery and durable-version separation (`tests/snapback.mjs`), so the receipt items extend an existing finite suite; "native delivery" matches the suite's existing vocabulary.
- **Capability honesty is grounded.** `capability.manifest.json` reports `ephemeralRealtime`/`ephemeralLocalRoomAuthority` true with `ephemeral_hosted_adapter` and `ephemeral_multi_instance_sticky_routing` gaps, so `unsupported` and hosted noninheritance have real client-visible sources.
- **Typing basis exists.** Generated `EphemeralCollectionReference<Name, Scope, Value>` phantoms, `keyMode`, `defaultTtlMs`/`maxTtlMs`/`maxValueBytes` are on the reference (`demos/backend-bakeoff/snapback/generated/api.d.ts:39-45`), supporting the `EphemeralScope`/`EphemeralValue` extractors with no casts.

## MATERIAL concerns

**M1. Presence semantics are committed only for connection-keyed collections; other key modes are reachable and unspecified.**
Every committed ownership decision — self identity is `overlay.grantedConnectionId`, "a connection-keyed room has one entry per provider connection", the byte-identical managed-value conflict refusal, and "Last publisher release best-effort deletes the connection-owned value" — assumes `keyMode: "connection"`. But the hook admits any `EphemeralCollectionReference`, and both the generated vocabulary and the server ship four key modes (`EphemeralKeyMode = 'Connection' | 'Session' | 'User' | 'Custom'`, `api.d.ts:20`; `KeyMode` enum and `EntryOwner::Session/User/Custom`, `src/ephemeral.rs:638, 556-558`). For a user-keyed collection: `selfKey` is the user id, not the granted connection id, so the committed self-identity rule misidentifies self; LLP 0013 §Scope and keys gives user-owned entries shared-lease semantics (removed only when the last connection lapses), so 0106's committed release-time delete would clobber another tab's live presence; and the per-provider conflict refusal cannot prevent the cross-connection value alternation that divergent same-user values produce by construction. This is a missing decision necessary for the correctness and safety of committed cleanup/identity rules over reachable inputs.
*Bounded resolution:* one normative sentence — v1 admits only connection-keyed collections and refuses others with a structured diagnostic before subscribe (the reference carries `keyMode`, so the check is trivial) — or a defined per-key-mode semantics section.

**M2. The cap table cites a server limit that does not exist.**
"at most 64 simultaneous room subscriptions, shared with the server's exact per-connection ephemeral-subscription limit" asserts a per-connection *ephemeral* subscription limit on the server. None exists: the only per-connection ceiling is `MAX_LIVE_SUBSCRIPTIONS_PER_CONNECTION = 64` (`src/local.rs:93`), whose refusal reads "one connection is limited to 64 **durable** subscriptions" (`src/local.rs:7194`); ephemeral limits are per-room (1,024 subscribers, `src/ephemeral.rs:3192`) and per-process (4,096 rooms), never per connection. The false premise leaves the admission math genuinely ambiguous in the way that matters — do rooms and durable queries share one 64 budget on the provider connection (40 queries ⇒ 24 rooms?) or hold independent 64s? — and the tiebreaker the Spec appeals to isn't there. The acceptance rows "every cap boundary" and "Headless server limit diagnostics pass through unchanged" cannot be written unambiguously against a nonexistent limit.
*Bounded resolution:* restate the 64-room bound as a client-local provider cap enforced by the already-named `SNAPBACK_REACT_PRESENCE_ROOM_LIMIT`, deleting the "shared with the server's…" clause — or first land an actual server-side per-connection ephemeral limit under its owning document and cite that.

**M3. Imperative `publish`/`delete` versus the managed publisher is undefined, and it re-opens the exact hazard the conflict rule closes.**
`PresenceState` exposes both a managed publisher (options `value`, heartbeat, byte-identical conflict refusal) and imperative `publish(value)`/`delete()` on the same connection-keyed entry. Unspecified interactions: (a) `publish(W)` while the managed value is V yields W now and V at the next heartbeat (≤10s later) — precisely the alternation `SNAPBACK_REACT_PRESENCE_VALUE_CONFLICT` exists to prevent, and the resync rule ("republishes the active managed value once") silently drops W; (b) `delete()` under an active managed publisher is undone at the next refresh; (c) an observer-only consumer (`value: skip`, "creates no publisher demand") calling `publish` creates an unmanaged, unrefreshed publisher invisible to the cap accounting, which counts only "active managed publishers". The acceptance row "explicit publish/delete" is untestable until these semantics are decided. Missing decision necessary for coherence of the committed public state.
*Bounded resolution:* one paragraph — e.g., refuse imperative publish/delete while a managed publisher is active for the store (or define last-write precedence and heartbeat adoption of the last published value), and state whether observer publish refuses or counts against the publisher cap.

**M4. Normative dependence on LLP 0105, which does not exist in the corpus.**
LLP 0106 cites LLP 0105 in three normative positions — the hosted claim gate ("for the Fly profile, LLP 0105", line 30), the v1 resync trigger list ("LLP 0105 ephemeral-authority-instance change", line 144), and hosted native qualification ("native client republisher contract from LLP 0105", line 224) — plus the Related header. No LLP 0103, 0104, or 0105 exists anywhere in `llp/` (the corpus runs 0100→0101→0102→0106; tombstones is empty; no other document mentions 0105). "Ephemeral-authority-instance change" is therefore an undefined trigger in a committed v1 lifecycle list — implementers cannot know what client-visible signal fires it — and the hosted qualification bar cannot be reviewed for coherence.
*Bounded resolution:* land LLP 0105 in the same batch, define the trigger inline (naming the client-visible signal), or strike the three citations and the Related entry until the document exists; on the local target the remaining triggers already cover restart/epoch-loss.

**M5. The heartbeat formula admits intervals that exceed the TTL, and the committed refusal doesn't cover it.**
The refresh interval `max(250ms, min(ttlMs/2, 10_000ms))` is refused only when it violates the publish-rate budget. But `ttlMs` is caller-suppliable per hook (bounded only by `maxTtlMs` above) and the server enforces no floor (`src/ephemeral.rs:7264` refuses only `ttl_ms == 0 || ttl_ms > max_ttl_ms`). Under the default rate budget (sustained 20 Hz), `ttlMs: 250` yields a 250ms interval equal to the TTL — the managed entry expires at every refresh boundary and flaps for all subscribers — and `ttlMs: 100` is guaranteed dead 150ms of every cycle; 250 < ttlMs < 500 leaves sub-RTT margins. No diagnostic refuses these configurations, so a guaranteed-flapping managed publisher is reachable from the public API. This is a defective committed decision (managed-publisher correctness), and fixing it changes committed text (the refusal condition), so it cannot be deferred to implementation.
*Bounded resolution:* extend the construction refusal (same or sibling code to `SNAPBACK_REACT_PRESENCE_HEARTBEAT_UNSUPPORTED`) to any configuration where the computed interval cannot sustain the TTL — e.g., require interval ≤ ttlMs/2, equivalently ttlMs ≥ 500ms — or state a clamping rule.

## DETAIL concerns

- **D1. `scopeEpoch: string`.** The wire/overlay epoch is a number bounded by `Number.MAX_SAFE_INTEGER` (LLP 0013 revision note; numeric comparisons at `index.mjs:8034-8041`), and LLP 0102's superseded presence shape said `number`. Either declare the stringification deliberately or fix the type.
- **D2. Client-side result-contract validation source unnamed.** "effective result-contract failure refuses before network work" implies validating updater output client-side; LLP 0101's validator is Rust-owned. Name the drift-checked generated operation result schema as the source so implementation doesn't hand-roll a second validator semantics. Likewise, the heartbeat rate check needs `publishRate`, which is in the generated schema manifest/introspection but not on the reference — name the artifact the check reads.
- **D3. Expiry scheduling unenumerated.** The store-owned resource list (overlay, listener, heartbeat timer, refcount) and cleanup enumeration omit the client-local expiry wakeup required to honor "removed no later than its server-stamped expiry" — the shipped overlay prunes only on read (`currentEntries`, `index.mjs:8130`) and publishes nothing at expiry, so a React snapshot cannot drop an expired entry without store-owned scheduling. Add it to the resource/inspection lists.
- **D4. Conflict rule and admission unit wording.** Byte-identity covers values only — two managed publishers with identical values but different `ttlMs` are unhandled (which TTL does the shared heartbeat publish?). And "a group of concurrent mounts" is undefined for presence (there are no presence groups); name the atomic admission unit.
- **D5. No `skip` form for the presence subscription.** `scope` has no skip analogue, unlike 0102's `args | typeof skip`, so conditional presence (the bakeoff's "no incident yet" boot state) forces component splits. Feasible via child components, so not gate-blocking, but the asymmetry deserves a stated decision.
- **D6. Diagnostic renames.** 0102 marked `SNAPBACK_REACT_PRESENCE_SELF_CONFLICT`/`_HEARTBEAT_INVALID`/`_OPTIMISTIC_TARGET_INVALID`/`_REDUCER_FAILED` as deferred; 0106 introduces differently named codes for the same concepts. Fine to supersede — say so explicitly so the deferred list doesn't resurrect duplicates.
- **D7. Optimistic wording.** "committed and current under the same provider, authority, query reference, and args" — 0102 round-2 removed the authority component from store identity (custody blanks in place); reword to the actual key plus a not-blanked condition. Also state that the user `isAuthoritative` is consulted only for confirmed attempts: the shipped layer calls matchers on pre-confirmation deliveries with `result === undefined` (`external-store.mjs:144-148`), while 0106 types `result` as always present.

## Verdict rationale

The architecture is right and verifiably implementable over the shipped owners, and the evidence plan is finite and grounded. But five committed decisions are missing or defective — key-mode totality (M1), a cap bound resting on a nonexistent server limit (M2), an incoherent public publish surface (M3), a dangling normative dependency in the v1 trigger list and hosted gate (M4), and a heartbeat refusal that doesn't cover reachable TTL configurations (M5). Each has a small, bounded fix, but each requires changing or adding committed text, so they cannot be settled during implementation.

VERDICT: NOT READY

## Round 2 — 2026-07-27

**Reviewer family:** Claude Fable  
**Provider / runtime:** Anthropic Claude Code 2.1.220,
`claude-fable-5` on the approved M4 Mac mini fleet lane  
**Effort:** max  
**Date:** 2026-07-27  
**Redacted:** no  
**Method:** fresh remote CLI runner, read-only tools, mutually blind
structurally isolated capsule  
**Target SHA-256:** `443f38de7a59a9eea3b6c450c74bc6112837878a798f547948a54b2d5bfe7f05`  
**Capsule SHA-256:** `0844ccc5b58af48decb1830e70843a9b36693b0237d575c647eb6faf7bb01a2f`  
**Instruction SHA-256:** `f3cd50fa999bd83c2d3eacc0671d05d5a9a85a82ee7a726f353a5359de3bec1f`  
**Status:** completed  
**Session:** `8326f3b5-e016-4c77-bbf2-00b22ce52a52`  
**Duration:** 876870 ms  
**Cost:** $19.84081875

All four exploration agents have reported. I now have verified evidence across the spec, its governing LLPs (0013, 0101, 0102, 0105, plus extracts of 0043/0059/0064/0094/0095), the headless client, the React package, codegen, the Rust server, and the demo/gate tooling. Here is the review.

---

# Blind delta review — LLP 0106, round 2

## Scope and method

I read `llp/0106-react-presence-and-optimistic-lifecycle.spec.md` in full against LLP 0013 (Accepted), 0101, 0102, 0105 (full reads), and targeted extractions of 0012/0034/0043/0053/0059/0064/0094/0095, then verified the projection claims against the code: `packages/snapback-client` (overlay, grants, external store, react binding, canonical values), `packages/snapback-react`, `packages/snapback-codegen`, `src/ephemeral.rs`, `src/local.rs`, `demos/backend-bakeoff`, `packages/snapback-cli/comparator-profile.mjs`, and the gate scripts. No repository modifications were made; no reviews/journal/orchestrator material was consulted (those paths are absent).

## Central question: strict projection over the four sanctioned surfaces

**The claim holds.** Every mechanism the spec depends on either exists today or is a bounded extension of an already-owned seam, and none of the forbidden additions (transport, room authority, query cache, credential owner, durable store, second optimistic ledger) is needed:

- **Room semantics** — `EphemeralOverlay` with subscribe-before-snapshot buffering, level-triggered `needs_resync` replay on late listener attach, `(scopeEpoch, entryVersion)` fencing, bounded tombstones, and `grantedConnectionId` bound through grant refresh all exist (`packages/snapback-client/index.mjs:4454-4500, 7961-8315`). The spec's `Entry` type is field-for-field the shipped `EphemeralEntry` (`index.d.mts:172-179`), backed by real wire members (`src/ephemeral.rs:1001-1009`).
- **The room handle** — `EphemeralRoomHandleV1` is net-new client work, but exactly the extension pattern LLP 0102's final reconciliation already ratified for durable queries (`startLiveQuery` handle with `started/dispose/settled`, and `LiveStreamManager.settled()` exists at `index.mjs:7186`). The Contract adapter's `buildEphemeralWiring` (`packages/snapback-contract/index.mjs:3148-3700`) is a fully worked reference for the whole store/handle lifecycle. Nothing in the handle requires new authority.
- **Expiry/rate math** — the refresh formula `max(250ms, min(ttlMs/2, 10_000ms))` satisfies interval ≤ TTL/2 for every TTL ≥ the 500 ms floor, with the 250 ms clamp binding exactly at the floor; all three admission constraints are synchronously computable. The aggregation rule ("all provider rooms in the same collection … per-connection sustained/burst budget") matches server enforcement **exactly**: the token bucket is keyed `rate_buckets[connection_id][collection]`, aggregated across rooms (`src/ephemeral.rs:7321-7353, 1885-1893`). The burst clause forces worst-case-alignment accounting for simultaneous heartbeats, which the "must fit … sustained/burst" wording covers. The 500 ms floor has no server counterpart (`validate_ttl` admits 1..=maxTtlMs, `src/ephemeral.rs:7259-7275`) — consistent, since the spec scopes it to *managed* publishers.
- **The 64-room React-local cap is genuinely independent of the durable budget** — confirmed: `MAX_LIVE_SUBSCRIPTIONS_PER_CONNECTION = 64` applies to durable live queries only (`src/local.rs:92-93`); the ephemeral store caps rooms/entries/subscribers per store and per room (4096/1024/1024, `src/ephemeral.rs:3176-3196`) with no per-connection room count. The round-1 revision is correct.
- **Authority fencing** — the provider's LLP 0059 barrier participant already exists in code (`packages/snapback-react/index.mjs:392-418` registering quiesce/blank/clearMemory/resume via `client.registerAuthBarrierParticipant`), and the server room-authority barrier for revocation is implemented with tests (`begin_protected_act`/`begin_final_send`, denied-subscriber entry removal under `RemoveReason::AuthRevoked`, `src/ephemeral.rs:3416-3591, 4847-4910`; `src/local/auth_room_kick_acceptance.rs`). The spec's revocation behavior (no denied-room entries, removal through the server barrier, trusted diagnostic) is backed.
- **The optimistic ledger** — exists with precisely the semantics the spec commits: attempt-ordered layer fold, splice-on-rejection with recompute from latest authoritative rows, `isAuthoritative` matcher, and a `confirmedAtRevision` conservative fallback that is exactly the spec's "remembered live evidence" settling both HTTP/live orderings (`packages/snapback-client/external-store.mjs:116-160, 333-396`).
- **Total state/lifecycle** — the six-status presence union with the separate three-status publisher axis is closed and total; impossible combinations are unrepresentable; the ten round-1 revision decisions are all present in the revised text; the "supersedes LLP 0102's deferred placeholder diagnostics" framing is accurate per 0102:1104-1106.
- **Evidence** — finite and nonvacuous. The ten check ids are enumerated, each maps to a falsifiable behavior with implemented server-side backing (TTL sweep, index-ordered disconnect cleanup, durable-version separation, revocation barrier), the receipt schema/path/commands are named, zero skips and independent connection identities with polling disabled make the two-client rows real, and the five comparator properties the spec names map one-to-one onto the existing `COMPARATOR_CHECKS` ids in `packages/snapback-cli/comparator-profile.mjs:36-56` (`presence-cleanup`, `ephemeral-durable-separation`, `rejected-mutation-rollback`, `native-live-delivery`, cleanup) — layered with, not duplicating, the new receipt.

## Findings

**No MATERIAL concerns.** Every defect I could substantiate is settleable without changing a committed decision. The closest candidates and why they stay DETAIL:

**D1. DETAIL, IN-DELTA — the "existing `runMutation` layer" is not reachable from the provider's registry today.** The ledger lives in `external-store.mjs`, which the shipped provider never imports; the provider hand-rolls its own store map over `startLiveQuery` (`packages/snapback-react/index.mjs:139-467`), and `createExternalQueryStoreRegistry` is not even on the client main entry. The committed decision (delegate, add no ledger) is sound and the target module implements the committed semantics verbatim, so this is consolidation wiring, not a missing decision — but implemented carelessly (porting layer code into the hand-rolled store) it would create the second ledger implementation the spec forbids. **Resolution:** one sentence stating the provider's canonical stores adopt the external-store ledger rather than reimplementing it; acceptance evidence shows one layer implementation post-landing.

**D2. DETAIL, IN-DELTA — `publishRate` is not on the generated reference.** The spec asserts "The complete generated reference carries `publishRate`"; the emitters omit it (`packages/snapback-codegen/index.mjs:5492-5508, 5564-5579`) — budgets today live only in `schema.manifest.json`, the contract manifest, and provider introspection. The decision (admission computes from the reference) is present; the sentence describes an end state requiring a same-landing codegen addition. **Resolution:** mark it as added in this landing; add the field plus type/schema rows.

**D3. DETAIL, IN-DELTA — prepared-binding admission of ephemeral references is new.** `react-binding.mjs:117-220` admits only function references, and `SnapbackEphemeralReference` (`client/index.d.mts:43-52`) carries no `keyMode`, so compile-time `Connection` narrowing needs the generated `api.d.ts` type (whose `keyMode` is currently the four-way union, not a per-collection literal). The spec's hedge ("where TypeScript can do so … runtime admission refuses") already covers this. **Resolution:** extend binding admission; optionally emit literal `keyMode` per collection to make the static narrowing real.

**D4. DETAIL, IN-DELTA — ambiguous vs rejected disposition is implicit.** On a receipt-less transport failure the delegated ledger splices the layer and the promise rejects with the transport diagnostic; the spec's prose calls all layer removal "rejection." LLP 0102:464-469 and LLP 0043:189-206 keep proven-rejection distinct from ambiguity, though 0102's *final* v1 deliberately dropped the settlement vocabulary from the hook, so no committed decision is contradicted; removal-on-ambiguity is the conservative display and authoritative deliveries reconcile it. **Resolution:** one sentence: a receipt-less failure removes the layer and rejects with the transport diagnostic without representing a proven server rejection, and is never auto-retried.

**D5. DETAIL, IN-DELTA — `ephemeral_authority_changed` is misattributed to LLP 0105.** 0105 defines the authority-instance digest, negotiation, and `SNAPBACK_EPHEMERAL_AUTHORITY_UNSUPPORTED` — never that reason token; the server `ResyncReason` enum has five variants without it (`src/ephemeral.rs:1036-1043`), and the shipped overlay discards `ResyncRequired.reason` entirely (`client/index.mjs:8288-8295`). LLP 0095 §4.2 explicitly makes resync reason strings client-synthesized, so the handle may own this vocabulary. **Resolution:** reword to "the authority-instance change of LLP 0105 surfaces as handle reason `ephemeral_authority_changed`," and note reason threading is new handle work.

**D6. DETAIL, IN-DELTA — LLP 0059 alignment is terse.** "Every terminal await rechecks LLP 0059 authority before publication" understates 0059:1679-1685/2465-2474 (the gate is also required before dispatch and before optimistic publication, and `isCurrent` is a hint, not authorization), and "blanks and disposes every store … before successor subscribe" compresses 0059's synchronous `blank`/`clearMemory` and its async quiesce-phase teardown into one verb. The existing participant already implements the phase split, and the store-missing/authority-blanked refusal supplies the pre-dispatch gate, so this is wording alignment, not a missing decision. **Resolution:** cite the pre-publication/pre-dispatch gates and the phase ordering explicitly.

**D7. DETAIL, IN-DELTA — small state-machine gaps, each independently settleable:** imperative `publish()` semantics on a hook that also declares `options.value`; layer disposition when a *rebase-time* reducer throw occurs after network work started (the "leaves no state or network work" clause can only govern installation); no successor diagnostic named for reducer/result-shape refusal after superseding `OPTIMISTIC_REDUCER_FAILED`; room subscribe retry/backoff bounds unstated (fencing is committed; policy is free).

**D8. DETAIL, IN-DELTA — gate plumbing the landing must reshape, consistent with but understated by the spec:** the demo has neither `test` nor `test:react` (`demos/backend-bakeoff/package.json:5-18`) though 0102:1223 requires both; `packed-fixtures.test.mjs` requires editing the inventory gate (`scripts/check-package-test-inventory.mjs:71-77`); the demo's surface manifest doesn't fit the required-surface vocabulary (`requirement:"required"` with no `buildTargets` is a hard throw in `scripts/check-required-surface-builds.mjs:70-76`, and its `buildTargets` are command strings, not `["web"]`/`[]`); `tests/demo_setup_v0.mjs:10-21` asserts ten demo ids against eleven manifests on disk. The spec's "adds `backend-bakeoff` with its exact build targets in the same landing" covers intent; the buildTargets shape needs one explicit decision.

**D9. DETAIL, PRE-EXISTING — clock domain of `expiresAtMs`/`receivedAtMs`.** They are real server wall-clock wire members, but LLP 0013:200-206 requires pruning on a client-local monotonic timer independent of clock sync, and the shipped overlay compares server ms to client now (`client/index.mjs:8301`). 0106 adds the monotonic wakeup without stating the server-ms→monotonic rebase; the skew hazard predates this spec.

**D10. DETAIL, PRE-EXISTING — repo state the evidence gate will trip on:** `packages/snapback-react/package.test.mjs`, the type fixture, and README still target the pre-0102 API and fail against current `index.mjs`; inspection counters `reservations`/`timers` are hard-coded `0` (`index.mjs:438-453`) while `zero-resources` needs real counters; stale doc comments claiming `ResyncReason::AuthChanged`/`RemoveReason::AuthRevoked` were removed (`src/ephemeral.rs:1011-1035`) are live code and exported into five committed schemas — contradictory-looking evidence right next to the revocation checks; `demo.snapback.json:25` names a nonexistent `snapback/handlers.mjs`.

**D11. DETAIL, PRE-EXISTING — sequencing dependency:** client-side reducer-output validation against "the drift-checked generated result schema" presumes LLP 0101's schema emission (Review; `issues/20260727-sound-handler-result-contracts.md` open) — the same ordering constraint LLP 0102 already declares.

## Verdict rationale

The round-1 revisions did their job: key-mode admission, the correlated `Q` typing (standard and sound with the `= never` default), the total discriminated state union, the client-owned handle with bounded settlement, explicit and server-verified expiry/rate math, per-committed-hook admission with a genuinely independent 64-room bound, transactional optimistic installation with both orderings and pinning/caps/fences, the custody-vs-subtree distinction, and a finite ten-check retained receipt are all present and mutually coherent, and each consumed seam is real or a precedented owned extension. What remains is presentation accuracy about current-versus-landed state and a set of bounded wording/plumbing items — none identifies a missing or defective decision necessary for correctness, coherence, feasibility, safety, or the acceptance gate.

VERDICT: READY

## Round 3 — 2026-07-27

**Reviewer family:** Claude Fable  
**Provider / runtime:** Anthropic Claude Code 2.1.220,
`claude-fable-5` on the approved M4 Mac mini fleet lane  
**Effort:** max  
**Date:** 2026-07-27  
**Redacted:** no  
**Method:** fresh remote CLI runner, read-only tools, mutually blind
structurally isolated capsule; declared implementer lens  
**Target SHA-256:** `99f34faa1ca1d1ef8655f221e3b26373320fd46a44bbcf7f51a682902d5f91ba`  
**Capsule SHA-256:** `d6613c1187fac0ed34380b596826f5ab086f9c29f5b10383de28450268bc3e9a`  
**Instruction SHA-256:** `157079b096962389b0e7b5ae6042293a87fc915ffe7d6a071ddedb1add88737f`  
**Status:** completed  
**Session:** `cab84e94-196e-437a-a789-7596f95d3b2d`  
**Duration:** 1104467 ms  
**Cost:** $21.00911825

# Blind implementer-delta review — LLP 0106, round 3

**Method.** I read LLP 0106 and its parent LLP 0102 in full (plus LLP 0064), and verified the spec's named artifacts against the public repository and the cited governing LLPs (0013, 0031, 0034, 0043, 0059, 0094, 0095, 0101, 0105) via three independent repository sweeps. I did not consult `llp/reviews`, any journal, or the other reviewer, and made no repository changes.

**Implementer-derivation result.** From the document alone I could derive the two public hook signatures and the closed `PresenceState`/`PublisherState`/`Entry` algebra; the resource-owner graph (provider registry → one `PresenceRoomStoreV1` per `(providerInstanceId, complete reference, normalized scope)`, 1:1 with a client-owned `EphemeralRoomHandleV1` owning subscribe/grant/manager-demand/overlay/unsubscribe/late work); the four transition machines (room status, publisher token tuple, handle lifecycle, optimistic layer with pins and exact terminal releases); the heartbeat admission arithmetic; and the ten-check receipt with operational semantics for every check id. Repository verification confirms the consumed facts are real: `createExternalQueryStoreRegistry` and the layered `runMutation` ledger exist in `@snapback/client` (`packages/snapback-client/external-store.mjs:427, :333`); `RemoveReason::Disconnected` is on the wire and broadcast to peers (`src/ephemeral.rs:1017-1023, :5944-5960`), so `forced-disconnect-delete` is nonvacuous; the admission formula `sum(ceil(1000/I)) <= sustained`, `2·activePublishers <= burst` is dimensionally exact against the real per-connection×collection token bucket (`RateBucket`, `src/ephemeral.rs:1876-1904`, fields `sustainedHz`/`burst`); the 64-room cap is genuinely independent of the durable 64-subscription budget (the only hard per-connection 64 is the Cloudflare durable cap on an arm that serves no ephemeral; local rooms are a separate subsystem); grants with one-shot refresh exist (LLP 0031, `#withGrant`); LLP 0013 supplies `scopeEpoch`/`entryVersion`/resync/queue-overflow exactly as consumed, and 0013:200-203 sanctions the remaining-TTL carrier; the receipt/zero-skip harness and provider/manager/server inspection surfaces exist (`demos/_kit/harness.mjs`, `provider.inspection()`, `client.inspect().ephemeral`); and "local-only" is real guide vocabulary (`guide/conventions.md:43`). **Seven of the nine round-2 revised decisions are sound and implementable as committed.** Two carry material residue.

## MATERIAL findings (both IN-DELTA)

**M1 — Optimistic install-time result-schema validation has no derivable carrier.** The spec commits: "Installation … validates the generated result schema before visibility or dispatch." But generated function references carry only hashes (`implementationHash/argsContractHash/resultContractHash`, `packages/snapback-codegen/index.mjs:5531-5540`); LLP 0101's validation is server-side pre-commit (0101:400-403); the client never revalidates (`client.mutate` returns the raw envelope, React returns `output.result`). No runtime result contract reaches the browser, and the spec's own generated-surface enumeration (`publishRate`, `defaultTtlMs`, `maxTtlMs`) doesn't add one. Three materially different implementations remain plausible: ship the contract in the generated api module; admit a deployed/contract-manifest descriptor through `prepareReactBinding` (the Contract adapter's `deriveOptimisticReducer` ecosystem shows such descriptors exist); or degrade to a hash-presence check with no structural validation. Failure scenario: two conforming implementations disagree on whether malformed reducer output is caught before visibility/dispatch. **Bounded resolution:** one replacement sentence naming the carrier and the refusal for result-contract-less queries (or explicitly scoping validation to contract presence), extending the "this landing adds" list if generated surface grows.

**M2 — The `ephemeral_remaining_ttl_v1` offer's negotiation locus is unpinned.** `serverObservedAtMs` and the offer token appear nowhere outside 0106. LLP 0094's mechanisms are the connection-open `wireVersion` token (§0B.3), the socket-offer equality rule (§0B.4), and the §0E refusal registry; LLP 0105's `ephemeralAuthorityProtocol: "ephemeral-authority.v1"` is the per-feature offer/echo precedent. 0106's token matches neither naming convention, is not registered, and the document never says where the offer is offered/echoed or when "absence refuses the React capability" is learned. Three implementations remain plausible — connection-open body field, subscribe-time offer/echo, or a capability-manifest fact with no wire negotiation — with different user-visible refusal timing. The carrier itself is sanctioned (0013:200-203 requires exactly this metadata; the `EphemeralMessage` family is open for additive members per 0094 §0C.2:711), so this is one missing commitment, not a design flaw. **Bounded resolution:** one sentence pinning the negotiation locus and its 0094 §0E registration (aligning token naming), or an implementation test asserting the offer/echo location and refusal timing.

## DETAIL findings

- **D1 (IN-DELTA).** "This landing adds `publishRate`, `defaultTtlMs`, and `maxTtlMs` to the generated reference" overstates the delta: the latter two already exist on generated ephemeral references (`codegen index.mjs:5541-5556`); only `publishRate` (existing `sustainedHz`/`burst`) moves onto the reference. Fix: name only `publishRate` with its field shape.
- **D2 (IN-DELTA).** Two locally-refused paths lack named diagnostics after the placeholder supersession: install-time reducer/validation failure (`…REBASE_FAILED` is scoped to "later" failures) and a token-less user-driven emission. Fix: name one code each or widen the REBASE_FAILED scope.
- **D3 (IN-DELTA).** "Never-resolving subscribe/unsubscribe settles through the existing bounded manager deadline" — no existing deadline covers the HTTP `/ephemeral/subscribe` leg (no client AbortSignal/timeout anywhere; only socket `request()` carries 2 s; `manager.settled()` resolves only at close). Fix: name the deadline owner/value or drop "existing".
- **D4 (IN-DELTA).** "`isCurrent` alone never authorizes" is stricter than LLP 0059, which permits expose via `isCurrent` and reserves `compareAndCommit` for durable commits (0059:1679-1682, 1877-1878). Fix: scope the sentence to durable/terminal publication with the section cite.
- **D5 (IN-DELTA).** Four React caps (128 stores / 64 room subscriptions / 256 consumers / 64 publishers) map onto three refusal codes. Fix: one mapping clause.
- **D6 (IN-DELTA).** The superseded LLP 0102 codes are quoted without their `SNAPBACK_REACT_` prefix; 0102 spells them fully. Fix: exact spellings.
- **D7 (PRE-EXISTING).** The named acceptance plumbing is currently red for `backend-bakeoff`: `tests/demo_setup_v0.mjs`'s inventory omits it (reproduced failure), `snapbackNativeAcceptance` lacks `buildTargets` (the collector throws), and two `buildTargets` vocabularies conflict (`["web"]`/`[]` vs shell strings); `packed-fixtures.test.mjs` also requires a `scripts/check-package-test-inventory.mjs` edit. Landing mechanics, not blocking.
- **D8 (PRE-EXISTING).** "The bakeoff removes local presence/rollback glue" — presence glue exists (`demos/backend-bakeoff/src/backends/snapback.ts:82-123`); no rollback glue exists to remove.
- **D9 (IN-DELTA, low).** LLP 0105 names `@snapback/react` as a mandatory `registerEphemeralRepublisher` arm for hosted qualification; 0106's pointer doesn't say whether the managed room store satisfies that arm. Hosted is a stated non-goal, so this is a deferred-boundary note only.

## Verdict rationale

The revision closes the round-2 decisions cleanly in seven of nine areas, and the state machines, ownership, and receipt are derivable as committed. But both MATERIAL items sit inside round-2 revised decisions, each leaves a server/codegen patch that cannot be written deterministically from the document, and each admits three plausible, observably different implementations. Both close with a single replacement sentence or implementation test — no explanatory expansion needed.

VERDICT: NOT READY
