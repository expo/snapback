# Independent integration verification

Codex ran these checks in a separate, clean detached worktree at
`877bcaaa2` on the local MacBook Air (10 logical CPUs, 32 GiB RAM).
The implementation and review were performed by separate Astra max sessions.
Logs here are losslessly compressed original command output, including failures.

## Modeling

- `cargo build -p snapback4` passed, producing the CLI required by the language
  integration tests. The first language run stopped on that missing prerequisite;
  `modeling-lang-877bcaaa2.log.gz` retains it.
- `cargo test -p snapback4-lang --no-fail-fast` then completed all targets:
  430 passed, 4 failed, 4 ignored. Three failures were TypeScript tests missing
  installed Bun workspace dependencies in this clean checkout. After
  `bun install --frozen-lockfile`, the full `frontend_regressions` and `routes`
  targets passed (40 + 9 tests). The fourth was the existing maintained-score
  recipe test expecting two mutations instead of the newly documented three.
  Astra corrected that expectation and asserted removal filtering in `8c4ae4b59`;
  the full `maintains` target passed 14/14 in the clean verifier at that
  commit (`modeling-maintains-8c4ae4b59.log.gz`).
- This is a cumulative test result, not a claim that the original full-suite
  command was green. No unrelated red test was silently omitted.

## Separate follow-graph scenario

On the same clean `877bcaaa2` checkout,
`cargo test -p snapback4 --test timeline --test feed_bridge --no-fail-fast -- --nocapture --test-threads=1`
passed 54 timeline tests and 12 feed-bridge tests, with one explicitly ignored
latency measurement. These exercise registration and edge bounds, sized
registration at 1008/1009, backfill bounds of 200/865, a 5921-edge cap with atomic
rollback, and purging over 1001 timeline copies. These are the existing fixture's
particular bounds, not general engine capacity promises.

The ignored `latency::following_and_posting_latency_envelope` was then explicitly
run alone and passed. The unchanged probe takes 3 warmups plus 20 measured
observations per series and reports nearest-rank p95 (rank 19 of 20). It exercises
5-follow and 500-follow readers and a 901-follower hub. The declared timeline's
reader p95 values were 0.2304, 0.1588 and 0.2855 ms; ordinary and hub posting were
0.4652 and 0.1390 ms. See the original log for both recipe and declared-timeline
work charges and output equality assertions.

These are descriptive server measurements on a shared host. The existing probe
runs recipe then declared timeline, not alternating arms, and there was no
production timeline change in this follow-up. Therefore it is not a causal
performance comparison. The reported cold rows/JSON bytes (3376–3377 rows,
roughly 701 KB for the declared fixture) are server snapshot serialization,
not browser rendering, network acquisition, or native lifecycle measurements.
`timeline-host-877bcaaa2.json` records host and before/after load. No build from
this run overlapped the latency test on this machine; other host activity was
uncontrolled.

## Final code checkpoint

At clean `4fb105d29`, the final code checkpoint (reports/status edits followed):

- Modeling: guide 55, lookup selection 4, attribution 2, maintains 14 — all pass.
- Simulator digest: 12 pass, including the strengthened exact 1001-membership
  cap refusal and unchanged effects/markers.
- Store allocation regressions (`word_heap`): 11 pass; its ignored projection
  experiment was then run explicitly and passed (41 AB/BA pairs). This second
  run reproduced the allocation conclusion, not a qualified production path.
- `ref-check`: 503 docs, 9205 references, zero errors/unchecked.
- `caps`: failed on the pre-existing 67/59 current documents and legacy
  `snapback-agent-safe-paired.rs` at 1504 lines (205 oversized files against204).
  No touched source exceeds1500 lines; no ceiling was raised.
- `git diff --check` passed and the verification checkout remained clean.

The core/runtime store and ceilings are unchanged by the scale experiment.
No native lifecycle, client acquisition, publication, or fresh Clique score is
claimed. The stopped full delivered-app matrix remains unmet; see the scale
report and its retained failed fixture/logs.

The unchanged `digest_count` control target also passed (all ten workload
combinations). Its 10,000-message, 6-byte-body, 2-recipient case returned
`Int(10000)` at 13,330,013 metered heap bytes; the 5,000-candidate recipient-heavy
case remained incomplete. Exact output is in `final-digest-count-4fb105d29.log.gz`.
These are particular stored row shapes, not a universal message capacity.
