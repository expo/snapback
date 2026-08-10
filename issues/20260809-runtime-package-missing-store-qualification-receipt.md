# Published 0.1.16 runtime packages omit the packaged-store qualification receipt, so no generated app can start

**Status:** Open — **MITIGATED on npm 2026-08-10T00:14Z** by rolling `latest`
back to 0.1.15 on all eleven names (see "Mitigation" below); the underlying
packaging defect is still open and closes only with a 0.1.17 successor
closure, the publication gate, and the post-publish smoke
**Found by:** the LLP 0176 G4 external rerun against live 0.1.16
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

## Mitigation — npm `latest` rolled back to 0.1.15, 2026-08-10T00:14Z

Before any diagnosis or repair, the release-repair session moved the npm
`latest` dist-tag off the broken 0.1.16 closure and back onto 0.1.15 for **all
eleven** package names, so that a fresh `npm create snapback-app` resolves a
closure that actually starts.

- **Started:** 2026-08-10T00:14:33Z · **Finished:** 2026-08-10T00:14:44Z (UTC)
- **Command form:** `npm dist-tag add <name>@0.1.15 latest`, run once per name
- **Verified:** `npm view <name> dist-tags.latest` returned `0.1.15` for
  11/11 names immediately afterwards.

| Package | `latest` before | `latest` after |
| --- | --- | --- |
| `@expo/snapback-runtime-darwin-arm64` | 0.1.16 | 0.1.15 |
| `@expo/snapback-runtime-linux-x64` | 0.1.16 | 0.1.15 |
| `@expo/snapback-contract` | 0.1.16 | 0.1.15 |
| `@expo/snapback-client` | 0.1.16 | 0.1.15 |
| `@expo/snapback-codegen` | 0.1.16 | 0.1.15 |
| `@expo/snapback-react` | 0.1.16 | 0.1.15 |
| `@expo/snapback-expo` | 0.1.16 | 0.1.15 |
| `@expo/snapback-app-cli` | 0.1.16 | 0.1.15 |
| `@expo/snapback-cli` | 0.1.16 | 0.1.15 |
| `@expo/snapback-vite` | 0.1.16 | 0.1.15 |
| `create-snapback-app` | 0.1.16 | 0.1.15 |

The ladder was kept consistent: no mixed-version `latest` was left in place at
any point beyond the eleven-second window of the loop itself.

**Nothing was unpublished.** The 0.1.16 versions remain resolvable by exact
version for forensics and for the retained ledger's byte-verification claim;
only the mutable tag moved. The immutable `bakeoff-0-1-7-fdd49db8abf1` and
`bakeoff-0-1-14-fc88615895cb` tags were not touched.

`latest` returns to a Snapback closure at **0.1.17**, the successor cut that
carries the receipt, the publication gate, and the post-publish boot smoke
described under "Acceptance". Until then, 0.1.15 is the supported vector and
0.1.16 must not be recommended to anyone.

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

## Exact cause — 2026-08-09, confirmed; and the hypothesis refuted

### The silent no-op

`scripts/runtime-package-authority.mjs`
(`installPackagedStoreQualificationReceipt`) is the single seam that places the
receipt into a runtime package's `bin/`. It takes the receipt from one of two
sources:

1. an **explicit** per-platform environment path —
   `SNAPBACK_PACKAGED_STORE_QUALIFICATION_RECEIPT_FILE` for darwin,
   `SNAPBACK_RUNTIME_LINUX_X64_QUALIFICATION_RECEIPT` for linux; or
2. the **sibling** file `packaged-store-qualification.receipt.json` sitting
   next to the *source* runtime binary being staged.

If neither variable is set and no sibling exists, it does this:

```js
if (!explicit && !existsSync(source)) return null;
```

It returns `null`. Both `packages/snapback-runtime-*/prepare-runtime.mjs`
call it inside a `try` that only reacts to a thrown error, so `null` is
indistinguishable from success. Preparation continues, `produceRuntimePackageSeal`
seals a `bin/` that has a binary and no receipt, the package packs cleanly, and
every downstream fast-path assertion passes because none of them looks for the
file. Note also that `prepare-runtime.mjs` begins with
`rmSync(binDirectory, { recursive: true, force: true })`, so a receipt cannot
survive in the *package* `bin/` between cuts — only next to the source binary.

### Why 0.1.16 hit it and 0.1.12–0.1.15 did not

Minting the receipt is a genuinely two-pass operation: the receipt binds the
staged package closure's own tarball digests, so pass one must stage a
deliberately receiptless closure, the qualification suite runs the *packaged*
binary against that closure and mints a receipt beside it, and pass two
restages with the receipt wired in. The qualified-staging lane automates this
(`scripts/qualified-staging-assemble` plus
`scripts/qualified-staging-store-qualification.mjs`, added by
`issues/20260807-qualified-staging-missing-store-receipts.md`).

**The fast path never automated it.** As that earlier ticket records in its own
words, the published closures "used the manual per-platform mint and restage
path that the qualified-staging workflow lacked." The fast-path ceremony
therefore depended on the operator remembering an undocumented, ungated manual
step. The 0.1.16 lane — which rebuilt darwin locally and linux on
`expo-build-1000` — did not perform it. Its execution record in
`issues/closed/20260808-0116-rapid-publication.md` names every gate it ran and
does not mention packaged-store qualification at all.

So the cause is not a copy that dropped a sidecar, and not a rebuild that
clobbered one. It is: **a required generated artifact was produced by an
unenforced manual step, and the one lane that actually cuts releases had no
gate that would notice its absence.**

### The inherited-receipt hypothesis is REFUTED

Every prior fast-path cut's receipt was minted for its own revision and its own
closure, read straight from the published registry tarballs:

| Package/version | receipt `binaryIdentity.gitCommit` | receipt `date` | closure versions |
| --- | --- | --- | --- |
| `runtime-darwin-arm64@0.1.12` | `fad3d53922e9` | 2026-08-07 | 0.1.12 |
| `runtime-linux-x64@0.1.12` | `fad3d53922e9` | 2026-08-07 | 0.1.12 |
| `runtime-darwin-arm64@0.1.13` | `b975f003bc7e` | 2026-08-07 | 0.1.13 |
| `runtime-linux-x64@0.1.13` | `b975f003bc7e` | 2026-08-07 | 0.1.13 |
| `runtime-darwin-arm64@0.1.15` | `d8d16068f00b` | 2026-08-08 | 0.1.15 |
| `runtime-linux-x64@0.1.15` | `d8d16068f00b` | 2026-08-08 | 0.1.15 |

Each `gitCommit` equals that release's own retained-ledger `revision`, and each
`packageClosure` lists only that release's versions. A stale inherited receipt
would carry an older commit and an older closure, and would in any case be
rejected at runtime by the identity bind. 0.1.12–0.1.15 succeeded because their
operators really did run the mint; they were not accidentally lucky. That makes
the defect a pure process-enforcement gap, which is exactly the kind a gate
fixes.

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
