import { access, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const armDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readJson = async (relative) => JSON.parse(await readFile(path.join(armDir, relative), "utf8"));
const acceptance = await readJson("evidence/acceptance-results.json");
const performance = await readJson("evidence/performance-samples.json");
const cleanup = await readJson("evidence/cleanup-receipt.json");
const capsule = await readJson("run-capsule.v1.json");
const secretScan = await readJson("evidence/secret-scan.json");
const problems = [];

if (acceptance.expectedCheckCount !== 15 || acceptance.completedCheckCount !== 15) problems.push("acceptance count is not 15/15");
if (acceptance.scenarios.length !== 15 || new Set(acceptance.scenarios.map((s) => s.id)).size !== 15) problems.push("acceptance ids are incomplete or duplicated");
if (acceptance.scenarios.some((s) => !["pass", "gap"].includes(s.status))) problems.push("acceptance has non-final status");
if (acceptance.summary.pass !== 11 || acceptance.summary.gap !== 4 || acceptance.summary.fail !== 0 || acceptance.summary.stop !== 0) {
  problems.push("acceptance summary differs from 11 PASS / 4 GAP / 0 FAIL / 0 Stop");
}
for (const scenario of acceptance.scenarios) {
  for (const evidencePath of scenario.evidencePaths) {
    try { await access(path.join(armDir, evidencePath)); }
    catch { problems.push(`${scenario.id} evidence missing: ${evidencePath}`); }
  }
}
if (performance.paths.length !== 5) problems.push("performance path count is not five");
for (const sample of performance.paths) {
  if (sample.warmups.length !== 2 || sample.samples.length !== 7) problems.push(`${sample.path} is not 2+7`);
}
if (Object.values(cleanup.countsAfter).some((count) => count !== 0)) problems.push("post-cleanup authoritative count is nonzero");
if (!Object.values(cleanup.deletedUserTokensInvalid).every(Boolean)) problems.push("an actor token remained valid");
if (!secretScan.passed || secretScan.matches.length !== 0) problems.push("secret scan did not pass cleanly");
if (capsule.scenarioResults.length !== 15 || capsule.result !== "complete" || capsule.stopDefects.length !== 0) problems.push("run capsule is not final");
try { await access(path.join(armDir, "work/.arm-runtime")); problems.push("ignored runtime still exists"); } catch {}

const receipt = {
  schemaVersion: 1,
  verifiedAt: new Date().toISOString(),
  checks: {
    acceptance: "15/15 final; 11 pass, 4 gap, 0 fail, 0 stop",
    evidencePaths: "all scenario paths exist",
    performance: "five paths, each exactly two warmups plus seven samples",
    cleanup: "all authoritative counts zero and all actor tokens invalid",
    secretScan: "passed with zero exact-value matches",
    localRuntime: "absent",
    capsule: "final with zero Stop defects",
  },
  problems,
  ok: problems.length === 0,
  containsCredentialValues: false,
};
await writeFile(path.join(armDir, "evidence/artifact-verification.json"), `${JSON.stringify(receipt, null, 2)}\n`);
if (problems.length) throw new Error(`Artifact verification failed: ${problems.join("; ")}`);
process.stdout.write(JSON.stringify({ ok: true, checks: Object.keys(receipt.checks).length }) + "\n");
