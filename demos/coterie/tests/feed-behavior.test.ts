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
  createCoterieChatState,
  reduceCoterieChatState,
} from '../src/data/chat-state.ts';
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
  createPost?: (args?: Record<string, unknown>) => Promise<MutationResult> | MutationResult;
  setLike?: () => Promise<MutationResult> | MutationResult;
  setRepost?: () => Promise<MutationResult> | MutationResult;
};
type ChatMutationResult =
  | { ok: true; value?: Record<string, unknown> }
  | { ok: false; error: { message: string } };
type ChatProbeLinks = {
  navigate?: (target: unknown) => unknown;
  openDm?: (args: Record<string, unknown>) => Promise<ChatMutationResult> | ChatMutationResult;
  createGroup?: (args: Record<string, unknown>) => Promise<ChatMutationResult> | ChatMutationResult;
  sendMessage?: (args: Record<string, unknown>) => Promise<ChatMutationResult> | ChatMutationResult;
  setTyping?: (args: Record<string, unknown>) => Promise<ChatMutationResult> | ChatMutationResult;
};
type DeferredTypingCall = {
  args: Record<string, unknown>;
  settled: boolean;
  settle: () => Promise<void>;
};

const routeSource = readFileSync(
  new URL('../src/app/routes/index.contract', import.meta.url),
  'utf8',
);
const composerSource = readFileSync(
  new URL('../src/ui/composer.contract', import.meta.url),
  'utf8',
);
const messageBubbleSource = readFileSync(
  new URL('../src/ui/message-bubble.contract', import.meta.url),
  'utf8',
);
const conversationRouteSource = readFileSync(
  new URL('../src/app/routes/chat/[id].contract', import.meta.url),
  'utf8',
);
const chatsRouteSource = readFileSync(
  new URL('../src/app/routes/chats.contract', import.meta.url),
  'utf8',
);
const chatStateMetaSource = readFileSync(
  new URL('../src/data/chat-state.contract-meta.ts', import.meta.url),
  'utf8',
);
const choreographySource = readFileSync(
  new URL(
    '../../../benchmarks/tools/social-messenger/choreography/choreography.mjs',
    import.meta.url,
  ),
  'utf8',
);
const profileCardSource = readFileSync(
  new URL('../src/ui/profile-card.contract', import.meta.url),
  'utf8',
);

function indentedBlock(source: string, marker: string): string {
  const lines = source.split('\n');
  const start = lines.findIndex((line) => line.includes(marker));
  if (start < 0) throw new Error(`missing source marker ${marker}`);
  const indentation = lines[start]!.match(/^\s*/u)?.[0].length ?? 0;
  let end = start + 1;
  while (end < lines.length) {
    const line = lines[end]!;
    if (line.trim() && (line.match(/^\s*/u)?.[0].length ?? 0) <= indentation) break;
    end += 1;
  }
  return lines.slice(start, end).join('\n');
}

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

function contractActionSource(source: string, actionName: string): string {
  const action = source.match(
    new RegExp(String.raw`\n  action ${actionName}[\s\S]*?(?=\n  action |\n  task |\n  contract)`),
  )?.[0];
  if (!action) throw new Error(`missing route action ${actionName}`);
  return action.trimEnd();
}

function routeActionSource(actionName: string): string {
  return contractActionSource(routeSource, actionName);
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

function createChatProbe(
  source: string,
  actionNames: readonly string[],
  links: ChatProbeLinks = {},
) {
  const probeActionNames = source.includes('\n  action publishTypingIntent') &&
    !actionNames.includes('publishTypingIntent')
    ? ['publishTypingIntent', ...actionNames]
    : actionNames;
  const probeSource = `
use navigate from "@exact/router/contract"
use createCoterieChatState from "./chat-state.ts"
use reduceCoterieChatState from "./chat-state.ts"
use openDm from "./probe-provider.ts"
use createGroup from "./probe-provider.ts"
use sendMessage from "./probe-provider.ts"
use setTyping from "./probe-provider.ts"

component ChatStateProbe
  state chatState = createCoterieChatState()
  derive chatId = "g-starter"
  derive canSetTyping = true
  mutation openDmMutation = openDm
  mutation createGroupMutation = createGroup
  mutation sendMessageMutation = sendMessage
  mutation setTypingMutation = setTyping
${probeActionNames.map((name) => contractActionSource(source, name)).join('\n')}

  view
    text chatState.messageText
`;
  const { file, diagnostics } = compileContractSource(
    probeSource,
    'src/app/chat-state-probe.contract',
    {
      importSemantics: {
        navigate: {
          kind: 'capability',
          params: ['target'],
          effects: ['navigation.location.write'],
        },
        createCoterieChatState: {
          kind: 'pure',
          params: ['viewerId'],
          result: 'unknown',
          depends: 'args',
        },
        reduceCoterieChatState: {
          kind: 'pure',
          params: ['state', 'transition'],
          result: 'unknown',
          depends: 'args',
        },
        openDm: { kind: 'mutation', effects: ['chats.write'] },
        createGroup: { kind: 'mutation', effects: ['chats.write'] },
        sendMessage: { kind: 'mutation', effects: ['messages.write'] },
        setTyping: { kind: 'mutation', effects: ['ephemeralTyping.write'] },
      } as never,
    },
  );
  expect(diagnostics.filter((diagnostic) => diagnostic.severity === 'error')).toEqual([]);

  const success = () => ({ ok: true as const });
  const component = defineComponent(file, {
    navigate: links.navigate ?? (() => undefined),
    createCoterieChatState,
    reduceCoterieChatState,
    openDm: links.openDm ?? success,
    createGroup: links.createGroup ?? success,
    sendMessage: links.sendMessage ?? success,
    setTyping: links.setTyping ?? success,
  });
  const owner = createOwner();
  const instance = instantiateComponent(
    component,
    {},
    createRuntimeContext(owner, { rootId: 8002 }),
  );
  return { instance, dispose: () => owner.dispose() };
}

function chatStateOf(instance: ComponentInstance) {
  return readState<ReturnType<typeof createCoterieChatState>>(instance, 'chatState');
}

function createDeferredTypingProvider() {
  const calls: DeferredTypingCall[] = [];
  let active = false;
  const setTyping = (args: Record<string, unknown>) => new Promise<ChatMutationResult>((resolve) => {
    const call: DeferredTypingCall = {
      args,
      settled: false,
      settle: async () => {
        if (call.settled) throw new Error('typing call already settled');
        call.settled = true;
        active = args.active === true;
        resolve({ ok: true });
        for (let turn = 0; turn < 4; turn += 1) await Promise.resolve();
      },
    };
    calls.push(call);
  });
  return {
    calls,
    setTyping,
    active: () => active,
  };
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

  it('composer media state caps images at four and keeps video mutually exclusive', () => {
    let state = createCoterieFeedState();
    const toggle = (mediaRef: string, mediaKind: 'image' | 'video') => {
      state = reduceCoterieFeedState(state, {
        kind: 'toggle-compose-media',
        generation: state.generation,
        mediaRef,
        mediaKind,
      });
    };

    for (let index = 1; index <= 5; index += 1) {
      toggle(`media/img-${String(index).padStart(2, '0')}.png`, 'image');
    }
    expect(state.composeImageRefs).toEqual([
      'media/img-01.png',
      'media/img-02.png',
      'media/img-03.png',
      'media/img-04.png',
    ]);
    expect(state.composeVideoRefs).toEqual([]);

    state = reduceCoterieFeedState(state, {
      kind: 'remove-compose-media',
      generation: state.generation,
      mediaRef: 'media/img-02.png',
      mediaKind: 'image',
    });
    toggle('media/img-05.png', 'image');
    expect(state.composeImageRefs).toEqual([
      'media/img-01.png',
      'media/img-03.png',
      'media/img-04.png',
      'media/img-05.png',
    ]);

    toggle('media/vid-01.mp4', 'video');
    expect(state.composeImageRefs).toEqual([]);
    expect(state.composeVideoRefs).toEqual(['media/vid-01.mp4']);

    toggle('media/img-06.png', 'image');
    expect(state.composeImageRefs).toEqual(['media/img-06.png']);
    expect(state.composeVideoRefs).toEqual([]);

    state = reduceCoterieFeedState(state, {
      kind: 'publish-began',
      generation: state.generation,
    });
    expect(state).toMatchObject({ composeImageRefs: [], composeVideoRefs: [] });
  });

  it('forwards reducer-selected media refs through the feed createPost mutation', async () => {
    let captured: Record<string, unknown> | undefined;
    const { instance, dispose } = createFeedProbe(
      ['toggleComposeMedia', 'publishPost'],
      {
        createPost: (args) => {
          captured = args;
          return { ok: true };
        },
      },
    );
    try {
      invokeAction(instance, 'toggleComposeMedia', 'media/img-01.png', 'image');
      invokeAction(instance, 'toggleComposeMedia', 'media/img-02.png', 'image');
      await invokeAction(instance, 'publishPost');
      expect(captured).toEqual({
        body: '',
        imageRefs: ['media/img-01.png', 'media/img-02.png'],
        videoRefs: [],
        parentId: null,
      });
    } finally {
      dispose();
    }
  });

  it('gates every feed mutation affordance on claims without provider identity', () => {
    expect(routeSource).toContain('use listProviderClaims from "../../data/generated/coterie.bindings.ts"');
    expect(routeSource).toContain(
      'derive canCreatePost = providerClaims.ready && providerClaims.value.some((claim) => claim.name == "createPost")',
    );
    expect(routeSource).toContain('when canCreatePost');
    expect(routeSource).toContain('canAttach=true');
    expect(routeSource).toContain('canLike=canLikePosts');
    expect(routeSource).toContain('canRepost=canRepostPosts');
    expect(routeSource).not.toContain('COTERIE_PROVIDER');
    expect(composerSource).toContain('derive supportsMedia = variant == "post" && canAttach');
    expect(composerSource).toContain(
      'when supportsMedia then has node testId="sm-compose-attach"',
    );
    expect(composerSource).not.toMatch(/sm-convo-(file|attach|media)/);
  });

  it('keeps frozen message actions, reaction choices, chips, and text inside each bubble', () => {
    const bubbleBlock = indentedBlock(messageBubbleSource, 'nativeId=`sm-message-${id}`');
    expect(bubbleBlock).toContain('text body');
    expect(bubbleBlock.match(/testId="sm-convo-quote"/gu)).toHaveLength(1);
    expect(bubbleBlock).toContain('testId="sm-convo-quote-preview"');
    expect(bubbleBlock).toContain('press=revealQuoteSource(quotedMessageId)');
    expect(bubbleBlock).toContain('when canQuote');
    expect(bubbleBlock).not.toContain('when canQuote && !quotedMessageId');
    expect(bubbleBlock).toContain('testId="sm-convo-react"');
    expect(bubbleBlock).toContain('testId="sm-convo-reaction"');
    expect(bubbleBlock).toContain('testId="sm-convo-reaction-chip"');
    expect(bubbleBlock).toContain('href=`#sm-message-${quotedMessageId}`');
    expect(conversationRouteSource).toContain('state chatState = createCoterieChatState()');
    expect(conversationRouteSource).toContain(
      'action revealQuotedMessage(messageId) writes chatState',
    );
    expect(conversationRouteSource).toContain(
      'highlighted=chatState.highlightedMessageId == message.id',
    );
    expect(choreographySource).toContain(
      'const quotePreview = testId(aliceReply, "sm-convo-quote-preview");',
    );
    expect(choreographySource).toContain(
      '(await quotePreview.count()) > 0 ? "sm-convo-quote-preview" : "sm-convo-quote";',
    );
    expect(choreographySource).toContain(
      'await testId(aliceReply, quoteJumpSelector).click();',
    );
    expect(choreographySource).toContain(
      'return { note: `quoted-excerpt jump selector: ${quoteJumpSelector}` };',
    );
    expect(choreographySource).toContain(
      'if (!inViewport) throw new Error("quoted-excerpt activation did not jump to the original")',
    );
  });

  it('renders avatar choices with a visual and semantic current state', () => {
    expect(profileCardSource).toContain('accessibilitySelected=option.value == currentAvatarRef');
    expect(profileCardSource).toContain('image src=option.url');
    expect(profileCardSource).toContain('option.value == currentAvatarRef ? `${option.label} · Current`');
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

  it('generation-gates conversation and group-draft async settlements', () => {
    let conversation = createCoterieChatState('alice');
    conversation = reduceCoterieChatState(conversation, {
      kind: 'set-message-text',
      generation: 0,
      value: 'first draft',
    });
    conversation = reduceCoterieChatState(conversation, { kind: 'send-began', generation: 1 });
    expect(conversation.generation).toBe(2);
    expect(conversation.messageText).toBe('');

    const successor = reduceCoterieChatState(conversation, {
      kind: 'set-message-text',
      generation: 2,
      value: 'successor draft',
    });
    expect(reduceCoterieChatState(successor, {
      kind: 'send-settled',
      generation: 2,
      ok: true,
      messageText: 'first draft',
      quotedMessageId: null,
      quotedSenderName: null,
      quotedBodySnippet: null,
    })).toEqual(successor);

    let group = reduceCoterieChatState(createCoterieChatState('alice'), {
      kind: 'toggle-group-member',
      generation: 0,
      userId: 'bob',
    });
    group = reduceCoterieChatState(group, {
      kind: 'set-group-name',
      generation: 1,
      value: 'Launch crew',
    });
    group = reduceCoterieChatState(group, {
      kind: 'group-create-began',
      generation: 2,
      creatorId: 'alice',
    });
    expect(group).toMatchObject({
      generation: 3,
      groupName: '',
      selectedMemberIds: ['alice'],
    });
  });

  it('does not navigate for a late direct-message completion after a newer intent', async () => {
    const settlements: Array<(result: ChatMutationResult) => void> = [];
    const navigations: unknown[] = [];
    const { instance, dispose } = createChatProbe(
      chatsRouteSource,
      ['openDirectMessage'],
      {
        openDm: () => new Promise((resolve) => settlements.push(resolve)),
        navigate: (target) => navigations.push(target),
      },
    );

    try {
      const older = invokeAction(instance, 'openDirectMessage', 'bob') as Promise<unknown>;
      const newer = invokeAction(instance, 'openDirectMessage', 'carol') as Promise<unknown>;
      settlements[1]!({ ok: true, value: { chatId: 'd-alice-carol' } });
      await newer;
      settlements[0]!({ ok: true, value: { chatId: 'd-alice-bob' } });
      await older;
      expect(navigations).toEqual([
        { to: '/chat/[id]', params: { id: 'd-alice-carol' } },
      ]);
    } finally {
      dispose();
    }
  });

  it('does not clear a successor draft or typing intent after an older send completes', async () => {
    let settleSend: ((result: ChatMutationResult) => void) | null = null;
    const typingIntents: Array<Record<string, unknown>> = [];
    const { instance, dispose } = createChatProbe(
      conversationRouteSource,
      ['setMessageText', 'sendCurrentMessage'],
      {
        sendMessage: () => new Promise((resolve) => { settleSend = resolve; }),
        setTyping: (args) => {
          typingIntents.push(args);
          return { ok: true };
        },
      },
    );

    try {
      await invokeAction(instance, 'setMessageText', 'older draft');
      const olderSend = invokeAction(instance, 'sendCurrentMessage') as Promise<unknown>;
      await invokeAction(instance, 'setMessageText', 'successor draft');
      settleSend!({ ok: true, value: { id: 'm-new' } });
      await olderSend;

      expect(chatStateOf(instance).messageText).toBe('successor draft');
      expect(typingIntents).toEqual([
        { chatId: 'g-starter', active: true },
        { chatId: 'g-starter', active: true },
      ]);
    } finally {
      dispose();
    }
  });

  it('reconciles an older typing publish that completes after a newer clear', async () => {
    const typing = createDeferredTypingProvider();
    const { instance, dispose } = createChatProbe(
      conversationRouteSource,
      ['setMessageText'],
      { setTyping: typing.setTyping },
    );

    try {
      invokeAction(instance, 'setMessageText', 'typing');
      invokeAction(instance, 'setMessageText', '');
      expect(typing.calls.map((call) => call.args)).toEqual([
        { chatId: 'g-starter', active: true },
        { chatId: 'g-starter', active: false },
      ]);

      await typing.calls[1]!.settle();
      expect(chatStateOf(instance)).toMatchObject({
        typingIntentSequence: 2,
        typingIntentActive: false,
        typingSettledSequence: 2,
        typingSettledActive: false,
      });
      expect(typing.active()).toBe(false);

      await typing.calls[0]!.settle();
      expect(chatStateOf(instance)).toMatchObject({
        typingIntentSequence: 2,
        typingIntentActive: false,
        typingSettledSequence: 2,
        typingSettledActive: false,
      });
      expect(typing.calls[2]!.args).toEqual({ chatId: 'g-starter', active: false });
      await typing.calls[2]!.settle();
      expect(typing.active()).toBe(false);
    } finally {
      dispose();
    }
  });

  it('reconciles a late send-time clear to a successor draft typing intent', async () => {
    const typing = createDeferredTypingProvider();
    let settleSend: ((result: ChatMutationResult) => void) | null = null;
    const { instance, dispose } = createChatProbe(
      conversationRouteSource,
      ['setMessageText', 'sendCurrentMessage'],
      {
        sendMessage: () => new Promise((resolve) => { settleSend = resolve; }),
        setTyping: typing.setTyping,
      },
    );

    try {
      invokeAction(instance, 'setMessageText', 'older draft');
      await typing.calls[0]!.settle();

      const send = invokeAction(instance, 'sendCurrentMessage') as Promise<unknown>;
      settleSend!({ ok: true, value: { id: 'm-new' } });
      for (let turn = 0; turn < 4; turn += 1) await Promise.resolve();
      expect(typing.calls[1]!.args).toEqual({ chatId: 'g-starter', active: false });

      invokeAction(instance, 'setMessageText', 'successor draft');
      expect(typing.calls[2]!.args).toEqual({ chatId: 'g-starter', active: true });
      await typing.calls[2]!.settle();
      expect(typing.active()).toBe(true);

      await typing.calls[1]!.settle();
      expect(chatStateOf(instance)).toMatchObject({
        messageText: 'successor draft',
        typingIntentSequence: 3,
        typingIntentActive: true,
        typingSettledSequence: 3,
        typingSettledActive: true,
      });
      expect(typing.calls[3]!.args).toEqual({ chatId: 'g-starter', active: true });
      await typing.calls[3]!.settle();
      await send;
      expect(typing.active()).toBe(true);
    } finally {
      dispose();
    }
  });

  it('settles rapid typing toggles to the latest reducer-issued intent', async () => {
    const typing = createDeferredTypingProvider();
    const { instance, dispose } = createChatProbe(
      conversationRouteSource,
      ['setMessageText'],
      { setTyping: typing.setTyping },
    );

    try {
      invokeAction(instance, 'setMessageText', 'one');
      invokeAction(instance, 'setMessageText', '');
      invokeAction(instance, 'setMessageText', 'three');
      expect(typing.calls.map((call) => call.args.active)).toEqual([true, false, true]);

      await typing.calls[1]!.settle();
      await typing.calls[0]!.settle();
      await typing.calls[2]!.settle();
      while (typing.calls.some((call) => !call.settled)) {
        await typing.calls.find((call) => !call.settled)!.settle();
      }

      expect(typing.calls.slice(3).every((call) => call.args.active === true)).toBe(true);
      expect(typing.active()).toBe(true);
      expect(chatStateOf(instance)).toMatchObject({
        messageText: 'three',
        typingIntentSequence: 3,
        typingIntentActive: true,
        typingSettledSequence: 3,
        typingSettledActive: true,
      });
    } finally {
      dispose();
    }
  });

  it('does not navigate for a late group completion after a successor draft begins', async () => {
    let settleGroup: ((result: ChatMutationResult) => void) | null = null;
    const navigations: unknown[] = [];
    const { instance, dispose } = createChatProbe(
      chatsRouteSource,
      ['seedGroupCreator', 'setGroupName', 'toggleGroupMember', 'submitGroup'],
      {
        createGroup: () => new Promise((resolve) => { settleGroup = resolve; }),
        navigate: (target) => navigations.push(target),
      },
    );

    try {
      invokeAction(instance, 'seedGroupCreator', 'bob');
      invokeAction(instance, 'toggleGroupMember', 'alice');
      invokeAction(instance, 'setGroupName', 'Older group');
      const olderCreate = invokeAction(instance, 'submitGroup', 'bob') as Promise<unknown>;
      invokeAction(instance, 'setGroupName', 'Successor group');
      settleGroup!({ ok: true, value: { chatId: 'g-older' } });
      await olderCreate;

      expect(chatStateOf(instance).groupName).toBe('Successor group');
      expect(navigations).toEqual([]);
    } finally {
      dispose();
    }
  });

  it('restores failed message and group drafts without reviving them over successors', async () => {
    let settleSend: ((result: ChatMutationResult) => void) | null = null;
    const conversation = createChatProbe(
      conversationRouteSource,
      ['setMessageText', 'beginReply', 'sendCurrentMessage'],
      { sendMessage: () => new Promise((resolve) => { settleSend = resolve; }) },
    );
    let settleGroup: ((result: ChatMutationResult) => void) | null = null;
    const group = createChatProbe(
      chatsRouteSource,
      ['seedGroupCreator', 'setGroupName', 'setGroupDescription', 'toggleGroupMember', 'submitGroup'],
      { createGroup: () => new Promise((resolve) => { settleGroup = resolve; }) },
    );

    try {
      await invokeAction(conversation.instance, 'setMessageText', 'restore me');
      invokeAction(conversation.instance, 'beginReply', 'sm0001', 'Alice', 'Original body');
      const failedSend = invokeAction(
        conversation.instance,
        'sendCurrentMessage',
      ) as Promise<unknown>;
      settleSend!({ ok: false, error: { message: 'offline' } });
      await failedSend;
      expect(chatStateOf(conversation.instance)).toMatchObject({
        messageText: 'restore me',
        quotedMessageId: 'sm0001',
        quotedSenderName: 'Alice',
        quotedBodySnippet: 'Original body',
      });

      invokeAction(group.instance, 'seedGroupCreator', 'bob');
      invokeAction(group.instance, 'toggleGroupMember', 'alice');
      invokeAction(group.instance, 'setGroupName', 'Bob crew');
      invokeAction(group.instance, 'setGroupDescription', 'Created by Bob');
      const failedGroup = invokeAction(group.instance, 'submitGroup', 'bob') as Promise<unknown>;
      settleGroup!({ ok: false, error: { message: 'offline' } });
      await failedGroup;
      expect(chatStateOf(group.instance)).toMatchObject({
        groupName: 'Bob crew',
        groupDescription: 'Created by Bob',
        selectedMemberIds: ['bob', 'alice'],
      });
    } finally {
      conversation.dispose();
      group.dispose();
    }
  });

  it('routes all chat and group local-state assignments through the chat reducer', () => {
    for (const source of [conversationRouteSource, chatsRouteSource]) {
      const assignments = [...source.matchAll(/^    chatState = (.+)$/gm)].map((match) => match[1]);
      expect(assignments.length).toBeGreaterThan(0);
      expect(assignments.every((assignment) => assignment.startsWith('reduceCoterieChatState(')))
        .toBe(true);
    }
    for (const actionName of ['chooseMessageReaction', 'sendCurrentMessage']) {
      const action = indentedBlock(conversationRouteSource, `action ${actionName}`);
      expect(action.slice(action.indexOf('await '))).toContain('reduceCoterieChatState(');
    }
    const groupCreate = indentedBlock(chatsRouteSource, 'action submitGroup');
    expect(groupCreate.slice(groupCreate.indexOf('await '))).toContain('reduceCoterieChatState(');
    expect(createCoterieChatState().selectedMemberIds).toEqual([]);
    expect(createCoterieChatState('bob').selectedMemberIds).toEqual(['bob']);
    expect(chatsRouteSource).toContain('seedGroupCreator(session.value[0].userId)');
    expect(groupCreate).toContain(
      'draftMemberIds.includes(viewerId) ? draftMemberIds : [...draftMemberIds, viewerId]',
    );
    expect(chatsRouteSource).toContain('press=submitGroup(activeSessions[0].userId)');
    expect(chatsRouteSource).toContain(
      'accessibilitySelected=profile.isMe || chatState.selectedMemberIds.includes(profile.id)',
    );
  });

  it('keeps inactive-member history rendering separate from live compose and typing state', () => {
    expect(conversationRouteSource).toContain('async messages');
    expect(conversationRouteSource).toContain('ready messageRows');
    expect(conversationRouteSource).toContain('async typingParticipants');
    expect(conversationRouteSource).toContain('when canComposeInChat');
    expect(conversationRouteSource).not.toContain(
      'when currentChatIsMember then async messages',
    );
  });

  it('declares all five nullable chat-state fields as nullable at the Contract boundary', () => {
    for (const field of [
      'quotedMessageId',
      'quotedSenderName',
      'quotedBodySnippet',
      'reactionPickerMessageId',
      'highlightedMessageId',
    ]) {
      expect(chatStateMetaSource).toContain(`${field}: 'string | null'`);
    }
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
