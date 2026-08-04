# React dev loop exposes binding mismatch during contract reload

**Date:** 2026-08-03
**Status:** Open
**Area:** Snapback React, local development, diagnostics

## Problem

During ordinary app development, changing a generated function contract can
temporarily put Metro/HMR and the local Snapback backend on adjacent
generations. The root provider currently renders the raw terminal diagnostic:

> SNAPBACK_REACT_BINDING_MISMATCH: generated manifest does not match the connected deployment

This is correct as a safety invariant but confusing as product UI. It reads
like an application bug and can appear in the middle of a normal edit/restart
cycle, when the actionable state is simply that the backend and client are
being refreshed to the same generation.

## Reproduction

1. Run `demos/chirp` against a local Snapback backend with Metro active.
2. Change `toggleLike`'s generated result contract and run codegen.
3. Let Metro reload before the backend has restarted and provisioned the new
   artifacts.
4. Observe the raw binding-mismatch diagnostic in the app.

## Desired behavior

- In a positively identified local-development session, treat a transient
  generated/deployment mismatch as a recoverable synchronization state.
- Show concise product language such as “Updating local backend…” or
  “Client and backend are briefly out of sync; waiting for reload.”
- Automatically retry preparation when the deployment generation changes,
  with a bounded timeout and no relaxation of contract admission.
- If the mismatch persists, reveal the diagnostic code and concrete actions
  in developer details rather than as the primary end-user message.
- Preserve the current loud refusal outside the identified dev-loop case;
  production must never silently admit a mismatched contract.

## Evidence

Observed on a physical iPhone while iterating on the optimistic like receipt in
`demos/chirp` on 2026-08-03. See
`diaries/0053-chirp-expo-twitter-clone.diary.md`.
