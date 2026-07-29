import { readFile, writeFile } from "node:fs/promises";
import {
  Client,
  Permission,
  Query,
  Role,
  TablesDB,
  Teams,
  Users,
} from "node-appwrite";
import {
  databaseId,
  endpoint,
  projectId,
  runtimeFile,
} from "./constants.mjs";

export { databaseId, endpoint, projectId };
export const runtime = JSON.parse(await readFile(runtimeFile, "utf8"));
if (!runtime.apiKey) throw new Error("Appwrite runtime API key is missing");
export const client = new Client()
  .setEndpoint(endpoint)
  .setProject(projectId)
  .setKey(runtime.apiKey);
export const users = new Users(client);
export const teamsApi = new Teams(client);
export const tables = new TablesDB(client);
export const tableIds = {
  organizations: "organizations",
  teams: "teams",
  projects: "projects",
  members: "members",
  labels: "labels",
  issueLabels: "issue_labels",
  issues: "issues",
  comments: "comments",
  activities: "activities",
};
export const primaryTeamId = "org-primary";
export const secondaryTeamId = "org-secondary";
export const primaryRead = [Permission.read(Role.team(primaryTeamId))];
export const primaryWrite = [
  Permission.read(Role.team(primaryTeamId)),
  Permission.update(Role.team(primaryTeamId)),
  Permission.delete(Role.team(primaryTeamId, "owner")),
];
export const ownerWrite = [
  Permission.read(Role.team(primaryTeamId)),
  Permission.update(Role.team(primaryTeamId, "owner")),
  Permission.delete(Role.team(primaryTeamId, "owner")),
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
    sessionId: session.$id,
    userId: name,
  };
}
