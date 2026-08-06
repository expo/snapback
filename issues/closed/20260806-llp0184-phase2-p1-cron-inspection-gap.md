# LLP 0184 Phase 2 P1: read-only cron inspection projection

**Status:** Closed
**Resolved:** 2026-08-06

LLP 0184's P1 read/diagnose slice called for cron/job inspection without
fabricating a read from the mutating tick/run routes. The first slice shipped
`jobs.list`/`jobs.show`, but left cron inspection open because no dedicated
route existed.

## Design decision

The needed facts already existed at runtime. `LocalCronRuntime::inspect`
builds `CronInspectState` from the loaded functions manifest plus the current
in-memory scheduler ledger; `LocalSnapback::inspect_core` already publishes
that state to full admin inspection. No additional scheduler storage,
durability, cursor, or history semantics were needed.

LLP 0028 and LLP 0024 were amended in the resolving change. The implemented
`cron.list` projection returns declared job identities and schedules plus
activation, next nominal/due, in-flight boolean, last-run/outcome, and
consecutive-failure facts. It deliberately excludes exact run IDs, handler
diagnostics/results, jitter seeds, and recent-run payloads.

## Resolution

The local target now serves the same narrow DTO through:

- the AdminRead `cron.list` host operation;
- `GET /_snapback/api/cron`;
- `snapback cron list`; and
- `snapback_cron_list`.

Phase 2's local cron-inspection gap is closed. This does not claim a hosted
scheduler implementation or hosted runtime ledger; hosted targets must expose
only facts their own scheduler actually tracks.
