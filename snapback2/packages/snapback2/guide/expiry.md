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

`messages.thread` reads delivered events; `conversationView` reads live content
history with count/preview, including prior messages for joiners.
Both Thread screens bind `conversationView` through `withHistory` to delivered
`thread` items: a never-opened chat and a predicted send render from the drained
log when the offline composite lacks count/preview authority.
`snapback/messages.q`:

```q
query thread(conversationId: conversations, c: cursor ?):
  require isMember(conversationId, viewer) else MEMBERSHIP_REQUIRED
  page = deliveries[viewer, conversationId, 'delivered'] after c last 50 by byRecipientGroup
  return page { *, message: messages[.row] }
```

Send:

```q
mutation send(conversationId: conversations, body: text <=4000, expiresAt: time ?):
  require isMember(conversationId, viewer) else NOT_MEMBER
  row = insert messages { conversationId, authorId: viewer, body, expiresAt, at: now }
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
and pass `null` for `off`. Apply the same helper to text, photo, video,
view-once, and poll sends so every message kind participates in the row
schedule; insert a poll's companion row only after its message has taken that
shared path, and remove the companion question/options row when the message
expires.

Edits append `changed`; unsend and expiry append `removed`, always to original
recipients including departed members. The generated removal metadata evicts
held bodies and their bytes. See `guide deliver`.

## Scheduled removal through reconnect

```q
schedule expireMessage on messages at .expiresAt: delete .
```

The owner's row timer deletes the body and appends removed events in the same
transaction, even with every client closed. The ascending inbox drain accepts
those events on reconnect and evicts the referenced body and leased bytes;
this eviction survives a cold offline restart. `retain delivered-history`
keeps departed members' other pre-removal bodies. The template journey proves
the schedule with all clients closed; `guide offline` explains the drain.
