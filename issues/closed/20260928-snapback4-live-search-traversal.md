# Snapback 4: live search traversal contract and combined boundary

Status: Closed
Date: 2026-09-28
Resolved: 2026-09-28, lane OS round 6
Scope: ordinary search continuation, LLP 3000.028 §3.3/§7.2

The supervisor decided that continuation is live keyset pagination over
`(order key, id)` across the combined currently visible domain: current server
scopes plus the device's retained images. It is not a snapshot. An order edit,
match change or insertion before the consumed position can repeat or skip that
changed row, as on a single server source. Exactly-once holds for rows whose
order, match, scope and readability remain stable. Declare the order column
`immutable` (usually message `at`) for exactly-once over edits. Reactive page
ranges are a possible future design, outside this contract.

The decision is recorded in [LLP 3000.028 §3.3](../../llp/3000.028-one-query-online-or-offline.rfc.md#33-one-body-per-search-scope-and-two-platform-plans).
The round-5 oracle's whole-changing-corpus guarantee was stronger than that
contract. The refined oracle instead checks each exact page against independent
server/acquired-image maps and the combined consumed position, preserving stable
exactly-once, terminal keyset completeness, no disclosure, identity withdrawal,
order, one invocation and no empty dead end. Existing explicit cut limits remain.

It also found a real composition bug: seed 159 inserts a server match at 107
after the combined descending page consumed 100; separate source positions
incorrectly admitted it into page two. The SDK now seeks the combined boundary
on both sources. Four named first/last × process/wasm regressions fail before
repair and pass afterward. Unconsumed rows after that boundary remain eligible.
The shared SDK usePage accumulator now keys by ID, keeping the newest observed
image and preventing permitted repeats from rendering twice. Metadata-only
revalidation cannot promote an old image. The compiled search card gives the
contract and immutable advice.

Evidence: **300/300 mixed seeds per host**, process and wasm, plus **22/22
additional current-only differential schedules per host / 194 identical pages
each**. The 24 old failures all pass, for the specific reasons below. Named
regressions, the 134 affected JavaScript cases (including mounted React), 73 OS
Rust tests, 17 EQ integration tests and 93 whole-guide tests pass. No seed is
skipped or xfailed. The round-6 [report](../../snapback4/reports/20260928-os-ordinary-search/REPORT.md)
records exact commands, raw logs, full-suite result, wasm size and all failure
classifications. Wasm remains over the unchanged budget; the supervisor owns
that landing decision and it does not reopen this semantic issue.

| Old seed | Process / wasm | Reason under the decided contract |
| --- | --- | --- |
| 3 | PASS / PASS | New match new1 inserted before the consumed position. |
| 28 | PASS / PASS | m00004 moves from at=20 to 279 and may repeat. |
| 46 | PASS / PASS | m00010 moves before the consumed position (at=143). |
| 88 | PASS / PASS | Mutable-scope fallback moves m00003 to live and at=76; its repeated ID is not stable. |
| 105 | PASS / PASS | U+10000-prefixed 00022 moves from 110 to 77, before the consumed position. |
| 112 | PASS / PASS | U+10000-prefixed 00001 changes at to 97 and may repeat. |
| 113 | PASS / PASS | New match new4 inserted before the consumed position. |
| 136 | PASS / PASS | New match new3 inserted before the consumed position. |
| 140 | PASS / PASS | New match new4 inserted before the consumed position. |
| 142 | PASS / PASS | U+E000-prefixed 00014 stops matching, then matches again after its position was consumed. |
| 161 | PASS / PASS | m00024 changes at to 24, then 282; its repeated ID is not stable. |
| 178 | PASS / PASS | New match new1 inserted before the consumed position. |
| 181 | PASS / PASS | U+10000-prefixed 00022 changes at to 72 and may repeat. |
| 197 | PASS / PASS | New match new3 inserted before the consumed position. |
| 199 | PASS / PASS | New match new1 inserted before the consumed position. |
| 207 | PASS / PASS | m00016 changes at to 281 and may repeat. |
| 211 | PASS / PASS | New match new3 inserted before the consumed position. |
| 229 | PASS / PASS | m00006 changes at to 253 and may repeat. |
| 237 | PASS / PASS | m00024 moves from at=120 to 7, before the consumed position, with sync. |
| 246 | PASS / PASS | m00004 changes at to 166 and may repeat. |
| 250 | PASS / PASS | m00016 changes at to 117 and may repeat. |
| 260 | PASS / PASS | New match new3 inserted before the consumed position. |
| 267 | PASS / PASS | New match new2 inserted before the consumed position. |
| 292 | PASS / PASS | U+10000-prefixed 00022 changes at to 22 and may repeat. |

The historical round-5 report and original failing action traces remain in
[ROUND5.md](../../snapback4/reports/20260928-os-ordinary-search/ROUND5.md) and its
round5 directory. Reproduce all current seeds from snapback4 after the ordinary
builds with `node --test packages/snapback4/test/ordinary-search-oracle.test.mjs`;
`SB4_SEARCH_SEEDS=159` isolates the newly repaired composition case.
