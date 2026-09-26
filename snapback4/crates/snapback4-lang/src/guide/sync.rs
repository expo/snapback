//! The sync card. Quarry examples are compiled by tests/guide.rs.
pub(super) const CARD: &str = r##"# Sync: the viewer's partition is the unit of sync

Sync delivers each viewer's authorized rows to their device for live and offline reads.
A table's sync declaration chooses its audience and acquisition horizon.

```quarry
table notices:
  body: text <=500
  at: time
  public 'notices are public'
  insert <- deny
  update <- deny
  delete <- deny
  sync last 500 by .at, .id       -- everyone holds the newest 500, with id breaking time ties

query recentNotices(c: cursor ?):
  return notices last 20 by .at, .id after c

table todos:
  ownerId: principal
  title: text <=200
  read <- .ownerId = viewer                 -- exactly the audience
  insert <- .ownerId = viewer
  update <- .ownerId = viewer
  delete <- .ownerId = viewer
  sync last 500 by .id      -- each row reaches the principal in the column

table participants:
  threadId: threads
  personId: principal
  addedBy: principal
  unique threadId, personId
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

```text
sync [last N by .at]                           audience inferred from the read rule
sync public [last N by .at]                    everyone holds the same rows
sync to .col [last N by .at]                   each row reaches the principal in .col
sync to t[.a, .b] [by .col] [last N by .at]    each row reaches every principal with a
                                                 row in t whose (a, b) match; `by .col` names
                                                 the recipient column when t has several
```

`sync [last N by .at]` infers its audience from the read rule. Explicit
`sync public` and `sync to ...` remain valid and must agree with that rule.
The read rule must be exactly the audience — `public`, `.col = viewer`, or
`exists t[.a, .b, viewer]` — so a device never holds a row it may not read
and never misses one it may; a non-service second disjunct or an extra conjunct is
refused with the rewrite. Declare `unique a, b, principal` on the target; the compiler supplies
the recipient lookup index; when it
has several principal columns, `by .col` names the recipient. Every insert
rule branch must also prove the caller already has that audience grant, for
example `exists participants[.threadId, viewer]`, or that this mutation
created the group. `.personId = viewer` alone is refused because it would
let anyone join. Audience keys are immutable or guarded on update. These
target audiences require every content prefix and corresponding target
group column to be non-optional: `null` cannot name a device partition, so
`sync to participants[.threadId]` requires both copies of `threadId`.
Checks also cover insert-if-absent and upsert.
Read rules may add `or viewer = 'service:pusher'` (or several service grants);
sync infers its audience without them, so device snapshots and streams stay the same. The horizon
`last N by .at, .id` bounds what a device acquires per group. The server sends
an acquisition boundary: a suffix starting at the Nth delivered readable key,
or `whole` when fewer than N readable rows exist, including an empty group.
A descending page on that index is complete while it stays at or above that
boundary by key; crossing it returns only the known suffix with `complete: false`
and unknown coverage, so the online client asks the server. Without a boundary
the group is unknown.

Ascending reads and other indexes have unknown coverage.
N_SYNC_ORDER notes these query orders at their source sites and names the
window's order for ordinary pages, including calendar-index pages. A printed
page repair keeps audience equalities in bracket keys, every other predicate,
and the cursor. It is printed only when the query has a cursor, a cap proves
the page covers the whole group, or the query already reads newest first on
the same ordered columns. A cursorless partial page in another order gets
words: changing its order could select different rows. After changing the
order, restart pagination; the full traversal keeps the same rows.
A range can move to a filter only with the same meaning;
outer-row endpoints, generated membership lanes and merges get words naming
the window order and index instead of a paste-ready replacement. This also
applies to projected views: one branch is not the whole result. Whole-domain
aggregates and word searches have separate coverage requirements; this
ordering note does not cover them.
Use `last N by .at, .id` for the example above, keeping the
audience predicate and cursor. A query on the window's own index, newest first,
can answer offline within the acquired boundary, including timestamp ties.
Other orders need the server; a held query stays local with incomplete coverage.
`online only` currently applies to tables and views, not query headers.

An unheld put below the boundary is dropped; a held row whose key
moves below it remains available to point reads but is excluded from the suffix.
A put moving above the boundary joins the suffix. Continuous renewal keeps the
boundary. A join reacquiring retained history leaves the horizon unknown until
a full replacement snapshot acquires the group again. Boundaries persist with
acquisition and publish with staged snapshot rows only after catch-up. The additive sync field
`acquisitions` contains `{ at, table, index, group, floor? }` markers before
`events[at]` (or at the end): missing `floor` begins acquisition; completion
carries `whole` or the hex-encoded index key. A completion without a matching
begin is ignored and reported in device metadata (`device:acquisition-report`).
An acquiring join selects the group's current readable rows when the stream
serves it, newest first on the horizon index. The floor is the full key of the
Nth delivered row, including its id tie-breaker; `whole` means the walk reached
the group's end with fewer than N readable rows, including none. Expired and
unreadable rows do not consume horizon slots. A cold snapshot uses the same
readable-row selection; at a stable state and clock its floor matches the join's.
Without a horizon an acquiring join delivers every current readable row.
A continuous renewal expands no rows and preserves the original grant's acquisition
if it has not yet been delivered. Contiguous renewals committed before the preceding
grant expires keep that membership open; a revocation or expiry gap breaks the chain.
Within one commit, a grant followed by continuous renewals acquires once at the
grant; a revoked grant acquires nothing, and a rejoin starts a new chain.
A join whose membership is already closed when served acquires nothing, even for
publicly readable retained history.
A row written after the join may arrive in the acquisition and again as a later
put; applying it twice replaces the same row by id. A later deletion still deletes.
Snapshot replies echo `after`; the device checks every
continuation and requires the terminal page before catch-up publishes coverage.
Empty groups consume page room too, so even a page with no rows can continue.

`last N by .a, .b` creates an ordinary index with the audience columns first,
then the listed order and an `id` tiebreaker if not already listed. A named
index still works. Repeating a listed column or an audience column is
E_QUARRY_SYNTAX: keep each order column once and omit the audience pins.

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
`{ from, limit, after, stream, pending, store_id?, generation? }`: up to 256 pending write IDs of
1–128 UTF-8 bytes, with the cursor, in at most 262,144 body bytes (256 KiB).
Oversize bodies, including chunked ones, return HTTP 413 `E_INPUT`; malformed
fields return HTTP 400 `E_INPUT`. Continue snapshots with `after: next`;
`stream: true` follows the log even from zero. There is no GET sync route.
The client sends its device generation. A mismatch returns HTTP 200
`E_SYNC_GENERATION` (family `generation`) with `generation`, `store_id` and
the current numeric `watermark`, before building a snapshot or stream page. A
head-read failure fails the request. The client adopts `/schema` only when that
watermark is a finite, nonnegative integer at or above its retained image-head
evidence (equal adopts); a lower head halts with `E_STORE_RESTORE`, and a missing
or invalid head is a retryable failure that neither adopts nor clears the evidence.
For a confirmed restore, stop the client and use a fresh device store and outbox
for that restored backend; retry and adoption do not repair a regressed store identity.
After adopting, it retries from the device's resulting position with its pending
IDs intact. This refusal is never applied
as a delivered page: its watermark is head evidence, not delivered progress, and
never moves the cursor. Retry only from the position adoption produced.
Omitting `generation` preserves ordinary page behavior.
Against 0.2.32, the client retries without the field once on that server's exact
HTTP 400 sync-input refusal. This transport omits `generation` for that server
origin only after a stripped retry returns a successful (2xx) response.
Anything else leaves discovery enabled, so the next attempt probes again;
another origin or transport still sends the field.
An HTTP response above 16 MiB becomes `E_BOUND`, keeping `generation`,
`store_id` and `watermark` from that page. The client checks identity before
shrinking its limit; a refusal's watermark is never applied as delivered data.
At limit 1 an oversized stream reply adds `snapshot: true`, instructing the
client to restart at `from: 0, after: null, stream: false` with the reduced
limit and finish snapshot catch-up before publication. Commits stay whole in
the stream; snapshots page their current rows separately. A snapshot row that
cannot fit at limit 1 remains refused, without another snapshot instruction.
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

Backends using maintained columns, recorded attribution or declared timelines require 0.3 devices.
The engine derives their capability requirements from the schema. Published
0.2.33 devices refuse installation, generation adoption and kept-backend reopening
with an unknown `Capabilities` enum variant; 0.2.33 engines refuse to open or serve
these stored schemas. Update devices before deploying such a backend. Current
engines and devices refuse unknown requirements with `E_SCHEMA_CAPABILITY`,
including when an explicit backend would replace an unsupported kept backend.
Downgrading a device below the store's version is unsupported.
Backends without these forms keep their existing encoding and remain compatible
with 0.2.33 devices.

`online only` optionally documents a table with no sync. On a maintained `view`,
it opts out of inherited sync. `N_MAINTAIN_SYNCED` calls out public inherited
aggregates and group audiences with unbounded recipients or multiple values per group,
grouped into one note retaining each view's source location.
The note names mutations that would stop predicting if the view goes
`online only`; `snapback4 test --residency` measures its cold rows. `check`
prints the facts without pre-adoption counts: a new aggregate view has no stored rows yet.

## Operations

`check --residency --verbose` lists every table's residency, inferred and inherited
audiences, and each operation's `runs: device | server` or
`predicts: eligible | never`. Read sites are `held`, `horizon` or `server`.
Each site names its read, write or rule's file:line:column when source is
available, including helper writes and after-insert rules. A source-less
fact names its rule or write path instead of an internal compiler site.
Queries reading `connected` run on the server; mutations stay eligible when presence decides only effects.
A horizon site stays eligible but may queue without a row past the horizon;
`E_PREDICT` names the table, index and key. `why <op>` names the reason and
rewrite; `why <table>` includes the rule used for inference. The generated
`api.ts` documents arguments, results, these words, horizon sites and
`require` codes. `check` compares with `snapback/generated/residency.json`;
`dev` compares with its served generation. `N_NOW_SERVER` and
`N_NOT_PREDICTABLE` name changed sites, including added horizon risks.
Each mutation gets one `N_NOT_PREDICTABLE` note with distinct root causes
and deduplicated sites and rewrites.
Every text `check` also summarizes mutations that never predict, blocked insert
arms, and eligible mutations with horizon reads; JSON checks include `predictionSummary`.
The horizon bucket and `why`'s qualified heading keep every read and site visible
on unchanged checks. This includes the expiring source behind a live-aggregate
write-rule probe: prediction needs that source without a horizon.
`N_HORIZON_GUARD` distinguishes the argument row id from the mutation write id;
only codes with `DUPLICATE`, `RETRY` or `DEDUPE` words get retry advice.
Application invariants such as `else EVENT_REMOVED` keep their guards.
Ordinary mutation pages still get `N_NO_HORIZON` growing-table advice;
point/exists reads, rule probes and insert proofs that need whole coverage do not.
When an eligible mutation reads an ascending `first N` page, or a page on
a different index from the suggested horizon, the note names the mutation
that would lose prediction instead of recommending that horizon. A descending
`last N` page on the horizon's own index may keep the rewrite; an exhausted
horizon can still make that call queue without a predicted row.
Add `predicts` before
a mutation header's colon (`mutation like(postId: posts) predicts:`) to assert
eligibility: `check` refuses `E_NOT_PREDICTABLE` at that header if any site
makes it `never`. This asserts eligibility, not that every call will predict;
a horizon miss can still queue without a row. See `guide prediction`.

`test --residency --fixture dir [--as persona]` reports the eight costliest
acquired table/persona pairs, ordered by compact JSON row bytes, then rows,
with all omitted pairs summed into one line and totals that include them.
It measures the real cold partition snapshot, respecting authorization and
horizons; byte counts exclude transport framing and are not process RSS.
`check --residency --fixture dir --as persona` gives the same report where
builders already check their backend. Without a fixture, `check --residency`
measures the active dev-store schema read-only, without adopting current
source; without a dev store it says not measured and names the fixture command.
Use `--verbose` for all table counts, declared facts and notes; on `test` it
also runs the query meters as before. The default acquisition report fits
one screen even for hundreds of tables or personas. No count is extrapolated.

## Online store changes

The online client permanently denies reads and fails queued and in-flight
writes on an identity change (`E_STORE_REPLACED`) or a same-store sequence
regression (`E_STORE_RESTORE`); those writes may have executed, and the client
never retries their unknown outcomes.
Close it and create a new client, reconciling old intents before submitting
new writes; `createApp` automatically reopens its online client on
`E_STORE_REPLACED` after retiring its pending intents, retaining a session the
replacement backend accepts.

## A restored backend store on a device

On a local client, a matching
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
(the last sync's time captured before the server request, which the locally kept components are as of) and no continuation. Offline or after a failed request, the whole local
answer stands.
Composition is never entered while a predictable write is unobserved; the whole local answer stands until it settles.
Every other shape keeps the separate-query recipe: keep a
left-group read in its own query, since a mixed query without a component
plan returns the whole server answer online when no predictable write is awaiting observation,
and the whole device answer offline.
An inherited aggregate stays until-revoked even when its source retains delivered-history; it has no target horizon.
A table without `sync` is online-only. A maintained `view`
grouped by the audience columns inherits sync and is delivered as a value row.
`online only` on a table documents the absence of sync; on an aggregate view it opts
out of inheritance. Both lines absent on a table still means online only.
See `guide residency` for operation classes and cold acquisition measurements.

## Refusals

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
key, and guard new memberships with existing
membership or creation of the group. Follow the message's rule term,
column or index; do not make private rows public just to enable sync."##;
