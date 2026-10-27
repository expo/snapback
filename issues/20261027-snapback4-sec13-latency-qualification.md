# SEC13 / SEC11b integrated latency remains unqualified

Status: Open
Date: 2026-10-27
Updated: 2026-10-28
Scope: Snapback 4 Integration 29, SEC11L, SEC11b and SEC13

Integration 29 completed the paired SEC11L protocol: 50 wave-30 schemas,
four modes, independent cold source/JSONL copies per binary/mode and a warm
repeat, adjacent before/after runs with alternating first binary. All 800
commands completed without tool timeout; each pair has identical source hashes.
Original wave stores were never opened. This is a shared-host matched window,
not an unloaded-host claim; peak load/affinity CPU was 1.1104. The paired cold
regressions and increased process CPU cannot be explained away as host load.

The 0.4.44 control is Integration 28's recorded production timing snapshot,
source `9b9f1a74af4f`, SHA-256
`aa6a5388fcf1f26066abb49af8b40da076145bef34493c91f674fd858b1005bf`.
It is distinct from the later d1bd consumer executable. Its later source changes
are ownership/recovery paths and comment-only LLP identifiers; the measured
SQLite commands do not exercise those changed paths. The merged 0.4.45
measurement is source `c3c56b5057`, SHA-256
`de5781296ff65db2ad32345a88d06c5d4d9a87bd041ce94ed95932c13ac637c8`.
Both SEC11b and SEC13 are present. The subsequent explicit-column-intent repair
changes the inferred contract/note payload of exactly two other survey schemas;
all 50 timing fixtures have identical model payloads. These remain measurements
of the named pre-repair executable, not a new measurement of the final native.
Latency acceptance remains open.

| Mode | 0.4.44 cold p50 / p90, s | Merged cold p50 / p90, s | 0.4.44 / merged warm p90, s |
| --- | ---: | ---: | ---: |
| check --review | 6.384 / 15.525 | 10.326 / 22.995 | 14.795 / 15.454 |
| production deploy | 10.468 / 19.209 | 13.603 / 27.753 | 2.560 / 2.680 |
| default check | 6.407 / 16.454 | 10.226 / 21.676 | 14.841 / 15.869 |
| deploy --staging | 7.461 / 18.156 | 10.832 / 21.183 | 2.326 / 2.543 |

Default check p90 exceeds 10 s and staging deploy p90 exceeds 15 s. No
no-regression claim is made. Cold median paired after/before ratios are 1.321,
1.418, 1.244 and 1.255 respectively. Bootstrap 95% intervals for the median
paired cold deltas exclude zero: review [1.227, 3.947] s, production
[1.580, 4.612] s, check [0.816, 3.681] s, staging [0.896, 3.932] s.

The worst merged cold check is wave30-026 film-camera repairs: wall
19.475 -> 31.846 s, process CPU 17.684 -> 49.615 s. Its merged question campaign
span is 26.880 s, derived-report span 22.975 s, derived replay 14.032 s and
fixture initialization 7.662 s. These spans nest and independent campaigns
can overlap; their times must not be summed as wall time. Orchard pruning
018 and ladder inspections 013 also show increased campaign CPU. The raw
profiles identify the schema and phase counters for each of the three slowest
commands in every mode/temperature.

The cheap time-candidate compilation cause was addressed by joining SEC13's
candidates to SEC11L's batch compiler, with literal independent-compilation
equivalence tests. Remaining work is campaign selection/replay and fixture
initialization. Default check's apparently repeated report is not safe to
replace with its first report: the initial campaign reserves 512 work units,
while derived witness collection reserves the production 3072. Reusing the
smaller result would lose evidence. Design equal-budget report reuse or cheaper
campaign execution while preserving current gate freshness, all question
families, literal decision/witness identities and full raw payloads. Do not
increase work limits, omit questions/gates, relax targets or normalize identities.

Retained evidence: [paired summary](../snapback4/reports/integration29/latency-summary.json),
[paired profiles and confidence intervals](../snapback4/reports/integration29/latency-profile.json),
[baseline provenance](../snapback4/reports/integration29/latency-baseline-provenance.json).
Full raw rows, phase traces and executable snapshots remain under
`~/sb4-loop/reports/integration29/`. The earlier SEC13 loaded-host launch/main
comparison remains in `snapback4/reports/sec13/latency.json`; it is superseded
by this matched integrated profile for diagnosing the regression, not by a pass.
