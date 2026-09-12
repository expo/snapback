# Snapback 2 hub-scale Clique queries still miss the certified envelope

**Status:** Open
**Priority:** P1
**Date:** 2026-09-11
**Systems:** Snapback 2 Quarry certifier (LLP 1001, LLP 1010 A5 merge), Clique brief envelopes
**Related:** [closed/20260906-snapback2-following-feed-merge-ceiling-under-brief-envelope.md](./closed/20260906-snapback2-following-feed-merge-ceiling-under-brief-envelope.md) (500-follow 20-row merge, resolved); `benchmarks/briefs/social-messenger.md`

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
