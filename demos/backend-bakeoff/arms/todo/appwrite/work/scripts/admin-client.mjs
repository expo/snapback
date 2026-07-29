import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  Client,
  Permission,
  Query,
  Role,
  TablesDB,
  Teams,
  Users,
} from "node-appwrite";

export const endpoint = "http://127.0.0.1:8090/v1";
export const projectId = "llp0102-todo-appwrite";
export const databaseId = "todo";
export const listsTableId = "lists";
export const tasksTableId = "tasks";
export const workspaceTeamId = "workspace-primary";
export const runtimePath = resolve(".arm-runtime/owner.json");

export const runtime = JSON.parse(await readFile(runtimePath, "utf8"));
if (!runtime.apiKey) throw new Error("Appwrite runtime API key is missing");

export const client = new Client()
  .setEndpoint(endpoint)
  .setProject(projectId)
  .setKey(runtime.apiKey);
export const users = new Users(client);
export const teams = new Teams(client);
export const tables = new TablesDB(client);
export const teamPermissions = [
  Permission.read(Role.team(workspaceTeamId)),
  Permission.update(Role.team(workspaceTeamId)),
  Permission.delete(Role.team(workspaceTeamId)),
];

export async function saveRuntime() {
  await writeFile(runtimePath, `${JSON.stringify(runtime, null, 2)}\n`, {
    mode: 0o600,
  });
}

export async function allRows(tableId) {
  return (await tables.listRows({
    databaseId,
    tableId,
    queries: [Query.limit(200)],
    total: true,
  })).rows;
}
