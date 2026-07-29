import { execFileSync, spawn } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { hash, projectId } from "./lib.mjs";

const root = process.cwd();
const sourceRevision = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const sourceDirty = execFileSync("git", ["status", "--short", "--", "."], { cwd: root, encoding: "utf8" }).trim().length > 0;
const receipts = path.resolve("receipts");
const stateRoot = path.resolve(".state");
await mkdir(receipts, { recursive: true });
for (const directory of ["home", "xdg-config", "xdg-cache", "xdg-data", "gcloud", "npm-cache"]) {
  await mkdir(path.join(stateRoot, directory), { recursive: true });
}

async function waitFor(url, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function detached(command, args, logName, env = process.env) {
  const descriptor = openSync(path.join(receipts, logName), "a", 0o600);
  const child = spawn(command, args, {
    cwd: root,
    detached: true,
    env,
    stdio: ["ignore", descriptor, descriptor],
  });
  child.unref();
  closeSync(descriptor);
  return child.pid;
}

const armEnvironment = {
  ...process.env,
  PATH: [path.dirname(process.execPath), process.env.PATH].filter(Boolean).join(path.delimiter),
  HOME: path.join(stateRoot, "home"),
  XDG_CONFIG_HOME: path.join(stateRoot, "xdg-config"),
  XDG_CACHE_HOME: path.join(stateRoot, "xdg-cache"),
  XDG_DATA_HOME: path.join(stateRoot, "xdg-data"),
  CLOUDSDK_CONFIG: path.join(stateRoot, "gcloud"),
  npm_config_cache: path.join(stateRoot, "npm-cache"),
};
const emulatorPid = detached(
  path.resolve("node_modules/.bin/firebase"),
  ["emulators:start", "--project", projectId, "--only", "auth,firestore,functions,storage"],
  "emulator.log",
  armEnvironment,
);
await writeFile(path.join(receipts, "emulator.pid"), `${emulatorPid}\n`);
let hub;
const requiredServices = [
  "auth",
  "firestore",
  "functions",
  "storage",
  "eventarc",
  "tasks",
  "logging",
];
for (let attempt = 0; attempt < 240; attempt += 1) {
  const hubResponse = await waitFor("http://127.0.0.1:46121/emulators");
  hub = await hubResponse.json();
  if (requiredServices.every((name) => hub[name])) break;
  await new Promise((resolve) => setTimeout(resolve, 250));
}
if (!requiredServices.every((name) => hub?.[name])) {
  throw new Error(`Emulator hub never reached complete service inventory: ${JSON.stringify(hub)}`);
}
if (hub.eventarc.port !== 61121 || hub.tasks.port !== 62121) {
  throw new Error(`Auxiliary emulator isolation mismatch: ${JSON.stringify({
    eventarc: hub.eventarc,
    tasks: hub.tasks,
  })}`);
}
await writeFile(path.join(receipts, "emulator-hub.json"), `${JSON.stringify(hub, null, 2)}\n`);

const vitePid = detached("npm", ["run", "dev", "--silent"], "vite.log", armEnvironment);
await writeFile(path.join(receipts, "vite.pid"), `${vitePid}\n`);
await waitFor("http://127.0.0.1:46124");

const identity = {
  schemaVersion: 1,
  capturedAt: new Date().toISOString(),
  mode: "fresh-local",
  projectId,
  namespace: projectId,
  identityHash: hash(JSON.stringify({ projectId, hub, root })),
  services: hub,
  ports: {
    auth: 59121,
    firestore: 58121,
    firestoreWebSocket: 46123,
    functions: 56121,
    storage: 60121,
    eventarc: 61121,
    tasks: 62121,
    vite: 46124,
    hub: 46121,
    logging: 46122,
  },
  sourceBaseCommit: "afdabefbba7106d857c39d05f5cbb2e14babd6a7",
  sourceRevision,
  sourceDirty,
  frozenSnapbackCommit: "4e5da63c33064082c73359f0ee02efcd11e360ff",
  freezeAggregateSha256: "ab95cd3099b7dde29810046ba495884e3bc641a3bdfb811ab828db10c6b7f72a",
  machine: `${os.hostname()}/${process.platform}/${process.arch}/${os.release()}; Node ${process.version}`,
  hosted: {
    status: "credential-unavailable",
    claim: "No hosted Firebase target was mutated.",
  },
};
await writeFile(path.join(receipts, "target-identity.json"), `${JSON.stringify(identity, null, 2)}\n`);
console.log(JSON.stringify({ emulatorPid, vitePid, identity }, null, 2));
