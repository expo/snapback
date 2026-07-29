import { spawn } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { hash, projectId } from "./lib.mjs";

const root = process.cwd();
const receipts = path.resolve("receipts");
await mkdir(receipts, { recursive: true });
await mkdir(path.resolve(".xdg-config"), { recursive: true });
await mkdir(path.resolve(".xdg-cache"), { recursive: true });

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
  XDG_CONFIG_HOME: path.resolve(".xdg-config"),
  XDG_CACHE_HOME: path.resolve(".xdg-cache"),
};
const emulatorPid = detached(
  path.resolve("node_modules/.bin/firebase"),
  ["emulators:start", "--project", projectId, "--only", "auth,firestore,functions,storage"],
  "emulator.log",
  armEnvironment,
);
await writeFile(path.join(receipts, "emulator.pid"), `${emulatorPid}\n`);
let hub;
for (let attempt = 0; attempt < 240; attempt += 1) {
  const hubResponse = await waitFor("http://127.0.0.1:4521/emulators");
  hub = await hubResponse.json();
  if (["auth", "firestore", "functions", "storage", "logging"].every((name) => hub[name])) break;
  await new Promise((resolve) => setTimeout(resolve, 250));
}
if (!["auth", "firestore", "functions", "storage", "logging"].every((name) => hub?.[name])) {
  throw new Error(`Emulator hub never reached complete service inventory: ${JSON.stringify(hub)}`);
}
await writeFile(path.join(receipts, "emulator-hub.json"), `${JSON.stringify(hub, null, 2)}\n`);

const vitePid = detached("npm", ["run", "dev", "--silent"], "vite.log", armEnvironment);
await writeFile(path.join(receipts, "vite.pid"), `${vitePid}\n`);
await waitFor("http://127.0.0.1:4321");

const identity = {
  schemaVersion: 1,
  capturedAt: new Date().toISOString(),
  mode: "fresh-local",
  projectId,
  namespace: projectId,
  identityHash: hash(JSON.stringify({ projectId, hub, root })),
  services: hub,
  ports: {
    auth: 9321,
    firestore: 8321,
    functions: 5321,
    storage: 9421,
    vite: 4321,
    hub: 4521,
    logging: 4522,
  },
  sourceBaseCommit: "2a4472a44568a87d2a0373904b42562b52e8730b",
  frozenSnapbackCommit: "5f31cb6174daaefa04a1e05242acbbc22c725040",
  freezeAggregateSha256: "ab95cd3099b7dde29810046ba495884e3bc641a3bdfb811ab828db10c6b7f72a",
  hosted: {
    status: "credential-unavailable",
    claim: "No hosted Firebase target was mutated.",
  },
};
await writeFile(path.join(receipts, "target-identity.json"), `${JSON.stringify(identity, null, 2)}\n`);
console.log(JSON.stringify({ emulatorPid, vitePid, identity }, null, 2));
