# REL5 day-two replay evidence

Six passing runs: wave-17 Snapback lanes 013, 030 and 042, twice each on a persistent private production store. The source revision and executable digest are in provenance.json. The subsequent 421a345ea1 correction changes only compatibility warning dependencies for search indexes.

Only release-selection workarounds were removed (exact proof.patch files); original schemas and business assertions were preserved. Each lane's original source hashes were checked after execution. No source evidence or original deployment was changed. Copies, stores, identities and tokens were removed after execution. Logs retain business proof output only. Release directories remain exactly 1 and 2 on every run.

lane-replay.json contains all business assertions and exit results; *-check.log and *-day2-*.log are captured command output. Lane 042 intentionally revokes OR access to loads in v2: its original proof labels that old-client result degraded, while all data/rule/transition assertions pass. This is preserved rather than suppressed.
