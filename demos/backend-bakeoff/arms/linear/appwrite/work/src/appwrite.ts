import { Account, Channel, Client, Query, Realtime, TablesDB } from "appwrite";

export const endpoint = "http://127.0.0.1:8091/v1";
export const projectId = "llp0102-linear-appwrite-w2";
export const databaseId = "linear";
export const client = new Client().setEndpoint(endpoint).setProject(projectId);
export const account = new Account(client);
export const tables = new TablesDB(client);
export const realtime = new Realtime(client);
export const issueChannel = Channel.tablesdb(databaseId).table("issues").row();
export { Channel, Query };
