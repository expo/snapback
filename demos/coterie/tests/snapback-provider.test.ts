import { describe, expect, test } from 'bun:test';

import type { DataCellV2 } from '@exact/contract/runtime';

import {
  AuthCoordinator,
  createMemoryAuthCustodyStorage,
} from '../../../packages/snapback-contract/auth-coordinator.mjs';
import {
  coterieSnapbackTestInternals,
  createCoterieSnapbackProvider,
} from '../src/data/snapback-provider.ts';

function diagnostic(code: string, appCode?: string): Error & {
  code: string;
  diagnostic: { code: string; details: { appCode?: string } };
} {
  const error = new Error(code) as Error & {
    code: string;
    diagnostic: { code: string; details: { appCode?: string } };
  };
  error.code = code;
  error.diagnostic = { code, details: { ...(appCode ? { appCode } : {}) } };
  return error;
}

describe('Snapback adapter diagnostic allow-lists', () => {
  test('unknown auth and asset diagnostics never masquerade as declared recovery errors', () => {
    for (const operation of ['login', 'editProfile', 'setAvatar']) {
      expect(
        coterieSnapbackTestInternals.declaredError(
          operation,
          diagnostic('SNAPBACK_AUTH_PROVIDER_UNAVAILABLE'),
        ).name,
      ).toBe('SnapbackProviderError');
    }
    expect(
      coterieSnapbackTestInternals.declaredError(
        'setAvatar',
        diagnostic('SNAPBACK_ASSET_STORE_UNAVAILABLE'),
      ).name,
    ).toBe('SnapbackProviderError');
    expect(
      coterieSnapbackTestInternals.declaredError(
        'editProfile',
        diagnostic('SNAPBACK_APPLICATION_REJECTED', 'PROFILE_NOT_OWNED'),
      ).name,
    ).toBe('SnapbackProviderError');
  });

  test('only semantically exact diagnostics enter declared error buckets', () => {
    expect(
      coterieSnapbackTestInternals.declaredError(
        'login',
        diagnostic('SNAPBACK_AUTH_CREDENTIAL_INVALID'),
      ).name,
    ).toBe('InvalidCredentialsError');
    for (const operation of ['editProfile', 'setAvatar']) {
      for (const code of [
        'SNAPBACK_AUTH_SESSION_EXPIRED',
        'SNAPBACK_AUTH_SESSION_REVOKED',
      ]) {
        expect(
          coterieSnapbackTestInternals.declaredError(operation, diagnostic(code)).name,
        ).toBe('SessionRequiredError');
      }
    }
    for (const code of [
      'SNAPBACK_ASSET_MEDIA_BOUNDS_EXCEEDED',
      'SNAPBACK_ASSET_MEDIA_TYPE_UNSUPPORTED',
    ]) {
      expect(
        coterieSnapbackTestInternals.declaredError('setAvatar', diagnostic(code)).name,
      ).toBe('AvatarReferenceInvalidError');
    }
    expect(
      coterieSnapbackTestInternals.declaredError(
        'signup',
        diagnostic('SNAPBACK_AUTH_PASSWORD_EXISTS'),
      ).name,
    ).toBe('DuplicateEmailError');
    expect(
      coterieSnapbackTestInternals.declaredError(
        'signup',
        diagnostic('SNAPBACK_AUTH_PASSWORD_POLICY'),
      ).name,
    ).toBe('PasswordTooShortError');
  });
});

test('login validation preserves password bytes and uses login vocabulary', () => {
  const password = '  exact bytes survive  ';
  expect(coterieSnapbackTestInternals.validateLoginInput({
    email: '  User@Example.Test ',
    password,
  })).toEqual({ email: 'user@example.test', password });
  expect(() => coterieSnapbackTestInternals.validateLoginInput({
    email: 'not-an-email',
    password: 'long enough',
  })).toThrow(expect.objectContaining({ name: 'InvalidCredentialsError' }));
});

test('avatar media sniffing admits only PNG, JPEG, and WebP byte signatures', () => {
  expect(coterieSnapbackTestInternals.sniffAvatarMediaType(
    Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).buffer,
  )).toBe('image/png');
  expect(coterieSnapbackTestInternals.sniffAvatarMediaType(
    Uint8Array.from([0xff, 0xd8, 0xff]).buffer,
  )).toBe('image/jpeg');
  expect(coterieSnapbackTestInternals.sniffAvatarMediaType(
    Uint8Array.from([
      0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50,
    ]).buffer,
  )).toBe('image/webp');
  expect(() => coterieSnapbackTestInternals.sniffAvatarMediaType(
    new TextEncoder().encode('not an image').buffer,
  )).toThrow(expect.objectContaining({ name: 'AvatarReferenceInvalidError' }));
});

const AUTH_INCARNATION = '018f0d90-7b11-7a22-8c33-445566778899';
const SESSION_A = '018f0d90-7b12-7a22-8c33-445566778899';
const SESSION_B = '018f0d90-7b13-7a22-8c33-445566778899';
const USER_A = '018f0d90-7b14-7a22-8c33-445566778899';
const USER_B = '018f0d90-7b15-7a22-8c33-445566778899';

const anonymousAuthority = () => ({
  kind: 'anonymous' as const,
  authMode: 'sessions' as const,
  authorizationStreamIncarnation: AUTH_INCARNATION,
});

const sessionAuthority = (sessionId: string, userId: string) => ({
  kind: 'session' as const,
  authMode: 'sessions' as const,
  authorizationStreamIncarnation: AUTH_INCARNATION,
  sessionId,
  userId,
});

async function missedWakeupScenario(appId: string) {
  const state = { custody: {} };
  const writer = new AuthCoordinator({
    appId,
    storage: createMemoryAuthCustodyStorage({ state }),
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  const local = new AuthCoordinator({
    appId,
    storage: createMemoryAuthCustodyStorage({ state }),
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  const anonymousCapture = await writer.establishAnonymous(anonymousAuthority());
  const captureA = await writer.transition(anonymousCapture, {
    authority: sessionAuthority(SESSION_A, USER_A),
    bearer: 'session-a-bearer',
    refreshAfterMs: 10_000,
  }, 'test_install_predecessor_a');
  await local.synchronize();
  return { captureA, local, writer };
}

function currentCoordinatorPrincipal(coordinator: AuthCoordinator) {
  const authority = coordinator.settledView().authority;
  return authority.kind === 'anonymous'
    ? { status: 'anonymous' as const }
    : { status: 'authenticated' as const, sessionId: authority.sessionId };
}

for (const authPath of [
  {
    label: 'failed auth processing rollback',
    reason: 'coterie_login_processing_failed',
  },
  {
    label: 'logout',
    reason: 'coterie_logout_terminal',
  },
] as const) {
  test(`${authPath.label} adopts durable successor B after a missed wakeup`, async () => {
    const scenario = await missedWakeupScenario(`snapback.test/coterie-${authPath.reason}`);
    try {
      await scenario.writer.transition(scenario.captureA, {
        authority: sessionAuthority(SESSION_B, USER_B),
        bearer: 'session-b-bearer',
        refreshAfterMs: 20_000,
      }, 'peer_installs_successor_b');
      expect(scenario.local.settledView().authority).toMatchObject({ sessionId: SESSION_A });

      const projections: string[] = [];
      const reconciliationSteps: string[] = [];
      const outcome = await coterieSnapbackTestInternals.clearCapturedAuthorityAndReconcile(
        {
          async compareAndClear(capture, reason) {
            reconciliationSteps.push(`clear:${reason}`);
            const result = await scenario.local.compareAndClear(capture, reason);
            expect(result).toEqual({ cleared: false });
            expect(scenario.local.settledView().authority).toMatchObject({
              sessionId: SESSION_A,
            });
            return result;
          },
          async synchronize() {
            reconciliationSteps.push('synchronize');
            return scenario.local.synchronize();
          },
        },
        scenario.captureA,
        authPath.reason,
        {
          currentPrincipal: () => {
            reconciliationSteps.push('currentPrincipal');
            return currentCoordinatorPrincipal(scenario.local);
          },
          publishAnonymous: () => projections.push('anonymous'),
          refreshNonAnonymous: () => {
            reconciliationSteps.push('refreshNonAnonymous');
            const principal = currentCoordinatorPrincipal(scenario.local);
            projections.push(
              principal.status === 'authenticated' ? principal.sessionId : principal.status,
            );
          },
        },
      );

      expect(outcome).toEqual({ cleared: false, clearError: null });
      expect(scenario.local.settledView().authority).toMatchObject({ sessionId: SESSION_B });
      expect(projections).toEqual([SESSION_B]);
      expect(reconciliationSteps).toEqual([
        `clear:${authPath.reason}`,
        'synchronize',
        'currentPrincipal',
        'refreshNonAnonymous',
      ]);
    } finally {
      await scenario.local.close();
      await scenario.writer.close();
    }
  });
}

test('reconciliation publishes empty projections when missed durable state is anonymous', async () => {
  const scenario = await missedWakeupScenario('snapback.test/coterie-anonymous-reconcile');
  try {
    await scenario.writer.transition(
      scenario.captureA,
      { authority: anonymousAuthority(), bearer: null, refreshAfterMs: null },
      'peer_installs_anonymous_successor',
    );
    expect(scenario.local.settledView().authority).toMatchObject({ sessionId: SESSION_A });

    const projections: string[] = [];
    const outcome = await coterieSnapbackTestInternals.clearCapturedAuthorityAndReconcile(
      scenario.local,
      scenario.captureA,
      'coterie_logout_terminal',
      {
        currentPrincipal: () => currentCoordinatorPrincipal(scenario.local),
        publishAnonymous: () => projections.push('empty-session', 'stopped-profiles'),
        refreshNonAnonymous: () => projections.push('unexpected-refresh'),
      },
    );

    expect(outcome).toEqual({ cleared: true, clearError: null });
    expect(scenario.local.settledView().authority.kind).toBe('anonymous');
    expect(projections).toEqual(['empty-session', 'stopped-profiles']);
  } finally {
    await scenario.local.close();
    await scenario.writer.close();
  }
});

test('disposed initialization subscriptions receive no late rejection cell', async () => {
  const provider = createCoterieSnapbackProvider({
    baseUrl: 'http://127.0.0.1:1',
    custody: 'memory',
  });
  const sessionCells: DataCellV2<unknown>[] = [];
  const profileCells: DataCellV2<unknown>[] = [];
  const session = provider.subscribe('listSession', {}, (cell) => sessionCells.push(cell));
  const profiles = provider.subscribe('listProfiles', {}, (cell) => profileCells.push(cell));
  session.dispose();
  profiles.dispose();
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(sessionCells).toHaveLength(1);
  expect(sessionCells[0]).toMatchObject({ status: 'pending', connection: 'connecting' });
  expect(profileCells).toHaveLength(1);
  expect(profileCells[0]).toMatchObject({ status: 'pending', connection: 'connecting' });
  await provider.close();
});
