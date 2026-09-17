# Final result

All four tasks passed the full fresh-server acceptance twice. The final acceptance also checked zero-like filling, equal-time key ordering, the excluded lower time boundary, the excluded future boundary, and idempotent repeated like/unlike calls. Final green: **1789660171**, 964 seconds (16 minutes 4 seconds) after start. The exact installed `snapback4@0.2.27` pin was used without changing its implementation or raising any ceiling.

## Working behavior

- Search walks all memberships in batches of 20 and matching results in pages of 20. Quarry groups each page by room, with descending message times. The hub walk covers 99,090 messages; sparse covers its five matching chats; the 200 newer outsider messages are excluded. Empty result batches do not end the membership walk.
- Grouping consumes a native page's cursor ownership. The final wrapper returns grouped `rows` plus an empty projection of that same page in `continuation`. This preserves the engine's original continuation and completeness. It returns no ungrouped message content and changes no native `complete`, `cut`, or `next` metadata.
- Following merges original post indexes for the viewer's follow edges, newest first, 20 per page. Complete walks cover small, wide and celebrity. Posting writes one source post and waits for `state: sent`; follower count causes no application write fanout.
- Roster returns all 50 principals in three pages. Unread is exact for hub (50,000), sparse and outsider. It sums maintained room message counts minus membership read ordinals, using the brief's contiguous ordinal model.
- Trending reads the ranking index in likes descending, time descending, key ascending order, filtering the exact requested `(at − D, at]` interval. Stored likes and negative ranking keys update in the same transaction as each like edge. Zero-like posts are indexed from insertion. The old popular post is excluded; 20 new likes and a removal change the answer immediately.
- The seed imported all 1,349 memberships, 99,390 messages, 1,411 follows, 50,000 posts and 98 likes through application mutations. Separate chat and author identity tables are unnecessary because their identities carry no additional facts. No `/seed`, direct database population, application SQL, native Rust, external backend, or client-computed serving answer was used.

## Evidence and timing

The final successful acceptance is `evidence/acceptance-003.log`. It started its own isolated, in-memory dev server, seeded it in **20.409 seconds**, ran all assertions and measurements, and stopped its own process group. Its full duration was approximately **50 seconds**. The preceding successful acceptance seeded in 19.050 seconds. The initial failed client iteration completed a 55.122-second seed before being stopped and corrected.

Each latency mean uses 60 requests after three warm-ups. Final Following first-page means: small **1.195 ms**, wide **6.222 ms**, celebrity **1.030 ms**. Wide/small ratio: **5.205**. Alternating post means: the 900-follower author **3.545 ms**, the five-follower author **1.516 ms**; ratio **2.338**. These are observations on this shared machine, not performance guarantees or gates.

All four compiler invocations, including two failures, retain complete stdout/stderr in `evidence/checks/001.log` through `004.log`, with command and exit status in `run-log.md`. Both successful checks include cost and residency. The final schema has no synced tables; no device proof was attempted or claimed.

## Failures and remaining limits

The installed CLI initially stalled before application startup for roughly nine minutes. Sampling our own process showed only `_dyld_start` and a 96 KiB footprint; the commands later resumed without a package change. This is recorded as an environmental startup observation, not a demonstrated snapback4 defect.

Agent mistakes corrected during development were a local-variable merge selector instead of the required bounded range, arithmetic between `int` and `time`, a guessed package export, a missing query `args` envelope, and lost cursor ownership after grouping. The first acceptance was stopped after its old transport kept requesting the first membership batch. Its failure and original output remain preserved. An optional meter-sampling request after final acceptance found that its server had already been cleaned up; no measurement from that request is claimed.

The checker retains **N_WIDE_MERGE** and **N_SPARSE_FILTER**. Following work grows with followed-author lanes; unread and follow discovery use a chosen 4,096-row range. Larger accounts, or other work near the default 8,192 examined-row meter, can produce incomplete answers. Those operations do not promise arbitrary account scale. Search avoids the all-membership merge, but each matching scope still has the package's 32-word expansion bound; broad prefixes or expensive filters can cut a batch without a safe result continuation. Consumers must preserve that failure rather than advance and claim completion.

Trending's global ranking index can encounter many out-of-window posts before finding ten eligible ones. The fixed seed and acceptance changes fit; arbitrary windows with enough excluded high-ranking posts can hit the meter and need continuation, so an exact first top-ten page is not guaranteed for every possible population. There is no scheduled rebuild or score lag in the tested design.

The schema uses 80-character logical keys, 4,000-character bodies, 100-character search inputs and 100-input mutation batches. These are explicit application choices. Stored derived facts are `roomCounts.value`, `posts.likes`, `posts.rankLikes` and `posts.rankAt`; there is no per-principal unread counter or per-reader message/feed copy. Posts have public reads and an allow update rule so likes can update another author's ranking; the exposed mutations constrain those updates. Seed mutations require `dev:seed`. Live cursor walks are not multi-request snapshots and should restart after concurrent membership changes.
