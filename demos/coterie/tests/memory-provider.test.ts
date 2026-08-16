import { describe, expect, it } from 'bun:test';

import {
  assertDataProviderConformance,
  type DataProviderConformanceFixture,
} from '@exact/contract/conformance';

import {
  coterieMemoryManifest,
  createCoterieMemoryHarness,
  type CoterieMemoryHarness,
} from '../src/data/memory-provider.ts';

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

  it('updates subscribers through the same query after a mutation', async () => {
    const { provider } = createCoterieMemoryHarness();
    const snapshots: unknown[] = [];
    const subscription = provider.subscribe('listFeed', { mode: 'global' }, (cell) => {
      if (cell.status === 'ready') snapshots.push(cell.value);
    });

    const result = await provider.mutate('toggleLike', { postId: 'post-1' });
    expect(result.ok).toBe(true);
    expect(snapshots.length).toBe(2);
    const latest = snapshots.at(-1) as Array<{ id: string; likeCount: number; likedByMe: boolean }>;
    expect(latest.find((post) => post.id === 'post-1')).toMatchObject({
      likeCount: 25,
      likedByMe: true,
    });
    subscription.dispose();
  });

  it('keeps a newly-created post in the current user following feed', async () => {
    const { provider } = createCoterieMemoryHarness();
    const snapshots: Array<Array<{ id: string; body: string }>> = [];
    const subscription = provider.subscribe('listFeed', { mode: 'following' }, (cell) => {
      if (cell.status === 'ready') {
        snapshots.push(cell.value as Array<{ id: string; body: string }>);
      }
    });

    const result = await provider.mutate('createPost', { body: 'Visible to me' });
    expect(result.ok).toBe(true);
    expect(snapshots.at(-1)?.[0]).toMatchObject({ body: 'Visible to me' });
    subscription.dispose();
  });
});
