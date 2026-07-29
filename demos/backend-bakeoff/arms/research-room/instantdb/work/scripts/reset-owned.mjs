import { adminDb, sha256, target, tx } from "./lib.mjs";

const targetConfig = await target();
if (
  targetConfig.title !== "llp0102-research-instantdb-w3-a1" ||
  sha256(targetConfig.appId) !== "2d8f64c5302204bb852a49b4308ffae281feb2714627504378453b2c1433e61a"
) {
  throw new Error("STOP: exact target identity guard failed before reset.");
}
const db = await adminDb();
const inventory = await db.query({
  effectAttempts: {}, answers: {}, progress: {}, questions: {},
  sources: {}, rooms: {}, profiles: {}, $files: {}, $users: {},
});
for (const namespace of ["effectAttempts", "answers", "progress", "questions", "sources", "$files", "rooms", "profiles"]) {
  const rows = inventory[namespace] ?? [];
  for (let i = 0; i < rows.length; i += 100) {
    await db.transact(rows.slice(i, i + 100).map((row) => tx[namespace][row.id].delete()));
  }
}
for (const user of inventory.$users ?? []) await db.auth.deleteUser({ id: user.id });
process.stdout.write(JSON.stringify({
  ok: true,
  deletedCounts: Object.fromEntries(Object.entries(inventory).map(([k, v]) => [k, v.length])),
}) + "\n");
