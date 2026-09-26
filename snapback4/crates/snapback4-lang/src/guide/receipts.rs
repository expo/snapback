pub(super) const CARD: &str = r##"# Receipts: sent, delivered, read

Each member's client records on its own membership row what it fetched and what
it showed, as ordinals. One helper turns them into every message's receipt,
`sent`, `delivered` or `read`, live in the history query.

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
  spanFrom: int default 0
  spanThrough: int default 0
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
      if m.ordinal > member.deliveredOrdinal and (m.ordinal < member.spanFrom or m.ordinal > member.spanThrough):
        return 'sent'
      if member.seenOrdinal < m.ordinal:
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

mutation delivered(conversation: conversations, from: int, through: int):
  me = members[conversation, viewer] ! else NOT_MEMBER
  chat = conversations[conversation] ! else NOT_FOUND
  require 0 < from and from <= through else NOT_A_RUN
  require through <= chat.lastOrdinal else PAST_LAST_MESSAGE
  prefix = me.deliveredOrdinal if me.deliveredOrdinal > me.joinedOrdinal else me.joinedOrdinal
  low = me.spanFrom
  high = me.spanThrough
  if from <= prefix + 1:
    prefix = through if through > prefix else prefix
  else if high = 0 or (from <= high + 1 and through + 1 >= low):
    low = from if high = 0 or from < low else low
    high = through if through > high else high
  if high > 0 and low <= prefix + 1:
    prefix = high if high > prefix else prefix
    low = 0
    high = 0
  if prefix != me.deliveredOrdinal or low != me.spanFrom or high != me.spanThrough:
    update members[me] { deliveredOrdinal: prefix, spanFrom: low, spanThrough: high }
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

A member's row claims what its client fetched as runs of ordinals:
`deliveredOrdinal` claims every message through it, and `spanFrom` through
`spanThrough` claims one later run above a gap. That is the shape a member back
offline after more than the 500 synced messages holds: the newest, not the ones
before them. The client reports each unbroken run of fetched, settled messages
with `delivered`, and loads older pages to reach its prefix. A run extends the
prefix or grows the span outward; one that meets neither waits for those pages.
One span holds one return: a run above a second gap, opened offline before the
first was fetched, waits until the client fetches the gap between, which its
walk does online. So a receipt never claims a message the client did not fetch,
and never moves back. `seen` records the newest message on screen, online or offline, gap or
not. A message is `read` for a recipient once it is fetched and `seen` reaches
it. Both are the member's own report, bounded by the last message. Each message
costs one scan of at most 50 member rows; `check --cost` prints the certificate.

Run the hook for a conversation in the background (`visible: false`) as well as
on screen, so `delivered` follows fetching. While it loads older pages it
reports each longer run, one small write per page. Both mutations predict and
queue offline. A predicted row carries `pending: true` and its ordinal is not
yet the server's, so it is never acknowledged:

```ts
import { useEffect } from "react";
import { useClient, usePage, useQuery } from "snapback4/react";
import { api } from "./snapback/generated/api";
function useReceipts(conversation: string, visible: boolean) {
  const client = useClient();
  const page = usePage(api.history, { conversation });
  const me = useQuery(api.membership, { conversation });
  const mine = "data" in me ? me.data : null;
  const settled = new Set(page.items.filter(m => !m.pending).map(m => m.ordinal));
  const newest = settled.size ? Math.max(...settled) : null;
  // The newest unbroken run of fetched messages: low through newest.
  let low = newest;
  while (low !== null && settled.has(low - 1)) low--;
  const prefix = mine && Math.max(mine.deliveredOrdinal, mine.joinedOrdinal);
  const short = prefix !== null && low !== null && low > prefix + 1;
  useEffect(() => { if (short && page.hasMore) page.loadMore(); }, [short, page.hasMore, page.items.length, page.loadMore]);
  // The run extends the prefix, or grows the one span above a gap: the same test the mutation makes.
  const joins = mine !== null && prefix !== null && low !== null && newest !== null
    && (low <= prefix + 1 || mine.spanThrough === 0 || (low <= mine.spanThrough + 1 && newest + 1 >= mine.spanFrom));
  const claimed = mine !== null && prefix !== null && low !== null && newest !== null && (newest <= prefix || (mine.spanFrom <= low && newest <= mine.spanThrough));
  useEffect(() => {
    if (joins && !claimed && low !== null && newest !== null) void client.mutate(api.delivered, { conversation, from: low, through: newest });
  }, [client, conversation, joins, claimed, low, newest]);
  // A view needs no watermark first: seen only moves forward.
  const shown = mine && Math.max(mine.seenOrdinal, mine.joinedOrdinal);
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
