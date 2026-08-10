# auth::backup:: family hangs on main (pre-existing, main-health)

**Opened:** 2026-08-10
**Area:** Auth backup / disaster recovery / test health
**Severity:** high (backup is the DB+keyring disaster-recovery path)

On current origin/main the `auth::backup::` test family hangs. With all in-flight
rehearsal work stashed (clean origin/main base),
`auth::backup::tests::backup_and_restore_publish_exact_owner_only_consistent_units`
does not complete within 90s (exit 124); the family does not finish in 200s
serially. It passed 25/0 earlier today at the LLP 0213 slice-B base
(`ec96f04e5`), so it regressed from concurrent commits landed after that point
(observed progression: passing -> 18/25 failing under the 0214 catalog-v3 WIP ->
now hanging on the clean base). NOT caused by the LLP 0213 rehearsal lanes
(reproduces with them stashed); LLP 0213 slice C's 26 rehearsal tests are green
and do not touch the hanging path.

Impact: pre-push drift gates exercising backup/quiescence can hang, forcing
rehearsal landings onto SNAPBACK_DRIFT_GATES_BYPASS=1; and the LLP 0057 backup
disaster-recovery contract is currently unverifiable on main.

Next: bisect commits after `ec96f04e5` for the backup-hang introducer (auth
catalog snapshot, quiescence lock ordering, or the SQLite online-backup path).
Main-health work independent of the rehearsal/identity program; flag the fleet.
