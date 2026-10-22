# RT5 qualifying run: Hetzner path (expo-build-450b → expo-build-450a)

Run by the lead on 2026-10-22 with the exact README command, source `3e945e6146`
(clean), release build with `--features rt5`. Target: a private PostgreSQL 16.15
cluster started on expo-build-450a by `scripts/cluster.sh start ~/sb4rt5 55493`
(postmaster PID 924816, stopped and confirmed after the run). Because the S1b
tunnel allocator requires role `postgres`, the lead added `CREATE ROLE postgres
LOGIN SUPERUSER` and a `host all postgres 127.0.0.1/32 trust` line to that
private cluster before the run; no other configuration changed. One SSH stream
per physical connection (64 tunnels), C=32, 1 s warm-up, 4 s measurement, three
fresh processes per shape/form. `cleanup.json`: 97 children and 64 tunnels
stopped, every schema removed, no PIDs left.

| Shape | Form | Flights | Executions/s (median) | p50 ms | p99 ms (median / worst) | Correct |
|---|---|---:|---:|---:|---:|---|
| W1 | per-statement (B1 counts) | 6 | 4,686 | 6.32 | 13.86 / 14.07 | yes |
| W1 | (a) ordered SimpleQuery | 3 | **8,535** | **3.36** | 8.24 / 9.17 | yes |
| W1 | (b) PL/pgSQL envelope | 5 | 5,589 | 5.30 | 11.22 / 11.42 | yes |
| Mutation | per-statement (B1 counts) | 16 | 79 | 373.0 | 712.9 / 721.9 | yes |
| Mutation | (a) ordered SimpleQuery | 8 | **141** | **226.1** | 324.5 / 460.2 | yes |
| Mutation | (b) PL/pgSQL envelope | 11 | 110 | 293.0 | 372.2 / 399.3 | yes |

Link controls: prepared-ping p50 0.59–0.64 ms in every before/after control;
p99 0.78–3.73 ms (no 40 ms tail as in the later S1-PG2 cells). The
"per-statement" baseline models B1's flight counts, not today's 23/57-exchange
serving path.

**Result:** (a) is fastest on both shapes and its latency holds, so by §3.6's
rule RT5 adopts (a), subject to the blind review of the encoder.
