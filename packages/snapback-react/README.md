# `@snapback/react`

First-class React bindings for `@snapback/client/external-store`.

The package exports:

- `useSnapbackQuery(options)` — generated-query rows, status, connection,
  structured error, optimistic/authoritative mutation state, and `mutate`;
- `useExternalQueryStore(store)` — the thin `useSyncExternalStore` projection;
- `SNAPBACK_EXTERNAL_STORE_PROTOCOL` — the exact
  `snapback.external-store.v1` compatibility token.

Same-key sibling components over one provider share a logical store and
upstream attempt while retaining independent React subscriptions. Argument or
authority changes select a distinct store; Strict Mode replay, late handles,
and final unmount disposal are package-owned behavior.

Run its package suite from the repository root:

```sh
bun run --cwd packages/snapback-react test
```

The React Native/Expo projection is Online-only unless a separate profile
proves local execution and the remaining Parity obligations. See
`guide/clients/react.md`, `guide/clients/react-expo.md`, and LLP 0064.
