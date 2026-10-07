import { createElement, useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Ref } from 'react';
import { FlatList } from 'react-native';
import type { FlatListProps, ViewToken } from 'react-native';
import { committedSearchResultIds, reconcileRenderedRows } from './rendered-rows.mjs';
import { requireOptionalNativeModule } from 'expo-modules-core';

let native: any = null;
try { native = requireOptionalNativeModule('CliqueNativeObserver'); }
catch { /* A missing module is inert; a linked module records its own failures. */ }
let configured: any = undefined;
export type Row = { messageId: string; bodyHash: string; receipt: 'pending'|'sent'|'delivered'|'read'|null };
type Kind = 'ready'|'screen'|'write'|'media'|'search';
const maxQueuedEvents = 10_000;
const maxQueuedBytes = 4 * 1024 * 1024;
const eventEnvelopeAllowance = 512;
let queuedEvents = 0;
let queuedBytes = 0;
let queueOverflowed = false;

function discloseBridgeFailure(operation: string): void {
  try { native?.diagnostic(operation); } catch { /* Observation must stay passive. */ }
}

export function configuration(): any | null {
  if (configured !== undefined) return configured;
  try { configured = native?.configuration() ?? null; }
  catch { configured = null; discloseBridgeFailure('configuration-bridge'); }
  return configured;
}

export function bodyHash(body: string): string {
  try { return native?.hash(body) ?? ''; }
  catch { discloseBridgeFailure('hash-bridge'); return ''; }
}

const enqueue = typeof queueMicrotask === 'function'
  ? queueMicrotask
  : (work: () => void) => { void Promise.resolve().then(work); };

function utf8Bytes(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length && value.charCodeAt(index + 1) >= 0xdc00 && value.charCodeAt(index + 1) <= 0xdfff) {
      bytes += 4;
      index += 1;
    } else bytes += 3;
  }
  return bytes;
}

function latchQueueOverflow(): void {
  if (queueOverflowed) return;
  queueOverflowed = true;
  try { native?.overflow('javascript-observation-queue'); }
  catch { discloseBridgeFailure('overflow-bridge'); }
}

/** Fire-and-forget: callers receive no promise or persistence result. */
export function observe(kind: Kind, payload: object): void {
  if (!configuration() || queueOverflowed) return;
  let retainedPayload: object;
  let reservedBytes: number;
  try {
    const serialized = JSON.stringify(payload);
    if (typeof serialized !== 'string') throw new Error('payload is not serializable');
    reservedBytes = utf8Bytes(serialized) + eventEnvelopeAllowance;
    retainedPayload = JSON.parse(serialized) as object;
  } catch { discloseBridgeFailure('append-serialization'); return; }
  if (queuedEvents >= maxQueuedEvents || reservedBytes > maxQueuedBytes - queuedBytes) {
    latchQueueOverflow();
    return;
  }
  queuedEvents += 1;
  queuedBytes += reservedBytes;
  try {
    enqueue(() => {
      try { native?.append(kind, retainedPayload); }
      catch { discloseBridgeFailure('append-bridge'); }
      finally { queuedEvents -= 1; queuedBytes -= reservedBytes; }
    });
  } catch {
    queuedEvents -= 1;
    queuedBytes -= reservedBytes;
    discloseBridgeFailure('append-schedule');
  }
}

function dependencyValue(value: unknown, operation: string): string {
  try { return JSON.stringify(value); }
  catch { discloseBridgeFailure(operation); return 'observer-projection-invalid'; }
}

// @ref LLP 0201.000#3 — observations follow a committed React render.
export function useCommittedScreen(route: string, conversationId: string|null, rows: Row[]): void {
  const rowDependency = dependencyValue(rows, 'screen-projection');
  useLayoutEffect(() => { observe('screen', { route, conversationId, rows }); }, [route, conversationId, rowDependency]);
}

export function mediaCallbacks(messageId: string, assetId: string, provenance: string|null = null) {
  return {
    onLoad: (event: { nativeEvent: { source: { width: number; height: number } } }): void => {
      try {
        const { width, height } = event.nativeEvent.source;
        observe('media', { messageId, assetId, event: 'load', width, height, provenance });
      } catch { discloseBridgeFailure('media-callback-projection'); }
    },
    onError: (): void => { observe('media', { messageId, assetId, event: 'error', width: 0, height: 0, provenance }); },
  };
}

export type CommittedListObservation<T> = {
  route: string;
  conversationId: string|null;
  row: (item: T) => Row|null;
  search?: {
    token: string;
    openedConversationId?: string|null;
  };
};

export type CommittedFlatListProps<T> = Omit<FlatListProps<T>, 'keyExtractor'> & {
  keyExtractor: (item: T, index: number) => string;
  observation: CommittedListObservation<T>;
  listRef?: Ref<FlatList<T>>;
};

const defaultViewabilityConfig = Object.freeze({ itemVisiblePercentThreshold: 0 });

/**
 * FlatList with committed/viewable observation built in. The wrapper resolves
 * reported keys against current data, so removed rows and recycled cells never
 * survive in a later screen event.
 */
export function CommittedFlatList<T>(props: CommittedFlatListProps<T>) {
  const { observation, onViewableItemsChanged, listRef, viewabilityConfig, viewabilityConfigCallbackPairs, ...listProps } = props;
  const [renderedKeys, setRenderedKeys] = useState<string[]>([]);
  const keyExtractorRef = useRef(props.keyExtractor);
  const callbackRef = useRef(onViewableItemsChanged);
  keyExtractorRef.current = props.keyExtractor;
  callbackRef.current = onViewableItemsChanged;

  const handleViewability = useCallback((info: { viewableItems: ViewToken[]; changed: ViewToken[] }) => {
    try {
      const keys = info.viewableItems
        .filter(token => token.isViewable && token.item != null)
        .map(token => keyExtractorRef.current(token.item as T, token.index ?? 0));
      setRenderedKeys(previous => previous.length === keys.length && previous.every((key, index) => key === keys[index]) ? previous : keys);
    } catch { discloseBridgeFailure('viewability-projection'); }
  }, []);

  // FlatList rejects callback pairs combined with either top-level viewability
  // callback API. Keep the observer threshold independent from the app's
  // threshold by representing every callback as a stable pair.
  const applicationPair = useMemo(() => onViewableItemsChanged ? {
    viewabilityConfig,
    onViewableItemsChanged: (info: { viewableItems: ViewToken[]; changed: ViewToken[] }) => callbackRef.current?.(info),
  } : null, []);
  const observerPair = useMemo(() => ({
    viewabilityConfig: defaultViewabilityConfig,
    onViewableItemsChanged: handleViewability,
  }), [handleViewability]);
  const composedViewabilityPairs = useMemo(() => [
    ...(viewabilityConfigCallbackPairs ?? []),
    ...(applicationPair ? [applicationPair] : []),
    observerPair,
  ], [viewabilityConfigCallbackPairs, applicationPair, observerPair]);

  // Copy on every render: callers may use a stable array identity while its
  // committed contents change.
  const sourceData = Array.from(props.data ?? []);
  // The rendered list and its observation share one empty-search rule. This
  // prevents an old result from surviving visually while the event says empty.
  const data = observation.search && observation.search.token.trim() === '' ? [] : sourceData;
  const rows = useMemo(() => {
    try { return reconcileRenderedRows(data, renderedKeys, props.keyExtractor, observation.row, props.inverted === true) as Row[]; }
    catch { discloseBridgeFailure('row-projection'); return []; }
  }, [data, renderedKeys, props.keyExtractor, observation.row, props.inverted]);
  useCommittedScreen(observation.route, observation.conversationId, rows);
  useLayoutEffect(() => {
    if (!observation.search) return;
    try {
      observe('search', {
        token: observation.search.token,
        resultIds: committedSearchResultIds(observation.search.token, rows),
        openedConversationId: observation.search.openedConversationId ?? null,
      });
    } catch { discloseBridgeFailure('search-projection'); }
  }, [observation.search?.token, observation.search?.openedConversationId, dependencyValue(rows, 'search-projection')]);

  return createElement(FlatList<T>, {
    ...listProps,
    data,
    ref: listRef,
    keyExtractor: props.keyExtractor,
    viewabilityConfigCallbackPairs: composedViewabilityPairs,
  });
}
