# Snapback 4 Postgres scale fixture refuses ordinary maintained columns

**Status:** Open
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
The [S1-PG report](../snapback4/experiments/scale-controls/results-20261022-snapback-postgres/README.md)
records both transports, exact stderr, all twelve blocked ledger entries and raw archive.
Its [two-table repro](../snapback4/experiments/scale-controls/results-20261022-snapback-postgres/minimal-repro.q)
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
