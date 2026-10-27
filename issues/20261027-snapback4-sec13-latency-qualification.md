# SEC13 needs integrated SEC11L latency qualification

Status: Open
Date: 2026-10-27
Scope: Snapback 4 SEC13 / Integration 28

The prescribed SEC13 launch base 0681306baa and merged origin/main 98177aa48b
lack SEC11L's immutable-artifact cache and parallel campaign changes. SEC13
has not merged another security workstream, as directed. Its loaded-host cold
50-schema measurements cannot establish the requested no-regression bar.

Review p90: launch baseline 37.489s, SEC13 43.277s (+15.4%). Production deploy
p90: baseline 61.667s, SEC13 55.841s (-9.4%). Both used source-identical fresh
copies and one worker; peak load/affinity CPU was 0.869 / 0.941. These are
observations, not a successful SEC11L comparison. They also exceed SEC11L's
historical 8.332s / 7.528s figures. No latency acceptance is claimed.

Integration 28 should include the performance lane, then rerun SEC11L's cold
50 review/deploy protocol with its load ceiling and equal source hashes.
Investigate SEC13 candidate/replay overhead if the paired unloaded comparison
regresses; do not increase work limits, omit new questions, or lower targets.
Raw rows, binary digests and summaries: snapback4/reports/sec13/latency.json
and latency-rows.json.gz. Private originals: ~/sb4-loop/reports/sec13/.
