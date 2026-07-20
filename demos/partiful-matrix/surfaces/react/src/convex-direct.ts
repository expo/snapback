import { ConvexClient } from 'convex/browser';

import { api } from '../../../backends/convex/convex/_generated/api';
import type {
  Connection,
  MatrixProvider,
  MutationName,
  ProviderDelivery,
  QueryName,
} from '../../../shared/model';

declare const __CONVEX_URL__: string;

// LLP 0063's comparative-fairness leg: the hosted Convex deployment is used
// directly from the browser through ConvexClient. There is intentionally no
// gateway and no polling fallback in this module.

const queryReferences = {
  listEvents: api.events.listEvents,
  eventDetails: api.events.eventDetails,
  guestList: api.events.guestList,
  eventWall: api.events.eventWall,
} as const;

const mutationReferences = {
  createEvent: api.events.createEvent,
  rsvp: api.events.rsvp,
  postMessage: api.events.postMessage,
} as const;

function projectConnection(state: ReturnType<ConvexClient['connectionState']>): Connection {
  if (state.isWebSocketConnected) return 'live';
  return state.hasEverConnected ? 'disconnected' : 'connecting';
}

export function createConvexDirectProvider(): MatrixProvider {
  if (!__CONVEX_URL__) {
    throw new Error('convex-realtime cell needs CONVEX_URL at build time');
  }

  const client = new ConvexClient(__CONVEX_URL__);
  const transportEvents: Record<string, unknown>[] = [];
  let subscriptionCounter = 0;
  let providerDisposed = false;

  return {
    backend: 'convex-realtime',
    transport: 'push',
    externalStoreProtocol: 'snapback.external-store.v1',
    async subscribe<Row>(
      name: QueryName,
      args: Record<string, unknown>,
      _userId: string,
      observer: (rows: Row[], connection: Connection, delivery?: ProviderDelivery) => void,
    ) {
      const subscriptionId = `convex_${name}_${subscriptionCounter += 1}`;
      let disposed = false;
      let latestRows: Row[] = [];
      let deliveryCount = 0;
      let queryUnsubscribe: (() => void) | undefined;
      let connectionUnsubscribe: (() => void) | undefined;
      let lastConnection: Connection | undefined;
      let resolveInitial: ((rows: Row[]) => void) | undefined;
      let rejectInitial: ((error: Error) => void) | undefined;
      const initial = new Promise<Row[]>((resolve, reject) => {
        resolveInitial = resolve;
        rejectInitial = reject;
      });

      const publishConnection = (state: ReturnType<ConvexClient['connectionState']>) => {
        const connection = projectConnection(state);
        if (disposed || connection === lastConnection) return;
        lastConnection = connection;
        transportEvents.push({
          queryName: name,
          subscriptionId,
          event: 'connection',
          transport: 'push',
          connection,
          pollFallbackEnabled: false,
          client: 'convex/browser',
          socketConnected: state.isWebSocketConnected,
          hasEverConnected: state.hasEverConnected,
          connectionCount: state.connectionCount,
          connectionRetries: state.connectionRetries,
        });
        observer(latestRows, connection, { kind: 'connection' });
      };

      observer([], 'connecting', { kind: 'connection' });
      connectionUnsubscribe = client.subscribeToConnectionState((state) => {
        publishConnection(state);
      });

      try {
        queryUnsubscribe = client.onUpdate(
          queryReferences[name] as never,
          args as never,
          (value: unknown) => {
            if (disposed) return;
            if (!Array.isArray(value)) {
              const error = new Error(`Convex query ${name} returned a non-array result`);
              observer(latestRows, 'disconnected', { kind: 'error', error });
              rejectInitial?.(error);
              rejectInitial = undefined;
              return;
            }
            latestRows = value as Row[];
            const event = deliveryCount === 0 ? 'snapshot' : 'update';
            const connectionState = client.connectionState();
            const connection = projectConnection(connectionState);
            deliveryCount += 1;
            transportEvents.push({
              queryName: name,
              subscriptionId,
              event,
              transport: 'push',
              pollFallbackEnabled: false,
              client: 'convex/browser',
              deliveryCount,
              socketConnected: connectionState.isWebSocketConnected,
              hasEverConnected: connectionState.hasEverConnected,
              connectionCount: connectionState.connectionCount,
              connectionRetries: connectionState.connectionRetries,
            });
            observer(latestRows, connection, { kind: 'authoritative' });
            resolveInitial?.(latestRows);
            resolveInitial = undefined;
            rejectInitial = undefined;
          },
          (error: Error) => {
            if (disposed) return;
            transportEvents.push({
              queryName: name,
              subscriptionId,
              event: 'error',
              transport: 'push',
              code: error.name,
            });
            observer(latestRows, 'disconnected', { kind: 'error', error });
            rejectInitial?.(error);
            resolveInitial = undefined;
            rejectInitial = undefined;
          },
        );
      } catch (error) {
        connectionUnsubscribe?.();
        throw error;
      }

      const timeout = window.setTimeout(() => {
        const error = new Error(`Convex query ${name} did not produce an initial snapshot`);
        rejectInitial?.(error);
        resolveInitial = undefined;
        rejectInitial = undefined;
      }, 30_000);

      const dispose = () => {
        if (disposed) return;
        disposed = true;
        window.clearTimeout(timeout);
        queryUnsubscribe?.();
        connectionUnsubscribe?.();
        transportEvents.push({
          queryName: name,
          subscriptionId,
          event: 'disposed',
          transport: 'push',
          pollFallbackEnabled: false,
          client: 'convex/browser',
        });
      };

      try {
        const rows = await initial;
        window.clearTimeout(timeout);
        return { rows, dispose };
      } catch (error) {
        dispose();
        throw error;
      }
    },
    async mutate<T>(name: MutationName, args: Record<string, unknown>, userId: string) {
      return await client.mutation(
        mutationReferences[name] as never,
        { ...args, userId } as never,
      ) as T;
    },
    transportEvidence: () => transportEvents.map((event) => ({ ...event })),
    async dispose() {
      if (providerDisposed) return;
      providerDisposed = true;
      transportEvents.push({
        event: 'provider-disposing',
        transport: 'push',
        pollFallbackEnabled: false,
        client: 'convex/browser',
      });
      await client.close();
      transportEvents.push({
        event: 'provider-closed',
        transport: 'push',
        pollFallbackEnabled: false,
        client: 'convex/browser',
      });
    },
  };
}
