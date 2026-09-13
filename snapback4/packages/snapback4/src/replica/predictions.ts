// The confirmed base survives underneath ordered, reversible predictions.
// Before-images include derived rows and deletes, and share the outbox's
// transaction. Rebase restores the base, applies authority, then replays.
import { Interpreter, type Context, type ProgramJson } from "./interpreter.ts";
import type { Row, SchemaJson, StoreTx } from "./store.ts";

type Image = { table: string; id: string; row: Row | null };

export async function restoreConfirmed(tx: StoreTx, schema?: SchemaJson): Promise<void> {
  for (const { value } of await tx.side("predicted").all()) {
    const image = value as Image;
    if (schema && !schema.tables[image.table]) continue;
    if (image.row) await tx.put(image.table, image.row);
    else await tx.delete(image.table, image.id);
  }
  await tx.side("predicted").clear();
}

export async function predict(tx: StoreTx, schema: SchemaJson, program: ProgramJson, context: Context): Promise<string[]> {
  const before = new Map<string, Image>();
  const added = new Set<string>();
  const remember = async (table: string, id: string) => {
    const key = JSON.stringify([table, id]);
    if (before.has(key)) return;
    const image: Image = { table, id, row: await tx.get(table, id) ?? null };
    before.set(key, image);
    if (await tx.side("predicted").get(key) === undefined) {
      await tx.side("predicted").put(key, image);
      added.add(key);
    }
  };
  const predicting: StoreTx = {
    ...tx,
    async put(table, row) { await remember(table, row.id); await tx.put(table, row); },
    async delete(table, id) { await remember(table, id); await tx.delete(table, id); },
  };
  try {
    await new Interpreter(predicting, schema, context, "mutation").run(program);
    return [...before.values()].map(({ table, id }) => `${table}/${id}`);
  } catch (error) {
    // A later queued prediction can become ineligible after rebase. Undo
    // just that attempt while preserving earlier predictions and the base.
    for (const image of [...before.values()].reverse()) {
      if (image.row) await tx.put(image.table, image.row);
      else await tx.delete(image.table, image.id);
    }
    for (const key of added) await tx.side("predicted").delete(key);
    throw error;
  }
}
