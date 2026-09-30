// @ref LLP 3000.021#3.1 — receipt reads live beside a bare ordinary history.
// @ref LLP 3000.021#3.4 — retaining the parent keeps the pinned screen after leave.
pub(super) const CARD: &str = r##"# Receipts: sent, delivered, read

Declare receipts on messages to generate delivery reporting, read progress and receipt projections. The SDK reports received positions; the visible screen reports seen positions.

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
  unique conversation, principal
  cap 50 by conversation
  immutable conversation, principal, joinedOrdinal
  read <- exists members[.conversation, viewer]
  insert <- created conversations[.conversation] or exists members[.conversation, viewer]
  update <- .principal = viewer
  delete <- .principal = viewer
  sync to members[.conversation]

table messages:
  receipts chat by .conversation, .ordinal from .sender to members:
    counter .lastOrdinal
    floor .joinedOrdinal
    count .recipients
    watermarks .deliveredOrdinal, .seenOrdinal
    runs runs
    operations receipt, delivered, seen, receiptMember, progress, compactReceipts
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

query conversationScreen(conversation: conversations):
  return conversations[conversation]

query inbox(c: cursor ?):
  return members where .principal = viewer first 50 by .conversation after c { conversation, chat: conversations[.conversation] }

query history(conversation: conversations, c: cursor ?):
  return messages where .conversation = conversation last 20 by .ordinal after c

query messageReceipts(conversation: conversations, c: cursor ?):
  return messages where .conversation = conversation last 20 by .ordinal after c { id, receipt: receipt(.) }

mutation send(conversation: conversations, text: text <=2000):
  require exists members[conversation, viewer] else NOT_MEMBER
  m = insert messages { conversation, sender: viewer, text, at: now }
  return m.id

mutation add(conversation: conversations, principal: principal):
  require exists members[conversation, viewer] else NOT_MEMBER
  insert members { conversation, principal } if absent
  return null

mutation leave(conversation: conversations):
  me = members[conversation, viewer] ! else NOT_MEMBER
  delete members[me]
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

The named family generates the mapped projection, reporting operations, runs
and member watermarks. Without overrides, names use the family prefix:
`chatReceipt`, `chatDelivered`, `chatSeen`, `chatMember`, `chatProgress`,
`chatCompact`, `chatRuns`, `chatDeliveredOrdinal` and `chatSeenOrdinal`.
`member .conversation, .principal` maps membership coordinates; `counter`,
`floor` and `count` name the scope counter, membership floor and message count.
The engine allocates each message ordinal atomically, captures the number of other members, and stamps each join at the current high ordinal. Omit these fields and the counter from writes; supplied values refuse `E_RECEIPTS_OWNED`. Failed/no-op inserts consume no ordinal. Receipt scopes cannot be deleted by application writes, so their counters cannot reset; archive them with an ordinary field. Sends require current membership and a readable scope; a newly created scope allows its first join. Read/insert rules cannot depend on assigned accounting fields. Multiple distinct families
may coexist, with at most 50 members and 64 disjoint runs per member.
Membership must be group-readable and synced in full; malformed declarations refuse `E_RECEIPTS_CLAUSE`. Unsupported mappings name the field and reason at that clause. Progress fields and
runs refuse ordinary writes with `E_RECEIPTS_OWNED`. Deleting a member retires their runs atomically, even for an authorized
service outside the runs audience. Generated primitives cannot be shadowed by
application declarations; extra unique keys and caps are allowed.

Delivery merges intervals and compacts covered runs before enforcing the
64-run cap. It crosses only deleted or expired positions, with at most 1,024
unique position probes per call. Longer holes save partial progress while
recording the full input interval. At saturation the SDK calls the bound
compaction operation in a separate transaction, then retries delivery with a
fresh id when the prefix or runs advance. A live blocker stops that interval;
later runs still merge. Long gaps persist partial endpoints across calls. `RUNS_FULL` refuses a disjoint 65th run; merged runs free their slots
before the count. Replaying its write id returns that success.
Maintenance success never acknowledges delivery. Each step
uses the ordinary meter; a refusal rolls back its transaction.
Sends predict in ordinary history with `pending: true`, after the highest ordinal held for that group and in this device's submission order. Settlement replaces provisional positions with server ordinals, so rows can move. The confirmed counter stays unchanged; provisional recipient counts are zero and never enter accounting. Scope creation and joins predict with held authority and coverage, including the creator's membership. Missing acquisition/authority or an exhausted safe-integer position queues without a row. Existing membership updates/removals, delivery, compaction and seen queue without prediction to preserve settled accounting. Generated progress excludes pending messages; member/progress return null for a pending membership, and projections return null for pending messages and exclude pending recipients. The SDK never collects provisional rows as delivery. Pending metadata uses the ordinary existence classifier (guide client). A mutation refused by a provisional receipt value or null queues without prediction until settlement, including rules and derived counts. Replaying a write id allocates nothing twice. Reports assert the recipient's
own observation; no protocol can prove that a person actually read a message.

For custom semantics, use the complete expert recipe in `guide manual-receipts`.
It retains `reports delivery of ... by ...` and the same SDK behavior.
An existing starter store may replace that recipe with the clause in one
schema adoption: keep names, columns, indexes, membership floors and counters;
remove declarations the clause generates, explicit run deletion from leave,
and authored allocation, recipient counts and join-floor writes. Existing rows survive; no backfill invents delivery. Other manual
layouts keep working and require an explicit data migration before opting in.
Upgrade engines and devices together; v4 changes the capability and delivery
fingerprint, retiring old SDK debt for recollection.

The older `useReceipts` history-walking hook does not scale to a large group:
automatic paging and receipt writes can stall sends and hit the examined-row
ceiling. Migrate it to the SDK reporter and the visible-screen hook below.
When migrating, remove its delivery debt,
automatic history `loadMore()` and background `progress` polling writers
when adding `reports delivery`. Keep the visible screen's `seen` report.
Replace the mounted `progress` read with `receiptMember`; its `ahead` messages
otherwise keep acquiring history through SDK delivery.
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
intact. Use ordinary search for current and retained hits in either link state
(`guide search`). An ordinary history can ask the
server before acquisition or past its horizon; a left group's retained page
stays local.

The manual recipe's contiguous intervals assume no deletion or expiry; the
generated form includes bounded gap compaction.

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

Every SDK report and compaction sends its binding's fingerprint; the server checks it under the
writer. Compaction requires the fingerprint. Unrelated generation changes preserve
unchanged bindings.

`E_DELIVERY_BINDING` means a report's binding changed or was removed. The SDK
drops that binding's debt and collects under the current fingerprint; it
does not retry the old report. Compaction also refuses omission.

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
