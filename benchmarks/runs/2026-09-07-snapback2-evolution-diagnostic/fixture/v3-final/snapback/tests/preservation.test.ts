import { api } from "snapback2/client";
import { journey } from "snapback2/test";
journey("populated private rows and rejected write survive", async ({ as }) => {
  const alice = as("alice"), bob = as("bob");
  const before = await alice.query(api.records.listMessages, {});
  if (before.state !== "complete" || before.data.length !== 8) throw new Error("alice fixture mismatch");
  const other = await bob.query(api.records.listMessages, {});
  if (other.state !== "complete" || other.data.length !== 4) throw new Error("bob fixture mismatch");
  const rejected = await bob.mutation(api.records.send, {roomId: "room-1", body: "must refuse"});
  if (rejected.state !== "rejected") throw new Error("foreign room accepted");
  const after = await alice.query(api.records.listMessages, {});
  if (after.state !== "complete") throw new Error("after query incomplete");
  if (JSON.stringify(after.data) !== JSON.stringify(before.data)) throw new Error("rejection changed rows");
});
