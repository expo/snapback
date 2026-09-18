# Final report

All four tasks pass on the final schema. The final fresh-server acceptance completed in 35.668 seconds, including 12.446 seconds to generate and import all fixed input rows through Quarry mutations. Green was recorded at 1789719897, 10.15 minutes after the logged start. The required published 0.2.29 dependency was already installed. No other agent, package implementation source, SQL, native code, external backend, or raised engine ceiling was used.

Search returned all 99,090 hub coffee messages and five sparse matches, with complete per-chat ordering and no outsider leakage. It also verified the outsider's 200 matches, sparse tea matches, empty search, and continuation traversal. Following walked 250 small, 25,000 wide, and 250 celebrity posts exactly. Roster returned all 50 members in pages of 20, refused disclosure to outsiders, and unread was exactly 50,000 for hub; other principals were checked independently. Trending passed its initial top ten, 20 added likes, one removal, repeat set/clear idempotency, old popular-post exclusion, zero-like fill, exact time edges, time ties and ascending key ties. New posts were acknowledged and visible in Following.

All three saved compiler checks passed with cost and residency output. The first acceptance passed. A subsequent acceptance caught an incorrect import-closure guard: an implicit membership lookup chose byId. Explicitly selecting byRoomPrincipal repaired it, and the final acceptance passed. Earlier transport exploration guessed an unsupported root client export and encountered a server that exited with its shell. A probe seed also failed on a pre-existing follow. All failures remain in the evidence and run log. That failed seed's wall interval was recovered from log creation/modification times (11.664 seconds, including npm startup); later seed attempts instrument both success and failure in finally. No package defect was established.

The final run issued 1412 recorded verification queries. None had a completeness cut. Hub search used 50 requests, at most 2021 examined units per request. Wide Following used 1250 requests, at most 1540 examined units per request. Native metadata is retained in reads.ndjson; no completeness or cut field is replaced.

Measured means in milliseconds, each over 60 requests after three warm-ups:

| Operation | Mean ms |
|---|---:|
| Following small | 1.737 |
| Following wide | 4.986 |
| Following celebrity | 0.817 |
| Post, 900-follower author | 0.594 |
| Post, five-follower author | 0.563 |

Wide/small Following ratio: 2.870. Celebrity/small: 0.470. Popular/quiet post ratio: 1.054. These are local measurements, not performance guarantees. Posts do not fan out to followers.

The main chosen limit is a hard cap of 256 messages per room; oversized room imports refuse. Search pages 20 memberships and reads complete nested chat groups. Word expansion still has the package's 32-word bound, and expensive queries can exhaust the default meter. Following discovers all followed-author lanes on each page; sufficiently wide follows can cut during opening without a continuation. Trending merges 25 hour lanes over signed score/time columns. A densely populated rejected part of the oldest hour can exhaust the 8,192 examined ceiling. Score changes and concurrent inserts make cursors live rather than snapshots. These are anticipated limits, not hidden by the client.

Unread is a stored per-membership count computed on the server from ordinal comparisons, summed by an engine maintain. Imports must put messages before memberships; the first membership closes a room to message imports. No message-send or mark-read API is provided. The post update rule is allow: existing declared mutations only initialize scores or change them atomically with like edges, but a future arbitrary-score mutation would need a stronger authority design. All data is online-only; residency reports no device sync. Seed batches are atomic individually; the entire import is not one transaction and must target an empty server.

Files: snapback/schema.q, transport.mjs, seed.mjs, acceptance.mjs, check.mjs. Final evidence: evidence/acceptance-1789719801466/ and evidence/acceptance-third.log. Every owned test server was stopped; acceptance always cleans up its own recorded process group.
