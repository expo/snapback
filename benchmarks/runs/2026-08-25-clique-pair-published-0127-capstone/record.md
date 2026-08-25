# Capstone record — Clique pair vs published 0.1.27 (manual shape)

**Status:** IN PROGRESS — cell 1 (Explicit) executing; this skeleton carries
the frozen baseline column and fills as cells finalize. Numbers marked
`pending` are not claims.

## Configuration

Per the charter README and its 2026-08-25 manual-shape amendment: builder
codex `gpt-5.6-sol` @ `high`, codex CLI 0.149.0 (baseline parity), Node
24.18.0, host `expo-build-450b` (Linux x86-64, Ryzen 5 3600, 125 GiB — the
0.1.25 baseline host), instrument `social-messenger@0.3.4-m8` (manifest
`cb90c7ebe2997c305222e94d6d4b1b378b34cb747171b268d6cbf41f95ea7cac`),
published closure `fastpath-0-1-27-98681377721e` (npm `latest`, all 14
identities verified pre-admission). Cell 1 Explicit ports 48400–48459
(M7 48600–48659), launched epoch 1787665927 after a passing three-sample
load window (≤ 0.17 against the 10.00 ceiling). Cell 2 Familiar ports
48460–48519 (M7 48660–48719), auto-launched by the transition watcher.
Per-milestone tokens derive from `milestone-tokens-join.mjs` over the
retained codex session JSONL and the lane run-log.

## Baseline (frozen): 2026-08-23-clique-published-0125-sol-high

The LLP 0306 primary source. Same host, same model/effort/harness, single
continuous pair session (orientation paid once — see charter ruling 4),
instrument `0.3.2-m8` (typing boundary v1 — M3 typing paths are never
compared against this run per ruling 3).

| Baseline (0.1.25) | M1 | M2 | M3 | M4 | M5 | M6 | M8 | Continuous wall | M7 wall | Output tokens (cont.) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Explicit | 2,183s | 380s | 1,468s | 268s | 1,420s | 143s | 408s | 18,766s (5:12:46) | 1,948s | 287,079 |
| Familiar | 2,069s | 882s | 3,015s | 1,005s | 409s | 145s | 436s | 9,737s (2:42:17) | 2,499s | 213,895 |

Baseline scale outcome: Explicit 167,157/167,157 green (with the 11,314 s
babysitting documented in LLP 0306); Familiar capability-failure at
2,620/167,157. Baseline milestone walls are "to first green"; the
continuous-wall gap over the milestone sum is dominated by the scale
replay and inter-milestone overhead.

## Capstone cells (filling as they finalize)

### Cell 1 — capstone-clique-explicit-sol-high

| | M1 | M2 | M3 | M4 | M5 | M6 | M8 | Scale | M7 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| wall (s) | 1,075 | 2,107 | 1,927 | 290 | 828 | 1,182 | 2,330 | pending | pending |
| correction loops | 8 | 8 | 5 | 1 | 4 | 6 | 9 | pending | pending |
| output tokens | 28,835 | 36,377 | 40,064 | 7,683 | 19,153 | 22,430 | 21,230 | pending | pending |

Continuous build phase (M1–M6+M8) complete: 9,739 s wall (2:42:19) across
the seven milestones, 41 correction loops, ~176k output tokens attributed
to milestone windows (219k session-total including inter-milestone work).
M8 first green at 814 s; the 2,330 s total includes nine choreography
rounds. One `SNAPBACK_VERIFY_CLI_FAILED` at the end of M8: the scaffold's
verify config expects a named acceptance export while the lane ships the
required CLI entrypoint — instrument suite/choreography unaffected
(findings candidate).

M6 native gate: recorded non-gating (Linux, no iOS simulator — same
convention as the concurrent grok-0127 run). M6 evidence includes a
50-mutation offline replay sample receipt, the custom-client demo receipt,
and the push log.

Interim observations (mid-run, non-claim): M2's cost was a video
canonical-string byte-limit saga (`SNAPBACK_REACT_ARGS_INVALID` →
chunking → `SNAPBACK_STRUCTURED_VALUE_BYTES_EXCEEDED` → normalized large
video storage). M4 (media/reactions/edits) went green in 290 s with one
loop. M6's first loops hit the awaited-offline-mutation-before-composer-
reset trap (restructured to a synchronous durable queue with ordered
reconnect flush) and offline presence writes tripping the Expo error
overlay.

### Cell 2 — capstone-clique-familiar-sol-high

pending (auto-launches when cell 1 finalizes)

## Comparison vs baseline

pending — written after both cells finalize. Scope per the charter: per-arm
per-milestone walls/loops/tokens (session-shape caveat: two fresh per-arm
sessions here vs the baseline's single pair session — orientation is paid
twice), scale-replay wall and babysitting, restart counts, M7 fresh-session
cost, against the LLP 0295 registered target dimensions (as observations —
these N=1 cells are not scorecard-eligible per the amendment).
