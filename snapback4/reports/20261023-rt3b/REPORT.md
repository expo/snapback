# RT3b — authority boundaries (2026-10-23)

Lane `sb4-pg/rt3b`, base `f9d714d4a2`, expo-build-450b. Local commits only.
Raw command output and temporary process custody records stay outside Git.

The governing constraints are LLP 3000.009.001.000.001 §3.1, §3.5 and §7;
committer §3.6–3.7; store-port §5. Authority policy remains in Rust, owner
and head locks retain their order, and COMMIT remains a separate command.
No pre-execution or batching implementation is claimed by this lane.

## Commit 1 — reader ingress

Prediction before coding: every warm RT0 cell remains at RT3a. Only the
connection used by non-detached mutation ingress changes; no statement is
removed. The ingress may refuse without joining the writer queue, and all
later authority checks remain for this commit.

| Class | SQLite predicted | SQLite measured | Postgres predicted | Postgres measured |
| --- | ---: | ---: | ---: | ---: |
| action_session_w1 | 28 | 28 | 22 | 22 |
| keyed_first | 40 | 40 | 46 | 46 |
| narrowed_argument | 17 | 17 | 13 | 13 |
| one_membership | 33 | 33 | 27 | 27 |
| rate_limited | 0 | 0 | 0 | 0 |
| replay_hit | 19 | 19 | 21 | 21 |
| unauthenticated | 0 | 0 | 0 | 0 |
| unkeyed_increment | 32 | 32 | 26 | 26 |
| unknown_operation | 17 | 17 | 13 | 13 |
| unknown_token | 3 | 3 | 3 | 3 |
| w1_point | 16 | 16 | 12 | 12 |
| w2_newest20 | 16 | 16 | 12 | 12 |

Validation: `cargo build -p snapback4`, both RT0 ratchets (three equal warm samples per class), and all four SQLite/Postgres queued-authority and ingress witnesses pass. Every cell matches its unchanged prediction. The new ingress witness holds the writer until the unauthenticated refusal arrives and asserts no writer waiter and no store metadata.

## Commit 2 — reader preflight only when needed

Prediction before coding: keep route and final authority checks for this
increment. Combine keyed preflight authority, identity/head/generation and bound
receipt in one reader snapshot. Skip successful unkeyed preflight. Metadata
refusals authenticate in their own preflight snapshot.

| Class | SQLite predicted | Postgres predicted |
| --- | ---: | ---: |
| action_session_w1 | 28 | 22 |
| keyed_first | 39 | 39 |
| narrowed_argument | 9 | 9 |
| one_membership | 30 | 24 |
| rate_limited | 0 | 0 |
| replay_hit | 10 | 10 |
| unauthenticated | 0 | 0 |
| unkeyed_increment | 29 | 23 |
| unknown_operation | 9 | 9 |
| unknown_token | 3 | 3 |
| w1_point | 16 | 12 |
| w2_newest20 | 16 | 12 |

Unkeyed success loses its three-statement preflight authority snapshot. Keyed
first combines five SQLite statements / eleven Postgres flights into four.
Replay replaces those plus the separate eight/four-statement metadata read
with four. Unknown operation and bad arguments retain ingress and route (six)
plus the three-statement authenticated refusal snapshot. Other cells retain
their paths and counts.

All predictions match measured counts exactly (three equal warm samples per
class). The small `preflight-sqlite.json` and `preflight-postgres.json` files
record the complete measured tables. Final build, both lowered ratchets, all
four authority witnesses and the normal 206-case serving regression scope pass.
The latency witness now counts the three readers used by its concurrent keyed
write as well as the poll's two; the poll's own timing assertion is unchanged.
An exploratory `--include-ignored` serving sweep also invoked three opt-in
fixtures without their required input variables; those are not standalone
checks. It found two affected regressions (delivery-refusal precedence and the
reader-count assertion), both repaired and green in the normal repeat.
