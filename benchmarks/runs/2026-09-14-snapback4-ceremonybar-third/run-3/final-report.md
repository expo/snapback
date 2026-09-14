# Ceremony backend result

Built all five shapes in `snapback/schema.q` using exactly `snapback4@0.2.10`: lifetime insights with seven UTC buckets, live top-ten trending, durable scheduled digest effects, current-membership receipt aggregation, and grouped word-prefix search. Nine tables hold domain data and the digest emission ledger; no maintains, per-principal counter tables, native code, backend alternatives, or auxiliary operations were needed.

`npm run seed` installs the exact fixed dataset through authorized HTTP mutations using `SNAPBACK_URL`. `npm run acceptance` creates an isolated directory inside the project, keeps a persistent store across owned server restarts, and stops its server process group in `finally`. The Node client only transports, seeds, asserts, and delivers effects to an append-only JSONL sink.

All four proofs passed. `npx snapback4 check` reports no problems. Acceptance verified the fixed answers, changed clocks, authorization refusals, duplicate/self-like rejection, changing rankings, every specified receipt transition, receipt monotonicity, single-message unread changes, membership-sensitive search and digest, new messages, zero-unread active-user effects, and a no-recipient receipt. A ceremony service token claimed and settled real effects. Repeating a period across restart produced no extra emission, the next period emitted again, and the actual scheduled boundary at **2026-09-14 11:38:00 UTC** emitted the three expected digests.

## Wall clock

| Milestone | Time from start |
| --- | ---: |
| Start, 11:32:10 UTC | 0 s |
| Documentation and initial schema check green | 192 s |
| First acceptance found harness error; fixed | 315 s |
| Fresh seed and initial query/authority checks green | 317 s |
| Restart deduplication and next-period effects green | 320 s |
| Actual scheduled boundary observed | 351 s |
| Full acceptance green | 354 s |
| Final record | approximately 370 s |

## Correction loops

1. **agent-error** — `npm run acceptance` failed because the job helper's `start` parameter shadowed the server-start function. Renamed the parameters to `periodStart` and `periodEnd` and reran acceptance in another empty isolated copy. The fresh run passed. No package defects were encountered.

## Gaps and limits

- Reads use finite pages of 100, suitable for the requested complete small seed and exercised changes. This is not an unbounded-data scaling implementation. The compiler emits one informational `N_NO_CURSOR` note for search; all tested query envelopes and nested pages report complete.
- Effect delivery is a real wire worker writing an observable local JSONL sink, not an external email or push provider.
- The first acceptance attempt failed in the harness; the subsequent fresh acceptance passed. Independent runner probes have not been run by this implementation session.
- Some milestone entries in `run-log.md` were recorded after observation; precise successful-run timestamps are preserved in the acceptance log.

Evidence: `.acceptance-0FBfOT/acceptance.log`, `proof.json`, `delivered-effects.jsonl`, and `server.log`. The earlier failed isolated copy is also retained for diagnosis. No owned backend remains running.
