# SQW context pack

Scope: the SQLite adapter and owner, program group tails/layout admission,
revision cache, native build flags, and unchanged one-host S1 measurement.

Governing documents: LLP 3000 (current: Snapback 4 fence), LLP 2000.000
(design brief), LLP 3000.009.001.000 §§3.3–3.4/5 (semantic store boundary and
ownership), LLP 3000.009.001.000.000 §3 (member order, whole-transaction outcomes,
post-durability release), LLP 3000.009.001.000.002 §§3–4 and the SQW SQLite
amendments (bounded overlays, revision equality, complete observation and cache
exclusions), LLP 3000.019 §3.4 (retained exclusive/shared sidecar lifetime), and
LLP 3000.007 §20.24.4 (cache/mmap/checkpoint/high-water policy). The Snapback 1
foundation and gates do not apply inside this fence.

Active constraints: FULL WAL durability before reply, exact native counter
equality, no ordinary unkeyed receipt, serial intermediate images and logical
meters, bounded fallback after acknowledged rollback only, and unknown physical
outcomes never rerun transparently. Cache reuse requires an exclusive backend
owner, WAL mode, intact callbacks and no external writers; shared devices and
unowned handles remain excluded. Every changed commit invalidates equality;
empty commits and known rollbacks change no facts. Restart starts empty.

The S1 fixture is actually generation 2 on SQLite. Numeric generation alone
neither proves nor disproves overlay compatibility: the new proof runs under
BEGIN IMMEDIATE and refuses retained lifecycle state. The actual identity,
generation and compiled program checks are unchanged.

The author's lane instructions authorize architecture changes and commits,
prohibit fetch/push/stash/Git-config changes and foreign process signals, and
set a 25 GiB stop floor. The inherited runner retains its stricter 30 GiB
boundary floor. Builds use this worktree's target and line-table debug settings.
The adaptive resize controller belongs to another lane and remains unchanged;
SQW changes only SQLite's bounded collection window (one millisecond for a recent cohort).

Rationale: original S1-SQ loses on SQLite's serialized durable writer cycle and
uncached 32-room inbox. Fdatasync changes the native durability primitive, not
FULL ordering; family statements and the qualified overlay remove repeated
SQL; exclusive ownership supplies a stronger local-read fence than a lease.

Risks: local cache authority depends on complete adapter observation and leaving
the sidecar in place; data-changing writes force refills. Tail grouping preserves
every public history row. Instrumentation can change fill and latency, so its
observations remain separate from the uninstrumented three-repetition matrix.

Updates: controls/committer/storage-policy LLPs, code/test witnesses, journal and
this report. Hand-off: none.
