import { readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import net from "node:net";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = process.cwd();
const receipts = path.join(root, "receipts");
const expectedRoot = "/Users/ccheever/worktrees/llp0102-chat-firebase/demos/backend-bakeoff/arms/chat/firebase/work";
const ports = [9299, 8280, 9280, 5287, 4287, 4501, 4502, 9150];

function processes() {
  const output = execFileSync("ps", ["-ax", "-o", "pid=,ppid=,command="], { encoding: "utf8" });
  return output.trim().split("\n").map((line) => {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/);
    return match ? { pid: Number(match[1]), ppid: Number(match[2]), command: match[3] } : null;
  }).filter(Boolean);
}

function descendants(all, roots) {
  const selected = new Map();
  const queue = [...roots];
  while (queue.length) {
    const pid = queue.shift();
    const item = all.find((process) => process.pid === pid);
    if (item && !selected.has(pid)) selected.set(pid, item);
    for (const child of all.filter((process) => process.ppid === pid)) queue.push(child.pid);
  }
  return [...selected.values()];
}

function armOwned(process) {
  return process.command.includes(expectedRoot) ||
    process.command.includes("node ./node_modules/.bin/firebase emulators:start --project llp0102-chat-firebase-w1") ||
    process.command.includes("npm run dev") ||
    process.command.includes(".cache/firebase/emulators/cloud-firestore-emulator") ||
    process.command.includes(".cache/firebase/emulators/firebase-database-emulator");
}

function listening(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    socket.setTimeout(300);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => resolve(false));
  });
}

const emulatorPid = Number((await readFile(path.join(receipts, "emulator.pid"), "utf8")).trim());
const vitePid = Number((await readFile(path.join(receipts, "vite.pid"), "utf8")).trim());
const allBefore = processes();
const ownedBefore = descendants(allBefore, [emulatorPid, vitePid]);
if (ownedBefore.length === 0 || ownedBefore.some((process) => !armOwned(process))) {
  throw new Error(`Refusing cleanup: unresolved process ownership ${JSON.stringify(ownedBefore)}`);
}

for (const pid of [vitePid, emulatorPid]) {
  try {
    process.kill(pid, "SIGTERM");
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
}
await new Promise((resolve) => setTimeout(resolve, 1500));
for (const processInfo of ownedBefore.slice().reverse()) {
  try {
    process.kill(processInfo.pid, "SIGTERM");
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
}

await new Promise((resolve) => setTimeout(resolve, 1500));
const portsAfter = {};
for (const port of ports) portsAfter[port] = (await listening(port)) ? "open" : "closed";
const allAfter = processes();
const survivingPids = ownedBefore
  .map((process) => process.pid)
  .filter((pid) => allAfter.some((process) => process.pid === pid));

if (Object.values(portsAfter).some((status) => status !== "closed") || survivingPids.length) {
  throw new Error(`Cleanup incomplete: ${JSON.stringify({ portsAfter, survivingPids })}`);
}

const removedDirectories = [
  ".browser-profile",
  ".firebase-export",
  ".xdg-config",
  ".xdg-cache"
];
for (const directory of removedDirectories) {
  await rm(path.join(root, directory), { recursive: true, force: true });
}

const result = {
  schemaVersion: 1,
  capturedAt: new Date().toISOString(),
  target: {
    projectId: "llp0102-chat-firebase-w1",
    identityHash: "73f32a095a9b3bd04be47c25ab47b377066a3705f9ca0bde890e99b734cdaa5b",
    mode: "fresh-local"
  },
  processPlan: {
    roots: { emulatorPid, vitePid },
    validatedProcesses: ownedBefore.map((process) => ({
      pid: process.pid,
      ppid: process.ppid,
      commandHash: createHash("sha256").update(process.command).digest("hex")
    })),
    survivingPids
  },
  portsAfter,
  projectEndpointProbe: "connection-refused",
  unrelatedBaseline: "No shared or hosted target was used or mutated.",
  removedDirectories,
  preservedEvidence: [
    "receipts/export-file-sha256.txt",
    "receipts/export-size-kib.txt",
    "receipts/scenarios",
    "receipts/acceptance-results.json",
    "receipts/performance.json"
  ],
  status: "complete"
};
await writeFile(path.join(receipts, "cleanup.json"), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
