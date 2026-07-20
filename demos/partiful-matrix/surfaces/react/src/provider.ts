import type { Backend, BackendMode, MatrixProvider, MutationName, QueryName } from '../../../shared/model';

import { SnapbackClient } from '../../../../_kit/client.mjs';
import api from '../../../snapback/generated/api.mjs';
import artifactIndex from '../../../snapback/generated/artifacts.json';
import functionsManifest from '../../../snapback/generated/functions.manifest.json';
import schemaManifest from '../../../snapback/generated/schema.manifest.json';
import seed from '../../../snapback/seed.json';

declare const __MATRIX_BACKEND__: BackendMode;
declare const __SNAPBACK_API_ORIGIN__: string;
declare const __MATRIX_GATEWAY_ORIGIN__: string;
declare const __PARTITIME_DISABLE_POLL_FALLBACK__: boolean;

type Connection = 'connecting' | 'live' | 'polling' | 'disconnected';

export const configuredBackend: BackendMode = __MATRIX_BACKEND__;

export async function createMatrixProvider(): Promise<MatrixProvider> {
  if (__MATRIX_BACKEND__ === 'snapback') return createSnapbackProvider();
  if (__MATRIX_BACKEND__ === 'supabase-realtime') {
    const { createSupabaseDirectProvider } = await import('./supabase-direct');
    return createSupabaseDirectProvider();
  }
  return createGatewayProvider(__MATRIX_BACKEND__);
}

async function createSnapbackProvider(): Promise<MatrixProvider> {
  const client = new SnapbackClient(__SNAPBACK_API_ORIGIN__ || '/snapback');
  await client.health();
  // @ref LLP 0034#5 — browser mount is inspect-first/idempotent; reset is
  // deliberately unreachable so reloads preserve the matrix cell's writes.
  await client.ensureApp({ schema: schemaManifest, functions: functionsManifest, seed });
  let counter = 0;
  const subscriptionEvents: Record<string, unknown>[] = [];
  const refs = api as Record<string, unknown>;
  return {
    backend: 'snapback',
    transport: 'push',
    async subscribe<Row>(name: QueryName, args: Record<string, unknown>, userId: string, observer: (rows: Row[], connection: Connection) => void) {
      let latestRows: Row[] = [];
      const handle = await client.liveQuery<Row>(refs[name] as never, {
        args,
        userId,
        transport: 'stream',
        fallbackToPoll: !__PARTITIME_DISABLE_POLL_FALLBACK__,
        connectionId: `partiful_matrix_react_${name}_${counter += 1}`,
        onUpdate: (rows) => { latestRows = rows; observer(rows, 'live'); },
        onConnectionChange: (connection) => observer(latestRows, connection as Connection),
        onSubscriptionEvent: (event) => subscriptionEvents.push({
          queryName: name,
          pollFallbackEnabled: !__PARTITIME_DISABLE_POLL_FALLBACK__,
          ...(event as unknown as Record<string, unknown>),
        }),
      });
      latestRows = handle.rows;
      observer(handle.rows, handle.connection as Connection);
      return { rows: handle.rows, dispose: () => handle.dispose() };
    },
    async mutate<T>(name: MutationName, args: Record<string, unknown>, userId: string) {
      const result = await client.mutate(refs[name] as never, { args, userId } as never);
      return result.result as T;
    },
    transportEvidence: () => subscriptionEvents.map((event) => ({ ...event })),
  };
}

function createGatewayProvider(backend: Exclude<Backend, 'snapback'>): MatrixProvider {
  const origin = (__MATRIX_GATEWAY_ORIGIN__ || '/matrix-api').replace(/\/$/, '');
  const call = async <T>(kind: 'query' | 'mutate', name: string, args: Record<string, unknown>, userId: string) => {
    const response = await fetch(`${origin}/${kind}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ backend, name, args, userId }),
    });
    const payload = await response.json();
    if (!response.ok || !payload.ok) throw new Error(payload.error || `${backend} ${kind} failed`);
    return payload.value as T;
  };
  return {
    backend,
    transport: 'poll',
    async subscribe<Row>(name: QueryName, args: Record<string, unknown>, userId: string, observer: (rows: Row[], connection: Connection) => void) {
      let disposed = false;
      let rows: Row[] = [];
      let fingerprint = '';
      let timer: number | undefined;
      const poll = async () => {
        try {
          const next = await call<Row[]>('query', name, args, userId);
          const nextFingerprint = JSON.stringify(next);
          rows = next;
          if (nextFingerprint !== fingerprint) {
            fingerprint = nextFingerprint;
            observer(rows, 'polling');
          }
        } catch {
          observer(rows, 'disconnected');
        } finally {
          if (!disposed) timer = window.setTimeout(poll, 1000);
        }
      };
      observer(rows, 'connecting');
      await poll();
      return { rows, dispose() { disposed = true; if (timer) window.clearTimeout(timer); } };
    },
    async mutate<T>(name: MutationName, args: Record<string, unknown>, userId: string) {
      return call<T>('mutate', name, args, userId);
    },
  };
}

export const snapbackArtifactHash = artifactIndex.inputsHash;
