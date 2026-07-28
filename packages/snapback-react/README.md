# `@snapback/react`

First-class Online React and React Native bindings over `@snapback/client`.

The package exports:

- `createSnapbackReactProvider` and `SnapbackProvider`;
- `useSnapbackQuery(ref, args)` and `useSnapbackQueries(entriesOrPreparedGroup)`;
- `useSnapbackMutation(ref, { optimistic })`;
- `useSnapbackPresence(ref, { scope, value, ttlMs })`;
- `useSnapbackConnection()`;
- framework-neutral `observeSnapbackQueries`, `observeSnapbackPresence`, and
  `invokeSnapbackMutation` acceptance/adapter seams; and
- `bindSnapbackAppLifecycle` for a React Native application-state owner.

Prepare a deployment-bound client before rendering:

```ts
const binding = await client.prepareReactBinding({
  generatedManifest: { schema, functions, capabilityManifest },
});
const provider = createSnapbackReactProvider(binding);
root.render(
  <SnapbackProvider provider={provider}>
    <App />
  </SnapbackProvider>,
);
```

Generated references supply exact argument and result types. Same-key sibling
queries share one authoritative external store and upstream attempt. Same-room
presence consumers share one headless room and managed heartbeat. Optimistic
layers rebase over newer live authority and selectively roll back on
rejection. Authority changes blank predecessor data; Strict Mode replay, late
handles, grants, socket demand, timers, and final disposal are package-owned.

For a generated route group, prime before mount and hand the prepared group to
both the provider and hook/observer:

```ts
const workspace = await binding.prepareQueryGroup(
  groups['/workspace/:incidentId'],
  { incidentId },
  { fallbackToLive: true },
);
const provider = createSnapbackReactProvider(binding, {
  preparedGroup: workspace,
});
```

A successful register-mode prime adopts every child from one LLP 0090 commit
cut without an ordinary prime/subscribe race. `workspace.boot` reports that
initial provenance. An explicit coded target fallback has `boot: null` and
uses ordinary live subscriptions; it makes no one-commit claim.

Managed presence is currently proven only for the local target. Hosted
bindings return `unsupported` before room or transport work. This package does
not add a React-specific cache, transport, credential carrier, offline queue,
or durable presence store.

Run its package suite from the repository root:

```sh
bun run --cwd packages/snapback-react test
```

The backend-bakeoff retains an exact ten-check React receipt at
`demos/backend-bakeoff/acceptance/results/react-presence.v1.json`. See
`guide/clients/react.md`, `guide/clients/react-expo.md`, LLP 0064, LLP 0102,
and LLP 0106.
