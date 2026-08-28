---
title: "Recipe: read receipts (client-ack)"
id: recipes.read-receipts
order: 17
audience: agent-first
capabilities: [backend.functions]
authorities: [llp/0008-local-first-sync-and-realtime.rfc.md, llp/0004-application-data-api.rfc.md, llp/0108-inline-handlers-and-result-contracts.spec.md, llp/0317-clique-0129-correction-loop-disposition.research.md, demos/coterie/snapback/schema.mjs, demos/coterie/snapback/functions.mjs, demos/coterie/snapback/acceptance-m3.test.mjs]
examples: [demos/coterie]
status: current
targets: [local]
maturity: shipped
authoring-profiles: [explicit]
reviewed: 2026-08-28
reviewed-authorities-digest: sha256:33603a0cf474b0ca6f97ec1d7761bd02e2ca7494d727c5ae3e1f01cfe5272556
---

# Recipe: read receipts (client-ack)

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](../auth/targets.md).

A **read receipt** — "seen", "read 4:12", "mark as read", the second blue
tick, the unread badge that clears — is a **client-asserted mutation**. The
recipient's client calls a mutation saying "this reached my screen", and the
server records that claim against a row it has verified the caller is the
recipient of. This is the supported answer, not a workaround: hand-rolling it
is expected, and this page is the shape to hand-roll.

Snapback deliberately has no server-observed *read* fact, and cannot have one.
A row the server served may sit in a cache the user never opens. Only the
client knows what was displayed. That splits the two states an app usually
calls "receipts" (author ruling 2026-08-28, LLP 0317 O43):

| State | Who can witness it | Where it stands |
| --- | --- | --- |
| **Delivered** | the server — it served those rows to that principal's live query | no primitive yet; see [Delivered is a different problem](#delivered-is-a-different-problem) |
| **Read** | only the client | this recipe |

The complete working reference is `demos/coterie`; every snippet below is an
excerpt of its backend or its acceptance suite.

## The trust boundary, stated plainly

**The server is taking the client's word.** A read receipt is evidence that
*some client holding the recipient's credential ran a mutation*. It is not
evidence that a person saw anything.

- A buggy client can fail to acknowledge a message that was displayed for a
  minute; the row simply keeps whatever state was last asserted — which is
  itself only ever a client's assertion.
- A hostile — or merely modified — client can acknowledge every message in a
  conversation without rendering one, or never acknowledge anything.
- Neither case is detectable server-side. The server can see perfectly well
  *that* a mutation ran or did not run; what it cannot see is whether the
  claim that mutation carries is true.

What the server *can* verify, and what §3 makes it verify, is narrower and
still worth having: that the caller is authenticated, that the caller is the
recipient the receipt row names, that the message exists in a conversation the
caller is currently a member of, and that the receipt only ever moves forward.
Those checks stop one recipient forging another recipient's receipt. They do
not make the claim itself true.

So a read receipt may carry a **product affordance**: blue ticks, "seen by 3",
an unread badge, a scroll-to-first-unread anchor, engagement analytics with a
stated error bar.

It must **not** carry any of these:

- **Proof of receipt or non-repudiation.** Do not build a delivery-confirmation
  or acknowledgement-of-terms flow on a client-ack. A recipient who denies
  having seen something is not contradicted by their own client's assertion.
- **Proof of *non*-reading.** The absent ack is as untrustworthy as the present
  one. "The notice was never opened", "they have not seen the warning", an
  unread-terms gate — a silent client and a client that never displayed
  anything are the same record.
- **An access decision.** Never revoke, expire, or delete on a read-ack. A
  client that simply never sends the ack keeps its access forever if the ack is
  the gate, and a client that already fetched the bytes keeps them regardless.
  Revocation is server-side: see the
  [view-once media recipe](./view-once-media.md), which uses `grants: true`,
  an `owner-only` read policy, and `private-strict` delivery so that close or
  delete denies the *next governed byte request*.
- **Entitlement consumption or billing.** "The recipient used their one view",
  "charge on open", "burn after reading" — all of these pay a lying client.
- **A compliance or safety control.** Anything an auditor or a moderator would
  rely on needs a server-observed fact, and this is not one.

The rule of thumb: **if a lying client would gain something, a read receipt
must not be the gate.**

## 1. Store one receipt row per (message, recipient), created on send

The receipt is a durable row, not a flag on the message, because the state is
per recipient and a group message has many. Give it a rank alongside its
status so §2 can compare monotonically, and index it so the acknowledging
client can find its own row in a bounded lookup:

```js source=demos/coterie/snapback/schema.mjs
    messageReceipts: defineTable({
      ownerId: v.principal(),
      conversationId: v.id('conversations'),
      messageId: v.id('messages'),
      recipientMemberId: v.id('conversationMembers'),
      recipientProfileId: v.id('profiles'),
      status: v.string(),
      statusRank: v.integer(),
      deliveredAt: v.optional(v.integer()),
      readAt: v.optional(v.integer()),
    })
      .index('by_message', ['messageId'])
      .index('by_message_recipient', ['messageId', 'recipientMemberId'], { unique: true })
      .index('by_recipient_message', ['recipientProfileId', 'messageId'])
      .index('by_conversation_recipient', ['conversationId', 'recipientProfileId'])
```

The rows are created by the **sender's** mutation, one per recipient, at
rank 0. This is the identity half of the pattern and it is not the same thing
as the sender asserting a state on the recipient's behalf: `sent` means "this
recipient owes a receipt", which the sender does know.

```js source=demos/coterie/snapback/functions.mjs
  for (const recipient of recipients) {
    await ctx.db.insert('messageReceipts', {
      ownerId: recipient.ownerId,
      conversationId: conversation._id,
      messageId,
      recipientMemberId: recipient._id,
      recipientProfileId: recipient.profileId,
      status: 'sent',
      statusRank: 0,
    });
  }
```

Without this insert every acknowledgement in §3 refuses — the handler looks the
row up, it does not create it.

Three identity notes:

- The unique `by_message_recipient` index on `(messageId, recipientMemberId)`
  is what makes "one receipt per recipient per message" a storage invariant
  rather than handler etiquette.
- `by_recipient_message` on `(recipientProfileId, messageId)` is the
  acknowledging client's own lookup, and it is **not** unique — a principal who
  left and rejoined can hold more than one membership incarnation for the same
  message. Read it bounded (`.take(2)`) and then check the current membership,
  as §3 does. Do not treat it as a point read, and do not conflate the member
  id with the profile id.
- Receipt rows are read by the *sender* to render aggregate state, so their
  visibility is a design decision, not a detail. Prefer owner or
  membership-scoped visibility over `public-read`. Coterie's own table is
  `public-read` for an unrelated reason (its same-principal reentrancy
  workaround, LLP 0317 O17, whose confidentiality cost is tracked there) and
  that part of the demo is **not** what this recipe teaches — see
  [protecting data](../auth/protecting-data.md) for membership-scoped reads.

## 2. Advance monotonically so repeated assertions are idempotent

Clients retry. Offline queues replay. A recipient opens the same thread on two
devices. Every one of those produces a duplicate assertion, so the write must
be **idempotent by construction**: compare the current rank against the target
rank and do nothing when the receipt has already reached it. Timestamps are
stamped once, on the transition, never overwritten:

```js source=demos/coterie/snapback/functions.mjs
async function advanceReceipt(ctx, message, receipt, membership, targetStatus, targetRank) {
  const currentRank = effectiveReceiptRank(message, receipt, membership);
  if (currentRank < targetRank) {
    const now = ctx.runtime.now();
    await ctx.db.patch('messageReceipts', receipt._id, {
      status: targetStatus,
      statusRank: targetRank,
      ...(targetRank >= 1 && receipt.deliveredAt == null ? { deliveredAt: now } : {}),
      ...(targetRank >= 2 && receipt.readAt == null ? { readAt: now } : {}),
    });
    if (targetRank >= 2) {
      await ctx.db.patch('conversationMembers', membership._id, {
        unreadCount: Math.max(0, membership.unreadCount - 1),
      });
    }
    return targetStatus;
  }
  return receiptStatusForRank(currentRank);
}
```

This is why the row carries `statusRank` and not only `status`: monotonicity
is a numeric comparison, so a late-arriving `delivered` can never demote a row
that is already `read`.

## 3. Mark one message as read: derive the asserter from the session

The mutation's arguments name **only the message**. The recipient identity
comes from `ctx.auth` by way of the caller's profile, and the handler then
proves that the caller is the recipient this receipt names before it writes.
A client that passes someone else's message id gets a declared refusal, not a
forged receipt:

```js source=demos/coterie/snapback/functions.mjs
export const markRead = defineJsMutation({
  auth: 'authenticated',
  args: { messageId: v.id('messages') },
  result: receiptMutationResult,
  reads: ['profiles', 'conversations', 'conversationMembers', 'messages', 'messageReceipts'],
  writes: ['conversationMembers', 'messageReceipts'],
  refusals: [
    'PROFILE_REQUIRED',
    'CHAT_NOT_FOUND',
    'CHAT_MEMBERSHIP_REQUIRED',
    'MESSAGE_NOT_FOUND',
    'MESSAGE_RECEIPT_NOT_RECIPIENT',
  ],
  handler: async (ctx, args) => {
    const viewer = await requireMyProfile(ctx);
    const message = await ctx.db.elevated.get('messages', args.messageId);
    if (!message) ctx.refuse('MESSAGE_NOT_FOUND');
    const conversation = await ctx.db.elevated.get('conversations', message.conversationId);
    const access = requireActiveChatAccess(
      ctx,
      await chatAccessForProfileConversation(ctx, conversation, viewer._id),
    );
    const receipts = await ctx.db
      .query('messageReceipts')
      .withIndex('by_recipient_message')
      .eq('recipientProfileId', viewer._id)
      .eq('messageId', message._id)
      .take(2)
      .collect();
    const receipt = receipts[0];
    if (!receipt || receipt.recipientMemberId !== access.membership._id) {
      ctx.refuse('MESSAGE_RECEIPT_NOT_RECIPIENT');
    }
    return {
      status: await advanceReceipt(ctx, message, receipt, access.membership, 'read', 2),
    };
  },
});
```

`MESSAGE_RECEIPT_NOT_RECIPIENT` is the load-bearing refusal. An argument-shaped
`recipientId` would make the whole pattern forgeable across principals, which
is a different and much worse failure than a client lying about its own state.

## 4. Clear a whole thread with a bounded watermark (mark as read, unread badge)

Marking one message at a time is one mutation per unread message when a user
opens a busy thread. The paved shape is a per-membership **watermark**: two
sequence fields on the membership row, `deliveredThroughSequence` and
`readThroughSequence`, folded into the effective rank of every message at or
below them. One write clears the whole backlog.

```js source=demos/coterie/snapback/functions.mjs
function effectiveReceiptRank(message, receipt, membership) {
  let rank = receipt.statusRank;
  if (message.sequence <= membership.deliveredThroughSequence) rank = Math.max(rank, 1);
  if (message.sequence <= membership.readThroughSequence) rank = Math.max(rank, 2);
  return rank;
}
```

This fold is the reason §2's advance takes the *maximum* of the receipt's own
rank and the rank the watermark implies: neither path can demote the other, in
either order. It also means **the sender's aggregate must be computed from the
folded rank, never from `receipt.status` or `receipt.statusRank` directly** —
a row cleared by a watermark still reads `sent` on its own.

The fold only holds because `message.sequence` and the watermark are the same
conversation-scoped counter. Keep them that way.

Two limits worth stating before you copy it:

- **Coterie's `markReceiptsThrough` always watermarks through the current
  conversation head.** It takes `{ conversationId, state }`; the caller does
  not choose N, and there is no chunked or partial form.
- **The ceiling is an admission bound on the membership, not on this write.**
  The mutation writes exactly one row, the membership. Admission is decided
  from `membership.receiptCount` — the messages this member owes a receipt for
  in the current incarnation — against a limit the application declares, and a
  membership above it is refused `RECEIPT_ENVELOPE_EXCEEDED`, so the bulk path
  is unavailable for exactly the largest backlogs. Per-message `markRead` is
  then the only route. Decide that boundary deliberately; do not discover it.

```js source=demos/coterie/snapback/functions.mjs
export function receiptEnvelopeMessageLimit() {
  return 1_024;
}

export function receiptEnvelopeAdmits(receiptCount) {
  return Number.isSafeInteger(receiptCount)
    && receiptCount >= 0
    && receiptCount <= receiptEnvelopeMessageLimit();
}
```

**One consequence to design around:** the watermark records *state*, not a
per-message time. It never stamps `readAt`, and once it has raised a message's
effective rank a later `markRead` is a no-op, so `readAt` stays null. A product
that wants "read 4:12" on an individual message needs the per-message
acknowledgement in §3 for the messages it wants a time for, and cannot recover
one from the bulk path afterwards.

## 5. Prove idempotence and monotonicity in the acceptance suite

Two of the load-bearing properties are cheap to pin on the mutation's own
result: a repeated assertion is a no-op, and a lower-ranked assertion arriving
after a higher one does not demote the row.

```js source=demos/coterie/snapback/acceptance-m3.test.mjs
    assert.equal((await bob.client.mutate(api.markDelivered, { args: { messageId } })).result.status, 'delivered');
    assert.equal((await bob.client.mutate(api.markDelivered, { args: { messageId } })).result.status, 'delivered');
    assert.equal((await bob.client.mutate(api.markRead, { args: { messageId } })).result.status, 'read');
    assert.equal((await bob.client.mutate(api.markDelivered, { args: { messageId } })).result.status, 'read');
```

That excerpt pins per-message idempotence and rank monotonicity, and nothing
else. The other properties this page depends on need their own cases: that a
timestamp is stamped once, that the watermark fold produces the sender's
aggregate, and that an over-ceiling membership is refused. Pin the ones your
product actually relies on.

## Delivered is a different problem

A **delivery receipt** — the first tick, "mark delivered" — is a different
problem from a read receipt, and a better-posed one.

**Delivered** is server-observable in principle: the server served those rows
to that principal's live query, so it witnessed the delivery itself and does
not need the client to confirm it. Snapback has no such primitive today. The
fetch-observed delivery primitive is commissioned as an amendment under
[LLP 0008](repo:llp/0008-local-first-sync-and-realtime.rfc.md) (LLP 0317 C3).
There is no *mark delivered when this principal's live query fetches*
primitive, and until one lands, note what does **not** substitute for it:

- `ctx.realtime.hasFreshClient({ principalId })` is *connectedness*, not "this
  query fetched these rows". It is advisory, action-only, and existential
  across devices — see
  [ask whether a principal has a fresh client](../realtime/live-queries.md#ask-whether-a-principal-has-a-fresh-client).
- Inserting "delivered" receipts from the **sender's** write path records that
  the sender wrote, and nothing about the recipient. It is the weakest of the
  available options and was recorded as such (LLP 0317 O43).
- Mutation settlement is not a receipt either. It says the writer's own
  mutation committed, not that a reader observed the result.

Until the primitive exists, an app that needs a delivered state should use the
**same client-ack shape at a lower rank** — coterie's `markDelivered` is
exactly `markRead` with target rank 1 — and should say in its product copy
that "delivered" means *a client acknowledged*, with the trust boundary above
applying unchanged.

## Authoring-profile scope

This page is **Explicit-only**. The worked source is Explicit
(`defineJsMutation`, `refusals: [...]`, the `.withIndex(...).eq(...)` query
builder), and the shape is not spelled identically in Familiar.

The design carries over unchanged — one row per (message, recipient), a
monotonic rank, session-derived identity, a bounded watermark — but a Familiar
author writes it with the `mutation({ args, returns, auth, reads, writes,
handler })` constructor in a top-level module and Familiar's
`withIndex("name", (q) => q.eq(...))` builder. See
[the Familiar TypeScript profile](../backend/familiar-profile.md) for that
spelling. A Familiar worked source for this recipe does not exist yet.

## Anti-patterns

- **Do not take the recipient from an argument.** Derive it from the session.
  An argument-shaped recipient makes every receipt forgeable by every other
  member of the conversation.
- **Do not gate access, deletion, or entitlement on a read-ack.** Silence is
  free for the client. Use server-side grant revocation
  ([view-once media](./view-once-media.md)) when access must actually stop.
- **Do not assert `delivered` or `read` from the sender's write path.** The
  sender's mutation creates the rank-0 identity rows (§1) and stops there. A
  *state* advanced by the sender's own write is a fact about the sender, not
  the recipient — see [Delivered is a different problem](#delivered-is-a-different-problem).
- **Do not read `receipt.status` for the sender's aggregate.** A row cleared by
  a watermark still reads `sent`. Fold the membership watermark in (§4).
- **Do not treat `hasFreshClient` or mutation settlement as a receipt.**
  Neither is a statement about what a recipient observed.
- **Do not overwrite the timestamp on every assertion.** Stamp `readAt` on the
  transition only; retries must not move it.
- **Do not mark one message per mutation when the user opened a thread.** Use
  the bounded watermark and keep the per-message call for the precise case.
- **Do not make the receipt table `public-read` to make the sender's aggregate
  easy.** Scope it and project the aggregate from a query the sender is
  entitled to.
