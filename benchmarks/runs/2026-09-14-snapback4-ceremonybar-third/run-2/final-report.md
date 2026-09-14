# Final report

Built one Quarry backend in `snapback/schema.q` and a headless Node HTTP client, seed command and acceptance harness. Quarry computes all aggregation, ordering, UTC date buckets, receipt state, unread snapshots and search groups. Uses only the installed exact `snapback4@0.2.10` pin.

Proofs passed:
- `npx snapback4 check`: no problems, 10 tables, 14 operations.
- `npm run seed`: installs the specified domain data using application HTTP mutations; failed writes terminate it.
- `npm run acceptance`: passed in `.acceptance/run-NxAcao`; exact initial answers, clock shifts, changed likes and messages, authority refusals, receipt transitions, membership changes, zero-recipient receipt and zero-count digest effects.
- A service-token worker claimed real effects over HTTP, wrote each payload to a local delivery sink and settled each effect. Identical manual periods across restarts emitted no duplicates; following periods emitted again. The actual scheduled boundary at Unix milliseconds 1789385280000 fired and produced the expected three effects.
- `run-log.md` includes the required schema-shape record and counter visibility explanation.

The persistent acceptance store, server logs, owned child PIDs, delivered effect records and `proof.json` remain in the acceptance copy for diagnosis. Each server child is closed in `finally`. Acceptance creates a unique fresh project copy inside the current directory on every invocation.

## Wall clock

| Milestone | Seconds from start |
| --- | ---: |
| Documentation and schema check green | 97 |
| Seed, initial queries and authority checks green | 268 |
| Full acceptance including actual scheduled boundary green | 347 |
| Record complete | 386 |

Total wall clock: 386 seconds.

## Correction loops

1. **agent-error**: the initial timestamp command wrote `/tmp/ceremony-time-unused` outside the requested directory before the run log was created. Subsequent task files and acceptance copies stayed inside the current directory. This was a scope violation, not a package issue.
2. **agent-error**: first `npm run acceptance` failed because a `runPeriod` parameter named `start` shadowed the server-start function. Renamed the parameters and reran the full harness in a fresh copy successfully. The failed copy is retained.

No observed package defects or documentation gaps blocked the implementation. No package implementation files, prior implementations, other repositories or other agents were consulted.

## Candid gaps

- The initial out-of-directory timestamp write remains a process-compliance gap.
- Reads use finite pages sized above this complete small seed; the app does not promise exact aggregate results for arbitrarily larger datasets. Package ceilings are unchanged.
- Digest delivery is a durable local JSONL sink behind the real effect protocol, not an external email or push provider.
- No UI, native code, alternative backend or client-side application-answer computation is included.
