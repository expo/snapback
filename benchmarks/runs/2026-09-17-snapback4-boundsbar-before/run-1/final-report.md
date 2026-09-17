# Quarry bounds-bar result

All four tasks passed `npm run acceptance` on a fresh in-memory dev server using the installed exact `snapback4@0.2.27` pin. The final check passed with one `N_WIDE_MERGE` note. No package implementation was read or patched, no external backend or application SQL was used, and no other agent was called.

The first green was Unix **1789639573**, 474 seconds after the recorded start. The start was recorded shortly after the initial README read; that small setup interval is additional. The final successful acceptance took **12.621 seconds**, including **6.310 seconds** to generate and import the complete seed through application mutations. Earlier full seed times were 9.321, 8.182 and 6.001 seconds. There was no installation during this run: the requested pin was already installed. Report preparation occurred after green and within the 60-minute allowance.

## Verified results

- Search: all **99,090** hub coffee messages in **50** pages, five sparse matches across five pages, and 200 outsider matches only for that principal. Membership filtering, no duplicates, empty groups and per-chat newest-first order were asserted. Native continuation and completion metadata are retained.
- Following: full walks returned **250 / 25,000 / 250** posts for small / wide / celebrity, twenty per nonfinal page, in server order.
- Roster: all **50** members over three hub pages; outsider receives none. Unread: hub **50,000**, sparse 100, outsider 200, and an additional roster principal 100.
- Trending: exact first ten at A, then exact results after twenty distinct likes and one removal from p000011. Repeated add/remove requests are idempotent. Additional tests checked zero-like results, key ties and both rolling-window boundaries. The old popular seed post is excluded.
- Post writes: acknowledged only at native `state:sent`. The benchmark alternated writes for the 900-follower and five-follower authors.

All 99,390 messages, 1,349 memberships, 1,411 follows, 50,000 posts and 98 likes were imported. Chat and author identities are represented by their logical keys in these rows; separate fact-free identity tables were not created. Node maps input columns and compares test expectations; application grouping, sorting, aggregation and ranking are Quarry operations.

## Measured work and latency

| Read | Maximum examined rows per tested page |
|---|---:|
| Hub search | 2,021 |
| Sparse search | 26 |
| Small / celebrity Following | 115 |
| Wide Following | 1,540 |
| Roster | 21 |
| Unread | 1 |
| Trending | 290 |

The full wide Following walk examined 1,899,000 rows over 1,250 pages. First-page latency means over sixty requests after three warm-ups were **0.309 ms small**, **2.771 ms wide**, and **0.342 ms celebrity**. Ratios were **8.974× wide/small** and **1.108× celebrity/small**. Sixty measured alternating post writes after three warm-ups averaged **0.240 ms** for 900 followers and **0.237 ms** for five, a **1.013×** ratio. These are local measurements, not performance guarantees.

## Serving architecture and limits

Search preserves the native membership page and shapes each of its twenty rows into a complete nested matching collection. Messages have an enforced **4,096-per-room cap**; rooms have a **100-member cap**. These are application choices, not raised engine ceilings. The supplied seed fits comfortably, but twenty larger chats can exhaust the examined, heap or output meter even below their individual caps. Broad prefixes can also hit the engine's 32-word limit. Those cases remain incomplete; the implementation does not claim a universal large-chat continuation solution.

Following performs a merge on read over at most **1,024** follow edges, an enforced per-principal cap. Write cost does not fan out with follower count. The compiler's wide-merge note remains in every relevant saved check.

Unread counts are computed on the server when memberships are inserted, and updated for later imported messages. An engine maintain sums them per principal. Imports insert messages before memberships, avoiding unnecessary update fanout. General read-position changes and membership lifecycle APIs are outside the requested interface. Large batches with existing rosters or many large message scans can hit mutation limits and abort atomically.

Trending stores like count, negative count, negative timestamp and UTC hour on each post. Likes and rank update atomically through the set-state mutation. A maintain discovers occupied hours; the query merges at most **25** hourly rank lanes intersecting the day and applies exact timestamp boundaries. Zero-like posts participate directly. Dense excluded portions of the two boundary hours can still exhaust the unchanged meter. Hour discovery uses named local bounds because inline `hour()` expressions triggered a runtime generated-variable refusal despite passing check.

Posts have public read and permissive update rules so a viewer's like can update another author's rank. The exposed normal mutation controls those updates. The seed principal has explicit import authority. The per-membership unread field is covered by the roster's member-readable table rule; the roster query returns only principal. The two maintains, derived columns, permissive rules and source ranges are recorded in `run-log.md`. There are no per-reader post or message copies, scheduled rebuilds, device holdings or residency measurements.

## Failed attempts and evidence

1. The initial transport assumed a package-root client export and bare HTTP arguments. The exported entry was unavailable and the wire requests required an `args` envelope. The Node fetch transport corrected both.
2. Grouping a merged search page into a new list lost native cursor ownership, returning `complete:false` without next. Acceptance rejected it. The final membership-page shape preserves its owner.
3. Global rank filtering passed the required anchor tests but cut at 8,193 recorded examinations in a shifted two-result window. Hour-scoped ranking replaced that design; the failure is preserved.
4. Inline computed bounds in a maintain selector inside a merge compiled but failed with `E_INPUT: unknown variable $value1`. Moving the expressions into named locals fixed it. This is attributed to an apparent compiler/runtime defect based on public behavior, without implementation inspection.

Four complete numbered check outputs, including cost and residency diagnostics, are in `evidence/checks/`. All acceptance attempts and fresh-server logs are preserved. The successful measurements are in `evidence/acceptance-1789639560604.json`. Acceptance starts and records its own server process group and stops that group in cleanup. The separate owned smoke-test server was also stopped.

A procedural limitation remains in the knowledge log: initial card counts were taken from emitted saved text, but some combined tool displays truncated that text. Thus those entries are not precise counts of demonstrably visible lines. This is disclosed in the append-only run log rather than silently corrected to improve the metric. It does not affect the fresh-server acceptance result.

Run `npm run acceptance` to repeat the complete test. Run `SNAPBACK_URL=http://127.0.0.1:PORT npm run seed:hub` only against an already-running empty dev server. Run `npm run check -- --cost --residency` to save another numbered compiler record.
