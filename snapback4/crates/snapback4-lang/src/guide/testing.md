# Testing: fixtures and the packaged proof kit

Use `npm run verify` for the starter proof loop: check, acceptance, frontend and probe shutdown.
The kit owns server/browser lifecycles; day2:proof covers saved-version changes.

```js
import { startDev, cleanup } from "snapback4/proof";
const dev = await startDev();
try { console.log(dev.url); } finally { await cleanup(() => dev.stop()); }
```

Default `test` output reports finite campaign status, authored cases and query coverage in at most three lines, with actionable coverage gaps and a private `.snapback4/last/test.txt` report. `test --explain` shows meters, observations and all recorded evidence; `test --json` returns the complete report and structured campaign/case/query counts. Proof checks print readiness, uptime, lock release and every failure; pass `--json` for the complete receipt or `--explain` for readable details. `data` prints row counts, truncation/dormant notices and a detail path; use `data --json` for rows or `--explain` to display them. Repeated data reads print changes only.

To verify a brief's `probe:serve` process, use `snapback4 serve-check
--deployment staging --script probe:serve --then 'node scripts/acceptance.mjs'`. Never write a serve driver. With or without --then it checks one JSON readiness line,
at least 30 seconds alive (including business work), group SIGTERM cleanup and store release.
For inherited day-two drivers, replace the outer checker with this command; keep
only business assertions in --then. See `guide production --section Serve script and reusable accounts`
for the complete startServe/startStatic/roster/SIGTERM recipe. Password starters
include `npm run --silent probe:check`, which runs that same helper against a
fresh deployment. Use this as the process verification driver; it withholds
credentials and reports readiness/lifetime/shutdown failures. For shared test releases and probe:serve, use `guide staging`: real password users and operator grants on serve. Password-only dev fixture/clock tools require explicit --unsafe-dev-doors; startDev persists unless --memory is explicit.

Raw HTTP starts with JSON envelopes: POST /q/name `{args:{...}}`, POST /m/name
`{id:"stable-intent-id",args:{...}}`, POST /a/name `{id:"stable-action-id",args:{...}}`.
Keep the same id on an ambiguous retry. A mutation/action id identifies the attempt;
`result.id` identifies a returned row. Query data is under `data`, writes under `result`;
actions have their own lifecycle (`guide actions`), not a mutation receipt.

The generated frontend:proof builds its own dist with build (web) or build:web (Expo web).
After replacing the starter screen, replace its business assertions too.
`init --adapt` previews only and writes nothing; use the printed `--apply` command.
A custom Home has no write scenario: replace the Home assertions; a proof without a write fails.
`day2:proof` uses versions/v1 and versions/v2 (initial source snapshots and contemporary fixtures).

E_FIXTURE_ALIAS means a saved alias or path could not resolve. Use an earlier case's `save` name with `$name` or `$name.field`; escape a literal with `$$` or `$literal`. An unresolved assertion fails the case; it never compares the alias as literal data.

E_FIXTURE_TIME means a relative fixture time is malformed or out of range. Use `now` or `now±duration` with positive integral ms/s/m/h/d/w. Relative conversion applies only to typed time leaves; text/JSON strings stay literal.

## Refusal ladder

Program `exists` is caller-filtered: a physically present private roster row
can answer false. Table-rule probes evaluate their declared authority separately;
`require exists` never grants table write authority. Use a readable membership
lookup, an appropriately scoped rule probe, or an authorized service operation.

Supply every valid argument when testing authorization: decode (`E_INPUT`)
runs before the body. For a body ordered lookup → write → require, a hidden
asserted lookup refuses `NOT_FOUND`, a readable denied table write refuses
`E_RULE`, and only then can the later `require` emit its code. After decoding,
statements execute in authored order; put a require first to have it decide
first. Nullable hidden lookups return null; assertions use their authored
`else` code. Hidden denied update/delete targets retain NOT_FOUND. Earlier
writes roll back when a later require refuses.

A query over hidden rows is complete and empty when the pinned scope uniformly
refuses its viewer. A nonuniform scan can still be partial with no visible
rows. Test the complete flag as well as the count; do not expect E_RULE for a
hidden page. For a compiled role workflow see: `guide rule-recipes role-workflow`.
Use `guide client` for client recipes and the proof helper contracts below.

`test` names invariants it cannot fully evaluate, including unsupported clock,
typed arithmetic, cross-row and read-through assertions. Runtime unknown judgments
name the target and source site too. These gaps limit security coverage and
stay non-failing; actual replayed violations fail. Campaign execution, authored
cases and query probes have separate statuses. A completed finite campaign
is not labelled incomplete because an unrelated probe could not derive arguments.
During long campaigns an elapsed-time heartbeat goes to stderr. With no authored cases, a clean campaign exits successfully and names its finite coverage; skipped existing cases still refuse. Zero violations does not mean
an unsupported assertion was tested. Generated fixtures use fresh actor-owned
uploads and try opposite creator booleans before a second actor fills the row
slots. Finite history, argument and population cuts remain explicit coverage gaps.

Fixture campaign reads can include `service:operator` (042E): the seed loader
and generated exploration use this seat. If the role actually reads a protected
column, an invariant excluding that seat must fail. Inspect the printed
operation/principal/site: either deny that read in the rule or explicitly include
the operator in independent intent when the specification permits it. Fixture
loading is trusted setup; it does not confer application read authority.

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
Money/decimal use integer minor units; bytes are hex; optional fields may be absent/null. Parents load before children.
Defaults, unique keys, caps, maintained values and sequences obey normal insert
semantics: omit sequence and engine-maintained columns. A missing parent is
NOT_FOUND; a bad row or unknown table fails the run before any case executes.

Add `test.cases.jsonl` to that directory. Cases execute in order; writes change
what later cases see. The complete vocabulary is `as`, `op`, `args`, `expect`,
`data`, `match`, `matchSet`, `count`, `save`, `label`; unknown keys fail before any case runs.

```jsonl
{"as":"alice","op":"addCard","args":{"board":"board-alice","text":"eggs"},"save":"eggs"}
{"as":"alice","op":"renameCard","args":{"card":"$eggs","text":"milk"}}
{"as":"bob","op":"cardsOn","args":{"board":"board-alice"},"count":0}
```

`save` names an answer: `$eggs` means its row id, `$eggs.text` its field; `$plans.0.id` selects the first row of a saved query list.
A bare id/reference/principal/cursor/asset argument equal to a saved alias refuses
with the `$name` rewrite (including optional/list leaves). Text, enum and JSON
arguments remain literals. A root `$alias` saved as null refuses E_FIXTURE_ALIAS
by name; `$row.optionalField` may be null.
Bare assertion strings (including enum literals) remain literals even if an alias has that name.
Aliases resolve recursively inside args, data and match. Unknown aliases and
missing fields refuse E_FIXTURE_ALIAS by name. `$$text` means literal
`$text`; `{"$literal":"eggs"}` means literal `eggs`, even if saved as an alias.
`data` asserts the exact result; `match` asserts a recursive object subset
(`"match":{"name":"Ash"}` permits an extra id). Arrays retain their exact
length/order, with each element matched recursively; scalars compare exactly.
`matchSet` compares a list without order: `"matchSet":[{"name":"Ash"},{"name":"Oak"}]`
requires exactly those two recursive subsets, each matched to a different row.
Duplicate counts matter. Nested arrays retain their order. All assertion forms may appear together. `count` asserts length. A mutation defaults to
`sent`; `ok` also accepts a sent mutation and never a refusal; a query defaults to its check verdict (`complete`, or complete/capped when
N_NEVER_COMPLETE). Set `expect` to `complete`, `capped`, `ok`, `denied`, or a
refusal code. `as` accepts a principal (`user:…`, `service:operator`) in password-only fixtures; these are engine cases, not login proofs. Bare persona names must belong to the declared cast.

After the cases, the sweep runs every query with that persona's case arguments when available,
otherwise derives arguments from the store after the cases' writes (text uses
the shortest valid value). Saved-alias arguments belong to the case run; the
sweep uses another literal-argument case or derives arguments for that query.
For different authorization lanes, add `fixtures/test.sweep.json`:
`{"hrStatus":["carol"],"policiesList":["alice","bob"]}`. Each named query uses
its listed personas; other queries use the whole cast. `--as` explicitly overrides
that matrix because it requests one deliberate global probe, and names the queries whose sweep personas it overrides. Empty/unknown entries and undeclared personas fail before cases run.
`test --explain` prints examined rows, entries, probes, steps, heap/output bytes and ceilings.
The output legend: examined = rows visited; entries = index entries visited;
probes = rule lookups; steps = interpreter work; heap B = charged heap bytes;
output B = encoded answer bytes. The ceilings row gives the corresponding limits.
OK cases passed their explicit expectations; complete is the whole answer;
capped is a partial answer; refused is an expected-case or program-require refusal;
denied is an unexpected refusal that fails the sweep; not run means no coverage.
A green sweep alone is no business assertion.
`complete` is the whole answer; `capped` is a partial answer, not a refusal.
Sweep refusals from a program's own require (family rule) are advisory and do
not fail the run. Other refused sweep queries fail unless that query/persona's
own explicit case expects the same code. This exemption matches query, persona
and code; it does not prove that earlier arguments/state validate the final sweep.
Write one refusal case per refused persona, plus explicit data/count/completeness
assertions for the allowed personas' final state. A refusal case for bob never
covers carol. Failed cases and invalid fixtures exit 1. Zero executed business cases also exit 1, even if query probes answer; `test --fixture-only` explicitly requests fixture/sweep validation.
N_FIXTURE_ARGUMENT_DRIFT means a fixture case no longer fits its operation signature. Update its arguments and run snapback4 test.

A lookup reads through the caller's rule: hidden rows give NOT_FOUND before
later `require` guards; hidden unique conflicts give E_RULE instead of the
custom code. `test` and dev refusal logs explain the hidden lookup or rule.
`guide refusals` explains refusal ordering and hidden rows.

## Loading fixture rows for a proof

```js
import { startDev, loadFixtures, cleanup } from "snapback4/proof";
const dev = await startDev({ args: ["--memory", "--unsafe-dev-doors"] });
try {
  const rows = await loadFixtures("fixtures", { url: dev.url });
  const response = await fetch(`${dev.url}/dev/reset`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ seed: rows }),
  });
  const result = await response.json();
  if (!response.ok || result.denied) throw Error(JSON.stringify(result));
  // Make assertions against this disposable dev here.
} finally { await cleanup(() => dev.stop()); }
```

The helper resolves typed relative times against one dev clock from bounded
catalog/status requests (timeoutMs defaults to 10 seconds). Options `now` and
`cwd` override clock/project. Without credentials it reads the dev-only catalog;
`serve` refuses this door. `startDev` also returns `personas`. To authenticate both
reads, pass `{ url: dev.url, persona: dev.personas[0] }`, or `headers` with your
Authorization header. Reload after schema edits. Reset validates rows;
inspect its reply for `denied`. `/seed` and `/dev/reset` accept relative times
directly; `"clock":"reset"` uses the prospective wall clock atomically.

## An acceptance script over HTTP

The same kit supports HTTP and browser proofs. HTTP acknowledgement is not React settlement; mutation refusals are `{state:'failed', why}`.

```js
import assert from "node:assert/strict";
import { startDev, startStatic, withBrowser, fillRN, renderedText,
  waitForFresh, bounded, cleanup } from "snapback4/proof";

const dev = await startDev({ args: ["--memory"] }); // disposable store; actual runtime URL
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
output, including wasm. The kit owns the complete process group for native hosts
and `command()`, including npm-created descendants and abrupt caller death. For
a command whose stdout is one machine-readable line, use `npm run --silent` so
npm does not add its banner.
`startDev()` uses native dev's persistent `.snapback4/store.sqlite` in cwd.
Disposable proofs select `{args:["--memory"]}` explicitly. Fixture and persona
tools on password-only apps require `--unsafe-dev-doors`; `startDev().now()`,
`advance()` and `drain()` use an independent local `service:operator` token and
preserve live sessions by default. Use `guide staging` for real users under serve. The legacy kit-only
`--no-memory` alias is consumed for compatibility; it is not a native CLI flag.
`--store` is forwarded to native validation (current dev refuses it).
`startDev(args)` and `stopChild(ChildProcess | {url, stop})` remain supported.
`cli(args)` dispatches every published verb through the installed JS wrapper, including web-shell,
awaits close and returns `{code, stdout, stderr, logs}`; assert code
when expecting success. `cli(["token", ...])` never persists stdout: its bearer is
returned in memory only. Use `{secret:true}` with cli/command for other secret
stdout; stderr remains a log, so the invoked tool must keep secrets off stderr.
`withBrowser` automatically adds `witness=web` to top-level HTTP(S) navigations
with an init script before app scripts, including redirect destinations; raw Playwright callers add the flag themselves.
`withBrowser({ chromium })` uses the caller’s Playwright (including @playwright/test);
playwright-core is an optional peer required when using browsers. Chromium launches over
a pipe, with no WebSocket listener. Set CHROME to an installed Chromium; root or a recognized
unavailable sandbox selects --no-sandbox. Ordinary hosts first use the sandbox.

`fillRN` clears then uses pressSequentially so RN-web gets real keystrokes.
`statusText(page, text)` uses getByText with exact matching: a role=status element
has no content-derived accessible name, so never getByRole('status', {name}).
`selectByValue(locator, value)` uses a stable option value, not a label regex.
`labelledControl(page, "combobox", "Owner")` resolves the control by role and
label without appending option text; strict duplicate names still refuse.
Prefer `<label htmlFor="owner">Owner</label><select id="owner">…</select>`
and `page.getByRole("combobox", {name:"Owner", exact:true})`. Textareas need
the same explicit label or aria-label. RN-web uses `accessibilityLabel="Owner"`
on TextInput, matched by `page.getByLabel("Owner", {exact:true})`; the Expo
starter also labels its status Text `Write status`, matched by getByLabel. For visible
status Text, use accessibilityLiveRegion="polite", not accessibilityRole="status".
Never wait for networkidle: live queries hold long polls. Wait for the control.

`renderedText(page, text, { exact: true, within: container })` excludes inputs and
textareas. They inspect **on-screen rendered text only**: hidden, clipped and
outside-the-viewport text does not count, even if it exists in the DOM.
Scroll the specific row into view before calling `renderedText` or
`waitForFresh`; an input value is not a rendered result. Strings match normalized substrings by default; exact:true requires equality. Use
`renderedText(page, "verification", {exact:false})` or
`renderedText(page, /verification/)` for a row that contains more text.
`within` is optional. RN-web may split one logical row across nested nodes,
producing multiple matches: scope to its container or use exact:true.
Ambiguous observations refuse independent matches; narrow the scope before retrying.
Decorative glyphs contribute to accessible names: use aria-hidden for icons or
an explicit aria-label. A wrapped select label can absorb option text; prefer
an explicit label/for pair and selectByValue. Run frontPage before screenshots.
`waitForFresh(locator, previous, { within: container, timeoutMs: 30000 })` scopes
a fresh signal; both options are optional. Timeout names the locator, last count
and text, and absent versus present-but-unchanged. Old text and editable values
prove nothing. After a terminal receipt, poll the authoritative projection:
`await waitForServer(() => app.online.query(api.list, {}), read => "data" in read && read.fresh && read.data.some(row => row.id === createdId), {label:"committed row"})`.
Import waitForServer from snapback4/proof. Supply app.online or raw HTTP server
reads; a local device query can contain predictions and is not server truth. Each poll and the whole wait are bounded;
its deadline reports the last answer. A poll timeout never means the write failed.
`await frontPage(page)` brings the page forward before `await page.screenshot(...)`.

E_WITNESS_DISABLED means claiming is not armed. Add &witness=web to the proof URL.

E_WITNESS_SENT means the write failed, stayed pending or timed out. Inspect the refusal; pending is not success. A proof timeout never cancels a write.

E_WITNESS_NO_WRITE means the armed click produced no durable mutation. Check the form handler and useAppReady() before clicking; a proof failure never cancels a write.

E_WITNESS_UNCLAIMED means the armed durable write's event, operation or arguments did not match. Inspect the reason in formResult; the application write still runs normally.

## Web witness (15-line contract)

registerWebWitness(app, api) always installs window.__snapback4Witness in a browser.
Load ?witness=web (or &witness=web) before registration; arming survives SPA routes.
Without it, beginForm/mutate throws E_WITNESS_DISABLED: add &witness=web.
After signing in, get the actual submit button Element from the page.
beginForm(name, expected | null, button) arms one durable mutation.
name is the generated operation name; undefined accepts any durable operation.
expected constrains the named arguments: key order is ignored, nested values match canonical JSON exactly.
Handler-owned extra arguments (such as generated IDs) are allowed; null skips argument matching.
A mismatched named argument produces E_WITNESS_UNCLAIMED in formResult; the real application write still runs.
Click the armed button with Playwright; script clicks do not qualify.
A synchronous form onSubmit caused by that button also qualifies.
Timers or later requestSubmit calls do not inherit a prior click.
formResult() returns a Promise of { state, id, seq?, result?, why?, mutation }.
Require state === "sent" before asserting the rendered business result.
An unclaimable durable write settles failed/E_WITNESS_UNCLAIMED with provenance/operation detail or mismatched argument keys. Full armed/actual values are retained only in the proof log directory’s mode-0600 private witness JSONL log.
Keep the promise outside components that may unmount. Four terminal outcomes:
- sent: claimed write committed (a replay may omit its historical result);
- failed with the app refusal: claimed write was refused;
- failed/E_WITNESS_UNCLAIMED: event, operation or arguments did not match;
- failed/E_WITNESS_NO_WRITE: armed click produced no durable mutation (handler returned early, or app was not ready).
Both helper refusals carry stable `why.reason`, independent of message text:

| Code | reason | Meaning |
|---|---|---|
| E_WITNESS_NO_WRITE | not-ready | app.ready had not successfully resolved at the click |
| E_WITNESS_NO_WRITE | returned-early | ready handler issued no durable write |
| E_WITNESS_UNCLAIMED | event | invocation lacked this arm's event/handler claim, or re-arm ended observation |
| E_WITNESS_UNCLAIMED | arguments | operation name or canonical arguments differed |

No write fails 1 second after the trusted click, on re-arm, or after a 30-second
abandoned arm. A claimed write still pending at 30 seconds fails the proof with
E_WITNESS_SENT; inspect its original intent id, never infer a server refusal.
Re-arm settles the old promise and releases observation; it never cancels a write.
Gate the form with useAppReady() before typing/clicking; auth alone can precede
the initial app.ready barrier. pending is custody, not a terminal result.

For an awaited upload (041R), call `witnessForm(app,event,async mutate => ...)` from
`snapback4/witness-web` synchronously in the handler and use its supplied mutate
for placement after client.upload succeeds. It captures a per-arm write claim
from that exact trusted event; unrelated promise callbacks cannot claim it.
While the handler awaits, the arm's original 30-second bound applies; returning
without a write settles no-write. Outside an armed proof it invokes ordinary
app.mutate. Upload-on-selection plus a synchronous Save is also useful (`guide assets`).

`waitForFresh(locator,previous,options)` returns `Promise<string>`: the fresh
nonempty text, not a locator. Keep the locator separately for later actions.
Strings passed to renderedText match substrings by default; use exact:true for equality. For composite row text use
a RegExp or exact:false. If an exact string stays absent while a scoped substring
exists, its timeout adds "a substring match exists; pass a RegExp or `exact: false`".
This hint never weakens the assertion or suppresses ambiguity errors.

On React Native web, a composite `<Text>` is one node, so match its whole text
or a RegExp. Button titles render uppercase: use a case-insensitive role name
when the proof runs on both web and native (`/^add$/i`). React Native has no
`accessibilityRole="status"`; use accessibilityLiveRegion and statusText/text
selectors for its visible status. An input's value is never rendered proof.

For a wrapped `<select>`, its label can include option text. Prefer the select's
own accessible name or scope a label then locate its select; use selectByValue
with the stable option value, not its display label. For example, a label
containing Choice and its options can be scoped with getByText('Choice',
{exact:false}).locator('select'); an explicit aria-label on the select is clearer.

Eight rules keep proofs honest:

- Log to files, never pipes, for server output. A descendant holding a pipe can hide completion. Secret command stdout uses bounded memory capture, whose read end closes on deadline.
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

Each explicit `--memory` dev start is empty; default dev retains its project
store. Reset destroys that host's data, so use disposable dev for fixture proofs.
Between scenarios on one dev with development doors open, POST `/dev/reset`
with `{seed:[{table,row}]}` atomically clears rows, logs, queues, assets, accounts
and sessions, retains schema/personas/seats, and returns `{reset:true}` with a
new store identity. A stale online client refuses E_DEV_RESET: reopen the client after reset. Seed persona rosters before
calling operations that use them: a fresh dev has no admins or memberships.
`/seed` takes a **bare array**, beside reset's wrapper:

```json
[{"table":"boards","row":{"id":"board-alice","owner":"dev:alice","title":"Groceries"}}]
```

POST it to `/seed` to upsert without resetting;
changing an immutable field refuses E_CONSTRAINT. Both doors are dev-only.
Advance time without sleeping with `snapback4 clock advance +2h`: it discovers
a unique live dev for this project, including a memory host on a custom port
(add `--port N` to select among simultaneous hosts), or POST `/dev/clock/advance` with `{"duration":"+2h"}`.
Clock/reset replies carry now and skewMs. Reset keeps simulated time unless
clock:reset is explicit. `await dev.now()` from startDev reads authoritative dev
time afresh; use it instead of Date.now() for deadline arguments after advances.
Default advance coalesces to the latest window. Add --each-boundary (HTTP
eachBoundary:true) to admit each crossed window in order; jobs still see the
final advanced now, so use periodStart/periodEnd for historical windows.
For every five-minute window in an hour, use `clock advance 1h --each-boundary`;
assert firedWindows rather than assuming coalesced work ran every period.
The 10,000-window cap applies only to --each-boundary. Coalesced reports retain
exact skipped counts and preview 32 replay commands per schedule.
After an HTTP advance, `await waitForClock(page, advanced.now)` from snapback4/proof
waits for the page's own signed-in client clock to reach that sample. It neither
sets the browser clock nor treats the proof driver's time as a client sample.
Clock controls are dev-only; `guide clock` covers status, reset and restart.
One-shot HTTP reads after a not-before crossing wait for each encountered live
publication dependency. A 30-second limit refuses retryable E_QUERY_RETRY
(503); retry the read, never assume loading means an empty list.

## Day-two proofs with immutable sources

Keep one directory per release outside snapback/: versions/v1/schema.q,
any other .q modules with their original names, and versions/v1/fixtures/.
Use the same versions/v1 directory for --schema, testSource and the compatibility
baseline (guide deploy). Opt in with `init --web --day2` or `init --expo --day2` (existing apps:
`init --adapt --day2 --apply`). This creates versions/v1 and versions/v2 with
fixtures/; update the saved source and fixtures together as the product evolves.
`npm run day2:proof` already passes those directories. Its marked
BUSINESS_ASSERTION_BEGIN block fails until you replace it with authenticated
persisted-row/backfill/refusal assertions for all four transitions. A successful
release switch alone proves no business invariant.
`deploy(dir, savedSchema)` requires an explicit source file or directory;
`rollback(dir, target)` requires an immutable release number or `latest`.
Neither swaps working files. `testSource("versions/v1")` and
`test --source versions/v1` default to versions/v1/fixtures/. For a standalone
versions/v1.q, the contemporary directory is versions/v1-fixtures/. For saved-source tests, explicit
`--fixture dir` always wins and validates every row and case strictly.
Without contemporary fixtures, saved-source testing validates only working
fixture files whose tables the saved source declares; it names skipped table
files and skips working test.cases.jsonl, which may call later operations.
Use `--fixture <contemporary-dir>` for a complete business suite. With no fixtures
at all it announces a query sweep only. Shared-table rows remain strictly checked;
unknown fields do not disappear. `testSource` returns `casesRun` and
`casesSkipped` and refuses zero executed business cases unless
`{ fixtureOnly: true }` explicitly requests fixture/sweep validation. Failures
include stdout evidence. Check warns when a saved version's fixtures/case
signatures no longer fit its own schema. This is structural validation, not a
proof that expected business values are correct. The generated day-two proof
also accepts a fresh explicit deployment, for example
`npm run day2:proof -- versions/v1 versions/v2 ./deploy`; it preserves that
deployment for inspection and refuses an existing destination. check reports inherited day2:proof scripts with
no business assertions only when their bytes match a shipped template: preview
`init --adapt`, then run `init --adapt --apply`. Custom proofs own their saved
paths; deleted unreferenced day-two scaffolding stays deleted. Frontend advice
about missing build steps or npx servers is explicitly heuristic.
Source layout is documented here and in guide deploy.
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

`guide witness` has native and lifecycle proofs. `guide testing --section proof-api` lists every proof export; the day-two accounts section runs the complete production-account release loop.

Full bodies for the preceding fixture (omitted request ids stay omitted):

```json
{
  "/m/add": {"state":"sent","result":{"id":"row1","title":"Proof"},"seq":1,"generation":1,"head":1,"store_id":"store1","preserved":["notes"]},
  "/m/nothing": {"state":"sent","result":null,"seq":2,"generation":1,"head":2,"store_id":"store1","preserved":["notes"]},
  "/m/refuse": {"state":"failed","why":{"code":"PROOF_REFUSED","family":"rule","message":"the program refused with PROOF_REFUSED","rule":"PROOF_REFUSED","guide":"programs","site":"schema.q:13:3"},"generation":1,"head":2,"store_id":"store1","preserved":null},
  "/q/list": {"data":[{"id":"row1","title":"Proof"}],"complete":true,"cut":null,"next":null,"nextExpiry":null,"seq":2,"generation":1,"store_id":"store1","tables":["notes"],"viewer":"dev:alice","scopes":{},"meter":{"cut":null,"examined":1,"heapBytes":937,"indexEntries":0,"outputBytes":89,"probes":0,"rowsWritten":0,"steps":12}}
}
```

A full `cap` counts every row, readable or not, and refuses `E_CONSTRAINT`.

## Hidden-only pages

A uniformly denied page over only hidden rows is `complete` and empty, never `denied`; nonuniform scans can remain partial (`guide indexes`). Assert empty data and completeness for that denied scope, and use a readable role query for access UI (`guide refusals`, `guide rule-recipes`). KIT owns the rest of this page.

## Raw HTTP proof across releases
Every call carries `Authorization: Bearer TOKEN` on serve or `x-snapback-persona: alice` on dev. Send `Content-Type: application/json` and `{args: {...}}`; query data and mutation results use different envelopes. Reuse a stable mutation id for a retry, never a new id after an ambiguous reply.

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

E_PROOF_AMBIGUOUS means multiple rendered matches prevent a unique observation.
Narrow within or pass exact: true; never choose the first match silently.

## Check an npm serve script

Run `npx snapback4 serve-check --deployment production --script prod:serve`.
It runs `npm run --silent prod:serve` in its own process group, requires exactly
one JSON object line on stdout, keeps the script up for 30 seconds after that
line, sends group SIGTERM, and checks children and the deployment lock before
forced cleanup. Startup also has a 30-second deadline. `--up-ms` and
`--timeout-ms` override these intervals for focused tests. The JSON report names
no JSON line, extra output, early exit, a child left running, and a held lock
separately. Script stdout may contain credentials and is never echoed or saved.
Use a disposable copy of production: this runs the script's real startup work.
Never tail a live serve pipeline or signal only npm; signal the owned group.

The same liveness check is available from Node:

```js
import { serveCheck } from "snapback4/proof";
const result = await serveCheck({ script: "prod:serve", deployment: "production" });
console.log(JSON.stringify(result));
if (!result.ok) process.exitCode = 1;
```

For any test against a running app, use `npx snapback4 serve-check --deployment production --script prod:serve --then 'npm run client:calls'`.
Never write a serve driver: the runner starts the real npm script, waits for its
first JSON line, runs the command, stops the entire group and waits for the lock.
The command receives `SNAPBACK4_SERVE_JSON` (the complete readiness object),
`SNAPBACK_URL`/`BACKEND_URL` and `FRONTEND_URL`. Treat readiness as credentials:
never print it. The exit status is the command's status; a startup or shutdown
failure makes an otherwise successful command fail. `--then-timeout-ms` defaults
to 120000; a hung command is reported separately from missing startup JSON,
early serve exit, children ignoring TERM and a retained store lock.

For an in-process proof callback, use this complete example (set `probe:serve`
and its deployment first). Callback work must honor its AbortSignal or bound
its own browser/network operations; cleanup runs even when the callback throws.
<!-- DX12 RUN SERVE BEGIN -->
```js
import assert from "node:assert/strict";
import { withServeScript } from "snapback4/proof";
await withServeScript("probe:serve", async (ready, signal) => {
  const response = await fetch(`${ready.backendUrl}/auth/config`, { signal });
  assert.equal(response.ok, true);
  assert.equal((await response.json()).development, false);
}, { deployment: "production", thenTimeoutMs: 30000 });
```
<!-- DX12 RUN SERVE END -->

## Production moves in a stage script

Save v1/v2 sources outside snapback/. The following complete stage script
assumes an existing production deployment at release 1 and saved v2 source at
versions/v2. With no live owner, deploy/rollback take the store themselves:

```js
import { deploy, rollback } from "snapback4/proof";
await deploy("production", "versions/v2");
await rollback("production", 1);
```

With a live owner, the same moves use its authenticated local control path.
This variant tests the real npm serve script and waits for its lock release:

```js
import { deploy, rollback, withServeScript } from "snapback4/proof";
await withServeScript("prod:serve", async () => {
  await deploy("production", "versions/v2");
  await rollback("production", 1);
}, { deployment: "production" });
```

If another script already owns serve, use the first variant and leave shutdown
to that owner. Await each move; an ambiguous activation needs inspection of
`releases production --json` before another attempt. To stop an intended local
owner explicitly, run `snapback4 stop production`; `serve production
--wait-stopped` is only the barrier after shutdown was requested.

## Observe before the trigger

For transient button/status text, keep a stable locator and arm the observer
before clicking. The browser records visible changes while the action settles:

```js
const status = page.getByTestId("save-status");
const changed = await waitForFresh(status, "Save", {
  trigger: () => status.click(), timeoutMs: 5000,
});
```

Use a stable button locator (for example getByTestId or a status container)
when its accessible name changes. A locator for the future transient text
cannot be resolved before the trigger. The ordinary polling form still works
for durable text; it cannot recover text that disappeared before observation.
