# Common Postgres evaluation excludes lower read lifetimes

Status: Open
Date: 2026-10-23
Scope: Snapback 4, S10e-2 store-oracle admission
Related: [store port §3.4](../llp/3000.009.001.000-the-postgres-store-port.rfc.md#34-one-engine-over-both-stores)

The common Postgres profile refuses a schema containing `not before` with
`StoreUnsupported { family: "time-publication" }`. SQLite admits it. This is
the existing S10e-1 profile difference, now recorded as an exact campaign
exclusion instead of a blanket unsupported classifier.

Minimal source (the difftest compiler accepts it with no diagnostics):

```quarry
table notes:
  opensAt: time
  not before .opensAt
  public
  sync public
query run():
  return 1
```

Compile it, then pass the schema/programs to `Engine::memory` and
`Engine::create_postgres_evaluation` with a fresh isolated namespace. SQLite
opens; Postgres returns the exact family above. No execution is needed:
`engine/postgres/profile.rs` refuses `table.not_before.is_some()` during
admission. `generate(seed)` in the fixed 0..32 store campaign supplies two
such cases. Compiler evidence is local in
`/tmp/sb4-s10e2a/time-publication-compile.log`.

With a private evaluation connection, the actual runner reproduction is:

```sh
snapback4-difftest run-stores --seed 8 --cases 1 --workers 1 --out /tmp/sb4-time-publication-repro
```

It exits 2 with the `time-publication` setup error. The lane's retained
reproduction, source and report are under
`/tmp/sb4-s10e2a/default-campaign-repro/`; the CLI transcript is
`/tmp/sb4-s10e2a/default-campaign-cli.log`.

Only `both_stores_all_public_boundaries_and_write_observations` declares this
exclusion: reason `E_STORE_UNSUPPORTED:time-publication`, exactly two setup
refusals, each recorded once per prefetch oracle and never as a pass. Its
database verifies the exact setup count at campaign completion. Arbitrary
`run-stores` campaigns and replays have an empty allowlist and fail on this
refusal. Extra, missing, or different refusals fail.

Before deleting the retained executor, either implement and qualify this
publication profile or retain this explicit exclusion and its regression
inputs. No admission policy, logical meter, or request budget changes here.
