import { describe, expect, it } from 'bun:test';

import {
  assertDataProviderConformance,
  type DataProviderConformanceFixture,
} from '@exact/contract/conformance';
import type {
  ContractDataProvider,
  DataMutationResult,
  DataObserver,
} from '@exact/contract/runtime';

import {
  coterieSurfaceManifest,
  createCoterieMemoryHarness,
  createCoterieMemoryProvider,
  type CoterieMemoryHarness,
} from '../src/data/memory-provider.ts';
import {
  coterieProviderRegistry,
  resolveCoterieProviderName,
} from '../src/data/provider-factory.ts';
import {
  configureFromProvider,
  listSession,
  signup,
} from '../src/data/generated/coterie.bindings.ts';

function collectReady<T>(
  provider: ContractDataProvider,
  name: string,
  args: Record<string, unknown>,
): { snapshots: T[]; dispose(): void } {
  const snapshots: T[] = [];
  const subscription = provider.subscribe(name, args, (cell) => {
    if (cell.status === 'ready') snapshots.push(cell.value as T);
  });
  return { snapshots, dispose: () => subscription.dispose() };
}

function expectMutationError(
  result: DataMutationResult,
  name: string,
): Extract<DataMutationResult, { ok: false }>['error'] {
  expect(result).toMatchObject({ ok: false, error: { name } });
  if (result.ok) throw new Error(`Expected ${name}, received a successful mutation`);
  return result.error;
}

describe('Coterie backendless provider', () => {
  it('selects memory by default and fails loudly for unknown or unconfigured providers', () => {
    expect(resolveCoterieProviderName(undefined)).toBe('memory');
    expect(resolveCoterieProviderName('memory')).toBe('memory');
    expect(() => resolveCoterieProviderName('other')).toThrow(
      'Unknown COTERIE_PROVIDER "other"; valid values: memory, snapback',
    );
    const configuredUrl = process.env.COTERIE_SNAPBACK_URL;
    delete process.env.COTERIE_SNAPBACK_URL;
    try {
      expect(() => coterieProviderRegistry.snapback()).toThrow(
        'COTERIE_PROVIDER=snapback requires COTERIE_SNAPBACK_URL',
      );
    } finally {
      if (configuredUrl !== undefined) process.env.COTERIE_SNAPBACK_URL = configuredUrl;
    }
  });

  it('passes the Exact provider conformance surface it claims', async () => {
    let harness: CoterieMemoryHarness | null = null;
    const fixture: DataProviderConformanceFixture = {
      name: 'coterie-memory',
      capabilities: coterieSurfaceManifest.capabilities,
      createProvider() {
        harness = createCoterieMemoryHarness();
        return harness.provider;
      },
      primaryQuery: {
        name: 'listFeed',
        args: { mode: 'global' },
        initial: { status: 'ready', empty: false },
        applySubscriptionUpdate() {
          if (!harness) throw new Error('provider harness was not created');
          harness.appendFixturePost();
        },
        afterSubscriptionUpdate: { status: 'ready', empty: false },
      },
      mutation: {
        name: 'createPost',
        args: { body: 'Conformance mutation' },
        expectedResult: { ok: true },
        afterMutation: { status: 'ready', empty: false },
      },
    };

    const report = await assertDataProviderConformance(fixture);
    expect(report.ok).toBe(true);
    expect(report.checks.find((check) => check.id === 'initial-snapshot')?.status).toBe('pass');
    expect(report.checks.find((check) => check.id === 'subscription-update')?.status).toBe('pass');
    expect(report.checks.find((check) => check.id === 'mutation-query-invalidation')?.status).toBe('pass');
  });

  it('configures a distinct adapter implementation against the shared Coterie surface', () => {
    const delegate = createCoterieMemoryProvider();
    const alternateAdapter: ContractDataProvider = {
      manifest: coterieSurfaceManifest,
      subscribe<T>(name: string, args: Record<string, unknown>, observer: DataObserver<T>) {
        return delegate.subscribe(name, args, observer);
      },
      mutate<T>(name, args, correlation) {
        return delegate.mutate<T>(name, args, correlation);
      },
    };

    expect(coterieSurfaceManifest.provider).toBe('coterie');
    expect(alternateAdapter).not.toBe(delegate);
    expect(() =>
      configureFromProvider({
        ...alternateAdapter,
        manifest: { ...coterieSurfaceManifest, inputsHash: 'provider-specific-digest' },
      }),
    ).toThrow('declaration digest mismatch');
    const projection = configureFromProvider(alternateAdapter);
    const sessionHandle = listSession({}) as {
      subscribe(observer: (rows: Array<{ userId: string }>) => void): { dispose(): void };
    };
    const deliveries: Array<Array<{ userId: string }>> = [];
    const subscription = sessionHandle.subscribe((rows) => deliveries.push(rows));
    expect(deliveries.at(-1)?.[0]?.userId).toBe('alice');
    subscription.dispose();
    projection.dispose();
  });

  it('signs up a deterministic process-memory account and declares duplicate identity errors', async () => {
    const { provider } = createCoterieMemoryHarness();
    const sessions = collectReady<
      Array<{ userId: string; token: string; signedIn: boolean; revokedAt: string | null }>
    >(provider, 'listSession', {});
    const profiles = collectReady<
      Array<{ id: string; handle: string; displayName: string; location: string; link: string }>
    >(provider, 'listProfiles', {});

    const signup = await provider.mutate('signup', {
      email: 'new.person@example.com',
      password: 'NewPerson!2026',
      handle: 'new_person',
      displayName: 'New Person',
    });
    expect(signup).toMatchObject({
      ok: true,
      value: {
        userId: 'local-new_person',
        sessionToken: 'coterie-memory-session-local-new_person-0001',
      },
    });
    expect(sessions.snapshots.at(-1)?.[0]).toMatchObject({
      userId: 'local-new_person',
      signedIn: true,
      revokedAt: null,
    });
    expect(profiles.snapshots.at(-1)?.find((profile) => profile.id === 'local-new_person')).toEqual({
      id: 'local-new_person',
      handle: 'new_person',
      displayName: 'New Person',
      bio: '',
      location: '',
      link: '',
      avatarUrl: null,
      followers: 0,
      following: 0,
      followedByMe: false,
      isMe: true,
    });

    const duplicateEmail = await provider.mutate('signup', {
      email: 'new.person@example.com',
      password: 'Another!2026',
      handle: 'another_person',
      displayName: 'Another Person',
    });
    expect(duplicateEmail).toMatchObject({
      ok: false,
      error: { name: 'DuplicateEmailError', message: 'An account already uses that email.' },
    });

    const duplicateHandle = await provider.mutate('signup', {
      email: 'unique@example.com',
      password: 'Another!2026',
      handle: 'new_person',
      displayName: 'Another Person',
    });
    expect(duplicateHandle).toMatchObject({
      ok: false,
      error: { name: 'DuplicateHandleError', message: 'An account already uses that handle.' },
    });

    const shortPassword = await provider.mutate('signup', {
      email: 'short@example.com',
      password: 'short',
      handle: 'short_password',
      displayName: 'Short Password',
    });
    expect(shortPassword).toMatchObject({
      ok: false,
      error: { name: 'PasswordTooShortError' },
    });
    sessions.dispose();
    profiles.dispose();
  });

  it('declares login failure and keeps logout revocation honest in process memory', async () => {
    const { provider, boundary } = createCoterieMemoryHarness();
    const sessions = collectReady<
      Array<{ userId: string; token: string; signedIn: boolean; revokedAt: string | null }>
    >(provider, 'listSession', {});
    const initialToken = sessions.snapshots[0]?.[0]?.token;

    const rejected = await provider.mutate('login', {
      email: 'alice@example.com',
      password: 'incorrect-password',
    });
    expect(rejected).toMatchObject({
      ok: false,
      error: { name: 'InvalidCredentialsError', message: 'Email or password is incorrect.' },
    });
    expect(sessions.snapshots.at(-1)?.[0]?.token).toBe(initialToken);

    const login = await provider.mutate('login', {
      email: 'bob@example.com',
      password: 'Bob!Clique2026',
    });
    expect(login).toMatchObject({ ok: true, value: { userId: 'bob' } });
    const bobToken = sessions.snapshots.at(-1)?.[0]?.token;
    expect(bobToken).not.toBe(initialToken);
    expect(boundary.snapshot('sessionRevocations')).toContainEqual(
      expect.objectContaining({ token: initialToken, signedIn: false, reason: 'replaced' }),
    );

    const logout = await provider.mutate('logout', {});
    expect(logout).toMatchObject({ ok: true, value: { revokedToken: bobToken } });
    expect(sessions.snapshots.at(-1)).toEqual([]);
    expect(boundary.snapshot('sessionRevocations')).toContainEqual(
      expect.objectContaining({ token: bobToken, signedIn: false, reason: 'logout' }),
    );
    sessions.dispose();
  });

  it('attaches only committed fixture avatar references and invalidates profile projections', async () => {
    const { provider } = createCoterieMemoryHarness();
    const profiles = collectReady<Array<{ id: string; avatarUrl: string | null }>>(
      provider,
      'listProfiles',
      {},
    );
    const feed = collectReady<Array<{ authorId: string; avatarUrl: string | null }>>(
      provider,
      'listFeed',
      { mode: 'global' },
    );

    const attached = await provider.mutate('setAvatar', {
      avatarRef: 'media/avatar-bob.png',
    });
    expect(attached).toEqual({
      ok: true,
      value: { avatarUrl: '/assets/fixtures/avatar-bob.png' },
    });
    expect(profiles.snapshots.at(-1)?.find((profile) => profile.id === 'alice')?.avatarUrl).toBe(
      '/assets/fixtures/avatar-bob.png',
    );
    expect(feed.snapshots.at(-1)?.find((post) => post.authorId === 'alice')?.avatarUrl).toBe(
      '/assets/fixtures/avatar-bob.png',
    );

    const rejected = await provider.mutate('setAvatar', { avatarRef: 'media/img-01.png' });
    expect(rejected).toMatchObject({
      ok: false,
      error: { name: 'AvatarReferenceInvalidError' },
    });
    profiles.dispose();
    feed.dispose();
  });

  it('delivers declared error names through generated mutations while Exact omits code', async () => {
    const { provider } = createCoterieMemoryHarness();
    const projection = configureFromProvider(provider);
    const result = (await signup({
      email: 'alice@example.com',
      password: 'Another!2026',
      handle: 'another_alice',
      displayName: 'Another Alice',
    })) as DataMutationResult;
    const error = expectMutationError(result, 'DuplicateEmailError');
    expect(error).not.toHaveProperty('code');
    projection.dispose();
  });

  it('rejects every session-required mutation after logout', async () => {
    const { provider } = createCoterieMemoryHarness();
    expect((await provider.mutate('logout', {})).ok).toBe(true);

    const cases = [
      ['createPost', { body: 'Signed-out post' }],
      ['setLike', { postId: 'sp0001', liked: true, mutationId: 'signed-out-like' }],
      ['setFollow', { userId: 'bob', following: false, mutationId: 'signed-out-follow' }],
      [
        'editProfile',
        { displayName: 'Signed Out', bio: '', handle: null, location: null, link: null },
      ],
      ['setAvatar', { avatarRef: 'media/avatar-bob.png' }],
      ['sendMessage', { chatId: 'g-starter', body: 'Signed-out message' }],
    ] as const;

    for (const [operation, args] of cases) {
      expectMutationError(await provider.mutate(operation, args), 'SessionRequiredError');
    }
  });

  it('covers the signup and edit-profile invalid-input vocabulary', async () => {
    const { provider } = createCoterieMemoryHarness();
    const cases = [
      {
        operation: 'signup',
        args: { email: 'invalid', password: 'ValidPass!2026', handle: 'valid_one', displayName: 'Valid One' },
        error: 'EmailInvalidError',
      },
      {
        operation: 'signup',
        args: { email: 'valid@example.com', password: 'ValidPass!2026', handle: 'INVALID', displayName: 'Valid One' },
        error: 'HandleInvalidError',
      },
      {
        operation: 'signup',
        args: { email: 'valid@example.com', password: 'ValidPass!2026', handle: 'valid_one', displayName: ' '.repeat(2) },
        error: 'DisplayNameInvalidError',
      },
      {
        operation: 'editProfile',
        args: { displayName: 'Alice', bio: '', handle: 'INVALID', location: null, link: null },
        error: 'HandleInvalidError',
      },
      {
        operation: 'editProfile',
        args: { displayName: ' '.repeat(2), bio: '', handle: null, location: null, link: null },
        error: 'DisplayNameInvalidError',
      },
      {
        operation: 'editProfile',
        args: { displayName: 'Alice', bio: 'x'.repeat(201), handle: null, location: null, link: null },
        error: 'BioInvalidError',
      },
      {
        operation: 'editProfile',
        args: { displayName: 'Alice', bio: '', handle: null, location: null, link: 'ftp://example.com' },
        error: 'LinkInvalidError',
      },
      {
        operation: 'editProfile',
        args: { displayName: 'Alice', bio: '', handle: null, location: 'x'.repeat(51), link: null },
        error: 'LocationInvalidError',
      },
    ] as const;

    for (const testCase of cases) {
      expectMutationError(
        await provider.mutate(testCase.operation, testCase.args),
        testCase.error,
      );
    }
  });

  it('applies the same setLike intent twice without flipping or double-counting', async () => {
    const { provider } = createCoterieMemoryHarness();
    const feed = collectReady<Array<{ id: string; likeCount: number; likedByMe: boolean }>>(
      provider,
      'listFeed',
      { mode: 'global' },
    );
    const intent = { postId: 'sp0001', liked: true, mutationId: 'test-like-sp0001-set' };

    expect((await provider.mutate('setLike', intent)).ok).toBe(true);
    expect((await provider.mutate('setLike', intent)).ok).toBe(true);

    expect(feed.snapshots.at(-1)?.find((post) => post.id === 'sp0001')).toMatchObject({
      likeCount: 3,
      likedByMe: true,
    });
    feed.dispose();
  });

  it('applies the same setFollow intent twice and keeps both profile counts consistent', async () => {
    const { provider } = createCoterieMemoryHarness();
    const profiles = collectReady<
      Array<{ id: string; followers: number; following: number; followedByMe: boolean }>
    >(provider, 'listProfiles', {});
    const intent = { userId: 'bob', following: false, mutationId: 'test-follow-bob-clear' };

    expect((await provider.mutate('setFollow', intent)).ok).toBe(true);
    expect((await provider.mutate('setFollow', intent)).ok).toBe(true);

    const latest = profiles.snapshots.at(-1) ?? [];
    expect(latest.find((profile) => profile.id === 'bob')).toMatchObject({
      followers: 1,
      followedByMe: false,
    });
    expect(latest.find((profile) => profile.id === 'alice')).toMatchObject({
      following: 1,
    });
    profiles.dispose();
  });

  it('updates denormalized feed and message author projections after editProfile', async () => {
    const { provider } = createCoterieMemoryHarness();
    const profiles = collectReady<
      Array<{
        id: string;
        displayName: string;
        handle: string;
        location: string;
        link: string;
      }>
    >(provider, 'listProfiles', {});
    const feed = collectReady<Array<{ id: string; authorName: string; authorHandle: string }>>(
      provider,
      'listFeed',
      { mode: 'global' },
    );
    const messages = collectReady<Array<{ id: string; senderName: string }>>(
      provider,
      'listMessages',
      { chatId: 'd-alice-bob' },
    );

    const result = await provider.mutate('editProfile', {
      displayName: 'Alice Fixture Edit',
      bio: 'Edited in the backendless provider.',
      handle: 'alice_edit',
      location: 'Alameda, CA',
      link: 'https://example.com/alice-edit',
    });
    expect(result.ok).toBe(true);
    expect(profiles.snapshots.at(-1)?.find((profile) => profile.id === 'alice')?.displayName).toBe(
      'Alice Fixture Edit',
    );
    expect(profiles.snapshots.at(-1)?.find((profile) => profile.id === 'alice')).toMatchObject({
      handle: 'alice_edit',
      location: 'Alameda, CA',
      link: 'https://example.com/alice-edit',
    });
    expect(feed.snapshots.at(-1)?.find((post) => post.id === 'sp0001')?.authorName).toBe(
      'Alice Fixture Edit',
    );
    expect(feed.snapshots.at(-1)?.find((post) => post.id === 'sp0001')?.authorHandle).toBe(
      'alice_edit',
    );
    expect(messages.snapshots.at(-1)?.find((message) => message.id === 'sm0001')?.senderName).toBe(
      'Alice Fixture Edit',
    );
    profiles.dispose();
    feed.dispose();
    messages.dispose();
  });

  it('recomputes the Following feed from the follow graph when follow state changes', async () => {
    const { provider } = createCoterieMemoryHarness();
    const following = collectReady<Array<{ id: string; authorId: string }>>(
      provider,
      'listFeed',
      { mode: 'following' },
    );
    const global = collectReady<Array<{ id: string; authorId: string }>>(
      provider,
      'listFeed',
      { mode: 'global' },
    );

    expect(following.snapshots.at(-1)?.some((post) => post.authorId === 'carol')).toBe(true);
    expect(
      (
        await provider.mutate('setFollow', {
          userId: 'carol',
          following: false,
          mutationId: 'test-follow-carol-clear',
        })
      ).ok,
    ).toBe(true);
    expect(following.snapshots.at(-1)?.some((post) => post.authorId === 'carol')).toBe(false);
    expect(global.snapshots.at(-1)?.some((post) => post.authorId === 'carol')).toBe(true);
    following.dispose();
    global.dispose();
  });

  it('computes lifetime and trailing-7-day Insights from fixture rows', async () => {
    const { provider } = createCoterieMemoryHarness();
    const insights = collectReady<
      Array<{
        day: string;
        posts: number;
        likesReceived: number;
        totalPosts: number;
        totalLikesReceived: number;
        totalRepostsReceived: number;
        totalRepliesReceived: number;
        totalFollowers: number;
        totalFollowing: number;
      }>
    >(provider, 'listInsights', {});

    const initial = insights.snapshots[0] ?? [];
    expect(initial).toHaveLength(7);
    expect(initial[0]?.day).toBe('2025-12-26');
    expect(initial.at(-1)).toMatchObject({
      day: '2026-01-01',
      posts: 2,
      likesReceived: 2,
      totalPosts: 2,
      totalLikesReceived: 2,
      totalRepostsReceived: 1,
      totalRepliesReceived: 1,
      totalFollowers: 4,
      totalFollowing: 2,
    });

    expect(
      (
        await provider.mutate('setLike', {
          postId: 'sp0001',
          liked: true,
          mutationId: 'test-insights-like-sp0001-set',
        })
      ).ok,
    ).toBe(true);
    expect(insights.snapshots.at(-1)?.at(-1)).toMatchObject({
      likesReceived: 3,
      totalLikesReceived: 3,
    });
    insights.dispose();
  });

  it('keeps a newly-created viewer post in Following without a self-follow edge', async () => {
    const { provider } = createCoterieMemoryHarness();
    const following = collectReady<Array<{ id: string; body: string; authorId: string }>>(
      provider,
      'listFeed',
      { mode: 'following' },
    );

    const result = await provider.mutate('createPost', { body: 'Visible to me' });
    expect(result.ok).toBe(true);
    expect(following.snapshots.at(-1)?.[0]).toMatchObject({
      body: 'Visible to me',
      authorId: 'alice',
    });
    following.dispose();
  });

  it('keys conversation messages and writes by the canonical chat id', async () => {
    const { provider } = createCoterieMemoryHarness();
    const dm = collectReady<Array<{ id: string; chatId: string; body: string }>>(
      provider,
      'listMessages',
      { chatId: 'd-alice-bob' },
    );
    const group = collectReady<Array<{ id: string; chatId: string; body: string }>>(
      provider,
      'listMessages',
      { chatId: 'g-starter' },
    );

    expect(dm.snapshots[0]?.map((message) => message.id)).toEqual([
      'sm0001',
      'sm0002',
      'sm0003',
      'sm0004',
      'sm0005',
      'sm0006',
    ]);
    expect(group.snapshots[0]?.map((message) => message.id)).toEqual([
      'sm0007',
      'sm0008',
      'sm0009',
      'sm0010',
      'sm0011',
      'sm0012',
      'sm0013',
      'sm0014',
      'sm0015',
    ]);

    const result = await provider.mutate('sendMessage', {
      chatId: 'g-starter',
      body: 'A group-only local message',
    });
    expect(result.ok).toBe(true);
    expect(group.snapshots.at(-1)?.at(-1)).toMatchObject({
      chatId: 'g-starter',
      body: 'A group-only local message',
    });
    expect(dm.snapshots.at(-1)?.length).toBe(6);
    dm.dispose();
    group.dispose();
  });
});
