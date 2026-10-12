# Integration 5 independent review, round 1 — muse

Reviewer: muse-spark-1.3-contributor; reasoning effort high.
Received: 2026-10-12T17:12:20.318024+00:00.
Scope: uncommitted merge of c5a3095e70 into e82bb70b97; read-only fresh session, mutually blind.
Invocation: `~/sb4-loop/muse-exec.sh --yolo --model muse-spark-1.3-contributor --reasoning-effort high --prompt-file /tmp/sb4-integration5-review.txt`.
The response below is preserved verbatim; no author acceptance is inferred.

## Verbatim response

muse: workspace root: /home/ccheever/projects/snapback-sb4loop (cwd default)
muse: workspace trust: trusted source=run-flag
Verdict: **NEEDS_CHANGES** — the engine merge is semantically sound, but the pending commit omits 8 worktree files and the wasm-budget bump has no provenance.

Blocking, all in the staged-vs-worktree gap (`git diff --cached` vs `git diff`):

- [wasm-codec-census.mjs]( /home/ccheever/projects/snapback-sb4loop/snapback4/packages/snapback4/test/wasm-codec-census.mjs): staged keeps the `streamingAllow` exception for `stored_value_bytes` calling `serde_json::to_writer`, but staged [word_heap.rs]( /home/ccheever/projects/snapback-sb4loop/snapback4/crates/snapback4-core/src/engine/word_heap.rs) routes through `json_codec::to_writer`. The census requires each exception be consumed exactly once, so the staged tree fails it. The worktree deletion fixes this but is unstaged.
- Six stale section refs in the staged commit: LLP 3000.007 now numbers prepaid-uniform as §20.24.7, yet staged still cites §20.24.6 for it in `engine/read.rs:172`, `device/tests/cut.rs:78`, `device/tests/readauth/timing.rs:146`, `device/tests/w13g_review/mod.rs:131`, `test/page-cut.test.mjs:2`, and `llp/3000.036.001` (3 spots). Worktree has the correct numbers, unstaged. (`./ref-check` passes on the worktree, confirming the staged index is what is inconsistent.)
- [wasm-budget.json]( /home/ccheever/projects/snapback-sb4loop/snapback4/metrics/wasm-budget.json): staged keeps 679918; the worktree's 680412 cites no measurement, adds no `why` reason, and has no journal entry (the values 680412/679912 appear nowhere else). The ratchet rule needs measured value plus reason in the file, commit message, and journal. I ran no builds and claim no coverage.

Verified intact: both LLP resolutions and both journal sides; `step_expired`, `live_store_scan` (cursor/re-fetch logic traced correct), and the unproved-insert refusal path; prepaid uniform-prefix charges, interrupted-predicate retry, codec funnel plus Lean strictness; difftest nightly changes with the two EX follow-ups honestly left open; no conflict markers. I can expand on any finding.
