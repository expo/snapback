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

Runs every query as the persona: on that persona's own case's arguments when
`test.cases.jsonl` has one for the query (`(from test.cases.jsonl:N)`), else on
arguments derived from the data: a reference is a row of its table, preferring
one whose answer is not empty for the persona, a principal is the persona, text
is the shortest valid value. A refusal the persona's case expects prints
`refused CODE as expected`. `--as` picks the sweep's personas; every case runs
as its own `as`. Columns are the meter: `examined` rows the
read looked at (not rows returned), `entries` index entries walked, `probes`
rule lookups, `steps`, `heap B`, `output B`; the `ceilings` row is the limit
for each. `complete` is the whole answer; `capped` is a partial one
(`complete: false`: a ceiling, or a page that cannot prove completeness on the
server), not a refusal. A query's own `require` refusing the persona is
reported, not failed, whether its arguments were derived or it takes none: the
persona chose nothing, so it is the program's gate (pin it with an `expect` case). The last line counts complete, capped, expected, refused, not-run and denied
queries and the cases below, and ends in `pass` or `FAIL`; the exit code is 1 when a query is denied, a case
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

### Refusal order

| Stage (in execution order) | Refusal |
|---|---|
| Argument names, wire types and declared bounds | `E_INPUT`; before program statements |
| Each `!` lookup as reached | Hidden/missing: `NOT_FOUND` (or written `else`); later lines do not run |
| Each `require` as reached | Its written code; lookups and requires run in source order |
| Write target and table write rule | Missing/hidden refused target: `NOT_FOUND`; readable refused target: `E_RULE` |
| Unique, then cap, then immutable | Written unique code or `E_CONSTRAINT`; hidden unique clash: `E_RULE`; cap: `E_CONSTRAINT` (hidden sequence occupant: `E_RULE`) |
| After the final statement | `after insert` obligation: `E_CONSTRAINT` |

N_FIXTURE_ARGUMENT_DRIFT means a fixture case no longer fits its operation signature. Update its arguments and run snapback4 test. Saved `$answers` are checked at run time.

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
`guide refusals` does for a moderator). A write by id with no lookup first (`update pets[pet] { .. }`
alone) lets the table's update or delete rule admit a viewer who cannot read the row; when that rule
refuses, a hidden row still answers `NOT_FOUND` and a readable one `E_RULE`. When a `NOT_FOUND`
case fails, `test` (and dev's refusal log) say whether the lookup's row was hidden by its read rule.

## An acceptance script over HTTP

Spawn the binary itself: `resolveBinary()` from `snapback4/bin-path` (file `dist/bin-path.js`) returns
the platform binary, so the child's PID is the server's (it runs the native verbs; `web-shell` is the
npm wrapper's, `node_modules/.bin/snapback4 web-shell dist`). The `node_modules/.bin/snapback4` wrapper also
works: it forwards `SIGTERM`/`SIGINT`, and the server stops when the wrapper dies, even by `SIGKILL`.
Never spawn `npx` (npm and a shell sit in between). `--port 0` takes a free port and `--memory` keeps no
store, so parallel runs never contend; a fixed port that is taken refuses at once (`E_ADDRINUSE`, naming
the holder). On a host that assigns you a port range, pass it: `--port 20100-20109` binds the first free
port in it (`E_ADDRINUSE` only when all are taken), so no port-scanning loop is needed. Readiness: stdout's first line is the URL and nothing else,
exactly `http://127.0.0.1:41234` (no trailing slash: request `url + "/q/cardsOn"`); host diagnostics go to stderr, so read stdout
alone, or, reading both streams together, match the stderr line `SNAPBACK4_READY verb=dev generation=1 url=http://127.0.0.1:41234 pid=4242`.
`GET /dev/status` names the server's `pid` (and `wrapperPid` through the wrapper). `snapback4 dev --help`
has the lifecycle.

Each scenario starts from state you know. Earlier steps change what later ones read (bob's list grows
when alice invites him), so assert every persona's baseline before the first write, and give each
scenario its own rows: `POST /dev/reset` before each one (below), distinct ids and owners per
scenario, or a fresh `dev --memory` per scenario (each start is an empty store). `/seed` is an upsert,
so reseeding alone does not remove rows a scenario added.

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
// `dev` on a free port with an empty store: its URL and stop(). Reuse it for every scenario and proof script.
async function startDev(args = ["--port", "0", "--memory"]) {
  const child = spawn(resolveBinary(), ["dev", ...args], { stdio: ["ignore", "pipe", "inherit"] });
  const died = once(child, "exit").then(([code]) => { throw new Error(`dev exited ${code} before its URL`); });
  died.catch(() => {}); // only the race below reports it
  try {
    const [line] = await Promise.race([once(createInterface({ input: child.stdout }), "line"), died]);
    return { url: line.trim(), stop: () => stopChild(child) };
  } catch (error) { await stopChild(child); throw error; }
}
// A refusal's code from either envelope (a query's {denied}, a mutation's {state: "failed", why}); undefined when answered.
const refusal = body => body.denied?.code ?? (body.state === "failed" ? body.why.code : undefined);

const dev = await startDev();
try {
  const post = async (path, body, persona) => (await fetch(dev.url + path, { method: "POST", body: JSON.stringify(body),
    headers: { "content-type": "application/json", ...(persona && { "x-snapback-persona": persona }) } })).json();
  assert.equal((await post("/seed", [{ table: "boards", row: { id: "b1", owner: "dev:alice", title: "Groceries" } }])).seeded, 1);
  assert.equal((await post("/q/cardsOn", { args: { board: "b1" } }, "alice")).data.length, 0); // baseline first
  assert.equal((await post("/m/addCard", { args: { board: "b1", text: "milk" } }, "alice")).state, "sent");
  assert.equal(refusal(await post("/m/addCard", { args: { board: "b1", text: "spam" } }, "bob")), "E_RULE");
  assert.equal(refusal(await post("/q/myBoard", { args: { board: "b1" } }, "bob")), "NOT_OWNER"); // a query's own require
  assert.equal((await post("/q/cardsOn", { args: { board: "b1" } }, "alice")).data.length, 1);
} finally { await dev.stop(); }
```

### Per-test isolation: `POST /dev/reset`

One dev serves the whole suite; `POST /dev/reset` before each test empties its store and seeds the
test's rows in the same transaction, in a few milliseconds:

```js
// Inside the script above, after `post` is defined:
const reset = async seed => {
  const answer = await post("/dev/reset", { seed });
  assert.equal(answer.reset, true, JSON.stringify(answer)); // a refused row answers {denied}; nothing was reset
  return answer;
};
for (const [name, scenario] of [["alice adds a card", async () => {
  assert.equal((await post("/m/addCard", { args: { board: "b1", text: "milk" } }, "alice")).state, "sent");
}]]) {
  await reset([{ table: "boards", row: { id: "b1", owner: "dev:alice", title: "Groceries" } }]);
  assert.equal((await post("/q/cardsOn", { args: { board: "b1" } }, "alice")).data.length, 0, name); // baseline
  await scenario();
}
```

- Fresh means: no application rows, views, maintained columns, sync log, queued effects, jobs or
  actions, uploaded assets, signed-up users or guests. The schema, personas and service seats stay,
  so persona headers work at once; a test that signs up does so again after the reset.
- The body is a `/seed` array, `{"seed": [..]}`, or empty. `{"clock": "reset"}` also returns the dev
  clock to wall time (drops `--clock-offset` and earlier `clock advance`s); by default it stays.
- `snapback4 reset --port N --seed fixtures` does the same from a shell, reading a fixture directory
  (`<table>.jsonl`; `test.cases.jsonl` is skipped) or a JSON file holding a `/seed` array.
- The store takes a new identity. A local client follows it and re-acquires; an online client halts
  with `E_STORE_REPLACED` (`createApp` reopens it). Open clients after the reset, or wait for that.
- A reset empties the whole store, so tests sharing one dev run one at a time; give each parallel
  worker its own `dev --port 0 --memory`.

The same `stopChild` stops a frontend server: spawn `node_modules/.bin/vite` (not `npx vite`) and
strip ANSI colors before matching its `Local:` line.

Every route answers JSON; `guide wire --section envelopes` has the wire/client envelope table.

A `unique ... else CODE` refuses with your code; without one, a clash is `E_CONSTRAINT` naming the index.
`/seed` takes a JSON array, writes as the system and
skips rules, with fixture-row semantics (defaults, sequences); seed parents and children in one call.
It is an upsert by `id`: a reseed updates mutable columns, and changing an `immutable` one refuses
`E_CONSTRAINT` (use a new id, `POST /dev/reset`, or restart with `--memory`). Personas, `/seed` and `/dev/reset` exist only under `dev`,
and a persona must be declared in `use personas` (an outsider is 401 `E_AUTH`).

## Browser proof: the exported app writes

Run `npm run build:web`, then `snapback4 witness web dist --as alice --mutation add --args '{"title":"Browser proof"}'`.
Password accounts: `--email proof@example.test --password-env PROOF_PASSWORD`
(sign up first on an existing backend); `--url URL` selects that backend. Without it the
witness owns a fresh `dev --memory` and uses the signup form for password accounts. Set `SNAPBACK4_CHROMIUM` if Chromium is
not found. Starters register their SDK client; custom apps call
`registerWebWitness(app, api)` from `snapback4/witness-web`, active only under
`?witness=web`. This proves exported app/authenticated SDK integration; test
its composer UI separately. Fresh browser/storage and a fresh default backend
make runs repeatable; `--url` repeats use a stable write id, never reset.

Never wait for `networkidle`: live pages hold a long poll. Navigate with
`domcontentloaded`, wait for the control, and assert `sent` before cross-device
reads. A predicted row or `pending` is not a server commit. Spawn servers
directly via `resolveBinary()` or `node_modules/.bin/vite`, never via `npx`;
stop only your children (recipe above). Rebuild the Expo web export when
`EXPO_PUBLIC_SNAPBACK_URL` changes: starter `build:web` uses
`expo export --platform web --clear`. Both starters accept runtime `?api=URL`.

## Authoring and proof refusals

N_FIXTURE_ARGUMENT_DRIFT means a fixture case no longer fits its operation signature. Update its arguments and run snapback4 test.

E_WITNESS_BROWSER means no usable headless Chromium executable. Set SNAPBACK4_CHROMIUM.

E_WITNESS_AUTH means the exported app did not sign in. Check the persona or credentials and register its client.

E_WITNESS_MUTATION means no matching mutation was registered. Pass --mutation with a generated API name.

E_WITNESS_ARGUMENT means an argument needs application values. Pass --args with valid values.

E_WITNESS_EXPORT means the export has no index.html. Run build:web first.

E_WITNESS_READY means the app could not open its write custody. Repair the reported schema or storage refusal.

E_WITNESS_SENT means the write failed, stayed pending or timed out. Inspect the refusal; pending is not success.

E_WITNESS_WEB means the browser proof could not complete. Check the export, browser and application.
