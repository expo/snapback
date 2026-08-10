# Published 0.1.16 runtime packages omit the packaged-store qualification receipt, so no generated app can start

**Status:** Open — blocking; found by the LLP 0176 G4 external rerun against
live 0.1.16
**Impact:** 5
**Urgency:** 5
**Ease:** 2
**Confidence:** 5
**Systems:** Packaging, Publishing, Runtime, Capabilities, Release evidence
**Date:** 2026-08-09
**Related:** [LLP 0176 §G4](../llp/0176-expo-messaging-golden-path.plan.md),
[LLP 0110](../llp/0110-local-persistent-store.plan.md),
[LLP 0041](../llp/0041-packaged-dev-loop.rfc.md),
[G4 rerun lane plan](./20260809-g4-rerun-lane-plan.md),
[G4 external-vector gap](./20260806-guide-gap-g4-live-0110-external-vector.md),
[0.1.16 rerun receipts](../demos/expo-golden-path-fixture/receipts/20260809-g4-external-0116-summary.md)

## Symptom

Any app generated against the published `latest` = 0.1.16 vector refuses to
start its backend. Exit status 5, before any ready file, listener, or Metro
process exists:

```text
Error: SNAPBACK_CAPABILITY_UNSUPPORTED: target does not support required capability single_table_v1
```

Reproduced three times on three machines with the same result — the control
MacBook Pro, the iOS-simulator host `100.72.251.34`, and the Android host
`100.106.94.95`. The supervised form fails identically on both platforms after
`device-selected`:

```json
{"ok":false,"state":"startup-failed","diagnostics":[{"code":"SNAPBACK_DEV_SERVER_START_FAILED","severity":"error","subsystem":"cli","message":"Snapback exited before writing …/.snapback/g4-ios-0116.ready.json","details":{"status":5,"stdout":"","stderr":"Error: SNAPBACK_CAPABILITY_UNSUPPORTED: target does not support required capability single_table_v1\n"}}]}
```

This is not a corner case. Codegen names `single_table_v1` in the node plan of
every ordinary live query, and in `capabilities.required` of the descriptor, so
the refusal blocks effectively every Snapback app — including the one the
guide's own `expo-chat` template produces.

## Exact reproduction

```sh
mkdir /tmp/repro && cd /tmp/repro
npm create -y snapback-app app
cd app && bun install && bun run generate
npx snapback dev snapback --db .snapback/x.sqlite3 --ready-file .snapback/x.ready.json --json
```

## Root cause

`src/manifest.rs` advertises `single_table_v1` only when
`local_persistent_store_publication_v1_verified` holds. For a
`public-package` build (`crate::identity::BUILD_DISTRIBUTION_PUBLIC_PACKAGE`)
that fact additionally requires a **packaged-store qualification receipt**
(`packaged_store_qualification_receipt_is_qualified`), read from the path in
`SNAPBACK_PACKAGED_STORE_QUALIFICATION_RECEIPT`.

`packages/snapback-cli/index.mjs` (`runtimeSpawnEnvironment`) sets that
variable by looking for `packaged-store-qualification.receipt.json`
**immediately adjacent to the runtime binary** — i.e. inside the runtime
package's `bin/` directory — and refuses symlinks or files outside that exact
directory.

The published 0.1.16 runtime packages do not contain that file:

| Package | `bin/snapback` | `bin/packaged-store-qualification.receipt.json` |
| --- | --- | --- |
| `@expo/snapback-runtime-darwin-arm64@0.1.15` | 78,034,480 B | **present**, 2,377 B |
| `@expo/snapback-runtime-darwin-arm64@0.1.16` | 89,627,184 B | **absent** |
| `@expo/snapback-runtime-linux-x64@0.1.15` | present | **present** |
| `@expo/snapback-runtime-linux-x64@0.1.16` | present | **absent** |

Both 0.1.15 rows were read from `npm pack`ed registry tarballs; the 0.1.16
darwin row from an installed external `node_modules`.

**Differential proof.** The identical generated backend, re-pointed at 0.1.15
and regenerated, starts normally and writes `"ready": true` with
`targetProfile: local-dev-sqlite-ibex`. On 0.1.16 it refuses. The regression
belongs to the 0.1.16 cut.

## Why the publication lane did not catch it

The runtime package manifest's `files` list includes the whole `bin` directory,
so the receipt ships whenever it exists at pack time. It is a **generated**
artifact: `scripts/packaged-store-qualification.mjs` produces it and the
qualified-staging lane places it
(`scripts/qualified-staging-store-qualification.mjs`,
`scripts/qualified-staging-assemble`), while
`scripts/qualified-staging-ledger-check.mjs` asserts the packed tarball
contains `package/bin/packaged-store-qualification.receipt.json`.

The **fast-path** publication lane (`scripts/snapback-publish.mjs` /
`snapback-publish-core.mjs`) has no equivalent assertion. Its ledger records
`runtimeBinarySha256` and `files` counts but never requires the receipt. The
0.1.16 lane produced a freshly built runtime binary (note the 78 MB → 89 MB
size change) in a `bin/` directory that had no receipt in it, packed it, and
published a closure that cannot run anything — with every gate green.

*Hypothesis, stated as one:* earlier fast-path cuts likely inherited a receipt
left in `packages/snapback-runtime-*/bin/` by an earlier staging run, which
would make 0.1.12–0.1.15's success partly accidental. That should be confirmed
rather than assumed.

## Not a valid workaround

Copying the 0.1.15 receipt next to the 0.1.16 binary does not work and must not
be suggested to consumers. `packaged_store_qualification_receipt_is_qualified`
binds the receipt to `crateVersion`, `gitCommit`, `gitDirty`, `buildProfile`,
and `buildDistribution`, and cross-checks
`embedded_carrier_sha256` and the package-closure digest. The receipt must be
generated for the exact 0.1.16 binary identity.

## Consumer-facing diagnosability

An external author who hits this cannot self-diagnose. `snapback guide
"SNAPBACK_CAPABILITY_UNSUPPORTED"` answers in 1.3 s but points at
`backend/streamed-actions.md#read-the-refusal-codes`, which is about streamed
actions, and a `single_table_v1` search returns snapshot-batch and live-query
pages. Nothing in the public guide explains that a published runtime may fail
to advertise a capability its own codegen requires. The diagnostic also lists
monorepo source paths (`src/manifest.rs:13440:18`) to a consumer with no
checkout.

## Acceptance

- Publish a successor closure whose runtime packages contain a valid
  `bin/packaged-store-qualification.receipt.json` for that closure's exact
  binary identity, on every published platform.
- Add a fast-path publication gate that refuses to publish a runtime package
  whose packed tarball lacks the receipt, or whose receipt does not qualify
  against the candidate binary identity — the same assertion
  `qualified-staging-ledger-check.mjs` already makes, moved onto the lane that
  actually cut 0.1.16.
- Add a post-publication smoke that scaffolds the published template from the
  registry and starts its backend. A byte-identity ledger cannot detect this
  class of failure; only running the thing can.
- Confirm or refute the inherited-receipt hypothesis for 0.1.12–0.1.15.
- Give the refusal a public-guide destination that names the packaged-runtime
  cause, and stop emitting monorepo source paths to external consumers.
- Rerun the LLP 0176 G4 ceremony from the retained quarry
  (`/Users/ccheever/projects/snapback-g4-external-0116`, archived at
  `~/snapback-release-ledgers/g4-external-0116-quarry-20260809.tar.gz`).
