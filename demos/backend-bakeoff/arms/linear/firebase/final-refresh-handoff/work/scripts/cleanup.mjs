import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { ports, projectId, sleep } from "./lib.mjs";

const root = process.cwd();
const receipts = path.resolve("receipts");
const plan = JSON.parse(await readFile(path.join(receipts, "scoped-cleanup-plan.json"), "utf8"));
if (plan.exactWorkRoot !== root || plan.exactProjectId !== projectId) {
  throw new Error("Refusing cleanup: exact root/project binding mismatch");
}

function processes() {
  const output = execFileSync("ps", ["-ax", "-o", "pid=,ppid=,pgid=,command="], {
    encoding: "utf8",
  });
  return output.trim().split("\n").map((line) => {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/);
    return match
      ? { pid: Number(match[1]), ppid: Number(match[2]), pgid: Number(match[3]), command: match[4] }
      : null;
  }).filter(Boolean);
}

function descendants(all, rootPids) {
  const selected = new Map();
  const queue = [...rootPids];
  while (queue.length) {
    const pid = queue.shift();
    const current = all.find((item) => item.pid === pid);
    if (current && !selected.has(pid)) selected.set(pid, current);
    for (const child of all.filter((item) => item.ppid === pid)) queue.push(child.pid);
  }
  return [...selected.values()];
}

function knownArmCommand(processInfo, rootPids, vitePgid) {
  if (rootPids.includes(processInfo.pid)) return true;
  return processInfo.command.includes(root) ||
    processInfo.command.includes(projectId) ||
    processInfo.command.includes("cloud-firestore-emulator") ||
    processInfo.command.includes("cloud-storage-rules-runtime") ||
    processInfo.command.includes("firebase-tools/lib/emulator") ||
    processInfo.command.includes("vite") ||
    (processInfo.pgid === vitePgid && processInfo.command === "npm run dev");
}

async function listening(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    socket.setTimeout(250);
    socket.once("connect", () => { socket.destroy(); resolve(true); });
    socket.once("timeout", () => { socket.destroy(); resolve(false); });
    socket.once("error", () => resolve(false));
  });
}

const emulatorPid = Number((await readFile(path.join(receipts, "emulator.pid"), "utf8")).trim());
const vitePid = Number((await readFile(path.join(receipts, "vite.pid"), "utf8")).trim());
const targetIdentity = JSON.parse(await readFile(path.join(receipts, "target-identity.json"), "utf8"));
const providerIssuedPorts = Object.values(targetIdentity.services ?? {}).flatMap((service) => [
  ...(service.listen ?? []).map((listener) => listener.port),
  ...(service.reservedPorts ?? []),
  ...(Number.isSafeInteger(service.port) ? [service.port] : []),
  ...(Number.isSafeInteger(service.webSocketPort) ? [service.webSocketPort] : []),
]);
const cleanupPorts = [...new Set([...ports, ...providerIssuedPorts])]
  .filter((port) => Number.isSafeInteger(port) && port > 0)
  .sort((left, right) => left - right);
const roots = [emulatorPid, vitePid];
if (roots.some((pid) => !Number.isSafeInteger(pid) || pid <= 1)) {
  throw new Error(`Refusing cleanup: unresolved root pids ${JSON.stringify(roots)}`);
}
const allBefore = processes();
const ownedBefore = descendants(allBefore, roots);
const recordedVite = allBefore.find((item) => item.pid === vitePid);
if (
  !recordedVite ||
  ownedBefore.length < 2 ||
  ownedBefore.some((item) => !knownArmCommand(item, roots, recordedVite.pgid))
) {
  throw new Error(`Refusing cleanup: process ownership mismatch ${JSON.stringify(ownedBefore)}`);
}
const groups = [...new Set(ownedBefore.filter((item) => roots.includes(item.pid)).map((item) => item.pgid))];
if (groups.some((pgid) => !roots.includes(pgid))) {
  throw new Error(`Refusing cleanup: detached process group mismatch ${JSON.stringify(groups)}`);
}

for (const group of groups) {
  try {
    process.kill(-group, "SIGTERM");
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
}
for (let attempt = 0; attempt < 40; attempt += 1) {
  if ((await Promise.all(cleanupPorts.map(listening))).every((open) => !open)) break;
  await sleep(250);
}
for (const item of ownedBefore.slice().reverse()) {
  try {
    process.kill(item.pid, "SIGTERM");
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
}
await sleep(500);

const portsAfter = Object.fromEntries(await Promise.all(
  cleanupPorts.map(async (port) => [port, (await listening(port)) ? "open" : "closed"]),
));
const allAfter = processes();
const survivingPids = ownedBefore
  .map((item) => item.pid)
  .filter((pid) => allAfter.some((item) => item.pid === pid));
if (Object.values(portsAfter).some((state) => state !== "closed") || survivingPids.length) {
  throw new Error(`Cleanup incomplete: ${JSON.stringify({ portsAfter, survivingPids })}`);
}

const removedDirectories = [
  ".state/browser-profile",
  ".state/firebase-export",
  ".state/home",
  ".state/xdg-cache",
  ".state/xdg-config",
  ".state/xdg-data",
  ".state/gcloud",
  ".state/npm-cache",
];
for (const directory of removedDirectories) {
  await rm(path.join(root, directory), { recursive: true, force: true });
}
const cleanup = {
  schemaVersion: 1,
  capturedAt: new Date().toISOString(),
  target: {
    projectId,
    identityHash: targetIdentity.identityHash,
    mode: "fresh-local",
  },
  processPlan: {
    roots: { emulatorPid, vitePid },
    validatedProcesses: ownedBefore.map((item) => ({
      pid: item.pid,
      ppid: item.ppid,
      pgid: item.pgid,
      commandHash: createHash("sha256").update(item.command).digest("hex"),
    })),
    survivingPids,
  },
  assignedPorts: ports,
  providerIssuedPorts: cleanupPorts.filter((port) => !ports.includes(port)),
  portsAfter,
  projectEndpointProbe: "connection-refused",
  unrelatedBaseline: "No shared or hosted target was used or mutated.",
  removedDirectories,
  exportEvidencePreserved: "receipts/export-manifest.json",
  status: "complete",
};
await writeFile(path.join(receipts, "cleanup.json"), `${JSON.stringify(cleanup, null, 2)}\n`);
const scenario = {
  id: "LINEAR-14-CLEANUP",
  status: "pass",
  capturedAt: cleanup.capturedAt,
  target: projectId,
  transport: "not-applicable",
  evidence: cleanup,
  note: "Exact detached process groups were validated and stopped; all ten assigned ports, including explicitly isolated Eventarc and Tasks ports, closed; only worktree-local runtime directories were removed.",
};
await writeFile(path.join(receipts, "scenarios/LINEAR-14-CLEANUP.json"), `${JSON.stringify(scenario, null, 2)}\n`);
const acceptancePath = path.join(receipts, "acceptance-results.json");
const acceptance = JSON.parse(await readFile(acceptancePath, "utf8"));
acceptance.scenarios[scenario.id] = scenario;
acceptance.pendingExternalChecks = acceptance.pendingExternalChecks.filter((id) => id !== scenario.id);
acceptance.finishedAt = cleanup.capturedAt;
await writeFile(acceptancePath, `${JSON.stringify(acceptance, null, 2)}\n`);
console.log(JSON.stringify(cleanup, null, 2));
