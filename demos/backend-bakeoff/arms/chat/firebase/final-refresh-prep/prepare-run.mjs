#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const workRoot = path.join(here, "work");
const receipts = path.join(workRoot, "receipts");
const projectId = "llp0102-final-chat-firebase-w2";
const services = {
  auth: "127.0.0.1:35299",
  firestore: "127.0.0.1:35280",
  firestoreWebsocket: "127.0.0.1:35250",
  realtimeDatabase: "127.0.0.1:35281",
  functions: "127.0.0.1:35287",
  vite: "127.0.0.1:35288",
  hub: "127.0.0.1:35201",
  logging: "127.0.0.1:35202",
  eventarc: "127.0.0.1:35203",
  tasks: "127.0.0.1:35204"
};
const ports = Object.fromEntries(
  Object.entries(services).map(([name, endpoint]) => [name, Number(endpoint.split(":").at(-1))])
);
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const closed = (port) => new Promise((resolve) => {
  const socket = net.createConnection({ host: "127.0.0.1", port });
  socket.setTimeout(500);
  socket.once("connect", () => {
    socket.destroy();
    resolve(false);
  });
  socket.once("timeout", () => {
    socket.destroy();
    resolve(true);
  });
  socket.once("error", () => resolve(true));
});

const portsBefore = Object.fromEntries(
  await Promise.all(Object.entries(ports).map(async ([name, port]) => [name, await closed(port) ? "absent" : "occupied"]))
);
if (Object.values(portsBefore).some((value) => value !== "absent")) {
  throw new Error(`assigned Firebase port is occupied: ${JSON.stringify(portsBefore)}`);
}

const rootLock = JSON.parse(await readFile(path.join(workRoot, "package-lock.json"), "utf8"));
const functionsLock = JSON.parse(await readFile(path.join(workRoot, "functions/package-lock.json"), "utf8"));
const identityMaterial = JSON.stringify({ projectId, mode: "fresh-local", services });
const identityHash = sha256(identityMaterial);
const capturedAt = new Date().toISOString();
await mkdir(path.join(receipts, "scenarios"), { recursive: true });
await writeFile(path.join(receipts, "target-identity.json"), `${JSON.stringify({
  schemaVersion: 1,
  capturedAt,
  mode: "fresh-local",
  product: "Firebase Local Emulator Suite",
  projectId,
  identityHash,
  identityMaterialSha256: identityHash,
  services,
  versions: {
    firebaseClient: rootLock.packages["node_modules/firebase"].version,
    firebaseTools: rootLock.packages["node_modules/firebase-tools"].version,
    firebaseAdmin: rootLock.packages["node_modules/firebase-admin"].version,
    firebaseFunctions: functionsLock.packages["node_modules/firebase-functions"].version,
    functionsFirebaseAdmin: functionsLock.packages["node_modules/firebase-admin"].version
  },
  machine: {
    hostname: os.hostname(),
    platform: os.platform(),
    release: os.release(),
    architecture: os.arch(),
    cpu: os.cpus()[0]?.model ?? null,
    logicalCpus: os.cpus().length,
    node: process.version
  },
  hosted: {
    status: "explicit-gap",
    reason: "The refresh uses the provider's authorized official local emulator path; no hosted Firebase target was touched.",
    productFailure: false
  }
}, null, 2)}\n`);
await writeFile(path.join(receipts, "baseline-before.json"), `${JSON.stringify({
  schemaVersion: 1,
  capturedAt,
  projectId,
  targetIdentityHash: identityHash,
  portsBefore,
  namespaceState: "fresh; no emulator process or target data exists",
  unrelatedBaseline: "No shared or hosted target is in scope."
}, null, 2)}\n`);
await writeFile(path.join(receipts, "scoped-cleanup-plan.json"), `${JSON.stringify({
  schemaVersion: 1,
  capturedAt,
  target: { projectId, identityHash },
  exactProcessRoots: ["receipts/emulator.pid", "receipts/vite.pid"],
  exactRuntimeDirectories: [
    ".browser-profile",
    ".firebase-export",
    ".xdg-config",
    ".xdg-cache"
  ],
  assignedPorts: ports,
  broadGlobs: false,
  unrelatedBaseline: "No shared or hosted target will be mutated or deleted.",
  completionProof: "All exact process descendants absent, all assigned ports closed, and arm-local runtime directories absent."
}, null, 2)}\n`);
console.log(JSON.stringify({ ok: true, projectId, identityHash, portsBefore }));
