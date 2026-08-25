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

#### Cell-1 scale replay episode (interim)

Attempt 1 (separate clock, epoch 1787676941): serial settlement via the
durable client-mutation path, push/digest disabled by the server-pinned
runtime flag. Failed closed at action 8,927/167,157 with
`SNAPBACK_CLIENT_MUTATION_RETENTION_FULL` — the builder's adapter submitted
durable ids without acknowledging consumed results, filling the
per-fingerprint ack-window retention (the LLP 0307.000 fail-closed
contract, landed this round). The coded diagnostic named the exact remedy
("acknowledge consumed results before submitting another durable id").
**Recovery: 10 minutes end to end** — diagnosis, adapter fix
(authority-bound settlement acknowledgement batches), fresh attempt-2
backend, starter base re-seeded green, replay resumed on a new attempt
clock (epoch 1787677553). Builder attribution: `agent-error` (honest — the
ack contract is documented).

Attempt 2 then failed closed at 24,777 on the 10% checkpoint probe: the O5
fixture caught real derived-state drift (`busyGroupMessageCount: 0` vs the
accumulated expectation) — a genuine app bug found by the checkpoint
contract, not a crash. After a ~35-minute diagnosis/fix loop the builder
resumed from the settled prefix on a continuation clock.

**Final outcome: SUCCEEDED — 167,157/167,157 applied, 0 failed**
(receipt `replay-scale.log-1787678763876.json`: pass=true, rawWallMs
10,085,127 ≈ 2:47:20 excluding 45 s of checkpoint probes; checkpoint
prefixes 24,777 → 88,057 → 167,157). The final continuous run was fully
unattended with zero failures. Total scale phase ≈ 3:18:28 wall INCLUDING
both fail-closed defect discoveries and their fixes — versus the 0.1.25
baseline's same 167,157-green outcome inside an 18,766 s continuous wall
with 11,314 s of live babysitting. The replay machinery itself (durable
mutations, batched acks, settled-prefix resume — this round's LLP 0307.000
surface semantics) required zero interventions once the adapter honored
the ack contract.

#### Cell-1 session completion and the M7 session-shape deviation

The continuous builder session ended at epoch 1787690682 (total ≈ 6:53
wall from launch): continuous M1–M6+M8 green, scale green, and — a
**protocol deviation** — the builder then ran M7 in-process (fresh backend
and fresh scaffold on the M7 ports, but the same codex context), despite
the prompt's fresh-session requirement. Its in-process M7 went green
(suite 6/6, live-tally + offline-vote choreography, exact pre/post
snapshot compare across 8 personas; self-scored B8 88/100, holistic
84/100) and is retained as evidence but is **non-scored**: LLP 0201's
fresh-session M7 exists to measure day-2 evolution WITHOUT builder
context. The scored M7 runs as a genuinely fresh codex session from the
sealed pre-M7 handoff (frozen before any M7 changes; SHA256SUMS-verified),
launched epoch 1787690822.

Cell-1 continuous-session harness totals (codex `token_count`, includes
the in-process M7 deviation work): input 156,153,275 (cached
154,165,504) · output 331,430 · reasoning 82,675. Baseline Explicit
continuous totals were input 175,559,887 (cached 173,759,488) · output
287,079 · reasoning 59,929 — but the baseline's continuous session did
NOT include M7 or the two scale-defect fix loops, so raw totals are not
shape-identical; the comparison section will use the per-milestone
attribution.

#### Cell-1 scored fresh-session M7 (GREEN)

Launched epoch 1787690822 as a genuinely fresh codex session (handoff-only
context, sealed pre-M7 package); exited 1787692435. **Wall 1,606 s (26:46),
first green 1,412 s (23:32).** Tokens: input 16,931,263 (cached
16,657,920) · output 58,355 · reasoning 17,700. All gates green: M1–M6/M8
regressions, M7 acceptance, frozen standalone M7 choreography (live +
offline idempotent voting — the E4-hardened paths), migration intactness
across all eight personas against the retained pre-migration export; all
recorded servers stopped. Candid gaps recorded by the agent: the original
handoff snapshot file was overwritten before an independent byte-compare
(the retained-export compare stands as the migration evidence), and
wall-clock-only message expiry does not autonomously decrement the
maintained counters while cron is disabled (product finding).
Baseline Explicit M7: first green 1,076 s, report wall 1,871 s, input
25,397,088 · output 61,649 — the capstone M7 was slower to first green,
faster to complete, and cheaper on both token axes.

### Cell 2 — capstone-clique-familiar-sol-high

launched 2026-08-25 (launcher: three-sample admission window, then detached
builder on ports 48460–48519 / M7 48660–48719); rows fill as milestones
green.

## Comparison vs baseline

pending — written after both cells finalize. Scope per the charter: per-arm
per-milestone walls/loops/tokens (session-shape caveat: two fresh per-arm
sessions here vs the baseline's single pair session — orientation is paid
twice), scale-replay wall and babysitting, restart counts, M7 fresh-session
cost, against the LLP 0295 registered target dimensions (as observations —
these N=1 cells are not scorecard-eligible per the amendment).
