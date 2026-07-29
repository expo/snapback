import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  databaseId,
  tables,
  teamsApi,
  users,
} from "./admin-client.mjs";
import { projectId, receiptsRoot } from "./constants.mjs";

if (projectId !== "llp0102-linear-appwrite-w2") {
  throw new Error(`Refusing reset for unexpected project ${projectId}`);
}
const before = {
  users: (await users.list({ total: true })).users.map((item) => item.$id),
  teams: (await teamsApi.list({ total: true })).teams.map((item) => item.$id),
  databases: (await tables.list({ total: true })).databases.map((item) => item.$id),
};
for (const id of before.databases) await tables.delete({ databaseId: id });
for (const id of before.teams) await teamsApi.delete({ teamId: id });
for (const id of before.users) await users.delete({ userId: id });
const after = {
  users: (await users.list({ total: true })).total,
  teams: (await teamsApi.list({ total: true })).total,
  databases: (await tables.list({ total: true })).total,
};
if (Object.values(after).some((count) => count !== 0)) {
  throw new Error(`Scoped reset incomplete: ${JSON.stringify(after)}`);
}
await mkdir(receiptsRoot, { recursive: true });
await writeFile(path.resolve(receiptsRoot, "failed-attempts.v1.json"), `${JSON.stringify({
  schemaVersion: 1,
  attempts: [
    {
      sequence: 1,
      command: "npm run install:stack",
      exitStatus: 1,
      classification: "installer-stream-error",
      diagnostic: "Official installer SSE transport terminated after the 1.9.6 Compose stack reached healthy.",
      targetMutation: true,
      stopClass: false,
      resolution: "Direct health and exact Compose labels proved the official stack ready; continued without replaying installation.",
    },
    {
      sequence: 2,
      command: "npm run provision",
      exitStatus: 1,
      classification: "provider-learning",
      diagnostic: "index_invalid: Creating indexes on array attributes is not currently supported.",
      targetMutation: true,
      stopClass: false,
      resolution: "Replaced the label-array index with an indexed issue_labels junction table and reset only the fresh arm project.",
    },
  ],
  scopedReset: { projectId, before, after },
}, null, 2)}\n`);
console.log(JSON.stringify({ ok: true, projectId, beforeCounts: Object.fromEntries(
  Object.entries(before).map(([key, values]) => [key, values.length]),
), after }));
