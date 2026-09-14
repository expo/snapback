# Snapback 4: requalify and reduce membership-feed query cost

Status: Open — query execution dominates on qualified 0.2.12; internal cost decomposition pending
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

Next work:

1. Split query CPU cost among transaction
   setup, membership enumeration, per-lane rule/metadata preparation, SQL
   stepping, row/key decoding, merge work and result/cursor construction.
   The unchanged lazy merge initializes every lane and uses one-row batches
   above eight groups; its repeated work is a source lead, not attribution.
2. Let the core owner choose a measured optimization. Pure schema/IR
   preparation reuse is a candidate; live authority or result caching is not
   permitted. Preserve fresh transactions, membership/expiry checks, static
   dependency/probe accounting, all meters/cut/refusal order, typed cursors,
   defaults and exact ordered results. Re-run affected differential and
   privacy regressions, then the scoped HTTP comparison.

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
