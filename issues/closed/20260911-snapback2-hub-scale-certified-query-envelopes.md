# Snapback 2 hub-scale Clique queries still miss the certified envelope

**Status:** Closed
**Priority:** P1
**Date:** 2026-09-11
**Systems:** Snapback 2 Quarry certifier (LLP 1001, LLP 1010 A5 merge), Clique brief envelopes
**Related:** [20260906-snapback2-following-feed-merge-ceiling-under-brief-envelope.md](./20260906-snapback2-following-feed-merge-ceiling-under-brief-envelope.md) (500-follow 20-row merge, resolved); `benchmarks/briefs/social-messenger.md`; LLP 1001 §3; LLP 1010 A5; LLP 1012 §"Indexed held search"

## Symptom

Two independent Astra Clique lanes on published `snapback2@0.0.24` and `0.0.25` (expo-build-1000, 2026-09-11) could not certify the brief’s hub-scale reads. The 500-follow feed fix did **not** cover these envelopes. Builders shipped workarounds (smaller pages, client-side merges, chunked jobs) and still marked M8 green.

| Shape | Refusal (representative) | What compiled |
| --- | --- | --- |
| 1,000-follow Following merge | closure ~6.3–6.7 MiB > 4 MiB (`E_BOUND`) | declared 500-follow envelope |
| 1,000-chat global message search | closure ~16–32 MiB, heap ~20 MiB > 8 MiB | 100-chat server query + client head merge |
| 50-row composite conversation view (author/quote/reactions/receipts) | heap ~18.5 MiB > 8 MiB; 256 live-shape ceiling | 10-row composite; raw history kept at 50 |
| Digest over 500–1,000 follows / 1,000 memberships | heap ~12.7 MiB > 8 MiB and closure 4 MiB | compact per-period cells + chunked emission |
| Directory backfill of 100 | `E_STEPS` ~2.25 M > 1 M | chunks of 25 |

## Evidence

Remote on expo-build-1000:

- 0.0.24: `/home/ccheever/clique-ri-20260911/lanes/astra-snapback2/evidence/m2-bound-1000.log`, `m8-search1000-check.log`, `m8-thousand-memberships-check.log`, `m8-split-digest-check.log`; run-log epochs `1789163102`, `1789170020`, `1789170456`.
- 0.0.25: `/home/ccheever/clique-0025-20260911/lanes/astra-snapback2/evidence/check-m4-composite*.log`, `check-m5.log`, `check-search-batch.log`, `check-search-batch-cursor.log`; run-log epochs `1789163777`, `1789165975`, `1789167250`, `1789168962`, `1789170312`.

Local run records: `benchmarks/runs/2026-09-11-clique-astra-snapback2-0024-linux/`, `benchmarks/runs/2026-09-11-snapback2-0025-clique-linux/`.

Also: `held_search` `E_ARGS_TYPE` and dynamic merge `E_QUARRY_SYNTAX` blocked the 1,000-lane search rewrite; keep those as diagnostic quality on this ticket or split if the envelope work does not need them.

## Requested outcome and acceptance

Decide per row, and write the decision in the refusal **and** the guide:

1. **Certify the brief envelope** (partitioned merge, cheaper examined/closure accounting, or a shipped page+merge-heads recipe that a cold builder finds on the first `E_BOUND`), **or**
2. **Change the brief** so Clique no longer requires a single certified 1,000-lane / 50-row composite / 100-row backfill.

Acceptance: a cold published-package consumer can express the surviving envelope without inventing a client merge under the clock. At least the 1,000-follow merge and the 1,000-chat search must have a documented, compiling form. Close only with a check or guide snippet that would have saved both of tonight’s lanes.

## Resolution (2026-09-11)

The brief and fixed certificate ceilings remain unchanged. `guide fanout` now
records a legal preserving form for all five rows:

- A narrow immutable `postHeads` table makes the viewer plus 1,000-follow lane
  merge certify for 20 winners. Compiled maximums are 48,752 output bytes,
  2,024,488 closure bytes, 1,605,760 heap bytes, and 50,180 steps. The fixture
  includes atomic create/edit/delete custody for post and head rows.
- Global chat search pages the whole current membership directory, fetches a
  certified one-row head from every conversation, and merges/refills those
  heads with the public `snapback2/global-search-pager` export. The helper
  walks all 1,000 scopes, limits concurrency, preserves descending order,
  suppresses duplicates, detects cursor cycles, serializes concurrent `next`
  calls, and propagates the weakest unusable receipt. The installed
  `dist/guide/recipes/global-message-search.ts` recipe binds the generated
  client API, branded cursors, captured term, comparator, pages, and issues.
  Search remains on the original membership-authorized message rows;
  held-search authority was not widened.
- Rich conversation composites use a smaller continued rich page while raw
  history remains independently pageable at 50.
- Digest work uses maintained period cells and a resumable 50-row job chunk.
- Directory backfill uses resumable 25-row chunks through the entire table.

The `E_BOUND` and `E_STEPS` family recipes and merge/work repairs now point to
these population-preserving forms. No frozen benchmark brief or run packet was
changed.

## Validation

- Pinned Node 24.18.0 package build and pack: pass; 32 guide cards,
  97,979/98,304 bytes. The installed recipe is present in the packed file set
  and typechecks through the public client/pager exports against the generated
  fanout fixture API.
- Compiler suite: 307 passed, 0 failed, including the compiling guide fixture,
  installed consumer binding, and pager coverage/order/refill/deduplication/
  cursor-cycle/partial-state tests.
- `cargo test -p snapback2-core --lib -- --test-threads=4`: 187 passed,
  0 failed.
- Published self-reference import `snapback2/global-search-pager`: pass.
- `./ref-check --verbose`: 450 LLP docs, 8,109 refs, 0 errors, 0 unchecked.
- `scripts/caps.mjs` still reports the two inherited Snapback 1 line-cap reds;
  every file changed here is below 1,500 lines.
