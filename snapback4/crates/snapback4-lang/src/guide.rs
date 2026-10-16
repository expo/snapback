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
#[path = "guide/sharing.rs"]
mod sharing;
#[path = "guide/indexes.rs"]
mod indexes;
#[path = "guide/types.rs"]
mod types;
pub use discovery::{FULL_LINES, piped, alias_landing, aliases, find, listing, nearest, overview, overview_and_first_section, section, section_index, sections};
pub const SERVER_KEYWORDS: &[&str] = &["actions", "routes"];
pub const KEYWORDS: &[&str] = &["language", "from-sql", "app", "types", "recipes", "rule-recipes", "time", "indexes", "maintains", "totals", "offline-interactions", "rules", "sync", "sharing", "residency", "prediction", "evolution", "deploy", "expire", "ephemeral", "assets", "client", "api", "wire", "social", "reads", "shapes", "writes", "sequences", "programs", "jobs", "native", "feeds", "search", "effects", "actions", "routes", "services", "presence", "receipts", "read-only", "manual-receipts", "bounds", "refusals", "personas", "testing", "witness", "start", "cheatsheet", "changes", "production"];

// @ref LLP 3000.007#20.1 — a builder's word resolves through one table to a compiled card.
pub const ALIASES: &[(&str, &str)] = &[
    ("schema", "language"), ("reference", "types"), ("references", "types"), ("principal", "personas"), ("principals", "personas"), ("first admin", "deploy"),
    ("useAuth", "client"), ("useRelease", "client"), ("useClient", "client"), ("useViewer", "client"), ("useSignedInViewer", "client"), ("usePersonaApp", "client"), ("useSession", "client"), ("useQuery", "client"), ("usePage", "client"), ("useFollowing", "client"), ("useMutation", "client"), ("useAction", "client"), ("useAsset", "client"), ("useSaveAsset", "client"), ("useUpload", "client"), ("useLink", "client"), ("useOnline", "client"), ("useNow", "client"), ("useAcquired", "client"), ("useAcquisition", "client"), ("usePendingWrite", "client"), ("usePendingWrites", "client"), ("usePendingItems", "client"), ("usePendingState", "client"), ("useSeen", "client"), ("useInspection", "client"),
    ("release", "deploy"), ("serve", "deploy"), ("rollback", "deploy"), ("upgrade", "changes"), ("optional param", "types"), ("mutation default", "writes"), ("service seat", "deploy"),
    ("identity", "deploy"), ("password", "deploy"), ("tokens", "deploy"), ("migrations", "deploy"),
    ("test", "testing"), ("tests", "testing"), ("fixture", "testing"), ("fixtures", "testing"), ("acceptance", "testing"), ("e2e", "testing"), ("cases", "testing"),
    ("index", "start"),
    ("oracle", "read-only"), ("observer", "read-only"), ("dashboard", "read-only"), ("preview", "read-only"),
    ("envelope", "bounds"), ("heaviest", "bounds"), ("1000", "bounds"),
    ("cold start", "bounds"), ("cold restart", "bounds"), ("acquire", "bounds"),
    ("latency", "bounds"), ("performance", "bounds"), ("p95", "bounds"),
    ("benchmark", "bounds"), ("load test", "bounds"),
    ("http", "wire"), ("curl", "wire"), ("rest", "wire"), ("protocol", "wire"),
    ("react", "client"), ("hooks", "client"), ("expo", "client"), ("ios", "client"), ("react native", "client"),
    ("dm", "social"), ("direct message", "social"), ("chat", "social"),
    ("composer", "client"), ("unread", "client"), ("readPresentation", "client"), ("read-presentation", "client"),
    ("existence", "client"), ("what does a missing row mean", "client"),
    ("loading or absent", "client"), ("unknown membership offline", "offline-interactions"),
    ("typing", "ephemeral"),
    // @ref LLP 3000.007#20.1 — `clock` used to open the 386-line jobs card; time words open the short time card.
    ("clock", "time"), ("dev clock", "time"), ("date", "time"), ("dates", "time"), ("now", "time"), ("day", "time"),
    ("duration", "time"), ("durations", "time"), ("calendar", "time"), ("timezone", "time"), ("time zone", "time"),
    ("cheat sheet", "cheatsheet"), ("cheat", "cheatsheet"), ("quick reference", "cheatsheet"), ("quickref", "cheatsheet"),
    ("exports", "api"), ("imports", "api"), ("subpaths", "api"), ("api reference", "api"), ("signatures", "api"),
    ("mutation", "writes"), ("mutations", "writes"),
    ("schedule", "jobs"), ("schedules", "jobs"), ("cron", "jobs"),
    // @ref LLP 3000.007#20.1 — wave 4: the shapes builders assembled from several cards open one compiled recipe.
    ("recipe", "recipes"), ("roles", "recipes"), ("role", "recipes"), ("admin", "deploy"), ("rbac", "recipes"),
    ("composite role", "rule-recipes"), ("composite roles", "rule-recipes"), ("blind writer", "rule-recipes"), ("hidden parent", "rule-recipes"),
    ("not before", "rule-recipes"), ("timed disclosure", "rule-recipes"),
    ("permissions", "recipes"), ("two-party", "recipes"), ("two party", "recipes"), ("buyer seller", "recipes"),
    ("marketplace", "recipes"), ("booking", "recipes"), ("bookings", "recipes"), ("reservation", "recipes"),
    ("reservations", "recipes"), ("capacity", "recipes"), ("seats", "recipes"), ("double booking", "recipes"),
    ("recurring", "recipes"), ("recurring job", "recipes"), ("close at time", "recipes"),
    ("simulator", "witness"), ("offline proof", "witness"),
    ("grammar", "language"), ("quarry", "language"),
    ("view", "maintains"), ("views", "maintains"), ("maintain", "maintains"), ("aggregates", "totals"),
    ("aggregate", "totals"), ("sum", "totals"), ("sums", "totals"), ("count", "totals"), ("counts", "totals"),
    ("total", "totals"), ("rollup", "totals"), ("counters-aggregates", "totals"),
    ("replay", "personas"), ("replay adapter", "personas"), ("seed", "personas"),
    ("predict", "prediction"), ("predictable", "prediction"), ("offline", "prediction"),
    ("optimistic", "prediction"), ("pending", "prediction"),
    ("pagination", "reads"), ("paging", "reads"), ("cursor", "reads"), ("next", "reads"),
    // @ref LLP 3000.007#20.1 — wave 5: words builders tried (`guide queries`, `language --section loops`).
    ("query", "reads"), ("queries", "reads"), ("loop", "language"), ("loops", "language"),
    ("insert", "writes"), ("update", "writes"), ("upsert", "writes"), ("delete", "writes"),
    // @ref LLP 3000.007#20.1 — wave 7: section words builders guessed (`--section statements`, `react`, `money`).
    ("statements", "writes"), ("statement", "writes"), ("money", "types"), ("currency", "types"),
    ("household", "sharing"), ("households", "sharing"), ("multi-tenant", "sharing"), ("tenant", "sharing"), ("membership", "sharing"),
    ("sealed", "expire"), ("sealed bid", "expire"), ("sealed bids", "expire"), ("blind", "expire"), ("reveal", "expire"),
    ("roster", "cheatsheet"), ("rosters", "cheatsheet"), ("probe", "cheatsheet"), ("positional", "cheatsheet"),
    ("division", "types"), ("integer", "types"), ("reserved", "cheatsheet"), ("reserved words", "cheatsheet"),
    ("persona", "personas"), ("persona picker", "personas"), ("switch persona", "personas"), ("picker", "personas"),
    ("migration", "deploy"), ("migrate", "deploy"), ("schema-evolution", "evolution"), ("adoption", "evolution"),
    ("releases", "deploy"), ("prune", "deploy"),
    ("sql", "from-sql"), ("convex", "from-sql"), ("rosetta", "from-sql"), ("inspect", "personas"),
    ("reports", "receipts"), ("delivery", "receipts"), ("receipt", "receipts"), ("delivered", "receipts"), ("read receipts", "receipts"), ("ticks", "receipts"), ("watermark", "receipts"),
    ("push", "effects"), ("notification", "effects"), ("notify", "effects"), ("worker", "effects"), ("workers", "effects"), ("background", "effects"), ("idempotency", "effects"),
    ("route", "routes"), ("webhook", "routes"), ("webhooks", "routes"),
    ("auth", "personas"), ("signin", "deploy"), ("login", "deploy"), ("session", "personas"),
    ("fixture test", "testing"), ("fixture tests", "testing"), ("cross row", "rules"),
    ("headless", "personas"), ("signup", "deploy"), ("sign-up", "deploy"), ("register", "deploy"),
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

/// Aliases that name one section of their card: `guide <alias>` prints that
/// section (with a line naming it; `--full` still prints the card), and
/// `--section <alias>` or `--find <alias>` inside that card land there when
/// no heading or line holds the word. Each entry is (alias, heading words).
// @ref LLP 3000.007#20.1 — wave 6: `guide pagination` opened the reads card's index, and `--section pagination` found nothing.
pub const ALIAS_SECTIONS: &[(&str, &str)] = &[
    ("pagination", "Pages and cursors"), ("paging", "Pages and cursors"), ("cursor", "Pages and cursors"),
    ("first admin", "First admin"), ("roles", "Roles"), ("role", "Roles"), ("admin", "First admin"), ("rbac", "Roles"), ("permissions", "Roles"),
    ("two-party", "Two parties"), ("two party", "Two parties"), ("buyer seller", "Two parties"), ("marketplace", "Two parties"),
    ("booking", "Booking"), ("bookings", "Booking"), ("reservation", "Booking"), ("reservations", "Booking"),
    ("capacity", "Booking"), ("seats", "Booking"), ("double booking", "Booking"),
    ("recurring", "Schedules"), ("recurring job", "Schedules"), ("close at time", "Schedules"),
    ("e2e", "An acceptance script over HTTP"), ("acceptance", "An acceptance script over HTTP"),
    ("division", "Limits"), ("reserved", "Quarry"), ("reserved words", "Quarry"), ("subpaths", "Client subpaths"),
    ("statements", "Details"), ("statement", "Details"), ("loops", "Loops"), ("loop", "Loops"),
    ("react", "React"), ("hooks", "React"),
    ("household", "A group's private list"), ("households", "A group's private list"), ("multi-tenant", "A group's private list"),
    ("tenant", "A group's private list"), ("membership", "A group's private list"),
    ("sealed", "Sealed"), ("sealed bid", "Sealed"), ("sealed bids", "Sealed"), ("blind", "Sealed"), ("reveal", "Sealed"),
    ("not before", "Timed disclosure and timed writes"), ("timed disclosure", "Timed disclosure and timed writes"),
    ("roster", "Roles and rosters"), ("rosters", "Roles and rosters"), ("probe", "Roles and rosters"), ("positional", "Roles and rosters"),
    ("fixture test", "Fixtures and cases"), ("fixture tests", "Fixtures and cases"),
    ("cross row", "Hops, operators and read through"),
];

/// The section an alias names in its card, if it names one: (card, heading words).
pub fn alias_section(word: &str) -> Option<(&'static str, &'static str)> {
    let (alias, heading) = ALIAS_SECTIONS.iter().find(|(alias, _)| alias.eq_ignore_ascii_case(word.trim()) || alias.eq_ignore_ascii_case(&word.trim().replace('-', " ")))?;
    Some((resolve(alias)?, heading))
}

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
/// The program is printed in parts under `###` headings in Details (so
/// `--section loops` finds its part); the parts, in order, are one program.
// @ref LLP 3000.007#20.1 — wave 5: the 470-line program is split under findable headings and reassembled here.
pub fn language() -> String {
    let details = LANGUAGE.split_once("\n## Details\n").expect("the language card has Details").1;
    let details = details.split_once("\n## With `use server`").expect("Details ends at the server opt-in").0;
    let program = details.split_once("\n### ").expect("the program starts at Details' first subsection").1;
    let parts = quarry(program);
    assert!(parts.iter().any(|block| block.contains("query heldRoom(")), "the language card has a core program");
    parts.concat()
}

/// One part of the language card's core program (a block that compiles only
/// as [`language()`]).
pub fn language_part(block: &str) -> bool {
    let program = language();
    block.len() < program.len() && program.contains(block) && quarry(LANGUAGE).iter().any(|part| part == block)
}

#[path = "guide/templates.rs"]
mod templates;
pub use templates::{TEMPLATE, TEMPLATE_ONLINE};

/// The language card: a core program that compiles and runs, then the opt-in,
/// then what is left out on purpose and the idiom for each.
#[path = "guide/language.rs"]
mod language_card;
pub use language_card::LANGUAGE;

/// The card a word names: a keyword, or an alias's target (any case).
pub fn resolve(word: &str) -> Option<&'static str> {
    ALIASES.iter().find(|(alias, _)| alias.eq_ignore_ascii_case(word.trim()) || alias.eq_ignore_ascii_case(&word.trim().replace('-', " "))).map(|(_, target)| *target)
        .or_else(|| KEYWORDS.iter().copied().find(|name| name.eq_ignore_ascii_case(word)))
        .or_else(|| {
            let prefix = word.trim().to_lowercase();
            if prefix.len() < 3 { return None; }
            let hits: std::collections::BTreeSet<_> = KEYWORDS.iter().copied().filter(|name| name.starts_with(&prefix))
                .chain(ALIASES.iter().filter(|(alias,_)| alias.to_lowercase().starts_with(&prefix)).map(|(_,target)|*target)).collect();
            (hits.len() == 1).then(|| *hits.iter().next().unwrap())
        })
}

pub fn card(keyword: &str) -> Option<&'static str> {
    let keyword = resolve(keyword)?;
    Some(match keyword {
        "start" => start::card(),
        "language" => LANGUAGE,
        "ephemeral" => include_str!("guide/ephemeral.md"),
        "wire" => include_str!("guide/wire.md"),
        "deploy" => include_str!("guide/deploy.md"),
        "from-sql" => include_str!("guide/from_sql.md"),
        "app" => app::CARD,
        "recipes" => include_str!("guide/recipes.md"),
        "rule-recipes" => include_str!("guide/rule_recipes.md"),
        "witness" => include_str!("guide/witness.md"),
        "prediction" => prediction::CARD,
        "evolution" => discovery::EVOLUTION,
        "changes" => include_str!(concat!(env!("OUT_DIR"), "/changes.md")),
        "production" => include_str!("guide/production.md"),
        "types" => types::CARD,
        "time" => include_str!("guide/time.md"),
        "cheatsheet" => include_str!("guide/cheatsheet.md"),
        "api" => include_str!("guide/api.md"),
        "sequences" => include_str!("guide/sequences.md"),
        "indexes" => indexes::CARD,
        "maintains" => include_str!("guide/maintains.md"),
        "totals" => include_str!("guide/totals.md"),
        "offline-interactions" => include_str!("guide/offline_interactions.md"),
        "rules" => include_str!("guide/rules.md"),
        "sync" => sync::CARD,
        "sharing" => sharing::CARD,
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
offline, then restart it. `run` beside a responsive dev forwards to it as the
persona (POST /q, /m or /dev/jobs) on its clock; `--now`, other principals and
`serve` refuse with the equivalent curl. For other writers, stop the host, run
the command once, then restart it. Another CLI writer also refuses; wait for it.
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

Sweeps apply declared reference actions while the parent image remains.
Parents already physically swept by 0.4.28 cannot trigger these actions on upgrade.

E_EXPIRY_ORPHAN means a stored reference points to a physically missing expiring parent.
`doctor` reports these references, which may also be deliberately dangling data.
After backup/review, stop the host and run
`snapback4 doctor --repair-expiry-orphan table:id` (add `--release dir` for deployed
storage). It applies the current schema's cascade/set-null actions atomically,
retaining keep references; restrict/read-through blockers refuse.
It never reconstructs a parent or silently deletes dangling rows at adoption.

`not before .opensAt` and `expire at .expiresAt` define `[opensAt, expiresAt)`;
`guide timed disclosure` has the compiled recipe.

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
The meter charges only rows live at the read's clock: an unswept expired row
costs no meter on any store or device; its walk is store work (guide bounds).
For receipt gaps in expiring messages, use `sequence by` and bounded unique
ordinal probes: `guide sequences` has the compiled recipe and a row-keyed count.
Disappearing messages are one field on
insert; there is no purge job to write. An ordinary maintained `view` over an expiring table
reads its physical total minus unswept expired contributions through an
internal group/expiry/source-id index, as store work off the meter. Live rows add no server
read work. Devices still recompute live source contributions under their meter;
partial source coverage or a cut cannot supply an exact aggregate. Physical zero-sum occupancy reads at most one index entry. A rule may probe whether that live group
exists at one rule-probe unit, regardless of expired sources. A rule equality
on its `value` is refused at `check` (E_QUARRY_LIVE_MAINTAIN_PROBE): read the
view in the program; its live value cannot be probed at one unit. Value
equalities on non-expiring maintains and ordinary tables remain supported. Row-keyed counts certify predicates separately (guide maintains).
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


## Sealed until a deadline

A read rule cannot name `now`, so access that *begins* at a time (sealed bids,
blind reviews, answers revealed after an exam) is the absence of a row that
expires then. Issuing an RFQ writes a public `seals` row with `expire at
.until`, its deadline (`after insert` makes the seal mandatory; `unique rfq`
and no update or delete rule keep it). The buyer's copy of each bid is read
under `not exists seals[.rfq]`, so it appears to the buyer when the seal
expires, on the server's clock, with no job. Bidding requires the seal. The
supplier reads its own bid from `bids`; the buyer's copy is a second table,
written in the same mutation and checked column by column against it, because
one table per audience keeps both pages `complete` (one `or` across
supplier and buyer would never be). Test it with fixture seals already past
and not yet past their `until`, or `snapback4 clock advance` on `dev`.

```quarry
use personas alice, bob, carol

table rfqs:
  buyer: principal
  title: text 3..100
  deadline: time
  immutable buyer, title, deadline
  public 'anyone may read an RFQ and its deadline'
  insert <- .buyer = viewer
  after insert <- exists seals[.id]
  online only

table seals:
  rfq: rfqs
  until: time
  unique rfq
  immutable rfq, until
  public 'a seal says only that bids are still sealed, and until when'
  insert <- created rfqs[.rfq] and .rfq.buyer = viewer and .rfq.deadline = .until
  expire at .until
  online only

table bids:
  rfq: rfqs
  supplier: principal
  buyer: principal
  cents: int
  unique rfq, supplier else ALREADY_BID
  immutable rfq, supplier, buyer, cents
  read <- .supplier = viewer
  insert <- .supplier = viewer and .buyer = .rfq.buyer and exists seals[.rfq]
  online only

table opened:
  bid: bids
  rfq: rfqs
  buyer: principal
  supplier: principal
  cents: int
  unique bid
  immutable bid, rfq, buyer, supplier, cents
  read <- .buyer = viewer and not exists seals[.rfq]
  insert <- created bids[.bid] and .rfq = .bid.rfq and .buyer = .bid.buyer and .supplier = .bid.supplier and .cents = .bid.cents
  online only

query myBid(rfq: rfqs):
  return bids[rfq, viewer]

query revealed(rfq: rfqs, c: cursor ?):
  return opened where .rfq = rfq and .buyer = viewer first 100 by .id after c

mutation issue(title: text 3..100, minutes: int):
  require minutes >= 1 and minutes <= 43200 else BAD_DEADLINE
  r = insert rfqs { buyer: viewer, title, deadline: now + minutes * 1m }
  insert seals { rfq: r.id, until: r.deadline }
  return r

mutation bid(rfq: rfqs, cents: int):
  r = rfqs[rfq] ! else NOT_FOUND
  require exists seals[rfq] else CLOSED
  require cents > 0 else BAD_AMOUNT
  b = insert bids { rfq, supplier: viewer, buyer: r.buyer, cents }
  insert opened { bid: b.id, rfq, buyer: r.buyer, supplier: viewer, cents }
  return b
```

Cases (alice's RFQ `r1` sealed until 2100 and `r2` already past, each with one bid by bob):

```jsonl
{"as":"alice","op":"revealed","args":{"rfq":"r1"},"expect":"complete","count":0,"label":"sealed until the deadline"}
{"as":"alice","op":"revealed","args":{"rfq":"r2"},"expect":"complete","count":1,"label":"the seal expired: the buyer reads every bid"}
{"as":"carol","op":"revealed","args":{"rfq":"r2"},"expect":"complete","count":0,"label":"another supplier never does"}
{"as":"carol","op":"bid","args":{"rfq":"r2","cents":500},"expect":"CLOSED"}
{"as":"carol","op":"bid","args":{"rfq":"r1","cents":800}}
{"as":"carol","op":"bid","args":{"rfq":"r1","cents":750},"expect":"ALREADY_BID"}
```

## Operations

In tests, use `snapback4 clock advance <dur>` or `POST /dev/clock/advance`; each example line advances the running dev once.

```sh
snapback4 clock advance 36s
curl -X POST http://127.0.0.1:4400/dev/clock/advance -H 'Content-Type: application/json' -d '{"duration":"36s"}'
```"##,
        "assets" => r##"# Assets: upload, place, serve

Assets are uploaded images, videos and files (documents: "Files" below)
attached to a row. That row's read rule controls who can fetch the bytes.

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

Choose a bounded `image`, `video` or `file` column first; upload bytes, place
`{ id: uploaded.asset.id }` through a mutation, then render with `useAsset`.
Image capture in a browser uses the same upload path:

```tsx
<input type="file" accept="image/jpeg,image/png,image/webp" capture="environment"
  onChange={async event => {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    const uploaded = await client.upload(file);
    if (uploaded.ok) await save.run({ photo: { id: uploaded.asset.id } });
    else setError(uploaded.why.message);
  }} />
```

The row write can refuse independently of upload. Keep the receipt and error
in the form owner; raw `POST /assets` returns `{ asset, generation }`.


`POST /assets` uploads raw bytes with the viewer's session (Authorization: Bearer TOKEN) or a declared dev persona (x-snapback-persona: alice).
Set Content-Type to the file MIME type; the response is `{ "asset": { "id": "...", "type": "image/png", "bytes": 123, "width": 1, "height": 1, "duration": null } }`.
For files use `POST /assets?as=file&name=voice.wav`; the asset has id, type, bytes and name.
Pass `{ id }` to a placement mutation: the home row's read rule then authorizes `GET /assets/<id>`.
An uploaded but unplaced asset is private to its uploader. Audio is a file, not a video.

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
the engine mutex. client.upload transfers bytes online and never queues them; device-owned uploadAndPlace/useUpload keeps durable offline capture and placement custody (below).
The host admits 128 HTTP connections plus one per long wait (1,184 by
default). Excess connections receive HTTP 503 E_RATE_LIMIT before request
admission; full request worker pools also refuse.
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

`once` is a bytes-once contract. The handle and metadata (id, type, dimensions,
byte size) may remain after viewing. A visible handle is never permission to
show content. When `useAsset` or a fetch refuses with E_ASSET_VIEWED, render
"Opened" (or similar):
```tsx
import { useAsset } from "snapback4/react";
function OncePhoto({ id }: { id: string }) {
  const asset = useAsset(id); // under SnapbackProvider
  if (asset.status === "denied" && asset.why.code === "E_ASSET_VIEWED") return <span>Opened</span>;
  return asset.status === "ready" ? <img src={asset.url} alt="Photo" /> : null;
}
```

At startup `dev` and `serve` try to raise the soft file-descriptor limit to the
hard limit, capped at 65,536 (also capped by macOS host limits). Failure is
logged once and serving continues. Startup and live `doctor` report the server's
effective soft/hard limits and warn below 2,048 descriptors (the parallel server
tests peaked at 1,197). Without a live report, `doctor` shows its inherited limits
and the server's startup target; a low inherited soft limit alone needs no action.
A hard limit or platform ceiling below 2,048 needs a host limit change and server
restart. Children inherit the raised soft limit; Node can raise its own
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
  if (avatar.status === "loading") return <span>{avatar.waiting?.why?.message ?? `Loading avatar (${avatar.waiting?.stage ?? "scheduled"}, ${avatar.waiting?.received ?? "?"}/${avatar.waiting?.total ?? "?"} bytes)…`}</span>;
  return avatar.status === "ready"
    ? <img src={avatar.url} alt={author?.displayName ?? "Author"} />
    : <span>{author?.displayName ?? "Unknown author"}</span>;
}
```

`null` means `empty`, not a failed download. Inspect the profile read and the
asset's `why` when its status is `denied` or `error` separately; an initials placeholder must not hide a refusal.
Every hook `loading` result has `waiting.stage`, `since` and `diagnosticAt`;
`waiting` is optional in AssetState so older loading literals still typecheck.
Stages name scheduling, session-store checks, media reconciliation, refresh,
queue, headers/body, backoff, retention and display conversion; custom clients
report `client`. Stage changes and received bytes restart the deadline; backoff
preserves an overdue stage's explanation as described below. Streaming bodies expose `waiting.received` and, when known,
`waiting.total` bytes. `waiting.why` adds E_ASSET_WAIT with the stage's explanation:
streams diagnose after 4,999 ms without bytes, with a five-second abort;
other stages use five seconds. Opaque headers/body waits report
`waiting.progress: "unknown"` and diagnose after fifteen seconds without a stage
change, while keeping the full buffered allowance below. Unknown progress is
not proof of a stalled network; a healthy long opaque transfer can show this notice.
When abort and diagnostic updates share a React commit, backoff still carries
`waiting.why`. `waiting.interrupted` preserves the preceding stage, progress,
timestamps and diagnostic, while `waiting.stage` names `backoff`. Capture uses
the elapsed deadline even if the diagnostic callback has not run. Backoff can
add its own notice after five seconds; the interrupted snapshot stays until the
next attempt, which clears both notices. Terminal outcomes replace loading.
Render it instead of hiding all non-ready states. This is
a diagnostic of the still-pending request, not a retry or consumed-view verdict;
healthy long transfers may finish. Unmount cancels the diagnostic timer, and
late obsolete results cannot publish. Timers require a runnable JS host.
Expo streams do not imply its Blob accepts byte arrays: the SDK uses the host's
`Response.blob()` when buffer construction is unsupported, with the buffered
allowance below. Local assembly failures report E_CLIENT, not offline. Its public
body-read/conversion boundary works through a separate receiver even for sealed
or frozen Expo responses, without modifying the response or its prototype.

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
in `guide client`, never this automatically fetched avatar pattern.

## Files: receipts, contracts and other documents

A `file` column holds a document under the image contract: the uploader's
until placed, one home, served by that row's read rule, released on delete,
clear or expiry, swept when unclaimed. Nothing is transcoded or previewed.

```quarry
table receipts:
  owner: principal
  scan: file <=10000000 ('application/pdf', 'image/jpeg', 'image/png')
  extras: [file <=2000000] <=4 ?           -- no list: every verifiable type
  at: time
  read <- .owner = viewer
  insert <- .owner = viewer
  delete <- .owner = viewer
  sync to .owner last 200 by .at

mutation addReceipt(scan: file <=10000000 ('application/pdf', 'image/jpeg', 'image/png')):
  require scan.bytes <= 5000000 else TOO_LARGE   -- scan.type, .bytes, .name: the server's facts
  return insert receipts { owner: viewer, scan, at: now }
```

Verifiable types, the default list: `audio/wav`, `audio/mpeg` (MP3), `audio/flac`, `application/pdf`, `text/plain`,
`text/csv`, `text/markdown`, `application/json`, `image/png`, `image/jpeg`,
`image/webp`, `image/gif`, `application/zip` and the Office Open XML
document, sheet and presentation types. HTML, SVG, XML and JavaScript are
never files: `check` refuses them (upload such text as `text/plain`).
`once` does not apply to a file.

`client.upload(file, { file: {} })` posts `/assets?as=file&name=<name>`
with the File's type as `Content-Type` (`{ file: { type, name } }`
overrides). The server checks the declared type against the bytes (`%PDF-`,
image and zip headers, UTF-8 text, parseable JSON); a mismatch, a type no
file column accepts, or HTML/SVG is E_ASSET_TYPE. Undeclared, PDF, PNG,
JPEG, WebP, GIF and zip are named by their bytes. The body is read only to
the largest file column's bound (413 E_ASSET_TOO_LARGE); placement checks
the column's list and bound. The reply and the row carry `{ id, type,
bytes, name }`: the name keeps its last path segment, without control or
bidi characters or leading dots, at most 255 bytes (`file` when empty).

A file is only ever a download: `Content-Disposition: attachment` with its
name, `nosniff`, a sandboxing CSP, text as `text/plain; charset=utf-8`;
ranges work. `saveAsset(client, id)` (`snapback4/client`) or
`useSaveAsset().save(id)` fetches it on a button press and saves it;
`client.asset(id)` and `useAsset(id)` also return its `name`. Fixture rows
may name a file cell (`{"scan":{"id":"r1","type":"application/pdf",
"bytes":1234,"name":"r.pdf"}}`) but have no bytes behind it: an acceptance
script uploads real bytes and places the returned id.

## Receipts: expense claims with a PDF or photo

An employee files a claim with its receipt; approvers see every claim and
decide it. The receipt is a `file` that accepts a PDF or a phone photo of
the paper: the server checks each upload's declared type against its bytes,
and the claim row's read rule decides who may download it (`guide assets`,
"Files"). Claims and their decisions are server work: the table is online
only, so nothing predicts.

```quarry
use personas alice, bob, ana

table approvers:
  principal: principal
  unique principal
  read <- .principal = viewer
  online only

table claims:
  owner: principal
  title: text 1..120
  cents: int
  receipt: file <=10000000 ('application/pdf', 'image/jpeg', 'image/png')
  decision: enum('approved', 'rejected') ?
  at: time default now
  read <- .owner = viewer or exists approvers[viewer]
  insert <- .owner = viewer
  update <- exists approvers[viewer]
  online only

query myClaims(c: cursor ?):
  return claims where .owner = viewer last 50 by .at after c

query allClaims(c: cursor ?):
  require exists approvers[viewer] else NOT_APPROVER
  return claims last 50 by .at after c

mutation fileClaim(title: text 1..120, cents: int, receipt: file <=10000000 ('application/pdf', 'image/jpeg', 'image/png')):
  require cents > 0 else BAD_AMOUNT
  require receipt.bytes <= 5000000 or receipt.type = 'application/pdf' else PHOTO_TOO_LARGE 'Photos must be under 5 MB; scan to PDF instead.'
  return insert claims { owner: viewer, title, cents, receipt }

mutation decide(claim: claims, decision: enum('approved', 'rejected')):
  require exists approvers[viewer] else NOT_APPROVER
  row = claims[claim] ! else NOT_FOUND
  require row.decision = null else ALREADY_DECIDED
  update claims[claim] { decision }
```

The client uploads the picked file, then files the claim with its id:
`const up = await client.upload(file, { file: {} })`, then
`client.mutate(api.fileClaim, { title, cents, receipt: { id: up.asset.id } })`
when `up.ok`. A download link calls `saveAsset(client, claim.receipt.id)`.
A wrong or spoofed type is `E_ASSET_TYPE` at upload, before any claim exists.

An acceptance script uploads real bytes as alice, places them, and checks
that bob is refused and ana (an approver) is served an attachment:

```sh
U=http://127.0.0.1:4400
id=$(curl -s -X POST "$U/assets?as=file&name=taxi.pdf" -H 'x-snapback-persona: alice' -H 'Content-Type: application/pdf' --data-binary @taxi.pdf | jq -r .asset.id)
curl -s -X POST $U/m/fileClaim -H 'x-snapback-persona: alice' -d "{\"args\":{\"title\":\"Taxi\",\"cents\":2350,\"receipt\":{\"id\":\"$id\"}}}"
curl -s -o /dev/null -w '%{http_code}\n' "$U/assets/$id" -H 'x-snapback-persona: bob'   # 404: bob cannot read the claim
curl -s -D - -o taxi-copy.pdf "$U/assets/$id" -H 'x-snapback-persona: ana' | grep -i content-disposition
```

Seed `approvers` with `{"id":"a1","principal":"dev:ana"}` in a fixture.

## Durable offline capture

For custody without waiting for reconnect:
```ts
import { hasUploads, uploadAndPlace } from "snapback4/local";
if (hasUploads(client)) {
  const write = await uploadAndPlace(client, api.placePhoto, {title}, file, {argument: "photo", waitSeconds: 0});
  // Keep the draft until sent; queued/uploading/placing are not success.
}
```
The placement mutation takes the named asset argument; online-only clients use client.upload then placement. Full recipe: OFFLINE-UPLOADS.md.

`useUpload` and `uploadAndPlace` commit a byte copy and its placing mutation
together to the device outbox. For the API, Exact adapter contract, typed
states, native save and WAV/MP3/FLAC file types, read the package's
`OFFLINE-UPLOADS.md`.

`E_CANCELLED`: the save/share sheet was cancelled. Call `saveAsset` again
when the user wants to retry.

`E_UPLOAD`: an upload is held without a recorded reason. Retry the same intent
or discard it before placement dispatch.

`E_UPLOAD_DEVICE`: pass `webDevice()` or Expo's `nativeDevice` to `createApp`;
the online-only client has no durable capture capability.

`E_UPLOAD_BYTES`: select nonempty bytes of at most 64 MiB; capture copies the
selected range before delivery.

`E_UPLOAD_ARGUMENT`: omit one declared image/video/file mutation argument,
name it in `argument`, and keep the other encoded args within 64 KiB.

`E_UPLOAD_QUOTA`: unresolved device or pinned owner bytes exceed 128 MiB.
Place or cancel earlier captures; `serverUploads()` finds abandoned pins.

`E_UPLOAD_INTENT`: use the SDK's upload-and-place declaration and stable id;
the device owns the original bytes, metadata, viewer and placing operation.

`E_UPLOAD_PENDING`: placement waits for its uploaded asset facts to commit.
Let the SDK deliver its dependency before sending the mutation.

`E_UPLOAD_CANCELLED`: the server's cancellation tombstone proves the intent
cannot place. Select a new id for a new capture.

`E_UPLOAD_DISPATCHED`: placement dispatch was reserved or begun; recover its
same-id outcome. Cancellation cannot manufacture failure for an unknown write.

`E_ASSET_INTENT_REUSE`: retry the original bytes, metadata and placing input,
or choose a new id. A declaration cannot be changed or reused for another row.

`E_ASSET_INTENT_EXPIRED`: the original asset was collected after settlement;
the same upload id cannot create another asset. Select a new capture/id.
"##,
        "read-only" => include_str!("guide/read_only.md"),
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
        "testing" => include_str!("guide/testing.md"),
        _ => return None,
    })
}

/// Every refusal code `why` explains, with its family. A program's own
/// `require` codes are the author's and are explained by the program.
mod codes;
pub use codes::{CODES, WHY_MAX_BYTES, codes, explain_code};
pub(crate) use codes::{explain_code_with_guide, explanation_section};
