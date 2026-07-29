#!/usr/bin/env node

import { Query } from "node-appwrite";
import {
  allRows,
  databaseId,
  privateMessagesTableId,
  privateTeamId,
  publicMessagesTableId,
  runtime,
  saveRuntime,
  tables,
  teams,
} from "./admin-client.mjs";

async function summary() {
  const [publicMessages, privateMessages] = await Promise.all([
    allRows(publicMessagesTableId),
    allRows(privateMessagesTableId),
  ]);
  return {
    publicMessages: publicMessages.length,
    privateMessages: privateMessages.length,
    totalMessages: publicMessages.length + privateMessages.length,
    uniqueIds:
      new Set([...publicMessages, ...privateMessages].map((message) => message.$id)).size,
  };
}

async function probe(rowId) {
  return tables.getRow({
    databaseId,
    tableId: privateMessagesTableId,
    rowId,
  });
}

async function page(cursor) {
  const queries = [
    Query.equal("channel_id", ["private-alpha"]),
    Query.orderDesc("$createdAt"),
    Query.limit(25),
  ];
  if (cursor) queries.push(Query.cursorAfter(cursor));
  const result = await tables.listRows({
    databaseId,
    tableId: privateMessagesTableId,
    queries,
    total: true,
  });
  return {
    ids: result.rows.map((row) => row.$id),
    createdAt: result.rows.map((row) => row.$createdAt),
    total: result.total,
  };
}

async function revoke() {
  if (!runtime.memberships?.bob) throw new Error("Bob membership is missing");
  await teams.deleteMembership({
    teamId: privateTeamId,
    membershipId: runtime.memberships.bob,
  });
  runtime.memberships.bob = null;
  await saveRuntime();
  return { revoked: true };
}

async function regrant() {
  if (runtime.memberships?.bob) return { regranted: false, alreadyMember: true };
  const membership = await teams.createMembership({
    teamId: privateTeamId,
    roles: ["member"],
    userId: runtime.personas.bob.id,
  });
  runtime.memberships ??= {};
  runtime.memberships.bob = membership.$id;
  await saveRuntime();
  return { regranted: true };
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
  case "page":
    result = await page(id);
    break;
  case "revoke":
    result = await revoke();
    break;
  case "regrant":
    result = await regrant();
    break;
  default:
    throw new Error(`Unknown admin command: ${command ?? ""}`);
}
process.stdout.write(`${JSON.stringify(result)}\n`);
