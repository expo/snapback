# HV round 4 — one portable wasm build

The merged device fits the unchanged **593,719 B gzip** budget with a required,
locked **binaryen 132.0.0** development dependency. Final Linux builds produce
**1,978,828 B raw / 593,295 B gzip**, with or without `wasm-opt` on PATH: **424 B
headroom**. The independent macOS build is **1,979,135 B raw / 593,652 B gzip**,
with **67 B headroom** and identical repeated output on that host. The final artifact is byte-identical to the merged source optimized
with native Binaryen 132. No HV runtime source changes in this round. Complete Rust builds remain
host-specific; the cross-host byte-identity limit is explained below.

## Integration and decision

Merged `origin/main` **4226fc9733a40e68d4996ee0bee234df463b1bba** in
**d08c43ed6a**, keeping WD's `small_map` and its ObjectFields capacity correction,
HV's compact row images/shared keys/index pages/drain codec, and all round-2/3
correctness fixes. Code merged cleanly. Both append-only journal sides remain;
the identical optional folding stages were consolidated using WD's reference
comment. WD changed no delivery awaits, so the existing inventory remains valid.
Round-3 review findings belong to the later commissioned round.

| Measured build | Raw B | Gzip B | Difference from preceding source rung |
| --- | ---: | ---: | ---: |
| Round 3, historical, no Binaryen | 2,065,883 | 605,320 | — |
| WD merge, no Binaryen | 2,005,435 | 596,818 | −8,502 |
| Clipped shared index iterator trial, no Binaryen | 2,003,069 | 596,296 | −522 |
| WD merge, native Binaryen 132 | 1,978,828 | 593,295 | Separate optimizer comparison |
| Final, pinned npm Binaryen, no PATH optimizer | 1,978,828 | 593,295 | Byte-identical to native optimizer |
| Final Linux, pinned npm Binaryen, PATH optimizer present | 1,978,828 | 593,295 | Byte-identical repeat |
| Final macOS, pinned npm Binaryen, no PATH optimizer | 1,979,135 | 593,652 | Different Rust-host input; fits |
| Final macOS, failing PATH optimizer present | 1,979,135 | 593,652 | Byte-identical to both Mac repeats |

The trial clips range endpoints once and shares traversal. It passed both
existing compact-index differential tests but still missed the cap by 2,577 B;
it is **discarded**, including an added but unrun mixed-direction test. Its
patch and measured build are retained as evidence, not part of production.
Recovering the full remainder in this round would require additional runtime
changes. The user explicitly authorized a pinned portable optimizer instead.
That choice retains the merged executable behavior and fixes the publication
Macs' missing-PATH-tool problem directly. No byte ceiling is raised.

The raw, unoptimized artifact still weighs **596,818 B gzip**, 3,099 B over.
This solution uses the authorized hermetic-toolchain route; it does not claim
to have made unoptimized wasm fit. Absence of an ambient PATH optimizer is
supported; the build script refuses a missing locked dependency before Cargo runs.

## Build contract

`package.json` pins `binaryen` to exact **132.0.0**, and `bun.lock` pins the
package's SHA-512 integrity. It is the portable Node distribution, not a host
native executable selected through PATH. Both `scripts/build-wasm.sh` and
`scripts/measure-wasm.sh` invoke `node node_modules/binaryen/bin/wasm-opt`.
They check the installed version against the exact workspace pin. Missing or
mismatched installation names `bun install --frozen-lockfile`; optimizer
failure fails the command, with no unoptimized fallback.

The existing passes remain `-Os`, followed by `--code-folding
--duplicate-function-elimination --dce --vacuum`, with bulk-memory and
nontrapping-float-to-int enabled. Each is kept only if gzip is smaller, comparing
identical headers. Measurement now applies both passes and records manifest and
lockfile changes as dirty inputs. Binaryen adds no production dependency or
client package content. Build instructions are in README and AGENTS; the
reason and trade are recorded in LLP 3000.002's existing device-diet section.

The strengthened existing build-script test installs a local optimizer fixture
and poisons PATH's `wasm-opt` with exit 91. Both build and measurement succeed
without consulting it. Missing and wrong-version dependencies refuse before
Cargo or PATH fallback; an optimizer error propagates. Existing budget-overrun,
malformed-budget and codec-family controls remain. This adds no gate or test file.

## Clean installation and reproducibility

Linux: eb1000 / AMD EPYC 9454, Rust **1.97.0**, wasm-bindgen **0.2.127**,
Node **24.13.1**, Bun **1.3.14**, GNU gzip **1.12**. The actual workspace's old
`node_modules` was moved to a task-owned backup, then a fresh
`bun install --frozen-lockfile` installed 578 packages in **0.50 s** from the
warm cache. Its newly installed optimizer reports version 132. Two subsequent
full build-script invocations, without and then with native Binaryen 132 on PATH,
produce the same raw wasm SHA-256:

```text
5740f90ae2ff64d4969dc6e44631ba7ae919732406f85392250d11ee7c40a7ae
```

That hash also matches the pre-install native-Binaryen merged control and the
final SDK's source/dist wasm. These are wasm byte identities; gzip headers carry
file timestamps, so compressed-file hash identity is not claimed. Gzip sizes
use the production basename and level 9, as the unchanged budget check does.

macOS: Bones M4 mini, arm64, Node **24.13.1**, Rust **1.97.0** / LLVM
**22.1.6**, wasm-bindgen **0.2.127**, Bun **1.3.14**, macOS **27.0**. A fresh
named source directory receives the hash-bound source plus every workspace
manifest and frozen lock. Its clean installation takes **17.16 s** (577 packages;
platform-specific packages differ). There is no wasm-opt on the build PATH.
Two complete builds produce **1,979,135 B / 593,652 B gzip**, both passing the
same budget and sharing SHA-256:

```text
549de290da21949d5299fd1f4f7f0a28fecfc046d5b7de78d787ef4d64dd8162
```

A third complete Mac build adds a deliberately failing wasm-opt to PATH. It
still produces the same `549de290…` artifact and 593,652 B gzip; the PATH tool
is never invoked.

The first attempted build hit the host's unaccepted Xcode license at native
build-script linking. The successful runs select the already installed Command
Line Tools with a process-local DEVELOPER_DIR; no license or global setting is
changed. The remote scripts and original failed log are retained.

**Cross-host byte reproducibility has a narrower proven scope.** Feeding the
same Linux wasm-bindgen output to the pinned Node optimizer on both hosts gives
exactly the Linux final hash `5740f90a…`. That proves the optimizer's portable
output, but the complete Rust builds above are not byte-identical. This is the
already-open [host reproducibility issue](../../../../issues/20260929-snapback4-device-wasm-not-reproducible-across-hosts.md),
not solved by pinning Binaryen alone. Pre-Binaryen Cargo output already differs
(2,518,352 B Linux / 2,518,632 B Mac); its data contains host-specific Rust/Cargo
paths. A diagnostic remapping trial removes those paths, but still gives
593,198 B gzip Linux / 593,617 B Mac with different hashes. That trial is discarded.
A second diagnostic found wasm-bindgen 0.2.127 installations linked different
walrus versions (0.26.4 versus 0.26.5): processing the Mac Cargo artifact on
Linux reproduces the Mac output except for that producer-version byte.
Neither observation claims to explain all remaining cross-host codegen variation.
The existing issue remains open with these measurements appended.

Compression also differs: **the same** `5740f90a…` wasm is 593,295 B using GNU
gzip here and **593,714 B** using Apple's gzip on the Mac, only **5 B** under
the cap. The Mac's own build is 593,652 B. Every measured build/compression
combination fits, but headroom is small. We do not claim identical compressed
bytes or an independently checked result for every physical fleet machine.

Three alternating clean baseline/pinned workspace installs used the same warm
Bun cache, copying every workspace manifest and the respective frozen lockfile
into fresh directories with no `node_modules`. All six succeed:

| Warm-cache clean installation | Baseline | Pinned | Added |
| --- | ---: | ---: | ---: |
| Wall time, median | 0.505760 s | 0.508821 s | 0.003061 s |
| Apparent node_modules bytes | 494,290,187 | 602,832,815 | 108,542,628 |
| Allocated bytes, median (`du -sB1`) | 613,949,440 | 722,534,400 | 108,584,960 |

The tiny warm-cache timing delta is not a network-install promise. Bun can
hard-link cached files; the table reports each tree's footprint, not unique
physical allocation across all copies. Binaryen's registry tarball is
**23,273,804 B**, with **108,542,397 B** of unpacked files. An isolated exact
Binaryen install using an initially empty Bun cache and no node_modules takes
**0.626116 s** here, including resolution, download and extraction. This is one
host/network sample, not a guaranteed incremental time for a full cold workspace.
The package includes the full Binaryen tool distribution, not just wasm-opt.
`install-measurements.json`, `cold-binaryen.json` and unedited install logs retain
all runs; `measure-install.py` repeats the warm-cache comparison.

## Preserved behavior and validation

`git diff d08c43ed6a -- snapback4/crates snapback4/packages/snapback4/src` is empty.
Canonical compact rows, shared key tails, bulk sorted pages, bounded draining,
format-4 strict persistence and transaction-local migration routing are unchanged.
Caller-based batch admission and the full private-witness fallback reservation
are unchanged. All ordinary and word indexes still finish before publication
and prediction replay. No work moves to a server or into deferred indexing.

The generated 6,000-row regression passes with **20,551,766 B peak /
15,029,122 B retained**, against **37,727,851 B** for the old retained
representation (**54.5%**). The largest bridge string remains **302,739 B**;
complete acquisition and complete offline restore pass. These allocation counts
match round 3 exactly. Its elapsed time overlaps other qualification work and
is not used as a performance comparison.

Final affected checks pass: **171 core tests** plus one declared ignore (and
its separate detecting child passes), **1,391 device tests** with five declared
ignores, the **whole guide 99/99**, and **28/28 build/codec tests**. Documentation
budgets pass. `ref-check --verbose` passes with 524 LLP documents / 9,953 refs,
zero errors and zero unchecked references. The generated fixture above passes
separately with its allocation output retained.

Ran `scripts/test.sh` **exactly once**, exit **0**. Its exact summary line is:

```text
== 0 failure(s) in 1634 s
```

Full-suite failures: **ours 0, baseline 0, environmental 0**. Rust passes
**4,355** (4,338 target tests plus 17 doctests), with 33 declared ignores.
Clients pass **5,250**, with ten existing skips and zero cancellations. Fixture
wrappers pass **9/9**. Final serial models pass **79/79**, retaining the full
10,000 session and 3,000 online sequence counts. All stages pass. The inherited
60-second suite budget remains exceeded; no timeout, workload or gate is relaxed.

`source-before-suite.json` and `source-final.json` match for every tracked
implementation, build script, package manifest/lock and test input they bind.
The source and dist wasm both match the final Linux hash. Exploratory remapping
was confined to diagnostic build environment/output and is not retained in
source or the SDK. Affected checks and the full suite overlapped; none of their
elapsed times is presented as a runtime performance measurement.

This round does not repeat the heavy-account timing campaign. Earlier five-run
medians remain historical measurements, not new timing claims. The selected
build matches the native-optimized merged control byte-for-byte; the dependency
change adds no runtime procedure. The requested sub-8-second/256-MB heavy-account
targets from round 0 remain open, distinct from this round's wasm-budget job.

## Reproduction and evidence

From `snapback4/`, with the toolchain above:

```sh
bun install --frozen-lockfile
bash scripts/build-wasm.sh
# Save the wasm, then repeat with a native wasm-opt on PATH and compare with cmp.
node --test packages/snapback4/test/wasm-budget.test.mjs packages/snapback4/test/wasm-codec-census.test.mjs
LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT CARGO_BUILD_JOBS=8 RUST_TEST_THREADS=8 cargo test -p snapback4-core --lib
LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT CARGO_BUILD_JOBS=8 RUST_TEST_THREADS=8 cargo test -p snapback4-device --lib --tests
LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT CARGO_BUILD_JOBS=8 RUST_TEST_THREADS=8 cargo test -p snapback4-lang --test guide
LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT CARGO_BUILD_JOBS=8 RUST_TEST_THREADS=8 bash scripts/test.sh
```

The full suite is invoked exactly once in this round. `artifacts.json` binds
size/hash comparisons, `source-before-suite.json` binds qualified source, and
`mac-source.json` binds the source copied for the independent Mac build. Logs
are retained unedited, compressed after completion. `FAILURES.md` also records
setup errors, the discarded over-budget candidate and the detecting test that
caught measurement's inherited PATH dependency. No test count, assertion,
timeout, heap/wasm ceiling or durability requirement is relaxed.

The merge and final commit carry `Co-Authored-By: GPT-6 Astra <noreply@openai.com>`.
Nothing pushed or published.
