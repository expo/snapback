import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  AuthCoordinator,
  createMemoryAuthCustodyStorage,
} from '@expo/snapback-contract/auth-coordinator';

import { SnapbackClient } from './index.mjs';

const APP_ID = '018f0d90-7b20-7a22-8c33-445566778899';
const INCARNATION = '018f0d90-7b21-7a22-8c33-445566778899';
const SESSION = '018f0d90-7b22-7a22-8c33-445566778899';
const USER = '018f0d90-7b23-7a22-8c33-445566778899';
const AUTHORITY = '018f0d90-7b24-7a22-8c33-445566778899';
const OTHER_AUTHORITY = '018f0d90-7b25-7a22-8c33-445566778899';
const SIGNUP_BEARER = 'sbs_password_signup_secret';
const CHANGE_BEARER = 'sbs_password_change_secret';
const PASSWORD = 'a-password-that-must-not-leak';
const NEW_PASSWORD = 'another-password-that-must-not-leak';

const recoveryCodes = Object.freeze(Array.from({ length: 8 }, (_, index) => (
  `sbrv1_${String(index).padStart(2, '0')}${'A'.repeat(25)}`
)));

const flushMicrotasks = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

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

const deploymentIdentity = Object.freeze({
  schemaVersion: 'snapback.v1',
  authMode: 'sessions',
  appId: APP_ID,
  schemaHash: `snapback.v1:sessions:schema:sha256:${'1'.repeat(64)}`,
  bundleHash: `snapback.v1:sessions:function:sha256:${'2'.repeat(64)}`,
  inputsHash: `snapback.v1:sessions:inputs:sha256:${'3'.repeat(64)}`,
});

const handshake = ({ bearer = null } = {}) => ({
  protocolVersion: 1,
  serverStartupNonce: 'password-auth-client-test',
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
  authority: bearer === null
    ? { kind: 'anonymous', userId: null, sessionId: null, isAuthenticated: false }
    : { kind: 'humanSession', userId: USER, sessionId: SESSION, isAuthenticated: true },
  authorityDescriptor: {
    descriptorVersion: 1,
    authorityInstanceId: bearer === null ? INCARNATION : AUTHORITY,
    sessionGeneration: bearer === null ? 0 : 1,
  },
  deploymentIdentity,
  authorizedLease: null,
});

const credential = ({
  token = SIGNUP_BEARER,
  authorityInstanceId = AUTHORITY,
  sessionId = SESSION,
  codes = null,
  extra = null,
} = {}) => ({
  tokenType: 'Bearer',
  token,
  refreshAfter: Date.now() + 60_000,
  session: {
    id: sessionId,
    userId: USER,
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
  ...(extra === null ? {} : extra),
});

const makeFixture = ({ senderConstrained = false } = {}) => {
  const originalFetch = globalThis.fetch;
  const routeHandlers = new Map();
  const knownBearers = new Set([SIGNUP_BEARER, CHANGE_BEARER]);
  const requests = [];
  globalThis.fetch = async (url, init = {}) => {
    const path = new URL(url).pathname;
    const headers = new Headers(init.headers);
    const authorization = headers.get('authorization');
    const bearer = authorization?.replace(/^Bearer /u, '') ?? null;
    const body = init.body === undefined ? undefined : JSON.parse(init.body);
    requests.push({ path, authorization, body });
    if (path === '/auth/session') {
      return Response.json(handshake({ bearer: knownBearers.has(bearer) ? bearer : null }));
    }
    const handler = routeHandlers.get(path);
    if (!handler) throw new Error(`unexpected password-auth request: ${path}`);
    return handler({ authorization, bearer, body });
  };
  const coordinator = new AuthCoordinator({
    appId: APP_ID,
    storage: createMemoryAuthCustodyStorage(),
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  const client = new SnapbackClient('https://password-auth.test', {
    authCoordinator: coordinator,
    authClientProtocol: 1,
    authorityDescriptorProtocol: 1,
    senderConstrained,
    rqsStore: null,
    offlineQueue: false,
  });
  return {
    client,
    coordinator,
    requests,
    respond(path, handler) { routeHandlers.set(path, handler); },
    async close() {
      globalThis.fetch = originalFetch;
      await client.closeAuth();
    },
  };
};

test('password signup adopts the server principal without exposing the bearer', async () => {
  const fixture = makeFixture();
  try {
    fixture.respond('/auth/password/signup', ({ body }) => {
      assert.deepEqual(body, { email: 'person@example.com', password: PASSWORD });
      return Response.json(credential({ codes: recoveryCodes }));
    });
    const result = await fixture.client.authPasswordSignup({
      email: 'person@example.com',
      password: PASSWORD,
    });
    assert.equal(result.session.userId, USER);
    assert.equal(fixture.coordinator.authority.userId, USER);
    assert.equal(Object.hasOwn(result, 'token'), false);
    assert.equal(JSON.stringify(result).includes(SIGNUP_BEARER), false);
    assert.deepEqual(result.recoveryCodes, recoveryCodes);
    for (const code of recoveryCodes) {
      assert.equal(JSON.stringify(result.session).includes(code), false);
      assert.equal(JSON.stringify(result.authorityDescriptor).includes(code), false);
    }
  } finally {
    await fixture.close();
  }
});

test('client.auth is a vocabulary-only projection with exact flat-method contracts', async () => {
  const fixture = makeFixture();
  try {
    assert.deepEqual(Object.keys(fixture.client.auth).sort(), [
      'authExchange',
      'authLogout',
      'authPasswordChange',
      'authPasswordReset',
      'authPasswordSet',
      'authPasswordSignIn',
      'authPasswordSignup',
      'authRecoveryConsume',
      'authRecoveryRotate',
      'authRefresh',
      'authRequestCode',
      'authSession',
      'authTerminalStatus',
      'currentPrincipal',
      'subscribeAuthTerminal',
      'subscribeCurrentPrincipal',
    ]);
    assert.deepEqual(fixture.client.auth.currentPrincipal(), { status: 'loading' });
    const notifications = [];
    const unsubscribe = fixture.client.auth.subscribeCurrentPrincipal(() => {
      notifications.push(fixture.client.auth.currentPrincipal().status);
    });
    assert.deepEqual(notifications, [], 'subscribe never notifies synchronously');
    await flushMicrotasks();
    assert.deepEqual(notifications, ['loading'], 'subscribe queues exactly one current snapshot');
    fixture.respond('/auth/password/signup', () => (
      Response.json(credential({ codes: recoveryCodes }))
    ));
    const result = await fixture.client.auth.authPasswordSignup({
      email: 'person@example.com',
      password: PASSWORD,
    });
    assert.deepEqual(result.recoveryCodes, recoveryCodes);
    assert.equal(Object.hasOwn(result, 'token'), false);
    assert.equal(fixture.client.auth.currentPrincipal().status, 'authenticated');
    assert.equal(fixture.client.auth.currentPrincipal().expiresAt, result.session.expiresAt);
    fixture.respond('/auth/logout', () => new Response(null, { status: 204 }));
    assert.equal(await fixture.client.auth.authLogout(), null);
    assert.equal(fixture.client.auth.currentPrincipal().status, 'anonymous');
    await flushMicrotasks();
    assert.deepEqual(notifications, [
      'loading',
      'anonymous',
      'loading',
      'authenticated',
      'authenticated',
      'loading',
      'anonymous',
    ]);
    unsubscribe();
  } finally {
    await fixture.close();
  }
});

test('principal notifications defer outside authority commits, dedupe semantic repeats, and stop at close', async (t) => {
  await t.test('listener reentry is outside the authority fence and each distinct projection notifies once', async () => {
    const fixture = makeFixture();
    try {
      const observations = [];
      let clearedReentrantly = false;
      const unsubscribe = fixture.client.auth.subscribeCurrentPrincipal(() => {
        const status = fixture.client.auth.currentPrincipal().status;
        observations.push(status);
        if (status === 'anonymous' && !clearedReentrantly) {
          clearedReentrantly = true;
          fixture.client.clearAuthSession();
        }
      });
      assert.deepEqual(observations, []);
      await flushMicrotasks();
      assert.deepEqual(observations, ['loading']);

      await fixture.client.auth.authSession();
      await flushMicrotasks();
      assert.deepEqual(
        observations,
        ['loading', 'anonymous', 'loading'],
        'reentrant clearing succeeds from the deferred listener',
      );

      await fixture.client.auth.authSession({ force: true });
      await flushMicrotasks();
      const afterDistinctAnonymous = observations.length;
      await fixture.client.auth.authSession({ force: true });
      await flushMicrotasks();
      assert.equal(
        observations.length,
        afterDistinctAnonymous,
        'an identical cold-handshake projection does not double-publish',
      );
      unsubscribe();
    } finally {
      await fixture.close();
    }
  });

  await t.test('a queued initial notification is fenced by close', async () => {
    const fixture = makeFixture();
    let notifications = 0;
    fixture.client.auth.subscribeCurrentPrincipal(() => { notifications += 1; });
    await fixture.client.closeAuth();
    await flushMicrotasks();
    assert.equal(notifications, 0);
    await fixture.close();
  });
});

test('failed credential adoption projects the transition terminal instead of stranding loading', async () => {
  const fixture = makeFixture();
  try {
    await fixture.client.auth.authSession();
    fixture.client.registerAuthBarrierParticipant({
      name: 'failing-credential-adoption-resume',
      resume() {
        const error = new Error('resume participant refused the successor');
        error.code = 'SNAPBACK_TEST_RESUME_REFUSED';
        throw error;
      },
    });
    fixture.respond('/auth/password/signup', () => (
      Response.json(credential({ codes: recoveryCodes }))
    ));
    await assert.rejects(
      fixture.client.auth.authPasswordSignup({
        email: 'person@example.com',
        password: PASSWORD,
      }),
      (error) => error?.code === 'SNAPBACK_AUTH_TRANSITION_FAILED'
        && error?.diagnostic?.details?.phase === 'resume',
    );
    const principal = fixture.client.auth.currentPrincipal();
    assert.equal(principal.status, 'blocked');
    assert.equal(principal.diagnostic.code, 'SNAPBACK_AUTH_TRANSITION_FAILED');
    assert.equal(principal.diagnostic.details.phase, 'resume');
    assert.equal(principal.diagnostic.details.causeCode, 'SNAPBACK_TEST_RESUME_REFUSED');
    assert.equal(principal.remediations[0].kind, 'repairAuthTransitionParticipant');
  } finally {
    await fixture.close();
  }
});

test('blocked principals preserve safe cause facts and original remediation without secret bytes', async () => {
  const fixture = makeFixture();
  const secret = 'sbs_blocked_projection_secret';
  try {
    const failure = new Error('durable custody failed its monotonicity check');
    failure.code = 'SNAPBACK_AUTH_CUSTODY_CORRUPT';
    failure.diagnostic = Object.freeze({
      code: failure.code,
      message: 'Durable custody failed its monotonicity check.',
      details: Object.freeze({
        phase: 'custody-read',
        causeCode: 'SNAPBACK_AUTH_CUSTODY_REVISION_REWOUND',
        bearer: secret,
      }),
    });
    failure.remediations = Object.freeze([Object.freeze({
      kind: 'recoverAuthCustody',
      riskClass: 'destructive',
      machineApplicable: false,
      requiresApproval: true,
      authorityEffect: 'clears-session',
      precondition: Object.freeze({
        causeCode: 'SNAPBACK_AUTH_CUSTODY_REVISION_REWOUND',
        bearer: secret,
      }),
      description: 'Recover the corrupt durable custody record with explicit approval.',
    })]);
    fixture.coordinator.synchronize = async () => { throw failure; };

    await assert.rejects(
      fixture.client.auth.authSession({ force: true }),
      (error) => error === failure,
    );
    const blocked = fixture.client.auth.currentPrincipal();
    assert.equal(blocked.status, 'blocked');
    assert.equal(blocked.diagnostic.message, failure.diagnostic.message);
    assert.deepEqual(blocked.diagnostic.details, {
      phase: 'custody-read',
      causeCode: 'SNAPBACK_AUTH_CUSTODY_REVISION_REWOUND',
    });
    assert.equal(blocked.remediations[0].kind, 'recoverAuthCustody');
    assert.equal(blocked.remediations[0].precondition.causeCode, 'SNAPBACK_AUTH_CUSTODY_REVISION_REWOUND');
    assert.equal(JSON.stringify(blocked).includes(secret), false);
  } finally {
    await fixture.close();
  }
});

test('closeAuth terminally drains realtime demand owned by the client', async () => {
  const fixture = makeFixture();
  let managerClosed = false;
  let rawStreamClosed = false;
  try {
    fixture.client.__connectionGrants.set('retained-connection', Promise.resolve({
      id: 'retained-connection',
      token: 'retained-token',
    }));
    fixture.client.__laneConsumers.set('retained-connection', {
      durable: new Set([() => {}]),
      ephemeral: new Set(),
    });
    fixture.client.__liveStreamManagers = new Map([['retained-connection', {
      close() { managerClosed = true; },
      settled() {
        assert.equal(managerClosed, true, 'settlement cannot precede manager close');
        return Promise.resolve();
      },
    }]]);
    fixture.client.__rawLiveStreams.add({
      close() { rawStreamClosed = true; },
    });

    await fixture.client.closeAuth();

    assert.equal(managerClosed, true);
    assert.equal(rawStreamClosed, true);
    assert.equal(fixture.client.__liveStreamManagers.size, 0);
    assert.equal(fixture.client.__connectionGrants.size, 0);
    assert.equal(fixture.client.__laneConsumers.size, 0);
  } finally {
    await fixture.close();
  }
});

test('password signin, immediate logout, and signin serialize in one process', async () => {
  const fixture = makeFixture();
  try {
    fixture.respond('/auth/password/signin', () => Response.json(credential()));
    fixture.respond('/auth/logout', ({ authorization }) => {
      assert.equal(authorization, `Bearer ${SIGNUP_BEARER}`);
      return new Response(null, { status: 204 });
    });

    const first = await fixture.client.authPasswordSignIn({
      email: 'person@example.com',
      password: PASSWORD,
    });
    assert.equal(first.session.userId, USER);
    assert.equal(await fixture.client.authLogout(), null);
    assert.equal(fixture.coordinator.authority.kind, 'anonymous');
    const second = await fixture.client.authPasswordSignIn({
      email: 'person@example.com',
      password: PASSWORD,
    });
    assert.equal(second.session.userId, USER);
    assert.equal(fixture.coordinator.authority.kind, 'session');
  } finally {
    await fixture.close();
  }
});

test('password change uses credential rotation and rejects authority mismatch', async (t) => {
  await t.test('preserves the authority instance and replaces only bearer custody', async () => {
    const fixture = makeFixture();
    try {
      fixture.respond('/auth/password/signup', () => (
        Response.json(credential({ codes: recoveryCodes }))
      ));
      await fixture.client.authPasswordSignup({
        email: 'person@example.com',
        password: PASSWORD,
      });
      let rotations = 0;
      const withCredentialRotation = fixture.coordinator.withCredentialRotation
        .bind(fixture.coordinator);
      fixture.coordinator.withCredentialRotation = (...args) => {
        rotations += 1;
        return withCredentialRotation(...args);
      };
      fixture.respond('/auth/password/change', ({ authorization, body }) => {
        assert.equal(authorization, `Bearer ${SIGNUP_BEARER}`);
        assert.deepEqual(body, {
          currentPassword: PASSWORD,
          newPassword: NEW_PASSWORD,
        });
        return Response.json(credential({ token: CHANGE_BEARER }));
      });
      const result = await fixture.client.authPasswordChange({
        currentPassword: PASSWORD,
        newPassword: NEW_PASSWORD,
      });
      assert.equal(rotations, 1);
      assert.equal(result.authorityDescriptor.authorityInstanceId, AUTHORITY);
      assert.equal(Object.hasOwn(result, 'token'), false);
      const current = fixture.coordinator.credentialFor(fixture.coordinator.capture());
      assert.equal(current.bearer, CHANGE_BEARER);
      assert.equal(current.authority.sessionId, SESSION);
      assert.equal(current.authority.userId, USER);
    } finally {
      await fixture.close();
    }
  });

  await t.test('refuses a changed authority instance without replacing custody', async () => {
    const fixture = makeFixture();
    try {
      fixture.respond('/auth/password/signup', () => (
        Response.json(credential({ codes: recoveryCodes }))
      ));
      await fixture.client.authPasswordSignup({
        email: 'person@example.com',
        password: PASSWORD,
      });
      fixture.respond('/auth/password/change', () => Response.json(credential({
        token: CHANGE_BEARER,
        authorityInstanceId: OTHER_AUTHORITY,
      })));
      await assert.rejects(
        fixture.client.authPasswordChange({
          currentPassword: PASSWORD,
          newPassword: NEW_PASSWORD,
        }),
        (error) => error?.code === 'SNAPBACK_AUTH_CREDENTIAL_RESPONSE_INVALID',
      );
      assert.equal(
        fixture.coordinator.credentialFor(fixture.coordinator.capture()).bearer,
        SIGNUP_BEARER,
      );
    } finally {
      await fixture.close();
    }
  });
});

test('recovery credential projection stays six-key strict and secret-safe', async (t) => {
  await t.test('accepts the exact recovery shape and rejects every other extra key', async () => {
    const accepted = makeFixture();
    try {
      accepted.respond('/auth/password/signup', () => (
        Response.json(credential({ codes: recoveryCodes }))
      ));
      const result = await accepted.client.authPasswordSignup({
        email: 'person@example.com',
        password: PASSWORD,
      });
      assert.deepEqual(result.recoveryCodes, recoveryCodes);
    } finally {
      await accepted.close();
    }

    const refused = makeFixture();
    try {
      refused.respond('/auth/password/signup', () => Response.json(credential({
        codes: recoveryCodes,
        extra: { smuggled: 'field' },
      })));
      await assert.rejects(
        refused.client.authPasswordSignup({
          email: 'person@example.com',
          password: PASSWORD,
        }),
        (error) => {
          assert.equal(error?.code, 'SNAPBACK_AUTH_CREDENTIAL_RESPONSE_INVALID');
          const payload = JSON.stringify({
            message: error.message,
            diagnostic: error.diagnostic,
          });
          for (const code of recoveryCodes) assert.equal(payload.includes(code), false);
          return true;
        },
      );
      assert.equal(refused.coordinator.authority.kind, 'anonymous');
    } finally {
      await refused.close();
    }
  });

  await t.test('redacts recovery-code fields from server error payloads', async () => {
    const fixture = makeFixture();
    try {
      fixture.respond('/auth/password/signin', () => Response.json({
        diagnostic: {
          code: 'SNAPBACK_AUTH_CREDENTIAL_INVALID',
          message: 'credential invalid',
          details: { recoveryCodes: [...recoveryCodes] },
        },
      }, { status: 401 }));
      await assert.rejects(
        fixture.client.authPasswordSignIn({
          email: 'person@example.com',
          password: PASSWORD,
        }),
        (error) => {
          const payload = JSON.stringify({
            message: error.message,
            diagnostic: error.diagnostic,
          });
          for (const code of recoveryCodes) assert.equal(payload.includes(code), false);
          assert.equal(payload.includes(PASSWORD), false);
          return true;
        },
      );
    } finally {
      await fixture.close();
    }
  });
});

test('password methods refuse sender-constrained custody with a typed error', async () => {
  const fixture = makeFixture({ senderConstrained: true });
  try {
    await assert.rejects(
      fixture.client.authPasswordSignup({
        email: 'person@example.com',
        password: PASSWORD,
      }),
      (error) => (
        error?.code === 'SNAPBACK_AUTH_PASSWORD_SENDER_CONSTRAINED_UNSUPPORTED'
        && error?.diagnostic?.code === error.code
      ),
    );
    assert.equal(fixture.requests.length, 0);
  } finally {
    await fixture.close();
  }
});

console.log('snapback-client password auth tests: ok');
