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
AppState lifecycle shell, and emits a public integration receipt under
`expo.extra.snapback.integrationReceipt`.

In development, `snapback dev --expo` starts the backend and local Expo/Metro
arms. It injects only a credential-free, loopback rendezvous origin; the
default `SnapbackExpoEnvironmentV1` fetches the expiring supervised binding and
ordinary session from that transient exchange at runtime. No URL prop is
required. A project must already be settled in Sessions auth mode or boot
reports `authority-required` with the native mint refusal.

Release target selection and attestation verification belong to E3. Neither
the `AppBinding` nor the integration receipt carries session authority.
