# Sequences: receipt gaps in expiring messages

Use `sequence by` for conversation positions and a `: server` receipt mutation
that reads the first live blocker before deleting runs or writing. Bounded unique
ordinal probes are the fallback; a row-keyed count answers what this member missed.

```quarry
table conversations:
  creator: principal
  read <- exists members[.id, viewer]
  insert <- .creator = viewer
  online only
table members:
  conversationId: conversations
  principal: principal
  joinedAt: sequence by conversationId
  deliveredOrdinal: int default 0
  unique conversationId, principal
  cap 50 by conversationId
  read <- .principal = viewer
  insert <- created conversations[id = .conversationId, creator = viewer]
  update <- .principal = viewer
  online only
table messages:
  conversationId: conversations
  ordinal: sequence by conversationId
  sender: principal
  expiresAt: time ?
  unique conversationId, ordinal
  immutable sender, expiresAt
  read <- exists members[.conversationId, viewer]
  insert <- .sender = viewer and exists members[.conversationId, viewer]
  expire at .expiresAt
  online only
table runs:
  conversationId: conversations
  principal: principal
  fromOrdinal: int
  throughOrdinal: int
  unique conversationId, principal, fromOrdinal
  cap 64 by conversationId, principal
  read <- .principal = viewer
  insert <- .principal = viewer and exists members[.conversationId, viewer]
  delete <- .principal = viewer
  online only

view missed: count messages by members m
  where .conversationId = m.conversationId and .ordinal > m.deliveredOrdinal
    and .ordinal > m.joinedAt and .sender != m.principal

mutation createConversation():
  chat = insert conversations { creator: viewer }
  insert members { conversationId: chat.id, principal: viewer }
  return chat
mutation send(conversationId: conversations, expiresAt: time ?):
  return insert messages { conversationId, sender: viewer, expiresAt }

mutation delivered(conversationId: conversations, from: int, through: int): server
  me = members[conversationId, viewer] ! else NOT_MEMBER
  anchor = messages[conversationId = conversationId, ordinal = through] ! else NOT_FOUND
  require 0 < from and from <= through else NOT_A_RUN
  prefix = max(me.deliveredOrdinal, me.joinedAt)
  if through <= prefix:
    return prefix
  low = from
  high = through
  held = runs where .conversationId = conversationId and .principal = viewer and .fromOrdinal <= through + 1 and .throughOrdinal + 1 >= from
  for run in held:
    low = min(low, run.fromOrdinal)
    high = max(high, run.throughOrdinal)
  if prefix + 1 < low:
    blocker = first(messages where .conversationId = conversationId and .ordinal > prefix and .ordinal < low first 1 by .ordinal)
    prefix = blocker.ordinal - 1 if blocker != null else low - 1
  for run in held:
    delete runs[run]
  if low <= prefix + 1:
    prefix = max(prefix, high)
  else:
    require count(runs where .conversationId = conversationId and .principal = viewer) < 64 else RUNS_FULL
    insert runs { conversationId, principal: viewer, fromOrdinal: low, throughOrdinal: high }
  if prefix > me.deliveredOrdinal:
    update members[me] { deliveredOrdinal: prefix }
  return prefix
query whatDidIMiss(member: members):
  return missed[member]

fn skipExpired_messages(scope: conversations, initialPrefix: int, low: int):
  prefix = initialPrefix
  for i in range(0, 1024):
    if prefix + 1 >= low:
      break
    if exists messages[conversationId = scope, ordinal = prefix + 1]:
      break
    prefix = prefix + 1
  return prefix

mutation skipExpiredBefore(next: messages):
  message = messages[next] ! else NOT_FOUND
  me = members[message.conversationId, viewer] ! else NOT_MEMBER
  prefix = max(me.deliveredOrdinal, me.joinedAt)
  prefix = skipExpired_messages(message.conversationId, prefix, message.ordinal)
  if prefix > me.deliveredOrdinal:
    update members[me] { deliveredOrdinal: prefix }
  return prefix
```

## Receipt-gap progress

`delivered` merges intervals without effects, reads the blocker, then deletes
merged runs and writes. Mutation scans of expiring tables require
`predicts: "never"` (here declared `: server`) and an initial read-only phase;
a write or emit anywhere in an enclosing statement ends it (`guide programs`).
Expired unswept rows still cost examined work, even with `first 1`; exceeding
the ceiling refuses `E_BOUND` atomically. A smaller page cannot clear a backlog.
For delivery reports, `E_BOUND` is an ordinary non-retryable refusal: the SDK
calls `onDeliveryRefused` once and parks the interval until the next start,
which retries with a new id. There is no retry within the session. A committed
report that runs again is a no-op report (`why E_BOUND`, `guide receipts`).

The caller must check authority and validate the received run. Ordinals alone
do not prove delivery. Keep disjoint runs until they meet the prefix; refuse
`RUNS_FULL` when no run slot is free. `sequence by` is dense across participating columns:
membership joins consume positions; deleted or expired messages leave holes.
Use settled positions for acknowledgement; predicted ordinals can move.

For shapes still refused, use `skipExpired_messages` inside the receipt merge
instead of the blocker scan. Unique probes remain eligible after effects.
`skipExpiredBefore` demonstrates their use before a readable live message;
it acknowledges no live message. The helper's prefix justifies advancing a receipt only after the caller's own authority check (the membership check or this card's readable-message anchor).
Uniformity proves one verdict for the conversation, which can be false.

The probe loop stops at a live message or 1,024 probes. Save partial prefix
progress and keep the merged run when it remains disjoint. An already-recorded
run must reach the helper again: retain only the `through <= prefix` early return,
not `guide receipts`' return for a run covered by `held`. For `[1027,1027]` with
prefix 0 and only holes, one call saves prefix 1024 and the run; the next joins
at 1027. Resume with a new invocation id; reusing an id replays the receipt.
The ordinary work meter can still refuse the transaction.

The row-keyed count answers the badge question without one application probe
per position. It excludes expired messages even before their physical sweep.
It does not prove a received run or replace the receipt merge. For an unread
badge, use the member's read position instead of `deliveredOrdinal`; see
`guide maintains` for tombstones, private member fields and offline count coverage.

Manual allocation requires every writer to update the conversation on send.
This public example isolates allocation; private apps need the membership rules:

```quarry
table conversations:
  creator: principal
  lastOrdinal: int default 0
  public
  update <- .creator = viewer
  online only
table messages:
  conversationId: conversations
  ordinal: int
  sender: principal
  expiresAt: time ?
  unique conversationId, ordinal
  immutable conversationId, ordinal, expiresAt
  public
  insert <- .sender = viewer
  expire at .expiresAt
  online only
mutation manualSend(conversationId: conversations, expiresAt: time ?):
  chat = conversations[conversationId] ! else NOT_FOUND
  ordinal = chat.lastOrdinal + 1
  update conversations[chat] { lastOrdinal: ordinal }
  return insert messages { conversationId, ordinal, sender: viewer, expiresAt }
```

`sequence by` replaces manual allocation and refuses supplied or patched ordinals.
It does not make the probe loop constant cost. Do not change an existing
populated integer column into a sequence casually: `check --store` assesses
adoption, and a sequence change requires an empty table. Use this schema for
a new conversation model, or preserve the existing allocator while adopting
the receipt recipe.

`N_SEQUENCE_READ` locates a first-membership trap: `read <- exists
members[.conversation, viewer]` cannot authorize the first member's sequence
before that member exists, even when `created conversations[.conversation]`
admits its insert rule. A newly inserted parent or an empty live group does
not prove a fresh shared counter: other sequence tables and deleted rows
may have consumed ordinals. Keep the manual allocator above for that roster
model. Seed new memberships at zero, copy the readable parent's `lastOrdinal`
for later joins, and increment it atomically on each send. An owner-only
membership read (`.principal = viewer`) is another model, with a different
roster audience. The runtime does not test a hidden counter for zero to decide
whether to admit the insert.

During development, the dev log and `snapback4 why recent` name the actual
refusing clause and its source site. Those local records are not HTTP data;
the caller still receives the generic `E_RULE`.
