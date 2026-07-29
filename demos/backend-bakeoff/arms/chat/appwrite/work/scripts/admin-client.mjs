import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  Client,
  Permission,
  Presences,
  Query,
  Role,
  TablesDB,
  Teams,
  Users,
} from "node-appwrite";

export const endpoint = "http://127.0.0.1:8090/v1";
export const projectId = "llp0102-chat-appwrite";
export const databaseId = "chat";
export const channelsTableId = "channels";
export const publicMessagesTableId = "public_messages";
export const privateMessagesTableId = "private_messages";
export const unreadTableId = "unread";
export const privateTeamId = "private-channels";
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
export const presences = new Presences(client);
export const publicRead = [Permission.read(Role.users())];
export const privateRead = [Permission.read(Role.team(privateTeamId))];

export async function saveRuntime() {
  await writeFile(runtimePath, `${JSON.stringify(runtime, null, 2)}\n`, {
    mode: 0o600,
  });
}

export async function allRows(tableId, queries = []) {
  return (await tables.listRows({
    databaseId,
    tableId,
    queries: [...queries, Query.limit(500)],
    total: true,
  })).rows;
}
