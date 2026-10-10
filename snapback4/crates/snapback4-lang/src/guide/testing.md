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

## `snapback4 test --fixture fixtures --as alice`

Runs every query as the persona with arguments derived from the data: a
reference is that table's first row by `id` order, a principal is the persona,
text is the shortest valid value. Columns are the meter: `examined` rows read,
`entries` index entries walked, `probes` rule lookups, `steps`, `heap B`,
`output B`; the `ceilings` row is the limit for each. A derived argument the
rules refuse is reported, not failed. The last line counts complete, capped,
refused, not-run and denied queries and the cases below; the exit code is 1
when a query is denied or a case fails.

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

Run the installed binary directly so the PID you hold is the server (through
`npx`, npm and a shell sit in between). `--memory` keeps no store, so
parallel runs never contend. Readiness is the first stdout line: the URL.

```js
// node scripts/acceptance.mjs
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
const dev = spawn("node_modules/.bin/snapback4", ["dev", "--port", "4410", "--memory"], { stdio: ["ignore", "pipe", "inherit"] });
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
`{state: "failed", why}`; both are HTTP 200 (`guide wire`). `/seed` writes as the system and skips
rules; seed parents and children in one call. Personas and `/seed` exist only under `dev`.
