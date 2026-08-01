// Party Wall — React surface bootstrap. Sessions-mode sign-in in a browser:
// the demo requests an email code and reads it back from the dev mailbox
// using VITE_SNAPBACK_ADMIN_TOKEN (a trusted-local convenience — there is no
// browser-safe sessions sign-in story for demos yet; diary 0041 finding 7).
// After sign-in, the full asset stack runs under real bearer custody: the
// prepared React binding, the asset client, and the LLP 0044 hooks.

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

// Workspace-relative imports, the shindig _kit idiom generalized to the
// real client packages.
// @ts-ignore untyped .mjs workspace module
import { SnapbackClient } from '../../../../../packages/snapback-client/index.mjs';
// @ts-ignore untyped .mjs workspace module
import { prepareReactBindingForClient } from '../../../../../packages/snapback-client/react-binding.mjs';
// @ts-ignore untyped .mjs workspace module
import { SnapbackAssetClient } from '../../../../../packages/snapback-client/assets.mjs';
// @ts-ignore untyped .mjs workspace module
import {
  AuthCoordinator,
  createMemoryAuthCustodyStorage,
  // @ts-ignore untyped .mjs workspace module
} from '../../../../../packages/snapback-contract/index.mjs';
// @ts-ignore untyped .mjs workspace module
import { SnapbackProvider, createSnapbackReactProvider } from '../../../../../packages/snapback-react/index.mjs';

import { App } from './App';

declare const __SNAPBACK_API_ORIGIN__: string;

const baseUrl = __SNAPBACK_API_ORIGIN__;
const adminToken = (import.meta as any).env?.VITE_SNAPBACK_ADMIN_TOKEN ?? null;

async function signIn(email: string) {
  const coordinator = new AuthCoordinator({
    appId: 'party-wall',
    storage: createMemoryAuthCustodyStorage({ state: { custody: {} } }),
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  const client = new SnapbackClient(baseUrl, {
    authCoordinator: coordinator,
    authInvalidationProtocol: 1,
    authorityDescriptorProtocol: 1,
    authorizedLeaseProtocol: 1,
    clientStoreId: `pw-web-${email.split('@')[0]}`,
  });
  const requested = await client.authRequestCode(email);
  if (!adminToken) {
    throw new Error(
      'Set VITE_SNAPBACK_ADMIN_TOKEN so the demo can read the dev mailbox (trusted-local only).',
    );
  }
  const mailbox = await fetch(
    `${baseUrl}/_snapback/api/auth/mailbox?challengeId=${encodeURIComponent(requested.challengeId)}`,
    { headers: { 'x-snapback-admin-token': adminToken } },
  ).then((r) => r.json());
  const credential = await client.authExchange({
    challengeId: requested.challengeId,
    code: mailbox.code,
  });
  const binding = await prepareReactBindingForClient(client);
  const provider = createSnapbackReactProvider(binding, {
    assets: new SnapbackAssetClient(client),
  });
  return { client, coordinator, credential, provider };
}

function Boot() {
  return <App signIn={signIn} baseUrl={baseUrl} SnapbackProvider={SnapbackProvider} />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Boot />
  </StrictMode>,
);
