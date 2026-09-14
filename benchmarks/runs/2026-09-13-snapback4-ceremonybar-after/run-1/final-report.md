# Ceremony backend result

Built all five shapes in Quarry using snapback4@0.2.9: insights with UTC buckets, live trending, durable scheduled digests, current-membership receipt state, and grouped word-prefix search. Node seeds via application HTTP mutations, runs assertions, and performs effect work. Application answers are computed in Quarry.

Validation passed:

- Final `npx snapback4 check`: no problems or notes.
- `npm run seed`: exact eight profiles, forty posts, specified likes/follows, three chats and sixty messages through authorized HTTP mutations.
- `npm run acceptance`: fresh persistent project; exact initial results, explicit clock changes, authorization refusals, live likes/ranking changes, message insertion, individual read contributions, membership changes, zero-unread active-user digest, and no-recipient receipts.
- Same-period digest rerun across restart produced no duplicates; following periods emitted again. A real scheduled boundary at 2026-09-14 06:34:00 UTC passed. The ceremony service worker claimed, observed and settled 21 real effects over HTTP, without deduplicating emissions.
- Schema choices and the machine-readable schema-shape line are in run-log.md.

## Wall clock

| Milestone | Elapsed from start |
| --- | ---: |
| Start | 0 s |
| Packet read (logged) | 94 s |
| Clean schema and generated types | 180 s |
| First acceptance failure diagnosed and corrected | 323 s |
| Successful acceptance started | 323 s |
| Real scheduled boundary verified | 385 s |
| Full acceptance and owned-server cleanup | 390 s |
| Final report | 470 s |

## Correction loops

1. **agent-error** — Initial check reported N_NEVER_COMPLETE because the roster read rule combined principal ownership with chat membership. Resolved with an explicit public-roster policy, while keeping chats, messages and receipt facts membership protected. Profiles are public identities, allowing follow-target existence checks. No counter tables are world-readable.
2. **agent-error** — First acceptance parsed combined stdout/stderr from the token command and selected diagnostic prose as the bearer token. The worker was refused with E_AUTH. Keeping stdout separate fixed token parsing; the fresh rerun passed.
3. **agent-error** — Report generation failed on JavaScript template-literal escaping. Replaced the generator with a Python multiline string; application code and proof results were unaffected.

## Gaps and limits

No known gaps against the requested small-seed behavior. Queries use finite pages (1,000 rows for most domain scans; 50 current recipients), so this is not a claim of unbounded-history aggregation. Membership rosters are explicitly public; message and acknowledgement content remains private to current members. Digest period history grows durably without a retention policy. Effects are observed and acknowledged by the headless worker; no external notification provider is configured. No package source, alternative backend, native code, or other agent was used.

Proof artifacts are under `.acceptance/run-pGJ6wG/`: acceptance.log, observed-effects.jsonl, settled-effects.json, server.log, and the persistent project/store. The earlier failed copy is preserved for diagnosis. All launched backend process groups were owned and closed in finally blocks.
