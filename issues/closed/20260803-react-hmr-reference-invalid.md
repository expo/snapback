# React HMR rejects regenerated references against mounted binding

**Date:** 2026-08-03
**Status:** Resolved (2026-08-05)
**Area:** Snapback React, generated references, HMR

## Problem

During an ordinary Expo/Metro hot reload after Snapback codegen changes, the
application can crash with:

> SNAPBACK_REACT_REFERENCE_INVALID: generated function reference was not admitted by this prepared binding

This is distinct from a client/deployment manifest mismatch. HMR can replace
the imported generated `api` module while preserving the mounted
`SnapbackProvider` and its prepared binding. Hooks then present a valid
reference from the new generated module to admission state prepared from the
previous module generation. The invariant correctly refuses the mixed state,
but the current behavior turns a recoverable dev-loop handoff into an uncaught
application error.

## Reproduction

1. Run `demos/chirp` in Expo web or Expo Go with Metro HMR active.
2. Keep the root `SnapbackProvider` mounted.
3. Change a function contract, run codegen, and let Metro hot-replace modules.
4. A route hook such as `useSnapbackQuery(api.timeline, ...)` or an optimistic
   mutation receives the regenerated reference before the provider binding is
   recreated.
5. Observe the uncaught `SNAPBACK_REACT_REFERENCE_INVALID` error.

## Desired behavior

- Treat a generated-reference generation change as a provider-boundary
  invalidation in a positively identified development/HMR environment.
- Atomically recreate or hand off the prepared binding before hooks admit new
  references; do not expose a frame containing a new reference with an old
  binding.
- Preserve query continuity or a short “Refreshing Snapback…” state while the
  new binding prepares, rather than throwing through the application tree.
- If an atomic handoff cannot complete, trigger a controlled full reload in
  development with a clear console diagnostic.
- Keep strict rejection for genuinely foreign/stale references and for
  production; HMR recovery must not weaken reference admission.
- Add an acceptance test that simulates the generated-module/provider
  generation split and proves either atomic handoff or controlled reload with
  no uncaught render error.

## Related

- `issues/20260803-react-dev-binding-mismatch-user-facing.md` covers the
  adjacent client-versus-deployment generation mismatch. This issue covers
  new generated references versus an already-mounted prepared React binding.
- `diaries/0053-chirp-expo-twitter-clone.diary.md`

## Resolution

Fixed 2026-08-05 as the **mounted-provider HMR generation handoff** (LLP 0114
dated amendment 2026-08-05).

Mechanism:

- `packages/snapback-client/react-binding.mjs` — new
  `classifyRegeneratedReactReference` positively identifies the exact split
  (complete same-app function reference whose codegen-stamped
  `expectedGeneration` names a different generation than the currently
  admitted deployment identity), and
  `handoffPreparedReactBindingGeneration` polls the live inspection inside a
  bounded budget until the deployment serves exactly that generation, re-runs
  complete per-function admission (reference completeness, result-contract
  compilation, hash binding) off to the side, and publishes the whole
  new-generation admission view in one synchronous WeakMap-overlay swap over
  the frozen binding (single-flight per binding+generation). All admission
  reads (`admittedReactReference`, `preparedReactResultContract`, query-group
  preparation) resolve through the overlay, so no frame can pair a
  new-generation reference with old admission state.
- `packages/snapback-react/index.mjs` — the provider registry catches
  `SNAPBACK_REACT_REFERENCE_INVALID` at descriptor/mutation admission, and
  only when the environment is a **positively identified** development host
  (`__DEV__ === true`, `import.meta.hot`/`module.hot`, or
  `NODE_ENV === 'development'` — absence-of-production is never a dev signal)
  AND the reference classifies as regenerated, it returns a handoff
  descriptor whose snapshot is a stable pending/refreshing boundary frame,
  parks the subscription on the handoff completion, and attaches the real
  store when the swap lands. Unchanged functions keep the same store key, so
  untouched queries have full continuity. Deferred mutation references admit
  at call time after awaiting the handoff. If the handoff cannot complete
  (backend never reaches the generation, or routes/ephemeral/query-group
  shape changed — not re-provable from the live inspection), the provider
  emits one clear `SNAPBACK_REACT_HMR_REBIND_FAILED` console diagnostic and
  triggers a controlled dev reload (`developmentHmr.onReloadRequired` seam;
  defaults to `DevSettings.reload`/`location.reload`), while hooks render an
  `error` frame instead of throwing.
- Strictness preserved: production builds, foreign appIds, missing generation
  stamps, and same-generation corruption all keep the original strict throw;
  post-handoff admission is exact-match against deployment-proved facts.

Evidence: `packages/snapback-react/hmr-generation-handoff.test.mjs` simulates
the generated-module/provider generation split end to end through real React
renders (react-test-renderer) — atomic handoff with sibling continuity,
mutation deferral, controlled reload on a never-redeployed backend, and
strict production/foreign rejection — with a process-level assertion that no
uncaught exception or rejection escaped. Full `packages/snapback-react` and
`packages/snapback-client` suites pass. Docs: LLP 0114 dated amendment;
`guide/clients/react.md` dev-loop section.
