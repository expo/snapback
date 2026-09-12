# Observed platform gaps

## Time-dependent authorization (M5)

`read <- exists memberships[.conversationId, viewer] and (.expiresAt = null or .expiresAt > now)` is refused by `snapback4@0.0.2 check`: `E_QUARRY_UNKNOWN: > is not a rule operator; rules use and, or, not, =, and !=`. Exact diagnostic and refused schema: `evidence/m5-expiry-rule-check.txt`, `evidence/m5-expiry-refused.q`.

The shipped guardedMessage query refuses an expired message using server time. The app filters expired rows immediately and requests a server-checked purge when a conversation reconnects, then periodically while connected. Retained display archives also purge. However **unfiltered history and raw replication can return expired content before purge**. `evidence/m5-expiry-security-gap.json` proves both the successful guarded refusal and the failed whole-platform guarantee with Alice's and Bob's clients closed. This is not an environment strike. Do not treat the UI expiry choreography as proof of the stronger security requirement (m5-a01).

## Indexed word search (M5)

The published README explicitly excludes word search. Search scans already-synced rows using NFC normalization and word-prefix matching. It works offline, but this is not a server index and does not establish the scale performance bar. Retention bounds still limit locally available history.

## Other observations

- A missing source-audience index passed `check` but caused `sync` to return E_SCHEMA (M4). Adding the index resolved it; the diagnostic's claim that check catches it was inaccurate.
- Local delivered-history retention preserved storage but membership rules hid the rows from queries after removal. A supplemental archive holds only previously rendered authorized history. Post-removal tombstone delivery to that archive is not proven.
- Concurrent local mutation calls sometimes remained pending on a healthy link. Calls are serialized; typing and receipt acknowledgements use online mutations. Offline user writes still require M6 validation.
- Native behavior has bundle compilation evidence only; no simulator proof is claimed.

M5 additionally reproduced stale hook subscriptions after navigating from Conversation to ChatSettings, both of which used `useQuery(api.conversation, sameArgs)`. An explicit `client.query` showed fresh data while both UIs stayed stale; a direct settings load worked. `chatConfiguration` is a distinct operation to avoid that subscription-key overlap. Evidence: `evidence/m5-color-probe-route.txt`. This is attributed to an apparent package subscription-lifecycle defect; no package source was inspected to establish its internal cause.

## M6/M8 resolved workarounds and remaining limits

Cold restoration required a durable `/schema` response cache through the published fetch option. The cache works on web (IndexedDB) and is bundled for native (SQLite); the cold browser probe passes. Pending metadata is available on unshaped rows but absent on shaped history, so a companion raw query supplies it. The actual UI's online edit path must be used for live edits; a diagnostic probe that substituted a local edit sequence did not settle its subsequent reaction, while the shipped UI sequence passed.

Push emission is an immutable transactional outbox and a reference polling provider sink. Abruptly disconnected clients retain a lease for up to 15 seconds; immediate transport-level presence is not exposed by the package. No real external notification provider is connected. Graceful close clears its own device lease.

Insights are server-computed from maintained facts. The existing-store backfill covers up to 1,000 likes per post per invocation; the installed fixture is within that bound. Trending pages indexed ranked candidates from two UTC-day buckets until ten non-expired-window posts are found. There is no fixed corpus scan for Insights. Full-corpus API probes passed; the hidden performance grader and its Insights/Trending growth curve were not run. M6's 10%/50% checkpoints preceded M8's analytics operations.

The custom inbox operation is capped at 200 conversations; the fixture's probe user has 100. Message replicas retain a 500-row per-chat horizon, with paged online history beyond it. Search covers synced rows, not every historical server row. Native simulator proof was not required; seven Hermes artifacts exist, but no native runtime performance or persistence proof is claimed.
