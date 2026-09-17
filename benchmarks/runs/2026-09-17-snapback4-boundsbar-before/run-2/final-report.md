# Quarry bounds-bar result

All four tasks pass the full acceptance on a fresh in-memory dev server using the installed published snapback4@0.2.27. No package files were patched, no SQL or native code was used, and no other agent was called. The application is headless and all answers are computed in Quarry.

Run `npm run check -- --cost --residency` to compile with archived diagnostics. Run `npm run acceptance` for a self-contained fresh-server seed, correctness checks and measurements. Run `SNAPBACK_URL=http://127.0.0.1:4400 npm run seed:hub` to populate an already-running empty server. The seed command starts no server and uses only application mutations.

## What passed

- Hub search: 99,090 unique coffee messages across all 1,000 memberships, newest first within each chat. Sparse: five matching messages after a full membership walk. Outsider: 200 messages visible only to its own memberships. An empty-term-result walk continues across empty batches.
- Search uses two cursors: chats(batch), then searchBatch(q,batch,c). Both membership boundaries are 20. Result pages contain at most 20 server-shaped room fragments. Each fragment contains one message, retaining the native page cursor; the Node client only concatenates these already-shaped fragments.
- Following: all 250 / 25,000 / 250 posts for small / wide / celebrity, ordered newest first, in native pages of 20. Post mutations acknowledge accepted writes and the resulting posts appear in the appropriate Following reads.
- Roster: all 50 members in three pages. Unread: hub 50,000, plus exact sparse, outsider and roster-persona totals against the input oracle.
- Trending: exact top ten in the strict rolling post-time window, excluding the old popular post. Twenty distinct new likes immediately promote p000011; duplicate addition is idempotent; removal updates rank immediately; duplicate removal is idempotent. Additional windows verify zero-like fill, strict lower-window exclusion, and equal-time key-ascending tie breaks.
- Every query page checked in the successful acceptance had native complete:true and cut:null. Nothing overwrites or suppresses metadata.
- All 1,349 memberships, 99,390 messages, 1,411 follows, 50,000 posts and 98 likes were imported. Each mutation receipt is checked against the submitted batch count. Chat and author identity-only arrays need no separate tables under the brief.

## Architecture and bounds

Messages are shared, indexed by room and words, with membership authorization. There are no per-reader message copies. The server searches 20 membership lanes per batch, and preserves a separate result continuation. Search can still hit the engine's 32-word expansion bound or a query-wide meter cut; a cut matching merge may have no safe continuation. Such a result is surfaced as incomplete.

Following uses a lazy plain-index merge over the viewer's followed authors, with no fan-out on post writes. Membership and follow-edge caps are 2,048 per principal. The compiler reports N_WIDE_MERGE: lane discovery and heads grow with the follow count, and a workload can exceed the unchanged 8,192 examined ceiling. It passed the fixed 500-follow workload. No ceiling was raised.

Unread reads engine-maintained message counts for every membership and subtracts readOrdinal. This relies on the specified contiguous 1..N message ordinals and the absence of a message deletion operation. It is a server aggregation, not a seed-supplied unread answer. There is no per-principal counter table. A future deletion or non-contiguous ordinal model would need a different unread representation.

Trending uses the posts index (negativeLikes, negativeAt, key, id). Quarry computes negativeAt on insertion. A count maintain over likes supplies negativeLikes, updated in the same like transaction, including idempotent operations. There is no scheduled refresh or stale ranking period. The requested time window is a filter over rank order. N_SPARSE_FILTER is an honest limitation: many excluded old or future high-ranked posts can exhaust the meter before ten results. Native cut/next remains visible. The fixed clock, a shifted zero-like window and a future equal-time window pass; arbitrary windows are not guaranteed to fit one read.

All tables are online-only. Posts and likes are publicly readable; posts have a permissive update rule because the exposed like helper updates their rank. The exposed mutation bodies control the actual changes. Likes insert/delete require viewer ownership, except the seed-only import path. Import mutations require dev:seed. Maintains expose message counts to room members and like counts publicly.

Input lists are bounded at 256 rows; keys at 128 characters, bodies at 4,000 and search text at 100. Larger individual inputs are rejected. The engine's mutation write, examined-row, probe, output and heap budgets are unchanged.

## Failures preserved

Check 001 failed because unary minus directly before a maintain read parsed as a write sigil; using 0 - likeCounts[postKey] compiled. The first acceptance failed because group(page) lost the native cursor owner, yielding complete:false with no next. Returning native page-shaped singleton room fragments fixed that without forging metadata. A transport setup attempt used the absent package-root export and a shell background process that did not survive; the final client uses snapback4/client, and acceptance records and cleans up its own spawned process group. There are no known package defects established by this trial.

All three check invocations, including the failure and cost/residency output, are retained in evidence/checks/001.log through 003.log. The failed and both successful acceptance runs have separate logs and process records. The final schema has no changes after check 003; the last acceptance adds only stronger input-receipt and tie-order assertions.

## Timings and measurements

Start: 1789639758. First full green: 1789640143 (385 seconds after start). Report written: 1789640317 (559 seconds after start), inside the 60-minute budget. The exact pin was already installed when the task began; no installation was needed.

Seed attempts: 8.537 seconds before the first search failure, 5.912 seconds before first green, and 7.692 seconds in final acceptance. Final acceptance took 21.318 seconds including its seed, queries and latency samples, measured before process cleanup. No seed time is excluded from the task clock.

Each latency series contains 60 measured requests after three warm-ups. Post measurements alternate the 900-follower and five-follower authors. These local-loopback measurements are observations, not performance gates.

| Operation | Mean ms | Median ms |
|---|---:|---:|
| Following small | 0.382 | 0.355 |
| Following wide | 2.797 | 2.703 |
| Following celebrity | 0.426 | 0.401 |
| Post, 900 followers | 0.333 | 0.265 |
| Post, five followers | 0.284 | 0.261 |

Wide/small Following mean ratio: 7.316. Celebrity/quiet posting mean ratio: 1.174.

Maximum examined rows observed: search result 481, Following 1540, roster 22, unread 2000, Trending 3345. Unread's maximum rule probes were 1000. These measured maxima do not replace the stated workload limits.

Machine-readable protocols, derived columns and source ranges are recorded once in run-log.md. Detailed final measurements are in evidence/latest-acceptance.json. No runner-owned process was stopped.
