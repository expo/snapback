#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const workRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const armRoot = path.resolve(workRoot, "..");
const receiptsRoot = path.resolve(armRoot, "receipts");
const env = Object.fromEntries(
  (await readFile(path.resolve(workRoot, ".arm-secrets"), "utf8"))
    .trim().split("\n").map((line) => {
      const split = line.indexOf("=");
      return [line.slice(0, split), line.slice(split + 1)];
    }),
);
const namespacePrefix = "llp0102_todo_sb01_";
const personaEmails = [env.ALICE_EMAIL, env.BOB_EMAIL, env.MALLORY_EMAIL];
const hash = (value) => createHash("sha256").update(value).digest("hex");

function psql(sql) {
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
        "-At",
        "-c", sql,
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

const database = JSON.parse(await psql(`
  select json_build_object(
    'database', current_database(),
    'serverVersion', current_setting('server_version'),
    'matchingRelations', coalesce((
      select json_agg(format('%I.%I', schemaname, tablename) order by tablename)
      from pg_tables
      where schemaname = 'public' and tablename like '${namespacePrefix}%'
    ), '[]'::json),
    'matchingPublicationRelations', coalesce((
      select json_agg(format('%I.%I', schemaname, tablename) order by tablename)
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename like '${namespacePrefix}%'
    ), '[]'::json)
  )::text;
`));
const admin = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const matchingUsers = [];
for (let page = 1; ; page += 1) {
  const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
  if (error) throw error;
  matchingUsers.push(...data.users.filter((user) => personaEmails.includes(user.email ?? "")));
  if (data.users.length < 1000) break;
}
const projectHost = new URL(env.VITE_SUPABASE_URL).hostname;
const receipt = {
  schemaVersion: 1,
  capturedAt: new Date().toISOString(),
  namespace: "llp0102-todo-supabase-calibration-todo-supabase-calibration-01",
  namespacePrefix,
  targetIdentity: {
    projectHostHash: hash(projectHost),
    databaseNameHash: hash(database.database),
    serverVersion: database.serverVersion,
  },
  baseline: {
    matchingRelations: database.matchingRelations,
    matchingPublicationRelations: database.matchingPublicationRelations,
    matchingPersonaUserIdHashes: matchingUsers.map((user) => hash(user.id)).sort(),
  },
  ok:
    database.matchingRelations.length === 0 &&
    database.matchingPublicationRelations.length === 0 &&
    matchingUsers.length === 0,
  containsSecretValues: false,
};
await mkdir(receiptsRoot, { recursive: true });
await writeFile(
  path.resolve(receiptsRoot, "baseline.v1.json"),
  `${JSON.stringify(receipt, null, 2)}\n`,
  { encoding: "utf8", mode: 0o600 },
);
process.stdout.write(`${JSON.stringify({
  ok: receipt.ok,
  matchingRelations: database.matchingRelations.length,
  matchingPublicationRelations: database.matchingPublicationRelations.length,
  matchingPersonaUsers: matchingUsers.length,
  secretValuesPrinted: false,
})}\n`);
if (!receipt.ok) process.exit(1);
