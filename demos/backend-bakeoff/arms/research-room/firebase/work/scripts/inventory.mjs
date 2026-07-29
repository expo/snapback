import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const armDir = path.resolve(workDir, "..");
const receiptsDir = path.join(armDir, "receipts");
await mkdir(receiptsDir, { recursive: true });

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

async function filesUnder(root, { exclude = new Set() } = {}) {
  const output = [];
  async function visit(target) {
    const metadata = await stat(target);
    if (metadata.isDirectory()) {
      const name = path.basename(target);
      if (exclude.has(name)) return;
      for (const entry of await readdir(target)) await visit(path.join(target, entry));
      return;
    }
    output.push({ path: path.relative(workDir, target), bytes: metadata.size });
  }
  await visit(root);
  return output;
}

async function directoryBytes(root) {
  let bytes = 0;
  async function visit(target) {
    const metadata = await stat(target);
    if (metadata.isDirectory()) {
      for (const entry of await readdir(target)) await visit(path.join(target, entry));
    } else {
      bytes += metadata.size;
    }
  }
  try {
    await visit(root);
  } catch {
    return 0;
  }
  return bytes;
}

function totals(files) {
  return {
    files: files.length,
    bytes: files.reduce((sum, item) => sum + item.bytes, 0),
    paths: files.map((item) => item.path),
  };
}

const allFiles = await filesUnder(workDir, {
  exclude: new Set(["node_modules", ".runtime", ".firebase", "dist"]),
});
const authoredSource = allFiles.filter((item) =>
  /^(src|functions|scripts)\//.test(item.path) && !/package(-lock)?\.json$/.test(item.path),
);
const generated = await filesUnder(path.join(workDir, "dist"));
const tests = allFiles.filter((item) => item.path.startsWith("scripts/"));
const configuration = allFiles.filter((item) =>
  /(^|\/)(package(-lock)?\.json|firebase\.json|\.firebaserc|tsconfig\.json|vite\.config\.ts)$/.test(item.path),
);
const policy = allFiles.filter((item) => /\.(rules|indexes\.json)$/.test(item.path));
const manifests = allFiles.filter((item) => /package(-lock)?\.json$/.test(item.path));
let hub;
try {
  hub = await fetch("http://127.0.0.1:4542/emulators").then((response) => {
    if (!response.ok) throw new Error(`Emulator hub returned ${response.status}`);
    return response.json();
  });
} catch {
  const retained = JSON.parse(
    await readFile(path.join(receiptsDir, "target-identity.json"), "utf8"),
  );
  hub = retained.emulatorHub;
}
const targetIdentity = {
  schemaVersion: 1,
  mode: "fresh-local",
  profile: "Firebase Local Emulator Suite",
  projectIdSha256: sha256("llp0102-research-firebase-w3"),
  emulatorHub: Object.fromEntries(
    Object.entries(hub).map(([name, value]) => [
      name,
      {
        host: value.host,
        port: value.port,
      },
    ]),
  ),
  exactPorts: [4342, 4542, 4543, 5042, 5342, 8142, 8342, 9342, 9343, 9442, 9542],
  credentialValuesRetained: false,
};
await writeFile(path.join(receiptsDir, "target-identity.json"), `${JSON.stringify(targetIdentity, null, 2)}\n`);

const inventory = {
  schemaVersion: 1,
  capturedAt: new Date().toISOString(),
  authoredSource: totals(authoredSource),
  generated: totals(generated),
  tests: totals(tests),
  configuration: totals(configuration),
  policy: totals(policy),
  dependencyManifests: totals(manifests),
  installedDependencyBytes:
    await directoryBytes(path.join(workDir, "node_modules"))
    + await directoryBytes(path.join(workDir, "functions", "node_modules")),
  setupBytes: allFiles.reduce((sum, item) => sum + item.bytes, 0),
  glue: [
    "Firebase emulator launcher with worktree-local XDG, Java, and secret state",
    "provider-native Auth/Firestore/Functions/Storage acceptance harness",
    "scheduled-function emulator trigger adapter",
    "exact target cleanup and capsule finalization scripts",
  ],
};
await writeFile(path.join(receiptsDir, "inventory.json"), `${JSON.stringify(inventory, null, 2)}\n`);

for (const [name, cwd] of [
  ["npm-audit.json", workDir],
  ["functions-npm-audit.json", path.join(workDir, "functions")],
]) {
  const audit = spawnSync("npm", ["audit", "--json"], {
    cwd,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  const payload = audit.stdout || JSON.stringify({
    error: "npm audit produced no JSON",
    exitCode: audit.status,
  });
  await writeFile(path.join(receiptsDir, name), payload.endsWith("\n") ? payload : `${payload}\n`);
}

process.stdout.write(`${JSON.stringify({
  ok: true,
  targetIdentityHash: targetIdentity.projectIdSha256,
  inventory: {
    authoredSource: inventory.authoredSource,
    generated: inventory.generated,
    tests: inventory.tests,
    installedDependencyBytes: inventory.installedDependencyBytes,
  },
})}\n`);
