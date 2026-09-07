# Grok 0.0.16 original M3 boundary

The original M3 four-hour boundary was 2026-09-07 23:48:03 UTC, derived from the recorded start epoch 1788810483 and unchanged 14,400-second budget. The observer began 0.012840 seconds after that boundary. Receipt copies were sequential, with actual timestamps and hashes recorded. The native builder and its supervisor were still live; this was not a process terminal or a clock extension.

The latest separately preserved completed attempt before the boundary was 23:44:17.989 UTC: five passes, one failure and one optional skip, with `green:false`. The failing membership scenario did not observe voluntary leave within 20 seconds. All attempts remain in its raw receipt. At the boundary, the builder had reused the JSONL paths for an in-flight attempt and they were empty; that empty snapshot cannot substitute for the last completed result.

Root read the complete observation, preserved run log, plan and latest completed receipt. The run log's cause attributions are the builder's observations, not independently proven product diagnoses. No intervention or findings were sent to the builder. This evidence is an intermediate deadline observation, not a holistic score or acceptance-coverage audit. No later result may be treated as having completed before this original boundary.

`copied-evidence.json` binds each byte-for-byte copy to its original path and hash. The complete native prefix remains outside the checkout and is hash-bound in the observation. Comparator baselines remain unchanged.
