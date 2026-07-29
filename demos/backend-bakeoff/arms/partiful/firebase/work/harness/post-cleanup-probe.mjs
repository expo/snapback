import { execFileSync } from "node:child_process";
import { readFile, stat, writeFile } from "node:fs/promises";
import net from "node:net";

const armRoot = new URL("../../", import.meta.url);
const plan = JSON.parse(await readFile(new URL("evidence/scoped-cleanup-plan.json", armRoot), "utf8"));
const dataPlane = JSON.parse(await readFile(new URL("evidence/cleanup-data-plane.json", armRoot), "utf8"));

async function open(port) {
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

const portsAfter = Object.fromEntries(await Promise.all(
  plan.assignedPorts.map(async (port) => [String(port), (await open(port)) ? "open" : "closed"]),
));
const processes = execFileSync("ps", ["-ax", "-o", "pid=,command="], { encoding: "utf8" })
  .split("\n")
  .filter((line) => (
    line.includes("llp0102-partiful-firebase-w1")
    || line.includes("cloud-firestore-emulator")
    || line.includes("pubsub-emulator")
  ))
  .filter((line) => !line.includes("post-cleanup-probe.mjs"));
const runtimeStatePath = new URL("state/", armRoot);
const runtimeStatePresent = await stat(runtimeStatePath).then(() => true, () => false);
if (
  Object.values(portsAfter).some((value) => value !== "closed")
  || processes.length > 0
  || dataPlane.after.remainingFirestoreDocs !== 0
  || dataPlane.after.authUsers !== 0
  || dataPlane.after.storageObjects !== 0
  || runtimeStatePresent
) {
  throw new Error(`Post-cleanup probe failed: ${JSON.stringify({ portsAfter, processes })}`);
}
const receipt = {
  schemaVersion: 1,
  capturedAt: new Date().toISOString(),
  exactProjectId: plan.exactProjectId,
  dataPlaneReceipt: "evidence/cleanup-data-plane.json",
  dataPlaneAfter: dataPlane.after,
  portsAfter,
  survivingArmProcesses: [],
  runtimeStatePresent,
  runtimeCache: "Arm state and cache quarantines moved to macOS Trash; recoverable until Trash is emptied.",
  unrelatedBaseline: "No shared or hosted target was used or mutated.",
  status: "complete",
};
await writeFile(
  new URL("evidence/cleanup-complete.json", armRoot),
  `${JSON.stringify(receipt, null, 2)}\n`,
);
process.stdout.write(`${JSON.stringify({ ok: true, receipt })}\n`);
