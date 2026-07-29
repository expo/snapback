import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const armDir = path.resolve(workDir, "..");
const evidenceDir = path.join(armDir, "evidence");
const receiptsDir = path.join(armDir, "receipts");
await mkdir(receiptsDir, { recursive: true });

const readJson = async (target) => JSON.parse(await readFile(target, "utf8"));
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const capsule = await readJson(path.join(armDir, "run-capsule.v1.json"));
const acceptance = await readJson(path.join(evidenceDir, "acceptance-results.json"));
const performance = await readJson(path.join(evidenceDir, "performance.json"));
const cleanup = await readJson(path.join(receiptsDir, "cleanup-final.json"));
const manifest = await readJson(
  path.resolve(armDir, "../../../protocol/acceptance/research-room.v1.json"),
);

assert.equal(capsule.result, "complete");
assert.equal(acceptance.resultCount, manifest.expectedCheckCount);
assert.equal(acceptance.results.length, manifest.expectedCheckCount);
assert.equal(new Set(acceptance.results.map((result) => result.id)).size, manifest.expectedCheckCount);
assert.deepEqual(
  acceptance.results.map((result) => result.id),
  manifest.scenarios.map((scenario) => scenario.id),
);
assert.equal(acceptance.results.every((result) => result.status === "PASS"), true);
assert.deepEqual(
  capsule.scenarioResults.map((result) => result.id),
  manifest.scenarios.map((scenario) => scenario.id),
);
assert.equal(capsule.scenarioResults.every((result) => result.status === "pass"), true);
assert.deepEqual(capsule.stopDefects, []);

assert.equal(performance.paths.length, 5);
for (const samplePath of performance.paths) {
  assert.equal(samplePath.warmups.length, 2);
  assert.equal(samplePath.rawSamples.length, 7);
  assert.equal(samplePath.successfulSamples, 7);
  assert.equal(samplePath.failedSamples, 0);
}

const referencedPaths = new Set();
for (const scenario of capsule.scenarioResults) {
  for (const target of scenario.evidencePaths) referencedPaths.add(target);
}
for (const event of capsule.assistanceEvents) {
  for (const target of event.receiptPaths ?? []) referencedPaths.add(target);
}
referencedPaths.add(capsule.inventory.receiptPath);
for (const target of capsule.inventory.npmAuditReceiptPaths) referencedPaths.add(target);
for (const confidence of Object.values(capsule.evidenceConfidence)) {
  for (const target of confidence.evidencePaths) referencedPaths.add(target);
}
referencedPaths.add(capsule.cleanup.targetBoundPlanPath);
for (const target of capsule.cleanup.receiptPaths) referencedPaths.add(target);
for (const target of referencedPaths) await access(path.join(armDir, target));

const ui = await readJson(path.join(receiptsDir, "ui-smoke.json"));
const screenshot = await readFile(path.join(armDir, ui.screenshot));
assert.equal(sha256(screenshot), ui.screenshotSha256);
const projectHash = sha256("llp0102-research-firebase-w3");
assert.equal(capsule.targets.binding.identityHash, projectHash);
assert.equal(cleanup.projectIdSha256, projectHash);
assert.equal(Object.values(cleanup.processPhase.assignedPortsClosed).every(Boolean), true);
assert.equal(cleanup.processPhase.ownedProcessesRemaining, 0);
assert.equal(cleanup.residualResources.length, 0);

const secretHits = [];
const secretPatterns = [
  /llp0102-canary-[a-f0-9]{48}/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /AIza[0-9A-Za-z_-]{30,}/,
  /"(?:refresh_token|access_token|private_key)"\s*:\s*"[^"]{12,}"/,
];
async function scan(target) {
  const metadata = await stat(target);
  if (metadata.isDirectory()) {
    const name = path.basename(target);
    if (name === "node_modules" || name === ".runtime" || name === ".git") return;
    for (const entry of await readdir(target)) await scan(path.join(target, entry));
    return;
  }
  const content = await readFile(target);
  if (content.includes(0)) return;
  const text = content.toString("utf8");
  if (secretPatterns.some((pattern) => pattern.test(text))) {
    secretHits.push(path.relative(armDir, target));
  }
}
await scan(armDir);
assert.deepEqual(secretHits, []);
let runtimeAbsent = false;
try {
  await access(path.join(workDir, ".runtime"));
} catch {
  runtimeAbsent = true;
}
assert.equal(runtimeAbsent, true);

const receipt = {
  schemaVersion: 1,
  verifiedAt: new Date().toISOString(),
  checks: {
    exactScenarioOrder: true,
    expectedScenarios: 15,
    pass: 15,
    gap: 0,
    pending: 0,
    fail: 0,
    stop: 0,
    referencedArtifactPaths: referencedPaths.size,
    missingArtifactPaths: 0,
    screenshotSha256Matched: true,
    targetIdentityHashesMatched: true,
    performancePaths: 5,
    warmupsPerPath: 2,
    successfulSamplesPerPath: 7,
    assignedPortsClosed: true,
    ownedProcessesRemaining: 0,
    runtimeAbsent,
    secretPatternHits: secretHits,
  },
};
await writeFile(
  path.join(receiptsDir, "artifact-verification.json"),
  `${JSON.stringify(receipt, null, 2)}\n`,
);
process.stdout.write(`${JSON.stringify({ ok: true, ...receipt.checks })}\n`);
