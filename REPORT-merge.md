# Auth-invalidation / authority-transition merge report

## Merge inputs and governing contracts

- Lane `HEAD`: `77d28f733` (`fix(client): payload-free authorization metadata projection with a real generation fence; cross-context writer broker`).
- Incoming `MERGE_HEAD`: `5ebdbce14` (`origin/main`).
- Main's authority-transition wiper landed in `a2195de11` (`feat(client,codegen,server): default retention for owner-derived public-exact queries (LLP 0270 wave 3, D3.2 slice)`).
- Governing context checked before resolution: LLP 0053 (client-wide invalidation fences), LLP 0059 (authority-generation/CAS transition barrier and durable ownership), and LLP 0258 (single-owner authority-transition composition).
- Main's pinned wiper coverage was located by searching for `wipeForAuthorityTransition`, `requestAuthorityTransitionWipe`, and `authorityTransition`; it includes `bearer-rotation.test.mjs`, the IndexedDB/file/memory store suites, and the v3/logout bridge coverage. The lane coverage includes `authorization-invalidation.test.mjs`, `rqs-store-v3.test.mjs`, and the outbox store/custody/drain/quarantine suites.

## Resolution choices

Every conflict was resolved by retaining both contracts and making main's wiper the public entry point.

1. `packages/snapback-client/rqs-store.mjs` (IndexedDB)
   - Kept main's per-lock-manager `authorityTransitionWipersByLock` registry and writer registration/removal lifecycle.
   - Kept the lane's cross-context outbox-normalization BroadcastChannel broker; writer acquisition now registers both the normalization broker and main's wiper owner.
   - Made main's `authorityTransitionWipe` the exported `wipeForAuthorityTransition` implementation.
   - Moved the lane's `outboxOps.advanceAuthorizationAuthority(...)` into that wiper's one IndexedDB transaction. The transaction writes `advanced.state`, clears the resident stores and React receipt, rotates store metadata, and retains keyed transition idempotency.
   - A no-key follower returns `false`, preserving main's external-bearer predecessor-fence/request protocol. A keyed coordinator transition may still execute its already-dispatch-fenced IndexedDB transaction from a reader context, preserving the lane behavior.
   - `requestAuthorityTransitionWipe` still targets the elected owner and now forwards the exact transition arguments to it.

2. `packages/snapback-client/rqs-store-file.mjs`
   - Kept the lane's rich `heldLocks` record (`authorityTransition`, within-dispatch transition, authorization mutation/dispatch, and normalization broker callbacks).
   - Kept main's independent `authorityTransitionWipersByLock` registry. Writer acquisition and close register/remove both owner records without collapsing either bookkeeping contract.
   - Preserved main's acquisition-race fencing: an in-flight same-process lock owner is registered before the filesystem create settles, and a failed acquisition removes only its own provisional record.
   - Made main's wiper the public entry point. Its writer commit advances the lane authorization generation, sweeps sibling identity blobs, clears resident state, rotates metadata, and persists `advanced.state` rather than the predecessor outbox.
   - Preserved the lane's shared authorization-dispatch tail and within-dispatch broker to avoid re-entering the same dispatch gate. Keyed reader transitions route through that broker; an unkeyed reader returns `false` so main's caller installs its predecessor fence before requesting the registered writer.
   - Preserved normalization-broker routing and payload-free authorization metadata reads alongside the new wiper registry.

3. `packages/snapback-client/rqs-store-memory.mjs`
   - Kept main's per-writer `authorityTransitionWipers` map and cleanup.
   - Kept the lane's backing-wide `authorizationDispatchTail`.
   - Made main's wiper the entry point while moving the lane generation advance and `advanced.state` publication into the writer commit.
   - An unkeyed follower reports `false` for main's predecessor-fence/request path; keyed transitions retain the lane's same-backing writer broker. Writer requests are serialized through the shared dispatch tail.

4. `packages/snapback-client/package.json`
   - Used main's test-file order.
   - Kept main's `rqs-store-sqlite.test.mjs`.
   - Inserted the lane-only `subscribe-retry.test.mjs` immediately before `bundle.test.mjs`, as requested.

5. `scripts/check-package-test-inventory.mjs`
   - Kept both history notes and made the sequence cumulative: `306 -> 307` (auth-invalidation lane), `307 -> 308` (LLP 0258 Phase 2), and `308 -> 310` (LLP 0270 Expo carrier).
   - Set `expectedTotal` to the observed real count, 310.

6. External-bearer outbox composition (`outbox-shared.mjs`, `index.mjs`, and the three stores)
   - An authority generation advance normally leaves every record stamped with its predecessor CAS generation, as the lane requires.
   - Main's external-bearer wiper deliberately preserves unscoped pending custody. To avoid preserving a record that immediately becomes authorization-stale, that caller now explicitly requests `rebaseUnscopedPending` during its unkeyed transition. Only pending records without an authority descriptor, principal scope, or custody lineage are rebased; terminal, quarantined, fenced, and keyed-transition records keep the predecessor generation.
   - The option is forwarded unchanged through main's reader-to-writer request registry on all three carriers. This keeps ordinary/keyed authority advances strict and makes the main carve-out explicit rather than silently applying it to every unkeyed store call.

7. Generated foreground/replay integration (`packages/snapback-client/index.mjs`)
   - Main's valid generated query plans activate the legacy fresh-snapshot replay wake. During the merged run that wake attempted to replay a durable record already owned by the lane's foreground dispatcher, bypassing the foreground admission hook before an authorization root could commit.
   - The legacy replay entry now uses the same `isForegroundReplayEligible` ownership fence as the platform drain. It may drain predecessors, but cannot redeliver the foreground-owned record. This preserves authorization dispatch ordering and made the generated quarantine regression green without weakening its assertion.

8. React TypeScript fixture integration (`packages/snapback-react/exact-result-types.fixture.ts`)
   - Incoming main deletes the old team-chat generated API declaration while the React type fixture still imported it.
   - The fixture now consumes the maintained campfire generated `/rooms/:roomId` two-query route (`liveMessages`, `liveReactions`) and retains the exact two-key negative assertion. No deleted team-chat generated file was resurrected.

## Verification

The initial unqualified client run reached `package.test.mjs` and was refused by the managed filesystem sandbox when the default store tried to create `/Users/ccheever/.snapback/rqs/...lock` (`EPERM`). The supported `SNAPBACK_CLIENT_RQS_DIR` override was then pointed at a fresh writable `/private/tmp` directory; the exact package script passed there.

- Full snapback-client suite (`package.json` test):
  - Command: `cd packages/snapback-client && SNAPBACK_CLIENT_RQS_DIR="$(mktemp -d /private/tmp/snapback-authproto-rqs.XXXXXX)" npm test`
  - Result: PASS, including pretest, all package-declared test files, and the package TypeScript fixtures.
- snapback-react full suite:
  - Command: `cd packages/snapback-react && npm test`
  - Result: PASS, including pretest, all runtime suites, and the package TypeScript fixtures.
- `scripts/check-package-test-inventory.mjs`:
  - Command: `node scripts/check-package-test-inventory.mjs`
  - Result: PASS — `310 declared test files`.
- tsc fixtures (snapback-client):
  - Command: `cd packages/snapback-client && ../../node_modules/.bin/tsc --noEmit --strict --target es2022 --module esnext --moduleResolution bundler exact-reference-types.fixture.ts push-registry-types.fixture.ts auth-identity-types.fixture.ts app-client-types.fixture.ts`
  - Result: PASS.
- tsc fixtures (snapback-react):
  - Command: `cd packages/snapback-react && ../../node_modules/.bin/tsc --noEmit --strict --target es2022 --module esnext --moduleResolution bundler exact-result-types.fixture.ts optimistic-create-types.fixture.ts activity-presence-types.fixture.ts asset-upload-types.fixture.ts media-collection-types.fixture.ts familiar-types.fixture.ts`
  - Result: PASS.
- node --check on the three stores:
  - Command: `node --check packages/snapback-client/rqs-store.mjs && node --check packages/snapback-client/rqs-store-file.mjs && node --check packages/snapback-client/rqs-store-memory.mjs`
  - Result: PASS.
- Focused contract regressions additionally run during reconciliation:
  - `generated-optimistic-default.test.mjs` authorization-quarantine case: PASS.
  - `bearer-rotation.test.mjs`: PASS.
  - `rqs-store.test.mjs`, `rqs-store-file.test.mjs`, and `rqs-store-v3.test.mjs`: PASS.
  - `outbox-drain.test.mjs`: 20/20 PASS.
- Final conflict audit:
  - No conflict markers remain in the five unmerged paths.
  - `git diff --check` passes for every file changed by this resolution.

No push was performed.
