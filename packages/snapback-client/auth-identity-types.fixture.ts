import {
  AuthCoordinator,
  createMemoryAuthCustodyStorage,
} from '@expo/snapback-contract/auth-coordinator';
import {
  SnapbackClient,
  type AuthorizationScopeV1,
  type AuthorityDescriptorV1,
  type PrincipalScopeV1,
} from './index.mjs';

const coordinator = new AuthCoordinator({
  appId: '018f0d90-7c10-7a22-8c33-445566778899',
  storage: createMemoryAuthCustodyStorage(),
});
const client = new SnapbackClient('http://127.0.0.1:5050', {
  authCoordinator: coordinator,
  authClientProtocol: 1,
  authorityDescriptorProtocol: 1,
});

async function askWhoIAm(client: SnapbackClient) {
  const scope = await client.currentAuthorizationScope();
  const signedIn = scope.principalScope.userId !== null;
  const userId = scope.principalScope.userId;
  const authMode = scope.principalScope.authMode;
  const descriptor = await client.currentAuthorityDescriptor();
  const session = await client.authSession();
  const mode = session.activeMode;
  const handshakeAuthenticated = session.authority.isAuthenticated;
  return { signedIn, userId, authMode, descriptor, mode, handshakeAuthenticated };
}

void askWhoIAm(client).then((identity) => {
  identity.signedIn.valueOf();
  identity.userId?.toUpperCase();
  identity.authMode.toUpperCase();
  identity.descriptor.authorityInstanceId.toUpperCase();
  identity.mode.toUpperCase();
  identity.handshakeAuthenticated.valueOf();
});

client.currentAuthorizationScope({ devUserId: 'dev-ada' }).then((scope) => {
  const principal: PrincipalScopeV1 = scope.principalScope;
  const descriptor: AuthorityDescriptorV1 = scope.authorityDescriptor;
  const authorization: AuthorizationScopeV1 = scope;
  void principal.userId;
  void descriptor.sessionGeneration;
  void authorization.queryAuthorization;
});

const unregister = client.registerAuthBarrierParticipant({
  name: 'auth-identity-fixture',
  blank() {},
});
void unregister().then(() => undefined);

client.clearAuthSession();
client.authTerminalStatus().terminated.valueOf();
const stopTerminal = client.subscribeAuthTerminal(() => undefined);
stopTerminal();
void client.authStepUpRequest({ operation: 'passwordSet' });
void client.authPasswordSet({
  newPassword: 'not-a-runtime-secret',
  stepUp: { challengeId: 'challenge', code: 'code' },
}).then((credential) => credential.recoveryCodes.length);

const external = new SnapbackClient('http://127.0.0.1:5050', {
  bearerToken: 'sbs_identity_fixture',
  authClientProtocol: 1,
});
external.setBearerToken('sbs_identity_fixture');
void external.replaceBearerToken(null);
void external.authRequestCode('ada@example.test');
void external.authLogout();
