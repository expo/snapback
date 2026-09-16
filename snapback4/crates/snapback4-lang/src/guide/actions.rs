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
when offline).

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
longer handler (maximum 900 seconds; the shorter duration wins, also capped
by the admitting family's live session expiry).
Development clock advances extend held action leases and their viewer
sessions by the advanced duration, capped by the admitting family's expiry;
ordinary sessions keep their expiry.
`meta.id` is the idempotency key to send to providers. Delivery is at
least once: thrown errors retry after 2 seconds, doubling up to 5 minutes,
at most 8 attempts; `GiveUp` fails immediately. An expired lease requeues.
Only the handler names supplied to `runWorker` are claimed.

Admission records the session's family, principal generation and expiry.
Refresh keeps the family; a fresh sign-in starts another. Before a claim,
revoking that session, logout-all, principal revocation or expiry fails the
request terminally with `E_ACTION_AUTHORITY`: "the authority that admitted
this action was revoked or has expired". No delegated session is minted.
Service-session admissions have the same binding. Development personas and
legacy requests without a recorded binding retain their existing behavior.

`POST /a/<name> { id, args }` under a live viewer session records the
request durably, once per id, then waits up to 25 seconds. A settled reply
is `{ state: "done", id, result }` or `{ state: "failed", id, why }`.
Otherwise HTTP 202 carries `{ state: "pending", id, why }`, with retryable
`E_ACTION_PENDING`. Repeat with the SAME id to collect the outcome
(`replayed: true`); `client.act(op, args, { id: previous.id })` does this.
An id binds the operation and canonical JSON of raw wire arguments before
validation fills optional nulls (object keys are sorted). Changed arguments or another action refuse `E_ID_REUSED`;
use the original arguments or mint a new id. Another principal gets
`E_ACTION_UNKNOWN`. Mutation ids likewise bind the sent operation name and
canonical raw wire arguments; legacy mutation receipts without a binding replay.
Collecting a result also requires the original family to remain live and
its principal generation unchanged; otherwise `E_ACTION_UNKNOWN` returns
without the result, even after a fresh sign-in by the same principal.
Return protected content by managed row id so current read rules govern it.
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

`snapback4 dev` starts `snapback/worker.ts` (or `.mts` or `.mjs`) with Node 24,
`SNAPBACK_URL` and `SNAPBACK_SERVICE_TOKEN` for `service:worker`, printed
once. `dev --worker` is refused; use one of those conventional paths.
It restarts a crashed worker with backoff and stops it on dev exit.
`dev` still inherits its parent's environment; declared secrets arrive in A2.

`snapback4 serve <release-dir> --worker <path>` supervises that Node 24 entry
with the same restart backoff and shutdown. Its environment contains only
`PATH`, `HOME`, `TMPDIR`, `LANG`, `LC_ALL`, `TZ`, `NODE_OPTIONS` and the supplied
`SNAPBACK_URL` and `SNAPBACK_SERVICE_TOKEN`. The service:worker token is minted
for each child and never printed by serve. Each child session lasts at most
one day; the supervisor replaces the child within that window. Clean exits
revoke its family. Startup revokes the previous supervised child's family,
even after SIGKILL, without revoking manually issued service seats. The path is resolved from the
command's working directory; the child runs in the active release directory.
`doctor [--release dir]` reports worker starts, restarts and crashes and counts
queued/running/done/failed requests. `why <id> [--release dir]` describes an
action, mutation or effect, including bindings, attempts, settlement and
payload sizes/digests; `--values` also prints stored arguments and results.
Mutation arguments and results are not recorded; their binding keeps only
the operation name, argument digest and admission time beside the receipt."##;
