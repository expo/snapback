# Snapback 4: the full suite never compiles the `postgres` feature

Opened 2026-09-27. Severity: Medium (a silent build break on main).

`cargo check -p snapback4-core --features postgres` failed on main from
`2e00cef930` (2026-09-26, "preserve unchanged state during atomic adoption",
which added the adoption-report parameter to `activate_columns`) until
`3fade730c0` (2026-09-27). The single PostgreSQL caller at
`engine/postgres/through.rs:168` was not updated, and `scripts/test.sh`
builds neither the feature nor its tests. Lane DS carried a private fix
(`50792cfa7`); lane CQ found the break on main.

Fix: have `scripts/test.sh` run `cargo check -p snapback4-core --features postgres`
(and the PostgreSQL test targets when a server is configured), so that a
signature change that misses the feature-gated caller fails the suite.
