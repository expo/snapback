import { beforeEach, expect, mock, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { createElement } from 'react';
import TestRenderer, { act } from 'react-test-renderer';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const require = createRequire(import.meta.url);
const reactNativePackagePath = require.resolve('react-native/package.json');
const reactNativePackage = JSON.parse(readFileSync(reactNativePackagePath, 'utf8')) as { version: string };
const flatListSource = readFileSync(join(dirname(reactNativePackagePath), 'Libraries/Lists/FlatList.js'), 'utf8');
const flatListSha256 = createHash('sha256').update(flatListSource).digest('hex');
const checkStart = flatListSource.indexOf('_checkProps(props:');
const checkBodyStart = flatListSource.indexOf('{', checkStart) + 1;
const checkBodyEnd = flatListSource.indexOf('\n  }\n\n  _getItem', checkBodyStart);
if (checkStart < 0 || checkBodyStart === 0 || checkBodyEnd < 0) throw new Error('pinned FlatList._checkProps not found');
const pinnedCheckProps = new Function(
  'props',
  'invariant',
  'numColumnsOrDefault',
  flatListSource.slice(checkBodyStart, checkBodyEnd),
);

function validatePinnedFlatListProps(props: FlatListHostProps): void {
  pinnedCheckProps.call(
    { props },
    props,
    (condition: boolean, message: string) => { if (!condition) throw new Error(message); },
    (value: number | null | undefined) => value ?? 1,
  );
}

type ViewInfo = {
  viewableItems: Array<{ isViewable: boolean; item: { id: string }; index: number }>;
  changed: Array<unknown>;
};
type CallbackPair = {
  viewabilityConfig?: object;
  onViewableItemsChanged: (info: ViewInfo) => void;
};
type FlatListHostProps = {
  data: Array<{ id: string }>;
  inverted?: boolean;
  onViewableItemsChanged?: (info: ViewInfo) => void;
  viewabilityConfig?: object;
  viewabilityConfigCallbackPairs: CallbackPair[];
};

const diagnosticOperations: string[] = [];
const appended: Array<{ kind: string; payload: any }> = [];
let appendCalls = 0;
let appendFailure = false;
let pinnedInvariantChecks = 0;
let overflowCalls = 0;
let stallObservationQueue = false;
const stalledObservationCallbacks: Array<() => void> = [];
const nativeQueueMicrotask = globalThis.queueMicrotask.bind(globalThis);
globalThis.queueMicrotask = work => {
  if (stallObservationQueue) stalledObservationCallbacks.push(work);
  else nativeQueueMicrotask(work);
};

mock.module('react-native', () => ({
  FlatList: (props: FlatListHostProps) => {
    pinnedInvariantChecks += 1;
    validatePinnedFlatListProps(props);
    return createElement('FlatList', props);
  },
}));
mock.module('expo-modules-core', () => ({
  requireOptionalNativeModule: () => ({
    append: (kind: string, payload: object) => {
      appendCalls += 1;
      if (appendFailure) throw new Error('synthetic native append failure');
      appended.push({ kind, payload });
    },
    configuration: () => ({ runId: '142ed513-dacc-4219-bf29-3098db534c1c' }),
    diagnostic: (operation: string) => { diagnosticOperations.push(operation); },
    hash: () => '',
    overflow: () => { overflowCalls += 1; },
  }),
}));

const { CommittedFlatList, observe } = await import('../helper/index.ts');

beforeEach(() => {
  diagnosticOperations.length = 0;
  appended.length = 0;
  appendCalls = 0;
  appendFailure = false;
  pinnedInvariantChecks = 0;
  overflowCalls = 0;
  stallObservationQueue = false;
  stalledObservationCallbacks.length = 0;
});

const keyExtractor = (item: { id: string }) => item.id;
const renderItem = () => null;
const row = (item: { id: string }) => ({ messageId: item.id, bodyHash: `hash-${item.id}`, receipt: null as null });
const viewInfo = (...items: Array<{ id: string }>): ViewInfo => ({
  viewableItems: items.map((item, index) => ({ isViewable: true, item, index })),
  changed: [],
});

function props(overrides: Record<string, unknown> = {}) {
  return {
    data: [{ id: 'newest' }, { id: 'older' }],
    keyExtractor,
    renderItem,
    observation: { route: 'conversation', conversationId: 'conversation-1', row },
    ...overrides,
  };
}

async function mount(element: ReturnType<typeof createElement>) {
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(element);
    await Promise.resolve();
  });
  return renderer;
}

async function update(renderer: TestRenderer.ReactTestRenderer, element: ReturnType<typeof createElement>) {
  await act(async () => {
    renderer.update(element);
    await Promise.resolve();
  });
}

async function report(pair: CallbackPair, info: ViewInfo) {
  await act(async () => {
    pair.onViewableItemsChanged(info);
    await Promise.resolve();
  });
}

function flatList(renderer: TestRenderer.ReactTestRenderer): FlatListHostProps {
  return renderer.root.findByType('FlatList').props as FlatListHostProps;
}

function latestPayload(kind: string): any {
  return appended.filter(event => event.kind === kind).at(-1)?.payload;
}

test('public observe API is void and contains a native append failure', async () => {
  appendFailure = true;
  expect(observe('ready', { principal: 'alice' })).toBeUndefined();
  await new Promise<void>(resolve => queueMicrotask(resolve));
  expect(appendCalls).toBe(1);
  expect(diagnosticOperations).toEqual(['append-bridge']);
});

test('mounted wrapper composes stable callback pairs accepted by RN 0.86.3', async () => {
  const incomingCalls: ViewInfo[] = [];
  const firstTopLevelCalls: ViewInfo[] = [];
  const latestTopLevelCalls: ViewInfo[] = [];
  const incomingPair: CallbackPair = {
    viewabilityConfig: { itemVisiblePercentThreshold: 60 },
    onViewableItemsChanged: info => { incomingCalls.push(info); },
  };
  const incomingPairs = [incomingPair];
  const applicationConfig = { viewAreaCoveragePercentThreshold: 75 };
  const first = props({
    viewabilityConfigCallbackPairs: incomingPairs,
    viewabilityConfig: applicationConfig,
    onViewableItemsChanged: (info: ViewInfo) => { firstTopLevelCalls.push(info); },
  });
  const renderer = await mount(createElement(CommittedFlatList, first));
  const mounted = flatList(renderer);
  const composedPairs = mounted.viewabilityConfigCallbackPairs;

  expect(reactNativePackage.version).toBe('0.86.3');
  expect(flatListSha256).toBe('66efc856611659358c3e618d4245638a60a4ffde63371cd5c37748a57b6ab183');
  expect(pinnedInvariantChecks).toBeGreaterThan(0);
  expect(mounted.onViewableItemsChanged).toBeUndefined();
  expect(mounted.viewabilityConfig).toBeUndefined();
  expect(composedPairs).toHaveLength(3);
  expect(composedPairs[0]).toBe(incomingPair);
  expect(composedPairs[1].viewabilityConfig).toBe(applicationConfig);
  expect(composedPairs[2].viewabilityConfig).toEqual({ itemVisiblePercentThreshold: 0 });
  expect(composedPairs[2].viewabilityConfig).not.toBe(incomingPair.viewabilityConfig);
  expect(() => validatePinnedFlatListProps({
    ...mounted,
    onViewableItemsChanged: () => {},
  })).toThrow('FlatList does not support setting both onViewableItemsChanged and viewabilityConfigCallbackPairs.');

  const second = {
    ...first,
    observation: { ...first.observation, conversationId: 'conversation-2' },
    onViewableItemsChanged: (info: ViewInfo) => { latestTopLevelCalls.push(info); },
  };
  await update(renderer, createElement(CommittedFlatList, second));
  const rerendered = flatList(renderer);
  expect(rerendered.viewabilityConfigCallbackPairs).toBe(composedPairs);
  expect(rerendered.onViewableItemsChanged).toBeUndefined();
  expect(rerendered.viewabilityConfig).toBeUndefined();

  const info = viewInfo({ id: 'newest' }, { id: 'older' });
  rerendered.viewabilityConfigCallbackPairs[0].onViewableItemsChanged(info);
  rerendered.viewabilityConfigCallbackPairs[1].onViewableItemsChanged(info);
  expect(incomingCalls).toEqual([info]);
  expect(firstTopLevelCalls).toEqual([]);
  expect(latestTopLevelCalls).toEqual([info]);

  // This state transition and committed effect make deletion of
  // setRenderedKeys observable rather than merely inspecting callback props.
  await report(rerendered.viewabilityConfigCallbackPairs.at(-1)!, info);
  expect(latestPayload('screen')).toEqual({
    route: 'conversation',
    conversationId: 'conversation-2',
    rows: [
      { messageId: 'newest', bodyHash: 'hash-newest', receipt: null },
      { messageId: 'older', bodyHash: 'hash-older', receipt: null },
    ],
  });
  await act(async () => { renderer.unmount(); });
});

test('mounted inverted list observes native visual order for newest-first data', async () => {
  const renderer = await mount(createElement(CommittedFlatList, props({ inverted: true })));
  const mounted = flatList(renderer);
  expect(mounted.inverted).toBe(true);
  expect(mounted.onViewableItemsChanged).toBeUndefined();
  expect(mounted.viewabilityConfig).toBeUndefined();
  expect(mounted.viewabilityConfigCallbackPairs).toHaveLength(1);

  await report(
    mounted.viewabilityConfigCallbackPairs[0],
    viewInfo({ id: 'newest' }, { id: 'older' }),
  );
  expect(latestPayload('screen').rows.map((entry: { messageId: string }) => entry.messageId))
    .toEqual(['older', 'newest']);
  await act(async () => { renderer.unmount(); });
});

test('mounted empty search passes an empty data array to FlatList', async () => {
  const renderer = await mount(createElement(CommittedFlatList, props({
    observation: {
      route: 'search',
      conversationId: null,
      row,
      search: { token: '   ' },
    },
  })));
  const mounted = flatList(renderer);
  expect(mounted.data).toEqual([]);
  expect(latestPayload('search')).toEqual({ token: '   ', resultIds: [], openedConversationId: null });
  await act(async () => { renderer.unmount(); });
});

test('pre-enqueue queue bounds latch overflow and refuse later observation work', () => {
  stallObservationQueue = true;
  const payload = {
    route: 'conversation',
    conversationId: 'conversation-1',
    rows: [{ messageId: 'message', bodyHash: 'x'.repeat(2048), receipt: 'sent' }],
  };
  expect(observe('screen', payload)).toBeUndefined();
  for (let index = 1; index < 10_001; index += 1) observe('screen', payload);

  expect(stalledObservationCallbacks.length).toBeGreaterThan(0);
  expect(stalledObservationCallbacks.length).toBeLessThanOrEqual(10_000);
  expect(overflowCalls).toBe(1);
  expect(appendCalls).toBe(0);
  const retained = stalledObservationCallbacks.length;
  expect(observe('screen', payload)).toBeUndefined();
  expect(stalledObservationCallbacks).toHaveLength(retained);
  expect(overflowCalls).toBe(1);
});
