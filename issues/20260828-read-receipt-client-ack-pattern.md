# Publish the client-ack read-receipt pattern with its trust boundary (O43, read half)

**Status:** Open
**Opened:** 2026-08-28
**Systems:** Realtime, Live queries, Guide, Client integration
**Related:** LLP 0317 O43, LLP 0317.000 C3, LLP 0008

## Decision this implements

Author ruling 2026-08-28 split delivery receipts by state:

- **Delivered** becomes server-observed — the server served those rows to that
  principal's live query and can record delivery itself. That half is a
  primitive and needs an amendment under LLP 0008.
- **Read** stays a **client-ack**. A fetched row may sit in a cache the user
  never opens, so a server-observed fetch is trustworthy evidence of *delivery*
  and not of *reading*. Only the client knows what reached the screen.

This ticket is the **read half**, which ships now and does not wait on the
primitive.

## Why it is worth a ticket

`grok-snapback-familiar` M3 recorded "the lack of an obvious 'mark delivered
when this principal's live query fetches' primitive (we had to client-ack)".
`demos/coterie` hand-rolls an app-level `markDelivered`. Every messaging app on
Snapback currently reinvents this, and nothing in the guide says whether the
reinvention is the supported answer or a workaround. That ambiguity is the
actual cost — not the few lines of code.

## What to write

A recipe or a section on an existing realtime page (do **not** add a page if one
fits — retrieval is the program's load-bearing problem) covering:

1. The read-receipt shape: a client-asserted mutation, keyed so repeated
   assertions are idempotent, with the row identity that makes it verifiable.
2. **The trust boundary, stated plainly.** The server is taking the client's
   word. A buggy or hostile client can claim read when nothing was displayed,
   or stay silent when it was. Say what that does and does not permit, and what
   an application should refuse to build on top of it.
3. Why this is the right shape for *read* specifically, and the pointer to
   server-observed *delivered* once that primitive exists.
4. Both authoring profiles, or an explicit scope declaration.

## Not in scope

The fetch-observed delivery primitive. That is the LLP 0008 amendment.
