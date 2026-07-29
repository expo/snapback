import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Role } from "node-appwrite";
import { InputFile } from "node-appwrite/file";
import {
  functionId,
  functions,
  runtime,
  saveRuntime,
} from "./admin-client.mjs";
import {
  apiPort,
  installerName,
  receiptsRoot,
  runtimeRoot,
  workRoot,
} from "./constants.mjs";

runtime.researchCanary ??= randomBytes(32).toString("base64url");
await saveRuntime();
spawnSync("docker", ["rm", "-f", installerName], { stdio: "ignore" });

try {
  await functions.delete({ functionId });
} catch (error) {
  if (error.code !== 404) throw error;
}
await functions.create({
  functionId,
  name: "Research Room worker",
  runtime: "node-16.0",
  execute: [Role.users()],
  events: [],
  schedule: "",
  timeout: 30,
  enabled: true,
  logging: true,
  entrypoint: "src/main.mjs",
  commands: "",
  scopes: ["rows.read", "rows.write"],
});
for (const variable of [
  [
    "appwrite-external",
    "APPWRITE_EXTERNAL_ENDPOINT",
    `http://host.docker.internal:${apiPort}/v1`,
    false,
  ],
  ["arm-api-key", "ARM_API_KEY", runtime.apiKey, true],
  ["research-canary", "RESEARCH_CANARY", runtime.researchCanary, true],
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

const archive = path.resolve(runtimeRoot, "research-worker.tar.gz");
const packed = spawnSync(
  "tar",
  ["-czf", archive, "-C", path.resolve(workRoot, "function"), "."],
  { encoding: "utf8" },
);
if (packed.status !== 0) throw new Error(packed.stderr || "function package failed");
const deployment = await functions.createDeployment({
  functionId,
  code: InputFile.fromPath(archive, "research-worker.tar.gz"),
  activate: true,
  entrypoint: "src/main.mjs",
  commands: "",
});
let ready;
for (let index = 0; index < 120; index += 1) {
  ready = await functions.getDeployment({
    functionId,
    deploymentId: deployment.$id,
  });
  if (ready.status === "ready") break;
  if (ready.status === "failed") throw new Error(`Function build failed: ${ready.buildLogs}`);
  await new Promise((resolve) => setTimeout(resolve, 1000));
}
if (ready?.status !== "ready") {
  throw new Error(`Function build timed out: ${ready?.status}`);
}
await mkdir(receiptsRoot, { recursive: true });
await writeFile(path.resolve(receiptsRoot, "function-deployment.v1.json"), `${JSON.stringify({
  checkedAt: new Date().toISOString(),
  functionId,
  runtime: "node-16.0",
  deploymentId: deployment.$id,
  status: ready.status,
  buildDuration: ready.buildDuration,
  sourceBytes: ready.size,
  secretValuePresent: false,
}, null, 2)}\n`);
console.log(JSON.stringify({
  ok: true,
  functionId,
  deploymentId: deployment.$id,
  status: ready.status,
  secretPrinted: false,
}));
