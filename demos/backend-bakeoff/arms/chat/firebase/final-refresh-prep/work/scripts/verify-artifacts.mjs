import { createHash } from "node:crypto";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();

async function walk(candidate) {
  const info = await stat(candidate);
  if (info.isFile()) return [candidate];
  const entries = await readdir(candidate, { withFileTypes: true });
  const children = await Promise.all(entries.map((entry) => walk(path.join(candidate, entry.name))));
  return children.flat();
}

async function hashes(candidates) {
  const files = (await Promise.all(candidates.map((candidate) => walk(path.join(root, candidate))))).flat();
  const result = {};
  for (const file of files.sort()) {
    const body = await readFile(file);
    result[path.relative(root, file)] = createHash("sha256").update(body).digest("hex");
  }
  return result;
}

function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" });
  return {
    command: [command, ...args].join(" "),
    exitStatus: result.status,
    stdoutTail: result.stdout.trim().split("\n").slice(-12),
    stderrTail: result.stderr.trim().split("\n").slice(-12)
  };
}

const checks = [];
checks.push(run("npm", ["run", "build"]));
for (const file of [
  "functions/index.js",
  "scripts/acceptance.mjs",
  "scripts/build-capsule.mjs",
  "scripts/cleanup.mjs",
  "scripts/finalize-receipts.mjs",
  "scripts/inventory.mjs",
  "scripts/lib.mjs",
  "scripts/offline-browser.mjs",
  "scripts/verify-artifacts.mjs"
]) {
  checks.push(run("node", ["--check", file]));
}
checks.push(run("npm", ["ls", "--depth=0", "--json"]));
checks.push(run("npm", ["ls", "--depth=0", "--json"], path.join(root, "functions")));

const packageLock = JSON.parse(await readFile(path.join(root, "package-lock.json"), "utf8"));
const functionsLock = JSON.parse(await readFile(path.join(root, "functions/package-lock.json"), "utf8"));
const pinned = {
  firebase: packageLock.packages["node_modules/firebase"]?.version,
  firebaseTools: packageLock.packages["node_modules/firebase-tools"]?.version,
  firebaseAdmin: packageLock.packages["node_modules/firebase-admin"]?.version,
  firebaseFunctions: functionsLock.packages["node_modules/firebase-functions"]?.version,
  react: packageLock.packages["node_modules/react"]?.version,
  vite: packageLock.packages["node_modules/vite"]?.version
};
const expected = {
  firebase: "12.16.0",
  firebaseTools: "15.24.0",
  firebaseAdmin: "14.2.0",
  firebaseFunctions: "7.3.2",
  react: "19.1.1",
  vite: "7.1.4"
};

const receipt = {
  schemaVersion: 1,
  capturedAt: new Date().toISOString(),
  checks,
  pinned,
  expected,
  versionsMatch: JSON.stringify(pinned) === JSON.stringify(expected),
  sourceSha256: await hashes(["src", "functions/index.js", "firestore.rules", "database.rules.json"]),
  distSha256: await hashes(["dist"]),
  result: checks.every((check) => check.exitStatus === 0) &&
    JSON.stringify(pinned) === JSON.stringify(expected)
    ? "pass"
    : "fail"
};
await writeFile(path.join(root, "receipts/artifact-verification.json"), `${JSON.stringify(receipt, null, 2)}\n`);
console.log(JSON.stringify({ result: receipt.result, pinned, distFiles: Object.keys(receipt.distSha256).length }, null, 2));
if (receipt.result !== "pass") process.exitCode = 1;
