# Ceremony bar result

Built a Quarry backend in `snapback/schema.q` and a headless Node seed, wire client, effect worker, and acceptance harness in `scripts/`. Uses the installed exact public npm pin `snapback4@0.2.8`. No other backend, native code, package implementation inspection, agents, fixtures, or direct store writes.

All four proofs passed:

- `npx snapback4 check`: no problems; one informational no-cursor note for the capped chat directory.
- `npm run seed`: installed the specified eight profiles, forty posts, likes/follows, three chats, memberships, and sixty messages through ordinary HTTP mutations. Seed contains no assertions or scenario changes.
- `npm run acceptance`: passed baseline values, complete reads, search ordering/prefix semantics, authorization refusals, monotone/current-membership receipts, single-message unread changes, dynamic ranking and clock buckets, message additions, membership removal, zero-count digest, persistent restart deduplication, following-period emission, and real scheduled delivery.
- `run-log.md`: records the schema shape, privacy/access choices, milestones, lookups, and correction loops.

The actual schedule fired at epoch millisecond `1789361640000`. A service-token worker claimed, appended, and settled every observed effect over HTTP without deduplicating emissions. Evidence is retained in `.acceptance/run-FjWTVP/`: `proof.json`, `deliveries.jsonl`, `settled-effects.json`, `owned-servers.jsonl`, and `server.log`. The harness retains its server child and PID and closes its owned process group in `finally`. Each invocation creates a fresh project/store below the current directory; restart tests preserve that store.

## Wall clock

Start: `1789361205`. Acceptance completed: `1789361643` (7m 18s from start).

| Milestone | Epoch seconds | Elapsed from start |
| --- | ---: | ---: |
| Implementation and initial check complete | 1789361545 | 5m 40s |
| Final run seed and baseline/authority green | 1789361601 | 6m 36s |
| Digest restart and next period green | 1789361605 | 6m 40s |
| Actual scheduled boundary green | 1789361640 | 7m 15s |
| Receipt sequence green | 1789361641 | 7m 16s |
| Dynamic probes and acceptance green | 1789361643 | 7m 18s |

Implementation includes documentation reading, schema construction and client/harness authoring. Acceptance attempts began at 1789361545, 1789361572 and 1789361600. The final attempt took 43 seconds, including 35 seconds waiting for the scheduled boundary. Final record completion time is the `green=` line in the run log.

## Corrections

1. **agent-error** — `npx snapback4 check` reported `N_NEVER_COMPLETE` on the roster scan because its mixed rule referenced an unpinned principal. Split access paths into the private user chat directory and member-readable roster, maintained atomically. No private roster or per-user counter was made public.
2. **agent-error** — `npm run acceptance` combined CLI stderr explanation with the service token. Separated stdout from stderr before using the token as a bearer credential.
3. **agent-error** — `npm run acceptance` had a period parameter named `start` shadowing the server startup function. Renamed period parameters.

No package defects were established.

## Candid gaps

- This is an online-only headless app, with no UI or offline partition sync.
- Queries scan at most 100 original posts and 100 messages per chat. Membership is capped at 16 chats per user and 16 users per chat. The full specified seed and tested additions are complete; larger uncapped collections can report incomplete and would need a larger-scale design.
- The effect performer is an append-only local delivery sink with real backend claim/settlement, not an email or push provider.
- The directory and roster duplicate the membership relationship to support complete private reads on both axes. Digest emission guards persist indefinitely.
- The runner's independent verification has not been observed; the passing evidence above comes from this implementation's acceptance harness.
