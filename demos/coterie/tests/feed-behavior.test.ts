import { afterEach, describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';

import { compileContractSource } from '@exact/contract/compiler';
import {
  createOwner,
  createRuntimeContext,
  defineComponent,
  instantiateComponent,
  mount,
  reset,
  type ComponentInstance,
  type ContractQueryHandle,
} from '@exact/contract/runtime';
import type { ElementNode, RootNode, TextNode } from '@exact/renderer/host-ops';

import {
  createCoterieFeedState,
  feedNextCursor,
  reduceCoterieFeedState,
  visibleFeedRows,
  type CoterieFeedState,
} from '../src/data/feed-pagination.ts';
import type { FeedItem } from '../src/data/generated/coterie.types.ts';
import { linkifyPostBody } from '../src/ui/feed-text.ts';

type AnyNode = ElementNode | TextNode;
type MutationResult = { ok: true } | { ok: false; error: { message: string } };
type ProbeLinks = {
  login?: () => Promise<MutationResult> | MutationResult;
  logout?: () => Promise<MutationResult> | MutationResult;
  createPost?: () => Promise<MutationResult> | MutationResult;
  setLike?: () => Promise<MutationResult> | MutationResult;
  setRepost?: () => Promise<MutationResult> | MutationResult;
};

const routeSource = readFileSync(
  new URL('../src/app/routes/index.contract', import.meta.url),
  'utf8',
);

function feedRow(id: string, overrides: Partial<FeedItem> = {}): FeedItem {
  return {
    id,
    postId: `post-${id}`,
    authorId: 'bob',
    authorName: 'Bob Bennett',
    authorHandle: 'bob',
    avatarUrl: '/assets/fixtures/avatar-bob.png',
    body: `Body ${id}`,
    createdAt: `2026-01-01T00:00:${id.padStart(2, '0')}Z`,
    feedSortAt: `2026-01-01T00:00:${id.padStart(2, '0')}Z`,
    likeCount: 0,
    repostCount: 0,
    replyCount: 0,
    likedByMe: false,
    repostedByMe: false,
    mediaUrls: [],
    mediaKind: null,
    repostedById: null,
    repostedByName: null,
    repostedByHandle: null,
    nextCursor: null,
    ...overrides,
  };
}

function isText(node: AnyNode): node is TextNode {
  return 'text' in node && typeof (node as TextNode).text === 'string';
}

function findByTestId(node: { children?: AnyNode[] }, testId: string): ElementNode | null {
  for (const child of node.children ?? []) {
    if (isText(child)) continue;
    const element = child as ElementNode;
    if ((element.originalProps as Record<string, unknown> | undefined)?.testId === testId) {
      return element;
    }
    const nested = findByTestId(element, testId);
    if (nested) return nested;
  }
  return null;
}

function routeActionSource(actionName: string): string {
  const action = routeSource.match(
    new RegExp(String.raw`\n  action ${actionName}[\s\S]*?(?=\n  action |\n  task |\n  contract)`),
  )?.[0];
  if (!action) throw new Error(`missing route action ${actionName}`);
  return action.trimEnd();
}

function routeTaskSource(taskName: string): string {
  const task = routeSource.match(
    new RegExp(String.raw`\n  task ${taskName}[\s\S]*?(?=\n  task |\n  contract)`),
  )?.[0];
  if (!task) throw new Error(`missing route task ${taskName}`);
  return task.trimEnd();
}

function collectTexts(node: { children?: AnyNode[] }): string[] {
  const texts: string[] = [];
  for (const child of node.children ?? []) {
    if (isText(child)) {
      texts.push(child.text);
    } else {
      texts.push(...collectTexts(child));
    }
  }
  return texts;
}

async function settleAsyncWork(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function invokeAction(instance: ComponentInstance, name: string, ...args: unknown[]): unknown {
  const binding = instance.scope.lookup(name);
  if (!binding || binding.kind !== 'value' || typeof binding.value !== 'function') {
    throw new Error(`route action ${name} did not resolve to a callable`);
  }
  return (binding.value as (...callArgs: unknown[]) => unknown)(...args);
}

function readState<T>(instance: ComponentInstance, name: string): T {
  const binding = instance.scope.lookup(name);
  if (!binding || binding.kind !== 'state') {
    throw new Error(`route state ${name} did not resolve`);
  }
  return binding.get() as T;
}

function createFeedProbe(actionNames: readonly string[], links: ProbeLinks = {}) {
  const source = `
use createCoterieFeedState from "./feed-pagination.ts"
use reduceCoterieFeedState from "./feed-pagination.ts"
use login from "./probe-provider.ts"
use logout from "./probe-provider.ts"
use createPost from "./probe-provider.ts"
use setLike from "./probe-provider.ts"
use setRepost from "./probe-provider.ts"

component FeedStateProbe
  state feedState = createCoterieFeedState()

  mutation loginMutation = login
  mutation logoutMutation = logout
  mutation createPostMutation = createPost
  mutation setLikeMutation = setLike
  mutation setRepostMutation = setRepost
${actionNames.map((name) => routeActionSource(name)).join('\n')}

  view
    text feedState.feedTab
`;
  const { file, diagnostics } = compileContractSource(source, 'src/app/feed-state-probe.contract', {
    importSemantics: {
      createCoterieFeedState: {
        kind: 'pure',
        params: [],
        result: 'unknown',
        depends: 'args',
      },
      reduceCoterieFeedState: {
        kind: 'pure',
        params: ['state', 'transition'],
        result: 'unknown',
        depends: 'args',
      },
      login: { kind: 'mutation', effects: ['sessions.write'] },
      logout: { kind: 'mutation', effects: ['sessions.write'] },
      createPost: { kind: 'mutation', effects: ['posts.write'] },
      setLike: { kind: 'mutation', effects: ['likes.write'] },
      setRepost: { kind: 'mutation', effects: ['reposts.write'] },
    } as never,
  });
  expect(diagnostics.filter((diagnostic) => diagnostic.severity === 'error')).toEqual([]);

  const success = () => ({ ok: true as const });
  const component = defineComponent(file, {
    createCoterieFeedState,
    reduceCoterieFeedState,
    login: links.login ?? success,
    logout: links.logout ?? success,
    createPost: links.createPost ?? success,
    setLike: links.setLike ?? success,
    setRepost: links.setRepost ?? success,
  });
  const owner = createOwner();
  const instance = instantiateComponent(
    component,
    {},
    createRuntimeContext(owner, { rootId: 8001 }),
  );
  return { instance, dispose: () => owner.dispose() };
}

function stateOf(instance: ComponentInstance): CoterieFeedState {
  return readState<CoterieFeedState>(instance, 'feedState');
}

function createLiveMutationProbe(
  initialRows: readonly FeedItem[],
  createLinks: (deliver: (rows: readonly FeedItem[]) => void) => ProbeLinks,
) {
  let rows = initialRows;
  let notify: ((nextRows: readonly FeedItem[]) => void) | null = null;
  let subscribeCount = 0;
  const deliver = (nextRows: readonly FeedItem[]) => {
    rows = nextRows;
    notify?.(rows);
  };
  const queryHandle: ContractQueryHandle<FeedItem> = {
    __exactContractQuery: true,
    table: 'feedEvents',
    key: 'feed:following:head',
    read: () => rows,
    subscribe(next) {
      subscribeCount += 1;
      notify = next;
      next(rows);
      return {
        get current() {
          return rows;
        },
        dispose() {
          if (notify === next) notify = null;
        },
      };
    },
  };
  const source = `
use createCoterieFeedState from "./feed-pagination.ts"
use reduceCoterieFeedState from "./feed-pagination.ts"
use visibleFeedRows from "./feed-pagination.ts"
use listFeed from "./feed.query.ts"
use login from "./probe-provider.ts"
use createPost from "./probe-provider.ts"

component LiveMutationProbe
  state feedState = createCoterieFeedState()
  derive feedMode = feedState.feedTab
  derive visible = visibleFeedRows(feedState.liveHeadRows, feedState.accumulatedRows, [], feedState.patches)
  query feedHead = listFeed({ mode: feedMode, cursor: null })
  mutation loginMutation = login
  mutation createPostMutation = createPost
${routeActionSource('commitLiveHead')}
${routeActionSource('publishPost')}
${routeActionSource('signIn')}
${routeTaskSource('feedHeadDelivery')}
${routeTaskSource('feedHeadInitial')}

  view
    column
      button "Sign in" press=signIn testId="probe-sign-in"
      button "Publish" press=publishPost testId="probe-publish"
      text \`feed-count:\${visible.length}\` testId="probe-feed-count"
      each post in visible key=post.id
        text post.id testId=\`probe-feed-\${post.id}\`
`;
  const { file, diagnostics } = compileContractSource(
    source,
    'src/app/live-mutation-probe.contract',
    {
      importSemantics: {
        createCoterieFeedState: {
          kind: 'pure',
          params: [],
          result: 'unknown',
          depends: 'args',
        },
        reduceCoterieFeedState: {
          kind: 'pure',
          params: ['state', 'transition'],
          result: 'unknown',
          depends: 'args',
        },
        visibleFeedRows: {
          kind: 'pure',
          params: ['head', 'accumulated', 'currentPage', 'patches'],
          result: 'unknown',
          depends: 'args',
        },
        listFeed: { kind: 'query', reads: ['feedEvents'], readMode: 'sync' },
        login: { kind: 'mutation', effects: ['sessions.write'] },
        createPost: { kind: 'mutation', effects: ['posts.write'] },
      } as never,
    },
  );
  expect(diagnostics.filter((diagnostic) => diagnostic.severity === 'error')).toEqual([]);

  const links = createLinks(deliver);
  const success = () => ({ ok: true as const });
  const component = defineComponent(file, {
    createCoterieFeedState,
    reduceCoterieFeedState,
    visibleFeedRows,
    listFeed: () => queryHandle,
    login: links.login ?? success,
    createPost: links.createPost ?? success,
  });
  const handle = mount(component);
  return {
    handle,
    deliver,
    get subscribeCount() {
      return subscribeCount;
    },
  };
}

afterEach(() => {
  reset();
  delete (globalThis as { __exactHandleLinkHref?: unknown }).__exactHandleLinkHref;
});

describe('Coterie feed behavior', () => {
  it('A1 live overlays update accumulated rows without double counting', async () => {
    const { instance, dispose } = createFeedProbe([
      'commitLiveHead',
      'requestFirstOlderPage',
      'receiveOlderPage',
      'commitOlderPage',
      'likePost',
      'repostPost',
    ]);
    const head = Array.from({ length: 20 }, (_, index) =>
      feedRow(String(index + 1), { nextCursor: 'cursor-20' }),
    );
    const older = Array.from({ length: 4 }, (_, index) => feedRow(String(index + 21)));
    const target = older.at(-1)!;

    try {
      invokeAction(instance, 'commitLiveHead', 0, head);
      invokeAction(instance, 'requestFirstOlderPage', 0, 'cursor-20');
      invokeAction(instance, 'receiveOlderPage', 0, 'cursor-20', older, null);
      invokeAction(instance, 'commitOlderPage', 0, 'cursor-20');
      await invokeAction(instance, 'likePost', target.postId, false);
      await invokeAction(instance, 'repostPost', 'alice', target.postId, false);

      let state = stateOf(instance);
      let projected = visibleFeedRows(
        state.liveHeadRows,
        state.accumulatedRows,
        [],
        state.patches,
      );
      expect(projected.find((row) => row.id === target.id)).toMatchObject({
        likeCount: 1,
        likedByMe: true,
        repostCount: 1,
        repostedByMe: true,
      });

      invokeAction(instance, 'commitLiveHead', state.generation, head);
      state = stateOf(instance);
      projected = visibleFeedRows(
        state.liveHeadRows,
        state.accumulatedRows,
        [],
        state.patches,
      );
      expect(projected.find((row) => row.id === target.id)).toMatchObject({
        likeCount: 1,
        repostCount: 1,
      });
    } finally {
      dispose();
    }
  });

  it('A1 compose reset makes a successful created post visible after scrolling', async () => {
    const { instance, dispose } = createFeedProbe([
      'commitLiveHead',
      'requestFirstOlderPage',
      'receiveOlderPage',
      'commitOlderPage',
      'setComposeText',
      'publishPost',
    ]);
    const head = Array.from({ length: 20 }, (_, index) =>
      feedRow(String(index + 1), { nextCursor: 'cursor-20' }),
    );
    const older = [feedRow('21')];

    try {
      invokeAction(instance, 'commitLiveHead', 0, head);
      invokeAction(instance, 'requestFirstOlderPage', 0, 'cursor-20');
      invokeAction(instance, 'receiveOlderPage', 0, 'cursor-20', older, null);
      invokeAction(instance, 'commitOlderPage', 0, 'cursor-20');
      invokeAction(instance, 'setComposeText', 'new post');
      await invokeAction(instance, 'publishPost');

      let state = stateOf(instance);
      expect(state).toMatchObject({
        cursor: null,
        inFlightCursor: null,
        appendedCursor: null,
        accumulatedRows: [],
        liveHeadRows: head,
        composeText: '',
      });
      const created = feedRow('created');
      invokeAction(instance, 'commitLiveHead', state.generation, [created, ...head.slice(0, 19)]);
      state = stateOf(instance);
      expect(state.liveHeadRows[0]?.id).toBe('created');
    } finally {
      dispose();
    }
  });

  it('A1 empty current window retains accumulated rows', () => {
    const older = Array.from({ length: 8 }, (_, index) => feedRow(String(index + 21)));
    let state = createCoterieFeedState();
    state = reduceCoterieFeedState(state, {
      kind: 'request-older-page',
      generation: 0,
      requestedCursor: 'cursor-20',
    });
    state = reduceCoterieFeedState(state, {
      kind: 'older-page-delivered',
      generation: 0,
      requestedCursor: 'cursor-20',
      rows: older,
      nextCursor: 'cursor-40',
    });
    state = reduceCoterieFeedState(state, {
      kind: 'commit-older-page',
      generation: 0,
      requestedCursor: 'cursor-20',
    });
    state = reduceCoterieFeedState(state, {
      kind: 'older-page-delivered',
      generation: 0,
      requestedCursor: 'cursor-40',
      rows: [],
      nextCursor: null,
    });
    state = reduceCoterieFeedState(state, {
      kind: 'commit-older-page',
      generation: 0,
      requestedCursor: 'cursor-40',
    });

    expect(visibleFeedRows([], state.accumulatedRows, [], state.patches)).toEqual(older);
  });

  it('A1 duplicate page callback appends its requested cursor only once', () => {
    const { instance, dispose } = createFeedProbe([
      'requestFirstOlderPage',
      'receiveOlderPage',
      'commitOlderPage',
    ]);
    const page = [feedRow('21')];

    try {
      invokeAction(instance, 'requestFirstOlderPage', 0, 'cursor-20');
      invokeAction(instance, 'receiveOlderPage', 0, 'cursor-20', page, null);
      invokeAction(instance, 'commitOlderPage', 0, 'cursor-20');
      invokeAction(instance, 'receiveOlderPage', 0, 'cursor-20', page, null);
      invokeAction(instance, 'commitOlderPage', 0, 'cursor-20');
      const state = stateOf(instance);
      expect(state.accumulatedRows.map((row) => row.id)).toEqual(['21']);
      expect(state.appendedCursor).toBe('cursor-20');
      expect(state.inFlightCursor).toBeNull();
    } finally {
      dispose();
    }
  });

  it('A1 session success resets every caller-owned feed row and patch', async () => {
    const { instance, dispose } = createFeedProbe([
      'commitLiveHead',
      'requestFirstOlderPage',
      'receiveOlderPage',
      'commitOlderPage',
      'likePost',
      'signIn',
      'signOut',
    ]);
    const head = [feedRow('1', { nextCursor: 'cursor-20' })];
    const older = [feedRow('21')];

    try {
      invokeAction(instance, 'commitLiveHead', 0, head);
      invokeAction(instance, 'requestFirstOlderPage', 0, 'cursor-20');
      invokeAction(instance, 'receiveOlderPage', 0, 'cursor-20', older, null);
      invokeAction(instance, 'commitOlderPage', 0, 'cursor-20');
      await invokeAction(instance, 'likePost', older[0]!.postId, false);
      await invokeAction(instance, 'signIn');
      let state = stateOf(instance);
      expect(state).toMatchObject({
        cursor: null,
        inFlightCursor: null,
        accumulatedRows: [],
        liveHeadRows: [],
        liveHeadDeliverySequence: 1,
        patches: [],
        authError: '',
      });

      invokeAction(instance, 'commitLiveHead', state.generation, head);
      await invokeAction(instance, 'signOut');
      state = stateOf(instance);
      expect(state.accumulatedRows).toEqual([]);
      expect(state.liveHeadRows).toEqual([]);
      expect(state.liveHeadDeliverySequence).toBe(2);
      expect(state.patches).toEqual([]);
    } finally {
      dispose();
    }
  });

  it('T1 stale Following page resumed after Global switch leaves new tab untouched', () => {
    const { instance, dispose } = createFeedProbe([
      'chooseFeed',
      'commitLiveHead',
      'requestFirstOlderPage',
      'receiveOlderPage',
      'commitOlderPage',
    ]);
    const followingPage = [feedRow('following-21'), feedRow('following-22')];
    const globalHead = [feedRow('global-1'), feedRow('global-2')];

    try {
      invokeAction(instance, 'requestFirstOlderPage', 0, 'following-cursor-20');
      invokeAction(instance, 'chooseFeed', 'global');
      invokeAction(instance, 'commitLiveHead', 1, globalHead);
      invokeAction(
        instance,
        'receiveOlderPage',
        0,
        'following-cursor-20',
        followingPage,
        'following-cursor-40',
      );
      invokeAction(instance, 'commitOlderPage', 0, 'following-cursor-20');

      expect(stateOf(instance)).toMatchObject({
        feedTab: 'global',
        cursor: null,
        inFlightCursor: null,
        appendedCursor: null,
        accumulatedRows: [],
        liveHeadRows: globalHead,
      });
    } finally {
      dispose();
    }
  });

  it('T2 replayed previous-page callback cannot discard the real next page', () => {
    const { instance, dispose } = createFeedProbe([
      'requestFirstOlderPage',
      'receiveOlderPage',
      'commitOlderPage',
    ]);

    try {
      invokeAction(instance, 'requestFirstOlderPage', 0, 'cursor-20');
      invokeAction(instance, 'receiveOlderPage', 0, 'cursor-20', [feedRow('21')], 'cursor-40');
      invokeAction(instance, 'commitOlderPage', 0, 'cursor-20');
      invokeAction(instance, 'commitOlderPage', 0, 'cursor-20');
      expect(stateOf(instance)).toMatchObject({
        cursor: 'cursor-40',
        inFlightCursor: 'cursor-40',
        appendedCursor: 'cursor-20',
      });

      invokeAction(instance, 'receiveOlderPage', 0, 'cursor-40', [feedRow('41')], null);
      invokeAction(instance, 'commitOlderPage', 0, 'cursor-40');
      const state = stateOf(instance);
      expect(state.accumulatedRows.map((row) => row.id)).toEqual(['21', '41']);
      expect(state.appendedCursor).toBe('cursor-40');
      expect(state.inFlightCursor).toBeNull();
    } finally {
      dispose();
    }
  });

  it('T3 external live-head insertion retains row 20 after more than 20 rows', () => {
    const { instance, dispose } = createFeedProbe([
      'commitLiveHead',
      'requestFirstOlderPage',
      'receiveOlderPage',
      'commitOlderPage',
    ]);
    const deliveredHead = Array.from({ length: 20 }, (_, index) =>
      feedRow(String(index + 1), { nextCursor: 'cursor-20' }),
    );
    const older = Array.from({ length: 4 }, (_, index) => feedRow(String(index + 21)));
    const externalRepost = feedRow('external-repost');

    try {
      invokeAction(instance, 'commitLiveHead', 0, deliveredHead);
      invokeAction(instance, 'requestFirstOlderPage', 0, 'cursor-20');
      invokeAction(instance, 'receiveOlderPage', 0, 'cursor-20', older, null);
      invokeAction(instance, 'commitOlderPage', 0, 'cursor-20');
      invokeAction(instance, 'commitLiveHead', 0, [externalRepost, ...deliveredHead.slice(0, 19)]);
      const state = stateOf(instance);

      expect(visibleFeedRows(
        state.liveHeadRows,
        state.accumulatedRows,
        [],
        state.patches,
      ).map((row) => row.id)).toEqual([
        'external-repost',
        ...Array.from({ length: 24 }, (_, index) => String(index + 1)),
      ]);
    } finally {
      dispose();
    }
  });

  it('T3 production query delivery adopts a synchronous head without resubscribe churn', async () => {
    let rows: readonly FeedItem[] = Array.from({ length: 20 }, (_, index) =>
      feedRow(String(index + 1)),
    );
    let notify: ((nextRows: readonly FeedItem[]) => void) | null = null;
    let subscribeCount = 0;
    const queryHandle: ContractQueryHandle<FeedItem> = {
      __exactContractQuery: true,
      table: 'feedEvents',
      key: 'feed:following:head',
      read: () => rows,
      subscribe(next) {
        subscribeCount += 1;
        notify = next;
        next(rows);
        return {
          get current() {
            return rows;
          },
          dispose() {
            if (notify === next) notify = null;
          },
        };
      },
    };
    const source = `
use createCoterieFeedState from "./feed-pagination.ts"
use reduceCoterieFeedState from "./feed-pagination.ts"
use visibleFeedRows from "./feed-pagination.ts"
use listFeed from "./feed.query.ts"

component FeedDeliveryProbe
  state feedState = createCoterieFeedState()
  derive feedMode = feedState.feedTab
  derive visible = visibleFeedRows(feedState.liveHeadRows, feedState.accumulatedRows, [], feedState.patches)
  query feedHead = listFeed({ mode: feedMode, cursor: null })
${routeActionSource('commitLiveHead')}
${routeTaskSource('feedHeadDelivery')}
${routeTaskSource('feedHeadInitial')}

  view
    text \`\${visible.length}\`
`;
    const { file, diagnostics } = compileContractSource(
      source,
      'src/app/feed-delivery-probe.contract',
      {
        importSemantics: {
          createCoterieFeedState: {
            kind: 'pure',
            params: [],
            result: 'unknown',
            depends: 'args',
          },
          reduceCoterieFeedState: {
            kind: 'pure',
            params: ['state', 'transition'],
            result: 'unknown',
            depends: 'args',
          },
          visibleFeedRows: {
            kind: 'pure',
            params: ['head', 'accumulated', 'currentPage', 'patches'],
            result: 'unknown',
            depends: 'args',
          },
          listFeed: { kind: 'query', reads: ['feedEvents'], readMode: 'sync' },
        } as never,
      },
    );
    expect(diagnostics.filter((diagnostic) => diagnostic.severity === 'error')).toEqual([]);
    const component = defineComponent(file, {
      createCoterieFeedState,
      reduceCoterieFeedState,
      visibleFeedRows,
      listFeed: () => queryHandle,
    });
    const handle = mount(component);

    try {
      await Promise.resolve();
      expect(collectTexts(handle.container)).toContain('20');
      expect(subscribeCount).toBe(1);

      rows = [feedRow('external-repost'), ...rows.slice(0, 19)];
      notify!(rows);
      await Promise.resolve();
      expect(collectTexts(handle.container)).toContain('21');
      expect(subscribeCount).toBe(1);
    } finally {
      handle.dispose();
    }
  });

  it('T4 older failed sign-in cannot overwrite a newer successful sign-in', async () => {
    const settlements: Array<(result: MutationResult) => void> = [];
    const login = () => new Promise<MutationResult>((resolve) => settlements.push(resolve));
    const { instance, dispose } = createFeedProbe(['signIn'], { login });

    try {
      const older = invokeAction(instance, 'signIn') as Promise<unknown>;
      const newer = invokeAction(instance, 'signIn') as Promise<unknown>;
      settlements[1]!({ ok: true });
      await newer;
      settlements[0]!({ ok: false, error: { message: 'stale failure' } });
      await older;

      expect(stateOf(instance)).toMatchObject({ generation: 1, authError: '' });
    } finally {
      dispose();
    }
  });

  it('successful sign-in keeps the session-scoped head delivered before settlement', async () => {
    const beforeSession = [feedRow('following-before-session')];
    const sessionHead = [feedRow('following-after-session')];
    const probe = createLiveMutationProbe(beforeSession, (deliver) => ({
      login: async () => {
        deliver(sessionHead);
        return { ok: true };
      },
    }));

    try {
      await settleAsyncWork();
      expect(findByTestId(probe.handle.container, 'probe-feed-following-before-session')).not.toBeNull();
      const signIn = findByTestId(probe.handle.container, 'probe-sign-in');
      expect(signIn).not.toBeNull();
      ((signIn!.originalProps as Record<string, unknown>).onPress as () => void)();
      await settleAsyncWork();

      expect(findByTestId(probe.handle.container, 'probe-feed-following-after-session')).not.toBeNull();
      expect(collectTexts(probe.handle.container)).toContain('feed-count:1');
      expect(probe.subscribeCount).toBe(1);
    } finally {
      probe.handle.dispose();
    }
  });

  it('successful sign-in blanks the predecessor head until a successor delivery replaces it', async () => {
    const predecessorHead = [feedRow('viewer-a-private-head')];
    const successorHead = [feedRow('viewer-b-session-head')];
    const probe = createLiveMutationProbe(predecessorHead, () => ({
      login: async () => ({ ok: true }),
    }));

    try {
      await settleAsyncWork();
      expect(findByTestId(probe.handle.container, 'probe-feed-viewer-a-private-head')).not.toBeNull();
      const signIn = findByTestId(probe.handle.container, 'probe-sign-in');
      expect(signIn).not.toBeNull();
      ((signIn!.originalProps as Record<string, unknown>).onPress as () => void)();
      await settleAsyncWork();

      expect(findByTestId(probe.handle.container, 'probe-feed-viewer-a-private-head')).toBeNull();
      expect(collectTexts(probe.handle.container)).toContain('feed-count:0');
      expect(probe.subscribeCount).toBe(1);

      probe.deliver(successorHead);
      await settleAsyncWork();
      expect(findByTestId(probe.handle.container, 'probe-feed-viewer-b-session-head')).not.toBeNull();
      expect(findByTestId(probe.handle.container, 'probe-feed-viewer-a-private-head')).toBeNull();
      expect(collectTexts(probe.handle.container)).toContain('feed-count:1');
      expect(probe.subscribeCount).toBe(1);
    } finally {
      probe.handle.dispose();
    }
  });

  it('successful publish keeps the new head delivered before settlement', async () => {
    const previousHead = [feedRow('previous')];
    const publishedHead = [feedRow('new-post'), ...previousHead];
    const probe = createLiveMutationProbe(previousHead, (deliver) => ({
      createPost: async () => {
        deliver(publishedHead);
        return { ok: true };
      },
    }));

    try {
      await settleAsyncWork();
      const publish = findByTestId(probe.handle.container, 'probe-publish');
      expect(publish).not.toBeNull();
      ((publish!.originalProps as Record<string, unknown>).onPress as () => void)();
      await settleAsyncWork();

      expect(findByTestId(probe.handle.container, 'probe-feed-new-post')).not.toBeNull();
      expect(collectTexts(probe.handle.container)).toContain('feed-count:2');
      expect(probe.subscribeCount).toBe(1);
    } finally {
      probe.handle.dispose();
    }
  });

  it('retains the complete local-repost sequence through the next live delivery', async () => {
    const { instance, dispose } = createFeedProbe([
      'commitLiveHead',
      'requestFirstOlderPage',
      'receiveOlderPage',
      'commitOlderPage',
      'repostPost',
    ]);
    const deliveredHead = Array.from({ length: 20 }, (_, index) =>
      feedRow(String(index + 1), { nextCursor: 'cursor-20' }),
    );
    const older = Array.from({ length: 4 }, (_, index) => feedRow(String(index + 21)));
    const target = older.at(-1)!;
    const repost = feedRow('repost', {
      postId: target.postId,
      repostedById: 'alice',
      repostedByName: 'Alice Adams',
      repostedByHandle: 'alice',
      repostedByMe: true,
    });

    try {
      invokeAction(instance, 'commitLiveHead', 0, deliveredHead);
      invokeAction(instance, 'requestFirstOlderPage', 0, 'cursor-20');
      invokeAction(instance, 'receiveOlderPage', 0, 'cursor-20', older, null);
      invokeAction(instance, 'commitOlderPage', 0, 'cursor-20');
      await invokeAction(instance, 'repostPost', 'alice', target.postId, false);
      invokeAction(instance, 'commitLiveHead', 0, [repost, ...deliveredHead.slice(0, 19)]);
      const state = stateOf(instance);

      expect(visibleFeedRows(
        state.liveHeadRows,
        state.accumulatedRows,
        [],
        state.patches,
      ).map((row) => row.id)).toEqual([
        'repost',
        ...Array.from({ length: 24 }, (_, index) => String(index + 1)),
      ]);
    } finally {
      dispose();
    }
  });

  it('routes every index state assignment and async settlement through the reducer', () => {
    expect(routeSource.match(/^  state /gm)).toEqual(['  state ']);
    const assignments = [...routeSource.matchAll(/^    feedState = (.+)$/gm)].map((match) => match[1]);
    expect(assignments.length).toBeGreaterThan(0);
    expect(assignments.every((assignment) => assignment.startsWith('reduceCoterieFeedState('))).toBe(true);

    for (const actionName of ['publishPost', 'likePost', 'repostPost', 'signIn', 'signOut']) {
      const action = routeActionSource(actionName);
      const continuation = action.slice(action.indexOf('await '));
      expect(continuation).toContain('reduceCoterieFeedState(');
    }
    expect(routeActionSource('signIn').match(/kind: "sign-in-settled"/g)).toHaveLength(2);
  });

  it('keeps cursor helpers stable for generated row envelopes', () => {
    const head = [feedRow('1', { nextCursor: 'cursor-20' })];
    expect(feedNextCursor(head)).toBe('cursor-20');
    expect(feedNextCursor([])).toBeNull();
  });

  it('linkifies only HTTP(S) segments and drives the rendered sm-* link interaction', () => {
    expect(linkifyPostBody('See https://example.com/path, then ftp://example.com.')).toEqual([
      { id: 'text-0', text: 'See ', href: null, testId: null },
      {
        id: 'link-0',
        text: 'https://example.com/path',
        href: 'https://example.com/path',
        testId: 'sm-post-link-0',
      },
      { id: 'text-28', text: ',', href: null, testId: null },
      { id: 'text-29', text: ' then ftp://example.com.', href: null, testId: null },
    ]);

    const source = readFileSync(new URL('../src/ui/feed-body.contract', import.meta.url), 'utf8');
    const { file, diagnostics } = compileContractSource(source, 'src/ui/feed-body.contract', {
      importSemantics: {
        linkifyPostBody: {
          kind: 'pure',
          params: ['body'],
          result: 'unknown',
          depends: 'args',
        },
      } as never,
    });
    expect(diagnostics.filter((diagnostic) => diagnostic.severity === 'error')).toEqual([]);
    const component = defineComponent(file, { linkifyPostBody });
    const handle = mount(component, { props: { body: 'Open https://example.com/coterie now' } });
    const link = findByTestId(handle.container as RootNode, 'sm-post-link-0');
    expect(link).not.toBeNull();
    const opened: string[] = [];
    (globalThis as { __exactHandleLinkHref?: (href: string) => void }).__exactHandleLinkHref =
      (href) => opened.push(href);
    const onPress = (link!.originalProps as Record<string, unknown>).onPress;
    expect(typeof onPress).toBe('function');
    (onPress as () => void)();
    expect(opened).toEqual(['https://example.com/coterie']);
  });
});
