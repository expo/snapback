# Testing: fixtures and the packaged proof kit

Prove backend behavior with fixtures and the rendered UI with the packaged proof kit.
Raw HTTP starts with JSON envelopes: POST /q/name `{args:{...}}`, POST /m/name
`{id:"stable-intent-id",args:{...}}`, POST /a/name `{id:"stable-action-id",args:{...}}`.
Keep the same id on an ambiguous retry. A mutation/action id identifies the attempt;
`result.id` identifies a returned row. Query data is under `data`, writes under `result`;
actions have their own lifecycle (`guide actions`), not a mutation receipt.
Starters generate frontend:proof and day2:proof, and the kit owns server and browser lifecycles.

```js
import { startDev, cleanup } from "snapback4/proof";
const dev = await startDev();
try { console.log(dev.url); } finally { await cleanup(() => dev.stop()); }
```

Build with `npm run build` (web) or `npm run build:web` (Expo web) first.
After replacing the starter screen, replace its business assertions too.
`init --adapt` previews only and writes nothing; use the printed `--apply` command.
A custom Home has no write scenario: replace the Home assertions; a proof without a write fails.
`day2:proof` uses versions/v1.q and versions/v2.q (initial copies of your complete schema).

E_FIXTURE_ALIAS means a saved alias or path could not resolve. Use an earlier case's `save` name with `$name` or `$name.field`; escape a literal with `$$` or `$literal`. An unresolved assertion fails the case; it never compares the alias as literal data.

E_FIXTURE_TIME means a relative fixture time is malformed or out of range. Use `now` or `now±duration` with positive integral ms/s/m/h/d/w. Relative conversion applies only to typed time leaves; text/JSON strings stay literal.

## Fixtures and cases

`test` uses ./fixtures; `--fixture dir` overrides it. A fixture directory has
one `<table>.jsonl` per declared table, each line an object with `id` and fields:

```jsonl
{"id":"board-alice","owner":"dev:alice","title":"Groceries"}
```

Persona alice is `dev:alice`, never the literal `alice`. References use row ids;
time is Unix milliseconds or `"now"`, `"now-1h"`, `"now+2d"` in typed time fields
(including optional/list time leaves). Durations are positive whole ms/s/m/h/d/w.
Typed time arguments in cases accept the same forms.
One clock captured at test start anchors these values, seed defaults, cases and
the sweep, so timed fixtures do not rot; malformed/overflowing relative times
refuse E_FIXTURE_TIME. Text and JSON fields retain literal strings.
Money/decimal use integer minor units; bytes are hex;
optional fields may be absent/null. Parents and children load in one batch.
Defaults, unique keys, caps, maintained values and sequences obey normal insert
semantics: omit sequence and engine-maintained columns. A missing parent is
NOT_FOUND; a bad row or unknown table fails the run before any case executes.

Add `test.cases.jsonl` to that directory. Cases execute in order; writes change
what later cases see. The complete vocabulary is `as`, `op`, `args`, `expect`,
`data`, `match`, `count`, `save`, `label`; unknown keys fail before any case runs.

```jsonl
{"as":"alice","op":"addCard","args":{"board":"board-alice","text":"eggs"},"save":"eggs"}
{"as":"alice","op":"renameCard","args":{"card":"$eggs","text":"milk"}}
{"as":"bob","op":"cardsOn","args":{"board":"board-alice"},"count":0}
```

`save` names an answer: `$eggs` means its row id, `$eggs.text` its field.
A bare argument equal to a saved alias refuses with the `$name` rewrite.
Aliases resolve recursively inside args, data and match. Unknown aliases and
missing fields refuse E_FIXTURE_ALIAS by name. `$$text` means literal
`$text`; `{"$literal":"eggs"}` means literal `eggs`, even if saved as an alias.
`data` asserts the exact result; `match` asserts a recursive object subset
(`"match":{"name":"Ash"}` permits an extra id). Arrays retain their exact
length/order, with each element matched recursively; scalars compare exactly.
Both assertions may appear together. `count` asserts length. A mutation defaults to
`sent`; a query to its check verdict (`complete`, or complete/capped when
N_NEVER_COMPLETE). Set `expect` to `complete`, `capped`, `ok`, `denied`, or a
refusal code. `as` must be a declared persona; outsiders need their own persona.

After the cases, the sweep runs every query with that persona's case arguments when available,
otherwise derives arguments from the store after the cases' writes (text uses
the shortest valid value). Saved-alias arguments belong to the case run; the
sweep uses another literal-argument case or derives arguments for that query.
It prints examined rows, entries, probes, steps, heap/output bytes and ceilings.
`complete` is the whole answer; `capped` is a partial answer, not a refusal.
Expected refusals pass; denied queries, failed cases and invalid fixtures exit 1.
N_FIXTURE_ARGUMENT_DRIFT means a fixture case no longer fits its operation signature. Update its arguments and run snapback4 test.

A lookup reads through the caller's rule: hidden rows give NOT_FOUND before
later `require` guards; hidden unique conflicts give E_RULE instead of the
custom code. `test` and dev refusal logs explain the hidden lookup or rule.
`guide refusals` explains refusal ordering and hidden rows.

## An acceptance script over HTTP

The same kit supports HTTP and browser proofs. HTTP acknowledgement is not React settlement; mutation refusals are `{state:'failed', why}`.

```js
import assert from "node:assert/strict";
import { startDev, startStatic, withBrowser, fillRN, renderedText,
  waitForFresh, bounded, cleanup } from "snapback4/proof";

const dev = await startDev(); // memory store; actual runtime URL
let web;
try {
  web = await startStatic("dist");
  await withBrowser({ executablePath: process.env.CHROME }, async context => {
    const page = await context.newPage();
    await page.goto(`${web.url}/?api=${encodeURIComponent(dev.url)}&witness=web`, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Continue as a guest", exact: true }).click();
    const title = `Proof ${crypto.randomUUID()}`;
    await fillRN(page.getByLabel("Task", { exact: true }), title);
    const button = page.getByRole("button", { name: "Add", exact: true });
    await button.evaluate((element, title) => window.__snapback4Witness.beginForm("add", {title}, element), title);
    await button.click();
    const receipt = await bounded(page.evaluate(() => window.__snapback4Witness.formResult()), 30000, "write receipt");
    assert.equal(receipt.state, "sent", JSON.stringify(receipt));
    await waitForFresh(renderedText(page, title, {within: page.getByRole("list")}), null);
  });
} finally { await cleanup(() => web?.stop(), () => dev.stop()); }
```

The kit spawns binaries directly, binds the first free port in PORT_LO..PORT_HI
at run time (or an OS-assigned port with neither set), strips ANSI ready lines,
asserts served identity and owns bounded cleanup. Each child logs separate
stdout/stderr files in `<cwd>/logs` by default. These survive the harness's
TMPDIR cleanup (H6); set `logsDir` outside a source-discovery directory if your
tool treats every file under cwd as source (for example, an Exact app/ root).
Set `logsDir` explicitly to retain a chosen artifact directory. `startServe(deployDir)` serves a deployment;
`startVite(dir)` serves the app's Vite config; `startStatic(dir)` serves built
output, including wasm. Spawn servers with the kit or the binary, never `npx`:
killing the npx wrapper leaves the server holding your pipe.
`startDev({args})` still adds --memory unless --store or --no-memory is explicit.
`startDev(args)` and `stopChild(ChildProcess | {url, stop})` remain supported.
`cli(args)` dispatches every published verb through the installed JS wrapper, including web-shell,
awaits close and returns `{code, stdout, stderr, logs}`; assert code
when expecting success. `cli(["token", ...])` never persists stdout: its bearer is
returned in memory only. Use `{secret:true}` with cli/command for other secret
stdout; stderr remains a log, so the invoked tool must keep secrets off stderr.
`withBrowser` automatically adds `witness=web` to top-level HTTP(S) navigations
before the app registers; raw Playwright callers add the flag themselves.
`withBrowser({ chromium })` uses the caller’s Playwright (including @playwright/test);
playwright-core is an optional peer required when using browsers. Chromium launches over
a pipe, with no WebSocket listener. Set CHROME to an installed Chromium; root or a recognized
unavailable sandbox selects --no-sandbox. Ordinary hosts first use the sandbox.

`fillRN` clears then uses pressSequentially so RN-web gets real keystrokes.
`statusText(page, text)` uses getByText with exact matching: a role=status element
has no content-derived accessible name, so never getByRole('status', {name}).
`selectByValue(locator, value)` uses a stable option value, not a label regex.
Never wait for networkidle: live queries hold long polls. Wait for the control.

`renderedText(page, text, { exact: true, within: container })` excludes inputs and
textareas. Strings match the entire rendered text by default. Use
`renderedText(page, "verification", {exact:false})` or
`renderedText(page, /verification/)` for a row that contains more text.
`within` is optional. RN-web may split one logical row across nested nodes,
producing multiple matches: scope to its container, then use `.first()` only
when those nodes prove the same row. A strictness error means scope is ambiguous.
Decorative glyphs contribute to accessible names: use aria-hidden for icons or
an explicit aria-label. A wrapped select label can absorb option text; prefer
an explicit label/for pair and selectByValue. Run frontPage before screenshots.
`waitForFresh(locator, previous, { within: container, timeoutMs: 30000 })` scopes
a fresh signal; both options are optional. Timeout names the locator, last count
and text, and absent versus present-but-unchanged. Old text and editable values
prove nothing. After a terminal receipt, poll the authoritative projection:
`await waitForServer(() => client.query(api.list, {}), read => "data" in read && read.fresh && read.data.some(row => row.id === createdId), {label:"committed row"})`.
Import waitForServer from snapback4/proof. Each poll and the whole wait are bounded;
its deadline reports the last answer. A poll timeout never means the write failed.
`await frontPage(page)` brings the page forward before `await page.screenshot(...)`.

E_WITNESS_DISABLED means claiming is not armed. Add &witness=web to the proof URL.

E_WITNESS_UNCLAIMED means the armed durable write's event, operation or arguments did not match. Inspect the reason in formResult; the application write still runs normally.

## Web witness (15-line contract)

registerWebWitness(app, api) always installs window.__snapback4Witness in a browser.
Load ?witness=web (or &witness=web) before registration; arming survives SPA routes.
Without it, beginForm/mutate throws E_WITNESS_DISABLED: add &witness=web.
After signing in, get the actual submit button Element from the page.
beginForm(name, expected | null, button) arms one durable mutation.
name is the generated operation name; undefined accepts any durable operation.
expected matches canonical JSON exactly: object key order is ignored.
Include every argument, including explicit nulls; null skips argument matching.
Click the armed button with Playwright; script clicks do not qualify.
A synchronous form onSubmit caused by that button also qualifies.
Timers or later requestSubmit calls do not inherit a prior click.
formResult() returns a Promise of { state, id, seq?, result?, why?, mutation }.
Require state === "sent" before asserting the rendered business result.
An unclaimable durable write settles failed/E_WITNESS_UNCLAIMED with event/operation/arguments detail.
Keep the promise outside components that may unmount. Four terminal outcomes:
- sent: claimed write committed (a replay may omit its historical result);
- failed with the app refusal: claimed write was refused;
- failed/E_WITNESS_UNCLAIMED: event, operation or arguments did not match;
- failed/E_WITNESS_NO_WRITE: armed click produced no durable mutation (handler returned early, or app was not ready).
No write fails 1 second after the trusted click, on re-arm, or after a 30-second
abandoned arm. A claimed write still pending at 30 seconds fails the proof with
E_WITNESS_SENT; inspect its original intent id, never infer a server refusal.
Re-arm settles the old promise and releases observation; it never cancels a write.
Gate the form with useAppReady() before typing/clicking; auth alone can precede
the initial app.ready barrier. pending is custody, not a terminal result.

Eight rules keep proofs honest:

- Log to files, never pipes. A descendant holding a pipe can hide completion.
- Wait for a fresh signal for each write: its terminal receipt, changed write id,
  or unique new value. `waitForFresh(locator, previous)` rejects unchanged text.
- Receipts live outside components that unmount. The generated proof arms the
  app's registered SDK witness before clicking, then asserts that write's sent.
- An HTTP acknowledgement is not React settlement. Assert sent, then wait for
  the rendered authoritative projection; a predicted row/pending is not commit.

- Scope row assertions to the list or detail container they prove.
- Keep status text disjoint from row text; echoing a draft is not a committed row.
- An input’s value is never evidence of a write; assert rendered output.
- Seed persona rosters before browser proofs with POST /dev/reset {seed}.

Raw HTTP: POST `/q/name` with `{args}` returns `{data, complete, cut, next}`
or `{denied}`. POST `/m/name` returns `{state:'sent', result}` or
`{state:'failed', why}` (early auth/input may return `{denied}`). `result.id`
is the returned row's id; a supplied request id is the write id, not result.id.
Replays carry `replayed:true` and no historical result. Dev adds its read meter;
production omits it. `guide wire --section envelopes` has full examples.

Each dev memory start is empty. Between scenarios on one dev, POST `/dev/reset`
with `{seed:[{table,row}]}` atomically clears rows, logs, queues, assets, accounts
and sessions, retains schema/personas/seats, and returns `{reset:true}` with a
new store identity. Reopen clients after reset. Seed persona rosters before
calling operations that use them: a fresh dev has no admins or memberships.
`/seed` takes a **bare array**, beside reset's wrapper:

```json
[{"table":"boards","row":{"id":"board-alice","owner":"dev:alice","title":"Groceries"}}]
```

POST it to `/seed` to upsert without resetting;
changing an immutable field refuses E_CONSTRAINT. Both doors are dev-only.
Advance time without sleeping with `snapback4 clock advance +2h` (add `--port N`
for another dev), or POST `/dev/clock/advance` with `{"duration":"+2h"}`.
Clock controls are dev-only; `guide clock` covers status, reset and restart.

## Day-two proofs with immutable sources

Keep saved variants outside snapback/, where every .q file compiles together.
`npm run day2:proof -- versions/v1.q versions/v2.q` runs the generated release
proof; add your business assertions at each transition.
`deploy(dir, savedSchema)` requires an explicit source; `rollback(dir, target)`
requires an immutable release number or `latest`. Neither swaps working files.
`testSource(file, {args:['--fixture','fixtures']})` runs the saved source in memory.
The CLI equivalents are `deploy dir --schema file.q` and `test --source file.q`.
Selected-source companions build/check their generated signatures privately;
native dependency paths are rebased into that private build while its own
source and generated types stay isolated. `guide deploy` covers deploy/rollback narration and business compatibility.

The existing `snapback4 witness web dist` also proves the exported app's SDK
write; `--field Task --value 'Browser proof' --button Add` drives its visible
starter form. E_WITNESS_BROWSER means the optional playwright-core peer is missing or no usable headless Chromium executable was found. Install it with `npm install --save-dev playwright-core` and `npx playwright-core install chromium`. Set SNAPBACK4_CHROMIUM for an installed browser.

E_WITNESS_AUTH means the exported app did not sign in. Check the persona or credentials and register its client.

E_WITNESS_MUTATION means no matching mutation was registered. Pass --mutation with a generated API name.

E_WITNESS_ARGUMENT means an argument needs application values. Pass --args with valid values.

E_WITNESS_EXPORT means the export has no index.html. Run build:web first.

E_WITNESS_READY means the app could not open its write custody. Repair the reported schema or storage refusal.

E_WITNESS_SENT means the write failed, stayed pending or timed out. Inspect the refusal; pending is not success.

E_WITNESS_WEB means the browser proof could not complete. Check the export, browser and application.

`guide witness` has native and lifecycle proofs.

Full bodies for the preceding fixture (omitted request ids stay omitted):

```json
{
  "/m/add": {"state":"sent","result":{"id":"row1","title":"Proof"},"seq":1,"generation":1,"head":1,"store_id":"store1","preserved":["notes"]},
  "/m/nothing": {"state":"sent","result":null,"seq":2,"generation":1,"head":2,"store_id":"store1","preserved":["notes"]},
  "/m/refuse": {"state":"failed","why":{"code":"PROOF_REFUSED","family":"rule","message":"the program refused with PROOF_REFUSED","rule":"PROOF_REFUSED","guide":"programs","site":"schema.q:13:3"},"generation":1,"head":2,"store_id":"store1","preserved":[]},
  "/q/list": {"data":[{"id":"row1","title":"Proof"}],"complete":true,"cut":null,"next":null,"nextExpiry":null,"seq":2,"generation":1,"store_id":"store1","tables":["notes"],"viewer":"dev:alice","scopes":{},"meter":{"cut":null,"examined":1,"heapBytes":937,"indexEntries":0,"outputBytes":89,"probes":0,"rowsWritten":0,"steps":12}}
}
```

A full `cap` counts every row, readable or not, and refuses `E_CONSTRAINT`.

## Hidden-only pages

A uniformly denied page over only hidden rows is `complete` and empty, never `denied`; nonuniform scans can remain partial (`guide indexes`). Assert empty data and completeness for that denied scope, and use a readable role query for access UI (`guide refusals`, `guide rule-recipes`). KIT owns the rest of this page.

## Raw HTTP proof across releases
Every call carries `Authorization: Bearer TOKEN` on serve (a declared persona on dev). Send `Content-Type: application/json` and `{args: {...}}`; query data and mutation results use different envelopes. Reuse a stable mutation id for a retry, never a new id after an ambiguous reply.

| Door | HTTP status | Body to assert |
|---|---|---|
| `POST /q/<query>` | 200 | `{data, complete, next, cut, ...}` or `{denied:{code,...}}`; loading is not empty |
| `POST /m/<mutation>` | 200 | `{state:"sent", result, ...}` or `{state:"failed", why:{code,...}}` |
| Unknown operation on either door | 404 | `{denied:{code:"E_OP"}, generation}`; it is absent from the selected release |
| Missing/expired bearer | 401 | `{denied:{code:"E_AUTH"}}` |
| Wrong operation door | 400 | `{denied:{code:"E_OP"}}`; use /q for queries, /m for mutations |
| Invalid JSON | 400 | `{denied:{code:"E_INPUT"}}`; typed argument refusals differ below |
| Invalid typed arguments | /q: 400; /m: 200 | /q `{denied:{code:"E_INPUT"}}`; /m `{state:"failed",why:{code:"E_INPUT"}}` |
| SDK mutation at custody (`waitSeconds: 0`) | SDK, not raw HTTP | `{state:"pending", id}` is custody, never success |

Read response bodies even on HTTP errors. Raw queries have no SDK `existence`; mutation failures use `why`, not top-level denied. `guide wire` covers the full protocol.
