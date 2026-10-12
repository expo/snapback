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
only, `[A-Za-z0-9_-]+`, and only for a name `use personas` declares; any other
name is 401 E_AUTH naming the declaration (a schema without `use personas`
admits any name). `snapback4 serve` refuses personas. Everywhere else send `Authorization: Bearer <token>`, from
`/auth/guest` (`{}`), `/auth/signup` or `/auth/login` (`{"email","password"}`),
each answering `{"session":{principal,kind,token,expiresAt}}`; a worker's token
comes from `snapback4 token --service <name>`. Send one credential, not both.

## Operations

- `/q/<op>` with `{"args":{..}}` answers `{data, complete, cut, next, seq, tables, viewer}`
  or `{denied}`. `data` is what the query returns, as is: a list, a row, a shape,
  or a scalar (a keyed view read `totals[owner]` answers the number itself).
  Page by passing `next` back as the query's cursor argument.
- `/m/<op>` with `{"id"?, "args":{..}}` answers `{state:"sent", id, seq, result}` or
  `{state:"failed", id, why, current?}`, both HTTP 200 (see Refusals for the
  status codes). `result` is what the mutation returns (an inserted row's id is
  `result.id`); the top-level `id` is the write id you sent, `null` without one. With an `id` (a unique string the caller mints once per
  intended write), a retry of the same call applies at most once and answers
  `replayed: true`; the same `id` with another operation or other arguments is
  `{state:"failed", why:{code:"E_ID_REUSED"}}`. Without an `id`, every POST is a
  new write.
  A replay omits `result` and `current`: the durable receipt retains execution
  identity, not historical values or read authority. Read current data with a
  query instead of treating an absent replay result as a new-write result.
- Values: `time` is Unix milliseconds; `bytes` is lowercase hex; a reference is
  its row's id string. Numbers: see below.
- Uploads: `POST /assets` with the file's bytes as the raw body (not JSON, not multipart; the
  server sniffs JPEG, PNG, WebP or MP4 and ignores `Content-Type`), as the uploader, answers
  `{asset: {id, type, bytes, width, height, duration}}`, or `{denied}`: `E_ASSET_TYPE` (other
  bytes), `E_ASSET_TOO_LARGE`, 400 for an empty body, 401 `E_AUTH`, 413 past 64 MiB. Pass the
  asset to a mutation's `image`/`video`/`file` argument as `{"id": "<asset id>"}`; `GET /assets/<id>`
  returns the bytes to a viewer the row's read rule admits, else 404 `E_ASSET_UNKNOWN`.
  `curl -X POST $U/assets -H 'x-snapback-persona: alice' --data-binary @receipt.png`
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

- `/seed` with a JSON array `[{"table":"t","row":{"id":"..",..}}, ..]` writes
  every row as the system in one commit, rules bypassed (types, constraints,
  caps and sync still apply), and answers `{seeded: N}`; anything else is 400
  E_INPUT, and a row the engine refuses answers 200 `{denied}` with nothing
  written. Rows are written like inserts: omitted columns take their
  `default` (`now` is the dev clock), sequence columns are assigned and must be
  omitted (E_SEQUENCE_SUPPLIED), and the `$`-prefixed fields `snapback4 data`
  prints are recorded by the engine itself: drop them before seeding. It is an upsert by `id`: every row
  names its own (any unique string; `idFrom(label)` gives a stable one), a
  reseed updates the mutable columns of an existing row, and a different value
  for an `immutable` column refuses E_CONSTRAINT ("… is immutable; /seed is an
  upsert by id …"): keep the original value, use a new id, `POST /dev/reset`
  first, or restart dev with `--memory`. A principal field holds `"dev:alice"`,
  not `"alice"`.
- `/dev/reset` empties the store for the next test, in one transaction: every
  application row, view and maintained column, the sync log, the effect, job
  and action queues, uploaded assets, and accounts with their sessions
  (signed-up users, guests). The adopted schema, personas and service seats
  (`snapback4 token`, the dev worker's) stay. The store takes a new identity:
  a local client re-acquires the new store by itself, an online client halts
  with `E_STORE_REPLACED` (`createApp` reopens it). The head keeps counting.
  The body is empty, a `/seed` array, or `{"seed": [..], "clock": "reset"}`
  (either key optional): seed rows are written as `/seed` writes them, in the
  same transaction (a refused row resets nothing), and `"clock": "reset"`
  drops `--clock-offset` and every advance (by default the dev clock stays).
  It answers `{reset: true, seeded: N, generation, storeId, previousStoreId,
  head, now, clockOffsetMs, ms}` in a few milliseconds on a small store;
  `snapback4 reset [--port N] [--seed fixtures] [--clock reset]` posts it.
- `/dev/clock/advance` with `{"duration":"+2m"}` moves the dev clock, sweeps
  expiry, fires due schedules and runs queued jobs (`snapback4 clock advance 2m`).
- `/dev/jobs/<job>` with `{"args":{..}}` runs one job now and answers its run.
- GET `/dev/status` (no credential) is the readiness probe: it names the
  server's `pid`, `project`, whether the store is `temporary`, the served
  generation, the dev clock and the declared personas.
- `snapback4 run <op> --as bob` beside a running dev forwards to these routes.

## Refusals

| HTTP | Meaning / body |
|---|---|
| 200 | Operation success, or decoded application refusal (`denied` / `state:"failed", why`); inspect the body |
| 202 | An admitted asynchronous action is still running |
| 400 | Malformed JSON/wire arguments or wrong operation door, `denied` |
| 401 | Missing/dead credential, production persona, failed login or disabled identity method, `denied` E_AUTH |
| 403 | Development door on serve, read-only token attempting a write, or supervised-worker refresh, `denied` |
| 404 | Unknown route/operation, or hidden/missing asset, `denied` |
| 413 | Request exceeds the body ceiling, `denied` |
| 429 | Identity rate limit or per-principal wait capacity; retry as directed |
| 500 | Internal store/response-metadata failure, `denied` |
| 503 | Retryable refusal, store/infrastructure failure or host capacity; retry as directed |

Authentication refuses before an operation executes. Identity helpers in the
JS client preserve the `denied` body on 401/403; do not replace it with a proxy
error page. Rule/constraint refusals after operation admission remain HTTP 200.
Identity scope/value validation can also return 200 denied/E_INPUT; inspect the body.
After a streaming heartbeat starts, HTTP stays 200; inspect the final JSON for
`denied` if the session expires while waiting.

Two layers answer differently. The HTTP layer decodes the request against the
operation's signature before anything runs: a body that is not JSON, an
argument of the wrong JSON type or shape (a fraction, a string for an `int`,
a number for `text`), or an argument the operation does not take is **400**
`{denied:{code:"E_INPUT"}}`. No or a dead credential (or an undeclared
persona) is **401** E_AUTH; an unknown operation or route is **404** E_OP, and
a declared one at the wrong door (a job or query at `/m/`, a mutation at
`/q/`) is **400** E_OP naming the right one; a body past its ceiling (1 MiB of JSON, 16 MiB for `/seed` and `/dev/reset`) is **413**. Once
decoded, the operation runs, and everything it refuses is **200**: a query
answers `{denied}`, a mutation `{state:"failed", why}`. That includes value
checks made while it runs — a missing required argument, text outside its
bounds, `''` for a `text 1..500` argument too (`why.code` E_INPUT) — rules (E_RULE), constraints
(E_CONSTRAINT), a delete that rows still reference (E_REFERENCED, naming the
referencing column), `NOT_FOUND`, the program's own `require … else CODE` (with
`why.site` and `why.rule`), and a reused write id (E_ID_REUSED). A retryable
refusal is 503 instead. So branch on the body, not only the status; for an
`add(body: text <=200)` mutation:

```sh
curl -s -w ' %{http_code}\n' -X POST $U/m/add -H 'x-snapback-persona: alice' -d '{"args":{"body":12.5}}'
# {"denied":{"code":"E_INPUT","message":"argument body: expected text …"}} 400
curl -s -w ' %{http_code}\n' -X POST $U/m/add -H 'x-snapback-persona: alice' -d '{"args":{"body":"'"$(printf 'x%.0s' {1..300})"'"}}'
# {"state":"failed","why":{"code":"E_INPUT","message":"E_INPUT: body is longer than 200 characters"}} 200
```

A refusal is `{code, family, message, site?, rule?, rewrite?, guide?}`, and
`snapback4 why <code>` explains one. `E_WRITE_ID_REUSE` is the JS client's own
local refusal for the same mistake, before anything is sent; the wire's code is
`E_ID_REUSED`.

## Uploads and downloads

`POST /assets` takes the raw bytes as the body and answers `{"asset":{id,type,bytes,…}}`
or `{denied}`; a mutation then places `{"id": …}` in its `image`, `video` or `file`
argument. An image or video is sniffed from its bytes. A document for a `file`
column adds `?as=file&name=<percent-encoded filename>` and declares its type,
which the server checks against the bytes (`guide assets`, "Files"):

```sh
curl -s -X POST "$U/assets?as=file&name=March%20receipt.pdf" -H 'x-snapback-persona: alice' -H 'Content-Type: application/pdf' --data-binary @receipt.pdf
# {"asset":{"id":"…","type":"application/pdf","bytes":48213,"name":"March receipt.pdf","width":null,"height":null,"duration":null}}
curl -s -OJ "$U/assets/<id>" -H 'x-snapback-persona: alice'   # Content-Disposition: attachment names the file
```

`GET /assets/<id>` is 404 E_ASSET_UNKNOWN when hidden or gone; a file always
arrives as an attachment, and `Range` works on ordinary assets.

The full reference, including the rest of `/auth`, worker and action
doors, and clock headers, is "The wire" in CLIENT-AND-OPERATIONS.md §5, which
ships in the package beside README.md.


## Device engine compatibility

A device sends `x-snapback-device` on `/schema`, every `/sync`, and every
`/changes`: JSON `{format:1,version:"0.4.24",capabilities:[...]}` from the
actual Rust engine, available before opening a store. Memory, SQLite, wasm
and Expo native report the same format; do not use the JS package version.
`device --engine-info`, wasm `engine_info()` and native `sb4_engine_info()`
expose it. Forward `engineInfo()` when wrapping a client device opener.

Every release writes `device-compatibility.json`; `/schema` returns its active
`device_compatibility:{server_version,minimum_version,capabilities}`.
The initial floor is 0.4.24. Required capabilities include
`sync-generation-v1` and the active public schema's capability set. A newer
version still needs every required capability.

After authentication, an incompatible device receives HTTP 409
`{denied:{code:"E_DEVICE_VERSION",family:"device-version",message,...}}`
before any sync body or backend is decoded. The message names the device
and server versions, missing capability, floor and rebuild commands:
Exact `bun exact.mjs snapback`, Expo `npx expo run:ios`, web reinstall the
server's `snapback4` version and rebuild. Unstamped devices have unknown
version. `/sync` requires the handshake; a bare online/one-shot `/changes`
or `/schema` caller has no replica and needs none.

The local JS client exports `DeviceVersionError` with
`status:{state:"incompatible",why}` at startup. A running client exposes
`deviceVersion()` and `onDeviceVersion(status)`. An incompatible sync stops
replication with a typed refusal and preserves queued writes for the rebuilt
device. Its reads are denied, rather than pretending it is an offline link.

Optimized wasm carries one `snapback4.engine` custom section with UTF-8
engine JSON. Native's stamp is returned by the binary, not a sidecar. `check`
and `doctor` inspect mounted Exact apps (`app.json`'s
`typescript.sources.backend` points to this backend's `snapback/generated`,
plus `assets/snapback4.wasm`) before UI testing. Missing or incompatible
stamps require a rebuild. Exact builds copy the stamped artifact intact and use this format in their
build/test preflight.
