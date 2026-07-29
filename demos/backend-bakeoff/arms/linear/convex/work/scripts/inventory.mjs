import { execFile } from "node:child_process";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { resolve, relative } from "node:path";

const exec = promisify(execFile);
const root = resolve(import.meta.dirname, "..");
const armRoot = resolve(root, "..");
const receipts = resolve(armRoot, "receipts");
const ignored = new Set(["node_modules", "dist", ".convex", ".arm-runtime"]);
async function filesUnder(directory) {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) output.push(...await filesUnder(path));
    else output.push(path);
  }
  return output;
}
const authored = (await filesUnder(root)).filter((path) => !path.includes("/convex/_generated/"));
const generated = await filesUnder(resolve(root, "convex/_generated"));
let authoredLines = 0;
for (const path of authored) authoredLines += (await readFile(path, "utf8")).split("\n").length - 1;
const dependencyBytes = Number((await exec("du", ["-sk", resolve(root, "node_modules")])).stdout.trim().split(/\s+/)[0]) * 1024;
let audit;
try {
  audit = JSON.parse((await exec("npm", ["audit", "--json"], { cwd: root })).stdout);
} catch (error) {
  audit = JSON.parse(error.stdout);
}
await writeFile(resolve(receipts, "dependency-audit.json"), `${JSON.stringify(audit, null, 2)}\n`);
const inventory = {
  schemaVersion: 1,
  authored: {
    files: authored.length, lines: authoredLines,
    paths: authored.map((path) => relative(root, path)).sort(),
  },
  generated: {
    files: generated.length,
    paths: generated.map((path) => relative(root, path)).sort(),
  },
  installedDependencyBytes: dependencyBytes,
  dependencyManifests: ["package.json", "package-lock.json"],
  providerGlue: [
    "worktree-local customJwt issuer for anonymous local auth",
    "React runtime/persona adapter",
    "acceptance, inventory, and capsule evidence harness",
  ],
  auditVulnerabilities: audit.metadata?.vulnerabilities ?? null,
};
await writeFile(resolve(receipts, "inventory.json"), `${JSON.stringify(inventory, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(inventory)}\n`);
