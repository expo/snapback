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
- Rows load exactly as `POST /seed` writes them: as inserts, as the system (rules skipped). An omitted
  column takes its `default` (`default now` is the load time); a `sequence` column is assigned in file
  order — omit it, since supplying one refuses `E_SEQUENCE_SUPPLIED`; a duplicate `unique` refuses with
  your own code (`unique slot else SEAT_TAKEN` refuses `SEAT_TAKEN`), a full `cap` with `E_CONSTRAINT`;
  and every `view`,
  `maintain` and maintained column counts the loaded rows, then follows the cases' writes. An
  engine-maintained column is refused (`E_MAINTAINED_COLUMN`): load the source rows instead. The
  `$`-prefixed fields that `snapback4 data` prints are recorded by the engine: drop them when turning a
  dump into a fixture.
- `time` values are absolute: the cases and the dev server run at the wall clock, so put fixture times
  in the past (a row with `expires` or a window already behind `now` reads as gone) and live writes
  get `now`, which sorts after every fixture time.
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
server), not a refusal. A query's own `require` refusing the persona is
reported, not failed, whether its arguments were derived or it takes none: the
persona chose nothing, so it is the program's gate (pin it with an `expect` case). The last line counts complete, capped, refused, not-run and denied
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
{"as":"alice","op":"myBoards","expect":"complete","count":1}
```

- `expect`: a mutation's default is `sent`. A query's default is its `check` verdict: `complete`, or
  either `complete` or `capped` when `check` notes the query is never complete (`N_NEVER_COMPLETE`:
  a capped page still holds every row the viewer may read); `test` prints that verdict once. Write
  `"expect":"complete"` to insist, `"expect":"capped"` for a page you expect cut, `"ok"` for any
  answer, a code (`E_RULE`, `NOT_FOUND`, your own `require ... else CODE`), or `denied` for any refusal.
- `as` is a declared persona (default `alice`, or the first in `use personas` when alice is not
  declared). An undeclared one refuses `E_AUTH`, as dev's 401 does: an outsider is a declared persona
  who owns no rows. `test --as eve` refuses to start the same way; a local `run --as eve` warns that it
  acts as the principal id `eve`, not the persona `dev:eve`.
- `data` must equal the answer; `count` is the answer's length.
- `save` names the answer; a later string argument `"$eggs"` is that row's `id`, `"$eggs.text"` a field.
- `label` is printed beside the result. Lines starting with `//` are skipped.
- Those eight keys (`as`, `op`, `args`, `expect`, `data`, `count`, `save`, `label`) are the whole
  vocabulary: `test` checks every line before running any, and an unknown key (`"rows":0`) or an
  object `expect` refuses the run, naming the line and the key, instead of passing unchecked.

A failing refusal prints the layer that refused under the FAIL line, as `snapback4 run` does: the
rule clause and its line, the `unique` or `cap` clause a hidden row filled, or the program's own
`require`/`!` line. That evidence is for you; the refusal a client sees never names the clause.

### Hidden rows refuse before your own code

A lookup is a read. `p = pets[pet] ! else NOT_FOUND` sees only rows the viewer's read rule admits,
so for another owner's row the lookup refuses `NOT_FOUND`, and a later
`require p.owner = viewer else NOT_YOURS` never runs. Likewise a `unique` key held by a row the
viewer cannot read refuses `E_RULE`, not your `else CODE`, since your code would disclose that row. A
full `cap` counts every row, readable or not, and refuses `E_CONSTRAINT` naming only the cap (on a
table with a `sequence`, a hidden occupant refuses `E_RULE` first). Write the case for what the viewer
actually gets:

```jsonl
{"as":"bob","op":"withdraw","args":{"pet":"pet-alice"},"expect":"NOT_FOUND","label":"alice's pet is invisible to bob"}
{"as":"carol","op":"withdraw","args":{"pet":"pet-alice"},"expect":"NOT_YOURS","label":"a sitter reads it, so her require runs"}
```

`NOT_YOURS` can fire only for a viewer who can read the row: admit the sitter in the read rule (as
`guide refusals` does for a moderator), or write by id with no lookup first
(`update pets[pet] { .. }` alone), so the table's own update or delete rule decides. When a `NOT_FOUND`
case fails, `test` (and dev's refusal log) say whether the lookup's row was hidden by its read rule.

## An acceptance script over HTTP

Spawn the binary itself: `resolveBinary()` from `snapback4/bin-path` (file `dist/bin-path.js`) returns
the platform binary, so the child's PID is the server's. The `node_modules/.bin/snapback4` wrapper also
works: it forwards `SIGTERM`/`SIGINT`, and the server stops when the wrapper dies, even by `SIGKILL`.
Never spawn `npx` (npm and a shell sit in between). `--port 0` takes a free port and `--memory` keeps no
store, so parallel runs never contend; a fixed port that is taken refuses at once (`E_ADDRINUSE`, naming
the holder). On a host that assigns you a port range, pass it: `--port 20100-20109` binds the first free
port in it (`E_ADDRINUSE` only when all are taken), so no port-scanning loop is needed. Readiness: stdout's first line is the URL; host diagnostics go to stderr, so read stdout
alone, or, reading both streams together, match the stderr line `SNAPBACK4_READY … url=… pid=…`.
`GET /dev/status` names the server's `pid` (and `wrapperPid` through the wrapper). `snapback4 dev --help`
has the lifecycle.

Each scenario starts from state you know. Earlier steps change what later ones read (bob's list grows
when alice invites him), so assert every persona's baseline before the first write, and give each
scenario its own rows: distinct ids and owners per scenario, or a fresh `dev --memory` per scenario
(each start is an empty store). `/seed` is an upsert, so reseeding does not remove rows a scenario added.

```js
// node scripts/acceptance.mjs
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline";
import assert from "node:assert/strict";
import { resolveBinary } from "snapback4/bin-path";

// Stop a child for certain: SIGTERM, up to graceMs to exit, then SIGKILL. Safe after it exited.
async function stopChild(child, graceMs = 5000) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "exit");
  child.kill("SIGTERM");
  const timer = setTimeout(() => child.kill("SIGKILL"), graceMs);
  await exited;
  clearTimeout(timer);
}

const dev = spawn(resolveBinary(), ["dev", "--port", "0", "--memory"], { stdio: ["ignore", "pipe", "inherit"] });
try {
  const died = once(dev, "exit").then(([code]) => { throw new Error(`dev exited ${code} before its URL`); });
  died.catch(() => {}); // only the race below reports it
  const [line] = await Promise.race([once(createInterface({ input: dev.stdout }), "line"), died]);
  const url = line.trim();
  const post = async (path, body, persona) => (await fetch(url + path, { method: "POST", body: JSON.stringify(body),
    headers: { "content-type": "application/json", ...(persona && { "x-snapback-persona": persona }) } })).json();
  assert.equal((await post("/seed", [{ table: "boards", row: { id: "b1", owner: "dev:alice", title: "Groceries" } }])).seeded, 1);
  assert.equal((await post("/q/cardsOn", { args: { board: "b1" } }, "alice")).data.length, 0); // baseline first
  assert.equal((await post("/m/addCard", { args: { board: "b1", text: "milk" } }, "alice")).state, "sent");
  const refused = await post("/m/addCard", { args: { board: "b1", text: "spam" } }, "bob");
  assert.equal(refused.state, "failed"); // refused.why.code is "E_RULE"
  assert.equal((await post("/q/cardsOn", { args: { board: "b1" } }, "alice")).data.length, 1);
} finally { await stopChild(dev); }
```

The same `stopChild` stops a frontend server: spawn `node_modules/.bin/vite` (not `npx vite`) and
strip ANSI colors before matching its `Local:` line.

Every route answers JSON; read the field for the route (`guide wire` has the rest):

| Request | HTTP | Body | Read |
|---|---|---|---|
| `POST /q/<query>` answered | 200 | `{data, complete, cut, next, seq, tables, viewer}` | `body.data`: a list, a row, a shape, or a scalar (a keyed view read such as `totals[owner]` is just the number) |
| `POST /q/<query>` refused | 200 | `{denied: {code, message, site?, rule?}}` | `body.denied.code` |
| `POST /m/<mutation>` sent | 200 | `{state: "sent", id, seq, result}` | `body.result`: what the mutation returns (an inserted row, so its id is `body.result.id`); top-level `id` is the write id you sent, `null` without one |
| `POST /m/<mutation>` refused | 200 | `{state: "failed", id, why: {code, message, site?, rule?}, current?}` | `body.why.code`: `E_RULE`, `NOT_FOUND`, `E_CONSTRAINT`, your `require`/`unique` code, `E_INPUT` for a value checked while running |
| a request that does not decode (bad JSON type, unknown argument) | 400 | `{denied: {code: "E_INPUT"}}` | `body.denied.code` |
| an undeclared persona, no credential | 401 | `{denied: {code: "E_AUTH"}}` | `body.denied.code` |
| `POST /seed` | 200 | `{seeded: N}`, or `{denied}` with nothing written | `body.seeded` |

A `unique ... else CODE` refuses with your code; without one, a clash is `E_CONSTRAINT` naming the index.
`/seed` takes a JSON array, writes as the system and
skips rules, with fixture-row semantics (defaults, sequences); seed parents and children in one call.
It is an upsert by `id`: a reseed updates mutable columns, and changing an `immutable` one refuses
`E_CONSTRAINT` (use a new id, or restart with `--memory`). Personas and `/seed` exist only under `dev`,
and a persona must be declared in `use personas` (an outsider is 401 `E_AUTH`).
