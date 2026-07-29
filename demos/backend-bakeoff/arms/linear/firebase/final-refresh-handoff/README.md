# Linear / Firebase Stage 5 final refresh

This additive directory prepares the gated Linear/Firebase Stage 5 refresh
without changing the sealed deep-round `work/`, its receipts, or
`run-capsule.v1.json`.

Final status: **complete local refresh with 12 PASS, one explicit GAP, one
unavailable remote dependency, zero FAIL, and no Stop-class defect**.

The prepared project:

- starts from coordinator integration base
  `afdabefbba7106d857c39d05f5cbb2e14babd6a7`;
- upgrades only the requested direct provider dependencies:
  `firebase-admin` 13.5.0 → 14.2.0 and `firebase-functions` 6.4.0 → 7.3.2;
- keeps the official modular imports already used by the arm:
  `firebase-admin/app`, `firebase-admin/firestore`, and
  `firebase-functions/v2/https`;
- changes the Functions runtime declaration from Node.js 20 to Node.js 22,
  because Admin SDK 14 no longer supports Node.js 20;
- preserves the frozen UI, rules, indexes, business functions, scenario IDs,
  dataset, actors, and acceptance assertions;
- binds the future target to `llp0102-final-linear-firebase-w3`; and
- assigns a disjoint ten-port block, including explicit Eventarc and Tasks
  listeners, plus arm-local HOME, XDG, gcloud, npm,
  export, browser, log, and receipt state.

Static installation, the TypeScript/Vite production build, CommonJS syntax,
and Functions module loading passed under both the host Node.js 24.14.0 and an
isolated Node.js 22.23.1 executable. After the provider-order gate opened, the
fresh Local Emulator Suite reproduced all frozen local product facts:

- native Auth authority and outsider refusals;
- indexed reads, cursor pagination, bounded detail composition, optimistic
  metadata, typed transaction conflict, and native push;
- persistent-cache cold boot, queued offline mutation, and exact reconnect
  settlement;
- migration backfill and declared index;
- complete two-warmup plus seven-recorded-sample windows; and
- exact target-bound export and cleanup.

Native full-text search remains the honest Firebase GAP. Hosted deployment
remains unavailable because this arm had no hosted credentials; no hosted
target was mutated. Cleanup closed all ten explicitly assigned ports with no
surviving process.

The first gated run discovered that Firebase Functions silently opened
Eventarc and Tasks on default ports `9299` and `9499`. Those listeners were
exact-process-owned, did not collide, and were cleaned, but they had not been
preassigned. That run is therefore retained as an isolation-discovery attempt,
not the final isolation proof. The final full rerun explicitly preflighted and
bound Eventarc `61121` and Tasks `62121`; see
`isolation-discovery-attempt.md`.

`readiness-checkpoint.v1.json` preserves the pre-release checkpoint.
`run-capsule.v1.json` is the final machine-readable result, while
`sealed-evidence-lineage.v1.json` proves the original arm and failed attempts
remain immutable lineage.

The raw target identity honestly records `sourceDirty: true`: the additive
handoff had not yet been committed when the gated run started. The exact
executed files are retained with before/after hashes in
`copy-transform-manifest.v1.json` and the final tree in
`handoff-inventory.v1.json`; the flag is not rewritten after the fact.
