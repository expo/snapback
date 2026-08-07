# `check-generated-artifacts` is red on main — the `CommandAssetSource` split regenerated only a subset of the corpus

**Status:** Resolved
**Impact:** 4
**Urgency:** 4
**Ease:** 4
**Confidence:** 5
**Systems:** Codegen, Packaging, Testing
**Date:** 2026-08-06
**Related:** `47b4a59ac` (LLP 0181 E2 / LLP 0176 G3 picker adapter),
`issues/20260806-commands-profile-blocks-all-metrology-writers.md` (same
failure shape), `issues/20260806-main-red-agent-safe-leaf-set-drift.md`

## Summary

`scripts/check-generated-artifacts` fails at `main` tip `47b4a59ac` with
`FAIL: committed review manifests or policy projections are stale`.

`47b4a59ac feat(expo,fixture): E2 picker adapter + G3 platform receipts`
changed the codegen emitter's typed command surface, splitting

```ts
export interface CommandAssetSource { readonly size: number; ... }
```

into

```ts
export interface CommandBlobSource { readonly size: number; ... }
export interface CommandPlatformAssetSource { readonly uri: string; ... }
export type CommandAssetSource = CommandBlobSource | CommandPlatformAssetSource;
```

but refreshed only the artifacts of the demos it touched directly
(chat-matrix, its comparator, and the `push-seam` CLI fixture). Every other
generated corpus still carries the pre-split `app.d.ts` and a stale
`typed-app-descriptor` hash in `artifacts.json`.

## Measured

Fresh worktree at `47b4a59ac`, volta node 24.18.0, fresh `bun install`,
clean tree. Running the gate regenerates in place and leaves **27 demo
corpora plus two fixture corpora** dirty, e.g.:

- `demos/todo`, `demos/todo-v2` (both profiles), `demos/campfire`,
  `demos/chirp`, `demos/graffiti`, `demos/rbac`, `demos/shindig`,
  `demos/team-chat`, `demos/all-aboard` (+ its egress probe),
  `demos/partiful-matrix`, `demos/signal-desk`, `demos/catalog-lens`,
  `demos/card-game`, `demos/cursors-web`, `demos/dispatch-board`,
  `demos/file-drop`, `demos/latency-kanban`, `demos/messaging-snapback`,
  `demos/party-wall`, `demos/public-dashboard`, `demos/pulse-monitor`,
  `demos/access-desk`, `demos/competitive-checkpoint`, `demos/triage-graph`,
  `demos/todo`;
- `packages/snapback-react/fixtures/conversation/app`;
- `packages/snapback-cli/fixtures/push-seam/app` (which also rotates two
  content-addressed `app.binding.<hash>.mjs` /
  `app.descriptor.<hash>.json` filenames).

Every `typed-app-descriptor` moves by the same +254 bytes — the emitter
delta, applied uniformly — which is what identifies this as one incomplete
regeneration rather than per-demo drift.

## Fix

Re-run the corpus regeneration under the pinned toolchain (node 24.18.0)
and land the refresh in one commit, the way
`4015569e2 Refresh required surface manifests` does. Note the gate
regenerates in place, so it doubles as the fix — but the resulting diff
must be reviewed for spurious toolchain rotation before landing (a
different node/bundler rotates *all* artifacts, which looks identical to
this).

## Note

Found by the G3 quality-tail session while running the pre-push gate table;
not introduced by it (that session touched no codegen input, and reverting
its changes does not clear the failure). Left to the owning lane rather
than folded into an unrelated push. Same pattern as the metrology profile
ticket: a landing changed a measured surface and refreshed only part of the
frozen record, and the failure surfaced to whoever next tried to prove a
commit.

## Resolution — 2026-08-06 wave-drift batch

The corpus was regenerated once, as a batch, under the repository-pinned Node
24.18.0 toolchain after the completed `47b4a59ac` command-asset source split
and the push-seam branch had both settled. The 27 demo review manifests and
the React conversation fixture show the uniform +254-byte typed descriptor
change described above. The push-seam fixture additionally rotates its
content-addressed descriptor/binding pair and capability projections because
its completed source now declares the outbound action and bounded response
stream it actually uses.

No source behavior, capability claim, or active push-seam implementation was
changed by the regeneration. The committed corpus reproduces byte-for-byte
under `scripts/check-generated-artifacts`.
