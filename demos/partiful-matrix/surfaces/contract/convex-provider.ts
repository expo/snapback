import {
  createProviderMutation,
  createProviderQueryHandle,
  type ContractDataManifest,
  type ContractDataProvider,
  type DataCellV2,
  type DataMutationCorrelation,
  type DataMutationResult,
  type DataObserver,
  type DataSubscription,
} from '@exact/contract/runtime';
import { ConvexClient } from 'convex/browser';

import { api } from '../../backends/convex/convex/_generated/api';
import manifestJson from './data/generated/convex.manifest.json';
import type { GeneratedProviderLinks } from './data/provider.generated';

// @ref LLP 0063#workstream-4--generated-provider-boundaries-and-a-closed-type-loop — this is the first
// independently generated non-Snapback Contract provider. It uses the native
// Convex WebSocket client directly: no matrix gateway and no polling path.

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

type QueryName = keyof typeof queryReferences;
type MutationName = keyof typeof mutationReferences;

export class ConvexContractProvider implements ContractDataProvider {
  readonly manifest = manifestJson as ContractDataManifest;
  readonly #client: ConvexClient;
  readonly #userId: string;
  readonly #transportEvents: Record<string, unknown>[] = [];
  readonly #subscriptions = new Set<() => void>();
  #subscriptionCounter = 0;
  #disposed = false;

  constructor(url: string, userId: string) {
    if (!url) throw new Error('Contract Convex realtime cell needs CONVEX_URL at build time');
    this.#client = new ConvexClient(url);
    this.#userId = userId;
  }

  subscribe<T>(queryName: string, args: Record<string, unknown>, observer: DataObserver<T>): DataSubscription {
    if (!(queryName in queryReferences)) {
      observer({
        status: 'error',
        error: serializeError(new Error(`unknown Convex query ${queryName}`)),
        connection: 'disconnected',
      });
      return { dispose() {} };
    }
    const name = queryName as QueryName;
    const subscriptionId = `contract_convex_${name}_${this.#subscriptionCounter += 1}`;
    let disposed = false;
    let latest: T | undefined;
    let deliveryCount = 0;
    observer({ status: 'pending', connection: 'connecting' });

    const publishConnection = () => {
      if (disposed) return;
      const state = this.#client.connectionState();
      const connection = state.isWebSocketConnected
        ? 'live'
        : state.hasEverConnected ? 'stale' : 'connecting';
      this.#transportEvents.push({
        queryName: name,
        subscriptionId,
        event: 'connection',
        transport: 'push',
        pollFallbackEnabled: false,
        client: 'convex/browser',
        connection,
        socketConnected: state.isWebSocketConnected,
        hasEverConnected: state.hasEverConnected,
        connectionCount: state.connectionCount,
        connectionRetries: state.connectionRetries,
      });
      observer(latest === undefined
        ? { status: 'pending', connection }
        : { status: 'ready', value: latest, empty: Array.isArray(latest) && latest.length === 0, connection });
    };

    const unsubscribeConnection = this.#client.subscribeToConnectionState(publishConnection);
    const unsubscribeQuery = this.#client.onUpdate(
      queryReferences[name] as never,
      args as never,
      (value: unknown) => {
        if (disposed) return;
        if (!Array.isArray(value)) {
          const error = new Error(`Convex query ${name} returned a non-array result`);
          observer({ status: 'error', error: serializeError(error), ...(latest === undefined ? {} : { previous: latest }), connection: 'disconnected' });
          return;
        }
        latest = value as T;
        const state = this.#client.connectionState();
        deliveryCount += 1;
        this.#transportEvents.push({
          queryName: name,
          subscriptionId,
          event: deliveryCount === 1 ? 'snapshot' : 'update',
          transport: 'push',
          pollFallbackEnabled: false,
          client: 'convex/browser',
          deliveryCount,
          socketConnected: state.isWebSocketConnected,
          hasEverConnected: state.hasEverConnected,
          connectionCount: state.connectionCount,
          connectionRetries: state.connectionRetries,
        });
        observer({
          status: 'ready',
          value: latest,
          empty: value.length === 0,
          connection: state.isWebSocketConnected ? 'live' : 'stale',
        } as DataCellV2<T>);
      },
      (error: Error) => {
        if (disposed) return;
        this.#transportEvents.push({
          queryName: name,
          subscriptionId,
          event: 'error',
          transport: 'push',
          pollFallbackEnabled: false,
          client: 'convex/browser',
          code: error.name,
        });
        observer({ status: 'error', error: serializeError(error), ...(latest === undefined ? {} : { previous: latest }), connection: 'disconnected' });
      },
    );

    const dispose = () => {
      if (disposed) return;
      disposed = true;
      unsubscribeQuery();
      unsubscribeConnection();
      this.#subscriptions.delete(dispose);
      this.#transportEvents.push({
        queryName: name,
        subscriptionId,
        event: 'disposed',
        transport: 'push',
        pollFallbackEnabled: false,
        client: 'convex/browser',
      });
    };
    this.#subscriptions.add(dispose);
    return { dispose };
  }

  async mutate<T>(mutationName: string, args: Record<string, unknown>, _correlation?: DataMutationCorrelation): Promise<DataMutationResult<T>> {
    if (!(mutationName in mutationReferences)) {
      return { ok: false, error: serializeError(new Error(`unknown Convex mutation ${mutationName}`)) };
    }
    try {
      const value = await this.#client.mutation(
        mutationReferences[mutationName as MutationName] as never,
        { ...args, userId: this.#userId } as never,
      );
      return { ok: true, value: value as T };
    } catch (error) {
      return { ok: false, error: serializeError(error) };
    }
  }

  links(): GeneratedProviderLinks {
    return {
      listEvents: (args) => createProviderQueryHandle(this, 'listEvents', args),
      eventDetails: (args) => createProviderQueryHandle(this, 'eventDetails', args),
      guestList: (args) => createProviderQueryHandle(this, 'guestList', args),
      eventWall: (args) => createProviderQueryHandle(this, 'eventWall', args),
      createEvent: createProviderMutation(this, 'createEvent'),
      rsvp: createProviderMutation(this, 'rsvp'),
      postMessage: createProviderMutation(this, 'postMessage'),
    };
  }

  transportEvidence() {
    return this.#transportEvents.map((event) => ({ ...event }));
  }

  async dispose() {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const dispose of [...this.#subscriptions]) dispose();
    this.#transportEvents.push({ event: 'provider-disposing', transport: 'push', pollFallbackEnabled: false, client: 'convex/browser' });
    await this.#client.close();
    this.#transportEvents.push({ event: 'provider-closed', transport: 'push', pollFallbackEnabled: false, client: 'convex/browser' });
  }
}

function serializeError(error: unknown) {
  return error instanceof Error
    ? { message: error.message, name: error.name, stack: error.stack }
    : { message: String(error) };
}
