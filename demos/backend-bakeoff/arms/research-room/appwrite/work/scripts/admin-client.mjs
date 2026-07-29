import { readFile, writeFile } from "node:fs/promises";
import {
  Client,
  Functions,
  Permission,
  Query,
  Role,
  Storage,
  TablesDB,
  Teams,
  Users,
} from "node-appwrite";
import { databaseId, endpoint, projectId, runtimeFile } from "./constants.mjs";

export { databaseId, endpoint, projectId, Permission, Query, Role };
export const runtime = JSON.parse(await readFile(runtimeFile, "utf8"));
if (!runtime.apiKey) throw new Error("Appwrite runtime API key is missing");
export const client = new Client()
  .setEndpoint(endpoint)
  .setProject(projectId)
  .setKey(runtime.apiKey);
export const users = new Users(client);
export const teamsApi = new Teams(client);
export const tables = new TablesDB(client);
export const storage = new Storage(client);
export const functions = new Functions(client);
export const tableIds = {
  rooms: "rooms",
  memberships: "room_members",
  sources: "sources",
  questions: "questions",
  answers: "answers",
  progress: "answer_progress",
  refreshRuns: "refresh_runs",
  outcomes: "outcome_fixtures",
};
export const bucketId = "research-sources";
export const memberTeamId = "research-members";
export const functionId = "research-worker-v2";

export const memberRead = [
  Permission.read(Role.user("alice")),
  Permission.read(Role.user("bob")),
];
export const ownerWrite = [
  ...memberRead,
  Permission.update(Role.user("alice")),
  Permission.delete(Role.user("alice")),
];

export async function saveRuntime() {
  await writeFile(runtimeFile, `${JSON.stringify(runtime, null, 2)}\n`, { mode: 0o600 });
}

export async function allRows(tableId, queries = []) {
  return (await tables.listRows({
    databaseId,
    tableId,
    queries: [...queries, Query.limit(500)],
    total: true,
  })).rows;
}

export async function actorClient(name) {
  const session = await users.createSession({ userId: name });
  const actor = new Client()
    .setEndpoint(endpoint)
    .setProject(projectId)
    .setSession(session.secret);
  return {
    client: actor,
    tables: new TablesDB(actor),
    storage: new Storage(actor),
    functions: new Functions(actor),
    sessionId: session.$id,
    sessionSecret: session.secret,
    userId: name,
  };
}
