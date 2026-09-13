# Clique full-run record — familiar vs explicit, all milestones

**Status: CALIBRATION — N=1 per lane, not claim-eligible for magnitude; existence
evidence only (LLP 0201 D5).** Both Snapback profiles reached web
authoring-green for M1–M6 and M8, plus M7 fresh-session and the scale replay,
on published Snapback **0.1.24** under the **0.3.2-m8** instrument. This is not
a full product-completion claim: Familiar's M8 digest recorded
`scheduleDriven: false`, and the grader that owns the autonomous-schedule
obligation was not invoked. Receipts are adjudicated below.

## Configuration

- **Model/harness:** `gpt-5.6-sol`, codex-cli 0.149.0, `xhigh` effort, unsandboxed
  (seatbelt SIGABRTs Playwright). Same family as the standing baseline pair.
- **Backend pin:** published npm `@expo/snapback-*` 0.1.24 for both lanes.
- **Instrument:** `social-messenger@0.3.2-m8`; manifest sha256
  `3438c84b8831239ab95e167eed79675a2127d7d63b3cb0f1ce72811872e2898e`.
- **Scale log:** derived, sha256 `b26bf1ae…b6abba9` (matches committed pin),
  167,157 actions.
- **Ports:** explicit 48100–48159, familiar 48160–48219, M7 explicit 48300–48359,
  M7 familiar 48360–48419. A separate concurrent reduced (M1–M3) lane by another
  session ran on 48000+ during the explicit build — recorded as a same-machine
  wall-contamination caveat (per the 2026-08-17 matrix-run convention).
- **Deviation:** `lane-setup.mjs setup` assumes `starter-<m>.log` per in-scope
  milestone; M4–M8 have no starter segments, so the generated
  `BENCHMARK-ORIENTATION.md` listed reduced scope while the prompt carried the
  full M1–M6+M8 scope (instrument-ticket material).

## Results

| Lane | Scope | Continuous wall | Output tokens | Holistic | snapback-defect events |
|---|---|---:|---:|---:|---:|
| **explicit** | M1–M6+M8 | 17,679s (4h55m) | 309.5k | 70 | 7 |
| **familiar** | M1–M6+M8 | 12,336s (3h26m) | 319.9k | 67 | 11 |

Raw Codex usage (cumulative; cached input is a subset of input):

| Lane | Input | Cached input | Output | Reasoning |
|---|---:|---:|---:|---:|
| explicit | 140,274,845 | 138,531,840 | 309,468 | 82,535 |
| familiar | 106,297,012 | 104,632,576 | 319,855 | 84,042 |

Familiar was faster in wall and used fewer input tokens; explicit was marginally
leaner in output tokens. Both manageable; N=1 so no magnitude claim.

## Milestone walls to green

| Lane | M1 | M2 | M3 | M4 | M5 | M6 | M8 |
|---|---:|---:|---:|---:|---:|---:|---:|
| explicit | 1,841s | 731s | 519s | 653s | 1,382s | 613s | 1,106s |
| familiar | 1,930s | 703s | 350s | 260s | 1,235s | 754s | 444s |

## Scale replay

Both green at 167,157/167,157 actions, settle-before-next, recorded clock,
zero-difference final reconciliation (counts + all named O5 fixtures).

| Lane | Attempts | Distinct failure modes before green |
|---|---:|---|
| explicit | 3 | retention-full (8,000), `%`-in-mutation-ID, 1024-row implicit limit, reaction-toggle non-idempotence, in-memory receipt overflow |
| familiar | 6 | 4GB OOM, RSS growth, session-throughput, retention-full (8,927), 1024-row implicit limit (audit), then green |

Both lane adapters reached bounded client-mutation retention because they did
not reclaim or acknowledge durable mutation IDs early enough. On the 0.1.24
pin, Familiar also could not use standalone `acknowledgeMutations` in sessions
mode and fell back to `clientMutationId: null`. Current `main` documents the
bounded replay contract and supports the sessions acknowledgement route, so
these remain historical pin observations rather than current defect claims.

## Adjudication (receipts, not self-report)

Every web-authoring green claim below was verified against retained receipts: each
lane's `receipts/<milestone>/acceptance.json` shows `pass: true` and each
`receipts/<milestone>/choreography.jsonl` shows a `segment-summary` with
`green: true`. Confirmed for explicit and familiar independently. The M7
acceptance passes (`suite pass: true`) and migration-intactness receipts
(explicit: `migration-intactness.json`; familiar: `migration-intactness-exact`)
are likewise receipt-backed. Choreography harness has no `m7` segment (segments
are `m1..m6,m8`), so M7 green is suite-only; both M7 reports state this and do
not mislabel it.

| Lane | Suite greens | Choreo greens | Replay | M7 |
|---|---|---|---|---|
| explicit | m1,m2,m3,m4,m5,m6,m8 pass:true | all green:true | 167,157 green | m7 suite pass:true, intact |
| familiar | m1,m2,m3,m4,m5,m6,m8 pass:true; M8 schedule obligation ungraded/absent | all green:true | 167,157 green | m7 suite pass:true, intact |

## Builder-experience self-scores (per-dimension; B8 is M7's, rest-of-run has no weighted total)

| Dim | explicit | familiar |
|---|---:|---:|
| B1 schema/data | 78 | 88 |
| B2 auth | 67 | 78 |
| B3 realtime | 92 | 65 |
| B4 offline/sync | 36 | 35 |
| B5 media/storage | 48 | 35 |
| B6 search | 58 | 42 |
| B7 push/actions | 78 | 32 |
| B8 day-2 (M7) | 82 | 94 |
| B9 DX/docs | 74 | 62 |
| B10 diagnostics | 79 | 74 |
| B11 operations | 60 | 67 |
| Holistic | 70 | 67 |

Both builders recorded per-dimension B-scores (not a weighted total), per the
brief's applicability rule. O-dimensions (grader-scored outcome) were **not
graded** in this N=1 calibration run; the instrument's grader prompt requires a
fresh session from the other model family, which was not invoked.

## Findings

1. **Bounded mutation retention reached by both adapters (historical pin).**
   `SNAPBACK_CLIENT_MUTATION_RETENTION_FULL` appeared at roughly 8,000 durable
   IDs when the adapters did not settle IDs early enough. Current routing is
   [Offline retention and mutation replay](../../../guide/sync/offline-and-retention.md#replay-and-settle-without-guessing).
2. **Standalone acknowledgement failed in sessions mode (historical pin).**
   The 0.1.24 client/route combination could not complete the standalone call;
   `acknowledgement-defect.json` retains the proof. Current `main` supports the
   auth-tagged sessions route, so no new open ticket is asserted here.
3. **Implicit handler ceiling reached by whole-table audits (expected bound).**
   Both adapters changed to paged keyset loops after
   `SNAPBACK_QUERY_IMPLICIT_LIMIT_REACHED`; the current Guide says to
   [bound every collection intentionally](../../../guide/backend/queries.md#bound-every-collection-intentionally).
4. **Familiar autonomous schedule absent (current profile boundary).**
   `scheduleDriven: false` means the grader-owned M8 obligation was not met or
   graded. Familiar deliberately routes cron work to Explicit; LLP 0295 OQ2
   owns any future advanced-primitive seam rather than a duplicate issue.
5. **Familiar served-guide/codegen mismatch reproduced a pre-fix state.** The
   0.1.24 pin predates the correction tracked and closed in
   `issues/closed/20260820-guide-gap-familiar-handler-dialect.md`.
6. **Orchestrator/tooling gap: lane-setup assumes a starter log per milestone.**
   M4–M8 have none, so the generated orientation listed reduced scope; full
   scope had to ride in the prompt. Filed as
   `issues/shelved/20260822-lane-setup-starter-assumption.md`.
7. **Handoff not self-contained (explicit M7).** The exported M7 handoff's
   replay scripts referenced fixture paths relative to the original lane root
   (`ENOENT .../handoff/instrument/...`), so the M7 fresh session first failed
   to re-seed. Filed as `issues/shelved/20260822-m7-handoff-not-self-contained.md`.

Native-artifact (iOS simulator) assertions for M6/M8 were attempted only through
the contract's prerequisite check and recorded `null/not-recorded` in both web
lanes — separately scored, non-gating per the instrument. Both reports are
honest about this.

## Raw materials

Lane dirs, event streams, receipts, prompts, and reports are retained outside
git at `/Users/ccheever/clique-full-20260822/` on the execution machine.
Build diaries: `diaries/0109-clique-full-explicit-vs-familiar.diary.md`.

## Current-main reconciliation — 2026-08-23

This record was captured against published 0.1.24. It preserves what those
lanes encountered; it does not reopen defects that current `main` has fixed,
documented as bounded behavior, or assigned to an existing LLP owner. Only
findings 6 and 7 remain newly filed from this run.
