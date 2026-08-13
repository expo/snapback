# Doubles fix report

## Scope

Aligned client-package test doubles with the strict LLP 0238 D1 reference-kind
gate. No production source was changed, and no commit was created.

## Doubles fixed

| File:line | Double / exercised verb | Kind added |
| --- | --- | --- |
| `packages/snapback-client/package.test.mjs:302` | `generatedQueryRef`; `query`, `authorizedLeaseQuery`, and the malformed-generation `query` check | `Query` |
| `packages/snapback-client/package.test.mjs:306` | `generatedMutationRef`; `mutate` | `Mutation` |
| `packages/snapback-client/package.test.mjs:310` | `generatedActionRef`; `action` | `Action` |
| `packages/snapback-client/package.test.mjs:314` | `generatedLiveRef`; `subscribeLive` | `LiveQuery` |
| `packages/snapback-client/package.test.mjs:318` | `generatedValidatedLiveRef`; both argument-validation and successful `liveQuery` calls (inherits the discriminant from `generatedLiveRef`) | `LiveQuery` |
| `packages/snapback-client/outbox-store.test.mjs:49` | `GeneratedMutationReplayClientDouble`; generation-bound `adoptQueuedMutations` / `replayQueuedMutations` fixtures at lines 865, 1006, and 1742 cross the public `mutate` seam | `Mutation` |
| `packages/snapback-client/outbox-store.test.mjs:1736` | `generationBoundMutation`; initial `mutate` call before replay | `Mutation` |
| `packages/snapback-client/outbox-drain.test.mjs:98` | persisted `functionReference` used by retained-registration resync in `startOutboxDrain` | `LiveQuery` |

No command double needed a change; `commands.test.mjs` already uses the legal
`asset-bearing-command.v1` descriptor shape.

## Verification

Complete client chain passed (exit 0):

```sh
env -u FORCE_COLOR SNAPBACK_CLIENT_RQS_DIR=/tmp/rqs-fix npm test --workspace @expo/snapback-client
```

Reference-kind gate suite passed independently (2/2, exit 0):

```sh
env -u FORCE_COLOR node packages/snapback-client/reference-kind.test.mjs
```

```text
✔ every wrong generated reference/verb pair refuses before transport (7.185583ms)
✔ missing, future, and malformed object kinds refuse every verb before transport (1.010125ms)
ℹ tests 2
ℹ suites 0
ℹ pass 2
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 11.983333
```

## Complete-chain tail (verbatim)

```text
✔ corrupt persisted state fails closed: no retained render, no token, entry invalidated [native/expo-file-system] (12.144458ms)
✔ an entry left in-progress by an interrupted delta sequence falls back to fresh subscribe [native/expo-file-system] (8.068708ms)
✔ token persistence failure falls back to fresh subscribe and never surfaces (T9) [native/expo-file-system] (6.99675ms)
✔ auth-scoped/non-eligible data is never persisted: no token minted, nothing stored, relaunch renders nothing stale [native/expo-file-system] (4.176875ms)
✔ a time-dependent (non-eligible) query re-executes on relaunch instead of receiving CurrentAsOf [native/expo-file-system] (3.342417ms)
✔ a non-empty relaunch outbox suppresses resumeFromToken but still renders retained pre-intent rows (LLP 0090 D3 outbox rule, 2026-08-01 rendering note) [native/expo-file-system] (7.338458ms)
✔ ResyncRequired with clear_retained purges the persisted copy, not just memory [native/expo-file-system] (6.742083ms)
✔ two contexts racing persistence respect the single-writer lock; the reader adopts the store token [native/expo-file-system] (9.252709ms)
✔ preloadedResume (Channel A) arbitrates against the persisted entry per LLP 0090 D3 [native/expo-file-system] (13.193667ms)
✔ persistence rides the debounce cadence without an explicit flush [native/expo-file-system] (1206.636083ms)
✔ per-subscription opt-out (persistResume: false) keeps the store empty — the 0C manifest hook stand-in [native/expo-file-system] (1105.444792ms)
ℹ tests 20
ℹ suites 0
ℹ pass 20
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 2520.471875
bundle.test.mjs passed
browser-closure.test.mjs passed
snapback-client wire-version tests passed
```
