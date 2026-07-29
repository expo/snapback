# Chat / InstantDB evidence audit

Final capsule verification: PASS
Expected scenarios: 15
Recorded scenarios: 15
Disposition: 13 PASS, 2 GAP, 0 Stop

| Scenario | Result | Primary evidence |
| --- | --- | --- |
| CHAT-01-SEED | PASS | `acceptance-results.json`, `seed-receipt.json` |
| CHAT-02-AUTHORITY | PASS | actor-scoped positive/negative queries and subscription |
| CHAT-03-SEND | GAP | identity enforced; authoritative row lacked exposed server timestamp/order |
| CHAT-04-PUSH | PASS | Bob native WebSocket subscription |
| CHAT-05-PAGINATION | PASS | opaque cursor hashes, page sizes, zero overlap |
| CHAT-06-TYPING | PASS | native room topic and zero durable typing rows |
| CHAT-07-PRESENCE | PASS | native room presence and disconnect removal |
| CHAT-08-RECONNECT | PASS | shutdown/new authenticated client, equal counts, zero duplicates |
| CHAT-09-OFFLINE-HISTORY | GAP | no controlled browser; custom Node storage not credited |
| CHAT-10-UNREAD | PASS | two Bob clients, authoritative marker, reconnect |
| CHAT-11-CONCURRENT-SEND | PASS | two-actor barrier, both authoritative rows |
| CHAT-12-LOGOUT | PASS | `getAuth() === null`, no protected future delivery |
| CHAT-13-REVOKE | PASS | native unlink, no protected future delivery |
| CHAT-14-PERFORMANCE | PASS | two warmups + seven raw samples for all five paths |
| CHAT-15-CLEANUP | PASS | all exact counts zero, token invalid, raw credentials removed |

The audit found no unsupported PASS claim. CHAT-03 and CHAT-09 remain GAPs.
Temporary app configuration persists only until the provider-managed automatic
expiry and is disclosed in cleanup evidence. Failed setup, permissions,
harness, and UI-build attempts are retained in `receipts/`.
