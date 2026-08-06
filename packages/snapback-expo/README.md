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

E0 deliberately defines only the `SnapbackExpoEnvironmentV1` admission seam.
The supervised binding/session delivery used by `snapback dev --expo` belongs
to E1; release target selection and attestation verification belong to E3.
Neither the `AppBinding` nor the integration receipt carries session authority.
