// Hand-wired live-query hook, per the React-arm guide: bind once per
// (function, args, user), push rows and the honest connection axis into React
// state, apply the handle's snapshot immediately, and dispose on unmount —
// including the StrictMode latecomer case where the subscribe promise
// resolves after its cleanup already ran.

import { useEffect, useMemo, useRef, useState } from 'react';

import type { FunctionRef, LiveQueryHandle, SnapbackClient } from '../../../../_kit/client.mjs';

export type ConnectionAxis = 'connecting' | 'live' | 'stale' | 'disconnected';

export interface LiveRows<Row> {
  rows: Row[];
  connection: ConnectionAxis;
  error: string | null;
}

let connectionCounter = 0;

export function useLiveRows<Row>(
  client: SnapbackClient,
  ref: FunctionRef,
  {
    args = {},
    userId,
    skip = false,
  }: { args?: Record<string, unknown>; userId: string; skip?: boolean },
): LiveRows<Row> {
  const [rows, setRows] = useState<Row[]>([]);
  const [connection, setConnection] = useState<ConnectionAxis>('connecting');
  const [error, setError] = useState<string | null>(null);
  // One durable socket identity per hook instance, not per render.
  const connectionId = useMemo(() => `shindig_${(connectionCounter += 1)}_${Math.floor(Math.random() * 1e6)}`, []);
  const argsKey = JSON.stringify(args);
  const argsRef = useRef(args);
  argsRef.current = args;

  useEffect(() => {
    if (skip) {
      setRows([]);
      setConnection('disconnected');
      return;
    }
    let disposed = false;
    let handle: LiveQueryHandle<Row> | null = null;
    client.liveQuery<Row>(ref, {
      connectionId,
      args: argsRef.current,
      userId,
      transport: 'stream',
      onUpdate: (next) => {
        if (!disposed) setRows(next);
      },
      onConnectionChange: (value) => {
        if (!disposed) setConnection(value as ConnectionAxis);
      },
    })
      .then((live) => {
        if (disposed) {
          live.dispose();
          return;
        }
        handle = live;
        setRows(live.rows);
        setConnection(live.connection as ConnectionAxis);
      })
      .catch((cause: { diagnostic?: { code?: string }; message?: string }) => {
        if (!disposed) {
          setError(cause.diagnostic?.code ?? cause.message ?? 'subscription failed');
          setConnection('disconnected');
        }
      });
    return () => {
      disposed = true;
      handle?.dispose();
      handle = null;
    };
  }, [client, ref, connectionId, userId, argsKey, skip]);

  return { rows, connection, error };
}
