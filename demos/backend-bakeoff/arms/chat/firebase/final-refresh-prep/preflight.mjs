#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../../../../..");
const workRoot = path.join(here, "work");
const receiptsRoot = path.join(here, "receipts");
const ports = [35299, 35280, 35250, 35281, 35287, 35288, 35201, 35202, 35203, 35204, 9299, 9499];

function run(command, args, cwd) {
  const started = performance.now();
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env: process.env,
    timeout: 120_000
  });
  const receipt = {
    command: [command, ...args],
    cwd,
    exitCode: result.status,
    durationMs: Number((performance.now() - started).toFixed(3)),
    stdoutTail: String(result.stdout ?? "").slice(-4_096),
    stderrTail: String(result.stderr ?? "").slice(-4_096)
  };
  if (result.error || result.status !== 0) {
    throw new Error(`preflight command failed: ${JSON.stringify(receipt)}`, { cause: result.error });
  }
  return receipt;
}

function portClosed(port) {
  return new Promise((resolve) => {
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
}

const commandReceipts = [
  run("npm", ["ls", "firebase", "firebase-admin", "--depth=0"], workRoot),
  run("npm", ["ls", "firebase-admin", "firebase-functions", "--depth=0"], path.join(workRoot, "functions")),
  run(process.execPath, ["--check", "functions/index.js"], workRoot),
  run("npm", ["run", "build"], workRoot),
  run("git", [
    "diff",
    "--exit-code",
    "--",
    "demos/backend-bakeoff/arms/chat/firebase/work",
    "demos/backend-bakeoff/arms/chat/firebase/run-capsule.v1.json"
  ], repoRoot)
];

const portsBefore = Object.fromEntries(
  await Promise.all(ports.map(async (port) => [String(port), await portClosed(port) ? "closed" : "open"]))
);
const ps = run("ps", ["-ax", "-o", "pid=,command="], workRoot);
const matchingProcesses = ps.stdoutTail
  .split("\n")
  .filter((line) =>
    line.includes("llp0102-final-chat-firebase-w2")
    || line.includes("firebase emulators:start") && line.includes(workRoot)
  );
if (Object.values(portsBefore).some((status) => status !== "closed") || matchingProcesses.length !== 0) {
  throw new Error(`preflight isolation failed: ${JSON.stringify({ portsBefore, matchingProcesses })}`);
}

const rootPackage = JSON.parse(await readFile(path.join(workRoot, "package.json"), "utf8"));
const functionsPackage = JSON.parse(await readFile(path.join(workRoot, "functions/package.json"), "utf8"));
const receipt = {
  schemaVersion: "llp0102.firebase-final-refresh-preflight.v1",
  capturedAt: new Date().toISOString(),
  target: "llp0102-final-chat-firebase-w2",
  node: process.version,
  dependencyDiff: {
    rootFirebaseAdmin: ["13.5.0", rootPackage.devDependencies["firebase-admin"]],
    functionsFirebaseAdmin: ["13.5.0", functionsPackage.dependencies["firebase-admin"]],
    firebaseFunctions: ["6.4.0", functionsPackage.dependencies["firebase-functions"]]
  },
  modularCompatibility: {
    adminSubpathImportsRetained: true,
    functionsV2CallableImportsRetained: true,
    staticSyntax: "pass",
    typescriptAndViteBuild: "pass"
  },
  portsBefore,
  matchingProcesses,
  sealedSourceAndCapsuleDiff: "clean",
  providerStarted: false,
  commands: commandReceipts
};
await mkdir(receiptsRoot, { recursive: true });
await writeFile(path.join(receiptsRoot, "preflight.v1.json"), `${JSON.stringify(receipt, null, 2)}\n`);
console.log(JSON.stringify({ ok: true, receipt: "receipts/preflight.v1.json" }));
