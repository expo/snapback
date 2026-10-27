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
