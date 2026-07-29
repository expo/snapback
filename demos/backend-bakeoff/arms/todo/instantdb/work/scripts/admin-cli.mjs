#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { init } from "@instantdb/admin";
import schema from "../instant.schema.ts";

const env = Object.fromEntries(
  (await readFile(new URL("../.arm-secrets", import.meta.url), "utf8"))
    .trim()
    .split("\n")
    .map((line) => {
      const split = line.indexOf("=");
      return [line.slice(0, split), line.slice(split + 1)];
    }),
);

const db = init({
  appId: env.VITE_INSTANT_APP_ID,
  adminToken: env.INSTANT_APP_ADMIN_TOKEN,
  apiURI: env.VITE_INSTANT_API_URI,
  schema,
});

function stableId(label) {
  const hex = createHash("sha256")
    .update(`llp0102:todo:instantdb:${label}`)
    .digest("hex")
    .slice(0, 32)
    .split("");
  hex[12] = "4";
  hex[16] = ((Number.parseInt(hex[16], 16) & 3) | 8).toString(16);
  return `${hex.slice(0, 8).join("")}-${hex.slice(8, 12).join("")}-${hex.slice(12, 16).join("")}-${hex.slice(16, 20).join("")}-${hex.slice(20).join("")}`;
}

function principalHash(value) {
  return createHash("sha256").update(value).digest("hex");
}

const workspaceId = stableId("workspace");
const listIds = Array.from({ length: 4 }, (_, index) => stableId(`list:${index}`));
const taskIds = Array.from({ length: 100 }, (_, index) => stableId(`task:${index}`));

async function snapshot() {
  return db.query({
    workspaces: {
      memberships: { user: {} },
      lists: { tasks: {} },
    },
  });
}

async function seedIfNeeded() {
  const before = await snapshot();
  if (before.workspaces.length > 0) return false;

  await db.transact(
    db.tx.workspaces[workspaceId].update({ name: "Primary workspace" }),
  );
  for (let listIndex = 0; listIndex < 4; listIndex += 1) {
    const start = listIndex * 25;
    const order = taskIds.slice(start, start + 25);
    await db.transact(
      db.tx.lists[listIds[listIndex]]
        .update({
          name: ["Inbox", "Bakeoff", "Operations", "Done"][listIndex],
          ordinal: listIndex,
          taskOrder: order,
        })
        .link({ workspace: workspaceId }),
    );
    const chunks = order.map((taskId, index) => {
      const absolute = start + index;
      return db.tx.tasks[taskId]
        .update({
          title: `Task ${String(absolute + 1).padStart(3, "0")}`,
          completed: absolute % 7 === 0,
          assignee: absolute % 2 === 0 ? "Alice" : "Bob",
          dueDate: `2026-08-${String((absolute % 28) + 1).padStart(2, "0")}`,
          seedKey: `seed:${String(absolute).padStart(3, "0")}`,
          revision: 0,
        })
        .link({ list: listIds[listIndex] });
    });
    await db.transact(chunks);
  }
  return true;
}

async function provision(aliceId, bobId) {
  if (!aliceId || !bobId || aliceId === bobId) {
    throw new Error("provision requires two distinct native user IDs");
  }
  const seeded = await seedIfNeeded();
  const current = await snapshot();
  const existing = current.workspaces.flatMap((workspace) => workspace.memberships);
  if (existing.length) {
    await db.transact(existing.map((membership) => db.tx.memberships[membership.id].delete()));
  }
  await db.transact([
    db.tx.memberships[stableId("membership:alice")]
      .update({ persona: "alice" })
      .link({ user: aliceId, workspace: workspaceId }),
    db.tx.memberships[stableId("membership:bob")]
      .update({ persona: "bob" })
      .link({ user: bobId, workspace: workspaceId }),
  ]);
  const after = await snapshot();
  const workspace = after.workspaces[0];
  const lists = workspace?.lists ?? [];
  const tasks = lists.flatMap((list) => list.tasks);
  return {
    seeded,
    workspaceCount: after.workspaces.length,
    membershipCount: workspace?.memberships.length ?? 0,
    listCount: lists.length,
    taskCount: tasks.length,
    uniqueTaskIds: new Set(tasks.map((task) => task.id)).size,
    listOrderLengths: lists
      .sort((a, b) => a.ordinal - b.ordinal)
      .map((list) => Array.isArray(list.taskOrder) ? list.taskOrder.length : -1),
    principalIdHashes: {
      alice: principalHash(aliceId),
      bob: principalHash(bobId),
    },
  };
}

async function summary() {
  const data = await snapshot();
  const workspace = data.workspaces[0];
  const lists = workspace?.lists ?? [];
  const tasks = lists.flatMap((list) => list.tasks);
  return {
    workspaceCount: data.workspaces.length,
    membershipCount: workspace?.memberships.length ?? 0,
    membershipPersonas: (workspace?.memberships ?? []).map((item) => item.persona).sort(),
    listCount: lists.length,
    taskCount: tasks.length,
    uniqueTaskIds: new Set(tasks.map((task) => task.id)).size,
    uniqueSeedKeys: new Set(tasks.map((task) => task.seedKey)).size,
    orderValid: lists.every((list) => {
      const order = Array.isArray(list.taskOrder) ? list.taskOrder : [];
      return order.length === list.tasks.length &&
        new Set(order).size === order.length &&
        list.tasks.every((task) => order.includes(task.id));
    }),
  };
}

async function revoke(persona) {
  const data = await snapshot();
  const membership = data.workspaces
    .flatMap((workspace) => workspace.memberships)
    .find((item) => item.persona === persona);
  if (membership) await db.transact(db.tx.memberships[membership.id].delete());
  return { persona, removed: Boolean(membership) };
}

async function probe(taskId) {
  const data = await db.query({
    tasks: { $: { where: { id: taskId } } },
  });
  const task = data.tasks[0];
  return task ? { title: task.title, revision: task.revision } : null;
}

async function cleanup(prefix) {
  const data = await db.query({ tasks: {} });
  const matches = data.tasks.filter((task) => task.title.startsWith(prefix));
  if (matches.length) {
    await db.transact(matches.map((task) => db.tx.tasks[task.id].delete()));
  }
  return { prefix, removed: matches.length };
}

async function resetOrder() {
  await db.transact(
    listIds.map((listId, index) =>
      db.tx.lists[listId].update({
        taskOrder: taskIds.slice(index * 25, index * 25 + 25),
      }),
    ),
  );
  return { resetLists: listIds.length };
}

const [action, ...args] = process.argv.slice(2);
let result;
if (action === "provision") result = await provision(args[0], args[1]);
else if (action === "summary") result = await summary();
else if (action === "revoke") result = await revoke(args[0]);
else if (action === "probe") result = await probe(args[0]);
else if (action === "cleanup") result = await cleanup(args.join(" "));
else if (action === "reset-order") result = await resetOrder();
else throw new Error(`Unknown action: ${action}`);

process.stdout.write(`${JSON.stringify(result)}\n`);
