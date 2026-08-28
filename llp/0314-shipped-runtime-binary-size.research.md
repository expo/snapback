# LLP 0314: Shipped runtime binary size

**Type:** Research
**Status:** Review
**Systems:** Packaging, Build, Runtime, Distribution, Developer experience
**Author:** Charlie Cheever / Grok
**Date:** 2026-08-25
**Revised:** 2026-08-25 (r3 — round-2 delta fold: F3 split into public
manufacture vs source-repair custody, F6 jsonschema sites corrected to
the two normal-dep crates, F7 PocketBase row corrected to the
executable. r2 — round-1 fold; units unified to decimal MB, F3 widened
to the manufacture graph, F4 reframed on LLP 0061 §4a, F7 comparables
dated and labeled)
**Related:** LLP 0000, LLP 0010, LLP 0041, LLP 0061, LLP 0126, LLP 0141,
LLP 0276, LLP 0284, LLP 0314.000

All sizes in this document are decimal (1 MB = 1,000,000 bytes) unless
a table gives exact bytes.

## Summary

The npm-shipped Snapback server is large for a local backend people
`npm install`. The Darwin **0.1.27** runtime package unpacks to **~187 MB**
(18 files); its `bin/snapback` is **~159 MB** on disk and compresses, with
Hermes and the admin snapshot, into a **~52 MB** tarball. Linux is heavier:
**~248 MB** unpacked / **~70 MB** tarball, because ICU and `libhermesvm.so`
ride next to the binary.

This is not a mistaken debug build. The qualified developer binary is
*supposed* to be fat (LLP 0010 policy; measured **~490 MB** in
`scripts/binary-size-baseline.json`, **~530 MB** for this checkout's
`target/debug/snapback`). The shipped artifact is a `--release` Mach-O
that still carries **241k symbols**, **~20 MB of embedded Guide**, and
**no fat LTO**, even though the workspace already defines
`[profile.production]` for the ship path (LLP 0276) and already sidecars
the admin UI in the npm package (LLP 0041).

This document is diagnosis only. It does not authorize a size program,
a landing veto, or a change to debug-binary policy. The reduction plan
is [LLP 0314.000](./0314.000-reduce-shipped-runtime-size.plan.md).

## What this is not

- **Not LLP 0010.** That spec’s size metrology is the *debug* developer
  binary: report-only `BINARY_SIZE_DRIFT` after qualification, 15%
  tolerance on total bytes / `__LINKEDIT` / symbol `strsize`. Bootstrap
  must not fail closed on it. This research is about the *npm runtime
  package* consumers download.
- **Not LLP 0276’s architecture program.** That RFC already named
  `cargo build --profile production -p snapback` as the shipped shape.
  The finding here is that the publish path does not run that command.
- **Not a Hermes / Ibex indictment.** LLP 0000 picked Ibex “anywhere
  binary size matters.” The packaged Darwin `hermesvm.framework` is
  **~9.4 MB**. That is cheap next to 67 MB of Snapback `__text` and 35 MB
  of leftover symbols. LLP 0141’s **74 MB** figure is the vendored
  `vendor/ibex/ios/Frameworks` checkout, not the shipped framework.
- **Not a repudiation of the Guide-embedding decision.** LLP 0061 §4a
  deliberately resolved Guide carriage as *embedded-in-binary, always
  served*: the server is the structural version authority, and HTTP and
  MCP re-serve one build-matched corpus. F4 measures what that decision
  costs today; changing the carriage is a design amendment to LLP 0061
  (taken up in LLP 0314.000 Phase 2), not the correction of an accident.
- **Not a claim about HEAD.** Numbers below are the **0.1.27** closure
  (`98681377721e`, holding tag `fastpath-0-1-27-98681377721e`) plus a
  Darwin `bin/snapback` staged in
  `packages/snapback-runtime-darwin-arm64/` when measured on
  2026-08-25. Staged binaries are not retained in the checkout, so the
  F2 table is not locally re-runnable; future snapshots should retain
  the binary digest and raw `size`/`otool` output alongside the dated
  numbers. The tree moves; the *shape* of the waste does not depend on
  a few days of growth.

## Re-measurement (2026-08-28)

The F1/F2 baseline was re-measured after LLP 0314.002 landed, because a
local `target/release/snapback` of 105,046,880 bytes raised a concern
that the 159,336,256-byte figure was stale. **It is not.** That binary
was a plain `cargo build --release`, not the canonical publish command,
and carried 93,721 symbols against the canonical build's 264,500. It was
never a comparable artifact, and F7's warning about comparing unlike
build kinds applies to it.

Canonical `SNAPBACK_BUILD_DISTRIBUTION=public-package cargo build
--release --bin snapback`, Darwin arm64, 2026-08-28:

| | bytes |
|---|---:|
| Binary (with LLP 0314.002 compression) | 157,178,768 |
| Same binary without compression | ~174,383,050 |
| `__TEXT` / `__text` / `__const` | 115,277,824 / 74,674,852 / 23,351,560 |
| `__LINKEDIT` | 38,912,000 |
| symbols | 264,500 |

Two consequences for the plan in
[LLP 0314.000](./0314.000-reduce-shipped-runtime-size.plan.md):

1. **F2's shape holds.** `__LINKEDIT` is 38.9 MB and the symbol table is
   264,500 entries on a `--release` build that does not strip. Phase 1
   (ship profile plus strip) remains the single largest remaining
   reduction — larger than compression was.
2. **The binary grew with the code.** Uncompressed, today's canonical
   build would be ~174.4 MB against 0.1.27's 159.3 MB. LLP 0314.002's
   ~17.2 MB roughly offsets that growth rather than reducing the
   artifact below its documented baseline. Any future size claim should
   be dated and stated against a re-measured baseline, not against F1.

## Phase 0 ranking (2026-08-28) — F6 becomes a measurement

LLP 0314.000 Phase 0 asks for a crate ranking that can "falsify
'jsonschema is the next cut' or confirm it." **It falsifies it.**

Measured on `SNAPBACK_BUILD_DISTRIBUTION=public-package cargo build
--profile production -p snapback --bin snapback`, Darwin arm64,
unstripped. Attribution is by v0-mangled crate name over 76,844 `__text`
symbols using consecutive-address sizes, covering 65,686,676 bytes
across 260 crates. (`cargo bloat` re-runs its own fat-LTO build and was
not used; this method reads the shipped binary directly. Treat the
per-crate figures as attribution, not as a linker-authoritative split.)

| Crate | `__text` bytes | share |
|---|---:|---:|
| `serde_core` | 8,277,936 | 12.6% |
| `core` | 6,637,948 | 10.1% |
| *(C / unmangled — Hermes, SQLite, ICU)* | 6,146,756 | 9.4% |
| `snapback_kernel` | 5,167,200 | 7.9% |
| `serde_json` | 5,140,048 | 7.8% |
| `snapback_types` | 4,728,724 | 7.2% |
| `tokio` | 3,467,640 | 5.3% |
| `snapback_server` | 3,094,740 | 4.7% |
| `snapback_engine` | 2,673,904 | 4.1% |
| `axum` | 1,771,884 | 2.7% |
| `snapback_cli` | 1,554,252 | 2.4% |
| `serde` | 1,518,272 | 2.3% |
| `serde_path_to_error` | 1,229,844 | 1.9% |
| `swc_ecma_parser` | 652,860 | 1.0% |
| `ibex_runtime` | 639,944 | 1.0% |
| **`jsonschema`** | **574,156** | **0.9%** |

Two findings:

1. **`jsonschema` is not the next cut.** It is 0.9% of `__text`, ranked
   nineteenth. F6's dependency-list reasoning does not survive
   measurement, and any plan step premised on cutting it should be
   re-costed against this table.
2. **The serde family is the largest attributable cluster.**
   `serde_core` + `serde_json` + `serde` + `serde_path_to_error` is
   **16,166,100 bytes, 24.6%** of `__text` — nearly double the next
   cluster. Snapback's own crates together are ~19.3 MB (~29%). If
   there is a code-size program after Phase 1, serde monomorphization
   is where the bytes are, not a dependency cut.

Guide blob recorded as its own line per Phase 0: `embedded-guide.v1.bin`
is 3,696,607 bytes in this build (20,900,889 decoded), so F4's cost is
no longer mixed into Rust rodata.

### Phase 1 stack, measured on Darwin

| Build | bytes | delta |
|---|---:|---:|
| `--release` (today's ship path) | 157,178,768 | — |
| `--profile production` (fat LTO, unstripped) | 119,771,264 | −37,407,504 |
| production + `strip -x` | 102,905,288 | −16,865,976 |
| **total** | | **−54,273,480 (−34.5%)** |

Section movement: `__text` 74,674,852 → 65,682,080; `__LINKEDIT`
38,912,000 → 18,284,544 → 1,409,024; symbols 264,500 → 118,109 → 6,254.

Phase 1d's primary policy — Cargo `[profile.production] strip =
"symbols"` — was then measured directly and is slightly better than the
`strip -x` row above: **102,641,248 bytes**, `__LINKEDIT` 1,163,264, and
**630** remaining symbols (against `strip -x`'s 102,905,288 / 1,409,024 /
6,254). Full stack: **157,178,768 → 102,641,248, −54,537,520 (−34.7%)**.

The stripped binary was confirmed to still load Hermes with `DYLD_*`
scrubbed: `snapback runtime-qualify` returns `ok: true` on the
`restricted-no-eval-handler-vm` probe, and the `@rpath/hermesvm.framework`
load command survives stripping.

That same receipt also demonstrates why Phase 1c is necessary rather
than bookkeeping: a **production** binary reports
`"buildProfile":"release"`, because `BinaryIdentity.build_profile` is
derived from `cfg!(debug_assertions)`. Profile and recipe are today
indistinguishable in the identity, exactly as 1c states.

### Linux, measured (2026-08-28)

Measured on an idle Hetzner fleet host (`expo-build-450b`, Ubuntu 24.04,
12 cores), same commit, same canonical public-package command:

| Build | bytes | `.text` | `.rodata` | symbols | dynsyms |
|---|---:|---:|---:|---:|---:|
| `--release` | 185,253,424 | 90,780,064 | 27,131,256 | 292,628 | 636 |
| `--profile production` + strip | 122,595,864 | 82,608,640 | 25,862,821 | **0** | 625 |

**−62,657,560 bytes (−33.8%)**, proportionally consistent with Darwin's
−34.7%. Linux is heavier in absolute terms, as F1 already recorded.

Two 1d requirements are confirmed on this platform:

- **The dynamic symbols Hermes needs survive.** `strip = "symbols"`
  removes the full symbol table (292,628 → 0) while leaving the dynamic
  symbol table nearly intact (636 → 625).
- **The stripped binary still loads Hermes.** `runtime-qualify` on the
  stripped Linux binary returns `ok: true` on the
  `restricted-no-eval-handler-vm` probe, from a clean tree
  (`gitDirty: false`).

Guide artifact in that build: 3,703,242 bytes.

This is the platform half of Phase 1's exit evidence for 1d only. The
full Phase 1 exit still requires 1a and 1c, plus package/tarball bytes,
attestation, seal verification, and cold install on both platforms.

This **beats LLP 0314.000 Phase 1's stated ~110–130 MB success band**
and lands in what that plan called LTO upside. Two of the plan's
expectations need correcting: it predicted `__text` would shrink 15–25 MB
from fat LTO (actual: 9.0 MB), and it attributed the `__LINKEDIT`
collapse to strip, when fat LTO alone did more than half of it
(38.9 → 18.3 MB before any strip). `strip -x` is the optional
measurement row; Phase 1d's Cargo `strip = "symbols"` is the primary
policy and may differ.

## Evidence

| Source | What it binds |
|---|---|
| npm `@expo/snapback-runtime-darwin-arm64@0.1.27` | `unpackedSize` 186,720,037 bytes; 18 files; local tarball **52 MB** |
| npm `@expo/snapback-runtime-linux-x64@0.1.27` | `unpackedSize` 248,155,233 bytes; 21 files; local tarball **70 MB** |
| `~/snapback-release-ledgers/fastpath-ledger-0.1.27-98681377721e.json` | Same unpacked sizes; JS packages in the closure are a few MB combined |
| `packages/snapback-runtime-darwin-arm64/bin/snapback` | 159,336,256 bytes; Mach-O arm64 |
| `size -m` / `otool -l` on that binary | Sections in Finding 2 |
| `scripts/binary-size-baseline.json` | Debug: 489,895,784 bytes (2026-08-22); `nsyms` 3,173,196 |
| `target/debug/snapback` in this checkout | 530,235,976 bytes |
| `packages/snapback-runtime-darwin-arm64/prepare-runtime.mjs` | Copies `target/release/snapback`, not `target/production/snapback` |
| `tests/ci_workflows_v0.mjs` | Canonical public-package command is `SNAPBACK_BUILD_DISTRIBUTION=public-package cargo build --release --bin snapback` |
| `Cargo.toml` `[profile.production]` | `lto = "fat"`, `codegen-units = 1`, `incremental = false` |
| `crates/snapback-server/build.rs` `emit_embedded_guide` | Packs the checked `guide/` corpus (except `eval-runs/`) into `embedded-guide.v1.bin` |
| `crates/snapback-server/src/guide.rs` | `include_bytes!(…/embedded-guide.v1.bin)` |
| `du` / `wc -c` on `guide/` | ~20 MB on disk; ~20.6 MB of `.md`+`.json` |
| LLP 0126 | Historical co-packaging cost: “~48 MB binary plus the framework” |

No `cargo bloat` or `bloaty` run is retained for a production-profile
binary. Crate-level size *attribution* below is therefore structural
(the dependency is on the default graph) rather than measured bytes.

## Findings

### F1. The shipped Darwin runtime is ~159 MB for the server, ~187 MB for the package

**Confidence:** high (registry `unpackedSize`, local tarball, local
binary `stat`).

On Apple silicon, `npm install @expo/snapback-cli@0.1.27` pulls the
Darwin runtime as an optional dependency and lands:

- **~52 MB** compressed download for the runtime tarball, **~3 MB** more
  for the JS closure (cli, client, codegen, contract, react,
  acceptance);
- **~187 MB** unpacked runtime on disk, **~18 MB** more JS.

Client-only installs (`@expo/snapback-client`) are a different product:
**~0.6 MB** tarball / **~2.8 MB** unpacked, plus contract. They do not
carry the server. This research is about the local-dev / sidecar
runtime, not the browser SDK.

Linux x64 is the same JS plus a **~70 MB** tarball / **~248 MB**
unpacked runtime (`libhermesvm.so` + ICU in `lib/`).

There is no crates.io server crate. LLP 0141 already recorded why:
Hermes artifacts blow crates.io’s 10 MB compressed limit — the
immediate blocker — and 0141 also records path-dependency, artifact
acquisition/custody, qualification, and publication-metadata
requirements that a smaller binary would not satisfy by itself. npm + a
platform runtime tarball is the distribution path.

### F2. The 159 MB is three kinds of weight, not one

**Confidence:** high (Mach-O sections on the packaged Darwin binary).

| Piece | Bytes | Meaning |
|---|---:|---|
| `__text` | 67,409,876 | Real machine code (~67 MB) |
| `__const` | 38,058,440 | Read-only data: type names, panic strings, tables, embedded Guide |
| `__LINKEDIT` | 35,160,064 | Symbol table / relocs; `nsyms` **241,187**, `strsize` **28,510,400** |
| `__eh_frame` | 7,381,068 | Unwind |
| `__gcc_except_tab` | 4,234,976 | Exception/LSDA tables — mixed Rust and C++ (SQLite is C; Hermes glue is C++; Rust emits LSDA too); attribution pending a Phase 0 bloat run |
| `__cstring` | 2,860,766 | C strings |
| `__DATA_CONST` + `__DATA` | ~2.9 MB | GOT, data, TLS |
| File | 159,336,256 | |

`dwarfdump --debug-info` on the packaged binary is empty: DWARF is gone,
the **symbol table is not**. A consumer of the npm package pays ~35 MB
of `__LINKEDIT` for names the process does not need at runtime.

The ~530 MB debug binary is the same program plus ~278 MB of
`__LINKEDIT` and ~3 million symbols (baseline in
`scripts/binary-size-baseline.json`; LLP 0010 is the policy, not the
number). That is the correct developer shape. It is not evidence that
the *ship* path is healthy.

### F3. The publish path does not use the production profile the workspace already defined

**Confidence:** high (packager + CI pin + Cargo.toml).

LLP 0276 and root `Cargo.toml` split two release shapes:

- `[profile.release]` — `incremental = true`, no LTO. For the in-window
  edit loop.
- `[profile.production]` — inherits release, `incremental = false`,
  `lto = "fat"`, `codegen-units = 1`. For the shipped binary.

The packer (`packages/snapback-runtime-darwin-arm64/prepare-runtime.mjs`)
copies `target/release/snapback` by default (env override
`SNAPBACK_RUNTIME_SOURCE_BINARY`). The public-package identity command
pinned in `tests/ci_workflows_v0.mjs` is `cargo build --release --bin
snapback` under `SNAPBACK_BUILD_DISTRIBUTION=public-package`.

The miss is the whole **public manufacture** graph, not one packer
default: the Linux packer defaults the same way
(`SNAPBACK_RUNTIME_LINUX_X64_SOURCE_BINARY`),
`.github/workflows/linux-runtime-package.yml` both builds `--release`
and issues source receipts on `target/release/snapback`, both native
jobs in `.eas/workflows/qualified-package-staging.yml` build
`--release`, and so does `scripts/build-linux-runtime-release`.
Distinct from that graph, `scripts/assemble-runtime-package` also
builds `--release` — but *intentionally*: it is the contributor
source-checkout repair path (`--source-test-staging
--strict-clean-release`), whose custody LLP 0010/0041 and the linked
CLI deliberately keep on ordinary release. It is not ship-profile
drift.

So the npm binary is an incremental-friendly release link, not the
fat-LTO image the architecture RFC named. That is packaging drift, not
a missing design.

### F4. The entire Guide corpus is compiled into the server — by design, at a cost now worth revisiting

**Confidence:** high (build.rs walk + `include_bytes!` + `du`).

`crates/snapback-server/build.rs` walks `guide/`, skips only
`eval-runs/`, and writes one inert `embedded-guide.v1.bin`
(`SNAPBACK_EMBEDDED_GUIDE\0\x01` + content hash + path/length/bytes).
`crates/snapback-server/src/guide.rs` includes that blob, plus a second
smaller embed: `include_str!` of `guide/guide-manifest.generated.json`.

This is a deliberate, governed choice, not drift: LLP 0061 §4a resolved
Guide carriage as *embedded-in-binary, always served* so the server is
the structural version authority and HTTP and MCP re-serve one
build-matched corpus, and LLP 0284 leans on the inert artifact +
committed decoder + directly-included manifest in its security design.
What has changed is the cost side: the checked `guide/` tree is
**~20 MB** (~20.6 MB of markdown and JSON) — a plausible majority of the
38 MB `__const` segment — versus roughly 130 KiB when 0061 decided. The
binary also rebuilds whenever a guide page changes.

The admin console carries the same “served from the running server” job
the opposite way: LLP 0041 ships it as package files under
`packages/snapback-runtime-*/admin/` (~4 MB in the Darwin tree). Any
carriage change must preserve 0061’s decided properties —
always-available, build-bound, one validated corpus across HTTP and
MCP — and amend LLP 0061/0041/0284, which is LLP 0314.000 Phase 2’s
job.

### F5. Hermes is not the size problem

**Confidence:** high for the packaged Darwin framework; medium for the
historical 48 MB figure.

Darwin `Frameworks/hermesvm.framework` is **~9.4 MB**. LLP 0000’s “binary
size matters” rationale for Ibex over V8 still holds: V8 would be
larger, not smaller.

LLP 0126’s co-packaging cost (“~48 MB binary plus the framework”) is
the last retained *product* size number in the corpus. The Darwin
server has since roughly **tripled**. This research does not reconstruct
the commit-by-commit growth; it records that the current ship image is
no longer that 48 MB binary.

### F6. The default `snapback` crate graph is not a ship graph

**Confidence:** high that the features are on; low-to-medium on how many
megabytes they add, because no bloat run exists.

`crates/snapback/Cargo.toml` `[dependencies]` enables:

- `snapback-server` with `test-support`
- `snapback-services` with `benchmark-support`

`crates/snapback-kernel/Cargo.toml` says the opposite in so many words:
the standard shipped binary does not enable `test-support`; published
builds must not enable it. Kernel’s own feature is empty and is *not*
on the `snapback` production deps. Server `test-support` currently
exposes a small `#[doc(hidden)] test_support` module (secret-read mint
bridge, one maintenance driver) — likely not tens of megabytes, but it
is the wrong graph. Services `benchmark-support` similarly gates a
telemetry recorder.

Separately, the *default* graph always carries crates that are size-
famous in Rust even when every call site is legitimate:

- `jsonschema` as a normal dependency on exactly two crates:
  `snapback-engine` (Ask in `ask.rs`) and the `snapback` crate itself
  (the kernel and `snapback-types` copies are `[dev-dependencies]`
  only);
- `schemars`;
- `image` (jpeg/png) and `kamadak-exif` on services and the binary crate;
- three password KDFs in kernel (`argon2`, `bcrypt`, `scrypt`);
- `tokio` with `full` on multiple crates;
- `rusqlite` bundled with `backup`, `column_decltype`, `functions`,
  `hooks`, `limits`, `serialize`;
- `clap` on `snapback-cli`, which the server binary links.

Those are product dependencies, not accidents. They explain why `__text`
is 67 MB for ~420k lines of product Rust plus C (SQLite, crypto). They
do **not** yet have a crate-ranked byte table. Finding 6 licenses “these
are on the ship graph,” not “jsonschema is N megabytes.”

### F7. This is large for the product shape, not large for “a Rust program with debug info”

**Confidence:** medium on the comparables (peer versions move; the
order-of-magnitude does not).

A local BaaS-in-a-process is the right neighborhood, not a database
server and not a JS runtime-as-the-product. Indicative sizes from
official release assets as of 2026-08-25 (peer versions move; “archive”
rows are compressed downloads, not executables, so they under-read):

| Neighbor | Kind | Darwin-arm64 size |
|---|---|---|
| PocketBase (Go, sqlite, auth, realtime, admin, files) | executable | ~30 MB (its compressed download is ~13 MB) |
| Deno / Bun (includes a JS engine) | compressed archive | ~25–37 MB |
| MinIO | executable | ~103 MB |
| Meilisearch | executable | ~116 MB |
| **Snapback `snapback` (0.1.27)** | **executable** | **~159 MB** |
| Cockroach-class | executable | 150 MB+ |

A **50 MB download** for “install a local backend” is acceptable. A
**159 MB unstripped non-LTO binary that also contains the docs** is
large relative to PocketBase and large relative to Snapback’s own 48 MB
memory. It is *not* in the “we shipped `target/debug`” class; that would
be ~500 MB.

Compressed, Darwin is already ~52 MB. Compression is hiding stringy
rodata and symbols. Disk and dyld still see 159 MB + 9.4 MB Hermes.

## What “core code” has to do with this

A 2026-08-25 checkout count of product source (crates/packages/clients/
admin-ui/cloudflare adapter; tests, demos, diaries, fixtures, templates,
and `vendor/` excluded) was roughly:

- **~420k** handwritten Rust plus **~12k** generated Unicode 17 tables
  (`crates/snapback-kernel/src/search/unicode17_generated.rs`);
- **~240k** JS/TS across the npm packages and the Cloudflare adapter;
- **~9k** Swift / Kotlin.

Dedicated Rust test files were another ~196k; in-src `#[cfg(test)]`
modules another ~90k by a brace heuristic. Those test counts
contextualize repository size only — an ordinary `cargo build --bin
snapback` does not compile integration tests or `#[cfg(test)]` modules
into the binary, so the debug binary’s 3 million symbols are
monomorphization and debug metadata, attributable only after an
`nm`/bloat pass (enabled `test-support` features are a separate,
smaller matter — F6).

This licenses “the program is large because the program is large” for
the 67 MB of `__text`. It does not license the 35 MB of symbols, the
embedded 20 MB Guide, or skipping fat LTO on the artifact people
download.

## Open questions

1. **Crate-ranked bytes on a production-profile, stripped Darwin
   binary.** Until `cargo bloat` / `bloaty` is retained, F6 cannot
   become a cut list. LLP 0314.000 Phase 0 is that measurement.
2. **How much of `__const` is the Guide blob vs. Rust type names and
   panic strings.** A `bloaty` compile-unit or section-symbol view after
   a Guide-out build would split F4 from the rest of rodata.
3. **Linux’s extra ~60 MB vs. Darwin.** Likely unstripped ELF + ICU
   `.so`s; not re-measured here beyond package `unpackedSize`.
4. **Whether any published consumer currently depends on symbolized
   crash stacks from the npm binary.** If yes, the strip step in
   0314.000 has to keep a parallel `.dSYM` / debuginfo artifact rather
   than deleting names outright.

## Hand-off

Diagnosis only. Work, budgets, and the ship-path size gate live in
[LLP 0314.000](./0314.000-reduce-shipped-runtime-size.plan.md).
