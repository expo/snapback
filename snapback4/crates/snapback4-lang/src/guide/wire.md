# Wire: HTTP for curl, scripts and non-JS clients

Under the JS client is plain JSON over HTTP, which curl, Python, Swift or any HTTP client can speak. Each call below is a POST with a JSON body unless it says GET.

```sh
U=http://127.0.0.1:4400
curl -s -X POST $U/q/mine -H 'x-snapback-persona: alice' -H 'Content-Type: application/json' -d '{"args":{}}'
curl -s -X POST $U/m/add -H 'x-snapback-persona: alice' -H 'Content-Type: application/json' -d '{"args":{"body":"hi"}}'
```

`snapback4 dev` serves on that address (choose another with `--port N`, or
`--port 0` for a free one; the first stdout line is the URL). A taken port
refuses the start at once with `E_ADDRINUSE`, naming the holder's pid. The JS client (`snapback4/client`) stays the
paved surface for apps: it adds sync, offline writes and live queries.

## Identity

In development, `x-snapback-persona: alice` acts as `dev:alice`: same machine
only, `[A-Za-z0-9_-]+`, with `use personas` declaring the cast. `snapback4 serve`
refuses personas. Everywhere else send `Authorization: Bearer <token>`, from
`/auth/guest` (`{}`), `/auth/signup` or `/auth/login` (`{"email","password"}`),
each answering `{"session":{principal,kind,token,expiresAt}}`; a worker's token
comes from `snapback4 token --service <name>`. Send one credential, not both.

## Operations

- `/q/<op>` with `{"args":{..}}` answers `{data, complete, cut, next, seq, tables, viewer}`
  or `{denied}`. Page by passing `next` back as the query's cursor argument.
- `/m/<op>` with `{"id"?, "args":{..}}` answers `{state:"sent", id, seq, result}` or
  `{state:"failed", id, why, current?}`. With an `id` (a unique string the caller
  mints once per intended write), a retry of the same call applies at most once
  and answers `replayed: true`; without one, every POST is a new write.
- Values: `time` is Unix milliseconds; `bytes` is lowercase hex; a reference is
  its row's id string. Numbers: see below.
- A job is not a client call (E_OP): a schedule fires it, and in dev
  `/dev/jobs/<job>` or `snapback4 run <job>` runs one.
- GET `/changes?since=<seq>&wait=25` long-polls. It answers `{seq, tables,
  generation, store_id}` when a commit lands or after `wait` seconds: re-query
  what reads those tables, then poll again from the new `seq`. `/sync` is the
  device replication protocol; use the client rather than reimplementing it.
- A held wait is bounded. A full host answers 503 `E_STREAMS` (Retry-After: 2);
  one principal past its share of held polls (one per tab or device, default
  16) gets 429 `E_STREAMS` (Retry-After: 5). Both are retryable and admitted
  nothing: wait for Retry-After, poll `/changes?since=<seq>` without `wait`
  meanwhile, then hold again. The JS client does this for you.
- A host that runs the device itself (the native module or the wasm device
  without `snapback4/client`) must route each device `query` reply: some say
  "ask the server" (`unknown` without `retained`) and carry a placeholder
  `data`. "The device reply" in CLIENT-AND-OPERATIONS.md §7 is that contract.

## Numbers, money and decimals

Every number on the wire is a JSON integer within ±(2^53 − 1); there are no
floats. `money CUR` (scale 2 unless given) and `decimal S` hold an integer
scaled by 10^S and travel as that integer, in both directions:

```quarry
table expenses:
  owner: principal
  amount: money USD                 -- $12.50 travels as 1250
  rate: decimal 4                   -- 0.0725 travels as 725
  place: json <=400 ?               -- numbers inside are integers too
  read <- .owner = viewer
  insert <- .owner = viewer
mutation addExpense(amount: money USD, rate: decimal 4, place: json <=400 ?):
  require amount > 0 else BAD_AMOUNT
  return insert expenses { owner: viewer, amount, rate, place }
query spent():
  return sum(expenses where .owner = viewer, .amount)
```

```sh
curl -s -X POST $U/m/addExpense -H 'x-snapback-persona: alice' -H 'Content-Type: application/json' \
  -d '{"args":{"amount":1250,"rate":725,"place":{"latE6":37774900,"lngE6":-122419400}}}'
```

`spent` answers `{"data":1250,..}`: cents, not dollars. `12.5` and `1000.0`
refuse HTTP 400 E_INPUT ("argument amount: an integer"), `"12.50"` too ("expected
an integer amount in minor units"), and so does a fraction anywhere inside a
`json` value ("a number must be an integer in the signed 53-bit range"). Scale with rounding before sending:
`Math.round(dollars * 100)`, since `0.29 * 100` is `28.999999999999996`; in
Python send `round(x * 100)`, because `json.dumps(10.0)` writes `10.0`.
Format on display, `(cents / 100).toFixed(2)`. Keep coordinates and
measurements as scaled integers (microdegrees, milligrams) or as text.

## Development doors

Dev only, same machine; `serve` refuses each one.

- `/seed` with `[{"table":"t","row":{"id":"..",..}}]` writes rows as the system,
  rules bypassed, and answers `{seeded: N}`. It is an upsert by id, so every row
  names its own `id` (any unique string; `idFrom(label)` gives a stable one), and
  a principal field holds `"dev:alice"`, not `"alice"` (`guide testing`).
- `/dev/clock/advance` with `{"duration":"+2m"}` moves the dev clock, sweeps
  expiry, fires due schedules and runs queued jobs (`snapback4 clock advance 2m`).
- `/dev/jobs/<job>` with `{"args":{..}}` runs one job now and answers its run.
- GET `/dev/status` (no credential) is the readiness probe: it names the
  server's `pid`, `project`, whether the store is `temporary`, the served
  generation, the dev clock and the declared personas.
- `snapback4 run <op> --as bob` beside a running dev forwards to these routes.

## Refusals

A program's own refusal is HTTP 200 with `{denied}` (503 when retryable).
No or a dead credential is 401 E_AUTH; an unknown operation or route is 404
E_OP; a bad body or argument is 400 E_INPUT; a body past its ceiling (1 MiB of
JSON, 16 MiB for `/seed`) is 413. A refusal is `{code, family, message,
rewrite?, guide?}`, and `snapback4 why <code>` explains one.

The full reference, including `/assets`, the rest of `/auth`, worker and action
doors, and clock headers, is "The wire" in CLIENT-AND-OPERATIONS.md §5, which
ships in the package beside README.md.
