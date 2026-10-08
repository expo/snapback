# Wire: HTTP for curl, scripts and non-JS clients

Under the JS client is plain JSON over HTTP, which curl, Python, Swift or any HTTP client can speak. Each call below is a POST with a JSON body unless it says GET.

```sh
U=http://127.0.0.1:4400
curl -s -X POST $U/q/mine -H 'x-snapback-persona: alice' -H 'Content-Type: application/json' -d '{"args":{}}'
curl -s -X POST $U/m/add -H 'x-snapback-persona: alice' -H 'Content-Type: application/json' -d '{"args":{"body":"hi"}}'
```

`snapback4 dev` serves on that address (choose another with `--port N`; the
first stdout line is the URL). The JS client (`snapback4/client`) stays the
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
- Values: `time` is Unix milliseconds; `money` and `decimal S` travel as integers
  in minor units (12.50 at scale 2 is `1250`, never `12.5`); `bytes` is lowercase
  hex; a reference is its row's id string.
- A job is not a client call (E_OP): a schedule fires it, and in dev
  `/dev/jobs/<job>` or `snapback4 run <job>` runs one.
- GET `/changes?since=<seq>&wait=25` long-polls. It answers `{seq, tables,
  generation, store_id}` when a commit lands or after `wait` seconds: re-query
  what reads those tables, then poll again from the new `seq`. `/sync` is the
  device replication protocol; use the client rather than reimplementing it.

## Development doors

Dev only, same machine; `serve` refuses each one.

- `/seed` with `[{"table":"t","row":{"id":"..",..}}]` writes rows as the system,
  rules bypassed, and answers `{seeded: N}`. It is an upsert by id, so every row
  names a 26-character id (`guide personas`).
- `/dev/clock/advance` with `{"duration":"+2m"}` moves the dev clock, sweeps
  expiry, fires due schedules and runs queued jobs (`snapback4 clock advance 2m`).
- `/dev/jobs/<job>` with `{"args":{..}}` runs one job now and answers its run.
- GET `/dev/status` names the served generation, the dev clock and the personas.
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
