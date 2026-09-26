pub(super) const CARD: &str = r##"# Receipts: sent, delivered, read

Each member's client records what it fetched and what it showed, as ordinals, on
its own membership row and in runs beside it. One helper turns them into every
message's receipt, `sent`, `delivered` or `read`, live in the history query.

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

table runs:
  conversation: conversations
  principal: principal
  fromOrdinal: int
  throughOrdinal: int
  unique conversation, principal, fromOrdinal
  cap 16 by conversation, principal
  cap 800 by conversation
  read <- exists members[.conversation, viewer]
  insert <- .principal = viewer and exists members[.conversation, viewer]
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
      if m.ordinal > member.deliveredOrdinal:
        run = first(runs[conversation = m.conversation, principal = member.principal, fromOrdinal <= m.ordinal] last 1 by .fromOrdinal)
        if run = null or run.throughOrdinal < m.ordinal:
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
  for run in runs where .conversation = conversation and .principal = viewer:
    delete runs[run]
  delete members[me]
  return null

mutation delivered(conversation: conversations, from: int, through: int):
  me = members[conversation, viewer] ! else NOT_MEMBER
  chat = conversations[conversation] ! else NOT_FOUND
  require 0 < from and from <= through else NOT_A_RUN
  require through <= chat.lastOrdinal else PAST_LAST_MESSAGE
  prefix = max(me.deliveredOrdinal, me.joinedOrdinal)
  held = first(runs where .conversation = conversation and .principal = viewer and .fromOrdinal <= from last 1 by .fromOrdinal)
  if through <= prefix or (held != null and held.throughOrdinal >= through):
    return null
  low = from
  high = through
  for run in runs where .conversation = conversation and .principal = viewer and .fromOrdinal <= through + 1 and .throughOrdinal + 1 >= from:
    low = min(low, run.fromOrdinal)
    high = max(high, run.throughOrdinal)
    delete runs[run]
  if low <= prefix + 1:
    update members[me] { deliveredOrdinal: high }
  else if count(runs where .conversation = conversation and .principal = viewer) < 16:
    insert runs { conversation, principal: viewer, fromOrdinal: low, throughOrdinal: high }
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

A member's row claims every message through `deliveredOrdinal`, and each of
their `runs` one later unbroken run above a gap. A member back offline after
more than the 500 synced messages holds the newest, not the ones before them.
The client reports each unbroken run of fetched, settled messages with
`delivered`, and walks older pages toward its prefix. The mutation merges a run
with every run it meets, and folds it into the prefix when it reaches it. So a
receipt never claims a message the client did not fetch and never moves back,
and every window a member fetched is delivered at once, however many gaps lie
between. A member keeps at most 16 runs: a seventeenth waits, unrecorded, and
the hook reports it again when the member's prefix moves. So no member's runs
crowd out another's: a conversation holds at most 50 members' 16. `seen` records
the newest message on screen, online or offline, gap or not. A message is
`read` for a recipient once it is fetched and `seen` reaches it. Both are the
member's own report, bounded by the last message. Each message costs one scan
of at most 50 member rows, and a run lookup for each member not yet past it;
`check --cost` prints the certificate.

Run the hook for a conversation in the background (`visible: false`) as well as
on screen, so `delivered` follows fetching. While it walks older pages it
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
  // Walk older pages until the run meets the delivered prefix (from the join).
  const prefix = mine && Math.max(mine.deliveredOrdinal, mine.joinedOrdinal);
  const short = prefix !== null && low !== null && low > prefix + 1;
  useEffect(() => { if (short && page.hasMore) page.loadMore(); }, [short, page.hasMore, page.items.length, page.loadMore]);
  // Report the run; the mutation merges it into the prefix or the member's runs.
  useEffect(() => {
    if (prefix !== null && low !== null && newest !== null && newest > prefix) void client.mutate(api.delivered, { conversation, from: low, through: newest });
  }, [client, conversation, prefix, low, newest]);
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
