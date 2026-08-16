# LLP 0257 reviews — claude family

## Round 1 — 2026-08-15

- Reviewer: claude-fable-5, effort max, headless `claude -p` (v2.1.233),
  tools restricted to Read/Glob/Grep (capsule confinement); fresh lane —
  the orchestrator/reviser did not review.
- Revision under review: r1, sha256
  `dae1aaa61141fb485d3d33fdaa9435c4a66a4665a13eaa76b6c54a941a8c32cd`.
- Capsule: archive of main `272bea745` + target overlay; instructions
  sha256 `c6632d0415805fe7262faaf977de0a5e28f1730e7b1b054d0c7d2ff980360bb0`;
  per-reviewer APFS clone; structurally blind.
- Verdict: **NOT READY** (3 MATERIAL, 6 detail).

### Verbatim review

I've completed the grounding pass: the target RFC, LLP 0013, LLP 0107, the typed surface in `packages/snapback-react/index.d.mts`, the guide pages (`guide/realtime/ephemeral-state.md`, `guide/clients/react.md`, `guide/reference/expo-snapback-react.md`), the messaging demo (`useTyping.ts` plus its caller in `conversation/[id].tsx`), and LLP 0247 §D3 (fenced withdrawal). Here is the review.

---

## Overall assessment

The RFC identifies a real, well-evidenced ergonomic gap — the messaging demo does hand-roll exactly the publish-on-keystroke / app-owned `setTimeout(clearTyping, 3_000)` idle timer / clear-on-send choreography the RFC describes (`demos/messaging-snapback/src/app/conversation/[id].tsx:64-73`), and the convenience is genuinely buildable as a thin client-only composition over `useSnapbackPresence` with no wire or server changes. But the design sketch's central mechanism is written against the wrong model of the shipped surface: it assigns the helper TTL-refresh bookkeeping ("republish only as needed to keep the entry inside its TTL," "derives its republish cadence from the ref," "idleMs must be comfortably below `maxTtlMs`") that LLP 0107 places wholly and exclusively in the provider — every publish through the hook, including observer-mode imperative publish, installs *managed intent with a provider-owned heartbeat* that refreshes the entry indefinitely until deleted, suspended, or released. That premise error propagates into the motivation's stated failure mode, into the stated `idleMs`/TTL constraint, and into open question 2, and it leaves the two behaviors the helper actually does own — when the value thunk is sampled, and what happens to activity state across a scope change — underdetermined. The direction is right and the feasibility claim survives, but the lifecycle mechanics need to be rewritten against LLP 0107 before this can be accepted.

## Numbered concerns

**1. MATERIAL (correctness against shipped surface): the refresh/TTL mechanism contradicts the provider-owned heartbeat contract.**
Evidence: RFC §Design sketch ("`touch()` … republish only as needed to keep the entry inside its TTL (piggybacking on the provider heartbeat where possible…)"; "`idleMs` must be comfortably below the collection's `maxTtlMs`; the helper derives its republish cadence from the ref so a schema TTL change cannot silently break the refresh loop") versus LLP 0107 §Presence ownership: an observer `publish` "transactionally admits a managed intent," "No unmanaged publisher exists," and the admitted value "is refreshed at `max(250ms, min(ttlMs / 2, 10_000ms)) only while authoritative" by the provider, with admission arithmetic (`sum(ceil(1000/I)) <= sustained`, `2 * activePublishers <= burst`) refusing `SNAPBACK_REACT_PRESENCE_HEARTBEAT_UNSUPPORTED`. `guide/realtime/ephemeral-state.md` states "publish installs managed intent (including heartbeat)," and `guide/clients/react.md` (line 813) makes app-owned refresh an explicit anti-pattern: "Do not create presence heartbeat intervals in application code." Under the claimed substrate there is **no** helper republish cadence to derive, no "where possible" residue for the helper to cover, and no `idleMs`-below-`maxTtlMs` constraint at all — with the heartbeat active, the entry stays alive for any `idleMs` whatsoever until the helper deletes it. The RFC's own Summary concedes the provider owns the heartbeat, so this is also an internal contradiction. Consequences of leaving it: an implementer following the sketch literally builds a second refresh loop that either gets refused by admission or double-counts against the publish-rate budget; and the motivation's claim that a missed `delete()` "leaks a stale indicator until TTL expiry" is wrong in the central case — for a mounted, healthy component the heartbeat refreshes the entry *indefinitely*, which is a stronger motivation for the feature but a misstated baseline. The real TTL couplings the RFC should state instead: the published TTL bounds the ghost window after a lost/suspended withdrawal, and withdrawal visibility is bounded by `withdrawalVisibilityDeadlineMs` (at most TTL/2, LLP 0247 §D3).

**2. MATERIAL (coherence/underdetermined core semantics): when the `value` thunk is evaluated is unresolvable, and open question 2 is ill-posed.**
Evidence: RFC §Design sketch ("`value: () => (…)` — evaluated on (re)publish") and §Open questions 2 ("…or is re-evaluating the `value` thunk on republish sufficient?"). Under LLP 0107 the provider's heartbeat republishes the *retained admitted bytes* — it never calls back into application code (the separate `useEphemeralRepublisher` mechanism exists precisely because managed presence doesn't re-ask producers; `guide/clients/react.md` lines 624-630), and same-room consumers require byte-identical managed values. So during a continuous active burst there are no thunk-visible "(re)publish" events at all: the thunk runs only at first-touch-after-idle and post-suspension re-admissions, and a mid-burst value change (the exact case OQ2 raises) never propagates until an idle boundary. The alternative — evaluate the thunk on every `touch()` and publish on change — is a per-keystroke compare-and-maybe-publish, which the sketch's "not once per keystroke" language disclaims. A reasonable implementer cannot determine the sampling semantics from the document plus the cited contracts; this is the helper's core input contract.

**3. MATERIAL (coherence/underdetermined core semantics): scope-change behavior is only half specified.**
Evidence: RFC §Design sketch ("Unmount, scope change, and provider disposal all withdraw"). This pins the old room's withdrawal (which the base hook's room-identity change largely provides already) but says nothing about the new scope's initial state: does a live idle window carry over, republishing under the new scope, or does activity reset until the next `touch()`? The two readings differ visibly in the motivating application — carrying activity paints a typing indicator into conversation B because the user typed in conversation A moments ago, which is a wrong indicator; resetting shows nothing. Scope switching mid-activity is the common case for the demo this RFC promises to migrate (deliverable 3), and the instructions' underdetermined-core rule applies. The spec round should pin reset-on-scope-change (the safe reading) and say whether the thunk is re-evaluated when the first post-change `touch()` publishes.

**4. detail (implementation-phase): the TTL the helper publishes with is unstated.**
The base hook defaults to generated `defaultTtlMs` and accepts per-publish `ttlMs` (LLP 0107 §Public API; `index.d.mts:394-398`), so a thin composition resolves this — but the RFC's only TTL sentence is the erroneous constraint in concern 1, and the migration is a real behavior change: `useTyping` currently publishes with `ref.maxTtlMs` (30 s), so moving to the default tightens the lost-withdrawal ghost window from 30 s to the collection's `ttlMs`. State the choice (and whether `ttlMs` passes through) once concern 1 is rewritten.

**5. detail (implementation-phase): `excludeSelf` does not fully absorb the demo's self-filtering.**
`useTyping.ts:18-20` filters both `entry.key !== presence.selfKey` *and* `entry.value.userHandle !== selfHandle`, because connection-keyed rows from the same user's other devices are not `selfKey` (same-profile browser tabs share the leader connection, but separate profiles/devices do not — `guide/realtime/ephemeral-state.md` §Do not use two tabs…). `excludeSelf: true` as sketched drops only the granted-connection row, so the migrated demo either keeps a one-line value filter or the option needs a predicate form. The "few-line use of the convenience" guide deliverable survives, but the motivation's "filter self out of the entry list" bullet overstates what `excludeSelf` covers.

**6. detail (implementation-phase, leaning spec-round): the result surface hides capability and error states.**
The sketch returns `{ active, touch, withdraw, peers }` with no status/connection/publisher/diagnostic projection. The base `PresenceState` distinguishes `pending`/`resyncing`/`ready`/`stale`/`error`/`unsupported`, and `unsupported` is a terminal capability refusal (hosted targets refuse before work — LLP 0107; `guide/clients/react.md` lines 600-605). Through the convenience alone, "presence unavailable" is indistinguishable from "nobody active" (`peers: []`), which sits awkwardly with the LLP 0012/0013 "surface, don't silently fall back" posture the repo applies to capability gaps. `onError` as sketched observes only publish/withdraw failures. Exposing the base status (or documenting deliberate hiding), plus pinning the `peers` element shape (entries vs. values) and the exact conditions flipping `active`, belongs in the next revision.

**7. detail (safety, bounded by existing budgets): touch-during-suspension re-admission should be pinned.**
LLP 0107: rate/size/auth failure "suspends the desired value … and never retries until a new prop or action re-admits it." Every `touch()`-driven publish is such an action, so during an outage or rate-limiting a keystroke stream re-admits at keystroke rate — the republish-storm posture the base contract's suspension exists to prevent. Damage is bounded (admission refuses before wire work; server `publishRate` rejects; the demo behaves identically today), so this is not MATERIAL, but the RFC should state the helper's suspension behavior (e.g., admit at most once per idle window, or inherit and document the demo-equivalent bound), since idle/republish choreography is exactly what this helper claims to own.

**8. detail (implementation-phase): multi-instance composition in one room is undiscussed.**
Two convenience instances (or a convenience beside a declarative publisher) on the same collection/scope hit LLP 0107's byte-identical managed value/TTL rule (`SNAPBACK_REACT_PRESENCE_VALUE_CONFLICT`) and per-token delete/refcount semantics ("Last publisher release best-effort deletes…"). With per-instance thunks, byte-identical is fragile, and the sketch's swallow-errors default would silently break publishing while `peers` keeps working. Document the constraint or refuse loudly.

**9. detail (doc hygiene): missing grounding references.**
The Related line omits LLP 0247, whose §D3 fenced withdrawal (`superseded` settlement, "delayed/ambiguous retries … cannot delete its successor," `withdrawalVisibilityDeadlineMs`) is the contract that makes the helper's publish→withdraw→republish cycling race-safe and gives idle withdrawal its peer-visibility bound — the RFC should lean on it rather than silently inherit it. LLP 0114 (provider/binding surface) is arguably also Related. A one-sentence note that presence never queues offline (publish failures suspend; reconnect republishes only unsuspended active intent per LLP 0107 §Resync) would close the offline-interaction question the instructions raise.

## Direction

Sound. Client-side-only is the right altitude: LLP 0013 already gives the server TTL expiry and connection-scoped cleanup as the safety backstop, idle detection is inherently a UI-input concept, and every primitive the helper needs (observer mode, fenced imperative publish/delete, provider heartbeat, unmount cleanup, Strict Mode safety) is shipped and proven. The lean in open question 1 (separate hook, keeping the base hook's modes untouched) is reasonable, and deferring the headless twin until demand shows is defensible given `observeSnapbackPresence` already exists as the observer pattern to parallel. The RFC should be revised — chiefly by rewriting the design sketch so the helper owns only publish-on-first-touch, thunk sampling, idle/explicit withdrawal, and the provider owns refresh unconditionally — not redirected.

VERDICT: NOT READY

## Round 2 (delta round) — 2026-08-15

- Reviewer: claude-fable-5, effort max, headless `claude -p` (v2.1.233),
  Read/Glob/Grep only, fresh lane, structurally blind.
- Revision under review: r2, sha256
  `b1da1711f822e98e4ea8e1e494cb8b59025d838e29d131da9bdd75372734a0d1`.
- Capsule: pristine clone of the round-1 capsule with target swapped to r2;
  instructions `INSTRUCTIONS-r2.md` sha256
  `ac1fd9cb489e203db431bba98c20141ae0b31eb7191c435935e2523382a4de0e`.
- Verdict: **READY** (0 MATERIAL; 3 detail, all IN-DELTA).
- Pool rule: this is the Claude family's first READY — per the
  author-ordered rule recorded at loop start, Claude is dropped from
  subsequent rounds.

### Verbatim review

All verification is done. Here is the review.

---

## Overall assessment

Round 2 is a near-total rewrite that survives adversarial verification against the shipped surface remarkably well. The load-bearing reframing — the provider-owned heartbeat sustains a mounted, healthy entry indefinitely, so withdrawal choreography (not keep-alive) is the product — is correct against the shipped registry (`packages/snapback-react/implementation.mjs`: `setTokenIntent`/`enqueueRoomPublish`/`scheduleRoomHeartbeat` re-arm the heartbeat after every ack, replaying the admitted frozen value with no app callback). The unchanged-value/TTL local no-op that makes per-keystroke `touch()` cheap is real (`implementation.mjs:2453-2458`, including the suspended-room re-admission carve-out the RFC also states). The LLP 0247 §D3 fenced withdrawal is shipped end to end — client fence (`implementation.mjs:2385-2401`, `snapback-client/index.mjs:10820-10870`), server enforcement with `DeleteSettlementStatus::Superseded` (`src/ephemeral.rs:6194-6203`), generated `withdrawalVisibilityDeadlineMs`, and regression coverage (`presence.test.mjs:347-418`). The Expo resurrect hazard is real and even stronger than stated: `pauseRoom` retains `room.desired` and resume republishes it, including out of a `publish-error` suspension (`presence.test.mjs:318-345`); the background-as-withdrawal + absolute-deadline-backstop remedy converges in every interleaving I could construct because clearing local desired intent is synchronous and the base intent-generation check self-withdraws a racing ack. Scope identity, the closed status union, `selfKey`, publisher states, the `[500ms, maxTtlMs]` admission range, the offline never-queued posture, and the OQ1 rationale (mutually exclusive modes via `SNAPBACK_REACT_PRESENCE_ACTION_CONFLICT`; closed `PresenceState` union) all match the shipped types and code. The Motivation's demo characterization is accurate (3 s timer and clear-on-send live in `conversation/[id].tsx:64-73,94`; nothing clears on blur). What remains are two in-delta factual slips and one small surface ambiguity, none of which corrupts a decision.

## Concerns

1. **detail, IN-DELTA — The demo ghost-window figure is wrong: 15 s, not 30 s.** RFC §TTL: "`useTyping` publishes with `maxTtlMs` (30 s ghost window)." The messaging demo declares `maxTtlMs: 15_000` (`demos/messaging-snapback/snapback/schema.mjs:117`), and `useTyping.ts:8` publishes at `typingRef.maxTtlMs`, so the current window is 15 s; 30 s is the paved-path ceiling from LLP 0013, not this collection's declaration. The migration decision and its justification survive unchanged (collection default is 6 s, still a tightening), but the parenthetical should be corrected before Accepted.

2. **detail, IN-DELTA — "trip churn diagnostics" misattributes the observable consequence of volatile thunk fields.** RFC §Value semantics. The shipped churn detector (`SNAPBACK_REACT_PRESENCE_PUBLISH_CHURN`, LLP 0107 §Client dev diagnostics amendment) counts committed scope/value *descriptor-identity* transitions per hook instance (`implementation.mjs:220-266`); the helper's internal descriptor is stable (`value: skip`, fixed scope), and imperative observer publishes never feed it, so touch-time value churn cannot trip it. What actually happens with a volatile thunk is a real wire publish per tick and, at keystroke rates, rate refusal surfacing as `publisher.status === 'publish-error'` suspension. The design warning is right; the named mechanism is wrong, and the guide page (deliverable 2) would propagate a false diagnostic claim if written from this sentence.

3. **detail, IN-DELTA — `touch()`'s admission-refusal surface is implicit.** RFC §Result and error surface pins that transport failures don't reject from `touch()` and that admission bounds "refuse before wire work," but not whether admission refusals reject from `touch()` or route to `onError`. All shipped admission refusals throw synchronously from the base `publish` (TTL bounds, size, rate, and notably `SNAPBACK_REACT_PRESENCE_VALUE_CONFLICT` when two same-room consumers publish byte-divergent values, `implementation.mjs:2265-2331`). Inheriting base throw behavior is the natural reading and any resolution is compatible; one sentence at implementation time settles it. No defective decision.

## Direction

Right direction, and r2 resolves round 1's substantive gaps convincingly: renewal ownership is now stated correctly, the activity model is pinned tightly enough to implement without guessing (absolute deadline + generation fence, touch-time-only sampling, reset-on-scope-change, closed passthrough result), and the Expo background/resume hazard — the one place a naive implementation would genuinely misbehave — is identified against real shipped behavior and closed with a mechanism that is race-safe under the actual interleavings. Fix the two factual slips (concerns 1–2) in an editorial pass when landing; neither requires reopening any design section.

VERDICT: READY
