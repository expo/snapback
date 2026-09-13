//! The guide: one grammar screen, keyword cards, and refusal codes. Text a
//! builder reads once and an agent reads on demand; no freshness dates,
//! nothing generated (LLP 3000 §4, NOT-DOING).

pub const TEMPLATE: &str = r#"-- Your backend. `snapback4 check` compiles it; `snapback4 dev` serves it.
use personas alice, bob

table todos:
  title: text <=200
  done: bool
  ownerId: principal
  by byOwner: ownerId, id
  read <- .ownerId = viewer
  insert <- .ownerId = viewer
  update <- .ownerId = viewer
  delete <- .ownerId = viewer
  sync to .ownerId                        -- each owner's device holds its own todos

query list():
  return todos[viewer] first 100 by byOwner

mutation add(title: text <=200):
  return insert todos { title, done: false, ownerId: viewer }

mutation toggle(todoId: todos):
  todo = todos[todoId] ! else NOT_FOUND
  update todos[todo] { done: not todo.done }
  return null

mutation remove(todoId: todos):
  delete todos[todoId]
  return null
"#;

pub const GRAMMAR: &str = r#"# Quarry (Snapback 4)

One file, `snapback/schema.q`, holds tables and operations; more `.q` files
beside it hold modules. Comments start with `--`. Blocks indent with spaces.

table messages:
  conversationId: conversations        -- a reference; `id` is implicit
  authorId: principal
  body: text <=4000 ?                  -- `?` is optional
  at: time
  by byConvTime: conversationId, at, id
  read <- exists memberships[.conversationId, viewer]
  insert <- .authorId = viewer and exists memberships[.conversationId, viewer]
  update <- .authorId = viewer
  delete <- deny
  sync to memberships[.conversationId] last 500 by byConvTime

Types: principal, id, <table>, int, time, bool, text <=N, text M..N,
text <=N format handle|url, enum('a', 'b'), json <=N, bytes <=N,
image <=N [once], video <=N, [type] <=N; `?` for optional. Operation
arguments add `cursor ?`.

Indexes: `by name: cols` orders; `unique name: cols` also constrains.
Constraints: `cap N by cols`, `immutable cols`, `after insert <- exists t[..]`.
Rules: read/insert/update/delete <- allow | deny | public | .col = viewer |
exists t[.col, viewer, 'literal'] | created t[..] | and, or, not, =, !=.
`update (old, next) <- old.x = next.x` names both images.

Sync: `sync public`, `sync to .principalColumn`, or `sync to target[.col]`
with an optional horizon `last N by index`. A synced table's rows reach
every device that may read them; a table without `sync` is online-only.
`maintain counts: count messages by conversationId` (with `read <- rule`)
is delivered into the partition as a value when it groups by the audience.

Programs:
query thread(conversationId: conversations, c: cursor ?):
  require exists memberships[conversationId, viewer] else MEMBERSHIP_REQUIRED
  return messages[conversationId] after c last 50 by byConvTime

mutation send(conversationId: conversations, body: text <=4000):
  return insert messages { conversationId, authorId: viewer, body, at: now }

Reads: `t[key]` (a unique key; null when absent or hidden), `t[key] ! else
CODE`, `exists t[key]`, `t[prefix] [after c] first|last N [by index]`,
`merge t first N by index:` with `[lane]` lines, `walk t[seed] up .col depth N`.
Shapes: `page { *, author: users[.authorId] }`; `.` is the row.
Writes: insert t {..} [if absent], update t[key] {..} [if cond],
upsert t[key] {..}, delete t[key]. A final write is the implicit return.
Statements: `x = expr`, `require cond else CODE`, `if:`/`else:`,
`for x in page:`, `return`, `emit effect payload`. Values: viewer, now,
new (an id), count(), sum(), slice(), min(), max(), tokens(), a ?? b,
a if cond else b (the arm not taken is never evaluated; `x != null` narrows x).

Personas: `use personas alice, bob`; run as one with `--as alice`.
More: `snapback4 guide <keyword>` — rules, sync, writes, reads, shapes,
bounds, types, personas, refusals.
"#;

pub fn card(keyword: &str) -> Option<&'static str> {
    Some(match keyword {
        "rules" => r#"# Rules

read, insert, update and delete each take one rule over the row (`.col`),
`viewer`, and literals: allow, deny, public ['reason'], `.col = viewer`,
`.col != 'x'`, `exists t[.a, viewer]`, `created t[..]` (insert only),
`and`, `or`, `not`. An update rule may name both images:
`update (old, next) <- old.ownerId = viewer and next.ownerId = viewer`.

`exists` probes need an index over exactly the probed columns; name it
with `by index` when two match. A probe over the table's own unique key is
uniform: one verdict serves a whole page. A read rule that is `exists
t[.col, viewer]` or `.col = viewer` can be synced (guide sync)."#,
        "sync" => r#"# Sync: the viewer's partition is the unit of sync

`sync public [last N by index]`          everyone holds the same rows
`sync to .col [last N by index]`         each row reaches the principal in .col
`sync to t[.a, .b] [last N by index]`    each row reaches every principal with a
                                         row in t whose a, b match

The read rule must be exactly the audience (`exists t[.a, .b, viewer]` or
`.col = viewer`; a second disjunct or an extra conjunct is refused with the
rewrite), so a device never holds a row it may not read and never misses
one it may. The
target table needs an index over (a, b, principal) and one leading with
(principal, a, b). The horizon keeps the newest N rows per group on the
device; older rows are online-only, and a read past them is `complete:
false`. Joining a group bootstraps its rows; leaving it sends one scope
tombstone, and the table's `retain` says whether delivered rows stay
(`delivered-history`) or go (`until-revoked`, the default).

A `maintain` grouped by the audience columns is delivered as a value row."#,
        "expire" => r#"# Expire: a row's life ends at a time

  expiresAt: time ?
  by byExpiresAt: expiresAt
  expire at .expiresAt

A row past the time in the column is absent — to every reader, on every
host, before any rule — from that moment; the server's sweep deletes it
within seconds and the deletion streams to each device holding it, so
it leaves local stores and local search on the next sync. A null time
never expires. Disappearing messages are one field on insert —
`expiresAt: now + ttl if ttl != null else null` with `ttl: int ?` — and
there is no purge job to write. The index leading with the column is
required so the sweep finds due rows without a walk."#,
        "assets" => r#"# Assets: upload, place, serve

  photo: image <=10000000 ?        a column; `once` after the bound serves one view per principal
  clip: video <=50000000 ?
  mutation sendPhoto(conversationId: conversations, photo: image <=10000000):
    row = insert messages { conversationId, authorId: viewer, photo, at: now }

A client uploads the bytes first (`client.upload(file)` → `{ id, type,
bytes, width, height, duration }`; the server sniffs JPEG, PNG, WebP and
MP4 and refuses the rest) and passes `{ id }` as the mutation's argument;
the row carries the facts the server established. One asset, one home:
the uploader's own upload, placed once. Serving is the home row's read
rule: `client.asset(id)` (a blob URL; `useAsset(id)` in React) or
`client.assetSource(id)` (a URI and headers for native views) fetches
`GET /assets/<id>` under the viewer's credentials, and a row that is
deleted, whose column is cleared, that expired, or that the viewer may
not read answers 404. `once`: the second fetch by the same principal is
410 `E_ASSET_VIEWED`, and the bytes are never cached anywhere."#,
        "jobs" => r#"# Jobs and schedules: the server's own work, on its own clock

  job digest(periodStart: time, periodEnd: time):
    chunk p in profiles first 100 by byId:
      ...reads and writes, as a mutation's body, with p bound...
  schedule daily every 1d at 08:00: digest        -- or: every 2m
  snapback4 run digest '{"periodStart": 0, "periodEnd": 1}'

A job is a sequence of sweeps. Each `chunk x in table[prefix] first N by
index:` walks one index a page per commit, as the system principal (every
rule passes; validation, constraints, aggregates and partitions apply),
under the job ceilings; the cursor commits with the rows, so a chunk is
wholly done or not started and a restart resumes at the next one. The
index's columns are `id` or `immutable` (nothing moves under the cursor);
rows inserted past the key captured when the sweep began are not
visited, so a sweep over its own table ends. `break` ends the sweep,
`return` the job; a refused chunk parks the job with its refusal
(`doctor` lists runs). No client calls a job: a schedule fires it once
per period boundary of the server's clock — exactly once across restarts,
with `periodStart`/`periodEnd` when the job declares them (nothing else)
— and `snapback4 run <job>` runs it here and now."#,
        "writes" => r#"# Writes

insert t { fields }            -> the row (id minted unless given)
insert t { fields } if absent  -> the row, or null on a unique clash
update t[key] { patch }        key: byId, or a full unique key (reads once,
update t[key] { patch } if .body = expected    NOT_FOUND when missing)
upsert t[key] { fields }       insert or replace; the key names the row
delete t[key]                  no value

A final write is the implicit return. Bind one to use it: `row = insert ..`.
Writes check the rule, then unique indexes, caps, immutable columns and
text formats; a refusal rolls the whole mutation back. Every written row
fans out to its partitions (guide sync)."#,
        "reads" => r#"# Reads

t[key]                          one row by a unique key; null if absent or hidden
t[key] ! else CODE              the row, or refuse with CODE
exists t[key]                   true or false; needs a matching index
t[prefix] first N by index      a page, ascending
t[prefix] after c last N by index   a page, descending, from a cursor `c: cursor ?`
merge t first N by index:       one ordered page over several prefixes
  [viewer]
  [f.followed] for f in follows[viewer] first 500 by byFollower
walk t[seed] up .parentId depth 8

A page's rule is checked once when the prefix decides it, else per row.
The meter counts examined rows and probes; a query cut by it returns what
it found and `complete: false` with no continuation."#,
        "shapes" => r#"# Shapes

page { *, author: users[.authorId], count: counts[.conversationId] }
row { id, title }
shape card = { id, title, owner: users[.ownerId] }   -- named, then `page card`

`.` is the row being shaped. `*` spreads every column. Point reads inside a
shape yield null for hidden rows. A shape over a page is a bounded loop; a
shape over a nullable row is null when the row is."#,
        "bounds" => r#"# Bounds and the meter

Nothing is priced at check. As a program runs, the meter counts examined
rows, index entries, rule probes, steps, heap bytes, output bytes and rows
written against ceilings (8,192 rows examined, 1,000,000 steps, 1 MiB
output, 1,024 rows written per mutation). A query past a ceiling returns
`complete: false` (capped); a mutation aborts with E_BOUND naming the
actual work and the site. `snapback4 check --cost` prints each site's
structural class; `snapback4 test` prints the numbers on your data."#,
        "types" => r#"# Types

principal, id, <table> (a reference), int, time (ms), bool, decimal <s>,
money <CUR> [s], text <=N, text M..N [format handle|url], enum('a','b'),
json <=N, bytes <=N, image <=N [once], video <=N, [type] <=N; `?` optional.
`viewer` is a principal. Text literals in id positions are ids. `=` and
`!=` are total (null equals null); `<` and friends need present operands:
narrow with `if x != null:`, `x ! else CODE`, or `x ?? default`."#,
        "personas" => r#"# Personas

`use personas alice, bob` declares a cast. `snapback4 run send '{..}' --as
alice` and the `x-snapback-persona: alice` header in development act as
`dev:alice`. Personas are loopback-only; a deployed server takes bearer
tokens (week 4)."#,
        "refusals" => r#"# Refusals

Every refusal is {code, family, message, site?, rewrite?, guide?}. Families:
input, schema, auth, rule (your `require` codes), constraint, bound, op.
`snapback4 why <CODE>` explains one."#,
        "programs" => r#"# Programs

query name(args):      reads; returns the last expression or `return`
mutation name(args):   reads and writes in one transaction; at most once per id
job name(args):        `chunk row in t[prefix] first N by index:` sweeps

Operations in schema.q are called by name (`api.thread`); operations in
`snapback/feed.q` are `api.feed.<name>`."#,
        _ => return None,
    })
}

/// A refusal code, explained.
/// Every refusal code `why` explains; a program's own `require` codes are
/// the author's and are explained by the program.
pub const CODES: &[&str] = &["E_INPUT", "E_SCHEMA", "E_RULE", "E_AUTH", "E_CONFLICT", "E_CONSTRAINT", "E_FANOUT", "E_BOUND", "E_OP", "E_STORE", "E_GENERATION", "E_OFFLINE", "E_PREDICT", "E_QUARRY_SYNTAX", "E_TYPE", "E_ASSET_TYPE", "E_ASSET_TOO_LARGE", "E_ASSET_UNKNOWN", "E_ASSET_PLACED", "E_ASSET_VIEWED", "N_NEVER_COMPLETE", "N_NO_CURSOR"];

pub fn explain_code(code: &str) -> Option<String> {
    let text = match code {
        "E_INPUT" => "family input — an argument or a row value does not fit its declared type. The message names the field; fix the value or the declaration.",
        "E_SCHEMA" => "family schema — the schema or the store is inconsistent. `snapback4 check` names the line.",
        "E_RULE" => "family auth — a table's insert, update or delete rule did not admit this viewer. Reads never raise it: a hidden row is null. Read the rule with `snapback4 why <table>`.",
        "E_AUTH" => "family auth — no principal: send `x-snapback-persona` in development or a bearer token.",
        "E_CONFLICT" => "family constraint — `update .. if` found the row changed; the failed write carries the current row. Read it and retry with a fresh edit.",
        "E_CONSTRAINT" => "family constraint — a unique index, a cap, an immutable column, an append-only table, a text format or an after-insert postcondition refused the write. The message names which.",
        "E_FANOUT" => "family bound — a loop received more items than its declared bound.",
        "E_BOUND" => "family bound — the meter cut a mutation: the message names the meter, the ceiling and the site (never the count: it would measure rows the viewer may not read). Read a smaller page, add an index, or move the sweep into a job.",
        "E_OP" => "family op — no such operation, or a query called as a mutation.",
        "E_STORE" => "family store — SQLite failed; retryable.",
        "E_GENERATION" => "family generation — the schema changed under a queued write; the client re-sends under the new generation.",
        "E_QUARRY_SYNTAX" => "the parser could not read this line; the rewrite is a canonical spelling.",
        "E_TYPE" => "family input — a Quarry expression has the wrong type for its position; the diagnostic names both types and a rewrite.",
        "E_OFFLINE" => "family link — the client could not reach the server; retryable. A local-first read still answers from the device with `fresh: false` and `since`; a write waits as `pending` and lands when the link returns.",
        "E_PREDICT" => "family input — the device could not predict this mutation locally (a read it needs is not on the device); the write is queued without local rows and the server judges it.",
        "E_ASSET_TYPE" => "family asset — the upload's bytes are not a JPEG, PNG, WebP or MP4, or no column of this backend takes that kind, or the column takes the other kind. Declare `photo: image <=10000000` / `clip: video <=50000000` and upload a file of that kind.",
        "E_ASSET_TOO_LARGE" => "family asset — the upload is larger than the largest column of its kind (or the column it is placed in). Downscale before uploading, or widen the column's bound.",
        "E_ASSET_UNKNOWN" => "family asset — no asset is served under that id to this viewer: it was never uploaded, it is another uploader's unplaced upload, its home row is gone, cleared, expired or hidden from this viewer. Hidden and absent are one word on purpose.",
        "E_ASSET_PLACED" => "family asset — the upload already belongs to a row: one asset, one home. Upload the bytes again for a second row.",
        "E_ASSET_VIEWED" => "family asset — a `once` image was served to this principal already; the second view is refused (HTTP 410). The sender is never counted.",
        "N_NO_CURSOR" => "a note, not an error — a returned page with no cursor argument cannot continue: when more rows exist than the page holds the card reads `complete: false` with no `next`. Declare `c: cursor ?` and page with `after c`.",
        "N_NEVER_COMPLETE" => "a note, not an error — a page whose read rule reads a column the scan does not pin is `complete: false` on the server whatever it finds; the note names the index that would decide it, or read the page on the device.",
        "E_QUARRY_TYPE" => "a value meets a declaration of another type; the message names both.",
        "E_QUARRY_UNKNOWN" => "a name is not declared; the rewrite suggests the nearest one.",
        "E_QUARRY_AMBIGUOUS" => "two indexes match a key; add `by index`.",
        "E_QUARRY_UNSUPPORTED" => "a form Snapback 4 does not have; the rewrite names the one it does.",
        "E_SYNC" => "a sync line cannot be honoured; the message names the rule term or index to change.",
        "E_UNBOUND_LOOP" => "a loop has no static bound; iterate a page, a bounded list argument, or tokens(text).",
        "E_OP_RESERVED" => "refusal codes in `require .. else CODE` cannot start with E_; that namespace is the platform's.",
        "E_EMIT_IN_QUERY" => "queries cannot emit effects; make it a mutation.",
        "NOT_FOUND" => "the program's own code for a write whose row does not exist (a direct update or delete of a missing point).",
        _ => return None,
    };
    Some(format!("{code}: {text}"))
}
