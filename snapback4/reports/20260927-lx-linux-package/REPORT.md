# Lane LX — Linux npm platform artifact (2026-09-27)

Implementation of LLP 3000.021 §3.3 on `sb4-intent/lx-linux-package`, based
on `3a1f8b55d`. No push, package publication, registry login, runtime rule,
disclosure, durability or meter change. The release version remains 0.4.4
in this lane; integration owns the coordinated 0.4.5 bump.

**Qualification limitation:** this host has no usable Docker or Podman.
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
