import {useCallback, useSyncExternalStore} from 'react';

/**
 * The pinned application stores one opaque value in wouter's history state.
 * Keep this projection deliberately small so Lane 6b can pass it directly to
 * use-wouter-scroll-state without coupling the controller to a router.
 */
export type WindowScrollState<Cursor> = Readonly<{
  version: 'zerobugs.window-scroll.v1';
  identity: string;
  anchor: Cursor | null;
  offset: number;
  scrollTop: number;
}>;

export type ScrollHistoryPort = Readonly<{
  read(): unknown;
  replace(value: unknown): void;
  subscribe(listener: () => void): () => void;
}>;

export function isWindowScrollState<Cursor>(
  value: unknown,
  identity?: string,
): value is WindowScrollState<Cursor> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return candidate.version === 'zerobugs.window-scroll.v1'
    && typeof candidate.identity === 'string'
    && (identity === undefined || candidate.identity === identity)
    && (candidate.anchor === null
      || (typeof candidate.anchor === 'object' && !Array.isArray(candidate.anchor)))
    && typeof candidate.offset === 'number'
    && Number.isFinite(candidate.offset)
    && typeof candidate.scrollTop === 'number'
    && Number.isFinite(candidate.scrollTop)
    && candidate.scrollTop >= 0;
}

export function windowScrollState<Cursor>(input: Readonly<{
  identity: string;
  anchor: Cursor | null;
  offset: number;
  scrollTop: number;
}>): WindowScrollState<Cursor> {
  if (!Number.isFinite(input.offset) || !Number.isFinite(input.scrollTop) || input.scrollTop < 0) {
    throw new TypeError('window scroll state needs finite offset and non-negative scrollTop');
  }
  return Object.freeze({
    version: 'zerobugs.window-scroll.v1',
    identity: input.identity,
    anchor: input.anchor,
    offset: input.offset,
    scrollTop: input.scrollTop,
  });
}

export function readWindowScrollState<Cursor>(
  value: unknown,
  identity: string,
): WindowScrollState<Cursor> | undefined {
  return isWindowScrollState<Cursor>(value, identity) ? value : undefined;
}

export function browserScrollHistory(): ScrollHistoryPort | null {
  if (typeof window === 'undefined') return null;
  return Object.freeze({
    read: () => window.history.state,
    replace: value => window.history.replaceState(value, ''),
    subscribe(listener) {
      window.addEventListener('popstate', listener);
      return () => window.removeEventListener('popstate', listener);
    },
  });
}

/** Same `[state, setState]` contract consumed by use-wouter-scroll-state. */
export function useWindowScrollHistory<Cursor>(
  identity: string,
  port: ScrollHistoryPort | null = browserScrollHistory(),
): readonly [
  WindowScrollState<Cursor> | null,
  (state: WindowScrollState<Cursor>) => void,
] {
  const read = useCallback(() => (
    port ? readWindowScrollState<Cursor>(port.read(), identity) ?? null : null
  ), [identity, port]);
  const subscribe = useCallback((listener: () => void) => (
    port ? port.subscribe(listener) : () => {}
  ), [port]);
  const state = useSyncExternalStore(subscribe, read, () => null);
  const setState = useCallback((next: WindowScrollState<Cursor>) => {
    if (next.identity !== identity) {
      throw new TypeError('scroll history state belongs to another window identity');
    }
    port?.replace(next);
  }, [identity, port]);
  return [state, setState] as const;
}
