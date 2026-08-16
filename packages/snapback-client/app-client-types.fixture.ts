import {
  createSnapbackAppClient,
  type ApplicationAuthBootstrapV1,
  type CurrentPrincipalSnapshot,
  type SnapbackAppBindingV1,
  type SnapbackApplicationDescriptorV1,
  type SnapbackClientOptions,
} from './index.mjs';

const devIdentityOptions = {
  devIdentityCapability: 'sbdev_fixture',
} satisfies SnapbackClientOptions;
void devIdentityOptions;

const manualOutboxDrainOptions = {
  outboxDrain: 'manual',
} satisfies SnapbackClientOptions;
void manualOutboxDrainOptions;

const embeddedLegacyAuthInvalidationOptOut = {
  authInvalidationProtocol: null,
} satisfies SnapbackClientOptions;
void embeddedLegacyAuthInvalidationOptOut;

const unsupportedAuthInvalidationVersion = {
  // @ts-expect-error the client implements and advertises only protocol v1.
  authInvalidationProtocol: 2,
} satisfies SnapbackClientOptions;
void unsupportedAuthInvalidationVersion;

const invalidOutboxDrainOptions = {
  // @ts-expect-error false is not a headless drain policy; use 'manual'.
  outboxDrain: false,
} satisfies SnapbackClientOptions;
void invalidOutboxDrainOptions;

const policy = {
  format: 'snapback.application-auth-bootstrap.v1',
  appId: 'app',
  mode: 'sessions',
  custody: 'volatile-explicit',
  entryMechanisms: ['password-v1'],
  anonymousPublic: 'refused',
  lifecycleProtocol: 1,
} as const satisfies ApplicationAuthBootstrapV1;

const app = {
  format: 'snapback.app.v1',
  identity: {
    app: 'app',
    schema: 'schema',
    functions: 'functions',
    descriptor: 'descriptor',
  },
  authBootstrap: policy,
} as const satisfies SnapbackApplicationDescriptorV1;

const binding = {
  format: 'snapback.app-binding.v1',
  source: 'supervised-dev',
  descriptorIdentity: 'descriptor',
  target: {
    app: 'app',
    schema: 'schema',
    functions: 'functions',
    origin: 'http://127.0.0.1:3000',
    routing: 'loopback',
  },
  capabilities: { offered: ['auth.application-bootstrap.v1', 'auth.passwords'] },
  provenance: {
    supervisorGeneration: 'supervisor-1',
    issuedAt: '2026-08-15T12:00:00.000Z',
    expiresAt: '2026-08-15T13:00:00.000Z',
  },
  integrity: { channel: 'local-supervised-ipc' },
} as const satisfies SnapbackAppBindingV1;

const hostedDevelopmentBinding = {
  format: 'snapback.app-binding.v1',
  source: 'hosted-development',
  descriptorIdentity: 'descriptor',
  target: {
    app: 'app',
    schema: 'schema',
    functions: 'functions',
    origin: 'https://hosted.example.test',
    routing: 'https',
  },
  capabilities: { offered: ['auth.application-bootstrap.v1', 'auth.passwords'] },
  provenance: { hostedTargetReceipt: 'sha256:hosted-target-receipt' },
  integrity: { channel: 'hosted-target-admission' },
} as const satisfies SnapbackAppBindingV1;
void hostedDevelopmentBinding;

async function fixture() {
  const appClient = await createSnapbackAppClient({ app, binding, platform: 'memory' });
  const principal: CurrentPrincipalSnapshot = appClient.auth.currentPrincipal();
  if (principal.status === 'authenticated') {
    principal.provider satisfies string | null;
  }
  void principal;
  const signup = await appClient.auth.signUpWithPassword({ email: 'a@b.c', password: 'password' });
  signup.recoveryCodes satisfies readonly string[];
  const signin = await appClient.auth.signInWithPassword({ email: 'a@b.c', password: 'password' });
  signin.session.userId satisfies string;
  const consumed = await appClient.auth.consumeRecoveryCode({
    email: 'a@b.c',
    code: 'AAAAA-BBBBB-CCCCC',
  });
  consumed.recoveryCodes satisfies readonly string[];
  const rotated = await appClient.auth.rotateRecoveryCodes();
  rotated.recoveryCodes satisfies readonly string[];
  const changed = await appClient.auth.changePassword({
    currentPassword: 'password',
    newPassword: 'new-password',
  });
  changed.authorityDescriptor.authorityInstanceId satisfies string;
  (await appClient.auth.signOut()) satisfies null;
  appClient.client.auth.authPasswordSignup satisfies typeof appClient.client.authPasswordSignup;
  const bootstrap = appClient.bootstrapState();
  if (bootstrap.status === 'ready') {
    bootstrap.advisories satisfies readonly unknown[];
  }
  await appClient.dispose();
}

void fixture;
