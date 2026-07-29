import net from "node:net";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const projectId = "llp0102-linear-firebase-w2";
const ports = [9321, 8321, 5321, 9421, 4321, 4521, 4522];

const receipts = path.resolve("receipts");
await mkdir(receipts, { recursive: true });

async function open(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    socket.setTimeout(250);
    socket.once("connect", () => { socket.destroy(); resolve(true); });
    socket.once("timeout", () => { socket.destroy(); resolve(false); });
    socket.once("error", () => resolve(false));
  });
}

const portStates = Object.fromEntries(await Promise.all(
  ports.map(async (port) => [port, (await open(port)) ? "open" : "closed"]),
));
if (Object.values(portStates).some((state) => state !== "closed")) {
  throw new Error(`Fresh-local preflight refused occupied ports: ${JSON.stringify(portStates)}`);
}
const capturedAt = new Date().toISOString();
const baseline = {
  schemaVersion: 1,
  capturedAt,
  mode: "fresh-local",
  projectId,
  namespace: projectId,
  projectAbsentBeforeProvision: true,
  portStates,
  unrelatedBaseline: "No shared or hosted target will be used.",
};
const cleanupPlan = {
  schemaVersion: 1,
  capturedAt,
  exactWorkRoot: process.cwd(),
  exactProjectId: projectId,
  rootPidReceipts: ["receipts/emulator.pid", "receipts/vite.pid"],
  exactPorts: ports,
  removableRuntimeDirectories: [
    ".browser-profile",
    ".firebase-export",
    ".xdg-cache",
    ".xdg-config",
  ],
  forbidden: ["wildcards", "account-wide deletion", "shared-target deletion", "unresolved target"],
};
await writeFile(path.join(receipts, "baseline-before.json"), `${JSON.stringify(baseline, null, 2)}\n`);
await writeFile(path.join(receipts, "scoped-cleanup-plan.json"), `${JSON.stringify(cleanupPlan, null, 2)}\n`);
console.log(JSON.stringify({ baseline, cleanupPlan }, null, 2));
