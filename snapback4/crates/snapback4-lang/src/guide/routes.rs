// @ref LLP 3000.009#5.1 — declared routes verify authority before private durable handler admission.
pub const CARD: &str = r##"# Routes and webhooks

Routes require `use server` once in `schema.q`; it covers every module.

```quarry
use server
route exportReport: post "/reports/export" secrets [REPORT_KEY] wait 5s
route billing: post "/hooks/billing" as service:billing secrets [BILLING_KEY] retry 8 backoff 2s deadline 1h cancellation allow wait 5s
```

A declaration publishes one static POST path. Exporting a TypeScript function
does not publish it. Paths are absolute ASCII, at most 256 bytes, with nonempty
segments containing letters, digits, `_`, `-` or `.`. Empty and dot segments,
trailing slashes, escapes, captures, queries and core endpoint paths (including `/probe`) refuse
E_ROUTE_DECLARATION. `route name: post "/hooks/name"` is the minimal form.
There is no Quarry body, argument list, result declaration or `<-` rule.

The default route requires a live session and its handler runs as that caller;
a missing session answers HTTP 401. Provider routes refuse development personas
with HTTP 401, including loopback requests.
`as service:<seat>` declares a provider route whose verifier checks the provider
signature before any work is admitted. A seat has 1–64 letters, digits, `_` or
`-`. Both kinds may declare secrets. `secrets`, `retry`, `backoff`, `deadline`
and `cancellation` have the action meanings and defaults (guide actions).
`wait` defaults to 5s and accepts whole milliseconds or seconds from 1ms to
25s. Clauses can appear in any order, once each. Duplicate names, duplicate
paths, invalid bounds and reserved secret names refuse E_ROUTE_DECLARATION.

`check` and `dev` generate `Routes` and `server` in `snapback/generated/server.ts`.
Routes use flat qualified keys: `billing` in `hooks.q` is `"hooks.billing"`,
still at `/hooks/billing`. Module names never rewrite paths. Routes do not
appear in the client `api` or public action registry. A route and an action
may share a name because they have separate registries. Every declared route
needs a handler; undeclared names refuse. Actions and routes can each be omitted
only when none are declared; a supplied empty registry accepts no handlers.

```ts
import { server } from "./generated/server.ts";

// reports and billing are the application's provider adapters.
export default server({ routes: {
  async exportReport(req, ctx) {
    const bytes = await req.rawBody();
    return new Response(await reports.export(bytes, ctx), { status: 200 });
  },
  billing: {
    async verify(req, { secrets, signal }) {
      return billing.verify(await req.rawBody(), req.headers,
        secrets.BILLING_KEY, { signal });
    },
    async handle(req, ctx) {
      const bytes = await req.rawBody();
      await billing.apply(bytes, ctx);
      return new Response(null, { status: 204 });
    },
  },
} });
```

`RouteHandler<S>` receives `(req, ctx: ServerContext<S>)` and returns a
`Response` or `Promise<Response>`. `ServiceRoute<S>` requires both `verify`
and `handle`. The verifier receives only declared `secrets` and an abort
`signal`; it has no delegated database context. Return `false` for an invalid
signature: HTTP 403 with E_ROUTE_VERIFY, with no durable admission. An exception
or unavailable verifier answers 503 with E_ROUTE_PENDING; that response alone
does not prove admission. An expired or mismatched verifier claim refuses
E_ROUTE_LEASE. Verification should have no side effects. Every provider
retry verifies afresh, including retries collecting an already settled response.

`req.method` is `"POST"`, `req.path` is the declared path and `req.headers` is
the HTTP `Headers` view. `await req.rawBody()` returns a fresh `Uint8Array`
copy of the exact body bytes each time. Verify those bytes before decoding;
JSON key order, whitespace and encodings are not normalized. Bodies are bounded
at 64 KiB; request and response headers at 64 fields and 16 KiB. A malformed
envelope refuses E_ROUTE_INPUT. Transport-owned response headers are forbidden.
Verification sees all incoming fields. After authentication, Authorization,
Proxy-Authorization, Cookie and x-snapback-persona are removed before durable
storage and handler dispatch; the handler uses its bound `ctx.principal` and
database context. Other fields and body bytes are retained as work payloads.

After session authentication or provider verification, the core admits private
durable work keyed by the route and body digest. A duplicate delivery joins
that invocation; distinct body bytes are distinct deliveries. Route work cannot
expire its deduplication identity automatically. For new intent, include a
nonce or revision in the body; changed headers alone are not new intent. Work cannot
be invoked through the public action API (E_ROUTE_PRIVATE). The handler uses
the action context: ordinary rule-checked reads and writes, declared secrets,
durable `ctx.step`, and stable `ctx.writeIdFor` labels (guide actions).
Use provider event IDs and revisions in the application's mutation to handle
out-of-order events; body deduplication does not order distinct events.

The core returns the handler's recorded response if it settles within `wait`.
Otherwise HTTP 503 with E_ROUTE_PENDING asks the sender to retry the same
body. Work survives a disconnect or worker crash; a retry collects its settled
response under standing authority. Application `GiveUp` refusals are recorded
as E_ROUTE_REFUSED and acknowledged with a bare 204. Infrastructure failures
and handler responses with a 5xx status retry under the work policy; a 5xx is
never cached as a successful completion. A changed
route declaration refuses E_ROUTE_GENERATION; unavailable work or authority
refuses E_ROUTE_UNKNOWN. Inspect invocation metadata with `why <id>`.

Responses are buffered completions, not streaming receipts: a handler must
return a Response with status 200–599, at most 64 KiB of body and valid bounded
headers. Status 204, 205 or 304 cannot have a body. Invalid responses refuse
E_ROUTE_RESULT terminally, because external effects may already have happened.
`dev --bind 0.0.0.0 --i-understand-cleartext` explicitly opens a non-loopback
listener; default binding remains loopback. Use a trusted TLS proxy for provider
traffic. Only exact declared POST paths accept non-loopback requests; development
personas still cannot authenticate a remote request. An undeclared path gains
no access. This surface adds no SQL context or application SQL execution.

Generated handlers share a bounded registry poll loop, grouped by action-session
lifetime. Both it and the separate verifier loop rotate through at most 128
names per claim (at most 1s waits with multiple chunks). Verification and registry
claims have separate four-slot pools; 16 ingress waits and 32 legacy long polls
cannot consume them. A large idle registry does not need one poll per handler.
"##;
