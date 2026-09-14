# Ceremony bar result

Built one Quarry backend in `snapback/schema.q` and a headless Node client. Quarry computes all five answers: insights and UTC date buckets, live trending, durable digest snapshots emitted as real effects, current-member receipt state, and grouped word-prefix search. Node generates seed inputs, transports requests, asserts results, and records and settles claimed effects.

Proofs passed:
- `npx snapback4 check`: no problems. One informational `N_NO_CURSOR` note on bounded search.
- `npm run seed`: installed the specified eight profiles, forty posts, sixty messages, three chats, memberships, follows and likes solely through application HTTP mutations.
- `npm run acceptance`: passed in a fresh project copy using a persistent store, including CLI digest runs, restart deduplication, following periods, service-token claims and settlement, and the actual scheduled boundary at **2026-09-14 17:26:00 UTC**. Positive probes cover dynamic likes/ranking, messages/search, per-message unread changes, recipient monotonicity, membership removal, no-recipient read state, and an active user's zero-count digest. Unauthorized operations and duplicate/self-likes are refused. All successful query envelopes and nested pages checked complete.
- `run-log.md` records schema accounting: `digestDeliveries` conservatively counted as a work table; no per-principal counter tables or auxiliary operations. Public per-post counts derive from public likes.

The successful diagnostic copy is `.acceptance/run-2ZKGNL`. Its `deliveries.jsonl` records every claimed emission without worker deduplication; `settled-effects.json` records the real settled effect listing. Server logs are retained there. Every acceptance server is launched with a retained child handle and PID and closed in `finally`; shutdown targets only its owned process group.

## Wall clock

Started at Unix **1789406410**. Completed proof evaluation at **1789406766**, about **5 minutes 56 seconds**.

| Milestone | Elapsed from start | Interval |
| --- | ---: | ---: |
| Public documentation, schema, check and generated types | 1m 42s | 1m 42s |
| Seed and acceptance implementation; first execution | 4m 16s | 2m 34s |
| Harness correction and successful baseline | 4m 54s | 38s |
| Durable digest restart/next-period proof recorded | 5m 17s | 23s |
| Actual schedule plus mutation/receipt proofs | 5m 56s | 39s |

## Correction loops

1. **agent-error** — `npm run acceptance` failed because `runPeriod(start, end)` shadowed the server's `start()` function. Renamed its arguments to `periodStart` and `periodEnd`, then reran the complete acceptance successfully. No package defects or documentation gaps were observed.

## Candid gaps

The app intentionally uses bounded pages for this small seed: 100 memberships/roster/search matches and 200 social/chat rows per scan. It is not an unbounded analytics service; larger datasets need pagination or additional maintained aggregates. Search's no-cursor note reflects that limit. Package ceilings were not raised.

The effect performer is a durable local delivery-record sink, not an email or push-provider integration. It uses the actual service-authenticated effect claim and settlement protocol and does not suppress duplicate emissions. The runner's independent verifier has not been run by this implementation session.
