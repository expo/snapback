# Trusted profiles and PostgreSQL authority facts — 2026-09-17

These are two bounded implementation slices, not complete Identity/B or
production PostgreSQL. They do not change the published Workroom pin.

## Exact source and integration

- Trusted-profile source: `a6cb839b7a62035100a1a5468408c9822d6fd94d`, based
  on `906ed04ec`; integrated as `5098444fd`.
- PostgreSQL authority source: `e5cbbd8a2a12a27ddd7c46f7a2e9f28c524c88e2`,
  based on `3a95cfcd3`; integrated as `93c790762`.
- Integration preserves the product/test files of each source exactly.
  Documentation retains main's deployment-trusted worker explanation and
  the historical B1c partial-positive/overall-negative evidence. Both
  JOURNAL appends were checked against the exact preceding main prefix.

## B1d.1: trusted OIDC profiles

The helper derives the profile principal from the validated issuer and
subject using the same function as minting, and passes it to the private
verified mutation. No public context, Session field or engine identity
protocol changed. Recipe-local service transactions assign login-start
order and a managed proof-start clock, then settle the login and update the
trusted profile atomically. Delayed older completions cannot overwrite newer
evidence. Newer false or missing email verification clears eligibility.

Email is neither an identity-linking key nor a membership grant. The fixed
recipe window is five minutes from managed begin, checked strictly at read
time. Login order is not provider email-change chronology; provider changes
and revocation are not synchronized until another login. Old unpublished
verified-write receipts lack the new principal argument and fail input
binding; recovery is a fresh login, not receipt migration.

Author checks on Office used Node 24.18.0:

- package typecheck and build passed;
- published CLI 0.2.26 compiled the recipe: three tables, eleven operations,
  zero synced; and
- eighteen signed-provider/FakeCore helper tests plus one actual managed-
  interpreter profile-policy test passed: 19/19, no skips, 11.95 seconds.

The actual policy test uses CLI `run --as --now`: operator-selected principals
and time, not authentication or provider proof. It covers ordering, freshness,
denials and rollback. CLI run has no stable write ID; lost-ack receipt evidence
comes only from the explicitly labelled helper double. Initial counter-key
ambiguity and missing local dist setup failures remain in the dated JOURNAL.
The CLI SHA-256 is
`fa4834f3fd128f4c37f02c9c3954da95306bbf208b2c0c94eb34cda419e7d7be`.

Fresh blind [Sol](../../llp/reviews/3000.009-b1d-profile.sol.md) and
[Grok](../../llp/reviews/3000.009-b1d-profile.grok.md) reviews both returned
READY. They did not execute tests. On exact integrated `93c790762`, the
language guide suite passed 50/50 and the actual managed-policy test passed
1/1 on Node 24.13.1 using the previously qualified 0.2.27 Linux binary
`475d329aa515601dec6f122e72946efa38d918c097d24faa054a46b760669dec`.
Its SQLite engine inputs are unchanged by these slices. This remains policy
execution, not real-provider profile, invitation, verification/recovery,
full Identity or publication qualification.

The serial qualifier retained `profile-c33-93c-guide.log` (SHA-256
`e585cb8871afa37968797f4f64a5a5e9d70e5fe93205c1815f57fbe3ea2abd39`)
and `profile-c33-93c-actual-profile.log` (SHA-256
`8fd58218a1215a7dee1f9dad26e3a723beae085e9490ba5ad3271379fc78ec88`)
under `/tmp/sb4-c3-20260916-supervision` on 450b. Source stayed clean.

## C3.3: PostgreSQL authority fact adapter

The experiment now creates `snapback4-postgres-evaluation-3` atomically with
the SQLite-shaped generation, session and request facts. Opening refuses
both prior evaluation versions; there is no migration or silent adoption.
The real borrowed PostgreSQL transaction implements the existing typed
authority interface. Policy is shared, not reimplemented in SQL.

Read walks keep one repeatable-read/read-only snapshot. Both invalidations
refuse before mutation unless the transaction already holds the serialized
shared-head fence. No new clock or public writer is added; a future writer
must acquire that fence before sampling its operation clock.

Author checks on the sole heavy executor, 450b, ran serially with six Cargo
jobs and PostgreSQL 16.15:

| Affected check | Result |
| --- | --- |
| Shared SQLite fact/policy/invalidation cases | 3/3 |
| Real PostgreSQL fact/policy/fence/rollback/reopen/snapshot cases | 4/4 |
| C3.1 receipt, race, version and rollback regressions on v3 | 6/6 |
| Bound sessions | 8/8 |
| Identity integration / units | 2/2 and 4/4 |
| Action context / work records | 8/8 and 6/6 |
| PostgreSQL-feature test target compilation | Pass |

The second-connection witness establishes an old read snapshot before a
serialized writer commits, proves the old snapshot remains unchanged, and
proves a reopened snapshot sees the new facts. Read-only and Serializable
invalidation refusals leave the rows intact. Shared tests retain the existing
legacy nullable-authority behavior rather than silently tighten it.

The [source-bound command manifest](20260917-c33-check-manifest.txt) records
exact commands, retained failures, raw-log digests and private cluster custody.
Its SHA-256 is
`c5402328fa0536c79793c30b502256a578c96a84d7090a8c90e9e910839ef76c`.
Both recorded PostgreSQL PIDs were confirmed gone; the data and shutdown log
were retained. Initial Cargo path/filter misses, a corrected test-helper
collision, inherited local-package lock-version drift and the unchanged
compact-format rustfmt failure are not hidden behind the final passes.

Fresh blind [Sol](../../llp/reviews/3000.009-c33.sol.md) and
[Grok](../../llp/reviews/3000.009-c33.grok.md) reviews both returned READY.
No independent reviewer execution or full suite is claimed. This does not
provide PostgreSQL identity mint/revoke, request/step lifecycle, schedules,
asset ledger, serving, activation, release/incarnation, backup or restore.
Those remaining C3 surfaces, and C1's plainly missed performance targets,
are unchanged.
