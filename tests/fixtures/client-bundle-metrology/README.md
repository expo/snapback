# Client bundle metrology fixtures

`profiles.v1.json` is the frozen source inventory for LLP 0145 Phase A. The
runner adds one namespace fixture for every public JavaScript subpath in
`packages/snapback-client/package.json`, so a new export cannot silently escape
the bundle ratchet.

Run the gate with:

```sh
volta run node scripts/client-bundle-metrology.mjs --check
```

When the environment cannot run listener-bound behavior commands, the
comparison-only diagnostic still measures every profile, validates the active
baseline chain, checks the committed current report, and skips only the
behavior train:

```sh
node scripts/client-bundle-metrology.mjs --check-comparison-only
```

Comparison-only success is not a substitute for `--check`; it exists so a
restricted sandbox can prove the byte ratchet before the socket-capable
orchestrator runs the complete gate.

The runner uses esbuild's browser/ES2022 ESM pipeline with minification and
tree-shaking, gzip level 9, and Brotli quality 11. It executes each emitted
bundle's fixture assertion, runs the maintained client/React package smoke
tests, and compares current raw/minified/compressed bytes with the committed
first-run ceilings in `baseline.v1.json`. `current.v1.json` is a deterministic
attribution ledger: bundle totals, package totals, and module-own bytes.

The baseline is immutable under LLP 0063's valid-baseline rule. A proven
instrument defect or unavailable instrument requires the versioned retirement
procedure in that LLP; ordinary optimization updates only `current.v1.json`.

New public capabilities join prospectively through versioned supplemental
ledgers rather than rewriting `baseline.v1.json`. Each ledger declares an exact
profile-id set, profile-source digest, behavior command, governing LLP anchors,
and the already-committed source revision whose first run froze its ceilings.
The runner validates all supplemental ledgers independently, rejects duplicate
profile ownership, and folds their measurements into `current.v1.json`.

The first extension is `baseline.push-registry.v1.json`, backed by
`push-registry-profiles.v1.json`. It measures the explicit push subpath and
attachment closure plus a root-negative fixture that proves the ordinary root
namespace and client instance remain push-free. To add a future versioned
ledger, declare its profile file and exact ids in the runner, commit the
implementation and instrument first, then run:

```sh
volta run node scripts/client-bundle-metrology.mjs --write-supplemental-baseline
```

The command refuses unless exactly one declared ledger is missing and every
existing primary/supplemental ceiling is still valid.

When a landed specification deliberately evolves an existing measured
workload, use a declared workload-version rollover instead. A rollover names
the exact predecessor profile ids it supersedes and binds the complete,
unchanged predecessor receipt by SHA-256. Profiles outside that declaration
continue to compare against their historical ceilings; the predecessor file is
never rewritten. Commit the implementation, instrument declaration, profile
inventory, and governing LLP amendment first, then run:

```sh
volta run node scripts/client-bundle-metrology.mjs --write-rollover-baseline
```

The command refuses unless exactly one rollover is missing, every unaffected
historical ceiling is still valid, and the profiles left without active
ceilings are exactly the rollover's declared set. The LLP 0166 local persistent
store is the first such workload version; its declarative inventory lives in
`local-persistent-store-profiles.v1.json` and its frozen receipt lives in
`baseline.local-persistent-store.v1.json`.

Move 3's local-read-admission workload is the next rollover, followed by the
generated-mutation-IR workload that changed the shipped Full/root closures at
the M4 exit. Their declarative inventories are
`local-read-admission-profiles.v1.json` and
`generated-mutation-ir-profiles.v1.json`; each receipt retains its complete
predecessor by digest rather than rewriting an earlier ceiling.

The typed offline-unavailable refusal that implements LLP 0166 D4 changes
only the Full/root profiles that contain the public client entry. Its
`offline-unavailable-profiles.v1.json` declaration rolls those exact profiles
forward from the generated-mutation-IR receipt; the M4-only and unaffected
ceilings remain active.

The LLP 0093/0094 finite-carrier completeness implementation then adds client
proof verification to those same Full/root closures and to the public
materialization-store subpath. Its
`finite-carrier-completeness-profiles.v1.json` declaration rolls the shared
closures forward from the offline-unavailable receipt and the store-only
closure forward from the local-read-admission receipt. Both predecessors stay
immutable and independently provenance-valid.

The rowless token-resume ordering rollover then advances the Full/root closure
set from the finite-carrier receipt while leaving its materialization-store-only
row active. The final `move3-single-table-lifecycle.v1` rollover composes the
latest active rows from that chain: rowless resume, generated mutation IR,
local-read admission, finite-carrier materialization, and the primary
agent-authority profile. Its receipt records an exact before/after metric row
for all 27 superseded profiles; no predecessor receipt is rewritten.

The IR-evaluator extension is also retained independently as
`baseline.ir-evaluator.v1.json`, backed by
`ir-evaluator-profiles.v1.json`. Main's local-read-admission rollover froze
the same profile bytes in parallel, so the runner verifies the two records are
byte-identical and treats the landed rollover as the active ceiling while
preserving the supplemental receipt. Both that ledger and the final chained
rollover pin Node 24.18.0; metrology write and check invocations therefore use
`volta run node`.

The dated 2026-08-04 integrated-review follow-up is a chained, one-profile
rollover in `baseline.local-persistent-store-review-fixes.v1.json`. It keeps
the complete LLP 0166 v1 receipt immutable and supersedes only
`public-subpath-rqs-preload`: findings 6 and 9 add the legacy no-op guard and
typed optional-runtime load failure, moving the profile from 5,505 / 2,555 /
2,147 to 5,549 / 2,593 / 2,177 minified / gzip / Brotli bytes. Finding 3
changes `public-subpath-rqs-registered` while its supplemental ledger is still
part of the same uncommitted finish-out diff, so
`baseline.result-transform.v1.json` records the dated in-place amendment from
31,913 / 10,621 / 9,341 to 32,045 / 10,647 / 9,380. Every other active ceiling
continues to come from its prior receipt unchanged.

The OQ2 extension is `baseline.push-installation-expo.v1.json`, backed by
`push-installation-expo-profiles.v1.json`. It freezes the optional Expo
installation-storage subpath independently, including a closure assertion that
the adapter does not pull the push-registry runtime or a native module into the
bundle.

The LLP 0166 finish-out extension is `baseline.result-transform.v1.json`,
backed by `result-transform-profiles.v1.json`. It freezes the newly public pure
evaluator subpath and Lane E's opt-in `./rqs-registered` mixed-route validator
entry independently, recording both complete closures plus module-own
attribution on their first shipping run. The historical `./rqs-preload`
ceiling remains unchanged: registration-record derivation belongs to the
ledger/store family, and mixed-route validation is paid only by callers that
select the new entry. The same first-run ledger absorbs the previously
uncovered `./ir-evaluator`, `./local-read-admission`, and
`./optimistic-rebase` namespace profiles; those are prospective first-run
ceilings, not edits to a historical receipt. Its behavior train runs each
corresponding focused suite before the ledger can freeze.

The LLP 0163 operation-identity carrier rollover is
`baseline.operation-identity-carrier.v1.json`, declared by
`operation-identity-carrier-profiles.v1.json`. It advances exactly the shared
outbox, four RQS-store closures, and the opt-in registered-RQS closure for
authenticated finite-range custody and durable `result-gone` settlement. The
Move-3 and result-transform predecessors remain immutable. The unrelated asset
closure stays governed by its original primary ceiling and is tightened back
under that ceiling rather than rolled into LLP 0163.

The 2026-08-06 completed-main batch is
`baseline.aug6-client-capabilities.v1.json`, declared by
`aug6-client-capabilities-profiles.v1.json`. It advances exactly eight
closures in two attributed groups: six shared-outbox/RQS profiles for the
IndexedDB writer-election repair and LLP 0081 tombstone-and-re-entry custody,
and two React application profiles for LLP 0179 S1's conversation surface.
The receipt binds all three predecessor ledgers independently and runs the
focused behavior train for both groups; no unrelated ceiling is superseded.
The train materializes the ignored Expo golden-path descriptor through the
normal code generator before running the surface behavior suite, so a clean
checkout exercises the same generated input rather than depending on local
cache state.

Rollover writes follow a two-commit protocol: first commit the implementation,
instrument declaration, profile inventory, and authorities; then mint and
commit the receipt. The writer's same-process final self-check binds the one
just-written receipt to that exact committed `HEAD`. Subsequent checks admit no
override and require exactly one reachable Git introduction for every ledger.

The Phase-B Micro extension is `baseline.micro-phase-b.v1.json`, backed by
`micro-phase-b-profiles.v1.json`. It freezes separate generated core and live
closures, the three public experimental subpaths, and a root/`./online`
negative. The profile file also reserves the Phase-C/D sessions, React,
browser, Expo/Metro, and complete-application rows as explicitly
`not-implemented`; they gain first-run ledgers only when those later phases
exist, so this local-dev evidence cannot be mistaken for carrier or capability
proof.

## Relationship to the Workstream 8 instrument

This is a package-closure extension of LLP 0063 Workstream 8, not a competing
budget authority. `demos/partiful-matrix/shared/vite-cost-attribution.mjs`
owns the four-layer, per-application Vite ledger used by the Partitime matrix.
This separate runner is warranted because a public package ratchet must also
discover every export-map subpath, retain esbuild's module-own metafile bytes,
and record gzip and Brotli closures without depending on one demo's imports.
The ledgers align at the stable boundaries: Snapback client/contract modules
are provider runtime, the generated fixture entry is application code, and
external framework dependencies remain separately named packages. The package
ledger is deliberately more granular; it does not replace or weaken the WS8
four-layer application ledger.

`baseline.v1.json` was generated from revision
`f3ceb9258c4c1fe757bf59e5fa7150886ec5edc1` before any PKG-01 experiment.
That commit and the exact client/contract/React package tree objects are
recorded and re-verified by the runner; its profile sources, root `bun.lock`,
esbuild version, minifier settings, and compression settings are digest-bound
in the receipt. The retained `current.v1.json` is the first no-change witness
against that frozen baseline; future optimizations update only the current
receipt and never rewrite the baseline.

## Behavioral and carrier proof

Every esbuild byte profile executes its emitted bundle assertion, then the
runner executes the maintained client, browser-closure, and React package
behavior smokes. The heavier release-carrier witnesses stay in their existing
maintained homes instead of being copied into this fast ratchet:

- `scripts/snapback-package-cold-install.mjs` installs materialized package
  tarballs in fresh React and Expo projects, runs the web app's real-browser
  live acceptance, and runs `expo export --platform ios` through Metro.
- `demos/pocketbase-snapback-bakeoff/snapback-incident-room` is the retained
  complete external-package application behind LLP 0145's application row.
  Its lock pins the public `0.1.8` packages and its `generate`, `build`,
  `test`, and `test:live` commands are the behavioral acceptance for that
  immutable comparison receipt.

Gate 13's relative rule remains preregistered by LLP 0145 D-B: a future Micro
candidate's reconnect bytes, reconnect latency, and startup must each be no
worse than Full on the same workload. This Full-only metrology does not invent
a Micro result or claim that comparison passed; PKG-02 must execute and retain
the paired operational workload when the Micro runtime exists.
