# Amend LLP 0008 with a fetch-observed delivery primitive (O43, delivered half)

**Status:** Open
**Opened:** 2026-08-28
**Owner:** LLP 0008
**Systems:** Realtime, Live queries, Sync, Guide
**Related:** LLP 0317 O43, LLP 0317.000 C3, LLP 0008,
`guide/recipes/read-receipts.md`

## Decision this carries

Author ruling 2026-08-28 split delivery receipts by state (LLP 0317 O43):

- **Read** stays a client-ack. That half shipped as
  [`guide/recipes/read-receipts.md`](../../guide/recipes/read-receipts.md)
  (ticket `issues/closed/20260828-read-receipt-client-ack-pattern.md`).
- **Delivered** becomes server-observed. The server served those rows to that
  principal's live query, so it witnessed the delivery and should be able to
  record it without asking the client to confirm what the server already saw.

This ticket is the **delivered half**, and it needs an amendment under
LLP 0008 before any implementation. It is a primitive, not a recipe.

## Why it is open

Nothing today expresses "this principal's live query fetched these rows":

- `ctx.realtime.hasFreshClient({ principalId })` is connectedness — advisory,
  action-only, existential across devices, and explicitly not proof that a
  client observed a live event
  (`guide/realtime/live-queries.md#ask-whether-a-principal-has-a-fresh-client`).
- Mutation settlement is the writer's own commit fact, not a reader's fetch.
- The weakest available substitute — inserting "delivered" receipts from the
  **sender's** write path — records the sender's write and nothing about the
  recipient. `sol-snapback-explicit` shipped exactly that at M8
  (`benchmarks/runs/2026-08-27-clique-published-0129-matrix/lanes/sol-snapback-explicit/run-log.md:227`)
  and listed it as a candid gap in its own final report.

Every messaging app on Snapback currently reinvents the client-ack for both
states. The read half is now paved and honest about its trust boundary; the
delivered half is the one where the server actually holds better evidence than
the client and does not expose it.

## What the amendment has to settle

1. **The observation point.** Which serving event counts as delivery — initial
   `live_replace`, a delta that carried the row, a poll-lane act, a resumed
   materialization replay — and which of those are equivalent.
2. **Identity and granularity.** Delivery is per (principal, row) at minimum;
   whether it is per (principal, device/`clientStoreId`, row) is a design
   choice with retention consequences.
3. **Durability and cost.** A fetch-observed fact that survives restart is a
   write on every read path. The amendment must state what is retained, for how
   long, and what the ceiling refuses — the durable client-mutation ledger's
   saturation behaviour (LLP 0317 O53) is the cautionary precedent.
4. **Author surface.** Whether delivery is readable as a query result, a
   generated projection, or an explicit subscription, and in which authoring
   profiles.
5. **Honest boundary.** Server-observed delivery is more *trustworthy* than a
   client-ack but not more *semantically accurate*: a delivered row may still
   sit in a cache nobody opened. The amendment must say so, because the read
   recipe now routes readers here for the stronger fact.

## Custody note

A `realtime.delivery-receipts` **GAP** row naming this gap belongs in
`guide/capabilities.md`, and it could not be added: the capability index is
effectively at its enforced entry-tier budget
(`CAPABILITIES_SIZE_BUDGET_BYTES = 63488` in `scripts/guide-lib.mjs`; the index
measured 63,486 bytes on 2026-08-28 and 63,352 after that day's compaction), so
there is no room for a row carrying an honest What/Aliases/Witness. Custody therefore lives in this ticket and in
`guide/recipes/read-receipts.md`. Add the row when the index is compacted or
the budget is deliberately re-ruled; do not bump the budget for this row alone.

## Not in scope

The read half. It shipped; see `guide/recipes/read-receipts.md`.
