// The browser consumes generated references and the shipped React external
// store. Session bearers are written only to an ignored local runtime file.

import { createExternalSessionClient } from '../../../../../../../packages/snapback-client/online.mjs';
import api from '../snapback/generated/api.mjs';

export type Persona = {
  id: 'alice' | 'bob' | 'mallory';
  name: string;
  userId: string;
  bearerToken: string;
};

type PersonaRuntime = {
  baseUrl: string;
  primaryWorkspaceId: string;
  personas: Persona[];
};

type Delivery = {
  kind: 'authoritative' | 'connection' | 'error';
  error?: unknown;
};

type Connection = 'connecting' | 'live' | 'polling' | 'stale' | 'disconnected';

let runtimePromise: Promise<PersonaRuntime> | null = null;
const clients = new Map<string, any>();
let connectionSequence = 0;

export function loadRuntime(): Promise<PersonaRuntime> {
  runtimePromise ??= fetch('/personas.json', { cache: 'no-store' }).then(async (response) => {
    if (!response.ok) throw new Error(`persona runtime unavailable (${response.status})`);
    return response.json();
  });
  return runtimePromise;
}

async function clientFor(persona: Persona) {
  const runtime = await loadRuntime();
  let client = clients.get(persona.id);
  if (!client) {
    client = createExternalSessionClient(runtime.baseUrl, {
      bearerToken: persona.bearerToken,
      clientStoreId: `llp0102-todo-${persona.id}`,
    });
    clients.set(persona.id, client);
  }
  return client;
}

async function personaFor(id: string | undefined) {
  const runtime = await loadRuntime();
  const persona = runtime.personas.find((item) => item.id === id);
  if (!persona) throw new Error(`unknown persona ${id}`);
  return persona;
}

export const snapbackProvider = {
  backend: 'snapback-todo-calibration',
  externalStoreProtocol: 'snapback.external-store.v1' as const,
  async subscribe<Row>(
    name: string,
    args: Record<string, unknown>,
    personaId: string | undefined,
    observer: (rows: Row[], connection: Connection, delivery?: Delivery) => void,
  ) {
    const persona = await personaFor(personaId);
    const client = await clientFor(persona);
    const reference = (api as Record<string, unknown>)[name];
    if (!reference) throw new Error(`unknown generated query ${name}`);
    let rows: Row[] = [];
    const handle = await client.liveQuery(reference, {
      args,
      transport: 'stream',
      fallbackToPoll: false,
      connectionId: `llp0102_todo_${persona.id}_${connectionSequence += 1}`,
      onUpdate(next: Row[]) {
        rows = [...next];
        observer(rows, 'live', { kind: 'authoritative' });
      },
      onConnectionChange(connection: string, detail: { error?: unknown }) {
        observer(
          rows,
          connection as Connection,
          detail?.error
            ? { kind: 'error', error: detail.error }
            : { kind: 'connection' },
        );
      },
    });
    rows = [...handle.rows];
    observer(rows, handle.connection as Connection, { kind: 'authoritative' });
    return { rows, dispose: () => handle.dispose() };
  },
  async mutate<Result>(
    name: string,
    args: Record<string, unknown>,
    personaId: string | undefined,
  ): Promise<Result> {
    const persona = await personaFor(personaId);
    const client = await clientFor(persona);
    const reference = (api as Record<string, unknown>)[name];
    if (!reference) throw new Error(`unknown generated mutation ${name}`);
    const response = await client.mutate(reference, { args });
    return response.result as Result;
  },
  async logout(personaId: string) {
    const persona = await personaFor(personaId);
    const client = await clientFor(persona);
    await client.replaceBearerToken(null);
  },
};
