import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { test } from 'node:test';

import { IDBFactory } from 'fake-indexeddb';
import {
  AuthCoordinator,
  createMemoryAuthCustodyStorage,
} from '@expo/snapback-contract/auth-coordinator';
import { createIndexedDbAuthCustodyStorage } from '@expo/snapback-contract/auth-custody-indexeddb';

import {
  DEFAULT_AUTH_STORAGE_PARTITION,
  createSnapbackAppClient,
} from './index.mjs';
import { createIndexedDbRqsResumeStore } from './rqs-store.mjs';
import {
  __adoptSupervisedBootstrapAuthority,
  __bootstrapHistoryForTests,
  __recordSupervisedBootstrapAdoptionForTests,
} from './app-client.mjs';
import * as publishedAppClientInternal from './app-client-internal.mjs';
import {
  admitHostedDevelopmentBindingForAppClient,
} from '../snapback-expo/app-binding-internal.mjs';

const APP_ID = '018f0d90-7c20-7a22-8c33-445566778899';
const INCARNATION = '018f0d90-7c21-7a22-8c33-445566778899';
const USER = '018f0d90-7c22-7a22-8c33-445566778899';
const PEER_USER = '018f0d90-7c23-7a22-8c33-445566778899';
const SESSION = '018f0d90-7c24-7a22-8c33-445566778899';
const PEER_SESSION = '018f0d90-7c25-7a22-8c33-445566778899';
const AUTHORITY = '018f0d90-7c26-7a22-8c33-445566778899';
const PEER_AUTHORITY = '018f0d90-7c27-7a22-8c33-445566778899';
const PASSWORD = 'app-client-password-must-not-leak';
const NEW_PASSWORD = 'app-client-new-password-must-not-leak';
const SUPERVISED_BEARER = 'sbs_app_client_supervised_secret';
const APPLICATION_BEARER = 'sbs_app_client_application_secret';
const ROTATED_BEARER = 'sbs_app_client_rotated_secret';
const PEER_BEARER = 'sbs_app_client_peer_secret';
const RECOVERY_CODES = Object.freeze(Array.from({ length: 8 }, (_, index) => (
  `sbrv1_${String(index).padStart(2, '0')}${'R'.repeat(25)}`
)));
const GENERATED_HOSTED_DEVELOPMENT_ADMISSION = Symbol.for(
  '@expo/snapback-client/generated-hosted-development-admission.v1',
);

const freezeRecursively = (value) => {
  if ((value === null || typeof value !== 'object') || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freezeRecursively(child);
  return Object.freeze(value);
};

function generatedHostedApp(app, generatedHostedTargets, verifyHostedTargetAdmission) {
  const hydratedApp = structuredClone(app);
  const evidence = freezeRecursively({
    format: 'snapback.generated-hosted-development-admission.v1',
    generatedHostedTargets: structuredClone(generatedHostedTargets),
    verifyHostedTargetAdmission,
  });
  Object.defineProperty(hydratedApp, GENERATED_HOSTED_DEVELOPMENT_ADMISSION, {
    value: evidence,
    enumerable: false,
  });
  return freezeRecursively(hydratedApp);
}

const availability = Object.freeze({
  onlineRequestResponse: { available: true, reason: null },
  authScopedLive: {
    available: false,
    minimumAuthInvalidationProtocol: 1,
    reason: 'SNAPBACK_AUTH_INVALIDATION_PROTOCOL_REQUIRED',
  },
  retainedReads: {
    available: false,
    minimumAuthInvalidationProtocol: 1,
    minimumAuthorizedLeaseProtocol: 1,
    reason: 'SNAPBACK_AUTH_RETAINED_READS_UNAVAILABLE',
  },
  queuedReplay: {
    available: true,
    minimumAuthorityDescriptorProtocol: 1,
    reason: null,
  },
});

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

class BroadcastHub {
  channels = new Map();
  closeCalls = 0;

  factory = (name) => {
    const channel = {
      name,
      onmessage: null,
      postMessage: (message) => {
        for (const peer of this.channels.get(name) ?? []) {
          if (peer !== channel) peer.onmessage?.({ data: structuredClone(message) });
        }
      },
      close: () => {
        if (!this.channels.get(name)?.delete(channel)) return;
        this.closeCalls += 1;
      },
    };
    if (!this.channels.has(name)) this.channels.set(name, new Set());
    this.channels.get(name).add(channel);
    return channel;
  };
}

function createSerialLockManager() {
  const tails = new Map();
  return {
    request(name, _options, operation) {
      const previous = tails.get(name) ?? Promise.resolve();
      const result = previous.catch(() => {}).then(operation);
      const tail = result.catch(() => {});
      tails.set(name, tail);
      return result.finally(() => {
        if (tails.get(name) === tail) tails.delete(name);
      });
    },
  };
}

async function waitFor(check, label, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      if (check()) return;
    } catch { /* a clearing projection is expected while a wakeup converges */ }
    if (Date.now() >= deadline) throw new Error(`${label} did not converge`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function replaceGlobal(name, value) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, {
    configurable: true,
    writable: true,
    value,
  });
  return () => {
    if (descriptor === undefined) delete globalThis[name];
    else Object.defineProperty(globalThis, name, descriptor);
  };
}

const isoFromNow = (offsetMs) => new Date(Date.now() + offsetMs).toISOString();

function makeApp({
  schema = 'sha256:schema-1',
  functions = 'sha256:functions-1',
  descriptor = 'sha256:descriptor-1',
  custody = 'volatile-explicit',
  anonymousPublic = 'refused',
  entryMechanisms = ['password-v1'],
} = {}) {
  return Object.freeze({
    format: 'snapback.app.v1',
    identity: Object.freeze({ app: APP_ID, schema, functions, descriptor }),
    authBootstrap: Object.freeze({
      format: 'snapback.application-auth-bootstrap.v1',
      appId: APP_ID,
      mode: 'sessions',
      custody,
      entryMechanisms: Object.freeze([...entryMechanisms]),
      anonymousPublic,
      lifecycleProtocol: 1,
    }),
  });
}

function makeBinding(app, {
  origin = 'http://127.0.0.1:4711',
  issuedAt = isoFromNow(-60_000),
  expiresAt = isoFromNow(60 * 60_000),
  supervisorGeneration = 'supervisor-generation-1',
} = {}) {
  return Object.freeze({
    format: 'snapback.app-binding.v1',
    source: 'supervised-dev',
    descriptorIdentity: app.identity.descriptor,
    target: Object.freeze({
      app: app.identity.app,
      schema: app.identity.schema,
      functions: app.identity.functions,
      origin,
      routing: 'loopback',
    }),
    capabilities: Object.freeze({
      offered: Object.freeze(['auth.application-bootstrap.v1', 'auth.passwords']),
    }),
    provenance: Object.freeze({ supervisorGeneration, issuedAt, expiresAt }),
    integrity: Object.freeze({ channel: 'local-supervised-ipc' }),
  });
}

function makeHostedDevelopmentBinding(app, {
  origin = 'https://hosted.example.test',
  hostedTargetReceipt = 'sha256:hosted-target-receipt',
} = {}) {
  return Object.freeze({
    format: 'snapback.app-binding.v1',
    source: 'hosted-development',
    descriptorIdentity: app.identity.descriptor,
    target: Object.freeze({
      app: app.identity.app,
      schema: app.identity.schema,
      functions: app.identity.functions,
      origin,
      routing: 'https',
    }),
    capabilities: Object.freeze({
      offered: Object.freeze(['auth.application-bootstrap.v1', 'auth.passwords']),
    }),
    provenance: Object.freeze({ hostedTargetReceipt }),
    integrity: Object.freeze({ channel: 'hosted-target-admission' }),
  });
}

let generatedHostedModuleSerial = 0;

async function importGeneratedHostedApp(app, binding, {
  generatedHostedTargets = [binding.target],
  admittedReceipt = binding.provenance.hostedTargetReceipt,
} = {}) {
  generatedHostedModuleSerial += 1;
  const source = `
const deepFreeze = (value) => { if (value && typeof value === 'object' && !Object.isFrozen(value)) { for (const child of Object.values(value)) deepFreeze(child); Object.freeze(value); } return value; };
const targetTuple = (target) => ['app', 'functions', 'origin', 'routing', 'schema'].map((key) => target?.[key]).join('\\u0000');
const generatedHostedTargets = deepFreeze(${JSON.stringify(generatedHostedTargets)});
export let verifierCalls = 0;
const verifyHostedTargetAdmission = (receipt, candidate) => { verifierCalls += 1; return receipt === ${JSON.stringify(admittedReceipt)} && generatedHostedTargets.some((target) => targetTuple(target) === targetTuple(candidate?.target)); };
const hydratedApp = ${JSON.stringify(app)};
Object.defineProperty(hydratedApp, Symbol.for('@expo/snapback-client/generated-hosted-development-admission.v1'), { value: Object.freeze({ format: 'snapback.generated-hosted-development-admission.v1', generatedHostedTargets, verifyHostedTargetAdmission }), enumerable: false });
export const app = deepFreeze(hydratedApp);
export default app;
`;
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}#${generatedHostedModuleSerial}`);
}

const deploymentIdentity = (appId) => Object.freeze({
  schemaVersion: 'snapback.v1',
  authMode: 'sessions',
  appId,
  schemaHash: `snapback.v1:sessions:schema:sha256:${'1'.repeat(64)}`,
  bundleHash: `snapback.v1:sessions:function:sha256:${'2'.repeat(64)}`,
  inputsHash: `snapback.v1:sessions:inputs:sha256:${'3'.repeat(64)}`,
});

function installServer({ relayBase = '' } = {}) {
  const originalFetch = globalThis.fetch;
  const priorRqsSetting = process.env.SNAPBACK_CLIENT_RQS_STORE;
  process.env.SNAPBACK_CLIENT_RQS_STORE = 'off';
  const requests = [];
  const handlers = new Map();
  const bearers = new Map();
  const registerBearer = (token, {
    userId = USER,
    sessionId = SESSION,
    authorityInstanceId = AUTHORITY,
  } = {}) => {
    bearers.set(token, { userId, sessionId, authorityInstanceId });
  };
  registerBearer(SUPERVISED_BEARER);
  registerBearer(APPLICATION_BEARER);
  registerBearer(ROTATED_BEARER);
  registerBearer(PEER_BEARER, {
    userId: PEER_USER,
    sessionId: PEER_SESSION,
    authorityInstanceId: PEER_AUTHORITY,
  });

  const handshake = (bearer, appId) => {
    const authenticated = bearers.get(bearer) ?? null;
    return {
      protocolVersion: 1,
      serverStartupNonce: 'app-client-test',
      authorizationStreamIncarnation: INCARNATION,
      transitionGeneration: 0,
      activeMode: 'sessions',
      desiredMode: 'sessions',
      modeState: 'settled',
      appDataAvailability: 'available',
      quarantineCode: null,
      clientProtocols: {
        authClient: 1,
        authInvalidation: null,
        authorityDescriptor: 1,
        authorizedLease: null,
      },
      availability,
      provider: { key: 'local-password', available: true },
      transports: ['bearer'],
      authority: authenticated === null
        ? { kind: 'anonymous', userId: null, sessionId: null, isAuthenticated: false }
        : {
            kind: 'humanSession',
            userId: authenticated.userId,
            sessionId: authenticated.sessionId,
            isAuthenticated: true,
          },
      authorityDescriptor: {
        descriptorVersion: 1,
        authorityInstanceId: authenticated?.authorityInstanceId ?? INCARNATION,
        sessionGeneration: authenticated === null ? 0 : 1,
      },
      deploymentIdentity: deploymentIdentity(appId),
      authorizedLease: null,
    };
  };

  const credential = ({
    token = APPLICATION_BEARER,
    codes = null,
    userId = USER,
    sessionId = SESSION,
    authorityInstanceId = AUTHORITY,
  } = {}) => {
    registerBearer(token, { userId, sessionId, authorityInstanceId });
    return {
      tokenType: 'Bearer',
      token,
      refreshAfter: Date.now() + 60_000,
      session: {
        id: sessionId,
        userId,
        provider: 'local-password',
        createdAt: Date.now(),
        expiresAt: Date.now() + 120_000,
        absoluteExpiresAt: Date.now() + 240_000,
      },
      authorityDescriptor: {
        descriptorVersion: 1,
        authorityInstanceId,
        sessionGeneration: 1,
      },
      ...(codes === null ? {} : { recoveryCodes: [...codes] }),
    };
  };

  globalThis.fetch = async (url, init = {}) => {
    const parsed = new URL(url, 'http://browser-app.example.test');
    const rawPath = parsed.pathname;
    const path = relayBase !== '' && rawPath.startsWith(`${relayBase}/`)
      ? rawPath.slice(relayBase.length)
      : rawPath;
    const headers = new Headers(init.headers);
    const authorization = headers.get('authorization');
    const bearer = authorization?.replace(/^Bearer /u, '') ?? null;
    const body = init.body === undefined ? undefined : JSON.parse(init.body);
    requests.push({
      path,
      rawPath,
      authorization,
      body,
      devIdentityCapability: headers.get('x-snapback-dev-identity'),
      origin: parsed.origin,
    });
    if (path === '/auth/session') {
      return Response.json(handshake(bearer, APP_ID));
    }
    const handler = handlers.get(path);
    if (!handler) throw new Error(`unexpected app-client request: ${path}`);
    return handler({ authorization, bearer, body });
  };

  return {
    requests,
    credential,
    respond(path, handler) { handlers.set(path, handler); },
    restore() {
      globalThis.fetch = originalFetch;
      if (priorRqsSetting === undefined) delete process.env.SNAPBACK_CLIENT_RQS_STORE;
      else process.env.SNAPBACK_CLIENT_RQS_STORE = priorRqsSetting;
    },
  };
}

const optionsFor = (app, binding = makeBinding(app), extra = {}) => ({
  app,
  binding,
  platform: { kind: 'memory', cryptoObject: webcrypto },
  ...extra,
});

test('framework-neutral bootstrap reaches ready through every starting stage and keeps secrets out', async () => {
  const server = installServer();
  const app = makeApp();
  const storagePartition = 'private-partition-must-not-leak';
  const appClient = await createSnapbackAppClient(optionsFor(app, makeBinding(app), {
    storagePartition,
  }));
  try {
    const history = __bootstrapHistoryForTests(appClient);
    assert.deepEqual(history.slice(0, 4).map((state) => (
      state.status === 'starting' ? state.stage : state.status
    )), ['binding', 'custody', 'authority', 'client']);
    const ready = appClient.bootstrapState();
    assert.equal(ready.status, 'ready');
    assert.equal(ready.authoritySource, 'fresh-anonymous');
    assert.equal(ready.custody.grade, 'volatile');
    assert.equal(ready.custody.carrier, 'memory');
    assert.match(ready.custody.storagePartitionIdentityHash, /^sha256:[0-9a-f]{64}$/u);
    assert.deepEqual(ready.advisories, []);
    assert.equal(DEFAULT_AUTH_STORAGE_PARTITION, 'default');
    assert.equal(appClient.auth.currentPrincipal().status, 'anonymous');

    server.respond('/auth/password/signup', ({ body }) => {
      assert.deepEqual(body, { email: 'person@example.com', password: PASSWORD });
      return Response.json(server.credential({ codes: RECOVERY_CODES }));
    });
    const result = await appClient.auth.signUpWithPassword({
      email: 'person@example.com',
      password: PASSWORD,
    });
    assert.deepEqual(result.recoveryCodes, RECOVERY_CODES);
    assert.equal(Object.hasOwn(result, 'token'), false);
    assert.equal(appClient.auth.currentPrincipal().status, 'authenticated');
    assert.equal(typeof appClient.client.auth.authPasswordSignup, 'function');
    const retained = JSON.stringify({
      bootstrap: appClient.bootstrapState(),
      principal: appClient.auth.currentPrincipal(),
      history: __bootstrapHistoryForTests(appClient),
    });
    for (const secret of [
      PASSWORD,
      APPLICATION_BEARER,
      storagePartition,
      ...RECOVERY_CODES,
    ]) {
      assert.equal(retained.includes(secret), false);
    }
  } finally {
    await appClient.dispose();
    server.restore();
  }
});

test('managed browser bindings admit the same-origin relay without exposing a backend origin', async () => {
  const server = installServer({ relayBase: '/__snapback' });
  const app = makeApp();
  const appClient = await createSnapbackAppClient(optionsFor(
    app,
    makeBinding(app, { origin: '/__snapback' }),
  ));
  try {
    assert.equal(appClient.bootstrapState().status, 'ready');
    assert.deepEqual(server.requests.map(({ rawPath }) => rawPath), [
      '/__snapback/auth/session',
    ]);
    assert.equal(server.requests[0].origin, 'http://browser-app.example.test');
  } finally {
    await appClient.dispose();
    server.restore();
  }
});

test('managed browser relay admission pins documented plain-segment prefixes', async () => {
  const app = makeApp();
  const rejectingServer = installServer();
  try {
    for (const origin of [
      '/_snapback',
      '/admin',
      '/@fs/etc/passwd',
      '/%2e%2e%2fadmin',
      '/__snapback%2f..%2fadmin',
      '/http://evil.com',
      '//evil.com',
      '/__snapback/',
      '/__snapback?next=/admin',
      '/__snapback#admin',
    ]) {
      const before = rejectingServer.requests.length;
      await assert.rejects(
        createSnapbackAppClient(optionsFor(app, makeBinding(app, { origin }))),
        (error) => error?.code === 'SNAPBACK_AUTH_BOOTSTRAP_BINDING_INVALID',
        `relay base ${origin} must refuse`,
      );
      assert.equal(
        rejectingServer.requests.length,
        before,
        `${origin} reached transport before refusal`,
      );
    }
  } finally {
    rejectingServer.restore();
  }

  for (const origin of ['/__snapback/v1', '/__exact/snapback', '/__exact/snapback/v1']) {
    const admittingServer = installServer({ relayBase: origin });
    try {
      const admitted = await createSnapbackAppClient(optionsFor(
        app,
        makeBinding(app, { origin }),
      ));
      assert.equal(admitted.bootstrapState().status, 'ready', `${origin} should be admitted`);
      await admitted.dispose();
    } finally {
      admittingServer.restore();
    }
  }
});

test('policy, binding, and durable-custody refusals happen before transport I/O', async () => {
  const server = installServer();
  try {
    const app = makeApp();
    const mismatched = makeBinding(app);
    const invalidBinding = {
      ...mismatched,
      target: { ...mismatched.target, schema: 'sha256:not-the-app-schema' },
    };
    await assert.rejects(
      createSnapbackAppClient(optionsFor(app, invalidBinding)),
      (error) => error?.code === 'SNAPBACK_AUTH_BOOTSTRAP_BINDING_INVALID',
    );
    const missingBootstrapCapability = {
      ...makeBinding(app),
      capabilities: { offered: ['auth.passwords'] },
    };
    await assert.rejects(
      createSnapbackAppClient(optionsFor(app, missingBootstrapCapability)),
      (error) => error?.code === 'SNAPBACK_AUTH_BOOTSTRAP_CAPABILITY_UNAVAILABLE'
        && error?.diagnostic?.details?.missingCapability === 'auth.application-bootstrap.v1',
    );
    await assert.rejects(
      createSnapbackAppClient({ ...optionsFor(app), bearerToken: 'must-not-be-admitted' }),
      (error) => error?.code === 'SNAPBACK_AUTH_BOOTSTRAP_INPUT_INVALID',
    );
    const expiredBinding = makeBinding(app, {
      issuedAt: isoFromNow(-120_000),
      expiresAt: isoFromNow(-60_000),
    });
    await assert.rejects(
      createSnapbackAppClient(optionsFor(app, expiredBinding)),
      (error) => error?.code === 'SNAPBACK_AUTH_BOOTSTRAP_BINDING_INVALID',
    );
    const durable = makeApp({ custody: 'durable-required' });
    await assert.rejects(
      createSnapbackAppClient(optionsFor(durable)),
      (error) => error?.code === 'SNAPBACK_AUTH_CUSTODY_DURABLE_UNAVAILABLE'
        && error?.bootstrapState?.status === 'unsupported',
    );
    assert.equal(server.requests.length, 0);

    const volatile = await createSnapbackAppClient(optionsFor(app));
    assert.equal(volatile.bootstrapState().custody.grade, 'volatile');
    assert.equal(server.requests.filter(({ path }) => path === '/auth/session').length, 1);
    await volatile.dispose();

    const withoutPasswords = makeApp({ entryMechanisms: [] });
    const noPasswordClient = await createSnapbackAppClient(optionsFor(withoutPasswords));
    const afterNoPasswordBoot = server.requests.length;
    await assert.rejects(
      noPasswordClient.auth.signInWithPassword({
        email: 'person@example.com',
        password: PASSWORD,
      }),
      (error) => error?.code === 'SNAPBACK_AUTH_BOOTSTRAP_MECHANISM_UNAVAILABLE',
    );
    await assert.rejects(
      noPasswordClient.auth.consumeRecoveryCode({
        email: 'person@example.com',
        code: RECOVERY_CODES[0],
      }),
      (error) => error?.code === 'SNAPBACK_AUTH_BOOTSTRAP_MECHANISM_UNAVAILABLE',
    );
    await assert.rejects(
      noPasswordClient.auth.rotateRecoveryCodes(),
      (error) => error?.code === 'SNAPBACK_AUTH_BOOTSTRAP_MECHANISM_UNAVAILABLE',
    );
    assert.equal(server.requests.length, afterNoPasswordBoot);
    await noPasswordClient.dispose();
  } finally {
    server.restore();
  }
});

test('auth-policy unavailability projects the canonical authority-required bootstrap state', async () => {
  const server = installServer();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const parsed = new URL(url);
    if (parsed.pathname === '/auth/session') {
      return Response.json({
        diagnostic: {
          schemaVersion: 'snapback.client-diagnostic.v1',
          code: 'SNAPBACK_AUTH_POLICY_UNAVAILABLE',
          message: 'Sessions policy is unavailable.',
          details: {},
        },
      }, { status: 409 });
    }
    return originalFetch(url, init);
  };
  try {
    await assert.rejects(
      createSnapbackAppClient(optionsFor(makeApp())),
      (error) => error?.bootstrapState?.status === 'authority-required'
        && error.bootstrapState.diagnostic.code === 'SNAPBACK_AUTH_POLICY_UNAVAILABLE',
    );
  } finally {
    server.restore();
  }
});

test('hosted-development raw bootstrap requires generated-module admission', async () => {
  const server = installServer();
  const app = makeApp();
  const binding = makeHostedDevelopmentBinding(app);
  const generatedModule = await importGeneratedHostedApp(app, binding);
  const admission = await admitHostedDevelopmentBindingForAppClient(
    binding,
    generatedModule.app,
  );
  assert.equal(admission.status, 'admitted');
  assert.equal(generatedModule.verifierCalls, 1);
  const appClient = await createSnapbackAppClient(optionsFor(
    app,
    admission.binding,
  ));
  try {
    assert.equal(appClient.bootstrapState().status, 'ready');
    assert.equal(appClient.bootstrapState().authoritySource, 'fresh-anonymous');
    assert.equal(
      server.requests.filter(({ path }) => path === '/auth/session').length,
      1,
    );
  } finally {
    await appClient.dispose();
    server.restore();
  }
});

test('hosted-development transport uses the target snapshot verified before await', async () => {
  const server = installServer();
  const app = makeApp();
  const generatedOrigin = 'https://hosted.example.test';
  const attackerOrigin = 'https://attacker.example';
  const generatedTarget = makeHostedDevelopmentBinding(app, {
    origin: generatedOrigin,
  }).target;
  let liveOriginFlipped = false;
  const liveTarget = { ...generatedTarget };
  Object.defineProperty(liveTarget, 'origin', {
    enumerable: true,
    get() {
      return liveOriginFlipped ? attackerOrigin : generatedOrigin;
    },
  });
  const liveBinding = {
    ...makeHostedDevelopmentBinding(app, { origin: generatedOrigin }),
    target: liveTarget,
  };
  const generatedApp = generatedHostedApp(app, [generatedTarget], (receipt, candidate) => {
    assert.equal(candidate.target.origin, generatedOrigin);
    queueMicrotask(() => { liveOriginFlipped = true; });
    return receipt === liveBinding.provenance.hostedTargetReceipt;
  });
  const admission = await admitHostedDevelopmentBindingForAppClient(
    liveBinding,
    generatedApp,
  );
  assert.equal(admission.status, 'admitted');
  assert.equal(liveBinding.target.origin, attackerOrigin);
  assert.equal(admission.binding.target.origin, generatedOrigin);
  const appClient = await createSnapbackAppClient(optionsFor(app, admission.binding));
  try {
    assert.equal(appClient.bootstrapState().status, 'ready');
    assert.deepEqual(
      server.requests.map(({ origin }) => origin),
      [generatedOrigin],
      'transport must never re-read the attacker origin from the live candidate',
    );
  } finally {
    await appClient.dispose();
    server.restore();
  }
});

test('raw bootstrap refuses fabricated receipts and local, private, or unspecified hosted targets', async () => {
  const server = installServer();
  const app = makeApp();
  try {
    assert.equal(
      Object.hasOwn(
        publishedAppClientInternal,
        'admitHostedDevelopmentBindingForAppClient',
      ),
      false,
      'the raw admission helper must not be exported by the published internal subpath',
    );
    const fabricated = makeHostedDevelopmentBinding(app, {
      origin: 'https://demo.ngrok.app',
      hostedTargetReceipt: 'sha256:fabricated-receipt',
    });
    await assert.rejects(
      createSnapbackAppClient(optionsFor(app, fabricated)),
      (error) => error?.code === 'SNAPBACK_APP_BINDING_INTEGRITY_INVALID',
    );
    assert.equal(
      (await admitHostedDevelopmentBindingForAppClient(fabricated, app)).status,
      'generated-module-unavailable',
      'descriptor JSON without the generated binding module must refuse',
    );
    assert.equal(
      (await admitHostedDevelopmentBindingForAppClient(fabricated, {
        generatedHostedTargets: [fabricated.target],
        verifyHostedTargetAdmission: () => true,
      })).status,
      'generated-module-unavailable',
      'the former raw parameter object must not remain an admission surface',
    );
    for (const origin of [
      'https://127.0.0.1:4137',
      'https://10.0.0.5',
      'https://[::1]',
      'https://0.0.0.0',
      'https://[::]',
      'https://[::ffff:0:0]',
      'https://0',
      'https://00.00.00.00',
      'https://[0:0:0:0:0:0:0:0]',
      'https://[::0]',
      'https://[::ffff:0.0.0.0]',
      'https://[::7f00:1]',
      'https://[::a00:1]',
      'https://[::ac10:1]',
      'https://[::c0a8:1]',
      'https://[::a9fe:1]',
    ]) {
      const invalidTarget = makeHostedDevelopmentBinding(app, { origin });
      await assert.rejects(
        createSnapbackAppClient(optionsFor(app, invalidTarget)),
        (error) => error?.code === 'SNAPBACK_APP_BINDING_TARGET_INVALID',
        origin,
      );
    }
    assert.equal(server.requests.length, 0);
  } finally {
    server.restore();
  }
});

test('expo-native durable admission requires an adapter-reported qualifying grade', async () => {
  const server = installServer();
  const app = makeApp({ custody: 'durable-required' });
  try {
    await assert.rejects(
      createSnapbackAppClient({
        app,
        binding: makeBinding(app),
        platform: { kind: 'expo-native', cryptoObject: webcrypto },
      }),
      (error) => error?.code === 'SNAPBACK_AUTH_BOOTSTRAP_PLATFORM_UNSUPPORTED',
    );
    await assert.rejects(
      createSnapbackAppClient({
        app,
        binding: makeBinding(app),
        platform: {
          kind: 'expo-native',
          authCustodyStorage: {
            ...createMemoryAuthCustodyStorage(),
            ownerKeyCapability: 'wrong-owner-key-capability',
          },
          cryptoObject: webcrypto,
        },
      }),
      (error) => error?.code === 'SNAPBACK_AUTH_BOOTSTRAP_PLATFORM_UNSUPPORTED',
    );
    assert.equal(server.requests.length, 0);

    await assert.rejects(
      createSnapbackAppClient({
        app,
        binding: makeBinding(app),
        platform: {
          kind: 'expo-native',
          authCustodyStorage: createMemoryAuthCustodyStorage(),
          cryptoObject: webcrypto,
        },
      }),
      (error) => error?.code === 'SNAPBACK_AUTH_CUSTODY_DURABLE_UNAVAILABLE'
        && error?.bootstrapState?.status === 'unsupported',
    );
    assert.equal(server.requests.length, 0);

    const reportedStorage = {
      ...createMemoryAuthCustodyStorage(),
      async platformGrade() {
        return {
          grade: 'single-runtime',
          mechanism: 'test-single-runtime-queue',
        };
      },
    };
    const client = await createSnapbackAppClient({
      app,
      binding: makeBinding(app),
      platform: {
        kind: 'expo-native',
        authCustodyStorage: reportedStorage,
        cryptoObject: webcrypto,
      },
    });
    assert.equal(client.bootstrapState().status, 'ready');
    assert.equal(client.bootstrapState().custody.carrier, 'expo-native-injected');
    assert.equal(client.bootstrapState().custody.grade, 'single-runtime');
    assert.equal(
      client.bootstrapState().custody.mechanism,
      'test-single-runtime-queue',
    );
    await client.dispose();

    let providerThreadedProbeCalls = 0;
    const providerThreadedStorage = {
      ...createMemoryAuthCustodyStorage(),
      async platformGrade() {
        providerThreadedProbeCalls += 1;
        throw new Error('the provider-threaded grade must prevent a second probe');
      },
    };
    const providerThreadedClient = await createSnapbackAppClient({
      app,
      binding: makeBinding(app),
      storagePartition: 'provider-threaded-grade-test',
      platform: publishedAppClientInternal.createProviderValidatedExpoNativePlatform({
        authCustodyStorage: providerThreadedStorage,
        authCustodyGrade: {
          os: 'android',
          grade: 'single-runtime',
          mechanism: 'test-provider-validated-grade',
        },
        cryptoObject: webcrypto,
      }),
    });
    assert.equal(providerThreadedProbeCalls, 0);
    assert.equal(providerThreadedClient.bootstrapState().status, 'ready');
    assert.equal(
      providerThreadedClient.bootstrapState().custody.mechanism,
      'test-provider-validated-grade',
    );
    await providerThreadedClient.dispose();
  } finally {
    server.restore();
  }
});

test('expo-native platform objects reject browser-only custody options', async () => {
  const server = installServer();
  const app = makeApp({ custody: 'durable-required' });
  const storage = {
    ...createMemoryAuthCustodyStorage(),
    async platformGrade() {
      return { grade: 'single-runtime', mechanism: 'test-single-runtime-queue' };
    },
  };
  try {
    for (const [key, value] of [
      ['indexedDB', new IDBFactory()],
      ['lockManager', { request: () => null }],
      ['databaseName', 'ignored-native-database'],
    ]) {
      await assert.rejects(
        createSnapbackAppClient({
          app,
          binding: makeBinding(app),
          platform: {
            kind: 'expo-native',
            authCustodyStorage: storage,
            cryptoObject: webcrypto,
            [key]: value,
          },
        }),
        (error) => error?.code === 'SNAPBACK_AUTH_BOOTSTRAP_PLATFORM_UNSUPPORTED',
      );
    }
    assert.equal(server.requests.length, 0);
  } finally {
    server.restore();
  }
});

test('browser durable custody restores the default record and keeps signed-in partitions distinct', async () => {
  const server = installServer();
  const app = makeApp({ custody: 'durable-required' });
  const indexedDB = new IDBFactory();
  const lockManager = { request: (_name, _options, operation) => operation() };
  const platform = {
    kind: 'browser',
    indexedDB,
    lockManager,
    cryptoObject: webcrypto,
    databaseName: 'snapback-app-client-durable-test',
  };
  const input = { app, binding: makeBinding(app), platform };
  let first = null;
  let restored = null;
  let partitioned = null;
  let inspector = null;
  try {
    first = await createSnapbackAppClient(input);
    assert.equal(first.bootstrapState().custody.carrier, 'indexeddb-web-locks');
    assert.equal(first.bootstrapState().custody.grade, 'durable');
    server.respond('/auth/password/signup', ({ body }) => Response.json(
      body.email === 'peer@example.com'
        ? server.credential({
            token: PEER_BEARER,
            codes: RECOVERY_CODES,
            userId: PEER_USER,
            sessionId: PEER_SESSION,
            authorityInstanceId: PEER_AUTHORITY,
          })
        : server.credential({ token: APPLICATION_BEARER, codes: RECOVERY_CODES }),
    ));
    await first.auth.signUpWithPassword({ email: 'person@example.com', password: PASSWORD });
    await first.dispose();
    first = null;

    restored = await createSnapbackAppClient(input);
    assert.equal(restored.auth.currentPrincipal().status, 'authenticated');
    assert.equal(
      restored.auth.currentPrincipal().provider,
      null,
      'restoration does not fabricate the provider availability key as issuance provenance',
    );
    assert.equal(restored.bootstrapState().authoritySource, 'durable-restored');
    partitioned = await createSnapbackAppClient({
      ...input,
      storagePartition: 'secondary-profile',
    });
    assert.equal(partitioned.auth.currentPrincipal().status, 'anonymous');
    await partitioned.auth.signUpWithPassword({ email: 'peer@example.com', password: PASSWORD });
    assert.equal(restored.auth.currentPrincipal().userId, USER);
    assert.equal(partitioned.auth.currentPrincipal().userId, PEER_USER);

    inspector = createIndexedDbAuthCustodyStorage({
      indexedDB,
      lockManager,
      cryptoObject: webcrypto,
      databaseName: platform.databaseName,
    });
    const legacyAddressRecord = await inspector.withOwnership(
      APP_ID,
      (owner) => owner.read(),
    );
    const partitionAddressRecord = await inspector.withOwnership(
      { appId: APP_ID, storagePartition: 'secondary-profile' },
      (owner) => owner.read(),
    );
    assert.equal(
      legacyAddressRecord.authority.userId,
      USER,
      'an app-id-only inspection names the default partition',
    );
    assert.equal(
      partitionAddressRecord.authority.userId,
      PEER_USER,
      'the full owner-key inspection names the explicit partition',
    );

    const forcedRequestOffset = server.requests.length;
    const [defaultSession, partitionedSession] = await Promise.all([
      restored.client.auth.authSession({ force: true }),
      partitioned.client.auth.authSession({ force: true }),
    ]);
    assert.equal(defaultSession.authority.userId, USER);
    assert.equal(partitionedSession.authority.userId, PEER_USER);
    assert.deepEqual(
      server.requests.slice(forcedRequestOffset)
        .filter(({ path }) => path === '/auth/session')
        .map(({ authorization }) => authorization)
        .sort(),
      [`Bearer ${APPLICATION_BEARER}`, `Bearer ${PEER_BEARER}`].sort(),
      'each partition identifies its HTTP session with its own custody bearer',
    );
  } finally {
    await inspector?.close();
    await partitioned?.dispose();
    await restored?.dispose();
    await first?.dispose();
    server.restore();
  }
});

test('browser app-client defaults keep queue authority in the explicit platform store domain', async () => {
  const server = installServer();
  delete process.env.SNAPBACK_CLIENT_RQS_STORE;
  const ambientIndexedDB = new IDBFactory();
  const ambientLockManager = createSerialLockManager();
  const restoreIndexedDB = replaceGlobal('indexedDB', ambientIndexedDB);
  const restoreNavigator = replaceGlobal('navigator', { locks: ambientLockManager });
  let predecessorStore = null;
  let appClient = null;
  try {
    predecessorStore = createIndexedDbRqsResumeStore({
      indexedDB: ambientIndexedDB,
      lockManager: ambientLockManager,
      broadcastChannelFactory: null,
    });
    await predecessorStore.whenLockSettled();
    assert.equal(
      await predecessorStore.wipeForAuthorityTransition('prior-run:1->2', 2),
      true,
    );
    await predecessorStore.close();
    predecessorStore = null;

    const app = makeApp({ custody: 'durable-required' });
    const platform = {
      kind: 'browser',
      indexedDB: new IDBFactory(),
      lockManager: createSerialLockManager(),
      cryptoObject: webcrypto,
      databaseName: 'snapback-app-client-explicit-platform-domain-test',
    };
    appClient = await createSnapbackAppClient({
      app,
      binding: makeBinding(app),
      platform,
    });
    server.respond('/auth/password/signup', () => (
      Response.json(server.credential({ codes: RECOVERY_CODES }))
    ));

    await appClient.auth.signUpWithPassword({
      email: 'person@example.com',
      password: PASSWORD,
    });
    assert.equal(appClient.client.rqsStoreInfo.implementation, 'indexeddb');
    assert.equal(appClient.auth.currentPrincipal().status, 'authenticated');
  } finally {
    await appClient?.dispose();
    await predecessorStore?.close();
    restoreNavigator();
    restoreIndexedDB();
    server.restore();
  }
});

test('browser app-client peers converge sign-in, user-switch successor, and logout from wakeups', async () => {
  const server = installServer();
  const app = makeApp({ custody: 'durable-required' });
  const indexedDB = new IDBFactory();
  const lockManager = createSerialLockManager();
  const broadcastHub = new BroadcastHub();
  const hintBytes = new Map();
  const hintStorage = {
    setItem(key, value) { hintBytes.set(key, value); },
  };
  const platform = {
    kind: 'browser',
    indexedDB,
    lockManager,
    cryptoObject: webcrypto,
    databaseName: 'snapback-app-client-cross-tab-test',
    broadcastChannelFactory: broadcastHub.factory,
    hintStorage,
  };
  const [{ createSnapbackAppClient: createTabA }, { createSnapbackAppClient: createTabB }] = (
    await Promise.all([
      import('./app-client.mjs?cross-tab-a'),
      import('./app-client.mjs?cross-tab-b'),
    ])
  );
  let tabA = null;
  let tabB = null;
  try {
    tabA = await createTabA({ app, binding: makeBinding(app), platform });
    tabB = await createTabB({ app, binding: makeBinding(app), platform });
    assert.equal(broadcastHub.closeCalls, 0);
    assert.equal(tabB.auth.currentPrincipal().status, 'anonymous');

    server.respond('/auth/password/signin', ({ body }) => Response.json(
      body.email === 'peer@example.com'
        ? server.credential({
            token: PEER_BEARER,
            userId: PEER_USER,
            sessionId: PEER_SESSION,
            authorityInstanceId: PEER_AUTHORITY,
          })
        : server.credential({ token: APPLICATION_BEARER }),
    ));
    server.respond('/auth/logout', () => new Response(null, { status: 204 }));

    await tabA.auth.signInWithPassword({ email: 'person@example.com', password: PASSWORD });
    await waitFor(
      () => tabB.auth.currentPrincipal().status === 'authenticated'
        && tabB.auth.currentPrincipal().userId === USER,
      'peer sign-in principal',
    );
    await waitFor(
      () => tabB.client.captureAuthority().authorityKey
        === tabA.client.captureAuthority().authorityKey,
      'peer sign-in capture',
    );
    assert.deepEqual(tabB.client.captureAuthority(), tabA.client.captureAuthority());

    await tabA.auth.signOut();
    await waitFor(
      () => tabB.auth.currentPrincipal().status === 'anonymous',
      'peer logout principal',
    );
    await waitFor(
      () => tabB.client.captureAuthority().authorityKey
        === tabA.client.captureAuthority().authorityKey,
      'peer logout capture',
    );
    assert.deepEqual(tabB.client.captureAuthority(), tabA.client.captureAuthority());

    await tabA.auth.signInWithPassword({ email: 'peer@example.com', password: PASSWORD });
    await waitFor(
      () => tabB.auth.currentPrincipal().status === 'authenticated'
        && tabB.auth.currentPrincipal().userId === PEER_USER,
      'peer user-switch successor principal',
    );
    await waitFor(
      () => tabB.client.captureAuthority().authorityKey
        === tabA.client.captureAuthority().authorityKey,
      'peer user-switch successor capture',
    );
    assert.deepEqual(tabB.client.captureAuthority(), tabA.client.captureAuthority());
    assert.ok(hintBytes.size > 0, 'transitions publish a shared secret-free storage hint');

    await tabA.dispose();
    tabA = null;
    assert.equal(broadcastHub.closeCalls, 1, 'disposing tab A closes its channel');
    await tabB.dispose();
    tabB = null;
    assert.equal(broadcastHub.closeCalls, 2, 'disposing tab B closes its channel');
    assert.equal(
      [...broadcastHub.channels.values()].every((channels) => channels.size === 0),
      true,
      'no fake broadcast channels remain open',
    );
  } finally {
    await tabA?.dispose();
    await tabB?.dispose();
    server.restore();
  }
});

test('browser kind with omitted cross-context keys uses coordinator host defaults', async () => {
  const server = installServer();
  const app = makeApp({ custody: 'durable-required' });
  const broadcastHub = new BroadcastHub();
  const hintBytes = new Map();
  const restoreBroadcast = replaceGlobal('BroadcastChannel', function FakeBroadcastChannel(name) {
    return broadcastHub.factory(name);
  });
  const restoreLocalStorage = replaceGlobal('localStorage', {
    setItem(key, value) { hintBytes.set(key, value); },
  });
  let appClient = null;
  try {
    appClient = await createSnapbackAppClient({
      app,
      binding: makeBinding(app),
      platform: {
        kind: 'browser',
        indexedDB: new IDBFactory(),
        lockManager: createSerialLockManager(),
        cryptoObject: webcrypto,
        databaseName: 'snapback-app-client-browser-default-wakeup-test',
      },
    });
    assert.equal(
      [...broadcastHub.channels.values()].reduce((count, channels) => count + channels.size, 0),
      1,
      'omitted browser channel option reaches the coordinator default',
    );
    server.respond('/auth/password/signin', () => (
      Response.json(server.credential({ token: APPLICATION_BEARER }))
    ));
    await appClient.auth.signInWithPassword({ email: 'person@example.com', password: PASSWORD });
    assert.ok(hintBytes.size > 0, 'omitted browser hint option reaches the coordinator default');
    await appClient.dispose();
    appClient = null;
    assert.equal(broadcastHub.closeCalls, 1);
  } finally {
    await appClient?.dispose();
    restoreLocalStorage();
    restoreBroadcast();
    server.restore();
  }
});

test('browser kind explicit null BroadcastChannel disables peer wakeups', async () => {
  const server = installServer();
  const app = makeApp({ custody: 'durable-required' });
  let defaultChannelCalls = 0;
  const restoreBroadcast = replaceGlobal('BroadcastChannel', function UnexpectedBroadcastChannel() {
    defaultChannelCalls += 1;
    return new BroadcastHub().factory('unexpected');
  });
  const restoreLocalStorage = replaceGlobal('localStorage', { setItem() {} });
  const platform = {
    kind: 'browser',
    indexedDB: new IDBFactory(),
    lockManager: createSerialLockManager(),
    cryptoObject: webcrypto,
    databaseName: 'snapback-app-client-browser-null-wakeup-test',
    broadcastChannelFactory: null,
  };
  const [{ createSnapbackAppClient: createTabA }, { createSnapbackAppClient: createTabB }] = (
    await Promise.all([
      import('./app-client.mjs?null-wakeup-a'),
      import('./app-client.mjs?null-wakeup-b'),
    ])
  );
  let tabA = null;
  let tabB = null;
  try {
    tabA = await createTabA({ app, binding: makeBinding(app), platform });
    tabB = await createTabB({ app, binding: makeBinding(app), platform });
    server.respond('/auth/password/signin', () => (
      Response.json(server.credential({ token: APPLICATION_BEARER }))
    ));
    await tabA.auth.signInWithPassword({ email: 'person@example.com', password: PASSWORD });
    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(defaultChannelCalls, 0, 'explicit null bypasses the host BroadcastChannel default');
    assert.equal(tabB.auth.currentPrincipal().status, 'anonymous', 'peer receives no channel wakeup');
  } finally {
    await tabA?.dispose();
    await tabB?.dispose();
    restoreLocalStorage();
    restoreBroadcast();
    server.restore();
  }
});

test('browser kind explicit null hintStorage bypasses host localStorage while configured broadcasts wake peers', async () => {
  const server = installServer();
  const app = makeApp({ custody: 'durable-required' });
  const broadcastHub = new BroadcastHub();
  const hintBytes = new Map();
  let hintReads = 0;
  let hintWrites = 0;
  const restoreLocalStorage = replaceGlobal('localStorage', {
    getItem(key) {
      hintReads += 1;
      return hintBytes.get(key) ?? null;
    },
    setItem(key, value) {
      hintWrites += 1;
      hintBytes.set(key, value);
    },
  });
  const platform = {
    kind: 'browser',
    indexedDB: new IDBFactory(),
    lockManager: createSerialLockManager(),
    cryptoObject: webcrypto,
    databaseName: 'snapback-app-client-browser-null-hint-storage-test',
    broadcastChannelFactory: broadcastHub.factory,
    hintStorage: null,
  };
  const [{ createSnapbackAppClient: createTabA }, { createSnapbackAppClient: createTabB }] = (
    await Promise.all([
      import('./app-client.mjs?null-hint-storage-a'),
      import('./app-client.mjs?null-hint-storage-b'),
    ])
  );
  let tabA = null;
  let tabB = null;
  try {
    tabA = await createTabA({ app, binding: makeBinding(app), platform });
    tabB = await createTabB({ app, binding: makeBinding(app), platform });
    server.respond('/auth/password/signin', () => (
      Response.json(server.credential({ token: APPLICATION_BEARER }))
    ));
    await tabA.auth.signInWithPassword({ email: 'person@example.com', password: PASSWORD });
    await waitFor(
      () => tabB.auth.currentPrincipal().status === 'authenticated'
        && tabB.auth.currentPrincipal().userId === USER,
      'broadcast-only peer sign-in principal',
    );
    assert.deepEqual(
      { reads: hintReads, writes: hintWrites },
      { reads: 0, writes: 0 },
      'explicit null bypasses the functioning host localStorage hint mechanism',
    );
  } finally {
    await tabA?.dispose();
    await tabB?.dispose();
    restoreLocalStorage();
    server.restore();
  }
});

test('browser-kind construction without BroadcastChannel or localStorage stays safe', async () => {
  const server = installServer();
  const app = makeApp({ custody: 'durable-required' });
  const restoreBroadcast = replaceGlobal('BroadcastChannel', undefined);
  const restoreLocalStorage = replaceGlobal('localStorage', undefined);
  let appClient = null;
  try {
    appClient = await createSnapbackAppClient({
      app,
      binding: makeBinding(app),
      platform: {
        kind: 'browser',
        indexedDB: new IDBFactory(),
        lockManager: createSerialLockManager(),
        cryptoObject: webcrypto,
        databaseName: 'snapback-app-client-browser-without-wakeup-globals-test',
      },
      storagePartition: 'node-without-cross-context-globals',
    });
    assert.equal(appClient.auth.currentPrincipal().status, 'anonymous');
    server.respond('/auth/password/signin', () => (
      Response.json(server.credential({ token: APPLICATION_BEARER }))
    ));
    await appClient.auth.signInWithPassword({ email: 'person@example.com', password: PASSWORD });
    assert.equal(appClient.auth.currentPrincipal().status, 'authenticated');
    await appClient.dispose();
    appClient = null;
  } finally {
    await appClient?.dispose();
    restoreLocalStorage();
    restoreBroadcast();
    server.restore();
  }
});

test('restored same-principal remints cannot rotate bearer while process-supervised remints can', async () => {
  const server = installServer();
  const app = makeApp({ custody: 'durable-required' });
  const indexedDB = new IDBFactory();
  const platform = {
    kind: 'browser',
    indexedDB,
    lockManager: { request: (_name, _options, operation) => operation() },
    cryptoObject: webcrypto,
    databaseName: 'snapback-app-client-restored-remint-test',
  };
  const input = { app, binding: makeBinding(app), platform };
  let seeded = null;
  let restored = null;
  let supervised = null;
  try {
    seeded = await createSnapbackAppClient(input);
    server.respond('/auth/password/signin', () => (
      Response.json(server.credential({ token: APPLICATION_BEARER }))
    ));
    await seeded.auth.signInWithPassword({ email: 'person@example.com', password: PASSWORD });
    await seeded.dispose();
    seeded = null;

    restored = await createSnapbackAppClient(input);
    const restoredCapture = restored.client.authCoordinator.capture();
    assert.equal(
      restored.client.authCoordinator.credentialFor(restoredCapture).bearer,
      APPLICATION_BEARER,
    );
    const protectedRemint = await __adoptSupervisedBootstrapAuthority(restored, {
      bearer: ROTATED_BEARER,
      binding: input.binding,
    });
    assert.equal(protectedRemint.status, 'conflict');
    assert.equal(
      restored.client.authCoordinator.credentialFor(
        restored.client.authCoordinator.capture(),
      ).bearer,
      APPLICATION_BEARER,
      'restored authority keeps its durable bearer even when the remint names the same principal',
    );
    assert.deepEqual(
      restored.bootstrapState().advisories.map(({ diagnostic }) => diagnostic.code),
      ['SNAPBACK_AUTH_SUPERVISED_PRINCIPAL_CONFLICT'],
    );
    await restored.dispose();
    restored = null;

    supervised = await createSnapbackAppClient(optionsFor(makeApp()));
    assert.equal((await __adoptSupervisedBootstrapAuthority(supervised, {
      bearer: SUPERVISED_BEARER,
      binding: makeBinding(makeApp()),
    })).status, 'adopted');
    assert.equal((await __adoptSupervisedBootstrapAuthority(supervised, {
      bearer: ROTATED_BEARER,
      binding: makeBinding(makeApp()),
    })).status, 'rebound');
    assert.equal(
      supervised.client.authCoordinator.credentialFor(
        supervised.client.authCoordinator.capture(),
      ).bearer,
      ROTATED_BEARER,
      'the exact process-local supervised adoption record still authorizes remint rotation',
    );
    assert.deepEqual(supervised.bootstrapState().advisories, []);
  } finally {
    await supervised?.dispose();
    await restored?.dispose();
    await seeded?.dispose();
    server.restore();
  }
});

test('supervised adoption installs and rotates private dev-identity custody on the live client', async () => {
  const server = installServer();
  const app = makeApp();
  const appClient = await createSnapbackAppClient(optionsFor(app));
  const firstCapability = 'sbdev_app_client_first';
  const rotatedCapability = 'sbdev_app_client_rotated';
  try {
    server.respond('/connection/open', ({ body }) => Response.json({
      connectionId: body.connectionId,
      connectionToken: `sct_${body.connectionId}`,
      wireVersion: 'snapback.v1',
    }));
    assert.equal((await __adoptSupervisedBootstrapAuthority(appClient, {
      bearer: SUPERVISED_BEARER,
      binding: makeBinding(app),
      clientOptions: { devIdentityCapability: firstCapability },
    })).status, 'adopted');
    await appClient.client.connectionGrant('app-client-dev-identity-first');
    const firstOpen = server.requests.findLast(({ path }) => path === '/connection/open');
    assert.equal(firstOpen.devIdentityCapability, firstCapability);

    assert.equal((await __adoptSupervisedBootstrapAuthority(appClient, {
      bearer: ROTATED_BEARER,
      binding: makeBinding(app),
      clientOptions: { devIdentityCapability: rotatedCapability },
    })).status, 'rebound');
    await appClient.client.connectionGrant('app-client-dev-identity-rotated');
    const open = server.requests.findLast(({ path }) => path === '/connection/open');
    assert.equal(open.devIdentityCapability, rotatedCapability);
  } finally {
    await appClient.dispose();
    server.restore();
  }
});

test('supervised adoption omission preserves live dev-identity custody', async () => {
  const server = installServer();
  const app = makeApp();
  const appClient = await createSnapbackAppClient(optionsFor(app, makeBinding(app), {
    storagePartition: 'dev-identity-omission',
  }));
  const capability = 'sbdev_app_client_retained';
  try {
    server.respond('/connection/open', ({ body }) => Response.json({
      connectionId: body.connectionId,
      connectionToken: 'sct_app_client_dev_identity_retained',
      wireVersion: 'snapback.v1',
    }));
    assert.equal((await __adoptSupervisedBootstrapAuthority(appClient, {
      bearer: SUPERVISED_BEARER,
      binding: makeBinding(app),
      clientOptions: { devIdentityCapability: capability },
    })).status, 'adopted');
    assert.equal((await __adoptSupervisedBootstrapAuthority(appClient, {
      bearer: ROTATED_BEARER,
      binding: makeBinding(app),
    })).status, 'rebound');
    await appClient.client.connectionGrant('app-client-dev-identity-retained');
    const open = server.requests.findLast(({ path }) => path === '/connection/open');
    assert.equal(open.devIdentityCapability, capability);
  } finally {
    await appClient.dispose();
    server.restore();
  }
});

test('supervised adoption conflict does not mutate live dev-identity custody', async () => {
  const server = installServer();
  const app = makeApp();
  const appClient = await createSnapbackAppClient(optionsFor(app, makeBinding(app), {
    storagePartition: 'dev-identity-conflict',
  }));
  const capability = 'sbdev_app_client_before_conflict';
  try {
    server.respond('/connection/open', ({ body }) => Response.json({
      connectionId: body.connectionId,
      connectionToken: 'sct_app_client_dev_identity_conflict',
      wireVersion: 'snapback.v1',
    }));
    assert.equal((await __adoptSupervisedBootstrapAuthority(appClient, {
      bearer: SUPERVISED_BEARER,
      binding: makeBinding(app),
      clientOptions: { devIdentityCapability: capability },
    })).status, 'adopted');
    assert.equal((await __adoptSupervisedBootstrapAuthority(appClient, {
      bearer: PEER_BEARER,
      binding: makeBinding(app),
      clientOptions: { devIdentityCapability: 'sbdev_app_client_conflicting' },
    })).status, 'conflict');
    await appClient.client.connectionGrant('app-client-dev-identity-after-conflict');
    const open = server.requests.findLast(({ path }) => path === '/connection/open');
    assert.equal(open.devIdentityCapability, capability);
  } finally {
    await appClient.dispose();
    server.restore();
  }
});

test('supervised adoption refuses raw dev-identity custody on web platforms', async () => {
  const server = installServer();
  const app = makeApp();
  const clients = [];
  try {
    for (const kind of ['browser', 'expo-web']) {
      const appClient = await createSnapbackAppClient(optionsFor(app, makeBinding(app), {
        platform: { kind, cryptoObject: webcrypto },
        storagePartition: `dev-identity-${kind}`,
      }));
      clients.push(appClient);
      const requestCount = server.requests.length;
      await assert.rejects(
        __adoptSupervisedBootstrapAuthority(appClient, {
          bearer: SUPERVISED_BEARER,
          binding: makeBinding(app),
          clientOptions: { devIdentityCapability: `sbdev_app_client_${kind}` },
        }),
        new RegExp(`raw devIdentityCapability installation is refused on ${kind}`, 'u'),
      );
      assert.equal(server.requests.length, requestCount, 'web refusal precedes bearer adoption');
      assert.equal(appClient.auth.currentPrincipal().status, 'anonymous');
    }
  } finally {
    await Promise.all(clients.map((client) => client.dispose()));
    server.restore();
  }
});

test('owner registry single-flights, reference-counts, evicts failures, and reacquires after zero', async () => {
  const server = installServer();
  const app = makeApp();
  const options = optionsFor(app);
  const clients = await Promise.all([
    createSnapbackAppClient(options),
    createSnapbackAppClient(options),
    createSnapbackAppClient(options),
  ]);
  try {
    assert.equal(clients[0].client, clients[1].client);
    assert.equal(clients[1].client, clients[2].client);
    assert.equal(server.requests.filter(({ path }) => path === '/auth/session').length, 1);
    await clients[0].dispose();
    await clients[1].dispose();
    assert.equal(clients[2].auth.currentPrincipal().status, 'anonymous');
    const repeated = await createSnapbackAppClient(options);
    assert.equal(repeated.client, clients[2].client);
    await clients[2].dispose();
    assert.equal(repeated.auth.currentPrincipal().status, 'anonymous');
    const priorClient = repeated.client;
    await repeated.dispose();

    const reacquired = await createSnapbackAppClient(options);
    assert.notEqual(reacquired.client, priorClient);
    assert.equal(server.requests.filter(({ path }) => path === '/auth/session').length, 2);
    await reacquired.dispose();
  } finally {
    await Promise.allSettled(clients.map((client) => client.dispose()));
    server.restore();
  }

  const failureServer = installServer();
  const originalFetch = globalThis.fetch;
  let fail = true;
  globalThis.fetch = async (...args) => {
    if (fail) {
      fail = false;
      throw new Error('construction transport failure');
    }
    return originalFetch(...args);
  };
  try {
    await assert.rejects(createSnapbackAppClient(options), /construction transport failure/u);
    const recovered = await createSnapbackAppClient(options);
    assert.equal(recovered.bootstrapState().status, 'ready');
    await recovered.dispose();
  } finally {
    failureServer.restore();
  }
});

test('live owners accept proved same-policy successors and refuse conflicts, rotations, and stale bindings', async () => {
  const server = installServer();
  const firstApp = makeApp();
  const firstOptions = optionsFor(firstApp);
  const first = await createSnapbackAppClient(firstOptions);
  let reordered = null;
  let successor = null;
  try {
    const policy = firstApp.authBootstrap;
    const reorderedApp = Object.freeze({
      ...firstApp,
      authBootstrap: Object.freeze({
        lifecycleProtocol: policy.lifecycleProtocol,
        anonymousPublic: policy.anonymousPublic,
        entryMechanisms: policy.entryMechanisms,
        custody: policy.custody,
        mode: policy.mode,
        appId: policy.appId,
        format: policy.format,
      }),
    });
    reordered = await createSnapbackAppClient(optionsFor(reorderedApp));
    assert.equal(reordered.client, first.client);

    const conflictBinding = makeBinding(firstApp, { origin: 'http://127.0.0.1:4712' });
    await assert.rejects(
      createSnapbackAppClient(optionsFor(firstApp, conflictBinding)),
      (error) => error?.code === 'SNAPBACK_AUTH_BOOTSTRAP_BINDING_CONFLICT',
    );

    const successorApp = makeApp({
      schema: 'sha256:schema-2',
      functions: 'sha256:functions-2',
      descriptor: 'sha256:descriptor-2',
    });
    const successorIssuedAt = isoFromNow(60_000);
    const successorBinding = makeBinding(successorApp, {
      issuedAt: successorIssuedAt,
      expiresAt: isoFromNow(60 * 60_000),
    });
    successor = await createSnapbackAppClient(optionsFor(successorApp, successorBinding));
    assert.equal(successor.client, first.client);

    const rotatedPolicyApp = makeApp({
      schema: successorApp.identity.schema,
      functions: successorApp.identity.functions,
      descriptor: successorApp.identity.descriptor,
      anonymousPublic: 'allowed',
    });
    const rotatedPolicyBinding = makeBinding(rotatedPolicyApp, {
      issuedAt: isoFromNow(120_000),
      expiresAt: isoFromNow(60 * 60_000),
    });
    await assert.rejects(
      createSnapbackAppClient(optionsFor(rotatedPolicyApp, rotatedPolicyBinding)),
      (error) => error?.code === 'SNAPBACK_AUTH_BOOTSTRAP_POLICY_ROTATION',
    );
    await assert.rejects(
      createSnapbackAppClient(firstOptions),
      (error) => error?.code === 'SNAPBACK_AUTH_BOOTSTRAP_BINDING_STALE',
    );

    const ambiguousSameTimeRemint = makeBinding(successorApp, {
      issuedAt: successorIssuedAt,
      expiresAt: isoFromNow(2 * 60 * 60_000),
      supervisorGeneration: 'unordered-same-time-remint',
    });
    await assert.rejects(
      createSnapbackAppClient(optionsFor(successorApp, ambiguousSameTimeRemint)),
      (error) => error?.code === 'SNAPBACK_AUTH_BOOTSTRAP_BINDING_STALE',
    );

    const staleSuccessorRemint = makeBinding(successorApp, {
      issuedAt: isoFromNow(30_000),
      expiresAt: isoFromNow(60 * 60_000),
      supervisorGeneration: 'stale-successor-remint',
    });
    await assert.rejects(
      createSnapbackAppClient(optionsFor(successorApp, staleSuccessorRemint)),
      (error) => error?.code === 'SNAPBACK_AUTH_BOOTSTRAP_BINDING_STALE',
    );
  } finally {
    await successor?.dispose();
    await reordered?.dispose();
    await first.dispose();
    server.restore();
  }
});

test('entry gating protects authenticated principals while changePassword remains a rotation', async () => {
  const server = installServer();
  const app = makeApp();
  const appClient = await createSnapbackAppClient(optionsFor(app));
  try {
    appClient.client.clearAuthSession();
    const before = server.requests.length;
    await assert.rejects(
      appClient.auth.signInWithPassword({ email: 'person@example.com', password: PASSWORD }),
      (error) => error?.code === 'SNAPBACK_AUTH_ENTRY_UNSETTLED',
    );
    await assert.rejects(
      appClient.auth.changePassword({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD }),
      (error) => error?.code === 'SNAPBACK_AUTH_CHANGE_PASSWORD_REQUIRES_AUTHENTICATED'
        && error?.diagnostic?.details?.principalStatus === 'loading'
        && error?.operation === 'auth-password-change',
    );
    assert.equal(server.requests.length, before);
    await appClient.client.auth.authSession();

    server.respond('/auth/password/signup', () => (
      Response.json(server.credential({ codes: RECOVERY_CODES }))
    ));
    await appClient.auth.signUpWithPassword({ email: 'person@example.com', password: PASSWORD });
    const beforeProtectedEntry = server.requests.length;
    await assert.rejects(
      appClient.auth.signInWithPassword({ email: 'person@example.com', password: PASSWORD }),
      (error) => error?.code === 'SNAPBACK_AUTH_ENTRY_AUTHENTICATED'
        && error.remediations[0].kind === 'signOut',
    );
    assert.equal(server.requests.length, beforeProtectedEntry);

    server.respond('/auth/password/change', ({ authorization, body }) => {
      assert.equal(authorization, `Bearer ${APPLICATION_BEARER}`);
      assert.deepEqual(body, { currentPassword: PASSWORD, newPassword: NEW_PASSWORD });
      return Response.json(server.credential({ token: ROTATED_BEARER }));
    });
    const changed = await appClient.auth.changePassword({
      currentPassword: PASSWORD,
      newPassword: NEW_PASSWORD,
    });
    assert.equal(changed.session.userId, USER);
    assert.equal(Object.hasOwn(changed, 'token'), false);

    const releasePublication = appClient.client.__withholdCurrentPrincipalPublication();
    try {
      await assert.rejects(
        appClient.auth.changePassword({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD }),
        (error) => error?.code === 'SNAPBACK_AUTH_CHANGE_PASSWORD_REQUIRES_AUTHENTICATED'
          && error?.diagnostic?.details?.principalStatus === 'refreshing',
      );
    } finally {
      releasePublication();
    }

    const custodyFailure = new Error('custody is blocked for rotate-arm test');
    custodyFailure.code = 'SNAPBACK_AUTH_CUSTODY_CORRUPT';
    custodyFailure.diagnostic = {
      code: custodyFailure.code,
      message: 'Custody is blocked for rotate-arm test.',
      details: { phase: 'custody-read', causeCode: custodyFailure.code },
    };
    appClient.client.clearAuthSession();
    appClient.client.authCoordinator.synchronize = async () => { throw custodyFailure; };
    await assert.rejects(appClient.client.auth.authSession({ force: true }), (error) => error === custodyFailure);
    assert.equal(appClient.auth.currentPrincipal().status, 'blocked');
    await assert.rejects(
      appClient.auth.changePassword({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD }),
      (error) => error?.code === 'SNAPBACK_AUTH_CHANGE_PASSWORD_REQUIRES_AUTHENTICATED'
        && error?.diagnostic?.details?.principalStatus === 'blocked',
    );
  } finally {
    await appClient.dispose();
    server.restore();
  }
});

test('recovery facade preserves consume and rotate one-time result contracts', async () => {
  const server = installServer();
  const appClient = await createSnapbackAppClient(optionsFor(makeApp()));
  try {
    await assert.rejects(
      appClient.auth.rotateRecoveryCodes(),
      (error) => error?.code === 'SNAPBACK_AUTH_RECOVERY_ROTATE_REQUIRES_AUTHENTICATED',
      'anonymous recovery rotation must refuse before transport',
    );
    server.respond('/auth/recovery/consume', ({ authorization, body }) => {
      assert.equal(authorization, null);
      assert.deepEqual(body, { email: 'person@example.com', code: RECOVERY_CODES[0] });
      return Response.json(server.credential({ codes: RECOVERY_CODES }));
    });
    const consumed = await appClient.auth.consumeRecoveryCode({
      email: 'person@example.com',
      code: RECOVERY_CODES[0],
    });
    assert.deepEqual(consumed.recoveryCodes, RECOVERY_CODES);
    assert.equal(Object.hasOwn(consumed, 'token'), false);

    const rotatedCodes = [...RECOVERY_CODES].reverse();
    server.respond('/auth/recovery/rotate', ({ authorization, body }) => {
      assert.equal(authorization, `Bearer ${APPLICATION_BEARER}`);
      assert.deepEqual(body, {});
      return Response.json(server.credential({
        token: ROTATED_BEARER,
        codes: rotatedCodes,
      }));
    });
    const rotated = await appClient.auth.rotateRecoveryCodes();
    assert.deepEqual(rotated.recoveryCodes, rotatedCodes);
    assert.equal(Object.hasOwn(rotated, 'token'), false);
    assert.equal(appClient.auth.currentPrincipal().status, 'authenticated');
    const beforeAuthenticatedConsume = server.requests.length;
    await assert.rejects(
      appClient.auth.consumeRecoveryCode({
        email: 'person@example.com',
        code: RECOVERY_CODES[1],
      }),
      (error) => error?.code === 'SNAPBACK_AUTH_ENTRY_AUTHENTICATED'
        && error.remediations[0].kind === 'signOut',
      'an authenticated application principal must sign out before recovery entry',
    );
    assert.equal(server.requests.length, beforeAuthenticatedConsume);
  } finally {
    await appClient.dispose();
    server.restore();
  }
});

test('supervised displacement withholds anonymous exposure and failed issuance terminates settled anonymous', async (t) => {
  await t.test('happy path publishes refreshing then the application principal', async () => {
    const server = installServer();
    const app = makeApp();
    const appClient = await createSnapbackAppClient(optionsFor(app));
    try {
      server.respond('/auth/password/signin', () => (
        Response.json(server.credential({ token: SUPERVISED_BEARER }))
      ));
      await appClient.client.auth.authPasswordSignIn({
        email: 'supervised@example.com',
        password: PASSWORD,
      });
      __recordSupervisedBootstrapAdoptionForTests(appClient);
      const observations = [];
      const unsubscribe = appClient.auth.subscribeCurrentPrincipal(() => {
        observations.push(appClient.auth.currentPrincipal().status);
      });
      server.respond('/auth/logout', ({ authorization }) => {
        assert.equal(authorization, `Bearer ${SUPERVISED_BEARER}`);
        return new Response(null, { status: 204 });
      });
      server.respond('/auth/password/signin', () => (
        Response.json(server.credential({ token: APPLICATION_BEARER }))
      ));
      const result = await appClient.auth.signInWithPassword({
        email: 'application@example.com',
        password: PASSWORD,
      });
      unsubscribe();
      assert.equal(result.session.userId, USER);
      assert.equal(observations[0], 'authenticated', '0238 D3 queues the subscribe-time current snapshot');
      assert.equal(observations[1], 'refreshing');
      assert.equal(observations.includes('anonymous'), false);
      assert.equal(observations.at(-1), 'authenticated');
      assert.equal(appClient.bootstrapState().authoritySource, 'application-entry');
    } finally {
      await appClient.dispose();
      server.restore();
    }
  });

  await t.test('failed issuance exposes the settled anonymous terminal state', async () => {
    const server = installServer();
    const app = makeApp();
    const appClient = await createSnapbackAppClient(optionsFor(app));
    try {
      server.respond('/auth/password/signin', () => (
        Response.json(server.credential({ token: SUPERVISED_BEARER }))
      ));
      await appClient.client.auth.authPasswordSignIn({
        email: 'supervised@example.com',
        password: PASSWORD,
      });
      __recordSupervisedBootstrapAdoptionForTests(appClient);
      server.respond('/auth/logout', () => new Response(null, { status: 204 }));
      server.respond('/auth/password/signin', () => Response.json({
        diagnostic: { code: 'SNAPBACK_AUTH_CREDENTIAL_INVALID', message: 'invalid credential' },
      }, { status: 401 }));
      await assert.rejects(
        appClient.auth.signInWithPassword({
          email: 'application@example.com',
          password: PASSWORD,
        }),
        (error) => error?.code === 'SNAPBACK_AUTH_ENTRY_FAILED'
          && error?.diagnostic?.details?.settledAnonymous === true,
      );
      assert.equal(appClient.auth.currentPrincipal().status, 'anonymous');
      assert.equal(appClient.bootstrapState().authoritySource, 'fresh-anonymous');
    } finally {
      await appClient.dispose();
      server.restore();
    }
  });
});

test('supervisor adoption arriving mid-entry is dropped, never deferred-then-adopted', async (t) => {
  await t.test('successful entry publishes no intermediate ready and drops the mid-entry adoption', async () => {
    const server = installServer();
    const app = makeApp();
    const appClient = await createSnapbackAppClient(optionsFor(app));
    try {
      server.respond('/auth/password/signin', () => (
        Response.json(server.credential({ token: SUPERVISED_BEARER }))
      ));
      await appClient.client.auth.authPasswordSignIn({
        email: 'supervised@example.com',
        password: PASSWORD,
      });
      __recordSupervisedBootstrapAdoptionForTests(appClient);
      const readySources = [];
      const unsubscribe = appClient.subscribeBootstrap(() => {
        const snapshot = appClient.bootstrapState();
        if (snapshot.status === 'ready') readySources.push(snapshot.authoritySource);
      });
      server.respond('/auth/logout', () => new Response(null, { status: 204 }));
      let adoption = null;
      server.respond('/auth/password/signin', () => {
        adoption = __adoptSupervisedBootstrapAuthority(appClient, {
          bearer: SUPERVISED_BEARER,
          binding: makeBinding(app),
        });
        return Response.json(server.credential({ token: APPLICATION_BEARER }));
      });
      await appClient.auth.signInWithPassword({
        email: 'application@example.com',
        password: PASSWORD,
      });
      unsubscribe();
      assert.deepEqual(await adoption, { status: 'dropped' });
      // The intermediate anonymous state is never published to bootstrap
      // subscribers: one predecessor -> successor exposure in this context.
      assert.equal(readySources.includes('fresh-anonymous'), false);
      assert.equal(readySources.at(-1), 'application-entry');
      assert.equal(appClient.auth.currentPrincipal().status, 'authenticated');
    } finally {
      await appClient.dispose();
      server.restore();
    }
  });

  await t.test('failed issuance drops the mid-entry adoption and stays settled anonymous', async () => {
    const server = installServer();
    const app = makeApp();
    const appClient = await createSnapbackAppClient(optionsFor(app));
    try {
      server.respond('/auth/password/signin', () => (
        Response.json(server.credential({ token: SUPERVISED_BEARER }))
      ));
      await appClient.client.auth.authPasswordSignIn({
        email: 'supervised@example.com',
        password: PASSWORD,
      });
      __recordSupervisedBootstrapAdoptionForTests(appClient);
      server.respond('/auth/logout', () => new Response(null, { status: 204 }));
      let adoption = null;
      server.respond('/auth/password/signin', () => {
        adoption = __adoptSupervisedBootstrapAuthority(appClient, {
          bearer: SUPERVISED_BEARER,
          binding: makeBinding(app),
        });
        return Response.json({
          diagnostic: { code: 'SNAPBACK_AUTH_CREDENTIAL_INVALID', message: 'invalid credential' },
        }, { status: 401 });
      });
      await assert.rejects(
        appClient.auth.signInWithPassword({
          email: 'application@example.com',
          password: PASSWORD,
        }),
        (error) => error?.code === 'SNAPBACK_AUTH_ENTRY_FAILED'
          && error?.diagnostic?.details?.settledAnonymous === true,
      );
      // Deferred-then-adopted is the forbidden path: the supervised persona
      // must not silently return as the failure fallback.
      assert.deepEqual(await adoption, { status: 'dropped' });
      assert.equal(appClient.auth.currentPrincipal().status, 'anonymous');
      assert.equal(appClient.bootstrapState().authoritySource, 'fresh-anonymous');
    } finally {
      await appClient.dispose();
      server.restore();
    }
  });
});

test('peer predecessor races surface the typed entry diagnostic and mid-entry remints only rebind', async (t) => {
  await t.test('peer adoption wins the intermediate anonymous predecessor', async () => {
    const server = installServer();
    const app = makeApp();
    const appClient = await createSnapbackAppClient(optionsFor(app));
    try {
      server.respond('/auth/password/signin', () => (
        Response.json(server.credential({ token: SUPERVISED_BEARER }))
      ));
      await appClient.client.auth.authPasswordSignIn({ email: 'supervised@example.com', password: PASSWORD });
      __recordSupervisedBootstrapAdoptionForTests(appClient);
      server.respond('/auth/logout', () => new Response(null, { status: 204 }));
      server.respond('/auth/password/signin', async () => {
        const coordinator = appClient.client.authCoordinator;
        const capture = coordinator.capture();
        await coordinator.transition(capture, {
          authority: {
            kind: 'session',
            authMode: 'sessions',
            authorizationStreamIncarnation: INCARNATION,
            sessionId: PEER_SESSION,
            userId: PEER_USER,
          },
          bearer: PEER_BEARER,
          refreshAfterMs: Date.now() + 60_000,
        }, 'peer-entry-test');
        return Response.json(server.credential({ token: APPLICATION_BEARER }));
      });
      await assert.rejects(
        appClient.auth.signInWithPassword({ email: 'application@example.com', password: PASSWORD }),
        (error) => error?.code === 'SNAPBACK_AUTH_ENTRY_FAILED'
          && error?.diagnostic?.details?.causeCode === 'SNAPBACK_CLIENT_AUTHORITY_STALE'
          && error?.diagnostic?.details?.principalStatus === 'authenticated',
      );
      assert.equal(appClient.auth.currentPrincipal().userId, PEER_USER);
      assert.equal(appClient.bootstrapState().authoritySource, 'external-transition');
    } finally {
      await appClient.dispose();
      server.restore();
    }
  });

  await t.test('successor binding resolves while composed entry is in flight', async () => {
    const server = installServer();
    const app = makeApp();
    const appClient = await createSnapbackAppClient(optionsFor(app));
    let reminted = null;
    try {
      server.respond('/auth/password/signin', () => (
        Response.json(server.credential({ token: SUPERVISED_BEARER }))
      ));
      await appClient.client.auth.authPasswordSignIn({ email: 'supervised@example.com', password: PASSWORD });
      __recordSupervisedBootstrapAdoptionForTests(appClient);
      server.respond('/auth/logout', () => new Response(null, { status: 204 }));
      const entered = deferred();
      const release = deferred();
      server.respond('/auth/password/signin', async () => {
        entered.resolve();
        await release.promise;
        return Response.json(server.credential({ token: APPLICATION_BEARER }));
      });
      const entry = appClient.auth.signInWithPassword({
        email: 'application@example.com',
        password: PASSWORD,
      });
      await entered.promise;
      const successorApp = makeApp({
        schema: 'sha256:schema-mid-entry',
        functions: 'sha256:functions-mid-entry',
        descriptor: 'sha256:descriptor-mid-entry',
      });
      const successorBinding = makeBinding(successorApp, {
        issuedAt: isoFromNow(180_000),
        expiresAt: isoFromNow(60 * 60_000),
      });
      reminted = await Promise.race([
        createSnapbackAppClient(optionsFor(successorApp, successorBinding)),
        new Promise((_, reject) => setTimeout(
          () => reject(new Error('mid-entry rebind waited for issuance')),
          250,
        )),
      ]);
      assert.equal(reminted.client, appClient.client);
      assert.equal(appClient.auth.currentPrincipal().status, 'refreshing');
      release.resolve();
      await entry;
      assert.equal(appClient.auth.currentPrincipal().status, 'authenticated');
    } finally {
      await reminted?.dispose();
      await appClient.dispose();
      server.restore();
    }
  });

  await t.test('displacement refuses when a peer replaces the exact supervised capture during logout preparation', async () => {
    const server = installServer();
    const app = makeApp();
    const appClient = await createSnapbackAppClient(optionsFor(app));
    try {
      server.respond('/auth/password/signin', () => (
        Response.json(server.credential({ token: SUPERVISED_BEARER }))
      ));
      await appClient.client.auth.authPasswordSignIn({
        email: 'supervised@example.com',
        password: PASSWORD,
      });
      __recordSupervisedBootstrapAdoptionForTests(appClient);

      const originalAuthSession = appClient.client.authSession.bind(appClient.client);
      let peerSettled = false;
      appClient.client.authSession = async (...args) => {
        if (!peerSettled) {
          peerSettled = true;
          const capture = appClient.client.authCoordinator.capture();
          await appClient.client.authCoordinator.transition(capture, {
            authority: {
              kind: 'session',
              authMode: 'sessions',
              authorizationStreamIncarnation: INCARNATION,
              sessionId: PEER_SESSION,
              userId: PEER_USER,
            },
            bearer: PEER_BEARER,
            refreshAfterMs: Date.now() + 60_000,
          }, 'peer-displacement-race');
        }
        return originalAuthSession(...args);
      };
      server.respond('/auth/logout', () => new Response(null, { status: 204 }));

      await assert.rejects(
        appClient.auth.signInWithPassword({
          email: 'application@example.com',
          password: PASSWORD,
        }),
        (error) => error?.code === 'SNAPBACK_AUTH_ENTRY_FAILED'
          && error?.diagnostic?.details?.causeCode === 'SNAPBACK_CLIENT_AUTHORITY_STALE'
          && error?.diagnostic?.details?.principalStatus === 'authenticated',
      );
      assert.equal(
        server.requests.filter(({ path }) => path === '/auth/logout').length,
        0,
        'the facade never sends logout for the peer successor',
      );
      assert.equal(appClient.client.authCoordinator.authority.userId, PEER_USER);
      assert.equal(appClient.auth.currentPrincipal().userId, PEER_USER);
    } finally {
      await appClient.dispose();
      server.restore();
    }
  });
});

test('aborting construction during custody synchronization closes its partial coordinator', async () => {
  const server = installServer();
  const app = makeApp();
  const controller = new AbortController();
  const entered = deferred();
  const never = deferred();
  const originalSynchronize = AuthCoordinator.prototype.synchronize;
  const originalClose = AuthCoordinator.prototype.close;
  let closed = 0;
  AuthCoordinator.prototype.synchronize = async function synchronizeUntilAbort() {
    entered.resolve();
    return never.promise;
  };
  AuthCoordinator.prototype.close = async function closeObservedCoordinator(...args) {
    closed += 1;
    return originalClose.apply(this, args);
  };
  try {
    const construction = createSnapbackAppClient(optionsFor(app, makeBinding(app), {
      signal: controller.signal,
    }));
    await entered.promise;
    controller.abort();
    await assert.rejects(
      construction,
      (error) => error?.name === 'AbortError',
    );
    assert.equal(closed, 1, 'the partially constructed AuthCoordinator is closed on abort');
  } finally {
    AuthCoordinator.prototype.synchronize = originalSynchronize;
    AuthCoordinator.prototype.close = originalClose;
    server.restore();
  }
});

console.log('snapback-client application auth bootstrap tests: ok');
