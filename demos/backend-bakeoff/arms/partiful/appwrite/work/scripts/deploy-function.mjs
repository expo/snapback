import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Role } from "node-appwrite";
import { InputFile } from "node-appwrite/file";
import { functionId, functions, runtime, saveRuntime } from "./admin-client.mjs";
import { installerName, receiptsRoot, runtimeRoot, workRoot } from "./constants.mjs";

runtime.effectSecret ??= randomBytes(32).toString("base64url");
if (runtime.effectSinkPid) {
  try { process.kill(runtime.effectSinkPid, "SIGTERM"); } catch {}
}
await saveRuntime();
spawnSync("docker", ["rm", "-f", installerName], { stdio: "ignore" });
const sinkName = "llp0102-partiful-appwrite-w3-effect-sink";
spawnSync("docker", ["rm", "-f", sinkName], { stdio: "ignore" });
const effectEnv = path.resolve(runtimeRoot, "effect.env");
await writeFile(effectEnv, `EFFECT_SECRET=${runtime.effectSecret}\nEFFECT_PORT=20082\nEFFECT_RUNTIME_ROOT=/runtime\n`);
await chmod(effectEnv, 0o600);
const created = spawnSync("docker", [
  "create", "--name", sinkName, "--network", "runtimes",
  "--label", `llp0102.arm=${runtime.projectId ?? "llp0102-partiful-appwrite-w3"}`,
  "-p", "20082:20082", "--env-file", effectEnv,
  "--entrypoint", "node", "openruntimes/node:v5-22", "/sink.mjs",
], { encoding: "utf8" });
if (created.status !== 0) throw new Error(created.stderr || "effect sink container creation failed");
const copied = spawnSync("docker", ["cp", path.resolve(workRoot, "scripts/effect-sink.mjs"), `${sinkName}:/sink.mjs`], { encoding: "utf8" });
if (copied.status !== 0) throw new Error(copied.stderr || "effect sink copy failed");
const started = spawnSync("docker", ["start", sinkName], { encoding: "utf8" });
if (started.status !== 0) throw new Error(started.stderr || "effect sink start failed");
runtime.effectSinkContainer = sinkName;
delete runtime.effectSinkPid;
await saveRuntime();
for (let index = 0; index < 30; index += 1) {
  try {
    const response = await fetch("http://127.0.0.1:20082", { method: "POST" });
    if (response.status === 403) break;
  } catch {}
  await new Promise((resolve) => setTimeout(resolve, 100));
}

try { await functions.delete({ functionId }); } catch (error) {
  if (error.code !== 404) throw error;
}
await functions.create({
  functionId,
  name: "Partiful notification worker",
  runtime: "node-22",
  execute: [Role.users()],
  events: [],
  schedule: "",
  timeout: 15,
  enabled: true,
  logging: true,
  entrypoint: "src/main.mjs",
  commands: "",
  scopes: ["rows.read", "rows.write"],
});
for (const variable of [
  ["effect-url", "EFFECT_URL", `http://${sinkName}:20082/notify`, false],
  ["appwrite-external", "APPWRITE_EXTERNAL_ENDPOINT", "http://host.docker.internal:8092/v1", false],
  ["effect-secret", "EFFECT_SECRET", runtime.effectSecret, true],
  ["arm-api-key", "ARM_API_KEY", runtime.apiKey, true],
]) {
  try {
    await functions.createVariable({
      functionId,
      variableId: variable[0],
      key: variable[1],
      value: variable[2],
      secret: variable[3],
    });
  } catch (error) {
    if (error.code !== 409) throw error;
    await functions.updateVariable({
      functionId,
      variableId: variable[0],
      key: variable[1],
      value: variable[2],
      secret: variable[3],
    });
  }
}
const archive = path.resolve(runtimeRoot, "party-worker.tar.gz");
const packed = spawnSync("tar", ["-czf", archive, "-C", path.resolve(workRoot, "function"), "."], { encoding: "utf8" });
if (packed.status !== 0) throw new Error(packed.stderr || "function package failed");
const deployment = await functions.createDeployment({
  functionId,
  code: InputFile.fromPath(archive, "party-worker.tar.gz"),
  activate: true,
  entrypoint: "src/main.mjs",
  commands: "",
});
let ready;
for (let index = 0; index < 120; index += 1) {
  ready = await functions.getDeployment({ functionId, deploymentId: deployment.$id });
  if (ready.status === "ready") break;
  if (ready.status === "failed") throw new Error(`Function build failed: ${ready.buildLogs}`);
  await new Promise((resolve) => setTimeout(resolve, 1000));
}
if (ready?.status !== "ready") throw new Error(`Function build timed out: ${ready?.status}`);
await mkdir(receiptsRoot, { recursive: true });
await writeFile(path.resolve(receiptsRoot, "function-deployment.v1.json"), `${JSON.stringify({
  checkedAt: new Date().toISOString(),
  functionId,
  runtime: "node-22",
  deploymentId: deployment.$id,
  status: ready.status,
  buildDuration: ready.buildDuration,
  sourceBytes: ready.size,
  secretValuePresent: false,
}, null, 2)}\n`);
console.log(JSON.stringify({ ok: true, functionId, deploymentId: deployment.$id, status: ready.status, secretPrinted: false }));
