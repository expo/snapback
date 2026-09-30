# NA round 1 scoped orientation

Scope: merge origin/main 11ddefd88c, bounds guidance, native publication measurement
and validation. Merge commit: 6699793533. Round 0 authorization and constraints apply.
Read both complete reviews and round-0 prompt/report; local llp-orient link was
uninitialized, so read the same skill from lane-bn/vendor/llp/skills/llp-orient.

Governing LLPs: LLP 3000 (root), 3000.007 §18.2/§20.4 (atomic replacement,
retention and persistence), 3000.002 (resource claims), 3000.030 §14 (BN final
witness). These are in current, none in foundation. LLP 3000.001 and 2000.000
§7.2 govern publication and durable outbox. Existing @refs remain applicable.

Active constraints: LLP 3000.007#20.4 binds indexes, coverage, delivery, prediction
and acquired state to one publication transaction. LLP 3000.030#14 requires
validated terminal reconnect with no failed attempts; receipt format 2 omits
server text/timings and hashes table identities. No public contract changes.

Risks: bounded sort caches do not bound delivery candidates per row; temporary
sort space exceeds final store size. Old process timings are not C ABI/Expo
measurements. Warm OS caches and shared-host load limit benchmark claims.

Doc updates: bounds, round-0 memory correction, governing LLPs, round1 report,
one append-only journal entry. Hand-off: none. No new runtime mechanism selected.
