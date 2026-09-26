pub(super) const CARD: &str = r##"# Receipts: sent, delivered, read

Each member's client moves two watermarks on its own membership row, and one
helper turns them into every message's receipt: `sent`, `delivered` or `read`,
live in the history query.

```quarry
table conversations:
  title: text 1..50 ?
  creatorId: principal
  read <- exists members[.id, viewer]
  insert <- .creatorId = viewer
  after insert <- exists members[conversation = .id, principal = .creatorId]
  sync to members[.id]

table members:
  conversation: conversations
  principal: principal
  joinedAt: time
  deliveredAt: time default 0
  readAt: time default 0
  unique conversation, principal
  cap 50 by conversation
  immutable conversation, principal, joinedAt
  read <- exists members[.conversation, viewer]
  insert <- created conversations[.conversation] or exists members[.conversation, viewer]
  update <- .principal = viewer
  delete <- .principal = viewer or exists members[.conversation, viewer]
  sync to members[.conversation]

table messages:
  conversation: conversations
  sender: principal
  text: text <=2000
  at: time
  immutable conversation, sender, at
  read <- exists members[.conversation, viewer]
  insert <- .sender = viewer and exists members[.conversation, viewer]
  sync to members[.conversation] last 500 by .at

fn receipt(m: messages):
  state = 'read'
  for member in members where .conversation = m.conversation:
    if member.principal != m.sender and member.joinedAt <= m.at:
      if member.deliveredAt < m.at:
        return 'sent'
      if member.readAt < m.at:
        state = 'delivered'
  return state

query history(conversation: conversations, c: cursor ?):
  return messages where .conversation = conversation last 20 by .at after c { *, receipt: receipt(.) }

mutation send(conversation: conversations, text: text <=2000):
  m = insert messages { conversation, sender: viewer, text, at: now }
  return m.id

mutation add(conversation: conversations, principal: principal):
  require exists members[conversation, viewer] else NOT_MEMBER
  insert members { conversation, principal, joinedAt: now } if absent
  return null

mutation leave(conversation: conversations):
  me = members[conversation, viewer] ! else NOT_MEMBER
  delete members[me]
  return null

mutation delivered(conversation: conversations, through: time):
  me = members[conversation, viewer] ! else NOT_MEMBER
  if through > me.deliveredAt:
    update members[me] { deliveredAt: through }
  return null

mutation seen(conversation: conversations, through: time):
  me = members[conversation, viewer] ! else NOT_MEMBER
  update members[me] { deliveredAt: through if through > me.deliveredAt else me.deliveredAt, readAt: through if through > me.readAt else me.readAt }
  return null
```

A message is `sent` once its insert commits. `deliveredAt` is the newest
message a member's client fetched and `readAt` the newest it showed; the ticks
move whenever a member's watermark moves. The recipient set is membership at
send time. A member who joined later is not a recipient, and a removed member's
row is gone, so they drop out of every message they had not reached.

A watermark is the newest fetched message's `at`, not `now`. A message that
commits after a member's last fetch stays `sent` for that member, and
watermarks only move forward. A group of 50 costs 50 point reads per message;
`check --cost` prints the certificate.

The client reports `delivered` when a page brings a newer message, and `seen`
while the conversation is on screen:

```ts
import { useEffect } from "react";
import { useClient, usePage } from "snapback4/react";
import { api } from "./snapback/generated/api";
function useReceipts(conversation: string, visible: boolean) {
  const client = useClient();
  const page = usePage(api.history, { conversation });
  const newest = page.items.length ? Math.max(...page.items.map(m => m.at)) : null;
  useEffect(() => {
    if (newest !== null) void client.mutate(visible ? api.seen : api.delivered, { conversation, through: newest });
  }, [conversation, newest, visible]);
  return page;
}
```

Render `receipt` as one tick (`sent`), two ticks (`delivered`) or two colored
ticks (`read`). On a device both mutations predict and queue offline; the
sender's ticks move when the member's watermark syncs. A typing indicator is an
expiring table (`guide reads`); who is connected now is `connected[p]`
(`guide presence`)."##;
