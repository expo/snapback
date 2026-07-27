import type { SnapbackReactProvider } from '../../../../../packages/snapback-react/index.mjs';
import type { ExternalConnection } from '../../../../../packages/snapback-client/external-store.mjs';

import { SnapbackClient } from '../../../../../packages/snapback-client/index.mjs';
import runtimeApi from '../../../snapback/generated/api.mjs';
import type { GeneratedApi } from '../../../snapback/generated/api';

const api = runtimeApi as GeneratedApi;
type ApiName = Exclude<keyof typeof api, 'ephemeral'>;
type Delivery = { kind: 'authoritative' | 'connection' | 'error'; error?: unknown };
type LiveHandle<Row> = {
  rows: Row[];
  connection: ExternalConnection;
  dispose(): void;
};
type TeamChatClient = {
  health(): Promise<unknown>;
  ensureApp(options: { schema: unknown; functions: unknown }): Promise<unknown>;
  liveQuery<Row>(
    reference: unknown,
    options: {
      args: Record<string, unknown>;
      userId: string | undefined;
      transport: 'stream';
      fallbackToPoll: false;
      connectionId: string;
      onUpdate(rows: Row[]): void;
      onConnectionChange(connection: string, detail: { error?: unknown }): void;
    },
  ): Promise<LiveHandle<Row>>;
  mutate<Result>(
    reference: unknown,
    options: { args: Record<string, unknown>; userId: string | undefined },
  ): Promise<{ result: Result }>;
};

declare const __SNAPBACK_API_ORIGIN__: string;

const client = new SnapbackClient(__SNAPBACK_API_ORIGIN__) as unknown as TeamChatClient;
let connectionSequence = 0;

// @ref LLP 0063#workstream-2--first-class-react-expo-and-vanilla-projections
// — the app consumes generated references through the shared external-store
// lifecycle; component-local effect/subscription caches are not a second data
// layer.
export const teamChatProvider: SnapbackReactProvider = {
  backend: 'snapback-team-chat-react',
  externalStoreProtocol: 'snapback.external-store.v1',
  async subscribe<Row>(
    name: string,
    args: Record<string, unknown>,
    userId: string | undefined,
    observer: (rows: Row[], connection: ExternalConnection, delivery?: Delivery) => void,
  ) {
    const reference = api[name as ApiName];
    if (!reference || reference === api.ephemeral) {
      throw new Error(`unknown generated query ${name}`);
    }
    let rows: Row[] = [];
    const handle = await client.liveQuery<Row>(reference as never, {
      args,
      userId,
      transport: 'stream',
      fallbackToPoll: false,
      connectionId: `team_chat_react_${connectionSequence += 1}`,
      onUpdate(next: Row[]) {
        rows = [...next];
        observer(rows, 'live', { kind: 'authoritative' });
      },
      onConnectionChange(connection: string, detail: { error?: unknown }) {
        observer(
          rows,
          connection as ExternalConnection,
          detail?.error ? { kind: 'error', error: detail.error } : { kind: 'connection' },
        );
      },
    });
    rows = [...handle.rows];
    observer(rows, handle.connection as ExternalConnection, { kind: 'authoritative' });
    return {
      rows,
      dispose: () => (handle as LiveHandle<Row>).dispose(),
    };
  },
  async mutate<Result>(
    name: string,
    args: Record<string, unknown>,
    userId: string | undefined,
  ) {
    const reference = api[name as ApiName];
    if (!reference || reference === api.ephemeral) {
      throw new Error(`unknown generated mutation ${name}`);
    }
    const result = await client.mutate<Result>(reference, { args, userId });
    return result.result;
  },
};

export { client as teamChatClient };
