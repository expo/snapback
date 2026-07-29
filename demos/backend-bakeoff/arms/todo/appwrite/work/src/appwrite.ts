import { Account, Client, Realtime, TablesDB } from "appwrite";

export const endpoint =
  import.meta.env.VITE_APPWRITE_ENDPOINT ?? "http://127.0.0.1:8090/v1";
export const projectId =
  import.meta.env.VITE_APPWRITE_PROJECT_ID ?? "llp0102-todo-appwrite";
export const databaseId = "todo";
export const listsTableId = "lists";
export const tasksTableId = "tasks";

export const client = new Client().setEndpoint(endpoint).setProject(projectId);
export const account = new Account(client);
export const tables = new TablesDB(client);
export const realtime = new Realtime(client);
