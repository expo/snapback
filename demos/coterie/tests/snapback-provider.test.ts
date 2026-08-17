import { describe, expect, test } from 'bun:test';

import type { DataCellV2 } from '@exact/contract/runtime';

import {
  AuthCoordinator,
  createMemoryAuthCustodyStorage,
} from '../../../packages/snapback-contract/auth-coordinator.mjs';
import {
  COTERIE_SNAPBACK_CLAIMED_OPERATIONS,
  COTERIE_SNAPBACK_M1_OPERATIONS,
  COTERIE_SNAPBACK_M2_OPERATIONS,
  COTERIE_SNAPBACK_M3_OPERATIONS,
  coterieSnapbackTestInternals,
  createCoterieSnapbackProvider,
} from '../src/data/snapback-provider.ts';
import { coterieSurfaceManifest } from '../src/data/memory-provider.ts';

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
    for (const operation of ['login', 'editProfile', 'setAvatar', 'createPost', 'setRepost']) {
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
    expect(
      coterieSnapbackTestInternals.declaredError(
        'setLike',
        diagnostic('SNAPBACK_APPLICATION_REJECTED', 'SELF_FOLLOW_FORBIDDEN'),
      ).name,
    ).toBe('SnapbackProviderError');
    expect(
      coterieSnapbackTestInternals.declaredError(
        'removeMember',
        diagnostic('SNAPBACK_APPLICATION_REJECTED', 'LAST_GROUP_ADMIN'),
      ).name,
    ).toBe('SnapbackProviderError');
    expect(
      coterieSnapbackTestInternals.declaredError(
        'markReceipt',
        diagnostic('SNAPBACK_APPLICATION_REJECTED', 'MESSAGE_RECEIPT_NOT_RECIPIENT'),
      ).name,
    ).toBe('SnapbackProviderError');
    expect(
      coterieSnapbackTestInternals.declaredError(
        'createGroup',
        diagnostic('SNAPBACK_APP_REFUSAL', 'CHAT_ENVELOPE_EXCEEDED'),
      ).name,
    ).toBe('SnapbackProviderError');
    expect(
      coterieSnapbackTestInternals.declaredError(
        'sendMessage',
        diagnostic('SNAPBACK_APP_REFUSAL', 'MESSAGE_ENVELOPE_EXCEEDED'),
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
    const exactApplicationMappings = [
      ['createPost', 'POST_BODY_TOO_LONG', 'PostBodyInvalidError'],
      ['createPost', 'POST_IMAGE_COUNT_INVALID', 'ImageCountInvalidError'],
      ['createPost', 'POST_MEDIA_MIXED', 'MediaMixInvalidError'],
      ['createPost', 'POST_KIND_MEDIA_MISMATCH', 'MediaReferenceInvalidError'],
      ['createPost', 'POST_KIND_INVALID', 'MediaReferenceInvalidError'],
      ['createPost', 'POST_PARENT_NOT_FOUND', 'ParentPostNotFoundError'],
      ['setFollow', 'PROFILE_NOT_FOUND', 'ProfileNotFoundError'],
      ['setFollow', 'SELF_FOLLOW_FORBIDDEN', 'SelfFollowInvalidError'],
      ['setLike', 'POST_NOT_FOUND', 'PostNotFoundError'],
      ['setRepost', 'POST_NOT_FOUND', 'PostNotFoundError'],
      ['setRepost', 'REPLY_REPOST_FORBIDDEN', 'ReplyRepostForbiddenError'],
      ['openDm', 'SELF_DM_FORBIDDEN', 'DirectMessageSelfError'],
      ['openDm', 'PROFILE_NOT_FOUND', 'ProfileNotFoundError'],
      ['createGroup', 'GROUP_NAME_INVALID', 'GroupNameInvalidError'],
      ['createGroup', 'GROUP_DESCRIPTION_TOO_LONG', 'GroupDescriptionInvalidError'],
      ['createGroup', 'GROUP_SIZE_INVALID', 'GroupMembersInvalidError'],
      ['addMember', 'NOT_GROUP_ADMIN', 'ChatAdminRequiredError'],
      ['addMember', 'NOT_GROUP_CHAT', 'GroupRequiredError'],
      ['addMember', 'CHAT_NOT_FOUND', 'ChatNotFoundError'],
      ['addMember', 'MEMBER_ALREADY_EXISTS', 'ChatMemberAlreadyExistsError'],
      ['addMember', 'GROUP_MEMBER_LIMIT_REACHED', 'ChatMemberLimitError'],
      ['removeMember', 'CHAT_NOT_FOUND', 'ChatNotFoundError'],
      ['removeMember', 'MEMBER_NOT_FOUND', 'ChatMemberNotFoundError'],
      ['removeMember', 'REMOVE_SELF_WITH_LEAVE', 'RemoveSelfInvalidError'],
      ['promoteAdmin', 'CHAT_NOT_FOUND', 'ChatNotFoundError'],
      ['promoteAdmin', 'MEMBER_NOT_FOUND', 'ChatMemberNotFoundError'],
      ['leaveChat', 'CHAT_NOT_FOUND', 'ChatNotFoundError'],
      ['leaveChat', 'CHAT_MEMBERSHIP_REQUIRED', 'ChatMembershipRequiredError'],
      ['sendMessage', 'CHAT_NOT_FOUND', 'ChatNotFoundError'],
      ['sendMessage', 'MESSAGE_BODY_REQUIRED', 'MessageBodyInvalidError'],
      ['sendMessage', 'MESSAGE_BODY_TOO_LONG', 'MessageBodyInvalidError'],
      ['sendMessage', 'QUOTED_MESSAGE_NOT_FOUND', 'QuotedMessageInvalidError'],
      ['markReceipt', 'CHAT_NOT_FOUND', 'ChatNotFoundError'],
      ['markReceipt', 'CHAT_MEMBERSHIP_REQUIRED', 'ChatMembershipRequiredError'],
      ['markReceipt', 'RECEIPT_STATE_INVALID', 'ReceiptStateInvalidError'],
      ['setMessageReaction', 'MESSAGE_NOT_FOUND', 'MessageNotFoundError'],
      ['setMessageReaction', 'EMOJI_INVALID', 'EmojiInvalidError'],
      ['listMessages', 'CHAT_NOT_FOUND', 'ChatNotFoundError'],
      ['listMessages', 'CHAT_MEMBERSHIP_REQUIRED', 'ChatMembershipRequiredError'],
    ] as const;
    for (const [operation, appCode, errorName] of exactApplicationMappings) {
      expect(
        coterieSnapbackTestInternals.declaredError(
          operation,
          diagnostic('SNAPBACK_APPLICATION_REJECTED', appCode),
        ).name,
      ).toBe(errorName);
    }
  });
});

test('M3 single live windows admit exact product envelopes and fail loudly at limit+1', () => {
  expect(() => coterieSnapbackTestInternals.assertM3LiveWindow('listChats', 1_000))
    .not.toThrow();
  expect(() => coterieSnapbackTestInternals.assertM3LiveWindow('listMessages', 1_024))
    .not.toThrow();
  for (const [queryName, count] of [
    ['listChats', 1_001],
    ['listMessages', 1_025],
  ] as const) {
    expect(() => coterieSnapbackTestInternals.assertM3LiveWindow(queryName, count))
      .toThrow(expect.objectContaining({
        name: 'SnapbackProviderError',
        message: expect.stringContaining('live envelope'),
      }));
  }
});

test('feed cursors round-trip backend page keys and reject cross-mode reuse', () => {
  const row = {
    pageKey: '0001760000000123:event-01',
    eventCreatedAt: 1_760_000_000_123,
  };
  const cursor = coterieSnapbackTestInternals.encodeFeedCursor(
    'global',
    row as Parameters<typeof coterieSnapbackTestInternals.encodeFeedCursor>[1],
  );
  expect(coterieSnapbackTestInternals.decodeFeedCursor(cursor, 'global')).toEqual({
    payload: {
      v: 1,
      mode: 'global',
      sortAt: new Date(row.eventCreatedAt).toISOString(),
      eventId: 'event-01',
    },
    pageKey: row.pageKey,
  });
  expect(() => coterieSnapbackTestInternals.decodeFeedCursor(cursor, 'following'))
    .toThrow(expect.objectContaining({ name: 'FeedCursorInvalidError' }));
  expect(() => coterieSnapbackTestInternals.decodeFeedCursor('not-base64-json', 'global'))
    .toThrow(expect.objectContaining({ name: 'FeedCursorInvalidError' }));

  const cursorForSortAt = (sortAt: string) => globalThis.btoa(JSON.stringify({
    v: 1,
    mode: 'global',
    sortAt,
    eventId: 'boundary-event',
  })).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
  const epochCursor = coterieSnapbackTestInternals.encodeFeedCursor(
    'global',
    {
      pageKey: '0000000000000000:epoch-event',
      eventCreatedAt: 0,
    } as Parameters<typeof coterieSnapbackTestInternals.encodeFeedCursor>[1],
  );
  expect(coterieSnapbackTestInternals.decodeFeedCursor(epochCursor, 'global')?.pageKey)
    .toBe('0000000000000000:epoch-event');
  expect(() => coterieSnapbackTestInternals.decodeFeedCursor(
    cursorForSortAt('1969-12-31T23:59:59.999Z'),
    'global',
  )).toThrow(expect.objectContaining({ name: 'FeedCursorInvalidError' }));
  expect(() => coterieSnapbackTestInternals.decodeFeedCursor(
    cursorForSortAt('+275760-09-13T00:00:00.001Z'),
    'global',
  )).toThrow(expect.objectContaining({ name: 'FeedCursorInvalidError' }));
});

test('setRepost delegates directly to the bounded backend mutation for overflowing threads', async () => {
  let queryCalls = 0;
  const mutationCalls: unknown[] = [];
  const backend = {
    async query() {
      queryCalls += 1;
      throw new Error('the unbounded thread preflight must not run');
    },
    async mutate(_reference: unknown, options: unknown) {
      mutationCalls.push(options);
      return { status: 'settled', result: { reposted: true, repostCount: 1 } };
    },
  } as unknown as Parameters<typeof coterieSnapbackTestInternals.setRepostThroughBackend>[0];
  await coterieSnapbackTestInternals.setRepostThroughBackend(
    backend,
    'original-with-1024-replies' as Parameters<
      typeof coterieSnapbackTestInternals.setRepostThroughBackend
    >[1],
    true,
    'overflowing-thread-repost',
  );
  expect(queryCalls).toBe(0);
  expect(mutationCalls).toEqual([{
    args: {
      postId: 'original-with-1024-replies',
      reposted: true,
      mutationId: 'overflowing-thread-repost',
    },
  }]);
});

test('createPost validation preserves the frozen media vocabulary', () => {
  expect(coterieSnapbackTestInternals.normalizedCreatePostInput({
    body: '  hello  ',
    imageRefs: ['media/img-01.png'],
    videoRefs: [],
    parentId: null,
  })).toMatchObject({ body: 'hello', kind: 'images' });
  expect(() => coterieSnapbackTestInternals.normalizedCreatePostInput({
    body: '', imageRefs: [], videoRefs: [], parentId: null,
  })).toThrow(expect.objectContaining({ name: 'PostBodyInvalidError' }));
  expect(() => coterieSnapbackTestInternals.normalizedCreatePostInput({
    body: '', imageRefs: ['media/not-committed.png'], videoRefs: [], parentId: null,
  })).toThrow(expect.objectContaining({ name: 'MediaReferenceInvalidError' }));
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

test('Snapback and memory share the eight-ref Coterie avatar vocabulary', () => {
  for (const personaId of ['alice', 'bob', 'carol', 'dave', 'erin', 'frank', 'grace', 'henry']) {
    expect(
      coterieSnapbackTestInternals.coterieAvatarUrlForRef(`media/avatar-${personaId}.png`),
    ).toBe(`/assets/fixtures/avatar-${personaId}.png`);
  }
  expect(coterieSnapbackTestInternals.coterieAvatarUrlForRef('https://example.com/avatar.png'))
    .toBeNull();
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

test('provider claims are exactly the adapter allow-list and refusal behavior agrees', async () => {
  const provider = createCoterieSnapbackProvider({
    baseUrl: 'http://127.0.0.1:1',
    custody: 'memory',
  });
  try {
    const claimCells: DataCellV2<unknown>[] = [];
    const claimSubscription = provider.subscribe(
      'listProviderClaims',
      {},
      (cell) => claimCells.push(cell),
    );
    expect(claimCells).toHaveLength(1);
    expect(claimCells[0]).toMatchObject({ status: 'ready' });
    if (claimCells[0]?.status !== 'ready') throw new Error('Expected provider claims');
    const claims = claimCells[0].value as Array<{
      name: string;
      kind: 'query' | 'mutation';
      token: string;
    }>;
    const expectedNames = [
      ...COTERIE_SNAPBACK_CLAIMED_OPERATIONS.queries,
      ...COTERIE_SNAPBACK_CLAIMED_OPERATIONS.mutations,
    ].sort();
    expect(claims.map((claim) => claim.name)).toEqual(expectedNames);
    expect(claims).toContainEqual({ name: 'listProviderClaims', kind: 'query', token: '1' });
    expect(claims).toContainEqual({ name: 'listChats', kind: 'query', token: '3' });
    expect(claims).toContainEqual({ name: 'listMessages', kind: 'query', token: '4' });
    expect(claims).toContainEqual({ name: 'sendMessage', kind: 'mutation', token: '4' });
    expect(claims).toContainEqual({ name: 'markReceipt', kind: 'mutation', token: '1' });
    expect(claims.some((claim) => claim.name === 'observeTyping')).toBe(false);
    expect(claims.some((claim) => claim.name === 'setTyping')).toBe(false);
    expect(claims.some((claim) => claim.name === 'setMessageReaction')).toBe(false);
    claimSubscription.dispose();

    const claimedQueries = new Set(COTERIE_SNAPBACK_CLAIMED_OPERATIONS.queries);
    for (const queryName of Object.keys(coterieSurfaceManifest.queries)) {
      const cells: DataCellV2<unknown>[] = [];
      const subscription = provider.subscribe(queryName, {}, (cell) => cells.push(cell));
      expect(cells).toHaveLength(1);
      const first = cells[0];
      if (!first) throw new Error(`No cell delivered for ${queryName}`);
      if (claimedQueries.has(queryName)) {
        expect(first.status === 'error' && first.error.name === 'SnapbackMilestoneUnsupportedError')
          .toBe(false);
      } else if (queryName === 'observeTyping') {
        expect(first).toMatchObject({
          status: 'error',
          error: {
            name: 'SnapbackTypingPermissionBackingUnavailableError',
            message: expect.stringContaining(
              'issues/20260817-ephemeral-membership-permission-backing.md',
            ),
          },
        });
      } else {
        expect(first).toMatchObject({
          status: 'error',
          error: { name: 'SnapbackMilestoneUnsupportedError' },
        });
      }
      subscription.dispose();
    }

    const claimedMutations = new Set(COTERIE_SNAPBACK_CLAIMED_OPERATIONS.mutations);
    for (const mutationName of Object.keys(coterieSurfaceManifest.mutations)) {
      const result = await provider.mutate(mutationName, {});
      if (claimedMutations.has(mutationName)) {
        expect(result.ok || result.error.name !== 'SnapbackMilestoneUnsupportedError').toBe(true);
      } else if (mutationName === 'setTyping') {
        expect(result).toMatchObject({
          ok: false,
          error: {
            name: 'SnapbackTypingPermissionBackingUnavailableError',
            message: expect.stringContaining(
              'issues/20260817-ephemeral-membership-permission-backing.md',
            ),
          },
        });
      } else {
        expect(result).toMatchObject({
          ok: false,
          error: { name: 'SnapbackMilestoneUnsupportedError' },
        });
      }
    }
    expect(await provider.mutate('setChatAccent', {})).toMatchObject({
      ok: false,
      error: {
        name: 'SnapbackMilestoneUnsupportedError',
        message: 'snapback provider claims M1+M2+M3-minus-typing plus provider discovery only; setChatAccent is outside that claim — LLP 0266 D7 (M5)',
      },
    });
    const insightsCells: DataCellV2<unknown>[] = [];
    provider.subscribe('listInsights', {}, (cell) => insightsCells.push(cell)).dispose();
    expect(insightsCells[0]).toMatchObject({
      status: 'error',
      error: {
        name: 'SnapbackMilestoneUnsupportedError',
        message: 'snapback provider claims M1+M2+M3-minus-typing plus provider discovery only; listInsights is outside that claim — LLP 0266 D7 (M8)',
      },
    });
    expect(claims.some((claim) => claim.name.startsWith('ensureFixture'))).toBe(false);
    expect(claims.some((claim) => claim.name.startsWith('getMyFixture'))).toBe(false);
    expect(await provider.mutate('ensureFixturePost', {})).toMatchObject({
      ok: false,
      error: { name: 'UnknownMutationError' },
    });
    let fixtureQueryCell: DataCellV2<unknown> | null = null;
    provider.subscribe('getMyFixturePost', {}, (cell) => { fixtureQueryCell = cell; }).dispose();
    expect(fixtureQueryCell).toMatchObject({
      status: 'error',
      error: { name: 'UnknownQueryError' },
    });
    expect(COTERIE_SNAPBACK_M1_OPERATIONS.queries).toContain('listProfiles');
    expect(COTERIE_SNAPBACK_M2_OPERATIONS.queries).toContain('listFeed');
    expect(COTERIE_SNAPBACK_M3_OPERATIONS.queries).toEqual(['listChats', 'listMessages']);
  } finally {
    await provider.close();
  }
});
