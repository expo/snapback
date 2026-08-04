# React dev loop exposes binding mismatch during contract reload

**Date:** 2026-08-03
**Status:** Closed
**Area:** Snapback React, local development, diagnostics

## Problem

During ordinary app development, changing a generated function contract can
temporarily put Metro/HMR and the local Snapback backend on adjacent
generations. Preparation correctly refused the mismatch, but root UI commonly
rendered the raw terminal diagnostic:

> SNAPBACK_REACT_BINDING_MISMATCH: generated manifest does not match the connected deployment

That safety invariant read like an application bug even when code generation
and the local backend were simply converging on the same generation.

## Resolution

`prepareReactBinding` now enters a bounded synchronization loop only after a
live inspection positively identifies `targetProfileId:
"local-dev-sqlite-ibex"` together with `activeMode: "dev"`. The default window
is 10 seconds with a 250 ms interval. Each attempt repeats complete binding
admission, and retry attempts disable persisted-receipt fallback so an offline
receipt cannot admit the generated successor while the live backend is stale
or unavailable.

Applications may project `developmentSync.onStateChange` directly into their
root loading UI. Waiting reports “Updating local backend…”; success reports
“Local backend updated.” Persistent mismatch rejects with human-facing primary
copy plus the original `SNAPBACK_REACT_BINDING_MISMATCH`, expected/actual
details, and concrete actions in the structured diagnostic. The caller may set
`developmentSync: false` when immediate local refusal is intentional.

Chirp now uses that projection in its root layout. Its loading screen follows
the synchronization message, and a persistent mismatch exposes the stable code
and recovery actions only after the developer expands “Developer details.”

Hosted, sessions, unknown-profile, receipt-only, and other unproved contexts
retain the original immediate loud refusal. Provider construction remains
synchronous and cannot occur until preparation fully admits a live generation.

The governing contract and author guide were updated in LLP 0114 and
`guide/clients/react.md`.

## Verification

- `packages/snapback-react/binding-development-sync.test.mjs` covers a prior
  receipt plus predecessor → unreachable → successor recovery, bounded
  persistent drift, explicit opt-out, and hosted/sessions refusal.
- The complete Snapback client and React package suites pass, including the
  React TypeScript fixture and the clean-worktree generated-artifact proof.
- Chirp's strict TypeScript check covers the root state projection and
  expandable developer details; its Expo web production export bundles the
  changed root successfully, and its headless acceptance passes 5/5.
- `./ref-check --verbose` and `node scripts/check-guide.mjs` validate the LLP
  reference and served-guide projection.
