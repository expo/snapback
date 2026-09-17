# Bounds bar result

All four tasks pass the complete fresh-server acceptance on published `snapback4@0.2.27`. No package edits, application SQL, native Rust, external backend, raised engine ceiling, other implementation, or agent was used. The unchanged generator supplied every logical input. Identity-only chats and authors have no separate tables; all 99,390 messages, 1,349 memberships, 1,411 follows, 50,000 posts and 98 likes were inserted through Quarry mutations.

## Verified answers

- Hub search returned all 99,090 matching messages over 4,955 result pages, with no outsider messages or duplicates and newest-first order within every room. Sparse search returned all five matches while continuing empty membership batches. Outsider independently returned its 200 messages. Grouping is server-side. The extra intact page projection carries the native result cursor; the client concatenates grouped fragments.
- Following returned 250, 25,000 and 250 posts for small, wide and celebrity, respectively, over 13, 1,250 and 13 pages. Every page was complete. Posting acknowledges the accepted mutation and does no follower fanout.
- Roster returned all 50 members in pages of 20. Hub unread was exactly 50,000; sparse, outsider and an additional roster member were independently checked. Unread counts compare each inserted ordinal against each member's read ordinal on the server, then an engine-maintained sum covers every membership.
- Trending returned the exact top ten at A, excluded the old popular post, and immediately reflected 20 distinct new likes and one removal on p000011. Repeated add/remove was idempotent. A historical window additionally verified ranking with zero-like fillers. The hour-partitioned merge uses the same generic rules for all timestamps, keys and personas.

Acceptance preserves and asserts native completeness and cut metadata. Expected values come from the generator's input in the test oracle; the application client never fetches raw tables or computes rankings or totals.

## Timings and work

The passing run took **23.997 seconds**, including **5.901 seconds** of seed work. Hub search took 9.234 seconds; the wide Following walk took 6.639 seconds. Timings are one local run, not performance guarantees.

| Read | Maximum examined per result page | Total examined in result walk |
|---|---:|---:|
| Hub search | 481 | 2,130,026 |
| Sparse search | 26 | 109 |
| Small Following | 115 | 1,195 |
| Wide Following | 1,540 | 1,899,000 |
| Celebrity Following | 115 | 1,195 |

Search totals here exclude the separate membership-discovery requests. Trending examined 290 rows on each tested first page at A.

After three warm-ups, 60 first-page requests per persona averaged 0.400 ms (small), 3.372 ms (wide), and 0.415 ms (celebrity). The wide/small ratio was 8.428. Alternating 60 accepted posts per author after three warm-ups averaged 0.333 ms for the 900-follower author and 0.295 ms for the five-follower author, ratio 1.127. Full samples are in `evidence/acceptance-results.json`; ratios are observations, not gates.

## Failures retained

1. The Node transport initially imported the package root instead of `snapback4/client`, then used an incorrect status field. Both were agent errors, corrected before the full reads.
2. Returning only `group(page)` lost the merge's cursor ownership: the first search page had `complete: false` and no continuation. Returning grouped rows alongside the intact shaped page repaired this without forging metadata.
3. The initial global rank-first Trending scan passed A but hit the examined-row meter on an extra historical-window test. Ranking now uses UTC-hour lanes, so it does not scan all newer posts to reach that window.
4. The first hour-scoped implementation compiled but returned `E_INPUT: unknown variable $value1` from inline computed discovery bounds. Hoisting the same calculations into explicit locals repaired the reproduction and full acceptance. This is recorded as a package defect with a source-level workaround; no package implementation was inspected or patched.

Failed acceptance transcripts and partial results remain in evidence. All eight check invocations, their notes, cost/residency output, commands and exit statuses are retained. The final check passes with one `N_WIDE_MERGE` note for Following. Earlier `N_SPARSE_FILTER` notes remain in earlier logs.

## Bounds and limitations

The schema caps a room at 128 members and a reader at 1,024 follows; seed mutations accept batches of at most 128 inputs. These are application choices and refuse data beyond them. There is no cap on the number of rooms per principal or source posts/messages. Text bodies have a 4,000-character bound and search terms a 100-character bound. All tables are online-only; no sync horizon or device proof is claimed.

Search uses 20 membership lanes and 20 results per page. Broad word prefixes can still exceed the package's 32-word expansion limit per scope, or spend the shared meter on later-term misses. Such a cut remains incomplete; the transport does not label it complete. Cursors represent live reads and should be restarted after membership changes.

Following's read cost grows with follows despite cheap posting. Its 1,024-lane limit and the unchanged 8,192 examined-row ceiling remain visible. Trending discovers at most 25 UTC-hour buckets intersecting a rolling day and merges their rank indexes. A very dense partial boundary hour can still exhaust the meter while filtering out-of-window candidates; the fixed workload and tested historical window fit. No claim is made of unlimited density.

Membership counters require memberships to precede message ingestion, which the seed enforces. Product membership changes, read-marker updates, message edits/deletes, and follow mutations are outside the requested API. Adding them would require maintaining the counters or serving state in the same transactions. Seed operations are explicitly restricted to the development seed principal.

Posts deliberately have permissive read and update table rules so a reader's like can atomically adjust a foreign post's stored rank. The exposed product mutation accepts only the viewer's own like set-state; it does not accept arbitrary rank patches. Stored derived facts and auxiliary maintains are fully listed in `run-log.md`, including unread, likes, negative ordering fields and hour keys. There are no background jobs or delayed rebuilds.
