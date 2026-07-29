import { readFile, writeFile } from "node:fs/promises";

const armRoot = new URL("../../", import.meta.url);
const localPath = new URL("evidence/party-14-performance-local.json", armRoot);
const buildPath = new URL("evidence/party-14-build-samples.json", armRoot);
const [local, build] = await Promise.all([
  readFile(localPath, "utf8").then(JSON.parse),
  readFile(buildPath, "utf8").then(JSON.parse),
]);

function freezeSamples(values) {
  if (!Array.isArray(values) || values.length !== 9) {
    throw new Error("Expected exactly two warmups plus seven recorded samples");
  }
  const warmupsMs = values.slice(0, 2);
  const recordedSamplesMs = values.slice(2);
  const ordered = [...recordedSamplesMs].sort((left, right) => left - right);
  return {
    warmupsMs,
    recordedSamplesMs,
    medianMs: Number(ordered[3].toFixed(3)),
    nearestRankP95Ms: Number(ordered[6].toFixed(3)),
    recordedSampleCount: 7,
  };
}

local.samplePolicy = "Two warmups followed by seven recorded sequential samples per path.";
local.summary = Object.fromEntries(Object.entries(local.summary).map(([name, result]) => [
  name === "offline-reconnect" ? "reconnect" : name,
  freezeSamples(result.samplesMs),
]));
local.costWindow = {
  begins: "fresh isolated emulator target preflight/provisioning",
  ends: "scoped target cleanup and listener shutdown",
  actualProviderUsage: "Firebase emulator instrumentation does not expose billable managed usage.",
  listPriceEstimate: "Local Emulator Suite: USD 0.00. No hosted extrapolation is claimed because hosted credentials were unavailable.",
};
await writeFile(localPath, `${JSON.stringify(local, null, 2)}\n`);

Object.assign(build, freezeSamples(build.samplesMs));
delete build.samplesMs;
delete build.p95ObservedMs;
delete build.sampleCount;
await writeFile(buildPath, `${JSON.stringify(build, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ ok: true, paths: Object.keys(local.summary).length + 1 })}\n`);
