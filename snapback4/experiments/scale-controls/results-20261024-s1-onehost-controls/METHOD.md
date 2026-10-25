# S1-C one-host method

The commissioned method is [LLP 3000.009.001.002 §9](../../../../llp/3000.009.001.002-scale-limits-against-postgres-controls.rfc.md#9-phases). The comparison uses the shared [`s1-onehost.py`](../scripts/s1-onehost.py) runner, [`run.py`](../scripts/run.py) rate search and the unchanged Rust intended-arrival generator. There is one host, expo-build-450b (`expose-builder-pixel-a`), Ryzen 5 3600, six physical cores /12 threads.

| Component | Physical cores | Logical CPUs |
|---|---|---|
| Private PostgreSQL 16.15 | 0–2 | 0–2,6–8 |
| Service and common delay proxy | 3–4 | 3–4,9–10 |
| Generator | 5 | 5,11 |

Each system gets a fresh, private, socket-only PG16.15 cluster and its deterministic 1M-message seed. The repository’s `postgresql.conf.delta` supplies all durability/resource settings: fsync, synchronous_commit and full_page_writes on; fdatasync; shared_buffers 8 GiB; max_connections 320; min/max WAL 1/4 GiB; JIT off; pg_stat_statements and IO/WAL timing on. Only endpoints change to the owned private socket directory; TCP is disabled. Local socket trust matches S1-PG4. This changes database transport/authentication at connection setup; application JWT authorization remains in the measured request path.

All targets connect through the **same external Unix proxy**, including the raw pool, PostgREST’s pool/listener, Convex’s Postgres driver and native Snapback. The proxy is the unchanged S1-PG4/S0 FIFO chunk-delay implementation. A adds 250 µs per direction; B adds 500 µs per direction. These are added delays, not absolute RTT promises. There is no SSH or extra per-control TCP dispatcher. Before and after each cell, 100 warm-ups precede 1,000 prepared SELECT 1 measurements through that exact proxy. Those controls exclude application authorization/HTTP work.

Inherited service configuration records `delay_us=0` for its internal TCP
dispatcher/proxy because that internal hop is bypassed. The cell manifest,
external proxy announcement and before/after RTT receipts record the actual
selected 500/1,000 µs round-trip addition; the delay is applied exactly once.

Cells are W1 visible point, W2 newest 20 messages, W3 32-room inbox, W4 disjoint counters, W5 exact shared counter (`same`) and W5 nominal 1% mix (`hot1`), each on A/B. Every cell starts a fresh service; repetitions and rate settings retain its ordinary caches/pool. Each rate has three repetitions of 10 s warm-up and 20 s measurement. Reads use 128 clients and pool/function cap 32; writes use 32 clients and cap 32. Supabase additionally has its schema listener. Convex’s 32-connection pool also serves background workers.

The search starts at 1,000/s for reads, 3,200/s for disjoint/mix writes, and 100/s for exact shared writes. It doubles/halves to bracket and tests one geometric midpoint, with a 128,000/s maximum. **Every read cell also tests pre-registered rates 19,027 and 22,627**, even when the earlier search has failed. All three repetitions at a rate must meet intended-arrival p99 ≤50 ms reads /100 ms writes, errors ≤0.1%, and write-counter equality across warm-up plus measurement. The table selects the highest tested offered rate; failed repetitions cannot be replaced by passing ones. No interpolation or confidence interval is implied. Expired and timed-out arrivals remain counted in the latency/error ledger.

Raw PG keeps the fairness control’s per-request HS256 signature/claims validation and signed-subject identity, its typed SQL and pool 32. Supabase keeps PostgREST 14.18, offline Supabase JWTs, RLS helpers, definer inbox/counter RPCs, prepared statements and JWT cache of 1,000 entries. Convex keeps the pinned official `precompiled-2026-10-10-72ce13c` release, Postgres-v5, query/mutation concurrency 32, document retention 172,800 seconds, default query caches, default index retention and default 100 ms OCC initial backoff. No sharded counter variant, tuning change or managed service is introduced.

The controller samples one second of process CPU at each cell start. An unrelated process above one core causes a recorded wait/recheck; loadavg is recorded rather than used as a substitute for that rule. Live app/proxy, PG parent/backend and generator affinity witnesses bind the split. These checks qualify observed boundaries and do not reserve the host against later activity. The runner checks `/home` free space before setup and every trial; the supervisor checks during campaigns, stopping below 30 GiB. Only recorded processes are signalled. Each service and cluster is stopped, its socket/pidfile checked, and the stopped private data removed. Credentials remain private until a known-secret scan, then their owned directories are removed.

Authorization/image/counter checks are outside timing. Raw/Supabase validate every message formula and maintained room/sender total. Convex exports the imported fixture and compares every table’s count, modular SHA-256 sum and XOR with the unchanged deterministic generator. Native Snapback uses the existing `Engine::seed_at` helper, account sessions and maintained-total recount; SQL does not write its managed rows. The native adapter uses its existing FIFO session-mint/stable-counter drain. Raw/Supabase retain their inherited application-SQL drain; Convex retains two zero outstanding-HTTP/unpublished-commit observations, 100 ms apart. These different native settlement mechanisms feed the same mandatory counter-equality verdict; unknown outcomes fail.

`audit.py` independently checks arrival arithmetic, every repetition, histogram counts/lossless compression, SLO/counter verdicts and selected brackets. Raw per-trial/HDR/resource/wait/PID evidence stays outside Git with an archive SHA-256. Git holds aggregated rate/latency/resource summaries, host/affinity/seed/cleanup receipts and this report. Short windows, native caches, coarse search and synthetic fixtures limit the result to this recorded experiment; it is not a production-capacity or publication qualification.
