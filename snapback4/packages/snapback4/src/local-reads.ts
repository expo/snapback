import type { Query } from "./contract.ts";
import { ReadObservation } from "./read-observation.ts";
import type { BackendJson, ProgramJson, SchemaJson } from "./backend.ts";

export function followingReads(schema: SchemaJson, tables: Set<string>, program?: ProgramJson) {
  const sources = schema.timelines?.flatMap(t => [t.posts[0], t.reposts[0]]) ?? [];
  const online = new Set(sources.filter(name => !schema.tables[name]?.sync));
  const pointRead = (value: unknown): boolean => {
    if (!value || typeof value !== "object") return false;
    return Object.entries(value).some(([kind, child]) =>
      (["Get", "Exists"].includes(kind) && online.has((child as { table?: string })?.table ?? "")) || pointRead(child));
  };
  return {
    following: sources.some(name => tables.has(name)) || !!schema.timelines?.some(t => tables.has(`${t.name}Feed`)),
    remoteCard: online.size > 0 && pointRead(program?.body),
  };
}

// @ref LLP 3000.016#2.2 — one precedence before server-run and remembered-answer shortcuts.
export async function routeWithheld<R>(online: boolean, held: boolean, pending: () => Promise<boolean>, withheld: R, server: () => Promise<R>): Promise<R> {
  if (!online || await pending() || held) return withheld;
  return server();
}

export function runsOnServer(backend: BackendJson, op: Query<unknown, unknown>, nativeReady: boolean): boolean {
  const program = backend.programs.find(program => program.name === op.name);
  if (program?.native) return !nativeReady;
  return (backend.schema.operations?.[op.name]?.runs ?? program?.runs ?? op.runs) === "server";
}

export function predictedTables(predicted: readonly string[]): Set<string> {
  return new Set(predicted.map(row => row.slice(0, row.lastIndexOf("/"))).filter(Boolean));
}

export interface LocalWatch extends ReadObservation<unknown> {
  op: Query<unknown, unknown>;
  args: unknown;
  key: string;
  tables: Set<string>;
  subscribers: Set<() => void>;
  running: boolean;
  dirty: boolean;
  expiryTimer: ReturnType<typeof setTimeout> | null;
  incarnation: number;
}

/** Every local commit retires retained and remembered answers. */
export class LocalReads {
  revision = 0;

  clear(watches: Iterable<LocalWatch>, remembered: Map<string, unknown>): void {
    this.revision++;
    remembered.clear();
    for (const watch of watches) {
      watch.reset({ loading: true });
      if (watch.expiryTimer) clearTimeout(watch.expiryTimer);
      watch.expiryTimer = null;
    }
  }
}
