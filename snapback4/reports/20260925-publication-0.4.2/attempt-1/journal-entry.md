

## 2026-09-25 — 0.4.2 publication attempt 1 stopped at the published-0.2.33 fences

Publication lane on the black M5 Max, requested base `05382d59f`, worktree
`~/projects/snapback-pub-042`, local branch `sb4-intent/publish-042`.
Version commit `f49c22f58625a85b17c6e40146adefe6bcd6b5c2` aligns the same six files
as 0.4.1 at 0.4.2, including Expo and the optional platform dependency.
Both frozen installs passed; no dependency change. One full suite ran with
`SNAPBACK4_FENCE_PUBLISHED=/Users/ccheever/sb4-03-lanes/published-0.2.33`:
**`== 1 failure(s) in 2341 s`**, exit 1. The wrapper's separate monotonic
measurement was 2,265.082 s; both timings are retained without attributing
why they differ.

The client stage had three failures: published-0.2.33 `timeline-v2`,
`recorded-attribution`, and `maintained-column`. Each failed the deep-equal
comparison at `schema-capabilities.test.mjs:202:64`: current native query
replies carry `speculative: false`, while the published expected reply omits
that field. This is the current-open/query comparison, before the later
future-capability adoption request. No fix or test relaxation was attempted.
The capability-free bytes/store compatibility control passed.

Rust: 3,212 passed, zero failed, 19 existing ignores. Ordinary clients:
1,970 passed, three failed, zero cancelled, five existing skips. All 78 model
tests passed at 5,000 / 5,000 / 3,000 sequences, and the old seed-11 publication
regression passed. Fixture tests: 9/9. Workspace/WASM/package builds, typechecks,
docs budget and release guard passed. WASM: 1,850,804 B raw / 521,627 B gzip,
under the unchanged 522,000 B ceiling. The default scheduler selected serial
client files at load 49.33 on 18 CPUs.

Stopped the release at this gate and allowed only the already-running
report-all-failures suite to finish. No retry, isolated rerun, assertion,
model-count, timeout, skip/ignore, budget, keychain or credential change.
No xcframework rebuild, Release app build, native witness, publisher dry run
or resume, Expo pack/publication, registry verification or push occurred.
Production-binary digest, staged/registry integrities and native witness
hashes/timings are therefore absent, not qualified. The unchanged launchd
signing relay was read and hashed but never invoked. npm identity: `ccheever`.

The version commit is local. Reports and this append remain uncommitted;
the suite-generated following fixture lock version change is retained and
captured as a patch in the report directory. Complete errors, every command
attempt, timing and source evidence:
[publication stop report](reports/20260925-publication-0.4.2/REPORT.md).
The supervisor owns disposition of the comparisons and any next attempt.
