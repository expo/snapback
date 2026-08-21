# Debug Snapback binary grew to 489 MB with 278 MB of LINKEDIT data

**Status:** Investigated — remediation/drift metric open
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

## 2026-08-21 Phase 1D investigation

### Reproducible comparison

The suspected engine carve is commit `ed06d2b4b0d2d110c34774addf6d162add6a07c1`.
Its exact parent, `39a97e8c304a4e67ae66dd8e42f2ecec74d7908d`,
is an intentionally incomplete move-preservation commit: it contains
`crates/snapback-engine/src/**` but no engine `Cargo.toml`, so Cargo rejects the
workspace before compilation. The nearest complete first-parent baseline is
`1509190a0718eef90fc306018be66df3e81e5c27`; the like-for-like causal unit is
therefore `1509190a0..ed06d2b4b`.

Both historical sides used the same Apple Silicon host, Rust/Cargo 1.97.0,
locked dependencies, default features, cached Hermes framework digest
`sha256:9ea96338c0a22de4ddcd2d488d9940a32b601e49b6ddf419858fb36799d51024`,
and Cargo's dev defaults observed in the rustc command line:
`debuginfo=2` plus `split-debuginfo=unpacked`. Each exact artifact passed the
repository qualifier: executable launch and restricted no-eval handler-VM
creation. Concurrent host load caused the fixed 900-second bootstrap link
probe to time out (twice for the pre-carve monolith, once for the post-carve
build); the same `runtime-link-smoke.mjs` qualifier was then allowed a longer
ceiling and passed. Those are duration/capacity results, not compiler or
runtime-contract failures.

| Artifact | bytes | `__TEXT` | `__text` | `__LINKEDIT` | symbols | string table |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| complete pre-carve `1509190a0` | 482,953,672 | 206,438,400 | 125,818,488 | 272,433,152 | 3,152,437 | 160,139,032 |
| exact engine carve `ed06d2b4b` | 485,960,856 | 206,929,920 | 126,126,540 | 274,890,752 | 3,163,157 | 161,702,896 |
| current lane baseline `ca6c880de` | 490,180,200 | 207,863,808 | 126,479,796 | 278,167,552 | 3,173,196 | 164,024,360 |

The carve delta is 3,007,184 bytes (+0.623%). `__TEXT` grew 491,520
(+0.238%), `__text` 308,052 (+0.245%), `__LINKEDIT` 2,457,600
(+0.902%), the symbol count 10,720 (+0.340%), and the string table 1,563,864
(+0.977%). Even the current artifact is only 7,226,528 bytes (+1.50%) above
the complete pre-carve baseline. The engine carve therefore does not explain
the roughly 151 MB increase reported against the older written 338 MB
observation.

### Link and crate attribution

The current baseline was relinked with Apple's `-print_statistics` and a linker
map. The instrumented `cargo rustc` took 70.66 seconds wall under concurrent
host load. Summing ld's reported per-phase maximum times gives 19.850 seconds,
of which writing the diagnostic map itself consumed 3.065 seconds; the same
sum excluding that measurement overhead is 16.785 seconds. The largest
reported phases were layout (4.686 seconds), output-file writing (4.018
seconds), and map writing (3.065 seconds). This is the recorded baseline; total
compile wall observed during the historical qualifications is not a stable
link benchmark because those crates received highly variable CPU shares.

The map contains 1,506,011 live entries spanning 423,996,016 bytes and 454,516
dead-stripped entries spanning 102,452,928 bytes. Aggregating live extents by
owning archive/crate gives these leading Snapback contributors:

| crate/archive | live extent bytes | live symbol entries |
| --- | ---: | ---: |
| `snapback_server` | 64,421,855 | 419,903 |
| `ibex_runtime` | 25,492,738 | 112,815 |
| `snapback_kernel` | 21,506,296 | 154,809 |
| `snapback_types` | 10,405,927 | 85,916 |
| `snapback_engine` | 9,845,691 | 67,500 |
| `snapback_cli` | 7,825,471 | 66,644 |
| `snapback_sync` | 4,081,698 | 29,003 |
| `snapback_services` | 3,908,666 | 30,745 |

These extents are attribution evidence, not additive Mach-O section sizes.
They put the engine crate at only 2.32% of mapped live extent, versus 15.19%
for `snapback_server`. The current debug rlibs tell the same directional story:
server is 949 MB, Ibex 493 MB, kernel 245 MB, types 163 MB, CLI 151 MB, and
engine 131 MB. Rlib sizes are also non-additive, but neither analysis identifies
the engine boundary as the dominant source.

The final artifact is instead systemically symbol-heavy: `__LINKEDIT` is
278,167,552 bytes (56.75% of the 490 MB binary), and its 164,024,360-byte
string table alone is 33.46% of the whole binary and 58.97% of `__LINKEDIT`.
The linker also warns that `__eh_frame` exceeds 16 MB. This supports follow-up
work on the broad server/generic/symbol surface, not a rollback of the engine
carve and not blind stripping.

### Developer-profile recommendation

Retain **full split debug information** as the default developer posture for
now, and do not change `Cargo.toml` in this lane.

- Full inline debug is rejected: the current default is already full DWARF
  with unpacked split debug, and moving that information inline cannot address
  the demonstrated symbol/string-table concentration.
- Reduced debug with an opt-in full-symbol profile is a plausible experiment,
  but this investigation did not establish its size benefit or qualify LLDB
  locals, file/line crash symbolication, and actionable failure evidence under
  that profile. The repository qualifier proves launch and handler-VM creation;
  it does not prove those debugging contracts.
- Full split debug is the only option here with qualified launch/VM evidence
  and no intentional loss of crash/debug information. The exact carve adds
  only 0.623%, so there is no attribution-supported reason to trade that
  evidence away as a refactor correction.

The issue remains open for two bounded follow-ups: add a binary-size/
`__LINKEDIT` drift metric, and run a separately named reduced-debug experiment
with explicit LLDB/crash-symbolication acceptance before reconsidering a
default/opt-in profile pair. No stripping or profile change is part of this
resolution.
