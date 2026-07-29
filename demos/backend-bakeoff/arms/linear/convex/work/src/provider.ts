import { ConvexClient } from "convex/browser";
import { api } from "../convex/_generated/api";

export type Runtime = {
  convexUrl: string;
  primaryOrganizationId: string;
  personas: Array<{ id: "alice" | "bob" | "mallory"; name: string; token: string }>;
};

let runtimePromise: Promise<Runtime> | null = null;
const clients = new Map<string, ConvexClient>();

export function loadRuntime() {
  runtimePromise ??= fetch("/personas.json", { cache: "no-store" }).then(async (response) => {
    if (!response.ok) throw new Error(`runtime unavailable (${response.status})`);
    return await response.json() as Runtime;
  });
  return runtimePromise;
}

export async function clientFor(runtime: Runtime, personaId: string) {
  let client = clients.get(personaId);
  if (!client) {
    const persona = runtime.personas.find(({ id }) => id === personaId);
    if (!persona) throw new Error(`unknown persona ${personaId}`);
    client = new ConvexClient(runtime.convexUrl, { logger: false });
    client.setAuth(async () => persona.token);
    clients.set(personaId, client);
  }
  return client;
}

export { api };
