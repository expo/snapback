# snapback2: "delivered" receipts are an application table even though the delivery log already knows when a replica caught up

**Date:** 2026-09-06 · **Area:** snapback2 engine / delivery log (`retain delivered-history`) · **Source:** Clique full run, grok-snapback2 (M3 diary "Missing capability", essay); astra-snapback2 built the same application table

## What happened

Both builders implemented sent/delivered/read receipts as application rows written by the
recipient's client. grok: "no engine-side 'delivered when replica caught up' — receipts are an
application table." Under Playwright's offline toggle the recipient's client never sent its
delivered ack, so the `receipt-sent-delivered-read-transitions` choreography stalled, and the
builder could not close M3. The engine, however, already tracks per-recipient delivery for
`retain delivered-history`; the fact the product needs ("this replica has row R") exists and is
not exposed.

For a platform whose flagship template is chat, delivered-ness is the one receipt the engine can
provide for free and correctly (no client cooperation, no extra write per message). "Read" stays
an application fact.

## Proposed

1. Expose per-recipient delivery watermarks from the delivery log as a readable fact (a
   `delivered` view keyed by recipient and conversation, or a column the client can subscribe to).
2. Update the chat template to use it for the delivered tick and keep read receipts as rows.
3. If this is ruled out of scope, record it in `rules/NOT-DOING.md` with the reason, so the next
   builder does not look for it.

## Disposition — 2026-09-11

**Priority:** P3. **State:** keep open for the explicit scope record, not as an
assertion that a served watermark is a receipt. LLP 1019 requires durable
client acknowledgements because server delivery is not proof a replica
received an event. Real-browser `witness-web --sessions` showed committed
`_delivery.deliveries.ack` intents through the ledger, confirming the
cooperative primitive. That does not satisfy “for free/no client cooperation.”
Close as obsolete only after the ruling is discoverable in the requested
NOT-DOING/guide location (or a replica-observable capability is specified).
