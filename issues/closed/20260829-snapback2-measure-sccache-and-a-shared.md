# snapback2: measure sccache and a shared cargo build-dir across lanes

**Status:** Open
**Systems:** snapback2, build loop
**Severity:** P3
**Author:** Claude Fable 5, directed by Charlie Cheever
**Date:** 2026-08-29
**Related:** LLP 1000, LLP 0316

Eliot's suggestion (relayed 2026-08-29): Mozilla's sccache (RUSTC_WRAPPER=sccache) caches rustc invocations for dependency crates across worktrees on a local disk cache; it does not cache incremental compilation and cannot cache bin/proc-macro/cdylib crates, so it speeds a lane's cold build, not the inner loop, and does not reduce disk. Cargo 1.97 has stable build.build-dir with {workspace-path-hash} for sharing intermediates. Measure both with snapback2/scripts/measure.mjs --cold on two lanes before adopting either; the first fix is the small dependency tree. Sources: https://github.com/mozilla/sccache/blob/main/docs/Rust.md, https://doc.rust-lang.org/cargo/reference/config.html

## Triage — 2026-09-11 (UTC)

**Disposition:** Open — deferred optimization. **Triage priority:** P3.
**Audit source:** `15c134d056`; Codex, on the author's request to reconcile tickets.
This disposition supersedes stale current-work claims above; historical observations remain unchanged.

No adoption or paired cold-lane comparison is established. Current warm named lanes already avoid fresh-checkout cost; this is a measurement experiment, not a demonstrated product defect.

LLP 1002 §11 and snapback2/scripts/measure.mjs separate cold build, incremental build and consumer costs. Next: compare two warm named lanes with/without the proposed cache, keeping disk and incremental costs separate. Do not add a cache dependency from this ticket alone.

## Resolution — 2026-09-11

**Status: Closed — measured; no global adoption.** A sequential paired series
on the reusable Silver M5 Max worktrees used exact source `350caddd31`, Cargo
1.97.0, and the same release build command for both native packages. The
machine was otherwise free of task-owned builds.

The ordinary cold build took **33.71 s**. Filling an empty sccache 0.17 cache
took **34.53 s**, while disabling incremental compilation changed the
one-source-touch proxy from **1.61 s** to **10.43 s**. After restarting the
sccache server with the second worktree as `SCCACHE_BASEDIRS`, the second
worktree cold build took **14.96 s**: all 113 cacheable requests hit, zero
missed, and 36 linker/crate-type calls remained non-cacheable. That is a 55.6%
cold-build improvement, but it is the wrong default for the normal incremental
loop.

A constant shared Cargo `build-dir` took **33.49 s** to fill and **21.05 s**
from the second worktree sequentially, while growing from 637 MiB to 968 MiB.
It also makes independent Cargo processes contend for one artifact directory.
The documented `{workspace-path-hash}` form isolates distinct worktree
manifest paths, so it does not provide this cross-worktree reuse.

Decision: keep repository defaults unchanged. Cold qualification jobs may opt
in to normalized sccache explicitly (`RUSTC_WRAPPER=sccache`,
`CARGO_INCREMENTAL=0`, lane root in `SCCACHE_BASEDIRS`); ordinary edit/build
work retains Cargo incremental compilation. Do not point concurrent lanes at
one constant build directory. The compact source-bound evidence, including
the unrelated full-measure limitations, is in
`benchmarks/runs/2026-09-11-snapback2-cache-lanes/measurement.json`.
