muse: workspace root: /home/ccheever/projects/sb4-b27-rel (cwd default)
muse: workspace trust: trusted source=run-flag
agent loop failed: model failed: API error 429 [request_id=a23cac34-fbb7-49b9-879f-14a018b53397]: Subscription quota exhausted. Your usage window resets at 2026-10-26T00:00:00Z. (rate_limit_error)
[muse-exec] plan quota exhausted; retrying with the Meta API key
muse: workspace root: /home/ccheever/projects/sb4-b27-rel (cwd default)
muse: workspace trust: trusted source=run-flag
READY

No MATERIAL masking, resurrection, or false-refusal defect in the exact recipe and §21 scope.

Callback boundaries are ordered correctly: initial v2 checks predecessor ids before `v2` callback; forward checks surviving ids, non-excluded values, and all declared-deletion absences before `forward-v2` callback and again after; rollback checks predecessor-id visibility and prior-deletion absence before the `v1` callback and again after. A callback therefore cannot repair adoption loss/corruption before it is observed, nor delete a resurrected row again to hide resurrection — the pre-callback assertions already failed.

Deletions are tight: must start visible, must carry empty field lists, duplicate ids refuse, and absence is asserted on every later measured boundary. New-delete cannot excuse a row already hidden, because the pre-callback required-set uses only prior deletes. New rows are allowed but never fabricated as preimages; `v1`-born ids stay required forward via `older→forward` plus accumulated `current→before/after` checks. `v2`-native absence in `v1` remains permitted, so no false refusal there. Derived/expected forward drift has an explicit owner: declared `v1` fields in `ignore`, everything else value-checked; `v2`-callback writes are not silently ignored.
