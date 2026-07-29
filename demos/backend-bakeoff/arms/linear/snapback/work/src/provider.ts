import { createExternalSessionClient } from '../../../../../../../packages/snapback-client/online.mjs';
import api from '../snapback/generated/api.mjs';

export type Persona = {
  id: 'alice' | 'bob' | 'mallory';
  name: string;
  userId: string;
  bearerToken: string;
};

export type PersonaRuntime = {
  baseUrl: string;
  primaryOrganizationId: string;
  personas: Persona[];
};

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
      clientStoreId: `llp0102-linear-${persona.id}`,
    });
    clients.set(persona.id, client);
  }
  return client;
}

export async function subscribeIssues(
  persona: Persona,
  organizationId: string,
  onUpdate: (rows: any[], connection: string) => void,
) {
  const client = await clientFor(persona);
  const handle = await client.liveQuery(api.listIssues, {
    args: { organizationId },
    transport: 'stream',
    fallbackToPoll: false,
    connectionId: `llp0102-linear-ui-${persona.id}-${connectionSequence += 1}`,
    onUpdate(rows: any[]) { onUpdate([...rows], 'live'); },
    onConnectionChange(connection: string) { onUpdate([...handle.rows], connection); },
  });
  onUpdate([...handle.rows], handle.connection);
  return handle;
}

export async function updateIssue(persona: Persona, id: string, values: Record<string, unknown>) {
  const client = await clientFor(persona);
  return await client.mutate(api.updateIssue, { args: { id, ...values } });
}
