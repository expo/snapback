# Testing: fixtures and the packaged proof kit

Prove backend behavior with fixtures and the rendered UI with the packaged proof kit.
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

## Fixtures and cases

`test` uses ./fixtures; `--fixture dir` overrides it. A fixture directory has
one `<table>.jsonl` per declared table, each line an object with `id` and fields:

```jsonl
{"id":"board-alice","owner":"dev:alice","title":"Groceries"}
```

Persona alice is `dev:alice`, never the literal `alice`. References use row ids;
time is Unix milliseconds; money/decimal use integer minor units; bytes are hex;
optional fields may be absent/null. Parents and children load in one batch.
Defaults, unique keys, caps, maintained values and sequences obey normal insert
semantics: omit sequence and engine-maintained columns. A missing parent is
NOT_FOUND; a bad row or unknown table fails the run before any case executes.

Add `test.cases.jsonl` to that directory. Cases execute in order; writes change
what later cases see. The complete vocabulary is `as`, `op`, `args`, `expect`,
`data`, `count`, `save`, `label`; unknown keys fail before any case runs.

```jsonl
{"as":"alice","op":"addCard","args":{"board":"board-alice","text":"eggs"},"save":"eggs"}
{"as":"alice","op":"renameCard","args":{"card":"$eggs","text":"milk"}}
{"as":"bob","op":"cardsOn","args":{"board":"board-alice"},"count":0}
```

`save` names an answer: `$eggs` means its row id, `$eggs.text` its field.
A bare argument equal to a saved alias refuses with the `$name` rewrite.
Unknown aliases and missing fields refuse by name. `$$text` means literal
`$text`; `{"$literal":"eggs"}` means literal `eggs`, even if saved as an alias.
`data` asserts the exact result; `count` its length. A mutation defaults to
`sent`; a query to its check verdict (`complete`, or complete/capped when
N_NEVER_COMPLETE). Set `expect` to `complete`, `capped`, `ok`, `denied`, or a
refusal code. `as` must be a declared persona; outsiders need their own persona.

The sweep runs each query with that persona's case arguments when available,
otherwise derives arguments from data (text uses the shortest valid value).
It prints examined rows, entries, probes, steps, heap/output bytes and ceilings.
`complete` is the whole answer; `capped` is a partial answer, not a refusal.
Expected refusals pass; denied queries, failed cases and invalid fixtures exit 1.
N_FIXTURE_ARGUMENT_DRIFT means a fixture case no longer fits its operation signature. Update its arguments and run snapback4 test.

A lookup reads through the caller's rule: hidden rows give NOT_FOUND before
later `require` guards; hidden unique conflicts give E_RULE instead of the
custom code. `test` and dev refusal logs explain the hidden lookup or rule.
`guide refusals` explains refusal ordering and hidden rows.

## An acceptance script over HTTP

The same kit supports HTTP and browser proofs.

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
stdout/stderr files outside application sources by default (`logsDir()` uses the OS temporary directory).
Set `logsDir` explicitly to retain a chosen artifact directory. `startServe(deployDir)` serves a deployment;
`startVite(dir)` serves the app's Vite config; `startStatic(dir)` serves built
output, including wasm. Never spawn npx or shell wrappers for proof hosts.
`startDev(args)` and `stopChild(ChildProcess | {url, stop})` remain supported.
`cli(args)` dispatches every published verb through the installed JS wrapper, including web-shell,
awaits close and returns `{code, stdout, stderr, logs}`; assert code
when expecting success. `withBrowser({ chromium })` uses the caller’s Playwright (including @playwright/test);
playwright-core is an optional peer required when using browsers. Chromium launches over
a pipe, with no WebSocket listener. Set CHROME to an installed Chromium; root or a recognized
unavailable sandbox selects --no-sandbox. Ordinary hosts first use the sandbox.

`fillRN` clears then uses pressSequentially so RN-web gets real keystrokes.
`statusText(page, text)` uses getByText with exact matching: a role=status element
has no content-derived accessible name, so never getByRole('status', {name}).
`selectByValue(locator, value)` uses a stable option value, not a label regex.
Never wait for networkidle: live queries hold long polls. Wait for the control.

`renderedText(page, text, { within: container })` excludes inputs and textareas.
`waitForFresh(locator, previous, { within: container, timeoutMs: 30000 })` scopes a fresh signal.
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
Keep the promise outside components that may unmount; rearming cancels observation.

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
new store identity. Reopen clients after reset. `/seed` is an upsert, not reset;
changing an immutable field refuses E_CONSTRAINT. Both doors are dev-only.

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
starter form. E_WITNESS_BROWSER means no usable headless Chromium executable. Set SNAPBACK4_CHROMIUM.

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
