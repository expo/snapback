pub const CARD: &str = r##"# Actions: a worker answers a client request

```quarry
action invite(email: text <=200)                  -- any signed-in principal
action refreshModel() <- viewer = 'service:ranker'
action paused() <- deny
```

No Quarry body: the application's TypeScript worker performs the action.
Arguments are typed like a mutation's; the result is `unknown` in generated
`Action<A, R = unknown>`. An optional `<-` rule uses `allow`, `deny` or
comparisons of `viewer` with principal literals (`and`, `or`, `not`);
it cannot read tables or arguments. Actions always run on the server and
never predict. `client.act(api.invite, { email })` returns `Act`:
`done` with `id` and `result`, `failed` with `id` and `why`, or `pending`
with `id`. A refusal before admission is `{ denied, id }` (`E_OFFLINE`
when offline). This new card word needs the author's ruling.

```ts
import { createClient } from "snapback4/client";
import { runWorker, GiveUp } from "snapback4/worker";
runWorker({ url, token, effects: {}, actions: {
  invite: async (args: { email: string }, meta) => {
    const client = createClient({ url, session: meta.session });
    try { return await sendInvitation(args.email, meta.id, client); }
    finally { await client.close(); }
  },
} });
```

`meta.session` is for the REQUEST's principal, so reads and writes obey
the viewer's rules. It cannot refresh or use worker/auth-minting routes.
It expires with the lease (60 seconds by default) and is revoked on
settlement. Set `actionSessions: { invite: 120 }` and `lease: 120` for a
longer handler (maximum 900 seconds; the shorter duration wins).
`meta.id` is the idempotency key to send to providers. Delivery is at
least once: thrown errors retry after 2 seconds, doubling up to 5 minutes,
at most 8 attempts; `GiveUp` fails immediately. An expired lease requeues.
Only the handler names supplied to `runWorker` are claimed.

`POST /a/<name> { id, args }` under a live viewer session records the
request durably, once per id, then waits up to 25 seconds. A settled reply
is `{ state: "done", id, result }` or `{ state: "failed", id, why }`.
Otherwise HTTP 202 carries `{ state: "pending", id, why }`, with retryable
`E_ACTION_PENDING`. Repeat with the SAME id to collect the outcome
(`replayed: true`); `client.act(op, args, { id: previous.id })` does this.
`{ waitSeconds: 0 }` (`?wait=0` on the wire) only admits or collects;
the default is 25. A transport loss after submission also returns pending:
the server may already have accepted it. The SDK never queues an action.

Workers send a service bearer token to `POST /actions/claim { action?,
limit?, lease?, wait?, session? }`; durations are seconds. It long-polls
and returns `{ requests: [{ id, action, args, principal, session, attempt,
at }] }`. Settle via `POST /actions/<id>/done { result }` or
`/failed { error, retry }`, with the service bearer and the claim's
`session.token` in `x-snapback-action-lease`. That header fences an old
attempt even when its successor uses the same service token. Stale claims
get `E_ACTION_LEASE`; user tokens get HTTP 401 `E_AUTH`. Results are JSON
bounded by the unchanged 1 MiB output ceiling; they never become Quarry values.

`snapback4 dev` starts `snapback/worker.ts` (or `.mjs`) with Node 24,
`SNAPBACK_URL` and `SNAPBACK_SERVICE_TOKEN` for `service:worker`, printed
once. It restarts a crashed worker with backoff and stops it on dev exit.
`doctor` reports the worker file and counts queued/running/done/failed
requests. In production, supervise the worker as an ordinary Node process."##;
