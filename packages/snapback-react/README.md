# `@expo/snapback-react`

First-class Online React and React Native bindings over `@expo/snapback-client`.
Install this package when a React application needs Snapback hooks and provider
ownership; install the headless client alone for non-React consumers. The full
build-matched documentation becomes available after the Snapback development
server is installed and running.

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
  developmentSync: {
    onStateChange(state) {
      renderBootMessage(state.message);
      if (state.status === 'timed-out') {
        renderDeveloperDetails(state.diagnostic, state.actions);
      }
    },
  },
});
const provider = createSnapbackReactProvider(binding);
root.render(
  <SnapbackProvider provider={provider}>
    <App />
  </SnapbackProvider>,
);
```

On the exact local-dev target in `dev` auth mode, a generated/deployed
mismatch automatically retries complete preparation for up to 10 seconds.
The callback is optional; use its product-facing message for the root loading
state and keep the diagnostic/actions behind developer details. Persistent
drift rejects with the stable `SNAPBACK_REACT_BINDING_MISMATCH` code and
concrete recovery actions. Hosted, sessions, unknown, and opted-out
(`developmentSync: false`) mismatches remain immediate loud refusals.

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
`demos/signal-desk/acceptance/results/react-presence.v1.json`. The governing
design is in LLP 0064, LLP 0114, and LLP 0107.

## Documentation outside a checkout

A running Snapback server serves the Guide compiled into that exact build.
These links use the first default development port; use the origin printed by
`snapback dev` or `snapback start` if yours differs.

- Read the [React client guide](http://127.0.0.1:4287/_snapback/guide/clients/react.md)
  for the provider and hook lifecycle.
- Read the [React and Expo client guide](http://127.0.0.1:4287/_snapback/guide/clients/react-expo.md)
  for React Native and Expo composition.
- Check the [capability index](http://127.0.0.1:4287/_snapback/guide/capabilities.md)
  before assuming a target or lifecycle is supported.
- Run `snapback guide` or `snapback guide <query>` to browse or search the
  embedded Guide.
- Run `snapback mcp` for the same build-bound corpus as read-only MCP
  resources, starting at `snapback-guide://manifest`.
