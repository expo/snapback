// @ref LLP 3000.021#3.1 — receipt reads live beside a bare ordinary history.
// @ref LLP 3000.021#3.4 — retaining the parent keeps the pinned screen after leave.
pub(super) const CARD: &str = r##"# Receipts: sent, delivered, read

The SDK reports received messages as ordinals and runs, while the screen
reports views, to derive `sent`, `delivered` and `read` receipts. For expiring
messages or engine-assigned ordinals, start with `guide sequences`, then use
the run merge below.

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

query receiptMember(conversation: conversations):
  return members[conversation, viewer]

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

When migrating an older `useReceipts` recipe, remove its delivery debt,
automatic history `loadMore()` and background `progress` polling writers
when adding `reports delivery`. Keep the visible screen's `seen` report.
Loading older messages is a reader action; receipt convergence must not
acquire history or enqueue a receipt for every page before sending a message.
The SDK reports only positions it actually publishes, including disjoint
runs; it never fills a missing delivery gap by assuming it was received.

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

This card's contiguous message-only intervals assume no deletion or expiry.

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

The SDK reports delivered positions for the signed-in client, even with no
conversation mounted. The local client collects confirmed, held, unexpired
published rows and persists debt with them; both clients collect the server's
query manifest, including nested message images. Scalars, counts, copied
ordinals and predicted rows report nothing. A position that never reached
the client stays `sent`. Positions outside JavaScript's safe-integer range
also stay `sent`. Composed answers omit their manifest when retained local
rows replace server rows.

Through `createApp` / `guardClient`, a query manifest is accepted only when
the facade publishes its shared authority-approved answer or `query()` returns
it after approval. Peer facades collect the same answer once; refused,
superseded or expired answers report nothing. Without a facade, acceptance
remains the raw watch publication or query return after its final fences.
Collection persistence never delays the answer and rechecks its fences on
every attempt. Ordinary device publication still persists debt with its rows.

Every report sends its binding's fingerprint; the server checks it under the
writer before executing the mutation. Unrelated generation changes preserve
unchanged bindings.

`E_DELIVERY_BINDING` means a report's binding changed or was removed. The SDK
drops that binding's debt and collects under the current fingerprint; it
does not retry the old report.

For explicit catch-up, `progress` answers with the member's row, their stored
runs and the next 100 ordinals ahead of the prefix, counted from the join,
newest first within that interval. The next interval follows as the prefix
moves. An interval below the acquired window needs the server; it never needs
the page's cursor. The SDK keeps fetched positions merged into disjoint runs
until a report succeeds. A member keeps at most 64 stored runs: one more
refuses `RUNS_FULL` until a merge or catching up frees room.


Reports call `delivered` directly, outside the ordered outbox. Success means
the whole run is covered. `RUNS_FULL` parks a disjoint run while other runs
continue; publication, a later success, reconnect, start and a slow timer can
wake it. A wake retries one parked run, at least 30 seconds after its last
attempt, behind new debt; the slow timer runs every ten minutes. Uncertain
requests reuse their persisted id. More than 64 permanent holes can keep a
run unrecorded. The local client persists debt and uncertain attempt ids across
restart; the online client keeps its queue in memory. The SDK merges exact
positions into owed runs and retires them on committed success. Leaving drops the group's
debt. A new membership's join floor covers positions before its join.

Use `onDeliveryRefused` on `createClient`, `createLocalClient` or `createApp`
to observe range refusals or an unexpected application refusal. The callback
receives `{ table, mutation, args, group, from, through, why }`. A range
refusal is remembered so repeated manifests cannot recreate that interval.
`E_BOUND` is an ordinary non-retryable refusal: it calls the callback once and
parks until the next start, which retries with a new id. Eviction and
recollection cannot resend it within the session. The expired backlog normally
clears before then; an already committed report becomes a no-op.
`RUNS_FULL`, membership loss and transport retries do not call the callback.

`progress` stays available for explicit catch-up. Its `ahead` rows count as
deliveries, so mounting it continuously acquires the next page whenever the
prefix advances. The ordinary screen below reads its member separately.

`seen` remains an application decision: it records messages actually on
screen. Its small retry debt survives a remount for this signed-in client.
A reload forgets that view debt and the next view records it again. A message
is `read` only when both delivery and `seen` reach it. Each receipt reads at
most 50 members and one run lookup per member below the position.

```ts
import { useEffect, useMemo } from "react";
import { useClient, usePage, useQuery, useViewer } from "snapback4/react";
import { api } from "./snapback/generated/api";
type Viewed = { through: number; sent: number };
const views = new WeakMap<object, Map<string, Viewed>>();
function viewOf(client: object, viewer: string | null, conversation: string): Viewed {
  const scopes = views.get(client) ?? new Map<string, Viewed>();
  views.set(client, scopes);
  const key = JSON.stringify([viewer, conversation]);
  const viewed = scopes.get(key) ?? { through: 0, sent: 0 };
  scopes.set(key, viewed);
  return viewed;
}
function useReceipts(conversation: string, visible: boolean) {
  const client = useClient();
  const viewer = useViewer();
  const page = usePage(api.history, { conversation });
  const membership = useQuery(api.receiptMember, { conversation });
  const member = "data" in membership ? membership.data : null;
  const viewed = useMemo(() => viewOf(client, viewer, conversation), [client, viewer, conversation]);
  const settled = page.items.filter(m => !m.pending).map(m => m.ordinal);
  const newest = settled.length ? Math.max(...settled) : 0;
  const shown = member && !member.pending ? Math.max(member.seenOrdinal, member.joinedOrdinal) : null;
  useEffect(() => {
    if (visible && newest > viewed.through) viewed.through = newest;
    const through = viewed.through;
    if (through === 0 || (shown !== null && through <= shown) || viewed.sent === through) return;
    viewed.sent = through;
    void client.mutate(api.seen, { conversation, through }).then(write => {
      if (write.state === "failed" && write.why.code === "E_ADMISSION" && viewed.sent === through) viewed.sent = 0;
    });
  }, [client, conversation, viewed, visible, shown, newest, membership]);
  return page;
}
```

Render a clock while a message is `pending`; after settlement render `receipt`
from `messageReceipts`, matched by message id, beside the bare history
as one tick (`sent`), two ticks (`delivered`) or two colored ticks (`read`). A
typing indicator is an expiring table (`guide reads`); who is connected now is
`connected[p]` (`guide presence`)."##;
