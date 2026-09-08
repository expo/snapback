import { api } from "snapback2/client";
import { journey } from "snapback2/test";
journey("published row types", async ({ as }) => {
  const alice = as("alice");
  const added = await alice.mutation(api.todos.add, { title: "Published type proof" });
  if (added.state !== "committed") throw new Error(`add was ${added.state}`);
  if (added.data.row.done !== false || added.data.row.title !== "Published type proof") throw new Error("insert row response mismatch");
  const merged = await alice.query(api.todos.merged, {});
  if (merged.state !== "complete" && merged.state !== "capped") throw new Error("merged rows incomplete");
  if (!merged.data.some(row => row.title === "Published type proof" && row.done === false)) throw new Error("merged row missing");
});
