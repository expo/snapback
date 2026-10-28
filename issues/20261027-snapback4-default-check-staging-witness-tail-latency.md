# Snapback 4 default check and staging witness tail latency

Status: Open
Date: 2026-10-27
Scope: Snapback 4 CLI, Integration 28 / 0.4.44

The 54-schema deterministic stratified sample (three per wave, waves 15–32)
misses the requested default-check 10s and cold staging-deploy 15s p90 targets.
Optimized native test-profile binary e4f952338b3f68d144b1bbd55fe896232791f78baf4b15b87e81aa10579746a7;
source/fixture copies only, four latency workers, shared bakeoff host. Other
survey workers overlap; these are loaded-host measurements, not production SLA.

Median / p90 seconds, cold then warm:
- 0.4.43 check: 11.843 / 56.845; 4.911 / 36.463.
- 0.4.44 check: 6.082 / 14.232; 4.950 / 12.219.
- 0.4.43 staging: 14.621 / 59.664; 0.988 / 2.206.
- 0.4.44 staging: 6.794 / 15.861; 0.862 / 1.657.

Profile: wave21 017 search-rescue cold staging takes 24.013s: ordinary witnesses
12.590s, independent omitted-question replay 10.344s; the two 8192-work question
campaigns total 22.396s. Wave31 033 garage-floor cold check takes 23.916s:
ordinary witnesses 9.109s and restoration 13.703s, dominated by fixture generation
(12.392s across four calls) and replay. Binding is 0.146s. The fixed question
budgets and SEC11/SEC12 tiers must survive any optimization; restoration never
reads an advice cache. Avoid budget cuts or caching authority. Candidate follow-up:
reuse immutable generated fixture snapshots across independent campaigns, or
schedule restoration concurrently while preserving original reduction/order and
source/decision identity guards. Verify cold/warm IDs and verdicts against the
uncached sequential control before claiming improvement.

Evidence: snapback4/reports/integration28/latency-tier-profile.json and latency
summary; full phase traces live under ~/sb4-loop/reports/integration28/
latency-tier-rows.json. Reproduce with the retained latency harness and key list.
No threshold assertion was weakened. Full production and Mac qualification
remain publication work.

## Final production-binary measurement

Use the actual wave32 digest-pinned static 0.4.43 binary (a8c85c5907b50bc62419313594f0563a9171a58795191bd13d21ff6fe2114b74)
and Integration 28 static 0.4.44 (aa6a5388fcf1f26066abb49af8b40da076145bef34493c91f674fd858b1005bf)
for the builder-facing result. Same deterministic 54-schema sample, four latency
workers alongside four survey workers. This is a stratified sample of the 940-schema
corpus, not a full latency census. Source/fixture copies only; zero tool failures.

| Command | 0.4.43 median / p90 | 0.4.44 median / p90 |
| --- | --- | --- |
| check cold | 6.238 / 33.032 | 8.460 / 21.395 |
| check warm | 2.303 / 15.140 | 6.069 / 16.317 |
| staging cold | 7.280 / 31.326 | 9.085 / 27.189 |
| staging warm | 0.554 / 1.094 | 1.490 / 2.706 |

Both cold tails improve, while medians and warm measurements regress; the 10s/15s
cold targets remain unmet. Wave31/033 takes 36.841s for cold check: ordinary
witness collection 24.463s (derived report 24.027s), followed by independent
restoration 11.032s. Cold staging is 35.735s: ordinary witnesses 23.428s,
restoration 9.947s. Generated initialization dominates both. Default check and
non-strict staging begin with a 512-work report; their collector independently
needs the larger augmented derived report. Reusing that weaker initial report
would change verdicts and is not a safe one-line optimization. The 3072/8192 work
budgets and independent tier-preserving replay remain intact.

The final public profile is latency-production-profile.json beside this report's
retained evidence. Candidate follow-up: share immutable fixture initialization,
or schedule independent replay concurrently with ordered reduction and current
source/decision guards. Recompare exact verdicts and witness payloads against the
uncached sequential control. No threshold or security assertion was weakened.

## LAT1 branch qualification

The LAT1 branch meets every requested timing target on the same matched 54-schema
production sample. See `snapback4/reports/lat1/` for full values and provenance:
check cold p90 5.655 s, warm median/p90 2.398/4.939 s; staging cold p90 5.584 s,
warm median/p90 0.077/0.138 s. Review/production are faster in all 54 pairs.
A supplemental matched window confirms every cold and warm review/production
pair is faster: warm review median/p90 2.377/4.786 s; warm production
0.075/0.171 s. Exact values and frozen-binary provenance are retained alongside
the original default-loop qualification.
The independent 940-schema / 5,640-pair comparison now qualifies identity modulo
the separately ticketed upload-ID nondeterminism: 5,610 literal matches, 30
source-reviewed nonce-only pairs, zero unexplained differences; unchanged-control
double executions reproduce that drift in all 18 affected schemas. Full data and
hashes are in `snapback4/reports/lat1/identity-*.json`. Final affected verification
is recorded in `WORKSTREAM-REPORT.md`. Keep this main-branch ticket open until
the coordinator integrates the qualified LAT1 commits; this lane is not authorized
to push or perform publication. No budget, assertion or tier was weakened.
