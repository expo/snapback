//! The mutation's eligibility and the device's decision on a call.
pub(super) const CARD: &str = r##"# Prediction: queued writes and local rows

`pending` means the write has not settled; `sent` means the server committed it.
A predicted row carries `pending: true`; a pending write may have no predicted row.
Writes that do not predict show pending with `usePendingWrite(op)` from
`snapback4/react`; pass a saved mutation id as its second argument to observe
that write after reload. See `guide writes` for terminal receipts and acquisition.
`client.acquired` and `useAcquired()` say whether snapshot and catch-up finished;
unacquired writes without a row report `queued without a row: not acquired yet`.

Run `snapback4 check --residency` and `snapback4 why <op>` to see read sites:
- `held`: the viewer's whole synced partition, or an inherited maintain.
- `horizon`: a synced `last N` window; a held row can be read, but a miss
  cannot prove absence beyond the horizon, so that call may queue without a row.
- `server`: online-only data; a mutation reading it has `predicts: never`.

`predicts: eligible` requires device-readable sites and synced writes;
the call still needs its facts on this device and must fit the meter and rules.
`mutation name(args) predicts:` asserts this eligibility: `check` refuses
`E_NOT_PREDICTABLE` at the header if a server site makes it `never`, with
the reason and rewrite. It does not promise prediction on every call.
Every `check` summarizes mutations that never predict and insert arms that
never predict, naming the first failed proof even on an unchanged program; `snapback4 why <op>` explains each site. A loss of eligibility
produces one `N_NOT_PREDICTABLE` note per mutation, listing distinct root
causes with deduplicated sites and rewrites.
Every mutation can queue on the local client; eligibility is not a promise
that every call produces a predicted row. Native reads also need their module.

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

`why countedPost` identifies the `online only` maintain: opting a maintain
out of sync makes mutations reading it `predicts: never`. `notifyPost` stays
eligible: the server decides the effects at commit. Presence deciding rows,
a refusal or the returned value costs prediction; so does fallible presence
work such as `falliblePost`, even inside an emit. See `guide presence`.

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
"##;
