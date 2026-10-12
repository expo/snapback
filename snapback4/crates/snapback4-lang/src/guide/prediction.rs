//! The mutation's eligibility and the device's decision on a call.
pub(super) const CARD: &str = r##"# Prediction: queued writes and local rows

**Start here:** Write ordinary mutations against synced data; the client predicts when it holds the needed facts and otherwise queues. This mutation is from the default starter's todos schema; show pending writes even when there is no predicted row.

```quarry
mutation add(title: text <=200):
  return insert todos { title, done: false, ownerId: viewer }
```

- `E_NOT_PREDICTABLE`: a `predicts` assertion reads server data; remove that dependency or drop the assertion and accept queued execution.
- `E_PREDICT`: this device lacks a required fact; keep the queued write pending until sync rather than treating a missing local row as failure.
- `N_HORIZON_GUARD`: an existence guard used only for retry deduplication blocks prediction; remove it and reuse the mutation write id.

## Reference

```quarry
table drafts:
  owner: principal
  body: text <=200
  cap 100 by owner
  read <- .owner = viewer
  insert <- .owner = viewer
  update <- .owner = viewer
  sync to .owner

table notes:
  owner: principal
  body: text <=200
  at: time
  read <- .owner = viewer
  insert <- .owner = viewer
  sync to .owner last 100 by .at

view noteCounts: count notes by .owner
  read <- .owner = viewer
  online only

effect notify

mutation saveDraft(id: drafts, body: text <=200) predicts:
  draft = drafts[id] ! else NOT_FOUND
  update drafts[draft] { body }                 -- held site

mutation post(body: text <=200) predicts:
  insert notes { owner: viewer, body, at: now }  -- no existence guard needed

mutation guardedPost(id: notes, body: text <=200):
  if not exists notes[id]:                      -- horizon site: a miss is unknown
    insert notes { id, owner: viewer, body, at: now }
  return null

mutation countedPost(body: text <=200):
  total = noteCounts[viewer]                    -- server site: predicts never
  insert notes { owner: viewer, body, at: now }
  return total

mutation notifyPost(body: text <=200, recipient: principal) predicts:
  insert notes { owner: viewer, body, at: now }
  if not exists connected[recipient]:           -- presence decides only the emit
    emit notify { recipient }
  return null

mutation falliblePost(body: text <=200, recipient: principal):
  insert notes { owner: viewer, body, at: now }
  emit notify { ratio: 1 / connected[recipient] } -- can divide by zero: never
  return null
```

`pending` means the write has not settled; `sent` means the server committed it. A predicted row carries `pending: true`; a pending write may have no predicted row. Writes that do not predict show pending with `usePendingWrite(op)` from `snapback4/react`; pass a saved mutation id as its second argument to observe that write after reload. See `guide writes` for terminal receipts and acquisition. `client.acquired` and `useAcquired()` say whether snapshot and catch-up finished; unacquired writes without a row report `queued without a row: not acquired yet`.

The web device trusts the backend compiler's structural admission; it does not repeat that analysis locally. It still validates arguments, rows, rules, coverage and runtime budgets. A hand-built or corrupted backend can therefore produce local query answers or predictions where a native device reports a structural refusal. The server rechecks every submitted mutation before committing it.

`predicts: eligible` requires device-readable sites and synced writes;
the call still needs its facts on this device and must fit the meter and rules.
`mutation name(args) predicts:` asserts this eligibility: `check` refuses
`E_NOT_PREDICTABLE` at the header if a server site makes it `never`, with
the reason and rewrite. It does not promise prediction on every call. Remove
the named server dependency to keep `predicts`, or remove that assertion and let the client queue
without prediction.
Every `check` summarizes mutations that never predict, insert arms that
never predict, and eligible mutations whose reads can queue without a row
past a horizon, even on an unchanged program. `check --verbose` keeps the full site lists and rewrites; plain `check` gives the verdict and summary first. `why` qualifies the heading:
`predicts: eligible except past the horizon at …`, naming each read and site.
A loss of eligibility
produces one `N_NOT_PREDICTABLE` note per mutation, listing distinct root
causes with deduplicated sites and rewrites.
Expiring scans admitted by the rule in guide programs run only on the server;
the device queues these mutations without executing their bodies. Query
entries refuse mutations and jobs; they cannot be used to run that body locally.
Every mutation can queue on the local client; eligibility is not a promise
that every call produces a predicted row. Native reads also need their module.
Persisted writes without a valid integer prediction clock queue without rows;
their write and row IDs survive for submission to the server. Direct device
`predict` calls require an explicit integer `now`; `admit` and `enqueue` clear
prediction eligibility and predicted rows when that clock is missing or invalid.

Every device read authorizes a provisional row with its table's read rule for
the device principal, against all pending predictions layered over delivered
rows. This includes reads inside a predicting mutation, pages, counts, probes
and watches. A definite denial hides the row without making the read unknown.
Unknown authorization hides the row and makes the read incomplete; an exhausted
read meter cuts the result without showing the row. Rule probes see raw combined
state, with no recursive read checks: pending witnesses count as present;
delivered witnesses and absences need current coverage. Retained-only witnesses
and Left groups are unknown. A decisive disjunct can still authorize the row.
Delivered rows keep their server authorization.

During prediction, membership coverage, retention checks and provisional-row
authorization share a separate device allowance with the ordinary operation's
ceilings. Physical witness scans, including expired siblings and aggregate
sources, charge examinations and allocations to that allowance and stop when
it runs out. Exhausting it queues the mutation without predicted rows.
The server's point-read rule-probe reservation still spends the mutation meter,
including when synced rows are trusted; only additional device authorization
work spends the separate allowance. A mutation-meter cut can refuse with `E_BOUND`.
Queries continue to charge authorization to their query meter.

An expiring cap counts live occupants; expired physical rows can remain until
swept. Checking occupancy may need a bounded live recount. Neither a held
snapshot nor reacquisition proves the server's occupancy or recount cost.
Inserts, missing upserts and moves into an expiring capped group queue without
predicted rows. Updates within the same group and deletes can still predict
under the ordinary rules. Observe the queued write's settlement (guide writes).

An unreadable output does not prevent prediction. For example, a moderation
report predicts but stays invisible to its writer until settlement removes or
replaces the overlay. A later pending grant can make a row visible; a later
pending revocation hides it immediately. A mutation may predict using a definitive denied input as absent.
An unknown provisional input cannot establish that read and may queue without rows.

The language card's `createRoom` predicts and its room is visible through the
membership inserted later in that call. An edit of a message retained after
leaving its conversation also predicts, but its new image is hidden; refusing
the write restores the readable delivered history. `writeForms` keeps its
readable outputs while hiding unreadable or unknown ones. Static eligibility
and `predicts:` assertions are unchanged. The declared timeline still skips
foreign engine-owned inbox copies before writing them. Ordinary recipe fan-out
predicts all its copies and hides those whose `readerId` differs from the viewer.

`why guardedPost` identifies the horizon read. The client-minted mutation id
already dedupes a retry for that principal; reuse that write id when retrying.
A fresh mutation id is a new write, even if an application row id is reused.
Adding `exists notes[id]` only for retry dedupe costs prediction on a miss
past the horizon. Keep guards that express an actual application requirement.
The argument row id and the mutation write id are separate identities:
retrying the same write id dedupes that mutation for that principal; a new
write id with the same row id is a different write.
`require not exists notes[id] else DUPLICATE` on an argument id also gets a
persistent `N_HORIZON_GUARD` note: remove it only if its purpose is retry dedupe.
The note is limited to codes with `DUPLICATE`, `RETRY` or `DEDUPE` words;
`else EVENT_REMOVED` expresses an application invariant and gets no such advice.
`N_NO_HORIZON` stays silent for a table whose whole partition supplies an
eligible mutation's point/exists read, rule probe or insert proof. A rule
probe against a live aggregate also needs its expiring source without a
horizon, and that dependency appears in the persistent prediction summary.
Ordinary pages still get growing-table advice; they do not prove absence.
If an eligible mutation reads `first N`, or uses a different index from the
suggested horizon, the note names the mutation that would lose prediction
instead of offering the horizon rewrite. A `last N` page on the horizon's
own index may keep the rewrite; a call still queues if its page exhausts
the acquired horizon.

`why countedPost` identifies the `online only` view: opting an aggregate view
out of sync makes mutations reading it `predicts: never`. `notifyPost` stays
eligible: the server decides the effects at commit. An infallible point read
used only by an effect payload is **server-only, feeds an effect** in `why`.
The device skips that read and its exclusive local bindings. The server evaluates
and charges their actual values with ordinary authorization. Expiring rows,
read-through authority, rule probes and live counts keep ordinary read residency.
A once-key stays in the prediction body and pays its runtime allocation charge,
even when its payload is skipped. Online-only key sources stay server-only.
No hoisting is needed for an ordinary emit from an online-only table:

```quarry
effect notify

table profiles:
  principal: principal
  displayName: text <=80
  unique principal
  public 'Profile names are public'
  online only

table members:
  chat: id
  principal: principal
  unique chat, principal
  cap 50 by chat
  read <- exists members[.chat, viewer]
  sync to members[.chat]

table messages:
  chat: id
  sender: principal
  body: text <=2000
  read <- exists members[.chat, viewer]
  insert <- .sender = viewer and exists members[.chat, viewer]
  sync to members[.chat] last 500 by .id

mutation send(chat: id, body: text <=2000) predicts:
  require exists members[chat, viewer] else NOT_MEMBER
  message = insert messages { chat, sender: viewer, body }
  for p in members where .chat = chat:
    if p.principal != viewer:
      if not exists connected[p.principal]:
        senderDisplayName = profiles[principal = viewer].displayName ?? 'Someone'
        emit notify { targetUserId: p.principal, chatId: chat, senderDisplayName, preview: slice(body, 0, 80) }
  return message
```

The server can still refuse this send at a resource limit: it charges payload work the device omits. On refusal, the SDK restores settled rows.
Presence deciding rows, a refusal or the returned value still costs prediction;
so does fallible presence work such as `falliblePost`, even inside an emit.
A read also used by a condition, write, require, return or loop domain keeps
its ordinary prediction requirements. `! else CODE`, `require`, potentially
overflowing arithmetic and division without a nonzero proof are not infallible
payload work. For a presence-controlled read outside this class, `why` retains
the presence origin and the consuming read's source site. `check --fix` does
not hoist it: moving fallible work can introduce a refusal on another branch.
Effect arms can change server charges (`guide effects` and `guide presence`).

## Set-state writes: likes and reactions

`upsert` predicts a held-row update when every changed non-null unique key and
destination cap group has complete readable coverage. Unchanged keys/groups need
no new proof; null unique keys do not collide. Expiring cap moves queue because
a device cannot prove server physical occupancy. It predicts the insert
of a row the device lacks only when the synced group is held with no horizon,
both the key and the materialized insert image prove readability (public rows,
or a viewer-keyed rule), and every secondary unique lookup and affected cap
group is fully covered by that viewer-readable partition. Key columns, patch
and defaults all contribute to the image; changing its audience cannot grant
read authority. A hidden unique collision or cap population cannot be ruled
out locally; a whole-table cap needs the whole public table. A left group,
a horizon, or any unproved condition queues without a predicted row. For boolean
membership `insert ... if absent` to set and `delete` to clear read most
plainly; with the whole viewer partition held, the device can predict both. For a multi-valued
reaction, use `upsert` to insert when absent and update the held row when present.
An explicit existence branch needs a whole partition; a horizon miss is still unknown.
`check --residency` labels an unprovable insert arm `predicts: conditional updates`
and explains each update constraint. Missing population coverage queues without a row.
`insert ... if absent` with an unprovable insert says `predicts: inserts queue
without a row`. The summary and residency line name the horizon, read rule or
uncovered unique/cap group; changing the write spelling does not supply that proof.
An id supplied to `insert ... if absent`, including a parameter or helper result,
also needs the `byId` absence proof. Only an id minted by `new` during the call
(including the omitted id) can use a covered secondary unique key instead.
`check` preserves a local's `new` fact across unrelated requires, reads, emits
and writes. A direct assignment tracks the local's new value; a branch or loop
that may assign it discards its fact. Other locals keep their mint facts.
A private viewer-keyed table cannot prove absence by an unrelated caller-supplied id.

Membership-scoped reactions and likes need particular care. With
`sync to members[.conversationId] last 500 by .id`, a first write
cannot prove absence outside the window. Even without that horizon, a key
`(messageId, principal)` does not decide `exists members[.conversationId, viewer]`:
it omits `conversationId`. A viewer-keyed rule `.principal = viewer` with no
horizon and `cap 50 by principal` can predict a first write, as can a fully
public table with `cap 50 by messageId`. Those change the product: the former
shows only the viewer's own reactions and caps per viewer; the latter discloses
all reactions to everyone. Neither preserves private conversation reactions.
A membership rule can also work without a horizon when every unique key and cap
group pins `conversationId` and the device holds its positive membership witness;
for example, a key `(conversationId, messageId, principal)` and
`cap 50 by conversationId, messageId`, with no other uncovered unique key.
That acquires the whole conversation's reactions, not just children of held messages.
If none fits, this write queues until the server answers; show its pending state.
Use the returned write's `state` and `client.onWrite` to follow settlement
(`guide writes`); a queued insert has no row whose `pending` flag you can render.

An `after insert <- exists t[key]` postcondition accepts a local hit. A miss
predicts a refusal only when the key proves readability and its synced group
is fully held without a horizon. Otherwise the insert or upsert queues without
a predicted row, even if the source row's own insert proof passes.

```quarry
table likes:
  owner: principal
  postId: id
  unique owner, postId
  cap 1000 by owner
  read <- .owner = viewer
  insert <- .owner = viewer
  delete <- .owner = viewer
  sync to .owner

mutation guardedLike(postId: id, allowed: bool) predicts:
  chosen = new
  require allowed else NOT_ALLOWED
  insert likes { id: chosen, owner: viewer, postId } if absent

mutation setLike(postId: id, liked: bool) predicts:
  if liked:
    insert likes { owner: viewer, postId } if absent
  else if exists likes[viewer, postId]:
    delete likes[viewer, postId]
  return null
```

## Operations

Run `snapback4 check --residency --verbose` and `snapback4 why <op>` to see read sites:
- `held`: the viewer's whole synced partition, or an inherited aggregate view.
- `horizon`: a synced `last N` window; a held row can be read, but a miss
  cannot prove absence beyond the horizon, so that call may queue without a row.
- `server`: online-only data; a mutation reading it has `predicts: never`.

## Refusals

E_PREDICT means the device cannot establish this call's prediction from
its held facts or submission IDs. For example, an `upsert` missing beyond
a sync horizon cannot assume the target is absent. The local client keeps
the write queued without predicted rows and lets the server judge it;
observe its pending/failed/sent state instead of treating missing local
rows as success. Inspect `snapback4 why <op>` and the named site. Acquire
the required partition, or redesign the read to need held facts; never
invent an empty row or mint different IDs on replay.

A plain `insert` still predicts without proving its caller-supplied id or any unique-key value absent: if a row this device cannot read already has that id or value, the server refuses `E_RULE`, the write settles `failed` and its pending row is withdrawn. An omitted id or `new` is minted for the call and never collides this way. Such an unproved insert (or cap group) also makes any later refusal in the same mutation non-final: the write queues (`E_PREDICT`) and the server's refusal is the one reported.

## Read-through upserts

A read-through child uses its parent key to prove readability. With a live,
current parent and the child's whole audience partition acquired, an upsert
keyed by that parent can predict both arms under the constraint rules below.
It keeps the same server
return value and authority as any upsert; a refusal rolls back the prediction.

```quarry
table messages:
  body: text <=2000
  cap 100
  public
  sync public

table reactions:
  message: messages
  principal: principal
  emoji: text 1..32
  immutable message
  unique message, principal
  cap 50 by message
  read through .message
  insert <- .principal = viewer
  update <- .principal = viewer
  sync

mutation setReaction(message: messages, emoji: text 1..32) predicts:
  return upsert reactions[message, viewer] { emoji }
```

Private membership parents work the same way; do not make parents public to
obtain prediction. Every secondary unique key and cap group must also pin the
parent or independently prove a wholly readable partition. A parent may have a
horizon if this parent row is held; a child horizon still prevents insert
prediction. Unknown coverage, retained-only or provisional parents, absent or
expired parents, and exhausted allowances queue a missing upsert without a row.
An expiring cap group prevents inserts and group moves. Held updates preserve
unchanged constraints; changed non-null unique keys or cap groups require their
own coverage. An immutable `(parent, principal)` key and `cap 50 by parent`
therefore allow both the first reaction and later emoji replacements. `insert ... if absent` on a child remains server-only.

For that remaining case, an explicit `if exists reactions[message, viewer]`
branch with `update` on a hit and `insert` on a miss is an application pattern,
not an equivalent expression rewrite: decide return values and effect order
explicitly, and keep the existence read's coverage and authority requirements.
It supplies no missing coverage. Prefer the upsert above for set-state writes.

"##;
