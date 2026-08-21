# Debug Snapback binary grew to 489 MB with 278 MB of LINKEDIT data

**Status:** Open
**Systems:** Rust build, developer runtime, crate boundaries
**Date:** 2026-08-20/21
**Evidence:** commit `708e2e5c5348b5bb863cd7120afbafad9db99e9a`, Apple
Silicon debug build produced by `scripts/bootstrap-ibex-runtime`

## Observation

`target/debug/snapback` is currently 488,991,560 bytes (about 489 MB decimal,
466 MiB). The nearest written comparison in this repository is the 2026-08-11
closed devserver ticket, which describes a "338 MB binary." The current file is
therefore roughly 151 MB / 45% larger than that recorded artifact. This confirms
a substantial recent increase even though it does not prove one causal commit.

The current Mach-O points first at symbol/debug-linkage volume:

- `__TEXT`: about 207 MB;
- `__LINKEDIT`: 277,594,112 bytes;
- `LC_SYMTAB.nsyms`: 3,170,076;
- symbol string table: 163,594,504 bytes.

The largest debug rlibs are also very large: `snapback_server` 924 MB,
`ibex_runtime` 493 MB, `snapback_kernel` 236 MB, `snapback_types` 162 MB,
`snapback_cli` 150 MB, and the newly separated `snapback_engine` 130 MB. Rlib
sizes are not additive final-binary attribution, but they are consistent with
duplicated debug metadata and/or monomorphized code across the refactored crate
boundaries.

## Why it matters

The debug binary is the ordinary bootstrap/dev/benchmark runtime. Its size
affects link time, disk/cache pressure, worktree bootstrap cost, remote transfer,
and the frequency with which developers avoid rebuilding a stale binary. The
increase is especially noticeable because `main` moves continuously and the
runtime-readiness receipt is digest-bound to the exact binary.

## Wanted

1. Rebuild comparable commits around the transport-independent engine refactor
   with the same Rust toolchain, target, features, Hermes artifacts, and debug
   profile; record bytes, `__TEXT`, `__LINKEDIT`, symbols, and link wall.
2. Produce crate/generic attribution (for example, linker map plus `cargo bloat`
   or an equivalent Mach-O analysis) before deciding the fix.
3. Check for accidental duplication caused by feature unification, multiple
   codegen units, generic instantiation across server/kernel/engine boundaries,
   and full DWARF retained in both dependencies and the final executable.
4. Establish a developer-oriented posture: a documented split-debuginfo or
   reduced-debug profile if it preserves the diagnostics/bootstrap contract,
   plus a drift metric so another 45% jump is visible.

Do not optimize by stripping the qualified artifact blindly: runtime readiness,
crash diagnostics, and local debugging need an explicit, tested posture.
