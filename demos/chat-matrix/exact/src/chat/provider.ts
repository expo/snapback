import {
  createProviderMutation,
  createProviderQueryHandle,
  type ContractDataManifest,
  type ContractDataProvider,
  type DataMutationCorrelation,
  type DataObserver,
} from '@exact/contract/runtime';

export type Backend = 'snapback' | 'supabase' | 'convex' | 'sqlite';

// The chat provider is deliberately stateful: Contract actions cannot consume
// a mutation's return value into component state, so "which conversation am I
// in" lives here. `send` lazily creates the conversation with the currently
// selected model; `setModel`/`newConversation` reset it. The chatInfo query
// projects that provider state so the view can render it declaratively.

const queryDescriptor = (name: string, pollCadenceMs: number) => ({
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
  pollCadenceMs,
  coalesce: false,
  ephemeral: false,
  receipts: 'mutation' as const,
  transport: 'poll' as const,
});

const manifest: ContractDataManifest = {
  manifestVersion: 2,
  provider: 'chat-matrix-gateway',
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
    messages: queryDescriptor('messages', 600),
    chatInfo: queryDescriptor('chatInfo', 600),
    models: queryDescriptor('models', 600_000),
  },
  mutations: {
    send: { name: 'send', args: {}, writes: ['messages', 'conversations'], optimistic: false, serverRunnable: true },
    newConversation: { name: 'newConversation', args: {}, writes: ['conversations'], optimistic: false, serverRunnable: true },
    setModel: { name: 'setModel', args: {}, writes: ['conversations'], optimistic: false, serverRunnable: true },
  },
};

const FEATURED_FALLBACK = ['anthropic/claude-haiku-4.5', 'anthropic/claude-sonnet-4.5', 'openai/gpt-5-mini'];

export class ChatContractProvider implements ContractDataProvider {
  readonly manifest = manifest;
  readonly #backend: Backend;
  readonly #origin: string;
  readonly #timers = new Set<ReturnType<typeof setTimeout>>();
  #conversationId: string | null = null;
  #model = 'anthropic/claude-haiku-4.5';

  constructor(backend: Backend, origin: string) {
    this.#backend = backend;
    this.#origin = origin.replace(/\/$/, '');
  }

  async #rpc<T>(op: string, args: Record<string, unknown> = {}): Promise<T> {
    const response = await fetch(`${this.#origin}/rpc`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ backend: this.#backend, op, args }),
    });
    const payload = (await response.json()) as { ok: boolean; value?: T; error?: string };
    if (!response.ok || !payload.ok) throw new Error(payload.error || `${this.#backend} ${op} failed`);
    return payload.value as T;
  }

  async #runQuery(queryName: string): Promise<unknown[]> {
    if (queryName === 'messages') {
      if (!this.#conversationId) return [];
      return this.#rpc('listMessages', { conversationId: this.#conversationId });
    }
    if (queryName === 'chatInfo') {
      return [{
        _id: 'info',
        backend: this.#backend,
        model: this.#model,
        conversationId: this.#conversationId ?? '',
      }];
    }
    if (queryName === 'models') {
      try {
        const response = await fetch(`${this.#origin}/models`);
        const catalog = (await response.json()) as { featured: string[] };
        return catalog.featured.map((id) => ({ _id: id, id }));
      } catch {
        return FEATURED_FALLBACK.map((id) => ({ _id: id, id }));
      }
    }
    throw new Error(`unknown query: ${queryName}`);
  }

  subscribe<T>(queryName: string, _args: Record<string, unknown>, observer: DataObserver<T>) {
    let disposed = false;
    let previous: T | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cadence = manifest.queries[queryName]?.pollCadenceMs ?? 1000;
    observer({ status: 'pending', connection: 'connecting' });
    const poll = async () => {
      if (timer !== undefined) this.#timers.delete(timer);
      try {
        const value = (await this.#runQuery(queryName)) as T;
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
          timer = globalThis.setTimeout(poll, cadence);
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

  async mutate<T>(mutationName: string, args: Record<string, unknown>, _correlation?: DataMutationCorrelation) {
    try {
      if (mutationName === 'send') {
        const content = String(args.content ?? '').trim();
        if (content.length === 0) return { ok: true as const, value: null as T };
        if (!this.#conversationId) {
          this.#conversationId = await this.#rpc<string>('createConversation', {
            model: this.#model,
            title: content.length <= 40 ? content : `${content.slice(0, 39)}…`,
          });
        }
        const value = await this.#rpc<T>('sendMessage', { conversationId: this.#conversationId, content });
        return { ok: true as const, value };
      }
      if (mutationName === 'newConversation') {
        this.#conversationId = null;
        return { ok: true as const, value: null as T };
      }
      if (mutationName === 'setModel') {
        this.#model = String(args.model ?? this.#model);
        this.#conversationId = null;
        return { ok: true as const, value: null as T };
      }
      throw new Error(`unknown mutation: ${mutationName}`);
    } catch (error) {
      return {
        ok: false as const,
        error: { message: error instanceof Error ? error.message : String(error) },
      };
    }
  }

  links() {
    return {
      messages: (args: Record<string, unknown>) => createProviderQueryHandle(this, 'messages', args),
      chatInfo: (args: Record<string, unknown>) => createProviderQueryHandle(this, 'chatInfo', args),
      models: (args: Record<string, unknown>) => createProviderQueryHandle(this, 'models', args),
      send: createProviderMutation(this, 'send'),
      newConversation: createProviderMutation(this, 'newConversation'),
      setModel: createProviderMutation(this, 'setModel'),
    };
  }

  dispose() {
    for (const timer of this.#timers) globalThis.clearTimeout(timer);
    this.#timers.clear();
  }
}
