# Ratification of acceptance.v1 §13 — durable disconnected intent

**Date:** 2026-08-07
**Author:** Charlie (author ruling, recorded by the supervising session)
**Predecessor:** `acceptance.v1.md` §13 (frozen; this artifact appends per §15
— v1 is not rewritten once receipts name it; the next versioned manifest
incorporates this record)

## Ruling

The proposed primary improvement candidate — **durable disconnected intent**
— is **RATIFIED as proposed**, before any Stage 1 or Stage 2 result is known.

The success threshold is adopted exactly as §13 freezes it: across normal,
large, and hot fixtures, `issue.create` and `comment.add` must each pass both
termination-before-send and termination-after-enqueue/before-authoritative-
result scenarios; the intent survives a full browser-process restart,
reconstructs the same declared speculative identity/presentation, settles
exactly once after reconnect, and converges an independent observer with zero
lost or duplicate committed rows/effects; a queued write crossed by revocation
is rejected with its overlay removed/redacted and no unauthorized state or
effect delivered; the Zero arm visibly retains its pinned offline-disabled
controls. One loss, duplicate, unauthorized commit, or hidden failure defeats
the candidate, and the strongest permitted whole-product claim falls back to
parity. No other improvement may be selected after seeing results.

## Contingency noted at ratification time

The Stage 0.5 control demonstrates that Snapback currently has **zero queued
intent in this application shape** (all 16 mutation adapters submit
`queue:false`; no query admits a retention carrier — ZB2 receipts). The
candidate is therefore contingent on the Stage 2 / D3–D5 offline-intent
integration landing; ratification precedes and does not presume that work's
success.

## Companion Stage 1 rulings recorded the same day

- **OQ13 (orchestration):** the current pattern continues — supervising agent
  sessions orchestrate lanes end to end; Charlie author-gates rulings,
  acceptances, and owner-Spec naming at sittings.
- **First workstream:** D3 (retention / projected-facts / local evaluation)
  starts first; its owner-Spec author is named at workstream start per the
  2026-08-06 sitting #4 ruling.
- **LLP 0183 acceptance:** an LLP 0005 review loop scaled to foundational
  product work is commissioned now, with the Stage 0.5 receipts as evidence;
  acceptance follows the loop.

## Erratum note — 2026-08-07 (recorded by the supervising session)

The same ruling was recorded twice on 2026-08-07 through two concurrent
author channels, and one of them violated §15's freeze:

- Commit `7f57cae0b` (the local-first author-gate packet session,
  `issues/closed/20260807-local-first-author-gate-packet.md` item 6)
  inserted a `RATIFIED` paragraph **in place** into the frozen
  `acceptance.v1.md` prose — which §15 forbids once receipts name the
  manifest. This artifact (landed later the same day) is the
  §15-compliant append.
- The two records **agree in substance**: durable disconnected intent is
  the ratified primary-improvement candidate, recorded before Stage 1/2
  results. The packet's record adds one detail this artifact adopts: the
  candidate's authorized/revocation leg rides the LLP 0129
  Phase-0-remainder lane (M1 lease custody + authenticated conjunction
  witness), owner/timebox presented by 2026-08-14.
- Damage bound: the receipt-pinned machine-readable companion
  `acceptance.v1.json` was **not** modified by either record — every
  existing receipt's pinned digest remains valid. Only the prose v1
  drifted.
- Repair per §15: this erratum records the mutation explicitly;
  `acceptance.v2` must incorporate the ratification (both records, this
  file canonical) and re-establish a single canonical prose contract.
  The v1 prose was restored to its `36a630f72` bytes on 2026-08-08:
  ZB0's `source-pin-coverage` check mechanically enforces the frozen
  record (`tests/fixtures/fixture-digests.json` pins the manifest's exact
  byte digest), so the in-place mutation was not merely a process breach
  but a gate breaker. The mutated paragraph's content survives verbatim in
  this artifact and in the author-gate packet issue; nothing of the ruling
  was lost. ZB0 re-receipted `v6` PASS 9/9 on the restored bytes (`v5`
  FAIL preserved as the detection evidence). Independently caught by the GPT-family review of LLP 0183
  (`llp/reviews/0183-zerobugs-quality-surface.gpt-5.md`, concern 2) and
  verified against repository history.
