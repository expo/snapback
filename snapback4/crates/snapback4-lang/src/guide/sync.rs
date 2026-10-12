// @ref LLP 3000.021#3.1 — history is an ordinary page on the sync horizon index.
//! The sync card. Quarry examples are compiled by tests/guide.rs.
pub(super) const CARD: &str = r##"# Sync: the viewer's partition is the unit of sync

**Start here:** Sync replicates authorized rows; `last N` bounds the device's working set, not server history: history queries with cursors page from the server beyond it, while offline reads use only what the device has acquired.

```quarry
table todos:
  ownerId: principal
  cap 1000 by ownerId
  read <- .ownerId = viewer
  sync to .ownerId
```

- `E_SYNC`: the read rule is neither one audience nor a union of whole audiences, or a membership insert proves no grant; the rewrite names the edit, and `guide sharing` has unions (owner or team, two parties, owner or staff), rosters and teams.
- `N_SYNC_ORDER`: page and horizon orders differ; keep the intended selection (`first 1` can change), and restart pagination if changing order.
- `N_NO_HORIZON`: a partition can grow; read the diagnostic's prediction warning before adding `last N by .column` or an intended cap.

## Reference

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

table messages:
  conversation: threads
  body: text <=2000
  at: time
  search body
  by byHistory: conversation, at, id
  read <- exists participants[.conversation, viewer]
  retain delivered-history
  sync to participants[.conversation] by .personId last 500 by .at

query conversationScreen(c: threads):
  return threads[c]

query history(c: threads, page: cursor ?):
  return messages where .conversation = c last 20 by byHistory after page

query historyBracket(c: threads, page: cursor ?):
  return messages[conversation = c] last 20 by byHistory after page

query searchHeld(q: text <=100, page: cursor ?) held:
  return messages matching q last 20 by .at after page

```

`await client.sync()` waits for a round begun after the call (sharing one follow-up if a round is in flight), so a successful sync reflects server commits acknowledged before the call instead of an older response; offline and refusal results still apply.

Prove the envelope's heaviest account with `snapback4 witness acquire --as <persona> --restart`; `guide bounds` covers fresh acquisition, native-process timing and retained cold coverage.

The ordinary `history` page uses the horizon's index, with no membership `require`. Table rules protect server reads. Before acquisition or beyond coverage the local client can ask the server; after leave it keeps the retained page local, online and offline. Pin `conversationScreen` by id. Keep receipts, profiles, quotes and reactions in separate queries rendered beside history, as `guide app` and `guide receipts` show. A decoration that loads or refuses must not take the page with it.

On an explicitly indexed page, safe, non-optional leading equalities establish the bracket prefix and coverage. Extraction stops at a residual predicate, seek column or final index column. Other predicates and order stay intact; old cursors retain their validated index, scope and generation.

`searchHeld` is an explicit device-only scope and never falls back, even online. For current server hits together with retained device hits, use one ordinary search in either link state (`guide search`), as the social starter does. N_HELD_UNKNOWN names a held query's read of a table, view or `read through`
parent with no `sync`, or `connected[...]` server presence, including reads
inside helpers and shapes: move the read to its own query,
or drop `held`. A horizon or word index alone does not cause this note.

### Audiences: who holds a row
```text
sync [last N by .at]                           audience inferred from the read rule
sync public [last N by .at]                    everyone holds the same rows
sync to .col [last N by .at]                   each row reaches the principal in .col
sync to t[.a, .b] [by .col] [last N by .at]    each row reaches every principal with a
                                                 row in t whose (a, b) match; `by .col` names
                                                 the recipient column when t has several
sync to .col or t[.a]                         a horizon-free, non-expiring union
```

`sync [last N by .at]` infers its audience from the read rule. Explicit `sync public` and `sync to ...` remain valid and must agree with that rule.
The read rule must be exactly the audience — `public`, `.col = viewer`, `exists t[.a, .b, viewer]`, or a union: an `or` of `.col = viewer` branches and at most one `exists` branch, each whole (`guide sharing`; unions replicate every readable row and refuse windows or direct/inherited expiry) — so a device never holds a row it may not read and never misses one it may; a branch that is not a whole audience, or an extra conjunct, is
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

### Horizons, order and coverage
Ascending reads and other indexes have unknown coverage.
N_SYNC_ORDER notes these query orders at their source sites and names the
window's order for ordinary pages, including calendar-index pages. A printed
page repair keeps audience equalities in bracket keys, every other predicate,
and the cursor. It is printed only when the query has a cursor, a cap proves
the page covers the whole group, or the query already reads newest first on
the same ordered columns. A cursorless partial page in another order gets
words: changing its order could select different rows. After changing the
order, restart pagination; the full traversal keeps the same rows.
A window index fully pinned by its audience also gets words: its point read
would change the page's result type.
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

`read <- exists members[.message.conversation, viewer]` with
`sync to members[.message.conversation]` means `read through .message` and `sync`.
The child must spell its parent's whole rule, with `immutable message` and
`immutable conversation`. Links must be required, without defaults. This adopts
parent authorization, inherited expiry and deletion protection. Three-hop paths
work through an already inherited parent: the same captures preserve audiences,
acquisition, withdrawals, prediction and meters. E_READ_THROUGH rejects nullable
or changing links and different child rules with a declaration repair; use it
only to inherit the whole parent audience. Mismatched sync audiences get a
schema-specific repair; see the sync-declaration refusal below.
See `guide language` for a compiled example and `guide rules` for lifetime details.

### Acquisition and its boundary
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

### Window indexes, unbounded groups and the sync wire
`last N by .a, .b` creates an ordinary index with the audience columns first,
then the listed order and an `id` tiebreaker if not already listed. A named index still works if it leads with the audience columns; on a read-through audience the compiler puts the inherited group first, then the named index's columns. Repeating a listed column or an audience column is
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
asks for 10,000 events at a time (2,000 by default on the wire, 10,000 at
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
Against 0.2.32, the client retries once without the field on that server's exact
HTTP 400 sync-input refusal, and omits it for that origin only after such a
retry succeeds (2xx); any other outcome probes again next time.
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

### Device versions, own keys and online only
Backends using maintained columns, recorded attribution or declared timelines require 0.3 devices.
The engine derives their capability requirements from the schema. Published
0.2.33 devices refuse installation, generation adoption and kept-backend reopening
with an unknown `Capabilities` enum variant; 0.2.33 engines refuse to open or serve
these stored schemas. Update devices before deploying such a backend. Current
engines and devices refuse unknown requirements with `E_SCHEMA_CAPABILITY`,
including when an explicit backend would replace an unsupported kept backend.
Downgrading a device below the store's version is unsupported.

`with own keys .principal` after a public window acquires all of this viewer's
immutable unique keys. See `guide feeds`. Only non-expiring public sources
with caller-owned writes qualify. Another principal's miss, row images and
counts keep their coverage. The source owner index, maintained keys and private
log cost server work; device bytes grow with lifetime keys. Adoption backfills
before publication; even zero keys need durable whole acquisition. Devices
without `owner-key-coverage` refuse the backend.

`online only` optionally documents a table with no sync. On a maintained `view`,
it opts out of inherited sync. `N_MAINTAIN_SYNCED` calls out public inherited
aggregates and group audiences with unbounded recipients or multiple values per group,
grouped into one note retaining each view's source location.
The note names mutations that would stop predicting if the view goes
`online only`; `snapback4 test --residency` measures its cold rows. `check --residency`
prints the facts without pre-adoption counts: a new aggregate view has no stored rows yet.
Inherited aggregate sync has no horizon. Opting out loses offline aggregate/absence
coverage; see `guide maintains` and the replica census in `guide offline-interactions`.

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
A text `check` of a schema that syncs a table (or any `--verbose`) summarizes mutations
that never predict, blocked insert arms and horizon reads; JSON includes `predictionSummary`.
`check --verbose` and `why` keep every read and site visible on unchanged checks. Plain `check` starts with the verdict and summarizes notes and prediction; sequence, field, view, ephemeral and scale details stay under `--verbose` (or the relevant `--cost`/`--residency` flag). JSON keeps its full report. This includes the expiring source behind a live-aggregate
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

## Bound the cold start

Size the largest account, not just a typical screen. A `last 500` message
window in 1,000 conversations can acquire 500,000 messages; member rows,
public tables and inherited maintained views add to that total. A query's
`last 20` limits its answer, not the device's acquisition.

A public source's horizon does not bound its maintained view. For example,
`view ownLikes: count likes by .principal, .post` inherits the public audience
and delivers every interaction key to every device, even if the source holds
only its latest 2,000 likes. The name `ownLikes` does not scope it to the viewer.
`N_MAINTAIN_SYNCED` names this cost. Use `online only` on the view when its
state may need the server; that state then cannot be answered offline from
the view. If it must be offline, model authorized state scoped to its viewer.
Do not remove table read rules or certify missing keys as zero to save bytes.

Run `check --residency --verbose` against a representative store (or use its
`--fixture` form), including the account with the most groups. Bound each
growing sync group with a horizon or a justified cap, then measure a fresh
browser through `client.acquired`. Inspect inherited views separately.
`N_NO_HORIZON` can be suppressed by prediction requirements, and a cap per
group does not cap the number of groups. Neither absence of notes nor a small
on-screen page promises a fast cold start.

For large browser accounts, `webDevice({ worker: true })` runs the wasm
device and IndexedDB saves in a dedicated Worker. The default remains
`webDevice()`. The Worker keeps the page responsive during atomic publication;
it adds startup, another realm and RPC, and does not reduce the declared data.
Custom persistence providers stay on the default device. The bundler must
package the Worker entry and wasm asset; Vite and the Clique Metro web export
are exercised by browser witnesses. These are fixture measurements,
not a cold-start deadline for other declarations.
On eb1000 (96 logical CPUs, AMD EPYC 9454, Chromium 151), five fresh-device
runs have median acquisition times of 1.89 s (default) and 2.10 s (Worker):
100 memberships, 500 Following edges, 500 held messages, 3.65 MB response bodies.
A 1,000-membership account with 90,500 messages / 105,034 rows takes 18.40 s
(default) or 19.17 s (Worker), with first inbox answers at 0.40 / 0.50 s and
peak wasm heaps of 307.69 / 307.63 MB. These are five instrumented runs per
mode, 39.76 MB transferred, 46.21 MB logical data, host load 3.98–11.16.
Render the first answer while `useAcquisition()` shows progress; only `acquired`
means the complete partition is durably ready offline. Group count alone does
not predict bytes or time. The heavy account still exceeds an 8-second target.
Mac and phone timings have not been measured for this implementation.

Built-in browser devices upgrade format-3 stores to format 4 locally in one
strict transaction, preserving rows, unfinished acquisition, prediction bases
and outbox. No redownload is needed. An abort leaves format 3 intact at physical
IndexedDB version 3; the current client retries. An old version-2 client rejects
with `VersionError` before reading or writing. Reload the application with both
updated page and Worker bundles, and keep that update available offline before
relying on offline reopening. Clearing storage would discard retained rows and
pending writes. `indexedDbPersistence()` still creates format 3 and reads both.

Measure your own largest account in five fresh browser profiles, with the
production server and the same device choice. Record host load, browser version,
network conditions, median and individual runs. Authenticate first; start this
clock immediately before restoring that session into a fresh device store:

```ts
import { createApp } from 'snapback4/app';
import { webDevice } from 'snapback4/web';
import { login, keepSession, localStorageSessionStore } from 'snapback4/auth';

const signed = await login(url, email, password);
if (!signed.ok) throw new Error(signed.why.message);
const sessionStore = localStorageSessionStore();
await keepSession(url, signed.session, sessionStore);
const started = performance.now();
const app = createApp({ url, sessionStore, device: webDevice({ worker: true }) });
app.auth.onChange(() => {
  if (app.auth.state !== 'signed-in') return;
  const client = app.client;
  const stop = client.onAcquired(async acquired => {
    if (!acquired) return;
    const coldAcquisitionMs = performance.now() - started;
    stop();
    console.log({ coldAcquisitionMs, residency: await client.residency() });
  });
});
await app.ready;
```

Use a fresh profile for each repetition: a reopened acquired store measures
restoration instead. Keep DevTools Network open for `/sync` request counts,
response bytes and `Server-Timing`; compare these with `client.residency()`
(logical bytes, not transfer or disk bytes). Record the first screen separately
from offline readiness. After readiness, disconnect, close/reopen the client,
and check its expected rows and complete local pages. A longer first-screen
query, network latency, broader horizons or more inherited views changes the
result; reducing the screen's page size does not reduce acquisition.

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
A table without `sync` is online-only. A maintained `view` grouped by the audience columns inherits sync and is delivered as a value row.
`online only` on a table documents the absence of sync; on an aggregate view it opts
out of inheritance. Both lines absent on a table still means online only.
See `guide residency` for operation classes and cold acquisition measurements.

## Refusals

N_SYNC_WINDOW_SIZE means a new or changed window meets a populated table at least ten times larger, across all groups; it does not prove any group exceeds its window.
See the opening sentence; cursor history still pages beyond the device window. `check` probes at most 10,000 keys per changed window; unchanged windows and larger probes stay quiet.

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
column or index; do not make private rows public just to enable sync. When the rule names several readers (two parties, an owner and a team, an owner and staff), `sync` delivers the union as long as each `or` branch is one whole audience and at most one is a group (`guide sharing`); a branch with an extra condition keeps that condition in queries and mutations instead, or the table goes `online only` (the rule stays as written, queries answer from the server, and mutations never predict; offline they queue). A public-or-owner rule (`.approved or .author = viewer`) splits into a public table and an owner-synced one, moving a row when it is shared. A members row read under `.principal = viewer or exists members[.group, viewer]` is its own witness and syncs as the probe alone. A membership insert branch that proves no grant is refused once, at that insert rule, with the probe conjoined; an open group anyone may join is public, or `online only`.
Mismatched read-through audiences also get E_SYNC, with the schema-specific
`read through .ref` / `sync` repair.

For a maintained view, E_SYNC names inherited public sync from its source,
without a horizon, and the conflicting explicit read. Keep the public read
(or omit it) for the public offline summary, or use `online only` and lose
offline aggregate/absence coverage. A view cannot declare a separate sync
audience; do not narrow its public source to make it private. See `guide
maintains` and `guide offline-interactions` for the replica census and the
explicit source owner-key coverage alternative for viewer-owned existence.
That alternative keeps the public window; it does not supply aggregate totals."##;
