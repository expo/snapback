# SEC13 / SEC11b integrated latency qualification

Status: Closed
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

Retained evidence: [paired summary](../../snapback4/reports/integration29/latency-summary.json),
[paired profiles and confidence intervals](../../snapback4/reports/integration29/latency-profile.json),
[baseline provenance](../../snapback4/reports/integration29/latency-baseline-provenance.json).
Full raw rows, phase traces and executable snapshots remain under
`~/sb4-loop/reports/integration29/`. The earlier SEC13 loaded-host launch/main
comparison remains in `snapback4/reports/sec13/latency.json`; it is superseded
by this matched integrated profile for diagnosing the regression, not by a pass.

## Integration 30 resolution — 0.4.46

Resolved on native source `7aef642aa38471d70eca0128d0a5ddd3b4cf518a`,
production SHA-256 `e01da19c3cde5ba6c81dae725983e09a4441924fb91c800eeb37a3ea95778778`.
LAT1 shared fixtures/campaign scheduling now includes the SEC11b/SEC13 context;
strict production SECP restoration joins concurrently with its original note
vector and current-source guards. Immutable declaration/source facts are
computed once per report. Work budgets, tiers and authority replay stay intact.

The complete paired production window uses the actual packaged dist 0.4.44,
retained Integration 29 0.4.45 and merged 0.4.46, four workers, 63 cases / 1,890 commands.
On the deterministic 54, default check cold p90 is 5.834 s and warm median 2.104 s;
cold staging p90 is 5.866 s. On the nine exact day-two cases, cold check p90 is
5.588 s, warm median 1.988 s, staging cold p90 5.487 s and `deploy --check` cold/warm
p90 is 7.602 / 6.407 s. Every reported median, p90 and maximum is faster than 0.4.44.
The previous complete candidate missed warm check 2.5 s (2.590462 s); its data is
retained separately, and the full final matrix reran after the real engine fix.
No limit or assertion was raised.

The full 1,020-schema current-source comparison validates 6,120 paired security
envelopes / 12,240 invocations: 6,091 literal matches, 29 host-upload-ID-only pairs,
zero unexplained differences/tool/input failures. Two independent executions
of the unchanged sequential control reproduce the same nonce class in all 17
affected schemas. The raw comparator retains exit 1; identity is qualified
modulo the already open upload-ID presentation ticket, not literal byte identity.
All decision/witness IDs, verdicts, gates, tiers and other payload fields remain unchanged.
Original stores were never opened.

Evidence: [paired summaries](../../snapback4/reports/integration30/latency-summary.json),
[acceptance bars and hashes](../../snapback4/reports/integration30/latency-verdict.json),
[identity qualification](../../snapback4/reports/integration30/identity-summary.json),
[verbatim metrology](../../snapback4/reports/integration30/metrology/README.md).
Raw captures and frozen binaries remain under `~/sb4-loop/reports/integration30/`.
