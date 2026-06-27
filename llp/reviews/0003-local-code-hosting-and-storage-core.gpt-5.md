# Review: LLP 0003 - Local code hosting and storage core

**Reviewed:** `llp/0003-local-code-hosting-and-storage-core.rfc.md` (working-tree revision)
**Family:** GPT-5 (OpenAI)
**Provider/runtime:** OpenAI API via Codex
**Date:** 2026-06-25
**Redacted:** No - reviewed local repo artifacts only.
**Method:** Single-session read-and-critique against LLP 0006-0010; targeted
stale-Valet revisions applied.

## Overall assessment

The vertical slice is correctly scoped: one Rust server, SQLite, generated app
bundle, Ibex execution, and realtime pipeline. The revised context now reflects
what Valet actually taught instead of saying those failures are unrecovered.

## Strengths

- Good separation from LLP 0004: transport is implementation, generated API is
  product.
- The database section already avoids a single read/write connection trap.
- The agent/test surface is treated as core functionality, not polish.

## Concerns

- **C1 - Realtime matcher cost is the first likely scale bend. [High]** The
  document names it, but the prototype must measure it early.
- **C2 - Serialized write boundary plus handler execution can block everything.
  [High]** Valet held the DB lock for full handler execution; Snapback needs
  metrics and timeout honesty from LLP 0009.
- **C3 - Bundle loading must align with security. [Medium]** Raw handler source
  is rejected elsewhere; the local core should not accidentally reintroduce it
  for bring-up.

## Suggestions

- Instrument version allocation, write-lock duration, tailer latency, matcher
  evaluations, and queue depth in the first prototype.
- Treat hook-driven wakeups as a first benchmark, not a later optimization.

## Open questions

- Does the trigger/change-table/tailer shape survive Cloudflare, or is it only
  the local implementation behind a target-neutral seam?
- What retention horizon makes local reconnect useful without unbounded growth?

## Recommended next step

Keep `Draft`. Build the smoke app and realtime pipeline with measurement hooks
before broadening the server's responsibilities.
