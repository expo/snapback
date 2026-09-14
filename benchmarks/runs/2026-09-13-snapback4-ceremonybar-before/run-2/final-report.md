# Ceremony backend result

Built all five shapes in `snapback/schema.q` using only the installed exact `snapback4@0.2.8`: lifetime insights and UTC buckets, live maintained-like ranking, durable scheduled digest effects, current-member receipt aggregation, and grouped word-prefix search. `client.mjs` is HTTP transport and assertion normalization; `seed.mjs` performs only authorized seed writes; `acceptance.mjs` owns its temporary copy, persistent store, child handles and PIDs, service-token worker, assertions, and cleanup.

Proof: `npx snapback4 check` passed with no problems or notes. Seed installed the specified facts through app mutations. `npm run acceptance` exited 0 in `.acceptance-3iGyJ5`, including exact baseline results, complete reads, duplicate/self-like refusals, live ranking changes, search changes, non-member refusals, monotone per-message receipts, no-recipient read, membership changes, zero-unread active-user emissions, duplicate-period suppression across restarts, next-period emissions, and real HTTP effect claims and settlement. The actual scheduled boundary at **1789362240000** emitted the three expected digests. Owned server children closed in `finally`.

## Wall clock

| Milestone | Elapsed from start |
| --- | ---: |
| Packet read and initial schema start | 90 s |
| Clean schema and first acceptance start recorded | 243 s |
| Seed and baseline queries confirmed | 257 s |
| Worker/restart correction retry | 289 s |
| Durable periods and worker settlement confirmed | 326 s |
| Actual scheduled boundary | 343 s |
| Final acceptance and record | 384 s |

Milestone timestamps are recorded when observed; implementation and verification overlap.

## Correction loops

1. **agent-error:** The initial timestamp shell command wrote `/tmp/unused-ceremony-time`, violating the current-directory-only constraint. Subsequent work stayed inside the current directory. No repository or implementation was read there; this initial violation cannot be undone historically.
2. **agent-error:** `check` reported `N_NEVER_COMPLETE` for the mixed membership rule. Split viewer chat membership access into `userChats`, retaining chat-scoped `members` for complete receipt scans.
3. **docs:** First acceptance used the CLI token output verbatim; its prose caused an invalid HTTP header. The published packet does not specify the token output layout. Initially selected the final line.
4. **agent-error:** Lifecycle review found a kill timeout could execute after normal child exit. Clear the timer after the owned child closes. Added the no-recipient assertion.
5. **agent-error:** The second acceptance still failed because combining stdout/stderr made the token line order variable. Extract the opaque token by its alphabet rather than stream arrival order.

No package defects were observed. All corrections have matching machine-countable log entries.

## Gaps and limits

- The initial out-of-directory timestamp write violated the brief, as disclosed above.
- This is an online small-seed backend. Bounded scans support the required complete dataset and probe additions; substantially larger datasets require pagination or another aggregate design. Package ceilings were not changed.
- The worker records observed payloads to a JSONL sink and settles the actual effects; no external email or push provider is configured.
- Temporary acceptance copies and their diagnostic stores/logs are retained inside this directory. The successful copy is fresh and independent of the earlier failed copies.
- The independent runner's probes have not been run by this implementation. All supplied acceptance assertions passed.

Schema classifications and access rationale, including the public per-post like maintain and durable period emission ledger, are in `run-log.md`. No scratch/accumulator tables, per-principal counter tables, or auxiliary operations were used.
