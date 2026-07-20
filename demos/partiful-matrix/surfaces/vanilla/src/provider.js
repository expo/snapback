import { SnapbackClient } from '../../../../_kit/client.mjs';
import api from '../../../snapback/generated/api.mjs';
import artifactIndex from '../../../snapback/generated/artifacts.json';
import functionsManifest from '../../../snapback/generated/functions.manifest.json';
import schemaManifest from '../../../snapback/generated/schema.manifest.json';
import seed from '../../../snapback/seed.json';

export const configuredBackend = __MATRIX_BACKEND__;
export const snapbackArtifactHash = artifactIndex.inputsHash;

export async function createMatrixProvider() {
  if (__MATRIX_BACKEND__ === 'snapback') return createSnapbackProvider();
  return createGatewayProvider(__MATRIX_BACKEND__);
}

async function createSnapbackProvider() {
  const client = new SnapbackClient(__SNAPBACK_API_ORIGIN__ || '/snapback');
  await client.health();
  // @ref LLP 0034#5 — every vanilla mount provisions idempotently and exposes
  // no reset operation, so a reload cannot erase writes from another row.
  await client.ensureApp({ schema: schemaManifest, functions: functionsManifest, seed });
  let counter = 0;
  const subscriptionEvents = [];
  return {
    backend: 'snapback',
    transport: 'push',
    async subscribe(name, args, userId, observer) {
      let latestRows = [];
      const handle = await client.liveQuery(api[name], {
        args,
        userId,
        transport: 'stream',
        fallbackToPoll: !__PARTITIME_DISABLE_POLL_FALLBACK__,
        connectionId: `partiful_matrix_vanilla_${name}_${counter += 1}`,
        onUpdate: (rows) => {
          latestRows = rows;
          observer(rows, 'live');
        },
        onConnectionChange: (connection) => observer(latestRows, connection),
        onSubscriptionEvent: (event) => subscriptionEvents.push({
          queryName: name,
          pollFallbackEnabled: !__PARTITIME_DISABLE_POLL_FALLBACK__,
          ...event,
        }),
      });
      latestRows = handle.rows;
      observer(handle.rows, handle.connection);
      return { rows: handle.rows, dispose: () => handle.dispose() };
    },
    async mutate(name, args, userId) {
      const result = await client.mutate(api[name], { args, userId });
      return result.result;
    },
    transportEvidence: () => subscriptionEvents.map((event) => ({ ...event })),
  };
}

function createGatewayProvider(backend) {
  const origin = (__MATRIX_GATEWAY_ORIGIN__ || '/matrix-api').replace(/\/$/, '');
  const call = async (kind, name, args, userId) => {
    const response = await fetch(`${origin}/${kind}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ backend, name, args, userId }),
    });
    const payload = await response.json();
    if (!response.ok || !payload.ok) throw new Error(payload.error || `${backend} ${kind} failed`);
    return payload.value;
  };
  return {
    backend,
    transport: 'poll',
    async subscribe(name, args, userId, observer) {
      let disposed = false;
      let rows = [];
      let fingerprint = '';
      let timer;
      const poll = async () => {
        try {
          const next = await call('query', name, args, userId);
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
      return {
        rows,
        dispose() {
          disposed = true;
          if (timer) window.clearTimeout(timer);
        },
      };
    },
    mutate(name, args, userId) {
      return call('mutate', name, args, userId);
    },
  };
}
