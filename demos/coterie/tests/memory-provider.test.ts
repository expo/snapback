import { describe, expect, it } from 'bun:test';

import {
  assertDataProviderConformance,
  type DataProviderConformanceFixture,
} from '@exact/contract/conformance';
import type {
  ContractDataProvider,
  ContractQueryHandle,
  DataMutationResult,
  DataObserver,
} from '@exact/contract/runtime';

import {
  coterieSurfaceManifest,
  createCoterieMemoryHarness,
  createCoterieMemoryProvider,
  type CoterieMemoryHarness,
} from '../src/data/memory-provider.ts';
import declarationJson from '../src/data/coterie.provider.json';
import { COTERIE_AVATAR_REFS } from '../src/data/avatar-refs.ts';
import { COTERIE_COMPOSER_MEDIA_OPTIONS } from '../src/data/coterie-fixtures.ts';
import {
  coterieProviderRegistry,
  resolveCoterieProviderName,
} from '../src/data/provider-factory.ts';
import {
  configureFromProvider,
  createPost,
  listFeed,
  listSession,
  listThread,
  sendMessage,
  signup,
} from '../src/data/generated/coterie.bindings.ts';
import type { FeedItem, ThreadPost } from '../src/data/generated/coterie.types.ts';

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

function readCell(
  provider: ContractDataProvider,
  name: string,
  args: Record<string, unknown>,
): { status: string; value?: unknown; error?: { name?: string; message: string } } {
  let latest: { status: string; value?: unknown; error?: { name?: string; message: string } } = {
    status: 'pending',
  };
  const subscription = provider.subscribe(name, args, (cell) => {
    latest = cell as typeof latest;
  });
  subscription.dispose();
  return latest;
}

function readRows<T>(
  provider: ContractDataProvider,
  name: string,
  args: Record<string, unknown>,
): T[] {
  const cell = readCell(provider, name, args);
  expect(cell.status).toBe('ready');
  if (cell.status !== 'ready' || !Array.isArray(cell.value)) {
    throw new Error(`${name} did not synchronously deliver rows`);
  }
  return cell.value as T[];
}

function readGeneratedRows<T>(handle: ContractQueryHandle<T>): T[] {
  let latest: readonly T[] | null = null;
  const subscription = handle.subscribe((rows) => {
    latest = rows;
  });
  subscription.dispose();
  if (latest === null) throw new Error('generated query did not synchronously deliver rows');
  return [...latest];
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
        args: { mode: 'global', cursor: null },
        initial: { status: 'ready', empty: false },
        applySubscriptionUpdate() {
          if (!harness) throw new Error('provider harness was not created');
          harness.appendFixturePost();
        },
        afterSubscriptionUpdate: { status: 'ready', empty: false },
      },
      mutation: {
        name: 'createPost',
        args: { body: 'Conformance mutation', imageRefs: [], videoRefs: [], parentId: null },
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

  it('isolates delivered profile rows from the backing memory state', () => {
    const { provider } = createCoterieMemoryHarness();
    const delivered = readRows<{ id: string; displayName: string }>(
      provider,
      'listProfiles',
      {},
    );
    const alice = delivered.find((profile) => profile.id === 'alice');
    expect(alice?.displayName).toBe('Alice Alvarez');
    if (!alice) throw new Error('Alice profile fixture was not delivered');

    alice.displayName = 'Mutated by subscriber';

    const fresh = readRows<{ id: string; displayName: string }>(
      provider,
      'listProfiles',
      {},
    );
    expect(fresh.find((profile) => profile.id === 'alice')?.displayName).toBe('Alice Alvarez');
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
      avatarRef: null,
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

  it('accepts all eight avatar refs and updates only DM rows that display the changed persona', async () => {
    const { provider } = createCoterieMemoryHarness();
    const profiles = collectReady<Array<{
      id: string;
      avatarUrl: string | null;
      avatarRef: string | null;
    }>>(
      provider,
      'listProfiles',
      {},
    );
    const feed = collectReady<Array<{ authorId: string; avatarUrl: string | null }>>(
      provider,
      'listFeed',
      { mode: 'global', cursor: null },
    );
    const chats = collectReady<Array<{ id: string; avatarUrl: string | null }>>(
      provider,
      'listChats',
      {},
    );

    for (const personaId of ['alice', 'bob', 'carol', 'dave', 'erin', 'frank', 'grace', 'henry']) {
      const attached = await provider.mutate('setAvatar', {
        avatarRef: `media/avatar-${personaId}.png`,
      });
      expect(attached).toEqual({
        ok: true,
        value: { avatarUrl: `/assets/fixtures/avatar-${personaId}.png` },
      });
      const currentProfile = profiles.snapshots.at(-1)?.find((profile) => profile.id === 'alice');
      expect(currentProfile).toMatchObject({
        avatarUrl: `/assets/fixtures/avatar-${personaId}.png`,
        avatarRef: `media/avatar-${personaId}.png`,
      });
      expect(COTERIE_AVATAR_REFS.filter((avatarRef) => avatarRef === currentProfile?.avatarRef)).toEqual([
        `media/avatar-${personaId}.png`,
      ]);
    }
    expect(feed.snapshots.at(-1)?.find((post) => post.authorId === 'alice')?.avatarUrl).toBe(
      '/assets/fixtures/avatar-henry.png',
    );
    expect(chats.snapshots.at(-1)?.find((chat) => chat.id === 'd-alice-bob')?.avatarUrl).toBe(
      '/assets/fixtures/avatar-bob.png',
    );
    expect(chats.snapshots.at(-1)?.find((chat) => chat.id === 'g-starter')?.avatarUrl).toBeNull();

    expect(
      (
        await provider.mutate('login', {
          email: 'bob@example.com',
          password: 'Bob!Clique2026',
        })
      ).ok,
    ).toBe(true);
    expect(
      await provider.mutate('setAvatar', { avatarRef: 'media/avatar-grace.png' }),
    ).toEqual({
      ok: true,
      value: { avatarUrl: '/assets/fixtures/avatar-grace.png' },
    });
    expect(chats.snapshots.at(-1)?.find((chat) => chat.id === 'd-alice-bob')?.avatarUrl).toBe(
      '/assets/fixtures/avatar-henry.png',
    );
    expect(chats.snapshots.at(-1)?.find((chat) => chat.id === 'g-starter')?.avatarUrl).toBeNull();

    const rejected = await provider.mutate('setAvatar', { avatarRef: 'media/img-01.png' });
    expect(rejected).toMatchObject({
      ok: false,
      error: { name: 'AvatarReferenceInvalidError' },
    });
    profiles.dispose();
    feed.dispose();
    chats.dispose();
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

  it('delivers declared send-message body errors through the generated mutation', async () => {
    const { provider } = createCoterieMemoryHarness();
    const projection = configureFromProvider(provider);
    expect((await sendMessage({
      chatId: 'g-starter',
      body: '😀'.repeat(2000),
      quotedMessageId: null,
    }) as DataMutationResult).ok).toBe(true);
    for (const body of ['', 'x'.repeat(2001), '😀'.repeat(2001)]) {
      const result = (await sendMessage({
        chatId: 'g-starter',
        body,
        quotedMessageId: null,
      })) as DataMutationResult;
      expectMutationError(result, 'MessageBodyInvalidError');
    }
    projection.dispose();
  });

  it('rejects every session-required mutation after logout', async () => {
    const { provider } = createCoterieMemoryHarness();
    expect((await provider.mutate('logout', {})).ok).toBe(true);
    for (const query of ['listChats', 'listMessages', 'observeTyping']) {
      expect(readCell(provider, query, query === 'listChats' ? {} : { chatId: 'g-starter' }))
        .toMatchObject({ status: 'ready', value: [] });
    }

    const cases = [
      ['createPost', { body: 'Signed-out post', imageRefs: [], videoRefs: [], parentId: null }],
      ['setLike', { postId: 'sp0001', liked: true, mutationId: 'signed-out-like' }],
      ['setRepost', { postId: 'sp0001', reposted: true, mutationId: 'signed-out-repost' }],
      ['setFollow', { userId: 'bob', following: false, mutationId: 'signed-out-follow' }],
      [
        'editProfile',
        { displayName: 'Signed Out', bio: '', handle: null, location: null, link: null },
      ],
      ['setAvatar', { avatarRef: 'media/avatar-bob.png' }],
      ['sendMessage', { chatId: 'g-starter', body: 'Signed-out message' }],
      [
        'setMessageReaction',
        {
          chatId: 'g-starter',
          messageId: 'sm0015',
          emoji: '👍',
          reacted: true,
          mutationId: 'signed-out-reaction',
        },
      ],
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
      { mode: 'global', cursor: null },
    );
    const intent = { postId: 'sp0019', liked: true, mutationId: 'test-like-sp0019-set' };

    expect((await provider.mutate('setLike', intent)).ok).toBe(true);
    expect((await provider.mutate('setLike', intent)).ok).toBe(true);

    expect(feed.snapshots.at(-1)?.find((post) => post.id === 'sp0019')).toMatchObject({
      likeCount: 2,
      likedByMe: true,
    });
    const clearIntent = {
      postId: 'sp0019',
      liked: false,
      mutationId: 'test-like-sp0019-clear',
    };
    expect((await provider.mutate('setLike', clearIntent)).ok).toBe(true);
    expect((await provider.mutate('setLike', clearIntent)).ok).toBe(true);
    expect(feed.snapshots.at(-1)?.find((post) => post.id === 'sp0019')).toMatchObject({
      likeCount: 1,
      likedByMe: false,
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
      { mode: 'following', cursor: null },
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
    const following = collectReady<
      Array<{ id: string; authorId: string; repostedById: string | null }>
    >(
      provider,
      'listFeed',
      { mode: 'following', cursor: null },
    );
    const global = collectReady<
      Array<{ id: string; authorId: string; repostedById: string | null }>
    >(
      provider,
      'listFeed',
      { mode: 'global', cursor: null },
    );

    expect(following.snapshots.at(-1)?.some((post) => post.authorId === 'carol')).toBe(true);
    expect(
      following.snapshots.at(-1)?.some((post) => post.repostedById === 'carol'),
    ).toBe(true);
    expect(following.snapshots.at(-1)?.some((post) => post.authorId === 'dave')).toBe(false);
    expect(global.snapshots.at(-1)?.some((post) => post.authorId === 'dave')).toBe(true);
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
    expect(
      following.snapshots.at(-1)?.some((post) => post.repostedById === 'carol'),
    ).toBe(false);
    expect(following.snapshots.at(-1)?.some((post) => post.id === 'sp0001')).toBe(true);
    expect(
      following.snapshots.at(-1)?.some((post) => post.id === 'repost:alice:sp0004'),
    ).toBe(true);
    expect(global.snapshots.at(-1)?.some((post) => post.authorId === 'carol')).toBe(true);
    expect(global.snapshots.at(-1)?.some((post) => post.repostedById === 'carol')).toBe(true);
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
      posts: 3,
      likesReceived: 2,
      totalPosts: 3,
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
    expect((await provider.mutate('setRepost', {
      postId: 'sp0002',
      reposted: true,
      mutationId: 'test-insights-repost-sp0002-set',
    })).ok).toBe(true);
    expect(insights.snapshots.at(-1)?.at(-1)).toMatchObject({
      totalRepostsReceived: 2,
    });
    expect((await provider.mutate('setFollow', {
      userId: 'dave',
      following: true,
      mutationId: 'test-insights-follow-dave-set',
    })).ok).toBe(true);
    expect(insights.snapshots.at(-1)?.at(-1)).toMatchObject({
      totalFollowing: 3,
    });
    insights.dispose();
  });

  it('keeps a newly-created viewer post in Following without a self-follow edge', async () => {
    const { provider } = createCoterieMemoryHarness();
    const following = collectReady<Array<{ id: string; body: string; authorId: string }>>(
      provider,
      'listFeed',
      { mode: 'following', cursor: null },
    );

    const result = await provider.mutate('createPost', {
      body: 'Visible to me',
      imageRefs: [],
      videoRefs: [],
      parentId: null,
    });
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

  it('shows an outgoing receipt only when the actual latest preview is mine', async () => {
    const { provider } = createCoterieMemoryHarness();
    type ChatPreview = {
      id: string;
      preview: string;
      latestReceiptStatus: string | null;
    };
    const chats = collectReady<ChatPreview[]>(provider, 'listChats', {});
    expect(chats.snapshots.at(-1)?.find((chat) => chat.id === 'd-alice-bob')).toMatchObject({
      preview: 'On my way.',
      latestReceiptStatus: null,
    });

    expect((await provider.mutate('sendMessage', {
      chatId: 'd-alice-bob',
      body: 'Alice owns the latest preview now.',
      quotedMessageId: null,
    })).ok).toBe(true);
    expect(chats.snapshots.at(-1)?.find((chat) => chat.id === 'd-alice-bob')).toMatchObject({
      preview: 'Alice owns the latest preview now.',
      latestReceiptStatus: 'sent',
    });
    chats.dispose();
  });

  it('retains M1/M2 tokens while freezing the complete v8 M3 surface', () => {
    expect(declarationJson.declarationVersion).toBe('8');
    expect(coterieSurfaceManifest.queries.listFeed?.compatibilityToken).toBe('3');
    expect(coterieSurfaceManifest.queries.listThread?.compatibilityToken).toBe('1');
    expect(coterieSurfaceManifest.queries.listProfilePosts?.compatibilityToken).toBe('1');
    expect(coterieSurfaceManifest.queries.listProfiles?.compatibilityToken).toBe('3');
    expect(
      declarationJson.extensions['coterie.m2CompatibilityTokens'],
    ).toEqual({
      listFeed: '3',
      listThread: '1',
      listProfilePosts: '1',
      listProfiles: '3',
      createPost: '1',
      setFollow: '1',
      setLike: '1',
      setRepost: '2',
    });
    expect(declarationJson.extensions['coterie.m1CompatibilityTokens']).toMatchObject({
      listProfiles: '3',
      setAvatar: '2',
    });
    expect(declarationJson.extensions['coterie.m3CompatibilityTokens']).toEqual({
      listChats: '3',
      listMessages: '4',
      observeTyping: '1',
      openDm: '1',
      createGroup: '1',
      addMember: '1',
      removeMember: '1',
      promoteAdmin: '1',
      leaveChat: '1',
      sendMessage: '4',
      setTyping: '1',
      markReceipt: '1',
    });
    expect(declarationJson.extensions['coterie.receiptSemantics']).toMatchObject({
      mark: 'markReceipt',
      states: ['sent', 'delivered', 'read'],
      transition: 'monotonic-only',
    });
    expect(declarationJson.extensions['coterie.m4CompatibilityTokens']).toEqual({
      setMessageReaction: '2',
    });
    expect(declarationJson.extensions['coterie.m5CompatibilityTokens']).toEqual({
      searchSocial: '2',
      setChatAccent: '1',
      setDisappearing: '1',
    });
    const removeMemberDeclaration = declarationJson.mutations.find(
      (mutation) => mutation.name === 'removeMember',
    );
    const leaveChatDeclaration = declarationJson.mutations.find(
      (mutation) => mutation.name === 'leaveChat',
    );
    expect(removeMemberDeclaration?.writes).toContain('messages');
    expect(leaveChatDeclaration?.writes).toContain('messages');
    expect(
      declarationJson.mutations
        .find((mutation) => mutation.name === 'setMessageReaction')
        ?.errors.map((error) => error.name),
    ).toContain('ChatMembershipRequiredError');
  });

  it('creates text, image, video, and reply posts from committed fixture references', async () => {
    const { provider } = createCoterieMemoryHarness();
    const text = await provider.mutate<{ id: string }>('createPost', {
      body: 'A new text post',
      imageRefs: [],
      videoRefs: [],
      parentId: null,
    });
    const images = await provider.mutate<{ id: string }>('createPost', {
      body: 'Two committed fixture images',
      imageRefs: ['media/img-01.png', 'media/img-04.png'],
      videoRefs: [],
      parentId: null,
    });
    const video = await provider.mutate<{ id: string }>('createPost', {
      body: 'One committed fixture video',
      imageRefs: [],
      videoRefs: ['media/vid-01.mp4'],
      parentId: null,
    });
    const reply = await provider.mutate<{ id: string }>('createPost', {
      body: 'A new direct reply',
      imageRefs: [],
      videoRefs: [],
      parentId: 'sp0001',
    });
    for (const result of [text, images, video, reply]) expect(result.ok).toBe(true);
    if (!text.ok || !images.ok || !video.ok || !reply.ok) {
      throw new Error('expected all post variants to succeed');
    }

    const global = readRows<{
      postId: string;
      mediaKind: string | null;
      mediaUrls: string[];
    }>(provider, 'listFeed', { mode: 'global', cursor: null });
    expect(global.find((row) => row.postId === text.value.id)).toMatchObject({
      mediaKind: null,
      mediaUrls: [],
    });
    expect(global.find((row) => row.postId === images.value.id)).toMatchObject({
      mediaKind: 'images',
      mediaUrls: ['/assets/fixtures/img-01.png', '/assets/fixtures/img-04.png'],
    });
    expect(global.find((row) => row.postId === video.value.id)).toMatchObject({
      mediaKind: 'video',
      mediaUrls: ['/assets/fixtures/vid-01.mp4'],
    });
    expect(global.some((row) => row.postId === reply.value.id)).toBe(false);

    const thread = readRows<{ postId: string; threadRole: string; replyCount: number }>(
      provider,
      'listThread',
      { parentId: 'sp0001' },
    );
    expect(thread.map((row) => row.postId)).toEqual(['sp0001', 'sr0001', reply.value.id]);
    expect(thread[0]).toMatchObject({ threadRole: 'parent', replyCount: 2 });
    expect(thread.slice(1).every((row) => row.threadRole === 'direct-reply')).toBe(true);

    const profilePosts = readRows<{ postId: string; createdAt: string }>(
      provider,
      'listProfilePosts',
      { userId: 'alice' },
    );
    expect(profilePosts.slice(0, 3).map((row) => row.postId)).toEqual([
      video.value.id,
      images.value.id,
      text.value.id,
    ]);
    expect(profilePosts.some((row) => row.postId === reply.value.id)).toBe(false);
  });

  it('creates composer media through generated bindings and resolves feed plus media-route rows', async () => {
    const { provider } = createCoterieMemoryHarness();
    const projection = configureFromProvider(provider);
    try {
      const imageRefs = [
        'media/img-01.png',
        'media/img-02.png',
        'media/img-03.png',
        'media/img-04.png',
      ];
      const images = (await createPost({
        body: '',
        imageRefs,
        videoRefs: [],
        parentId: null,
      })) as DataMutationResult<{ id: string }>;
      const video = (await createPost({
        body: '',
        imageRefs: [],
        videoRefs: ['media/vid-01.mp4'],
        parentId: null,
      })) as DataMutationResult<{ id: string }>;
      expect(images.ok).toBe(true);
      expect(video.ok).toBe(true);
      if (!images.ok || !images.value || !video.ok || !video.value) {
        throw new Error('expected generated createPost bindings to return post identities');
      }

      const feed = readGeneratedRows(
        listFeed({ mode: 'global', cursor: null }) as ContractQueryHandle<FeedItem>,
      );
      expect(feed.find((row) => row.postId === images.value!.id)).toMatchObject({
        mediaKind: 'images',
        mediaUrls: [
          '/assets/fixtures/img-01.png',
          '/assets/fixtures/img-02.png',
          '/assets/fixtures/img-03.png',
          '/assets/fixtures/img-04.png',
        ],
      });
      expect(feed.find((row) => row.postId === video.value!.id)).toMatchObject({
        mediaKind: 'video',
        mediaUrls: ['/assets/fixtures/vid-01.mp4'],
      });

      const imageRouteRows = readGeneratedRows(
        listThread({ parentId: images.value.id }) as ContractQueryHandle<ThreadPost>,
      );
      expect(imageRouteRows[0]).toMatchObject({
        postId: images.value.id,
        mediaKind: 'images',
        mediaUrls: [
          '/assets/fixtures/img-01.png',
          '/assets/fixtures/img-02.png',
          '/assets/fixtures/img-03.png',
          '/assets/fixtures/img-04.png',
        ],
      });
      const videoRouteRows = readGeneratedRows(
        listThread({ parentId: video.value.id }) as ContractQueryHandle<ThreadPost>,
      );
      expect(videoRouteRows[0]).toMatchObject({
        postId: video.value.id,
        mediaKind: 'video',
        mediaUrls: ['/assets/fixtures/vid-01.mp4'],
      });
    } finally {
      projection.dispose();
    }
  });

  it('keeps a text-only post media-free across the next generated live-feed delivery', async () => {
    const { provider } = createCoterieMemoryHarness();
    const projection = configureFromProvider(provider);
    const deliveries: FeedItem[][] = [];
    const feed = listFeed({ mode: 'global', cursor: null }) as ContractQueryHandle<FeedItem>;
    const subscription = feed.subscribe((rows) => deliveries.push([...rows]));
    try {
      const text = (await createPost({
        body: '123',
        imageRefs: [],
        videoRefs: [],
        parentId: null,
      })) as DataMutationResult<{ id: string }>;
      expect(text.ok).toBe(true);
      if (!text.ok || !text.value) throw new Error('expected the text-only post to succeed');
      expect(deliveries.at(-1)?.find((row) => row.postId === text.value!.id)).toMatchObject({
        body: '123',
        mediaKind: null,
        mediaUrls: [],
      });

      const media = (await createPost({
        body: '342',
        imageRefs: ['media/img-01.png'],
        videoRefs: [],
        parentId: null,
      })) as DataMutationResult<{ id: string }>;
      expect(media.ok).toBe(true);
      if (!media.ok || !media.value) throw new Error('expected the media post to succeed');

      const redelivery = deliveries.at(-1) ?? [];
      expect(redelivery.find((row) => row.postId === text.value!.id)).toMatchObject({
        body: '123',
        mediaKind: null,
        mediaUrls: [],
      });
      expect(redelivery.find((row) => row.postId === media.value!.id)).toMatchObject({
        body: '342',
        mediaKind: 'images',
        mediaUrls: ['/assets/fixtures/img-01.png'],
      });
      expect(deliveries.length).toBeGreaterThanOrEqual(3);
    } finally {
      subscription.dispose();
      projection.dispose();
    }
  });

  it('delivers every declared M2 validation rejection', async () => {
    const { provider } = createCoterieMemoryHarness();
    const cases = [
      {
        args: { body: '', imageRefs: [], videoRefs: [], parentId: null },
        error: 'PostBodyInvalidError',
      },
      {
        args: { body: 'x'.repeat(501), imageRefs: [], videoRefs: [], parentId: null },
        error: 'PostBodyInvalidError',
      },
      {
        args: {
          body: '',
          imageRefs: Array.from({ length: 5 }, () => 'media/img-01.png'),
          videoRefs: [],
          parentId: null,
        },
        error: 'ImageCountInvalidError',
      },
      {
        args: {
          body: '',
          imageRefs: [],
          videoRefs: ['media/vid-01.mp4', 'media/vid-01.mp4'],
          parentId: null,
        },
        error: 'VideoCountInvalidError',
      },
      {
        args: {
          body: '',
          imageRefs: ['media/img-01.png'],
          videoRefs: ['media/vid-01.mp4'],
          parentId: null,
        },
        error: 'MediaMixInvalidError',
      },
      {
        args: {
          body: '',
          imageRefs: ['media/not-committed.png'],
          videoRefs: [],
          parentId: null,
        },
        error: 'MediaReferenceInvalidError',
      },
      {
        args: { body: 'orphan', imageRefs: [], videoRefs: [], parentId: 'missing-parent' },
        error: 'ParentPostNotFoundError',
      },
    ] as const;
    for (const testCase of cases) {
      expectMutationError(await provider.mutate('createPost', testCase.args), testCase.error);
    }

    expectMutationError(
      await provider.mutate('setLike', {
        postId: 'missing-post',
        liked: true,
        mutationId: 'missing-like',
      }),
      'PostNotFoundError',
    );
    expectMutationError(
      await provider.mutate('setRepost', {
        postId: 'missing-post',
        reposted: true,
        mutationId: 'missing-repost',
      }),
      'PostNotFoundError',
    );
    expectMutationError(
      await provider.mutate('setRepost', {
        postId: 'sr0001',
        reposted: true,
        mutationId: 'reply-repost',
      }),
      'ReplyRepostForbiddenError',
    );
    expectMutationError(
      await provider.mutate('setFollow', {
        userId: 'alice',
        following: true,
        mutationId: 'self-follow',
      }),
      'SelfFollowInvalidError',
    );
    expectMutationError(
      await provider.mutate('setFollow', {
        userId: 'missing-profile',
        following: true,
        mutationId: 'missing-follow',
      }),
      'ProfileNotFoundError',
    );
    expect(readCell(provider, 'listThread', { parentId: 'missing-parent' })).toMatchObject({
      status: 'error',
      error: { name: 'ParentPostNotFoundError' },
    });
    expect(readCell(provider, 'listProfilePosts', { userId: 'missing-profile' })).toMatchObject({
      status: 'error',
      error: { name: 'ProfileNotFoundError' },
    });
  });

  it('keeps replies out of feeds and returns only direct replies chronologically', async () => {
    const { provider } = createCoterieMemoryHarness();
    const direct = await provider.mutate<{ id: string }>('createPost', {
      body: 'Direct local reply',
      imageRefs: [],
      videoRefs: [],
      parentId: 'sp0001',
    });
    if (!direct.ok) throw new Error('direct reply failed');
    const nested = await provider.mutate<{ id: string }>('createPost', {
      body: 'Nested local reply',
      imageRefs: [],
      videoRefs: [],
      parentId: direct.value.id,
    });
    if (!nested.ok) throw new Error('nested reply failed');

    const parentThread = readRows<{ postId: string; threadRole: string }>(
      provider,
      'listThread',
      { parentId: 'sp0001' },
    );
    expect(parentThread.map((row) => row.postId)).toEqual([
      'sp0001',
      'sr0001',
      direct.value.id,
    ]);
    expect(parentThread.some((row) => row.postId === nested.value.id)).toBe(false);
    expect(
      readRows<{ postId: string }>(provider, 'listThread', { parentId: direct.value.id }).map(
        (row) => row.postId,
      ),
    ).toEqual([direct.value.id, nested.value.id]);
    for (const mode of ['following', 'global']) {
      const feed = readRows<{ postId: string }>(provider, 'listFeed', { mode, cursor: null });
      expect(feed.some((row) => row.postId === direct.value.id)).toBe(false);
      expect(feed.some((row) => row.postId === nested.value.id)).toBe(false);
    }
  });

  it('attributes reposts and keeps own reposts separate from follow projection', async () => {
    const { provider } = createCoterieMemoryHarness();
    const setIntent = {
      postId: 'sp0019',
      reposted: true,
      mutationId: 'alice-repost-grace',
    };
    expect((await provider.mutate('setRepost', setIntent)).ok).toBe(true);
    expect((await provider.mutate('setRepost', setIntent)).ok).toBe(true);
    const following = readRows<{
      id: string;
      postId: string;
      repostedById: string | null;
      repostedByName: string | null;
      repostedByMe: boolean;
    }>(provider, 'listFeed', { mode: 'following', cursor: null });
    expect(following.some((row) => row.id === 'sp0019')).toBe(false);
    expect(following.find((row) => row.id === 'repost:alice:sp0019')).toMatchObject({
      postId: 'sp0019',
      repostedById: 'alice',
      repostedByName: 'Alice Alvarez',
      repostedByMe: true,
    });

    const clearIntent = {
      postId: 'sp0019',
      reposted: false,
      mutationId: 'alice-unrepost-grace',
    };
    expect((await provider.mutate('setRepost', clearIntent)).ok).toBe(true);
    expect((await provider.mutate('setRepost', clearIntent)).ok).toBe(true);
    expect(
      readRows<{ id: string }>(provider, 'listFeed', {
        mode: 'following',
        cursor: null,
      }).some((row) => row.id === 'repost:alice:sp0019'),
    ).toBe(false);
  });

  it('keeps cursor pages live for like, repost, follow, and create mutations after row 20', async () => {
    const { provider } = createCoterieMemoryHarness();
    for (const userId of ['dave', 'erin', 'frank', 'grace', 'henry']) {
      expect((await provider.mutate('setFollow', {
        userId,
        following: true,
        mutationId: `live-page-follow-${userId}`,
      })).ok).toBe(true);
    }

    type Row = {
      id: string;
      postId: string;
      authorId: string;
      repostedById: string | null;
      likeCount: number;
      likedByMe: boolean;
      repostCount: number;
      repostedByMe: boolean;
      nextCursor: string | null;
    };
    const first = readRows<Row>(provider, 'listFeed', { mode: 'following', cursor: null });
    expect(first).toHaveLength(20);
    const cursor = first[0]?.nextCursor;
    expect(cursor).toEqual(expect.any(String));
    const older = collectReady<Row[]>(provider, 'listFeed', { mode: 'following', cursor });
    expect(older.snapshots[0]?.length).toBeGreaterThan(0);
    const target = older.snapshots[0]!.find((row) => !row.likedByMe && !row.repostedByMe);
    if (!target) throw new Error('expected an unliked, unreposted row after row 20');

    expect((await provider.mutate('setLike', {
      postId: target.postId,
      liked: true,
      mutationId: 'live-page-like-set',
    })).ok).toBe(true);
    expect(older.snapshots.at(-1)?.find((row) => row.id === target.id)).toMatchObject({
      likedByMe: true,
      likeCount: target.likeCount + 1,
    });
    expect((await provider.mutate('setLike', {
      postId: target.postId,
      liked: false,
      mutationId: 'live-page-like-clear',
    })).ok).toBe(true);
    expect(older.snapshots.at(-1)?.find((row) => row.id === target.id)).toMatchObject({
      likedByMe: false,
      likeCount: target.likeCount,
    });

    expect((await provider.mutate('setRepost', {
      postId: target.postId,
      reposted: true,
      mutationId: 'live-page-repost-set',
    })).ok).toBe(true);
    expect(older.snapshots.at(-1)?.find((row) => row.id === target.id)).toMatchObject({
      repostedByMe: true,
      repostCount: target.repostCount + 1,
    });
    expect((await provider.mutate('setRepost', {
      postId: target.postId,
      reposted: false,
      mutationId: 'live-page-repost-clear',
    })).ok).toBe(true);
    expect(older.snapshots.at(-1)?.find((row) => row.id === target.id)).toMatchObject({
      repostedByMe: false,
      repostCount: target.repostCount,
    });

    const actorToUnfollow = older.snapshots[0]!.find((row) => row.authorId !== 'alice')!.authorId;
    expect((await provider.mutate('setFollow', {
      userId: actorToUnfollow,
      following: false,
      mutationId: 'live-page-unfollow',
    })).ok).toBe(true);
    expect(older.snapshots.at(-1)?.some(
      (row) =>
        (row.repostedById === null && row.authorId === actorToUnfollow)
        || row.repostedById === actorToUnfollow,
    )).toBe(false);
    expect((await provider.mutate('setFollow', {
      userId: actorToUnfollow,
      following: true,
      mutationId: 'live-page-refollow',
    })).ok).toBe(true);
    expect(older.snapshots.at(-1)?.some(
      (row) =>
        (row.repostedById === null && row.authorId === actorToUnfollow)
        || row.repostedById === actorToUnfollow,
    )).toBe(true);

    const head = collectReady<Row[]>(provider, 'listFeed', { mode: 'following', cursor: null });
    const created = await provider.mutate<{ id: string }>('createPost', {
      body: 'A live head post after pagination',
      imageRefs: [],
      videoRefs: [],
      parentId: null,
    });
    if (!created.ok) throw new Error('expected createPost to succeed');
    expect(head.snapshots.at(-1)?.[0]).toMatchObject({ postId: created.value.id });
    older.dispose();
    head.dispose();
  });

  it('paginates both feeds at 20 with opaque keyset cursors and no gaps or duplicates', async () => {
    const { provider } = createCoterieMemoryHarness();
    for (const userId of ['dave', 'erin', 'frank', 'grace', 'henry']) {
      expect(
        (
          await provider.mutate('setFollow', {
            userId,
            following: true,
            mutationId: `page-follow-${userId}`,
          })
        ).ok,
      ).toBe(true);
    }

    let followingCursor: string | null = null;
    for (const mode of ['following', 'global']) {
      const first = readRows<{ id: string; feedSortAt: string; nextCursor: string | null }>(
        provider,
        'listFeed',
        { mode, cursor: null },
      );
      expect(first).toHaveLength(20);
      const cursor = first.at(-1)?.nextCursor;
      expect(cursor).toEqual(expect.any(String));
      if (mode === 'following') followingCursor = cursor ?? null;
      expect(first.every((row) => row.nextCursor === cursor)).toBe(true);
      const second = readRows<{ id: string; feedSortAt: string; nextCursor: string | null }>(
        provider,
        'listFeed',
        { mode, cursor },
      );
      expect(second).toHaveLength(8);
      expect(second.every((row) => row.nextCursor === null)).toBe(true);
      const combined = [...first, ...second];
      expect(new Set(combined.map((row) => row.id)).size).toBe(28);
      expect(
        combined.every(
          (row, index) => index === 0 || combined[index - 1]!.feedSortAt >= row.feedSortAt,
        ),
      ).toBe(true);
    }

    expect(readCell(provider, 'listFeed', { mode: 'global', cursor: followingCursor })).toMatchObject({
      status: 'error',
      error: { name: 'FeedCursorInvalidError' },
    });

    expect(readCell(provider, 'listFeed', { mode: 'trending', cursor: null })).toMatchObject({
      status: 'error',
      error: { name: 'FeedModeInvalidError' },
    });
    expect(readCell(provider, 'listFeed', { mode: 'global', cursor: 'not-a-cursor' })).toMatchObject({
      status: 'error',
      error: { name: 'FeedCursorInvalidError' },
    });
  });

  it('projects fixture quotes, round-trips quoted sends, and rejects invalid targets', async () => {
    const { provider, boundary } = createCoterieMemoryHarness();
    type ProjectedMessage = {
      id: string;
      body: string;
      quotedMessageId: string | null;
      quotedSenderName: string | null;
      quotedBodySnippet: string | null;
    };
    const dm = collectReady<ProjectedMessage[]>(provider, 'listMessages', {
      chatId: 'd-alice-bob',
    });
    const group = collectReady<ProjectedMessage[]>(provider, 'listMessages', {
      chatId: 'g-starter',
    });

    expect(
      dm.snapshots[0]
        ?.filter((message) => message.quotedMessageId !== null)
        .map((message) => [message.id, message.quotedMessageId]),
    ).toEqual([
      ['sm0002', 'sm0001'],
      ['sm0003', 'sm0002'],
      ['sm0006', 'sm0005'],
    ]);
    expect(
      group.snapshots[0]
        ?.filter((message) => message.quotedMessageId !== null)
        .map((message) => [message.id, message.quotedMessageId]),
    ).toEqual([
      ['sm0008', 'sm0007'],
      ['sm0011', 'sm0010'],
      ['sm0014', 'sm0013'],
    ]);
    expect(group.snapshots[0]?.find((message) => message.id === 'sm0014')).toMatchObject({
      quotedSenderName: 'Dave Diaz',
      quotedBodySnippet: 'Should I book dinner?',
    });

    const sent = await provider.mutate('sendMessage', {
      chatId: 'g-starter',
      body: 'Replying with an explicit quote.',
      quotedMessageId: 'sm0013',
    });
    expect(sent.ok).toBe(true);
    expect(group.snapshots.at(-1)?.at(-1)).toMatchObject({
      body: 'Replying with an explicit quote.',
      quotedMessageId: 'sm0013',
      quotedSenderName: 'Dave Diaz',
      quotedBodySnippet: 'Should I book dinner?',
    });

    expectMutationError(
      await provider.mutate('sendMessage', {
        chatId: 'g-starter',
        body: 'Unknown quote target',
        quotedMessageId: 'sm-missing',
      }),
      'QuotedMessageInvalidError',
    );
    expectMutationError(
      await provider.mutate('sendMessage', {
        chatId: 'g-starter',
        body: 'Foreign quote target',
        quotedMessageId: 'sm0001',
      }),
      'QuotedMessageInvalidError',
    );
    expectMutationError(
      await provider.mutate('sendMessage', {
        chatId: 'chat-missing',
        body: 'Unknown conversation',
        quotedMessageId: null,
      }),
      'ChatNotFoundError',
    );

    boundary.write<Record<string, unknown>>('messages', (rows) =>
      rows.map((message) =>
        message.id === 'sm0013'
          ? { ...message, body: 'Text that must not leak', deleted: true }
          : message,
      ),
    );
    expect(group.snapshots.at(-1)?.find((message) => message.id === 'sm0014')).toMatchObject({
      quotedMessageId: 'sm0013',
      quotedSenderName: 'Dave Diaz',
      quotedBodySnippet: 'This message was deleted',
    });
    expect(group.snapshots.at(-1)?.find((message) => message.id === 'sm0014')?.quotedBodySnippet)
      .not.toContain('must not leak');

    dm.dispose();
    group.dispose();
  });

  it('sets reaction state idempotently, aggregates by emoji, and invalidates messages', async () => {
    const { provider } = createCoterieMemoryHarness();
    type Reaction = { emoji: string; count: number; reactedByMe: boolean };
    const group = collectReady<Array<{ id: string; reactions: Reaction[] }>>(
      provider,
      'listMessages',
      { chatId: 'g-starter' },
    );
    const initialDeliveryCount = group.snapshots.length;
    const intent = {
      chatId: 'g-starter',
      messageId: 'sm0015',
      emoji: '👍',
      reacted: true,
      mutationId: 'alice-thumb-up',
    };

    expect((await provider.mutate('setMessageReaction', intent)).ok).toBe(true);
    expect((await provider.mutate('setMessageReaction', intent)).ok).toBe(true);
    expect(group.snapshots.length).toBeGreaterThan(initialDeliveryCount);
    expect(group.snapshots.at(-1)?.find((message) => message.id === 'sm0015')?.reactions)
      .toEqual([{ emoji: '👍', count: 1, reactedByMe: true }]);

    expect(
      (
        await provider.mutate('login', {
          email: 'bob@example.com',
          password: 'Bob!Clique2026',
        })
      ).ok,
    ).toBe(true);
    expect((await provider.mutate('setMessageReaction', intent)).ok).toBe(true);
    expect(
      (
        await provider.mutate('login', {
          email: 'alice@example.com',
          password: 'Alice!Clique2026',
        })
      ).ok,
    ).toBe(true);
    expect(group.snapshots.at(-1)?.find((message) => message.id === 'sm0015')?.reactions)
      .toEqual([{ emoji: '👍', count: 2, reactedByMe: true }]);

    expect(
      (
        await provider.mutate('setMessageReaction', {
          ...intent,
          emoji: '❤️',
          reacted: true,
          mutationId: 'alice-heart-set',
        })
      ).ok,
    ).toBe(true);
    expect(group.snapshots.at(-1)?.find((message) => message.id === 'sm0015')?.reactions)
      .toEqual([
        { emoji: '❤️', count: 1, reactedByMe: true },
        { emoji: '👍', count: 1, reactedByMe: false },
      ]);
    expect(
      (
        await provider.mutate('setMessageReaction', {
          ...intent,
          emoji: '❤️',
          reacted: true,
          mutationId: 'alice-heart-same-state',
        })
      ).ok,
    ).toBe(true);
    expect(group.snapshots.at(-1)?.find((message) => message.id === 'sm0015')?.reactions)
      .toEqual([
        { emoji: '❤️', count: 1, reactedByMe: true },
        { emoji: '👍', count: 1, reactedByMe: false },
      ]);
    expect((await provider.mutate('setMessageReaction', intent)).ok).toBe(true);
    expect(group.snapshots.at(-1)?.find((message) => message.id === 'sm0015')?.reactions)
      .toEqual([
        { emoji: '❤️', count: 1, reactedByMe: true },
        { emoji: '👍', count: 1, reactedByMe: false },
      ]);
    expect(
      (
        await provider.mutate('setMessageReaction', {
          ...intent,
          emoji: '❤️',
          reacted: false,
          mutationId: 'alice-heart-clear',
        })
      ).ok,
    ).toBe(true);
    expect(
      (
        await provider.mutate('setMessageReaction', {
          ...intent,
          emoji: '❤️',
          reacted: false,
          mutationId: 'alice-heart-clear',
        })
      ).ok,
    ).toBe(true);
    expect(group.snapshots.at(-1)?.find((message) => message.id === 'sm0015')?.reactions)
      .toEqual([{ emoji: '👍', count: 1, reactedByMe: false }]);

    expectMutationError(
      await provider.mutate('setMessageReaction', {
        ...intent,
        messageId: 'sm-missing',
      }),
      'MessageNotFoundError',
    );
    expectMutationError(
      await provider.mutate('setMessageReaction', {
        ...intent,
        chatId: 'chat-missing',
      }),
      'ChatNotFoundError',
    );
    expectMutationError(
      await provider.mutate('setMessageReaction', { ...intent, emoji: 'not emoji' }),
      'EmojiInvalidError',
    );
    group.dispose();
  });

  it('deduplicates DMs and keeps same-membership groups distinct with admin authorization', async () => {
    const { provider } = createCoterieMemoryHarness();
    const firstDm = await provider.mutate<{ chatId: string; reused: boolean }>('openDm', {
      userId: 'bob',
    });
    const secondDm = await provider.mutate<{ chatId: string; reused: boolean }>('openDm', {
      userId: 'bob',
    });
    expect(firstDm).toEqual({ ok: true, value: { chatId: 'd-alice-bob', reused: true } });
    expect(secondDm).toEqual(firstDm);

    const firstGroup = await provider.mutate<{ chatId: string }>('createGroup', {
      name: 'M3 Test Group',
      description: 'First identity',
      memberIds: ['alice', 'bob', 'carol'],
    });
    const secondGroup = await provider.mutate<{ chatId: string }>('createGroup', {
      name: 'M3 Test Group',
      description: 'Second identity',
      memberIds: ['alice', 'bob', 'carol'],
    });
    expect(firstGroup.ok).toBe(true);
    expect(secondGroup.ok).toBe(true);
    expect(firstGroup.value?.chatId).not.toBe(secondGroup.value?.chatId);

    expectMutationError(
      await provider.mutate('createGroup', {
        name: 'x'.repeat(51),
        description: null,
        memberIds: ['alice', 'bob'],
      }),
      'GroupNameInvalidError',
    );
    expectMutationError(
      await provider.mutate('createGroup', {
        name: 'Missing creator',
        description: null,
        memberIds: ['bob', 'carol'],
      }),
      'GroupMembersInvalidError',
    );

    const firstGroupId = firstGroup.value!.chatId;
    await provider.mutate('login', { email: 'bob@example.com', password: 'Bob!Clique2026' });
    const bobGroup = await provider.mutate<{ chatId: string }>('createGroup', {
      name: 'Bob-created group',
      description: 'The active creator is not Alice.',
      memberIds: ['alice', 'bob'],
    });
    expect(bobGroup.ok).toBe(true);
    expect(
      readRows<{
        id: string;
        currentUserIsAdmin: boolean;
        currentUserIsMember: boolean;
        memberIds: string[];
      }>(provider, 'listChats', {}).find((chat) => chat.id === bobGroup.value?.chatId),
    ).toMatchObject({
      currentUserIsAdmin: true,
      currentUserIsMember: true,
      memberIds: expect.arrayContaining(['alice', 'bob']),
    });
    expectMutationError(
      await provider.mutate('removeMember', { chatId: firstGroupId, userId: 'carol' }),
      'ChatAdminRequiredError',
    );
    await provider.mutate('login', { email: 'alice@example.com', password: 'Alice!Clique2026' });
    expect(await provider.mutate('promoteAdmin', { chatId: firstGroupId, userId: 'bob' }))
      .toEqual({ ok: true });
    await provider.mutate('login', { email: 'bob@example.com', password: 'Bob!Clique2026' });
    expect(await provider.mutate('removeMember', { chatId: firstGroupId, userId: 'carol' }))
      .toEqual({ ok: true });
  });

  it('publishes typing immediately, refreshes its lease, and expires through the deterministic clock', async () => {
    const { provider, advanceClock } = createCoterieMemoryHarness();
    await provider.mutate('login', { email: 'bob@example.com', password: 'Bob!Clique2026' });
    expect(await provider.mutate('setTyping', { chatId: 'g-starter', active: true }))
      .toEqual({ ok: true });
    advanceClock(4000);
    expect(await provider.mutate('setTyping', { chatId: 'g-starter', active: true }))
      .toEqual({ ok: true });

    await provider.mutate('login', { email: 'alice@example.com', password: 'Alice!Clique2026' });
    const typing = collectReady<Array<{ userId: string; displayName: string }>>(
      provider,
      'observeTyping',
      { chatId: 'g-starter' },
    );
    const chats = collectReady<Array<{ id: string; typingHint: string | null }>>(
      provider,
      'listChats',
      {},
    );
    expect(typing.snapshots.at(-1)).toContainEqual({
      id: 'g-starter:bob',
      chatId: 'g-starter',
      userId: 'bob',
      displayName: 'Bob Bennett',
      expiresAt: '2026-01-01T00:01:39.000Z',
    });
    expect(chats.snapshots.at(-1)?.find((chat) => chat.id === 'g-starter')?.typingHint)
      .toBe('Bob Bennett typing...');
    advanceClock(1000);
    expect(typing.snapshots.at(-1)?.some((entry) => entry.userId === 'bob')).toBe(true);
    advanceClock(4000);
    expect(typing.snapshots.at(-1)).toEqual([]);
    expect(chats.snapshots.at(-1)?.find((chat) => chat.id === 'g-starter')?.typingHint)
      .toBeNull();
    typing.dispose();
    chats.dispose();
  });

  it('aggregates monotonic receipts over send-time recipients and preserves removal/join history', async () => {
    const { provider } = createCoterieMemoryHarness();
    const created = await provider.mutate<{ chatId: string }>('createGroup', {
      name: 'Receipt Group',
      description: null,
      memberIds: ['alice', 'bob', 'carol'],
    });
    const chatId = created.value!.chatId;
    const sent = await provider.mutate<{ id: string }>('sendMessage', {
      chatId,
      body: 'Receipt one',
      quotedMessageId: null,
    });
    const firstMessageId = sent.value!.id;
    const messages = collectReady<Array<{
      id: string;
      status: string;
      recipientCount: number;
      deliveredCount: number;
      readCount: number;
    }>>(provider, 'listMessages', { chatId });
    expect(messages.snapshots.at(-1)?.find((message) => message.id === firstMessageId))
      .toMatchObject({ status: 'sent', recipientCount: 2, deliveredCount: 0, readCount: 0 });

    await provider.mutate('login', { email: 'bob@example.com', password: 'Bob!Clique2026' });
    await provider.mutate('markReceipt', { chatId, state: 'delivered' });
    await provider.mutate('login', { email: 'carol@example.com', password: 'Carol!Clique2026' });
    await provider.mutate('markReceipt', { chatId, state: 'delivered' });
    expect(messages.snapshots.at(-1)?.find((message) => message.id === firstMessageId))
      .toMatchObject({ status: 'delivered', deliveredCount: 2, readCount: 0 });

    await provider.mutate('login', { email: 'bob@example.com', password: 'Bob!Clique2026' });
    await provider.mutate('markReceipt', { chatId, state: 'read' });
    expect(messages.snapshots.at(-1)?.find((message) => message.id === firstMessageId)?.status)
      .toBe('delivered');
    await provider.mutate('login', { email: 'carol@example.com', password: 'Carol!Clique2026' });
    await provider.mutate('markReceipt', { chatId, state: 'read' });
    expect(messages.snapshots.at(-1)?.find((message) => message.id === firstMessageId))
      .toMatchObject({ status: 'read', readCount: 2 });

    await provider.mutate('login', { email: 'alice@example.com', password: 'Alice!Clique2026' });
    const second = await provider.mutate<{ id: string }>('sendMessage', {
      chatId,
      body: 'Receipt two',
      quotedMessageId: firstMessageId,
    });
    await provider.mutate('login', { email: 'bob@example.com', password: 'Bob!Clique2026' });
    await provider.mutate('markReceipt', { chatId, state: 'read' });
    await provider.mutate('login', { email: 'alice@example.com', password: 'Alice!Clique2026' });
    await provider.mutate('removeMember', { chatId, userId: 'carol' });
    expect(messages.snapshots.at(-1)?.find((message) => message.id === second.value!.id))
      .toMatchObject({ status: 'read', recipientCount: 1, readCount: 1 });

    const third = await provider.mutate<{ id: string }>('sendMessage', {
      chatId,
      body: 'After Carol left',
      quotedMessageId: null,
    });
    await provider.mutate('addMember', { chatId, userId: 'dave' });
    await provider.mutate('login', { email: 'carol@example.com', password: 'Carol!Clique2026' });
    const carolHistory = collectReady<Array<{ id: string }>>(provider, 'listMessages', { chatId });
    expect(carolHistory.snapshots.at(-1)?.some((message) => message.id === second.value!.id)).toBe(true);
    expect(carolHistory.snapshots.at(-1)?.some((message) => message.id === third.value!.id)).toBe(false);
    carolHistory.dispose();

    await provider.mutate('login', { email: 'dave@example.com', password: 'Dave!Clique2026' });
    const daveHistory = collectReady<Array<{ id: string }>>(provider, 'listMessages', { chatId });
    expect(daveHistory.snapshots.at(-1)?.some((message) => message.id === firstMessageId)).toBe(true);
    expect(daveHistory.snapshots.at(-1)?.some((message) => message.id === third.value!.id)).toBe(true);
    expect(
      readRows<{ id: string; unreadCount: number }>(provider, 'listChats', {})
        .find((chat) => chat.id === chatId)?.unreadCount,
    ).toBe(0);
    daveHistory.dispose();
    messages.dispose();
  });

  it('keeps removed-member history and typing route queries ready while refusing live writes', async () => {
    const { provider } = createCoterieMemoryHarness();
    const created = await provider.mutate<{ chatId: string }>('createGroup', {
      name: 'Retained history',
      description: null,
      memberIds: ['alice', 'bob'],
    });
    if (!created.ok) throw new Error('expected retained-history group creation to succeed');
    const chatId = created.value.chatId;
    const sent = await provider.mutate<{ id: string }>('sendMessage', {
      chatId,
      body: 'Visible before removal',
      quotedMessageId: null,
    });
    if (!sent.ok) throw new Error('expected retained-history message send to succeed');
    expect((await provider.mutate('removeMember', { chatId, userId: 'bob' })).ok).toBe(true);

    await provider.mutate('login', { email: 'bob@example.com', password: 'Bob!Clique2026' });
    expect(readRows<{ id: string; currentUserIsMember: boolean }>(
      provider,
      'listChats',
      {},
    ).find((chat) => chat.id === chatId)).toMatchObject({ currentUserIsMember: false });
    expect(readCell(provider, 'listMessages', { chatId })).toMatchObject({
      status: 'ready',
      value: expect.arrayContaining([expect.objectContaining({ id: sent.value.id })]),
    });
    expect(readCell(provider, 'observeTyping', { chatId })).toMatchObject({
      status: 'ready',
      value: [],
    });
    expectMutationError(
      await provider.mutate('setMessageReaction', {
        chatId,
        messageId: sent.value.id,
        emoji: '👍',
        reacted: true,
        mutationId: 'removed-bob-reaction',
      }),
      'ChatMembershipRequiredError',
    );

    await provider.mutate('login', { email: 'dave@example.com', password: 'Dave!Clique2026' });
    expect(readCell(provider, 'observeTyping', { chatId })).toMatchObject({
      status: 'error',
      error: { name: 'ChatMembershipRequiredError' },
    });
  });

  it('projects read when every send-time recipient has dropped from the requirement', async () => {
    const { provider } = createCoterieMemoryHarness();
    const created = await provider.mutate<{ chatId: string }>('createGroup', {
      name: 'Empty receipt set',
      description: null,
      memberIds: ['alice', 'bob'],
    });
    if (!created.ok) throw new Error('expected empty-receipt group creation to succeed');
    const sent = await provider.mutate<{ id: string }>('sendMessage', {
      chatId: created.value.chatId,
      body: 'No remaining required recipient',
      quotedMessageId: null,
    });
    if (!sent.ok) throw new Error('expected empty-receipt message send to succeed');
    expect((await provider.mutate('removeMember', {
      chatId: created.value.chatId,
      userId: 'bob',
    })).ok).toBe(true);
    expect(
      readRows<{
        id: string;
        status: string;
        recipientCount: number;
        deliveredCount: number;
        readCount: number;
      }>(provider, 'listMessages', { chatId: created.value.chatId })
        .find((message) => message.id === sent.value.id),
    ).toMatchObject({
      status: 'read',
      recipientCount: 0,
      deliveredCount: 0,
      readCount: 0,
    });
  });

  it('allows the last admin to leave and leaves admin-only operations refused', async () => {
    const { provider } = createCoterieMemoryHarness();
    const created = await provider.mutate<{ chatId: string }>('createGroup', {
      name: 'Admin-less group',
      description: null,
      memberIds: ['alice', 'bob'],
    });
    if (!created.ok) throw new Error('expected admin-less group creation to succeed');
    const chatId = created.value.chatId;
    expect(await provider.mutate('leaveChat', { chatId })).toEqual({ ok: true });

    await provider.mutate('login', { email: 'bob@example.com', password: 'Bob!Clique2026' });
    expect(readRows<{
      id: string;
      currentUserIsAdmin: boolean;
      currentUserIsMember: boolean;
    }>(provider, 'listChats', {}).find((chat) => chat.id === chatId)).toMatchObject({
      currentUserIsAdmin: false,
      currentUserIsMember: true,
    });
    for (const [operation, args] of [
      ['addMember', { chatId, userId: 'carol' }],
      ['removeMember', { chatId, userId: 'alice' }],
      ['promoteAdmin', { chatId, userId: 'bob' }],
    ] as const) {
      expectMutationError(
        await provider.mutate(operation, args),
        'ChatAdminRequiredError',
      );
    }
  });

  it('claims every operation implemented by the memory provider with declared tokens', () => {
    const { provider } = createCoterieMemoryHarness();
    const claims = collectReady<Array<{ name: string; kind: string; token: string }>>(
      provider,
      'listProviderClaims',
      {},
    );
    const expectedNames = [
      ...Object.keys(coterieSurfaceManifest.queries),
      ...Object.keys(coterieSurfaceManifest.mutations),
    ].sort();
    expect(claims.snapshots[0]?.map((claim) => claim.name)).toEqual(expectedNames);
    expect(claims.snapshots[0]).toContainEqual({ name: 'listMessages', kind: 'query', token: '4' });
    expect(claims.snapshots[0]).toContainEqual({ name: 'sendMessage', kind: 'mutation', token: '4' });
    expect(claims.snapshots[0]).toContainEqual({
      name: 'setMessageReaction',
      kind: 'mutation',
      token: '2',
    });
    claims.dispose();
  });

  it('accepts every avatar picker ref in the landed eight-persona vocabulary', async () => {
    const { provider } = createCoterieMemoryHarness();

    expect(COTERIE_AVATAR_REFS).toEqual([
      'media/avatar-alice.png',
      'media/avatar-bob.png',
      'media/avatar-carol.png',
      'media/avatar-dave.png',
      'media/avatar-erin.png',
      'media/avatar-frank.png',
      'media/avatar-grace.png',
      'media/avatar-henry.png',
    ]);

    for (const avatarRef of COTERIE_AVATAR_REFS) {
      const result = await provider.mutate('setAvatar', { avatarRef });
      expect(result.ok).toBe(true);
    }
  });

  it('offers every provider-accepted composer fixture ref with its served asset path', () => {
    expect(COTERIE_COMPOSER_MEDIA_OPTIONS).toEqual([
      { id: 'img-01', label: 'Image 1', kind: 'image', mediaRef: 'media/img-01.png', url: '/assets/fixtures/img-01.png' },
      { id: 'img-02', label: 'Image 2', kind: 'image', mediaRef: 'media/img-02.png', url: '/assets/fixtures/img-02.png' },
      { id: 'img-03', label: 'Image 3', kind: 'image', mediaRef: 'media/img-03.png', url: '/assets/fixtures/img-03.png' },
      { id: 'img-04', label: 'Image 4', kind: 'image', mediaRef: 'media/img-04.png', url: '/assets/fixtures/img-04.png' },
      { id: 'img-05', label: 'Image 5', kind: 'image', mediaRef: 'media/img-05.png', url: '/assets/fixtures/img-05.png' },
      { id: 'img-06', label: 'Image 6', kind: 'image', mediaRef: 'media/img-06.png', url: '/assets/fixtures/img-06.png' },
      { id: 'vid-01', label: 'Video 1', kind: 'video', mediaRef: 'media/vid-01.mp4', url: '/assets/fixtures/vid-01.mp4' },
    ]);
  });
});
