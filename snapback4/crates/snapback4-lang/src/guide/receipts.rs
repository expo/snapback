pub(super) const CARD: &str = r##"# Receipts: sent, delivered, read

Each member's client moves two ordinal watermarks on its own membership row, and
one helper turns them into every message's receipt: `sent`, `delivered` or
`read`, live in the history query.

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
  readOrdinal: int default 0
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
      if member.readOrdinal < m.ordinal:
        state = 'delivered'
  return state if remaining > 0 or m.recipients > 0 else 'sent'

query history(conversation: conversations, c: cursor ?):
  return messages where .conversation = conversation last 20 by .ordinal after c { *, receipt: receipt(.) }

query membership(conversation: conversations):
  return members[conversation, viewer]

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
  if through > me.readOrdinal:
    update members[me] { deliveredOrdinal: through if through > me.deliveredOrdinal else me.deliveredOrdinal, readOrdinal: through }
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

A watermark claims every message through an ordinal, so a client acknowledges
only an unbroken run of messages it fetched after its delivered watermark:
`delivered` while the conversation is in the background, and `seen` while it is
on screen. Where a page leaves a gap, the client loads older pages first, which
fetches them. Both are the member's own report. The recipe bounds them by the
last message, not by what a client really consumed. Each message costs one
scan of at most 50 member rows; `check --cost` prints the certificate.

The client acknowledges from complete pages, offline too, since both mutations
predict and queue. A predicted row carries `pending: true` and its ordinal is
not yet the server's, so it is never acknowledged:

```ts
import { useEffect } from "react";
import { useClient, usePage, useQuery } from "snapback4/react";
import { api } from "./snapback/generated/api";
function useReceipts(conversation: string, visible: boolean) {
  const client = useClient();
  const page = usePage(api.history, { conversation });
  const me = useQuery(api.membership, { conversation });
  const settled = new Set(page.items.filter(m => !m.pending).map(m => m.ordinal));
  const ready = "data" in page.read && page.read.complete && "data" in me && me.data !== null;
  // An unbroken run of fetched messages after the delivered watermark.
  const floor = ready ? me.data.deliveredOrdinal : null;
  let through = floor;
  while (through !== null && settled.has(through + 1)) through++;
  const newest = settled.size ? Math.max(...settled) : null;
  const gap = through !== null && newest !== null && through < newest;
  useEffect(() => { if (gap && page.hasMore) page.loadMore(); }, [gap, page.hasMore]);
  const mark = ready ? (visible ? me.data.readOrdinal : me.data.deliveredOrdinal) : null;
  useEffect(() => {
    if (through !== null && mark !== null && through > mark) void client.mutate(visible ? api.seen : api.delivered, { conversation, through });
  }, [client, conversation, through, mark, visible]);
  return page;
}
```

Render a clock while a message is `pending`; after settlement render `receipt`
as one tick (`sent`), two ticks (`delivered`) or two colored ticks (`read`). A
typing indicator is an expiring table (`guide reads`); who is connected now is
`connected[p]` (`guide presence`)."##;
