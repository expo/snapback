# Run record — Clique local-main 0.1.25 GPT-5.6 Sol high

**Status: CALIBRATION — unpublished current-source evidence, not
claim-eligible.** Both requested profiles completed M1–M3 green.

## Results

| Lane | Outcome | Wall | Output tokens | Correction/retry events |
|---|---|---:|---:|---:|
| sol-high-clique-explicit | M1–M3 green | 3,485s (58:05) | 109,672 | 20 correction loops (+1 environment `runtime-qualify --persist` retry before final `prove`) |
| sol-high-clique-familiar | M1–M3 green | 5,129s (1:25:29) | 116,136 | 18 correction loops |

Raw Codex usage (`--json` cumulative turn usage):

| Lane | Input tokens (cumulative) | Cached input | Output | Reasoning output |
|---|---:|---:|---:|---:|
| Explicit | 31,188,224 | 30,623,488 | 109,672 | 26,564 |
| Familiar | 41,271,185 | 40,422,400 | 116,136 | 30,786 |

## Milestone wall to first green

| Lane | M1 | M2 | M3 |
|---|---:|---:|---:|
| Explicit | 1,971s | 471s | 603s |
| Familiar | 1,588s | 2,074s | 943s |

Both lanes passed every suite-required assertion (M1 7, M2 22, M3 7), every
implemented required two-client choreography check, and the optional quote
check. Instrument-declared optional skips were preserved as skips (Explicit:
M2 media-compose ×2, M3 semantic/lifecycle ×4; Familiar: same families). No
lane relabeled a skip as a pass. Both lanes' registered `snapback verify`
receipts passed with honestly-partial read/write provenance.

## Directional comparison against the 2026-08-20 local-main run

Same instrument, same model/effort, different source revision
(`708e2e5c` → `9a303623`) and a cleaner delivery path (sealed candidate-tarball
runtime instead of a raw debug binary). N=1 per lane; deltas are observations,
not regressions or claims.

| Metric | 2026-08-20 | This run | Δ |
|---|---:|---:|---:|
| Explicit wall | 4,055s | 3,485s | −14% |
| Familiar wall | 6,108s | 5,129s | −16% |
| Explicit output tokens | 123,561 | 109,672 | −11% |
| Familiar output tokens | 151,212 | 116,136 | −23% |
| Familiar correction events | 46 | 18 | −61% |
| Explicit correction events | 18 (+4) | 20 | ~flat |

## Status of the 0820 findings

1. **Familiar live-subscription contention — fixed in this sample.** Zero
   `SNAPBACK_OUTBOX_AUTHORIZATION_SUSPENDED` events, no >15s projections, and
   no cross-client disagreement in either lane. The six-subscription repro
   from `issues/20260820-familiar-live-subscription-contention.md` did not
   recur without a minimized reproducer having landed; treat as encouraging,
   not closed.
2. **Write-posture migration noise — fixed.** Zero
   `SNAPBACK_TABLE_WRITE_POSTURE_MIGRATION_PENDING` advisories in either lane
   (0820: 19 and 17). Final generation summaries were readable.
3. **Familiar Guide/code drift — mostly resolved, one residue.** No nullable
   point-query or membership `resourceField: "_id"` refusals this time. One
   new residue: the served Guide's scalar live-query example was refused by
   the 0.1.25 codegen
   (`SNAPBACK_HANDLER_RESULT_CONTRACT_INVALID`, Familiar, snapback-attributed)
   — see `issues/20260820-guide-gap-familiar-handler-dialect.md`.
4. **Fixed-origin Expo dev path — still the top recurring cost.** The
   supervisor hardcodes bootstrap/Metro auxiliary ports outside any lane range
   (`SNAPBACK_EXPO_LISTENER_ENUMERATION_INCOMPLETE`; one structured excursion
   to forbidden port 54050 before refusing), forcing both lanes onto a split
   backend + separate Expo server / direct first-party provider. Evidence
   added to the existing fixed-origin dev-lifecycle ticket.
5. **Declared refusal fidelity — new finding.** Authored domain refusal codes
   (`DUPLICATE_HANDLE`, membership denial) collapse to generic
   `SNAPBACK_APP_REFUSAL` / `SNAPBACK_HANDLER_FAILED` at the headless client;
   each collapse cost an acceptance correction loop. Filed as
   `issues/20260822-declared-refusal-client-code-preservation.md`.
6. **Guide-vs-codegen index fact drift — new finding.** The Guide describes an
   index option the codegen rejects (`CODEGEN_MODULE_EVALUATION_FAILED:
   index-options-unknown-field`, Explicit, snapback-attributed). Filed as
   `issues/closed/20260822-guide-derived-where-applicable-index-fact.md`.
7. **Consumer skill body exceeds LLP 0259's ceiling — staging finding.**
   Filed as
   `issues/20260822-consumer-skill-body-exceeds-0259-ceiling.md`; lanes
   received a disclosed minimal trim.
8. **Debug-binary bloat — moot for consumers.** Lanes consumed the sealed
   clean-release public-package runtime from the candidate tarball; no
   `SNAPBACK_RUNTIME_BINARY` override and no debug binary anywhere in the
   consumer path.

Auth custody sharp edges (0820 #4) shrank to one recorded
`storagePartition` discovery loop; no fixture-identity/`clientMutationId`
reuse problem appeared.

## Context and caveats

- **Ambient machine contention:** this machine concurrently hosted other
  agent sessions (including an unrelated Exact worktree pair at ultra effort)
  during both lanes. Wall-clock carries the same contamination caveat as the
  0817 matrix; one-minute loadavg samples are retained in the private run dir
  (`logs/loadavg.log`). Token counts are unaffected.
- A separate session's published-0.1.24 xhigh Clique run
  (`~/clique-run-20260822e`) aborted on a browser-control environment failure
  before any milestone green; it provides no comparison point today.
- Setup deviations are listed in [README](./README.md): the trimmed skill
  payload, the queued serial launch behind the aborted 0.1.24 run, and the
  loopback registry delivery.

## Interpretation

Current source is benchmark-completable in both profiles with materially less
friction than the 0820 sample: both profiles got faster and cheaper, and the
Familiar lane specifically cut its correction volume by roughly two-thirds.
The hard realtime paths (live feeds, DM delivery, ephemeral typing) were green
in both lanes without the stability incident that dominated 0820's analysis.
The strongest remaining release feedback is unchanged in kind: keep the
Expo/dev-supervisor port story inside a declared budget, preserve authored
refusal identity through the client envelope, and reconcile the last
Guide↔codegen example drifts. Explicit remained the more efficient profile in
this sample; Familiar's gap narrowed substantially.

## Evidence pointers

Raw lane directories, event streams, prompts, receipts, reports, essays, load
samples, and the trimmed/original skill bodies are retained outside git at
`/Users/ccheever/clique-main-20260821/`. Build experience is consolidated in
`diaries/0112-sol-high-clique-local-main-0125.diary.md`.
