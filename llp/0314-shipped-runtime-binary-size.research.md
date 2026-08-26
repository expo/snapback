# LLP 0314: Shipped runtime binary size

**Type:** Research
**Status:** Draft
**Systems:** Packaging, Build, Runtime, Distribution, Developer experience
**Author:** Charlie Cheever / Grok
**Date:** 2026-08-25
**Related:** LLP 0000, LLP 0010, LLP 0041, LLP 0126, LLP 0141, LLP 0276,
LLP 0314.000

## Summary

The npm-shipped Snapback server is large for a local backend people
`npm install`. The Darwin **0.1.27** runtime package unpacks to **~178 MB**
(18 files); its `bin/snapback` is **~159 MB** on disk and compresses, with
Hermes and the admin snapshot, into a **~52 MB** tarball. Linux is heavier:
**~237 MB** unpacked / **~70 MB** tarball, because ICU and `libhermesvm.so`
ride next to the binary.

This is not a mistaken debug build. The qualified developer binary is
*supposed* to be fat (LLP 0010: ~490–530 MB with full split debug). The
shipped artifact is a `--release` Mach-O that still carries **241k
symbols**, **~20 MB of embedded Guide**, and **no fat LTO**, even though
the workspace already defines `[profile.production]` for the ship path
(LLP 0276) and already sidecars the admin UI in the npm package (LLP
0041).

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
  **~9.4 MB**. That is cheap next to 64 MB of Snapback `__text` and 34 MB
  of leftover symbols. LLP 0141’s **74 MB** figure is the vendored
  `vendor/ibex/ios/Frameworks` checkout, not the shipped framework.
- **Not a claim about HEAD.** Numbers below are the **0.1.27** closure
  (`98681377721e`, holding tag `fastpath-0-1-27-98681377721e`) plus the
  Darwin `bin/snapback` sitting in
  `packages/snapback-runtime-darwin-arm64/` of this checkout. The tree
  moves; the *shape* of the waste does not depend on a few days of
  growth.

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

### F1. The shipped Darwin runtime is ~159 MB for the server, ~178 MB for the package

**Confidence:** high (registry `unpackedSize`, local tarball, local
binary `stat`).

On Apple silicon, `npm install @expo/snapback-cli@0.1.27` pulls the
Darwin runtime as an optional dependency and lands:

- **~52 MB** compressed download for the runtime tarball, **~3 MB** more
  for the JS closure (cli, client, codegen, contract, react,
  acceptance);
- **~178 MB** unpacked runtime on disk, **~18 MB** more JS.

Client-only installs (`@expo/snapback-client`) are a different product:
**~0.6 MB** tarball / **~2.8 MB** unpacked, plus contract. They do not
carry the server. This research is about the local-dev / sidecar
runtime, not the browser SDK.

Linux x64 is the same JS plus a **~70 MB** tarball / **~237 MB**
unpacked runtime (`libhermesvm.so` + ICU in `lib/`).

There is no crates.io server crate. LLP 0141 already recorded why:
Hermes artifacts blow crates.io’s 10 MB compressed limit. npm + a
platform runtime tarball is the distribution path.

### F2. The 159 MB is three kinds of weight, not one

**Confidence:** high (Mach-O sections on the packaged Darwin binary).

| Piece | Bytes | Meaning |
|---|---:|---|
| `__text` | 67,409,876 | Real machine code (~64 MiB) |
| `__const` | 38,058,440 | Read-only data: type names, panic strings, tables, embedded Guide |
| `__LINKEDIT` | 35,160,064 | Symbol table / relocs; `nsyms` **241,187**, `strsize` **28,510,400** |
| `__eh_frame` | 7,381,068 | Unwind |
| `__gcc_except_tab` | 4,234,976 | C++ exception tables (SQLite / Hermes glue, not Rust panics alone) |
| `__cstring` | 2,860,766 | C strings |
| `__DATA_CONST` + `__DATA` | ~2.9 MB | GOT, data, TLS |
| File | 159,336,256 | |

`dwarfdump --debug-info` on the packaged binary is empty: DWARF is gone,
the **symbol table is not**. A consumer of the npm package pays ~34 MB
of `__LINKEDIT` for names the process does not need at runtime.

The 500 MB debug binary is the same program plus ~278 MB of
`__LINKEDIT` and ~3 million symbols (LLP 0010 baseline). That is the
correct developer shape. It is not evidence that the *ship* path is
healthy.

### F3. The publish path does not use the production profile the workspace already defined

**Confidence:** high (packager + CI pin + Cargo.toml).

LLP 0276 and root `Cargo.toml` split two release shapes:

- `[profile.release]` — `incremental = true`, no LTO. For the in-window
  edit loop.
- `[profile.production]` — inherits release, `incremental = false`,
  `lto = "fat"`, `codegen-units = 1`. For the shipped binary.

The packer (`packages/snapback-runtime-darwin-arm64/prepare-runtime.mjs`)
copies `target/release/snapback`. The public-package identity command
pinned in `tests/ci_workflows_v0.mjs` is `cargo build --release --bin
snapback` under `SNAPBACK_BUILD_DISTRIBUTION=public-package`.

So the npm binary is an incremental-friendly release link, not the
fat-LTO image the architecture RFC named. That is packaging drift, not
a missing design.

### F4. The entire Guide corpus is compiled into the server

**Confidence:** high (build.rs walk + `include_bytes!` + `du`).

`crates/snapback-server/build.rs` walks `guide/`, skips only
`eval-runs/`, and writes one inert `embedded-guide.v1.bin`
(`SNAPBACK_EMBEDDED_GUIDE\0\x01` + content hash + path/length/bytes).
`crates/snapback-server/src/guide.rs` includes that blob.

The checked `guide/` tree is **~20 MB** (~20.6 MB of markdown and JSON).
That is a plausible majority of the 36 MB `__const` segment. The binary
also rebuilds whenever a guide page changes.

The admin console is *not* embedded this way. LLP 0041 already ships it
as package files under `packages/snapback-runtime-*/admin/` (~4 MB in
the Darwin tree). The Guide is the inconsistent sibling: same
“served from the running server” job, opposite carriage.

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

- `jsonschema` on `snapback-engine` (Ask in `ask.rs`) and on the
  `snapback` crate itself;
- `schemars`;
- `image` (jpeg/png) and `kamadak-exif` on services and the binary crate;
- three password KDFs in kernel (`argon2`, `bcrypt`, `scrypt`);
- `tokio` with `full` on multiple crates;
- `rusqlite` bundled with `backup`, `column_decltype`, `functions`,
  `hooks`, `limits`, `serialize`;
- `clap` on `snapback-cli`, which the server binary links.

Those are product dependencies, not accidents. They explain why `__text`
is 64 MB for ~420k lines of product Rust plus C (SQLite, crypto). They
do **not** yet have a crate-ranked byte table. Finding 6 licenses “these
are on the ship graph,” not “jsonschema is N megabytes.”

### F7. This is large for the product shape, not large for “a Rust program with debug info”

**Confidence:** medium on the comparables (peer versions move; the
order-of-magnitude does not).

A local BaaS-in-a-process is the right neighborhood, not a database
server and not a JS runtime-as-the-product:

| Neighbor | Typical published binary |
|---|---|
| PocketBase (Go, sqlite, auth, realtime, admin, files) | ~13 MB |
| PostgREST / Hasura / Meilisearch class | ~10–50 MB |
| Deno / Bun (includes a JS engine) | ~80–90 MB |
| MinIO | ~100 MB |
| **Snapback Darwin `snapback` (0.1.27)** | **~159 MB** |
| Cockroach-class | 150 MB+ |

A **50 MB download** for “install a local backend” is acceptable. A
**159 MB unstripped non-LTO binary that also contains the docs** is
large relative to PocketBase and large relative to Snapback’s own 48 MB
memory. It is *not* in the “we shipped `target/debug`” class; that would
be 500 MB.

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
modules another ~90k by a brace heuristic; the debug binary’s 3 million
symbols are those tests plus monomorphization, not a third copy of the
kernel.

This licenses “the program is large because the program is large” for
the 64 MB of `__text`. It does not license the 34 MB of symbols, the
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
