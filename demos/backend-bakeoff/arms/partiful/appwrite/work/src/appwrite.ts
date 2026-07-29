import { Account, Channel, Client, Query, Realtime, TablesDB } from "appwrite";

export const endpoint = "http://127.0.0.1:8092/v1";
export const projectId = "llp0102-partiful-appwrite-w3";
export const databaseId = "partiful";
export const client = new Client().setEndpoint(endpoint).setProject(projectId);
export const account = new Account(client);
export const tables = new TablesDB(client);
export const realtime = new Realtime(client);
export const databaseChannel = Channel.tablesdb(databaseId);
export const eventChannel = Channel.tablesdb(databaseId).table("events").row();
export const guestChannel = Channel.tablesdb(databaseId).table("guests").row();
export const wallChannel = Channel.tablesdb(databaseId).table("wall_posts").row();
export { Channel, Query };
