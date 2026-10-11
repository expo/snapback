# Testing: fixtures, cases and an acceptance script

Test the backend in layers, cheapest first: a fixture run with your own
expected cases needs no server, and an acceptance script drives the dev server
over HTTP as each persona.

```quarry
use personas alice, bob

table boards:
  owner: principal
  title: text 1..80
  immutable owner
  read <- .owner = viewer
  insert <- .owner = viewer
  cap 50 by owner
  sync to .owner

table cards:
  board: boards
  text: text 1..200
  immutable board
  read through .board
  insert <- .board.owner = viewer
  cap 200 by board

query myBoards():
  boards where .owner = viewer

query cardsOn(board: boards):
  cards where .board = board

mutation addCard(board: boards, text: text 1..200):
  return insert cards { board, text }
```

## Fixture rows

A fixture is a directory with one `<table>.jsonl` per table: one JSON object
per line, the table's fields by name plus an `id`.

```jsonl
{"id":"board-alice","owner":"dev:alice","title":"Groceries"}
{"id":"board-bob","owner":"dev:bob","title":"Garage"}
```

- `id`: any string unique in its table (`idFrom("seed:alice")` in JS gives a stable one).
- A principal is stored, not named: persona `alice` is `"dev:alice"`. A bare `"alice"` is refused.
- A reference is the target row's `id`; `time` is Unix milliseconds; `money`/`decimal` are integers
  in minor units; `bytes` is lowercase hex; lists are arrays; an optional field may be omitted or `null`.
- Every file loads as one batch with parents before children, so file names and order do not matter.
  `NOT_FOUND` while loading means a referenced or read-through parent is in no file.
- Rows load as inserts do, as the system (rules skipped; types, constraints and caps checked): an omitted
  column takes its `default` (`default now` is the load time), and a `sequence` column is assigned in file
  order — omit it, since supplying one refuses `E_SEQUENCE_SUPPLIED`. The `$`-prefixed fields that
  `snapback4 data` prints are recorded by the engine: drop them when turning a dump into a fixture.
- A fixture that does not load (a bad row, a bare principal, a `.jsonl` file whose name is no table) fails the
  run with exit 1 and runs nothing.

## `snapback4 test --fixture fixtures --as alice`

Runs every query as the persona with arguments derived from the data: a
reference is that table's first row by `id` order, a principal is the persona,
text is the shortest valid value. Columns are the meter: `examined` rows the
read looked at (not rows returned), `entries` index entries walked, `probes`
rule lookups, `steps`, `heap B`, `output B`; the `ceilings` row is the limit
for each. `complete` is the whole answer; `capped` is a partial one
(`complete: false`: a ceiling, or a page that cannot prove completeness on the
server), not a refusal. A derived argument the rules refuse is reported, not
failed. The last line counts complete, capped, refused, not-run and denied
queries and the cases below; the exit code is 1 when a query is denied, a case
fails or the fixture does not load. `snapback4 test --help` prints this legend.

## `test.cases.jsonl`: your operations, in order, with expectations

Put it in the fixture directory. Each line runs one query or mutation as a
persona against the loaded fixture; mutations change what later lines see.

```jsonl
{"as":"alice","op":"addCard","args":{"board":"board-alice","text":"eggs"},"save":"eggs"}
{"as":"alice","op":"cardsOn","args":{"board":"board-alice"},"count":2}
{"as":"bob","op":"addCard","args":{"board":"board-alice","text":"spam"},"expect":"denied","label":"bob cannot write alice's board"}
{"as":"bob","op":"cardsOn","args":{"board":"board-alice"},"count":0}
```

- `expect`: `sent` (mutations) or `complete` (queries) by default; `capped`; a code (`E_RULE`,
  `NOT_FOUND`, your own `require ... else CODE`); or `denied` for any refusal.
- `data` must equal the answer; `count` is the answer's length.
- `save` names the answer; a later string argument `"$eggs"` is that row's `id`, `"$eggs.text"` a field.
- `label` is printed beside the result. Lines starting with `//` are skipped.

## An acceptance script over HTTP

Spawn the package's `node_modules/.bin/snapback4` rather than `npx` (npm and a
shell sit in between); it forwards signals to the server and stops it if your
script dies. `--port 0` takes a free port and `--memory` keeps no store, so
parallel runs never contend; a fixed port that is taken refuses at once
(`E_ADDRINUSE`, naming the holder) instead of leaving you talking to an older
server. Readiness is the first stdout line: the URL. `GET /dev/status` names
the server's `pid`; `snapback4 dev --help` has the lifecycle.
`resolveBinary()` from `snapback4/bin-path` returns the platform binary itself, with no Node wrapper.

```js
// node scripts/acceptance.mjs
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
const dev = spawn("node_modules/.bin/snapback4", ["dev", "--port", "0", "--memory"], { stdio: ["ignore", "pipe", "inherit"] });
try {
  const url = await new Promise((resolve, reject) => {
    dev.stdout.once("data", chunk => resolve(String(chunk).split("\n")[0].trim()));
    dev.once("exit", code => reject(new Error(`dev exited ${code}`)));
  });
  const post = async (path, body, persona) => (await fetch(url + path, { method: "POST", body: JSON.stringify(body),
    headers: { "content-type": "application/json", ...(persona && { "x-snapback-persona": persona }) } })).json();
  assert.equal((await post("/seed", [{ table: "boards", row: { id: "b1", owner: "dev:alice", title: "Groceries" } }])).seeded, 1);
  assert.equal((await post("/m/addCard", { args: { board: "b1", text: "milk" } }, "alice")).state, "sent");
  const refused = await post("/m/addCard", { args: { board: "b1", text: "spam" } }, "bob");
  assert.equal(refused.state, "failed"); // refused.why.code is "E_RULE"
  assert.equal((await post("/q/cardsOn", { args: { board: "b1" } }, "alice")).data.length, 1);
} finally { dev.kill("SIGTERM"); }
```

Queries answer `{data, complete, ..}` or `{denied}`; mutations `{state: "sent", result}` or
`{state: "failed", why}`; both are HTTP 200 (`guide wire`), while a request that does not decode
(a wrong JSON type, an unknown argument) is 400. `/seed` takes a JSON array, writes as the system and
skips rules, with fixture-row semantics (defaults, sequences); seed parents and children in one call.
It is an upsert by `id`: a reseed updates mutable columns, and changing an `immutable` one refuses
`E_CONSTRAINT` (use a new id, or restart with `--memory`). Personas and `/seed` exist only under `dev`,
and a persona must be declared in `use personas` (an outsider is 401 `E_AUTH`).
