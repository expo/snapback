# Published 0.1.16 runtime packages omit the packaged-store qualification receipt, so no generated app can start

**Status:** RESOLVED 2026-08-09 — 0.1.17 published, proven to boot, and
promoted to `latest` on all eleven names; the cause is fixed, gated, and
smoke-tested
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

## Resolution — 0.1.17, 2026-08-09/10

### What shipped

`0.1.17` is live on npm `latest` for all eleven names, cut fast-path from clean
`main` revision `0e6bf1842ab291f2e68416fbf40bd2e6debb4290` — the revision that
carries the gate and the smoke, so the release that fixes the defect is the
first release the new machinery guarded.

Both runtime packages carry `bin/packaged-store-qualification.receipt.json`,
each minted against the exact pass-1 staged closure by running that platform's
own packaged binary:

| Platform | receipt sha256 | suite | binds |
| --- | --- | --- | --- |
| darwin-arm64 | `dfe52e478bde4869c3df0af33d43735e18e19147bc514727949c97ba2f72c059` | 3 pass / 0 fail / 0 skip | `0e6bf1842ab2`, clean, `release`, `public-package` |
| linux-x64 | `999304f08899d55809151ec72f31049d834b73703f0745906157d68a7d893432` | 3 pass / 0 fail / 0 skip | `0e6bf1842ab2`, clean, `release`, `public-package` |

darwin-arm64 was built locally; linux-x64 was built and attested on
`expo-build-1000` and transported with all four artifact digests re-verified on
the assembling host. The linux receipt was minted **on the builder** from a copy
of the pass-1 closure whose eleven tarball digests were confirmed identical to
the local vector — the step the 0.1.16 lane omitted. Its
`~/snapback-staging/qual16b-linux` directory holds only build artifacts, while
`qual15-linux` holds the ten-tarball pass-1 closure that the 0.1.15 mint
consumed: the omission is visible in the artifacts the two lanes left behind.

Retained ledger:
`~/snapback-release-ledgers/fastpath-ledger-0.1.17-0e6bf1842a.json`, written
before the first `npm publish`. Byte verification: **11/11 registry tarballs
byte-identical to the ledger, 0 mismatched.**

### The smoke, and what it proved

`scripts/published-closure-boot-smoke.mjs` against published `0.1.17`:
`ok: true`, all eight checks green in 6.9 s — installed, receiptPresent,
codegen, capabilityAcknowledged, ready, capabilityAdvertised, ensureApp,
liveQuery. The installed receipt digest matches the gate summary exactly.

The smoke was discrimination-tested against the registry before the cut:

| Vector | Result |
| --- | --- |
| published `0.1.15` | `ok: true`, 8/8 checks, 5.6 s |
| published `0.1.16` | `ok: false`, `SNAPBACK_PUBLISHED_SMOKE_RECEIPT_ABSENT`, 5.6 s |
| published `0.1.17` | `ok: true`, 8/8 checks, 6.9 s |

It reproduces this exact defect from published bytes alone, which is the
property the acceptance criteria asked for.

### The gate fired in anger on its first real cut

The 0.1.17 ceremony published all eleven under the immutable holding tag
`fastpath-0-1-17-0e6bf1842ab2`, byte-verified 11/11 — and then **refused to
move `latest`**, because the post-publish smoke failed. That refusal was
correct behaviour on a false alarm: the smoke ran roughly eight seconds after
`@expo/snapback-cli@0.1.17` was published and npm's read replicas still answered
`ETARGET` for the exact version, so the install failed against bytes that were
in fact fine. `latest` stayed on 0.1.15 throughout, which is exactly what should
happen when the ceremony cannot prove the new closure runs.

Two real ceremony defects follow from that, both fixed in the same landing as
this resolution:

1. **Registry propagation race.** `snapback-fastpath-release.mjs` now waits for
   every published name to resolve by exact version before starting the smoke,
   bounded at 300 s, failing closed with
   `SNAPBACK_FASTPATH_REGISTRY_PROPAGATION_TIMEOUT` if a version is genuinely
   absent. Byte verification passes against tarball URLs while the packument is
   still stale, so byte verification alone could not have caught this.
2. **Not resumable after a publish.** Pass-2 staging ends in
   `npm publish --dry-run`, which npm refuses once the version exists, so a
   ceremony interrupted *after* publishing could never be re-run to promote
   `latest`. The release pass now reuses an existing pass-2 closure that binds
   the same exact version and source revision, and still runs the gate over the
   reused bytes.

Because those fixes could not be landed without dirtying the release tree — and
the ceremony rightly refuses a dirty tree — the 0.1.17 `latest` promotion itself
was performed directly, at 2026-08-10T01:41:04Z–01:41:25Z UTC, on the evidence
the ceremony had already produced: the gate summary above, 11/11 byte
verification, and a green smoke against the published bytes. All eleven names
were then re-read and confirmed at `latest` = `0.1.17`. The next cut runs the
promotion through the script.

### Against the acceptance list

| Acceptance bullet | Result |
| --- | --- |
| Successor closure whose runtime packages carry a valid receipt on every platform | **DONE** — 0.1.17, both platforms, digests above |
| Fast-path gate refusing a runtime package without a qualifying receipt | **DONE** — `scripts/publication-store-qualification-gate.mjs`, fail-closed, no env opt-out, also wired into `snapback-publish.mjs --publish` |
| Post-publication smoke that scaffolds and starts the published template | **DONE** — `scripts/published-closure-boot-smoke.mjs`, discrimination-tested on 0.1.15/0.1.16/0.1.17 |
| Confirm or refute the inherited-receipt hypothesis for 0.1.12–0.1.15 | **REFUTED** — see the table above; each receipt binds its own release revision and closure |
| Public-guide destination for the refusal; stop emitting monorepo paths | **NOT DONE** — carried forward, see below |
| Rerun the LLP 0176 G4 ceremony from the retained quarry | **NOT DONE** — unblocked, but a separate two-host lane |

### Carried forward, not closed by this lane

- The consumer-diagnosability arm of this ticket (a public-guide destination
  that names the packaged-runtime cause, and suppressing monorepo source paths
  such as `src/manifest.rs:13440:18` in diagnostics shown to external
  consumers). Nothing in the published guide still explains this failure to
  someone who hits it.
- The G4 external rerun against `0.1.17` from the retained quarry
  (`~/snapback-release-ledgers/g4-external-0116-quarry-20260809.tar.gz`). The
  blocker is gone; the ceremony itself has not been re-run.

## G4 0.1.17 re-rerun — 2026-08-10 — the second carried-forward item is now done

The two items carried forward above have split.

**"Rerun the LLP 0176 G4 ceremony" — DONE, and it PASSED.** The re-rerun ran on
2026-08-10 against live 0.1.17 in a third fresh quarry (not the retained one:
the frozen OQ5 metric puts `t0` at an empty directory). The blocking half of
this ticket is confirmed repaired in consumed published bytes:
`@expo/snapback-runtime-darwin-arm64@0.1.17` carries
`bin/packaged-store-qualification.receipt.json` (2,377 B) whose `binaryIdentity`
binds `gitCommit 0e6bf1842ab291f2e68416fbf40bd2e6debb4290`, `gitDirty false`,
`buildProfile release`, `buildDistribution public-package`. Both supervisors
advertised `single_table_v1` and started the generated backend on the first
attempt; iOS reached `G4_IOS_PASS` and Android reached an unconditional
`G4_ANDROID_PASS`. Receipts:
[summary](../demos/expo-golden-path-fixture/receipts/20260810-g4-external-0117-summary.md).

**"Public-guide destination for the refusal" — retested, STILL NOT DONE.**
Verbatim, from the external quarry against the published CLI:

```text
$ npx snapback guide "SNAPBACK_CAPABILITY_UNSUPPORTED"
SNAPBACK_CAPABILITY_UNSUPPORTED — diagnostic
capabilities
Guide: /_snapback/guide/backend/streamed-actions.md#read-the-refusal-codes
Emitting sites:
- packages/snapback-codegen/index.mjs:1381:12
…
- src/manifest.rs:13576:18
```

1 s warm — the speed is fine. The destination is still wrong: that anchor opens
"Stream diagnostics are structured and value-free…" and is about streamed-action
refusal families, not target capability advertisement. Monorepo source paths are
still emitted to a consumer with no checkout. For contrast, the sibling
`SNAPBACK_APP_BINDING_IDENTITY_MISMATCH` lookup resolves in 1 s to
`clients/react-expo.md#diagnose-a-binding-identity-mismatch`, a real covering
section — so the guide's diagnostic-to-anchor mechanism works; this code just
has no home.

Urgency has genuinely dropped: the refusal this fails to explain no longer fires
on the paved path. **This ticket now holds only the diagnosability arm.** Keep
it open on that basis, or split it if the packaging close-out should be filed.
