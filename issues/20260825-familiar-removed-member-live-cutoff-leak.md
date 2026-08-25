# Removed member's open live client still receives post-removal group messages (Familiar arm, capstone)

**Status:** Open
**Opened:** 2026-08-25
**Systems:** Familiar, Live queries, Auth
**Related:** `benchmarks/runs/2026-08-25-clique-pair-published-0127-capstone/`
(cell 2), LLP 0281 (cutoff assertion), LLP 0234 (roster governance),
`issues/20260820-familiar-live-subscription-contention.md` (adjacent, distinct)

## Problem

In the capstone run's Familiar cell (published 0.1.27, sol-high builder),
the frozen `0.3.4-m8` choreography's
`member-add-promote-remove-leave-and-live-cutoff` failed repeatably: after
a member was removed from a group, that member's **already-open** client
still observed a group message sent after the removal. The builder spent
73 minutes across 29 correction loops trying to enforce the cutoff from
the application side and recorded M3 `aborted` (suite was 7/7 green — the
leak is only visible to the two-client live choreography). Everything
downstream was dependency-blocked, so the Familiar arm terminated at M3.

Evidence: `lanes/familiar/final-report.md` + `run-log.md` + choreography
receipts under the campaign root on `expo-build-450b`
(`/home/ccheever/capstone-0127-20260825/`).

## Why this matters

- The 0.1.25 baseline's Familiar arm went M3-green under the old
  instrument, whose cutoff check was a fixed 500 ms sleep — that green is
  now suspect as a false green on the same behavior. The strengthened
  delivery-progress-bounded assertion (E4 fix round) is what caught it.
- The shape matches the known membership/live-query governance territory:
  a membership revocation must fence deliveries to already-open live
  subscriptions, not just gate new reads. Class R made reads fail-closed
  under roster governance; this is the live-delivery half of that story
  for the Familiar profile.

## Wanted

- Root-cause which layer leaks: does the Familiar profile's live
  subscription re-evaluate membership on roster change (server-side fence),
  or is post-removal delivery to open subscriptions expected and the app
  required to fence (in which case the guide must say exactly how, and the
  capstone builder's 73-minute failure to find that path is a guide gap)?
- A regression at the product level (not just the benchmark choreography):
  removed member with an open live subscription must not observe
  post-removal messages, or must observably transition to a refused/closed
  subscription state.
- Reconcile with LLP 0234 roster governance and the 20260820 contention
  ticket's Wanted #4 acceptance bar where they intersect.
