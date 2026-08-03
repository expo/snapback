# Client bundle metrology fixtures

`profiles.v1.json` is the frozen source inventory for LLP 0145 Phase A. The
runner adds one namespace fixture for every public JavaScript subpath in
`packages/snapback-client/package.json`, so a new export cannot silently escape
the bundle ratchet.

Run the gate with:

```sh
node scripts/client-bundle-metrology.mjs --check
```

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
node scripts/client-bundle-metrology.mjs --write-supplemental-baseline
```

The command refuses unless exactly one declared ledger is missing and every
existing primary/supplemental ceiling is still valid.

The OQ2 extension is `baseline.push-installation-expo.v1.json`, backed by
`push-installation-expo-profiles.v1.json`. It freezes the optional Expo
installation-storage subpath independently, including a closure assertion that
the adapter does not pull the push-registry runtime or a native module into the
bundle.

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
