import { SqliteBackend, nodeSqliteDriver, sqliteState, fixtureAsset } from "../dist/sqlite-test.mjs";

const [path, stage] = process.argv.slice(2);
let armed = false;
const backend = new SqliteBackend(nodeSqliteDriver(path), {
  beforeCommit: async () => {
    if (armed && stage === "before") {
      process.send({ reached: "before" });
      await new Promise(() => {});
    }
  },
});
// Keep the process alive at both barriers; the parent owns and kills this exact PID.
setInterval(() => {}, 1000);
await backend.open("kill-partition");
await backend.replace(sqliteState(1), { put: [{ key: fixtureAsset, bytes: new Uint8Array([1, 1, 1]) },
  { key: "old-only", bytes: new Uint8Array([5]) }], remove: [] });
armed = true;
await backend.replace(sqliteState(2), { put: [{ key: fixtureAsset, bytes: new Uint8Array([2, 2, 2]) },
  { key: "new-only", bytes: new Uint8Array([6]) }], remove: ["old-only"] });
process.send({ reached: "after" });
