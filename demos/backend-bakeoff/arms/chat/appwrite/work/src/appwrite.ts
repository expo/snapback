import { Account, Client, Presences, Realtime, TablesDB } from "appwrite";

export const endpoint =
  import.meta.env.VITE_APPWRITE_ENDPOINT ?? "http://127.0.0.1:8090/v1";
export const projectId =
  import.meta.env.VITE_APPWRITE_PROJECT_ID ?? "llp0102-chat-appwrite";
export const databaseId = "chat";
export const channelsTableId = "channels";
export const publicMessagesTableId = "public_messages";
export const privateMessagesTableId = "private_messages";
export const unreadTableId = "unread";
export const privateTeamId = "private-channels";

export const client = new Client().setEndpoint(endpoint).setProject(projectId);
export const account = new Account(client);
export const tables = new TablesDB(client);
export const presences = new Presences(client);
export const realtime = new Realtime(client);
