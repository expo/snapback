# Snapback 4: requalify and reduce membership-feed query cost

Status: Open — fixed 0.2.16 borrowed-text candidate measured; large continuation tails/throughput regress, candidate not adopted
Priority: P1
Systems: Snapback 4 online membership feeds, query execution
Implementation owner: Snapback 4 core lead (LLP 3000 decision 4)
Measurement owner: performance lane

The completed Office 0.2.10 comparison loses median latency to Convex in
all 18 feed cases. At 150 groups and eight concurrent clients, the rotating
feed is 23.327 ms versus Convex 3.847 ms and Supabase 48.635 ms. These are
medians of three reported statistics on a prepared local ARM Linux VM with
native backend caches enabled. They do not establish current-release,
hosted/WAN, cold-cache, write, device or durability performance.

A separate instrumented run of the same 0.2.10 source locates a useful
investigation area. The 150-group feed queries have the following timings
(96 selected observations per row, across three rounds):

| 150-group query | Mean CPU ms | Mean wall ms | Query wall p95 ms | CPU / query wall | Query / server wall |
|---|---:|---:|---:|---:|---:|
| First page, C1 | 4.719 | 4.735 | 6.956 | 99.65% | 89.08% |
| Rotating page, C1 | 6.180 | 6.212 | 9.339 | 99.49% | 91.52% |
| First page, C8 | 5.898 | 10.557 | 23.680 | 55.87% | 78.89% |
| Rotating page, C8 | 7.817 | 16.154 | 32.373 | 48.39% | 85.45% |

The C8 outer engine-lock waits average only 0.154/0.173 ms for first/rotating
pages. The query's wall-minus-thread-CPU residual averages 4.659/8.337 ms;
no particular internal lock, I/O or scheduler cause has been established.
First-page C1 cost exists without a cursor. Removing the final redundant
cursor encoding was already profiled and not adopted: a faster decode
microcase did not establish a reliable whole-query gain.

The diagnostic verified 18,432 HTTP calls, 2,160 excluded warmups and all
2,304 selected traces; 2,303 selected readers were reused. All physical,
authentication, outsider and before/after result proofs passed. An older
421-trace incomplete capture remains failed and is excluded. The observer
is present in the measurements and has not been calibrated away.

The current-source audit matters: `206650f29` and `886afe026` have identical
core/language/Cargo inputs, but the measured `beed6a51e` predates executable
rule-dependency, prefix-verdict and lookup-materialization changes. W5's
static probe allowance already existed in the measured source. The newer-source measurement below locates a query bottleneck; these separate
time windows do not isolate a cross-version regression or improvement.

Current-source follow-up, completed 2026-09-14:

The fixed `206650f29` 0.2.12 build passed 71 CLI tests and production
qualification with the same host-only observer. All 18,432 requests,
2,160 warmups, 2,304 selected traces, full fixture/auth proofs and owned
group cleanup passed. The two independent calculations agree on their
shared intervals and summary fields. Smoke and historical runs are excluded.

| 150-group query | Mean CPU ms | Mean wall ms | Query wall p95 ms | CPU / query wall | Query / server wall |
|---|---:|---:|---:|---:|---:|
| First page, C1 | 4.399 | 4.410 | 5.073 | 99.75% | 91.05% |
| Rotating page, C1 | 5.550 | 5.568 | 6.467 | 99.67% | 92.09% |
| First page, C8 | 5.585 | 11.138 | 22.781 | 50.14% | 84.72% |
| Rotating page, C8 | 9.384 | 17.293 | 33.239 | 54.26% | 82.53% |

At C8 the signed wall-minus-CPU residual averages 5.553/7.909 ms. The five
outer host mutex waits together average 0.301/0.117 ms; these include
program and reader-pool mutexes as well as engine locks. No internal lock,
I/O or scheduler attribution follows. The current measurements confirm
that query execution warrants the next investigation. They do not qualify
an uninstrumented improvement or a current competitor comparison.

Fixed-source core decomposition, completed 2026-09-15 00:09:22 UTC:

The d81381a98 0.2.13 snapshot plus temporary probes passed 73 CLI tests,
18,432 timed queries, 2,160 warmups and all 2,304 selected traces. The two
calculators agree on every core counter and the shared case summaries;
full fixture/auth proofs and cleanup passed. This adds no runtime change.

| Groups | Prepared scans | Live rule probes | Indexed scan collections | Row JSON decodes |
|---|---:|---:|---:|---:|
| 5 | 6 | 5 | 11 | 120 |
| 30 | 51 | 50 | 101 | 180 |
| 150 | 171 | 170 | 341 | 660 |

Those exact first-page counts hold in every selected C1/C8 query. At 150
groups, one discovery plus 170 message scans and their 170 live membership
lookups produce 341 indexed collections. Decoding covers 150 discovery
memberships, 170 proof rows and 340 fetched message rows for 20 outputs.
Rotating pages keep the scan counts but average 659.479 decodes as some
lanes fetch fewer rows. Counts may revisit rows and do not represent disk
reads, all SQL statements, meter units or unique returned data.

The measured first-page core CPU is 14.364 ms at C1 and 16.146 ms at C8,
but these are heavily instrumented queries with 5,024 scope guards each.
Do not compare these numbers with the earlier host-only observer as a
regression or use their exact partitions as uninstrumented CPU attribution.
The source/counters justify investigating repeated work; an ordinary A/B
must establish any gain. Static dependency preparation repeats per scan,
and scan/rule/index/row work remains live inside each query transaction.

Source drift: origin66a7c976 (manifest version 0.2.15) changed query/read/runner/pages and
TCP_NODELAY while this immutable run was in flight. Rules/store and host
serve match d813, but that is insufficient to claim current-source timing.
The next candidate must incorporate the newer cursor/completeness semantics.

Fixed-source preparation experiment, completed 2026-09-15 02:03:08 UTC:

Both ordinary production binaries use d0ea081923 (0.2.15), incorporating
the newer page/cursor/socket behavior. The ignored candidate reuses only
two static schema/IR analyses per original plain-merge template. It passes
318 selected Rust test executions and all six HTTP runs: 117,000 timed
case calls, 7,020 excluded warmups, 162 untimed walks / 33,510 pages,
complete physical/auth/result/leave/regrant checks and owned cleanup.
The original failed V1 test compilation and excluded smokes remain separate.

Main reached 0.2.16 before this evidence landing. Integration parent
1a4a50da8 changes core read/rule/admission/schema and host behavior from
the measured d0ea inputs; this batch does not qualify the newer runtime
or establish its performance.

**Do not adopt this version from the measured evidence.** The 150-group
rotating C8 feed's median p50 rises 19.176 → 24.454 ms (+27.52%), p95 rises
36.245 → 55.225 ms (+52.37%), and throughput falls 375.8 → 282.9 requests/s
(−24.72%). Its elapsed time worsens in all three pairs, as does the
150-group next page. Smaller concurrent feeds improve, so the result is
mixed; no causal attribution or new competitor comparison follows. All
losses, control variation and RSS/HWM observations remain in the evidence.

Fixed-source borrowed-text experiment, completed 2026-09-15 04:25:36 UTC:

The 009de62842 baseline and candidate both use 0.2.16. The candidate removes
one intermediate String copy in `Tx::scan_keys`, preserving SQL, typed
results and the key-before-JSON error order. It passed 546 selected Rust
tests, including three new differential cases, and all 117,000 ordinary HTTP
calls, 7,020 warmups, 162 untimed walks / 33,510 pages and full auth,
leave/regrant and cleanup checks. Both frozen calculators passed unchanged
on their first formal execution; all values, losses/ties and memory reconcile.

**This candidate is also not recommended for adoption.** Case-median p50
splits 19 better / 19 worse / 1 tie; p95 splits 16 / 23. At 150 groups and
C8, the next feed page moves 21.460 → 28.791 ms p50, 46.609 → 93.346 ms
p95 and 333.4 → 206.2 requests/s. Its p95/p99/elapsed/rate worsen in every
pair. First and rotating page medians improve in some metrics, but their
paired results and tails are mixed. RSS after medians rise 520 KiB with
mixed paired differences. Every loss and shared-VM/preparation limit remains
in the benchmark record. Removing this copy did not solve the larger cost.

Main reached 0.2.18 / 826108972 during the run. `scan_keys` itself is unchanged
there, but read/cursor/schema/host behavior differs; this fixed-source A/B
is not a current-release timing or a new competitor comparison.

Next work:

1. Target the remaining repeated indexed collections and row materialization,
   or establish the cause of the large concurrent losses with coarse/sampled
   attribution. Both rejected candidates and the expensive diagnostic
   shares must not be presented as performance wins. Use coarse or sampled
   attribution to separate SQL/row decoding from allocation and scheduling
   before selecting another small materialization change.
2. Keep core implementation with its owner. Live authority or result caching
   is not permitted. Preserve fresh transactions, membership/expiry checks,
   static dependency/probe accounting, all meters/cut/refusal order, typed
   cursors, defaults and exact ordered results.
3. Qualify the next candidate on its actual current inputs, with affected
   differential/privacy tests and ordinary HTTP A/B including leave/regrant
   and concurrent feeds. Retain tails, memory/write costs and all losses;
   compare current competitors separately after a candidate is qualified.

Evidence: [benchmark record](../benchmarks/runs/snapback4-public-catalog-20260913/README.md),
including original result objects in `snapback4/metrics/storage.jsonl`.
Local supporting files are under
`.llp/ship-runs/sb4-performance-20260913/`: formal transfer `eba60c90…`,
independent summary `81055afd…`, review `19a4b5b7…`, reconciliation
`0eee78c1…`, and `membership-stages-current-source-handoff-audit.md`
(0b0eba5e7ea563da9461a91237d05f4e221003bb65690900ddf28c2c8b7053ce). The current-source binding file is `18551175…`.

No core code, policy, ceiling or client contract is changed by this ticket.

Current-source bindings under the same local run: formal transfer
`0fffccfc…`, independent summary `1b626d34…`, review `f748ffad…`,
reconciliation `e5deff38…`, and build qualification `dff38735…`.

The core-scope record is the ledger workload
`membership-http-core-scope-diagnostic`: V2 qualification `a3dedaef…`,
V3 formal transfer `c23f67d0…`, independent summary `29b6fa3b…`,
reconciliation `4483be1c…`, and source-drift mapping `070c5afe…`.

The 0.2.15 ordinary A/B uses ignored-run prefix
`membership-scan-preparation-0215-v2-http-v1`: formal transfer `24400ba3…`,
completion `4f5cf9ec…`, root summary `1668fa83…`, independent summary
`ee74ee95…`, reconciliation `0a2cc6bc…`. Both frozen calculators passed
unchanged; all 1,404 run values, 468 medians, 234 median contrasts,
702 paired contrasts and twelve memory snapshots reconcile. The six ledger
objects preserve their full original formal records.

The 0.2.16 borrowed-text A/B uses ignored-run prefix
`membership-borrowed-scan-0216-v1-http-v1`: formal transfer `7d3ea92e…`,
completion `e71e95fe…`, root summary `0a9cc815…`, independent summary
`b5f05db8…`; six exact original formal records are appended to the ledger.


## 2026-09-15 — current-source external stack diagnostic

The unmodified 0.2.18 source `053a5b288…` completed four externally sampled
150-group first/rotating-page loads at C1/C8. All 158,243 active responses,
6,120 preparation/warmup responses and before/after logical/auth checks
passed; all owned groups stopped. Independent call-tree analysis agrees with
the root calculation. Request/query observation counts are 1,203/1,174,
1,266/1,243, 11,353/11,194 and 11,387/11,289. Rotating-page cursor ancestry
accounts for 308 and 2,974 request-subtree observations; kernel mutex waits
are 0/0/4/4. These are overlapping sampled stacks, not CPU percentages,
latency components or evidence that contention is absent.

The next concrete experiment is reuse of a successfully decoded cursor
within one lazy merge when later lanes present the identical token and
descriptor. Initial validation before discovery, all expression evaluations,
canonical encoding, scope/generation checks, meter charges and live row/rule
reads must remain. An ignored candidate exists for review and qualification;
no runtime adoption or speedup is claimed. This is distinct from the old
rejected experiment that removed canonical re-encoding. The cursor and scan
work remain open until ordinary unsampled HTTP results justify a change.

Full scope and provenance are in the benchmark README's 0.2.18 stack section;
independent review `9951d0ce…`, audit `3de9cebe…`, parser reconciliation
`9db47dd9…`. No current comparator batch ran here.
