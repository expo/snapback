import { Directory, File, Paths } from "expo-file-system";
import { expoSqliteDriver } from "snapback2/expo";
import type { AssetRecord, OutboxEntry, RangeStore, StoreSwap } from "snapback2/client";

export const DATABASE = "snapback2-witness.db";
export interface Configuration { offline: boolean; fault: "carrier" | "none"; name: string; once: string[]; assets: AssetRecord[] }
const configFile = () => new File(Paths.document, "snapback2-witness.json");
export async function configuration(): Promise<Configuration> {
  const file = configFile();
  return file.exists ? JSON.parse(await file.text()) : { offline: false, fault: "none", name: "alice", once: [], assets: [] };
}
export async function persist(patch: Partial<Configuration>): Promise<void> {
  configFile().write(JSON.stringify({ ...await configuration(), ...patch }));
}
export function listFiles(directory = new Directory(Paths.cache, "snapback2")): string[] {
  if (!directory.exists) return [];
  return directory.list().flatMap((item) => item instanceof Directory ? listFiles(item) : [item.uri]);
}
export async function databaseState(): Promise<Record<string, unknown>> {
  const driver = expoSqliteDriver(DATABASE);
  const result: Record<string, unknown> = {};
  try {
    for (const table of ["state", "rows", "answers", "outbox", "bytes"]) {
      const rows = await driver.all<Record<string, unknown>>(`SELECT * FROM ${table} ORDER BY partition${table === "state" ? "" : ", key"}`);
      result[table] = rows.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) =>
        [key, value instanceof Uint8Array ? Array.from(value) : value])));
    }
    return result;
  } finally { await driver.close(); }
}
const markerId = "s2id-eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee-0000000000000001";
/** A dev-only swap touching every persisted projection with distinct pre/post markers. */
export async function markerSwap(store: RangeStore, phase: "pre" | "post", entries: OutboxEntry[]): Promise<void> {
  if (!entries[0]) throw new Error("enqueue both messages before the atomicity marker");
  const byte = phase === "pre" ? 11 : 22;
  const swap: StoreSwap = {
    // The markers are schema-valid rows of real tables: the twin hydrates every held row
    // through the schema and treats a row of an unknown table as corruption (`hydrating`),
    // which is the fail-closed answer the spec wants — so a witness marker must look like
    // the app's own data. A messages row in a conversation no member ever opens.
    deliveries: [{ op: "deliveries.thread", args: { conversationId: "witness-marker", c: null }, seq: phase === "pre" ? 1 : 2, state: "complete", next: null,
      data: { $row: { table: "messages", id: "witness-marker" } },
      rows: [{ table: "messages", id: "witness-marker", row: { id: "witness-marker", conversationId: "witness-marker", authorId: "witness", body: phase, photo: { id: markerId, width: 1, height: 1 }, at: 1 } }],
      receipt: { ranges: [], absences: [], verdicts: [] } }],
    outbox: { put: [{ ...entries[0], intent: "__witness", state: "committed", op: "deliveries.post", args: { conversationId: "witness-marker", body: phase }, predicted: false }] },
    bytes: { put: [{ assetId: markerId, width: null, type: `witness/${phase}`, bytes: new Uint8Array([byte]) }] },
  };
  await store.commit(swap);
}
