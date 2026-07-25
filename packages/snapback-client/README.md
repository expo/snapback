# `@snapback/client`

Framework-neutral Snapback app-data client.

Exports:

- `@snapback/client` — `SnapbackClient`, auth/custody helpers, and compatibility
  re-exports for the external store;
- `@snapback/client/online` — the same `SnapbackClient` class through a narrow
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
