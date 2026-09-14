# Ceremony backend report

Built a Quarry backend on the exact public npm pin snapback4@0.2.8, plus headless Node HTTP seed and acceptance scripts. All five answers, including sorting, grouping, UTC buckets and unread/receipt reductions, execute in Quarry. No other backend, native code, package implementation inspection or agents were used.

## Proof

- `npx snapback4 check`: no problems; one informational N_NO_CURSOR note for bounded search.
- `npm run seed`: installs the specified eight profiles, forty posts, sixty messages, three chats, memberships, follows and likes through authorized HTTP mutations. Requires SNAPBACK_URL and exits on failed writes.
- `npm run acceptance`: passed in a fresh project copy with a persistent store. Fixed values, search terms and ordering, authorization refusals, changing likes, explicit clocks, delivered/read transitions, monotonic acknowledgements, message-level unread counts, membership removal and zero-count active digests passed.
- Service-token worker claimed, recorded and settled real digest effects. Re-running a period after server restart emitted none; subsequent periods emitted three. An actual scheduled boundary at epoch milliseconds 1789362840000 emitted the expected snapshots. No worker deduplication is used.
- Schema classification is recorded in run-log.md: digestPeriods is conservatively counted as one durable job coordination/work table; no per-principal counter tables or auxiliary operations.

## Wall clock

| Milestone | Elapsed from start |
| --- | ---: |
| Start | 0 s |
| First schema check | 110 s |
| Schema green and seed/client implementation start | 191 s |
| Acceptance fresh server started | 300 s |
| Actual scheduled boundary and acceptance assertions green | 350 s |
| Final record | 441 s |

## Correction loops

1. **agent-error** — check refused equality between an optional projected acknowledgement and a nonoptional object. Replaced it with an explicit message/principal/state existence index.
2. **agent-error** — check diagnosed that a membership rule mixing principal and chat predicates could never certify the receipt roster complete. Added private inverse membership facts in chatLinks and used scope-specific read rules. The complete-read assertions passed.
3. **agent-error** — final-report writer had invalid JavaScript template escaping. Replaced the writer with a Python literal; application and acceptance were unaffected.

No package defects were observed. Knowledge sources were the package README, guide cards, why E_TYPE/E_QUARRY_TYPE, generated api.ts, diagnostics and ordinary Node standard-library knowledge.

## Candid gaps and limits

No known missing requirement on the complete small seed. Reads are intentionally bounded for this small application; growth beyond page limits can report incomplete rather than silently promise complete answers. Search has no cursor in the required fixed contract, explaining the informational check note. Tables are online-only. The worker's concrete effect is a durable local delivery record, settled over the real effects API; no external mail/push provider was requested or configured.

Acceptance evidence is retained in .acceptance-BVy57p/: server PIDs/logs, performed-effects.jsonl, settled-effects.json and acceptance-green.json. Every server launched by acceptance is owned by its child handle/PID and terminated in finally. Repeated acceptance creates another isolated copy and chooses a free port above 49500.
