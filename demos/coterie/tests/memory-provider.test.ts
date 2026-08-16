import { describe, expect, it } from 'bun:test';

import {
  assertDataProviderConformance,
  type DataProviderConformanceFixture,
} from '@exact/contract/conformance';
import type { ContractDataProvider } from '@exact/contract/runtime';

import {
  coterieMemoryManifest,
  createCoterieMemoryHarness,
  type CoterieMemoryHarness,
} from '../src/data/memory-provider.ts';

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

describe('Coterie backendless provider', () => {
  it('passes the Exact provider conformance surface it claims', async () => {
    let harness: CoterieMemoryHarness | null = null;
    const fixture: DataProviderConformanceFixture = {
      name: 'coterie-memory',
      capabilities: coterieMemoryManifest.capabilities,
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
    const profiles = collectReady<Array<{ id: string; displayName: string }>>(
      provider,
      'listProfiles',
      {},
    );
    const feed = collectReady<Array<{ id: string; authorName: string }>>(
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
    });
    expect(result.ok).toBe(true);
    expect(profiles.snapshots.at(-1)?.find((profile) => profile.id === 'alice')?.displayName).toBe(
      'Alice Fixture Edit',
    );
    expect(feed.snapshots.at(-1)?.find((post) => post.id === 'sp0001')?.authorName).toBe(
      'Alice Fixture Edit',
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
