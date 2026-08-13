---
title: "Recipe: view-once media with per-recipient access"
id: recipes.view-once-media
order: 8
audience: agent-first
capabilities: [backend.assets]
authorities: [llp/0220-recipient-bound-asset-grants.plan.md, llp/0210-asset-upload-dx-closure.rfc.md, llp/0044-asset-storage-pipeline.rfc.md, src/storage/asset_grants.rs, demos/messaging-snapback/snapback/schema.mjs, demos/messaging-snapback/snapback/functions.mjs, demos/messaging-snapback/tests/acceptance/headless.mjs]
examples: [demos/messaging-snapback]
status: current
targets: [local]
maturity: partial
reviewed: 2026-08-10
reviewed-authorities-digest: sha256:b2f44450f65c94d36f116a994a9586c316339fadc42dc0e20ca51f8c17976f9c
---

# Recipe: view-once media with per-recipient access

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](../auth/targets.md).

Use this recipe for **view once**, a **disappearing photo**, or other
**ephemeral media** that needs independently revocable **per-recipient
access**. It composes an application-owned consumption record with Snapback's
first-class recipient grant edge. The grant surface is claimed only on the
local target, so this page is partial: a hosted deployment must capability-gate
the feature rather than infer support from the local recipe.

Read [Grant and revoke per-recipient access](../backend/assets.md#grant-and-revoke-per-recipient-access)
for the complete operation, authorization, GC, quota, and delivery semantics.
If a target lacks first-class grants or the application needs filterable grant
metadata as product state, use the separately documented
[portable app-owned grant-row fallback](../backend/assets.md#portable-fallback-app-owned-grant-rows).
Do not implement both authority paths for the same recipient.

The registered [`messaging-snapback` demo](repo:demos/messaging-snapback) is
the executable witness. Its
[`headless.mjs` acceptance suite](repo:demos/messaging-snapback/tests/acceptance/headless.mjs)
proves pending and outsider denial, one successful open, repeated and
race-concurrent second-open refusal from product consumption state, strict
denial after close, two-recipient delete-for-everyone, and close-then-delete.

## 1. Send the view-once or disappearing photo

Attach the asset once and keep that typed reference on the message row. The
reference is storage-integrity state: pending grants confer no authority and
do **not** protect the asset from reference GC. Keep a private, owner-visible
`grants` map from `recipientPrincipal` to opaque `grantId` beside it so later
close and delete operations can find only the live edges they own.

The demo's durable model makes those two roles explicit and gives the
consumption record a unique `(message, principal)` identity:

```js source=demos/messaging-snapback/snapback/schema.mjs
export const viewOnceMessages = defineTable({
  conversationId: v.id('conversations'),
  authorPrincipal: v.string(),
  // This typed reverse reference, not the pending grants, protects the asset
  // from reference GC until every recipient has had a chance to open it.
  asset: v.assetRef({ upload: 'viewOnceImageUpload' }),
  // OWNER-VISIBLE liveness bookkeeping: recipient principal -> live grantId.
  grants: v.json(),
  caption: v.string(),
  createdAt: v.integer(),
})
  .index('by_conversation', ['conversationId']);

export const viewOnceConsumptions = defineTable({
  viewOnceMessageId: v.id('viewOnceMessages'),
  principal: v.string(),
  openedAt: v.integer(),
})
  // Product state, not asset state: this is what makes a second logical open
  // refuse even while the first activation remains live.
  .index('by_message_principal', ['viewOnceMessageId', 'principal'], { unique: true });
```

The demo's inspection query deliberately relaxes message policy so its
headless suite can inspect this bookkeeping. That is witness scaffolding, not
the product rule: a real query must keep the grants map owner-visible and let
recipients reach only authorized open/close mutations.

In one authorized owner mutation, attach first, insert the message with its
typed reference, mint one **pending** grant per recipient, and persist the map.
The staged app-row writes and grant operations commit or abort together:

```js source=demos/messaging-snapback/snapback/functions.mjs
export const sendViewOnce = defineJsMutation({
  args: {
    conversationId: v.id('conversations'),
    assetId: v.string(),
    recipients: v.array(v.string()),
    caption: v.optional(v.string()),
  },
  auth: 'authenticated',
  refusals: ['VIEW_ONCE_RECIPIENTS_EMPTY', 'VIEW_ONCE_RECIPIENT_DUPLICATE'],
  result: results.value(v.id('viewOnceMessages')),
  reads: ['conversations'],
  writes: ['viewOnceMessages'],
  handler: async (ctx, args) => {
    const owner = ctx.auth.userId;
    if (args.recipients.length === 0) {
      ctx.refuse('VIEW_ONCE_RECIPIENTS_EMPTY');
    }
    const recipients = Array.from(new Set(args.recipients));
    if (recipients.length !== args.recipients.length) {
      ctx.refuse('VIEW_ONCE_RECIPIENT_DUPLICATE');
    }
    const conversation = await ctx.db.get('conversations', args.conversationId);
    if (!conversation) throw new Error('conversation not found');
    const asset = await ctx.assets.attach(args.assetId, { upload: 'viewOnceImageUpload' });
    const messageId = await ctx.db.insert('viewOnceMessages', {
      conversationId: args.conversationId,
      authorPrincipal: owner,
      asset,
      grants: {},
      caption: String(args.caption ?? '').trim(),
      createdAt: ctx.runtime.now(),
    });
    const grantEntries = [];
    for (const recipient of recipients) {
      const { grantId } = await ctx.assets.grant(args.assetId, recipient, { state: 'pending' });
      grantEntries.push([recipient, grantId]);
    }
    const grants = Object.fromEntries(grantEntries);
    await ctx.db.patch('viewOnceMessages', messageId, { grants });
    return messageId;
  },
});
```

`grants: true` is admission-frozen. Adding it to an upload intent later does
not make already-admitted assets grantable; upload those bytes under the
grant-enabled intent from the start.

## 2. Open ephemeral media exactly once

The recipient's authorized mutation must establish product consumption
**first**, then activate that recipient's pending grant. Verify the caller is
in the private grants map, look up the unique consumption row, refuse if it
exists, insert it, and only then stage `ctx.assets.activate(grantId)`:

```js source=demos/messaging-snapback/snapback/functions.mjs
export const openViewOnce = defineJsMutation({
  args: { viewOnceMessageId: v.id('viewOnceMessages') },
  auth: 'authenticated',
  refusals: ['VIEW_ONCE_NOT_RECIPIENT', 'VIEW_ONCE_ALREADY_CONSUMED'],
  result: results.value(v.boolean()),
  reads: ['viewOnceMessages', 'viewOnceConsumptions'],
  writes: ['viewOnceConsumptions'],
  handler: async (ctx, args) => {
    const principal = ctx.auth.userId;
    const message = await ctx.db.get('viewOnceMessages', args.viewOnceMessageId);
    let grantId = null;
    for (const [recipient, recipientGrantId] of Object.entries(message?.grants ?? {})) {
      if (recipient === principal) grantId = recipientGrantId;
    }
    if (typeof grantId !== 'string') {
      ctx.refuse('VIEW_ONCE_NOT_RECIPIENT');
    }

    // @ref LLP 0220#design-detail-the-recipe-this-plan-pages — product
    // consumption must refuse before activation is staged, so a fresh second
    // open never falls through to SNAPBACK_ASSET_GRANT_STATE_INVALID.
    const consumed = await ctx.db
      .query('viewOnceConsumptions')
      .withIndex('by_message_principal')
      .eq('viewOnceMessageId', args.viewOnceMessageId)
      .eq('principal', principal)
      .first();
    if (consumed) {
      ctx.refuse('VIEW_ONCE_ALREADY_CONSUMED', { openedAt: consumed.openedAt });
    }
    await ctx.db.insert('viewOnceConsumptions', {
      viewOnceMessageId: args.viewOnceMessageId,
      principal,
      openedAt: ctx.runtime.now(),
    });
    await ctx.assets.activate(grantId);
    return true;
  },
});
```

The consumption row is product state, not a substitute spelling of the grant.
A bare second activation refuses separately with
`SNAPBACK_ASSET_GRANT_STATE_INVALID`. A retry with the same mutation
`clientKey` replays the original result. Neither behavior prevents a fresh
second logical open, so the unique consumption check must run before
activation is staged. The unique index also makes concurrent opens settle as
one successful consumption and one application refusal.

## 3. Close one recipient or delete for everyone

These are two distinct verbs.

**Recipient close** revokes only the caller's grant and clears the matching
entry from the owner-visible grants map in the same mutation:

```js source=demos/messaging-snapback/snapback/functions.mjs
export const closeViewOnce = defineJsMutation({
  args: { viewOnceMessageId: v.id('viewOnceMessages') },
  auth: 'authenticated',
  refusals: ['VIEW_ONCE_NOT_RECIPIENT'],
  result: results.value(v.boolean()),
  reads: ['viewOnceMessages'],
  writes: ['viewOnceMessages'],
  handler: async (ctx, args) => {
    const principal = ctx.auth.userId;
    const message = await ctx.db.get('viewOnceMessages', args.viewOnceMessageId);
    let grantId = null;
    for (const [recipient, recipientGrantId] of Object.entries(message?.grants ?? {})) {
      if (recipient === principal) grantId = recipientGrantId;
    }
    if (typeof grantId !== 'string') {
      ctx.refuse('VIEW_ONCE_NOT_RECIPIENT');
    }
    const grants = Object.fromEntries(
      Object.entries(message.grants).filter(([recipient]) => recipient !== principal),
    );

    // @ref LLP 0220#design-detail-the-recipe-this-plan-pages — revoke removes
    // the system edge, so clearing its id in the same mutation keeps a later
    // owner delete-for-everyone from staging an unknown-grant refusal.
    await ctx.assets.revoke(grantId);
    await ctx.db.patch('viewOnceMessages', args.viewOnceMessageId, { grants });
    return true;
  },
});
```

Revoke removes the edge rather than recording a `revoked` state. A later
operation on that `grantId` refuses as unknown, and one staged refusal aborts
the whole mutation. Clearing the map entry is therefore what keeps a later
owner delete executable.

**Owner delete-for-everyone** derives the remaining live grant IDs from that
map, revokes each one, removes the consumption rows, and deletes the message's
typed reference in one mutation:

```js source=demos/messaging-snapback/snapback/functions.mjs
export const deleteViewOnceForEveryone = defineJsMutation({
  args: { viewOnceMessageId: v.id('viewOnceMessages') },
  auth: 'authenticated',
  refusals: ['VIEW_ONCE_NOT_FOUND', 'VIEW_ONCE_NOT_AUTHOR'],
  result: results.value(v.boolean()),
  reads: ['viewOnceMessages', 'viewOnceConsumptions'],
  writes: ['viewOnceMessages', 'viewOnceConsumptions'],
  handler: async (ctx, args) => {
    const message = await ctx.db.get('viewOnceMessages', args.viewOnceMessageId);
    if (!message) {
      ctx.refuse('VIEW_ONCE_NOT_FOUND');
    }
    if (message.authorPrincipal !== ctx.auth.userId) {
      ctx.refuse('VIEW_ONCE_NOT_AUTHOR');
    }
    // The map contains only still-live edges because recipient close clears
    // its entry atomically with revoke.
    for (const grantId of Object.values(message.grants)) {
      await ctx.assets.revoke(grantId);
    }
    const consumptions = await ctx.db
      .query('viewOnceConsumptions')
      .withIndex('by_message_principal')
      .eq('viewOnceMessageId', args.viewOnceMessageId)
      .take(1024)
      .collect();
    for (const consumption of consumptions) {
      await ctx.db.delete('viewOnceConsumptions', consumption._id);
    }
    await ctx.db.delete('viewOnceMessages', args.viewOnceMessageId);
    return true;
  },
});
```

`ctx.assets.revoke` takes one grant ID. Independent grants survive a sibling's
revoke, so revoking one edge and deleting the message would leave every other
recipient authorized. Delete-for-everyone must revoke **every still-live
edge** before removing the typed reference.

Explicit close is not crash-safe. If the recipient process crashes after
activation and before close, the grant stays active until the owner revokes it
or deletes the message. The local surface has no activation TTL or crash lease;
do not claim that this recipe bounds that gap.

## 4. Deliver through the grant alone and revoke media access

The grant must be the recipient's **sole authority path**. Admit the asset with
`grants: true`, an `owner-only` read policy, and `private-strict` delivery so
close or delete denies the next governed byte request:

```js source=demos/messaging-snapback/snapback/functions.mjs
export const viewOnceImageUpload = defineAssetUpload({
  args: {},
  auth: 'authenticated',
  reads: [],
  accept: { mediaTypes: ['image/jpeg', 'image/png'], maxBytes: 8_000_000 },
  delivery: { kind: 'private-strict' },
  access: { read: 'owner-only' },
  grants: true,
  image: { location: 'strip' },
  authorize: async (ctx) => ({ owner: ctx.auth.userId }),
});
```

A public URL, a recipient-visible `via-references` row, an app-owned fallback
grant row beside the first-class edge, or any other readable reference bypasses
pending activation and revoke. The [Deliver section](../backend/assets.md#deliver)
has the route and cache contract. Under `private-signed`, revoke stops new URL
issuance, but an already-issued bearer URL remains usable until its TTL;
`private-strict` is the profile for next-request denial. Neither profile can
retract bytes already delivered. Do not place view-once bytes in a durable
client, image, filesystem, service-worker, or application cache.

## Limits and capability gate

- **The 1,024-edge ceiling is global per app.** It counts all outstanding
  pending plus active grants across every asset, not the fanout for one
  message. Revoke releases capacity. Sustained large audiences are not a fit
  for per-recipient edges; they belong to the membership-backed authority
  program rather than this recipe.
- **View once is a product behavior, not DRM.** It cannot prevent screen
  capture, another camera, or byte retention after delivery.
- **Grant support is local-only today.** Hosted targets are a nonclaim. Check
  the target's `backend.assets` capability before enabling the product and
  refuse or hide it when recipient grants are absent.

## Anti-patterns

- **Do not give the asset a second recipient-visible authority path.** Use
  either the first-class grant edge or the
  [portable fallback row](../backend/assets.md#portable-fallback-app-owned-grant-rows),
  never both, and keep the message's typed reference owner-only.
- **Do not skip or reorder the unique consumption row.** Activation state and
  `clientKey` replay do not prevent a fresh second logical open.
- **Do not revoke one edge and call the message deleted.** Revoke every
  still-live grant and remove the typed reverse reference in the same owner
  mutation.
- **Do not retain dead grant IDs.** Recipient close removes the edge, so clear
  its owner-visible bookkeeping entry in the same mutation.
- **Do not durably cache view-once bytes.** Revocation controls future governed
  requests, not bytes the client already copied.
- **Do not call explicit close crash-safe or hosted-ready.** The active edge
  survives a crash gap, and the shipped recipient-grant claim is local-only.
