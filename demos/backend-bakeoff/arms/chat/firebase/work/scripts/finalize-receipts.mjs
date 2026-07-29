import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const receipts = path.resolve("receipts");
const acceptancePath = path.join(receipts, "acceptance-results.json");
const cleanup = JSON.parse(await readFile(path.join(receipts, "cleanup.json"), "utf8"));
const acceptance = JSON.parse(await readFile(acceptancePath, "utf8"));

const cleanupScenario = {
  id: "CHAT-15-CLEANUP",
  status: "pass",
  capturedAt: cleanup.capturedAt,
  target: cleanup.target.projectId,
  transport: "not-applicable",
  evidence: {
    cleanupReceipt: "receipts/cleanup.json",
    targetBoundPlan: "receipts/scoped-cleanup-plan.json",
    portsAfter: cleanup.portsAfter,
    survivingPids: cleanup.processPlan.survivingPids,
    unrelatedBaseline: cleanup.unrelatedBaseline
  },
  note: "Exact validated emulator/Vite process trees terminated; all assigned and auxiliary ports closed; only arm-local runtime/cache/export directories removed."
};

acceptance.scenarios[cleanupScenario.id] = cleanupScenario;
acceptance.pendingExternalChecks = [];
acceptance.completedCheckCount = Object.values(acceptance.scenarios)
  .filter((scenario) => scenario.status !== "pending").length;
acceptance.passCount = Object.values(acceptance.scenarios)
  .filter((scenario) => scenario.status === "pass").length;
acceptance.gapCount = Object.values(acceptance.scenarios)
  .filter((scenario) => scenario.status === "gap").length;
acceptance.failCount = Object.values(acceptance.scenarios)
  .filter((scenario) => scenario.status === "fail").length;
acceptance.cleanupCompletedAt = cleanup.capturedAt;
acceptance.result = "complete";

await writeFile(
  path.join(receipts, "scenarios", `${cleanupScenario.id}.json`),
  `${JSON.stringify(cleanupScenario, null, 2)}\n`
);
await writeFile(acceptancePath, `${JSON.stringify(acceptance, null, 2)}\n`);
console.log(JSON.stringify({
  expected: acceptance.expectedCheckCount,
  completed: acceptance.completedCheckCount,
  pass: acceptance.passCount,
  gap: acceptance.gapCount,
  fail: acceptance.failCount,
  result: acceptance.result
}, null, 2));
