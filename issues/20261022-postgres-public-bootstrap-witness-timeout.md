# Public Postgres bootstrap deploy exceeds the 45-second guard in the full script

Status: Open
Date: 2026-10-22
Area: Snapback 4 validation / public deploy

RT5 ran `bash scripts/test-postgres.sh` twice with PG16 private clusters,
`SNAPBACK4_PG_LOCALE=en_US.utf8`, the extracted PG16 share/library paths and
CARGO_BUILD_JOBS=10. Both runs timed out at `test-postgres-serve.py:139`, the
first deploy with `store-binding.json` deliberately obstructed by a directory.
The corrected second run passed all 369 Rust tests before this timeout.

Running `python3 scripts/test-postgres-serve.py` alone with the same environment
passed the full public-serving milestone, including that failed-binding case,
lease takeover/restart, owner loss and the maintained-column public fixture.
The standalone run took 272.72 seconds overall. All owned clusters and servers
were stopped and independently checked. No timeout limit was changed.

The cause is not isolated. Investigate timing/load/coupling at bootstrap and
failed-binding cleanup before changing the guard. RT5 changes no serving code.

[RT5 evidence and exact check records](../snapback4/reports/20261022-rt5-flight-mechanism/REPORT.md)
include both full-script failures and the passing standalone output. This is a
validation follow-up, not a flight-mechanism failure.
