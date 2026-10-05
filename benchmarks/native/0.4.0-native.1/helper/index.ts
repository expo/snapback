import { requireOptionalNativeModule } from 'expo-modules-core';
import { useLayoutEffect } from 'react';

const native = requireOptionalNativeModule('CliqueNativeObserver');
let configured: any = undefined;
export type Row = { messageId: string; bodyHash: string; receipt: 'pending'|'sent'|'delivered'|'read'|null };
export const configuration = () => configured === undefined ? (configured = native?.configuration() ?? null) : configured;
export const bodyHash = (body: string): string => native?.hash(body) ?? ''; 
export const observe = (kind: 'ready'|'screen'|'write'|'media'|'search', payload: object) => { if (configuration()) native.append(kind, payload); };
// @ref LLP 0201.000#3 — caller passes the very rows mapped to JSX, after React commit.
export function useCommittedScreen(route: string, conversationId: string|null, rows: Row[]) {
  useLayoutEffect(() => observe('screen', { route, conversationId, rows }), [route, conversationId, JSON.stringify(rows)]);
}
export function mediaCallbacks(messageId: string, assetId: string, provenance: string|null = null) {
  return {
    onLoad: (event: { nativeEvent: { source: { width: number; height: number } } }) =>
      observe('media', { messageId, assetId, event: 'load', width: event.nativeEvent.source.width, height: event.nativeEvent.source.height, provenance }),
    onError: () => observe('media', { messageId, assetId, event: 'error', width: 0, height: 0, provenance }),
  };
}
