import test from "node:test";
import assert from "node:assert/strict";
import { matrixEntries } from "./arm-matrix.mjs";

const providers = ["snapback", "convex", "supabase", "firebase", "instantdb", "spacetimedb", "appwrite"];
const order = {
  orders: {
    todo: ["spacetimedb", "convex", "instantdb", "firebase", "supabase", "snapback", "appwrite"],
    chat: ["appwrite", "firebase", "convex", "supabase", "snapback", "instantdb", "spacetimedb"],
    linear: ["spacetimedb", "firebase", "supabase", "snapback", "convex", "appwrite", "instantdb"],
    partiful: ["supabase", "firebase", "spacetimedb", "appwrite", "snapback", "convex", "instantdb"],
    "research-room": ["snapback", "supabase", "firebase", "spacetimedb", "convex", "appwrite", "instantdb"],
  },
};

test("materializes exactly 35 uniquely identified arms in frozen order", () => {
  const entries = matrixEntries(order);
  assert.equal(entries.length, 35);
  assert.equal(new Set(entries.map((entry) => `${entry.app}/${entry.provider}`)).size, 35);
  assert.deepEqual(entries[0], {
    app: "todo",
    provider: "spacetimedb",
    round: "calibration",
    orderIndex: 1,
    attemptId: "todo-spacetimedb-calibration-01",
  });
  for (const app of Object.keys(order.orders)) {
    assert.deepEqual(
      entries.filter((entry) => entry.app === app).map((entry) => entry.provider).sort(),
      [...providers].sort(),
    );
  }
});
