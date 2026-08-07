import type { FunctionArgs, FunctionReference, FunctionReturnType } from 'convex/server';
import { useQuery } from 'convex/react';
import { useEffect, useState } from 'react';

export function useCachedQuery<Query extends FunctionReference<'query'>>(
  query: Query,
  args: FunctionArgs<Query> | 'skip',
  key: string,
) {
  const live = useQuery(query, args);
  const [cached, setCached] = useState<FunctionReturnType<Query> | undefined>(() => readCachedSnapshot(key));

  useEffect(() => {
    setCached(readCachedSnapshot(key));
  }, [key]);

  useEffect(() => {
    if (live === undefined) return;
    setCached(live);
    writeCachedSnapshot(key, live);
  }, [key, live]);

  return {
    data: live ?? cached,
    freshness: live !== undefined ? 'current' as const : cached !== undefined ? 'cached' as const : null,
  };
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

export function readCachedSnapshot<Value>(key: string, storage: StorageLike | undefined = globalThis.localStorage): Value | undefined {
  const value = storage?.getItem(key);
  if (!value) return undefined;
  try { return JSON.parse(value) as Value; } catch { return undefined; }
}

export function writeCachedSnapshot<Value>(key: string, value: Value, storage: StorageLike | undefined = globalThis.localStorage) {
  storage?.setItem(key, JSON.stringify(value));
}
