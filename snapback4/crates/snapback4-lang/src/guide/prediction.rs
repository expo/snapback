//! The mutation's eligibility and the device's decision on a call.
pub(super) const CARD: &str = r##"# Prediction: queued writes and local rows

`pending` means the write has not settled; `sent` means the server committed it.
A predicted row carries `pending: true`; a pending write may have no predicted row.
Writes that do not predict show pending with `usePendingWrite(op)` from
`snapback4/react`; pass a saved mutation id as its second argument to observe
that write after reload. See `guide writes` for terminal receipts and acquisition.
`client.acquired` and `useAcquired()` say whether snapshot and catch-up finished;
unacquired writes without a row report `queued without a row: not acquired yet`.

The web device trusts the backend compiler's structural admission; it does not
repeat that analysis locally. It still validates arguments, rows, rules, coverage
and runtime budgets. A hand-built or corrupted backend can therefore produce
local query answers or predictions where a native device reports a structural refusal. The server
rechecks every submitted mutation before committing it.

Run `snapback4 check --residency --verbose` and `snapback4 why <op>` to see read sites:
- `held`: the viewer's whole synced partition, or an inherited maintain.
- `horizon`: a synced `last N` window; a held row can be read, but a miss
  cannot prove absence beyond the horizon, so that call may queue without a row.
- `server`: online-only data; a mutation reading it has `predicts: never`.

`predicts: eligible` requires device-readable sites and synced writes;
the call still needs its facts on this device and must fit the meter and rules.
`mutation name(args) predicts:` asserts this eligibility: `check` refuses
`E_NOT_PREDICTABLE` at the header if a server site makes it `never`, with
the reason and rewrite. It does not promise prediction on every call.
Every `check` summarizes mutations that never predict, insert arms that
never predict, and eligible mutations whose reads can queue without a row
past a horizon, even on an unchanged program. `why` qualifies the heading:
`predicts: eligible except past the horizon at …`, naming each read and site.
A loss of eligibility
produces one `N_NOT_PREDICTABLE` note per mutation, listing distinct root
causes with deduplicated sites and rewrites.
Every mutation can queue on the local client; eligibility is not a promise
that every call produces a predicted row. Native reads also need their module.

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

```quarry
table drafts:
  owner: principal
  body: text <=200
  by byOwner: owner, id
  cap 100 by owner
  read <- .owner = viewer
  insert <- .owner = viewer
  update <- .owner = viewer
  sync to .owner

table notes:
  owner: principal
  body: text <=200
  at: time
  by byOwnerTime: owner, at, id
  read <- .owner = viewer
  insert <- .owner = viewer
  sync to .owner last 100 by byOwnerTime

maintain noteCounts: count notes by owner
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

`why countedPost` identifies the `online only` maintain: opting a maintain
out of sync makes mutations reading it `predicts: never`. `notifyPost` stays
eligible: the server decides the effects at commit. Presence deciding rows,
a refusal or the returned value costs prediction; so does fallible presence
work such as `falliblePost`, even inside an emit. For a presence-controlled
read, `why` retains the presence origin and names the consuming read's source
site. Moving that read before the guard is an author decision: it can refuse
on a branch that previously did not read. `check --fix` does not hoist it.
See `guide presence`.

## Set-state writes: likes and reactions

`upsert` predicts an update of a row the device holds. It predicts the insert
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
`check` labels an upsert with an unprovable insert arm `predicts: updates only`;
that means a held-row update remains eligible, not that the first write predicts.
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
`sync to members[.conversationId] last 500 by byConversation`, a first write
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
  unique byOwnerPost: owner, postId
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


## A call that cannot produce local rows

E_PREDICT means the device cannot establish this call's prediction from
its held facts or submission IDs. For example, an `upsert` missing beyond
a sync horizon cannot assume the target is absent. The local client keeps
the write queued without predicted rows and lets the server judge it;
observe its pending/failed/sent state instead of treating missing local
rows as success. Inspect `snapback4 why <op>` and the named site. Acquire
the required partition, or redesign the read to need held facts; never
invent an empty row or mint different IDs on replay.
"##;
