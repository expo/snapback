//! The guide: the language card, the keyword cards, and the refusal codes.
//! Text a builder reads once and an agent reads on demand; no freshness
//! dates, nothing generated (LLP 3000 §4, NOT-DOING).
//!
//! Every fenced ```quarry block below is compiled by `tests/guide.rs`, and
//! the language card's block is run against the engine, so a card cannot
//! promise a form the parser refuses. A block that declares a table compiles
//! on its own; excerpts use their named starter/reference context, and other
//! fragments compile beside the language card's schema.

// @ref LLP 3000.007#20.19 — one orientation points to tested reference cards.
#[path = "guide/why.rs"]
mod why;
#[path = "guide/app.rs"]
mod app;
#[path = "guide/shapes.rs"]
mod shapes;
#[path = "guide/presence.rs"]
mod presence;
#[path = "guide/receipts.rs"]
mod receipts;
#[path = "guide/social.rs"]
mod social;
#[path = "guide/start.rs"]
mod start;
pub use start::START_CARDS;

/// The keyword cards, in the order `snapback4 guide` lists them.
#[path = "guide/actions.rs"]
mod actions;
#[path = "guide/routes.rs"]
mod routes;
#[path = "guide/personas.rs"]
mod personas;
#[path = "guide/search.rs"]
mod search;
#[path = "guide/reads.rs"]
mod reads;
#[path = "guide/writes.rs"]
mod writes;
#[path = "guide/programs.rs"]
mod programs;
#[path = "guide/prediction.rs"]
mod prediction;
#[path = "guide/discovery.rs"]
mod discovery;
#[path = "guide/refusals.rs"]
mod refusals;
#[path = "guide/bounds.rs"]
mod bounds;
#[path = "guide/services.rs"]
mod services;
#[path = "guide/effects.rs"]
mod effects;
#[path = "guide/native.rs"]
mod native;
#[path = "guide/jobs.rs"]
mod jobs;
#[path = "guide/sync.rs"]
mod sync;
#[path = "guide/indexes.rs"]
mod indexes;
#[path = "guide/types.rs"]
mod types;
pub use discovery::{listing, nearest};
pub const SERVER_KEYWORDS: &[&str] = &["actions", "routes"];
pub const KEYWORDS: &[&str] = &["language", "from-sql", "app", "types", "indexes", "maintains", "offline-interactions", "rules", "sync", "residency", "prediction", "evolution", "expire", "ephemeral", "assets", "client", "social", "reads", "shapes", "writes", "sequences", "programs", "jobs", "native", "feeds", "search", "effects", "actions", "routes", "services", "presence", "receipts", "manual-receipts", "bounds", "refusals", "personas", "witness", "start"];

// @ref LLP 3000.007#20.1 — a builder's word resolves through one table to a compiled card.
pub const ALIASES: &[(&str, &str)] = &[
    ("index", "start"),
    ("envelope", "bounds"), ("heaviest", "bounds"), ("1000", "bounds"),
    ("cold start", "bounds"), ("cold restart", "bounds"), ("acquire", "bounds"),
    ("latency", "bounds"), ("performance", "bounds"), ("p95", "bounds"),
    ("benchmark", "bounds"), ("load test", "bounds"),
    ("react", "client"), ("hooks", "client"), ("expo", "client"), ("ios", "client"), ("react native", "client"),
    ("dm", "social"), ("direct message", "social"), ("chat", "social"),
    ("composer", "client"), ("unread", "client"),
    ("existence", "client"), ("what does a missing row mean", "client"),
    ("loading or absent", "client"), ("unknown membership offline", "offline-interactions"),
    ("typing", "ephemeral"),
    ("clock", "jobs"), ("schedule", "jobs"), ("schedules", "jobs"), ("cron", "jobs"),
    ("simulator", "witness"), ("offline proof", "witness"),
    ("grammar", "language"), ("quarry", "language"),
    ("view", "maintains"), ("views", "maintains"), ("maintain", "maintains"), ("aggregates", "maintains"), ("time", "language"),
    ("replay", "personas"), ("seed", "personas"),
    ("predict", "prediction"), ("predictable", "prediction"), ("offline", "prediction"),
    ("optimistic", "prediction"), ("pending", "prediction"),
    ("pagination", "reads"), ("paging", "reads"), ("cursor", "reads"), ("next", "reads"),
    ("migration", "evolution"), ("migrate", "evolution"), ("schema-evolution", "evolution"), ("adoption", "evolution"),
    ("sql", "from-sql"), ("convex", "from-sql"), ("rosetta", "from-sql"), ("inspect", "personas"),
    ("reports", "receipts"), ("delivery", "receipts"), ("receipt", "receipts"), ("delivered", "receipts"), ("read receipts", "receipts"), ("ticks", "receipts"), ("watermark", "receipts"),
    ("push", "effects"), ("notification", "effects"), ("notify", "effects"), ("worker", "effects"), ("workers", "effects"), ("background", "effects"), ("idempotency", "effects"),
    ("route", "routes"), ("webhook", "routes"), ("webhooks", "routes"),
    ("auth", "personas"), ("signin", "personas"), ("login", "personas"), ("session", "personas"),
    ("upload", "assets"), ("timeline", "feeds"), ("timelines", "feeds"),
    ("media", "assets"), ("image", "assets"), ("video", "assets"),
    ("realtime", "reads"), ("live", "reads"), ("subscribe", "reads"),
    ("order", "writes"), ("ordinal", "writes"), ("arrival", "writes"),
    ("sequence", "sequences"), ("sequence by", "sequences"),
    ("receipt gap", "sequences"), ("receipt gaps", "sequences"), ("expiring messages", "sequences"),
    ("receipt gap expiring messages", "sequences"), ("what did this member miss", "sequences"),
    ("skip expired gaps in receipts", "sequences"),
    ("advance delivered prefix over expired messages", "sequences"),
    ("resume receipts after messages expire", "sequences"),
    ("move receipt watermark past expired messages", "sequences"),
    ("disappearing message receipt", "sequences"),
    ("bounded unique ordinal probes", "sequences"), ("expired ordinal holes", "sequences"),
    ("mutation page over expiring messages", "sequences"),
    ("prohibited mutation scan over expiring rows", "sequences"),
];

/// The contents of every ```quarry block in a card or a README.
pub fn quarry(text: &str) -> Vec<String> {
    let mut blocks = Vec::new();
    let mut current: Option<String> = None;
    for line in text.lines() {
        match &mut current {
            Some(block) if line.trim_end() == "```" => {
                blocks.push(std::mem::take(block));
                current = None;
            }
            Some(block) => {
                block.push_str(line);
                block.push('\n');
            }
            None if line.trim_end() == "```quarry" => current = Some(String::new()),
            None => {}
        }
    }
    blocks
}

/// The language card's core program; its server opt-in block is separate.
pub fn language() -> String {
    quarry(LANGUAGE).into_iter().find(|block| block.contains("query heldRoom(")).expect("the language card has a core block")
}

#[path = "guide/templates.rs"]
mod templates;
pub use templates::{TEMPLATE, TEMPLATE_ONLINE};

/// The language card: a core program that compiles and runs, then the opt-in,
/// then what is left out on purpose and the idiom for each.
#[path = "guide/language.rs"]
mod language_card;
pub use language_card::LANGUAGE;

pub fn card(keyword: &str) -> Option<&'static str> {
    let keyword = ALIASES.iter().find(|(alias, _)| alias.eq_ignore_ascii_case(keyword)).map(|(_, target)| *target)
        .or_else(|| KEYWORDS.iter().copied().find(|name| name.eq_ignore_ascii_case(keyword)))?;
    Some(match keyword {
        "start" => start::card(),
        "language" => LANGUAGE,
        "ephemeral" => include_str!("guide/ephemeral.md"),
        "from-sql" => include_str!("guide/from_sql.md"),
        "app" => app::CARD,
        "witness" => include_str!("guide/witness.md"),
        "prediction" => prediction::CARD,
        "evolution" => discovery::EVOLUTION,
        "types" => types::CARD,
        "sequences" => include_str!("guide/sequences.md"),
        "indexes" => indexes::CARD,
        "maintains" => include_str!("guide/maintains.md"),
        "offline-interactions" => include_str!("guide/offline_interactions.md"),
        "rules" => include_str!("guide/rules.md"),
        "sync" => sync::CARD,
        "residency" => r##"# Residency: facts at check, coverage on each call

Residency describes which data a device holds and which operations need the server.
Coverage on each call determines whether the answer is complete.

```quarry
table notices:
  body: text <=200
  author: principal
  at: time
  public 'a public bulletin'
  insert <- .author = viewer
  sync last 100 by .at
view noticeCounts: count notices by .author
  read <- allow
  online only
table audit:
  actor: principal
  read <- .actor = viewer
  online only
query notice(id: notices):
  return notices[id]
query countNotices(author: principal):
  return noticeCounts[author]
mutation post(body: text <=200):
  insert notices { body, author: viewer, at: now }
```

An observed server-run query re-runs after commits touching its tables.
Offline it returns its last server answer, held in memory for this client's
lifetime, with fresh: false and since. Without one it refuses E_OFFLINE
(family link, retryable). It never answers an empty device page as server data.
On E_OFFLINE, show the read as unavailable and reconnect before refreshing the server query.

## Operations

`check --residency --verbose` prints two tables of facts: each table's audience and
horizon (inferred audiences say "from the read rule"; aggregate views name their
source), then operations and their read sites: held, horizon, or server.
Sites name the read, write or rule's file:line:column, including expanded
helper writes and after-insert rules; a source-less fact names its rule or
write path instead of an internal compiler site.
Queries run on the device unless a site is server-only. Mutations predict
when eligible; every mutation can queue. An eligible mutation's horizon
sites say "may queue without a row past the horizon"; E_PREDICT names the
site, table, index and key the device could not establish. Native reads
need the app's module on the device.
Queries reading `connected` run on the server; mutations stay eligible when presence decides only effects.
Presence-derived values use only total comparisons, boolean logic and fixed-size field values; fallible work keeps `never`.

`why notice` names its horizon; `why countNotices` names the online-only
view and the rewrite. `why notices` prints the rule that inferred sync.
Generated api.ts documents arguments, results, runs/predicts, horizon sites
and require codes. check compares with generated/residency.json; dev compares
with the generation it serves. N_NOW_SERVER names a newly server-run query.
N_NOT_PREDICTABLE groups distinct root causes and deduplicated sites into one
note per mutation for lost eligibility or an added horizon risk, explicitly
distinguishing a call that may queue from an operation that never predicts.
Every check also summarizes all never-predicting mutations, blocked insert arms,
and eligible mutations with horizon reads. `check --verbose` names every site.
A header such as
`mutation post(body: text <=200) predicts:` asserts eligibility; a server
site refuses E_NOT_PREDICTABLE at that header. Inspect `snapback4 why <op>` and
follow the named site rewrite to restore local execution, or keep the server
dependency and handle queued writes and unavailable offline reads. See `guide prediction`.

N_MAINTAIN_SYNCED names public inherited aggregates and group audiences
with unbounded recipients or multiple values per group. It names mutations
that would stop predicting if the view goes online only. Inherited sync has no
horizon; `online only` also loses offline aggregate/absence coverage. See
`guide maintains` and `guide offline-interactions` for the replica census. Repeats share one
note with a line and source location for every view. Check prints these
facts without pre-adoption counts: a new view has no stored rows yet. Run
`test --residency --fixture dir --as alice` to measure cold rows and compact
JSON row bytes. The default report shows the eight costliest table/persona
pairs by bytes (then rows), one summed remainder and reconciled totals.
`check --residency --fixture dir --as alice` prints the same bounded report.
Without a fixture, check measures the active dev-store schema read-only;
it never adopts current source for measurement. With no store it says not
measured and names the fixture command. Add `--verbose` for every table,
facts and notes (and on test, query meters and aggregate row counts).
Measurements exclude transport framing, are not process RSS, and are not
estimates for another fixture.

Measure the device that actually holds the window above:
```ts
const held = await client.residency();
if (held) {
  console.table(held.tables); // { notices: { rows, bytes }, ... }
  console.log(held.totalBytes, held.totalBytesKind, held.wasmHeapBytes);
}
```
Rows are physically held images, including predictions and retained/expired
images still stored. They confer no query coverage or read authority. Table
bytes are UTF-8 stored row payloads, excluding keys and indexes. Empty tables
report zero. Native totalBytes is allocated SQLite pages, including indexes,
metadata and free pages, excluding WAL/SHM files. Web totalBytes is UTF-8 logical
persistence record keys and values before IndexedDB packing; it includes outbox,
base images and staging, not physical disk allocation. Separate media and wasm
code caches are excluded. wasmHeapBytes is allocated linear memory shared by
all web devices in this realm, not live allocations or Chromium RSS. The online
tier and mock return null. Closed/signed-out local clients reject with a coded error.
A native handle whose store adopted another schema returns E_GENERATION; reopen it.
If the device host fails during this read, E_STORE at client.residency names
the failure; restart the device host and reopen the client before retrying.

Store-writing CLI commands (`run`, including jobs/backfills, `test` without a
fixture, offline `token`, `deploy`, `rollback`) lock its `-owner` sidecar for their lifetime.
Native devices, including embedded C-ABI hosts, share ownership with each other
and exclude backend writers until their stores close.
Exclusion holds while `<database>-owner` is left in place. Removing or replacing
it while a process runs ends exclusion: a second owner can start while the first
can continue reading and writing. Removal does not revoke a running process or
cancel its transactions. Stop all owners before moving the database and its
sidecars; leave `-owner` in place for the whole ownership lifetime.
Hard-linked databases refuse E_STORE: copy the store, do not hard-link it.
A busy probe at a moved store's old path creates no empty database.
A live host causes E_STORE_BUSY before offline work, naming its address when available.
`token` instead asks the live host over loopback with its private store proof
(guide services). If unavailable, restore access or stop the host, run token
offline, then restart it. For other writers, stop the host, run the command once,
then restart it. Another CLI writer also refuses; wait for it.
The HTTP /seed development door already runs through the host. `check`, `data`,
`sql`, `doctor` and fixture tests remain usable beside it."##,
        "expire" => r##"# Expire: a row's life ends at a time

Expiry makes a row invisible when its declared deadline passes.
The server then deletes it and syncs the deletion to devices holding it.

```quarry
table stories:
  authorId: principal
  body: text <=500
  expiresAt: time ?                        -- a null time never expires
  read <- .authorId = viewer
  insert <- .authorId = viewer
  update <- deny
  delete <- .authorId = viewer
  expire at .expiresAt
  sync to .authorId last 200 by .id

mutation postStory(body: text <=500, ttl: int ?):
  return insert stories { authorId: viewer, body, expiresAt: now + ttl if ttl != null else null }

query expiringStories(c: cursor ?):
  return stories where .authorId = viewer after c last 20 by .id { id, body, expiresAt }
```

`guide reads` carries a compilable typing table and its 4,500 ms deadline.
This is an application table, separate from the server's `connected[p]`.
That server-decided connection signal has no `expiresAt`.
Held device observations republish at `nextExpiry`, including offline; render
those rows directly. Timers follow the row's deadline; a suspended page or a
busy host can delay the callback.
Only server-answered reads need a render-deadline filter to hide a returned
row while its next network answer is pending. Return `expiresAt`, as above.
In React, `useNow(deadline)` owns the timer and responds to clock estimates:

```ts
import { useClient, useNow } from "snapback4/react";
function useExpiringRows<T extends { expiresAt: number | null }>(rows: T[]) {
  const client = useClient();
  const deadline = Math.min(...rows.flatMap(row => row.expiresAt !== null && row.expiresAt > client.now() ? [row.expiresAt] : []));
  const now = useNow(Number.isFinite(deadline) ? deadline : null);
  return rows.filter(row => row.expiresAt === null || row.expiresAt > now);
}
```

Render the rows returned by `useExpiringRows(rows)`. `client.now()` estimates the server's time and never
moves backward; `null` never expires. The hook cleans up on unmount.

A row past the time in the column is absent — to every reader, on every
host, before any rule — from that moment; the server's sweep schedules physical deletion
on its one-second tick (backlog and work slices can delay it), and the deletion streams to each device holding it, so it
leaves local stores on the next sync. In development, `snapback4 clock advance 185s`
runs that sweep immediately on the running `dev`; the deletion reaches both
device stores through normal sync; devices also learn the advanced server time
on their next response (guide clock).
Mutation scans of expiring tables follow guide programs; unswept rows still
cost examined work, and a backlog can refuse the whole write (why E_BOUND).
For receipt gaps in expiring messages, use `sequence by` and bounded unique
ordinal probes: `guide sequences` has the compiled recipe and a row-keyed count.
Disappearing messages are one field on
insert; there is no purge job to write. An ordinary maintained `view` over an expiring table
reads its physical total minus unswept expired contributions under the read
meter through an internal group/expiry/source-id index. Live rows add no server
read work. Devices still recompute live source contributions under their meter;
partial source coverage or a cut cannot supply an exact aggregate. Physical zero-sum occupancy reads at most one index entry. A rule may probe whether that live group
exists at one rule-probe unit, regardless of expired sources. A rule equality
on its `value` is refused at `check` (E_QUARRY_LIVE_MAINTAIN_PROBE): read the
view in the program; its live value cannot be probed at one unit. Value
equalities on non-expiring maintains and ordinary tables remain supported.
Value-order indexes over expiring sources are refused by check
(E_QUARRY_MAINTAIN_EXPIRE) and raw schema adoption: use the fresh live bounded query
on guide feeds. It sorts live counts with no schedule lag or writable score table;
if candidates or their contributions exceed the meter, the ranking is incomplete.
The optional scheduled ranked-table recipe trades fresh scores for stored paging.
The sweep already updates aggregates and indexes transactionally, but stored order
is stale between expiry and the physical sweep or after a partial sweep. Taking
stored top-N and rechecking only those winners can miss the live winner. A server
count index could bound a live threshold scan, but that read form is not built;
it would have to refuse on devices, whose snapshots deliver live values rather
than physical upper bounds. Signed sums have no such upper bound.
A partial device counts only held live
sources and says `complete: false`. A meter cut of an ordinary aggregate returns `data: null, complete: false`.
An expiring row-keyed range read returns `{ value: L, recountPending: true }`
with `complete: false`, the current-row lower bound examined so far (guide maintains). A zero sum keeps its group while sources
remain, because one signed contribution can expire before another.

## Operations

In tests, use `snapback4 clock advance <dur>` or `POST /dev/clock/advance`; each example line advances the running dev once.

```sh
snapback4 clock advance 36s
curl -X POST http://127.0.0.1:4400/dev/clock/advance -H 'Content-Type: application/json' -d '{"duration":"36s"}'
```"##,
        "assets" => r##"# Assets: upload, place, serve

Assets are uploaded images and videos attached to a row.
That row's read rule controls who can fetch the bytes.

```quarry
table clips:
  ownerId: principal
  photo: image <=10000000 once ?           -- `once`: one view per principal, never cached
  clip: video <=50000000 ?
  photos: [image <=10000000] <=4 ?         -- each upload belongs to this row
  at: time
  read <- .ownerId = viewer
  insert <- .ownerId = viewer
  update <- deny
  delete <- .ownerId = viewer
  sync to .ownerId last 100 by .at

mutation sendClip(clip: video <=50000000):
  duration = clip.duration                 -- the argument carries the facts the server sniffed: type, bytes, width, height, duration; null where the kind has none
  require duration != null else DURATION_UNKNOWN
  require duration <= 60000 else TOO_LONG
  return insert clips { ownerId: viewer, clip, at: now }

mutation sendPhotos(photos: [image <=10000000] <=4):
  return insert clips { ownerId: viewer, photos, at: now }
```

Upload each image first, then pass the list of `{ id }` values to `sendPhotos`.
Each element inherits the row's read rule.
`[image <=10000000 once] <=4` applies one view per principal to each image.
List placement and release reserve four examinations, two writes, eight steps
and 16 KiB scratch per declared element slot (nested caps multiply), even for
an empty or unchanged list; file bytes are not copied by placement.
Scalar receipts retain their previous accounting: the proposed extra allowance
of four examinations, two writes, eight steps and 16 KiB scratch per scalar slot
was withdrawn because it broke existing scalar meter boundaries.

The local client keeps server upload facts for prediction: `{ id }` works
offline after upload, including reads of duration and dimensions. Without
those facts the write queues unpredicted and the server judges it.
With `createLocalClient({ assets: { keep: "viewed", maxBytes: 67108864 }, ... })`,
ordinary viewed images and videos in scalar or list columns survive offline
reopen in device storage. Retention follows the download-confirmed column home
and store identity; removing an element revokes its bytes, while reorder keeps
them. Upgraded devices reacquire confirmed rows once on sync, then older cached
bytes without that receipt must be downloaded again; queued writes are kept.
`keep: "none"` (the default) retains no media. The byte bound evicts least
recently used assets. Home-row deletion, clearing, expiry and partition leave
purge the bytes; `once` is never stored. Online reads always revalidate.

A client uploads the bytes first (`client.upload(file)` → `{ id, type,
bytes, width, height, duration }`; the server sniffs JPEG, PNG, WebP and
MP4 and refuses the rest with E_ASSET_TYPE, and anything over the largest
column's bound with E_ASSET_TOO_LARGE). Images must be nonzero, at most
16,384 pixels on either side and at most 40 million pixels total; video must
have a positive duration no longer than one hour (E_ASSET_BOUNDS). The client
passes `{ id }` as the
mutation's argument; the row carries the facts the server established. One
asset, one home: the uploader's own upload, placed once (E_ASSET_UNKNOWN,
E_ASSET_PLACED). Serving is the home row's read rule: `client.asset(id)` (a
blob URL; `useAsset(id)` in React) or `client.assetSource(id)` (a URI and
headers for native views) fetches `GET /assets/<id>` under the viewer's
credentials, and a row that is deleted, whose column is cleared, that
expired, or that the viewer may not read answers 404 E_ASSET_UNKNOWN.
For one-view React photos, own the handle above the list (`guide client`).
`once`: the second fetch by the same principal is 410 E_ASSET_VIEWED, and
the uploader is counted after placement; before placement the uploader may
preview. A Range request against a once asset is refused before consuming a
view (E_ASSET_RANGE). Unsatisfiable ordinary ranges return HTTP 416. Every
asset response is `private, no-store`, so a browser must reauthorize each
viewer. At most two uploads run at once, and their disk writes happen outside
the engine mutex. Uploads are online only; there is nothing to queue.
The host admits 128 HTTP connections. Excess connections receive HTTP 503
E_RATE_LIMIT before request admission; full request worker pools also refuse.
The SDK retries explicit retryable admission refusals at most four times within
10 seconds of backoff, with jitter after the Retry-After minimum. A lost
upload or once-view reply is never automatically retried; its outcome is unknown.
Node retires idle sockets after one second. A reused-socket close before any
response bytes retries once for reads and writes protected by durable write IDs.
Fresh-connection and interrupted-response failures still report E_OFFLINE.
The public refusal is CORS-readable; a rejected preflight remains a transport
failure. Malformed error envelopes report E_HTTP_RESPONSE with the HTTP status. Wait for pending writes to settle or
reduce concurrent clients. Replaying with zero write wait and counting pending
receipts as settled can flood this cap. `--fresh --replay` keeps the same caps.
Malformed asset replies report E_HTTP_RESPONSE with the HTTP status; inspect
server/proxy logs before retrying because an upload may already be stored.
Upload a supported kind within the column bound; downscale oversized uploads,
resize images or shorten videos to fit the media limits. Upload the bytes again
for a second home. Fetch a once asset without Range; a consumed view cannot be
retried by that principal. For an unknown asset on download, use the intended
viewer's live session; a placed asset also needs a live, readable home row.
Missing and hidden stay indistinguishable. On placement, use your own upload and the id it returned;
a readable home row does not grant upload ownership.

At startup `dev` and `serve` try to raise the soft file-descriptor limit to the
hard limit, capped at 65,536 (also capped by macOS host limits). Failure is
logged once and serving continues. Startup and live `doctor` report the effective
soft/hard limits and warn below 2,048 descriptors (the parallel server tests
peaked at 1,197). A low hard limit needs a shell/container/service limit change
and restart. Children inherit the raised soft limit; Node can raise its own
further, up to the hard limit. `doctor` also reports cumulative descriptor
exhaustions from accept/socket clones. These close transports without an
admission refusal; intake retries with 1–100 ms backoff, reset after a connection
is fully constructed.

Removing an element releases it; reordering keeps its home and view history;
deleting the row releases all.

Stored list ids from before list placement are not backfilled, and rewriting
the cell with the same ids does not claim them. Readers still get
E_ASSET_UNKNOWN (the upload owner can still preview) until a write places and
claims fresh uploads in the cell.

## Author avatars inside message rows

Keep the avatar on its profile. Read that profile by the message's sender,
then pass the returned avatar id to `useAsset`, just as in a feed or chat list.
The profile's read rule authorizes the bytes; a message reference neither
grants nor removes that authority. Do not place the same upload on each message.

```quarry
table profiles:
  principal: principal
  displayName: text <=50
  avatar: image <=10000000 ?
  unique principal
  public 'Profiles are discoverable'
  insert <- .principal = viewer
  update <- .principal = viewer
  sync public last 500 by .id
query profileById(principal: principal):
  return profiles[principal = principal]
```

```tsx
import { useAsset, useQuery } from "snapback4/react";
import { api } from "../snapback/generated/api";
// In each DM/group bubble: <AuthorAvatar sender={message.sender} />
export function AuthorAvatar({ sender }: { sender: string }) {
  const profile = useQuery(api.profileById, { principal: sender });
  const author = "data" in profile ? profile.data : null;
  const avatar = useAsset(author?.avatar?.id ?? null);
  if ("denied" in profile) return <span role="alert">{profile.denied.message}</span>;
  if ("loading" in profile) return <span>Loading author…</span>;
  if (avatar.status === "denied" || avatar.status === "error") return <span role="alert">{avatar.why.message}</span>;
  if (avatar.status === "loading") return <span>Loading avatar…</span>;
  return avatar.status === "ready"
    ? <img src={avatar.url} alt={author?.displayName ?? "Author"} />
    : <span>{author?.displayName ?? "Unknown author"}</span>;
}
```

`null` means `empty`, not a failed download. Inspect the profile read and the
asset's `why` when its status is `denied` or `error` separately; an initials placeholder must not hide a refusal.
Transient transport failures report `status: "error"` with `why.code` (for
example `E_OFFLINE`, `E_HTTP_RESPONSE` or exhausted `E_RATE_LIMIT`) and a
message. Authorization, missing/revoked assets and consumed views remain
`status: "denied"`. The hook retries safe transport errors on reconnect,
window refocus or return to a visible document. An event during Retry-After
waits for its deadline; an event during a transfer waits for its outcome, then
retries only a safe failure once. Unmount cancels recovery. The hook never
refetches a ready handle or automatically retries a refused/revoked asset.

Ordinary downloads use a full-file Range request, which cannot consume a
one-view grant. They retry resets, timeouts and transient HTTP failures with
backoff and jitter: at most four attempts and ten seconds total backoff.
After headers, five seconds without bytes ends a streaming attempt; empty
chunks do not count. A progressing stream has no total-duration deadline.
Buffered bodies allow one minute plus their Content-Length at 32 KiB/s; an
unknown length uses the server's 64 MiB ceiling (35 min 8 s). Before fetch
resolves, headers may be hidden behind a buffered body, so the same unknown-size
allowance applies. This also delays detecting a host that never returns headers.
Queue/backoff wait has a separate thirty-second budget, renewed only by bytes;
body transfer time does not spend it. Refusal bodies still have five seconds.
Retry-After remains a minimum through stalled error bodies, credential rotation
and hook recovery.
At most six asset transfers run per client, including their response bodies. SDK wait deadlines and post-body storage/display failures
report a client error and do not mark the device offline (`guide refusals`). Ordinary construction
failures can recover on a later event; ambiguous once failures cannot. A queue
budget expiring during Retry-After preserves that refusal and minimum.
Completed bytes survive same-principal bearer rotation without another fetch;
local downloads starting during refresh wait for the new bearer.
A once asset refuses Range before consumption; the SDK then requests it without
Range. A lost once response returns an explained error and is never replayed;
only explicit admission refusals can retry that transfer. Raw `client.asset`
returns `{ denied: why }` on exhaustion; call it again after connectivity
returns. Native `assetSource` delegates transfers to the host image view.
Repeated ordinary avatars may mount independently. Replacing the avatar id
or client retires the previous handle. Account switches replace the client;
raw sign-out retires it through the signed-out state. Viewer discovery alone
does not fetch again. A signed-out hook with a non-null id reports `E_AUTH`.
A released or unreadable home reports `E_ASSET_UNKNOWN` on download;
a fetch while offline without retained bytes reports `E_OFFLINE`; an already
ready handle is not refetched just because the link drops. A loading profile
has not supplied an asset id yet. One-view photos use the explicit-open viewer
in `guide client`, never this automatically fetched avatar pattern."##,
        "client" => include_str!("guide/client.md"),
        "social" => social::CARD,
        "reads" => reads::CARD,
        "shapes" => shapes::CARD,        "writes" => writes::CARD,
        "programs" => programs::CARD,
        "jobs" => jobs::CARD,
        "native" => native::CARD,
        "feeds" => include_str!("guide/feeds.md"),
        "search" => search::CARD,
        "actions" => actions::CARD,
        "routes" => routes::CARD,
        "effects" => effects::CARD,
        "services" => services::CARD,
        "presence" => presence::CARD,
        "manual-receipts" => include_str!("guide/manual_receipts.md"),
        "receipts" => receipts::CARD,        "bounds" => bounds::CARD,
        "refusals" => refusals::CARD,
        "personas" => personas::CARD,
        _ => return None,
    })
}

/// Every refusal code `why` explains, with its family. A program's own
/// `require` codes are the author's and are explained by the program.
mod codes;
pub use codes::{CODES, WHY_MAX_BYTES, codes, explain_code};
pub(crate) use codes::{explain_code_with_guide, explanation_section};
