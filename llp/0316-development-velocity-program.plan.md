# LLP 0316: Development velocity program — a stopwatch, not a rewrite

**Type:** Plan
**Status:** Accepted
**Systems:** Build, Verification, CI, Project, Developer experience
**Author:** Charlie Cheever / Claude (Fable 5, orchestrating codex gpt-5.6-sol)
**Date:** 2026-08-27
**Revised:** 2026-08-27 (Phases 1–2 implemented and proven; Phase 3 measured
and closed with negative results; Phase 5 consolidation landed (79 → 13
integration link targets, 0 semantic change); first `--timings` record;
Open Question 2 answered. Accepted by
author direction the same day — "write this up as an LLP and then execute
on it".)
**Related:** LLP 0276, LLP 0283, LLP 0314, LLP 0175, LLP 0189, LLP 0232,
LLP 0031, LLP 0041, LLP 0287, LLP 0289, LLP 0225, LLP 0010

## Summary

The author asked whether Snapback should get the same treatment as the
`exact2` project — a fresh start whose only design goal is speed of
development — or whether ~740k lines of Rust simply cost what they cost.
This plan answers with measurements: **the Rust volume is a second-order
cost; the first-order costs are self-inflicted and repairable in place.**
The inner loop is dominated by (1) build-script invalidation that fires on
every git operation, (2) a linear crate tower with a 226k-line base, (3)
half-gigabyte debug binaries relinked per edit across 83 link targets, and
(4) a verification layer whose fast required signal has been switched off.

The program adopts exact2's discipline — **one metric above every other
goal** — without its method. No rewrite, no `snapback2`, no second
"one-shot rearchitecture" (LLP 0276 already did one, and the god files it
named as problem #2 walked straight through it because nothing held the
work to a clock). Every phase below has a measured acceptance and lands
independently under LLP 0232's optimistic-landing default.

## Author ruling (2026-08-27)

1. **The metric.** Two numbers, re-measured on an Apple Silicon primary
   checkout and recorded in this document at each phase:
   - **Edit→result**: wall time from saving a one-line change in
     `crates/snapback-server/src/server.rs` to (a) a runnable
     `target/debug/snapback` and (b) a runnable server unit-test binary.
   - **Git→cargo tax**: wall time of `cargo build -p snapback` immediately
     after a git operation that changed no source (`git add`, a commit on a
     sibling branch, `git checkout -- <unchanged file>`). Target: **0 s**
     above the true no-op.
2. **Scope is the developer's clock only.** Shipped-binary size, packaging,
   and the security gates keep their own owners (LLP 0314, LLP 0283 F-1/F-2).
   This plan may not weaken any correctness property those documents rely
   on — in particular the build-identity contract of LLP 0031 (a binary
   must never self-report a commit or clean state it was not built from;
   ENG-23365) is preserved, not relaxed.
3. **No new gate may require a complete proof at an exact commit**
   (LLP 0189 D-6). Velocity work that *adds* verification must add it to
   the fast affected path or to the scheduled battery, never to the landing
   path.

## Baseline — measured 2026-08-27 on `main` (f16d432db era)

### Inner loop (Apple Silicon, warm `target/`, 28 GB)

| Loop | Wall time |
| --- | --- |
| True no-op `cargo build -p snapback` (nothing changed, no git activity) | 0.65 s |
| Edit `server.rs` → `target/debug/snapback` | **68 s** |
| Edit `engine.rs` → engine unit-test binary (`cargo test -p snapback-engine --lib --no-run`) | **81 s** (binary: 302 MB) |
| Relink alone (revert the edit, rebuild) | 15 s |
| `touch .git/index` → `cargo build -p snapback` | **17 s**, recompiling sync, services, activation, engine, cli, server |
| `cargo check --workspace --all-targets` after a kernel edit | 22–29 s (and red — see "Test currency") |
| `git checkout -- <file>` then `cargo check -p snapback-engine` | 40 s (the same tax, paid through `check`) |
| Cold build of `snapback` in a fresh worktree (`scripts/bootstrap-ibex-runtime`, incl. link + launch qualification) | 126 s wall / 670 s CPU |

The cold build is not the problem: two minutes for 741k lines plus 563
dependency packages is ordinary. The incremental loop is.

The `engine` test binary itself starts in 0.02 s and runs a unit test in
0.06 s: the cost is entirely compile + link, never the test.

### Why git operations cost 17 seconds

`crates/snapback-types/build_identity.rs` — included by the **kernel**,
server, and tools build scripts — declares `cargo:rerun-if-changed` on
`.git/HEAD`, `.git/index`, the whole `refs/heads/` directory of the
*common* git dir, and `packed-refs`; `crates/snapback-server/build.rs`
carries a second copy of the same list. Kernel is the base of the crate
tower, so any change to those paths re-runs the kernel build script,
rewrites its `OUT_DIR` catalog, and recompiles every crate above it.

Three of the four triggers fire far more often than the fact they protect
changes:

- `.git/index` changes on every `git add`, `git rm --cached`,
  `git checkout -- <file>`, `git stash`, and on index refreshes performed by
  `git status` itself. None of these change the commit or the
  scoped dirty verdict (`git status --porcelain -- <runtime inputs>` already
  reports staged changes as dirty; source edits are already tracked by the
  recursive `rerun-if-changed` on `scripts/runtime-build-inputs.txt`
  pathspecs).
- `refs/heads/` is **shared by all 89 registered worktrees** of this
  checkout. A commit by any concurrent session on any branch invalidates
  every other session's build. With `main` taking ~4,900 commits per 30
  days across a fleet, this is close to continuous.
- `packed-refs` is rewritten by periodic ref packing and by fetches that
  trigger it.

Only `HEAD` (branch switches, detached checkouts) and the *current branch's*
ref file (commits, `reset --soft`, `update-ref` — the ENG-23365 cases) carry
the fact the stamp reports.

`snapback-server/build.rs` additionally declares `rerun-if-changed` on the
entire `guide/` tree (192 pages) because it serializes the guide corpus into
an embedded artifact. Every docs edit therefore recompiles the 110k-line
server crate and relinks every binary above it.

### Structural shape

- **Crate graph is a linear tower, not a DAG.**
  `types → kernel (226k) → auth → {sync, services, activation} → engine (125k) → server (110k) → cli → snapback`.
  Cargo has almost nothing to parallelize, and an edit at any level
  cascades to every level above it.
- **The god files survived LLP 0276** (which listed them as problem #2 and
  measured them): `engine/src/local/engine.rs` 44,968 lines,
  `server/src/server.rs` 35,219, `kernel/src/storage.rs` 24,729 — each with
  a test sibling of 24–44k lines. Total: 741,326 lines across 460 files in
  `crates/`; 3,926 `#[test]` functions.
- **83 integration-test link targets** (79 under `crates/snapback/tests/`);
  811 MB of test executables in `target/debug/deps`. The debug `snapback`
  binary is 533 MB (LLP 0314 and
  `issues/20260820-debug-binary-symbol-bloat.md` record 489 MB one week
  earlier; 278 MB of that is `LINKEDIT`). Linking is the fixed cost that
  makes even a one-line edit pay 15 s.
- **No dev-profile tuning exists.** No `[profile.dev]` block: full DWARF for
  every crate and dependency, no `line-tables-only`, no dependency
  `opt-level`, no linker selection on Linux.

### Test currency

`crates/snapback-kernel/src/storage/tests.rs:17411` (and three sibling
sites) `include_str!` gitignored demo outputs
(`demos/{todo,rbac,team-chat}/snapback/generated/*.manifest.json`). On a
checkout that has not run codegen for exactly those demos, the **entire
kernel lib-test crate fails to compile** — 1,000+ tests unreachable because
one test's fixture is missing, with an error that names a path, not the
command that produces it.

### The verification layer

- `required-surface-builds` — the fast required check — ran 55 times on
  2026-08-24, all red on a stale committed review manifest
  (`demos/all-aboard/snapback/generated/artifacts.json`, since regenerated in
  714eefaed). Later that day the author's temporary low-noise posture
  (LLP 0189 revision of 2026-08-24, eb72d10b0; restoration owned by
  `issues/20260824-restore-automatic-actions-after-low-noise-interval.md`)
  made it `workflow_dispatch`-only: in the hour before the ruling, 16 pushes
  had produced 130 runs, 66 failed and 40 cancelled. **It has not run
  since.** The gate passes locally on `origin/main` in 35 s.
- `local-proof` (180 gate `run` declarations in a 902-line shell script plus
  a 41-id selection policy) takes 57–145 min per scheduled run and every
  recent run failed. `app-bound-linux-qualification` fails or is cancelled
  on push. Only `ref-check` is green on push.
- 41 open `issues/` tickets carry drift / inherited-red / stale / flake in
  the title. Process mass for orientation: 322 LLPs (277k lines), 459 open
  tickets, 177 scripts (79k lines).

The velocity cost here is not the minutes; it is that **no signal a
developer can act on arrives within the landing loop**, so LLP 0232's
"reds are fix-forward tickets" default has no red to fix forward from.

## Diagnosis — where the time goes, ranked by (payoff ÷ cost)

1. **Git-triggered invalidation** (17 s per git operation, fleet-wide,
   fires on other sessions' commits). Cost to fix: two build-script edits.
2. **Guide-tree invalidation of the server crate.** Cost: a leaf crate.
3. **Whole-crate compile failure on missing generated fixtures.** Cost: four
   test-site edits.
4. **Link cost** (533 MB debug binary, 302 MB test binaries, 83 targets).
   Cost: profile settings (cheap) and test-binary consolidation (moderate,
   touches the LLP 0287 inventories).
5. **The tower** (kernel as the 226k-line base). Cost: high; needs
   `cargo build --timings` evidence before any split is proposed.
6. **The required signal is off.** Cost: a workflow trigger plus a decision
   about who repairs stale committed artifacts.

## Design principles

- **Invalidate on the fact, not on the proxy.** A build input is something
  whose change can alter the artifact's bytes or the truth of a stamp it
  carries. The current branch ref is an input; a sibling branch's ref is
  not; the index is not.
- **Expensive things in leaf crates.** Anything that changes on a cadence
  unrelated to Rust source (the guide corpus, the identity stamp) lives in
  its own tiny crate so its invalidation stops there.
- **A missing precondition is one loud failing test, never a compile
  error.** Convert `include_str!` of generated fixtures into runtime reads
  that fail with the exact command that repairs them. (This is the
  loud-refusal rule of LLP 0232's verification posture applied to test
  fixtures; it is not a skip.)
- **Measure before restructuring.** No crate split or god-file carve lands
  under this plan without a before/after row in the baseline table.
- **Land each phase alone.** Every phase is independently reviewable and
  reversible; none waits for another.

## The program

### Phase 1 — Build-identity invalidation (surgical)

Edit `crates/snapback-types/build_identity.rs` and
`crates/snapback-server/build.rs` (which should include the shared file
rather than carry a copy):

- Drop `.git/index` from the tracked set.
- Replace the `refs/heads` directory with the **resolved current-branch
  ref file** (`git symbolic-ref -q HEAD` → `<common>/refs/heads/<branch>`
  when it exists on disk). Keep `HEAD` and `packed-refs` (a commit on the
  current branch whose ref is packed-only still lands in `packed-refs`).
- Keep the recursive `rerun-if-changed` on the runtime-input pathspecs —
  that is what makes ENG-23365's "uncommitted code, stale clean stamp" case
  impossible, and it is untouched.

Acceptance (all measured, recorded below):

- `touch .git/index` → `cargo build -p snapback` is a true no-op (≤ 1 s).
- A commit on a sibling branch of the same repository → true no-op.
- A commit on the current branch → re-stamp (build script re-runs; the
  `/health` commit changes). `git reset --soft HEAD~1` → re-stamp.
- `embedded_catalog_build_identity_matches_the_enclosing_binary` and the
  server identity tests still pass.

**Implemented 2026-08-27.** The tracked git inputs are now exactly the
per-worktree `HEAD`, the per-worktree `logs/HEAD` reflog, the resolved
loose current-branch ref, and the common `packed-refs`. The reflog was
added during review: after `pack-refs` the current branch's ref is
packed-only, and the first commit then *creates* a loose ref file that no
previously-emitted path would have seen (the old directory tracking caught
this by accident); `logs/HEAD` is appended on every HEAD movement of this
worktree and never by a sibling worktree. Proofs, run outside the codex
sandbox on the landing tree:

| Probe | Before | After |
| --- | --- | --- |
| `touch <git-dir>/index` → `cargo build -p snapback` | 17 s, six crates recompiled | **0.46 s**, nothing recompiled |
| `git branch probe HEAD` (sibling ref created) → build | 17 s | **0.31 s** |
| `git checkout -- <unchanged file>` → build | 17–40 s | **0.27 s** |
| `git commit` on the current branch → build | re-stamp | re-stamp (types, kernel, server, snapback build scripts re-ran; `runtime-qualify` reports the new commit, `gitDirty:false`) |

The `velocity-p3` control worktree showed why this matters at fleet scale:
with the old tracking, a *true no-op* `cargo build` there cost 18 s because
some other session committed on some other branch between two consecutive
commands.

### Phase 2 — Test currency

Replace the four `include_str!("../../../../demos/…/generated/…")` sites
with a shared test helper that reads the file at test time from
`CARGO_MANIFEST_DIR` and panics with
`run: node packages/snapback-codegen/index.mjs demos/<name>/snapback` when
it is absent. Acceptance: on a checkout without those demo outputs,
`cargo test -p snapback-kernel --lib` compiles and reports exactly the
affected tests as failed, with the repair command in the failure message.

**Implemented 2026-08-27.** The survey undercounted: there were eleven
sites, not four (multi-line `include_str!` calls in the kernel and server
test modules, plus `crates/snapback/tests/local_v0.rs` and a
`media-happy-post` fixture), spanning three crates; each crate got its own
small `read_generated_demo_fixture` helper rather than a dependency edge.
Absence proof: with `demos/team-chat/snapback/generated` moved aside, the
kernel lib-test crate compiles and exactly
`generated_authority_profile_manifests_validate_after_generation_rotation`
fails, its message naming the path and
`node packages/snapback-codegen/index.mjs demos/team-chat/snapback`. Full
kernel lib run: 868 passed, 13 failed, 7 ignored — the 13 are
`storage::auth_integrations` reds that reproduce identically on clean
`origin/main` f16d432db (inherited; `SNAPBACK_AUTH_AGENT_REGISTRATION_DISABLED`).

### Phase 3 — Dev profile

Add `[profile.dev]` / `[profile.test]` settings and measure each one
against the baseline table before keeping it:

- `debug = "line-tables-only"` (backtraces and line numbers keep working;
  type/variable DWARF, the bulk of the 278 MB `LINKEDIT`, goes away).
- Dependency `opt-level` for `[profile.dev.package."*"]` only if it
  shortens the *test* wall time by more than it lengthens the cold build.
- Linux: `rust-lld` via `.cargo/config.toml` for the CI target only.

Acceptance: edit→result rows improve; `cargo test` behaviour (backtrace
lines, panic messages) unchanged; a row per setting in the record below,
including settings that were tried and rejected.

**Measured and closed 2026-08-27 — nothing kept.** Each setting was
measured in a dedicated control worktree (`velocity-p3`, fresh
`target/`, same machine, same hour) with a full rebuild between settings:

| Setting (dev profile, Apple Silicon) | edit `server.rs` → bin | touch `main.rs` → bin (link-dominated) | edit `storage.rs` → kernel test bin | `snapback` size |
| --- | --- | --- | --- | --- |
| control (no profile block) | 17.5 s | — | 11.0 s | 509 MB |
| `debug = "line-tables-only"` | 17.2 s | — | 9.4 s | 493 MB |
| `-Wl,-no_deduplicate` | 16.8 s | 16.4 s | 10.9 s | 509 MB |
| `-no_deduplicate` + `lto = "off"` | 18.5 s | 15.2 s | 11.3 s | 509 MB |
| `ld64.lld` (`-fuse-ld=lld`, confirmed on the link line) | 22.4 s | 18.1 s | 10.8 s | 488 MB |

All differences are inside run-to-run noise. The reason is structural:
macOS keeps DWARF unpacked in the object files, so debuginfo settings
cannot shrink the binary, and the 15–18 s floor is the linker walking a
symbol table that is ~280 MB of `LINKEDIT` (LLP 0314). No linker
configuration changes how many symbols there are; only Phases 5 and 7 do.
Dependency `opt-level` and Linux `rust-lld` were not measured: the former
cannot move a link-bound loop and the latter is a CI-only concern. The
experiments also showed the per-variant cost of `target/` — 28 → 112 GB
across four settings — which is why they ran in a throwaway worktree.

### Phase 4 — Leaf crates for non-Rust inputs

- `snapback-guide-embed`: owns today's `emit_embedded_guide` build step and
  exposes the artifact bytes. `snapback-server` depends on it; the
  `rerun-if-changed=../../guide` line moves with it. A guide edit then
  recompiles one small crate and relinks.
- `snapback-build-identity`: owns the git stamp. Kernel's embedded control
  catalog stops stamping `buildIdentity` at build time and stamps it at
  serve time from this crate (the kernel test above moves with it), so the
  kernel build script no longer touches git at all. Whether the server
  crate should read identity through a runtime-provided value instead of a
  dependency edge is decided by measurement (it determines whether the
  server test binary relinks on every commit).

Acceptance: a guide edit → `cargo build -p snapback` recompiles no crate
larger than the leaf; a commit → only leaf + relink.

### Phase 5 — Link targets

Consolidate `crates/snapback/tests/*.rs` (79 files) into a small number of
harness binaries (`tests/<group>/main.rs` with `mod` declarations), keeping
test names stable for the LLP 0287 inventories and the local-proof
selection policy. Adopt `cargo-nextest` as the documented runner (per-test
process isolation, JUnit output for the proof inventories, and the
partitioning CI needs). Acceptance: `cargo check --workspace --all-targets`
and `cargo test --no-run` wall times; link-target count; the inventory
gates green.

**Implemented 2026-08-27 (consolidation; nextest deferred).**
`crates/snapback/Cargo.toml` sets `autotests = false` and declares 13
`[[test]]` targets; no file under `tests/` moved. 66 files are wrapped as
`#[path]` modules of `tests/_harness/integration_suite.rs`; `admin_v0` +
`capability_v0` share a harness that keeps the `capability_v0` name (the
publication finalizer and the path-migration manifest name it); and eleven
files keep their own binary because they mutate process-global state —
`control_catalog_registry_export` and `result_transform_corpus_v1` (named
by scripts), `action_stream_envelope_v0`, `action_watchdog_v0`,
`egress_ambient_v0`, `graph_corpus_v1`, `instance_fork_replication_wal_v0`,
`live_scheduler_v0`, `replication_sustained_v0`, `rqs_bundle_v0` (env
toggles or a timing lock), and `delta_semantics_stage_b_audit_v1`, whose
env mutation hides in `tests/support/graph_stage_b.rs` and was missed by
the file-level audit — the review caught it by grepping `support/` for
`set_var`. Test names gained a `<file>::` prefix; the one test that
re-executes itself by `--exact` name (`auth_invalidation_boot_replay_v1`)
was updated.

| Measure | 79 targets | 13 targets |
| --- | --- | --- |
| Integration tests | 718 | 718 |
| `cargo test -p snapback --tests --no-fail-fast` | 539 passed / 175 failed | 540 passed / 174 failed — **0 new failures**; the one flip is a known intermittent that failed in both pre-change runs |
| Test executables (this crate) | 79 × ~530 MB ≈ 21.5 GB | **13, 4.13 GB** |
| Relink after deleting all of them | 79 links | 5.2 s wall for 13 |

The 174 inherited reds are the fixture-migration debt of
`issues/20260820-f3-bucket-b-pre-existing-reds.md` (item 13: 223
`SNAPBACK_TABLE_WRITE_UNDECLARED_REFUSED` refusals since the 2026-08-16
enforcement) plus the admin-read enforcement flip of LLP 0262 stage 3;
`issues/20260825-the-two-inherited-reds-every-lane-re-derives.md` is the
standing reference. `check-guide` is red on `main` at "generated API cold
signatures" since cbf4fc7fa, independent of this work
(`issues/20260827-guide-cold-signatures-verifyconfig-profiles-red.md`).

### Phase 6 — The required signal

The low-noise posture is an explicit author ruling with its own restoration
ticket and preconditions; this plan does not re-decide it. What it adds:

- The 130-runs-per-hour figure that motivated the ruling is a *fan-out*
  problem (one heavyweight copy per commit, inherited reds repeated per
  push), not a reason for the cheap required check to be silent. The
  restoration ticket's precondition 3 (path selectors so a stale artifact is
  checked without repeating an inherited red per push) is the velocity
  deliverable here: `required-surface-builds` runs on push in 35 s and must
  be first to come back.
- A stale committed generated artifact needs a standing repair owner before
  the trigger returns: the next landing touching the area, or a scheduled
  regeneration commit — never a red left for a day. Phase 8 decides which
  artifacts should stop being committed at all.
- `local-proof` and `app-bound-linux-qualification` stay under LLP 0175 /
  LLP 0189 ownership; this plan only records their state.

### Phase 7 — The tower (evidence-gated)

**First `--timings` record (2026-08-27, after Phases 1–2, warm lib
build):** `cargo test --workspace --exclude snapback-sync --no-run
--timings` — 748 units, **572 s CPU, 74 s wall**. By unit:

| Unit | CPU |
| --- | --- |
| `snapback-server` lib test (44k-line `tests.rs` + 552 MB link) | **73.1 s** — the critical path |
| `snapback-server` lib | 31.5 s |
| `snapback-cli` lib test | 28.2 s |
| 79 `crates/snapback` integration targets | **378 s total**, mean 4.8 s, max 16.0 s (`graph_corpus_v1`) — almost all link |
| 14 lib-test targets | 109 s total |

Test executables over 50 MB: 65, **21.5 GB** — the disk-headroom problem
LLP 0276 (#5) named. `snapback-sync` was excluded because its lib tests do
not compile on current `main` (inherited; `issues/20260826-sync-test-target-red-room-reauthorization.md`).

Reading: two-thirds of the CPU in a full test build is 79 links of the
same ~530 MB. Phase 5 attacks that directly. The remaining critical path
is the server crate's own test unit, which is Phase 7's first carve
candidate (`server/tests.rs` → per-area test modules compiled as one unit
still, but a split of `server.rs` itself moves the compile half of the
73 s). Phase 4's expected gain is smaller than first stated: with the
link floor at 15 s, moving the guide and identity stamps to leaf crates
saves the tower's compile pass on a commit or docs edit (a few seconds)
but not the relink; it stays queued behind Phase 5.

Commit a `cargo build --timings` record for the baseline and after
Phases 1–5. Only then propose kernel's decomposition (its 226k lines are
the widest base of the tower) and the three god-file carves, each as a
sub-LLP with its own before/after row. LLP 0225's ownership map and
LLP 0283's F-1 boundary work govern *where* the seams may go; this plan
governs only *whether* a seam pays for itself on the clock.

### Phase 8 — Frozen-record ratchet

Count the committed generated artifacts and the drift tickets they produced
in the last 30 days. Any new committed generated artifact must state, in
its owning LLP, why a diff gate is preferable to regeneration-in-CI. Existing
ones with a drift-ticket rate above one per week are candidates for
regeneration-in-CI.

## Non-goals

- A rewrite, a `snapback2`, or a second frozen-main flag day.
- Changing what the shipped `production` profile emits (LLP 0276, LLP 0314).
- Relaxing the identity contract (LLP 0031), the security gates (LLP 0284),
  or the publication path (LLP 0041).
- Making `main` quieter. The fleet cadence is a constraint the build must
  absorb, not a behaviour to change.

## Record — measurements by phase

| Phase | Landed | Edit `server.rs` → binary | Edit `engine.rs` → test binary | Git→cargo tax | Notes |
| --- | --- | --- | --- | --- | --- |
| Baseline | f16d432db era | 68 s | 81 s | 17 s | 533 MB debug binary; 83 link targets |
| Baseline (fresh control worktree) | f16d432db | 17.5 s | 11.0 s (kernel) | 18 s on a *true no-op* | same tree, uncontended `target/`; the primary checkout's 68 s includes its 28 GB shared target and `--all-targets` residue |
| Phases 1–2 | this landing | 17–18 s (unchanged) | unchanged | **0.3–0.5 s** | git tax eliminated; the compile+link floor is untouched, as expected |
| Phase 3 | closed, nothing kept | 16.8–22.4 s | 9.4–11.3 s | — | four settings measured; all within noise (table above) |
| Phase 5 | this landing | unchanged (single-binary loop) | unchanged | — | full test build: 79 → 13 integration links, executables 21.5 → 4.13 GB, ~340 s CPU removed from every `cargo test --workspace`; 718/718 tests, 0 new failures |

Rows are appended as phases land; a phase that does not move a number says
so here rather than being quietly dropped.

## Open questions

1. Should `SNAPBACK_BUILD_GIT_DIRTY` be computed at all for `dev`-profile
   builds, or only by the packaging and readiness paths that consume it
   (`scripts/bootstrap-ibex-runtime`, `verify-local-proof`)? Runtime
   consumers already tolerate `unknown`. Decide after Phase 4's measurement.
2. ~~Does any inventory (LLP 0287) key on integration-test *binary* names
   rather than test names?~~ **Answered 2026-08-27:** the proof runs
   `cargo test --workspace` and the selection policy keys on the
   `crates/snapback/tests/` *directory*; the only binary named anywhere is
   `--test control_catalog_registry_export` (proof comment and
   `scripts/generate-control-catalog.mjs`). Phase 5 must keep that one
   binary name and is otherwise free to consolidate.
3. What is the exit condition for the low-noise Actions posture? (Owned by
   `issues/20260824-restore-automatic-actions-after-low-noise-interval.md`;
   Phase 6 contributes precondition 3.)

## Sequencing

Phases 1–2 landed together on 2026-08-27; Phase 3 closed the same day with
nothing to land; Phase 5's consolidation landed the same day (nextest
adoption remains open under Phase 5 — it needs `cargo-nextest` on the
fleet and in CI first). Next in order of measured payoff: Phase 7's first
carve (the `snapback-server` test unit is the 73 s critical path), then
Phase 4 (bounded by the link floor), then Phase 8 and the Phase 6
precondition. Phase 6 itself is a decision, not code, and can be taken at
any time.
