# Web carrier setup repair — frozen for independent review

Commit `620616271343fb302ede37f45bc285f5e39fb9b5` on `s2/clique-web-carrier-setup`, based on current-origin snapshot `9ec668f6c345954ba474da1bcd1daf20ee54f11d`. Worktree: `/Users/ccheever/projects/snapback-worktrees/clique-web-carrier-setup`. Clean after commit. No push, publication, merge, or benchmark change. Root integrates only after independent review.

## Reproduction and outcome

The exact reported setup spelling, `offline: { store: indexedDbRangeStore, onTombstone }`, reproduces against installed published **snapback2 0.0.15** bytes in headless Chromium on Office. The client constructs and reaches ready. A stubbed successful authentication response then causes login to fail with `E_OFFLINE_CARRIER`, site `RangeStore.open`, inner message **`this.store.open is not a function`**, and the minified-name rewrite `install or configure the Tt2 carrier`.

The same harness against this commit rejects construction immediately with a `TypeError`: `createClient offline.store must return a RangeStore with open(); for IndexedDB, use offline: { store: indexedDbRangeStore() }. See snapback2 guide offline`.

Both arms have real IndexedDB and Web Locks available. Correct setup opens the carrier, holds the exclusive `snapback2:dev:control` Web Lock, calls the custom wrapper factory once across ready/offline, and reads the committed answer after closing and reopening a separate real IndexedDB partition. Deliberately unavailable carrier controls retain the identical `E_OFFLINE_CARRIER` envelope and IndexedDB rewrite. No browser page errors occurred.

This confirms the failure mechanism in a minimal, controlled browser harness with a stubbed authentication response. It does **not** prove that this was the original benchmark application's only failure. That application and its score/audit were not modified, and the blind assertion grader was neither read nor contacted.

## Changes and reconciliation points

- `snapback2/packages/snapback2/src/offline.ts`: internal `InvalidOfflineStoreError extends TypeError` immediately before `OfflineRuntime`; four validation lines immediately after the constructor's existing `this.store = options.store()`. Validate only the minimum `open()` entry point, structurally, from that one result. No built-in brand, object-only restriction, factory reinvocation, carrier opening, or memory fallback is introduced. Full custom-carrier behavior remains the RangeStore contract; this is not a deep interface validator.
- `snapback2/packages/snapback2/src/client.ts`: import the internal marker error and rethrow only that type in the existing createOfflineRuntime catch. Factory-thrown ordinary TypeErrors keep their existing refusal wrapping, as do explicit carrier refusals. This is the only client constructor hunk.
- `snapback2/packages/snapback2/tests/offline-store.test.ts`: 65 lines in the existing test file. Mistaken builder; undefined/null/primitive/object/non-callable-open/promise/nested-factory results; synchronous refusal before auth/I/O; once-only invocation; unbranded inherited-method and callable custom stores; throwing Error/TypeError factories; explicit carrier errors; unavailable IndexedDB/Web Locks. Existing carrier-open and other offline store tests retained.
- `snapback2/packages/snapback2/guide/offline.md`: a JavaScript browser setup example with the correct imports and `indexedDbRangeStore()` call, the custom-factory return contract, and explicit IndexedDB/Web Locks requirement. Existing facts/examples are preserved.
- `snapback2/packages/snapback2/build.mjs`: only the existing offline page's byte limit changes from **4,352 to 4,864**. Root explicitly authorized this 512-byte increase after confirming the page was already full. Actual before/after page bytes: **4,352 → 4,784** (+432). No unrelated bundle-size or benchmark budget changes. Independent reviewers should assess whether the added setup guidance earns this increase.

The preserved suggested `clique-client-sessions` lane had six unmerged commits and active owner processes; it was not reused or modified. No unrelated redesign/search lane was read or merged. The patch can be reviewed as `git show 620616271343fb302ede37f45bc285f5e39fb9b5` or the retained `final-change.diff`.

## Verification

- Published identity: fetched npm's 0.0.15 metadata and tarball, checked SHA-512 integrity, then compared the six actual consumed client/React bundles, source maps, and served offline guide byte-for-byte. `published-identity.json` records the exact source hashes and integrity. The supplied original source commit is `78924a1e7286907d2378221902ec22747e7d188f`.
- Baseline regression: new targeted tests **2 passed, 1 failed** because the expected setup exception was absent. Original failure retained in `baseline-regression.log`.
- Final package build: `node build.mjs`, passed; includes existing package declaration and guide validation. `final-build.log` is empty on success.
- Final affected suite: `node --test --test-timeout=30000 tests/offline-store.test.ts`, **35/35 passed**, 2.416 seconds. `final-offline-store.log`.
- Final matched browser harness: `published-final-reproduction.json` and `candidate-final-reproduction.json`, all explicit before/after comparisons passed (`outcome-assertions.json`). Earlier published reproduction and its bundle remain preserved separately.
- `node scripts/caps.mjs`: all seven categories passed. `./ref-check --verbose`: 412 LLP documents, 7,763 references, zero errors/unchecked. `git diff --check`: passed.

The first harness build lacked the React peer in the preserved registry-installed consumer; the harness uses the lane's locked React 19.1.0 via an explicit bundler alias. A later candidate harness build attempted to resolve optional native modules installed in the development tree; the harness leaves `expo-file-system` and `expo/fetch` external, matching package-build treatment. Both failures happened before browser/product execution, required no product repair, and are retained in `initial-harness-failure.txt` and `candidate-harness-native-resolution-failure.log`. The final two arms use the same harness configuration. This is a carrier setup check, not an assertion about arbitrary application bundler configurations.

## Boundaries and custody

No Rust/native build, engine change, authorization change, asset lifecycle change, SSE worker probe, maintained-pricing/compiler change or probe, new gate/registry, or original benchmark mutation. Normal package build bundled the existing compiler as part of the established build; no compiler behavior was exercised. No M5 contact.

This does not qualify physical process-kill durability, pending writes/replay, the offline bar, Expo/native behavior, or the original benchmark's end-to-end behavior. Real IndexedDB close/reopen here is a bounded setup control, not the LLP1012 §10 durability witness. The validation intentionally checks callable `open()` only and leaves deeper carrier contract failures to existing runtime behavior. No LLP contract change is proposed; LLP1012 §15 already specifies TypeError for bad options.

Office identity, node/browser executable/version, source hashes, launch PIDs, port, and teardown are retained in the final launch/reproduction JSON and `source-manifest.json`. Browser/control servers used port 52900 after checking 52900–52919. All recorded helper/browser processes exited and the entire range has no listeners (`cleanup.json`). Only owned processes were closed.

Implementation and evidence are frozen at the commit above; independent review is pending.
