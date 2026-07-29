## 2026-07-29 — Firebase, Stage 5 final refresh, complete locally (hosted GAP)

### Environment

- Refreshed from coordinator base
  `8cd9e46794038239279587702fb4728e4f2bc589`; the sealed Chat/Firebase
  `work/` and `run-capsule.v1.json` remained unchanged.
- Fresh local Firebase Emulator Suite target
  `llp0102-final-chat-firebase-w2`; no hosted Firebase target was touched.
- Firebase client 12.16.0, Firebase Tools 15.24.0, Firebase Admin 14.2.0,
  Firebase Functions 7.3.2, React 19.1.1, Vite 7.1.4, Node 22.23.1, and
  OpenJDK 21.
- Actual runner: `Charlies-MacBook-Air.local`, Apple M5/arm64, 32 GiB, Darwin
  25.5.0. The frozen performance harness carried stale hardcoded hostname and
  OS labels; `work/receipts/machine-context.json` is the corrective evidence.
- Official Firebase Admin Node release notes were checked on 2026-07-29 to
  confirm the current Node 22 requirement. No community source or human help
  was used.
- The complete authoring clock and tool-call count were not independently
  reconstructed for this inherited refresh, so they must not be presented as
  measured. The final clean in-harness acceptance window was 42.587 seconds;
  offline-browser, export, audit, and cleanup checks followed outside that
  window.
- Attempt 01 was an environment-only Node host mismatch and wrote no provider
  data. Attempt 02 proved the semantics but was invalidated when Firebase Tools
  silently assigned Eventarc and Cloud Tasks to ports 9299 and 9499 outside
  the worker lane. Both attempts received complete local cleanup before the
  fresh final run.

### Milestones

- First local read: 3.745 seconds.
- First authoritative mutation: 4.471 seconds.
- First verified realtime transition: 4.489 seconds.
- Local acceptance: 42.587 seconds.
- Acceptance completion: 42.587 seconds in harness, followed by the separate
  cold-page offline proof and cleanup proof.
- Hosted URL: explicit GAP; no hosted credentials or target were used.

### What felt good

- The Admin 13.5.0 to 14.2.0 and Functions 6.4.0 to 7.3.2 refresh required no
  application-source changes. The existing modular `firebase-admin/app`,
  `firebase-admin/firestore`, and `firebase-functions/v2/https` paths loaded
  and passed unchanged.
- Firebase's primitives were strong where chat needed them: Firestore
  `onSnapshot` delivered authoritative server transitions, Realtime Database
  supplied native typing/presence transport and `onDisconnect`, Auth emulator
  identities exercised real rule decisions, and persistent Firestore cache
  survived a cold page with networking disabled.
- The emulator suite made a fairly broad multi-service backend testable on one
  machine. The hub endpoint was particularly valuable evidence once every
  auxiliary port was made explicit.
- Firestore transactions plus a callable function provided a crisp
  server-authoritative send path. Two-client concurrent sends retained both
  messages and allocated deterministic adjacent sequence numbers.

### What felt bad or frustrating

- A complete chat required coordinating Auth, Firestore, Functions, and
  Realtime Database, with two data models and two policy languages. Firebase
  provides the ingredients, but the application owns the composition.
- Firebase Tools initially selected the host's Node 24 even though the
  functions package requested Node 22. Putting the exact Node binary first on
  `PATH` fixed it, but the first message made version isolation feel less
  deterministic than expected.
- Eventarc and Cloud Tasks appeared in the hub on undocumented-for-this-run
  default ports 9299 and 9499 even though neither was requested in `--only`.
  The final run required explicit auxiliary configuration and expanded
  pre/post port proofs.
- Emulator startup warned that un-emulated services could affect production
  and could not fetch Admin SDK configuration. Those warnings were sensible
  in general but noisy for an intentionally fake, unauthenticated local
  project; target identity and fake configuration had to carry the assurance.
- The production build emitted a roughly 1.13 MB minified JavaScript chunk
  warning.
- The retained npm audits reported 24 root findings (18 high, 6 moderate) and
  13 Functions findings (7 high, 6 moderate), with zero critical findings.
  Several root findings are toolchain/dev-server transitive issues, so this is
  not evidence of an exploited app defect, but it materially lowers
  dependency-hygiene confidence and should remain visible.

### Modeling and correctness

- Channels, nested messages, and per-user read markers fit Firestore naturally.
  A privileged callable function derived the author from verified auth,
  checked membership, generated document identity, and transactionally
  updated `nextSequence` with the new message.
- Stable document-snapshot cursors preserved pagination under a newer insert.
  The two-actor burst had a clear total order with no message loss.
- Direct client writes to messages stayed forbidden. Read-marker writes were
  narrowly shaped in Firestore Rules; typing and presence were separately
  authorized in Realtime Database Rules.
- The hot channel counter is a deliberate scale tradeoff. It was correct for
  the frozen workload, but a production high-volume room would need a
  different ordering/partitioning decision.

### Realtime, offline, and auth

- CHAT-02 used three native Auth emulator principals for positive and negative
  authority checks. Firestore and RTDB listeners were push transports, not
  product polling.
- The offline proof loaded 25 server rows, opened a new page in the same
  persistent browser profile, disabled Firestore networking before installing
  the history listener, and rendered all 25 rows from IndexedDB cache.
- Revocation failed closed for future reads and delivery. Firebase's persistent
  cache still contained data that had previously been authorized. The app
  cleared protected rendered state on auth/listener errors, but clearing SDK
  cache bytes remains an application responsibility and a significant product
  design caveat for sensitive data.

### Deployment and operations

- Local build, emulator startup, hub inspection, data export, and scoped
  cleanup all completed. The final export contained seven files totaling
  150,003 bytes and is represented by per-file SHA-256 evidence.
- Cleanup was target-bound to the exact project identity and validated the
  emulator/Vite process ancestry. Eight owned processes terminated, all ten
  assigned ports plus default-port sentinels 9299/9499 were closed, and the
  project endpoint refused connections afterward.
- Hosted deploy, managed-region behavior, billing, production latency, and
  production restore remain an explicit environment GAP rather than a Firebase
  failure.

### Documentation and diagnostics

- The current modular imports and Node support boundary were discoverable from
  official release material, and runtime errors were generally actionable.
- The emulator hub was the decisive diagnostic for hidden auxiliary bindings.
  The normal ready table listed primary emulators and only some reserved ports,
  so relying on that table alone would have missed the isolation defect.
- The metadata lookup warning during local Admin use was not actionable in this
  fake project, and it obscured an otherwise successful run.

### Glue and workaround inventory

- Authored source: 5 files, 314 lines, 7,826 bytes.
- Test/harness: 8 files, 1,400 lines, 57,362 bytes.
- Configuration: 5 files, 109 lines, 1,953 bytes.
- Policy: 2 files, 75 lines, 2,361 bytes.
- Dependency manifests: 4 files, 15,417 lines, 548,734 bytes.
- Installed dependencies: 521,594,343 bytes.
- Application glue included typing expiry/removal policy on native RTDB
  transport, protected-render clearing after revocation, a transactional
  sequence allocator, cross-product identity/channel projections, and explicit
  auxiliary emulator port/cleanup controls.

### Outcome

- CHAT-01 through CHAT-15: 15 pass, 0 GAP, 0 fail for the fresh local target.
- Hosted target: explicit GAP, with no claim about hosted performance or
  operational equivalence.
- Evidence confidence: 16/16 for the scoped local result. Each of actor
  authority, transaction conflict, transport, offline/reconnect, settlement,
  target identity, cleanup isolation, and artifact reproducibility has direct,
  retained evidence.
- No Stop-class defect was observed. Previously authorized persistent-cache
  retention and the dependency audit are disclosed caveats, not averaged away.

### Would I choose it?

- Conditional yes, with high confidence for this app when Firebase's managed
  platform and multi-product model are acceptable. The decisive reason is that
  auth, push delivery, offline history, transactions, rules, presence, and
  local operations all have mature working paths. The decisive reservations
  are the Firestore/RTDB split, persistent-cache revocation semantics, and the
  amount of dependency and emulator-surface area.

### Lessons for Snapback

- **One coherent realtime model:** Match the end result of reliable messages,
  typing, presence, unread markers, reconnect, and offline history without
  forcing authors to bridge two databases and policy systems. Classification:
  capability/experience; broad reach. Preserve Snapback's coherent authority
  and settlement model. Prove it with the complete frozen Chat suite.
- **Cold-page offline evidence as a first-class workflow:** Firebase's native
  persistent cache made the offline outcome strong. Classification:
  capability/testing; broad local-first reach. Snapback should make cache
  provenance and offline test controls easy to observe and prove.
- **Make revocation/cache semantics explicit:** The user outcome is knowing
  exactly what future access denial does and does not erase locally.
  Classification: correctness/docs. Preserve honest local-first behavior while
  offering a clear protected-data lifecycle and acceptance proof.
- **Expose every local service binding:** The hub eventually revealed hidden
  auxiliary ports, but only after an invalidated run. Classification:
  operations/diagnostics. Snapback should emit a complete machine-readable
  target/service manifest before writes and use it for exact cleanup.
- **Keep server-authoritative mutation compact:** Firebase's callable plus
  transaction was effective, but crossed several APIs. Classification:
  experience. Snapback should retain a single concise authoring path for
  authenticated, transactionally settled mutations with typed results.
- **Treat reproducible target cleanup as product UX:** Identity hashes,
  namespace binding, baseline receipts, export evidence, and ownership-checked
  cleanup should be native outcomes rather than bespoke harness code.
