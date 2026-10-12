# Integration 5 independent review, round 2 — muse

Reviewer: muse-spark-1.3-contributor; reasoning effort high.
Received: 2026-10-12T17:27:40.069883+00:00.
Scope: committed merge 4a011e26b56178e1c0b3abfdef7fcdae5fe12618; read-only fresh session, mutually blind.
Invocation: `~/sb4-loop/muse-exec.sh --yolo --model muse-spark-1.3-contributor --reasoning-effort high --prompt-file /tmp/sb4-integration5-review-r2.txt`.
The response below is preserved verbatim; no author acceptance is inferred.

## Verbatim response

muse: workspace root: /home/ccheever/projects/snapback-sb4loop (cwd default)
muse: workspace trust: trusted source=run-flag
READY — no material correctness gaps in the merged tree.

What I verified, by focus area:

- CUT prepaid uniform-prefix charges ([cut.rs](snapback4/crates/snapback4-device/tests/cut.rs)): `group_meter` logic untouched, only the `@ref` renumbered 20.24.6→20.24.7; `scan_authorized_prepaid`'s `rule_prepaid` path intact. Device envelope edits in `call.rs`, `delivery.rs`, `media.rs`, `search.rs` build `Json::Array` of `Json::String` directly — wire-identical JSON, no new serde families.
- Interrupted-predicate retry: `prefix_witness.rs` extends (not weakens) coverage with a third expired-backlog world; `page-cut.test.mjs` intact.
- Live-at-clock metering: all five page-candidate paths (`authorized_candidate`, per-candidate scan, `live_store_scan`, `live_aggregate_inner`, maintained backlog) step over expired rows via `step_expired` before any public charge, with walk refund. The merged `live_store_scan` ([authorized_point.rs:167](snapback4/crates/snapback4-core/src/engine/authorized_point.rs:167)) opens the authored range exactly once and prices only live entries through `scan_value_entry` — the review-extension rewrite resolves the double-open the lane commit had.
- Unproved-insert refusals including final output pricing: `predict` in [local.rs:150](snapback4/crates/snapback4-core/src/engine/local.rs:150) and the `charge_output` path at [local.rs:172](snapback4/crates/snapback4-core/src/engine/local.rs:172) both defer to `E_PREDICT`, while `E_PREDICT` and store failures keep their messages per §20.5. `write.rs` proof gating (minted/plain/upsert-arm/timeline exclusions, missing-fact restore) matches the spec text.
- Census strictness: `wasm-codec-census.mjs` loses one exemption, gains none; `json_codec::to_writer` is the same instantiation. Budget 680692 = 680192 measured + 500, recorded in the budget `why` tail, commit message, and journal.
- Nightly difftest: measured rounds use contiguous seeds, break under 256 cases, cap at 8 rounds, keep round-0 layout, and the ticket filer scans `round-*/`; its own test pins seed contiguity.
- Regressions added cover every focus claim, including `system_expiry_scan_prices_only_the_authored_range_and_live_entries` (both directions, interleaved expired keys, heap cut boundaries) and the output-pricing refusal test.

Inherited issues outside scope, both openly ticketed rather than hidden: witness rule probes still spend the authorization walk on expired rows, and `check --cost` backlog wording names the meter bound. Uncommitted root-guide files were ignored as instructed; no tests were executed, only inspection.
