# PUBFIX28 — unblock 0.4.28 publication

Worktree `/home/ccheever/projects/sb4-w12-pubfix28`, branch `sb4-w12-pubfix28`,
baseline `8fe2b2e8394399af124ccf438702672dc4eb7d83`.
Initial `git status --short` was clean; `git log sb4-loop..HEAD` contained only
the publication record and macOS socket ticket. Built on both. Version remains
0.4.28. No push, npm publication, or edits to another worktree.

## Governing context (llp-orient)

Scope: release preview narration/tests and local release-control listener.
No Snapback 4 foundation entry; govern from LLP 3000 §7 (fenced implementation
and qualified publication), LLP 3000.000.000 §§5–5.1 (single writer/local socket,
bounded input) and §§9.2/11 (exact immutable preview and disjoint populations).
Read Snapback 4 AGENTS, NOT-DOING, JOURNAL tail, LLP 2000.000 and adopted rules.
The paved surface is the compiler's deploy guide card. References in changed
code still apply. No new backend semantics, budget, gate, or version bump.
Doc updates are in the same commit as the code. Hand-off: none.

## 1. Deterministic client red

Root cause: FIX28 `4e96153fdf` corrected the inventory to disjoint row/cell
ownership, but left the older many-column client assertion unchanged. Its
only row has status `new`, which release 1's enum cannot hold. That whole row
becomes dormant and covers its twenty spare-column cells. Correct total:
**one row, zero standalone cells**, not one row plus twenty duplicate cells.

Kept the core product inventory and changed the stale test. Fixed product
per-column narration to say no standalone cells become dormant when count is
zero, explaining row ownership. Positive counts use the same inventory source
as totals. Zero-row/index steps also avoid claiming a positive transition.
Amended the governing LLP §11. Expanded the same real-server fixture with a
compatible live row: **one dormant row plus twenty dormant cells**, one per
column; text/JSON counts and sample ids are checked, previews preserve store
state, rollback keeps the live id, and forward restores both rows and all
spare values. The original enum argument-decoding checks remain.

The expanded test failed against the original binary specifically on the
contradictory zero-cell narration, then passed against the fixed binary.
Paired fresh, mutually blind semantic reviews: Muse **READY**, Codex **READY**.
[Verbatim reviews, commands, provenance and final file hashes](llp/reviews/3000.000.000-pubfix28.provenance.md).
Muse's authorized fallback recovered from plan quota exhaustion. No keys were
read or printed. During review, stored tagged-value decoding was corrected
and additional zero-column JSON assertions strengthened the same semantics.

## 2. macOS release-control Broken pipe

Root cause: Darwin accepts inherit O_NONBLOCK from the polling listener,
causing input to return WouldBlock before a delayed client writes; Linux
accepts do not inherit it. The production accept helper resets each stream to
blocking mode immediately after accept, before peer/input. Setup failure drops
the stream through the existing accept-error path. Existing deadlines remain.

The regression connects first, waits for the actual production accept helper,
delays 100 ms, sends a valid envelope, and checks successful execution/reply.
It passes on Linux; the unfixed Darwin-specific failure cannot be shown on
Linux because the platform inheritance semantics differ. No Darwin run claimed.

Audit: only release_control has a nonblocking listener in the crate. TCP
reservations in port_flag, witness_socket, witness/protocol and host_limits
are blocking; vendored tiny_http accepts are blocking too. Its limits module
sets an already accepted overload-response socket nonblocking, not a listener.
Also checked O_NONBLOCK, SOCK_NONBLOCK, F_SETFL and accept4 spellings; the
remaining O_NONBLOCK sites are guarded file opens, not listeners.
No other listener requires a fix. Ticket resolved into issues/closed with
cause, regression and audit record.

## Commits

- `1f963c6ccc` — both product fixes, regression tests, governing LLP/journal,
  and resolved socket ticket.
- `e28e574cf7` — verbatim independent READY reviews, review brief, provenance.
- Final closeout commit contains this report and the compressed Linux command
  logs/verification manifest; it changes no product source.

## Linux verification

[Verification manifest, commands and SHA-256-bound compressed logs](snapback4/reports/20261015-pubfix28/verification.json)
are committed with this report. Original logs remain under `/tmp/pubfix28-logs`.
Setup completed: frozen Snapback 4 Bun install; CLI build; wasm build
(2,319,740 raw / 707,674 gzip bytes, within 708,174 budget); client package build.
Root setup follows Integration 11: frozen root install, existing workspace-hoist
helper, scripts/check-generated-artifacts. No root manifest/dependency changes.

All directly run Cargo commands and Cargo-bearing scripts carry
CARGO_INCREMENTAL=0, CARGO_PROFILE_DEV_DEBUG=0, CARGO_PROFILE_TEST_DEBUG=0.
Publication-scope Cargo checks use LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT.
Never ran full scripts/test.sh. Rust drains before the publication client pool;
the client command comes from scripts/test.sh as invoked by publish.mjs and
qualify-linux.mjs: all *.test.mjs except the two full-count model files in one
run-client-tests.mjs files invocation with min(24,max(1,floor(CPUs/3))) slots.
Models retain their separate serial command.

Affected regression: one client test passed. All nine release_control unit
tests passed, including the new delayed-input case. ./ref-check passed.
Root setup passed with current projections. `node scripts/docs-budget.mjs`
passed (README 320/320 plus the named first-account screen test).
`node scripts/check-inventories.mjs` passed: 365 package tests, 35 script tests,
31 demos/catalog entries, 487 publication leaves, 162 pages/1,937 snippets.
`node scripts/check-guide.mjs` passed: 22 checks, zero failures/skips/preconditions,
174 routes + 51 host operations; 121 existing warnings remain warnings.
Full `cargo test -p snapback4-core -p snapback4-lang -p snapback4-device
-p snapback4-sim -p snapback4 --no-fail-fast` passed, exit 0: **6,076 passed,
zero failed, 41 existing opt-in ignores** across 377 top-level result groups,
including doctests. Fourteen nested fixture-process summaries are excluded.
All new control tests are included. This is one complete command, not a sum
of isolated affected reruns. Both root checks also passed fresh reruns after
the complete root bootstrap returned, making setup-before-check ordering explicit.

Complete publication client pool passed in one invocation, exit 0: **388/388
files; 7,445 passed; zero failures/cancellations/TODOs; 56 intentional skips**.
All 17 isolated timer files ran after the shared phase inside that invocation.
The entire release-activation file passed in that pool. No CLI rebuild ran
alongside it; the child horizon fixture inherited the same Cargo profile and
publication SQLite flags. No full scripts/test.sh was executed.

Fixture wrapper passed: **9/9 tests**, exit 0. The separate serial model slot
passed **81/81 tests**, exit 0, at full defaults: 5,000 session sequences per
tier and 3,000 online sequences, with no counter overrides. Zero model/wrapper
failures, skips, cancellations or TODOs. All requested Linux checks pass.

Source/doc diff-check excluding the verbatim Codex transcript passes. The full
range reports eight trailing-space lines inside that transcript's quoted diff;
they remain byte-for-byte intact as required for verbatim review provenance.

## Deferrals and decisions

No product work deferred. No question/approval needed: user preauthorized
implementation, extra review rounds and checks. Kept the version unchanged
because 0.4.28 is not on npm. macOS regression execution and publication remain
with the publication coordinator; this workstream supplies Linux evidence and
commits only, with no publication qualification receipt claim.
