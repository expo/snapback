# Snapback 2 package growth exceeds the accepted byte baseline

**Status:** Open
**Priority:** P0 (measured budget breach)
**Owner:** Codex, four-plan implementation commission
**Date:** 2026-09-11
**Related:** LLP 1018.008, LLP 1018.008.005.000, LLP 1018.008.006.000, rules/RULES.md

`node snapback2/scripts/measure.mjs --check` retains a red byte verdict. The
same Node 24.18.0 / esbuild 0.25.9 / gzip 9 packaged ESM-closure measurement gives:

| Entry | Last accepted | Pristine bf8450849 | Four-plan candidate | Candidate delta from pristine |
| --- | ---: | ---: | ---: | ---: |
| client | 136,547 | 142,125 | 145,189 | +3,064 (+2.16%) |
| React | 146,166 | 152,478 | 155,056 | +2,578 (+1.69%) |
| Expo | 149,836 | 156,010 | 158,589 | +2,579 (+1.65%) |
| complete local runtime | 84,580 | 88,008 | 88,053 | +45 (+0.05%) |

All four entries already exceed the 1% guard on the pristine base. This program
adds further package bytes for composed page resources and shared recovery;
the total is not attributed to one implementation by subtracting individually
gzipped files. The complete local runtime remains below its 90,000-byte ceiling
and above its 80,000 target. No measurement root, ceiling, accepted baseline or
normal growth check was changed. The recorded candidate remains
`byte_baseline_accepted: false`; no package publication is qualified here.

Under the author's delegated plan judgment, the implementation retains these
reviewed shared owners and records this size trade explicitly. It does not
claim to have met the normal growth guard. Follow up by attributing the public
entry growth and removing unnecessary emitted code or sharing existing
implementation. Do not hide bytes in an unmeasured entry or grant the candidate
an accepted baseline by rerunning the same failing check. Any later budget
trade must preserve the actual before/after evidence.

The candidate record is the 2026-09-11T15:38:58.398Z append in
`snapback2/metrics/loop.jsonl`; matched pristine runtime evidence is retained in
`metrics/twin.jsonl`. Root's ignored raw logs and exact canonical measurement
functions are under `/tmp/snapback2-four-plans-{measure,baseline-runtime,baseline-package-bytes}.*`.

## One-time publication disposition — 2026-09-11

For the subsequent Linux-capable release, the author explicitly answered:
"Allow this release; retain size cleanup." The request disclosed the exact
client/React/Expo closures, **145,189 / 155,056 / 158,589 gzip bytes**, and the
unchanged **90,000-byte** complete-runtime ceiling. This is permission to
publish that measured package-size trade for this release, subject to all
remaining native/runtime/publication qualification. It does not reset an
accepted baseline, change the normal check, authorize later growth, or close
this cleanup ticket. The original measurements and red verdict remain intact.
