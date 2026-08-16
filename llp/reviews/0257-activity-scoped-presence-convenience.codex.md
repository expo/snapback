# LLP 0257 reviews — codex family

## Round 1 — 2026-08-15

- Reviewer: gpt-5.6-sol, reasoning effort xhigh, `codex exec` read-only
  sandbox, `--skip-git-repo-check`, direct binary (not the cmux shim).
- Revision under review: r1, sha256
  `dae1aaa61141fb485d3d33fdaa9435c4a66a4665a13eaa76b6c54a941a8c32cd`.
- Capsule: archive of main `272bea745` + target overlay; instructions
  sha256 `c6632d0415805fe7262faaf977de0a5e28f1730e7b1b054d0c7d2ff980360bb0`;
  per-reviewer APFS clone; structurally blind. (File links in the body
  point into the reviewer's capsule clone; capsule paths mirror repo
  paths.)
- Verdict: **NOT READY** (4 MATERIAL, 2 detail).

### Verbatim review

The RFC identifies a genuine ergonomic gap, and a client-side convenience over the existing presence machinery is the right general approach. However, r1 leaves several core lifecycle and API decisions unresolved, misunderstands who owns renewal cadence, and does not yet satisfy the claimed Expo behavior. Those ambiguities could produce duplicate heartbeats, silent failures, stale-value publication, or presence briefly resurrecting after foregrounding.

1. **MATERIAL — Renewal ownership and the TTL rule contradict the shipped base hook.** [LLP 0257 §Design sketch](/private/tmp/claude-501/-Users-ccheever-projects-snapback/9530722e-bf82-4a14-929d-c8b0ec537328/scratchpad/sr0257/capsule-r1-codex/llp/0257-activity-scoped-presence-convenience.rfc.md:63) says the helper derives a republish cadence and piggybacks on the provider heartbeat “where possible.” In fact, after one imperative `publish`, the provider always owns renewal at `max(250ms, min(ttlMs/2, 10_000ms))`; unchanged value/TTL publications are local no-ops ([implementation](/private/tmp/claude-501/-Users-ccheever-projects-snapback/9530722e-bf82-4a14-929d-c8b0ec537328/scratchpad/sr0257/capsule-r1-codex/packages/snapback-react/implementation.mjs:2348), [LLP 0107 §Presence ownership](/private/tmp/claude-501/-Users-ccheever-projects-snapback/9530722e-bf82-4a14-929d-c8b0ec537328/scratchpad/sr0257/capsule-r1-codex/llp/0107-react-presence-and-optimistic-lifecycle.spec.md:110)). Consequently, `idleMs < maxTtlMs` is neither necessary nor sufficient to define behavior: the effective lease is the generated default unless `publish` supplies `ttlMs`, and a provider heartbeat can safely maintain a lease even when `idleMs > maxTtlMs`. Resolve this by choosing the exact effective TTL and stating that the helper owns only the idle deadline. Each `touch()` may evaluate the current value and invoke base `publish`; the registry decides whether that requires a transport emission, while all heartbeat scheduling remains provider-owned.

2. **MATERIAL — The public state and error contract is not closed, and default swallowing violates the existing observable-error posture.** The illustrated result exposes only `active`, `touch`, `withdraw`, and `peers`, while naming/home, callback arguments, return promises, and even the meaning of `active` remain undecided ([LLP 0257 §Open questions](/private/tmp/claude-501/-Users-ccheever-projects-snapback/9530722e-bf82-4a14-929d-c8b0ec537328/scratchpad/sr0257/capsule-r1-codex/llp/0257-activity-scoped-presence-convenience.rfc.md:100)). Is `active` the caller’s unexpired intent, an admitted desired value, or an acknowledged remote publication—and what is it after `publish-error`? This matters because transport publish failures are caught into `publisher.status === "publish-error"` rather than rejected from `publish()` ([implementation](/private/tmp/claude-501/-Users-ccheever-projects-snapback/9530722e-bf82-4a14-929d-c8b0ec537328/scratchpad/sr0257/capsule-r1-codex/packages/snapback-react/implementation.mjs:2437)), whereas withdrawal failures can reject. A `.catch()`-based `onError` therefore misses initial-send, heartbeat, and resync publication failures. Hiding the base hook’s `pending | resyncing | ready | stale | error | unsupported` and publisher state also conflicts with LLP 0013’s requirement that rate and publish failures remain observable, never a silent stall ([LLP 0013 §V1 local budgets](/private/tmp/claude-501/-Users-ccheever-projects-snapback/9530722e-bf82-4a14-929d-c8b0ec537328/scratchpad/sr0257/capsule-r1-codex/llp/0013-ephemeral-realtime-state.rfc.md:216)). Pin a complete typed result—preferably preserving the underlying presence/publisher diagnostics—and define `touch()`/`withdraw()` settlement and once-per-transition `onError` behavior. Lossiness permits disappearance; it does not justify making operational refusal invisible.

3. **MATERIAL — Value freshness, canonical identity, and transition semantics are underdetermined.** The value thunk is said to run on “(re)publish,” but provider heartbeats replay the already-admitted frozen value and never call back into the wrapper. Open question 2 therefore cannot be deferred: the RFC must say whether every `touch()` evaluates the latest thunk and calls base `publish`, whether overrides are supported, and whether a value change without a new activity tick is intentionally ignored. Likewise, “scope change withdraws” does not define a change. The base hook uses normalized, content-based scope identity, and explicitly treats fresh content-equal objects as the same descriptor ([LLP 0107 §Client dev diagnostics](/private/tmp/claude-501/-Users-ccheever-projects-snapback/9530722e-bf82-4a14-929d-c8b0ec537328/scratchpad/sr0257/capsule-r1-codex/llp/0107-react-presence-and-optimistic-lifecycle.spec.md:394)); the RFC’s inline scope and thunk would otherwise be new identities on every render. It must also decide whether a true reference/provider/normalized-scope change resets activity or migrates it into the successor room. Pin an activity state machine, including latest-thunk capture, content-equal renders, scope replacement, idle-setting changes, and an activity-generation fence so a canceled but already-queued timeout cannot withdraw a newer touch.

4. **MATERIAL — “Expo inherits it” is not true for the promised idle lifecycle without additional coordination.** Expo binds AppState to `provider.pause()`/`resume()` ([React Expo guide](/private/tmp/claude-501/-Users-ccheever-projects-snapback/9530722e-bf82-4a14-929d-c8b0ec537328/scratchpad/sr0257/capsule-r1-codex/guide/clients/react-expo.md:891)). Provider pause removes the room handle and heartbeat but retains `room.desired`; resume starts a fresh room and republishes that desired value once ready ([implementation](/private/tmp/claude-501/-Users-ccheever-projects-snapback/9530722e-bf82-4a14-929d-c8b0ec537328/scratchpad/sr0257/capsule-r1-codex/packages/snapback-react/implementation.mjs:2545)). During OS suspension, the helper’s JavaScript idle timer may not run. Foregrounding can therefore republish a minutes-old typing intent before the overdue timeout fires. A thin composition over the current public hook has no provider-pause signal with which to fence that resume. Either narrow v1 to browser React, treat backgrounding as immediate activity withdrawal through an Expo/provider lifecycle seam, or add a client-side absolute-deadline gate that the provider checks before republishing. No server or wire change is required, but the present “inherits it” claim is unsafe.

5. **detail — The motivating demo description and migration scope are inaccurate.** The canonical [`useTyping`](/private/tmp/claude-501/-Users-ccheever-projects-snapback/9530722e-bf82-4a14-929d-c8b0ec537328/scratchpad/sr0257/capsule-r1-codex/demos/messaging-snapback/src/lib/useTyping.ts:13) owns publish/delete and filtering, but its three-second timer and send/clear choreography live in the conversation screen; there is no blur cleanup ([conversation screen](/private/tmp/claude-501/-Users-ccheever-projects-snapback/9530722e-bf82-4a14-929d-c8b0ec537328/scratchpad/sr0257/capsule-r1-codex/demos/messaging-snapback/src/app/conversation/[id].tsx:63)). The migration must therefore change that screen, not merely `useTyping`. Also, the current demo filters both `selfKey` and every entry with the same `userHandle`; `excludeSelf` as specified removes only the connection-owned key, so replacing both filters would make the user’s other independent device appear as a peer. Preserve that domain-level filter or document the behavioral change.

6. **detail — Explicitly pin the offline and headless boundary.** LLP 0013 states that ephemeral intent is in-memory and never retained for offline use ([§Relationship to durable sync](/private/tmp/claude-501/-Users-ccheever-projects-snapback/9530722e-bf82-4a14-929d-c8b0ec537328/scratchpad/sr0257/capsule-r1-codex/llp/0013-ephemeral-realtime-state.rfc.md:637)). The RFC should say that a disconnected `touch()` creates only provider-memory desired intent: reconnect before the idle deadline may publish it, while idle, unmount, disposal, or process loss prevents later replay; it never enters the durable mutation outbox. The headless convenience can be explicitly deferred rather than left as an implementation-scope question.

Direction: The direction is sound: build the convenience and keep it client-side. A separate observer-mode React hook is preferable to an option bundle on `useSnapbackPresence`, whose declarative and imperative modes are already mutually exclusive and closed. Expo may require an additional client lifecycle/deadline seam, but no wire or server feature is warranted.

VERDICT: NOT READY
## Round 2 (delta round) — 2026-08-15

- Reviewer: gpt-5.6-sol, reasoning effort xhigh, `codex exec` read-only
  sandbox, fresh lane, structurally blind.
- Revision under review: r2, sha256
  `b1da1711f822e98e4ea8e1e494cb8b59025d838e29d131da9bdd75372734a0d1`.
- Capsule: pristine clone of the round-1 capsule with target swapped to r2;
  instructions `INSTRUCTIONS-r2.md` sha256
  `ac1fd9cb489e203db431bba98c20141ae0b31eb7191c435935e2523382a4de0e`
  (delta enumeration + IN-DELTA/PRE-EXISTING classification required).
- Verdict: **NOT READY** (3 MATERIAL, all IN-DELTA; 1 detail IN-DELTA;
  zero PRE-EXISTING MATERIAL).

### Verbatim review

Overall assessment: Revision r2 is substantially stronger and its central direction is sound: a separate observer-mode hook, provider-owned renewal, absolute activity deadlines, fenced withdrawal, scope reset, touch-time value sampling, and self-key-only filtering all align with the shipped presence model. However, three in-delta decisions remain materially under-specified or incompatible with the current composition seam, so the RFC is not yet implementation-ready.

1. **MATERIAL — IN-DELTA.** The promised non-throwing, never-unobservable error contract does not cover all failures exposed by the base hook. `llp/0257-activity-scoped-presence-convenience.rfc.md` §Result and error surface says `onError` observes `publish-error` transitions and rejected withdrawals while the default remains non-throwing. But `packages/snapback-react/implementation.mjs:2265-2331` throws local admission failures—invalid TTL/value, payload size, same-room conflict, and heartbeat budget—before changing publisher state, so they never become `publisher.status === "publish-error"`. A throwing value thunk has the same gap. Additionally, withdrawal clears desired intent before awaiting deletion (`implementation.mjs:2494-2511`), while `roomPublisherState` returns `observing` whenever desired is absent before consulting its diagnostic (`implementation.mjs:2194-2202`); therefore a rejected withdrawal is invisible when `onError` is omitted. The RFC must define `touch`/`withdraw` return types and a complete disposition for thunk, admission, transport, and withdrawal failures—either preserve promise rejection, add helper-owned diagnostic state, or mandate another observable channel.

2. **MATERIAL — IN-DELTA.** The Expo background-withdrawal guarantee lacks an implementable ownership and ordering seam. The RFC’s §Expo and Deliverable 1 require the React-package hook to withdraw on background, ordered with the existing AppState seam, without a provider change. Shipped Expo binds AppState only to provider-level `pause`/`resume` (`packages/snapback-expo/provider.mjs:298-312`; `packages/snapback-client/index.mjs:2010-2038`), and the guides explicitly require one provider-boundary lifecycle binding rather than per-component listeners (`guide/clients/react.md` §provider lifecycle; `guide/clients/react-expo.md` §Handle native reconnect honestly). React `pauseRoom` drops the handle and acknowledged pair but retains desired intent (`packages/snapback-react/implementation.mjs:2514-2525`), and `startRoom` republishes that intent when ready (`:2545-2575`). Meanwhile, `@expo/snapback-expo` currently merely re-exports the canonical React hooks without forking behavior (`packages/snapback-expo/index.mjs:28-30`). The RFC must pin a single mechanism—such as a provider pre-pause activity-withdrawal participant or an Expo lifecycle context—and its ordering. It must also say how the messaging demo is covered: that Expo demo mounts a direct `SnapbackProvider` with no AppState binding (`demos/messaging-snapback/src/app/_layout.tsx:30-69`), while the listed migration touches only its typing hook and conversation screen.

3. **MATERIAL — IN-DELTA.** `idleMs` has no defined admission domain. The public option is merely `number`, while §TTL says “any `idleMs` is legal.” Negative values, zero, `NaN`, infinity, unsafe integers, and delays beyond host timer ranges produce divergent immediate, disabled, or overflowed timers across web and React Native, directly affecting withdrawal safety. This is especially conspicuous beside the base hook’s explicit safe-integer TTL validation (`packages/snapback-react/implementation.mjs:2265-2275`). Pin whether zero is meaningful, require a finite integer minimum, and either cap the maximum or specify chunked scheduling for long absolute deadlines.

4. **detail — IN-DELTA.** The demo ghost-window claim is factually wrong. §TTL says `useTyping` currently selects a 30-second maximum, but `demos/messaging-snapback/snapback/schema.mjs:112-120` declares `ttlMs: 6_000` and `maxTtlMs: 15_000`, while `src/lib/useTyping.ts:7-8` selects that 15-second maximum. The migration tightens the window from 15 seconds to 6 seconds, not from 30 seconds.

Direction: Keep the separate observer-mode hook and the pinned deadline/fencing/scope/value semantics. Close the complete error algebra, make activity withdrawal an ordered participant in the single Expo lifecycle owner, and bound `idleMs`; no wire or server change is needed.

VERDICT: NOT READY
## Round 4 (codex-only delta round) — 2026-08-15

- Reviewer: gpt-5.6-sol, reasoning effort xhigh, `codex exec` read-only
  sandbox, fresh lane, structurally blind. Pool this round: codex only
  (grok READY r3; claude READY r2, dropped by pool rule).
- Revision under review: r4, sha256
  `13c7c76eb579f767c10613553784eac9e490044e22db7c37de1cf2237293a8d6`.
- Capsule: pristine clone of the round-3 capsule with target swapped to
  r4; instructions `INSTRUCTIONS-r4.md` sha256
  `aead166aeaa279ac8b61b6890b4afda2fd02e4788a40aa36dfa4f15fd2169a1f`.
- Verdict: **NOT READY** (1 MATERIAL IN-DELTA — the r4 umbrella
  "once per occurrence" sentence contradicts the transition-scoped class 3
  added by the same revision; 2 detail IN-DELTA; zero PRE-EXISTING
  MATERIAL, fourth consecutive round).

### Verbatim review

The r4 proposal is coherent, feasible, and well-grounded in the shipped React presence, fencing, Expo resolver, and messaging-demo surfaces. The `idleMs`, typed-thunk-diagnostic, promise-admission, and facade-wrapper decisions are sound. However, one material contradiction remains in the public error contract; no material PRE-EXISTING concern was found.

1. **MATERIAL — IN-DELTA.** LLP 0257 §Result and error surface says `onError` fires “once per occurrence” for every failure class (`llp/0257-activity-scoped-presence-convenience.rfc.md:174-182`), while the revised class 3 guarantees only one report per distinct observed transition and permits multiple wire failures to collapse (`:193-200`). The shipped surface is indeed level-triggered: `implementation.mjs:2437-2448` stores one `publisherDiagnostic`, and `presence.test.mjs` demonstrates that a failed transport publish resolves while `publisher.status` becomes `publish-error`. Without the occurrence counters the RFC explicitly rejects, both guarantees cannot hold.

2. **detail — IN-DELTA.** The unconditional invalid-`idleMs` refusal does not pin its carrier (`llp/0257…:94-101`). It falls outside the four-class error algebra, while `touch()` is specified never to throw. State whether invalid hook configuration throws a typed diagnostic before a result exists or is reported through `onError`/`lastError`.

3. **detail — IN-DELTA.** The Expo wrapper should explicitly sample `AppState.currentState` when its asynchronously resolved listener attaches. The existing resolver is asynchronous (`packages/snapback-expo/app-state.native.mjs`; `provider.mjs` §`appStateFor`), and the shipped lifecycle binding deliberately handles an already-non-active state (`packages/snapback-client/index.mjs:2023-2045`). Otherwise, a background transition during listener setup can evade the immediate-withdrawal guarantee.

Direction: Replace the umbrella “once per occurrence” promise with class-specific cardinality—classes 1, 2, and 4 per failed invocation; class 3 per distinct observed transition—then pin the two admission/lifecycle details above.

VERDICT: NOT READY
## Round 5 (codex-only delta round) — 2026-08-15

- Reviewer: gpt-5.6-sol, reasoning effort xhigh, `codex exec` read-only
  sandbox, fresh lane, structurally blind. Pool: codex only.
- Revision under review: r5, sha256
  `be403c9b6f70a0fc834553055160a67a79eee48e898afa0652454de828ee716f`.
- Capsule: pristine clone of the round-4 capsule with target swapped to
  r5; instructions `INSTRUCTIONS-r5.md` (sha256 recorded in the run
  journal).
- Verdict: **NOT READY** (2 MATERIAL — one tagged PRE-EXISTING against
  the r4-introduced doorway pin (prior-delta churn), one IN-DELTA; 1
  detail IN-DELTA).

### Verbatim review

Revision r5 improves the error cardinality and render-time `idleMs` refusal semantics, but the Expo lifecycle design remains materially incomplete: it can observe a different AppState source from the provider, and its new current-state sample cannot guarantee that transitions during asynchronous listener setup are detected.

1. **MATERIAL — PRE-EXISTING.** The Expo wrapper is pinned to the default `#app-state` resolver (`llp/0257-activity-scoped-presence-convenience.rfc.md`, §Expo), while the shipped provider first honors `environment.appState` and `environment.resolveAppState` (`packages/snapback-expo/provider.mjs`, `appStateFor`; `packages/snapback-expo/index.d.mts`, `SnapbackExpoEnvironmentV1`). An advanced shell may therefore pause the provider from an injected source while the activity hook listens to a different default source—or none—breaking the background-withdrawal guarantee. The hook and provider need one shared resolved lifecycle source, with a defined fallback for bare `SnapbackProvider` use.

2. **MATERIAL — IN-DELTA.** Sampling `AppState.currentState` when the asynchronous listener attaches detects only the current level, not every transition during setup (`llp/0257…`, §Expo). If the app transitions background → active before attachment completes, the sample sees `active`, no event is observed, and previously published intent survives. It is also not “immediate” while resolution remains pending. Either gate activity until lifecycle observation is established, or narrow the guarantee to withdrawal when the app is still known non-active at attachment; test both a persistent background state and a background/active bounce during delayed resolution.

3. **detail — IN-DELTA.** The `idleMs` refusal says “typed diagnostic error” without naming whether this is the exported `SnapbackDiagnosticError` recognized by `isSnapbackDiagnosticError`, or the base presence implementation’s ordinary `Error` carrying `code` and `diagnostic` (`packages/snapback-react/implementation.mjs`, `diagnosticError`; `packages/snapback-react/index.d.mts`). Pin the concrete public carrier and guard behavior.

Direction: unify lifecycle-source ownership, correct or narrow the asynchronous-attachment guarantee, and name the render-time diagnostic carrier.

VERDICT: NOT READY
## Round 6 (codex-only delta round, final launch) — 2026-08-15

- Reviewer: gpt-5.6-sol, reasoning effort xhigh, `codex exec` read-only
  sandbox, fresh lane, structurally blind. Pool: codex only; launch 6 of
  cap 6.
- Revision under review: r6, sha256
  `d69bb4751e3018f8198de79acb27c11349f4edd596399feb4a6d29f39e3b6617`.
- Capsule: pristine clone of the round-5 capsule with target swapped to
  r6; instructions `INSTRUCTIONS-r6.md` (sha256 in the run journal).
- Verdict: **NOT READY** (1 MATERIAL IN-DELTA — the r6 admission gate
  leaves lifecycle-resolution failure without an observable typed
  disposition; 1 detail IN-DELTA — pin a private captured-value admission
  seam; zero PRE-EXISTING MATERIAL).

### Verbatim review

The proposal is coherent and repository-grounded: provider-owned renewal, fenced withdrawal, demo TTLs, lifecycle-source precedence, and the `SnapbackDiagnosticError` carrier all match current code. The r6 admission gate closes the setup-window resurrection race conceptually, but it introduces an unhandled lifecycle-resolution failure that breaks the RFC’s closed, observable error contract.

1. **MATERIAL — IN-DELTA.** Lifecycle observation can fail, but the RFC specifies no observable disposition. §Expo requires admission to remain gated until a source resolves and an observer attaches, while §Result and error surface permits only four unrelated failure classes and says `status`/`diagnostic` pass through from the base hook. Repository behavior proves failure is expected: `packages/snapback-expo/app-state.mjs:1-3` returns no source on unsupported hosts, and `packages/snapback-expo/provider.mjs:132-148` converts that into `SNAPBACK_EXPO_COMPATIBILITY_UNSUPPORTED`; `guide/clients/react-expo.md:426-432` explicitly promises refusal. `SnapbackExpoProvider` can surface that boot refusal before mounting children, but the RFC also promises operation beneath a bare `SnapbackProvider`, where no boot owner exists. As written, resolver rejection or a null source must either silently defer/drop every `touch()`, publish without the required observer, override the claimed base-pass-through state, or introduce an unspecified fifth failure class. The RFC must choose and type an observable outcome.

2. **detail — IN-DELTA.** The setup gate needs a private captured-value admission seam. §Activity model and §Value semantics require thunk evaluation exactly at `touch()` time, while §Gated admission requires retaining that value and publishing it later; invoking the React helper’s public `touch()` later would re-evaluate the thunk, and `touch(value?)` is explicitly deferred. Pin an internal arm/admit-captured-value mechanism so the Expo wrapper remains a thin composition without duplicating the activity state machine.

Direction: Add lifecycle-resolution/attachment failure to the wrapper’s closed result and error algebra—preferably a stable Expo activity diagnostic surfaced once through `onError`/`lastError`, with explicit `error` or `unsupported` projection—and specify the private captured-value gate used by the facade.

VERDICT: NOT READY