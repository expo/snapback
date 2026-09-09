# Expiry

TypeScript effects import their Quarry `then` mutation.

`snapback/notifications.q`:

```q
mutation recordNotified(outboxId: id, effect: text <=100, result: json <=1000):
  insert notifications {
    outboxId,
    effect,
    providerId: result.providerId,
  }
  return true
```

`snapback/delivery.ts` imports `recordNotified` from `./notifications` and
exports `notify = effect({ grants, run, then: recordNotified })`. The `run`
body performs I/O using its granted `fetch`; `meta.id` is its idempotency key.
See `snapback2 guide effects` for the executable TypeScript recipe.

`messages.thread` reads the delivery log; `conversationView` adds count/preview.
Use `withHistory` for declared partial history.
`snapback/messages.q`:

```q
query thread(conversationId: conversations, c: cursor ?):
  require isMember(conversationId, viewer) else MEMBERSHIP_REQUIRED
  page = deliveries[viewer, conversationId, 'message'] after c last 50 by byRecipientConversationKindAt
  return page { *, message: messages[.messageId] }
```

Send:

```q
mutation send(conversationId: conversations, body: text <=4000, expiresAt: time ?):
  require isMember(conversationId, viewer) else NOT_MEMBER
  row = insert messages { conversationId, authorId: viewer, body, expiresAt, at: now }
  deliver(conversationId, row.id, 'message')
  for member in conversationMembers(conversationId):
    if member.principal != viewer:
      emit notify { to: member.principal, body }
  return { id: row.id }
```

When a conversation selects a disappearing-message policy, derive the stored
deadline from the owner's `now` and configured durations. Branch into a helper
that accepts the chosen `time ?`; a binding created inside `if` is lexical and
does not update an outer binding. Give an explicit deadline first precedence,
use `now + cfg.disappear24hMs` or `now + cfg.disappear7dMs` for those modes,
and pass `null` for `off`. Apply the same helper to text, photo, video, and
view-once sends so every message kind participates in the row schedule.

Edit/unsend fan out to current members. Tombstones and held-page point
absences evict removed bodies.

See `guide quarry` for related topics.

## Scheduled removal through reconnect

The chat template connects four declarations. `schedule expireMessage on
messages at .expiresAt: purgeMessage(.id)` runs the owner mutation at the
row deadline. `purgeMessage` emits `expired` entries into the recipient delivery
log, then deletes the body. The log table declares `tombstones
messages[.messageId] if .kind = 'removed' or .kind = 'expired'`.
The client's ascending drained delivery query ingests those entries after
reconnect and evicts the referenced held body and its leased bytes; see
`guide offline` for the drain contract.

The purge visits the members returned at purge time. This recipe does not
promise an expiry entry for every historical recipient who has since left.
A deletion/log journey and a removed-event cache-eviction journey exercise
different parts; reconnect after a timed expiry needs its own app journey.
