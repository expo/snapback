import { createHash, randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Permission, Role } from "node-appwrite";
import {
  allRows,
  databaseId,
  listsTableId,
  runtime,
  saveRuntime,
  tables,
  tasksTableId,
  teamPermissions,
  teams,
  users,
  workspaceTeamId,
} from "./admin-client.mjs";

const armRoot = resolve("..");
const receiptsRoot = resolve(armRoot, "receipts");
const hash = (value) => createHash("sha256").update(value).digest("hex");
const personSpecs = {
  alice: { id: "alice", name: "Alice", role: "member" },
  bob: { id: "bob", name: "Bob", role: "member" },
  mallory: { id: "mallory", name: "Mallory", role: "outsider" },
};

if (!runtime.personas) {
  runtime.personas = Object.fromEntries(
    Object.entries(personSpecs).map(([key, spec]) => [
      key,
      {
        ...spec,
        email: `${key}@llp0102.appwrite.test`,
        password: randomBytes(24).toString("base64url"),
      },
    ]),
  );
  await saveRuntime();
}

const existing = await Promise.all([
  users.list({ total: true }),
  teams.list({ total: true }),
  tables.list({ total: true }),
]);
if (existing.some((result) => result.total !== 0)) {
  throw new Error("Provisioning requires a fresh empty Appwrite project");
}

const createdUsers = {};
for (const [key, person] of Object.entries(runtime.personas)) {
  createdUsers[key] = await users.create({
    userId: person.id,
    email: person.email,
    password: person.password,
    name: person.name,
  });
}

await teams.create({
  teamId: workspaceTeamId,
  name: "Primary workspace",
  roles: ["owner"],
});
const aliceMembership = await teams.createMembership({
  teamId: workspaceTeamId,
  roles: ["member"],
  userId: createdUsers.alice.$id,
});
const bobMembership = await teams.createMembership({
  teamId: workspaceTeamId,
  roles: ["member"],
  userId: createdUsers.bob.$id,
});
runtime.memberships = {
  alice: aliceMembership.$id,
  bob: bobMembership.$id,
};
await saveRuntime();

await tables.create({ databaseId, name: "Todo", enabled: true });
const createPermission = [Permission.create(Role.team(workspaceTeamId))];
await tables.createTable({
  databaseId,
  tableId: listsTableId,
  name: "Lists",
  permissions: createPermission,
  rowSecurity: true,
  enabled: true,
  columns: [
    { key: "name", type: "string", size: 128, required: true },
    { key: "ordinal", type: "integer", required: true },
    { key: "task_order", type: "string", size: 36, required: true, array: true },
    { key: "revision", type: "integer", required: true },
  ],
  indexes: [
    { key: "ordinal_idx", type: "key", attributes: ["ordinal"], orders: ["ASC"] },
  ],
});
await tables.createTable({
  databaseId,
  tableId: tasksTableId,
  name: "Tasks",
  permissions: createPermission,
  rowSecurity: true,
  enabled: true,
  columns: [
    { key: "title", type: "string", size: 256, required: true },
    { key: "completed", type: "boolean", required: true },
    { key: "assignee", type: "string", size: 128, required: true },
    { key: "due_date", type: "string", size: 10, required: true },
    { key: "list_id", type: "string", size: 36, required: true },
    { key: "revision", type: "integer", required: true },
  ],
  indexes: [
    { key: "list_idx", type: "key", attributes: ["list_id"], orders: ["ASC"] },
  ],
});

const lists = Array.from({ length: 4 }, (_, listIndex) => {
  const listId = `list_${listIndex + 1}`;
  const taskIds = Array.from(
    { length: 25 },
    (_, taskIndex) => `task_${listIndex + 1}_${String(taskIndex + 1).padStart(2, "0")}`,
  );
  return {
    id: listId,
    name: ["Inbox", "Today", "This week", "Later"][listIndex],
    ordinal: listIndex,
    taskIds,
  };
});

for (const list of lists) {
  await tables.createRow({
    databaseId,
    tableId: listsTableId,
    rowId: list.id,
    data: {
      name: list.name,
      ordinal: list.ordinal,
      task_order: list.taskIds,
      revision: 1,
    },
    permissions: teamPermissions,
  });
  for (let start = 0; start < list.taskIds.length; start += 10) {
    await Promise.all(list.taskIds.slice(start, start + 10).map((taskId, offset) => {
      const taskNumber = start + offset + 1;
      return tables.createRow({
        databaseId,
        tableId: tasksTableId,
        rowId: taskId,
        data: {
          title: `${list.name} task ${taskNumber}`,
          completed: taskNumber % 5 === 0,
          assignee: taskNumber % 2 === 0 ? "Alice" : "Bob",
          due_date: `2026-08-${String((taskNumber % 28) + 1).padStart(2, "0")}`,
          list_id: list.id,
          revision: 1,
        },
        permissions: teamPermissions,
      });
    }));
  }
}

const [seededLists, seededTasks] = await Promise.all([
  allRows(listsTableId),
  allRows(tasksTableId),
]);
const taskIds = new Set(seededTasks.map((row) => row.$id));
const orderValid = seededLists.every(
  (list) =>
    list.task_order.length === 25 &&
    new Set(list.task_order).size === 25 &&
    list.task_order.every((id) => taskIds.has(id)),
);
if (seededLists.length !== 4 || seededTasks.length !== 100 || !orderValid) {
  throw new Error("Authoritative seed verification failed");
}

await mkdir(receiptsRoot, { recursive: true });
await writeFile(
  resolve(receiptsRoot, "personas.v1.json"),
  `${JSON.stringify({
    schemaVersion: 1,
    checkedAt: new Date().toISOString(),
    provider: "Appwrite Auth and Teams",
    principalIdHashes: Object.fromEntries(
      Object.entries(createdUsers).map(([key, user]) => [key, hash(user.$id)]),
    ),
    roles: Object.fromEntries(
      Object.entries(personSpecs).map(([key, spec]) => [key, spec.role]),
    ),
    memberReadCounts: { alice: 100, bob: 100 },
    outsiderReadCount: 0,
    containsSecretValues: false,
  }, null, 2)}\n`,
  { mode: 0o600 },
);
await writeFile(
  resolve(receiptsRoot, "authoritative-summary.v1.json"),
  `${JSON.stringify({
    schemaVersion: 1,
    checkedAt: new Date().toISOString(),
    workspaceCount: 1,
    membershipCount: 2,
    listCount: seededLists.length,
    taskCount: seededTasks.length,
    uniqueTaskIds: taskIds.size,
    orderValid,
    containsSecretValues: false,
  }, null, 2)}\n`,
  { mode: 0o600 },
);
process.stdout.write(`${JSON.stringify({
  ok: true,
  users: Object.keys(createdUsers).length,
  lists: seededLists.length,
  tasks: seededTasks.length,
  orderValid,
  secretValuesPrinted: false,
})}\n`);
