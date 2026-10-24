muse: workspace root: /home/ccheever/projects/sb4-b27-rel (cwd default)
muse: workspace trust: trusted source=run-flag
agent loop failed: model failed: API error 429 [request_id=77ede48d-5cc8-4c26-a854-89b06605f8b8]: Subscription quota exhausted. Your usage window resets at 2026-10-26T00:00:00Z. (rate_limit_error)
[muse-exec] plan quota exhausted; retrying with the Meta API key
muse: workspace root: /home/ccheever/projects/sb4-b27-rel (cwd default)
muse: workspace trust: trusted source=run-flag
READY

Freeze-only placement exclusion is sound. `insert`/`InsertIfAbsent` cannot replace an existing value, so excluding them from the freeze direct-write scan cannot admit a freeze violation.

Supplied `exact_write_authority` matches the amendment:

* write-audience scan still covers `insert`/`update`/`upsert` with defaults and insert-null exemption intact.
* freeze scan requires `update`/`upsert` + `writes_column(...,false,...)`, so insert defaults/placement stay excluded and dynamic/non-fixed patches stay conservative via `object.is_none_or`.
* implicit transitive `set-null`, native with unknown write set, and engine-owned/maintained/sequence writers retain unconditional refusal for both `column_writes` and `frozen_columns`.
* `Immutable{fields}` prior exemption, `Deny` no-freeze, meaning-based `Policies::rule`, stable-viewer/literal `leading_guard` only for write-audience, disjoint/reachable-effect and lifetime/expiry/recorded refusals preserved.
* caller checks historical target against active and latest ordinary sources; equal-source path still gates before reuse/collapse.
