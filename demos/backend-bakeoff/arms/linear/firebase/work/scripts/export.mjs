import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { projectId } from "./lib.mjs";

const exportDirectory = path.resolve(".firebase-export");
await mkdir("receipts", { recursive: true });
const started = performance.now();
const result = await new Promise((resolve, reject) => {
  const child = spawn(
    path.resolve("node_modules/.bin/firebase"),
    ["emulators:export", exportDirectory, "--project", projectId, "--force"],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        XDG_CONFIG_HOME: path.resolve(".xdg-config"),
        XDG_CACHE_HOME: path.resolve(".xdg-cache"),
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.once("error", reject);
  child.once("exit", (exitStatus) => resolve({ exitStatus: exitStatus ?? 1, stdout, stderr }));
});
await writeFile("receipts/export.stdout.log", result.stdout);
await writeFile("receipts/export.stderr.log", result.stderr);
if (result.exitStatus !== 0) throw new Error(`Firebase export failed: ${result.stderr}`);

async function files(directory) {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...await files(absolute));
    else if (entry.isFile()) output.push(absolute);
  }
  return output;
}
const manifestFiles = [];
for (const absolute of await files(exportDirectory)) {
  const body = await readFile(absolute);
  manifestFiles.push({
    path: path.relative(exportDirectory, absolute),
    bytes: (await stat(absolute)).size,
    sha256: createHash("sha256").update(body).digest("hex"),
  });
}
manifestFiles.sort((left, right) => left.path.localeCompare(right.path));
const manifest = {
  schemaVersion: 1,
  capturedAt: new Date().toISOString(),
  projectId,
  exitStatus: result.exitStatus,
  durationMs: Number((performance.now() - started).toFixed(3)),
  files: manifestFiles,
  aggregateSha256: createHash("sha256")
    .update(JSON.stringify(manifestFiles))
    .digest("hex"),
};
await writeFile("receipts/export-manifest.json", `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify(manifest, null, 2));
