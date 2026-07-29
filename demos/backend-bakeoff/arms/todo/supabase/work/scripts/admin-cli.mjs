#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const workRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = Object.fromEntries(
  (await readFile(path.resolve(workRoot, ".arm-secrets"), "utf8"))
    .trim().split("\n").map((line) => {
      const split = line.indexOf("=");
      return [line.slice(0, split), line.slice(split + 1)];
    }),
);
const admin = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const workspaceId = "10000000-0000-4000-8000-000000000001";
const listIds = Array.from(
  { length: 4 },
  (_, index) => `20000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
);
const taskId = (listIndex, taskIndex) =>
  `30000000-0000-4000-${String(8000 + listIndex).padStart(4, "0")}-${
    String(taskIndex + 1).padStart(12, "0")
  }`;
const hash = (value) => createHash("sha256").update(value).digest("hex");

function check(result) {
  if (result.error) throw result.error;
  return result.data;
}

function psqlFile(file) {
  const connection = new URL(env.DIRECT_URL);
  return new Promise((resolve, reject) => {
    const child = spawn(
      "psql",
      [
        "-X",
        "-v", "ON_ERROR_STOP=1",
        "-h", connection.hostname,
        "-p", connection.port || "5432",
        "-U", decodeURIComponent(connection.username),
        "-d", connection.pathname.replace(/^\//, ""),
        "-f", file,
      ],
      {
        cwd: workRoot,
        env: {
          ...process.env,
          PGPASSWORD: decodeURIComponent(connection.password),
          PGSSLMODE: connection.searchParams.get("sslmode") ?? "require",
          PGCONNECT_TIMEOUT: "15",
        },
        stdio: ["ignore", "ignore", "pipe"],
      },
    );
    let stderr = "";
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr || `psql exited ${code}`));
    });
  });
}

function psqlQuery(sql) {
  const connection = new URL(env.DIRECT_URL);
  return new Promise((resolve, reject) => {
    const child = spawn(
      "psql",
      [
        "-X",
        "-v", "ON_ERROR_STOP=1",
        "-h", connection.hostname,
        "-p", connection.port || "5432",
        "-U", decodeURIComponent(connection.username),
        "-d", connection.pathname.replace(/^\//, ""),
        "-At", "-c", sql,
      ],
      {
        cwd: workRoot,
        env: {
          ...process.env,
          PGPASSWORD: decodeURIComponent(connection.password),
          PGSSLMODE: connection.searchParams.get("sslmode") ?? "require",
          PGCONNECT_TIMEOUT: "15",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(stderr || `psql exited ${code}`));
    });
  });
}

async function allUsers() {
  const users = [];
  for (let page = 1; ; page += 1) {
    const data = check(await admin.auth.admin.listUsers({ page, perPage: 1000 }));
    users.push(...data.users);
    if (data.users.length < 1000) return users;
  }
}

async function ensureUser(persona) {
  const upper = persona.toUpperCase();
  const email = env[`${upper}_EMAIL`];
  const password = env[`${upper}_PASSWORD`];
  const existing = (await allUsers()).find((user) => user.email === email);
  if (existing) {
    check(await admin.auth.admin.updateUserById(existing.id, {
      password,
      email_confirm: true,
      app_metadata: { llp0102_namespace: "todo-supabase-01", persona },
    }));
    return existing.id;
  }
  const data = check(await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: { llp0102_namespace: "todo-supabase-01", persona },
  }));
  return data.user.id;
}

async function summary() {
  const workspace = check(await admin
    .from("llp0102_todo_sb01_workspaces").select("id", { count: "exact" }));
  const memberships = check(await admin
    .from("llp0102_todo_sb01_memberships").select("id,persona,user_id", { count: "exact" }));
  const lists = check(await admin
    .from("llp0102_todo_sb01_lists").select("id,ordinal,task_order", { count: "exact" })
    .order("ordinal"));
  const tasks = check(await admin
    .from("llp0102_todo_sb01_tasks").select("id,seed_key", { count: "exact" }));
  const taskIds = new Set(tasks.map((task) => task.id));
  return {
    workspaceCount: workspace.length,
    membershipCount: memberships.length,
    membershipPersonas: memberships.map((membership) => membership.persona).sort(),
    listCount: lists.length,
    taskCount: tasks.length,
    uniqueTaskIds: taskIds.size,
    uniqueSeedKeys: new Set(tasks.map((task) => task.seed_key)).size,
    orderValid: lists.every((list) =>
      list.task_order.length === 25 &&
      new Set(list.task_order).size === 25 &&
      list.task_order.every((id) => taskIds.has(id))
    ),
  };
}

async function seed() {
  const identities = {
    alice: await ensureUser("alice"),
    bob: await ensureUser("bob"),
    mallory: await ensureUser("mallory"),
  };
  await check(await admin.from("llp0102_todo_sb01_workspaces").upsert({
    id: workspaceId,
    namespace: "llp0102-todo-supabase-calibration-todo-supabase-calibration-01",
    name: "Primary workspace",
  }));
  await check(await admin.from("llp0102_todo_sb01_memberships").upsert([
    {
      id: "11000000-0000-4000-8000-000000000001",
      workspace_id: workspaceId,
      user_id: identities.alice,
      persona: "alice",
    },
    {
      id: "11000000-0000-4000-8000-000000000002",
      workspace_id: workspaceId,
      user_id: identities.bob,
      persona: "bob",
    },
  ]));
  const listNames = ["Inbox", "Today", "Upcoming", "Done"];
  const lists = listIds.map((id, listIndex) => ({
    id,
    workspace_id: workspaceId,
    name: listNames[listIndex],
    ordinal: listIndex,
    task_order: Array.from({ length: 25 }, (_, taskIndex) => taskId(listIndex, taskIndex)),
  }));
  await check(await admin.from("llp0102_todo_sb01_lists").upsert(lists));
  const tasks = lists.flatMap((list, listIndex) =>
    list.task_order.map((id, taskIndex) => ({
      id,
      workspace_id: workspaceId,
      list_id: list.id,
      title: `Task ${listIndex + 1}.${taskIndex + 1}`,
      completed: false,
      assignee: taskIndex % 2 === 0 ? "Alice" : "Bob",
      due_date: `2026-08-${String((taskIndex % 20) + 1).padStart(2, "0")}`,
      revision: 0,
      seed_key: `todo:${listIndex}:${taskIndex}`,
    }))
  );
  await check(await admin.from("llp0102_todo_sb01_tasks").upsert(tasks));
  return {
    principalIdHashes: Object.fromEntries(
      Object.entries(identities).map(([persona, id]) => [persona, hash(id)]),
    ),
    authoritative: await summary(),
  };
}

const [command, ...args] = process.argv.slice(2);
let result;
if (command === "migrate") {
  await psqlFile(path.resolve(workRoot, "supabase/migrations/20260728214915_todo.sql"));
  result = { ok: true };
} else if (command === "seed") {
  result = await seed();
} else if (command === "summary") {
  result = await summary();
} else if (command === "revoke") {
  const users = await allUsers();
  const bob = users.find((user) => user.email === env.BOB_EMAIL);
  if (!bob) throw new Error("Bob user missing");
  check(await admin.from("llp0102_todo_sb01_memberships")
    .delete().eq("workspace_id", workspaceId).eq("user_id", bob.id));
  result = { ok: true };
} else if (command === "regrant") {
  const users = await allUsers();
  const bob = users.find((user) => user.email === env.BOB_EMAIL);
  if (!bob) throw new Error("Bob user missing");
  check(await admin.from("llp0102_todo_sb01_memberships").upsert({
    id: "11000000-0000-4000-8000-000000000002",
    workspace_id: workspaceId,
    user_id: bob.id,
    persona: "bob",
  }));
  result = { ok: true };
} else if (command === "probe") {
  const task = check(await admin.from("llp0102_todo_sb01_tasks")
    .select("*").eq("id", args[0]).single());
  result = task;
} else if (command === "probe-list") {
  const list = check(await admin.from("llp0102_todo_sb01_lists")
    .select("*").eq("id", args[0]).single());
  result = list;
} else if (command === "reset-order") {
  for (let listIndex = 0; listIndex < listIds.length; listIndex += 1) {
    check(await admin.from("llp0102_todo_sb01_lists").update({
      task_order: Array.from(
        { length: 25 },
        (_, taskIndex) => taskId(listIndex, taskIndex),
      ),
    }).eq("id", listIds[listIndex]));
  }
  result = { ok: true };
} else if (command === "cleanup-marker") {
  const prefix = args[0] ?? "";
  const rows = check(await admin.from("llp0102_todo_sb01_tasks")
    .select("id,list_id,title").like("title", `${prefix}%`));
  for (const row of rows) {
    const list = check(await admin.from("llp0102_todo_sb01_lists")
      .select("task_order").eq("id", row.list_id).single());
    check(await admin.from("llp0102_todo_sb01_lists")
      .update({ task_order: list.task_order.filter((id) => id !== row.id) }).eq("id", row.list_id));
    check(await admin.from("llp0102_todo_sb01_tasks").delete().eq("id", row.id));
  }
  result = { removed: rows.length };
} else if (command === "target-probe") {
  const database = JSON.parse(await psqlQuery(`
    select json_build_object(
      'serverVersion', current_setting('server_version'),
      'regionSetting', coalesce(
        current_setting('cloud.region', true),
        current_setting('supabase.region', true),
        ''
      ),
      'matchingRelations', (
        select count(*) from pg_tables
        where schemaname = 'public' and tablename like 'llp0102_todo_sb01_%'
      ),
      'matchingPublicationRelations', (
        select count(*) from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename like 'llp0102_todo_sb01_%'
      ),
      'matchingPolicies', (
        select count(*) from pg_policies
        where schemaname = 'public' and policyname like 'llp0102_todo_sb01_%'
      )
    )::text;
  `));
  const matchingUsers = (await allUsers()).filter((user) =>
    [env.ALICE_EMAIL, env.BOB_EMAIL, env.MALLORY_EMAIL].includes(user.email ?? "")
  );
  const poolerRegionHint =
    new URL(env.DIRECT_URL).hostname.match(/[a-z]{2}-[a-z]+-\d/)?.[0] ?? "";
  result = {
    ...database,
    poolerRegionHint,
    matchingPersonaUsers: matchingUsers.length,
    matchingPersonaUserIdHashes: matchingUsers.map((user) => hash(user.id)).sort(),
  };
} else if (command === "delete-personas") {
  const matchingUsers = (await allUsers()).filter((user) =>
    [env.ALICE_EMAIL, env.BOB_EMAIL, env.MALLORY_EMAIL].includes(user.email ?? "")
  );
  for (const user of matchingUsers) {
    if (user.app_metadata?.llp0102_namespace !== "todo-supabase-01") {
      throw new Error("refusing to delete persona without exact arm namespace metadata");
    }
    check(await admin.auth.admin.deleteUser(user.id));
  }
  result = {
    removed: matchingUsers.length,
    removedIdHashes: matchingUsers.map((user) => hash(user.id)).sort(),
  };
} else if (command === "drop-target") {
  await psqlFile(path.resolve(workRoot, "supabase/migrations/20260728214915_cleanup.sql"));
  result = { ok: true };
} else {
  throw new Error("usage: admin-cli.mjs <migrate|seed|summary|revoke|regrant|probe|probe-list|reset-order|cleanup-marker|target-probe|delete-personas|drop-target>");
}
process.stdout.write(`${JSON.stringify(result)}\n`);
