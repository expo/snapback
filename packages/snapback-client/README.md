# `@expo/snapback-client`

Framework-neutral Snapback app-data client. Install this package when a
JavaScript application needs the headless query, mutation, live-data, auth,
or local-retention surface; use `@expo/snapback-react` for React bindings.
The full build-matched documentation becomes available after the Snapback
development server is installed and running.

## Declared-development operation episodes

`createSnapbackAppClient({ app, url, platform })` shares identity verification
only while a managed live socket is observably open. Before the socket opens,
after it drops, and for an HTTP-only client, every outbound transport-bearing
operation receives its own identity preflight automatically. `streamless:
true` forces that stronger cadence even while another consumer keeps a live
socket open. Composite and concurrent operation phases never inherit an
unrelated verification slot.

`@expo/snapback-client/internal/declared-dev-mint` is not public API. It is an
explicit generated-code seam used only by Snapback codegen to install the
library-minted capability on the exact generated `app` object. Applications
and providers pass that `app`; direct capability options are refused.

Exports:

- `@expo/snapback-client` — `SnapbackClient`, auth/custody helpers, and compatibility
  re-exports for the external store;
- `@expo/snapback-client/app-data` — `SnapbackAppDataClient`, the app-data-only
  façade for the LLP 0062 app-CLI engine: the query/mutation/action/live/
  ephemeral call paths, sessions flow, and agent-fence integration of the full
  client, with no admin methods and no ambient `SNAPBACK_ADMIN_TOKEN` pickup,
  plus `fetchPublicArtifact`, the bare credential-free non-redirecting fetch
  for public artifact routes with identity-encoding enforcement;
- `@expo/snapback-client/hosted-browser` — the hosted app-browser constructor,
  structurally limited to coordinator-owned, sender-constrained session
  custody;
- `@expo/snapback-client/online` — the same `SnapbackClient` class plus
  `createExternalSessionClient` and `bindSnapbackAppLifecycle` through a narrow
  browser entry that does not retain optional package exports;
- `@expo/snapback-client/agent-authority` — scoped agent-authority custody;
- `@expo/snapback-client/rqs-preload` — the lightweight Channel A/D4 boot
  registry; mixed-route artifact validation is intentionally absent;
- `@expo/snapback-client/rqs-registered` — the opt-in mixed-route v2
  registered-boot validator and registry;
- `@expo/snapback-client/external-store` —
  `snapback.external-store.v1`, canonical query identity, provider-scoped
  same-key store sharing, immutable snapshots, optimistic settlement,
  lifecycle fencing, and `ExternalQueryScope` for framework-free hosts.

Run the complete package-owned tests from the repository root:

```sh
bun run --cwd packages/snapback-client test
```

## Durable programmatic query registration

`client.registerQuery(generatedLiveQuery, options)` is the durable successor
to using a mounted query's `persistResume` option as a retention stand-in.
`options.registrationId` is a required stable, store-scoped application
identity; optional fields are `args`, `userId`, `label`, `requestedScope`,
`retentionRequest`, and `idleTtlClass`. The client derives the qmk1 address and
current authority partition, and qualified non-writer contexts forward the
commit to the store writer. The promise resolves the exact
`RegisterOutcomeV1` envelope (`committed` or a stable `refused` code).

Release with `client.releaseQueryRegistration(registrationId, { userId })`.
Release is idempotent and returns the same envelope with a `released` outcome.
Applications never author a materialization address or authority-partition
digest.

## Owner-gated retained-result transforms

Import the closed evaluator surface from
`@expo/snapback-client/result-transform`. Applications normally invoke it
through `client.evaluateLocalResultTransform(generatedReference, options)`,
which reads proof-verified retained bytes for that exact qmk1 address. The
server retention owner must have reclassified the plan as
`result-transform-snapshot-v1`; unreclassified plans and nonclaiming carriers
keep the `SNAPBACK_LOCAL_EVALUATION_UNADMITTED` floor.

The external store owns UI lifecycle above a provider subscription; it is not
a second network transport or durable local-first cache. Providers retain
ownership of generated function references, `liveQuery`, authorization, and
connection semantics. Optimistic mutations may supply `isAuthoritative` to
correlate a live row set with the pending mutation; that closes the valid race
where the query update arrives before the mutation response. See the served
[headless client](http://127.0.0.1:4287/_snapback/guide/clients/headless.md)
and [React client](http://127.0.0.1:4287/_snapback/guide/clients/react.md)
Guide pages for the supported composition, or read the same build-bound pages
through `snapback mcp`.

## Externally brokered sessions

When a trusted server-side identity broker has already minted a Snapback
session, adopt its bearer with the explicit protocol-client constructor:

```js
import { createExternalSessionClient } from '@expo/snapback-client/online';

const client = createExternalSessionClient('http://127.0.0.1:5173', {
  bearerToken: session.bearer,
});
```

The constructor offers the exact auth-client, invalidation, and authority
descriptor protocols. It is ordinary bearer custody, not browser
sender-constraint, and does not make hosted auth production-ready. See the
served [native app authentication](http://127.0.0.1:4287/_snapback/guide/auth/native-apps.md)
Guide page for the complete session flow; it is also available through
`snapback mcp`.

The `agent-authority` credential mode only adopts an already-issued token;
there is no user-reachable agent-registration or initial `sbac_` issuance route
today, and those credentials currently come from harness/test-lane provisioning.

For mobile hosts, bind the platform lifecycle to a live-query handle:

```js
import { bindSnapbackAppLifecycle } from '@expo/snapback-client/online';

const binding = bindSnapbackAppLifecycle(AppState, liveHandle);
// Later:
binding.dispose();
```

The binding serializes `pause()` and `resume()`. The transport's application
heartbeat handles silent socket failure while active; lifecycle signals handle
OS suspension and foreground re-entry.

## Authorization-invalidation advertisement

`SnapbackClient` advertises authorization-invalidation protocol v1 by default.
The library owns the complete protocol: auth-scoped live rows are quarantined,
replaced, or terminally deleted before acknowledgement, and authority changes
blank the prior principal's materializations without application callbacks.

An embedded integration that intentionally targets a legacy server can opt out
with `new SnapbackClient(origin, { authInvalidationProtocol: null })`. This is a
compatibility escape hatch, not a degraded security mode: a sessions server
will refuse auth-scoped live work while the advertisement is disabled.

## Hosted browser custody

Use the dedicated entrypoint for an app served by a target that has passed the
complete hosted-auth admission profile:

```js
import { HostedBrowserSnapbackClient } from '@expo/snapback-client/hosted-browser';
import { AuthCoordinator } from '@expo/snapback-contract/auth-coordinator';
import { createIndexedDbAuthCustodyStorage } from '@expo/snapback-contract/auth-custody-indexeddb';

const authCoordinator = new AuthCoordinator({
  appId: 'example-app',
  storage: createIndexedDbAuthCustodyStorage({ databaseName: 'example-app-auth' }),
});
const client = new HostedBrowserSnapbackClient('https://app.example.test', {
  authCoordinator,
});
```

This constructor accepts only a canonical HTTPS origin and has no bearer,
admin-token, or agent-authority option. It generates and stores a
non-extractable P-256 key through the coordinator, sender-constrains protected
HTTP and WebSocket requests, and rotates the bearer plus server nonce under one
custody-generation fence.

The entrypoint's existence is not a hosted capability claim. No current
Snapback target has passed the complete production adapter drill, so ordinary
applications must not substitute the generic `SnapbackClient` direct-bearer
seam and call the result hosted auth.

## Documentation outside a checkout

A running Snapback server serves the Guide compiled into that exact build.
These links use the first default development port; use the origin printed by
`snapback dev` or `snapback start` if yours differs.

- Read the [headless client guide](http://127.0.0.1:4287/_snapback/guide/clients/headless.md)
  for client construction, auth, live data, and retention boundaries.
- Read the [React client guide](http://127.0.0.1:4287/_snapback/guide/clients/react.md)
  before layering framework bindings over this package.
- Read first: [the start packets](http://127.0.0.1:4287/_snapback/guide/start/index.md)
  — the budgeted per-template first read (LLP 0259).
- Look up (do not linear-read) the [capability index](http://127.0.0.1:4287/_snapback/guide/capabilities.md)
  before assuming a target or custody mode is supported.
- Run `snapback guide` or `snapback guide <query>` to browse or search the
  embedded Guide.
- Run `snapback mcp` for the same build-bound corpus as read-only MCP
  resources, starting at `snapback-guide://manifest`.
