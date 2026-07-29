#!/usr/bin/env node

import {
  allRows,
  databaseId,
  listsTableId,
  runtime,
  saveRuntime,
  tables,
  tasksTableId,
  teams,
  workspaceTeamId,
} from "./admin-client.mjs";

async function summary() {
  const [lists, tasks] = await Promise.all([
    allRows(listsTableId),
    allRows(tasksTableId),
  ]);
  const ids = new Set(tasks.map((task) => task.$id));
  return {
    listCount: lists.length,
    taskCount: tasks.length,
    uniqueTaskIds: ids.size,
    orderValid: lists.every(
      (list) =>
        list.task_order.length === tasks.filter((task) => task.list_id === list.$id).length &&
        new Set(list.task_order).size === list.task_order.length &&
        list.task_order.every((id) => ids.has(id)),
    ),
  };
}

async function probe(rowId) {
  return tables.getRow({
    databaseId,
    tableId: tasksTableId,
    rowId,
  });
}

async function probeList(rowId) {
  return tables.getRow({
    databaseId,
    tableId: listsTableId,
    rowId,
  });
}

async function revoke() {
  if (!runtime.memberships?.bob) throw new Error("Bob membership is missing");
  await teams.deleteMembership({
    teamId: workspaceTeamId,
    membershipId: runtime.memberships.bob,
  });
  runtime.memberships.bob = null;
  await saveRuntime();
  return { revoked: true };
}

async function regrant() {
  if (runtime.memberships?.bob) return { regranted: false, alreadyMember: true };
  const membership = await teams.createMembership({
    teamId: workspaceTeamId,
    roles: ["member"],
    userId: runtime.personas.bob.id,
  });
  runtime.memberships ??= {};
  runtime.memberships.bob = membership.$id;
  await saveRuntime();
  return { regranted: true };
}

async function resetOrder() {
  for (let listIndex = 1; listIndex <= 4; listIndex += 1) {
    const taskOrder = Array.from(
      { length: 25 },
      (_, taskIndex) => `task_${listIndex}_${String(taskIndex + 1).padStart(2, "0")}`,
    );
    await tables.updateRow({
      databaseId,
      tableId: listsTableId,
      rowId: `list_${listIndex}`,
      data: { task_order: taskOrder },
    });
  }
  return summary();
}

const [command, id] = process.argv.slice(2);
let result;
switch (command) {
  case "summary":
    result = await summary();
    break;
  case "probe":
    result = await probe(id);
    break;
  case "probe-list":
    result = await probeList(id);
    break;
  case "revoke":
    result = await revoke();
    break;
  case "regrant":
    result = await regrant();
    break;
  case "reset-order":
    result = await resetOrder();
    break;
  default:
    throw new Error(`Unknown admin command: ${command ?? ""}`);
}
process.stdout.write(`${JSON.stringify(result)}\n`);
