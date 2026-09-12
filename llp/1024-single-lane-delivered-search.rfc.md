# LLP 1024: One-lane delivered-message search — the read saving and write price

**Type:** RFC
**Status:** Draft
**Systems:** Snapback 2 delivery custody, Unicode search indexes, certificates, held search, global-search pager and fanout guide
**Author:** Codex / GPT-6 Astra, for Charlie Cheever
**Date:** 2026-09-11
**Revised:** 2026-09-11
**Related:** LLP 1001, LLP 1012, LLP 1017, LLP 1019, LLP 1020; [search-cost ticket](../issues/closed/20260911-snapback2-global-search-pager-costs-one-request-per-membership.md); [reopened hub-envelope ticket](../issues/20260911-snapback2-hub-scale-certified-query-envelopes.md); [0.0.25 run](../benchmarks/runs/2026-09-11-snapback2-0025-clique-linux/README.md)

## 1. Status and decision requested

Charlie requested the search-cost ticket's own RFC on 2026-09-11.
Implementer for this cost/design investigation: Codex / GPT-6 Astra,
2026-09-11. No implementation of the proposed engine feature is commissioned
by this Draft. The shipped pager remains the interim complete composition;
constant-request global search remains an open capability gap.

A per-recipient search projection could turn membership-sized read fan-out
into one indexed lane. Simply adding `wordPrefixes` to copied delivery rows
cannot fit the current send certificate at the fixture's `body: text <=2000`
and audience cap 50: its additional derivation alone reserves **20,863,641
steps**, against the unchanged 1,000,000 ceiling. Normalizing once does not
make the per-recipient posting writes fit either (§4).

This RFC asks for a later implementation decision between an honestly capped
one-lane scan and an indexed projection with a demonstrated cheaper write
ledger. Neither is an accepted replacement for full current-member search.
The authorization and joiner-history differences in §5 also need resolution.
No new language, grammar, index kind, runtime generator, gate, service or
ceiling increase is selected here. `rules/NOT-DOING.md` retains one data
language and the 2026-09-06 Unicode-search exception; implementation that
expands that scope needs its named doing/not-doing trade first.

## 2. What ships, and what it costs

`createGlobalSearchPager` discovers every scope, fills one descending head per
scope at concurrency 16, and merges the heads by `(at,id)`. It refills a
selected lane before returning even the last row of a page. This is a client
N-way merge of bounded query results, with no combined server snapshot or
receipt. It must recreate the search on term/membership change and preserve
weaker partition states; it does not mount 1,000 subscriptions.

For M memberships, scope width 100, the initial directory/head cost is
`ceil(M/100) + M`; page construction then adds refill requests. This formula
assumes ordinary nonempty scope pages and no retries. `maxScopes: 1000` is a
directory bound, not a bound on arbitrary capped-empty continuations or
repeated searches. Duplicate suppression can also require additional refills.

### Frozen fixture measurement

Measured on 2026-09-12 UTC (2026-09-11 Pacific), on expo-build-1000 / EPYC
9454, Node 24.13.1, installed **snapback2@0.0.25**, over loopback. The retained
0.0.25 replay database contains all **100,015 messages** and hub `u0001` has
**1,000 memberships**. Instrument freeze:
`f40559f37722c79178be664a11f8a6485f1508fd`.

A separate copy of that database and source ran on port 54221. Only the
measurement copy's query shapes changed: `groups.mine` became the guide's
100-row membership projection, and `messages.searchChat` used `last 1`
instead of `last 20`; its membership requirement and schema were retained.
The installed compiler/owner certified those shapes. The shipped pager source
from `13dc20058d` ran with pageSize 20, concurrency 16, maxScopes 1000. An SDK
fetch wrapper counted actual `/api/query` HTTP requests; authentication and
owner startup were outside the measured interval. The measurement made no
application mutations or benchmark-input edits. The copy still contained
100,015 messages at shutdown; only the recorded measurement process group was
stopped.

| Fresh pager / term | Scope pages | Heads | Refills | HTTP queries | First-page wall time | Result |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| `busy`, first counted run | 10 | 1,000 | 20 | 1,030 | 668.764 ms | 20 rows, capped |
| `zzabsent` | 10 | 1,000 | 0 | 1,010 | 575.708 ms | 0 rows, complete |
| `busy`, repeated fresh pager | 10 | 1,000 | 20 | 1,030 | 615.972 ms | 20 rows, capped |

`busy` matches only `g0001`, in scope page ten (`g0001`–`g0100`); the first
message is `mg0001-10000`. Both matching runs have no issues and a continuation.
These are warm-host diagnostic samples, not a cold-machine, production-network
or browser latency qualification. The prior builder's rough ten-second report
is a different implementation/load observation, not the shipped pager's timing.

An illustrative 50 ms request round trip makes the critical path at least
`(10 + ceil(1000/16) + 20) × 50 ms = 4.65 s` for this matching first page,
ignoring server/client work. This is arithmetic, not a measured network claim.
An absent term similarly needs at least 3.65 s. More concurrency cannot remove
the M head requests or the sequential scope/refill dependencies.

Evidence remains at `/home/ccheever/lanes/ticket-search-cost-20260911` on
expo-build-1000: `measure.mjs`, `pager.mts`, `measurement.json`,
`storage-price.json`, copied source and database, owner output and launch pid.
`measurement.json` SHA-256:
`6c50c506965387a27c0eef4a16eda1503199c11c581ae4c7f587cb2ddee647f3`.
`storage-price.json` SHA-256:
`e93e43995e4ce3ee3d499e30f0d78ccfc3f5645ac9ec00d6236688ae1f8c4739`.
The original run artifacts remain untouched at
`/home/ccheever/clique-0025-20260911/lanes/astra-snapback2/scale-instance-retry`.

## 3. Proposed indexed shape: a current projection, not an event search

Conceptually, derive one searchable current-content anchor per
`(recipient, source row, incarnation)`, with index order
`(recipient, wordPrefixes(body), source at, source id)`. A query equality-binds
viewer and the term and selects `last 20`, with one opaque continuation.
This is a proposed data shape, **not executable Quarry syntax**.

Today's `deliveries` has only event metadata and source-row references. It
contains no body; `wordPrefixes` consumes bounded local text columns, not
`messages[.row].body`. The generated catalog fixes its columns and three
indexes. Therefore the ticket's `deliveries[viewer, term] ... by bySearch`
is not a current spelling. Indexing every append-only delivered/changed event
would also repeat messages and retain obsolete search hits. The proposed
current projection leaves the custody event log intact, replaces text on
eligible edits, removes live searchable content on deletion/expiry, and uses
incarnation identity to prevent id reuse resurrecting stale hits.

The existing native index kind can index an engine-derived table: its
`IndexComponent::WordPrefixes` and `search_index::{insert,remove,write_bound}`
work from schema columns, irrespective of who authors the table. There is no
need for another tokenizer, trie contract or query language. However, delivery
catalog/lifecycle lowering must generate and maintain the current projection,
certification must charge every generated application, and the twin must adopt
identical identity/authority semantics. Reusing the index kind does not mean
that derived searchable custody or its cost optimization is implemented.

## 4. Price the write side before selecting it

### Physical amplification on the unchanged Clique data

Native `wordPrefixes` stores a posting at **every distinct word-prefix trie
node used by a row**, not merely one posting per word. It deduplicates shared
prefixes within that row; trie nodes themselves are shared across recipients.
`_search_postings` has a primary key and two secondary indexes.

The frozen group example `mg0001-00001`,
`Busy group coffee signal 00001.`, has 31 scalars, five normalized words,
**26 distinct prefix postings** and 50 original recipients. A derived current
search row per recipient adds **1,300 posting rows per send**, plus 50
projection rows and 1,550 raw text UTF-8 bytes if bodies are copied. With the
existing three posting B-trees that is 3,900 posting B-tree entries, excluding
trie/reference updates, source indexes, delivery events and optional receipts.
Changing searchable text removes the old set and inserts the new set; removing
live content removes its current searchable postings. The certified insert
reserve remains N+1 = 51, while edits/deletes retain the engine's audience A,
not a lowered membership cap (LLP 1019 §4).

Read-only SQLite aggregation over the retained database counts native postings
per source row and multiplies each by its original `kind = delivered` audience:

| Object, across 100,015 messages | Count / raw bytes |
| --- | ---: |
| Original delivered events/current recipient anchors | 680,048 |
| Existing source-message prefix postings | 2,131,401 |
| Additional recipient-projection prefix postings | 16,739,786 |
| Existing source text UTF-8 | 2,728,562 bytes |
| Text UTF-8 if copied into every recipient projection | 20,333,736 bytes |

The 680,048 events are all `delivered` in this snapshot. Per-chat search keeps
its source index, so both indexes together hold **18,871,187 posting rows**
(8.85× the current source posting count), before later edits or new messages.
The new projection's raw text alone adds 19.39 MiB; row framing, keys,
incarnation/custody metadata, B-tree pages and journals add more. These are
counted logical rows/raw UTF-8 bytes, **not measured SQLite file growth**;
shared trie nodes must not be multiplied by the audience. Media bytes are
neither copied nor indexed. Source body lengths have median 27, mean 27.282,
and maximum 42 scalars in this fixture; the accepted schema maximum is 2,000.

### Certificate, not typical input length, decides admission

From the existing native `search_index::write_bound` and
`unicode::normalization_step_bound`, one indexed text field bounded by n costs
for insertion:

`D(n) = 166n + 1028 + ceil(n/32) + 6n + 8(4n)`.

The decomposition/prefix bound is U = 4n. This is a logical upper ledger,
not measured CPU time, scan entries or application write rows. Posting work is
priced through derived steps; scratch is a sequential per-row peak, not 51
simultaneous normalizer heaps.

| Declared bound / reserve | Additional projection derivation steps |
| --- | ---: |
| n = 31, 51 reserved recipients (illustrative smaller schema) | 375,003 |
| n = 2,000, one row: D(2,000) | 409,091 |
| n = 2,000, 51 reserved recipients | 20,863,641 |
| n = 2,000, 50-recipient changed image: remove + insert | 23,654,550 |

The first row is illustrative: narrowing the fixture's 2,000-scalar contract
to its observed message lengths is not a permitted repair. Source-message
index work, ordinary delivery writes/probes, receipts, application writes and
all other meters remain additional. Insert still reserves 51 projection rows
and, with receipts, the existing 51 receipt upserts; private posting writes do
not become 408,000 application `write_rows`. All applicable meters must appear
at the source `deliver` site in any implementation's `check --cost` output.
The derived steps alone already refuse against 1M, independently of the
4 MiB closure, 8 MiB heap and 1 MiB output ceilings.

Normalizing once per source image can reuse pinned token/trie work across the
audience without a second index kind, but does not remove recipient posting
maintenance. Even a new sound ledger retaining only the existing four-step
posting/reference charge for U = 8,000 prefixes × 51 recipients costs
**1,632,000 steps**, before normalization, lookup or ordinary work. Reusing
source postings with a recipient join is a different query plan: arbitrary
hidden/nonmatching candidates cannot be silently omitted from the read bound.
No constant-request, complete-result claim follows from that suggestion.

## 5. Authority and lifecycle obligations

The log's uniform `.recipient = viewer` rule authorizes the viewer's own
**event metadata**. It is not proof that an online content read is allowed.
LLP 1019's inbox still resolves `messages[.row]` under the content rule; LLP
1012's delivered-history retention governs eligible held bodies separately.
A searchable body copy must not become a bypass for either rule. Even a
matching anchor can disclose hidden text, so filtering its body only after
returning the matched anchor is insufficient.

The proposed query must suppress unauthorized hits before returning metadata,
charge those probes/candidates, and retain an honest capped continuation if
visibility is nonuniform. Without a proven uniform body-authority rule this
loses the promised complete top-20 bound. Precomputing active authorization
requires exact membership grant/revoke/expiry maintenance over all affected
history; a 50-member audience cap does not bound messages per conversation.
That additional work is an unresolved part of an indexed implementation.

Offline evaluation may search only the current principal's independently
held, eligible content images and their valid delivery/authority evidence.
An index or another principal's cached row proves nothing. Missing authority,
partial acquisition, pending reindexing or incomplete source ranges must keep
held/partial/capped states; no server-complete receipt is synthesized. Edits,
tombstones, expiry, membership changes and generation adoption invalidate or
replace entries atomically with the existing custody and retention rules.

Finally, new members can read **pre-join history** through the content rule
without original-recipient delivery events (LLP 1019 §5). A delivered-only
index therefore does not cover today's current-member global search. It must
be named as a narrower delivered-history surface, or retain the pager for
missing scopes until a separately certified joiner-history acquisition exists.
No synthetic original audience events may be added to erase that distinction.

## 6. Cheaper option: one capped reverse-time scan

A bounded reverse-time page of the viewer's delivery/current-content anchors
avoids per-recipient prefix postings. Fetch at most B candidate anchors,
resolve authorized source content, and apply the same pinned Unicode token
predicate. Continue from the **last examined candidate**, including an empty
page; never signal exhaustion merely because a page had no matches. Use
source-message time/id ordering, not changed-event arrival order, and suppress
duplicate/event images through the current projection.

This is also a proposal: today's raw event log is ordered by seq/id, and
Quarry has no public word-list/substring substitute for the engine's exact
search predicate. Implementing it must stay in Quarry/typed IR with the
existing search contract; application JavaScript filtering is not a new
certified search lane.

Its per-request read cost is O(B), with no M membership heads; extra storage
can avoid copied text/postings but still needs current anchor/order state and
its lifecycle costs. A first **candidate page** can use one request, while a
term whose first hit is oldest may need `ceil(H/B)` requests across H eligible
anchors. It cannot promise a nonempty first result page in a fixed request
count independent of corpus size. That limitation, plus the same visibility
and pre-join-history obligations, must be explicit in any later implementation.

## 7. Next decision and acceptance

Keep the costed pager as the current paved form. The packaged fanout card and
copyable recipe now disclose its N-way composition, measured query counts and
latency. The plan/close disagreement is reconciled by calling that form
**interim**; the one-lane capability remains open. This investigation does not
reduce the frozen hub, modify the 500-follow feed certificate, or change
per-chat search.

A later implementation must bring an executable certificate at body<=2000,
cap 50, including retained-A edits/deletes and receipts, plus a source-index
reuse design or an explicitly capped-read contract. Existing compiler/core/
consumer tests must cover final-slice matches, zero-hit pages, ordering,
continuation, joins/leaves, hidden-body term leakage, warm/cold held authority,
edits/removals and rollback. Reuse existing proof surfaces and measure the
unchanged fixture; do not add a gate or promise that a Draft has running code.
