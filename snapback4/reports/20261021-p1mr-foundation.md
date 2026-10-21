# P1-MR: foundation families on Postgres

Date: 2026-10-21. Base: `67fef0dbde`. Checkout:
`/home/ccheever/projects/sb4-pg-p1mr`, branch `sb4-pg/p1-foundation`.
One worker; no sub-agents, clones, remote commands, stash or push.

## Implementation and reachability

- Metadata: `MetadataReader`/`MetadataWriter` on Postgres `Tx` and the existing
  `RefCell<&mut Store>` pattern. Shared key mapping and raw text values.
  Pure refactors: request/outbox release reads, outbox replay suppression and
  deployment predicates, and replay-flag writes. Atomic suppressed-counter SQL,
  schedule metadata and composite identity operations remain family-owned.
- Receipts: `ReceiptReader` is the Postgres point-read path. The inherent
  `applied`/`applied_bound` readers are removed. `PostgresEngine` uses the trait
  for unbound replay and shared `receipts::replay_bound` for both bound replay
  checks, with original wire arguments. Asset receipt-existence reads use it
  too. `record_applied` remains the existing writer. No list exists.
- Change evidence: `ChangeEvidence` on Postgres `Tx` and store snapshots,
  with the shared classifier. Attach installs `_change_evidence`; current
  Postgres commit writers still do not record footprints, so their intervals
  widen. No host caller or `/changes`/`serve` wiring is added.
- The typed metadata surface remains adapter-internal: `PostgresEngine` has
  no public metadata getter/setter. The refactored request/outbox adapter
  consumers do not add their unwired host workflows. Public engine receipt
  replay is reachable; asset receipt-existence is behind the still-refused
  asset host path. `sent_sequence` and change evidence have no engine host
  caller.
- Metadata getter values are facts from `_meta`, not synthesized from
  `_backend`; generation/store/release/time metadata without a current producer
  remains absent. Receipt acknowledgement cuts and the evidence reader await
  their Postgres host callers in S10.

## LLP 3000.009.001.000 §9.1 audit

| Rule | Metadata | Receipts | Change evidence |
| --- | --- | --- | --- |
| 1: NUL | Shared new-value/new-key admission; legacy SQLite status keys and stored values remain accessible. Postgres NUL-key reads issue no query or BEGIN. Residual direct SQL binds use the terminal shared guard. | No reader admission/revalidation. NUL principal/id lookups are absent without queries/BEGIN on Postgres; SQLite legacy keys/outcomes remain readable. Engine write admission is unchanged; escaped JSON NUL replays. | Trait arguments are unsigned numbers. Footprints decode as JSON in shared policy; no stored-name revalidation or text-key bind. |
| 2: total order under LIMIT | No list/LIMIT. | No list/LIMIT; principal/id point reads are unique. | Both adapters order by the unique commit seq under LIMIT 501; reverse-seeded shared contract checks all 501 rows. |
| 3: explicit columns | Explicit `value`; additive cached-read witness. | Explicit outcome/binding/seq projections; additive cached-read witness. | Explicit seq/footprint projection; additive columns on both joined tables do not invalidate the cached result shape. |
| 4: terminal statement errors | Shared caller-discard tests roll back earlier writes; Postgres residual NUL bind additionally refuses later statements and commit. Admission errors occur before writing. | Point-read errors propagate, store snapshots drop on error; shared outcome decode errors return E_STORE. Existing engine replay propagates errors and discards its transaction. | Query error becomes unavailable evidence, then the store reader rolls back; a caller-owned writer must discard it. Both adapters test rollback of earlier metadata writes. |
| 5: typed arguments/unsigned limits | Typed enums and optional worker label; values stay textual by contract. | Typed principal/id and signed acknowledgement cut; no dialect-parsed argument lists. | Unsigned after/through with checked signed-domain conversion; fixed finite 501 lookahead. |
| 6: attach-only DDL/shape | Persistent ordinary `_meta`, primary key, C key collation, exact columns/defaults, constraints, unique indexes, RLS, triggers and rewrite rules checked. Existing identity diagnostics retain precedence. | `_ops` checked identically. Old NOT NULL binding columns are relaxed only when needed; held-reader reopen performs no no-op ALTER. | `_change_evidence` installed only at attach; it and `_commits` checked identically. All foundation constraint scans ignore contype='n'. |
| 7: observable adapter races | Both stores use `store/test_race.rs::FenceRace`; the predecessor commits only after physical contention is observed, and the contender reads its committed metadata. | Read-only family: overlapping snapshot/record/replay witness, plus existing engine duplicate/mismatching-receipt adapter races in the Postgres suite. | Read-only family: snapshot remains incomplete while another writer commits complete evidence; the next snapshot observes it. No new evidence writer or race protocol is claimed. |
| 8: signed boundaries | No arithmetic; exact min/max signed strings preserved. | No arithmetic; cuts at i64::MIN/MAX tested. | Nonempty out-of-domain intervals widen rather than wrap or clamp into a false proof. Successor arithmetic is checked. Tests cover i64::MAX and u64::MAX, including empty intervals. No stored counter is incremented. |
| 9: locale independence | Structured collation/index catalogs. | Same structured checks. | Same structured checks. C and en_US.utf8 qualification results below. |

## Differences found and their resolution

1. PostgreSQL TEXT cannot store literal NUL. New raw metadata text and new keys
   now reject NUL in shared admission. Existing SQLite keys/values are read
   without validation; a legacy status key can receive a new valid value.
   Postgres impossible-key readers return absent without querying. A direct
   SQL write bypassing admission remains the RFC's documented residual:
   Postgres returns terminal E_INPUT, while SQLite can store such bytes.
2. Postgres receipt readers used incompatible inherent signatures and a
   separate binding policy. They are replaced by the trait and shared policy,
   including legacy and partially NULL bindings. The old Postgres layout's
   NOT NULL binding columns receive a conditional attach-time upgrade.
3. SQLite's dialect JSON extraction could choose a different duplicate key or
   accept a different stored JSON dialect. Both stores now inspect receipt
   state with the same strict Rust JSON decoder; the final duplicate member
   wins, non-string states are not sent, and malformed/nonstandard selected
   outcomes return E_STORE. Rows beyond the cut are not decoded. Replay still
   preserves the raw recorded outcome and uses its existing decoder/policy.
4. SQLite cast unsigned evidence bounds to i64, potentially selecting another
   interval after wraparound. Shared policy and both adapters now check the
   signed sequence domain. Empty intervals remain valid without a query;
   nonempty intervals outside that domain widen. Checked successor arithmetic
   cannot wrap. Exactly 500 commits and 256 KiB remain admissible.
5. PostgreSQL currently lacks a footprint recorder. Its empty evidence ledger
   never proves an interval with a committed row: the LEFT JOIN exposes the
   missing summary and shared classification widens. Missing tables, missing
   commits, malformed/unknown/oversized footprints and pruning also widen.
6. PostgreSQL has cached result types, locale collations and relation DDL locks.
   Explicit projections, structured attach checks and conditional attach-only
   installation/upgrades address those differences; held-reader reopen and
   additive cached reads are witnessed per family.
7. SQLite normally permits statements after an error, while Postgres aborts.
   Family callers treat statement errors as terminal and roll back; none of
   these adapters catches a statement failure and continues with more SQL.
   Missing evidence is converted to widening only with that discard obligation.

## Verification

The serialized C-locale script passed: 253 passed, zero failed and zero
ignored (58 evaluation, 176 selected core Postgres, 19 corpus harness tests).
All 15 new Postgres foundation tests ran and passed. Log:
`/tmp/p1mr-postgres-c-qualified.log`; owned cluster
`/tmp/sb4-pg-eval.fhV75z` stopped and independently confirmed stopped.

The en_US.utf8 script also passed all 253 tests with zero failed/ignored.
Log: `/tmp/p1mr-postgres-locale-qualified.log`; owned cluster
`/tmp/sb4-pg-eval.nKDCJw` stopped and independently confirmed stopped. The
Postgres server is 16.15. Counts are 58 evaluation, 176 core and 19 corpus
harness tests per locale; named corpus row exclusions remain exclusions.

The final full core run passes: 1,024 passed, zero failed, five existing
ignores, including all 17 doctests. The isolated allocation-probe child's
summary is counted only once. Log: `/tmp/p1mr-core-qualified.log`.
The no-default-features check passes, both host ratchets pass (3 + 5 tests),
and ref-check/diff whitespace checks pass. Exact Clippy reports only two
inherited errors in unchanged `engine/read.rs` and `engine/row_views.rs`;
the diagnostic run allowing just those two lints passes with no diagnostic
in the new files. Detailed command logs and all six stopped owned clusters
are recorded in the final JOURNAL entry.

The first private-cluster attempt is explicitly not a full pass: its core-test
compile encountered an in-progress receipt caller adaptation. Its evaluation
and corpus stages passed, and its owned cluster `/tmp/sb4-pg-eval.pgGL6Q` was
stopped and independently confirmed stopped. Logs are `/tmp/p1mr-*.log`.

Earlier attempts are not counted as full qualification. The first C run
passed 175 core tests but one persistence fixture attempted to make `_commits`
unlogged while `_log` was still logged. The corrected fixture changes `_log`
first. Later full-script attempts passed all 176 core and 19 corpus tests but
experiment compilation found stale device dependency metadata in the same
checkout's shared target. Rebuilding the local `snapback4-device` package
resolved it. No other worktree's target was used. All Cargo work is serialized
for final qualification. The first full default core attempt also stopped
when package cleanup removed a same-named pending integration executable;
its full rerun is recorded below, with no concurrent Cargo work.

## Limitations

The requested census ref was initially absent locally and on origin. It
became available locally during final verification at
`sb4-pg/s10-design` / `11ff7f8d1835cff507909ac2ce00f5a5550b272c`.
The requested `git show` rows for MetadataReader/MetadataWriter,
ReceiptReader and ChangeEvidence were then read and checked against this
implementation. They confirm the separate ledger write/pruning work and
S10's host wiring; the initial source-availability limitation is resolved.

No claim of Postgres serve/authority certification, evidence writing,
publication, failover, lease ownership or migration-runner completeness is
made. The tests exercise actual Postgres 16; a NOT NULL catalog constraint row
cannot be fabricated on a server that does not expose that constraint type.
The shape query explicitly ignores that type as required.
