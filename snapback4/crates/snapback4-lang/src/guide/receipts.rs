pub(super) const CARD: &str = r##"# Receipts: sent, delivered, read

Each member's client records, as two ordinals on its own membership row, how far
it has fetched the conversation and how far it has shown it. One helper turns
them into every message's receipt, `sent`, `delivered` or `read`, live in the
history query.

```quarry
table conversations:
  title: text 1..50 ?
  creatorId: principal
  lastOrdinal: int default 0
  read <- exists members[.id, viewer]
  insert <- .creatorId = viewer
  update <- exists members[.id, viewer]
  after insert <- exists members[conversation = .id, principal = .creatorId]
  sync to members[.id]

table members:
  conversation: conversations
  principal: principal
  joinedOrdinal: int
  deliveredOrdinal: int default 0
  seenOrdinal: int default 0
  unique conversation, principal
  cap 50 by conversation
  immutable conversation, principal, joinedOrdinal
  read <- exists members[.conversation, viewer]
  insert <- created conversations[.conversation] or exists members[.conversation, viewer]
  update <- .principal = viewer
  delete <- .principal = viewer
  sync to members[.conversation]

table messages:
  conversation: conversations
  sender: principal
  ordinal: int
  recipients: int
  text: text <=2000
  at: time
  unique conversation, ordinal
  immutable conversation, sender, ordinal, recipients, at
  read <- exists members[.conversation, viewer]
  insert <- .sender = viewer and exists members[.conversation, viewer]
  sync to members[.conversation] last 500 by .ordinal

fn receipt(m: messages):
  state = 'read'
  remaining = 0
  for member in members where .conversation = m.conversation:
    if member.principal != m.sender and member.joinedOrdinal < m.ordinal:
      remaining = remaining + 1
      if member.deliveredOrdinal < m.ordinal:
        return 'sent'
      if member.seenOrdinal < m.ordinal:
        state = 'delivered'
  return state if remaining > 0 or m.recipients > 0 else 'sent'

query history(conversation: conversations, c: cursor ?):
  return messages where .conversation = conversation last 20 by .ordinal after c { *, receipt: receipt(.) }

query progress(conversation: conversations, c: cursor ?):
  me = members[conversation, viewer] ! else NOT_MEMBER
  delivered = max(me.deliveredOrdinal, me.joinedOrdinal)
  return { delivered, seen: max(me.seenOrdinal, me.joinedOrdinal), ahead: messages where .conversation = conversation and .ordinal > delivered first 100 by .ordinal after c }

mutation send(conversation: conversations, text: text <=2000):
  require exists members[conversation, viewer] else NOT_MEMBER
  chat = conversations[conversation] ! else NOT_FOUND
  ordinal = chat.lastOrdinal + 1
  recipients = 0
  for member in members where .conversation = conversation:
    if member.principal != viewer:
      recipients = recipients + 1
  update conversations[chat] { lastOrdinal: ordinal }
  m = insert messages { conversation, sender: viewer, ordinal, recipients, text, at: now }
  return m.id

mutation add(conversation: conversations, principal: principal):
  require exists members[conversation, viewer] else NOT_MEMBER
  chat = conversations[conversation] ! else NOT_FOUND
  insert members { conversation, principal, joinedOrdinal: chat.lastOrdinal } if absent
  return null

mutation leave(conversation: conversations):
  me = members[conversation, viewer] ! else NOT_MEMBER
  delete members[me]
  return null

mutation delivered(conversation: conversations, through: int):
  me = members[conversation, viewer] ! else NOT_MEMBER
  chat = conversations[conversation] ! else NOT_FOUND
  require through <= chat.lastOrdinal else PAST_LAST_MESSAGE
  if through > me.deliveredOrdinal:
    update members[me] { deliveredOrdinal: through }
  return null

mutation seen(conversation: conversations, through: int):
  me = members[conversation, viewer] ! else NOT_MEMBER
  chat = conversations[conversation] ! else NOT_FOUND
  require through <= chat.lastOrdinal else PAST_LAST_MESSAGE
  if through > me.seenOrdinal:
    update members[me] { seenOrdinal: through }
  return null
```

Every message takes the conversation's next ordinal, and a member records the
last ordinal when they join. So commit order, not the clock, decides a
message's recipients: the members other than its sender who joined before it.
A member who joined later is not a recipient. One who leaves drops out of every
message they had not reached, and a rejoin starts after the messages already
sent. A message records how many recipients it had. Once all of them leave, the
requirement is met; a message sent to nobody stays `sent`. So a receipt only
ever moves forward.

Delivery is a cumulative acknowledgement, as in a message queue:
`deliveredOrdinal` says the member's client fetched every message through it.
`progress` returns the member's two watermarks, counted from the join, and the
page of at most 100 messages `ahead` of the delivered one. The client
acknowledges the unbroken run of settled messages at the head of that page with
`delivered`, which moves the watermark, and `progress` answers with the page
after it until the client is caught up; it never needs the page's cursor. So a receipt never claims a message the
client did not fetch, never moves back, and needs nothing but the one row per
member. A member back after a long absence sees messages turn `delivered` from
the oldest, a page per round trip, and a message above that frontier stays
`sent` until the stream reaches it, even on screen. A device that holds only the
newest 500 synced messages cannot bridge the gap below them offline, and
acknowledges them when it reconnects. `seen` records the newest message on
screen, online or offline. A message is `read` for a recipient once it is
delivered and `seen` reaches it. Both watermarks are the member's own report,
bounded by the last message. Each message's receipt costs one scan of at most
50 member rows; `check --cost` prints the certificate.

Run the hook for a conversation in the background (`visible: false`) as well as
on screen, so `delivered` follows fetching. Both mutations predict and queue
offline. A predicted row carries `pending: true` and its ordinal is not yet the
server's, so it is never acknowledged:

```ts
import { useEffect } from "react";
import { useClient, usePage, useQuery } from "snapback4/react";
import { api } from "./snapback/generated/api";
function useReceipts(conversation: string, visible: boolean) {
  const client = useClient();
  const page = usePage(api.history, { conversation });
  const progress = useQuery(api.progress, { conversation });
  const mine = "data" in progress ? progress.data : null;
  // Acknowledge the unbroken run of settled messages right after the prefix.
  const prefix = mine ? mine.delivered : null;
  let through = prefix ?? 0;
  for (const m of mine ? mine.ahead : []) {
    if (m.pending || m.ordinal !== through + 1) break;
    through = m.ordinal;
  }
  useEffect(() => {
    if (prefix !== null && through > prefix) void client.mutate(api.delivered, { conversation, through });
  }, [client, conversation, prefix, through]);
  // A view needs no watermark first: seen only moves forward.
  const shown = mine ? mine.seen : null;
  const settled = page.items.filter(m => !m.pending).map(m => m.ordinal);
  const newest = settled.length ? Math.max(...settled) : null;
  useEffect(() => {
    if (visible && newest !== null && (shown === null || newest > shown)) void client.mutate(api.seen, { conversation, through: newest });
  }, [client, conversation, visible, shown, newest]);
  return page;
}
```

Render a clock while a message is `pending`; after settlement render `receipt`
as one tick (`sent`), two ticks (`delivered`) or two colored ticks (`read`). A
typing indicator is an expiring table (`guide reads`); who is connected now is
`connected[p]` (`guide presence`)."##;
