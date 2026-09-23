//! The guide: the language card, the keyword cards, and the refusal codes.
//! Text a builder reads once and an agent reads on demand; no freshness
//! dates, nothing generated (LLP 3000 §4, NOT-DOING).
//!
//! Every fenced ```quarry block below is compiled by `tests/guide.rs`, and
//! the language card's block is run against the engine, so a card cannot
//! promise a form the parser refuses. A block that declares a table compiles
//! on its own; one that does not compiles beside the language card's schema.

// @ref LLP 3000.007#20.19 — one orientation points to tested reference cards.
#[path = "guide/app.rs"]
mod app;
#[path = "guide/shapes.rs"]
mod shapes;
#[path = "guide/presence.rs"]
mod presence;

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
pub const KEYWORDS: &[&str] = &["language", "app", "types", "indexes", "maintains", "rules", "sync", "residency", "prediction", "evolution", "expire", "assets", "reads", "shapes", "writes", "programs", "jobs", "native", "feeds", "search", "effects", "actions", "routes", "services", "presence", "bounds", "refusals", "personas", "witness"];

// @ref LLP 3000.007#20.1 — a builder's word resolves through one table to a compiled card.
pub const ALIASES: &[(&str, &str)] = &[
    ("clock", "jobs"),
    ("simulator", "witness"), ("offline proof", "witness"),
    ("grammar", "language"), ("quarry", "language"),
    ("maintain", "maintains"), ("aggregates", "maintains"), ("time", "language"),
    ("replay", "personas"), ("seed", "personas"),
    ("predict", "prediction"), ("predictable", "prediction"), ("offline", "prediction"),
    ("optimistic", "prediction"), ("pending", "prediction"),
    ("pagination", "reads"), ("paging", "reads"), ("cursor", "reads"), ("next", "reads"),
    ("migration", "evolution"), ("migrate", "evolution"), ("schema-evolution", "evolution"), ("adoption", "evolution"),
    ("sql", "personas"), ("inspect", "personas"),
    ("push", "effects"), ("notification", "effects"), ("notify", "effects"), ("worker", "effects"),
    ("route", "routes"), ("webhook", "routes"), ("webhooks", "routes"),
    ("auth", "personas"), ("signin", "personas"), ("login", "personas"), ("session", "personas"),
    ("upload", "assets"), ("media", "assets"), ("image", "assets"), ("video", "assets"),
    ("realtime", "reads"), ("live", "reads"), ("subscribe", "reads"),
    ("order", "writes"), ("ordinal", "writes"), ("arrival", "writes"),
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
    quarry(LANGUAGE).into_iter().next().expect("the language card has a core block")
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
    let keyword = ALIASES.iter().find(|(alias, _)| *alias == keyword).map_or(keyword, |(_, target)| *target);
    Some(match keyword {
        "language" => LANGUAGE,
        "app" => app::CARD,
        "witness" => include_str!("guide/witness.md"),
        "prediction" => prediction::CARD,
        "evolution" => discovery::EVOLUTION,
        "types" => types::CARD,
        "indexes" => indexes::CARD,
        "maintains" => include_str!("guide/maintains.md"),
        "rules" => include_str!("guide/rules.md"),
        "sync" => sync::CARD,
        "residency" => r##"# Residency: facts at check, coverage on each call

```quarry
table notices:
  body: text <=200
  author: principal
  at: time
  by byTime: at, id
  by byAuthor: author, id
  public 'a public bulletin'
  insert <- .author = viewer
  sync last 100 by byTime
maintain noticeCounts: count notices by author
  read <- allow
  online only
table audit:
  actor: principal
  by byActor: actor, id
  read <- .actor = viewer
  online only
query notice(id: notices):
  return notices[id]
query countNotices(author: principal):
  return noticeCounts[author]
mutation post(body: text <=200):
  insert notices { body, author: viewer, at: now }
```

`check --residency --verbose` prints two tables of facts: each table's audience and
horizon (inferred audiences say "from the read rule"; maintains name their
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
maintain and the rewrite. `why notices` prints the rule that inferred sync.
Generated api.ts documents arguments, results, runs/predicts, horizon sites
and require codes. check compares with generated/residency.json; dev compares
with the generation it serves. N_NOW_SERVER names a newly server-run query.
N_NOT_PREDICTABLE groups distinct root causes and deduplicated sites into one
note per mutation for lost eligibility or an added horizon risk, explicitly
distinguishing a call that may queue from an operation that never predicts.
Every check also summarizes all never-predicting mutations, blocked insert arms,
and eligible mutations with horizon reads, naming their sites even when unchanged.
A header such as
`mutation post(body: text <=200) predicts:` asserts eligibility; a server
site refuses E_NOT_PREDICTABLE at that header. See `guide prediction`.

N_MAINTAIN_SYNCED names public inherited aggregates and group audiences
with unbounded recipients or multiple values per group. It names mutations
that would stop predicting if the maintain goes online only. Repeats share one
note with a line and source location for every maintain. Check prints these
facts without pre-adoption counts: a new maintain has no stored rows yet. Run
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

An observed server-run query re-runs after commits touching its tables.
Offline it returns its last server answer, held in memory for this client's
lifetime, with fresh: false and since. Without one it refuses E_OFFLINE
(family link, retryable). It never answers an empty device page as server data."##,
        "expire" => r##"# Expire: a row's life ends at a time

```quarry
table stories:
  authorId: principal
  body: text <=500
  expiresAt: time ?                        -- a null time never expires
  by byAuthorTime: authorId, id
  by byExpiresAt: expiresAt                -- the sweep finds due rows here, without a walk
  read <- .authorId = viewer
  insert <- .authorId = viewer
  update <- deny
  delete <- .authorId = viewer
  expire at .expiresAt
  sync to .authorId last 200 by byAuthorTime

mutation postStory(body: text <=500, ttl: int ?):
  return insert stories { authorId: viewer, body, expiresAt: now + ttl if ttl != null else null }

query expiringStories(c: cursor ?):
  return stories[viewer] after c last 20 by byAuthorTime { id, body, expiresAt }
```

A typing indicator or presence row with a short deadline needs this local
filter: hide it at its deadline, even while the next answer is still pending.
`guide reads` carries a compilable typing table and its 4,500 ms deadline.
This is an application table, separate from the server's `connected[p]`.
That server-decided connection signal has no `expiresAt`.
A row already returned stays in that answer until the next answer; a live
reader that must hide it at its deadline drops it locally by `expiresAt`.
The server will not return the row again after expiry, but does not push a
removal at the instant of expiry. Select the deadline in the query, as above.
The local client reschedules its watch at `Read.nextExpiry`; keep the render
filter so the row hides at its deadline rather than at the refetch.
Given `rows` from a ready answer and your `render` function, render now and
schedule another render at each non-null deadline (epoch milliseconds):

```ts
const paint = () => render(rows.filter(row => row.expiresAt === null || row.expiresAt > Date.now()));
paint(); const timers = rows.flatMap(row => row.expiresAt === null ? [] : [setTimeout(paint, Math.max(0, row.expiresAt - Date.now()))]);
```

Clear these timers with `timers.forEach(clearTimeout)` before replacing the
answer or unmounting. This short-lived-row example uses the client's clock
and timer scheduling; `null` never expires.

In tests, use `snapback4 clock advance <dur>` or `POST /dev/clock/advance`; each example line advances the running dev once.

```sh
snapback4 clock advance 36s
curl -X POST http://127.0.0.1:4400/dev/clock/advance -H 'Content-Type: application/json' -d '{"duration":"36s"}'
```

A row past the time in the column is absent — to every reader, on every
host, before any rule — from that moment; the server's sweep deletes it
within a second, and the deletion streams to each device holding it, so it
leaves local stores on the next sync. In development, `snapback4 clock advance 185s`
runs that sweep immediately on the running `dev`; the deletion reaches both
device stores through normal sync, without changing the device clock (guide clock).
Disappearing messages are one field on
insert; there is no purge job to write. A `maintain` over an expiring table
reads its live source group under the read meter through an internal selected
contribution index. Physical zero-sum occupancy reads at most one index entry. A rule may probe whether that live group
exists at one rule-probe unit, regardless of expired sources. A rule equality
on its `value` is refused at `check` (E_QUARRY_LIVE_MAINTAIN_PROBE): read the
maintain in the program; its live value cannot be probed at one unit. Value
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
sources and says `complete: false`. A meter cut returns the contribution
examined so far, also incomplete. A zero sum keeps its group while sources
remain, because one signed contribution can expire before another."##,
        "assets" => r##"# Assets

The local client keeps server upload facts for prediction: `{ id }` works
offline after upload, including reads of duration and dimensions. Without
those facts the write queues unpredicted and the server judges it.
With `createLocalClient({ assets: { keep: "viewed", maxBytes: 67108864 }, ... })`,
ordinary viewed images and videos survive offline reopen in device storage.
`keep: "none"` (the default) retains no media. The byte bound evicts least
recently used assets. Home-row deletion, clearing, expiry and partition leave
purge the bytes; `once` is never stored. Online reads always revalidate.: upload, place, serve

```quarry
table clips:
  ownerId: principal
  photo: image <=10000000 once ?           -- `once`: one view per principal, never cached
  clip: video <=50000000 ?
  at: time
  by byOwnerTime: ownerId, at, id
  read <- .ownerId = viewer
  insert <- .ownerId = viewer
  update <- deny
  delete <- .ownerId = viewer
  sync to .ownerId last 100 by byOwnerTime

mutation sendClip(clip: video <=50000000):
  duration = clip.duration                 -- the argument carries the facts the server sniffed: type, bytes, width, height, duration; null where the kind has none
  require duration != null else DURATION_UNKNOWN
  require duration <= 60000 else TOO_LONG
  return insert clips { ownerId: viewer, clip, at: now }
```

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
`once`: the second fetch by the same principal is 410 E_ASSET_VIEWED, and
the uploader is counted after placement; before placement the uploader may
preview. A Range request against a once asset is refused before consuming a
view (E_ASSET_RANGE). Unsatisfiable ordinary ranges return HTTP 416. Every
asset response is `private, no-store`, so a browser must reauthorize each
viewer. At most two uploads run at once, and their disk writes happen outside
the engine mutex. Uploads are online only; there is nothing to queue."##,
        "reads" => reads::CARD,
        "shapes" => shapes::CARD,        "writes" => writes::CARD,
        "programs" => programs::CARD,
        "jobs" => jobs::CARD,
        "native" => native::CARD,
        "feeds" => concat!(include_str!("guide/feeds.md"), "\n", include_str!("guide/timelines.md")),
        "search" => search::CARD,
        "actions" => actions::CARD,
        "routes" => routes::CARD,
        "effects" => effects::CARD,
        "services" => services::CARD,
        "presence" => presence::CARD,        "bounds" => bounds::CARD,
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
