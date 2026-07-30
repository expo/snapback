# `@snapback/client`

Framework-neutral Snapback app-data client.

Exports:

- `@snapback/client` — `SnapbackClient`, auth/custody helpers, and compatibility
  re-exports for the external store;
- `@snapback/client/app-data` — `SnapbackAppDataClient`, the app-data-only
  façade for the LLP 0062 app-CLI engine: the query/mutation/action/live/
  ephemeral call paths, sessions flow, and agent-fence integration of the full
  client, with no admin methods and no ambient `SNAPBACK_ADMIN_TOKEN` pickup,
  plus `fetchPublicArtifact`, the bare credential-free non-redirecting fetch
  for public artifact routes with identity-encoding enforcement;
- `@snapback/client/hosted-browser` — the hosted app-browser constructor,
  structurally limited to coordinator-owned, sender-constrained session
  custody;
- `@snapback/client/online` — the same `SnapbackClient` class plus
  `createExternalSessionClient` and `bindSnapbackAppLifecycle` through a narrow
  browser entry that does not retain optional package exports;
- `@snapback/client/agent-authority` — scoped agent-authority custody;
- `@snapback/client/external-store` —
  `snapback.external-store.v1`, canonical query identity, provider-scoped
  same-key store sharing, immutable snapshots, optimistic settlement,
  lifecycle fencing, and `ExternalQueryScope` for framework-free hosts.

Run the complete package-owned tests from the repository root:

```sh
bun run --cwd packages/snapback-client test
```

The external store owns UI lifecycle above a provider subscription; it is not
a second network transport or durable local-first cache. Providers retain
ownership of generated function references, `liveQuery`, authorization, and
connection semantics. Optimistic mutations may supply `isAuthoritative` to
correlate a live row set with the pending mutation; that closes the valid race
where the query update arrives before the mutation response. See
`guide/clients/headless.md` and
`guide/clients/react.md` for the supported composition.

## Externally brokered sessions

When a trusted server-side identity broker has already minted a Snapback
session, adopt its bearer with the explicit protocol-client constructor:

```js
import { createExternalSessionClient } from '@snapback/client/online';

const client = createExternalSessionClient('http://127.0.0.1:5173', {
  bearerToken: session.bearer,
});
```

The constructor offers the exact auth-client, invalidation, and authority
descriptor protocols. It is ordinary bearer custody, not browser
sender-constraint, and does not make hosted auth production-ready. See
`guide/auth/native-apps.md`.

For mobile hosts, bind the platform lifecycle to a live-query handle:

```js
import { bindSnapbackAppLifecycle } from '@snapback/client/online';

const binding = bindSnapbackAppLifecycle(AppState, liveHandle);
// Later:
binding.dispose();
```

The binding serializes `pause()` and `resume()`. The transport's application
heartbeat handles silent socket failure while active; lifecycle signals handle
OS suspension and foreground re-entry.

## Hosted browser custody

Use the dedicated entrypoint for an app served by a target that has passed the
complete hosted-auth admission profile:

```js
import { HostedBrowserSnapbackClient } from '@snapback/client/hosted-browser';
import { AuthCoordinator } from '@snapback/contract/auth-coordinator';
import { createIndexedDbAuthCustodyStorage } from '@snapback/contract/auth-custody-indexeddb';

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
