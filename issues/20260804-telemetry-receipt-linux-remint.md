# Telemetry phase-1 evidence receipt needs a Linux re-mint

**Status:** Open
**Found:** 2026-08-04, by the capability-publication landing's proof run

`scripts/verify-telemetry-phase1-proof --check` fails on
`SNAPBACK_TELEMETRY_PHASE1_EVIDENCE_INVALID: source closure unchanged
since measured revision`: the receipt
(`tests/acceptance/telemetry-phase1-evidence.v1.json`, sourceRevision
`2485729318e`) binds a 412-file source closure, and **origin/main is
already drifted 69 files against it** (this landing makes it 70) — the
recent P1/0167/M4 landings changed bound sources without re-minting.

The re-mint (`scripts/verify-telemetry-phase1-proof --full`) hard-requires
Linux (`SNAPBACK_TELEMETRY_IDLE_FULL_LINUX_REQUIRED`: procfs write-I/O,
CPU, RSS counters), so it cannot run on the macOS dev hosts; prior
refresh commits (f8e786867, 8fc26815b, 96276946e) were minted on a Linux
fleet machine. Run `--full` there on current main and land the refreshed
receipt. Until then this gate is red for every macOS `verify-local-proof`
run; the 2026-08-04 capability landing verified every other gate and
skipped exactly this one, recorded here.

**2026-08-05 production re-mint note.** The first fleet replay exposed one
additional hidden host prerequisite: the idle sampler spawned an unpinned
system `sqlite3` CLI for its two read-only lifecycle queries. The otherwise
qualified Ubuntu evidence host did not carry that executable, and installing
it would require administrator access. The harness now executes the unchanged
SQL through Node 24's built-in `node:sqlite` `DatabaseSync`, opened read-only;
it preserves the CLI's default/tab separators and the bounded
`database is locked` retry without adding an OS package or weakening the
witness.
