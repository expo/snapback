import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { localConfig } from "./local-config.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const work = path.resolve(here, "..");
const arm = path.resolve(work, "..");
const receipts = path.join(arm, "receipts");
const state = JSON.parse(await readFile(path.join(work, "run-state.json"), "utf8"));
const config = localConfig();
const admin = createClient(config.apiUrl, config.serviceRoleKey, { auth: { persistSession: false } });
const project = "llp0102-partiful-supabase-coord";
if (state.projectId !== project || state.runtimeProjectDir !== "/Users/ccheever/.cache/llp0102-partiful-supabase-coord-runtime") {
  throw new Error("pre-cleanup guard rejected unexpected target");
}

const tables = [
  "profiles", "events", "event_members", "invitations", "rsvps", "wall_posts",
  "reminder_schedules", "notification_attempts", "provider_deliveries"
];
const counts = {};
for (const table of tables) {
  const result = await admin.from(table).select("*", { count: "exact", head: true });
  if (result.error) throw result.error;
  counts[table] = result.count;
}
const objects = await admin.storage.from("event-art").list("", { limit: 1000 });
if (objects.error) throw objects.error;
const containers = lines(docker(["ps", "-a", "--filter", `name=${project}`, "--format", "{{.Names}}|{{.Image}}|{{.Status}}"]));
const volumes = lines(docker(["volume", "ls", "--filter", `name=${project}`, "--format", "{{.Name}}"]));
const networks = lines(docker(["network", "ls", "--filter", `name=${project}`, "--format", "{{.Name}}"]));
const unrelated = lines(docker(["ps", "-a", "--format", "{{.ID}}|{{.Names}}"]))
  .filter((line) => !line.includes(project)).sort();
const dbContainer = `supabase_db_${project}`;
const schema = execFileSync("docker", [
  "exec", dbContainer, "pg_dump", "--schema-only", "--no-owner", "--no-privileges",
  "-U", "postgres", "-d", "postgres", "--schema", "public"
], { encoding: "utf8" });
const cronJobs = JSON.parse(execFileSync("docker", [
  "exec", dbContainer, "psql", "-U", "postgres", "-d", "postgres", "-Atc",
  "select coalesce(json_agg(row_to_json(x)),'[]'::json) from (select jobid,jobname,schedule,command,active from cron.job order by jobid) x"
], { encoding: "utf8" }).trim());
const [migrationSource, notifySource, providerSource] = await Promise.all([
  readFile(path.join(work, "supabase", "migrations", "20260729060000_partiful.sql")),
  readFile(path.join(work, "supabase", "functions", "notify", "index.ts")),
  readFile(path.join(work, "supabase", "functions", "provider-fake", "index.ts"))
]);
const edgeLogs = execFileSync("docker", [
  "logs", "--tail", "200", `supabase_edge_runtime_${project}`
], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

const receipt = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  projectId: project,
  targetIdentityHash: sha256(`${project}|${config.apiUrl}|${config.dbUrl}`),
  authoritativeCounts: counts,
  exactStorageRootObjects: objects.data.length,
  cronJobs,
  containers,
  volumes,
  networks,
  unrelatedContainers: unrelated,
  unrelatedContainerSetSha256: sha256(JSON.stringify(unrelated)),
  schemaSha256: sha256(schema),
  schemaBytes: Buffer.byteLength(schema),
  containsSecretValues: false
};
const plan = {
  schemaVersion: 1,
  generatedAt: receipt.generatedAt,
  targetIdentityHash: receipt.targetIdentityHash,
  exactProjectId: project,
  exactRuntimeProjectDir: state.runtimeProjectDir,
  exactWorktreeState: [path.join(work, ".xdg")],
  exactPorts: [4330, 57431, 57432, 57433, 57434, 57435, 57436, 57437, 57438, 57439, 57440],
  selection: "Supabase CLI --workdir exact runtime mirror plus exact project-id Docker filters",
  baselineBoundary: "No separately timestamped empty baseline receipt was captured before provisioning; unique project/ports were assigned and start created a fresh stack. Cleanup confidence must preserve this evidence limitation.",
  unrelatedResources: "Preserve and compare hashed container identity set; never select by broad Supabase name.",
  steps: [
    "Retain target identity, counts, schema hash, exact resources, cron and storage state.",
    "Run supabase stop --no-backup against the exact runtime workdir.",
    "Remove only the exact runtime mirror and worktree-local XDG state.",
    "Verify exact project containers, volumes, networks, assigned ports, and credential-bearing runtime are absent.",
    "Compare unrelated container identity set."
  ],
  recovery: "Local data is not recoverable after --no-backup; retained schema/functions/seed source recreates the target.",
  containsSecretValues: false
};
const backup = {
  schemaVersion: 1,
  generatedAt: receipt.generatedAt,
  targetIdentityHash: receipt.targetIdentityHash,
  mechanism: "deterministic rebuild; no data-bearing export committed",
  schemaSha256: receipt.schemaSha256,
  schemaBytes: receipt.schemaBytes,
  authoritativeCounts: counts,
  retainedInputs: [
    "supabase/migrations/20260729060000_partiful.sql",
    "supabase/functions/notify/index.ts",
    "supabase/functions/provider-fake/index.ts",
    "scripts/seed.mjs",
    "package-lock.json"
  ]
};
const operations = {
  schemaVersion: 1,
  generatedAt: receipt.generatedAt,
  targetIdentityHash: receipt.targetIdentityHash,
  local: {
    profile: "official Supabase CLI Docker stack",
    exactProjectId: project,
    apiUrlHash: sha256(config.apiUrl),
    dbUrlHash: sha256(config.dbUrl),
    containerCount: containers.length,
    schemaSha256: receipt.schemaSha256,
    cronJobs,
    edgeLogTailSha256: sha256(edgeLogs),
    sourceHashes: {
      migration: sha256(migrationSource),
      notifyFunction: sha256(notifySource),
      providerFakeFunction: sha256(providerSource)
    },
    export: "schema hash plus deterministic rebuild inputs; no data-bearing export committed"
  },
  hosted: {
    status: "unavailable-remote-dependency",
    reason: "No isolated hosted Supabase project credential was available.",
    url: null,
    region: null,
    logs: null,
    rollback: null,
    effectDeliveryClaimed: false
  },
  secretBoundary: "UI receives only local anon key; Edge Runtime receives provider-owned server credentials and keeps them out of committed receipts.",
  containsSecretValues: false
};
await mkdir(receipts, { recursive: true });
await Promise.all([
  write("pre-cleanup-resources.json", receipt),
  write("cleanup-plan.json", plan),
  write("backup-manifest.json", backup),
  write("operations.json", operations)
]);
console.log(JSON.stringify({ counts, resources: { containers: containers.length, volumes: volumes.length, networks: networks.length }, cronJobs: cronJobs.length }));

function docker(args) {
  return execFileSync("docker", args, { encoding: "utf8" }).trim();
}
function lines(value) {
  return value.split(/\r?\n/).filter(Boolean);
}
function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
async function write(name, value) {
  await writeFile(path.join(receipts, name), `${JSON.stringify(value, null, 2)}\n`);
}
