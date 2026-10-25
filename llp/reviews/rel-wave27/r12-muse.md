muse: workspace root: /home/ccheever/projects/sb4-b27-rel (cwd default)
muse: workspace trust: trusted source=run-flag
agent loop failed: model failed: API error 429 [request_id=32002dff-17e3-4e61-96a7-ba1debabf8e3]: Subscription quota exhausted. Your usage window resets at 2026-10-26T00:00:00Z. (rate_limit_error)
[muse-exec] plan quota exhausted; retrying with the Meta API key
muse: workspace root: /home/ccheever/projects/sb4-b27-rel (cwd default)
muse: workspace trust: trusted source=run-flag
READY

No MATERIAL masking, resurrection, or false-refusal defect in the new deletion contract.

Recipe enforces the stated order:

* pre-callback `beforeV1Writes` snapshot + immediate `compareMoves(current,beforeV1Writes,old non-deleted)` fails before any declaration can excuse a rollback-hidden row.
* new deletes require `beforeV1Writes.has(id)` and `!older.has(id)` with `fields:[]`, so hidden rows cannot be declared and deletes must take effect.
* cumulative `deletedByV1` asserted `!beforeV1Writes.has` before later callbacks, so rollback resurrection cannot be concealed by deleting again — the pre-check already failed.
* cumulative `!older.has` after callback and `!forward.has` on forward preserve absence.
* `Set` uniqueness + shape `deleted=>fields.length==0` refuses duplicate/ambiguous declarations.
* forward `compareMoves(current,forward,required current non-deleted,ignore changedByV1,values:true)` + `compareMoves(older,forward)` keep untouched ids/other fields checked while allowing declared fields and new v1 rows.

Amendment text matches implementation: visible-before, absent-after, absent-forward and before/after later v1s, no excuse for rollback-hidden rows, empty-field deletes, storage-conservation only with business assertions owned by callbacks.
