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
