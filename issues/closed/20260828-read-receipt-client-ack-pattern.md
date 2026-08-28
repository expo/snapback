# Publish the client-ack read-receipt pattern with its trust boundary (O43, read half)

**Status:** Closed
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

## Resolution (2026-08-28)

Shipped as [`guide/recipes/read-receipts.md`](../../guide/recipes/read-receipts.md),
a new recipe page. A section on an existing realtime page was considered and
rejected: no existing page fits — `realtime/live-queries.md` owns the live-query
surface and `backend/mutations.md` owns the write boundary generally, while
this is a composed schema + mutation + projection pattern, which is what the
recipes section is for. It is linked from `guide/index.md`.

All four required elements are covered:

1. **The shape** — one durable row per (message, recipient), a numeric
   `statusRank` so the advance is monotonic and repeated assertions are
   idempotent by construction, a unique `by_message_recipient` index making
   "one receipt per recipient per message" a storage invariant, and a bounded
   watermark (`markReceiptsThrough`) for the open-a-thread case. Every snippet
   is a transcluded-verified excerpt of `demos/coterie`.
2. **The trust boundary** — its own section, stated first, before the
   technique. It names what the server *can* verify (authenticated caller,
   caller is the recipient the row names, current membership, forward-only
   advance) and what it cannot, and enumerates what an application must not
   build on it: proof of receipt, access decisions, entitlement consumption,
   billing, compliance controls. The rule of thumb is explicit: *if a lying
   client would gain something, a read receipt must not be the gate.*
3. **Why read specifically** — with the pointer to server-observed *delivered*
   and to what does not substitute for it (`hasFreshClient`, sender-side
   receipt insertion, mutation settlement).
4. **Profile scope** — `authoring-profiles: [explicit]` with an explicit scope
   section naming the Familiar spelling difference and routing to
   `backend/familiar-profile.md`. The worked source is Explicit; the design
   carries over but the spelling does not, so a dual-profile claim would have
   been false.

Retrieval-eval seed case 136 pins the route with the lane's own vocabulary
("mark delivered when this principal's live query fetches") and the required
guidance, so the fix cannot silently regress.

**Follow-ups filed:**

- `issues/20260828-server-observed-delivery-primitive.md` — the delivered half
  (LLP 0008 amendment / LLP 0317 C3), which this ticket held out of scope. It
  also records that a `realtime.delivery-receipts` GAP row could not be added
  to `guide/capabilities.md`: the index sits effectively at its enforced
  63,488-byte entry-tier budget, leaving no room for an honest row.

**One deliberate departure from the demo.** `demos/coterie` declares its
`messageReceipts` table `public-read` for the same-principal reentrancy
workaround tracked as LLP 0317 O17. The recipe transcludes the fields and
indexes but not that line, and says plainly that receipts should be owner- or
membership-scoped — the demo's visibility choice is not what this page
teaches.
