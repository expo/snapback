import {
  createProviderMutation,
  createProviderQueryHandle,
  type ContractDataManifest,
  type ContractDataProvider,
  type DataMutationCorrelation,
  type DataObserver,
} from '@exact/contract/runtime';

export type Backend = 'snapback' | 'supabase' | 'convex' | 'sqlite';

const descriptor = (name: string) => ({
  name,
  args: {},
  result: { kind: 'list' as const, row: { shape: 'unknown' as const } },
  serverRunnable: true,
  localRunnable: false,
  subscription: 'initial-snapshot' as const,
  mode: 'poll' as const,
  livePush: false,
  initialSnapshot: true,
  defaultLive: true,
  pollCadenceMs: 1000,
  coalesce: false,
  ephemeral: false,
  receipts: 'mutation' as const,
  transport: 'poll' as const,
});

const manifest: ContractDataManifest = {
  manifestVersion: 2,
  provider: 'partitime-apple-gateway',
  capabilities: {
    localReplica: false,
    subscriptions: false,
    initialSnapshot: true,
    optimisticMutations: false,
    rowSyncState: false,
    serverRunnableQueries: true,
    forceStates: false,
    branchableFixtures: false,
    headlessBoot: true,
  },
  queries: {
    listEvents: descriptor('listEvents'),
    eventDetails: descriptor('eventDetails'),
    guestList: descriptor('guestList'),
    eventWall: descriptor('eventWall'),
  },
  mutations: Object.fromEntries(
    ['createEvent', 'rsvp', 'postMessage'].map((name) => [
      name,
      {
        name,
        args: {},
        writes:
          name === 'createEvent'
            ? ['events', 'rsvps']
            : [name === 'rsvp' ? 'rsvps' : 'posts'],
        optimistic: false,
        serverRunnable: true,
      },
    ]),
  ),
};

export class GatewayContractProvider implements ContractDataProvider {
  readonly manifest = manifest;
  readonly #backend: Backend;
  readonly #origin: string;
  readonly #userId: string;
  readonly #timers = new Set<ReturnType<typeof setTimeout>>();

  constructor(backend: Backend, origin: string, userId: string) {
    this.#backend = backend;
    this.#origin = origin.replace(/\/$/, '');
    this.#userId = userId;
  }

  async #call<T>(
    kind: 'query' | 'mutate',
    name: string,
    args: Record<string, unknown>,
  ): Promise<T> {
    const response = await fetch(`${this.#origin}/${kind}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        backend: this.#backend,
        name,
        args,
        userId: this.#userId,
      }),
    });
    const payload = (await response.json()) as {
      ok: boolean;
      value?: T;
      error?: string;
    };
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || `${this.#backend} ${kind} failed`);
    }
    return payload.value as T;
  }

  subscribe<T>(
    queryName: string,
    args: Record<string, unknown>,
    observer: DataObserver<T>,
  ) {
    let disposed = false;
    let previous: T | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    observer({ status: 'pending', connection: 'connecting' });
    const poll = async () => {
      if (timer !== undefined) this.#timers.delete(timer);
      try {
        const value = await this.#call<T>('query', queryName, args);
        previous = value;
        observer({
          status: 'ready',
          value,
          empty: Array.isArray(value) && value.length === 0,
          connection: 'polling',
        });
      } catch (error) {
        observer({
          status: 'error',
          error: { message: error instanceof Error ? error.message : String(error) },
          ...(previous === undefined ? {} : { previous }),
          connection: 'disconnected',
        });
      } finally {
        if (!disposed) {
          timer = globalThis.setTimeout(poll, 1000);
          this.#timers.add(timer);
        }
      }
    };
    void poll();
    return {
      dispose: () => {
        disposed = true;
        if (timer !== undefined) {
          globalThis.clearTimeout(timer);
          this.#timers.delete(timer);
        }
      },
    };
  }

  async mutate<T>(
    mutationName: string,
    args: Record<string, unknown>,
    _correlation?: DataMutationCorrelation,
  ) {
    try {
      return {
        ok: true as const,
        value: await this.#call<T>('mutate', mutationName, args),
      };
    } catch (error) {
      return {
        ok: false as const,
        error: { message: error instanceof Error ? error.message : String(error) },
      };
    }
  }

  links() {
    return {
      listEvents: (args: Record<string, unknown>) =>
        createProviderQueryHandle(this, 'listEvents', args),
      eventDetails: (args: Record<string, unknown>) =>
        createProviderQueryHandle(this, 'eventDetails', args),
      guestList: (args: Record<string, unknown>) =>
        createProviderQueryHandle(this, 'guestList', args),
      eventWall: (args: Record<string, unknown>) =>
        createProviderQueryHandle(this, 'eventWall', args),
      createEvent: createProviderMutation(this, 'createEvent'),
      rsvp: createProviderMutation(this, 'rsvp'),
      postMessage: createProviderMutation(this, 'postMessage'),
    };
  }

  dispose() {
    for (const timer of this.#timers) globalThis.clearTimeout(timer);
    this.#timers.clear();
  }
}
