#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { applicationDefault, deleteApp, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8085";
process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9102";
process.env.GCLOUD_PROJECT = "demo-llp0102-todo-firebase";

const app = initializeApp({
  projectId: "demo-llp0102-todo-firebase",
  credential: applicationDefault(),
});
const firestore = getFirestore(app);
const auth = getAuth(app);
const env = Object.fromEntries(
  (await readFile(new URL("../.arm-secrets", import.meta.url), "utf8"))
    .trim().split("\n").map((line) => {
      const split = line.indexOf("=");
      return [line.slice(0, split), line.slice(split + 1)];
    }),
);
const personas = {
  alice: { email: env.ALICE_EMAIL, password: env.ALICE_PASSWORD },
  bob: { email: env.BOB_EMAIL, password: env.BOB_PASSWORD },
  mallory: { email: env.MALLORY_EMAIL, password: env.MALLORY_PASSWORD },
};
const listIds = Array.from({ length: 4 }, (_, index) => `list-${index}`);
const taskIds = Array.from({ length: 100 }, (_, index) => `task-${String(index).padStart(3, "0")}`);

const hash = (value) => createHash("sha256").update(value).digest("hex");

async function ensureUser(persona) {
  const config = personas[persona];
  try {
    const user = await auth.getUserByEmail(config.email);
    return await auth.updateUser(user.uid, { password: config.password, disabled: false });
  } catch (error) {
    if (error?.code !== "auth/user-not-found") throw error;
    return auth.createUser({
      email: config.email,
      password: config.password,
      displayName: persona,
      emailVerified: true,
    });
  }
}

async function users() {
  const result = {};
  for (const persona of Object.keys(personas)) result[persona] = await ensureUser(persona);
  return result;
}

async function seed() {
  const actor = await users();
  const batch = firestore.batch();
  batch.set(firestore.doc("workspaces/primary"), { name: "Primary workspace" });
  for (const persona of ["alice", "bob"]) {
    batch.set(
      firestore.doc(`workspaces/primary/members/${actor[persona].uid}`),
      { persona, uid: actor[persona].uid },
    );
  }
  for (let listIndex = 0; listIndex < 4; listIndex += 1) {
    const start = listIndex * 25;
    batch.set(firestore.doc(`lists/${listIds[listIndex]}`), {
      name: ["Inbox", "Bakeoff", "Operations", "Done"][listIndex],
      ordinal: listIndex,
      workspaceId: "primary",
      taskOrder: taskIds.slice(start, start + 25),
    });
    for (let item = 0; item < 25; item += 1) {
      const absolute = start + item;
      batch.set(firestore.doc(`tasks/${taskIds[absolute]}`), {
        title: `Task ${String(absolute + 1).padStart(3, "0")}`,
        completed: absolute % 7 === 0,
        assignee: absolute % 2 === 0 ? "Alice" : "Bob",
        dueDate: `2026-08-${String((absolute % 28) + 1).padStart(2, "0")}`,
        listId: listIds[listIndex],
        workspaceId: "primary",
        seedKey: `seed:${String(absolute).padStart(3, "0")}`,
        revision: 0,
      });
    }
  }
  await batch.commit();
  const result = await summary();
  return {
    ...result,
    principalIdHashes: Object.fromEntries(
      Object.entries(actor).map(([persona, user]) => [persona, hash(user.uid)]),
    ),
  };
}

async function summary() {
  const [workspace, members, lists, tasks] = await Promise.all([
    firestore.doc("workspaces/primary").get(),
    firestore.collection("workspaces/primary/members").get(),
    firestore.collection("lists").where("workspaceId", "==", "primary").get(),
    firestore.collection("tasks").where("workspaceId", "==", "primary").get(),
  ]);
  const listData = lists.docs.map((item) => ({ id: item.id, ...item.data() }));
  const taskData = tasks.docs.map((item) => ({ id: item.id, ...item.data() }));
  return {
    workspaceCount: workspace.exists ? 1 : 0,
    membershipCount: members.size,
    membershipPersonas: members.docs.map((item) => item.data().persona).sort(),
    listCount: lists.size,
    taskCount: tasks.size,
    uniqueTaskIds: new Set(taskData.map((item) => item.id)).size,
    uniqueSeedKeys: new Set(taskData.map((item) => item.seedKey)).size,
    orderValid: listData.every((list) => {
      const inList = taskData.filter((task) => task.listId === list.id);
      return Array.isArray(list.taskOrder) &&
        list.taskOrder.length === inList.length &&
        new Set(list.taskOrder).size === list.taskOrder.length &&
        inList.every((task) => list.taskOrder.includes(task.id));
    }),
  };
}

async function membership(persona, present) {
  const user = await ensureUser(persona);
  const ref = firestore.doc(`workspaces/primary/members/${user.uid}`);
  if (present) await ref.set({ persona, uid: user.uid });
  else await ref.delete();
  return { persona, present };
}

async function probe(taskId) {
  const snapshot = await firestore.doc(`tasks/${taskId}`).get();
  return snapshot.exists
    ? { title: snapshot.data().title, revision: snapshot.data().revision }
    : null;
}

async function cleanup(prefix) {
  const snapshot = await firestore.collection("tasks").get();
  const matches = snapshot.docs.filter((item) => item.data().title.startsWith(prefix));
  if (matches.length) {
    const batch = firestore.batch();
    for (const item of matches) batch.delete(item.ref);
    await batch.commit();
  }
  return { prefix, removed: matches.length };
}

async function resetOrder() {
  const batch = firestore.batch();
  for (let index = 0; index < listIds.length; index += 1) {
    batch.update(firestore.doc(`lists/${listIds[index]}`), {
      taskOrder: taskIds.slice(index * 25, index * 25 + 25),
    });
  }
  await batch.commit();
  return { resetLists: listIds.length };
}

const [action, ...args] = process.argv.slice(2);
let result;
if (action === "seed") result = await seed();
else if (action === "summary") result = await summary();
else if (action === "revoke") result = await membership(args[0], false);
else if (action === "regrant") result = await membership(args[0], true);
else if (action === "probe") result = await probe(args[0]);
else if (action === "cleanup") result = await cleanup(args.join(" "));
else if (action === "reset-order") result = await resetOrder();
else throw new Error(`Unknown action: ${action}`);

process.stdout.write(`${JSON.stringify(result)}\n`);
await deleteApp(app);
