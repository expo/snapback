# `@expo/snapback-expo`

The Expo projection for a generated Snapback application. The common path is:

```tsx
import { SnapbackExpoProvider } from '@expo/snapback-expo';
import { app } from './snapback/generated/app';

export default function Root() {
  return <SnapbackExpoProvider app={app}>{/* routes */}</SnapbackExpoProvider>;
}
```

Add `"@expo/snapback-expo"` to `expo.plugins`. The plugin validates the
generated `snapback.app.v1` descriptor and package tuple, registers the
AppState lifecycle shell and the picker-URI asset adapter, and emits a public integration receipt under
`expo.extra.snapback.integrationReceipt`.

The provider registers the adapter once on the existing React/client owner.
Import `useSnapbackActivityPresence` from this facade for typing indicators and
similar intent-scoped presence. It gates foreground admission and adds
background withdrawal to the canonical React hook while sharing the provider's
exact AppState-compatible lifecycle source.

Pass an `expo-image-picker` asset directly to a generated command; the adapter
uses `expo/fetch` to read `content://`, `ph://`, or `file://` into an immutable,
slice-readable structural Blob source that the ordinary asset task already
accepts. Expo's `File` reader handles the narrow Android ImagePicker-cache
case where `expo/fetch` returns a genuine 404. The provider registers the same
WinterCG fetch implementation on the existing asset client for binary TUS
bodies:

```tsx
const picked = result.canceled ? null : result.assets[0];
if (picked) {
  const task = chat.commands.send({ body: 'From Expo', image: picked });
  const outcome = await task.done;
  // outcome.kind: committed | failed | ambiguous | cancelled
}
```

This live-process bridge is transient. It does not claim background upload,
restart recovery, offline source custody, or attempt-grant behavior.

In development, `snapback dev --expo` starts the backend and local Expo/Metro
arms. It injects only a credential-free, loopback rendezvous origin; the
default `SnapbackExpoEnvironmentV1` fetches the expiring supervised binding and
ordinary session from that transient exchange at runtime. No URL prop is
required. A project must already be settled in Sessions auth mode or boot
reports `authority-required` with the native mint refusal.

Release target selection and attestation verification belong to E3. Neither
the `AppBinding` nor the integration receipt carries session authority.

## Documentation outside a checkout

A running Snapback server serves the Guide compiled into that exact build.
These links use the first default development port; use the origin printed by
`snapback dev` or `snapback start` if yours differs.

- Read [the React and Expo client guide](http://127.0.0.1:4287/_snapback/guide/clients/react-expo.md).
- Check the [capability index](http://127.0.0.1:4287/_snapback/guide/capabilities.md).
- Run `snapback guide` or `snapback guide <query>` to browse or search the embedded Guide.
- Run `snapback mcp` for the same build-bound corpus as read-only MCP resources, starting at `snapback-guide://manifest`.
