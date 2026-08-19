---
title: Route snapshot bundles
id: realtime.snapshot-bundles
order: 3
audience: agent-first
capabilities: [realtime.snapshot-bundles]
authorities: [llp/0090-resumable-query-snapshots.rfc.md, llp/0092-rqs-manifest-bundle-and-channel-a-contract.spec.md, llp/0157-composition-algebra-and-completeness.spec.md, llp/0166-local-persistent-store.spec.md, packages/snapback-client/index.mjs, packages/snapback-client/react-binding.mjs, packages/snapback-codegen/index.mjs, packages/snapback-codegen/authoring-validation.test.mjs, demos/public-dashboard/snapback/routes.mjs, demos/public-dashboard/tests/acceptance/headless.mjs, crates/snapback-activation/src/bundle.rs, crates/snapback-engine/src/local.rs]
examples: [demos/public-dashboard]
status: current
targets: [local, cloudflare]
maturity: partial
reviewed: 2026-08-08
reviewed-authorities-digest: sha256:6d5cd59fd7ab84930ebac769356d7cfed715e10fc0afcc055f529917d9d25cd7
---

# Route snapshot bundles

A snapshot bundle evaluates every query declared for one route at a single
commit cut. Use it to boot a deep-linked page without issuing unrelated query
requests that can observe different database versions. Eligible entries also
carry resumable-query tokens.

The local target supports read and authenticated register mode. The Cloudflare
target supports read-mode bundles and token resume; register mode remains
deferred there.

For a qualifying public authority-independent single-table live query, the
local target now uses the host-derived experimental `single_table_v1@1` class
and QMK identity. Existing legacy RQS entries do not change identity merely
because this class is active: LLP 0090 grandfathers them until a connected
prove-or-fresh adoption installs the QMK record and switches custody in one
atomic same-domain transaction. Adoption never relabels old bytes in place and
never drops pending outbox intent.

### Mix live and read-only children without losing the live siblings

On the contributor local target, a route containing at least one generated
`LiveQuery` and one generated `Query` receives a separate format-2 generated
group with profile `mixed-route.v2`. Preparing that group still evaluates
every child at one `commitVersion`. Only the `LiveQuery` children acquire
subscriptions; ordinary `Query` children return an explicit
`delivery.kind: "read-only"`, keep snapshot freshness, and never open a later
ordinary subscription.

The generated reference carries the LLP 0157 plan and per-child node hashes.
The server rebuilds them from the served manifests before execution. A query's
plan shape never makes it live: changing only its declaration from `Query` to
`LiveQuery` changes the identity-bound capability and therefore rotates the
node and group plan hashes.

Mixed responses are wire `formatVersion: 2`, repeat
`profile: "mixed-route.v2"` and `planHash`, and report a weakest aggregate of
`read-only`. This is intentionally separate from the existing all-live
format-1 group. Capability `mixed_bundle_boot_v2` is Experimental and local-
only; a target without it refuses mixed-group preparation because an ordinary
`Query` cannot honestly be upgraded into a live fallback.

## Declare the route and its query arguments

Routes are generated artifacts. Bind URL parameters through `routeParam`
instead of accepting an ad hoc query list from the caller:

```js source=demos/public-dashboard/snapback/routes.mjs
  {
    route: '/dashboards/:dashboardId',
    queries: [
      {
        function: 'dashboardMetrics',
        args: { dashboardId: routeParam('dashboardId') },
      },
    ],
  },
```

For anonymous Channel A boot, the query must explicitly declare all three
disclosure facts. None is inferred from the route:

```js source=demos/public-dashboard/snapback/functions.mjs
export const dashboardMetrics = defineLiveQuery({
  table: 'metrics',
  args: { dashboardId: v.string() },
  filter: [eq('dashboardId', arg('dashboardId'))],
  order: [asc('label')],
  index: 'by_dashboard',
  auth: 'public',
  authorityIndependent: true,
  publicInline: true,
});
```

Codegen emits `routes.manifest.json`; provision it beside schema and functions
with `ensureApp({ routes })`. A route may name several queries, but every
argument must be a literal or a declared route-parameter binding.

This example works on contributor-source builds and, since
`@expo/snapback-*@0.1.11`, on published packages carrying the packaged-store
qualification receipt — see [offline retention](../sync/offline-and-retention.md).

<!-- since: 0.1.16 -->

## Bind route parameters inside structured query arguments

A `routeParam()` may sit at any object-reachable leaf of a query argument.
Keep the surrounding context literal: objects may recursively contain `null`,
literal-union values, arrays of literal values, and finite-number vector
literals. Public Dashboard binds the URL id inside `context` while carrying a
nullable cursor, sort direction, and tags beside it:

```js source=demos/public-dashboard/snapback/routes.mjs
  {
    route: '/context-dashboards/:dashboardId',
    queries: [
      {
        function: 'dashboardMetricsByContext',
        args: {
          context: {
            dashboardId: routeParam('dashboardId'),
            cursor: null,
            sort: 'asc',
            tags: ['current', 'critical'],
          },
        },
      },
    ],
  },
```

The query validator remains the authority for the whole structure. Codegen
checks every literal member against it and confirms that the nested binding
lands on a scalar string-, number-, or boolean-compatible leaf. At runtime the
bound value preserves that scalar type; it is not flattened or merged by a
handler.

Some shapes deliberately refuse generation:

- A bare `routeParam()` as the whole `args` root has no declared argument key.
- A reference inside an array, or a reference object mixed with sibling keys,
  is ambiguous and refuses. Arrays are literal context only.
- A non-string `$param`, defaults, transforms, optional route parameters, and
  tuple-style argument invention are outside this surface.
- Register and mixed-route groups require every reference at every depth to
  target a string-typed leaf. A number- or boolean-typed binding remains valid
  for read-mode argument lowering but makes that group ineligible.

Targets with an older routes-manifest validator fail closed on the structured
shape. Do not flatten the object or add a server-side merge to work around
version skew; align the codegen and runtime closure instead.

## Fetch one consistent page snapshot

Read mode is socketless and does not create live demand:

```js source=demos/public-dashboard/tests/acceptance/headless.mjs
    bundle = await app.client.fetchBundle({
      route: '/dashboards/:dashboardId',
      params: { dashboardId: 'ops' },
      mode: 'read',
    });
    assertEqual(bundle.entries.length, 1, 'bundle entry count');
    assertEqual(bundle.entries[0].rows.map(({ label }) => label), ['latency_ms', 'uptime_pct'], 'ops rows');
    assert(typeof bundle.entries[0].resume?.token === 'string', 'resume token missing');
```

The response has one shared `commitVersion` and one entry per declared query.
Each entry contains rows and either a verified resume object or `null`,
according to that query's resumable-query eligibility. An undeclared route is
refused with `SNAPBACK_BUNDLE_ROUTE_UNKNOWN`.

## Arm live demand at the same cut

Authenticated local clients may use `mode: 'register'`. The response then
includes a connection grant and live registration for each entry at the same
commit cut. Pass each returned registration to `liveQuery` as
`registeredSubscription`; the client adopts the bundle-owned subscription
without taking a duplicate snapshot.

Anonymous register mode is refused. Retry it in read mode only when a
socketless public snapshot is acceptable. Register mode on Cloudflare is not
currently claimed.

## Anti-patterns

- Do not send a caller-chosen list of function names to `/app/bundle`.
- Do not mark an authenticated or authority-dependent query `publicInline`.
- Do not compare entry versions as though independently fetched queries share
  a commit; use the bundle's `commitVersion`.
- Do not open a second live subscription after register mode; adopt the
  returned registration.
- Do not treat a resume token as application data or decode it.
