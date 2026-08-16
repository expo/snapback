# LLP 0257 reviews — grok family

## Round 1 — 2026-08-15

- Reviewer: grok-4.6 (served as grok-4.6-build), reasoning effort xhigh,
  `grok` CLI headless, `--disable-web-search`, plain output, max-turns 200.
- Revision under review: r1, sha256
  `dae1aaa61141fb485d3d33fdaa9435c4a66a4665a13eaa76b6c54a941a8c32cd`.
- Capsule: archive of main `272bea745` + target overlay; instructions
  sha256 `c6632d0415805fe7262faaf977de0a5e28f1730e7b1b054d0c7d2ff980360bb0`;
  per-reviewer APFS clone; structurally blind (no 0257 review artifacts in
  capsule).
- Verdict: **NOT READY** (3 MATERIAL, 4 detail).

### Verbatim review

I'll read the RFC and the contracts it must compose over so the review is grounded in the shipped surface, not the draft's claims.Next I’ll verify the RFC against the shipped hook, guide pages, and the messaging demo’s typing composition.I’ll read the shipped hook types, implementation, and React guide so I can check the RFC’s claims against real contracts.`implementation.mjs` is treated as binary, so I’ll extract the presence hook from it another way.The RFC’s direction is right — a client-only activity wrapper over the shipped React presence hook — but revision r1 is not implementable as specified. It tells the helper to own a TTL refresh loop that `useSnapbackPresence` already owns after the first managed publish, it does not pin what “withdraw on scope change” means against the two legal compositions (always-`skip` + imperative `publish`/`delete` vs declarative value/`skip` toggle), and it leaves a base-hook option bundle open even though deliverable 1 already names a separate hook and the sketched `activity: { idleMs }` shape has no activity signal. Those are defects against LLP 0107 and the shipped provider, not implementation-phase nits.

1. **MATERIAL — Refresh model contradicts provider-owned heartbeat and would leak or storm.**  
   The design sketch (`llp/0257-activity-scoped-presence-convenience.rfc.md`, Semantics) says `touch()` “republish[es] only as needed to keep the entry inside its TTL (piggybacking on the provider heartbeat where possible)”, that “`idleMs` must be comfortably below the collection’s `maxTtlMs`”, and that “the helper derives its republish cadence from the ref so a schema TTL change cannot silently break the refresh loop.”  
   That is not how the shipped hook works. LLP 0107 §Presence ownership (and `packages/snapback-react/implementation.mjs` `setTokenIntent` / `enqueueRoomPublish` / `scheduleRoomHeartbeat`) admits **managed intent on both a non-`skip` value and an observer `publish()`**. After the first successful publish the provider refreshes at `max(250ms, min(ttlMs / 2, 10_000ms))` until `delete()`, a published→`skip` edge, or last-publisher release. A later `publish()` of the same canonical value and TTL is a no-op (`unchanged && !room.suspended`). Guide `guide/clients/react.md` Anti-patterns: “Do not create presence heartbeat intervals in application code.”  
   Consequences a reasonable implementer cannot resolve from the RFC plus 0107:
   - If they add the promised cadence, they duplicate the provider scheduler, consume rate-limit tokens, and — if the value thunk is not referentially stable (e.g. `updatedAt: Date.now()`) — republish on every tick (`SNAPBACK_REACT_PRESENCE_PUBLISH_CHURN` / rate limit).
   - If they treat “stop republishing” as withdraw and omit `delete()`, **heartbeat keeps the entry alive until unmount**, not until TTL. That is a leak, not LLP 0013’s lossy backstop. The demo already shows the correct split: `demos/messaging-snapback/src/lib/useTyping.ts` publishes once (subsequent identical publishes no-op) and `demos/messaging-snapback/src/app/conversation/[id].tsx` withdraws with a 3s timer via `delete()`.
   - `idleMs < maxTtlMs` is the invariant for “TTL *is* the idle withdraw.” It is false once heartbeat is admitted, and it forbids a long idle (viewing session) that heartbeat could legally keep. The helper should admit a normal `ttlMs` in `[500, maxTtlMs]`, call `publish` only on first tick or when the evaluated value/TTL pair changes, reset an idle timer on `touch()`, and `delete()` / published→`skip` on idle, `withdraw()`, unmount, and scope change. It must not own a refresh cadence.

2. **MATERIAL — Scope-change / activity state machine is underdetermined and conflicts with “same cleanup as LLP 0107.”**  
   The RFC says unmount, scope change, and provider disposal “all withdraw — same cleanup ownership rules as LLP 0107.” Those are not the same rule.  
   Room identity is `(providerInstanceId, reference, normalized scope)` (`implementation.mjs` `presenceDescriptor`). On scope change the provider `releasePresenceToken`s the old room (best-effort fenced withdraw if this was the last publisher — LLP 0247 D3 / `withdrawAcknowledgedPair`) and attaches to the new room with **the current descriptor intent**.  
   - Always `value: skip` + observer `publish()`: token `desired` is cleared on release; the new room stays observer until the next `touch()`. Matches “scope change withdraws.”  
   - Declarative `value: active ? payload : skip` (the composition already used in `demos/tandem-expo-bakeoff/snapback/src/backend.tsx`, `demos/relay-room-bakeoff/snapback-expo/src/screens/chat-screen.tsx`, and `guide/realtime/ephemeral-state.md`’s published→`skip` contract): if local `active` is still true, 0107 **immediately publishes into the new scope**. A composer who navigates conversation A→B mid-burst appears typing in B with no new tick.  
   The RFC never names which composition the helper is, whether `active` is local desired-intent or `publisher.status === 'published'`, or whether a scope-identity change resets to inactive. That is core lifecycle, not a naming detail. Pin: new scope starts withdrawn; do not carry desired intent across room identity; `touch()` is required again. Cite LLP 0247 D3 (fenced `(scopeEpoch, entryVersion)` withdraw, `superseded` must not delete a successor) in Related — idle `delete()` racing a new `touch()` is exactly that vector.

3. **MATERIAL — Separate hook vs option bundle is left open, but one sketched answer is not a valid 0107 mode.**  
   Deliverable 1 already specifies “the hook in the React binding … a thin composition over `useSnapbackPresence`.” Open question 1 reopens that as `activity: { idleMs }` on the base hook.  
   `useSnapbackPresence`’s typed surface (`packages/snapback-react/index.d.mts`, LLP 0107 §Public API) is `value: EphemeralValue<Ref> | typeof skip` plus optional `ttlMs`. A non-`skip` value is declarative managed intent and publishes after the authoritative snapshot; imperative `publish`/`delete` then refuse `SNAPBACK_REACT_PRESENCE_ACTION_CONFLICT`. The sketched bundle `{ idleMs }` has **no `touch()`** and therefore can only mean “withdraw N ms after mount” or “treat value-identity changes as activity” — the first is not the stated product, the second fights content-keyed scope/value (`guide/clients/react.md` §Use inline hook inputs) and makes a stable typing payload (`{ userHandle, name }`) never tick.  
   A non-breaking option bundle is theoretically possible only as a **new mode** that does not publish non-`skip` value on mount and that adds `touch`/`withdraw` to the closed `PresenceState` union. That is not what OQ1 writes down, and it is worse DX than the separate hook deliverable 1 already chose. Close OQ1: ship `useSnapbackActivityPresence` (name bikesheddable) in `@expo/snapback-react`; Expo inherits via `packages/snapback-expo/index.mjs` `export * from '@expo/snapback-react'`. Do not add `activity` to the base hook in this RFC.

4. **detail — `useTyping` claims are slightly off; idle and per-keystroke republish are not where the RFC puts them.**  
   Motivation says the demo picks `ref.maxTtlMs`, republishes on each keystroke, and remembers `delete()` on send/blur/clear. `useTyping` does publish with `maxTtlMs` and swallows errors, but the 3s idle timer and send/clear live in `conversation/[id].tsx`, and after the first admit identical `publish({ userHandle, name })` calls are no-ops in the provider. Migration deliverable 3 should collapse hook + screen timer, not only `useTyping.ts`.

5. **detail — Return sketch drops closed presence state.**  
   `{ active, touch, withdraw, peers }` hides `pending | resyncing | ready | stale | error | unsupported`, `connection`, and `publisher` (LLP 0107 §Closed presence state). Hosted presence is `unsupported` and starts no room (`presence.test.mjs`). `peers: []` is indistinguishable from an empty room. Pass through enough state (or `onError` plus `status`) that a hosted/error binding is not silent. Define `active` as local desired-intent (idle timer armed), not overlay acknowledgement.

6. **detail — Open question 2 (value override) has a default already implied by the base hook.**  
   Evaluate the thunk on each `touch()` / helper-initiated publish; `setTokenIntent` already no-ops an unchanged canonical pair and republishes once when the pair changes. Heartbeat must **not** re-evaluate the thunk (it republishes admitted `desired.value`). A `touch(value?)` override can wait. Warn that volatile fields in the thunk turn every tick into a real publish.

7. **detail — Inherited contracts the RFC should state, not rediscover.**  
   Connection-keyed refs only (`ConnectionEphemeralCollectionReference`; other key modes refuse `SNAPBACK_REACT_PRESENCE_KEY_MODE_UNSUPPORTED`). Same-room managed values/TTLs must match (`SNAPBACK_REACT_PRESENCE_VALUE_CONFLICT`); two activity helpers on one room are one logical publisher. `excludeSelf` can only drop `selfKey`; the demo’s extra `userHandle` filter is app identity, not generic. Presence is Online and never a queued mutation (LLP 0107 Non-goals / “never … treated as a durable mutation input”); swallowed publish failures while offline match LLP 0013 lossy posture — the next `touch()` retries because a suspended identical admit is not a no-op. Live-viewer chips are mount-scoped; they belong on declarative `useSnapbackPresence`, not this tick+idle helper. Headless `ActivityPublication` can stay OQ3; if the React hook lands, the existing `observeSnapbackPresence` twin is the acceptance seam to mirror (implementation-phase).

**Direction.** Building a small client-only activity convenience on `useSnapbackPresence`, with no wire/server/collection changes, is sound. The paved composition is: subscribe as today, admit managed intent on first `touch()`, let the provider heartbeat keep the lease, withdraw with the 0107/0247 fenced `delete` / published→`skip` path on idle, explicit `withdraw()`, unmount, and scope-identity change. That is exactly the choreography every messaging demo currently copies by hand.

VERDICT: NOT READY

## Round 2 (delta round) — 2026-08-15

- Reviewer: grok-4.6 (grok-4.6-build), reasoning effort xhigh, `grok` CLI
  headless, fresh lane, structurally blind.
- Revision under review: r2, sha256
  `b1da1711f822e98e4ea8e1e494cb8b59025d838e29d131da9bdd75372734a0d1`.
- Capsule: pristine clone of the round-1 capsule with target swapped to r2;
  instructions `INSTRUCTIONS-r2.md` sha256
  `ac1fd9cb489e203db431bba98c20141ae0b31eb7191c435935e2523382a4de0e`.
- Verdict: **READY** (0 MATERIAL; 3 detail, all IN-DELTA).

### Verbatim review

I'll start by reading the review instructions at the repository root and then follow them exactly.I'll read the target RFC and the governing LLPs and shipped surfaces the instructions name so I can check claims against the repo.Next I’ll load the cited LLPs, the React presence surface, the guide pages, and the messaging demo so I can check the RFC against shipped behavior.The RFC’s claims need to be checked against the presence implementation, Expo AppState behavior, and the guide pages.I need the pause/resume presence semantics and whether a hook can order itself with Expo’s AppState seam.The r2 rewrite correctly recasts the product as withdrawal choreography over the shipped provider-owned heartbeat, and the pinned semantics match `useSnapbackPresence` in observer mode, LLP 0107 / 0247 §D3, and the messaging demo. `touch()` as an absolute `now + idleMs` deadline plus generation fence, helper-owned idle/unmount/scope-change/Expo-background withdrawal with no helper republish cadence, touch-time thunk sampling, selfKey-only `peers`, pass-through `status`/`publisher`/`connection`/`diagnostic`, and in-memory-only offline intent are all implementable as a thin composition and are not underdetermined on the core path.

1. **detail / IN-DELTA** — TTL §: the demo does not have a 30 s ghost window. `demos/messaging-snapback/src/lib/useTyping.ts` publishes `typingRef.maxTtlMs`, but `demos/messaging-snapback/snapback/schema.mjs` sets `maxTtlMs: 15_000` and `ttlMs: 6_000`. The migration still tightens the window (15 s → collection default 6 s); 30 s is only the paved-path `maxTtlMs` default in `packages/snapback-codegen/define.mjs` when a collection omits it.

2. **detail / IN-DELTA** — Value semantics: volatile thunk fields do cause a real publish on every `touch()` (`setTokenIntent` no-ops only an unchanged canonical value/TTL while not suspended, in `packages/snapback-react/implementation.mjs`). They do **not** trip `SNAPBACK_REACT_PRESENCE_PUBLISH_CHURN`. That detector counts committed hook scope/value descriptor identity (`llp/0107`, `packages/snapback-react/dev-diagnostics.test.mjs`); this helper keeps `value: skip`. The guide warning should name rate/admission pressure, not that churn code.

3. **detail / IN-DELTA** — Expo §: “ordered with the binding’s existing AppState seam” names a seam that does not exist at hook granularity. `bindSnapbackAppLifecycle` only `pause()`/`resume()`s the provider; `guide/clients/react.md` says components never pause individual hooks; `packages/snapback-expo/index.mjs` re-exports `@expo/snapback-react` without forking. A second AppState listener that `withdraw()`s on `background` is still a valid thin composition: `pauseRoom` keeps `desired` and resume republishes it (`startRoom` / `presence.test.mjs` recovering case), so clearing helper intent is what prevents resurrection. The specified resume/render/room-ready backstop already covers the pause-first race; “ordered” is not required for correctness.

**Direction:** Implement as specified. Optionally correct the demo TTL figure and the churn-diagnostic wording before or with the landing; neither changes the design.

VERDICT: READY
