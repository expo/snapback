# Cheatsheet: the common forms on one screen

The forms most apps need, in one schema that compiles, then the commands and client calls; each line names the card with the rest.

```quarry
use identity                              -- guests and password accounts (guide personas)
use personas alice, bob                   -- a dev cast: `--as alice` acts as dev:alice

table lists:                              -- every table has an implicit `id`
  owner: principal
  title: text 1..80                       -- text <=N | text M..N; `T ?` is optional (null)
  archived: bool default false            -- `default` fills an omitted field
  at: time default now                    -- Unix ms, UTC
  immutable owner
  read <- .owner = viewer                 -- read | insert | update | delete <- predicate | allow | deny
  insert <- .owner = viewer
  update <- .owner = viewer
  delete <- .owner = viewer
  cap 100 by owner                        -- at most 100 rows per owner
  sync to .owner last 100 by .at          -- each owner's devices hold their newest 100
table items:
  list: lists                             -- a reference: the parent row's id
  owner: principal
  text: text 1..200
  done: bool default false
  immutable list, owner
  read <- .owner = viewer                 -- `read through .list` would inherit the list's rule, online only
  insert <- .owner = viewer and .list.owner = viewer   -- a read rule hops once, online only; else exists lists[.list, owner = viewer]
  update <- .owner = viewer
  delete <- .owner = viewer
  cap 500 by list
  sync to .owner
view openItems: count items where .done = false by .owner, .list   -- a maintained count; a missing group reads 0
  read <- .owner = viewer
table staff:                              -- a role: one row per staff member (guide recipes)
  principal: principal
  unique principal
  read <- .principal = viewer
  online only
table requests:                           -- owner or staff: two audiences, so `online only` (guide sharing)
  author: principal
  title: text 1..200
  read <- .author = viewer or exists staff[viewer]
  insert <- .author = viewer
  online only

query myLists(c: cursor ?):               -- a page; pass the answer's `next` back as `c`
  return lists where .owner = viewer last 20 by .at after c   -- `last` reads newest first; `first` oldest first
query itemsOf(list: lists, c: cursor ?):
  return items where .owner = viewer and .list = list first 50 by .id after c
query openCount(list: lists):
  return openItems[viewer, list]
query board(c: cursor ?):                 -- owner or staff on one page: branch on the grant; both complete
  if exists staff[viewer]:
    return requests last 50 by .id after c
  return requests where .author = viewer last 50 by .id after c

mutation addList(title: text 1..80):
  return insert lists { owner: viewer, title }
mutation addItem(list: lists, text: text 1..200):
  l = lists[list] ! else NOT_FOUND        -- bind a row, or refuse with a code
  require not l.archived else ARCHIVED 'This list is archived.'
  return insert items { list, owner: viewer, text }
mutation toggle(item: items):
  i = items[item] ! else NOT_FOUND
  update items[item] { done: not i.done }
  return null
mutation removeItem(item: items):
  delete items[item]
```

## Quarry

- Comments start with `--` (never `//`); blocks indent two spaces; `snapback/*.q` share one namespace.
- Types: `text <=N`, `text M..N` (a length), `int` (no range: bound it with `require n >= 1 and n <= 10 else CODE`), `bool`, `time` (Unix ms), `money USD`, `decimal 2`, `enum('a', 'b')`,
  `json <=N`, `bytes <=N`, `[text <=20] <=8`, `image <=N`, a table name (a reference); `T ?` is optional (`guide types`).
- Operators: `= != < <= > >=`, `and or not`, `+ - * / %`, `x ?? fallback`, `a if cond else b`, `exists t[k]`.
  `/` and `%` take ints (and times) and floor: `7 / 2` is 3, `-7 / 2` is -4, `-7 % 2` is 1; zero refuses E_DIV_ZERO.
  `money` and `decimal` add, subtract and multiply by an int but do not divide; `share(total, people, viewer)` splits an amount.
- Text: `'it\'s'` or `"it's"`; `\\`, `\n`, `\t` escape; `+` joins; a reference never becomes text. Durations (ms): `500ms 30s 15m 24h 7d`, `now + 1h`, `day(now)` (`guide time`).
- Rows: `t[id]` (null when absent or hidden), `r = t[id] ! else CODE`, `require cond else CODE 'message'`. `t[a, b]` takes
  a unique key's values in column order; `t[col = x]` names a column; in brackets a bare name is a local or argument, `.col` the row's.
- Pages: `where` is optional (`return pieces first 50 by .id after c`). Shapes: `t[x] { id, name: .title }` renames `title`; `name: title` reads a local.
- Writes: `insert t { .. }`, `update t[id] { .. }`, `upsert t[k] { .. }`, `delete t[id]` (`guide writes`).
  A missing target refuses NOT_FOUND, `delete` too: guard it with `if exists t[id]:` and `delete t[id]` on the next line.
  Each statement checks `unique`, so swap two keys through a free value. Deleting a row leaves rows
  that reference it (delete them first); `read through` children refuse with E_PARENT_HAS_CHILDREN.
- Table clauses: `unique a, b else CODE`, `cap N by col`, `immutable col`, `expire at .col`, `search col`,
  `public 'why'`, `online only`, `sync to .col last N by .at` (`guide sync`, `guide bounds`).
- Reserved as column names: `after by cap delete deliver ephemeral expire immutable insert online public read
  retain search sync unique update` (and `id`). As parameter, local and loop names: `and as break continue
  created delete device elif else emit exists false for if insert merge not null oblivious or require return
  true update upsert viewer walk while`. A shape or object field cannot be named `pending` (row metadata).
- Background work: `job`, `schedule x every 1d at 03:00: x`, `effect` (`guide jobs`, `guide effects`).

## Roles and rosters

A role is a roster row, and a rule or `exists` probe names one row, so the roster needs a unique key:
`exists teams[coach = viewer, division = .division]` over a table without one refuses `E_QUARRY_POINT_KEY`.

```quarry
table coaches:                            -- the roster: unique, so a probe is one row
  principal: principal
  division: text 1..40
  unique principal, division
  read <- .principal = viewer
  online only
table teams:
  name: text 1..80
  division: text 1..40
  read <- exists coaches[viewer, .division]                           -- positional: the key's columns in order
  update <- exists coaches[principal = viewer, division = .division]  -- or named
  online only
query divisionTeams(division: text 1..40, c: cursor ?):
  require exists coaches[viewer, division] else NOT_COACH
  return teams where .division = division first 50 by .id after c
```

- Positional values bind in order: one value of the table's own id (or a reference to it) is that row;
  otherwise the declared unique key whose column types accept them, in key order (`coaches[viewer, .division]`
  is principal, then division). Named tests may follow a full positional key (`docs[.docId, ownerId = viewer]`);
  when types fit two keys, name the columns (`profiles[principal = viewer]`).
- A rule's probe sees every roster row; a program's `exists` or `t[k]` sees only rows the caller may read.
  `require exists coaches[principal = other, division = division]` is false for another coach's row while the roster reads
  `.principal = viewer`: widen the roster's read rule (`or exists coaches[viewer, .division]`), or test it in a rule.
- Refusals fire in program order after the arguments decode: a `t[x] !` lookup of a row the caller cannot read
  answers `NOT_FOUND` before any later `require` (`guide refusals`).

## The loop

```sh
npx snapback4 init --web            # or --expo; init prints every file it wrote
npx snapback4 check                 # compile; writes snapback/generated/api.ts; notes carry rewrites
npx snapback4 dev                   # serves http://127.0.0.1:4400 and re-adopts on save
npx snapback4 run addList '{"title":"Groceries"}' --as alice
npx snapback4 why E_RULE            # any code, operation, table or id
npx snapback4 data lists            # stored rows, as an administrator
npx snapback4 clock advance 1h      # move a running dev's clock (guide time)
```

## Client

```ts
import { createApp } from "snapback4/app";               // createApp({ url, device: webDevice() })
import { webDevice } from "snapback4/web";               // Expo: nativeDevice from snapback4-expo
import { AppProvider, useAuth, usePage, useQuery, useMutation, matchRead, isFailed } from "snapback4/react";
import { api } from "../snapback/generated/api.ts";

const lists = usePage(api.myLists, {});                  // lists.items, lists.hasMore, lists.loadMore()
const open = useQuery(api.openCount, { list });           // a Read: render it with matchRead
matchRead(open, { present: n => n, partial: n => n, denied: why => why.message, otherwise: () => "…" });
const add = useMutation(api.addList);                     // add.run({ title }); add.last?.state
[add.last].find(isFailed)?.why.message;                   // the refusal of the last run, if any
```

Headless or tests: `createClient({ url, persona: "alice" })` from `snapback4/client`, then `await client.query(api.myLists, {})`
and `await client.mutate(api.addList, { title })`. Every export by subpath: `guide api`.

## Tests

- `npx snapback4 test --fixture fixtures --as alice`: `fixtures/<table>.jsonl` rows, then `fixtures/test.cases.jsonl`:
  `{"as":"bob","op":"addItem","args":{"list":"l1","text":"x"},"expect":"denied"}` (`guide testing`).
- Over HTTP: `dev --port 0 --memory` (stdout's first line is the URL); `POST /seed`, `/q/<query>`, `/m/<mutation>` with `x-snapback-persona: alice` (`guide testing --section acceptance`).
