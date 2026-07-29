import { execFileSync, spawnSync } from "node:child_process";
import { lstat, readdir, stat, writeFile } from "node:fs/promises";
import { extname, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const receiptPath = resolve(root, "..", "receipts/inventory.json");
const ignored = new Set(["node_modules", "dist", ".convex", ".arm-runtime"]);
const sourceExts = new Set([".ts", ".tsx", ".css", ".html", ".mjs"]);

async function walk(directory) {
  const result = [];
  for (const entry of await readdir(directory)) {
    if (ignored.has(entry)) continue;
    const path = resolve(directory, entry);
    const metadata = await lstat(path);
    if (metadata.isDirectory()) result.push(...(await walk(path)));
    else result.push(path);
  }
  return result;
}

const files = await walk(root);
const lines = {};
for (const file of files) {
  if (!sourceExts.has(extname(file)) && !file.endsWith(".json")) continue;
  const output = execFileSync("wc", ["-l", file], { encoding: "utf8" }).trim();
  lines[relative(root, file)] = Number(output.split(/\s+/)[0]);
}
const nodeModulesBytes = Number(
  execFileSync("du", ["-sk", resolve(root, "node_modules")], { encoding: "utf8" })
    .trim()
    .split(/\s+/)[0],
) * 1024;
const auditRun = spawnSync("npm", ["audit", "--json"], {
  cwd: root,
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
});
const packageAudit = JSON.parse(auditRun.stdout || "{}");
const generated = files.filter((file) => file.includes("/convex/_generated/"));
const inventory = {
  capturedAt: new Date().toISOString(),
  authoredFiles: files
    .filter((file) => !file.includes("/convex/_generated/") && file !== receiptPath)
    .map((file) => relative(root, file)),
  lineCounts: lines,
  generatedFiles: generated.map((file) => relative(root, file)),
  installedDependencyBytes: nodeModulesBytes,
  npmAuditMetadata: packageAudit.metadata,
  npmAuditExitStatus: auditRun.status,
  classifications: {
    backend: Object.entries(lines).filter(([path]) => path.startsWith("convex/")),
    client: Object.entries(lines).filter(([path]) => path.startsWith("src/")),
    acceptance: Object.entries(lines).filter(([path]) => path.startsWith("scripts/")),
    configuration: Object.entries(lines).filter(([path]) =>
      ["package.json", "vite.config.ts", "tsconfig.json", "tsconfig.app.json", "tsconfig.node.json"].includes(path),
    ),
    policy: [],
  },
  glue: [
    {
      path: "convex/auth.config.ts + scripts/create-dev-auth.mjs",
      purpose: "worktree-local customJwt development identity issuer because the anonymous local target has no inbox-backed identity fixture",
    },
    {
      path: "convex/chat.ts:setTyping/activeTyping",
      purpose: "durable TTL typing workaround; explicit product GAP",
    },
    {
      path: "convex/chat.ts:heartbeatPresence/activePresence",
      purpose: "durable TTL presence workaround; explicit product GAP",
    },
  ],
};
await writeFile(receiptPath, `${JSON.stringify(inventory, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(inventory, null, 2)}\n`);
