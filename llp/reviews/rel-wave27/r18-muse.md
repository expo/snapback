muse: workspace root: /home/ccheever/projects/sb4-b27-rel (cwd default)
muse: workspace trust: trusted source=run-flag
agent loop failed: model failed: API error 429 [request_id=04d7be78-f033-4c14-b4dd-1709832e398f]: Subscription quota exhausted. Your usage window resets at 2026-10-26T00:00:00Z. (rate_limit_error)
[muse-exec] plan quota exhausted; retrying with the Meta API key
muse: workspace root: /home/ccheever/projects/sb4-b27-rel (cwd default)
muse: workspace trust: trusted source=run-flag
READY

No MATERIAL masking, resurrection, or false-refusal defect in the exact R18 snapshot within its claimed scope.

* Masking: pre-forward `compareMoves(older,beforeForwardCallback)` requires every post-v1 `older` id including v1-born rows before the forward callback; post-forward `compareMoves(older,forward)` repeats it. Initial/forward adoption and rollback checks remain before-callback. Callbacks cannot repair loss before observation. Ephemeral exclusion cannot hide persisted rows — a move to ephemeral still drops the required persisted id and fails. Other SQL/data errors still refuse via `checked`.
* Resurrection: `deletedByV1` absence is asserted on all four per-cycle boundaries plus `beforeV1Writes`; declared deletes must start visible with empty fields and stay absent thereafter. `bornInV1` joins rollback requirements so the v2-native exception cannot excuse hiding v1-inserted rows.
* False refusal: lineage still uses full authored declarations; only populations are filtered by active catalog `kind === "ephemeral table"`. Non-ephemeral starters see an empty exclusion set. Identity simultaneity, source cache, complete-current vs selective header matching, unmeasured-lineage and duplicate-identity refusals are unchanged from R17 dual-READY.
