# Snapback 5 journal

## 2026-09-24 — Lane A: fence and concept count at commission

Created the Snapback 5 fence and root routing under LLP 4000 §9.6 step 2.
Nothing in the Snapback 5 runtime is implemented. The treatment will build
over `snapback4-*`; shared baseline work remains Snapback 4's. This lane
changes no tracked file under `snapback4/` and introduces no language,
engine, device, diagnostic or client-contract behavior.

The runnable counter measures **188 = 161 surface + 13 runtime + 14 check**
for Snapback 4 and **68 = 48 surface + 13 runtime + 7 check** for LLP 4000
§3.1. Its source-backed guide recognizers and markdown/union extractors
produce entry lists and input digests; repeat invocations are byte-identical.
Both arms run the local `npx --no-install snapback4 check` on the committed
Clique target copied into ignored `.work/`. The generated API hash is
`448d303434425278b8bd70ca6b930dc6a30354c43be392b1e53af6fa643ddc9d`.

The larger ambiguous readings include all six §3.1 bullets, both sent-write
variants, separate depth/trigger and eviction/retention concepts, both
eligibility words, and documented optional/older Snapback 4 forms. The
generated API imports its contract instead of inlining runtime states, so
the tool reads those definitions from `contract.ts` and `app.ts`. This
source-layout deviation and every counting choice are recorded in
[LLP 4000 §7.1](../llp/4000-snapback5.rfc.md#71-the-count-at-commission) and
the [measurement report](./reports/20260924-concept-count.md).
The 120-point difference is not a demonstrated reduction of equivalent
concepts: §3.1 leaves types, control flow and builtins unenumerated, while
the Snapback 4 guide spells them out. Shared additions have also not yet
landed in the measured Snapback 4 snapshot. Recount after integration and
at calibration; this is not a ratchet.

The web artifact measured by `snapback4/scripts/build-wasm.sh` is
**1,744,842 B raw / 484,967 B gzip**, under the unchanged **486,000 B**
budget by **1,033 B** (Rust 1.97.0, wasm-bindgen 0.2.127, no wasm-opt).
Node 24.18.0 was installed inside this worktree because the specified
Volta path was absent. Four focused extraction tests pass. Root
`./ref-check --verbose` passes with zero errors and zero unchecked refs.

The initial full-suite attempt used broad syscall tracing to record PIDs;
it incurred timing failures and was interrupted with SIGTERM to its
recorded launcher PID 634650. Its two surviving recorded server PIDs,
644273 and 758168, were then stopped with SIGTERM. The replacement run
uses seccomp-filtered exec tracing and the suite's supported serial client
file mode, retaining PID records without tracing ordinary engine syscalls.
No server was stopped by name or pattern. Full qualification follows below.

That replacement run encountered a full shared filesystem: SQLite returned
`E_STORE: database or disk is full`, Rust could not create a temporary
output directory, and Node file operations failed. The logs themselves
also hit ENOSPC. Preserved the available logs, stopped recorded launcher
768686 and its remaining recorded server 898095, and removed only this
lane's regenerable `snapback4/target/debug/incremental` cache (16 GB).
No other worktree was inspected or changed. The final attempt uses the
ordinary suite concurrency, Node 24.18.0, and seccomp-filtered launch
tracing. These interrupted attempts are not passing qualifications.

The third attempt's filtered tracer still consumed roughly 86% of a CPU.
Two client cases failed: the worker-crash test observed an extra attempt,
and the web receipt-history test exceeded 60 seconds. Completed Rust
executions had no failures. Preserved the worker logs and interrupted
recorded launcher 905048; all its tracees exited. Replaced ptrace with a
worktree-local preload constructor that records PID, parent, process start
and executable once, without interposing on engine functions. The final
attempt uses the suite's serial client-file switch and 12 Rust processes.
The recorder and its output remain ignored in `.work/`; no product source
or measurement tool depends on it. Qualification follows below.

The launch-only recorder removed the tracing slowdown: the Rust suite and
its doctests passed in 114 s. The fourth attempt exposed a test-environment
mistake: the managed-policy scratch test requires a location outside Git,
so overriding TMPDIR to this worktree guarantees failure. That test passes
with the ordinary system temporary directory. Session restoration also
passed in an isolated repeat; Expo starter and processDevice cases had
failed in the same worktree-temporary-directory attempt. Preserved its
worker logs, stopped recorded launcher 1144114 and verified no recorded
PID/start-time identity remained live. The qualification attempt restores
normal system temporary fixtures and ordinary client-file concurrency,
with 12 Rust processes and the launch-only PID recorder. No other
worktree is used; no Snapback 4 source was changed.

Final qualification: **`== 0 failure(s) in 135 s`**, exit 0, on the
unchanged baseline. Client totals: **1088 passed, 0 failed,
10 skipped**. The wasm rebuild again reports
`wasm 1744842 B raw, 484967 B gzip (budget 486000: ok)`. Every recorded
PID/start-time identity has exited. The earlier interrupted attempts and
setup corrections remain evidence, not qualification. No engine fix,
budget raise, push, publication or deployment. The branch commits the
scaffold and measurement only; the lane's handoff report is
`/home/ccheever/sb5/lane-a.r0.final.md`.


## 2026-09-25 — LLP 4001 revision 4

Applied the three round-3 reviews under the author's commission: revision
4, then step 3 verification, then stop before the separately commissioned
pre-test 1. §12 records all dispositions; the historical reviews are
unchanged except append-only pointers. No compiler or shared engine change.

For authoring clarity I chose a uniform null rule, explicit typed shape
casts, private-schema block helpers, and a real permissive policy beside
a transition constraint. I declined position-dependent nullable predicate
exceptions and trigger-as-grant semantics. Custom transition codes must move
into mutation checks; silently erasing them would mislead builders. Missing
#19 merge/group/reference-list/maintain-override forms are visible GAPs,
not different programs disguised as lowerings. These choices keep the
front end bounded without adding runtime work; no performance improvement
is claimed from a text revision.

Orientation: LLP 4001 §2–§4 govern the unchanged-engine boundary and spelling
verification; LLP 3000.015 §1–§3 define the three proposed additions. The
Snapback 4 rules, types, maintains, shapes, reads, writes and jobs guide cards
supply the current authoring/authority facts. Both 4001 and 3000.015 remain
Draft; the latter's equality-transition example freezes the owner's mark,
so it is explicitly not represented as a monotonic-mark recipe. The current
checkout lacks the three additions' parser support; verification will
record actual failures rather than import another worktree or change core.
AGENTS now explicitly supersedes the shelved README/NOT-DOING instructions
for this bet; those files are outside the authorized edit set.

## 2026-09-25 — LLP 4001 §9 step 3 verification

Committed revision 4 as `0a2f2ce4f8`; this second commit contains executable
stubs, representative lowerings and the [full transcript](./reports/20260925-form-table-postgres17.md).
The input table had 69 rows (11 ✓ / 55 ≈ / 3 ✗); revision 4 had 82
(10 ✓ / 64 ≈ / 8 ✗); verification leaves 82 (10 ✓ / 61 ≈ / 11 ✗).
All 74 rows with SQL spellings execute on Postgres 17.10, including every
function/procedure body via seeded calls, expected exceptions and non-owner
policy/page/mutation witnesses. 71 corresponding Quarry rows bind.

Three rows fail against the assigned checkout: `written by` (also its
`readable by audience` opt-out), `sequence by`, and row-keyed maintains.
They are marked ✗, with exact diagnostics, rather than approximated by
ordinary columns or relabeled as passing. The Snapback 4 subtree remains
`f301a6910c90123238c26de7a2c6def2f9369843`, identical to the assigned
`d9f177a434` starting commit. This is current-checkout verification, not a
shared-baseline qualification; these additions must land and be rechecked
before a pre-test. No other worktree or branch was used.

Verification forced local corrections: configured effects use `retry` and
have no SQL-loaded worker module; boolean rules lower as equality to true;
streamed/unpaged reads pin the admitted audience scope; filtered sweep
index columns must be immutable; id-list growth initializes a local before
its recognized append, and upserts use named unique keys when arity is
ambiguous. A SQL-language stub cannot accept plain `record`, so the emit
stub uses `anyelement` for the heterogeneous once-key. That first failing
stub run and every subsequent attempt remain in the committed logs.

The private clusters were initialized only under the authorized
`/Users/ccheever/projects/snapback-sb5-pg/` scratch root. Started postmaster
PIDs were 17336, 24045, 67499, 91025, 96594 and 11240; every one was stopped
through its own data directory after checking its recorded PID. The final
run's port/data path and stop receipt are in the report. No existing
cluster was used. Cargo built once into ignored `snapback5/stubs/.build`;
`check` discovers projects rather than accepting a single source file, so
the checked fixtures have their own project wrappers under `stubs/lowered`.
All routine bodies are executed; typed constant stubs make no runtime,
authorization-equivalence, IR-equivalence or performance claim. No pre-test
1, compiler implementation, fourth review, push or publication was run.
