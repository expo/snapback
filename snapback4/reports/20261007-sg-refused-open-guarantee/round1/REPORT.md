# SG round 1 — adoption lock order and SQLite free pages

Date: 2026-10-07. Parent: `daaa28c47e6a9fa951410ee3d2e20c885e924811`.
Branch: `sb4-intent/sg-refused-open-guarantee`.
All work and verification ran on eb1000 (`expose-builder-pixel`), only in
`/home/ccheever/sb4-intent/lane-sg`. Nothing pushed; no other lane, worktree,
process or host used. The operator reports the mini's Darwin fence passed
10/10; this lane did not run it remotely.

## Review dispositions

The supplied Astra and Grok round-0 reviews confirmed protected SQLite version
admission, pre-commit construction metadata/release validation, and recovery
ignoring uncommitted WAL spill frames. Both requested changes below are fixed.

### Hub/SQLite lock inversion

`Engine::adopt_at` still checks the hub for poison before activation, but drops
that guard before starting the SQLite writer transaction. Once activation
commits, `Hub::rebind_committed` takes the hub to install the validated identity,
generation and complete replacement ephemeral state. This leaves the hub
available while DELETE-mode commit or spill waits for a detached reader's
SQLite shared lock. Readers retain their SQLite-then-hub order.

A second fallible hub lock after commit would recreate the post-commit refusal.
Instead, committed rebind can take a poisoned guard, discard the entire old
row/accounting/epoch state, preserve the publisher, install the new binding and
clear poison. Poison present before activation still refuses before any write;
poison from a reader racing the accepting commit cannot return an error after
that commit. Existing under-lock publication and generation fencing remain.

The deterministic regression starts a real `Engine::reader().mutate_ephemeral`
call. Its SQLite authorizer pauses after the shared snapshot/identity reads and
before the hub. The writer authorizer marks the attempt to commit:

- DELETE releases the reader at that boundary. It finishes, adoption commits a
  successor generation, the hub matches, and reopening sees the new column.
- WAL holds the old snapshot until adoption has completed. Releasing the reader
  returns `E_GENERATION`, with the new generation durable and the hub rebound.

A separate commit-hook regression poisons the hub between its initial check
and acceptance in both modes. Adoption succeeds and the rebound hub is usable
with a new incarnation and the committed generation. The prior poisoned-hub
and malformed-metadata refusal tests remain.

The reader/adoption test was run against the two original round-0 production
files in this worktree, temporarily restored under a `try/finally`. It fails
with `DatabaseBusy` after the bounded two-second writer wait. Restoring the fix
makes it pass. No other checkout was created or modified.

### DELETE free-page contents

The contract is now **no committed change**: identical schema, tables, rows and
`_meta`, intact `integrity_check`, and unchanged freelist count. Physical bytes
may differ only in pre-existing free-page contents and journal/WAL residue.
This corrects round 0's overly broad main-file-byte claim.

SQLite intentionally [does not journal freelist leaf contents](https://www.sqlite.org/atomiccommit.html#_do_not_journal_freelist_pages).
A late-refused migration can overwrite those leaves before rollback returns
them to the freelist. The allocated schema/data pages and logical contents are
restored. Avoiding every write before acceptance would require migration-sized
memory or a second database and a publication protocol around existing owners;
late SQL, constraint and native-recovery errors remain possible even if known
checks move earlier. That cost is not justified for unallocated contents or
uncommitted frames. Existing bounded cache/spill policy is retained.

The core and Linux native refusal snapshots now include the full logical dump,
integrity and freelist count. The small retained-WAL tests and the specific
checkpoint-on-refusal main-file check remain stronger local witnesses. The
Darwin fence changed only its three comment lines; its assertions are intact.

The spill regression has 1,500 legacy receipts with 8 KiB payloads and 4 MiB of
committed free space created by dropping a populated table. Both modes preserve
all schema/rows, integrity and free-page count on a late send-revision refusal.
It also decodes the pre-migration freelist and verifies every changed main-file
page was a pre-existing free leaf. DELETE must actually change such pages;
WAL must leave the main file intact while growing beyond 8 MiB and retaining
the original committed WAL prefix. Both subsequently accept and complete the
migration after correcting the send revision.

Observed: 1,024 free leaves; DELETE changed six of them. WAL changed none
of the 17,551,360 main-file bytes and grew from 8,272 to 11,470,112 bytes.
Both full logical snapshots, integrity checks and freelist counts matched.

## Verification

All commands use `LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT`, eight Cargo
jobs, incremental off and dev/test debug info off. Rust test pool: eight
processes. The full suite uses its ordinary client concurrency and model work
counts. Private test scratch is outside Git; one target stays in this worktree.
The integrity-verified npm Linux 0.4.13 binary from round 0 is provided through
`SNAPBACK4_PREVIOUS_PUBLISHED_BIN` for downgrade/re-upgrade controls, including
the full suite. PostgreSQL code is untouched; no live PostgreSQL run was needed.

| Check | Result | Evidence |
|---|---|---|
| Core lib/store, identity, read/bound sessions, refused opens, capability/revocation/work records and expiring adoption | 293 passed; 3 existing measurement ignores; nested allocation subprocess also passed | `core-focused.log.gz` |
| Device lib, adoption, native and both capability files | 89 passed | `device-focused.log.gz` |
| Spill/free-page reproduction | Passed in WAL and DELETE | `spill.log.gz` |
| Server binary unit tests, including store ownership and read-only behavior | 327 passed; 4 existing ignores | `server-tests.log.gz` |
| Capability fences, Linux refusal fixtures, read-only round4, ephemeral/maintained-column/keep adoption | 53 passed; 7 Darwin-only skips | `client-fences-adoption.log.gz` |
| All read-only client files, including published downgrade/re-upgrade | 119 passed; no skips | `read-only-clients.log.gz` |
| Round-0 negative control | Expected `DatabaseBusy` failure in DELETE adoption | `round0-negative-control.log.gz` |
| Full suite | **0 failures in 2,160 s**; Rust 312 binaries / 1,025 executions plus doctests; client pool 6,675 pass / 54 labelled skips; models 79 pass | `full-suite.log.gz` |
| LLP reference validation | 0 errors, 0 unchecked | `ref-check.log.gz` |
| Source/fence/JOURNAL audit and wasm identity | Passed; source/dist wasm byte-identical to baseline | `source-audit.log.gz` |

The exact focused commands and full-suite command are retained in `verify.sh`;
`environment.sh` records the sourced settings (use a new private TMPDIR when
replaying elsewhere). All 340 client files ran, followed by both serial model
files at 5,000 session histories per tier and 3,000 online sequences. No work
count or timeout was reduced. Refusal assertions now exercise the authorized
committed-state contract described above. The ordinary client skips include the
seven Darwin-only fence cases; the optional published-binary control ran here.
The full suite rebuilds wasm; its final source/dist artifact is compared with
the saved pre-SG baseline. No wasm source, SDK surface or size budget changed.
The optimized artifact matches the baseline SHA-256
`a4c6b4a8a7e76d81df9f424899f474863ce23cf232c0e4162861cc1333a3ec83`:
2,135,164 raw / 645,264 gzip bytes, against the unchanged 645,564-byte budget.

## Governing context and audit

The scoped `llp-orient` context from round 0 was retained and checked against
both new review reports and reproductions. LLP 3000.033 §1.3 governs acceptance
and the refusal guarantee; LLP 3000.017 §3.3–3.4 governs under-lock publication
and generation fencing; LLP 3000.002 retains bounded migration cache policy.
The changes update 3000.033 and clarify 3000.017's adoption lock sequence.
The closed ticket now has a final round-1 resolution. The original report is
marked historical with a correction pointer; JOURNAL remains append-only.
No new policy, gate or hand-off is needed.
