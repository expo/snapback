# Part 1 statistics

Fresh R8 W4/A 3,805 diagnostic; 195 ACKs including warm-up. App role only. Statistics span the matching observation cohort including settlement. Nested timings are inclusive; rows/buffers are deltas. No SQL literals, fixture rows or raw query text are included.

## Statements by total execution time

| Family | Query ID | Calls/ACK | Total exec ms | Mean exec ms | Rows | Shared hits | Shared reads | Dirtied |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| Session/authority facts + guard | -5778624442834938677 | 26.733 | 503.84 | 0.097 | 5213 | 67769 | 0 | 0 |
| Search-path/authority guard | -7821739819591719685 | 36.682 | 241.46 | 0.034 | 7153 | 0 | 0 | 0 |
| Retention timeline aggregation | 1580756788528764843 | 9.333 | 177.78 | 0.098 | 1820 | 72 | 0 | 0 |
| Insert enriched attempt/void record | -1188327354710964809 | 26.738 | 128.69 | 0.025 | 5214 | 16282 | 0 | 124 |
| Lock durable head | -1589499225989691468 | 9.333 | 119.22 | 0.066 | 1820 | 3775 | 0 | 0 |
| Update retention floor/timeline | 8884378234440438292 | 9.333 | 94.36 | 0.052 | 1820 | 7358 | 0 | 15 |
| Checked R data flight | -6795049754790196104 | 1.000 | 73.37 | 0.376 | 195 | 5069 | 0 | 14 |
| Retention timed floor | -625247552397469989 | 9.333 | 63.84 | 0.035 | 1820 | 0 | 0 | 0 |
| Insert change evidence | 6533877919146760173 | 26.738 | 54.72 | 0.010 | 5214 | 16010 | 0 | 52 |
| Advance durable head | -3068329677498837685 | 9.333 | 50.54 | 0.028 | 1820 | 5533 | 0 | 0 |
| Begin read-committed write transaction | -8398854287156276377 | 37.087 | 45.83 | 0.006 | 0 | 0 | 0 | 0 |
| Lock/read retention state | 6756654106783610207 | 9.723 | 27.98 | 0.015 | 1896 | 5724 | 0 | 0 |

## Statements by mean execution time

The slowest individual app statements are distinct literal-bound head catch-up/retention blocks. Each was called once (0.00513 calls/ACK); they are separate normalized query IDs.

| Family | Query ID | Total/mean exec ms | Calls/ACK | Rows | Shared hits | Shared reads | Dirtied |
|---|---|---:|---:|---:|---:|---:|---:|
| Head catch-up/retention block | 3580544927245102739 | 7.759 | 0.00513 | 0 | 22 | 0 | 0 |
| Head catch-up/retention block | -2322123909708455255 | 7.553 | 0.00513 | 0 | 22 | 0 | 0 |
| Head catch-up/retention block | -6947320546085198483 | 6.965 | 0.00513 | 0 | 22 | 0 | 0 |
| Head catch-up/retention block | -5265524997945931483 | 6.515 | 0.00513 | 0 | 23 | 0 | 0 |
| Head catch-up/retention block | -1070982628203419453 | 5.953 | 0.00513 | 0 | 22 | 0 | 0 |

## Table and index deltas

`n_dead_tup` is an estimate at each snapshot, not an exact count. All shown tables are in `bench`. Metadata scans touch small relations; `r` has no sequential scan.

| Relation | Seq scans | Seq tuples read | Index scans | Index tuples fetched | Inserts | Updates | Deletes | HOT updates | Dead before→after |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| _head | 14266 | 14266 | 0 | 0 | 0 | 1880 | 0 | 1880 | 7→54 |
| _read_sessions | 5762 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0→0 |
| _owner | 87 | 87 | 0 | 0 | 0 | 84 | 0 | 84 | 14→14 |
| _spike_retention | 2 | 1 | 7512 | 7511 | 1 | 1880 | 0 | 1862 | 5→51 |
| _backend | 5537 | 5537 | 0 | 0 | 0 | 0 | 0 | 0 | 0→0 |
| _principal_generations | 5485 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0→0 |
| _commits | 1 | 328 | 2009 | 0 | 5407 | 0 | 0 | 0 | 0→1 |
| _change_evidence | 0 | 0 | 1940 | 0 | 5407 | 0 | 0 | 0 | 0→0 |
| _meta | 36712 | 587344 | 200 | 200 | 0 | 0 | 0 | 0 | 5→5 |
| i | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0→0 |
| r | 0 | 0 | 280 | 1304 | 0 | 244 | 0 | 92 | 21→173 |
| _sessions | 32 | 8224 | 5730 | 5730 | 0 | 0 | 0 | 0 | 0→0 |

| Relation | Index | Scans | Tuples read | Tuples fetched |
|---|---|---:|---:|---:|
| _spike_retention | _spike_retention_pkey | 7512 | 7528 | 7511 |
| r | r_pkey | 280 | 1448 | 1304 |
| _commits | _commits_pkey | 2009 | 139 | 0 |
| _sessions | _sessions_pkey | 5730 | 5730 | 5730 |
| _meta | _meta_pkey | 200 | 200 | 200 |
| _change_evidence | _change_evidence_pkey | 1940 | 70 | 0 |

## WAL and sampled waits

| Cohort | WAL B | Records | FPIs | Syncs | WAL B/ACK | Syncs/ACK |
|---|---:|---:|---:|---:|---:|---:|
| Cold G6 | 3685740 | 39771 | 19 | 7307 | 18901.23 | 37.47179 |
| Primed G6 | 214253799 | 943610 | 14175 | 11086 | 1876.95 | 0.09712 |

Waits are counts of backend observations from 0.2 s polls, not wait-duration percentages. The dominant state is idle client backends waiting on the app, consistent with admission starvation rather than large-table scanning.

| Backend/state | Wait type/event | Observations |
|---|---|---:|
| client backend/idle | Client/ClientRead | 6486 |
| autovacuum launcher/— | Activity/AutoVacuumMain | 207 |
| logical replication launcher/— | Activity/LogicalLauncherMain | 207 |
| walwriter/— | Activity/WalWriterMain | 207 |
| checkpointer/— | Timeout/CheckpointWriteDelay | 206 |
| background writer/— | Activity/BgWriterMain | 128 |
| client backend/active | IO/WALSync | 82 |
| background writer/— | Activity/BgWriterHibernate | 79 |
| client backend/active | —/— | 41 |
| client backend/idle | —/— | 6 |
| client backend/active | Client/ClientRead | 5 |
| client backend/active | LWLock/WALWrite | 4 |
| client backend/idle in transaction | Client/ClientRead | 2 |
| checkpointer/— | IO/DataFileFlush | 1 |
| client backend/active | IO/WALWrite | 1 |
