# Diary 0104: Sol-high Clique Explicit on unpublished local main

**Date:** 2026-08-20/21
**Run:** `benchmarks/runs/2026-08-20-clique-local-main-sol-high/`
**Lane:** GPT-5.6 Sol high, Clique M1–M3, default Explicit profile
**Backend:** local source commit `708e2e5c5348b5bb863cd7120afbafad9db99e9a`
**Outcome:** M1–M3 green in 4,055s; 123,561 output tokens

This is N=1 diagnostic evidence against unpublished source, not scored or
claim-eligible. The lane agent's complete diary, essay, receipts, and report
remain under `/Users/ccheever/clique-main-20260820/` on the run machine.

## M1 — accounts and profiles

Explicit authoring was strongest once schema, handler arguments, and generated
references aligned. Unique indexed lookup plus a server-derived principal made
profile writes small and auditable, and the two-client live profile update was
straightforward. The final three observations were about 132–136ms.

Most M1 time went into carrier composition rather than application logic.
`snapback dev --expo` allocated an expected dynamic Metro listener, then
classified listener enumeration as incomplete and tore down a working
fixed-port backend/Metro pair. A split backend and Expo server worked through
the first-party React provider and exact local binding. Browser reload also
forced the auth posture from volatile to durable. Headless acceptance personas
shared the default durable auth partition until each client received an
explicit `storagePartition`.

Diagnostics were generally useful: unspliceable inline helpers, malformed
seed envelopes, stale startup artifacts, and video asset declarations all
failed with named refusals. The missing piece was one supported fixed-origin,
pinned-port Expo recipe and a single reconciled custody story for web versus
export-only native work.

## M2 — social feed

Unique set-state edges made follows, likes, and reposts naturally idempotent.
The server-authoritative live queries passed post, follow, like, repost, and
reply choreography without client-side counter patches. The selected live text
post trial was 818ms, and the final suite covered all 22 required assertions.

The hard parts were media and navigation seams. Snapback's one-asset command
ceiling required separate exact uploads followed by one attaching mutation for
a two-image post. Expo Router retained inactive stack content, briefly
duplicating frozen composer IDs. The fixed choreography also expected feed tabs
from profile routes and display-name-first DOM text. These were app-shell
corrections, not backend failures.

Explicit declarations made media policy and set-state intent reviewable, but
the repeated read/write declarations and 19 final
`SNAPBACK_TABLE_WRITE_POSTURE_MIGRATION_PENDING` warnings were noisy. A
multi-asset post recipe with orphan cleanup and an idempotency recipe separating
domain IDs from transport mutation IDs would have saved time.

## M3 — messaging

DM pair keys, group resources, active memberships, message rows, and quotes
were easy to reason about as separate durable concepts. Connection-owned
ephemeral typing mapped especially well to the composer: no durable typing row,
no cleanup mutation, and the frozen browser run observed live delivery and
bounded expiry. DM delivery passed at 838ms, 1,437ms, and 986ms; the retained
typing pass became visible at 1,702ms.

The server-derived sender, active-membership check, admin-only removal, same-
conversation quote validation, and send-time recipient snapshot all lived in
inspectable handlers. The candid gap is read privacy: the timed lane used
authenticated but globally readable conversation/message live queries. It is
green for the frozen M3 contract but not a production private-messaging claim.
The Guide needs an end-to-end Explicit recipe for membership-scoped multi-table
reads, removed-member cutoff, retained local history, and receipts derived from
the send-time recipient set.
