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

Only full sessions report delivery. A read-only reader never marks a message delivered: sign in with `{ scope: "read" }` and use `readOnly: true`, or narrow a full session. See `guide read-only`.

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
Sends predict in ordinary history with `pending: true`, after the highest ordinal held for that group and in this device's submission order. Settlement replaces provisional positions with server ordinals, so rows can move. The confirmed counter stays unchanged; provisional recipient counts are zero and never enter accounting. Scope creation and joins predict with held authority and coverage, including the creator's membership. Missing acquisition/authority or an exhausted safe-integer position queues without a row. Existing membership updates/removals, delivery, compaction and seen queue without prediction to preserve settled accounting. Generated progress excludes pending messages; member/progress return null for a pending membership, and projections return null for pending messages and exclude pending recipients. The SDK never collects provisional rows as delivery. Pending metadata uses the ordinary existence classifier (guide client). At compile time, a mutation that reads clause-owned or derived accounting becomes `predicts: never` and queues without a row. `check` prints one `N_RECEIPT_PREDICTION` note at the first dependency; `why <op>` explains it. An explicit `predicts:` assertion refuses with `E_NOT_PREDICTABLE`. The rule follows helpers, aliases, loops and all branches, including untaken branches. It includes receipt builtins; owned-field keys, filters and write targets; maintained aggregates and parent columns; whole-row builtin arguments, comparisons, collections and explicit returns. Ordinary sends, creates, joins, stable-id edits and reaction upserts still predict when they read only clean fields such as id/text. A receipt-derived unread count does not stop those sends: device predictions skip its maintenance. Its stored value remains the last settled value, and pending inserts, edits and deletes never enter a query-time recount. While its parent group has predicted source or member writes, a row-keyed count returns that settled value with `recountPending: true` and `complete: false`; affected ordinary aggregate groups also become incomplete. This is a settled snapshot, not an optimistic unread estimate or a lower bound. A pending new member has no count until settlement. The pending check uses the base and current overlay images, including deletions and both groups of a move. It caches O(pending) point reads per target/query; other groups keep their live counts and expiry. Deletes save ordinary group keys in the durable overlay, so an insert then delete still names its group after restart. Only a computed/receipt-derived group key, missing group field, or legacy no-image overlay without saved keys forces a table-wide fallback. An unpinned scan is incomplete if any group is dirty, but clean returned rows still recount normally. The answer flags do not distinguish a frozen snapshot from incomplete live counting, especially after scalar projection. Render every incomplete receipt-derived badge as a stable number with a quiet refreshing indication, never `L+`. After settlement, the ordinary live-count/expiry and coverage rules resume. A parent-key total computed only on read has no settled cache and returns null/incomplete while its source is pending. Server-maintained parent columns keep their existing unmarked synchronized-value semantics. Reading any of these values inside a mutation still makes it `predicts: never`, even before the write or in a later mutation. Receipt-derived sums remain server-only because they can overflow; target constraints and updates that can move a row-keyed member's count domain also prevent prediction. Member writes keep the member and source-group authority precondition; source writes do not run that member-write check. Both keep their ordinary write authorization. Deferred row-keyed maintenance keeps its full public reservation even for an online-only target, including `fanout × 4` written rows for a source write, and checks the recipient cap using only parent/expiry index keys. The compiler exports complete per-source `source_reservations`, calculated by the same functions the server uses, including ordinary private maintains in schemas without receipts. A device skipping receipt-derived or online-only public aggregate work pays the shared server worst-case reservation, including on insert; an ordinary server insert may charge less actual work. Receipt allocation pays a fixed 51-key allowance; successful inserts also pay for the server counter replacement without writing or reading a guessed counter on the device. Receipt-derived sums and counter scopes with additional data-dependent hooks make their writers server-only. Ordinary online-only aggregates keep predicting within their fixed reservation. Ordinary synced aggregates still execute their shared delta path. Private formulas and totals stay off the device. Every predicting source write also charges declared image/video list slots, even for null or empty cells, without taking the asset ledger: per slot, 2 rows written, 4 examined, 8 steps and 16,384 transient heap bytes. The implicit result of a final insert/update is the pending write image, not an authored whole-row read. Use a stable message id to predict an edit. Allocation has one runtime refusal guard: after touching provisional allocation, any error rolls back the overlay and keeps the intent queued. Receipt schemas without compiler classification also queue. Field names are static; arbitrary forged compiler metadata is outside the backend contract. No per-value taint or count-path traversal runs. A kept backend without the new capabilities opens with only affected programs downgraded: receipt-source writes, hidden effects, existing receipt readers and writes whose complete price cannot be recovered queue. Unrelated fully priced posts or conversation-title edits still predict offline under Kept. An old private-column projection without prices cannot identify hidden source effects, so every unpriced table writer conservatively queues, including unrelated profile saves and posts. This affects both Clique calibration apps. Supplying the bundled backend while offline does not replace Kept; prediction resumes at the first online adoption of that backend. With no private-column owner markers anywhere, the structural zero proof keeps unrelated zero-cost writers predicting. Outbox ids, arguments and delivery debt survive; see `guide offline-interactions` for the upgrade note. Replaying a write id allocates nothing twice. Reports assert the recipient's
own observation; no protocol can prove that a person actually read a message.

For custom semantics, use the complete expert recipe in `guide manual-receipts`.
It retains `reports delivery of ... by ...` and the same SDK behavior.
An existing starter store may replace that recipe with the clause in one
schema adoption: keep names, columns, indexes, membership floors and counters;
remove declarations the clause generates, explicit run deletion from leave,
and authored allocation, recipient counts and join-floor writes. Existing rows survive; no backfill invents delivery. Other manual
layouts keep working and require an explicit data migration before opting in.
Upgrade engines and devices together; receipt-derived counts require `receipt-derived-prediction-v1`, and complete source prices require `source-write-reservations-v2` (including maintained-column initialization). All-zero source plans omit reservation metadata and stamps; the device proves zero structurally. Other schemas carry the applicable capabilities, including projected maintained columns; older devices refuse them. Upgraded engines accept the previous capability set in kept backends and databases, preserve queued writes and delivery debt, and can then adopt the new schema. This prediction revision does not change delivery fingerprints. Receipt v4 changes the capability and delivery
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

`useSeen` from `snapback4/react` packages visible seen reporting. The compiler
emits `api.receiptFamilies.chat` from the clause above: `member` is
`api.receiptMember`, `seen` is `api.seen`, and `mapping` records the scope
counter / joining floor / recipient count / delivered and seen progress.
Defaults and explicit overrides use the same descriptor. Generated TypeScript
and `why seen` expose the underlying names and rules; no string translation
belongs in the screen.

Keep **two independent reads**: ordinary bare retained history and current
receipts/decorations. Match decoration IDs; unavailable decorations leave
history intact and display no receipt claim. They do not authorize media or
membership. The hook observes only the generated member query. It never pages
history, mounts `progress`, or advances delivery.

```ts
import { usePage, useSeen } from "snapback4/react";
import { api } from "./snapback/generated/api";
function useReceipts(conversation: string, active: boolean, visibleIds: ReadonlySet<string>) {
  const history = usePage(api.history, { conversation });
  const through = Math.max(0, ...history.items.filter(m => visibleIds.has(m.id) && !m.pending).map(m => m.ordinal));
  useSeen(api.receiptFamilies.chat, { scope: conversation, through, active });
  const decorations = usePage(api.messageReceipts, { conversation });
  return { history, decorations };
}
```

`visibleIds` comes from the actual viewport (for example FlatList's
`onViewableItemsChanged` on web/native); intersect those IDs with the **current**
history rows, so settled positions replace provisional ones and withdrawn rows
cannot be reported from stale view tokens. `active` combines route focus with
app foreground. A browser may use an IntersectionObserver and document visibility;
React Native can use list viewability and AppState. The SDK assumes neither.
Neither acquisition nor a loaded/background page means viewed. Reset viewport
IDs on account, backend and conversation changes.

Within one mounted client/family/scope, two screens share progress, one membership
read and one admission/pending call. Progress coalesces monotonically until a
terminal failure discards its target as below. Lower positions and duplicates
are suppressed against confirmed member seen/join floors. Loading, denial,
missing/pending membership, changed membership identity, session/viewer change
and client/store/generation resets discard local progress and fence late outcomes.
The next committed visible render can supply current confirmed positions again.
Final unmount releases the observation, timers and unadmitted progress. Admitted
writes survive in the ordinary SDK outbox, including restart; there is no second
journal. A reload reads confirmed member progress and reports the next real view.

The returned `{ state, through, why, retry }` describes local work, not a server
receipt: `idle`, `admitting`, `pending`, `retrying`, or `failed`. Known
`E_ADMISSION`, `E_ADMISSION_STORE`, `E_ADMISSION_TIMEOUT` refusals retry after
1 second, doubling to 60 seconds, at most eight times while a screen is active.
Reconnect or `retry()` after repair wakes those refusals. Other terminal failures,
including unknown thrown outcomes, remember the rejected position and reset the
target to `max(joining floor, acknowledged)` before publishing `failed`. A later
active update with a different safe integer above that covered floor clears
`failed` and admits a new attempt, even below the rejected position. Repeated
input, reconnect and `retry()` never resubmit the rejected position. Reset clears
the remembered rejection along with local progress.
Hidden screens collect no new positions and dispatch no retry. A `read` label
still requires both recorded delivery and seen; removal never claims reading.

Render a clock while a message is `pending`; after settlement render `receipt`
from `messageReceipts`, matched by message id, beside the bare history
as one tick (`sent`), two ticks (`delivered`) or two colored ticks (`read`). A
typing indicator is an expiring table (`guide reads`); who is connected now is
`connected[p]` (`guide presence`)."##;
