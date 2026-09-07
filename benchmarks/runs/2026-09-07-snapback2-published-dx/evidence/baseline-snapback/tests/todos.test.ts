import { api } from "snapback2/client";
import { journey } from "snapback2/test";

journey("todos round trip", async ({ as }) => {
  const alice = as("alice");
  const before = await alice.query(api.todos.list, {});
  const rows = "data" in before ? before.data : undefined;
  if (!rows?.some((row: { id?: string }) => row.id === "todo-1")) throw new Error("seed todo was not readable");
  const added = await alice.mutation(api.todos.add, {
    title: "Write a journey",
  });
  if (added.state !== "committed") throw new Error(`add was ${added.state}`);
});
