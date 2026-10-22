# Snapback 4 Postgres scale fixture refuses ordinary maintained columns

**Status:** Closed — resolved 2026-10-22 (P1-MC)
**Systems:** Snapback 4 Postgres admission, S1 W1–W5
**Date:** 2026-10-22
**Detected at:** `459413c0fe33568c61ba8ad8ffaa95f5ed5490bd`
**Related:** LLP 3000.009.001.002 §7–§9; LLP 3000.009.001.000

The unchanged S1-SK Quarry app cannot enter the initial public Postgres profile.
`rooms.total: count messages by .room` and `users.sent: count messages by .sender`
are ordinary maintained columns. Public deploy returns exit 1:

```text
deploy: E_STORE_UNSUPPORTED: maintained-columns is not yet available on Postgres
```

This is an admitted-profile capability gap, already described by `guide release-json`,
which blocks the requested scale comparison rather than a broken advertised promise.
The [S1-PG report](../../snapback4/experiments/scale-controls/results-20261022-snapback-postgres/README.md)
records both transports, exact stderr, all twelve blocked ledger entries and raw archive.
Its [two-table repro](../../snapback4/experiments/scale-controls/results-20261022-snapback-postgres/minimal-repro.q)
reproduces the refusal without data, sessions or load.

Reproduce with the release CLI on that source, a private empty PG17 database,
an explicit Unix-socket/namespace/ha=none `SNAPBACK4_STORE_URL`, and the repro
saved as `snapback/schema.q`:

```sh
snapback4 deploy /absolute/fresh/deployment --json
```

No product patch or weakened fixture was used. Ordinary count maintenance and
its private maintains must be implemented/qualified by the product owner before
the unchanged 1M-message application can seed and W1–W5 can be measured. After
that work, rerun seeding/equality, auth/rule checks and both-link matched cells;
the supported tiny-counter diagnostic in the report does not close this ticket.


## Resolution — P1-MC, 2026-10-22

Ordinary maintained count/sum writes and private mirrors already used the shared
engine over both stores. Unified admission was still calling the retained
Postgres evaluator's narrower exclusion. Removed that call; complete private
owners remain validated and row-keyed `view-recount` remains refused.
Postgres attach additionally needed bounded projection/index installation and
retired-private-row cleanup for adding, redefining and dropping these columns.
The existing common activation builder now performs their backfill/recount and
mirror before release/generation publication. Unrelated evolution stays refused.

The full locale-database run's public CLI witness deploys the **unchanged S1
Quarry app** with `--store-url` on its own private PostgreSQL 16.15 cluster,
seeds 24 messages through the owned engine, serves W1/W3 with a native session,
and accepts one public `post`. Every room total and user sent count equals a
recount of the resulting 25 messages. Both this server/cluster and the adapter
suite's separate cluster are confirmed stopped. All 213 adapter cases, the
maintained-member abort case, ownership cases and corpus cases pass. The retained
evaluator's known Serializable retry-exhaustion failure is tracked separately in
[its existing ticket](../20260916-snapback4-postgres-serializable-benchmark-failures.md);
it does not enter the new common-engine maintained-column oracle.

The [P1-MC report](../../snapback4/reports/20261022-p1mc-maintained-columns.md)
records file/line evidence, exact parity cases, checks and remaining exclusions.
This resolves the product admission blocker. The 1M seed and matched W1–W5
measurements still need the scale lane's rerun; this small fixture is capability
qualification, not a replacement throughput measurement.
