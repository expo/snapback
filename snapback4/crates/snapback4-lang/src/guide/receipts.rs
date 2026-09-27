// @ref LLP 3000.021#3.1 — receipt reads live beside a bare ordinary history.
// @ref LLP 3000.021#3.4 — retaining the parent keeps the pinned screen after leave.
pub(super) const CARD: &str = r##"# Receipts: sent, delivered, read

The SDK reports the messages each member received, as ordinals on their
membership row and in runs beside it, while the screen reports what it has shown.
One helper turns them into each message's receipt: `sent`, `delivered` or `read`.

```quarry
table conversations:
  title: text 1..50 ?
  creatorId: principal
  lastOrdinal: int default 0
  read <- exists members[.id, viewer]
  insert <- .creatorId = viewer
  update <- exists members[.id, viewer]
  after insert <- exists members[conversation = .id, principal = .creatorId]
  retain delivered-history
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
  cap 64 by conversation, principal
  cap 3200 by conversation
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
  quote: messages ?
  at: time
  unique byConversationOrdinal: conversation, ordinal
  immutable conversation, sender, ordinal, recipients, at
  read <- exists members[.conversation, viewer]
  insert <- .sender = viewer and exists members[.conversation, viewer]
  retain delivered-history
  sync to members[.conversation] last 500 by byConversationOrdinal

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

query conversationScreen(conversation: conversations):
  return conversations[conversation]

query inbox(c: cursor ?):
  return members where .principal = viewer first 50 by .conversation after c { conversation, chat: conversations[.conversation] }

query history(conversation: conversations, c: cursor ?):
  return messages where .conversation = conversation last 20 by .ordinal after c

query messageReceipts(conversation: conversations, c: cursor ?):
  return messages where .conversation = conversation last 20 by .ordinal after c { id, receipt: receipt(.) }

query progress(conversation: conversations, c: cursor ?):
  me = members[conversation, viewer] ! else NOT_MEMBER
  delivered = max(me.deliveredOrdinal, me.joinedOrdinal)
  return { member: me, runs: runs where .conversation = conversation and .principal = viewer, ahead: messages where .conversation = conversation and .ordinal > delivered and .ordinal <= delivered + 100 last 100 by .ordinal after c }

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

mutation delivered(conversation: conversations, from: int, through: int)
  reports delivery of messages by .conversation, .ordinal:
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
  else:
    require count(runs where .conversation = conversation and .principal = viewer) < 64 else RUNS_FULL
    insert runs { conversation, principal: viewer, fromOrdinal: low, throughOrdinal: high }
  return null

mutation seen(conversation: conversations, through: int):
  me = members[conversation, viewer] ! else NOT_MEMBER
  chat = conversations[conversation] ! else NOT_FOUND
  require through <= chat.lastOrdinal else PAST_LAST_MESSAGE
  if through > me.seenOrdinal:
    update members[me] { seenOrdinal: through }
  return null

table profiles:
  principal: principal
  name: text <=80
  unique principal
  public 'display names are public'
  sync last 500 by .id

table reactions:
  message: messages
  principal: principal
  emoji: text <=16
  unique message, principal
  cap 32 by message
  immutable message, principal
  read through .message
  online only

query messageAuthor(message: messages):
  return profiles[principal = messages[message].sender]

query quotedMessage(message: messages):
  return messages[messages[message].quote]

query messageReactions(message: messages):
  return reactions where .message = message first 32 by .principal

```

Pin `conversationScreen` by id beside the bare, ordinary `history` page.
Neither requires membership: table rules still protect every server read.
Retention on both conversations and messages keeps the delivered screen on
local clients after leave, remount and reopen, offline and online. The inbox
reads memberships and drops the row when that member row is deleted.
An online-only client cannot recover these retained rows.

Render `messageReceipts`, profiles, quotes and reactions from their own
queries beside history. A decoration that loads or refuses leaves the page
intact. Use `held` only for a read the server cannot answer, such as word
search over every chat held on a device. An ordinary history can ask the
server before acquisition or past its horizon; a left group's retained page
stays local.

Every message takes the conversation's next ordinal, and a member records the
last ordinal when they join. So commit order, not the clock, decides a
message's recipients: the members other than its sender who joined before it.
A member who joined later is not a recipient. One who leaves drops out of every
message they had not reached, and a rejoin starts after the messages already
sent. A message records how many recipients it had. Once all of them leave, the
requirement is met; a message sent to nobody stays `sent`. So a receipt only
ever moves forward.

`reports delivery of messages by .conversation, .ordinal` binds this mutation
to the SDK's delivery reporter. **Success is coverage:** every position in the
inclusive run is recorded for the caller. Refuse with a code when it cannot be
recorded. `RUNS_FULL` refuses a disjoint 65th run; merged runs free their slots
before the count. A covered run keeps a replayable receipt but advances no
sequence and wakes no reader. Replaying its write id returns that success.

`E_DELIVERY_CLAUSE` requires exactly a reference to the group table and two
`int` arguments, immutable group and position columns, their unique key, and
one reporter per tracked table. The compiler checks those facts, not the body.
Never reuse a deleted position. A membership without a join floor must refuse
positions before the join. Membership and allocation remain server decisions. An ephemeral mutation
cannot keep a durable replay receipt; use durable tables.

A member's row claims every message through `deliveredOrdinal`, and each of
their `runs` one unbroken run above a gap. The SDK reports debt collected from
publications and accepted answer manifests with `delivered(from, through)`.
`progress` remains a catch-up read; its returned message images also qualify
for a manifest. The mutation merges a run with every run it meets, and folds it into the prefix
when it reaches it. So whatever a client fetched is delivered once its report
is recorded, however many gaps lie between, and a receipt never claims a
message the client did not fetch, nor moves back.

Three things keep every fetched message moving:

- **Catching up.** `progress` answers with the member's row, their stored runs
  and the next 100 ordinals ahead of the prefix, counted from the join,
  newest first within that interval. Then the next interval as the prefix
  moves, until the client is caught up. Ordinals are contiguous: this card
  never deletes messages. An interval below the acquired window needs the server.
  It never needs the page's cursor.
- **Owing.** The SDK collects exact positions from confirmed published rows
  and accepted answer manifests, merges them into owed runs, and retires them
  on committed success. The local client persists debt and uncertain attempt
  ids in the device store, so a reload resumes them. The online client keeps
  its queue in memory; closing it loses queued debt, which stays `sent`.
  Predicted rows and positions outside JavaScript's safe-integer range never
  count. Reporting needs no mounted conversation or confirmation query.
- **Waiting.** A member keeps at most 64 runs. A disjoint 65th report refuses
  `RUNS_FULL`; the SDK parks that run and continues with later owed intervals.
  A group success, a published row or accepted manifest, reconnect, start, or
  the slow ten-minute timer wakes one parked run. Retries wait at least 30
  seconds and yield to new debt. Uncertain requests reuse their persisted id.

`E_DELIVERY_BINDING` means a report's binding changed or was removed. The SDK
drops that binding's debt and collects under the current fingerprint; it
does not retry the old report.

`seen` records the newest message on screen, online or offline. The hook keeps
an owed view until the member's row shows it; a view the client
could not keep goes again with the next answer, even once the conversation is
hidden or its screen remounted. A reload forgets it, and the next view records
it again. A message is `read` for a recipient once it is delivered and `seen`
reaches it. Every watermark is the member's own report, bounded by the last
message. Each message's receipt costs one scan of at most 50 member rows and a
run lookup for each member not yet past it; `check --cost` prints the
certificate.

The SDK reports delivery in the background. The hook below records only
`seen`; keep it mounted to retain an owed view. A predicted row carries
`pending: true`, so it is never used as a confirmed view watermark.

```ts
import { useEffect, useMemo } from "react";
import { useClient, usePage, useQuery, useViewer } from "snapback4/react";
import { api } from "./snapback/generated/api";
type Viewed = { through: number; sent: number };
const views = new WeakMap<object, Map<string, Viewed>>();
function viewOf(client: object, viewer: string | null, conversation: string): Viewed {
  const scopes = views.get(client) ?? new Map<string, Viewed>();
  views.set(client, scopes);
  const scope = JSON.stringify([viewer, conversation]);
  const viewed = scopes.get(scope) ?? { through: 0, sent: 0 };
  scopes.set(scope, viewed);
  return viewed;
}
function useReceipts(conversation: string, visible: boolean) {
  const client = useClient();
  const viewer = useViewer();
  const page = usePage(api.history, { conversation });
  const progress = useQuery(api.progress, { conversation });
  const mine = "data" in progress ? progress.data : null;
  const member = mine ? mine.member : null;
  const viewed = useMemo(() => viewOf(client, viewer, conversation), [client, viewer, conversation]);
  const settled = page.items.filter(m => !m.pending).map(m => m.ordinal);
  const newest = settled.length ? Math.max(...settled) : 0;
  const shown = member ? Math.max(member.seenOrdinal, member.joinedOrdinal) : null;
  useEffect(() => {
    // A view needs no watermark first: seen only moves forward.
    if (visible && newest > viewed.through) viewed.through = newest;
    // Sent once; one the client could not keep goes again when the hook next runs.
    const through = viewed.through;
    if (through === 0 || (shown !== null && through <= shown) || viewed.sent === through) return;
    viewed.sent = through;
    void client.mutate(api.seen, { conversation, through }).then(write => {
      if (write.state === "failed" && write.why.code === "E_ADMISSION" && viewed.sent === through) viewed.sent = 0;
    });
  }, [client, conversation, viewed, visible, shown, newest, progress]); // eslint-disable-line react-hooks/exhaustive-deps
  return page;
}
```

Render a clock while a message is `pending`; after settlement render `receipt`
from `messageReceipts`, matched by message id, beside the bare history
as one tick (`sent`), two ticks (`delivered`) or two colored ticks (`read`). A
typing indicator is an expiring table (`guide reads`); who is connected now is
`connected[p]` (`guide presence`)."##;
