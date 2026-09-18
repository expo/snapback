//! The sync card. Quarry examples are compiled by tests/guide.rs.
pub(super) const CARD: &str = r##"# Sync: the viewer's partition is the unit of sync

```quarry
table notices:
  body: text <=500
  at: time
  by byTime: at, id
  public 'notices are public'
  insert <- deny
  update <- deny
  delete <- deny
  sync last 100 by byTime            -- everyone holds the newest 100

table todos:
  ownerId: principal
  title: text <=200
  by byOwner: ownerId, id
  read <- .ownerId = viewer                 -- exactly the audience
  insert <- .ownerId = viewer
  update <- .ownerId = viewer
  delete <- .ownerId = viewer
  sync last 500 by byOwner      -- each row reaches the principal in the column

table participants:
  threadId: threads
  personId: principal
  addedBy: principal
  unique byThreadPerson: threadId, personId
  by byPersonThread: personId, threadId, id
  cap 50 by threadId
  read <- exists participants[.threadId, viewer]
  insert <- exists participants[.threadId, viewer]
  delete <- .personId = viewer
  sync by .personId   -- the target has two principal columns: name the recipient

table threads:
  subject: text <=200
  read <- exists participants[.id, viewer]
  insert <- allow
  update <- deny
  delete <- deny
  retain delivered-history                  -- a device keeps these rows after it leaves the thread
  sync to participants[.id] by .personId    -- each row reaches every principal with a participants row whose threadId matches
```

`sync [last N by index]` infers its audience from the read rule. Explicit
`sync public` and `sync to ...` remain valid and must agree with that rule.
The read rule must be exactly the audience — `public`, `.col = viewer`, or
`exists t[.a, .b, viewer]` — so a device never holds a row it may not read
and never misses one it may; a non-service second disjunct or an extra conjunct is
refused with the rewrite. The target table needs a unique index over
`(a, b, principal)` and an index leading with `(principal, a, b)`; when it
has several principal columns, `by .col` names the recipient. Every insert
rule branch must also prove the caller already has that audience grant, for
example `exists participants[.threadId, viewer]`, or that this mutation
created the group. `.personId = viewer` alone is refused because it would
let anyone join. Audience keys are immutable or guarded on update. These
target audiences require every content prefix and corresponding target
group column to be non-optional: `null` cannot name a device partition, so
`sync to participants[.threadId]` requires both copies of `threadId`.
checks also cover insert-if-absent and upsert. The horizon
`last N by index` bounds what a device acquires per group. The server sends
an acquisition boundary: a safe suffix starting at a delivered selected key,
or `whole` when fewer than N rows were selected, including an empty group.
A descending page on that index is complete while it stays at or above that
boundary by key; crossing it returns only the known suffix with `complete: false`
and unknown coverage, so the online client asks the server. Without a boundary
the group is unknown. Ascending reads and other indexes keep their ordinary
horizon rule. An unheld put below the boundary is dropped; a held row whose key
moves below it remains available to point reads but is excluded from the suffix.
A put moving above the boundary joins the suffix. Continuous renewal keeps the
boundary. A join reacquiring retained history leaves the horizon unknown until
a full replacement snapshot acquires the group again. Boundaries persist with
acquisition and publish with staged snapshot rows only after catch-up. The additive sync field
`acquisitions` contains `{ at, table, index, group, floor? }` markers before
`events[at]` (or at the end): missing `floor` begins acquisition; completion
carries `whole` or the hex-encoded index key. A completion without a matching
begin is ignored and reported in device metadata (`device:acquisition-report`).
A keyed completion starts at the oldest current readable selected key delivered
by that acquisition. It narrows upward if an unselected, current readable row
with no write after the join has a key at or above that boundary: that row was not acquired.
Only row puts and deletes count as writes; membership joins and scopes do not.
If no delivered key proves a complete suffix, the group stays unknown. Selection
is at the join commit; its historical floor never decides completion or appears
on the wire. `whole` proves the same claim without a lower bound, including when
every selected row has since disappeared or become unreadable.
Snapshot replies echo `after`; the device checks every
continuation and requires the terminal page before catch-up publishes coverage.
Empty groups consume page room too, so even a page with no rows can continue.

A synced table with no horizon delivers every row of
every group a device holds, at every cold start, as the table grows;
`check` notes it (N_NO_HORIZON) unless the group cannot grow (one row per
group, or a `cap` over the group), or its whole partition supplies an eligible
mutation's reads or insert proof (`guide prediction`). For an eligible mutation's
ascending page or a page on a different index, the note names the prediction
that a horizon would cost instead of recommending that horizon.
Suppression is reader-dependent, even for an uncapped `sync public` table.
Eligible mutations that require whole-partition coverage can suppress this
advice. An absent note does not certify bounded acquisition or a safe
cold-start size.
Inspect the table's `sync`, horizon and group `cap` with `check --residency --verbose`.
A snapshot arrives in pages the client
asks for 4,000 events at a time (2,000 by default on the wire, 10,000 at
most), each applied in its own transaction. `POST /sync` takes JSON
`{ from, limit, after, stream, pending, store_id? }`: up to 256 pending write IDs of
1–128 UTF-8 bytes, with the cursor, in at most 262,144 body bytes (256 KiB).
Oversize bodies, including chunked ones, return HTTP 413 `E_INPUT`; malformed
fields return HTTP 400 `E_INPUT`. Continue snapshots with `after: next`;
`stream: true` follows the log even from zero. There is no GET sync route.
A changed sync `store_id` (echoed from the previous reply), or a reply behind
its own requested watermark without one while that capture is still current, discards the old partition and held/left history and
requires acquisition again, keeping unsent writes without their predicted
rows and retiring known receipts so those writes are never replayed to the
replacement store. The reset persists the obligation to adopt that store's
backend before acquisition publishes, including after retry or offline reopen.
Replacement observation immediately invalidates freshness, remembered answers
and watch snapshots; delayed reads from the previous store are retried.
Change polls echo `store_id` and return immediately on a mismatch or a lower
head. Reconnect probes carry the identity and head, checked before local
freshness returns; a matching identity needs no extra sync.

## A restored backend store

A matching
`store_id` with a lower head refuses `E_STORE_RESTORE`: the backend was
restored or shrank. Sync halts and reads refuse, including after offline
reopen; the watermark and outbox stay in place. Stop the client and use a
fresh device store and outbox for that restored backend. Retry and backend
adoption do not silently reacquire the same identity.
A lower poll or probe head invalidates freshness and requests sync confirmation;
only an authenticated sync reply at the captured acquisition persists a restore
refusal. A notification alone cannot halt the client. Each native owner's
interpreter and loaded module digest belong to its adopted store identity;
another owner's replacement requires adoption and module reload before local
reads or prediction resume.
Orphan known receipts keep their source identity until ownership is resolved;
foreign known receipts retire, and unknown writes transfer without predictions.
First identification of a legacy acquired device discards retained left-group
history even on the same database; already-left groups cannot be reacquired.
Joining a group delivers its
rows; leaving it delivers one scope tombstone, and `retain` says whether the
device keeps what it was given (`delivered-history`) or drops it
(`until-revoked`, the default). Retained rows survive a leave whatever the
horizon; the horizon bounds what a device acquires, never what it keeps.
The same boundary rule applies after leaving: a page within the acquired suffix
is complete, crossing the floor is incomplete, and `whole` proves the group's
end even on a horizoned table. A snapshot from a server without `acquisitions`
leaves newly acquired groups unknown, so local pages fall back online.
A read pinning the left group answers from those rows on the device online
and offline, through a query without a membership `require`; the server
cannot serve that retained history. Replacement snapshots keep left groups
and replace held groups with their current acquisition. A device query returning
independent fields of a record can compose when one component retains history
and another needs the server. Each field may hold at most one read; the query
must be cursor-free, not declared `held`, and have no reading `require`.
A found point read of a delivered left row also composes; a missing point
keeps ordinary coverage and fallback. `check --residency` names the proven
components. The second local observation supplies every component that would
stay local as its own query; the one server reply supplies those that need it.
The composed read is `complete` only when the server answer and
every locally kept component are complete; it reports `fresh: false` with `since`
(the last sync's time, which the locally kept components are as of) and no continuation. Offline or after a failed request, the whole local
answer stands.
Composition is never entered while a predictable write is unobserved; the whole local answer stands until it settles.
Every other shape keeps the separate-query recipe: keep a
left-group read in its own query, since a mixed query without a component
plan returns the whole server answer online when no predictable write is awaiting observation,
and the whole device answer offline.
An inherited aggregate stays until-revoked even when its source retains delivered-history; it has no target horizon.
A table without `sync` is online-only. A `maintain`
grouped by the audience columns inherits sync and is delivered as a value row.
`online only` on a table documents the absence of sync; on a maintain it opts
out of inheritance. Both lines absent on a table still means online only.
See `guide residency` for operation classes and cold acquisition measurements.

## Refused sync declarations

E_QUARRY_RETAIN means a table repeats its retention declaration or uses
an unknown policy. For example, `retain forever` is not a policy; choose
one `retain delivered-history` line to keep already delivered history after
leave, or one `retain until-revoked` line to drop it. Remove any second
retain line. Retention changes what a device keeps; it does not grant new
access to a departed group on the server.

E_SYNC means the sync declaration cannot deliver exactly its authorized
audience. For example, `read <- .ownerId = viewer` cannot pair with
`sync public`; use `sync` to infer delivery to the owner. For group delivery,
match the read rule's membership probe, declare its unique group/principal
index and recipient-leading index, and guard new memberships with existing
membership or creation of the group. Follow the message's rule term,
column or index; do not make private rows public just to enable sync.
"##;
