import { SnapbackClient } from './index.mjs';
import {
  attachPushRegistry,
  type PushRegistryClient,
} from './push-registry.mjs';

const root = new SnapbackClient('http://127.0.0.1:3210');
// @ts-expect-error Push is additive and absent from the root client type.
root.push.registerToken({ token: 'ExponentPushToken[fixture]' });

const attached = attachPushRegistry(root, {
  pushInstallationStorage: {
    read: () => null,
    write: (_installationId) => {},
    clear: () => {},
  },
});
const checked: PushRegistryClient = attached;
void checked.push.registerToken({ token: 'ExponentPushToken[fixture]' });
