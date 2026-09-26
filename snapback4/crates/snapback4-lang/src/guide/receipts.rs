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
  text: text <=2000
  at: time
  unique conversation, ordinal
  immutable conversation, sender, ordinal, at
  read <- exists members[.conversation, viewer]
  insert <- .sender = viewer and exists members[.conversation, viewer]
  sync to members[.conversation] last 500 by .ordinal

fn receipt(m: messages):
  state = 'read'
  recipients = 0
  for member in members where .conversation = m.conversation:
    if member.principal != m.sender and member.joinedOrdinal < m.ordinal:
      recipients = recipients + 1
      if member.deliveredOrdinal < m.ordinal:
        return 'sent'
      if member.readOrdinal < m.ordinal:
        state = 'delivered'
  return state if recipients > 0 else 'sent'

query history(conversation: conversations, c: cursor ?):
  return messages where .conversation = conversation last 20 by .ordinal after c { *, receipt: receipt(.) }

mutation send(conversation: conversations, text: text <=2000):
  require exists members[conversation, viewer] else NOT_MEMBER
  chat = conversations[conversation] ! else NOT_FOUND
  ordinal = chat.lastOrdinal + 1
  update conversations[chat] { lastOrdinal: ordinal }
  m = insert messages { conversation, sender: viewer, ordinal, text, at: now }
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
sent. A message with no recipients stays `sent`.

A watermark names the newest message the member's client fetched (`delivered`)
or showed (`seen`). It only moves forward, and never past the conversation's
last ordinal. A member who returns after more than the 500 synced messages
acknowledges the newest ones, so older ones their client never held count as
delivered. Each message costs one scan of at most 50 member rows; `check
--cost` prints the certificate.

The client reports `delivered` when a complete, fresh page brings a newer
settled message, and `seen` while the conversation is on screen. A predicted
row carries `pending: true` and its ordinal is not yet the server's:

```ts
import { useEffect } from "react";
import { useClient, usePage } from "snapback4/react";
import { api } from "./snapback/generated/api";
function useReceipts(conversation: string, visible: boolean) {
  const client = useClient();
  const page = usePage(api.history, { conversation });
  const settled = page.items.filter(m => !m.pending);
  const ready = "data" in page.read && page.read.complete && page.read.fresh;
  const newest = ready && settled.length ? Math.max(...settled.map(m => m.ordinal)) : null;
  useEffect(() => {
    if (newest !== null) void client.mutate(visible ? api.seen : api.delivered, { conversation, through: newest });
  }, [client, conversation, newest, visible]);
  return page;
}
```

Render `receipt` as one tick (`sent`), two ticks (`delivered`) or two colored
ticks (`read`). On a device both mutations predict and queue offline, and the
sender's ticks move when the member's watermark syncs. A typing indicator is an
expiring table (`guide reads`); who is connected now is `connected[p]`
(`guide presence`)."##;
