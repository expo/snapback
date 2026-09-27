# Lane LX — Linux npm platform artifact (2026-09-27)

Implementation of LLP 3000.021 §3.3 on `sb4-intent/lx-linux-package`, based
on `3a1f8b55d`. No push, package publication, registry login, runtime rule,
disclosure, durability or meter change. The release version remains 0.4.4
in this lane; integration owns the coordinated 0.4.5 bump.

**Round-0 qualification limitation (resolved in Round 1 below):** this host has no usable Docker or Podman.
The required real Ubuntu 22.04/Alpine proof has not passed. The script
refuses before writing a receipt; a host-only smoke test is not a substitute.

## Files

| File (under `snapback4/`, except LLP) | Change |
| --- | --- |
| `packages/snapback4-linux-x64/package.json` | Linux/x64 optional binary package at the common version. |
| `packages/snapback4-linux-x64/THIRD-PARTY-NOTICES` | Sibling tiny_http notice and statically linked musl notice. |
| `packages/snapback4/package.json` | Adds matching `snapback4-linux-x64` optional dependency. |
| `bun.lock` | Records the workspace package and optional dependency. |
| `packages/snapback4/src/resolve-binary.ts` | Names both shipped targets in the refusal; preserves override and checkout search. |
| `scripts/install-linux-musl.sh` | Checksum-pinned musl 1.2.5, explicit x64 GCC, user-local prefix/syslibdir, Rust target installation. |
| `scripts/build-linux-musl.sh` | Bundled SQLite through musl-gcc; unchanged SQLite flag; explicit static CRT/relocation; ELF check. |
| `scripts/check-elf.mjs` | Parses actual ELF64 headers; refuses wrong architecture, malformed headers, PT_INTERP and DT_NEEDED. |
| `scripts/publication-artifacts.mjs` | Artifact/SRI/hash helpers, packed manifest inspection, clean source and Linux receipt validation, credential refusal. |
| `scripts/prepare-client.mjs` | Rebuild wasm, remove/rebuild dist, pack once, inspect exact optional dependencies, retain preparation receipt. |
| `scripts/publish.mjs` | Prepare/import options, per-artifact format-3 stages, format-2 compatibility, digest checks, only Darwin qualification, preflight all registry integrities, platform-first publication. |
| `scripts/publication-consumer.mjs` | Existing Darwin installed signature/hash, React typecheck and mock tests; real round trip added. |
| `scripts/publication-roundtrip.mjs` | Runs outside the checkout: npx version/init/check, dev, real client write/read and cross-persona denied read. |
| `scripts/publication-registry.mjs` | Existing integrity convergence and registry propagation waiting extracted unchanged. |
| `scripts/qualify-linux.mjs` | Token refusal, source suite, musl platform pack, pinned-Node Ubuntu/Alpine proofs, success-only digest receipt. No client packing, signing or registry publishing. |
| `packages/snapback4/test/helpers/publish-fixture.mjs` | Disposable publication tree and fake Cargo/npm/Apple commands shared by tests. |
| `packages/snapback4/test/publish-signing.test.mjs` | Retains 24 signing/resume cases; assertions now allow the client to pack before Darwin signing and require platform packing after signing. |
| `packages/snapback4/test/publish-linux.test.mjs` | 34 cases: single preparation, import, platform-first order, resume, every receipt mismatch, changed bytes/receipt, all-artifact registry preflight, manifest exactness, clean source and legacy resumes. |
| `packages/snapback4/test/linux-package.test.mjs` | 4 cases: ELF controls, metadata/version alignment, resolver precedence, empty/nonempty credential refusal. |
| `packages/snapback4/test/qualify-linux.test.mjs` | 5 cases: receipt bindings with fake commands and real tar bytes; no receipt on suite, container, ELF or missing-runtime failures. Includes distinct npm config paths. |
| `AGENTS.md` | Documents preparation, Linux qualification, version alignment and digest import. |
| `../llp/3000.021-what-the-comparative-builder-still-wrote.rfc.md` | Short §3.3 implementation note and remaining qualification limitation. |
| `JOURNAL.md` | One dated append with measurements, checks and limitations. |
| `reports/20260927-lx-linux-package/REPORT.md` | This report. |

## Forms and examples

There are no new Quarry forms. Old runtime and authoring behavior is unchanged.

- Linux resolver: `npx --no-install snapback4 --version` finds the installed
  `snapback4-linux-x64` binary with `SNAPBACK4_BIN` unset and no checkout.
- Static build: `bash scripts/build-linux-musl.sh` emits
  `target/x86_64-unknown-linux-musl/production/snapback4` and checks its ELF.
- Client preparation: `node scripts/publish.mjs --prepare-client` emits one
  common client tarball plus `target/publication/client-VERSION/prepare.json`.
- Linux qualification: `node scripts/qualify-linux.mjs --client /path/client.tgz --out /path/new-qualification`
  runs the suite and both containers. It refuses on this host's missing runtime.
- Two-platform staging: `node scripts/publish.mjs --dry-run --linux-receipt /path/receipt.json --linux-tarball /path/snapback4-linux-x64-VERSION.tgz`.
- Resume: `node scripts/publish.mjs --resume --dry-run` rereads the durable
  copied Linux receipt, verifies every tarball and reruns only Darwin.
- Previous single-platform path: `node scripts/publish.mjs --dry-run`;
  previous format-2 stages remain resumable.

## Measurements and completed checks

Ran `scripts/test.sh` once, exit **1**. Exact summary:

```text
== 1 failure(s) in 1481 s
   client tests
```

Every other suite stage passed: Cargo build/tests/doctests (the Rust test
stage took 904 s), wasm/docs/release guards, package and both app checks,
9 fixture wrappers, all 56 sharded client tests and all 78 seeded models.
Main client tests: 2,523 passed, 1 failed, 10 intentional skips. The **only
failure**, classified **environmental/intermittent**, was
`ephemeral typing: five real-server trials beside a durable typing control`
with `timed out: ephemeral trial 4 disappears`. Its isolated rerun passed;
evidence, qualification limits and reproduction are below. No lane-owned
test failed. The elapsed time exceeds the inherited 60-second suite budget;
no budget or deadline changed.


- Node 24.13.1, npm 11.8.0, Bun 1.3.14, Rust 1.97.0, GCC 13.3.0,
  musl 1.2.5. Eight Cargo jobs; dev/test debug information disabled;
  `CARGO_INCREMENTAL=0`; descriptor limit 65,536.
- `build-linux-musl.sh`: passed. Static production binary **17,189,152 B**;
  SHA-256 `78ce3de25bb7806c4dad8f56906a0aa9753535b424b3c8b172045ef163283c52`. `check-elf.mjs` and `readelf -l -d`
  both confirm no interpreter and no dynamic-library dependencies.
- Development Linux tarball: **7,405,562 B**,
  SRI `sha512-/gBv0qBzTASmJ/HKK7HJaw3pCCtZ7FCLaYhc4JKi0JOauOEqH/i2ZpKegxUoAMubSpJsmHYnW7RYM7Rzj9dqHA==`.
- One clean-source prepared development client: **840,123 B**,
  SRI `sha512-IWHv0j+9F1nmyTUBh9JpMtRVN78Wqf0Daj/O2H6mFt94f24FZRi6gL6cXDhgQiwymJ9CdBZP2pt2vJh7SSiU9w==`. The common client was packed once
  at `792ae9b91`; failed preparation before npm installation produced no stage.
- Real host-only installed proof: **passed** in a fresh `/tmp` consumer,
  with no checkout and `SNAPBACK4_BIN` unset. npm installed the two exact
  tarballs. `npx --no-install snapback4 --version`, `init app --online`,
  `check`, `dev`, the real client's mutation/read and a second persona's
  denied read all passed. The installed binary hash matches the built hash.
- Affected Node tests: **67 passed, 0 failed** (24 existing signing cases,
  34 new publication cases, 4 Linux-package cases and 5 qualifier cases).
- Whole guide: **86 passed, 0 failed**, including every card and README
  Quarry block; the full suite's docs-budget and Rust guide checks ran it.
- Wasm: **1,980,253 B raw / 571,810 B gzip**, unchanged budget
  **572,841 B** (1,031 B headroom). SHA-256
  `324a54065e8d7077fe63e1d73dd26b24db29d8e8583d8a35753643f106c3fecc`.
  This lane changes no wasm source or dependencies. Relative to the prior
  lane's reported artifact, raw size is equal and gzip is 31 B smaller;
  that cross-build difference is not attributed to this packaging change.
- LLP reference audit: **515 documents, 9,578 refs, 0 errors, 0 unchecked**.
- Frozen Bun installation, Node syntax checks and `git diff --check` passed.
  No changed source file exceeds 1,500 lines.

The initial manual toolchain configuration inherited an ambient ARM cross
compiler. After configuring x64, `make install` retained newer installed ARM
headers; a host proof caught the resulting SQLite `E_STORE: file is not a
database` on an empty database. A fresh x64 install, cleaned/rebuilt bundled
SQLite, a C SQLite file-creation probe and the real host proof resolved it.
The committed installer selects x64 explicitly and sets a user-local
`syslibdir`. No SQLite/core workaround, altered durability or weakened check
was used. The rejected header tree is preserved outside the repository.

The real proof also caught npm refusing two config layers both named
`/dev/null`; the container now uses distinct empty user/global config paths.
The host's missing npm installation was restored from the checksum-verified
Node 24.13.1 distribution in user-local storage. No system setting changed.

Raw logs and development artifacts are under ignored `target/lane-lx/`:
`musl-final.log`, `elf.json`, `readelf.txt`, `host-proof.log`,
`local-proof.json`, `affected-tests.log`, `container-attempt.log`, `test.log`
and `ref-check.log`. These are development evidence, not a Linux release
qualification receipt. The current production code is unmodified by the
local probes.

## Engineering choices and deviations

- Added `--prepare-client` because Linux needs the common client before the
  Mac can complete staging. Preparation is signing-free and also runs on
  Linux for development tests. The release workflow below prepares on Mac.
- Every new preparation/qualification/stage requires clean source. Linux
  receipts bind the source commit. Resume remains independent of unrelated
  checkout changes and never reruns the source suite.
- The imported receipt is copied into the durable stage with its own SRI;
  resume rereads that copy. Moving or losing the original transfer directory
  cannot strand a partial publication.
- Retained format-2 receipts and previous top-level publication metrics for
  single-platform compatibility. A no-Linux-receipt stage contains Darwin
  and the client; its client still declares both optional platform packages.
- Node is pinned to 24.13.1. Proof images use Ubuntu 22.04 and Alpine 3.23;
  image IDs are recorded. These establish userspace compatibility, not a
  kernel minimum. Runtime detection selects a working Docker, then Podman.
- `-C relocation-model=static` accompanies `+crt-static`: the default
  static-PIE link through musl-gcc left PT_INTERP present. The ELF check
  rejected it. SQLite's `-USQLITE_ENABLE_MEMORY_MANAGEMENT` did not change.
- No codes were added to the compiler/runtime, so no CODES/why entry or
  Quarry guide card changed. The complete guide test still ran.
- The real container proof remains unmet. The full suite also recorded the
  intermittent failure below; that run is not a successful qualification.
  There is no Linux success receipt and no release claim.

## Open problem and reproduction

On `expo-build-1000`, from `snapback4/`:

```sh
export PATH=$HOME/.local/bin:$HOME/.cargo/bin:$PATH
command -v docker podman
unshare -Ur true
node scripts/qualify-linux.mjs \
  --client target/publication/client-0.4.4/snapback4-0.4.4.tgz \
  --out target/lane-lx/linux-qualification
```

`command -v` finds neither runtime; `unshare` returns
`write failed /proc/self/uid_map: Operation not permitted`.
Qualification exits 1: `Linux consumer proof needs a working Docker or
Podman; install/enable a runtime, then rerun qualify-linux.mjs (no receipt
was written)`. No runtime socket was found under `/run` or the user's
home. `sudo -n true` requires a password. No system setting was changed.
A working runtime or socket is needed to complete this proof on this host.

The full client suite also timed out in the unchanged test
`packages/snapback4/test/ephemeral-e2e.test.mjs:61`: `timed out: ephemeral
trial 4 disappears`. Classification: **environmental/intermittent**. The
file, its helper, ephemeral client and server/core sources have no diff
from `3a1f8b55d`; the isolated rerun passed 1/1 in 53.6 seconds, with all
five ephemeral trials disappearing about 3.93 seconds after the last call.
This supports a timing-sensitive inherited failure; its underlying race or
scheduling cause was not diagnosed in the packaging lane. The original
full-suite result remains red and is not replaced by the rerun.

Reproduce the observed context with `bash scripts/test.sh`. The targeted
check is:

```sh
node --test packages/snapback4/test/ephemeral-e2e.test.mjs
```

The timeout is intermittent; it did not reproduce in that isolated command.
Its log is `target/lane-lx/ephemeral-rerun.log`. No test deadline or assertion
was weakened.

## Next publication: commands, not executed here

Both hosts must use the **same clean integrated release commit**, with
Cargo, both platform manifests, the client and its optional dependencies at
0.4.5, and the updated Bun lockfile. Run these from `snapback4/`.
The publisher must have its existing Developer ID credentials. Registry
credentials remain on the Mac; transfer only the tarballs and receipts.
Do not reuse this lane's 0.4.4 development artifacts for publication.

Mac, prepare once:

```sh
bun install --frozen-lockfile
node scripts/publish.mjs --prepare-client
```

Linux, prepare the destination and toolchain (install only once):

```sh
export PATH=$HOME/.local/bin:$HOME/.cargo/bin:$PATH
export CARGO_BUILD_JOBS=8 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0
export CARGO_INCREMENTAL=0
ulimit -n 65536
bun install --frozen-lockfile
bash scripts/install-linux-musl.sh
mkdir -p target/incoming
```

Mac, transfer the common client:

```sh
scp target/publication/client-0.4.5/snapback4-0.4.5.tgz \
  expo-build-1000:/home/ccheever/sb4-intent/lane-lx/snapback4/target/incoming/
```

Linux, after a working Docker or Podman is available:

```sh
unset NPM_TOKEN NODE_AUTH_TOKEN SNAPBACK4_BIN
node scripts/qualify-linux.mjs \
  --client target/incoming/snapback4-0.4.5.tgz \
  --out target/linux-qualification-0.4.5
```

Mac, import and review the stage without publishing:

```sh
mkdir -p target/incoming/linux-0.4.5
scp expo-build-1000:/home/ccheever/sb4-intent/lane-lx/snapback4/target/linux-qualification-0.4.5/receipt.json \
  target/incoming/linux-0.4.5/
scp expo-build-1000:/home/ccheever/sb4-intent/lane-lx/snapback4/target/linux-qualification-0.4.5/snapback4-linux-x64-0.4.5.tgz \
  target/incoming/linux-0.4.5/
node scripts/publish.mjs --dry-run \
  --linux-receipt target/incoming/linux-0.4.5/receipt.json \
  --linux-tarball target/incoming/linux-0.4.5/snapback4-linux-x64-0.4.5.tgz
```

Mac, when authorized to publish that reviewed stage:

```sh
node scripts/publish.mjs --resume
```

`--resume` is also the recovery command after an interrupted upload. It
requires exact staged/registry integrity and never republishes a matching
version. Any existing conflicting artifact refuses before the first upload.

## Round 1 — pinned proot consumers (2026-09-27)

The round-0 missing-container blocker is resolved. This host used **proot
5.4.1**, with no sudo, namespaces, system configuration changes, push,
registry login or publication. The package version stays **0.4.4**;
integration owns 0.4.5. Round-0 review responses remain round-2 work.

### Files and behavior

| File (under `snapback4/`, except LLP) | Round-1 change |
| --- | --- |
| `scripts/linux-proof-inputs.mjs` | Pinned URLs and SHA-256 for static proot, both roots, official Ubuntu Node, and Alpine Node/npm plus every APK dependency; expected receipt provenance. |
| `scripts/qualify-linux-proot.mjs` | Verify downloads and cache hits before use; fresh roots/scratch/HOME; offline signed APK installation under fake root; run the unchanged consumer proof and record timings/provenance. |
| `scripts/qualify-linux.mjs` | Prefer working Docker, then Podman, then proot; receipt route and elapsed times; preserve executed consumer evidence on a red suite without issuing a success receipt. |
| `scripts/publication-artifacts.mjs` | Accept proot receipts only with both successful roots and the exact pinned tool/rootfs provenance; retain the existing Docker/Podman receipt path. |
| `packages/snapback4/test/qualify-linux.test.mjs` | Offline route-selection, download/cache corruption refusal, environment/bind scope, proot failure, and receipt provenance tests. |
| `packages/snapback4/test/helpers/publish-fixture.mjs` | Copy the shared pin module into disposable publication test fixtures. |
| `AGENTS.md` | Document automatic proot fallback. |
| `../llp/3000.021-what-the-comparative-builder-still-wrote.rfc.md` | Update §3.3's implementation note with the authorized fallback and measured evidence. |
| `JOURNAL.md` | One dated round-1 append. |
| `reports/20260927-lx-linux-package/` | This report and the durable round-1 receipts/evidence. |

There are no new Quarry forms. `node scripts/qualify-linux.mjs --client
/path/client.tgz --out /path/new-qualification` automatically selects the
route. In each root, the existing proof installs the two staged tarballs,
runs `npx --no-install snapback4 --version`, `init app --online`, `check`,
`dev --port 0 --no-watch`, an Alice mutation/read and Bob's denied read.

### Isolation and pins

Only disposable proof-input copies and consumer scratch are directory
bindings; `/dev/null`, `/dev/random` and `/dev/urandom` are the device
bindings. DNS configuration is copied. There is no host home, checkout,
toolchain, library, `/proc`, `/sys`, `/tmp` or root binding. The environment
is an allowlist with guest PATH, fresh HOME, separate empty npm config
paths, public npm registry, and no binary override, credentials or injected
Node/loader options. proot is a userspace compatibility tool, not a security
boundary for hostile programs; these are trusted consumer compatibility
proofs and do not establish a kernel minimum. proot has no read-only-bind
option: the proof uses disposable copies and verifies their tarball hashes
afterwards. Downloads and temporary roots live only under
`~/.cache/snapback4-qualify/`; successful or failed roots are cleaned up.

Docker/Podman keep the original Ubuntu 22.04/Alpine, Node 24.13.1 path.
Per the round-1 instruction, proot uses Ubuntu **24.04.3**, Node **22.22.0**
(npm **10.9.4**), and Alpine **3.23.3**, Node **24.18.1** (npm **11.11.0**).
Alpine APK signatures are verified using the pinned root's keys. Package
installation is offline with an empty repository list; every dependency
APK is also SHA-256 pinned. npm's consumer installation still uses the
shared network, as the round-0 proof does.

Root/Node checksums came from the official adjacent checksum files and
proot's release SHA256SUMS. APK bytes came from the official Alpine v3.23
repositories and are independently signature-checked by apk. Every URL and
digest appears in the receipt (22 unique downloaded inputs).

### Tests added

- Selection prefers working Docker, then Podman, then proot, including a
  missing or unusable runtime; no network is needed by the test.
- Wrong downloaded bytes and a subsequently corrupted cached archive are
  refused; a correct cache hit makes no download.
- The proot command uses explicit bindings rather than `-R`/`-S` aliases;
  its environment does not inherit host credentials or tool overrides.
- Successful receipts serialize both rootfs identities and every tool pin.
  Missing/changing the route, root hash/URL, tool list/hash or proof status
  is refused by the publication importer.
- Failed proot execution or a red source suite never writes a successful
  qualification receipt. Existing Docker, suite, ELF and bad-pin refusal
  controls remain.

The only behavior extension beyond selecting proot is preserving successful
consumer evidence in `proofs.json` when the source suite is red. This is
necessary to run both roots without repeating the full suite after a known
flake; it cannot be imported as a successful qualification receipt.

### Measured qualification and merge

Implementation: `bd15a8def`. The one real `qualify-linux.mjs` run used that
clean branch head, a freshly prepared 0.4.4 client, and the static musl
platform build. **Exit 0**, exact full-suite result:

```text
== 0 failure(s) in 1376 s
```

Every stage passed. Rust tests/doctests took 880 s; client main: **2,530
passed, 0 failed, 10 intentional skips**; seven shards: **56 passed**;
models: **78 passed** in 274 s; fixture wrappers: **9 passed**. The whole
guide passed **86/86**. Neither the ephemeral typing case nor the known
session-restore case failed, so there was no flake rerun and no failure to
classify as introduced, baseline or environmental. The inherited 60-second
suite budget remains exceeded; no budget or test deadline changed.

Then fetched and merged `origin/main` at `9473e0a34` in `35be43f56`.
Only JOURNAL conflicted: both complete append-only entries are preserved
verbatim, checked against their parents. No code conflict resolution.
`a95bbb44d` strengthens only the isolation/receipt unit test with deliberately
inherited hostile environment values and additional bad Node/tool URL cases.

Post-merge checks: packaging **73/73**, filesystem **1/1**, ownership **9/9**,
admission **27/27**, residency **7/7**, whole guide **86/86**, and the updated
local-e2e file **5/5** — **208 passed, 0 failed**. The local-e2e change came
from main; this lane changed neither that test nor ephemeral-e2e. Rebuilt
wasm and prepared a fresh client at `a95bbb44d`; its SRI is unchanged. The
static production rebuild took **3 min 42 s**. Both roots then passed again
against the merged binary. The full suite was not repeated.

| Evidence | Ubuntu 24.04.3 / Node 22.22.0 | Alpine 3.23.3 / Node 24.18.1 |
| --- | --- | --- |
| Development preflight | 14.705 s, passed | 14.514 s, passed |
| Full qualification at `bd15a8def` | 11.155 s, passed | 10.224 s, passed |
| Merged consumers at `a95bbb44d` | 11.225 s, passed | 10.228 s, passed |

Times include each root's setup and consumer execution. The full and merged
runs reused SHA-256-verified cached downloads but extracted fresh roots.
[Full qualification receipt](./round1-receipt.json) binds the suite and
artifacts to `bd15a8def`; [merged consumer evidence](./round1-merged-consumers.json)
is explicitly an affected consumer recheck, not a claim that a second full
suite ran at `a95bbb44d`. All later lane changes are evidence/documentation.

Pinned SHA-256 values (the receipt records every URL and all 18 APK hashes):

- [proot 5.4.1](https://github.com/proot-me/proot/releases/download/v5.4.1/proot): `19f44283f5c0e73091c60195f5fcd4f4c1165505e44410d434e2ab1b677c1a09`.
- [Ubuntu rootfs](https://cdimage.ubuntu.com/ubuntu-base/releases/24.04/release/ubuntu-base-24.04.3-base-amd64.tar.gz): `6bc2cde3930ad088b3bb46fa45279e96d25bc3810f209850ecbe4722711874f9`.
- [Ubuntu Node archive](https://nodejs.org/dist/v22.22.0/node-v22.22.0-linux-x64.tar.xz): `9aa8e9d2298ab68c600bd6fb86a6c13bce11a4eca1ba9b39d79fa021755d7c37`.
- [Alpine rootfs](https://dl-cdn.alpinelinux.org/alpine/v3.23/releases/x86_64/alpine-minirootfs-3.23.3-x86_64.tar.gz): `42d0e6d8de5521e7bf92e075e032b5690c1d948fa9775efa32a51a38b25460fb`.

Published checksum sources: [proot](https://github.com/proot-me/proot/releases/download/v5.4.1/SHA256SUMS),
[Ubuntu](https://cdimage.ubuntu.com/ubuntu-base/releases/24.04/release/SHA256SUMS),
[Node](https://nodejs.org/dist/v22.22.0/SHASUMS256.txt), and
[Alpine](https://dl-cdn.alpinelinux.org/alpine/v3.23/releases/x86_64/alpine-minirootfs-3.23.3-x86_64.tar.gz.sha256).

- Full qualification: binary **17,189,152 B**, SHA-256 `78ce3de25bb7806c4dad8f56906a0aa9753535b424b3c8b172045ef163283c52`; platform **7,405,562 B**, SRI `sha512-/gBv0qBzTASmJ/HKK7HJaw3pCCtZ7FCLaYhc4JKi0JOauOEqH/i2ZpKegxUoAMubSpJsmHYnW7RYM7Rzj9dqHA==`. ELF: no interpreter and no NEEDED entries.
- Merged recheck: binary **17,193,248 B**, SHA-256 `23e4e408c750d30ca6554c91fbbf04e7c522edd9b6048aff01d21ba16695803e`; platform **7,406,320 B**, SRI `sha512-nlUk0mr2oBjNyfPJDeEtbKWkQhUC07dGFK2cbFkoSBGj0X5nZNSvt9RuwtgIOXy1bQmbMvL6YXHGuMVtNhYFMQ==`. ELF: no interpreter and no NEEDED entries.
- Common client: **840,123 B**, SRI `sha512-IWHv0j+9F1nmyTUBh9JpMtRVN78Wqf0Daj/O2H6mFt94f24FZRi6gL6cXDhgQiwymJ9CdBZP2pt2vJh7SSiU9w==` in both runs.
- Wasm before and after merge: **1,980,253 B raw / 571,810 B gzip**, SHA-256
  `324a54065e8d7077fe63e1d73dd26b24db29d8e8583d8a35753643f106c3fecc`;
  unchanged **572,841 B** cap and **1,031 B** headroom. This round's delta is zero.

### Reproduction and remaining scope

No open round-1 blocker. The remaining work is the separately commissioned
round-2 review response and integration's coordinated 0.4.5 release. The
0.4.4 development artifacts and pre-merge receipt are not a 0.4.5 publication
qualification. A clean release commit must prepare and qualify its own bytes.
There was no Docker/Podman run on this host, and no Mac signing/publication.

The existing two-host publication commands above still apply, with the
"after a working Docker or Podman is available" condition removed: Linux
now automatically uses pinned proot. The Linux command is unchanged:

```sh
export PATH=$HOME/.local/bin:$HOME/.cargo/bin:$PATH
export CARGO_BUILD_JOBS=8 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0
export CARGO_INCREMENTAL=0
ulimit -n 65536
unset NPM_TOKEN NODE_AUTH_TOKEN SNAPBACK4_BIN
node scripts/qualify-linux.mjs \
  --client target/incoming/snapback4-0.4.5.tgz \
  --out target/linux-qualification-0.4.5
```

For this round's exact development reproduction, use a clean checkout of
`bd15a8def`, install frozen Bun dependencies, export the settings above, and
run from `snapback4/` with new output directories:

```sh
node --input-type=module -e 'import { prepareClient } from "./scripts/prepare-client.mjs"; import { resolve } from "node:path"; prepareClient(process.cwd(), "0.4.4", resolve("target/lx-round1-repro/client"));'
node scripts/qualify-linux.mjs \
  --client target/lx-round1-repro/client/snapback4-0.4.4.tgz \
  --out target/lx-round1-repro/qualification
```

That command runs the full suite; this round executed it only once. Offline
affected tests:

```sh
node --test packages/snapback4/test/qualify-linux.test.mjs \
  packages/snapback4/test/publish-linux.test.mjs \
  packages/snapback4/test/publish-signing.test.mjs \
  packages/snapback4/test/linux-package.test.mjs
```

Raw logs/artifacts: ignored `target/lane-lx-round1/`: `prepare.log`,
`qualify.log`, `qualification/suite.log`, `qualification/receipt.json`,
`affected-before.log`, `affected-merged.log`, `merged-consumers.log`,
`merged/consumers.json`, `merged/client/prepare.json`, the exact platform
and client tarballs, and `recheck-merged.mjs` (the post-merge driver, which
runs no full suite). The round-0 report and retained tarballs remain.

Final reference audit: **515 LLP documents, 9,585 refs, 0 errors, 0 unchecked**.
Frozen Bun installation and diff whitespace checks passed; all changed source
files remain below 1,500 lines. Every lane commit has the requested co-author
trailer.


## Round 2 — review response (2026-09-27)

This section supersedes the round-0/1 publication limitations where stated.
The version remains 0.4.4; integration owns the 0.4.5 bump and qualification.

### Commit / finding map

- `Pack the client for the selected publication platforms`: Astra finding 2
  (High), Grok finding 1 (High), round-2 request 1. Fresh no-receipt runs
  pack a Darwin-only client, preserving that supported flow without naming
  an unpublished Linux version. `--prepare-client` still selects both
  platforms for cross-host qualification. A private package copy receives
  the selected dependencies before the single pack; source stays unchanged.
  Preparation loading and stage resume require exact dependency names and
  versions for the staged set. Existing two-platform preparations cannot
  silently enter a Darwin-only stage. Format-2 resumes still pass.
  Three new tests failed before the fix and pass after it: Darwin-only
  packed manifest/registry/resume, incompatible prepared client refusal,
  and resume refusal when a dependency is added with updated artifact SRI.
  Publication/signing tests: 61 passed, 0 failed.

- `Publish only receipt-verified private artifact snapshots`: Astra finding 1
  (High), Grok finding 2 (Medium) and the publish-fixture part of finding 3,
  round-2 request 2. `publication-registry.mjs` copies all artifacts after
  proof into a private temporary directory, makes copies read-only and
  verifies them against loaded receipt digests before any upload. Each
  `converge` re-verifies immediately after its registry lookup and before
  `npm publish`; the snapshot is removed on success or refusal. `publish.mjs`
  retains platform-first ordering and all-artifact registry preflight.
  Eight new regressions failed before the fix and pass after it: all three
  stage artifacts swapped after proof in fresh/resumed flows (zero uploads),
  stage replacement during registry checks (only qualified snapshot bytes
  uploaded), and snapshot corruption during registry checks (zero uploads).
  Publication/signing tests: 69 passed, 0 failed.

- `Pin the musl build output to the qualified target directory`: Astra
  finding 3 (High), round-2 request 3. `build-linux-musl.sh` passes
  `--target-dir "$PWD/target"`. The qualifier harness executes the real
  shell with fake Cargo, a redirected `CARGO_TARGET_DIR`, and a preexisting
  stale ELF of the same version. The new regression failed before the fix;
  now the shell's inspected bytes, packed bytes, receipt binary digest and
  both proofs' platform digest all identify the fresh build. Qualifier
  tests: 12 passed, 0 failed.

- `Execute the consumer proof in both qualifier test routes`: Astra finding 4
  (Medium), Grok finding 3 (Medium), round-2 request 4. The qualifier harness
  now executes each production shell body with offline guest-tool stand-ins
  and a real Node proof entrypoint. The proot fixture runs the actual
  `prootProof`, mocking only downloads/tool execution through a narrow
  `fetchInput` argument (default: checksum-verifying `fetchPinned`).
  `helpers/linux-proof-harness.mjs` requires the absence guard and Node pin,
  records node-version/install/roundtrip execution and both installed SRIs,
  and checks the entrypoint saw no override. Six explicit refusal cases
  cover a failing entrypoint, injected override and wrong Node on both
  routes; every case exits without a receipt. Removed the old proot stub
  that manufactured successful proof records. Qualifier tests: 18 passed.
  Mutation checks independently replaced the entrypoint, override guard
  and Node-version check with `true` in each production route: all six
  mutations made the success test fail, unlike round 0's permissive mock.

- `Recheck packed Linux ELF bytes during publication import`: Grok finding 4
  (Low) and SQLite flag observation, round-2 request 5. `validateLinux` hashes
  and parses the extracted binary with `checkElf` on initial import and
  resume, requiring no interpreter or NEEDED entries without executing it.
  The publication fixture now uses minimal real ELF headers; a shared
  `helpers/elf-fixture.mjs` also supplies the parser controls. Three forged
  receipt regressions (text binary, interpreter, NEEDED) update every digest
  while retaining a claimed static ELF result: all passed import before the
  fix and are now refused before signing/upload. The shell/receipt SQLite
  flag equality test fails when the shell flag is mutated. `AGENTS.md`
  describes exact platform sets and private upload snapshots.
  All affected tests: **95 passed, 0 failed** (48 publication, 24 signing,
  18 qualifier, 5 Linux package/parser/resolver/flag cases).
