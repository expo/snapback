import {
  Account,
  Channel,
  Client,
  Functions,
  Query,
  Realtime,
  Storage,
  TablesDB,
} from "appwrite";

export const endpoint = "http://127.0.0.1:8093/v1";
export const projectId = "llp0102-research-appwrite-w1";
export const databaseId = "research-room";
export const client = new Client().setEndpoint(endpoint).setProject(projectId);
export const account = new Account(client);
export const tables = new TablesDB(client);
export const storage = new Storage(client);
export const functions = new Functions(client);
export const realtime = new Realtime(client);
export const progressChannel = Channel.tablesdb(databaseId).table("answer_progress").row();
export { Query };
