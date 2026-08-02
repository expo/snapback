import { SnapbackClient } from '@expo/snapback-client';
import {
  AuthCoordinator,
  createMemoryAuthCustodyStorage,
} from '@expo/snapback-contract';
import { createSnapbackReactProvider } from '@expo/snapback-react';
import functions from '../snapback/generated/functions.manifest.json';
import capabilityManifest from '../snapback/generated/capability.manifest.json';
import schema from '../snapback/generated/schema.manifest.json';

const snapbackBasePath = '/__snapback';
const coordinator = new AuthCoordinator({
  appId: 'file-drop',
  storage: createMemoryAuthCustodyStorage({ state: { custody: {} } }),
  broadcastChannelFactory: null,
  hintStorage: null,
});

export const client = new SnapbackClient(snapbackBasePath, {
  authCoordinator: coordinator,
  authInvalidationProtocol: 1,
  authorityDescriptorProtocol: 1,
  authorizedLeaseProtocol: 1,
  clientStoreId: 'snapdrop_web',
});

type SessionClient = {
  authRequestCode(email: string): Promise<{ challengeId: string }>;
  authExchange(input: { challengeId: string; code: string }): Promise<unknown>;
};
const sessionClient = client as unknown as SessionClient;
const challenge = await sessionClient.authRequestCode('snapdrop@example.com');
const mailboxResponse = await fetch(
  `/__snapmailbox?challengeId=${encodeURIComponent(challenge.challengeId)}`,
);
if (!mailboxResponse.ok) throw new Error('Snapdrop could not open its local demo mailbox.');
const mailbox = await mailboxResponse.json() as { code: string };
await sessionClient.authExchange({ challengeId: challenge.challengeId, code: mailbox.code });

const binding = await client.prepareReactBinding({
  generatedManifest: { schema, functions, capabilityManifest },
});

export const provider = createSnapbackReactProvider(binding);

export function publicPhotoUrl(assetId: string) {
  return `${snapbackBasePath}/assets/public/${encodeURIComponent(assetId)}/display`;
}
