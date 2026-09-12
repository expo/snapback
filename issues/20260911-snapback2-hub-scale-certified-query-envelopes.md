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

## Requested outcome and acceptance — corrected 2026-09-12

Implement [LLP 1023.001](../llp/1023.001-hub-scale-certified-reads.plan.md)
without changing frozen instrument f40559f37722c79178be664a11f8a6485f1508fd.
The earlier requested brief reduction is rejected. The named u0500 probe has
500 follows and 100 conversations; u0001 actually has 100 groups plus 900 DMs.
A 1,000-follow query, 50-row rich page, and 100-row backfill are builder-selected
spellings, not exact required spellings.

Required: a 500-follow+self enriched feed; grouped search reaching all 1,000
memberships; full author/quote/reaction/receipt history through valid smaller
pages; complete server-driven digest across the population. Do not stop discovery
at the first 100 or require an invented client merge. Independent pages carry
independent snapshots and receipts. Final digest emission must exclude currently
revoked, deleted and expired contributions, including changes after earlier
chunks, and remain logical-once across restart. A documented gap leaves this
ticket open.

The historical refusal numbers above remain observations from the named apps,
not universal platform ceilings. The 256 live-shape limit is subscription
admission, distinct from certificate heap/output/closure limits.

## Current-source investigation — 2026-09-12

The rich message schema retained from the 0.0.25 app was copied into the existing
quarry-fanout-guide fixture. Current-source probes, without ceiling changes:

| Form | Current certificate outcome |
| --- | --- |
| Original-media 500-follow+self enriched feed, last 20 | closure 3,428,749; heap 4,216,301; output 90,652: admitted after retained-merge repair f7273a41f6 |
| 1,000-lane message search, last 20 | heap 20,407,874; closure 17,543,326: refused |
| Rich 50 with author, quote, 50 reactions and 50 receipts | output 4,178,012: refused |
| Membership page 10, one search preview per group | closure 344,839; heap 393,355: admitted |
| Separate per-chat search page 20 | closure 245,232; heap 271,124: admitted |
| Full rich page 5 | closure 417,345; heap 1,724,224: admitted |
| Existing same-transaction digest enlarged to 1,000 memberships | heap 12,525,666; closure 13,748,664: refused |
| Digest maintained key reduced to membershipId,periodStart | heap 9,922,666; closure 8,683,664: refused |

The compact-key reduction preserves selection but is insufficient. Its public
count absence reserve alone is 2,531,718 bytes. System visibility and persisted
contributions cannot by themselves establish final eligibility. Existing
periodUnread contributions require deletion/expiry maintenance as well as
membership-incarnation checks.

Executed consumer result: the existing real-owner test passes in 27.096 seconds
(28.431 seconds including the harness). It covers the original enriched feed,
all 1,000 memberships after 99 empty slices and a final-slice-only match, 125
tied-time messages through distinct message cursors, full rich continuation,
warm/cold held reads, live insert/edit/delete boundary rebuilding and membership
revocation. The shipped fanout card's grouped-search consumer is executed
verbatim. All 18 affected compiler fanout checks plus packaged guide discovery
pass; the package builds with 97,853 / 98,304 guide bytes.

Digest keeps this ticket open. An executed negative witness closes both clients,
completes the old 500-follow accumulation, deletes one contributing post, and
restarts the owner. Its maintained source count becomes zero, while the cached
total remains 500 and the job remains done. This does not qualify final emission.

The retained app's compact authored counters do not resolve that gap:
periodUnread has no expiry provenance; clearSeat removes only the current and
previous periods, without a period cap covering paused older work. Cached
postDigestContribution values need final deletion/expiry validation. Current
[writer_timers.rs](../snapback2/crates/snapback2/src/writer_timers.rs) processes at
most 64 due timers before [writer_jobs.rs](../snapback2/crates/snapback2/src/writer_jobs.rs)
runs a job chunk, without proving that all due expiry work has drained. Thus
timer-driven decrement alone cannot establish exact eligibility at emission.
This is source evidence for the remaining expiry gap, not an executed expiry
qualification. No new read model, ceiling or reduced population is selected.

Precise source/probe/log locations and cost terms are in the child plan's
implementation record. Publication and the full Clique wave remain separate
work; the digest requirement is still unmet.
